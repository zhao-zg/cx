"""
export_bible_html_js.py
=======================
从 resource/bible/ 下 1189 个 HTML 文件（圣经恢复本带注解串珠）
生成三个懒加载 JSON 数据文件：
  output/data/bible-text.json   -- 全本圣经经文  (~4 MB)
  output/data/bible-notes.json  -- 注解数据      (~9 MB)
  output/data/bible-xrefs.json  -- 串珠数据      (~1 MB)

数据格式（均为纯 JSON）：
  bible-text.json:
    {"创1:1":"{1}[a]起初{2}神{3}[b]创造...","创1:2上":...}

  bible-notes.json:
    {"创1:1":{"1":"注解文字..."},...}

  bible-xrefs.json:
    {"创1:1":{"a":"约1:1,约1:2","b":"亚12:1,诗33:6"},...}

用法：
  python export_bible_html_js.py             # 完整导出
  python export_bible_html_js.py --inspect   # 调试，不写文件，输出前2文件解析结果
"""

import os, re, sys, json
from pathlib import Path

try:
    from bs4 import BeautifulSoup
except ImportError:
    print("ERROR: pip install beautifulsoup4")
    sys.exit(1)

BIBLE_DIR  = os.path.join(os.path.dirname(__file__), "resource", "bible")
OUT_DIR    = os.path.join(os.path.dirname(__file__), "src", "static", "data")
OUT_TEXT   = os.path.join(OUT_DIR, "bible-text.json")
OUT_NOTES  = os.path.join(OUT_DIR, "bible-notes.json")
OUT_XREFS  = os.path.join(OUT_DIR, "bible-xrefs.json")

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

# ── 汉字章节数词 → 整数（标准讲法：四十=40，一百五十=150）──────────
_CN = {"〇":0,"○":0,"零":0,"一":1,"二":2,"三":3,"四":4,"五":5,"六":6,"七":7,"八":8,"九":9}

def cn_to_int(s):
    """将汉字数词或逐位数字串转为整数。
    支持：一二二=122（诗篇逐位），四十=40，一百五十=150。
    """
    s = s.strip()
    if not s:
        return 0
    # 如果含"百"或"十" → 标准数词
    if "百" in s or "十" in s:
        r = 0
        if "百" in s:
            i = s.index("百")
            h = s[:i]
            r += (_CN.get(h, 1) if h else 1) * 100
            s = s[i+1:]
        if "十" in s:
            i = s.index("十")
            t = s[:i]
            r += (_CN.get(t, 0) if t else 1) * 10
            s = s[i+1:]
        for c in s:
            r += _CN.get(c, 0)
        return r
    # 否则逐位（诗篇：一二二=1*100+2*10+2=122，或 一=1）
    digits = [_CN.get(c, 0) for c in s]
    n = len(digits)
    if n == 1:
        return digits[0]
    if n == 2:
        return digits[0] * 10 + digits[1]
    if n == 3:
        return digits[0] * 100 + digits[1] * 10 + digits[2]
    return int("".join(str(d) for d in digits))


# ── 从 HTML 中提取书卷简写和章节号 ───────────────────────────────
_RE_CHAP_P   = re.compile(r'<p[^>]*id="chap"[^>]*>\s*([^<]+?)\s*</p>', re.I)
_RE_TITLE_CH = re.compile(r'第([一二三四五六七八九十百零〇○]+)[章篇]', re.I)

def extract_book_chapter(html):
    m_book = _RE_CHAP_P.search(html)
    book_full = m_book.group(1).strip() if m_book else ""
    abbrev = BOOK_MAP.get(book_full, "")
    m_ch = _RE_TITLE_CH.search(html)
    ch = cn_to_int(m_ch.group(1)) if m_ch else 0
    return abbrev, ch


# ── 正则替换 dt 内上标 ─────────────────────────────────────────────
_RE_UUZ1 = re.compile(r'<sup[^>]*id="uuz1"[^>]*>(\d+)</sup>', re.I)
_RE_UUZ  = re.compile(r'<sup[^>]*id="uuz"[^>]*>([^<]+)</sup>', re.I)
_RE_SX   = re.compile(r'<sup[^>]*id="sx"[^>]*>[上下]</sup>', re.I)
_RE_TAG  = re.compile(r'<[^>]+>')
_RE_VNUM = re.compile(r'^\s*(\d+)(<sup[^>]*id="sx"[^>]*>([上下])</sup>)?\s*[　\s]*', re.I)

def _parse_marked_html(raw_inner):
    """将 HTML 片段中的 uuz1/uuz/sx sup 转换为标记符号，返回纯文本。"""
    body = _RE_UUZ1.sub(r"{\1}", raw_inner)
    body = _RE_UUZ.sub(r"[\1]", body)
    body = _RE_SX.sub("", body)
    body = _RE_TAG.sub("", body).strip()
    return body


