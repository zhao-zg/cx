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

        // 已在栈顶，无需操作
        if (navStack.length > 0 && navStack[navStack.length - 1] === currentPath) {
            return;
        }

        // 检查路径是否已存在于栈中（用户通过链接"返回"到之前的页面）
        // 如果存在，回退栈到该位置，避免栈膨胀
        for (var i = navStack.length - 2; i >= 0; i--) {
            if (navStack[i] === currentPath) {
                navStack = navStack.slice(0, i + 1);
                setNavStack(navStack);
                return;
            }
        }

        // 全新路径，正常入栈
        navStack.push(currentPath);
        navStack = trimNavStack(navStack);
        setNavStack(navStack);
    }

    // 页面加载时，推入一个 guard 条目
    // 用户按回退 → 从 guard 回到 real → 触发 popstate
    // 我们处理后用 go(1) 弹回 guard 或 location.replace 导航走
    function ensurePwaHistory(currentPath) {
        if (window.history && window.history.pushState) {
            var state = window.history.state || {};
            if (!state.cxGuard) {
                window.history.replaceState({ cx: true, cxPath: currentPath }, '', currentPath);
                window.history.pushState({ cx: true, cxGuard: true, cxPath: currentPath }, '', currentPath);
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
            currentPath = getCurrentPath();

            navStack.pop();
            setNavStack(navStack);

            if (navStack.length > 0) {
                var targetPath = navStack[navStack.length - 1];
                if (targetPath) {
                    window.location.replace(targetPath);
                    return;
                }
            }

            // 栈空或无有效目标：导航到上级页面
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
            ensurePwaHistory(currentPath);
            window.addEventListener('popstate', function(e) {
                // 忽略 go(1) 弹回 guard 触发的 popstate
                var state = (e && e.state) || {};
                if (state.cxGuard) return;
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
                var targetPath = navStack[navStack.length - 1];
                if (targetPath) {
                    window.location.replace(targetPath);
                    return;
                }
            }

            // 栈空：已经在主页最顶层
            sessionStorage.removeItem(NAV_KEY);
            try {
                localStorage.removeItem('cx_last_page');
                localStorage.removeItem('cx_last_page_time');
            } catch (e) {}

            if (isCapacitor()) {
                window.Capacitor.Plugins.App.exitApp();
            } else {
                // PWA：弹回已有的 guard 条目，吸收回退操作，保持在主页
                // 用 go(1) 不会新增 history 条目，避免 history 无限膨胀
                window.history.go(1);
            }
        }

        if (isCapacitor()) {
            window.Capacitor.Plugins.App.addListener('backButton', function() {
                handleBackCommon(handleBack);
            });
        } else if (isPWA()) {
            ensurePwaHistory(currentPath);
            window.addEventListener('popstate', function(e) {
                // 忽略 go(1) 弹回 guard 触发的 popstate
                var state = (e && e.state) || {};
                if (state.cxGuard) return;
                handleBackCommon(handleBack);
            });
        }
    }

    window.CXNavStack = {
        initContentPage: initContentPage,
        initHomePage: initHomePage
    };
})();
