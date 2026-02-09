#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成 Android PNG 图标（现代扁平化设计）
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

# PWA/网页常用图标尺寸
PWA_SIZES = [
    16, 32, 48, 64, 72, 96,
    120, 128, 144, 152, 167, 180,
    192, 256, 384, 512
]

def create_gradient_background(size):
    """创建现代渐变背景（对角线性渐变，扁平化设计）"""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    
    # 渐变色：从靛蓝 #4F46E5 到蓝色 #3B82F6（对角渐变）
    color_start = (79, 70, 229)    # #4F46E5 靛蓝
    color_end = (59, 130, 246)     # #3B82F6 蓝色
    
    # 创建对角线性渐变（从左上到右下）
    for y in range(size):
        for x in range(size):
            # 计算对角线位置比例（0到1）
            ratio = (x + y) / (2 * size)
            
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

def add_text(img, text, font_size):
    """在图片上添加白色文字（扁平化设计，无徽章）"""
    draw = ImageDraw.Draw(img)
    size = img.size[0]
    center_x, center_y = size // 2, size // 2
    
    # 尝试使用系统加粗字体
    font = None
    font_paths = [
        'C:/Windows/Fonts/msyhbd.ttc',  # Windows 微软雅黑 Bold（优先）
        'C:/Windows/Fonts/simhei.ttf',  # Windows 黑体
        'C:/Windows/Fonts/msyh.ttc',    # Windows 微软雅黑
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
    
    # 绘制白色文字（纯白色，使用 mm anchor 居中）
    text_color = (255, 255, 255, 255)
    draw.text((center_x, center_y), text, font=font, fill=text_color, anchor='mm')
    
    return img

def add_shine_effect(img):
    """添加微妙的左上高光效果"""
    size = img.size[0]
    overlay = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    
    # 在左上角添加非常微妙的高光（扁平化设计，更低调）
    shine_size = int(size * 0.35)
    for i in range(shine_size):
        alpha = int(15 * (1 - i / shine_size))  # 降低透明度，更微妙
        draw.ellipse(
            [
                (int(size * 0.1) - i, int(size * 0.1) - i),
                (int(size * 0.1) + shine_size - i, int(size * 0.1) + shine_size - i)
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

def generate_pwa_icons():
    """生成 PWA/网页所需的 PNG 图标（直接生成多尺寸）"""
    print("\n=== 生成 PWA 图标 ===\n")

    # 输出目录（生成到 src/static/icons）
    output_dir = Path('src/static/icons')
    output_dir.mkdir(parents=True, exist_ok=True)

    max_size = max(PWA_SIZES)
    base_img = create_gradient_background(max_size)
    font_size = int(max_size * 0.32)
    base_img = add_text(base_img, '特会', font_size)
    base_img = add_shine_effect(base_img)
    print(f"源图标尺寸: {max_size}x{max_size}")

    for size in PWA_SIZES:
        icon_img = base_img.resize((size, size), Image.Resampling.LANCZOS)
        output_path = output_dir / f'icon-{size}.png'
        icon_img.save(output_path, 'PNG', optimize=True)
        print(f"✓ 生成: {output_path} ({output_path.stat().st_size / 1024:.1f} KB)")

    print("\n✓ PWA 图标生成完成！")

def generate_icons():
    """生成所有尺寸的图标"""
    print("=== 生成现代扁平化设计 Android PNG 图标 ===\n")
    
    # 创建输出目录
    output_base = Path('android_icons')
    output_base.mkdir(exist_ok=True)
    
    for density, size in SIZES.items():
        output_dir = output_base / f'mipmap-{density}'
        output_dir.mkdir(exist_ok=True)
        
        print(f"生成 mipmap-{density} ({size}x{size})...")
        
        # 生成渐变背景
        img = create_gradient_background(size)
        
        # 添加白色文字
        font_size = int(size * 0.32)  # 字体大小适中
        img = add_text(img, '特会', font_size)
        
        # 添加微妙的光泽效果
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
    
    print("✓ Android 图标生成完成！")
    print(f"\n生成的文件位于: {output_base}/")
    print("\n设计特点：")
    print("  • 对角线性渐变背景（靛蓝 #4F46E5 到蓝色 #3B82F6）")
    print("  • 白色加粗文字「特会」，直接在背景上")
    print("  • 扁平化现代设计，无徽章无阴影")
    print("  • 微妙的左上光泽效果")
    
    # 自动生成 PWA 图标
    generate_pwa_icons()
    
    print("\n下一步：")
    print("  1. python main.py  # 自动复制图标到 output/icons")
    print("  2. git add android_icons/ src/static/icons/")
    print("  3. git commit -m 'feat: 更新为扁平化现代设计图标'")
    print("  4. 在 Android Chrome 浏览器测试 PWA 安装")

if __name__ == '__main__':
    try:
        generate_icons()
    except Exception as e:
        print(f"\n✗ 错误: {e}")
        import traceback
        traceback.print_exc()
