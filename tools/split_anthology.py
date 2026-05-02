#!/usr/bin/env python3
"""
将 97-25-特会合辑.txt 按训练拆分为每个独立 txt 文件。

输出到 resource/历史合辑/{year}/{year}-{seq:02d}-{name}.txt
每个文件格式：
  {训练索引区内容}          ← 该训练的标题 / 总题 / 篇目列表
  TOP
  ────────────────────────────────────────────────────────────
  详细信息
  ────────────────────────────────────────────────────────────
  {该训练的详细大纲内容}

拆分完成后，可将大文件加入 .gitignore 以减小仓库体积。

用法：
  cd tools
  python split_anthology.py            # 拆分大合辑
  python split_anthology.py --delete   # 拆分后删除 part-* 临时文件
"""

import argparse
import os
import sys

# 直接导入 split_trainings 的函数（需在 tools/ 目录运行）
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import split_trainings as st


def main():
    parser = argparse.ArgumentParser(description='拆分历史合辑大文件为每个单独训练 txt')
    parser.add_argument('--delete', action='store_true',
                        help='拆分完成后删除 part-* 临时文件')
    parser.add_argument('--no-delete-parts', action='store_true',
                        help='保留 part-* 临时文件（默认也保留，此选项明确声明）')
    args = parser.parse_args()

    big_file = os.path.normpath(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), st.INPUT_FILE)
    )
    anthology_dir = os.path.normpath(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), st.OUTPUT_DIR)
    )

    if not os.path.exists(big_file):
        print(f"[错误] 找不到大合辑文件: {big_file}")
        print("  如已拆分，无需再运行。")
        sys.exit(1)

    print(f"读取 {os.path.basename(big_file)} ...")
    with open(big_file, encoding='utf-8') as f:
        lines = f.readlines()
    print(f"  共 {len(lines):,} 行")

    print("解析索引区 ...")
    sections = st.parse_index_sections(lines, st.DETAIL_START)
    print(f"  识别到 {len(sections)} 个训练/特会")

    print("构建详细内容索引 ...")
    detail_index = st.build_detail_index(lines, st.DETAIL_START)
    print(f"  详细区第一篇条目数: {len(detail_index)}")

    print(f"\n写入 per-training txt 到 {anthology_dir}/{{year}}/ ...")
    st.write_sections(sections, lines, detail_index, st.DETAIL_START)

    # 统计已生成文件数
    generated = 0
    for entry in os.listdir(anthology_dir):
        sub = os.path.join(anthology_dir, entry)
        if os.path.isdir(sub):
            generated += sum(1 for fn in os.listdir(sub) if fn.endswith('.txt'))

    print(f"\n完成！共生成 {generated} 个训练 txt 文件。")
    print(f"\n建议步骤：")
    print(f"  1. 将以下内容加入 resource/历史合辑/.gitignore（或根目录 .gitignore）：")
    print(f"       97-25-特会合辑.txt")
    print(f"       part-*.txt")
    print(f"  2. 提交 resource/历史合辑/{{year}}/*.txt 到 git")

    # 删除 part-* 文件
    if args.delete:
        deleted = []
        for fn in os.listdir(anthology_dir):
            if fn.lower().startswith('part-') and fn.endswith('.txt'):
                fp = os.path.join(anthology_dir, fn)
                os.remove(fp)
                deleted.append(fn)
        if deleted:
            print(f"\n已删除 part-* 临时文件: {', '.join(deleted)}")


if __name__ == '__main__':
    main()
