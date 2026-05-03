#!/usr/bin/env python3
from __future__ import annotations
"""
解析 97-25-特会合辑.txt，识别每个训练/特会。

两种模式（--mode）：
  txt  — 按年份拆分为独立 txt 文件到 resource/历史合辑/{year}/（原有逻辑）
  json — 解析为 training.json + js/scriptures-data.json，输出到 output/{year}-{seq:02d}/
  both — 同时执行两种模式

文件结构：
  - 索引区（index section）：行 1 ~ DETAIL_START，每个训练标题/总题/消息列表
  - 详细区（detail section）：行 DETAIL_START+1 ~ 末尾，每篇的完整大纲
"""

import argparse
import json
import os
import re
import sys
import unicodedata

# 加入 src/ 到模块搜索路径，以便导入 models
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))
from models import Content, Chapter, TrainingData, MorningRevival  # noqa: E402

INPUT_FILE = "../resource/历史合辑/97-25-特会合辑.txt"
OUTPUT_DIR = "../resource/历史合辑"
OUTPUT_BASE = "../output"

# 大合辑文件的详细内容区起始行（0-based）
DETAIL_START = 7861


def detect_detail_start(lines: list) -> int:
    """检测单训练文件里详细内容区的起始行（0-based）。

    支持两种分隔格式：
      (1) ─{20,}\n详细信息\n─{20,}  → 返回第三行后位置
      (2) TOP-目录                  → 返回下一行
    若无分隔符则返回 len(lines)（无详细区）。
    """
    n = len(lines)
    for i, line in enumerate(lines):
        s = line.strip()
        if re.match(r'^─{20,}$', s):
            if i + 1 < n and '详细信息' in lines[i + 1]:
                return min(i + 3, n)
        if s == 'TOP-目录':
            return i + 1
    return n


def collect_src_files() -> list:
    """收集所有待处理的 txt 源文件。

    返回 [(filepath, detail_start_or_None), ...]
      - detail_start=DETAIL_START  → 大合辑文件（固定）
      - detail_start=None          → 单训练文件（调用 detect_detail_start 动态检测）
    """
    base = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), OUTPUT_DIR))
    big  = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), INPUT_FILE))

    sources = []

    # 1. 大合辑文件（若存在）
    if os.path.exists(big):
        sources.append((big, DETAIL_START))

    # 2. 根目录下其他 .txt（排除大合辑自身 和 part-* 原始分片）
    if os.path.isdir(base):
        for fn in sorted(os.listdir(base)):
            if not fn.endswith('.txt'):
                continue
            fp = os.path.join(base, fn)
            if fp == big:
                continue
            if fn.lower().startswith('part-'):
                continue  # 旧原始分片，跳过
            sources.append((fp, None))

    # 3. 年份子目录下的 .txt（始终包含，为大合辑中缺失的晨兴内容提供补充）
    #    大合辑只含大纲，年份子目录文件含完整晨兴，处理顺序保证年份文件覆盖大合辑输出。
    if os.path.isdir(base):
        for entry in sorted(os.listdir(base)):
            sub = os.path.join(base, entry)
            if not os.path.isdir(sub):
                continue
            for fn in sorted(os.listdir(sub)):
                if fn.endswith('.txt'):
                    sources.append((os.path.join(sub, fn), None))

    return sources

# 中文数字 -> 阿拉伯数字
CN_DIGIT = {
    '一': '1', '二': '2', '三': '3', '四': '4', '五': '5',
    '六': '6', '七': '7', '八': '8', '九': '9',
    '○': '0', '〇': '0', '零': '0', '两': '2',
}

# 各种破折号统一为 U+2500，用于模糊标题匹配
DASH_NORM_TABLE = str.maketrans('—–－', '───')

# 用于 fuzzy key 的标点去除表
_PUNC_REMOVE = dict.fromkeys(
    i for i in range(0x10000)
    if unicodedata.category(chr(i)).startswith('P') or chr(i) in '　 ，、。；：'
)

# ─────────────────────────────────────────────────────────────────────────────
# 中文大纲层级检测
# ─────────────────────────────────────────────────────────────────────────────

_LEVEL1_CHARS = set('壹贰叁肆伍陆柒捌玖拾')
_LEVEL2_CHARS = set('一二三四五六七八九十')
_LEVEL3_FULLWIDTH = set('１２３４５６７８９０')
_LEVEL4_CHARS = set('甲乙丙丁戊')
_LEVEL5_CHARS = set('㈠㈡㈢㈣㈤㈥㈦㈧㈨㈩')  # U+3220-U+3229 圆括号汉字

# 识别书卷+章节经文引用行（用于提取内联经文文本）
_VERSE_KEY_RE = re.compile(
    r'^([创出利民申书士得撒王代拉尼斯伯诗箴传歌赛耶哀结但何珥摩俄拿弥鸿哈番该亚玛'
    r'太可路约徒罗林加弗腓西帖提门多彼约犹启来]'
    r'(?:[一二三四五六七八九十后前上下壹贰叁]\d+|\d+):\d+[上下]?)\s*$'
)

# 匹配 "第X篇" 标题（含汉字序数）用于切篇
_MSG_NUM_MAP = {
    '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
    '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
    '十一': 11, '十二': 12, '十三': 13, '十四': 14, '十五': 15,
    '十六': 16, '十七': 17, '十八': 18, '十九': 19, '二十': 20,
}

# 个位数字（用于复合数的计算）
_CN_DIGITS = {'一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
              '六': 6, '七': 7, '八': 8, '九': 9}


def _cn_ord_to_int(cn: str) -> int:
    """将汉字序数（如 一、十一、二十、三十七）转为整数，未知返回 0。

    支持 1-99 范围内的复合序数（如 三十七 = 37）。
    """
    if not cn:
        return 0
    if cn in _MSG_NUM_MAP:
        return _MSG_NUM_MAP[cn]
    # 处理复合数：X十Y  (如 三十七, 二十一, 三十)
    if '十' in cn:
        parts = cn.split('十', 1)
        tens = _CN_DIGITS.get(parts[0], 1) * 10 if parts[0] else 10
        units = _CN_DIGITS.get(parts[1], 0) if len(parts) > 1 and parts[1] else 0
        return tens + units
    return _CN_DIGITS.get(cn, 0)


# 详细区中每篇的 header 格式：第一篇 / 第十一篇 等（仅匹配 篇，不匹配 周）
_MSG_HEADER_FULL_RE = re.compile(
    r'^第([一二三四五六七八九十]+)[篇周]\s*(.*)'
)


def _detect_outline_level(line: str):
    """检测行的大纲层级，返回 (level_str, rest_title) 或 None。"""
    s = line.strip()
    if not s:
        return None

    # Level 1: 壹贰叁...
    if s[0] in _LEVEL1_CHARS:
        rest = s[1:].lstrip('\u3000 \t')
        return (s[0], rest)

    # Level 2: 一二三...（需排除年份行、日期等）
    if s[0] in _LEVEL2_CHARS:
        # 避免把 "一九九七年..." 之类的年份行识别为 Level 2
        if re.match(r'^[一二三四五六七八九○〇零]{4}年', s):
            return None
        rest = s[1:].lstrip('\u3000 \t')
        return (s[0], rest)

    # Level 3: 全角数字 １２３ 或 "1. 2. 3." 格式
    if s[0] in _LEVEL3_FULLWIDTH:
        rest = s[1:].lstrip('\u3000 \t')
        return (s[0], rest)
    m = re.match(r'^(\d+)[\.。]\s*(.*)', s)
    if m:
        return (m.group(1), m.group(2))
    # 数字 + 全角空格（如 "1\u3000text"）
    m2 = re.match(r'^(\d+)\u3000(.*)', s)
    if m2:
        return (m2.group(1), m2.group(2))

    # Level 4: 甲乙丙丁 或 a.b.c.
    if s[0] in _LEVEL4_CHARS:
        rest = s[1:].lstrip('\u3000 \t')
        return (s[0], rest)
    m = re.match(r'^([a-z])[\.。]\s*(.*)', s)
    if m:
        return (m.group(1), m.group(2))

    # Level 5: 圆括号汉字 ㈠㈡㈢㈣㈤㈥㈦㈧㈨㈩
    if s[0] in _LEVEL5_CHARS:
        rest = s[1:].lstrip('\u3000 \t')
        return (s[0], rest)

    return None


def _level_rank(level_str: str) -> int:
    """返回层级的数值深度（越大越深）。"""
    if level_str in _LEVEL1_CHARS:
        return 1
    if level_str in _LEVEL2_CHARS:
        return 2
    if level_str in _LEVEL3_FULLWIDTH or (level_str.isdigit()):
        return 3
    if level_str in _LEVEL5_CHARS:
        return 5
    return 4  # 甲乙 / a b c


# ─────────────────────────────────────────────────────────────────────────────
# Phase 2: 中文大纲解析
# ─────────────────────────────────────────────────────────────────────────────

