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


def generate_pages_middleware(config, project_root='.'):
    """根据 access_time 配置生成 Cloudflare Pages Functions _middleware.js
    
    生成的 functions/_middleware.js 会在 wrangler pages deploy 时自动被
    Cloudflare Pages 识别，对所有请求执行时间段/星期拦截。
    
    支持 daily_schedule 按天配置不同开放时间（优先级高于统一 allow_start/allow_end）。
    支持 allow_days 限制可访问的星期。
    内置管理员直通：前端管理面板密码验证后设 cx_admin_auth cookie → 免检。
    """
    access_time = config.get('access_time', {})
    if not access_time or not access_time.get('enabled', False):
        # 配置关闭时删除已有 middleware（避免残留）
        mw_path = os.path.join(project_root, 'functions', '_middleware.js')
        if os.path.exists(mw_path):
            os.remove(mw_path)
            print('✓ functions/_middleware.js 已删除（access_time 已关闭）')
        return

    start_hour = int(access_time.get('allow_start', 6))
    end_hour   = int(access_time.get('allow_end', 23))
    tz_offset  = int(access_time.get('timezone_offset', 8))
    # allow_days: 可选列表 [0-6]；None/空 表示每天均可访问
    allow_days = access_time.get('allow_days')
    has_day_restrict = allow_days is not None and len(allow_days) > 0
    # daily_schedule: 可选 dict { day: {start, end} }
    daily_schedule = access_time.get('daily_schedule')
    has_daily_schedule = daily_schedule is not None and len(daily_schedule) > 0
    _DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

    # ── 构建按天 schedule JS ────────────────────────────
    schedule_js = ''
    if has_daily_schedule:
        pairs = []
        for day in sorted(daily_schedule.keys(), key=lambda k: int(k)):
            entry = daily_schedule[day]
            s = int(entry.get('start', start_hour))
            e = int(entry.get('end', end_hour))
            pairs.append(f"  {int(day)}: [{s}, {e}]")
        schedule_js = f'const SCHEDULE = {{\n' + ',\n'.join(pairs) + ',\n};\n'

        # ── 通用 403 HTML（20 次点击解锁，不暴露任何时段信息） ──
    BLOCKED_HTML = (
        '<!DOCTYPE html><html><head>'
        '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        '<style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;'
        'background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#999;font-size:16px;'
        'user-select:none;-webkit-user-select:none}</style></head><body>'
        '<script>(function(){'
        'var n=parseInt((document.cookie.match(/(?:^|; )cx_click_n=(\\d+)/)||[])[1]||\'0\',10)+1;'
        'document.cookie=\'cx_click_n=\'+n+\';path=/;max-age=86400\';'
        'if(n>=20){document.cookie=\'cx_unlock=1;path=/;max-age=2592000\';'
        'document.cookie=\'cx_click_n=;path=/;max-age=0\';location.reload()})'
        '</script></body></html>'
    )

    # ── 通用 blockedResponse() 函数 ──
    blocked_func = (
        'const BLOCKED_HTML = ' + json.dumps(BLOCKED_HTML) + ';\n'
        '\n'
        'function blockedResponse() {\n'
        '  return new Response(BLOCKED_HTML, {\n'
        '    status: 403,\n'
        '    headers: {\n'
        '      "Content-Type": "text/html; charset=utf-8",\n'
        '      "X-Maintenance": "true",\n'
        '    },\n'
        '  });\n'
        '}\n'
    )

    # ── 管理员直通 + 20 次点击解锁 cookie 检查 ──
    bypass_code = (
        '\n'
        '  // ── 管理员直通（前端管理面板密码验证后设 cookie） ──\n'
        '  const _cookies = (context.request.headers.get("Cookie") || "").split(";").map(c => c.trim());\n'
        '  if (_cookies.some(c => c === "cx_admin_auth=1")) {\n'
        '    return context.next();\n'
        '  }\n'
        '\n'
        '  // ── 点击 20 次解锁（403 页面的 JS 累计点击后设 cookie） ──\n'
        '  if (_cookies.some(c => c === "cx_unlock=1")) {\n'
        '    return context.next();\n'
        '  }\n'
        '\n'
    )

    # ── 构建 JS 数组和星期检查代码块 ────────────────────
    if has_day_restrict:
        days_arr = ', '.join(str(int(d)) for d in allow_days)
        day_code = (
            f'const ALLOW_DAYS = [{days_arr}];\n'
            '\n'
        )
        day_block_js = (
            '  if (!ALLOW_DAYS.includes(day)) {\n'
            '    return blockedResponse();\n'
            '  }\n'
            '\n'
        )
        day_desc = '，允许日: ' + '、'.join(_DAY_NAMES[int(d)] for d in allow_days)
    else:
        day_code = ''
        day_block_js = ''
        day_desc = '，每天均可访问'

    # ── 构建小时检查代码块 ──────────────────────────────
    if has_daily_schedule:
        hour_check_js = (
            '  // 按天查询开放时间\n'
            '  const _entry = SCHEDULE[day];\n'
            '  const _start = _entry ? _entry[0] : GLOBAL_START;\n'
            '  const _end = _entry ? _entry[1] : GLOBAL_END;\n'
            '  const hour = local.getUTCHours();\n'
            '\n'
            '  if (hour < _start || hour >= _end) {\n'
            '    return blockedResponse();\n'
            '  }\n'
        )
    else:
        hour_check_js = (
            '  const hour = local.getUTCHours();\n'
            '\n'
            '  if (hour < ALLOW_START || hour >= ALLOW_END) {\n'
            '    return blockedResponse();\n'
            '  }\n'
        )
    # ── 组装完整 JS ────────────────────────────────────
    middle_parts = [
        '// Cloudflare Pages Functions - 访问时间/星期控制\n'
        '// 由 main.py 根据 config.yaml access_time 配置自动生成，请勿手动编辑\n'
    ]
    if has_daily_schedule:
        middle_parts.append(f'const GLOBAL_START = {start_hour};\n')
        middle_parts.append(f'const GLOBAL_END = {end_hour};\n')
        middle_parts.append(schedule_js)
    else:
        middle_parts.append(f'const ALLOW_START = {start_hour};\n')
        middle_parts.append(f'const ALLOW_END = {end_hour};\n')
    middle_parts.append(f'const TZ_OFFSET = {tz_offset};\n')
    middle_parts.append(day_code)
    middle_parts.append(blocked_func)
    middle_parts.append(
        '\n'
        'export async function onRequest(context) {\n'
        '  const now = new Date();\n'
        '  // 计算本地时间（UTC + TZ_OFFSET）\n'
        '  const local = new Date(now.getTime() + TZ_OFFSET * 3600000);\n'
        '  const day = local.getUTCDay();\n'
        '\n'
    )
    middle_parts.append(bypass_code)
    middle_parts.append(day_block_js)
    middle_parts.append(hour_check_js)
    middle_parts.append(
        '\n'
        '  return context.next();\n'
        '}\n'
    )
    middleware_js = ''.join(middle_parts)

    functions_dir = os.path.join(project_root, 'functions')
    os.makedirs(functions_dir, exist_ok=True)
    mw_path = os.path.join(functions_dir, '_middleware.js')
    with open(mw_path, 'w', encoding='utf-8') as f:
        f.write(middleware_js)

    # ── 打印总结信息 ────────────────────────────────────
    if has_daily_schedule:
        sched_desc = '，按天配置: ' + ', '.join(
            f'{_DAY_NAMES[int(k)]} {v["start"]}:00-{v["end"]}:00'
            for k, v in sorted(daily_schedule.items(), key=lambda x: int(x[0]))
        )
        print(f'✓ functions/_middleware.js 已生成（按天开放时间{sched_desc}）')
    else:
        print(f'✓ functions/_middleware.js 已生成（允许访问: {start_hour}:00 - {end_hour}:00 UTC+{tz_offset}{day_desc}）')
    return mw_path


