# -*- coding: utf-8 -*-
"""HWMR 双语 PDF → 中英对照 JSON 解析器（正式管线版）

源自 .temp/parse-hwmr.py（probe26~104 定案），参数化改造：
- PDF 路径 / 输出路径 / 元数据由批次配置驱动，去硬编码；
- 页脚过滤正则、周首页篇题归一修正外置到每批配置；
- 几何阈值（栏切分/缩进/段首）保留为模块常量——六本 PDF 版式指纹一致
  （Georgia-Bold/KaiTi/MicrosoftJhengHeiBold、842×595 横排双栏），
  新批次试跑暴露差异再外置。

输出结构与 cx output/<短名>/training.json 对齐，中英平行：
中文字段 + _en 后缀平铺（如 feeding_scriptures / feeding_scriptures_en）。
"""
import re
import json
import datetime
from collections import defaultdict

import pdfplumber

# ===== 几何常量（同版式模板，跨批次迁移需探针验证） =====
COL_SPLIT_X = 350          # 栏切分：CN x0<350 / EN x0>=350
HEADER_TOP = 100           # 页头区域（页面分类）
FOOT_H = 50                # 页脚区域（页面分类）
HEAD_TOP_MIN = 30          # 天头过滤：正文经文/喂养 top>30
CN_L12_X0 = 50             # CN kai L1/L2 段首（kai 续行 x0≈57）
CN_L34_X0 = 60             # CN pming L3/L4 段首（pming 续行 63.3）
CN_L5_X0 = 68              # CN L5（㈠㈡㈢）纯缩进段首 x0≈73.3
EN_HEAD_X0 = 382           # EN 段首阈值（L1=360, L2=367, L3/L4=377~380；续行 380~384）
EN_L5_X0_LO, EN_L5_X0_HI = 392, 401  # EN B 类纯缩进 L5 段首区间
EN_L1_AMBIG_X0 = 364       # E 类罗马二义性：x0>=364 跳过 L1 匹配（字母 I. 恒 367）
EN_FS_MF_X0 = 374          # day 页 feeding 块内 fs(370)/mf(377) 段首分界
EN_PARA_X0 = 363           # EN 正文分段绝对阈值（段首>363）
SCRIPT_EN_CONT_X0 = 365    # EN 读经续行：x0>=365 即停（主行 377/续行 360/展开 384+）
ROW_TOL = 4.0              # 行聚类 y 容差
L1_TOP_GAP = 15            # D 类行距指纹：top 差 <15pt = PDF 排版错位


# ===== 字体分类 =====
def font_kind(fn):
    if isinstance(fn, bytes):
        s = fn.decode('gbk', 'ignore')
    else:
        s = (fn or '').split('+')[-1] if fn else ''
    if 'Emmentaler' in s:
        return 'music'
    if s == 'Arial-BoldMT' or s == 'ArialMT' or 'Times' in s:
        return 'tnr'
    if 'JhengHei' in s or s == 'MicrosoftJhengHeiBold':
        return 'hei'
    if 'Cambria-Bold' in s or 'Georgia-Bold' in s:
        return 'enB'
    if 'Cambria' in s or 'Georgia' in s or 'Calibri' in s:
        return 'en'
    if 'Kai' in s or 'KSh' in s:
        return 'kai'
    if 'Fang' in s or 'FZ' in s or '仿宋' in s:
        return 'fang'
    if 'PMingLiU' in s or 'MingLiU' in s or 'SimSun' in s or 'Song' in s or 'Ming' in s:
        return 'pming'
    if 'Hei' in s or '黑' in s:
        return 'hei'
    return 'en'


# ===== 行聚类 =====
def cluster_x0(words, tol=ROW_TOL, sep=''):
    """按 y 聚行，返回 [(top, x0_first, text)]"""
    words = sorted(words, key=lambda w: (w['top'], w['x0']))
    rows = []
    for w in words:
        if rows and abs(rows[-1][0] - w['top']) < tol:
            rows[-1][1].append(w)
        else:
            rows.append((w['top'], [w]))
    out = []
    for top, ws in rows:
        ws.sort(key=lambda w: w['x0'])
        x0 = ws[0]['x0'] if ws else 0
        out.append((top, x0, sep.join(x['text'] for x in ws)))
    return out


def cluster(words, tol=ROW_TOL, sep=''):
    """按 y 聚行，返回 [(top, text)]"""
    return [(t, txt) for t, x0, txt in cluster_x0(words, tol, sep)]


# ===== 页面提取 =====
def extract_page(page):
    ws = page.extract_words(extra_attrs=['fontname'])
    groups = defaultdict(list)
    for w in ws:
        k = font_kind(w['fontname'])
        if k != 'music':
            groups[k].append(w)
    cn_words = [w for k, g in groups.items() for w in g if w['x0'] < COL_SPLIT_X]
    en_words = [w for k, g in groups.items() for w in g if w['x0'] >= COL_SPLIT_X]
    all_lines = cluster(ws, sep='')
    cn_all = cluster_x0(cn_words, sep='')
    en_all = cluster_x0(en_words, sep=' ')
    cn_font = {k: cluster_x0(groups.get(k, []), sep='')
               for k in ('kai', 'fang', 'pming', 'hei')}
    en_font = {k: cluster_x0(groups.get(k, []), sep=' ')
               for k in ('en', 'enB', 'tnr')}
    return {
        'all_lines': all_lines,
        'cn_all': cn_all,
        'en_all': en_all,
        'cn_font': cn_font,
        'en_font': en_font,
        'height': page.height,
    }


# ===== 页面分类 =====
DAY_HEAD_CN_RE = re.compile(r'第[一二三四五六七八九十]+周\s*周[一二三四五六]')
DAY_HEAD_EN_RE = re.compile(r'WEEK\s*\d+\s*[—-]\s*DAY\s*\d+', re.I)
HYMN_HEAD_RE = re.compile(r'第[一二三四五六七八九十]+周诗歌|WEEK\s*\d+\s*[—-]\s*HYMN', re.I)
PROPHECY_RE = re.compile(r'第[一二三四五六七八九十]+周[•・]?(申言|申言稿)|Composition\s+for\s+prophecy', re.I)
WEEK_START_RE = re.compile(r'^第[一二三四五六七八九十]+周(Week|W\d)')
WEEK_START_EN_RE = re.compile(r'^Week\s+(One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|Eleven|Twelve)\b', re.I)


