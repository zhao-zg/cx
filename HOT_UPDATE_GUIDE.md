# 热更新完整实现指南

## 📋 概述

实现了完整的热更新机制，支持 HTML、JS、CSS 等所有资源文件的热更新。

## 🎯 工作原理

### 1. 资源加载器 (`resource-loader.js`)

- **功能**：在 Capacitor 环境下优先从 `hot-update` 目录加载资源
- **支持**：JS 脚本、CSS 样式
- **机制**：
  1. 检查 `hot-update` 目录是否存在目标文件
  2. 如果存在，从热更新目录读取并注入
  3. 如果不存在，降级到 APK 内置资源

### 2. 页面加载器 (`page-loader.js`)

- **功能**：拦截页面导航，支持 HTML 页面热更新
- **机制**：
  1. 拦截所有 `<a>` 标签的点击事件
  2. 检查目标 HTML 是否有热更新版本
  3. 如果有，读取并替换当前页面内容
  4. 如果没有，使用正常导航

### 3. 热更新流程

```
用户启动 APP
    ↓
检查远程版本
    ↓
发现新版本
    ↓
下载 ZIP 包
    ↓
解压到 hot-update 目录
    ↓
保存版本号
    ↓
重启 APP
    ↓
资源加载器自动从 hot-update 目录加载
```

## 📁 文件结构

```
hot-update/                    # 热更新目录（在 APP 数据目录）
├── 2025-04/
│   ├── js/
│   │   ├── speech.js         # 热更新的 JS 文件
│   │   ├── font-control.js
│   │   └── ...
│   ├── css/
│   │   └── ...
│   ├── 1_cx.htm              # 热更新的 HTML 文件
│   └── ...
├── 2025-05/
│   └── ...
├── trainings.json            # 训练列表
└── version.json              # 版本信息
```

## 🔧 使用方法

### 开发者

1. **修改代码**：
   ```bash
   # 修改 src/templates/ 或 src/static/ 中的文件
   vim src/static/js/speech.js
   ```

2. **生成输出**：
   ```bash
   python main.py
   ```

3. **生成热更新包**：
   ```bash
   python generate_version.py
   python generate_hot_update_package.py
   ```

4. **发布**：
   ```bash
   git add .
   git commit -m "更新功能"
   git push
   ```

5. **GitHub Actions 自动部署**到 Cloudflare Pages

### 用户

1. **启动 APP**
2. **自动检查更新**（或手动点击"检查更新"）
3. **下载并安装**热更新包
4. **重启 APP**
5. **自动使用**热更新的资源

## ✅ 优势

1. **无需重新下载 APK**：只更新变化的资源文件
2. **更新包小**：通常只有几 MB
3. **更新快**：下载和安装只需几秒钟
4. **自动降级**：如果热更新文件损坏，自动使用 APK 内置版本
5. **透明**：用户无感知，自动切换到新版本

## 🔍 调试

### 检查热更新是否生效

在 APP 中打开控制台（如果可用），查看日志：

```javascript
// 资源加载日志
[资源加载] 使用热更新版本: js/speech.js

// 页面加载日志
[页面加载] 使用热更新版本: 2025-04/1_cx.htm
```

### 测试热更新

1. 打开 `test-hot-update.html`（在浏览器中）
2. 点击"检测环境"
3. 点击"测试资源加载"
4. 点击"检查热更新文件"

### 清除热更新缓存

在 APP 中执行：

```javascript
// 清除资源加载器缓存
window.ResourceLoader.clearCache();

// 删除热更新目录（需要 Filesystem 权限）
var Filesystem = window.Capacitor.Plugins.Filesystem;
await Filesystem.rmdir({
    path: 'hot-update',
    directory: 'DATA',
    recursive: true
});
```

## 📝 注意事项

1. **首次安装**：没有热更新，使用 APK 内置资源
2. **网络要求**：需要网络连接才能下载热更新包
3. **存储空间**：热更新包会占用 APP 数据目录空间
4. **版本兼容**：确保热更新包与 APK 版本兼容

## 🐛 故障排除

### 热更新不生效

1. 检查是否在 Capacitor 环境：`!!window.Capacitor`
2. 检查 Filesystem 插件：`!!window.Capacitor.Plugins.Filesystem`
3. 检查热更新目录是否存在
4. 检查版本号是否已更新：`localStorage.getItem('cx_resource_version')`

### 页面显示异常

1. 清除热更新缓存
2. 卸载并重新安装 APP
3. 检查热更新包是否完整

## 🚀 未来改进

1. **增量更新**：只下载变化的文件
2. **断点续传**：支持大文件下载中断后继续
3. **版本回滚**：支持回退到上一个版本
4. **A/B 测试**：支持灰度发布
5. **CDN 加速**：使用多个 CDN 节点加速下载
