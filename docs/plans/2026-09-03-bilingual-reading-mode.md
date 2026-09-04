---
AIGC:
  ContentProducer: '001191110102MAD55U9H0F10002'
  ContentPropagator: '001191110102MAD55U9H0F10002'
  Label: '1'
  ProduceID: '5253580d-efbe-4e9c-b136-393aab977d08'
  PropagateID: '5253580d-efbe-4e9c-b136-393aab977d08'
  ReservedCode1: 'aff4148c-cde0-4754-b7b8-3298bf2fa26c'
  ReservedCode2: 'aff4148c-cde0-4754-b7b8-3298bf2fa26c'
---

# 阅读语言模式（中文 / 英中对照）实施计划

> **For implementer:** Use TDD throughout. Write failing test first. Watch it fail. Then implement.
> Python 一律 `G:\soft\Python3.12\python.exe`；PowerShell 禁止写文件（编码破坏），写文件用 Write/Edit 工具。

**Goal:** cx App 新增阅读语言模式：中文（默认，现状不变）/ 英中对照（英文主位：竖屏英上、横屏英左；TTS 朗读英文；设置面板切换）。

**Architecture:** 双语数据为独立 JSON（`output/2026-04/training-enchs.json`，`_en` 后缀平铺字段）。renderer.js 在英中模式下按 batchPath 额外 fetch 该文件并缓存，渲染时输出「英文块 + 中文块」交错结构（`.pair-bilingual`），横竖屏切换纯 CSS。英文经文引用转为中文标准 `data-refs` 后复用 scripture-popup（全局事件委托，零改动）。英文 TTS 走 CXSpeech 既有 `lang` 注入链。

**Tech Stack:** 原生 JS（ES5/ES6 混用，无构建工具）、node:test（Node v24 内置）、Python 3.12 构建管道。

---

## 关键事实（实现前必读）

1. **双语 JSON 结构**：与 training.json 同级同结构，中文键原样 + 英文键 `_en` 后缀：`title_en`、`scripture_en`、`outline_sections_en`、`morning_revivals[].outline_en`、`.feeding_scriptures_en`、`.morning_feeding_en`、`.message_reading_en`、`.ref_reading_en`（`feeding_refs_en` 不存在——merge 确认 EN feeding_refs 复用 CN）。晨读视图当前渲染用 `rev.outline`（**已按天切好的数组**，非 outline_sections 树）。
2. **英文经文引用格式**（实测分布）：缩写带点（`Matt. 9:9`、`2 Cor. 6:14-16`、`1 Pet. 4:16`、`1 Thes. 3:2`）+ 全称（`Matthew 9:9`、`Romans 1:1`）；范围 `~` 或 `-`；节后缀可能带「上」类原文保留。识别后必须转成**中文标准引用**（如 `Matt. 9:9` → `太9:9`）写入 `data-refs`，弹框才能解析。
3. **scripture-popup 点击绑定**：`document` 全局事件委托 `.scripture-ref[data-refs]` 与 `.scripture-block-static[data-refs]`（scripture-popup.js:705/736），新 DOM 只要带正确 `data-refs` 自动可点，零改动。
4. **TTS 语言链**：`CXSpeech.init({ getElements, lang })`（renderer.js:1162）→ `lang = options.lang || 'zh-CN'`（speech.js:353）→ NativeTTS `speak({lang})` / `utt.lang`。**只需在 init 时按模式传 lang**。
5. **TTS 文本收集**：`buildGetElements`（renderer.js:1173）按选择器收集 `textContent`。若渲染结构里英文与中文在不同元素，用选择器排除中文块即可；朗读英文需要 `.en-*` 块成为朗读段。
6. **SW 缓存**：training-enchs.json 命中默认 cache-first 分支（PWA 端天然离线）；Capacitor 原生无 SW，需仿 training.json 带时间戳绕 WebView 缓存 + caches 兜底（renderer.js:136-160 模式）。
7. **front matter 已批准的设计决策**：入口=设置面板「阅读语言」radio；粒度=段落交错；英文主位；TTS=英中模式读英文（lang en-US）；横屏=块内两栏左英右中；范围=cx 晨读 + cv 纲目 + 章封面 title/scripture，ts/zs/h 暂缓；英文引用点击弹中文经文（数据限制）；缺英文段兜底=只渲染中文。
8. **旧批次无 enchs.json**：fetch 404 必须静默降级中文模式（不报错、不缓存失败结果）。
9. **`feeding_refs` 对齐**：EN 复用 CN 的 `feeding_refs`（中文引用键），经文块 `data-refs` 直接可用，无需 EN 正则（EN 正则只用于 morning_feeding_en / message_reading_en / scripture_en 正文行内引用）。
10. **测试基础设施**：无现成 tests 目录，用 Node v24 内置 `node:test` + `--experimental-vm-modules` 不需要——纯函数直接 require。新建 `tests/` 目录，`tests/bilingual-pairing.test.js` 等。**Tests 目录不进 git**（cx 项目 git 只跟踪 src）——但 TDD 仍强制执行，tests 属本地验证工具。

