/*!
 * txt-importer.js — 本地 TXT 训练文件导入
 *
 * 支持两种格式：
 *   1. 独立训练文件 (如 2026-1-ICSC.txt)：文件名 {year}-{seq}-... 格式
 *   2. 历史大合辑文件 (如 97-25-特会合辑.txt)：单文件内含多个训练
 *
 * 存储：
 *   localforage key 'cx_local_imports' → [{path, title, year, season, chapter_count, importedAt}]
 *   localforage key 'cx_local_train_{path}' → training JSON
 *   path 格式：local-{year}-{seq:02d}
 *
 * 暴露：window.CXLocalImport
 *   .parseAndSave(text, filename, onProgress)  → Promise<{count, paths}>
 *   .listImports()                              → Promise<Array>
 *   .deleteImport(path)                         → Promise<void>
 *   .getTraining(path)                          → Promise<trainingData|null>
 */
(function (win) {
  'use strict';

  // ── 常量 ──────────────────────────────────────────────────────────────────

  var STORE_INDEX = 'cx_local_imports';
  var STORE_PREFIX = 'cx_local_train_';
  var SCRIPTURES_PREFIX = 'cx_local_scriptures_';

  // ── 内联经文提取（用于本地导入时生成补充经文数据）──────────────────────────

  // 匹配独占一行的经文引用 key（移植自 Python 的 _VERSE_KEY_RE）
  var VERSE_KEY_RE = /^([创出利民申书士得撒王代拉尼斯伯诗箴传歌赛耶哀结但何珥摩俄拿弥鸿哈番该亚玛太可路约徒罗林加弗腓西帖提门多彼约犹启来](?:[一二三四五六七八九十后前上下壹贰叁]\d+|\d+):\d+[上中下]?)\s*$/;

  /** 扫描 TXT 行，返回 { key → verseText } 映射（2024+ 格式的内联经文）。 */
  function collectInlineVerses(lines) {
    var verseDict = {};
    var prevKey = null;
    for (var i = 0; i < lines.length; i++) {
      var s = lines[i].trim();
      if (!s) { prevKey = null; continue; }
      var m = VERSE_KEY_RE.exec(s);
      if (m) {
        prevKey = m[1];
      } else if (prevKey !== null) {
        if (!verseDict[prevKey]) verseDict[prevKey] = s;
        prevKey = null;
      } else {
        prevKey = null;
      }
    }
    return verseDict;
  }

  // 中文层级字符集（与 split_trainings.py 保持一致）
  var LEVEL1_CHARS = '壹贰叁肆伍陆柒捌玖拾';
  var LEVEL2_CHARS = '一二三四五六七八九十';
  var LEVEL3_FW = '１２３４５６７８９０';
  var LEVEL5_CHARS = '㈠㈡㈢㈣㈤㈥㈦㈧㈨㈩';

  // 中文数字映射
  var CN_DIGIT_MAP = {
    '一':'1','二':'2','三':'3','四':'4','五':'5',
    '六':'6','七':'7','八':'8','九':'9',
    '○':'0','〇':'0','零':'0','两':'2'
  };

  var CN_ORD_MAP = {
    '一':1,'二':2,'三':3,'四':4,'五':5,
    '六':6,'七':7,'八':8,'九':9,'十':10,
    '十一':11,'十二':12,'十三':13,'十四':14,'十五':15,
    '十六':16,'十七':17,'十八':18,'十九':19,'二十':20
  };

  // ── 工具函数 ─────────────────────────────────────────────────────────────

  function cnOrdToInt(cn) {
    if (!cn) return 0;
    if (CN_ORD_MAP[cn]) return CN_ORD_MAP[cn];
    // 复合数 X十Y
    if (cn.indexOf('十') >= 0) {
      var parts = cn.split('十');
      var tens = (parts[0] ? (CN_ORD_MAP[parts[0]] || 1) : 1) * 10;
      var units = parts[1] ? (CN_ORD_MAP[parts[1]] || 0) : 0;
      var v = parseInt(parts[0] || '') || 0;
      // 纯 "十" → 10；"十一" → 11；"三十七" → 37
      var ten_dig = CN_ORD_MAP[parts[0]];
      if (!parts[0]) tens = 10;
      else tens = (ten_dig || 1) * 10;
      units = parts[1] ? (CN_ORD_MAP[parts[1]] || 0) : 0;
      return tens + units;
    }
    return CN_ORD_MAP[cn] || 0;
  }

  /** 从标题行（如"二〇二六年国际华语特会"）提取年份 */
  function cnYearToInt(header) {
    // 优先匹配标题开头的4字年份（可能没有「年」后缀，如跨年范围 "二○一○秋季至..."）
    var mHead = header.match(/^([一二三四五六七八九○〇零]{4})/);
    var m = mHead || header.match(/([一二三四五六七八九○〇零]{4})年/);
    if (!m) return null;
    var s = m[1].split('').map(function(c){ return CN_DIGIT_MAP[c] || '?'; }).join('');
    if (s.indexOf('?') >= 0) return null;
    return parseInt(s, 10);
  }

  /** 是否为导航行（含 | 或 ＼ 的短行） */
  function isNavLine(s) {
    return (s.indexOf('|') >= 0 || s.indexOf('＼') >= 0) && s.length < 80;
  }

  /** 检测大纲层级，返回 {level, title} 或 null */
  function detectOutlineLevel(s) {
    if (!s) return null;
    var c0 = s[0];
    var sep = s.length > 1 ? s[1] : '';

    // Level 1: 壹贰叁...
    if (LEVEL1_CHARS.indexOf(c0) >= 0) {
      return { level: c0, title: s.slice(1).replace(/^[\u3000 \t]+/, '') };
    }
    // Level 2: 一二三...（排除年份行），支持多字符如 "十一"、"十 一"
    if (LEVEL2_CHARS.indexOf(c0) >= 0) {
      if (/^[一二三四五六七八九○〇零]{4}年/.test(s)) return null;
      var m2 = s.match(/^([一二三四五六七八九十百](?:[\u3000 \t]*[一二三四五六七八九十百])*)[\u3000 \t]+(.*)/);
      if (m2) {
        var lvl = m2[1].replace(/[\u3000 \t]/g, '');
        return { level: lvl, title: m2[2] };
      }
      return { level: c0, title: s.slice(1).replace(/^[\u3000 \t]+/, '') };
    }
    // Level 3: 全角数字 １２３
    if (LEVEL3_FW.indexOf(c0) >= 0) {
      return { level: c0, title: s.slice(1).replace(/^[\u3000 \t]+/, '') };
    }
    // Level 3: "1. " 或 "1\u3000" 格式
    var m3a = s.match(/^(\d+)[.。]\s+(.*)/);
    if (m3a) return { level: m3a[1], title: m3a[2] };
    var m3b = s.match(/^(\d+)\u3000(.*)/);
    if (m3b) return { level: m3b[1], title: m3b[2] };
    // Level 4: a. / a\u3000
    if (/^[a-z]$/.test(c0) || (c0 >= 'a' && c0 <= 'z')) {
      var ma = s.match(/^([a-z])[.\u3000 \t](.*)/);
      if (ma) return { level: ma[1], title: ma[2].trim() };
    }
    // Level 5: ㈠㈡...
    if (LEVEL5_CHARS.indexOf(c0) >= 0) {
      return { level: c0, title: s.slice(1).replace(/^[\u3000 \t]+/, '') };
    }
    return null;
  }

  function levelRank(levelStr) {
    if (!levelStr) return 4;
    if (LEVEL1_CHARS.indexOf(levelStr) >= 0) return 1;
    if (LEVEL2_CHARS.indexOf(levelStr) >= 0) return 2;
    // 多字符中点（如 "十一"、"十二"）
    if (levelStr.length > 1) {
      var allLv2 = true;
      for (var k = 0; k < levelStr.length; k++) {
        if (LEVEL2_CHARS.indexOf(levelStr.charAt(k)) < 0) { allLv2 = false; break; }
      }
      if (allLv2) return 2;
    }
    if (LEVEL3_FW.indexOf(levelStr) >= 0) return 3;
    if (/^\d+$/.test(levelStr)) return 3;
    if (LEVEL5_CHARS.indexOf(levelStr) >= 0) return 5;
    return 4; // a b c / 甲乙
  }

  /** 解析大纲行列表为 Content 树 */
  function parseCnOutline(lines) {
    var roots = [];
    var stack = []; // [{rank, node}]
    var currentNode = null;

    for (var i = 0; i < lines.length; i++) {
      var s = lines[i].trim();
      if (!s) continue;
      // 停止标记
      if (/^TOP/.test(s) || /详细信息/.test(s) || /^职事信息摘录/.test(s)) break;
      // 导航行
      if (isNavLine(s)) continue;
      // 英文大纲块
      if (/^GENERAL SUBJECT/.test(s) || /^Message (One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten)/.test(s)) break;

      var result = detectOutlineLevel(s);
      if (result) {
        var rank = levelRank(result.level);
        var node = { level: result.level, title: result.title, content: [], children: [] };
        // pop stack 到当前 rank
        while (stack.length && stack[stack.length - 1].rank >= rank) stack.pop();
        if (stack.length) {
          stack[stack.length - 1].node.children.push(node);
        } else {
          roots.push(node);
        }
        stack.push({ rank: rank, node: node });
        currentNode = node;
      } else {
        if (currentNode) currentNode.content.push(s);
      }
    }
    return roots;
  }

  // ── 单个训练 TXT 解析 ──────────────────────────────────────────────────────

  /**
   * 解析单训练 TXT 文件文本，返回 training data 对象。
   * lines: 字符串数组（文件按行拆分）
   * defaultPath: 备用 path（从文件名提取）
   */
  function parseSingleTraining(lines, defaultPath) {
    // ── 1. 分区：index 区 / detail 区 ──
    var detailStart = detectDetailStart(lines);

    // ── 2. 解析 index 区 ──
    var indexInfo = parseIndexArea(lines, 0, detailStart);

    // ── 3. 解析 detail 区 ──
    var chapters = parseDetailArea(lines, detailStart, lines.length);

    // ── 4. 构建训练对象 ──
    var year = indexInfo.year || defaultPath && parseInt((defaultPath.match(/^local-(\d{4})/) || [])[1]) || 0;
    var seq  = indexInfo.seq  || defaultPath && parseInt((defaultPath.match(/^local-\d{4}-(\d+)/) || [])[1]) || 1;
    var seqStr = seq < 10 ? '0' + seq : '' + seq;
    var shortTitle = getShortTitle(indexInfo.title);
    var season = seqStr + ' ' + shortTitle;

    // 若 chapters 为空（无 detail 区），用 index 区篇目生成空章节
    if (!chapters.length && indexInfo.msgTitles.length) {
      chapters = indexInfo.msgTitles.map(function(t, idx) {
        return makeEmptyChapter(idx + 1, t);
      });
    }

    var path = defaultPath || ('local-' + year + '-' + seqStr);

    // ── 5. 后处理：合并"第N篇"大纲 与"第N周"晨兴的分离章节 ──────────────────
    // 某些训练（如12月半年度训练）文件中，提纲区用"第一篇…第十二篇"编号，
    // 晨兴区用"第十三周…第二十四周"连续编号，导致 parseDetailArea 生成 24 章。
    // 实际文件中两类章节交替出现（第一篇→第十三周→第二篇→第十四周…）
    // 或分为前后两段，需按位置配对：提纲[i] 取对应晨兴[i] 的 morning_revivals。
    (function mergeOutlineAndMorning() {
      if (chapters.length < 2 || chapters.length % 2 !== 0) return;
      var half = chapters.length / 2;

      // 模式1：交替排列 [outline, morning, outline, morning, …]
      var isInterleaved = chapters.every(function (c, idx) {
        if (idx % 2 === 0) {
          return (c.outline_sections && c.outline_sections.length > 0) &&
                 (!c.morning_revivals || c.morning_revivals.length === 0);
        } else {
          return (!c.outline_sections || c.outline_sections.length === 0) &&
                 (c.morning_revivals && c.morning_revivals.length > 0);
        }
      });
      if (isInterleaved) {
        var merged = [];
        for (var mi = 0; mi < chapters.length; mi += 2) {
          var oc = chapters[mi], mc = chapters[mi + 1];
          oc.morning_revivals = mc.morning_revivals;
          oc.number = (mi / 2) + 1;
          merged.push(oc);
        }
        chapters = merged;
        return;
      }

      // 模式2：前后两段 [outline×N, morning×N]
      var A = chapters.slice(0, half);
      var B = chapters.slice(half);
      var aHasOutline = A.some(function (c) { return c.outline_sections && c.outline_sections.length > 0; });
      var bHasMorning = B.some(function (c) { return c.morning_revivals && c.morning_revivals.length > 0; });
      var aNoMorning  = A.every(function (c) { return !c.morning_revivals || c.morning_revivals.length === 0; });
      var bNoOutline  = B.every(function (c) { return !c.outline_sections || c.outline_sections.length === 0; });
      if (!aHasOutline || !bHasMorning || !aNoMorning || !bNoOutline) return;
      for (var si = 0; si < half; si++) {
        A[si].morning_revivals = B[si].morning_revivals;
        A[si].number = si + 1;
      }
      chapters = A;
    }());

    return {
      path: path,
      title: shortTitle,
      subtitle: indexInfo.subtitle || '',
      year: year,
      season: season,
      mottos: indexInfo.mottos || [],
      motto_song_text: indexInfo.mottoSongText || '',
      motto_song_image: '',
      chapters: chapters,
      version: getNowVersion()
    };
  }

  function makeEmptyChapter(num, title) {
    return {
      number: num,
      title: title,
      hymn_number: '',
      hymn_image: '',
      scripture: '',
      outline_sections: [],
      detail_sections: [],
      message_content: [],
      ministry_excerpt: '',
      morning_revivals: []
    };
  }

  /** 检测 detail 区起始行（0-based），完全移植 Python detect_detail_start */
  function detectDetailStart(lines) {
    var n = lines.length;
    var topLineIdx = -1; // 记录独立 TOP 行的位置
    for (var i = 0; i < n; i++) {
      var s = lines[i].trim();
      // ─{20,}\n详细信息\n─{20,}
      if (/^─{20,}$/.test(s)) {
        if (i + 1 < n && lines[i + 1].indexOf('详细信息') >= 0) {
          return Math.min(i + 3, n);
        }
      }
      // TOP-目录
      if (s === 'TOP-目录') {
        return i + 1;
      }
      // 记录独立 TOP 行（无 TOP-目录 时的后备策略）
      if (s === 'TOP' && topLineIdx < 0) {
        topLineIdx = i;
      }
    }
    // 后备：无 TOP-目录，但有独立 TOP 行 → 扫描其后的第一个中文数字章节标题
    if (topLineIdx >= 0) {
      var CN_NUM_HDR = /^第[一二三四五六七八九十百千]+[篇周]/;
      for (var j = topLineIdx + 1; j < Math.min(topLineIdx + 30, n); j++) {
        if (CN_NUM_HDR.test(lines[j].trim())) {
          return j;
        }
      }
    }
    return n; // 无 detail 区
  }

  /** 解析 index 区（0 ~ detailStart-1）提取 title/subtitle/mottos/msgTitles */
  function parseIndexArea(lines, start, end) {
    var title = '';
    var subtitle = '';
    var mottos = [];
    var mottoSongText = '';
    var msgTitles = [];
    var year = null;
    var seq = null;
    var inMotto = false;
    var inSong = false;

    for (var i = start; i < end; i++) {
      var s = lines[i].trim();
      if (!s) continue;

      // 第一行通常是训练标题
      if (!title && cnYearToInt(s) !== null) {
        title = s;
        year = cnYearToInt(s);
        continue;
      }
      if (!title && i === start) {
        title = s;
        year = cnYearToInt(s);
        continue;
      }

      // 总题
      if (!subtitle && /^总题[：:∶]?\s*/.test(s)) {
        subtitle = s.replace(/^总题[：:∶]?\s*/, '');
        continue;
      }

      // 标　语 / 标语
      if (s === '标\u3000语' || s === '标语' || s === '标　语') {
        inMotto = true; inSong = false; continue;
      }
      // 标语诗歌
      if (s === '标语诗歌' || s === '标语诗' || s === '标语歌') {
        inMotto = false; inSong = true; continue;
      }
      // TOP / TOP-目录 重置
      if (/^TOP/.test(s)) { inMotto = false; inSong = false; continue; }

      // 导航行/篇目行
      if (isNavLine(s) || /^第\d+篇/.test(s)) {
        inMotto = false; inSong = false;
        // 提取篇标题
        var mm = s.match(/^第(\d+)篇\s*(.*)/);
        if (mm) {
          msgTitles.push(mm[2].trim() || ('第' + mm[1] + '篇'));
        }
        continue;
      }

      if (inMotto) { mottos.push(s); continue; }
      if (inSong) { mottoSongText += s + '\n'; continue; }
    }

    return { title: title, subtitle: subtitle, mottos: mottos,
             mottoSongText: mottoSongText.trim(), msgTitles: msgTitles,
             year: year, seq: seq };
  }

  /** 解析 detail 区：按章标题拆分，每章解析大纲 */
  function parseDetailArea(lines, detailStart, end) {
    if (detailStart >= end) return [];

    // 找所有真正的章节 header（第X篇 / 第X周）
    var MSG_HEADER_RE = /^第([一二三四五六七八九十百千]+)[篇周]\s*(.*)/;
    var FIRST_MSG_RE = /^第一[篇周]/;
    var seenNums = {};
    var msgPositions = []; // [{idx, line, num, title}]

    for (var i = detailStart; i < end; i++) {
      var s = lines[i].trim();
      var m = MSG_HEADER_RE.exec(s);
      if (!m) continue;
      var num = cnOrdToInt(m[1]);
      if (num <= 0 || seenNums[num]) continue;

      // 验证真正的章节 header：下一非空行是 nav / 读经 / 诗歌 / TOP
      var isRealHdr = false;
      for (var j = i + 1; j < Math.min(i + 10, end); j++) {
        var nxt = lines[j].trim();
        if (!nxt) continue;
        if (isNavLine(nxt) || /^读经/.test(nxt) || /^诗歌/.test(nxt) ||
            /^TOP/.test(nxt) || (/Outline|纲目|目录/.test(nxt) && nxt.length < 60)) {
          isRealHdr = true;
        }
        break;
      }
      if (!isRealHdr) continue;

      seenNums[num] = true;
      msgPositions.push({ idx: i, num: num, cnStr: m[1], title: (m[2] || '').trim() });
    }

    var chapters = [];
    for (var k = 0; k < msgPositions.length; k++) {
      var pos = msgPositions[k];
      var endIdx = k + 1 < msgPositions.length ? msgPositions[k + 1].idx : end;
      // 包含章节 header 行本身（Python chapter_positions 也包含起始行），
      // 使 extractMorningRevivals 能在 msgLines 中找到 "第N周　标题" 纲目 header
      var msgLines = lines.slice(pos.idx, endIdx);
      var chapter = parseOneChapter(pos.num, pos.title, msgLines);
      chapters.push(chapter);
    }
    // 合并重复晨兴章节（半年度训练等格式：听抄 12篇 + 晨兴 12周，标题相同时合并）
    chapters = _mergeDuplicateMrChapters(chapters);
    return chapters;
  }

  /**
   * 规范化章节标题用于合并比对（移植自 Python _normalize_title）。
   * 去空白、统一破折号、去顿号。
   */
  function _normalizeChTitle(t) {
    return t.replace(/\s+/g, '').replace(/[─—–‐‑‒⁻₋]/g, '-').replace(/、/g, '');
  }

  /**
   * 合并重复晨兴章节：半年度训练同一内容以「听抄篇」+「晨兴周」两批呈现时，
   * 将晨兴数据合并入听抄篇，删除多余的晨兴章节。
   * 条件：无晨兴章节数 == 有晨兴章节数 >= 4 且 80%+ 标题匹配。
   * 移植自 Python _merge_duplicate_mr_chapters()。
   */
  function _mergeDuplicateMrChapters(chapters) {
    var noMr = chapters.filter(function(c) {
      return !c.morning_revivals || !c.morning_revivals.length;
    });
    var withMr = chapters.filter(function(c) {
      return c.morning_revivals && c.morning_revivals.length > 0;
    });
    // 允许计数差 ≤1：第一周无独立标题时其 MR 内容会被吸收进前一篇章节，
    // 导致 withMr 比 noMr 多 1，用 Math.abs 容错。
    if (!noMr.length || !withMr.length ||
        Math.abs(noMr.length - withMr.length) > 1 ||
        Math.min(noMr.length, withMr.length) < 4) {
      return chapters;
    }

    // 构建 withMr 标题 → 章节 映射
    var titleToMrCh = {};
    for (var i = 0; i < withMr.length; i++) {
      var key = _normalizeChTitle(withMr[i].title);
      if (!(key in titleToMrCh)) titleToMrCh[key] = withMr[i];
    }

    // 统计匹配率（80% 阈值与 Python 一致）
    var matchCount = 0;
    var noMrNorm = [];
    for (var i = 0; i < noMr.length; i++) {
      var nk = _normalizeChTitle(noMr[i].title);
      noMrNorm.push(nk);
      if (nk in titleToMrCh) matchCount++;
    }
    if (matchCount < noMr.length * 0.8) return chapters;

    // 合并：将 withMr 章节的 morning_revivals + hymn 复制到对应的 noMr 章节，删除 withMr 章节
    var toRemove = [];
    for (var i = 0; i < noMr.length; i++) {
      var src = titleToMrCh[noMrNorm[i]];
      if (src) {
        noMr[i].morning_revivals = src.morning_revivals;
        // 半年度训练：诗歌信息在晨兴章节中，合并时一并带过
        if (src.hymn_number && !noMr[i].hymn_number) {
          noMr[i].hymn_number = src.hymn_number;
        }
        toRemove.push(src);
      }
    }
    return chapters.filter(function(c) { return toRemove.indexOf(c) < 0; });
  }

  /** 解析单章节：提取 scripture/hymn，解析大纲 */
  function parseOneChapter(num, title, msgLines) {
    var scripture = '';
    var hymnNumber = '';

    // 扫描读经：通常在章节开头附近
    for (var i = 0; i < Math.min(30, msgLines.length); i++) {
      var s = msgLines[i].trim();
      if (!scripture && /^读经/.test(s)) {
        var rest = s.slice(2).replace(/^[：:∶]\s*/, '');
        if (rest) scripture = rest;
      }
    }
    // 扫描诗歌：可能在晨兴区（第N周标题之后），需扫描更大范围
    // 只匹配行首的 "诗歌：" 格式，避免匹配正文中嵌入的诗歌引用
    for (var h = 0; h < msgLines.length; h++) {
      var hs = msgLines[h].trim();
      if (/^诗歌[：:∶]/.test(hs)) {
        hymnNumber = hs.slice(2).replace(/^[：:∶]\s*/, '') || hs;
        break;
      }
    }

    // 分块解析：按 TOP / 导航行切块，分类 cn_outline / message_content
    var blocks = splitIntoBlocks(msgLines);
    var outlineSections = [];
    var detailSections = [];
    var messageContent = [];
    var hasOutline = false;
    var hasDetail = false;

    for (var b = 0; b < blocks.length; b++) {
      var block = blocks[b];
      var btype = classifyBlock(block.nav, block.lines);

      if (btype === 'cn_outline' && !hasOutline) {
        var nodes = parseCnOutline(block.lines);
        if (nodes.length) { outlineSections = nodes; hasOutline = true; }
      } else if (btype === 'message_content' && !hasDetail) {
        var parsed = parseListenBlock(block.lines);
        if (parsed.roots.length) {
          detailSections = parsed.roots;
          messageContent = parsed.pre;
          hasDetail = true;
        } else if (parsed.pre.length && !isEnglishBlock(parsed.pre)) {
          // 纯散文（非英文）
          detailSections = [{ level: '', title: '', content: parsed.pre, children: [] }];
          hasDetail = true;
        }
        // 英文散文块：跳过（与 Python 的 _is_english_block 检测一致）
      }
    }

    // 若无 detail 块（纯纲目文件 / 英文块被跳过），复用 outline 作为 detail
    if (!hasDetail) detailSections = outlineSections;

    // 无管道导航行回退（等价于 Python 的 has_pipe_nav=False 检测）：
    // 当所有块都没有含 | 的 nav 时（如1999年前格式、无块分隔的合一格式），
    // 直接扫描全部行提取大纲，相当于 Python 的 parse_cn_outline_2024 路径。
    if (!hasOutline) {
      var hasPipeNav = blocks.some(function(bl) { return bl.nav && bl.nav.indexOf('|') >= 0; });
      if (!hasPipeNav) {
        var fallbackNodes = parseCnOutline(msgLines);
        if (fallbackNodes.length) {
          outlineSections = fallbackNodes;
          detailSections = fallbackNodes;
          hasOutline = true;
        }
      }
    }

    // 后处理：若 detail 是单个纯散文节点，尝试按大纲标题拆分（移植自 Python _split_prose_by_outline）
    if (detailSections.length === 1 && !detailSections[0].level && outlineSections.length > 0) {
      var split = splitProseByOutline(detailSections[0].content, outlineSections);
      if (split.length > 1 || (split.length === 1 && split[0].level)) {
        detailSections = split;
      }
    }

    // ── 提取职事信息摘录 ──────────────────────────────────────────────
    // 扫描 msgLines，找到 "职事信息摘录：" 行，收集其后纯文本段落直到 TOP/导航行
    var ministryExcerpt = '';
    var ministryLines = [];
    var inMinistry = false;
    for (var mi = 0; mi < msgLines.length; mi++) {
      var ms = msgLines[mi].trim();
      if (!inMinistry) {
        if (ms === '职事信息摘录：' || ms === '职事信息摘录' || /^职事信息摘录[：:]?\s*$/.test(ms)) {
          inMinistry = true;
        }
        continue;
      }
      // 遇到 TOP 或导航行则结束收集
      if (/^TOP/.test(ms) || isNavLine(ms)) break;
      // 跳过空行（但保留作为段落间隔的标记）
      if (!ms) continue;
      // 过滤无效内容：纯下划线、过短无中文
      if (/^_+$/.test(ms)) continue;
      var underCount = (ms.match(/_/g) || []).length;
      if (underCount > 0 && underCount / ms.length > 0.8) continue;
      if (ms.length < 3 && !/[一-鿿]/.test(ms)) continue;
      ministryLines.push(ms);
    }
    if (ministryLines.length) {
      ministryExcerpt = ministryLines.join('\n\n');
    }

    // 提取晨兴（与 Python 的 _extract_morning_revivals 等价）
    var morningRevivals = extractMorningRevivals(msgLines);

    return {
      number: num,
      title: title,
      hymn_number: hymnNumber,
      hymn_image: '',
      scripture: scripture,
      outline_sections: outlineSections,
      detail_sections: detailSections,
      message_content: messageContent,
      has_listen_block: hasDetail,  // TXT 路径标记：是否真正解析到听抄块（无初始内容时 message_content 可能为空）
      ministry_excerpt: ministryExcerpt,
      morning_revivals: morningRevivals
    };
  }

  /** 按 TOP/导航行将行列表分成块 */
  function splitIntoBlocks(lines) {
    var blocks = [];
    var currentNav = null;
    var currentLines = [];

    for (var i = 0; i < lines.length; i++) {
      var s = lines[i].trim();
      if (/^TOP/.test(s)) {
        if (currentNav !== null || currentLines.length) {
          blocks.push({ nav: currentNav, lines: currentLines });
        }
        currentNav = null; currentLines = []; continue;
      }
      if (isNavLine(s)) {
        if (currentNav !== null || currentLines.length) {
          blocks.push({ nav: currentNav, lines: currentLines });
        }
        currentNav = s; currentLines = []; continue;
      }
      currentLines.push(lines[i]);
    }
    if (currentNav !== null || currentLines.length) {
      blocks.push({ nav: currentNav, lines: currentLines });
    }
    return blocks;
  }

  /** 根据 nav 分类块类型（移植自 _classify_block） */
  function classifyBlock(nav, lines) {
    if (!nav) return 'skip';
    if (nav.indexOf('大纲') >= 0) return 'cn_outline';
    // 纲目（无晨兴-前缀，无对照/听抄）
    var firstSeg = nav.split('|')[0].trim();
    var isZhuyin = (firstSeg === '纲目' || (firstSeg.indexOf('-纲目') >= 0 && firstSeg.indexOf('晨兴') < 0));
    if (isZhuyin && nav.indexOf('对照') < 0 && nav.indexOf('听抄') < 0) return 'cn_outline';
    // 含听抄 → 当前页是对照或纲目，skip
    if (nav.indexOf('听抄') >= 0) return 'skip';
    // 含对照但不含听抄 → 当前页是听抄
    if (nav.indexOf('对照') >= 0 && nav.indexOf('听抄') < 0) return 'message_content';
    return 'skip';
  }

  /**
   * 粗略判断行列表是否主要为英文内容（ASCII 字母占比 > 70%）。
   * 移植自 Python 的 _is_english_block。
   */
  function isEnglishBlock(lines) {
    if (!lines.length) return false;
    var sample = lines.slice(0, 3).join(' ');
    var asciiAlpha = 0, totalAlpha = 0;
    for (var i = 0; i < sample.length; i++) {
      var code = sample.charCodeAt(i);
      if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
        asciiAlpha++; totalAlpha++;
      } else if (code >= 0x4e00 && code <= 0x9fff) {
        totalAlpha++; // CJK
      }
    }
    if (totalAlpha === 0) return false;
    return asciiAlpha / totalAlpha > 0.7;
  }

  // 用于去标点的正则（移植自 Python 的 _PUNC_REMOVE）
  var _PUNC_REMOVE_RE = /[，。！？、：；…\u2014\u2500\u2015\u201c\u201d\u2018\u2019【】《》〈〉「」〔〕─—]/g;

  function puncRemove(s) { return s.replace(_PUNC_REMOVE_RE, ''); }

  /**
   * 按 nodes 的标题做单层匹配拆分，返回 [[node_or_null, [paras]]] 列表。
   * 移植自 Python 的 _split_at_level。
   */
  function splitAtLevel(proseParagraphs, nodes) {
    var keyed = [];
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.title) {
        var key = puncRemove(node.title).slice(0, 12);
        if (key && key.length >= 4) keyed.push([key, node]);
      }
    }
    if (!keyed.length) return [[null, proseParagraphs.slice()]];

    var sections = [], curNode = null, curParas = [], remaining = keyed.slice();
    for (var p = 0; p < proseParagraphs.length; p++) {
      var para = proseParagraphs[p];
      var paraKey = puncRemove(para);
      if (remaining.length) {
        var nextKey = remaining[0][0], nextNode = remaining[0][1];
        var matchLen = Math.min(paraKey.length, nextKey.length);
        if (matchLen >= 8 && paraKey.slice(0, matchLen) === nextKey.slice(0, matchLen)) {
          sections.push([curNode, curParas]);
          curNode = nextNode; curParas = []; remaining.shift(); continue;
        }
      }
      curParas.push(para);
    }
    sections.push([curNode, curParas]);
    return sections;
  }

  /**
   * 将散文段落按大纲完整树结构逐层递归拆分为 Content 节点列表。
   * 移植自 Python 的 _split_prose_by_outline。
   */
  function splitProseByOutline(proseParagraphs, outlineRoots) {
    if (!outlineRoots || !outlineRoots.length) {
      return [{ level: '', title: '', content: proseParagraphs.slice(), children: [] }];
    }
    var sections = splitAtLevel(proseParagraphs, outlineRoots);
    var hasMatch = sections.some(function(s) { return s[0] !== null; });
    if (!hasMatch) {
      return [{ level: '', title: '', content: proseParagraphs.slice(), children: [] }];
    }
    var result = [];
    for (var i = 0; i < sections.length; i++) {
      var node = sections[i][0], paras = sections[i][1];
      if (node === null) {
        if (paras.length) result.push({ level: '', title: '', content: paras, children: [] });
        continue;
      }
      if (node.children && node.children.length && paras.length) {
        var childResults = splitProseByOutline(paras, node.children);
        var intro = [], structured = [];
        for (var j = 0; j < childResults.length; j++) {
          var cr = childResults[j];
          if (!cr.level && !structured.length) intro = intro.concat(cr.content);
          else structured.push(cr);
        }
        result.push({ level: node.level, title: node.title, content: intro, children: structured });
      } else {
        result.push({ level: node.level, title: node.title, content: paras,
                      children: node.children ? node.children.slice() : [] });
      }
    }
    return result;
  }

  /** 用严格层级检测解析听抄块，返回 {pre, roots} */
  function parseListenBlock(lines) {
    var roots = [];
    var stack = [];
    var pre = [];
    var currentNode = null;

    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      var s = raw.trim();
      if (!s || /^TOP/.test(s) || isNavLine(s)) continue;
      if (/^职事信息摘录/.test(s)) break; // 职事信息摘录区开始，停止收集听抄内容
      if (/^(读经|诗歌)/.test(s)) continue; // 与 scripture/hymn banner 去重，避免重复出现在正文
      if (s.indexOf('（本文为英文听抄') >= 0) continue;
      if (s.indexOf('未经讲者审阅') >= 0) continue; // 过滤听抄免责声明行

      var result = detectOutlineLevelStrict(s);
      if (result) {
        var rank = levelRank(result.level);
        var node = { level: result.level, title: result.title, content: [], children: [] };
        while (stack.length && stack[stack.length - 1].rank >= rank) stack.pop();
        if (stack.length) stack[stack.length - 1].node.children.push(node);
        else roots.push(node);
        stack.push({ rank: rank, node: node });
        currentNode = node;
      } else {
        if (currentNode) currentNode.content.push(s);
        else pre.push(s);
      }
    }
    return { pre: pre, roots: roots };
  }

  /** 严格版层级检测（层级字后必须跟全角空格或ASCII空格/制表符） */
  function detectOutlineLevelStrict(s) {
    if (!s) return null;
    var c0 = s[0];
    var sep = s.length > 1 ? s[1] : '';

    if (LEVEL1_CHARS.indexOf(c0) >= 0) {
      if (sep === '\u3000' || sep === ' ' || sep === '\t') return { level: c0, title: s.slice(2).trim() };
      return null;
    }
    if (LEVEL2_CHARS.indexOf(c0) >= 0) {
      if (/^[一二三四五六七八九○〇零]{4}年/.test(s)) return null;
      if (sep === '\u3000' || sep === ' ' || sep === '\t') return { level: c0, title: s.slice(2).trim() };
      return null;
    }
    if (LEVEL3_FW.indexOf(c0) >= 0) {
      return { level: c0, title: s.slice(1).replace(/^[\u3000 \t]+/, '') };
    }
    var m3a = s.match(/^(\d+)[.。]\s+(.*)/);
    if (m3a) return { level: m3a[1], title: m3a[2] };
    var m3b = s.match(/^(\d+)\u3000(.*)/);
    if (m3b) return { level: m3b[1], title: m3b[2] };
    if (c0 >= 'a' && c0 <= 'z') {
      if (sep === '\u3000' || sep === ' ' || sep === '\t') return { level: c0, title: s.slice(2).trim() };
      var ma = s.match(/^([a-z])\.\s+(.*)/);
      if (ma) return { level: ma[1], title: ma[2] };
    }
    if (LEVEL5_CHARS.indexOf(c0) >= 0) {
      return { level: c0, title: s.slice(1).replace(/^[\u3000 \t]+/, '') };
    }
    return null;
  }

  // ── 晨兴（morning_revivals）解析 ──────────────────────────────────────────

  // 每日内容块 header：第N周　周X（全角空格分隔）
  var _DAY_BLOCK_HDR_RE = /^第([一二三四五六七八九十]+)周\u3000周([一二三四五六])$/;
  // 周纲目 header：第N周 [非周X标题]
  var _WEEK_HDR_RE = /^第([一二三四五六七八九十]+)周[\s\u3000]*(.*)/;
  // 每日结束标记：周X晨兴
  var _DAY_END_MR_RE = /^周[一二三四五六](?:、周[一二三四五六])*晨兴/;
  // 单日标记：周　一 等
  var _DAY_LABEL_RE = /^周[\s\u3000]*([一二三四五六])$/;
  // 晨兴喂养经文行：以书卷缩写(1-2字)+章节/节号开头
  var _FEEDING_SCRIP_RE = /^[创出利民申书士得撒王代拉尼斯伯诗箴传歌赛耶哀结但何珥摩俄拿弥鸿哈番该亚玛太可路约徒罗林加弗腓西帖提多门彼雅犹启壹贰叁前后来]{1,2}[一二三四五六七八九十\d]/;
  // 经文续行：中文章号+数字节号（无书名，如 "二1　..." / "二34~35　..."）
  var _FEEDING_SCRIP_RE_SHORT = /^[一二三四五六七八九十百]+\d/;
  // 经文续行：纯阿拉伯节号（同章续行，如 "17　..." / "11~13　..."）
  var _FEEDING_SCRIP_RE_VERSE = /^\d+([~～\-]\d+)?[\s\u3000\t]/;

  /** 判断一行是否为喂养经文行（镜像 Python _extract_feeding_scriptures 三种 pattern）*/
  function _isFeedingScripLine(s) {
    if (_FEEDING_SCRIP_RE.test(s))       return true;
    if (_FEEDING_SCRIP_RE_SHORT.test(s)) return true;
    if (_FEEDING_SCRIP_RE_VERSE.test(s)) return true;
    return false;
  }

  var _ALL_DAY_CNS = ['一','二','三','四','五','六'];
  var _CN_WEEKDAY = {'一':'周一','二':'周二','三':'周三','四':'周四','五':'周五','六':'周六'};

  /**
   * 从章节行（msgLines）提取全部 morning_revivals（6天）。
   * 与 Python 的 _extract_morning_revivals + _extract_morning_revivals_by_position 等价。
   */
  function extractMorningRevivals(msgLines) {
    var dayBlockPositions = []; // [{idx, wnum, dayCn, cnStr}]
    var weekOutlinePositions = []; // [{idx, wnum, cnStr, title}]
    var seenDayBlocks = {};
    var seenWeekKeys = {};

    for (var i = 0; i < msgLines.length; i++) {
      var s = msgLines[i].trim();
      if (!s) continue;

      // 每日块 header: 第N周　周X
      var dm = _DAY_BLOCK_HDR_RE.exec(s);
      if (dm) {
        var cnStr = dm[1], dayCn = dm[2];
        var wnum = cnOrdToInt(cnStr);
        var dkey = wnum + '_' + dayCn;
        if (wnum > 0 && !seenDayBlocks[dkey]) {
          seenDayBlocks[dkey] = true;
          dayBlockPositions.push({ idx: i, wnum: wnum, dayCn: dayCn, cnStr: cnStr });
        }
        continue;
      }

      // 周纲目 header: 第N周 [非周X标题]
      var wm = _WEEK_HDR_RE.exec(s);
      if (!wm) continue;
      var titlePart = (wm[2] || '').trim();
      // 排除"周X"子标题
      if (/^周[一二三四五六]/.test(titlePart)) continue;
      var wnum2 = cnOrdToInt(wm[1]);
      if (wnum2 <= 0) continue;

      // 验证：下一非空行须是 nav/读经/诗歌
      var isWkHdr = false;
      for (var j = i + 1; j < Math.min(i + 5, msgLines.length); j++) {
        var nxt = msgLines[j].trim();
        if (!nxt) continue;
        if (isNavLine(nxt) || /^读经/.test(nxt) || /^诗歌/.test(nxt)) isWkHdr = true;
        break;
      }
      if (!isWkHdr) continue;

      var wkey = wnum2 + '_' + titlePart.slice(0, 8);
      if (seenWeekKeys[wkey]) continue;
      seenWeekKeys[wkey] = true;
      weekOutlinePositions.push({ idx: i, wnum: wnum2, cnStr: wm[1], title: titlePart });
    }

    if (!dayBlockPositions.length && !weekOutlinePositions.length) return [];

    // 确定 cnStr（用于构建 day 标签，如 "第一周 • 周一"）
    var cnStrGlobal = dayBlockPositions.length
      ? dayBlockPositions[0].cnStr
      : weekOutlinePositions[0].cnStr;

    // 从周纲目 header 提取每天大纲
    var dayOutlines = {};
    if (weekOutlinePositions.length) {
      var outlineStart = weekOutlinePositions[0].idx + 1;
      var firstDayIdx = dayBlockPositions.length ? dayBlockPositions[0].idx : msgLines.length;
      dayOutlines = extractMrDayOutlines(msgLines.slice(outlineStart, firstDayIdx));
    } else if (dayBlockPositions.length) {
      // 周纲目紧贴在章节 header 之后（第N周　标题 本身已是章节 header，不在 msgLines 里）
      // 此时 msgLines 开头就是纲目内容，直到第一个每日块
      var firstDayIdx2 = dayBlockPositions[0].idx;
      if (firstDayIdx2 > 0) {
        dayOutlines = extractMrDayOutlines(msgLines.slice(0, firstDayIdx2));
      }
    }

    // 构建每日内容行范围
    var dayContentLines = {};
    for (var k = 0; k < dayBlockPositions.length; k++) {
      var dp = dayBlockPositions[k];
      var endIdx = k + 1 < dayBlockPositions.length ? dayBlockPositions[k + 1].idx : msgLines.length;
      dayContentLines[dp.dayCn] = msgLines.slice(dp.idx + 1, endIdx);
    }

    // 构建 6 天晨兴
    var mrs = [];
    for (var d = 0; d < _ALL_DAY_CNS.length; d++) {
      var dc = _ALL_DAY_CNS[d];
      var dayLabel = '第' + cnStrGlobal + '周 • ' + (_CN_WEEKDAY[dc] || '周' + dc);
      var content = extractMrDayContent(dayContentLines[dc] || []);
      var split = splitFeedingScriptures(content.morning_feeding_raw);
      mrs.push({
        day: dayLabel,
        outline: dayOutlines[dc] || [],
        feeding_scriptures: split.feeding_scriptures,
        morning_feeding: split.morning_feeding,
        message_reading: content.message_reading,
        ref_reading: content.ref_reading
      });
    }
    return mrs;
  }

  /** 从周纲目块行中提取每天大纲节点，返回 {dayCn: [Content节点]} */
  function extractMrDayOutlines(outlineLines) {
    var dayOutlines = {};
    var currentDays = [];
    var currentLines = [];

    function flush() {
      if (currentDays.length) {
        var nodes = parseCnOutline(currentLines);
        for (var d = 0; d < currentDays.length; d++) dayOutlines[currentDays[d]] = nodes;
      }
    }

    for (var i = 0; i < outlineLines.length; i++) {
      var s = outlineLines[i].trim();
      if (!s || isNavLine(s)) continue;
      if (/^(诗歌|读经|TOP)/.test(s) || /^(纲目|晨兴)[\s\u3000]*[\[【]/.test(s)) continue;

      // 单日标记：周一 / 周　一
      var dm = _DAY_LABEL_RE.exec(s);
      if (dm) { flush(); currentDays = [dm[1]]; currentLines = []; continue; }

      // 合并日标记：周四、周五
      var cm = /^周([一二三四五六])(?:、周([一二三四五六]))+$/.exec(s);
      if (cm) {
        flush();
        var matches = s.match(/周([一二三四五六])/g) || [];
        currentDays = matches.map(function(x) { return x[1]; });
        currentLines = [];
        continue;
      }

      if (_DAY_END_MR_RE.test(s)) { flush(); currentDays = []; currentLines = []; continue; }
      if (currentDays.length) currentLines.push(outlineLines[i]);
    }
    flush();
    return dayOutlines;
  }

  /** 从每日内容块行中提取晨兴喂养/信息选读/参读，返回对象 */
  function extractMrDayContent(blockLines) {
    var morningFeedingRaw = [];
    var messageReading = [];
    var refReading = [];
    var mode = null;

    for (var i = 0; i < blockLines.length; i++) {
      var s = blockLines[i].trim();
      if (!s) continue;
      if (s === '晨兴喂养') { mode = 'feeding'; continue; }
      if (s === '信息选读') { mode = 'msgread'; continue; }
      if (/^参读/.test(s)) {
        mode = 'refread';
        // 保留完整文本含 "参读：" 前缀，与 Python _parse_morning_revival_by_text 一致
        if (s !== '参读' && s !== '参读：' && s !== '参读:') {
          refReading.push(s);
        }
        continue;
      }
      if (isNavLine(s) || /^今日晨兴/.test(s) || /^TOP/.test(s)) continue;
      if (_DAY_BLOCK_HDR_RE.test(s)) break; // next day/chapter boundary
      if (/^第[一二三四五六七八九十百千]+篇/.test(s)) break; // chapter boundary
      // 周诗歌/Back标记 → 停止
      if (/^第[一二三四五六七八九十]+周[\s\u3000]*诗歌/.test(s) || s === 'Back') break;

      if (mode === 'feeding') morningFeedingRaw.push(s);
      else if (mode === 'msgread') messageReading.push(s);
      else if (mode === 'refread') refReading.push(s);
    }
    return { morning_feeding_raw: morningFeedingRaw, message_reading: messageReading, ref_reading: refReading };
  }

  /**
   * 将 morning_feeding 行列表拆分为经文（feeding_scriptures）和正文（morning_feeding）。
   * 经文行：以书卷缩写+章节开头，或中文章号+数字节号，或纯阿拉伯节号续行。
   * 一旦遇到非经文行，后续全部归入正文。
   */
  function splitFeedingScriptures(lines) {
    var feeding_scriptures = [];
    var morning_feeding = [];
    var reachedContent = false;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (reachedContent) { morning_feeding.push(line); continue; }
      var s = line.replace(/^[\s\u3000]+/, '');
      if (_isFeedingScripLine(s)) {
        feeding_scriptures.push(line);
      } else {
        reachedContent = true;
        morning_feeding.push(line);
      }
    }
    return { feeding_scriptures: feeding_scriptures, morning_feeding: morning_feeding };
  }

  function getShortTitle(header) {
    if (!header) return '';
    var short;
    // 跨年范围标题，保留完整标题（年份是关键信息，不应剥离）
    // 覆盖两种格式：
    //   1. "二○一○秋季至二○一二年..."（含「至」）
    //   2. "二〇〇七年至二〇〇八年..."（「年」+「至」）
    //   3. "二〇〇九年秋季二〇一〇年春季..."（两个年份无「至」拼接）
    var isCrossYear = /至[一二三四五六七八九○〇零]{4}年/.test(header) ||
                      /[一二三四五六七八九○〇零]{4}年[^、]{0,15}[一二三四五六七八九○〇零]{4}年/.test(header);
    if (isCrossYear) {
      short = header.trim();
    } else {
      // 找4字年份结束位置（年份末字 + 可选的"年"字），不用 indexOf('年') 避免
      // 切到 "半年度" 中间的 "年"（如"二〇二一七月份半年度训练" → 应返回"七月份半年度训练"）
      var yearM = header.match(/^[一二三四五六七八九○〇零两]{4}年?/);
      short = yearM ? header.slice(yearM[0].length).trim() : header.trim();
      // 去掉合辑标题中 "、B年XXX" 后缀，如 "夏冬季、二〇一四年夏季训练" → "夏冬季"
      short = short.replace(/、[一二三四五六七八九○〇零]{4}年.+$/, '').trim();
    }
    return short;
  }

  function getNowVersion() {
    var d = new Date();
    return '' + d.getFullYear()
      + pad2(d.getMonth() + 1) + pad2(d.getDate())
      + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  // ── 合辑文件（多训练）拆分 ────────────────────────────────────────────────

  /**
   * 检测合辑文件中各训练的边界，返回 [{headerLine, idxStart, year, seq}]
   * 使用 is_section_header 的等效逻辑：行匹配 {4汉字年份}年，
   * 且后面几行有 总题/标语/第01篇 之一。
   */
  function detectTrainingBoundaries(lines) {
    var sections = [];
    var n = lines.length;

    for (var i = 0; i < n; i++) {
      var s = lines[i].trim();
      if (!/^[一二三四五六七八九○〇零两]{4}[年秋春夏冬一二三四五六七八九十]/.test(s)) continue;
      // 排除正文句子：训练标题中不含句末/子句标点（逗号/句号等），有则说明是正文
      // 注意：顿号（、）后无年份的枚举（如"夏季、冬季训练"）是合法标题，不排除
      //       顿号后跟年份字符（如"冬季训练、二〇一七年..."）= 跨年合并标题，排除
      if (/[，。；？！：]/.test(s)) continue;
      var valid = false;
      for (var j = i + 1; j < Math.min(i + 9, n); j++) {
        var nxt = lines[j].trim();
        if (!nxt) continue;
        if (/^总题/.test(nxt) || /^标[\u3000\s]*语/.test(nxt) || /^第0?1篇/.test(nxt)) {
          valid = true; break;
        }
        // 遇到导航行或另一训练年份标题则停止
        if (isNavLine(nxt) || /^[一二三四五六七八九○〇零两]{4}年/.test(nxt)) break;
      }
      if (!valid) continue;
      var year = cnYearToInt(s);
      if (!year) continue;
      sections.push({ headerLine: s, idxStart: i, year: year });
    }
    return sections;
  }

  /**
   * 统计每年已有多少训练（用于分配 seq）
   * counts: {year: currentCount}
   */
  function assignSeqs(sections, existingCounts) {
    var counts = {};
    // 先复制已有计数
    if (existingCounts) {
      Object.keys(existingCounts).forEach(function(y) { counts[y] = existingCounts[y]; });
    }
    sections.forEach(function(sec) {
      var y = sec.year;
      counts[y] = (counts[y] || 0) + 1;
      sec.seq = counts[y];
    });
    return counts;
  }

  // ── 旧合辑格式（97-25-特会合辑.txt）专用解析器 ─────────────────────────────

  /**
   * 判断是否为旧"特会及训练信息合辑"大文件格式：
   * 第一行是 "特会及训练信息合辑"，且前 300 行含多个 YYYY类型　标题 格式。
   */
  function isOldCombinedFormat(lines) {
    if (!lines.length) return false;
    if (lines[0].trim() !== '特会及训练信息合辑') return false;
    var cnt = 0;
    for (var i = 1; i < Math.min(300, lines.length); i++) {
      if (/^\d{4}[^\d\s]/.test(lines[i].trim())) cnt++;
    }
    return cnt >= 5;
  }

  // ── 旧合辑文件（97-25）detail 区匹配辅助函数 ────────────────────────────────

  /** 规范化标题（统一破折号变体，去首尾空白）。移植自 Python normalize() */
  function _normTitleMatch(s) {
    return s.replace(/[—–－]/g, '─').trim();
  }

  /**
   * 去标点/空白，用于模糊匹配。移植自 Python fuzzy_key()。
   * 去掉"信息"前缀，去除 _PUNC_REMOVE_RE 覆盖字符及空白。
   */
  function _fuzzyKeyMatch(s) {
    s = s.replace(/[—–－]/g, '─');
    s = s.replace(_PUNC_REMOVE_RE, '');
    s = s.replace(/[\s\u3000]/g, '');
    if (s.slice(0, 2) === '信息') s = s.slice(2);
    return s;
  }

  /**
   * 从 INDEX 区该训练块中提取「第01篇/第1篇」标题（规范化后）。
   * 移植自 Python extract_first_msg_title()。
   */
  function _extractFirstMsgNorm(lines, start, end) {
    for (var j = start + 1; j < end; j++) {
      var s = lines[j].trim();
      if (/^第0?1篇/.test(s)) {
        var title = s.replace(/^第0?1篇[\s\u3000]*/, '');
        return _normTitleMatch(title);
      }
    }
    return null;
  }

  /**
   * 在 detail 区扫描所有「第一[篇周]」位置，构建 detail 索引。
   * 返回 [{sectionStart, firstMsgLine, normTitle, fuzzyTitle}]（按出现顺序）。
   * 移植自 Python build_detail_index()。
   */
  function _buildOldCombDetailIndex(lines, detailStart) {
    var entries = [];
    var n = lines.length;
    // 带非空标题的第一篇/周 header
    var FIRST_MSG_RE = /^第一[篇周]/;
    var MSG_HDR_RE   = /^第[一二三四五六七八九十百千]+[篇周][\s\u3000]+(.*)/;

    for (var i = detailStart; i < n; i++) {
      var s = lines[i].trim();
      if (!FIRST_MSG_RE.test(s)) continue;
      var m = MSG_HDR_RE.exec(s);
      if (!m || !m[1].trim()) continue;
      var rawTitle = m[1].trim();

      // 向上找「标　语」起始（15 行以内）→ section_start
      var sectionStart = i;
      for (var back = 1; back < 15 && (i - back) >= detailStart; back++) {
        var pl = lines[i - back].trim();
        if (pl === '标\u3000语' || pl === '标语') { sectionStart = i - back; break; }
        if (/^TOP/.test(pl)) break;
      }

      entries.push({
        sectionStart : sectionStart,
        firstMsgLine : i,
        normTitle    : _normTitleMatch(rawTitle),
        fuzzyTitle   : _fuzzyKeyMatch(rawTitle)
      });
    }
    return entries; // 已按 firstMsgLine 升序（扫描顺序）
  }

  /**
   * 在 detail 索引中找 normTitle 匹配的条目（firstMsgLine >= searchAfter）。
   * 先精确，再 fuzzy，再前缀。移植自 Python find_detail_range()。
   */
  function _findOldCombDetailRange(detailIndex, normTitle, searchAfter) {
    var fuzz = _fuzzyKeyMatch(normTitle);
    var j, e;
    // 精确匹配
    for (j = 0; j < detailIndex.length; j++) {
      e = detailIndex[j];
      if (e.firstMsgLine < searchAfter) continue;
      if (e.normTitle === normTitle) return e;
    }
    // fuzzy 匹配
    for (j = 0; j < detailIndex.length; j++) {
      e = detailIndex[j];
      if (e.firstMsgLine < searchAfter) continue;
      if (e.fuzzyTitle === fuzz) return e;
    }
    // 前缀匹配（14 / 10 / 6 字符逐步退化）
    var prefixLens = [14, 10, 6];
    for (var pi = 0; pi < prefixLens.length; pi++) {
      var plen = prefixLens[pi];
      if (fuzz.length < plen) continue;
      var fp = fuzz.slice(0, plen);
      for (j = 0; j < detailIndex.length; j++) {
        e = detailIndex[j];
        if (e.firstMsgLine < searchAfter) continue;
        if (e.fuzzyTitle.slice(0, plen) === fp) return e;
      }
    }
    return null;
  }

  /**
   * 解析旧合辑大文件（97-25-特会合辑.txt）。
   * 策略（与 Python split_trainings.py generate_json() 等价）：
   *   1. 找 detail 区起点（最后一个「回页首」+ 3）
   *   2. 从 INDEX 区检测 237 个训练边界，并提取每个训练的「第01篇」标题
   *   3. 扫描 detail 区，对所有「第一[篇周]」行构建 detail 索引
   *   4. 按训练顺序做标题匹配，将每个训练映射到其 detail 行范围
   *   5. 逐训练调用 parseDetailArea()，填充标题/副标题/标语元数据
   */

  // ── 范围训练过滤（旧合辑专用）────────────────────────────────────────────────
  // 匹配标题里「中文年+至+中文年」的范围训练，如「二〇一四年冬季至二〇一六年夏季训练」
  var _RANGE_TITLE_RE = /[一二三四五六七八九○〇零]{4}[年秋春夏冬].{0,10}至([一二三四五六七八九○〇零两]{4})/;

  function _getRangeEndYear(title) {
    var m = (title || '').match(_RANGE_TITLE_RE);
    if (!m) return null;
    return cnYearToInt(m[1]);
  }

  /**
   * 从范围训练 INDEX 区提取子季次标题行（用于与独立训练 subtitle 比对）。
   * 过滤掉：篇目行、导航行、总题/标语行、年份头行、TOP/回页首。
   */
  function _extractSubSections(td, lines) {
    var r = td.rawRange;
    if (!r) return [];
    var subs = [];
    for (var i = r.idxStart + 1; i < r.idxEnd; i++) {
      var l = lines[i].trim();
      if (!l || l === 'TOP' || l === '回页首') continue;
      if (/^总题|^标[\u3000\s]*语/.test(l)) continue;
      if (/^第\d+篇/.test(l)) continue;
      if ((l.indexOf('|') >= 0 || l.indexOf('＼') >= 0) && l.length < 80) continue;
      if (/^[一二三四五六七八九○〇零]{4}[年秋春夏冬]/.test(l)) continue;
      subs.push(l);
    }
    return subs;
  }

  /**
   * 过滤掉旧合辑中被独立训练完全覆盖的范围训练。
   * 判断依据：范围训练 INDEX 区的每个子季次标题都能在同批独立训练的 subtitle 中找到。
   * 匹配不上的范围训练原样保留。
   */
  function filterRangeTrainings(trainings, lines) {
    // 构建独立训练 subtitle 集合
    var subtitleSet = {};
    trainings.forEach(function(td) {
      if (_getRangeEndYear(td.title) !== null) return;
      if (td.subtitle) subtitleSet[td.subtitle.trim()] = true;
    });
    return trainings.filter(function(td) {
      // Case 1：标题含"至"的跨年范围合辑
      // INDEX 区所有子季次标题均能在独立训练 subtitle 集合中找到
      var endYear = _getRangeEndYear(td.title);
      if (endYear !== null && endYear > (td.year || 0)) {
        var subs = _extractSubSections(td, lines);
        if (subs.length > 0 && subs.every(function(s) { return subtitleSet[s]; })) {
          return false;
        }
      }
      // Case 2：subtitle 聚合（如"以西结书结晶读经" vs "以西结书结晶读经（一）"）
      // 条件：① subtitle + "（一）" 在独立训练集合中  ② 首行含"、"（多季次标志）
      if (td.subtitle && td.rawRange
          && lines[td.rawRange.idxStart].indexOf('\u3001') >= 0
          && subtitleSet[td.subtitle.trim() + '\uff08\u4e00\uff09']) {
        return false;
      }
      return true;
    });
  }

  function parseOldCombinedFile(lines, onProgress) {
    var n = lines.length;

    // ── 1. 找 detail 区起点（最后一个「回页首」+ 3） ────────────────────────────
    var lastRo = -1;
    for (var i = 0; i < Math.min(15000, n); i++) {
      if (lines[i].trim() === '回页首') lastRo = i;
    }
    var firstDetailStart = lastRo >= 0 ? lastRo + 3 : 0;

    // ── 2. 从 INDEX 区获取训练边界，并提取第01篇规范化标题 ──────────────────────
    var bounds = detectTrainingBoundaries(lines);
    if (!bounds.length) return [parseSingleTraining(lines, null)];
    assignSeqs(bounds, null);

    for (var i = 0; i < bounds.length; i++) {
      var idxEnd = (i + 1 < bounds.length) ? bounds[i + 1].idxStart : firstDetailStart;
      bounds[i].idxEnd = idxEnd;
      bounds[i].firstMsgNorm = _extractFirstMsgNorm(lines, bounds[i].idxStart, idxEnd);
    }

    // ── 3. 构建 detail 索引（一次全量扫描，O(n)） ───────────────────────────────
    var detailIndex = _buildOldCombDetailIndex(lines, firstDetailStart);

    // ── 4. 按训练顺序匹配 INDEX section → detail 起始行 ─────────────────────────
    var matchedDetail = {}; // bounds[i].idxStart → {dStart, detailEnd}
    var searchAfter = firstDetailStart;
    for (var i = 0; i < bounds.length; i++) {
      var norm = bounds[i].firstMsgNorm;
      if (!norm) continue;
      var entry = _findOldCombDetailRange(detailIndex, norm, searchAfter);
      if (entry) {
        matchedDetail[bounds[i].idxStart] = { dStart: entry.sectionStart };
        searchAfter = entry.firstMsgLine + 1;
      }
    }

    // ── 5. 确定每个已匹配训练的 detail 结束行（下一训练 dStart 即为边界） ─────────
    var allMatched = [];
    for (var i = 0; i < bounds.length; i++) {
      var md = matchedDetail[bounds[i].idxStart];
      if (md) allMatched.push({ idxStart: bounds[i].idxStart, dStart: md.dStart });
    }
    allMatched.sort(function(a, b) { return a.dStart - b.dStart; });
    for (var i = 0; i < allMatched.length; i++) {
      var detailEnd = i + 1 < allMatched.length ? allMatched[i + 1].dStart : n;
      matchedDetail[allMatched[i].idxStart].detailEnd = detailEnd;
    }

    // ── 6. 逐训练解析并构建训练对象 ─────────────────────────────────────────────
    var total = bounds.length;
    var results = [];
    for (var i = 0; i < total; i++) {
      var b = bounds[i];
      var seqStr = b.seq < 10 ? '0' + b.seq : '' + b.seq;
      var defaultPath = 'local-' + b.year + '-' + seqStr;

      var indexInfo = parseIndexArea(lines, b.idxStart, b.idxEnd || n);

      var chapters;
      var md = matchedDetail[b.idxStart];
      if (md && md.detailEnd !== undefined) {
        chapters = parseDetailArea(lines, md.dStart, md.detailEnd);
      } else {
        // 无匹配 detail：用 INDEX 中的篇目列表构造空章节
        chapters = (indexInfo.msgTitles || []).map(function(t, idx) {
          return makeEmptyChapter(idx + 1, t);
        });
      }

      var shortTitle = getShortTitle(indexInfo.title || b.headerLine || '');
      var td = {
        path: defaultPath,
        title: shortTitle,
        subtitle: indexInfo.subtitle || '',
        year: b.year,
        season: seqStr + ' ' + shortTitle,
        mottos: indexInfo.mottos || [],
        motto_song_text: indexInfo.mottoSongText || '',
        motto_song_image: '',
        chapters: chapters,
        version: getNowVersion(),
        // 原始行范围（供构建脚本提取原文用，浏览器端忽略）
        rawRange: {
          idxStart: b.idxStart,
          idxEnd: b.idxEnd || n,
          detailStart: (md && md.dStart != null) ? md.dStart : null,
          detailEnd:   (md && md.detailEnd != null) ? md.detailEnd : null
        }
      };
      results.push(td);
      if (onProgress) onProgress(i + 1, total);
    }
    return results;
  }

  /**
   * 解析合辑文件（多训练）。
   * 返回一组训练对象。onProgress(done, total) 在每个训练完成后调用。
   */
  function parseCombinedFile(lines, onProgress) {
    var sections = detectTrainingBoundaries(lines);
    if (!sections.length) {
      // 退化：当作单训练处理
      return [parseSingleTraining(lines, null)];
    }

    var total = sections.length;

    // 分配 seq（按年份在文件内出现顺序）
    assignSeqs(sections, null);

    // 为每个 section 确定其行范围
    for (var k = 0; k < sections.length; k++) {
      sections[k].end = (k + 1 < sections.length) ? sections[k + 1].idxStart : lines.length;
    }

    var results = [];
    for (var i = 0; i < sections.length; i++) {
      var sec = sections[i];
      var secLines = lines.slice(sec.idxStart, sec.end);
      var seqStr = sec.seq < 10 ? '0' + sec.seq : '' + sec.seq;
      var defaultPath = 'local-' + sec.year + '-' + seqStr;
      var td = parseSingleTraining(secLines, defaultPath);
      // 确保 year/season 正确（单训练解析可能读不到年份时 fallback）
      if (!td.year) td.year = sec.year;
      if (!td.season || td.season.indexOf('undefined') >= 0) {
        td.season = seqStr + ' ' + td.title;
      }
      td.path = defaultPath;
      results.push(td);

      if (onProgress) onProgress(i + 1, total);
      // yield 时机：每处理10个训练让出一次微任务（避免 UI 卡死）
    }
    return results;
  }

  // ── 从文件名提取 year / seq ────────────────────────────────────────────────

  /**
   * 从文件名（如 "2026-1-ICSC.txt", "2025-01-国际华语特会.txt"）提取 {year, seq}。
   * 均为整数，失败返回 null。
   */
  function extractYearSeqFromFilename(filename) {
    var m = filename.match(/^(\d{4})-0*(\d+)[^/\\]*/);
    if (m) return { year: parseInt(m[1], 10), seq: parseInt(m[2], 10) };
    return null;
  }

  // ── LocalForage 存储 ──────────────────────────────────────────────────────

  function getStore() {
    if (!win.localforage) throw new Error('localforage 未加载');
    return win.localforage;
  }

  function loadIndex() {
    return getStore().getItem(STORE_INDEX).then(function(v) { return v || []; });
  }

  function saveIndex(arr) {
    return getStore().setItem(STORE_INDEX, arr);
  }

  function saveTraining(path, td) {
    return getStore().setItem(STORE_PREFIX + path, td);
  }

  function loadTraining(path) {
    return getStore().getItem(STORE_PREFIX + path);
  }

  function saveScriptures(path, dict) {
    if (!dict || !Object.keys(dict).length) return Promise.resolve();
    return getStore().setItem(SCRIPTURES_PREFIX + path, dict);
  }

  function loadScriptures(path) {
    return getStore().getItem(SCRIPTURES_PREFIX + path);
  }

  // ── 内容验证 ──────────────────────────────────────────────────────────────

  /**
   * 验证行列表是否像合法的训练 TXT 文件。
   * 返回 null 表示通过；返回字符串表示错误原因。
   */
  function _validateTrainingContent(lines) {
    // 1. 最小行数
    var nonEmpty = 0;
    for (var i = 0; i < lines.length; i++) { if (lines[i].trim()) nonEmpty++; }
    if (nonEmpty < 5) return '文件内容过少，不是有效的训练文本';

    // 2. 旧合辑格式直接通过
    if (isOldCombinedFormat(lines)) return null;

    // 3. 统计训练特征标记
    var score = 0;
    var scanEnd = Math.min(lines.length, 300);
    for (var j = 0; j < scanEnd; j++) {
      var s = lines[j].trim();
      if (!s) continue;
      if (/^第[一二三四五六七八九十百千]+[篇周]/.test(s))              { score++; continue; }
      if (cnYearToInt(s) !== null)                                       { score++; continue; }
      if (s === 'TOP' || s === 'TOP-目录')                               { score++; continue; }
      if (/^总题[：:∶]?/.test(s))                                       { score++; continue; }
      if (/^标[\u3000\s]?语/.test(s))                                   { score++; continue; }
      if (/^读经[：:∶]?/.test(s))                                       { score++; continue; }
      if (/^诗歌[：:∶]?/.test(s))                                       { score++; continue; }
      if (/^─{20,}$/.test(s) && j + 1 < lines.length &&
          lines[j + 1].indexOf('详细信息') >= 0)                        { score += 2; continue; }
      if (score >= 3) break; // 够了，无需继续扫
    }

    if (score < 2) {
      return '文件格式无法识别，请确认导入的是正确的训练 TXT 文件\n（需包含训练年份、章节标题、TOP 导航等标志性内容）';
    }
    return null;
  }

  // ── 序号冲突检测与重分配 ────────────────────────────────────────────────────

  /**
   * 检测本地导入的 path 是否与网络训练或已有本地导入冲突（同 year-seq 但标题不同），
   * 若有冲突则自动分配新序号（从该年已用最大序号 +1 开始）。
   * 直接修改 trainings 数组中各对象的 path / season。
   */
  function resolveConflicts(trainings) {
    return loadIndex().then(function(localIndex) {
      // 收集所有已占用的路径（网络 + 本地）
      var netTrainings = win.__cxTrainings || [];
      var occupied = {}; // 'YYYY-NN' → title
      netTrainings.forEach(function(t) { occupied[t.path] = t.title || t.season || ''; });
      localIndex.forEach(function(item) { occupied[item.path.replace(/^local-/, '')] = item.title || ''; });

      // 按年份分组，收集已用序号
      var usedSeqsByYear = {};
      Object.keys(occupied).forEach(function(p) {
        var m = p.match(/^(\d{4})-(\d+)/);
        if (m) {
          var y = m[1], s = parseInt(m[2], 10);
          if (!usedSeqsByYear[y]) usedSeqsByYear[y] = [];
          if (usedSeqsByYear[y].indexOf(s) < 0) usedSeqsByYear[y].push(s);
        }
      });

      var pathRemap = {}; // oldPath → newPath

      trainings.forEach(function(td) {
        if (!td.path) return;
        var oldPath = td.path;
        var barePath = td.path.replace(/^local-/, '');
        var m = barePath.match(/^(\d{4})-(\d+)/);
        if (!m) return;
        var year = m[1];
        var seq = parseInt(m[2], 10);
        var existingTitle = occupied[barePath];

        // 无冲突：该序号未被占用，或是覆盖自己（同标题）
        if (!existingTitle) {
          // 记录为已占用（防止同一批导入内重复）
          occupied[barePath] = td.title || '';
          if (!usedSeqsByYear[year]) usedSeqsByYear[year] = [];
          if (usedSeqsByYear[year].indexOf(seq) < 0) usedSeqsByYear[year].push(seq);
          return;
        }
        if (existingTitle === (td.title || '')) return; // 同标题 = 更新覆盖，允许

        // 冲突：同序号不同标题 → 找下一个可用序号
        if (!usedSeqsByYear[year]) usedSeqsByYear[year] = [];
        var usedSeqs = usedSeqsByYear[year];
        var newSeq = seq;
        while (usedSeqs.indexOf(newSeq) >= 0) { newSeq++; }
        usedSeqs.push(newSeq);

        var newSeqStr = newSeq < 10 ? '0' + newSeq : '' + newSeq;
        var shortTitle = td.title || (td.season || '').split(' ').slice(1).join(' ');
        td.path = 'local-' + year + '-' + newSeqStr;
        td.season = newSeqStr + ' ' + shortTitle;
        occupied[year + '-' + newSeqStr] = td.title || '';
        pathRemap[oldPath] = td.path;
      });

      return pathRemap;
    });
  }

  // ── 公开 API ──────────────────────────────────────────────────────────────

  /**
   * 解析 TXT 文本并存入 LocalForage。
   * @param {string} text - 文件内容
   * @param {string} filename - 原始文件名（用于推断 year/seq）
   * @param {function} onProgress - (done, total, msg) 进度回调
   * @returns {Promise<{count, paths}>}
   */
  function parseAndSave(text, filename, onProgress) {
    return new Promise(function(resolve, reject) {
      try {
        // 异步化处理（避免阻塞 UI）
        setTimeout(function() {
          try {
            // 全局规范化：与 Python generator._normalize_source_abbr 保持一致
            text = text.replace(/李常受文集/g, 'CWWL').replace(/生命读经/g, 'L-S');
            var lines = text.split(/\r?\n/);

            // ── 内容验证：拒绝非训练 TXT 文件 ──────────────────────────────
            var _vErr = _validateTrainingContent(lines);
            if (_vErr) { reject(new Error(_vErr)); return; }

            var trainings = [];
            var isCombined = false;

            // 判断是否为合辑文件（内含多个训练）
            // 优先检测旧「特会及训练信息合辑」格式（97-25-特会合辑.txt）
            var isOldCmb = isOldCombinedFormat(lines);
            var boundaries = null;

            if (isOldCmb) {
              if (onProgress) onProgress(0, 1, '正在解析旧合辑文件…');
              trainings = parseOldCombinedFile(lines, function(done, total) {
                if (onProgress) onProgress(done, total, '正在解析第 ' + done + ' / ' + total + ' 个训练…');
              });
              // 过滤掉已被独立训练完全覆盖的范围合辑条目
              trainings = filterRangeTrainings(trainings, lines);
              isCombined = true;  // 旧合辑：历史内容不含内联经文，跳过2024+格式提取
            } else {
              boundaries = detectTrainingBoundaries(lines);
              isCombined = boundaries.length > 1;
              if (isCombined) {
                // 合辑：批量解析
                if (onProgress) onProgress(0, boundaries.length, '正在检测训练边界…');
                trainings = parseCombinedFile(lines, function(done, total) {
                  if (onProgress) onProgress(done, total, '正在解析第 ' + done + ' / ' + total + ' 个训练…');
                });
              } else {
                // 单训练
                if (onProgress) onProgress(0, 1, '正在解析…');
                var ys = extractYearSeqFromFilename(filename || '');
                var defaultPath = null;
                if (ys) {
                  var seqStr = ys.seq < 10 ? '0' + ys.seq : '' + ys.seq;
                  defaultPath = 'local-' + ys.year + '-' + seqStr;
                }
                var td = parseSingleTraining(lines, defaultPath);
                if (!td.path) {
                  // fallback：用时间戳
                  td.path = 'local-' + getNowVersion();
                }
                trainings = [td];
                if (onProgress) onProgress(1, 1, '解析完成');
              }
            }

            if (!trainings.length) {
              reject(new Error('未能识别到任何训练内容'));
              return;
            }

            // ── 提取内联经文（2024+ 格式） ────────────────────────────────────
            var scripturesMap = {};  // path → verseDict
            if (!isCombined) {
              // 单训练：扫全文
              if (trainings[0] && trainings[0].path) {
                scripturesMap[trainings[0].path] = collectInlineVerses(lines);
              }
            } else if (!isOldCmb && boundaries) {
              // 现代合辑：用训练边界直接切片（不依赖 msgTitles 标题匹配）
              for (var bi = 0; bi < boundaries.length; bi++) {
                boundaries[bi].end = bi + 1 < boundaries.length
                  ? boundaries[bi + 1].idxStart : lines.length;
              }
              trainings.forEach(function(td, i) {
                if (i < boundaries.length) {
                  scripturesMap[td.path] = collectInlineVerses(
                    lines.slice(boundaries[i].idxStart, boundaries[i].end)
                  );
                }
              });
            }
            // else: 旧合辑（历史格式，pre-2015 内容无内联经文），跳过经文提取

            // 富化晨兴 feeding_refs / context（依赖 ref-detector.js，浏览器导入时已加载）
            if (win.CXEnricher) win.CXEnricher.enrichTrainings(trainings);

            // ── 序号冲突检测：本地导入不应顶掉已有的网络训练 ────────────────
            resolveConflicts(trainings).then(function(pathRemap) {
            // 同步更新 scripturesMap 的 key（冲突重分配可能改了 path）
            if (pathRemap) {
              Object.keys(pathRemap).forEach(function(oldPath) {
                if (scripturesMap[oldPath]) {
                  scripturesMap[pathRemap[oldPath]] = scripturesMap[oldPath];
                  delete scripturesMap[oldPath];
                }
              });
            }

            // 逐一保存到 LocalForage
            loadIndex().then(function(index) {
              var indexMap = {};
              index.forEach(function(item) { indexMap[item.path] = true; });

              var savePromises = trainings.map(function(td) {
                return saveTraining(td.path, td).then(function() {
                  // 保存该训练的补充经文数据
                  return saveScriptures(td.path, scripturesMap[td.path] || {});
                }).then(function() {
                  // 更新 index 元数据
                  var meta = {
                    path: td.path,
                    title: td.title,
                    subtitle: td.subtitle || '',
                    year: td.year,
                    season: td.season,
                    chapter_count: (td.chapters || []).length,
                    is_local: true,
                    importedAt: Date.now()
                  };
                  if (indexMap[td.path]) {
                    // 覆盖已有元数据
                    for (var i = 0; i < index.length; i++) {
                      if (index[i].path === td.path) { index[i] = meta; break; }
                    }
                  } else {
                    index.push(meta);
                    indexMap[td.path] = true;
                  }
                });
              });

              return Promise.all(savePromises).then(function() {
                return saveIndex(index);
              }).then(function() {
                resolve({ count: trainings.length, paths: trainings.map(function(t){ return t.path; }) });
              });
            });
            }).catch(function(e) { reject(e); });
          } catch(e) {
            reject(e);
          }
        }, 0);
      } catch(e) {
        reject(e);
      }
    });
  }

  /** 返回所有已导入训练的元数据列表（按导入时间倒序） */
  function listImports() {
    return loadIndex().then(function(arr) {
      return arr.slice().sort(function(a, b) { return (b.importedAt || 0) - (a.importedAt || 0); });
    });
  }

  /** 删除指定 path 的已导入训练 */
  function deleteImport(path) {
    return Promise.all([
      loadIndex(),
      getStore().removeItem(STORE_PREFIX + path),
      getStore().removeItem(SCRIPTURES_PREFIX + path)
    ]).then(function(results) {
      var index = results[0].filter(function(item) { return item.path !== path; });
      return saveIndex(index);
    });
  }

  /** 获取指定 path 的训练数据 */
  function getTraining(path) {
    return loadTraining(path);
  }

  win.CXLocalImport = {
    parseAndSave: parseAndSave,
    listImports: listImports,
    deleteImport: deleteImport,
    getTraining: getTraining,
    loadScriptures: loadScriptures,
    // Node.js 构建时使用的解析函数（浏览器中忽略）
    parseSingleTraining: parseSingleTraining,
    parseCombinedFile: parseCombinedFile,
    isOldCombinedFormat: isOldCombinedFormat,
    parseOldCombinedFile: parseOldCombinedFile,
    detectDetailStart: detectDetailStart,
    extractYearSeqFromFilename: extractYearSeqFromFilename,
    detectTrainingBoundaries: detectTrainingBoundaries,
    cnYearToInt: cnYearToInt,
    filterRangeTrainings: filterRangeTrainings,
    // 经文提取工具（构建脚本复用）
    collectInlineVerses: collectInlineVerses
  };

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : {}));
