#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成版本信息文件
"""
import json
import os
from datetime import datetime

def generate_version_file(output_dir='output', app_version=None, apk_file=None, apk_size=None):
    """生成 version.json 文件"""
    
    # 读取app_config.json获取APK版本
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
    
    # 默认APK文件名
    if apk_file is None:
        apk_file = f'TeHui-v{app_version}.apk'
    
    # 生成版本信息（只保留实际使用的字段）
    version_info = {
        'apk_version': app_version,  # APK版本
        'version': app_version,  # 备用版本号
        'apk_file': apk_file,  # APK文件名
    }
    
    # 添加APK大小（如果提供）
    if apk_size is not None:
        version_info['apk_size'] = apk_size
    
    # 保存到文件
    version_file = os.path.join(output_dir, 'version.json')
    with open(version_file, 'w', encoding='utf-8') as f:
        json.dump(version_info, f, ensure_ascii=False, indent=2)
    
    print(f"✓ 版本文件已生成: {version_file}")
    print(f"  APK版本: {version_info['apk_version']}")
    print(f"  APK文件: {version_info['apk_file']}")
    
    return version_info

if __name__ == '__main__':
    generate_version_file()
