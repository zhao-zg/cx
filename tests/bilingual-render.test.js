// Task 5: renderer.js 双语渲染接入
// TDD 红灯测试：CN 模式输出必须与现状完全一致（字节级等价 + 锚点断言），
// 英中模式新增 pair-bilingual 结构（EN 主位：en 在 cn 之前）。
//
// 环境要点：renderer.js 是 IIFE，Node require 前必须就绪 global.window/document/
// localStorage/sessionStorage/fetch；window.CXSearch 需预置为 {}（否则 renderer
// 会起 5 秒轮询定时器）；document.getElementById('bottomControlBar'/'playPauseBtn')
// 必须非 null，否则 initSpeechForView 跳过 CXSpeech.init，无法断言 lang。

const fs = require('fs');
const path = require('path');

const TRAINING_PATH = path.resolve(__dirname, '..', 'output', '2026-04', 'training.json');
const ENCHS_PATH = path.resolve(__dirname, '..', 'output', '2026-04', 'training-enchs.json');

// ── 真实数据（只读）─────────────────────────────────────────────────────
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
themeBtn.parentElement = bodyEl; // rescueThemeBtn: 已在 body 上，跳过搬移

global.document = {
  title: '',
  body: bodyEl,
  getElementById(id) {
    if (id === 'app') return appEl;
    if (id === 'homeView') return fakeEl();
    if (id === 'bottomControlBar' || id === 'playPauseBtn') return fakeEl();
    return null; // backToTop 等缺失即可（renderer 均有 null 守卫）
  },
  querySelector(sel) {
    if (sel === '.theme-toggle-btn') return themeBtn;
    return null;
  },
  querySelectorAll() { return []; },
  addEventListener() {},
  removeEventListener() {},
};

// localStorage/sessionStorage：同一 stub 挂 global（renderer 裸用）与 window（bilingual 经 win 查）
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

// ── window stub ──────────────────────────────────────────────────────────
const speechCalls = [];
global.window = {
  CX_ROOT: './',
  location: { origin: '', href: 'test://x' },
  scrollY: 0,
  scrollTo() {},
  requestAnimationFrame(fn) { return setTimeout(fn, 0); },
  addEventListener() {},
  removeEventListener() {},
  CXSearch: {}, // 预置，避免 renderer 5 秒轮询；各调用点均有守卫
  CXSpeech: {
    init(opts) { speechCalls.push(opts || {}); },
  },
};
global.window.localStorage = lsStub;
global.window.sessionStorage = ssStub;

// ── fetch stub（默认成功版；各测试可重设）───────────────────────────────
function installFetch(enchsBehavior) {
  global.fetch = function (url) {
    const u = String(url);
    if (u.indexOf('training-enchs.json') >= 0) {
      if (enchsBehavior === '404') {
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('404')) });
      }
      const data = clone(enchsRaw);
      if (enchsBehavior === 'no-mr-en') {
        // 造缺英文段锚点：删掉 ch1 day1 的 message_reading_en
        delete data.chapters[0].morning_revivals[0].message_reading_en;
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
    }
    if (u.indexOf('training.json') >= 0) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(clone(trainingRaw)) });
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('404')) });
  };
}
installFetch('ok');

// ── 模块加载（bilingual 在前，renderer 依赖其 API）───────────────────────
require('../src/static/js/bilingual.js');
require('../src/static/js/renderer.js');
const CXB = global.window.CXBilingual;
const R = () => global.window.CXRenderer;

// ── 工具 ─────────────────────────────────────────────────────────────────
async function flush(n) {
  n = n || 10;
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
}

/** 渲染 ch1 指定视图并返回 app innerHTML */
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

// ══ CN 模式回归（必须全绿：现状不被破坏）════════════════════════════════

test('CN 模式：渲染成功且含中文锚点', async () => {
  lsStub.removeItem('cx_lang_mode');
  const html = await renderOnce('cx');
  assert.ok(html.includes('第1篇 门徒、信徒、圣徒和基督徒'), 'header 锚点');
  assert.ok(html.includes('晨兴喂养'), 'feeding section');
  assert.ok(html.includes('信息选读'), 'reading section');
  assert.ok(html.includes('太九9　耶稣从那里往前走'), 'feeding scripture 中文');
  assert.ok(html.includes('门徒就是跟从基督的人'), 'message_reading 中文');
  assert.ok(html.includes('参读：新约总论'), 'ref_reading 中文');
  assert.ok(html.includes('周一'), 'day tab');
});

test('CN 模式：双实例输出字节级等价（确定性回归保护）', async () => {
  lsStub.removeItem('cx_lang_mode');
  const html1 = await renderOnce('cx');
  const html2 = await renderOnce('cx');
  assert.strictEqual(html2, html1, '同数据两次渲染输出必须完全一致');
});

test('CN 模式：不出现 pair-bilingual 结构', async () => {
  lsStub.removeItem('cx_lang_mode');
  const html = await renderOnce('cx');
  assert.equal(countOf(html, 'pair-bilingual'), 0);
});

// ══ 英中模式（cx 晨读）═══════════════════════════════════════════════════

