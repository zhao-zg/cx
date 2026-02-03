#!/usr/bin/env python3
"""
修复 GitHub Actions 工作流，简化自定义插件的处理
"""

import re

workflow_file = '.github/workflows/android-release-offline.yml'

with open(workflow_file, 'r', encoding='utf-8') as f:
    content = f.read()

# 找到"重新添加自定义 APK 安装插件（sync 后）"步骤
# 替换整个步骤为简化版本

new_step = '''    - name: 配置 AndroidManifest.xml 使用自定义 MainActivity（sync 后）
      run: |
        echo "=== 配置 AndroidManifest.xml 使用自定义 MainActivity ==="
        echo "注意：cap sync 会重新生成 AndroidManifest.xml，需要修改它使用我们的自定义 MainActivity"
        echo "自定义插件文件已在 Git 仓库中：android/app/src/main/java/com/tehui/offline/"
        
        # 验证插件文件存在
        echo ""
        echo "=== 验证自定义插件文件 ==="
        if [ -f "android/app/src/main/java/com/tehui/offline/MainActivity.java" ]; then
          echo "✓ MainActivity.java 存在"
        else
          echo "✗ MainActivity.java 不存在"
          exit 1
        fi
        
        if [ -f "android/app/src/main/java/com/tehui/offline/ApkInstallerPlugin.java" ]; then
          echo "✓ ApkInstallerPlugin.java 存在"
        else
          echo "✗ ApkInstallerPlugin.java 不存在"
          exit 1
        fi
        
        manifest_file="android/app/src/main/AndroidManifest.xml"
        
        # 显示修改前的内容
        echo ""
        echo "=== 修改前的 AndroidManifest.xml ==="
        cat "$manifest_file"
        echo "=== 结束 ==="
        echo ""
        
        # 使用 Python 脚本进行可靠的 XML 修改
        cat > modify_manifest.py << 'PYTHON_EOF'
        import re
        
        manifest_file = 'android/app/src/main/AndroidManifest.xml'
        
        with open(manifest_file, 'r') as f:
            content = f.read()
        
        print('原始内容中的 MainActivity 引用:')
        for line in content.split('\\n'):
            if 'MainActivity' in line:
                print(f'  {line.strip()}')
        print('')
        
        # 查找并替换 MainActivity 引用
        patterns = [
            (r'android:name="\\.MainActivity"', 'android:name="com.tehui.offline.MainActivity"'),
            (r'android:name="MainActivity"', 'android:name="com.tehui.offline.MainActivity"'),
            (r'android:name="(?!com\\.tehui\\.offline\\.MainActivity)[^"]*MainActivity"', 'android:name="com.tehui.offline.MainActivity"'),
        ]
        
        modified = False
        for pattern, replacement in patterns:
            matches = re.findall(pattern, content)
            if matches:
                print(f'✓ 找到匹配: {pattern}')
                print(f'  匹配项: {matches}')
                content = re.sub(pattern, replacement, content)
                modified = True
        
        if not modified:
            print('⚠️ 警告：未找到标准 MainActivity 模式，尝试强制替换...')
            activity_match = re.search(r'<activity([^>]*)>', content)
            if activity_match:
                activity_tag = activity_match.group(0)
                print(f'找到 activity 标签: {activity_tag}')
                if 'android:name=' in activity_tag:
                    new_tag = re.sub(r'android:name="[^"]*"', 'android:name="com.tehui.offline.MainActivity"', activity_tag)
                    content = content.replace(activity_tag, new_tag)
                    print(f'✓ 替换为: {new_tag}')
                    modified = True
                else:
                    new_tag = activity_tag.replace('<activity', '<activity android:name="com.tehui.offline.MainActivity"')
                    content = content.replace(activity_tag, new_tag)
                    print(f'✓ 添加 android:name: {new_tag}')
                    modified = True
        
        with open(manifest_file, 'w') as f:
            f.write(content)
        
        print('')
        print('修改后的 MainActivity 引用:')
        for line in content.split('\\n'):
            if 'MainActivity' in line:
                print(f'  {line.strip()}')
        
        if modified:
            print('\\n✓✓✓ AndroidManifest.xml 已成功修改')
        else:
            print('\\n✗✗✗ 错误：无法修改 AndroidManifest.xml')
            exit(1)
        PYTHON_EOF
        
        python3 modify_manifest.py
        
        # 验证是否成功
        if grep -q "com.tehui.offline.MainActivity" "$manifest_file"; then
          echo ""
          echo "✓✓✓ 验证成功：AndroidManifest.xml 包含自定义 MainActivity"
        else
          echo ""
          echo "✗✗✗ 验证失败"
          exit 1
        fi
        
        echo ""
        echo "✓ AndroidManifest.xml 配置完成"
'''

# 找到步骤的开始和结束
pattern = r'    - name: 重新添加自定义 APK 安装插件（sync 后）\n      run: \|.*?(?=\n    - name:)'

match = re.search(pattern, content, re.DOTALL)
if match:
    content = content[:match.start()] + new_step + '\n' + content[match.end():]
    print('✓ 已替换"重新添加自定义 APK 安装插件（sync 后）"步骤')
else:
    print('✗ 未找到"重新添加自定义 APK 安装插件（sync 后）"步骤')
    exit(1)

with open(workflow_file, 'w', encoding='utf-8') as f:
    f.write(content)

print(f'✓ 工作流文件已更新: {workflow_file}')
