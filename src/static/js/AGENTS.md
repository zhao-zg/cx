# src/static/js/ — 前端运行时

## OVERVIEW
19 个原生 JS 文件，无构建工具，ES5/ES6 混用，直接引用。由 `main.py` 复制到 `output/js/`。

## FILE RESPONSIBILITIES
| 文件 | 职责 |
|------|------|
| `theme-toggle.js` | 主题切换、设置面板、**`CX.openDialog` 弹框工厂**、`CX.backStack` |
| `speech.js` | TTS 朗读（Web Speech API + Capacitor NativeTTS），状态机 `idle/playing/paused` |
| `router.js` | SPA 路由 |
| `nav-stack.js` | 页面翻页 & 返回栈（PWA/Capacitor） |
| `scripture-popup.js` | 经文弹框，中文书卷/章节引用解析 |
| `app-update.js` | APK 自动更新（GitHub Releases + 镜像回退）**⚠️ CI 构建时被加密** |
| `resource-pack.js` | 资源包管理对话框 |
| `renderer.js` | 各页面类型渲染逻辑 |
| `outline.js` | 大纲折叠/展开交互 |
| `search.js` | 全文搜索 |
| `highlight.js` | 搜索词高亮 |
| `ref-detector.js` | 经文引用自动检测 |
| `training-enricher.js` | 训练数据增强 |
| `toc-redirect.js` | 目录重定向 |
| `bible-dict.js` | 客户端圣经书卷词典 |
| `font-control.js` | 字体大小控制 |
| `image-utils.js` | 图片懒加载/处理 |
| `dev-console.js` | 开发调试控制台（非生产） |
| `txt-importer.js` | TXT 文件导入 |

## DIALOG PATTERN (强制)
新增弹框必须用 `CX.openDialog`：
```js
var dlg = window.CX.openDialog({ id: 'myMask', html: '<div class="cx-dialog">...</div>' });
if (!dlg) return;  // 防重复打开
dlg.mask.addEventListener('click', function(e) { /* 内部事件委托 */ });
var btn = document.getElementById('closeBtn');
if (btn) btn.addEventListener('click', dlg.close);
```
`openDialog` 已自动处理：遮罩挂载、lockOverlayScroll、backStack push、遮罩点击关闭。

## ANTI-PATTERNS
- **禁止** 手动操作 `backStack.push/pop` + DOM `appendChild` 重复实现弹框逻辑
- **禁止** 本地加密/混淆 `app-update.js`（`npm run encrypt:app-update` 仅 CI 用）
- **禁止** 引入 npm 包或构建步骤，保持零依赖直接引用
- 遮罩点击关闭必须 `e.stopPropagation()`，防冒泡误触设置面板

## NOTES
- `vendor/` 目录存放第三方库（jszip 等），不修改
- `dev-console.js` 仅开发用，生产部署时应排除或保持无副作用