def parse_cn_outline(lines: list) -> list:
    """将纲目文本行列表解析为 Content 树。

    只处理中文层级纲目（壹→一→１→甲/a），跳过导航行和 TOP 系列。
    """
    roots = []           # 顶层节点列表
    stack = []           # [(rank, Content)]，压栈维护层级

    def current_parent():
        return stack[-1][1] if stack else None

    def append_node(node: Content, rank: int):
        # pop 超过当前 rank 的节点
        while stack and stack[-1][0] >= rank:
            stack.pop()
        if stack:
            stack[-1][1].children.append(node)
        else:
            roots.append(node)
        stack.append((rank, node))

    current_node = None  # 最近一个节点（追加 content 用）

    for raw in lines:
        line = raw.rstrip('\n')
        stripped = line.strip()

        # 空行：跳过
        if not stripped:
            continue

        # 停止标记
        if stripped.startswith('TOP') or stripped == '─' * 10 or '详细信息' in stripped:
            break

        # 导航行（含 | 的短行，通常 < 40 字符）
        if '|' in stripped and len(stripped) < 60:
            continue
        if '＼' in stripped and len(stripped) < 60:
            continue
        # 英文大纲块
        if stripped.startswith('GENERAL SUBJECT') or re.match(r'^Message (One|Two|Three)', stripped):
            break

        result = _detect_outline_level(stripped)
        if result:
            level_str, title = result
            rank = _level_rank(level_str)
            node = Content(level=level_str, title=title)
            append_node(node, rank)
            current_node = node
        else:
            # 非层级行 → 追加到最近节点的 content
            if current_node is not None:
                current_node.content.append(stripped)
            # 如果还没有节点（起始 TOP 语 / 附记等），忽略

    return roots


# ─────────────────────────────────────────────────────────────────────────────
# Phase 2b: 听抄块解析（严格层级检测）
# ─────────────────────────────────────────────────────────────────────────────

def _detect_outline_level_strict(s: str):
    """严格版层级检测：壹/一 等层级字后必须跟 \u3000 或空格才视为层级标记。

    防止把"四重的负担"、"一旦我们..."等普通词句误识别为大纲层级节点。
    用于解析 听抄 块（msg_content block），避免散文里的误匹配。
    """
    if not s:
        return None
    c0 = s[0]
    sep = s[1] if len(s) > 1 else ''

    # Level 1: 壹贰叁... + \u3000/空格
    if c0 in _LEVEL1_CHARS:
        if sep in ('\u3000', ' ', '\t'):
            return (c0, s[2:].strip())
        return None

    # Level 2: 一二三... + \u3000/空格（排除年份行）
    if c0 in _LEVEL2_CHARS:
        if re.match(r'^[一二三四五六七八九○〇零]{4}年', s):
            return None
        if sep in ('\u3000', ' ', '\t'):
            return (c0, s[2:].strip())
        return None

    # Level 3: 全角数字 １２３...
    if c0 in _LEVEL3_FULLWIDTH:
        rest = s[1:].lstrip('\u3000 \t')
        return (c0, rest)

    # Level 3: "1." / "12." 格式（需至少一个空格）
    m = re.match(r'^(\d+)[\.。]\s+(.*)', s)
    if m:
        return (m.group(1), m.group(2))
    # Level 3: 数字 + 全角空格（如 "1\u3000text"）
    m2 = re.match(r'^(\d+)\u3000(.*)', s)
    if m2:
        return (m2.group(1), m2.group(2))

    # Level 4: lowercase "a." / "a\u3000" 格式
    if c0.islower() and c0.isalpha():
        if sep in ('\u3000', ' ', '\t'):
            return (c0, s[2:].strip())
        m2 = re.match(r'^([a-z])\.\s+(.*)', s)
        if m2:
            return (m2.group(1), m2.group(2))

    # Level 5: 圆括号汉字 ㈠㈡㈢...
    if c0 in _LEVEL5_CHARS:
        rest = s[1:].lstrip('\u3000 \t')
        return (c0, rest)

    return None


def parse_listen_txt(blines: list) -> tuple:
    """用严格层级检测解析 听抄（message_content）块，同时收集各级内容段落。

    与 parse_cn_outline 的区别：
    - 使用 _detect_outline_level_strict（要求分隔符），防止散文误识别
    - 层级节点之后的非层级行作为该节点的 content 段落
    - 层级节点之前的非层级行作为 pre_section 散文（通常是开头祷告/简介）

    Returns:
        (pre_section_paras, detail_roots)
        - pre_section_paras: 第一个层级节点前的散文行列表
        - detail_roots: Content 树（层级节点 + 其内容段落）
    """
    roots: list = []
    stack: list = []      # [(rank, Content)]
    pre_section: list = []
    current_node = None

    def append_node(node: Content, rank: int):
        while stack and stack[-1][0] >= rank:
            stack.pop()
        if stack:
            stack[-1][1].children.append(node)
        else:
            roots.append(node)
        stack.append((rank, node))

    for raw in blines:
        stripped = raw.rstrip('\n').strip()
        if not stripped:
            continue
        if stripped.startswith('TOP') or _is_nav_line(stripped):
            continue
        if '（本文为英文听抄' in stripped:
            continue

        result = _detect_outline_level_strict(stripped)
        if result:
            level_str, title = result
            rank = _level_rank(level_str)
            node = Content(level=level_str, title=title)
            append_node(node, rank)
            current_node = node
        else:
            if current_node is not None:
                current_node.content.append(stripped)
            else:
                pre_section.append(stripped)

    return (pre_section, roots)


# ─────────────────────────────────────────────────────────────────────────────
# Phase 3: 单篇解析
# ─────────────────────────────────────────────────────────────────────────────

def _is_nav_line(s: str) -> bool:
    """判断是否为导航行（含 | 或 ＼ 的短行）。"""
    return ('|' in s or '＼' in s) and len(s) < 80


def _split_into_blocks(detail_lines: list) -> list:
    """将详细区的行按 TOP / TOP-... 切分为块列表。

    每个块结构：{'nav': str|None, 'lines': [...]}
    nav 是块首的导航行（如 '大纲|Outline|对照-听抄-目录'）。
    """
    blocks = []
    current_nav = None
    current_lines = []

    for raw in detail_lines:
        s = raw.rstrip('\n').strip()

        if re.match(r'^TOP', s):
            # 保存当前块
            if current_nav is not None or current_lines:
                blocks.append({'nav': current_nav, 'lines': current_lines})
            current_nav = None
            current_lines = []
            continue

        if _is_nav_line(s):
            # 导航行：作为下一块的 nav
            if current_nav is not None or current_lines:
                blocks.append({'nav': current_nav, 'lines': current_lines})
            current_nav = s
            current_lines = []
            continue

        current_lines.append(raw)

    if current_nav is not None or current_lines:
        blocks.append({'nav': current_nav, 'lines': current_lines})

    return blocks


def _classify_block(nav: str, lines: list) -> str:
    """根据导航行内容判断块类型。

    返回：'cn_outline' | 'message_content' | 'skip'
    """
    if nav is None:
        # 无导航行的块：可能是标语或序文
        return 'skip'

    nav_lower = nav.lower()

    # 中文大纲块：nav 含 "大纲"（1997格式: "大纲|Outline|..." / 2014+格式: "晨兴-大纲|Outline|..."）
    # "大纲" 在任何格式中都是中文大纲块的标志，优先于 听抄/对照 检查
    if '大纲' in nav:
        return 'cn_outline'

    # 老格式（2001 等）：第一段为 '纲目'（不带 '晨兴-' 前缀）也视为大纲块
    _nav_first_seg = nav.split('|')[0].strip()
    if _nav_first_seg == '纲目' or _nav_first_seg.endswith('-纲目') and '晨兴' not in _nav_first_seg:
        return 'cn_outline'

    # 英文大纲（GENERAL SUBJECT 前置块）
    if not nav:
        return 'skip'

    # nav 的结构是"我能跳到哪里"的链接列表：
    #   对照区 nav: '纲目|outline-听抄-目录'  —— 链接里有 听抄，本块是对照 → skip
    #   听抄区 nav: '纲目|Outline|对照-目录'  —— 链接里有 对照，本块是听抄 → message_content

    # 对照块：nav 含 "听抄" 作为链接 → 本块是对照（中英逐行），skip
    if '听抄' in nav:
        return 'skip'

    # 听抄块：nav 含 "对照" 但不含 "听抄" → 本块是听抄/消息全文
    if '对照' in nav and '听抄' not in nav:
        return 'message_content'

    return 'skip'


def _split_at_level(prose_paras: list, nodes: list) -> list:
    """将散文按 nodes 的标题列表做单层拆分，返回 [(node_or_None, [paras])] 列表。

    node_or_None == None 表示第一个标题匹配之前的前言段落。
    匹配条件：去标点后，段落起始与标题键互为前缀，重叠长度 >= 8 字。
    """
    keyed = []
    for node in nodes:
        if node.title:
            key = node.title.translate(_PUNC_REMOVE)[:12]
            if key and len(key) >= 4:
                keyed.append((key, node))

    if not keyed:
        return [(None, list(prose_paras))]

    sections: list = []
    cur_node = None
    cur_paras: list = []
    remaining = list(keyed)

    for para in prose_paras:
        para_key = para.translate(_PUNC_REMOVE)
        if remaining:
            next_key, next_node = remaining[0]
            match_len = min(len(para_key), len(next_key))
            if match_len >= 8 and para_key[:match_len] == next_key[:match_len]:
                sections.append((cur_node, cur_paras))
                cur_node = next_node
                cur_paras = []
                remaining.pop(0)
                continue
        cur_paras.append(para)

    sections.append((cur_node, cur_paras))
    return sections


