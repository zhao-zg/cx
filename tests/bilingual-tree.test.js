// Task 3: pairEnTree 双树同步（用真实 training-enchs JSON 抽样断言）
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
const fs = require('node:fs');

const enchs = JSON.parse(fs.readFileSync(__dirname + '/../output/2026-04/training-enchs.json', 'utf8'));

// 递归断言：CN 节点都挂 .en 对位节点（title 对位即等价）
function assertTreeAligned(cnNode, enNode, path) {
  assert.ok(cnNode.en, path + ' 应挂 .en 属性');
  assert.equal(cnNode.en.title, enNode.title, path + ' title 对位');
  assert.equal(cnNode.en.level, enNode.level, path + ' level 对位');
  const cnCh = cnNode.children || [];
  const enCh = enNode.children || [];
  if (cnCh.length && enCh.length) {
    assert.equal(cnCh.length, enCh.length, path + ' 子节点数一致');
    for (let i = 0; i < cnCh.length; i++) {
      assertTreeAligned(cnCh[i], enCh[i], path + '.' + i);
    }
  }
}

test('真数据：mr outline 树逐节点挂 .en，对位正确', () => {
  const mr = enchs.chapters[0].morning_revivals[0];
  const cloned = JSON.parse(JSON.stringify(mr.outline));
  const got = CXB.pairEnTree(cloned, mr.outline_en);
  assert.equal(got.length, mr.outline.length);
  for (let i = 0; i < got.length; i++) {
    assertTreeAligned(got[i], mr.outline_en[i], 'root' + i);
  }
});

test('真数据：cv outline_sections 树同步', () => {
  const ch = enchs.chapters[0];
  const cloned = JSON.parse(JSON.stringify(ch.outline_sections));
  const got = CXB.pairEnTree(cloned, ch.outline_sections_en);
  assert.equal(got.length, ch.outline_sections.length);
  for (let i = 0; i < got.length; i++) {
    assertTreeAligned(got[i], ch.outline_sections_en[i], 'cv' + i);
  }
});

test('边界：en 树 null/空 → 每个节点 .en 为 null（整树回退中文）', () => {
  const cnTree = [{ level: '一', title: '甲', children: [{ level: '1', title: '子', children: [] }] }];
  const got = CXB.pairEnTree(cnTree, null);
  assert.equal(got.length, 1);
  assert.equal(got[0].en, null);
  assert.equal(got[0].children[0].en, null);

  const got2 = CXB.pairEnTree(cnTree, []);
  assert.equal(got2[0].en, null);
  assert.equal(got2[0].children[0].en, null);
});

test('边界：子节点数对不上 → 该子树 en=null，其余兄弟子树正常', () => {
  const cnTree = [
    { level: '一', title: '甲', children: [] },
    { level: '二', title: '乙', children: [{ level: '1', title: '子1' }, { level: '2', title: '子2' }] },
  ];
  const enTree = [
    { level: 'I', title: 'A-en', children: [] },
    { level: 'II', title: 'B-en', children: [{ level: '1.', title: 'only-one' }] }, // 少一个
  ];
  const got = CXB.pairEnTree(cnTree, enTree);
  assert.equal(got[0].en.title, 'A-en');
  assert.equal(got[1].en.title, 'B-en');
  assert.equal(got[1].children[0].en, null, '子树数对不上时整棵子树 en=null');
  assert.equal(got[1].children[1].en, null);
});

test('边界：顶层节点数对不上 → 按 pairEn 语义（多余侧补齐）', () => {
  const cnTree = [{ level: '一', title: '甲', children: [] }, { level: '二', title: '乙', children: [] }];
  const enTree = [{ level: 'I', title: 'A-en', children: [] }];
  const got = CXB.pairEnTree(cnTree, enTree);
  assert.equal(got.length, 2);
  assert.equal(got[0].en.title, 'A-en');
  assert.equal(got[1].en, null);
});

test('不修改原 CN 树之外的引用：返回树即传入树（原地挂 .en）', () => {
  const cnTree = [{ level: '一', title: '甲', children: [] }];
  const enTree = [{ level: 'I', title: 'A-en', children: [] }];
  const got = CXB.pairEnTree(cnTree, enTree);
  assert.equal(got, cnTree, '原地挂载返回同一数组');
});
