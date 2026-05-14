# -*- coding: utf-8 -*-
"""
数据模型定义
"""
from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class Content:
    """内容节点基类"""
    level: str  # 层级标识：壹、一、1、a等
    title: str  # 标题文本
    scripture: str = ""  # 经文引用
    content: List[str] = field(default_factory=list)  # 正文段落
    children: List['Content'] = field(default_factory=list)  # 子节点
    
    def add_content(self, text: str):
        """添加正文段落"""
        if text and text.strip():
            self.content.append(text.strip())
    
    def add_child(self, child: 'Content'):
        """添加子节点"""
        self.children.append(child)


@dataclass
class MorningRevival:
    """晨读内容（按天）"""
    day: str  # 周一、周二...
    outline: List[Content] = field(default_factory=list)  # 大纲部分
    feeding_scriptures: List[str] = field(default_factory=list)  # 晨兴喂养的经文部分
    morning_feeding: List[str] = field(default_factory=list)  # 晨兴喂养
    message_reading: List[str] = field(default_factory=list)  # 信息选读
    ref_reading: List[str] = field(default_factory=list)  # 参读


@dataclass
class Chapter:
    """篇章"""
    number: int  # 篇章编号 1-9
    title: str  # 标题
    outline_sections: List[Content] = field(default_factory=list)  # 纲目结构(仅标题,来自经文.docx)
    detail_sections: List[Content] = field(default_factory=list)  # 详细内容(带段落,来自听抄.docx)
    hymn_number: str = ""  # 诗歌编号（如：JL 诗歌：748）
    hymn_image: str = ""  # 诗歌图片路径（相对于output目录，向后兼容保留第一张图）
    hymn_images: List[str] = field(default_factory=list)  # 诗歌图片列表（支持多张）
    scripture: str = ""  # 经文引用（读经经文）
    scripture_verses: str = ""  # 经文内容（经文正文）
    message_content: List[str] = field(default_factory=list)  # 职事信息内容（来自听抄.docx末尾）
    ministry_excerpt: str = ""  # 职事信息摘录（来自经文.docx）
    morning_revivals: List[MorningRevival] = field(default_factory=list)  # 晨读（来自晨读.doc）
    _day_outlines: dict = field(default_factory=dict)  # 内部使用：按天存储的大纲数据
    
    def add_outline_section(self, section: Content):
        """添加纲目节点"""
        self.outline_sections.append(section)
    
    def add_detail_section(self, section: Content):
        """添加详细内容节点"""
        self.detail_sections.append(section)
    
    def to_dict(self):
        """转换为字典，便于模板渲染"""
        outline_sections = self._sections_to_dict(self.outline_sections)
        detail_sections = self._sections_to_dict(self.detail_sections)

        mr_dicts = [
            self._build_morning_revival_dict(mr)
            for mr in self.morning_revivals
        ]

        return {
            'number': self.number,
            'title': self.title,
            'hymn_number': self.hymn_number,
            'hymn_image': self.hymn_image,
            'hymn_images': self.hymn_images if self.hymn_images else ([self.hymn_image] if self.hymn_image else []),
            'scripture': self.scripture,
            'outline_sections': outline_sections,
            'detail_sections': detail_sections,
            'message_content': self.message_content,
            'ministry_excerpt': self.ministry_excerpt,
            'morning_revivals': mr_dicts,
        }
    
    def _build_morning_revival_dict(self, mr):
        """构建单天晨读字典。"""
        outline = self._sections_to_dict(mr.outline)
        fs, mf = self._extract_feeding_scriptures(mr.morning_feeding)
        return {
            'day': mr.day,
            'outline': outline,
            'feeding_scriptures': fs,
            'morning_feeding': mf,
            'message_reading': mr.message_reading,
            'ref_reading': mr.ref_reading
        }

    def _extract_feeding_scriptures(self, paragraphs: List[str]) -> tuple:
        """
        从晨兴喂养段落中分离经文
        
        Returns:
            (scriptures, content) 元组
        """
        import re
        scriptures = []
        content = []
        
        # 经文格式1：完整格式（书卷+章节）
        # 匹配：路十一11 或 路十一11~13 或 约壹一6~7 或 林后十三14
        # 书卷名：1-2个字（如：路、约壹、林后）
        full_pattern = re.compile(r'^[创出利民申书士得撒王代拉尼斯伯诗箴传歌赛耶哀结但何珥摩俄拿弥鸿哈番该亚玛太可路约徒罗林加弗腓西帖提多门彼雅犹启壹贰叁前后来]{1,2}[一二三四五六七八九十\d]+[:：]?\d+([~～\-]\d+)?[\s　]+')
        
        # 经文格式2：省略书卷名（只有章节，第二处经文可能省略书卷名）
        # 匹配：二1 或 十三14 或 二二1
        short_pattern = re.compile(r'^[一二三四五六七八九十\d]+[:：]?\d+([~～\-]\d+)?[\s　]+')
        
        # 经文格式3：只有节号（同一章的不同节）
        # 匹配：5 或 11 或 13~15（开头是数字+空格）
        verse_pattern = re.compile(r'^\d+([~～\-]\d+)?[\s　]+')
        
        # 经文段落的最大长度（超过这个长度可能包含了正文内容）
        MAX_SCRIPTURE_LENGTH = 800
        
        for i, para in enumerate(paragraphs):
            # 检查是否匹配经文格式
            if (full_pattern.match(para) or short_pattern.match(para) or verse_pattern.match(para)):
                # 如果段落太长，可能包含了正文，需要分割
                if len(para) > MAX_SCRIPTURE_LENGTH:
                    # 尝试在段落中找到经文结束的位置
                    # 通常经文后面会有"……"或者明显的正文开始标志
                    split_markers = ['……但', '……然而', '……可是', '……这', '……那', '耶稣生在']
                    split_pos = -1
                    for marker in split_markers:
                        pos = para.find(marker)
                        if pos > 0:
                            split_pos = pos
                            break
                    
                    if split_pos > 0:
                        # 分割段落：前半部分是经文，后半部分是正文
                        scripture_part = para[:split_pos].strip()
                        content_part = para[split_pos:].strip()
                        scriptures.append(scripture_part)
                        # 将剩余部分和后续段落作为正文
                        content = [content_part] + paragraphs[i+1:]
                        break
                    else:
                        # 无法分割，整段作为经文（可能是真的很长的经文）
                        scriptures.append(para)
                else:
                    scriptures.append(para)
            else:
                # 一旦遇到非经文段落，后面的都是正文
                content = paragraphs[i:]
                break
        
        return (scriptures, content)
    
    def _sections_to_dict(self, contents: List[Content]):
        """递归转换内容节点为字典"""
        result = []
        for content in contents:
            content_dict = {
                'level': content.level,
                'title': content.title,
                'content': content.content,
                'children': self._sections_to_dict(content.children)
            }
            result.append(content_dict)
        return result

    @staticmethod
    def _extract_ref_keys(scripture_text):
        """从 '腓4:5\\t经文正文\\n腓4:6\\t经文正文' 格式中提取引用键列表。
        返回逗号分隔的引用键字符串，如 '腓4:5,腓4:6'。
        """
        if not scripture_text:
            return ''
        keys = []
        for line in scripture_text.split('\n'):
            line = line.strip()
            if not line:
                continue
            tab_pos = line.find('\t')
            if tab_pos > 0:
                keys.append(line[:tab_pos].strip())
            else:
                keys.append(line)
        return ','.join(keys) if keys else scripture_text


