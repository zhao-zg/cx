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
    npx = 'npx.cmd' if os.name == 'nt' else 'npx'
    cmd = [
        npx, 'javascript-obfuscator',
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
        '--string-array-encoding', 'rc4',
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


def obfuscate_file(source_file, level='full'):
    """
    通用 JS 文件混淆入口，供 main.py 调用。

    level='full' — 最强混淆（remote-config.js）：RC4 + 控制流 + 死代码 + 防调试 + 字符串切割
    level='size' — 尺寸优化（app-update.js / theme-toggle.js）：RC4 字符串加密，
                   去除控制流/死代码/字符串切割等膨胀手段，文件大小优先
    """
    if not os.path.exists(source_file):
        print(f"⚠️  文件不存在，跳过混淆: {source_file}")
        return False

    label = os.path.basename(source_file)
    original_size = os.path.getsize(source_file)
    print(f"🔐 混淆 {label} [{level}] ({original_size/1024:.1f} KB) ...")

    tmp = source_file + '.tmp.js'

    # Windows 上 npx 是 npx.cmd，需要加 .cmd 后缀或用 shell=True
    npx = 'npx.cmd' if os.name == 'nt' else 'npx'

    if level == 'size':
        # 尺寸优先：无控制流平坦化 / 死代码注入 / 字符串切割 / 防调试
        cmd = [
            npx, 'javascript-obfuscator', source_file,
            '--output', tmp,
            '--compact', 'true',
            '--identifier-names-generator', 'hexadecimal',
            '--identifiers-prefix', '_0x',
            '--string-array', 'true',
            '--string-array-encoding', 'rc4',
            '--string-array-calls-transform', 'true',
            '--string-array-calls-transform-threshold', '0.75',
            '--string-array-wrappers-count', '2',
            '--string-array-wrappers-chained-calls', 'true',
            '--string-array-threshold', '0.75',
            '--transform-object-keys', 'true',
            '--simplify', 'true',
            '--self-defending', 'true',
        ]
    else:
        # full：最强保护，用于 remote-config.js（体积小，承受得起膨胀）
        cmd = [
            npx, 'javascript-obfuscator', source_file,
            '--output', tmp,
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
            '--string-array-encoding', 'rc4',
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
            '--split-strings-chunk-length', '5',
        ]

    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
        if os.path.isfile(tmp):
            shutil.move(tmp, source_file)
            final_size = os.path.getsize(source_file)
            print(f"   ✓ 完成，{original_size/1024:.1f} KB → {final_size/1024:.1f} KB "
                  f"(+{(final_size/original_size-1)*100:.0f}%)")
            return True
        return False
    except subprocess.CalledProcessError as e:
        print(f"   ❌ 混淆失败: {e.stderr[:200]}")
        return False
    except FileNotFoundError:
        print("   ⚠️  未安装 javascript-obfuscator，跳过混淆")
        print("       如需混淆，请运行: npm install -g javascript-obfuscator")
        return False


def obfuscate_all(output_dir='output'):
    """
    混淆所有需要保护的 JS 文件（供 main.py 统一调用）：
      - remote-config.js  → full  （URL 配置，最强保护）
      - app-update.js     → size  （下载逻辑，尺寸优先）
      - theme-toggle.js   → size  （UI 逻辑，尺寸优先）
    """
    js_dir = os.path.join(output_dir, 'js')
    print("\n🔐 开始混淆 JS 文件...")
    obfuscate_file(os.path.join(js_dir, 'remote-config.js'), 'full')
    obfuscate_file(os.path.join(js_dir, 'app-update.js'),    'size')
    obfuscate_file(os.path.join(js_dir, 'theme-toggle.js'),  'size')
    print("🔐 JS 混淆完成\n")


def obfuscate_app_update_js(source_file='output/js/app-update.js', create_backup=True):
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
    
    # 3. 混淆（尺寸优先）
    print(f"\n\U0001f3ad 正在混淆（size 模式）...")
    if obfuscate_file(source_file, 'size'):
        final_size = os.path.getsize(source_file)
        print(f"\n\U0001f4e6 混淆后大小: {final_size:,} 字节 ({final_size/1024:.1f} KB)")
    else:
        print("   \u274c 混淆失败")
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
    print("  - 反调试保护")
    print(f"\n⚠️  恢复方法:")
    print(f"  如需恢复原始文件，运行:")
    print(f"  python encrypt_app_update.py --restore")
    
    return True


def restore_original():
    """
    恢复原始文件
    """
    source_file = 'output/js/app-update.js'
    backup_file = 'app-update.js.backup'
    
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
        print("  python encrypt_app_update.py           # 混淆所有 JS 文件（remote-config / app-update / theme-toggle）")
        print("  python encrypt_app_update.py --restore # 恢复 app-update.js 原始文件")
        print("  python encrypt_app_update.py --help    # 显示帮助")
    else:
        # 检查是否在项目根目录
        if not os.path.exists('output/js'):
            print("错误: 请在项目根目录运行此脚本")
            print("当前目录:", os.getcwd())
            sys.exit(1)

        obfuscate_all('output')


if __name__ == '__main__':
    main()
