#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成版本信息文件
"""
import json
import os
from datetime import datetime

def generate_version_file(output_dir='output'):
    """生成 version.json 文件"""
    
    # 获取所有文件列表
    files = []
    for root, dirs, filenames in os.walk(output_dir):
        for filename in filenames:
            if filename.endswith(('.html', '.htm', '.js', '.css', '.json')):
                rel_path = os.path.relpath(os.path.join(root, filename), output_dir)
                files.append(rel_path.replace('\\', '/'))
    
    # 生成版本信息
    version_info = {
        'version': datetime.now().strftime('%Y%m%d%H%M%S'),
        'timestamp': datetime.now().isoformat(),
        'files': files,
        'file_count': len(files)
    }
    
    # 保存到文件
    version_file = os.path.join(output_dir, 'version.json')
    with open(version_file, 'w', encoding='utf-8') as f:
        json.dump(version_info, f, ensure_ascii=False, indent=2)
    
    print(f"✓ 版本文件已生成: {version_file}")
    print(f"  版本号: {version_info['version']}")
    print(f"  文件数: {version_info['file_count']}")
    
    return version_info

if __name__ == '__main__':
    generate_version_file()
