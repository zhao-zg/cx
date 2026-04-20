/**
 * scripture-popup.js
 * ==================
 * 功能：
 *  1. .scripture-ref[data-refs] 点击 → 弹框显示经文
 *  2. 正文自动标注阿拉伯式经文引用
 *  3. 弹框内 {N} 注脚号 → 展开注解（fn-ref）
 *  4. 弹框内 [a] 串珠号 → 展开对应串珠经文列表（xref-ref）
 *  5. 导航栈（返回按钮）
 *  6. 三文件懒加载：bible-text.json / bible-notes.json / bible-xrefs.json
 *
 * 全局变量（fetch 后手动赋值）：
 *   CX_SCRIPTURES_DATA   （bible-text.json）
 *   CX_BIBLE_NOTES       （bible-notes.json）
 *   CX_BIBLE_XREFS       （bible-xrefs.json）
 */
(function () {
  'use strict';

  /* ── 正则：阿拉伯式引用 ── */
  var INLINE_REF_RE = /([创出利民申书士得撒王代拉尼斯伯诗箴传歌赛耶哀结但何珥摩俄拿弥鸿哈番该亚玛太可路约徒罗林加弗腓西帖提门多彼犹启来][后前上下壹贰叁]?\d+:\d+[上下]?)/g;

  /* ── HTML 转义 ── */
  function esc(str) {
    return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ── 根路径 ── */
  function getRootPath() {
    return (window.CX && window.CX_ROOT) ? window.CX_ROOT : '../';
  }

  /* ── 懒加载 JSON ── */
  function loadJSON(url, onDone) {
    fetch(url)
      .then(function (r) { return r.json(); })
      .then(onDone)
      .catch(function () { onDone(null); }); /* 加载失败也继续 */
  }

  var _loadingText  = false, _cbText  = [];
  var _loadingNotes = false, _cbNotes = [];
  var _loadingXrefs = false, _cbXrefs = [];

  function ensureBibleText(cb) {
    if (window.CX_BIBLE_TEXT_READY) { cb(); return; }
    _cbText.push(cb);
    if (_loadingText) return;
    _loadingText = true;
    /* 并行加载全本圣经 + 训练补充经文，两者都完成后才标记 READY */
    var pending = 2;
    function onBoth() {
      if (--pending > 0) return;
      window.CX_BIBLE_TEXT_READY = 1;
      var cbs = _cbText.slice(); _cbText = [];
      cbs.forEach(function (f) { f(); });
    }
    loadJSON(getRootPath() + 'data/bible-text.json', function (data) {
      if (data) {
        window.CX_BIBLE_TEXT_DATA = data;  /* 保留全本圣经独立引用，供整章展开使用 */
        window.CX_SCRIPTURES_DATA = Object.assign(window.CX_SCRIPTURES_DATA || {}, data);
      }
      onBoth();
    });
    loadJSON('js/scriptures-data.json', function (data) {
      if (data) window.CX_SCRIPTURES_DATA = Object.assign(window.CX_SCRIPTURES_DATA || {}, data);
      onBoth();
    });
  }

  function ensureBibleNotes(cb) {
    if (window.CX_BIBLE_NOTES_READY) { cb(); return; }
    _cbNotes.push(cb);
    if (_loadingNotes) return;
    _loadingNotes = true;
    loadJSON(getRootPath() + 'data/bible-notes.json', function (data) {
      if (data) {
        window.CX_BIBLE_NOTES = data;
        window.CX_BIBLE_NOTES_READY = 1;
      }
      var cbs = _cbNotes.slice(); _cbNotes = [];
      cbs.forEach(function (f) { f(); });
    });
  }

  function ensureBibleXrefs(cb) {
    if (window.CX_BIBLE_XREFS_READY) { cb(); return; }
    _cbXrefs.push(cb);
    if (_loadingXrefs) return;
    _loadingXrefs = true;
    loadJSON(getRootPath() + 'data/bible-xrefs.json', function (data) {
      if (data) {
        window.CX_BIBLE_XREFS = data;
        window.CX_BIBLE_XREFS_READY = 1;
      }
      var cbs = _cbXrefs.slice(); _cbXrefs = [];
      cbs.forEach(function (f) { f(); });
    });
  }

  /* ═══════════════════════════ DOM 结构 ═══════════════════════════ */
  function createModal() {
    var overlay = document.createElement('div');
    overlay.id = 'scripture-popup-overlay';
    overlay.className = 'scripture-popup-overlay';
    overlay.setAttribute('aria-hidden', 'true');

    var box = document.createElement('div');
    box.className = 'scripture-popup';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    var header = document.createElement('div');
    header.className = 'scripture-popup-header';

    var backBtn = document.createElement('button');
    backBtn.className = 'scripture-popup-back';
    backBtn.setAttribute('aria-label', '返回');
    backBtn.innerHTML = '&#9664;';
    backBtn.style.display = 'none';
    backBtn.addEventListener('click', navBack);

    var title = document.createElement('span');
    title.className = 'scripture-popup-title';
    title.id = 'scripture-popup-title';

    var closeBtn = document.createElement('button');
    closeBtn.className = 'scripture-popup-close';
    closeBtn.setAttribute('aria-label', '关闭');
    closeBtn.innerHTML = '&#10005;';
    closeBtn.addEventListener('click', closeModal);

    header.appendChild(backBtn);
    header.appendChild(title);
    header.appendChild(closeBtn);

    var body = document.createElement('div');
    body.className = 'scripture-popup-body';
    body.id = 'scripture-popup-body';

    box.appendChild(header);
    box.appendChild(body);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    /* 点遮罩关闭 */
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeModal();
    });

    /* 防滚动穿透 */
    var tsY = 0;
    overlay.addEventListener('touchstart', function (e) { tsY = e.touches[0].clientY; }, { passive: true });
    overlay.addEventListener('touchmove', function (e) {
      if (body.contains(e.target)) {
        var scrollable = body.scrollHeight > body.clientHeight;
        if (!scrollable) { e.preventDefault(); return; }
        var down  = e.touches[0].clientY < tsY;
        var atTop = body.scrollTop <= 0;
        var atBot = body.scrollTop + body.clientHeight >= body.scrollHeight - 1;
        if ((atTop && !down) || (atBot && down)) e.preventDefault();
      } else {
        e.preventDefault();
      }
    }, { passive: false });

    return { overlay: overlay, title: title, body: body, backBtn: backBtn };
  }

  var modal = null;
  function getModal() {
    if (!modal) modal = createModal();
    return modal;
  }

  /* ═══════════════════════════ 导航栈 ═══════════════════════════ */
  var navStack = [];

  /* ── makeScriptureStep: 弹 1 层，每层 navPush 各自对应 1 条 backStack 记录 ── */
  function makeScriptureStep() {
    return function step() {
      if (navStack.length > 1) {
        /* 还有上层 → 回退一帧（本条 backStack 记录已消耗，不再 re-push）*/
        navStack.pop();
        renderFrame(navStack[navStack.length - 1]);
      } else {
        /* 最顶层 → 关闭弹框 */
        navStack = [];
        if (modal) {
          modal.overlay.classList.remove('scripture-popup-overlay--open');
          modal.overlay.setAttribute('aria-hidden', 'true');
        }
        if (window.innerWidth < 600) document.body.style.overflow = '';
      }
    };
  }

  /* navPush: 每层都向 backStack 注册 1 条关闭回调 */
  function navPush(frame) {
    /* 保存当前帧的滚动位置，供返回时恢复 */
    if (navStack.length > 0 && modal) {
      navStack[navStack.length - 1]._scrollTop = modal.body.scrollTop;
    }
    navStack.push(frame);
    renderFrame(frame);
    window.CX.backStack.push(makeScriptureStep());
  }

  /* navBack（← 按钮）: 弹 1 层 + 同步消耗对应的 backStack 记录 */
  function navBack() {
    if (navStack.length <= 1) { closeModal(); return; }
    navStack.pop();
    renderFrame(navStack[navStack.length - 1]);
    window.CX.backStack.pop(); // 跳过 fn 回调，仅消耗 history
  }

  /* ═══════════════════════════ 渲染经文帧 ═══════════════════════════ */
  /*
   * frame = { type:'verses', refs:'创1:1,创1:2', label:'...' }
   *       | { type:'footnote', verseKey:'创1:1', num:'1' }
   *       | { type:'xrefs', verseKey:'创1:1', letter:'a' }
   */
  function renderFrame(frame) {
    var m = getModal();
    m.backBtn.style.display = navStack.length > 1 ? '' : 'none';

    if (frame.type === 'verses') {
      m.title.textContent = frame.label || (frame.refs || '').replace(/,/g, '、');
      m.body.innerHTML = '<div class="scripture-popup-loading">加载中…</div>';
      ensureBibleText(function () {
        m.body.innerHTML = renderVerseList(frame.refs);
        m.body.scrollTop = frame._scrollTop || 0;
      });
    } else if (frame.type === 'footnote') {
      m.title.textContent = frame.verseKey + ' 注' + frame.num;
      m.body.innerHTML = '<div class="scripture-popup-loading">加载中…</div>';
      ensureBibleNotes(function () {
        var noteMap = (window.CX_BIBLE_NOTES || {})[frame.verseKey] || {};
        var text = noteMap[frame.num] || '（未找到注解）';
        m.body.innerHTML = '<div class="scripture-popup-fn-body">' + renderNoteText(text) + '</div>';
        m.body.scrollTop = frame._scrollTop || 0;
      });
    } else if (frame.type === 'xrefs') {
      m.title.textContent = frame.verseKey + ' 串' + frame.letter;
      m.body.innerHTML = '<div class="scripture-popup-loading">加载中…</div>';
      ensureBibleXrefs(function () {
        var xrefMap = (window.CX_BIBLE_XREFS || {})[frame.verseKey] || {};
        var refs = xrefMap[frame.letter] || '';
        if (refs) {
          ensureBibleText(function () {
            m.body.innerHTML = renderVerseList(refs);
            m.body.scrollTop = frame._scrollTop || 0;
          });
        } else {
          m.body.innerHTML = '<div class="scripture-popup-empty">（未找到串珠）</div>';
          m.body.scrollTop = 0;
        }
      });
    }
  }

  /* 剥除上/下后缀，得到完整节键（用于查找注解/串珠） */
  function baseKey(ref) {
    return ref.replace(/[上下]$/, '');
  }

  /* 渲染经文列表（支持 {N} → fn-ref, [a] → xref-ref） */
  function renderVerseList(refs) {
    var dict = window.CX_SCRIPTURES_DATA || {};
    /* 整章展开只从全本圣经 bible-text.json 里取节列表 */
    var bibleDict = window.CX_BIBLE_TEXT_DATA || dict;
    /* 展开整章引用（:0 = 整章标记） */
    var refArr = refs.split(',').reduce(function (acc, ref) {
      ref = ref.trim();
      if (!ref) return acc;
      if (ref.slice(-2) === ':0') {
        var prefix = ref.slice(0, -1); /* e.g. "诗133:" */
        var chKeys = Object.keys(bibleDict)
          .filter(function (k) { return k.indexOf(prefix) === 0 && k.slice(-2) !== ':0'; })
          .sort(function (a, b) { return parseInt(a.split(':')[1], 10) - parseInt(b.split(':')[1], 10); });
        return acc.concat(chKeys.length ? chKeys : [ref]);
      }
      acc.push(ref);
      return acc;
    }, []);
    if (!refArr.length) return '<div class="scripture-popup-empty">暂无经文</div>';
    return refArr.map(function (ref) {
      ref = ref.trim();
      if (!ref) return '';
      var bk = baseKey(ref);              /* 去掉上/下，用于查注解/串珠 */
      /* 优先用半节文本，若无则退到完整节文本 */
      var raw = dict[ref] || (bk !== ref ? dict[bk] : '');
      if (raw) {
        return '<div class="scripture-popup-verse" data-vkey="' + esc(bk) + '">'
          + '<span class="scripture-popup-ref">' + esc(ref) + '</span>'
          + '<span class="scripture-popup-text">' + renderVerseText(raw, bk) + '</span>'
          + '</div>';
      }
      return '<div class="scripture-popup-verse scripture-popup-verse--missing">'
        + '<span class="scripture-popup-ref">' + esc(ref) + '</span>'
        + '<span class="scripture-popup-text">（未收录）</span>'
        + '</div>';
    }).join('');
  }

  /* 把 {N} 转为注脚上标，[a] 转为串珠上标 */
  function renderVerseText(raw, verseKey) {
    var text = esc(raw);
    /* {N} → fn-ref */
    text = text.replace(/\{(\d+)\}/g, function (_, n) {
      return '<sup class="fn-ref" data-vkey="' + esc(verseKey) + '" data-fn="' + n + '">' + n + '</sup>';
    });
    /* [a] → xref-ref */
    text = text.replace(/\[([a-z]+)\]/g, function (_, lr) {
      return '<sup class="xref-ref" data-vkey="' + esc(verseKey) + '" data-xr="' + lr + '">' + lr + '</sup>';
    });
    return text;
  }

  /* 渲染注解文字（内嵌经文引用变为可点击） */
  function renderNoteText(text) {
    return esc(text)
      .replace(
        /([创出利民申书士得撒王代拉尼斯伯诗箴传歌赛耶哀结但何珥摩俄拿弥鸿哈番该亚玛太可路约徒罗林加弗腓西帖提门多彼犹启来][后前上下壹贰叁]?\d+:\d+[上下]?)/g,
        '<span class="verse-ref" data-refs="$1">$1</span>'
      )
      .replace(/\n/g, '<br>');
  }

  /* 确保弹框已打开（fn-ref/xref-ref 可能在弹框外点击）*/
  /* backStack push 由后续 navPush 完成，此处只负责打开 overlay */
  function ensureOpen() {
    var m = getModal();
    if (!m.overlay.classList.contains('scripture-popup-overlay--open')) {
      navStack = [];
      m.overlay.classList.add('scripture-popup-overlay--open');
      m.overlay.setAttribute('aria-hidden', 'false');
      if (window.innerWidth < 600) document.body.style.overflow = 'hidden';
    }
  }

  /* ═══════════════════════════ 弹框开关 ═══════════════════════════ */
  function openModal(refs, labelText) {
    var m = getModal();
    navStack = [];
    m.overlay.classList.add('scripture-popup-overlay--open');
    m.overlay.setAttribute('aria-hidden', 'false');
    if (window.innerWidth < 600) document.body.style.overflow = 'hidden';
    navPush({ type: 'verses', refs: refs, label: labelText || refs.replace(/,/g,'、') });
    /* navPush 内部已调用 backStack.push，无需再次 push */
  }

  function closeModal() {
    if (!modal) return;
    /* 有几层就弹几次，清空对应的 history 记录 */
    var n = navStack.length;
    navStack = [];
    modal.overlay.classList.remove('scripture-popup-overlay--open');
    modal.overlay.setAttribute('aria-hidden', 'true');
    if (window.innerWidth < 600) document.body.style.overflow = '';
    for (var i = 0; i < n; i++) window.CX.backStack.pop();
  }

  /* ── ESC 关闭 ── */
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Escape' || e.keyCode === 27) && modal && modal.overlay.classList.contains('scripture-popup-overlay--open')) {
      closeModal();
    }
  });

  /* ── 平板：点击扩展框外区域关闭 ── */
  document.addEventListener('click', function (e) {
    if (window.innerWidth < 600) return;
    if (!modal || !modal.overlay.classList.contains('scripture-popup-overlay--open')) return;
    /* 点击在弹框本体内 → 不关闭 */
    if (modal.overlay.contains(e.target)) return;
    /* 点击的是经文引用类元素 → 不关闭（由事件委托接管打开新帧） */
    var t = e.target;
    while (t && t !== document) {
      if (t.classList && (
        (t.classList.contains('scripture-ref') && t.dataset && t.dataset.refs) ||
        t.classList.contains('fn-ref') ||
        t.classList.contains('xref-ref')
      )) return;
      t = t.parentNode;
    }
    /* 平板不锁滚动，history.back() 会异步恢复滚动位置，提前保存并还原 */
    var savedScrollY = window.scrollY;
    closeModal();
    /* history.back() 是异步的，用 popstate 之后恢复最可靠 */
    window.addEventListener('popstate', function restoreScroll() {
      window.removeEventListener('popstate', restoreScroll);
      /* 再等一帧，确保浏览器滚动恢复已执行完毕 */
      requestAnimationFrame(function () {
        window.scrollTo(0, savedScrollY);
      });
    }, { once: true });
  }, true); /* capture 保证在事件委托之前执行 */

  /* ═══════════════════════════ 事件委托 ═══════════════════════════ */
  document.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t !== document) {
      /* .scripture-ref[data-refs] → 打开弹框 */
      if (t.classList && t.classList.contains('scripture-ref') && t.dataset && t.dataset.refs) {
        e.preventDefault(); e.stopPropagation();
        openModal(t.dataset.refs, t.textContent.replace(/^[—─\s]+/,'').trim());
        return;
      }
      /* fn-ref（注脚号）*/
      if (t.classList && t.classList.contains('fn-ref') && t.dataset) {
        e.preventDefault(); e.stopPropagation();
        ensureOpen();
        navPush({ type: 'footnote', verseKey: t.dataset.vkey, num: t.dataset.fn });
        return;
      }
      /* xref-ref（串珠号）*/
      if (t.classList && t.classList.contains('xref-ref') && t.dataset) {
        e.preventDefault(); e.stopPropagation();
        ensureOpen();
        navPush({ type: 'xrefs', verseKey: t.dataset.vkey, letter: t.dataset.xr });
        return;
      }
      /* verse-ref（注解内经文引用）*/
      if (t.classList && t.classList.contains('verse-ref') && t.dataset && t.dataset.refs) {
        e.preventDefault(); e.stopPropagation();
        navPush({ type: 'verses', refs: t.dataset.refs, label: t.textContent });
        return;
      }
      t = t.parentNode;
    }
  });

  /* ═══════════════════════════ 自动标注正文 ═══════════════════════════ */
  function annotateInlineRefs() {
    var paras = document.querySelectorAll('.content-text');
    paras.forEach(function (p) {
      if (p.querySelector('span')) return;
      var html = p.innerHTML;
      var newer = html.replace(INLINE_REF_RE, function (ref) {
        return '<span class="scripture-ref scripture-ref--inline" data-refs="' + esc(ref) + '">' + esc(ref) + '</span>';
      });
      if (newer !== html) p.innerHTML = newer;
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', annotateInlineRefs);
  } else {
    annotateInlineRefs();
  }

  /* ═══════════════════════════ 自动渲染 scripture-block ═══════════════════════════ */
  /* .scripture-block[data-refs] 行内经文块（晨兴喂养等），带注脚和串珠上标 */
  function renderScriptureBlocks() {
    var blocks = document.querySelectorAll('.scripture-block[data-refs]');
    if (!blocks.length) return;
    ensureBibleText(function () {
      blocks.forEach(function (block) {
        if (block.hasAttribute('data-rendered')) return;
        block.setAttribute('data-rendered', '1');
        var refs = (block.dataset.refs || '').trim();
        if (!refs) return;
        block.innerHTML = renderVerseList(refs);
      });
      // 经文块渲染完成后，通知 highlight.js 重新计算字符偏移并恢复划线
      if (window.CXHighlight && window.CXHighlight.redoHighlights) {
        window.CXHighlight.redoHighlights();
      }
      // 经文块撑开内容后，通知翻页布局重新计算容器高度（避免 overflow:hidden 截断最后段落）
      document.dispatchEvent(new CustomEvent('cx:scriptureBlocksRendered'));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderScriptureBlocks);
  } else {
    renderScriptureBlocks();
  }

  /* ═══════════════════════════ 静态经文块（锚文本对齐注入注解/串珠）═══════════════ */
  /* .scripture-block-static[data-refs]：保留文档原文，从 bible-text.json 找到
   * {N}/[a] 在 JSON 经文中的位置：
   *   - 标记前有文字 → 取末尾 8 字作 lookback，在文档原文中搜索，插在其后
   *   - 标记前无文字 → 取标记后 8 字作 lookahead，在文档原文中搜索，插在其前
   * 找不到对应文字 → 跳过（文档经文不全）。 */
  function renderScriptureStaticBlocks() {
    var blocks = document.querySelectorAll('.scripture-block-static[data-refs]');
    if (!blocks.length) return;
    ensureBibleText(function () {
      blocks.forEach(function (block) {
        if (block.hasAttribute('data-rendered')) return;
        block.setAttribute('data-rendered', '1');
        var refs = (block.dataset.refs || '').trim();
        if (!refs) return;
        var dict = window.CX_SCRIPTURES_DATA || {};
        var docText = block.textContent;
        var refArr = refs.split(',').map(function (r) { return r.trim(); }).filter(Boolean);

        /* 从所有 ref 的 JSON 文本里，按出现顺序收集注入点 */
        var injections = [];
        refArr.forEach(function (ref) {
          var bk = baseKey(ref);
          var raw = dict[ref] || (bk !== ref ? dict[bk] : '');
          if (!raw) return;
          var MRE = /\{(\d+)\}|\[([a-z]+)\]/g, lastEnd = 0, mm;
          while ((mm = MRE.exec(raw)) !== null) {
          /* 剥除 {N}/[a] 标记后再提取锚定文字，避免相邻标记干扰 */
          var STRIP_MARKS = /\{\d+\}|\[[a-z]+\]/g;
          var prefix = raw.slice(lastEnd, mm.index).replace(STRIP_MARKS, '');
          var lookback  = prefix.replace(/[\s\u3000\u00a0]/g, '').slice(-8);
          var suffix    = raw.slice(mm.index + mm[0].length).replace(STRIP_MARKS, '');
            var lookahead = suffix.replace(/[\s\u3000\u00a0]/g, '').slice(0, 8);
            var mhtml = mm[1]
              ? '<sup class="fn-ref" data-vkey="' + esc(bk) + '" data-fn="' + mm[1] + '">' + mm[1] + '</sup>'
              : '<sup class="xref-ref" data-vkey="' + esc(bk) + '" data-xr="' + mm[2] + '">' + mm[2] + '</sup>';
            injections.push({ lookback: lookback, lookahead: lookahead, html: mhtml });
            lastEnd = mm.index + mm[0].length;
          }
        });

        if (!injections.length) { block.innerHTML = esc(docText); return; }

        /* 依次在 docText 中定位每个注入点 */
        var parts = [];
        var searchFrom = 0;

        injections.forEach(function (inj) {
          var insertPos = -1;

          if (inj.lookback) {
            /* 优先用 lookback：在 lookback 文字之后插入 */
            var idx = docText.indexOf(inj.lookback, searchFrom);
            if (idx !== -1) {
              insertPos = idx + inj.lookback.length;
            } else if (inj.lookback.length > 3) {
              idx = docText.indexOf(inj.lookback.slice(-4), searchFrom);
              if (idx !== -1) insertPos = idx + inj.lookback.slice(-4).length;
            }
          }

          if (insertPos === -1 && inj.lookahead) {
            /* lookback 找不到（或为空）→ 用 lookahead：在 lookahead 文字之前插入 */
            /* 依次尝试 8‑字符、4‑字符、2‑字符，处理文档省略号截断的情形 */
            var laFull = inj.lookahead;
            var laTrys = [laFull, laFull.slice(0, 4), laFull.slice(0, 2)];
            for (var _li = 0; _li < laTrys.length; _li++) {
              if (!laTrys[_li]) continue;
              var idx2 = docText.indexOf(laTrys[_li], searchFrom);
              if (idx2 !== -1) { insertPos = idx2; break; }
            }
          }

          if (insertPos !== -1) {
            parts.push({ pos: insertPos, html: inj.html });
            searchFrom = insertPos;
          }
          /* 两者都找不到 → 文档经文不全，跳过 */
        });

        /* 按位置升序排列，拼接最终 HTML */
        parts.sort(function (a, b) { return a.pos - b.pos; });
        var out = '', lastPos = 0;
        parts.forEach(function (part) {
          out += esc(docText.slice(lastPos, part.pos)) + part.html;
          lastPos = part.pos;
        });
        out += esc(docText.slice(lastPos));
        block.innerHTML = out;
      });
      if (window.CXHighlight && window.CXHighlight.redoHighlights) {
        window.CXHighlight.redoHighlights();
      }
      document.dispatchEvent(new CustomEvent('cx:scriptureBlocksRendered'));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderScriptureStaticBlocks);
  } else {
    renderScriptureStaticBlocks();
  }

  /* ── 暴露给外部（可选）── */
  window.CXScripturePopup = { open: openModal, close: closeModal };

  /* ── 空闲预加载：页面加载后利用空闲时间提前解析三个大文件 ──
   * 文件已在 PWA/APK 缓存中，无网络开销；
   * 提前解析后用户首次点击经文时无需等待。
   * 按优先级依次加载：bible-text → bible-notes → bible-xrefs
   */
  function idleLoad(fn) {
    if (window.requestIdleCallback) {
      requestIdleCallback(fn, { timeout: 4000 });
    } else {
      setTimeout(fn, 3000);
    }
  }

  function schedulePreload() {
    idleLoad(function () {
      ensureBibleText(function () {
        idleLoad(function () {
          ensureBibleNotes(function () {
            idleLoad(function () {
              ensureBibleXrefs(function () {});
            });
          });
        });
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedulePreload);
  } else {
    schedulePreload();
  }
})();
