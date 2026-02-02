#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成 Android 图标（从 SVG 转换为多个尺寸的 PNG）
使用 svglib + reportlab 转换 SVG
"""
import os
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
    from svglib.svglib import svg2rlg
    from reportlab.graphics import renderPM
except ImportError:
    print("✗ 错误: 需要安装依赖")
    print("  pip install Pillow svglib reportlab")
    sys.exit(1)

# Android 图标尺寸
SIZES = {
    'mdpi': 48,
    'hdpi': 72,
    'xhdpi': 96,
    'xxhdpi': 144,
    'xxxhdpi': 192,
}

def generate_icons():
    """生成 Android 图标"""
    print("=== 生成 Android 图标 ===\n")
    
    # 源 SVG 文件
    svg_file = Path('src/static/icons/icon.svg')
    
    if not svg_file.exists():
        print(f"✗ 错误: 找不到 {svg_file}")
        sys.exit(1)
    
    # 创建输出目录
    output_base = Path('android_icons')
    output_base.mkdir(exist_ok=True)
    
    print("开始转换图标...\n")
    
    # 读取 SVG
    try:
        drawing = svg2rlg(str(svg_file))
        if drawing is None:
            raise Exception("无法解析 SVG 文件")
    except Exception as e:
        print(f"✗ 读取 SVG 失败: {e}")
        sys.exit(1)
    
    for density, size in SIZES.items():
        output_dir = output_base / f'mipmap-{density}'
        output_dir.mkdir(exist_ok=True)
        
        # 生成普通图标
        output_file = output_dir / 'ic_launcher.png'
        print(f"  生成 mipmap-{density} ({size}x{size})...")
        
        try:
            # 缩放 SVG
            scale_x = size / drawing.width
            scale_y = size / drawing.height
            scale = min(scale_x, scale_y)
            
            drawing.width = size
            drawing.height = size
            drawing.scale(scale, scale)
            
            # 渲染为 PNG
            renderPM.drawToFile(drawing, str(output_file), fmt='PNG')
            
            file_size = output_file.stat().st_size / 1024
            print(f"    ✓ {output_file} ({file_size:.1f} KB)")
        except Exception as e:
            print(f"    ✗ 生成失败: {e}")
            sys.exit(1)
        
        # 生成圆形图标（Android 8.0+）
        output_round = output_dir / 'ic_launcher_round.png'
        print(f"  生成 mipmap-{density} 圆形图标...")
        
        try:
            # 读取刚生成的方形图标
            img = Image.open(output_file).convert('RGBA')
            
            # 创建圆形遮罩
            mask = Image.new('L', (size, size), 0)
            draw = ImageDraw.Draw(mask)
            draw.ellipse((0, 0, size, size), fill=255)
            
            # 应用遮罩
            output_img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
            output_img.paste(img, (0, 0))
            output_img.putalpha(mask)
            output_img.save(output_round)
            
            print(f"    ✓ {output_round}")
        except Exception as e:
            print(f"    ✗ 圆形图标生成失败: {e}")
            # 圆形图标失败不影响主流程
        
        # 重新读取 SVG（因为之前被修改了）
        drawing = svg2rlg(str(svg_file))
    
    print("\n✓ 图标生成完成！")
    print(f"\n生成的文件位于: {output_base}/")
    print("\n下一步：")
    print("  提交这些文件到 Git，GitHub Actions 会自动使用它们")

if __name__ == '__main__':
    generate_icons()
