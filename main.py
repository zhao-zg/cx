# -*- coding: utf-8 -*-
"""
Word文档静态网站生成器 - 主程序
"""
import os
import sys
import yaml
from datetime import datetime
from jinja2 import Environment, FileSystemLoader
from src.parser_improved import parse_training_docs_improved
from src.generator import HTMLGenerator


def load_config(config_path='config.yaml'):
    """加载配置文件"""
    with open(config_path, 'r', encoding='utf-8') as f:
        return yaml.safe_load(f)


def find_document(base_path):
    """
    查找文档文件,支持 .doc 和 .docx 两种格式
    
    Args:
        base_path: 配置文件中指定的路径(可能带或不带扩展名)
    
    Returns:
        实际存在的文件路径,如果都不存在则返回 None
    """
    # 如果指定的文件存在,直接返回
    if os.path.exists(base_path):
        return base_path
    
    # 移除可能的扩展名
    base_without_ext = os.path.splitext(base_path)[0]
    
    # 尝试 .docx 和 .doc
    for ext in ['.docx', '.doc']:
        full_path = base_without_ext + ext
        if os.path.exists(full_path):
            return full_path
    
    return None


def find_document_in_folder(folder_path, filename):
    """
    在指定文件夹中查找文档,支持 .doc 和 .docx 两种格式
    
    Args:
        folder_path: 文件夹路径
        filename: 文件名(不带扩展名,如 '听抄', '经文', '晨兴')
    
    Returns:
        实际存在的文件路径,如果都不存在则返回 None
    """
    for ext in ['.docx', '.doc']:
        full_path = os.path.join(folder_path, filename + ext)
        if os.path.exists(full_path):
            return full_path
    return None


def scan_resource_folders(resource_dir='resource'):
    """
    扫描 resource 目录下的子文件夹
    
    Args:
        resource_dir: resource 目录路径
    
    Returns:
        子文件夹路径列表
    """
    if not os.path.exists(resource_dir):
        return []
    
    folders = []
    for item in os.listdir(resource_dir):
        item_path = os.path.join(resource_dir, item)
        if os.path.isdir(item_path) and not item.startswith('.'):
            folders.append(item_path)
    
    return sorted(folders)


def process_batch(batch_folder, config):
    """
    处理单个批次的文档生成
    
    Args:
        batch_folder: 批次文件夹路径
        config: 配置字典
    
    Returns:
        成功返回 0,失败返回 1
    """
    batch_name = os.path.basename(batch_folder)
    print("\n" + "="*60)
    print(f" 处理批次: {batch_name}")
    print("="*60)
    print()
    
    # 获取批次特定配置
    batch_config = config.copy()
    default_training = config.get('default_training', {})
    
    # 自动从文件夹名识别季节和年份
    # 支持多种格式:
    #   "2025-秋季" -> year=2025, season="秋季"
    #   "2025-06-感恩节" -> year=2025, season="感恩节"
    #   "2025-04-夏季" -> year=2025, season="夏季"
    if '-' in batch_name:
        parts = batch_name.split('-')
        try:
            year = int(parts[0])
            # 取最后一段作为训练类型(季节/特殊训练名称)
            # 例如: "2025-06-感恩节" -> parts[-1] = "感恩节"
            #      "2025-秋季" -> parts[-1] = "秋季"
            season = parts[-1] if len(parts) > 1 else default_training.get('season', '秋季')
            batch_config['year'] = year
            batch_config['season'] = season
            print(f"✓ 自动识别: {year}年{season}训练")
        except ValueError:
            print(f"⚠ 无法从文件夹名识别年份季节，使用默认配置")
            batch_config['year'] = default_training.get('year', 2025)
            batch_config['season'] = default_training.get('season', '秋季')
    else:
        # 使用默认配置
        batch_config['year'] = default_training.get('year', 2025)
        batch_config['season'] = default_training.get('season', '秋季')
        print(f"⚠ 文件夹名格式不标准，使用默认配置: {batch_config['year']}年{batch_config['season']}")
    
    # 查找文档
    listen_doc = find_document_in_folder(batch_folder, '听抄')
    scripture_doc = find_document_in_folder(batch_folder, '经文')
    morning_revival_doc = find_document_in_folder(batch_folder, '晨兴')
    morning_revival_doc2 = find_document_in_folder(batch_folder, '晨兴2')
    
    if not listen_doc:
        print(f"⚠ 跳过 {batch_name}: 未找到听抄文档")
        return 1
    
    if not scripture_doc:
        print(f"⚠ 跳过 {batch_name}: 未找到经文文档")
        return 1
    
    print(f"✓ 找到听抄文档: {os.path.basename(listen_doc)}")
    print(f"✓ 找到经文文档: {os.path.basename(scripture_doc)}")
    
    morning_revival_docs = []
    if morning_revival_doc:
        morning_revival_docs.append(morning_revival_doc)
        print(f"✓ 找到晨兴文档: {os.path.basename(morning_revival_doc)}")
    if morning_revival_doc2:
        morning_revival_docs.append(morning_revival_doc2)
        print(f"✓ 找到晨兴2文档: {os.path.basename(morning_revival_doc2)}")
    if not morning_revival_docs:
        print(f"⚠ 未找到晨兴文档，将跳过晨兴内容")
    print()
    
    # 解析文档
    output_dir = os.path.join(batch_config['output_dir'], batch_name)
    print("开始解析Word文档...")
    try:
        training_data = parse_training_docs_improved(
            outline_path=scripture_doc,
            listen_path=listen_doc,
            morning_revival_path=morning_revival_docs[0] if morning_revival_docs else None,
            morning_revival_path2=morning_revival_docs[1] if len(morning_revival_docs) > 1 else None,
            title='',  # 不使用配置标题，完全从文档自动提取
            subtitle='',  # 不使用配置副标题，完全从文档自动提取
            year=batch_config['year'],
            season=batch_config['season'],
            output_dir=output_dir
        )
        print(f"✓ 成功解析 {len(training_data.chapters)} 个篇章")
        
        for chapter in training_data.chapters:
            outline_count = len(chapter.outline_sections)
            detail_count = len(chapter.detail_sections)
            print(f"  第{chapter.number}篇: {chapter.title} (纲目{outline_count}个大点, 详情{detail_count}个大点)")
        
        print()
    except Exception as e:
        print(f"✗ 文档解析失败: {e}")
        import traceback
        traceback.print_exc()
        return 1
    
    # 生成HTML (使用已定义的 output_dir)
    print(f"开始生成HTML文件到: {output_dir}")
    try:
        generator = HTMLGenerator(
            template_dir=config['template_dir'],
            output_dir=output_dir
        )
        generator.generate_all(training_data)
        print()
    except Exception as e:
        print(f"✗ HTML生成失败: {e}")
        import traceback
        traceback.print_exc()
        return 1
    
    print("="*60)
    print(f"✓ {batch_name} 所有文件已生成到: {output_dir}")
    print(f"✓ 打开 {output_dir}/index.html 查看结果")
    print("="*60)
    
    return 0


