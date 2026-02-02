#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成 Android PNG 图标（现代渐变设计）
使用 Pillow 直接生成，不依赖 SVG
"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import math

# Android 图标尺寸
SIZES = {
    'mdpi': 48,
    'hdpi': 72,
    'xhdpi': 96,
    'xxhdpi': 144,
    'xxxhdpi': 192,
}

def create_gradient_background(size):
    """创建现代渐变背景（从浅蓝到深蓝）"""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # 渐变色：从浅蓝 #4A90E2 到深蓝 #2563EB（纯蓝色调）
    color_start = (74, 144, 226)   # #4A90E2 浅蓝
    color_end = (37, 99, 235)      # #2563EB 深蓝
    
    # 创建径向渐变（从中心到边缘）
    center_x, center_y = size // 2, size // 2
    max_distance = math.sqrt(center_x**2 + center_y**2)
    
    for y in range(size):
        for x in range(size):
            # 计算距离中心的距离
            distance = math.sqrt((x - center_x)**2 + (y - center_y)**2)
            ratio = min(distance / max_distance, 1.0)
            
            # 插值计算颜色
            r = int(color_start[0] + (color_end[0] - color_start[0]) * ratio)
            g = int(color_start[1] + (color_end[1] - color_start[1]) * ratio)
            b = int(color_start[2] + (color_end[2] - color_start[2]) * ratio)
            
            img.putpixel((x, y), (r, g, b, 255))
    
    # 添加圆角
    mask = Image.new('L', (size, size), 0)
    mask_draw = ImageDraw.Draw(mask)
    corner_radius = int(size * 0.22)  # 22% 圆角
    mask_draw.rounded_rectangle([(0, 0), (size, size)], corner_radius, fill=255)
    
    # 应用圆角遮罩
    img.putalpha(mask)
    
    return img

def add_badge_and_text(img, text, font_size):
    """在图片上添加白色徽章和文字"""
    draw = ImageDraw.Draw(img)
    size = img.size[0]
    center_x, center_y = size // 2, size // 2
    
    # 创建白色圆形徽章（带阴影效果）
    badge_radius = int(size * 0.35)  # 徽章半径为图标的 35%
    
    # 绘制阴影（稍微偏移和模糊）
    shadow_offset = int(size * 0.02)
    shadow_radius = badge_radius + 2
    for i in range(3):  # 多层阴影实现模糊效果
        alpha = 30 - i * 8
        draw.ellipse(
            [
                (center_x - shadow_radius + shadow_offset, center_y - shadow_radius + shadow_offset),
                (center_x + shadow_radius + shadow_offset, center_y + shadow_radius + shadow_offset)
            ],
            fill=(0, 0, 0, alpha)
        )
        shadow_radius -= 1
    
    # 绘制白色徽章
    draw.ellipse(
        [
            (center_x - badge_radius, center_y - badge_radius),
            (center_x + badge_radius, center_y + badge_radius)
        ],
        fill=(255, 255, 255, 255)
    )
    
    # 尝试使用系统字体
    font = None
    font_paths = [
        'C:/Windows/Fonts/msyhbd.ttc',  # Windows 微软雅黑 Bold
        'C:/Windows/Fonts/msyh.ttc',    # Windows 微软雅黑
        'C:/Windows/Fonts/simhei.ttf',  # Windows 黑体
        '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',  # Linux
        '/System/Library/Fonts/PingFang.ttc',  # macOS
    ]
    
    for font_path in font_paths:
        try:
            font = ImageFont.truetype(font_path, font_size)
            break
        except:
            continue
    
    if font is None:
        font = ImageFont.load_default()
        print(f"  ⚠ 使用默认字体（可能无法显示中文）")
    
    # 绘制文字（渐变色，使用 mm anchor 居中）
    # 使用深蓝色 #2563EB
    text_color = (37, 99, 235, 255)
    draw.text((center_x, center_y), text, font=font, fill=text_color, anchor='mm')
    
    return img

def add_shine_effect(img):
    """添加光泽效果（可选）"""
    size = img.size[0]
    overlay = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    
    # 在左上角添加微妙的高光
    shine_size = int(size * 0.4)
    for i in range(shine_size):
        alpha = int(30 * (1 - i / shine_size))
        draw.ellipse(
            [
                (int(size * 0.15) - i, int(size * 0.15) - i),
                (int(size * 0.15) + shine_size - i, int(size * 0.15) + shine_size - i)
            ],
            fill=(255, 255, 255, alpha)
        )
    
    # 合并光泽效果
    img = Image.alpha_composite(img, overlay)
    return img

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

def generate_icons():
    """生成所有尺寸的图标"""
    print("=== 生成现代风格 Android PNG 图标 ===\n")
    
    # 创建输出目录
    output_base = Path('android_icons')
    output_base.mkdir(exist_ok=True)
    
    for density, size in SIZES.items():
        output_dir = output_base / f'mipmap-{density}'
        output_dir.mkdir(exist_ok=True)
        
        print(f"生成 mipmap-{density} ({size}x{size})...")
        
        # 生成渐变背景
        img = create_gradient_background(size)
        
        # 添加徽章和文字
        font_size = int(size * 0.45)  # 字体大小为图标的 45%
        img = add_badge_and_text(img, '特', font_size)
        
        # 添加光泽效果
        img = add_shine_effect(img)
        
        # 保存普通图标
        output_file = output_dir / 'ic_launcher.png'
        img.save(output_file, 'PNG')
        file_size = output_file.stat().st_size / 1024
        print(f"  ✓ ic_launcher.png ({file_size:.1f} KB)")
        
        # 生成圆形图标
        round_img = create_round_icon(img)
        output_round = output_dir / 'ic_launcher_round.png'
        round_img.save(output_round, 'PNG')
        print(f"  ✓ ic_launcher_round.png")
        
        print()
    
    print("✓ 所有图标生成完成！")
    print(f"\n生成的文件位于: {output_base}/")
    print("\n设计特点：")
    print("  • 纯蓝色渐变背景（浅蓝到深蓝）")
    print("  • 白色圆形徽章")
    print("  • 深蓝色文字")
    print("  • 微妙的阴影和光泽效果")
    print("\n下一步：")
    print("  python generate_png_icons.py")
    print("  git add android_icons/")
    print("  git commit -m 'feat: 更新为现代渐变风格图标'")
    print("  git push")

if __name__ == '__main__':
    try:
        generate_icons()
    except Exception as e:
        print(f"\n✗ 错误: {e}")
        import traceback
        traceback.print_exc()