def generate_remote_config_js(remote_servers, output_dir, sponsor_enabled=True):
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
    sponsor_js = 'true' if sponsor_enabled else 'false'

    js = (
        "(function(){"
        "function _d(s){return atob(s);}"
        "window.CX_SERVERS={"
        f"cloudflare:{arr(cf)},"
        f"githubApi:_d('{b64(gh_api)}'),"
        f"githubMirrors:{arr(mirrors)},"
        f"push:{arr(push)},"
        f"ipApis:{arr(ip_apis)},"
        f"sponsorEnabled:{sponsor_js}"
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


def find_txt_files_in_folder(folder_path):
    """
    在指定文件夹中查找 TXT 文件（不含子目录）。
    
    Returns:
        TXT 文件路径列表，按文件名排序；无则返回空列表。
    """
    if not os.path.isdir(folder_path):
        return []
    txt_files = sorted([
        os.path.join(folder_path, f)
        for f in os.listdir(folder_path)
        if f.lower().endswith('.txt') and os.path.isfile(os.path.join(folder_path, f))
    ])
    return txt_files


def find_matching_txt_in_history(batch_folder_name, resource_dir='resource'):
    """
    从 resource/历史合辑/ 中查找与批次文件夹匹配的 TXT 文件。
    
    匹配规则：批次文件夹名 'YYYY-MM ...' → 历史合辑/YYYY/YYYY-M-*.txt
    （MM 去掉前导零后与 TXT 文件名的序号部分比对）
    
    Args:
        batch_folder_name: 批次文件夹名（如 '2026-01 国际华语特会'）
        resource_dir: resource 目录路径
    
    Returns:
        匹配的 TXT 文件路径，未找到返回 None。
    """
    m = re.match(r'^(\d{4})-(\d{2})', batch_folder_name)
    if not m:
        return None

    year = m.group(1)          # '2026'
    seq_with_pad = m.group(2)  # '01'
    seq = str(int(seq_with_pad))  # '1'（去掉前导零，匹配 2026-1-*.txt 格式）

    history_dir = os.path.join(resource_dir, '历史合辑', year)
    if not os.path.isdir(history_dir):
        return None

    for f in sorted(os.listdir(history_dir)):
        if not f.lower().endswith('.txt'):
            continue
        # 兼容带零和不带零两种格式：YYYY-M- 与 YYYY-MM-
        if re.match(rf'^{re.escape(year)}-(?:{re.escape(seq_with_pad)}|{re.escape(seq)})-', f):
            return os.path.join(history_dir, f)

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
    
    # 历史合辑由 build-trainings-json.js 单独处理，跳过 Word 文档批处理
    _SKIP_DIRS = {'bible', 'bible-db', 'bible2', '历史合辑'}

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


def process_batch_txt(batch_folder, config, batch_config, safe_batch_name, txt_file=None):
    """
    使用 TXT 文件（优先）生成 training.json，调用 Node.js 脚本。
    标语诗歌图片始终从批次文件夹获取（不依赖 Word）。

    Args:
        txt_file: 指定 TXT 文件路径（如来自 历史合辑）；None 则自动在批次文件夹中查找。

    Returns:
        成功时返回批次信息 dict，失败返回 None。
    """
    batch_name = os.path.basename(batch_folder)
    output_dir = os.path.join(config['output_dir'], safe_batch_name)

    _build_txt = os.path.join(os.path.dirname(__file__), 'tools', 'build-batch-txt.js')
    if not os.path.exists(_build_txt):
        print(f"⚠ 未找到 TXT 构建脚本: {_build_txt}")
        return None

    cmd = [
        'node', _build_txt,
        '--folder', batch_folder,
        '--output', output_dir,
    ]
    if txt_file:
        cmd.extend(['--txt', txt_file])
    if batch_config.get('year'):
        cmd.extend(['--year', str(batch_config['year'])])
    if batch_config.get('season'):
        cmd.extend(['--season', str(batch_config['season'])])

    print(f"  调用 Node.js 解析 TXT 文件...")
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding='utf-8',
            errors='replace',
        )
    except Exception as e:
        print(f"✗ TXT 解析进程异常: {e}")
        return None

    # stderr 输出人类可读日志
    if result.stderr:
        for line in result.stderr.strip().split('\n'):
            print(f"  {line}")

    if result.returncode != 0:
        print(f"✗ TXT 解析失败 (exit {result.returncode})")
        if result.stdout:
            print(f"  stdout: {result.stdout[:200]}")
        return None

    # stdout 是元数据 JSON
    try:
        meta = json.loads(result.stdout.strip())
    except (json.JSONDecodeError, ValueError) as e:
        print(f"✗ 无法解析 TXT 脚本输出: {e}")
        return None

    print(f"✓ TXT 解析完成: {meta.get('chapter_count', 0)} 篇章")

    # ── 从晨兴 Word 文档补丁诗歌内容和图片 ────────────────────────────────
    _patch_hymn = os.path.join(os.path.dirname(__file__), 'tools', 'patch-hymn-from-word.py')
    if os.path.exists(_patch_hymn):
        print(f"\n  📖 从晨兴 Word 文档提取诗歌内容...")
        try:
            _child_env = os.environ.copy()
            _child_env['PYTHONIOENCODING'] = 'utf-8'
            hymn_result = subprocess.run(
                [sys.executable, _patch_hymn,
                 '--output-dir', output_dir,
                 '--batch-folder', batch_folder],
                capture_output=True,
                text=True,
                encoding='utf-8',
                errors='replace',
                timeout=180,
                env=_child_env,
            )
            if hymn_result.stderr:
                for line in hymn_result.stderr.strip().split('\n'):
                    print(f"  {line}")
            if hymn_result.returncode == 0 and hymn_result.stdout.strip():
                # 从 stdout 中提取 JSON（首行 { 到末行 }），忽略混入的非 JSON 输出
                _raw = hymn_result.stdout.strip()
                _json_start = _raw.find('{')
                _json_end = _raw.rfind('}')
                if _json_start >= 0 and _json_end > _json_start:
                    _json_str = _raw[_json_start:_json_end + 1]
                    hymn_meta = json.loads(_json_str)
                    patched = hymn_meta.get('patched_chapters', 0)
                    if patched:
                        print(f"  ✓ 诗歌数据已合并: {patched}/{hymn_meta.get('total_chapters', 0)} 篇")
                    else:
                        print(f"  ⚠ 无诗歌数据需要合并")
                else:
                    print(f"  ⚠ 诗歌补丁输出无 JSON，跳过")
            elif hymn_result.returncode != 0:
                print(f"  ⚠ 诗歌补丁失败 (exit {hymn_result.returncode})")
        except subprocess.TimeoutExpired:
            print(f"  ⚠ 诗歌补丁超时，跳过")
        except Exception as e:
            print(f"  ⚠ 诗歌补丁异常: {e}")

        # ── 回退：若 training.json 中 hymn_images 为空但磁盘有 hymn_*.png，则自动补充 ──
        _training_json = os.path.join(output_dir, 'training.json')
        _images_dir = os.path.join(output_dir, 'images')
        if os.path.exists(_training_json) and os.path.isdir(_images_dir):
            hymn_files = sorted([
                f for f in os.listdir(_images_dir)
                if f.startswith('hymn_') and f.lower().endswith(('.png', '.jpg', '.jpeg'))
            ])
            if hymn_files:
                try:
                    with open(_training_json, 'r', encoding='utf-8') as _f:
                        _td = json.load(_f)
                    _need_write = False
                    for _ch in _td.get('chapters', []):
                        if _ch.get('hymn_images'):
                            continue  # 已有图片，跳过
                        _num = _ch.get('number', 0)
                        # 精确匹配 hymn_{number}[_或.后缀]，避免 hymn_1 误匹配 hymn_12
                        _pat = re.compile(r'^hymn_' + str(_num) + r'[_\.]')
                        _matched = [f'images/{f}' for f in hymn_files if _pat.match(f)]
                        if _matched:
                            _ch['hymn_images'] = _matched
                            _ch['hymn_image'] = _matched[0]
                            _need_write = True
                    if _need_write:
                        with open(_training_json, 'w', encoding='utf-8') as _f:
                            json.dump(_td, _f, ensure_ascii=False, indent=2)
                        print(f"  ✓ 从磁盘补充 hymn_images 引用")
                except Exception as _e:
                    print(f"  ⚠ hymn_images 回退补充失败: {_e}")
    else:
        print(f"  ⚠ 未找到诗歌补丁脚本: {_patch_hymn}")

    return {
        'name': batch_name,
        'year': meta.get('year', batch_config.get('year', 2025)),
        'season': meta.get('season', batch_config.get('season', '')),
        'title': meta.get('title', ''),
        'chapter_count': meta.get('chapter_count', 0),
        'path': safe_batch_name,
        'images': meta.get('images', []),
        'version': meta.get('version', ''),
    }


