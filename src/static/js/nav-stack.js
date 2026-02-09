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

    function isHomePath(pathname) {
        return pathname === '/' ||
            pathname === '/index.html' ||
            pathname === '' ||
            pathname === '/android_asset/public/index.html' ||
            pathname.indexOf('/public/index.html') !== -1;
    }

    function buildPath(urlObj) {
        return urlObj.pathname + urlObj.search + urlObj.hash;
    }

    function getNavStack() {
        try {
            return JSON.parse(sessionStorage.getItem(NAV_KEY) || '[]');
        } catch (e) {
            return [];
        }
    }

    function setNavStack(stack) {
        var cleaned = (stack || []).filter(function(item) {
            return item && String(item).trim() !== '';
        });
        sessionStorage.setItem(NAV_KEY, JSON.stringify(cleaned));
    }

    function trimNavStack(stack) {
        if (stack.length > MAX_STACK) {
            return stack.slice(stack.length - MAX_STACK);
        }
        return stack;
    }

    function pushIfNeeded(currentPath) {
        if (!currentPath) {
            return;
        }
        var navStack = getNavStack();

        if (navStack.length > 0 && navStack[navStack.length - 1] === currentPath) {
            return;
        }

        for (var i = navStack.length - 2; i >= 0; i--) {
            if (navStack[i] === currentPath) {
                navStack = navStack.slice(0, i + 1);
                setNavStack(navStack);
                return;
            }
        }

        navStack.push(currentPath);
        navStack = trimNavStack(navStack);
        setNavStack(navStack);
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
            }, 300);
        }
    }

    function setupPwaPopstate(handleBack) {
        window.addEventListener('popstate', function(e) {
            if (window.__cxExiting) return;

            var state = (e && e.state) || {};

            if (state.cxGuard) {
                return;
            }

            // 用户按了回退: 从 guard 落到 real 条目
            // 立即重推 guard, 防止快速连续按回退穿透历史
            if (window.history && window.history.pushState) {
                var path = getCurrentPath();
                window.history.pushState({ cx: true, cxGuard: true, cxPath: path }, '', path);
            }

            handleBackCommon(handleBack);
        });
    }

    function initContentPage(options) {
        options = options || {};
        if (!isCapacitor() && !isPWA()) return;

        var currentPath = getCurrentPath();
        var existingStack = getNavStack();
        if (existingStack.length === 0) {
            var pathname = window.location.pathname;
            if (!isHomePath(pathname)) {
                var isIndex = pathname.endsWith('/index.html') || pathname.endsWith('/');
                var dirIndexUrl = new URL('./index.html', window.location.href);
                var homeUrl = new URL('../index.html', dirIndexUrl);
                var seededStack = [];

                var homePath = buildPath(homeUrl);
                var dirIndexPath = buildPath(dirIndexUrl);

                if (homePath && homePath !== currentPath) {
                    seededStack.push(homePath);
                }

                if (!isIndex) {
                    if (dirIndexPath && dirIndexPath !== currentPath) {
                        seededStack.push(dirIndexPath);
                    }
                }

                if (seededStack.length === 0 || seededStack[seededStack.length - 1] !== currentPath) {
                    seededStack.push(currentPath);
                }

                setNavStack(trimNavStack(seededStack));
            } else {
                pushIfNeeded(currentPath);
            }
        } else {
            pushIfNeeded(currentPath);
        }

        function handleBack() {
            var navStack = getNavStack();

            navStack.pop();
            setNavStack(navStack);

            if (navStack.length > 0) {
                var targetPath = navStack[navStack.length - 1];
                if (targetPath) {
                    window.location.replace(targetPath);
                    return;
                }
            }

            sessionStorage.removeItem(NAV_KEY);
            sessionStorage.setItem('cx_user_back', 'true');
            var pathname = window.location.pathname;
            if ((pathname.endsWith('/index.html') || pathname.endsWith('/')) && pathname.split('/').length > 2) {
                window.location.replace('../index.html');
            } else {
                window.location.replace('./index.html');
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

            navStack.pop();
            setNavStack(navStack);

            if (navStack.length > 0) {
                var targetPath = navStack[navStack.length - 1];
                if (targetPath) {
                    window.location.replace(targetPath);
                    return;
                }
            }

            sessionStorage.removeItem(NAV_KEY);
            try {
                localStorage.removeItem('cx_last_page');
                localStorage.removeItem('cx_last_page_time');
            } catch (e) {}

            if (isCapacitor()) {
                window.Capacitor.Plugins.App.exitApp();
            } else {
                // PWA 退出: 标记正在退出, 防止 popstate 重复处理
                window.__cxExiting = true;
                window.close();
                // close 无效时, 跳到 history 最前面让系统退出 standalone
                setTimeout(function() {
                    var steps = window.history.length || 1;
                    window.history.go(-steps);
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
        initHomePage: initHomePage
    };
})();
