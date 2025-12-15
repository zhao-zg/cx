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

    // 用于跳过 cancel 导致的 onerror
    var isSeekingInternal = false;

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

      // 标记正在跳转，防止 cancel 触发的 onerror 重置状态
      isSeekingInternal = true;
      safeCancel();
      stopProgressUpdate();

      utterance = new SpeechSynthesisUtterance(segmentText);
      utterance.lang = lang;
      utterance.rate = rate;

      utterance.onstart = function () {
        isSeekingInternal = false;
        // 在 onstart 中设置时间状态
        elapsedOffset = targetSeconds;
        startTime = Date.now();
        pauseStartedAt = 0;
        isPaused = false;
        
        updateButtonState(true);
        startProgressUpdate();
      };

      utterance.onend = function () {
        isSeekingInternal = false;
        resetState(false);
      };

      utterance.onerror = function (event) {
        var err = event && event.error;
        if (err === 'interrupted' || err === 'cancelled') {
          // 如果是跳转导致的 cancel，不重置状态
          if (isSeekingInternal) {
            return;
          }
          resetState(true);
          return;
        }
        isSeekingInternal = false;
        console.error('朗读错误:', event);
        resetState(false);
        speechTime.textContent = '错误';
      };

      // 立即更新进度条显示
      progressBar.value = String(p);
      speechTime.textContent = formatTime(targetSeconds) + ' / ' + formatTime(totalDuration);

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

    // Seek UI - 进度条拖动功能
    progressBar.addEventListener('mousedown', function() {
      isSeeking = true;
      stopProgressUpdate();
    });
    
    progressBar.addEventListener('touchstart', function() {
      isSeeking = true;
      stopProgressUpdate();
    });
    
    progressBar.addEventListener('input', function () {
      if (!totalDuration) {
        progressBar.value = '0';
        speechTime.textContent = '00:00 / 00:00';
        return;
      }
      // 拖动时实时更新时间显示
      var p = clamp(Number(progressBar.value) || 0, 0, 100);
      var target = (p / 100) * totalDuration;
      speechTime.textContent = formatTime(target) + ' / ' + formatTime(totalDuration);
    });
    
    // 使用 change 事件来处理拖动结束（比 mouseup 更可靠）
    progressBar.addEventListener('change', function () {
      var p = clamp(Number(progressBar.value) || 0, 0, 100);
      isSeeking = false;
      
      if (fullText) {
        startSpeakingFromPercent(p);
      }
    });
    
    // 在 document 上监听 mouseup/touchend，确保能捕获到
    document.addEventListener('mouseup', function() {
      if (isSeeking) {
        isSeeking = false;
      }
    });
    
    document.addEventListener('touchend', function() {
      if (isSeeking) {
        isSeeking = false;
      }
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
      
      // 保存当前的实际播放时间（秒数）
      var currentElapsed = currentElapsedSeconds();
      
      // 重新计算新倍速下的总时长
      var oldTotalDuration = totalDuration;
      totalDuration = estimateTotalSeconds(fullText, Number(rateSelect.value) || 1);
      
      // 根据实际播放时间计算新的百分比
      var newPercent = 0;
      if (oldTotalDuration > 0) {
        // 保持相同的文本位置，而不是相同的时间百分比
        newPercent = clamp((currentElapsed / oldTotalDuration) * 100, 0, 100);
      }
      
      // 更新进度条显示
      progressBar.value = String(newPercent);
      
      // 从新的百分比位置开始播放
      startSpeakingFromPercent(newPercent);
    });

    // Init UI
    resetState(true);
    
    // 页面卸载时停止朗读
    window.addEventListener('beforeunload', function() {
      safeCancel();
      resetState(false);
    });
    
    // 页面隐藏时暂停朗读（可选）
    document.addEventListener('visibilitychange', function() {
      if (document.hidden && utterance && !isPaused) {
        try {
          window.speechSynthesis.pause();
          isPaused = true;
          updateButtonState(false);
          pauseStartedAt = Date.now();
          stopProgressUpdate();
        } catch (e) {
          // ignore
        }
      }
    });
  }

  window.CXSpeech = window.CXSpeech || {};
  window.CXSpeech.init = init;
})();
