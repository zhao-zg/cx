# PROJECT KNOWLEDGE BASE

**Generated:** 2026-06-30
**Branch:** main (zhao-zg/cx)

## OVERVIEW
Word 文档（.docx）/ TXT 文件 → 静态 HTML 网站生成器，兼安卓 PWA/APK 打包。Python 3 后端 + Jinja2 模板 + Capacitor 6 Android 壳，部署到 Cloudflare Pages。

**数据流水线：**
```
resource/{批次}/     tools/build-batch-txt.js      src/parser_improved.py
  *.docx ───────────→ training.json ──────────────→ models.py (Chapter/Content/MorningRevival)
  *.doc               (TXT 优先，docx 回退)               │
                                               src/generator.py + Jinja2
                                                       │
                                               output/{YYYY-MM}/  HTML + JSON
```

生成时优先使用 TXT 文件（先查批次目录，再按 YYYY-MM 匹配 `历史合辑/YYYY/YYYY-NN-*.txt`），无 TXT 时回退到 Word 文档解析；每篇的诗歌图片始终从晨兴 Word 文档提取（TXT 路径下由 `patch-hymn-from-word.py` 后处理）。

参考文档：[README.md](README.md) | [QUICK_START.md](QUICK_START.md) | [DEPLOYMENT.md](DEPLOYMENT.md) | [.github/RELEASE_PROCESS.md](.github/RELEASE_PROCESS.md)

## STRUCTURE
```
cx/
├── resource/           # Word 源文档，按批次子目录（如 2025-秋季/）
├── src/
│   ├── parser_improved.py  # docx 解析器（双格式自动检测，LibreOffice 回退）
│   ├── generator.py        # HTML 生成器 + training.json 导出 + 经文字典
│   ├── models.py           # 数据模型（@dataclass: TrainingData/Chapter/Content/MorningRevival）
│   ├── bible_dict.py       # 圣经书卷词典
│   ├── static/             # 前端源文件（CSS/JS/index.html）→ generator.py 复制到 output/
│   │   ├── css/style.css
│   │   ├── js/             # 共享 JS，列表见 generator.py._copy_static_assets()
│   │   └── index.html
│   └── templates/          # Jinja2 模板（SW/Manifest + base.html/main_index.html）
├── output/             # 生成产物，勿手动编辑，部署到 Cloudflare Pages
│   ├── js/             # generator.py 从 src/static/js/ 复制
│   ├── css/            # generator.py 从 src/static/css/ 复制
│   ├── {YYYY-MM}/      # 每批次的训练 HTML + training.json + scriptures-data.json
│   └── data/           # bible-text.json（经文全文数据）
├── android/            # Capacitor Android 项目
├── .github/            # Workflows + 发布流程文档
├── config.yaml         # 批次/路径/远程服务器配置
├── main.py             # 主入口（批量生成）
├── tools/
│   ├── build-trainings-json.js  # 历史合辑 TXT → training.json
│   ├── build-batch-txt.js       # 批次文件夹 TXT → training.json（优先路径）
│   └── patch-hymn-from-word.py  # TXT 生成后，从晨兴 Word 补丁诗歌图片
├── encrypt_app_update.py  # CI 中加密 app-update.js（本地勿运行）
└── release.bat         # 本地发布：更新版本 + 推送 tag → 触发 CI
```

## WHERE TO LOOK
| 任务 | 位置 |
|------|------|
| 修改解析逻辑 | `src/parser_improved.py` |
| 修改 HTML 生成 | `src/generator.py` + `src/templates/` |
| 修改数据结构 | `src/models.py` |
| 修改前端 UI/交互 | `src/static/js/*.js`, `src/static/css/` |
| 修改 PWA 首页 | `src/static/index.html` |
| 修改安卓构建 | `android/`, `.github/workflows/android-release-offline.yml` |
| 配置批次/服务器 | `config.yaml` |
| 发布新版本 | `.\release.bat` |
| training.json 格式 | 查看 `output/{YYYY-MM}/training.json` 示例 |

## COMMANDS
```bash
# 本地生成静态网站（需在 .venv 虚拟环境中）
python main.py

# 安卓开发调试
npm run android:dev          # build + sync + open Android Studio

# 发布（打 tag，触发 CI 构建 APK）
.\release.bat

# 手动加密/还原 app-update.js（仅在需要本地测试加密时）
npm run encrypt:app-update
npm run restore:app-update
```

