# -*- coding: utf-8 -*-
"""
Word文档静态网站生成器 - 主程序
"""
import os
import sys
import re
import json
import yaml
import shutil
import base64
import subprocess
from datetime import datetime
from src.parser_improved import parse_training_docs_improved
from src.generator import export_training_json, generate_search_index_from_json
from src.bible_dict import BibleDict


def generate_remote_config_js(remote_servers, output_dir):
    """从配置生成 remote-config.js（URL 以 base64 存储，运行时 atob() 解码）"""
    def b64(s):
        return base64.b64encode(s.encode()).decode()

    def arr(urls):
        return '[' + ','.join(f"_d('{b64(u)}')" for u in (urls or [])) + ']'

    cf       = remote_servers.get('cloudflare', [])
    gh_api   = remote_servers.get('github_api', '')
    mirrors  = remote_servers.get('github_mirrors', [])
    push     = remote_servers.get('push', [])
    ip_apis  = remote_servers.get('ip_apis', [])

    js = (
        "(function(){"
        "function _d(s){return atob(s);}"
        "window.CX_SERVERS={"
        f"cloudflare:{arr(cf)},"
        f"githubApi:_d('{b64(gh_api)}'),"
        f"githubMirrors:{arr(mirrors)},"
        f"push:{arr(push)},"
        f"ipApis:{arr(ip_apis)}"
        "};})();"
    )

    js_dir = os.path.join(output_dir, 'js')
    os.makedirs(js_dir, exist_ok=True)
    out_path = os.path.join(js_dir, 'remote-config.js')
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(js)
    print(f"\u2713 remote-config.js \u5df2\u751f\u6210: {out_path}")
    return out_path


def load_config(config_path='config.yaml'):
    """加载配置文件"""
    with open(config_path, 'r', encoding='utf-8') as f:
        return yaml.safe_load(f)


def find_document(base_path):
    """
    查找文档文件,支持 .doc 和 .docx 两种格式
    
    Args:
        base_path: 配置文件中指定的路径(可能带或不带扩展名)
    
    Returns:
        实际存在的文件路径,如果都不存在则返回 None
    """
    # 如果指定的文件存在,直接返回
    if os.path.exists(base_path):
        return base_path
    
    # 移除可能的扩展名
    base_without_ext = os.path.splitext(base_path)[0]
    
    # 尝试 .docx 和 .doc
    for ext in ['.docx', '.doc']:
        full_path = base_without_ext + ext
        if os.path.exists(full_path):
            return full_path
    
    return None


def find_document_in_folder(folder_path, filename):
    """
    在指定文件夹中查找文档,支持 .doc 和 .docx 两种格式
    
    Args:
        folder_path: 文件夹路径
        filename: 文件名(不带扩展名,如 '听抄', '经文', '晨兴')
    
    Returns:
        实际存在的文件路径,如果都不存在则返回 None
    """
    for ext in ['.docx', '.doc']:
        full_path = os.path.join(folder_path, filename + ext)
        if os.path.exists(full_path):
            return full_path
    return None


def find_all_numbered_documents(folder_path, base_filename):
    """
    查找所有带编号的文档，如 晨兴.doc, 晨兴2.doc, 晨兴3.doc
    
    Args:
        folder_path: 文件夹路径
        base_filename: 基础文件名(如 '晨兴', '听抄')
    
    Returns:
        文档路径列表，按编号排序
    """
    docs = []
    
    # 首先查找基础文件（不带编号）
    base_doc = find_document_in_folder(folder_path, base_filename)
    if base_doc:
        docs.append(base_doc)
    
    # 查找带编号的文件（2, 3, 4...）
    for num in range(2, 20):  # 最多支持到19个文件
        numbered_doc = find_document_in_folder(folder_path, f"{base_filename}{num}")
        if numbered_doc:
            docs.append(numbered_doc)
        else:
            # 如果某个编号不存在，停止查找后续编号
            break
    
    return docs


def scan_resource_folders(resource_dir='resource'):
    """
    扫描 resource 目录下的子文件夹
    
    Args:
        resource_dir: resource 目录路径
    
    Returns:
        子文件夹路径列表
    """
    if not os.path.exists(resource_dir):
        return []
    
    # 非训练批次目录（数据源目录），跳过不处理
    _SKIP_DIRS = {'bible', 'bible-db', 'bible2'}

    folders = []
    for item in os.listdir(resource_dir):
        item_path = os.path.join(resource_dir, item)
        if os.path.isdir(item_path) and not item.startswith('.') and item not in _SKIP_DIRS:
            folders.append(item_path)
    
    return sorted(folders)


