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
    
    # 读取app_config.json获取版本号
    app_version = '0.7.3'
    try:
        with open('app_config.json', 'r', encoding='utf-8') as f:
            app_config = json.load(f)
            app_version = app_config.get('version', app_version)
    except Exception as e:
        print(f"⚠ 读取app_config.json失败: {e}")
    
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
        'app_version': app_version,
        'timestamp': datetime.now().isoformat(),
        'files': files,
        'file_count': len(files),
        # APK下载地址（需要手动上传APK后更新）
        'apk_url': f'https://github.com/zhao-zg/cx/releases/download/v{app_version}/tehui_v{app_version}.apk',
        'changelog': '新增划线标记功能，支持5种颜色选择'
    }
    
    # 保存到文件
    version_file = os.path.join(output_dir, 'version.json')
    with open(version_file, 'w', encoding='utf-8') as f:
        json.dump(version_info, f, ensure_ascii=False, indent=2)
    
    print(f"✓ 版本文件已生成: {version_file}")
    print(f"  应用版本: {version_info['app_version']}")
    print(f"  版本号: {version_info['version']}")
    print(f"  文件数: {version_info['file_count']}")
    print(f"  APK地址: {version_info['apk_url']}")
    
    return version_info

if __name__ == '__main__':
    generate_version_file()
