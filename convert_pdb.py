#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PDB (PalmDOC / iSilo) → TXT 转换工具。

用法:
    python convert_pdb.py                          # 转换 resource/pdb/ 下所有 PDB 文件
    python convert_pdb.py --input-dir ./my_pdb     # 指定输入目录
    python convert_pdb.py --isilo-exe "C:\\Program Files\\iSilo\\iSilo.exe"  # 指定 iSilo 路径 (Windows)
    python convert_pdb.py --wine-isilo             # 使用 Wine + iSilo 转换 (Linux)
    python convert_pdb.py --dry-run                # 只扫描不转换

转换后的 TXT 文件存放到 resource/历史合辑/{YYYY}/ 目录。

iSilo3 格式 (SDoc/SilX) 使用专有二进制编码，Python 无法原生解析。
需要安装 iSilo for Windows (https://www.isilox.com/download/) 进行转换。
"""

import os
import platform
import re
import shutil
import struct
import subprocess
import sys
import zipfile
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
    (b'SDoc', b'SilX'),  # iSilo 3.x (extended)
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

    # iSilo 3.x format (SDoc/SSil 或 SDoc/SilX)
    if pdb_type == b'SDoc' and pdb_creator in (b'SSil', b'SilX'):
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


def unzip_pdb_file(zip_path: Path) -> Optional[Path]:
    """解压 .pdb.zip 文件，返回解压后的 .pdb 路径。解压成功后删除 zip。
    支持 UTF-8 / GBK 编码的中文文件名。
    """
    try:
        zf = zipfile.ZipFile(zip_path, 'r')
        try:
            pdb_member = None
            decoded_name = None
            for info in zf.infolist():
                name = info.filename
                if not (info.flag_bits & 0x800):
                    # ZIP 未标记 UTF-8，尝试多种解码方式
                    # 优先尝试 UTF-8（很多现代压缩工具用 UTF-8 但不设标记位）
                    try:
                        name = info.filename.encode('cp437').decode('utf-8')
                    except (UnicodeDecodeError, UnicodeEncodeError):
                        # 再尝试 GBK（Windows 中文环境常见编码）
                        try:
                            name = info.filename.encode('cp437').decode('gbk')
                        except (UnicodeDecodeError, UnicodeEncodeError):
                            pass
                if name.lower().endswith('.pdb'):
                    pdb_member = info
                    decoded_name = name
                    break

            if pdb_member is None:
                print(f"  [WARN] zip 内未找到 .pdb 文件: {zip_path.name}")
                return None

            pdb_name = Path(decoded_name).name
            pdb_path = zip_path.parent / pdb_name
            with zf.open(pdb_member) as src, open(pdb_path, 'wb') as dst:
                dst.write(src.read())
            size_kb = pdb_path.stat().st_size / 1024
            print(f"  [OK] 已解压: {pdb_name} ({size_kb:.1f} KB)")
        finally:
            zf.close()

        zip_path.unlink()
        return pdb_path
    except zipfile.BadZipFile:
        print(f"  [ERROR] 无效的 zip 文件: {zip_path.name}")
        return None
    except Exception as e:
        print(f"  [ERROR] 解压 zip 失败: {zip_path.name}: {e}")
        return None


def convert_pdb_file(pdb_path: Path, output_path: Path,
                     use_wine_isilo: bool = False,
                     isilo_exe: str = '') -> bool:
    """转换单个 PDB 文件为 TXT。

    Args:
        pdb_path: PDB 文件路径
        output_path: 输出 TXT 文件路径
        use_wine_isilo: 是否使用 Wine + iSilo (Linux)
        isilo_exe: iSilo 可执行文件路径 (Windows 原生)

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

    # iSilo3 或 Python 转换失败时，尝试 iSilo 转换
    # 优先级: 1) Windows 原生 iSilo  2) Wine + iSilo (Linux)
    if isilo_exe:
        return convert_with_native_isilo(pdb_path, output_path, isilo_exe)

    if use_wine_isilo:
        return convert_with_wine_isilo(pdb_path, output_path)

    # 对于 iSilo3 格式，提示用户安装 iSilo
    if fmt == 'iSilo3':
        is_win = platform.system() == 'Windows'
        print(f"  [WARN] iSilo3 格式 (SDoc/SilX 或 SDoc/SSil) 使用专有二进制富文本编码")
        print(f"  [WARN] Python 原生解析不支持此格式")
        if is_win:
            print(f"  [HINT] 请安装 iSilo for Windows: https://www.isilox.com/download/")
            print(f"  [HINT] 然后运行: python convert_pdb.py --isilo-exe \"C:\\Program Files\\iSilo\\iSilo.exe\"")
        else:
            print(f"  [HINT] 使用 --wine-isilo 参数启用 Wine + iSilo 转换")
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


def find_isilo_exe() -> str:
    """搜索 iSilo.exe 的安装路径。

    按优先级搜索:
    1. ISILO_EXE 环境变量
    2. Windows 常见安装路径
    3. Wine 安装路径 (Linux)
    """
    # 1. 环境变量
    exe = os.environ.get('ISILO_EXE', '')
    if exe and Path(exe).exists():
        return exe

    is_win = platform.system() == 'Windows'

    # 2. Windows 常见路径
    if is_win:
        program_files = os.environ.get('ProgramFiles', r'C:\Program Files')
        program_files_x86 = os.environ.get('ProgramFiles(x86)', r'C:\Program Files (x86)')
        search_paths = [
            Path(program_files) / 'iSilo' / 'iSilo.exe',
            Path(program_files_x86) / 'iSilo' / 'iSilo.exe',
        ]
    else:
        # 3. Wine 路径
        search_paths = [
            Path.home() / '.wine' / 'drive_c' / 'Program Files' / 'iSilo' / 'iSilo.exe',
            Path.home() / '.wine' / 'drive_c' / 'Program Files (x86)' / 'iSilo' / 'iSilo.exe',
            Path('/usr/local/share/isilo/iSilo.exe'),
        ]

    for p in search_paths:
        if p.exists():
            return str(p)

    return ''


def convert_with_native_isilo(pdb_path: Path, output_path: Path, isilo_exe: str) -> bool:
    """使用 Windows 原生 iSilo 转换 PDB 文件。

    iSilo 命令行: iSilo.exe /e source.pdb output.txt
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        result = subprocess.run(
            [isilo_exe, '/e', str(pdb_path.resolve()), str(output_path.resolve())],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if output_path.exists() and output_path.stat().st_size > 0:
            # 清理输出: 去除 BOM, 规范化换行符
            text = output_path.read_text(encoding='utf-8', errors='replace')
            text = text.lstrip('\ufeff')
            text = text.replace('\r\n', '\n').replace('\r', '\n')
            output_path.write_text(text, encoding='utf-8')
            print(f"  [OK] iSilo 转换成功")
            print(f"  [OK] → {output_path}")
            return True
        else:
            stderr = result.stderr[:300] if result.stderr else ''
            print(f"  [ERROR] iSilo 转换失败: {stderr}")
            return False
    except FileNotFoundError:
        print(f"  [ERROR] iSilo.exe 未找到: {isilo_exe}")
        return False
    except subprocess.TimeoutExpired:
        print(f"  [ERROR] iSilo 转换超时 (120s)")
        return False
    except Exception as e:
        print(f"  [ERROR] iSilo 转换异常: {e}")
        return False


def convert_with_wine_isilo(pdb_path: Path, output_path: Path) -> bool:
    """使用 Wine + iSilo 转换 PDB 文件。

    需要在系统中安装 Wine 和 iSilo for Windows。
    iSilo 路径默认: ~/.wine/drive_c/Program Files/iSilo/iSilo.exe
    可通过环境变量 ISILO_EXE 覆盖。

    策略: 将文件复制到 Wine prefix 内的简单路径 (避免空格/中文问题)，
    转换后再复制回目标位置。
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

    output_path.parent.mkdir(parents=True, exist_ok=True)

    # 在 Wine prefix 内创建临时工作目录，使用纯 ASCII 路径
    # 这样 Wine 下 iSilo.exe 能通过 C:\tmp\isilo_conv\ 访问
    wine_prefix = Path.home() / '.wine' / 'drive_c'
    wine_tmp = wine_prefix / 'tmp' / 'isilo_conv'
    wine_tmp.mkdir(parents=True, exist_ok=True)

    tmp_pdb = wine_tmp / 'input.pdb'
    tmp_out = wine_tmp / 'output.txt'

    # 复制 PDB 到临时路径 (避免空格/中文字符问题)
    try:
        shutil.copy2(str(pdb_path.resolve()), str(tmp_pdb))
    except Exception as e:
        print(f"  [ERROR] 复制 PDB 到临时目录失败: {e}")
        return False

    # 清理可能残留的旧输出
    if tmp_out.exists():
        tmp_out.unlink()

    # 转换为 Wine Windows 路径: C:\tmp\isilo_conv\input.pdb
    wine_in = r'C:\tmp\isilo_conv\input.pdb'
    wine_out = r'C:\tmp\isilo_conv\output.txt'

    # 确保没有残留的 wineserver 干扰
    try:
        subprocess.run(['wineserver', '-k'], capture_output=True, timeout=5)
    except Exception:
        pass

    cmd = ['wine', isilo_exe, '/e', wine_in, wine_out]
    print(f"  [CMD] {' '.join(cmd)}", flush=True)
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=120,
            env={**os.environ, 'WINEDEBUG': '-all'}
        )
    except FileNotFoundError:
        print("  [ERROR] Wine 未安装或不在 PATH 中")
        return False
    except subprocess.TimeoutExpired:
        print("  [ERROR] Wine + iSilo 转换超时 (120s)")
        # 强制杀死残留 Wine 进程
        try:
            subprocess.run(['wineserver', '-k'], capture_output=True, timeout=10)
        except Exception:
            pass
        return False
    except Exception as e:
        print(f"  [ERROR] Wine + iSilo 转换异常: {e}")
        return False
    finally:
        # 清理临时输入文件
        if tmp_pdb.exists():
            tmp_pdb.unlink()

    # 检查结果
    if tmp_out.exists() and tmp_out.stat().st_size > 0:
        try:
            shutil.copy2(str(tmp_out), str(output_path))
            tmp_out.unlink()
            print(f"  [OK] Wine + iSilo 转换成功")
            print(f"  [OK] → {output_path}")
            return True
        except Exception as e:
            print(f"  [ERROR] 复制转换结果失败: {e}")
            return False
    else:
        stderr = result.stderr[:200] if result.stderr else ''
        stdout = result.stdout[:200] if result.stdout else ''
        print(f"  [ERROR] Wine + iSilo 转换失败 (rc={result.returncode})")
        if stderr:
            print(f"    stderr: {stderr}")
        if stdout:
            print(f"    stdout: {stdout}")
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
    """扫描目录下的所有 PDB 文件（含 .pdb.zip）。"""
    if not input_dir.exists():
        print(f"目录不存在: {input_dir}")
        return []
    pdb_files = sorted(input_dir.rglob('*.pdb'))
    zip_files = sorted(input_dir.rglob('*.pdb.zip'))
    # 合并去重（排除已解压的 zip：如果 foo.pdb 和 foo.pdb.zip 同时存在，只保留 foo.pdb）
    pdb_stems = {f.with_suffix('') for f in pdb_files}  # foo.pdb → foo
    for zf in zip_files:
        # foo.pdb.zip → stem 是 foo.pdb → 再 .with_suffix('') → foo
        pdb_stem = zf.with_suffix('').with_suffix('')
        if pdb_stem not in pdb_stems:
            pdb_files.append(zf)
    return sorted(pdb_files)