@dataclass
class TrainingData:
    """训练数据总集"""
    title: str  # 总题
    subtitle: str  # 副标题
    year: int  # 年份
    season: str  # 季节
    app_version: str = ""  # 应用版本号
    mottos: List[str] = field(default_factory=list)  # 标语列表
    motto_song_image: str = ""  # 标语诗歌图片路径（向后兼容，保留第一张）
    motto_song_images: List[str] = field(default_factory=list)  # 标语诗歌图片列表（支持多张）
    chapters: List[Chapter] = field(default_factory=list)  # 篇章列表
    
    def add_chapter(self, chapter: Chapter):
        """添加篇章"""
        self.chapters.append(chapter)
    
    def get_chapter(self, number: int) -> Optional[Chapter]:
        """根据编号获取篇章"""
        for chapter in self.chapters:
            if chapter.number == number:
                return chapter
        return None
    
    def to_dict(self):
        """转换为字典"""
        return {
            'title': self.title,
            'subtitle': self.subtitle,
            'year': self.year,
            'season': self.season,
            'mottos': self.mottos,
            'motto_song_image': self.motto_song_image,
            'motto_song_images': self.motto_song_images if self.motto_song_images else ([self.motto_song_image] if self.motto_song_image else []),
            'chapters': [ch.to_dict() for ch in self.chapters]
        }
