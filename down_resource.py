#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""简化版 Notion 训练资源下载器，可选通过 Playwright 获取 token_v2。"""

import hashlib
import os
import re
import shutil
import sys
import time
import zipfile
from argparse import ArgumentParser
from json import dumps
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import quote, urlparse

import requests

NOTION_CHUNK_URL = "https://www.notion.so/api/v3/loadPageChunk"
NOTION_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Content-Type': 'application/json',
    'Notion-Version': '2022-06-28'
}
SIGNED_URL_ENDPOINT = "https://www.notion.so/api/v3/getSignedUrls"
DOWNLOAD_HEADERS = {
    'Content-Type': 'application/json',
    'Notion-Version': '2022-06-28'
}
BASE_URL = "https://mygoodland.notion.site/b1935b21f2874bc4a928cae9385f717d"
TARGET_EXTENSIONS = ('.doc', '.docx')
PDB_EXTENSIONS = ('.pdb', '.pdb.zip')
ZIP_EXTENSIONS = ('.zip',)
EPUB_EXTENSIONS = ('.epub',)
# 需要从 zip 内提取的目标扩展名
ZIP_TARGET_EXTENSIONS = TARGET_EXTENSIONS + PDB_EXTENSIONS + EPUB_EXTENSIONS + ('.txt',)
ALL_EXTENSIONS = TARGET_EXTENSIONS + PDB_EXTENSIONS + ZIP_EXTENSIONS + EPUB_EXTENSIONS
MIN_TRAINING_YEAR = 2025
MIN_TRAINING_MONTH = 4
NOTION_TOKEN = os.getenv('NOTION_TOKEN', 'v03%3AeyJhbGciOiJkaXIiLCJraWQiOiJwcm9kdWN0aW9uOnRva2VuLXYzOjIwMjQtMTEtMDciLCJlbmMiOiJBMjU2Q0JDLUhTNTEyIn0..ST-Isd0_hRgIVz7FFliobA.gJdJhpEgvTHQWQlAsMENC6E1LAB46Y94LlziqE6Z6II-KTUv8X2ywrq_7hioHPSXzDFLGje9Uggd3jl5MfOUho8C8O8IiscKqogJJZQICwypZXQs3Yuev7J_5ta95u43Plfqsnp6NNaNKh2UeFNsO32ep3mCSOglmnSMb94yRaI6xhTnyRZq9V7RTPGrVaPNbpaIr3fRJtH3NQ5eFTyDgrg7hTBX6Lpcn5hv3R7ECan8SSn1ZSHRFoXNpxYNXKx56RWF-BxdpwAz0bITzdCBJJXn54AmbaQqP_YJh1i7sPFJIcGX_9Hq_cRDR74fbjKh3GKHO14ZpOQVE41WpwMMVhMt-HDvwJUwRadBYRTHdTE.4GPzA8xpek2Et5k0lTbQyFJdszLayX0L5pVKDlsRzVw')
SIGNED_URL_CACHE: Dict[str, str] = {}

try:
    from playwright.sync_api import Error, sync_playwright
    PLAYWRIGHT_AVAILABLE = True
except ImportError:  # pragma: no cover
    PLAYWRIGHT_AVAILABLE = False
    sync_playwright = None  # type: ignore
    Error = RuntimeError


def create_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(NOTION_HEADERS)
    if NOTION_TOKEN:
        session.cookies.set('token_v2', NOTION_TOKEN, domain='.notion.so')
        session.cookies.set('token_v2', NOTION_TOKEN, domain='mygoodland.notion.site')
    return session


def extract_page_id(url: str) -> Optional[str]:
    parsed = urlparse(url)
    path = parsed.path.strip('/')
    if not path:
        return None

    candidate = path.split('-')[-1].split('?')[0].split('#')[0].lower()
    if len(candidate) == 32:
        return f"{candidate[0:8]}-{candidate[8:12]}-{candidate[12:16]}-{candidate[16:20]}-{candidate[20:32]}"
    if re.match(r'^[0-9a-f-]{36}$', candidate):
        return candidate
    return None


def load_page_blocks(session: requests.Session, page_id: str) -> Dict[str, Any]:
    """加载页面的所有 blocks（支持分页，不限数量）。"""
    result: Dict[str, Any] = {}
    cursor: Dict[str, Any] = {"stack": []}
    chunk_num = 0
    while True:
        payload = {
            "pageId": page_id,
            "chunkNumber": chunk_num,
            "limit": 100,
            "cursor": cursor,
            "verticalColumns": False
        }
        response = session.post(NOTION_CHUNK_URL, json=payload, timeout=30)
        response.raise_for_status()
        data = response.json()
        raw_blocks = data.get('recordMap', {}).get('block', {})
        # API wraps block data as {spaceId: ..., value: {value: {actual_data}}}
        # Normalize to the expected {value: {actual_data}} flat structure
        for bid, b in raw_blocks.items():
            inner = b.get('value', {})
            if isinstance(inner, dict) and 'value' in inner:
                result[bid] = {'value': inner['value']}
            else:
                result[bid] = b
        # Check if there are more chunks
        cursor = data.get('cursor', {})
        if not cursor or not cursor.get('stack'):
            break
        chunk_num += 1
        if chunk_num > 50:  # Safety limit
            break
    return result


def get_children(blocks: Dict[str, Any], block_id: str) -> Iterable[str]:
    return blocks.get(block_id, {}).get('value', {}).get('content') or []


def get_block_title(block: Dict[str, Any]) -> str:
    value = block.get('value', {})
    title_props = value.get('properties', {}).get('title') or []
    return ''.join(part[0] for part in title_props if part and part[0])


def training_in_range(title: str) -> bool:
    match = re.search(r"(\d{4})-(\d{2})", title)
    if not match:
        return False
    year = int(match.group(1))
    month = int(match.group(2))
    return year > MIN_TRAINING_YEAR or (year == MIN_TRAINING_YEAR and month >= MIN_TRAINING_MONTH)


def find_year_links(session: requests.Session, page_id: str) -> List[Dict[str, str]]:
    blocks = load_page_blocks(session, page_id)
    year_links = []
    for child_id in get_children(blocks, page_id):
        block = blocks.get(child_id)
        if not block or block.get('value', {}).get('type') != 'page':
            continue
        title = get_block_title(block)
        if re.search(r'\d{4}年?$', title):
            year_links.append({'id': child_id, 'title': title})
    return year_links