## 双语渲染核心设计（TDD 测试对象）

新增独立纯逻辑模块 `src/static/js/bilingual.js`（IIFE，挂 `window.CXBilingual`，零依赖）——**新文件必须显式注册**（见 Task 7）：

```
CXBilingual.isEnchsMode()            → boolean（localStorage cx_lang_mode === 'enchs'）
CXBilingual.setEnchsMode(bool)       → 写 localStorage
CXBilingual.loadEnchs(batchPath)     → Promise<data|null>（fetch training-enchs.json；失败/404 → null）
CXBilingual.getEnchs(batchPath)      → 已缓存数据或 null（同步）
CXBilingual.pairEn(arrEn, arrCn)     → [{cn,en}]（等长配对，缺英文补 null）
CXBilingual.pairEnTree(cnNode, enNode) → 双树同步（level 对位失败时回退仅中文）
CXBilingual.wrapEnRefs(text)         → 英文引用转中文 data-refs 的 HTML（复用 escText）
CXBilingual.buildPair(enHtml, cnHtml) → '<div class="pair-bilingual"><div class="pair-en">…</div><div class="pair-cn">…</div></div>'
```

**CSS 主位规则**（.pair-bilingual 无 JS，纯 CSS 切换）：
- 竖屏（portrait / narrow）：`.pair-en` 在前 = 上方；`.pair-cn` 辅助样式（字号略小、secondary 色）
- 横屏（landscape & min-width 640px）：`.pair-bilingual { display: grid; grid-template-columns: 1fr 1fr; }` `.pair-en` 第一列 = 左侧；`.pair-cn` 第二列
- `.en-text` 视觉：英文主位正文字号，中文略小 + `var(--text-secondary)` 弱化

**EN 书卷缩写映射表**（正则词边界匹配，大小写不敏感；66 卷全表，分布统计确认的高频项 + 全称形式）：
```
Gen.→创, Exo.→出, Lev.→利, Num.→民, Deut.→申, Josh.→书, Judg.→士, Ruth→得, 1 Sam.→撒上, 2 Sam.→撒下,
1 Kings→王上, 2 Kings→王下, 1 Chron.→代上, 2 Chron.→代下, Ezra→拉, Neh.→尼, Esth.→斯, Job→伯, Psalm/Psalms→诗, Prov.→箴, Ecccl.→传, Isa.→赛, Jer.→耶, Lam.→哀, Ezek.→结, Dan.→但, Hos.→何, Joel→珥, Amos→摩, Obad.→俄, Jonah→拿, Mic.→弥, Nah.→鸿, Hab.→哈, Zeph.→番, Haggai→该, Hag.→该, Zech.→亚, Mal.→玛,
Matt.→太, Mark→可, Mark.→可, Luke→路, John→约, Acts→徒, Rom.→罗, Romans→罗, 1 Cor.→林前, 2 Cor.→林后, Gal.→加, Eph.→弗, Phil.→腓, Phil→腓, Col.→西, 1 Thes.→帖前, 2 Thes.→帖后, 1 Tim.→提前, 2 Tim.→提后, Titus→多, Philem.→门, Heb.→来, James→雅, 1 Pet.→彼前, 2 Pet.→彼后, 1 John→约一, 2 John→约二, 3 John→约三,
Peter→彼前(仅后接节号时), 1 Peter→彼前, 2 Peter→彼后, 1 Samuel→撒上, 2 Samuel→撒下, Genesis→创, Ezekiel→结, Revelation→启, Matthew→太, Isaiah→赛, Zechariah→亚, Daniel→但, 2 Corinthians→林后, Philippians→腓, Ephesians→弗, Galatians→加, Colossians→西, Hebrews→来, 1 Corinthians→林前, 1 Timothy→提前, 2 Timothy→提后, 2 Thessalonians→帖后, 1 Thessalonians→帖前, Numbers→民, Leviticus→利, Deuteronomy→申, Exodus→出, Joshua→书, Judges→士, Ecclesiastes→传, Song of Songs→歌, Jeremiah→耶, Lamentations→哀, Haggai→该, Malachi→玛, Hosea→何, Amos→摩, Micah→弥, Habakkuk→哈, Zephaniah→番, Obadiah→俄, Jonah→拿, Nahum→鸿, Ruth→得, Ezra→拉, Nehemiah→尼, Esther→斯, Job→伯, Proverbs→箴, Titus→多, Philemon→门, James→雅, Jude→犹
```
（注：实现以 tests/bilingual-enrefs.test.js 断言为准；分布统计确认需覆盖：Matt./John/Rom./Rev./Matthew/Acts/1 Cor./Phil./2 Cor./Col./1 Pet./Romans/1 John/Luke/Gal./Heb./Titus/2 Tim./Ezek./2 Corinthians/Philippians/Ephesians/Galatians/Isa./2 Samuel/Gen./Mark/1 Thes./1 Peter/Peter/2 Sam./2 Pet./Ezekiel/Hebrews/2 Timothy/Exo./Psalm/1 Tim./Colossians/Zech./Isaiah/Songs/Numbers/Num./James/2 Thessalonians/2 Thes./1 Chron./2 Chron./Thessalonians/Prov./1 Timothy/1 Corinthians/Josh./Zechariah/Daniel/Dan./Phil/1 Sam./Judg./Lev./Genesis/1 Kings）

