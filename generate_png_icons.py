#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成 Android PNG 图标和 PWA 图标
从源图片 src/static/icons/icon.png 缩放到各尺寸
"""
from PIL import Image, ImageDraw
from pathlib import Path

# 源图标路径
SOURCE_ICON = Path('src/static/icons/icon.png')

# Android 图标尺寸
SIZES = {
    'mdpi': 48,
    'hdpi': 72,
    'xhdpi': 96,
    'xxhdpi': 144,
    'xxxhdpi': 192,
}

# PWA/网页实际引用的图标尺寸
PWA_SIZES = [16, 32, 120, 152, 167, 180, 192, 512]


def load_source_icon(size):
    """从源图片加载并缩放到指定尺寸，铺白色背景消除透明边角"""
    img = Image.open(SOURCE_ICON).convert('RGBA')
    img = img.resize((size, size), Image.Resampling.LANCZOS)
    bg = Image.new('RGBA', (size, size), (255, 255, 255, 255))
    bg.alpha_composite(img)
    return bg


def create_round_icon(img):
    """创建圆形图标"""
    size = img.size[0]
    
    # 创建圆形遮罩
    mask = Image.new('L', (size, size), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.ellipse([(0, 0), (size, size)], fill=255)
    
    # 应用遮罩
    round_img = img.copy()
    round_img.putalpha(mask)
    
    return round_img

def generate_pwa_icons():
    """生成 PWA/网页所需的 PNG 图标"""
    print("\n=== 生成 PWA 图标 ===\n")

    output_dir = Path('src/static/icons')
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"源图标: {SOURCE_ICON}")
    for size in PWA_SIZES:
        icon_img = load_source_icon(size)
        output_path = output_dir / f'icon-{size}.png'
        icon_img.save(output_path, 'PNG', optimize=True)
        print(f"✓ 生成: {output_path} ({output_path.stat().st_size / 1024:.1f} KB)")

    print("\n✓ PWA 图标生成完成！")


def generate_icons():
    """生成所有尺寸的 Android 图标"""
    print("=== 生成 Android PNG 图标 ===\n")

    output_base = Path('android_icons')
    output_base.mkdir(exist_ok=True)

    for density, size in SIZES.items():
        output_dir = output_base / f'mipmap-{density}'
        output_dir.mkdir(exist_ok=True)

        print(f"生成 mipmap-{density} ({size}x{size})...")

        img = load_source_icon(size)

        output_file = output_dir / 'ic_launcher.png'
        img.save(output_file, 'PNG')
        print(f"  ✓ ic_launcher.png ({output_file.stat().st_size / 1024:.1f} KB)")

        round_img = create_round_icon(img)
        output_round = output_dir / 'ic_launcher_round.png'
        round_img.save(output_round, 'PNG')
        print(f"  ✓ ic_launcher_round.png")
        print()

    print("✓ Android 图标生成完成！")

    generate_pwa_icons()

    print("\n下一步：")
    print("  1. python main.py  # 自动复制图标到 output/icons")
    print("  2. git add android_icons/ src/static/icons/")

if __name__ == '__main__':
    try:
        generate_icons()
    except Exception as e:
        print(f"\n✗ 错误: {e}")
        import traceback
        traceback.print_exc()
