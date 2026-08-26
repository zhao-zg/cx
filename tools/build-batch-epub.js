#!/usr/bin/env node
/**
 * build-batch-epub.js — 从批次 resource 文件夹中的 EPUB 文件生成 training.json
 *
 * 用法:
 *   node tools/build-batch-epub.js --epub <epub_file> --folder <batch_folder> --output <output_dir>
 *                                   [--year YYYY] [--season 季节]
 *
 * 功能:
 *   1. 使用 epub-importer.js 解析 EPUB（与浏览器端共用同一份 JS）
 *   2. 使用 training-enricher.js 富化 feeding_refs
 *   3. 写出 training.json
 *   4. 复制标语诗歌图片到 output/images/
 *   5. 输出元数据 JSON 到 stdout（供 Python 读取）
 *
 * 与 build-batch-txt.js 同架构：require 前端 JS 模块，避免 Python 重写导致的逻辑分叉。
 */

'use strict';

var fs   = require('fs');
var path = require('path');

// ── 参数解析 ─────────────────────────────────────────────────────────────────
var argv = process.argv.slice(2);
var optEpubFile  = null;
var optFolder    = null;
var optOutput    = null;
var optYear      = null;
var optSeason    = null;

for (var i = 0; i < argv.length; i++) {
  if (argv[i] === '--epub'   && i + 1 < argv.length) { optEpubFile = argv[++i]; continue; }
  if (argv[i] === '--folder' && i + 1 < argv.length) { optFolder   = argv[++i]; continue; }
  if (argv[i] === '--output' && i + 1 < argv.length) { optOutput   = argv[++i]; continue; }
  if (argv[i] === '--year'   && i + 1 < argv.length) { optYear     = argv[++i]; continue; }
  if (argv[i] === '--season' && i + 1 < argv.length) { optSeason   = argv[++i]; continue; }
}

if (!optEpubFile || !optFolder || !optOutput) {
  console.error('用法: node tools/build-batch-epub.js --epub <epub_file> --folder <batch_folder> --output <output_dir>');
  process.exit(1);
}

if (!fs.existsSync(optEpubFile)) {
  console.error('EPUB 文件不存在: ' + optEpubFile);
  process.exit(1);
}

// ── 设置全局环境（模拟浏览器）────────────────────────────────────────────────
var ROOT     = path.resolve(__dirname, '..');
var JSZIP_JS = path.join(ROOT, 'node_modules', 'jszip', 'dist', 'jszip.min.js');
var VENDOR_JSZIP = path.join(ROOT, 'src', 'static', 'js', 'vendor', 'jszip.min.js');
var EPUB_IMP = path.join(ROOT, 'src', 'static', 'js', 'epub-importer.js');
var REF_DET  = path.join(ROOT, 'src', 'static', 'js', 'ref-detector.js');
var ENRICHER = path.join(ROOT, 'src', 'static', 'js', 'training-enricher.js');

// jsdom 提供 DOMParser 和 document
var jsdom = require('jsdom');
var dom   = new jsdom.JSDOM('<!DOCTYPE html><html><body></body></html>');

global.window = dom.window;
global.document = dom.window.document;

// 从 config.yaml 读取 use_outline_fallback（听抄是否允许纲目回退填充，默认不侵入）
// 注入 window.CX_SERVERS，使 epub-importer.js 的运行时配置在构建端保持一致
(function () {
  var val = false;
  try {
    var cfgPath = path.join(ROOT, 'config.yaml');
    var txt = fs.readFileSync(cfgPath, 'utf-8');
    var m = txt.match(/^use_outline_fallback\s*:\s*(true|false)\s*$/m);
    if (m) val = (m[1] === 'true');
  } catch (e) { /* 读取失败则使用默认 false */ }
  global.window.CX_SERVERS = { useOutlineFallback: val };
})();
global.DOMParser = dom.window.DOMParser;
global.XMLSerializer = dom.window.XMLSerializer;
global.Text = dom.window.Text;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.NodeList = dom.window.NodeList;
global.HTMLElement = dom.window.HTMLElement;
global.HTMLParagraphElement = dom.window.HTMLParagraphElement;
global.XMLHttpRequest = dom.window.XMLHttpRequest;

// JSZip：npm 包直接 require，手动注册到 window（epub-importer.js 通过 win.JSZip 使用）
global.window.JSZip = require('jszip');

// localforage 模拟（Node.js 不需要持久化）
global.localforage = {
  getItem:    function() { return Promise.resolve(null); },
  setItem:    function(k, v) { return Promise.resolve(v); },
  removeItem: function() { return Promise.resolve(); }
};

// require epub-importer.js
require(EPUB_IMP);
require(REF_DET);
require(ENRICHER);

var _epub = global.window.CXEpubImport;
var _enr  = global.window.CXEnricher;

if (!_epub || !_epub.parseAndSave) {
  console.error('错误: epub-importer.js 未正确暴露 CXEpubImport.parseAndSave');
  process.exit(1);
}
if (!_enr || !_enr.enrichChapter) {
  console.error('错误: training-enricher.js 未正确暴露 enrichChapter');
  process.exit(1);
}

// ── 工具函数 ─────────────────────────────────────────────────────────────────

function getNowVersion() {
  var d = new Date();
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  return '' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate())
    + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
}

/** 规范化出处缩写（与 Python generator._normalize_source_abbr 一致） */
function normalizeSourceAbbr(text) {
  return text.replace(/李常受文集/g, 'CWWL').replace(/生命读经/g, 'L-S');
}

/** 从文件夹名提取 year/season */
function extractYearSeasonFromFolder(folderName) {
  var m = folderName.match(/^(\d{4})-(\d{2})/);
  if (m) {
    return { year: parseInt(m[1], 10), month: parseInt(m[2], 10) };
  }
  return null;
}

