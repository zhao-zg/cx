/**
 * 主题切换和字体控制功能模块
 * 支持暖色/冷色模式切换和字体大小调整
 */

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
        setFallback: function(fn) { this._fallback = fn; }
    };
})();

// 初始化主题切换和字体控制功能
(function() {
    'use strict';
    
    // 字体大小配置
    const fontSizes = [14, 16, 18, 20, 22, 24, 26, 28];
    const defaultSizeIndex = 2; // 默认18px
    let currentSizeIndex = defaultSizeIndex;
    
    // 页面加载时创建主题切换UI
    function initThemeToggle() {
        // 查找container元素（优先使用.container，如果没有则使用body）
        const containerEl = document.querySelector('.container') || document.body;
        
        // 创建设置按钮
        const toggleBtn = document.createElement('div');
        toggleBtn.className = 'theme-toggle-btn';
        toggleBtn.onclick = toggleThemePanel;
        toggleBtn.title = '设置';
        toggleBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v6m0 6v6M1 12h6m6 0h6"/><path d="M4.2 4.2l4.3 4.3m5.5 5.5l4.3 4.3M4.2 19.8l4.3-4.3m5.5-5.5l4.3-4.3"/></svg>';
        containerEl.appendChild(toggleBtn);
        
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
                </div>
                <div class="font-size-value" id="fontSizeDisplay">18px</div>
                <div class="font-size-indicator" id="fontSizeIndicator">档位 3/8</div>
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
                    <button class="action-btn" id="cacheAllBtn" style="display:none">
                        <span class="cache-icon">📦</span><span class="cache-text">缓存数据</span>
                    </button>
                    <button class="action-btn" id="checkUpdateBtn" style="display:none">
                        <span class="cache-icon">🔄</span><span class="cache-text">检查更新</span>
                    </button>
                    <button class="action-btn sponsor" id="sponsorBtn" style="display:none">
                        <span class="cache-icon">❤️</span><span class="cache-text">赞助作者</span>
                    </button>
                </div>
                <div class="cache-status" id="actionStatus"></div>
            </div>
        `;
        document.body.appendChild(panel);
        
        // 加载保存的主题
        const savedTheme = localStorage.getItem('readingTheme') || 'cool';
        document.documentElement.setAttribute('data-theme', savedTheme);
        updateThemeUI(savedTheme);
        
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
                // 若点击发生在弹出对话框内，不关闭面板
                var dialogMask = document.getElementById('cxClearDialogMask');
                if (dialogMask && dialogMask.contains(e.target)) return;
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

        // ── 赞助作者（使用超过 10 分钟后显示）────────────────────────
        (function() {
            try {
                var firstUse = parseInt(localStorage.getItem('cx_first_use') || '0', 10);
                var elapsed = firstUse ? (Date.now() - firstUse) : 0;
                if (elapsed >= 10 * 60 * 1000) {
                    var sponsorBtn = document.getElementById('sponsorBtn');
                    if (sponsorBtn) {
                        sponsorBtn.style.display = 'inline-flex';
                        sponsorBtn.addEventListener('click', showSponsorDialog);
                    }
                }
            } catch(e) {}
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

        // ── 检查更新（Capacitor APK）──────────────────────
        if (isCapacitor) {
            var updateBtn = document.getElementById('checkUpdateBtn');
            if (updateBtn) {
                updateBtn.style.display = 'inline-flex';
                updateBtn.addEventListener('click', function() {
                    if (window.AppUpdate && window.AppUpdate.showCloudflareUpdateDialog) {
                        window.AppUpdate.showCloudflareUpdateDialog();
                    }
                });
            }
        }

        // ── 安卓离线 APK（Android 浏览器，非 Capacitor，所有页面可用）──
        if (isAndroid && !isCapacitor) {
            var apkBtn = document.getElementById('androidApkBtn');
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

        // ── 缓存数据（PWA standalone 模式，所有页面）──────────────────
        if (isStandalone && ('caches' in window)) {
            var cacheBtn = document.getElementById('cacheAllBtn');
            if (cacheBtn) {
                // 初始化按钮状态：已缓存则显示 ✅
                (function() {
                    var flag = null;
                    try { flag = localStorage.getItem('cx_all_cached'); } catch(e) {}
                    if (flag) {
                        caches.keys().then(function(keys) {
                            if (keys.some(function(k) { return k.indexOf('cx-') === 0; })) {
                                cacheBtn.querySelector('.cache-icon').textContent = '✅';
                                cacheBtn.querySelector('.cache-text').textContent = '已缓存';
                            }
                        });
                    }
                })();
                cacheBtn.style.display = 'inline-flex';
                cacheBtn.addEventListener('click', function() {
                    if (window.CX && window.CX.cacheAll) {
                        window.CX.cacheAll(document.getElementById('actionStatus'));
                    } else {
                        // 非主页：跳转主页触发缓存
                        var root = window.CX_ROOT || '../';
                        window.location.href = root + 'index.html#cache';
                    }
                });
            }
        }
    }

    // 清除数据对话框（所有页面共用）
    // onConfirm(selected) selected = 'regular' | 'notes'
    function showClearDialog(onConfirm) {
        if (document.getElementById('cxClearDialogMask')) return;
        var selected = 'regular';
        var mask = document.createElement('div');
        mask.id = 'cxClearDialogMask';
        mask.className = 'cx-dialog-mask';
        mask.innerHTML = [
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
        ].join('');
        document.body.appendChild(mask);

        // 注册到 backStack：返回键触发关闭
        window.CX.backStack.push(function() {
            if (mask.parentNode) mask.parentNode.removeChild(mask);
        });

        function closeClearMask() {
            if (mask.parentNode) mask.parentNode.removeChild(mask);
            window.CX.backStack.pop(); // 消耗 pushState 记录
        }

        // 用事件委托代替多个 getElementById，避免时序问题
        mask.addEventListener('click', function(e) {
            var t = e.target;
            // 选项卡片点击
            var opt = t.closest ? t.closest('.cx-dialog-opt') : null;
            if (opt && opt.getAttribute('data-val')) {
                selected = opt.getAttribute('data-val');
                var opts = mask.querySelectorAll('.cx-dialog-opt');
                for (var i = 0; i < opts.length; i++) { opts[i].classList.remove('selected'); }
                opt.classList.add('selected');
                return;
            }
            // 取消按钮
            if (t.getAttribute('data-action') === 'cancel' || t === mask) {
                closeClearMask();
                return;
            }
            // 确定清除按钮
            if (t.getAttribute('data-action') === 'confirm') {
                closeClearMask();
                var statusEl = document.getElementById('actionStatus');
                if (statusEl) { statusEl.textContent = '🧹 正在清理中，请稍候...'; statusEl.className = 'cache-status'; }
                if (onConfirm) { onConfirm(selected); return; }
                // 内置实现（非主页）
                if (selected === 'notes') {
                    try { localStorage.removeItem('cx_highlights'); } catch(e) {}
                    if (statusEl) { statusEl.textContent = '✓ 划线笔记已清除，即将刷新...'; statusEl.className = 'cache-status success'; }
                    window.location.reload(true);
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
                try {
                    var theme = localStorage.getItem('readingTheme');
                    var fontSize = localStorage.getItem('globalFontSize');
                    var highlights = localStorage.getItem('cx_highlights');
                    for (var i = localStorage.length - 1; i >= 0; i--) {
                        var k = localStorage.key(i); if (k) localStorage.removeItem(k);
                    }
                    if (theme)      localStorage.setItem('readingTheme', theme);
                    if (fontSize)   localStorage.setItem('globalFontSize', fontSize);
                    if (highlights) localStorage.setItem('cx_highlights', highlights);
                } catch(ex) {}
                Promise.all(steps).then(function() { window.location.reload(true); });
            }
        });
    }
    window.CX = window.CX || {};
    window.CX.showClearDialog = showClearDialog;

    function defaultPromptClearData() { showClearDialog(); }

    // 赞助界面
    function showSponsorDialog() {
        if (document.getElementById('cxSponsorMask')) return;

        // 图片源：始终从 Cloudflare 服务器远程获取，主备降级
        var CF_SERVERS = [
            'https://cx.zhaozg.cloudns.org/',
            'https://cx.zhaozg.dpdns.org/'
        ];
        var imgFiles = { wx: 'images/zanzhu-wx.png', zfb: 'images/zanzhu-zfb.jpg' };

        var mask = document.createElement('div');
        mask.id = 'cxSponsorMask';
        mask.className = 'cx-dialog-mask';
        mask.innerHTML = [
            '<div class="cx-sponsor-box">',
            '  <div class="cx-sponsor-close" id="cxSponsorClose">×</div>',
            '  <div class="cx-sponsor-title">❤️ 赞助作者</div>',
            '  <div class="cx-sponsor-desc">开发维护不易，谢谢赞助 🙏</div>',
            '  <div class="cx-sponsor-tabs">',
            '    <button class="cx-sponsor-tab active" data-type="wx">🟢 微信</button>',
            '    <button class="cx-sponsor-tab" data-type="zfb">🔵 支付宝</button>',
            '  </div>',
            '  <div class="cx-sponsor-img-wrap" id="cxSponsorImgWrap">',
            '    <div class="cx-sponsor-loading">加载中…</div>',
            '  </div>',
            '</div>'
        ].join('');
        document.body.appendChild(mask);

        // 注册到 backStack：返回键触发关闭
        window.CX.backStack.push(function() {
            if (mask.parentNode) mask.parentNode.removeChild(mask);
        });

        function closeSponsor() {
            if (mask.parentNode) mask.parentNode.removeChild(mask);
            window.CX.backStack.pop(); // 消耗 pushState 记录
        }

        // 关闭
        mask.addEventListener('click', function(e) {
            var t = e.target;
            if (t === mask || t.id === 'cxSponsorClose') {
                closeSponsor();
                return;
            }
            // 标签切换
            var tab = t.closest ? t.closest('.cx-sponsor-tab') : (t.classList.contains('cx-sponsor-tab') ? t : null);
            if (tab && tab.dataset.type) {
                mask.querySelectorAll('.cx-sponsor-tab').forEach(function(b) { b.classList.remove('active'); });
                tab.classList.add('active');
                loadImg(tab.dataset.type);
            }
        });

        // 加载图片（始终远程，主备降级）
        function loadImg(type) {
            var imgWrap = document.getElementById('cxSponsorImgWrap');
            if (!imgWrap) return;
            imgWrap.innerHTML = '<div class="cx-sponsor-loading">加载中…</div>';
            var file = imgFiles[type];
            var ts = Date.now();
            var tried = 0;
            function tryNext() {
                if (tried >= CF_SERVERS.length) {
                    if (imgWrap) imgWrap.innerHTML = '<div class="cx-sponsor-loading">加载失败</div>';
                    return;
                }
                var url = CF_SERVERS[tried++] + file + '?t=' + ts;
                setImg(imgWrap, url, type, tryNext);
            }
            tryNext();
        }

        function setImg(imgWrap, url, type, onError) {
            var img = new Image();
            img.onload = function() {
                if (imgWrap && imgWrap.isConnected !== false) {
                    imgWrap.innerHTML = '';
                    imgWrap.appendChild(img);
                }
            };
            img.onerror = function() {
                if (onError) { onError(); return; }
                if (imgWrap) imgWrap.innerHTML = '<div class="cx-sponsor-loading">加载失败</div>';
            };
            img.className = 'cx-sponsor-qr';
            img.alt = type === 'wx' ? '微信赞助二维码' : '支付宝赞助二维码';
            img.src = url;
        }

        // 初始加载微信
        loadImg('wx');
    }

    // 切换主题面板显示/隐藏
    window.toggleThemePanel = function() {
        var panel = document.getElementById('themePanel');
        if (!panel) return;
        var willShow = !panel.classList.contains('show');
        panel.classList.toggle('show');
        if (willShow) {
            // 打开：push 关闭回调
            window.CX.backStack.push(function() {
                panel.classList.remove('show');
            });
        } else {
            // 手动关闭：消耗对应 history 记录
            window.CX.backStack.pop();
        }
    };
    
    // 设置主题
    window.setTheme = function(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('readingTheme', theme);
        updateThemeUI(theme);
        
        // 更新meta theme-color
        const themeColor = theme === 'warm' ? '#f0f0ee' : '#f7f8fc';
        const metaThemeColor = document.querySelector('meta[name="theme-color"]');
        if (metaThemeColor) {
            metaThemeColor.setAttribute('content', themeColor);
        }
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
        
        // 更新档位指示器
        const indicator = document.getElementById('fontSizeIndicator');
        if (indicator) {
            indicator.textContent = `档位 ${currentSizeIndex + 1}/8`;
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
