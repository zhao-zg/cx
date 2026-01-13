# 安装Capacitor插件

## 安装所需插件

为了支持APK应用内下载和安装功能，需要安装以下Capacitor插件：

```bash
# 安装依赖
npm install

# 或者手动安装各个插件
npm install @capacitor/filesystem@^6.0.0
npm install @capacitor-community/http@^6.0.0
```

## 同步到Android项目

```bash
npx cap sync android
```

## 配置Android权限

编辑 `android/app/src/main/AndroidManifest.xml`，添加以下权限：

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    
    <!-- 网络权限 -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    
    <!-- 存储权限 -->
    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" 
                     android:maxSdkVersion="32" />
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE"
                     android:maxSdkVersion="32" />
    
    <!-- Android 13+ 需要的权限 -->
    <uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
    <uses-permission android:name="android.permission.READ_MEDIA_VIDEO" />
    <uses-permission android:name="android.permission.READ_MEDIA_AUDIO" />
    
    <!-- 安装APK权限 -->
    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />
    
    <application>
        <!-- 允许安装未知来源应用 (Android 7.0+) -->
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

## 创建FileProvider配置

创建文件 `android/app/src/main/res/xml/file_paths.xml`：

```xml
<?xml version="1.0" encoding="utf-8"?>
<paths xmlns:android="http://schemas.android.com/apk/res/android">
    <cache-path name="cache" path="." />
    <external-path name="external" path="." />
    <external-files-path name="external_files" path="." />
</paths>
```

## 构建APK

```bash
# 同步资源
npx cap sync android

# 打开Android Studio
npx cap open android

# 在Android Studio中:
# 1. Build -> Generate Signed Bundle / APK
# 2. 选择 APK
# 3. 选择或创建签名密钥
# 4. 选择 release 构建类型
# 5. 点击 Finish
```

## 测试更新功能

1. 安装旧版本APK到设备
2. 确保设备可以访问网络
3. 打开应用，点击"检查更新"
4. 应该能看到下载进度
5. 下载完成后会提示安装

## 故障排除

### 下载失败
- 检查网络连接
- 确认version.json中的apk_url正确
- 查看浏览器控制台日志

### 无法安装
- 确认已添加 REQUEST_INSTALL_PACKAGES 权限
- 检查设备是否允许"安装未知来源应用"
- 确认APK签名一致

### 插件不可用
- 运行 `npx cap sync android`
- 清理并重新构建项目
- 检查package.json中的依赖版本

## 注意事项

1. **签名一致性**: 新旧版本必须使用相同的签名密钥
2. **Android版本**: 建议Android 7.0 (API 24) 以上
3. **存储空间**: 确保设备有足够空间下载APK
4. **网络连接**: 下载需要稳定的网络连接
