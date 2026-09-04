// Task 1: bilingual.js 骨架 + 语言模式开关
// localStorage stub 必须在 require 之前就绪（IIFE 在加载时可能读取）
global.window = {};
global.localStorage = {
  _s: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._s, k) ? this._s[k] : null; },
  setItem(k, v) { this._s[k] = String(v); },
  removeItem(k) { delete this._s[k]; },
};

require('../src/static/js/bilingual.js');
const CXB = global.window.CXBilingual;

const { test } = require('node:test');
const assert = require('node:assert');

test('CXBilingual 已挂载到 window', () => {
  assert.ok(CXB, 'window.CXBilingual 应存在');
  assert.equal(typeof CXB, 'object');
});

test('isEnchsMode 默认 false', () => {
  assert.equal(typeof CXB.isEnchsMode, 'function');
  assert.equal(CXB.isEnchsMode(), false, '未设置过 cx_lang_mode 时应返回 false');
});

test('setEnchsMode(true) 后 isEnchsMode 返回 true，写入 cx_lang_mode', () => {
  CXB.setEnchsMode(true);
  assert.equal(CXB.isEnchsMode(), true);
  assert.equal(global.localStorage.getItem('cx_lang_mode'), 'enchs');
});

test('setEnchsMode(false) 后 isEnchsMode 返回 false，清空 cx_lang_mode', () => {
  CXB.setEnchsMode(false);
  assert.equal(CXB.isEnchsMode(), false);
  assert.equal(global.localStorage.getItem('cx_lang_mode'), null);
});

test('非法 localStorage 值视为中文模式（防御）', () => {
  global.localStorage.setItem('cx_lang_mode', 'garbage');
  assert.equal(CXB.isEnchsMode(), false, '非 enchs 值应返回 false');
  global.localStorage.removeItem('cx_lang_mode');
});

test('localStorage 异常时不抛错（防御）', () => {
  const orig = global.localStorage.getItem;
  global.localStorage.getItem = () => { throw new Error('storage broken'); };
  assert.doesNotThrow(() => CXB.isEnchsMode(), '读取异常应静默返回 false');
  global.localStorage.getItem = orig;
});
