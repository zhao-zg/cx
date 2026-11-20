// 回归：纲目多字符编号（拾壹~拾玖 / 十一~十九）必须整体识别
// 缺陷背景：TXT 构建管线（txt-importer.js → build-batch-txt.js / build-trainings-json.js）
// 把「拾壹　基督是赐安息者」拆成 level「拾」+ title「壹　基督是赐安息者」，
// 导致第 11~15 大点全部显示为重复的「拾」，标题前多出「壹/贰/叁」。
global.window = {};
global.localforage = {
  getItem: function () { return Promise.resolve(null); },
  setItem: function () { return Promise.resolve(null); },
  removeItem: function () { return Promise.resolve(null); }
};

require('../src/static/js/txt-importer.js');
const imp = global.window.CXLocalImport;

const { test } = require('node:test');
const assert = require('node:assert');

test('缺陷：大点 拾壹/拾贰 整体识别，子点一归位', () => {
  const roots = imp.parseCnOutline([
    '拾壹　基督是赐安息者—太十一28～30：',
    '一　负主的轭就是接受父的旨意，并受父旨意的约束—29节。',
    '拾贰　基督是更大的约拿—十二39～41，十六4：',
    '一　约拿预表基督的死、埋葬与复活—十二39～41。',
  ]);
  assert.deepStrictEqual(roots.map(r => r.level), ['拾壹', '拾贰']);
  assert.ok(roots[0].title.startsWith('基督是赐安息者'), roots[0].title);
  assert.ok(roots[1].title.startsWith('基督是更大的约拿'), roots[1].title);
  assert.deepStrictEqual(roots[0].children.map(c => c.level), ['一']);
  assert.deepStrictEqual(roots[1].children.map(c => c.level), ['一']);
});

test('回归：单字符大点 拾 行为不变', () => {
  const roots = imp.parseCnOutline(['拾　基督是罪人的朋友，也是神的智慧—十一19：']);
  assert.strictEqual(roots.length, 1);
  assert.strictEqual(roots[0].level, '拾');
  assert.ok(roots[0].title.startsWith('基督是罪人的朋友'), roots[0].title);
});

test('回归：中纲 十一/十二 整体识别为二级', () => {
  const roots = imp.parseCnOutline([
    '叁　包罗万有的灵—林后三17～18：',
    '十　主灵乃是经过过程之三一神的终极完成。',
    '十一　我们需要喝那灵，被那灵充满并浸透。',
    '十二　那灵是我们里面有效的膏油涂抹。',
  ]);
  assert.strictEqual(roots.length, 1);
  assert.deepStrictEqual(roots[0].children.map(c => c.level), ['十', '十一', '十二']);
});

test('回归：levelRank 拾壹→1、十一→2、拾→1、一→2', () => {
  assert.strictEqual(imp.levelRank('拾壹'), 1);
  assert.strictEqual(imp.levelRank('拾贰'), 1);
  assert.strictEqual(imp.levelRank('十一'), 2);
  assert.strictEqual(imp.levelRank('拾'), 1);
  assert.strictEqual(imp.levelRank('一'), 2);
});
