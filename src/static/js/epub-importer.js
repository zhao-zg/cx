/*!
 * epub-importer.js — EPUB 训练文件导入
 *
 * 解析由 Calibre 生成的特会 EPUB 文件，将其中的纲目、听抄、晨兴、诗歌
 * 等内容转换为与 txt-importer.js / training.json 兼容的训练数据结构。
 *
 * 支持 EPUB 2.0 / 3.0，ZIP 格式，依赖 JSZip 解压。
 *
 * 文件命名约定（Calibre 生成）：
 *   {N}_dg.htm   大纲（仅壹贰叁顶层）
 *   {N}_cv.htm   纲目附经文（完整大纲 + 脚注经文）
 *   {N}_ce.htm   中英对照纲目
 *   {N}_ts.htm   听抄
 *   {N}_h_1~6.htm  晨兴（周一至周六）
 *   {N}_h_hymn.htm 诗歌
 *   banner.html   标语
 *   index.html    目录
 *
 * 存储：与 txt-importer.js 共用 localforage 键
 *   'cx_local_imports'   → 索引列表
 *   'cx_local_train_{path}' → 训练 JSON
 *
 * 暴露：window.CXEpubImport
 *   .parseAndSave(file, onProgress) → Promise<{count, paths}>
 *   .listImports()                  → Promise<Array>  (委托 CXLocalImport)
 *   .deleteImport(path)             → Promise<void>   (委托 CXLocalImport)
 *   .getTraining(path)              → Promise<trainingData|null> (委托 CXLocalImport)
 */