def _split_prose_by_outline(prose_paras: list, outline_roots: list) -> list:
    """将散文段落按大纲完整树结构逐层递归拆分为 Content 节点。

    策略：
    1. 先用当前层节点的标题做单层拆分（_split_at_level），将全部散文分成若干桶
    2. 对每个桶，若该节点有子节点，则递归用子节点标题再拆该桶
    3. 前言桶（匹配前的段落）作为空层级 Content 节点

    逐层拆分避免了 DFS 展平时"深层未匹配节点阻塞同级后续节点"的问题。
    """
    if not outline_roots:
        return [Content(level='', title='', content=list(prose_paras))]

    # 单层拆分
    sections = _split_at_level(prose_paras, outline_roots)

    # 检查是否有任何有效匹配（忽略最前面的空前言）
    has_match = any(node is not None for node, _ in sections)
    if not has_match:
        return [Content(level='', title='', content=list(prose_paras))]

    result: list = []
    for node, paras in sections:
        if node is None:
            # 前言段落
            if paras:
                result.append(Content(level='', title='', content=paras))
            continue

        if node.children and paras:
            # 递归拆分子节点
            child_results = _split_prose_by_outline(paras, node.children)
            # 将首个空层级节点的内容提升为本节点的 content（该节点自身的段落）
            intro: list = []
            structured: list = []
            for cr in child_results:
                if not cr.level and not structured:
                    intro.extend(cr.content)
                else:
                    structured.append(cr)
            result.append(Content(
                level=node.level,
                title=node.title,
                children=structured,
                content=intro,
            ))
        else:
            result.append(Content(
                level=node.level,
                title=node.title,
                children=[Content(level=c.level, title=c.title,
                                  children=c.children, content=c.content)
                          for c in node.children],
                content=paras,
            ))

    return result


def parse_one_message(header_line: str, detail_lines: list) -> tuple:
    """解析单篇信息，返回 (Chapter, verse_dict)。

    header_line: "第一篇　标题文字"
    detail_lines: 该篇对应的详细内容行列表
    verse_dict: {经文key: 经文文本}（来自 2024 格式内联经文）
    """
    # 提取篇号和标题
    m = _MSG_HEADER_FULL_RE.match(header_line.strip())
    if m:
        number = _cn_ord_to_int(m.group(1))
        title = m.group(2).strip()
    else:
        number = 0
        title = header_line.strip()

    # 读取经文引用 & 诗歌编号（两者都出现在 detail_lines 前20行）
    scripture = ''
    hymn_number = ''
    for raw in detail_lines[:20]:
        s = raw.strip()
        # 处理各种 读经 后接方式：全角：、全角∶(ratio U+2236)、ASCII:、或直接接经文
        if s.startswith('读经'):
            rest = s[2:]
            if rest and rest[0] in '：:∶':
                rest = rest[1:]
            rest = rest.strip()
            if rest:
                scripture = rest
        # 诗歌行：诗歌：xxx / 诗歌∶xxx / 诗歌xxx
        elif s.startswith('诗歌') and not hymn_number:
            rest = s[2:]
            if rest and rest[0] in '：:∶':
                rest = rest[1:]
            hymn_number = rest.strip() or s

    blocks = _split_into_blocks(detail_lines)

    outline_sections = []
    detail_sections: list = []
    detail_sections_built = False
    message_content = []
    verse_dict = {}
    has_cn_outline = False

    # 检测格式：若所有块都没有含 | 的 nav → 2024 格式
    has_pipe_nav = any(b['nav'] and '|' in b['nav'] for b in blocks)

    if not has_pipe_nav:
        # 2024 格式：纲目和内联经文交织，用专用解析器扫描全部行
        outline_sections = parse_cn_outline_2024(detail_lines, verse_dict)
        detail_sections = outline_sections
        detail_sections_built = True
        # 2024 格式无独立听抄块，message_content 留空
    else:
        # 老格式（1997-2023）：按块分类解析
        for block in blocks:
            nav = block['nav'] or ''
            blines = block['lines']
            btype = _classify_block(nav, blines)

            if btype == 'cn_outline' and not has_cn_outline:
                nodes = parse_cn_outline(blines)
                if nodes:
                    outline_sections = nodes
                    has_cn_outline = True
                # 顺带收集 2024 格式内联经文（如有）
                _collect_inline_verses(blines, verse_dict)

            elif btype == 'message_content' and not detail_sections_built:
                # 用严格层级检测解析听抄块，构建结构化 detail_sections
                pre_paras, listen_roots = parse_listen_txt(blines)
                if listen_roots and not _is_english_block([n.title for n in listen_roots[:2]]):
                    # 有结构（壹\u3000 等标记）→ 作为 detail_sections
                    detail_sections = listen_roots
                    detail_sections_built = True
                    # 第一个层级节点前的散文（开头祷告等）→ message_content
                    message_content = [p for p in pre_paras if p.strip()]
                elif pre_paras and not _is_english_block(pre_paras):
                    # 纯散文块：包装为单个空层级 Content 节点，确保 ts 视图有内容
                    all_paras = [p for p in pre_paras if p.strip()]
                    if all_paras:
                        detail_sections = [Content(level='', title='', content=all_paras)]
                        detail_sections_built = True
                        message_content = []

    # 后处理：若 detail_sections 是单个空层级节点（纯散文），尝试按大纲标题拆分
    if (detail_sections_built
            and len(detail_sections) == 1
            and not detail_sections[0].level
            and outline_sections):
        split = _split_prose_by_outline(detail_sections[0].content, outline_sections)
        if len(split) > 1 or (split and split[0].level):
            detail_sections = split

    chapter = Chapter(
        number=number,
        title=title,
        scripture=scripture,
        hymn_number=hymn_number,
        outline_sections=outline_sections,
        detail_sections=detail_sections if detail_sections_built else outline_sections,
        message_content=message_content,
        morning_revivals=[],
    )
    return chapter, verse_dict


def parse_cn_outline_2024(lines: list, verse_dict: dict) -> list:
    """2024 格式：扫描所有行构建大纲树，同时收集内联经文。

    特点：每条纲目项独立占块（以 TOP-纲目-目录 分隔），同一条目出现两次
    （摘要版含 ─引用经文 后缀 + 展开，详细版无后缀含内联经文），用 fuzzy_key 去重。
    """
    roots = []
    stack = []
    seen_items: set = set()  # (rank, fuzzy_key)
    skip_verse_text = False  # 跳过紧跟在 verse key 后的经文文本

    def append_node(node: Content, rank: int):
        while stack and stack[-1][0] >= rank:
            stack.pop()
        if stack:
            stack[-1][1].children.append(node)
        else:
            roots.append(node)
        stack.append((rank, node))

    prev_verse_key = None

    for raw in lines:
        s = raw.rstrip('\n').strip()
        if not s:
            prev_verse_key = None
            continue

        # 跳过分隔符、节标记
        if s.startswith('TOP') or s == '展开':
            prev_verse_key = None
            continue

        # 章节分隔线
        if re.match(r'^─{10,}', s) or '详细信息' in s:
            break

        # 晨兴/每日内容区——不属于纲目，停止解析
        if s in ('晨兴喂养', '信息选读') or s.startswith('参读'):
            break
        if _DAY_BLOCK_HDR_RE.match(s):
            break

        # 导航行（含 | 的短行）
        if _is_nav_line(s):
            prev_verse_key = None
            continue

        # 重复的篇章 header
        if _MSG_HEADER_FULL_RE.match(s):
            prev_verse_key = None
            continue

        # 读经行 → scripture 已在 parse_one_message 提取，跳过
        if s.startswith('读经'):
            prev_verse_key = None
            continue

        # 经文 key 行
        vm = _VERSE_KEY_RE.match(s)
        if vm:
            prev_verse_key = vm.group(1)
            continue

        # 经文文本行（紧跟在 verse key 后）
        if prev_verse_key is not None:
            if prev_verse_key not in verse_dict:
                verse_dict[prev_verse_key] = s
            prev_verse_key = None
            continue

        prev_verse_key = None

        # 去除 ─引用经文 摘要后缀
        clean = s
        if '─引用经文' in clean:
            clean = clean[:clean.rfind('─引用经文')].rstrip()
        if not clean:
            continue

        result = _detect_outline_level(clean)
        if result:
            level_str, title = result
            rank = _level_rank(level_str)
            fk = fuzzy_key(title)
            dedup_key = (rank, fk[:20])  # (层级, 前20字符) 去重
            if dedup_key in seen_items:
                continue
            seen_items.add(dedup_key)
            node = Content(level=level_str, title=title)
            append_node(node, rank)

    return roots


def _collect_inline_verses(lines: list, verse_dict: dict):
    """收集 2024 格式中紧跟纲目条目之后的内联经文（书名章节行 + 下一行经文文本）。"""
    prev_key = None
    for raw in lines:
        s = raw.strip()
        if not s:
            prev_key = None
            continue
        m = _VERSE_KEY_RE.match(s)
        if m:
            prev_key = m.group(1)
        elif prev_key is not None:
            # 当前行是经文文本
            if prev_key not in verse_dict:
                verse_dict[prev_key] = s
            prev_key = None
        else:
            prev_key = None


def _merge_paragraphs(lines: list) -> list:
    """将行列表合并为段落列表（空行分隔）。"""
    paragraphs = []
    current = []
    for l in lines:
        if l == '':
            if current:
                paragraphs.append(' '.join(current))
                current = []
        else:
            current.append(l)
    if current:
        paragraphs.append(' '.join(current))
    return [p for p in paragraphs if p.strip()]


