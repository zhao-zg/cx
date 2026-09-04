# -*- coding: utf-8 -*-
"""TDD: crop_render / compress_webp 渲染裁剪压缩失败测试（先红灯后绿灯）"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.hymn_pdf_lib import crop_render, compress_webp

PDF = r'resource/2026-04 夏季训练/晨兴中英对照.pdf'


class TestRender(unittest.TestCase):
    def test_crop_render_returns_rgb_image(self):
        # 周诗歌页（0-based 26）
        img = crop_render(PDF, 26, dpi=200)
        self.assertEqual(img.mode, 'RGB')
        self.assertGreater(img.width, 1000)
        self.assertGreater(img.height, 500)

    def test_crop_render_motto_page4_keeps_top(self):
        # 封面歌续页（0-based 3）上方有乐谱线，联合 bbox 外扩 15pt 后不裁掉
        img = crop_render(PDF, 3, dpi=200)
        # 高度应接近满页（不裁剪到只剩中间）
        self.assertGreater(img.height, 1000)

    def test_compress_webp(self):
        img = crop_render(PDF, 26, dpi=200)
        data = compress_webp(img, quality=80)
        self.assertEqual(data[:4], b'RIFF')
        self.assertEqual(data[8:12], b'WEBP')
        self.assertLess(len(data), 400 * 1024)  # 166KB 平均，留裕量


if __name__ == '__main__':
    unittest.main()