def classify_page(p):
    all_lines = p['all_lines']
    h = p['height']
    header = [(t, txt) for t, txt in all_lines if t < HEADER_TOP]
    header_text = ''.join(txt for _, txt in header)
    foot = ''.join(txt for t, txt in all_lines if t > h - FOOT_H)
    if DAY_HEAD_CN_RE.search(header_text) or DAY_HEAD_EN_RE.search(header_text):
        return 'day'
    if HYMN_HEAD_RE.search(header_text):
        return 'hymn'
    if PROPHECY_RE.search(header_text):
        return 'other'
    if '标语' in header_text or 'Key Statements' in header_text:
        return 'motto'
    if '申明' in header_text or 'Declaration' in header_text:
        return 'other'
    if header:
        first = header[0][1].strip()
        if WEEK_START_RE.match(first):
            return 'week_start'
    if '纲要' in foot:
        return 'outline'
    if '晨兴圣言' in foot:
        return 'day_cont'
    return 'other'


# ===== 周首页解析 =====
HYMN_CN_RE = re.compile(r'^诗歌[:：]\s*(.+)')
HYMN_EN_RE = re.compile(r'^Hymns[:：]\s*(.+)')
SCRIPTURE_CN_RE = re.compile(r'读经[:：]')
SCRIPTURE_EN_RE = re.compile(r'Scripture\s*Reading[:：]?', re.I)
HYMN_MAP = {'补': '补充本', '大': '大本'}


def parse_week_head(p, title_fixes):
    cn_all = p['cn_all']
    en_all = p['en_all']
    cn_kai = p['cn_font'].get('kai', [])
    title_cn = ''
    for top, x0, t in cn_kai[1:]:
        s = t.strip()
        if s.startswith('诗歌') or s.startswith('读经'):
            break
        title_cn += s
    # 批次配置的篇题归一修正（对齐 OLD 人工校对差异，probe60 定案）：
    # 列表元素为 [pattern, replacement]，按 re.sub 处理
    for pat, rep in title_fixes:
        title_cn = re.sub(pat, rep, title_cn)
    title_en = ''
    for top, x0, t in en_all:
        s = t.strip()
        if top < 120 and re.match(r'^[A-Z]', s) and not re.match(r'^Week\s', s, re.I):
            title_en = s
            break
    hymn_cn = ''
    for top, x0, t in cn_all:
        m = HYMN_CN_RE.match(t.strip())
        if m:
            hymn_cn = m.group(1).strip()
            break
    hymn_en = ''
    for top, x0, t in en_all:
        m = HYMN_EN_RE.match(t.strip())
        if m:
            hymn_en = m.group(1).strip()
            break
    m = re.match(r'^(补|大)(\d+)$', hymn_cn.strip())
    if m:
        hymn_cn = HYMN_MAP[m.group(1)] + m.group(2) + '首'

    scripture_cn = ''
    for i, (top, x0, t) in enumerate(cn_all):
        if SCRIPTURE_CN_RE.search(t):
            cur = SCRIPTURE_CN_RE.sub('', t).strip()
            for top2, x02, t2 in cn_all[i + 1:]:
                s2 = t2.strip()
                if x02 <= x0 or SCRIPTURE_CN_RE.search(s2) or HYMN_CN_RE.match(s2) \
                        or s2.startswith('第') or not s2:
                    break
                if '：' in s2[:4] or ':' in s2[:6]:
                    break
                cur += s2
            scripture_cn = cur
            break
    scripture_en = ''
    en_stream = p['en_font'].get('en', [])
    for i, (top, x0, t) in enumerate(en_stream):
        if SCRIPTURE_EN_RE.search(t):
            cur = SCRIPTURE_EN_RE.sub('', t).strip()
            for top2, x02, t2 in en_stream[i + 1:]:
                s2 = t2.strip()
                if x02 >= SCRIPT_EN_CONT_X0 or SCRIPTURE_EN_RE.search(s2) \
                        or HYMN_EN_RE.match(s2) or not s2 \
                        or re.match(r'^WEEK\s*\d+', s2, re.I) or s2.startswith('§'):
                    break
                cur += ' ' + s2
            scripture_en = cur
            break
    return title_cn, title_en, hymn_cn, hymn_en, scripture_cn, scripture_en


# ===== 诗歌页解析 =====
def parse_hymn_page(p):
    cn_all = p['cn_all']
    en_all = p['en_all']
    hymn_cn = ''
    for top, x0, t in cn_all:
        m = HYMN_CN_RE.match(t.strip())
        if m:
            hymn_cn = m.group(1).strip()
            break
    hymn_en = ''
    for top, x0, t in en_all:
        m = HYMN_EN_RE.match(t.strip())
        if m:
            hymn_en = m.group(1).strip()
            break
    return hymn_cn, hymn_en


# ===== 标语页解析 =====
def parse_mottos(p):
    cn_all = p['cn_all']
    en_all = p['en_all']
    cn_mottos = []
    cur = ''
    for top, x0, t in cn_all:
        s = t.strip()
        if not s or '标语' in s:
            continue
        if re.match(r'^[㈠㈡㈢㈣]', s):
            if cur:
                cn_mottos.append(cur)
            cur = re.sub(r'^[㈠㈡㈢㈣]\s*', '', s)
        else:
            cur += s if cur else s
    if cur:
        cn_mottos.append(cur)
    en_mottos = []
    cur = ''
    for top, x0, t in en_all:
        s = t.strip()
        if not s or 'Key Statements' in s:
            continue
        if re.match(r'^[①②③④]', s):
            if cur:
                en_mottos.append(cur)
            cur = re.sub(r'^[①②③④]\s*', '', s)
        else:
            cur += (' ' + s) if cur else s
    if cur:
        en_mottos.append(cur)
    mottos = []
    for i in range(max(len(cn_mottos), len(en_mottos))):
        cn = cn_mottos[i] if i < len(cn_mottos) else ''
        en = en_mottos[i] if i < len(en_mottos) else ''
        mottos.append(cn + en)
    return mottos


