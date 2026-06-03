/**
 * 主题切换和字体控制功能模块
 * 支持暖色/冷色模式切换和字体大小调整
 */

// ── 笔记备份/恢复守卫：防止升级或意外 reload 导致 cx_highlights 丢失 ─────────
(function() {
    'use strict';
    var NOTES_KEY   = 'cx_highlights';
    var BACKUP_KEY  = 'cx_highlights_bak';
    var BACKUP_TS_KEY = 'cx_highlights_bak_ts';

    // 已迁移到 IndexedDB：备份守卫置空，旧 localStorage 备份键无意义
    try {
        if (localStorage.getItem('cx_hl_migrated') === '1') {
            window.CX = window.CX || {};
            window.CX.notesGuard = { save: function() {} };
            return;
        }
    } catch(e) {}

    // 启动时：若主键为空但备份存在（30天内），静默恢复
    try {
        var current = localStorage.getItem(NOTES_KEY);
        var backup  = localStorage.getItem(BACKUP_KEY);
        var backupTs = parseInt(localStorage.getItem(BACKUP_TS_KEY) || '0', 10);
        var day30 = 30 * 24 * 60 * 60 * 1000;
        if ((!current || current === '{}' || current === '[]') &&
            backup && backup.length > 2 &&
            backupTs && (Date.now() - backupTs) < day30) {
            localStorage.setItem(NOTES_KEY, backup);
            console.log('[笔记守卫] 从备份恢复笔记，备份时间:', new Date(backupTs).toLocaleString());
        }
    } catch(e) {}

    // 当 app 切入后台时刷新备份（visibilitychange 比 beforeunload 在移动端更可靠）
    function saveNotesBackup() {
        try {
            var notes = localStorage.getItem(NOTES_KEY);
            if (notes && notes.length > 2 && notes !== '{}' && notes !== '[]') {
                localStorage.setItem(BACKUP_KEY, notes);
                localStorage.setItem(BACKUP_TS_KEY, Date.now().toString());
            }
        } catch(e) {}
    }

    document.addEventListener('visibilitychange', function() {
        if (document.hidden) saveNotesBackup();
    });
    window.addEventListener('beforeunload', saveNotesBackup);

    // 暴露给外部调用（如 clearAllCachesAndMemory 清除 cx_ 键时同步清备份）
    window.CX = window.CX || {};
    window.CX.notesGuard = { save: saveNotesBackup };
})();


// ── 错误日志收集器 ──────────────────────────────────────────────────────────
(function() {
    'use strict';
    var LOG_KEY     = 'cx_error_log';
    var LOG_VER_KEY = 'cx_error_log_ver'; // 记录日志对应的版本号
    var MAX_ENTRIES = 40;

    // 获取当前版本：PWA 用 cx_pwa_version，APK 用 cx_apk_version，取最新有值的
    function getCurrentVersion() {
        try {
            return localStorage.getItem('cx_apk_version') ||
                   localStorage.getItem('cx_pwa_version') || '';
        } catch(e) { return ''; }
    }

    // 版本升级时清理旧日志（防止把老版本的错误误报为当前版本）
    function clearStaleErrorLog() {
        try {
            var savedVer = localStorage.getItem(LOG_VER_KEY);
            if (!savedVer) return;
            var curVer = getCurrentVersion();
            if (curVer && curVer !== savedVer) {
                localStorage.removeItem(LOG_KEY);
                localStorage.removeItem(LOG_VER_KEY);
            }
        } catch(e) {}
    }
    clearStaleErrorLog();

    function appendLog(entry) {
        try {
            var arr = [];
            try { arr = JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch(e) {}
            if (!Array.isArray(arr)) arr = [];
            // 写入当前版本（首条时记录，此后保持不变以标识日志所属版本）
            if (arr.length === 0) {
                try { localStorage.setItem(LOG_VER_KEY, getCurrentVersion()); } catch(e) {}
            }
            arr.push(entry);
            if (arr.length > MAX_ENTRIES) arr = arr.slice(arr.length - MAX_ENTRIES);
            localStorage.setItem(LOG_KEY, JSON.stringify(arr));
        } catch(e) {}
    }

    // 捕获同步错误
    var _origOnerror = window.onerror;
    window.onerror = function(msg, src, line, col, err) {
        // 过滤已知无关噪音
        var m = String(msg || '');
        if (m.indexOf('Script error') === 0) return false;
        appendLog({
            t: Date.now(),
            m: m.substring(0, 250),
            s: (src || '').replace(/^.*\//, '') + ':' + line
        });
        if (_origOnerror) return _origOnerror.apply(this, arguments);
        return false;
    };

    // 捕获 Promise 未处理异常
    window.addEventListener('unhandledrejection', function(e) {
        var msg = '';
        try {
            msg = e.reason ? (e.reason.message || String(e.reason)) : 'unhandledrejection';
        } catch(ex) { msg = 'unhandledrejection'; }
        appendLog({ t: Date.now(), m: msg.substring(0, 250) });
    });

    // 暴露工具方法
    window.CX = window.CX || {};
    window.CX.errorLog = {
        get:   function() { try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch(e) { return []; } },
        clear: function() { try { localStorage.removeItem(LOG_KEY); localStorage.removeItem(LOG_VER_KEY); } catch(e) {} }
    };
})();


// ── Native 崩溃日志收集（APK 专用）──────────────────────────────────────────
// 应用启动时向 CrashLogPlugin 请求上次崩溃的堆栈，存入 localStorage；
// 反馈时自动附带；读取后原生侧文件即删除（一次性）。
// 版本升级后自动清理旧版本残留的崩溃日志，避免误报。
(function() {
    'use strict';
    var CRASH_KEY         = 'cx_native_crash';
    var CRASH_VERSION_KEY = 'cx_native_crash_ver'; // 记录日志对应的 APK 版本
    function fetchNativeCrash() {
        try {
            var p = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CrashLog;
            if (!p || typeof p.getLastCrash !== 'function') return;
            p.getLastCrash().then(function(res) {
                if (res && res.log) {
                    // 从日志第一行提取 "Version: x.x.x"
                    var verLine = res.log.split('\n')[0] || '';
                    var verMatch = verLine.match(/^Version:\s*(.+)/);
                    var logVer = verMatch ? verMatch[1].trim() : '';
                    try {
                        localStorage.setItem(CRASH_KEY, res.log);
                        if (logVer) localStorage.setItem(CRASH_VERSION_KEY, logVer);
                    } catch(e) {}
                }
            }).catch(function() {});
        } catch(e) {}
    }
    // 版本升级时清理旧日志
    function clearStaleVersionLog() {
        try {
            var storedCrashVer = localStorage.getItem(CRASH_VERSION_KEY);
            if (!storedCrashVer) return; // 无版本记录，不清理
            var currentVer = localStorage.getItem('cx_apk_version') || '';
            if (currentVer && currentVer !== storedCrashVer) {
                localStorage.removeItem(CRASH_KEY);
                localStorage.removeItem(CRASH_VERSION_KEY);
            }
        } catch(e) {}
    }
    // bridge 就绪后再调（DOMContentLoaded 后 Capacitor 已初始化）
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            clearStaleVersionLog();
            fetchNativeCrash();
        });
    } else {
        setTimeout(function() { clearStaleVersionLog(); fetchNativeCrash(); }, 0);
    }
    window.CX = window.CX || {};
    window.CX.nativeCrashLog = {
        get:   function() { try { return localStorage.getItem(CRASH_KEY) || ''; } catch(e) { return ''; } },
        clear: function() { try { localStorage.removeItem(CRASH_KEY); localStorage.removeItem(CRASH_VERSION_KEY); } catch(e) {} }
    };
})();


