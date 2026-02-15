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
                handleBackCommon(handleBack);
            });
        } else if (isPWA()) {
            window.addEventListener('popstate', function() {
                if (window.__cxExiting) return;
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
