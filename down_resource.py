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
ALL_EXTENSIONS = TARGET_EXTENSIONS + PDB_EXTENSIONS
MIN_TRAINING_YEAR = 2025
MIN_TRAINING_MONTH = 4
NOTION_TOKEN = os.getenv('NOTION_TOKEN')
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
    documents = {'经文': [], '听抄': [], '晨兴': [], 'pdb': []}
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
    is_word = lower_name.endswith(TARGET_EXTENSIONS)
    if not is_pdb and not is_word:
        return
    # PDB 文件: 只检查简体中文，不检查 with verses
    if is_pdb:
        if not is_simplified_chinese(filename):
            return
        doc_type = 'pdb'
    else:
        if not is_simplified_chinese(filename) or (section_type == '经文' and not is_with_verses_s(filename)):
            return
        doc_type = section_type if section_type in documents else '经文'
    # PDB 分类可能不在 documents 中，初始化
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


def classify_document_type(title: str) -> str:
    lower = title.lower()
    if '听抄' in title or 'transcript' in lower:
        return '听抄'
    if '晨兴' in title or 'hwmr' in lower or 'morning' in lower:
        return '晨兴'
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


def unzip_pdb(zip_path: Path) -> Optional[Path]:
    """解压 .pdb.zip 文件，返回解压后的 .pdb 文件路径。

    zip 内应恰好包含一个 .pdb 文件。解压成功后删除 zip 文件。
    支持 GBK 编码的中文文件名（Windows 压缩工具常见格式）。
    """
    if not zip_path.exists():
        return None
    pdb_name = None
    pdb_path = None
    try:
        zf = zipfile.ZipFile(zip_path, 'r')
        try:
            members = zf.infolist()
            # 找到 zip 中的 .pdb 文件
            pdb_member = None
            for info in members:
                # 修复 GBK 编码的文件名（Windows 压缩工具常见）
                name = info.filename
                if not (info.flag_bits & 0x800):
                    # 非 UTF-8 标记：尝试 CP437 → GBK 重解码
                    try:
                        name = info.filename.encode('cp437').decode('gbk')
                    except (UnicodeDecodeError, UnicodeEncodeError):
                        pass
                if name.lower().endswith('.pdb'):
                    pdb_member = info
                    pdb_member._decoded_name = name
                    break

            if pdb_member is None:
                print(f"  [WARN] zip 内未找到 .pdb 文件: {zip_path.name}")
                return None

            pdb_name = Path(pdb_member._decoded_name).name
            pdb_path = zip_path.parent / pdb_name

            # 如果 pdb 文件已存在且大小非零，比较 MD5
            if pdb_path.exists() and pdb_path.stat().st_size > 0:
                existing_md5 = calculate_file_md5(pdb_path)
                tmp_path = zip_path.parent / (pdb_name + '.tmp')
                with zf.open(pdb_member) as src, open(tmp_path, 'wb') as dst:
                    dst.write(src.read())
                new_md5 = calculate_file_md5(tmp_path)
                tmp_path.unlink()
                if existing_md5 == new_md5:
                    print(f"  [OK] PDB 已存在且 MD5 相同，跳过解压: {pdb_name}")
                    zf.close()
                    zip_path.unlink()
                    return pdb_path

            # 解压
            with zf.open(pdb_member) as src, open(pdb_path, 'wb') as dst:
                dst.write(src.read())
            size_kb = pdb_path.stat().st_size / 1024
            print(f"  [OK] 已解压: {pdb_name} ({size_kb:.1f} KB)")
        finally:
            zf.close()

        # ZipFile 关闭后再删除 zip 文件（避免 Windows 文件锁）
        zip_path.unlink()
        return pdb_path
    except zipfile.BadZipFile:
        print(f"  [ERROR] 无效的 zip 文件: {zip_path.name}")
        return None
    except Exception as e:
        print(f"  [ERROR] 解压 zip 失败: {zip_path.name}: {e}")
        return None


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
            if doc_type == 'pdb':
                # PDB 文件保持原始文件名，存放到 pdb/ 子目录
                new_name = doc['filename']
            else:
                ext = '.docx' if doc['filename'].lower().endswith('.docx') else '.doc'
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
    
    pdb_count = sum(1 for d in all_docs if d['doc_type'] == 'pdb')
    word_count = len(all_docs) - pdb_count
    parts = []
    if word_count:
        parts.append(f"{word_count} 个Word文档")
    if pdb_count:
        parts.append(f"{pdb_count} 个PDB文件")
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
            # PDB 模式: 只扫描资源页面（不遍历子页面）
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
                aggregated: Dict[str, List[Dict[str, Any]]] = {'经文': [], '听抄': [], '晨兴': [], 'pdb': []}
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
        context = browser.new_context()
        page = context.new_page()
        
        # 对每个 resource 分组下载
        for resource_id, docs in docs_by_resource.items():
            # 访问该资源页面（包含附件的页面）
            resource_url = f"https://www.notion.so/{resource_id.replace('-', '')}"
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
                
                # 最终目标路径: PDB 文件存放到 resource/pdb/{training}/ 子目录
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
                            f"text={original_filename}",
                            f"a:has-text('{original_filename}')",
                            f"div:has-text('{original_filename}')",
                            f"span:has-text('{original_filename}')",
                        ]
                        
                        temp_downloaded = False
                        for selector in selectors:
                            try:
                                locator = page.locator(selector).first
                                if locator.count() == 0:
                                    continue
                                
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
                                # .pdb.zip → 自动解压
                                if filename.lower().endswith('.pdb.zip'):
                                    unzip_pdb(target_path)
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
                    
                    # 直接点击文件名触发下载
                    # 尝试多种选择器方式
                    selectors = [
                        f"text={original_filename}",
                        f"a:has-text('{original_filename}')",
                        f"div:has-text('{original_filename}')",
                        f"span:has-text('{original_filename}')",
                    ]
                    
                    downloaded = False
                    for selector in selectors:
                        try:
                            # 先检查元素是否存在
                            locator = page.locator(selector).first
                            if locator.count() == 0:
                                continue
                            
                            print(f"  找到元素，尝试点击（选择器: {selector[:50]}...）")
                            
                            # 直接在 expect_download 里点击
                            with page.expect_download(timeout=20000) as download_info:
                                locator.click(timeout=5000, force=True)
                            
                            download = download_info.value
                            # 先下载到临时目录
                            download.save_as(temp_path)
                            # 然后移动到最终目录
                            shutil.move(str(temp_path), str(target_path))
                            print(f"[OK] 已下载：{target_path}")
                            # .pdb.zip → 自动解压
                            if filename.lower().endswith('.pdb.zip'):
                                unzip_pdb(target_path)
                            total_success += 1
                            downloaded = True
                            break
                            
                        except Exception as e:
                            print(f"  选择器 {selector[:30]}... 失败: {str(e)[:50]}")
                            continue
                    
                    if not downloaded:
                        # Playwright 点击全部失败，尝试签名 URL 兜底
                        print(f"  Playwright 点击均失败，尝试签名URL...")
                        signed_url = fetch_signed_url_from_request(context.request, doc['file_id'])
                        if signed_url:
                            try:
                                response = context.request.get(signed_url)
                                if response.status == 200:
                                    new_content = response.body()
                                    target_path.write_bytes(new_content)
                                    size_kb = len(new_content) / 1024
                                    print(f"  [OK] 签名URL下载成功: {target_path} ({size_kb:.1f} KB)")
                                    # .pdb.zip → 自动解压
                                    if filename.lower().endswith('.pdb.zip'):
                                        unzip_pdb(target_path)
                                    total_success += 1
                                    downloaded = True
                                else:
                                    print(f"  签名URL下载失败 ({response.status})")
                            except Exception as e:
                                print(f"  签名URL下载异常: {e}")
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
    parser.add_argument('--pdb', action='store_true', help='只下载PDB文件（所有年份），保存到 resource/pdb/')
    parser.add_argument('--dry-run', action='store_true', help='只扫描 Notion 页面，不实际下载（用于调试）')
    args = parser.parse_args()
    print('=' * 80)
    print('Notion文档下载器启动')
    print('=' * 80)
    if args.pdb:
        print('目标: 下载所有年份的PDB文件')
        print('保存位置: resource/pdb/{training}/')
    elif args.only_images:
        print('目标: 下载标语诗歌图片')
    else:
        print('目标: 下载训练资源中的简体中文Word文档和标语诗歌图片')
        print('类型: 经文、听抄、晨兴、标语诗歌')
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
