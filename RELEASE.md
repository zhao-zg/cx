# 发布指南

## 🚀 自动发布流程

本项目使用 GitHub Actions 自动构建和发布安卓 APK。

## 📋 发布方式

### 方式 1: 未签名 APK（快速发布）

适用于测试和内部分发。

```bash
# 创建并推送标签
git tag v1.0.0
git push origin v1.0.0
```

### 方式 2: 签名 APK（正式发布）

适用于公开发布和应用商店。

#### 首次配置（只需一次）

1. **生成密钥库**

```bash
keytool -genkey -v -keystore my-release-key.keystore \
  -alias my-key-alias \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

记住你设置的密码和别名！

2. **转换为 Base64**

```bash
# Linux/Mac
base64 my-release-key.keystore > keystore.txt

# Windows (PowerShell)
[Convert]::ToBase64String([IO.File]::ReadAllBytes("my-release-key.keystore")) > keystore.txt
```

3. **在 GitHub 设置 Secrets**

进入仓库 Settings > Secrets and variables > Actions，添加以下 secrets：

- `KEYSTORE_BASE64`: keystore.txt 的内容（整个文件内容）
- `KEYSTORE_PASSWORD`: 密钥库密码
- `KEY_ALIAS`: 密钥别名（例如 my-key-alias）
- `KEY_PASSWORD`: 密钥密码

4. **发布签名版本**

```bash
# 创建并推送 release 标签
git tag release-v1.0.0
git push origin release-v1.0.0
```

### 方式 3: 手动触发构建

1. 进入 GitHub 仓库的 Actions 页面
2. 选择 "构建安卓APK"
3. 点击 "Run workflow"
4. 选择是否签名并运行

## 📦 构建产物

### 自动发布到 Releases

- 推送标签后，APK 会自动上传到 GitHub Releases
- 下载地址：`https://github.com/你的用户名/你的仓库/releases`

### Artifacts（临时下载）

- 每次构建的 APK 也会上传到 Actions Artifacts
- 保留 7 天（测试构建）或永久（Release 构建）

## 🔄 版本管理

### 版本号规则

- `v1.0.0` - 未签名测试版
- `release-v1.0.0` - 签名正式版

### 更新版本号

编辑 `android/app/build.gradle`：

```gradle
android {
    defaultConfig {
        versionCode 2      // 每次发布递增（整数）
        versionName "1.1.0"  // 显示版本（字符串）
    }
}
```

提交后再打标签发布。

## 📱 分发方式

### 1. GitHub Releases（推荐）

- 用户直接从 Releases 页面下载 APK
- 适合内部分发和测试

### 2. Google Play Store

1. 使用签名的 APK 或 AAB
2. 在 [Google Play Console](https://play.google.com/console) 创建应用
3. 上传 APK/AAB
4. 填写应用信息
5. 提交审核

### 3. 其他应用商店

- 华为应用市场
- 小米应用商店
- OPPO 软件商店
- vivo 应用商店
- 应用宝（腾讯）

## 🔍 验证签名

```bash
# 查看 APK 签名信息
jarsigner -verify -verbose -certs your-app.apk

# 或使用 apksigner
apksigner verify --print-certs your-app.apk
```

## 🐛 故障排除

### 构建失败

1. 检查 Actions 日志
2. 确认所有依赖都在 `requirements.txt` 中
3. 验证 Python 脚本能正常运行

### 签名失败

1. 检查 Secrets 是否正确设置
2. 确认 Base64 编码正确
3. 验证密码和别名匹配

### APK 无法安装

1. 检查设备是否允许"未知来源"
2. 确认 APK 完整下载
3. 查看设备日志

## 📊 工作流说明

### android-release.yml（唯一工作流）
- 触发方式：
  - 推送 `v*` 标签 → 构建未签名 APK
  - 推送 `release-v*` 标签 → 构建签名 APK（需配置密钥）
  - 手动触发 → 可选择是否签名
- 自动发布到 GitHub Releases

## 🎯 最佳实践

1. **开发阶段**：使用未签名 APK，快速迭代
2. **测试阶段**：使用 PR 构建，验证功能
3. **发布阶段**：使用签名 APK，正式发布
4. **版本管理**：遵循语义化版本规范
5. **安全性**：妥善保管密钥库文件

## 📝 发布检查清单

- [ ] 更新版本号（versionCode 和 versionName）
- [ ] 测试所有功能
- [ ] 更新 CHANGELOG
- [ ] 创建标签
- [ ] 推送标签
- [ ] 等待 Actions 完成
- [ ] 验证 Release 页面
- [ ] 测试下载的 APK
- [ ] 通知用户更新

## 🔗 相关链接

- [GitHub Actions 文档](https://docs.github.com/actions)
- [Capacitor 文档](https://capacitorjs.com/docs)
- [Android 开发文档](https://developer.android.com)
- [Google Play Console](https://play.google.com/console)
