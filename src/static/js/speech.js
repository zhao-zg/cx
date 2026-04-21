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

    var lang = (options && options.lang) || 'zh-CN';

    var controlsDiv   = byId('bottomControlBar') || byId('speechControls');
    var playPauseBtn  = byId('playPauseBtn');
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

    var initAttempts    = 0;
    var maxInitAttempts = 40;

    function startInit() {
      var engine = detectEngine();
      // On native Android: wait specifically for NativeTTS.
      // Don't fall back to WebSpeech immediately -- Android WebView's WebSpeech
      // can switch between installed TTS engines between chunks, causing two voices.
      if (engine.isNative && !engine.useNativeTTS && initAttempts < maxInitAttempts) {
        initAttempts++;
        setTimeout(startInit, 150);
        return;
      }
      if (!engine.supported) {
        if (initAttempts < maxInitAttempts) { initAttempts++; setTimeout(startInit, 150); return; }
        showUnsupported(engine.isNative ? '朗读插件未就绪' : '朗读暂不可用');
        return;
      }

      var useNativeTTS = engine.useNativeTTS;
      var useWebSpeech = engine.useWebSpeech;

      console.log('TTS 引擎:', useNativeTTS ? 'NativeTTS (Foreground Service)' : 'Web Speech API');

      var playIcon  = playPauseBtn.querySelector('.play-icon');
      var pauseIcon = playPauseBtn.querySelector('.pause-icon');

      var savedRate = localStorage.getItem('speechRate');
      if (savedRate) rateSelect.value = savedRate;

      // -- State --------------------------------------------------------------
      var fullText      = '';
      var isPaused      = false;
      var isPlaying     = false;
      var totalDuration = 0;
      var elapsedOffset = 0;
      var startTime     = 0;
      var pauseStartedAt = 0;
      var progressInterval = null;
      var isSeeking     = false;
      var speakGeneration = 0;

      // Web Speech chunk state
      var textChunks      = [];
      var currentChunk    = 0;
      var isChunking      = false;
      var chunkStartChars = [];  // 每块在 segText 中的起始字符偏移（累积）
      var _segStartPct    = 0;   // 本次 startSpeakingFromPercent 的起始百分比
      var _segLen         = 0;   // 本次 segText.length（safeText 后）

      // -- WebSpeech voice pinning (prevents voice switching between chunks on Android) --
      var _pinnedVoice = null;
      function pinWebSpeechVoice() {
        if (_pinnedVoice || !useWebSpeech) return;
        var voices = [];
        try { voices = window.speechSynthesis.getVoices() || []; } catch (e) { return; }
        var sel = voices.filter(function (v) { return v.lang === lang; });
        if (!sel.length) sel = voices.filter(function (v) { return v.lang && v.lang.toLowerCase().indexOf('zh') === 0; });
        if (sel.length) _pinnedVoice = sel[0];
      }
      function applyPinnedVoice(utt) {
        pinWebSpeechVoice();
        if (_pinnedVoice) utt.voice = _pinnedVoice;
      }
      if (useWebSpeech) {
        try { window.speechSynthesis.onvoiceschanged = function () { _pinnedVoice = null; pinWebSpeechVoice(); }; } catch (e) {}
        pinWebSpeechVoice();
      }

      // -- WS keepalive -------------------------------------------------------
      // 不用 pause()+resume()：该方式在部分 Chrome/WebView 上会对当前 utterance
      // 触发 onerror(interrupted)，导致播放意外停止。
      // 改为：每 3s 检查一次，若应播放但已静音 >2s 则从当前位置重启。
      var _wsKeepalive = null;
      var _wsSpeakingAt = 0;  // 最后确认有声音的时间戳，用于检测意外静音
      function startWsKeepalive() {
        if (!useWebSpeech) return;
        stopWsKeepalive();
        _wsSpeakingAt = Date.now();
        _wsKeepalive = setInterval(function () {
          if (isPaused || document.hidden) return;
          try {
            if (window.speechSynthesis.speaking) {
              // 浏览器报告仍在播放，更新时间戳
              _wsSpeakingAt = Date.now();
            } else if ((isChunking || startTime > 0) && !isPaused &&
                       (Date.now() - _wsSpeakingAt) > 1500 && totalDuration > 0) {
              // 应该在播放但已静音超过 1.5s → 从当前位置重启
              var est = clamp((currentElapsedSeconds() / totalDuration) * 100, 0, 99);
              startSpeakingFromPercent(est);
            }
          } catch (e) {}
        }, 1000);
      }
      function stopWsKeepalive() {
        if (_wsKeepalive) { clearInterval(_wsKeepalive); _wsKeepalive = null; }
      }

      // -- Silent AudioContext (Web Speech only) --------------------------------
      // 在 Play 时创建一个全静音的循环 AudioContext，让浏览器视当前页面为「正在播放音频」，
      // 从而减少后台 JS 定时器被节流的概率，改善后台朗读持续性。
      var _silentCtx = null;
      function ensureSilentAudio() {
        if (!useWebSpeech || _silentCtx) return;
        try {
          var AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          _silentCtx = new AC();
          if (_silentCtx.state === 'suspended') _silentCtx.resume();
          // 全零缓冲（真正静音），循环播放以保持 AudioContext 活跃
          var buf = _silentCtx.createBuffer(1, _silentCtx.sampleRate, _silentCtx.sampleRate);
          var src = _silentCtx.createBufferSource();
          src.buffer = buf; src.loop = true;
          src.connect(_silentCtx.destination);
          src.start();
        } catch (e) { _silentCtx = null; }
      }
      function stopSilentAudio() {
        try { if (_silentCtx) { _silentCtx.close(); } } catch (e) {}
        _silentCtx = null;
      }

      // -- MediaSession API (Web Speech only) -----------------------------------
      // 向操作系统注册为「媒体会话」，使锁屏/通知栏显示播放控件，并帮助浏览器
      // 将本页面识别为音频内容（有助于部分 Android 机型的后台续播）。
      function setupMediaSession() {
        if (!useWebSpeech || !('mediaSession' in navigator)) return;
        try {
          navigator.mediaSession.setActionHandler('play', function () {
            if (isPaused) { playPauseBtn.click(); }
            else if (!isPlaying && !isChunking) { playPauseBtn.click(); }
          });
          navigator.mediaSession.setActionHandler('pause', function () {
            if ((isPlaying || isChunking) && !isPaused) { playPauseBtn.click(); }
          });
          navigator.mediaSession.setActionHandler('stop', function () {
            if (window.CXSpeech && window.CXSpeech.cancel) window.CXSpeech.cancel();
          });
        } catch (e) {}
      }
      function updateMediaSession(playing) {
        if (!useWebSpeech || !('mediaSession' in navigator)) return;
        try {
          if (playing && !navigator.mediaSession.metadata) {
            navigator.mediaSession.metadata = new MediaMetadata({ title: document.title || '朗读' });
          }
          navigator.mediaSession.playbackState = playing ? 'playing' : (isPaused ? 'paused' : 'none');
        } catch (e) {}
      }

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
        stopProgressUpdate();
        progressInterval = setInterval(function () { if (!isSeeking) updateProgressUI(); }, 120);
      }

      function stopProgressUpdate() {
        if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
      }

      function updateButtonState(playing) {
        if (playIcon && pauseIcon) {
          playIcon.style.display  = playing ? 'none'   : 'inline';
          pauseIcon.style.display = playing ? 'inline' : 'none';
        }
        playPauseBtn.setAttribute('aria-label', playing ? '暂停' : '播放');
        updateMediaSession(playing);
      }

      function resetState(keepText) {
        stopProgressUpdate();
        stopWsKeepalive();
        stopSilentAudio();
        isPaused = false; isPlaying = false;
        startTime = 0; pauseStartedAt = 0; elapsedOffset = 0; totalDuration = 0;
        textChunks = []; currentChunk = 0; isChunking = false;
        chunkStartChars = []; _segStartPct = 0; _segLen = 0;
        if (!keepText) fullText = '';
        updateButtonState(false);
        progressBar.value = '0';
        speechTime.textContent = '00:00 / 00:00';
      }

      // ======================================================================
      // NativeTTS path -- pass entire text to Foreground Service; no JS chunking
      // ======================================================================

      function nativeSpeak(segmentText, targetSeconds) {
        var NativeTTS = getNativeTTS();
        if (!NativeTTS) return;
        ++speakGeneration;
        var gen  = speakGeneration;
        var rate = Number(rateSelect.value) || 0.5;

        NativeTTS.speak({ text: segmentText, lang: lang, rate: rate })
          .then(function (result) {
            if (gen !== speakGeneration) return;
            var status = result && result.status;
            if (status === 'cancelled' || status === 'stopped') return;
            resetState(false);
          })
          .catch(function () {
            if (gen !== speakGeneration) return;
            resetState(false);
            speechTime.textContent = '播放出错';
            speechTime.style.color = '#e53e3e';
            setTimeout(function () { speechTime.textContent = '00:00 / 00:00'; speechTime.style.color = ''; }, 3000);
          });

        isPlaying = true; isPaused = false;
        elapsedOffset = targetSeconds || 0;
        startTime = Date.now(); pauseStartedAt = 0;
        updateButtonState(true);
        startProgressUpdate();
      }

      function nativeStopService() {
        var NativeTTS = getNativeTTS();
        if (NativeTTS) try { NativeTTS.stop(); } catch (e) {}
      }

      // ======================================================================
      // Web Speech API path -- chunked to work around browser limits
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

      var isSeekingInternal = false;

      function wsPlayNextChunk() {
        if (!isChunking || currentChunk >= textChunks.length) { isChunking = false; resetState(false); return; }
        var gen  = speakGeneration;
        var rate = Number(rateSelect.value) || 0.5;
        var utt  = new SpeechSynthesisUtterance(textChunks[currentChunk]);
        utt.lang = lang; utt.rate = rate;
        applyPinnedVoice(utt);

        utt.onstart = function () {
          if (gen !== speakGeneration) return; /* 过期 utterance 不更新状态 */
          _wsSpeakingAt = Date.now();
          // 用实际字符位置重新校准进度，消除时间估算误差
          if (_segLen > 0 && chunkStartChars.length > currentChunk && totalDuration > 0) {
            var segFrac = chunkStartChars[currentChunk] / _segLen;
            var newPct  = _segStartPct + (100 - _segStartPct) * segFrac;
            elapsedOffset = (newPct / 100) * totalDuration;
            startTime = Date.now();
          }
          updateButtonState(true);
          if (!progressInterval) startProgressUpdate();
          startWsKeepalive();
        };
        utt.onend = function () {
          if (gen !== speakGeneration) return;
          currentChunk++; wsPlayNextChunk();
        };
        utt.onerror = function (event) {
          if (gen !== speakGeneration) return;
          var err = event && event.error;
          if ((err === 'interrupted' || err === 'cancelled') && isSeekingInternal) return;
          if (err === 'interrupted' || err === 'cancelled') {
            // Chrome/WebView 中断——只在本代有效时重试同一 chunk
            if (gen !== speakGeneration) return;
            setTimeout(wsPlayNextChunk, 150);
            return;
          }
          currentChunk++;
          if (currentChunk < textChunks.length) { setTimeout(wsPlayNextChunk, 100); }
          else {
            resetState(false); speechTime.textContent = '播放出错'; speechTime.style.color = '#e53e3e';
            setTimeout(function () { speechTime.textContent = '00:00 / 00:00'; speechTime.style.color = ''; }, 3000);
          }
        };
        window.speechSynthesis.speak(utt);
      }

      // ======================================================================
      // Common entry: start speaking from a percentage position
      // ======================================================================

      function startSpeakingFromPercent(percent) {
        if (!fullText) return;
        var p           = clamp(Number(percent) || 0, 0, 100);
        var targetSecs  = totalDuration ? (p / 100) * totalDuration : 0;
        var charIndex   = clamp(Math.floor(fullText.length * (p / 100)), 0, Math.max(0, fullText.length - 1));
        var segText     = safeText(fullText.slice(charIndex));
        if (!segText) return;

        ++speakGeneration;
        progressBar.value = String(p);
        speechTime.textContent = formatTime(targetSecs) + ' / ' + formatTime(totalDuration);

        if (useNativeTTS) {
          // 不发 ACTION_STOP：stopSelf() 会在 handleSpeak 启动后立即销毁 Service（无声 bug）。
          // handleSpeak 使用 speakGen++ + QUEUE_FLUSH 自行重置，无需额外 stop()。
          nativeSpeak(segText, targetSecs);
        } else {
          ensureSilentAudio();
          isSeekingInternal = true;
          try { window.speechSynthesis.cancel(); } catch (e) {}
          isChunking = false; stopProgressUpdate(); stopWsKeepalive();

          var rate = Number(rateSelect.value) || 0.5;
          var gen  = speakGeneration;
          elapsedOffset = targetSecs; startTime = Date.now(); pauseStartedAt = 0; isPaused = false;

          if (segText.length > 200) {
            textChunks = splitIntoChunks(segText, 200);
            // 预计算每块在 segText 中的起始字符偏移，供 onstart 重新校准进度
            _segStartPct = p; _segLen = segText.length;
            chunkStartChars = [];
            var _cum = 0;
            for (var _ki = 0; _ki < textChunks.length; _ki++) {
              chunkStartChars.push(_cum);
              _cum += textChunks[_ki].length;
            }
            currentChunk = 0; isChunking = true;
            setTimeout(function () { if (gen !== speakGeneration) return; isSeekingInternal = false; wsPlayNextChunk(); }, 50);
          } else {
            setTimeout(function () {
              if (gen !== speakGeneration) return;
              var utt = new SpeechSynthesisUtterance(segText); utt.lang = lang; utt.rate = rate;
              applyPinnedVoice(utt);
              utt.onstart = function () {
                isSeekingInternal = false; elapsedOffset = targetSecs; startTime = Date.now();
                _wsSpeakingAt = Date.now();
                pauseStartedAt = 0; isPaused = false; updateButtonState(true); startProgressUpdate(); startWsKeepalive();
              };
              utt.onend = function () { if (gen === speakGeneration) resetState(false); };
              utt.onerror = function (event) {
                if (gen !== speakGeneration) return;
                var err = event && event.error;
                if ((err === 'interrupted' || err === 'cancelled') && isSeekingInternal) return;
                isSeekingInternal = false;
                if (err === 'interrupted' || err === 'cancelled') {
                  // Chrome 中断 — 从当前进度重启
                  if (totalDuration > 0) {
                    var est = clamp((currentElapsedSeconds() / totalDuration) * 100, 0, 99);
                    startSpeakingFromPercent(est);
                  }
                  return;
                }
                var msg = err === 'network' ? '需要网络' : err === 'synthesis-unavailable' ? '语音不可用' :
                          err === 'synthesis-failed' ? '播放失败' : '错误';
                resetState(false); speechTime.textContent = msg; speechTime.style.color = '#e53e3e';
                setTimeout(function () { speechTime.textContent = '00:00 / 00:00'; speechTime.style.color = ''; }, 3000);
              };
              window.speechSynthesis.speak(utt);
            }, 50);
          }
        }
      }

      // -- safeCancel ---------------------------------------------------------
      function safeCancel() {
        if (useNativeTTS) { nativeStopService(); }
        else { stopWsKeepalive(); try { window.speechSynthesis.cancel(); } catch (e) {} }
        isChunking = false;
      }

      window.CXSpeech = window.CXSpeech || {};
      window.CXSpeech.cancel = function () { ++speakGeneration; safeCancel(); resetState(false); };

      // -- Seekbar events -----------------------------------------------------
      progressBar.addEventListener('mousedown',  function () { isSeeking = true; stopProgressUpdate(); });
      progressBar.addEventListener('touchstart', function () { isSeeking = true; stopProgressUpdate(); });
      progressBar.addEventListener('input', function () {
        if (!totalDuration) { progressBar.value = '0'; speechTime.textContent = '00:00 / 00:00'; return; }
        var p = clamp(Number(progressBar.value) || 0, 0, 100);
        speechTime.textContent = formatTime((p / 100) * totalDuration) + ' / ' + formatTime(totalDuration);
      });
      progressBar.addEventListener('change', function () {
        isSeeking = false;
        if (fullText) startSpeakingFromPercent(clamp(Number(progressBar.value) || 0, 0, 100));
      });
      document.addEventListener('mouseup',  function () { isSeeking = false; });
      document.addEventListener('touchend', function () { isSeeking = false; });

      // -- Play / Pause button ------------------------------------------------
      playPauseBtn.addEventListener('click', function () {

        // First press: load text and start
        if (!isPlaying && !isChunking && !isPaused) {
          fullText = safeText(getText());
          if (!fullText) return;
          totalDuration = estimateTotalSeconds(fullText, Number(rateSelect.value) || 0.5);
          elapsedOffset = 0; progressBar.value = '0';
          speechTime.textContent = '00:00 / ' + formatTime(totalDuration);
          startSpeakingFromPercent(0);
          return;
        }

        // Resume
        if (isPaused) {
          if (useNativeTTS) {
            var NativeTTS = getNativeTTS();
            if (NativeTTS) try { NativeTTS.resume(); } catch (e) {}
            isPaused = false; isPlaying = true;
            if (pauseStartedAt) { startTime += (Date.now() - pauseStartedAt); pauseStartedAt = 0; }
            updateButtonState(true); startProgressUpdate();
          } else {
            try { window.speechSynthesis.resume(); } catch (e) {}
            isPaused = false;
            if (pauseStartedAt) { startTime += (Date.now() - pauseStartedAt); pauseStartedAt = 0; }
            updateButtonState(true); startProgressUpdate();
          }
          return;
        }

        // Pause
        if (useNativeTTS) {
          var NativeTTS = getNativeTTS();
          if (NativeTTS) try { NativeTTS.pause(); } catch (e) {}
          isPaused = true; isPlaying = false; pauseStartedAt = Date.now();
          updateButtonState(false); stopProgressUpdate();
        } else {
          try { window.speechSynthesis.pause(); } catch (e) {}
          isPaused = true; pauseStartedAt = Date.now();
          updateButtonState(false); stopProgressUpdate(); stopWsKeepalive();
        }
      });

      // -- Rate change --------------------------------------------------------
      rateSelect.addEventListener('change', function () {
        localStorage.setItem('speechRate', rateSelect.value);
        if (!fullText) return;
        var current    = currentElapsedSeconds();
        var oldTotal   = totalDuration;
        totalDuration  = estimateTotalSeconds(fullText, Number(rateSelect.value) || 0.5);
        var newPercent = oldTotal > 0 ? clamp((current / oldTotal) * 100, 0, 100) : 0;
        progressBar.value = String(newPercent);
        startSpeakingFromPercent(newPercent);
      });

      // -- Page unload --------------------------------------------------------
      window.addEventListener('beforeunload', function () { safeCancel(); resetState(false); });

      // -- visibilitychange ---------------------------------------------------
      // NativeTTS: Foreground Service runs independently -- no JS recovery needed.
      // Web Speech: resume if browser paused speechSynthesis in the background.
      if (useWebSpeech) {
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'hidden') {
            // 页面隐藏：冻结时钟，避免将后台挂起时间错误计入已播放进度
            if ((isChunking || startTime > 0) && !isPaused) {
              elapsedOffset = currentElapsedSeconds();
              startTime = 0;
            }
            return;
          }
          // 页面重新可见
          if (isPaused) return;
          try {
            if (window.speechSynthesis.paused) {
              startTime = Date.now();
              window.speechSynthesis.resume();
              startProgressUpdate();
            } else if (!window.speechSynthesis.speaking && (isChunking || elapsedOffset > 0)) {
              // 浏览器已停止朗读 — 从保存位置重启
              if (totalDuration > 0) {
                startTime = Date.now();
                var est = clamp((currentElapsedSeconds() / totalDuration) * 100, 0, 99);
                startSpeakingFromPercent(est);
              }
            }
          } catch (e) {}
        });
      }

      resetState(true);
      if (useWebSpeech) setupMediaSession();
    }

    startInit();
  }

  window.CXSpeech = window.CXSpeech || {};
  window.CXSpeech.init = init;
})();
