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
    """晨兴内容（按天）"""
    day: str  # 周一、周二...
    outline: List[Content] = field(default_factory=list)  # 大纲部分
    morning_feeding: List[str] = field(default_factory=list)  # 晨兴喂养
    message_reading: List[str] = field(default_factory=list)  # 信息选读


@dataclass
class Chapter:
    """篇章"""
    number: int  # 篇章编号 1-9
    title: str  # 标题
    outline_sections: List[Content] = field(default_factory=list)  # 纲目结构(仅标题,来自经文.docx)
    detail_sections: List[Content] = field(default_factory=list)  # 详细内容(带段落,来自听抄.docx)
    hymn_number: str = ""  # 诗歌编号（如：JL 诗歌：748）
    hymn_image: str = ""  # 诗歌图片路径（相对于output目录）
    scripture: str = ""  # 经文引用（读经经文）
    scripture_verses: str = ""  # 经文内容（经文正文）
    message_content: List[str] = field(default_factory=list)  # 职事信息内容（来自听抄.docx末尾）
    ministry_excerpt: str = ""  # 职事信息摘录（来自经文.docx）
    morning_revivals: List[MorningRevival] = field(default_factory=list)  # 晨兴（来自晨兴.doc）
    _day_outlines: dict = field(default_factory=dict)  # 内部使用：按天存储的大纲数据
    
    def add_outline_section(self, section: Content):
        """添加纲目节点"""
        self.outline_sections.append(section)
    
    def add_detail_section(self, section: Content):
        """添加详细内容节点"""
        self.detail_sections.append(section)
    
    def to_dict(self):
        """转换为字典，便于模板渲染"""
        
        # Debug: 检查第一章的周六内容
        if self.number == 1 and len(self.morning_revivals) >= 6:
            saturday_revival = self.morning_revivals[5]  # 周六(index 5)
            if saturday_revival.outline:
                print(f"    First outline item: level={saturday_revival.outline[0].level}, children={len(saturday_revival.outline[0].children)}")
        
        return {
            'number': self.number,
            'title': self.title,
            'hymn_number': self.hymn_number,
            'hymn_image': self.hymn_image,
            'scripture': self.scripture,
            'scripture_verses': self.scripture_verses,
            'outline_sections': self._sections_to_dict(self.outline_sections),
            'detail_sections': self._sections_to_dict(self.detail_sections),
            'message_content': self.message_content,
            'ministry_excerpt': self.ministry_excerpt,
            'morning_revivals': [
                {
                    'day': mr.day,
                    'outline': self._sections_to_dict_debug(mr.outline, f"MorningRevival {mr.day}"),
                    'morning_feeding': mr.morning_feeding,
                    'message_reading': mr.message_reading
                }
                for mr in self.morning_revivals
            ]
        }
    
    def _sections_to_dict_debug(self, contents: List[Content], context=""):
        """递归转换内容节点为字典 - 调试版本"""
        result = []
        for i, content in enumerate(contents):
            print(f"  Item {i}: level={content.level}, title={content.title[:50]}..., children={len(content.children)}")
            content_dict = {
                'level': content.level,
                'title': content.title,
                'scripture': content.scripture,
                'content': content.content,
                'children': self._sections_to_dict_debug(content.children, f"{context} child {i}") if content.children else []
            }
            result.append(content_dict)
        return result
    
    def _sections_to_dict(self, contents: List[Content]):
        """递归转换内容节点为字典"""
        result = []
        for content in contents:
            content_dict = {
                'level': content.level,
                'title': content.title,
                'scripture': content.scripture,
                'content': content.content,
                'children': self._sections_to_dict(content.children)
            }
            result.append(content_dict)
            
            # Debug: 检查周六相关的内容
            if content.level == '贰' or len(contents) == 1:
                if content.children:
                    print(f"    Has {len(content.children)} children:")
                    for i, child in enumerate(content.children):
                        print(f"      Child {i}: level={child.level}, title={child.title[:30]}")
                
        return result


@dataclass
class TrainingData:
    """训练数据总集"""
    title: str  # 总题
    subtitle: str  # 副标题
    year: int  # 年份
    season: str  # 季节
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
            'chapters': [ch.to_dict() for ch in self.chapters]
        }
