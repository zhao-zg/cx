"""
compare_bible.py
================
比较 resource/bible/（bible1）与 resource/bible2/（bible2）的经文差异。

忽略以下字符替换（视为相同）：
  唯/惟   么/吗   的/地   哪/那

用法：
  python compare_bible.py              # 生成 bible_compare_report.txt 和 .html
  python compare_bible.py --txt-only   # 只生成 txt
"""

import os, re, sys, json
from pathlib import Path

try:
    from bs4 import BeautifulSoup
except ImportError:
    print("ERROR: pip install beautifulsoup4")
    sys.exit(1)

# ── 目录配置 ──────────────────────────────────────────────────────
BIBLE1_DIR = os.path.join(os.path.dirname(__file__), "resource", "bible")
BIBLE2_DIR = os.path.join(os.path.dirname(__file__), "resource", "bible2")

# ── 忽略的字符对（双向等价替换）──────────────────────────────────
_EQUIV_PAIRS = [
    ("唯", "惟"),
    ("么", "吗"),
    ("的", "地"),
    ("哪", "那"),
]

def _normalize(text: str) -> str:
    """将文本中的等价字符统一替换为第一个字符。"""
    for a, b in _EQUIV_PAIRS:
        text = text.replace(b, a)
    return text

# ── 汉字数词 → 整数 ───────────────────────────────────────────────
_CN = {"〇":0,"○":0,"零":0,"一":1,"二":2,"三":3,"四":4,"五":5,
       "六":6,"七":7,"八":8,"九":9}

def cn_to_int(s):
    s = s.strip()
    if not s:
        return 0
    if "百" in s or "十" in s:
        r = 0
        if "百" in s:
            i = s.index("百"); h = s[:i]
            r += (_CN.get(h, 1) if h else 1) * 100; s = s[i+1:]
        if "十" in s:
            i = s.index("十"); t = s[:i]
            r += (_CN.get(t, 0) if t else 1) * 10; s = s[i+1:]
        for c in s: r += _CN.get(c, 0)
        return r
    digits = [_CN.get(c, 0) for c in s]
    n = len(digits)
    if n == 1: return digits[0]
    if n == 2: return digits[0]*10 + digits[1]
    if n == 3: return digits[0]*100 + digits[1]*10 + digits[2]
    return int("".join(str(d) for d in digits))

# ── 书卷全名 → 简写 ───────────────────────────────────────────────
BOOK_MAP = {
    "创世记":"创","出埃及记":"出","利未记":"利","民数记":"民","申命记":"申",
    "约书亚记":"书","士师记":"士","路得记":"得","撒母耳记上":"撒上","撒母耳记下":"撒下",
    "列王纪上":"王上","列王纪下":"王下","历代志上":"代上","历代志下":"代下",
    "以斯拉记":"拉","尼希米记":"尼","以斯帖记":"斯","约伯记":"伯",
    "诗篇":"诗","箴言":"箴","传道书":"传","雅歌":"歌",
    "以赛亚书":"赛","耶利米书":"耶","耶利米哀歌":"哀","以西结书":"结","但以理书":"但",
    "何西阿书":"何","约珥书":"珥","阿摩司书":"摩","俄巴底亚书":"俄","约拿书":"拿",
    "弥迦书":"弥","那鸿书":"鸿","哈巴谷书":"哈","西番雅书":"番","哈该书":"该",
    "撒迦利亚书":"亚","玛拉基书":"玛",
    "马太福音":"太","马可福音":"可","路加福音":"路","约翰福音":"约","使徒行传":"徒",
    "罗马书":"罗","哥林多前书":"林前","哥林多后书":"林后","加拉太书":"加",
    "以弗所书":"弗","腓立比书":"腓","歌罗西书":"西","帖撒罗尼迦前书":"帖前",
    "帖撒罗尼迦后书":"帖后","提摩太前书":"提前","提摩太后书":"提后",
    "提多书":"多","腓利门书":"门","希伯来书":"来","雅各书":"雅",
    "彼得前书":"彼前","彼得后书":"彼后","约翰壹书":"约壹","约翰贰书":"约贰",
    "约翰叁书":"约叁","犹大书":"犹","启示录":"启",
}

