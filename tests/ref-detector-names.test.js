// Task: 书卷章数上限校验——人名误判为经文引用（拿八 → 拿8:0）
// 原则：识别结果与收录数据核对后若未收录（无对应有效经文数据），判定为识别错误，
//       不识别、不包裹，按纯文本输出。约拿书仅 4 章，“拿八”= 拿8:0 超限 → 无效。
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

// ── 一、核心缺陷：人名“拿八”不得被识别为经文引用 ──────────────────────

test('缺陷：expandCnRefs(拿八) 应返回 []（拿仅 4 章，8 超限）', () => {
  assert.deepStrictEqual(CXR.expandCnRefs('拿八'), []);
});

test('缺陷：wrapRefs 中“拿八”不被包裹（撒上 25 章人名场景）', () => {
  const html = CXR.wrapRefs('亚比该先前的丈夫，拿八（意，愚顽）', '撒上25:1');
  assert.ok(!html.includes('拿8:0'), '不得产出 data-refs="拿8:0"');
  assert.ok(!html.includes('scripture-ref'), '不得包裹为 scripture-ref');
});

test('缺陷：expandCnRefs(拿五) 应返回 []（拿仅 4 章）', () => {
  assert.deepStrictEqual(CXR.expandCnRefs('拿五'), []);
});

test('边界：expandCnRefs(拿四) → 拿4:0（拿有 4 章，合法整章）', () => {
  assert.deepStrictEqual(CXR.expandCnRefs('拿四'), ['拿4:0']);
});

// ── 二、章数上限表回归：合法整章引用仍正常识别 ──────────────────────

test('回归：expandCnRefs(但二) → 但2:0（但以理 12 章）', () => {
  assert.deepStrictEqual(CXR.expandCnRefs('但二'), ['但2:0']);
});

test('回归：expandCnRefs(拿二) → 拿2:0（拿 4 章内）', () => {
  assert.deepStrictEqual(CXR.expandCnRefs('拿二'), ['拿2:0']);
});

test('缺陷：expandCnRefs(腓四～五) 应整组拒绝（腓立比仅 4 章，五超限）', () => {
  assert.deepStrictEqual(CXR.expandCnRefs('腓四～五'), []);
});

test('回归：expandCnRefs(诗一五〇) → 诗150:0（诗篇 150 章上限）', () => {
  assert.deepStrictEqual(CXR.expandCnRefs('诗一五〇'), ['诗150:0']);
});

test('回归：expandCnRefs(启二一) → 启21:0（启示录 22 章）', () => {
  assert.deepStrictEqual(CXR.expandCnRefs('启二一'), ['启21:0']);
});

test('回归：expandCnRefs(启二二) → 启22:0（启示录末章）', () => {
  assert.deepStrictEqual(CXR.expandCnRefs('启二二'), ['启22:0']);
});

test('回归：expandCnRefs(诗一五一) 应返回 []（诗篇仅 150 章）', () => {
  assert.deepStrictEqual(CXR.expandCnRefs('诗一五一'), []);
});

test('回归：expandCnRefs(启二三) 应返回 []（启示录仅 22 章）', () => {
  assert.deepStrictEqual(CXR.expandCnRefs('启二三'), []);
});

// ── 三、wrapRefs 全链路回归：合法引用仍被包裹 ──────────────────────

test('回归：wrapRefs(撒上二五42) 仍正常包裹', () => {
  const html = CXR.wrapRefs('参撒上二五42', '撒上25:1');
  const refs = refsOf(html);
  assert.strictEqual(refs.length, 1);
  assert.ok(refs[0].includes('撒上25:42'));
});

test('回归：wrapRefs 省书名续接（参箴一7，十三20 → 箴1:7 + 箴13:20 两个独立 span）', () => {
  const html = CXR.wrapRefs('参箴一7，十三20', '箴1:1');
  const refs = refsOf(html);
  assert.strictEqual(refs.length, 2);
  assert.ok(refs[0].includes('箴1:7'));
  assert.ok(refs[1].includes('箴13:20'));
});

test('回归：wrapRefs(诗一一九105) 仍正常包裹', () =>  {
  const html = CXR.wrapRefs('诗一一九105', '诗119:1');
  const refs = refsOf(html);
  assert.ok(refs.length >= 1 && refs[0].includes('诗119:105'));
});

// ── 四、超限章号在其他格式分支下也须拒绝 ──────────────────────

test('缺陷：expandCnRefs(拿八章) 语义测（无章节字时应已不识别，保持纯文本）', () => {
  // “拿八章”若被 F8 匹配也应拒绝；若不匹配则返回 []——两者都要求不产出拿8:0
  const out = CXR.expandCnRefs('拿八章');
  assert.ok(out.every(r => !r.startsWith('拿8:')), '不得产出 拿8: 开头的引用');
});

test('缺陷：超限章节式（拿八1 → 拿8:1）应拒绝', () => {
  assert.deepStrictEqual(CXR.expandCnRefs('拿八1'), []);
});

test('缺陷：超限跨章范围（拿七～八）应整组拒绝', () => {
  assert.deepStrictEqual(CXR.expandCnRefs('拿七～八'), []);
});

test('缺陷：合法范围端点校验（启二一～二三 超出 22 章）应拒绝', () => {
  assert.deepStrictEqual(CXR.expandCnRefs('启二一～二三'), []);
});

test('缺陷：上下文省书名回退也须校验（ctx=拿3:1，纯节号“第八节”类输入不扩章节）', () => {
  // 纯节号输入走 F3，不涉及章号，验证不受影响
  const out = CXR.expandCnRefs('8节', '拿3:1');
  assert.ok(Array.isArray(out));
});

test('缺陷：阿拉伯数字章（拿8）应拒绝', () => {
  assert.deepStrictEqual(CXR.expandCnRefs('拿8'), []);
});

test('缺陷：阿拉伯数字章（拿4 无节号）本就不识别，保持纯文本（F8 只吃中文数字）', () => {
  assert.deepStrictEqual(CXR.expandCnRefs('拿4'), []);
});

test('缺陷：阿拉伯章范围（启21-23 无节号）本就不识别，保持纯文本', () => {
  assert.deepStrictEqual(CXR.expandCnRefs('启21-23'), []);
});

test('缺陷：阿拉伯章范围（启21-22 无节号）本就不识别，保持纯文本', () => {
  assert.deepStrictEqual(CXR.expandCnRefs('启21-22'), []);
});

// ── 五、未知书卷兼容性：无上限数据的书卷保持旧行为（≤150）──────────────

test('兼容：未知/罕见书卷缩写仍按 150 章上限（不误伤）', () => {
  // “革”等非标准缩写不在 66 卷表内时不应崩溃，仍按旧逻辑
  const out = CXR.expandCnRefs('革一');
  assert.ok(Array.isArray(out));
});
