# 自定义 APK 安装插件设置

## 问题

Capacitor 6 没有内置的 APK 安装功能，第三方插件也不兼容。Android 7.0+ 不允许直接使用 `file://` URI 打开 APK，必须使用 FileProvider。

## 解决方案

我创建了一个简单的自定义 Capacitor 插件：`ApkInstaller`

## 已创建的文件

1. **ApkInstallerPlugin.java** - 插件实现
   - 路径：`android/app/src/main/java/com/tehui/offline/ApkInstallerPlugin.java`
   - 功能：使用 Android Intent 和 FileProvider 打开 APK 安装程序

2. **MainActivity.java** - 主活动
   - 路径：`android/app/src/main/java/com/tehui/offline/MainActivity.java`
   - 功能：注册自定义插件

## 插件功能

### Java 端

```java
@PluginMethod
public void install(PluginCall call) {
    // 1. 获取文件路径
    // 2. 使用 FileProvider 创建 content:// URI（Android 7.0+）
    // 3. 创建 Intent 打开安装程序
    // 4. 授予读取权限
}
```

### JavaScript 端

```javascript
await window.Capacitor.Plugins.ApkInstaller.install({
    filePath: 'file:///path/to/app.apk'
});
```

## 使用步骤

### 1. 同步到 Android 项目

```bash
npx cap sync android
```

### 2. 在 Android Studio 中打开项目

```bash
npx cap open android
```

### 3. 验证文件

确保以下文件存在：
- `android/app/src/main/java/com/tehui/offline/ApkInstallerPlugin.java`
- `android/app/src/main/java/com/tehui/offline/MainActivity.java`

### 4. 构建 APK

在 Android Studio 中：
- Build > Build Bundle(s) / APK(s) > Build APK(s)

或使用命令行：
```bash
cd android
./gradlew assembleRelease
```

## 工作原理

1. **下载 APK**：
   - 使用 Capacitor Filesystem 保存到 `EXTERNAL/Download/` 或 `CACHE/downloads/`
   - 获得 `file://` URI

2. **调用插件**：
   - JavaScript 调用 `ApkInstaller.install({ filePath: uri })`
   - 传递 `file://` URI 给 Java 插件

3. **Java 处理**：
   - 移除 `file://` 前缀，获得实际文件路径
   - 检查文件是否存在
   - Android 7.0+：使用 FileProvider 创建 `content://` URI
   - Android 6.0-：直接使用 `file://` URI
   - 创建 Intent 打开安装程序
   - 授予 `FLAG_GRANT_READ_URI_PERMISSION` 权限

4. **系统安装**：
   - 系统弹出安装界面
   - 用户点击"安装"完成更新

## 优势

- ✅ 不需要第三方插件
- ✅ 兼容 Capacitor 6
- ✅ 支持 Android 7.0+ FileProvider
- ✅ 自动处理权限
- ✅ 代码简单，易于维护

## 测试

1. 构建新的 APK
2. 安装到设备
3. 点击 Logo 8 次触发更新
4. 观察 alert 提示：
   - 应该显示"尝试方法1: ApkInstaller 插件"
   - 然后显示"安装程序已打开！"
   - 系统弹出安装界面

## 故障排查

### 问题1：ApkInstaller 插件不可用

**症状**：alert 显示"ApkInstaller 插件不可用"

**原因**：
- 插件未正确注册
- MainActivity.java 未正确配置

**解决**：
1. 检查 `MainActivity.java` 是否存在
2. 检查是否调用了 `registerPlugin(ApkInstallerPlugin.class)`
3. 运行 `npx cap sync android`
4. 重新构建 APK

### 问题2：文件不存在

**症状**：alert 显示"文件不存在"

**原因**：
- 文件路径错误
- 文件保存失败

**解决**：
- 查看之前的 alert，确认文件保存成功
- 检查文件路径格式

### 问题3：安装时提示"未知来源"

**症状**：系统阻止安装

**原因**：
- Android 8.0+ 需要"安装未知应用"权限

**解决**：
- 系统会自动引导用户到设置页面
- 用户需要手动允许该权限
- 这是 Android 安全机制，无法绕过

## 代码说明

### ApkInstallerPlugin.java

```java
// 关键代码
if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
    // Android 7.0+ 使用 FileProvider
    uri = FileProvider.getUriForFile(
        getContext(),
        getContext().getPackageName() + ".fileprovider",
        file
    );
} else {
    // Android 6.0- 直接使用 file:// URI
    uri = Uri.fromFile(file);
}

Intent intent = new Intent(Intent.ACTION_VIEW);
intent.setDataAndType(uri, "application/vnd.android.package-archive");
intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
getActivity().startActivity(intent);
```

### app-update.js

```javascript
// 调用插件
if (window.Capacitor.Plugins.ApkInstaller) {
    var result = await window.Capacitor.Plugins.ApkInstaller.install({
        filePath: fileUri  // file:///path/to/app.apk
    });
    alert('[成功] ' + result.message);
}
```

## 相关文件

- `android/app/src/main/java/com/tehui/offline/ApkInstallerPlugin.java` - 插件实现
- `android/app/src/main/java/com/tehui/offline/MainActivity.java` - 主活动
- `src/static/js/app-update.js` - JavaScript 调用代码
- `android/app/src/main/AndroidManifest.xml` - 权限和 FileProvider 配置
- `android/app/src/main/res/xml/file_paths.xml` - FileProvider 路径配置
