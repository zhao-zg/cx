/*!
 * search.js — 特会信息合集全文搜索
 * 索引懒加载 + 全屏 Modal UI + 段落级定位
 */
(function (win) {
  'use strict';

  // ── 工具 ─────────────────────────────────────────────────────────────────

  function esc(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function escRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ── 核心对象 ──────────────────────────────────────────────────────────────

  var CXSearch = {
    _modal: null,
    _input: null,
    _resultsEl: null,
    _countEl: null,
    _debounceTimer: null,
    _inBackStack: false,

    // ── 搜索缓存与状态 ────────────────────────────────────────────────────────

    // 内存缓存：path → entries[]
    _searchCache: {},
    // 各训练版本号（来自 trainings.json）：path → version string
    _trainingVersions: {},
    // 当前搜索队列（当前训练优先）
    _searchQueue: [],
    // 下一批起始偏移
    _queueOffset: 0,
    // 当前搜索词（供「查看更多训练」复用）
    _currentQuery: '',
    // 每批加载的训练数量
    SEARCH_BATCH_SIZE: 5,

    // ── 从 training.json 数据提取搜索 entries（纯JS，不写文件）────────────

    _buildSearchEntries: function (path, data) {
      var entries = [];
      var trainingTitle = data.title || '';
      var yearStr = data.year ? String(data.year) : '';
      var seasonStr = data.season || '';
      var seasonLabel = yearStr + (seasonStr ? ('-' + seasonStr) : '');

      function flattenSections(sections, buf) {
        if (!sections) return;
        for (var i = 0; i < sections.length; i++) {
          var sec = sections[i];
          var t = ((sec.level || '') + ' ' + (sec.title || '')).trim();
          if (t) buf.push(t);
          var cont = sec.content || [];
          for (var j = 0; j < cont.length; j++) {
            if (cont[j]) buf.push(cont[j]);
          }
          flattenSections(sec.children, buf);
        }
      }

      var chapters = data.chapters || [];
      for (var cidx = 0; cidx < chapters.length; cidx++) {
        var chapter = chapters[cidx];
        var num = chapter.number || (cidx + 1);
        var chTitle = '第' + num + '篇 ' + (chapter.title || '');

        // h: 听抄
        var mc = chapter.message_content || [];
        for (var pi = 0; pi < mc.length; pi++) {
          var para = mc[pi] || '';
          if (para.length >= 10) {
            entries.push({ url: path + '/' + num + '/h',
              training: trainingTitle, season_label: seasonLabel,
              chapter: num, type: 'h', type_label: '听抄',
              chapter_title: chTitle, pi: pi,
              selector: 'content-text', text: para.slice(0, 200) });
          }
        }

        // cv: 纲目
        var cvBuf = [];
        flattenSections(chapter.outline_sections, cvBuf);
        for (var pi2 = 0; pi2 < cvBuf.length; pi2++) {
          if (cvBuf[pi2].length >= 10) {
            entries.push({ url: path + '/' + num + '/cv',
              training: trainingTitle, season_label: seasonLabel,
              chapter: num, type: 'cv', type_label: '纲目',
              chapter_title: chTitle, pi: pi2,
              selector: 'outline-item', text: cvBuf[pi2].slice(0, 200) });
          }
        }

        // cx: 晨读
        var revivals = chapter.morning_revivals || [];
        for (var dayIdx = 0; dayIdx < revivals.length; dayIdx++) {
          var revival = revivals[dayIdx];
          var mf = revival.morning_feeding || [];
          for (var mfi = 0; mfi < mf.length; mfi++) {
            var mfp = mf[mfi] || '';
            if (mfp.length >= 10) {
              entries.push({ url: path + '/' + num + '/cx',
                training: trainingTitle, season_label: seasonLabel,
                chapter: num, type: 'cx', type_label: '晨读喂养',
                chapter_title: chTitle, pi: mfi, day_index: dayIdx,
                selector: 'content-text', text: mfp.slice(0, 200) });
            }
          }
          var mfLen = mf.length;
          var mr = revival.message_reading || [];
          for (var mri = 0; mri < mr.length; mri++) {
            var mrp = mr[mri] || '';
            if (mrp.length >= 10) {
              entries.push({ url: path + '/' + num + '/cx',
                training: trainingTitle, season_label: seasonLabel,
                chapter: num, type: 'cx', type_label: '信息选读',
                chapter_title: chTitle, pi: mfLen + mri, day_index: dayIdx,
                selector: 'content-text', text: mrp.slice(0, 200) });
            }
          }
        }

        // zs: 职事摘录
        var zs = chapter.ministry_excerpt || '';
        if (zs.length >= 10) {
          entries.push({ url: path + '/' + num + '/zs',
            training: trainingTitle, season_label: seasonLabel,
            chapter: num, type: 'zs', type_label: '职事摘录',
            chapter_title: chTitle, pi: 0,
            selector: 'content-text', text: zs.slice(0, 200) });
        }
      }
      return entries;
    },

    // ── 缓存训练搜索数据（renderer.js 加载 training.json 后异步调用）────────

    _cacheTraining: function (path, data) {
      var entries = this._buildSearchEntries(path, data);
      this._searchCache[path] = entries;
      if (!win.localforage) return;
      var version = this._trainingVersions[path] || data.version || '';
      win.localforage.setItem('cx_search_' + path, { version: version, entries: entries });
    },

    // ── 确保 trainings.json 已加载（建立版本表和搜索队列）──────────────────

    _ensureTrainings: function () {
      var self = this;
      if (Object.keys(this._trainingVersions).length > 0) return Promise.resolve();
      var root = (win.CX_ROOT !== undefined ? win.CX_ROOT : './');
      return fetch(root + 'trainings.json?_t=' + Date.now())
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function (data) {
          var trainings = data.trainings || [];
          trainings.forEach(function (t) {
            self._trainingVersions[t.path] = t.version || '';
          });
          var paths = trainings.map(function (t) { return t.path; });
          var ctx = self._currentContext();
          if (ctx && ctx.trainingPath) {
            var curPath = ctx.trainingPath;
            paths = [curPath].concat(paths.filter(function (p) { return p !== curPath; }));
          }
          // 只保留已缓存的训练（有 cx-{path} 缓存键，或已有本地搜索索引）
          return self._filterCachedPaths(paths);
        })
        .then(function (filtered) {
          self._searchQueue = filtered;
        })
        .catch(function () {
          if (!self._searchQueue.length) {
            self._searchQueue = Object.keys(self._searchCache);
          }
        });
    },

    // 过滤出有 SW 缓存（cx-{path}）或本地搜索索引的训练路径
    _filterCachedPaths: function (paths) {
      var self = this;
      if (!('caches' in win)) {
        // 无 SW 环境：只保留已有本地搜索索引的训练
        return Promise.resolve(paths.filter(function (p) { return !!self._searchCache[p]; }));
      }
      return win.caches.keys().then(function (keys) {
        var cxSet = {};
        keys.forEach(function (k) { cxSet[k] = true; });
        return paths.filter(function (p) { return cxSet['cx-' + p]; });
      }).catch(function () { return paths; });
    },


    // ── 持续加载批次直到有 targetGroups 个训练产生结果，或队列耗尽 ───────────
    // 返回 Promise<{entries, newOffset}>

    _loadUntilEnoughResults: function (startOffset, targetGroups, query) {
      var self = this;
      var allEntries = [];
      function step(off) {
        if (off >= self._searchQueue.length) return Promise.resolve(off);
        return self._loadBatch(off).then(function () {
          var paths = self._searchQueue.slice(off, off + self.SEARCH_BATCH_SIZE);
          var newOff = Math.min(off + self.SEARCH_BATCH_SIZE, self._searchQueue.length);
          paths.forEach(function (p) {
            if (self._searchCache[p]) allEntries = allEntries.concat(self._searchCache[p]);
          });
          var result = self.search(query, allEntries);
          if (result.groups.length >= targetGroups || newOff >= self._searchQueue.length) {
            return Promise.resolve(newOff);
          }
          return step(newOff);
        });
      }
      return step(startOffset).then(function (newOff) {
        return { entries: allEntries, newOffset: newOff };
      });
    },

    // ── 加载一批训练的搜索数据（localforage 命中 → fetch 降级）──────────────

    _loadBatch: function (offset) {
      var self = this;
      var root = (win.CX_ROOT !== undefined ? win.CX_ROOT : './');
      var paths = this._searchQueue.slice(offset, offset + this.SEARCH_BATCH_SIZE);
      var promises = paths.map(function (path) {
        if (self._searchCache[path]) return Promise.resolve();
        var expectedVer = self._trainingVersions[path] || '';
        var fromForage = win.localforage
          ? win.localforage.getItem('cx_search_' + path)
          : Promise.resolve(null);
        return fromForage.then(function (cached) {
          if (cached && cached.version === expectedVer && cached.entries) {
            self._searchCache[path] = cached.entries;
            return;
          }
          // _searchQueue 已过滤为已缓存训练，fetch 将由 SW 从缓存返回，不走网络
          return fetch(root + path + '/training.json')
            .then(function (r) {
              if (!r.ok) throw new Error('HTTP ' + r.status);
              return r.json();
            })
            .then(function (data) {
              var entries = self._buildSearchEntries(path, data);
              self._searchCache[path] = entries;
              if (win.localforage) {
                var ver = self._trainingVersions[path] || data.version || '';
                win.localforage.setItem('cx_search_' + path, { version: ver, entries: entries });
              }
            })
            .catch(function () {});
        }).catch(function () {});
      });
      return Promise.all(promises);
    },

    // ── 搜索逻辑（多关键词 AND 子串匹配）────────────────────────────────

    // 每个训练最多显示条数
    MAX_PER_TRAINING: 5,

    // 每次点击「显示更多」追加的条数
    LOAD_MORE_BATCH: 8,

    // 从当前 URL 解析 { trainingPath, chapter }，章节页才有意义
    _currentContext: function () {
      var path = win.location.pathname;
      // 章节页：/2025-04/1_h.htm
      var m = path.match(/\/([^/]+)\/(\d+)_[a-z]+\.htm$/i);
      if (m) return { trainingPath: m[1], chapter: parseInt(m[2], 10) };
      // 目录/标语页：/2025-04/index.html  /2025-04/motto.htm  /2025-04/
      var m2 = path.match(/\/(\d{4}-\d{2}[^/]*)\/[^/]*$/);
      if (m2) return { trainingPath: m2[1], chapter: null };
      return null;
    },

    search: function (query, entries) {
      if (!entries || !entries.length || !query.trim()) return { groups: [], totalVisible: 0, totalAll: 0 };

      var terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
      var ctx = this._currentContext();   // { trainingPath, chapter } | null

      // 按训练分组收集所有匹配（上限 500，避免超大索引卡顿）
      var groupMap = {};   // season_label -> { all: [], trainingPath: '' }
      var groupOrder = []; // 保持训练出现顺序
      var totalAll = 0;

      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        var hay = e.chapter_title + e.text;
        var ok = true;
        for (var j = 0; j < terms.length; j++) {
          if (hay.indexOf(terms[j]) === -1) { ok = false; break; }
        }
        if (!ok) continue;
        totalAll++;
        var gKey = e.season_label || e.training;
        if (!groupMap[gKey]) {
          // 从 entry.url（如 "2025-04/1_h.htm"）提取 trainingPath
          var tp = (e.url || '').split('/')[0] || '';
          groupMap[gKey] = { all: [], trainingPath: tp };
          groupOrder.push(gKey);
        }
        groupMap[gKey].all.push(e);
        if (totalAll >= 500) break;
      }

      // ── 对 groupOrder 重排：本训练优先，其他保持原顺序 ──────────────
      if (ctx) {
        var curTP = ctx.trainingPath;
        groupOrder.sort(function (a, b) {
          var aIsCur = groupMap[a].trainingPath === curTP ? 0 : 1;
          var bIsCur = groupMap[b].trainingPath === curTP ? 0 : 1;
          if (aIsCur !== bIsCur) return aIsCur - bIsCur;
          return 0; // 相同优先级保持原顺序（Array.sort 在现代引擎稳定）
        });
      }

      // ── 每组截断；当前训练组内本篇条目优先 ──────────────────────────
      var maxN = this.MAX_PER_TRAINING;
      var groups = [];
      var totalVisible = 0;

      for (var k = 0; k < groupOrder.length; k++) {
        var t = groupOrder[k];
        var gdata = groupMap[t];
        var all = gdata.all;
        var isCurTraining = ctx && gdata.trainingPath === ctx.trainingPath;

        var visible, hiddenEntries, hiddenCount;
        if (isCurTraining) {
          // 本训练：本篇条目先排，其余后排，各自内部顺序不变
          var curChap = [], otherChap = [];
          for (var n = 0; n < all.length; n++) {
            if (all[n].chapter === ctx.chapter) curChap.push(all[n]);
            else otherChap.push(all[n]);
          }
          var combined = curChap.concat(otherChap);
          visible = combined.slice(0, maxN);
          hiddenEntries = combined.slice(maxN);
          hiddenCount = hiddenEntries.length;
        } else {
          visible = all.slice(0, maxN);
          hiddenEntries = all.slice(maxN);
          hiddenCount = hiddenEntries.length;
        }

        totalVisible += visible.length;
        groups.push({
          training:       t,
          entries:        visible,
          _hiddenEntries: hiddenEntries,
          hiddenCount:    hiddenCount,
          isCurrent:      !!isCurTraining
        });
      }

      return { groups: groups, totalVisible: totalVisible, totalAll: totalAll };
    },

    extractSnippet: function (text, terms) {
      if (!text) return '';
      var lc = text.toLowerCase();
      var idx = -1;
      for (var i = 0; i < terms.length; i++) {
        idx = lc.indexOf(terms[i]);
        if (idx !== -1) break;
      }
      if (idx === -1) idx = 0;

      var s = Math.max(0, idx - 40);
      var e = Math.min(text.length, idx + 100);
      var snippet = (s > 0 ? '…' : '') + esc(text.slice(s, e)) + (e < text.length ? '…' : '');

      // 高亮所有关键词
      terms.forEach(function (t) {
        var re = new RegExp('(' + escRe(esc(t)) + ')', 'gi');
        snippet = snippet.replace(re, '<mark>$1</mark>');
      });
      return snippet;
    },

    // ── 跳转到搜索结果（sessionStorage 桥接）────────────────────────────

    navigateTo: function (entry, query) {
      try {
        sessionStorage.setItem('cx_search_target', JSON.stringify({
          url:      entry.url,
          pi:       entry.pi,
          selector: entry.selector,
          query:    query
        }));
      } catch (e) { /* storage 不可用时忽略 */ }

      var root = (win.CX_ROOT !== undefined ? win.CX_ROOT : './');
      win.location.href = root + entry.url;
    },

    // ── 目标页加载后高亮定位 ──────────────────────────────────────────────

    handleSearchTarget: function () {
      var raw;
      try {
        raw = sessionStorage.getItem('cx_search_target');
        if (!raw) return;
        sessionStorage.removeItem('cx_search_target');
      } catch (e) { return; }

      var target;
      try { target = JSON.parse(raw); } catch (e) { return; }

      // 验证文件名与当前页面匹配
      var targetFile = (target.url || '').split('/').pop();
      var currentPath = win.location.pathname;
      if (!targetFile || !currentPath.endsWith(targetFile)) return;

      function doHighlight() {
        var els = document.querySelectorAll('.' + target.selector);
        var el = els[target.pi];
        if (!el) return;

        // 显示隐藏的祖先节点；晨读（_cx.htm）用 translateX 横滑，需点击对应 day-link
        var dayPage = null;
        var node = el.parentElement;
        while (node && node !== document.body) {
          if (node.classList && node.classList.contains('day-page')) { dayPage = node; break; }
          if (node.style.display === 'none') node.style.display = '';
          node = node.parentElement;
        }

        var doScroll = function () {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        };

        if (dayPage) {
          var dayIndex = parseInt(dayPage.getAttribute('data-page'), 10);
          var dayLinks = document.querySelectorAll('.day-link');
          if (!isNaN(dayIndex) && dayLinks[dayIndex]) {
            dayLinks[dayIndex].click();
          }
          // 等 .3s 切页动画完成，再将匹配段落滚到距视口顶部 80px 处；
          // 使用绝对文档坐标（scrollY + rect.top）保证不受上一个 scrollTo 动画影响。
          setTimeout(function () {
            var rect = el.getBoundingClientRect();
            var scrollY = window.pageYOffset || document.documentElement.scrollTop;
            var targetY = Math.max(0, scrollY + rect.top - 80);
            window.scrollTo({ top: targetY, behavior: 'smooth' });
          }, 350);
        } else {
          doScroll();
        }

        // 在段落内用 <mark> 高亮关键词，2 秒后移除
        var terms = (target.query || '').trim().split(/\s+/).filter(Boolean);
        if (!terms.length) return;

        // 构建匹配正则（转义特殊字符，多词 OR）
        var reStr = terms.map(function (t) {
          return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }).join('|');
        var re = new RegExp('(' + reStr + ')', 'gi');

        // ── 元素级高亮：无论文字是否匹配，始终标注目标元素 ──────────
        // 应对搜索词跨文本节点边界（如进入 scripture-ref span）导致 wrapText 无法匹配的情况。
        el.classList.add('cx-search-target');

        // 仅对文本节点操作，避免破坏子元素（scripture-ref 等）
        var marks = [];
        (function wrapText(node) {
          if (node.nodeType === 3) {           // TEXT_NODE
            var val = node.nodeValue;
            if (!re.test(val)) return;
            re.lastIndex = 0;
            var frag = document.createDocumentFragment();
            var last = 0, m;
            while ((m = re.exec(val)) !== null) {
              if (m.index > last) frag.appendChild(document.createTextNode(val.slice(last, m.index)));
              var mark = document.createElement('mark');
              mark.className = 'cx-search-hl';
              mark.textContent = m[1];
              frag.appendChild(mark);
              marks.push(mark);
              last = m.index + m[1].length;
            }
            if (last < val.length) frag.appendChild(document.createTextNode(val.slice(last)));
            node.parentNode.replaceChild(frag, node);
          } else if (node.nodeType === 1 && node.tagName !== 'MARK') {
            // 遍历子节点（用快照避免边遍历边修改）
            Array.prototype.slice.call(node.childNodes).forEach(wrapText);
          }
        })(el);

        // 5 秒后淡出移除（晨读页需要时间滚动到匹配位置，延长高亮时间）
        setTimeout(function () {
          el.classList.remove('cx-search-target');
          marks.forEach(function (mark) {
            mark.style.transition = 'background-color 0.5s';
            mark.style.backgroundColor = 'transparent';
          });
          setTimeout(function () {
            marks.forEach(function (mark) {
              if (mark.parentNode) {
                mark.parentNode.replaceChild(document.createTextNode(mark.textContent), mark);
              }
            });
          }, 600);
        }, 5000);
      }

      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(doHighlight, 400);
      } else {
        document.addEventListener('DOMContentLoaded', function () {
          setTimeout(doHighlight, 400);
        });
      }
    },

    // ── SPA 版高亮定位（renderer.js 在 renderChapterView 完成后调用）─────
    // 与 handleSearchTarget 逻辑相同，但用 router 当前路径验证，而非 pathname。
    handleSearchTargetSPA: function () {
      var raw;
      try {
        raw = sessionStorage.getItem('cx_search_target');
        if (!raw) return;
        sessionStorage.removeItem('cx_search_target');
      } catch (e) { return; }

      var target;
      try { target = JSON.parse(raw); } catch (e) { return; }

      // 用 router 当前路径验证目标是否匹配（SPA hash 路由，pathname 不变）
      var currentPath = win.CXRouter ? win.CXRouter.currentPath() : win.location.hash.replace(/^#\/?/, '');
      if (!target.url || target.url !== currentPath) return;

      // cx 视图：用 day_index 限定查询范围到具体 day-page，避免全局 pi 错位
      var el;
      if (typeof target.day_index === 'number') {
        var scopeEl = document.querySelector('.day-page[data-page="' + target.day_index + '"]');
        if (scopeEl) el = scopeEl.querySelectorAll('.' + target.selector)[target.pi];
      } else {
        el = document.querySelectorAll('.' + target.selector)[target.pi];
      }
      if (!el) return;

      // 显示隐藏祖先；晨读横滑 day-page 需点击对应 day-link
      var dayPage = null;
      var node = el.parentElement;
      while (node && node !== document.body) {
        if (node.classList && node.classList.contains('day-page')) { dayPage = node; break; }
        if (node.style.display === 'none') node.style.display = '';
        node = node.parentElement;
      }

      if (dayPage) {
        var dayIndex = parseInt(dayPage.getAttribute('data-page'), 10);
        var dayLinks = document.querySelectorAll('.day-link');
        if (!isNaN(dayIndex) && dayLinks[dayIndex]) {
          dayLinks[dayIndex].click();
        }
        setTimeout(function () {
          var rect = el.getBoundingClientRect();
          var scrollY = window.pageYOffset || document.documentElement.scrollTop;
          var targetY = Math.max(0, scrollY + rect.top - 80);
          window.scrollTo({ top: targetY, behavior: 'smooth' });
        }, 350);
      } else {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      // 关键词 <mark> 高亮，5 秒后淡出移除
      var terms = (target.query || '').trim().split(/\s+/).filter(Boolean);
      if (!terms.length) return;

      var reStr = terms.map(function (t) {
        return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }).join('|');
      var re = new RegExp('(' + reStr + ')', 'gi');

      el.classList.add('cx-search-target');
      var marks = [];
      (function wrapText(nd) {
        if (nd.nodeType === 3) {
          var val = nd.nodeValue;
          if (!re.test(val)) return;
          re.lastIndex = 0;
          var frag = document.createDocumentFragment();
          var last = 0, m;
          while ((m = re.exec(val)) !== null) {
            if (m.index > last) frag.appendChild(document.createTextNode(val.slice(last, m.index)));
            var mark = document.createElement('mark');
            mark.className = 'cx-search-hl';
            mark.textContent = m[1];
            frag.appendChild(mark);
            marks.push(mark);
            last = m.index + m[1].length;
          }
          if (last < val.length) frag.appendChild(document.createTextNode(val.slice(last)));
          nd.parentNode.replaceChild(frag, nd);
        } else if (nd.nodeType === 1 && nd.tagName !== 'MARK') {
          Array.prototype.slice.call(nd.childNodes).forEach(wrapText);
        }
      })(el);

      setTimeout(function () {
        el.classList.remove('cx-search-target');
        marks.forEach(function (mark) {
          mark.style.transition = 'background-color 0.5s';
          mark.style.backgroundColor = 'transparent';
        });
        setTimeout(function () {
          marks.forEach(function (mark) {
            if (mark.parentNode) {
              mark.parentNode.replaceChild(document.createTextNode(mark.textContent), mark);
            }
          });
        }, 600);
      }, 5000);
    },

    // ── Modal 开/关 ───────────────────────────────────────────────────────

    open: function () {
      if (!this._modal) this._buildUI();
      this._modal.classList.add('active');
      var self = this;
      // 等 DOM 渲染完再 focus（避免 iOS 键盘弹出时滚动问题）
      setTimeout(function () { self._input.focus(); }, 50);

      if (!this._inBackStack && win.CX && win.CX.backStack) {
        win.CX.backStack.push(function () { self.close(); });
        this._inBackStack = true;
      }

      // 确保 trainings.json 已加载（建立版本表和搜索队列）
      this._ensureTrainings().then(function () {
        if (self._input.value.trim()) self._doSearch(self._input.value);
      });
    },

    close: function () {
      if (!this._modal || !this._modal.classList.contains('active')) return;
      this._modal.classList.remove('active');
      if (this._inBackStack && win.CX && win.CX.backStack) {
        win.CX.backStack.pop();
        this._inBackStack = false;
      }
    },

    // ── 执行搜索 ─────────────────────────────────────────────────────────

    _doSearch: function (query) {
      var self = this;
      var q = query.trim();
      if (!q) {
        this._countEl.textContent = '';
        this._resultsEl.innerHTML = '';
        return;
      }
      this._currentQuery = q;
      this._queueOffset = 0;
      this._countEl.textContent = '搜索中…';
      this._resultsEl.innerHTML = '';
      this._ensureTrainings().then(function () {
        return self._loadUntilEnoughResults(0, self.SEARCH_BATCH_SIZE, q);
      }).then(function (loaded) {
        self._queueOffset = loaded.newOffset;
        var terms = q.toLowerCase().split(/\s+/).filter(Boolean);
        var result = self.search(q, loaded.entries);
        if (loaded.entries.length === 0) {
          self._countEl.textContent = '请先访问训练页面以建立搜索索引';
        } else if (result.totalAll === 0) {
          self._countEl.textContent = '未找到相关内容';
        } else if (result.totalAll > result.totalVisible) {
          self._countEl.textContent = '共 ' + result.totalAll + ' 条结果，每个训练显示前 ' + self.MAX_PER_TRAINING + ' 条';
        } else {
          self._countEl.textContent = '共 ' + result.totalAll + ' 条结果';
        }
        self._renderResults(result.groups, terms, q);
        var remaining = self._searchQueue.length - self._queueOffset;
        if (remaining > 0) {
          self._resultsEl.appendChild(self._buildLoadMoreTrainingsBtn(remaining));
        }
      });
    },

    // 构建单条结果 DOM
    _buildItem: function (entry, terms, query) {
      var self = this;
      var TYPE_ICON = { h: '📖', cx: '🌅', cv: '📋', zs: '📝' };
      var item = document.createElement('div');
      item.className = 'cx-search-item';
      var icon = TYPE_ICON[entry.type] || '📄';
      item.innerHTML =
        '<div class="cx-search-item-meta">' + icon + ' 第' + entry.chapter + '篇 &middot; ' + esc(entry.type_label) + '</div>' +
        '<div class="cx-search-item-title">' + esc(entry.chapter_title) + '</div>' +
        '<div class="cx-search-item-snippet">' + self.extractSnippet(entry.text, terms) + '</div>';
      item.addEventListener('click', (function (e) {
        return function () { self.navigateTo(e, query); };
      })(entry));
      return item;
    },

    // ── 追加结果分组到指定容器（供 _renderResults 和 _appendMoreTrainings 复用）

    _appendGroupsToEl: function (groups, terms, query, el) {
      var self = this;
      var frag = document.createDocumentFragment();
      groups.forEach(function (group) {
        var grp = document.createElement('div');
        grp.className = 'cx-search-group' + (group.isCurrent ? ' cx-search-group--current' : '');
        grp.textContent = group.training + (group.isCurrent ? ' ★' : '');
        frag.appendChild(grp);
        group.entries.forEach(function (entry) {
          frag.appendChild(self._buildItem(entry, terms, query));
        });
        if (group.hiddenCount > 0) {
          frag.appendChild(self._buildMoreBtn(group, terms, query));
        }
      });
      el.appendChild(frag);
    },

    // ── 渲染结果列表 ─────────────────────────────────────────────────────

    _renderResults: function (groups, terms, query) {
      this._resultsEl.innerHTML = '';
      this._appendGroupsToEl(groups, terms, query, this._resultsEl);
    },

    // 构建「显示更多」按钮，点击后追加下一批并更新自身
    _buildMoreBtn: function (group, terms, query) {
      var self = this;
      // group.allEntries 存储完整列表，group.shownCount 追踪已渲染数量
      if (!group.allEntries) {
        group.allEntries = group.entries.concat(group._hiddenEntries || []);
        group.shownCount = group.entries.length;
      }
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cx-search-more cx-search-more--btn';
      var remaining = group.allEntries.length - group.shownCount;
      btn.textContent = '显示更多（还有 ' + remaining + ' 条）';

      btn.addEventListener('click', function () {
        var batchSize = self.LOAD_MORE_BATCH;
        var start = group.shownCount;
        var end = Math.min(start + batchSize, group.allEntries.length);
        var frag = document.createDocumentFragment();
        for (var i = start; i < end; i++) {
          frag.appendChild(self._buildItem(group.allEntries[i], terms, query));
        }
        group.shownCount = end;
        var newRemaining = group.allEntries.length - group.shownCount;
        if (newRemaining > 0) {
          btn.textContent = '显示更多（还有 ' + newRemaining + ' 条）';
          btn.parentNode.insertBefore(frag, btn);
        } else {
          btn.parentNode.insertBefore(frag, btn);
          btn.parentNode.removeChild(btn);
        }
      });

      return btn;
    },

    // ── 加载更多训练并追加结果 ─────────────────────────────────────────────

    _appendMoreTrainings: function (btn) {
      var self = this;
      btn.disabled = true;
      btn.textContent = '加载中…';
      var offset = this._queueOffset;
      var q = this._currentQuery;
      this._loadUntilEnoughResults(offset, self.SEARCH_BATCH_SIZE, q).then(function (loaded) {
        self._queueOffset = loaded.newOffset;
        var terms = q.toLowerCase().split(/\s+/).filter(Boolean);
        var result = self.search(q, loaded.entries);
        if (btn.parentNode) btn.parentNode.removeChild(btn);
        if (result.groups.length > 0) {
          self._appendGroupsToEl(result.groups, terms, q, self._resultsEl);
        }
        var remaining = self._searchQueue.length - self._queueOffset;
        if (remaining > 0) {
          self._resultsEl.appendChild(self._buildLoadMoreTrainingsBtn(remaining));
        }
      });
    },

    // ── 构建「查看更多训练」按钮 ──────────────────────────────────────────

    _buildLoadMoreTrainingsBtn: function (remaining) {
      var self = this;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cx-search-more cx-search-more--btn';
      btn.textContent = '查看更多训练（还有 ' + remaining + ' 个）';
      btn.addEventListener('click', function () {
        self._appendMoreTrainings(btn);
      });
      return btn;
    },

    _buildUI: function () {
      // 注入 CSS
      var style = document.createElement('style');
      style.textContent = [
        '#cx-search-modal{display:none;position:fixed;inset:0;z-index:2000;flex-direction:column;align-items:stretch;justify-content:flex-start}',
        '#cx-search-modal.active{display:flex}',
        '.cx-search-overlay{position:fixed;inset:0;background:var(--overlay-strong,rgba(0,0,0,.45));z-index:0}',
        '.cx-search-panel{position:relative;z-index:1;background:var(--surface,#fff);display:flex;flex-direction:column;width:100%;border-radius:0 0 16px 16px;animation:cxSrSlide .22s ease;max-height:92vh}',
        '@keyframes cxSrSlide{from{transform:translateY(-100%)}to{transform:translateY(0)}}',
        '.cx-search-header{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--border,#e0e0e0)}',
        '#cx-search-input{flex:1;font:inherit;font-size:16px;background:var(--surface-alt,#f5f5f5);color:var(--text,inherit);border:1.5px solid var(--border,#ddd);border-radius:8px;padding:7px 11px;outline:none;-webkit-appearance:none}',
        '#cx-search-input:focus{border-color:var(--brand,#4a90d9)}',
        '.cx-search-close{background:none;border:none;font-size:20px;color:var(--text-muted,#999);cursor:pointer;padding:4px 8px;line-height:1;-webkit-tap-highlight-color:transparent}',
        '#cx-search-count{padding:5px 13px;font-size:12px;color:var(--text-muted,#999);min-height:22px}',
        '#cx-search-results{overflow-y:auto;flex:1;min-height:80px;padding-bottom:24px}',
        '.cx-search-group{padding:7px 13px 4px;font-size:11px;font-weight:700;color:var(--brand,#4a90d9);border-bottom:1px solid var(--border,#e0e0e0);background:var(--surface-alt,#f9f9f9);margin-top:2px;text-transform:uppercase;letter-spacing:.03em}',
        '.cx-search-group--current{color:var(--heading,#222);background:var(--interactive-soft-bg,#eef4ff)}',
        '.cx-search-item{padding:10px 13px;border-bottom:1px solid var(--border,#f0f0f0);cursor:pointer;-webkit-tap-highlight-color:transparent;transition:background .12s}',
        '.cx-search-item:active{background:var(--nav-hover,rgba(0,0,0,.05))}',
        '.cx-search-item-meta{font-size:11px;color:var(--text-muted,#999);margin-bottom:3px}',
        '.cx-search-item-title{font-size:14px;font-weight:600;color:var(--heading,inherit);margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.cx-search-item-snippet{font-size:13px;color:var(--text,#555);line-height:1.6}',
        '.cx-search-item-snippet mark{background:#fff176;color:inherit;border-radius:2px;padding:0 1px}',
        '.cx-search-more{padding:7px 13px;font-size:12px;color:var(--text-muted,#999);background:var(--surface-alt,#f9f9f9);border-bottom:1px solid var(--border,#f0f0f0);font-style:italic}',
        '.cx-search-more--btn{width:100%;text-align:center;cursor:pointer;border:none;color:var(--brand,#4a90d9);font-style:normal;font-weight:600;-webkit-tap-highlight-color:transparent}',
        '.cx-search-more--btn:active{background:var(--nav-hover,rgba(0,0,0,.05))}',
        // 跳转高亮关键词
        'mark.cx-search-hl{background:#fff176;color:inherit;border-radius:2px;padding:0 1px}',
      ].join('\n');
      document.head.appendChild(style);

      // 构建 DOM
      var modal = document.createElement('div');
      modal.id = 'cx-search-modal';
      modal.innerHTML =
        '<div class="cx-search-overlay"></div>' +
        '<div class="cx-search-panel">' +
          '<div class="cx-search-header">' +
            '<input id="cx-search-input" type="text" enterkeyhint="search" placeholder="搜索特会信息…" autocomplete="off" autocorrect="off" spellcheck="false">' +
            '<button class="cx-search-close" aria-label="关闭">✕</button>' +
          '</div>' +
          '<div id="cx-search-count"></div>' +
          '<div id="cx-search-results"></div>' +
        '</div>';
      document.body.appendChild(modal);

      this._modal    = modal;
      this._input    = modal.querySelector('#cx-search-input');
      this._resultsEl = modal.querySelector('#cx-search-results');
      this._countEl  = modal.querySelector('#cx-search-count');

      // 事件绑定
      var self = this;

      modal.querySelector('.cx-search-overlay').addEventListener('click', function () {
        self.close();
      });
      modal.querySelector('.cx-search-close').addEventListener('click', function () {
        self.close();
      });

      function _triggerSearch() {
        clearTimeout(self._debounceTimer);
        self._debounceTimer = setTimeout(function () {
          self._doSearch(self._input.value);
        }, 300);
      }

      // input: 标准输入事件
      this._input.addEventListener('input', _triggerSearch);

      // compositionend: 中文/日文 IME 确认输入后立即搜索，无需等 debounce
      this._input.addEventListener('compositionend', function () {
        clearTimeout(self._debounceTimer);
        self._doSearch(self._input.value);
      });

      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && self._modal && self._modal.classList.contains('active')) {
          self.close();
        }
      });
    },

    // ── 初始化入口 ───────────────────────────────────────────────────────

    init: function () {
      var self = this;

      // 处理跳转导航目标（从搜索结果页跳转后高亮段落）
      this.handleSearchTarget();

      // 绑定页内搜索按钮（#cx-search-btn）
      function bindBtn() {
        var btn = document.getElementById('cx-search-btn');
        if (btn) {
          btn.addEventListener('click', function (e) {
            e.preventDefault();
            self.open();
          });
        }
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindBtn);
      } else {
        bindBtn();
      }
    }
  };

  win.CXSearch = CXSearch;
  CXSearch.init();

}(window));
