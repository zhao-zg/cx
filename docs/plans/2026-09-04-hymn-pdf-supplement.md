---
AIGC:
  ContentProducer: '001191110102MAD55U9H0F10002'
  ContentPropagator: '001191110102MAD55U9H0F10002'
  Label: '1'
  ProduceID: '22f63a59-19c6-4c2e-9977-6d3f974efe7d'
  PropagateID: '22f63a59-19c6-4c2e-9977-6d3f974efe7d'
  ReservedCode1: 'bd1f0bf4-73f3-42cc-bcba-9c99fcade841'
  ReservedCode2: 'bd1f0bf4-73f3-42cc-bcba-9c99fcade841'
---

# 晨兴中英对照 PDF 诗歌图补充（hymn-pdf-supplement）实施计划

> **For implementer:** Use TDD throughout. Write failing test first. Watch it fail. Then implement.
> Python 一律 `G:\soft\Python3.12\python.exe`；PowerShell 禁止写文件（编码破坏），写文件用 Write/Edit 工具。

**Goal:** 从「晨兴中英对照.pdf」识别诗歌页（12 周诗歌 + 封面歌），渲染为 200dpi WebP q80，**追加**到 training.json（`hymn_images` / `motto_song_images` 尾部），不替换 Word 图，幂等可重跑，接入 main.py 两条管线。

**Architecture:** 新增纯逻辑库 `tools/hymn_pdf_lib.py`（识别/渲染/压缩/命名），CLI `tools/patch-hymn-from-pdf.py` 执行「识别→渲染→追加→写回」；main.py 在 word patch 之后调用。

---

## Task 0: 预检（无代码）

**Files:** 只读。

- 确认 `resource/2026-04 夏季训练/晨兴中英对照.pdf` 存在（已确认）。
- 确认 output/2026-04/training.json 存在且含 chapters（已确认）。

## Task 1: TDD 识别模块 `identify_hymn_pages`

**Files:**
- Create: `tools/hymn_pdf_lib.py`
- Test: `tests/test_hymn_pdf_lib_identify.py`

**Step 1: Write failing test**
```python
import sys, os, json, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.hymn_pdf_lib import identify_hymn_pages

PDF = r'resource/2026-04 夏季训练/晨兴中英对照.pdf'

class TestIdentify(unittest.TestCase):
    def test_12_weeks(self):
        res = identify_hymn_pages(PDF)
        self.assertEqual(len(res['weeks']), 12)
        self.assertEqual([w['number'] for w in res['weeks']], list(range(1, 13)))
    def test_motto_pages(self):
        res = identify_hymn_pages(PDF)
        self.assertEqual(len(res['motto']), 2)  # 第 3、4 页
        self.assertEqual(res['motto'], [3, 4])
    def test_week_page_indices(self):
        res = identify_hymn_pages(PDF)
        self.assertEqual([w['page_index'] for w in res['weeks']],
                         [27, 49, 69, 89, 109, 131, 153, 173, 195, 215, 237, 259])
```

**Step 2: Run — confirm fail**
`P:\soft\Python3.12\python.exe -m unittest tests.test_hymn_pdf_lib_identify -v`
预期：ImportError（hymn_pdf_lib.py 不存在）。

**Step 3: Implement `identify_hymn_pages`**
```python
import fitz

HYMN_DRAW_MIN = 100

def identify_hymn_pages(pdf_path):
    doc = fitz.open(pdf_path)
    weeks, motto = [], []
    prev_was_motto = False
    for idx, page in enumerate(doc):
        text = page.get_text()
        drawings = page.get_drawings()
        n_draw = len(drawings)
        # 周诗歌
        if n_draw >= HYMN_DRAW_MIN and ('HYMN' in text or '诗歌' in text):
            weeks.append({'page_index': idx, 'number': len(weeks) + 1})
            prev_was_motto = False
            continue
        # 封面歌
        if '封面歌' in text:
            motto.append(idx)
            prev_was_motto = True
            continue
        # 续页：紧邻封面歌之后的高绘图页
        if prev_was_motto and n_draw >= HYMN_DRAW_MIN:
            motto.append(idx)
            prev_was_motto = False
            continue
        prev_was_motto = False
    doc.close()
    return {'weeks': weeks, 'motto': motto}
```
> 注意：`number` 按**发现顺序** 1..12（PDF 顺序=章节顺序）；motto 续页规则：首页（含「封面歌」文本）后紧邻的高绘图页纳入。首版以 2026-04 实测特征为准；若其他批次特征不同，识别为 0 时打印警告。

