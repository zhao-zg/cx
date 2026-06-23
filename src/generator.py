# -*- coding: utf-8 -*-
"""
HTML生成器
"""
import json
import os
import re
import shutil
from jinja2 import Environment, FileSystemLoader
from .models import TrainingData, Chapter
from .parser_improved import ImprovedParser


def _normalize_source_abbr(text: str) -> str:
    """将出处引用中的中文书名替换为英文缩写：
    - 李常受文集 → CWWL
    - 生命读经   → L-S
    """
    return text.replace('李常受文集', 'CWWL').replace('生命读经', 'L-S')


class HTMLGenerator:
    """HTML生成器"""
    
    def __init__(self, template_dir: str, output_dir: str):
        """
        初始化生成器
        
        Args:
            template_dir: 模板目录路径
            output_dir: 输出目录路径
        """
        self.template_dir = template_dir
        self.output_dir = output_dir
        self.env = Environment(loader=FileSystemLoader(template_dir))
        
        # 添加自定义过滤器
        self.env.filters['extract_day'] = self._extract_day_name
        self.env.filters['outline_level_class'] = self._get_outline_level_class
        
        # 确保输出目录存在
        os.makedirs(output_dir, exist_ok=True)

        # 复制静态资源（js/css）到输出目录
        self._copy_static_assets()

    def _copy_static_assets(self):
        """复制 src/static 下的静态资源到输出目录。

        所有训练页面共用根目录下的 js/ 和 css/，以 ../js/ 和 ../css/ 相对路径引用。
        训练特定文件（scriptures-data.json）由 _generate_scriptures_data_json 单独生成到训练目录。
        """
        try:
            static_dir = os.path.join(os.path.dirname(self.template_dir), 'static')
            if not os.path.isdir(static_dir):
                return

            # 共享 JS 文件列表（所有训练通用）
            shared_js_files = [
                'bible-dict.js',
                'speech.js',
                'highlight.js',
                'outline.js',
                'scripture-popup.js',
                'toc-redirect.js',
                'nav-stack.js',
                'image-utils.js',
                'dev-console.js',
                'theme-toggle.js',
                'race-fastest.js',
                'app-update.js',
                'font-control.js',
                'search.js',
            ]

            # 复制到根输出目录的 js/（训练目录的上级）
            js_src_dir = os.path.join(static_dir, 'js')
            root_output = os.path.normpath(os.path.join(self.output_dir, '..'))
            js_dst_dir = os.path.join(root_output, 'js')

            if os.path.isdir(js_src_dir):
                os.makedirs(js_dst_dir, exist_ok=True)
                for js_file in shared_js_files:
                    src_file = os.path.join(js_src_dir, js_file)
                    dst_file = os.path.join(js_dst_dir, js_file)
                    if os.path.isfile(src_file):
                        shutil.copy2(src_file, dst_file)

            # 复制 CSS 到根输出目录的 css/
            css_src_dir = os.path.join(static_dir, 'css')
            css_dst_dir = os.path.join(root_output, 'css')

            if os.path.isdir(css_src_dir):
                os.makedirs(css_dst_dir, exist_ok=True)
                for css_file in os.listdir(css_src_dir):
                    if css_file.endswith('.css'):
                        src_file = os.path.join(css_src_dir, css_file)
                        dst_file = os.path.join(css_dst_dir, css_file)
                        shutil.copy2(src_file, dst_file)

            # 复制 image/ 到根输出目录的 images/
            img_src_dir = os.path.join(static_dir, 'image')
            img_dst_dir = os.path.join(root_output, 'images')

            if os.path.isdir(img_src_dir):
                os.makedirs(img_dst_dir, exist_ok=True)
                for img_file in os.listdir(img_src_dir):
                    src_file = os.path.join(img_src_dir, img_file)
                    dst_file = os.path.join(img_dst_dir, img_file)
                    if os.path.isfile(src_file):
                        shutil.copy2(src_file, dst_file)

        except Exception as e:
            # 静态资源复制失败不应阻断 HTML 生成
            pass
    
    def _compute_feeding_refs_list(self, scriptures: list, chapter_scripture: str) -> list:
        """为喂养经文列表计算 data-refs，上下文在条目间传播（同书同章）。"""
        cur_book = ImprovedParser._extract_primary_book(chapter_scripture)
        cur_chapter = ImprovedParser._extract_primary_chapter(chapter_scripture)
        result = []
        for text in scriptures:
            m = re.match(r'^(\S+)', text.strip())
            ref_part = m.group(1).rstrip('，、；。') if m else ''
            refs = ImprovedParser._expand_cn_scripture_refs(ref_part, cur_book, cur_chapter)
            if refs:
                # 从最后一个 ref 更新上下文
                last_ref = refs[-1]
                bm = re.match(r'^(.+?)(\d+):(\d+)', last_ref)
                if bm:
                    cur_book = bm.group(1)
                    cur_chapter = int(bm.group(2))
            result.append(','.join(refs))
        return result

    def _enrich_chapter_feeding_refs(self, chapter_dict: dict):
        """为 chapter_dict 中每个晨读的 feeding_scriptures 预计算 feeding_refs 列表。"""
        chapter_scripture = chapter_dict.get('scripture', '')
        for revival in chapter_dict.get('morning_revivals', []):
            fs = revival.get('feeding_scriptures', [])
            revival['feeding_refs'] = self._compute_feeding_refs_list(fs, chapter_scripture)

    def _extract_day_name(self, day_str: str) -> str:
        """
        从完整的日期字符串中提取星期几
        例如: "第一周 • 周一" -> "周一"
        
        Args:
            day_str: 完整的日期字符串
            
        Returns:
            星期几部分
        """
        if '•' in day_str:
            return day_str.split('•')[1].strip()
        return day_str
    
    def _get_outline_level_class(self, level_str: str) -> str:
        """
        根据纲目序号判断应该使用的CSS类名
        
        Args:
            level_str: 纲目序号,如"壹","一","1","a","I","II","A","B"等
            
        Returns:
            CSS类名: "level-1", "level-2", "level-3", 或 "level-4"
        """
        if not level_str:
            return "level-1"
        
        level_str = level_str.strip()
        
        # 壹贰叁肆伍陆柒捌玖拾 -> level-1 (大纲)
        if all(c in '壹贰叁肆伍陆柒捌玖拾' for c in level_str):
            return "level-1"
        
        # 罗马数字 I II III IV V VI VII VIII IX X -> level-1 (大纲)
        if level_str.upper() in ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']:
            return "level-1"
        
        # 大写字母 A B C D E F G H I J -> level-1 (大纲)
        if len(level_str) == 1 and level_str.isupper() and level_str.isalpha():
            return "level-1"
        
        # 一二三四五六七八九十百 -> level-2 (中纲)
        if all(c in '一二三四五六七八九十百' for c in level_str):
            return "level-2"
        
        # 数字 1 2 3 4 -> level-3 (小纲)
        if level_str.isdigit():
            return "level-3"
        
        # 小写字母 a b c d e -> level-4 (细纲)
        if len(level_str) == 1 and level_str.islower() and level_str.isalpha():
            return "level-4"

        # 括号数字 ㈠㈡㈢ -> level-5 (更细纲)
        if level_str in '㈠㈡㈢㈣㈤㈥㈦㈧㈨㈩' or (len(level_str) == 1 and '\u3220' <= level_str <= '\u3229'):
            return "level-5"
        
        # 其他情况默认为 level-3
        return "level-3"
    
    # ------------------------------------------------------------------
    # 经文字典 JS 生成
    # ------------------------------------------------------------------

    # 与 parser_improved.py 中 VERSE_PATTERN 保持一致，直接用汉字避免 Unicode 转义错误
    _VERSE_LINE_RE = re.compile(
        r'^([创出利民申书士得撒王代拉尼斯伯诗箴传歌赛耶哀结但何珥摩俄拿弥鸿哈番该亚玛太可路约徒罗林加弗腓西帖提门多彼约犹启来]'
        r'(?:[一二三四五六七八九十后前上下壹贰叁]\d+|\d+):\d+[上中下]?)[　\s\t]+(.+)'
    )

    def _collect_training_scriptures(self, training_data: TrainingData) -> dict:
        """遍历训练数据中所有 scripture 字段，提取经文行并建成字典。

        Returns:
            dict 格式： { "太5:3": "太5:3　灵里贫穷的人有福了...", ... }
        """
        verse_re = self._VERSE_LINE_RE
        scriptures = {}

        def collect_text(text: str):
            if not text:
                return
            for line in text.split('\n'):
                line = line.strip()
                m = verse_re.match(line)
                if m and m.group(1) not in scriptures:
                    scriptures[m.group(1)] = m.group(2)  # 只存文本，不含 key\t 前缀

        def collect_sections(sections):
            for s in sections:
                collect_text(s.scripture)
                for para in s.content:
                    collect_text(para)
                collect_sections(s.children)

        for ch in training_data.chapters:
            collect_text(ch.scripture_verses)
            collect_sections(ch.outline_sections)
            collect_sections(ch.detail_sections)
            for revival in ch.morning_revivals:
                collect_sections(revival.outline)
                for fs in revival.feeding_scriptures:
                    collect_text(fs)

        return scriptures

    _bible_text_keys_cache: set = None   # 类级缓存，避免每个训练重复解析
    _bible_text_cache: dict = None        # 类级缓存（带 {N}/[a] 标记的完整数据）

    @classmethod
    def _load_bible_text_keys(cls, output_root: str) -> set:
        """读取 output/data/bible-text.json 中所有经文 key，用于过滤补充数据。
        结果缓存在类变量中，同一进程内多个训练只解析一次。
        """
        if cls._bible_text_keys_cache is not None:
            return cls._bible_text_keys_cache
        path = os.path.join(output_root, 'data', 'bible-text.json')
        if not os.path.isfile(path):
            cls._bible_text_keys_cache = set()
            return cls._bible_text_keys_cache
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        cls._bible_text_keys_cache = set(data.keys())
        return cls._bible_text_keys_cache

    @classmethod
    def _load_bible_text_data(cls, output_root: str) -> dict:
        """读取 bible-text.json 的完整键值对（带 {N}/[a] 标记），用于半节标记补全。"""
        if cls._bible_text_cache is not None:
            return cls._bible_text_cache
        path = os.path.join(output_root, 'data', 'bible-text.json')
        if not os.path.isfile(path):
            cls._bible_text_cache = {}
            return cls._bible_text_cache
        with open(path, encoding='utf-8') as f:
            cls._bible_text_cache = json.load(f)
        return cls._bible_text_cache

    @staticmethod
    def _enrich_half_verse(half_text: str, full_marked: str, half_type: str):
        """从整节带标记文本中截取半节对应的带标记片段。

        half_text:   来自 Word 的半节纯文本（含 …… 截断标记）
        full_marked: bible-text.json 中整节文本（含 {N}/[a] 标记）
        half_type:   '上' 或 '下'
        返回带标记的半节文本，无法匹配时返回 None。
        """
        _MARKER = re.compile(r'\{\d+\}|\[[a-z]+\]')
        # 构建 plain_to_marked[i] = i-th 纯文本字符在 full_marked 中的位置
        plain_to_marked = []
        i = 0
        while i < len(full_marked):
            m = _MARKER.match(full_marked, i)
            if m:
                i = m.end()
            else:
                plain_to_marked.append(i)
                i += 1
        full_plain = ''.join(full_marked[j] for j in plain_to_marked)

        # 剥离 …… 截断标记，得到需要在整节中匹配的纯文字
        if half_type == '上':
            content = re.sub(r'[…\.]+\s*$', '', half_text).strip()
        elif half_type == '下':
            content = re.sub(r'^\s*[…\.]+', '', half_text).strip()
        else:  # 中
            content = re.sub(r'^\s*[…\.]+', '', half_text).strip()
            content = re.sub(r'[…\.]+\s*$', '', content).strip()
        if not content:
            return None

        pos = full_plain.find(content)
        if pos == -1:
            return None
        end_pos = pos + len(content)

        if half_type == '上':
            # 从 full_marked 起始（含首部标记）到最后一个内容字符
            marked_end = plain_to_marked[end_pos - 1] + 1
            return full_marked[:marked_end]
        elif half_type == '下':
            # 从上一字符结束位置起（含为本字符服务的前导标记）到末尾
            marked_start = plain_to_marked[pos - 1] + 1 if pos > 0 else 0
            return full_marked[marked_start:]
        else:  # 中
            # 截取对应区间（含两端可能紧邻的标记）
            marked_start = plain_to_marked[pos - 1] + 1 if pos > 0 else 0
            marked_end = plain_to_marked[end_pos - 1] + 1
            return full_marked[marked_start:marked_end]

    def _generate_scriptures_data_json(self, training_data: TrainingData):
        """生成 js/scriptures-data.json，仅包含全本圣经 bible-text.json 中没有的经文条目。"""
        scriptures = self._collect_training_scriptures(training_data)
        if not scriptures:
            return

        # ── 过滤：只保留全本圣经中没有的经文 ──────────────────────────
        output_root = os.path.normpath(os.path.join(self.output_dir, '..'))
        bible_keys = self._load_bible_text_keys(output_root)
        bible_data = self._load_bible_text_data(output_root)
        if bible_keys:
            total = len(scriptures)
            # 过滤整节已在 bible-text.json 的条目
            scriptures = {k: v for k, v in scriptures.items() if k not in bible_keys}
            # 对半节（上/中/下）用整节带标记文本补全 {N}/[a]，仍保留在 scriptures-data.json
            if bible_data:
                for k in list(scriptures.keys()):
                    if k and k[-1] in '上中下':
                        full_marked = bible_data.get(k[:-1])
                        if full_marked:
                            enriched = self._enrich_half_verse(scriptures[k], full_marked, k[-1])
                            if enriched:
                                scriptures[k] = enriched
            filtered = total - len(scriptures)
            if filtered:
                print(f'  ℹ scriptures-data.json: 已过滤 {filtered} 条（全本圣经中已有），'
                      f'保留 {len(scriptures)} 条补充经文')

        js_dir = os.path.join(self.output_dir, 'js')
        os.makedirs(js_dir, exist_ok=True)
        json_path = os.path.join(js_dir, 'scriptures-data.json')

        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(scriptures, f, ensure_ascii=False, separators=(',', ':'))

        if not scriptures:
            print(f'  ✓ scriptures-data.json 已生成（无补充经文）')
        else:
            print(f'  ✓ scriptures-data.json 已生成: {len(scriptures)} 条补充经文')


