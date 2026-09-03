# -*- coding: utf-8 -*-
"""中英对照晨兴 PDF 下载支持的单测。

背景：Notion「中英对照（晨兴、纲目）」分区下的 HWMR 中英对照 PDF
（如「（0724）2026-JST-HWMR-en&chs.pdf」）此前被 collect_file 按扩展名
直接丢弃；本测试锁定新增的 '晨兴pdf' 类型收集与命名行为。
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import down_resource  # noqa: E402


def _file_block(filename: str) -> dict:
    """构造 Notion file block（与 collect_file 消费的结构一致）。"""
    return {'value': {'id': 'block-1', 'type': 'file',
                      'file_ids': ['file-1'],
                      'properties': {'title': [[filename]]}}}


class ClassifyHwmrPdfTests(unittest.TestCase):
    """is_hwmr_enchs_pdf：中英对照晨兴 PDF 识别规则。"""

    def test_real_hwmr_pdf(self):
        # dry-run 实测的真实文件名（全角括号 + & + chs）
        self.assertTrue(down_resource.is_hwmr_enchs_pdf('（0724）2026-JST-HWMR-en&chs.pdf'))

    def test_half_width_variant(self):
        self.assertTrue(down_resource.is_hwmr_enchs_pdf('(0725)2026-JST-HWMR-en&chs.pdf'))

    def test_lowercase_and_hyphen_variant(self):
        self.assertTrue(down_resource.is_hwmr_enchs_pdf('2026 summer hwmr-en-chs.pdf'))

    def test_os_outline_pdf_rejected(self):
        # 纲目（OS）PDF 不是晨兴圣言
        self.assertFalse(down_resource.is_hwmr_enchs_pdf('(0725)2026-JST-OS-en&chs.pdf'))

    def test_reading_notes_pdf_rejected(self):
        # 分区外的研读整理 PDF 不是晨兴圣言
        self.assertFalse(down_resource.is_hwmr_enchs_pdf('2026夏訓研讀整理.pdf'))

    def test_hwmr_without_chs_rejected(self):
        # 英文单语 HWMR 不算中英对照
        self.assertFalse(down_resource.is_hwmr_enchs_pdf('2026-JST-HWMR-en.pdf'))

    def test_non_pdf_rejected(self):
        self.assertFalse(down_resource.is_hwmr_enchs_pdf('晨兴.doc'))
        self.assertFalse(down_resource.is_hwmr_enchs_pdf('HWMR-en&chs.zip'))


class CollectHwmrPdfTests(unittest.TestCase):
    """collect_file：晨兴 PDF 收集进 '晨兴pdf' 类型。"""

    def setUp(self):
        self.documents = {'经文': [], '听抄': [], '晨兴': [], 'pdb': [], 'zip': [], 'epub': []}

    def test_collect_hwmr_pdf(self):
        down_resource.collect_file(_file_block('（0724）2026-JST-HWMR-en&chs.pdf'),
                                   self.documents, '晨兴')
        self.assertEqual(len(self.documents['晨兴pdf']), 1)
        self.assertEqual(self.documents['晨兴pdf'][0]['filename'],
                         '（0724）2026-JST-HWMR-en&chs.pdf')

    def test_collect_respects_section_context(self):
        # 只在晨兴分区上下文中收集，纲目分区不误收
        down_resource.collect_file(_file_block('（0724）2026-JST-HWMR-en&chs.pdf'),
                                   self.documents, '经文')
        self.assertEqual(self.documents.get('晨兴pdf', []), [])

    def test_plain_pdf_ignored(self):
        down_resource.collect_file(_file_block('2026夏訓研讀整理.pdf'),
                                   self.documents, '晨兴')
        self.assertNotIn('晨兴pdf', self.documents)
        for docs in self.documents.values():
            self.assertEqual(docs, [])


class HwmrPdfNamingTests(unittest.TestCase):
    """download_documents：晨兴 PDF 统一命名。"""

    def _doc(self):
        return {'file_id': 'file-1',
                'filename': '（0724）2026-JST-HWMR-en&chs.pdf',
                'title': '（0724）2026-JST-HWMR-en&chs.pdf',
                'block_id': 'block-1',
                'original_filename': '（0724）2026-JST-HWMR-en&chs.pdf'}

    def test_unified_name_single(self):
        docs = down_resource.download_documents(None, {'晨兴pdf': [self._doc()]}, '2026-04 夏季训练', 'tid', 'rid')
        self.assertEqual(len(docs), 1)
        self.assertEqual(docs[0]['filename'], '晨兴中英对照.pdf')
        self.assertEqual(docs[0]['doc_type'], '晨兴pdf')
        self.assertEqual(docs[0]['original_filename'], '（0724）2026-JST-HWMR-en&chs.pdf')

    def test_unified_name_multiple(self):
        docs = down_resource.download_documents(
            None, {'晨兴pdf': [self._doc(), dict(self._doc(), file_id='file-2')]}, 'f', 't', 'r')
        self.assertEqual([d['filename'] for d in docs], ['晨兴中英对照.pdf', '晨兴中英对照2.pdf'])


class FilterDocsByTypeTests(unittest.TestCase):
    """filter_docs_by_type：--only 类型过滤。"""

    @staticmethod
    def _docs():
        return [{'doc_type': '晨兴pdf', 'filename': '晨兴中英对照.pdf'},
                {'doc_type': '晨兴', 'filename': '晨兴.doc'},
                {'doc_type': 'epub', 'filename': '2026-4-JST.epub'}]

    def test_empty_means_no_filter(self):
        self.assertEqual(down_resource.filter_docs_by_type(self._docs(), []), self._docs())

    def test_only_hwmr_pdf(self):
        filtered = down_resource.filter_docs_by_type(self._docs(), ['晨兴pdf'])
        self.assertEqual(len(filtered), 1)
        self.assertEqual(filtered[0]['doc_type'], '晨兴pdf')

    def test_unknown_type_ignored(self):
        self.assertEqual(down_resource.filter_docs_by_type(self._docs(), ['pdf', '晨兴pdf']),
                         down_resource.filter_docs_by_type(self._docs(), ['晨兴pdf']))


if __name__ == '__main__':
    unittest.main(verbosity=2)