**pair 结构（英文主位）**：
```html
<div class="pair-bilingual">
  <div class="pair-en">英文内容 HTML</div>
   <div class="pair-cn">中文内容 HTML</div>
</div>
```

## Task 1: bilingual.js 骨架 + 模式开关

**Files:**
- Create: `src/static/js/bilingual.js`
- Test: `tests/bilingual-mode.test.js`

**Step 1: Write the failing test**（node:test）
```js
const { test } = require('node:test');
const assert = require('node:assert');
// 加载 IIFE：通过临时 window 对象
global.window = {};
require('../src/static/js/bilingual.js');
const CXB = global.window.CXBilingual;
test('isEnchsMode default false', () => { ... localStorage stub ... });
```
（localStorage stub：`global.localStorage = { _s:{}, getItem(k){return this._s[k]||null}, setItem(k,v){this._s[k]=String(v)}, removeItem(k){delete this._s[k]} }`）

**Step 2: Run test — confirm it fails**
命令：`node --test tests/bilingual-mode.test.js`
预期：FAIL — `Cannot find module '../src/static/js/bilingual.js'`

（IIFE 尾部采用 `}(typeof window !== 'undefined' ? window : globalThis))` 模式，Node require 与浏览器 script 标签双兼容；renderer.js 的 `(function(win){...}(window))` 写法不必改。）

**Step 3: Write minimal implementation**
bilingual.js 骨架 + `cx_lang_mode` localStorage 读写。

**Step 4: Run test — confirm it passes**
`node --test tests/bilingual-mode.test.js` → PASS

**Step 5: Commit**
`git add src/static/js/bilingual.js && git commit -m "feat: bilingual.js 骨架与语言模式开关"`
（注：cx git 只跟踪 src，tests 目录若在 .gitignore 内则只提交 src；commit 前按用户惯例先确认）

## Task 2: pairEn 等长配对纯函数

**Files:**
- Modify: `src/static/js/bilingual.js`
- Test: `tests/bilingual-pairing.test.js`

**Step 1: Write failing tests**
```js
// pairEn(['a','b'], ['一','二']) → [{cn:'一',en:'a'},{cn:'二',en:'b'}]
// pairEn(['a','b'], ['一']) → 第二项 en:null（缺英文兜底）
// pairEn([], ['一','二']) → 两项 en:null
// pairEn(null, ['一']) → [{cn:'一',en:null}]
// pairEn(['a'], null) → [{cn:'',en:'a'}] 或 []（实现定为 [{cn:'',en:'a'}]）
```

**Step 2: Run → FAIL（pairEn is not a function）**

**Step 3: minimal 实现（暴露 `win.CXBilingual.pairEn`，`en` 为 null 时渲染层跳过英文块）**
**Step 4: PASS + 全量测试仍绿**
**Step 5: Commit**

