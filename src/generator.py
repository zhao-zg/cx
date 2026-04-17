# -*- coding: utf-8 -*-
"""
HTML生成器
"""
import os
import re
import shutil
from jinja2 import Environment, FileSystemLoader
from markupsafe import Markup, escape
from .models import TrainingData, Chapter
from .parser_improved import ImprovedParser


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
        self.env.filters['scripture_ref_wrap'] = self._wrap_scripture_ref
        self.env.filters['extract_refs'] = self._extract_verse_refs
        self.env.filters['feeding_to_refs'] = self._feeding_to_refs
        
        # 确保输出目录存在
        os.makedirs(output_dir, exist_ok=True)

        # 复制静态资源（js/css）到输出目录
        self._copy_static_assets()

    def _copy_static_assets(self):
        """复制 src/static 下的静态资源到输出目录。

        所有训练页面共用根目录下的 js/ 和 css/，以 ../js/ 和 ../css/ 相对路径引用。
        训练特定文件（scriptures-data.js）由 _generate_scriptures_data_js 单独生成到训练目录。
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
                'theme-toggle.js',
                'app-update.js',
                'font-control.js',
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
    
    def _feeding_to_refs(self, text: str) -> str:
        """从晨兴喂养段落开头的中文经文引用提取 data-refs 字符串。"""
        if not text:
            return ''
        m = re.match(r'^(\S+)', text.strip())
        if not m:
            return ''
        ref_part = m.group(1).rstrip('，、；。')
        refs = ImprovedParser._expand_cn_scripture_refs(ref_part)
        return ','.join(refs)

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
        """为 chapter_dict 中每个晨兴的 feeding_scriptures 预计算 feeding_refs 列表。"""
        chapter_scripture = chapter_dict.get('scripture', '')
        for revival in chapter_dict.get('morning_revivals', []):
            fs = revival.get('feeding_scriptures', [])
            revival['feeding_refs'] = self._compute_feeding_refs_list(fs, chapter_scripture)

    def _extract_verse_refs(self, scripture_text: str) -> str:
        """从经文全文中提取所有经文引用键，返回逗号分隔字符串。

        例如：
          "太5:3　灵里贫穷...\\n太5:8　清心的人..."
          -> "太5:3,太5:8"
        供 Jinja 模板中 extract_refs 过滤器使用，生成 data-refs 属性。
        """
        if not scripture_text:
            return ''
        _ref_re = re.compile(
            r'([创出利民申书士得撒王代拉尼斯伯诗箴传歌赛耶哀结但何珥摩俄拿弥鸿哈番该亚玛太可路约徒罗林加弗腓西帖提门多彼约犹启来]'
            r'(?:[一二三四五六七八九十后前上下壹贰叁]\d+|\d+):\d+[上下]?)'
        )
        refs = _ref_re.findall(scripture_text)
        # 去重同时保持顺序
        seen = set()
        unique = []
        for r in refs:
            if r not in seen:
                seen.add(r)
                unique.append(r)
        return ','.join(unique)

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
    
    # 破折号后紧跟「书卷缩写 + 章/节数字」或「章/节数字」，才视为经文引用分隔符
    # 要求书卷字（单字）之后必须紧跟章节数字，避免「耶稣基督」中的「耶」被误识为耶利米书
    _BOOK_CHARS = r'创出利民申书士得撒王代拉尼斯伯诗箴传歌赛耶哀结但何珥摩俄拿弥鸿哈番该亚玛太可路约徒罗林加弗腓西帖提门多彼犹启来'
    _SCRIPTURE_REF_START_RE = re.compile(
        r'^(?:参[看阅]?\s*)?'
        r'(?:'
        # 书卷名（单字）+ 可选修饰（前/后/上/下等）+ 必须紧跟章/节数字
        r'[创出利民申书士得撒王代拉尼斯伯诗箴传歌赛耶哀结但何珥摩俄拿弥鸿哈番该亚玛太可路约徒罗林加弗腓西帖提门多彼犹启来]'
        r'[后前上下壹贰叁]?'
        r'[一二三四五六七八九十百\d]'
        r'|'
        # 无书卷名，直接以章/节数字开头（相对章节引用）
        r'[一二三四五六七八九十百\d]'
        r')'
    )

    # 括号内容匹配（全角半角均支持）
    _PAREN_RE = re.compile(r'[（(〔]([^）)〕\n]{1,40})[）)〕]')

    def _wrap_scripture_ref(self, text: str, context_scripture: str = ''):
        """将纲目标题中的经文引用包裹在 <span class="scripture-ref"> 中。

        处理两类引用：
          1. 括号引用：（林后四10~12）（弗四23）（五26）— 从左到右扫描，传递 current_book
          2. 破折号引用：—腓四5： — 取最后一个以书卷/章号开头的破折号

        context_scripture: 该节的经文原文，用于初始化默认书卷名。
        """
        default_book = ImprovedParser._extract_primary_book(context_scripture) if context_scripture else ''
        default_chapter = ImprovedParser._extract_primary_chapter(context_scripture) if context_scripture else 0
        current_book = default_book
        current_chapter = default_chapter

        # ── 找破折号分割位置 ─────────────────────────────────────────
        split_pos = None
        for m in reversed(list(re.finditer(r'[—─]', text))):
            after = text[m.start() + 1:].strip()
            if re.search(r'\d', after) and self._SCRIPTURE_REF_START_RE.match(after):
                split_pos = m.start()
                break

        main_text = text[:split_pos] if split_pos is not None else text
        dash_ref_text = text[split_pos:] if split_pos is not None else ''

        # ── 扫描 main_text 中的括号引用 ──────────────────────────────
        parts = []
        last_end = 0
        for m in self._PAREN_RE.finditer(main_text):
            content = m.group(1)
            refs = ImprovedParser._expand_cn_scripture_refs(content, current_book, current_chapter)
            parts.append(str(escape(main_text[last_end:m.start()])))
            if refs:
                # 更新 current_book / current_chapter，但跨书引用不污染默认书卷上下文：
                # 若括号内含显式书卷名且与默认书卷不同（旁引），不更新 current_book；
                # 同时将 current_chapter 清零，避免后续纯节号误接到旁引的章节。
                new_bk = ''
                for ref in reversed(refs):
                    bk = ImprovedParser._extract_primary_book(ref)
                    if bk:
                        new_bk = bk
                        break
                if new_bk and new_bk != default_book:
                    # 旁引（跨书）：只用于本次括号，不传播给后续相对引用
                    current_chapter = 0
                elif new_bk:
                    current_book = new_bk
                    chap_m = re.search(r'(\d+):', refs[-1])
                    if chap_m:
                        current_chapter = int(chap_m.group(1))
                else:
                    # 无显式书名（纯节续），只更新章号
                    chap_m = re.search(r'(\d+):', refs[-1])
                    if chap_m:
                        current_chapter = int(chap_m.group(1))
                data_refs = ','.join(refs)
                span_text = str(escape(m.group(0)))
                parts.append(f'<span class="scripture-ref" data-refs="{data_refs}">{span_text}</span>')
            else:
                parts.append(str(escape(m.group(0))))
            last_end = m.end()
        parts.append(str(escape(main_text[last_end:])))

        # ── 处理破折号引用 ────────────────────────────────────────────
        if dash_ref_text:
            ref_body = dash_ref_text.lstrip('—─').strip()
            refs = ImprovedParser._expand_cn_scripture_refs(ref_body, current_book, current_chapter)
            data_refs = ','.join(refs) if refs else ''
            ref_escaped = str(escape(dash_ref_text))
            if data_refs:
                parts.append(f'<span class="scripture-ref" data-refs="{data_refs}">{ref_escaped}</span>')
            else:
                parts.append(f'<span class="scripture-ref">{ref_escaped}</span>')

        return Markup(''.join(parts))

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
        
        # 其他情况默认为 level-3
        return "level-3"
    
    # ------------------------------------------------------------------
    # 经文字典 JS 生成
    # ------------------------------------------------------------------

    # 与 parser_improved.py 中 VERSE_PATTERN 保持一致，直接用汉字避免 Unicode 转义错误
    _VERSE_LINE_RE = re.compile(
        r'^([创出利民申书士得撒王代拉尼斯伯诗箴传歌赛耶哀结但何珥摩俄拿弥鸿哈番该亚玛太可路约徒罗林加弗腓西帖提门多彼约犹启来]'
        r'(?:[一二三四五六七八九十后前上下壹贰叁]\d+|\d+):\d+[上下]?)[　\s\t]+(.+)'
    )

    def _collect_training_scriptures(self, training_data: TrainingData) -> dict:
        """\u904d\u5386\u8bad\u7ec3\u6570\u636e\u4e2d\u6240\u6709 scripture \u5b57\u6bb5\uff0c\u63d0\u53d6\u7ecf\u6587\u884c\u5e76\u5efa\u6210\u5b57\u5178\u3002

        Returns:
            dict 格\u5f0f\uff1a { "\u592a5:3": "\u592a5:3\u3000\u7075\u91cc\u8d2b\u7a77\u7684\u4eba\u6709\u798f\u4e86...", ... }
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
        """读取 output/js/bible-text.js 中所有经文 key，用于过滤补充数据。
        结果缓存在类变量中，同一进程内多个训练只解析一次。
        """
        if cls._bible_text_keys_cache is not None:
            return cls._bible_text_keys_cache
        path = os.path.join(output_root, 'js', 'bible-text.js')
        if not os.path.isfile(path):
            cls._bible_text_keys_cache = set()
            return cls._bible_text_keys_cache
        key_re = re.compile(r'"([^"\\]+)"\s*:')
        keys = set()
        with open(path, encoding='utf-8') as f:
            for line in f:
                for m in key_re.finditer(line):
                    keys.add(m.group(1))
        cls._bible_text_keys_cache = keys
        return keys

    @classmethod
    def _load_bible_text_data(cls, output_root: str) -> dict:
        """读取 bible-text.js 的完整键值对（带 {N}/[a] 标记），用于半节标记补全。"""
        if cls._bible_text_cache is not None:
            return cls._bible_text_cache
        import json as _json
        path = os.path.join(output_root, 'js', 'bible-text.js')
        if not os.path.isfile(path):
            cls._bible_text_cache = {}
            return cls._bible_text_cache
        data = {}
        obj_re = re.compile(r'Object\.assign\(window\.\w+,(\{.+\})\);\s*$')
        with open(path, encoding='utf-8') as f:
            for line in f:
                m = obj_re.search(line)
                if m:
                    try:
                        data.update(_json.loads(m.group(1)))
                    except Exception:
                        pass
        cls._bible_text_cache = data
        return data

    @staticmethod
    def _enrich_half_verse(half_text: str, full_marked: str, half_type: str):
        """从整节带标记文本中截取半节对应的带标记片段。

        half_text:   来自 Word 的半节纯文本（含 …… 截断标记）
        full_marked: bible-text.js 中整节文本（含 {N}/[a] 标记）
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
            content = re.sub(r'[\u2026\.]+\s*$', '', half_text).strip()
        else:
            content = re.sub(r'^\s*[\u2026\.]+', '', half_text).strip()
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
        else:
            # 从上一字符结束位置起（含为本字符服务的前导标记）到末尾
            marked_start = plain_to_marked[pos - 1] + 1 if pos > 0 else 0
            return full_marked[marked_start:]

    def _generate_scriptures_data_js(self, training_data: TrainingData):
        """生成 js/scriptures-data.js，仅包含全本圣经 bible-text.js 中没有的经文条目。"""
        scriptures = self._collect_training_scriptures(training_data)
        if not scriptures:
            return

        # ── 过滤：只保留全本圣经中没有的经文 ──────────────────────────
        output_root = os.path.normpath(os.path.join(self.output_dir, '..'))
        bible_keys = self._load_bible_text_keys(output_root)
        bible_data = self._load_bible_text_data(output_root)
        if bible_keys:
            total = len(scriptures)
            # 过滤整节已在 bible-text.js 的条目
            scriptures = {k: v for k, v in scriptures.items() if k not in bible_keys}
            # 对半节（上/下）用整节带标记文本补全 {N}/[a]，仍保留在 scriptures-data.js
            if bible_data:
                for k in list(scriptures.keys()):
                    if k and k[-1] in '上下':
                        full_marked = bible_data.get(k[:-1])
                        if full_marked:
                            enriched = self._enrich_half_verse(scriptures[k], full_marked, k[-1])
                            if enriched:
                                scriptures[k] = enriched
            filtered = total - len(scriptures)
            if filtered:
                print(f'  ℹ scriptures-data.js: 已过滤 {filtered} 条（全本圣经中已有），'
                      f'保留 {len(scriptures)} 条补充经文')

        js_dir = os.path.join(self.output_dir, 'js')
        os.makedirs(js_dir, exist_ok=True)
        js_path = os.path.join(js_dir, 'scriptures-data.js')

        if not scriptures:
            # 写空对象，避免 404，且不影响 bible-text.js 加载后的 CX_SCRIPTURES_DATA
            with open(js_path, 'w', encoding='utf-8') as f:
                f.write('/* scriptures-data.js: 无额外补充经文（全本圣经已覆盖） */\n')
            print(f'  ✓ scriptures-data.js 已生成（无补充经文）')
            return

        lines = ['window.CX_SCRIPTURES_DATA = window.CX_SCRIPTURES_DATA || {};']
        lines.append('Object.assign(window.CX_SCRIPTURES_DATA, {')
        items = sorted(scriptures.items())
        for i, (ref, text) in enumerate(items):
            ref_j = ref.replace('\\', '\\\\').replace('"', '\\"')
            text_j = (text.replace('\\', '\\\\')
                         .replace('"', '\\"')
                         .replace('\t', '\\t')
                         .replace('\n', '\\n')
                         .replace('\r', ''))
            comma = '' if i == len(items) - 1 else ','
            lines.append(f'  "{ref_j}": "{text_j}"{comma}')
        lines.append('});')

        with open(js_path, 'w', encoding='utf-8') as f:
            f.write('\n'.join(lines) + '\n')

        print(f'  ✓ scriptures-data.js 已生成: {len(scriptures)} 条补充经文')

    def generate_all(self, training_data: TrainingData):
        """
        生成所有HTML文件
        
        Args:
            training_data: 训练数据对象
        """
        # 生成目录页
        self.generate_index(training_data)
        
        # 生成标语页
        self.generate_motto(training_data)
        
        # 生成标语诗歌页（如果有图片）
        if training_data.motto_song_image:
            self.generate_motto_song(training_data)
        
        # 为每个篇章生成页面
        for chapter in training_data.chapters:
            self.generate_chapter_pages(chapter, training_data)
        
        # 生成内嵌经文数据 JS（解决 file:// 协议下 fetch 被 CORS 阻断的问题）
        self._generate_scriptures_data_js(training_data)
        
        print(f"✓ 已生成 {len(training_data.chapters)} 篇章的所有页面")
    
    def generate_index(self, training_data: TrainingData):
        """生成目录页"""
        template = self.env.get_template('index.html')
        html = template.render(training=training_data.to_dict())
        
        output_path = os.path.join(self.output_dir, 'index.html')
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(html)
    
    def generate_motto(self, training_data: TrainingData):
        """生成标语页"""
        template = self.env.get_template('motto.html')
        html = template.render(training=training_data.to_dict())
        
        output_path = os.path.join(self.output_dir, 'motto.htm')
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(html)
    
    def generate_motto_song(self, training_data: TrainingData):
        """生成标语诗歌页"""
        template = self.env.get_template('motto_song.html')
        html = template.render(training=training_data.to_dict())
        
        output_path = os.path.join(self.output_dir, 'motto_song.htm')
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(html)
    
    def generate_chapter_pages(self, chapter: Chapter, training_data: TrainingData):
        """
        生成单个篇章的所有页面
        
        Args:
            chapter: 篇章对象
            training_data: 训练数据（用于模板上下文）
        """
        num = chapter.number
        training_dict = training_data.to_dict()
        chapter_dict = chapter.to_dict()
        self._enrich_chapter_feeding_refs(chapter_dict)

        # 生成纲目页（_cv.htm）- 默认全部展开（经文不展开）
        self._generate_outline_page(num, chapter_dict, training_dict, collapsed=False, filename_suffix='cv', page_name='纲目')
        
        # 生成经文页（_jw.htm）- 已禁用
        # self._generate_scripture_page(num, chapter_dict, training_dict)
        
        # 生成诗歌页（_sg.htm）
        self._generate_hymn_page(num, chapter_dict, training_dict)
        
        # 生成晨兴页（_cx.htm）
        self._generate_morning_revival_page(num, chapter_dict, training_dict)
        
        # 生成职事信息摘录页（_zs.htm）
        self._generate_ministry_page(num, chapter_dict, training_dict)
        
        # 生成详情页（_ts.htm）- 详细内容
        self._generate_details_page(num, chapter_dict, training_dict)
        
        # 生成听抄页（_h.htm）- 职事信息
        self._generate_message_page(num, chapter_dict, training_dict)
    
    def _generate_outline_page(self, num: int, chapter: dict, training: dict, collapsed: bool = False, filename_suffix: str = 'cv', page_name: str = '纲目'):
        """生成纲目页（可配置初始展开状态）
        
        Args:
            num: 篇章编号
            chapter: 篇章数据
            training: 训练数据
            collapsed: 是否默认收起（True=收起，False=展开）
            filename_suffix: 文件名后缀（dg或cv）
            page_name: 页面名称（用于日志）
        """
        template = self.env.get_template('outline.html')
        html = template.render(chapter=chapter, training=training, default_collapsed=collapsed, page_type=filename_suffix)
        
        filename = f'{num}_{filename_suffix}.htm'
        output_path = os.path.join(self.output_dir, filename)
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(html)
    
    def _generate_ministry_page(self, num: int, chapter: dict, training: dict):
        """生成职事信息摘录页（_zs.htm）"""
        template = self.env.get_template('ministry.html')
        html = template.render(chapter=chapter, training=training, page_type='zs')
        
        filename = f'{num}_zs.htm'
        output_path = os.path.join(self.output_dir, filename)
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(html)
    
    def _generate_scripture_page(self, num: int, chapter: dict, training: dict):
        """生成经文页（_jw.htm）"""
        template = self.env.get_template('scripture.html')
        html = template.render(chapter=chapter, training=training)
        
        filename = f'{num}_jw.htm'
        output_path = os.path.join(self.output_dir, filename)
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(html)
    
    def _generate_hymn_page(self, num: int, chapter: dict, training: dict):
        """生成诗歌页（_sg.htm）"""
        template = self.env.get_template('hymn.html')
        html = template.render(chapter=chapter, training=training, page_type='sg')
        
        filename = f'{num}_sg.htm'
        output_path = os.path.join(self.output_dir, filename)
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(html)
    
    def _generate_morning_revival_page(self, num: int, chapter: dict, training: dict):
        """生成晨兴页（_cx.htm）"""
        template = self.env.get_template('morning_revival.html')
        html = template.render(chapter=chapter, training=training, page_type='cx')
        
        filename = f'{num}_cx.htm'
        output_path = os.path.join(self.output_dir, filename)
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(html)
    
    def _generate_details_page(self, num: int, chapter: dict, training: dict):
        """生成详情页（_ts.htm）- 显示详细内容"""
        template = self.env.get_template('details.html')
        html = template.render(chapter=chapter, training=training, page_type='ts')
        
        filename = f'{num}_ts.htm'
        output_path = os.path.join(self.output_dir, filename)
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(html)
    
    def _generate_message_page(self, num: int, chapter: dict, training: dict):
        """生成听抄页（_h.htm）- 显示职事信息"""
        template = self.env.get_template('message.html')
        html = template.render(chapter=chapter, training=training, page_type='h')
        
        filename = f'{num}_h.htm'
        output_path = os.path.join(self.output_dir, filename)
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(html)
