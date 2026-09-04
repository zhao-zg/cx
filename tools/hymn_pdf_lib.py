# -*- coding: utf-8 -*-
"""晨兴中英对照 PDF 诗歌图识别/渲染/压缩纯逻辑库。

模块划分：
- identify_hymn_pages: 识别 12 周诗歌页 + 封面歌页（含续页）
- crop_render / compress_webp: 200dpi 渲染 + 联合 bbox 裁剪 + WebP 压缩
"""
import io

import fitz
from PIL import Image

HYMN_DRAW_MIN = 100
JOIN_PAD = 15.0


def identify_hymn_pages(pdf_path):
    """识别周诗歌页与封面歌页。

    返回 {'weeks': [{'page_index': int, 'number': int}, ...], 'motto': [int, ...]}
    - weeks: 绘图数 >= HYMN_DRAW_MIN 且文本含 HYMN/诗歌 的页，按发现顺序编号 1..12
    - motto: 含「封面歌」文本的页，其后紧邻的高绘图页作为续页纳入
    """
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
        # 封面歌（部分 PDF 提取文本为「标语歌」）
        if '封面歌' in text or '标语歌' in text:
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


def _union_bbox(page):
    """文本 bbox ∪ 绘图 bbox，外扩 JOIN_PAD，clip 到页面内。"""
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


def crop_bbox(page):
    """页面裁剪区域（供测试直接调用）。"""
    return _union_bbox(page)


def crop_render(pdf_path, page_index, dpi=200):
    """渲染指定页的联合 bbox 区域为 RGB 图像。"""
    doc = fitz.open(pdf_path)
    page = doc[page_index]
    bbox = _union_bbox(page)
    matrix = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=matrix, clip=bbox)
    img = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
    doc.close()
    return img


def compress_webp(img, quality=80):
    """压缩为 WebP 字节。"""
    import io
    buf = io.BytesIO()
    img.save(buf, 'WEBP', quality=quality, method=6)
    return buf.getvalue()