def parse_dt(dt_tag):
    """返回 (verse_num, half, text_with_markers)。
    
    支持两种格式：
    - Format A: DT 直接包含带标记的经文（uuz1/uuz sup）
    - Format B: DT 包含 <a href='...'>N</a> 节号 + 纯文本，真正带标记的文本在 AA00 段落
      此时返回 (vnum, half, None)，由 parse_file 从 AA00 补充。
    """
    raw = dt_tag.decode_contents()
    
    # Format B 检测：节号在 <a> 标签内
    a_tag = dt_tag.find('a')
    if a_tag:
        vnum_text = a_tag.get_text(strip=True)
        if vnum_text.isdigit():
            return vnum_text, '', None  # 信号：由 parse_file 查 AA00
    
    # Format A：节号直接在文本中
    m = _RE_VNUM.match(raw)
    if not m:
        return None, None, None
    vnum = m.group(1)
    sx_m = re.search(r'<sup[^>]*id="sx"[^>]*>([上下])</sup>', m.group(0), re.I)
    half = sx_m.group(1) if sx_m else ""
    body = _parse_marked_html(raw[m.end():])
    return vnum, half, body


def parse_aa00(dd_tag):
    """从 DD 中的 <p id='AA00'> 提取带标记的经文文本。
    
    AA00 格式：节号[上下]　marked_text
    返回 (half, body) 或 ('', None) 若无 AA00。
    """
    aa00 = dd_tag.find('p', id='AA00')
    if not aa00:
        return '', None
    raw = aa00.decode_contents()
    # 去掉开头的节号（可能带上/下）和空白
    raw = re.sub(r'^\s*\d+\s*(?:<sup[^>]*id="sx"[^>]*>([上下])</sup>)?\s*[\u3000\s]*', '', raw, flags=re.I)
    body = _parse_marked_html(raw)
    # 提取上/下
    aa00_raw = aa00.decode_contents()
    sx_m = re.search(r'^\s*\d+\s*<sup[^>]*id="sx"[^>]*>([上下])</sup>', aa00_raw, re.I)
    half = sx_m.group(1) if sx_m else ''
    return half, body if body else None


def parse_ddt(div_tag):
    """解析 <div id="ddt"> 独立经节（无注解串珠）。
    
    Format C：无注脚/串珠的节存放于 <div id="ddt">节号[上下]　经文</div>
    返回 (verse_num, half, text)，失败时返回 (None, None, None)。
    """
    raw = div_tag.decode_contents()
    m = _RE_VNUM.match(raw)
    if not m:
        return None, None, None
    vnum = m.group(1)
    sx_m = re.search(r'<sup[^>]*id="sx"[^>]*>([上下])</sup>', m.group(0), re.I)
    half = sx_m.group(1) if sx_m else ""
    body = _parse_marked_html(raw[m.end():])
    return vnum, half, body



_RE_BR      = re.compile(r'<br\s*/?>', re.I)
_RE_VKEY    = re.compile(
    r'^([创出利民申书士得撒王代拉尼斯伯诗箴传歌赛耶哀结但何珥摩俄拿弥鸿哈番该亚玛'
    r'太可路约徒罗林加弗腓西帖提门多彼犹启来雅][后前上下壹贰叁]?\d+:\d+[上下]?)\s'
)

def _bb2_keys(bb2_p):
    raw = bb2_p.decode_contents()
    keys = []
    for seg in _RE_BR.split(raw):
        text = _RE_TAG.sub("", seg).strip()
        m = _RE_VKEY.match(text)
        if m:
            keys.append(m.group(1))
    return keys

def parse_dd(dd_tag):
    """返回 (notes_dict, xrefs_dict)。"""
    notes, xrefs = {}, {}
    ps = dd_tag.find_all("p", recursive=False)
    i = 0
    while i < len(ps):
        pid = ps[i].get("id", "")
        if pid == "AA1":
            zhu = ps[i].find("sup", id="zhu")
            num = zhu.get_text(strip=True) if zhu else ""
            if num and i+1 < len(ps) and ps[i+1].get("id") == "AA2":
                # 将 <br> 替换为 \n，保留段落分隔
                aa2_html = str(ps[i+1])
                aa2_html = _RE_BR.sub("\n", aa2_html)
                aa2_soup = BeautifulSoup(aa2_html, "lxml")
                text = aa2_soup.get_text(separator="", strip=False).strip()
                # 规整多余空行：连续\n超过2个压缩为2个，并清理行首尾空格
                text = re.sub(r'[ \t]+', ' ', text)
                text = re.sub(r'\n{3,}', '\n\n', text)
                text = re.sub(r'^ | $', '', text, flags=re.MULTILINE)
                text = text.strip()
                if text:
                    notes[num] = text
            i += 2
            continue
        if pid == "BB1":
            ch_sup = ps[i].find("sup", id="chuan")
            letter = ch_sup.get_text(strip=True) if ch_sup else ""
            if letter and i+1 < len(ps) and ps[i+1].get("id") == "BB2":
                keys = _bb2_keys(ps[i+1])
                if keys:
                    xrefs[letter] = ",".join(keys)
            i += 2
            continue
        i += 1
    return notes, xrefs


