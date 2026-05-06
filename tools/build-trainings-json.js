#!/usr/bin/env node
/**
 * build-trainings-json.js — Node.js 构建时脚本
 *
 * 替代 split_trainings.py --mode json
 * 使用 txt-importer.js + ref-detector.js 解析历史合辑 TXT 文件，
 * 为每个训练生成 output/{year}-{seq:02d}/training.json。
 *
 * 用法:
 *   node tools/build-trainings-json.js [--year YYYY]
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── 参数解析 ─────────────────────────────────────────────────────────────────
var yearFilter = null;
for (var ai = 2; ai < process.argv.length; ai++) {
  if (process.argv[ai] === '--year' && process.argv[ai + 1]) {
    yearFilter = parseInt(process.argv[ai + 1], 10);
    ai++;
  }
}

// ── 1. 浏览器全局量 shim（在 require IIFE 模块之前设置）──────────────────────
global.window = {};
global.localforage = {
  getItem:    function() { return Promise.resolve(null); },
  setItem:    function() { return Promise.resolve(null); },
  removeItem: function() { return Promise.resolve(null); }
};

// ── 2. 加载 IIFE 模块 ─────────────────────────────────────────────────────────
var ROOT        = path.resolve(__dirname, '..');
var TXT_IMP     = path.join(ROOT, 'src', 'static', 'js', 'txt-importer.js');
var REF_DET     = path.join(ROOT, 'src', 'static', 'js', 'ref-detector.js');

require(TXT_IMP);
require(REF_DET);

var _imp = global.window.CXLocalImport;
var _ref = global.window.CXRef;

if (!_imp || !_imp.parseSingleTraining) {
  console.error('错误: txt-importer.js 未正确暴露 parseSingleTraining');
  process.exit(1);
}
if (!_ref || !_ref.expandCnRefs) {
  console.error('错误: ref-detector.js 未正确暴露 expandCnRefs');
  process.exit(1);
}

var parseSingleTraining        = _imp.parseSingleTraining;
var parseCombinedFile          = _imp.parseCombinedFile;
var isOldCombinedFormat        = _imp.isOldCombinedFormat;
var parseOldCombinedFile       = _imp.parseOldCombinedFile;
var detectDetailStart          = _imp.detectDetailStart;
var extractYearSeqFromFilename = _imp.extractYearSeqFromFilename;
var collectInlineVerses        = _imp.collectInlineVerses;
var normTitle                  = _imp.normInlineTitle;
var buildDetailIndex           = _imp.buildInlineDetailIndex;
var detectCombinedDetailStart  = _imp.detectInlineStart;
var expandCnRefs              = _ref.expandCnRefs;
var scanCtx                   = _ref.scanCtx;

// ── 3. 路径 ───────────────────────────────────────────────────────────────────
var RESOURCE_DIR = path.join(ROOT, 'resource', '历史合辑');
var OUTPUT_DIR   = path.join(ROOT, 'output');

// ── 3b. 补充经文写出（构建时写文件）────────────────────────────────────────────

/** 懒加载 bible-text.json 的 key 集合（用于过滤已有经文）。 */
var _bibleKeys = null;
function getBibleKeys() {
  if (_bibleKeys !== null) return _bibleKeys;
  var p = path.join(OUTPUT_DIR, 'data', 'bible-text.json');
  if (!fs.existsSync(p)) { _bibleKeys = new Set(); return _bibleKeys; }
  var data = JSON.parse(fs.readFileSync(p, 'utf8'));
  _bibleKeys = new Set(Object.keys(data));
  return _bibleKeys;
}

/** 写出 scriptures-data.json（仅写出 bible-text.json 中不存在的补充经文）。 */
function writeScriptures(verseDict, year, seq) {
  var keys = Object.keys(verseDict);
  if (!keys.length) return;
  var bk = getBibleKeys();
  var filtered = {};
  keys.forEach(function(k) { if (!bk.has(k)) filtered[k] = verseDict[k]; });
  var fkeys = Object.keys(filtered);
  if (!fkeys.length) return;
  var seqStr = seq < 10 ? '0' + seq : '' + seq;
  var jsDir = path.join(OUTPUT_DIR, year + '-' + seqStr, 'js');
  fs.mkdirSync(jsDir, { recursive: true });
  fs.writeFileSync(path.join(jsDir, 'scriptures-data.json'), JSON.stringify(filtered), 'utf8');
}

// ── 4. 富化函数（镜像 Python 的 _enrich_chapter_feeding_refs / _enrich_section_contexts）

/**
 * 计算单章所有晨读的 feeding_refs / morning_feeding_contexts / message_reading_contexts。
 */