/** 复制标语诗歌图片 */
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

/** 从 EPUB ZIP 中提取诗歌图片到 output/images/，同时填充 hymn_images */
function extractHymnImages(epubBuffer, chapters, outputDir) {
  var JSZip = require('jszip');
  var count = 0;

  // 同步方式：直接用 node 解压
  var zipData = new JSZip();
  // JSZip.loadAsync 是异步的，但我们需要在同步上下文中处理
  // 使用同步解压方式
  var AdmZip = null;
  try { AdmZip = require('adm-zip'); } catch(e) {}

  if (!AdmZip) {
    // 回退：使用 JSZip 异步方式（在同步回调中无法使用，直接跳过）
    console.error('[EPUB] 警告: adm-zip 未安装，无法提取诗歌图片。运行 npm install adm-zip');
    return 0;
  }

  try {
    var zip = new AdmZip(epubBuffer);
    var entries = zip.getEntries();
    var entryMap = {};
    entries.forEach(function(e) { entryMap[e.entryName] = e; });

    var imgDir = path.join(outputDir, 'images');
    fs.mkdirSync(imgDir, { recursive: true });

    // 先找到 OPF 目录
    var opfDir = '';
    var containerEntry = entryMap['META-INF/container.xml'];
    if (containerEntry) {
      var containerXml = containerEntry.getData().toString('utf8');
      var opfMatch = containerXml.match(/full-path="([^"]+)"/);
      if (opfMatch) {
        var opfPath = opfMatch[1];
        opfDir = opfPath.indexOf('/') >= 0 ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
      }
    }

    chapters.forEach(function(ch) {
      if (!ch.hymn_image) return;
      // hymn_image 格式为 "1_hymn.png"，EPUB 内路径为 "OPS/1_hymn.png"
      var imgFilename = path.basename(ch.hymn_image);
      var imgPath = opfDir + imgFilename;
      var entry = entryMap[imgPath];
      if (entry) {
        var dstPath = path.join(imgDir, imgFilename);
        fs.writeFileSync(dstPath, entry.getData());
        ch.hymn_images = ['images/' + imgFilename];
        count++;
      }
    });
  } catch(e) {
    console.error('[EPUB] 提取诗歌图片失败: ' + (e.message || e));
  }

  return count;
}

// ── 主逻辑 ────────────────────────────────────────────────────────────────────
function main() {
  console.error('[EPUB] 使用文件: ' + path.basename(optEpubFile));

  // 读取 EPUB 为 ArrayBuffer
  var epubBuffer = fs.readFileSync(optEpubFile);
  var arrayBuf = epubBuffer.buffer.slice(epubBuffer.byteOffset, epubBuffer.byteOffset + epubBuffer.byteLength);
  var fileName = path.basename(optEpubFile);

  console.error('[EPUB] 解析中...');

  // 调用 epub-importer.js 的 parseFromBuffer（共用浏览器端同一份解析逻辑）
  _epub.parseFromBuffer(arrayBuf, fileName, function(cur, total, msg) {
    console.error('[EPUB] ' + msg + ' (' + cur + '/' + total + ')');
  }).then(function(td) {
    // 从文件夹名补充 year/season
    var folderInfo = extractYearSeasonFromFolder(path.basename(optFolder));
    var finalYear   = optYear || td.year || (folderInfo && folderInfo.year) || 2025;
    var finalSeason = optSeason || td.season || '';

    td.year = finalYear;
    if (finalSeason) td.season = finalSeason;

    // 富化晨兴字段
    (td.chapters || []).forEach(_enr.enrichChapter);

    // 添加版本
    td.version = getNowVersion();

    // 标记为非合辑：当前构建的训练默认可直接显示，不需要额外下载
    td.is_collection = false;

    // ── 复制标语诗歌图片 ────────────────────────────────────────────────────
    fs.mkdirSync(optOutput, { recursive: true });
    var mottoImages = copyMottoSongImages(optFolder, optOutput);
    if (mottoImages.length) {
      td.motto_song_image  = mottoImages[0];
      td.motto_song_images = mottoImages;
      console.error('[EPUB] 复制标语诗歌图片 ' + mottoImages.length + ' 张');
    }

    // ── 从 EPUB ZIP 中提取诗歌图片到 output/images/ ──────────────────────
    var hymnImages = extractHymnImages(epubBuffer, td.chapters || [], optOutput);
    if (hymnImages > 0) {
      console.error('[EPUB] 提取诗歌图片 ' + hymnImages + ' 张');
    }

    // ── 写出 training.json ──────────────────────────────────────────────────
    var jsonPath = path.join(optOutput, 'training.json');
    var jsonText = normalizeSourceAbbr(JSON.stringify(td, null, 2));
    fs.writeFileSync(jsonPath, jsonText, 'utf8');
    console.error('[EPUB] training.json 已写出 (' + (td.chapters || []).length + ' 篇章)');

    // ── 输出元数据 JSON 到 stdout（供 Python 读取）───────────────────────────
    var meta = {
      name:          path.basename(optFolder),
      year:          finalYear,
      season:        finalSeason,
      title:         td.title || '',
      subtitle:      td.subtitle || '',
      chapter_count: (td.chapters || []).length,
      images:        mottoImages,
      version:       td.version,
      is_collection: false,
      source:        'epub'
    };

    process.stdout.write(JSON.stringify(meta));
  }).catch(function(err) {
    console.error('[EPUB] 解析失败: ' + (err.message || err));
    console.error(err.stack || '');
    process.exit(1);
  });
}

main();
