# APK应用内更新功能使用指南

## 功能特点

✅ **应用内下载** - 无需跳转浏览器，直接在应用内下载APK  
✅ **进度显示** - 实时显示下载进度百分比  
✅ **自动安装** - 下载完成后自动打开安装界面  
✅ **智能检查** - 每24小时自动检查一次更新  
✅ **手动检查** - 主页提供"检查更新"按钮  

## 快速开始

### 1. 安装依赖

```bash
npm install
```

这会自动安装：
- `@capacitor/filesystem` - 文件系统操作
- `@capacitor-community/http` - HTTP下载（支持进度）

### 2. 同步到Android

```bash
npx cap sync android
```

### 3. 配置权限

编辑 `android/app/src/main/AndroidManifest.xml`，确保包含：

```xml
<!-- 网络和存储权限 -->
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />
```

详细配置见 [INSTALL_PLUGINS.md](INSTALL_PLUGINS.md)

### 4. 构建APK

```bash
# 在Android Studio中构建签名的APK
npx cap open android
```

### 5. 发布更新

1. **更新版本号** - 编辑 `app_config.json`
   ```json
   {
     "version": "0.7.4"
   }
   ```

2. **生成内容** - 运行主程序会自动生成 `version.json`
   ```bash
   python main.py
   ```

3. **上传APK** - 创建GitHub Release并上传APK
   - 文件名格式：`tehui_v0.7.4.apk`
   - Release标签：`v0.7.4`

4. **部署** - 推送到GitHub Pages
   ```bash
   git add output/version.json
   git commit -m "chore: 更新版本信息"
   git push
   ```

## 工作流程

### 用户端体验

1. **自动检查**
   - 应用启动时自动检查更新
   - 每24小时检查一次
   - 后台静默检查，不打扰用户

2. **发现更新**
   - 弹出对话框显示新版本信息
   - 显示更新日志
   - 用户确认后开始下载

3. **下载过程**
   - 显示下载进度对话框
   - 实时更新百分比
   - 支持大文件下载

4. **安装更新**
   - 下载完成自动打开安装界面
   - 用户点击安装即可
   - 保留所有数据和设置

### 开发者端流程

```
更新代码 → 修改版本号 → 生成内容 → 构建APK → 
创建Release → 上传APK → 部署version.json → 用户自动收到更新
```

## 技术实现

### 版本检查

```javascript
// 从服务器获取version.json
fetch('https://your-domain.com/version.json')
  .then(response => response.json())
  .then(versionInfo => {
    // 比较版本号
    if (versionInfo.app_version > currentVersion) {
      // 提示用户更新
    }
  });
```

### 下载APK

```javascript
// 使用Capacitor Http插件下载
CapacitorHttp.downloadFile({
  url: apkUrl,
  filePath: 'tehui_v0.7.4.apk',
  fileDirectory: Directory.Cache,
  progress: (event) => {
    // 更新进度
    const percent = (event.loaded / event.total) * 100;
  }
});
```

### 安装APK

```javascript
// 使用FileProvider打开APK
App.openUrl({ url: fileUri });
```

## version.json 格式

```json
{
  "version": "20250113120000",
  "app_version": "0.7.4",
  "timestamp": "2025-01-13T12:00:00",
  "apk_url": "https://github.com/zhao-zg/cx/releases/download/v0.7.4/tehui_v0.7.4.apk",
  "changelog": "新增功能说明",
  "files": [...],
  "file_count": 178
}
```

## 常见问题

### Q: 下载失败怎么办？
A: 检查网络连接，确认APK URL正确，查看控制台日志

### Q: 无法安装APK？
A: 确保设备允许"安装未知来源应用"，检查APK签名是否一致

### Q: 如何测试更新功能？
A: 
1. 安装旧版本APK
2. 修改version.json中的版本号
3. 点击"检查更新"按钮
4. 观察下载和安装流程

### Q: 可以强制更新吗？
A: 可以在version.json中添加 `"force_update": true` 字段，然后修改代码实现强制更新逻辑

### Q: 支持增量更新吗？
A: 当前版本不支持，未来可以考虑实现

## 安全建议

1. **使用HTTPS** - 确保APK下载链接使用HTTPS
2. **验证签名** - 新旧版本使用相同的签名密钥
3. **可信来源** - 只从配置的可信服务器下载
4. **版本验证** - 下载前验证版本信息的完整性

## 下一步优化

- [ ] 后台静默下载
- [ ] 断点续传
- [ ] 增量更新
- [ ] 强制更新选项
- [ ] 更新失败重试
- [ ] 下载速度显示
- [ ] 取消下载功能

## 相关文档

- [INSTALL_PLUGINS.md](INSTALL_PLUGINS.md) - 插件安装详细说明
- [RELEASE_NOTES_v0.7.3.md](RELEASE_NOTES_v0.7.3.md) - 版本发布说明
- [README.md](README.md) - 项目总体说明
