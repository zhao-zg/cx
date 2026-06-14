#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PDB (PalmDOC / iSilo) → TXT 转换工具。

用法:
    python convert_pdb.py                          # 转换 resource/pdb/ 下所有 PDB 文件
    python convert_pdb.py --input-dir ./my_pdb     # 指定输入目录
    python convert_pdb.py --wine-isilo             # 使用 Wine + iSilo 转换 (需提前安装)
    python convert_pdb.py --dry-run                # 只扫描不转换

转换后的 TXT 文件存放到 resource/历史合辑/{YYYY}/ 目录。
"""

import os
import re
import struct
import shutil
import subprocess
import sys
from argparse import ArgumentParser
from pathlib import Path
from typing import Optional, Tuple


# ─── PalmDOC 常量 ──────────────────────────────────────────────
PDB_HEADER_SIZE = 78
COMPRESSION_NONE = 1
COMPRESSION_PALMDOC = 2
COMPRESSION_APORTIS = 17480  # 'Huffcdic'

# PalmDOC creator/type identifiers
PALMDOC_TYPES = {
    (b'READ', b'READ'),  # standard PalmDOC
    (b'ToGo', b'ToGo'),  # iSilo 2.x
    (b'SDoc', b'SSil'),  # iSilo 3.x
    (b'XDoc', b'XDoc'),  # XDoc
}

# ─── 训练名称 → 年月 映射 ─────────────────────────────────────
# 从训练文件夹名称提取年份和月份编号
TRAINING_PATTERN = re.compile(r'^(\d{4})-(\d{2})\s')


def decompress_palmdoc(data: bytes) -> bytes:
    """解压缩 PalmDOC 压缩数据 (LZ77 变体)。"""
    result = bytearray()
    i = 0
    while i < len(data):
        c = data[i]
        i += 1

        if 1 <= c <= 8:
            # 复制接下来 c 个字节（不压缩）
            result.extend(data[i:i + c])
            i += c
        elif c < 0x80:
            # 字面量字节
            result.append(c)
        elif c >= 0xC0:
            # 空格 + ASCII 字符
            result.append(0x20)  # 空格
            result.append(c ^ 0x80)
        else:
            # 长度-距离对
            if i >= len(data):
                break
            nxt = data[i]
            i += 1
            dist = ((c << 8) | nxt) & 0x3FFF
            length = ((c >> 3) & 0x07) + 3
            start = max(0, len(result) - dist)
            for _ in range(length):
                if start < len(result):
                    result.append(result[start])
                    start += 1
    return bytes(result)


def parse_pdb_header(data: bytes) -> dict:
    """解析 PDB 文件头。"""
    if len(data) < PDB_HEADER_SIZE:
        raise ValueError("文件太小，不是有效的 PDB 文件")

    # PDB Header (big-endian)
    name = data[0:32].rstrip(b'\x00').decode('utf-8', errors='replace')
    num_records = struct.unpack('>H', data[76:78])[0]

    # 解析 Record Entry List (每条 8 字节)
    records = []
    offset = PDB_HEADER_SIZE
    for _ in range(num_records):
        if offset + 8 > len(data):
            break
        rec_offset = struct.unpack('>I', data[offset:offset + 4])[0]
        rec_attrs = data[offset + 4]
        # 3 bytes unique ID
        rec_id = struct.unpack('>I', b'\x00' + data[offset + 5:offset + 8])[0]
        records.append({'offset': rec_offset, 'attrs': rec_attrs, 'id': rec_id})
        offset += 8

    return {'name': name, 'num_records': num_records, 'records': records}


def extract_palmdoc_text(data: bytes, header: dict) -> Tuple[str, str]:
    """从 PalmDOC PDB 中提取文本。

    返回 (text, encoding_used)。
    """
    records = header['records']
    if len(records) < 2:
        raise ValueError("PDB 记录数不足")

    # Record 0: PalmDOC Header (16 bytes)
    rec0_start = records[0]['offset']
    rec0_end = records[1]['offset'] if len(records) > 1 else len(data)
    rec0 = data[rec0_start:rec0_end]

    if len(rec0) < 16:
        raise ValueError("PalmDOC 头部记录太短")

    compression = struct.unpack('>H', rec0[0:2])[0]
    # rec0[2:4] is unused
    text_length = struct.unpack('>I', rec0[4:8])[0]
    record_count = struct.unpack('>H', rec0[8:10])[0]
    record_size = struct.unpack('>H', rec0[10:12])[0]

    # 提取文本记录 (从 Record 1 开始)
    text_parts = []
    for i in range(1, min(record_count + 1, len(records))):
        rec_start = records[i]['offset']
        if i + 1 < len(records):
            rec_end = records[i + 1]['offset']
        else:
            rec_end = len(data)
        rec_data = data[rec_start:rec_end]

        if compression == COMPRESSION_NONE:
            text_parts.append(rec_data)
        elif compression == COMPRESSION_PALMDOC:
            text_parts.append(decompress_palmdoc(rec_data))
        elif compression == COMPRESSION_APORTIS:
            raise ValueError(f"不支持 Aportis/Huffcdic 压缩格式 (compression={compression})")
        else:
            raise ValueError(f"未知压缩格式: {compression}")

    raw_text = b''.join(text_parts)

    # 截断到 text_length
    if text_length > 0:
        raw_text = raw_text[:text_length]

    # 尝试多种编码解码
    for encoding in ['utf-8', 'gb18030', 'gb2312', 'gbk', 'big5', 'utf-16', 'cp1252']:
        try:
            text = raw_text.decode(encoding)
            # 基本检查: 如果大部分是乱码，跳过
            if encoding != 'cp1252' or all(ord(c) < 128 or c in '\r\n\t' for c in text[:100]):
                return text, encoding
        except (UnicodeDecodeError, ValueError):
            continue

    # 最终回退
    return raw_text.decode('utf-8', errors='replace'), 'utf-8(fallback)'


def detect_pdb_format(data: bytes) -> str:
    """检测 PDB 文件格式。"""
    if len(data) < PDB_HEADER_SIZE:
        return 'unknown'

    pdb_type = data[60:64]
    pdb_creator = data[64:68]

    # iSilo 3.x format
    if pdb_type == b'SDoc' and pdb_creator == b'SSil':
        return 'iSilo3'
    # iSilo 2.x / ToGo
    if pdb_type == b'ToGo' and pdb_creator == b'ToGo':
        return 'iSilo2'
    # Standard PalmDOC
    if pdb_type == b'READ' and pdb_creator == b'READ':
        return 'PalmDOC'
    # XDoc
    if pdb_type == b'XDoc' and pdb_creator == b'XDoc':
        return 'XDoc'

    return f'unknown({pdb_type!r}/{pdb_creator!r})'


def convert_pdb_file(pdb_path: Path, output_path: Path, use_wine_isilo: bool = False) -> bool:
    """转换单个 PDB 文件为 TXT。

    Args:
        pdb_path: PDB 文件路径
        output_path: 输出 TXT 文件路径
        use_wine_isilo: 是否使用 Wine + iSilo

    Returns:
        True 如果转换成功
    """
    try:
        data = pdb_path.read_bytes()
    except Exception as e:
        print(f"  [ERROR] 无法读取文件: {e}")
        return False

    fmt = detect_pdb_format(data)
    print(f"  格式: {fmt}")

    # 尝试 Python 原生 PalmDOC 解压
    if fmt in ('PalmDOC', 'iSilo2'):
        try:
            header = parse_pdb_header(data)
            text, encoding = extract_palmdoc_text(data, header)
            # 清理文本: 去除开头的 BOM, 规范化换行符
            text = text.lstrip('\ufeff')
            text = text.replace('\r\n', '\n').replace('\r', '\n')
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_text(text, encoding='utf-8')
            print(f"  [OK] Python 原生转换成功 (编码: {encoding})")
            print(f"  [OK] → {output_path}")
            return True
        except Exception as e:
            print(f"  [WARN] Python 原生转换失败: {e}")

    # iSilo3 或 Python 转换失败时，尝试 Wine + iSilo
    if use_wine_isilo:
        return convert_with_wine_isilo(pdb_path, output_path)

    # 对于 iSilo3 格式，提示用户使用 Wine + iSilo
    if fmt == 'iSilo3':
        print(f"  [WARN] iSilo3 格式需要 Wine + iSilo 转换")
        print(f"  [WARN] 使用 --wine-isilo 参数启用，或手动转换")
        return False

    # 最后尝试: 将原始数据当作纯文本
    try:
        header = parse_pdb_header(data)
        text, encoding = extract_palmdoc_text(data, header)
        text = text.lstrip('\ufeff').replace('\r\n', '\n').replace('\r', '\n')
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(text, encoding='utf-8')
        print(f"  [OK] 回退模式转换成功 (编码: {encoding})")
        print(f"  [OK] → {output_path}")
        return True
    except Exception as e:
        print(f"  [ERROR] 转换失败: {e}")
        return False


def convert_with_wine_isilo(pdb_path: Path, output_path: Path) -> bool:
    """使用 Wine + iSilo 转换 PDB 文件。

    需要在系统中安装 Wine 和 iSilo for Windows。
    iSilo 路径默认: ~/.wine/drive_c/Program Files/iSilo/iSilo.exe
    可通过环境变量 ISILO_EXE 覆盖。
    """
    isilo_exe = os.environ.get('ISILO_EXE', '')
    if not isilo_exe:
        # 搜索常见安装路径
        search_paths = [
            Path.home() / '.wine' / 'drive_c' / 'Program Files' / 'iSilo' / 'iSilo.exe',
            Path.home() / '.wine' / 'drive_c' / 'Program Files (x86)' / 'iSilo' / 'iSilo.exe',
            Path('/usr/local/share/isilo/iSilo.exe'),
        ]
        for p in search_paths:
            if p.exists():
                isilo_exe = str(p)
                break

    if not isilo_exe:
        print("  [ERROR] 未找到 iSilo.exe，请设置 ISILO_EXE 环境变量")
        return False

    # 使用 Wine 运行 iSilo 命令行转换
    # iSilo 命令行: iSilo.exe /e source.pdb output.txt
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # 转换路径为 Wine 格式
    pdb_wine_path = str(pdb_path.resolve())
    out_wine_path = str(output_path.resolve())

    try:
        result = subprocess.run(
            ['wine', isilo_exe, '/e', pdb_wine_path, out_wine_path],
            capture_output=True,
            text=True,
            timeout=60,
            env={**os.environ, 'WINEDEBUG': '-all'}
        )
        if output_path.exists() and output_path.stat().st_size > 0:
            print(f"  [OK] Wine + iSilo 转换成功")
            print(f"  [OK] → {output_path}")
            return True
        else:
            print(f"  [ERROR] Wine + iSilo 转换失败: {result.stderr[:200]}")
            return False
    except FileNotFoundError:
        print("  [ERROR] Wine 未安装或不在 PATH 中")
        return False
    except subprocess.TimeoutExpired:
        print("  [ERROR] Wine + iSilo 转换超时")
        return False
    except Exception as e:
        print(f"  [ERROR] Wine + iSilo 转换异常: {e}")
        return False


def training_folder_to_year_month(folder_name: str) -> Optional[Tuple[str, str]]:
    """从训练文件夹名称提取年份和月份。

    例如: "2025-04 夏季训练" → ("2025", "2025-04")
    """
    match = TRAINING_PATTERN.match(folder_name)
    if match:
        year = match.group(1)
        month = f"{year}-{match.group(2)}"
        return year, month
    return None


def find_output_path(pdb_path: Path, history_dir: Path) -> Optional[Path]:
    """根据 PDB 文件路径确定输出 TXT 路径。

    PDB 文件路径格式: resource/pdb/{training_folder}/{filename}.pdb
    输出路径格式: resource/历史合辑/{YYYY}/{YYYY-MM}-{title}.txt
    """
    # 获取 training folder 名称
    parts = pdb_path.parts
    # 找到 'pdb' 目录后面的 training folder
    try:
        pdb_idx = parts.index('pdb')
        if pdb_idx + 1 < len(parts):
            training_folder = parts[pdb_idx + 1]
        else:
            return None
    except ValueError:
        return None

    # 从 training folder 提取年月
    result = training_folder_to_year_month(training_folder)
    if not result:
        # 无法解析年月，直接使用 training folder 作为目录名
        year = training_folder
        txt_name = pdb_path.stem + '.txt'
        return history_dir / year / txt_name

    year, month_prefix = result

    # 生成输出文件名: YYYY-MM-pdb原始名称.txt
    txt_name = f"{month_prefix}-{pdb_path.stem}.txt"
    return history_dir / year / txt_name


def scan_pdb_files(input_dir: Path) -> list:
    """扫描目录下的所有 PDB 文件。"""
    if not input_dir.exists():
        print(f"目录不存在: {input_dir}")
        return []
    pdb_files = sorted(input_dir.rglob('*.pdb'))
    return pdb_files


def main() -> None:
    parser = ArgumentParser(description="PDB (PalmDOC/iSilo) → TXT 转换工具")
    parser.add_argument('--input-dir', default='resource/pdb',
                        help='PDB 文件输入目录 (默认: resource/pdb)')
    parser.add_argument('--output-dir', default='resource/历史合辑',
                        help='TXT 文件输出目录 (默认: resource/历史合辑)')
    parser.add_argument('--wine-isilo', action='store_true',
                        help='使用 Wine + iSilo 转换 (需要预装)')
    parser.add_argument('--dry-run', action='store_true',
                        help='只扫描不转换')
    parser.add_argument('--overwrite', action='store_true',
                        help='覆盖已存在的 TXT 文件')
    args = parser.parse_args()

    input_dir = Path(args.input_dir)
    output_dir = Path(args.output_dir)

    print('=' * 80)
    print('PDB → TXT 转换工具')
    print('=' * 80)
    print(f'输入目录: {input_dir}')
    print(f'输出目录: {output_dir}')
    print(f'Wine + iSilo: {"启用" if args.wine_isilo else "禁用"}')
    print('=' * 80)

    pdb_files = scan_pdb_files(input_dir)
    if not pdb_files:
        print(f"\n未找到 PDB 文件: {input_dir}")
        return

    print(f"\n找到 {len(pdb_files)} 个 PDB 文件:")
    for f in pdb_files:
        size_kb = f.stat().st_size / 1024
        print(f"  {f.relative_to(input_dir)} ({size_kb:.1f} KB)")

    if args.dry_run:
        print("\n--dry-run 模式，跳过转换")
        return

    success = 0
    skipped = 0
    failed = 0

    for pdb_path in pdb_files:
        print(f"\n转换: {pdb_path.relative_to(input_dir)}")

        output_path = find_output_path(pdb_path, output_dir)
        if not output_path:
            print(f"  [SKIP] 无法确定输出路径")
            skipped += 1
            continue

        # 检查是否已存在
        if output_path.exists() and not args.overwrite:
            print(f"  [SKIP] 已存在: {output_path}")
            skipped += 1
            continue

        if convert_pdb_file(pdb_path, output_path, args.wine_isilo):
            success += 1
        else:
            failed += 1

    print('\n' + '=' * 80)
    print(f'转换完成: 成功 {success}, 跳过 {skipped}, 失败 {failed}')
    print('=' * 80)


if __name__ == '__main__':
    main()
