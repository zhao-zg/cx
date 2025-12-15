/* Shared font size controls for CX site
   Auto-initializes when DOM is ready
*/
(function() {
  'use strict';

  function initFontControls() {
    const fontSmaller = document.getElementById('fontSmaller');
    const fontReset = document.getElementById('fontReset');
    const fontLarger = document.getElementById('fontLarger');

    if (!fontSmaller || !fontReset || !fontLarger) {
      return; // 字体控件不存在(如诗歌页面)
    }

    const fontSizes = [14, 16, 18, 20, 22, 24, 26, 28];
    const defaultSizeIndex = 2; // 默认18px
    let currentSizeIndex = defaultSizeIndex;

    // 从localStorage恢复字体大小
    const savedSize = localStorage.getItem('globalFontSize');
    if (savedSize) {
      const savedIndex = fontSizes.indexOf(parseInt(savedSize));
      if (savedIndex !== -1) {
        currentSizeIndex = savedIndex;
        document.body.style.fontSize = savedSize + 'px';
      }
    }

    function updateFontSize() {
      const size = fontSizes[currentSizeIndex];
      document.body.style.fontSize = size + 'px';
      localStorage.setItem('globalFontSize', size);
      
      // 更新按钮状态
      fontSmaller.disabled = currentSizeIndex === 0;
      fontLarger.disabled = currentSizeIndex === fontSizes.length - 1;
    }

    fontSmaller.addEventListener('click', function() {
      if (currentSizeIndex > 0) {
        currentSizeIndex--;
        updateFontSize();
      }
    });

    fontReset.addEventListener('click', function() {
      currentSizeIndex = defaultSizeIndex;
      updateFontSize();
    });

    fontLarger.addEventListener('click', function() {
      if (currentSizeIndex < fontSizes.length - 1) {
        currentSizeIndex++;
        updateFontSize();
      }
    });

    // 初始化应用保存的字体大小
    updateFontSize();
  }

  // 在DOM加载完成后自动初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFontControls);
  } else {
    initFontControls();
  }
})();
