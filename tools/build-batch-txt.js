#!/usr/bin/env node
/**
 * build-batch-txt.js — 从批次 resource 文件夹中的 TXT 文件生成 training.json
 *
 * 用法:
 *   node tools/build-batch-txt.js --folder <batch_folder> --output <output_dir> [--year YYYY] [--season 季节]
 *   node tools/build-batch-txt.js --folder <batch_folder> --output <output_dir> --txt <txt_file>
 *
 * --txt  指定具体 TXT 文件路径（如来自 历史合辑/）；不指定时自动在 --folder 中查找。
 *
 * 功能:
 *   1. 在批次文件夹中查找 .txt 文件
 *   2. 使用 txt-importer.js 解析 TXT
 *   3. 使用 training-enricher.js 富化（feeding_refs 等）
 *   4. 写出 training.json + scriptures-data.json
 *   5. 复制标语诗歌图片到 output/images/
 *   6. 输出元数据 JSON 到 stdout（供 Python 读取）
 */

'use strict';

var fs   = require('fs');
var path = require('path');

// ── 参数解析 ─────────────────────────────────────────────────────────────────
var batchFolder = null;
var outputDir   = null;
var optYear     = null;
var optSeason   = null;
var optTxtFile  = null;

for (var ai = 2; ai < process.argv.length; ai++) {
  if (process.argv[ai] === '--folder' && process.argv[ai + 1]) {
    batchFolder = process.argv[++ai];
  } else if (process.argv[ai] === '--output' && process.argv[ai + 1]) {
    outputDir = process.argv[++ai];
  } else if (process.argv[ai] === '--year' && process.argv[ai + 1]) {
    optYear = parseInt(process.argv[++ai], 10);
  } else if (process.argv[ai] === '--season' && process.argv[ai + 1]) {
    optSeason = process.argv[++ai];
  } else if (process.argv[ai] === '--txt' && process.argv[ai + 1]) {
    optTxtFile = process.argv[++ai];
  }
}

if (!batchFolder || !outputDir) {
  console.error('用法: node tools/build-batch-txt.js --folder <batch_folder> --output <output_dir>');
  process.exit(1);
}

// ── 加载 IIFE 模块 ─────────────────────────────────────────────────────────
var ROOT        = path.resolve(__dirname, '..');
var TXT_IMP     = path.join(ROOT, 'src', 'static', 'js', 'txt-importer.js');
var REF_DET     = path.join(ROOT, 'src', 'static', 'js', 'ref-detector.js');
var ENRICHER    = path.join(ROOT, 'src', 'static', 'js', 'training-enricher.js');

global.window = {};
global.localforage = {
  getItem:    function() { return Promise.resolve(null); },
  setItem:    function() { return Promise.resolve(null); },
  removeItem: function() { return Promise.resolve(null); }
};

require(TXT_IMP);
require(REF_DET);
require(ENRICHER);

var _imp = global.window.CXLocalImport;
var _enr = global.window.CXEnricher;

if (!_imp || !_imp.parseSingleTraining) {
  console.error('错误: txt-importer.js 未正确暴露 parseSingleTraining');
  process.exit(1);
}
if (!_enr || !_enr.enrichChapter) {
  console.error('错误: training-enricher.js 未正确暴露 enrichChapter');
  process.exit(1);
}

var parseSingleTraining        = _imp.parseSingleTraining;
var collectInlineVerses        = _imp.collectInlineVerses;
var extractYearSeqFromFilename = _imp.extractYearSeqFromFilename;
var cnYearToInt                = _imp.cnYearToInt;
var enrichChapter              = _enr.enrichChapter;

// ── 查找 TXT 文件 ─────────────────────────────────────────────────────────
function findTxtFiles(folder) {
  var entries = fs.readdirSync(folder);
  return entries
    .filter(function(f) { return f.toLowerCase().endsWith('.txt'); })
    .sort();
}

// ── 从文件夹名提取 year/season ────────────────────────────────────────────
function extractYearSeasonFromFolder(folderName) {
  var m = folderName.match(/^(\d{4})-(\d{2})/);
  if (m) {
    return { year: parseInt(m[1], 10), month: parseInt(m[2], 10) };
  }
  return null;
}

// ── 规范化出处缩写（与 Python generator._normalize_source_abbr 一致）─────────
function normalizeSourceAbbr(text) {
  return text.replace(/李常受文集/g, 'CWWL').replace(/生命读经/g, 'L-S');
}

// ── 获取当前时间版本号 ──────────────────────────────────────────────────────
function getNowVersion() {
  var d = new Date();
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  return '' + d.getFullYear()
    + pad2(d.getMonth() + 1) + pad2(d.getDate())
    + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
}

// ── 复制标语诗歌图片 ─────────────────────────────────────────────────────────
function copyMottoSongImages(srcFolder, dstOutputDir) {
  var images = [];
  var entries = fs.readdirSync(srcFolder);
  var songFiles = entries
    .filter(function(f) {
      return /^标语诗歌/.test(f) && /\.(png|jpe?g|webp|gif)$/i.test(f);
    })
    .sort();

  if (!songFiles.length) return images;

  var imgDir = path.join(dstOutputDir, 'images');
  fs.mkdirSync(imgDir, { recursive: true });

  songFiles.forEach(function(fname) {
    var src = path.join(srcFolder, fname);
    var dst = path.join(imgDir, fname);
    fs.copyFileSync(src, dst);
    images.push('images/' + fname);
  });

  return images;
}

