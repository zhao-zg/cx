#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""简化版 Notion 训练资源下载器，可选通过 Playwright 获取 token_v2。"""

import hashlib
import os
import re
import shutil
import sys
import time
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
    payload = {
        "pageId": page_id,
        "chunkNumber": 0,
        "limit": 100,
        "cursor": {"stack": []},
        "verticalColumns": False
    }
    response = session.post(NOTION_CHUNK_URL, json=payload, timeout=30)
    response.raise_for_status()
    return response.json().get('recordMap', {}).get('block', {})


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


def find_training_links_in_year(session: requests.Session, year_info: Dict[str, str]) -> List[Dict[str, str]]:
    blocks = load_page_blocks(session, year_info['id'])
    trainings = []
    for child_id in get_children(blocks, year_info['id']):
        block = blocks.get(child_id)
        if not block or block.get('value', {}).get('type') != 'page':
            continue
        title = get_block_title(block)
        if training_in_range(title):
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


def process_resource_page(session: requests.Session, resource: Dict[str, str]) -> Dict[str, List[Dict[str, Any]]]:
    blocks = load_page_blocks(session, resource['id'])
    documents = {'经文': [], '听抄': [], '晨兴': []}
    current_section = '经文'

    for child_id in get_children(blocks, resource['id']):
        block = blocks.get(child_id)
        if not block:
            continue
        block_type = block.get('value', {}).get('type')
        if block_type in {'header', 'sub_header', 'sub_sub_header'}:
            section_title = get_block_title(block)
            current_section = classify_document_type(section_title)
            continue
        if block_type == 'bulleted_list':
            section_title = get_block_title(block)
            list_type = classify_document_type(section_title)
            for item_id in block.get('value', {}).get('content', []):
                doc_block = blocks.get(item_id)
                if not doc_block or doc_block.get('value', {}).get('type') != 'file':
                    continue
                collect_file(doc_block, documents, list_type)
            continue
        if block_type == 'file':
            collect_file(block, documents, current_section)
    return documents


def collect_file(block: Dict[str, Any], documents: Dict[str, List[Dict[str, Any]]], section_type: str) -> None:
    value = block.get('value', {})
    filename = extract_filename(value)
    if not filename or not filename.lower().endswith(TARGET_EXTENSIONS):
        return
    if not is_simplified_chinese(filename) or (section_type == '经文' and not is_with_verses_s(filename)):
        return
    file_id = get_file_id(value)
    if not file_id:
        return
    doc_type = section_type if section_type in documents else '经文'
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
    if '晨兴' in title or 'hwmr' in lower:
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
    
    print(f"收集到 {len(all_docs)} 个文档，将使用 Playwright 下载...")
    return all_docs


def download_notion_documents(base_url: str) -> List[Dict[str, Any]]:
    page_id = extract_page_id(base_url)
    if not page_id:
        print("无法解析页面 ID")
        return []
    session = create_session()
    blocks = load_page_blocks(session, page_id)
    year_links = find_year_links(session, page_id)
    all_trainings = []
    for year in year_links:
        trainings = find_training_links_in_year(session, year)
        all_trainings.extend(trainings)
    
    all_docs: List[Dict[str, Any]] = []
    for training in all_trainings:
        resource_pages = find_resource_pages(session, training)
        if not resource_pages:
            continue
        folder_name = re.sub(r'[<>:\\"/|?*]', '_', training['title'])
        
        for resource in resource_pages:
            aggregated: Dict[str, List[Dict[str, Any]]] = {'经文': [], '听抄': [], '晨兴': []}
            docs = process_resource_page(session, resource)
            for key, value in docs.items():
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
        print(f"✓ MD5相同，跳过: {target}")
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
        browser = p.chromium.launch(headless=False)
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
                
                # 最终目标路径
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
                                print(f"  ✓ MD5相同，跳过: {filename}")
                                temp_path.unlink()  # 删除临时文件
                                total_success += 1
                                continue
                            else:
                                print(f"  MD5不同，从临时目录移动到resource: {filename}")
                                shutil.move(str(temp_path), str(target_path))
                                print(f"  ✓ 已更新：{target_path}")
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
                            print(f"✓ 已下载：{target_path}")
                            total_success += 1
                            downloaded = True
                            break
                            
                        except Exception as e:
                            print(f"  选择器 {selector[:30]}... 失败: {str(e)[:50]}")
                            continue
                    
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
            print(f"\n✓ 已清理临时目录: {tmp_dir}")
        except Exception as e:
            print(f"\n⚠ 清理临时目录失败: {e}")
    
    print('=' * 80)
    print(f"Playwright 下载完成: 成功 {total_success}，失败 {total_failed}")
    print('=' * 80)


def main() -> None:
    parser = ArgumentParser(description="Notion 文档下载器（自动使用 Playwright 回退下载）")
    parser.add_argument('--url', default=BASE_URL, help='Notion 页面 URL')
    args = parser.parse_args()
    print('=' * 80)
    print('Notion文档下载器启动')
    print('=' * 80)
    print('目标: 下载训练资源中的简体中文Word文档')
    print('类型: 经文、听抄、晨兴')
    print('=' * 80)
    start_time = time.time()
    all_docs: List[Dict[str, Any]] = []
    try:
        all_docs = download_notion_documents(args.url)
    except KeyboardInterrupt:
        print('\n\n用户中断下载')
    except Exception as error:
        print(f"\n\n程序异常: {error}")
    else:
        elapsed = time.time() - start_time
        print('=' * 80)
        print(f"文档收集完成, 耗时: {elapsed:.1f} 秒")
        print('=' * 80)
    
    if all_docs:
        playwright_downloads(all_docs)


if __name__ == '__main__':
    try:
        main()
    except Error as error:
        print(f'Playwright 错误: {error}')
        sys.exit(1)
