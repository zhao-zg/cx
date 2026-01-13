# APK 内部更新功能说明

## 功能概述

应用现在支持内部更新功能，用户可以在应用内直接检查和下载新版本的APK，无需访问应用商店。

## 工作原理

1. **版本检查**：应用启动时自动检查服务器上的 `version.json` 文件
2. **版本比较**：对比服务器版本和本地版本
3. **下载更新**：如果有新版本，提示用户下载
4. **安装APK**：下载完成后引导用户安装

## 使用方法

### 用户端

1. **自动检查**：应用每24小时自动检查一次更新
2. **手动检查**：在主页点击"检查更新"按钮
3. **下载安装**：发现新版本后，点击确认即可下载并安装

### 开发者端

#### 1. 更新版本号

编辑 `app_config.json`：
```json
{
  "version": "0.7.3"
}
```

#### 2. 生成版本信息

运行主程序会自动生成 `version.json`：
```bash
python main.py
```

生成的 `version.json` 包含：
```json
{
  "version": "20250113120000",
  "app_version": "0.7.3",
  "timestamp": "2025-01-13T12:00:00",
  "apk_url": "https://github.com/zhao-zg/cx/releases/download/v0.7.3/tehui_v0.7.3.apk",
  "changelog": "新增划线标记功能，支持5种颜色选择",
  "files": [...],
  "file_count": 123
}
```

#### 3. 构建APK

```bash
# 同步资源
npx cap sync android

# 在Android Studio中构建APK
# 或使用命令行
cd android
./gradlew assembleRelease
```

#### 4. 上传APK到GitHub Release

1. 在GitHub创建新的Release（如 v0.7.3）
2. 上传构建好的APK文件，命名为 `tehui_v0.7.3.apk`
3. 发布Release

#### 5. 部署到服务器

将 `output` 目录（包含 `version.json`）部署到服务器：
```bash
# 推送到GitHub Pages
git add output/version.json
git commit -m "chore: 更新版本信息"
git push

# 或使用其他部署方式
```

## 配置说明

### version.json 字段说明

- `version`: 内容版本号（时间戳格式）
- `app_version`: 应用版本号（语义化版本）
- `timestamp`: 生成时间
- `apk_url`: APK下载地址
- `changelog`: 更新日志
- `files`: 文件列表
- `file_count`: 文件数量

### 自定义更新日志

编辑 `generate_version.py` 中的 `changelog` 字段：
```python
'changelog': '新增划线标记功能，支持5种颜色选择'
```

## 注意事项

1. **APK签名**：确保新旧版本使用相同的签名密钥
2. **权限要求**：需要 `REQUEST_INSTALL_PACKAGES` 权限
3. **网络连接**：检查更新需要网络连接
4. **存储空间**：下载APK需要足够的存储空间
5. **Android版本**：建议Android 5.0+

## 安全性

- 使用HTTPS下载APK
- 验证APK签名
- 仅从配置的可信服务器下载

## 故障排除

### 无法检查更新
- 检查网络连接
- 确认 `version.json` 已部署到服务器
- 查看浏览器控制台日志

### 下载失败
- 检查APK URL是否正确
- 确认APK文件已上传到GitHub Release
- 检查存储空间是否充足

### 无法安装
- 确认已允许"安装未知来源应用"
- 检查APK签名是否一致
- 查看系统安装日志

## 版本发布流程

1. 更新代码和功能
2. 修改 `app_config.json` 版本号
3. 运行 `python main.py` 生成内容和版本信息
4. 构建APK
5. 创建GitHub Release并上传APK
6. 部署 `output` 目录到服务器
7. 用户端自动检测到更新

## 未来改进

- [ ] 增量更新（只下载变化的文件）
- [ ] 后台静默下载
- [ ] 更新进度显示
- [ ] 强制更新选项
- [ ] 多语言支持
