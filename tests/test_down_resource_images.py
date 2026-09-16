# -*- coding: utf-8 -*-
import os
import sys
import tempfile
import unittest
from pathlib import Path
from typing import List
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import down_resource  # noqa: E402


class MottoImageDownloadTests(unittest.TestCase):
    def _download(self, content: bytes, image_name: str = 'poster.png') -> List[str]:
        """执行下载并返回输出的日志行（用于断言 SKIP/OK 行为）"""
        session = Mock()
        response = Mock(status_code=200, content=content)
        session.get.return_value = response
        blocks = {
            'motto': {'value': {'content': ['image-block']}},
            'image-block': {'value': {
                'type': 'image',
                'id': 'image-block',
                'space_id': 'space-1',
                'properties': {'source': [[f'attachment:file-1:{image_name}']]},
            }},
        }
        logs: List[str] = []
        with patch.object(down_resource, 'load_page_blocks', return_value=blocks):
            with patch('builtins.print', side_effect=lambda *a, **k: logs.append(' '.join(str(x) for x in a))):
                down_resource.download_motto_image(session, {'id': 'motto'}, '2026-04 夏季训练')
        return logs

    def test_same_image_is_not_written_again(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            old_cwd = os.getcwd()
            os.chdir(temp_dir)
            try:
                image_path = Path('resource') / '2026-04 夏季训练' / '标语诗歌.png'
                image_path.parent.mkdir(parents=True)
                image_path.write_bytes(b'same-image')

                with patch.object(Path, 'write_bytes', wraps=Path.write_bytes) as write_bytes:
                    self._download(b'same-image')

                self.assertEqual(write_bytes.call_count, 0)
                self.assertEqual(image_path.read_bytes(), b'same-image')
            finally:
                os.chdir(old_cwd)

    def test_changed_image_replaces_existing_file(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            old_cwd = os.getcwd()
            os.chdir(temp_dir)
            try:
                image_path = Path('resource') / '2026-04 夏季训练' / '标语诗歌.png'
                image_path.parent.mkdir(parents=True)
                image_path.write_bytes(b'old-image')

                self._download(b'new-image')

                self.assertEqual(image_path.read_bytes(), b'new-image')
            finally:
                os.chdir(old_cwd)

    # ── 新增：跨扩展名判重 + 白底素版优先 ────────────────────────────────
    def _make_image(self, bg=(255, 255, 255), fg=(0, 0, 0), size=(40, 60)) -> bytes:
        """生成一张真实 PIL 图片（默认白底黑字），保证 dHash 可计算"""
        from io import BytesIO
        from PIL import Image
        im = Image.new('RGB', size, bg)
        # 画几道前景条纹，避免纯色图 dHash 全 0 影响
        for y in range(5, 30, 6):
            for x in range(size[0]):
                im.putpixel((x, y), fg)
        buf = BytesIO()
        im.save(buf, format='PNG')
        return buf.getvalue()

    def test_cross_extension_dedup_skips_same_content(self):
        """同一内容以不同扩展名存在时，跨扩展名 dHash 判重应跳过"""
        from io import BytesIO
        from PIL import Image
        with tempfile.TemporaryDirectory() as temp_dir:
            old_cwd = os.getcwd()
            os.chdir(temp_dir)
            try:
                content = self._make_image()  # 白底图
                folder = Path('resource') / '2026-04 夏季训练'
                folder.mkdir(parents=True)
                (folder / '标语诗歌.png').write_bytes(content)

                # 同一内容存成 .jpg（字节不同但像素相同）→ 应 SKIP 不落盘
                logs = self._download(content, image_name='poster.jpg')
                self.assertTrue(any('[SKIP]' in line and '标语诗歌' in line for line in logs))
                self.assertFalse((folder / '标语诗歌2.jpg').exists())
                self.assertFalse((folder / '标语诗歌2.png').exists())
            finally:
                os.chdir(old_cwd)

    def test_blue_background_version_skipped(self):
        """蓝底标注版（非白底）内容不同时应丢弃，不落盘"""
        with tempfile.TemporaryDirectory() as temp_dir:
            old_cwd = os.getcwd()
            os.chdir(temp_dir)
            try:
                folder = Path('resource') / '2026-04 夏季训练'
                folder.mkdir(parents=True)

                blue = self._make_image(bg=(0, 51, 153))  # 蓝底
                logs = self._download(blue)
                self.assertTrue(any('非白底' in line for line in logs))
                self.assertEqual(list(folder.iterdir()), [])
            finally:
                os.chdir(old_cwd)

    def test_new_white_content_is_saved(self):
        """白底且内容全新 → 正常落盘"""
        with tempfile.TemporaryDirectory() as temp_dir:
            old_cwd = os.getcwd()
            os.chdir(temp_dir)
            try:
                folder = Path('resource') / '2026-04 夏季训练'
                folder.mkdir(parents=True)

                white = self._make_image()  # 白底
                logs = self._download(white)
                self.assertTrue(any('[OK]' in line for line in logs))
                self.assertTrue((folder / '标语诗歌.png').exists())
            finally:
                os.chdir(old_cwd)


if __name__ == '__main__':
    unittest.main(verbosity=2)