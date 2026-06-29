package com.tehui.offline;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.PlaybackParams;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * TTSForegroundService — Android Foreground Service for background-safe TTS.
 *
 * Protects against background kill via:
 *   1. Foreground Service + persistent notification
 *   2. PARTIAL_WAKE_LOCK (keeps CPU awake so TTS callbacks fire on schedule)
 *   3. AudioFocus management
 *
 * Communication with NativeTTSPlugin:
 *   JS  → Service  : startForegroundService(Intent) with ACTION_SPEAK / STOP / PAUSE / RESUME
 *   Service → Plugin: static volatile Listener callback
 */
public class TTSForegroundService extends Service {

    // ── Intent Actions ────────────────────────────────────────────────────
    public static final String ACTION_SPEAK    = "com.tehui.tts.SPEAK";
    public static final String ACTION_STOP     = "com.tehui.tts.STOP";
    public static final String ACTION_PAUSE    = "com.tehui.tts.PAUSE";
    public static final String ACTION_RESUME   = "com.tehui.tts.RESUME";
    public static final String ACTION_SET_RATE = "com.tehui.tts.SET_RATE"; // 仅更新倍率，不重启播放
    public static final String ACTION_PRE_SPEAK = "com.tehui.tts.PRE_SPEAK"; // 预合成首 chunk，加速首次播放
    public static final String ACTION_WARMUP   = "com.tehui.tts.WARMUP";   // 仅启动 Service + 初始化 TTS 引擎

    // ── Callback interface (set by NativeTTSPlugin) ───────────────────────
    public interface Listener {
        void onFinished();
        void onError(String message);
        /** Called after each chunk completes; charsDone / totalChars gives accurate progress. */
        void onProgress(int charsDone, int totalChars);
        /** Called every ~100 ms while playing; posMs/totalMs are absolute positions in full text,
         *  charsDone is the real-time character progress based on MediaPlayer playback position. */
        default void onPosition(long posMs, long totalMs, int charsDone) {}
        /** 性能诊断日志，桥接到 DevTools console.log */
        default void onLog(String msg) {}
    }
    public static volatile Listener listener = null;

    /** 发送诊断日志到 JS DevTools（通过 Listener.onLog） */
    private static void emitLog(String msg) {
        Listener cb = listener;
        if (cb != null) cb.onLog(msg);
    }

    // ── Constants ─────────────────────────────────────────────────────────
    private static final String CHANNEL_ID = "cx_tts_channel";
    private static final int    NOTIF_ID   = 8001;
    private static final int    CHUNK_SIZE = 200;   // chars per chunk

    // ── TTS ───────────────────────────────────────────────────────────────
    private volatile TextToSpeech tts;  // volatile: 后台线程(UtteranceProgressListener)需要可见性
    private volatile boolean      ttsReady      = false;
    private int                   ttsInitRetries = 0;  // TTS 初始化重试计数
    private static final int      MAX_TTS_RETRIES = 3;
    private static final long[]   TTS_RETRY_DELAYS = {500, 1000, 2000}; // 指数退避（ms）
    private volatile boolean      ttsInitFailed  = false; // 所有重试均失败后置 true

    // ★ 静态 TTS 实例：跨 Service 生命周期复用，避免重复绑定系统 TTS 服务（耗时 3-8s）。
    //   由 MainActivity.onCreate() 提前创建，Service 启动时直接复用。
    public static volatile TextToSpeech sStaticTts  = null;
    public static volatile boolean      sStaticTtsReady = false;

    /** 在 Activity 创建时调用，提前绑定 TTS 引擎。 */
    public static void prewarmTts(android.content.Context context) {
        if (sStaticTts != null) return;
        sStaticTts = new TextToSpeech(context.getApplicationContext(), status -> {
            sStaticTtsReady = (status == TextToSpeech.SUCCESS);
            android.util.Log.i("TTSFgSvc", "prewarmTts callback: status=" + status
                    + " ready=" + sStaticTtsReady);
        });
        android.util.Log.i("TTSFgSvc", "prewarmTts: TextToSpeech CREATED");
    }

    // ── Playback State ────────────────────────────────────────────────────
    private final List<String>  chunks     = new ArrayList<>();
    private volatile int        chunkIndex = 0;
    private volatile boolean    isPaused     = false;
    private volatile boolean    pausedByUser = false; // true=用户手动暂停，false=系统失焦自动暂停
    // ★ 默认 true：Service 新建时处于 idle 状态。
    //   handlePreSpeak 守卫依赖此值判断是否可预合成（!isStopped 才跳过）。
    //   若为 false，新建 Service 会误判为"正在播放"导致预合成被跳过。
    private volatile boolean    isStopped  = true;
    private volatile boolean    isPreSynthesis = false; // true = 预合成模式（页面加载时预生成首 chunk，不播放）
    private volatile boolean    loopEnabled = false; // 循环播放开关，由 JS speak() 的 loop 参数控制
    private volatile int        speakGen   = 0;   // generation counter for stale-callback guard
    private float               playRate   = 1.0f;
    private String              playLang   = "zh-CN";
    private int                 totalTextLength = 0; // set in handleSpeak; used for progress
    private long                chunkStartPositionMs = 0; // 当前 chunk 开始时的媒体位置（ms）
    private long                currentChunkActualDurationMs = 0; // 当前 chunk 音频实际时长（ms，来自 MediaPlayer.getDuration）
    private long                sliceStartPositionMs  = 0; // seek 点偏移，从 JS 传入的 startSecs * 1000
    private long                fullTotalDurationMs   = 0; // 全文稿总时长，从 JS 的 totalSecs * 1000
    private String              playTitle            = "";  // 锁屏/通知栏标题（篇章）
    private String              playArtist           = "";  // 锁屏/通知栏副标题（训练名）
    private Bitmap              appIconBitmap        = null; // APP 图标，缓存避免重复解码

    // 定期向 JS 推送播放位置，保持 APP 内进度条与 MediaSession 同步
    private volatile Runnable   positionRunnable     = null;
    // 自然播放结束后延迟销毁 Service 的 Runnable；循环播放时在宽限期内取消，避免 TTS 反复初始化
    private volatile Runnable   _pendingStop         = null;

    // ── MediaPlayer（synthesizeToFile → MediaPlayer + PlaybackParams 变速）───────
    private MediaPlayer         mediaPlayer          = null;
    // N+1 预生成：播放 chunk N 期间提前合成 chunk N+1，消除 chunk 间停顿
    private volatile File       nextTempFile         = null;  // 预合成完成的下一 chunk 文件
    private volatile int        synthForChunk        = -1;    // 正在合成哪个 chunk（-1 = 无）
    private volatile long       synthStartTimeMs     = 0;     // 合成开始时间戳（用于日志计时）

    // ── Direct-speak mode (speak() fallback when synthesizeToFile fails) ──
    private volatile boolean    useSpeakDirect       = false;  // true = 使用 speak() 直接播放（降级模式）
    private static final int    MAX_SYNTH_FAILURES   = 2;      // 连续 N 次合成失败后切换到 speak() 模式
    private int                 synthFailureCount    = 0;      // 当前会话连续合成失败计数
    private int                 directSpeakCharsDone = 0;      // speak 模式已完成 chunk 的累计字符数

    // ── System Resources ──────────────────────────────────────────────────
    private AudioManager                          audioManager;
    private AudioFocusRequest                     audioFocusRequest; // API 26+
    private AudioManager.OnAudioFocusChangeListener audioFocusListener;
    private PowerManager.WakeLock                 wakeLock;
    private MediaSession                            mediaSession;
    private Handler                               mainHandler;
    // 专用播放派发线程：息屏后主线程被 Doze 节流，chunk 间切换会被挂起；
    // 独立的 THREAD_PRIORITY_AUDIO 线程不受影响，配合 WakeLock 可持续播放。
    private HandlerThread                         ttsHandlerThread;
    private Handler                               ttsHandler;

    // ═══════════════════════════════════════════════════════════════════════
    // Lifecycle
    // ═══════════════════════════════════════════════════════════════════════