def extract_year_month_from_folder(folder_name: str):
    """
    从批次文件夹名提取 (year, month)
    支持格式：
      - 2025-04 夏季训练
      - 2025-04-夏季训练

    Returns:
        (year, month) 或 None
    """
    import re
    match = re.match(r'^(\d{4})-(\d{2})', folder_name)
    if not match:
        return None

    year = int(match.group(1))
    month = int(match.group(2))
    if month < 1 or month > 12:
        return None

    return (year, month)


def url_safe_name(name):
    """
    将文件夹名转换为 URL 安全的名称
    保留年份-月份格式，移除中文和空格
    
    例如：
    "2025-04 夏季训练" -> "2025-04"
    "2025-05 国际长老及负责弟兄训练" -> "2025-05"
    "2025-06 感恩节相调特会" -> "2025-06"
    """
    import re
    # 提取年份-月份部分（YYYY-MM 格式）
    match = re.match(r'(\d{4}-\d{2})', name)
    if match:
        return match.group(1)
    
    # 如果没有匹配到，只保留 ASCII 字符、数字、连字符
    safe = re.sub(r'[^\w\-]', '-', name, flags=re.ASCII)
    safe = re.sub(r'-+', '-', safe)  # 移除连续的连字符
    safe = safe.strip('-')  # 移除首尾的连字符
    return safe if safe else name


def process_batch(batch_folder, config, bible_dict: BibleDict = None):
    """
    处理单个批次的文档，生成 training.json。

    Returns:
        成功时返回批次信息 dict，失败返回 None。
    """
    batch_name = os.path.basename(batch_folder)
    safe_batch_name = url_safe_name(batch_name)

    print("\n" + "="*60)
    print(f" 处理批次: {batch_name}")
    if safe_batch_name != batch_name:
        print(f" 输出目录: {safe_batch_name}")
    print("="*60)
    print()

    batch_config = config.copy()
    default_training = config.get('default_training', {})

    if '-' in batch_name:
        parts = batch_name.split('-')
        try:
            year = int(parts[0])
            season = parts[-1] if len(parts) > 1 else default_training.get('season', '秋季')
            batch_config['year'] = year
            batch_config['season'] = season
            print(f"✓ 自动识别: {year}年{season}")
        except ValueError:
            print(f"⚠ 无法从文件夹名识别年份季节，使用默认配置")
            batch_config['year'] = default_training.get('year', 2025)
            batch_config['season'] = default_training.get('season', '秋季')
    else:
        batch_config['year'] = default_training.get('year', 2025)
        batch_config['season'] = default_training.get('season', '秋季')
        print(f"⚠ 文件夹名格式不标准，使用默认配置: {batch_config['year']}年{batch_config['season']}")

    listen_doc = find_document_in_folder(batch_folder, '听抄')
    scripture_doc = find_document_in_folder(batch_folder, '经文')
    morning_revival_docs = find_all_numbered_documents(batch_folder, '晨兴')

    if not listen_doc:
        print(f"⚠ 跳过 {batch_name}: 未找到听抄文档")
        return None

    if not scripture_doc:
        print(f"⚠ 跳过 {batch_name}: 未找到经文文档")
        return None

    print(f"✓ 找到听抄文档: {os.path.basename(listen_doc)}")
    print(f"✓ 找到经文文档: {os.path.basename(scripture_doc)}")

    if morning_revival_docs:
        for idx, doc in enumerate(morning_revival_docs, 1):
            print(f"✓ 找到晨兴文档{idx}: {os.path.basename(doc)}")
    else:
        print(f"⚠ 未找到晨兴文档，将跳过晨兴内容")
    print()

    output_dir = os.path.join(batch_config['output_dir'], safe_batch_name)
    try:
        training_data = parse_training_docs_improved(
            outline_path=scripture_doc,
            listen_path=listen_doc,
            morning_revival_path=morning_revival_docs[0] if morning_revival_docs else None,
            morning_revival_path2=morning_revival_docs[1] if len(morning_revival_docs) > 1 else None,
            title='',
            subtitle='',
            year=batch_config['year'],
            season=batch_config['season'],
            output_dir=output_dir,
            bible_dict=bible_dict
        )
        print(f"✓ 解析完成: {len(training_data.chapters)} 篇章")
    except Exception as e:
        print(f"✗ 文档解析失败: {e}")
        import traceback
        traceback.print_exc()
        return None

    training_version = ''
    try:
        training_version = export_training_json(training_data, output_dir)
    except Exception as e:
        print(f"✗ training.json 生成失败: {e}")
        import traceback
        traceback.print_exc()
        return None

    print(f"✓ 完成: {output_dir}/training.json")

    # Collect image list (for trainings.json metadata)
    training_images = []
    images_dir = os.path.join(output_dir, 'images')
    if os.path.exists(images_dir):
        for fn in os.listdir(images_dir):
            if fn.lower().endswith(('.png', '.jpg', '.jpeg', '.gif')):
                training_images.append(f"images/{fn}")

    return {
        'name': batch_name,
        'year': training_data.year,
        'season': training_data.season,
        'title': training_data.title,
        'chapter_count': len(training_data.chapters),
        'path': safe_batch_name,
        'images': training_images,
        'version': training_version,
    }



