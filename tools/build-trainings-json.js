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
var ENRICHER    = path.join(ROOT, 'src', 'static', 'js', 'training-enricher.js');

require(TXT_IMP);
require(REF_DET);
require(ENRICHER);

var _imp = global.window.CXLocalImport;
var _ref = global.window.CXRef;
var _enr = global.window.CXEnricher;

if (!_imp || !_imp.parseSingleTraining) {
  console.error('错误: txt-importer.js 未正确暴露 parseSingleTraining');
  process.exit(1);
}
if (!_ref || !_ref.expandCnRefs) {
  console.error('错误: ref-detector.js 未正确暴露 expandCnRefs');
  process.exit(1);
}
if (!_enr || !_enr.enrichChapter) {
  console.error('错误: training-enricher.js 未正确暴露 enrichChapter');
  process.exit(1);
}

var parseSingleTraining        = _imp.parseSingleTraining;
var parseCombinedFile          = _imp.parseCombinedFile;
var isOldCombinedFormat        = _imp.isOldCombinedFormat;
var parseOldCombinedFile       = _imp.parseOldCombinedFile;
var detectDetailStart          = _imp.detectDetailStart;
var extractYearSeqFromFilename = _imp.extractYearSeqFromFilename;
var collectInlineVerses        = _imp.collectInlineVerses;
var detectTrainingBoundaries   = _imp.detectTrainingBoundaries;
var enrichChapter              = _enr.enrichChapter;

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

// ── 4. 富化函数（由 training-enricher.js 提供）─────────────────────────────────
// enrichChapter = _enr.enrichChapter（已在上方赋局部变量）

// ── 4b. 同年重复检测（同年第一章相同则为合辑总览文件，跳过）────────────────────
// key: "YYYY|ch0title"，在 main() 按年分批重置，避免跨年误判
var seenFirstChapters = {};

// ── 4c. 多段文件追加 seq 分配 ──────────────────────────────────────────────────
// 本年文件名中最大 seq 号（在 main() 按年预计算）
var yearMaxSeq = 0;
// 本年已追加的额外训练段数（在 main() 按年重置）
var extraSeqCounter = 0;

// ── 5. 写出 training.json ─────────────────────────────────────────────────────
function normalizeSourceAbbr(text) {
  return text.replace(/李常受文集/g, 'CWWL').replace(/生命读经/g, 'L-S');
}

function writeTraining(td, year, seq) {
  if (yearFilter && year !== yearFilter) return false;
  var seqStr = seq < 10 ? '0' + seq : '' + seq;
  var dirName = year + '-' + seqStr;
  var outDir  = path.join(OUTPUT_DIR, dirName);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'training.json'),
    normalizeSourceAbbr(JSON.stringify(td, null, 2)),
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
 * 检测年份子目录文件内是否包含多个训练（通过"TOP"行 + 年份标题边界分割）。
 * 某些文件将两个训练合并存放（如感恩节特会 + 全时间训练），以 TOP 行分隔。
 * 返回按训练分割的 lines 数组；若只有一段则返回 null（无需分割）。
 */
function splitMultiTrainingSegments(lines) {
  var YEAR_HEADER_RE = /^[一二三四五六七八九○〇零]{4}[年秋春夏冬]/;
  var segments = [];
  var currentStart = 0;
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== 'TOP') continue;
    // 向后最多3行找年份标题（跳过空行）
    for (var j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      var nxt = lines[j].trim();
      if (!nxt) continue;
      if (YEAR_HEADER_RE.test(nxt)) {
        segments.push(lines.slice(currentStart, i)); // 当前段截止 TOP 之前
        currentStart = j; // 下一段从年份标题开始
      }
      break;
    }
  }
  if (segments.length === 0) return null; // 无分段
  segments.push(lines.slice(currentStart));
  return segments;
}

/**
 * 剥离多段文件中的共享 detail 区（`─{20}详细信息─{20}` 之后的所有内容）。
 * 用于第二段及以后的解析：让 parseSingleTraining 只看索引区，使用 msgTitles，
 * 避免 detail 区从第一段章节开始导致章节标题错误。
 */
