package com.tehui.offline;

import android.graphics.fonts.Font;
import android.graphics.fonts.FontStyle;
import android.graphics.fonts.SystemFonts;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.webkit.WebSettings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.util.LinkedHashSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * SystemFontPlugin — 系统字体探针 + WebView 字体族注入。
 *
 * 背景：用户在系统里设置的自定义主题字体只对原生控件生效，
 * WebView(Chromium) 用自己的字体配置解析 CSS 泛型（sans-serif 等），
 * 主题字体通常不注册进去，因此「跟随系统」拿不到主题字体。
 *
 * 能力：
 *   Capacitor.Plugins.SystemFont.getDiagnostics() → Promise<JSON>
 *     - resolvedFontFamily：主题属性 android.R.attr.fontFamily 解析出的默认族名
 *       （部分 ROM 如小米 HyperOS 解析不出，为 "(unresolved)"）；
 *     - webFontFamilies：WebView 当前默认字体族设置（主线程读取）；
 *     - userFonts：SystemFonts 注册表中位于非系统目录的字体（用户/运行时注册）；
 *     - fontConfig：系统字体配置 XML 的族名表 + 关键族文件映射
 *       （用户主题字体若注册进 fonts.xml，可从这里找到族名供注入）；
 *     - themeDirs：常见主题字体目录扫描。
 *   Capacitor.Plugins.SystemFont.setWebFontFamilies({ family, reload? }) →
 *     把 WebView standard/sans-serif 默认族指向指定族名（主线程执行）；
 *     reload=true 且页面已加载完成时延迟刷新一次以确保设置生效（每次启动至多一次）。
 *
 * 注意：所有 WebView 方法必须主线程调用，此前在 CapacitorPlugins 线程直接调用
 * 会抛 "WebView method was called on thread 'CapacitorPlugins'" 导致注入失败。
 */
@CapacitorPlugin(name = "SystemFont")
public class SystemFontPlugin extends Plugin {

    /** 字体配置 XML 中 family/alias 的 name 属性提取 */
    private static final Pattern FAMILY_NAME_RE =
            Pattern.compile("<(?:family|alias)\\b[^>]*\\bname\\s*=\\s*\"([^\"]+)\"");
    /** <font> 元素文本中的字体文件名（相对 /system/fonts 或绝对路径） */
    private static final Pattern FONT_FILE_RE =
            Pattern.compile("<font\\b[^>]*>\\s*([^<>\"\\s]+\\.(?:ttf|otf|ttc))\\s*<");

    /** 本进程内已为字体注入执行过的 reload 次数（防止 reload 循环） */
    private boolean mReloadedForInjection = false;

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