# ── HTML 标记正则 ──────────────────────────────────────────────────
_RE_CHAP_P   = re.compile(r'<p[^>]*id="chap"[^>]*>\s*([^<]+?)\s*</p>', re.I)
_RE_TITLE_B2 = re.compile(r'《圣经》([^第]+?)第([一二三四五六七八九十百零〇○]+)[章篇]', re.I)
_RE_TITLE_CH = re.compile(r'第([一二三四五六七八九十百零〇○]+)[章篇]', re.I)
_RE_UUZ1 = re.compile(r'<sup[^>]*id="uuz1"[^>]*>(\d+)</sup>', re.I)
_RE_UUZ  = re.compile(r'<sup[^>]*id="uuz"[^>]*>([^<]+)</sup>', re.I)
_RE_SX   = re.compile(r'<sup[^>]*id="sx"[^>]*>[上下]</sup>', re.I)
_RE_TAG  = re.compile(r'<[^>]+>')
_RE_VNUM = re.compile(r'^\s*(\d+)(<sup[^>]*id="sx"[^>]*>([上下])</sup>)?\s*[　\s]*', re.I)

def _parse_marked_html(raw_inner):
    body = _RE_UUZ1.sub(r"{\1}", raw_inner)
    body = _RE_UUZ.sub(r"[\1]", body)
    body = _RE_SX.sub("", body)
    body = _RE_TAG.sub("", body).strip()
    return body

# 匹配含变音符号字母的拼音注音，如 [xǐng]、[chéng] 等
_RE_PINYIN = re.compile(
    r'\[[a-zA-Z\u0101\u00e1\u01ce\u00e0\u0113\u00e9\u011b\u00e8'
    r'\u012b\u00ed\u01d0\u00ec\u014d\u00f3\u01d2\u00f2\u016b\u00fa\u01d4\u00f9'
    r'\u01d6\u01d8\u01da\u01dc\u00fc\u00c4\u00e4\u00dc\u00f6\u00d6\-]+\]',
    re.UNICODE
)

def _strip_markers(text: str) -> str:
    """去掉 {N}、[a] 字母上标和拼音注音 [xǐng] 等，只保留纯文字用于比较。"""
    text = re.sub(r'\{\d+\}', '', text)
    # 先去拼音（含变音符号的字母串），再去单字母上标
    text = _RE_PINYIN.sub('', text)
    text = re.sub(r'\[[a-zA-Z0-9]+\]', '', text)
    return text.strip()

def _extract_book_chapter_b1(html):
    m_book = _RE_CHAP_P.search(html)
    book_full = m_book.group(1).strip() if m_book else ""
    abbrev = BOOK_MAP.get(book_full, "")
    m_ch = _RE_TITLE_CH.search(html)
    ch = cn_to_int(m_ch.group(1)) if m_ch else 0
    return abbrev, ch

def _extract_book_chapter_b2(html):
    """bible2 无 <p id='chap'>, 从 <title> 中提取书名和章节。"""
    m = _RE_TITLE_B2.search(html)
    if not m:
        return "", 0
    book_full = m.group(1).strip()
    abbrev = BOOK_MAP.get(book_full, "")
    ch = cn_to_int(m.group(2))
    return abbrev, ch

_RE_A_VNUM = re.compile(r'^(\d+)(?:<sup[^>]*id="sx"[^>]*>([上下])</sup>)?$', re.I)

def _parse_a_vnum(a_tag):
    """从 <a> 标签中提取节号和上/下，支持 '1' 和 '1<sup id="sx">上</sup>' 两种格式。"""
    a_html = a_tag.decode_contents()
    m = _RE_A_VNUM.match(a_html.strip())
    if m:
        return m.group(1), m.group(2) or ''
    return None, None

def parse_dt(dt_tag):
    raw = dt_tag.decode_contents()
    a_tag = dt_tag.find('a')
    if a_tag:
        vnum, half = _parse_a_vnum(a_tag)
        if vnum:
            return vnum, half, None
    m = _RE_VNUM.match(raw)
    if not m:
        return None, None, None
    vnum = m.group(1)
    sx_m = re.search(r'<sup[^>]*id="sx"[^>]*>([上下])</sup>', m.group(0), re.I)
    half = sx_m.group(1) if sx_m else ""
    body = _parse_marked_html(raw[m.end():])
    return vnum, half, body

def parse_aa00(dd_tag):
    aa00 = dd_tag.find('p', id='AA00')
    if not aa00:
        return '', None
    raw = aa00.decode_contents()
    raw = re.sub(r'^\s*\d+\s*(?:<sup[^>]*id="sx"[^>]*>[上下]</sup>)?\s*[　\s]*', '', raw, flags=re.I)
    body = _parse_marked_html(raw)
    aa00_raw = aa00.decode_contents()
    sx_m = re.search(r'^\s*\d+\s*<sup[^>]*id="sx"[^>]*>([上下])</sup>', aa00_raw, re.I)
    half = sx_m.group(1) if sx_m else ''
    return half, body if body else None