## CONVENTIONS
- 所有 Python 文件 UTF-8，首行 `# -*- coding: utf-8 -*-`
- `output/` 是构建产物，不提交到 git（或按需提交用于部署）
- `resource/` 按批次子目录组织，命名格式 `YYYY-季节`（如 `2025-秋季`）
- 配置从 `config.yaml` 读取，不硬编码路径
- Python 虚拟环境位于 `.venv/`，通过 `g:\project\go\cx\.venv\Scripts\Activate.ps1` 激活

### 文本规范化流水线（关键！TTS & 搜索共用）
所有需要坐标一致性的文本处理必须使用完全相同的流水线：
1. `replace(/\s+/g, ' ')` — 多空白合并为单空格
2. `replace(/[\r\n\t]/g, '')` — 移除换行/制表
3. 移除非中文/ASCII 字符
4. `replace(/（[^）]*）/g, '')` + `replace(/\([^)]*\)/g, '')` — 移除全角/半角括号内容
5. `replace(/\s+/g, ' ')` + `.trim()` — 最终合并

**全文与分段必须用同一个流水线**，否则 TTS 暂停/恢复的位置计算会出错（这是多次 bug 的根因）。

### 前端全局命名空间
所有 JS 模块通过 IIFE 挂载到 `window.CX`：
```
window.CX = { backStack, openDialog, lockOverlayScroll, ... }
window.CXSpeech          # TTS 引擎
window.CXRouter          # Hash 路由
window.CXRenderer        # 页面渲染
window.CX_SCRIPTURES_DATA # 经文字典（异步加载）
```

### 路由约定
Hash 路由格式：`#/{batch}` → `#/{batch}/{chapter}/{view}`
- 视图：`cv`=概述, `cx`=内容, `h`=诗歌, `ts`=见证, `sg`=诗歌, `zs`=职事信息
- 视图切换用 `replaceState`（无历史）；跨层跳转用 `location.hash`（新历史）

## ANTI-PATTERNS (THIS PROJECT)
- **禁止 PowerShell 写文件**：`Set-Content`/`Out-File`/`>`/`>>` 会破坏 UTF-8 编码，一律用工具的 `Write`/`Edit`
- **禁止本地运行 `npm run encrypt:app-update`**：只在 CI 中加密，本地保持明文便于开发
- **禁止手动编辑 `output/`**：`python main.py` 会覆盖
- **禁止修改 `remote_servers` 中的 URL 明文**：运行时通过 base64 混淆，`main.py` 自动生成 `output/js/remote-config.js`
- **禁止在 JS 中直接硬编码远程 URL**：使用 `remote-config.js` 中的混淆变量
- **禁止在 `training.json` 路径中使用纯数字年份**：需保证和 `resource/` 子目录名称匹配

## UNIQUE STYLES
- 弹框统一使用 `window.CX.openDialog({id, html})` — 详见 `.github/copilot-instructions.md` 弹框规范
- 前端 JS 无构建工具，原生 ES5/ES6，直接引用
- Word 样式名映射：`121文章篇题`→h1，`131文章大点`→h2，`132文章中点`→h3，`133文章小点`→h4，`134文章小a点`→h5，`8888文章正文`→p
- TTS 状态机：单一 `state = 'idle' | 'playing' | 'paused'`（Web Speech 和 NativeTTS 共用）
- 平台检测：`window.Capacitor?.Plugins?.App`（Capacitor） / `matchMedia('(display-mode: standalone)')`（PWA）
- 训练目录命名：`output/{YYYY-MM}/`，每月一个目录，内含该月所有训练

## NOTES
- `.github/copilot-instructions.md` 包含详细的弹框规范、前端 JS 文件职责表和 TTS 架构说明，改前端必读
- `app-update.js` 在 CI 构建时被加密替换，APK 中是混淆版；本地仓库始终是明文
- 批次子目录会自动从文件夹名解析年份和季节，标题从文档内容提取
- `src/templates/` 含 `base.html`（主题引导）、`main_index.html`（首页）、`main_manifest.json`、`main_sw.js`
- 前端新增 JS 文件时，需同步更新 `generator.py._copy_static_assets()` 中的 `shared_js_files` 列表
- TTS 暂停/恢复位置计算 bug 是高频回归点，修改 `speech.js` 时特别注意坐标一致性
