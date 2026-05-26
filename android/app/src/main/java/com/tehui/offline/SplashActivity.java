package com.tehui.offline;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.os.Handler;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.Window;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * 启动加载页：显示经文后跳转 MainActivity。
 * 与 HTML #cxSplash 内容一致，覆盖 WebView 渲染前的空白期。
 */
public class SplashActivity extends Activity {

    private static final String VERSE_REF  = "诗篇 119:148";
    private static final String VERSE_TEXT = "我趁夜更未换，将眼睁开，\n为要默想你的话语。";
    private static final int    SPLASH_MS  = 1400;

    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);

        // 根布局
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(Color.parseColor("#fafbff"));
        root.setPadding(dp(40), 0, dp(40), 0);

        // 经文引用
        TextView ref = new TextView(this);
        ref.setText(VERSE_REF);
        ref.setTextColor(Color.parseColor("#007aff"));
        ref.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        ref.setTypeface(Typeface.DEFAULT_BOLD);
        ref.setLetterSpacing(0.08f);
        ref.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams refLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        refLp.setMargins(0, 0, 0, dp(10));
        ref.setLayoutParams(refLp);

        // 经文正文
        TextView verse = new TextView(this);
        verse.setText(VERSE_TEXT);
        verse.setTextColor(Color.parseColor("#1a1a1a"));
        verse.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        verse.setGravity(Gravity.CENTER);
        verse.setLineSpacing(dp(6), 1.0f);
        verse.setTypeface(Typeface.DEFAULT);

        root.addView(ref);
        root.addView(verse);
        setContentView(root);

        new Handler().postDelayed(new Runnable() {
            @Override
            public void run() {
                finish();
                overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out);
            }
        }, SPLASH_MS);
    }

    @Override
    public void onBackPressed() {
        finish();
    }
}
