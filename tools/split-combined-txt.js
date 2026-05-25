#!/usr/bin/env node
/**
 * split-combined-txt.js
 *
 * 从 97-25-特会合辑.txt 中提取没有独立年份子目录文件的训练，
 * 写出为 resource/历史合辑/YYYY/YYYY-NN-title.txt。
 *
 * 用法:
 *   node tools/split-combined-txt.js           # 实际写文件
 *   node tools/split-combined-txt.js --dry-run  # 仅预览，不写文件
 *   node tools/split-combined-txt.js --year 2004 # 只处理指定年
 */
'use strict';

var fs   = require('fs');
var path = require('path');

var dryRun     = process.argv.includes('--dry-run');
var yearFilter = null;
for (var ai = 2; ai < process.argv.length; ai++) {
  if (process.argv[ai] === '--year' && process.argv[ai + 1]) {
    yearFilter = parseInt(process.argv[ai + 1], 10); ai++;
  }
}

// ── 1. 加载 txt-importer.js ──────────────────────────────────────────────────
var ROOT    = path.resolve(__dirname, '..');
var TXT_IMP = path.join(ROOT, 'src', 'static', 'js', 'txt-importer.js');

global.window = {};
global.localforage = { getItem:function(){return Promise.resolve(null);},
                       setItem:function(){return Promise.resolve(null);},
                       removeItem:function(){return Promise.resolve(null);} };
require(TXT_IMP);

var _imp = global.window.CXLocalImport;
var isOldCombinedFormat  = _imp.isOldCombinedFormat;
var parseOldCombinedFile = _imp.parseOldCombinedFile;

// ── 2. 读取合辑文件 ───────────────────────────────────────────────────────────
var RESOURCE_DIR = path.join(ROOT, 'resource', '历史合辑');
var OUTPUT_DIR   = path.join(ROOT, 'output');
var COMBINED     = path.join(RESOURCE_DIR, '97-25-特会合辑.txt');

if (!fs.existsSync(COMBINED)) { console.error('找不到合辑文件: ' + COMBINED); process.exit(1); }

var rawText = fs.readFileSync(COMBINED, 'utf8');
var lines   = rawText.split('\n');
console.log('读取合辑文件，共 ' + lines.length + ' 行');

if (!isOldCombinedFormat(lines)) { console.error('不是旧合辑格式，退出'); process.exit(1); }

// ── 3. 用 txt-importer.js 解析，获取含 rawRange 的训练列表 ──────────────────
// parseOldCombinedFile 在每个训练对象里包含 rawRange:{idxStart,idxEnd,detailStart,detailEnd}
var trainings = parseOldCombinedFile(lines, null);
console.log('解析到 ' + trainings.length + ' 个训练\n');

var SEPARATOR = '────────────────────────────────────────────────────────────';

// ── 4. 标题规范化 ─────────────────────────────────────────────────────────────
function normTitle(s) {
  return (s || '').replace(/[─—–\-\s\u3000\uff08\uff09（）,，。．]/g, '').trim();
}
function titlesMatch(a, b) {
  var na = normTitle(a), nb = normTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 4 && nb.indexOf(na) >= 0) return true;
  if (nb.length >= 4 && na.indexOf(nb) >= 0) return true;
  if (na.length >= 6 && nb.length >= 6 && na.slice(0, 6) === nb.slice(0, 6)) return true;
  return false;
}

// ── 5. 用 rawRange 提取训练原文 ───────────────────────────────────────────────
function buildTxtContent(td) {
  var r = td.rawRange;
  if (!r) return null;

  var indexLines = lines.slice(r.idxStart, r.idxEnd);
  while (indexLines.length && !indexLines[indexLines.length - 1].trim()) indexLines.pop();
  if (!indexLines.length) return null;
  if (indexLines[indexLines.length - 1].trim() !== 'TOP') indexLines.push('TOP');

  var parts = [indexLines.join('\n')];

  if (r.detailStart != null && r.detailEnd != null && r.detailEnd > r.detailStart) {
    var detailLines = lines.slice(r.detailStart, r.detailEnd);
    while (detailLines.length && !detailLines[detailLines.length - 1].trim()) detailLines.pop();
    if (detailLines.length) {
      parts.push(SEPARATOR + '\n详细信息\n' + SEPARATOR);
      parts.push(detailLines.join('\n'));
    }
  }

  return parts.join('\n');
}

// ── 6. seq 分配（同年递增） ──────────────────────────────────────────────────
var _seqCache = {};
function consumeNextSeq(year) {
  if (_seqCache[year] === undefined) {
    var dir = path.join(RESOURCE_DIR, String(year));
    var max = 0;
    if (fs.existsSync(dir)) {
      fs.readdirSync(dir).forEach(function(f) {
        var m = f.match(/^(\d{4})-(\d+)/);
        if (m) { var s = parseInt(m[2], 10); if (s > max) max = s; }
      });
    }
    _seqCache[year] = max;
  }
  return ++_seqCache[year];
}

