# -*- coding: utf-8 -*-
"""TDD: patch_hymn_from_pdf Word 图优先跳过逻辑（APK 瘦身）。

策略变更（2026-09-04）：
- training.json 中该章已有非 WebP（Word/EPUB 来源）诗歌图 → 不渲染、不追加 PDF 高清图
- 仅对无 Word 图的章（hymn_images 为空数组/缺失）补 PDF 图；封面歌同理
- 无 training.json 时（独立 CLI 场景）保持旧行为：全量渲染
"""
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.patch_hymn_from_pdf import patch_hymn_from_pdf

PDF_DIR = r'resource/2026-04 夏季训练'
PDF_PATH = os.path.join(PDF_DIR, '晨兴中英对照.pdf')


def make_fake_output(tmp, ch1_word=True, ch2_word=True, motto_word=True):
    """在临时目录构造 fake output/。

    ch1_word/ch2_word: 章节是否带 Word（PNG）诗歌图；False 时 hymn_images 为空数组
    motto_word: 封面歌是否带 Word 图；False 时 motto_song_images 为空数组
    """
    out = os.path.join(tmp, 'out')
    os.makedirs(os.path.join(out, 'images'), exist_ok=True)
    td = {
        'chapters': [
            {'number': 1,
             'hymn_images': ['images/hymn_1_晨兴.png'] if ch1_word else []},
            {'number': 2,
             'hymn_images': ['images/hymn_2_晨兴.png'] if ch2_word else []},
        ],
        'motto_song_images': (
            ['images/标语诗歌.png', 'images/标语诗歌2.png'] if motto_word else []),
    }
    with open(os.path.join(out, 'training.json'), 'w', encoding='utf-8') as f:
        json.dump(td, f, ensure_ascii=False, indent=2)
    return out


def list_webp(out):
    d = os.path.join(out, 'images')
    return sorted(f for f in os.listdir(d) if f.endswith('.webp'))


class TestWordFirst(unittest.TestCase):
    def setUp(self):
        if not os.path.exists(PDF_PATH):
            self.skipTest('源 PDF 不存在，跳过（需 resource/2026-04 夏季训练/晨兴中英对照.pdf）')

    def test_word_image_blocks_pdf(self):
        """两章和封面歌都有 Word 图 → 完全不渲染不追加（APK 瘦身核心场景）"""
        with tempfile.TemporaryDirectory() as tmp:
            out = make_fake_output(tmp)
            with open(os.path.join(out, 'training.json'), encoding='utf-8') as f:
                before = json.load(f)
            res = patch_hymn_from_pdf(out, PDF_DIR)
            self.assertEqual(res['images_written'], 0)
            self.assertGreater(res['skipped_word'], 0)
            # 磁盘上没有任何 WebP 落盘
            self.assertEqual(list_webp(out), [])
            # JSON 完全未变（无 hymn_pdf / 标语诗歌_pdf 引用）
            with open(os.path.join(out, 'training.json'), encoding='utf-8') as f:
                after = json.load(f)
            self.assertEqual(before, after)

    def test_appends_when_no_word(self):
        """无 Word 图 → 为 JSON 中存在的章渲染追加（2 周 + 2 封面歌 = 4 张）；
        PDF 识别出但 JSON 无对应章号的号段（3~12）不渲染，不产生 orphan 文件"""
        with tempfile.TemporaryDirectory() as tmp:
            out = make_fake_output(tmp, ch1_word=False, ch2_word=False, motto_word=False)
            res = patch_hymn_from_pdf(out, PDF_DIR)
            self.assertEqual(res['images_written'], 4)
            self.assertEqual(res['patched_chapters'], 2)
            self.assertTrue(res['motto_appended'])
            self.assertEqual(res['skipped_no_chapter'], 10)  # 3~12 号无对应章
            webp = list_webp(out)
            self.assertEqual(sorted(webp),
                             ['hymn_pdf_1.webp', 'hymn_pdf_2.webp',
                              '标语诗歌_pdf_1.webp', '标语诗歌_pdf_2.webp'])
            with open(os.path.join(out, 'training.json'), encoding='utf-8') as f:
                td = json.load(f)
            # 第 N 章只追加自身 hymn_pdf_{N}.webp
            self.assertEqual(td['chapters'][0]['hymn_images'], ['images/hymn_pdf_1.webp'])
            self.assertEqual(td['chapters'][1]['hymn_images'], ['images/hymn_pdf_2.webp'])
            self.assertEqual(td['motto_song_images'],
                             ['images/标语诗歌_pdf_1.webp', 'images/标语诗歌_pdf_2.webp'])

    def test_mixed_partial(self):
        """ch1 有 Word 图、ch2 无 → 只为 ch2 渲染追加；封面歌有 Word 图 → 跳过"""
        with tempfile.TemporaryDirectory() as tmp:
            out = make_fake_output(tmp, ch1_word=True, ch2_word=False, motto_word=True)
            res = patch_hymn_from_pdf(out, PDF_DIR)
            self.assertEqual(res['images_written'], 1)
            self.assertGreater(res['skipped_word'], 0)
            self.assertEqual(res['skipped_no_chapter'], 10)
            self.assertEqual(list_webp(out), ['hymn_pdf_2.webp'])
            with open(os.path.join(out, 'training.json'), encoding='utf-8') as f:
                td = json.load(f)
            self.assertEqual(td['chapters'][0]['hymn_images'], ['images/hymn_1_晨兴.png'])
            self.assertEqual(td['chapters'][1]['hymn_images'], ['images/hymn_pdf_2.webp'])
            self.assertEqual(td['motto_song_images'],
                             ['images/标语诗歌.png', 'images/标语诗歌2.png'])

    def test_idempotent_no_word(self):
        """无 Word 图场景：重跑幂等（文件已存在跳过、JSON 不重复追加）"""
        with tempfile.TemporaryDirectory() as tmp:
            out = make_fake_output(tmp, ch1_word=False, ch2_word=False, motto_word=False)
            patch_hymn_from_pdf(out, PDF_DIR)
            with open(os.path.join(out, 'training.json'), encoding='utf-8') as f:
                r1 = json.load(f)
            res2 = patch_hymn_from_pdf(out, PDF_DIR)
            with open(os.path.join(out, 'training.json'), encoding='utf-8') as f:
                r2 = json.load(f)
            self.assertGreater(res2['skipped_existing'], 0)
            self.assertEqual(res2['images_written'], 0)
            self.assertEqual(r1, r2)


if __name__ == '__main__':
    unittest.main()
