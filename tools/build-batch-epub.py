#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build-batch-epub.py — 从批次 resource 文件夹中的 EPUB 文件生成 training.json

用法:
    python tools/build-batch-epub.py --epub <epub_file> --folder <batch_folder> --output <output_dir>
                                    [--year YYYY] [--season 季节]

功能:
    1. 解析 EPUB ZIP 文件（container.xml → OPF → metadata/manifest/spine）
    2. 从 HTML 中提取大纲、听抄、晨兴、诗歌、标语（与 epub-importer.js 逻辑一致）
    3. 使用 training-enricher.js 富化 feeding_refs
    4. 写出 training.json
    5. 复制标语诗歌图片到 output/images/
    6. 输出元数据 JSON 到 stdout（供 Python main.py 读取）

解析逻辑对照 epub-importer.js:
    - parseEpubStructure   → parse_epub_structure()
    - parseTocFromHtml     → parse_toc_from_html()
    - parseMottosFromHtml  → parse_mottos_from_html()
    - parseOutlineFromHtml → parse_outline_from_html()
    - parseTranscriptFromHtml → parse_transcript_from_html()
    - parseMorningRevivalFromHtml → parse_morning_revival_from_html()
    - parseHymnFromHtml    → parse_hymn_from_html()
"""

import os
import sys
import re
import json
import zipfile
import shutil
import subprocess
import argparse
from datetime import datetime
from html.parser import HTMLParser

# ── HTML 解析（使用标准库，避免 lxml 依赖问题）──────────────────────────────


class SimpleElement:
    """简单 DOM 元素"""
    __slots__ = ('tag', 'attrs', 'children', 'text', 'parent')

    def __init__(self, tag, attrs=None):
        self.tag = tag
        self.attrs = dict(attrs) if attrs else {}
        self.children = []
        self.text = ''
        self.parent = None

    def get(self, key, default=None):
        return self.attrs.get(key, default)

    def get_text(self):
        """递归获取所有文本内容"""
        parts = []
        if self.text:
            parts.append(self.text)
        for ch in self.children:
            if isinstance(ch, SimpleElement):
                parts.append(ch.get_text())
            elif isinstance(ch, str):
                parts.append(ch)
        return ''.join(parts)

    def get_inner_html(self):
        """获取内部 HTML（简化版，用于标语解析）"""
        parts = []
        for ch in self.children:
            if isinstance(ch, SimpleElement):
                parts.append('<{}>'.format(ch.tag))
                parts.append(ch.get_inner_html())
                parts.append('</{}>'.format(ch.tag))
            elif isinstance(ch, str):
                parts.append(ch)
        return ''.join(parts)

    def query_selector_all(self, predicate):
        """查找所有满足条件的后代元素"""
        results = []
        self._walk(predicate, results)
        return results

    def query_selector(self, predicate):
        """查找第一个满足条件的后代元素"""
        results = self.query_selector_all(predicate)
        return results[0] if results else None

    def _walk(self, predicate, results):
        for ch in self.children:
            if isinstance(ch, SimpleElement):
                if predicate(ch):
                    results.append(ch)
                ch._walk(predicate, results)

    def find_all_by_class(self, class_name):
        """按 CSS class 查找所有元素"""
        return self.query_selector_all(
            lambda el: class_name in el.attrs.get('class', '').split()
        )

    def find_by_class(self, class_name):
        """按 CSS class 查找第一个元素"""
        results = self.find_all_by_class(class_name)
        return results[0] if results else None

    def find_all_by_tag(self, tag_name):
        """按标签名查找所有元素"""
        tag_lower = tag_name.lower()
        return self.query_selector_all(
            lambda el: el.tag.lower() == tag_lower
        )


class DOMParser(HTMLParser):
    """简单 HTML → DOM 解析器"""

    VOID_ELEMENTS = frozenset({
        'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
        'link', 'meta', 'param', 'source', 'track', 'wbr'
    })

    def __init__(self):
        super().__init__()
        self.root = SimpleElement('root')
        self._stack = [self.root]

    def handle_starttag(self, tag, attrs):
        el = SimpleElement(tag, attrs)
        el.parent = self._stack[-1]
        self._stack[-1].children.append(el)
        if tag.lower() not in self.VOID_ELEMENTS:
            self._stack.append(el)

    def handle_endtag(self, tag):
        # 弹出到匹配的标签
        for i in range(len(self._stack) - 1, 0, -1):
            if self._stack[i].tag.lower() == tag.lower():
                self._stack = self._stack[:i]
                return

    def handle_data(self, data):
        if self._stack:
            self._stack[-1].children.append(data)

    def handle_entityref(self, name):
        entities = {'nbsp': ' ', 'amp': '&', 'lt': '<', 'gt': '>',
                    'quot': '"', 'apos': "'", 'copy': '\u00a9'}
        self.handle_data(entities.get(name, '&{};'.format(name)))

    def handle_charref(self, name):
        try:
            if name.startswith('x') or name.startswith('X'):
                char = chr(int(name[1:], 16))
            else:
                char = chr(int(name))
            self.handle_data(char)
        except (ValueError, OverflowError):
            self.handle_data('&#{};'.format(name))


def parse_html(html_text):
    """解析 HTML 文本，返回根元素"""
    parser = DOMParser()
    parser.feed(html_text)
    return parser.root


# ── XML 解析（用于 container.xml 和 OPF）─────────────────────────────────

def parse_xml_simple(xml_text):
    """简单 XML 解析，返回根元素（复用 HTML 解析器）"""
    return parse_html(xml_text)


# ── EPUB 结构解析 ────────────────────────────────────────────────────────
# 对照 epub-importer.js: parseEpubStructure()

def parse_epub_structure(zf):
    """
    解析 EPUB 的 container.xml → 找到 OPF → 读取元数据与 spine。
    返回 dict: { metadata, manifest, spineIds, opfDir }
    """
    # 1. 读取 container.xml
    container_xml = _zip_read_text(zf, 'META-INF/container.xml')
    if not container_xml:
        raise RuntimeError('EPUB 缺少 META-INF/container.xml')

    container_doc = parse_xml_simple(container_xml)
    rootfile_el = container_doc.query_selector(
        lambda el: el.tag.lower() == 'rootfile'
    )
    if not rootfile_el:
        raise RuntimeError('EPUB 缺少 rootfile 声明')

    opf_path = rootfile_el.get('full-path', '')
    opf_dir = ''
    if '/' in opf_path:
        opf_dir = opf_path[:opf_path.rfind('/') + 1]

    # 2. 读取 OPF
    opf_xml = _zip_read_text(zf, opf_path)
    if not opf_xml:
        raise RuntimeError('EPUB 缺少 OPF 文件: {}'.format(opf_path))

    opf_doc = parse_xml_simple(opf_xml)

    # 元数据
    metadata = {'title': '', 'creator': '', 'subject': '', 'date': '', 'lang': 'zh'}
    # 遍历 metadata 子元素
    meta_container = opf_doc.query_selector(
        lambda el: el.tag.lower() == 'metadata'
    )
    if meta_container:
        for ch in meta_container.children:
            if not isinstance(ch, SimpleElement):
                continue
            tag = ch.tag.lower().replace('dc:', '')
            text = ch.get_text().strip()
            if tag == 'title' and not metadata['title']:
                metadata['title'] = text
            elif tag == 'creator' and not metadata['creator']:
                metadata['creator'] = text
            elif tag == 'subject' and not metadata['subject']:
                metadata['subject'] = text
            elif tag == 'date' and not metadata['date']:
                metadata['date'] = text
            elif tag == 'language' and not metadata['lang']:
                metadata['lang'] = text

    # manifest: id → {href, mediaType}
    manifest = {}
    manifest_el = opf_doc.query_selector(
        lambda el: el.tag.lower() == 'manifest'
    )
    if manifest_el:
        for item_el in manifest_el.children:
            if not isinstance(item_el, SimpleElement):
                continue
            if item_el.tag.lower() != 'item':
                continue
            item_id = item_el.get('id', '')
            href = item_el.get('href', '')
            mt = item_el.get('media-type', '')
            manifest[item_id] = {'href': opf_dir + href, 'mediaType': mt}

    # spine: 有序 itemref id 列表
    spine_ids = []
    spine_el = opf_doc.query_selector(
        lambda el: el.tag.lower() == 'spine'
    )
    if spine_el:
        for ref_el in spine_el.children:
            if isinstance(ref_el, SimpleElement) and ref_el.tag.lower() == 'itemref':
                idref = ref_el.get('idref', '')
                if idref:
                    spine_ids.append(idref)

    return {
        'metadata': metadata,
        'manifest': manifest,
        'spineIds': spine_ids,
        'opfDir': opf_dir
    }


# ── 目录解析 ────────────────────────────────────────────────────────────
# 对照 epub-importer.js: parseTocFromHtml()

def parse_toc_from_html(doc):
    """
    解析 index.html 目录，提取各篇标题和链接。
    返回 [{ number, cnNum, title, links }]
    """
    chapter_els = doc.find_all_by_class('calibre_index_chapter')
    entries = []

    for el in chapter_els:
        # <b> 标签包含篇章标题
        b_els = el.find_all_by_tag('b')
        title_text = normalize_text(b_els[0].get_text().strip()) if b_els else ''
        if not title_text:
            continue

        # 解析 "第X篇　标题" / "第X周　标题"
        m = re.match(r'^第([一二三四五六七八九十]+)[篇周][\s\u3000]*(.*)', title_text)
        cn_num = m.group(1) if m else ''
        title = _normalize_title_dash(m.group(2).strip()) if m else title_text
        num = cn_ord_to_int(cn_num) if cn_num else 0

        # 提取链接
        links = {}
        anchor_els = el.find_all_by_class('calibre_hyperlinks')
        for a_el in anchor_els:
            href = a_el.get('href', '')
            link_text = a_el.get_text().strip()
            if link_text == '大纲':
                links['dg'] = href
            elif link_text == '纲目':
                links['cv'] = href
            elif '中英对照' in link_text:
                links['ce'] = href
            elif link_text == '听抄':
                links['ts'] = href
            elif link_text == '晨兴':
                links['h'] = re.sub(r'\.htm.*$', '.htm', href)

        entries.append({
            'number': num or (len(entries) + 1),
            'cnNum': cn_num,
            'title': title,
            'links': links
        })

    return entries


# ── 标语解析 ────────────────────────────────────────────────────────────
# 对照 epub-importer.js: parseMottosFromHtml()

def parse_mottos_from_html(doc):
    """解析 banner.html 中的标语，返回中英文标语列表（与 TXT 格式一致）"""
    banner_els = doc.find_all_by_class('banner')
    if not banner_els:
        # 回退：查找所有 <p> 标签
        banner_els = doc.find_all_by_tag('p')

    mottos = []
    for el in banner_els:
        full_text = el.get_text().strip()
        if not full_text:
            continue
        # 按换行符分割（<br/> 会产生换行）
        lines = full_text.split('\n')
        # 中文标语：第一行
        cn_text = lines[0].strip()
        if cn_text:
            mottos.append(cn_text)
        # 英文标语：从 grayW span 中提取
        gray_els = el.find_all_by_class('grayW')
        if gray_els:
            en_text = gray_els[0].get_text().strip()
            if en_text:
                mottos.append(en_text)
        elif len(lines) > 1:
            # 回退：取第二行（可能有英文翻译）
            en_text = lines[1].strip()
            if en_text and en_text != cn_text:
                mottos.append(en_text)

    return mottos


# ── 大纲解析 ────────────────────────────────────────────────────────────
# 对照 epub-importer.js: parseOutlineFromHtml()

LEVEL1_CHARS = '壹贰叁肆伍陆柒捌玖拾'
LEVEL2_CHARS = '一二三四五六七八九十'

# 合并字符集，用于匹配混合格式的级别号
ALL_LEVEL_CHARS = LEVEL1_CHARS + LEVEL2_CHARS


def extract_cn_level(text, chars=None):
    """从文本开头提取中文数字级别号（支持多字符，如 十一、二十一、拾壹等）。
    
    Args:
        text: 输入文本
        chars: 允许的字符集，默认使用 ALL_LEVEL_CHARS
    
    Returns:
        (level, rest_text): 级别号和剩余文本。无匹配时 level=''。
    """
    if chars is None:
        chars = ALL_LEVEL_CHARS
    m = re.match(r'^([{}]+)[\s\u3000]+(.*)'.format(re.escape(chars)), text)
    if m and len(m.group(1)) <= 3:
        return m.group(1), m.group(2)
    return '', text

def cn_ord_to_int(cn):
    """中文数字转整数"""
    mapping = {
        '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
        '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
        '十一': 11, '十二': 12, '十三': 13, '十四': 14, '十五': 15,
        '十六': 16, '十七': 17, '十八': 18, '十九': 19, '二十': 20
    }
    return mapping.get(cn, 0)


def normalize_text(text):
    """标准化文本：统一 EPUB 源与 TXT 路径的字符差异。
    - ～ (U+FF5E 全角波浪号) → ~ (U+007E 半角)，用于经文引用范围
    注意：dash 字符（─ U+2500 和 — U+2014）不做转换，
    因为 EPUB 源在正文中使用 — 与 TXT 参考路径一致。
    标题中的 dash 转换由 _normalize_title_dash() 单独处理。
    ○ (U+25CB) 和 〇 (U+3007) 不做全局转换，
    因为 TXT 参考在不同字段中用法不一致（纲目标题用〇，参读页码用○）。
    """
    if not text:
        return text
    return text.replace('\uff5e', '~')


def _normalize_title_dash(text):
    """标题专用标准化：将 — (U+2014 em dash) 转为 ─ (U+2500 制表横线)。
    EPUB 源标题中使用 — 但 TXT 参考路径纲目标题使用 ─。
    """
    if not text:
        return text
    return text.replace('\u2014', '\u2500')


def p_text(el):
    """提取元素的纯文本，去首尾空白，并标准化字符"""
    return normalize_text((el.get_text() or '').strip())


def p_text_with_breaks(el):
    """提取元素文本，保留 <br/> 换行和 <b> 加粗标记。
    用于诗歌歌词提取，保留节号和换行排版。
    """
    parts = []
    _walk_for_text(el, parts)
    text = ''.join(parts).strip()
    return normalize_text(text)


def _walk_for_text(el, parts):
    """递归遍历元素树，生成带排版的文本"""
    for ch in el.children:
        if isinstance(ch, str):
            parts.append(ch)
        elif isinstance(ch, SimpleElement):
            tag = ch.tag.lower()
            if tag == 'br':
                parts.append('\n')
            elif tag == 'b':
                parts.append(ch.get_text())
            else:
                _walk_for_text(ch, parts)


def parse_outline_from_html(doc):
    """
    解析 _cv.htm 页面中的大纲树。
    CSS 类名 → 层级映射：
      calibre_text_dadian    → 壹（大点）
      calibre_text_zhongdian → 一（中点）
      calibre_text_xiaodian  → 1（小点）
    返回 Content 节点树 []
    """
    body = doc.find_all_by_tag('body')
    if not body:
        return []
    body = body[0]

    # 收集所有 <p> 和 <h2> 元素
    all_p = list(body.find_all_by_tag('p')) + list(body.find_all_by_tag('h2'))

    roots = []
    stack = []  # [(rank, node)]

    # 跳过的 CSS 类
    SKIP_CLASSES = {
        'calibre_zongti', 'calibre_content_title', 'calibre_text_verse',
        'calibre_text_chenxing_content', 'calibre_text_chenxing_verse',
        'calibre_text_chenxing_content_wyxd', 'calibre_text_chenxing_content_wn',
        'calibre_text_gangmu_wn', 'calibre_text_hymns', 'calibre_index_chapter',
        'calibre_index_title1', 'calibre_text_abs', 'calibre_text_abs_dadian',
        'calibre_e_text_dadian', 'calibre_e_text_zhongdian', 'calibre_e_text_xiaodian'
    }

    for p_el in all_p:
        cls = p_el.get('class', '')
        text = p_text(p_el)
        if not text:
            continue

        if cls in SKIP_CLASSES:
            continue

        rank = 0
        level = ''
        title = ''

        if cls == 'calibre_text_dadian':
            rank = 1
            level, title = extract_cn_level(text, ALL_LEVEL_CHARS)
        elif cls == 'calibre_text_zhongdian':
            rank = 2
            level, title = extract_cn_level(text, LEVEL2_CHARS)
        elif cls == 'calibre_text_xiaodian':
            rank = 3
            m = re.match(r'^(\d+)[.。\s\u3000]+(.*)', text)
            if m:
                level = m.group(1)
                title = m.group(2)
            else:
                level = ''
                title = text
        else:
            # 尝试解析 a. b. 等更深层
            m = re.match(r'^([a-z])[.\s\u3000]+(.*)', text)
            if m:
                rank = 4
                level = m.group(1)
                title = m.group(2)
            else:
                continue

        # 剥离 ─/—引用经文 标记
        title = re.sub(r'[─—]引用经文$', '', title)

        node = {'level': level, 'title': _normalize_title_dash(title), 'content': [], 'children': []}
        while stack and stack[-1][0] >= rank:
            stack.pop()
        if stack:
            stack[-1][1]['children'].append(node)
        else:
            roots.append(node)
        stack.append((rank, node))

    return roots


# ── 听抄解析 ────────────────────────────────────────────────────────────
# 对照 epub-importer.js: parseTranscriptFromHtml()

def _normalize_title_for_match(title):
    """标准化标题用于匹配：去除括号内容、经文引用、标点、空白。"""
    if not title:
        return ''
    # 去除括号及其内容（经文引用如"（约三15~16）"、解释说明等）
    t = re.sub(r'[（(].*?[)）]', '', title)
    # 将 dash 字符替换为空（─ 和 — 都可能出现）
    t = t.replace('─', '').replace('—', '')
    # 去除标点、空白、波浪号和阿拉伯数字（经文引用中的章节数字）
    t = re.sub(r'[，。；：、（）()\[\]「」\u201c\u201d\u2018\u2019\s\u3000·~0-9]', '', t)
    return t


def _common_prefix_len(a, b):
    """计算两个字符串的公共前缀长度。"""
    n = min(len(a), len(b))
    for i in range(n):
        if a[i] != b[i]:
            return i
    return n


def _match_transcript_to_outline(transcript_title, outline_nodes, min_match=6):
    """在纲目节点列表中找到与听抄标题最佳匹配的节点。

    匹配策略（按优先级）：
    1. 直接前缀匹配：标准化后从头比较共同前缀长度。
    2. 偏移前缀匹配：听抄标题可能省略了纲目标题的开头部分
       （如纲目 "我们是基督的门徒" vs 听抄 "基督的门徒"），
       在纲目标题中搜索听抄标题起始位置，从该偏移开始计算公共前缀。
    3. 反向偏移匹配：纲目标题可能省略了听抄标题的开头部分。
    取所有策略中共同前缀最长的匹配。
    """
    if not transcript_title or not outline_nodes:
        return None
    norm_t = _normalize_title_for_match(transcript_title)
    if len(norm_t) < min_match:
        return None
    best_match = None
    best_len = 0
    for node in outline_nodes:
        norm_o = _normalize_title_for_match(node.get('title', ''))
        if len(norm_o) < min_match:
            continue

        # 1. 直接前缀匹配
        match_len = _common_prefix_len(norm_t, norm_o)
        if match_len >= min_match and match_len > best_len:
            best_match = node
            best_len = match_len

        # 2. 偏移前缀匹配：在 outline 中查找 transcript 起始位置
        if len(norm_t) >= min_match and len(norm_o) > len(norm_t):
            search_str = norm_t[:min_match]
            pos = norm_o.find(search_str)
            if pos > 0:
                off_len = _common_prefix_len(norm_t, norm_o[pos:])
                if off_len >= min_match and off_len > best_len:
                    best_match = node
                    best_len = off_len

        # 3. 反向偏移匹配：在 transcript 中查找 outline 起始位置
        if len(norm_o) >= min_match:
            search_str_o = norm_o[:min_match]
            pos_t = norm_t.find(search_str_o)
            if pos_t > 0:
                off_len = _common_prefix_len(norm_o, norm_t[pos_t:])
                if off_len >= min_match and off_len > best_len:
                    best_match = node
                    best_len = off_len

    return best_match


def _is_title_duplicate(text, title, min_match=12):
    """检查正文段落是否与标题重复（标准化后前缀匹配）。"""
    norm_t = _normalize_title_for_match(text)
    norm_o = _normalize_title_for_match(title)
    if len(norm_t) < min_match or len(norm_o) < min_match:
        return False
    match_len = min(len(norm_t), len(norm_o), 20)
    return norm_t[:match_len] == norm_o[:match_len]


def _append_to_current(node, intro_content, text):
    """将文本追加到当前节点或引言内容。"""
    if node:
        node['content'].append(text)
    else:
        intro_content.append(text)


# CSS 类名 → 层级 rank 映射
_TS_RANK_MAP = {
    'calibre_text_abs_dadian': 1,      # 大点（壹）
    'calibre_text_abs_zhongdian': 2,   # 中点（一）
    'calibre_text_abs_xiaodian': 3,    # 小点（1）
    'calibre_text_abs_zimudian': 4,    # 子目点（a）
}


def parse_transcript_from_html(doc, outline_sections=None):
    """
    解析 _ts.htm 页面中的听抄内容。
    使用 CSS 类名确定 4 级嵌套（dadian/zhongdian/xiaodian/zimudian），
    通过纲目匹配获取级别号和完整标题。

    返回 { detailSections, messageContent, ministryExcerpt }
    """
    body = doc.find_all_by_tag('body')
    if not body:
        return {'detailSections': [], 'messageContent': [], 'ministryExcerpt': ''}

    detail_sections = []
    intro_content = []  # 第一个匹配纲目之前的内容
    message_content = []

    # 4 级嵌套状态
    current_nodes = [None, None, None, None]  # [section, child, grandchild, great_grandchild]

    # 各级对应的纲目子节点列表（5 个元素：索引 0-4，rank 4 的子节点存放在索引 4）
    outline_children_stack = [outline_sections or [], [], [], [], []]

    # 标记刚创建的新节点 rank，用于过滤与标题重复的首段
    just_created_rank = 0

    # 追踪首个匹配之前是否出现过未匹配的大点（决定引言归属）
    has_unmatched_dadian = False
    first_match_found = False

    all_p = list(body[0].find_all_by_tag('p')) + list(body[0].find_all_by_tag('h2'))

    for p_el in all_p:
        cls = p_el.get('class', '')
        text = p_text(p_el)
        if not text:
            continue

        # 跳过标题行、读经行、脚注、免责声明
        if cls in ('calibre_zongti', 'calibre_content_title', 'calibre_text_verse',
                   'calibre_verse', 'calibre_text_abs_shuoming'):
            continue

        rank = _TS_RANK_MAP.get(cls, 0)

        # ── 层级标题（dadian / zhongdian / xiaodian / zimudian）──
        if rank > 0:
            # 1. 剥离级别号前缀后匹配纲目
            level_prefix, clean_title = extract_cn_level(text, ALL_LEVEL_CHARS)
            # 补充剥离阿拉伯数字和字母前缀（xiaodian/zimudian）
            if not level_prefix:
                m_arabic = re.match(r'^(\d+)[.。\s\u3000]+(.*)', text)
                if m_arabic:
                    level_prefix = m_arabic.group(1)
                    clean_title = m_arabic.group(2)
                else:
                    m_letter = re.match(r'^([a-z])[.\s\u3000]+(.*)', text)
                    if m_letter:
                        level_prefix = m_letter.group(1)
                        clean_title = m_letter.group(2)
            parent_outline_children = outline_children_stack[rank - 1]
            matched = _match_transcript_to_outline(clean_title, parent_outline_children)

            if matched:
                # 匹配纲目 → 创建节点，标题用纲目标题（与 TXT 路径一致）
                # detail_sections 标题用 — (U+2014)，与听抄正文 dash 惯例一致
                first_match_found = True
                outline_title = matched.get('title', clean_title)
                new_node = {
                    'level': matched.get('level', level_prefix),
                    'title': outline_title.replace('\u2500', '\u2014'),
                    'content': [], 'children': []
                }
                just_created_rank = rank
            elif rank == 1:
                # 未匹配纲目的大点 → 视为引言标题，文本保留在 content 中
                if not first_match_found:
                    has_unmatched_dadian = True
                _target = current_nodes[3] or current_nodes[2] or current_nodes[1] or current_nodes[0]
                _append_to_current(_target, intro_content, text)
                just_created_rank = 0
                continue
            elif current_nodes[rank - 2]:
                # 有父节点但未匹配纲目 → 用原始文本创建子节点（标题不加入 content）
                new_node = {
                    'level': level_prefix, 'title': clean_title,
                    'content': [], 'children': []
                }
                just_created_rank = rank
            else:
                # 无父节点且未匹配 → 保留文本在 content 中
                _target = current_nodes[3] or current_nodes[2] or current_nodes[1] or current_nodes[0]
                _append_to_current(_target, intro_content, text)
                just_created_rank = 0
                continue

            # 重置更深层级
            for i in range(rank, 4):
                current_nodes[i] = None
                outline_children_stack[i] = []

            # 设置当前层级节点
            current_nodes[rank - 1] = new_node
            if matched:
                outline_children_stack[rank] = matched.get('children', [])

            # 添加到父节点或顶级列表
            if rank == 1:
                detail_sections.append(new_node)
            elif current_nodes[rank - 2]:
                current_nodes[rank - 2]['children'].append(new_node)
            else:
                detail_sections.append(new_node)

        # ── 正文段落 (text_abs 及其他) ──
        else:
            # 过滤与刚创建节点标题重复的首段
            if just_created_rank > 0:
                target = current_nodes[3] or current_nodes[2] or current_nodes[1] or current_nodes[0]
                if target and _is_title_duplicate(text, target.get('title', '')):
                    just_created_rank = 0
                    continue
                just_created_rank = 0

            _target = current_nodes[3] or current_nodes[2] or current_nodes[1] or current_nodes[0]
            _append_to_current(_target, intro_content, text)

    # 引言内容归属：
    # - 有未匹配大点（如"求主教导我舌"等引言标题）→ 创建 Section 0（2026-04 模式）
    # - 无未匹配大点（首个大点直接匹配纲目）→ 放入 message_content（2026-03 模式）
    if intro_content:
        if has_unmatched_dadian or not detail_sections:
            detail_sections.insert(0, {
                'level': '', 'title': '', 'content': intro_content, 'children': []
            })
        else:
            message_content = intro_content

    # 若无结构化段落，将所有正文作为单一节点
    if not detail_sections:
        detail_sections = [{'level': '', 'title': '', 'content': [], 'children': []}]

    return {
        'detailSections': detail_sections,
        'messageContent': message_content,
        'ministryExcerpt': ''
    }


# ── 晨兴解析 ────────────────────────────────────────────────────────────
# 对照 epub-importer.js: parseMorningRevivalFromHtml()

def parse_morning_revival_from_html(doc, day_label):
    """
    解析 _h_N.htm 页面中的晨兴内容。
    返回单天 MorningRevival dict
    """
    body = doc.find_all_by_tag('body')
    if not body:
        return None

    outline_nodes = []
    feeding_scriptures = []
    morning_feeding = []
    message_reading = []
    ref_reading = []

    stack = []  # 大纲栈
    mode = 'outline'

    all_p = list(body[0].find_all_by_tag('p')) + list(body[0].find_all_by_tag('h2'))

    for p_el in all_p:
        cls = p_el.get('class', '')
        text = p_text(p_el)
        if not text:
            continue

        # 跳过标题行、读经行、脚注中的经文正文
        if cls in ('calibre_zongti', 'calibre_content_title', 'calibre_text_verse', 'calibre_verse'):
            continue

        # 日标记: "周　一"（两种 CSS 类名）
        if cls in ('calibre_text_gangmu_wn', 'calibre_text_chenxing_content_wn'):
            if cls == 'calibre_text_gangmu_wn':
                day_match = re.match(r'周[\s\u3000]*([一二三四五六])', text)
            else:
                day_match = re.search(r'周([一二三四五六])', text)
            if day_match:
                mode = 'outline'
            continue

        # 注意："信息选读" 和 "参读" 检测必须在 class 检测之前，
        # 因为 "信息选读" 的 class 也是 calibre_text_chenxing_content_wyxd
        # 信息选读区域开始
        if re.match(r'^信息选读', text):
            mode = 'msgread'
            continue

        # 参读区域开始
        if re.match(r'^参读', text):
            mode = 'refread'
            # 如果参读行本身包含内容（如 "参读：活力排..."），保留完整文本
            ref_match = re.match(r'^参读[：:]\s*(.+)', text)
            if ref_match:
                ref_reading.append(text)
            continue

        # 晨兴喂养区域开始（class 检测放在文字检测之后）
        if '晨兴喂养' in text or cls == 'calibre_text_chenxing_content_wyxd':
            mode = 'feeding'
            continue

        # 大纲区域
        if mode == 'outline':
            rank = 0
            level = ''
            title = ''

            if cls == 'calibre_text_dadian':
                rank = 1
                level, title = extract_cn_level(text, ALL_LEVEL_CHARS)
            elif cls == 'calibre_text_zhongdian':
                rank = 2
                level, title = extract_cn_level(text, LEVEL2_CHARS)
            elif cls == 'calibre_text_xiaodian':
                rank = 3
                m = re.match(r'^(\d+)[.。\s\u3000]+(.*)', text)
                if m:
                    level = m.group(1)
                    title = m.group(2)
                else:
                    level = ''
                    title = text
            else:
                # 尝试解析 a. b. 等更深层
                m = re.match(r'^([a-z])[.\s\u3000]+(.*)', text)
                if m:
                    rank = 4
                    level = m.group(1)
                    title = m.group(2)

            if rank > 0:
                title = re.sub(r'[─—]引用经文$', '', title)
                node = {'level': level, 'title': _normalize_title_dash(title), 'content': [], 'children': []}
                while stack and stack[-1][0] >= rank:
                    stack.pop()
                if stack:
                    stack[-1][1]['children'].append(node)
                else:
                    outline_nodes.append(node)
                stack.append((rank, node))
                continue

            # 非层级段落 → 作为栈顶节点的 content
            if stack:
                stack[-1][1]['content'].append(text)
            continue

        # 晨兴喂养区域
        if mode == 'feeding':
            if cls == 'calibre_text_chenxing_verse':
                feeding_scriptures.append(text)
            else:
                morning_feeding.append(text)
            continue

        # 信息选读区域
        if mode == 'msgread':
            message_reading.append(text)
            continue

        # 参读区域
        if mode == 'refread':
            ref_reading.append(text)
            continue

    return {
        'day': day_label or '',
        'outline': outline_nodes,
        'feeding_scriptures': feeding_scriptures,
        'morning_feeding': morning_feeding,
        'message_reading': message_reading,
        'ref_reading': ref_reading
    }


# ── 诗歌解析 ────────────────────────────────────────────────────────────
# 对照 epub-importer.js: parseHymnFromHtml()

def parse_hymn_from_html(doc, msg_num):
    """
    解析 _h_hymn.htm 中的诗歌信息。
    返回 { hymnNumber, hymnImage, hymnLyrics }
    """
    body = doc.find_all_by_tag('body')
    if not body:
        return {'hymnNumber': '', 'hymnImage': '', 'hymnLyrics': []}

    # 提取诗歌图片
    img_els = body[0].find_all_by_tag('img')
    hymn_image = ''
    if img_els:
        hymn_image = 'images/{}_hymn.png'.format(msg_num)

    # 提取诗歌歌词
    lyrics = []
    hymn_ps = body[0].find_all_by_class('calibre_text_hymns')
    for p_el in hymn_ps:
        t = p_text_with_breaks(p_el)
        if t:
            lyrics.append(t)

    # 提取标题中的诗歌编号（多种格式："诗歌：补充727" 或在标题中包含）
    hymn_number = ''
    title_el = doc.find_by_class('calibre_content_title')
    if title_el:
        tm = re.search(r'诗歌[：:]', title_el.get_text())
        if tm:
            # 取 "诗歌：" 后面的内容
            rest = title_el.get_text()[tm.end():].strip()
            hymn_number = rest
    # 也尝试从第一个 hymn 段落中提取编号
    if not hymn_number and hymn_ps:
        first_hymn = p_text(hymn_ps[0])
        # 格式可能是 "1　歌词" 或 "补充本431首" 开头
        hymn_num_m = re.match(r'^(?:补充[本]?|大[本]?|新[本]?)\s*(\d+[首]?|\d+)', first_hymn)
        if hymn_num_m:
            hymn_number = hymn_num_m.group(0)

    return {'hymnNumber': hymn_number, 'hymnImage': hymn_image, 'hymnLyrics': lyrics}


# ── 总题/副标题提取 ────────────────────────────────────────────────────
# 对照 epub-importer.js: extractZongti / extractSubtitle / extractContentTitle / extractScripture

def extract_zongti(doc):
    """从 <p class="calibre_zongti"> 提取总题"""
    el = doc.find_by_class('calibre_zongti')
    if not el:
        return ''
    text = normalize_text(el.get_text().strip())
    # 取第一行
    lines = text.split('\n')
    text = lines[0].strip()
    # 去掉 "总题：" 前缀
    text = re.sub(r'^总题[：:]\s*', '', text)
    return text


def extract_content_title(doc):
    """从 <p class="calibre_content_title"> 提取篇章标题"""
    el = doc.find_by_class('calibre_content_title')
    if not el:
        return None
    text = normalize_text(el.get_text().strip())
    lines = [l.strip() for l in text.split('\n') if l.strip()]
    first_line = lines[0] if lines else text
    m = re.match(r'^第([一二三四五六七八九十]+)[篇周][\s\u3000]*(.*)', first_line)
    if m:
        return {'cnNum': m.group(1), 'title': m.group(2).strip(), 'fullTitle': first_line}
    return {'cnNum': '', 'title': first_line, 'fullTitle': first_line}


def extract_scripture(doc):
    """从 <p class="calibre_text_verse"> 提取读经经文"""
    el = doc.find_by_class('calibre_text_verse')
    if not el:
        return ''
    text = normalize_text(el.get_text().strip())
    text = re.sub(r'^读经[：:]\s*', '', text)
    return text


def extract_subtitle(doc):
    """从 index.html 的 .calibre_zongti 提取副标题"""
    return extract_zongti(doc)


# ── 辅助函数 ────────────────────────────────────────────────────────────
# 对照 epub-importer.js: extractYearFromTitle / extractSeqFromFilename / extractSeqFromTitle / getShortTitle

CN_DIGIT_MAP = {
    '一': '1', '二': '2', '三': '3', '四': '4', '五': '5',
    '六': '6', '七': '7', '八': '8', '九': '9',
    '○': '0', '〇': '0', '零': '0', '两': '2'
}

MONTH_MAP = {
    '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6,
    '七': 7, '八': 8, '九': 9, '十': 10, '十一': 11, '十二': 12
}


def extract_year_from_title(title):
    """从标题中提取年份"""
    # 中文年份
    m = re.search(r'([一二三四五六七八九○〇零两]{4})年', title)
    if not m:
        m = re.search(r'(\d{4})', title)
    if not m:
        return None

    s = m.group(1)
    if re.search(r'[一二三四五六七八九○〇零两]', s):
        digits = ''.join(CN_DIGIT_MAP.get(c, '0') for c in s)
        y = int(digits)
        return y if 1900 < y < 2100 else None

    y = int(s)
    return y if 1900 < y < 2100 else None


def extract_seq_from_filename(filename):
    """从文件名 '2026-4-JST.epub' 提取序号"""
    m = re.search(r'(\d{4})-(\d+)', filename)
    if m:
        seq = int(m.group(2))
        if 1 <= seq <= 12:
            return seq
    return None


def extract_seq_from_title(title):
    """从标题推断序号（月份→季度映射）"""
    # 月份→季度
    m = re.search(r'([一二三四五六七八九十]+)月', title)
    if m and m.group(1) in MONTH_MAP:
        month = MONTH_MAP[m.group(1)]
        return (month - 1) // 3 + 1

    if '春季' in title:
        return 1
    if '夏季' in title:
        return 2
    if '秋季' in title:
        return 3
    if '冬季' in title:
        return 4
    return None


def get_short_title(header):
    """去掉年份前缀，获取短标题"""
    if not header:
        return ''
    # 去掉4字年份前缀
    m = re.match(r'^[一二三四五六七八九○〇零两\d]{4}年?', header)
    short = header[m.end():].strip() if m else header.strip()
    # 去掉合辑标题中的"、B年XXX"后缀
    short = re.sub(r'、[一二三四五六七八九○〇零]{4}年.+$', '', short).strip()
    return short


def get_now_version():
    """生成时间版本号"""
    return datetime.now().strftime('%Y%m%d%H%M%S')


# ── ZIP 读取工具 ─────────────────────────────────────────────────────────

def _zip_read_text(zf, file_path, encoding='utf-8'):
    """从 ZIP 中读取文本文件"""
    try:
        with zf.open(file_path) as f:
            raw = f.read()
            # 尝试 UTF-8，回退到 GBK
            try:
                return raw.decode(encoding)
            except UnicodeDecodeError:
                return raw.decode('gbk', errors='replace')
    except (KeyError, FileNotFoundError):
        return ''


def _zip_extract_image(zf, img_path, output_dir, output_name):
    """从 ZIP 中提取图片文件到 output_dir/images/"""
    try:
        with zf.open(img_path) as f:
            img_data = f.read()
        images_dir = os.path.join(output_dir, 'images')
        os.makedirs(images_dir, exist_ok=True)
        out_path = os.path.join(images_dir, output_name)
        with open(out_path, 'wb') as f:
            f.write(img_data)
        return 'images/' + output_name
    except (KeyError, FileNotFoundError):
        return ''


# ── 复制标语诗歌图片 ────────────────────────────────────────────────────

def copy_motto_song_images(src_folder, dst_output_dir):
    """复制批次文件夹中的标语诗歌图片"""
    images = []
    if not os.path.isdir(src_folder):
        return images

    for fname in sorted(os.listdir(src_folder)):
        if re.match(r'^标语诗歌', fname) and re.search(r'\.(png|jpe?g|webp|gif)$', fname, re.I):
            src = os.path.join(src_folder, fname)
            img_dir = os.path.join(dst_output_dir, 'images')
            os.makedirs(img_dir, exist_ok=True)
            dst = os.path.join(img_dir, fname)
            shutil.copy2(src, dst)
            images.append('images/' + fname)

    return images


# ── 主解析逻辑 ──────────────────────────────────────────────────────────
# 对照 epub-importer.js: parseAndSave() + parseChapterFromZip()

def parse_chapter_from_zip(zf, epub, entry, idx):
    """解析单个篇章的所有子页面"""
    opf_dir = epub['opfDir']
    links = entry.get('links', {})
    msg_num = entry.get('number', idx + 1)

    # 1. 纲目：优先 _cv.htm > _dg.htm
    outline_sections = []
    scripture = ''
    if links.get('cv'):
        cv_html = _zip_read_text(zf, opf_dir + links['cv'])
        if cv_html:
            doc = parse_html(cv_html)
            outline_sections = parse_outline_from_html(doc)
            scripture = extract_scripture(doc)
    elif links.get('dg'):
        dg_html = _zip_read_text(zf, opf_dir + links['dg'])
        if dg_html:
            doc = parse_html(dg_html)
            outline_sections = parse_outline_from_html(doc)

    # 2. 听抄
    detail_sections = []
    message_content = []
    ministry_excerpt = ''
    if links.get('ts'):
        ts_html = _zip_read_text(zf, opf_dir + links['ts'])
        if ts_html:
            result = parse_transcript_from_html(parse_html(ts_html), outline_sections)
            detail_sections = result['detailSections']
            message_content = result['messageContent']
            ministry_excerpt = result['ministryExcerpt']

    # 3. 晨兴：6 天
    morning_revivals = []
    day_cns = ['一', '二', '三', '四', '五', '六']
    if links.get('h'):
        for d_idx, day_cn in enumerate(day_cns):
            day_label = '周{}'.format(day_cn)
            h_file = '{}_h_{}.htm'.format(msg_num, d_idx + 1)
            h_html = _zip_read_text(zf, opf_dir + h_file)
            if h_html:
                mr = parse_morning_revival_from_html(parse_html(h_html), day_label)
                if mr:
                    morning_revivals.append(mr)

    # 4. 诗歌
    hymn_number = ''
    hymn_image = ''
    hymn_lyrics = []
    hymn_file = '{}_h_hymn.htm'.format(msg_num)
    hymn_html = _zip_read_text(zf, opf_dir + hymn_file)
    if hymn_html:
        hymn_info = parse_hymn_from_html(parse_html(hymn_html), msg_num)
        hymn_number = hymn_info['hymnNumber']
        hymn_image = hymn_info['hymnImage']
        hymn_lyrics = hymn_info.get('hymnLyrics', [])

    # 诗歌图片从 EPUB ZIP 中提取到 output/images/
    # 注意：此处无法访问 output_dir，由调用方 build_training_from_epub() 统一提取

    # 若无听抄 detailSections，则用 outlineSections 作为 detail
    has_listen_block = bool(detail_sections)  # 听抄是否真正解析到内容
    if not detail_sections:
        detail_sections = outline_sections

    return {
        'number': msg_num,
        'title': entry.get('title', ''),
        'hymn_number': hymn_number,
        'hymn_image': hymn_image,
        'hymn_images': [],
        'hymn_lyrics': hymn_lyrics,
        'scripture': scripture,
        'outline_sections': outline_sections,
        'detail_sections': detail_sections,
        'message_content': message_content,
        'has_listen_block': has_listen_block,
        'ministry_excerpt': ministry_excerpt,
        'morning_revivals': morning_revivals
    }


def build_training_from_epub(epub_path, batch_folder, output_dir, opt_year=None, opt_season=None):
    """
    从 EPUB 文件构建训练数据。
    返回 (training_data_dict, metadata_dict)
    """
    filename = os.path.basename(epub_path)

    with zipfile.ZipFile(epub_path, 'r') as zf:
        # 1. 解析 EPUB 结构
        epub = parse_epub_structure(zf)

        # 2. 读取目录 (index.html)
        index_html = _zip_read_text(zf, epub['opfDir'] + 'index.html')
        if not index_html:
            raise RuntimeError('找不到目录文件 (index.html)')

        index_doc = parse_html(index_html)
        toc_entries = parse_toc_from_html(index_doc)

        # 3. 读取标语 (banner.html)
        banner_html = _zip_read_text(zf, epub['opfDir'] + 'banner.html')
        mottos = []
        if banner_html:
            mottos = parse_mottos_from_html(parse_html(banner_html))

        # 4. 提取训练标题
        meta_title = epub['metadata']['title'] or re.sub(r'\.epub$', '', filename, flags=re.I)
        h1_el = index_doc.query_selector(
            lambda el: 'calibre_index_title1' in el.get('class', '').split() or el.tag.lower() == 'h1'
        )
        if h1_el:
            h1_text = h1_el.get_text().strip()
            if h1_text:
                meta_title = h1_text

        # 5. 提取年份和序号
        year = extract_year_from_title(meta_title) or extract_year_from_title(filename) or datetime.now().year
        seq = extract_seq_from_filename(filename) or extract_seq_from_title(meta_title) or 1

        # 6. 确定训练 path 和 season
        seq_str = '{:02d}'.format(seq)
        path = 'local-{}-{}'.format(year, seq_str)
        short_title = get_short_title(meta_title)
        season = '{} {}'.format(seq_str, short_title)

        # 7. 解析各篇章
        chapters = []
        for idx, entry in enumerate(toc_entries):
            chapter = parse_chapter_from_zip(zf, epub, entry, idx)
            if chapter:
                chapters.append(chapter)

        # 8. 提取副标题
        subtitle = extract_subtitle(index_doc) or epub['metadata'].get('subject', '')

    # 覆盖 year/season（从命令行参数）
    if opt_year:
        year = opt_year
    if opt_season:
        season = opt_season

    # 9. 构建训练对象
    training_data = {
        'path': path,
        'title': short_title,
        'subtitle': subtitle,
        'year': year,
        'season': season,
        'mottos': mottos,
        'motto_song_text': '',
        'motto_song_image': '',
        'chapters': chapters,
        'version': get_now_version()
    }

    # 10. 复制标语诗歌图片（从批次文件夹）
    os.makedirs(output_dir, exist_ok=True)
    motto_images = copy_motto_song_images(batch_folder, output_dir)
    if motto_images:
        training_data['motto_song_image'] = motto_images[0]
        training_data['motto_song_images'] = motto_images

    # 11. 提取 EPUB 内的诗歌图片到 output/images/，同时填充 hymn_images
    with zipfile.ZipFile(epub_path, 'r') as zf:
        for ch in training_data.get('chapters', []):
            if ch.get('hymn_image'):
                # hymn_image 格式为 "images/{N}_hymn.png"，但 EPUB 内路径为 "{opfDir}{N}_hymn.png"
                img_filename = os.path.basename(ch['hymn_image'])  # "1_hymn.png"
                img_path = epub['opfDir'] + img_filename           # "OPS/1_hymn.png"
                saved = _zip_extract_image(zf, img_path, output_dir, img_filename)
                if saved:
                    ch['hymn_images'] = [saved]

    # 12. 规范化出处缩写
    _normalize_training(training_data)

    return training_data


def _normalize_training(td):
    """规范化出处缩写（与 build-batch-txt.js 一致）"""
    td_json = json.dumps(td, ensure_ascii=False)
    td_json = td_json.replace('李常受文集', 'CWWL').replace('生命读经', 'L-S')
    # 反序列化回对象
    td.update(json.loads(td_json))


# ── 富化（调用 Node.js）─────────────────────────────────────────────────

def enrich_training_json(output_dir):
    """
    调用 Node.js 脚本对 training.json 进行晨兴富化（feeding_refs 等）。
    使用 tools/enrich-training.js。
    """
    enrich_script = os.path.join(os.path.dirname(__file__), 'enrich-training.js')
    if not os.path.exists(enrich_script):
        print('[EPUB] 跳过富化（enrich-training.js 不存在）', file=sys.stderr)
        return False

    training_json_path = os.path.join(output_dir, 'training.json')
    if not os.path.exists(training_json_path):
        return False

    try:
        result = subprocess.run(
            ['node', enrich_script, '--input', training_json_path],
            capture_output=True, text=True, encoding='utf-8', errors='replace',
            timeout=60
        )
        if result.returncode == 0:
            print('[EPUB] 富化完成', file=sys.stderr)
            return True
        else:
            print('[EPUB] 富化失败 (exit {}): {}'.format(result.returncode, result.stderr[:200]), file=sys.stderr)
            return False
    except Exception as e:
        print('[EPUB] 富化异常: {}'.format(e), file=sys.stderr)
        return False


# ── 主函数 ──────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='从 EPUB 文件生成 training.json')
    parser.add_argument('--epub', required=True, help='EPUB 文件路径')
    parser.add_argument('--folder', required=True, help='批次文件夹路径')
    parser.add_argument('--output', required=True, help='输出目录')
    parser.add_argument('--year', type=int, default=None, help='年份覆盖')
    parser.add_argument('--season', type=str, default=None, help='季节覆盖')
    args = parser.parse_args()

    if not os.path.exists(args.epub):
        print('EPUB 文件不存在: {}'.format(args.epub), file=sys.stderr)
        sys.exit(1)

    print('[EPUB] 使用文件: {}'.format(os.path.basename(args.epub)), file=sys.stderr)

    # 构建训练数据
    td = build_training_from_epub(
        args.epub, args.folder, args.output,
        opt_year=args.year, opt_season=args.season
    )

    # 写出 training.json
    json_path = os.path.join(args.output, 'training.json')
    json_text = json.dumps(td, ensure_ascii=False, indent=2)
    with open(json_path, 'w', encoding='utf-8') as f:
        f.write(json_text)
    print('[EPUB] training.json 已写出 ({} 篇章)'.format(len(td.get('chapters', []))), file=sys.stderr)

    # 富化（调用 Node.js）
    enrich_training_json(args.output)

    # 输出元数据 JSON 到 stdout（供 Python main.py 读取）
    meta = {
        'name': os.path.basename(args.folder),
        'year': td['year'],
        'season': td['season'],
        'title': td.get('title', ''),
        'subtitle': td.get('subtitle', ''),
        'chapter_count': len(td.get('chapters', [])),
        'images': td.get('motto_song_images', []),
        'version': td.get('version', ''),
        'source': 'epub'
    }
    sys.stdout.write(json.dumps(meta, ensure_ascii=False))


if __name__ == '__main__':
    main()
