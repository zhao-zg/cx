/* Shared speech controls for CX site
   Engines:
   - NativeTTS (Capacitor Foreground Service) -- Android APK, background-safe
   - Web Speech API                           -- browser / PWA fallback

   Exposes:
     window.CXSpeech.init({ getElements: () => [{el}], lang?: string })
     window.CXSpeech.cancel()
*/
(function () {
  'use strict';

  // -- Utilities ------------------------------------------------------------

  function byId(id) { return document.getElementById(id); }

  // 统一文本处理管道：全局字符过滤 + 括号移除。
  // 所有文本（fullText、segmentMap、speakText）必须经过此函数，确保坐标系一致。
  function processText(raw) {
    return (raw || '')
      .replace(/\s+/g, ' ')
      .replace(/[\r\n\t]/g, '')
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9，。、；：？！\u201c\u201d\u2018\u2019（）《》\s]/g, '')
      .trim()
      .replace(/（[^）]*）/g, '')
      .replace(/\([^)]*\)/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // -- Bible reference expansion --------------------------------------------

  var _BN = {
    '创': '创世记', '出': '出埃及记', '利': '利未记', '民': '民数记',
    '申': '申命记', '书': '约书亚记', '士': '士师记', '得': '路得记',
    '撒上': '撒母耳记上', '撒下': '撒母耳记下',
    '王上': '列王纪上', '王下': '列王纪下',
    '代上': '历代志上', '代下': '历代志下',
    '拉': '以斯拉记', '尼': '尼希米记', '斯': '以斯帖记',
    '伯': '约伯记', '诗': '诗篇', '箴': '箴言', '传': '传道书',
    '歌': '雅歌', '赛': '以赛亚书', '耶': '耶利米书',
    '哀': '耶利米哀歌', '结': '以西结书', '但': '但以理书',
    '何': '何西阿书', '珥': '约珥书', '摩': '阿摩司书',
    '俄': '俄巴底亚书', '拿': '约拿书', '弥': '弥迦书',
    '鸿': '那鸿书', '哈': '哈巴谷书', '番': '西番雅书',
    '该': '哈该书', '亚': '撒迦利亚书', '玛': '玛拉基书',
    '太': '马太福音', '可': '马可福音', '路': '路加福音',
    '约': '约翰福音', '徒': '使徒行传', '罗': '罗马书',
    '林前': '哥林多前书', '林后': '哥林多后书',
    '加': '加拉太书', '弗': '以弗所书', '腓': '腓立比书',
    '西': '歌罗西书',
    '帖前': '帖撒罗尼迦前书', '帖后': '帖撒罗尼迦后书',
    '提前': '提摩太前书', '提后': '提摩太后书',
    '门': '腓利门书', '来': '希伯来书', '雅': '雅各书',
    '彼前': '彼得前书', '彼后': '彼得后书',
    '约壹': '约翰壹书', '约贰': '约翰贰书', '约叁': '约翰叁书',
    '犹': '犹大书', '启': '启示录', '多': '提多书'
  };

  // 诗篇用「篇」而非「章」
  var _PIAN = { '诗': 1 };

  function _numToCN(n) {
    n = parseInt(n, 10);
    if (isNaN(n) || n <= 0) return String(n);
    var d = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    if (n < 10) return d[n];
    if (n < 20) return '十' + (n > 10 ? d[n - 10] : '');
    if (n < 100) return d[Math.floor(n / 10)] + '十' + (n % 10 ? d[n % 10] : '');
    var h = Math.floor(n / 100), r = n % 100;
    if (r === 0) return d[h] + '百';
    if (r < 10) return d[h] + '百零' + d[r];
    return d[h] + '百' + _numToCN(r);
  }

  // 解析单条 data-ref 如 太7:22 或 林前3:13 或 约15:5下
  function _parseRef(ref) {
    ref = (ref || '').trim();
    var m = ref.match(/^([^\d:]{1,3})(\d+):(\d+)([上下]?)$/);
    if (!m) return null;
    return { book: m[1], chapter: parseInt(m[2], 10), verse: parseInt(m[3], 10), suffix: m[4] };
  }

  function _expandRef(p) {
    var full = _BN[p.book] || p.book;
    var chWord = _PIAN[p.book] ? '篇' : '章';
    // verse 为 0 表示整章引用，不读节数
    if (p.verse === 0) return full + _numToCN(p.chapter) + chWord;
    return full + _numToCN(p.chapter) + chWord + _numToCN(p.verse) + '节' + (p.suffix || '');
  }

  // 将逗号分隔的 data-refs 字符串展开为朗读文本
  // 同书同章连续节 → 用「至」压缩；其余逐条列出
  function expandDataRefs(refs) {
    if (!refs) return '';
    var parts = (refs + '').split(',').map(function (r) { return r.trim(); }).filter(Boolean);
    if (!parts.length) return '';
    var result = [], i = 0;
    while (i < parts.length) {
      var p = _parseRef(parts[i]);
      if (!p) { result.push(parts[i]); i++; continue; }
      // 整章引用（verse=0）不参与范围合并，直接单条输出
      if (p.verse === 0) { result.push(_expandRef(p)); i++; continue; }
      var j = i + 1;
      while (j < parts.length) {
        var q = _parseRef(parts[j]);
        if (!q || q.book !== p.book || q.chapter !== p.chapter) break;
        j++;
      }
      if (j === i + 1) {
        result.push(_expandRef(p));
      } else {
        var last = _parseRef(parts[j - 1]);
        result.push(_expandRef(p) + '至' + _numToCN(last.verse) + '节' + (last.suffix || ''));
      }
      i = j;
    }
    return result.join('，');
  }

  function formatTime(seconds) {
    var s = Math.max(0, Math.floor(seconds || 0));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  function estimateTotalSeconds(text, rate) {
    var r = Math.max(0.1, Number(rate) || 1);
    return Math.max(1, Math.ceil((text || '').length / (250 * r) * 60));
  }

  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

  // Module-level safe getter: tries both plugin names for compatibility.
  // Java @CapacitorPlugin(name="NativeTTS") → Capacitor.Plugins.NativeTTS
  // Older builds may expose as TTSPlugin; try both.
  function safeGetNativeTTS() {
    try {
      if (!window.Capacitor || !window.Capacitor.Plugins) return null;
      var p = window.Capacitor.Plugins;
      var tts = p.NativeTTS || p.TTSPlugin || null;
      return (tts && typeof tts.speak === 'function') ? tts : null;
    } catch (e) { return null; }
  }

  // -- Init -----------------------------------------------------------------

  function init(options) {
    var getElements = options && typeof options.getElements === 'function' ? options.getElements : null;
    if (!getElements) return;
    // 先停止上一个页面可能仍在运行的朗读（SPA 切换视图时 cancel 尚未被调用）
    if (window.CXSpeech && typeof window.CXSpeech.cancel === 'function') {
      try { window.CXSpeech.cancel(); } catch(e) {}
    }

    // TTS 句子级高亮复原数据（init 作用域，供 withExpanded 调用）
    var _sentenceMarkData = [];

    function restoreElement(injected) {
      // 先恢复被剥去括号内容的文本节点原始值
      if (injected._savedParenTN) {
        injected._savedParenTN.forEach(function(s) {
          try { if (s.tn.parentNode) s.tn.nodeValue = s.orig; } catch(e) {}
        });
      }
      var el = injected.el;
      if (!el) return;
      var marks = Array.prototype.slice.call(el.querySelectorAll('mark.cx-tts-sent'));
      marks.forEach(function(mark) {
        var parent = mark.parentNode;
        if (!parent) return;
        while (mark.firstChild) {
          parent.insertBefore(mark.firstChild, mark);
        }
        parent.removeChild(mark);
      });
      try { el.normalize(); } catch(e) {}
    }

    function clearSentenceMarks() {
      _sentenceMarkData.forEach(function(inj) { try { restoreElement(inj); } catch(e) {} });
      _sentenceMarkData = [];
    }

    // 将经文引用临时展开后执行回调，完成后还原 DOM。
    // buildAll 在 withExpanded 内运行，确保 fullText 和 segmentMap 都基于展开后的文本。
    function withExpanded(fn) {
      var spans = Array.prototype.slice.call(document.querySelectorAll('.scripture-ref[data-refs]'));
      var tnMap = [];
      var removedSpans = []; // 不应朗读的 span（纲目破折号/括号前缀），临时从 DOM 移除
      spans.forEach(function (span) {
        var txt = (span.textContent || '').trim();
        if (!span.parentNode ||
            (/^[\u2014\u2500\-]/.test(txt) && typeof span.closest === 'function' && (span.closest('.outline-section') || span.closest('.outline-item') || span.closest('[class*="section-level"]'))) ||
            /^[（(]/.test(txt)) {
          // 纲目/听抄中破折号/括号前缀的经文引用不应朗读，从 DOM 临时移除
          // 使 injectSentenceMarks 不会将其文本包裹进 <mark>，朗读时自然跳过
          if (span.parentNode) {
            removedSpans.push({ span: span, parent: span.parentNode, next: span.nextSibling });
            span.parentNode.removeChild(span);
          }
          tnMap.push(null); return;
        }
        var expanded = expandDataRefs(span.getAttribute('data-refs'));
        if (!expanded) { tnMap.push(null); return; }
        // 用临时 wrapper span 而非裸文本节点：injectSentenceMarks 会把内联元素整体移入 <mark>，
        // clearSentenceMarks 后 wrapper 仍是完整元素（parentNode 不为 null），可被正确移除。
        // 裸文本节点会被 injectSentenceMarks 切碎成新文本节点，导致 tn.parentNode 变为 null，
        // 还原时无法移除，展开的经文文本会残留在 DOM 中造成重复显示。
        var wrapper = document.createElement('span');
        wrapper.className = 'cx-tts-expand-tmp';
        wrapper.textContent = expanded;
        var parent = span.parentNode;
        var next = span.nextSibling;
        parent.replaceChild(wrapper, span);
        tnMap.push({tn: wrapper, span: span, parent: parent, next: next});
      });
      var staticBlocks = Array.prototype.slice.call(document.querySelectorAll('.scripture-block-static[data-refs]'));
      var sbMap = [];
      staticBlocks.forEach(function (block) {
        var refs = block.getAttribute('data-refs');
        var expanded = expandDataRefs(refs);
        if (!expanded) { sbMap.push(null); return; }
        var origHTML = block.innerHTML;
        var clone = block.cloneNode(true);
        clone.querySelectorAll('sup').forEach(function(s) { s.remove(); });
        var cleanText = clone.textContent;
        var tabIdx = cleanText.indexOf('\t');
        var body = tabIdx !== -1 ? cleanText.slice(tabIdx + 1) : cleanText;
        block.textContent = expanded + '\t' + body;
        sbMap.push({ block: block, origHTML: origHTML });
      });

      var result = fn();

      // 不调用 clearSentenceMarks()，保留 <mark> 在 DOM 中供朗读高亮使用。
      // wrapper span 被 injectSentenceMarks 整体移入某个 <mark>，
      // 用 replaceChild 将 wrapper 原位替换为原始 .scripture-ref span，marks 保持完整。

      var _insideStatic = function (node) {
        for (var k = 0; k < staticBlocks.length; k++) {
          if (staticBlocks[k].contains(node)) return true;
        }
        return false;
      };

      // staticBlocks 通过 innerHTML 整体还原（同时自动移除其内的 wrapper）
      staticBlocks.forEach(function (block, idx) {
        var saved = sbMap[idx]; if (saved) { block.innerHTML = saved.origHTML; }
      });
      spans.forEach(function (span, idx) {
        var item = tnMap[idx];
        if (!item) return;
        // wrapper 在某个 <mark> 内，replaceChild 原位还原为原始 span，mark 保留
        if (item.tn && item.tn.parentNode && !_insideStatic(item.tn.parentNode)) {
          try {
            item.tn.parentNode.replaceChild(item.span, item.tn);
          } catch (e) {
            if (item.tn.parentNode) item.tn.parentNode.removeChild(item.tn);
          }
        } else if (item.tn && item.tn.parentNode) {
          item.tn.parentNode.removeChild(item.tn);
        }
      });
      // 还原临时移除的 span（按移除逆序，保证嵌套关系正确）
      // injectSentenceMarks 后 item.parent 直接子节点均为 <mark>，
      // item.next 可能在某个 mark 内，需找到其直接子 mark 祖先再 insertBefore。
      function _findDirectChild(parent, node) {
        var n = node;
        while (n && n.parentNode && n.parentNode !== parent) { n = n.parentNode; }
        return (n && n.parentNode === parent) ? n : null;
      }
      for (var i = removedSpans.length - 1; i >= 0; i--) {
        var item = removedSpans[i];
        if (item.parent && !_insideStatic(item.parent)) {
          try {
            if (item.next) {
              var directRef = item.next.parentNode === item.parent
                ? item.next
                : _findDirectChild(item.parent, item.next);
              if (directRef) {
                item.parent.insertBefore(item.span, directRef);
              } else {
                item.parent.appendChild(item.span);
              }
            } else {
              item.parent.appendChild(item.span);
            }
          } catch (e) {
            try { item.parent.appendChild(item.span); } catch (e2) {}
          }
        }
      }
      return result;
    }

    var lang  = (options && options.lang)  || 'zh-CN';
    // 锁屏/通知栏：title = 篇章标题（大字），artist = 训练名（副标题小字）
    // document.title 只含 "第X篇 - 类型"，训练名从 base.html 里的 meta[name=training-title] 读取
    var _pageTitleRaw = document.title || '';
    var _trainingMeta = document.querySelector('meta[name="training-title"]');
    var title  = (options && options.title)  || _pageTitleRaw  || '晨读 · 朗读';
    var artist = (options && options.artist) ||
                 (_trainingMeta ? _trainingMeta.getAttribute('content') : '') || '';

    var controlsDiv   = byId('bottomControlBar') || byId('speechControls');
    var playPauseBtn  = byId('playPauseBtn');
    var loopBtn       = byId('loopBtn');
    var rateSelect    = byId('rateSelect');
    var speechTime    = byId('speechTime');
    var progressBar   = byId('progressBar');

    if (!playPauseBtn || !rateSelect || !speechTime || !progressBar || !controlsDiv) return;

    // -- Engine detection ---------------------------------------------------

    function getNativeTTS() {
      return safeGetNativeTTS();
    }

    function detectEngine() {
      var isNative = !!(window.Capacitor &&
                        typeof window.Capacitor.isNativePlatform === 'function' &&
                        window.Capacitor.isNativePlatform());
      var nativeTTS    = getNativeTTS();
      var hasWebSpeech = ('speechSynthesis' in window) && ('SpeechSynthesisUtterance' in window);
      return {
        isNative:     isNative,
        useNativeTTS: !!nativeTTS,
        useWebSpeech: !nativeTTS && hasWebSpeech,
        supported:    !!nativeTTS || hasWebSpeech
      };
    }

    function showUnsupported(message) {
      playPauseBtn.style.display = 'none';
      progressBar.style.display  = 'none';
      rateSelect.style.display   = 'none';
      speechTime.textContent     = message;
      speechTime.style.color     = '#999';
      speechTime.style.fontSize  = '11px';
      speechTime.style.textAlign = 'center';
      var ps = speechTime.parentElement;
      if (ps) { ps.style.justifyContent = 'center'; ps.style.alignItems = 'center'; }
    }

    controlsDiv.style.display = 'flex';

    var initAttempts = 0;

    function startInit() {
      var engine = detectEngine();
      // On native Android: wait up to 1.5 s for NativeTTS plugin to become available.
      if (engine.isNative && !engine.useNativeTTS && initAttempts < 10) {
        initAttempts++;
        setTimeout(startInit, 150);
        return;
      }
      if (!engine.supported) {
        showUnsupported(engine.isNative ? '朗读插件未就绪' : '朗读暂不可用');
        return;
      }

      var useNativeTTS = engine.useNativeTTS;
      var useWebSpeech = engine.useWebSpeech;

      var playIcon  = playPauseBtn.querySelector('.play-icon');
      var pauseIcon = playPauseBtn.querySelector('.pause-icon');

      var savedRate = localStorage.getItem('speechRate');
      if (savedRate) rateSelect.value = savedRate;

      // -- State machine: 'idle' | 'playing' | 'paused' -----------------------
      var state         = 'idle';
      var fullText      = '';
      var totalDuration = 0;
      var elapsedOffset = 0;   // seconds elapsed at moment startTime was captured
      var startTime     = 0;   // Date.now() when current playback segment started
      var progressInterval = null;
      var isSeeking     = false;
      var speakGeneration = 0;
      var isLooping     = localStorage.getItem('speechLoop') === '1';
      var _resumePercent = 0;   // % position to resume from after pause
      var _resumeNextSegPercent = -1; // % position of next segment boundary (NativeTTS, -1=unset)
      var _nativePositionHandle = null;
      var textChunks   = [];
      var currentChunk = 0;
      // -- TTS 句子级高亮追踪 -------------------------------------------------
      var _segmentMap       = [];   // [{el, start, end, speakText}] 元素级字符偏移
      // _sentenceMarkData 已在 init 作用域声明，此处不重复声明
      var _prevTTSEl        = null; // 当前高亮的 <mark> 元素
      var _ttsMarkOffset    = 0;    // _segmentMap 中对应 currentChunk=0 的句子索引
      var _stopOnNav        = null; // hashchange 监听函数，移除时置 null
      var _nativeCharsDone  = -1;   // ttsProgress 最近一次推送的 charsDone（-1=未收到）
      var _nativeCharsDoneTime = 0; // _nativeCharsDone 更新时的 Date.now()
      var _nativeProgressHandle = null; // ttsProgress 监听句柄
      var _lastPosMs        = -1;   // ttsPosition 最近一次接受的 posMs（-1=尚未接受）
      var _originalTotalDuration = 0; // 原始估算总时长（不受倍速覆盖，用于 charsPerSec 插值）
      // -- 预构建缓存 ----------------------------------------------------------
      // prebuildText() 在页面加载时预提取文本和 segmentMap，
      // 用户点播放时直接复用，跳过耗时的 buildAll()（DOM 遍历 + withExpanded）。
      var _prebuiltFullText    = null;  // 预提取的 fullText（null=未预构建）
      var _prebuiltSegmentMap  = null;  // 预提取的 _segmentMap

      // -- State machine helpers ----------------------------------------------

      function setState(s) {
        state = s;
        var playing = (s === 'playing');
        if (playIcon && pauseIcon) {
          playIcon.style.display  = playing ? 'none'   : 'inline';
          pauseIcon.style.display = playing ? 'inline' : 'none';
        }
        playPauseBtn.setAttribute('aria-label', playing ? '暂停' : '播放');
        updateMediaSessionState(playing);
      }

      function updateLoopButton() {
        if (!loopBtn) return;
        loopBtn.classList.toggle('active', isLooping);
        if (isLooping) {
          loopBtn.innerHTML = '🔂';
          loopBtn.title = '循环播放当前页面（已开启）';
          loopBtn.setAttribute('aria-label', '循环播放当前页面（已开启）');
        } else {
          loopBtn.innerHTML = '①';
          loopBtn.title = '只播放当前页面';
          loopBtn.setAttribute('aria-label', '只播放当前页面');
        }
      }

      // -- TTS 句子级高亮 --------------------------------------------------------

      // 将元素内容按句子（。！？；）拆分，注入 <mark class="cx-tts-sent"> span。
      // 返回 {marks:[], origChildren:[], el} 或 null（无内容时）。
      function injectSentenceMarks(el) {
        var origChildren = Array.prototype.slice.call(el.childNodes);
        if (!origChildren.length) return null;
        var marks = [];
        var frag  = document.createDocumentFragment();
        var cur   = document.createElement('mark');
        cur.className = 'cx-tts-sent';
        var hasContent = false;

        function flushCur() {
          if (!hasContent) return;
          frag.appendChild(cur);
          marks.push(cur);
          cur = document.createElement('mark');
          cur.className = 'cx-tts-sent';
          hasContent = false;
        }

        origChildren.forEach(function(node) {
          if (node.nodeType === 3) { // 文本节点：按句子终止符拆分
            var text = node.nodeValue;
            var re = /[。！？；]/g;
            var m, last = 0;
            while ((m = re.exec(text)) !== null) {
              cur.appendChild(document.createTextNode(text.slice(last, m.index + 1)));
              hasContent = true;
              last = m.index + 1;
              flushCur();
            }
            if (last < text.length) {
              cur.appendChild(document.createTextNode(text.slice(last)));
              hasContent = true;
            }
          } else {
            // 内联元素：整体移入当前句子 mark（移动节点，保留原有事件绑定）
            cur.appendChild(node);
            hasContent = true;
            if (/[。！？；]$/.test(node.textContent)) flushCur();
          }
        });
        flushCur(); // 冲刷末尾未终止的句子

        if (!marks.length) return null;

        // 用注入了 mark 的 frag 替换原始内容
        // 原始文本节点已被 while 清除（inline 元素已移入 cur，已不在 el 中）
        while (el.firstChild) el.removeChild(el.firstChild);
        el.appendChild(frag);
        return {marks: marks, origChildren: origChildren, el: el};
      }

      // restoreElement / clearSentenceMarks 已在 init 作用域定义，此处直接使用。

      // 单一遍历构建 fullText 和 _segmentMap（坐标同源）。
      // 在 withExpanded 内执行：经文引用已被替换为展开文本节点，
      // 文本提取无需再单独移除 .scripture-ref，fullText 与 segmentMap 位置严格对齐。
      function buildAll() {
        return withExpanded(function() {
          clearSentenceMarks();
          _segmentMap = [];
          fullText = '';
          if (!getElements) return;
          var segs = getElements();

          segs.forEach(function(seg) {
            var el = seg.el;

            // Step 1: 提取元素原始文本（withExpanded 内，引用已展开）
            var rawText;
            if (el.classList.contains('scripture-block-static')) {
              // 经文块：withExpanded 已修改 block.textContent（含 expanded + '\t' + body）
              var clone = el.cloneNode(true);
              clone.querySelectorAll('sup').forEach(function(s){ s.remove(); });
              rawText = clone.textContent;
            } else if (el.classList.contains('chapter-title') || el.classList.contains('scripture')) {
              // title / scripture：直接取 textContent
              rawText = el.textContent;
            } else {
              // 常规元素：移除 UI 控件和嵌入经文块
              // .scripture-ref 也需移除：withExpanded 已将可展开的替换为文本节点，
              // 剩余的是破折号前缀（纲目中不读的经文）或括号前缀的引用，不应朗读
              var clone = el.cloneNode(true);
              clone.querySelectorAll('button, .scripture-content, .verse-line, .scripture-ref').forEach(function(s){ s.remove(); });
              rawText = clone.textContent;
            }

            // Step 2: 统一管道过滤
            var filteredText = processText(rawText);
            if (!filteredText) return;

            // Step 3: 记录在 fullText 中的精确位置（智能分隔符：已有终止符则不重复追加）
            var separator = '';
            if (fullText) {
              var lastChar = fullText[fullText.length - 1];
              separator = /[。！？；]/.test(lastChar) ? '' : '。';
            }
            var start = fullText.length + separator.length;
            fullText += separator + filteredText;
            var end = fullText.length;

            // Step 4: 元素级高亮，不修改 DOM（processText 已过滤不读内容，坐标自然跳过）
            _segmentMap.push({el: el, start: start, end: end, speakText: filteredText});
          });
        });
      }

      /**
       * 预提取朗读文本 + segmentMap（不修改 DOM）。
       * 复制 buildAll() 的文本构建逻辑，但通过 cloneNode 在副本上操作，
       * 不注入 <mark>，不展开经文引用的真实 DOM，保证页面渲染不受影响。
       * 产出的 fullText 和 _segmentMap 与 buildAll() 完全一致（同一 processText 管道）。
       * 结果缓存到 _prebuiltFullText / _prebuiltSegmentMap，供播放时直接复用。
       */
      function prebuildText() {
        if (!getElements) return '';
        var segs = getElements();
        var result = '';
        var segMap = [];

        segs.forEach(function(seg) {
          var el = seg.el;
          var rawText;

          if (el.classList.contains('scripture-block-static')) {
            var clone = el.cloneNode(true);
            // 在副本中展开经文引用
            clone.querySelectorAll('.scripture-ref[data-refs]').forEach(function(ref) {
              var expanded = expandDataRefs(ref.getAttribute('data-refs'));
              if (expanded) ref.textContent = expanded;
            });
            clone.querySelectorAll('sup').forEach(function(s) { s.remove(); });
            rawText = clone.textContent;
          } else if (el.classList.contains('chapter-title') || el.classList.contains('scripture')) {
            rawText = el.textContent;
          } else {
            var clone = el.cloneNode(true);
            // 在副本中展开可读的经文引用
            clone.querySelectorAll('.scripture-ref[data-refs]').forEach(function(ref) {
              var txt = (ref.textContent || '').trim();
              // 与 withExpanded() 保持一致：
              // 破折号前缀仅在纲目/听抄容器内移除，括号前缀无条件移除
              if ((/^[\u2014\u2500\-]/.test(txt) && typeof ref.closest === 'function' &&
                   (ref.closest('.outline-section') || ref.closest('.outline-item') || ref.closest('[class*="section-level"]'))) ||
                  /^[\uff08(]/.test(txt)) {
                ref.parentNode.removeChild(ref);
                return;
              }
              var expanded = expandDataRefs(ref.getAttribute('data-refs'));
              if (expanded) ref.textContent = expanded;
            });
            clone.querySelectorAll('button, .scripture-content, .verse-line').forEach(function(s) { s.remove(); });
            rawText = clone.textContent;
          }

          var filteredText = processText(rawText);
          if (!filteredText) return;

          var separator = '';
          if (result) {
            var lastChar = result[result.length - 1];
            separator = /[\u3002\uff01\uff1f\uff1b]/.test(lastChar) ? '' : '\u3002';
          }
          var start = result.length + separator.length;
          result += separator + filteredText;
          var end = result.length;

          segMap.push({el: el, start: start, end: end, speakText: filteredText});
        });

        // 缓存结果，供播放时跳过 buildAll()
        _prebuiltFullText   = result;
        _prebuiltSegmentMap = segMap;
        return result;
      }

      function findSegmentIndex(charPos) {
        for (var i = 0; i < _segmentMap.length; i++) {
          if (charPos < _segmentMap[i].end) return i;
        }
        return Math.max(0, _segmentMap.length - 1);
      }

      function findSegmentAt(charPos) {
        var idx = findSegmentIndex(charPos);
        return _segmentMap[idx] ? _segmentMap[idx].el : null;
      }

      function setTTSHighlight(el) {
        if (_prevTTSEl === el) return;
        if (_prevTTSEl) _prevTTSEl.classList.remove('cx-tts-active');
        _prevTTSEl = el;
        if (el) {
          el.classList.add('cx-tts-active');
          try { el.scrollIntoView({behavior: 'smooth', block: 'nearest'}); } catch(e) {}
        }
      }

      function clearTTSHighlight() {
        if (_prevTTSEl) { _prevTTSEl.classList.remove('cx-tts-active'); _prevTTSEl = null; }
        clearSentenceMarks();
        _segmentMap = [];
      }

      function onPlaybackNaturalEnd() {
        if (isLooping && fullText) {
          // 立即递增 generation，使所有旧回调（ttsPosition listener、chunk onerror 等）失效
          ++speakGeneration;
          var loopGen = speakGeneration;
          // 先进入 idle，防止 visibilitychange 在延迟内误判为"playing 但未在说话"而重入
          setState('idle');
          elapsedOffset = 0; startTime = 0;
          progressBar.value = '0';
          speechTime.textContent = '00:00 / ' + formatTime(totalDuration);
          // 清除高亮，循环重新开始时从第一个元素重新标记
          clearTTSHighlight();
          setTimeout(function () {
            if (loopGen !== speakGeneration) return;  // 期间被手动取消/暂停则放弃
            startSpeakingFromPercent(0);
          }, 50);
        } else {
          resetState();
        }
      }

      // NativeTTS 位置监听句柄（每 500ms Java 推送一次实际位置）

      // -- Progress helpers ---------------------------------------------------

      function currentElapsedSeconds() {
        if (!totalDuration) return 0;
        if (!startTime) return clamp(elapsedOffset, 0, totalDuration);
        return clamp(elapsedOffset + (Date.now() - startTime) / 1000, 0, totalDuration);
      }

      function updateProgressUI() {
        if (!totalDuration) { progressBar.value = '0'; speechTime.textContent = '00:00 / 00:00'; return; }
        var elapsed = currentElapsedSeconds();
        progressBar.value = String(clamp((elapsed / totalDuration) * 100, 0, 100));
        speechTime.textContent = formatTime(elapsed) + ' / ' + formatTime(totalDuration);
        // NativeTTS：高亮主要由 ttsPosition 事件（每 50ms，携带 charsDone）直接驱动。
        // 此处作为备份：若 ttsPosition 未携带 done 字段，则从锚点插值补充。
        // Web Speech 的高亮由 wsPlayChunk 按句子边界更新，不在此处干预
        if (useNativeTTS && _segmentMap.length && fullText) {
          var charPos;
          if (_nativeCharsDone >= 0 && _nativeCharsDoneTime > 0 && totalDuration > 0) {
            // charsPerSec 必须用原始估算时长（_originalTotalDuration），而非被 ttsPosition 覆写的倍速时长。
            // totalDuration 在 ttsPosition 中被 data.totalMs 覆写为实际音频时长（2x 时为一半），
            // 导致 charsPerSec 偏小、插值追不上朗读；_originalTotalDuration 始终保持 rate=1x 基准。
            var baseDur = _originalTotalDuration > 0 ? _originalTotalDuration : totalDuration;
            var charsPerSec = fullText.length / baseDur;
            var dt = (Date.now() - _nativeCharsDoneTime) / 1000;
            charPos = clamp(_nativeCharsDone + dt * charsPerSec, 0, fullText.length);
          } else {
            var ratio = clamp(elapsed / totalDuration, 0, 1);
            charPos = Math.floor(ratio * fullText.length);
          }
          setTTSHighlight(findSegmentAt(charPos));
        }
      }

      function startProgressUpdate() {
        if (progressInterval) return;
        progressInterval = setInterval(function () { if (!isSeeking) updateProgressUI(); }, 80);
      }

      function stopProgressUpdate() {
        if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
      }

      function resetState() {
        ++speakGeneration;
        if (_stopOnNav) { window.removeEventListener('hashchange', _stopOnNav); _stopOnNav = null; }
        stopProgressUpdate();
        clearTTSHighlight();
        if (useNativeTTS) nativeStopService();
        else { try { window.speechSynthesis.cancel(); } catch (e) {} }
        fullText = '';
        elapsedOffset = 0; startTime = 0; totalDuration = 0; _originalTotalDuration = 0;
        _nativeCharsDone = -1; _nativeCharsDoneTime = 0; _lastPosMs = -1;
        _resumeNextSegPercent = -1;
        textChunks = []; currentChunk = 0;
        progressBar.value = '0';
        speechTime.textContent = '00:00 / 00:00';
        setState('idle');
      }

      // -- MediaSession (Web Speech only) ------------------------------------

      function setupMediaSession() {
        if (!('mediaSession' in navigator)) return;
        try {
          navigator.mediaSession.setActionHandler('play', function () {
            if (state !== 'playing') playPauseBtn.click();
          });
          navigator.mediaSession.setActionHandler('pause', function () {
            if (state === 'playing') playPauseBtn.click();
          });
          navigator.mediaSession.setActionHandler('stop', function () {
            if (window.CXSpeech && window.CXSpeech.cancel) window.CXSpeech.cancel();
          });
        } catch (e) {}
      }

      function updateMediaSessionState(playing) {
        if (!useWebSpeech || !('mediaSession' in navigator)) return;
        try {
          if (playing && !navigator.mediaSession.metadata) {
            navigator.mediaSession.metadata = new MediaMetadata({ title: document.title || '朗读' });
          }
          navigator.mediaSession.playbackState = playing ? 'playing' : (state === 'paused' ? 'paused' : 'none');
        } catch (e) {}
      }

      // ======================================================================
      // NativeTTS path
      // ======================================================================

      function nativeSpeak(segmentText, targetSeconds) {
        var NativeTTS = getNativeTTS();
        if (!NativeTTS) return;
        ++speakGeneration;
        var gen  = speakGeneration;
        var rate = Number(rateSelect.value) || 0.5;

        if (_nativePositionHandle) {
          try { _nativePositionHandle.remove(); } catch (e) {}
          _nativePositionHandle = null;
        }
        if (_nativeProgressHandle) {
          try { _nativeProgressHandle.remove(); } catch (e) {}
          _nativeProgressHandle = null;
        }
        _nativeCharsDone = -1;
        _nativeCharsDoneTime = 0;
        _lastPosMs = -1;

        if (typeof NativeTTS.addListener === 'function') {
          var handle = NativeTTS.addListener('ttsPosition', function (data) {
            if (gen !== speakGeneration || !data || data.posMs == null) return;
            // 循环播放时 MediaPlayer 回到起点导致 posMs 大幅倒退，视为循环重置
            if (_lastPosMs >= 0 && data.posMs < _lastPosMs) {
              if (isLooping && data.posMs < _lastPosMs * 0.5) {
                // 循环重置：清除追踪状态，让进度条和高亮从头开始
                _nativeCharsDone = -1;
                _nativeCharsDoneTime = 0;
                _lastPosMs = -1;
                setTTSHighlight(null);
              } else {
                return;  // chunk 切换时的瞬态回退，忽略
              }
            }
            _lastPosMs = data.posMs;
            elapsedOffset = data.posMs / 1000;
            if (data.totalMs > 0) totalDuration = data.totalMs / 1000;
            startTime = Date.now();
            // ttsPosition 每 50ms 推送，携带基于 MediaPlayer 实际位置的 charsDone，
            // 比 ttsProgress（仅 chunk 完成时触发）频率更高，实现逐句精准高亮
            if (data.done != null) {
              _nativeCharsDone = data.done;
              _nativeCharsDoneTime = Date.now();
              if (_segmentMap.length) {
                setTTSHighlight(findSegmentAt(data.done));
              }
            }
          });
          // 监听 Java 端 onProgress 推送的字符级精确进度，用于句子高亮定位
          // 注：ttsPosition 每 50ms 推送实时 charsDone（主驱动），
          // ttsProgress 仅在 chunk 完成时触发（备份锚点），两者互补
          var progressHandle = NativeTTS.addListener('ttsProgress', function (data) {
            if (gen !== speakGeneration || !data || data.done == null) return;
            // 单调递增保护：忽略倒退值（防止 chunk 切换时瞬态回跳）
            if (data.done < _nativeCharsDone) return;
            _nativeCharsDone = data.done;
            _nativeCharsDoneTime = Date.now();
            // 直接用精确字符位置更新高亮
            if (_segmentMap.length) {
              setTTSHighlight(findSegmentAt(data.done));
            }
          });
          if (gen !== speakGeneration) {
            try { handle.remove(); } catch (e) {}
            try { progressHandle.remove(); } catch (e) {}
          } else {
            _nativePositionHandle = handle;
            _nativeProgressHandle = progressHandle;
          }
        }

        NativeTTS.speak({ text: segmentText, lang: lang, rate: rate, title: title, artist: artist,
                          startSecs: targetSeconds || 0, totalSecs: totalDuration || 0,
                          loop: isLooping })
          .then(function (result) {
            if (gen !== speakGeneration) return;
            var status = result && result.status;
            if (status === 'cancelled' || status === 'stopped') return;
            // Java 已处理循环（loop=true 时永不触发 onFinished），到达此处说明非循环播放自然结束
            resetState();
          })
          .catch(function (err) {
            if (gen !== speakGeneration) return;
            stopProgressUpdate();
            setState('idle');
            var msg = (err && (err.message || err)) || '朗读失败';
            speechTime.textContent = msg;
            speechTime.style.color = '#e53e3e';
            setTimeout(function () { speechTime.textContent = '00:00 / 00:00'; speechTime.style.color = ''; }, 4000);
          });

        // startTime 保持 0：进度条在 Java 端真正开始播放（首个 ttsPosition 到达）前
        // 停留在起始位置，避免合成延迟期间进度条先走再跳回的问题。
        elapsedOffset = targetSeconds || 0;
        setState('playing');
        startProgressUpdate();
      }

      function nativeStopService() {
        if (_nativePositionHandle) {
          try { _nativePositionHandle.remove(); } catch (e) {}
          _nativePositionHandle = null;
        }
        if (_nativeProgressHandle) {
          try { _nativeProgressHandle.remove(); } catch (e) {}
          _nativeProgressHandle = null;
        }
        _nativeCharsDone = -1;
        _nativeCharsDoneTime = 0;
        var NativeTTS = getNativeTTS();
        if (NativeTTS) try { NativeTTS.stop(); } catch (e) {}
      }

      // ======================================================================
      // Web Speech API path
      // ======================================================================

      function splitBySentence(text) {
        // 每个句子终止符（。！？；）处切分，每句作为独立 utterance
        var result = [];
        var re = /[^。！？；]*[。！？；]/g;
        var m, last = 0;
        while ((m = re.exec(text)) !== null) {
          var s = m[0];
          if (s.trim()) result.push(s);
          last = re.lastIndex;
        }
        if (last < text.length) {
          var tail = text.slice(last).trim();
          if (tail) result.push(text.slice(last));
        }
        return result.length > 0 ? result : [text];
      }

      function wsPlayNextChunk() {
        if (state !== 'playing') return;
        // 跳过空白 chunk（segment 文本为空时产生）
        while (currentChunk < textChunks.length && !textChunks[currentChunk]) { currentChunk++; }
        if (currentChunk >= textChunks.length) { onPlaybackNaturalEnd(); return; }
        var gen  = speakGeneration;
        var rate = Number(rateSelect.value) || 0.5;
        var utt  = new SpeechSynthesisUtterance(textChunks[currentChunk]);
        utt.lang = lang; utt.rate = rate;
        // 防止同一 utterance 的 onend 和 onerror(interrupted) 都触发时双重推进
        var consumed = false;

        // 提前更新高亮：在 speak() 前同步更新，避免部分 Android 设备上 onstart 不触发导致高亮只移动一次
        elapsedOffset = currentElapsedSeconds();
        startTime = Date.now();
        startProgressUpdate();
        var markIdx = _ttsMarkOffset + currentChunk;
        setTTSHighlight(_segmentMap[markIdx] ? _segmentMap[markIdx].el : null);

        utt.onstart = function () {
          if (gen !== speakGeneration || state !== 'playing') return;
          // 重置时钟，保证进度条从本句实际开始时间起算
          elapsedOffset = currentElapsedSeconds();
          startTime = Date.now();
        };
        utt.onend = function () {
          if (consumed || gen !== speakGeneration || state !== 'playing') return;
          consumed = true;
          currentChunk++;
          wsPlayNextChunk();
        };
        utt.onerror = function (event) {
          if (gen !== speakGeneration) return;
          var err = event && event.error;
          if (err === 'interrupted' || err === 'cancelled') {
            if (consumed || state !== 'playing') return;
            consumed = true;
            currentChunk++; // per-sentence 模式下不重读同一句，直接推进
            setTimeout(function () {
              if (gen !== speakGeneration || state !== 'playing') return;
              wsPlayNextChunk();
            }, 80);
            return;
          }
          if (consumed) return;
          consumed = true;
          currentChunk++;
          if (currentChunk < textChunks.length) {
            setTimeout(function () { if (gen !== speakGeneration) return; wsPlayNextChunk(); }, 100);
          } else {
            stopProgressUpdate(); setState('idle');
          }
        };
        window.speechSynthesis.speak(utt);
      }

      // ======================================================================
      // Common: start speaking from a percentage position (seek, first play, resume)
      // ======================================================================

      function startSpeakingFromPercent(percent) {
        if (!fullText) return;
        var p          = clamp(Number(percent) || 0, 0, 100);
        var targetSecs = totalDuration ? (p / 100) * totalDuration : 0;
        var charIndex  = clamp(Math.floor(fullText.length * (p / 100)), 0, Math.max(0, fullText.length - 1));
        // NativeTTS: 始终传完整文本（fullText 已由 buildAll 经 processText 处理），
        // 由 Java 通过 startSecs/totalSecs 定位起始 chunk。
        var segText    = useNativeTTS ? fullText : fullText.slice(charIndex);
        if (!segText) return;

        progressBar.value = String(p);
        speechTime.textContent = formatTime(targetSecs) + ' / ' + formatTime(totalDuration);

        // 初始化高亮到当前起始句子
        _ttsMarkOffset = findSegmentIndex(charIndex);
        setTTSHighlight(_segmentMap[_ttsMarkOffset] ? _segmentMap[_ttsMarkOffset].el : null);

        if (useNativeTTS) {
          // nativeSpeak does its own ++speakGeneration
          nativeSpeak(segText, targetSecs);
        } else {
          ++speakGeneration;
          var gen = speakGeneration;
          try { window.speechSynthesis.cancel(); } catch (e) {}
          stopProgressUpdate();
          // 直接用 _segmentMap 各项的 speakText（buildAll 中已由 processText 处理），
          // 保证 textChunks[i] ↔ _segmentMap[_ttsMarkOffset+i] 严格对应
          if (_segmentMap.length > _ttsMarkOffset) {
            textChunks = _segmentMap.slice(_ttsMarkOffset).map(function(seg) {
              return seg.speakText;
            });
          } else {
            textChunks = splitBySentence(segText);
          }
          currentChunk = 0;
          elapsedOffset = targetSecs; startTime = Date.now();
          setState('playing');
          setTimeout(function () {
            if (gen !== speakGeneration) return;
            wsPlayNextChunk();
          }, 50);
        }
      }

      // -- safeCancel ---------------------------------------------------------
      window.CXSpeech = window.CXSpeech || {};
      window.CXSpeech.cancel = function () { resetState(); };

      // -- 电池优化说明弹框 ---------------------------------------------------
      // 在跳转系统设置前向用户解释原因，避免突兀跳转。
      // 使用 cx-dialog / cx-dialog-mask 样式（已在 style.css 中定义）。
      function _showBatteryOptDialog(onConfirm) {
        var mask = document.createElement('div');
        mask.className = 'cx-dialog-mask';
        mask.innerHTML =
          '<div class="cx-dialog">' +
            '<div class="cx-dialog-title">允许后台朗读</div>' +
            '<div class="cx-dialog-desc">' +
              '息屏或切换 App 时，电池优化可能中断朗读。<br>' +
              '点击"立即开启"后，系统将弹出确认框，选择"允许"即可保障息屏连续播放。<br>' +
              '<small style="color:var(--text-muted,#888)">（若系统弹框未出现，可在 App 详情页的电池选项中手动设置）</small>' +
            '</div>' +
            '<div class="cx-dialog-actions">' +
              '<button class="cx-dialog-cancel">稍后再说</button>' +
              '<button class="cx-dialog-confirm" style="color:var(--brand,#4f7ddb)">立即开启</button>' +
            '</div>' +
          '</div>';
        document.body.appendChild(mask);
        mask.querySelector('.cx-dialog-cancel').addEventListener('click', function () {
          document.body.removeChild(mask);
        });
        mask.querySelector('.cx-dialog-confirm').addEventListener('click', function () {
          document.body.removeChild(mask);
          onConfirm();
        });
        mask.addEventListener('click', function (e) {
          if (e.target === mask) document.body.removeChild(mask);
        });
      }

      // -- Seekbar events -----------------------------------------------------
      var _seekPending = false;
      function commitSeek() {
        if (!_seekPending) return;
        _seekPending = false; isSeeking = false;
        if (!fullText) { startProgressUpdate(); return; }
        var pct = clamp(Number(progressBar.value) || 0, 0, 100);
        // NativeTTS 正在播放时需先 stop，否则新 speak 指令会被忽略导致无声
        if (useNativeTTS && state === 'playing') {
          ++speakGeneration;   // 使旧 promise 失效，防止触发 onPlaybackNaturalEnd
          nativeStopService();
          setTimeout(function () { startSpeakingFromPercent(pct); }, 80);
        } else {
          startSpeakingFromPercent(pct);
        }
      }
      progressBar.addEventListener('touchstart', function () {
        isSeeking = true; _seekPending = true; stopProgressUpdate();
      }, { passive: true });
      progressBar.addEventListener('mousedown', function () {
        isSeeking = true; _seekPending = true; stopProgressUpdate();
      });
      progressBar.addEventListener('input', function () {
        if (!totalDuration) { progressBar.value = '0'; speechTime.textContent = '00:00 / 00:00'; return; }
        var p = clamp(Number(progressBar.value) || 0, 0, 100);
        speechTime.textContent = formatTime((p / 100) * totalDuration) + ' / ' + formatTime(totalDuration);
      });
      progressBar.addEventListener('touchend', function () { commitSeek(); });
      progressBar.addEventListener('mouseup',  function () { commitSeek(); });

      // -- Play / Pause button ------------------------------------------------
      playPauseBtn.addEventListener('click', function () {

        // First press: load text and start from beginning
        if (state === 'idle') {
          if (useNativeTTS) {
            var NativeTTS = getNativeTTS();
            if (NativeTTS && typeof NativeTTS.isBatteryOptimizationIgnored === 'function') {
              NativeTTS.isBatteryOptimizationIgnored().then(function (r) {
                if (!r.ignored && typeof NativeTTS.requestIgnoreBatteryOptimization === 'function') {
                  _showBatteryOptDialog(function () {
                    NativeTTS.requestIgnoreBatteryOptimization();
                  });
                }
              }).catch(function () {});
            }
          }
          // 优先使用预构建缓存（页面加载时 prebuildText() 已提取），
          // 跳过耗时的 buildAll()（DOM 遍历 + withExpanded），
          // 将首次播放延迟从 3-5s 压缩到 ~1s（仅剩 Java 服务启动 + 80ms）。
          if (_prebuiltFullText !== null && _prebuiltSegmentMap) {
            fullText = _prebuiltFullText;
            _segmentMap = _prebuiltSegmentMap;
          } else {
            buildAll();
          }
          if (!fullText) return;
          totalDuration = estimateTotalSeconds(fullText, Number(rateSelect.value) || 0.5);
          _originalTotalDuration = totalDuration; // 保存原始估算时长（rate=1x 基准），供 charsPerSec 插值使用
          elapsedOffset = 0; progressBar.value = '0';
          speechTime.textContent = '00:00 / ' + formatTime(totalDuration);
          _resumeNextSegPercent = -1;
          startSpeakingFromPercent(0);
          return;
        }

        // Resume from paused
        if (state === 'paused') {
          if (useNativeTTS) {
            // NativeTTS.resume() 从暂停位置继续 MediaPlayer，无需重新发送文本。
            var NativeTTS = getNativeTTS();
            if (NativeTTS) {
              try { NativeTTS.resume(); } catch (e) {}
            }
            // 重置时间锚点，让 ttsPosition 事件从当前暂停位置继续驱动进度
            startTime = Date.now();
            startProgressUpdate();
            setState('playing');
          } else {
            // Web Speech: stop+speak 方案（从 _resumePercent 位置重新开始）
            var resumePct = (_resumeNextSegPercent >= 0) ? _resumeNextSegPercent : _resumePercent;
            _resumeNextSegPercent = -1;
            startSpeakingFromPercent(resumePct);
          }
          return;
        }

        // Pause from playing
        var pct = totalDuration > 0
          ? clamp((currentElapsedSeconds() / totalDuration) * 100, 0, 100)
          : 0;
        stopProgressUpdate();
        elapsedOffset = currentElapsedSeconds(); startTime = 0;
        _resumePercent = pct;
        _resumeNextSegPercent = -1;
        if (useNativeTTS) {
          // NativeTTS.pause() 是 @PluginMethod，暂停 MediaPlayer 但不销毁状态。
          // 恢复时调用 resume() 可从暂停位置继续，无需重新发送文本。
          var NativeTTS = getNativeTTS();
          if (NativeTTS) {
            try { NativeTTS.pause(); } catch (e) {}
          }
          setState('paused');
        } else {
          ++speakGeneration;
          try { window.speechSynthesis.cancel(); } catch (e) {}
          setState('paused');
        }
      });

      // -- Rate change --------------------------------------------------------
      rateSelect.addEventListener('change', function () {
        localStorage.setItem('speechRate', rateSelect.value);
        if (!fullText) return;
        var newRate   = Number(rateSelect.value) || 0.5;
        var current   = currentElapsedSeconds();
        var oldTotal  = totalDuration;
        totalDuration = estimateTotalSeconds(fullText, newRate);
        var newPct    = oldTotal > 0 ? clamp((current / oldTotal) * 100, 0, 100) : 0;
        elapsedOffset = (newPct / 100) * totalDuration;
        startTime     = state === 'playing' ? Date.now() : 0;
        progressBar.value = String(newPct);

        if (useNativeTTS) {
          var NativeTTS = getNativeTTS();
          if (NativeTTS && typeof NativeTTS.setRate === 'function') {
            try { NativeTTS.setRate({ rate: newRate }); } catch (e) {}
          }
        } else if (state === 'playing') {
          // 不重置 chunk 状态，只取消当前句子的 utterance；
          // onerror(interrupted) 会把 currentChunk++ 并调用 wsPlayNextChunk，
          // 后者每次都从 rateSelect.value 读取倍速，自动使用新倍速继续朗读。
          try { window.speechSynthesis.cancel(); } catch (e) {}
        } else if (state === 'paused') {
          _resumePercent = newPct;
        }
      });

      // -- Page unload --------------------------------------------------------
      window.addEventListener('beforeunload', function () {
        ++speakGeneration;
        if (useNativeTTS) nativeStopService();
        else { try { window.speechSynthesis.cancel(); } catch (e) {} }
      });

      // -- Stop on SPA navigation (hashchange = 切换章节或返回目录) -------------------
      _stopOnNav = function() { resetState(); };
      window.addEventListener('hashchange', _stopOnNav);

      // -- Loop button --------------------------------------------------------
      updateLoopButton();
      if (loopBtn) {
        loopBtn.addEventListener('click', function () {
          isLooping = !isLooping;
          localStorage.setItem('speechLoop', isLooping ? '1' : '0');
          updateLoopButton();
          // NativeTTS 正在播放时需立即同步 loop 参数给 Java，否则下一轮仍用旧值循环
          if (useNativeTTS && state === 'playing' && fullText) {
            var pct = totalDuration > 0
              ? clamp((currentElapsedSeconds() / totalDuration) * 100, 0, 100) : 0;
            ++speakGeneration;
            nativeStopService();
            setTimeout(function () { startSpeakingFromPercent(pct); }, 80);
          }
        });
      }

      // -- visibilitychange (Web Speech only) ---------------------------------
      // Web Speech 不支持後台播放，切到后台时直接停止。
      // NativeTTS 已由前台服务支持后台，不干预。
      if (useWebSpeech) {
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'hidden' && state !== 'idle') {
            resetState();
          }
        });
      }

      setState('idle');
      progressBar.value = '0';
      speechTime.textContent = '00:00 / 00:00';
      if (useWebSpeech) setupMediaSession();

      // -- 预合成首 chunk（NativeTTS only） ----------------------------------
      // 页面加载后立即提取文本并发送给 Java 预合成第一个 chunk 的 WAV 文件。
      // 用户稍后点击播放时，handleSpeak() 发现预合成已完成，可跳过合成等待，
      // 将首次出声延迟从 ~500ms 压缩到 ~100ms。
      // prebuildText() 不修改 DOM，不影响页面渲染。
      if (useNativeTTS) {
        try {
          var prebuiltText = prebuildText();
          if (prebuiltText.length > 0) {
            var preNativeTTS = getNativeTTS();
            if (preNativeTTS && typeof preNativeTTS.preSynthesize === 'function') {
              preNativeTTS.preSynthesize({
                text: prebuiltText, lang: lang, rate: Number(rateSelect.value) || 0.5,
                title: title, artist: artist
              }).catch(function() {});
            }
          }
        } catch(e) {}
      }
    }

    startInit();
  }

  window.CXSpeech = window.CXSpeech || {};
  window.CXSpeech.init = init;
})();
