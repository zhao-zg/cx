package com.tehui.offline;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String PREFS_NAME = "cx_apk_prefs";
    private static final String KEY_LAST_APK_VERSION = "last_apk_version";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 最早安装崩溃日志收集器（在 super.onCreate 前），覆盖尽可能多的异常
        Thread.setDefaultUncaughtExceptionHandler(new CrashReporter(this));

        // 重要：必须在 super.onCreate() 之前注册插件！
        registerPlugin(ApkInstallerPlugin.class);
        registerPlugin(ImageSaverPlugin.class);
        registerPlugin(NativeTTSPlugin.class);
        registerPlugin(CrashLogPlugin.class);

        // ★ 在 super.onCreate 之前预热 TTS 引擎，尽早绑定系统 TTS 服务。
        //   Service 启动时 initTts() 会复用此实例，不再重复绑定。
        TTSForegroundService.prewarmTts(this);

        // ★ APK 升级检测：版本变化时清除 WebView 缓存，防止加载旧缓存页面
        clearWebViewCacheOnUpgrade();

        super.onCreate(savedInstanceState);

        // 启动加载页统一由 HTML #cxSplash 处理（APP / PWA 共用）

        // ── 修复后台切回黑屏 ──────────────────────────────────────────
        // 1. WebView 背景色设为白色，防止渲染表面被回收后重建时出现黑屏
        WebView webView = bridge != null ? bridge.getWebView() : null;
        if (webView != null) {
            webView.setBackgroundColor(Color.WHITE);
            // 保持硬件加速层，避免后台回来时重新创建 GPU 表面
            webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        }
        // 2. 窗口 DecorView 也设白色背景，防止 Window 层面出现黑帧
        getWindow().getDecorView().setBackgroundColor(Color.WHITE);

        // 设置状态栏颜色
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            Window window = getWindow();
            // 1. 禁用 edge-to-edge：状态栏占独立空间，WebView 从下方开始
            //    不加这行：Capacitor 6 + targetSdk 34 默认让 WebView 延伸到状态栏背后
            //    WebView 内容（蓝紫 header）透过状态栏合成 → 等同 PWA 里 Chrome 的处理
            WindowCompat.setDecorFitsSystemWindows(window, true);
            // 2. 清除半透明标志（某些主题会预设），确保 setStatusBarColor 生效
            window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
            window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            // 3. 纯白底色：亮度 243/255，与 PWA manifest theme_color #f6f7fb (247/255) 一致
            window.setStatusBarColor(0xFFF0F3F9);
            // 4. 深色图标（时间/电池）：黑色图标 on 近白色背景 → 最高对比度
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                View decorView = window.getDecorView();
                int flags = decorView.getSystemUiVisibility();
                flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                decorView.setSystemUiVisibility(flags);
            }
        }
    }

    @Override
    public void onResume() {
        // 先恢复 WebView 定时器（BridgeActivity.onResume 内部也会调用，这里确保提前触发）
        WebView webView = bridge != null ? bridge.getWebView() : null;
        if (webView != null) {
            webView.resumeTimers();
        }
        super.onResume();
    }

    @Override
    public void onPause() {
        // 仅调用 super.onPause()，不额外冻结 WebView
        // BridgeActivity 内部会暂停定时器，但 WebView 渲染表面保持存活
        super.onPause();
    }

    /**
     * APK 升级时清除 WebView 缓存。
     *
     * Android WebView 有内核级 HTTP 磁盘缓存，APK 覆盖安装后旧缓存仍存在，
     * 会导致 WebView 加载到旧版 index.html / JS / CSS 而非 APK 内置的新文件。
     * 在 super.onCreate() 之前调用，确保 WebView 初始化前缓存已清空。
     */
    private void clearWebViewCacheOnUpgrade() {
        try {
            String currentVersion = getPackageManager()
                .getPackageInfo(getPackageName(), 0).versionName;
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String lastVersion = prefs.getString(KEY_LAST_APK_VERSION, "");

            if (!currentVersion.equals(lastVersion)) {
                // 版本变化：仅清除 WebView HTTP 缓存（磁盘缓存），
                // 不清 localStorage/IndexedDB（用户笔记数据在那里）
                WebView webView = new WebView(this);
                webView.clearCache(true);   // true = 清除磁盘缓存文件
                webView.clearFormData();
                webView.destroy();

                prefs.edit().putString(KEY_LAST_APK_VERSION, currentVersion).apply();
            }
        } catch (Exception e) {
            // 降级：版本检测失败时不清除缓存，避免每次启动都清
        }
    }
}
