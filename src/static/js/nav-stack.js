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
                    // popstate 在 hash 变化【后】触发：
                    //   path = __cxCurrentPath = 返回前所在路径（router dispatch 时写入）
                    var path = (typeof window.__cxCurrentPath === 'string')
                        ? window.__cxCurrentPath
                        : window.location.hash.replace(/^#\/?/, '');
                    var parts = path.split('/').filter(Boolean);
                    console.log('[NavStack] PWA fallback from="' + path + '" parts=' + JSON.stringify(parts));

                    // 与 Capacitor 分支完全一致的显式层级跳转，使用 navigateReplace 不新增历史条目，
                    // 且 replaceState 会覆盖可能存在的 ghost entry，无需专门检测。
                    handleBackCommon(function() {
                        if (parts.length >= 3) {
                            // 章节视图 → 批次目录
                            if (window.CXRouter) { window.CXRouter.navigateReplace(parts[0]); return; }
                        } else if (parts.length >= 1) {
                            // 批次目录 → 主页
                            if (window.CXRouter) { window.CXRouter.navigateReplace(''); return; }
                        }
                        // 已在主页 → 尝试退出 PWA
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

// ——— 浮动导航栏：内容页向下滚动后，点击空白处从顶部滑入快捷 tab 栏 ———
(function() {
    'use strict';

    var _el = null;        // 浮动导航栏 DOM 元素
    var _ttsEl = null;     // 浮动朗读栏 DOM 元素（克隆）
    var _timer = null;     // 5 秒自动隐藏定时器
    var HIDE_DELAY = 5000;
    var _ttsSyncCleanup = null;

    /* 获取当前页面的 .page-navigation（章节 tab 栏） */
    function getPageNav() {
        return document.querySelector('.page-navigation');
    }

    /* .page-navigation 是否仍在视口内 */
    function isPageNavVisible() {
        var nav = getPageNav();
        if (!nav) return true; // 无 tab 栏的页面（主页/目录页）视为"可见"，不弹浮动栏
        return nav.getBoundingClientRect().bottom > 0;
    }

    /* 创建或复用浮动栏 DOM */
    function ensureEl() {
        if (!_el) {
            _el = document.createElement('div');
            _el.className = 'cx-float-nav';
            _el.setAttribute('aria-label', '快捷导航');
            document.body.appendChild(_el);

            // 浮动栏内部点击：阻止冒泡（防止触发外部 document 隐藏逻辑）
            // nav-link 点击后立即 hide（同章节视图切换用 replaceState，不触发 hashchange）
            // 设置按钮有自己的 onclick 处理
            // 点击非交互区域（间隙）→ 收起浮动栏
            _el.addEventListener('click', function(e) {
                e.stopPropagation();
                var t = e.target;
                while (t && t !== _el) {
                    if (t.classList && t.classList.contains('nav-link')) {
                        hide(); return; // 路由跳转已在 onclick 里触发，hide 收起浮动栏
                    }
                    if (t.classList && t.classList.contains('cx-float-nav-settings')) {
                        return; // 设置按钮有自己的 onclick，不额外处理
                    }
                    t = t.parentElement;
                }
                hide(); // 点击间隙区域收起
            });
        }
        return _el;
    }

    /* 将当前 .page-navigation 的内容同步到浮动栏 */
    function syncContent() {
        var pageNav = getPageNav();
        if (!pageNav) return false;
        var el = ensureEl();

        // 克隆 tab 栏，清除 id 防止页面出现重复 id（如 cx-search-btn）
        var cloned = pageNav.cloneNode(true);
        var withId = cloned.querySelectorAll('[id]');
        for (var i = 0; i < withId.length; i++) {
            withId[i].removeAttribute('id');
        }

        // 设置按钮（⚙）
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cx-float-nav-settings';
        btn.title = '设置';
        btn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v6m0 6v6M1 12h6m6 0h6"/><path d="M4.2 4.2l4.3 4.3m5.5 5.5l4.3 4.3M4.2 19.8l4.3-4.3m5.5-5.5l4.3-4.3"/></svg>';
        btn.onclick = function(e) {
            e.stopPropagation();
            hide();
            if (window.toggleThemePanel) window.toggleThemePanel();
        };

        el.innerHTML = '';
        el.appendChild(cloned);
        el.appendChild(btn);
        return true;
    }

    // ——— 浮动朗读栏：克隆原始 bottomControlBar 为固定覆盖层 ———

    function getTtsBar() {
        var bar = document.getElementById('bottomControlBar');
        return (bar && bar.style.display !== 'none') ? bar : null;
    }

    function ensureTtsEl() {
        if (!_ttsEl) {
            _ttsEl = document.createElement('div');
            _ttsEl.className = 'cx-float-tts-bar';
            _ttsEl.setAttribute('aria-label', '朗读控制');
            document.body.appendChild(_ttsEl);
            _ttsEl.addEventListener('click', function(e) { e.stopPropagation(); });
        }
        return _ttsEl;
    }

    function syncTtsContent() {
        var orig = getTtsBar();
        if (!orig) return false;
        var el = ensureTtsEl();

        // 克隆朗读栏，清除 id 防止重复
        var cloned = orig.cloneNode(true);
        var withId = cloned.querySelectorAll('[id]');
        for (var i = 0; i < withId.length; i++) withId[i].removeAttribute('id');

        // 清理旧的同步观察者
        if (_ttsSyncCleanup) { _ttsSyncCleanup(); _ttsSyncCleanup = null; }

        var origProgress  = document.getElementById('progressBar');
        var origTime      = document.getElementById('speechTime');
        var origRate      = document.getElementById('rateSelect');
        var origPlayPause = document.getElementById('playPauseBtn');
        var cloneProgress  = cloned.querySelector('.progress-bar');
        var cloneTime      = cloned.querySelector('.speech-time');
        var cloneRate      = cloned.querySelector('.control-select');
        var cloneBtns      = cloned.querySelectorAll('.control-btn');
        var isSeekingClone = false;

        // ── 原始 → 克隆：镜像朗读状态变化 ──
        var observers = [];
        if (origProgress && cloneProgress) {
            observers.push(new MutationObserver(function() {
                if (!isSeekingClone) cloneProgress.value = origProgress.value;
            }));
            observers[observers.length - 1].observe(origProgress, { attributes: true, attributeFilter: ['value'] });
        }
        if (origTime && cloneTime) {
            var timeIdx = observers.length;
            observers.push(new MutationObserver(function() {
                cloneTime.textContent = origTime.textContent;
            }));
            observers[timeIdx].observe(origTime, { childList: true, characterData: true, subtree: true });
        }
        if (origRate && cloneRate) {
            var rateIdx = observers.length;
            observers.push(new MutationObserver(function() {
                cloneRate.value = origRate.value;
            }));
            observers[rateIdx].observe(origRate, { attributes: true, attributeFilter: ['value'] });
        }
        if (origPlayPause) {
            var ppIdx = observers.length;
            observers.push(new MutationObserver(function() {
                var clonePP = cloned.querySelector('.play-pause-btn');
                if (clonePP) clonePP.innerHTML = origPlayPause.innerHTML;
            }));
            observers[ppIdx].observe(origPlayPause, { childList: true, subtree: true });
        }
        _ttsSyncCleanup = function() {
            for (var j = 0; j < observers.length; j++) observers[j].disconnect();
        };

        // ── 克隆 → 原始：转发交互事件 ──
        if (cloneProgress && origProgress) {
            cloneProgress.addEventListener('touchstart', function() {
                isSeekingClone = true;
                origProgress.dispatchEvent(new Event('touchstart'));
            });
            cloneProgress.addEventListener('mousedown', function() {
                isSeekingClone = true;
                origProgress.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            });
            cloneProgress.addEventListener('input', function() {
                origProgress.value = cloneProgress.value;
                origProgress.dispatchEvent(new Event('input', { bubbles: true }));
            });
            cloneProgress.addEventListener('change', function() {
                origProgress.value = cloneProgress.value;
                origProgress.dispatchEvent(new Event('change', { bubbles: true }));
            });
            cloneProgress.addEventListener('touchend', function() {
                origProgress.dispatchEvent(new Event('touchend'));
                isSeekingClone = false;
            });
            cloneProgress.addEventListener('mouseup', function() {
                origProgress.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                isSeekingClone = false;
            });
        }
        if (cloneRate && origRate) {
            cloneRate.addEventListener('change', function() {
                origRate.value = cloneRate.value;
                origRate.dispatchEvent(new Event('change', { bubbles: true }));
            });
        }
        // 按钮点击转发（播放/暂停、循环）
        for (var b = 0; b < cloneBtns.length; b++) {
            (function(cloneBtn, idx) {
                cloneBtn.addEventListener('click', function() {
                    if (orig.querySelectorAll('.control-btn')[idx]) {
                        orig.querySelectorAll('.control-btn')[idx].click();
                    }
                });
            })(cloneBtns[b], b);
        }

        el.innerHTML = '';
        el.appendChild(cloned);
        return true;
    }

    /* 显示浮动栏 */
    function show() {
        if (!syncContent()) return;
        ensureEl().classList.add('show');
        clearTimeout(_timer);
        _timer = setTimeout(hide, HIDE_DELAY);
        syncTtsContent();
        if (_ttsEl) {
            _ttsEl.classList.add('show');
        }
    }

    /* 隐藏浮动栏 */
    function hide() {
        clearTimeout(_timer);
        if (_el) _el.classList.remove('show');
        if (_ttsEl) _ttsEl.classList.remove('show');
        if (_ttsSyncCleanup) { _ttsSyncCleanup(); _ttsSyncCleanup = null; }
    }

    /* 上滑回到原始 tab 栏可见范围时自动隐藏浮动栏 */
    window.addEventListener('scroll', function() {
        if (_el && _el.classList.contains('show') && isPageNavVisible()) {
            hide();
        }
    }, { passive: true });

    /* 路由变化时销毁浮动栏（下次进入新页面时重建，保证 tab 内容与页面同步） */
    window.addEventListener('hashchange', function() {
        hide();
        if (_el && _el.parentNode) _el.parentNode.removeChild(_el);
        _el = null;
        if (_ttsEl && _ttsEl.parentNode) _ttsEl.parentNode.removeChild(_ttsEl);
        _ttsEl = null;
    });

    /* 判断点击是否落在"空白"区域（无交互意图） */
    function isEmptyAreaClick(e) {
        var el = e.target;
        while (el && el !== document.body) {
            // 浮动栏自身交由内部处理
            if (el.classList && (el.classList.contains('cx-float-nav') || el.classList.contains('cx-float-tts-bar'))) return false;
            // 弹框内点击不触发目录栏显示
            if (el.id === 'scripture-popup-overlay' || 
                (el.parentElement && el.parentElement.id === 'scripture-popup-overlay') ||
                el.closest('#scripture-popup-overlay')) return false;
            // CX.openDialog 创建的弹框
            if (el.classList && el.classList.contains('cx-dialog-mask')) return false;
            var tag = (el.tagName || '').toLowerCase();
            if (tag === 'a' || tag === 'button' || tag === 'input' ||
                tag === 'select' || tag === 'textarea' || tag === 'label') return false;
            if (el.getAttribute && el.getAttribute('onclick')) return false;
            if (el.classList) {
                var cls = el.classList;
                if (cls.contains('outline-lvl-toggle') || cls.contains('outline-title') ||
                    cls.contains('scripture-ref')       || cls.contains('verse-ref') ||
                    cls.contains('fn-ref')              || cls.contains('xref-ref') ||
                    cls.contains('speech-btn')          || cls.contains('play-btn') ||
                    cls.contains('highlight-trigger')   || cls.contains('cx-dialog-mask') ||
                    cls.contains('theme-panel')         || cls.contains('theme-toggle-btn') ||
                    cls.contains('toc-item')            || cls.contains('scripture-popup') ||
                    cls.contains('scripture-popup-overlay') || cls.contains('scripture-popup-body') ||
                    cls.contains('scripture-popup-header') ||
                    cls.contains('cx-highlight')        || cls.contains('cx-note-icon')) return false;
            }
            el = el.parentElement;
        }
        return true;
    }

    /* 是否是内容页（hash 格式：#/{batchPath}/{num}/{view}，中间段为数字） */
    function isContentPage() {
        return /^#\/[^\/]+\/\d+\//.test(window.location.hash);
    }

    /* 全局点击监听 */
    document.addEventListener('click', function(e) {
        // 浮动栏已显示 → 浮动栏外任意点击收起（浮动栏内部点击已被 stopPropagation，不会到达这里）
        if (_el && _el.classList.contains('show')) {
            hide();
            return;
        }
        // 浮动栏未显示 → 仅内容页且 tab 栏不可见且空白处点击时弹出
        if (isContentPage() && !isPageNavVisible() && isEmptyAreaClick(e)) {
            show();
        }
    }, false);
})();
