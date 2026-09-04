// 纯英文模式（cn / enchs / en 三态）
// TDD 红灯测试：
// ① bilingual.js 新增 getLangMode/isEnMode/setLangMode 三态 API，旧二态 API 保持兼容
// ② renderer.js 纯英文模式：不出现 pair-bilingual / pair-cn；英文主位直接输出（无 pair 包装）；
//    缺英文段自然降级中文；CN 模式输出保持逐字节不变（老测试继续全绿）
// ③ TTS：纯英文模式 lang=en-US；CN 模式显式 zh-CN
//
// 环境要点与 bilingual-render.test.js 相同：IIFE 加载前 stub window/document/
// localStorage/sessionStorage/fetch；CXSearch 预置 {}；bottomControlBar/playPauseBtn 非 null。

const fs = require('fs');
const path = require('path');

const TRAINING_PATH = path.resolve(__dirname, '..', 'output', '2026-04', 'training.json');
const ENCHS_PATH = path.resolve(__dirname, '..', 'output', '2026-04', 'training-enchs.json');

const trainingRaw = fs.readFileSync(TRAINING_PATH, 'utf8');
const enchsRaw = fs.readFileSync(ENCHS_PATH, 'utf8');
const clone = (s) => JSON.parse(s);

// ── DOM stub ─────────────────────────────────────────────────────────────
function fakeEl() {
  return {
    _html: '',
    style: {},
    dataset: {},
    textContent: '',
    appendChild() {},
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    classList: { add() {}, remove() {}, contains() { return false; } },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}
Object.defineProperty(fakeEl.prototype, 'innerHTML', {
  get() { return this._html; },
  set(v) { this._html = String(v); },
});

const appEl = fakeEl();
const bodyEl = { appendChild() {}, querySelector() { return null; } };
const themeBtn = { parentElement: null, appendChild() {} };
themeBtn.parentElement = bodyEl;

global.document = {
  title: '',
  body: bodyEl,
  getElementById(id) {
    if (id === 'app') return appEl;
    if (id === 'homeView') return fakeEl();
    if (id === 'bottomControlBar' || id === 'playPauseBtn') return fakeEl();
    return null;
  },
  querySelector(sel) {
    if (sel === '.theme-toggle-btn') return themeBtn;
    return null;
  },
  querySelectorAll() { return []; },
  addEventListener() {},
  removeEventListener() {},
};

function makeStorage() {
  return {
    _s: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._s, k) ? this._s[k] : null; },
    setItem(k, v) { this._s[k] = String(v); },
    removeItem(k) { delete this._s[k]; },
  };
}
const lsStub = makeStorage();
const ssStub = makeStorage();
global.localStorage = lsStub;
global.sessionStorage = ssStub;

const speechCalls = [];
global.window = {
  CX_ROOT: './',
  location: { origin: '', href: 'test://x' },
  scrollY: 0,
  scrollTo() {},
  requestAnimationFrame(fn) { return setTimeout(fn, 0); },
  addEventListener() {},
  removeEventListener() {},
  CXSearch: {},
  CXSpeech: {
    init(opts) { speechCalls.push(opts || {}); },
  },
};
global.window.localStorage = lsStub;
global.window.sessionStorage = ssStub;

global.fetch = function (url) {
  const u = String(url);
  if (u.indexOf('training-enchs.json') >= 0) {
    const data = clone(enchsRaw);
    if (u.indexOf('NO-MR-EN') >= 0) {
      delete data.chapters[0].morning_revivals[0].message_reading_en;
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
  }
  if (u.indexOf('training.json') >= 0) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(clone(trainingRaw)) });
  }
  return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('404')) });
};

require('../src/static/js/bilingual.js');
require('../src/static/js/renderer.js');
const CXB = global.window.CXBilingual;
const R = () => global.window.CXRenderer;

// ── 工具 ─────────────────────────────────────────────────────────────────
async function flush(n) {
  n = n || 10;
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
}

async function renderOnce(viewType) {
  appEl.innerHTML = '';
  speechCalls.length = 0;
  R().renderChapterView('2026-04', 1, viewType);
  await flush();
  return appEl.innerHTML;
}

