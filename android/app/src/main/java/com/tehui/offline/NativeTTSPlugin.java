package com.tehui.offline;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Locale;

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
            public void onPosition(long posMs, long totalMs) {
                try {
                    JSObject data = new JSObject();
                    data.put("posMs",   posMs);
                    data.put("totalMs", totalMs);
                    notifyListeners("ttsPosition", data);
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
                    if (!openMiuiBatterySettings() && !openApplicationDetailsSettings()) {}
                }
            }
        }
        call.resolve();
    }
    // ── Helpers ───────────────────────────────────────────────────────────

    private void sendServiceAction(String action) {
        Intent intent = new Intent(getContext(), TTSForegroundService.class);
        intent.setAction(action);
        getContext().startService(intent);
    }

    private boolean openMiuiBatterySettings() {
        String manufacturer = Build.MANUFACTURER;
        if (manufacturer == null) {
            return false;
        }
        String vendor = manufacturer.toLowerCase(Locale.ROOT);
        if (!vendor.contains("xiaomi") && !vendor.contains("redmi") && !vendor.contains("poco")) {
            return false;
        }

        Intent hiddenAppsIntent = new Intent();
        hiddenAppsIntent.setComponent(new ComponentName(
            "com.miui.powerkeeper",
            "com.miui.powerkeeper.ui.HiddenAppsConfigActivity"
        ));
        hiddenAppsIntent.putExtra("package_name", getContext().getPackageName());
        hiddenAppsIntent.putExtra("package_label", getApplicationLabel());
        if (tryStartActivity(hiddenAppsIntent)) {
            return true;
        }

        Intent containerIntent = new Intent();
        containerIntent.setComponent(new ComponentName(
            "com.miui.powerkeeper",
            "com.miui.powerkeeper.ui.HiddenAppsContainerManagementActivity"
        ));
        containerIntent.putExtra("package_name", getContext().getPackageName());
        containerIntent.putExtra("package_label", getApplicationLabel());
        return tryStartActivity(containerIntent);
    }

    private boolean openApplicationDetailsSettings() {
        Intent fallbackIntent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        fallbackIntent.setData(Uri.parse("package:" + getContext().getPackageName()));
        return tryStartActivity(fallbackIntent);
    }

    private boolean tryStartActivity(Intent intent) {
        try {
            getActivity().startActivity(intent);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private String getApplicationLabel() {
        try {
            PackageManager pm = getContext().getPackageManager();
            ApplicationInfo appInfo = getContext().getApplicationInfo();
            CharSequence label = pm.getApplicationLabel(appInfo);
            return label != null ? label.toString() : getContext().getPackageName();
        } catch (Exception ignored) {
            return getContext().getPackageName();
        }
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
