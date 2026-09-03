# -*- coding: utf-8 -*-
"""hwmr.py: HWMR 双语管线 CLI 入口

子命令：
  parse <批次短名>     PDF → NEW 双语树 JSON（写 resource/<批次>/training-enchs.json 前身，输出到 .temp 复验）
  normalize <批次短名> NEW 中文字段归一（写 .temp 复验）
  merge <批次短名>     OLD 底座 + NEW → 双语 training.json（写 resource/<批次>/training-enchs.json）
  verify <批次短名>    同构检查 + 锚点复现对比（如锚点存在）
  all <批次短名>       parse → normalize → merge → verify 一条龙

用法（在 cx 项目根目录运行）：
  G:\\soft\\Python3.12\\python.exe -X utf8 tools/hwmr/hwmr.py all 2026-04

批次配置：tools/hwmr/batches/<短名>.json
锚点文件（复现验证用，可选）：.temp/hwmr-enchs.json / hwmr-enchs-norm.json / hwmr-enchs-merged.json
"""
import io
import json
import os
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(TOOLS_DIR))  # cx 项目根目录
sys.path.insert(0, TOOLS_DIR)

import parser as hwmr_parser      # noqa: E402
import normalizer                  # noqa: E402
import merger                      # noqa: E402
import verifier                    # noqa: E402

TEMP = os.path.join(ROOT, '.temp')
BATCHES_DIR = os.path.join(TOOLS_DIR, 'batches')


def log(msg):
    print(msg)


def load_batch(short_name):
    path = os.path.join(BATCHES_DIR, f'{short_name}.json')
    if not os.path.exists(path):
        log(f'[FATAL] 批次配置不存在: {path}')
        sys.exit(1)
    return json.load(open(path, encoding='utf-8'))


def batch_paths(cfg):
    batch_dir = os.path.join(ROOT, 'resource', cfg['batch_name'])
    return {
        'pdf': os.path.join(ROOT, cfg['pdf']),
        'batch_dir': batch_dir,
        'enchs_final': os.path.join(batch_dir, 'training-enchs.json'),
        'new_tmp': os.path.join(TEMP, f'hwmr-enchs-{cfg["short_name"]}.json'),
        'norm_tmp': os.path.join(TEMP, f'hwmr-enchs-{cfg["short_name"]}-norm.json'),
        'merged_tmp': os.path.join(TEMP, f'hwmr-enchs-{cfg["short_name"]}-merged.json'),
        'old_training': os.path.join(ROOT, 'output', cfg['short_name'], 'training.json'),
    }


def load_old_training(paths, cfg):
    p = paths['old_training']
    if not os.path.exists(p):
        log(f'[FATAL] OLD 中文底座不存在: {p}（先运行 python main.py 生成）')
        sys.exit(1)
    return json.load(open(p, encoding='utf-8'))


# ================= 子命令 =================