def find_training_links_in_year(session: requests.Session, year_info: Dict[str, str], include_all: bool = False) -> List[Dict[str, str]]:
    blocks = load_page_blocks(session, year_info['id'])
    trainings = []
    for child_id in get_children(blocks, year_info['id']):
        block = blocks.get(child_id)
        if not block or block.get('value', {}).get('type') != 'page':
            continue
        title = get_block_title(block)
        if include_all or training_in_range(title):
            trainings.append({'id': child_id, 'title': title})
    return trainings


def find_resource_pages(session: requests.Session, training: Dict[str, str]) -> List[Dict[str, str]]:
    blocks = load_page_blocks(session, training['id'])
    resource_pages = []
    for child_id in get_children(blocks, training['id']):
        block = blocks.get(child_id)
        if not block or block.get('value', {}).get('type') != 'page':
            continue
        title = get_block_title(block)
        if '资源' in title:
            resource_pages.append({'id': child_id, 'title': title})
    return resource_pages


def find_all_child_pages(session: requests.Session, parent_id: str) -> List[Dict[str, str]]:
    """查找父页面下的所有子页面（不限标题）。"""
    blocks = load_page_blocks(session, parent_id)
    pages = []
    for child_id in get_children(blocks, parent_id):
        block = blocks.get(child_id)
        if not block or block.get('value', {}).get('type') != 'page':
            continue
        title = get_block_title(block)
        pages.append({'id': child_id, 'title': title or '(untitled)'})
    return pages


def scan_page_for_pdb(session: requests.Session, page: Dict[str, str]) -> List[Dict[str, Any]]:
    """扫描页面中的 PDB 文件（含递归遍历容器）。"""
    blocks = load_page_blocks(session, page['id'])
    documents = {'pdb': []}

    # 扫描当前页面的 file blocks
    for child_id in get_children(blocks, page['id']):
        block = blocks.get(child_id)
        if not block:
            continue
        value = block.get('value', {})
        block_type = value.get('type')
        if block_type == 'file':
            collect_file(block, documents, 'pdb')
        elif block_type in ('bulleted_list', 'numbered_list', 'toggle', 'toggle_heading'):
            # 递归遍历容器
            _scan_container_for_pdb(blocks, value, documents, depth=0)

    return documents.get('pdb', [])


def _scan_container_for_pdb(blocks, value, documents, depth=0):
    """递归扫描容器中的 PDB 文件。"""
    if depth > 10:
        return
    for item_id in value.get('content', []):
        child_block = blocks.get(item_id)
        if not child_block:
            continue
        child_val = child_block.get('value', {})
        child_type = child_val.get('type')
        if child_type == 'file':
            collect_file(child_block, documents, 'pdb')
        elif child_type in ('bulleted_list', 'numbered_list', 'toggle', 'toggle_heading'):
            _scan_container_for_pdb(blocks, child_val, documents, depth + 1)


def find_motto_pages(session: requests.Session, training: Dict[str, str]) -> Optional[Dict[str, str]]:
    """查找训练下的标语页面"""
    blocks = load_page_blocks(session, training['id'])
    for child_id in get_children(blocks, training['id']):
        block = blocks.get(child_id)
        if not block or block.get('value', {}).get('type') != 'page':
            continue
        title = get_block_title(block)
        if '标语' in title:
            return {'id': child_id, 'title': title}
    return None


def process_resource_page(session: requests.Session, resource: Dict[str, str]) -> Dict[str, List[Dict[str, Any]]]:
    blocks = load_page_blocks(session, resource['id'])
    documents = {'经文': [], '听抄': [], '晨兴': [], 'pdb': [], 'zip': [], 'epub': []}
    current_section = '经文'

    # 所有已知的 heading 类型（h1-h6 的各种命名）
    # Notion API: header(h1), sub_header(h2), sub_sub_header(h3) — legacy
    # Notion API: header_1~header_6 — newer pages
    # Notion DOM: notion-header_4-block → API type "header_4" (renders as h5)
    HEADING_TYPES = {
        'header', 'sub_header', 'sub_sub_header',
        'sub_sub_sub_header',  # h4 (legacy)
        'header_1', 'header_2', 'header_3',
        'header_4', 'header_5', 'header_6',
    }

    # 可能包裹文件的容器类型
    CONTAINER_TYPES = {'bulleted_list', 'numbered_list', 'toggle', 'toggle_heading'}

    def _collect_from_block(block, section, depth=0):
        """递归遍历 block 及其嵌套容器，收集文件。"""
        if not block or depth > 10:
            return
        val = block.get('value', {})
        btype = val.get('type')
        if btype == 'file':
            collect_file(block, documents, section)
        elif btype in CONTAINER_TYPES:
            container_title = get_block_title(block)
            container_section = classify_document_type(container_title) if container_title else section
            if container_title and depth < 2:
                print(f"    [DEBUG] {'  ' * depth}容器: {container_title}, classified={container_section}")
            for child_id in val.get('content', []):
                child_block = blocks.get(child_id)
                if child_block:
                    _collect_from_block(child_block, container_section, depth + 1)

    for child_id in get_children(blocks, resource['id']):
        block = blocks.get(child_id)
        if not block:
            continue
        value = block.get('value', {})
        block_type = value.get('type')

        # 调试：打印每个 block 的类型和标题
        block_title = get_block_title(block)
        if block_type != 'text':
            print(f"    [DEBUG] block type={block_type}, title={block_title[:60] if block_title else '(empty)'}")

        if block_type in HEADING_TYPES:
            section_title = get_block_title(block)
            new_section = classify_document_type(section_title)
            if new_section != '经文' or any(kw in section_title for kw in ['经文', 'verses', '纲目附']):
                current_section = new_section
                print(f"    [DEBUG] 切换分区: {section_title} -> {current_section}")
            continue

        if block_type in CONTAINER_TYPES:
            _collect_from_block(block, current_section)
            continue

        if block_type == 'file':
            collect_file(block, documents, current_section)

    # 听抄：多文件时优先保留含 "transcript" 的文件，找不到则保留全部
    tingchao = documents['听抄']
    if len(tingchao) > 1:
        transcript_files = [d for d in tingchao if 'transcript' in d['filename'].lower()]
        if transcript_files:
            documents['听抄'] = transcript_files

    # 打印汇总
    for doc_type, doc_list in documents.items():
        if doc_list:
            print(f"    [{doc_type}] 找到 {len(doc_list)} 个文件: {[d['filename'] for d in doc_list]}")
        else:
            print(f"    [{doc_type}] 未找到文件")

    return documents


