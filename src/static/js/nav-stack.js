(function() {
    'use strict';

    var NAV_KEY = 'cx_nav_stack';
    var MAX_STACK = 12;

    function isCapacitor() {
        return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    }

    function isPWA() {
        return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    }

    function getCurrentPath() {
        return window.location.pathname + window.location.search + window.location.hash;
    }

    function getNavStack() {
        try {
            return JSON.parse(sessionStorage.getItem(NAV_KEY) || '[]');
        } catch (e) {
            return [];
        }
    }

    function setNavStack(stack) {
        sessionStorage.setItem(NAV_KEY, JSON.stringify(stack));
    }

    function trimNavStack(stack) {
        if (stack.length > MAX_STACK) {
            return stack.slice(stack.length - MAX_STACK);
        }
        return stack;
    }

    function pushIfNeeded(currentPath) {
        var navStack = getNavStack();
        if (navStack.length === 0 || navStack[navStack.length - 1] !== currentPath) {
            navStack.push(currentPath);
            navStack = trimNavStack(navStack);
            setNavStack(navStack);
        }
    }

    function ensurePwaHistory(currentPath) {
        if (window.history && window.history.pushState) {
            var state = window.history.state || {};
            if (!state.cx) {
                window.history.pushState({ cx: true }, '', currentPath);
            }
        }
    }

    function handleBackCommon(targetHandler) {
        if (window.__cxHandlingBack) {
            return;
        }
        window.__cxHandlingBack = true;
        try {
            targetHandler();
        } finally {
            setTimeout(function() {
                window.__cxHandlingBack = false;
            }, 0);
        }
    }

    function initContentPage(options) {
        options = options || {};
        if (!isCapacitor() && !isPWA()) return;

        var currentPath = getCurrentPath();
        pushIfNeeded(currentPath);

        function handleBack() {
            var navStack = getNavStack();
            currentPath = getCurrentPath();

            navStack.pop();
            setNavStack(navStack);

            if (navStack.length > 0) {
                if (isCapacitor()) {
                    window.history.back();
                } else {
                    var targetPath = navStack[navStack.length - 1];
                    if (targetPath) {
                        window.location.replace(targetPath);
                    } else {
                        window.history.back();
                    }
                }
            } else {
                sessionStorage.removeItem(NAV_KEY);
                sessionStorage.setItem('cx_user_back', 'true');
                var pathname = window.location.pathname;
                if ((pathname.endsWith('/index.html') || pathname.endsWith('/')) && pathname.split('/').length > 2) {
                    window.location.replace('../index.html');
                } else {
                    window.location.replace('./index.html');
                }
            }
        }

        if (isCapacitor()) {
            window.Capacitor.Plugins.App.addListener('backButton', function() {
                handleBackCommon(handleBack);
            });
        } else if (isPWA()) {
            ensurePwaHistory(currentPath);
            window.addEventListener('popstate', function() {
                handleBackCommon(handleBack);
            });
        }
    }

    function initHomePage(options) {
        options = options || {};
        if (!isCapacitor() && !isPWA()) return;

        var currentPath = getCurrentPath();
        var existingStack = getNavStack();
        if (!options.deferPushIfEmpty || existingStack.length > 0) {
            pushIfNeeded(currentPath);
        }

        function handleBack() {
            var navStack = getNavStack();
            currentPath = getCurrentPath();

            navStack.pop();
            setNavStack(navStack);

            if (navStack.length > 0) {
                if (isCapacitor()) {
                    window.history.back();
                } else {
                    var targetPath = navStack[navStack.length - 1];
                    if (targetPath) {
                        window.location.replace(targetPath);
                    } else {
                        window.history.back();
                    }
                }
            } else {
                sessionStorage.removeItem(NAV_KEY);
                try {
                    localStorage.removeItem('cx_last_page');
                    localStorage.removeItem('cx_last_page_time');
                } catch (e) {}
                if (isCapacitor()) {
                    window.Capacitor.Plugins.App.exitApp();
                } else {
                    window.history.back();
                }
            }
        }

        if (isCapacitor()) {
            window.Capacitor.Plugins.App.addListener('backButton', function() {
                handleBackCommon(handleBack);
            });
        } else if (isPWA()) {
            ensurePwaHistory(currentPath);
            window.addEventListener('popstate', function() {
                handleBackCommon(handleBack);
            });
        }
    }

    window.CXNavStack = {
        initContentPage: initContentPage,
        initHomePage: initHomePage
    };
})();