function countOf(html, needle) {
  let n = 0, i = 0;
  while ((i = html.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

const { test } = require('node:test');
const assert = require('node:assert');

// ══ Part 1：bilingual.js 三态 API ═════════════════════════════════════════

test('三态 API 存在：getLangMode/isEnMode/setLangMode', () => {
  assert.equal(typeof CXB.getLangMode, 'function', 'getLangMode 应存在');
  assert.equal(typeof CXB.isEnMode, 'function', 'isEnMode 应存在');
  assert.equal(typeof CXB.setLangMode, 'function', 'setLangMode 应存在');
});

test('getLangMode 默认 cn；setLangMode 三态往返', () => {
  lsStub.removeItem('cx_lang_mode');
  assert.equal(CXB.getLangMode(), 'cn', '默认中文');

  CXB.setLangMode('enchs');
  assert.equal(CXB.getLangMode(), 'enchs');
  assert.equal(lsStub.getItem('cx_lang_mode'), 'enchs');

  CXB.setLangMode('en');
  assert.equal(CXB.getLangMode(), 'en');
  assert.equal(lsStub.getItem('cx_lang_mode'), 'en');

  CXB.setLangMode('cn');
  assert.equal(CXB.getLangMode(), 'cn');
  assert.equal(lsStub.getItem('cx_lang_mode'), null, 'cn 应清空存储值');
});

test('isEnMode / isEnchsMode 按值独立判定', () => {
  CXB.setLangMode('en');
  assert.equal(CXB.isEnMode(), true);
  assert.equal(CXB.isEnchsMode(), false, '纯英文不是英中对照');

  CXB.setLangMode('enchs');
  assert.equal(CXB.isEnMode(), false);
  assert.equal(CXB.isEnchsMode(), true);
});

test('非法值防御：garbage → cn，不抛错', () => {
  lsStub.setItem('cx_lang_mode', 'garbage');
  assert.equal(CXB.getLangMode(), 'cn');
  assert.equal(CXB.isEnMode(), false);
  assert.equal(CXB.isEnchsMode(), false);
});

test('setLangMode 非法参数防御：不写脏值', () => {
  lsStub.removeItem('cx_lang_mode');
  CXB.setLangMode('jp'); // 非法 → 视为 cn（清空）
  assert.equal(CXB.getLangMode(), 'cn');
  assert.equal(lsStub.getItem('cx_lang_mode'), null);
});

test('旧二态 API 兼容：setEnchsMode(true) 等价 setLangMode("enchs")', () => {
  CXB.setEnchsMode(true);
  assert.equal(CXB.getLangMode(), 'enchs');
  assert.equal(CXB.isEnchsMode(), true);
  CXB.setEnchsMode(false);
  assert.equal(CXB.getLangMode(), 'cn');
});

// ══ Part 2：renderer.js 纯英文模式渲染 ═══════════════════════════════════

test('纯英文模式 cx：无 pair 包装，英文直接输出', async () => {
  CXB.setLangMode('en');
  const html = await renderOnce('cx');
  assert.equal(countOf(html, 'pair-bilingual'), 0, '纯英文不出现 pair-bilingual');
  assert.equal(countOf(html, 'pair-cn'), 0, '纯英文不出现 pair-cn');
  assert.ok(html.includes('Disciples, Believers, Saints, and Christians'), '英文标题');
  assert.ok(html.includes('And as Jesus passed on from there'), '英文喂养经文');
  assert.ok(html.includes('Disciples are those who follow Christ'), '英文信息选读');
  assert.ok(html.includes('Further Reading: The Conclusion of the New Testament'), '英文参读');
});

test('纯英文模式 cx：英文引用转中文 data-refs（wrapEnRefs 仍生效）', async () => {
  CXB.setLangMode('en');
  const html = await renderOnce('cx');
  assert.ok(html.includes('data-refs="太9:9"'), '英文引用已转中文标准引用');
});

test('纯英文模式 cx：缺英文段降级中文', async () => {
  // 重新 require 以隔离 enchs 缓存与 renderer _cache，用 NO-MR-EN 变体数据
  delete require.cache[require.resolve('../src/static/js/bilingual.js')];
  delete require.cache[require.resolve('../src/static/js/renderer.js')];
  require('../src/static/js/bilingual.js');
  require('../src/static/js/renderer.js');
  const origFetch = global.fetch;
  const data = clone(enchsRaw);
  delete data.chapters[0].morning_revivals[0].message_reading_en;
  global.fetch = function (url) {
    const u = String(url);
    if (u.indexOf('training-enchs.json') >= 0) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
    }
    return origFetch(url);
  };
  global.window.CXBilingual.setLangMode('en');
  const html = await renderOnce('cx');
  assert.ok(!html.includes('Disciples are those who follow Christ'), '缺英文段不应有英文');
  assert.ok(html.includes('门徒就是跟从基督的人'), '中文兜底保留');
  global.fetch = origFetch;
});

test('纯英文模式 cv：纲目英文无 pair 包装', async () => {
  // 恢复默认 fetch（前面测试篡改过）
  delete require.cache[require.resolve('../src/static/js/bilingual.js')];
  delete require.cache[require.resolve('../src/static/js/renderer.js')];
  require('../src/static/js/bilingual.js');
  require('../src/static/js/renderer.js');
  global.window.CXBilingual.setLangMode('en');
  const html = await renderOnce('cv');
  assert.equal(countOf(html, 'pair-bilingual'), 0);
  assert.ok(html.includes('We are disciples of Christ'), '英文纲目');
  assert.ok(html.includes('Matt. 5:1; 28:19; 2 Cor. 6:14-16'), '英文读经 banner');
  assert.ok(!html.includes('我们是基督的门徒'), '纯英文模式中文纲目不出现');
});

test('纯英文模式：enchs.json 404 → 整页降级纯中文', async () => {
  delete require.cache[require.resolve('../src/static/js/bilingual.js')];
  delete require.cache[require.resolve('../src/static/js/renderer.js')];
  require('../src/static/js/bilingual.js');
  require('../src/static/js/renderer.js');
  const origFetch = global.fetch;
  global.fetch = function (url) {
    const u = String(url);
    if (u.indexOf('training-enchs.json') >= 0) {
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('404')) });
    }
    return origFetch(url);
  };
  global.window.CXBilingual.setLangMode('en');
  const html = await renderOnce('cx');
  assert.equal(countOf(html, 'pair-bilingual'), 0);
  assert.ok(html.includes('第1篇 门徒、信徒、圣徒和基督徒'), '中文标题兜底');
  assert.ok(html.includes('门徒就是跟从基督的人'), '中文正文兜底');
  global.fetch = origFetch;
});

