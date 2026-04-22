package com.tehui.offline;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
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
import java.util.HashMap;
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
    public static final String ACTION_SEEK_TO  = "com.tehui.tts.SEEK_TO";  // 拖动进度条 seek

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
    private static final String CHANNEL_ID          = "cx_tts_channel";
    private static final int    NOTIF_ID            = 8001;
    private static final int    CHUNK_SIZE          = 500;   // chars per chunk
    /** speak() 调用后，若 onStart 在此时限内未触发，视为引擎将任务吞掉，立即重试。 */
    private static final long   SPEAK_START_TIMEOUT = 5_000L;
    /** 同一 chunk 允许的最大重试次数，超限跳块，避免死循环。 */
    private static final int    MAX_CHUNK_RETRIES   = 3;

    // ── TTS ───────────────────────────────────────────────────────────────
    private volatile TextToSpeech tts;  // volatile: 后台线程(UtteranceProgressListener)需要可见性
    private volatile boolean      ttsReady  = false;

    // ── Playback State ────────────────────────────────────────────────────
    private final List<String>  chunks     = new ArrayList<>();
    private volatile int        chunkIndex = 0;
    private volatile boolean    isPaused   = false;
    private volatile boolean    isStopped  = false;
    private volatile int        speakGen   = 0;   // generation counter for stale-callback guard
    private float               playRate   = 1.0f;
    private String              playLang   = "zh-CN";
    private int                 totalTextLength = 0; // set in handleSpeak; used for progress
    private long                chunkStartPositionMs = 0; // 当前 chunk 开始时的媒体位置（ms）
    private long                chunkStartTimeMs     = 0; // 当前 chunk 开始时的系统时钟（ms）
    private long                sliceStartPositionMs  = 0; // seek 点偏移，从 JS 传入的 startSecs * 1000
    private long                fullTotalDurationMs   = 0; // 全文稿总时长，从 JS 的 totalSecs * 1000
    private long                pendingSeekPositionMs = -1; // seek 目标绝对位置；-1 表示无 pending seek
    private Voice               pinnedVoice          = null; // 锁定声音，避免 chunk 间换声
    private String              playTitle            = "";  // 锁屏/通知栏标题（篇章）
    private String              playArtist           = "";  // 锁屏/通知栏副标题（训练名）

    // 定期向 JS 推送播放位置，保持 APP 内进度条与 MediaSession 同步
    private Runnable            positionRunnable     = null;
    // speak-start 超时看门狗：speak() 后若 onStart 迟迟不来，则重试当前 chunk
    private Runnable            speakStartRunnable   = null;
    private volatile int        chunkRetryCount      = 0;   // 当前 chunk 的重试计数

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

        // Callback: 处理锁屏/通知栏媒体控件的点击事件（播放/暂停/停止/拖动进度条）
        mediaSession.setCallback(new MediaSession.Callback() {
            @Override public void onPlay()            { mainHandler.post(() -> handleResume()); }
            @Override public void onPause()           { mainHandler.post(() -> handlePause()); }
            @Override public void onStop()            { mainHandler.post(() -> handleStop()); }
            @Override public void onSeekTo(long posMs){ mainHandler.post(() -> handleSeekTo(posMs)); }
        });
        tts = new TextToSpeech(this, status -> {
            if (status == TextToSpeech.SUCCESS) {
                ttsReady = true;
                // 初始化完成后立即枚举 voices，避免首次 speak 时再走 setLanguage() 随机选声音
                pinnedVoice = pickBestVoice(playLang);
                // If a speak request arrived before init completed, start now
                if (!chunks.isEmpty() && !isStopped && !isPaused) {
                    setTtsParams(); // first-time init: set language + rate before first chunk
                    playChunkOnly();
                }
            } else {
                notifyError("TTS 初始化失败");
            }
        });

        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override
            public void onStart(String utteranceId) {
                // 引擎成功接受任务并开始合成 → 取消 speak-start 超时看门狗
                cancelSpeakStart();
            }

            @Override
            public void onDone(String utteranceId) {
                cancelSpeakStart(); // 确保超时被取消（onStart 可能被某些 ROM 跳过）
                // Guard against stale callbacks from a previous speak() call
                int gen = parseGen(utteranceId);
                if (gen != speakGen || isStopped || isPaused) return;

                chunkRetryCount = 0; // chunk 正常完成，重置重试计数
                chunkIndex++;

                // 上报字符进度，让 JS 侧用实际完成比例重新校准进度条（消除时间估算漂移）
                if (totalTextLength > 0) {
                    int charsDone = 0;
                    for (int i = 0; i < chunkIndex; i++) charsDone += chunks.get(i).length();
                    Listener cb = listener;
                    if (cb != null) cb.onProgress(charsDone, totalTextLength);
                }

                // 通过专用播放线程（ttsHandler）派发下一块。
                // onDone 在 TTS binder 线程；不能直接调 speak()（灰屏时引擎挂起）；
                // 主线程（mainHandler）息屏后被 Doze 节流，会导致 chunk 间停顿至亮屏；
                // ttsHandler（THREAD_PRIORITY_AUDIO + WakeLock）不受 Doze 影响。
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
                cancelSpeakStart(); // 确保超时被取消
                int gen = parseGen(utteranceId);
                if (gen != speakGen || isStopped) return;
                chunkRetryCount = 0;
                // Skip failed chunk, continue
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
        });
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || intent.getAction() == null) return START_NOT_STICKY;

        switch (intent.getAction()) {
            case ACTION_SPEAK:    handleSpeak(intent);   break;
            case ACTION_STOP:     handleStop();           break;
            case ACTION_PAUSE:    handlePause();          break;
            case ACTION_RESUME:   handleResume();         break;
            case ACTION_SET_RATE: handleSetRate(intent);  break;
            case ACTION_SEEK_TO:  handleSeekTo(intent.getLongExtra("posMs", 0)); break;
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
        speakStartRunnable = null;
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

        if (text == null || text.trim().isEmpty()) {
            notifyError("文本为空");
            return;
        }

        // Reset state
        isStopped  = false;
        isPaused   = false;
        chunkIndex = 0;
        chunkStartPositionMs = 0;
        chunkStartTimeMs     = 0;
        pinnedVoice          = pickBestVoice(playLang); // 枚举一次，后续 chunk 直接 setVoice()
        speakGen++;
        chunks.clear();
        chunks.addAll(splitText(text, CHUNK_SIZE));
        totalTextLength = text.length();
        updateMediaMetadata(); // 让锁屏/通知栏知道标题和总时长

        if (!requestAudioFocus()) {
            notifyError("无法获取音频焦点");
            return;
        }

        acquireWakeLock();

        // Start foreground with notification
        updatePlaybackState(true);
        Notification notif = buildNotification(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIF_ID, notif);
        }

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
        }
        // else: TTS.OnInitListener will call setTtsParams()+playChunkOnly when ready
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
        cancelSpeakStart();
        updatePlaybackState(true); // ★ 立即刷新，锁屏进度条用新倍率推进（不等 150ms 延迟）
        ttsHandler.postDelayed(() -> {
            if (speakGen != gen || isStopped || isPaused) return;
            setTtsParams();  // 引擎已空闲，setSpeechRate() 不会触发 onError
            playChunkOnly(); // 从当前 chunkIndex 重播，立即听到新倍率
        }, 150);
    }

    private void handleStop() {
        isStopped = true;
        isPaused  = false;
        speakGen++;
        stopPositionBroadcast();
        cancelSpeakStart();
        if (tts != null) tts.stop();
        finishPlayback();
    }

    private void handlePause() {
        if (isPaused || isStopped) return;
        isPaused = true;
        speakGen++;       // invalidate in-flight onDone callbacks
        stopPositionBroadcast();
        cancelSpeakStart();
        if (tts != null) tts.stop();
        // 冻结进度位置：让锁屏进度条在暂停时显示正确位置
        chunkStartPositionMs = getCurrentPositionMs();
        chunkStartTimeMs     = 0;
        updateNotification(false);
    }

    private void handleResume() {
        if (!isPaused || isStopped) return;
        isPaused = false;
        speakGen++;
        updateNotification(true);
        ttsHandler.post(this::playChunkOnly); // 用 ttsHandler，避免息屏时主线程节流
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
        // seek 后优先使用精确目标位置，否则按字符比例估算块起始位置
        if (pendingSeekPositionMs >= 0) {
            chunkStartPositionMs  = pendingSeekPositionMs;
            pendingSeekPositionMs = -1;
        } else {
            chunkStartPositionMs = calculateChunkStartPositionMs();
        }
        chunkStartTimeMs = System.currentTimeMillis();
        updatePlaybackState(true); // 刷新锁屏进度
        startPositionBroadcast(); // 开始定期向 JS 推送位置
        scheduleSpeakStart(text); // 注册 speak-start 超时看门狗
    }

    /** 调用 tts.speak()，封装了 API 21 前后的两种方式。返回 TextToSpeech.SUCCESS 或 ERROR。 */
    @SuppressWarnings("deprecation")
    private int doSpeak(TextToSpeech t, String text, String uid) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            return t.speak(text, TextToSpeech.QUEUE_FLUSH, null, uid);
        }
        HashMap<String, String> p = new HashMap<>();
        p.put(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, uid);
        return t.speak(text, TextToSpeech.QUEUE_FLUSH, p);
    }

    /** 开始每 500ms 向 JS 推送一次实际播放位置。重入安全。 */
    private void startPositionBroadcast() {
        if (positionRunnable != null) return; // 已在运行
        positionRunnable = new Runnable() {
            @Override public void run() {
                if (isStopped || isPaused || positionRunnable == null) return;
                Listener cb = listener;
                if (cb != null) {
                    long posMs   = getCurrentPositionMs();
                    long totalMs = fullTotalDurationMs > 0 ? fullTotalDurationMs : getTotalDurationMs();
                    cb.onPosition(posMs, totalMs);
                }
                mainHandler.postDelayed(this, 500);
            }
        };
        mainHandler.postDelayed(positionRunnable, 500);
    }

    private void stopPositionBroadcast() {
        if (positionRunnable != null) {
            mainHandler.removeCallbacks(positionRunnable);
            positionRunnable = null;
        }
    }

    /**
     * speak-start 超时看门狗：speak() 调用后，若 onStart 在 SPEAK_START_TIMEOUT 内未触发，
     * 说明 TTS 引擎被 ROM 节流或挂起、将本次任务静默丢弃。
     * - 重试次数 < MAX_CHUNK_RETRIES：重新 speak 当前 chunk（重建引擎参数）
     * - 超限：跳到下一 chunk，避免死循环
     * 运行在 ttsHandler（THREAD_PRIORITY_AUDIO），不受 Doze 主线程节流影响。
     */
    private void scheduleSpeakStart(String chunkText) {
        cancelSpeakStart();
        if (chunkText == null || chunkText.isEmpty()) return;
        final int gen        = speakGen;
        final int chunkIdx   = chunkIndex;
        speakStartRunnable = () -> {
            if (isStopped || isPaused || speakGen != gen) return;
            // speak() 被引擎静默吞掉
            TextToSpeech t = tts;
            if (t != null) t.stop();
            if (chunkRetryCount < MAX_CHUNK_RETRIES) {
                // 重试当前 chunk：递增 speakGen 让旧回调失效，重建引擎参数
                chunkRetryCount++;
                speakGen++;
                final int newGen = speakGen;
                ttsHandler.postDelayed(() -> {
                    if (speakGen != newGen || isStopped || isPaused) return;
                    setTtsParams();
                    playChunkOnly();
                }, 300);
            } else {
                // 重试耗尽，跳块
                chunkRetryCount = 0;
                chunkIndex++;
                speakGen++;
                final int newGen = speakGen;
                ttsHandler.postDelayed(() -> {
                    if (speakGen != newGen || isStopped || isPaused) return;
                    if (chunkIndex < chunks.size()) {
                        setTtsParams();
                        playChunkOnly();
                    } else {
                        notifyFinished();
                    }
                }, 300);
            }
        };
        ttsHandler.postDelayed(speakStartRunnable, SPEAK_START_TIMEOUT);
    }

    private void cancelSpeakStart() {
        if (speakStartRunnable != null) {
            ttsHandler.removeCallbacks(speakStartRunnable);
            speakStartRunnable = null;
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
                        PlaybackState.ACTION_STOP |
                        PlaybackState.ACTION_SEEK_TO)
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

    private void handleSeekTo(long posMs) {
        // posMs 是全文坐标（按 MediaMetadata 里的 fullTotalDurationMs）。
        // 先转换到切片内的相对位置，再映射到 chunkIndex。
        long sliceMs = getTotalDurationMs();
        if (sliceMs <= 0 || chunks.isEmpty()) return;
        long slicePos = posMs - sliceStartPositionMs;        // 全文坐标 → 切片坐标
        slicePos = Math.max(0, Math.min(sliceMs, slicePos)); // 钳位到切片范围
        float fraction = (float) slicePos / sliceMs;
        int targetChar = (int)(fraction * totalTextLength);
        int cumLen = 0;
        int targetChunk = chunks.size() - 1;
        for (int i = 0; i < chunks.size(); i++) {
            if (cumLen + chunks.get(i).length() > targetChar) { targetChunk = i; break; }
            cumLen += chunks.get(i).length();
        }
        chunkIndex      = targetChunk;
        chunkRetryCount = 0;
        isStopped = false;
        isPaused  = false;
        // ★ 冻结位置到 seek 目标：playChunkOnly 优先使用此值，让锁屏进度条立即跳到新位置，
        //   避免等待 200ms 延迟 + calculateChunkStartPositionMs() 字符估算带来的偏差。
        pendingSeekPositionMs = posMs;
        chunkStartPositionMs  = posMs;
        chunkStartTimeMs      = 0;
        speakGen++;
        cancelSpeakStart();
        updatePlaybackState(true); // ★ 立即通知 MediaSession 新位置
        final int gen = speakGen;
        TextToSpeech t = tts;
        if (t != null) t.stop();
        ttsHandler.postDelayed(() -> {
            if (speakGen != gen || isStopped) return;
            setTtsParams();
            playChunkOnly();
        }, 200);
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
               .setSmallIcon(android.R.drawable.ic_media_play)
               .setContentIntent(openPi)
               .setOngoing(true)
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
                // 永久失焦（接电话、另一媒体 App 接管）→ 暂停
                handlePause();
            } else if (change == AudioManager.AUDIOFOCUS_GAIN) {
                // 焦点归还 → 若之前因永久失焦而暂停则恢复
                if (isPaused) handleResume();
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
        releaseWakeLock();
        abandonAudioFocus();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
        stopSelf();
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
