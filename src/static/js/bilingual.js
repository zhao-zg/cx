/**
 * 双语阅读模式（中文 / 英中对照 / 纯英文）
 * 语言模式开关 + 双语数据加载 + 英中配对 + 英文引用转换
 * 零依赖，IIFE 挂载 window.CXBilingual
 *
 * 语言模式持久化：localStorage['cx_lang_mode']：'enchs' → 英中对照；'en' → 纯英文；
 * 其余/缺失 → 中文（cn，存储值不存在）
 */
(function (win) {
  'use strict';

  var LANG_KEY = 'cx_lang_mode';
  var ENCHS_VAL = 'enchs';
  var EN_VAL = 'en';

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

  /** 当前语言模式：'cn' | 'enchs' | 'en'（非法值防御性回退 cn） */
  function getLangMode() {
    var v = _readStorage(LANG_KEY);
    if (v === ENCHS_VAL || v === EN_VAL) return v;
    return 'cn';
  }

  /** 设置语言模式：'cn'|'enchs'|'en'；cn 清空存储值；非法值视为 cn */
  function setLangMode(mode) {
    if (mode === ENCHS_VAL || mode === EN_VAL) {
      _writeStorage(LANG_KEY, mode);
    } else {
      _removeStorage(LANG_KEY);
    }
  }

  /** 当前是否英中对照模式 */
  function isEnchsMode() {
    return getLangMode() === ENCHS_VAL;
  }

  /** 当前是否纯英文模式 */
  function isEnMode() {
    return getLangMode() === EN_VAL;
  }

  /** 设置语言模式（旧二态 API，保留兼容）：true=英中对照，false=中文（清空存储值） */
  function setEnchsMode(enchs) {
    setLangMode(enchs ? ENCHS_VAL : 'cn');
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

  // ── 英文经文引用 → 中文标准 data-refs ─────────────────────────────
  // 输出消费端：scripture-popup.js（normalizeRef 将 ~—－ 归一为 -，故范围统一输出 -）
  // 数据实测形态：缩写带点/不带点、无空格书名（John6:63 / 2Thes. 2:10）、
  // 节后缀 a/b（bible-text.json 无字母后缀键 → 丢弃）、同书省略（Matt. 5:1; 28:19）、
  // 同章多节（Rom. 5:10, 17）、分号后无空格（1 Cor. 6:17;2 Cor. 4:7）。

  /** 英文书卷变体 → 中文缩写（66 卷；长名/短名/数字前缀变体） */
  var BOOK_MAP = {
    'Gen': '创', 'Genesis': '创',
    'Exo': '出', 'Exodus': '出',
    'Lev': '利', 'Leviticus': '利',
    'Num': '民', 'Numbers': '民',
    'Deut': '申', 'Deuteronomy': '申',
    'Josh': '书', 'Joshua': '书',
    'Judg': '士', 'Judges': '士',
    'Ruth': '得',
    '1 Sam': '撒上', '2 Sam': '撒下', '1 Samuel': '撒上', '2 Samuel': '撒下',
    '1 Kings': '王上', '2 Kings': '王下',
    '1 Chron': '代上', '2 Chron': '代下', '1 Chronicles': '代上', '2 Chronicles': '代下',
    'Ezra': '拉',
    'Neh': '尼', 'Nehemiah': '尼',
    'Esth': '斯', 'Esther': '斯',
    'Job': '伯',
    'Psa': '诗', 'Psalm': '诗', 'Psalms': '诗',
    'Prov': '箴', 'Proverbs': '箴',
    'Eccl': '传', 'Ecclesiastes': '传',
    'Song of Songs': '歌',
    'Isa': '赛', 'Isaiah': '赛',
    'Jer': '耶', 'Jeremiah': '耶',
    'Lam': '哀', 'Lamentations': '哀',
    'Ezek': '结', 'Ezekiel': '结',
    'Dan': '但', 'Daniel': '但',
    'Hos': '何', 'Hosea': '何',
    'Joel': '珥', 'Amos': '摩',
    'Obad': '俄', 'Obadiah': '俄',
    'Jonah': '拿',
    'Mic': '弥', 'Micah': '弥',
    'Nah': '鸿', 'Nahum': '鸿',
    'Hab': '哈', 'Habakkuk': '哈',
    'Zeph': '番', 'Zephaniah': '番',
    'Hag': '该', 'Haggai': '该',
    'Zech': '亚', 'Zechariah': '亚',
    'Mal': '玛', 'Malachi': '玛',
    'Matt': '太', 'Matthew': '太',
    'Mark': '可',
    'Luke': '路',
    'John': '约',
    'Acts': '徒',
    'Rom': '罗', 'Romans': '罗',
    '1 Cor': '林前', '2 Cor': '林后', '1 Corinthians': '林前', '2 Corinthians': '林后',
    'Gal': '加', 'Galatians': '加',
    'Eph': '弗', 'Ephesians': '弗',
    'Phil': '腓', 'Philippians': '腓',
    'Col': '西', 'Colossians': '西',
    '1 Thes': '帖前', '2 Thes': '帖后', '1 Thessalonians': '帖前', '2 Thessalonians': '帖后',
    '1 Tim': '提前', '2 Tim': '提后', '1 Timothy': '提前', '2 Timothy': '提后',
    'Titus': '多',
    'Philem': '门', 'Philemon': '门',
    'Heb': '来', 'Hebrews': '来',
    'James': '雅',
    '1 Pet': '彼前', '2 Pet': '彼后', '1 Peter': '彼前', '2 Peter': '彼后', 'Peter': '彼前',
    '1 John': '约壹', '2 John': '约贰', '3 John': '约叁',
    'Jude': '犹',
    'Rev': '启', 'Revelation': '启'
  };

  /** 书名交替模式：长名优先（避免 Rev 抢先 Revelation），词间空格弹性（匹配 2Thes/2 Cor） */
  var _bookAlt = (function () {
    var names = Object.keys(BOOK_MAP);
    names.sort(function (a, b) { return b.length - a.length; });
    return names.map(function (n) {
      return n.split(' ').map(_escRe).join('\\s*');
    }).join('|');
  })();

  function _escRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // 书卷 token：交替 + 可选点尾（Matt / Matt. / 2 Cor / 2Thes.）
  var BOOK_TOKEN = '(?:' + _bookAlt + ')\\.?';
  // 节：v / v-v，可带 a/b 后缀（后缀捕获后丢弃——bible-text.json 无字母后缀键）
  var V_PART = '\\d{1,3}(?:[ab])?(?:\\s*[-–]\\s*\\d{1,3}(?:[ab])?)?';
  var CV_PART = '\\d{1,3}:' + V_PART;          // 章:节(-节)
  var BV_PART = BOOK_TOKEN + '\\s*' + CV_PART; // 书 章:节(-节)

  // 完整引用序列：书 章:节 开头，后接「, 节」「; 章:节」「; 书 章:节」等延续
  var REF_SEQ_RE = new RegExp(
    BV_PART
    + '(?:\\s*[,;]\\s*(?:' + BV_PART + '|' + CV_PART + '|' + V_PART + '))*',
    'g'
  );

  // 序列内逐段解析：按 [,;] 切段后段首锚定（避免正则滑窗把「空格+数字前缀书名」拆散）
  var PART_RE = new RegExp(
    '^\\s*(' + BOOK_TOKEN + ')?\\s*(\\d{1,3})(?:[ab])?(?::(\\d{1,3})(?:[ab])?(?:\\s*[-–]\\s*(\\d{1,3})(?:[ab])?)?)?\\s*$'
  );

  /** 书名原文（含点/无空格数字前缀 2Thes）→ 中文缩写 */
  function _normBook(raw) {
    var key = raw.replace(/\./g, '').replace(/\s+/g, ' ').trim();
    key = key.replace(/^([1-3])(?=[A-Z])/, '$1 '); // 2Thes → 2 Thes
    return BOOK_MAP[key] || '';
  }

  /** 解析一个引用序列字符串 → 中文引用数组（按 [,;] 切段，书卷/章续接继承） */
  function _parseEnSeq(seq) {
    var refs = [];
    var book = '', ch = '';
    var parts = seq.split(/[,;]/);
    for (var i = 0; i < parts.length; i++) {
      var m = PART_RE.exec(parts[i]);
      if (!m) continue;
      if (m[1]) {
        var nb = _normBook(m[1]);
        if (nb) book = nb;
      }
      if (m[3] !== undefined) {
        // 章:节 形式（含范围）
        ch = m[2];
        refs.push(book + ch + ':' + m[3] + (m[4] ? '-' + m[4] : ''));
      } else if (book && ch) {
        // 纯节号：继承书卷 + 章
        refs.push(book + ch + ':' + m[2]);
      }
    }
    return refs;
  }

  function _escHtml(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function _escAttr(s) {
    return _escHtml(s).replace(/"/g, '&quot;');
  }

  /**
   * 英文文本 → HTML：英文经文引用包裹为 <span class="scripture-ref" data-refs="中文引用">
   * 未匹配部分原样 HTML 转义；refs 以逗号拼接（消费端按逗号分词展开）
   */
  function wrapEnRefs(text) {
    if (!text) return '';
    var out = '';
    var last = 0;
    REF_SEQ_RE.lastIndex = 0;
    var m;
    while ((m = REF_SEQ_RE.exec(text)) !== null) {
      var refs = _parseEnSeq(m[0]);
      if (!refs.length || !refs[0]) continue; // 防御：解析失败不动原文
      out += _escHtml(text.slice(last, m.index));
      out += '<span class="scripture-ref" data-refs="' + _escAttr(refs.join(',')) + '">'
        + _escHtml(m[0]) + '</span>';
      last = m.index + m[0].length;
    }
    out += _escHtml(text.slice(last));
    return out;
  }

  win.CXBilingual = {
    getLangMode: getLangMode,
    setLangMode: setLangMode,
    isEnchsMode: isEnchsMode,
    isEnMode: isEnMode,
    setEnchsMode: setEnchsMode,
    loadEnchs: loadEnchs,
    getEnchs: getEnchs,
    pairEn: pairEn,
    pairEnTree: pairEnTree,
    wrapEnRefs: wrapEnRefs,
  };
})(typeof window !== 'undefined' ? window : globalThis);