def collect_file(block: Dict[str, Any], documents: Dict[str, List[Dict[str, Any]]], section_type: str) -> None:
    value = block.get('value', {})
    filename = extract_filename(value)
    if not filename:
        return
    lower_name = filename.lower()
    is_pdb = lower_name.endswith('.pdb') or lower_name.endswith('.pdb.zip')
    is_zip = lower_name.endswith('.zip') and not is_pdb  # 排除 .pdb.zip
    is_epub = lower_name.endswith('.epub')
    is_word = lower_name.endswith(TARGET_EXTENSIONS)
    if not is_pdb and not is_word and not is_zip and not is_epub:
        return
    # PDB 文件: 只检查简体中文，不检查 with verses
    if is_pdb:
        if not is_simplified_chinese(filename):
            return
        doc_type = 'pdb'
    elif is_epub:
        if not is_simplified_chinese(filename):
            return
        doc_type = 'epub'
    elif is_zip:
        # 通用 ZIP：统一标记为 zip，下载后扫描内容再分类
        if not is_simplified_chinese(filename):
            return
        doc_type = 'zip'
    else:
        if not is_simplified_chinese(filename) or (section_type == '经文' and not is_with_verses_s(filename)):
            return
        doc_type = section_type if section_type in documents else '经文'
    # 新类型可能不在 documents 中，初始化
    if doc_type not in documents:
        documents[doc_type] = []
    file_id = get_file_id(value)
    if not file_id:
        return
    documents[doc_type].append({
        'filename': filename,
        'title': filename,
        'file_id': file_id,
        'block_id': value.get('id'),
        'url': build_attachment_url(file_id, value.get('id'), filename)
    })


def classify_document_type(title: str, *, strict: bool = False) -> Optional[str]:
    """根据标题/文件名关键字判断文档类型。
    
    Args:
        title: 标题或文件名
        strict: 严格模式——无法识别时返回 None 而非默认'经文'。
                用于 ZIP 解压场景（无上下文，无法识别则丢弃）。
    
    Returns:
        '经文' / '听抄' / '晨兴'，strict=True 时可能返回 None
    """
    lower = title.lower()
    if '听抄' in title or 'transcript' in lower:
        return '听抄'
    if '晨兴' in title or 'hwmr' in lower or 'morning' in lower:
        return '晨兴'
    # 经文需显式关键字匹配（中英文均可）
    if '经文' in title or 'verses' in lower or 'with verses' in lower or '纲目附' in title:
        return '经文'
    if strict:
        return None
    return '经文'


def extract_filename(value: Dict[str, Any]) -> Optional[str]:
    title_props = value.get('properties', {}).get('title') or []
    title = ''.join(part[0] for part in title_props if part and part[0])
    if title:
        return title
    source_props = value.get('properties', {}).get('source', [])
    for entry in source_props:
        if entry and entry[0]:
            parts = entry[0].split(':')
            if len(parts) >= 3:
                return parts[-1]
    return value.get('id')


def get_file_id(value: Dict[str, Any]) -> Optional[str]:
    file_ids = value.get('file_ids') or []
    if file_ids:
        return file_ids[0]
    source_props = value.get('properties', {}).get('source', [])
    for entry in source_props:
        if entry and entry[0].startswith('attachment:'):
            return entry[0].split(':')[1]
    return None


def build_attachment_url(file_id: str, block_id: str, filename: str) -> str:
    safe_filename = quote(filename)
    return f"https://www.notion.so/attachment/{file_id}/{safe_filename}?table=block&id={block_id}&cache=v2"


def is_simplified_chinese(filename: str) -> bool:
    lower = filename.lower()
    # PDB 文件（含 .pdb.zip）不检查 -s 后缀
    if lower.endswith('.pdb') or lower.endswith('.pdb.zip'):
        if '-t.' in lower or '-e.' in lower:
            return False
        return True
    # ZIP/EPUB 文件：不检查 -s 后缀（zip 内容由预检查筛选）
    if lower.endswith('.zip') or lower.endswith('.epub'):
        if '-t.' in lower or '-e.' in lower:
            return False
        return True
    if lower.endswith('-s.doc') or lower.endswith('-s.docx'):
        return True
    if '-t.' in lower or '-e.' in lower:
        return False
    return True


def is_with_verses_s(filename: str) -> bool:
    return 'with verses-s' in filename.lower()


def calculate_file_md5(file_path: Path) -> Optional[str]:
    """计算文件的MD5值"""
    if not file_path.exists() or not file_path.is_file():
        return None
    try:
        md5_hash = hashlib.md5()
        with open(file_path, 'rb') as f:
            for chunk in iter(lambda: f.read(4096), b''):
                md5_hash.update(chunk)
        return md5_hash.hexdigest()
    except Exception as e:
        print(f"  计算MD5失败 {file_path}: {e}")
        return None


def decode_zip_filename(info) -> str:
    """解码 zip 成员文件名：UTF-8 优先 → GBK → 保留原始 CP437。
    
    Windows 压缩工具常用 GBK 编码文件名，标准 zip 用 UTF-8 (flag_bits 0x800)。
    """
    name = info.filename
    if info.flag_bits & 0x800:
        # 有 UTF-8 标记，文件名已是正确编码
        return name
    # 无 UTF-8 标记：先尝试 UTF-8，再 GBK
    try:
        name = info.filename.encode('cp437').decode('utf-8')
    except (UnicodeDecodeError, UnicodeEncodeError):
        try:
            name = info.filename.encode('cp437').decode('gbk')
        except (UnicodeDecodeError, UnicodeEncodeError):
            pass
    return name


# macOS 元数据文件过滤规则：跳过 ._ 前缀（AppleDouble）和 __MACOSX 目录
_MACOS_PREFIX = '._'
_MACOSX_DIR = '__MACOSX/'

# 需要类型识别的扩展名（Word 重命名，EPUB 保留原名但需识别）
_RENAMEABLE_EXTENSIONS = ('.doc', '.docx', '.epub')


def _is_macos_junk(name: str) -> bool:
    """判断是否为 macOS 元数据垃圾文件（AppleDouble / __MACOSX）"""
    base = Path(name).name
    return base.startswith(_MACOS_PREFIX) or name.startswith(_MACOSX_DIR) or '/' + _MACOSX_DIR in name


