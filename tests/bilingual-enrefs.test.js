// Task 4: wrapEnRefs 英文经文引用 → 中文标准 data-refs
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

test('基础：Matt. 9:9 → 太9:9', () => {
  const html = CXB.wrapEnRefs('Matt. 9:9 confirms');
  const refs = refsOf(html);
  assert.strictEqual(refs.length, 1);
  assert.ok(refs[0].includes('太9:9'));
  assert.ok(html.includes('>Matt. 9:9</span>'));
});

test('基础：2 Cor. 6:14-16 → 林后6:14-16（范围连字符保留）', () => {
  const html = CXB.wrapEnRefs('2 Cor. 6:14-16');
  const refs = refsOf(html);
  assert.strictEqual(refs.length, 1);
  assert.ok(refs[0].includes('林后6:14-16'));
});

test('基础：1 Pet. 4:16 → 彼前4:16', () => {
  const refs = refsOf(CXB.wrapEnRefs('1 Pet. 4:16'));
  assert.ok(refs.length >= 1 && refs[0].includes('彼前4:16'));
});

test('基础：John 20:15-17 → 约20:15-17', () => {
  const refs = refsOf(CXB.wrapEnRefs('John 20:15-17'));
  assert.ok(refs.length >= 1 && refs[0].includes('约20:15-17'));
});

test('同书省略书名：Acts 2:4; 8:14-17 → 徒2:4,徒8:14-17', () => {
  const refs = refsOf(CXB.wrapEnRefs('Acts 2:4; 8:14-17'));
  assert.strictEqual(refs.length, 1);
  assert.strictEqual(refs[0], '徒2:4,徒8:14-17');
});

test('同书多章省略：Matt. 5:1; 28:19 → 太5:1,太28:19', () => {
  const refs = refsOf(CXB.wrapEnRefs('Matt. 5:1; 28:19'));
  assert.strictEqual(refs.length, 1);
  assert.strictEqual(refs[0], '太5:1,太28:19');
});

test('同章多节列举：Rom. 5:10, 17 → 罗5:10,罗5:17', () => {
  const refs = refsOf(CXB.wrapEnRefs('Rom. 5:10, 17'));
  assert.strictEqual(refs.length, 1);
  assert.strictEqual(refs[0], '罗5:10,罗5:17');
});

test('无空格书名：John6:63 → 约6:63', () =>     {
  const refs = refsOf(CXB.wrapEnRefs('John6:63'));
  assert.strictEqual(refs.length, 1);
  assert.ok(refs[0].includes('约6:63'));
});

test('无空格书名（数字前缀）：2 Tim.3:15-17 → 提后3:15-17', () => {
  const refs = refsOf(CXB.wrapEnRefs('2 Tim.3:15-17'));
  assert.strictEqual(refs.length, 1);
  assert.ok(refs[0].includes('提后3:15-17'));
});

test('无空格书名（Eph.3:20-21）', () => {
  const refs = refsOf(CXB.wrapEnRefs('Eph.3:20-21'));
  assert.strictEqual(refs.length, 1);
  assert.ok(refs[0].includes('弗3:20-21'));
});

test('节后缀 a：John 3:29a → 约3:29（a/b 后缀丢弃，bible-text 无字母后缀键）', () => {
  const refs = refsOf(CXB.wrapEnRefs('John 3:29a'));
  assert.strictEqual(refs.length, 1);
  assert.strictEqual(refs[0], '约3:29');
});

test('节后缀 b：Phil. 3:11b, 12a → 腓3:11,腓3:12（后缀全丢弃）', () => {
  const refs = refsOf(CXB.wrapEnRefs('Phil. 3:11b, 12a'));
  assert.strictEqual(refs.length, 1);
  assert.strictEqual(refs[0], '腓3:11,腓3:12');
});

test('全称与缩写等价：Matthew/Romans/Genesis', () => {
  assert.ok(refsOf(CXB.wrapEnRefs('Matthew 9:9'))[0].includes('太9:9'));
  assert.ok(refsOf(CXB.wrapEnRefs('Romans 1:1'))[0].includes('罗1:1'));
  assert.ok(refsOf(CXB.wrapEnRefs('Genesis 1:1'))[0].includes('创1:1'));
});

test('全称复合形式：2 Corinthians 4:7 / Ephesians 4:23 / Philippians 2:5', () => {
  assert.ok(refsOf(CXB.wrapEnRefs('2 Corinthians 4:7'))[0].includes('林后4:7'));
  assert.ok(refsOf(CXB.wrapEnRefs('Ephesians 4:23'))[0].includes('弗4:23'));
  assert.ok(refsOf(CXB.wrapEnRefs('Philippians 2:5'))[0].includes('腓2:5'));
});