def generate_main_index(config, batch_results):
    """生成总主页（SPA 模式）：复制 SPA shell、生成 trainings.json 和所有静态资产。"""
    if not batch_results:
        return

    output_dir = config.get('output_dir', 'output')
    template_dir = config.get('template_dir', 'src/templates')

    # ── 整理训练列表 ──────────────────────────────────────────────────────
    trainings = []
    total_chapters = 0

    for result in batch_results:
        trainings.append({
            'year': result['year'],
            'season': result['season'],
            'title': result['title'],
            'chapter_count': result['chapter_count'],
            'path': result['path'],
            'images': result.get('images', []),
            'version': result.get('version', ''),
        })
        total_chapters += result['chapter_count']

    def get_sort_key(t):
        m = re.match(r'(\d{4})-(\d{2})', t['path'])
        if m:
            return (int(m.group(1)), int(m.group(2)))
        season_order = {'春季': 1, '夏季': 2, '秋季': 3, '冬季': 4}
        return (t['year'], season_order.get(t['season'], 5))

    trainings.sort(key=get_sort_key, reverse=True)

    # ── trainings.json ────────────────────────────────────────────────────
    trainings_json = {
        'version': datetime.now().strftime('%Y%m%d%H%M%S'),
        'generation_time': datetime.now().strftime('%Y年%m月%d日 %H:%M'),
        'trainings': trainings,
        'total_chapters': total_chapters,
    }
    with open(os.path.join(output_dir, 'trainings.json'), 'w', encoding='utf-8') as f:
        json.dump(trainings_json, f, ensure_ascii=False, indent=2)
    print(f"✓ trainings.json 已生成")

    # ── 复制 SPA index.html shell ─────────────────────────────────────────
    spa_shell_src = os.path.join('src', 'static', 'index.html')
    spa_shell_dst = os.path.join(output_dir, 'index.html')
    if os.path.exists(spa_shell_src):
        shutil.copy2(spa_shell_src, spa_shell_dst)
        print(f"✓ SPA index.html 已复制")
    else:
        print(f"⚠ 未找到 src/static/index.html — SPA shell 缺失")

    # ── 图标 ──────────────────────────────────────────────────────────────
    icons_dir = os.path.join(output_dir, 'icons')
    os.makedirs(icons_dir, exist_ok=True)
    for icon_fn in ['icon.svg', 'icon-16.png', 'icon-32.png',
                    'icon-120.png', 'icon-152.png', 'icon-167.png',
                    'icon-180.png', 'icon-192.png', 'icon-512.png']:
        src = os.path.join('src', 'static', 'icons', icon_fn)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(icons_dir, icon_fn))

    # ── 静态图片 → output/images/（赞助二维码等）───────────────────────
    static_img_src = os.path.join('src', 'static', 'image')
    static_img_dst = os.path.join(output_dir, 'images')
    if os.path.exists(static_img_src):
        os.makedirs(static_img_dst, exist_ok=True)
        for fn in os.listdir(static_img_src):
            src_f = os.path.join(static_img_src, fn)
            if os.path.isfile(src_f):
                shutil.copy2(src_f, os.path.join(static_img_dst, fn))
        print(f"✓ 静态图片已复制到 images/")

    # ── vendor 目录（localforage 等第三方库）────────────────────────────
    vendor_src = os.path.join('src', 'static', 'js', 'vendor')
    vendor_dst = os.path.join(output_dir, 'vendor')
    if os.path.exists(vendor_src):
        os.makedirs(vendor_dst, exist_ok=True)
        for fn in os.listdir(vendor_src):
            src_f = os.path.join(vendor_src, fn)
            if os.path.isfile(src_f):
                shutil.copy2(src_f, os.path.join(vendor_dst, fn))
        print(f"✓ vendor 目录已复制")

    # ── 共享 JS → output/js/ ─────────────────────────────────────────────
    js_dir = os.path.join(output_dir, 'js')
    os.makedirs(js_dir, exist_ok=True)
    shared_js_files = [
        'app-update.js', 'nav-stack.js', 'dev-console.js', 'theme-toggle.js',
        'bible-dict.js', 'speech.js', 'highlight.js', 'outline.js',
        'scripture-popup.js', 'toc-redirect.js', 'font-control.js',
        'search.js', 'image-utils.js',
        # SPA-specific
        'ref-detector.js', 'router.js', 'renderer.js',
    ]
    for js_file in shared_js_files:
        src = os.path.join('src', 'static', 'js', js_file)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(js_dir, js_file))
    print(f"✓ 共享 JS 文件已复制到 js/")

    # ── remote-config.js ──────────────────────────────────────────────────
    remote_servers = config.get('remote_servers', {})
    if remote_servers:
        generate_remote_config_js(remote_servers, output_dir)

    # ── 可选混淆 ──────────────────────────────────────────────────────────
    # 默认仅在 CI 环境（GitHub Actions）混淆；本地开发跳过以方便调试。
    # 强制开启：设置环境变量 OBFUSCATE_JS=1
    # 强制关闭：设置环境变量 OBFUSCATE_JS=0
    _ob_env = os.environ.get('OBFUSCATE_JS', '').strip().lower()
    if _ob_env in ('0', 'false', 'no'):
        do_obfuscate = False
    elif _ob_env in ('1', 'true', 'yes'):
        do_obfuscate = True
    else:
        do_obfuscate = bool(os.environ.get('CI') or os.environ.get('GITHUB_ACTIONS'))
    if do_obfuscate:
        try:
            from encrypt_app_update import obfuscate_all
            obfuscate_all(output_dir)
        except Exception:
            pass
    else:
        print("⏭  跳过 JS 混淆（本地开发模式；如需开启请设置 OBFUSCATE_JS=1）")

    # ── 共享 CSS → output/css/ ────────────────────────────────────────────
    css_dir = os.path.join(output_dir, 'css')
    os.makedirs(css_dir, exist_ok=True)
    css_src_dir = os.path.join('src', 'static', 'css')
    if os.path.exists(css_src_dir):
        for css_file in os.listdir(css_src_dir):
            if css_file.endswith('.css'):
                shutil.copy2(os.path.join(css_src_dir, css_file),
                             os.path.join(css_dir, css_file))
    print(f"✓ 共享 CSS 文件已复制到 css/")

    # ── manifest.json（静态，无模板变量）────────────────────────────────
    manifest_src = os.path.join(template_dir, 'main_manifest.json')
    if os.path.exists(manifest_src):
        shutil.copy2(manifest_src, os.path.join(output_dir, 'manifest.json'))
    print(f"✓ manifest.json 已生成")

    # ── sw.js（纯路由版，静态文件）───────────────────────────────────────
    sw_src = os.path.join(template_dir, 'main_sw.js')
    if os.path.exists(sw_src):
        shutil.copy2(sw_src, os.path.join(output_dir, 'sw.js'))
    print(f"✓ Service Worker 已生成")

    # ── _headers（Cloudflare Pages MIME）────────────────────────────────
    headers_src = os.path.join(template_dir, '_headers')
    if os.path.exists(headers_src):
        shutil.copy2(headers_src, os.path.join(output_dir, '_headers'))
        print(f"✓ _headers 文件已复制")

    # ── changelog.json ────────────────────────────────────────────────────
    if os.path.exists('changelog.json'):
        shutil.copy2('changelog.json', os.path.join(output_dir, 'changelog.json'))
        print(f"✓ changelog.json 已复制")

    # ── .nojekyll ──────────────────────────────────────────────────────────
    with open(os.path.join(output_dir, '.nojekyll'), 'w') as f:
        f.write('')
    print(f"✓ .nojekyll 已创建")

    index_path = os.path.join(output_dir, 'index.html')
    print(f"\n✓ SPA 主页已生成: {index_path}")