def inspect_zip_contents(zip_path: Path) -> List[Dict[str, Any]]:
    """检查 zip 文件内部资源列表，返回包含目标资源的成员信息。
    
    只返回 ZIP_TARGET_EXTENSIONS 中匹配的文件，跳过目录、macOS 元数据文件和无关文件。
    Word/EPUB 文件还需通过 classify_document_type(strict=True) 类型识别才算目标资源。
    每个成员信息包含: name(解码后文件名), size(压缩后大小), is_target(是否为目标资源)。
    """
    if not zip_path.exists():
        return []
    try:
        with zipfile.ZipFile(zip_path, 'r') as zf:
            results = []
            for info in zf.infolist():
                if info.is_dir():
                    continue
                name = decode_zip_filename(info)
                # 跳过 macOS 元数据垃圾文件
                if _is_macos_junk(name):
                    continue
                lower_name = name.lower()
                is_target = any(lower_name.endswith(ext) for ext in ZIP_TARGET_EXTENSIONS)
                
                # Word/EPUB 需通过类型识别才算目标资源
                base_name = Path(name).name
                is_renameable = any(lower_name.endswith(ext) for ext in _RENAMEABLE_EXTENSIONS)
                if is_renameable and is_target:
                    doc_type = classify_document_type(base_name, strict=True)
                    if not doc_type:
                        is_target = False  # 无法识别类型，不算目标资源
                
                results.append({
                    'name': name,
                    'size': info.file_size,
                    'compressed_size': info.compress_size,
                    'is_target': is_target,
                    'info': info,
                })
            return results
    except zipfile.BadZipFile:
        print(f"  [ERROR] 无效的 zip 文件: {zip_path.name}")
        return []
    except Exception as e:
        print(f"  [ERROR] 检查 zip 内容失败: {zip_path.name}: {e}")
        return []




def process_downloaded_file(file_path: Path, doc_type: str) -> List[Path]:
    """下载后处理文件：根据文件类型决定是否需要检查/解压。
    
    - .zip（含 .pdb.zip）: 检查 zip 内容，只解压需要的资源
      - zip 内的 .pdb/.pdb.zip → resource/pdb/{training}/
      - zip 内的 .epub/.doc/.docx/.txt → resource/{training}/
    - .epub: 直接保留（EPUB 本身就是 zip 格式，由构建流程处理）
    - 其他: 不需要处理
    
    Returns:
        处理后的文件路径列表
    """
    lower_name = file_path.name.lower()
    
    # EPUB 文件：直接保留，不做解压
    if lower_name.endswith('.epub'):
        size_kb = file_path.stat().st_size / 1024
        print(f"  [OK] EPUB 保留: {file_path.name} ({size_kb:.1f} KB)")
        return [file_path]
    
    # ZIP 文件（含 .pdb.zip）：检查内容后选择性解压
    if lower_name.endswith('.zip'):
        # 先检查 zip 内有哪些目标资源
        contents = inspect_zip_contents(file_path)
        target_files = [c for c in contents if c['is_target']]
        if not target_files:
            print(f"  [WARN] zip 内无目标资源，跳过: {file_path.name}")
            file_path.unlink()
            return []
        
        print(f"  zip 预检查: {len(target_files)} 个目标资源 / {len(contents)} 个总文件")
        for f in target_files:
            print(f"    - {f['name']} ({f['size'] / 1024:.1f} KB)")
        
        # 按内容分类解压
        return smart_unzip_by_content(file_path)
    
    # 其他文件（Word/PDB 等）：不做额外处理
    return [file_path]


def _extract_entry(zf: zipfile.ZipFile, info, target_path: Path) -> bool:
    """解压单个 ZIP 条目到目标路径，含 MD5 增量检查。
    
    Returns:
        True 成功，False 跳过（内容相同）。
    """
    target_path.parent.mkdir(parents=True, exist_ok=True)
    
    if target_path.exists() and target_path.stat().st_size > 0:
        existing_md5 = calculate_file_md5(target_path)
        tmp_path = target_path.with_suffix(target_path.suffix + '.tmp')
        with zf.open(info) as src, open(tmp_path, 'wb') as dst:
            dst.write(src.read())
        new_md5 = calculate_file_md5(tmp_path)
        if existing_md5 == new_md5:
            tmp_path.unlink()
            return False  # 内容相同
        else:
            shutil.move(str(tmp_path), str(target_path))
            return True
    else:
        with zf.open(info) as src, open(target_path, 'wb') as dst:
            dst.write(src.read())
        return True


def smart_unzip_by_content(zip_path: Path) -> List[Path]:
    """智能解压 zip：按内容类型分类输出目录，可识别的文件按类型重命名。
    
    - .pdb / .pdb.zip → resource/pdb/{training}/
    - .epub → 保留原始文件名（需通过类型识别，否则丢弃）
    - .doc / .docx → 按类型重命名（经文.docx / 听抄.doc / 晨兴.doc / 晨兴2.doc...）
    - .txt → 保留原始文件名
    - 无法识别类型的 Word/EPUB 文件直接丢弃
    """
    if not zip_path.exists():
        return []
    
    training_folder = zip_path.parent.name
    extracted: List[Path] = []
    
    try:
        with zipfile.ZipFile(zip_path, 'r') as zf:
            type_counter: Dict[str, int] = {}  # 各类型计数，用于多文件编号
            
            for info in zf.infolist():
                if info.is_dir():
                    continue
                name = decode_zip_filename(info)
                if _is_macos_junk(name):
                    continue
                lower_name = name.lower()
                
                # 跳过非目标文件
                is_target = any(lower_name.endswith(ext) for ext in ZIP_TARGET_EXTENSIONS)
                if not is_target:
                    continue
                
                base_name = Path(name).name
                is_word = any(lower_name.endswith(ext) for ext in ('.doc', '.docx'))
                is_epub = lower_name.endswith('.epub')
                is_pdb = lower_name.endswith('.pdb') or lower_name.endswith('.pdb.zip')
                
                # PDB / TXT：保留原名，按类型决定输出目录
                if is_pdb:
                    out_dir = Path('resource') / 'pdb' / training_folder
                    out_dir.mkdir(parents=True, exist_ok=True)
                    target_path = out_dir / base_name
                    if _extract_entry(zf, info, target_path):
                        size_kb = target_path.stat().st_size / 1024
                        print(f"  [OK] 已解压: {out_dir.name}/{base_name} ({size_kb:.1f} KB)")
                    else:
                        print(f"  [OK] 已存在且相同，跳过: {base_name}")
                    extracted.append(target_path)
                    continue
                
                if lower_name.endswith('.txt'):
                    out_dir = zip_path.parent
                    target_path = out_dir / base_name
                    if _extract_entry(zf, info, target_path):
                        size_kb = target_path.stat().st_size / 1024
                        print(f"  [OK] 已解压: {out_dir.name}/{base_name} ({size_kb:.1f} KB)")
                    else:
                        print(f"  [OK] 已存在且相同，跳过: {base_name}")
                    extracted.append(target_path)
                    continue
                
                # Word / EPUB：用 classify_document_type(strict=True) 识别类型
                # 无法识别的文件直接丢弃
                doc_type = classify_document_type(base_name, strict=True)
                if not doc_type:
                    print(f"  [SKIP] 无法识别类型，跳过: {base_name}")
                    continue
                
                out_dir = zip_path.parent
                out_dir.mkdir(parents=True, exist_ok=True)
                
                if is_word:
                    # Word 文件：按类型重命名
                    count = type_counter.get(doc_type, 0)
                    type_counter[doc_type] = count + 1
                    ext = '.docx' if lower_name.endswith('.docx') else '.doc'
                    renamed = f"{doc_type}{ext}" if count == 0 else f"{doc_type}{count + 1}{ext}"
                    target_path = out_dir / renamed
                    if _extract_entry(zf, info, target_path):
                        size_kb = target_path.stat().st_size / 1024
                        label = f"{renamed} (原: {base_name})" if renamed != base_name else renamed
                        print(f"  [OK] 已解压: {out_dir.name}/{label} ({size_kb:.1f} KB)")
                    else:
                        print(f"  [OK] 已存在且相同，跳过: {renamed}")
                    extracted.append(target_path)
                
                elif is_epub:
                    # EPUB 文件：保留原名，已通过类型识别
                    target_path = out_dir / base_name
                    if _extract_entry(zf, info, target_path):
                        size_kb = target_path.stat().st_size / 1024
                        print(f"  [OK] 已解压: {out_dir.name}/{base_name} ({size_kb:.1f} KB)")
                    else:
                        print(f"  [OK] 已存在且相同，跳过: {base_name}")
                    extracted.append(target_path)
        
        # 删除 zip
        zip_path.unlink()
    except zipfile.BadZipFile:
        print(f"  [ERROR] 无效的 zip 文件: {zip_path.name}")
    except Exception as e:
        print(f"  [ERROR] 解压 zip 失败: {zip_path.name}: {e}")
    
    return extracted


