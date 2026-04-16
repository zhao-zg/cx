/**
 * scripture-popup.js
 * ==================
 * 功能：
 *  1. .scripture-ref[data-refs] 点击 → 弹框显示经文
 *  2. 正文自动标注阿拉伯式经文引用
 *  3. 弹框内 {N} 注脚号 → 展开注解（fn-ref）
 *  4. 弹框内 [a] 串珠号 → 展开对应串珠经文列表（xref-ref）
 *  5. 导航栈（返回按钮）
 *  6. 三文件懒加载：bible-text.js / bible-notes.js / bible-xrefs.js
 *
 * 全局变量（懒加载赋值）：
 *   CX_SCRIPTURES_DATA   （bible-text.js 或 scriptures-data.js）
 *   CX_BIBLE_NOTES       （bible-notes.js）
 *   CX_BIBLE_XREFS       （bible-xrefs.js）
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

  /* ── 懒加载脚本 ── */
  function loadScript(src, onDone) {
    var el = document.createElement('script');
    el.src = src;
    el.onload = onDone;
    el.onerror = onDone; /* 加载失败也继续 */
    document.head.appendChild(el);
  }

  var _loadingText  = false, _cbText  = [];
  var _loadingNotes = false, _cbNotes = [];
  var _loadingXrefs = false, _cbXrefs = [];

  function ensureBibleText(cb) {
    /* 只有 CX_BIBLE_TEXT_READY（bible-text.js 已加载）才算就绪；
       scriptures-data.js 仅是补充，不代表全本圣经已加载。 */
    if (window.CX_BIBLE_TEXT_READY) { cb(); return; }
    _cbText.push(cb);
    if (_loadingText) return;
    _loadingText = true;
    loadScript(getRootPath() + 'js/bible-text.js', function () {
      var cbs = _cbText.slice(); _cbText = [];
      cbs.forEach(function (f) { f(); });
    });
  }

  function ensureBibleNotes(cb) {
    if (window.CX_BIBLE_NOTES_READY) { cb(); return; }
    _cbNotes.push(cb);
    if (_loadingNotes) return;
    _loadingNotes = true;
    loadScript(getRootPath() + 'js/bible-notes.js', function () {
      var cbs = _cbNotes.slice(); _cbNotes = [];
      cbs.forEach(function (f) { f(); });
    });
  }

  function ensureBibleXrefs(cb) {
    if (window.CX_BIBLE_XREFS_READY) { cb(); return; }
    _cbXrefs.push(cb);
    if (_loadingXrefs) return;
    _loadingXrefs = true;
    loadScript(getRootPath() + 'js/bible-xrefs.js', function () {
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

  /* ── makeScriptureStep: 生成一个可重复注册的 backStack 回调 ── */
  function makeScriptureStep() {
    function step() {
      if (navStack.length > 1) {
        /* 还有上层 → 回退一帧，重新注册等待下次回退 */
        navStack.pop();
        renderFrame(navStack[navStack.length - 1]);
        window.CX.backStack.push(step);
      } else {
        /* 最顶层 → 关闭弹框 */
        navStack = [];
        if (modal) {
          modal.overlay.classList.remove('scripture-popup-overlay--open');
          modal.overlay.setAttribute('aria-hidden', 'true');
        }
        document.body.style.overflow = '';
      }
    }
    return step;
  }

  function navPush(frame) {
    navStack.push(frame);
    renderFrame(frame);
  }

  function navBack() {
    if (navStack.length <= 1) { closeModal(); return; }
    navStack.pop();
    renderFrame(navStack[navStack.length - 1]);
  }

  /* ═══════════════════════════ 渲染经文帧 ═══════════════════════════ */
  /*
   * frame = { type:'verses', refs:'创1:1,创1:2', label:'...' }
   *       | { type:'footnote', verseKey:'创1:1', num:'1' }
   *       | { type:'xrefs', verseKey:'创1:1', letter:'a' }
   */
  function renderFrame(frame) {
    var m = getModal();
    m.body.scrollTop = 0;
    m.backBtn.style.display = navStack.length > 1 ? '' : 'none';

    if (frame.type === 'verses') {
      m.title.textContent = frame.label || (frame.refs || '').replace(/,/g, '、');
      m.body.innerHTML = '<div class="scripture-popup-loading">加载中…</div>';
      ensureBibleText(function () {
        m.body.innerHTML = renderVerseList(frame.refs);
      });
    } else if (frame.type === 'footnote') {
      m.title.textContent = frame.verseKey + ' 注' + frame.num;
      m.body.innerHTML = '<div class="scripture-popup-loading">加载中…</div>';
      ensureBibleNotes(function () {
        var noteMap = (window.CX_BIBLE_NOTES || {})[frame.verseKey] || {};
        var text = noteMap[frame.num] || '（未找到注解）';
        m.body.innerHTML = '<div class="scripture-popup-fn-body">' + renderNoteText(text) + '</div>';
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
          });
        } else {
          m.body.innerHTML = '<div class="scripture-popup-empty">（未找到串珠）</div>';
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
    /* 展开整章引用（:0 = 整章标记） */
    var refArr = refs.split(',').reduce(function (acc, ref) {
      ref = ref.trim();
      if (!ref) return acc;
      if (ref.slice(-2) === ':0') {
        var prefix = ref.slice(0, -1); /* e.g. "诗133:" */
        var chKeys = Object.keys(dict)
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
    return esc(text).replace(
      /([创出利民申书士得撒王代拉尼斯伯诗箴传歌赛耶哀结但何珥摩俄拿弥鸿哈番该亚玛太可路约徒罗林加弗腓西帖提门多彼犹启来][后前上下壹贰叁]?\d+:\d+[上下]?)/g,
      '<span class="verse-ref" data-refs="$1">$1</span>'
    );
  }

  /* 确保弹框已打开（fn-ref/xref-ref 可能在弹框外点击）*/
  function ensureOpen() {
    var m = getModal();
    if (!m.overlay.classList.contains('scripture-popup-overlay--open')) {
      navStack = [];
      m.overlay.classList.add('scripture-popup-overlay--open');
      m.overlay.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      window.CX.backStack.push(makeScriptureStep());
    }
  }

  /* ═══════════════════════════ 弹框开关 ═══════════════════════════ */
  function openModal(refs, labelText) {
    navStack = [];
    var frame = { type: 'verses', refs: refs, label: labelText || refs.replace(/,/g,'、') };
    navPush(frame);
    var m = getModal();
    m.overlay.classList.add('scripture-popup-overlay--open');
    m.overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    window.CX.backStack.push(makeScriptureStep());
  }

  function closeModal() {
    if (!modal) return;
    navStack = [];
    modal.overlay.classList.remove('scripture-popup-overlay--open');
    modal.overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    window.CX.backStack.pop(); // 消耗 backStack 中的 history 记录
  }

  /* ── ESC 关闭 ── */
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Escape' || e.keyCode === 27) && modal && modal.overlay.classList.contains('scripture-popup-overlay--open')) {
      closeModal();
    }
  });

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
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderScriptureBlocks);
  } else {
    renderScriptureBlocks();
  }

  /* ── 暴露给外部（可选）── */
  window.CXScripturePopup = { open: openModal, close: closeModal };
})();