def _is_english_block(paras: list) -> bool:
    """粗略判断段落列表是否主要为英文内容。"""
    if not paras:
        return False
    sample = ' '.join(paras[:3])
    # 统计 ASCII 字母比例
    ascii_count = sum(1 for c in sample if c.isascii() and c.isalpha())
    total = sum(1 for c in sample if c.isalpha())
    if total == 0:
        return False
    return ascii_count / total > 0.7


# ─────────────────────────────────────────────────────────────────────────────
# Phase 3b: 晨兴（morning_revivals）解析
# ─────────────────────────────────────────────────────────────────────────────

# 周次 outline header（如 "第一周　神的启示..."，第N周 + 全角空格 + 非"周X"标题）
_WEEK_HEADER_RE = re.compile(r'^第([一二三四五六七八九十]+)周\s*(.*)')

# 每日内容块 header（如 "第一周　周一"，全角空格 + 周 + 星期）
_DAY_BLOCK_HDR_RE = re.compile(r'^第([一二三四五六七八九十]+)周\u3000周([一二三四五六])$')

# 纲目中每天标记（如 "周　一"，全角空格分隔）
_DAY_RE = re.compile(r'^周\s*([一二三四五六])$')

# 晨兴阅读结束 marker（如 "周一晨兴"，导航分节）
_DAY_END_RE = re.compile(r'^周[一二三四五六](?:、周[一二三四五六])*晨兴')

_CN_WEEKDAY = {'一': '周一', '二': '周二', '三': '周三',
               '四': '周四', '五': '周五', '六': '周六'}


def _extract_day_outlines(outline_lines: list) -> dict:
    """从周纲目块的行中提取每天的大纲节点，返回 {day_cn: [Content nodes]}。

    处理普通独立日（周　一）和合并日（周四、周五）两种格式。
    """
    day_outlines: dict = {}
    current_days: list = []   # 当前收集的星期（可能 2 个，如 周四+周五 合并）
    current_lines: list = []

    def flush():
        if current_days:
            nodes = parse_cn_outline(current_lines)
            for d in current_days:
                day_outlines[d] = nodes

    for raw in outline_lines:
        s = raw.strip()
        if not s:
            continue
        # 跳过导航行
        if _is_nav_line(s):
            continue
        # 跳过 诗歌/纲目[]/晨兴[]/读经/TOP 等辅助行
        if (s.startswith('诗歌') or s.startswith('读经') or s.startswith('TOP')
                or re.match(r'^(纲目|晨兴)\s*\[', s)):
            continue

        # 检查单日标记：周　一（全角空格）
        dm = _DAY_RE.match(s)
        if dm:
            flush()
            current_days = [dm.group(1)]
            current_lines = []
            continue

        # 检查合并日标记：周四、周五
        cm = re.match(r'^周([一二三四五六])(?:、周([一二三四五六]))+$', s)
        if cm:
            flush()
            # 收集所有合并的星期
            current_days = re.findall(r'周([一二三四五六])', s)
            current_lines = []
            continue

        # 跳过"周X晨兴"类导航结束标记（保存并重置）
        if _DAY_END_RE.match(s):
            flush()
            current_days = []
            current_lines = []
            continue

        if current_days:
            current_lines.append(raw)

    flush()
    return day_outlines


def _extract_day_content(day_block_lines: list) -> tuple:
    """从每日内容块（第N周　周X 后的行）中提取晨兴喂养、信息选读和参读内容。

    Returns:
        (morning_feeding, message_reading, ref_reading) 各为 List[str]
    """
    morning_feeding: list = []
    message_reading: list = []
    ref_reading: list = []
    mode = None  # 'feeding' | 'msgread' | 'refread'

    for raw in day_block_lines:
        s = raw.strip()
        if not s:
            continue
        # 晨兴喂养 → 切换模式
        if s == '晨兴喂养':
            mode = 'feeding'
            continue
        # 信息选读 → 切换模式
        if s == '信息选读':
            mode = 'msgread'
            continue
        # 参读：→ 收集参读并切换模式
        if s.startswith('参读'):
            mode = 'refread'
            rest = s[2:]
            if rest and rest[0] in '：:':
                rest = rest[1:]
            rest = rest.strip()
            if rest:
                ref_reading.append(rest)
            continue
        # 跳过导航行 / "今日晨兴/..." 等结束标记
        if _is_nav_line(s) or s.startswith('今日晨兴') or s.startswith('TOP'):
            continue

        # 下一个日内容块开始或新篇章头 → 停止
        if _DAY_BLOCK_HDR_RE.match(s) or _MSG_HEADER_FULL_RE.match(s):
            break

        if mode == 'feeding':
            morning_feeding.append(s)
        elif mode == 'msgread':
            message_reading.append(s)
        elif mode == 'refread':
            ref_reading.append(s)

    return morning_feeding, message_reading, ref_reading


def _extract_week_hymns(detail_lines: list) -> dict:
    """扫描 detail_lines 中的周纲目块，提取每周的诗歌编号。

    支持两种来源：
    1. 周 header 行后紧跟的 `诗歌∶xxx` 参考行（短行 < 50 chars）
    2. `第X周　诗歌` 页面 header 后的第一行内容（书目+首），如 `补充本第214首`

    返回 {week_num: hymn_text}，week_num 从 1 开始。
    """
    hymns: dict = {}
    n = len(detail_lines)

    # Regex: 第X周　... or 第X周诗歌
    week_hdr_re = re.compile(r'^第([一二三四五六七八九十]+)[周]\s*(.*)')

    for i, raw in enumerate(detail_lines):
        s = raw.strip()
        m = week_hdr_re.match(s)
        if not m:
            continue
        week_num = _cn_ord_to_int(m.group(1))
        if week_num <= 0:
            continue
        rest_title = m.group(2).strip()

        # Pattern 2: `第X周　诗歌` 页面 → 下一非空行是 `书目第N首` 或 `书目N首`
        if rest_title in ('诗歌', '诗 歌'):
            for j in range(i + 1, min(i + 5, n)):
                nxt = detail_lines[j].strip()
                if nxt and not _is_nav_line(nxt):
                    if week_num not in hymns:
                        hymns[week_num] = nxt
                    break
            continue

        # Pattern 1: week header followed within 5 lines by `诗歌∶xxx` (short line)
        if week_num not in hymns:
            for j in range(i + 1, min(i + 8, n)):
                nxt = detail_lines[j].strip()
                if not nxt:
                    continue
                if _is_nav_line(nxt) or nxt.startswith('读经'):
                    continue
                if nxt.startswith('诗歌') and len(nxt) < 50:
                    rest = nxt[2:]
                    if rest and rest[0] in '：:∶':
                        rest = rest[1:]
                    hymns[week_num] = rest.strip() or nxt
                    break
                # Stop at outline content (level 1 marker 壹贰叁 or body text)
                if (nxt[0] in '壹贰叁肆伍陆' and '\u3000' in nxt) or len(nxt) > 60:
                    break

    return hymns


def _extract_morning_revivals(detail_lines: list, chapters: list[Chapter],
                              chapter_positions: list = None):
    """从 detail_lines 中提取所有晨兴内容，分配到对应章节的 morning_revivals。

    策略：
    优先使用位置匹配（chapter_positions）——将每日内容块和周纲目 header
    按行号归属到对应章节区间。忽略周次号的语义（同一周次号可出现在多篇）。
    若未提供 chapter_positions，则退回按标题模糊匹配。

    支持 2014+ 旧格式（大纲 + 听抄/每日块）及 2025 格式（大周次号如第三十七周）。
    """
    # ── Pass 1：扫描所有行，收集每日内容块位置和周纲目 header 位置 ──
    day_block_positions: list = []    # [(i, wnum, day_cn, cn_str)]
    week_outline_positions: list = [] # [(i, wnum, cn_str, title)]

    # 每日块：按 (wnum, day_cn) 去重（同一大原稿只出现一次）
    seen_day_blocks: set = set()
    # 周纲目 header：以 (wnum, title前缀) 去重，允许同一 wnum 不同标题
    seen_week_keys: set = set()

    for i, raw in enumerate(detail_lines):
        s = raw.strip()
        if not s:
            continue

        # 检查每日内容块 header：第N周　周X
        dm = _DAY_BLOCK_HDR_RE.match(s)
        if dm:
            cn_str = dm.group(1)
            day_cn = dm.group(2)
            wnum = _cn_ord_to_int(cn_str)
            if wnum > 0 and (wnum, day_cn) not in seen_day_blocks:
                seen_day_blocks.add((wnum, day_cn))
                day_block_positions.append((i, wnum, day_cn, cn_str))
            continue

        # 检查周纲目 header：第N周　[非周X标题]
        wm = _WEEK_HEADER_RE.match(s)
        if not wm:
            continue
        cn_str = wm.group(1)
        title_part = (wm.group(2) or '').strip()

        # 排除每日子标题（group(2) 以 "周" 开头）
        if re.match(r'^周[一二三四五六]', title_part):
            continue

        wnum = _cn_ord_to_int(cn_str)
        if wnum <= 0:
            continue

        # 以 (wnum, 标题前10字) 去重——允许同一 wnum 不同标题（不同章节）
        wkey = (wnum, fuzzy_key(title_part)[:10])
        if wkey in seen_week_keys:
            continue

        # 验证是真正的周纲目 header：下一非空行是 nav / 读经 / 诗歌
        is_week_hdr = False
        for j in range(i + 1, min(i + 5, len(detail_lines))):
            nxt = detail_lines[j].strip()
            if not nxt:
                continue
            if _is_nav_line(nxt) or nxt.startswith('读经') or nxt.startswith('诗歌'):
                is_week_hdr = True
            break
        if not is_week_hdr:
            continue

        seen_week_keys.add(wkey)
        week_outline_positions.append((i, wnum, cn_str, title_part))

    if not day_block_positions and not week_outline_positions:
        return  # 没有晨兴格式，跳过

    # ── 判断使用位置匹配还是标题匹配 ──
    use_position = chapter_positions is not None and len(chapter_positions) == len(chapters)

    if use_position:
        # ══════ 位置匹配路径 ══════
        # 直接按行号范围将每日内容块和周纲目 header 归属到各章节
        _extract_morning_revivals_by_position(
            detail_lines, chapters, chapter_positions,
            day_block_positions, week_outline_positions
        )
    else:
        # ══════ 标题匹配路径 ══════（退化方案）
        _extract_morning_revivals_by_title(
            detail_lines, chapters,
            day_block_positions, week_outline_positions
        )


