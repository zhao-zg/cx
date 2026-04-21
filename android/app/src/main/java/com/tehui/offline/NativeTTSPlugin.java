package com.tehui.offline;

import android.content.Intent;
import android.os.Build;
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
        float  startSecs  = call.getFloat("startSecs", 0f);
        float  totalSecs  = call.getFloat("totalSecs", 0f);

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
        };

        // Start the Foreground Service
        Intent intent = new Intent(getContext(), TTSForegroundService.class);
        intent.setAction(TTSForegroundService.ACTION_SPEAK);
        intent.putExtra("text",       text);
        intent.putExtra("lang",       lang);
        intent.putExtra("rate",       rate);
        intent.putExtra("title",      title);
        intent.putExtra("startSecs",  startSecs);
        intent.putExtra("totalSecs",  totalSecs);

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
        TTSForegroundService.listener = null;
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
