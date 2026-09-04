# -*- coding: utf-8 -*-
"""
从「晨兴中英对照.pdf」识别诗歌页（12 周诗歌 + 封面歌），渲染为 200dpi WebP q80，
**追加**到 training.json（hymn_images / motto_song_images 尾部），幂等可重跑。

Word 图优先（APK 瘦身策略）：training.json 中该章已有非 PDF 来源（Word/EPUB）诗歌图
→ 不渲染、不追加 PDF 高清图；hymn_images 为空/缺失的章才补 PDF 图；封面歌同理。
无 training.json 时（独立 CLI 场景）保持旧行为：全量渲染。

用法:
    python tools/patch-hymn-from-pdf.py --output-dir <dir> --batch-folder <folder> [--force]

设计要点:
    - Word 图优先：已有 Word 图（非 hymn_pdf_ / 标语诗歌_pdf_ 前缀项）的章/封面歌
      跳过渲染与追加，计入 skipped_word；无 Word 图的章保持 PDF 图补齐。
    - 命名：周诗歌 hymn_pdf_{number}.webp（number=1-12）；
            封面歌 标语诗歌_pdf_{n}.webp（n=1..len(motto)），以「标语」开头才能被
            build-batch-epub.js/py 的 ^标语 匹配复制进 output/images/。
    - 幂等：目标 WebP 已存在且非 --force → 跳过渲染；JSON 已含 hymn_pdf_ / 标语_pdf_ 项 → 不重复追加。
    - 进度打印到 stderr，JSON 摘要打印到 stdout（供 main.py 解析）。
"""
import argparse
import io
import json
import os
import sys

# 将项目根目录加入 sys.path，以便导入 tools 模块
_project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from tools.hymn_pdf_lib import identify_hymn_pages, crop_render, compress_webp

PDF_FILENAME = '晨兴中英对照.pdf'
HYMN_PREFIX = 'hymn_pdf_'
MOTTO_PREFIX = '标语诗歌_pdf_'  # 以「标语」开头，可被 build-batch-epub 的 ^标语 规则复制


