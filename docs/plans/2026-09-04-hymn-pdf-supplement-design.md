---
AIGC:
  ContentProducer: '001191110102MAD55U9H0F10002'
  ContentPropagator: '001191110102MAD55U9H0F10002'
  Label: '1'
  ProduceID: '90ff633a-bb1d-4ea9-8d81-136c8b1cdb3c'
  PropagateID: '90ff633a-bb1d-4ea9-8d81-136c8b1cdb3c'
  ReservedCode1: '91281e23-73f3-4d8e-b9d0-2c8cb508b0b7'
  ReservedCode2: '91281e23-73f3-4d8e-b9d0-2c8cb508b0b7'
---

# 晨兴中英对照 PDF 诗歌图补充（hymn-pdf-supplement）设计文档

> **For implementer:** Use TDD throughout. Write failing test first. Watch it fail. Then implement.
> Python 一律 `G:\soft\Python3.12\python.exe`；PowerShell 禁止写文件（编码破坏），写文件用 Write/Edit 工具。

**Goal:** 从各批次的「晨兴中英对照.pdf」（矢量排版）自动识别诗歌页，渲染为高质量图片，**补充**（不替换）到 cx App 构建产物 `training.json` 中，为每篇训练补上高清诗歌图（含标语诗歌），图片体积控制在可接受范围（约 166KB/张，12+2 张 ≈ 2.3MB/批次）。

**非目标：** 不改动前端渲染（renderer.js 已支持多图堆叠）；不替换现有 Word 原图；不涉及晨读正文内容解析（那是 cx-hwmr-pipeline 的事，本次只做诗歌页）。

---

## 关键事实（实现前必读）

1. **PDF 无位图**：2026-04 PDF 全书 xref 扫描 0 个 `/Image` 对象（纯文本+纯矢量排版）。诗歌页必须用 PyMuPDF `get_pixmap()` 矢量渲染，不能用 extract_image。
2. **诗歌页特征（2026-04 全书已 probe 验证）**：
   - 12 个周诗歌页：0-based 页码 `[27, 49, 69, 89, 109, 131, 153, 173, 195, 215, 237, 259]`，绘图数 ≥182（实测 182~613），文本含 `第N周诗歌` 或 `WEEK N — HYMN`。
   - 2 个封面歌页：第 3 页（绘图 381）+ 第 4 页（绘图 395，**续页**，需按紧邻规则纳入），文本含「封面歌」。
   - 识别规则（不依赖硬编码页码）：绘图数 ≥ 100（安全阈值，实际 ≥182）+ 文本含 `HYMN` / `第N周诗歌` / `封面歌`。封面歌续页规则：识别到封面歌首页后，若下一页**无**周诗歌特征且无 HYMN 特征但绘图数也高（≥100），则作为续页纳入。
   - **页码映射**：12 个周诗歌页按 PDF 顺序对应 chapters 的 `number` 1-12（PDF 顺序 = 章节顺序假设，EPUB/TXT 管线同此约定）。