def main():
    """主函数"""
    print("="*60)
    print(" Word文档静态网站生成器 (通用批量版)")
    print("="*60)
    print()
    
    # 导入版本生成模块
    try:
        from generate_version import generate_version_file
    except ImportError:
        generate_version_file = None
    
    # 加载配置
    try:
        config = load_config()
        print("✓ 配置文件加载成功")
    except Exception as e:
        print(f"✗ 配置文件加载失败: {e}")
        return 1
    
    # 检查是否启用批量处理
    batch_config = config.get('batch_processing', {})
    if not batch_config.get('enabled', True):
        # 单个训练处理模式（使用默认配置）
        default_config = config.get('default_training', {})
        year = default_config.get('year', 2025)
        season = default_config.get('season', '秋季')
        batch_name = f"{year}-{season}"
        batch_folder = os.path.join(config.get('resource_dir', 'resource'), batch_name)
        
        if not os.path.exists(batch_folder):
            print(f"✗ 未找到默认训练文件夹: {batch_folder}")
            return 1
            
        return process_batch(batch_folder, config)
    
    # 批量处理模式
    resource_dir = config.get('resource_dir', 'resource')
    
    # 检查是否指定了特定训练
    specific_trainings = batch_config.get('specific_trainings', [])
    if specific_trainings:
        # 处理指定的训练
        batch_folders = []
        for training in specific_trainings:
            folder_path = os.path.join(resource_dir, training)
            if os.path.exists(folder_path):
                batch_folders.append(folder_path)
            else:
                print(f"⚠ 未找到指定训练文件夹: {folder_path}")
        
        if not batch_folders:
            print("✗ 所有指定的训练文件夹都不存在")
            return 1
    else:
        # 扫描所有可用训练
        batch_folders = scan_resource_folders(resource_dir)

        # 仅保留最新 N 个训练（用于控制 GitHub 打包体积）
        max_latest_trainings = batch_config.get('max_latest_trainings', 7)
        if isinstance(max_latest_trainings, int) and max_latest_trainings > 0 and len(batch_folders) > max_latest_trainings:
            folders_with_date = []
            folders_without_date = []

            for folder in batch_folders:
                folder_name = os.path.basename(folder)
                year_month = extract_year_month_from_folder(folder_name)
                if year_month:
                    folders_with_date.append((year_month, folder))
                else:
                    folders_without_date.append(folder)

            # 按时间倒序，取最新 N 个
            folders_with_date.sort(key=lambda x: x[0], reverse=True)
            selected_dated_folders = [folder for _, folder in folders_with_date[:max_latest_trainings]]

            # 若可识别日期的不足 N 个，则补充其他文件夹（保持原顺序）
            if len(selected_dated_folders) < max_latest_trainings and folders_without_date:
                remaining_slots = max_latest_trainings - len(selected_dated_folders)
                selected_dated_folders.extend(folders_without_date[:remaining_slots])

            # 最终按时间顺序处理（旧 -> 新），便于日志阅读
            def folder_sort_key(folder_path):
                folder_name = os.path.basename(folder_path)
                year_month = extract_year_month_from_folder(folder_name)
                return year_month if year_month else (0, 0)

            batch_folders = sorted(selected_dated_folders, key=folder_sort_key)
            print(f"ℹ 已启用最新训练保留策略：仅处理最新 {max_latest_trainings} 个批次")
    
    if not batch_folders:
        print(f"✗ 在 {resource_dir} 目录下未找到任何批次文件夹")
        print(f"提示: 请将文档按批次放在 {resource_dir}/批次名称/ 目录下")
        return 1
    
    print(f"✓ 找到 {len(batch_folders)} 个批次:")
    for folder in batch_folders:
        print(f"  - {os.path.basename(folder)}")
    print()
    
    # 初始化经文字典（仅用于跨章节「从略」还原，不持久化到磁盘）
    bible_dict = BibleDict()

    # 通过 SQL/CG.db 生成圣经数据 JSON 到 output/data/，确保 process_batch 能读到用于过滤
    _output_dir_early = config.get('output_dir', 'output')
    _data_dir_early = os.path.join(_output_dir_early, 'data')
    os.makedirs(_data_dir_early, exist_ok=True)

    _exporter = os.path.join(os.path.dirname(__file__), 'export_bible_sql_json.py')
    if not os.path.exists(_exporter):
        print(f"✗ 未找到圣经 SQL 导出脚本: {_exporter}")
        return 1

    print("\n正在从 CG.db 生成圣经数据 JSON ...")
    _cmd = [sys.executable, _exporter, '--out-dir', _data_dir_early, '--normalize-xrefs']
    _ret = subprocess.run(_cmd)
    if _ret.returncode != 0:
        print("✗ 圣经数据 JSON 生成失败")
        return 1

    # 压缩 JSON（去缩进）减少打包体积
    for _df in ['bible-text.json', 'bible-notes.json', 'bible-xrefs.json']:
        _dst = os.path.join(_data_dir_early, _df)
        if os.path.exists(_dst):
            with open(_dst, 'r', encoding='utf-8') as _rf:
                _jdata = json.load(_rf)
            with open(_dst, 'w', encoding='utf-8') as _wf:
                json.dump(_jdata, _wf, ensure_ascii=False, separators=(',', ':'))
    print(f"✓ 圣经数据 JSON 已生成并压缩到 {_data_dir_early}/")

    # 处理每个批次
    success_count = 0
    failed_count = 0
    skip_existing = batch_config.get('skip_existing', False)
    strict_exit_on_batch_failure = batch_config.get('strict_exit_on_batch_failure', False)
    batch_results = []

    for batch_folder in batch_folders:
        batch_name = os.path.basename(batch_folder)
        safe_batch_name = url_safe_name(batch_name)
        output_dir = os.path.join(config['output_dir'], safe_batch_name)

        # skip_existing: check for training.json (SPA mode)
        if skip_existing and os.path.exists(os.path.join(output_dir, 'training.json')):
            print(f"⏭ 跳过 {batch_name}: training.json 已存在")
            # Read existing training.json for metadata
            try:
                with open(os.path.join(output_dir, 'training.json'), encoding='utf-8') as f:
                    tdata = json.load(f)
                images = []
                images_dir = os.path.join(output_dir, 'images')
                if os.path.exists(images_dir):
                    for fn in os.listdir(images_dir):
                        if fn.lower().endswith(('.png', '.jpg', '.jpeg', '.gif')):
                            images.append(f"images/{fn}")
                batch_results.append({
                    'name': batch_name,
                    'year': tdata.get('year', 2025),
                    'season': tdata.get('season', ''),
                    'title': tdata.get('title', ''),
                    'chapter_count': len(tdata.get('chapters', [])),
                    'path': safe_batch_name,
                    'images': images,
                })
                success_count += 1
            except Exception:
                pass
            continue

        result = process_batch(batch_folder, config, bible_dict)
        if result is not None:
            success_count += 1
            batch_results.append(result)
        else:
            failed_count += 1

    
    # 生成总主页
    if batch_results:
        try:
            generate_main_index(config, batch_results)
        except Exception as e:
            print(f"⚠ 生成总主页失败: {e}")
            import traceback
            traceback.print_exc()
    
    # 总结
    print("\n" + "="*60)
    print(" 批量生成完成")
    print("="*60)
    print(f"✓ 成功: {success_count} 个批次")
    if failed_count > 0:
        print(f"✗ 失败: {failed_count} 个批次")
    print(f"\n所有输出文件位于: {config['output_dir']}/")
    
    # 生成版本信息文件
    if generate_version_file:
        try:
            print("\n生成版本信息...")
            generate_version_file(config['output_dir'])
        except Exception as e:
            print(f"⚠ 版本信息生成失败: {e}")
    
    print("="*60)
    
    # 退出码策略：
    # 1) 全部成功 -> 0
    # 2) 部分失败但有成功 -> 默认 0（便于 CI 持续打包），可通过 strict_exit_on_batch_failure=true 切回严格模式
    # 3) 全部失败 -> 1
    if failed_count == 0:
        return 0

    if success_count == 0:
        return 1

    if strict_exit_on_batch_failure:
        print("⚠ 检测到批次失败，严格模式启用：返回失败退出码")
        return 1

    print("⚠ 检测到批次失败，但已有成功批次：继续并返回成功退出码")
    return 0


if __name__ == '__main__':
    sys.exit(main())
