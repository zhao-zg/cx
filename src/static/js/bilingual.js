/**
 * 双语阅读模式（中文 / 英中对照）
 * 语言模式开关 + 双语数据加载 + 英中配对 + 英文引用转换
 * 零依赖，IIFE 挂载 window.CXBilingual
 *
 * 语言模式持久化：localStorage['cx_lang_mode'] === 'enchs' → 英中对照；其余/缺失 → 中文
 */
(function (win) {
  'use strict';

  var LANG_KEY = 'cx_lang_mode';
  var ENCHS_VAL = 'enchs';

  // 内部缓存：batchPath → enchs 数据（null 表示加载失败，静默降级中文）
  var _enchsCache = {};

  /**
   * 解析可用的 localStorage：
   * 浏览器 win.localStorage 恒存在；Node require 场景 win 可能为空对象，回退 globalThis.localStorage。
   * 不可用（隐私模式/无环境）返回 null，读写全部静默。
   */
  function _ls() {
    try {
      if (win.localStorage) return win.localStorage;
    } catch (e) {}
    try {
      if (typeof globalThis !== 'undefined' && globalThis.localStorage) return globalThis.localStorage;
    } catch (e) {}
    return null;
  }

  function _readStorage(key) {
    var ls = _ls();
    if (!ls) return null;
    try {
      return ls.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function _writeStorage(key, value) {
    var ls = _ls();
    if (!ls) return;
    try {
      ls.setItem(key, value);
    } catch (e) {
      // 写失败静默：仅影响持久化，不影响当前会话
    }
  }

  function _removeStorage(key) {
    var ls = _ls();
    if (!ls) return;
    try {
      ls.removeItem(key);
    } catch (e) {}
  }

  /** 当前是否英中对照模式 */
  function isEnchsMode() {
    return _readStorage(LANG_KEY) === ENCHS_VAL;
  }

  /** 设置语言模式：true=英中对照，false=中文（清空存储值） */
  function setEnchsMode(enchs) {
    if (enchs) {
      _writeStorage(LANG_KEY, ENCHS_VAL);
    } else {
      _removeStorage(LANG_KEY);
    }
  }

  /**
   * 加载批次双语数据 training-enchs.json
   * 成功 → 缓存并返回数据；失败/404 → 缓存 null 并返回 null（静默降级中文模式）
   */
  function loadEnchs(batchPath) {
    if (!batchPath) return Promise.resolve(null);
    if (batchPath in _enchsCache) return Promise.resolve(_enchsCache[batchPath]);
    var root = (win.CX_ROOT || './') + '';
    var url = root + batchPath + '/training-enchs.json';
    return fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        _enchsCache[batchPath] = data || null;
        return _enchsCache[batchPath];
      })
      .catch(function () {
        _enchsCache[batchPath] = null; // 失败也缓存，避免反复重试 404
        return null;
      });
  }

  /** 同步取已缓存的双语数据（未加载过/加载失败返回 null） */
  function getEnchs(batchPath) {
    if (!batchPath || !(batchPath in _enchsCache)) return null;
    return _enchsCache[batchPath];
  }

  win.CXBilingual = {
    isEnchsMode: isEnchsMode,
    setEnchsMode: setEnchsMode,
    loadEnchs: loadEnchs,
    getEnchs: getEnchs,
  };
})(typeof window !== 'undefined' ? window : globalThis);