test('英中模式 cx：出现 pair-bilingual 且 en 在 cn 之前', async () => {
  lsStub.setItem('cx_lang_mode', 'enchs');
  const html = await renderOnce('cx');
  const n = countOf(html, 'pair-bilingual');
  assert.ok(n >= 1, '至少出现一个 pair-bilingual，实际=' + n);
  // 每个 pair 块内 en 段先于 cn 段（EN 主位）；按 pair 边界切分逐块校验
  const parts = html.split('<div class="pair-bilingual">');
  for (let pi = 1; pi < parts.length; pi++) {
    const seg = parts[pi];
    const enAt = seg.indexOf('class="pair-en"');
    const cnAt = seg.indexOf('class="pair-cn"');
    assert.ok(enAt !== -1, 'pair 内应含 en 段');
    assert.ok(cnAt !== -1, 'pair 内应含 cn 段');
    assert.ok(enAt < cnAt, 'en 应在 cn 之前');
  }
});

test('英中模式 cx：标题/经文banner 出英文', async () => {
  lsStub.setItem('cx_lang_mode', 'enchs');
  const html = await renderOnce('cx');
  assert.ok(html.includes('Disciples, Believers, Saints, and Christians'), 'title_en');
  assert.ok(html.includes('门徒、信徒、圣徒和基督徒'), '中文标题仍在');
});

test('英中模式 cx：feeding 英文经文 + data-refs 复用中文 feeding_refs', async () => {
  lsStub.setItem('cx_lang_mode', 'enchs');
  const html = await renderOnce('cx');
  assert.ok(html.includes('And as Jesus passed on from there'), 'feeding 英文正文');
  assert.ok(html.includes('data-refs="太9:9"'), '英文引用已转中文标准引用');
});

test('英中模式 cx：morning_feeding / message_reading / ref_reading 英文段落', async () => {
  lsStub.setItem('cx_lang_mode', 'enchs');
  const html = await renderOnce('cx');
  assert.ok(html.includes('First, the believers are designated as disciples'), 'morning_feeding_en');
  assert.ok(html.includes('Disciples are those who follow Christ'), 'message_reading_en');
  assert.ok(html.includes('Further Reading: The Conclusion of the New Testament'), 'ref_reading_en');
  // 英文段落中的英文引用也要转中文 data-refs（wrapEnRefs）
  assert.ok(html.includes('data-refs="太5:1"') || html.includes('data-refs="太5:1,'), 'morning_feeding 英文引用转中文');
});

test('英中模式 cx：纲目英文（rev.outline_en）', async () => {
  lsStub.setItem('cx_lang_mode', 'enchs');
  const html = await renderOnce('cx');
  assert.ok(html.includes('We are disciples of Christ'), 'outline_en L1 title（cv 级同样文本）');
});

test('英中模式 cx：TTS lang=en-US；中文模式显式 zh-CN', async () => {
  lsStub.setItem('cx_lang_mode', 'enchs');
  await renderOnce('cx');
  assert.ok(speechCalls.length >= 1, 'CXSpeech.init 已调用');
  assert.strictEqual(speechCalls[speechCalls.length - 1].lang, 'en-US', '英中模式读英文');

  lsStub.removeItem('cx_lang_mode');
  await renderOnce('cx');
  assert.strictEqual(speechCalls[speechCalls.length - 1].lang, 'zh-CN', '中文模式 zh-CN');
});

// ══ 英中模式（cv 纲目）═══════════════════════════════════════════════════

test('英中模式 cv：纲目/标题/经文英文 + pair 结构', async () => {
  lsStub.setItem('cx_lang_mode', 'enchs');
  const html = await renderOnce('cv');
  assert.ok(countOf(html, 'pair-bilingual') >= 1, 'cv 纲目出现 pair');
  assert.ok(html.includes('We are disciples of Christ'), 'outline_sections_en');
  assert.ok(html.includes('我们是基督的门徒'), '中文纲目仍在');
  assert.ok(html.includes('Disciples, Believers, Saints, and Christians'), 'title_en');
  assert.ok(html.includes('Matt. 5:1; 28:19; 2 Cor. 6:14-16'), 'scripture_en');
});

// ══ 缺英文段兜底（篡改数据：删 message_reading_en）══════════════════════

test('缺英文段兜底：只渲染中文不抛错', async () => {
  // 重新 require 以隔离 bilingual 的 enchs 缓存与 renderer 的 _cache
  // （前面的英中测试已把旧实例的 _enchsCache 填满，必须换新实例 fetch stub 才生效）
  delete require.cache[require.resolve('../src/static/js/bilingual.js')];
  delete require.cache[require.resolve('../src/static/js/renderer.js')];
  require('../src/static/js/bilingual.js');
  require('../src/static/js/renderer.js');
  installFetch('no-mr-en');
  lsStub.setItem('cx_lang_mode', 'enchs');
  const html = await renderOnce('cx');
  assert.ok(!html.includes('Disciples are those who follow Christ'), '缺英文段不应出现英文');
  assert.ok(html.includes('门徒就是跟从基督的人'), '中文兜底保留');
});

// ══ enchs.json 404 静默降级（等同纯中文）════════════════════════════════

test('enchs 404：静默降级为纯中文输出', async () => {
  delete require.cache[require.resolve('../src/static/js/bilingual.js')];
  delete require.cache[require.resolve('../src/static/js/renderer.js')];
  require('../src/static/js/bilingual.js');
  require('../src/static/js/renderer.js');
  installFetch('404');
  lsStub.setItem('cx_lang_mode', 'enchs');
  const html = await renderOnce('cx');
  assert.equal(countOf(html, 'pair-bilingual'), 0, '404 时不出现 pair');
  assert.ok(html.includes('第1篇 门徒、信徒、圣徒和基督徒'), '中文锚点保留');
  assert.ok(html.includes('门徒就是跟从基督的人'), '中文正文保留');
});
