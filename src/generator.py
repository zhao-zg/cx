# -*- coding: utf-8 -*-
"""
HTML生成器
"""
import os
import shutil
from jinja2 import Environment, FileSystemLoader
from .models import TrainingData, Chapter


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

        生成后的 HTML 默认以相对路径引用（例如 js/speech.js）。
        只复制训练页面需要的文件，不复制 icons、vendor 等主页专用资源。
        """
        try:
            static_dir = os.path.join(os.path.dirname(self.template_dir), 'static')
            if not os.path.isdir(static_dir):
                return

            # 训练页面需要的 JS 文件列表
            required_js_files = [
                'speech.js',
                'font-control.js',
                'highlight.js',
                'outline.js',
                'toc-redirect.js',
                'nav-stack.js'
            ]

            # 复制 js 目录中需要的文件
            js_src_dir = os.path.join(static_dir, 'js')
            js_dst_dir = os.path.join(self.output_dir, 'js')
            
            if os.path.isdir(js_src_dir):
                os.makedirs(js_dst_dir, exist_ok=True)
                for js_file in required_js_files:
                    src_file = os.path.join(js_src_dir, js_file)
                    dst_file = os.path.join(js_dst_dir, js_file)
                    if os.path.isfile(src_file):
                        shutil.copy2(src_file, dst_file)

                        
        except Exception:
            # 静态资源复制失败不应阻断 HTML 生成
            return
    
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
        if level_str in '壹贰叁肆伍陆柒捌玖拾':
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
    
    def generate_all(self, training_data: TrainingData):
        """
        生成所有HTML文件
        
        Args:
            training_data: 训练数据对象
        """
        # 生成首页
        self.generate_index(training_data)
        
        # 为每个篇章生成页面
        for chapter in training_data.chapters:
            self.generate_chapter_pages(chapter, training_data)
        
        print(f"✓ 已生成 {len(training_data.chapters)} 篇章的所有页面")
    
    def generate_index(self, training_data: TrainingData):
        """生成首页"""
        template = self.env.get_template('index.html')
        html = template.render(training=training_data.to_dict())
        
        output_path = os.path.join(self.output_dir, 'index.html')
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