def generate_main_index(config, batch_results):
    """
    生成总主页，链接所有批次
    
    Args:
        config: 配置字典
        batch_results: 批次结果列表，每项包含 {name, year, season, title, chapter_count, path}
    """
    if not batch_results:
        return
    
    output_dir = config.get('output_dir', 'output')
    template_dir = config.get('template_dir', 'src/templates')
    
    # 准备模板数据
    trainings = []
    total_chapters = 0
    
    for result in batch_results:
        trainings.append({
            'year': result['year'],
            'season': result['season'],
            'title': result['title'],
            'chapter_count': result['chapter_count'],
            'path': result['name']  # 相对路径
        })
        total_chapters += result['chapter_count']
    
    # 按年份和季节排序（最新的在前）
    season_order = {'春季': 1, '夏季': 2, '秋季': 3, '冬季': 4}
    trainings.sort(key=lambda x: (x['year'], season_order.get(x['season'], 5)), reverse=True)
    
    # 渲染模板
    env = Environment(loader=FileSystemLoader(template_dir))
    template = env.get_template('main_index.html')
    
    html_content = template.render(
        trainings=trainings,
        total_chapters=total_chapters,
        generation_time=datetime.now().strftime('%Y年%m月%d日 %H:%M')
    )
    
    # 保存主页
    index_path = os.path.join(output_dir, 'index.html')
    with open(index_path, 'w', encoding='utf-8') as f:
        f.write(html_content)
    
    print(f"\n✓ 总主页已生成: {index_path}")


