/*!
 * ref-detector.js — 中文经文引用检测与包裹
 * 将 section.title / paragraph 中的经文引用括号、破折号引用
 * 包裹为 <span class="scripture-ref" data-refs="...">
 *
 * 对应 Python: HTMLGenerator._wrap_scripture_ref + ImprovedParser._expand_cn_scripture_refs
 *
 * 注意：JSON 中已由 Python 预计算 ctx_scripture（每节初始上下文）、
 * feeding_refs（喂养经文 data-refs）、morning_feeding_contexts 等，
 * 本模块只需做文字渲染层的包裹。
 *
 * 暴露: window.CXRef
 *   .wrapRefs(text, ctxStr)  → HTML string
 *   .escHtml(text)           → escaped string
 */
(function (win) {
  'use strict';

  // ── 书卷名映射（完整名 / 别名 → 缩写） ────────────────────────────────
  var FULL_BOOK_MAP = {
    '创世记':'创','出埃及记':'出','利未记':'利','民数记':'民','申命记':'申',
    '约书亚记':'书','士师记':'士','路得记':'得',
    '撒母耳记上':'撒上','撒母耳记下':'撒下',
    '列王纪上':'王上','列王纪下':'王下',
    '历代志上':'代上','历代志下':'代下',
    '以斯拉记':'拉','尼希米记':'尼','以斯帖记':'斯',
    '约伯记':'伯','诗篇':'诗','箴言':'箴','传道书':'传','雅歌':'歌',
    '以赛亚书':'赛','耶利米书':'耶','耶利米哀歌':'哀',
    '以西结书':'结','但以理书':'但',
    '何西阿书':'何','约珥书':'珥','阿摩司书':'摩','俄巴底亚书':'俄',
    '约拿书':'拿','弥迦书':'弥','那鸿书':'鸿','哈巴谷书':'哈',
    '西番雅书':'番','哈该书':'该','撒迦利亚书':'亚','玛拉基书':'玛',
    '马太福音':'太','马可福音':'可','路加福音':'路','约翰福音':'约',
    '马太':'太','马可':'可','路加':'路','约翰':'约',
    '行传':'徒','使徒':'徒','哀歌':'哀','雅各':'雅',
    '使徒行传':'徒','罗马书':'罗','罗马':'罗',
    '哥林多前书':'林前','哥林多后书':'林后',
    '加拉太书':'加','以弗所书':'弗','腓立比书':'腓','歌罗西书':'西',
    '帖撒罗尼迦前书':'帖前','帖撒罗尼迦后书':'帖后',
    '提摩太前书':'提前','提摩太后书':'提后',
    '腓利门书':'门','希伯来书':'来','雅各书':'雅',
    '彼得前书':'彼前','彼得后书':'彼后',
    '约翰壹书':'约壹','约翰贰书':'约贰','约翰叁书':'约叁',
    '犹大书':'犹','启示录':'启','提多书':'多',
    // 省略「书/记/传」字的3字简称
    '但以理':'但','以西结':'结','以赛亚':'赛','耶利米':'耶',
    '何西阿':'何','阿摩司':'摩','俄巴底亚':'俄',
    '约拿':'拿','弥迦':'弥','那鸿':'鸿','哈巴谷':'哈',
    '西番雅':'番','哈该':'该','撒迦利亚':'亚','玛拉基':'玛',
    '腓立比':'腓','以弗所':'弗','歌罗西':'西','加拉太':'加'
  };

  // 中文数字 → 整数
  function cnToInt(s) {
    if (!s) return 0;
    var UNITS = {一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
    if (s === '十') return 10;
    if (s.indexOf('百') !== -1) {
      var bi = s.indexOf('百');
      var h = (UNITS[s[bi-1]] || 1) * 100;
      return h + (bi+1 < s.length ? cnToInt(s.slice(bi+1)) : 0);
    }
    if (s.indexOf('十') !== -1) {
      var ti = s.indexOf('十');
      var tens = (ti > 0 ? (UNITS[s[ti-1]] || 1) : 1) * 10;
      return tens + (ti+1 < s.length ? (UNITS[s[ti+1]] || 0) : 0);
    }
    // 缩写两字：三八=38
    if (s.length === 2 && UNITS[s[0]] && UNITS[s[1]]) {
      return UNITS[s[0]] * 10 + UNITS[s[1]];
    }
    // 缩写三字：一一九=119
    if (s.length === 3) {
      var ZERO = {'○':0, '零':0};
      var h3 = UNITS[s[0]], t3 = ZERO.hasOwnProperty(s[1])?0:UNITS[s[1]],
          u3 = ZERO.hasOwnProperty(s[2])?0:UNITS[s[2]];
      if (h3 !== undefined && t3 !== undefined && u3 !== undefined) {
        return h3*100 + t3*10 + u3;
      }
    }
    return UNITS[s] || 0;
  }

  // 将文本中完整书名替换为缩写（从长到短）
  var _sortedFullNames = Object.keys(FULL_BOOK_MAP).sort(function(a,b){return b.length-a.length;});

  // 行内章节式引用匹配（嵌在句子中、不在括号/破折号内）
  // 例：马可十一章二十三至二十四节、诗篇一百一十九篇、二十五章十四至三十节、三十七节
  var _INLINE_F5_RE = (function () {
    var CN = '[一二三四五六七八九十百]+';
    var abbr = '[创出利民申书士得撒王代拉尼斯伯诗箴传歌赛耶哀结但何珥摩俄拿弥鸿哈番该亚玛太可路约徒罗林加弗腓西帖提门多来雅彼犹启](?:前|后|上|下|壹|贰|叁)?';
    var bookPat = '(?:(?:' + _sortedFullNames.join('|') + '|' + abbr + '))?';
    var bookReq = '(?:' + _sortedFullNames.join('|') + '|' + abbr + ')';
    // 章节式（含书卷名可选）、纯中文节号续（第?CN节 / CN至CN节）或书卷+中文章号速记（但二）
    return new RegExp(
      '(?:' + bookPat + CN + '[章篇](?:' + CN + '(?:[至到]' + CN + ')?节(?:[上下]半?)?)?'
      + '|第?' + CN + '(?:[至到]' + CN + ')?节(?:[上下]半?)?'
      + '|' + bookReq + CN + ')'
      , 'g');
  }());
  function normalizeBookNames(text) {
    for (var i = 0; i < _sortedFullNames.length; i++) {
      var full = _sortedFullNames[i];
      if (text.indexOf(full) !== -1) {
        text = text.split(full).join(FULL_BOOK_MAP[full]);
      }
    }
    return text;
  }

  // 从 ctx 字符串（如"弗4:17"或"腓四13"）提取 {book, chapter}
  function parseCtx(ctxStr) {
    if (!ctxStr) return {book:'', chapter:0};
    var s = normalizeBookNames(ctxStr);
    // 标准格式 book+chapter:verse
    var m = s.match(/^([^\d:]{1,3})(\d+):(\d+)/);
    if (m) return {book: m[1], chapter: parseInt(m[2], 10)};
    // 中文格式 book+中文章
    var CN_CH = '[一二三四五六七八九十百]+';
    var m2 = s.match(/^([^\d:一二三四五六七八九十百]{1,3})([\u4e00-\u9fff]+)/);
    if (m2) {
      var ch = cnToInt(m2[2]);
      if (ch) return {book: m2[1], chapter: ch};
    }
    return {book: s, chapter: 0};
  }

  // HTML 转义
  function escHtml(s) {
    return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── 核心：展开单个中文经文引用字符串 → ref 数组 ────────────────────
  // ref_text 例：「腓四5~9,11下~13」「一19~21上」「13」「三章十九节」
  function expandCnRefs(refText, defBook, defCh) {
    refText = normalizeBookNames((refText||'').trim());
    // 全角冒号→半角；去掉尾部标点（：。，；、)）等）
    refText = refText.replace(/：/g, ':').replace(/[\s。，；：:,;)）」』】〗\]]+$/g, '').trim();
    var book = defBook || '', ch = defCh || 0;
    var refs = [];

    // 两字后缀书卷（林前/林后/撒上/撒下 等）
    var TWO_SUFFIX = '(?:前|后|上|下|壹|贰|叁)';
    var BOOK_PAT = '(?:[创出利民申书士得撒王代拉尼斯伯诗箴传歌赛耶哀结但何珥摩俄拿弥鸿哈番该亚玛太可路约徒罗林加弗腓西帖提门多来雅彼犹启]' + TWO_SUFFIX + '?|[创出利民申书士得撒王代拉尼斯伯诗箴传歌赛耶哀结但何珥摩俄拿弥鸿哈番该亚玛太可路约徒罗林加弗腓西帖提门多来雅彼犹启])';
    var CN_N = '[一二三四五六七八九十百]+';
    // Format1: book + 中文章 + 阿拉伯节  e.g. 腓四5 / 腓四5~9 / 腓四5上~9
    var F1 = new RegExp('^(' + BOOK_PAT + ')(' + CN_N + ')(\\d+)([上下]?)(?:[~～\\-](\\d+)([上下]?))?$');
    // Format2: 中文章 + 阿拉伯节 (relative)  e.g. 四5 / 四5~9上
    var F2 = new RegExp('^(' + CN_N + ')(\\d+)([上下]?)(?:[~～\\-](\\d+)([上下]?))?$');
    // Format3: 纯阿拉伯节（续） e.g. 13 / 13上 / 11下~13 / 24节 / 23~24节 / 17节上 / 17节上半
    var F3 = /^(\d+)([上下]?)节?([上下]半?)?(?:[~～\-](\d+)([上下]?)节?([上下]半?)?)?$/;
    // Format4: 阿拉伯章:节  e.g. 约壹1:1 / 腓4:13~15
    var F4 = new RegExp('^(' + BOOK_PAT + '?)(\\d+):(\\d+)([上下]?)(?:[~～\\-](\\d+)([上下]?))?$');
    // Format5: 中文「章节式」 e.g. 三章十九节 / 三章十九至二十一节 / 诗篇一百一十九篇 / 三章十七节上半
    var F5 = new RegExp('^(' + BOOK_PAT + ')?(' + CN_N + ')[章篇](?:(' + CN_N + ')(?:[至到](' + CN_N + '))?节([上下]半?)?)?');
    // Format6: 单章书卷 + 阿拉伯节  e.g. 犹20 / 门10~12 / 俄5
    var SINGLE_BOOK = '(?:犹|门|俄|约贰|约叁)';
    var F6 = new RegExp('^(' + SINGLE_BOOK + ')(\\d+)([上下]?)(?:[~～\\-](\\d+)([上下]?))?$');
    // Format7: 纯中文节号（续）e.g. 三十七节 / 三十六至三十七节 / 第三十七节
    var F7 = new RegExp('^第?(' + CN_N + ')节?([上下]半?)?(?:[至到~～](' + CN_N + ')节([上下]半?)?)?$');
    // Format8: book + CN_chapter（整章速记，无节号、无"章"字）e.g. 但二 / 弗四
    var F8 = new RegExp('^(' + BOOK_PAT + ')(' + CN_N + ')$');

    function emitRange(b, c, v1, m1, v2, m2) {
      v2 = v2 || v1; m2 = m2 || (v2===v1 ? m1 : '');
      for (var v = v1; v <= v2; v++) {
        var mod = v===v1 ? m1 : (v===v2 ? m2 : '');
        refs.push(b + c + ':' + v + (mod||''));
      }
    }

    var parts = refText.split(/[,，、；。]+/);
    for (var pi = 0; pi < parts.length; pi++) {
      var p = parts[pi].trim().replace(/^参[看阅]?\s*/, '').replace(/^[—─]+\s*/, '').replace(/[：:。，；,;)）」』】〗\]]+$/g, '');
      if (!p) continue;
      var m;
      // F4: arabic chapter:verse
      if ((m = F4.exec(p))) {
        var b4 = m[1] || book; if (!b4) continue;
        book = b4; ch = parseInt(m[2],10);
        emitRange(book, ch, parseInt(m[3],10), m[4]||'', m[5]?parseInt(m[5],10):0, m[6]||'');
        continue;
      }
      // F6: 单章书卷 + 阿拉伯节  (犹/门/俄/约贰/约叁)
      if ((m = F6.exec(p))) {
        book = m[1]; ch = 1;
        emitRange(book, ch, parseInt(m[2],10), m[3]||'', m[4]?parseInt(m[4],10):0, m[5]||'');
        continue;
      }
      // F5: 章节式
      if ((m = F5.exec(p))) {
        var b5 = m[1] ? normalizeBookNames(m[1]) : book; if (!b5) continue;
        var c5 = cnToInt(m[2]); if (!c5 || c5 > 150) continue;
        book = b5; ch = c5;
        if (m[3]) {
          var v1_5 = cnToInt(m[3]), v2_5 = m[4] ? cnToInt(m[4]) : v1_5;
          var mod5 = m[5] ? m[5][0] : '';  // 取首字上/下
          if (v1_5) emitRange(book, ch, v1_5, mod5, v2_5, '');
        } else {
          refs.push(book + ch + ':0');
        }
        continue;
      }
      // F1: book + cn_chapter + arabic_verse
      if ((m = F1.exec(p))) {
        book = m[1]; ch = cnToInt(m[2]); if (!ch || ch > 150) continue;
        emitRange(book, ch, parseInt(m[3],10), m[4]||'', m[5]?parseInt(m[5],10):0, m[6]||'');
        continue;
      }
      // F2: cn_chapter + arabic_verse (relative)
      if (book && (m = F2.exec(p))) {
        var c2 = cnToInt(m[1]); if (!c2 || c2 > 150) continue;
        ch = c2;
        emitRange(book, ch, parseInt(m[2],10), m[3]||'', m[4]?parseInt(m[4],10):0, m[5]||'');
        continue;
      }
      // F3: pure arabic verse (continuation)
      if (book && ch && (m = F3.exec(p))) {
        // m[2]: 上下在节前  m[3]: 上下/上半/下半在节后; 取首字统一为修饰副
        var mod1f = (m[2] || (m[3] ? m[3][0] : ''));
        var v1f = parseInt(m[1],10), v2f = m[4] ? parseInt(m[4],10) : v1f;
        var mod2f = (m[5] || (m[6] ? m[6][0] : ''));
        emitRange(book, ch, v1f, mod1f, v2f, mod2f);
        continue;
      }
      // F7: 纯中文节号续（同书卷+同章）e.g. 三十七节 / 三十六至三十七节
      if (book && ch && (m = F7.exec(p))) {
        var v1_7 = cnToInt(m[1]), v2_7 = m[3] ? cnToInt(m[3]) : v1_7;
        var mod1_7 = m[2] ? m[2][0] : '', mod2_7 = m[4] ? m[4][0] : '';
        if (v1_7) emitRange(book, ch, v1_7, mod1_7, v2_7, mod2_7);
        continue;
      }
      // F8: book + CN_chapter（整章速记）e.g. 但二 → 但2:0
      if ((m = F8.exec(p))) {
        var b8 = normalizeBookNames(m[1]); var c8 = cnToInt(m[2]);
        if (!b8 || !c8 || c8 > 150) continue;
        book = b8; ch = c8;
        refs.push(book + ch + ':0');
        continue;
      }
    }
    return refs;
  }

  // ── 包裹单个括号/破折号引用为 <span> ───────────────────────────────────
  function makeSpan(rawText, refs) {
    var dataRefs = refs.join(',');
    return '<span class="scripture-ref" data-refs="' + escHtml(dataRefs) + '">' + escHtml(rawText) + '</span>';
  }

  // ── 主函数：将文本中的经文引用包裹为 <span> ────────────────────────────
  // ctxStr: 初始上下文字符串，如"弗4:17"（来自 section.ctx_scripture）
  // 处理：括号引用（弗四23）、破折号末尾引用 —腓四5
  function wrapRefs(text, ctxStr) {
    if (!text) return '';
    var ctx = parseCtx(ctxStr);
    var book = ctx.book, ch = ctx.chapter;

    // 找末尾破折号引用位置（括号外的最后一个 —）
    // 要求破折号后紧接合法经文引用格式，避免 "—耶稣基督…" 中"耶"（耶利米缩写）被误识别：
    //   ① 中文章号 + 数字/中文/章/篇  (一1 / 三章 / 一~二)
    //   ② 书卷缩写 + 数字/中文章号    (弗四5 / 腓4:13)
    //   ③ 阿拉伯章:节               (4:13)
    // 不合法：书卷缩写后接非数字汉字（如"耶稣"→耶+稣，稣不是章节号）
    var DASH_REF_START = /^(?:[一二三四五六七八九十百][\d一二三四五六七八九十百章篇~～\-]|[创出利民申书士得撒王代拉尼斯伯诗箴传歌赛耶哀结但何珥摩俄拿弥鸿哈番该亚玛太可路约徒罗林加弗腓西帖提门多来雅彼犹启](?:前|后|上|下|壹|贰|叁)?[\d一二三四五六七八九十百]|\d+:\d)/;
    var splitPos = -1;
    var depth = 0;
    for (var i = text.length - 1; i >= 0; i--) {
      var c = text[i];
      if (c === ')' || c === '）' || c === '〕') depth++;
      else if (c === '(' || c === '（' || c === '〔') depth--;
      else if ((c === '—' || c === '─') && depth === 0) {
        var after = text.slice(i+1).trim();
        if (DASH_REF_START.test(after)) {
          splitPos = i;
          break;
        }
      }
    }

    var mainText = splitPos >= 0 ? text.slice(0, splitPos) : text;
    var dashText = splitPos >= 0 ? text.slice(splitPos) : '';

    // 扫描括号引用
    var PAREN_RE = /[（(〔]([^）)〕\n]{1,60})[）)〕]/g;
    var result = [], last = 0, m;

    // 对纯文本段扫描行内章节式引用
    function pushPlain(seg) {
      _INLINE_F5_RE.lastIndex = 0;
      var last2 = 0, m2;
      while ((m2 = _INLINE_F5_RE.exec(seg)) !== null) {
        result.push(escHtml(seg.slice(last2, m2.index)));
        // 短格式（书卷+中文章数，无章/篇/节字）时，检查上下文以排除误识别
        // 规则1：前后均为汉字 → 嵌在词语中（如"圣徒一同"中的"徒一"），跳过
        // 规则2：后接量词 → 同样跳过（如"徒一个"）
        var isShortForm = !/[章篇节]/.test(m2[0]);
        var isCJK = /[\u4e00-\u9fff]/;
        var prevCharI = m2.index > 0 ? seg[m2.index - 1] : '';
        if (isShortForm) {
          var nextChar = (m2.index + m2[0].length < seg.length) ? seg[m2.index + m2[0].length] : '';
          if ((isCJK.test(prevCharI) && isCJK.test(nextChar)) ||
              /[个种们位只件份次些条样]/.test(nextChar)) {
            result.push(escHtml(m2[0]));
            last2 = m2.index + m2[0].length;
            continue;
          }
        }
        // 规则3：含章/篇的引用，首字为单字书卷缩写且紧接中文数字，前一字又是汉字
        // → 该缩写实为复合词的一部分，非书卷名（如"全书二十二章"中"书"前有"全"）
        if (!isShortForm && isCJK.test(prevCharI) && isCJK.test(m2[0][0])
            && /[一二三四五六七八九十百]/.test(m2[0][1] || '')) {
          result.push(escHtml(m2[0]));
          last2 = m2.index + m2[0].length;
          continue;
        }
        var irefs = expandCnRefs(m2[0], book, ch);  // 传入当前 book/ch，支持无书卷名的相对章引用
        if (irefs.length > 0) {
          var ilm = irefs[irefs.length - 1].match(/^([^\d:]+)(\d+):(\d+)/);
          if (ilm) { book = ilm[1]; ch = parseInt(ilm[2], 10); }
          result.push(makeSpan(m2[0], irefs));
        } else {
          result.push(escHtml(m2[0]));
        }
        last2 = m2.index + m2[0].length;
      }
      result.push(escHtml(seg.slice(last2)));
    }

    PAREN_RE.lastIndex = 0;
    while ((m = PAREN_RE.exec(mainText)) !== null) {
      // 括号前的文字：先扫描行内引用再转义
      pushPlain(mainText.slice(last, m.index));
      // 尝试展开括号内容
      var refs = expandCnRefs(m[1], book, ch);
      if (refs.length > 0) {
        // 更新上下文（用最后一个 ref）
        var lastRef = refs[refs.length - 1];
        var lm = lastRef.match(/^([^\d:]+)(\d+):(\d+)/);
        if (lm) { book = lm[1]; ch = parseInt(lm[2], 10); }
        result.push(makeSpan(m[0], refs));
      } else {
        // 括号整体解析失败（如「在以弗所三章十六节，」含前置词），
        // 回退：把括号开符、内容、闭符分别扫描行内引用
        var openCh = m[0][0], closeCh = m[0][m[0].length-1];
        result.push(escHtml(openCh));
        pushPlain(m[1]);
        result.push(escHtml(closeCh));
      }
      last = m.index + m[0].length;
    }
    pushPlain(mainText.slice(last));

    // 破折号引用
    if (dashText) {
      var refBody = dashText.replace(/^[—─]+/, '').trim();
      var drefs = expandCnRefs(refBody, book, ch);
      if (drefs.length > 0) {
        result.push(makeSpan(dashText, drefs));
      } else {
        result.push('<span class="scripture-ref">' + escHtml(dashText) + '</span>');
      }
    }

    return result.join('');
  }

  // ── scanCtx：扫描文本后返回更新的上下文字符串 ─────────────────────────
  // 用于 renderer 在处理完一个标题后，将新识别出的书卷+章传给后续兄弟/子节点
  function scanCtx(text, ctxStr) {
    if (!text) return ctxStr || '';
    var html = wrapRefs(text, ctxStr);
    var re = /data-refs="([^"]+)"/g, m, lastRefs = null;
    while ((m = re.exec(html)) !== null) lastRefs = m[1];
    if (!lastRefs) return ctxStr || '';
    var refs = lastRefs.split(',');
    var lr = refs[refs.length - 1].trim().replace(/[上下]$/, '');
    var cm = lr.match(/^([^\d:]+)(\d+):(\d+)/);
    return cm ? (cm[1] + cm[2] + ':' + cm[3]) : (ctxStr || '');
  }

  win.CXRef = { wrapRefs: wrapRefs, escHtml: escHtml, expandCnRefs: expandCnRefs, cnToInt: cnToInt, scanCtx: scanCtx };

}(window));
