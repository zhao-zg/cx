#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成 Android PNG 图标（从渐变背景 + 文字）
不依赖 SVG 转换，直接使用 Pillow 生成
"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

# Android 图标尺寸
SIZES = {
    'mdpi': 48,
    'hdpi': 72,
    'xhdpi': 96,
    'xxhdpi': 144,
    'xxxhdpi': 192,
}

def create_gradient_background(size):
    """创建纯蓝色背景"""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # 纯蓝色背景：#4A90E2
    blue_color = (74, 144, 226, 255)
    
    # 填充整个背景
    draw.rectangle([(0, 0), (size, size)], fill=blue_color)
    
    # 添加圆角
    mask = Image.new('L', (size, size), 0)
    mask_draw = ImageDraw.Draw(mask)
    corner_radius = int(size * 0.2)  # 20% 圆角
    mask_draw.rounded_rectangle([(0, 0), (size, size)], corner_radius, fill=255)
    
    # 应用圆角遮罩
    img.putalpha(mask)
    
    return img

def add_text_to_image(img, text, font_size):
    """在图片上添加文字（精确居中）"""
    draw = ImageDraw.Draw(img)
    size = img.size[0]
    
    # 尝试使用系统字体
    font = None
    font_paths = [
        'C:/Windows/Fonts/msyh.ttc',  # Windows 微软雅黑
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
        # 使用默认字体
        font = ImageFont.load_default()
        print(f"  ⚠ 使用默认字体（可能无法显示中文）")
    
    # 获取文字边界框（使用 anchor 参数确保精确测量）
    bbox = draw.textbbox((0, 0), text, font=font, anchor='lt')
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    
    # 计算文字位置（完全居中）
    # 使用 'mm' anchor（middle-middle）确保文字在中心点
    x = size // 2
    y = size // 2
    
    # 绘制文字（白色，使用 mm anchor 居中）
    draw.text((x, y), text, font=font, fill=(255, 255, 255, 255), anchor='mm')
    
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
    print("=== 生成 Android PNG 图标 ===\n")
    
    # 创建输出目录
    output_base = Path('android_icons')
    output_base.mkdir(exist_ok=True)
    
    for density, size in SIZES.items():
        output_dir = output_base / f'mipmap-{density}'
        output_dir.mkdir(exist_ok=True)
        
        print(f"生成 mipmap-{density} ({size}x{size})...")
        
        # 生成普通图标
        img = create_gradient_background(size)
        
        # 添加文字
        font_size = int(size * 0.55)  # 字体大小为图标的 55%
        img = add_text_to_image(img, '特', font_size)
        
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
    print("\n下一步：")
    print("  git add android_icons/")
    print("  git commit -m 'feat: 添加预生成的 Android 图标'")
    print("  git push")

if __name__ == '__main__':
    try:
        generate_icons()
    except Exception as e:
        print(f"\n✗ 错误: {e}")
        import traceback
        traceback.print_exc()
