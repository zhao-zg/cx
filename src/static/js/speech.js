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
      var textChunks   = [];
      var currentChunk = 0;
      var isChunking   = false;

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
      var _wsKeepalive = null;
      function startWsKeepalive() {
        if (!useWebSpeech) return;
        stopWsKeepalive();
        _wsKeepalive = setInterval(function () {
          if (isPaused) return;
          try {
            if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
              window.speechSynthesis.pause();
              window.speechSynthesis.resume();
            }
          } catch (e) {}
        }, 10000);
      }
      function stopWsKeepalive() {
        if (_wsKeepalive) { clearInterval(_wsKeepalive); _wsKeepalive = null; }
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
      }

      function resetState(keepText) {
        stopProgressUpdate();
        stopWsKeepalive();
        isPaused = false; isPlaying = false;
        startTime = 0; pauseStartedAt = 0; elapsedOffset = 0; totalDuration = 0;
        textChunks = []; currentChunk = 0; isChunking = false;
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
          if (err === 'interrupted' || err === 'cancelled') { resetState(true); return; }
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
          nativeSpeak(segText, targetSecs);
        } else {
          isSeekingInternal = true;
          try { window.speechSynthesis.cancel(); } catch (e) {}
          isChunking = false; stopProgressUpdate(); stopWsKeepalive();

          var rate = Number(rateSelect.value) || 0.5;
          var gen  = speakGeneration;
          elapsedOffset = targetSecs; startTime = Date.now(); pauseStartedAt = 0; isPaused = false;

          if (segText.length > 200) {
            textChunks = splitIntoChunks(segText, 200); currentChunk = 0; isChunking = true;
            setTimeout(function () { if (gen !== speakGeneration) return; isSeekingInternal = false; wsPlayNextChunk(); }, 50);
          } else {
            setTimeout(function () {
              if (gen !== speakGeneration) return;
              var utt = new SpeechSynthesisUtterance(segText); utt.lang = lang; utt.rate = rate;
              applyPinnedVoice(utt);
              utt.onstart = function () {
                isSeekingInternal = false; elapsedOffset = targetSecs; startTime = Date.now();
                pauseStartedAt = 0; isPaused = false; updateButtonState(true); startProgressUpdate(); startWsKeepalive();
              };
              utt.onend = function () { if (gen === speakGeneration) resetState(false); };
              utt.onerror = function (event) {
                if (gen !== speakGeneration) return;
                var err = event && event.error;
                if ((err === 'interrupted' || err === 'cancelled') && isSeekingInternal) return;
                isSeekingInternal = false;
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
          if (document.visibilityState !== 'visible') return;
          if (isPaused) return;
          try {
            if (window.speechSynthesis.paused) {
              window.speechSynthesis.resume();
            } else if (!window.speechSynthesis.speaking && (isChunking || startTime > 0)) {
              // Browser silently stopped -- restart from estimated position
              if (totalDuration > 0) {
                var est = clamp((currentElapsedSeconds() / totalDuration) * 100, 0, 99);
                startSpeakingFromPercent(est);
              }
            }
          } catch (e) {}
        });
      }

      resetState(true);
    }

    startInit();
  }

  window.CXSpeech = window.CXSpeech || {};
  window.CXSpeech.init = init;
})();