# ===== 纲要解析 =====
DAY_MARK_RE = re.compile(r'【([^】]{1,20})】')
L1_RE = re.compile(r'^(壹|贰|叁|肆|伍|陆|柒|捌|玖|拾)')
L2_RE = re.compile(r'^([一二三四五六七八九十])')
L3_RE = re.compile(r'^(\d{1,2})')
L4_RE = re.compile(r'^([a-h])(?![A-Za-z0-9])')  # CN L4 无点形式（probe72 定案）
EN_L1_RE = re.compile(r'^([IVX]+)\.\s')
EN_L2_RE = re.compile(r'^([A-Z])\.\s')
EN_L3_RE = re.compile(r'^(\d{1,2})\.\s')
EN_L4_RE = re.compile(r'^([a-h])\.\s')
EN_L5_RE = re.compile(r'^(\d{1,2})\)\s')   # EN L5：'1) …'（x0=377）
EN_L6_RE = re.compile(r'^([a-h])\)\s')     # EN L6：'a) …'（x0=377，probe74 ch6 day3）
L1_SET = {'壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖', '拾'}
CN_L2_SET = {'一', '二', '三', '四', '五', '六', '七', '八', '九', '十'}
PICK_FOLD = {'拾壹': '壹', '拾贰': '贰', '拾叁': '叁', '拾肆': '肆', '拾伍': '伍'}
PICK_FOLD_11 = {'十一': '一', '十二': '二', '十三': '三', '十四': '四', '十五': '五'}


def day_list_from_mark(s):
    days = []
    for m in re.finditer(r'周([一二三四五六日])', s):
        days.append('一二三四五六日'.index(m.group(1)) + 1)
    return days


def parse_outline_level(s, is_en=False, x0=None):
    s = s.strip()
    if not s:
        return None, s
    s2 = DAY_MARK_RE.sub('', s).strip()
    if not s2:
        return None, s2
    if is_en:
        for r, suf in ((EN_L1_RE, ''), (EN_L2_RE, '.'), (EN_L3_RE, '.'),
                       (EN_L4_RE, '.'), (EN_L5_RE, ')'), (EN_L6_RE, ')')):
            # E 类（probe102 定案）：I./V./X. 二义性——真罗马数字 L1 恒 x0=360，
            # 字母 L2 恒 x0=367。x0>=364 时跳过 L1 匹配，让字母 I. 落到 L2 档。
            if r is EN_L1_RE and x0 is not None and round(x0) >= EN_L1_AMBIG_X0:
                continue
            m = r.match(s2)
            if m:
                return m.group(1) + suf, s2[m.end():].strip()
    else:
        # 折叠：十一~十五 → 十 + 「一　~ 五　」；拾壹~拾伍 → 拾 + 「壹　~ 伍　」
        m = re.match(r'^(十一|十二|十三|十四|十五)', s2)
        if m:
            ordinal = m.group(1)
            return '十', PICK_FOLD_11[ordinal] + '　' + s2[m.end():].strip()
        m = re.match(r'^(拾壹|拾贰|拾叁|拾肆|拾伍)', s2)
        if m:
            ordinal = m.group(1)
            return '拾', PICK_FOLD[ordinal] + '　' + s2[m.end():].strip()
        for r in (L1_RE, L2_RE, L3_RE, L4_RE):
            m = r.match(s2)
            if m:
                lv = m.group(1)
                rest = s2[m.end():].strip()
                return lv, rest  # CN 全部 level 无后缀（L4 'a' 对齐旧 JSON，probe73 定案）
    return None, s2


def outline_flat_nodes(lines, is_en=False):
    """行列表 → 扁平节点。lines: [(top, x0, text, kind)]

    段首判定采用「字体+缩进」双条件，防跨页续行被误判为新节点：
    - CN: kai 且 x0<50 → L1/L2 段首候选；pming 且 x0<60 → L3/L4 段首候选；
          x0>68 的 pming 纯缩进行是 L5（㈠㈡㈢）段首；
          其余（含 kai 续行 x0≈57、pming 续行 63.3、hei 任何行）并入前一 title。
    - EN: 段首阈值 x0<382（L1=360, L2=367, L3/L4=377~380；续行 380~384）；
          x0∈[392,401] 的纯缩进行是 B 类 L5 段首（PDF 无前缀，L4 上下文门控）。

    B 类修复（probe94/95/99 定案）：EN 侧 x0∈[392,401] 纯缩进行是 L5 段首
    （如 p34/p35 'Linking faith...'），L4 上下文门控防周首页标题第二行误判，
    合成 '1)' '2)'… 编号（随新 L4/L5 段首重置）。
    C 类修复（probe94/99 定案）：EN L6（a)~h) 前缀）拍平进前一 L5 节点 title。
    """
    nodes = []
    l5_seq = 0       # L5 序号（CN ㈠㈡㈢ / EN 1)2)3)），随新 L4+ 段首重置
    l4_active = False  # EN L4 上下文门控（B 类合成 L5 仅在 L4 之后生效）
    last_l1_idx, last_l1_top = None, None  # D 类：最近 L1 罗马段首（索引/top）
    for line in lines:
        top, x0, text = line[0], line[1], line[2]
        kind = line[3] if len(line) > 3 else ('en' if is_en else 'kai')
        s = text.strip()
        if not s:
            continue
        if is_en and re.match(r'^§\s*Day', s):
            continue
        # A 类兜底（probe94 定案）：「§ Day N」标记与段首行同视觉行，剥到行尾安全
        if is_en and '§' in s:
            s = re.sub(r'§\s*Day\s*\d.*$', '', s).strip()
            if not s:
                continue
        if DAY_MARK_RE.match(s):
            s = DAY_MARK_RE.sub('', s).strip()
            if not s:
                continue
        # 段首几何判定
        if is_en:
            # B 类：纯缩进 L5 段首，必须在 is_head 之前拦截
            if EN_L5_X0_LO <= round(x0) <= EN_L5_X0_HI:
                if l4_active and nodes:
                    l5_seq += 1
                    nodes.append({'level': f'{l5_seq})', 'title': s,
                                  'content': [], 'children': []})
                elif nodes:
                    nodes[-1]['title'] += s
                continue
            is_head = x0 < EN_HEAD_X0
        else:
            if kind == 'kai':
                is_head = x0 < CN_L12_X0
            elif kind == 'pming':
                if x0 > CN_L5_X0:
                    # L5（㈠㈡㈢）段首：PDF 无前缀纯缩进识别（x0≈73.3；
                    # pming 续行 63.3 / kai 续行 65.7 均低于阈值，probe74 定案）
                    nodes.append({'level': '㈠㈡㈢㈣'[min(l5_seq, 3)],
                                  'title': s, 'content': [], 'children': []})
                    l5_seq += 1
                    continue
                is_head = x0 < CN_L34_X0
            else:  # hei 等：天标记已剥，其余并入前节点
                is_head = False
        if not is_head:
            if nodes:
                nodes[-1]['title'] += s
            continue
        level, rest = parse_outline_level(s, is_en, x0)
        if level is not None:
            # C 类：EN L6 拍平进前一 L5 节点 title（probe99：全书仅 p114 两行）
            if is_en and re.match(r'^[a-h]\)$', level) and nodes \
                    and re.match(r'^\d{1,2}\)$', nodes[-1]['level']):
                nodes[-1]['title'] += ' ' + rest
                continue
            node = {'level': level, 'title': rest, 'content': [], 'children': []}
            # D 类（probe104 定案）：EN L2 字母行紧贴前一行 L1 罗马行
            # （top 差 <15pt）= PDF 排版错位，该 L2 逻辑上属 L1 之前的节。
            if is_en and re.match(r'^[A-Z]\.$', level) \
                    and last_l1_idx is not None and last_l1_idx == len(nodes) - 1 \
                    and last_l1_top is not None and abs(top - last_l1_top) < L1_TOP_GAP:
                nodes.insert(last_l1_idx, node)
                last_l1_idx += 1  # L1 后移一位，指针跟随
            else:
                nodes.append(node)
                if is_en and re.match(r'^[IVX]+$', level):
                    last_l1_idx = len(nodes) - 1
                    last_l1_top = top
            l5_seq = 0
            l4_active = is_en and re.match(r'^[a-h]\.$', level)
            continue
        if nodes:
            nodes[-1]['title'] += s
            continue
        nodes.append({'level': '', 'title': s, 'content': [], 'children': []})
        l5_seq = 0
        l4_active = False
    return nodes


