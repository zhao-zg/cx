#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成版本信息文件
"""
import json
import os
from datetime import datetime

def generate_version_file(output_dir='output', app_version=None):
    """生成 version.json 文件"""
    
    # 读取app_config.json获取APK版本（在收集文件之前）
    if app_version is None:
        try:
            # 先尝试从根目录读取（优先）
            config_file = 'app_config.json'
            if not os.path.exists(config_file):
                # 如果不存在，尝试从output目录读取
                config_file = os.path.join(output_dir, 'app_config.json')
            
            if os.path.exists(config_file):
                with open(config_file, 'r', encoding='utf-8') as f:
                    config = json.load(f)
                    app_version = config.get('version', '0.0.0')
                    print(f"✓ 从 {config_file} 读取 APK 版本: {app_version}")
            else:
                app_version = '0.0.0'
                print(f"⚠ 未找到 app_config.json，使用默认版本: {app_version}")
        except Exception as e:
            print(f"⚠ 无法读取app_config.json: {e}")
            app_version = '0.0.0'
    
    # 生成资源版本号（时间戳格式）
    resource_version = datetime.now().strftime('%Y%m%d%H%M%S')
    
    # 获取所有文件列表
    files = []
    for root, dirs, filenames in os.walk(output_dir):
        for filename in filenames:
            if filename.endswith(('.html', '.htm', '.js', '.css', '.json')):
                rel_path = os.path.relpath(os.path.join(root, filename), output_dir)
                files.append(rel_path.replace('\\', '/'))
    
    # 生成APK下载URL（从GitHub Releases获取）
    apk_url = f'https://github.com/zhao-zg/cx/releases/download/v{app_version}/TeHui-v{app_version}.apk'
    
    # 生成版本信息
    version_info = {
        'app_version': app_version,  # APK版本
        'version': app_version,  # 主版本号（用于更新检查）
        'resource_version': resource_version,  # 资源版本（时间戳）
        'apk_url': apk_url,  # APK下载地址
        'timestamp': datetime.now().isoformat(),
        'files': files,
        'file_count': len(files),
        'changelog': '包含内容更新和优化'  # 可以从环境变量或参数读取
    }
    
    # 保存到文件
    version_file = os.path.join(output_dir, 'version.json')
    with open(version_file, 'w', encoding='utf-8') as f:
        json.dump(version_info, f, ensure_ascii=False, indent=2)
    
    print(f"✓ 版本文件已生成: {version_file}")
    print(f"  APK版本: {version_info['app_version']}")
    print(f"  资源版本: {version_info['resource_version']}")
    print(f"  文件数: {version_info['file_count']}")
    
    return version_info

if __name__ == '__main__':
    generate_version_file()