function stripSharedDetailArea(lines) {
  for (var i = 0; i < lines.length; i++) {
    if (/^─{20,}$/.test(lines[i].trim())) {
      if (i + 1 < lines.length && lines[i + 1].indexOf('详细信息') >= 0) {
        return lines.slice(0, i);
      }
    }
  }
  return lines; // 未找到 detail 分隔符，原样返回
}


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

    // 检测文件内是否含多个训练（TOP + 年份标题边界），分段处理
    var segments = splitMultiTrainingSegments(lines) || [lines];

    segments.forEach(function(segLines, seqOffset) {
      // 第一段用文件名 seq；追加段用「本年最大 seq + 累计追加计数」
      var seqNum = seqOffset === 0 ? ys.seq : (yearMaxSeq + (++extraSeqCounter));
      var seqStr = seqNum < 10 ? '0' + seqNum : '' + seqNum;

      // 额外段（seqOffset > 0）的特殊处理：
      // 1. 若输出目录已存在（由合辑文件写入），跳过以保留更完整的合辑版本
      // 2. 剥离共享 detail 区，仅用索引区解析章节标题，避免 detail 区混入前段章节
      if (seqOffset > 0) {
        var extraDir = path.join(OUTPUT_DIR, ys.year + '-' + seqStr);
        if (fs.existsSync(extraDir)) {
          console.log('    [跳过额外段] ' + filename + ' 段' + (seqOffset + 1) + ': ' + ys.year + '-' + seqStr + ' 已由合辑文件写入');
          return;
        }
        segLines = stripSharedDetailArea(segLines);
      }

      var td;
      try {
        td = parseSingleTraining(segLines, 'local-' + ys.year + '-' + seqStr);
      } catch (e) {
        console.warn('  [解析失败] ' + filename + (seqOffset ? ' 段' + (seqOffset + 1) : '') + ': ' + e.message);
        return;
      }
      td.year = ys.year; // 年份子目录文件始终使用文件名中的年份
      // 同年重复检测：若前3章标题组合已被同年更早的文件注册，则跳过
      var dupSig = td.chapters.slice(0, 3).map(function(c) { return c.title; }).join('|');
      var dupKey = ys.year + '|' + dupSig;
      if (dupSig && seenFirstChapters[dupKey]) {
        if (seqOffset === 0) {
          console.warn('  [跳过重复] ' + filename + '（前3章与已有训练重复）');
          var oldDir = path.join(OUTPUT_DIR, ys.year + '-' + seqStr);
          if (fs.existsSync(oldDir)) {
            fs.rmSync(oldDir, { recursive: true, force: true });
            console.warn('  [删除旧目录] ' + ys.year + '-' + seqStr);
          }
        } else {
          console.warn('  [跳过重复] ' + filename + ' 段' + (seqOffset + 1) + '（' + td.title + '，与本年已有训练重复）');
        }
        return;
      }
      if (dupSig) seenFirstChapters[dupKey] = true;
      // 经文提取：第一段扫全文（含导航链接），后续段只扫本段
      var verseSrcLines = seqOffset === 0 ? lines : segLines;
      if (enrichAndWrite(td, ys.year, seqNum)) {
        writeScriptures(collectInlineVerses(verseSrcLines), ys.year, seqNum);
        count++;
        if (seqOffset > 0) {
          console.log('    [多段追加] ' + filename + ' → 段' + (seqOffset + 1) + ': ' + td.title + ' seq=' + seqNum);
        }
      }
    });

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
      // ── 普通合辑 或 单训练文件 ────────────────────────────────────────────
      // 经文提取：单训练扫全文；合辑按边界切片（与浏览器端保持一致）

      if (isCombined) {
        var boundaries = detectTrainingBoundaries(lines);
        for (var bi = 0; bi < boundaries.length; bi++) {
          boundaries[bi].end = bi + 1 < boundaries.length
            ? boundaries[bi + 1].idxStart : lines.length;
        }
      }

      results.forEach(function(td2, bIdx) {
        var pm = (td2.path || '').match(/^local-(\d+)-(\d+)/);
        if (!pm) return;
        var year2 = parseInt(pm[1], 10);
        var seq2  = parseInt(pm[2], 10);
        if (!year2 || !seq2) return;
        if (enrichAndWrite(td2, year2, seq2)) {
          count++;
          if (!isCombined) {
            writeScriptures(collectInlineVerses(lines), year2, seq2);
          } else if (bIdx < boundaries.length) {
            writeScriptures(
              collectInlineVerses(lines.slice(boundaries[bIdx].idxStart, boundaries[bIdx].end)),
              year2, seq2
            );
          }
        }
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
    // 每年重置第一章去重表（避免跨年误判）及多段追加计数
    seenFirstChapters = {};
    extraSeqCounter = 0;
    var yearDir = path.join(RESOURCE_DIR, yr);
    var txts = fs.readdirSync(yearDir)
      .filter(function(f) { return f.toLowerCase().endsWith('.txt'); })
      .sort();
    // 预计算本年最大 seq（用于多段文件的追加训练序号，避免与已有文件冲突）
    yearMaxSeq = 0;
    txts.forEach(function(t) {
      var ys0 = extractYearSeqFromFilename(t);
      if (ys0 && ys0.seq > yearMaxSeq) yearMaxSeq = ys0.seq;
    });

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
