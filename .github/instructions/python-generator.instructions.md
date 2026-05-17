---
applyTo: "src/**/*.py"
---

# Python 生成器规范

## 数据模型（src/models.py）

核心类层次：`TrainingData` → `Chapter` → `Content` / `MorningRevival`

| 类 | 说明 |
|---|---|
| `Content` | 大纲节点；`level` 为壹/一/1/a 等层级标识 |
| `MorningRevival` | 按天的晨读内容（周一～周六），含 `morning_feeding` / `message_reading` / `ref_reading` |
| `Chapter` | 篇章；`outline_sections` 来自经文.docx，`detail_sections` 来自听抄.docx |
| `TrainingData` | 整个训练的根对象，含 `chapters: List[Chapter]` |

修改模型时注意 `Chapter.to_dict()` 的序列化映射也需同步更新。

## 解析器（src/parser_improved.py）

- `load_document(path)` 自动区分 `.doc`（LibreOffice 转换）和 `.docx`（python-docx 直接解析）
- `ImprovedParser` 使用**双格式自动检测**：先检测段落样式名，再回退正则
- 禁止使用 `win32com`；`.doc` 转换依赖 LibreOffice（可选），不存在时应优雅报错而非崩溃

## 生成器（src/generator.py）

- 所有静态资源从 `src/static/` 复制到 `output/`，由 `_copy_static_assets()` 完成
- 训练页面用 `../js/` 和 `../css/` 相对路径引用根目录共享资源
- Jinja2 自定义过滤器在 `__init__` 中注册：`extract_day`、`outline_level_class`
- 出处引用通过 `_normalize_source_abbr()` 替换：李常受文集 → CWWL，生命读经 → L-S

## 构建入口（main.py）

```bash
python main.py          # 重新生成 output/ 全部静态文件
```

- 读取 `config.yaml` 获取批次目录和远程服务器地址
- 生成 `output/js/remote-config.js`（URL 以 base64 混淆存储）
- `batch_processing.max_latest_trainings` 控制保留最新 N 个训练打包

## 依赖

```
python-docx   # docx 解析
Pillow        # 图片处理（诗歌图片提取）
jinja2        # 模板引擎
PyYAML        # config.yaml 解析
```
