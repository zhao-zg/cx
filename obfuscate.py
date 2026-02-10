# -*- coding: utf-8 -*-
"""
JavaScript 代码混淆工具
使用 javascript-obfuscator 对 JS 文件进行混淆
"""
import os
import subprocess
import sys


def obfuscate_js_file(input_file: str, output_file: str = None, options: dict = None):
    """
    混淆单个 JS 文件
    
    Args:
        input_file: 输入 JS 文件路径
        output_file: 输出文件路径，如果不指定则覆盖原文件
        options: 混淆选项
    """
    if output_file is None:
        output_file = input_file
    
    # 默认混淆选项
    default_options = {
        'compact': True,
        'controlFlowFlattening': True,
        'controlFlowFlatteningThreshold': 0.75,
        'deadCodeInjection': True,
        'deadCodeInjectionThreshold': 0.4,
        'debugProtection': False,
        'debugProtectionInterval': 0,
        'disableConsoleOutput': False,
        'identifierNamesGenerator': 'hexadecimal',
        'log': False,
        'numbersToExpressions': True,
        'renameGlobals': False,
        'selfDefending': True,
        'simplify': True,
        'splitStrings': True,
        'splitStringsChunkLength': 10,
        'stringArray': True,
        'stringArrayCallsTransform': True,
        'stringArrayEncoding': ['base64'],
        'stringArrayIndexShift': True,
        'stringArrayRotate': True,
        'stringArrayShuffle': True,
        'stringArrayWrappersCount': 2,
        'stringArrayWrappersChainedCalls': True,
        'stringArrayWrappersParametersMaxCount': 4,
        'stringArrayWrappersType': 'function',
        'stringArrayThreshold': 0.75,
        'transformObjectKeys': True,
        'unicodeEscapeSequence': False
    }
    
    if options:
        default_options.update(options)
    
    # 构建命令行选项
    cmd = ['npx', 'javascript-obfuscator', input_file, '--output', output_file]
    
    for key, value in default_options.items():
        if isinstance(value, bool):
            if value:
                cmd.append(f'--{key}')
        elif isinstance(value, list):
            cmd.append(f'--{key}')
            cmd.append(','.join(str(v) for v in value))
        else:
            cmd.append(f'--{key}')
            cmd.append(str(value))
    
    print(f"正在混淆: {input_file} -> {output_file}")
    
    try:
        result = subprocess.run(cmd, check=True, capture_output=True, text=True)
        print(f"✓ 混淆成功: {output_file}")
        return True
    except subprocess.CalledProcessError as e:
        print(f"✗ 混淆失败: {input_file}")
        print(f"  错误: {e.stderr}")
        return False
    except FileNotFoundError:
        print("错误: 未找到 javascript-obfuscator")
        print("请运行: npm install -g javascript-obfuscator")
        return False


def obfuscate_directory(input_dir: str, output_dir: str = None, file_pattern: str = "*.js"):
    """
    混淆目录中的所有 JS 文件
    
    Args:
        input_dir: 输入目录
        output_dir: 输出目录，如果不指定则覆盖原文件
        file_pattern: 文件匹配模式
    """
    import glob
    
    if output_dir and output_dir != input_dir:
        os.makedirs(output_dir, exist_ok=True)
    
    js_files = glob.glob(os.path.join(input_dir, file_pattern))
    
    if not js_files:
        print(f"未找到 JS 文件: {input_dir}/{file_pattern}")
        return
    
    print(f"找到 {len(js_files)} 个 JS 文件")
    
    success_count = 0
    for js_file in js_files:
        if output_dir and output_dir != input_dir:
            rel_path = os.path.relpath(js_file, input_dir)
            output_file = os.path.join(output_dir, rel_path)
            os.makedirs(os.path.dirname(output_file), exist_ok=True)
        else:
            output_file = js_file
        
        if obfuscate_js_file(js_file, output_file):
            success_count += 1
    
    print(f"\n完成: {success_count}/{len(js_files)} 个文件混淆成功")


def main():
    """命令行入口"""
    if len(sys.argv) < 2:
        print("用法:")
        print("  python obfuscate.py <文件或目录>")
        print("  python obfuscate.py output/js")
        sys.exit(1)
    
    path = sys.argv[1]
    
    if os.path.isfile(path):
        obfuscate_js_file(path)
    elif os.path.isdir(path):
        obfuscate_directory(path)
    else:
        print(f"错误: 路径不存在: {path}")
        sys.exit(1)


if __name__ == '__main__':
    main()
