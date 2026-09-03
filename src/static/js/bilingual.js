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

  /**
   * 英中段落等长配对：以中文数组为主序，逐项配英文（缺失补 null，渲染层跳过英文块）。
   * 中文缺失而英文存在时以英文为准补齐（cn 为空串）。
   * @returns Array<{cn:string, en:string|null}>
   */
  function pairEn(arrEn, arrCn) {
    var en = Array.isArray(arrEn) ? arrEn : null;
    var cn = Array.isArray(arrCn) ? arrCn : null;
    if (!cn && !en) return [];
    if (!cn) {
      // 无中文：仅英文
      var outEnOnly = [];
      for (var i = 0; i < en.length; i++) outEnOnly.push({ cn: '', en: en[i] });
      return outEnOnly;
    }
    var out = [];
    var n = Math.max(cn.length, en ? en.length : 0);
    for (var j = 0; j < n; j++) {
      out.push({
        cn: j < cn.length ? cn[j] : '',
        en: en && j < en.length ? en[j] : null,
      });
    }
    return out;
  }

  /**
   * 双树同步（原地挂载）：CN 树为骨架，逐节点对位挂 .en 属性。
   * 顶层按 pairEn 语义补齐（多余侧不丢）；子树节点数对不上时该子树整棵 en=null（回退仅中文）。
   * @param cnNodes CN 树数组（原地修改，挂 .en）
   * @param enNodes EN 树数组（只读）
   * @returns 传入的 cnNodes（原地挂载返回同一数组）
   */
  function pairEnTree(cnNodes, enNodes) {
    if (!Array.isArray(cnNodes)) return cnNodes || [];
    var en = Array.isArray(enNodes) ? enNodes : [];
    for (var i = 0; i < cnNodes.length; i++) {
      cnNodes[i].en = en[i] || null; // 挂对位 EN 节点（缺失为 null）
      _attachChildren(cnNodes[i], en[i] || null);
    }
    return cnNodes;
  }

  function _attachChildren(cnNode, enNode) {
    if (!cnNode || cnNode.en === null) return;
    var cnCh = cnNode.children;
    if (!Array.isArray(cnCh) || cnCh.length === 0) return;
    var enCh = enNode && Array.isArray(enNode.children) ? enNode.children : null;
    if (!enCh || enCh.length !== cnCh.length) {
      // 子节点数对不上：本节点自身的 en 保留（索引对位成功），仅其下子孙整棵 en=null（回退仅中文）
      for (var k = 0; k < cnCh.length; k++) _nullTree(cnCh[k]);
      return;
    }
    for (var i = 0; i < cnCh.length; i++) {
      cnCh[i].en = enCh[i] || null;
      _attachChildren(cnCh[i], enCh[i] || null);
    }
  }

  function _nullTree(node) {
    if (!node) return;
    node.en = null;
    var ch = node.children;
    if (Array.isArray(ch)) {
      for (var i = 0; i < ch.length; i++) _nullTree(ch[i]);
    }
  }

  win.CXBilingual = {
    isEnchsMode: isEnchsMode,
    setEnchsMode: setEnchsMode,
    loadEnchs: loadEnchs,
    getEnchs: getEnchs,
    pairEn: pairEn,
    pairEnTree: pairEnTree,
  };
})(typeof window !== 'undefined' ? window : globalThis);
