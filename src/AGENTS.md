# src/ — Python 后端

## OVERVIEW
Word 解析 + HTML 生成管道。4 个 Python 模块 + 前端静态资源 + Jinja2 模板。

## STRUCTURE
```
src/
├── parser_improved.py   # docx 解析器（双格式：经文.docx / 听抄.docx / 晨兴.docx）
├── generator.py         # HTML 生成器，HTML 模板内嵌于此文件（非 templates/ 目录）
├── models.py            # 数据模型：Content / Chapter / MorningRevival（dataclass）
├── bible_dict.py        # 圣经书卷中英文词典，供经文引用解析
├── static/              # 前端源文件（main.py 原样复制到 output/）
└── templates/           # 仅含 main_sw.js + main_manifest.json（SW 和 PWA Manifest 模板）
```

## WHERE TO LOOK
| 任务 | 文件 |
|------|------|
| 解析新文档样式 | `parser_improved.py` → 样式名 → `_parse_style()` |
| 新增页面类型 | `generator.py` → 找对应 `generate_*()` 函数 |
| 修改数据字段 | `models.py` → `Chapter` / `Content` / `MorningRevival` |
| 圣经书卷扩展 | `bible_dict.py` |
| 修改 SW 缓存策略 | `templates/main_sw.js` |

## DATA FLOW
```
docx → parser_improved.py → Chapter/Content 对象
                          → generator.py → HTML 字符串 → output/{batch}/
main.py 同时复制 src/static/* → output/
```

## KEY MODELS
- `Content`: 通用大纲节点（level/title/scripture/content/children 递归树）
- `Chapter`: 一篇的全部数据（outline_sections + detail_sections + morning_revivals + hymn_*）
- `MorningRevival`: 单天晨读（day + outline + feeding_scriptures + morning_feeding + message_reading）

## CONVENTIONS
- 所有函数必须处理 `None` 参数（文档可能缺失某类型文件）
- 解析器返回 `List[Chapter]`，生成器消费此列表
- 批次标题/副标题从文档内容自动提取，不从 `config.yaml` 读取

## ANTI-PATTERNS
- **禁止在 `templates/` 放 HTML 模板**：HTML 模板内嵌在 `generator.py` 中
- **禁止硬编码批次路径**：通过 `config.yaml` → `resource_base_dir` 读取