def parse_file(fp):
    with open(fp, encoding="utf-8", errors="ignore") as f:
        html = f.read()
    abbrev, ch = extract_book_chapter(html)
    if not abbrev or not ch:
        return {}, {}, {}
    soup = BeautifulSoup(html, "lxml")
    texts, notes_all, xrefs_all = {}, {}, {}

    # ── Format A/B: <dl><dt>…</dt><dd>…</dd></dl> ───────────────────
    for dl in soup.find_all("dl"):
        dts = dl.find_all("dt", recursive=False)
        dds = dl.find_all("dd", recursive=False)
        for dt, dd in zip(dts, dds):
            vnum, half, vtext = parse_dt(dt)
            if not vnum:
                continue
            # Format B：DT 无标记，从 DD 的 AA00 段落补充
            if vtext is None:
                aa00_half, aa00_text = parse_aa00(dd)
                vtext = aa00_text
                if aa00_half:
                    half = aa00_half
            key = f"{abbrev}{ch}:{vnum}{half}"
            if vtext and key not in texts:
                texts[key] = vtext
            notes, xrefs = parse_dd(dd)
            if notes:
                notes_all[key] = notes
            if xrefs:
                xrefs_all[key] = xrefs

    # ── Format C: <div id="ddt">…</div> 独立经节（无注解串珠）────────
    faq = soup.find(id="faq")
    if faq:
        for div in faq.find_all("div", id="ddt"):
            vnum, half, vtext = parse_ddt(div)
            if not vnum:
                continue
            key = f"{abbrev}{ch}:{vnum}{half}"
            if vtext and key not in texts:   # 勿覆盖已从 DL 解析的节
                texts[key] = vtext

    return texts, notes_all, xrefs_all


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    kb = os.path.getsize(path) / 1024
    print(f"  {os.path.basename(path)}: {len(data)} \u689d, {kb:.0f} KB ({kb/1024:.1f} MB)")


def main():
    inspect = "--inspect" in sys.argv
    files = sorted(Path(BIBLE_DIR).glob("*.html"))
    files = [f for f in files if re.match(r"\d{4}\.html$", f.name)]
    print(f"找到 {len(files)} 个 HTML 文件")

    all_texts, all_notes, all_xrefs = {}, {}, {}
    skipped = []

    for idx, fp in enumerate(files, 1):
        t, n, x = parse_file(fp)
        if not t:
            skipped.append(fp.name)
        else:
            all_texts.update(t)
            all_notes.update(n)
            all_xrefs.update(x)

        if inspect and idx <= 2:
            abbrev, ch = extract_book_chapter(open(fp, encoding='utf-8', errors='ignore').read())
            print(f"\n=== {fp.name}  ({abbrev}{ch}章, {len(t)} 节, {len(n)} 注, {len(x)} 串) ===")
            for k, v in list(t.items())[:4]:
                print(f"  文本 {k}: {v[:80]}")
            for k, nm in list(n.items())[:2]:
                for nk, nv in list(nm.items())[:2]:
                    print(f"  注解 {k}[{nk}]: {nv[:80]}")
            for k, xm in list(x.items())[:2]:
                for xk, xv in list(xm.items())[:2]:
                    print(f"  串珠 {k}[{xk}]: {xv[:80]}")

        if idx % 200 == 0 or idx == len(files):
            print(f"  [{idx}/{len(files)}]  经文 {len(all_texts)} 节  "
                  f"注解 {len(all_notes)} 节  串珠 {len(all_xrefs)} 节")

    if inspect:
        print("\n--inspect 模式，不写文件。")
        sys.exit(0)

    if skipped:
        print(f"\n跳过 {len(skipped)} 个: {skipped[:8]}")

    print(f"\n共解析 {len(all_texts)} 节经文 / {len(all_notes)} 节含注解 / {len(all_xrefs)} 节含串珠")
    print("写入 JSON 文件...")
    write_json(OUT_TEXT,  all_texts)
    write_json(OUT_NOTES, all_notes)
    write_json(OUT_XREFS, all_xrefs)
    print("完成！")


if __name__ == "__main__":
    main()