## Task 3: pairEnTree 双树同步（cv 纲目/晨读 outline_en）

**Files:**
- Modify: `src/static/js/bilingual.js`
- Test: `tests/bilingual-tree.test.js`（读真实 training-enchs JSON 抽样断言）

**Step 1: failing tests**
```js
// 真数据：chapters[0].morning_revivals[0] 的 outline vs outline_en
// 断言 pairEnTree 遍历后每个 CN 节点挂 .en 属性（title_en 等长对位；level 序列一致）
// 边界：en 树 level 对不上 → 整树回退（.en 全 null）
```

**Step 2: FAIL；Step 3: 实现（递归对位：children 等长则递归，否则该子树 en=null）**；**Step 4: PASS**；**Step 5: Commit**

## Task 4: wrapEnRefs 英文引用→中文 data-refs

**Files:**
- Modify: `src/static/js/bilingual.js`（wrapEnRefs 实现）
- Test: `tests/bilingual-enrefs.test.js`

**Step 1: failing tests（核心断言，实现以测试为准）**
```js
wrapEnRefs('Matt. 9:9 confirms') → 含 data-refs="太9:9"
wrapEnRefs('2 Cor. 6:14-16') → data-refs 含 林后6:14-16
wrapEnRefs('1 Pet. 4:16') → 彼前4:16
wrapEnRefs('John 20:15-17') → 约20:15-17
wrapEnRefs('Acts 2:4; 8:14-17') → 徒2:4,徒8:14-17（同书后续省略书名）
同书多章: 'Matt. 5:1; 28:19' → 太5:1,太28:19
连字符范围转 ~：'Matt. 5:1-2' → 太5:1~2
全称变体（Matthew/Romans/Genesis…）与缩写变体等价映射
无引用纯文本 → 原样转义输出（escText），不误伤普通英文
```

**Step replace 策略**：单遍 replace 回调统一处理「书卷+章:节(范围)」+同书省略的后续引用（`; 28:19`），书卷上下文用外部状态机或两遍扫描（第一遍书名归一，第二遍补书名）——**实现细节留给实现者，以测试断言为准**。

**Step 2: FAIL → Step 3: 实现 → Step 4: PASS（全量）→ Step 5: Commit**

## Task 5: 渲染接入 renderer.js

**Files:**
- Modify: `src/static/js/renderer.js`（renderCx/renderCv/buildChapterHeader/renderOutlineSection 双语分支 + loadTraining 链 + TTS lang）

**Step 1: failing tests（集成层，node:test + stub window/localStorage + 真实 enchs JSON）**
```js
// renderCx 双语模式输出含 .pair-bilingual 块；英文在上（HTML 顺序 en 前 cn 后）
// 纯中文模式输出与现状字节级不变（回归保护——最关键回归断言）
````

**Step 2: FAIL → Step 3: 实现：
- `loadTraining` 成功后：若 isEnchsMode()，`CXBilingual.loadEnchs(batchPath)`（失败 null 静默）→ 存入 `_enchsCache[batchPath]`，传给渲染函数
- renderCx：outline_en 存在时 renderOutlineSection 传 enNode 参数（cn/en title/content 并排 pair 块；level toggle 仍以 CN 树为骨架）
- feeding_scriptures → pairEn(feeding_scriptures_en, feeding_scriptures)，data-refs 复用 CN feeding_refs
- morning_feeding / message_reading → wrapEnRefs(英文) pair + wrapRefs(中文)
- ref_reading_en → 拼接展示（不做引用识别——Life-study 等出版信息不是经文）
- renderCv：outline_sections_en 同理
- buildChapterHeader：title_en/scripture_en 存在时 pair 渲染
- `initSpeechForView` → `CXSpeech.init({ getElements, lang: isEnchsMode() ? 'en-US' : 'zh-CN' })`
- buildGetElements cx 分支：英中模式收集 `.pair-en` 节点（非 .pair-cn）

**Step 4: PASS（全量）→ Step 5: Commit**

## Task 6: 设置面板 UI（theme-toggle.js）

**「阅读模式」section 后插「阅读语言」section**：
```html
<div class="theme-section">
  <div class="theme-section-title">阅读语言</div>
  <div class="theme-options">
    <div class="theme-option" data-lang="cn" onclick="setLangMode('cn')">
      <div class="theme-option-content"><div class="theme-radio"></div><div class="theme-label">中文</div></div>
    </div>
    <div class="theme-option" data-lang="enchs" onclick="setLangMode('enchs')">
      <div class="theme-option-content"><div class="theme-radio"></div><div class="theme-label">英中对照</div></div>
    </div>
  </div>
