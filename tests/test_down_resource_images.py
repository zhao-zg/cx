# -*- coding: utf-8 -*-
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import down_resource  # noqa: E402


class MottoImageDownloadTests(unittest.TestCase):
    def setUp(self):
        self.blocks = {
            'motto': {'value': {'content': ['image-block']}},
            'image-block': {'value': {
                'type': 'image',
                'id': 'image-block',
                'space_id': 'space-1',
                'properties': {'source': [['attachment:file-1:poster.png']]},
            }},
        }

    def _download(self, content: bytes) -> Path:
        session = Mock()
        response = Mock(status_code=200, content=content)
        session.get.return_value = response
        with patch.object(down_resource, 'load_page_blocks', return_value=self.blocks):
            down_resource.download_motto_image(session, {'id': 'motto'}, '2026-04 夏季训练')
        return Path('resource') / '2026-04 夏季训练' / '标语诗歌.png'

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


if __name__ == '__main__':
    unittest.main(verbosity=2)