/**
 * 经文字典 — 动态查询并渲染经节内容
 *
 * 数据来源：window.CX_SCRIPTURES_DATA（build 时由 generator 内嵌到 js/scriptures-data.js）
 *
 * 用法：
 *   CXBibleDict.renderContainer(element)  // element 有 data-refs 属性
 *   toggleScripture() 中自动调用，无需手动触发
 */
(function () {
  'use strict';

  /**
   * 获取经文字典（同步，scriptures-data.js 已在本脚本前加载）。
   * @returns {Object}
   */
  function getDict() {
    return window.CX_SCRIPTURES_DATA || {};
  }

  /**
   * 将字符串中的 HTML 特殊字符转义。
   * @param {string} str
   * @returns {string}
   */
  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * 根据 data-refs 属性渲染经文容器（懒渲染，只渲染一次）。
   * @param {HTMLElement} container  带有 data-refs 属性的 .scripture-content 元素
   */
  function renderContainer(container) {
    if (!container) return;
    if (container.dataset.rendered) return;   // 已渲染过则跳过
    container.dataset.rendered = '1';

    var refs = (container.dataset.refs || '').trim();
    if (!refs) return;

    var dict = getDict();
    var html = refs.split(',').map(function (ref) {
      ref = ref.trim();
      var text = dict[ref];
      if (text) {
        return '<div class="verse-line">' + escapeHtml(text) + '</div>';
      }
      // 字典中找不到时，降级显示引用本身
      return '<div class="verse-line verse-line--missing">' + escapeHtml(ref) + '</div>';
    }).join('');
    container.innerHTML = html;
  }

  // 暴露公共接口
  window.CXBibleDict = {
    renderContainer: renderContainer
  };
})();
