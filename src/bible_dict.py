# -*- coding: utf-8 -*-
"""
圣经经文字典 — 持久化存储所有出现过的经节

格式：{ "太5:3": "太5:3　灵里贫穷的人有福了，因为天国是他们的。" }
随每次 build 增量累积，全本圣经数据可后续导入。
"""
import json
import os
import re

# 复用与 parser_improved.py 相同的经文行识别正则
_VERSE_LINE_RE = re.compile(
    r'^([创出利民申书士得撒王代拉尼斯伯诗箴传歌赛耶哀结但何珥摩俄拿弥鸿哈番该亚玛太可路约徒罗林加弗腓西帖提门多彼约犹启来]'
    r'(?:[一二三四五六七八九十后前上下壹贰叁]\d+|\d+):\d+[上下]?)[　\s\t]+(.+)'
)


class BibleDict:
    """持久化经文字典。

    key  : 经文引用，如 "太5:3"
    value: 完整经文行，如 "太5:3　灵里贫穷的人有福了，因为天国是他们的。"
    """

    def __init__(self):
        self._data: dict = {}

    # ------------------------------------------------------------------
    # 写入
    # ------------------------------------------------------------------

    def add(self, ref: str, full_line: str):
        """存入一节经文（full_line 含 ref 前缀）。已有条目不覆盖。"""
        if ref and ref not in self._data:
            self._data[ref] = full_line

    def add_line(self, line: str):
        """从完整经文行（如 '太5:3　...') 提取 ref 并存储。"""
        m = _VERSE_LINE_RE.match(line)
        if m:
            self.add(m.group(1), line)

    # ------------------------------------------------------------------
    # 读取
    # ------------------------------------------------------------------

    def get(self, ref: str):
        """返回完整经文行，找不到返回 None。"""
        return self._data.get(ref)

    def get_range(self, book_ch: str, start: int, end: int) -> str:
        """获取 book_ch（如 "腓2"）从 start 节到 end 节的经文，拼成多行文本。"""
        verses = []
        for verse_num in range(start, end + 1):
            text = self._data.get(f"{book_ch}:{verse_num}")
            if text:
                verses.append(text)
        return '\n'.join(verses)

    # ------------------------------------------------------------------
    # 持久化
    # ------------------------------------------------------------------

    def load(self, path: str):
        """从 JSON 文件增量加载（不覆盖已有条目）。"""
        if not os.path.exists(path):
            return
        try:
            with open(path, 'r', encoding='utf-8') as f:
                loaded = json.load(f)
            for ref, text in loaded.items():
                if ref not in self._data:
                    self._data[ref] = text
            print(f"  ✓ 加载经文字典: {len(loaded)} 节 ({path})")
        except Exception as e:
            print(f"  ⚠ 加载经文字典失败 ({path}): {e}")

    def save(self, path: str):
        """将字典持久化到 JSON 文件（按引用键排序）。"""
        dirpart = os.path.dirname(path)
        if dirpart:
            os.makedirs(dirpart, exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(self._data, f, ensure_ascii=False, indent=2, sort_keys=True)

    # ------------------------------------------------------------------
    # 辅助
    # ------------------------------------------------------------------

    def __len__(self):
        return len(self._data)

    def __contains__(self, ref: str):
        return ref in self._data