EN_L1_RE_N = re.compile(r'^([IVXLCDM]+)$')


def nest(flat, add_ctx=False, is_en=False):
    roots, l1, l2, l3 = [], None, None, None
    l4 = l5 = None  # L4/L5 挂载跟踪（CN: a→㈠；EN: a.→1)→a)）
    # EN 层级: L1=罗马数字无点(I/II), L2=A., L3=1., L4=a., L5=1), L6=a)
    for n in flat:
        lv = n['level']
        if is_en:
            if EN_L1_RE_N.match(lv):
                roots.append(n)
                l1, l2, l3, l4, l5 = n, None, None, None, None
            elif re.match(r'^[A-Z]\.$', lv):
                (l1['children'] if l1 else roots).append(n)
                l2, l3, l4, l5 = n, None, None, None
            elif re.match(r'^\d{1,2}\.$', lv):
                (l2['children'] if l2 else l1['children'] if l1 else roots).append(n)
                l3, l4, l5 = n, None, None
            elif re.match(r'^[a-h]\.$', lv):
                (l3['children'] if l3 else l2['children'] if l2 else l1['children'] if l1 else roots).append(n)
                l4, l5 = n, None
            elif re.match(r'^\d{1,2}\)$', lv):
                (l4['children'] if l4 else l3['children'] if l3 else l2['children'] if l2 else l1['children'] if l1 else roots).append(n)
                l5 = n
            elif re.match(r'^[a-h]\)$', lv):
                (l5['children'] if l5 else l4['children'] if l4 else l3['children'] if l3 else l2['children'] if l2 else l1['children'] if l1 else roots).append(n)
            else:
                (l5 or l4 or l3 or l2 or l1 or roots).append(n)
            continue
        if lv in L1_SET or lv == '拾':
            roots.append(n)
            l1, l2, l3, l4 = n, None, None, None
        elif lv in CN_L2_SET:
            (l1['children'] if l1 else roots).append(n)
            l2, l3, l4 = n, None, None
        elif re.match(r'^\d{1,2}$', lv):
            (l2['children'] if l2 else l1['children'] if l1 else roots).append(n)
            l3, l4 = n, None
        elif re.match(r'^[a-h]$', lv):
            (l3['children'] if l3 else l2['children'] if l2 else l1['children'] if l1 else roots).append(n)
            l4 = n
        elif lv in ('㈠', '㈡', '㈢', '㈣'):
            (l4['children'] if l4 else l3['children'] if l3 else l2['children'] if l2 else l1['children'] if l1 else roots).append(n)
        else:
            (l4 or l3 or l2 or l1 or roots).append(n)
    if add_ctx:
        for r in roots:
            _ctx(r, None)
    return roots


def _ctx(node, book):
    title = node.get('title', '')
    refs = cn_refs_in_title(title)
    if refs:
        bk, ch_cn, vs = refs[0]
        ch = cn_num_to_arabic(ch_cn)
        v0 = vs.split('～')[0].split('-')[0].split('~')[0]
        v0 = re.sub(r'[上中下]+$', '', v0)
        if v0:
            node['ctx_scripture'] = f'{bk}{ch}:{v0}'
            book = bk
    else:
        # 裸引用（无书卷）→ 跨节点继承 last_book
        m = re.match(r'([一二三四五六七八九十百廿]+)([0-9０-９]+(?:[～~][0-9０-９]+)?)', title)
        if m and book:
            ch = cn_num_to_arabic(m.group(1))
            v0 = m.group(2).split('～')[0].split('-')[0].split('~')[0]
            v0 = re.sub(r'[上中下]+$', '', v0)
            if v0:
                node['ctx_scripture'] = f'{book}{ch}:{v0}'
    for c in node.get('children', []):
        _ctx(c, book)