        // 2) API 29+：系统字体注册表摘要。
        //    全量 500 条会把诊断 JSON 撑爆（用户复制被截断），改为：
        //    仅统计总数 + 提取位于非系统目录的"用户/运行时注册字体"（最多 60 条）。
        JSArray userFonts = new JSArray();
        int count = 0;
        int userCount = 0;
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                for (Font f : SystemFonts.getAvailableFonts()) {
                    count++;
                    if (userCount >= 60) continue;
                    File file = f.getFile();
                    String p = file == null ? "" : file.getAbsolutePath();
                    boolean isSystemDir = p.startsWith("/system/fonts")
                            || p.startsWith("/product/fonts")
                            || p.startsWith("/system_ext/fonts")
                            || p.startsWith("/vendor/fonts")
                            || p.startsWith("/apex");
                    if (isSystemDir || p.isEmpty()) continue;
                    JSObject o = new JSObject();
                    o.put("file", p);
                    o.put("kb", file == null ? 0 : file.length() / 1024);
                    o.put("w", f.getStyle().getWeight());
                    o.put("it", f.getStyle().getSlant() == FontStyle.FONT_SLANT_ITALIC ? 1 : 0);
                    o.put("rd", file != null && file.canRead());
                    userFonts.put(o);
                    userCount++;
                }
            }
        } catch (Throwable t) {
            ret.put("systemFontsError", String.valueOf(t));
        }
        ret.put("systemFontCount", count);
        ret.put("userFonts", userFonts);

        // 3) 字体配置 XML：族名表 + 关键族（sans-serif/serif/monospace）的字体文件映射。
        //    若用户主题字体被 ROM 注册进这些 XML，这里能找到可注入的族名。
        JSArray configs = new JSArray();
        String[] xmlPaths = {
                "/system/etc/fonts.xml",
                "/system/etc/fallback-fonts.xml",
                "/product/etc/fonts_customization.xml",
                "/system/etc/fonts_customization.xml",
                "/product/etc/fonts.xml"
        };
        for (String xp : xmlPaths) {
            configs.put(parseFontConfigXml(xp));
        }
        ret.put("fontConfig", configs);

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

        // 5) WebView 默认字体族：必须主线程读取（后台线程调用会抛异常）。
        //    全部原生数据就绪后切主线程补 WebView 部分，再统一 resolve。
        final JSObject retFinal = ret;
        final PluginCall callFinal = call;
        Runnable finish = new Runnable() {
            @Override
            public void run() {
                try {
                    WebSettings ws = getBridge() != null && getBridge().getWebView() != null
                            ? getBridge().getWebView().getSettings() : null;
                    JSObject web = new JSObject();
                    if (ws != null) {
                        web.put("standard", ws.getStandardFontFamily());
                        web.put("sansSerif", ws.getSansSerifFontFamily());
                        web.put("serif", ws.getSerifFontFamily());
                        web.put("fixed", ws.getFixedFontFamily());
                    }
                    retFinal.put("webFontFamilies", web);
                } catch (Throwable t) {
                    retFinal.put("webFontFamiliesError", String.valueOf(t));
                }
                callFinal.resolve(retFinal);
            }
        };
        if (getBridge() != null) {
            new Handler(Looper.getMainLooper()).post(finish);
        } else {
            finish.run();
        }
    }

    /**
     * 把 WebView 默认字体族（standard + sans-serif 泛型）指向指定族名。
     * 必须在主线程执行；若页面已加载完成且调用方要求 reload，则延迟刷新一次
     * 以确保设置生效（本进程内至多执行一次，防止 reload 循环）。
     */
    @PluginMethod
    public void setWebFontFamilies(PluginCall call) {
        final String family = call.getString("family");
        if (family == null || family.trim().isEmpty()) {
            call.reject("family required");
            return;
        }
        final boolean reload = call.getBoolean("reload", false);
        final PluginCall callFinal = call;
        new Handler(Looper.getMainLooper()).post(new Runnable() {
            @Override
            public void run() {
                try {
                    android.webkit.WebView wv = getBridge().getWebView();
                    WebSettings ws = wv.getSettings();
                    ws.setStandardFontFamily(family);
                    ws.setSansSerifFontFamily(family);
                    JSObject ret = new JSObject();
                    ret.put("standard", ws.getStandardFontFamily());
                    ret.put("sansSerif", ws.getSansSerifFontFamily());
                    if (reload && !mReloadedForInjection && wv.getProgress() >= 100) {
                        mReloadedForInjection = true;
                        wv.postDelayed(new Runnable() {
                            @Override
                            public void run() {
                                try {
                                    wv.reload();
                                } catch (Throwable ignored) {
                                }
                            }
                        }, 500);
                        ret.put("reloaded", true);
                    }
                    callFinal.resolve(ret);
                } catch (Throwable t) {
                    callFinal.reject("ERR:" + t.getClass().getSimpleName() + ":" + t.getMessage());
                }
            }
        });
    }

    /** 解析单个字体配置 XML：返回存在性、族名列表、关键族的字体文件映射 */
    private JSObject parseFontConfigXml(String path) {
        JSObject out = new JSObject();
        out.put("path", path);
        File f = new File(path);
        out.put("exists", f.exists());
        out.put("readable", f.canRead());
        if (!f.exists() || !f.canRead()) {
            return out;
        }
        int read = 0;
        try {
            FileInputStream in = new FileInputStream(f);
            byte[] data;
            try {
                int size = (int) Math.min(f.length(), 512 * 1024);
                data = new byte[size];
                while (read < size) {
                    int n = in.read(data, read, size - read);
                    if (n < 0) break;
                    read += n;
                }
            } finally {
                in.close();
            }
            String xml = new String(data, 0, Math.max(read, 0), "UTF-8");

            LinkedHashSet<String> names = new LinkedHashSet<String>();
            Matcher mn = FAMILY_NAME_RE.matcher(xml);
            while (mn.find() && names.size() < 400) {
                names.add(mn.group(1));
            }
            JSArray nameArr = new JSArray();
            for (String n : names) {
                nameArr.put(n);
            }
            out.put("familyNames", nameArr);

            JSObject key = new JSObject();
            String[] keyFamilies = {"sans-serif", "serif", "monospace"};
            for (String keyName : keyFamilies) {
                JSArray files = new JSArray();
                Pattern seg = Pattern.compile(
                        "<family\\b[^>]*\\bname\\s*=\\s*\"" + Pattern.quote(keyName)
                                + "\"[^>]*>(.*?)</family>", Pattern.DOTALL);
                Matcher ms = seg.matcher(xml);
                if (ms.find()) {
                    Matcher mf = FONT_FILE_RE.matcher(ms.group(1));
                    while (mf.find() && files.length() < 8) {
                        files.put(mf.group(1));
                    }
                }
                key.put(keyName, files);
            }
            out.put("keyFamilyFiles", key);
        } catch (Throwable t) {
            out.put("error", String.valueOf(t));
        }
        return out;
    }
}