def get_signed_download_url(session: requests.Session, file_id: str) -> Optional[str]:
    if not file_id:
        return None
    if file_id in SIGNED_URL_CACHE:
        return SIGNED_URL_CACHE[file_id]
    payload = {'files': [{'id': file_id, 'table': 'block'}]}
    response = session.post(SIGNED_URL_ENDPOINT, json=payload, timeout=15)
    if response.status_code != 200:
        return None
    results = response.json().get('results', [])
    if not results:
        return None
    signed_url = results[0].get('signedUrl')
    if signed_url:
        SIGNED_URL_CACHE[file_id] = signed_url
    return signed_url


def download_documents(session: requests.Session, documents: Dict[str, List[Dict[str, Any]]], folder_name: str, training_id: str, resource_id: str) -> List[Dict[str, Any]]:
    """Collect all documents for Playwright download (skip requests to avoid 404)."""
    all_docs: List[Dict[str, Any]] = []
    
    for doc_type, doc_list in documents.items():
        if not doc_list:
            continue
        for idx, doc in enumerate(doc_list, 1):
            lower_filename = doc['filename'].lower()
            if doc_type == 'pdb':
                # PDB 文件保持原始文件名，存放到 pdb/ 子目录
                new_name = doc['filename']
            elif doc_type in ('epub', 'zip'):
                # EPUB/ZIP 保持原始文件名，下载后按内容处理
                new_name = doc['filename']
            elif lower_filename.endswith('.zip') or lower_filename.endswith('.epub'):
                # zip/epub 格式保持原始文件名
                new_name = doc['filename']
            else:
                ext = '.docx' if lower_filename.endswith('.docx') else '.doc'
                if len(doc_list) == 1:
                    new_name = f"{doc_type}{ext}"
                else:
                    # 多文件命名: 晨兴.doc, 晨兴2.doc, 晨兴3.doc...
                    suffix = idx if idx == 1 else str(idx)
                    new_name = f"{doc_type}{suffix}{ext}" if idx > 1 else f"{doc_type}{ext}"
            
            all_docs.append({
                'file_id': doc['file_id'],
                'filename': new_name,
                'folder': folder_name,
                'doc_type': doc_type,
                'original_filename': doc['filename'],
                'training_id': training_id,
                'resource_id': resource_id,
                'block_id': doc.get('block_id')
            })
    
    # 统计各类型数量
    type_counts = {}
    for d in all_docs:
        t = d['doc_type']
        type_counts[t] = type_counts.get(t, 0) + 1
    parts = []
    type_labels = {
        '经文': '个经文文档', '听抄': '个听抄文档', '晨兴': '个晨兴文档',
        'pdb': '个PDB文件', 'epub': '个EPUB文件', 'zip': '个ZIP压缩包',
    }
    for t, count in type_counts.items():
        label = type_labels.get(t, f'个{t}')
        parts.append(f"{count} {label}")
    print(f"收集到 {', '.join(parts)}，将使用 Playwright 下载...")
    return all_docs


def download_motto_image(session: requests.Session, motto_page: Dict[str, str], folder_name: str) -> bool:
    """下载标语诗歌图片"""
    import urllib.parse
    
    blocks = load_page_blocks(session, motto_page['id'])
    images = []
    
    for child_id in get_children(blocks, motto_page['id']):
        block = blocks.get(child_id)
        if not block or block.get('value', {}).get('type') != 'image':
            continue
        
        value = block.get('value', {})
        properties = value.get('properties', {})
        source = properties.get('source', [['']])
        
        if not source or not source[0] or not source[0][0]:
            continue
        
        source_url = source[0][0]
        if not source_url.startswith('attachment:'):
            continue
        
        # 解析 attachment:file_id:filename
        parts = source_url.split(':', 2)
        if len(parts) < 3:
            continue
        
        file_id, filename = parts[1], parts[2]
        space_id = value.get('space_id', '')
        block_id = value.get('id', '')
        
        if not all([file_id, filename, space_id, block_id]):
            continue
        
        # 构造Notion重定向URL
        attachment_str = f"attachment:{file_id}:{filename}"
        encoded_attachment = urllib.parse.quote(attachment_str, safe='')
        redirect_url = f"https://www.notion.so/image/{encoded_attachment}?table=block&id={block_id}&spaceId={space_id}&width=2000&userId=&cache=v2"
        
        try:
            response = session.get(redirect_url, allow_redirects=True, timeout=30)
            if response.status_code == 200:
                images.append({
                    'data': response.content,
                    'size': len(response.content),
                    'ext': Path(filename).suffix or '.png'
                })
        except Exception:
            continue
    
    if not images:
        return False

    folder_path = Path('resource') / folder_name
    folder_path.mkdir(parents=True, exist_ok=True)

    # 保存所有图片：第1张命名为"标语诗歌.ext"，后续命名为"标语诗歌2.ext"、"标语诗歌3.ext"...
    for idx, img in enumerate(images):
        suffix = '' if idx == 0 else str(idx + 1)
        image_path = folder_path / f"标语诗歌{suffix}{img['ext']}"
        image_path.write_bytes(img['data'])
        size_kb = img['size'] / 1024
        print(f"  [OK] {folder_name}/标语诗歌{suffix}{img['ext']}: {size_kb:.2f} KB")
    return True