def patch_hymn_from_pdf(output_dir, batch_folder, force=False):
    """识别→渲染→追加→写回。返回摘要 dict。"""
    pdf_path = os.path.join(batch_folder, PDF_FILENAME)
    if not os.path.exists(pdf_path):
        print(f"  ⚠ 未找到 {PDF_FILENAME}，跳过 PDF 诗歌图补充", file=sys.stderr)
        return {'images_written': 0, 'patched_chapters': 0,
                'motto_appended': False, 'skipped_existing': 0, 'skipped_word': 0,
                'weeks': [], 'motto': [], 'warning': 'pdf not found'}

    res = identify_hymn_pages(pdf_path)
    weeks = res['weeks']
    motto = res['motto']
    if not weeks and not motto:
        print("  ⚠ PDF 中未识别到诗歌页（识别为 0），跳过", file=sys.stderr)
        return {'images_written': 0, 'patched_chapters': 0,
                'motto_appended': False, 'skipped_existing': 0, 'skipped_word': 0,
                'weeks': [], 'motto': [], 'warning': 'no hymn pages identified'}

    images_dir = os.path.join(output_dir, 'images')
    os.makedirs(images_dir, exist_ok=True)

    # ── 预读 training.json：识别已有 Word/EPUB 诗歌图的目标（Word 图优先策略）───
    training_path = os.path.join(output_dir, 'training.json')
    word_hymn_numbers = set()  # hymn_images 含非 PDF 图（Word/EPUB）的章号
    all_json_numbers = set()   # training.json 中实际存在的章号
    has_word_motto = False     # motto_song_images 含 Word 图
    td = None
    if os.path.exists(training_path):
        with open(training_path, 'r', encoding='utf-8') as f:
            td = json.load(f)
        for ch in td.get('chapters', []):
            number = ch.get('number')
            all_json_numbers.add(number)
            hym = ch.get('hymn_images')
            if not isinstance(hym, list):
                continue
            if any(not str(x).startswith('images/' + HYMN_PREFIX) for x in hym):
                word_hymn_numbers.add(number)
        mlist = td.get('motto_song_images')
        if isinstance(mlist, list) and any(
                not str(x).startswith('images/' + MOTTO_PREFIX) for x in mlist):
            has_word_motto = True

    images_written = 0
    skipped_existing = 0
    skipped_word = 0
    skipped_no_chapter = 0

    # ── 渲染周诗歌 WebP（已有 Word 图的章跳过；JSON 无对应章号的也跳过——
    #    渲染了不会被任何章引用，属于 orphan 文件白占 APK 体积）───────────
    for w in weeks:
        number = w['number']
        if td is not None and number not in all_json_numbers:
            skipped_no_chapter += 1
            continue
        if number in word_hymn_numbers:
            skipped_word += 1
            continue
        fname = f'{HYMN_PREFIX}{number}.webp'
        fpath = os.path.join(images_dir, fname)
        if os.path.exists(fpath) and not force:
            skipped_existing += 1
            continue
        img = crop_render(pdf_path, w['page_index'], dpi=200)
        data = compress_webp(img, quality=80)
        with open(fpath, 'wb') as f:
            f.write(data)
        images_written += 1
        print(f"  ✓ 写入 {fname} ({len(data) / 1024:.0f}KB, 页 {w['page_index']})", file=sys.stderr)

    # ── 渲染封面歌 WebP（含续页；已有 Word 图则整体跳过）────────────────
    if has_word_motto:
        skipped_word += len(motto)
        print(f"  ↷ 封面歌已有 Word 图，跳过 {len(motto)} 张 PDF 高清图", file=sys.stderr)
    for n, idx in enumerate(motto, start=1):
        if has_word_motto:
            continue
        fname = f'{MOTTO_PREFIX}{n}.webp'
        fpath = os.path.join(images_dir, fname)
        if os.path.exists(fpath) and not force:
            skipped_existing += 1
            continue
        img = crop_render(pdf_path, idx, dpi=200)
        data = compress_webp(img, quality=80)
        with open(fpath, 'wb') as f:
            f.write(data)
        images_written += 1
        print(f"  ✓ 写入 {fname} ({len(data) / 1024:.0f}KB, 第 {idx} 页)", file=sys.stderr)

    # ── JSON 追加引用（Word 图优先：已有 Word 图的章/封面歌不追加）───────
    patched_chapters = 0
    motto_appended = False
    if td is not None:
        for ch in td.get('chapters', []):
            hym = ch.get('hymn_images')
            if not isinstance(hym, list):
                continue
            number = ch.get('number')
            # 第 N 周诗歌图只追加到对应 number 的章
            target = f'images/{HYMN_PREFIX}{number}.webp'
            # 幂等：该章已含自身对应图则跳过
            if any(str(x) == target for x in hym):
                continue
            # Word 图优先：该章已有 Word 图则不追加 PDF 图；
            # 仅当该 number 在 weeks 映射中才追加（避免无效 number 追加幽灵图）
            if number not in word_hymn_numbers and number in {w['number'] for w in weeks}:
                hym.append(target)
                patched_chapters += 1

        motto_list = td.get('motto_song_images')
        if isinstance(motto_list, list) and not has_word_motto and not any(
                str(x).startswith('images/' + MOTTO_PREFIX) for x in motto_list):
            for n in range(1, len(motto) + 1):
                motto_list.append(f'images/{MOTTO_PREFIX}{n}.webp')
            motto_appended = True

        with open(training_path, 'w', encoding='utf-8') as f:
            json.dump(td, f, ensure_ascii=False, indent=2)
    else:
        print(f"  ⚠ training.json 不存在（{training_path}），仅生成图片", file=sys.stderr)

    return {
        'images_written': images_written,
        'patched_chapters': patched_chapters,
        'motto_appended': motto_appended,
        'skipped_existing': skipped_existing,
        'skipped_word': skipped_word,
        'skipped_no_chapter': skipped_no_chapter,
        'weeks': weeks,
        'motto': motto,
    }


def main():
    parser = argparse.ArgumentParser(description='从晨兴中英对照 PDF 追加高清诗歌图到 training.json')
    parser.add_argument('--output-dir', required=True, help='training.json 所在目录')
    parser.add_argument('--batch-folder', required=True, help='批次 resource 文件夹（含 晨兴中英对照.pdf）')
    parser.add_argument('--force', action='store_true', help='强制重新渲染（覆盖已存在的 WebP）')
    args = parser.parse_args()

    result = patch_hymn_from_pdf(args.output_dir, args.batch_folder, force=args.force)
    # 摘要输出到 stdout
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()