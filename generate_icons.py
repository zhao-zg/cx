#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成应用图标脚本
蓝底白字，内容："特会"
"""
from PIL import Image, ImageDraw, ImageFont
import os

def hex_to_rgb(color):
    """将颜色转换为 RGB 元组，支持 16 进制和颜色名称"""
    # 支持常见颜色名称
    color_names = {
        'white': (255, 255, 255),
        'black': (0, 0, 0),
        'red': (255, 0, 0),
        'green': (0, 255, 0),
        'blue': (0, 0, 255),
    }
    
    if color.lower() in color_names:
        return color_names[color.lower()]
    
    # 处理 hex 颜色
    color = color.lstrip('#')
    return tuple(int(color[i:i+2], 16) for i in (0, 2, 4))

def generate_icon(size, text='特会', output_path=None, round_icon=False):
    """
    生成指定尺寸的图标（渐变现代风格）
    round_icon: 是否生成圆形（有透明角）图标
    """
    # 创建图像（RGBA，保留透明度以便可选的圆形遮罩）
    img = Image.new('RGBA', (size, size), color=(0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # 绘制渐变背景（从深蓝到浅蓝，与系统主色蓝一致）
    # #5B67D4 -> #667eea
    for y in range(size):
        ratio = y / size
        r = int(91 + (102 - 91) * ratio)
        g = int(103 + (126 - 103) * ratio)
        b = int(212 + (234 - 212) * ratio)
        draw.line([(0, y), (size, y)], fill=(r, g, b, 255))
    
    # 添加高光效果（左上角，更大范围）
    for x in range(int(size * 0.5)):
        for y in range(int(size * 0.5)):
            dist = ((x - size * 0.2) ** 2 + (y - size * 0.15) ** 2) ** 0.5
            max_dist = size * 0.35
            if dist < max_dist:
                alpha = int(50 * (1 - dist / max_dist))
                if alpha > 0:
                    current = img.getpixel((x, y))
                    new_r = min(255, current[0] + alpha)
                    new_g = min(255, current[1] + alpha)
                    new_b = min(255, current[2] + alpha)
                    img.putpixel((x, y), (new_r, new_g, new_b, 255))
    
    # 尝试加载字体
    padding = int(size * 0.1)  # 10% 边距
    available_space = size - 2 * padding
    font_size = max(10, int(available_space * 0.5))
    
    font = None
    try:
        font = ImageFont.truetype("C:\\Windows\\Fonts\\msyh.ttc", font_size)
    except:
        try:
            font = ImageFont.truetype("C:\\Windows\\Fonts\\simsun.ttc", font_size)
        except:
            try:
                font = ImageFont.truetype("/usr/share/fonts/opentype/noto/NotoSansCJK-Medium.ttc", font_size)
            except:
                font = ImageFont.load_default()
    
    # 计算文本位置（精确居中）
    if hasattr(draw, 'textbbox'):
        # 多次测试以找到精确的中心位置
        bbox = draw.textbbox((0, 0), text, font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
        
        # 先计算应该的中心点
        center_x = size / 2
        center_y = size / 2
        
        # 使用 textbbox 计算，确保文本视觉上居中
        # 水平居中：将文本框左边放在中心左侧
        x = center_x - text_width / 2 - bbox[0]
        # 垂直居中：将文本框顶部放在中心上方
        y = center_y - text_height / 2 - bbox[1]
    else:
        x = size / 2
        y = size / 2
    
    # 绘制白色文本
    draw.text((x, y), text, fill=(255, 255, 255, 255), font=font)
    
    # 根据是否需要圆形图标决定保存方式
    if round_icon:
        # 创建圆形遮罩，留下圆形区域，其余透明
        mask = Image.new('L', (size, size), 0)
        mask_draw = ImageDraw.Draw(mask)
        pad = int(size * 0.02)
        mask_draw.ellipse((pad, pad, size - pad - 1, size - pad - 1), fill=255)
        out_img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        out_img.paste(img, (0, 0), mask)

        if output_path:
            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            out_img.save(output_path, compress_level=1)
            print(f'✓ 生成圆形图标: {output_path}')
        return out_img

    # 非圆形：在背景色上合成并保存为 RGB
    rgb_img = Image.new('RGB', img.size, (102, 126, 234))  # #667eea
    rgb_img.paste(img, mask=img.split()[3] if img.mode == 'RGBA' else None)

    # 保存图像
    if output_path:
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        rgb_img.save(output_path, quality=95)
        print(f'✓ 生成图标: {output_path}')

    return rgb_img

def main():
    # 定义需要生成的图标规格
    icon_specs = [
        # (尺寸, 输出路径)
        (192, 'output/icon-192.png'),
        (512, 'output/icon-512.png'),
        (180, 'output/icon-180.png'),  # Apple
        (152, 'output/icon-152.png'),  # Apple iPad
        (76, 'output/icon-76.png'),    # Apple
        (64, 'output/icon-64.png'),    # Favicon
        # Android 图标
        # 每个分辨率同时生成方形和圆形（round）图标
        (192, 'android_icons/mipmap-xxxhdpi/ic_launcher.png', False),
        (192, 'android_icons/mipmap-xxxhdpi/ic_launcher_round.png', True),
        (144, 'android_icons/mipmap-xxhdpi/ic_launcher.png', False),
        (144, 'android_icons/mipmap-xxhdpi/ic_launcher_round.png', True),
        (96, 'android_icons/mipmap-xhdpi/ic_launcher.png', False),
        (96, 'android_icons/mipmap-xhdpi/ic_launcher_round.png', True),
        (72, 'android_icons/mipmap-hdpi/ic_launcher.png', False),
        (72, 'android_icons/mipmap-hdpi/ic_launcher_round.png', True),
        (48, 'android_icons/mipmap-mdpi/ic_launcher.png', False),
        (48, 'android_icons/mipmap-mdpi/ic_launcher_round.png', True),
    ]
    
    print('开始生成图标...\n')
    
    for spec in icon_specs:
        # allow tuples of (size,path) or (size,path,round_flag)
        if len(spec) == 2:
            size, output_path = spec
            round_flag = False
        else:
            size, output_path, round_flag = spec
        generate_icon(size, text='特会', output_path=output_path, round_icon=round_flag)
    
    print('\n✓ 所有图标生成完成！')
    print('\n生成的文件：')
    for spec in icon_specs:
        path = spec[1]
        if os.path.exists(path):
            size_kb = os.path.getsize(path) / 1024
            print(f'  • {path} ({size_kb:.1f} KB)')

if __name__ == '__main__':
    main()