def download_notion_documents(base_url: str, only_images: bool = False, pdb_mode: bool = False) -> List[Dict[str, Any]]:
    page_id = extract_page_id(base_url)
    if not page_id:
        print("无法解析页面 ID")
        return []
    print(f"页面 ID: {page_id}")
    session = create_session()
    year_links = find_year_links(session, page_id)
    if not year_links:
        print("未找到任何年份页面，请检查 Notion 页面结构或认证 Token")
        return []
    print(f"找到 {len(year_links)} 个年份页面: {[y['title'] for y in year_links]}")
    all_trainings = []
    for year in year_links:
        # PDB 模式: 包含所有年份的训练
        trainings = find_training_links_in_year(session, year, include_all=pdb_mode)
        print(f"  {year['title']}: 找到 {len(trainings)} 个训练")
        for t in trainings:
            print(f"    - {t['title']}")
        all_trainings.extend(trainings)
    if not all_trainings:
        if pdb_mode:
            print("未找到任何训练")
        else:
            print(f"未找到符合范围的训练（>= {MIN_TRAINING_YEAR}-{MIN_TRAINING_MONTH:02d}）")
        return []
    print(f"\n共 {len(all_trainings)} 个训练待处理")
    all_docs: List[Dict[str, Any]] = []
    for training in all_trainings:
        folder_name = re.sub(r'[<>:\\"/|?*]', '_', training['title'])
        print(f"\n处理训练: {training['title']}")
        
        # 下载标语诗歌图片 (PDB 模式跳过)
        if not pdb_mode:
            motto_page = find_motto_pages(session, training)
            if motto_page:
                print(f"  找到标语页面: {motto_page['title']}")
                download_motto_image(session, motto_page, folder_name)
            else:
                print(f"  未找到标语页面")
        
        # 如果只下载图片，跳过文档
        if only_images:
            time.sleep(1)
            continue
        
        if pdb_mode:
            # PDB 模式: 只补充扫描正常模式未覆盖的老训练（< 2025-04）
            if training_in_range(training['title']):
                print(f"  跳过（已由正常模式覆盖）")
                time.sleep(0.5)
                continue
            resource_pages = find_resource_pages(session, training)
            if not resource_pages:
                print(f"  未找到资源页面")
                continue
            all_pdb: List[Dict[str, Any]] = []
            for resource in resource_pages:
                print(f"  扫描资源页面: {resource['title']}")
                page_pdb = scan_page_for_pdb(session, resource)
                if page_pdb:
                    print(f"    找到 {len(page_pdb)} 个PDB: {[d['filename'] for d in page_pdb]}")
                    all_pdb.extend(page_pdb)
            if all_pdb:
                all_docs.extend(download_documents(session, {'pdb': all_pdb}, folder_name, training['id'], training['id']))
            else:
                print(f"  未找到PDB文件")
        else:
            # 正常模式: 只处理资源页面
            resource_pages = find_resource_pages(session, training)
            if not resource_pages:
                print(f"  未找到资源页面")
                continue
            print(f"  找到 {len(resource_pages)} 个资源页面")
            
            for resource in resource_pages:
                aggregated: Dict[str, List[Dict[str, Any]]] = {'经文': [], '听抄': [], '晨兴': [], 'pdb': [], 'zip': [], 'epub': []}
                docs = process_resource_page(session, resource)
                for key, value in docs.items():
                    if key in aggregated:
                        aggregated[key].extend(value)
                if any(aggregated.values()):
                    all_docs.extend(download_documents(session, aggregated, folder_name, training['id'], resource['id']))
        time.sleep(1)
    return all_docs


def parse_playwright_downloads(values: Optional[Sequence[str]]) -> Sequence[Tuple[str, Optional[str]]]:
    if not values:
        return []
    parsed: List[Tuple[str, Optional[str]]] = []
    for entry in values:
        file_id, _, filename = entry.partition('=')
        parsed.append((file_id.strip(), filename.strip() or None))
    return parsed


def ensure_playwright_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


class NotionPlaywrightHelper:
    def __init__(self, url: str, headless: bool = True):
        self.url = url
        self.headless = headless

    def run(self, downloads: Sequence[Tuple[str, Optional[str]]], output_dir: Path) -> None:
        if not PLAYWRIGHT_AVAILABLE or sync_playwright is None:
            print("Playwright 未安装，先执行 `pip install playwright` 并运行 `playwright install chromium`. ")
            return
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=self.headless)
            context = browser.new_context()
            page = context.new_page()
            page.goto(self.url, wait_until='domcontentloaded')
            time.sleep(2)  # 等待页面加载完成
            
            if downloads:
                download_dir = ensure_playwright_dir(output_dir)
                download_using_playwright(context, downloads, download_dir)
            
            browser.close()


def download_using_playwright(context, downloads: Sequence[Tuple[str, Optional[str]]], output_dir: Path) -> None:
    for file_id, override in downloads:
        signed_url = fetch_signed_url_from_request(context.request, file_id)
        if not signed_url:
            continue
        save_file_from_request(context.request, signed_url, override, output_dir)


def fetch_signed_url_from_request(request, file_id: str) -> Optional[str]:
    body = {'files': [{'id': file_id, 'table': 'block'}]}
    try:
        response = request.post(SIGNED_URL_ENDPOINT, headers=DOWNLOAD_HEADERS, data=dumps(body))
    except Exception as exc:  # pragma: no cover
        print(f"签名请求失败：{exc}")
        return None
    if response.status != 200:
        text = getattr(response, 'text', '')
        print(f"签名 URL 请求失败 ({response.status})：{text}")
        return None
    results = response.json().get('results', [])
    if not results:
        print(f"签名结果为空：{file_id}")
        return None
    signed_url = results[0].get('signedUrl')
    if not signed_url:
        print(f"签名 URL 为空：{file_id}")
    return signed_url


