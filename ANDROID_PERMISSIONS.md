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
    
    <!-- 存储权限（保存 APK 文件） -->
    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" 
        android:maxSdkVersion="32" />
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE"
        android:maxSdkVersion="32" />
    
    <!-- Android 8.0+ 安装 APK 权限 -->
    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />
    
    <application
        ...>
        
        <!-- FileProvider 配置（用于分享 APK 文件） -->
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
    
    <!-- 外部存储 -->
    <external-path name="external" path="." />
    
    <!-- 外部缓存 -->
    <external-cache-path name="external_cache" path="." />
    
    <!-- 下载目录 -->
    <external-path name="downloads" path="Download/" />
</paths>
```

### 3. 安装 Capacitor 插件

#### FileOpener 插件（推荐）

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

#### 或者使用 Capacitor Browser 插件

```bash
npm install @capacitor/browser
npx cap sync
```

### 4. 运行时权限请求（可选）

如果需要在运行时请求权限，可以添加以下代码：

```javascript
// 请求存储权限（Android 6.0+）
async function requestStoragePermission() {
    if (window.Capacitor && window.Capacitor.Plugins.Permissions) {
        const result = await window.Capacitor.Plugins.Permissions.query({
            name: 'storage'
        });
        
        if (result.state !== 'granted') {
            await window.Capacitor.Plugins.Permissions.request({
                name: 'storage'
            });
        }
    }
}

// 在下载前调用
await requestStoragePermission();
```

### 5. Android 11+ 特殊处理

Android 11 (API 30) 及以上版本需要在 `AndroidManifest.xml` 中添加：

```xml
<application
    ...
    android:requestLegacyExternalStorage="true">
    ...
</application>
```

或者使用 Scoped Storage：

```xml
<manifest ...>
    <queries>
        <intent>
            <action android:name="android.intent.action.VIEW" />
            <data android:mimeType="application/vnd.android.package-archive" />
        </intent>
    </queries>
</manifest>
```

## 测试

1. 重新构建 Android 项目：
   ```bash
   npx cap sync
   npx cap open android
   ```

2. 在 Android Studio 中运行项目

3. 测试 APK 下载和安装功能

## 常见问题

### Q: 安装时提示"未知来源"
**A**: 用户需要在系统设置中允许"安装未知应用"。代码会自动引导用户到设置页面。

### Q: 下载后无法打开安装程序
**A**: 检查：
1. `REQUEST_INSTALL_PACKAGES` 权限是否已添加
2. FileProvider 是否正确配置
3. file_paths.xml 是否存在

### Q: Android 11+ 无法访问文件
**A**: 使用 Capacitor Filesystem API 的 `CACHE` 目录，不需要存储权限。

## 权限说明

| 权限 | 用途 | 必需 |
|------|------|------|
| INTERNET | 下载 APK | ✅ |
| ACCESS_NETWORK_STATE | 检查网络状态 | ✅ |
| WRITE_EXTERNAL_STORAGE | 保存文件（Android 10-） | ⚠️ |
| READ_EXTERNAL_STORAGE | 读取文件（Android 10-） | ⚠️ |
| REQUEST_INSTALL_PACKAGES | 安装 APK（Android 8.0+） | ✅ |

⚠️ = Android 11+ 不需要（使用 Scoped Storage）
