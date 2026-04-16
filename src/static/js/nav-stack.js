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
                // 经文弹框或对话框打开时，交由弹框自己的 popstate 处理
                var popup = document.getElementById('scripture-popup-overlay');
                if (popup && popup.classList.contains('scripture-popup-overlay--open')) {
                    history.back();
                    return;
                }
                if (document.getElementById('cxSponsorMask')) { history.back(); return; }
                if (document.getElementById('cxClearDialogMask')) { history.back(); return; }
                handleBackCommon(handleBack);
            });
        } else if (isPWA()) {
            window.addEventListener('popstate', function() {
                if (window.__cxExiting) return;
                // 经文弹框或赞助对话框已拦截了此次 popstate，不再执行页面跳转
                var popup = document.getElementById('scripture-popup-overlay');
                if (popup && popup.classList.contains('scripture-popup-overlay--open')) return;
                if (document.getElementById('cxSponsorMask')) return;
                if (document.getElementById('cxClearDialogMask')) return;
                handleBackCommon(handleBack);
            });
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

    // 主页回退 → 退出
    function initHomePage() {
        setupBackHandler(function() {
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