def save_file_from_request(request, url: str, override_name: Optional[str], output_dir: Path) -> None:
    filename = override_name or Path(url).name
    target = output_dir / filename
    
    # 如果文件已存在,先计算MD5
    existing_md5 = None
    if target.exists() and target.stat().st_size > 0:
        existing_md5 = calculate_file_md5(target)
        print(f"文件已存在: {filename}, MD5: {existing_md5}")
    
    response = request.get(url)
    if response.status != 200:
        print(f"下载失败 ({response.status})：{url}")
        return
    
    # 计算新文件的MD5
    new_content = response.body()
    new_md5 = hashlib.md5(new_content).hexdigest()
    
    # 如果MD5相同,跳过
    if existing_md5 and existing_md5 == new_md5:
        print(f"[OK] MD5相同，跳过: {target}")
        return
    
    # MD5不同或文件不存在,写入新文件
    target.write_bytes(new_content)
    if existing_md5:
        print(f"Playwright 已更新（MD5不同）：{target}")
    else:
        print(f"Playwright 已下载：{target}")


def playwright_downloads(all_docs: List[Dict[str, Any]]) -> None:
    """Download all documents using Playwright (primary download method)."""
    if not all_docs:
        print("没有需要下载的文档。")
        return
    if not PLAYWRIGHT_AVAILABLE or sync_playwright is None:
        print("Playwright 未安装，无法下载（`pip install playwright && playwright install chromium`）。")
        return

    print(f"开始使用 Playwright 下载 {len(all_docs)} 个文档...")
    total_success = 0
    total_failed = 0
    
    # 按 resource_id 分组文档
    from collections import defaultdict
    docs_by_resource: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for doc in all_docs:
        docs_by_resource[doc['resource_id']].append(doc)
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(accept_downloads=True)
        
        # 注入 token_v2 认证 cookie — Notion 文件下载必须认证
        # 公开页面可浏览但附件 URL 返回 404，getSignedUrls 也需要登录态
        if NOTION_TOKEN:
            context.add_cookies([
                {'name': 'token_v2', 'value': NOTION_TOKEN, 'domain': '.notion.so', 'path': '/'},
            ])
        page = context.new_page()
        
        # 对每个 resource 分组下载
        for resource_id, docs in docs_by_resource.items():
            # 访问该资源页面（包含附件的页面）
            resource_url = f"https://mygoodland.notion.site/{resource_id.replace('-', '')}"
            print(f"\n访问资源页面: {resource_url}")
            try:
                page.goto(resource_url, wait_until='load', timeout=30000)
                # 等待页面内容加载完成
                page.wait_for_load_state('domcontentloaded')
                # 额外等待确保所有内容渲染
                time.sleep(5)
                print("页面加载完成，开始下载...")
            except Exception as e:
                print(f"访问页面失败: {e}")
                total_failed += len(docs)
                continue
            
            # 下载该资源页面下的所有文档
            for doc in docs:
                # 先下载到临时目录 tmp_downloads
                temp_download_dir = Path('tmp_downloads') / doc['folder']
                if not temp_download_dir.exists():
                    temp_download_dir.mkdir(parents=True, exist_ok=True)
                
                # 最终目标路径: PDB/ZIP 文件存放到对应子目录
                if doc['doc_type'] == 'pdb':
                    download_dir = Path('resource') / 'pdb' / doc['folder']
                else:
                    download_dir = Path('resource') / doc['folder']
                if not download_dir.exists():
                    download_dir.mkdir(parents=True, exist_ok=True)
                filename = doc['filename']
                original_filename = doc['original_filename']
                target_path = download_dir / filename
                temp_path = temp_download_dir / filename
                
                # 检查文件是否已存在
                if target_path.exists() and target_path.stat().st_size > 0:
                    print(f"  文件已存在: {filename}, 检查MD5...")
                    existing_md5 = calculate_file_md5(target_path)
                    try:
                        # 尝试下载到临时目录
                        selectors = [
                            f"a:text-is('{original_filename}')",
                            f"text={original_filename}",
                            f"a:has-text('{original_filename}')",
                        ]
                        
                        temp_downloaded = False
                        for selector in selectors:
                            try:
                                locator = page.locator(selector).first
                                if locator.count() == 0:
                                    continue
                                locator.scroll_into_view_if_needed()
                                time.sleep(0.5)
                                with page.expect_download(timeout=20000) as download_info:
                                    locator.click(timeout=5000, force=True)
                                
                                download = download_info.value
                                download.save_as(temp_path)
                                temp_downloaded = True
                                break
                            except Exception:
                                continue
                        
                        if temp_downloaded:
                            new_md5 = calculate_file_md5(temp_path)
                            if existing_md5 == new_md5:
                                print(f"  [OK] MD5相同，跳过: {filename}")
                                temp_path.unlink()  # 删除临时文件
                                total_success += 1
                                continue
                            else:
                                print(f"  MD5不同，从临时目录移动到resource: {filename}")
                                shutil.move(str(temp_path), str(target_path))
                                print(f"  [OK] 已更新：{target_path}")
                                # ZIP/EPUB 等文件下载后检查/解压
                                process_downloaded_file(target_path, doc['doc_type'])
                                total_success += 1
                                continue
                        else:
                            print(f"  临时下载失败，保留现有文件")
                            total_success += 1
                            continue
                    except Exception as e:
                        print(f"  MD5校验失败: {e}, 保留现有文件")
                        if temp_path.exists():
                            temp_path.unlink()
                        total_success += 1
                        continue
                
                try:
                    print(f"  准备下载: {original_filename}")
                    downloaded = False

                    # 策略1: 点击页面元素触发下载
                    # 先滚动到元素可见区域
                    selectors = [
                        f"a:text-is('{original_filename}')",
                        f"text={original_filename}",
                        f"a:has-text('{original_filename}')",
                    ]
                    for selector in selectors:
                        try:
                            locator = page.locator(selector).first
                            if locator.count() == 0:
                                continue
                            print(f"  找到元素（{selector[:50]}），滚动到可见并点击...")
                            locator.scroll_into_view_if_needed()
                            time.sleep(0.5)
                            with page.expect_download(timeout=20000) as download_info:
                                locator.click(timeout=5000, force=True)
                            dl = download_info.value
                            dl.save_as(temp_path)
                            shutil.move(str(temp_path), str(target_path))
                            print(f"  [OK] 点击下载成功：{target_path}")
                            # ZIP/EPUB 等文件下载后检查/解压
                            process_downloaded_file(target_path, doc['doc_type'])
                            total_success += 1
                            downloaded = True
                            break
                        except Exception as e:
                            print(f"  选择器 {selector[:30]}... 失败: {str(e)[:60]}")
                            continue

                    if not downloaded:
                        # 策略2: 通过 Notion 附件 URL 直接导航
                        attachment_url = (
                            f"https://www.notion.so/attachment/{doc['file_id']}/"
                            f"{quote(original_filename)}?table=block&id={doc.get('block_id', '')}&cache=v2"
                        )
                        print(f"  尝试附件URL导航下载...")
                        try:
                            resp = page.goto(attachment_url, wait_until='load', timeout=30000)
                            if resp and resp.status == 200:
                                # 如果返回了文件内容（非HTML页面），直接保存
                                content_type = resp.headers.get('content-type', '')
                                if 'html' not in content_type:
                                    body = resp.body()
                                    target_path.write_bytes(body)
                                    size_kb = len(body) / 1024
                                    print(f"  [OK] 附件URL响应成功: {target_path} ({size_kb:.1f} KB)")
                                    # ZIP/EPUB 等文件下载后检查/解压
                                    process_downloaded_file(target_path, doc['doc_type'])
                                    total_success += 1
                                    downloaded = True
                                else:
                                    print(f"  附件URL返回HTML页面 (非文件)")
                            elif resp:
                                print(f"  附件URL响应状态: {resp.status}")
                        except Exception as e:
                            print(f"  附件URL导航失败: {str(e)[:80]}")
                        finally:
                            # 回到资源页面
                            if downloaded:
                                try:
                                    page.goto(resource_url, wait_until='domcontentloaded')
                                    time.sleep(3)
                                except Exception:
                                    pass
                            else:
                                try:
                                    page.goto(resource_url, wait_until='domcontentloaded')
                                    time.sleep(2)
                                except Exception:
                                    pass

                    if not downloaded:
                        # 策略3: 签名 URL 兜底
                        print(f"  尝试签名URL...")
                        signed_url = fetch_signed_url_from_request(context.request, doc['file_id'])
                        if signed_url:
                            try:
                                response = context.request.get(signed_url)
                                if response.status == 200:
                                    new_content = response.body()
                                    target_path.write_bytes(new_content)
                                    size_kb = len(new_content) / 1024
                                    print(f"  [OK] 签名URL下载成功: {target_path} ({size_kb:.1f} KB)")
                                    # ZIP/EPUB 等文件下载后检查/解压
                                    process_downloaded_file(target_path, doc['doc_type'])
                                    total_success += 1
                                    downloaded = True
                                else:
                                    print(f"  签名URL下载失败 ({response.status})")
                            except Exception as e:
                                print(f"  签名URL下载异常: {e}")

                    if not downloaded:
                        # 策略4: 提取浏览器 Cookie，用 requests 直接下载
                        print(f"  尝试Cookie+requests下载...")
                        try:
                            cookies = context.cookies()
                            cookie_str = '; '.join(f"{c['name']}={c['value']}" for c in cookies)
                            dl_session = requests.Session()
                            dl_session.headers.update({
                                'Cookie': cookie_str,
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                            })
                            # 尝试附件 URL
                            resp = dl_session.get(attachment_url, allow_redirects=True, timeout=60)
                            if resp.status_code == 200 and len(resp.content) > 1024:
                                target_path.write_bytes(resp.content)
                                size_kb = len(resp.content) / 1024
                                print(f"  [OK] Cookie+requests下载成功: {target_path} ({size_kb:.1f} KB)")
                                # ZIP/EPUB 等文件下载后检查/解压
                                process_downloaded_file(target_path, doc['doc_type'])
                                total_success += 1
                                downloaded = True
                            else:
                                print(f"  Cookie+requests下载失败 (status={resp.status_code}, size={len(resp.content)})")
                        except Exception as e:
                            print(f"  Cookie+requests下载异常: {str(e)[:80]}")

                    if not downloaded:
                        print(f"  所有方法都失败，跳过")
                        total_failed += 1
                    
                except Exception as e:
                    print(f"  下载失败 {filename}: {e}")
                    total_failed += 1
                
                time.sleep(1)
        
        browser.close()
    
    # 清理临时下载目录
    tmp_dir = Path('tmp_downloads')
    if tmp_dir.exists():
        try:
            shutil.rmtree(tmp_dir)
            print(f"\n[OK] 已清理临时目录: {tmp_dir}")
        except Exception as e:
            print(f"\n⚠ 清理临时目录失败: {e}")
    
    print('=' * 80)
    print(f"Playwright 下载完成: 成功 {total_success}，失败 {total_failed}")
    print('=' * 80)


