#!/usr/bin/env node
/**
 * enrich-training.js — 对已有的 training.json 进行晨兴富化（feeding_refs 等）
 *
 * 用法:
 *   node tools/enrich-training.js --input <training.json>
 *   node tools/enrich-training.js --input <training.json> --in-place
 *
 * 功能:
 *   1. 读取 training.json
 *   2. 使用 training-enricher.js + ref-detector.js 富化每个 chapter
 *   3. 写回 training.json（原地或新路径）
 *
 * 与 build-batch-txt.js 共享同一套富化逻辑。
 */

'use strict';

var fs   = require('fs');
var path = require('path');

// ── 参数解析 ──────────────────────────────────────────────────────────────
var inputPath = null;
var inPlace = true;

for (var ai = 2; ai < process.argv.length; ai++) {
  if (process.argv[ai] === '--input' && process.argv[ai + 1]) {
    inputPath = process.argv[++ai];
  } else if (process.argv[ai] === '--in-place') {
    inPlace = true;
  }
}

if (!inputPath) {
  console.error('用法: node tools/enrich-training.js --input <training.json>');
  process.exit(1);
}

// ── 加载 IIFE 模块 ──────────────────────────────────────────────────────
var ROOT     = path.resolve(__dirname, '..');
var REF_DET  = path.join(ROOT, 'src', 'static', 'js', 'ref-detector.js');
var ENRICHER = path.join(ROOT, 'src', 'static', 'js', 'training-enricher.js');

global.window = {};

require(REF_DET);
require(ENRICHER);

var _enr = global.window.CXEnricher;

if (!_enr || !_enr.enrichChapter) {
  console.error('错误: training-enricher.js 未正确暴露 enrichChapter');
  process.exit(1);
}

var enrichChapter = _enr.enrichChapter;

// ── 主逻辑 ──────────────────────────────────────────────────────────────
function main() {
  if (!fs.existsSync(inputPath)) {
    console.error('training.json 不存在: ' + inputPath);
    process.exit(1);
  }

  var td = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

  // 富化晨兴字段
  var chapters = td.chapters || [];
  chapters.forEach(enrichChapter);

  // 规范化出处缩写
  var jsonText = JSON.stringify(td, null, 2)
    .replace(/李常受文集/g, 'CWWL')
    .replace(/生命读经/g, 'L-S');

  fs.writeFileSync(inputPath, jsonText, 'utf8');
  console.error('[ENRICH] 已富化 ' + chapters.length + ' 篇章 → ' + inputPath);
}

main();
