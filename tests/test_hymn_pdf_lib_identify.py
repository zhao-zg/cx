# -*- coding: utf-8 -*-
"""TDD: identify_hymn_pages 识别模块失败测试（先红灯后绿灯）"""
import os
import sys
import unittest

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
        self.assertEqual(len(res['motto']), 2)  # 0-based 第 2、3 页（PDF 第 3、4 页）
        self.assertEqual(res['motto'], [2, 3])

    def test_week_page_indices(self):
        # 0-based 页码（PDF 页码 = 索引 + 1）；实测为 26, 48, 68, ...
        res = identify_hymn_pages(PDF)
        self.assertEqual([w['page_index'] for w in res['weeks']],
                         [26, 48, 68, 88, 108, 130, 152, 172, 194, 214, 236, 258])


if __name__ == '__main__':
    unittest.main()