# ---------------------------------------------------------------------------
# 搜索索引生成（模块级函数，需在所有 HTML 生成完毕后调用）
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# JSON Export (SPA mode)
# ---------------------------------------------------------------------------

def export_training_json(training_data, output_dir: str) -> str:
    """Export training data as training.json for the SPA renderer.

    Generates:
      output_dir/training.json        — full training data with precomputed contexts
      output_dir/js/scriptures-data.json — supplementary verse texts not in bible-text.json

    Returns: version string (timestamp) written into training.json
    """
    os.makedirs(output_dir, exist_ok=True)

    # Create a minimal HTMLGenerator-like object to reuse enrichment/scripture methods
    gen = HTMLGenerator.__new__(HTMLGenerator)
    gen.output_dir = output_dir

    # Build full training dict. Section ctx is no longer pre-computed; the JS
    # renderer passes chapter.scripture as fallback context to wrapRefs().
    training_dict = training_data.to_dict()

    # Enrich with feeding_refs — stored as pure text strings in JSON, used by JS renderer.
    # Section contexts (morning_feeding_contexts, message_reading_contexts) are now
    # computed at render time in renderer.js using scanCtxBox().
    for ch_dict in training_dict.get('chapters', []):
        gen._enrich_chapter_feeding_refs(ch_dict)

    from datetime import datetime as _dt
    version = _dt.now().strftime('%Y%m%d%H%M%S')
    training_dict['version'] = version

    # Write training.json (compact, no indent)
    json_path = os.path.join(output_dir, 'training.json')
    with open(json_path, 'w', encoding='utf-8') as f:
        json_text = json.dumps(training_dict, ensure_ascii=False, separators=(',', ':'))
        f.write(_normalize_source_abbr(json_text))
    print(f"  ✓ training.json 已写出 ({len(training_data.chapters)} 篇章)")

    # Write supplementary scripture data (for popup, excludes bible-text.json entries)
    try:
        gen._generate_scriptures_data_json(training_data)
    except Exception as e:
        print(f"  ⚠ scriptures-data.json 生成失败: {e}")

    return version


