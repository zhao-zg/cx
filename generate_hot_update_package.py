#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成热更新包
"""
import json
import os
import zipfile
from datetime import datetime

def generate_hot_update_package(output_dir='output'):
    """生成热更新 ZIP 包"""
    
    print('=' * 60)
    print(' 生成热更新包')
    print('=' * 60)
    
    # 读取版本信息
    version_file = os.path.join(output_dir, 'version.json')
    if not os.path.exists(version_file):
        print('✗ version.json 不存在，请先运行 generate_version.py')
        return
    
    with open(version_file, 'r', encoding='utf-8') as f:
        version_info = json.load(f)
    
    resource_version = version_info.get('resource_version', 'unknown')
    files = version_info.get('files', [])
    
    print(f'资源版本: {resource_version}')
    print(f'文件数量: {len(files)}')
    
    # 创建 ZIP 文件
    zip_filename = f'hot-update-{resource_version}.zip'
    zip_path = os.path.join(output_dir, zip_filename)
    
    print(f'\n正在打包: {zip_filename}')
    
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        # 添加所有文件
        for file in files:
            file_path = os.path.join(output_dir, file)
            if os.path.exists(file_path):
                zipf.write(file_path, file)
                if len(files) <= 50 or files.index(file) % 50 == 0:
                    print(f'  添加: {file}')
        
        # 添加 version.json
        zipf.write(version_file, 'version.json')
        print(f'  添加: version.json')
    
    # 获取文件大小
    zip_size = os.path.getsize(zip_path)
    zip_size_mb = zip_size / 1024 / 1024
    
    print(f'\n✓ 热更新包已生成: {zip_path}')
    print(f'  文件大小: {zip_size_mb:.2f} MB')
    print(f'  包含文件: {len(files) + 1} 个')
    
    # 更新 version.json，添加热更新包信息
    version_info['hot_update_url'] = f'hot-update-{resource_version}.zip'
    version_info['hot_update_size'] = zip_size
    
    with open(version_file, 'w', encoding='utf-8') as f:
        json.dump(version_info, f, ensure_ascii=False, indent=2)
    
    print(f'\n✓ version.json 已更新')
    
    return zip_path

if __name__ == '__main__':
    generate_hot_update_package()
