/**
 * 书签功能模块
 * 支持添加/删除/查看书签，跳转到书签位置，列表弹框展示
 *
 * 数据模型：{id, path, scrollY, title, batchPath, chapterNum, viewType, note, timestamp}
 * 存储后端：localForage (IndexedDB)，单键 cx_bookmarks → Array
 */
(function (win) {
    'use strict';

    win.CX = win.CX || {};

    // ─── 常量 ─────────────────────────────────────────────────────────────
    var STORAGE_KEY = 'cx_bookmarks';
    var MAX_BOOKMARKS = 100;

    var VIEW_LABELS = {
        cv: '纲目',
        cx: '晨读',
        h: '听抄',
        ts: '详情',
        sg: '诗歌',
        zs: '职事摘录',
        motto: '标语',
        motto_song: '诗歌'
    };

    // ─── 存储层 ─────────────────────────────────────────────────────────────
    var _store = null;

    function _initStore() {
        if (_store) return;
        if (typeof localforage === 'undefined') {
            console.warn('[书签] localforage 未加载，降级到 localStorage');
            _store = {
                getItem: function (key) {
                    return Promise.resolve().then(function () {
                        try {
                            return JSON.parse(localStorage.getItem(key) || 'null');
                        } catch (e) { return null; }
                    });
                },
                setItem: function (key, val) {
                    return Promise.resolve().then(function () {
                        try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
                    });
                }
            };
            return;
        }
        _store = localforage.createInstance({
            driver: [localforage.INDEXEDDB, localforage.LOCALSTORAGE],
            name: 'cx',
            storeName: 'bookmarks'
        });
    }

    function _load() {
        _initStore();
        var storePromise = _store.getItem(STORAGE_KEY).then(function (arr) {
            return Array.isArray(arr) ? arr : [];
        }).catch(function (e) {
            console.warn('[书签] 读取失败:', e);
            return [];
        });
        // 超时保护：部分 WebView 环境中 IndexedDB 初始化可能卡死
        var timeoutPromise = new Promise(function (resolve) {
            setTimeout(function () {
                console.warn('[书签] 读取超时(3s)，降级为空列表');
                resolve([]);
            }, 3000);
        });
        return Promise.race([storePromise, timeoutPromise]);
    }

    function _save(arr) {
        _initStore();
        return _store.setItem(STORAGE_KEY, arr).catch(function (e) {
            console.error('[书签] 保存失败:', e);
        });
    }

    // ─── 工具函数 ──────────────────────────────────────────────────────────
    function _genId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
    }

    function _relativeTime(ts) {
        var now = Date.now();
        var diff = now - ts;
        if (diff < 60000) return '刚刚';
        var minutes = Math.floor(diff / 60000);
        if (minutes < 60) return minutes + '分钟前';
        var hours = Math.floor(diff / 3600000);
        if (hours < 24) return hours + '小时前';
        var days = Math.floor(diff / 86400000);
        if (days < 30) return days + '天前';
        var months = Math.floor(days / 30);
        return months + '月前';
    }

    function _getViewLabel(viewType) {
        return VIEW_LABELS[viewType] || viewType || '';
    }

    // ─── Toast 通知 ─────────────────────────────────────────────────────────
    var _toastTimer = null;
    var _toastEl = null;

    function _injectToastStyle() {
        if (document.getElementById('cx-bm-toast-style')) return;
        var style = document.createElement('style');
        style.id = 'cx-bm-toast-style';
        style.textContent = [
            '.cx-bm-toast{position:fixed;bottom:80px;left:50%;transform:translateX(-50%) translateY(20px);',
            'background:rgba(50,50,50,.92);color:#fff;padding:10px 18px;border-radius:22px;',
            'font-size:14px;z-index:99999;display:flex;align-items:center;gap:12px;',
            'opacity:0;transition:opacity .25s,transform .25s;pointer-events:none;',
            'box-shadow:0 4px 16px rgba(0,0,0,.18)}',
            '.cx-bm-toast.show{opacity:1;transform:translateX(-50%) translateY(0);pointer-events:auto}',
            '.cx-bm-toast-text{white-space:nowrap}',
            '.cx-bm-toast-undo{color:#90caf9;cursor:pointer;font-weight:500;white-space:nowrap}'
        ].join('\n');
        document.head.appendChild(style);
    }

    function _showToast(text, undoFn) {
        _injectToastStyle();
        if (_toastEl) {
            _toastEl.parentNode && _toastEl.parentNode.removeChild(_toastEl);
            _toastEl = null;
        }
        if (_toastTimer) { clearTimeout(_toastTimer); _toastTimer = null; }

        var el = document.createElement('div');
        el.className = 'cx-bm-toast';
        var html = '<span class="cx-bm-toast-text">' + text + '</span>';
        if (undoFn) {
            html += '<span class="cx-bm-toast-undo">撤销</span>';
        }
        el.innerHTML = html;
        document.body.appendChild(el);
        _toastEl = el;

        if (undoFn) {
            var undoBtn = el.querySelector('.cx-bm-toast-undo');
            undoBtn.addEventListener('click', function () {
                _hideToast();
                undoFn();
            });
        }

        // trigger reflow then show
        void el.offsetWidth;
        el.classList.add('show');

        _toastTimer = setTimeout(function () {
            _hideToast();
        }, 2500);
    }

    function _hideToast() {
        if (!_toastEl) return;
        _toastEl.classList.remove('show');
        var ref = _toastEl;
        setTimeout(function () {
            ref.parentNode && ref.parentNode.removeChild(ref);
        }, 300);
        _toastEl = null;
        if (_toastTimer) { clearTimeout(_toastTimer); _toastTimer = null; }
    }

    // ─── 列表弹框样式（已迁移到 style.css，此处无需注入）───────────────────

    // ─── 核心方法 ──────────────────────────────────────────────────────────
    var CXBookmark = {

        /**
         * 添加书签
         * @param {Object} opts - {path, scrollY, title, batchPath, chapterNum, viewType, note}
         * @returns {Promise}
         */
        add: function (opts) {
            opts = opts || {};
            var path = opts.path || '';
            var scrollY = opts.scrollY || 0;
            var title = opts.title || '';
            var batchPath = opts.batchPath || '';
            var chapterNum = opts.chapterNum || 0;
            var viewType = opts.viewType || '';
            var note = opts.note || '';

            return _load().then(function (arr) {
                // 检查重复路径，更新已有书签
                var existIdx = -1;
                for (var i = 0; i < arr.length; i++) {
                    if (arr[i].path === path) {
                        existIdx = i;
                        break;
                    }
                }

                var bookmark;
                var isUpdate = false;
                if (existIdx >= 0) {
                    // 更新已有
                    bookmark = arr[existIdx];
                    bookmark.scrollY = scrollY;
                    bookmark.timestamp = Date.now();
                    if (note) bookmark.note = note;
                    if (title) bookmark.title = title;
                    isUpdate = true;
                    // 移到前面（最新）
                    arr.splice(existIdx, 1);
                    arr.unshift(bookmark);
                } else {
                    bookmark = {
                        id: _genId(),
                        path: path,
                        scrollY: scrollY,
                        title: title,
                        batchPath: batchPath,
                        chapterNum: chapterNum,
                        viewType: viewType,
                        note: note,
                        timestamp: Date.now()
                    };
                    arr.unshift(bookmark);
                }

                // 限制最大数量
                if (arr.length > MAX_BOOKMARKS) {
                    arr = arr.slice(0, MAX_BOOKMARKS);
                }

                return _save(arr).then(function () {
                    var addedId = bookmark.id;
                    _showToast(isUpdate ? '✓ 已更新书签' : '✓ 已添加书签', function () {
                        // 撤销：删除刚添加的书签
                        CXBookmark.remove(addedId);
                    });
                    return bookmark;
                });
            });
        },

        /**
         * 添加当前页书签
         * @param {Object} titleInfo - {trainingTitle, chapterNum, viewLabel}
         * @returns {Promise}
         */
        addCurrent: function (titleInfo) {
            titleInfo = titleInfo || {};
            var path = win.__cxCurrentPath || '';
            var scrollY = win.scrollY || 0;
            var parts = path.split('/').filter(Boolean);
            var batchPath = parts[0] || '';
            var chapterNum = parseInt(parts[1], 10) || 0;
            var viewType = parts[2] || '';

            var titleParts = [];
            if (titleInfo.trainingTitle) {
                titleParts.push(titleInfo.trainingTitle);
            } else if (batchPath) {
                titleParts.push(batchPath);
            }
            if (chapterNum) {
                titleParts.push('第' + chapterNum + '篇');
            }
            var vLabel = titleInfo.viewLabel || _getViewLabel(viewType);
            if (vLabel) {
                titleParts.push(vLabel);
            }
            var title = titleParts.join(' · ');

            return CXBookmark.add({
                path: path,
                scrollY: scrollY,
                title: title,
                batchPath: batchPath,
                chapterNum: chapterNum,
                viewType: viewType,
                note: ''
            });
        },

        /**
         * 删除书签
         * @param {String} id
         * @returns {Promise}
         */
        remove: function (id) {
            return _load().then(function (arr) {
                var filtered = [];
                for (var i = 0; i < arr.length; i++) {
                    if (arr[i].id !== id) filtered.push(arr[i]);
                }
                return _save(filtered);
            });
        },

        /**
         * 获取全部书签（按时间倒序）
         * @returns {Promise<Array>}
         */
        getAll: function () {
            return _load().then(function (arr) {
                arr.sort(function (a, b) { return b.timestamp - a.timestamp; });
                return arr;
            });
        },

        /**
         * 跳转到书签位置
         * @param {Object} bookmark
         */
        goto: function (bookmark) {
            if (!bookmark || !bookmark.path) return;
            if (win.CXRouter) {
                win.CXRouter.navigate(bookmark.path);
            }
            // 等待渲染完成后恢复滚动位置
            var targetY = bookmark.scrollY || 0;
            requestAnimationFrame(function () {
                requestAnimationFrame(function () {
                    win.scrollTo(0, targetY);
                });
            });
        },

        /**
         * 显示书签列表弹框
         */
        showList: function () {
            console.log('[书签] showList() 开始加载...');
            CXBookmark.getAll().then(function (arr) {
                console.log('[书签] 加载完成，共 ' + arr.length + ' 条书签');
                // 判断是否在内容页（可以添加书签）
                var curPath = win.__cxCurrentPath || '';
                var curParts = curPath.split('/').filter(Boolean);
                var isContentPage = curParts.length >= 3;

                var bodyHtml = '';
                if (!arr.length) {
                    bodyHtml = '<div class="cx-bm-empty">' +
                        '<div class="cx-bm-empty-icon">📑</div>' +
                        '<div class="cx-bm-empty-text">暂无书签</div>' +
                        '<div class="cx-bm-empty-hint">在阅读页点击下方"添加当前页"按钮</div>' +
                        '</div>';
                } else {
                    for (var i = 0; i < arr.length; i++) {
                        var bm = arr[i];
                        var displayTitle = bm.title || bm.path || '未命名';
                        var meta = _relativeTime(bm.timestamp);
                        if (bm.note) meta += ' · ' + bm.note;
                        bodyHtml += '<div class="cx-bm-item" data-id="' + bm.id + '">' +
                            '<div class="cx-bm-item-main">' +
                            '<div class="cx-bm-item-title">' + _escHtml(displayTitle) + '</div>' +
                            '<div class="cx-bm-item-meta">' + _escHtml(meta) + '</div>' +
                            '</div>' +
                            '<button class="cx-bm-item-del" aria-label="删除">✕</button>' +
                            '</div>';
                    }
                }

                // 底部操作栏：添加当前页 + 关闭 (+ 清空全部)
                var addBtnHtml = isContentPage
                    ? '<button class="cx-dialog-confirm" data-action="add" style="color:var(--brand);font-weight:600">添加当前页</button>'
                    : '';
                var clearBtnHtml = arr.length
                    ? '<button class="cx-dialog-confirm" data-action="clear" style="color:var(--danger-text)">清空全部</button>'
                    : '';
                var footerHtml = '<div class="cx-dialog-actions">' +
                    '<button class="cx-dialog-cancel" data-action="close"' + (!addBtnHtml && !clearBtnHtml ? ' style="flex:1;border-right:none"' : '') + '>关闭</button>' +
                    addBtnHtml + clearBtnHtml +
                    '</div>';

                var dialogHtml = '<div class="cx-dialog" style="width:min(360px,calc(100vw - 40px))">' +
                    '<div class="cx-dialog-title">📑 我的书签</div>' +
                    '<div class="cx-bm-list-body">' + bodyHtml + '</div>' +
                    footerHtml +
                    '</div>';

                var dlg = win.CX.openDialog({
                    id: 'cx-bookmark-list',
                    html: dialogHtml
                });

                if (!dlg) {
                    console.warn('[书签] openDialog 返回 null，弹框可能已存在');
                    return;
                }

                var dialogEl = document.getElementById('cx-bookmark-list');
                if (!dialogEl) return;

                // 事件委托
                dialogEl.addEventListener('click', function (e) {
                    var t = e.target;

                    // 关闭按钮
                    if (t.getAttribute('data-action') === 'close') {
                        dlg.close();
                        return;
                    }

                    // 添加当前页书签
                    if (t.getAttribute('data-action') === 'add') {
                        var viewLabels = {cv:'纲目', cx:'晨读', h:'听抄', ts:'详情', sg:'诗歌', zs:'职事摘录', motto:'标语', motto_song:'诗歌'};
                        var p = curParts;
                        // 从缓存的训练数据中获取标题
                        var trainTitle = '';
                        if (win.__cxTrainings) {
                            for (var ti = 0; ti < win.__cxTrainings.length; ti++) {
                                if (win.__cxTrainings[ti].path === p[0]) {
                                    trainTitle = win.__cxTrainings[ti].title || win.__cxTrainings[ti].season || '';
                                    break;
                                }
                            }
                        }
                        dlg.close();
                        CXBookmark.addCurrent({
                            trainingTitle: trainTitle,
                            chapterNum: parseInt(p[1], 10) || p[1],
                            viewLabel: viewLabels[p[2]] || p[2]
                        });
                        return;
                    }

                    // 清空全部
                    if (t.getAttribute('data-action') === 'clear') {
                        if (!confirm('确定清空全部书签？')) return;
                        _save([]).then(function () {
                            var body = dialogEl.querySelector('.cx-bm-list-body');
                            if (body) {
                                body.innerHTML = '<div class="cx-bm-empty">' +
                                    '<div class="cx-bm-empty-icon">📑</div>' +
                                    '<div class="cx-bm-empty-text">暂无书签</div>' +
                                    '<div class="cx-bm-empty-hint">在阅读页点击下方"添加当前页"按钮</div>' +
                                    '</div>';
                            }
                            // 隐藏清空按钮
                            var clearBtn = dialogEl.querySelector('[data-action="clear"]');
                            if (clearBtn) clearBtn.style.display = 'none';
                            var cancelBtn = dialogEl.querySelector('[data-action="close"]');
                            if (cancelBtn) cancelBtn.style.borderRight = 'none';
                        });
                        return;
                    }

                    // 删除单条
                    var delBtn = t.closest ? t.closest('.cx-bm-item-del') : null;
                    if (!delBtn && t.classList && t.classList.contains('cx-bm-item-del')) delBtn = t;
                    if (delBtn) {
                        var itemDiv = delBtn.parentNode;
                        var bmId = itemDiv.getAttribute('data-id');
                        itemDiv.style.opacity = '0';
                        itemDiv.style.transform = 'translateX(30px)';
                        itemDiv.style.transition = 'opacity .2s,transform .2s';
                        setTimeout(function () {
                            if (itemDiv.parentNode) itemDiv.parentNode.removeChild(itemDiv);
                            var remaining = dialogEl.querySelectorAll('.cx-bm-item');
                            if (!remaining.length) {
                                var body = dialogEl.querySelector('.cx-bm-list-body');
                                if (body) {
                                    body.innerHTML = '<div class="cx-bm-empty">' +
                                        '<div class="cx-bm-empty-icon">📑</div>' +
                                        '<div class="cx-bm-empty-text">暂无书签</div>' +
                                        '<div class="cx-bm-empty-hint">在阅读页点击下方"添加当前页"按钮</div>' +
                                        '</div>';
                                }
                                var clearBtn2 = dialogEl.querySelector('[data-action="clear"]');
                                if (clearBtn2) clearBtn2.style.display = 'none';
                                var cancelBtn2 = dialogEl.querySelector('[data-action="close"]');
                                if (cancelBtn2) cancelBtn2.style.borderRight = 'none';
                            }
                        }, 200);
                        CXBookmark.remove(bmId);
                        return;
                    }

                    // 点击书签项跳转
                    var itemMain = t.closest ? t.closest('.cx-bm-item-main') : null;
                    if (!itemMain && t.classList && t.classList.contains('cx-bm-item-main')) itemMain = t;
                    if (!itemMain && t.parentNode && t.parentNode.classList && t.parentNode.classList.contains('cx-bm-item-main')) itemMain = t.parentNode;
                    if (itemMain) {
                        var parentItem = itemMain.parentNode;
                        var targetId = parentItem.getAttribute('data-id');
                        var target = null;
                        for (var k = 0; k < arr.length; k++) {
                            if (arr[k].id === targetId) { target = arr[k]; break; }
                        }
                        // 移除弹框 DOM + discard backStack（不调 history.back，避免与路由跳转竞态）
                        var mask = document.getElementById('cx-bookmark-list');
                        if (mask && mask.parentNode) mask.parentNode.removeChild(mask);
                        if (win.CX && win.CX.backStack && win.CX.backStack.discard) win.CX.backStack.discard();
                        // 写入目标滚动位置到 localStorage，让 renderer 的滚动恢复机制自动还原
                        if (target && target.path) {
                            var scrollKey = 'cx_scroll:' + target.path;
                            try { localStorage.setItem(scrollKey, String(target.scrollY || 0)); } catch(e) {}
                            // 用 navigateReplace 替换当前历史条目（与搜索跳转同模式）
                            if (win.CXRouter && win.CXRouter.navigateReplace) {
                                win.CXRouter.navigateReplace(target.path);
                            } else if (win.CXRouter) {
                                win.CXRouter.navigate(target.path);
                            }
                        }
                    }
                });
            });
        },

        /**
         * 获取视图标签名
         * @param {String} viewType
         * @returns {String}
         */
        getViewLabel: _getViewLabel
    };

    // ─── HTML 转义 ─────────────────────────────────────────────────────────
    function _escHtml(str) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    // ─── 暴露 ──────────────────────────────────────────────────────────────
    win.CXBookmark = CXBookmark;

}(window));
