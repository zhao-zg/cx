#!/usr/bin/env python3
"""
解析 97-25-特会合辑.txt，识别每个训练/特会，
按年份分文件夹，每个训练保存为独立文件。
输出目录：../resource/按年份分类/{year}/{seq:02d}-{name}.txt

文件结构：
  - 索引区（index section）：行 1 ~ DETAIL_SPLIT_LINE，每个训练标题/总题/消息列表
  - 详细区（detail section）：行 DETAIL_SPLIT_LINE+1 ~ 末尾，每篇的完整大纲
每个输出文件 = 索引区该训练的TOC + 详细区对应的完整内容
"""

import re
import os

INPUT_FILE = "../resource/历史合辑/97-25-特会合辑.txt"
OUTPUT_DIR = "../resource/历史合辑"

# 详细内容区起始行（0-based），第 7861 行（1-based）
DETAIL_START = 7861

# 中文数字 -> 阿拉伯数字
CN_DIGIT = {
    '一': '1', '二': '2', '三': '3', '四': '4', '五': '5',
    '六': '6', '七': '7', '八': '8', '九': '9',
    '○': '0', '〇': '0', '零': '0', '两': '2',
}

# 各种破折号统一为 U+2500，用于模糊标题匹配
DASH_NORM_TABLE = str.maketrans('—–－', '───')

# 用于 fuzzy key 的标点去除表
import unicodedata
_PUNC_REMOVE = dict.fromkeys(
    i for i in range(0x10000)
    if unicodedata.category(chr(i)).startswith('P') or chr(i) in '　 ，、。；：'
)


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


def build_detail_index(lines: list) -> list:
    """
    扫描详细区（DETAIL_START 之后），找出每个 "第一篇/第一周" 的位置和其前面的 标语 起始位置。
    返回列表：[(section_start_line, first_msg_line, first_msg_title_normalized,
                 first_msg_title_fuzzy), ...]
    按 first_msg_line 排序。
    """
    entries = []
    n = len(lines)
    for i in range(DETAIL_START, n):
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
            if prev < DETAIL_START:
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

def parse_index_sections(lines: list) -> list:
    """
    解析索引区，返回：
    [{header, year, idx_start, idx_end, first_msg_title_norm}]
    """
    header_indices = [i for i in range(DETAIL_START)
                      if is_section_header(lines, i)]
    sections = []
    for k, idx_start in enumerate(header_indices):
        idx_end = header_indices[k + 1] - 1 if k + 1 < len(header_indices) else DETAIL_START - 1
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


def write_sections(sections: list, lines: list, detail_index: list):
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

    # 构建 detail_index 的搜索上界：第 k 个训练搜索范围 first_msg_line < next_k 的 first_msg_line
    # 我们按顺序匹配：sections 顺序 == detail sections 顺序
    # 先找每个训练对应的 detail range
    matched_detail: dict[int, tuple[int, int]] = {}  # idx_start -> (detail_start, detail_end)

    search_after = DETAIL_START
    for k, sec in enumerate(sections):
        norm_title = sec['first_msg_norm']
        if not norm_title:
            continue
        # 搜索范围：search_after ~ n
        result = find_detail_range(detail_sorted, norm_title, search_after, n)
        if result is None:
            print(f"[未匹配详细内容] {sec['header']!r}  first_msg={norm_title!r}")
            continue
        sec_start, first_msg_line = result
        search_after = first_msg_line + 1  # 下次从这之后搜索
        matched_detail[sec['idx_start']] = (sec_start, first_msg_line)

    # 确定每个 detail range 的结束行（= 下个训练 detail 起始行 - 1）
    idx_list = [s['idx_start'] for s in sections]
    for i, sec in enumerate(sections):
        if sec['idx_start'] not in matched_detail:
            continue
        d_start, _ = matched_detail[sec['idx_start']]
        # 找下一个有 detail 的训练
        next_d_start = n
        for j in range(i + 1, len(sections)):
            nxt = sections[j]
            if nxt['idx_start'] in matched_detail:
                next_d_start = matched_detail[nxt['idx_start']][0]
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
    print(f"读取文件: {INPUT_FILE}")
    with open(INPUT_FILE, encoding='utf-8') as f:
        lines = f.readlines()
    print(f"总行数: {len(lines):,}")

    print("解析索引区章节...")
    sections = parse_index_sections(lines)
    print(f"识别到 {len(sections)} 个训练/特会章节")

    print("构建详细内容区索引...")
    detail_index = build_detail_index(lines)
    print(f"详细区 第一篇 条目数: {len(detail_index)}")

    year_stat: dict[int, int] = {}
    for sec in sections:
        year_stat[sec['year']] = year_stat.get(sec['year'], 0) + 1
    for y in sorted(year_stat):
        print(f"  {y}: {year_stat[y]} 个训练")

    print(f"\n写入文件到 {OUTPUT_DIR}/")
    write_sections(sections, lines, detail_index)
    print("\n完成！")


if __name__ == '__main__':
    main()