def _extract_morning_revivals_by_position(
        detail_lines, chapters, chapter_positions,
        day_block_positions, week_outline_positions):
    """按章节行号范围将晨兴内容分配到各章节（位置匹配路径）。"""
    all_day_cns = ['一', '二', '三', '四', '五', '六']

    for ch_idx, (ch_start, ch_end) in enumerate(chapter_positions):
        if ch_idx >= len(chapters):
            break
        ch = chapters[ch_idx]

        # 找本章节范围内的周纲目 header（取第一个有效的，用于获取 cn_str 和大纲行）
        ch_outlines = [(pos, wnum, cs, title) for (pos, wnum, cs, title)
                       in week_outline_positions if ch_start <= pos < ch_end]

        # 找本章节范围内的每日内容块
        ch_day_positions = [(pos, wnum, day_cn, cs) for (pos, wnum, day_cn, cs)
                            in day_block_positions if ch_start <= pos < ch_end]

        if not ch_outlines and not ch_day_positions:
            continue  # 本章节无晨兴数据

        # 确定 cn_str（优先从每日块，其次从纲目 header）
        cn_str = ''
        if ch_day_positions:
            cn_str = ch_day_positions[0][3]   # 第一个每日块的 cn_str
        elif ch_outlines:
            cn_str = ch_outlines[0][2]

        # 从纲目 header 提取每天大纲
        day_outlines: dict = {}
        if ch_outlines:
            outline_pos = ch_outlines[0][0]
            # 纲目块结束于：第一个每日块 或 本章结束
            if ch_day_positions:
                outline_end = ch_day_positions[0][0]
            else:
                outline_end = ch_end
            outline_block_lines = detail_lines[outline_pos + 1 : outline_end]
            day_outlines = _extract_day_outlines(outline_block_lines)

        # 构建每日内容块字典 {day_cn: block_lines}
        day_content_lines: dict = {}
        for k, (pos, wnum, day_cn, cs) in enumerate(ch_day_positions):
            end_pos = ch_day_positions[k + 1][0] if k + 1 < len(ch_day_positions) else ch_end
            day_content_lines[day_cn] = detail_lines[pos + 1 : end_pos]

        # 构建 6 天晨兴
        mrs: list = []
        for day_cn in all_day_cns:
            day_label = f'第{cn_str}周 • {_CN_WEEKDAY.get(day_cn, f"周{day_cn}")}'
            outline_nodes = day_outlines.get(day_cn, [])
            block_lines = day_content_lines.get(day_cn, [])
            morning_feeding, message_reading, ref_reading = _extract_day_content(block_lines)
            mrs.append(MorningRevival(
                day=day_label,
                outline=outline_nodes,
                morning_feeding=morning_feeding,
                message_reading=message_reading,
                ref_reading=ref_reading,
            ))

        ch.morning_revivals = mrs


def _extract_morning_revivals_by_title(
        detail_lines, chapters,
        day_block_positions, week_outline_positions):
    """按标题模糊匹配将晨兴内容分配到各章节（标题匹配退化路径）。"""
    all_day_cns = ['一', '二', '三', '四', '五', '六']

    # Pass 2：构建 {wnum → {day_cn → block_lines}}
    wnum_to_day_lines: dict = {}
    wnum_to_cn_str: dict = {}
    for k, (i, wnum, day_cn, cn_str) in enumerate(day_block_positions):
        end = day_block_positions[k + 1][0] if k + 1 < len(day_block_positions) else len(detail_lines)
        if wnum not in wnum_to_day_lines:
            wnum_to_day_lines[wnum] = {}
        wnum_to_cn_str[wnum] = cn_str
        wnum_to_day_lines[wnum][day_cn] = detail_lines[i + 1 : end]

    # Pass 3：构建 {wnum → outline_lines}
    sorted_outlines = sorted(week_outline_positions, key=lambda x: x[0])
    wnum_to_outline_lines: dict = {}
    wnum_to_title: dict = {}
    for idx, (pos, wnum, cn_str, title) in enumerate(sorted_outlines):
        if wnum not in wnum_to_title:
            wnum_to_title[wnum] = title
        first_day_pos = next((dp for (dp, dw, dd, dc) in day_block_positions if dw == wnum), None)
        next_outline_pos = sorted_outlines[idx + 1][0] if idx + 1 < len(sorted_outlines) else len(detail_lines)
        outline_end = min(
            first_day_pos if first_day_pos is not None else len(detail_lines),
            next_outline_pos
        )
        if wnum not in wnum_to_outline_lines:
            wnum_to_outline_lines[wnum] = detail_lines[pos + 1 : outline_end]

    # Pass 4：将周次映射到章节（按标题模糊匹配）
    wnum_to_chapter: dict = {}
    all_wnums = sorted(set(list(wnum_to_day_lines.keys()) + list(wnum_to_outline_lines.keys())))
    for wnum in all_wnums:
        title = wnum_to_title.get(wnum, '')
        if not title:
            continue
        wk_fk = fuzzy_key(title)
        for ch in chapters:
            ch_fk = fuzzy_key(ch.title)
            if (len(wk_fk) >= 3 and len(ch_fk) >= 3
                    and (wk_fk[:8] == ch_fk[:8]
                         or (len(wk_fk) >= 6 and wk_fk in ch_fk)
                         or (len(ch_fk) >= 6 and ch_fk in wk_fk))):
                wnum_to_chapter[wnum] = ch
                break

    if not wnum_to_chapter:
        # 退化：按顺序分配 wnum=1..N → chapters[0..N-1]
        for wnum in sorted(all_wnums):
            if wnum <= len(chapters):
                wnum_to_chapter[wnum] = chapters[wnum - 1]

    # Pass 5：构建 6 天晨兴并分配
    for wnum in all_wnums:
        ch = wnum_to_chapter.get(wnum)
        if ch is None:
            continue
        cn_str = wnum_to_cn_str.get(wnum, '')
        if not cn_str:
            for (_, w, cs, _t) in sorted_outlines:
                if w == wnum:
                    cn_str = cs
                    break
        outline_lines = wnum_to_outline_lines.get(wnum, [])
        day_outlines = _extract_day_outlines(outline_lines)
        mrs: list = []
        for day_cn in all_day_cns:
            day_label = f'第{cn_str}周 • {_CN_WEEKDAY.get(day_cn, f"周{day_cn}")}'
            block_lines = wnum_to_day_lines.get(wnum, {}).get(day_cn, [])
            morning_feeding, message_reading, ref_reading = _extract_day_content(block_lines)
            mrs.append(MorningRevival(
                day=day_label,
                outline=day_outlines.get(day_cn, []),
                morning_feeding=morning_feeding,
                message_reading=message_reading,
                ref_reading=ref_reading,
            ))
        ch.morning_revivals = mrs



# ─────────────────────────────────────────────────────────────────────────────
# Phase 4: 训练级解析
# ─────────────────────────────────────────────────────────────────────────────

def _parse_index_extras(lines: list, idx_start: int, idx_end: int) -> dict:
    """从索引区解析 subtitle / mottos / motto_song_text。"""
    subtitle = ''
    mottos = []
    motto_song_text = ''
    in_motto = False
    in_song = False

    for i in range(idx_start, idx_end + 1):
        s = lines[i].strip()
        if not s:
            continue

        if s.startswith('总题') and not subtitle:
            subtitle = re.sub(r'^总题[：:]\s*', '', s)
            continue

        if s in ('标\u3000语', '标语', '标　语'):
            in_motto = True
            in_song = False
            continue

        if s in ('标语诗歌', '标语诗', '标语歌'):
            in_motto = False
            in_song = True
            continue

        if s == 'TOP':
            in_motto = False
            in_song = False
            continue

        # 导航行 / 篇目行 → 跳过
        if _is_nav_line(s) or re.match(r'^第\d+篇', s):
            in_motto = False
            in_song = False
            continue

        if in_motto:
            mottos.append(s)
        elif in_song:
            motto_song_text += s + '\n'

    return {
        'subtitle': subtitle,
        'mottos': mottos,
        'motto_song_text': motto_song_text.strip(),
    }


def _normalize_title(t: str) -> str:
    """Collapse whitespace, normalize dashes and enumeration commas for fuzzy title comparison."""
    t = re.sub(r'\s+', '', t)
    # Normalize various dash/hyphen chars to ASCII hyphen
    t = re.sub(r'[─—–‐‑‒⁻₋]', '-', t)
    # Strip ideographic enumeration comma (、) common in Chinese titles — often omitted in companion booklet
    t = t.replace('、', '')
    return t