3. **裁剪关键坑**：周诗歌页文本 y 30~553、绘图 y 81~550，覆盖良好；但封面歌第 4 页文本 y 100~553、绘图 y 71~536——单用文本坐标会切掉上方乐谱线。**必须用「文本 + 绘图联合 bbox」外扩 15pt**，同时剔除页眉页脚。
4. **压缩参数（probe-compress.py 实测）**：200dpi WebP q80 → 平均 166KB/张、2339px 宽（约现有 Word 图 4.7 倍清晰度）；PNG 364KB、PNG256 177KB、150dpi WebP 119KB。**采用 200dpi + WebP q80**（体积与清晰度平衡）。
5. **现有 Word 图现状**：18~29KB、约 500px 宽，放大即模糊——是用户要补充的原因；**保留不替换**。
6. **数据模型**：`src/models.py` 约 256-291 行 `TrainingData`：含 `hymn_image`（兼容第一张）、`hymn_images`（多张列表）、`motto_song_image`、`motto_song_images`；`to_dict` 已有空值回退。
7. **前端消费**：`output/js/renderer.js` renderSg（约 624-705 行）支持 `hymn_images` 多图上下堆叠、点击放大；封面歌多图展示约 1600-1631 行——**追加后零前端改动**。
8. **封面歌图片复制规则（修正）**：`tools/build-batch-epub.js`（138-160 行 `copyMottoSongImages`）只复制**以「标语诗歌」开头**的文件（`^标语诗歌` + `\.(png|jpe?g|webp|gif)$`），复制到 `output/images/` 保留原文件名；EPUB/TXT 两管线（build-batch-epub.js 255-258、build-batch-epub.py 1311-1316、parser_improved.py 2748-2782）都从**批次文件夹**扫「标语诗歌*」图片设为 motto_song_images。实测 output/2026-04/training.json 顶层 `motto_song_image: "images/标语诗歌.png"`、`motto_song_images: ["images/标语诗歌.png", "images/标语诗歌2.png"]`；output/images/ 下确有 标语诗歌.png / 标语诗歌2.png（约 300KB）。**PDF 封面歌图必须命名为「标语诗歌_pdf_*.webp」**才能被复制过滤（`^标语诗歌`）识别。命名规则更新见第 11 条。
9. **现有 Word 补丁工具**：`tools/patch-hymn-from-word.py`（217 行），接口 `--output-dir` + `--batch-folder`。**关键语义：`hymn_images`/`hymn_image`/`hymn_lyrics` 是「覆盖/替换」**（143-147 行 `ch['hymn_images'] = word_ch.hymn_images`），且会清空 `hymn_lyrics`；孤儿清理只删 `^\d+_hymn\.` 模式的 EPUB 图（169 行），**不会误删我们 `hymn_pdf_*` / `标语标语_pdf_*` 的图**。因此：
   - PDF 追加工具必须**在 word patch 之后**运行（否则被覆盖丢失）。
   - PDF 图文件名避开 word（`hymn_{n}_*`）与 EPUB（`{n}_hymn`）命名，用 `hymn_pdf_{n}.webp`。
10. **main.py 接入点**：TXT 管线 560-613 行、EPUB 管线 755-811 行调用 patch-hymn-from-word.py；之后有 hymn_images 回退补充（614-655 / 815-855）。**PDF 追加应在 word patch 之后、回退补充之前**（让回退逻辑见到 PDF 图已就位，且 word patch 的覆盖不会冲掉 PDF 追加）。注意：main.py 的「回退补充」逻辑只认 `hymn_*.png/jpg/jpeg`（620 行扩展名过滤），`hymn_pdf_*.webp` 不会被它识别为候选——这是好事（回退只处理 word 图场景，不干扰 PDF 图）。
11. **命名规范（避免冲突，已定稿）**：
    - Word 图：`hymn_{number}_{后缀}.png`（如 `hymn_1_晨兴.png`）
    - EPUB 图：`{number}_hymn.png`
    - **周诗歌 PDF 图：`hymn_pdf_{number}.webp`**（JSON 引用 `images/hymn_pdf_{number}.webp`）
    - **封面歌 PDF 图：`标语诗歌_pdf_{序}.webp`**（必须以「标语标语」开头才能被 build-batch-epub.js / .py 的复制规则收录进 output/images/；同时 `_pdf_` 中缀避免与现有 标语诗歌.png / 标语诗歌2.png 冲突）
    - 幂等判定键：JSON `hymn_images` 含 `hymn_pdf_` 项 → 跳过周诗歌追加；`motto_song_images` 含 `标语标语_pdf_` 项 → 跳过封面歌追加。
    - **追加位置**：周诗歌图**追加到 `hymn_images` 尾部**（Word 图保持首位，`hymn_image` 不动）；封面歌图追加到 `motto_song_images` 尾部（`motto_song_image` 不动）。
12. **测试基础设施**：`tests/` 已有 `down-resource-hwmr-pdf.test.py`（Python 风格参考）、`bilingual-*.test.js`（node:test）。本项目本次全部为 Python 工具，用 **unittest**（G:\soft\Python3.12\python.exe 直接跑，无需 pip 依赖外的包——PyMuPDF/Pillow 已可用）。

## 模块设计（TDD 测试对象）

### 模块 A：`tools/hymn_pdf_lib.py`（纯逻辑库，供测试与 CLI 共用）