// ── CX.backStack：统一对话框/弹框返回键调度器 ──────────────────────────────
// 所有弹框/面板通过 push(closeFn) 注册，popstate 统一消费；
// nav-stack.js 通过 setFallback 注册页面跳转，作为最终兜底。
(function() {
    'use strict';
    window.CX = window.CX || {};
    var _stack = [];
    var _skip = 0;
    window.addEventListener('popstate', function() {
        if (_skip > 0) { _skip--; return; }
        if (_stack.length > 0) {
            var fn = _stack.pop();
            if (fn) fn();
        } else if (window.CX.backStack._fallback) {
            window.CX.backStack._fallback();
        }
    });
    window.CX.backStack = {
        _fallback: null,
        push: function(fn) {
            _stack.push(fn);
            try { history.pushState({ cxBack: true }, ''); } catch(e) {}
        },
        pop: function() {
            if (_stack.length > 0) {
                _stack.pop();
                _skip++;
                try { history.back(); } catch(e) {}
            }
        },
        size: function() { return _stack.length; },
        setFallback: function(fn) { this._fallback = fn; },
        // Android Chrome PWA 在 location.hash 赋值后会错误触发 popstate；
        // 路由跳转前调用此方法跳过下一次 popstate，避免误触 fallback。
        skipNext: function() { _skip++; },
        // 弃置栈顶 entry（不调 history.back()），用于弹框内发起导航跳转的场景。
        // _skip++ 确保该 pushState 占位条目触发的 popstate 被静默吸收。
        abandon: function() {
            if (_stack.length > 0) { _stack.pop(); _skip++; }
        },
        // 丢弃栈顶 entry，既不调 history.back() 也不增加 _skip。
        // 用于弹框关闭后立即用 replaceState 替换对应 history 条目的场景（如搜索跳转），
        // 此时 pushState 占位条目已被 replaceState 覆盖，无需额外的 _skip 吸收。
        discard: function() {
            if (_stack.length > 0) { _stack.pop(); }
        }
    };

    // ── CX.lockOverlayScroll：弹框遮罩层防滚动穿透 + 防点击穿透（通用工具）──
    // 绑定 touchstart/touchmove/touchend 到 overlay：
    //   • touchmove     — 防滚动穿透（自动识别内部可滚动子元素并处理边界）
    //   • touchend      — 防点击穿透：直接点遮罩时调 preventDefault 阻止浏览器合成 click，
    //                     同时触发可选的 onTapOverlay 回调（由调用方传入关闭逻辑）
    // 返回 cleanup 函数（可选调用，DOM 移除后 GC 自动回收）。
    window.CX.lockOverlayScroll = function(overlay, onTapOverlay) {
        var _tsY = 0;
        function _onTouchStart(e) {
            if (e.touches && e.touches.length) _tsY = e.touches[0].clientY;
        }
        function _onTouchMove(e) {
            // 向上查找 overlay 内最近的可滚动祖先
            var el = e.target;
            var scrollable = null;
            while (el && el !== overlay) {
                var oy = window.getComputedStyle(el).overflowY;
                if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) {
                    scrollable = el;
                    break;
                }
                el = el.parentElement;
            }
            if (scrollable) {
                var down  = e.touches[0].clientY < _tsY;
                var atTop = scrollable.scrollTop <= 0;
                var atBot = scrollable.scrollTop + scrollable.clientHeight >= scrollable.scrollHeight - 1;
                if ((atTop && !down) || (atBot && down)) e.preventDefault();
            } else {
                e.preventDefault();
            }
        }
        function _onTouchEnd(e) {
            // 手指落在遮罩空白区（非内部元素）：阻止合成 click（防穿透），并通知调用方
            if (e.target === overlay) {
                e.preventDefault();
                e.stopPropagation();
                if (onTapOverlay) onTapOverlay();
            }
        }
        overlay.addEventListener('touchstart', _onTouchStart, { passive: true });
        overlay.addEventListener('touchmove',  _onTouchMove,  { passive: false });
        overlay.addEventListener('touchend',   _onTouchEnd,   { passive: false });
        return function() {
            overlay.removeEventListener('touchstart', _onTouchStart);
            overlay.removeEventListener('touchmove',  _onTouchMove);
            overlay.removeEventListener('touchend',   _onTouchEnd);
        };
    };

    // ── CX.openDialog：通用弹框工厂 ─────────────────────────────────────────
    // 统一处理：遮罩创建、lockOverlayScroll、backStack 注册、遮罩点击关闭。
    // opts: { id, html, className, onClose }
    //   id        — 重复打开守卫（可选）
    //   html      — 遮罩内的 innerHTML
    //   className — 遮罩 class，默认 'cx-dialog-mask'
    //   onClose   — 关闭后回调（可选）
    // 返回 { mask, close } 或 null（id 重复时）
    window.CX.openDialog = function(opts) {
        if (opts.id && document.getElementById(opts.id)) return null;
        var mask = document.createElement('div');
        if (opts.id) mask.id = opts.id;
        mask.className = opts.className || 'cx-dialog-mask';
        mask.innerHTML = opts.html || '';
        document.body.appendChild(mask);
        var _closed = false;
        function _destroy() {
            if (_closed) return; _closed = true;
            if (mask.parentNode) mask.parentNode.removeChild(mask);
            if (opts.onClose) opts.onClose();
        }
        // 系统返回键（popstate）触发：只移除 DOM，无需再调 history.back()
        window.CX.backStack.push(function() { _destroy(); });
        // 主动关闭（按钮/遮罩点击）：移除 DOM + 消耗 history 记录
        function close() { _destroy(); window.CX.backStack.pop(); }
        // lockOverlayScroll 统一处理防滚动穿透 + 防点击穿透（touchend → history.back）
        // 点遮罩空白：优先走 history.back()，让 backStack 决定行为（回退历史层或关闭弹框）
        window.CX.lockOverlayScroll(mask, function() { try { history.back(); } catch(e) {} });
        // 桌面/鼠标端：click 处理（移动端因 touchend 已 preventDefault，不会重复触发）
        mask.addEventListener('click', function(e) {
            if (e.target === mask) { e.stopPropagation(); try { history.back(); } catch(e) {} }
        });
        return { mask: mask, close: close };
    };
})();

