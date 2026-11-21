/* Shared font size controls for CX site
   Auto-initializes when DOM is ready
   Note: 主要逻辑已移至 theme-toggle.js，此文件仅用于连接底部控制栏按钮
*/
(function() {
  'use strict';

  function initFontControls() {
    const fontSmaller = document.getElementById('fontSmaller');
    const fontReset = document.getElementById('fontReset');
    const fontLarger = document.getElementById('fontLarger');

    if (!fontSmaller || !fontReset || !fontLarger) {
      return; // 字体控件不存在(如诗歌页面或主页)
    }

    // 使用 theme-toggle.js 提供的全局函数
    if (window.CXFontControl) {
      fontSmaller.addEventListener('click', window.CXFontControl.decrease);
      fontReset.addEventListener('click', window.CXFontControl.reset);
      fontLarger.addEventListener('click', window.CXFontControl.increase);
    } else {
      console.warn('CXFontControl not found, font controls may not work');
    }
  }

  // 在DOM加载完成后自动初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFontControls);
  } else {
    initFontControls();
  }
})();