function cleanName(t) {
  return (t || '').replace(/[\/\\:*?"<>|]/g, '').replace(/\s+/g, '').slice(0, 30);
}

// ── 7. 主逻辑 ────────────────────────────────────────────────────────────────
var created = 0, notFound = 0, duplicates = [];

var byYear = {};
fs.readdirSync(OUTPUT_DIR).forEach(function(d) {
  var m = d.match(/^(\d{4})-(\d{2})$/);
  if (!m) return;
  var y = parseInt(m[1], 10), seq = parseInt(m[2], 10);
  if (y < 1990 || y > 2030) return;
  if (yearFilter && y !== yearFilter) return;
  if (!byYear[y]) byYear[y] = [];
  byYear[y].push({ dir: d, year: y, seq: seq });
});

Object.keys(byYear).sort().forEach(function(ys) {
  var year    = parseInt(ys, 10);
  var yearDir = path.join(RESOURCE_DIR, String(year));
  var seenTitles = {};

  byYear[year].sort(function(a, b) { return a.seq - b.seq; }).forEach(function(entry) {
    var seqStr = entry.seq < 10 ? '0' + entry.seq : '' + entry.seq;

    // 读 training.json
    var tjPath = path.join(OUTPUT_DIR, entry.dir, 'training.json');
    if (!fs.existsSync(tjPath)) return;
    var tj;
    try { tj = JSON.parse(fs.readFileSync(tjPath, 'utf8')); } catch(e) { return; }
    var nt = normTitle(tj.title);

    // 检查是否有年份子目录 TXT（YYYY-NN-*.txt）
    var hasTxt = false;
    if (fs.existsSync(yearDir)) {
      hasTxt = fs.readdirSync(yearDir).some(function(f) {
        return f.startsWith(year + '-' + seqStr + '-') && f.endsWith('.txt');
      });
    }
    // 检查根目录文件（如 2026-1-ICSC.txt）
    if (!hasTxt) {
      hasTxt = fs.readdirSync(RESOURCE_DIR).some(function(f) {
        if (!f.endsWith('.txt')) return false;
        return f.startsWith(year + '-' + entry.seq + '-') ||
               f.startsWith(year + '-' + seqStr + '-');
      });
    }

    // 登记标题（含有 txt 的条目也要登记，供重复检测）
    if (!seenTitles[nt]) seenTitles[nt] = entry.dir;

    if (hasTxt) return;

    // 重复检测
    if (seenTitles[nt] !== entry.dir) {
      duplicates.push({ dirs: [seenTitles[nt], entry.dir], title: tj.title });
      return;
    }

    // 在合辑解析结果中找匹配（txt-importer.js 已解析，含 rawRange）
    var combined = null;
    for (var i = 0; i < trainings.length; i++) {
      var pm = (trainings[i].path || '').match(/^local-(\d+)/);
      if (!pm || parseInt(pm[1], 10) !== year) continue;
      if (titlesMatch(trainings[i].title, tj.title)) { combined = trainings[i]; break; }
    }
    if (!combined) {
      console.warn('  [未找到] ' + entry.dir + ' "' + tj.title + '"');
      notFound++; return;
    }

    // 直接用 rawRange 提取原文（无需重新计算边界）
    var content = buildTxtContent(combined);
    if (!content) {
      console.warn('  [无内容] ' + combined.path + ' "' + combined.title + '"');
      notFound++; return;
    }

    var nextSeq = consumeNextSeq(year);
    var ns      = nextSeq < 10 ? '0' + nextSeq : '' + nextSeq;
    var fname   = year + '-' + ns + '-' + cleanName(combined.title) + '.txt';
    var fpath   = path.join(yearDir, fname);
    var lineCount = content.split('\n').length;

    if (dryRun) {
      console.log('[预览] resource/历史合辑/' + year + '/' + fname);
      console.log('       来自 output/' + entry.dir + '  ' + lineCount + ' 行  ' +
                  (combined.rawRange.detailStart != null ? '含详细内容' : '仅INDEX'));
    } else {
      if (!fs.existsSync(yearDir)) fs.mkdirSync(yearDir, { recursive: true });
      fs.writeFileSync(fpath, content, 'utf8');
      console.log('[创建] resource/历史合辑/' + year + '/' + fname + '  (' + lineCount + '行)');
    }
    created++;
  });
});

if (duplicates.length) {
  console.log('\n⚠ 重复 output 目录（较大 seq 的可删除）:');
  duplicates.forEach(function(d) {
    console.log('  ' + d.dirs[0] + ' ↔ ' + d.dirs[1] + '  "' + d.title + '"');
  });
}
console.log('\n未找到匹配: ' + notFound);
console.log((dryRun ? '[预览] ' : '') + '已创建: ' + created + ' 个文件');
if (dryRun && created > 0) console.log('→ 去掉 --dry-run 实际执行');
