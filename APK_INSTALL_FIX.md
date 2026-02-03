# APK 安装问题修复说明

## 问题描述

用户报告：APK 能下载成功（进度条到 95%），但无法打开系统安装程序，重新进入后版本还是旧的。

## 根本原因

1. **文件保存位置不当**：使用 `CACHE` 目录，系统可能无法识别或访问
2. **文件 URI 格式问题**：Android 7.0+ 需要使用 `content://` URI 而不是 `file://`
3. **缺少调试信息**：移动端无法查看控制台，难以定位问题
4. **安装方法单一**：只尝试一种方法，失败后没有备用方案

## 解决方案

### 1. 更改文件保存位置

**修改前**：
```javascript
var filepath = 'downloads/' + filename;
var DIRECTORY_CACHE = 'CACHE';
```

**修改后**：
```javascript
var filepath = 'Download/' + filename; // Android Download 目录
var DIRECTORY_EXTERNAL = 'EXTERNAL'; // 使用外部存储
```

**优势**：
- 用户可以在文件管理器中轻松找到
- 不需要额外的存储权限（Android 10+）
- 系统可以直接识别和打开 APK

### 2. 添加权限检查

在下载前自动检查并请求存储权限（Android 10 以下）：

```javascript
// 检查并请求存储权限（Android 10 以下）
if (androidVersion < 10) {
    if (window.Capacitor.Plugins.Permissions) {
        var result = await window.Capacitor.Plugins.Permissions.query({ name: 'storage' });
        if (result.state !== 'granted') {
            await window.Capacitor.Plugins.Permissions.request({ name: 'storage' });
        }
    }
}
```

### 3. 改进安装方法

**修改前**：尝试 4 种方法（FileOpener、Browser、App、window.open）

**修改后**：优化为 3 种更可靠的方法：

1. **FileOpener 插件**（推荐）：
   - 自动处理 URI 格式转换
   - 支持 Android 7.0+ 的 FileProvider

2. **Android Intent**（备用）：
   - 直接使用 Android Intent URL scheme
   - 绕过 Capacitor 插件限制

3. **App.openUrl**（最后尝试）：
   - Capacitor 内置方法
   - 兼容性最好

### 4. 添加详细的调试信息

在关键步骤添加 alert 提示（移动端可见）：

```javascript
// FileOpener 失败时
alert('[调试] FileOpener 失败:\n' + e.message + '\n\nURI: ' + fileUri);

// Intent 失败时
alert('[调试] Intent 失败:\n' + e.message);

// App.openUrl 失败时
alert('[调试] App.openUrl 失败:\n' + e.message + '\n\nURI: ' + fileUri);
```

### 5. 优化用户提示

**修改前**：
```javascript
message += '1. 系统会弹出安装界面\n';
```

**修改后**：
```javascript
message += '1. 系统应该会自动弹出安装界面\n';
message += '• 如果没有弹出安装界面，请到文件管理器的 Download 目录手动安装\n';
```

## 文件修改清单

### 1. `src/static/js/app-update.js`

- ✅ 更改文件保存位置：`CACHE` → `EXTERNAL/Download/`
- ✅ 添加权限检查（Android 10 以下）
- ✅ 优化安装方法（3 种可靠方法）
- ✅ 添加 URI 格式转换（file:// → content://）
- ✅ 添加详细的调试 alert 提示
- ✅ 改进错误处理和用户指引

### 2. `src/templates/main_index.html`

- ✅ 优化下载完成提示信息
- ✅ 调整提示延迟时间（1000ms → 500ms）

### 3. `ANDROID_PERMISSIONS.md`

- ✅ 更新权限配置说明
- ✅ 添加 `<queries>` 配置（Android 11+）
- ✅ 强调 FileProvider 的重要性
- ✅ 添加详细的故障排查指南
- ✅ 添加调试技巧说明

### 4. `.github/workflows/android-release-offline.yml`

- ✅ 已配置所有必需权限（之前已完成）
- ✅ 已配置 FileProvider（之前已完成）
- ✅ 已配置 `<queries>`（之前已完成）

## 测试步骤

1. **重新构建 APK**：
   ```bash
   npx cap sync
   npx cap open android
   ```

2. **在 Android Studio 中构建并安装**

3. **测试更新流程**：
   - 点击 Logo 8 次触发更新检查
   - 观察下载进度（应显示速度和已下载大小）
   - 下载完成后观察是否自动弹出安装界面
   - 如果失败，查看 alert 提示的错误信息

4. **手动测试**（如果自动安装失败）：
   - 打开文件管理器
   - 进入 Download 目录
   - 找到 APK 文件
   - 点击安装

## 预期效果

### 成功场景

1. **下载阶段**：
   - 显示实时速度（KB/s）
   - 显示已下载大小（MB）
   - 进度条平滑更新

2. **安装阶段**：
   - 自动弹出系统安装界面
   - 首次安装提示授予"安装未知应用"权限
   - 用户点击"安装"完成更新

3. **完成提示**：
   - 显示使用的下载源
   - 显示详细的安装步骤
   - 提供手动安装指引

### 失败场景

如果自动安装失败，会显示：
- 具体的错误信息
- 文件保存路径（fileUri）
- 手动安装步骤
- 故障排查建议

## 关键改进点

1. **文件位置**：`EXTERNAL/Download/` 更容易被系统识别
2. **权限处理**：自动检查和请求必需权限
3. **安装方法**：3 种可靠方法，逐个尝试
4. **调试信息**：alert 提示帮助定位问题
5. **用户体验**：详细的提示和指引

## 注意事项

1. **FileOpener 插件**：确保已安装 `@capacitor-community/file-opener`
2. **权限配置**：确保 AndroidManifest.xml 中有所有必需权限
3. **FileProvider**：确保 file_paths.xml 正确配置
4. **测试环境**：在真机上测试，模拟器可能有限制

## 后续优化建议

1. **添加自定义 Capacitor 插件**：
   - 直接调用 Android PackageInstaller API
   - 更可靠的安装方式

2. **改进权限请求**：
   - 在首次启动时预先请求权限
   - 提供权限说明对话框

3. **添加安装状态监听**：
   - 监听安装完成事件
   - 自动重启应用

4. **优化下载体验**：
   - 支持断点续传
   - 支持后台下载