def split_outline_by_day(outline_pages, footer_re):
    """outline_pages: [page_data] → {day: {'cn': [...], 'en': [...]}}

    CN/EN 各自独立状态推进天归属；跨页延续沿用上一页天归属；
    pending 延迟生效（probe69/70/94 定案，防 § Day 标记插在续行中间误切天）。
    footer_re: 批次页脚过滤正则（如 半年度训练第\\d+周纲要）。
    """
    day_lines = {d: {'cn': [], 'en': []} for d in range(0, 7)}
    last = {'cn': [], 'en': []}
    pending = {'en': None}
    pending_pos = {'en': None}  # A 类修复：记录 pending 标记的位置 (pi, top)
    for pi, p in enumerate(outline_pages):
        cn_words = ([(*w, 'kai') for w in p['cn_font'].get('kai', [])]
                    + [(*w, 'pming') for w in p['cn_font'].get('pming', [])]
                    + [(*w, 'hei') for w in p['cn_font'].get('hei', [])])
        cn_merged = sorted(cn_words, key=lambda x: x[0])
        cur = last['cn']
        for top, x0, text, kind in cn_merged:
            dm = DAY_MARK_RE.search(text)
            if dm:
                days = day_list_from_mark(dm.group(1))
                if days:
                    cur = days
                    last['cn'] = days
                text = DAY_MARK_RE.sub('', text).strip()
                if not text:
                    continue
            if footer_re and footer_re.search(text):
                continue
            for d in cur:
                day_lines[d]['cn'].append((top, x0, text, kind))
        en_words = ([(*w, 'en') for w in p['en_font'].get('en', [])]
                    + [(*w, 'enB') for w in p['en_font'].get('enB', [])])
        en_merged = sorted(en_words, key=lambda x: x[0])
        cur = last['en']
        for top, x0, text, kind in en_merged:
            s = text.strip()
            dm = re.match(r'^§\s*Day\s*(.+)', s)
            if dm:
                nums = [int(x) for x in re.findall(r'\d+', dm.group(1)) if 1 <= int(x) <= 6]
                if nums:
                    pending['en'] = nums
                    pending_pos['en'] = (pi, top)
                continue
            if re.match(r'^WEEK\s*\d+', s, re.I):
                continue
            # pending 生效判定：本行是带级别的段首行且与标记非同视觉行
            if pending['en'] is not None:
                same_visual_row = (pending_pos['en'] is not None
                                   and pending_pos['en'][0] == pi
                                   and abs(pending_pos['en'][1] - top) < 2)
                if x0 < EN_HEAD_X0 and parse_outline_level(s, is_en=True, x0=x0)[0] is not None \
                        and not same_visual_row:
                    cur = pending['en']
                    last['en'] = cur
                    pending['en'] = None
                    pending_pos['en'] = None
            for d in cur:
                day_lines[d]['en'].append((top, x0, text, kind))
    return day_lines


# ===== 圣经引用处理 =====
CN_NUM_MAP = {'一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
              '十一': 11, '十二': 12, '十三': 13, '十四': 14, '十五': 15, '十六': 16, '十七': 17, '十八': 18,
              '十九': 19, '二十': 20, '廿一': 21, '廿二': 22, '三十': 30, '百': 100}
FW_DIGITS = str.maketrans('０１２３４５６７８９', '0123456789')  # 全角数字→半角
CN_BOOKS = ['撒上', '撒下', '王上', '王下', '代上', '代下', '林前', '林后', '帖前', '帖后', '提前', '提后',
            '彼前', '彼后', '约壹', '约贰', '约叁',
            '创', '出', '利', '民', '申', '书', '士', '伯', '诗', '箴', '传', '歌', '赛', '耶', '哀', '结', '但',
            '何', '珥', '摩', '俄', '拿', '弥', '鸿', '哈', '番', '该', '亚', '玛',
            '太', '可', '路', '约', '徒', '罗', '加', '弗', '腓', '西', '多', '门', '来', '雅', '犹', '启']
CN_BOOKS_RE = '|'.join(sorted(CN_BOOKS, key=len, reverse=True))


def cn_num_to_arabic(s):
    if s in CN_NUM_MAP:
        return str(CN_NUM_MAP[s])
    if '十' in s:
        parts = s.split('十', 1)
        a, b = parts
        val = 0
        if a:
            val += CN_NUM_MAP.get(a, 0) * 10
        else:
            val = 10
        if b:
            val += CN_NUM_MAP.get(b, 0)
        return str(val)
    # 无「十」：逐位拼接（一一九→119、二八→28、四三→43）
    res = ''
    for ch in s:
        if ch in CN_NUM_MAP:
            res += str(CN_NUM_MAP[ch])
        else:
            return s
    return res


def cn_refs_in_title(title):
    pattern = r'(' + CN_BOOKS_RE + r')([一二三四五六七八九十百廿]+)([0-9０-９]+(?:[～~][0-9０-９]+)?)'
    refs = []
    for m in re.finditer(pattern, title):
        refs.append((m.group(1), m.group(2), m.group(3)))
    return refs


def resolve_ref_std(abbr, last_book):
    m = re.match(r'^(' + CN_BOOKS_RE + r')?([一二三四五六七八九十百廿]+)([0-9０-９]+(?:[～~][0-9０-９]+)?)([上中下]?)$', abbr)
    if not m:
        return None
    book, ch_cn, vs, suf = m.group(1), m.group(2), m.group(3), m.group(4)
    if not book:
        if not last_book:
            return None
        book = last_book
    ch = cn_num_to_arabic(ch_cn)
    vs = vs.translate(FW_DIGITS).replace('～', '-').replace('~', '-')

    def _one(v):
        v = re.sub(r'[上中下]+$', '', v)
        return v or ''

    if '-' in vs:
        a, b = vs.split('-')
        # 尾节带 上/中/下 后缀：替换展开末节（probe79：撒下七12～14上 → 12,13,14上）
        tail = suf
        a0, b0 = _one(a), _one(b)
        if a0 and b0:
            rng = list(range(int(a0), int(b0) + 1))
            if tail:
                rng = rng[:-1] + [f'{b0}{tail}']
            return ','.join(f'{book}{ch}:{v}' for v in rng)
        return None
    v = _one(vs)
    if not v:
        return None
    return f'{book}{ch}:{v}'


def last_ref_in_para(para, chapter_scripture_cn):
    pattern = r'(' + CN_BOOKS_RE + r')?([一二三四五六七八九十百廿]+)([0-9]+(?:[～~][0-9]+)?)([上中下]?)'
    matches = list(re.finditer(pattern, para))
    if not matches:
        return None
    m = matches[-1]
    book, ch_cn, vs = m.group(1), m.group(2), m.group(3)
    if not book:
        for m2 in reversed(matches):
            if m2.group(1):
                book = m2.group(1)
                break
        if not book:
            return None
    ch = cn_num_to_arabic(ch_cn)
    v = vs.split('～')[0].split('~')[0]
    v = re.sub(r'[上中下]+$', '', v)
    return f'{book}{ch}:{v}'


# ===== 晨读页解析 =====
SECT_CN_RE = re.compile(r'^(晨兴喂养|信息选读)$')
SECT_EN_RE = re.compile(r'^(Morning\s+Nourishment|Today.s\s+Reading)$', re.I)
REF_CN_RE = re.compile(r'^参读[:：]')
REF_EN_RE = re.compile(r'^Further\s+Reading[:：]?', re.I)


def _txt_of(line):
    return line[-1]


