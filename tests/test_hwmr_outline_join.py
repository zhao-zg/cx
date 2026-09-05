# -*- coding: utf-8 -*-
"""TDD: outline_flat_nodes 撕裂点拼接修复失败测试（先红灯后绿灯）

2025-07 冷色审查 P0 三类缺陷（probe_p0_ctx 几何实锤）：
- 缺陷1: '…Lam. 3:55-' + '56) to bear…' → 误建 '56)' 假 L5 节点（x0=380<382 被
  判段首且匹配 EN_L5_RE）
- 缺陷2: '…—Exo. 25:31-' + '40; Zech…' → 兜底分支空格拼接撕开引用 '25:31- 40'
- 缺陷3: B. 末行 '19:10; cf. Gen. 1:26.'（x0=380, 非bold）与 II.（bold, top 交错）
  → 兜底分支拼进 nodes[-1]=II.（bold），应跳 bold 归 B.
- 全批次 A/B 签名: em-dash/引号/范围连字符行尾撕裂点被插入空格
  （'shepherding— saving' / '55- 56.'），CN 底座印证应无缝。
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'tools', 'hwmr'))
import parser as hwmr_parser  # noqa: E402


def flat(lines, is_en=True):
    return hwmr_parser.outline_flat_nodes(lines, is_en=is_en)


class TestTearJoin(unittest.TestCase):
    """撕裂点无缝拼接"""

    def test_defect1_fake_l5_node(self):
        # 缺陷1: 引用范围撕裂 + 闭括号开头行是续行，不得建 L5 假节点
        nodes = flat([
            (48.6, 367.0, 'B. To experience the golden lampstands as the testimony of Jesus, the', 'en'),
            (102.6, 380.0, 'Lord Jesus continually (1 Cor. 12:3, 13; Rom. 10:12-13; Lam. 3:55-', 'en'),
            (120.6, 380.0, '56) to bear the brands of Jesus (Gal. 6:17) as brothers and fellow', 'en'),
        ])
        self.assertEqual(len([n for n in nodes if n['level'] != '']), 1,
                         '闭括号开头续行不得新建节点')
        b = nodes[0]
        self.assertEqual(b['level'], 'B.')
        self.assertIn('Lam. 3:55-56) to bear', b['title'])
        self.assertNotIn('55- 56)', b['title'])

    def test_defect2_dash_range_join_fallback(self):
        # 缺陷2: 兜底分支（is_head 且 level=None）范围连字符无缝拼接
        nodes = flat([
            (473.3, 367.0, 'A. The golden lampstand symbolizes the Triune God; the Father as', 'en'),
            (527.3, 380.0, 'the churches, and the churches are the testimony of Jesus—Exo. 25:31-', 'en'),
            (545.3, 380.0, '40; Zech. 4:2-10; Rev. 1:10-12.', 'en'),
        ])
        a = nodes[0]
        self.assertIn('Exo. 25:31-40; Zech. 4:2-10', a['title'])
        self.assertNotIn('25:31- 40', a['title'])

    def test_defect2b_cont_line_range_join(self):
        # A 签名（not is_head 分支）：x0=389 续行范围连字符无缝拼接
        nodes = flat([
            (535.0, 377.0, '2. Because the Lamb supplies us with waters of life, the', 'en'),
            (553.0, 389.0, 'water of tears is wiped away—Jer. 9:1; 2:13; cf. 15:16; Lam. 3:21-25, 55-', 'en'),
            (571.0, 389.0, '56.', 'en'),
        ])
        self.assertIn('Lam. 3:21-25, 55-56.', nodes[0]['title'])
        self.assertNotIn('55- 56.', nodes[0]['title'])

    def test_defect3_fallback_skip_bold(self):
        # 缺陷3: 兜底分支非 bold 行跳过 bold 节点归最近非 bold 节点
        nodes = flat([
            (274.4, 367.0, 'B. Revelation presents to us the revealed Christ and the testifying church,', 'en'),
            (328.4, 380.0, 'expression of the Triune God—John 1:18; 5:31-37; 8:14; Rev. 1:2, 5, 9;', 'en'),
            (339.3, 360.0, 'II. The testimony of Jesus is the seven golden lampstands—', 'enB'),
            (346.4, 380.0, '19:10; cf. Gen. 1:26.', 'en'),
        ])
        levels = [n['level'] for n in nodes]
        self.assertEqual(levels, ['B.', 'II'])
        b, ii = nodes
        self.assertIn('Rev. 1:2, 5, 9; 19:10; cf. Gen. 1:26.', b['title'])
        self.assertNotIn('19:10', ii['title'])

    def test_bold_cont_emdash_join(self):
        # B 签名: bold 续行 em-dash 撕裂点无缝（'lampstands—' + 'golden (divine)…'）
        nodes = flat([
            (339.3, 360.0, 'II. The testimony of Jesus is the seven golden lampstands—', 'enB'),
            (359.3, 384.0, 'golden (divine) in nature, shining in darkness, and identical', 'enB'),
            (379.3, 384.0, 'with one another—Rev. 1:1-2, 9-12:', 'enB'),
        ])
        self.assertIn('lampstands—golden (divine)', nodes[0]['title'])
        self.assertNotIn('lampstands— golden', nodes[0]['title'])

    def test_emdash_lowercase_join(self):
        # B 签名: em-dash 行尾 + 小写开头无缝（p9 'shepherding—' + 'saving, restoring…'）
        nodes = flat([
            (108.3, 380.0, 'that we need more and more of the Lord\u2019s shining day by day in our', 'en'),
            (144.3, 380.0, 'daily life and church life for more and more of His shepherding—', 'en'),
            (162.3, 380.0, 'saving, restoring, reviving, and deifying—Rev. 1:14b-15a, 16b;', 'en'),
        ])
        # 首行无前导节点上下文时自建空 level 节点；断言最终 title 拼接
        title = nodes[-1]['title'] if len(nodes) == 1 else ' '.join(n['title'] for n in nodes)
        self.assertIn('shepherding—saving, restoring', title)
        self.assertNotIn('shepherding— saving', title)

    def test_quote_tail_join(self):
        # B 签名: 闭引号+em-dash 行尾 + 小写开头无缝（p29 'ever"—' + 'strong—2:1.'）
        # 探针定案：PDF 引号是 ASCII 直引号 0x22（全书 12 处，零 U+201D）；
        # 无缝由 em-dash 规则覆盖（title 以 — 结尾），非闭引号规则
        nodes = flat([
            (421.9, 360.0, 'II. "I became dead, and behold, I am living forever and ever"—', 'enB'),
            (429.1, 380.0, 'strong—2:1.', 'en'),
            (441.9, 384.0, '1:18a:', 'enB'),
        ])
        self.assertIn('ever"—strong—2:1.', nodes[0]['title'])
        self.assertNotIn('ever"— strong', nodes[0]['title'])


class TestRegression(unittest.TestCase):
    """既有行为回归保护"""

    def test_quote_then_word_keeps_space(self):
        # 闭引号后接新词是正常英语，须保留空格（'cloud" is'，2025-07 ch5 实测
        # 闭引号指纹误伤成 'cloud"is'——该指纹已删，此测试防复活）
        nodes = flat([
            (535.0, 377.0, '2. To be "on the cloud" is to come openly, whereas to be "clothed with a', 'en'),
            (553.0, 389.0, 'cloud" is to come secretly—Acts 1:9.', 'en'),
        ])
        title = nodes[0]['title']
        self.assertIn('cloud" is to come secretly', title)
        self.assertNotIn('cloud"is', title)

    def test_real_prefix_l5_survives(self):
        # 真 L5 前缀节点正常建出（前 title 不以 \d- 结尾）
        nodes = flat([
            (414.4, 377.0, 'a. That the name of Jesus is above every name is a spiritual fact which', 'en'),
            (474.1, 377.0, '1) If a seed dies by being buried in the soil, it will eventually sprout,', 'en'),
        ])
        levels = [n['level'] for n in nodes]
        self.assertIn('a.', levels)
        self.assertIn('1)', levels)

    def test_normal_space_join_kept(self):
        # 普通续行仍空格拼接（'9;' 尾 + '19:10' 头非撕裂点）
        nodes = flat([
            (274.4, 367.0, 'B. Revelation presents to us the revealed Christ,', 'en'),
            (328.4, 380.0, 'the church is the testimony of God—John 1:18; Rev. 1:2, 5, 9;', 'en'),
            (346.4, 380.0, '19:10; cf. Gen. 1:26.', 'en'),
        ])
        self.assertIn('9; 19:10;', nodes[0]['title'])

    def test_cn_cont_no_space_unchanged(self):
        # CN 续行无空格拼接行为不变
        nodes = flat([
            (113.9, 45.0, '壹基督是神忠信的见证人，是神的见证和彰', 'kai'),
            (133.9, 57.0, '显；祂把神彰显出来，那就是祂的见证——', 'kai'),
        ], is_en=False)
        self.assertEqual(len(nodes), 1)
        self.assertIn('彰显出来，那就是祂的见证——', nodes[0]['title'])
        self.assertNotIn(' \uff1b', nodes[0]['title'])


if __name__ == '__main__':
    unittest.main()
