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
    var getText = options && typeof options.getText === 'function' ? options.getText : null;
    if (!getText) {
      alert('[调试] CXSpeech.init: getText 函数未提供');
      return;
    }

    var lang = (options && options.lang) || 'zh-CN';

    // 支持新的底部控制栏和旧的speech-controls组件
    var controlsDiv = byId('bottomControlBar') || byId('speechControls');
    var playPauseBtn = byId('playPauseBtn');
    var rateSelect = byId('rateSelect');
    var speechTime = byId('speechTime');
    var progressBar = byId('progressBar');

    if (!playPauseBtn || !rateSelect || !speechTime || !progressBar || !controlsDiv) {
      var missing = [];
      if (!controlsDiv) missing.push('controlsDiv');
      if (!playPauseBtn) missing.push('playPauseBtn');
      if (!rateSelect) missing.push('rateSelect');
      if (!speechTime) missing.push('speechTime');
      if (!progressBar) missing.push('progressBar');
      alert('[调试] CXSpeech.init: 缺少元素\n' + missing.join(', '));
      return;
    }

    // 检查是否支持 Capacitor TTS（优先）或 Web Speech API
    var hasCapacitor = !!(window.Capacitor && window.Capacitor.Plugins);
    var useCapacitorTTS = hasCapacitor && window.Capacitor.Plugins.TextToSpeech;
    var hasWebSpeech = ('speechSynthesis' in window) && ('SpeechSynthesisUtterance' in window);
    
    // 优先使用 Capacitor TTS，如果不可用则使用 Web Speech API
    var useWebSpeech = !useCapacitorTTS && hasWebSpeech;
    var speechSupported = useCapacitorTTS || useWebSpeech;
    
    // 始终显示控制栏（包含字体控制）
    controlsDiv.style.display = 'flex';
    
    if (!speechSupported) {
      // 不支持朗读时，隐藏朗读控件，显示提示信息
      playPauseBtn.style.display = 'none';
      progressBar.style.display = 'none';
      rateSelect.style.display = 'none';
      
      // 将时间显示区域改为提示信息
      speechTime.textContent = '浏览器不支持朗读';
      speechTime.style.color = '#999';
      speechTime.style.fontSize = '11px';
      speechTime.style.textAlign = 'center';
      speechTime.style.padding = '0';
      speechTime.style.marginTop = '0';
      
      // 调整进度区域的布局，让提示居中
      var progressSection = speechTime.parentElement;
      if (progressSection) {
        progressSection.style.justifyContent = 'center';
        progressSection.style.alignItems = 'center';
      }
      
      return; // 不初始化朗读功能
    }
    
    console.log('TTS 引擎:', useCapacitorTTS ? 'Capacitor TTS' : 'Web Speech API');

    var playIcon = playPauseBtn.querySelector('.play-icon');
    var pauseIcon = playPauseBtn.querySelector('.pause-icon');

    // 从localStorage恢复语速设置
    var savedRate = localStorage.getItem('speechRate');
    if (savedRate) {
      rateSelect.value = savedRate;
    }

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
      
      // 重置分段播放状态
      textChunks = [];
      currentChunkIndex = 0;
      isPlayingChunks = false;
      
      updateButtonState(false);
      progressBar.value = '0';
      speechTime.textContent = '00:00 / 00:00';
    }

    function safeCancel() {
      if (useCapacitorTTS) {
        try {
          var TextToSpeech = window.Capacitor.Plugins.TextToSpeech;
          TextToSpeech.stop();
        } catch (e) {
          // ignore
        }
      } else {
        try {
          window.speechSynthesis.cancel();
        } catch (e) {
          // ignore
        }
      }
      // 停止分段播放
      isPlayingChunks = false;
    }
    
    // 将长文本分段（用于 Web Speech API）
    function splitTextIntoChunks(text, maxLength) {
      if (!text) return [];
      
      var chunks = [];
      var sentences = text.split(/([。！？；])/);
      var currentChunk = '';
      
      for (var i = 0; i < sentences.length; i++) {
        var sentence = sentences[i];
        if (currentChunk.length + sentence.length <= maxLength) {
          currentChunk += sentence;
        } else {
          if (currentChunk) chunks.push(currentChunk);
          currentChunk = sentence;
        }
      }
      
      if (currentChunk) chunks.push(currentChunk);
      
      return chunks;
    }
    
    // 播放下一个文本段（通用函数，支持 Capacitor TTS 和 Web Speech API）
    function playNextChunk() {
      if (!isPlayingChunks || currentChunkIndex >= textChunks.length) {
        // 所有段播放完成
        isPlayingChunks = false;
        resetState(false);
        return;
      }
      
      var chunkText = textChunks[currentChunkIndex];
      var rate = Number(rateSelect.value) || 0.5;
      
      if (useCapacitorTTS) {
        // Capacitor TTS 分段播放
        var TextToSpeech = window.Capacitor.Plugins.TextToSpeech;
        
        utterance = { capacitor: true, chunkIndex: currentChunkIndex };
        updateButtonState(true);
        if (!progressInterval) startProgressUpdate();
        
        TextToSpeech.speak({
          text: chunkText,
          lang: lang,
          rate: rate,
          pitch: 1.0,
          volume: 1.0,
          category: 'ambient'
        }).then(function() {
          currentChunkIndex++;
          // 继续播放下一段
          playNextChunk();
        }).catch(function(error) {
          // 尝试播放下一段
          currentChunkIndex++;
          if (currentChunkIndex < textChunks.length) {
            setTimeout(playNextChunk, 100);
          } else {
            resetState(false);
            speechTime.textContent = '播放出错';
            speechTime.style.color = '#e53e3e';
            setTimeout(function() {
              speechTime.textContent = '00:00 / 00:00';
              speechTime.style.color = '';
            }, 3000);
          }
        });
        
      } else {
        // Web Speech API 分段播放
        utterance = new SpeechSynthesisUtterance(chunkText);
        utterance.lang = lang;
        utterance.rate = rate;
        
        utterance.onstart = function() {
          updateButtonState(true);
          if (!progressInterval) startProgressUpdate();
        };
        
        utterance.onend = function() {
          currentChunkIndex++;
          // 继续播放下一段
          playNextChunk();
        };
        
        utterance.onerror = function(event) {
          var err = event && event.error;
          if (err === 'interrupted' || err === 'cancelled') {
            if (isSeekingInternal) return;
            resetState(true);
            return;
          }
          
          // 尝试播放下一段
          currentChunkIndex++;
          if (currentChunkIndex < textChunks.length) {
            setTimeout(playNextChunk, 100);
          } else {
            resetState(false);
            speechTime.textContent = '播放出错';
            speechTime.style.color = '#e53e3e';
            setTimeout(function() {
              speechTime.textContent = '00:00 / 00:00';
              speechTime.style.color = '';
            }, 3000);
          }
        };
        
        window.speechSynthesis.speak(utterance);
      }
    }

    // 用于跳过 cancel 导致的 onerror
    var isSeekingInternal = false;
    
    // Web Speech API 分段播放相关变量
    var textChunks = [];
    var currentChunkIndex = 0;
    var isPlayingChunks = false;

    function startSpeakingFromPercent(percent) {
      if (!fullText) return;

      var p = clamp(Number(percent) || 0, 0, 100);
      var rate = Number(rateSelect.value) || 0.5;

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

      // 立即更新进度条显示
      progressBar.value = String(p);
      speechTime.textContent = formatTime(targetSeconds) + ' / ' + formatTime(totalDuration);

      if (useCapacitorTTS) {
        // 使用 Capacitor TTS
        var TextToSpeech = window.Capacitor.Plugins.TextToSpeech;
        
        // 如果文本很长，使用分段播放
        if (segmentText.length > 1000) {
          textChunks = splitTextIntoChunks(segmentText, 500);
          currentChunkIndex = 0;
          isPlayingChunks = true;
          
          // 设置时间状态
          isSeekingInternal = false;
          elapsedOffset = targetSeconds;
          startTime = Date.now();
          pauseStartedAt = 0;
          isPaused = false;
          
          // 开始播放第一段
          playNextChunk();
          
        } else {
          // 短文本直接播放
          isSeekingInternal = false;
          elapsedOffset = targetSeconds;
          startTime = Date.now();
          pauseStartedAt = 0;
          isPaused = false;
          utterance = { capacitor: true }; // 标记为 Capacitor TTS
          
          updateButtonState(true);
          startProgressUpdate();
          
          TextToSpeech.speak({
            text: segmentText,
            lang: lang,
            rate: rate,
            pitch: 1.0,
            volume: 1.0,
            category: 'ambient'
          }).then(function() {
            isSeekingInternal = false;
            resetState(false);
          }).catch(function(error) {
            isSeekingInternal = false;
            
            // 重置状态
            stopProgressUpdate();
            utterance = null;
            isPaused = false;
            startTime = 0;
            pauseStartedAt = 0;
            elapsedOffset = 0;
            updateButtonState(false);
            progressBar.value = '0';
            
            // 显示错误信息
            var shortMsg = '播放失败';
            if (segmentText.length > 4000) {
              shortMsg = '文本太长';
            }
            speechTime.textContent = shortMsg;
            speechTime.style.color = '#ff0000';
            
            setTimeout(function() {
              speechTime.textContent = '00:00 / 00:00';
              speechTime.style.color = '';
            }, 5000);
          });
        }
        
      } else {
        // 使用 Web Speech API - 分段播放
        
        // 如果文本很长，使用分段播放
        if (segmentText.length > 500) {
          textChunks = splitTextIntoChunks(segmentText, 200);
          currentChunkIndex = 0;
          isPlayingChunks = true;
          
          // 设置时间状态
          isSeekingInternal = false;
          elapsedOffset = targetSeconds;
          startTime = Date.now();
          pauseStartedAt = 0;
          isPaused = false;
          
          // 开始播放第一段
          playNextChunk();
          
        } else {
          // 短文本直接播放
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
            
            // 提供更友好的错误提示
            var errorMsg = '错误';
            if (err === 'network') {
              errorMsg = '需要网络';
            } else if (err === 'synthesis-unavailable') {
              errorMsg = '语音不可用';
            } else if (err === 'synthesis-failed') {
              errorMsg = '播放失败';
            }
            
            resetState(false);
            speechTime.textContent = errorMsg;
            speechTime.style.color = '#e53e3e';
            setTimeout(function() {
              speechTime.textContent = '00:00 / 00:00';
              speechTime.style.color = '';
            }, 3000);
          };

          window.speechSynthesis.speak(utterance);
        }
      }
    }

    // Expose cancel for page navigation
    window.CXSpeech = window.CXSpeech || {};
    window.CXSpeech.cancel = function () {
      safeCancel();
      resetState(false);
    };

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

        totalDuration = estimateTotalSeconds(fullText, Number(rateSelect.value) || 0.5);
        elapsedOffset = 0;
        progressBar.value = '0';
        speechTime.textContent = '00:00 / ' + formatTime(totalDuration);

        startSpeakingFromPercent(0);
        return;
      }

      if (isPaused) {
        if (useCapacitorTTS) {
          // Capacitor TTS 不支持暂停/恢复，需要重新开始
          var currentPercent = progressBar.value;
          startSpeakingFromPercent(currentPercent);
        } else {
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
        }
      } else {
        if (useCapacitorTTS) {
          // Capacitor TTS 停止播放
          safeCancel();
          isPaused = true;
          updateButtonState(false);
          pauseStartedAt = Date.now();
          stopProgressUpdate();
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
      }
    });

    // Rate change: restart from current progress and save to localStorage
    rateSelect.addEventListener('change', function () {
      // 保存语速设置
      localStorage.setItem('speechRate', rateSelect.value);
      
      if (!fullText) return;
      
      // 保存当前的实际播放时间（秒数）
      var currentElapsed = currentElapsedSeconds();
      
      // 重新计算新倍速下的总时长
      var oldTotalDuration = totalDuration;
      totalDuration = estimateTotalSeconds(fullText, Number(rateSelect.value) || 0.5);
      
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
