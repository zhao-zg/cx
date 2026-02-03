# Android 权限配置指南

## APK 安装权限

要让 APP 能够下载并安装 APK 更新，需要在 Android 项目中配置以下权限。

### 1. 编辑 `android/app/src/main/AndroidManifest.xml`

在 `<manifest>` 标签内添加以下权限：

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="你的包名">

    <!-- 网络权限（下载 APK） -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    
    <!-- 存储权限（保存 APK 文件，Android 10 以下需要） -->
    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" 
        android:maxSdkVersion="32" />
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE"
        android:maxSdkVersion="32" />
    
    <!-- Android 8.0+ 安装 APK 权限 -->
    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />
    
    <!-- Android 11+ 查询已安装应用 -->
    <queries>
        <intent>
            <action android:name="android.intent.action.VIEW" />
            <data android:mimeType="application/vnd.android.package-archive" />
        </intent>
    </queries>
    
    <application
        ...>
        
        <!-- FileProvider 配置（用于分享 APK 文件，Android 7.0+ 必需） -->
        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="${applicationId}.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/file_paths" />
        </provider>
        
    </application>
</manifest>
```

### 2. 创建 `android/app/src/main/res/xml/file_paths.xml`

如果 `res/xml` 目录不存在，先创建它，然后创建 `file_paths.xml`：

```xml
<?xml version="1.0" encoding="utf-8"?>
<paths xmlns:android="http://schemas.android.com/apk/res/android">
    <!-- 缓存目录 -->
    <cache-path name="cache" path="." />
    
    <!-- 外部存储（推荐用于 APK 安装） -->
    <external-path name="external" path="." />
    
    <!-- 外部缓存 -->
    <external-cache-path name="external_cache" path="." />
    
    <!-- 下载目录（APK 保存位置） -->
    <external-path name="downloads" path="Download/" />
</paths>
```

### 3. 安装 Capacitor 插件

#### FileOpener 插件（推荐，用于打开 APK 安装程序）

```bash
npm install @capacitor-community/file-opener
npx cap sync
```

在 `capacitor.config.json` 中配置：

```json
{
  "plugins": {
    "FileOpener": {
      "androidXEnabled": true
    }
  }
}
```

### 4. APK 下载和安装流程

代码会自动处理以下流程：

1. **检查权限**：
   - Android 10 以下：自动请求存储权限
   - Android 8.0+：系统会在安装时自动请求 `REQUEST_INSTALL_PACKAGES` 权限

2. **下载 APK**：
   - 使用 CapacitorHttp 避免跨域问题
   - 分块下载显示实时进度
   - 保存到 `EXTERNAL/Download/` 目录（系统 Download 文件夹）

3. **打开安装程序**：
   - 方法1：FileOpener 插件（推荐）
   - 方法2：Android Intent（备用）
   - 方法3：App.openUrl（备用）
   - 如果都失败，提示用户手动安装

### 5. 文件保存位置

- **目录**：`EXTERNAL/Download/`（对应系统的 Download 文件夹）
- **优势**：
  - 用户可以在文件管理器中轻松找到
  - 不需要额外的存储权限（Android 10+）
  - 系统可以直接识别和打开 APK

### 6. 常见问题

#### Q: 下载成功但无法打开安装程序
**A**: 可能的原因和解决方案：
1. **FileOpener 插件未安装**：运行 `npm install @capacitor-community/file-opener && npx cap sync`
2. **权限未配置**：检查 AndroidManifest.xml 中的权限和 FileProvider 配置
3. **文件路径格式错误**：代码会自动尝试多种方法，查看 alert 提示的错误信息
4. **Android 7.0+ FileProvider 问题**：确保 file_paths.xml 正确配置

#### Q: 提示"未知来源"或"安装被阻止"
**A**: 
- Android 8.0+：系统会自动引导用户到设置页面授予"安装未知应用"权限
- 用户需要手动允许该权限

#### Q: Android 11+ 无法访问文件
**A**: 
- 使用 `EXTERNAL` 目录的 `Download/` 子目录，不需要额外权限
- 确保 AndroidManifest.xml 中有 `<queries>` 配置

#### Q: 安装时提示"解析包出现问题"
**A**: 
1. 确认下载完整（检查文件大小）
2. 清除旧版本后重新安装
3. 确保安卓版本 ≥ 5.1（API 22）
4. 尝试在设置中清除下载管理器的缓存

### 7. 调试技巧

代码会在关键步骤显示 alert 提示，包括：
- 文件保存路径（fileUri）
- 错误详情
- 尝试的安装方法

如果遇到问题，请查看这些提示信息，可以帮助定位问题。

## 权限说明

| 权限 | 用途 | 必需 | 版本要求 |
|------|------|------|----------|
| INTERNET | 下载 APK | ✅ | 所有版本 |
| ACCESS_NETWORK_STATE | 检查网络状态 | ✅ | 所有版本 |
| WRITE_EXTERNAL_STORAGE | 保存文件 | ⚠️ | Android 10 以下 |
| READ_EXTERNAL_STORAGE | 读取文件 | ⚠️ | Android 10 以下 |
| REQUEST_INSTALL_PACKAGES | 安装 APK | ✅ | Android 8.0+ |

⚠️ = Android 11+ 不需要（使用 Scoped Storage）

## 测试步骤

1. 重新构建 Android 项目：
   ```bash
   npx cap sync
   npx cap open android
   ```

2. 在 Android Studio 中运行项目

3. 在 APP 中点击 Logo 8 次触发更新检查

4. 测试 APK 下载和安装功能

5. 观察 alert 提示信息，确认每个步骤是否成功
