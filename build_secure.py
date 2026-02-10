# -*- coding: utf-8 -*-
"""
安全构建脚本
集成代码混淆、内容加密、生产配置
"""
import os
import sys
import json
import shutil
import subprocess


def update_capacitor_config_for_production():
    """更新 Capacitor 配置为生产模式"""
    config_path = 'capacitor.config.json'
    
    print("📝 更新 Capacitor 配置...")
    
    with open(config_path, 'r', encoding='utf-8') as f:
        config = json.load(f)
    
    # 关闭调试模式
    if 'android' not in config:
        config['android'] = {}
    
    config['android']['webContentsDebuggingEnabled'] = False
    config['android']['allowMixedContent'] = False
    
    # 备份原配置
    backup_path = config_path + '.dev.backup'
    if not os.path.exists(backup_path):
        shutil.copy2(config_path, backup_path)
        print(f"  ✓ 已备份开发配置到: {backup_path}")
    
    # 写入生产配置
    with open(config_path, 'w', encoding='utf-8') as f:
        json.dump(config, f, indent=2, ensure_ascii=False)
    
    print("  ✓ 已关闭 webContentsDebuggingEnabled")
    print("  ✓ 已关闭 allowMixedContent")


def obfuscate_javascript():
    """混淆 JavaScript 代码"""
    print("\n🔒 混淆 JavaScript 代码...")
    
    # 检查是否安装了 javascript-obfuscator
    try:
        result = subprocess.run(
            ['npx', 'javascript-obfuscator', '--version'],
            capture_output=True,
            text=True,
            check=True
        )
        print(f"  使用 javascript-obfuscator {result.stdout.strip()}")
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("  ⚠ 未安装 javascript-obfuscator，正在安装...")
        subprocess.run(['npm', 'install', '-g', 'javascript-obfuscator'], check=True)
    
    # 混淆 output/js 目录中的所有 JS 文件
    js_dir = 'output/js'
    
    if not os.path.exists(js_dir):
        print(f"  ⚠ 目录不存在: {js_dir}")
        return
    
    js_files = [f for f in os.listdir(js_dir) if f.endswith('.js')]
    
    if not js_files:
        print(f"  ⚠ 未找到 JS 文件: {js_dir}")
        return
    
    print(f"  找到 {len(js_files)} 个 JS 文件")
    
    # 备份原始文件
    backup_dir = 'output/js_original'
    if not os.path.exists(backup_dir):
        os.makedirs(backup_dir, exist_ok=True)
        for js_file in js_files:
            src = os.path.join(js_dir, js_file)
            dst = os.path.join(backup_dir, js_file)
            shutil.copy2(src, dst)
        print(f"  ✓ 已备份原始文件到: {backup_dir}")
    
    # 混淆每个文件
    for js_file in js_files:
        input_path = os.path.join(js_dir, js_file)
        temp_path = input_path + '.obf'
        
        cmd = [
            'npx', 'javascript-obfuscator',
            input_path,
            '--output', temp_path,
            '--compact', 'true',
            '--control-flow-flattening', 'true',
            '--control-flow-flattening-threshold', '0.75',
            '--dead-code-injection', 'true',
            '--dead-code-injection-threshold', '0.4',
            '--string-array', 'true',
            '--string-array-encoding', 'base64',
            '--string-array-threshold', '0.75',
            '--transform-object-keys', 'true',
            '--self-defending', 'true',
            '--disable-console-output', 'false'
        ]
        
        try:
            subprocess.run(cmd, check=True, capture_output=True)
            # 替换原文件
            shutil.move(temp_path, input_path)
            print(f"  ✓ 已混淆: {js_file}")
        except subprocess.CalledProcessError as e:
            print(f"  ✗ 混淆失败: {js_file}")
            if os.path.exists(temp_path):
                os.remove(temp_path)