// 初始化主题切换和字体控制功能
(function() {
    'use strict';
    
    // 字体大小配置
    const fontSizes = [14, 16, 18, 20, 22, 24, 26, 28];
    const defaultSizeIndex = 2; // 默认18px
    let currentSizeIndex = defaultSizeIndex;
    // 状态栏 / meta[name=theme-color] 统一用页面底色 → 沉浸式阅读
    const themeMetaColors = {
        cool: '#f0f3f9',
        warm: '#f3ede4',
        dark: '#101319'
    };
    let pageScrollLockCount = 0;

    function getStoredTheme() {
        try {
            const theme = localStorage.getItem('readingTheme');
            return theme === 'cool' || theme === 'warm' || theme === 'dark' ? theme : null;
        } catch (e) {
            return null;
        }
    }

    function getPreferredTheme() {
        const savedTheme = getStoredTheme();
        if (savedTheme) {
            return savedTheme;
        }
        try {
            return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'cool';
        } catch (e) {
            return 'cool';
        }
    }

    function syncThemeColor(theme) {
        var color = themeMetaColors[theme] || themeMetaColors.cool;
        const metaThemeColor = document.querySelector('meta[name="theme-color"]');
        if (metaThemeColor) {
            metaThemeColor.setAttribute('content', color);
        }
        // 同步 Capacitor 原生状态栏颜色（DOMContentLoaded 后调用，bridge 已就绪）
        try {
            var sb = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.StatusBar;
            if (sb) {
                sb.setBackgroundColor({ color: color });
                // Capacitor StatusBar setStyle 语义：
                //   'DARK'  → setAppearanceLightStatusBars(false) → 白色图标，用于深色背景
                //   'LIGHT' → setAppearanceLightStatusBars(true)  → 黑色图标，用于浅色背景
                sb.setStyle({ style: theme === 'dark' ? 'DARK' : 'LIGHT' });
            }
        } catch (e) {}
    }

    function lockPageScroll() {
        pageScrollLockCount += 1;
        document.documentElement.classList.add('cx-scroll-locked');
        document.body.classList.add('cx-scroll-locked');
    }

    function unlockPageScroll() {
        pageScrollLockCount = Math.max(0, pageScrollLockCount - 1);
        if (pageScrollLockCount === 0) {
            document.documentElement.classList.remove('cx-scroll-locked');
            document.body.classList.remove('cx-scroll-locked');
        }
    }
    
    // 页面加载时创建主题切换UI
    function initDevConsole()  { window.CXDevConsole && window.CXDevConsole.init(); }
    function destroyDevConsole() { window.CXDevConsole && window.CXDevConsole.destroy(); }

    function initThemeToggle() {
        // 内页启动缓存检测：非主页 + PWA standalone + 缓存缺失 → 跳回主页触发安装
        (function() {
            var root = window.CX_ROOT || './';
            if (root === './') return; // 主页自己处理
            var isStandalone = window.navigator.standalone === true ||
                               window.matchMedia('(display-mode: standalone)').matches;
            var isCapacitor = !!(window.Capacitor && window.Capacitor.isNativePlatform &&
                                 window.Capacitor.isNativePlatform());
            if (!isStandalone || isCapacitor || !('caches' in window)) return;
            var storedVersion = null;
            try { storedVersion = localStorage.getItem('cx_pwa_version'); } catch(e) {}
            // 未记录版本（从未安装缓存）：直接跳回主页
            if (!storedVersion) {
                window.location.replace(root + 'index.html');
                return;
            }
            // 有版本记录但缓存可能已被清除：检查 cx-main 是否存在
            caches.keys().then(function(keys) {
                var hasCoreCache = keys.some(function(k) {
                    return k === 'cx-main' || k.indexOf('cx-main-') === 0;
                });
                if (!hasCoreCache) {
                    window.location.replace(root + 'index.html');
                }
            }).catch(function() {});
        })();
        // 查找container元素（优先使用.container，如果没有则使用body）
        const containerEl = document.querySelector('.container') || document.body;
        
        // 创建设置按钮
        const toggleBtn = document.createElement('div');
        toggleBtn.className = 'theme-toggle-btn';
        toggleBtn.onclick = toggleThemePanel;
        toggleBtn.title = '设置';
        toggleBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v6m0 6v6M1 12h6m6 0h6"/><path d="M4.2 4.2l4.3 4.3m5.5 5.5l4.3 4.3M4.2 19.8l4.3-4.3m5.5-5.5l4.3-4.3"/></svg>';
        containerEl.appendChild(toggleBtn);
        
        // 创建遮罩层
        const overlay = document.createElement('div');
        overlay.className = 'theme-panel-overlay';
        overlay.id = 'themePanelOverlay';
        overlay.onclick = function() { window.toggleThemePanel(); };
        document.body.appendChild(overlay);

        // 创建设置面板
        const panel = document.createElement('div');
        panel.className = 'theme-panel';
        panel.id = 'themePanel';
        panel.innerHTML = `
            <div class="theme-panel-header">
                <div class="theme-panel-title">设置</div>
                <button class="theme-panel-close" onclick="toggleThemePanel()" title="关闭">×</button>
            </div>
            
            <div class="theme-section">
                <div class="theme-section-title">阅读模式</div>
                <div class="theme-options">
                    <div class="theme-option" data-theme="warm" onclick="setTheme('warm')">
                        <div class="theme-preview warm"></div>
                        <div class="theme-option-content">
                            <div class="theme-radio"></div>
                            <div class="theme-label">暖色</div>
                        </div>
                    </div>
                    <div class="theme-option" data-theme="cool" onclick="setTheme('cool')">
                        <div class="theme-preview cool"></div>
                        <div class="theme-option-content">
                            <div class="theme-radio"></div>
                            <div class="theme-label">冷色</div>
                        </div>
                    </div>
                    <div class="theme-option" data-theme="dark" onclick="setTheme('dark')">
                        <div class="theme-preview dark"></div>
                        <div class="theme-option-content">
                            <div class="theme-radio"></div>
                            <div class="theme-label">夜间</div>
                        </div>
                    </div>

                </div>
            </div>
            
            <div class="theme-section">
                <div class="theme-section-title">字体大小</div>
                <div class="font-size-slider-container">
                    <span class="font-label-small">A</span>
                    <input type="range" class="font-size-slider" id="fontSizeSlider" 
                           min="0" max="7" step="1" value="2" 
                           oninput="handleFontSliderChange(this.value)">
                    <span class="font-label-large">A</span>
                    <span class="font-size-value" id="fontSizeDisplay">18px</span>
                </div>
            </div>

            <div class="theme-section" id="settingsActionsSection" style="display:none">
                <div class="theme-section-title">操作</div>
                <div class="actions-grid">
                    <button class="action-btn" id="installBtn" style="display:none">
                        <span class="cache-icon">📲</span><span class="cache-text">发送桌面</span>
                    </button>
                    <button class="action-btn" id="androidApkBtn" style="display:none">
                        <span class="cache-icon">📱</span><span class="cache-text">安卓APK</span>
                    </button>
                    <button class="action-btn danger" id="clearDataBtn" style="display:none">
                        <span class="cache-icon">🧹</span><span class="cache-text">清理数据</span>
                    </button>
                    <button class="action-btn" id="checkUpdateBtn" style="display:none">
                        <span class="cache-icon">🔄</span><span class="cache-text">检查更新</span>
                    </button>
                    <button class="action-btn sponsor" id="sponsorBtn" style="display:none">
                        <span class="cache-icon">❤️</span><span class="cache-text">顾念微工</span>
                    </button>
                    <button class="action-btn" id="guideBtn">
                        <span class="cache-icon">📖</span><span class="cache-text">使用说明</span>
                    </button>
                    <button class="action-btn feedback" id="feedbackBtn">
                        <span class="cache-icon">💬</span><span class="cache-text">问题反馈</span>
                    </button>
                    <button class="action-btn" id="resourceMgrBtn">
                        <span class="cache-icon">📦</span><span class="cache-text">资源管理</span>
                    </button>

                </div>
                <div class="cache-status" id="actionStatus"></div>
            </div>
            <div class="theme-section" id="autoCheckSection" style="display:none">
                <div class="theme-section-title">偏好设置</div>
                <div class="pref-row">
                    <div class="pref-label-wrap">
                        <span class="pref-title">自动检查更新</span>
                        <span class="pref-desc">启动时自动检查是否有新版本</span>
                    </div>
                    <label class="pref-toggle">
                        <input type="checkbox" id="autoCheckUpdateToggle">
                        <span class="pref-toggle-slider"></span>
                    </label>
                </div>
            </div>
        `;
        document.body.appendChild(panel);

        // 防滚动穿透：遮罩层外触摸不穿透，面板内触摸正常滚动
        // 传入 toggleThemePanel 作为遮罩点击回调，保证移动端 touchend 也能关闭面板
        window.CX.lockOverlayScroll(overlay, function() { window.toggleThemePanel(); });

        // 加载保存的主题
        const initialTheme = getPreferredTheme();
        document.documentElement.setAttribute('data-theme', initialTheme);
        updateThemeUI(initialTheme);
        syncThemeColor(initialTheme);
        
        // 加载保存的字体大小
        const savedSize = localStorage.getItem('globalFontSize');
        if (savedSize) {
            const savedIndex = fontSizes.indexOf(parseInt(savedSize));
            if (savedIndex !== -1) {
                currentSizeIndex = savedIndex;
                applyFontSize(savedSize);
            }
        }
        updateFontSizeUI();
        
        // 点击外部关闭面板（对话框弹层内的点击不触发）
        document.addEventListener('click', function(e) {
            const panel = document.getElementById('themePanel');
            const btn = document.querySelector('.theme-toggle-btn');
            if (panel && panel.classList.contains('show') && !panel.contains(e.target) && !btn.contains(e.target)) {
                // 若点击发生在任意弹出对话框内（含已从 DOM 移除的，closest 对 detached 仍有效），不关闭面板
                if (e.target.closest && e.target.closest('.cx-dialog-mask')) return;
                var masks = document.querySelectorAll('.cx-dialog-mask');
                for (var i = 0; i < masks.length; i++) {
                    if (masks[i].contains(e.target)) return;
                }
                window.toggleThemePanel(); // 通过统一入口关闭，消耗 history
            }
        });
        
        // ESC键关闭面板
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                const panel = document.getElementById('themePanel');
                if (panel && panel.classList.contains('show')) {
                    window.toggleThemePanel(); // 通过统一入口关闭，消耗 history
                }
            }
        });

        // 初始化操作区按钮（所有页面通用）
        initSettingsActions();

        // 如已开启开发者模式，自动初始化控制台
        try { if (localStorage.getItem('cx_dev_mode') === '1') initDevConsole(); } catch(e) {}

        if (window.matchMedia) {
            var themeQuery = window.matchMedia('(prefers-color-scheme: dark)');
            var handleThemeQueryChange = function(event) {
                if (getStoredTheme()) return;
                var nextTheme = event.matches ? 'dark' : 'cool';
                document.documentElement.setAttribute('data-theme', nextTheme);
                updateThemeUI(nextTheme);
                syncThemeColor(nextTheme);
            };
            if (typeof themeQuery.addEventListener === 'function') {
                themeQuery.addEventListener('change', handleThemeQueryChange);
            } else if (typeof themeQuery.addListener === 'function') {
                themeQuery.addListener(handleThemeQueryChange);
            }
        }
    }

    // 初始化设置面板操作区（唯一实现；页面通过 window.CX.xxx 注册钩子覆盖默认行为）
    function initSettingsActions() {
        window.CX = window.CX || {};
        var section = document.getElementById('settingsActionsSection');
        if (section) section.style.display = 'block';
        var statusEl = document.getElementById('actionStatus');

        // ── 使用时长跟踪：记录首次启动时间 ─────────────────────────
        (function() {
            try {
                if (!localStorage.getItem('cx_first_use')) {
                    localStorage.setItem('cx_first_use', Date.now().toString());
                }
            } catch(e) {}
        })();

        // ── 顾念微工（使用超过 5 分钟后显示）────────────────────────
        (function() {
            try {
                var firstUse = parseInt(localStorage.getItem('cx_first_use') || '0', 10);
                var elapsed = firstUse ? (Date.now() - firstUse) : 0;
                if (elapsed >= 5 * 60 * 1000) {
                    var sponsorBtn = document.getElementById('sponsorBtn');
                    if (sponsorBtn) {
                        sponsorBtn.style.display = 'inline-flex';
                        sponsorBtn.addEventListener('click', showSponsorDialog);
                    }
                }
            } catch(e) {}
        })();

        // ── 使用说明（所有页面）──────────────────────────────────────
        (function() {
            var guideBtn = document.getElementById('guideBtn');
            if (guideBtn) {
                guideBtn.addEventListener('click', showGuideDialog);
            }
        })();

        // ── 反馈问题（所有页面）──────────────────────────────────────
        (function() {
            var feedbackBtn = document.getElementById('feedbackBtn');
            if (feedbackBtn) {
                feedbackBtn.addEventListener('click', showFeedbackDialog);
            }
        })();

        // ── 资源管理（所有用户可见）────────────────────────────────
        (function() {
            var resMgrBtn = document.getElementById('resourceMgrBtn');
            if (!resMgrBtn) return;
            resMgrBtn.addEventListener('click', function() {
                if (window.CXResourcePack && window.CXResourcePack.showCachedDialog)
                    window.CXResourcePack.showCachedDialog();
            });
        })();

        // 环境检测
        var ua = navigator.userAgent;
        var isCapacitor = !!(window.Capacitor && window.Capacitor.isNativePlatform &&
                             window.Capacitor.isNativePlatform());
        var isAndroid = /Android/i.test(ua);
        var isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
        var isStandalone = (window.navigator.standalone === true) ||
                           window.matchMedia('(display-mode: standalone)').matches;

        // ── 清理数据（所有页面）──────────────────────────
        var clearBtn = document.getElementById('clearDataBtn');
        if (clearBtn) {
            clearBtn.style.display = 'inline-flex';
            clearBtn.addEventListener('click', function() {
                if (window.CX.clearData) { window.CX.clearData(); }
                else { defaultPromptClearData(); }
            });
        }

        // ── 检查更新（Capacitor APK / PWA standalone）──────────────────
        var updateBtn = document.getElementById('checkUpdateBtn');
        if (isCapacitor) {
            if (updateBtn) {
                updateBtn.style.display = 'inline-flex';
                updateBtn.addEventListener('click', function() {
                    if (window.AppUpdate && window.AppUpdate.showCloudflareUpdateDialog) {
                        window.AppUpdate.showCloudflareUpdateDialog();
                    }
                });
            }
        } else if (isStandalone && ('caches' in window)) {
            if (updateBtn) {
                updateBtn.style.display = 'inline-flex';
                updateBtn.addEventListener('click', function() {
                    var root = window.CX_ROOT || './';
                    if (window.AppUpdate && window.AppUpdate.showPwaUpdateDialog) {
                        window.AppUpdate.showPwaUpdateDialog({ root: root, statusEl: statusEl });
                    }
                });
            }
        }

        // ── 自动检查更新偏好设置（Capacitor APK / PWA standalone）──────
        if (isCapacitor || (isStandalone && ('caches' in window))) {
            var autoCheckSection = document.getElementById('autoCheckSection');
            var autoCheckToggle  = document.getElementById('autoCheckUpdateToggle');
            if (autoCheckSection) autoCheckSection.style.display = '';
            if (autoCheckToggle) {
                try { autoCheckToggle.checked = localStorage.getItem('cx_auto_check_update') === '1'; } catch(e) {}
                autoCheckToggle.addEventListener('change', function() {
                    try {
                        if (this.checked) {
                            localStorage.setItem('cx_auto_check_update', '1');
                        } else {
                            localStorage.removeItem('cx_auto_check_update');
                        }
                    } catch(e) {}
                });
            }
        }



        // ── 安卓离线 APK（Android 浏览器，非 Capacitor，所有页面可用）──
        var apkBtn = document.getElementById('androidApkBtn');
        if (isAndroid && !isCapacitor) {
            if (apkBtn) {
                apkBtn.style.display = 'inline-flex';
                apkBtn.addEventListener('click', function() {
                    if (window.CX.downloadApk) { window.CX.downloadApk(); return; }
                    var root = window.CX_ROOT || './';
                    if (statusEl) { statusEl.textContent = '正在获取最新版本...'; statusEl.className = 'cache-status'; }
                    fetch(root + 'version.json?t=' + Date.now(), { cache: 'no-cache' })
                        .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
                        .then(function(v) {
                            var f = v.apk_file || ('TeHui-v' + (v.apk_version || v.version) + '.apk');
                            var sz = v.apk_size ? ' (' + (v.apk_size / 1024 / 1024).toFixed(1) + ' MB)' : '';
                            if (statusEl) { statusEl.textContent = '正在下载 v' + (v.apk_version || v.version) + sz + '...'; statusEl.className = 'cache-status success'; }
                            window.open(root + f, '_blank');
                        })
                        .catch(function(e) {
                            if (statusEl) { statusEl.textContent = '获取失败: ' + e.message; statusEl.className = 'cache-status error'; }
                        });
                });
            }
        }

        // ── 安装到桌面（PWA / iOS）────────────────────────
        var installBtn = document.getElementById('installBtn');
        if (installBtn) {
            if (isIOS && !isStandalone) {
                // iOS：直接显示，点击给出操作指引
                installBtn.style.display = 'inline-flex';
                installBtn.addEventListener('click', function() {
                    if (window.CX.installIOS) { window.CX.installIOS(); return; }
                    if (statusEl) {
                        statusEl.innerHTML = '请点击浏览器底部 <strong>分享按钮 ↑</strong>，然后选择 <strong>"添加到主屏幕"</strong>';
                        statusEl.className = 'cache-status';
                    }
                });
            } else {
                // Chrome/Edge：等 beforeinstallprompt 后显示
                window.addEventListener('beforeinstallprompt', function(e) {
                    e.preventDefault();
                    window._pwaInstallPrompt = e;
                    installBtn.style.display = 'inline-flex';
                });
                installBtn.addEventListener('click', function() {
                    if (window.CX.installPWA) { window.CX.installPWA(); return; }
                    var p = window._pwaInstallPrompt;
                    if (!p) return;
                    window._pwaInstallPrompt = null;
                    p.prompt();
                    p.userChoice.then(function() { installBtn.style.display = 'none'; });
                });
            }
        }

    }

    // 清除数据对话框（所有页面共用）
    // onConfirm(selected) selected = 'regular' | 'notes'
    function showClearDialog(onConfirm) {
        var selected = 'regular';
        var dlg = window.CX.openDialog({
            id: 'cxClearDialogMask',
            html: [
                '<div class="cx-dialog">',
                '  <div class="cx-dialog-title">清除数据</div>',
                '  <div class="cx-dialog-desc">选择要清除的内容</div>',
                '  <div class="cx-dialog-opts">',
                '    <div class="cx-dialog-opt selected" data-val="regular">',
                '      <div class="cx-dialog-opt-icon">🧾</div>',
                '      <div class="cx-dialog-opt-body">',
                '        <div class="cx-dialog-opt-title">常规数据</div>',
                '        <div class="cx-dialog-opt-sub">离线缓存、阅读进度、字体语速设置<br>保留划线笔记</div>',
                '      </div>',
                '    </div>',
                '    <div class="cx-dialog-opt" data-val="notes">',
                '      <div class="cx-dialog-opt-icon">📝</div>',
                '      <div class="cx-dialog-opt-body">',
                '        <div class="cx-dialog-opt-title">划线笔记</div>',
                '        <div class="cx-dialog-opt-sub">仅清除所有划线和高亮<br>保留其他设置</div>',
                '      </div>',
                '    </div>',
                '  </div>',
                '  <div class="cx-dialog-actions">',
                '    <button class="cx-dialog-cancel" data-action="cancel">取消</button>',
                '    <button class="cx-dialog-confirm" data-action="confirm">确定清除</button>',
                '  </div>',
                '</div>'
            ].join('')
        });
        if (!dlg) return;

        // 用事件委托代替多个 getElementById，避免时序问题
        dlg.mask.addEventListener('click', function(e) {
            var t = e.target;
            // 选项卡片点击
            var opt = t.closest ? t.closest('.cx-dialog-opt') : null;
            if (opt && opt.getAttribute('data-val')) {
                selected = opt.getAttribute('data-val');
                var opts = dlg.mask.querySelectorAll('.cx-dialog-opt');
                for (var i = 0; i < opts.length; i++) { opts[i].classList.remove('selected'); }
                opt.classList.add('selected');
                return;
            }
            // 取消按钮（t === mask 由 openDialog 统一处理）
            if (t.getAttribute('data-action') === 'cancel') {
                dlg.close();
                return;
            }
            // 确定清除按钮
            if (t.getAttribute('data-action') === 'confirm') {
                dlg.close();
                var statusEl = document.getElementById('actionStatus');
                if (statusEl) { statusEl.textContent = '🧹 正在清理中，请稍候...'; statusEl.className = 'cache-status'; }
                if (onConfirm) { onConfirm(selected); return; }
                // 内置实现（非主页）
                if (selected === 'notes') {
                    var doReload = function() {
                        try { localStorage.removeItem('cx_highlights'); } catch(e) {}
                        try { localStorage.removeItem('cx_highlights_bak'); } catch(e) {}
                        try { localStorage.removeItem('cx_highlights_bak_ts'); } catch(e) {}
                        try { localStorage.removeItem('cx_hl_migrated'); } catch(e) {}
                        if (statusEl) { statusEl.textContent = '✓ 划线笔记已清除，即将刷新...'; statusEl.className = 'cache-status success'; }
                        window.location.reload(true);
                    };
                    var clearP = (window.CXHighlight && window.CXHighlight.clearAllHighlightsForce)
                        ? window.CXHighlight.clearAllHighlightsForce()
                        : Promise.resolve();
                    clearP.then(doReload).catch(doReload);
                    return;
                }
                var steps = [];
                if ('serviceWorker' in navigator) {
                    steps.push(navigator.serviceWorker.getRegistrations().then(function(regs) {
                        return Promise.all(regs.map(function(r) { return r.unregister(); }));
                    }).catch(function() {}));
                }
                if ('caches' in window) {
                    steps.push(caches.keys().then(function(keys) {
                        return Promise.all(keys.map(function(k) { return caches.delete(k); }));
                    }).catch(function() {}));
                }
                if (window.localforage) {
                    steps.push(window.localforage.keys().then(function(keys) {
                        return Promise.all(keys.filter(function(k) { return k && k.indexOf('cx_search') === 0; }).map(function(k) { return window.localforage.removeItem(k); }));
                    }).catch(function() {}));
                }
                try {
                    var theme = localStorage.getItem('readingTheme');
                    var fontSize = localStorage.getItem('globalFontSize');
                    var highlights = localStorage.getItem('cx_highlights');
                    var firstUse = localStorage.getItem('cx_first_use');  // 保留赞助显示时间
                    for (var i = localStorage.length - 1; i >= 0; i--) {
                        var k = localStorage.key(i); if (k) localStorage.removeItem(k);
                    }
                    if (theme)      localStorage.setItem('readingTheme', theme);
                    if (fontSize)   localStorage.setItem('globalFontSize', fontSize);
                    if (highlights) localStorage.setItem('cx_highlights', highlights);
                    if (firstUse)   localStorage.setItem('cx_first_use', firstUse);
                } catch(ex) {}
                Promise.all(steps).then(function() {
                    // 完整页面重载而非 hash 切换，确保 SW 真正注销
                    try{window.history.replaceState(null,'',window.location.pathname);}catch(e){}
                    window.location.reload();
                });
            }
        });
    }
    window.CX = window.CX || {};
    window.CX.showClearDialog = showClearDialog;

    function defaultPromptClearData() { showClearDialog(); }

    // 使用说明对话框
    function showGuideDialog() {
        var _guideSec = function(title, items) {
            var rows = items.map(function(it) {
                return '<div style="display:flex;gap:8px;padding:5px 0;align-items:flex-start">' +
                    '<span style="flex-shrink:0;width:20px;text-align:center">' + it[0] + '</span>' +
                    '<div style="flex:1;min-width:0"><span style="font-weight:500;color:var(--heading)">' + it[1] + '</span>' +
                    (it[2] ? '<div style="font-size:12px;color:var(--text-secondary);margin-top:2px;line-height:1.5">' + it[2] + '</div>' : '') +
                    '</div></div>';
            }).join('');
            return '<div style="margin-bottom:14px">' +
                '<div style="font-size:14px;font-weight:600;color:var(--brand);margin-bottom:8px;padding-bottom:5px;border-bottom:1px solid var(--border)">' + title + '</div>' +
                rows + '</div>';
        };

        var html = '<div class="cx-dialog" style="max-width:420px;padding:0;position:relative;max-height:80vh;display:flex;flex-direction:column">' +
            '<div style="padding:14px 16px 10px;font-size:16px;font-weight:600;color:var(--heading);flex-shrink:0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">' +
                '<span>📖 使用说明</span>' +
                '<button id="cxGuideClose" style="width:28px;height:28px;border-radius:50%;border:none;background:transparent;color:var(--text-secondary);cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center" title="关闭">×</button>' +
            '</div>' +
            '<div style="flex:1;overflow-y:auto;padding:12px 16px 16px;line-height:1.6;font-size:13px;color:var(--text)">' +
                _guideSec('🎨 阅读设置', [
                    ['🌓', '主题切换', '暖色 / 冷色 / 夜间三种模式，未手动选择时跟随系统深浅色自动切换'],
                    ['🔤', '字体大小', '拖动滑块调节正文字号（14px ~ 28px），设置自动保存，所有页面生效']
                ]) +
                _guideSec('📚 内容浏览', [
                    ['📋', '纲目', '大纲结构视图，顶部有「大纲 / 大中纲 / 全部」按钮控制展开层级，点击每级前的符号可单独展开或收起'],
                    ['📖', '听抄', '信息全文内容，多层级结构展示（大点、中点、小点等），适合深度阅读'],
                    ['🌅', '晨读翻页', '顶部星期标签可快速跳转，左右滑动或点「上一天 / 下一天」按钮切换，打开时自动定位到当天星期'],
                    ['🌄', '晨读内容', '每天含纲目、晨兴喂养（经文 + 短文）、信息选读、参读等板块'],
                    ['🎵', '诗歌', '诗歌图片浏览，点击图片可全屏查看'],
                    ['📝', '职事摘录', '职事信息摘录，按段落分段展示'],
                    ['📜', '标语', '训练标语 / 口号浏览，从目录页顶部导航进入'],
                    ['🖼️', '标语诗歌', '标语诗歌图片浏览，从目录页或标语页进入'],
                    ['📑', '视图记忆', '每篇自动记住上次阅读的视图（纲目 / 听抄 / 晨读等），下次打开直接进入']
                ]) +
                _guideSec('🔊 朗读功能', [
                    ['▶️', '播放控制', '底部控制栏：播放 / 暂停按钮、进度条拖动跳转、时间显示'],
                    ['⏩', '变速朗读', '支持 0.5x / 0.75x / 1x / 1.25x / 1.5x / 2x 六档变速，朗读中也可随时切换'],
                    ['🔄', '循环播放', '点击循环按钮开启循环模式，反复朗读当前页面内容'],
                    ['💡', '朗读高亮', '朗读时自动高亮当前段落，跟随朗读进度移动，方便定位阅读'],
                    ['📖', '经文朗读', '朗读时经文缩写（如「太五3」）自动展开为完整书名（「马太福音五章三节」）'],
                    ['📱', '后台朗读', '安卓 APK 支持锁屏 / 后台朗读，通知栏显示标题、暂停 / 停止按钮'],
                    ['🎧', '锁屏信息', '锁屏界面显示篇章标题和训练名称，支持系统媒体控制']
                ]) +
                _guideSec('📜 经文系统', [
                    ['✝️', '经文弹框', '点击正文中的经文引用（如「太五3」），弹出窗口显示完整经文内容'],
                    ['🔗', '串珠经文', '弹框内点击串珠编号，展开相关联的经文列表，可继续点击查看'],
                    ['📌', '注脚查看', '弹框内点击注脚编号，展开对应注解内容'],
                    ['🔍', '自动检测', '正文中的中文经文引用（如「罗马书五章十七节」）自动识别为可点击链接'],
                    ['📖', '读经横幅', '每篇顶部的「读经」栏可点击，一次性查看所有引用经文']
                ]) +
                _guideSec('🔍 全文搜索', [
                    ['🔎', '搜索入口', '主页搜索按钮、各页面顶部🔍按钮均可打开全屏搜索'],
                    ['📝', '多词搜索', '输入多个关键词（空格分隔），匹配任意一个词即显示结果'],
                    ['📂', '分组展示', '搜索结果按训练分组，显示篇号、类型（听抄 / 晨读 / 纲目等）和内容预览'],
                    ['📍', '精准跳转', '点击搜索结果直接跳转到对应段落，搜索关键词自动高亮显示'],
                    ['📦', '按需加载', '搜索索引按需加载已访问的训练数据，访问越多搜索范围越广']
                ]) +
                _guideSec('✏️ 划线笔记', [
                    ['🖍️', '添加划线', '长按选择文字即可添加高亮、颜色标记或下划线'],
                    ['🗑️', '删除标记', '点击已有划线，在弹出菜单中点击「删除」即可移除标记'],
                    ['🎨', '修改标记', '点击已有划线，点击「修改 ▾」可更改高亮颜色或切换下划线样式'],
                    ['📓', '添加笔记', '点击划线旁的 📝 笔记图标，或点击划线后选择「笔记」按钮，输入笔记内容'],
                    ['📝', '编辑 / 删除笔记', '点击划线后选择「修改笔记」编辑内容，或点击笔记旁的「删除」移除'],
                    ['👁️', '查看笔记', '有笔记的划线旁显示 📝 图标，点击可预览笔记全文，支持展开查看'],
                    ['💾', '本地存储', '所有划线和笔记保存在本地 IndexedDB，清除浏览器数据前不会丢失']
                ]) +
                _guideSec('📦 资源与离线', [
                    ['📦', '资源管理', '设置中的「资源管理」可管理训练资源包，包含三个标签页'],
                    ['📋', '默认标签', '显示当前版本内置的训练，可删除或重新安装'],
                    ['📚', '历史标签', '显示可下载的历史合辑训练包，支持单个或全部下载'],
                    ['📥', '导入标签', '支持导入本地 TXT 格式训练文件（独立文件或历史合辑，使用电脑版 iSilo 将 PDB 转换成 TXT）'],
                    ['📴', '离线使用', 'PWA / APK 支持完全离线阅读，已缓存的训练无需网络连接']
                ]) +
                _guideSec('⚙️ 其他功能', [
                    ['🧭', '浮动导航栏', '向下滚动后从顶部滑入快捷导航栏，含视图切换和⚙设置按钮，5 秒无操作自动隐藏'],
                    ['↩️', '返回导航', 'APK / PWA 中按系统返回键逐层回退：内容→目录→主页→退出；弹框打开时返回键关闭弹框'],
                    ['📍', '位置记忆', '自动记住每个页面（含晨读每天）的滚动位置，下次打开自动恢复'],
                    ['🖼️', '图片查看器', '单图：双指缩放、双击放大 / 还原、拖动平移；多图：上下滑动浏览全部图片'],
                    ['🔄', '检查更新', 'APK 从 GitHub Releases 检查新版本并分块下载安装；PWA 通过 version.json 检查并提示更新'],
                    ['📲', '安装桌面', 'PWA 可添加到手机桌面（Chrome / Safari「添加到主屏幕」），像原生 App 一样使用'],
                    ['🧹', '清理数据', '设置中「清理数据」可选清除常规数据（缓存、进度、设置）或仅清除划线笔记']
                ]) +
            '</div>' +
            '</div>';

        var dlg = window.CX.openDialog({
            id: 'cxGuideDialogMask',
            html: html
        });
        if (!dlg) return;

        var closeBtn = document.getElementById('cxGuideClose');
        if (closeBtn) closeBtn.addEventListener('click', dlg.close);
    }

    // 赞助对话框
    function showSponsorDialog() {
        var SPONSOR_SERVERS = (window.CX_SERVERS && window.CX_SERVERS.cloudflare) || [];
        var imgFiles = { wx: 'images/zanzhu-wx.png', zfb: 'images/zanzhu-zfb.jpg' };

        var dlg = window.CX.openDialog({
            id: 'cxSponsorMask',
            html: [
                '<div class="cx-sponsor-box">',
                '  <div class="cx-sponsor-close" id="cxSponsorClose">×</div>',
                '  <div class="cx-sponsor-title">❤️ 顾念微工</div>',
                '  <div class="cx-sponsor-desc">蒙福有余，可助这盏灯不灭 🌟</div>',
                '  <div class="cx-sponsor-tabs">',
                '    <button class="cx-sponsor-tab active" data-type="wx">🟢 微信</button>',
                '    <button class="cx-sponsor-tab" data-type="zfb">🔵 支付宝</button>',
                '  </div>',
                '  <div class="cx-sponsor-img-wrap" id="cxSponsorImgWrap"></div>',
                '</div>'
            ].join('')
        });
        if (!dlg) return;

        // 关闭 & 标签切换（t === mask 空白区由 openDialog 统一处理）
        dlg.mask.addEventListener('click', function(e) {
            var t = e.target;
            if (t.id === 'cxSponsorClose') { dlg.close(); return; }
            var tab = t.closest ? t.closest('.cx-sponsor-tab') : (t.classList.contains('cx-sponsor-tab') ? t : null);
            if (tab && tab.dataset.type) {
                dlg.mask.querySelectorAll('.cx-sponsor-tab').forEach(function(b) { b.classList.remove('active'); });
                tab.classList.add('active');
                loadImg(tab.dataset.type);
            }
        });

        // 使用统一图片加载工具
        function loadImg(type) {
            var imgWrap = document.getElementById('cxSponsorImgWrap');
            if (!imgWrap) return;
            CX.loadRemoteImage(imgWrap, SPONSOR_SERVERS, imgFiles[type],
                type === 'wx' ? '微信赞助二维码' : '支付宝赞助二维码',
                {
                    className: 'cx-sponsor-qr',
                    loadingText: '加载中…',
                    errorText: '加载失败',
                    onLoad: function(img) {
                        img.style.cursor = 'zoom-in';
                        img.addEventListener('click', function() {
                            if (window.openImageViewer) window.openImageViewer(img.src);
                        });
                    }
                }
            );
        }

        // 初始加载微信
        loadImg('wx');
    }

    // 反馈问题对话框
    function showFeedbackDialog() {
        var PUSH_URLS = (window.CX_SERVERS && window.CX_SERVERS.push) || [];
        var MAX_LEN = 500;

        var dlg = window.CX.openDialog({
            id: 'cxFeedbackMask',
            html: [
                '<div class="cx-feedback-box">',
                '  <div class="cx-feedback-header">',
                '    <div class="cx-feedback-title">💬 反馈问题</div>',
                '    <button class="cx-feedback-close" id="cxFeedbackClose">×</button>',
                '  </div>',
                '  <div class="cx-feedback-body">',
                '    <textarea class="cx-feedback-textarea" id="cxFeedbackText" maxlength="' + MAX_LEN + '" placeholder="请描述您遇到的问题或建议…"></textarea>',
                '    <div class="cx-feedback-count" id="cxFeedbackCount">0/' + MAX_LEN + '</div>',
                '    <div class="cx-feedback-tip">⚠️ 请先确认已是最新版本，部分问题在新版中已修复。</div>',
                '    <div class="cx-feedback-status" id="cxFeedbackStatus"></div>',
                '  </div>',
                '  <div class="cx-feedback-actions">',
                '    <button class="cx-feedback-cancel" id="cxFeedbackCancelBtn">取消</button>',
                '    <button class="cx-feedback-submit" id="cxFeedbackSubmitBtn">发送</button>',
                '  </div>',
                '</div>'
            ].join('')
        });
        if (!dlg) return;

        setTimeout(function() {
            var ta = document.getElementById('cxFeedbackText');
            if (ta) ta.focus();
        }, 100);

        var closeBtn = document.getElementById('cxFeedbackClose');
        if (closeBtn) closeBtn.addEventListener('click', dlg.close);

        var cancelBtn = document.getElementById('cxFeedbackCancelBtn');
        if (cancelBtn) cancelBtn.addEventListener('click', dlg.close);

        var textarea = document.getElementById('cxFeedbackText');
        var countEl = document.getElementById('cxFeedbackCount');
        if (textarea && countEl) {
            var _composing = false;
            function updateCount() {
                countEl.textContent = textarea.value.length + '/' + MAX_LEN;
            }
            textarea.addEventListener('compositionstart', function() { _composing = true; });
            textarea.addEventListener('compositionend', function() { _composing = false; updateCount(); });
            textarea.addEventListener('input', function() { if (!_composing) updateCount(); });
        }

        var submitBtn = document.getElementById('cxFeedbackSubmitBtn');
        var statusEl = document.getElementById('cxFeedbackStatus');
        if (submitBtn) {
            submitBtn.addEventListener('click', function() {
                var text = textarea ? textarea.value.trim() : '';
                if (!text) {
                    if (statusEl) { statusEl.textContent = '请输入反馈内容'; statusEl.className = 'cx-feedback-status error'; }
                    return;
                }
                submitBtn.disabled = true;
                submitBtn.textContent = '发送中…';
                if (statusEl) { statusEl.textContent = ''; statusEl.className = 'cx-feedback-status'; }

                // 收集设备信息
                var ua = navigator.userAgent || '';
                var platform = navigator.platform || '';
                var screenInfo = (screen.width || 0) + 'x' + (screen.height || 0);
                var appVer = '';
                try {
                    var vEl = document.querySelector('meta[name="app-version"]');
                    if (vEl) appVer = vEl.getAttribute('content') || '';
                    if (!appVer) appVer = localStorage.getItem('cx_apk_version') || localStorage.getItem('cx_pwa_version') || '';
                } catch(e) {}

                // 运行环境：APK / PWA / 浏览器
                var runEnv = '浏览器';
                try {
                    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
                        runEnv = 'APK';
                    } else if (window.navigator.standalone === true ||
                               (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)) {
                        runEnv = 'PWA';
                    }
                } catch(e) {}

                // 拆解 UA 字段
                function parseUA(uaStr) {
                    var lines = [];
                    // OS + 机型
                    var os = '';
                    var m;
                    if ((m = uaStr.match(/Android\s+([\d.]+)/i))) {
                        os = 'Android ' + m[1];
                        // 精确匹配 "; 设备型号 Build/" 或 "; 设备型号)"，不用贪婪 [^)]*
                        var dev = uaStr.match(/;\s*([^;()]+?)\s+Build\//i) ||
                                  uaStr.match(/;\s*([^;()]+?)\s*\)/i);
                        if (dev) {
                            var model = dev[1].trim();
                            // 排除 "Android X.X" 本身
                            if (!/^Android\s/i.test(model) && !/^Linux$/i.test(model)) {
                                os += ' / ' + model;
                            }
                        }
                    } else if ((m = uaStr.match(/iPhone OS ([\d_]+)/i))) {
                        os = 'iOS ' + m[1].replace(/_/g, '.');
                    } else if ((m = uaStr.match(/iPad.*OS ([\d_]+)/i))) {
                        os = 'iPadOS ' + m[1].replace(/_/g, '.');
                    } else if ((m = uaStr.match(/Windows NT ([\d.]+)/i))) {
                        var winMap = {'10.0':'10/11','6.3':'8.1','6.2':'8','6.1':'7'};
                        os = 'Windows ' + (winMap[m[1]] || m[1]);
                    } else if ((m = uaStr.match(/Mac OS X ([\d_]+)/i))) {
                        os = 'macOS ' + m[1].replace(/_/g, '.');
                    } else if (/Linux/i.test(uaStr)) {
                        os = 'Linux';
                    }
                    if (os) lines.push('系统: ' + os);
                    // 浏览器 / WebView
                    var browser = '';
                    if (/wv\)/.test(uaStr) || /; wv/.test(uaStr)) {
                        var wvVer = uaStr.match(/Chrome\/([\d.]+)/i);
                        browser = 'WebView (Chrome/' + (wvVer ? wvVer[1] : '?') + ')';
                    } else if ((m = uaStr.match(/Edg\/([\d.]+)/i))) {
                        browser = 'Edge ' + m[1];
                    } else if ((m = uaStr.match(/OPR\/([\d.]+)/i))) {
                        browser = 'Opera ' + m[1];
                    } else if ((m = uaStr.match(/Chrome\/([\d.]+)/i))) {
                        browser = 'Chrome ' + m[1];
                    } else if ((m = uaStr.match(/Firefox\/([\d.]+)/i))) {
                        browser = 'Firefox ' + m[1];
                    } else if ((m = uaStr.match(/Version\/([\d.]+).*Safari/i))) {
                        browser = 'Safari ' + m[1];
                    }
                    if (browser) lines.push('浏览器: ' + browser);
                    return lines;
                }
                var uaLines = parseUA(ua);

                function doSend(ip, region) {
                    var ipStr = region ? ip + ' (' + region + ')' : ip;
                    var deviceLines = [
                        'IP: ' + ipStr,
                        '环境: ' + runEnv,
                        '平台: ' + platform,
                        '屏幕: ' + screenInfo,
                        appVer ? '版本: ' + appVer : '',
                    ].concat(uaLines).filter(Boolean).join('\n');

                    // 附加 JS 错误日志
                    var errorLog = (window.CX && window.CX.errorLog) ? window.CX.errorLog.get() : [];
                    var logLines = '';
                    if (errorLog.length > 0) {
                        var fmt = errorLog.slice(-12).map(function(e) {
                            var d = new Date(e.t);
                            var ts = (d.getMonth()+1) + '/' + d.getDate() + ' '
                                   + String(d.getHours()).padStart(2,'0') + ':'
                                   + String(d.getMinutes()).padStart(2,'0') + ':'
                                   + String(d.getSeconds()).padStart(2,'0');
                            return '[' + ts + '] ' + (e.s ? e.s + ' ' : '') + e.m;
                        }).join('\n');
                        logLines = '\n\n--- 错误日志 ---\n' + fmt;
                    }

                    // 附加原生崩溃日志（APK 闪退后下次启动时写入）
                    var crashLog = (window.CX && window.CX.nativeCrashLog) ? window.CX.nativeCrashLog.get() : '';
                    if (crashLog) {
                        logLines += '\n\n--- 崩溃日志 ---\n' + crashLog.substring(0, 1200);
                    }

                    var content = text + '\n\n---\n' + deviceLines + logLines;

                    function tryPush(idx) {
                        if (idx >= PUSH_URLS.length) {
                            submitBtn.disabled = false;
                            submitBtn.textContent = '发送';
                            if (statusEl) { statusEl.textContent = '发送失败，请稍后重试'; statusEl.className = 'cx-feedback-status error'; }
                            return;
                        }
                        var ctrl = new AbortController();
                        var timer = setTimeout(function() { ctrl.abort(); }, 10000);
                        fetch(PUSH_URLS[idx], {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ title: '用户反馈', content: content }),
                            signal: ctrl.signal
                        })
                        .then(function(r) {
                            clearTimeout(timer);
                            if (!r.ok) throw new Error('HTTP ' + r.status);
                            return r.json();
                        })
                        .then(function() {
                            // 发送成功，清除错误日志和崩溃日志
                            if (window.CX && window.CX.errorLog) window.CX.errorLog.clear();
                            if (window.CX && window.CX.nativeCrashLog) window.CX.nativeCrashLog.clear();
                            if (statusEl) { statusEl.textContent = '✓ 发送成功，感谢您的反馈！'; statusEl.className = 'cx-feedback-status success'; }
                            setTimeout(dlg.close, 1800);
                        })
                        .catch(function() { clearTimeout(timer); tryPush(idx + 1); });
                    }
                    tryPush(0);
                }

                // 获取真实 IP 及归属地（多级降级，每次最多等 5s）
                // ipip.net 直接返回 "IP: 1.2.3.4 来自于：中国 广东 广州"，一次拿到 IP+地区
                // ipinfo.io / ipapi.co 只返回纯 IP，额外请求 ipapi.co/json 补充地区
                var _ip = window.CX_SERVERS && window.CX_SERVERS.ipApis;
                var IP_APIS = [
                    {
                        url: (_ip && _ip[0]) || '',
                        parse: function(t) {
                            var m = t.match(/(\d{1,3}(?:\.\d{1,3}){3})/);
                            if (!m) return null;
                            var ip = m[1];
                            var rm = t.match(/来自于[：:]\s*(.+)/);
                            var region = rm ? rm[1].trim().replace(/\s+/g, ' ') : '';
                            return { ip: ip, region: region };
                        }
                    },
                    {
                        url: (_ip && _ip[1]) || '',
                        parse: function(t) {
                            try {
                                var d = JSON.parse(t);
                                var ip = d.ip || '';
                                var parts = [d.country, d.region, d.city].filter(Boolean);
                                return ip ? { ip: ip, region: parts.join(' ') } : null;
                            } catch(e) { return null; }
                        }
                    }
                ];
                function fetchIp(idx) {
                    if (idx >= IP_APIS.length) { doSend('未知', ''); return; }
                    var api = IP_APIS[idx];
                    var ctrl = new AbortController();
                    var timer = setTimeout(function() { ctrl.abort(); }, 5000);
                    fetch(api.url, { cache: 'no-cache', signal: ctrl.signal })
                        .then(function(r) { clearTimeout(timer); return r.text(); })
                        .then(function(t) {
                            var res = api.parse(t);
                            if (res && res.ip) { doSend(res.ip, res.region || ''); } else { fetchIp(idx + 1); }
                        })
                        .catch(function() { clearTimeout(timer); fetchIp(idx + 1); });
                }
                fetchIp(0);
            });
        }
    }

    function closeThemePanelInternal(panel, overlay) {
        panel.classList.remove('show');
        if (overlay) overlay.classList.remove('show');
        unlockPageScroll();
    }

    // 切换主题面板显示/隐藏
    window.toggleThemePanel = function() {
        var panel = document.getElementById('themePanel');
        if (!panel) return;
        var overlay = document.getElementById('themePanelOverlay');
        var willShow = !panel.classList.contains('show');
        if (willShow) {
            panel.classList.add('show');
            if (overlay) overlay.classList.add('show');
            lockPageScroll();
            // 打开：push 关闭回调
            window.CX.backStack.push(function() {
                closeThemePanelInternal(panel, overlay);
            });
        } else {
            closeThemePanelInternal(panel, overlay);
            // 手动关闭：消耗对应 history 记录
            window.CX.backStack.pop();
        }
    };
    
    // 设置主题
    window.setTheme = function(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        try {
            localStorage.setItem('readingTheme', theme);
        } catch (e) {}
        updateThemeUI(theme);
        syncThemeColor(theme);
    };
    
    // 更新主题UI状态
    function updateThemeUI(theme) {
        document.querySelectorAll('.theme-option').forEach(function(option) {
            if (option.getAttribute('data-theme') === theme) {
                option.classList.add('active');
            } else {
                option.classList.remove('active');
            }
        });
    }
    
    // 应用字体大小
    function applyFontSize(size) {
        document.body.style.fontSize = size + 'px';
        localStorage.setItem('globalFontSize', size);
    }
    
    // 更新字体大小UI
    function updateFontSizeUI() {
        const size = fontSizes[currentSizeIndex];
        const display = document.getElementById('fontSizeDisplay');
        if (display) {
            display.textContent = size + 'px';
        }
        
        // 更新滑块位置
        const slider = document.getElementById('fontSizeSlider');
        if (slider) {
            slider.value = currentSizeIndex;
        }
    }
    
    // 滑块变化处理
    window.handleFontSliderChange = function(value) {
        const index = parseInt(value);
        if (index >= 0 && index < fontSizes.length) {
            currentSizeIndex = index;
            const size = fontSizes[currentSizeIndex];
            applyFontSize(size);
            updateFontSizeUI();
        }
    };
    
    // 减小字体
    window.decreaseFontSize = function() {
        if (currentSizeIndex > 0) {
            currentSizeIndex--;
            const size = fontSizes[currentSizeIndex];
            applyFontSize(size);
            updateFontSizeUI();
        }
    };
    
    // 增大字体
    window.increaseFontSize = function() {
        if (currentSizeIndex < fontSizes.length - 1) {
            currentSizeIndex++;
            const size = fontSizes[currentSizeIndex];
            applyFontSize(size);
            updateFontSizeUI();
        }
    };
    
    // 重置字体
    window.resetFontSize = function() {
        currentSizeIndex = defaultSizeIndex;
        const size = fontSizes[currentSizeIndex];
        applyFontSize(size);
        updateFontSizeUI();
    };
    
    // 导出函数供底部控制栏使用
    window.CXFontControl = {
        decrease: decreaseFontSize,
        increase: increaseFontSize,
        reset: resetFontSize
    };
    
    // DOM加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initThemeToggle);
    } else {
        initThemeToggle();
    }
})();
