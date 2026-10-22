# -*- coding: utf-8 -*-
"""--only-row 行级过滤的单测（TDD：先失败后实现）。

背景：用户只需下载 2026-05 collection_view 数据库中标题含「资源」的行
（12 个打包文件），暂不下载 143 个媒体文件（31 视频/59 音频等）。
--only 类型过滤不够用（pdf 类型横跨多行），需要行级过滤。

本测试锁定：
1. filter_rows_by_title：按标题子串过滤 collection 行
2. download_notion_documents(only_row=...)：
   - collection 结构训练：只处理标题匹配的行（其余行不扫描不下钻）
   - 普通资源页结构的老训练：整体跳过（不进 download_documents）
   - only_row 激活时跳过标语诗歌图片（motto）
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import down_resource  # noqa: E402


def _row_block(title: str, row_id: str = 'row-1') -> dict:
    """构造 collection 行 block（properties.name 存标题）。"""
    return {'value': {'id': row_id, 'type': 'page',
                      'properties': {'name': [[title]]}}}


def _file_block(filename: str, file_id: str, block_id: str) -> dict:
    """构造 Notion file block。"""
    return {'value': {'id': block_id, 'type': 'file',
                      'file_ids': [file_id],
                      'properties': {'title': [[filename]]}}}


def _page_block(page_id: str, title: str, content=None, name_prop=False) -> dict:
    """构造普通 page 块（title 属性；collection 行用 name）。"""
    return {'value': {'id': page_id, 'type': 'page',
                      'properties': {('name' if name_prop else 'title'): [[title]]},
                      'content': content or []}}


class FilterRowsByTitleTests(unittest.TestCase):
    """filter_rows_by_title：按标题子串过滤 collection 行。"""

    def test_keeps_matching_rows_only(self):
        rows = [_row_block('资源'), _row_block('鸟瞰交通', 'row-2'),
                _row_block('第一篇', 'row-3')]
        kept = down_resource.filter_rows_by_title(rows, '资源')
        self.assertEqual(len(kept), 1)
        self.assertEqual(kept[0]['value']['id'], 'row-1')

    def test_no_keyword_returns_all(self):
        rows = [_row_block('资源'), _row_block('第一篇', 'row-2')]
        # 空 keyword（未启用过滤）应原样返回
        self.assertEqual(down_resource.filter_rows_by_title(rows, None), rows)
        self.assertEqual(down_resource.filter_rows_by_title(rows, ''), rows)

    def test_no_match_returns_empty(self):
        rows = [_row_block('鸟瞰交通'), _row_block('第一篇', 'row-2')]
        self.assertEqual(down_resource.filter_rows_by_title(rows, '资源'), [])

    def test_empty_rows(self):
        self.assertEqual(down_resource.filter_rows_by_title([], '资源'), [])


class DownloadNotionOnlyRowTests(unittest.TestCase):
    """download_notion_documents(only_row=...)：集成 mock 测试。

    mock 链路：create_session / find_year_links / find_training_links_in_year
    / find_resource_pages / find_collection_view / query_collection_rows
    / load_page_blocks / download_documents（记录调用，不真下载）。
    """

    def _install_mocks(self, *, resource_pages, cv, rows, universe,
                       download_calls, motto_calls=None):
        """安装全部 mock，返回恢复函数。

        universe: {block_id: block} 全量块字典（load_page_blocks fake 按真实
        API 语义返回「页面块 + content 直接子块」）。
        download_calls: 记录 download_documents 的 aggregated 参数。
        """
        saved = {
            'create_session': down_resource.create_session,
            'find_year_links': down_resource.find_year_links,
            'find_training_links_in_year': down_resource.find_training_links_in_year,
            'find_motto_pages': down_resource.find_motto_pages,
            'find_resource_pages': down_resource.find_resource_pages,
            'find_collection_view': down_resource.find_collection_view,
            'query_collection_rows': down_resource.query_collection_rows,
            'load_page_blocks': down_resource.load_page_blocks,
            'download_documents': down_resource.download_documents,
        }
        down_resource.create_session = lambda: None
        down_resource.find_year_links = lambda session, page_id: [
            {'id': 'year-2026', 'title': '2026年'}]
        down_resource.find_training_links_in_year = (
            lambda session, year, include_all=False: [
                {'id': 'training-1', 'title': '2026-05 秋季长老训练'}])
        down_resource.find_motto_pages = lambda session, training: (
            motto_calls.append(training['id']) or None if motto_calls is not None
            else None)
        down_resource.find_resource_pages = lambda session, training: resource_pages
        down_resource.find_collection_view = lambda session, page_id: cv
        down_resource.query_collection_rows = (
            lambda session, collection_id, cv_block_id, space_id: rows)

        def fake_load_page_blocks(session, page_id):
            page_block = universe.get(page_id)
            if not page_block:
                return {}
            result = {page_id: page_block}
            for child_id in page_block['value'].get('content') or []:
                if child_id in universe:
                    result[child_id] = universe[child_id]
            return result
        down_resource.load_page_blocks = fake_load_page_blocks

        def fake_download_documents(session, documents, folder_name,
                                    training_id, resource_id):
            download_calls.append({'documents': documents,
                                   'resource_id': resource_id})
            # 模拟真实行为：返回平铺的 doc 列表
            flat = []
            for doc_type, doc_list in documents.items():
                for doc in doc_list:
                    flat.append({'file_id': doc['file_id'],
                                 'filename': doc['filename'],
                                 'folder': folder_name,
                                 'doc_type': doc_type})
            return flat
        down_resource.download_documents = fake_download_documents

        def restore():
            for name, fn in saved.items():
                setattr(down_resource, name, fn)
        return restore

    def test_only_row_filters_collection_rows(self):
        """collection 结构训练：only_row='资源' 时只处理资源行，
        其余行（鸟瞰交通/第一篇）完全不扫描不下钻。"""
        # 训练页：无普通「资源」子页面，有 collection_view 块
        training_page = {'value': {'id': 'training-1', 'type': 'page',
                                   'title': [['2026-05 秋季长老训练']],
                                   'content': ['cv-block'],
                                   'space_id': 'space-1'}}
        cv_block = {'value': {'id': 'cv-block', 'type': 'collection_view',
                              'collection_id': 'coll-1'}}
        # 资源行直接子块 = 12 个打包文件（此处 mock 2 个代表）
        res_row = {'value': {'id': 'row-res', 'type': 'page',
                             'properties': {'name': [['资源']]},
                             'content': ['f-zip', 'f-pdb']}}
        # 媒体行：内部有大量子页/媒体（若被扫描会触发下钻 load_page_blocks）
        media_row = {'value': {'id': 'row-media', 'type': 'page',
                               'properties': {'name': [['第一篇']]},
                               'content': ['cat-page']}}
        cat_page = {'value': {'id': 'cat-page', 'type': 'page',
                              'title': [['晨兴喂养']],
                              'content': ['audio-block']}}
        audio_block = {'value': {'id': 'audio-block', 'type': 'audio',
                                 'properties': {'source':
                                                [['attachment:aid:晨兴.mp3']]}}}
        universe = {
            'training-1': training_page, 'cv-block': cv_block,
            'row-res': res_row, 'row-media': media_row,
            'cat-page': cat_page, 'audio-block': audio_block,
            'f-zip': _file_block('纲目.zip', 'fid-zip', 'f-zip'),
            'f-pdb': _file_block('2026-5-F-ITERO.pdb.zip', 'fid-pdb', 'f-pdb'),
        }
        rows = [res_row, media_row]
        download_calls = []
        motto_calls = []
        restore = self._install_mocks(
            resource_pages=[],  # 无普通资源页 -> 走 collection 兜底
            cv={'id': 'cv-block', 'collection_id': 'coll-1', 'space_id': 'space-1'},
            rows=rows, universe=universe,
            download_calls=download_calls, motto_calls=motto_calls)
        # 页面 ID 须为 32 位连续 hex（extract_page_id 对连字符 URL 会取最后一段）
        URL = 'https://mygoodland.notion.site/11111111222233334444555555555555'
        try:
            docs = down_resource.download_notion_documents(URL, only_row='资源')
        finally:
            restore()
        # 只处理资源行：pdb + zip 各 1
        self.assertEqual(len(download_calls), 1)
        aggregated = download_calls[0]['documents']
        # resource_id 必须是资源行的行 id（Playwright 用它在页面上找文件卡片），
        # 而非训练页 id——传训练页 id 会导致全部 404（回归锁定）
        self.assertEqual(download_calls[0]['resource_id'], 'row-res')
        self.assertEqual([d['filename'] for d in aggregated.get('pdb', [])],
                         ['2026-5-F-ITERO.pdb.zip'])
        self.assertEqual([d['filename'] for d in aggregated.get('zip', [])],
                         ['纲目.zip'])
        # 媒体行未被收集
        self.assertNotIn('audio', aggregated)
        # only_row 激活时跳过标语诗歌图片
        self.assertEqual(motto_calls, [])
        # 返回平铺清单
        self.assertEqual(len(docs), 2)

    def test_only_row_skips_legacy_resource_page_trainings(self):
        """普通资源页结构的老训练：only_row 激活时整体跳过，
        不进 download_documents（避免走 MD5 慢路径）。"""
        # 老结构训练：有普通「资源」子页面
        training_page = {'value': {'id': 'training-1', 'type': 'page',
                                   'title': [['2026-07 夏季训练']],
                                   'content': ['res-page']}}
        res_page = _page_block('res-page', '资源')
        universe = {'training-1': training_page, 'res-page': res_page}
        download_calls = []
        restore = self._install_mocks(
            resource_pages=[{'id': 'res-page', 'title': '资源'}],
            cv=None, rows=[], universe=universe,
            download_calls=download_calls)
        URL = 'https://mygoodland.notion.site/11111111222233334444555555555555'
        try:
            docs = down_resource.download_notion_documents(URL, only_row='资源')
        finally:
            restore()
        self.assertEqual(download_calls, [], '老结构训练应整体跳过')
        self.assertEqual(docs, [])

    def test_without_only_row_processes_all_rows(self):
        """回归保护：不传 only_row 时行为不变（全部行处理）。"""
        training_page = {'value': {'id': 'training-1', 'type': 'page',
                                   'title': [['2026-05 秋季长老训练']],
                                   'content': ['cv-block'],
                                   'space_id': 'space-1'}}
        cv_block = {'value': {'id': 'cv-block', 'type': 'collection_view',
                              'collection_id': 'coll-1'}}
        res_row = {'value': {'id': 'row-res', 'type': 'page',
                             'properties': {'name': [['资源']]},
                             'content': ['f-zip']}}
        media_row = {'value': {'id': 'row-media', 'type': 'page',
                               'properties': {'name': [['鸟瞰交通']]},
                               'content': ['vid-block']}}
        vid_block = {'value': {'id': 'vid-block', 'type': 'video',
                               'properties': {'source':
                                              [['attachment:vid1:鸟瞰交通.mp4']]}}}
        universe = {
            'training-1': training_page, 'cv-block': cv_block,
            'row-res': res_row, 'row-media': media_row,
            'vid-block': vid_block,
            'f-zip': _file_block('纲目.zip', 'fid-zip', 'f-zip'),
        }
        download_calls = []
        restore = self._install_mocks(
            resource_pages=[], cv={'id': 'cv-block', 'collection_id': 'coll-1',
                                   'space_id': 'space-1'},
            rows=[res_row, media_row], universe=universe,
            download_calls=download_calls)
        URL = 'https://mygoodland.notion.site/11111111222233334444555555555555'
        try:
            docs = down_resource.download_notion_documents(URL)
        finally:
            restore()
        self.assertEqual(len(download_calls), 1)
        # 非 only_row 分支（collection 兜底）仍用训练页 id 作 resource_id（保持原行为）
        self.assertEqual(download_calls[0]['resource_id'], 'training-1')
        aggregated = download_calls[0]['documents']
        self.assertEqual(len(aggregated.get('zip', [])), 1)
        self.assertEqual(len(aggregated.get('video', [])), 1)
        self.assertEqual(len(docs), 2)


if __name__ == '__main__':
    unittest.main(verbosity=2)