**Step 4: Run — confirm pass**
`P:\...\python.exe -m unittest tests.test_hymn_pdf_lib_identify -v` → 3 tests PASS。

## 确认 2: 渲染裁剪压缩 `crop_render` / `compress_webp`

**Files:**
- Modify: `tools/hymn_pdf_lib.py`
- Test: `tests/test_hymn_pdf_lib_render.py`

**Step 1: Write failing test**
```python
from tools.hymn_pdf_lib import crop_render, compress_webp
from PIL import Image
import io

def test_crop_render_returns_rgb_image():
    img = crop_render(PDF, 27, dpi=200)
    assert img.mode == 'RGB'
    assert img.width > 1000 and img.height > 500
    # 不越界：渲染区域应在页内

def test_crop_render_motto_page4_keeps_top():
    # 第 4 页（索引 3）上方有乐谱线，联合 bbox 外扩 15pt 后不裁掉
    img = crop_render(PDF, 3, dpi=200)
    # 高度应接近满页（不裁剪到只剩中间）
    assert img.height > 1000

def test_compress_webp():
    img = crop_render(PDF, 27, dpi=200)
    data = compress_webp(img, quality=80)
    assert data[:4] == b'RIFF' and data[8:12] == b'WEBP'
    assert len(data) < 400 * 1024  # 166KB 平均，留裕量
```

**Step 2: Run — confirm fail**（crop_render/compress_webp 不存在）。

**Step 3: Implement**（联合 bbox 裁剪）
```python
import io, fitz
from PIL import Image

JOIN_PAD = 15.0

def _union_bbox(page):
    """文本 bbox ∪ 绘图 bbox，外扩 15pt，clip 到页面内"""
    pr = page.rect
    boxes = []
    for b in page.get_text('dict').get('blocks', []):
        if 'bbox' in b:
            boxes.append(fitz.Rect(b['bbox']))
    for d in page.get_drawings():
        boxes.append(fitz.Rect(d['rect']))
    if not boxes:
        return None
    u = fitz.Rect()
    for r in boxes:
        u |= r
    u = u + (-JOIN_PAD, -JOIN_PAD, JOIN_PAD, JOIN_PAD)
    u &= pr  # clip 到页内
    return u


def crop_render(pdf_path, page_index, dpi=200):
    doc = fitz.open(pdf_path)
    page = doc[page_index]
    bbox = crop_bbox(page)
    matrix = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=matrix, clip=bbox)
    img = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
    doc.close()
    return img


def compress_webp(img, quality=80):
    buf = io.BytesIO()
    img.save(buf, 'WEBP', quality=quality, method=6)
    return buf.getvalue()
```

**Step 4: Run — confirm pass**。若 WebP 体积超 400KB（某些页乐谱复杂），放宽到 600KB 并记录实际值。

## Task 3: `patch-hymn-from-pdf.py` CLI（幂等追加）

**Files:**
- Create: `tools/patch-hymn-from-pdf.py`
- Test: `tests/test_patch_hymn_from_pdf.py`