// ══ Part 3：TTS 语言跟随 ═════════════════════════════════════════════════

test('纯英文模式：TTS lang=en-US；CN 模式 zh-CN', async () => {
  delete require.cache[require.resolve('../src/static/js/bilingual.js')];
  delete require.cache[require.resolve('../src/static/js/renderer.js')];
  require('../src/static/js/bilingual.js');
  require('../src/static/js/renderer.js');
  global.window.CXBilingual.setLangMode('en');
  await renderOnce('cx');
  assert.ok(speechCalls.length >= 1, 'CXSpeech.init 已调用');
  assert.strictEqual(speechCalls[speechCalls.length - 1].lang, 'en-US', '纯英文读英文');

  global.window.CXBilingual.setLangMode('cn');
  await renderOnce('cx');
  assert.strictEqual(speechCalls[speechCalls.length - 1].lang, 'zh-CN', '中文模式 zh-CN');
});

// ══ Part 4：CN 模式回归保护（字节级不变）════════════════════════════════

test('CN 模式：输出与英中/纯英文实现共存后仍与双实例一致', async () => {
  delete require.cache[require.resolve('../src/static/js/bilingual.js')];
  delete require.cache[require.resolve('../src/static/js/renderer.js')];
  require('../src/static/js/bilingual.js');
  require('../src/static/js/renderer.js');
  lsStub.removeItem('cx_lang_mode');
  const html1 = await renderOnce('cx');
  const html2 = await renderOnce('cx');
  assert.strictEqual(html2, html1, '同数据两次渲染输出必须完全一致');
  assert.ok(html1.includes('第1篇 门徒、信徒、圣徒和基督徒'));
  assert.equal(countOf(html1, 'pair-bilingual'), 0, 'CN 模式无 pair');
});

// ══ Part 5：theme-toggle.js 面板三选项 ═══════════════════════════════════

test('设置面板含纯英文选项（data-lang="en"）', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'static', 'js', 'theme-toggle.js'), 'utf8');
  assert.ok(src.includes('data-lang="en"'), '面板应有 data-lang="en" 选项');
  assert.ok(/setLangMode\('en'\)/.test(src), '纯英文选项应调 setLangMode(\'en\')');
});