def _merge_duplicate_mr_chapters(chapters: list) -> list:
    """合并重复章节：半年度训练等格式中，听抄部分（无晨兴）和晨兴部分（有晨兴）
    会产生标题相同的两批章节，本函数将晨兴数据合并到听抄章节，删除多余的晨兴章节。

    检测条件：
    - 无晨兴章节数 == 有晨兴章节数 >= 4
    - 至少 80% 的无晨兴章节能在有晨兴章节中找到相同标题（忽略空白差异）
    """
    no_mr = [c for c in chapters if not c.morning_revivals]
    with_mr = [c for c in chapters if c.morning_revivals]
    if not no_mr or not with_mr or len(no_mr) != len(with_mr) or len(no_mr) < 4:
        return chapters

    titles_no_norm = [_normalize_title(c.title) for c in no_mr]
    titles_with_norm_set = {_normalize_title(c.title) for c in with_mr}
    match_count = sum(1 for t in titles_no_norm if t in titles_with_norm_set)
    if match_count < len(no_mr) * 0.8:
        return chapters

    # 建立标题→章节映射（with_mr侧）
    title_to_mr_chapter: dict = {}
    for c in with_mr:
        key = _normalize_title(c.title)
        if key not in title_to_mr_chapter:
            title_to_mr_chapter[key] = c

    to_remove_ids: set = set()
    for c in no_mr:
        key = _normalize_title(c.title)
        if key in title_to_mr_chapter:
            src = title_to_mr_chapter[key]
            c.morning_revivals = src.morning_revivals
            to_remove_ids.add(id(src))

    merged = [c for c in chapters if id(c) not in to_remove_ids]
    removed = len(chapters) - len(merged)
    if removed:
        print(f"  [合并] 将 {removed} 个重复晨兴章节合并入对应听抄章节")
    return merged


def parse_training_to_data(sec: dict, lines: list, seq: int,
                            matched_detail: dict) -> tuple:
    """将单个训练 section 解析为 (TrainingData, verse_dict_merged, motto_song_text)。"""
    idx_start = sec['idx_start']
    idx_end = sec['idx_end']
    year = sec['year']
    header = sec['header']

    extras = _parse_index_extras(lines, idx_start, idx_end)
    subtitle = extras['subtitle']
    mottos = extras['mottos']
    motto_song_text = extras['motto_song_text']

    title = get_short_name(header)
    season = f"{seq:02d} {title}"

    chapters = []
    verse_dict_all = {}

    if idx_start not in matched_detail:
        # 无 detail 内容：返回空章节训练
        td = TrainingData(
            title=title,
            subtitle=subtitle,
            year=year,
            season=season,
            mottos=mottos,
        )
        return td, verse_dict_all, motto_song_text

    d_start, d_end = matched_detail[idx_start]
    detail_lines = lines[d_start:d_end + 1]

    # 在 detail 区识别每篇 header（第一篇、第二篇...）及其行范围
    # 每篇 header 在 txt 中会重复出现（对照区、听抄区各一次），只取第一次出现
    msg_positions = []  # [(line_index_in_detail, header_line)]
    seen_msg_nums: set = set()
    for i, raw in enumerate(detail_lines):
        s = raw.strip()
        m = _MSG_HEADER_FULL_RE.match(s)
        if not m:
            continue
        num = _cn_ord_to_int(m.group(1))
        if num <= 0 or num in seen_msg_nums:
            continue
        # 验证是真正的章节 header：下一非空行是 nav / 读经 / 诗歌 / TOP
        # 避免把正文中的句子 "第N篇说到..." 误识别为章节
        is_real_hdr = False
        for j in range(i + 1, min(i + 10, len(detail_lines))):
            nxt = detail_lines[j].strip()
            if not nxt:
                continue
            if (_is_nav_line(nxt) or nxt.startswith('读经')
                    or nxt.startswith('诗歌') or nxt.startswith('TOP')
                    or (('Outline' in nxt or '纲目' in nxt or '目录' in nxt) and len(nxt) < 60)):
                is_real_hdr = True
            break
        if not is_real_hdr:
            continue
        seen_msg_nums.add(num)
        msg_positions.append((i, s))

    for k, (pos, header_line) in enumerate(msg_positions):
        end_pos = msg_positions[k + 1][0] if k + 1 < len(msg_positions) else len(detail_lines)
        msg_lines = detail_lines[pos + 1:end_pos]
        chapter, verse_dict = parse_one_message(header_line, msg_lines)
        chapters.append(chapter)
        verse_dict_all.update(verse_dict)

    # 提取晨兴内容（仅旧格式有 第N周 + 周　一/二/... 结构）
    # 将章节行范围传入，以支持位置匹配（解决同一周次号出现在多章节的情况）
    chapter_positions = []
    for k, (pos, _) in enumerate(msg_positions):
        end_pos = msg_positions[k + 1][0] if k + 1 < len(msg_positions) else len(detail_lines)
        chapter_positions.append((pos, end_pos))
    _extract_morning_revivals(detail_lines, chapters, chapter_positions)

    # 提取周纲目中的诗歌编号，赋给尚无诗歌的章节（历史旧格式）
    week_hymns = _extract_week_hymns(detail_lines)
    if week_hymns:
        for ch in chapters:
            if not ch.hymn_number and ch.number in week_hymns:
                ch.hymn_number = week_hymns[ch.number]

    # 合并重复晨兴章节（如半年度训练：听抄1-12 + 晨兴13-24 → 仅保留1-12并附晨兴）
    chapters = _merge_duplicate_mr_chapters(chapters)

    td = TrainingData(
        title=title,
        subtitle=subtitle,
        year=year,
        season=season,
        mottos=mottos,
        chapters=chapters,
    )
    return td, verse_dict_all, motto_song_text


# ─────────────────────────────────────────────────────────────────────────────
# Phase 5: 输出写入
# ─────────────────────────────────────────────────────────────────────────────

def _load_bible_keys(output_root: str) -> set:
    path = os.path.join(output_root, 'data', 'bible-text.json')
    if not os.path.isfile(path):
        return set()
    with open(path, encoding='utf-8') as f:
        data = json.load(f)
    return set(data.keys())


def export_one_training(training_data: TrainingData, verse_dict: dict,
                        year: int, seq: int, motto_song_text: str):
    """写出 training.json 和（若有经文）js/scriptures-data.json。"""
    output_dir = os.path.normpath(
        os.path.join(os.path.dirname(__file__), '..', 'output', f'{year}-{seq:02d}')
    )
    os.makedirs(output_dir, exist_ok=True)

    # 构建字典并注入扩展字段
    d = training_data.to_dict()
    d['motto_song_text'] = motto_song_text

    # 丰富 feeding_refs / morning_feeding_contexts / message_reading_contexts
    # 这些字段由 generator.py 的 HTMLGenerator 生成，与 docx 路径保持一致
    try:
        import sys as _sys
        _sys.path.insert(0, os.path.normpath(os.path.join(os.path.dirname(__file__), '..')))
        from src.generator import HTMLGenerator as _HG
        _gen = _HG.__new__(_HG)
        for _ch in d.get('chapters', []):
            _gen._enrich_chapter_feeding_refs(_ch)
            _gen._enrich_section_contexts(_ch)
    except Exception as _e:
        pass  # 非致命：无法丰富时继续写出

    from datetime import datetime as _dt
    d['version'] = _dt.now().strftime('%Y%m%d%H%M%S')

    json_path = os.path.join(output_dir, 'training.json')
    with open(json_path, 'w', encoding='utf-8') as f:
        f.write(json.dumps(d, ensure_ascii=False, separators=(',', ':')))
    print(f"  [OK] training.json  {year}-{seq:02d}  ({len(training_data.chapters)} 篇章)")

    # scriptures-data.json（仅 2024+ 格式有内联经文）
    if verse_dict:
        output_root = os.path.normpath(os.path.join(output_dir, '..'))
        bible_keys = _load_bible_keys(output_root)
        filtered = {k: v for k, v in verse_dict.items() if k not in bible_keys}
        if filtered:
            js_dir = os.path.join(output_dir, 'js')
            os.makedirs(js_dir, exist_ok=True)
            with open(os.path.join(js_dir, 'scriptures-data.json'), 'w', encoding='utf-8') as f:
                f.write(json.dumps(filtered, ensure_ascii=False, separators=(',', ':')))
            print(f"  [OK] scriptures-data.json  {len(filtered)} 条补充经文")


# ─────────────────────────────────────────────────────────────────────────────
# JSON 生成主流程
# ─────────────────────────────────────────────────────────────────────────────

def is_multiyear_compilation(header: str) -> bool:
    """判断是否为多年跨度合辑（如 二〇一四年冬季至二〇一六年夏季训练）。"""
    # 含 "至" 且有两个"年"
    if '至' in header and header.count('年') >= 2:
        return True
    # 含顿号且有两个"年"（如 二〇一六年冬季训练、二〇一七年夏季训练）
    if '、' in header and header.count('年') >= 2:
        return True
    return False