def cmd_parse(cfg):
    paths = batch_paths(cfg)
    if not os.path.exists(paths['pdf']):
        log(f'[FATAL] PDF 不存在: {paths["pdf"]}')
        sys.exit(1)
    result = hwmr_parser.build(paths['pdf'], cfg, log=log)
    problems = hwmr_parser.summarize(result, log=log)
    json.dump(result, open(paths['new_tmp'], 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    log(f'NEW 双语树已写入: {paths["new_tmp"]}')
    return result, problems


def cmd_normalize(cfg, new=None):
    paths = batch_paths(cfg)
    if new is None:
        if not os.path.exists(paths['new_tmp']):
            log(f'[FATAL] NEW 文件不存在: {paths["new_tmp"]}（先运行 parse）')
            sys.exit(1)
        new = json.load(open(paths['new_tmp'], encoding='utf-8'))
    new_norm = normalizer.normalize(new)
    json.dump(new_norm, open(paths['norm_tmp'], 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    log(f'归一化已写入: {paths["norm_tmp"]}')
    return new_norm


def cmd_merge(cfg, new_norm=None):
    paths = batch_paths(cfg)
    if new_norm is None:
        if not os.path.exists(paths['norm_tmp']):
            log(f'[FATAL] 归一化文件不存在: {paths["norm_tmp"]}（先运行 normalize）')
            sys.exit(1)
        new_norm = json.load(open(paths['norm_tmp'], encoding='utf-8'))
    old = load_old_training(paths, cfg)
    merged, stats = merger.merge_from_config(old, new_norm, cfg, log=log)
    json.dump(merged, open(paths['merged_tmp'], 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    log(f'合并完成: {paths["merged_tmp"]}')
    log(f'统计: {stats}')
    return merged, stats


def cmd_verify(cfg):
    paths = batch_paths(cfg)
    new = json.load(open(paths['new_tmp'], encoding='utf-8'))
    log('== NEW 内部 CN/EN 树同构性 ==')
    verifier.verify_isomorphism(new, log=log)

    # 残余差异诊断（NEW 归一 CN vs OLD 底座；非门禁，2026-04 基线 44 处）
    if os.path.exists(paths['norm_tmp']) and os.path.exists(paths['old_training']):
        log('== 归一 CN vs OLD 底座残余差异（诊断） ==')
        old = json.load(open(paths['old_training'], encoding='utf-8'))
        new_norm = json.load(open(paths['norm_tmp'], encoding='utf-8'))
        verifier.compare_cn_residual(old, new_norm, log=log)

    anchors = [
        ('parse', paths['new_tmp'], os.path.join(TEMP, 'hwmr-enchs.json')),
        ('norm', paths['norm_tmp'], os.path.join(TEMP, 'hwmr-enchs-norm.json')),
        ('merged', paths['merged_tmp'], os.path.join(TEMP, 'hwmr-enchs-merged.json')),
    ]
    all_ok = True
    for tag, got_path, anchor_path in anchors:
        if not os.path.exists(anchor_path):
            log(f'[skip] {tag} 锚点不存在: {anchor_path}')
            continue
        got = json.load(open(got_path, encoding='utf-8'))
        exp = json.load(open(anchor_path, encoding='utf-8'))
        log(f'== {tag} vs 锚点 ==')
        diffs = verifier.compare_anchor(got, exp, exclude_version=True, log=log)
        if diffs:
            all_ok = False
    return all_ok


def install(cfg, merged):
    """把合并结果落到批次目录 training-enchs.json（main.py 构建时自动带入 output）。"""
    paths = batch_paths(cfg)
    os.makedirs(paths['batch_dir'], exist_ok=True)
    json.dump(merged, open(paths['enchs_final'], 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    log(f'已安装: {paths["enchs_final"]}')


def main():
    if len(sys.argv) < 3:
        log(__doc__)
        sys.exit(2)
    cmd_name, short_name = sys.argv[1], sys.argv[2]
    cfg = load_batch(short_name)
    paths = batch_paths(cfg)

    if cmd_name == 'parse':
        cmd_parse(cfg)
    elif cmd_name == 'normalize':
        cmd_normalize(cfg)
    elif cmd_name == 'merge':
        cmd_merge(cfg)
    elif cmd_name == 'verify':
        ok = cmd_verify(cfg)
        sys.exit(0 if ok else 1)
    elif cmd_name == 'install':
        merged = json.load(open(paths['merged_tmp'], encoding='utf-8'))
        install(cfg, merged)
    elif cmd_name == 'all':
        result, problems = cmd_parse(cfg)
        if problems:
            log(f'[WARN] 解析存在 {problems} 处异常预警，继续后续步骤')
        new_norm = cmd_normalize(cfg, new=result)
        merged, stats = cmd_merge(cfg, new_norm=new_norm)
        ok = cmd_verify(cfg)
        install(cfg, merged)
        log(f'== all 完成（verify {"PASS" if ok else "有差异，见上"}）==')
    else:
        log(f'未知子命令: {cmd_name}')
        log(__doc__)
        sys.exit(2)


if __name__ == '__main__':
    main()
