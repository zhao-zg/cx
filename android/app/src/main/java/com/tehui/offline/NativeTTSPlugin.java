package com.tehui.offline;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * NativeTTSPlugin — Capacitor plugin bridge for TTSForegroundService.
 *
 * JS API:
 *   NativeTTS.speak({ text, lang?, rate? })  → Promise (resolves when speech ends)
 *   NativeTTS.stop()                         → Promise<void>
 *   NativeTTS.pause()                        → Promise<void>
 *   NativeTTS.resume()                       → Promise<void>
 */
@CapacitorPlugin(name = "NativeTTS")
public class NativeTTSPlugin extends Plugin {

    // Keep alive the pending speak() call until service finishes
    private PluginCall activeCall = null;

    // ── speak ─────────────────────────────────────────────────────────────

    @PluginMethod(returnType = PluginMethod.RETURN_PROMISE)
    public void speak(PluginCall call) {
        String text       = call.getString("text", "");
        String lang       = call.getString("lang", "zh-CN");
        float  rate       = call.getFloat("rate", 1.0f);
        String title      = call.getString("title", "");
        String artist     = call.getString("artist", "");
        float  startSecs  = call.getFloat("startSecs", 0f);
        float  totalSecs  = call.getFloat("totalSecs", 0f);
        boolean loop      = Boolean.TRUE.equals(call.getBoolean("loop", false));

        if (text == null || text.trim().isEmpty()) {
            call.reject("文本为空");
            return;
        }

        // Cancel any in-flight speak() and clear the service's old callback
        cancelActiveCall("cancelled");

        // Keep Capacitor from releasing this call before TTS finishes
        call.setKeepAlive(true);
        activeCall = call;
        saveCall(call);

        // Register service → plugin callback
        TTSForegroundService.listener = new TTSForegroundService.Listener() {
            @Override
            public void onFinished() {
                resolveActiveCall("finished");
            }

            @Override
            public void onError(String message) {
                rejectActiveCall(message);
            }

            @Override
            public void onProgress(int charsDone, int totalChars) {
                try {
                    JSObject data = new JSObject();
                    data.put("done", charsDone);
                    data.put("total", totalChars);
                    notifyListeners("ttsProgress", data);
                } catch (Exception ignored) {}
            }

            @Override
            public void onPosition(long posMs, long totalMs, int charsDone) {
                try {
                    JSObject data = new JSObject();
                    data.put("posMs",   posMs);
                    data.put("totalMs", totalMs);
                    data.put("done",    charsDone);
                    notifyListeners("ttsPosition", data);
                } catch (Exception ignored) {}
            }

            @Override
            public void onLog(String msg) {
                try {
                    JSObject data = new JSObject();
                    data.put("msg", msg);
                    notifyListeners("ttsLog", data);
                } catch (Exception ignored) {}
            }
        };

        // Start the Foreground Service
        Intent intent = new Intent(getContext(), TTSForegroundService.class);
        intent.setAction(TTSForegroundService.ACTION_SPEAK);
        intent.putExtra("text",       text);
        intent.putExtra("lang",       lang);
        intent.putExtra("rate",       rate);
        intent.putExtra("title",      title);
        intent.putExtra("artist",     artist);
        intent.putExtra("startSecs",  startSecs);
        intent.putExtra("totalSecs",  totalSecs);
        intent.putExtra("loop",       loop);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }
    }

    // ── stop ──────────────────────────────────────────────────────────────

    @PluginMethod
    public void stop(PluginCall call) {
        cancelActiveCall("stopped");
        // ★ 不立即置 null listener：旧 listener 的 onFinished 可能被
        //    handleStop 触发，但 resolveActiveCall 会 null-check activeCall，
        //    双调 resolve 安全（Capacitor 忽略已 resolved 的 call）。
        //    preSynthesize 随后会覆盖此 listener，handleStop 不依赖它。
        // ★ 设置 onServiceStopped 回调：handleStop 完成引擎清理后，
        //    会通知 JS "ttsStopped" 事件，JS 收到后再安全启动 preSynthesize。
        TTSForegroundService.onServiceStopped = () -> {
            JSObject data = new JSObject();
            notifyListeners("ttsStopped", data);
        };
        sendServiceAction(TTSForegroundService.ACTION_STOP);
        call.resolve();
    }

    // ── pause ─────────────────────────────────────────────────────────────

    @PluginMethod
    public void pause(PluginCall call) {
        sendServiceAction(TTSForegroundService.ACTION_PAUSE);
        call.resolve();
    }

    // ── resume ────────────────────────────────────────────────────────────

    @PluginMethod
    public void resume(PluginCall call) {
        sendServiceAction(TTSForegroundService.ACTION_RESUME);
        call.resolve();
    }

    // ── warmup ────────────────────────────────────────────────────────────
    // 页面加载时提前启动 Service 并初始化 TTS 引擎，使后续 preSynthesize/play 零延迟。

    @PluginMethod
    public void warmup(PluginCall call) {
        call.resolve(); // fire-and-forget
        Intent intent = new Intent(getContext(), TTSForegroundService.class);
        intent.setAction(TTSForegroundService.ACTION_WARMUP);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }
    }

    // ── preSynthesize ─────────────────────────────────────────────────────
    // 页面加载时预合成首 chunk 的 WAV 文件，加速用户点击播放时的响应。
    // 不播放音频，不保持 PluginCall（fire-and-forget）。

    @PluginMethod
    public void preSynthesize(PluginCall call) {
        String text   = call.getString("text", "");
        String lang   = call.getString("lang", "zh-CN");
        float  rate   = call.getFloat("rate", 1.0f);
        String title  = call.getString("title", "");
        String artist = call.getString("artist", "");

        call.resolve(); // 立即返回，不等待合成完成

        if (text == null || text.trim().isEmpty()) return;

        // 设置诊断 listener：使 handlePreSpeak 的 emitLog 能转发到 JS 控制台。
        // speak() 调用时会覆盖此 listener，不影响正常流程。
        TTSForegroundService.listener = new TTSForegroundService.Listener() {
            @Override public void onFinished() {}
            @Override public void onError(String message) {}
            @Override public void onProgress(int charsDone, int totalChars) {}
            @Override public void onLog(String msg) {
                try {
                    JSObject data = new JSObject();
                    data.put("msg", msg);
                    notifyListeners("ttsLog", data);
                } catch (Exception ignored) {}
            }
        };

        Intent intent = new Intent(getContext(), TTSForegroundService.class);
        intent.setAction(TTSForegroundService.ACTION_PRE_SPEAK);
        intent.putExtra("text",   text);
        intent.putExtra("lang",   lang);
        intent.putExtra("rate",   rate);
        intent.putExtra("title",  title);
        intent.putExtra("artist", artist);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }
    }

    // ── setRate ───────────────────────────────────────────────────────────
    // 仅更新 TTS 引擎倍率，不中断/重启播放。避免 stop()+speak() 竞态。

    @PluginMethod
    public void setRate(PluginCall call) {
        float rate = call.getFloat("rate", 1.0f);
        Intent intent = new Intent(getContext(), TTSForegroundService.class);
        intent.setAction(TTSForegroundService.ACTION_SET_RATE);
        intent.putExtra("rate", rate);
        getContext().startService(intent);
        call.resolve();
    }
    // ── 电池优化 ────────────────────────────────────────────────────────────────────────
    // 是否已免除电池优化（已加入北采白名单）

    @PluginMethod
    public void isBatteryOptimizationIgnored(PluginCall call) {
        boolean ignored = true; // Android M 以下默认不受限
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                ignored = pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
            }
        }
        JSObject result = new JSObject();
        result.put("ignored", ignored);
        call.resolve(result);
    }

    /**
     * 弹出系统电池优化排除对话框。
     * 当前已在白名单中则什么都不做。
     * 需要 AndroidManifest.xml 中声明 REQUEST_IGNORE_BATTERY_OPTIMIZATIONS 权限。
     */
    @PluginMethod
    public void requestIgnoreBatteryOptimization(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            if (pm != null && !pm.isIgnoringBatteryOptimizations(getContext().getPackageName())) {
                try {
                    Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                    getActivity().startActivity(intent);
                } catch (Exception e) {
                    // 部分 ROM 不支持该 Intent，回退到应用详情页，引导用户手动设置
                    try {
                        Intent fallbackIntent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                        fallbackIntent.setData(Uri.parse("package:" + getContext().getPackageName()));
                        getActivity().startActivity(fallbackIntent);
                    } catch (Exception ignored2) {}
                }
            }
        }
        call.resolve();
    }
    // ── checkEngine ──────────────────────────────────────────────────────
    // 检查 TTS 引擎是否可用，返回引擎状态和设备信息。
    // JS 端可用于诊断华为/鸿蒙设备兼容性问题。

    @PluginMethod
    public void checkEngine(PluginCall call) {
        JSObject result = new JSObject();

        // 设备信息
        result.put("manufacturer", Build.MANUFACTURER);
        result.put("brand",        Build.BRAND);
        result.put("model",        Build.MODEL);
        result.put("sdkVersion",   Build.VERSION.SDK_INT);
        result.put("isHarmony",    TTSForegroundService.isHarmonyDevice());

        // TTS 引擎状态
        boolean ttsReady = TTSForegroundService.sStaticTtsReady;
        result.put("ttsReady", ttsReady);

        // 检查 Web Speech API 的可用性（让 JS 知道是否有降级方案）
        // 这是 Android 端，无法直接检测 Web Speech，但可以提供 TTS 引擎名
        String engineName = "";
        try {
            if (TTSForegroundService.sStaticTts != null) {
                engineName = TTSForegroundService.sStaticTts.getDefaultEngine();
            }
        } catch (Exception ignored) {}
        result.put("engineName", engineName != null ? engineName : "");

        call.resolve(result);
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    private void sendServiceAction(String action) {
        Intent intent = new Intent(getContext(), TTSForegroundService.class);
        intent.setAction(action);
        getContext().startService(intent);
    }

    private void cancelActiveCall(String status) {
        PluginCall c = activeCall;
        activeCall = null;
        if (c != null) {
            try {
                c.resolve(new JSObject().put("status", status));
                c.setKeepAlive(false);
                getBridge().releaseCall(c);
            } catch (Exception ignored) {}
        }
    }

    private void resolveActiveCall(String status) {
        TTSForegroundService.listener = null;
        PluginCall c = activeCall;
        activeCall = null;
        if (c != null) {
            try {
                c.resolve(new JSObject().put("status", status));
                c.setKeepAlive(false);
                getBridge().releaseCall(c);
            } catch (Exception ignored) {}
        }
    }

    private void rejectActiveCall(String message) {
        TTSForegroundService.listener = null;
        PluginCall c = activeCall;
        activeCall = null;
        if (c != null) {
            try {
                c.reject(message);
                c.setKeepAlive(false);
                getBridge().releaseCall(c);
            } catch (Exception ignored) {}
        }
    }
}
