# APK 安装插件调试指南

## 问题现状

用户报告自定义 `ApkInstaller` 插件在新构建的 APK 中显示"不可用"，即使 GitHub Actions 已经创建了插件文件。

## 根本原因分析

自定义 Capacitor 插件需要满足以下条件才能正常工作：

1. **Java 文件存在**：`ApkInstallerPlugin.java` 和 `MainActivity.java` 必须存在于正确的包路径
2. **MainActivity 注册插件**：`MainActivity.onCreate()` 中必须调用 `registerPlugin(ApkInstallerPlugin.class)`
3. **AndroidManifest.xml 配置**：必须使用自定义 `MainActivity` 而不是默认的
4. **Gradle 编译**：Java 文件必须被 Gradle 正确编译到 APK 中

## 已实施的修复

### 1. 改进的 GitHub Actions 工作流

文件：`.github/workflows/android-release-offline.yml`

**关键改进**：

#### A. 在 `cap sync` 之前创建插件文件
```yaml
- name: 创建自定义 APK 安装插件（sync 前）
  # 创建 ApkInstallerPlugin.java 和 MainActivity.java
  # 修改 AndroidManifest.xml 使用自定义 MainActivity
```

#### B. 在 `cap sync` 之后重新应用插件
```yaml
- name: 重新添加自定义 APK 安装插件（sync 后）
  # 重新创建插件文件（因为 sync 可能覆盖）
  # 使用 Python 脚本可靠地修改 AndroidManifest.xml
```

#### C. 使用 Python 脚本修改 AndroidManifest.xml

新的 Python 脚本会：
- 显示修改前后的完整 AndroidManifest.xml 内容
- 使用多种正则表达式模式查找 MainActivity 引用
- 强制替换为 `com.tehui.offline.MainActivity`
- 验证修改是否成功，失败则退出构建

### 2. 详细的调试输出

工作流现在会输出：
- 修改前的完整 AndroidManifest.xml
- 找到的 MainActivity 引用
- 应用的替换规则
- 修改后的 MainActivity 引用
- 验证结果

## 下一步操作

### 1. 触发新的构建

推送一个新的 tag 来触发 GitHub Actions：

```bash
git tag v0.8.42
git push origin v0.8.42
```

### 2. 检查构建日志

在 GitHub Actions 构建日志中，重点查看以下部分：

#### A. "创建自定义 APK 安装插件（sync 前）" 步骤
- 确认 Java 文件已创建
- 确认 AndroidManifest.xml 已修改

#### B. "重新添加自定义 APK 安装插件（sync 后）" 步骤
- 查看"修改前的 AndroidManifest.xml"输出
- 查看 Python 脚本的输出：
  - 原始内容中的 MainActivity 引用
  - 找到的匹配模式
  - 修改后的 MainActivity 引用
- 确认看到"✓✓✓ AndroidManifest.xml 已成功修改"

#### C. 验证插件文件
```
=== 验证自定义插件文件 ===
-rw-r--r-- 1 runner docker  XXX MainActivity.java
-rw-r--r-- 1 runner docker XXXX ApkInstallerPlugin.java
```

### 3. 测试新 APK

下载并安装新构建的 APK，测试更新功能：

1. 打开 APP
2. 触发更新检查
3. 下载新版本
4. 观察安装方法的输出：
   - 方法1（ApkInstaller）：应该显示"成功"而不是"插件不可用"
   - 如果方法1失败，方法2（Share）应该作为备用

## 可能的问题和解决方案

### 问题 1：AndroidManifest.xml 修改失败

**症状**：构建日志显示"✗✗✗ 错误：无法修改 AndroidManifest.xml"

**解决方案**：
1. 查看构建日志中的完整 AndroidManifest.xml 内容
2. 手动检查 MainActivity 的引用格式
3. 如果格式不同，更新 Python 脚本中的正则表达式模式

### 问题 2：插件仍然不可用

**症状**：APK 安装后，插件仍显示"不可用"

**可能原因**：
1. Gradle 未编译 Java 文件
2. MainActivity 未正确注册插件
3. 包名不匹配

**调试步骤**：
1. 反编译 APK 检查是否包含 Java 类：
   ```bash
   unzip TeHui-v0.8.42.apk -d apk_contents
   # 查找 MainActivity.class 和 ApkInstallerPlugin.class
   find apk_contents -name "*.dex" | xargs dexdump | grep "com.tehui.offline"
   ```

2. 检查 AndroidManifest.xml：
   ```bash
   # 使用 apktool 解包
   apktool d TeHui-v0.8.42.apk
   cat TeHui-v0.8.42/AndroidManifest.xml | grep MainActivity
   ```

### 问题 3：Capacitor 覆盖了自定义 MainActivity

**症状**：`cap sync` 后 AndroidManifest.xml 又变回默认的 MainActivity

**解决方案**：
- 当前工作流已经在 `cap sync` 后重新应用插件
- 如果仍然被覆盖，考虑修改 `capacitor.config.json` 添加：
  ```json
  {
    "android": {
      "buildOptions": {
        "signingConfig": "release"
      }
    }
  }
  ```

## 成功标志

当一切正常工作时，你应该看到：

1. **构建日志**：
   - ✓✓✓ AndroidManifest.xml 已成功修改
   - ✓ MainActivity.java 已创建
   - ✓ ApkInstallerPlugin.java 已创建

2. **APP 运行时**：
   - 下载 APK 成功
   - 显示"ApkInstaller: 成功"
   - 系统安装器自动打开

3. **用户体验**：
   - 点击更新后自动下载
   - 下载完成后自动打开安装器
   - 无需手动查找文件

## 联系和支持

如果问题仍然存在，请提供：
1. 完整的 GitHub Actions 构建日志
2. APP 中的 alert 调试信息
3. Android 版本和设备型号
