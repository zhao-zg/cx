(function() {
    'use strict';

    // 页面加载时间戳：用于过滤 iOS/Android PWA 在加载后短时间内触发的虚假 popstate
    var _loadedAt = Date.now();
    var _GRACE_MS = 500;  // 500ms 内忽略 popstate（已知 iOS Safari PWA 会在启动时触发虚假事件）

    function isCapacitor() {
        return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    }

    function isPWA() {
        return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    }

    function handleBackCommon(targetHandler) {
        if (window.__cxHandlingBack || window.__cxExiting) {
            return;
        }
        window.__cxHandlingBack = true;
        try {
            targetHandler();
        } finally {
            setTimeout(function() {
                window.__cxHandlingBack = false;
            }, 50);
        }
    }

    function setupBackHandler(handleBack) {
        if (!isCapacitor() && !isPWA()) return;

        if (isCapacitor()) {
            window.Capacitor.Plugins.App.addListener('backButton', function() {
                // backStack 有内容，说明某个弹框/面板注册了关闭回调
                // 调 history.back() 会触发 WebView 的 popstate，进而消耗 backStack 栏顶
                if (window.CX && window.CX.backStack && window.CX.backStack.size() > 0) {
                    try { history.back(); } catch(e) {}
                    return;
                }
                handleBackCommon(handleBack);
            });
        } else if (isPWA()) {
            // PWA 的 popstate 由 CX.backStack 统一监听；注册页面跳转为兜底
            if (window.CX && window.CX.backStack) {
                window.CX.backStack.setFallback(function() {
                    if (window.__cxExiting) return;
                    // 忽略页面加载后短时间内的虚假 popstate（iOS/Android PWA 已知问题）
                    if (Date.now() - _loadedAt < _GRACE_MS) return;
                    console.log('[NavStack] fallback 触发 hash="' + window.location.hash + '" backStackSize=' + window.CX.backStack.size());
                    handleBackCommon(handleBack);
                });
            }
        }
    }

    // 内容页回退 → 目录页
    function initContentPage() {
        setupBackHandler(function() {
            window.location.replace('./index.html');
        });
    }

    // 目录页回退 → 主页
    function initDirectoryPage() {
        setupBackHandler(function() {
            window.location.replace('../index.html');
        });
    }

    // 主页回退 — Capacitor APK 与 PWA 逻辑完全分开
    // APK:  backButton 在 hash 变化【前】触发 → 读当前路径、显式路由
    // PWA:  popstate   在 hash 变化【后】触发 → 读 __cxCurrentPath（router 在 dispatch 时写入）
    //       浏览器已通过 history.back() 改变了 hash，router 的 hashchange 会自动渲染目标页，
    //       fallback 只需处理"已在主页按返回 → 退出"的情况。
    function initHomePage() {
        if (isCapacitor()) {
            window.Capacitor.Plugins.App.addListener('backButton', function() {
                if (window.CX && window.CX.backStack && window.CX.backStack.size() > 0) {
                    try { history.back(); } catch(e) {}
                    return;
                }
                handleBackCommon(function() {
                    // backButton 在 hash 变化前触发，__cxCurrentPath 与 location.hash 均可信
                    var path = (typeof window.__cxCurrentPath === 'string')
                        ? window.__cxCurrentPath
                        : window.location.hash.replace(/^#\/?/, '');
                    var parts = path.split('/').filter(Boolean);
                    console.log('[NavStack] Capacitor backButton path="' + path + '" parts=' + JSON.stringify(parts));
                    if (parts.length >= 3) {
                        // 章节视图 → 批次目录
                        if (window.CXRouter) { window.CXRouter.navigate(parts[0]); return; }
                    } else if (parts.length >= 1) {
                        // 批次目录 → 主页
                        if (window.CXRouter) { window.CXRouter.navigate(''); return; }
                    }
                    // 已在主页 → 退出 APP
                    window.Capacitor.Plugins.App.exitApp();
                });
            });
        } else if (isPWA()) {
            if (window.CX && window.CX.backStack) {
                window.CX.backStack.setFallback(function() {
                    if (window.__cxExiting) return;
                    if (Date.now() - _loadedAt < _GRACE_MS) return;
                    // popstate 在 hash 变化【后】触发，location.hash 已是目标页；
                    // __cxCurrentPath 是 router dispatch 写入的"返回前所在路径"。
                    var path = (typeof window.__cxCurrentPath === 'string')
                        ? window.__cxCurrentPath
                        : window.location.hash.replace(/^#\/?/, '');
                    var parts = path.split('/').filter(Boolean);
                    console.log('[NavStack] PWA fallback path="' + path + '" parts=' + JSON.stringify(parts));
                    if (parts.length > 0) {
                        // 从子页面（批次/章节）返回 —— 浏览器的 history.back() 已改变 hash，
                        // router 的 hashchange 会自动渲染正确视图，此处无需再做路由。
                        return;
                    }
                    // 已在主页 → 尝试退出 PWA
                    handleBackCommon(function() {
                        window.__cxExiting = true;
                        window.close();
                        setTimeout(function() {
                            window.history.back();
                            setTimeout(function() { window.__cxExiting = false; }, 400);
                        }, 150);
                    });
                });
            }
        }
    }

    // 标语页回退 → 目录页
    function initMottoPage() {
        setupBackHandler(function() {
            window.location.replace('./index.html');
        });
    }

    // 标语诗歌页回退 → 目录页
    function initMottoSongPage() {
        setupBackHandler(function() {
            window.location.replace('./index.html');
        });
    }

    window.CXNavStack = {
        initContentPage: initContentPage,
        initDirectoryPage: initDirectoryPage,
        initHomePage: initHomePage,
        initMottoPage: initMottoPage,
        initMottoSongPage: initMottoSongPage
    };
})();