def add_content_protection():
    """添加内容保护机制"""
    print("\n🛡️ 添加内容保护...")
    
    # 创建解密 JS 文件
    decrypt_js = '''
/**
 * 内容保护模块 - 运行时解密
 */
(function() {
    'use strict';
    
    var _0x4a2b=['cx_protection_v1','charCodeAt','fromCharCode','length'];
    var k=_0x4a2b[0];
    
    window.CXDecrypt={
        d:function(e){
            try{
                var d=atob(e),r='',l=k[_0x4a2b[3]];
                for(var i=0;i<d[_0x4a2b[3]];i++){
                    r+=String[_0x4a2b[2]](d[_0x4a2b[1]](i)^k[_0x4a2b[1]](i%l));
                }
                return r;
            }catch(x){
                return'<p style="color:#999;text-align:center;">内容加载中...</p>';
            }
        }
    };
    
    // 防止调试
    setInterval(function(){
        var d=new Date();
        debugger;
        if(new Date()-d>100){
            window.location.reload();
        }
    },1000);
})();
'''
    
    decrypt_js_path = 'output/js/decrypt.js'
    with open(decrypt_js_path, 'w', encoding='utf-8') as f:
        f.write(decrypt_js)
    print(f"  ✓ 已创建解密模块: {decrypt_js_path}")


def optimize_html():
    """优化 HTML 文件"""
    print("\n⚡ 优化 HTML...")
    
    # 移除注释、压缩空白（简单版）
    import re
    
    html_count = 0
    for root, dirs, files in os.walk('output'):
        for file in files:
            if file.endswith('.htm') or file.endswith('.html'):
                file_path = os.path.join(root, file)
                
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        content = f.read()
                    
                    # 移除 HTML 注释（保留条件注释）
                    content = re.sub(r'<!--(?!\[if).*?-->', '', content, flags=re.DOTALL)
                    
                    # 压缩多余空白（保留 <pre> 和 <script> 标签内容）
                    # 这里只做简单压缩，避免破坏格式
                    content = re.sub(r'\n\s+\n', '\n', content)
                    
                    with open(file_path, 'w', encoding='utf-8') as f:
                        f.write(content)
                    
                    html_count += 1
                except Exception as e:
                    print(f"  ⚠ 优化失败: {file_path} - {e}")
    
    print(f"  ✓ 已优化 {html_count} 个 HTML 文件")


def restore_dev_config():
    """恢复开发配置"""
    backup_path = 'capacitor.config.json.dev.backup'
    config_path = 'capacitor.config.json'
    
    if os.path.exists(backup_path):
        shutil.copy2(backup_path, config_path)
        print(f"✓ 已恢复开发配置")


def main():
    """主函数"""
    print("=" * 60)
    print("🔐 安全构建脚本")
    print("=" * 60)
    
    # 检查是否在项目根目录
    if not os.path.exists('capacitor.config.json'):
        print("错误: 请在项目根目录运行此脚本")
        sys.exit(1)
    
    try:
        # 1. 正常构建
        print("\n📦 运行正常构建...")
        subprocess.run(['python', 'main.py'], check=True)
        
        # 2. 更新配置
        update_capacitor_config_for_production()
        
        # 3. 混淆 JavaScript
        obfuscate_javascript()
        
        # 4. 添加内容保护
        add_content_protection()
        
        # 5. 优化 HTML
        optimize_html()
        
        print("\n" + "=" * 60)
        print("✅ 安全构建完成!")
        print("=" * 60)
        print("\n现在可以运行以下命令打包应用:")
        print("  npm run cap:sync")
        print("  cd android && .\\gradlew assembleRelease")
        print("\n注意: 构建 APK 后记得运行 'python build_secure.py --restore' 恢复开发配置")
        
    except subprocess.CalledProcessError as e:
        print(f"\n❌ 构建失败: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ 发生错误: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    if '--restore' in sys.argv:
        print("恢复开发配置...")
        restore_dev_config()
    else:
        main()
