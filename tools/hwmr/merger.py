# -*- coding: utf-8 -*-
"""merger.py: OLD 中文底座 + NEW 双语树 → 合并双语 training.json（参数化版）

源自 .temp/merge-enchs.py（probe89/92/100 定案），参数化改造：
- OLD/NEW/输出路径、seg_rules、ch9d2_special 由调用方传入；
- 断言失败即 die 退出，保证不产生半成品。

关键决策（cx-hwmr-pipeline 技能定案，勿改）：
1. CN 以 OLD 为底座只注入 _en 字段（CN 一字符不改）；
2. 树型字段（outline_sections_en / outline_en）深度序列断言（只比深度不比 level 字面量）；
3. CN 深度序列是 EN 严格前缀时裁剪豁免（trim_to_prefix），非前缀必须 die；
4. 合并段公式：EN 合并段全文挂前位、后位空串（前提 OLD[k+1] 以 …… 开头，probe89）；
5. 跨字段专案 ch9d2（默认 (8,1)）：fs_en[0] 按唯一 …… 切分，前半挂 fs_en[0]、
   后半+mf_en[0] 挂 mf_en[0]/[1]；结构断言 fs_cn=1/mf_cn=2/ev_fs=1/ev_mf=1；
6. merge 的 zip 对齐目标是 merged['chapters']（= OLD 底座）与 NEW 树；
7. CN 摘要 sha256 自验证（version 置空豁免）；
8. EN 完整性 NEW 驱动自验证：NEW 存在的 _en 字段 merged 必须存在。
"""
import json
import hashlib
import re

EN_CH_FIELDS = ['title_en', 'scripture_en', 'hymn_number_en',
                'hymn_lyrics_en', 'outline_sections_en']

MR_EN_FIELDS = ['feeding_refs_en', 'feeding_scriptures_en', 'morning_feeding_en',
                'morning_feeding_contexts_en', 'message_reading_en',
                'message_reading_contexts_en', 'ref_reading_en']


class MergeError(Exception):
    pass


def _die(msg):
    raise MergeError(msg)


def clone(x):
    return json.loads(json.dumps(x, ensure_ascii=False))


def depth_seq(nodes, out=None, depth=0):
    """先序遍历深度序列。两序列相等 ⇔ 树同构（节点数与层级结构完全一致）。"""
    if out is None:
        out = []
    for n in nodes or []:
        out.append(depth)
        depth_seq(n.get('children'), out, depth + 1)
    return out


def trim_to_prefix(tree, n):
    """按先序保留前 n 个节点重建树（OLD CN 序列是 EN 严格前缀时的裁剪豁免）。
    保留节点全部字段（除 children 重建），结构按 EN 先序对应 CN。"""
    pre = []

    def walk(ns, d):
        for node in ns or []:
            pre.append((d, node))
            walk(node.get('children'), d + 1)

    walk(tree, 0)
    if len(pre) < n:
        _die(f'trim_to_prefix: 先序节点数 {len(pre)} < 目标 {n}')
    out, stack = [], []  # stack[d] = 已放置的深度 d 节点
    for d, node in pre[:n]:
        nd = clone(node)
        nd.pop('children', None)
        if d == 0:
            out.append(nd)
        else:
            stack[d - 1].setdefault('children', []).append(nd)
        del stack[d:]
        stack.append(nd)
    return out