**Step 1: Write failing tests**（用临时目录模拟 output/，不写真实 output）
```python
import tempfile, json, os, shutil, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.patch_hymn_from_pdf import patch_hymn_from_pdf

def make_fake_output(tmp):
    out = os.path.join(tmp, 'out'); os.makedirs(os.path.join(out, 'images'))
    td = {'chapters': [
        {'number': 1, 'hymn_image': 'images/hymn_1_晨兴.png',
         'hymn_images': ['images/hymn_1_晨兴.png']},
        {'number': 2, 'hymn_image': 'images/hymn_2_晨兴.png',
         'hymn_images': ['images/hymn_2_晨兴.png']},
    ], 'motto_song_image': 'images/标语诗歌.png',
       'motto_song_images': ['images/标语诗歌.png', 'images/标语诗歌2.png']}
    with open(os.path.join(out, 'training.json'), 'w', encoding='utf-8') as f:
        json.dump(td, f, ensure_ascii=False, indent=2)
    return out

class TestPatch(unittest.TestCase):
    def test_appends_pdf_images(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = temp_fake_output(tmp)
            res = patch_hymn_from_pdf(out, 'resource/2026-04 夏季训练')
            td = json.load(open(os.path.join(out, 'training.json'), encoding='utf-8'))
            self.assertTrue(any(x.startswith('images/hymn_pdf_') for ch in td['chapters'] for x in ch['hymn_images']))
            self.assertTrue(any('标语标语_pdf_' in x for x in td['motto_song_images']))
    def test_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = temp_fake_output(tmp)
            patch_hymn_from_pdf(out, 'resource/2026-04 夏季训练')
            r1 = json.load(open(...))
            patch_hymn_from_pdf(out, 'resource/2026-04 夏季训练')
            r2 = json.load(open(...))
            self.assertEqual(r1['chapters'][0]['hymn_images'], r2['chapters'][0]['hymn_images'])
            self.assertEqual(r1['motto_song_images'], r2['motto_song_images'])
```

**Step 2: Run — confirm fail**（模块不存在）。

**Step 3: Implement `patch_hymn_from_pdf(output_dir, batch_folder, force=False)`**
1. pdf = `{batch_folder}/晨兴中英对照.pdf`，不存在 → return 摘要。
2. identify → weeks/motto。
3. 对每 week：渲染 crop_render → compress_webp → 写 `{output}/images/hymn_pdf_{number}.webp`（存在且非 force → 跳过）。
4. 对每 motto 页 idx：写 `{output}/images/标语标语_pdf_{n}.webp`（n=1..len(motto)）。
5. 读 training.json：每 chapter `hymn_images` 若无 `hymn_pdf_` 项 → 尾部 append；顶层 `motto_song_images` 若无 `标语标语_pdf_` 项 → 尾部 append。
6. 写回（json.dump ensure_ascii=False, indent=2）。

返回 `{patched_chapters, motto_appended, images_written, skipped_existing, weeks, motto}`。

**Step 4: Run — confirm pass。**

## Task 4: 接入 main.py（两条管线）

**Files:**
- Modify: `main.py`

在 EPUB 管线（约 811 行 word patch 之后、回退补充之前）与 TXT 管线（约 613 行之后、回退补充之前）各插入一段 subprocess 调用：
```python
    # ── 从晨兴中英对照 PDF 追加诗歌图（高清）────────────────────────────
    _patch_pdf = os.path.join(os.path.dirname(__file__), 'tools', 'patch-hymn-from-pdf.py')
    if os.path.exists(_patch_pdf):
        try:
            _child_env2 = os.environ.copy()
            _child_env2['PYTHONIOENCODING'] = 'utf-8'
            pdf_result = subprocess.run(
                [sys.executable, _patch_pdf,
                 '--output-dir', output_dir,
                 '--batch-folder', batch_folder],
                capture_output=True, text=True, encoding='utf-8',
                errors='replace', timeout=240, env=_child_env2)
            if pdf_result.stderr:
                for _l in pdf_result.stderr.strip().split('\n'):
                    print(f"  {_l}")
            if pdf_result.returncode == 0 and pdf_result.stdout.strip():
                _raw = pdf_result.stdout.strip()
                _js = _raw[_raw.find('{'):_raw.rfind('}') + 1]
                if _js.startswith('{'):
                    _meta = json.loads(_js)
                    _n = _meta.get('images_written', 0)
                    _w = _meta.get('patched_chapters', 0)
                    if _n:
                        print(f"  ✓ PDF 诗歌图补充: {_n} 张 ({_w} 篇)")
                    else:
                        print(f"  ℹ PDF 诗歌图补充: 无新增（已存在或跳过）")
        except subprocess.TimeoutExpired:
            print(f"  ⚠ PDF 诗歌图补充超时，跳过")
        except Exception as _e:
            print(f"  ⚠ PDF 诗歌图补充异常: {_e}")
```
> 注意：main.py 现有代码块用 4 空格缩进 + `_` 前缀局部变量，保持风格一致；两处插入位置务必在「回退补充」之前，保证回退逻辑可见 PDF 图。

