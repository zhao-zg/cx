# -*- coding: utf-8 -*-
"""
专门混淆 app-update.js 的脚本
保护内部的下载地址和镜像链接
"""
import os
import sys
import shutil
import subprocess


def obfuscate_with_javascript_obfuscator(input_file, output_file):
    """
    使用 javascript-obfuscator 进行深度混淆
    保护下载地址和更新逻辑
    """
    cmd = [
        'npx', 'javascript-obfuscator',
        input_file,
        '--output', output_file,
        '--compact', 'true',
        '--control-flow-flattening', 'true',
        '--control-flow-flattening-threshold', '1',
        '--dead-code-injection', 'true',
        '--dead-code-injection-threshold', '0.4',
        '--debug-protection', 'true',
        '--debug-protection-interval', '4000',
        '--disable-console-output', 'false',
        '--identifier-names-generator', 'hexadecimal',
        '--identifiers-prefix', '_0x',
        '--string-array', 'true',
        '--string-array-calls-transform', 'true',
        '--string-array-calls-transform-threshold', '1',
        '--string-array-encoding', '["rc4"]',
        '--string-array-index-shift', 'true',
        '--string-array-rotate', 'true',
        '--string-array-shuffle', 'true',
        '--string-array-wrappers-count', '5',
        '--string-array-wrappers-chained-calls', 'true',
        '--string-array-wrappers-type', 'function',
        '--string-array-threshold', '1',
        '--transform-object-keys', 'true',
        '--unicode-escape-sequence', 'false',
        '--self-defending', 'true',
        '--simplify', 'true',
        '--split-strings', 'true',
        '--split-strings-chunk-length', '5'
    ]
    
    try:
        result = subprocess.run(cmd, check=True, capture_output=True, text=True)
        return True
    except subprocess.CalledProcessError as e:
        print(f"混淆失败: {e.stderr}")
        return False
    except FileNotFoundError:
        print("错误: 未安装 javascript-obfuscator")
        print("请运行: npm install -g javascript-obfuscator")
        return False

obfuscate_app_update_js(source_file='output/js/app-update.js', create_backup=True):
    """
    混淆 app-update.js 文件
    """
    if not os.path.exists(source_file):
        print(f"错误: 文件不存在 {source_file}")
        return False
    
    print("=" * 60)
    print("🔐 混淆 app-update.js")
    print("=" * 60)
    
    # 1. 备份原始文件（备份到项目根目录，避免被打包进 APK）
    backup_file = 'app-update.js.backup'
    if create_backup:
        if not os.path.exists(backup_file):
            shutil.copy2(source_file, backup_file)
            print(f"✓ 已备份原始文件: {backup_file}")
    
    # 2. 获取原始文件大小
    original_size = os.path.getsize(source_file)
    print(f"\n📖 原始大小: {original_size:,} 字节 ({original_size/1024:.1f} KB)")
    
    # 3. 深度混淆
    print(f"\n🎭 正在混淆...")
    temp_obfuscated = source_file + '.temp.js'
    
    if obfuscate_with_javascript_obfuscator(source_file, temp_obfuscated):
        print("   ✓ 混淆完成")
        # 确保输出是文件
        if os.path.isfile(temp_obfuscated):
            # 替换原文件
            shutil.move(temp_obfuscated, source_file)
            
            final_size = os.path.getsize(source_file)
            print(f"\n📦 混淆后大小: {final_size:,} 字节 ({final_size/1024:.1f} KB)")
            print(f"   膨胀率: {(final_size/original_size-1)*100:.1f}%")
        else:
            print("   ⚠ 混淆输出异常")
            return False
    else:
        print("   ❌ 混淆失败")
        return False
    
    print("\n" + "=" * 60)
    print("✅ 混淆完成!")
    print("=" * 60)
    print(f"\n✓ 已保护的内容:")
    print("  - 下载地址（RC4 加密）")
    print("  - 镜像链接（字符串混淆）")
    print("  - 更新逻辑（控制流平坦化）")
    print("  - 所有变量名（十六进制命名）")
    print(f"\n✓ 保护级别:")
    print("  - 字符串数组加密（RC4）")
    print("  - 控制流平坦化")
    print("  - 死代码注入")
    print("  - 自我防护（防格式化）")
    print("  - 三重加密算法")
    print("  - 第三层：反调试保护")
    print(f"\n⚠️  恢复方法:")
    print(f"  如需恢复原始文件，运行:")
    print(f"  python encrypt_app_update.py --restore")
    
    return True


def restore_original():
    """
    恢复原始文件
    """
    source_file = 'output/js/app-update.js'
    backup_file = 'app-update.js.backup'  # 备份在项目根目录
    
    if not os.path.exists(backup_file):
        print("错误: 未找到备份文件")
        print(f"期望位置: {os.path.abspath(backup_file)}")
        return False
    
    shutil.copy2(backup_file, source_file)
    print(f"✓ 已从备份恢复: {backup_file} -> {source_file}")
    return True


def main():
    """
    命令行入口
    """
    if '--restore' in sys.argv:
        restore_original()
    elif '--help' in sys.argv or '-h' in sys.argv:
        print("用法:")
        print("  python encrypt_app_update.py           # 加密 app-update.js")
        print("  python encrypt_app_update.py --restore # 恢复原始文件")
        print("  python encrypt_app_update.py --help    # 显示帮助")
    else:
        # 检查是否在项目根目录
        if not os.path.exists('output/js/app-update.js'):
            print("错误: 请在项目根目录运行此脚本")
            print("当前目录:", os.getcwd())
            sys.exit(1)
        
        encrypt_app_update_js()


if __name__ == '__main__':
    main()
混淆 app-update.js")
        print("  python encrypt_app_update.py --restore # 恢复原始文件")
        print("  python encrypt_app_update.py --help    # 显示帮助")
    else:
        # 检查是否在项目根目录
        if not os.path.exists('output/js/app-update.js'):
            print("错误: 请在项目根目录运行此脚本")
            print("当前目录:", os.getcwd())
            sys.exit(1)
        
        obfuscate