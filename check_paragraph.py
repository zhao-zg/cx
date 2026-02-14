# -*- coding: utf-8 -*-
from src.parser_improved import ImprovedParser

# 创建解析器
p = ImprovedParser()

# 解析文档
p.parse_outline_doc('resource/2025-04 夏季训练/经文.docx')

# 打印结果
print(f'标语数量: {len(p.mottos)}')
print('\n标语列表:')
for i, m in enumerate(p.mottos):
    if m == '###PARAGRAPH_SEPARATOR###':
        print(f'{i+1}. [段落分隔]')
    else:
        print(f'{i+1}. {m}')