```
identify_hymn_pages(pdf_path) → {
  'weeks': [ {page_index, number} ... ],   # 12 个周诗歌页（number=1-12，按 PDF 顺序）
  'motto': [page_index, ...],              # 封面歌页（含续页）
}
```
实现：逐页 `page.get_text()` + `page.get_drawings()`；绘图数 ≥100 为候选；文本含 `第N周诗歌`/`WEEK.*HYMN` 归周诗歌，含「封面歌」归 motto；motto 首页之后紧邻的高绘图数页（无周特征）纳入续页。

| `crop_render(pdf_path, page_index, dpi=200)` -> PIL Image |
| `联合 bbox`：文本 bbox（`page.get_text('dict')` 的 block bbox）∪ 绘图 bbox（`get_drawings()` 的 rect），外扩 15pt，clip 到页面内；渲染 `get_pixmap(matrix=fitz.Matrix(dpi/72, dpi/72), clip=bbox)` → PIL Image（RGB）。 |

`compress_webp(img, quality=80) -> bytes`：PIL `Image.save(BytesIO, 'WEBP', quality=80, method=6)`。

`is_pdf_hymn_image(filename) -> bool`（`hymn_pdf_` 前缀 或 `标语标语_pdf_` 前缀）

### 新工具：`tools/patch-hymn-from-pdf.py`（CLI，仿 patch-hymn-from-word.py 风格）

接口：`--output-dir <output/{batch}> --batch-folder <resource/{batch}> --force`

流程（幂等，可重跑）：
1. 定位 `{batch-folder}/晨兴中英对照.pdf`（无则跳过并提示）。
2. `identify_hymn_pages` 得周诗歌页 + 封面歌页。
3. 对每个周诗歌页：渲染→裁剪→压缩→存 `{output-dir}/images/hymn_pdf_{number}.webp`（已存在且非 --force 则跳过）。
4. 读 `{output-dir}/training.json`：每章的 `hymn_images` 若含 `hymn_pdf_` 项则跳过，否则**追加到尾部** `images/hymn_pdf_{number}.webp`（Word 图保持首位，`hymn_image` 不动）。
5. 封面歌：渲染每页独立成图 → 存 `标语标语_pdf_1.webp` / `标语标语_pdf_2.webp`（以「标语标语」开头才能被 build-batch-epub.js/.py 复制规则收录进 output/images/）；追加到顶层 `motto_song_images` 尾部（幂等判定键 `标语标语_pdf_`；`motto_song_image` 不动）。
6. 写回 `training.json`（保持原 JSON 缩进/序，避免全量重排——用 json.dump 默认排序关）。

### 决策（已定稿）
- 封面歌**每页独立成图（2 张）**：`标语标语_pdf_1.webp` / `标语标语_pdf_2.webp`（简单、与现有多图展示兼容；拼长图在窄屏上体验差）。
- 周诗歌图**追加到 `hymn_images` 尾部**（Word 图在前保兼容；`hymn_image` 不动仍为 Word 图第一张）。
- 封面歌 PDF 图**追加到 `motto_song_images` 尾部**（`motto_song_image` 不动，仍为 标语诗歌.png）。
- 若批次文件夹**已有同名目标 WebP**（如 标语标语_pdf_1.webp），先删除旧版再写新（保证 --force 后一致）。

## 幂等与回归

- 目标 WebP 已存在 → 跳过渲染（除非 --force）。
- training.json 中 `hymn_images`/`motto_song_images` 已含 `hymn_pdf_`/`标语标语_pdf_` 项 → 不重复追加。
- 全流程重跑 `python main.py` 不回归（12+2 张 WebP 已就位，JSON 引用幂等）。
- 验证：`tests/test_hymn_pdf_lib.py` 用 2026-04 真实 PDF 断言 12+2 页识别、裁剪 bbox 不越界、WebP 魔数/尺寸；`tools/patch-hymn-from-pdf.py` 用临时 output 副本断言追加与幂等。

## 环境

- Python 3.12 `G:\soft\Python3.12\python.exe`；PyMuPDF 1.26.5；Pillow 已装。
- Windows 控制台 GBK：脚本内 `sys.stdout.reconfigure(encoding='utf-8')`。
- PowerShell 禁止写文件（UTF-8 破坏）；写文件用 Write/Edit 工具；测试/构建用 PowerShell 跑命令。
- cx git 只跟踪 src；docs/plans 与 tests 为本地工件。

> AI生成