def _strip_quotes_cn(s):
    """CN kai 经文段引号规则 v2（对齐旧 JSON，probe62 定案）：
    - 段首/段中「“」→ 全角空格（除非是 ：/， 引导的成对内嵌引用）；
    - 段尾未配对「”」删除；单引号「‘…’」升级为「“…”」。
    只用于 feeding_scriptures，fang 正文保留引号。"""
    keep_pairs = []  # [(start_of_open, end_of_close)]
    for m in re.finditer(r'[：，]“', s):
        open_pos = m.end() - 1
        close_pos = s.find('”', open_pos + 1)
        if close_pos > 0:
            keep_pairs.append((open_pos, close_pos))
    out = []
    i = 0
    in_kept = False
    n = len(s)
    while i < n:
        ch = s[i]
        if in_kept:
            out.append(ch)
            if ch == '”':
                in_kept = False
            i += 1
            continue
        if ch == '“':
            if any(sp <= i <= ep for sp, ep in keep_pairs):
                in_kept = True
                out.append('“')
            else:
                out.append('　')
        elif ch == '”':
            out.append(ch)
        elif ch == '‘':
            out.append('“')
        elif ch == '’':
            out.append('”')
        else:
            out.append(ch)
        i += 1
    s = ''.join(out)
    if s.endswith('”'):
        s = s[:-1]
    return s


def split_by_indent(lines):
    """CN fang 正文分段：段首行 x0≈54.3，续行 x0≈37.3（新段=缩进大于阈值 45）。"""
    if not lines:
        return []
    paras = []
    cur = []
    for line in lines:
        x0 = line[-2]
        if cur and x0 > 45:
            paras.append(''.join(_txt_of(t) for t in cur))
            cur = []
        cur.append(line)
    if cur:
        paras.append(''.join(_txt_of(t) for t in cur))
    return paras


def split_by_indent_en_pos(lines, x_thresh=EN_PARA_X0):
    """EN 行按缩进分段（绝对阈值，probe51/52 定案），返回 [(first_x0, first_pos, para)]。
    支持 3 元组 (top,x0,text) 或 4 元组 (pi,top,x0,text)。"""
    if not lines:
        return []
    out = []
    cur = []
    cur_x0 = cur_pos = None
    for line in lines:
        pi, top, x0 = line[0], line[1], line[-2]
        if cur and x0 > x_thresh:
            out.append((cur_x0, cur_pos, ' '.join(_txt_of(t) for t in cur)))
            cur = []
        if not cur:
            cur_x0 = x0
            cur_pos = (pi, top)
        cur.append(line)
    if cur:
        out.append((cur_x0, cur_pos, ' '.join(_txt_of(t) for t in cur)))
    return out


def cwwl(text):
    """李常受文集→CWWL + 标点规范化（probe60 定案）：
    省略号统一为「……」，破折号统一为「—」。"""
    return (text.replace('李常受文集', 'CWWL')
                .replace('……', '\x00')
                .replace('…', '……')
                .replace('\x00', '……')
                .replace('——', '—'))


