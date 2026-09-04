// 横屏/矮视口下设置面板适配（TDD 红灯）
// 用户报告：横屏时设置面板超出视口、无法滚动。
// 根因：.theme-panel 的 max-height/overflow-y 仅在 @media (max-width:480px) 生效，
// 横屏手机宽度 > 480px 命中基础规则 → 无高度约束、底部被裁切且不可滚动。
//
// 期望修复（最小改动）：基础规则追加无条件
//   max-height:calc(100vh - 72px)（+ dvh 回退）与 overflow-y:auto，
//   ≤480px 查询级联保持 min(70vh,560px) 既有行为不变。

const fs = require('fs');
const path = require('path');
const assert = require('node:assert');
const { test } = require('node:test');

const css = fs.readFileSync(
  path.resolve(__dirname, '..', 'src', 'static', 'css', 'style.css'), 'utf8'
);

function ruleOf(selector) {
  // 取匹配 selector 的裸规则体（不匹配 @media 内嵌套的该选择器）
  const re = new RegExp(
    '(^|[}\\n])' + selector.replace(/[.[\]"]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'm'
  );
  const m = css.match(re);
  return m ? m[2] : null;
}

test('设置面板基础规则含无条件 max-height（横屏/桌面通用）', () => {
  const base = ruleOf('.theme-panel');
  assert.ok(base, '应存在 .theme-panel 基础规则');
  assert.ok(
    /max-height:\s*calc\(100vh - 72px\)/.test(base),
    '基础规则应含 max-height:calc(100vh - 72px)，实际：' + base
  );
});

test('设置面板基础规则含 overflow-y:auto（矮视口可滚动）', () => {
  const base = ruleOf('.theme-panel');
  assert.ok(
    /overflow-y:\s*auto/.test(base),
    '基础规则应含 overflow-y:auto，实际：' + base
  );
});

test('max-height 约束覆盖到横屏典型高度 360px（dvh 回退生效）', () => {
  const html = fs.readFileSync(
    path.resolve(__dirname, '..', '.temp', 'landscape-panel-probe.html'), 'utf8'
  );
  // 探针必须同时声明旧 vh 值与新 dvh 值（新值写在后面生效于支持的浏览器）
  assert.ok(/max-height:\s*calc\(100vh - 72px\)/.test(html), '探针含 vh 回退值');
  assert.ok(/max-height:\s*calc\(100dvh - 72px\)/.test(html), '探针含 dvh 精确值');
  // 模拟支持 dvh 的浏览器按源码顺序取最后一个声明
  const decls = html.match(/max-height:[^;]+;/g) || [];
  const last = decls[decls.length - 1];
  assert.ok(
    last.includes('calc(100dvh - 72px)'),
    '级联最终值应为 dvh 版本，实际：' + last
  );
});

test('≤480px 查询行为不变（移动竖屏零回归）', () => {
  const mq = css.match(/@media \(max-width:480px\)\{\.theme-panel\{([^}]*)\}/);
  assert.ok(mq, '应保留 480px 查询');
  assert.ok(/max-height:min\(70vh,560px\)/.test(mq[1]), '480px 查询 max-height 保持 min(70vh,560px)');
  assert.ok(/overflow-y:auto/.test(mq[1]), '480px 查询保持 overflow-y:auto');
});

test('设置面板 DOM/渲染逻辑未动（回归保护）', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '..', 'src', 'static', 'js', 'theme-toggle.js'), 'utf8'
  );
  assert.ok(src.includes("className = 'theme-panel'"), '面板 class 赋值未动');
});

// ── 其他弹框横屏排查结论（逐个读码核实）────────────────────────────────
// 无需修（自带约束）：搜索面板 92vh、经文弹框 80vh、app-update 内联 80vh/88vh、resource-pack 内联 55vh
// 需要修（无高度约束 + overflow:hidden → 横屏矮视口裁切）：
//   .cx-dialog    — 通用弹框（清除数据/书签列表/编辑标题/语音提示等 38 处）
//                   书签列表 .cx-bm-list-body 的 flex:1 滚动也依赖父级有高度约束
//   .hl-modal-card — 划线笔记弹框

test('通用弹框 .cx-dialog 含无条件 max-height（横屏矮视口不裁切）', () => {
  const base = ruleOf('.cx-dialog');
  assert.ok(base, '应存在 .cx-dialog 基础规则');
  assert.ok(
    /max-height:\s*min\(80vh,\s*calc\(100dvh - 40px\)\)/.test(base),
    '基础规则应含 max-height:min(80vh,calc(100dvh - 40px))，实际：' + base
  );
});

test('通用弹框 .cx-dialog 整体可滚动（overflow-y:auto）', () => {
  const base = ruleOf('.cx-dialog');
  assert.ok(
    /overflow-y:\s*auto/.test(base),
    '基础规则应含 overflow-y:auto，实际：' + base
  );
});

test('书签列表体 .cx-bm-list-body 保持内部滚动（依赖父级高度约束）', () => {
  const body = ruleOf('.cx-bm-list-body');
  assert.ok(body, '应存在 .cx-bm-list-body 规则');
  assert.ok(/overflow-y:\s*auto/.test(body), '列表体保持 overflow-y:auto');
});

test('笔记弹框 .hl-modal-card 含 max-height 且内部可滚动', () => {
  const base = ruleOf('.hl-modal-card');
  assert.ok(base, '应存在 .hl-modal-card 基础规则');
  assert.ok(
    /max-height:\s*min\(80vh,\s*calc\(100dvh - 32px\)\)/.test(base),
    '基础规则应含 max-height:min(80vh,calc(100dvh - 32px))，实际：' + base
  );
  assert.ok(/overflow-y:\s*auto/.test(base), '基础规则应含 overflow-y:auto');
});