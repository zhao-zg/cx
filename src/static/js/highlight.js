/**
 * 划线标记与笔记功能
 * 支持文本选中后划线、添加笔记、保存到本地存储、恢复划线
 *
 * 数据模型：{id, start, end, text, color, underline, note, timestamp}
 * underline/note 字段为新增，旧数据读取时自动补默认值。
 * 存储后端：localForage (IndexedDB)，每页独立一个键
 */
(function () {
    'use strict';

    // ─── IndexedDB 存储适配层 ─────────────────────────────────────────────
    // 提供 Promise API，内部使用 localForage；localForage 不可用时降级到 localStorage。
    // 升级迁移：首次运行将旧 cx_highlights（localStorage 中所有页的扁平 JSON）
    // 逐页写入 IndexedDB，迁移成功后删除旧键并写入 cx_hl_migrated='1' 标志。
    var CXStorage = (function () {
        var _store = null;
        var MIGRATED_KEY = 'cx_hl_migrated';
        var MIGRATED_VER = '2'; // 升版本号强制重跑迁移（修复路径规范化）

        function init() {
            if (typeof localforage === 'undefined') {
                console.warn('[划线] localforage 未加载，降级到 localStorage');
                return _initLegacy();
            }
            _store = localforage.createInstance({
                driver:      [localforage.INDEXEDDB, localforage.LOCALSTORAGE],
                name:        'cx',
                storeName:   'highlights',
                description: 'CX划线笔记'
            });
            return _migrate();
        }

        function _normalizePath(path) {
            // 统一去除 Capacitor Android 的前缀 /android_asset/public 和 /public，
            // 以及 PWA 可能出现的多余前缀，只保留 /batch/... 形式的相对路径。
            return path
                .replace(/^\/android_asset\/public/, '')
                .replace(/^\/public(?=\/)/, '')
                .replace(/^\/index\.html$/, '/');
        }

        function _migrate() {
            try {
                if (localStorage.getItem(MIGRATED_KEY) === MIGRATED_VER) return Promise.resolve();
            } catch (e) { return Promise.resolve(); }

            // 读旧主键 + 旧备份键，合并（旧主键数据优先）
            var oldData = null, bakData = null;
            try { oldData = JSON.parse(localStorage.getItem('cx_highlights') || 'null'); } catch (e) {}
            try { bakData = JSON.parse(localStorage.getItem('cx_highlights_bak') || 'null'); } catch (e) {}

            var merged = {};
            var k;
            if (bakData && typeof bakData === 'object') {
                for (k in bakData) { if (bakData.hasOwnProperty(k)) merged[k] = bakData[k]; }
            }
            if (oldData && typeof oldData === 'object') {
                for (k in oldData) { if (oldData.hasOwnProperty(k)) merged[k] = oldData[k]; }
            }

            var paths = Object.keys(merged);
            if (!paths.length) {
                try { localStorage.setItem(MIGRATED_KEY, MIGRATED_VER); } catch (e) {}
                return Promise.resolve();
            }

            var promises = paths.map(function (path) {
                var arr = merged[path];
                if (!Array.isArray(arr) || !arr.length) return Promise.resolve();
                // 迁移时规范化 key，抹掉平台前缀，确保 APK / PWA 数据共用同一个 key
                var normalizedPath = _normalizePath(path);
                return _store.setItem(normalizedPath, arr);
            });

            return Promise.all(promises).then(function () {
                try {
                    localStorage.removeItem('cx_highlights');
                    localStorage.removeItem('cx_highlights_bak');
                    localStorage.removeItem('cx_highlights_bak_ts');
                    localStorage.setItem(MIGRATED_KEY, MIGRATED_VER);
                } catch (e) {}
                console.log('[划线] 已迁移 ' + paths.length + ' 页数据到 IndexedDB');
            }).catch(function (err) {
                console.warn('[划线] 迁移失败，旧数据保留:', err);
                // 不写 MIGRATED_KEY，下次启动继续尝试
            });
        }

        // localForage 不可用时的 localStorage Promise 包装（接口一致）
        function _initLegacy() {
            _store = {
                getItem: function (key) {
                    return Promise.resolve().then(function () {
                        try {
                            var all = JSON.parse(localStorage.getItem('cx_highlights') || '{}');
                            return all[key] || null;
                        } catch (e) { return null; }
                    });
                },
                setItem: function (key, val) {
                    return Promise.resolve().then(function () {
                        try {
                            var all = JSON.parse(localStorage.getItem('cx_highlights') || '{}');
                            all[key] = val;
                            localStorage.setItem('cx_highlights', JSON.stringify(all));
                        } catch (e) {}
                    });
                },
                clear: function () {
                    return Promise.resolve().then(function () {
                        try { localStorage.removeItem('cx_highlights'); } catch (e) {}
                    });
                }
            };
            return Promise.resolve();
        }

        function getPage(pathname) {
            return _store.getItem(pathname).then(function (arr) {
                return Array.isArray(arr) ? arr : [];
            }).catch(function () { return []; });
        }

        function setPage(pathname, arr) {
            return _store.setItem(pathname, arr).catch(function (e) {
                console.error('[划线] 保存失败:', e);
            });
        }

        function clear() {
            return _store ? _store.clear().catch(function (e) {
                console.error('[划线] 清除失败:', e);
            }) : Promise.resolve();
        }

        return { init: init, getPage: getPage, setPage: setPage, clear: clear };
    })();

    var CXHighlight = {

        // ─── 配置 ─────────────────────────────────────────────────
        config: {
            storageKey: 'cx_highlights',
            colors: {
                yellow: '#fff59d',
                green:  '#a5d6a7',
                blue:   '#90caf9',
                pink:   '#f48fb1'
            },
            defaultColor: 'yellow'
        },

        highlights: [],

        // 操作状态
        _pendingRange:       null,
        _pendingHighlightId: null,
        _selectedColor:      'yellow',
        _selectedUnderline:  false,
        _pointerDown:        false,

        // ─── 初始化 ───────────────────────────────────────────────
        init: function () {
            this._selectedColor = this.config.defaultColor;
            this.createMenus();
            this.setupEventListeners();
            // 存储初始化（含一次性迁移）完成后再加载并渲染划线
            var self = this;
            CXStorage.init().then(function () { self.restoreHighlights(); });
        },

        // ─── 供外部在异步内容渲染后调用（经文块填充后重算偏移）────────────
        // scripture-popup.js 的 renderScriptureBlocks 填充完经文块后调用，
        // 修正经文块之后区域的高亮坐标。无经文块的页面不会触发此方法。
        redoHighlights: function () {
            this.clearAllMarks();
            this.restoreHighlights();
        },

        // ─── 存储键 ───────────────────────────────────────────────
        // SPA 模式下 pathname 始终是 '/'，需从 hash 推导与旧静态页相同的 key，
        // 这样 SPA 改造前保存的笔记可直接显示，新笔记也按章节隔离存储。
        // 旧静态页命名规则：/{batch}/{num}_{view}.htm  e.g. /2025-07/1_cv.htm
        getPageKey: function () {
            var hash = window.location.hash.replace(/^#\/?/, ''); // '2025-07/1/cv'
            if (hash) {
                var parts = hash.split('/').filter(Boolean);
                if (parts.length >= 3) {
                    // batch/num/view → /batch/num_view.htm（与旧静态页 key 一致）
                    return '/' + parts[0] + '/' + parts[1] + '_' + parts[2] + '.htm';
                }
            }
            return window.location.pathname;
        },

        // ─── 从 IndexedDB 加载当前页划线（异步，返回 Promise）────────────
        loadHighlights: function () {
            var self = this;
            var key = this.getPageKey(); // e.g. /2025-07/1_cv.htm

            // 所有可能的历史 key 变体（覆盖各版本/平台的存储路径差异）
            var keyVariants = [
                key,                                             // 规范化 key（当前版本）
                '/android_asset/public' + key,                  // Android 旧路径前缀
                '/public' + key,                                 // 部分 Capacitor 版本
                key.replace(/\.htm$/, '.html'),                  // .html 扩展名
                '/android_asset/public' + key.replace(/\.htm$/, '.html')
            ];

            // 从 localStorage cx_highlights 直接取，作为最终兜底
            function tryLocalStorageDirect(k) {
                try {
                    var all = JSON.parse(localStorage.getItem('cx_highlights') || '{}');
                    // 同样尝试所有 key 变体
                    var variants = [k, '/android_asset/public' + k,
                                    k.replace(/\.htm$/, '.html'),
                                    '/android_asset/public' + k.replace(/\.htm$/, '.html')];
                    for (var i = 0; i < variants.length; i++) {
                        if (all[variants[i]] && all[variants[i]].length) {
                            console.log('[划线] localStorage 兜底命中:', variants[i]);
                            return all[variants[i]];
                        }
                    }
                } catch (e) {}
                return null;
            }

            // 顺序查询所有 IndexedDB key 变体
            function tryVariants(index) {
                if (index >= keyVariants.length) return Promise.resolve(null);
                return CXStorage.getPage(keyVariants[index]).then(function (arr) {
                    if (arr && arr.length) {
                        if (keyVariants[index] !== key) {
                            // 命中非规范化 key，自愈写回规范化 key
                            console.log('[划线] 自愈迁移:', keyVariants[index], '→', key);
                            CXStorage.setPage(key, arr).catch(function () {});
                        }
                        return arr;
                    }
                    return tryVariants(index + 1);
                });
            }

            return tryVariants(0).then(function (arr) {
                if (!arr || !arr.length) {
                    // IndexedDB 所有变体均无数据，最后从 localStorage 直接取
                    var lsArr = tryLocalStorageDirect(key);
                    if (lsArr) {
                        // 找到了，写入 IndexedDB 规范化 key 并返回
                        CXStorage.setPage(key, lsArr).catch(function () {});
                        arr = lsArr;
                    }
                }
                console.log('[划线] key=' + key + ', 找到条数=' + (arr ? arr.length : 0));
                self.highlights = (arr || []).map(function (h) {
                    if (h.underline === undefined) h.underline = false;
                    if (h.note      === undefined) h.note      = '';
                    return h;
                });
            }).catch(function (e) {
                console.error('[划线] 加载失败:', e);
                self.highlights = [];
            });
        },

        // ─── 保存当前页划线到 IndexedDB（异步，返回 Promise）────────────
        saveHighlights: function () {
            return CXStorage.setPage(this.getPageKey(), this.highlights);
        },

        // ─── 文本节点遍历 ───────────────────────────────────────────
        // 注意：getTextNodes 和 getSelectionPosition 必须使用相同的过滤逻辑
        // 这里保留空白节点（不过滤），确保字符偏移计算一致
        getTextNodes: function (element) {
            var textNodes = [];
            var walker = document.createTreeWalker(
                element,
                NodeFilter.SHOW_TEXT,
                null
            );
            var node;
            while ((node = walker.nextNode())) textNodes.push(node);
            return textNodes;
        },

        // ─── 选区 → 绝对字符偏移 ────────────────────────────────────
        getSelectionPosition: function (container, range) {
            var textNodes = this.getTextNodes(container);
            var charCount = 0, start = -1, end = -1;
            for (var i = 0; i < textNodes.length; i++) {
                var node = textNodes[i];
                var nodeLength = node.textContent.length;
                // 先设 start 再设 end，保证 startContainer===endContainer 时顺序正确
                if (node === range.startContainer) start = charCount + range.startOffset;
                if (node === range.endContainer)   { end = charCount + range.endOffset; break; }
                charCount += nodeLength;
            }
            // start 未找到（endContainer 先于 startContainer）则返回 null
            return (start >= 0 && end >= 0 && end > start) ? { start: start, end: end } : null;
        },

        // ─── 应用单个划线到 DOM ──────────────────────────────────────
        applyHighlight: function (highlight) {
            var container = document.querySelector('#app .content') || document.querySelector('.content');
            if (!container) return;
            var textNodes = this.getTextNodes(container);
            var charCount = 0;
            var appliedMarks = [];   // 记录本次已添加的 mark，surroundContents 失败时回滚
            var self = this;

            // 多节点跨段时，先用字符偏移提取全文做整体校验
            if (highlight.text) {
                var fullText = '';
                for (var j = 0; j < textNodes.length; j++) {
                    var tn = textNodes[j];
                    var tnStart = charCount;
                    var tnEnd   = tnStart + tn.textContent.length;
                    if (tnEnd > highlight.start && tnStart < highlight.end) {
                        var s = Math.max(0, highlight.start - tnStart);
                        var e = Math.min(tn.textContent.length, highlight.end - tnStart);
                        fullText += tn.textContent.substring(s, e);
                    }
                    charCount += tn.textContent.length;
                    if (tnStart >= highlight.end) break;
                }
                charCount = 0; // 重置供下方循环使用
                if (fullText !== highlight.text) {
                    console.warn('[划线] 文本不匹配，跳过恢复:', highlight.text, '→', fullText);
                    return;
                }
            }

            for (var i = 0; i < textNodes.length; i++) {
                var node       = textNodes[i];
                var nodeLength = node.textContent.length;
                var nodeStart  = charCount;
                var nodeEnd    = charCount + nodeLength;

                if (nodeEnd > highlight.start && nodeStart < highlight.end) {
                    var startOffset = Math.max(0, highlight.start - nodeStart);
                    var endOffset   = Math.min(nodeLength, highlight.end - nodeStart);

                    var range = document.createRange();
                    range.setStart(node, startOffset);
                    range.setEnd(node, endOffset);

                    var mark = document.createElement('mark');
                    mark.className = 'cx-highlight';

                    // 背景色：color 为空或 'note' 时透明（向后兼容旧 'note' 数据）
                    if (highlight.color && highlight.color !== 'note' && self.config.colors[highlight.color]) {
                        mark.style.backgroundColor = self.config.colors[highlight.color];
                    } else {
                        mark.style.backgroundColor = 'transparent';
                    }

                    // 下划线：直线用 border-bottom，波浪线用 text-decoration
                    // 二者属于不同 CSS 属性，可完全叠加，无兼容性问题
                    if (highlight.underline) {
                        mark.style.borderBottom    = '2px solid #e53935';
                        mark.style.paddingBottom   = '1px';
                    }
                    if (highlight.note) {
                        mark.style.textDecoration      = 'underline wavy #eb6c05 1px';
                        mark.style.textUnderlineOffset = '2px';
                    }

                    mark.dataset.highlightId = highlight.id;

                    try {
                        range.surroundContents(mark);
                        appliedMarks.push(mark);
                        // 仅在最后一个覆盖节点插入图标，防止多段高亮重复插入
                        if (highlight.note && (nodeStart + endOffset >= highlight.end)) {
                            self._insertNoteIcon(mark, highlight.id);
                        }
                    } catch (e) {
                        console.warn('[划线] 无法应用划线:', e);
                    }
                }

                charCount += nodeLength;
            }

            // surroundContents 全部失败（appliedMarks 为空）时无需处理；
            // 部分失败时已成功的 mark 保留（clearAllMarks 会在下次 restore 时清除）
        },

        _insertNoteIcon: function (markEl, highlightId) {
            var icon = document.createElement('span');
            icon.className = 'cx-note-icon';
            icon.textContent = '📝';
            icon.dataset.highlightId = highlightId;
            markEl.parentNode.insertBefore(icon, markEl.nextSibling);
        },

        // ─── 恢复全部划线（异步，先从 IndexedDB 加载再渲染）─────────
        restoreHighlights: function () {
            var self = this;
            return this.loadHighlights().then(function () {
                self.highlights.forEach(function (h) { self.applyHighlight(h); });
            });
        },

        // ─── 清除所有 DOM 标记 ────────────────────────────────────
        clearAllMarks: function () {
            document.querySelectorAll('.cx-note-icon').forEach(function (el) { el.remove(); });
            document.querySelectorAll('.cx-highlight').forEach(function (mark) {
                var parent = mark.parentNode;
                while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
                parent.removeChild(mark);
            });
            // 解包后会产生大量相邻碎片文本节点，normalize 合并它们
            // 否则 restoreHighlights 里的字符偏移计算会出错
            var container = document.querySelector('#app .content') || document.querySelector('.content');
            if (container) container.normalize();
        },

        // ─── 数据 CRUD ────────────────────────────────────────────
        addHighlight: function (color, underline) {
            var range = this._pendingRange;
            if (!range) return null;
            var rangeNode = range.commonAncestorContainer;
            var container = (rangeNode.nodeType === 3 ? rangeNode.parentElement : rangeNode).closest('.content');
            if (!container) return null;
            var position = this.getSelectionPosition(container, range);
            if (!position) return null;

            var highlight = {
                id:        Date.now().toString(),
                start:     position.start,
                end:       position.end,
                text:      range.toString(),
                // 'note' 和 null 均表示无背景色；其他值使用传入颜色，缺省用默认色
                color:     (color === null || color === 'note' || color === undefined) ? null : (color || this.config.defaultColor),
                underline: !!underline,
                note:      '',
                timestamp: Date.now()
            };

            this.highlights.push(highlight);
            var self = this;
            this.saveHighlights().then(function () {
                self.clearAllMarks();
                self.restoreHighlights();
            });
            window.getSelection().removeAllRanges();
            this._pendingRange = null;
            return highlight.id;
        },

        updateHighlight: function (id, changes) {
            var h = this.highlights.find(function (x) { return x.id === id; });
            if (!h) return;
            if (changes.color     !== undefined) h.color     = changes.color;
            if (changes.underline !== undefined) h.underline = changes.underline;
            var self = this;
            this.saveHighlights().then(function () {
                self.clearAllMarks();
                self.restoreHighlights();
            });
        },

        removeHighlight: function (id) {
            this.highlights = this.highlights.filter(function (h) { return h.id !== id; });
            var self = this;
            this.saveHighlights().then(function () {
                self.clearAllMarks();
                self.restoreHighlights();
            });
        },

        // 仅删除标记（背景色 + 下划线），保留笔记
        removeMark: function (id) {
            var h = this.highlights.find(function (x) { return x.id === id; });
            if (!h) return;
            h.color     = null;
            h.underline = false;
            // 标记和笔记都没有了才删整条
            if (!h.note) {
                this.removeHighlight(id);
                return;
            }
            var self = this;
            this.saveHighlights().then(function () {
                self.clearAllMarks();
                self.restoreHighlights();
            });
        },

        saveNote: function (id, text) {
            var h = this.highlights.find(function (x) { return x.id === id; });
            if (!h) return;
            h.note = text || '';
            // 无背景、无下划线、无笔记内容 → 删除整条记录（不留不可见的空记录）
            if (!h.note && !h.color && !h.underline) {
                this.removeHighlight(id);
                return;
            }
            var self = this;
            this.saveHighlights().then(function () {
                self.clearAllMarks();
                self.restoreHighlights();
            });
        },

        removeNote: function (id) {
            this.saveNote(id, '');
        },

        // 清除全页高亮（需用户确认）
        clearAllHighlights: function () {
            if (!confirm('确定要清除本页所有划线吗？')) return;
            this.highlights = [];
            this.clearAllMarks();
            this.saveHighlights();
        },

        // 无需确认地清除所有页面全部划线（供清除数据对话框调用，返回 Promise）
        clearAllHighlightsForce: function () {
            this.highlights = [];
            this.clearAllMarks();
            return CXStorage.clear();
        },

        // ─── 创建所有 UI DOM ──────────────────────────────────────
        createMenus: function () {
            this._createSelectionMenu();
            this._createAnnotationMenu();
            this._createNoteModal();
        },

        // 颜色子面板 HTML（A/B 菜单内共享结构）
        _colorPanelHTML: function () {
            var self = this;
            var dots = Object.keys(self.config.colors).map(function (name) {
                return '<button class="hl-color-dot" data-color="' + name +
                       '" style="background:' + self.config.colors[name] +
                       '" title="' + name + '"></button>';
            }).join('');
            return '<div class="hl-color-panel">' +
                       dots +
                       '<button class="hl-underline-btn" title="下划线">U_</button>' +
                   '</div>';
        },

        // A. 选中新文字时的菜单
        _createSelectionMenu: function () {
            if (document.getElementById('hl-selection-menu')) return;
            var self = this;
            var menu = document.createElement('div');
            menu.id        = 'hl-selection-menu';
            menu.className = 'hl-menu';

            // 颜色圆钮直接内联，点击即应用（无需二次确认）
            var colorDotsHTML = Object.keys(self.config.colors).map(function (name) {
                return '<button class="hl-color-dot hl-sel-dot" data-color="' + name +
                       '" style="background:' + self.config.colors[name] +
                       '" title="' + name + '"></button>';
            }).join('');

            menu.innerHTML =
                '<div class="hl-menu-row hl-sel-row">' +
                    colorDotsHTML +
                    '<button class="hl-underline-btn" id="hl-sel-ul" title="下划线">U_</button>' +
                    '<span class="hl-sel-sep"></span>' +
                    '<button class="hl-menu-btn hl-sel-note-btn" id="hl-sel-note">添加笔记</button>' +
                '</div>';

            ['touchstart', 'touchend', 'mousedown'].forEach(function (evt) {
                menu.addEventListener(evt, function (e) { e.stopPropagation(); });
            });
            document.body.appendChild(menu);

            // 颜色圆钮：点击即刻应用颜色高亮（无下划线）
            menu.querySelectorAll('.hl-sel-dot').forEach(function (dot) {
                dot.addEventListener('click', function (e) {
                    e.stopPropagation();
                    self.addHighlight(dot.dataset.color, false);
                    self.hideAllMenus();
                });
            });

            // U_ 按钮：直接动作，立即应用"无背景色 + 直线下划线"
            document.getElementById('hl-sel-ul').addEventListener('click', function (e) {
                e.stopPropagation();
                self.addHighlight(null, true);
                self.hideAllMenus();
            });

            // "添加笔记" → 无背景高亮，使用波浪线下划线标记，打开笔记编辑器
            document.getElementById('hl-sel-note').addEventListener('click', function (e) {
                e.stopPropagation();
                var newId = self.addHighlight('note', false);
                self.hideAllMenus();
                if (newId) self.showNoteEditor(newId);
            });
        },

        // B. 点击已有高亮后的菜单
        _createAnnotationMenu: function () {
            if (document.getElementById('hl-annotation-menu')) return;
            var self = this;
            var menu = document.createElement('div');
            menu.id        = 'hl-annotation-menu';
            menu.className = 'hl-menu';
            menu.innerHTML =
                '<div class="hl-note-preview" id="hl-ann-note-preview">' +
                    '<div class="hl-note-text" id="hl-ann-note-text"></div>' +
                    '<button class="hl-note-expand-btn" id="hl-ann-expand">展开 ▾</button>' +
                '</div>' +
                '<div class="hl-ann-row" id="hl-ann-mark-row">' +
                    '<button class="hl-ann-act-btn" id="hl-ann-modify-mark">标记 ▾</button>' +
                    '<button class="hl-ann-act-btn hl-ann-danger" id="hl-ann-del-mark">删除</button>' +
                    '<span class="hl-sel-sep"></span>' +
                    '<button class="hl-ann-act-btn" id="hl-ann-edit-note">笔记</button>' +
                    '<button class="hl-ann-act-btn hl-ann-danger" id="hl-ann-del-note">删除</button>' +
                '</div>' +
                self._colorPanelHTML();

            ['touchstart', 'touchend', 'mousedown'].forEach(function (evt) {
                menu.addEventListener(evt, function (e) { e.stopPropagation(); });
            });
            document.body.appendChild(menu);

            // "修改标记" → 展开颜色/下划线子面板（预填当前高亮样式）
            document.getElementById('hl-ann-modify-mark').addEventListener('click', function (e) {
                e.stopPropagation();
                var panel = menu.querySelector('.hl-color-panel');
                var isOpen = panel.classList.contains('open');
                panel.classList.toggle('open', !isOpen);
                if (!isOpen) {
                    var h = self.highlights.find(function (x) { return x.id === self._pendingHighlightId; });
                    if (h) self._syncColorPanel(panel, h.color, h.underline);
                }
            });

            // "删除标记"
            document.getElementById('hl-ann-del-mark').addEventListener('click', function (e) {
                e.stopPropagation();
                var id = self._pendingHighlightId;
                self.hideAllMenus();
                if (id) self.removeMark(id);
            });

            // "展开/折叠" 笔记预览
            document.getElementById('hl-ann-expand').addEventListener('click', function (e) {
                e.stopPropagation();
                var noteTextEl = document.getElementById('hl-ann-note-text');
                var isExpanded = noteTextEl.classList.toggle('expanded');
                e.currentTarget.textContent = isExpanded ? '收起 ▴' : '展开 ▾';
            });

            // "添加/修改笔记"
            document.getElementById('hl-ann-edit-note').addEventListener('click', function (e) {
                e.stopPropagation();
                var id = self._pendingHighlightId;
                self.hideAllMenus();
                if (id) self.showNoteEditor(id);
            });

            // "删除笔记"
            document.getElementById('hl-ann-del-note').addEventListener('click', function (e) {
                e.stopPropagation();
                var id = self._pendingHighlightId;
                self.hideAllMenus();
                if (id) self.removeNote(id);
            });

            self._bindColorPanel(menu.querySelector('.hl-color-panel'), 'existing');
        },

        // C. 笔记编辑模态框
        _createNoteModal: function () {
            // 防止 SPA 多次 init() 重复创建
            if (document.getElementById('hl-note-modal')) return;
            var self = this;
            var modal = document.createElement('div');
            modal.id        = 'hl-note-modal';
            modal.className = 'hl-modal-mask';
            modal.innerHTML =
                '<div class="hl-modal-card">' +
                    '<div class="hl-modal-title">笔记</div>' +
                    '<textarea class="hl-note-textarea" id="hl-note-textarea" placeholder="输入笔记内容…" rows="5"></textarea>' +
                    '<div class="hl-modal-actions">' +
                        '<button class="hl-modal-btn hl-modal-cancel" id="hl-note-cancel">取消</button>' +
                        '<button class="hl-modal-btn hl-modal-save"   id="hl-note-save">保存</button>' +
                    '</div>' +
                '</div>';

            document.body.appendChild(modal);

            document.getElementById('hl-note-cancel').addEventListener('click', function () {
                var id = modal.dataset.highlightId;
                modal.style.display = 'none';
                if (id) {
                    var h = self.highlights.find(function (x) { return x.id === id; });
                    if (h && !h.note && !h.color && !h.underline) self.removeHighlight(id);
                }
            });
            document.getElementById('hl-note-save').addEventListener('click', function () {
                var id   = modal.dataset.highlightId;
                var text = document.getElementById('hl-note-textarea').value.trim();
                modal.style.display = 'none';
                if (id) self.saveNote(id, text);
            });
            modal.addEventListener('click', function (e) {
                if (e.target === modal) modal.style.display = 'none';
            });
        },

        // ─── 颜色子面板：绑定事件 ────────────────────────────────
        _bindColorPanel: function (panel, target) {
            var self = this;
            panel.querySelectorAll('.hl-color-dot').forEach(function (dot) {
                dot.addEventListener('click', function (e) {
                    e.stopPropagation();
                    // 再次点击已选中的颜色 → 取消颜色（只保留下划线）
                    var isSame = self._selectedColor === dot.dataset.color;
                    panel.querySelectorAll('.hl-color-dot').forEach(function (d) { d.classList.remove('selected'); });
                    if (isSame) {
                        self._selectedColor = null;
                    } else {
                        self._selectedColor = dot.dataset.color;
                        dot.classList.add('selected');
                    }
                    if (target === 'existing') {
                        var id = self._pendingHighlightId;
                        if (id) {
                            if (!self._selectedColor && !self._selectedUnderline) {
                                self.removeMark(id);
                            } else {
                                self.updateHighlight(id, { color: self._selectedColor, underline: self._selectedUnderline });
                            }
                        }
                        self.hideAllMenus();
                    }
                });
            });
            panel.querySelector('.hl-underline-btn').addEventListener('click', function (e) {
                e.stopPropagation();
                this.classList.toggle('active');
                self._selectedUnderline = this.classList.contains('active');
                if (target === 'existing') {
                    var id = self._pendingHighlightId;
                    if (id) {
                        if (!self._selectedColor && !self._selectedUnderline) {
                            self.removeMark(id);
                        } else {
                            self.updateHighlight(id, { color: self._selectedColor, underline: self._selectedUnderline });
                        }
                    }
                    self.hideAllMenus();
                }
            });
        },

        // 颜色子面板：同步当前高亮样式到面板
        _syncColorPanel: function (panel, color, underline) {
            panel.querySelectorAll('.hl-color-dot').forEach(function (d) {
                d.classList.toggle('selected', d.dataset.color === color);
            });
            panel.querySelector('.hl-underline-btn').classList.toggle('active', !!underline);
            this._selectedColor     = color;        // 保留 null，不要回退到默认色
            this._selectedUnderline = !!underline;
        },

        // ─── 显示 / 隐藏菜单 ─────────────────────────────────────
        hideAllMenus: function () {
            ['hl-selection-menu', 'hl-annotation-menu'].forEach(function (id) {
                var el = document.getElementById(id);
                if (!el) return;
                el.style.display = 'none';
                var panel = el.querySelector('.hl-color-panel');
                if (panel) panel.classList.remove('open');
            });
        },

        showSelectionMenu: function (range) {
            this.hideAllMenus();
            this._pendingRange      = range;
            this._selectedColor     = this.config.defaultColor;
            this._selectedUnderline = false;
            var menu = document.getElementById('hl-selection-menu');
            this._positionMenu(menu, range);
        },

        showAnnotationMenu: function (highlightId, targetEl) {
            this.hideAllMenus();
            this._pendingHighlightId = highlightId;
            var h = this.highlights.find(function (x) { return x.id === highlightId; });
            if (!h) return;

            var preview   = document.getElementById('hl-ann-note-preview');
            var noteTextEl = document.getElementById('hl-ann-note-text');
            var expandBtn  = document.getElementById('hl-ann-expand');
            if (h.note) {
                noteTextEl.textContent = h.note;
                noteTextEl.classList.remove('expanded');
                expandBtn.textContent = '展开 ▾';
                preview.style.display = 'block';
            } else {
                noteTextEl.textContent = '';
                preview.style.display = 'none';
            }

            document.getElementById('hl-ann-edit-note').textContent = h.note ? '修改笔记' : '笔记';
            document.getElementById('hl-ann-del-note').style.display = h.note ? '' : 'none';

            // 有标记时：修改标记 ▾ + ✕；无标记时：仅显示 + 标记
            var hasVisibleMark = !!(h.color || h.underline);
            document.getElementById('hl-ann-modify-mark').textContent = hasVisibleMark ? '修改 ▾' : '标记 ▾';
            document.getElementById('hl-ann-del-mark').style.display = hasVisibleMark ? '' : 'none';

            var menu = document.getElementById('hl-annotation-menu');
            this._positionMenuByRect(menu, targetEl.getBoundingClientRect());
        },

        showNoteEditor: function (id) {
            var h     = this.highlights.find(function (x) { return x.id === id; });
            var modal = document.getElementById('hl-note-modal');
            modal.dataset.highlightId = id;
            document.getElementById('hl-note-textarea').value = h ? (h.note || '') : '';
            modal.style.display = 'flex';
            setTimeout(function () { document.getElementById('hl-note-textarea').focus(); }, 100);
        },

        // ─── 菜单定位 ─────────────────────────────────────────────
        // 始终用 position:fixed，避免 absolute+大 scrollY 时 top 超大触发页面滚动
        _positionMenu: function (menu, range) {
            this._positionMenuByRect(menu, range.getBoundingClientRect());
        },

        _positionMenuByRect: function (menu, rect) {
            menu.style.position  = 'fixed';
            menu.style.transform = 'none';
            // 先移出视口再显示，防止 position:fixed top:auto 首次出现时
            // 定位到文档末尾导致页面突然滚到底部（Android WebView 已知问题）
            menu.style.top       = '-9999px';
            menu.style.left      = '-9999px';
            menu.style.display   = 'flex';
            menu.style.opacity   = '0';
            requestAnimationFrame(function () {
                var GAP = 20; // 菜单与选区的最小间距
                var viewTop;
                var belowAvail = window.innerHeight - rect.bottom - GAP;
                var aboveAvail = rect.top - GAP;
                if (belowAvail >= menu.offsetHeight || belowAvail >= aboveAvail) {
                    viewTop = rect.bottom + GAP;
                } else {
                    viewTop = rect.top - menu.offsetHeight - GAP;
                }
                viewTop = Math.max(GAP, Math.min(viewTop, window.innerHeight - menu.offsetHeight - GAP));

                var left = rect.left + rect.width / 2 - menu.offsetWidth / 2;
                left = Math.max(10, Math.min(left, window.innerWidth - menu.offsetWidth - 10));

                menu.style.left    = left + 'px';
                menu.style.top     = viewTop + 'px';
                menu.style.opacity = '1';
            });
        },

        // ─── 事件监听 ─────────────────────────────────────────────
        setupEventListeners: function () {
            // 防止 SPA 多次 init() 重复绑定
            if (this._listenersSetup) return;
            this._listenersSetup = true;
            var self = this;
            var _showTimer = null;

            // 仅隐藏选择菜单（不影响标注菜单）
            function _hideSelMenu() {
                var m = document.getElementById('hl-selection-menu');
                if (m && m.style.display !== 'none') m.style.display = 'none';
            }

            // ─── 新触摸开始：取消挂起的菜单定时器，隐藏旧选择菜单 ─────────
            document.addEventListener('touchstart', function () {
                clearTimeout(_showTimer);
                _hideSelMenu();
            }, { passive: true });

            // ─── 桌面端 mouseup：快速响应 ──────────────────────────────
            document.addEventListener('mouseup', function (e) {
                clearTimeout(_showTimer);
                _showTimer = setTimeout(function () { self._handleTextSelection(e); }, 50);
            });

            // ─── selectionchange：移动端长按/选词的核心触发点 ───────────
            // iOS 长按：touchcancel 后 selectionchange 连续触发；
            // Android 长按：选区稳定后 selectionchange 停止触发；
            // 用 debounce 等选区稳定再弹菜单，无需跟踪 pointer 状态。
            document.addEventListener('selectionchange', function () {
                _hideSelMenu();
                clearTimeout(_showTimer);
                _showTimer = setTimeout(function () {
                    var sel = window.getSelection();
                    if (sel && sel.toString().trim().length > 0) {
                        self._handleTextSelection();
                    }
                }, 350);
            });

            // 滚动时关闭所有菜单
            window.addEventListener('scroll', function () {
                self.hideAllMenus();
            }, { passive: true });

            // 点击事件：区分"点击高亮/笔记图标"与"点击空白关闭菜单"
            document.addEventListener('click', function (e) {
                var ni = e.target.closest ? e.target.closest('.cx-note-icon') : null;
                var hl = e.target.closest ? e.target.closest('.cx-highlight') : null;

                if (ni) {
                    e.stopPropagation();
                    self.showAnnotationMenu(ni.dataset.highlightId, ni);
                    return;
                }
                if (hl) {
                    var sel = window.getSelection();
                    if (sel && sel.toString().trim().length > 0) return;
                    e.stopPropagation();
                    self.showAnnotationMenu(hl.dataset.highlightId, hl);
                    return;
                }

                var selMenu = document.getElementById('hl-selection-menu');
                var annMenu = document.getElementById('hl-annotation-menu');
                var outsideSel = selMenu && selMenu.style.display !== 'none' && !selMenu.contains(e.target);
                var outsideAnn = annMenu && annMenu.style.display !== 'none' && !annMenu.contains(e.target);
                if (outsideSel || outsideAnn) self.hideAllMenus();
            });

            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') self.hideAllMenus();
            });
        },

        _handleTextSelection: function (e) {
            // 若事件来自选择菜单内部（如点击 U_ 按钮），不重置菜单
            var selMenu = document.getElementById('hl-selection-menu');
            if (e && e.target && selMenu && selMenu.contains(e.target)) return;

            var sel = window.getSelection();
            if (!sel || sel.toString().trim().length === 0) return;
            if (!sel.rangeCount) return;
            var range     = sel.getRangeAt(0);
            // 优先从选区节点向上找最近的 .content，避免 querySelector 返回隐藏的 homeView 里的同名元素
            var rangeNode = range.commonAncestorContainer;
            var container = (rangeNode.nodeType === 3 ? rangeNode.parentElement : rangeNode).closest('.content');
            if (!container) return;
            this.showSelectionMenu(range.cloneRange());
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { CXHighlight.init(); });
    } else {
        CXHighlight.init();
    }

    window.CXHighlight = CXHighlight;

})();
