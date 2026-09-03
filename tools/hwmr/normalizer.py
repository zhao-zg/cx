# -*- coding: utf-8 -*-
"""normalizer.py: NEW JSON 中文字段归一到 OLD 校对风格（参数化版）

源自 .temp/normalize-cn.py（2026-04 批次定案），参数化改造：
- normalize(new) 接收 NEW dict 返回归一后 dict，路径由调用方管理。

规则（NEW → OLD 方向，2026-04 批次验证有效）：
  c1  ；（X；） → （X）；        括号重排（分号在括号内 → 外）
  c2  。（X。） → （X）。        括号重排（句号在括号内 → 外）
  c3  ，） → ），               尾逗号移出括号
  c5  ） → ）。                 （仅 c2 未覆盖的残句号）
  c4  ；） → ）                 括号内尾分号删除
  c6  ，（ → （                 引注前导逗号删除
  c7  、（X、） → （X）、       顿号+括号重排
  5   生命读经 → L-S            书名缩写
  6   —— → —                   双破折号 → 单
  7   …+ 连续省略号 → 偶数规整   … → ……
  8   数字，数字 → 数字、数字    同章内节号分隔（lookbehind/ahead）
  8b  [上下中]，数字 → 、数字    带后缀节号分隔
  9   、(?=[且和以或并]) → 删    连词前顿号
  12  赀财 → 资财               异体字
  13  李常受文集 → CWWL          书名缩写（OLD 52 处全用 CWWL，从不用李常受文集）
  14  ○ → 〇                   仅限周首页 outline_sections 树内（OLD 周首页 〇=7/○=0；天级纲要 ○=7/〇=0 保持 ○）
  15  ~ → ～                   仅限 feeding_scriptures，带引用前缀（约一12~13）夹在中文间转全角；
                                 裸数字开头（16~17）保持半角（OLD 仅 3 处半角全在裸数字开头）
  16  页）。 → 页）              仅限 outline 树内 title（CWWL 标题尾；OLD mf/mr 内 163 处 页）。 为合法形态）
  hymn_number 专项: 纯数字 → 大本N首; N英译中 → 英诗N首
（原规则 10 的/地、11 long suffering 方向与实测相反，OLD 自身用法不一，删除改豁免）
"""
import re


def ellipsis_fix(m):
    n = len(m.group())
    return '……' * ((n + 1) // 2)


def norm(s):
    s = re.sub(r'；（([^（）]*)；）', r'（\1）；', s)      # c1
    s = re.sub(r'。（([^（）]*)。）', r'（\1）。', s)      # c2
    s = s.replace('，）', '），')                            # c3
    s = s.replace('。）', '）。')                            # c5
    s = s.replace('；）', '）')                              # c4
    s = re.sub(r'，(?=（)', '', s)                           # c6 引注前导逗号
    s = re.sub(r'、（([^（）]*?)、）', r'（\1）、', s)      # c7 顿号+括号重排
    s = s.replace('生命读经', 'L-S')                         # 5
    s = s.replace('——', '—')                                # 6
    s = re.sub(r'…+', ellipsis_fix, s)                       # 7
    s = re.sub(r'(?<=\d)，(?=\d)', '、', s)                  # 8
    s = re.sub(r'(?<=[上下中])，(?=\d)', '、', s)           # 8b 带后缀节号
    s = re.sub(r'、(?=[且和以或并])', '', s)                 # 9
    s = s.replace('赀财', '资财')                            # 12
    s = s.replace('李常受文集', 'CWWL')                      # 13
    return s


def norm_outline_title(s, weekly):
    """outline 树内 title：规则 16 须在 norm 之后执行——
    原始形态为 页。） ，c5 括号重排后变 页）。 ，再删句号得 OLD 的 页）"""
    s = norm(s)                                          # c5 在此重排括号
    s = re.sub(r'页）。', '页）', s)                      # 16
    if weekly:
        s = s.replace('○', '〇')                            # 14
    return s


def norm_fs(s):
    """feeding_scriptures：OLD 带引用前缀夹在中文间用全角 ～（约一12～13），
    裸数字开头（16~17）保持半角（OLD 仅 3 处半角全在裸数字开头）"""
    s = re.sub(r'(?<=\d)~(?=\d)', '～', s)
    s = re.sub(r'^(\d+)～(\d+)', r'\1~\2', s)            # 裸数字开头转回半角
    return norm(s)


def norm_hymn(s):
    """hymn_number 专项：OLD 格式为 '大本382首' / '英诗904首'"""
    m = re.fullmatch(r'(\d+)', s)
    if m:
        return f'大本{m.group(1)}首'
    m = re.fullmatch(r'(\d+)英译中', s)
    if m:
        return f'英诗{m.group(1)}首'
    return norm(s)


def deep_norm(o, key=None, anc=frozenset()):
    """anc: 祖先 key 集合——outline 树是 {level,title,children} dict，
    递归到 title 时 key 丢失上下文，须靠 anc 判断归属"""
    if isinstance(o, dict):
        return {k: (deep_norm(v, k, anc | {k}) if not k.endswith('_en') else v)
                for k, v in o.items()}
    if isinstance(o, list):
        return [deep_norm(x, key, anc) for x in o]
    if isinstance(o, str):
        if key == 'hymn_number':
            return norm_hymn(o)
        if 'feeding_scriptures' in anc:
            return norm_fs(o)
        if key == 'title' and ('outline_sections' in anc or 'outline' in anc):
            return norm_outline_title(o, weekly=('outline_sections' in anc))
        return norm(o)
    return o


def normalize(new):
    """归一化整个 NEW 树（_en 键跳过），返回归一后的 dict（不修改输入）。"""
    return deep_norm(new)
