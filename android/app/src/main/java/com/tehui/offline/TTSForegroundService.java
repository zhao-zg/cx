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
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import androidx.core.app.NotificationCompat;

import java.util.ArrayList;
import java.util.HashMap;
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

    // ── Callback interface (set by NativeTTSPlugin) ───────────────────────
    public interface Listener {
        void onFinished();
        void onError(String message);
        /** Called after each chunk completes; charsDone / totalChars gives accurate progress. */
        void onProgress(int charsDone, int totalChars);
    }
    public static volatile Listener listener = null;

    // ── Constants ─────────────────────────────────────────────────────────
    private static final String CHANNEL_ID = "cx_tts_channel";
    private static final int    NOTIF_ID   = 8001;
    private static final int    CHUNK_SIZE = 500; // chars per chunk

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

    // ── System Resources ──────────────────────────────────────────────────
    private AudioManager                          audioManager;
    private AudioFocusRequest                     audioFocusRequest; // API 26+
    private AudioManager.OnAudioFocusChangeListener audioFocusListener;
    private PowerManager.WakeLock                 wakeLock;

    // ═══════════════════════════════════════════════════════════════════════
    // Lifecycle
    // ═══════════════════════════════════════════════════════════════════════

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();

        // WakeLock: prevents Android from throttling CPU / deferring callbacks
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "CX:TTSWakeLock");
        }

        // Initialize Android native TextToSpeech engine
        tts = new TextToSpeech(this, status -> {
            if (status == TextToSpeech.SUCCESS) {
                ttsReady = true;
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
            public void onStart(String utteranceId) { /* nothing */ }

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

                if (chunkIndex < chunks.size()) {
                    playChunkOnly(); // params already set; don't re-call setTtsParams()
                } else {
                    notifyFinished();
                }
            }

            @Override
            @SuppressWarnings("deprecation")
            public void onError(String utteranceId) {
                int gen = parseGen(utteranceId);
                if (gen != speakGen || isStopped) return;
                // Skip failed chunk, continue
                chunkIndex++;
                if (chunkIndex < chunks.size()) {
                    playChunkOnly();
                } else {
                    notifyFinished();
                }
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
        releaseWakeLock();
        abandonAudioFocus();
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
        String text = intent.getStringExtra("text");
        String lang = intent.getStringExtra("lang");
        if (lang != null && !lang.isEmpty()) playLang = lang;
        playRate = intent.getFloatExtra("rate", 1.0f);

        if (text == null || text.trim().isEmpty()) {
            notifyError("文本为空");
            return;
        }

        // Reset state
        isStopped  = false;
        isPaused   = false;
        chunkIndex = 0;
        speakGen++;
        chunks.clear();
        chunks.addAll(splitText(text, CHUNK_SIZE));
        totalTextLength = text.length();

        if (!requestAudioFocus()) {
            notifyError("无法获取音频焦点");
            return;
        }

        acquireWakeLock();

        // Start foreground with notification
        Notification notif = buildNotification(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIF_ID, notif);
        }

        // 直接用 QUEUE_FLUSH 跳转到新片段。
        // 不调用 stop() 和 setSpeechRate()：在三星/讯飞引擎上它们会触发内部竞态导致
        // speak() 静默无响应。倍率变化通过独立的 ACTION_SET_RATE 处理。
        if (ttsReady) {
            playChunkOnly();
        }
        // else: TTS.OnInitListener will call setTtsParams()+playChunkOnly when ready
    }

    private void handleSetRate(Intent intent) {
        float newRate = intent.getFloatExtra("rate", playRate);
        playRate = newRate;
        TextToSpeech t = tts;
        if (t != null && ttsReady) {
            // 直接调用 setSpeechRate()；即使引擎内部中断当前 utterance，
            // onError 处理器会自动用新倍率播放下一块。
            t.setSpeechRate(playRate);
        }
    }

    private void handleStop() {
        isStopped = true;
        isPaused  = false;
        speakGen++;
        if (tts != null) tts.stop();
        finishPlayback();
    }

    private void handlePause() {
        if (isPaused || isStopped) return;
        isPaused = true;
        speakGen++;       // invalidate in-flight onDone callbacks
        if (tts != null) tts.stop();
        updateNotification(false);
    }

    private void handleResume() {
        if (!isPaused || isStopped) return;
        isPaused = false;
        speakGen++;
        updateNotification(true);
        playChunkOnly(); // params already set during handleSpeak; no re-call needed
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TTS core
    // ═══════════════════════════════════════════════════════════════════════

    private void setTtsParams() {
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
        tts.setSpeechRate(playRate);
    }

    /** Speak current chunk (rate already set by handleSpeak; called from delayed callback or onDone). */
    private void playChunkOnly() {
        if (!ttsReady || isStopped || isPaused) return;
        TextToSpeech t = tts;
        if (t == null) return; // onDestroy 已经把 tts 清空
        if (chunkIndex >= chunks.size()) {
            notifyFinished();
            return;
        }
        String text = chunks.get(chunkIndex);
        String uid  = "g" + speakGen + "_c" + chunkIndex;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            t.speak(text, TextToSpeech.QUEUE_FLUSH, null, uid);
        } else {
            //noinspection deprecation
            HashMap<String, String> p = new HashMap<>();
            p.put(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, uid);
            //noinspection deprecation
            t.speak(text, TextToSpeech.QUEUE_FLUSH, p);
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

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("特会 · 朗读")
                .setContentText(playing ? "正在朗读..." : "已暂停")
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentIntent(openPi)
                .setOngoing(true)
                .setSilent(true)
                .addAction(toggleIcon, toggleLabel, togglePi)
                .addAction(android.R.drawable.ic_delete, "停止", stopPi)
                .build();
    }

    private void updateNotification(boolean playing) {
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
