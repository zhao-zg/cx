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

    function setupPwaPopstate(handleBack) {
        window.addEventListener('popstate', function() {
            if (window.__cxExiting) return;
            handleBackCommon(handleBack);
        });
    }

    // 内容页回退 → 目录页
    function initContentPage() {
        if (!isCapacitor() && !isPWA()) return;

        function handleBack() {
            window.location.replace('./index.html');
        }

        if (isCapacitor()) {
            window.Capacitor.Plugins.App.addListener('backButton', function() {
                handleBackCommon(handleBack);
            });
        } else if (isPWA()) {
            setupPwaPopstate(handleBack);
        }
    }

    // 目录页回退 → 主页
    function initDirectoryPage() {
        if (!isCapacitor() && !isPWA()) return;

        function handleBack() {
            window.location.replace('../index.html');
        }

        if (isCapacitor()) {
            window.Capacitor.Plugins.App.addListener('backButton', function() {
                handleBackCommon(handleBack);
            });
        } else if (isPWA()) {
            setupPwaPopstate(handleBack);
        }
    }

    // 主页回退 → 退出
    function initHomePage() {
        if (!isCapacitor() && !isPWA()) return;

        function handleBack() {
            if (isCapacitor()) {
                window.Capacitor.Plugins.App.exitApp();
            } else {
                window.__cxExiting = true;
                window.close();
                setTimeout(function() {
                    window.history.back();
                }, 150);
            }
        }

        if (isCapacitor()) {
            window.Capacitor.Plugins.App.addListener('backButton', function() {
                handleBackCommon(handleBack);
            });
        } else if (isPWA()) {
            setupPwaPopstate(handleBack);
        }
    }

    window.CXNavStack = {
        initContentPage: initContentPage,
        initDirectoryPage: initDirectoryPage,
        initHomePage: initHomePage
    };
})();
