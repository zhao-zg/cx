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
}
