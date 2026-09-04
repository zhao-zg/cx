# -*- coding: utf-8 -*-
"""TDD: patch_hymn_from_pdf CLI 幂等追加失败测试（先红灯后绿灯）"""
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


def make_fake_output(tmp):
    """在临时目录构造 fake output/（含 images/ 与 training.json）"""
    out = os.path.join(tmp, 'out')
    os.makedirs(os.path.join(out, 'images'), exist_ok=True)
    td = {
        'chapters': [
            {'number': 1, 'hymn_image': 'images/hymn_1_晨兴.png',
             'hymn_images': ['images/hymn_1_晨兴.png']},
            {'number': 2, 'hymn_image': 'images/hymn_2_晨兴.png',
             'hymn_images': ['images/hymn_2_晨兴.png']},
        ],
        'motto_song_image': 'images/标语诗歌.png',
        'motto_song_images': ['images/标语诗歌.png', 'images/标语诗歌2.png'],
    }
    with open(os.path.join(out, 'training.json'), 'w', encoding='utf-8') as f:
        json.dump(td, f, ensure_ascii=False, indent=2)
    return out


class TestPatch(unittest.TestCase):
    def setUp(self):
        if not os.path.exists(PDF_PATH):
            self.skipTest('源 PDF 不存在，跳过（需 resource/2026-04 夏季训练/晨兴中英对照.pdf）')

    def test_appends_pdf_images(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = make_fake_output(tmp)
            res = patch_hymn_from_pdf(out, PDF_DIR)
            self.assertGreater(res['images_written'], 0)
            with open(os.path.join(out, 'training.json'), encoding='utf-8') as f:
                td = json.load(f)
            # 第 N 章只追加自身 hymn_pdf_{N}.webp（核心 bug 修复断言）
            ch0 = td['chapters'][0]
            self.assertEqual(ch0['number'], 1)
            self.assertIn('images/hymn_pdf_1.webp', ch0['hymn_images'])
            self.assertNotIn('images/hymn_pdf_2.webp', ch0['hymn_images'])
            self.assertNotIn('images/hymn_pdf_12.webp', ch0['hymn_images'])
            ch1 = td['chapters'][1]
            self.assertEqual(ch1['number'], 2)
            self.assertIn('images/hymn_pdf_2.webp', ch1['hymn_images'])
            self.assertNotIn('images/hymn_pdf_1.webp', ch1['hymn_images'])
            # Word 图保持首位不动
            self.assertEqual(ch0['hymn_images'][0], 'images/hymn_1_晨兴.png')
            # 封面歌只追加 2 张，且位于已有 Word 图之后
            m = td['motto_song_images']
            self.assertEqual([x for x in m if '标语诗歌_pdf_' in x],
                             ['images/标语诗歌_pdf_1.webp', 'images/标语诗歌_pdf_2.webp'])
            self.assertEqual(m[:2], ['images/标语诗歌.png', 'images/标语诗歌2.png'])

    def test_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = make_fake_output(tmp)
            patch_hymn_from_pdf(out, PDF_DIR)
            with open(os.path.join(out, 'training.json'), encoding='utf-8') as f:
                r1 = json.load(f)
            res2 = patch_hymn_from_pdf(out, PDF_DIR)
            with open(os.path.join(out, 'training.json'), encoding='utf-8') as f:
                r2 = json.load(f)
            self.assertGreater(res2['skipped_existing'], 0)
            self.assertEqual(r1['chapters'][0]['hymn_images'], r2['chapters'][0]['hymn_images'])
            self.assertEqual(r1['motto_song_images'], r2['motto_song_images'])


if __name__ == '__main__':
    unittest.main()