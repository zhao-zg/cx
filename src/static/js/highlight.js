/**
 * 划线标记与笔记功能
 * 支持文本选中后划线、添加笔记、保存到本地存储、恢复划线
 *
 * 数据模型：{id, start, end, text, color, underline, note, timestamp}
 * underline/note 字段为新增，旧数据读取时自动补默认值。
 */
(function () {
    'use strict';

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
            this.loadHighlights();
            this._scheduleRestore();
            this.setupEventListeners();
        },

        // ─── 第一次恢复：DOMContentLoaded 后立即执行 ──────────────────
        // highlight.js 是 defer 脚本，运行时 DOMContentLoaded 尚未触发；
        // 注册到 DOMContentLoaded 可保证 scripture-popup.js 的 annotateInlineRefs
        // （同步注册，先执行）已改写完 .content-text，偏移计算正确。
        // 经文块（.scripture-block）此时可能还空着，但经文块之前的高亮可立即显示；
        // 经文块之后的高亮偏移会在 redoHighlights() 里被修正。
        _scheduleRestore: function () {
            var self = this;
            function doRestore() { self.restoreHighlights(); }
            if (document.readyState === 'complete') {
                doRestore();
            } else {
                document.addEventListener('DOMContentLoaded', doRestore);
            }
        },

        // ─── 第二次恢复：供外部在异步内容渲染后调用 ──────────────────
        // scripture-popup.js 的 renderScriptureBlocks 填充完经文块后调用，
        // 重算所有偏移，修正经文块之后区域的高亮坐标。
        // 无经文块的页面不会触发此方法，无额外开销。
        redoHighlights: function () {
            this.clearAllMarks();
            this.restoreHighlights();
        },

        // ─── 本地存储 ─────────────────────────────────────────────
        getPageKey: function () {
            return window.location.pathname;
        },

        loadHighlights: function () {
            try {
                var pageKey = this.getPageKey();
                var allData = JSON.parse(localStorage.getItem(this.config.storageKey) || '{}');
                this.highlights = (allData[pageKey] || []).map(function (h) {
                    if (h.underline === undefined) h.underline = false;
                    if (h.note      === undefined) h.note      = '';
                    return h;
                });
            } catch (e) {
                console.error('[划线] 加载失败:', e);
                this.highlights = [];
            }
        },

        saveHighlights: function () {
            try {
                var pageKey = this.getPageKey();
                var allData = JSON.parse(localStorage.getItem(this.config.storageKey) || '{}');
                allData[pageKey] = this.highlights;
                localStorage.setItem(this.config.storageKey, JSON.stringify(allData));
            } catch (e) {
                console.error('[划线] 保存失败:', e);
            }
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
            var container = document.querySelector('.content');
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

        // ─── 恢复全部划线 ─────────────────────────────────────────
        restoreHighlights: function () {
            var self = this;
            this.highlights.forEach(function (h) { self.applyHighlight(h); });
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
            var container = document.querySelector('.content');
            if (container) container.normalize();
        },

        // ─── 数据 CRUD ────────────────────────────────────────────
        addHighlight: function (color, underline) {
            var range = this._pendingRange;
            if (!range) return null;
            var container = document.querySelector('.content');
            if (!container || !container.contains(range.commonAncestorContainer)) return null;
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
            this.saveHighlights();
            window.getSelection().removeAllRanges();
            this._pendingRange = null;
            this.clearAllMarks();
            this.restoreHighlights();
            return highlight.id;
        },

        updateHighlight: function (id, changes) {
            var h = this.highlights.find(function (x) { return x.id === id; });
            if (!h) return;
            if (changes.color     !== undefined) h.color     = changes.color;
            if (changes.underline !== undefined) h.underline = changes.underline;
            this.saveHighlights();
            this.clearAllMarks();
            this.restoreHighlights();
        },

        removeHighlight: function (id) {
            this.highlights = this.highlights.filter(function (h) { return h.id !== id; });
            this.saveHighlights();
            this.clearAllMarks();
            this.restoreHighlights();
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
            this.saveHighlights();
            this.clearAllMarks();
            this.restoreHighlights();
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
            this.saveHighlights();
            this.clearAllMarks();
            this.restoreHighlights();
        },

        removeNote: function (id) {
            this.saveNote(id, '');
        },

        // 保留：清除全页高亮（可由外部调用）
        clearAllHighlights: function () {
            if (!confirm('确定要清除本页所有划线吗？')) return;
            this.highlights = [];
            this.saveHighlights();
            this.clearAllMarks();
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
                // 如果是刚创建的纯笔记条目（无背景、无下划线、无内容），取消时删除
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
            menu.style.display   = 'flex';
            menu.style.opacity   = '0';
            requestAnimationFrame(function () {
                var GAP = 32; // 菜单与选区的最小间距
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
            var self = this;
            var _showTimer = null;

            // 仅隐藏选择菜单（不影响标注菜单）
            function _hideSelMenu() {
                var m = document.getElementById('hl-selection-menu');
                if (m && m.style.display !== 'none') m.style.display = 'none';
            }

            // ─── 桌面端 ──────────────────────────────────────────────
            document.addEventListener('mousedown', function () { self._pointerDown = true; });
            document.addEventListener('mouseup', function (e) {
                self._pointerDown = false;
                clearTimeout(_showTimer);
                _showTimer = setTimeout(function () { self._handleTextSelection(e); }, 30);
            });

            // ─── 移动端 ──────────────────────────────────────────────
            document.addEventListener('touchstart', function () {
                self._pointerDown = true;
                clearTimeout(_showTimer);
                _hideSelMenu();         // 新触摸开始时隐藏选择菜单
            }, { passive: true });

            // 捕获阶段监听 touchend：菜单内 stopPropagation 无法阻止捕获阶段，
            // 保证 _pointerDown 在任何情况下都能被重置，避免卡在 true 导致后续选区菜单无法出现
            document.addEventListener('touchend', function () {
                self._pointerDown = false;
                clearTimeout(_showTimer);
                _showTimer = setTimeout(function () { self._handleTextSelection(); }, 200);
            }, true);

            // iOS / Android 长按选词：系统接管手势，触发 touchcancel 而非 touchend
            // 必须在 touchcancel 里清除 _pointerDown，否则 selectionchange 会被永久拦截
            document.addEventListener('touchcancel', function () {
                self._pointerDown = false;
                clearTimeout(_showTimer);
                _showTimer = setTimeout(function () { self._handleTextSelection(); }, 300);
            });

            // 滚动时关闭所有菜单
            window.addEventListener('scroll', function () {
                self.hideAllMenus();
            }, { passive: true });

            // ─── selectionchange ──────────────────────────────────────
            document.addEventListener('selectionchange', function () {
                clearTimeout(_showTimer);
                _hideSelMenu();
                if (self._pointerDown) return; // 手指仍按下，等 touchend/touchcancel 负责
                _showTimer = setTimeout(function () {
                    var sel = window.getSelection();
                    if (sel && sel.toString().trim().length > 0) self._handleTextSelection();
                }, 200);
            });

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
            var container = document.querySelector('.content');
            if (!container || !container.contains(range.commonAncestorContainer)) return;
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
