package com.tehui.offline;

import android.graphics.fonts.Font;
import android.graphics.fonts.FontStyle;
import android.graphics.fonts.SystemFonts;
import android.os.Build;
import android.util.TypedValue;
import android.webkit.WebSettings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * SystemFontPlugin — 字体诊断探针（实验功能）。
 *
 * 背景：用户在鸿蒙主题里设置的自定义系统字体只对原生控件生效，
 * WebView(Chromium) 用自己的字体配置解析 CSS 泛型（sans-serif 等），
 * 主题字体通常不注册进去，因此「跟随系统」拿不到主题字体。
 *
 * 本探针把原生侧能看到的所有字体信息吐给 JS，用于判断可行注入路径：
 *   1. resolvedFontFamily —— 主题属性 android.R.attr.fontFamily 解析出的默认族名
 *      （若 ROM 把主题字体注册成可解析族名，可直接用于注入）；
 *   2. systemFonts —— API 29+ 系统字体注册表（含运行时字体更新；主题字体若走
 *      FontManager 更新机制会出现在这里，附文件路径/大小/字重/可读性）；
 *   3. themeDirs —— 常见主题字体目录扫描（华为/小米/通用路径，exists/readable/条目）；
 *   4. webFontFamilies —— WebView 当前默认字体族设置。
 *
 * JS 调用：
 *   Capacitor.Plugins.SystemFont.getDiagnostics() → Promise<JSON 如上>
 *   Capacitor.Plugins.SystemFont.setWebFontFamilies({ family }) → 把 WebView
 *   standard/sans-serif 默认族指向指定族名（第二阶段实验：族名可被 Chromium
 *   解析时，正文「跟随系统」即吃到该字体；serif 泛型不动，宋体栈不受影响）。
 */
@CapacitorPlugin(name = "SystemFont")
public class SystemFontPlugin extends Plugin {

    @PluginMethod
    public void getDiagnostics(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("apiLevel", Build.VERSION.SDK_INT);
        ret.put("release", Build.VERSION.RELEASE == null ? "" : Build.VERSION.RELEASE);
        ret.put("manufacturer", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER);
        ret.put("model", Build.MODEL == null ? "" : Build.MODEL);

        // 1) 当前主题 fontFamily 属性解析（原生控件实际使用的默认族；stock 通常 "sans-serif"）
        String family;
        try {
            TypedValue tv = new TypedValue();
            if (getContext().getTheme().resolveAttribute(android.R.attr.fontFamily, tv, true)
                    && tv.string != null) {
                family = tv.string.toString();
            } else {
                family = "(unresolved)";
            }
        } catch (Throwable t) {
            family = "ERR:" + t.getClass().getSimpleName();
        }
        ret.put("resolvedFontFamily", family);

        // 2) WebView 当前默认字体族设置
        try {
            WebSettings ws = getBridge() != null && getBridge().getWebView() != null
                    ? getBridge().getWebView().getSettings() : null;
            JSObject web = new JSObject();
            web.put("standard", ws != null ? ws.getStandardFontFamily() : null);
            web.put("sansSerif", ws != null ? ws.getSansSerifFontFamily() : null);
            web.put("serif", ws != null ? ws.getSerifFontFamily() : null);
            web.put("fixed", ws != null ? ws.getFixedFontFamily() : null);
            ret.put("webFontFamilies", web);
        } catch (Throwable t) {
            ret.put("webFontFamiliesError", String.valueOf(t));
        }

        // 3) API 29+：系统字体注册表（含运行时更新）
        JSArray fonts = new JSArray();
        int count = 0;
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                for (Font f : SystemFonts.getAvailableFonts()) {
                    if (count >= 500) break;
                    JSObject o = new JSObject();
                    File file = f.getFile();
                    o.put("file", file == null ? "" : file.getAbsolutePath());
                    o.put("kb", file == null ? 0 : file.length() / 1024);
                    o.put("w", f.getStyle().getWeight());
                    o.put("it", f.getStyle().getSlant() == FontStyle.FONT_SLANT_ITALIC ? 1 : 0);
                    o.put("rd", file != null && file.canRead());
                    fonts.put(o);
                    count++;
                }
            }
        } catch (Throwable t) {
            ret.put("systemFontsError", String.valueOf(t));
        }
        ret.put("systemFontCount", count);
        ret.put("systemFonts", fonts);

        // 4) 常见主题字体目录扫描
        JSArray cand = new JSArray();
        String[] paths = {
                "/data/system/theme/fonts", "/data/system/theme", "/data/system/fonts",
                "/data/fonts", "/system/fonts",
                "/storage/emulated/0/.HWThemes", "/storage/emulated/0/MIUI/theme/fonts",
                "/storage/emulated/0/Fonts", "/storage/emulated/0/fonts"
        };
        for (String p : paths) {
            JSObject o = new JSObject();
            o.put("path", p);
            File dir = new File(p);
            o.put("exists", dir.exists());
            o.put("readable", dir.canRead());
            JSArray names = new JSArray();
            if (dir.canRead()) {
                File[] list = dir.listFiles();
                if (list != null) {
                    for (int i = 0; i < list.length && i < 40; i++) {
                        names.put(list[i].getName() + (list[i].isDirectory() ? "/" : ""));
                    }
                    o.put("n", list.length);
                }
            }
            o.put("entries", names);
            cand.put(o);
        }
        ret.put("themeDirs", cand);

        call.resolve(ret);
    }

    /**
     * 第二阶段实验接口：把 WebView 默认字体族（standard + sans-serif 泛型）指向指定族名。
     * 若该族名可被 Chromium 解析（存在于其字体枚举），CSS 里落到 sans-serif 的
     * 「跟随系统」即渲染为该字体；serif 泛型保持不动，宋体/楷体栈不受影响。
     */
    @PluginMethod
    public void setWebFontFamilies(PluginCall call) {
        String family = call.getString("family");
        if (family == null || family.trim().isEmpty()) {
            call.reject("family required");
            return;
        }
        try {
            WebSettings ws = getBridge().getWebView().getSettings();
            ws.setStandardFontFamily(family);
            ws.setSansSerifFontFamily(family);
            JSObject ret = new JSObject();
            ret.put("standard", ws.getStandardFontFamily());
            ret.put("sansSerif", ws.getSansSerifFontFamily());
            call.resolve(ret);
        } catch (Throwable t) {
            call.reject("ERR:" + t.getClass().getSimpleName() + ":" + t.getMessage());
        }
    }
}
