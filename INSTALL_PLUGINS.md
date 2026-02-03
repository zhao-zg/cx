# 安装必需的 Capacitor 插件

## 问题

APK 下载功能需要以下插件才能正常工作：
1. **FileOpener** - 用于打开 APK 安装程序
2. **Permissions** (可选) - 用于请求存储权限

目前 `package.json` 中缺少这些插件。

## 解决方案

### 方法1：自动安装（推荐）

运行以下命令：

```bash
# 安装 FileOpener 插件（必需）
npm install @capacitor-community/file-opener

# 同步到 Android 项目
npx cap sync android
```

### 方法2：手动更新 package.json

我已经更新了 `package.json`，添加了：
```json
"@capacitor-community/file-opener": "^1.0.5"
```

然后运行：
```bash
npm install
npx cap sync android
```

## 验证安装

安装完成后，在 Android Studio 中打开项目：
```bash
npx cap open android
```

检查 `android/app/build.gradle` 中是否有：
```gradle
implementation 'com.capacitor-community:file-opener:1.0.5'
```

## 关于权限

### Android 10 及以下

需要存储权限才能保存文件到 Download 目录。但是：
- **Capacitor 6.x 没有内置的 Permissions 插件**
- 需要使用第三方插件或自定义插件

### Android 11+

使用 Scoped Storage，不需要存储权限，可以直接保存到：
- `CACHE` 目录（应用缓存）
- `DATA` 目录（应用数据）

但是 `EXTERNAL/Download` 目录仍然需要权限。

## 当前代码的权限处理

代码会尝试：
1. 检查 `window.Capacitor.Plugins.Permissions` 是否存在
2. 如果存在，请求存储权限
3. 如果不存在，跳过权限检查，直接尝试保存

保存策略（按顺序尝试）：
1. `EXTERNAL/Download/` - 需要权限，但用户可以在文件管理器中找到
2. `CACHE/downloads/` - 不需要权限，但可能被系统清理
3. `DATA/downloads/` - 不需要权限，但用户难以找到

## 推荐方案

### 短期方案（当前）

不安装 Permissions 插件，使用降级策略：
- 优先尝试 `EXTERNAL/Download/`（可能失败）
- 失败后降级到 `CACHE/downloads/`（一定成功）
- 用户可以在 alert 提示中看到实际保存位置

### 长期方案

创建自定义 Capacitor 插件，直接调用 Android API：
```java
// 请求存储权限
ActivityCompat.requestPermissions(
    getActivity(),
    new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE},
    REQUEST_CODE
);

// 安装 APK
Intent intent = new Intent(Intent.ACTION_VIEW);
intent.setDataAndType(uri, "application/vnd.android.package-archive");
intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
startActivity(intent);
```

## 测试步骤

1. 安装插件：
   ```bash
   npm install
   npx cap sync android
   ```

2. 重新构建 APK：
   ```bash
   npx cap open android
   # 在 Android Studio 中 Build > Build Bundle(s) / APK(s) > Build APK(s)
   ```

3. 安装并测试：
   - 点击 Logo 8 次触发更新
   - 观察 alert 提示
   - 检查文件是否保存成功
   - 检查是否能打开安装程序

## 预期行为

### 安装 FileOpener 后

- ✅ 文件保存成功（到 CACHE 目录）
- ✅ 自动打开安装程序
- ✅ 用户点击"安装"完成更新

### 没有 FileOpener

- ✅ 文件保存成功
- ❌ 无法自动打开安装程序
- ⚠️ 需要用户手动到文件管理器安装

## 故障排查

### 问题1：文件保存失败

**症状**：alert 显示"保存到 XXX 失败"

**原因**：
- Android 11+ 限制访问外部存储
- 没有存储权限

**解决**：
- 代码会自动降级到 CACHE 目录
- 查看 alert 提示的实际保存位置

### 问题2：无法打开安装程序

**症状**：alert 显示"FileOpener 插件不可用"

**原因**：
- 没有安装 FileOpener 插件

**解决**：
- 运行 `npm install @capacitor-community/file-opener`
- 运行 `npx cap sync android`

### 问题3：安装时提示"未知来源"

**症状**：系统阻止安装

**原因**：
- Android 8.0+ 需要"安装未知应用"权限

**解决**：
- 系统会自动引导用户到设置页面
- 用户需要手动允许该权限
- 这是 Android 系统的安全机制，无法绕过

## 相关文件

- `package.json` - 插件依赖配置
- `src/static/js/app-update.js` - APK 下载和安装逻辑
- `ANDROID_PERMISSIONS.md` - Android 权限配置指南
- `.github/workflows/android-release-offline.yml` - CI/CD 构建配置