def main():
    """主函数"""
    print("="*60)
    print(" Word文档静态网站生成器 (通用批量版)")
    print("="*60)
    print()
    
    # 加载配置
    try:
        config = load_config()
        print("✓ 配置文件加载成功")
    except Exception as e:
        print(f"✗ 配置文件加载失败: {e}")
        return 1
    
    # 检查是否启用批量处理
    batch_config = config.get('batch_processing', {})
    if not batch_config.get('enabled', True):
        # 单个训练处理模式（使用默认配置）
        default_config = config.get('default_training', {})
        year = default_config.get('year', 2025)
        season = default_config.get('season', '秋季')
        batch_name = f"{year}-{season}"
        batch_folder = os.path.join(config.get('resource_dir', 'resource'), batch_name)
        
        if not os.path.exists(batch_folder):
            print(f"✗ 未找到默认训练文件夹: {batch_folder}")
            return 1
            
        return process_batch(batch_folder, config)
    
    # 批量处理模式
    resource_dir = config.get('resource_dir', 'resource')
    
    # 检查是否指定了特定训练
    specific_trainings = batch_config.get('specific_trainings', [])
    if specific_trainings:
        # 处理指定的训练
        batch_folders = []
        for training in specific_trainings:
            folder_path = os.path.join(resource_dir, training)
            if os.path.exists(folder_path):
                batch_folders.append(folder_path)
            else:
                print(f"⚠ 未找到指定训练文件夹: {folder_path}")
        
        if not batch_folders:
            print("✗ 所有指定的训练文件夹都不存在")
            return 1
    else:
        # 扫描所有可用训练
        batch_folders = scan_resource_folders(resource_dir)
    
    if not batch_folders:
        print(f"✗ 在 {resource_dir} 目录下未找到任何批次文件夹")
        print(f"提示: 请将文档按批次放在 {resource_dir}/批次名称/ 目录下")
        return 1
    
    print(f"✓ 找到 {len(batch_folders)} 个批次:")
    for folder in batch_folders:
        print(f"  - {os.path.basename(folder)}")
    print()
    
    # 处理每个批次
    success_count = 0
    failed_count = 0
    skip_existing = batch_config.get('skip_existing', False)
    batch_results = []  # 收集成功的批次信息
    
    for batch_folder in batch_folders:
        batch_name = os.path.basename(batch_folder)
        output_dir = os.path.join(config['output_dir'], batch_name)
        
        # 检查是否跳过已存在的
        if skip_existing and os.path.exists(output_dir):
            print(f"⏭ 跳过 {batch_name}: 输出目录已存在")
            
            # 尝试读取已有的信息用于主页
            try:
                index_path = os.path.join(output_dir, 'index.html')
                if os.path.exists(index_path):
                    # 从文件夹名提取年份和季节
                    year, season = 2025, "秋季"
                    if '-' in batch_name:
                        parts = batch_name.split('-')
                        try:
                            year = int(parts[0])
                            # 取最后一段作为训练类型
                            season = parts[-1] if len(parts) > 1 else season
                        except ValueError:
                            pass
                    
                    # 简单估算篇章数（可以后续优化为读取实际数据）
                    batch_results.append({
                        'name': batch_name,
                        'year': year,
                        'season': season,
                        'title': f'{year}年{season}训练',
                        'chapter_count': 9,  # 默认值
                        'path': batch_name
                    })
            except:
                pass
            continue
            
        result = process_batch(batch_folder, config)
        if result == 0:
            success_count += 1
            
            # 收集批次信息用于生成主页
            try:
                # 从输出目录读取训练数据
                year, season = 2025, "秋季"
                if '-' in batch_name:
                    parts = batch_name.split('-')
                    try:
                        year = int(parts[0])
                        # 取最后一段作为训练类型
                        season = parts[-1] if len(parts) > 1 else season
                    except ValueError:
                        pass
                
                # 统计章节数
                chapter_count = 0
                for i in range(1, 13):  # 最多12篇
                    if os.path.exists(os.path.join(output_dir, f'{i}_cx.htm')):
                        chapter_count += 1
                
                # 尝试从生成的文件中提取标题（简化版）
                index_path = os.path.join(output_dir, 'index.html')
                title = f'{year}年{season}训练'
                if os.path.exists(index_path):
                    try:
                        with open(index_path, 'r', encoding='utf-8') as f:
                            content = f.read()
                            # 简单提取 <title> 标签内容
                            import re
                            match = re.search(r'<title>(.*?)</title>', content)
                            if match:
                                title = match.group(1).strip()
                    except:
                        pass
                
                batch_results.append({
                    'name': batch_name,
                    'year': year,
                    'season': season,
                    'title': title,
                    'chapter_count': chapter_count,
                    'path': batch_name
                })
            except Exception as e:
                print(f"⚠ 收集批次信息失败: {e}")
        else:
            failed_count += 1
    
    # 生成总主页
    if batch_results:
        try:
            generate_main_index(config, batch_results)
        except Exception as e:
            print(f"⚠ 生成总主页失败: {e}")
            import traceback
            traceback.print_exc()
    
    # 总结
    print("\n" + "="*60)
    print(" 批量生成完成")
    print("="*60)
    print(f"✓ 成功: {success_count} 个批次")
    if failed_count > 0:
        print(f"✗ 失败: {failed_count} 个批次")
    print(f"\n所有输出文件位于: {config['output_dir']}/")
    print("="*60)
    
    return 0 if failed_count == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