def main() -> None:
    parser = ArgumentParser(description="PDB (PalmDOC/iSilo) → TXT 转换工具")
    parser.add_argument('--input-dir', default='resource/pdb',
                        help='PDB 文件输入目录 (默认: resource/pdb)')
    parser.add_argument('--output-dir', default='resource/历史合辑',
                        help='TXT 文件输出目录 (默认: resource/历史合辑)')
    parser.add_argument('--isilo-exe', default='',
                        help='iSilo.exe 路径 (Windows 原生转换, 留空自动搜索)')
    parser.add_argument('--wine-isilo', action='store_true',
                        help='使用 Wine + iSilo 转换 (Linux, 需要预装)')
    parser.add_argument('--dry-run', action='store_true',
                        help='只扫描不转换')
    parser.add_argument('--overwrite', action='store_true',
                        help='覆盖已存在的 TXT 文件')
    args = parser.parse_args()

    input_dir = Path(args.input_dir)
    output_dir = Path(args.output_dir)

    # 解析 iSilo 路径: 显式指定 > 自动搜索 > 无
    isilo_exe = args.isilo_exe
    if not isilo_exe and not args.wine_isilo:
        # 自动搜索 (Windows 优先, Linux 搜索 Wine 路径)
        isilo_exe = find_isilo_exe()

    # 确定转换模式
    if isilo_exe:
        mode_desc = f'iSilo 原生 ({isilo_exe})'
    elif args.wine_isilo:
        mode_desc = 'Wine + iSilo'
    else:
        mode_desc = '仅 PalmDOC/iSilo2 (iSilo3 需要 iSilo)'

    print('=' * 80)
    print('PDB → TXT 转换工具')
    print('=' * 80)
    print(f'输入目录: {input_dir}')
    print(f'输出目录: {output_dir}')
    print(f'转换模式: {mode_desc}')
    print('=' * 80)

    pdb_files = scan_pdb_files(input_dir)
    if not pdb_files:
        print(f"\n未找到 PDB 文件: {input_dir}")
        return

    print(f"\n找到 {len(pdb_files)} 个 PDB 文件:", flush=True)
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
        print(f"\n转换: {pdb_path.relative_to(input_dir)}", flush=True)

        # .pdb.zip → 先解压为 .pdb
        if str(pdb_path).lower().endswith('.pdb.zip'):
            unzipped = unzip_pdb_file(pdb_path)
            if not unzipped:
                print(f"  [FAIL] 解压失败，跳过")
                failed += 1
                continue
            pdb_path = unzipped
            print(f"  解压后: {pdb_path.relative_to(input_dir)}")

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

        if convert_pdb_file(pdb_path, output_path, args.wine_isilo, isilo_exe):
            success += 1
        else:
            failed += 1

    print('\n' + '=' * 80)
    print(f'转换完成: 成功 {success}, 跳过 {skipped}, 失败 {failed}')
    print('=' * 80)

    # 如果全部失败且有 iSilo3 文件，给出安装指引
    if failed > 0 and not isilo_exe and not args.wine_isilo:
        is_win = platform.system() == 'Windows'
        print(f"\n💡 iSilo3 格式需要 iSilo 工具转换:")
        if is_win:
            print(f"   1. 下载 iSilo for Windows: https://www.isilox.com/download/")
            print(f"   2. 安装后运行:")
            print(f'      python convert_pdb.py --isilo-exe "C:\\Program Files\\iSilo\\iSilo.exe"')
        else:
            print(f"   使用 --wine-isilo 参数启用 Wine + iSilo 转换 (需预装)")


if __name__ == '__main__':
    main()
