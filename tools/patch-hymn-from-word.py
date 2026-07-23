# -*- coding: utf-8 -*-
"""
从晨兴 Word 文档中提取诗歌内容和图片，合并到 TXT 生成的 training.json。

用法:
    python tools/patch-hymn-from-word.py --output-dir <dir> --batch-folder <folder>

功能:
    1. 在批次文件夹中查找晨兴 Word 文档
    2. 提取每篇的诗歌文本（hymn_number）和诗歌图片（hymn_images）
    3. 将提取的数据合并到 training.json 中
    4. 输出 JSON 摘要到 stdout（供调用方解析）
"""
import os
import re
import sys
import json

# 将项目根目录加入 sys.path，以便导入 src 模块
_project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from src.models import Chapter
from src.parser_improved import ImprovedParser


def find_morning_docs(folder_path):
    """在批次文件夹中查找晨兴 Word 文档（.doc / .docx），按文件名排序。
    
    去重规则：
    1. 同一基础名同时有 .doc 和 .docx 时，优先 .docx（更现代，可直接提取图片）
    2. 内容完全相同的文件只保留一份（如 晨兴.doc 和 晨兴2.doc 可能是同一文档的复制）
    """
    if not os.path.isdir(folder_path):
        return []
    all_docs = sorted([
        os.path.join(folder_path, f)
        for f in os.listdir(folder_path)
        if ('晨兴' in f or 'morning' in f.lower())
        and (f.endswith('.doc') or f.endswith('.docx'))
        and os.path.isfile(os.path.join(folder_path, f))
    ])
    # 去重1：同名 .doc 和 .docx 只保留 .docx
    seen_bases = {}  # base_name -> file_path
    for fp in all_docs:
        fname = os.path.basename(fp)
        base = fname.rsplit('.', 1)[0]  # 去掉扩展名
        if base in seen_bases:
            if fp.endswith('.docx'):
                seen_bases[base] = fp
        else:
            seen_bases[base] = fp
    
    # 去重2：按文件内容（大小+MD5）去重，内容相同的只保留一份
    import hashlib
    seen_hashes = {}  # (size, md5) -> file_path
    for base in sorted(seen_bases.keys()):
        fp = seen_bases[base]
        try:
            fsize = os.path.getsize(fp)
            with open(fp, 'rb') as f:
                fhash = hashlib.md5(f.read()).hexdigest()
            key = (fsize, fhash)
            if key in seen_hashes:
                # 内容与已有文件完全相同，跳过
                print(f"  跳过重复文档: {os.path.basename(fp)} (与 {os.path.basename(seen_hashes[key])} 内容相同)", file=sys.stderr)
                continue
            seen_hashes[key] = fp
        except Exception:
            seen_hashes[id(fp)] = fp
    
    result = [seen_hashes[k] for k in sorted(seen_hashes.keys(), key=lambda k: seen_hashes[k])]
    return result


def patch_training_json(output_dir, batch_folder):
    """
    从晨兴 Word 文档提取诗歌数据，合并到 training.json。

    Returns:
        dict: 操作摘要（含 patched_chapters 数量）
    """
    training_path = os.path.join(output_dir, 'training.json')
    if not os.path.exists(training_path):
        print("training.json 不存在，跳过诗歌补丁", file=sys.stderr)
        return {'patched_chapters': 0, 'error': 'training.json not found'}

    # 读取现有 training.json
    with open(training_path, 'r', encoding='utf-8') as f:
        training_data = json.load(f)

    chapter_count = len(training_data.get('chapters', []))
    if chapter_count == 0:
        return {'patched_chapters': 0, 'error': 'no chapters in training.json'}

    # 查找晨兴文档
    morning_docs = find_morning_docs(batch_folder)
    if not morning_docs:
        print("未找到晨兴 Word 文档，跳过诗歌补丁", file=sys.stderr)
        return {'patched_chapters': 0, 'warning': 'no morning doc found'}

    print(f"找到 {len(morning_docs)} 个晨兴文档", file=sys.stderr)
    for d in morning_docs:
        print(f"  - {os.path.basename(d)}", file=sys.stderr)

    # 创建 ImprovedParser（仅用于晨兴解析和图片提取）
    parser = ImprovedParser(output_dir=output_dir)

    # 创建与 training.json 章节数匹配的 Chapter 对象列表
    chapters = []
    for i, ch in enumerate(training_data['chapters']):
        c = Chapter(
            number=ch.get('number', i + 1),
            title=ch.get('title', '')
        )
        chapters.append(c)

    # 解析每个晨兴文档（提取 hymn_number 文本 + hymn_images 图片）
    for doc_path in morning_docs:
        print(f"  解析: {os.path.basename(doc_path)}", file=sys.stderr)
        parser.parse_morning_revival_doc(doc_path, chapters)

    # 合并诗歌数据到 training.json
    patched = 0
    for i, ch in enumerate(training_data['chapters']):
        word_ch = chapters[i]
        updated = False

        # 补丁 hymn_number（诗歌文本内容）
        if word_ch.hymn_number and not ch.get('hymn_number'):
            ch['hymn_number'] = word_ch.hymn_number
            updated = True
        elif word_ch.hymn_number:
            # TXT 已有引用，Word 有更完整的诗歌内容
            # 如果 Word 内容更长（包含完整诗歌歌词），使用 Word 版本
            if len(word_ch.hymn_number) > len(ch.get('hymn_number', '')):
                ch['hymn_number'] = word_ch.hymn_number
                updated = True

        # 补丁 hymn_images（诗歌图片）— Word 优先，覆盖 EPUB 的图片
        # EPUB 图片和歌词是配对的（来自 _h_hymn.htm），用 Word 图片时需清空 EPUB 歌词
        if word_ch.hymn_images:
            ch['hymn_images'] = word_ch.hymn_images
            ch['hymn_image'] = word_ch.hymn_image
            ch['hymn_lyrics'] = []
            updated = True

        if updated:
            patched += 1

    # 写回 training.json
    with open(training_path, 'w', encoding='utf-8') as f:
        json.dump(training_data, f, ensure_ascii=False, indent=2)

    result = {
        'patched_chapters': patched,
        'morning_docs': [os.path.basename(d) for d in morning_docs],
        'total_chapters': chapter_count,
    }

    # 收集每篇的 hymn 摘要
    hymn_summary = []
    for i, ch in enumerate(training_data['chapters']):
        hymn_summary.append({
            'chapter': ch.get('number', i + 1),
            'hymn_number': (ch.get('hymn_number', '') or '')[:80],
            'hymn_images': ch.get('hymn_images', []),
        })
    result['hymn_summary'] = hymn_summary

    return result


def main():
    import argparse
    parser = argparse.ArgumentParser(description='从晨兴 Word 文档提取诗歌数据并合并到 training.json')
    parser.add_argument('--output-dir', required=True, help='training.json 所在目录')
    parser.add_argument('--batch-folder', required=True, help='批次 resource 文件夹（含晨兴 .doc/.docx）')
    args = parser.parse_args()

    result = patch_training_json(args.output_dir, args.batch_folder)
    # 摘要输出到 stdout
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
