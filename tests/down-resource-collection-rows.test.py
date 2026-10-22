# -*- coding: utf-8 -*-
"""collection_view 数据库行媒体资源收集的单测。

背景：2026-05 秋季训练的资源不挂在普通「资源」子页面下，而是承载在训练页
collection_view 数据库的 11 个行里（资源行 + 鸟瞰交通 + 第一~九篇）。
本测试锁定：
1. collect_file 行上下文（row_context=True）的各类型判定
2. process_collection_row / process_collection_rows 的 audio 全局去重
3. download_documents 新类型保持原名 + image 同名序号消歧
4. filter_docs_by_type 支持新类型
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import down_resource  # noqa: E402


def _file_block(filename: str, file_id: str = 'file-1') -> dict:
    """构造 Notion file block（与 collect_file 消费的结构一致）。"""
    return {'value': {'id': 'block-1', 'type': 'file',
                      'file_ids': [file_id],
                      'properties': {'title': [[filename]]}}}


def _media_block(block_type: str, file_id: str, filename: str) -> dict:
    """构造 audio/video/image/embed 块（process_collection_row 的 _walk_media 消费）。"""
    return {'value': {'id': 'block-media', 'type': block_type,
                     'properties': {'source': [[f'attachment:{file_id}:{filename}']]}}}


def _row_block(title: str, row_id: str = 'row-1') -> dict:
    """构造 collection 行 block。"""
    return {'value': {'id': row_id, 'type': 'page',
                      'properties': {'name': [[title]]}}}


class RowContextCollectFileTests(unittest.TestCase):
    """collect_file(row_context=True)：行上下文的类型判定。"""

    def setUp(self):
        self.documents = {'经文': [], '听抄': [], '晨兴': [], 'pdb': [], 'zip': [],
                          'epub': [], '晨兴pdf': [], 'ppt': [], 'pdf': [], 'video': [],
                          'audio': [], 'image': [], 'doc': []}

    def test_pptx_to_ppt(self):
        down_resource.collect_file(_file_block('纲目要点.pptx'), self.documents, '', row_context=True)
        self.assertEqual(len(self.documents['ppt']), 1)
        self.assertEqual(self.documents['ppt'][0]['filename'], '纲目要点.pptx')

    def test_plain_pdf_to_pdf(self):
        down_resource.collect_file(_file_block('（0510）2026-FTTA-OL.pdf'), self.documents, '', row_context=True)
        self.assertEqual(len(self.documents['pdf']), 1)
        self.assertEqual(self.documents['pdf'][0]['filename'], '（0510）2026-FTTA-OL.pdf')

    def test_hwmr_pdf_to_morning(self):
        # HWMR 中英对照 PDF 仍走既有晨兴pdf 通道
        down_resource.collect_file(_file_block('（0510）2026-秋季长老训练-HWMR-en&chs.pdf'),
                                   self.documents, '', row_context=True)
        self.assertEqual(len(self.documents['晨兴pdf']), 1)
        self.assertEqual(self.documents['pdf'], [])

    def test_mp4_to_video(self):
        down_resource.collect_file(_file_block('第一篇.mp4'), self.documents, '', row_context=True)
        self.assertEqual(len(self.documents['video']), 1)

    def test_mp3_to_audio(self):
        down_resource.collect_file(_file_block('晨兴喂养.mp3'), self.documents, '', row_context=True)
        self.assertEqual(len(self.documents['audio']), 1)

    def test_png_to_image(self):
        down_resource.collect_file(_file_block('image.png'), self.documents, '', row_context=True)
        self.assertEqual(len(self.documents['image']), 1)

    def test_docx_to_doc(self):
        down_resource.collect_file(_file_block('第一篇大纲.docx'), self.documents, '', row_context=True)
        self.assertEqual(len(self.documents['doc']), 1)

    def test_pdb_still_pdb_channel(self):
        down_resource.collect_file(_file_block('2026-05-F-ITERO.pdb'), self.documents, '', row_context=True)
        self.assertEqual(len(self.documents['pdb']), 1)

    def test_row_pdf_without_row_context_ignored(self):
        # 非 HWMR 普通行上下文（row_context=False）在非晨兴分区不收 PDF（既有行为）
        down_resource.collect_file(_file_block('（0510）2026-FTTA-OL.pdf'), self.documents, '经文')
        self.assertEqual(self.documents['pdf'], [])

    def test_new_type_without_row_context_ignored(self):
        # 新类型依赖行上下文门控：普通资源页（row_context=False）不收 mp4
        down_resource.collect_file(_file_block('第一篇.mp4'), self.documents, '经文')
        self.assertEqual(self.documents['video'], [])


class ProcessCollectionRowsTests(unittest.TestCase):
    """process_collection_rows：audio 按 file_id 全局去重。"""

    def test_audio_dedup_by_file_id(self):
        """纲目信息与听抄共享同一 mp3 文件时只保留首次出现。"""
        rows = [_row_block('第一篇'), _row_block('第一篇 听抄', row_id='row-2')]
        original = down_resource.load_page_blocks

        def fake_load(session, page_id):
            val = {'id': page_id, 'type': 'page',
                   'properties': {'name': [['第一篇'] if page_id == 'row-1' else ['第一篇 听抄']]}}
            if page_id in ('row-1', 'row-2'):
                val['content'] = [f'{page_id}-media']
            return {page_id: {'value': val},
                    f'{page_id}-media': {'value': {'id': f'{page_id}-media', 'type': 'audio',
                                                   'properties': {'source': [['attachment:shared-audio-id:第一篇.mp3']]}}}}
        down_resource.load_page_blocks = fake_load
        try:
            result = down_resource.process_collection_rows(None, rows)
        finally:
            down_resource.load_page_blocks = original
        self.assertEqual(len(result.get('audio', [])), 1,
                         '重复 audio 应按 file_id 全局去重只保留一次')

    def test_row_title_from_name_property(self):
        # get_row_title 读 name 属性（collection 行标题存放处）
        self.assertEqual(down_resource.get_row_title(_row_block('鸟瞰交通')), '鸟瞰交通')
        # 回退 title 属性
        fallback = {'value': {'id': 'r', 'type': 'page',
                              'properties': {'title': [['回退标题']]}}}
        self.assertEqual(down_resource.get_row_title(fallback), '回退标题')


class SubPageRecursionTests(unittest.TestCase):
    """_walk_media 子页递归下钻：行级 loadPageChunk 只返回行块+直接子块、
    不含 page 子块内部的孙辈块，遇 page 块必须 load_page_blocks(sub_id)
    下钻才能收集媒体。（2026-05 秋季训练：晨兴喂养/分类页的音频视频挂在
    page 子页内部）

    fake 语义与真实 API 对齐：load_page_blocks(X) 返回「X 的块 + X 的
    content 直接子块的块」，不含孙辈。
    """

    def _run(self, universe):
        """universe: {block_id: block} 全量块字典（含行块与所有子页块）。
        返回 (documents, load_page_blocks 调用 id 列表)。"""
        original = down_resource.load_page_blocks
        calls = []

        def fake_load(session, page_id):
            calls.append(page_id)
            result = {}
            page_block = universe.get(page_id)
            if not page_block:
                return result
            result[page_id] = page_block
            for child_id in page_block['value'].get('content') or []:
                if child_id in universe:
                    result[child_id] = universe[child_id]
            return result
        down_resource.load_page_blocks = fake_load
        try:
            documents = down_resource.process_collection_row(
                None, _row_block('第一篇'), set())
        finally:
            down_resource.load_page_blocks = original
        return documents, calls

    @staticmethod
    def _page(block_id, title, content, name_prop=False):
        """构造 page 块；collection 行标题用 name 属性，普通子页用 title。"""
        return {'value': {'id': block_id, 'type': 'page',
                          'properties': {('name' if name_prop else 'title'): [[title]]},
                          'content': content}}

    @staticmethod
    def _media(block_id, block_type, file_id, filename):
        return {'value': {'id': block_id, 'type': block_type,
                          'properties': {'source': [[f'attachment:{file_id}:{filename}']]}}}

    def test_media_inside_page_subpage_collected(self):
        """page 子块 content 在行级 chunk 中存在，但其内部媒体块不在：
        必须下钻 load_page_blocks 才能收集（修复前静默漏收）。"""
        universe = {
            'row-1': self._page('row-1', '第一篇', ['cat-1'], name_prop=True),
            'cat-1': self._page('cat-1', '晨兴喂养', ['week-1']),
            'week-1': self._page('week-1', '第一周•周一', ['audio-1']),
            'audio-1': self._media('audio-1', 'audio', 'a1', 'week1day1.mp3'),
        }
        documents, calls = self._run(universe)
        self.assertEqual(calls, ['row-1', 'cat-1', 'week-1'],
                         '行级->分类子页->周子页逐层下钻')
        self.assertEqual(len(documents.get('audio', [])), 1)
        self.assertEqual(documents['audio'][0]['filename'], 'week1day1.mp3')

    def test_nested_subpages_two_levels(self):
        """分类页 -> 周子页 -> 媒体：两层 page 下钻后仍能收集。"""
        universe = {
            'row-1': self._page('row-1', '第一篇', ['cat-1'], name_prop=True),
            'cat-1': self._page('cat-1', '晨兴喂养', ['week-1']),
            'week-1': self._page('week-1', '第一周•周一', ['audio-1']),
            'audio-1': self._media('audio-1', 'audio', 'a1', '晨兴.mp3'),
        }
        documents, _ = self._run(universe)
        self.assertEqual(len(documents.get('audio', [])), 1)

    def test_media_directly_in_row_chunk_still_works(self):
        """回归保护：行级 chunk 内直接可见的媒体（鸟瞰交通行模式）不受影响。"""
        universe = {
            'row-1': self._page('row-1', '鸟瞰交通', ['vid-1', 'pdf-1'], name_prop=True),
            'vid-1': self._media('vid-1', 'video', 'v1', '鸟瞰交通.mp4'),
            'pdf-1': self._media('pdf-1', 'embed', 'p1', '（0510）OL.pdf'),
        }
        documents, _ = self._run(universe)
        self.assertEqual(len(documents.get('video', [])), 1)
        # embed -> pdf 类型（既定映射）
        self.assertEqual(len(documents.get('pdf', [])), 1)

    def test_video_and_image_inside_subpage(self):
        """子页内的 video/image 块同样通过下钻收集。"""
        universe = {
            'row-1': self._page('row-1', '第一篇', ['cat-1'], name_prop=True),
            'cat-1': self._page('cat-1', '晨光同行', ['vid-1', 'img-1']),
            'vid-1': self._media('vid-1', 'video', 'v1', '晨光同行.mp4'),
            'img-1': self._media('img-1', 'image', 'i1', 'image.png'),
        }
        documents, _ = self._run(universe)
        self.assertEqual(len(documents.get('video', [])), 1)
        self.assertEqual(len(documents.get('image', [])), 1)

    def test_file_block_inside_subpage(self):
        """子页内的 file 块（docx/pdf）走 collect_file(row_context=True)。"""
        universe = {
            'row-1': self._page('row-1', '第一篇', ['cat-1'], name_prop=True),
            'cat-1': self._page('cat-1', '职事文摘', ['f-1']),
            'f-1': {'value': {'id': 'f-1', 'type': 'file',
                              'file_ids': ['d1'],
                              'properties': {'title': [['第一篇.docx']]}}},
        }
        documents, _ = self._run(universe)
        self.assertEqual(len(documents.get('doc', [])), 1)
        self.assertEqual(documents['doc'][0]['filename'], '第一篇.docx')

    def test_external_link_media_skipped_in_subpage(self):
        """子页内外链（非 attachment）媒体保持跳过。"""
        universe = {
            'row-1': self._page('row-1', '第一篇', ['cat-1'], name_prop=True),
            'cat-1': self._page('cat-1', '真理应用', ['emb-1']),
            'emb-1': {'value': {'id': 'emb-1', 'type': 'embed',
                                'properties': {'source': [['https://example.com/x.pptx']]}}},
        }
        documents, _ = self._run(universe)
        self.assertEqual(documents, {})

    def test_missing_grandchild_blocks_are_drilled(self):
        """孙辈块完全不在行级 chunk（真实 API 行为）：下钻后能拿到。"""
        # 行级 chunk 语义下，load_page_blocks('row-1') 只含 row-1 + cat-1，
        # week-1/audio-1 只能通过 load_page_blocks('cat-1')/'week-1' 获得——
        # 本用例的 universe 构造即模拟这一事实（fake 每次只给直接子块）。
        universe = {
            'row-1': self._page('row-1', '第一篇', ['cat-1'], name_prop=True),
            'cat-1': self._page('cat-1', '纲目要点', ['vid-1']),
            'vid-1': self._media('vid-1', 'video', 'v1', '2026秋訓綱目要點第一篇.mp4'),
        }
        documents, calls = self._run(universe)
        self.assertIn('cat-1', calls)
        self.assertEqual(len(documents.get('video', [])), 1)

    def test_subpage_media_dedup_across_rows(self):
        """跨行 audio 去重在下钻收集的媒体上同样生效。"""
        universe = {
            'row-1': self._page('row-1', '第一篇', ['cat-1'], name_prop=True),
            'row-2': self._page('row-2', '第一篇 听抄', ['cat-2'], name_prop=True),
            'cat-1': self._page('cat-1', '纲目信息', ['audio-1']),
            'cat-2': self._page('cat-2', '听抄信息', ['audio-2']),
            'audio-1': self._media('audio-1', 'audio', 'shared', 'msg.mp3'),
            'audio-2': self._media('audio-2', 'audio', 'shared', 'msg.mp3'),
        }
        original = down_resource.load_page_blocks

        def fake_load(session, page_id):
            result = {page_id: universe[page_id]}
            for child_id in universe[page_id]['value'].get('content') or []:
                result[child_id] = universe[child_id]
            return result
        down_resource.load_page_blocks = fake_load
        try:
            seen = set()
            docs1 = down_resource.process_collection_row(None, _row_block('第一篇'), seen)
            docs2 = down_resource.process_collection_row(
                None, _row_block('第一篇 听抄', row_id='row-2'), seen)
        finally:
            down_resource.load_page_blocks = original
        self.assertEqual(len(docs1.get('audio', [])), 1)
        self.assertEqual(docs2.get('audio', []), [], '第二个行重复 audio 应去重为空')


class DownloadDocumentsNamingTests(unittest.TestCase):
    """download_documents：新类型保持原名 + image 同名消歧。"""

    def test_new_types_keep_original_names(self):
        docs = down_resource.download_documents(None, {
            'ppt': [{'file_id': 'f1', 'filename': '纲目要点.pptx', 'title': '纲目要点.pptx',
                     'block_id': 'b1', 'original_filename': '纲目要点.pptx'}],
            'video': [{'file_id': 'f2', 'filename': '鸟瞰交通.mp4', 'title': '鸟瞰交通.mp4',
                       'block_id': 'b2', 'original_filename': '鸟瞰交通.mp4'}],
            'audio': [{'file_id': 'f3', 'filename': '晨兴喂养.mp3', 'title': '晨兴喂养.mp3',
                       'block_id': 'b3', 'original_filename': '晨兴喂养.mp3'}],
            'doc': [{'file_id': 'f4', 'filename': '第一篇大纲.docx', 'title': '第一篇大纲.docx',
                     'block_id': 'b4', 'original_filename': '第一篇大纲.docx'}],
        }, '2026-05 秋季训练', 't', 'r')
        by_fid = {d['file_id']: d['filename'] for d in docs}
        self.assertEqual(by_fid['f1'], '纲目要点.pptx')
        self.assertEqual(by_fid['f2'], '鸟瞰交通.mp4')
        self.assertEqual(by_fid['f3'], '晨兴喂养.mp3')
        self.assertEqual(by_fid['f4'], '第一篇大纲.docx')

    def test_image_same_name_disambiguated(self):
        imgs = [{'file_id': f'img{i}', 'filename': 'image.png', 'title': 'image.png',
                 'block_id': f'b{i}', 'original_filename': 'image.png'} for i in range(3)]
        docs = down_resource.download_documents(None, {'image': imgs}, 'f', 't', 'r')
        names = sorted(d['filename'] for d in docs)
        self.assertEqual(names, ['image.png', 'image2.png', 'image3.png'])

    def test_image_unique_name_untouched(self):
        docs = down_resource.download_documents(None, {
            'image': [{'file_id': 'i1', 'filename': 'banner.png', 'title': 'banner.png',
                       'block_id': 'b1', 'original_filename': 'banner.png'}],
        }, 'f', 't', 'r')
        self.assertEqual(docs[0]['filename'], 'banner.png')


class FilterDocsByTypeNewTypesTests(unittest.TestCase):
    """filter_docs_by_type：新类型纳入 --only 支持。"""

    @staticmethod
    def _docs():
        return [{'doc_type': 'audio', 'filename': 'a.mp3'},
                {'doc_type': 'video', 'filename': 'v.mp4'},
                {'doc_type': 'pdf', 'filename': 'p.pdf'},
                {'doc_type': 'ppt', 'filename': 's.pptx'},
                {'doc_type': 'image', 'filename': 'i.png'},
                {'doc_type': 'doc', 'filename': 'd.docx'}]

    def test_only_video(self):
        filtered = down_resource.filter_docs_by_type(self._docs(), ['video'])
        self.assertEqual(len(filtered), 1)
        self.assertEqual(filtered[0]['doc_type'], 'video')

    def test_only_audio_pdf(self):
        filtered = down_resource.filter_docs_by_type(self._docs(), ['audio', 'pdf'])
        self.assertEqual(len(filtered), 2)
        self.assertEqual({d['doc_type'] for d in filtered}, {'audio', 'pdf'})

    def test_all_new_types_are_known(self):
        # 新类型不再落入 unknown 被忽略
        self.assertEqual(down_resource.filter_docs_by_type(self._docs(), list(down_resource.MEDIA_DOC_TYPES)),
                         self._docs())

    def test_truly_unknown_still_ignored(self):
        self.assertEqual(down_resource.filter_docs_by_type(self._docs(), ['mp3', 'audio']),
                         down_resource.filter_docs_by_type(self._docs(), ['audio']))


if __name__ == '__main__':
    unittest.main(verbosity=2)