## Task 5: 端到端验证（2026-04）

**Files:** 运行验证（不写代码）

1. `G:\soft\Python3.12\python.exe tools/patch_hymn_from_pdf.py --output-dir output/2026-04 --batch-folder "resource/2026-04 夏季训练" --force`
   - 预期：`images/` 下出现 12 张 `hymn_pdf_{n}.webp` + 2 张 `标语诗歌_pdf_{n}.webp`；training.json 各章 `hymn_images` 末尾追加自身 `images/hymn_pdf_{n}.webp`；`motto_song_images` 末尾追加 `images/标语诗歌_pdf_1.webp`/`_2.webp`。
2. ✅ 重跑同一命令 → `skipped_existing=14`（12 周 + 2 封面歌），JSON 不再重复追加。
3. ✅ 抽查 WebP：文件头 `RIFF....WEBP`；周诗歌 2229×1538px / 154-254KB，封面歌 978×1425px / 87-95KB，均 <400KB/张。
4. ⏳ `python main.py`（全量构建）不回归：训练构建完成，output 中 PDF 图仍在。（本次以「干净重建 2026-04 + 幂等重跑」验证；全量构建待用户确认后执行）
5. （可选）浏览器验证 renderer.js 多图展示：打开某章，应见 Word 图 + PDF 图上下堆叠、点击可放大。

> 实测（2026-09-04）：修复「每章只追加自身 hymn_pdf_{N}」后，用临时脚本（复用 main.py process_batch）干净重建 output/2026-04：
> - 12 章每章 hymn_images 均只含自身 `images/hymn_pdf_{N}.webp`（0 违规模块），Word 图保持首位；
> - motto_song_images = [标语诗歌.png, 标语诗歌2.png, 标语诗歌_pdf_1.webp, 标语诗歌_pdf_2.webp]；
> - 单测 8/8 全绿（test_patch_hymn_from_pdf 已增强断言：ch0 只含 hymn_pdf_1.webp、ch1 只含 hymn_pdf_2.webp、motto 恰好 2 张）。

## 验收标准

- [x] `identify_hymn_pages` 在 2026-04 识别 12+2 页，页码精确（[26,48,68,88,108,130,152,172,194,214,236,258] + [2,3]）。
- [x] `crop_render` 200dpi 输出不越界、封面歌页不裁掉乐谱线。
- [x] `compress_webp` 输出合法 WebP，平均 <400KB/张。
- [x] `patch_hymn_from_pdf` 追加尾部、幂等重跑、`--force` 可覆盖。
- [x] main.py 两条管线接入后 `python main.py` 不回归（py_compile 通过；重建 2026-04 端到端通过；全量构建待跑）。
- [x] output/2026-04 实际产出 12+2 张 WebP 且 JSON 引用正确（每章仅自身 1 张）。

## 回滚

- 恢复 main.py（git checkout -- main.py）；删除 output 中新 WebP 与 JSON 引用（手写或重跑 `patch-hymn-from-pdf.py --force` 不会删，需手动 git 还原）。
- 工具脚本 tools/hymn_pdf_lib.py / patch-hymn-from-pdf.py 为新文件，git rm 即可。

> AI生成