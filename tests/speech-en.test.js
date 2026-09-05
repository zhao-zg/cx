/**
 * speech.js 英文（en-US）朗读适配单元测试
 * 加载方式与 bilingual-vrefs.test.js 相同：global.window mock + require。
 * speech.js 顶层无 DOM 访问（init 不自动执行），require 安全。
 */
global.window = {};
global.localStorage = {
  _d: {},
  getItem: function (k) { return this._d[k] !== undefined ? this._d[k] : null; },
  setItem: function (k, v) { this._d[k] = String(v); },
  removeItem: function (k) { delete this._d[k]; }
};
require('../src/static/js/speech.js');
const CXS = global.window.CXSpeech;
const { test } = require('node:test');
const assert = require('node:assert');
const I = CXS._internals;

// -- 方案 A：英文引用展开 ----------------------------------------------------

test('EN expandDataRefsEN: 单条引用', () => {
  assert.strictEqual(I.expandDataRefsEN('弗4:20'), 'Ephesians 4:20');
});

test('EN expandDataRefsEN: 后缀上下丢弃', () => {
  assert.strictEqual(I.expandDataRefsEN('约15:5下'), 'John 15:5');
  assert.strictEqual(I.expandDataRefsEN('约15:5上'), 'John 15:5');
});

test('EN expandDataRefsEN: 同章范围用 to 连接（EN 页面真实格式：弗4:20-24）', () => {
  assert.strictEqual(I.expandDataRefsEN('弗4:20-24'), 'Ephesians 4:20 to 24');
});

test('EN expandDataRefsEN: 自包含逐节格式合并（EN 页面真实格式：逗号+每条含书章）', () => {
  assert.strictEqual(I.expandDataRefsEN('弗4:20,弗4:21,弗4:22'), 'Ephesians 4:20 to 22');
});

test('EN expandDataRefsEN: 跨章范围', () => {
  assert.strictEqual(I.expandDataRefsEN('启1:9-2:1'), 'Revelation 1:9 to 2:1');
});

test('EN expandDataRefsEN: 整章引用（verse=0）', () => {
  assert.strictEqual(I.expandDataRefsEN('弗4:0'), 'Ephesians 4');
});

test('EN expandDataRefsEN: 多条引用逗号连接', () => {
  assert.strictEqual(I.expandDataRefsEN('徒11:26,徒26:28,彼前4:16'),
    'Acts 11:26, Acts 26:28, 1 Peter 4:16');
});

test('EN expandDataRefsEN: 未知书卷回退原缩写', () => {
  assert.strictEqual(I.expandDataRefsEN(' nonexistent 1:1 '), 'nonexistent 1:1');
});

test('EN expandDataRefsEN: 空输入', () => {
  assert.strictEqual(I.expandDataRefsEN(''), '');
  assert.strictEqual(I.expandDataRefsEN(null), '');
});

// -- processText EN 白名单 + CN 黄金断言 --------------------------------------

test('CN processText: 黄金断言（输出逐字节不变）', () => {
  // 中文标点保留；半角 ! 与英文数字混排标点在 CN 白名单外被删（现状行为锁死）
  assert.strictEqual(I.processText('designated as Christians（徒11:26；徒26:28）。'), 'designated as Christians。');
  assert.strictEqual(I.processText('我们乃是\n活神的\n召会!'), '我们乃是 活神的 召会');
  assert.strictEqual(I.processText('加二20，一15。'), '加二20，一15。');
  // 全角括号内容移除
  assert.strictEqual(I.processText('前缀（不读）正文'), '前缀正文');
  // 半角括号：字符层先剥离，括号内容规则永不触发 → 内容保留（历史行为）
  assert.strictEqual(I.processText('prefix (not read) body'), 'prefix not read body');
  assert.strictEqual(I.processText('a [] b ( ) c'), 'a b c');
});

