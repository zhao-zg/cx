#!/usr/bin/env node
/**
 * 测试 parseOldCombinedFile 的修正：
 * 比对导入结果与已有 build output 的章节数。
 */
'use strict';
var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var TXT  = path.join(ROOT, 'resource/历史合辑/97-25-特会合辑.txt');

// ── 加载 txt-importer.js（Node.js 环境） ─────────────────────────────────────
var global_ = { localforage: null };
(function() {
  var src = fs.readFileSync(path.join(ROOT, 'src/static/js/txt-importer.js'), 'utf8');
  // 执行模块
  var fn = new Function('window', src);
  fn(global_);
})();

var imp = global_.CXLocalImport;
if (!imp) { console.error('CXLocalImport not found'); process.exit(1); }

// ── 读取合辑文件 ──────────────────────────────────────────────────────────────
console.log('Reading combined file...');
var text  = fs.readFileSync(TXT, 'utf8');
var lines = text.split('\n');
console.log('Lines: ' + lines.length);
text = null; // GC

// ── 检测格式 ──────────────────────────────────────────────────────────────────
if (!imp.isOldCombinedFormat(lines)) { console.error('Not old combined format'); process.exit(1); }
console.log('Format: old combined ✓');

// ── 解析 ──────────────────────────────────────────────────────────────────────
var start = Date.now();
var trainings = imp.parseOldCombinedFile(lines, function(done, total) {
  if (done % 50 === 0 || done === total) process.stderr.write('\r' + done + '/' + total + '  ');
});
process.stderr.write('\n');
console.log('Parse time: ' + (Date.now() - start) + 'ms');
console.log('Trainings: ' + trainings.length);

// ── 与 build output 比对章节数 ────────────────────────────────────────────────
var outputBase = path.join(ROOT, 'output');
var matchCount = 0, mismatch = 0, noOutput = 0;

for (var i = 0; i < trainings.length; i++) {
  var t     = trainings[i];
  var year  = t.year;
  var seq   = t.season ? parseInt(t.season.slice(0, 2), 10) : (i + 1);
  var seqStr = seq < 10 ? '0' + seq : '' + seq;
  var dir   = path.join(outputBase, year + '-' + seqStr);
  var jsonP = path.join(dir, 'training.json');

  if (!fs.existsSync(jsonP)) { noOutput++; continue; }

  var built = JSON.parse(fs.readFileSync(jsonP, 'utf8'));
  var bCh   = (built.chapters || []).length;
  var iCh   = (t.chapters   || []).length;

  if (bCh !== iCh) {
    mismatch++;
    console.log('[MISMATCH] ' + year + '-' + seqStr + ' "' + t.title + '"'
      + '  import=' + iCh + '  build=' + bCh);
  } else {
    matchCount++;
  }
}

console.log('\nMatch   : ' + matchCount);
console.log('Mismatch: ' + mismatch);
console.log('NoOutput: ' + noOutput);

// ── 前 5 个训练详情 ───────────────────────────────────────────────────────────
console.log('\n== First 5 trainings ==');
for (var i = 0; i < Math.min(5, trainings.length); i++) {
  var t = trainings[i];
  var ch0 = t.chapters[0] || {};
  console.log(i + ': ' + t.year + ' "' + t.title + '"'
    + '  chapters=' + t.chapters.length
    + (ch0.title ? '  ch0="' + ch0.title + '"' : ''));
}
