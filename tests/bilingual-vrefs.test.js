// v./vv. 引用识别测试：英文圣经惯例，v. = verse（单节）、vv. = verses（多节），
// 书卷+章节继承自上下文最近一次完整引用（块内继承 + 跨块继承）。
// 真实数据样本：output/2026-04/training-enchs.json（v. 186 处、vv. 76 处）
// 注意：wrapEnRefs 的继承状态是模块级的，测试间必须 reset 隔离（freshWrap）。
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

/** 从输出 HTML 中提取所有 data-refs 值 */
function refsOf(html) {
  const out = [];
  const re = /data-refs="([^"]*)"/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

/** 隔离模块级继承状态后单块包裹 */
function freshWrap(text) {
  CXB.resetEnRefContext();
  return CXB.wrapEnRefs(text);
}

// ── 块内继承 ──────────────────────────────────────────────

test('块内继承：继承序列内最近完整引用（John 8:31-32, 36; 15:7 后 (v. 40) → 约15:40）', () => {
  // 拼接样本：序列末尾 15:7 已把章刷为 15，v. 40 继承「最近」一次而非第一次
  const refs = refsOf(freshWrap('word "—John 8:31-32, 36; 15:7. And (v. 40) more"'));
  assert.ok(refs.some(r => r === '约15:40'), JSON.stringify(refs));
});

test('块内继承（真实样本）：(Eph. 1:11) 后 (v. 14) → 弗1:14', () => {
  const refs = refsOf(freshWrap("In God's economy we are an inheritance to God (Eph. 1:11), and God is an inheritance to us (v. 14)."));
  assert.ok(refs.some(r => r === '弗1:14'), JSON.stringify(refs));
});

test('块内继承 vv. 多节：Matt. 5:1 后 (vv. 3-4) → 太5:3-4', () => {
  const refs = refsOf(freshWrap('blessings (Matt. 5:1) begin with (vv. 3-4)'));
  assert.ok(refs.some(r => r === '太5:3-4'), JSON.stringify(refs));
});

test('真实样本：—vv. 7-8a 破折号引导 + 后缀丢弃', () => {
  const refs = refsOf(freshWrap('the Spirit (John 6:63)—vv. 7-8a.'));
  assert.ok(refs.some(r => r === '约6:7-8'), JSON.stringify(refs));
});

test('v./vv. 列举混合：vv. 4, 19 → 两节', () => {
  const refs = refsOf(freshWrap('word of God (Luke 8:5) — the seed (vv. 4, 19)'));
  assert.ok(refs.some(r => r === '路8:4,路8:19'), JSON.stringify(refs));
});

test('v. 前置书名继续序列：1 Pet. 1:23 后接 vv. 25-26', () => {
  // 此处 vv. 继承的是最近一次「书+章」完整引用（1 Pet. 1:23 → 彼前1:25-26）
  const refs = refsOf(freshWrap('seed (1 Pet. 1:23) free (vv. 25-26)'));
  assert.ok(refs.some(r => r === '彼前1:25-26'), JSON.stringify(refs));
});

test('v./vv. 与完整引用混排序列：(v. 14; 2 Cor. 1:22b; 5:5b)', () => {
  // 序列内 v. 14 继承上文完整引用的书卷+章，随后 2 Cor. 1:22b 更新书卷章状态
  const refs = refsOf(freshWrap('inheritance (Eph. 1:13), the pledge (v. 14; 2 Cor. 1:22b; 5:5b)'));
  assert.ok(refs.some(r => r.includes('弗1:14')), JSON.stringify(refs));
  assert.ok(refs.some(r => r.includes('林后1:22') && r.includes('林后5:5')), JSON.stringify(refs));
});

test('真实样本：1 Peter 4:16 后 [v. 14a] 方括号形式（后缀丢弃）', () => {
  const refs = refsOf(freshWrap('in 1 Peter 4:16, where it denotes those who are adherents of Christ. The context concerns sharing the sufferings of Christ [v. 14a]'));
  assert.ok(refs.some(r => r === '彼前4:14'), JSON.stringify(refs));
});