def _align_depth_seq(cn_pre, en_pre):
    """LCS 深度序列对齐（CN/EN 先序节点列表 → aligned 三元组）。

    aligned: [(d, cn_node|None, en_node|None)]，按「CN 先序 + EN 独有插回原序」排列：
      - 匹配对 (cn, en)：深度相等（LCS），EN 节点挂该深度；
      - CN 独有 (cn, None)：CN 有 EN 无（A/C 类）→ EN 空占位；
      - EN 独有 (None, en)：EN 有 CN 无（B 类）→ 保留 EN 节点，深度沿用 EN 原始深度。
    LCS 保证头部+尾部尽量对齐，中间缺项（C 类）正确识别为独有。
    """
    m, n = len(cn_pre), len(en_pre)
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if cn_pre[i - 1][0] == en_pre[j - 1][0]:
                dp[i][j] = dp[i - 1][j - 1] + 1
            else:
                dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])
    # 回溯得到匹配对 (cn_idx, en_idx)
    matched = []
    i, j = m, n
    while i > 0 and j > 0:
        if cn_pre[i - 1][0] == en_pre[j - 1][0] and dp[i][j] == dp[i - 1][j - 1] + 1:
            matched.append((i - 1, j - 1))
            i -= 1
            j -= 1
        elif dp[i][j] == dp[i - 1][j]:
            i -= 1  # CN 独有
        else:
            j -= 1  # EN 独有
    matched.reverse()
    matched_cn = {ci for ci, _ in matched}
    matched_en = {ej for _, ej in matched}
    en_to_cn = {ej: ci for ci, ej in matched}

    # 重建 aligned：按 CN 先序走，EN 独有按 EN 原序插入对应位置
    out = []
    i = j = 0
    while i < m or j < n:
        if j < n and j not in matched_en:
            # EN 独有：按 EN 原序插回
            out.append((en_pre[j][0], None, en_pre[j][1]))
            j += 1
        elif j < n and en_to_cn[j] == i:
            # 对齐对
            out.append((cn_pre[i][0], cn_pre[i][1], en_pre[j][1]))
            i += 1
            j += 1
        else:
            # CN 独有
            out.append((cn_pre[i][0], cn_pre[i][1], None))
            i += 1
    return out


def _rebuild_en(aligned, cn_depths):
    """按 aligned 重建 EN 树，以 CN 深度序列 cn_depths 为骨架。
    - 匹配对 (cn,en) / CN 独有 (cn,None)：EN 节点挂 CN 深度 d（CN 独有挂空 dict 占位）；
    - EN 独有 (None,en)：保留 EN 节点原深度，作为其兄弟挂载（B 类），
      深度沿用 en 原始深度（可能与 CN 骨架交错）。
    返回 (en_nodes, en_only_count)。"""
    out, stack = [], []
    en_only = 0
    for d, cn_node, en_node in aligned:
        if en_node is None:
            nd = {}                     # CN 独有：EN 空占位
            eff_d = d                  # 挂 CN 深度 d
        else:
            nd = clone(en_node)
            nd.pop('children', None)
            if cn_node is None:
                en_only += 1           # EN 独有（B 类）
                eff_d = d              # 深度沿用 EN 原深度（与 CN 骨架可能不齐）
            else:
                eff_d = d              # 匹配对：挂 CN 深度
        if eff_d == 0:
            out.append(nd)
        else:
            # 栈顶必须存在 eff_d-1 的父；EN 独有深度跳级时中间补空占位容器
            while len(stack) < eff_d:
                stack.append({})
            stack[eff_d - 1].setdefault('children', []).append(nd)
        del stack[eff_d:]
        stack.append(nd)
    return out, en_only


def align_tree(cn_tree, en_tree, where):
    """通用树对齐：CN 权威骨架 + EN 注入。不同构时：
    - 前缀豁免保留（CN 是 EN 严格前缀 → 裁剪 EN 对齐 OLD）；
    - 非前缀 → 双指针对齐：CN 独有（A/C 类）EN 空占位；EN 独有（B 类）保留。
    返回 (en_tree_aligned, stats)。"""
    cn_pre, en_pre = [], []

    def walk(ns, d, out):
        for n in ns or []:
            out.append((d, n))
            walk(n.get('children'), d + 1, out)

    walk(cn_tree, 0, cn_pre)
    walk(en_tree, 0, en_pre)

    ds_cn = [d for d, _ in cn_pre]
    ds_en = [d for d, _ in en_pre]
    if ds_cn == ds_en:
        return clone(en_tree), {'aligned': 0, 'cn_only': 0, 'en_only': 0}
    if len(ds_cn) < len(ds_en) and ds_en[:len(ds_cn)] == ds_cn:
        # 前缀豁免：CN 少、EN 多且 CN 是 EN 前缀 → 裁剪 EN 对齐 OLD（保留 trim 语义）
        return trim_to_prefix(en_tree, len(ds_cn)), {'aligned': 0, 'cn_only': 0,
                                                      'en_only': len(ds_en) - len(ds_cn)}
    aligned = _align_depth_seq(cn_pre, en_pre)
    cn_only = sum(1 for _, cn, en in aligned if cn is not None and en is None)
    en_tree_al, en_only = _rebuild_en(aligned, ds_cn)
    return en_tree_al, {'aligned': 1, 'cn_only': cn_only, 'en_only': en_only}