def generate_json(sections: list, lines: list, detail_index: list,
                  year_filter: int = None, detail_start: int = None,
                  year_counts_ext: dict = None):
    """Phase 4+5: 为每个训练解析并写出 training.json。"""
    if detail_start is None:
        detail_start = DETAIL_START
    n = len(lines)

    # 按年份+顺序排序，分配 seq（若调用方已通过 year_counts_ext 预分配则跳过）
    sections.sort(key=lambda s: (s['year'], s['idx_start']))
    if year_counts_ext is None:
        year_counts: dict = {}
        for sec in sections:
            y = sec['year']
            year_counts[y] = year_counts.get(y, 0) + 1
            sec['seq'] = year_counts[y]
    # else: sec['seq'] 已由调用方设置，跳过

    detail_sorted = sorted(detail_index, key=lambda x: x[1])

    # 将 sections 分成常规训练和多年合辑两组，分别用独立的 search_after 匹配
    # 多年合辑的 detail 在旧格式区（txt 前段），独立搜索避免被常规训练消耗
    regular_sections = [s for s in sections if not is_multiyear_compilation(s['header'])]
    compilation_sections = [s for s in sections if is_multiyear_compilation(s['header'])]

    matched_detail: dict[int, tuple[int, int]] = {}

    # ── 常规训练匹配 ──
    search_after = detail_start
    for sec in regular_sections:
        norm_title = sec.get('first_msg_norm')
        if not norm_title:
            continue
        result = find_detail_range(detail_sorted, norm_title, search_after, n)
        if result is None:
            print(f"  [未匹配] {sec['header']!r}")
            continue
        sec_start, first_msg_line = result
        search_after = first_msg_line + 1
        matched_detail[sec['idx_start']] = (sec_start, first_msg_line)

    # ── 多年合辑匹配（独立 search_after，从 detail_start 开始）──
    compilation_sections.sort(key=lambda s: (s['year'], s['idx_start']))
    search_after_comp = detail_start
    for sec in compilation_sections:
        norm_title = sec.get('first_msg_norm')
        if not norm_title:
            continue
        result = find_detail_range(detail_sorted, norm_title, search_after_comp, n)
        if result is None:
            print(f"  [未匹配合辑] {sec['header']!r}")
            continue
        sec_start, first_msg_line = result
        search_after_comp = first_msg_line + 1
        matched_detail[sec['idx_start']] = (sec_start, first_msg_line)
        print(f"  [合辑] {sec['header']!r}  first_msg_line={first_msg_line}")

    # 确定每个训练 detail 结束行（按 detail 位置排序确定边界）
    all_matched = sorted(
        [(sec, matched_detail[sec['idx_start']][0])
         for sec in sections if sec['idx_start'] in matched_detail],
        key=lambda x: x[1]
    )
    for i, (sec, d_start) in enumerate(all_matched):
        next_d_start = all_matched[i + 1][1] if i + 1 < len(all_matched) else n
        d_end = find_detail_end(lines, d_start, next_d_start)
        matched_detail[sec['idx_start']] = (d_start, d_end)

    # 逐训练解析和写出
    count = 0
    for sec in sections:
        if year_filter and sec['year'] != year_filter:
            continue
        td, verse_dict, motto_song_text = parse_training_to_data(
            sec, lines, sec['seq'], matched_detail
        )
        export_one_training(td, verse_dict, sec['year'], sec['seq'], motto_song_text)
        count += 1

    print(f"\n共写出 {count} 个训练的 training.json")




def normalize(s: str) -> str:
    return s.translate(DASH_NORM_TABLE).strip()


def fuzzy_key(s: str) -> str:
    """去除标点、空格、破折号类字符，用于模糊匹配。"""
    s = s.translate(DASH_NORM_TABLE)
    s = s.translate(_PUNC_REMOVE)
    s = s.replace(' ', '').replace('\u3000', '')
    # 去掉开头的 "信息" 前缀（部分条目有此前缀）
    if s.startswith('信息'):
        s = s[2:]
    return s


def cn_year_to_int(header: str) -> int | None:
    m = re.search(r'([一二三四五六七八九○〇零]{4})年', header)
    if not m:
        return None
    cn_digits = m.group(1)
    year_str = ''.join(CN_DIGIT.get(c, '?') for c in cn_digits)
    if '?' in year_str:
        return None
    return int(year_str)


def get_short_name(header: str) -> str:
    idx = header.find('年')
    name = header[idx + 1:].strip() if idx >= 0 else header.strip()
    for ch in r'\/:*?"<>|':
        name = name.replace(ch, '_')
    return name[:60]


def sanitize_filename(name: str) -> str:
    for ch in r'\/:*?"<>|':
        name = name.replace(ch, '_')
    return name.strip('. ')[:80]


def is_section_header(lines: list, i: int) -> bool:
    line = lines[i].strip()
    if not re.match(r'^[一二三四五六七八九○〇零两]{4}年', line):
        return False
    for j in range(i + 1, min(i + 6, len(lines))):
        nxt = lines[j].strip()
        if nxt:
            return (nxt.startswith('总题') or
                    (nxt.startswith('标') and len(nxt) <= 4) or
                    bool(re.match(r'^第0?1篇', nxt)))
    return False


def extract_first_msg_title(lines: list, start: int, end: int) -> str | None:
    """从索引区该训练块中提取第01篇标题。"""
    for j in range(start + 1, end):
        s = lines[j].strip()
        if re.match(r'^第0?1篇', s):
            title = re.sub(r'^第0?1篇\s*', '', s)
            return normalize(title)
    return None


# ─────────────────────────────────────────────────────────────────────────────
# 详细内容区解析
# ─────────────────────────────────────────────────────────────────────────────

# 第X篇/第X周（汉字序数）的 pattern —— 两者都可作为训练第一条目的起点
MSG_HEADER_RE = re.compile(r'^第[一二三四五六七八九十百千]+[篇周]\s*(.+)')
# 仅匹配第一篇/第一周（作为训练的起点）
FIRST_MSG_RE = re.compile(r'^第一[篇周]')


def build_detail_index(lines: list, detail_start: int = None) -> list:
    """
    扫描详细区（detail_start 之后），找出每个 "第一篇/第一周" 的位置和其前面的 标语 起始位置。
    返回列表：[(section_start_line, first_msg_line, first_msg_title_normalized,
                 first_msg_title_fuzzy), ...]
    按 first_msg_line 排序。
    """
    if detail_start is None:
        detail_start = DETAIL_START
    entries = []
    n = len(lines)
    for i in range(detail_start, n):
        stripped = lines[i].strip()
        if not FIRST_MSG_RE.match(stripped):
            continue
        m = MSG_HEADER_RE.match(stripped)
        if not m:
            continue
        raw_title = m.group(1).strip()
        norm_title = normalize(raw_title)
        fuzz_title = fuzzy_key(raw_title)
        # 向上找 标语 起始（15行内），若找到则 section_start = 标语行
        section_start = i
        for back in range(1, 15):
            prev = i - back
            if prev < detail_start:
                break
            pl = lines[prev].strip()
            if pl == '标\u3000语' or pl == '标语':
                section_start = prev
                break
            if re.match(r'^TOP', pl):
                break
        entries.append((section_start, i, norm_title, fuzz_title))
    return entries


def find_detail_range(detail_index: list, norm_title: str,
                      search_after: int, search_before: int) -> tuple[int, int] | None:
    """
    在 detail_index 中找第一个 norm_title 匹配的条目（search_after <= first_msg_line < search_before）。
    先精确匹配，再 fuzzy 匹配。
    返回 (section_start_line, first_msg_line)，或 None。
    """
    fuzz = fuzzy_key(norm_title)
    # 精确匹配
    for (ss, fl, nt, nf) in detail_index:
        if fl < search_after or fl >= search_before:
            continue
        if nt == norm_title:
            return (ss, fl)
    # fuzzy 匹配（忽略标点差异）
    for (ss, fl, nt, nf) in detail_index:
        if fl < search_after or fl >= search_before:
            continue
        if nf == fuzz:
            return (ss, fl)
    # 最后：前缀匹配（从 14 字符逐步缩短到 6）
    for prefix_len in (14, 10, 6):
        fuzz_prefix = fuzz[:prefix_len]
        if len(fuzz_prefix) < prefix_len:
            continue
        for (ss, fl, nt, nf) in detail_index:
            if fl < search_after or fl >= search_before:
                continue
            if nf.startswith(fuzz_prefix):
                return (ss, fl)
    return None


def find_detail_end(lines: list, detail_start_line: int,
                    next_training_start: int) -> int:
    """
    从 detail_start_line 开始，找该训练详细内容的结束行（含）。
    策略：找到 next_training_start 之前最后一个有实质内容的行。
    """
    end = detail_start_line
    for i in range(detail_start_line, next_training_start):
        if lines[i].strip():
            end = i
    return end


# ─────────────────────────────────────────────────────────────────────────────
# 主逻辑
# ─────────────────────────────────────────────────────────────────────────────

def parse_index_sections(lines: list, detail_start: int = None) -> list:
    """
    解析索引区，返回：
    [{header, year, idx_start, idx_end, first_msg_title_norm}]
    """
    if detail_start is None:
        detail_start = DETAIL_START
    header_indices = [i for i in range(detail_start)
                      if is_section_header(lines, i)]
    sections = []
    for k, idx_start in enumerate(header_indices):
        idx_end = header_indices[k + 1] - 1 if k + 1 < len(header_indices) else detail_start - 1
        header = lines[idx_start].strip()
        year = cn_year_to_int(header)
        if year is None:
            print(f"[警告] 无法解析年份: {header!r}")
            year = 0
        first_msg_norm = extract_first_msg_title(lines, idx_start, idx_end + 1)
        sections.append({
            'header': header,
            'year': year,
            'idx_start': idx_start,
            'idx_end': idx_end,
            'first_msg_norm': first_msg_norm,
        })
    return sections


