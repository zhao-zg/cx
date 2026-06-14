# PROJECT KNOWLEDGE BASE

**Generated:** 2026-05-19
**Branch:** main (zhao-zg/cx)

## OVERVIEW
Word文档（.docx）/ TXT 文件 → 静态HTML网站生成器，兼安卓PWA/APK打包。Python 3 后端 + Jinja2 模板 + Capacitor 6 Android 壳，部署到 Cloudflare Pages。生成时优先使用 TXT 文件（先查批次目录，再按 YYYY-MM 匹配 `历史合辑/YYYY/YYYY-NN-*.txt`），无 TXT 时回退到 Word 文档解析；每篇的诗歌图片始终从晨兴 Word 文档提取（TXT 路径下由 `patch-hymn-from-word.py` 后处理）；标语诗歌图片从批次文件夹获取。

## STRUCTURE
```
cx/
├── resource/           # Word 源文档，按批次子目录（如 2025-秋季/）
├── src/
│   ├── parser_improved.py  # docx 解析器（双格式自动检测）
│   ├── generator.py        # HTML 生成器（调用 Jinja2 模板）
│   ├── models.py           # 数据模型（Content/Chapter/MorningRevival）
│   ├── bible_dict.py       # 圣经书卷词典
│   ├── static/             # 前端源文件（CSS/JS/index.html）→ 由 main.py 复制到 output/
│   └── templates/          # Jinja2 模板（main_manifest.json, main_sw.js）
├── output/             # 生成产物，勿手动编辑，部署到 Cloudflare Pages
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

## COMMANDS
```bash
# 本地生成静态网站
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

## ANTI-PATTERNS (THIS PROJECT)
- **禁止 PowerShell 写文件**：`Set-Content`/`Out-File`/`>`/`>>` 会破坏 UTF-8 编码，一律用工具的 `Write`/`Edit`
- **禁止本地运行 `npm run encrypt:app-update`**：只在 CI 中加密，本地保持明文便于开发
- **禁止手动编辑 `output/`**：`python main.py` 会覆盖
- **禁止修改 `remote_servers` 中的 URL 明文**：运行时通过 base64 混淆，`main.py` 自动生成 `output/js/remote-config.js`

## UNIQUE STYLES
- 弹框统一使用 `window.CX.openDialog({id, html})` — 见 `.github/copilot-instructions.md` 弹框规范
- 前端 JS 无构建工具，原生 ES5/ES6，直接引用
- Word 样式名映射：`121文章篇题`→h1，`131文章大点`→h2，`132文章中点`→h3，`133文章小点`→h4，`134文章小a点`→h5，`8888文章正文`→p

## NOTES
- `.github/copilot-instructions.md` 包含详细的弹框开发规范和前端 JS 文件职责表，改前端必读
- `app-update.js` 在 CI 构建时被加密替换，APK 中是混淆版；本地仓库始终是明文
- 批次子目录会自动从文件夹名解析年份和季节，标题从文档内容提取
- `src/templates/` 只含 SW/Manifest，实际 HTML 模板内嵌在 `generator.py` 或动态生成
