# -*- coding: utf-8 -*-
"""verifier.py: 管线产物验证（参数化版）

两个验证器：
1. verify_isomorphism(new): NEW 内部 CN/EN outline 树同构性（probe92 定案）
   - 只比深度序列（DFS 嵌套深度），不比 level 字面量（CN/EN 格式不同属预期）；
   - CN 是 EN 严格前缀属可裁剪差异（merge 豁免），非前缀为真差异。
2. compare_anchor(got, expected, exclude_version=True): 逐字段递归对比两棵 JSON 树
   （排除 version），用于复现验证（本轮产物 vs .temp 锚点）。
   - 对 outline 树先按深度序列对齐（容 CN/EN level 字面量差异）——
     但锚点对比是 exact JSON diff，outline 树内 level 字段也应一致
     （两边都是同一条管线产物），故直接递归 exact 对比并报告路径。
"""
import json


def flat_nodes(nodes):
    out = []

    def w(ns):
        for n in ns or []:
            out.append(n)
            w(n.get('children'))

    w(nodes)
    return out


def depth_seq(nodes, out=None, depth=0):
    if out is None:
        out = []
    for n in nodes or []:
        out.append(depth)
        depth_seq(n.get('children'), out, depth + 1)
    return out


def verify_isomorphism(new, log=print):
    """probe92 定案：NEW 内部 CN/EN 树同构性检查。
    返回 (same, diff, prefix_diff)。前缀差异属 merge 豁免可接受。"""
    same = diff = prefix = 0
    problems = []
    for ci, c in enumerate(new['chapters']):
        pairs = [(f'ch{ci + 1} 周首页',
                  c.get('outline_sections'), c.get('outline_sections_en'))]
        for di, mr in enumerate(c.get('morning_revivals') or []):
            pairs.append((f'ch{ci + 1}d{di + 1}',
                          mr.get('outline'), mr.get('outline_en')))
        for label, a, b in pairs:
            sa, sb = depth_seq(a), depth_seq(b)
            if sa == sb:
                same += 1
            else:
                diff += 1
                if len(sa) < len(sb) and sb[:len(sa)] == sa:
                    prefix += 1
                    log(f'  前缀一致（可裁剪豁免）: {label}  CN {len(sa)} vs EN {len(sb)}')
                else:
                    problems.append(f'{label}  CN {len(sa)} vs EN {len(sb)}')
                    log(f'  真差异: {label}  CN {len(sa)} vs EN {len(sb)}')
    log(f'深度序列: 一致 {same} / 差异 {diff}（其中前缀豁免 {prefix} 处）')
    return same, diff, prefix, problems


# ================= 归一后 NEW CN vs OLD 中文底座 残余差异报告 =================

def _flat_titles(nodes):
    out = []

    def w(ns, d):
        for n in ns or []:
            out.append((d, n.get('level', ''), n.get('title', '')))
            w(n.get('children'), d + 1)

    w(nodes, 0)
    return out