    @Override
    public void onCreate() {
        super.onCreate();
        mainHandler = new Handler(Looper.getMainLooper());
        ttsHandlerThread = new HandlerThread("CXTTSWorker", android.os.Process.THREAD_PRIORITY_AUDIO);
        ttsHandlerThread.start();
        ttsHandler = new Handler(ttsHandlerThread.getLooper());
        createNotificationChannel();

        // 解码 APP 图标，供通知栏大图和锁屏封面使用
        try {
            appIconBitmap = BitmapFactory.decodeResource(getResources(), R.mipmap.ic_launcher);
        } catch (Exception ignored) {}

        // WakeLock: prevents Android from throttling CPU / deferring callbacks
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "CX:TTSWakeLock");
        }

        // MediaSession: 向系统声明这是媒体播放器。
        // 国产 ROM（MIUI/EMUI/ColorOS）看到 MediaSession 处于 active 状态，
        // 就不会将其当作普通后台服务杀掉。
        // 使用框架内置 API（API 21+），无需额外依赖。
        mediaSession = new MediaSession(this, "CXTTSSession");
        mediaSession.setFlags(
            MediaSession.FLAG_HANDLES_MEDIA_BUTTONS |
            MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        mediaSession.setActive(true);

        // ★ 最早调用 startForeground()：在 onCreate() 阶段就满足要求。
        // OnePlus/ColorOS 等 ROM 会激进延迟服务调度，导致 5 秒计时器在
        // onStartCommand() 被调用前就到期。这里是防止崩溃的最早时机。
        Notification earlyNotif = buildNotification(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, earlyNotif, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIF_ID, earlyNotif);
        }

        // Callback: 处理锁屏/通知栏媒体控件的点击事件（播放/暂停/停止/拖动进度条）
        mediaSession.setCallback(new MediaSession.Callback() {
            @Override public void onPlay()  { mainHandler.post(() -> handleResume()); }
            @Override public void onPause()  { mainHandler.post(() -> handlePause()); }
            @Override public void onStop()   { mainHandler.post(() -> handleStop()); }
        });
        initTts();
    }

    /** 初始化 TTS 引擎，失败时最多重试 MAX_TTS_RETRIES 次。
     *  始终使用静态实例（sStaticTts），跨 Service 生命周期复用，避免重复绑定。 */
    private void initTts() {
        ttsInitFailed = false;
        emitLog("initTts: sStaticTts=" + (sStaticTts != null) + ", ready=" + sStaticTtsReady);

        // ★ 如果静态实例已就绪，直接复用
        if (sStaticTts != null && sStaticTtsReady) {
            tts = sStaticTts;
            ttsReady = true;
            ttsInitRetries = 0;
            sStaticTts.setOnUtteranceProgressListener(buildUtteranceListener());
            android.util.Log.i("TTSFgSvc", "initTts: REUSED ready static TTS");
            emitLog("initTts: reused ready TTS");
            if (!chunks.isEmpty() && !isStopped && !isPaused) {
                playChunkOnly();
            } else if (!chunks.isEmpty() && isStopped && chunkIndex == 0 && synthForChunk == -1) {
                doSynthesizeChunk(0);
            }
            return;
        }

        // ★ 静态实例不存在，创建新的静态实例（不用 Service 本地实例）
        if (sStaticTts == null) {
            sStaticTtsReady = false;
            sStaticTts = new TextToSpeech(getApplicationContext(), status -> {
                sStaticTtsReady = (status == TextToSpeech.SUCCESS);
                android.util.Log.i("TTSFgSvc", "static TTS callback: status=" + status
                        + " ready=" + sStaticTtsReady);
            });
            android.util.Log.i("TTSFgSvc", "initTts: created NEW static TTS");
        }
        tts = sStaticTts;

        // 轮询等待引擎就绪（最多 15 秒）
        final int gen = speakGen;
        final long startTime = System.currentTimeMillis();
        Runnable[] pollRef = new Runnable[1];
        pollRef[0] = () -> {
            if (speakGen != gen) return;
            if (sStaticTtsReady) {
                ttsReady = true;
                ttsInitRetries = 0;
                sStaticTts.setOnUtteranceProgressListener(buildUtteranceListener());
                long waited = System.currentTimeMillis() - startTime;
                android.util.Log.i("TTSFgSvc", "initTts: static TTS READY after " + waited + "ms"
                        + ", chunks=" + chunks.size() + ", stopped=" + isStopped);
                emitLog("initTts: TTS ready after " + waited + "ms");
                if (!chunks.isEmpty() && !isStopped && !isPaused) {
                    playChunkOnly();
                } else if (!chunks.isEmpty() && isStopped && chunkIndex == 0 && synthForChunk == -1) {
                    doSynthesizeChunk(0);
                }
            } else if (System.currentTimeMillis() - startTime < 15000) {
                mainHandler.postDelayed(pollRef[0], 200);
            } else {
                // 超时：销毁静态实例，回退到普通初始化
                android.util.Log.w("TTSFgSvc", "initTts: static TTS timeout (15s)");
                emitLog("initTts: timeout, fallback");
                try { sStaticTts.shutdown(); } catch (Exception ignored) {}
                sStaticTts = null;
                sStaticTtsReady = false;
                tts = null;
                initTtsFallback();
            }
        };
        mainHandler.post(pollRef[0]);
    }

    /** 回退初始化：创建 Service 本地 TTS 实例（非静态，不跨生命周期复用）。 */
    private void initTtsFallback() {
        tts = new TextToSpeech(this, status -> {
            if (status == TextToSpeech.SUCCESS) {
                ttsInitRetries = 0;
                ttsReady = true;
                ttsInitFailed = false;
                // 仅在确认初始化成功后才设置 UtteranceProgressListener，
                // 避免在 retry 过程中对已作废的 tts 实例设置监听器。
                TextToSpeech ready = tts;
                if (ready != null) {
                    ready.setOnUtteranceProgressListener(buildUtteranceListener());
                }
                android.util.Log.i("TTSFgSvc", "TTS init OK, chunks=" + chunks.size()
                        + ", isStopped=" + isStopped + ", synthForChunk=" + synthForChunk);
                emitLog("TTS init OK, chunks=" + chunks.size() + ", stopped=" + isStopped);
                // If a speak/pre-speak request arrived before init completed, start now
                if (!chunks.isEmpty() && !isStopped && !isPaused) {
                    playChunkOnly();
                } else if (!chunks.isEmpty() && isStopped && chunkIndex == 0 && synthForChunk == -1) {
                    // 预合成模式：TTS 初始化完成后，chunks 已由 handlePreSpeak 设好，
                    // isStopped=true 表示尚未正式播放 → 启动首 chunk 预合成
                    doSynthesizeChunk(0);
                }
            } else {
                // OxygenOS/MIUI 上 TTS 引擎首次初始化偶发 ERROR，稍后重试通常成功
                ttsInitRetries++;
                android.util.Log.w("TTSFgSvc", "TTS init failed, retry " + ttsInitRetries + "/" + MAX_TTS_RETRIES);
                if (ttsInitRetries < MAX_TTS_RETRIES) {
                    TextToSpeech old = tts;
                    tts = null;
                    try { if (old != null) old.shutdown(); } catch (Exception ignored) {}
                    long delay = TTS_RETRY_DELAYS[Math.min(ttsInitRetries - 1, TTS_RETRY_DELAYS.length - 1)];
                    android.util.Log.w("TTSFgSvc", "retrying in " + delay + "ms");
                    mainHandler.postDelayed(() -> {
                        if (!isStopped) initTtsFallback();
                    }, delay);
                } else {
                    ttsInitFailed = true;
                    notifyError("TTS 初始化失败，请检查系统语音引擎");
                }
            }
        });
    }

    /** 构建 UtteranceProgressListener（拆出以便 initTts 成功后单独设置）。 */
    private UtteranceProgressListener buildUtteranceListener() {
        return new UtteranceProgressListener() {
            @Override
            public void onStart(String utteranceId) {
                if (useSpeakDirect) {
                    // speak() 模式：音频开始播放，启动位置广播
                    mainHandler.post(() -> {
                        if (!isStopped && !isPaused) {
                            startPositionBroadcast();
                            updatePlaybackState(true);
                        }
                    });
                }
            }

            @Override
            public void onDone(String utteranceId) {
                if (useSpeakDirect) {
                    // ── speak() 直接播放模式：onDone = 音频播放完毕 ─────────
                    int gen = parseGen(utteranceId);
                    if (gen != speakGen || isStopped || isPaused) return;
                    final int capturedGen = gen;
                    mainHandler.post(() -> {
                        if (speakGen != capturedGen || isStopped || isPaused) return;
                        onDirectSpeakChunkDone(capturedGen);
                    });
                } else {
                    // ── synthesizeToFile 模式：onDone = 文件写入完毕 ────────
                    int gen = parseGen(utteranceId);
                    int chunkOfUid = parseChunk(utteranceId);
                    File tempFile = new File(getCacheDir(), "tts_" + utteranceId + ".wav");

                    final boolean wasPreSynth = isPreSynthesis; // 捕获当前值，防止跨线程竞态
                    if (gen != speakGen || (isStopped && !wasPreSynth) || isPaused) {
                        // 守卫触发：该合成结果已过期，直接删除临时文件。
                        // 注：预合成模式下 isStopped=true 但文件应保留，供后续 handleSpeak 复用。
                        deleteTempFile(tempFile);
                        return;
                    }

                    final int capturedGen = gen;
                    final File capturedFile = tempFile;
                    long _synthMs = System.currentTimeMillis() - synthStartTimeMs;
                    android.util.Log.i("TTSFgSvc", "onDone: synth chunk " + chunkOfUid + " took " + _synthMs + "ms");
                    emitLog("synth chunk" + chunkOfUid + "=" + _synthMs + "ms");
                    mainHandler.post(() -> {
                        long _postMs = System.currentTimeMillis();
                        if (wasPreSynth) {
                            // 预合成完成：文件已写入缓存目录，不启动播放，等待 handleSpeak 复用
                            // ★ 重置 synthForChunk：使 handleSpeak 能区分"合成已完成"与"合成进行中"
                            synthForChunk = -1;
                            android.util.Log.i("TTSFgSvc", "pre-synth chunk " + chunkOfUid + " ready (" + _synthMs + "ms)");
                            emitLog("pre-synth chunk" + chunkOfUid + " ready (" + _synthMs + "ms)");
                            return;
                        }
                        if (speakGen != capturedGen || isStopped || isPaused) {
                            deleteTempFile(capturedFile);
                            return;
                        }
                        if (chunkOfUid == chunkIndex) {
                            // 当前正等待合成的 chunk → 立即开始播放
                            android.util.Log.i("TTSFgSvc", "onDone→startMediaPlayer: synthMs=" + _synthMs
                                    + ", postWaitMs=" + (System.currentTimeMillis() - _postMs));
                            emitLog("onDone→play: synth=" + _synthMs + "ms, postWait=" + (System.currentTimeMillis() - _postMs) + "ms");
                            startMediaPlayer(capturedFile, capturedGen);
                        } else if (chunkOfUid == chunkIndex + 1) {
                            // N+1 预生成完成 → 存储，等当前 chunk 播完后零间隙衔接
                            deleteTempFile(nextTempFile); // 清理上一轮可能残留的旧预生成文件
                            nextTempFile = capturedFile;
                        } else {
                            // 意外的 uid（不应发生），清理文件
                            deleteTempFile(capturedFile);
                        }
                    });
                }
            }

            @Override
            @SuppressWarnings("deprecation")
            public void onError(String utteranceId) {
                if (useSpeakDirect) {
                    // speak() 模式：朗读出错，跳过当前 chunk 继续
                    int gen = parseGen(utteranceId);
                    if (gen != speakGen || isStopped || isPaused) return;
                    final int capturedGen = gen;
                    mainHandler.post(() -> {
                        if (speakGen != capturedGen || isStopped || isPaused) return;
                        onDirectSpeakChunkDone(capturedGen); // 当作完成，跳到下一个
                    });
                } else {
                    // synthesizeToFile 模式：合成失败，清理文件并跳过
                    int gen = parseGen(utteranceId);
                    int chunkOfUid = parseChunk(utteranceId);
                    File tempFile = new File(getCacheDir(), "tts_" + utteranceId + ".wav");
                    deleteTempFile(tempFile); // 合成失败，文件可能不完整
                    if (gen != speakGen || isStopped || isPaused) return;
                    if (chunkOfUid != chunkIndex) return; // 只处理当前 chunk 的错误
                    final int capturedGen = gen;
                    mainHandler.post(() -> {
                        if (speakGen != capturedGen || isStopped || isPaused) return;
                        onChunkPlaybackComplete(capturedGen);
                    });
                }
            }
        };
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Android 要求 startForegroundService() 后 5 秒内必须调 startForeground()。
        // 在所有分支之前统一调用：无论 Intent 为 null、系统重建，还是任何 ACTION，
        // 都能保证在 onStartCommand() 入口处立即满足要求，彻底避免超时崩溃。
        Notification notif0 = buildNotification(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, notif0, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIF_ID, notif0);
        }

        if (intent == null || intent.getAction() == null) {
            // START_STICKY 重建 or 系统传入空 Intent：直接停止即可。
            stopSelf();
            return START_NOT_STICKY;
        }

        // ★ 入口日志：确认 service 收到了哪个 action
        emitLog("onStartCommand: " + intent.getAction()
                + " isStopped=" + isStopped + " ttsReady=" + ttsReady
                + " chunks=" + chunks.size());

        switch (intent.getAction()) {
            case ACTION_SPEAK:    handleSpeak(intent);   break;
            case ACTION_STOP:     handleStop();           break;
            case ACTION_PAUSE:    handlePause();          break;
            case ACTION_RESUME:   handleResume();         break;
            case ACTION_SET_RATE: handleSetRate(intent);  break;
            case ACTION_PRE_SPEAK: handlePreSpeak(intent); break;
            case ACTION_WARMUP:
                // 仅启动 Service + 触发 initTts()（onCreate 中已调用）。
                // 使 TTS 引擎在用户点击播放前就绑定就绪，省去 2-3 秒初始化延迟。
                android.util.Log.i("TTSFgSvc", "warmup: ttsReady=" + ttsReady);
                emitLog("warmup: ttsReady=" + ttsReady);
                break;
        }
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onDestroy() {
        isStopped = true;
        ttsReady  = false;
        if (mainHandler != null) mainHandler.removeCallbacksAndMessages(null);
        if (ttsHandler  != null) ttsHandler.removeCallbacksAndMessages(null);
        positionRunnable  = null;
        synthForChunk = -1;
        releaseMediaPlayer();
        deleteTempFile(nextTempFile);
        nextTempFile = null;
        cleanTempFiles();
        if (ttsHandlerThread != null) { ttsHandlerThread.quitSafely(); ttsHandlerThread = null; }
        releaseWakeLock();
        abandonAudioFocus();
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
            mediaSession = null;
        }
        TextToSpeech t = tts;
        tts = null;
        ttsReady = false;
        if (t != null) {
            t.stop();
            // ★ 不关闭静态实例：保留 sStaticTts 供 Service 重建后复用，省去重新绑定开销。
            //   仅当不是静态实例时才 shutdown（回退路径创建的本地实例）。
            if (t != sStaticTts) {
                t.shutdown();
            }
        }
        super.onDestroy();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        emitLog("onTaskRemoved: stopping playback and service");
        // 用户从最近任务列表划掉应用 → 完全停止朗读，不暂停不恢复
        handleStop();
        // handleStop() 内部 schedulePendingStop() 延迟 2 秒销毁 Service（宽限期），
        // 但杀进程场景应立即停止，取消延迟并直接销毁
        cancelPendingStop();
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Action handlers
    // ═══════════════════════════════════════════════════════════════════════

    private void handleSpeak(Intent intent) {
        long _t0 = System.currentTimeMillis(); // ★ 出声延迟计时起点
        // 取消宽限期内挂起的延迟停止，循环播放时复用现有 TTS 实例而无需重建 Service
        cancelPendingStop();
        String text   = intent.getStringExtra("text");
        String lang   = intent.getStringExtra("lang");
        String title  = intent.getStringExtra("title");
        String artist = intent.getStringExtra("artist");
        if (lang   != null && !lang.isEmpty())   playLang   = lang;
        if (title  != null && !title.isEmpty())  playTitle  = title;
        if (artist != null && !artist.isEmpty()) playArtist = artist;
        playRate             = intent.getFloatExtra("rate", 1.0f);
        loopEnabled          = intent.getBooleanExtra("loop", false);
        // JS 现在传完整文本，seek 偏移由 startSecs/totalSecs 比率计算 chunkIndex 实现，
        // 循环时 chunkIndex=0 对应全文开头，不再受熄屏截断位置影响。
        sliceStartPositionMs = 0;
        fullTotalDurationMs  = (long)(intent.getFloatExtra("totalSecs", 0f) * 1000L);

        // startForeground() 已在 onStartCommand() 最顶部统一调用，此处更新通知为播放状态。
        updateNotification(true);

        if (text == null || text.trim().isEmpty()) {
            notifyError("文本为空");
            return;
        }

        // ★ 预合成正在进行时的快速路径：用户在预合成完成前点击播放。
        //   不取消合成、不递增 speakGen，待 onDone 自动启动播放。
        //   synthForChunk==0 表示合成进行中；onDone 预合成路径会重置为 -1 表示已完成。
        float seekSecs  = intent.getFloatExtra("startSecs", 0f);
        float totalSecs = intent.getFloatExtra("totalSecs", 0f);
        boolean preSynthInProgress = (synthForChunk == 0 && isPreSynthesis
                && seekSecs <= 0f && ttsReady && !chunks.isEmpty());

        // Reset state
        isStopped    = false;
        isPaused     = false;
        pausedByUser = false;
        chunkIndex   = 0;
        chunkStartPositionMs = 0;
        currentChunkActualDurationMs = 0;
        if (!preSynthInProgress) speakGen++;
        isPreSynthesis = false; // 正式播放，退出预合成模式
        // 重置播放模式和失败计数（每次新 speak 从 synthesizeToFile 开始尝试）
        useSpeakDirect = false;
        synthFailureCount = 0;
        directSpeakCharsDone = 0;
        // 重置流水线状态：清理上次会话可能剩下的预生成文件
        if (!preSynthInProgress) synthForChunk = -1;
        // ★ 不释放 MediaPlayer 原生资源：startMediaPlayer() 会复用现有实例（reset），
        //   避免 release()+new() 的开销（~30-50ms）。仅 stop 当前播放。
        {
            MediaPlayer mp = mediaPlayer;
            if (mp != null) {
                try { if (mp.isPlaying()) mp.stop(); } catch (Exception ignored) {}
                try { mp.reset(); } catch (Exception ignored) {}
            }
        }
        deleteTempFile(nextTempFile);
        nextTempFile = null;
        // 清理旧 generation 的临时文件，但保留上一 gen 的文件（可能是预合成结果）。
        // handlePreSpeak 用 speakGen=N，然后此处 speakGen++ 变为 N+1，
        // 预合成文件名为 tts_gN_c0.wav，需保留供 playChunkOnly() 复用。
        cleanStaleTempFiles(speakGen, speakGen - 1);
        chunks.clear();
        chunks.addAll(splitText(text, CHUNK_SIZE));
        totalTextLength = text.length();

        long _t1 = System.currentTimeMillis();

        // 根据 startSecs/totalSecs 比率跳到正确的起始 chunk（替代之前由 JS sliceText 实现的 seek）
        if (seekSecs > 0f && totalSecs > 0f && totalTextLength > 0) {
            int targetChar = (int)(totalTextLength * (seekSecs / totalSecs));
            int cumLen = 0;
            for (int i = 0; i < chunks.size(); i++) {
                if (cumLen + chunks.get(i).length() > targetChar) {
                    chunkIndex = i;
                    break;
                }
                cumLen += chunks.get(i).length();
            }
        }

        if (!requestAudioFocus()) {
            // 音频焦点申请被拒（OxygenOS/MIUI 省电策略等），降级继续播放。
            // TTS 引擎不强依赖焦点，绝大多数情况下仍可正常发声；
            // 拒绝报错反而让用户完全无法使用，降级比报错更合理。
            android.util.Log.w("TTSFgSvc", "requestAudioFocus failed, continuing anyway");
        }

        acquireWakeLock();
        updatePlaybackState(true);

        long _t2 = System.currentTimeMillis();

        // 检查预合成文件
        File _preCheck = new File(getCacheDir(), "tts_g" + speakGen + "_c0.wav");
        boolean _hasPreFile = _preCheck.exists() && _preCheck.length() > 0;
        if (!_hasPreFile) {
            File _preCheck2 = new File(getCacheDir(), "tts_g" + (speakGen - 1) + "_c0.wav");
            _hasPreFile = _preCheck2.exists() && _preCheck2.length() > 0;
        }

        android.util.Log.i("TTSFgSvc", "handleSpeak: ttsReady=" + ttsReady
                + ", preSynthFile=" + _hasPreFile
                + ", gen=" + speakGen
                + ", setupMs=" + (_t1 - _t0)
                + ", focusMs=" + (_t2 - _t1));
        emitLog("handleSpeak: ttsReady=" + ttsReady + ", preSynth=" + _hasPreFile
                + ", gen=" + speakGen + ", setup=" + (_t1 - _t0) + "ms, focus=" + (_t2 - _t1) + "ms");

        if (preSynthInProgress) {
            // ★ 预合成正在进行：不取消 tts.stop()，不调 playChunkOnly()。
            //   onDone 检测到 isPreSynthesis=false 后会自动 startMediaPlayer。
            updateMediaMetadata();
            emitLog("handleSpeak: pre-synth in progress (gen=" + speakGen + "), waiting for onDone");
            // ★ 超时保底：如果 4 秒内 onDone 未触发（合成被引擎静默丢弃或阻塞），
            //   取消并重新合成，避免无限等待。
            //   检查 synthForChunk：onDone 触发后 N+1 预生成会将其改为 1，
            //   仍为 0 说明 onDone 从未触发。
            //   ★ 必须用 mainHandler 而非 ttsHandler：synthesizeToFile 可能阻塞
            //   ttsHandler 线程，导致同线程的超时永远无法执行。
            final int fallbackGen = speakGen;
            mainHandler.postDelayed(() -> {
                if (speakGen != fallbackGen || isStopped || isPaused) return;
                if (synthForChunk != 0) return; // onDone 已触发，合成已完成
                emitLog("handleSpeak: pre-synth timeout (4s), re-synthesizing");
                synthForChunk = -1;
                TextToSpeech t = tts;
                if (t != null) t.stop();
                ttsHandler.postDelayed(() -> {
                    if (speakGen != fallbackGen || isStopped) return;
                    playChunkOnly();
                }, 80);
            }, 4000);
        } else if (ttsReady) {
            // 先显式 stop() 确保引擎当前无正在进行的合成任务。
            // synthesizeToFile 内部使用 QUEUE_FLUSH 会再次清空队列，
            // 因此只需短暂等待引擎响应 stop() 即可。
            TextToSpeech t = tts;
            if (t != null) t.stop();
            final int gen = speakGen;
            // ★ 有预合成文件时仅延迟 20ms（够 tts.stop() 响应即可），
            //   无预合成文件时 80ms 给引擎更多时间排空队列。
            long delay = _hasPreFile ? 20 : 80;
            ttsHandler.postDelayed(() -> {
                emitLog("postDelayed fired: speakGen=" + speakGen + "/" + gen
                        + " isStopped=" + isStopped + " isPaused=" + isPaused);
                if (speakGen != gen || isStopped) {
                    emitLog("postDelayed GUARD: rejected! speakGen=" + speakGen
                            + "/" + gen + " stopped=" + isStopped);
                    return;
                }
                // ★ 覆盖 handleFocusLossPause 在等待期间可能设置的 isPaused=true。
                //   handleSpeak() 明确启动新播放，音频焦点丢失不应阻断首次出声。
                //   焦点归还时 handleResume() 会正常恢复。
                if (isPaused) {
                    emitLog("postDelayed: overriding isPaused (was set by focusLoss during wait)");
                    isPaused = false;
                    pausedByUser = false;
                }
                long _t3 = System.currentTimeMillis();
                android.util.Log.i("TTSFgSvc", "playChunkOnly after " + (_t3 - _t2) + "ms wait (delay=" + delay + ")");
                emitLog("playChunk delay=" + delay + "ms, actual=" + (_t3 - _t2) + "ms");
                playChunkOnly();
                // ★ 非关键更新延迟到播放启动后：锁屏标题和 MediaSession metadata
                updateMediaMetadata();
                long _total = System.currentTimeMillis() - _t0;
                android.util.Log.i("TTSFgSvc", "playChunkOnly done, total handleSpeak→play=" + _total + "ms");
                emitLog("handleSpeak→play total=" + _total + "ms");
            }, delay);
        } else if (ttsInitFailed) {
            // 上次全部重试均失败，用户再次点播放时允许重新初始化。
            android.util.Log.w("TTSFgSvc", "Re-attempting TTS init after previous failure");
            ttsInitRetries = 0;
            ttsInitFailed = false;
            initTts();
            // chunks 已设置好，initTts 成功后的回调里会自动调用 playChunkOnly()
        } else {
            // ★ ttsReady=false 且 ttsInitFailed=false：
            //   TTS 可能仍在初始化中（onCreate 触发），也可能回调已丢失（Service 重建后）。
            //   无论如何，主动重新调用 initTts() 确保播放链不会断裂。
            //   initTts() 会优先复用静态预热实例，不会创建多余实例。
            android.util.Log.i("TTSFgSvc", "handleSpeak: ttsReady=false, re-calling initTts()");
            emitLog("handleSpeak: ttsReady=false, re-init");
            ttsInitRetries = 0;
            initTts();
        }
    }

    /**
     * 预合成首 chunk：页面加载时由 JS 调用，提前合成第一个 chunk 的 WAV 文件。
     * 用户随后点击播放时，handleSpeak() 发现 synthForChunk==0 会跳过合成，直接播放。
     * 注意：此方法不创建 MediaPlayer、不播放音频、不更新通知栏。
     */
    private void handlePreSpeak(Intent intent) {
        // 仅在正在播放时跳过（isStopped=false 表示活跃播放中）
        // 注意：不检查 chunks.isEmpty()——handleStop() 不清 chunks，
        // 若检查会导致 cancel()→handleStop()→schedulePendingStop() 后的
        // preSynthesize 被错误跳过，且 2 秒后 Service 被销毁。
        if (!isStopped) return;

        // 取消 handleStop/finishPlayback 可能挂起的延迟销毁（2 秒宽限期），
        // 使 Service 在预合成期间保持存活。
        cancelPendingStop();

        android.util.Log.i("TTSFgSvc", "handlePreSpeak: proceed, chunks=" + chunks.size()
                + " ttsReady=" + ttsReady + " speakGen=" + speakGen);
        emitLog("handlePreSpeak: proceed, chunks=" + chunks.size() + " ttsReady=" + ttsReady);

        String lang = intent.getStringExtra("lang");
        if (lang != null && !lang.isEmpty()) playLang = lang;
        playRate = intent.getFloatExtra("rate", 1.0f);

        String text = intent.getStringExtra("text");
        if (text == null || text.trim().isEmpty()) {
            // 无文本（页面加载中）：仅触发 TTS 引擎初始化预热，
            // 使引擎在用户稍后点击播放时已就绪，省去 2-3 秒初始化延迟。
            if (!ttsReady && !ttsInitFailed) {
                // initTts() 已在 onCreate() 调用，此处无需重复；
                // 但若之前全部重试均失败，允许重新初始化。
            } else if (ttsInitFailed) {
                ttsInitRetries = 0;
                ttsInitFailed = false;
                initTts();
            }
            return;
        }

        chunks.clear();
        chunks.addAll(splitText(text, CHUNK_SIZE));
        totalTextLength = text.length();
        chunkIndex = 0;
        speakGen++;
        isStopped = true;  // 保持 stopped：onDone/onError 中不会触发播放
        isPreSynthesis = true; // 预合成模式：onDone 保留文件而不删除
        isPaused = false;
        useSpeakDirect = false;
        synthFailureCount = 0;
        synthForChunk = -1;

        if (ttsReady) {
            // ★ 与 handleSpeak 正常路径完全相同的模式：
            //   主线程 tts.stop() → 80ms 延迟 → synthesizeToFile。
            //   使用 mainHandler 而非 ttsHandler（确保回调执行，便于诊断）。
            TextToSpeech t = tts;
            if (t != null) t.stop();
            final int capturedGen = speakGen;
            mainHandler.postDelayed(() -> {
                if (speakGen != capturedGen) return;
                if (synthForChunk != -1) return;
                doSynthesizeChunk(0);
            }, 80);
        }
        // TTS 尚未就绪时，initTts() 成功回调会检测 chunks 非空并启动预合成
    }

    private void handleSetRate(Intent intent) {
        float newRate = intent.getFloatExtra("rate", playRate);
        playRate = newRate;
        if (useSpeakDirect) {
            // speak 模式：通过 setSpeechRate 应用新倍率（当前正在朗读的 chunk 不受影响，下一个 chunk 生效）
            TextToSpeech t = tts;
            if (t != null) t.setSpeechRate(Math.max(0.1f, newRate));
        } else {
            // synthesizeToFile 模式：通过 MediaPlayer.setPlaybackParams() 更新倍率，无需重启合成/播放。
            // API >= 23 才支持 PlaybackParams。
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && mediaPlayer != null) {
                try {
                    PlaybackParams pp = new PlaybackParams();
                    pp.setSpeed(Math.max(0.1f, newRate));
                    pp.setPitch(1.0f);
                    mediaPlayer.setPlaybackParams(pp);
                } catch (Exception e) {
                    android.util.Log.w("TTSFgSvc", "setPlaybackParams failed: " + e.getMessage());
                }
            }
        }
        // 更新 MediaSession 锁屏进度条采用新倍率（暂停时也需更新）
        updatePlaybackState(!isPaused && !isStopped);
    }

    private void handleStop() {
        emitLog("handleStop called: speakGen=" + speakGen + " chunks=" + chunks.size());
        isStopped    = true;
        isPaused     = false;
        pausedByUser = false;
        isPreSynthesis = false;
        speakGen++;
        cancelPendingStop();
        stopPositionBroadcast();
        synthForChunk = -1;
        releaseMediaPlayer();
        // ★ 仅 useSpeakDirect 模式需要 tts.stop()（speak 模式音频由引擎直接播放）。
        //   synthesizeToFile 模式下不调 tts.stop()：MediaPlayer 已停止，
        //   N+1 预合成的结果会被 gen 不匹配自动丢弃。
        //   关键：tts.stop() 会使引擎进入异常状态，导致后续 synthesizeToFile()
        //   被静默丢弃（页面切换后预合成失败的根因）。
        if (useSpeakDirect && tts != null) tts.stop();
        cleanTempFiles();
        deleteTempFile(nextTempFile);
        nextTempFile = null;
        // 不立即销毁 Service：保留 TTS 引擎实例，下次播放无需重新初始化（省 2-3 秒）。
        // 使用与 finishPlayback() 相同的 2 秒宽限期；若期间收到新 speak()，
        // cancelPendingStop() 会取消销毁并继续播放。
        updateNotification(false);
        schedulePendingStop();
    }

    private void handlePause() {
        if (isPaused || isStopped) return;
        cancelPendingStop();
        pausedByUser = true; // 用户主动暂停，焦点归还后不自动恢复
        isPaused = true;
        // ★ 不再 speakGen++：isPaused 守卫足以使旧合成回调失效，
        //   保持 speakGen 不变可保留 MediaPlayer OnCompletionListener 的有效性，
        //   修复暂停恢复后只能播放一个 chunk（~200字符）就停止的 bug。
        synthForChunk = -1; // 合成已取消
        stopPositionBroadcast();

        // 取消 TTS 引擎中正在进行的合成任务
        if (tts != null) tts.stop();

        // 暂停 MediaPlayer（保留位置，恢复时可继续）
        if (mediaPlayer != null) {
            try {
                if (mediaPlayer.isPlaying()) mediaPlayer.pause();
            } catch (Exception ignored) {}
        }

        // 删除预生成的 N+1 文件（暂停后状态重置，恢复时重新预生成）
        deleteTempFile(nextTempFile);
        nextTempFile = null;

        // 冻结位置：暂停后 getCurrentPositionMs() 依赖 mediaPlayer.getCurrentPosition()（不变）
        updateNotification(false);
    }

    private void handleResume() {
        if (!isPaused || isStopped) return;
        cancelPendingStop();
        isPaused     = false;
        pausedByUser = false;
        // ★ speakGen++ 从顶部移至各分支内部：
        //   MediaPlayer 恢复路径不递增（保留 OnCompletionListener 的有效性）；
        //   speak 模式和重新合成路径递增（新 utterance / MediaPlayer 需要新的 gen）。
        updateNotification(true);

        if (useSpeakDirect) {
            // speak 模式：没有 MediaPlayer，直接从当前 chunk 重新朗读
            speakGen++; // 新 utterance 将携带新 gen，安全递增
            startPositionBroadcast();
            ttsHandler.post(this::playDirectSpeakChunk);
            return;
        }

        if (mediaPlayer != null) {
            // MediaPlayer 处于暂停状态，直接恢复；同时应用最新倍率（暂停期间可能已更改）
            // ★ 不递增 speakGen：OnCompletionListener 携带的旧 gen 必须与 speakGen 匹配
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    PlaybackParams pp = new PlaybackParams();
                    pp.setSpeed(Math.max(0.1f, playRate));
                    pp.setPitch(1.0f);
                    mediaPlayer.setPlaybackParams(pp);
                }
                mediaPlayer.start();
                startPositionBroadcast();
                // 补发 N+1 预生成（暂停时已取消）
                final int prefetchIdx = chunkIndex + 1;
                final int gen = speakGen;
                ttsHandler.post(() -> {
                    if (speakGen != gen || isStopped || isPaused) return;
                    if (prefetchIdx < chunks.size() && synthForChunk != prefetchIdx) {
                        doSynthesizeChunk(prefetchIdx);
                    }
                });
            } catch (Exception e) {
                android.util.Log.w("TTSFgSvc", "MediaPlayer resume failed, re-synthesizing");
                releaseMediaPlayer();
                ttsHandler.post(this::playChunkOnly);
            }
        } else {
            // 合成被中断（暂停时 tts.stop() 取消了进行中的合成）→ 重新合成当前 chunk
            speakGen++; // 将创建新 MediaPlayer，安全递增
            ttsHandler.post(this::playChunkOnly);
        }
    }

    /**
     * 系统失焦导致的自动暂停（如接电话、其他媒体 App 接管音频焦点）。
     * 不设置 pausedByUser，焦点归还后（AUDIOFOCUS_GAIN）可自动恢复。
     */
    private void handleFocusLossPause() {
        if (isPaused || isStopped) return;
        pausedByUser = false;
        isPaused = true;
        // ★ 不再 speakGen++：同 handlePause，isPaused 守卫已足够
        synthForChunk = -1;
        stopPositionBroadcast();
        if (tts != null) tts.stop();
        if (mediaPlayer != null) {
            try {
                if (mediaPlayer.isPlaying()) mediaPlayer.pause();
            } catch (Exception ignored) {}
        }
        deleteTempFile(nextTempFile);
        nextTempFile = null;
        updateNotification(false);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TTS core
    // ═══════════════════════════════════════════════════════════════════════

    private void setTtsParams() {
        // 始终使用 setLanguage()，跟随系统设定的默认音色。
        Locale locale;
        try {
            locale = Locale.forLanguageTag(playLang);
        } catch (Exception e) {
            locale = Locale.CHINA;
        }
        int r = tts.setLanguage(locale);
        if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) {
            tts.setLanguage(Locale.CHINA);
        }
        // 合成始终用 1.0f：变速由 MediaPlayer.PlaybackParams 实现（时间拉伸，不变调）。
        // 对于 API < 23 无法使用 PlaybackParams 的设备，播放速度固定为 1x。
        tts.setSpeechRate(1.0f);
    }


    /**
     * 合成当前 chunkIndex 对应的 chunk 到临时文件（synthesizeToFile）。
     * 每块播放前由 ttsHandler 调用；预生成 N+1 时也走此方法（传入 idx）。
     * N+1 预生成：startMediaPlayer 播放开始后会再次调用 doSynthesizeChunk(chunkIndex+1)。
     */
    private void playChunkOnly() {
        if (useSpeakDirect) {
            playDirectSpeakChunk();
            return;
        }
        // 若该 chunk 的合成已经由预生成发起，直接等待 onDone()，不重复提交。
        if (synthForChunk == chunkIndex) return;
        if (!ttsReady || isStopped || isPaused) return;
        if (chunkIndex >= chunks.size()) {
            notifyFinished();
            return;
        }
        acquireWakeLock();
        // 检查是否有预合成文件（由 handlePreSpeak 在页面加载时生成）
        // handlePreSpeak 用 speakGen=N，handleSpeak 将其递增为 N+1，
        // 因此预合成文件名为 tts_gN_c0.wav，需同时检查 speakGen 和 speakGen-1。
        File preFile = new File(getCacheDir(), "tts_g" + speakGen + "_c" + chunkIndex + ".wav");
        if (!preFile.exists() || preFile.length() == 0) {
            preFile = new File(getCacheDir(), "tts_g" + (speakGen - 1) + "_c" + chunkIndex + ".wav");
        }
        if (preFile.exists() && preFile.length() > 0) {
            synthForChunk = chunkIndex; // 标记已合成，防止重复提交
            android.util.Log.i("TTSFgSvc", "playChunkOnly: pre-synth file found (" + preFile.getName() + ", " + preFile.length() + "B)");
            emitLog("playChunk: pre-synth OK " + preFile.getName() + " " + (preFile.length() / 1024) + "KB");
            startMediaPlayer(preFile, speakGen);
        } else {
            android.util.Log.i("TTSFgSvc", "playChunkOnly: no pre-synth, synthesizing chunk " + chunkIndex);
            emitLog("playChunk: no pre-synth, synthesizing...");
            doSynthesizeChunk(chunkIndex);
        }
        chunkStartPositionMs = calculateChunkStartPositionMs();
        updatePlaybackState(true);
    }

    /**
     * 向 TTS 引擎提交指定 chunk 的合成任务（写入临时 WAV 文件）。
     * 合成结果通过 UtteranceProgressListener.onDone() 返回。
     * uid 格式 "g<gen>_c<idx>" 与现有 parseGen/parseChunk 兼容。
     */
    private void doSynthesizeChunk(int idx) {
        TextToSpeech t = tts;
        // 预合成模式下 isStopped=true 但允许合成（isPreSynthesis=true 时跳过 isStopped 检查）
        if (t == null || !ttsReady || (isStopped && !isPreSynthesis)) return;
        if (idx < 0 || idx >= chunks.size()) return;
        String text = chunks.get(idx);
        String uid  = "g" + speakGen + "_c" + idx;
        File outFile = new File(getCacheDir(), "tts_" + uid + ".wav");
        emitLog("synth chunk" + idx + ": " + text.length() + " chars");
        android.util.Log.i("TTSFgSvc", "doSynthesizeChunk: idx=" + idx + ", len=" + text.length()
                + ", totalChunks=" + chunks.size());
        // 每块重设语言 + 1.0f 合成速率（华为/讯飞等引擎切换后可能重置语言或音色）
        long _beforeParams = System.currentTimeMillis();
        setTtsParams();
        long _paramsMs = System.currentTimeMillis() - _beforeParams;
        if (_paramsMs > 100) {
            emitLog("setTtsParams SLOW: " + _paramsMs + "ms");
        }
        synthForChunk = idx;
        synthStartTimeMs = System.currentTimeMillis();
        int ret = t.synthesizeToFile(text, (Bundle) null, outFile, uid);
        emitLog("synth chunk" + idx + " ret=" + (ret == TextToSpeech.SUCCESS ? "SUCCESS" : "ERROR(" + ret + ")"));
        android.util.Log.i("TTSFgSvc", "synthesizeToFile ret=" + ret + " for chunk " + idx);
        if (ret == TextToSpeech.ERROR) {
            // 首次失败重试一次
            setTtsParams();
            synthForChunk = idx;
            ret = t.synthesizeToFile(text, (Bundle) null, outFile, uid);
        }
        if (ret == TextToSpeech.ERROR) {
            // 引擎彻底拒绝
            synthFailureCount++;
            android.util.Log.w("TTSFgSvc", "synthesizeToFile failed for chunk " + idx
                    + " (" + synthFailureCount + "/" + MAX_SYNTH_FAILURES + ")");
            if (isPreSynthesis) {
                // ★ 预合成失败：保持 synthForChunk=0，让 handleSpeak 的 4s 超时触发重合成。
                //   不重置为 -1（否则超时误判"已完成"而跳过）。
                //   也不调 onChunkPlaybackComplete（isStopped=true 会直接返回）。
                emitLog("pre-synth synthesizeToFile ERROR, will retry via 4s timeout");
                return;
            }
            if (synthFailureCount >= MAX_SYNTH_FAILURES) {
                // 连续失败达阈值，切换到 speak() 直接播放模式
                android.util.Log.w("TTSFgSvc", "synthesizeToFile consistently failing, switching to speak() direct mode");
                useSpeakDirect = true;
                synthFailureCount = 0;
                synthForChunk = -1;
                final int gen = speakGen;
                ttsHandler.post(() -> {
                    if (speakGen != gen || isStopped || isPaused) return;
                    playDirectSpeakChunk();
                });
                return;
            }
            // 未达阈值，视同该 chunk 播放完毕，跳过继续
            synthForChunk = -1;
            final int gen = speakGen;
            mainHandler.post(() -> {
                if (speakGen != gen || isStopped) return;
                onChunkPlaybackComplete(gen);
            });
        }
    }

    /**
     * speak() 直接播放模式：使用 TextToSpeech.speak() 朗读当前 chunk。
     * 作为 synthesizeToFile 的降级方案，适用于华为/OPPO 等设备。
     * 变速通过 tts.setSpeechRate() 实现（无法变速不变调，但保证有声音）。
     */
    private void playDirectSpeakChunk() {
        TextToSpeech t = tts;
        if (t == null || !ttsReady || isStopped || isPaused) return;
        if (chunkIndex >= chunks.size()) {
            mainHandler.post(this::notifyFinished);
            return;
        }
        String text = chunks.get(chunkIndex);
        String uid  = "g" + speakGen + "_c" + chunkIndex;
        setTtsParams();
        // speak 模式下变速通过 setSpeechRate 实现（合成和播放一体，不像 MediaPlayer 可以变速不变调）
        t.setSpeechRate(Math.max(0.1f, playRate));
        int ret = t.speak(text, TextToSpeech.QUEUE_ADD, null, uid);
        if (ret == TextToSpeech.ERROR) {
            // speak() 被拒绝。引擎通常仍会触发 onError 回调 → buildUtteranceListener 中处理。
            // 不在此处调用 onDirectSpeakChunkDone，避免与 onError 回调双重推进。
            android.util.Log.w("TTSFgSvc", "speak() returned ERROR for chunk " + chunkIndex);
        }
        // 更新进度位置
        chunkStartPositionMs = calculateChunkStartPositionMs();
        acquireWakeLock();
        updatePlaybackState(true);
        startPositionBroadcast();
        // 推送当前位置
        Listener cb = listener;
        if (cb != null) {
            long totalMs = fullTotalDurationMs > 0 ? fullTotalDurationMs : getTotalDurationMs();
            cb.onPosition(chunkStartPositionMs, totalMs, directSpeakCharsDone);
        }
    }

    /**
     * speak 模式下 chunk 朗读完成（由 UtteranceProgressListener.onDone 触发，main thread）。
     * 推进 chunkIndex 并开始朗读下一个 chunk。
     */
    private void onDirectSpeakChunkDone(int gen) {
        if (speakGen != gen || isStopped || isPaused) return;

        // 上报进度
        directSpeakCharsDone = 0;
        for (int i = 0; i <= chunkIndex && i < chunks.size(); i++) {
            directSpeakCharsDone += chunks.get(i).length();
        }
        if (totalTextLength > 0) {
            Listener cb = listener;
            if (cb != null) cb.onProgress(directSpeakCharsDone, totalTextLength);
        }

        chunkIndex++;
        if (chunkIndex >= chunks.size()) {
            stopPositionBroadcast();
            notifyFinished();
            return;
        }

        // 更新位置并朗读下一个 chunk
        chunkStartPositionMs = calculateChunkStartPositionMs();
        ttsHandler.post(() -> {
            if (speakGen != gen || isStopped || isPaused) return;
            playDirectSpeakChunk();
        });
    }

    /** 开始每 50ms 向 JS 推送一次实际播放位置。重入安全。 */
    private void startPositionBroadcast() {
        if (positionRunnable != null) return; // 已在运行
        positionRunnable = () -> {
            if (isStopped || isPaused || positionRunnable == null) return;
            Listener cb = listener;
            if (cb != null) {
                long posMs   = getCurrentPositionMs();
                long totalMs = fullTotalDurationMs > 0 ? fullTotalDurationMs : getTotalDurationMs();
                int  charsDone = calculateCharsDone();
                cb.onPosition(posMs, totalMs, charsDone);
            }
            mainHandler.postDelayed(positionRunnable, 50);
        };
        mainHandler.postDelayed(positionRunnable, 50);
    }

    private void stopPositionBroadcast() {
        if (positionRunnable != null) {
            mainHandler.removeCallbacks(positionRunnable);
            positionRunnable = null;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // MediaPlayer — 播放已合成的 WAV 文件，通过 PlaybackParams 实现变速不变调
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * 用 MediaPlayer 播放指定临时文件（synthesizeToFile 的输出）。
     * 必须在 main thread 调用（MediaPlayer 回调默认投递到创建线程的 Looper）。
     *
     * ★ 复用策略：chunk 切换时 reset() 现有 MediaPlayer 而非 release()+new()，
     *   省去原生音频资源的释放与重新分配，显著缩短 chunk 间过渡时间。
     *
     * N+1 预生成流水线：播放开始后立即在 ttsHandler 提交 chunk+1 的合成任务。
     */
    @SuppressWarnings("NewApi")
    private void startMediaPlayer(File file, int gen) {
        if (speakGen != gen || isStopped || isPaused) {
            deleteTempFile(file);
            return;
        }
        if (!file.exists() || file.length() == 0) {
            // 文件不存在或为空（合成异常），跳过该 chunk
            onChunkPlaybackComplete(gen);
            return;
        }

        // ★ 复用 MediaPlayer：reset() 回到 Idle 状态，避免 release()+new() 的原生资源开销
        MediaPlayer mp = mediaPlayer;
        if (mp != null) {
            try {
                mp.reset(); // Playing/Completed/Error → Idle，保留原生解码器和音频输出
            } catch (Exception e) {
                android.util.Log.w("TTSFgSvc", "MediaPlayer reset failed, creating new", e);
                try { mp.release(); } catch (Exception ignored) {}
                mp = null;
            }
        }
        boolean reused = (mp != null);
        if (mp == null) {
            mp = new MediaPlayer();
        }
        final MediaPlayer finalMp = mp;
        try {
            if (!reused) {
                AudioAttributes attrs = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build();
                finalMp.setAudioAttributes(attrs);
            }
            finalMp.setDataSource(file.getAbsolutePath());
            long _beforePrep = System.currentTimeMillis();
            finalMp.prepare(); // 本地文件，同步 prepare() 快且安全
            long _prepMs = System.currentTimeMillis() - _beforePrep;
            // 缓存当前 chunk 的实际音频时长，供 calculateCharsDone() 精确插值
            // 比估算值（chunkLen/totalTextLength*fullTotalDurationMs）更准确，消除 TTS 语音疏密不均导致的漂移
            try { currentChunkActualDurationMs = finalMp.getDuration(); } catch (Exception e) { currentChunkActualDurationMs = 0; }

            // PlaybackParams：变速不变调（时间拉伸）；API 23+
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PlaybackParams pp = new PlaybackParams();
                pp.setSpeed(Math.max(0.1f, playRate));
                pp.setPitch(1.0f); // 固定音调，不随速度变化
                finalMp.setPlaybackParams(pp);
            }

            final File capturedFile = file;
            finalMp.setOnCompletionListener(completedMp -> {
                deleteTempFile(capturedFile);
                onChunkPlaybackComplete(gen);
            });
            finalMp.setOnErrorListener((errMp, what, extra) -> {
                android.util.Log.e("TTSFgSvc", "MediaPlayer error " + what + "/" + extra);
                deleteTempFile(capturedFile);
                onChunkPlaybackComplete(gen);
                return true;
            });

            mediaPlayer = finalMp;
            finalMp.start();

            android.util.Log.i("TTSFgSvc", "MediaPlayer: reused=" + reused
                    + ", prepareMs=" + _prepMs
                    + ", postPrepMs=" + (System.currentTimeMillis() - _beforePrep - _prepMs));
            emitLog("MediaPlayer: reused=" + reused + ", prepare=" + _prepMs + "ms");
            acquireWakeLock();
            updatePlaybackState(true);
            // 立即推送一次 chunk 起始位置，使 JS 高亮在 chunk 切换时即时更新，
            // 无需等待第一个定时器触发（尤其纲目短句场景下响应更及时）。
            Listener immediateCb = listener;
            if (immediateCb != null) {
                long posMs   = chunkStartPositionMs;
                long totalMs = fullTotalDurationMs > 0 ? fullTotalDurationMs : getTotalDurationMs();
                int  charsDone = calculateCharsDone();
                immediateCb.onPosition(posMs, totalMs, charsDone);
            }
            startPositionBroadcast();

            // N+1 预生成：播放期间提前合成下一 chunk，消除 chunk 间停顿
            final int prefetchIdx = chunkIndex + 1;
            ttsHandler.post(() -> {
                if (speakGen != gen || isStopped || isPaused) return;
                if (prefetchIdx < chunks.size() && synthForChunk != prefetchIdx) {
                    doSynthesizeChunk(prefetchIdx);
                }
            });

        } catch (Exception e) {
            android.util.Log.e("TTSFgSvc", "MediaPlayer start failed", e);
            try { finalMp.release(); } catch (Exception ignored) {}
            if (mediaPlayer == finalMp) mediaPlayer = null;
            deleteTempFile(file);
            onChunkPlaybackComplete(gen);
        }
    }

    /**
     * 当前 chunk 播放完毕（由 OnCompletionListener / OnErrorListener 触发，main thread）。
     * 推进 chunkIndex，按预生成状态三路分发下一 chunk。
     * ★ 不在此处 releaseMediaPlayer()：MediaPlayer 由 startMediaPlayer() 复用（reset），
     *   避免 release+new 的原生资源开销，缩短 chunk 间过渡时间。
     */
    private void onChunkPlaybackComplete(int gen) {
        if (speakGen != gen || isStopped || isPaused) {
            deleteTempFile(nextTempFile);
            nextTempFile = null;
            return;
        }

        chunkIndex++;

        // 上报字符进度（播放完成后，位置精确）
        if (totalTextLength > 0) {
            int charsDone = 0;
            for (int i = 0; i < chunkIndex && i < chunks.size(); i++) charsDone += chunks.get(i).length();
            Listener cb = listener;
            if (cb != null) cb.onProgress(charsDone, totalTextLength);
        }

        if (chunkIndex >= chunks.size()) {
            deleteTempFile(nextTempFile);
            nextTempFile = null;
            notifyFinished();
            return;
        }

        // 更新 chunk 起始位置（用于进度跟踪）
        chunkStartPositionMs = calculateChunkStartPositionMs();

        // 三路分发：
        File prefetched = nextTempFile;
        nextTempFile = null;

        if (prefetched != null && prefetched.exists() && prefetched.length() > 0) {
            // ① 预生成文件已就绪 → 零间隙衔接播放
            startMediaPlayer(prefetched, gen);
        } else if (synthForChunk == chunkIndex) {
            // ② 预生成合成进行中（onDone 尚未触发）→ 等待 onDone 触发 startMediaPlayer
            deleteTempFile(prefetched); // 清理可能的空文件
            // onDone 会检测 chunkOfUid == chunkIndex 并调用 startMediaPlayer
        } else {
            // ③ 合成未启动（如刚从暂停恢复后首 chunk）→ 立即发起合成
            deleteTempFile(prefetched);
            ttsHandler.post(this::playChunkOnly);
        }
    }

    /** 安全释放 MediaPlayer（忽略所有异常）。 */
    private void releaseMediaPlayer() {
        MediaPlayer mp = mediaPlayer;
        mediaPlayer = null;
        if (mp != null) {
            try {
                if (mp.isPlaying()) mp.stop();
                mp.reset();
                mp.release();
            } catch (Exception ignored) {}
        }
    }

    /** 删除 cacheDir 下所有 tts_g*.wav 残留临时文件（stop/destroy 时调用）。 */
    private void cleanTempFiles() {
        try {
            File cacheDir = getCacheDir();
            File[] files = cacheDir.listFiles(
                    (dir, name) -> name.startsWith("tts_g") && name.endsWith(".wav"));
            if (files != null) {
                for (File f : files) //noinspection ResultOfMethodCallIgnored
                    f.delete();
            }
        } catch (Exception ignored) {}
    }

    /**
     * 删除旧 generation 的临时文件，保留指定的 gen 文件（可能是预合成结果）。
     * 在 handleSpeak() 中替代 cleanTempFiles()，避免误删预合成 WAV。
     */
    private void cleanStaleTempFiles(int currentGen, int preGen) {
        try {
            File cacheDir = getCacheDir();
            File[] files = cacheDir.listFiles(
                    (dir, name) -> name.startsWith("tts_g") && name.endsWith(".wav"));
            if (files != null) {
                String keepPrefix1 = "tts_g" + currentGen + "_";
                String keepPrefix2 = "tts_g" + preGen + "_";
                for (File f : files) {
                    String name = f.getName();
                    if (!name.startsWith(keepPrefix1) && !name.startsWith(keepPrefix2)) {
                        //noinspection ResultOfMethodCallIgnored
                        f.delete();
                    }
                }
            }
        } catch (Exception ignored) {}
    }

    /** 删除单个临时文件（null 安全）。 */
    private static void deleteTempFile(File file) {
        if (file != null && file.exists()) {
            //noinspection ResultOfMethodCallIgnored
            file.delete();
        }
    }

    /** Extract generation from utteranceId "g<gen>_c<chunk>" */
    private static int parseGen(String uid) {
        if (uid == null || !uid.startsWith("g")) return -1;
        int sep = uid.indexOf('_');
        if (sep < 0) return -1;
        try { return Integer.parseInt(uid.substring(1, sep)); }
        catch (NumberFormatException e) { return -1; }
    }

    /** Extract chunk index from utteranceId "g<gen>_c<chunk>" */
    private static int parseChunk(String uid) {
        if (uid == null) return -1;
        int ci = uid.indexOf("_c");
        if (ci < 0) return -1;
        try { return Integer.parseInt(uid.substring(ci + 2)); }
        catch (NumberFormatException e) { return -1; }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Notification
    // ═══════════════════════════════════════════════════════════════════════

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID, "朗读", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("文章朗读播放控制");
            ch.setSound(null, null); // silent
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    private void updatePlaybackState(boolean playing) {
        if (mediaSession == null) return;
        int state = playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED;
        long posMs = getCurrentPositionMs();
        mediaSession.setPlaybackState(new PlaybackState.Builder()
            .setState(state, posMs, playing ? playRate : 0f)
            .setActions(PlaybackState.ACTION_PLAY_PAUSE |
                        PlaybackState.ACTION_PAUSE |
                        PlaybackState.ACTION_PLAY |
                        PlaybackState.ACTION_STOP)
            .build());
    }

    private void updateMediaMetadata() {
        if (mediaSession == null) return;
        // 优先使用 JS 传来的全文稿总时长；回退用切片估算
        long durationMs = fullTotalDurationMs > 0 ? fullTotalDurationMs : getTotalDurationMs();
        String displayTitle  = (playTitle  != null && !playTitle.isEmpty())  ? playTitle  : "晨读 · 朗读";
        String displayArtist = (playArtist != null && !playArtist.isEmpty()) ? playArtist : "";
        MediaMetadata.Builder meta = new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, displayTitle)
            .putLong(MediaMetadata.METADATA_KEY_DURATION, durationMs > 0 ? durationMs : -1);
        if (!displayArtist.isEmpty()) {
            meta.putString(MediaMetadata.METADATA_KEY_ARTIST, displayArtist);
        }
        if (appIconBitmap != null) {
            meta.putBitmap(MediaMetadata.METADATA_KEY_ART, appIconBitmap);
        }
        mediaSession.setMetadata(meta.build());
    }

    private long getCurrentPositionMs() {
        if (mediaPlayer != null) {
            try {
                // MediaPlayer.getCurrentPosition() 返回音频内容位置（ms，以 1x 速率为基准）。
                // 我们合成于 1.0f，再用 PlaybackParams 加速，所以内容位置 / 倍率 = 墙钟时间。
                long audioPosMs = mediaPlayer.getCurrentPosition();
                long wallPosMs = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
                        ? (long)(audioPosMs / Math.max(0.1f, playRate))
                        : audioPosMs; // API < 23 不支持 PlaybackParams，以 1x 播放
                return chunkStartPositionMs + wallPosMs;
            } catch (Exception ignored) {}
        }
        // 合成进行中（还没有 MediaPlayer）→ 返回 chunk 边界位置（静止）
        return chunkStartPositionMs;
    }

    private long getTotalDurationMs() {
        if (totalTextLength <= 0) return 0;
        return (long)(totalTextLength / (250.0f * Math.max(0.1f, playRate)) * 60 * 1000L);
    }

    private long calculateChunkStartPositionMs() {
        int cumChars = 0;
        for (int i = 0; i < chunkIndex && i < chunks.size(); i++) {
            cumChars += chunks.get(i).length();
        }
        // 必须与 startPositionBroadcast 报告给 JS 的 totalMs 使用同一基准：
        // totalMs = fullTotalDurationMs（JS 按原始全文估算的总时长）。
        // 若用 getTotalDurationMs()（按 safeText 长度），会比 fullTotalDurationMs 小，
        // 导致 posMs/totalMs 偏低，JS 暂停时保存的 _resumePercent 偏小，
        // 恢复时 Java targetChar 往前偏移，产生"往前跳好几分钟"的 bug。
        long totalMs = fullTotalDurationMs > 0 ? fullTotalDurationMs : getTotalDurationMs();
        if (totalTextLength <= 0 || totalMs <= 0) return sliceStartPositionMs;
        return sliceStartPositionMs + (long)((float) cumChars / totalTextLength * totalMs);
    }

    /**
     * 基于 MediaPlayer 实际播放位置，计算当前已完成的字符数。
     * 已完成 chunk 的字符 + 当前 chunk 内按播放进度插值的字符。
     * 由 startPositionBroadcast（每 50ms）调用，为 JS 高亮提供精确的实时字符进度。
     */
    private int calculateCharsDone() {
        if (totalTextLength <= 0) return 0;
        if (useSpeakDirect) {
            // speak 模式：没有 MediaPlayer，返回已完成 chunk 的累计字符数
            return Math.min(directSpeakCharsDone, totalTextLength);
        }
        int cumChars = 0;
        int ci = chunkIndex;
        for (int i = 0; i < ci && i < chunks.size(); i++) {
            cumChars += chunks.get(i).length();
        }
        if (mediaPlayer != null && ci >= 0 && ci < chunks.size()) {
            try {
                int chunkLen = chunks.get(ci).length();
                long audioPosMs = mediaPlayer.getCurrentPosition();
                // 优先使用 MediaPlayer 实际时长（消除 TTS 语音疏密不均导致的线性插值漂移），
                // 退而使用按字符比例估算的时长（currentChunkActualDurationMs 为 0 时的后备）
                long chunkDurationMs = currentChunkActualDurationMs > 0
                        ? currentChunkActualDurationMs
                        : (long)(chunkLen / (float) totalTextLength * fullTotalDurationMs);
                if (chunkDurationMs > 0) {
                    cumChars += (int)(audioPosMs / (float) chunkDurationMs * chunkLen);
                }
            } catch (Exception ignored) {}
        }
        return Math.min(cumChars, totalTextLength);
    }

    @SuppressWarnings("deprecation")
    private Notification buildNotification(boolean playing) {
        int piFlags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                ? PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
                : PendingIntent.FLAG_UPDATE_CURRENT;

        // Tap → open app
        Intent openApp = new Intent(this, MainActivity.class);
        openApp.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openPi = PendingIntent.getActivity(this, 0, openApp, piFlags);

        // Stop action
        Intent stopI = new Intent(this, TTSForegroundService.class).setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(this, 1, stopI, piFlags);

        // Play / Pause toggle
        String toggleAction = playing ? ACTION_PAUSE : ACTION_RESUME;
        String toggleLabel  = playing ? "暂停"       : "继续";
        int    toggleIcon   = playing
                ? android.R.drawable.ic_media_pause
                : android.R.drawable.ic_media_play;
        Intent toggleI = new Intent(this, TTSForegroundService.class).setAction(toggleAction);
        PendingIntent togglePi = PendingIntent.getService(this, 2, toggleI, piFlags);

        // 使用框架原生 Notification.Builder，配合 Notification.MediaStyle。
        // 国产 ROM（MIUI/EMUI/ColorOS）会检查通知是否带 MediaStyle + 有效 MediaSession token，
        // 有则将 App 归类为媒体播放器，显著降低后台杀死概率。
        // Notification.Builder + Notification.MediaStyle 均为框架内置 API（API 21+），无需额外依赖。
        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(this, CHANNEL_ID);
        } else {
            // API < 26：旧构造函数（deprecated in O, still works for API 22-25）
            builder = new Notification.Builder(this);
            builder.setSound(null); // 关闭声音
        }

        String notifTitle = (playTitle != null && !playTitle.isEmpty()) ? playTitle : "晨读 · 朗读";
        builder.setContentTitle(notifTitle)
               .setContentText(playing ? "正在朗读..." : "已暂停")
               .setSmallIcon(R.mipmap.ic_launcher)
               .setContentIntent(openPi)
               .setOngoing(true);
        if (appIconBitmap != null) {
            builder.setLargeIcon(appIconBitmap);
        }
        builder
               // 添加按钮：index 0=暂停/继续, index 1=停止
               .addAction(toggleIcon, toggleLabel, togglePi)
               .addAction(android.R.drawable.ic_delete, "停止", stopPi);

        // MediaStyle: 让通知带上媒体播放器标识。
        // setMediaSession(token) 是国产 ROM 识别媒体手机应用的关键依据。
        Notification.MediaStyle style = new Notification.MediaStyle()
                .setShowActionsInCompactView(0, 1); // 紧凑视图显示按钮 0(暂停/继续) 和 1(停止)
        if (mediaSession != null) {
            style.setMediaSession(mediaSession.getSessionToken());
        }
        builder.setStyle(style);

        return builder.build();
    }

    private void updateNotification(boolean playing) {
        updatePlaybackState(playing);
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(NOTIF_ID, buildNotification(playing));
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Audio Focus
    // ═══════════════════════════════════════════════════════════════════════

    private boolean requestAudioFocus() {
        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        if (audioManager == null) return true;

        audioFocusListener = change -> {
            if (change == AudioManager.AUDIOFOCUS_LOSS) {
                // 永久失焦（接电话、另一媒体 App 接管）→ 系统自动暂停
                // 不调 handlePause()（会把 pausedByUser 设为 true），改用专用方法
                handleFocusLossPause();
            } else if (change == AudioManager.AUDIOFOCUS_GAIN) {
                // 焦点归还 → 仅当是系统失焦导致的暂停才自动恢复；用户手动暂停不恢复
                if (isPaused && !pausedByUser) handleResume();
            }
            // AUDIOFOCUS_LOSS_TRANSIENT / AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
            // 临时失焦（通知音、切换 App 时系统 UI 音等），继续播放不暂停
        };

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build();
            audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(attrs)
                    .setOnAudioFocusChangeListener(audioFocusListener)
                    .build();
            return audioManager.requestAudioFocus(audioFocusRequest)
                    == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        } else {
            //noinspection deprecation
            return audioManager.requestAudioFocus(
                    audioFocusListener,
                    AudioManager.STREAM_MUSIC,
                    AudioManager.AUDIOFOCUS_GAIN
            ) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        }
    }

    private void abandonAudioFocus() {
        if (audioManager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioFocusRequest != null) {
            audioManager.abandonAudioFocusRequest(audioFocusRequest);
        } else if (audioFocusListener != null) {
            //noinspection deprecation
            audioManager.abandonAudioFocus(audioFocusListener);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // WakeLock
    // ═══════════════════════════════════════════════════════════════════════

    private void acquireWakeLock() {
        if (wakeLock != null && !wakeLock.isHeld()) {
            wakeLock.acquire(2 * 60 * 60 * 1000L); // 2-hour safety ceiling
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Completion
    // ═══════════════════════════════════════════════════════════════════════

    private void notifyFinished() {
        // 原生循环：直接在 Java 侧重置并重播，完全绕开 JS 往返，息屏后也不受影响
        if (loopEnabled && !isStopped) {
            chunkIndex           = 0;
            chunkStartPositionMs = 0;
            currentChunkActualDurationMs = 0;
            sliceStartPositionMs = 0;
            speakGen++;
            // 重置流水线状态（循环重头，上一轮的预生成文件不再有效）
            synthForChunk = -1;
            deleteTempFile(nextTempFile);
            nextTempFile = null;
            updateNotification(true);
            final int gen = speakGen;
            ttsHandler.postDelayed(() -> {
                if (speakGen != gen || isStopped || isPaused) return;
                playChunkOnly();
            }, 50);
            return;
        }
        finishPlayback();
        Listener cb = listener;
        if (cb != null) cb.onFinished();
    }

    private void notifyError(String msg) {
        finishPlayback();
        Listener cb = listener;
        if (cb != null) cb.onError(msg);
    }

    @SuppressWarnings("deprecation")
    private void finishPlayback() {
        stopPositionBroadcast();
        // 不在此处释放 WakeLock 和 AudioFocus：循环播放时 JS 会在 300ms 内发出新的
        // speak()，若提前放弃焦点，其他 App 可能抢占且不再归还，导致下一轮无声；
        // 提前释放 WakeLock 则省电 ROM 可能在宽限期内挂起 CPU。
        // handleStop() / onDestroy() 才真正释放两者。
        // 更新通知为暂停/结束状态（保持前台 Service，避免 OEM 在宽限期内杀进程）
        updateNotification(false);
        // 不立即销毁 Service：延迟 2 秒宽限期，允许循环播放直接复用现有 TTS 实例。
        // 若 2 秒内收到新的 speak()，cancelPendingStop() 会取消销毁并继续播放。
        // 若无新请求（非循环场景），2 秒后真正停止。
        schedulePendingStop();
    }

    /** 安排 2 秒后延迟销毁 Service（用于自然播放结束后的宽限期）。 */
    private void schedulePendingStop() {
        cancelPendingStop();
        _pendingStop = new Runnable() {
            @Override public void run() {
                _pendingStop = null;
                // 非循环场景：宽限期满，此时真正释放音频焦点和 WakeLock。
                releaseWakeLock();
                abandonAudioFocus();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    stopForeground(STOP_FOREGROUND_REMOVE);
                } else {
                    //noinspection deprecation
                    stopForeground(true);
                }
                stopSelf();
            }
        };
        mainHandler.postDelayed(_pendingStop, 2000);
    }

    /** 取消挂起的延迟停止（循环播放收到新 speak() 时调用）。 */
    private void cancelPendingStop() {
        if (_pendingStop != null) {
            mainHandler.removeCallbacks(_pendingStop);
            _pendingStop = null;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Text splitting
    // ═══════════════════════════════════════════════════════════════════════

    private static List<String> splitText(String text, int maxLen) {
        List<String> result = new ArrayList<>();
        if (text == null || text.isEmpty()) return result;

        // Split on sentence-ending punctuation, keeping the delimiter at the end
        String[] segs = text.split("(?<=[。！？；…\n])");
        StringBuilder cur = new StringBuilder();
        for (String seg : segs) {
            if (cur.length() + seg.length() <= maxLen) {
                cur.append(seg);
            } else {
                if (cur.length() > 0) result.add(cur.toString());
                if (seg.length() > maxLen) {
                    // Force-cut oversized segment
                    for (int i = 0; i < seg.length(); i += maxLen) {
                        result.add(seg.substring(i, Math.min(i + maxLen, seg.length())));
                    }
                    cur = new StringBuilder();
                } else {
                    cur = new StringBuilder(seg);
                }
            }
        }
        if (cur.length() > 0) result.add(cur.toString());
        return result;
    }
}
