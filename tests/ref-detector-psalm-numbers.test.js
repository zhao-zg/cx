// 回归：诗篇 100~150 章的中文写法（含占位零「零/〇/○」）必须定位到三位数章号
// 缺陷背景：「诗篇一百零九篇」曾因中文字符类缺少「零」而退化为「诗篇一」+「九篇」，
//           点击跳转到诗篇 1 篇 / 9 篇，而不是 109 篇。
global.window = {};

require('../src/static/js/ref-detector.js');
const CXR = global.window.CXRef;

const { test } = require('node:test');
const assert = require('node:assert');

/** 从输出 HTML 中提取所有 data-refs 值 */
function refsOf(html) {
  const out = [];
  const re = /data-refs="([^"]*)"/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

// ── 一、核心缺陷：占位零写法 ──────────────────────────────────────

test('缺陷：expandCnRefs(诗篇一百零九篇) → 诗109:0', () => {
  assert.deepStrictEqual(CXR.expandCnRefs('诗篇一百零九篇'), ['诗109:0']);
});

test('缺陷：wrapRefs(诗篇一百零九篇) 只产出一个 诗109:0，不得拆成 诗1:0 / 诗9:0', () => {
  const refs = refsOf(CXR.wrapRefs('诗篇一百零九篇', ''));
  assert.deepStrictEqual(refs, ['诗109:0']);
});

test('缺陷：cnToInt(一百零九) → 109（占位零按 0 计，不能吞掉个位）', () => {
  assert.strictEqual(CXR.cnToInt('一百零九'), 109);
  assert.strictEqual(CXR.cnToInt('一百〇九'), 109);
  assert.strictEqual(CXR.cnToInt('一百○九'), 109);
});

test('回归：占位零写法与节号混排（诗篇一百零九篇8节 → 诗109:8）', () => {
  const refs = refsOf(CXR.wrapRefs('诗篇一百零九篇8节', ''));
  assert.deepStrictEqual(refs, ['诗109:0', '诗109:8']);
});

test('回归：书卷+百位章+阿拉伯节（诗篇一百一十九105 → 诗119:105）', () => {
  const refs = refsOf(CXR.wrapRefs('诗篇一百一十九105', ''));
  assert.deepStrictEqual(refs, ['诗119:105']);
});

test('回归：省略「一」的百位写法（诗一百十九1 → 诗119:1）', () => {
  const refs = refsOf(CXR.wrapRefs('诗一百十九1', ''));
  assert.deepStrictEqual(refs, ['诗119:1']);
});

// ── 二、边界与误伤防护 ────────────────────────────────────────

test('边界：诗篇一百五十篇 → 诗150:0（诗篇上限）', () => {
  assert.deepStrictEqual(CXR.expandCnRefs('诗篇一百五十篇'), ['诗150:0']);
});

test('边界：诗篇一百五十一篇仍不识别（超出 150 章）', () => {
  assert.deepStrictEqual(CXR.expandCnRefs('诗篇一百五十一篇'), []);
});

test('误伤防护：诗歌「一百零九首」不当作诗篇 109 章', () => {
  const html = CXR.wrapRefs('诗歌一百零九首第一节说', '');
  assert.deepStrictEqual(refsOf(html), []);
  assert.deepStrictEqual(CXR.expandCnRefs('英文诗歌一百二十四首，就是中文一百零九首'), []);
});

test('误伤防护：百位章号在其他书卷超限时拒绝（弗一百零九 → 不识别）', () => {
  assert.deepStrictEqual(CXR.expandCnRefs('弗一百零九'), []);
});

test('误伤防护：诗篇上下文中「这一篇」是指代而非引用，不包裹为 诗1:0', () => {
  const html = CXR.wrapRefs('这一篇诗篇太伟大', '诗1:1');
  assert.deepStrictEqual(refsOf(html).filter(r => r !== '诗0:0'), []);
});