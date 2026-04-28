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
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

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

    // ── Callback interface (set by NativeTTSPlugin) ───────────────────────
    public interface Listener {
        void onFinished();
        void onError(String message);
        /** Called after each chunk completes; charsDone / totalChars gives accurate progress. */
        void onProgress(int charsDone, int totalChars);
        /** Called every ~500 ms while playing; posMs/totalMs are absolute positions in full text. */
        default void onPosition(long posMs, long totalMs) {}
    }
    public static volatile Listener listener = null;

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

    // ── Playback State ────────────────────────────────────────────────────
    private final List<String>  chunks     = new ArrayList<>();
    private volatile int        chunkIndex = 0;
    private volatile boolean    isPaused     = false;
    private volatile boolean    pausedByUser = false; // true=用户手动暂停，false=系统失焦自动暂停
    private volatile boolean    isStopped  = false;
    private volatile int        speakGen   = 0;   // generation counter for stale-callback guard
    private float               playRate   = 1.0f;
    private String              playLang   = "zh-CN";
    private int                 totalTextLength = 0; // set in handleSpeak; used for progress
    private long                chunkStartPositionMs = 0; // 当前 chunk 开始时的媒体位置（ms）
    private long                chunkStartTimeMs     = 0; // 当前 chunk 开始时的系统时钟（ms）
    private long                sliceStartPositionMs  = 0; // seek 点偏移，从 JS 传入的 startSecs * 1000
    private long                fullTotalDurationMs   = 0; // 全文稿总时长，从 JS 的 totalSecs * 1000
    private Voice               pinnedVoice          = null; // 锁定声音，避免 chunk 间换声
    private String              playTitle            = "";  // 锁屏/通知栏标题（篇章）
    private String              playArtist           = "";  // 锁屏/通知栏副标题（训练名）
    private Bitmap              appIconBitmap        = null; // APP 图标，缓存避免重复解码

    // 定期向 JS 推送播放位置，保持 APP 内进度条与 MediaSession 同步
    private volatile Runnable   positionRunnable     = null;
    // 自然播放结束后延迟销毁 Service 的 Runnable；循环播放时在宽限期内取消，避免 TTS 反复初始化
    private volatile Runnable   _pendingStop         = null;

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

    /** 初始化 TTS 引擎，失败时最多自动重试 MAX_TTS_RETRIES 次。 */
    private void initTts() {
        ttsInitFailed = false;
        tts = new TextToSpeech(this, status -> {
            if (status == TextToSpeech.SUCCESS) {
                ttsInitRetries = 0;
                ttsReady = true;
                ttsInitFailed = false;
                // 初始化完成后立即枚举 voices，避免首次 speak 时再走 setLanguage() 随机选声音
                pinnedVoice = pickBestVoice(playLang);
                // 仅在确认初始化成功后才设置 UtteranceProgressListener，
                // 避免在 retry 过程中对已作废的 tts 实例设置监听器。
                TextToSpeech ready = tts;
                if (ready != null) {
                    ready.setOnUtteranceProgressListener(buildUtteranceListener());
                }
                // If a speak request arrived before init completed, start now
                if (!chunks.isEmpty() && !isStopped && !isPaused) {
                    setTtsParams(); // first-time init: set language + rate before first chunk
                    playChunkOnly();
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
                        if (!isStopped) initTts();
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
                // Engine accepted and started synthesising — no action needed
            }

            @Override
            public void onDone(String utteranceId) {
                // Guard against stale callbacks from a previous speak() call
                int gen = parseGen(utteranceId);
                if (gen != speakGen || isStopped || isPaused) return;

                chunkIndex++;

                // 上报字符进度，让 JS 侧用实际完成比例重新校准进度条（消除时间估算漂移）
                if (totalTextLength > 0) {
                    int charsDone = 0;
                    for (int i = 0; i < chunkIndex; i++) charsDone += chunks.get(i).length();
                    Listener cb = listener;
                    if (cb != null) cb.onProgress(charsDone, totalTextLength);
                }

                // 通过专用播放线程（ttsHandler）派发下一块。
                final int capturedGen = gen;
                ttsHandler.post(() -> {
                    if (speakGen != capturedGen || isStopped || isPaused) return;
                    if (chunkIndex < chunks.size()) {
                        playChunkOnly();
                    } else {
                        notifyFinished();
                    }
                });
            }

            @Override
            @SuppressWarnings("deprecation")
            public void onError(String utteranceId) {
                int gen = parseGen(utteranceId);
                if (gen != speakGen || isStopped) return;
                chunkIndex++;
                final int capturedGen = gen;
                ttsHandler.post(() -> {
                    if (speakGen != capturedGen || isStopped) return;
                    if (chunkIndex < chunks.size()) {
                        playChunkOnly();
                    } else {
                        notifyFinished();
                    }
                });
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

        switch (intent.getAction()) {
            case ACTION_SPEAK:    handleSpeak(intent);   break;
            case ACTION_STOP:     handleStop();           break;
            case ACTION_PAUSE:    handlePause();          break;
            case ACTION_RESUME:   handleResume();         break;
            case ACTION_SET_RATE: handleSetRate(intent);  break;
        }
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onDestroy() {
        // 先设标志位（volatile），让后台 UtteranceProgressListener 回调看到后立即返回，
        // 防止它在 tts.shutdown() 之后还调用 tts.speak() 引发 NPE / crash
        isStopped = true;
        ttsReady  = false;
        if (mainHandler != null) mainHandler.removeCallbacksAndMessages(null);
        if (ttsHandler  != null) ttsHandler.removeCallbacksAndMessages(null);
        positionRunnable  = null; // removeCallbacksAndMessages 已移除所有 pending callbacks
        if (ttsHandlerThread != null) { ttsHandlerThread.quitSafely(); ttsHandlerThread = null; }
        releaseWakeLock();
        abandonAudioFocus();
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
            mediaSession = null;
        }
        TextToSpeech t = tts;
        tts = null; // volatile: 后台线程再次访问时看到 null
        if (t != null) {
            t.stop();
            t.shutdown();
        }
        super.onDestroy();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Action handlers
    // ═══════════════════════════════════════════════════════════════════════

    private void handleSpeak(Intent intent) {
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
        sliceStartPositionMs = (long)(intent.getFloatExtra("startSecs", 0f) * 1000L);
        fullTotalDurationMs  = (long)(intent.getFloatExtra("totalSecs", 0f) * 1000L);

        // startForeground() 已在 onStartCommand() 最顶部统一调用，此处更新通知为播放状态。
        updateNotification(true);

        if (text == null || text.trim().isEmpty()) {
            notifyError("文本为空");
            return;
        }

        // Reset state
        isStopped    = false;
        isPaused     = false;
        pausedByUser = false;
        chunkIndex   = 0;
        chunkStartPositionMs = 0;
        chunkStartTimeMs     = 0;
        pinnedVoice          = pickBestVoice(playLang); // 枚举一次，后续 chunk 直接 setVoice()
        speakGen++;
        chunks.clear();
        chunks.addAll(splitText(text, CHUNK_SIZE));
        totalTextLength = text.length();
        updateMediaMetadata(); // 让锁屏/通知栏知道标题和总时长

        if (!requestAudioFocus()) {
            // 音频焦点申请被拒（OxygenOS/MIUI 省电策略等），降级继续播放。
            // TTS 引擎不强依赖焦点，绝大多数情况下仍可正常发声；
            // 拒绝报错反而让用户完全无法使用，降级比报错更合理。
            android.util.Log.w("TTSFgSvc", "requestAudioFocus failed, continuing anyway");
        }

        acquireWakeLock();
        updatePlaybackState(true);

        if (ttsReady) {
            // 先显式 stop()，等引擎音频缓冲完全排空（200ms）再 speak()。
            // tts.stop() 只停止引擎继续合成，但硬件缓冲区中已有的音频仍会播放约 100~200ms；
            // 若延迟太短，旧音频与新音频重叠会产生「两个声音」效果。
            TextToSpeech t = tts;
            if (t != null) t.stop();
            final int gen = speakGen;
            ttsHandler.postDelayed(() -> {
                if (speakGen != gen || isStopped) return;
                setTtsParams();  // 应用最新 playRate 和语言（引擎已空闲，不会触发 onError）
                playChunkOnly();
            }, 200);
        } else if (ttsInitFailed) {
            // 上次全部重试均失败，用户再次点播放时允许重新初始化。
            android.util.Log.w("TTSFgSvc", "Re-attempting TTS init after previous failure");
            ttsInitRetries = 0;
            ttsInitFailed = false;
            initTts();
            // chunks 已设置好，initTts 成功后的回调里会自动调用 playChunkOnly()
        }
        // else: TTS 仍在初始化中，OnInitListener 成功时会自动调用 setTtsParams()+playChunkOnly
    }

    private void handleSetRate(Intent intent) {
        float newRate = intent.getFloatExtra("rate", playRate);
        playRate = newRate;
        if (!ttsReady || tts == null) return;

        if (isPaused) {
            // 已暂停时引擎空闲，直接设倍率即可；恢复播放时自动使用新倍率
            tts.setSpeechRate(playRate);
            updatePlaybackState(false); // ★ 通知 MediaSession 采用新倍率（即使暂停也需更新）
            return;
        }
        if (isStopped) return;

        // 正在播放：先 stop()，等引擎完全空闲（150ms）再用新倍率重播当前 chunk。
        // 若在引擎活跃时直接调 setSpeechRate()，三星/讯飞会触发隐式 stop → onError
        // → chunkIndex 被意外递增，导致跳块或静音。
        speakGen++;
        final int gen = speakGen;
        tts.stop();
        updatePlaybackState(true); // ★ 立即刷新，锁屏进度条用新倍率推进（不等 150ms 延迟）
        ttsHandler.postDelayed(() -> {
            if (speakGen != gen || isStopped || isPaused) return;
            setTtsParams();  // 引擎已空闲，setSpeechRate() 不会触发 onError
            playChunkOnly(); // 从当前 chunkIndex 重播，立即听到新倍率
        }, 150);
    }

    private void handleStop() {
        isStopped    = true;
        isPaused     = false;
        pausedByUser = false;
        speakGen++;
        cancelPendingStop();
        stopPositionBroadcast();
        if (tts != null) tts.stop();
        releaseWakeLock();
        abandonAudioFocus();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
        stopSelf();
    }

    private void handlePause() {
        if (isPaused || isStopped) return;
        cancelPendingStop();
        pausedByUser = true; // 用户主动暂停（按钮/锁屏控件），焦点归还后不自动恢复
        isPaused = true;
        speakGen++;       // invalidate in-flight onDone callbacks
        stopPositionBroadcast();

        if (tts != null) tts.stop();
        // 冻结进度位置：让锁屏进度条在暂停时显示正确位置
        chunkStartPositionMs = getCurrentPositionMs();
        chunkStartTimeMs     = 0;
        updateNotification(false);
    }

    private void handleResume() {
        if (!isPaused || isStopped) return;
        cancelPendingStop();
        isPaused     = false;
        pausedByUser = false;
        speakGen++;
        updateNotification(true);
        ttsHandler.post(this::playChunkOnly); // 用 ttsHandler，避免息屏时主线程节流
    }

    /**
     * 系统失焦导致的自动暂停（如接电话、其他媒体 App 接管音频焦点）。
     * 不设置 pausedByUser，焦点归还后（AUDIOFOCUS_GAIN）可自动恢复；
     * 区别于 handlePause()（用户手动操作，焦点归还后不应自动恢复）。
     */
    private void handleFocusLossPause() {
        if (isPaused || isStopped) return; // 已暂停（用户手动或其他原因），不覆盖状态
        pausedByUser = false; // 系统自动暂停
        isPaused = true;
        speakGen++;
        stopPositionBroadcast();
        if (tts != null) tts.stop();
        chunkStartPositionMs = getCurrentPositionMs();
        chunkStartTimeMs     = 0;
        updateNotification(false);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TTS core
    // ═══════════════════════════════════════════════════════════════════════

    private void setTtsParams() {
        if (pinnedVoice != null) {
            // 使用预先枚举好的 voice，完全跳过 setLanguage()。
            tts.setVoice(pinnedVoice);
        } else {
            // 兜底：pickBestVoice() 枚举失败（引擎未就绪或无离线包）时退回 setLanguage()
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
        }
        tts.setSpeechRate(playRate);
    }

    /** 枚举 TTS voice 列表，返回匹配语言的最高质量离线 voice；失败返回 null。 */
    private Voice pickBestVoice(String lang) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) return null;
        Locale target;
        try { target = Locale.forLanguageTag(lang); } catch (Exception e) { target = Locale.CHINA; }
        String targetLang = target.getLanguage();
        Voice best = null;
        try {
            Set<Voice> voices = tts.getVoices();
            if (voices == null) return null;
            for (Voice v : voices) {
                if (v.isNetworkConnectionRequired()) continue;
                if (!targetLang.equals(v.getLocale().getLanguage())) continue;
                if (best == null || v.getQuality() > best.getQuality()) best = v;
            }
        } catch (Exception ignored) {}
        return best;
    }

    /** Speak current chunk (rate already set by handleSpeak; called from delayed callback or onDone). */
    private void playChunkOnly() {
        if (!ttsReady || isStopped || isPaused) return;
        acquireWakeLock(); // 确保息屏期间 WakeLock 始终持有（超时或释放后续自动续期）
        TextToSpeech t = tts;
        if (t == null) return; // onDestroy 已经把 tts 清空
        if (chunkIndex >= chunks.size()) {
            notifyFinished();
            return;
        }
        String text = chunks.get(chunkIndex);
        String uid  = "g" + speakGen + "_c" + chunkIndex;
        int ret = doSpeak(t, text, uid);
        if (ret == TextToSpeech.ERROR && pinnedVoice != null) {
            // setVoice() 被引擎拒绝（常见于 Samsung/讯飞 stop() 后）。
            // 清除 pinnedVoice，退回 setLanguage() 再试一次。
            pinnedVoice = null;
            setTtsParams(); // 内部走 setLanguage() 分支
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                try { pinnedVoice = tts.getVoice(); } catch (Exception ignored) {}
            }
            ret = doSpeak(t, text, uid);
        }
        if (ret == TextToSpeech.ERROR) {
            // 引擎彻底拒绝，跳过该 chunk 继续播放
            final int gen = speakGen;
            ttsHandler.post(() -> {
                if (speakGen != gen || isStopped) return;
                chunkIndex++;
                if (chunkIndex < chunks.size()) playChunkOnly();
                else notifyFinished();
            });
            return;
        }
        chunkStartPositionMs = calculateChunkStartPositionMs();
        chunkStartTimeMs = System.currentTimeMillis();
        updatePlaybackState(true); // 刷新锁屏进度
        startPositionBroadcast(); // 开始定期向 JS 推送位置
    }

    /** 调用 tts.speak()。返回 TextToSpeech.SUCCESS 或 ERROR。 */
    private int doSpeak(TextToSpeech t, String text, String uid) {
        return t.speak(text, TextToSpeech.QUEUE_FLUSH, null, uid);
    }

    /** 开始每 500ms 向 JS 推送一次实际播放位置。重入安全。 */
    private void startPositionBroadcast() {
        if (positionRunnable != null) return; // 已在运行
        positionRunnable = () -> {
            if (isStopped || isPaused || positionRunnable == null) return;
            Listener cb = listener;
            if (cb != null) {
                long posMs   = getCurrentPositionMs();
                long totalMs = fullTotalDurationMs > 0 ? fullTotalDurationMs : getTotalDurationMs();
                cb.onPosition(posMs, totalMs);
            }
            mainHandler.postDelayed(positionRunnable, 500);
        };
        mainHandler.postDelayed(positionRunnable, 500);
    }

    private void stopPositionBroadcast() {
        if (positionRunnable != null) {
            mainHandler.removeCallbacks(positionRunnable);
            positionRunnable = null;
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
        if (chunkStartTimeMs == 0) return chunkStartPositionMs;
        return chunkStartPositionMs + (System.currentTimeMillis() - chunkStartTimeMs);
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
        long sliceMs = getTotalDurationMs(); // 切片自身时长
        if (totalTextLength <= 0 || sliceMs <= 0) return sliceStartPositionMs;
        return sliceStartPositionMs + (long)((float) cumChars / totalTextLength * sliceMs);
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
