#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成版本信息文件

当 trainings.json 内容发生变化时，自动递增 app_config.json 的版本号，
确保 PWA 能检测到更新并触发缓存重建。
"""
import json
import os
from datetime import datetime


def _parse_version(v):
    """将语义版本号解析为元组，如 '1.4.26' → (1, 4, 26)"""
    try:
        return tuple(int(x) for x in v.split('.'))
    except (ValueError, AttributeError):
        return (0, 0, 0)


def _bump_version(v):
    """递增版本号最后一段，如 '1.4.26' → '1.4.27'"""
    parts = v.split('.')
    if len(parts) >= 1:
        try:
            parts[-1] = str(int(parts[-1]) + 1)
        except ValueError:
            parts[-1] = '1'
    return '.'.join(parts)


def _get_trainings_fingerprint(output_dir):
    """计算 trainings.json 的指纹（用 version 字段列表），用于检测训练数据是否变化"""
    trainings_path = os.path.join(output_dir, 'trainings.json')
    if not os.path.exists(trainings_path):
        return None
    try:
        with open(trainings_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        # 用 (trainings的version, 各训练path+is_collection) 作为指纹
        items = data.get('trainings', [])
        fp = []
        for t in items:
            fp.append((t.get('path', ''), t.get('version', ''), t.get('is_collection', True)))
        return tuple(fp)
    except Exception:
        return None


def _load_saved_fingerprint(output_dir):
    """读取上次构建保存的指纹"""
    fp_path = os.path.join(output_dir, '.trainings_fingerprint')
    if not os.path.exists(fp_path):
        return None
    try:
        with open(fp_path, 'r', encoding='utf-8') as f:
            return f.read().strip()
    except Exception:
        return None


def _save_fingerprint(output_dir, fingerprint):
    """保存指纹到 .trainings_fingerprint"""
    fp_path = os.path.join(output_dir, '.trainings_fingerprint')
    try:
        with open(fp_path, 'w', encoding='utf-8') as f:
            f.write(str(fingerprint))
    except Exception:
        pass


def generate_version_file(output_dir='output', app_version=None, apk_file=None, apk_size=None):
    """生成 version.json 文件
    
    当 trainings.json 内容与上次构建不同时，自动递增 app_config.json 版本号。
    """
    
    config_file = None
    config = {}
    
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
    
    # ── 检测 trainings.json 是否变化，自动递增版本号 ──
    current_fp = _get_trainings_fingerprint(output_dir)
    saved_fp_str = _load_saved_fingerprint(output_dir)
    current_fp_str = str(current_fp)
    
    if current_fp is not None and saved_fp_str is not None and current_fp_str != saved_fp_str:
        # 训练数据有变化，自动递增版本号
        old_version = app_version
        app_version = _bump_version(app_version)
        print(f"✓ 训练数据已变化，版本号自动递增: {old_version} → {app_version}")
        
        # 回写 app_config.json
        if config_file and config:
            try:
                config['version'] = app_version
                with open(config_file, 'w', encoding='utf-8') as f:
                    json.dump(config, f, ensure_ascii=False, indent=2)
                print(f"✓ app_config.json 已更新: {config_file}")
            except Exception as e:
                print(f"⚠ 回写 app_config.json 失败: {e}")
    
    # 保存当前指纹
    if current_fp is not None:
        _save_fingerprint(output_dir, current_fp_str)
    
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