def write_sections(sections: list, lines: list, detail_index: list,
                   detail_start: int = None):
    if detail_start is None:
        detail_start = DETAIL_START
    n = len(lines)

    # 按年份分组，分配序号（保持原文档 idx_start 顺序）
    sections.sort(key=lambda s: (s['year'], s['idx_start']))
    year_counts: dict[int, int] = {}
    for sec in sections:
        y = sec['year']
        year_counts[y] = year_counts.get(y, 0) + 1
        sec['seq'] = year_counts[y]

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # 对 detail_index 按 first_msg_line 排序，用于范围搜索
    detail_sorted = sorted(detail_index, key=lambda x: x[1])  # by first_msg_line

    # 先找每个训练对应的 detail range
    matched_detail: dict[int, tuple[int, int]] = {}  # idx_start -> (detail_start, detail_end)

    # 将 sections 分成常规训练和多年合辑两组，分别用独立的 search_after 匹配
    # 合辑在大文件中占据中段位置，若与常规训练共用 search_after 会导致
    # 常规训练的 search_after 跳过包含晨兴内容的前段区域
    regular_sections = [s for s in sections if not is_multiyear_compilation(s['header'])]
    compilation_sections = [s for s in sections if is_multiyear_compilation(s['header'])]

    # ── 常规训练匹配（独立 search_after） ──
    search_after = detail_start
    for sec in regular_sections:
        norm_title = sec['first_msg_norm']
        if not norm_title:
            continue
        result = find_detail_range(detail_sorted, norm_title, search_after, n)
        if result is None:
            print(f"[未匹配详细内容] {sec['header']!r}  first_msg={norm_title!r}")
            continue
        sec_start, first_msg_line = result
        search_after = first_msg_line + 1
        matched_detail[sec['idx_start']] = (sec_start, first_msg_line)

    # ── 多年合辑匹配（独立 search_after，从 detail_start 重新开始） ──
    compilation_sections.sort(key=lambda s: (s['year'], s['idx_start']))
    search_after_comp = detail_start
    for sec in compilation_sections:
        norm_title = sec['first_msg_norm']
        if not norm_title:
            continue
        result = find_detail_range(detail_sorted, norm_title, search_after_comp, n)
        if result is None:
            print(f"[未匹配合辑详细内容] {sec['header']!r}  first_msg={norm_title!r}")
            continue
        sec_start, first_msg_line = result
        search_after_comp = first_msg_line + 1
        matched_detail[sec['idx_start']] = (sec_start, first_msg_line)

    # 确定每个 detail range 的结束行
    # 将所有已匹配的训练按 detail 起始行排序，用于确定每段的边界
    all_matched_sorted = sorted(
        [(sec, matched_detail[sec['idx_start']][0])
         for sec in sections if sec['idx_start'] in matched_detail],
        key=lambda x: x[1]
    )
    for i, (sec, d_start) in enumerate(all_matched_sorted):
        # 向后找第一个 d_start 严格大于当前的条目作为边界
        # 跳过与当前相同位置的条目（例如同一训练既有正规条目又有合辑条目时，
        # 两者 d_start 相同，若直接取 next 会导致 range=0）
        next_d_start = n
        for j in range(i + 1, len(all_matched_sorted)):
            if all_matched_sorted[j][1] > d_start:
                next_d_start = all_matched_sorted[j][1]
                break
        else:
            # 在 detail_sorted 中找第一个属于不同训练的 first_msg_line
            # 避免把后续其他区段的海量内容都纳入该训练
            curr_norm = sec.get('first_msg_norm', '')
            for _ss, _fml, _nt, _nf in detail_sorted:
                if _fml > d_start and _nt != curr_norm:
                    next_d_start = _fml
                    break
        d_end = find_detail_end(lines, d_start, next_d_start)
        matched_detail[sec['idx_start']] = (d_start, d_end)

    # 写文件
    for sec in sections:
        year = sec['year']
        seq = sec['seq']
        year_dir = os.path.join(OUTPUT_DIR, str(year))
        os.makedirs(year_dir, exist_ok=True)

        short_name = get_short_name(sec['header'])
        filename = f"{year}-{seq:02d}-{sanitize_filename(short_name)}.txt"
        filepath = os.path.join(year_dir, filename)

        # 1. 索引区内容（TOC）
        idx_lines = lines[sec['idx_start']:sec['idx_end'] + 1]
        # 截断到最后一个 TOP（含）
        top_idx = None
        for ci, cl in enumerate(idx_lines):
            if cl.strip() == 'TOP':
                top_idx = ci
        if top_idx is not None:
            idx_lines = idx_lines[:top_idx + 1]
        toc_content = ''.join(idx_lines)

        # 2. 详细区内容
        detail_content = ''
        if sec['idx_start'] in matched_detail:
            d_start, d_end = matched_detail[sec['idx_start']]
            detail_lines = lines[d_start:d_end + 1]
            detail_content = '\n\n' + ('─' * 60) + '\n详细信息\n' + ('─' * 60) + '\n'
            detail_content += ''.join(detail_lines)

        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(toc_content)
            f.write(detail_content)

        has_detail = 'OK' if sec['idx_start'] in matched_detail else '--'
        print(f"  [{has_detail}] {filepath}")


def main():
    parser = argparse.ArgumentParser(description='解析历史合辑 txt')
    parser.add_argument('--mode', choices=['txt', 'json', 'both'], default='json',
                        help='输出模式：txt=拆分文件, json=training.json, both=两者 (默认: json)')
    parser.add_argument('--year', type=int, default=None,
                        help='仅处理指定年份（json 模式下有效，如 --year 1997）')
    args = parser.parse_args()

    sources = collect_src_files()
    if not sources:
        print(f"[错误] 未找到任何源文件（检查 {OUTPUT_DIR} 目录）")
        sys.exit(1)

    print(f"发现 {len(sources)} 个源文件")
    for fp, ds in sources:
        label = '大合辑' if ds == DETAIL_START else '单训练'
        print(f"  [{label}] {os.path.basename(fp)}")

    # ── txt 模式：仅对大合辑文件执行拆分 ──
    if args.mode in ('txt', 'both'):
        for filepath, ds in sources:
            if ds != DETAIL_START:
                continue  # 只拆大合辑
            print(f"\n[txt] 拆分 {os.path.basename(filepath)} ...")
            with open(filepath, encoding='utf-8') as f:
                lines = f.readlines()
            sections = parse_index_sections(lines, ds)
            detail_index = build_detail_index(lines, ds)
            write_sections(sections, lines, detail_index, ds)

    # ── json 模式：处理所有源文件 ──
    if args.mode in ('json', 'both'):
        print(f"\n[json] 写入 training.json 到 {OUTPUT_BASE}/")

        # 第一遍：收集所有 sections 并统一分配 seq（避免跨文件 seq 重复）
        all_file_data = []
        year_counts_global: dict[int, int] = {}
        for filepath, ds in sources:
            with open(filepath, encoding='utf-8', errors='replace') as f:
                lines = f.readlines()
            det_start = ds if ds is not None else detect_detail_start(lines)
            # 跳过无详细内容区的 stub 文件（如仅含索引的跨年合辑占位文件）；
            # 这类文件解析只会产生 0 章节训练，且会覆盖大合辑已输出的正确内容。
            if ds is None and det_start >= len(lines):
                print(f"  [跳过-stub] {os.path.basename(filepath)}: 无详细内容区")
                continue
            sections = parse_index_sections(lines, det_start)
            if not sections:
                print(f"  [跳过] {os.path.basename(filepath)}: 未识别到训练章节")
                continue
            # 排序后统一分配 seq
            sections.sort(key=lambda s: (s['year'], s['idx_start']))
            # 年份子目录文件（YYYY-NN-*.txt）直接从文件名提取 seq，
            # 避免与大合辑已分配的 seq 编号冲突。
            fname_now = os.path.basename(filepath)
            fn_seq_m = re.match(r'(\d{4})-(\d{2})-', fname_now)
            for sec in sections:
                y = sec['year']
                if fn_seq_m and int(fn_seq_m.group(1)) == y:
                    # 文件名有匹配年份的 YYYY-NN 前缀，直接用文件名序号覆盖同训练的输出
                    sec['seq'] = int(fn_seq_m.group(2))
                else:
                    year_counts_global[y] = year_counts_global.get(y, 0) + 1
                    sec['seq'] = year_counts_global[y]
            detail_index = build_detail_index(lines, det_start)
            all_file_data.append((sections, lines, detail_index, det_start,
                                   os.path.basename(filepath)))

        # 统计
        year_stat: dict[int, int] = {}
        for sections, _, _, _, _ in all_file_data:
            for sec in sections:
                year_stat[sec['year']] = year_stat.get(sec['year'], 0) + 1
        total = sum(year_stat.values())
        print(f"  共识别 {total} 个训练")
        for y in sorted(year_stat):
            print(f"    {y}: {year_stat[y]} 个")

        # 第二遍：逐文件生成 JSON
        count = 0
        for sections, lines, detail_index, det_start, fname in all_file_data:
            n_before = count
            generate_json(sections, lines, detail_index,
                          year_filter=args.year,
                          detail_start=det_start,
                          year_counts_ext=year_counts_global)
            count += len([s for s in sections
                          if args.year is None or s['year'] == args.year])

    print("\n完成！")    # scriptures-data.json 由 generate_json→export_one_training 内部写出


if __name__ == '__main__':
    main()

