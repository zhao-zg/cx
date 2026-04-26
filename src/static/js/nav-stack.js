(function() {
    'use strict';

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

    // 主页回退 → 退出（SPA 模式：感知当前 hash，非首页时先返回上一级）
    function initHomePage() {
        setupBackHandler(function() {
            // SPA 模式：根据当前 hash 决定行为
            var hash = window.location.hash.replace(/^#\/?/, '');
            var parts = hash.split('/').filter(Boolean);
            if (parts.length >= 3) {
                // 章节视图 → 返回批次目录
                if (window.CXRouter) { window.CXRouter.navigate(parts[0]); return; }
            } else if (parts.length >= 1) {
                // 批次目录 → 返回首页
                if (window.CXRouter) { window.CXRouter.navigate(''); return; }
            }
            // 已在首页 → 退出
            if (isCapacitor()) {
                window.Capacitor.Plugins.App.exitApp();
            } else {
                window.__cxExiting = true;
                window.close();
                setTimeout(function() {
                    window.history.back();
                }, 150);
            }
        });
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