test('EN processText: 英文标点保留', () => {
  assert.strictEqual(I.processText('I am crucified with Christ.', true), 'I am crucified with Christ.');
  assert.strictEqual(I.processText('Gal. 2:20.', true), 'Gal. 2:20.');
  assert.strictEqual(I.processText('Is it right?', true), 'Is it right?');
  assert.strictEqual(I.processText('A; B, C: D!', true), 'A; B, C: D!');
});

test('EN processText: 撇号保留', () => {
  assert.strictEqual(I.processText("It's God's love.", true), "It's God's love.");
});

test('EN processText: 中文全角标点在 EN 模式仍删除', () => {
  assert.strictEqual(I.processText('en text，中文。', true), 'en text中文');
});

test('EN processText: 破折号与中文保留（EN 模式下混排不炸）', () => {
  assert.strictEqual(I.processText('daily life\u2014Acts 11:26', true), 'daily life\u2014Acts 11:26');
});

test('EN processText: 空括号清理', () => {
  assert.strictEqual(I.processText('a [] b ( ) c', true), 'a b c');
});

test('EN processText: 引号保留', () => {
  assert.strictEqual(I.processText('say "amen" and \u2018yes\u2019.', true), 'say "amen" and \u2018yes\u2019.');
});

// -- 段落分隔符 / 切句 --------------------------------------------------------

test('EN 段落分隔符判定：英文终止符不重复补', () => {
  assert.strictEqual(I.appendSeparator('.', true), '');
  assert.strictEqual(I.appendSeparator('!', true), '');
  assert.strictEqual(I.appendSeparator('?', true), '');
  assert.strictEqual(I.appendSeparator(';', true), '');
  assert.strictEqual(I.appendSeparator('x', true), '. ');
});

test('CN 段落分隔符判定：行为不变', () => {
  assert.strictEqual(I.appendSeparator('。', false), '');
  assert.strictEqual(I.appendSeparator('！', false), '');
  assert.strictEqual(I.appendSeparator('；', false), '');
  assert.strictEqual(I.appendSeparator('x', false), '。');
});

test('EN splitBySentenceEN: 按英文终止符切分', () => {
  assert.deepStrictEqual(
    I.splitBySentenceEN('One. Two! Three? Four; tail'),
    ['One.', ' Two!', ' Three?', ' Four;', ' tail']
  );
});

test('EN splitBySentenceEN: 已知限制——缩写点会碎切（可接受，WS fallback 路径）', () => {
  assert.deepStrictEqual(I.splitBySentenceEN('Read Gal. 2:20. Next'), ['Read Gal.', ' 2:20.', ' Next']);
});

test('EN splitBySentenceEN: 无终止符返回整段', () => {
  assert.deepStrictEqual(I.splitBySentenceEN('no terminal here'), ['no terminal here']);
});

// -- EN 不读规则纯谓词 --------------------------------------------------------

test('shouldSkipEnRef: 纲目容器内破折号前缀 span → 不读', () => {
  assert.strictEqual(I.shouldSkipEnRef('Acts 11:26; 26:28', 'daily life\u2014', true), true);
});

test('shouldSkipEnRef: 括号前缀（prev 以 ( 结尾）→ 不读', () => {
  assert.strictEqual(I.shouldSkipEnRef('Rom. 8:16', 'the Spirit (', false), true);
});

test('shouldSkipEnRef: span 文本自带前括号 → 不读', () => {
  assert.strictEqual(I.shouldSkipEnRef('(Rom. 8:16)', null, false), true);
});

test('shouldSkipEnRef: 普通正文引用 → 读', () => {
  assert.strictEqual(I.shouldSkipEnRef('Acts 11:26', 'designated as Christians ', false), false);
});

test('shouldSkipEnRef: prev 为 null → 读', () => {
  assert.strictEqual(I.shouldSkipEnRef('Acts 11:26', null, true), false);
});

test('shouldSkipEnRef: 纲目未知（null）+ 破折号前缀 → 保守不读', () => {
  assert.strictEqual(I.shouldSkipEnRef('Acts 11:26', 'life\u2014', null), true);
});