function enrichChapter(chapter) {
  var scripture = chapter.scripture || '';
  var revivals  = chapter.morning_revivals || [];

  for (var ri = 0; ri < revivals.length; ri++) {
    var rev = revivals[ri];

    // ── feeding_refs ──────────────────────────────────────────────────────
    var fs = rev.feeding_scriptures || [];
    var ctxStr = scripture;
    rev.feeding_refs = fs.map(function(text) {
      var m = (text || '').trim().match(/^(\S+)/);
      var refPart = m ? m[1].replace(/[，、；。：:,;)）\]]+$/, '') : '';
      var ctxM = ctxStr.match(/^([^\d:]+)(\d+):(\d+)/);
      var defBook = ctxM ? ctxM[1] : '';
      var defCh   = ctxM ? parseInt(ctxM[2], 10) : 0;
      var refs = expandCnRefs(refPart, defBook, defCh);
      if (refs.length > 0) {
        var lr = refs[refs.length - 1].replace(/[上中下]$/, '');
        var lm = lr.match(/^([^\d:]+)(\d+):(\d+)/);
        if (lm) ctxStr = lm[1] + lm[2] + ':' + lm[3];
      }
      return refs.join(',');
    });

    // ── morning_feeding_contexts ──────────────────────────────────────────
    var mf = rev.morning_feeding || [];
    ctxStr = scripture;
    rev.morning_feeding_contexts = mf.map(function(para) {
      var c = ctxStr;
      ctxStr = scanCtx(para, ctxStr) || ctxStr;
      return c;
    });

    // ── message_reading_contexts ──────────────────────────────────────────
    var mr = rev.message_reading || [];
    ctxStr = scripture;
    rev.message_reading_contexts = mr.map(function(para) {
      var c = ctxStr;
      ctxStr = scanCtx(para, ctxStr) || ctxStr;
      return c;
    });
  }
}

// ── 5. 写出 training.json ─────────────────────────────────────────────────────
function writeTraining(td, year, seq) {
  if (yearFilter && year !== yearFilter) return false;
  var seqStr = seq < 10 ? '0' + seq : '' + seq;
  var dirName = year + '-' + seqStr;
  var outDir  = path.join(OUTPUT_DIR, dirName);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'training.json'),
    JSON.stringify(td, null, 2),
    'utf8'
  );
  return true;
}

// ── 6. 富化并写出 ──────────────────────────────────────────────────────────────
function enrichAndWrite(td, year, seq) {
  (td.chapters || []).forEach(enrichChapter);
  return writeTraining(td, year, seq);
}

// ── 7. 处理单个 TXT 文件 ───────────────────────────────────────────────────────
/**
 * inYearSubdir: true → 文件位于 YYYY/ 子目录（单训练，从文件名取 seq）
 *              false → 文件位于根目录（可能是合辑）
 */
