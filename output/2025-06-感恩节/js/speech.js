/* Shared speech controls for CX site (Web Speech API)
   Exposes: window.CXSpeech.init({ getText: () => string, lang?: string }) and window.CXSpeech.cancel()
*/
(function () {
  'use strict';

  function byId(id) {
    return document.getElementById(id);
  }

  function safeText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function formatTime(seconds) {
    var s = Math.max(0, Math.floor(seconds || 0));
    var mins = Math.floor(s / 60);
    var secs = s % 60;
    return String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
  }

  function estimateTotalSeconds(text, rate) {
    var r = Math.max(0.1, Number(rate) || 1);
    // Rough estimate: ~250 Chinese chars per minute at 1x
    var charsPerMinute = 250 * r;
    var minutes = (text || '').length / charsPerMinute;
    return Math.max(1, Math.ceil(minutes * 60));
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function init(options) {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
      return;
    }

    var getText = options && typeof options.getText === 'function' ? options.getText : null;
    if (!getText) return;

    var lang = (options && options.lang) || 'zh-CN';

    // 支持新的底部控制栏和旧的speech-controls组件
    var controlsDiv = byId('bottomControlBar') || byId('speechControls');
    var playPauseBtn = byId('playPauseBtn');
    var rateSelect = byId('rateSelect');
    var speechTime = byId('speechTime');
    var progressBar = byId('progressBar');

    if (!playPauseBtn || !rateSelect || !speechTime || !progressBar || !controlsDiv) {
      return;
    }

    var playIcon = playPauseBtn.querySelector('.play-icon');
    var pauseIcon = playPauseBtn.querySelector('.pause-icon');

    // State
    var fullText = '';
    var utterance = null;
    var isPaused = false;

    var totalDuration = 0;
    var elapsedOffset = 0;
    var startTime = 0;
    var pauseStartedAt = 0;

    var progressInterval = null;
    var isSeeking = false;

    function updateButtonState(isPlaying) {
      if (playIcon && pauseIcon) {
        playIcon.style.display = isPlaying ? 'none' : 'inline';
        pauseIcon.style.display = isPlaying ? 'inline' : 'none';
      }
      playPauseBtn.setAttribute('aria-label', isPlaying ? '暂停' : '播放');
    }

    function stopProgressUpdate() {
      if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
      }
    }

    function currentElapsedSeconds() {
      if (!totalDuration) return 0;
      if (!startTime) return clamp(elapsedOffset, 0, totalDuration);
      var elapsed = elapsedOffset + (Date.now() - startTime) / 1000;
      return clamp(elapsed, 0, totalDuration);
    }

    function updateProgressUI() {
      if (!totalDuration) {
        progressBar.value = 0;
        speechTime.textContent = '00:00 / 00:00';
        return;
      }
      var elapsed = currentElapsedSeconds();
      var percent = clamp((elapsed / totalDuration) * 100, 0, 100);
      progressBar.value = String(percent);
      speechTime.textContent = formatTime(elapsed) + ' / ' + formatTime(totalDuration);
    }

    function startProgressUpdate() {
      stopProgressUpdate();
      progressInterval = setInterval(function () {
        if (isSeeking) return;
        updateProgressUI();
      }, 120);
    }

    function resetState(keepText) {
      stopProgressUpdate();
      utterance = null;
      isPaused = false;
      startTime = 0;
      pauseStartedAt = 0;
      elapsedOffset = 0;
      totalDuration = 0;
      if (!keepText) fullText = '';
      updateButtonState(false);
      progressBar.value = '0';
      speechTime.textContent = '00:00 / 00:00';
    }

    function safeCancel() {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {
        // ignore
      }
    }

    function startSpeakingFromPercent(percent) {
      if (!fullText) return;

      var p = clamp(Number(percent) || 0, 0, 100);
      var rate = Number(rateSelect.value) || 1;

      // Use totalDuration for time mapping; slice text proportionally for approximate seek.
      var targetSeconds = totalDuration ? (p / 100) * totalDuration : 0;
      var charIndex = Math.floor(fullText.length * (p / 100));
      charIndex = clamp(charIndex, 0, Math.max(0, fullText.length - 1));

      var segmentText = safeText(fullText.slice(charIndex));
      if (!segmentText) return;

      safeCancel();
      stopProgressUpdate();

      utterance = new SpeechSynthesisUtterance(segmentText);
      utterance.lang = lang;
      utterance.rate = rate;

      // Reset timing
      elapsedOffset = targetSeconds;
      startTime = 0;
      pauseStartedAt = 0;

      utterance.onstart = function () {
        isPaused = false;
        updateButtonState(true);
        startTime = Date.now();
        startProgressUpdate();
      };

      utterance.onend = function () {
        resetState(false);
      };

      utterance.onerror = function (event) {
        var err = event && event.error;
        if (err === 'interrupted' || err === 'cancelled') {
          // Treat as normal cancel (page switch / rate change)
          resetState(true);
          return;
        }
        console.error('朗读错误:', event);
        resetState(false);
        speechTime.textContent = '错误';
      };

      window.speechSynthesis.speak(utterance);
    }

    // Expose cancel for page navigation
    window.CXSpeech = window.CXSpeech || {};
    window.CXSpeech.cancel = function () {
      safeCancel();
      resetState(false);
    };

    // Show controls on supported browsers
    controlsDiv.style.display = 'flex';

    // Seek UI - 修复进度条拖动功能
    progressBar.addEventListener('input', function (event) {
      isSeeking = true;
      if (!totalDuration) {
        speechTime.textContent = '00:00 / 00:00';
        return;
      }
      var p = clamp(Number(event.target.value) || 0, 0, 100);
      var target = (p / 100) * totalDuration;
      speechTime.textContent = formatTime(target) + ' / ' + formatTime(totalDuration);
    });

    progressBar.addEventListener('change', function (event) {
      isSeeking = false;
      if (!fullText) return;
      var p = clamp(Number(event.target.value) || 0, 0, 100);
      startSpeakingFromPercent(p);
    });
    
    // 添加触摸和鼠标事件支持
    progressBar.addEventListener('mousedown', function() {
      isSeeking = true;
    });
    
    progressBar.addEventListener('mouseup', function() {
      isSeeking = false;
    });
    
    progressBar.addEventListener('touchstart', function() {
      isSeeking = true;
    });
    
    progressBar.addEventListener('touchend', function() {
      isSeeking = false;
    });

    // Play / Pause
    playPauseBtn.addEventListener('click', function () {
      if (!utterance || !fullText) {
        fullText = safeText(getText());
        if (!fullText) return;

        totalDuration = estimateTotalSeconds(fullText, Number(rateSelect.value) || 1);
        elapsedOffset = 0;
        progressBar.value = '0';
        speechTime.textContent = '00:00 / ' + formatTime(totalDuration);

        startSpeakingFromPercent(0);
        return;
      }

      if (isPaused) {
        try {
          window.speechSynthesis.resume();
        } catch (e) {
          // ignore
        }
        isPaused = false;
        updateButtonState(true);
        if (pauseStartedAt) {
          startTime += (Date.now() - pauseStartedAt);
          pauseStartedAt = 0;
        }
        startProgressUpdate();
      } else {
        try {
          window.speechSynthesis.pause();
        } catch (e) {
          // ignore
        }
        isPaused = true;
        updateButtonState(false);
        pauseStartedAt = Date.now();
        stopProgressUpdate();
      }
    });

    // Rate change: restart from current progress
    rateSelect.addEventListener('change', function () {
      if (!fullText) return;
      // Recalculate total duration for display and mapping
      totalDuration = estimateTotalSeconds(fullText, Number(rateSelect.value) || 1);

      var currentPercent = Number(progressBar.value) || 0;
      currentPercent = clamp(currentPercent, 0, 100);

      startSpeakingFromPercent(currentPercent);
    });

    // Init UI
    resetState(true);
  }

  window.CXSpeech = window.CXSpeech || {};
  window.CXSpeech.init = init;
})();
