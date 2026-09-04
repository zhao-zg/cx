// Task 2: pairEn 等长配对纯函数
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

test('等长数组配对', () => {
  const got = CXB.pairEn(['a', 'b'], ['一', '二']);
  assert.deepEqual(got, [{ cn: '一', en: 'a' }, { cn: '二', en: 'b' }]);
});

test('英文短于中文：缺英文项 en 为 null', () => {
  const got = CXB.pairEn(['a'], ['一', '二']);
  assert.deepEqual(got, [{ cn: '一', en: 'a' }, { cn: '二', en: null }]);
});

test('英文为空数组：全部 en 为 null', () => {
  const got = CXB.pairEn([], ['一', '二']);
  assert.deepEqual(got, [{ cn: '一', en: null }, { cn: '二', en: null }]);
});

test('英文为 null：全部 en 为 null', () => {
  const got = CXB.pairEn(null, ['一']);
  assert.deepEqual(got, [{ cn: '一', en: null }]);
});

test('中文为 null：以英文为准输出（cn 空串）', () => {
  const got = CXB.pairEn(['a'], null);
  assert.deepEqual(got, [{ cn: '', en: 'a' }]);
});

test('英文长于中文：多余英文不输出（以中文为主）', () => {
  const got = CXB.pairEn(['a', 'b'], ['一']);
  assert.deepEqual(got, [{ cn: '一', en: 'a' }, { cn: '', en: 'b' }]);
});

test('中文为空数组、英文非空：以英文为准输出', () => {
  const got = CXB.pairEn(['a', 'b'], []);
  assert.deepEqual(got, [{ cn: '', en: 'a' }, { cn: '', en: 'b' }]);
});

test('两侧均空/null：返回空数组', () => {
  assert.deepEqual(CXB.pairEn([], []), []);
  assert.deepEqual(CXB.pairEn(null, null), []);
});
