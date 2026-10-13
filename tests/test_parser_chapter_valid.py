# -*- coding: utf-8 -*-
"""TDD: _expand_cn_scripture_refs 章号上限校验（先红灯后绿灯）

2026 夏训 2026-04 第 11 篇周 4 纲目，人名「拿八」（撒上 25 章亚比该的丈夫）
被误解析为经文引用 拿8:0（约拿书只有 4 章，该引用无效）。

修复原则：识别结果与收录数据核对后若未收录（无对应有效经文数据），
一律判定为识别错误——不识别、不包裹，按纯文本输出。

实现方案：66 卷书卷章数上限表（对齐 JS ref-detector.js 的 MAX_CHAPTERS +
chapterValid），每卷章数上限之外的引用一律拒绝：
- 4 处完全无上限校验的分支（Step0/1/1b/2）新增 _chapter_valid 守卫
- 5 处硬编码 ≤150 的分支（Step2.5/3/4/4.5/5.5）替换为 _chapter_valid
- 校验须在更新 current_book/current_chapter 之前，防无效引用污染上下文
- 未知书卷回退 1..150 兼容旧有行为

运行：python -X utf8 -m unittest tests.test_parser_chapter_valid -v
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.parser_improved import ImprovedParser  # noqa: E402


def expand(text, default_book='', default_chapter=0):
    return ImprovedParser._expand_cn_scripture_refs(text, default_book, default_chapter)


class TestChapterValidHelper(unittest.TestCase):
    """_chapter_valid classmethod 本身的行为"""

    def test_known_book_within_limit(self):
        # 约拿书 4 章：1~4 合法
        for c in (1, 2, 3, 4):
            self.assertTrue(ImprovedParser._chapter_valid('拿', c), f'拿{c} 应合法')

    def test_known_book_beyond_limit(self):
        # 约拿书只有 4 章：拿8 超限（缺陷本体）
        self.assertFalse(ImprovedParser._chapter_valid('拿', 8))
        self.assertFalse(ImprovedParser._chapter_valid('拿', 5))

    def test_chapter_zero_invalid(self):
        # 章号 0（缺章）不合法
        self.assertFalse(ImprovedParser._chapter_valid('创', 0))
        self.assertFalse(ImprovedParser._chapter_valid('', 0))

    def test_unknown_book_fallback_150(self):
        # 未知书卷回退 1..150（与 JS chapterValid 一致）
        self.assertTrue(ImprovedParser._chapter_valid('某书', 150))
        self.assertFalse(ImprovedParser._chapter_valid('某书', 151))
        self.assertFalse(ImprovedParser._chapter_valid('某书', 0))

    def test_boundary_books(self):
        # 边界卷：诗篇 150 章、创世记 50 章、启示录 22 章、犹大书 1 章
        self.assertTrue(ImprovedParser._chapter_valid('诗', 150))
        self.assertFalse(ImprovedParser._chapter_valid('诗', 151))
        self.assertTrue(ImprovedParser._chapter_valid('创', 50))
        self.assertFalse(ImprovedParser._chapter_valid('创', 51))
        self.assertTrue(ImprovedParser._chapter_valid('启', 22))
        self.assertFalse(ImprovedParser._chapter_valid('启', 23))
        self.assertTrue(ImprovedParser._chapter_valid('犹', 1))
        self.assertFalse(ImprovedParser._chapter_valid('犹', 2))


class TestDefectBody(unittest.TestCase):
    """缺陷本体与单章超限拒绝（Step1b 整章分支为主路径）"""

    def test_naba_person_name_not_ref(self):
        # 人名「拿八」不得再识别为 拿8:0
        self.assertEqual(expand('拿八'), [])

    def test_mixed_part_keeps_valid_ref(self):
        # 混合段：拿八 拒绝、创一 保留
        self.assertEqual(expand('拿八、创一'), ['创1:0'])

    def test_single_chapter_over_limit(self):
        # 单章超限：腓立比 4 章、启示录 22 章、犹大书 1 章
        self.assertEqual(expand('腓五'), [])
        self.assertEqual(expand('启二三'), [])
        self.assertEqual(expand('犹二'), [])

    def test_legal_boundary_kept(self):
        # 合法边界不误伤：拿4:0（约拿书最后一章）
        self.assertEqual(expand('约拿书四章'), ['拿4:0'])

    def test_naba_over_limit(self):
        # 约拿书 5 章：拿5:0 拒绝
        self.assertEqual(expand('拿五'), [])


class TestStep0Arabic(unittest.TestCase):
    """Step0 阿拉伯章:节格式新增上限校验"""

    def test_legal_range_kept(self):
        self.assertEqual(expand('创2:1~5'),
                         ['创2:1', '创2:2', '创2:3', '创2:4', '创2:5'])

    def test_over_limit_rejected(self):
        # 创世记只有 50 章：创51:1 拒绝
        self.assertEqual(expand('创51:1'), [])

    def test_over_limit_not_pollute_context(self):
        # 无效章引用不得更新 current_book/current_chapter：
        # 创51:1 拒绝后，后续「12」不得被解析为 创51:12
        self.assertEqual(expand('创51:1、12'), [])

    def test_range_end_over_limit_rejects_whole_group(self):
        # 章号 51 超限：整组（含节范围）拒绝（对齐 JS F4 端点超限语义）
        self.assertEqual(expand('创51:1~3'), [])

    def test_boundary_kept(self):
        # 合法边界：创50:1 保留
        self.assertEqual(expand('创50:1'), ['创50:1'])


class TestStep1FullRef(unittest.TestCase):
    """Step1 全称（书卷+中文章+阿拉伯节）新增上限校验"""

    def test_legal_kept(self):
        self.assertEqual(expand('腓四5~9'),
                         ['腓4:5', '腓4:6', '腓4:7', '腓4:8', '腓4:9'])

    def test_over_limit_rejected(self):
        # 腓立比 4 章：腓五章 12 节 → 拒绝
        self.assertEqual(expand('腓五12'), [])

    def test_over_limit_rejects_range_group(self):
        # 章号 5 > 腓立比 4 章：含节范围的整组拒绝
        self.assertEqual(expand('腓五12~15'), [])


class TestStep2FullChapJing(unittest.TestCase):
    """Step2 全称章节式（书卷+章[篇]+节范围）新增上限校验"""

    def test_legal_kept(self):
        self.assertEqual(expand('彼前三章十九节'), ['彼前3:19'])

    def test_over_limit_rejected(self):
        # 腓立比 4 章：腓立比书五章 12 节 → 拒绝
        self.assertEqual(expand('腓立比书五章十二节'), [])

    def test_whole_chapter_over_limit(self):
        # 无节号整章：腓立比书五章 → 拒绝
        self.assertEqual(expand('腓立比书五章'), [])


class TestStep25CrossChapVerse(unittest.TestCase):
    """Step2.5 跨章节范围：≤150 硬编码替换为 _chapter_valid（两端点均校验）"""

    def test_legal_kept(self):
        # 罗马书 16 章：跨章范围两端点均合法，保留产出（含中间章占位 4:0）
        self.assertEqual(expand('三21~五11', '罗'),
                         ['罗3:21', '罗4:0', '罗5:11'])

    def test_end_over_limit_rejects_whole_group(self):
        # 端点 31 > 腓立比 4 章：整组拒绝（不得部分产出）
        self.assertEqual(expand('二一21~三一11', '腓'), [])

    def test_psalms_boundary_kept(self):
        # 诗篇 150 章合法边界保留（回归旧 ≤150 行为）
        self.assertEqual(expand('百五十19', '诗'),
                         ['诗150:19'])


class TestStep3RelChap(unittest.TestCase):
    """Step3 相对章：>150 替换为 _chapter_valid"""

    def test_legal_kept(self):
        self.assertEqual(expand('创一19~21上', '腓') if False else expand('一19~21上', '腓'),
                         ['腓1:19', '腓1:20', '腓1:21上'])

    def test_over_limit_rejected(self):
        # 腓立比 4 章：五章 19 节 → 拒绝
        self.assertEqual(expand('五19', '腓'), [])

    def test_psalms_over_150_rejected(self):
        # 诗篇 151 章（旧 ≤150 上限下也拒绝，回归保持）
        self.assertEqual(expand('一五一19', '诗'), [])

    def test_psalms_150_kept(self):
        self.assertEqual(expand('百五十19', '诗'), ['诗150:19'])


class TestStep4RelChapJing(unittest.TestCase):
    """Step4 相对章节式：>150 替换为 _chapter_valid"""

    def test_legal_kept(self):
        # 第三章十九节（腓立比上下文）
        self.assertEqual(expand('三章十九节', '腓'), ['腓3:19'])

    def test_over_limit_rejected(self):
        # 腓立比 4 章：五章 12 节 → 拒绝
        self.assertEqual(expand('五章十二节', '腓'), [])

    def test_whole_chapter_over_limit(self):
        # 腓立比五章（无节）→ 拒绝
        self.assertEqual(expand('五章', '腓'), [])

    def test_whole_chapter_boundary_kept(self):
        # 腓立比四章（无节，无「章」字）→ 保留
        self.assertEqual(expand('四章', '腓'), ['腓4:0'])


class TestStep45RelChapRange(unittest.TestCase):
    """Step4.5 相对章范围：≤150 硬编码替换为 _chapter_valid（两端点均校验）"""

    def test_legal_kept(self):
        self.assertEqual(expand('二一～二二', '启'), ['启21:0', '启22:0'])

    def test_end_over_limit_rejects_whole_group(self):
        # 端点 23 > 启示录 22 章：整组拒绝
        self.assertEqual(expand('二一～二三', '启'), [])

    def test_start_over_limit_rejects(self):
        # 起点 31 > 腓立比 4 章：拒绝
        self.assertEqual(expand('三一～四〇', '腓'), [])


class TestStep55VerseToCrossChap(unittest.TestCase):
    """Step5.5 续章范围：≤150 硬编码替换为 _chapter_valid（端点校验）"""

    def test_legal_kept(self):
        self.assertEqual(expand('12~八13', '太', 5),
                         ['太5:12', '太6:0', '太7:0', '太8:13'])

    def test_end_over_limit_rejects_whole_group(self):
        # 端点 九13（9 > 太 28？否，太有 28 章 → 9 合法）改用腓立比：八13 > 4 章
        self.assertEqual(expand('2~八13', '腓', 1), [])


class TestDocstringRegressions(unittest.TestCase):
    """docstring 行为示例回归（不应受本次修复影响）"""

    def test_relative_with_book(self):
        self.assertEqual(expand('腓四5~9'),
                         ['腓4:5', '腓4:6', '腓4:7', '腓4:8', '腓4:9'])

    def test_relative_chap_verse(self):
        self.assertEqual(expand('一19~21上', '腓'),
                         ['腓1:19', '腓1:20', '腓1:21上'])

    def test_cont_verse(self):
        self.assertEqual(expand('11下~13', '腓', 4),
                         ['腓4:11下', '腓4:12', '腓4:13'])

    def test_chap_jing_style(self):
        self.assertEqual(expand('彼前三章十九节'), ['彼前3:19'])

    def test_full_book_name(self):
        self.assertEqual(expand('彼得前书三章十九节'), ['彼前3:19'])

    def test_psalms_abbreviation(self):
        self.assertEqual(expand('诗一三三'), ['诗133:0'])


if __name__ == '__main__':
    unittest.main()
