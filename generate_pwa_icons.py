#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成 PWA PNG 图标（192x192 和 512x512）
从现有的 Android xxxhdpi 图标放大生成
"""
from PIL import Image
from pathlib import Path

def generate_pwa_icons():
    """生成 PWA 所需的 PNG 图标"""
    print("开始生成 PWA 图标...")
    
    # 源文件（使用最大的 Android 图标）
    source_icon = Path('android_icons/mipmap-xxxhdpi/ic_launcher.png')
    
    if not source_icon.exists():
        print(f"✗ 错误: 找不到源图标文件 {source_icon}")
        return
    
    # 输出目录（生成到 src/static/icons）
    output_dir = Path('src/static/icons')
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # 读取源图标
    img = Image.open(source_icon)
    print(f"源图标尺寸: {img.size[0]}x{img.size[1]}")
    
    # 生成 192x192
    icon_192 = img.resize((192, 192), Image.Resampling.LANCZOS)
    output_192 = output_dir / 'icon-192.png'
    icon_192.save(output_192, 'PNG', optimize=True)
    print(f"✓ 生成: {output_192} ({output_192.stat().st_size / 1024:.1f} KB)")
    
    # 生成 512x512
    icon_512 = img.resize((512, 512), Image.Resampling.LANCZOS)
    output_512 = output_dir / 'icon-512.png'
    icon_512.save(output_512, 'PNG', optimize=True)
    print(f"✓ 生成: {output_512} ({output_512.stat().st_size / 1024:.1f} KB)")
    
    print("\n✓ PWA 图标生成完成！")
    print("\n下一步:")
    print("  1. 运行 python main.py 自动复制图标到 output/icons")
    print("  2. 在 Android Chrome 浏览器测试 PWA 安装")

if __name__ == '__main__':
    try:
        generate_pwa_icons()
    except Exception as e:
        print(f"\n✗ 错误: {e}")
        import traceback
        traceback.print_exc()