def process_batch(batch_folder, config, bible_dict: BibleDict = None):
    """
    处理单个批次的文档，生成 training.json。

    优先使用 TXT 文件（如存在）；无 TXT 时回退到 Word 文档解析。
    标语诗歌图片始终从批次文件夹中的图片文件获取（不依赖 Word）。

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

    # ── 优先检测 TXT 文件 ────────────────────────────────────────────────────
    # 1. 批次文件夹内直接有 .txt（最高优先级）
    txt_files = find_txt_files_in_folder(batch_folder)
    if txt_files:
        print(f"✓ 找到 TXT 文件（批次目录内，优先使用）: {os.path.basename(txt_files[0])}")
        return process_batch_txt(batch_folder, config, batch_config, safe_batch_name, txt_file=txt_files[0])

    # 2. 从 resource/历史合辑/ 中按 YYYY-MM 查找匹配的 TXT
    resource_dir = config.get('resource_dir', config.get('resource_base_dir', 'resource'))
    matched_txt = find_matching_txt_in_history(batch_name, resource_dir)
    if matched_txt:
        print(f"✓ 找到匹配的 TXT（历史合辑，优先使用）: {os.path.relpath(matched_txt, resource_dir)}")
        return process_batch_txt(batch_folder, config, batch_config, safe_batch_name, txt_file=matched_txt)

    # ── 回退到 Word 文档解析 ─────────────────────────────────────────────────
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

    # ── 合并已生成的历史训练（由 build-trainings-json.js 生成，不在 batch_results 中）──
    current_paths = {t['path'] for t in trainings}
    for entry in sorted(os.listdir(output_dir)):
        if not re.match(r'^\d{4}-\d{2}$', entry):
            continue
        if entry in current_paths:
            continue
        meta_path = os.path.join(output_dir, entry, 'training.json')
        if not os.path.exists(meta_path):
            continue
        try:
            with open(meta_path, 'r', encoding='utf-8') as f:
                meta = json.load(f)
            chapter_count = len(meta.get('chapters', []))
            images_dir = os.path.join(output_dir, entry, 'images')
            images = []
            if os.path.exists(images_dir):
                images = [f'images/{fn}' for fn in os.listdir(images_dir)
                          if fn.lower().endswith(('.png', '.jpg', '.jpeg', '.gif'))]
            trainings.append({
                'year': meta.get('year', int(entry[:4])),
                'season': meta.get('season', ''),
                'title': meta.get('title', ''),
                'subtitle': meta.get('subtitle', ''),
                'chapter_count': chapter_count,
                'path': entry,
                'images': images,
                'version': meta.get('version', ''),
                'is_collection': True,
            })
            total_chapters += chapter_count
            current_paths.add(entry)
        except Exception as e:
            print(f"⚠ 跳过历史训练 {entry}: {e}")

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
        # 注入 CX_MAX_LATEST_TRAININGS，使 PWA 与 APK 保持相同的「默认只缓存最新 N 个训练」行为
        _max_n = config.get('max_latest_trainings', 7)
        try:
            with open(spa_shell_dst, 'r', encoding='utf-8') as _f:
                _html = _f.read()
            _marker = "window.CX_ROOT = './';\n"
            _replacement = "window.CX_ROOT = './';\n    window.CX_MAX_LATEST_TRAININGS = " + str(_max_n) + ";\n"
            if _marker in _html and _replacement not in _html:
                _html = _html.replace(_marker, _replacement, 1)
            with open(spa_shell_dst, 'w', encoding='utf-8') as _f:
                _f.write(_html)
        except Exception as _e:
            print(f"⚠ 注入 CX_MAX_LATEST_TRAININGS 失败: {_e}")
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
    # 赞助二维码文件（仅在 sponsor_enabled 时发布）
    sponsor_enabled = config.get('sponsor_enabled', True)
    _SPONSOR_IMAGE_FILES = {'zanzhu-wx.png', 'zanzhu-zfb.jpg'}
    static_img_src = os.path.join('src', 'static', 'image')
    static_img_dst = os.path.join(output_dir, 'images')
    if os.path.exists(static_img_src):
        os.makedirs(static_img_dst, exist_ok=True)
        for fn in os.listdir(static_img_src):
            # 赞助关闭时跳过二维码图片
            if not sponsor_enabled and fn in _SPONSOR_IMAGE_FILES:
                continue
            src_f = os.path.join(static_img_src, fn)
            if os.path.isfile(src_f):
                shutil.copy2(src_f, os.path.join(static_img_dst, fn))
        print(f"✓ 静态图片已复制到 images/" + ('' if sponsor_enabled else '（赞助二维码已跳过）'))

    # 赞助关闭时，删除 output/images/ 中可能残留的旧二维码图片
    if not sponsor_enabled and os.path.isdir(static_img_dst):
        for fn in _SPONSOR_IMAGE_FILES:
            old = os.path.join(static_img_dst, fn)
            if os.path.isfile(old):
                os.remove(old)
                print(f"  ✗ 已删除旧赞助图片 images/{fn}")

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
        'search.js', 'image-utils.js', 'bookmark.js',
        # SPA-specific
        'ref-detector.js', 'training-enricher.js', 'router.js', 'renderer.js',
        # 本地 TXT 导入
        'txt-importer.js',
        # 历史资源包下载
        'resource-pack.js',
        # 并发竞速工具（多个场景共用）
        'race-fastest.js',
    ]
    for js_file in shared_js_files:
        src = os.path.join('src', 'static', 'js', js_file)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(js_dir, js_file))
    print(f"✓ 共享 JS 文件已复制到 js/")

    # ── remote-config.js ──────────────────────────────────────────────────
    remote_servers = config.get('remote_servers', {})
    if remote_servers:
        generate_remote_config_js(remote_servers, output_dir, sponsor_enabled)

    # ── Cloudflare Pages Functions middleware（时间段访问控制）──────────────
    generate_pages_middleware(config, project_root='.')

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

    # ── _redirects（Cloudflare Pages 重定向）─────────────────────────────
    redirects_src = os.path.join(template_dir, '_redirects')
    if os.path.exists(redirects_src):
        shutil.copy2(redirects_src, os.path.join(output_dir, '_redirects'))
        print(f"✓ _redirects 文件已复制")

    # ── changelog.json ────────────────────────────────────────────────────
    if os.path.exists('changelog.json'):
        shutil.copy2('changelog.json', os.path.join(output_dir, 'changelog.json'))
        print(f"✓ changelog.json 已复制")

    # ── .nojekyll ──────────────────────────────────────────────────────────
    with open(os.path.join(output_dir, '.nojekyll'), 'w') as f:
        f.write('')
    print(f"✓ .nojekyll 已创建")

    # ── 历史资源包 ────────────────────────────────────────────────────────
    generate_resource_packs(output_dir, trainings)

    index_path = os.path.join(output_dir, 'index.html')
    print(f"\n✓ SPA 主页已生成: {index_path}")


def generate_resource_packs(output_dir, all_trainings):
    """将历史训练分组打包成可下载的 ZIP 资源包，并生成 resource-packs.json 清单。

    分组策略：
    - 有图片的训练（由 Word 文档转换，访问时自然得到缓存）→ 单独列入 individuals，不打包
    - 其余历史训练 → 每 10 年一包，不打入图片文件
    - 包列表倒序排列（较新的在前）
    """
    import zipfile

    packs_dir = os.path.join(output_dir, 'resource-packs')
    os.makedirs(packs_dir, exist_ok=True)

    # 清理旧 zip，防止分组策略变化后出现僵尸包
    for _old in os.listdir(packs_dir):
        if _old.endswith('.zip'):
            os.remove(os.path.join(packs_dir, _old))

    def _has_images(path):
        img_dir = os.path.join(output_dir, path, 'images')
        return os.path.isdir(img_dir) and any(
            os.path.isfile(os.path.join(img_dir, f)) for f in os.listdir(img_dir)
        )

    # 有图片的训练 → individuals（访问页面时自然缓存，无需另行打包）
    # 无图片的训练 → 按 10 年分组打包
    sorted_trainings = sorted(
        [t for t in all_trainings if isinstance(t.get('year'), int)],
        key=lambda t: (t.get('year', 0), t.get('path', '')),
        reverse=True
    )
    individuals_raw = [t for t in sorted_trainings if _has_images(t.get('path', ''))]
    pack_trainings  = [t for t in sorted_trainings if not _has_images(t.get('path', ''))]

    # 构建 individuals 列表（轻量信息，无需下载链接）
    individuals = [
        {
            'path': t.get('path', ''),
            'title': t.get('title', ''),
            'season': t.get('season', ''),
            'year': t.get('year'),
            'chapter_count': t.get('chapter_count', 0),
        }
        for t in individuals_raw
    ]

    # 按 10 年分组历史训练（不打入图片）
    groups = {}  # year_start -> [training, ...]
    for t in pack_trainings:
        year = t.get('year')
        year_start = ((year - 1997) // 10) * 10 + 1997
        groups.setdefault(year_start, []).append(t)

    manifest_packs = []
    for year_start in sorted(groups.keys(), reverse=True):  # 倒序：较新的包在前
        group = groups[year_start]
        actual_years = [t['year'] for t in group if isinstance(t.get('year'), int)]
        actual_end = max(actual_years) if actual_years else year_start + 9
        pack_id = f'pack-{year_start}-{actual_end}'
        zip_name = f'{pack_id}.zip'
        zip_path = os.path.join(packs_dir, zip_name)

        # 构建 zip：打包每个训练文件夹，跳过图片文件
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED,
                             compresslevel=6, allowZip64=True) as zf:
            for t in group:
                path = t.get('path', '')
                training_dir = os.path.join(output_dir, path)
                if not os.path.isdir(training_dir):
                    continue
                for root_w, dirs, files in os.walk(training_dir):
                    for fn in files:
                        abs_path = os.path.join(root_w, fn)
                        rel_path = os.path.relpath(abs_path, output_dir)
                        arc_name = rel_path.replace(os.sep, '/')
                        # 跳过图片文件（images/ 目录），减小包体积
                        if '/images/' in arc_name.replace(os.sep, '/') or \
                                arc_name.replace(os.sep, '/').startswith('images/'):
                            continue
                        zf.write(abs_path, arc_name)

        size_bytes = os.path.getsize(zip_path)
        manifest_packs.append({
            'id': pack_id,
            'label': f'{year_start}–{actual_end} 年训练',
            'year_start': year_start,
            'year_end': actual_end,
            'training_count': len(group),
            'size_bytes': size_bytes,
            'path': f'resource-packs/{zip_name}',
            'trainings': [{'path': t['path'], 'chapter_count': t['chapter_count']} for t in group],
        })
        print(f"✓ 资源包已生成: {zip_name} "
              f"({len(group)} 训练, {size_bytes/1024/1024:.1f} MB, 不含图片)")

    # 写清单文件（包含 packs + individuals）
    manifest_path = os.path.join(output_dir, 'resource-packs.json')
    with open(manifest_path, 'w', encoding='utf-8') as f:
        json.dump({
            'version': datetime.now().strftime('%Y%m%d%H%M%S'),
            'packs': manifest_packs,
            'individuals': individuals,
        }, f, ensure_ascii=False, indent=2)
    print(f"✓ resource-packs.json 已生成 ({len(manifest_packs)} 个资源包, "
          f"{len(individuals)} 个独立训练)")


def main():
    """主函数"""
    import sys as _sys
    if hasattr(_sys.stdout, 'reconfigure'):
        try:
            _sys.stdout.reconfigure(encoding='utf-8', errors='replace')
            _sys.stderr.reconfigure(encoding='utf-8', errors='replace')
        except Exception:
            pass
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

    # ── 历史合辑：调用 build-trainings-json.js 生成 training.json ──
    _build_js = os.path.join(os.path.dirname(__file__), 'tools', 'build-trainings-json.js')
    if os.path.exists(_build_js):
        print("\n正在解析历史合辑（training.json）...")
        _split_ret = subprocess.run(
            ['node', _build_js],
            cwd=os.path.dirname(_build_js),
        )
        if _split_ret.returncode == 0:
            print("✓ 历史合辑 training.json 生成完成")
        else:
            print("⚠ 历史合辑 training.json 生成失败")

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