</div>
```
radio 选中态与主题 radio 一致；`setLangMode(mode)` 写 localStorage + **当前在正文视图时 navigateReplace 当前路径重渲染**（英中数据异步加载，重渲染自动等待 enchs）；面板保持打开。

**测试**：DOM 渲染为纯 UI，项目无 DOM 测试基建——**豁免自动化测试，浏览器验证覆盖**（记入验证清单）。
**Commit**

## Task 6b: speech.js 语音确认（预期零改动）

**Files:** 预期无改动——lang 注入链已验证（`CXSpeech.init({lang})` → `options.lang || 'zh-CN'`）。Task 5 已在 renderer.js init 调用处传 lang。若验证发现收集机制遗漏再补。

**Commit: 无改动则跳过（删除本 task）**

## Task 7: 注册链（防生产静默失效——tdd.md 高危模式）

**Files:**
- Modify: `src/static/index.html`（两处：`<script src="js/bilingual.js">` 且在 renderer.js 之前 + `__cxCoreUrls` 数组加 `'./js/bilingual.js'`）
- Modify: `main.py` `shared_js_files`（1249 行区）加 `'bilingual.js'`（renderer.js 之前）

**Step 1: failing test（防回归）**：`tests/bilingual-registration.test.js` 三个断言：
```js
// index.html 含 <script src="js/bilingual.js"> 且在 renderer.js 之前
// index.html __cxCoreUrls 含 './js/bilingual.js'
// main.py shared_js_files 内含 'bilingual.js'
```
**Step 2: FAIL → Step 3: 改两文件 → Step 4: PASS → Step 5: Commit**

## Task 8: CSS 双语样式

**Files:**
- Modify: `src/static/css/style.css`

**Step 1: 无 DOM/CSS 自动化基建——CSS 豁免 TDD，浏览器验证覆盖（验证清单）**
**Step 2: 样式**（语义变量，禁硬编码色）：
```css
.pair-bilingual { display: flex; flex-direction: column; }
.pair-en { font-size: 1em; }
.pair-cn { font-size: 0.92em; color: var(--text-secondary); }
@media (orientation: landscape) and (min-width: 640px) {
  /* grid 列序 = DOM 顺序：en 先声明在左，cn 在右；order 无需调整 */
  .pair-bilingual { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; }
}
```
**Step 3: 构建后浏览器验证（见验证清单）**；**Step 4: Commit**

## Task 9: 全量构建 + 三副本哈希验证 + 浏览器验证

**Step 1: `python main.py` 全量构建**（日志含 `✓ 复制附加 JSON: training-enchs.json`；版本号 bump）
**Step 2: 三副本一致性**：`src\static\js\bilingual.js` = `output\js\bilingual.js`；`npx cap sync android` 后 android 副本哈希一致
**Step 3: 浏览器验证清单（manual，按用户惯例 unregister SW + 清 caches 后刷新）**：
1. 中文模式（默认）：首页/目录/晨读/纲目/朗读 — 与现状无差异（回归）
2. 设置面板出现「阅读语言」section，两个 radio
3. 切英中 → 晨读页自动重渲染，英文在上/横屏英文在左
4. 英文段经文引用（Matt. 9:9）点击弹**中文**经文
5. TTS：英中模式朗读英文（en-US 音色）；切回中文模式读中文
6. 旧批次（无 enchs.json）切英中模式：静默回退中文，无报错
7. 横竖屏旋转布局切换无重渲染（纯 CSS）
8. localStorage 持久化：刷新后模式保持
9. 横屏时中文列字号 0.92em 弱化观感确认
**Step 4: Commit（若有浏览器验证修正）**

## 验证命令汇总
```powershell
node --test tests/*.test.js          # 全部单测
G:\soft\Python3.12\python.exe main.py  # 全量构建
# 浏览器验证：本地起服务 + unregister SW + 清 caches
```

## Out of scope（明确不做）
- ts/zs/h 视图双语、英文搜索索引、双栏独立滚动同步、英文 TTS 音色选择 UI、英文经文弹框（数据限制）、feeding_refs_en（复用 CN）

> AI生成