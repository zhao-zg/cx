# APK 下载和安装 - 无需额外插件

## 当前方案

**不需要安装任何额外插件**，只使用 Capacitor 6 内置功能：
- ✅ `@capacitor/app` - 打开 URL（已安装）
- ✅ `@capacitor/browser` - 浏览器功能（已安装）
- ✅ `@capacitor/filesystem` - 文件系统（已安装）

## 为什么不用 FileOpener

`@capacitor-community/file-opener` 只支持 Capacitor 5，与你的 Capacitor 6 不兼容。

## 当前实现

### 1. 权限处理

**不主动申请权限**，因为：
- Capacitor 6 没有内置 Permissions API
- 第三方权限插件可能不兼容

**策略**：
- 尝试保存到多个位置
- 如果 `EXTERNAL/Download/` 失败（权限问题），自动降级到 `CACHE` 目录
- `CACHE` 目录不需要权限，一定能成功

### 2. 文件保存（按顺序尝试）

1. **EXTERNAL/Download/** - 系统 Download 文件夹
   - 优点：用户容易找到
   - 缺点：可能需要权限（Android 10 以下）

2. **CACHE/downloads/** - 应用缓存目录
   - 优点：不需要权限，一定成功
   - 缺点：可能被系统清理

3. **DATA/downloads/** - 应用数据目录
   - 优点：不需要权限
   - 缺点：用户难以找到

### 3. 打开安装程序（按顺序尝试）

1. **App.openUrl()** - Capacitor 内置
   - 最可靠的方法
   - 应该能打开系统安装程序

2. **Browser.open()** - Capacitor 内置
   - 备用方案

3. **window.open()** - 标准 Web API
   - 最后的尝试

## 测试步骤

1. **不需要安装任何东西**，直接测试：
   ```bash
   # 同步现有配置
   npx cap sync android
   
   # 打开 Android Studio
   npx cap open android
   
   # 构建 APK
   ```

2. **测试下载和安装**：
   - 点击 Logo 8 次触发更新
   - 观察每个 alert 提示
   - 记录：
     - 文件保存到哪个目录？
     - 是否打开了安装程序？
     - 如果失败，错误信息是什么？

## 预期行为

### 理想情况

1. ✅ 文件保存到 CACHE 目录（不需要权限）
2. ✅ `App.openUrl()` 打开系统安装程序
3. ✅ 用户点击"安装"完成更新

### 可能的问题

#### 问题1：无法打开安装程序

**症状**：alert 显示"App.openUrl 失败"

**原因**：
- Android 7.0+ 需要使用 FileProvider
- URI 格式不正确

**解决**：
- 确保 AndroidManifest.xml 中配置了 FileProvider
- 确保 file_paths.xml 正确配置
- 查看 alert 显示的 URI 格式

#### 问题2：安装时提示"未知来源"

**症状**：系统阻止安装

**原因**：
- Android 8.0+ 需要"安装未知应用"权限

**解决**：
- 用户需要手动允许（系统会引导）
- 这是 Android 安全机制，无法绕过

## 调试信息

代码会显示详细的 alert 提示：

1. **权限检查**：
   - "权限 API 不可用" - 正常，因为没有插件

2. **文件保存**：
   - "尝试保存到: XXX" - 显示尝试的目录
   - "文件已保存！" - 显示成功的位置和路径
   - "保存失败" - 显示错误信息

3. **打开安装程序**：
   - "尝试方法1: App.openUrl" - 显示 URI
   - "成功" 或 "失败" - 显示结果

## 如果还是不行

如果 Capacitor 内置方法都失败，可以考虑：

### 方案1：创建自定义插件

创建一个简单的 Capacitor 插件，直接调用 Android API：

```java
@PluginMethod
public void installApk(PluginCall call) {
    String filePath = call.getString("filePath");
    File file = new File(filePath);
    
    Uri uri;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        uri = FileProvider.getUriForFile(
            getContext(),
            getContext().getPackageName() + ".fileprovider",
            file
        );
    } else {
        uri = Uri.fromFile(file);
    }
    
    Intent intent = new Intent(Intent.ACTION_VIEW);
    intent.setDataAndType(uri, "application/vnd.android.package-archive");
    intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
    getActivity().startActivity(intent);
    
    call.resolve();
}
```

### 方案2：降级到 Capacitor 5

如果必须使用 FileOpener 插件：

```bash
# 降级所有 Capacitor 包到 5.x
npm install @capacitor/core@^5.0.0 @capacitor/cli@^5.0.0 @capacitor/android@^5.0.0 @capacitor/app@^5.0.0 @capacitor/browser@^5.0.0 @capacitor/filesystem@^5.0.0

# 安装 FileOpener
npm install @capacitor-community/file-opener

# 同步
npx cap sync android
```

## 总结

- ✅ 不需要安装额外插件
- ✅ 使用 Capacitor 6 内置功能
- ✅ 文件保存有降级策略
- ✅ 打开安装程序有多种尝试
- ✅ 详细的 alert 调试信息

测试后告诉我看到了什么 alert 提示，我们再根据实际情况调整。