// ── 懒加载 bible-text.json key 集合 ──────────────────────────────────────────
var _bibleKeys = null;
function getBibleKeys() {
  if (_bibleKeys !== null) return _bibleKeys;
  var outputRoot = path.resolve(outputDir, '..');
  var p = path.join(outputRoot, 'data', 'bible-text.json');
  if (!fs.existsSync(p)) { _bibleKeys = new Set(); return _bibleKeys; }
  var data = JSON.parse(fs.readFileSync(p, 'utf8'));
  _bibleKeys = new Set(Object.keys(data));
  return _bibleKeys;
}

// ── 主逻辑 ────────────────────────────────────────────────────────────────────
function main() {
  // 确定 TXT 文件：--txt 指定 > 批次文件夹内查找
  var txtFile, filename;
  if (optTxtFile) {
    if (!fs.existsSync(optTxtFile)) {
      console.error('指定的 TXT 文件不存在: ' + optTxtFile);
      process.exit(1);
    }
    txtFile  = optTxtFile;
    filename = path.basename(optTxtFile);
  } else {
    var txtFiles = findTxtFiles(batchFolder);
    if (!txtFiles.length) {
      console.error('未找到 TXT 文件: ' + batchFolder);
      process.exit(1);
    }
    txtFile  = txtFiles[0];
    filename = path.basename(txtFiles[0]);
  }

  console.error('[TXT] 使用文件: ' + filename);

  var text = fs.readFileSync(txtFile, 'utf8');
  var lines = text.split(/\r?\n/);

  // 全局规范化
  text = text.replace(/李常受文集/g, 'CWWL').replace(/生命读经/g, 'L-S');
  lines = text.split(/\r?\n/);

  // 解析 TXT
  var ys = extractYearSeqFromFilename(filename);
  var defaultPath = null;
  if (ys) {
    var seqStr = ys.seq < 10 ? '0' + ys.seq : '' + ys.seq;
    defaultPath = 'local-' + ys.year + '-' + seqStr;
  }

  var td;
  try {
    td = parseSingleTraining(lines, defaultPath);
  } catch (e) {
    console.error('[TXT] 解析失败: ' + e.message);
    process.exit(1);
  }

  // 从文件夹名补充 year/season（TXT 解析可能未识别到）
  var folderInfo = extractYearSeasonFromFolder(path.basename(batchFolder));
  var finalYear   = optYear || td.year || (folderInfo && folderInfo.year) || 2025;
  var finalSeason = optSeason || td.season || '';

  // 确保 year 正确
  td.year = finalYear;
  if (finalSeason) td.season = finalSeason;

  // 富化晨兴字段
  (td.chapters || []).forEach(enrichChapter);

  // 添加版本
  td.version = getNowVersion();

  // ── 复制标语诗歌图片 ──────────────────────────────────────────────────────
  fs.mkdirSync(outputDir, { recursive: true });
  var mottoImages = copyMottoSongImages(batchFolder, outputDir);
  if (mottoImages.length) {
    td.motto_song_image  = mottoImages[0];
    td.motto_song_images = mottoImages;
    console.error('[TXT] 复制标语诗歌图片 ' + mottoImages.length + ' 张');
  }

  // ── 写出 training.json ─────────────────────────────────────────────────────
  var jsonPath = path.join(outputDir, 'training.json');
  var jsonText = normalizeSourceAbbr(JSON.stringify(td, null, 2));
  fs.writeFileSync(jsonPath, jsonText, 'utf8');
  console.error('[TXT] training.json 已写出 (' + (td.chapters || []).length + ' 篇章)');

  // ── 写出 scriptures-data.json（补充经文）────────────────────────────────────
  var verseDict = collectInlineVerses(lines);
  var verseKeys = Object.keys(verseDict);
  if (verseKeys.length) {
    var bk = getBibleKeys();
    var filtered = {};
    verseKeys.forEach(function(k) { if (!bk.has(k)) filtered[k] = verseDict[k]; });
    var fkeys = Object.keys(filtered);
    if (fkeys.length) {
      var jsDir = path.join(outputDir, 'js');
      fs.mkdirSync(jsDir, { recursive: true });
      fs.writeFileSync(
        path.join(jsDir, 'scriptures-data.json'),
        JSON.stringify(filtered),
        'utf8'
      );
      console.error('[TXT] scriptures-data.json: ' + fkeys.length + ' 条补充经文');
    }
  }

  // ── 输出元数据 JSON 到 stdout（供 Python 读取）────────────────────────────
  var meta = {
    name:          path.basename(batchFolder),
    year:          finalYear,
    season:        finalSeason,
    title:         td.title || '',
    subtitle:      td.subtitle || '',
    chapter_count: (td.chapters || []).length,
    images:        mottoImages,
    version:       td.version,
    source:        'txt'
  };

  process.stdout.write(JSON.stringify(meta));
}

main();
