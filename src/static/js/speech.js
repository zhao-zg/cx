/* Shared speech controls for CX site
   Engines:
   - NativeTTS (Capacitor Foreground Service) -- Android APK, background-safe
   - Web Speech API                           -- browser / PWA fallback

   Exposes:
     window.CXSpeech.init({ getText: () => string, lang?: string })
     window.CXSpeech.cancel()
*/
(function () {
  'use strict';

  // -- Utilities ------------------------------------------------------------

  function byId(id) { return document.getElementById(id); }

  function safeText(text) {
    return (text || '')
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

  // -- Init -----------------------------------------------------------------

  function init(options) {
    var getText = options && typeof options.getText === 'function' ? options.getText : null;
    if (!getText) return;

    // 包装 getText：朗读前将非括号的 .scripture-ref[data-refs] span 整体替换为
    // 展开后的纯文本节点，使 getCleanText（会移除 .scripture-ref）也能读到完整书名；
    // 读完后把文本节点换回原始 span，不影响页面显示。
    var _origGetText = getText;
    getText = function () {
      var spans = Array.prototype.slice.call(document.querySelectorAll('.scripture-ref[data-refs]'));
      var tnMap = []; // 与 spans 一一对应；null 表示未替换
      spans.forEach(function (span) {
        // 纲目破折号经文（.outline-section 内且以破折号开头，如 —太五3：）→ 不展开，
        // 留给 getCleanText 的 .scripture-ref 过滤移除，不朗读
        // 括号形式（如 （太七21））→ 原样保留，safeText 会过滤掉，不读
        var txt = (span.textContent || '').trim();
        if (!span.parentNode ||
            (/^[—\-]/.test(txt) && typeof span.closest === 'function' && span.closest('.outline-section')) ||
            /^[（(]/.test(txt)) {
          tnMap.push(null); return;
        }
        var expanded = expandDataRefs(span.getAttribute('data-refs'));
        if (!expanded) { tnMap.push(null); return; }
        // 用纯文本节点替换 span，这样 getCleanText 的 .scripture-ref 移除逻辑
        // 找不到该节点，展开文本得以保留
        var tn = document.createTextNode(expanded);
        span.parentNode.replaceChild(tn, span);
        tnMap.push(tn);
      });
      // .scripture-block-static[data-refs]：将简称引用前缀替换为全书名，使朗读读出完整称谓
      // 格式为 "太五3\t经文正文…"，以第一个 \t 分割；替换为 "马太福音五章三节\t经文正文…"
      var staticBlocks = Array.prototype.slice.call(document.querySelectorAll('.scripture-block-static[data-refs]'));
      var sbMap = [];
      staticBlocks.forEach(function (block) {
        var refs = block.getAttribute('data-refs');
        var expanded = expandDataRefs(refs);
        if (!expanded) { sbMap.push(null); return; }
        var origHTML = block.innerHTML;
        // 克隆并移除 sup（注解编号1/2、串珠字母a/b），避免朗读时读出这些符号
        var clone = block.cloneNode(true);
        clone.querySelectorAll('sup').forEach(function(s) { s.remove(); });
        var cleanText = clone.textContent;
        var tabIdx = cleanText.indexOf('\t');
        var body = tabIdx !== -1 ? cleanText.slice(tabIdx + 1) : cleanText;
        block.textContent = expanded + '\t' + body;
        sbMap.push({ block: block, origHTML: origHTML });
      });

      var text = _origGetText();

      // 还原 scripture-block-static
      staticBlocks.forEach(function (block, idx) {
        var saved = sbMap[idx];
        if (saved) { block.innerHTML = saved.origHTML; }
      });
      // 还原：将文本节点换回原始 span
      spans.forEach(function (span, idx) {
        var tn = tnMap[idx];
        if (tn && tn.parentNode) { tn.parentNode.replaceChild(span, tn); }
      });
      return text;
    };

    var lang  = (options && options.lang)  || 'zh-CN';
    // 锁屏/通知栏：title = 篇章标题（大字），artist = 训练名（副标题小字）
    // document.title 只含 "第X篇 - 类型"，训练名从 base.html 里的 meta[name=training-title] 读取
    var _pageTitleRaw = document.title || '';
    var _trainingMeta = document.querySelector('meta[name="training-title"]');
    var title  = (options && options.title)  || _pageTitleRaw  || '晨兴 · 朗读';
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
      return window.Capacitor &&
             window.Capacitor.Plugins &&
             window.Capacitor.Plugins.NativeTTS &&
             typeof window.Capacitor.Plugins.NativeTTS.speak === 'function'
        ? window.Capacitor.Plugins.NativeTTS
        : null;
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
      var _pauseBarPct     = 0;  // NativeTTS: % position to resume from after pause
      var _wsResumePercent = 0;  // Web Speech: % position to resume from after pause
      var _nativePositionHandle = null;
      var textChunks   = [];
      var currentChunk = 0;

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
        loopBtn.title = isLooping ? '循环播放（已开启）' : '循环播放';
      }

      function onPlaybackNaturalEnd() {
        if (isLooping && fullText) {
          elapsedOffset = 0; startTime = 0;
          progressBar.value = '0';
          speechTime.textContent = '00:00 / ' + formatTime(totalDuration);
          setTimeout(function () { startSpeakingFromPercent(0); }, 300);
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
      }

      function startProgressUpdate() {
        if (progressInterval) return;
        progressInterval = setInterval(function () { if (!isSeeking) updateProgressUI(); }, 120);
      }

      function stopProgressUpdate() {
        if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
      }

      function resetState() {
        ++speakGeneration;
        stopProgressUpdate();
        if (useNativeTTS) nativeStopService();
        else { try { window.speechSynthesis.cancel(); } catch (e) {} }
        fullText = '';
        elapsedOffset = 0; startTime = 0; totalDuration = 0;
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

        if (typeof NativeTTS.addListener === 'function') {
          var handle = NativeTTS.addListener('ttsPosition', function (data) {
            if (gen !== speakGeneration || !data || data.posMs == null) return;
            elapsedOffset = data.posMs / 1000;
            if (data.totalMs > 0) totalDuration = data.totalMs / 1000;
            startTime = Date.now();
          });
          if (gen !== speakGeneration) { try { handle.remove(); } catch (e) {} }
          else { _nativePositionHandle = handle; }
        }

        NativeTTS.speak({ text: segmentText, lang: lang, rate: rate, title: title, artist: artist,
                          startSecs: targetSeconds || 0, totalSecs: totalDuration || 0 })
          .then(function (result) {
            if (gen !== speakGeneration) return;
            var status = result && result.status;
            if (status === 'cancelled' || status === 'stopped') return;
            onPlaybackNaturalEnd();
          })
          .catch(function () {
            if (gen !== speakGeneration) return;
            stopProgressUpdate();
            setState('idle');
            speechTime.textContent = '播放出错';
            speechTime.style.color = '#e53e3e';
            setTimeout(function () { speechTime.textContent = '00:00 / 00:00'; speechTime.style.color = ''; }, 3000);
          });

        elapsedOffset = targetSeconds || 0;
        startTime = Date.now();
        setState('playing');
        startProgressUpdate();
      }

      function nativeStopService() {
        if (_nativePositionHandle) {
          try { _nativePositionHandle.remove(); } catch (e) {}
          _nativePositionHandle = null;
        }
        var NativeTTS = getNativeTTS();
        if (NativeTTS) try { NativeTTS.stop(); } catch (e) {}
      }

      // ======================================================================
      // Web Speech API path
      // ======================================================================

      function splitIntoChunks(text, maxLen) {
        var result = []; var sentences = text.split(/([。！？；])/); var cur = '';
        for (var i = 0; i < sentences.length; i++) {
          var s = sentences[i];
          if (cur.length + s.length <= maxLen) { cur += s; }
          else { if (cur) result.push(cur); cur = s; }
        }
        if (cur) result.push(cur);
        return result;
      }

      function wsPlayNextChunk() {
        if (state !== 'playing') return;
        if (currentChunk >= textChunks.length) { onPlaybackNaturalEnd(); return; }
        var gen  = speakGeneration;
        var rate = Number(rateSelect.value) || 0.5;
        var utt  = new SpeechSynthesisUtterance(textChunks[currentChunk]);
        utt.lang = lang; utt.rate = rate;

        utt.onstart = function () {
          if (gen !== speakGeneration || state !== 'playing') return;
          startTime = Date.now();
          startProgressUpdate();
        };
        utt.onend = function () {
          if (gen !== speakGeneration || state !== 'playing') return;
          currentChunk++;
          wsPlayNextChunk();
        };
        utt.onerror = function (event) {
          if (gen !== speakGeneration) return;
          var err = event && event.error;
          if (err === 'interrupted' || err === 'cancelled') {
            if (state !== 'playing') return;
            setTimeout(function () {
              if (gen !== speakGeneration || state !== 'playing') return;
              wsPlayNextChunk();
            }, 150);
            return;
          }
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
        var segText    = safeText(fullText.slice(charIndex));
        if (!segText) return;

        progressBar.value = String(p);
        speechTime.textContent = formatTime(targetSecs) + ' / ' + formatTime(totalDuration);

        if (useNativeTTS) {
          // nativeSpeak does its own ++speakGeneration
          nativeSpeak(segText, targetSecs);
        } else {
          ++speakGeneration;
          var gen = speakGeneration;
          try { window.speechSynthesis.cancel(); } catch (e) {}
          stopProgressUpdate();
          textChunks   = splitIntoChunks(segText, 200);
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
              '息屏或切换 App 时，Android 电池优化可能中断朗读。<br>' +
              '建议在系统设置中将本 App 加入「不限制」名单，以保障连续播放。' +
            '</div>' +
            '<div class="cx-dialog-actions">' +
              '<button class="cx-dialog-cancel">稍后再说</button>' +
              '<button class="cx-dialog-confirm" style="color:var(--brand,#4f7ddb)">去设置</button>' +
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
          fullText = safeText(getText());
          if (!fullText) return;
          totalDuration = estimateTotalSeconds(fullText, Number(rateSelect.value) || 0.5);
          elapsedOffset = 0; progressBar.value = '0';
          speechTime.textContent = '00:00 / ' + formatTime(totalDuration);
          startSpeakingFromPercent(0);
          return;
        }

        // Resume from paused
        if (state === 'paused') {
          startSpeakingFromPercent(useNativeTTS ? _pauseBarPct : _wsResumePercent);
          return;
        }

        // Pause from playing
        var pct = totalDuration > 0
          ? clamp((currentElapsedSeconds() / totalDuration) * 100, 0, 100)
          : 0;
        stopProgressUpdate();
        elapsedOffset = currentElapsedSeconds(); startTime = 0;
        if (useNativeTTS) {
          _pauseBarPct = pct;
          nativeStopService();
          setState('paused');
        } else {
          _wsResumePercent = pct;
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
          startSpeakingFromPercent(newPct);
        } else if (state === 'paused') {
          _wsResumePercent = newPct;
        }
      });

      // -- Page unload --------------------------------------------------------
      window.addEventListener('beforeunload', function () {
        ++speakGeneration;
        if (useNativeTTS) nativeStopService();
        else { try { window.speechSynthesis.cancel(); } catch (e) {} }
      });

      // -- Loop button --------------------------------------------------------
      updateLoopButton();
      if (loopBtn) {
        loopBtn.addEventListener('click', function () {
          isLooping = !isLooping;
          localStorage.setItem('speechLoop', isLooping ? '1' : '0');
          updateLoopButton();
        });
      }

      // -- visibilitychange (Web Speech only) ---------------------------------
      if (useWebSpeech) {
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'hidden') {
            if (state === 'playing') { elapsedOffset = currentElapsedSeconds(); startTime = 0; }
            return;
          }
          if (state !== 'playing') return;
          try {
            if (window.speechSynthesis.paused) {
              startTime = Date.now();
              window.speechSynthesis.resume();
              startProgressUpdate();
            } else if (!window.speechSynthesis.speaking) {
              if (totalDuration > 0) {
                startTime = Date.now();
                var est = clamp((currentElapsedSeconds() / totalDuration) * 100, 0, 99);
                startSpeakingFromPercent(est);
              }
            }
          } catch (e) {}
        });
      }

      setState('idle');
      progressBar.value = '0';
      speechTime.textContent = '00:00 / 00:00';
      if (useWebSpeech) setupMediaSession();
    }

    startInit();
  }

  window.CXSpeech = window.CXSpeech || {};
  window.CXSpeech.init = init;
})();