def main() -> None:
    parser = ArgumentParser(description="Notion 文档下载器（自动使用 Playwright 回退下载）")
    parser.add_argument('--url', default=BASE_URL, help='Notion 页面 URL')
    parser.add_argument('--only-images', action='store_true', help='只下载标语诗歌图片，跳过Word文档')
    parser.add_argument('--pdb', action='store_true', help='补充下载PDB文件（仅 < 2025-04 的老训练，正常模式已覆盖新训练）')
    parser.add_argument('--dry-run', action='store_true', help='只扫描 Notion 页面，不实际下载（用于调试）')
    args = parser.parse_args()
    print('=' * 80)
    print('Notion文档下载器启动')
    print('=' * 80)
    if args.pdb:
        print('目标: 补充下载老训练（< 2025-04）的 PDB 文件')
        print('保存位置: resource/pdb/{training}/')
    elif args.only_images:
        print('目标: 下载标语诗歌图片')
    else:
        print('目标: 下载训练资源（Word文档 + PDB + 标语诗歌图片）')
        print('类型: 经文、听抄、晨兴、PDB、标语诗歌')
    if args.dry_run:
        print('模式: DRY-RUN（只扫描，不下载）')
    print('=' * 80)
    start_time = time.time()
    all_docs: List[Dict[str, Any]] = []
    try:
        all_docs = download_notion_documents(args.url, args.only_images, args.pdb)
    except KeyboardInterrupt:
        print('\n\n用户中断下载')
    except Exception as error:
        print(f"\n\n程序异常: {error}")
        import traceback
        traceback.print_exc()
    else:
        elapsed = time.time() - start_time
        print('=' * 80)
        print(f"扫描完成, 耗时: {elapsed:.1f} 秒")
        print('=' * 80)
    
    if all_docs and not args.only_images:
        if args.dry_run:
            print(f"\n[DRY-RUN] 共找到 {len(all_docs)} 个待下载文档:")
            for doc in all_docs[:20]:
                print(f"  [{doc['doc_type']}] {doc['folder']}/{doc['filename']}")
            if len(all_docs) > 20:
                print(f"  ... 还有 {len(all_docs) - 20} 个")
        else:
            playwright_downloads(all_docs)


if __name__ == '__main__':
    try:
        main()
    except Error as error:
        print(f'Playwright 错误: {error}')
        sys.exit(1)