function processFile(filePath, inYearSubdir) {
  var filename = path.basename(filePath);
  var text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    console.warn('  [读取失败] ' + filename + ': ' + e.message);
    return 0;
  }
  var lines = text.split('\n');
  var count = 0;

  if (inYearSubdir) {
    // ── 单训练文件（YYYY-NN-*.txt）──────────────────────────────────────
    var ys = extractYearSeqFromFilename(filename);
    if (!ys) {
      console.warn('  [跳过] 无法从文件名提取年份/序号: ' + filename);
      return 0;
    }
    var seqStr = ys.seq < 10 ? '0' + ys.seq : '' + ys.seq;
    var td;
    try {
      td = parseSingleTraining(lines, 'local-' + ys.year + '-' + seqStr);
    } catch (e) {
      console.warn('  [解析失败] ' + filename + ': ' + e.message);
      return 0;
    }
    if (!td.year) td.year = ys.year;
    // 单训练文件：扫描全部行提取内联经文（2024+ 格式）
    if (enrichAndWrite(td, ys.year, ys.seq)) {
      writeScriptures(collectInlineVerses(lines), ys.year, ys.seq);
      count = 1;
    }

  } else {
    // ── 合辑或根目录单训练文件 ────────────────────────────────────────────
    var results;
    var isOldCmb = isOldCombinedFormat && isOldCombinedFormat(lines);
    try {
      results = isOldCmb ? parseOldCombinedFile(lines, null) : parseCombinedFile(lines, null);
    } catch (e) {
      console.warn('  [解析失败] ' + filename + ': ' + e.message);
      return 0;
    }

    // 如果退化为单训练，尝试用文件名取 year/seq
    if (results.length === 1) {
      var ys2 = extractYearSeqFromFilename(filename);
      if (ys2 && (!results[0].year || results[0].year !== ys2.year)) {
        results[0].year = ys2.year;
        var sq2 = ys2.seq;
        var ss2 = sq2 < 10 ? '0' + sq2 : '' + sq2;
        results[0].path = 'local-' + ys2.year + '-' + ss2;
      }
    }

    var isCombined = results.length > 1;

    if (isOldCmb && isCombined) {
      // ── 旧合辑格式（97-25）：用 TOP-目录 边界切片提取经文 ──────────────
      // 找 DETAIL 区起点（文件前 15000 行最后一个「回页首」+3）
      var lastRo = -1;
      for (var li2 = 0; li2 < Math.min(15000, lines.length); li2++) {
        if (lines[li2].trim() === '回页首') lastRo = li2;
      }
      var firstDS = lastRo >= 0 ? lastRo + 3 : 0;
      // 按 TOP-目录 分段
      var detailSecStarts = [firstDS];
      for (var li2 = firstDS; li2 < lines.length; li2++) {
        if (lines[li2].trim() === 'TOP-目录') detailSecStarts.push(li2 + 1);
      }

      results.forEach(function (td2, idx) {
        var pm = (td2.path || '').match(/^local-(\d+)-(\d+)/);
        if (!pm) return;
        var year2 = parseInt(pm[1], 10);
        var seq2  = parseInt(pm[2], 10);
        if (!year2 || !seq2) return;
        if (enrichAndWrite(td2, year2, seq2)) {
          count++;
          if (idx < detailSecStarts.length) {
            var dStart = detailSecStarts[idx];
            var dEnd   = idx + 1 < detailSecStarts.length ? detailSecStarts[idx + 1] - 1 : lines.length;
            writeScriptures(collectInlineVerses(lines.slice(dStart, dEnd)), year2, seq2);
          }
        }
      });

    } else {
      // ── 普通合辑 或 单训练：原有逻辑（title-matching 或直接扫全文）────
      var detailStart2 = isCombined ? detectCombinedDetailStart(lines) : 0;
      var detailIndex2 = isCombined ? buildDetailIndex(lines, detailStart2) : [];
      var searchAfter2 = detailStart2;
      var matchedDetail2 = []; // [{sectionStart, year, seq}]

      results.forEach(function(td2) {
        var pm = (td2.path || '').match(/^local-(\d+)-(\d+)/);
        if (!pm) return;
        var year2 = parseInt(pm[1], 10);
        var seq2  = parseInt(pm[2], 10);
        if (!year2 || !seq2) return;
        if (enrichAndWrite(td2, year2, seq2)) {
          count++;
          if (!isCombined) {
            // 单训练文件：直接扫全文提取经文
            writeScriptures(collectInlineVerses(lines), year2, seq2);
          } else {
            // 合辑：以 msgTitles[0] 在 detailIndex2 中顺序查找，用 searchAfter2 防重复消耗
            var firstMsgTitle = (td2.msgTitles && td2.msgTitles[0]) || '';
            var normFirst = normTitle(firstMsgTitle);
            var found = null;
            for (var j = 0; j < detailIndex2.length; j++) {
              var e = detailIndex2[j];
              if (e.firstMsgLine < searchAfter2) continue;
              if (e.title === firstMsgTitle || normTitle(e.title) === normFirst) {
                found = e;
                break;
              }
            }
            if (found) {
              searchAfter2 = found.firstMsgLine + 1;
              matchedDetail2.push({ sectionStart: found.sectionStart, year: year2, seq: seq2 });
            }
          }
        }
      });

      // 按 sectionStart 升序，逐训练确定范围并提取经文
      matchedDetail2.sort(function(a, b) { return a.sectionStart - b.sectionStart; });
      matchedDetail2.forEach(function(m, i) {
        var end = i + 1 < matchedDetail2.length ? matchedDetail2[i + 1].sectionStart : lines.length;
        writeScriptures(collectInlineVerses(lines.slice(m.sectionStart, end)), m.year, m.seq);
      });
    }
  }

  return count;
}

// ── 8. 主函数 ─────────────────────────────────────────────────────────────────
function main() {
  if (!fs.existsSync(RESOURCE_DIR)) {
    console.error('资源目录不存在: ' + RESOURCE_DIR);
    process.exit(1);
  }

  var total = 0;
  var entries = fs.readdirSync(RESOURCE_DIR);

  // ── 先处理根目录合辑文件（后处理的年份子目录文件会覆盖它）────────────────
  var rootFiles = entries
    .filter(function(f) { return f.toLowerCase().endsWith('.txt'); })
    .sort();

  rootFiles.forEach(function(f) {
    var n = processFile(path.join(RESOURCE_DIR, f), false);
    if (n > 0) console.log('  [合辑] ' + f + ' → ' + n + ' 个训练');
    total += n;
  });

  // ── 再处理年份子目录（覆盖合辑的同 year-seq 输出）────────────────────────
  var years = entries
    .filter(function(name) {
      var full = path.join(RESOURCE_DIR, name);
      return /^\d{4}$/.test(name) && fs.statSync(full).isDirectory();
    })
    .sort();

  years.forEach(function(yr) {
    var yearDir = path.join(RESOURCE_DIR, yr);
    var txts = fs.readdirSync(yearDir)
      .filter(function(f) { return f.toLowerCase().endsWith('.txt'); })
      .sort();

    var yearCount = 0;
    txts.forEach(function(t) {
      var n = processFile(path.join(yearDir, t), true);
      yearCount += n;
    });

    if (yearCount > 0) {
      console.log('  [' + yr + '] ' + txts.length + ' 个文件 → ' + yearCount + ' 个训练');
    }
    total += yearCount;
  });

  console.log('\n共写出 ' + total + ' 个训练的 training.json');
}

main();
