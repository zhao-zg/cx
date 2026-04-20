package com.tehui.offline;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 重要：必须在 super.onCreate() 之前注册插件！
        registerPlugin(ApkInstallerPlugin.class);
        registerPlugin(ImageSaverPlugin.class);
        registerPlugin(NativeTTSPlugin.class);
        super.onCreate(savedInstanceState);
        
        // 设置状态栏颜色
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            Window window = getWindow();
            // 关键：禁用 edge-to-edge 模式，让状态栏独占空间，WebView 从下方开始
            // Capacitor 6 + Android SDK 34 默认 edge-to-edge（WebView 延伸到状态栏背后）
            // 不加这行：系统把状态栏图标叠在 WebView 层上合成 → 视觉模糊
            // PWA 里 Chrome 自动做了这一步，所以 PWA 清晰而 APK 模糊
            WindowCompat.setDecorFitsSystemWindows(window, true);
            window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            window.setStatusBarColor(0xFFF0F3F9); // #f0f3f9 冷色主题底色（与 themeMetaColors.cool 保持一致）
            
            // 设置状态栏图标为深色（适用于浅色背景）
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                View decorView = window.getDecorView();
                int flags = decorView.getSystemUiVisibility();
                flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                decorView.setSystemUiVisibility(flags);
            }
        }
    }
}