test('真实样本：vv. 7-8; 21:1-2, 9-10 序列内章:节延续', () => {
  // vv. 7-8 继承上文；; 21:1-2 刷章为 21；, 9-10 继承章 21
  const refs = refsOf(freshWrap('the eternal marriage (Rev. 19:7) —vv. 7-8; 21:1-2, 9-10.'));
  assert.ok(refs.some(r => r === '启19:7-8,启21:1-2,启21:9-10'), JSON.stringify(refs));
});

// ── 跨块继承 ──────────────────────────────────────────────

test('跨块继承：前块 John 8:31-32，后块单独 (v. 36) → 约8:36', () => {
  CXB.resetEnRefContext();
  CXB.wrapEnRefs('first block (John 8:31-32)');
  const refs = refsOf(CXB.wrapEnRefs('second block alone (v. 36)'));
  assert.ok(refs.some(r => r === '约8:36'), JSON.stringify(refs));
});

test('跨块继承 vv.：前块 Matt. 5:1，后块 —vv. 3, 10 → 太5:3,太5:10', () => {
  CXB.resetEnRefContext();
  CXB.wrapEnRefs('the mountain (Matt. 5:1)');
  const refs = refsOf(CXB.wrapEnRefs('—vv. 3, 10.'));
  assert.ok(refs.some(r => r === '太5:3,太5:10'), JSON.stringify(refs));
});

// ── 防御与边界 ────────────────────────────────────────────

test('无上文：孤立 v. 22 不误伤（保持原样输出）', () => {
  const html = freshWrap('says (v. 22) without any prior reference');
  assert.ok(!html.includes('scripture-ref'), '无继承状态时不得产生引用');
  assert.ok(html.includes('(v. 22)'));
});

test('无上文：孤立 vv. 4-5 不误伤', () => {
  const html = freshWrap('wears me out (vv. 4-5)');
  assert.ok(!html.includes('scripture-ref'));
  assert.ok(html.includes('(vv. 4-5)'));
});

test('普通英文数字+点不误伤：prices v. 2.0 之类非引用', () => {
  // 「v. 2.0」节号后跟点数字不是经文模式；v 后无空格数字也不匹配
  const html = freshWrap('version v. 2.0 and vv. 10.5');
  assert.ok(!html.includes('scripture-ref'), JSON.stringify(html));
});

test('v./vv. 继承不跨越书卷切换（显式书名刷新状态）', () => {
  CXB.resetEnRefContext();
  CXB.wrapEnRefs('first (John 8:31)');
  // 中间出现新的完整引用刷新状态，后续 v. 继承新状态
  const refs = refsOf(CXB.wrapEnRefs('middle (Matt. 5:1) then (v. 3)'));
  assert.ok(refs.some(r => r === '太5:3'), JSON.stringify(refs));
  assert.ok(!refs.some(r => r.includes('约8:3,')), JSON.stringify(refs));
});

test('连续 v. 引用各自成 span（间隔普通文本）', () => {
  CXB.resetEnRefContext();
  CXB.wrapEnRefs('base (Rom. 5:10)');
  const html = CXB.wrapEnRefs('first (v. 11) and second (v. 12)');
  const refs = refsOf(html);
  assert.strictEqual(refs.length, 2, JSON.stringify(refs));
  assert.ok(refs[0] === '罗5:11' && refs[1] === '罗5:12', JSON.stringify(refs));
});

test('清空继承状态 API：resetEnRefContext 后孤立 v. 不误伤', () => {
  CXB.resetEnRefContext();
  CXB.wrapEnRefs('base (John 8:31)');
  CXB.resetEnRefContext();
  const html = CXB.wrapEnRefs('orphan (v. 36)');
  assert.ok(!html.includes('scripture-ref'), JSON.stringify(html));
});