def parse_day_content(day_pages, scripture_cn, scripture_en):
    """day_pages: [page_data] (type=day 和 day_cont)，返回 day 字段 dict"""
    kai_lines = []   # 经文（CN）
    fang_lines = []  # 正文（CN）
    hei_lines = []   # 区块标题（CN）
    en_lines = []    # EN 经文+正文
    enB_lines = []   # EN 区块标题+天头

    for pi, p in enumerate(day_pages):
        for line in p['cn_font'].get('kai', []):
            kai_lines.append((pi, line[0], line[1], line[2]))
        for line in p['cn_font'].get('fang', []):
            fang_lines.append((pi, line[0], line[1], line[2]))
        for line in p['cn_font'].get('hei', []):
            hei_lines.append((pi, line[0], line[1], line[2]))
        for line in p['en_font'].get('en', []):
            en_lines.append((pi, line[0], line[1], line[2]))
        for line in p['en_font'].get('enB', []):
            enB_lines.append((pi, line[0], line[1], line[2]))

    kai_lines.sort(key=lambda x: (x[0], x[1]))
    fang_lines.sort(key=lambda x: (x[0], x[1]))
    en_lines.sort(key=lambda x: (x[0], x[1]))
    enB_lines.sort(key=lambda x: (x[0], x[1]))

    # 找区块标题位置 (页序, top)。CN/EN 边界分开设（probe66 定案）：
    # CN 参读行（fang）与 EN Further Reading 行（en）同页共存且 EN 行更靠下，
    # 共用一个 ref_start 会把 en 流中两者之间的 mr 尾行误收进 ref_en。
    feeding_start = reading_start = ref_start = ref_start_en = None
    for pi, top, x0, t in hei_lines:
        s = t.strip()
        if SECT_CN_RE.match(s):
            if '晨' in s and feeding_start is None:
                feeding_start = (pi, top)
            elif '信' in s and reading_start is None:
                reading_start = (pi, top)
        elif REF_CN_RE.match(s) and ref_start is None:
            ref_start = (pi, top)
    for pi, top, x0, t in enB_lines:
        s = t.strip()
        if SECT_EN_RE.match(s):
            if 'Nourishment' in s and feeding_start is None:
                feeding_start = (pi, top)
            elif 'Reading' in s and reading_start is None:
                reading_start = (pi, top)
        elif REF_EN_RE.match(s) and ref_start_en is None:
            ref_start_en = (pi, top)
    for pi, top, x0, t in fang_lines:
        if REF_CN_RE.match(t.strip()) and ref_start is None:
            ref_start = (pi, top)
    # EN 参读行在 en 流（x0=377，probe63/probe66 定案），独立设 ref_start_en
    for pi, top, x0, t in en_lines:
        if REF_EN_RE.match(t.strip()) and ref_start_en is None:
            ref_start_en = (pi, top)
    # EN 边界兜底：en 流没有 Further Reading 行时沿用 CN ref_start
    if ref_start_en is None:
        ref_start_en = ref_start

    if feeding_start is None:
        feeding_start = (-1, 30)

    def after(pos, start):
        """pos=(pi,top) 是否在 start 之后（含同页下方与后续页）"""
        if start is None:
            return True
        return pos[0] > start[0] or (pos[0] == start[0] and pos[1] >= start[1])

    def before(pos, end):
        """pos=(pi,top) 是否在 end 之前（含同页上方与之前页）"""
        if end is None:
            return True
        return pos[0] < end[0] or (pos[0] == end[0] and pos[1] < end[1])

    def _not_head(pos_top):
        return pos_top > HEAD_TOP_MIN

    # ---- CN 经文（kai，feeding 与 reading 之间；天头 top>30 过滤）----
    scr_cn = [(pi, top, x0, txt) for pi, top, x0, txt in kai_lines
              if _not_head(top) and after((pi, top), feeding_start)
              and before((pi, top), reading_start) and before((pi, top), ref_start)]
    feeding_scriptures = [_strip_quotes_cn(s) for s in split_by_indent(scr_cn)]
    # ---- CN 晨兴喂养（fang，feeding 到 reading）----
    mf_cn = [(pi, top, x0, txt) for pi, top, x0, txt in fang_lines
             if after((pi, top), feeding_start) and before((pi, top), reading_start)
             and before((pi, top), ref_start)]
    morning_feeding = split_by_indent(mf_cn)
    # ---- CN 信息选读（fang，reading 到 ref）----
    mr_cn = [(pi, top, x0, txt) for pi, top, x0, txt in fang_lines
             if reading_start is not None and after((pi, top), reading_start)
             and before((pi, top), ref_start)]
    message_reading = split_by_indent(mr_cn)
    # ---- CN 参读（ref 之后）：多行拼接单元素（带「参读：」前缀）----
    ref_cn_lines = [(pi, top, x0, txt) for pi, top, x0, txt in fang_lines
                    if ref_start is not None and after((pi, top), ref_start)]
    if not ref_cn_lines:
        ref_cn_lines = [(pi, top, x0, txt) for pi, top, x0, txt in kai_lines
                        if ref_start is not None and after((pi, top), ref_start)]
    ref_cn = [''.join(t for _, _, _, t in ref_cn_lines).strip()] if ref_cn_lines else []

    # ---- EN 全 body（en 单流，feeding 到 EN 参读之前）----
    body_en = [(pi, top, x0, txt) for pi, top, x0, txt in en_lines
               if _not_head(top) and after((pi, top), feeding_start)
               and before((pi, top), ref_start_en)
               and not re.match(r'^WEEK\s*\d+', txt.strip(), re.I)]
    en_pos_paras = split_by_indent_en_pos(body_en)
    mr_pos = reading_start if reading_start else ref_start
    feeding_pos_paras = [pp for pp in en_pos_paras
                         if not (mr_pos and after(pp[1], mr_pos))]
    mr_pos_paras = [pp for pp in en_pos_paras
                    if mr_pos and after(pp[1], mr_pos)]

    # mr 首段剥离：溢出引用行归回 mf 末段（PDF 引用括号排到标题下一页/下一行）
    if feeding_pos_paras and mr_pos_paras:
        if re.match(r'^\(', mr_pos_paras[0][2].strip()):
            moved = mr_pos_paras.pop(0)
            last = feeding_pos_paras[-1]
            feeding_pos_paras[-1] = (last[0], last[1], last[2] + ' ' + moved[2])
        elif mr_pos_paras[0][2].strip().startswith(')'):
            moved = mr_pos_paras.pop(0)
            last = feeding_pos_paras[-1]
            feeding_pos_paras[-1] = (last[0], last[1], last[2] + ' ' + moved[2])
        elif re.match(r'^(p{1,2}\.|\d{3})\)', mr_pos_paras[0][2].strip()):
            moved = mr_pos_paras.pop(0)
            last = feeding_pos_paras[-1]
            feeding_pos_paras[-1] = (last[0], last[1], last[2] + ' ' + moved[2])

    # fs_en 剥离：feeding 块内段首 x0<374（经文段首 370）→ fs；>=374（mf 段首 377）→ mf
    fs_en = []
    mf_en_paras = []
    for x0, pos, para in feeding_pos_paras:
        if x0 >= EN_FS_MF_X0:
            mf_en_paras.append(para)
        else:
            fs_en.append(para)
    feeding_scriptures_en = fs_en
    morning_feeding_en = mf_en_paras
    message_reading_en = [para for _, _, para in mr_pos_paras]
    # ---- EN 参读（空格连接单串，带 Further Reading 前缀）----
    ref_en_lines = [(pi, top, x0, txt) for pi, top, x0, txt in en_lines
                    if ref_start_en is not None and after((pi, top), ref_start_en)]
    ref_en = [' '.join(t for _, _, _, t in ref_en_lines).strip()] if ref_en_lines else []

    # CWWL 替换
    for lst in (feeding_scriptures, morning_feeding, message_reading, ref_cn,
                feeding_scriptures_en, morning_feeding_en, message_reading_en, ref_en):
        for i in range(len(lst)):
            lst[i] = cwwl(lst[i])

    # ---- feeding_refs（引用首行解析，含书卷继承与范围展开，probe70 定案）----
    refs = []
    last_book = None
    last_ch = None
    for fs in feeding_scriptures:
        m = re.match(r'^(' + CN_BOOKS_RE + r')?([一二三四五六七八九十百廿]+)([0-9０-９]+(?:[～~][0-9０-９]+)?)([上中下]?)', fs)
        if m:
            ref = resolve_ref_std(m.group(0), last_book)
            if ref:
                refs.append(ref)
                if m.group(1):
                    last_book = m.group(1)
                last_ch = cn_num_to_arabic(m.group(2))
        else:
            m2 = re.match(r'^([0-9０-９]+(?:[～~][0-9０-９]+)?)(?:[上中下])?', fs)
            if m2 and last_book and last_ch:
                vs = m2.group(1).translate(FW_DIGITS)
                if '～' in vs or '~' in vs:
                    a, b = re.split(r'[～~]', vs)
                    refs.append(','.join(f'{last_book}{last_ch}:{v}' for v in range(int(a), int(b) + 1)))
                else:
                    refs.append(f'{last_book}{last_ch}:{vs}')

    # ---- contexts（对齐旧 JSON 语义：长度恒等于段落数，首元素为周读经串）----
    def _ctx_seq(paras):
        if not paras:
            return []
        out = [scripture_cn]
        cur = scripture_cn
        for i, para in enumerate(paras):
            ref = last_ref_in_para(para, scripture_cn)
            if ref:
                cur = ref
            if i < len(paras) - 1:
                out.append(cur)
        return out

    mfc = _ctx_seq(morning_feeding)
    mrc = _ctx_seq(message_reading)

    return {
        'feeding_scriptures': feeding_scriptures,
        'feeding_scriptures_en': feeding_scriptures_en,
        'morning_feeding': morning_feeding,
        'morning_feeding_en': morning_feeding_en,
        'message_reading': message_reading,
        'message_reading_en': message_reading_en,
        'ref_reading': ref_cn,
        'ref_reading_en': ref_en,
        'feeding_refs': refs,
        'morning_feeding_contexts': mfc,
        'message_reading_contexts': mrc,
    }