(function (win) {
  'use strict';

  var STORE_INDEX = 'cx_local_imports';
  var STORE_PREFIX = 'cx_local_train_';

  // ── 工具函数 ──────────────────────────────────────────────────────────────

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function getNowVersion() {
    var d = new Date();
    return '' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate())
      + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
  }

  /** 从 ZIP 中以 UTF-8 读取文本文件 */
  function zipReadText(zip, path) {
    var entry = zip.file(path);
    if (!entry) return Promise.resolve('');
    return entry.async('string');
  }

  /** 将 DOM 中 <p> 的纯文本提取出来（递归取 textContent，去首尾空白） */
  function pText(pEl) {
    return (pEl.textContent || '').replace(/^\s+|\s+$/g, '');
  }

  /** 提取元素文本，保留 <br/> 换行。用于诗歌歌词提取。 */
  function pTextWithBreaks(el) {
    var parts = [];
    _walkForText(el, parts);
    return parts.join('').replace(/^\s+|\s+$/g, '');
  }

  function _walkForText(el, parts) {
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) { // TEXT_NODE
        parts.push(n.textContent || '');
      } else if (n.nodeType === 1) { // ELEMENT_NODE
        var tag = (n.tagName || '').toLowerCase();
        if (tag === 'br') {
          parts.push('\n');
        } else if (tag === 'b' || tag === 'strong') {
          parts.push(n.textContent || '');
        } else {
          _walkForText(n, parts);
        }
      }
    }
  }

  // ── EPUB ZIP 解析入口 ────────────────────────────────────────────────────

  /**
   * 解析 EPUB 的 container.xml → 找到 OPF → 读取元数据与 spine。
   * 返回 { metadata, spinePaths, zip }
   */
  function parseEpubStructure(zip) {
    // 1. 读取 container.xml
    return zipReadText(zip, 'META-INF/container.xml').then(function (containerXml) {
      var containerDoc = new DOMParser().parseFromString(containerXml, 'application/xml');
      var rootfileEl = containerDoc.querySelector('rootfile');
      if (!rootfileEl) throw new Error('EPUB 缺少 rootfile 声明');
      var opfPath = rootfileEl.getAttribute('full-path') || '';
      var opfDir = opfPath.indexOf('/') >= 0 ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

      // 2. 读取 OPF
      return zipReadText(zip, opfPath).then(function (opfXml) {
        var opfDoc = new DOMParser().parseFromString(opfXml, 'application/xml');

        // 元数据
        var title = '';
        var creator = '';
        var subject = '';
        var dateStr = '';
        var lang = 'zh';
        var metaEls = opfDoc.querySelectorAll('metadata > *');
        for (var i = 0; i < metaEls.length; i++) {
          var el = metaEls[i];
          var tag = el.tagName.replace(/^dc:/, '');
          if (tag === 'title' && !title) title = (el.textContent || '').trim();
          else if (tag === 'creator' && !creator) creator = (el.textContent || '').trim();
          else if (tag === 'subject' && !subject) subject = (el.textContent || '').trim();
          else if (tag === 'date' && !dateStr) dateStr = (el.textContent || '').trim();
          else if (tag === 'language' && !lang) lang = (el.textContent || '').trim();
        }

        // manifest: id → {href, mediaType}
        var manifest = {};
        var itemEls = opfDoc.querySelectorAll('manifest > item');
        for (var j = 0; j < itemEls.length; j++) {
          var item = itemEls[j];
          var id = item.getAttribute('id') || '';
          var href = item.getAttribute('href') || '';
          var mt = item.getAttribute('media-type') || '';
          manifest[id] = { href: opfDir + href, mediaType: mt };
        }

        // spine: 有序 itemref id 列表
        var spineIds = [];
        var itemrefEls = opfDoc.querySelectorAll('spine > itemref');
        for (var k = 0; k < itemrefEls.length; k++) {
          var idref = itemrefEls[k].getAttribute('idref');
          if (idref) spineIds.push(idref);
        }

        return {
          metadata: { title: title, creator: creator, subject: subject, date: dateStr, lang: lang },
          manifest: manifest,
          spineIds: spineIds,
          opfDir: opfDir,
          zip: zip
        };
      });
    });
  }

  // ── HTML 内容解析 ────────────────────────────────────────────────────────

  /**
   * 将 HTML 字符串解析为 DOM Document
   */
  function parseHtmlDoc(html) {
    return new DOMParser().parseFromString(html, 'application/xhtml+xml');
  }

  /**
   * 从 <p class="calibre_zongti"> 提取总题
   */
  function extractZongti(doc) {
    var el = doc.querySelector('.calibre_zongti');
    if (!el) return '';
    // 取第一行（去除 <br/> 后的英文部分）
    var text = (el.textContent || '').trim();
    var br = el.querySelector('br');
    if (br) {
      // textContent 会在 <br/> 处自然换行，取第一行即可
      text = text.split('\n')[0].trim();
    }
    // 去掉 "总题：" 前缀
    text = text.replace(/^总题[：:]\s*/, '');
    return text;
  }

  /**
   * 从 <p class="calibre_content_title"> 或 <h2 class="calibre_content_title"> 提取篇章标题
   * 格式："第一篇　门徒、信徒、圣徒和基督徒" 或 "第一周　门徒、信徒、圣徒和基督徒"
   * 返回 { number: 1, title: "门徒、信徒、圣徒和基督徒", fullTitle: "第一篇　..." }
   */
  function extractContentTitle(doc) {
    var el = doc.querySelector('.calibre_content_title');
    if (!el) return null;
    var text = (el.textContent || '').trim();
    // 去掉英文行（<br/> 后的 <span> 部分）
    var lines = text.split('\n').map(function(l){ return l.trim(); }).filter(Boolean);
    var firstLine = lines[0] || text;
    // 匹配 "第X篇　标题" 或 "第X周　标题"
    var m = firstLine.match(/^第([一二三四五六七八九十]+)[篇周][\s\u3000]*(.*)/);
    if (m) {
      return { cnNum: m[1], title: m[2].trim(), fullTitle: firstLine };
    }
    return { cnNum: '', title: firstLine, fullTitle: firstLine };
  }

  /**
   * 从 <p class="calibre_text_verse"> 提取读经经文
   */
  function extractScripture(doc) {
    var el = doc.querySelector('.calibre_text_verse');
    if (!el) return '';
    var text = (el.textContent || '').trim();
    // 去掉 "读经：" 前缀
    text = text.replace(/^读经[：:]\s*/, '');
    return text;
  }

  // ── 大纲解析 ─────────────────────────────────────────────────────────────

  var LEVEL1_CHARS = '壹贰叁肆伍陆柒捌玖拾';
  var LEVEL2_CHARS = '一二三四五六七八九十';
  var LEVEL5_CHARS = '㈠㈡㈢㈣㈤㈥㈦㈧㈨㈩';
  var LEVEL6_CHARS = '⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽';

  function cnOrdToInt(cn) {
    var map = {
      '一':1,'二':2,'三':3,'四':4,'五':5,
      '六':6,'七':7,'八':8,'九':9,'十':10,
      '十一':11,'十二':12,'十三':13,'十四':14,'十五':15,
      '十六':16,'十七':17,'十八':18,'十九':19,'二十':20
    };
    if (map[cn]) return map[cn];
    return 0;
  }

  /**
   * 解析 _cv.htm 页面中的大纲树。
   *
   * CSS 类名 → 层级映射：
   *   calibre_text_dadian    → 壹（大点）
   *   calibre_text_zhongdian → 一（中点）
   *   calibre_text_xiaodian  → 1（小点）
   *   calibre_text_chenxing_content / calibre_text_chenxing_verse → 晨兴内容（跳过）
   *
   * 返回 Content 节点树 []
   */
  /**
   * 从纲目标题段落后的 <aside> 脚注中提取经文引用，生成 ctx_scripture 字符串。
   * 脚注格式：<p class="calibre_verse"><b>弗4:23</b>　经文内容</p>
   * 返回第一个引用的阿拉伯格式（如 "弗4:23"），用于渲染时为该节点设定初始上下文。
   */
  // 中文书卷全名 → 简称映射（与 ref-detector.js 的 FULL_BOOK_MAP 一致）
  var _FULL_BOOK_MAP = {
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
    '使徒行传':'徒','罗马书':'罗',
    '哥林多前书':'林前','哥林多后书':'林后',
    '加拉太书':'加','以弗所书':'弗','腓立比书':'腓','歌罗西书':'西',
    '帖撒罗尼迦前书':'帖前','帖撒罗尼迦后书':'帖后',
    '提摩太前书':'提前','提摩太后书':'提后',
    '腓利门书':'门','希伯来书':'来','雅各书':'雅',
    '彼得前书':'彼前','彼得后书':'彼后',
    '约翰壹书':'约壹','约翰贰书':'约贰','约翰叁书':'约叁',
    '犹大书':'犹','启示录':'启','提多书':'多'
  };
  // 按长度降序排列，确保长名优先匹配（如"撒母耳记上"优先于"撒"）
  var _sortedFullNames = Object.keys(_FULL_BOOK_MAP).sort(function(a, b) { return b.length - a.length; });

  function _extractCtxFromFootnote(pEl) {
    // 优先：查找紧跟当前 <p> 的兄弟 <aside> 元素中的经文引用
    var sibling = pEl.nextElementSibling;
    if (sibling) {
      var tag = (sibling.tagName || '').toLowerCase();
      if (tag === 'aside') {
        var firstVerse = sibling.querySelector('.calibre_verse b');
        if (firstVerse) {
          var ref = (firstVerse.textContent || '').trim();
          if (/^[创出利民申书士得撒王代拉尼斯伯诗箴传歌赛耶哀结但何珥摩俄拿弥鸿哈番该亚玛太可路约徒罗林加弗腓西帖提门多来雅彼犹启][前后上下壹贰叁参]?\d+:\d+/.test(ref)) {
            return ref;
          }
        }
      }
    }
    // 回退：从标题文本中提取中文书卷全名（后不接章节号），生成"简称0:0"格式的 ctx_scripture
    // 例如「…在雅歌中也提到：」→ "歌0:0"，让渲染时子节点的"一7上"能正确回溯到雅歌
    var text = (pEl.textContent || '').trim();
    for (var i = 0; i < _sortedFullNames.length; i++) {
      var name = _sortedFullNames[i];
      var idx = text.indexOf(name);
      if (idx >= 0) {
        var after = idx + name.length;
        var nextChar = after < text.length ? text[after] : '';
        // 后不接章节号相关字符（否则是标准引用，不应走此回退路径）
        if (!/[一二三四五六七八九十百\d章篇]/.test(nextChar)) {
          return _FULL_BOOK_MAP[name] + '0:0';
        }
      }
    }
    return '';
  }

  function parseOutlineFromHtml(doc) {
    var body = doc.querySelector('body');
    if (!body) return [];

    var roots = [];
    var stack = []; // [{rank, node}]

    var allP = body.querySelectorAll('p, h2');
    for (var i = 0; i < allP.length; i++) {
      var p = allP[i];
      var cls = p.getAttribute('class') || '';
      var text = pText(p);

      if (!text) continue;

      var rank = 0;
      var level = '';
      var title = '';

      // 带圈层级前缀（㈠㈡㈢…/⑴⑵⑶…）即使挂在跳过类（calibre_text_abs、chenxing 等）上
      // 也是真大纲节点：按前缀放行，落入下方按文本前缀的层级识别（rank5/6）
      var circledLevel = text.length > 1 &&
        (LEVEL5_CHARS.indexOf(text[0]) >= 0 || LEVEL6_CHARS.indexOf(text[0]) >= 0);

      if (!circledLevel &&
          (cls === 'calibre_zongti' || cls === 'calibre_content_title' ||
          cls === 'calibre_text_verse' || cls === 'calibre_verse' ||
          cls === 'calibre_text_chenxing_content' ||
          cls === 'calibre_text_chenxing_verse' || cls === 'calibre_text_chenxing_content_wyxd' ||
          cls === 'calibre_text_chenxing_content_wn' || cls === 'calibre_text_gangmu_wn' ||
          cls === 'calibre_text_hymns' || cls === 'calibre_index_chapter' ||
          cls === 'calibre_index_title1' || cls === 'calibre_text_abs' ||
          cls === 'calibre_text_abs_dadian' || cls === 'calibre_text_abs_zhongdian' ||
          cls === 'calibre_text_abs_xiaodian' || cls === 'calibre_e_text_dadian' ||
          cls === 'calibre_e_text_zhongdian' || cls === 'calibre_e_text_xiaodian')) {
        continue; // 跳过非大纲段落
      }

      if (cls === 'calibre_text_dadian') {
        rank = 1;
        // 提取层级字符和标题
        if (text.length > 1 && LEVEL1_CHARS.indexOf(text[0]) >= 0) {
          level = text[0];
          title = text.slice(1).replace(/^[\s\u3000]+/, '');
        } else {
          level = '';
          title = text;
        }
      } else if (cls === 'calibre_text_zhongdian') {
        rank = 2;
        if (text.length > 1 && LEVEL2_CHARS.indexOf(text[0]) >= 0) {
          level = text[0];
          title = text.slice(1).replace(/^[\s\u3000]+/, '');
        } else {
          level = '';
          title = text;
        }
      } else if (cls === 'calibre_text_xiaodian') {
        rank = 3;
        // 匹配 "1　标题" 或 "1. 标题" 格式
        var m3 = text.match(/^(\d+)[.。\s\u3000]+(.*)/);
        if (m3) {
          level = m3[1];
          title = m3[2];
        } else {
          // 可能是 ①② 等格式
          level = '';
          title = text;
        }
      } else {
        // 未知类名 — 可能是更深层内容，尝试按文本前缀匹配层级
        // 也可能是不带 class 的 <p>（听抄中的散文段落），跳过
        var m4 = text.match(/^([a-z])[.\s\u3000]+(.*)/);
        if (m4) {
          rank = 4;
          level = m4[1];
          title = m4[2];
        } else if (text.length > 1 && LEVEL5_CHARS.indexOf(text[0]) >= 0) {
          rank = 5;
          level = text[0];
          title = text.slice(1).replace(/^[\s\u3000]+/, '');
        } else if (text.length > 1 && LEVEL6_CHARS.indexOf(text[0]) >= 0) {
          rank = 6;
          level = text[0];
          title = text.slice(1).replace(/^[\s\u3000]+/, '');
        } else {
          continue;
        }
      }

      // 剥离 ─引用经文 标记
      title = title.replace(/\u2500引用经文$/, '');

      // 从紧跟的脚注中提取首个经文引用作为 ctx_scripture
      var ctxScripture = _extractCtxFromFootnote(p);

      var node = { level: level, title: title, content: [], children: [] };
      if (ctxScripture) node.ctx_scripture = ctxScripture;

      // 维护栈：弹出 rank >= 当前的节点
      while (stack.length && stack[stack.length - 1].rank >= rank) stack.pop();
      if (stack.length) {
        stack[stack.length - 1].node.children.push(node);
      } else {
        roots.push(node);
      }
      stack.push({ rank: rank, node: node });
    }

    return roots;
  }

  // ── 职事信息摘录解析 ──────────────────────────────────────────────────

  /**
   * 从 _cv.htm（纲目附经文）文件中提取"职事信息摘录"内容。
   *
   * EPUB 中职事信息摘录位于 _cv.htm 末尾，结构如下：
   *   <p class="calibre_text_dadian">职事信息摘录：</p>   ← 标记段落
   *   <p class="calibre_text_abs_dadian">小标题</p>       ← 小标题（可选，可多个）
   *   <p class="calibre_text_abs">正文段落</p>           ← 实际内容
   *
   * 收集标记段落之后的所有 abs_dadian 小标题和 abs 正文段落，
   * 用 \n\n 分隔，小标题独占一行。
   *
   * @param {Document} doc - 解析后的 HTML 文档
   * @returns {string} 职事信息摘录纯文本
   */
  function parseMinistryExcerptFromHtml(doc) {
    var body = doc.querySelector('body');
    if (!body) return '';

    var allP = body.querySelectorAll('p, h2');
    var inMinistry = false;
    var lines = [];

    for (var i = 0; i < allP.length; i++) {
      var p = allP[i];
      var cls = p.getAttribute('class') || '';
      var text = pText(p);

      // 检测"职事信息摘录："标记段落
      if (!inMinistry) {
        if (cls === 'calibre_text_dadian' &&
            (/^职事信息摘录[：:]?\s*$/.test(text) || text === '职事信息摘录' || text === '职事信息摘录：')) {
          inMinistry = true;
        }
        continue;
      }

      // 进入职事摘录区域后：
      // - calibre_text_abs_dadian：小标题（可能为空，跳过空值）
      // - calibre_text_abs：正文段落
      // - 其他类名（如 calibre_text_dadian 新大点）：结束收集
      if (cls === 'calibre_text_abs_dadian') {
        if (text) lines.push(text);
      } else if (cls === 'calibre_text_abs') {
        if (text) lines.push(text);
      } else {
        // 遇到非 abs_dadian / abs 的段落，结束收集
        break;
      }
    }

    return lines.length ? lines.join('\n\n') : '';
  }

  // ── 听抄纲目匹配辅助函数 ──────────────────────────────────────────────

  /** 标准化标题用于匹配：去除括号内容、经文引用、标点、空白 */
  function _normalizeTitleForMatch(title) {
    if (!title) return '';
    var t = title.replace(/[（(].*?[)）]/g, ''); // 去括号及内容
    t = t.replace(/\u2500/g, '').replace(/\u2014/g, ''); // 去 dash
    t = t.replace(/[，。；：、（）()\[\]「」\u201c\u201d\u2018\u2019\s\u3000·~0-9]/g, '');
    return t;
  }

  /** 计算两个字符串的公共前缀长度 */
  function _commonPrefixLen(a, b) {
    var n = Math.min(a.length, b.length);
    for (var i = 0; i < n; i++) {
      if (a[i] !== b[i]) return i;
    }
    return n;
  }

  /** 在纲目节点列表中找到与听抄标题最佳匹配的节点 */
  function _matchTranscriptToOutline(transcriptTitle, outlineNodes, minMatch) {
    minMatch = minMatch || 6;
    if (!transcriptTitle || !outlineNodes || !outlineNodes.length) return null;
    var normT = _normalizeTitleForMatch(transcriptTitle);
    if (normT.length < minMatch) return null;
    var bestMatch = null;
    var bestLen = 0;
    for (var i = 0; i < outlineNodes.length; i++) {
      var node = outlineNodes[i];
      var normO = _normalizeTitleForMatch(node.title);
      if (normO.length < minMatch) continue;

      // 1. 直接前缀匹配
      var matchLen = _commonPrefixLen(normT, normO);
      if (matchLen >= minMatch && matchLen > bestLen) {
        bestMatch = node;
        bestLen = matchLen;
      }

      // 2. 偏移前缀匹配：在 outline 中查找 transcript 起始位置
      if (normT.length >= minMatch && normO.length > normT.length) {
        var searchStr = normT.substring(0, minMatch);
        var pos = normO.indexOf(searchStr);
        if (pos > 0) {
          var offLen = _commonPrefixLen(normT, normO.substring(pos));
          if (offLen >= minMatch && offLen > bestLen) {
            bestMatch = node;
            bestLen = offLen;
          }
        }
      }

      // 3. 反向偏移匹配：在 transcript 中查找 outline 起始位置
      if (normO.length >= minMatch) {
        var searchStrO = normO.substring(0, minMatch);
        var posT = normT.indexOf(searchStrO);
        if (posT > 0) {
          var offLen2 = _commonPrefixLen(normO, normT.substring(posT));
          if (offLen2 >= minMatch && offLen2 > bestLen) {
            bestMatch = node;
            bestLen = offLen2;
          }
        }
      }
    }
    return bestMatch;
  }

  /** 截掉正文段落中与标题重复的前缀，返回剩余内容
   *  Calibre 生成的 EPUB 中，标题段落后的首段正文常以标题文本开头再展开，
   *  例如标题 "我们是基督的门徒" → 正文 "我们是基督的门徒，就是跟从基督…"
   *  截掉重复前缀后保留 "，就是跟从基督…"，避免读者看到连续重复内容。
   *  若正文与标题完全相同则返回空串，若无重复前缀则返回原文。
   */
  function _stripTitlePrefix(text, title) {
    var normT = _normalizeTitleForMatch(text);
    var normO = _normalizeTitleForMatch(title);
    if (!normT || !normO) return text;
    var prefixLen = _commonPrefixLen(normT, normO);
    // 公共前缀需足够长才算重复：至少 8 字符，且覆盖标题标准化串 60% 以上
    // 过低阈值会误截语义不同但共享短前缀的段落（如"初熟的果子是…"）
    var minPrefixLen = Math.max(8, Math.floor(normO.length * 0.6));
    if (prefixLen < minPrefixLen) return text; // 重叠太短，不算重复
    if (prefixLen >= normT.length && prefixLen >= normO.length) return ''; // 完全相同
    // 构建原文→标准化串的位置映射：charMap[normIdx] = 该标准化字符在原文中的起始位置
    // 对原文做与 _normalizeTitleForMatch 相同的标准化，逐字符跟踪位置
    var charMap = [];
    var normChars = [];
    var ti = 0;
    while (ti < text.length) {
      var rest = text.substring(ti);
      // 尝试匹配括号对（非贪婪），匹配成功则跳过整段括号内容
      var parenMatch = rest.match(/^[（(].*?[)）]/);
      if (parenMatch) {
        ti += parenMatch[0].length;
        continue;
      }
      var ch = text[ti];
      // 跳过与 _normalizeTitleForMatch 相同的字符
      if (/[\u2500\u2014，。；：、（）()[\]「」\u201c\u201d\u2018\u2019\s\u3000·~0-9]/.test(ch)) {
        ti++;
        continue;
      }
      charMap.push(ti);
      normChars.push(ch);
      ti++;
    }
    // prefixLen 对应的原文截断位置：标准化串前 prefixLen 个字符之后的原文偏移
    if (prefixLen >= charMap.length) {
      // 标准化前缀覆盖了整个原文标准化部分，截掉剩余标点
      return text.substring(ti).replace(/^[\s\u3000，。；：、]+/, '');
    }
    var cutPos = charMap[prefixLen];
    var remainder = text.substring(cutPos).replace(/^[\s\u3000，。；：、]+/, '');
    return remainder;
  }

  /** 将文本追加到当前节点或引言内容 */
  function _appendToCurrent(node, introContent, text) {
    if (node) {
      node.content.push(text);
    } else {
      introContent.push(text);
    }
  }

  // ── 听抄解析 ─────────────────────────────────────────────────────────────

  /**
   * 解析 _ts.htm 页面中的听抄内容。
   * 使用 CSS 类名确定 4 级嵌套（dadian/zhongdian/xiaodian/zimudian），
   * 通过纲目匹配获取级别号和完整标题。
   *
   * CSS 类名映射：
   *   calibre_text_abs_dadian     → 大点（壹）
   *   calibre_text_abs_zhongdian  → 中点（一）
   *   calibre_text_abs_xiaodian   → 小点（1）
   *   calibre_text_abs_zimudian   → 子目点（a）(暂未出现)
   *   calibre_text_abs            → 听抄正文段落
   *
   * @param {Document} doc - 解析后的 HTML 文档
   * @param {Array} [outlineSections] - 纲目层级节点（用于匹配标题获取 level）
   * @returns {{ detailSections, messageContent, ministryExcerpt }}
   */
  function parseTranscriptFromHtml(doc, outlineSections) {
    var body = doc.querySelector('body');
    if (!body) return { detailSections: [], messageContent: [], ministryExcerpt: '' };

    var detailSections = [];
    var messageContent = [];
    var introContent = []; // 第一个匹配纲目之前的内容

    // 听抄是否允许被纲目干预（标题覆盖 + 层级下钻），由 config.yaml 的 use_outline_fallback 控制。
    // 默认 false：听抄完全按原文显示，不参与纲目匹配，避免出现纲目的「壹贰」编号及层级改写。
    var useOutlineFallback = !!(win.CX_SERVERS && win.CX_SERVERS.useOutlineFallback);

    // 4 级嵌套状态
    var currentNodes = [null, null, null, null]; // [section, child, grandchild, great_grandchild]

    // 各级对应的纲目子节点列表（5 个元素：索引 0-4，rank 4 的子节点存放在索引 4）
    // 仅在 useOutlineFallback=true 时参与纲目匹配下钻，否则恒为空，完全按原文层级。
    var outlineChildrenStack = [useOutlineFallback ? (outlineSections || []) : [], [], [], [], []];

    // 标记刚创建的新节点 rank，用于过滤与标题重复的首段
    var justCreatedRank = 0;
    var firstMatchFound = false;

    var allP = body.querySelectorAll('p, h2');
    for (var i = 0; i < allP.length; i++) {
      var p = allP[i];
      var cls = p.getAttribute('class') || '';
      var text = pText(p);
      if (!text) continue;

      // 跳过标题行、读经行、脚注
      if (cls === 'calibre_zongti' || cls === 'calibre_content_title' ||
          cls === 'calibre_text_verse' || cls === 'calibre_verse' ||
          cls === 'calibre_text_abs_shuoming') continue;

      // CSS 类名 → 层级 rank
      var rank = 0;
      if (cls === 'calibre_text_abs_dadian') rank = 1;
      else if (cls === 'calibre_text_abs_zhongdian') rank = 2;
      else if (cls === 'calibre_text_abs_xiaodian') rank = 3;
      else if (cls === 'calibre_text_abs_zimudian') rank = 4;

      // ── 层级标题 ──
      if (rank > 0) {
        // 1. 剥离级别号前缀
        var levelPrefix = '';
        var cleanTitle = text;
        if (text.length > 1 && rank <= 2) {
          var chars = rank === 1 ? LEVEL1_CHARS : LEVEL2_CHARS;
          if (chars.indexOf(text[0]) >= 0) {
            levelPrefix = text[0];
            cleanTitle = text.slice(1).replace(/^[\s\u3000]+/, '');
          }
        }
        if (!levelPrefix && rank === 3) {
          var m3 = text.match(/^(\d+)[.。\s\u3000]+(.*)/);
          if (m3) { levelPrefix = m3[1]; cleanTitle = m3[2]; }
          else {
            var mLetter = text.match(/^([a-z])[.\s\u3000]+(.*)/);
            if (mLetter) { levelPrefix = mLetter[1]; cleanTitle = mLetter[2]; }
          }
        }
        if (!levelPrefix && rank === 4) {
          var m4 = text.match(/^([a-z])[.\s\u3000]+(.*)/);
          if (m4) { levelPrefix = m4[1]; cleanTitle = m4[2]; }
          else {
            var m4d = text.match(/^(\d+)[.。\s\u3000]+(.*)/);
            if (m4d) { levelPrefix = m4d[1]; cleanTitle = m4d[2]; }
          }
        }

        // 2. 在纲目中匹配标题（仅在 useOutlineFallback 开启时），确定 level 和 title
        var matched = null;
        if (useOutlineFallback) {
          var parentOutlineChildren = outlineChildrenStack[rank - 1];
          matched = _matchTranscriptToOutline(cleanTitle, parentOutlineChildren);
          if (matched) firstMatchFound = true;
        }

        // 纲目参与时：匹配成功则用纲目的 level/title 覆盖听抄标题
        var nodeLevel = matched ? (matched.level || levelPrefix) : levelPrefix;
        var nodeTitle = matched
          ? (matched.title || cleanTitle).replace(/\u2500/g, '\u2014')
          : cleanTitle;

        // 3. 创建节点
        var newNode = {
          level: nodeLevel, title: nodeTitle,
          content: [], children: []
        };
        justCreatedRank = rank;

        // 4. 重置更深层级
        for (var j = rank; j < 4; j++) {
          currentNodes[j] = null;
          outlineChildrenStack[j + 1] = [];
        }

        // 5. 设置当前层级节点
        currentNodes[rank - 1] = newNode;
        outlineChildrenStack[rank] = matched ? (matched.children || []) : [];

        // 6. 添加到父节点或顶级列表
        if (rank === 1) {
          detailSections.push(newNode);
        } else if (currentNodes[rank - 2]) {
          currentNodes[rank - 2].children.push(newNode);
        } else {
          detailSections.push(newNode);
        }

      // ── 正文段落（所有非层级标题的段落） ──
      } else {
        // 截掉首段正文中与标题重复的前缀，避免连续重复
        if (justCreatedRank > 0) {
          var target = currentNodes[3] || currentNodes[2] || currentNodes[1] || currentNodes[0];
          if (target) {
            var stripped = _stripTitlePrefix(text, target.title);
            justCreatedRank = 0;
            if (!stripped) continue; // 完全相同，跳过
            text = stripped;
          } else {
            justCreatedRank = 0;
          }
        }

        var _tgt = currentNodes[3] || currentNodes[2] || currentNodes[1] || currentNodes[0];
        _appendToCurrent(_tgt, introContent, text);
      }
    }

    // 引言内容归属：有 detailSections 时放入 messageContent，否则创建引言 Section
    if (introContent.length) {
      if (detailSections.length) {
        messageContent = introContent;
      } else {
        detailSections.unshift({
          level: '', title: '', content: introContent, children: []
        });
      }
    }

    // 若无结构化段落，将所有正文作为单一节点
    if (!detailSections.length && messageContent.length) {
      detailSections = [{ level: '', title: '', content: messageContent, children: [] }];
      messageContent = [];
    }

    return { detailSections: detailSections, messageContent: messageContent, ministryExcerpt: '' };
  }

  // ── 晨兴解析 ─────────────────────────────────────────────────────────────

  /**
   * 解析 _h_N.htm 页面中的晨兴内容。
   *
   * CSS 类名映射：
   *   calibre_text_gangmu_wn           → "周　一" 日标记
   *   calibre_text_dadian              → 大纲点（壹）
   *   calibre_text_zhongdian          → 中点（一）
   *   calibre_text_xiaodian           → 小点（1）
   *   calibre_text_chenxing_content_wn      → "晨兴喂养" 标题
   *   calibre_text_chenxing_content_wyxd   → "晨兴喂养" 正文标题
   *   calibre_text_chenxing_content         → 晨兴喂养正文
   *   calibre_text_chenxing_verse           → 晨兴喂养经文
   *
   * 返回单天 MorningRevival 对象
   */
  function parseMorningRevivalFromHtml(doc, dayLabel) {
    var body = doc.querySelector('body');
    if (!body) return null;

    var outlineNodes = [];
    var feedingScriptures = [];
    var morningFeeding = [];
    var messageReading = [];
    var refReading = [];

    var stack = []; // 大纲栈
    var mode = 'outline'; // 'outline' | 'feeding' | 'msgread'
    var dayOutlines = {}; // { dayCn: [Content nodes] }
    var currentDayCn = '';

    var allP = body.querySelectorAll('p, h2');
    for (var i = 0; i < allP.length; i++) {
      var p = allP[i];
      var cls = p.getAttribute('class') || '';
      var text = pText(p);
      if (!text) continue;

      // 跳过标题行和读经行
      if (cls === 'calibre_zongti' || cls === 'calibre_content_title' ||
          cls === 'calibre_text_verse') continue;

      // 日标记: "周　一" → 切换当天
      if (cls === 'calibre_text_gangmu_wn') {
        var dayMatch = text.match(/周[\s\u3000]*([一二三四五六])/);
        if (dayMatch) {
          currentDayCn = dayMatch[1];
          mode = 'outline';
        }
        continue;
      }

      // 注意："信息选读" 和 "参读" 的文字检测必须在 class 检测之前，
      // 因为 "信息选读" 的 class 也是 calibre_text_chenxing_content_wyxd

      // 检测"信息选读"区域开始
      if (/^信息选读/.test(text)) {
        mode = 'msgread';
        continue;
      }

      // 检测"参读"区域开始
      if (/^参读/.test(text)) {
        mode = 'refread';
        // 保留完整文本含 "参读：" 前缀，与 TXT extractMrDayContent 一致
        if (text !== '参读' && text !== '参读：' && text !== '参读:') {
          refReading.push(text);
        }
        continue;
      }

      // 检测"晨兴喂养"区域开始（class 检测放在文字检测之后）
      if (/晨兴喂养/.test(text) || cls === 'calibre_text_chenxing_content_wyxd') {
        mode = 'feeding';
        continue;
      }

      // 大纲区域
      if (mode === 'outline') {
        // 带圈层级前缀（㈠㈡㈢…/⑴⑵⑶…）即使挂在跳过类上也是真大纲节点，按前缀放行
        var circledLevel = text.length > 1 &&
          (LEVEL5_CHARS.indexOf(text[0]) >= 0 || LEVEL6_CHARS.indexOf(text[0]) >= 0);

        // 跳过非大纲段落（经文、晨兴内容、诗歌等），与 parseOutlineFromHtml 保持一致
        if (!circledLevel &&
            (cls === 'calibre_zongti' || cls === 'calibre_content_title' ||
            cls === 'calibre_text_verse' || cls === 'calibre_verse' ||
            cls === 'calibre_text_chenxing_content' ||
            cls === 'calibre_text_chenxing_verse' || cls === 'calibre_text_chenxing_content_wyxd' ||
            cls === 'calibre_text_chenxing_content_wn' || cls === 'calibre_text_gangmu_wn' ||
            cls === 'calibre_text_hymns' || cls === 'calibre_index_chapter' ||
            cls === 'calibre_index_title1' || cls === 'calibre_text_abs' ||
            cls === 'calibre_text_abs_dadian' || cls === 'calibre_text_abs_zhongdian' ||
            cls === 'calibre_text_abs_xiaodian' || cls === 'calibre_e_text_dadian' ||
            cls === 'calibre_e_text_zhongdian' || cls === 'calibre_e_text_xiaodian')) {
          continue;
        }

        var rank = 0;
        var level = '';
        var title = '';

        if (cls === 'calibre_text_dadian') {
          rank = 1;
          if (text.length > 1 && LEVEL1_CHARS.indexOf(text[0]) >= 0) {
            level = text[0]; title = text.slice(1).replace(/^[\s\u3000]+/, '');
          } else { level = ''; title = text; }
        } else if (cls === 'calibre_text_zhongdian') {
          rank = 2;
          if (text.length > 1 && LEVEL2_CHARS.indexOf(text[0]) >= 0) {
            level = text[0]; title = text.slice(1).replace(/^[\s\u3000]+/, '');
          } else { level = ''; title = text; }
        } else if (cls === 'calibre_text_xiaodian') {
          rank = 3;
          var m3 = text.match(/^(\d+)[.。\s\u3000]+(.*)/);
          if (m3) { level = m3[1]; title = m3[2]; }
          else { level = ''; title = text; }
        } else {
          // 未知类名 — 尝试按文本前缀匹配更深层级
          var m4 = text.match(/^([a-z])[.\s\u3000]+(.*)/);
          if (m4) {
            rank = 4; level = m4[1]; title = m4[2];
          } else if (text.length > 1 && LEVEL5_CHARS.indexOf(text[0]) >= 0) {
            rank = 5; level = text[0]; title = text.slice(1).replace(/^[\s\u3000]+/, '');
          } else if (text.length > 1 && LEVEL6_CHARS.indexOf(text[0]) >= 0) {
            rank = 6; level = text[0]; title = text.slice(1).replace(/^[\s\u3000]+/, '');
          }
        }

        if (rank > 0) {
          title = title.replace(/\u2500引用经文$/, '');
          var node = { level: level, title: title, content: [], children: [] };
          while (stack.length && stack[stack.length - 1].rank >= rank) stack.pop();
          if (stack.length) stack[stack.length - 1].node.children.push(node);
          else outlineNodes.push(node);
          stack.push({ rank: rank, node: node });
          continue;
        }

        // 非层级段落 → 作为栈顶节点的 content 或忽略
        if (stack.length) {
          stack[stack.length - 1].node.content.push(text);
        }
        continue;
      }

      // 晨兴喂养区域
      if (mode === 'feeding') {
        if (cls === 'calibre_text_chenxing_verse') {
          feedingScriptures.push(text);
        } else if (cls === 'calibre_text_chenxing_content' || cls === 'calibre_text_chenxing_content_wyxd') {
          morningFeeding.push(text);
        } else {
          morningFeeding.push(text);
        }
        continue;
      }

      // 信息选读区域
      if (mode === 'msgread') {
        messageReading.push(text);
        continue;
      }

      // 参读区域
      if (mode === 'refread') {
        refReading.push(text);
        continue;
      }
    }

    // 修复：上面的 outline 逻辑中 currentNode 未定义，改用 stack 末尾
    // 重新扫描大纲区域的非层级段落
    // (已在循环中处理)

    return {
      day: dayLabel || '',
      outline: outlineNodes,
      feeding_scriptures: feedingScriptures,
      morning_feeding: morningFeeding,
      message_reading: messageReading,
      ref_reading: refReading
    };
  }

  // ── 诗歌解析 ─────────────────────────────────────────────────────────────

  /**
   * 解析 _h_hymn.htm 中的诗歌信息。
   * 返回 { hymnNumber, hymnImage, hymnLyrics }
   */
  function parseHymnFromHtml(doc, zip, msgNum, opfDir) {
    var body = doc.querySelector('body');
    if (!body) return { hymnNumber: '', hymnImage: '', hymnLyrics: [] };

    // 提取诗歌图片路径
    var imgEl = body.querySelector('img');
    var hymnImage = '';
    if (imgEl) {
      var src = imgEl.getAttribute('src') || '';
      if (src) hymnImage = msgNum + '_hymn.png';
    }

    // 提取诗歌歌词（保留换行）
    var lyrics = [];
    var hymnPs = body.querySelectorAll('.calibre_text_hymns');
    for (var i = 0; i < hymnPs.length; i++) {
      var t = pTextWithBreaks(hymnPs[i]);
      if (t) lyrics.push(t);
    }

    // 提取标题中的诗歌编号
    var titleEl = doc.querySelector('.calibre_content_title');
    var hymnNumber = '';
    if (titleEl) {
      var tm = (titleEl.textContent || '').match(/诗歌[：:]\s*(.*)/);
      if (tm) hymnNumber = tm[1].trim();
    }

    // 也尝试从第一个 hymn 段落中提取编号
    // 格式可能是 "1　歌词" 或 "补充本431首" 开头
    if (!hymnNumber && hymnPs.length) {
      var firstHymn = pText(hymnPs[0]);
      var hymnNumM = firstHymn.match(/^(?:补充[本]?|大[本]?|新[本]?)\s*(\d+[首]?|\d+)/);
      if (hymnNumM) hymnNumber = hymnNumM[0];
    }

    return { hymnNumber: hymnNumber, hymnImage: hymnImage, hymnLyrics: lyrics };
  }

  // ── 标语解析 ─────────────────────────────────────────────────────────────

  /**
   * 解析 banner.html 中的标语。
   * 返回中文标语列表（去除英文翻译）
   */
  function parseMottosFromHtml(doc) {
    var body = doc.querySelector('body');
    if (!body) return [];

    var mottos = [];
    var bannerEls = body.querySelectorAll('.banner, p.banner');
    if (!bannerEls.length) {
      // 回退：查找所有非标题段落
      bannerEls = body.querySelectorAll('p');
    }

    for (var i = 0; i < bannerEls.length; i++) {
      var el = bannerEls[i];
      // 取中文部分（<br/> 前的文本）
      var fullText = (el.textContent || '').trim();
      if (!fullText) continue;
      // 中文标语通常在第一行，英文在 <span class="grayW"> 中
      // 直接用 innerHTML 分割更准确
      var html = el.innerHTML || '';
      var lines = html.split(/<br\s*\/?>/i);
      if (lines.length > 0) {
        // 第一行是中文标语（纯文本，可能含 HTML 实体）
        var cnText = lines[0].replace(/<[^>]+>/g, '').replace(/&[^;]+;/g, function(e) {
          var map = {'&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'"};
          return map[e] || e;
        }).trim();
        if (cnText) mottos.push(cnText);
      }
    }

    return mottos;
  }

  // ── 目录解析 ─────────────────────────────────────────────────────────────

  /**
   * 解析 index.html 中的目录，提取各篇标题和链接。
   * 返回 [{ number, title, links: { dg, cv, ce, ts, h } }]
   */
  function parseTocFromHtml(doc) {
    var body = doc.querySelector('body');
    if (!body) return [];

    var entries = [];
    var chapterEls = body.querySelectorAll('.calibre_index_chapter');

    for (var i = 0; i < chapterEls.length; i++) {
      var el = chapterEls[i];
      // 第一个 <b> 标签包含篇章标题
      var bEl = el.querySelector('b');
      var titleText = bEl ? (bEl.textContent || '').trim() : '';
      if (!titleText) continue;

      // 解析 "第N篇　标题" / "第N周　标题"
      var m = titleText.match(/^第([一二三四五六七八九十]+)[篇周][\s\u3000]*(.*)/);
      var cnNum = m ? m[1] : '';
      var title = m ? m[2].trim() : titleText;
      var num = cnOrdToInt(cnNum);

      // 提取链接
      var links = {};
      var anchors = el.querySelectorAll('a.calibre_hyperlinks');
      for (var j = 0; j < anchors.length; j++) {
        var a = anchors[j];
        var href = a.getAttribute('href') || '';
        var linkText = (a.textContent || '').trim();
        if (linkText === '大纲') links.dg = href;
        else if (linkText === '纲目') links.cv = href;
        else if (linkText.indexOf('中英对照') >= 0) links.ce = href;
        else if (linkText === '听抄') links.ts = href;
        else if (linkText === '晨兴') links.h = href.replace(/\.htm.*$/, '.htm');
      }

      entries.push({ number: num || (i + 1), cnNum: cnNum, title: title, links: links });
    }

    return entries;
  }

  // ── 图片提取 ─────────────────────────────────────────────────────────────

  /**
   * 从 ZIP 中提取指定图片为 base64 data URL
   */
  function extractImageAsDataUrl(zip, imgPath) {
    var entry = zip.file(imgPath);
    if (!entry) return Promise.resolve('');
    return entry.async('base64').then(function (b64) {
      var ext = imgPath.split('.').pop().toLowerCase();
      var mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
      return 'data:' + mime + ';base64,' + b64;
    });
  }

  // ── 主解析逻辑 ───────────────────────────────────────────────────────────

  /**
   * 解析单个 EPUB 文件，返回训练数据对象数组。
   * 通常一个 EPUB 对应一个训练。
   *
   * file: File 对象（来自 <input type="file">）
   * onProgress: function(done, total, msg)
   *
   * 返回 Promise<{count, paths}>
   */
  function parseAndSave(file, onProgress) {
    if (!win.JSZip) {
      return loadJSZip().then(function () { return parseAndSave(file, onProgress); });
    }

    var zip;
    return readFileAsArrayBuffer(file).then(function (arrayBuf) {
      if (onProgress) onProgress(0, 5, '解压 EPUB…');
      /* 预校验：EPUB 本质是 ZIP，必须以 PK 魔数 (0x504B) 开头。
         避免将非 ZIP 文件传给 JSZip 导致晦涩的 "Can't find end of central directory" 错误。 */
      if (!arrayBuf || arrayBuf.byteLength < 4) {
        throw new Error('文件内容为空或过小，不是有效的 EPUB 文件');
      }
      var view = new Uint8Array(arrayBuf);
      if (view[0] !== 0x50 || view[1] !== 0x4B) {
        throw new Error('文件不是有效的 EPUB 格式（缺少 ZIP 文件头），请确认文件未损坏');
      }
      return new win.JSZip().loadAsync(arrayBuf);
    }).then(function (z) {
      zip = z;
      if (onProgress) onProgress(1, 5, '解析 EPUB 结构…');
      return parseEpubStructure(zip);
    }).then(function (epub) {
      if (onProgress) onProgress(2, 5, '读取目录…');

      // 1. 读取目录 (index.html)
      var indexPath = epub.opfDir + 'index.html';
      return zipReadText(zip, indexPath).then(function (indexHtml) {
        if (!indexHtml) throw new Error('找不到目录文件 (index.html)');
        var indexDoc = parseHtmlDoc(indexHtml);
        var tocEntries = parseTocFromHtml(indexDoc);

        // 2. 读取标语 (banner.html)
        if (onProgress) onProgress(2, 5, '读取标语…');
        var bannerPath = epub.opfDir + 'banner.html';
        return zipReadText(zip, bannerPath).then(function (bannerHtml) {
          var mottos = [];
          if (bannerHtml) {
            var bannerDoc = parseHtmlDoc(bannerHtml);
            mottos = parseMottosFromHtml(bannerDoc);
          }

          // 3. 从 OPF 元数据或目录中提取训练标题
          var metaTitle = epub.metadata.title || file.name.replace(/\.epub$/i, '');
          // 从 index.html 的 <h1> 提取更准确的训练名
          var h1 = indexDoc.querySelector('.calibre_index_title1, h1');
          if (h1) {
            var h1Text = (h1.textContent || '').trim();
            if (h1Text) metaTitle = h1Text;
          }

          // 4. 提取年份和序号
          var year = extractYearFromTitle(metaTitle) || extractYearFromTitle(file.name) || new Date().getFullYear();
          // 从文件名 "2026-4-JST.epub" 或标题 "六月半年度训练" 尝试推断序号
          var seq = extractSeqFromFilename(file.name) || extractSeqFromTitle(metaTitle) || 1;

          // 5. 确定训练 path 和 season
          var seqStr = seq < 10 ? '0' + seq : '' + seq;
          var path = 'local-' + year + '-' + seqStr;
          var shortTitle = getShortTitle(metaTitle);
          var season = seqStr + ' ' + shortTitle;

          // 6. 解析各篇章
          if (onProgress) onProgress(3, 5, '解析篇章…');
          var chapters = [];
          var totalEntries = tocEntries.length;
          var chapterPromises = tocEntries.map(function (entry, idx) {
            return parseChapterFromZip(zip, epub, entry, idx, totalEntries);
          });

          return Promise.all(chapterPromises).then(function (chList) {
            chapters = chList.filter(Boolean);

            // 7. 构建训练对象
            var trainingData = {
              path: path,
              title: shortTitle,
              subtitle: extractSubtitle(indexDoc) || epub.metadata.subject || '',
              year: year,
              season: season,
              mottos: mottos,
              motto_song_text: '',
              motto_song_image: '',
              chapters: chapters,
              version: getNowVersion()
            };

            // 8. 存储
            if (onProgress) onProgress(4, 5, '保存数据…');
            return saveTraining(trainingData);
          }).then(function (savedPath) {
            if (onProgress) onProgress(5, 5, '完成');
            return { count: 1, paths: [savedPath] };
          });
        });
      });
    });
  }

  /**
   * 解析单个篇章的所有子页面（纲目、听抄、晨兴、诗歌）
   */
  function parseChapterFromZip(zip, epub, entry, idx, total) {
    var opfDir = epub.opfDir;
    var links = entry.links || {};
    var msgNum = entry.number || (idx + 1);

    // 优先级：_cv.htm（完整纲目）> _dg.htm（仅大纲）
    // _cv.htm 末尾还包含"职事信息摘录"，需要一并提取
    var outlinePromise = Promise.resolve([]);
    var scripturePromise = Promise.resolve('');
    var ministryExcerptPromise = Promise.resolve('');
    if (links.cv) {
      outlinePromise = zipReadText(zip, opfDir + links.cv).then(function (html) {
        if (!html) return [];
        var doc = parseHtmlDoc(html);
        scripturePromise = Promise.resolve(extractScripture(doc));
        ministryExcerptPromise = Promise.resolve(parseMinistryExcerptFromHtml(doc));
        return parseOutlineFromHtml(doc);
      });
    } else if (links.dg) {
      outlinePromise = zipReadText(zip, opfDir + links.dg).then(function (html) {
        if (!html) return [];
        return parseOutlineFromHtml(parseHtmlDoc(html));
      });
    }

    // 晨兴：6 天
    var mrPromise = Promise.resolve([]);
    var dayCns = ['一','二','三','四','五','六'];
    if (links.h) {
      var mrFiles = [];
      for (var d = 1; d <= 6; d++) {
        mrFiles.push(links.h.replace(/\.htm$/, '_h_' + d + '.htm'));
      }
      // 也支持 _h_1.htm 直接链接格式
      // 尝试多种路径
      var mrPromises = dayCns.map(function (dayCn, dIdx) {
        var dayLabel = '周' + dayCn;
        // 尝试 {N}_h_{d+1}.htm
        var hFile = opfDir + msgNum + '_h_' + (dIdx + 1) + '.htm';
        return zipReadText(zip, hFile).then(function (html) {
          if (!html) return null;
          return parseMorningRevivalFromHtml(parseHtmlDoc(html), dayLabel);
        });
      });
      mrPromise = Promise.all(mrPromises).then(function (results) {
        return results.filter(Boolean);
      });
    }

    // 诗歌
    var hymnPromise = Promise.resolve({ hymnNumber: '', hymnImage: '', hymnLyrics: [], hymnImages: [] });
    var hymnFile = opfDir + msgNum + '_h_hymn.htm';
    hymnPromise = zipReadText(zip, hymnFile).then(function (html) {
      if (!html) return { hymnNumber: '', hymnImage: '', hymnLyrics: [], hymnImages: [] };
      var info = parseHymnFromHtml(parseHtmlDoc(html), zip, msgNum, opfDir);
      // 从 ZIP 中提取诗歌图片为 data URL（浏览器端本地导入时需要内嵌图片数据）
      if (!info.hymnImage) return Object.assign(info, { hymnImages: [] });
      var imgPath = opfDir + info.hymnImage;
      return extractImageAsDataUrl(zip, imgPath).then(function (dataUrl) {
        info.hymnImages = dataUrl ? [dataUrl] : [];
        return info;
      });
    });

    return outlinePromise.then(function (outlineSections) {
      // 听抄需要 outlineSections 来做纲目匹配，所以在这里初始化
      var transcriptResolved;
      if (links.ts) {
        transcriptResolved = zipReadText(zip, opfDir + links.ts).then(function (html) {
          if (!html) return { detailSections: [], messageContent: [], ministryExcerpt: '' };
          return parseTranscriptFromHtml(parseHtmlDoc(html), outlineSections);
        });
      } else {
        transcriptResolved = Promise.resolve({ detailSections: [], messageContent: [], ministryExcerpt: '' });
      }
      return scripturePromise.then(function (scripture) {
        return transcriptResolved.then(function (transcript) {
          return mrPromise.then(function (morningRevivals) {
            return hymnPromise.then(function (hymnInfo) {
              // 若无听抄 detailSections，是否用 outlineSections 作为 detail（纲目侵入听抄）
              // 由 config.yaml 的 use_outline_fallback 控制（remote-config.js 下发），默认不侵入
              var useOutlineFallback = !!(win.CX_SERVERS && win.CX_SERVERS.useOutlineFallback);
              var detailSections = (transcript.detailSections.length > 0 || !useOutlineFallback)
                ? transcript.detailSections
                : outlineSections;

              // 职事摘录优先取 _cv.htm 中提取的内容，回退到听抄中的（通常为空）
              return ministryExcerptPromise.then(function(cvMinistryExcerpt) {
                return {
                  number: msgNum,
                  title: entry.title,
                  hymn_number: hymnInfo.hymnNumber,
                  hymn_image: hymnInfo.hymnImage,
                  hymn_lyrics: hymnInfo.hymnLyrics,
                  hymn_images: hymnInfo.hymnImages || [],
                  scripture: scripture,
                  outline_sections: outlineSections,
                  detail_sections: detailSections,
                  has_listen_block: transcript.detailSections.length > 0,
                  message_content: transcript.messageContent,
                  ministry_excerpt: cvMinistryExcerpt || transcript.ministryExcerpt,
                  morning_revivals: morningRevivals
                };
              });
            });
          });
        });
      });
    });
  }

  // ── 辅助函数 ─────────────────────────────────────────────────────────────

  function extractYearFromTitle(title) {
    // 尝试匹配 "二〇二六年" 等中文年份
    var m = title.match(/([一二三四五六七八九○〇零两]{4})年/);
    if (!m) {
      // 尝试匹配阿拉伯数字年份
      m = title.match(/(\d{4})/);
    }
    if (!m) return null;
    var s = m[1];
    var cnDigitMap = {
      '一':'1','二':'2','三':'3','四':'4','五':'5',
      '六':'6','七':'7','八':'8','九':'9',
      '○':'0','〇':'0','零':'0','两':'2'
    };
    if (/[一二三四五六七八九○〇零两]/.test(s)) {
      var digits = '';
      for (var i = 0; i < s.length; i++) {
        digits += cnDigitMap[s[i]] || '0';
      }
      var y = parseInt(digits, 10);
      return y > 1900 && y < 2100 ? y : null;
    }
    var y = parseInt(s, 10);
    return y > 1900 && y < 2100 ? y : null;
  }

  /** 从文件名 "2026-4-JST.epub" 中提取序号 */
  function extractSeqFromFilename(filename) {
    // 匹配 "2026-4-JST" 或 "2026-04-JST" 格式
    var m = filename.match(/(\d{4})-(\d+)/);
    if (m) {
      var seq = parseInt(m[2], 10);
      if (seq >= 1 && seq <= 12) return seq;
    }
    return null;
  }

  /** 从标题 "六月半年度训练" 中推断序号（月份→季度映射） */
  function extractSeqFromTitle(title) {
    // 月份→季度映射：1-3月→1, 4-6月→2, 7-9月→3, 10-12月→4
    var monthMap = {
      '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,
      '七':7,'八':8,'九':9,'十':10,'十一':11,'十二':12
    };
    var m = title.match(/([一二三四五六七八九十]+)月/);
    if (m && monthMap[m[1]]) {
      var month = monthMap[m[1]];
      return Math.ceil(month / 3); // 月份→季度
    }
    // 直接匹配 "四月"、"七月" 等带"半年度"/"夏季"等
    if (/春季/.test(title) || /一月至三月/.test(title)) return 1;
    if (/夏季/.test(title) || /四月至六月/.test(title)) return 2;
    if (/秋季/.test(title) || /七月至九月/.test(title)) return 3;
    if (/冬季/.test(title) || /十月至十二月/.test(title)) return 4;
    return null;
  }

  function getShortTitle(header) {
    if (!header) return '';
    // 去掉4字年份前缀
    var yearM = header.match(/^[一二三四五六七八九○〇零两\d]{4}年?/);
    var short = yearM ? header.slice(yearM[0].length).trim() : header.trim();
    // 去掉合辑标题中的"、B年XXX"后缀
    short = short.replace(/、[一二三四五六七八九○〇零]{4}年.+$/, '').trim();
    return short;
  }

  function extractSubtitle(indexDoc) {
    var zongti = indexDoc.querySelector('.calibre_zongti');
    if (!zongti) return '';
    var text = (zongti.textContent || '').trim();
    text = text.replace(/^总题[：:]\s*/, '');
    var lines = text.split('\n');
    return lines[0].trim();
  }

  function readFileAsArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function (e) { resolve(e.target.result); };
      reader.onerror = function () { reject(new Error('文件读取失败')); };
      reader.readAsArrayBuffer(file);
    });
  }

  function loadJSZip() {
    return new Promise(function (resolve, reject) {
      if (win.JSZip) { resolve(); return; }
      var s = document.createElement('script');
      s.src = (win.CX_ROOT || './') + 'vendor/jszip.min.js';
      s.onload = resolve;
      s.onerror = function () { reject(new Error('JSZip 加载失败')); };
      document.head.appendChild(s);
    });
  }

  // ── 存储（与 txt-importer.js 共享 localforage 键）─────────────────────────

  function saveTraining(trainingData) {
    return new Promise(function (resolve, reject) {
      if (!win.localforage) {
        reject(new Error('localforage 未加载'));
        return;
      }
      var indexPath = trainingData.path;

      // 1. 保存训练数据
      win.localforage.setItem(STORE_PREFIX + indexPath, trainingData).then(function () {
        // 2. 更新索引
        return win.localforage.getItem(STORE_INDEX);
      }).then(function (existing) {
        var imports = existing || [];
        // 检查是否已存在
        var found = false;
        for (var i = 0; i < imports.length; i++) {
          if (imports[i].path === indexPath) {
            imports[i].title = trainingData.title;
            imports[i].subtitle = trainingData.subtitle || '';
            imports[i].year = trainingData.year;
            imports[i].season = trainingData.season;
            imports[i].chapter_count = (trainingData.chapters || []).length;
            imports[i].importedAt = Date.now();
            imports[i].source = 'epub';
            imports[i].is_local = true;
            found = true;
            break;
          }
        }
        if (!found) {
          imports.push({
            path: indexPath,
            title: trainingData.title,
            subtitle: trainingData.subtitle || '',
            year: trainingData.year,
            season: trainingData.season,
            chapter_count: (trainingData.chapters || []).length,
            is_local: true,
            importedAt: Date.now(),
            source: 'epub'
          });
        }
        return win.localforage.setItem(STORE_INDEX, imports);
      }).then(function () {
        resolve(indexPath);
      }).catch(function (err) {
        reject(err);
      });
    });
  }

  /**
   * 从 ArrayBuffer 解析 EPUB 并返回 trainingData（不存储）。
   * 用于 Node.js 构建脚本，跳过 FileReader 和动态加载 JSZip。
   *
   * @param {ArrayBuffer} arrayBuf - EPUB 文件的 ArrayBuffer
   * @param {string} fileName - 文件名（用于提取年份/序号）
   * @param {Function} [onProgress] - 进度回调
   * @returns {Promise<object>} trainingData
   */
  function parseFromBuffer(arrayBuf, fileName, onProgress) {
    var zip;
    if (onProgress) onProgress(0, 5, '解压 EPUB…');
    return new win.JSZip().loadAsync(arrayBuf).then(function (z) {
      zip = z;
      if (onProgress) onProgress(1, 5, '解析 EPUB 结构…');
      return parseEpubStructure(zip);
    }).then(function (epub) {
      if (onProgress) onProgress(2, 5, '读取目录…');
      var indexPath = epub.opfDir + 'index.html';
      return zipReadText(zip, indexPath).then(function (indexHtml) {
        if (!indexHtml) throw new Error('找不到目录文件 (index.html)');
        var indexDoc = parseHtmlDoc(indexHtml);
        var tocEntries = parseTocFromHtml(indexDoc);
        if (onProgress) onProgress(2, 5, '读取标语…');
        var bannerPath = epub.opfDir + 'banner.html';
        return zipReadText(zip, bannerPath).then(function (bannerHtml) {
          var mottos = [];
          if (bannerHtml) {
            var bannerDoc = parseHtmlDoc(bannerHtml);
            mottos = parseMottosFromHtml(bannerDoc);
          }
          var metaTitle = epub.metadata.title || (fileName || '').replace(/\.epub$/i, '');
          var h1 = indexDoc.querySelector('.calibre_index_title1, h1');
          if (h1) {
            var h1Text = (h1.textContent || '').trim();
            if (h1Text) metaTitle = h1Text;
          }
          var year = extractYearFromTitle(metaTitle) || extractYearFromTitle(fileName || '') || new Date().getFullYear();
          var seq = extractSeqFromFilename(fileName || '') || extractSeqFromTitle(metaTitle) || 1;
          var seqStr = seq < 10 ? '0' + seq : '' + seq;
          var path = 'local-' + year + '-' + seqStr;
          var shortTitle = getShortTitle(metaTitle);
          var season = seqStr + ' ' + shortTitle;
          if (onProgress) onProgress(3, 5, '解析篇章…');
          var chapters = [];
          var chapterPromises = tocEntries.map(function (entry, idx) {
            return parseChapterFromZip(zip, epub, entry, idx, tocEntries.length);
          });
          return Promise.all(chapterPromises).then(function (chList) {
            chapters = chList.filter(Boolean);
            var trainingData = {
              path: path,
              title: shortTitle,
              subtitle: extractSubtitle(indexDoc) || epub.metadata.subject || '',
              year: year,
              season: season,
              mottos: mottos,
              motto_song_text: '',
              motto_song_image: '',
              chapters: chapters,
              version: getNowVersion()
            };
            if (onProgress) onProgress(5, 5, '完成');
            return trainingData;
          });
        });
      });
    });
  }

  // ── 委托 CXLocalImport 的方法 ─────────────────────────────────────────────

  function listImports() {
    if (win.CXLocalImport) return win.CXLocalImport.listImports();
    return win.localforage ? win.localforage.getItem(STORE_INDEX).then(function (v) { return v || []; }) : Promise.resolve([]);
  }

  function deleteImport(path) {
    if (win.CXLocalImport) return win.CXLocalImport.deleteImport(path);
    return win.localforage.removeItem(STORE_PREFIX + path);
  }

  function getTraining(path) {
    if (win.CXLocalImport) return win.CXLocalImport.getTraining(path);
    return win.localforage ? win.localforage.getItem(STORE_PREFIX + path) : Promise.resolve(null);
  }

  // ── 公开 API ─────────────────────────────────────────────────────────────

  win.CXEpubImport = {
    parseAndSave: parseAndSave,
    parseFromBuffer: parseFromBuffer,
    listImports: listImports,
    deleteImport: deleteImport,
    getTraining: getTraining
  };

}(window));