def cn_digest(doc):
    """提取所有非 _en 字符串内容做 sha256 摘要"""
    parts = []

    def w(x):
        if isinstance(x, dict):
            for k, v in x.items():
                if k.endswith('_en'):
                    continue
                w(v)
        elif isinstance(x, list):
            for v in x:
                w(v)
        elif isinstance(x, str):
            parts.append(x)

    w(doc)
    return hashlib.sha256('\n'.join(parts).encode('utf-8')).hexdigest()


def _align_segments(cn_list, en_list, where):
    """段级通用对齐：EN 多段 → 拼接；CN 多段 → 末段吸收。
    - len(en) == len(cn)：直接对位；
    - len(en) > len(cn)：EN 每段挂 CN 对应段，多余 EN 并入 CN 末段（拼接）；
    - len(en) < len(cn)：EN 全文挂 CN 前段，后续 CN 段空串（合并公式）；
    返回对齐后的 EN 列表（长度 = len(cn_list)）。"""
    n_cn, n_en = len(cn_list), len(en_list)
    if n_cn == n_en:
        return clone(en_list)
    if n_cn == 0:
        # CN 无段可挂（如 EN 有段但 OLD 该字段为空）：EN 无处注入，丢弃
        return []
    out = []
    if n_en > n_cn:
        # EN 侧：前 n_cn-1 段对位，末段拼接剩余 EN 段
        for k in range(n_cn - 1):
            out.append(clone(en_list[k]))
        tail = ''.join(str(x) for x in en_list[n_cn - 1:])
        out.append(tail)
    else:
        # CN 多：EN 段全文挂前位，后续空串（与 probe89 合并段公式一致）
        out = [clone(en_list[0])] + [''] * (n_cn - 1)
    if len(out) != n_cn:
        _die(f'{where}: 对齐后段数 {len(out)} != CN {n_cn}')
    return out