# ===== 主流程 =====
DAY_CN = ['周一', '周二', '周三', '周四', '周五', '周六']
DAY_CN_STR = '一二三四五六'


def build(pdf_path, config, log=print):
    """解析 PDF → NEW 双语树 dict。config 见 batches/*.json。"""
    title_fixes = config.get('title_fixes', [])
    footer_re = re.compile(config['footer_filter']) if config.get('footer_filter') else None

    pages = []
    with pdfplumber.open(pdf_path) as pdf:
        for pi, page in enumerate(pdf.pages, 1):
            p = extract_page(page)
            p['index'] = pi
            p['type'] = classify_page(p)
            pages.append(p)
    log(f'总页数: {len(pages)}')

    mottos = []
    for p in pages:
        if p['type'] == 'motto':
            mottos = parse_mottos(p)
            break
    log(f'标语: {len(mottos)} 条')

    weeks = []
    cur_week = None
    for p in pages:
        if p['type'] == 'week_start':
            cur_week = {
                'number': len(weeks) + 1,
                'head': p,
                'outline_pages': [p],  # 周首页本身也含纲要开头
                'day_pages': defaultdict(list),
                'hymn_page': None,
            }
            weeks.append(cur_week)
            continue
        if cur_week is None:
            continue
        if p['type'] == 'day':
            header_text = ''.join(txt for _, txt in p['all_lines'] if _ < 60)
            m = re.search(r'周([一二三四五六])', header_text)
            day_no = DAY_CN_STR.index(m.group(1)) + 1 if m else 1
            cur_week['day_pages'][day_no].append(p)
        elif p['type'] == 'day_cont':
            if cur_week['day_pages']:
                last_day = max(cur_week['day_pages'].keys())
                cur_week['day_pages'][last_day].append(p)
        elif p['type'] == 'hymn':
            cur_week['hymn_page'] = p
        elif p['type'] == 'outline':
            cur_week['outline_pages'].append(p)

    log(f'周数: {len(weeks)}')

    chapters = []
    for wk in weeks:
        title_cn, title_en, hymn_cn, hymn_en, scripture_cn, scripture_en = \
            parse_week_head(wk['head'], title_fixes)
        if not hymn_cn and wk['hymn_page']:
            hymn_cn, hymn_en = parse_hymn_page(wk['hymn_page'])
        day_lines = split_outline_by_day(wk['outline_pages'], footer_re)
        all_cn = [l for d in range(0, 7) for l in day_lines[d]['cn']]
        all_en = [l for d in range(0, 7) for l in day_lines[d]['en']]
        # 全周纲要去重（天级归属叠加，跨天共用行可能重复）：按 (top,x0,text) 去重保序
        seen_cn, seen_en = set(), set()
        all_cn_dedup = [l for l in all_cn if not (l in seen_cn or seen_cn.add(l))]
        all_en_dedup = [l for l in all_en if not (l in seen_en or seen_en.add(l))]
        outline_sections = nest(outline_flat_nodes(all_cn_dedup), add_ctx=True)
        outline_sections_en = nest(outline_flat_nodes(all_en_dedup, is_en=True), add_ctx=False, is_en=True)

        revivals = []
        for day_no in sorted(wk['day_pages'].keys()):
            day_pages = wk['day_pages'][day_no]
            fields = parse_day_content(day_pages, scripture_cn, scripture_en)
            ol_cn = nest(outline_flat_nodes(day_lines[day_no]['cn']), add_ctx=False)
            ol_en = nest(outline_flat_nodes(day_lines[day_no]['en'], is_en=True), add_ctx=False, is_en=True)
            d = {
                'day': DAY_CN[day_no - 1],
                'outline': ol_cn,
                'outline_en': ol_en,
            }
            d.update(fields)
            revivals.append(d)

        ch = {
            'number': wk['number'],
            'title': cwwl(title_cn),
            'title_en': title_en,
            'hymn_number': hymn_cn or '',
            'hymn_number_en': hymn_en or '',
            'hymn_image': '',
            'hymn_images': [],
            'hymn_lyrics': [],
            'hymn_lyrics_en': [],
            'scripture': scripture_cn,
            'scripture_en': scripture_en,
            'outline_sections': outline_sections,
            'outline_sections_en': outline_sections_en,
            'detail_sections': [],
            'has_listen_block': True,
            'message_content': [],
            'ministry_excerpt': '',
            'morning_revivals': revivals,
        }
        chapters.append(ch)

    result = {
        'path': config['meta']['path'],
        'title': config['meta']['title'],
        'subtitle': config['meta']['subtitle'],
        'year': config['meta']['year'],
        'season': config['meta']['season'],
        'mottos': mottos,
        'motto_song_text': '',
        'motto_song_image': '',
        'chapters': chapters,
        'version': datetime.datetime.now().strftime('%Y%m%d%H%M%S'),
        'is_collection': False,
        'motto_song_images': [],
    }
    return result


def summarize(result, log=print):
    """解析摘要与异常预警（无经文/无喂养/中英段数不等等）"""
    problems = 0
    for ch in result['chapters']:
        log(f"周{ch['number']:2d} {ch['title'][:14]:16s} 天={len(ch['morning_revivals'])} "
            f"纲要={len(ch['outline_sections'])} 诗歌={ch['hymn_number']!r} "
            f"读经={ch['scripture'][:20]!r}")
        for d in ch['morning_revivals']:
            probs = []
            if not d['feeding_scriptures']:
                probs.append('无经文')
            if not d['morning_feeding']:
                probs.append('无喂养')
            if not d['message_reading']:
                probs.append('无正文')
            if not d['ref_reading']:
                probs.append('无参读')
            if len(d['feeding_scriptures']) != len(d['feeding_scriptures_en']):
                probs.append(f"经文中英{len(d['feeding_scriptures'])}/{len(d['feeding_scriptures_en'])}")
            if probs:
                problems += 1
                log(f"    {d['day']} ⚠️ {'; '.join(probs)}")
    log(f'异常预警: {problems} 处')
    return problems