def compare_cn_residual(old, new_norm, log=print):
    """归一化后 NEW 中文字段 vs OLD 中文底座逐字段对比（诊断报告，非门禁）。
    NEW CN 解析不可能完全复刻 OLD 人工校对，残余差异正是 merge 采用 OLD 底座的原因。
    2026-04 批次基线：44 处。返回 diffs 数量。"""
    diffs = []

    def cmp_list_field(loc, ov, nv):
        if ov == nv:
            return
        if not isinstance(ov, list) or not isinstance(nv, list) or len(ov) != len(nv):
            diffs.append((loc, 'list', ov, nv))
            return
        for k, (a, b) in enumerate(zip(ov, nv)):
            if a != b:
                diffs.append((f'{loc}[{k}]', 'item', a, b))
                break

    def cmp_outline(loc, o_nodes, n_nodes):
        fo, fn = _flat_titles(o_nodes), _flat_titles(n_nodes)
        if fo == fn:
            return
        if len(fo) != len(fn):
            diffs.append((loc, 'outline-count', f'{len(fo)} 节点', f'{len(fn)} 节点'))
        n_cmp = min(len(fo), len(fn))
        for k in range(n_cmp):
            if fo[k] != fn[k]:
                diffs.append((f'{loc} flat[{k}]', 'node', fo[k], fn[k]))
                break

    MR_FIELDS = ['feeding_refs', 'feeding_scriptures', 'morning_feeding',
                 'message_reading', 'ref_reading']
    CH_FIELDS = ['title', 'hymn_number', 'scripture', 'hymn_lyrics']

    for ci in range(len(old['chapters'])):
        oc, nc = old['chapters'][ci], new_norm['chapters'][ci]
        for f in CH_FIELDS:
            ov, nv = oc.get(f), nc.get(f)
            if isinstance(ov, list) or isinstance(nv, list):
                cmp_list_field(f'ch{ci + 1} {f}', ov, nv)
            elif ov != nv:
                diffs.append((f'ch{ci + 1} {f}', 'str', ov, nv))
        cmp_outline(f'ch{ci + 1} 周首页', oc.get('outline_sections'),
                    nc.get('outline_sections'))
        omrs, nmrs = oc.get('morning_revivals') or [], nc.get('morning_revivals') or []
        if len(omrs) != len(nmrs):
            diffs.append((f'ch{ci + 1}', 'mr-count', len(omrs), len(nmrs)))
            continue
        for di in range(len(omrs)):
            for f in MR_FIELDS:
                cmp_list_field(f'ch{ci + 1}d{di + 1} {f}',
                               omrs[di].get(f), nmrs[di].get(f))
            cmp_outline(f'ch{ci + 1}d{di + 1}', omrs[di].get('outline'),
                        nmrs[di].get('outline'))

    log(f'归一后 NEW CN vs OLD 底座残余差异: {len(diffs)} 处（诊断基线，merge 以 OLD 为底座故不影响产物）')

    def r(x, n=64):
        s = x if isinstance(x, str) else repr(x)
        s = s.replace('\n', ' ')
        return s[:n] + ('…' if len(s) > n else '')

    for loc, kind, ov, nv in diffs[:10]:
        log(f'- [{kind}] {loc}')
        log(f'    OLD: {r(ov)}')
        log(f'    NEW: {r(nv)}')
    return len(diffs)


# ================= 锚点精确对比 =================

def _walk_diff(path, a, b, diffs, list_ctx=None):
    """递归 exact 对比。list_ctx 用于数组元素路径显示。"""
    if type(a) is not type(b):
        diffs.append((path, f'类型 {type(a).__name__} vs {type(b).__name__}',
                      _brief(a), _brief(b)))
        return
    if isinstance(a, dict):
        ka, kb = set(a.keys()), set(b.keys())
        for k in sorted(ka - kb):
            diffs.append((f'{path}.{k}' if path else k, '仅A有', _brief(a[k]), '<无>'))
        for k in sorted(kb - ka):
            diffs.append((f'{path}.{k}' if path else k, '仅B有', '<无>', _brief(b[k])))
        for k in sorted(ka & kb):
            _walk_diff(f'{path}.{k}' if path else k, a[k], b[k], diffs)
    elif isinstance(a, list):
        if len(a) != len(b):
            diffs.append((path, f'数组长度 {len(a)} vs {len(b)}', '', ''))
            n = min(len(a), len(b))
        else:
            n = len(a)
        for i in range(n):
            _walk_diff(f'{path}[{i}]', a[i], b[i], diffs)
    else:
        if a != b:
            diffs.append((path, '值不同', _brief(a), _brief(b)))


def _brief(x, n=60):
    s = x if isinstance(x, str) else json.dumps(x, ensure_ascii=False)
    s = s.replace('\n', ' ')
    return s[:n] + ('…' if len(s) > n else '')


def compare_anchor(got, expected, exclude_version=True, log=print):
    """逐字段对比 got vs expected（锚点）。exclude_version=True 时两边 version 置空。
    返回 diffs 列表 [(path, kind, got_brief, expected_brief)]。"""
    if exclude_version:
        got = json.loads(json.dumps(got, ensure_ascii=False))
        expected = json.loads(json.dumps(expected, ensure_ascii=False))
        if isinstance(got, dict):
            got['version'] = ''
        if isinstance(expected, dict):
            expected['version'] = ''
    diffs = []
    _walk_diff('', got, expected, diffs)
    log(f'锚点对比差异: {len(diffs)} 处')
    for path, kind, ga, eb in diffs[:30]:
        log(f'- [{kind}] {path}')
        if ga or eb:
            log(f'    got: {ga}')
            log(f'    exp: {eb}')
    return diffs