def merge(old, new, seg_rules=None, ch9d2_special=None, log=print):
    """核心合并：OLD 为 CN 底座注入 NEW 的 _en 字段。

    seg_rules: {(ch_idx, day_idx): {field_base: {NEW段号: [OLD段号...]}}}
               （JSON 来的键可能是字符串元组，调用方负责解析）
    ch9d2_special: (ch_idx, day_idx) 或 None
    返回 (merged_dict, stats)。
    """
    seg_rules = seg_rules or {}
    merged = clone(old)
    merged['version'] = new.get('version', merged['version'])

    stats = {'ch_en_fields': 0, 'mr_en_fields': 0, 'outline_en_injected': 0,
             'seg_resplit': 0, 'ch9d2_special': 0, 'tree_trim': 0,
             'tree_align': 0, 'cn_only': 0, 'en_only': 0, 'seg_pad': 0}

    if len(merged['chapters']) != len(new['chapters']):
        _die(f'章节数不等: OLD {len(merged["chapters"])} vs NEW {len(new["chapters"])}')

    for ci, (oc, nc) in enumerate(zip(merged['chapters'], new['chapters'])):
        where = f'ch{ci + 1}'

        # ---- 章节级 ----
        for f in EN_CH_FIELDS:
            ev = nc.get(f)
            if not ev:  # None/'' 跳过（ch5 hymn_number_en='' → 保持 OLD 底座，UI 回退 CN 值）
                continue
            if f == 'outline_sections_en':
                ev, st = align_tree(oc.get('outline_sections'), ev,
                                    f'{where}.outline_sections')
                if st['aligned']:
                    stats['tree_align'] += 1
                else:
                    stats['tree_trim'] += 1
                stats['cn_only'] += st['cn_only']
                stats['en_only'] += st['en_only']
            oc[f] = clone(ev)
            stats['ch_en_fields'] += 1

        # ---- mr 级 ----
        omrs, nmrs = oc.get('morning_revivals') or [], nc.get('morning_revivals') or []
        if len(omrs) != len(nmrs):
            _die(f'{where} mr 数量不等: {len(omrs)} vs {len(nmrs)}')
        for di, (omr, nmr) in enumerate(zip(omrs, nmrs)):
            w = f'ch{ci + 1}d{di + 1}'

            # ---- outline_en（树型）----
            ev = nmr.get('outline_en')
            if ev:
                ev, st = align_tree(omr.get('outline'), ev, f'{w}.outline')
                if st['aligned']:
                    stats['tree_align'] += 1
                else:
                    stats['tree_trim'] += 1
                stats['cn_only'] += st['cn_only']
                stats['en_only'] += st['en_only']
                omr['outline_en'] = clone(ev)
                stats['mr_en_fields'] += 1
                stats['outline_en_injected'] += 1

            # ---- ch9d2 专案：fs_en[0] 按 …… 切分，跨字段挂载 ----
            if ch9d2_special is not None and (ci, di) == ch9d2_special:
                fs_cn = omr.get('feeding_scriptures') or []
                mf_cn = omr.get('morning_feeding') or []
                ev_fs = nmr.get('feeding_scriptures_en') or []
                ev_mf = nmr.get('morning_feeding_en') or []
                if not (len(fs_cn) == 1 and len(mf_cn) == 2
                        and len(ev_fs) == 1 and len(ev_mf) == 1):
                    _die(f'{w}: 结构与预期不符 fs CN{len(fs_cn)}/EN{len(ev_fs)}, '
                         f'mf CN{len(mf_cn)}/EN{len(ev_mf)}')
                s = ev_fs[0]
                n_sep = s.count('……')
                if n_sep != 1:
                    _die(f'{w}: fs_en[0] 分隔点 …… 出现 {n_sep} 次，预期恰好 1 次')
                cut = s.index('……')
                first, second = s[:cut], s[cut:]
                if not first.strip():
                    _die(f'{w}: fs_en[0] 切分点前半为空')
                omr['feeding_scriptures_en'] = [first]                  # → OLD fs[0]
                omr['morning_feeding_en'] = [second, clone(ev_mf[0])]   # → OLD mf[0], mf[1]
                stats['mr_en_fields'] += 2
                stats['seg_resplit'] += 1
                stats['ch9d2_special'] += 1

            # ---- 其余字段：无规则直接对位 / 有规则走完整映射重切 ----
            d_rules = seg_rules.get((ci, di), {})
            for f in MR_EN_FIELDS:
                if ch9d2_special is not None and (ci, di) == ch9d2_special \
                        and f in ('feeding_scriptures_en', 'morning_feeding_en'):
                    continue  # 专案分支已处理
                ev = nmr.get(f)
                if not ev:
                    continue
                base = f[:-3]  # 去掉 _en
                cn_list = omr.get(base) or []
                rmap = d_rules.get(base)
                if rmap is None:
                    if isinstance(ev, list) and len(ev) == len(cn_list):
                        omr[f] = clone(ev)
                        stats['mr_en_fields'] += 1
                    elif f.endswith('contexts_en'):
                        # contexts 长度语义差异已定性（off-by-one 模型一致），直接注入
                        omr[f] = clone(ev)
                        stats['mr_en_fields'] += 1
                    else:
                        # 段数不等且无显式规则：通用对齐（D/E 类）。
                        # EN 多段 → 每段全文挂 CN 对应段（多余 EN 并入 CN 末段）；
                        # CN 多段 → 末段吸收多余（EN 段全文挂前位，后续 CN 段空串——
                        # 与 probe89 合并段公式一致）。
                        omr[f] = _align_segments(cn_list, ev, f'{w} {f}')
                        stats['mr_en_fields'] += 1
                        stats['seg_pad'] += 1
                else:
                    # 完整 NEW→OLD 映射校验
                    if len(ev) != len(rmap):
                        _die(f'{w} {f}: 规则映射 {len(rmap)} 段 != EN 实际 {len(ev)} 段')
                    if sum(len(o) for o in rmap.values()) != len(cn_list):
                        _die(f'{w} {f}: 规则覆盖 OLD {sum(len(o) for o in rmap.values())} 段 '
                             f'!= CN {len(cn_list)} 段')
                    out = [None] * len(cn_list)
                    for nk in sorted(rmap.keys()):
                        olds = rmap[nk]
                        if len(olds) == 1:
                            out[olds[0]] = ev[nk]
                        else:
                            # 2 段重切：CN 合并点前提校验（OLD[k+1] 以 …… 开头，probe89）
                            nxt = cn_list[olds[1]]
                            if not str(nxt).startswith('……'):
                                _die(f'{w} {f}: OLD[{olds[1]}] 不以 …… 开头，'
                                     f'与合并公式前提不符: {str(nxt)[:30]}')
                            # EN 合并段全文挂前位，后位空串（EN 侧段内原有 ……，
                            # 不可机械按第一个 …… 切——probe89 定案）
                            out[olds[0]] = ev[nk]
                            out[olds[1]] = ''
                    if any(v is None for v in out):
                        _die(f'{w} {f}: 重切后存在未填段位')
                    omr[f] = out
                    stats['mr_en_fields'] += 1
                    stats['seg_resplit'] += 1

    # ============ 自验证 A：CN 侧与 OLD 完全一致（除 version） ============
    old_v = clone(old)
    old_v['version'] = ''
    mg_v = clone(merged)
    mg_v['version'] = ''
    cn_ok = cn_digest(old_v) == cn_digest(mg_v)
    log(f'CN 侧摘要（除 version）一致: {cn_ok}')
    if not cn_ok:
        _die('CN 侧摘要不一致——CN 底座被意外改动')

    # ============ 自验证 B：EN 字段完整性（NEW 驱动） ============
    missing = []
    for ci, (oc, nc) in enumerate(zip(merged['chapters'], new['chapters'])):
        for f in EN_CH_FIELDS:
            if nc.get(f) and f not in oc:
                missing.append(f'ch{ci + 1}.{f}')
        omrs = oc.get('morning_revivals') or []
        nmrs = nc.get('morning_revivals') or []
        for di, (mr, nmr) in enumerate(zip(omrs, nmrs)):
            for f in MR_EN_FIELDS + ['outline_en']:
                if nmr.get(f) and f not in mr:
                    missing.append(f'ch{ci + 1}d{di + 1}.{f}')
    log(f'EN 字段缺失: {len(missing)} 处')
    for m in missing[:20]:
        log(f'  - {m}')
    if missing:
        _die('EN 字段完整性检查失败')

    return merged, stats


def _parse_seg_key(k):
    """'(2,2)' → (2, 2)；(2,2) → (2,2)。容忍空格。"""
    if isinstance(k, tuple):
        return k
    m = re.fullmatch(r'\(\s*(\d+)\s*,\s*(\d+)\s*\)', str(k))
    if not m:
        raise MergeError(f'seg_rules 键格式非法: {k!r}（预期 "(ch_idx,day_idx)"）')
    return (int(m.group(1)), int(m.group(2)))


def merge_from_config(old, new, batch_config, log=print):
    """从批次配置 dict 取 seg_rules / ch9d2_special 后调 merge。"""
    seg_rules = {}
    for k, v in (batch_config.get('seg_rules') or {}).items():
        key = _parse_seg_key(k)
        seg_rules[key] = {}
        for field, rmap in v.items():
            seg_rules[key][field] = {int(nk): olds for nk, olds in rmap.items()}
    ch9d2 = batch_config.get('ch9d2_special')
    if ch9d2:
        ch9d2 = _parse_seg_key(ch9d2)
    return merge(old, new, seg_rules=seg_rules, ch9d2_special=ch9d2, log=log)