def generate_search_index_from_json(output_root: str, trainings: list) -> None:
    """Build search-index.json by reading training.json files (SPA mode).

    Replaces generate_search_index() which relied on parsed HTML files.
    URL format: '{path}/{num}/{view}' (hash-routable in the SPA).
    """
    from datetime import datetime as _dt

    TYPE_MAP = [
        ('h',  '听抄',   lambda ch: ch.get('message_content', [])),
        ('ts', '详情',   None),   # sections — handled separately
        ('cv', '纲目',   None),   # sections — handled separately
        ('zs', '职事摘录', lambda ch: [ch.get('ministry_excerpt', '')] if ch.get('ministry_excerpt') else []),
    ]

    def flatten_sections(sections, buf):
        for sec in sections:
            t = (sec.get('level', '') + ' ' + sec.get('title', '')).strip()
            if t:
                buf.append(t)
            for para in sec.get('content', []):
                if para:
                    buf.append(para)
            flatten_sections(sec.get('children', []), buf)

    def flatten_sections_content_only(sections, buf):
        """ts 视图专用：只收内容段落，跳过标题。
        DOM 中标题渲染为 .section-levelN，内容才是 .content-text，
        pi 必须只计内容段才能与 querySelectorAll('.content-text') 对齐。
        """
        for sec in sections:
            for para in sec.get('content', []):
                if para:
                    buf.append(para)
            flatten_sections_content_only(sec.get('children', []), buf)

    entries = []
    total_files = 0

    for training in trainings:
        path          = training.get('path', '')
        title         = training.get('title', '')
        year          = training.get('year', '')
        season        = training.get('season', '')
        season_label  = f"{year}-{season}" if year and season else path

        json_path = os.path.join(output_root, path, 'training.json')
        if not os.path.isfile(json_path):
            continue

        total_files += 1
        with open(json_path, encoding='utf-8') as f:
            tdata = json.load(f)

        for chapter in tdata.get('chapters', []):
            num = chapter.get('number', 0)
            ch_title = f"第{num}篇 {chapter.get('title', '')}"

            # message content (h)
            for pi, para in enumerate(chapter.get('message_content', [])):
                if len(para) >= 10:
                    entries.append({'url': f"{path}/{num}/h", 'training': title,
                                    'season_label': season_label, 'chapter': num,
                                    'type': 'h', 'type_label': '听抄',
                                    'chapter_title': ch_title, 'pi': pi,
                                    'selector': 'content-text', 'text': para[:200]})

            # outline sections (cv)
            cv_buf = []; flatten_sections(chapter.get('outline_sections', []), cv_buf)
            for pi, para in enumerate(cv_buf):
                if len(para) >= 10:
                    entries.append({'url': f"{path}/{num}/cv", 'training': title,
                                    'season_label': season_label, 'chapter': num,
                                    'type': 'cv', 'type_label': '纲目',
                                    'chapter_title': ch_title, 'pi': pi,
                                    'selector': 'outline-item', 'text': para[:200]})

            # morning revival (cx) — day_index 记录第几天，前端在对应 day-page 内按 pi 定位
            # DOM 顺序：morning_feeding(.content-text) → message_reading(.content-text)
            for day_idx, revival in enumerate(chapter.get('morning_revivals', [])):
                mf = revival.get('morning_feeding', [])
                for pi, para in enumerate(mf):
                    if len(para) >= 10:
                        entries.append({'url': f"{path}/{num}/cx", 'training': title,
                                        'season_label': season_label, 'chapter': num,
                                        'type': 'cx', 'type_label': '晨兴喂养',
                                        'chapter_title': ch_title, 'pi': pi,
                                        'day_index': day_idx,
                                        'selector': 'content-text', 'text': para[:200]})
                mf_len = len(mf)
                for mri, para in enumerate(revival.get('message_reading', [])):
                    if len(para) >= 10:
                        entries.append({'url': f"{path}/{num}/cx", 'training': title,
                                        'season_label': season_label, 'chapter': num,
                                        'type': 'cx', 'type_label': '信息选读',
                                        'chapter_title': ch_title, 'pi': mf_len + mri,
                                        'day_index': day_idx,
                                        'selector': 'content-text', 'text': para[:200]})

            # ministry excerpt (zs)
            zs_text = chapter.get('ministry_excerpt', '')
            if len(zs_text) >= 10:
                entries.append({'url': f"{path}/{num}/zs", 'training': title,
                                'season_label': season_label, 'chapter': num,
                                'type': 'zs', 'type_label': '职事摘录',
                                'chapter_title': ch_title, 'pi': 0,
                                'selector': 'content-text', 'text': zs_text[:200]})

    index_data = {
        'version': _dt.now().strftime('%Y%m%d%H%M%S'),
        'count':   len(entries),
        'entries': entries,
    }
    out_path = os.path.join(output_root, 'data', 'search-index.json')
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as fh:
        json.dump(index_data, fh, ensure_ascii=False, separators=(',', ':'))
    print(f"✓ search-index.json 已生成: {len(entries)} 条索引（{total_files} 个 training.json）")