def parse_ddt(div_tag):
    """解析 <div id="ddt">，支持两种格式：
    - 纯数字开头：  N　经文文字
    - <a> 链接开头：<a href="...">N</a>　经文文字（bible2 格式）
    """
    # 优先检测 <a> 链接版节号（bible2 格式，含可选上/下 sup）
    a_tag = div_tag.find('a')
    if a_tag:
        vnum, half = _parse_a_vnum(a_tag)
        if vnum:
            a_html = str(a_tag)
            raw = div_tag.decode_contents()
            after = raw[raw.index(a_html) + len(a_html):]
            after = re.sub(r'^[　\s]+', '', after)
            body = _parse_marked_html(after)
            return vnum, half, body
    # 纯数字开头（bible1 格式）
    raw = div_tag.decode_contents()
    m = _RE_VNUM.match(raw)
    if not m:
        return None, None, None
    vnum = m.group(1)
    sx_m = re.search(r'<sup[^>]*id="sx"[^>]*>([上下])</sup>', m.group(0), re.I)
    half = sx_m.group(1) if sx_m else ""
    body = _parse_marked_html(raw[m.end():])
    return vnum, half, body

def parse_file(fp, extract_fn):
    """返回 (texts, file_map)，file_map[key] = 相对路径文件名。"""
    with open(fp, encoding="utf-8", errors="ignore") as f:
        html = f.read()
    abbrev, ch = extract_fn(html)
    if not abbrev or not ch:
        return {}, {}
    fname = os.path.relpath(fp).replace('\\', '/')
    soup = BeautifulSoup(html, "lxml")
    texts = {}
    file_map = {}
    for dl in soup.find_all("dl"):
        dts = dl.find_all("dt", recursive=False)
        dds = dl.find_all("dd", recursive=False)
        for dt, dd in zip(dts, dds):
            vnum, half, vtext = parse_dt(dt)
            if not vnum or vnum == "0":
                continue
            if vtext is None:
                aa00_half, aa00_text = (parse_aa00(dd) if dd else ('', None))
                vtext = aa00_text
                if aa00_half:
                    half = aa00_half
            key = f"{abbrev}{ch}:{vnum}{half}"
            if vtext and key not in texts:
                texts[key] = vtext
                file_map[key] = fname
    faq = soup.find(id="faq")
    if faq:
        for div in faq.find_all("div", id="ddt"):
            vnum, half, vtext = parse_ddt(div)
            if not vnum or vnum == "0":
                continue
            key = f"{abbrev}{ch}:{vnum}{half}"
            if vtext and key not in texts:
                texts[key] = vtext
                file_map[key] = fname
    return texts, file_map


def load_bible(bible_dir, extract_fn, pattern):
    files = sorted(Path(bible_dir).glob(pattern))
    all_texts = {}
    all_file_map = {}
    for fp in files:
        t, fm = parse_file(fp, extract_fn)
        all_texts.update(t)
        all_file_map.update(fm)
    print(f"  {bible_dir}: {len(files)} 文件, {len(all_texts)} 节")
    return all_texts, all_file_map


def compare(b1: dict, b2: dict, fm1: dict, fm2: dict):
    keys1 = set(b1); keys2 = set(b2)
    only1 = [(k, fm1.get(k, '')) for k in sorted(keys1 - keys2)]
    only2 = [(k, fm2.get(k, '')) for k in sorted(keys2 - keys1)]
    common = sorted(keys1 & keys2)

    diffs = []
    for k in common:
        t1 = _strip_markers(b1[k])
        t2 = _strip_markers(b2[k])
        n1 = _normalize(t1)
        n2 = _normalize(t2)
        if n1 != n2:
            diffs.append((k, b1[k], b2[k], fm1.get(k, ''), fm2.get(k, '')))

    return only1, only2, diffs


# ── 输出报告 ──────────────────────────────────────────────────────

def write_txt(only1, only2, diffs, path):
    lines = []
    L = lines.append
    L("=" * 70)
    L("圣经双源比对报告（忽略等价字：唯/惟 么/吗 的/地 哪/那）")
    L(f"  源1：resource/bible/")
    L(f"  源2：resource/bible2/")
    L("=" * 70)
    L("")
    L("【总体统计】")
    L(f"  仅bible1有：{len(only1)} 节")
    L(f"  仅bible2有：{len(only2)} 节")
    L(f"  文字不同：  {len(diffs)} 节")
    L("")
    L("=" * 70)
    L("一、仅bible1存在（bible2缺少的节）")
    L("=" * 70)
    for k, f1 in only1:
        L(f"  {k}  [{f1}]")
    L("")
    L("=" * 70)
    L("二、仅bible2存在（bible1没有的节）")
    L("=" * 70)
    for k, f2 in only2:
        L(f"  {k}  [{f2}]")
    L("")
    L("=" * 70)
    L(f"三、经文文字不同（共 {len(diffs)} 节）")
    L("=" * 70)
    for i, (k, t1, t2, f1, f2) in enumerate(diffs, 1):
        L("")
        L(f"  [{i}] {k}")
        L(f"  bible1 [{f1}]：{t1}")
        L(f"  bible2 [{f2}]：{t2}")

    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"✓ TXT 报告: {path}")


