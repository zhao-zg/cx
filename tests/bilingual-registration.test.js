// Task 7: bilingual.js 注册测试
// ① index.html 有 <script src="js/bilingual.js"> 且在 renderer.js 之前
// ② index.html __cxCoreUrls 含 './js/bilingual.js'（PWA 缓存校验）
// ③ main.py shared_js_files 含 'bilingual.js'（构建复制到 output/）
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { test } = require('node:test');
const assert = require('node:assert');

// 项目根 = tests/ 的上一级（兼容从任意 CWD 运行）
const ROOT = path.resolve(__dirname, '..');

const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'src', 'static', 'index.html'), 'utf8');
const MAIN_PY = fs.readFileSync(path.join(ROOT, 'main.py'), 'utf8');

test('① index.html 包含 bilingual.js 脚本标签且位于 renderer.js 之前', () => {
    const blTag = '<script src="js/bilingual.js"></script>';
    const rdTag = '<script src="js/renderer.js"></script>';
    assert.ok(INDEX_HTML.includes(blTag), 'index.html 缺少 ' + blTag);
    const blIdx = INDEX_HTML.indexOf(blTag);
    const rdIdx = INDEX_HTML.indexOf(rdTag);
    assert.ok(rdIdx !== -1, 'index.html 缺少 renderer.js 标签');
    assert.ok(blIdx < rdIdx,
        'bilingual.js 必须在 renderer.js 之前加载（renderer 挂载时读取 CXBilingual）');
});

test('② index.html __cxCoreUrls 含 ./js/bilingual.js', () => {
    // 只检查 __cxCoreUrls 数组区段，避免误匹配其他位置
    const m = INDEX_HTML.match(/window\.__cxCoreUrls\s*=\s*\[([\s\S]*?)\]/);
    assert.ok(m, 'index.html 未找到 __cxCoreUrls 定义');
    assert.ok(m[1].includes("'./js/bilingual.js'"),
        '__cxCoreUrls 缺少 \'./js/bilingual.js\'（PWA 预缓存清单需覆盖）');
});

test('③ main.py shared_js_files 含 bilingual.js', () => {
    const m = MAIN_PY.match(/shared_js_files\s*=\s*\[([\s\S]*?)\]/);
    assert.ok(m, 'main.py 未找到 shared_js_files 定义');
    assert.ok(m[1].includes("'bilingual.js'"),
        'shared_js_files 缺少 \'bilingual.js\'（构建不会复制到 output/js/）');
});

// 消除未使用变量提示（os 预留给未来测试扩展）
void os;