test('shouldSkipEnRef: 正文（非纲目）破折号后引用 → 读', () => {
  assert.strictEqual(I.shouldSkipEnRef('Acts 11:26', 'life\u2014', false), false);
});

// -- 跨章展开 CN 回归（确保重构未破坏） ----------------------------------------

test('CN expandDataRefs: 回归黄金断言（ref-detector emitRange 产出的自包含逐节格式）', () => {
  assert.strictEqual(I.expandDataRefs('弗4:20,弗4:21,弗4:22,弗4:23,弗4:24'), '以弗所书四章二十节至二十四节');
  assert.strictEqual(I.expandDataRefs('启1:9-2:1'), '启示录一章九节至二章一节');
  assert.strictEqual(I.expandDataRefs('约15:5下'), '约翰福音十五章五节下');
  assert.strictEqual(I.expandDataRefs('弗4:0'), '以弗所书四章');
  assert.strictEqual(I.expandDataRefs('徒11:26,徒26:28,彼前4:16'), '使徒行传十一章二十六节，使徒行传二十六章二十八节，彼得前书四章十六节');
});

// -- CN 静态经文块显示前缀剥除（修复双读） --------------------------------------
// 块正文开头的显示前缀（如「加二20　」）与前置展开引用重复，朗读前须剥除。
// 形态来自 output/2026-04/training.json 全量 124 块的真实数据：
//   书缩写+中文数字章 + 阿拉伯节号[+范围尾][+上下] + 全角空格/空格

test('CN stripCnRefPrefix: 书缩写+章+节 前缀剥除', () => {
  assert.strictEqual(I.stripCnRefPrefix('加二20　我已经与基督同钉十字架'), '我已经与基督同钉十字架');
  assert.strictEqual(I.stripCnRefPrefix('太九9　耶稣从那里往前走'), '耶稣从那里往前走');
  assert.strictEqual(I.stripCnRefPrefix('撒下七12～14上　……我必兴起'), '……我必兴起');
});

test('CN stripCnRefPrefix: 无书名（承接上文）纯节数前缀剥除', () => {
  assert.strictEqual(I.stripCnRefPrefix('十一29　我心里柔和谦卑'), '我心里柔和谦卑');
  assert.strictEqual(I.stripCnRefPrefix('26　但保惠师，就是父在我的名里'), '但保惠师，就是父在我的名里');
});

test('CN stripCnRefPrefix: 范围前缀（～/~）剥除，保留后续正文', () => {
  assert.strictEqual(I.stripCnRefPrefix('约一12～13　凡接受祂的'), '凡接受祂的');
  assert.strictEqual(I.stripCnRefPrefix('16~17　那灵自己同我们的灵见证'), '那灵自己同我们的灵见证');
});

test('CN stripCnRefPrefix: 正文以省略号开头时保留（只剥前缀不碰正文）', () => {
  assert.strictEqual(I.stripCnRefPrefix('罗十二3　……不要看自己过于所当'), '……不要看自己过于所当');
});

test('CN stripCnRefPrefix: 非前缀文本原样返回（防误伤）', () => {
  // 无阿拉伯数字节号 → 不是显示前缀
  assert.strictEqual(I.stripCnRefPrefix('我们已经死了'), '我们已经死了');
  // 数字后无空白分隔 → 不是前缀（是正文的一部分）
  assert.strictEqual(I.stripCnRefPrefix('在2026年'), '在2026年');
  // 空串 / null 安全
  assert.strictEqual(I.stripCnRefPrefix(''), '');
  assert.strictEqual(I.stripCnRefPrefix(null), '');
});

test('CN stripCnRefPrefix: 前缀与正文之间用半角空格也剥（全量数据中的变体）', () => {
  assert.strictEqual(I.stripCnRefPrefix('弗四23 而在你们心思的灵里得以'), '而在你们心思的灵里得以');
});