test('Song of Songs 1:7 → 歌1:7', () => {
  const refs = refsOf(CXB.wrapEnRefs('Song of Songs 1:7'));
  assert.strictEqual(refs.length, 1);
  assert.ok(refs[0].includes('歌1:7'));
});

test('Psa. 119:105, 130 → 诗119:105,诗119:130', () => {
  const refs = refsOf(CXB.wrapEnRefs('Psa. 119:105, 130'));
  assert.strictEqual(refs.length, 1);
  assert.strictEqual(refs[0], '诗119:105,诗119:130');
});

test('Psalm 全称变体：Psalm 119:105 → 诗119:105', () => {
  const refs = refsOf(CXB.wrapEnRefs('Psalm 119:105'));
  assert.strictEqual(refs.length, 1);
  assert.ok(refs[0].includes('诗119:105'));
});

test('约翰书信键名：1 John 5:12 → 约壹5:12（bible-text 用壹贰叁，非一二三）', () => {
  const refs = refsOf(CXB.wrapEnRefs('1 John 5:12'));
  assert.strictEqual(refs.length, 1);
  assert.ok(refs[0].includes('约壹5:12'));
  assert.ok(!refs[0].includes('约一'));
});

test('无引用纯文本：原样输出不误伤（普通英文不被包裹）', () => {
  const html = CXB.wrapEnRefs('We are disciples of Christ, following Him daily.');
  assert.ok(!html.includes('scripture-ref'), '不应产生 scripture-ref');
  assert.ok(html.includes('We are disciples'));
});

test('无引用纯文本：HTML 转义（< > &）', () => {
  const html = CXB.wrapEnRefs('a < b & c > d');
  assert.ok(html.includes('&lt;'));
  assert.ok(html.includes('&amp;'));
  assert.ok(html.includes('&gt;'));
});

test('多引用混合文本：各自独立成 span，文本前后保留', () => {
  const html = CXB.wrapEnRefs('first (Mark 1:15; Matt. 4:17) then John 8:31-32, 36');
  const refs = refsOf(html);
  assert.ok(refs.some(r => r === '可1:15,太4:17' || r.includes('可1:15')));
  assert.ok(refs.some(r => r.includes('约8:31-32') && r.includes('约8:36')));
  assert.ok(html.includes('first ('));
  assert.ok(html.includes('then '));
});

test('引用内文本保留原文（display = 原文片段）', () => {
  const html = CXB.wrapEnRefs('see Matt. 9:9 today');
  assert.ok(html.includes('>Matt. 9:9</span>'));
  assert.ok(html.includes('see '));
  assert.ok(html.includes(' today'));
});

test('真实数据样本：outline_en 长句含多引用（Eph. 4:20-24; 3:21; Isa. 43:7; Rev. 21:11）', () => {
  const refs = refsOf(CXB.wrapEnRefs('expression of Himself for His glory in the church and in theNew Jerusalem—Matt. 5:1; 28:19; Eph. 4:20-24; 3:21; Isa.43:7; Rev. 21:11:'));
  assert.strictEqual(refs.length, 1);
  assert.strictEqual(refs[0], '太5:1,太28:19,弗4:20-24,弗3:21,赛43:7,启21:11');
});

test('真实数据样本：分号后无空格（1 Cor. 6:17;2 Cor. 4:7）', () => {
  const refs = refsOf(CXB.wrapEnRefs('Acts 11:26; 26:28; 1 Pet. 4:16; 1 Cor. 6:17;2 Cor. 4:7; Phil. 1:19-21a'));
  assert.ok(refs.some(r => r === '徒11:26,徒26:28,彼前4:16,林前6:17,林后4:7,腓1:19-21'));
});

test('跨书不省略：Mark 1:15; Matt. 4:17 → 可1:15,太4:17', () => {
  const refs = refsOf(CXB.wrapEnRefs('(Mark 1:15; Matt. 4:17)'));
  assert.strictEqual(refs.length, 1);
  assert.strictEqual(refs[0], '可1:15,太4:17');
});

test('半角点缩写（真实变体）：2Thes. 2:10-11 → 帖后2:10-11', () => {
  const refs = refsOf(CXB.wrapEnRefs('(2Thes. 2:10-11; Prov. 23:23)'));
  assert.ok(refs.some(r => r === '帖后2:10-11,箴23:23'));
});

test('正文含数字不误伤：In 2 Corinthians 4:7（介词 In 不吞）', () => {
  const refs = refsOf(CXB.wrapEnRefs('Then in 2 Corinthians 4:7 he says'));
  assert.strictEqual(refs.length, 1);
  assert.ok(refs[0].includes('林后4:7'));
  // In 单独出现不应被当书卷
  const html2 = CXB.wrapEnRefs('In the church and in the New Jerusalem');
  assert.ok(!html2.includes('scripture-ref'));
});