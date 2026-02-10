# -*- coding: utf-8 -*-
"""
专门加密 app-update.js 的脚本
保护内部的下载地址和镜像链接
"""
import os
import sys
import base64
import json
import shutil
import subprocess


def simple_encrypt(content, key='cx_secure_2026_protection'):
    """
    多层加密：XOR + Base64 + 字符替换
    """
    # 第一层：XOR 加密
    encrypted_bytes = bytearray()
    key_len = len(key)
    content_bytes = content.encode('utf-8')
    
    for i, byte in enumerate(content_bytes):
        encrypted_bytes.append(byte ^ ord(key[i % key_len]))
    
    # 第二层：Base64 编码
    b64 = base64.b64encode(bytes(encrypted_bytes)).decode('utf-8')
    
    # 第三层：字符替换混淆
    b64 = b64.replace('A', 'Ω').replace('B', 'Ψ').replace('=', 'Φ')
    
    return b64


def generate_loader_script(encrypted_data):
    """
    生成加载器脚本（混淆版）
    """
    return f'''/**
 * 应用更新模块 - 加密版本
 * DO NOT MODIFY - 此文件已加密保护
 */
(function() {{
    'use strict';
    
    // 解密密钥（分散存储）
    var _0x=['cx','_se','cur','e_2','026','_pr','ote','cti','on'];
    var k=_0x[0]+_0x[1]+_0x[2]+_0x[3]+_0x[4]+_0x[5]+_0x[6]+_0x[7]+_0x[8];
    
    // 加密数据
    var _d='{encrypted_data}';
    
    // 解密函数
    function _dec(e,k){{
        try{{
            // 反向字符替换
            e=e.replace(/Ω/g,'A').replace(/Ψ/g,'B').replace(/Φ/g,'=');
            // Base64 解码
            var b64=atob(e);
            // 转换为字节数组
            var bytes=new Uint8Array(b64.length);
            for(var i=0;i<b64.length;i++){{
                bytes[i]=b64.charCodeAt(i);
            }}
            // XOR 解密
            var result=new Uint8Array(bytes.length);
            var kl=k.length;
            for(var i=0;i<bytes.length;i++){{
                result[i]=bytes[i]^k.charCodeAt(i%kl);
            }}
            // 转换为 UTF-8 字符串
            var decoder=new TextDecoder('utf-8');
            return decoder.decode(result);
        }}catch(x){{
            console.error('[加密模块] 解密失败',x);
            return null;
        }}
    }}
    
    // 反调试保护
    var _t=0;
    setInterval(function(){{
        var s=new Date();
        debugger;
        if(new Date()-s>100){{
            console.clear();
            window.location.reload();
        }}
    }},3000);
    
    // 加载并执行
    try{{
        var code=_dec(_d,k);
        if(code){{
            // 使用 Function 构造器执行（避免 eval）
            new Function(code)();
        }}else{{
            throw new Error('解密失败');
        }}
    }}catch(e){{
        console.error('[加密模块] 初始化失败:',e.message);
    }}
}})();
'''


def obfuscate_with_javascript_obfuscator(input_file, output_file):
    """
    使用 javascript-obfuscator 进行深度混淆
    """
    cmd = [
        'npx', 'javascript-obfuscator',
        input_file,
        '--output', output_file,
        '--compact', 'true',
        '--control-flow-flattening', 'true',
        '--control-flow-flattening-threshold', '1',
        '--dead-code-injection', 'true',
        '--dead-code-injection-threshold', '0.5',
        '--debug-protection', 'false',
        '--debug-protection-interval', '0',
        '--disable-console-output', 'false',
        '--identifier-names-generator', 'mangled',
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
        subprocess.run(cmd, check=True, capture_output=True, text=True)
        return True
    except subprocess.CalledProcessError as e:
        print(f"混淆失败: {e.stderr}")
        return False
    except FileNotFoundError:
        print("错误: 未安装 javascript-obfuscator")
        print("请运行: npm install -g javascript-obfuscator")
        return False


def encrypt_app_update_js(source_file='output/js/app-update.js', create_backup=True):
    """
    加密 app-update.js 文件
    """
    if not os.path.exists(source_file):
        print(f"错误: 文件不存在 {source_file}")
        return False
    
    print("=" * 60)
    print("🔐 加密 app-update.js")
    print("=" * 60)
    
    # 1. 备份原始文件（备份到 output/ 外部，避免被打包进 APK）
    if create_backup:
        backup_file = 'app-update.js.backup'  # 备份到项目根目录
        if not os.path.exists(backup_file):
            shutil.copy2(source_file, backup_file)
            print(f"✓ 已备份原始文件: {backup_file}（不会被打包进 APK）")
    
    # 2. 读取原始内容
    print(f"\n📖 读取源文件: {source_file}")
    with open(source_file, 'r', encoding='utf-8') as f:
        original_content = f.read()
    
    original_size = len(original_content)
    print(f"   原始大小: {original_size:,} 字节 ({original_size/1024:.1f} KB)")
    
    # 3. 第一次混淆（使用 javascript-obfuscator）
    print(f"\n🎭 第一层：深度混淆...")
    temp_obfuscated = source_file + '.temp.js'
    
    if obfuscate_with_javascript_obfuscator(source_file, temp_obfuscated):
        print("   ✓ 第一层混淆完成")
        # 确保输出是文件而非目录
        if os.path.isfile(temp_obfuscated):
            with open(temp_obfuscated, 'r', encoding='utf-8') as f:
                obfuscated_content = f.read()
            os.remove(temp_obfuscated)
        else:
            print("   ⚠ 混淆输出异常，使用原始内容")
            obfuscated_content = original_content
    else:
        print("   ⚠ 混淆工具未安装，跳过混淆步骤")
        obfuscated_content = original_content
    
    # 4. 加密混淆后的内容
    print(f"\n🔒 第二层：内容加密...")
    encrypted_data = simple_encrypt(obfuscated_content)
    print(f"   加密后大小: {len(encrypted_data):,} 字节")
    
    # 5. 生成加载器
    print(f"\n📦 第三层：生成加载器...")
    loader_code = generate_loader_script(encrypted_data)
    
    # 6. 写入最终文件
    with open(source_file, 'w', encoding='utf-8') as f:
        f.write(loader_code)
    
    final_size = len(loader_code)
    print(f"   最终大小: {final_size:,} 字节 ({final_size/1024:.1f} KB)")
    print(f"   膨胀率: {(final_size/original_size-1)*100:.1f}%")
    
    print("\n" + "=" * 60)
    print("✅ 加密完成!")
    print("=" * 60)
    print(f"\n✓ 已保护的内容:")
    print("  - 下载地址")
    print("  - 镜像链接")
    print("  - 更新逻辑")
    print("  - 所有字符串常量")
    print(f"\n✓ 保护级别:")
    print("  - 第一层：深度代码混淆")
    print("  - 第二层：三重加密算法")
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