def _hl(t1, t2):
    """在 HTML 中高亮两段文字的不同字符（字级 diff）。"""
    import difflib
    sm = difflib.SequenceMatcher(None, t1, t2)
    out1, out2 = [], []
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        s1 = t1[i1:i2]; s2 = t2[j1:j2]
        if op == 'equal':
            out1.append(s1); out2.append(s2)
        elif op in ('replace', 'delete', 'insert'):
            if s1: out1.append(f'<mark>{s1}</mark>')
            if s2: out2.append(f'<mark>{s2}</mark>')
    return ''.join(out1), ''.join(out2)


def write_html(only1, only2, diffs, path):
    rows_diff = []
    for k, t1, t2, f1, f2 in diffs:
        h1, h2 = _hl(_strip_markers(t1), _strip_markers(t2))
        rows_diff.append(
            f'<tr>'
            f'<td class="key">{k}</td>'
            f'<td class="v1">{h1}<br><span class="fn">{f1}</span></td>'
            f'<td class="v2">{h2}<br><span class="fn">{f2}</span></td>'
            f'</tr>'
        )

    only1_rows = "".join(f'<li>{k}<br><span class="fn">{f1}</span></li>' for k, f1 in only1)
    only2_rows = "".join(f'<li>{k}<br><span class="fn">{f2}</span></li>' for k, f2 in only2)

    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>圣经双源比对报告</title>
<style>
body{{font-family:sans-serif;font-size:14px;margin:20px}}
h1{{font-size:18px}}
h2{{font-size:15px;border-bottom:1px solid #ccc;padding-bottom:4px;margin-top:30px}}
p{{color:#555;font-size:13px}}
table{{border-collapse:collapse;width:100%}}
th,td{{border:1px solid #ddd;padding:6px 10px;vertical-align:top;word-break:break-all}}
th{{background:#f5f5f5;text-align:center}}
td.key{{width:90px;text-align:center;font-weight:bold;color:#333}}
td.v1{{width:45%;color:#1a5276}}
td.v2{{width:45%;color:#1e8449}}
mark{{background:#fff0b3;border-radius:2px;padding:0 1px}}
ul{{columns:2;column-gap:20px;padding-left:20px}}
li{{break-inside:avoid;margin-bottom:4px}}
.fn{{font-size:11px;color:#888;font-family:monospace}}
.stat{{background:#f8f8f8;border:1px solid #eee;padding:10px 16px;border-radius:4px;margin:10px 0;display:inline-block}}
</style>
</head>
<body>
<h1>圣经双源比对报告</h1>
<p>源1：resource/bible/ &nbsp;|&nbsp; 源2：resource/bible2/<br>
忽略等价字：唯/惟 &nbsp; 么/吗 &nbsp; 的/地 &nbsp; 哪/那</p>
<div class="stat">
  仅bible1有 <b>{len(only1)}</b> 节 &nbsp;|&nbsp;
  仅bible2有 <b>{len(only2)}</b> 节 &nbsp;|&nbsp;
  文字不同 <b>{len(diffs)}</b> 节
</div>

<h2>一、仅bible1存在（bible2缺少，共 {len(only1)} 节）</h2>
<ul>{only1_rows}</ul>

<h2>二、仅bible2存在（bible1没有，共 {len(only2)} 节）</h2>
<ul>{only2_rows}</ul>

<h2>三、经文文字不同（共 {len(diffs)} 节）</h2>
<table>
<thead><tr><th>节</th><th>bible1</th><th>bible2</th></tr></thead>
<tbody>{''.join(rows_diff)}</tbody>
</table>
</body>
</html>"""

    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"✓ HTML报告: {path}")


def main():
    txt_only = "--txt-only" in sys.argv

    print("加载 bible1 ...")
    b1, fm1 = load_bible(BIBLE1_DIR, _extract_book_chapter_b1, "*.html")

    print("加载 bible2 ...")
    b2, fm2 = load_bible(BIBLE2_DIR, _extract_book_chapter_b2, "hf_*.html")

    print("比对中 ...")
    only1, only2, diffs = compare(b1, b2, fm1, fm2)
    print(f"  仅bible1: {len(only1)} | 仅bible2: {len(only2)} | 不同: {len(diffs)}")

    write_txt(only1, only2, diffs, "bible_compare_report.txt")
    if not txt_only:
        write_html(only1, only2, diffs, "bible_compare_report.html")


if __name__ == "__main__":
    main()
