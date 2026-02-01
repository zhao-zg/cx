# APK 热更新功能说明

## 功能概述

应用现在支持两种更新方式：
1. **热更新（Hot Update）** - 只更新HTML/JS/CSS等资源文件，无需重装APK，快速更新
2. **APK更新（Full Update）** - 完整的APK包更新，用于应用版本升级

## 更新策略

系统会自动判断更新类型：
- 如果APK版本号变化 → 提示下载完整APK包
- 如果只有资源版本号变化 → 执行热更新（快速）

## 版本号说明

### APK版本（app_version）
- 格式：`0.7.1`（语义化版本）
- 来源：GitHub tag（自动提取）
- 管理方式：**完全自动**，无需手动修改
- 变更时机：创建新tag时自动更新
- 更新方式：需要下载并安装新APK

### 资源版本（resource_version）
- 格式：`20260201230956`（时间戳）
- 来源：自动生成
- 变更时机：每次内容更新（训练文档、样式、脚本等）
- 更新方式：热更新，无需重装

## 版本号自动化流程

### APK版本自动管理
1. 开发者创建新tag（如 `v0.7.2`）
2. GitHub Actions自动触发构建
3. 从tag提取版本号（`0.7.2`）
4. 自动更新`app_config.json`中的版本号
5. 构建APK并发布到Release

**关键代码（android-release-offline.yml）：**
```yaml
- name: 提取并配置版本号
  run: |
    VERSION=${GITHUB_REF#refs/tags/v}
    
    # 更新 app_config.json
    python3 << PYTHON_EOF
    import json
    
    with open('app_config.json', 'r', encoding='utf-8') as f:
        config = json.load(f)
    
    config['version'] = '$VERSION'
    
    with open('app_config.json', 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    PYTHON_EOF
```

### 资源版本自动生成
1. 运行`python main.py`生成HTML
2. 运行`python generate_version.py`
3. 自动读取`app_config.json`的APK版本
4. 自动生成时间戳作为资源版本
5. 生成`version.json`文件

## 使用方法

### 用户端
1. 打开应用主页
2. 连续点击Logo 8次
3. 系统自动检查更新
4. 根据提示选择更新方式

### 热更新流程
1. 检测到资源更新
2. 显示"发现内容更新"对话框
3. 用户确认后开始更新
4. 清除Service Worker缓存
5. 保存新的资源版本号
6. 自动重启应用

### APK更新流程
1. 检测到APK版本更新
2. 显示"发现新版本"对话框
3. 用户确认后下载APK
4. 显示下载进度
5. 下载完成后打开安装界面

## 技术实现

### 文件结构
```
src/static/js/
├── app-update.js      # APK完整更新
├── hot-update.js      # 热更新功能（新增）
├── highlight.js       # 划线功能
├── speech.js          # 朗读功能
└── font-control.js    # 字体控制
```

### 版本信息（version.json）
```json
{
  "app_version": "0.7.1",           // APK版本（从app_config.json读取）
  "resource_version": "20260201230956",  // 资源版本（自动生成）
  "timestamp": "2026-02-01T23:09:56",
  "files": [...],                   // 文件列表
  "file_count": 262,
  "changelog": "包含内容更新和优化"
}
```

### 热更新原理
1. 比较本地和服务器的资源版本号
2. 如果服务器版本更新，清除所有缓存
3. 删除Service Worker缓存
4. 保存新版本号到localStorage
5. 重载页面，自动从服务器获取最新资源

### 缓存清理
```javascript
// 清除Service Worker缓存
caches.keys().then(cacheNames => {
  return Promise.all(
    cacheNames.map(cacheName => caches.delete(cacheName))
  );
});

// 通知Service Worker更新
navigator.serviceWorker.controller.postMessage({
  type: 'SKIP_WAITING'
});
```

## 优势对比

### 热更新优势
- ✅ 更新速度快（秒级）
- ✅ 无需下载大文件
- ✅ 无需重新安装
- ✅ 用户体验好
- ✅ 适合频繁的内容更新

### APK更新优势
- ✅ 可以更新原生功能
- ✅ 可以更新Capacitor插件
- ✅ 可以修改应用权限
- ✅ 适合大版本升级

## 部署流程

### 内容更新（热更新）
1. 更新训练文档
2. 运行 `python main.py` 生成HTML
3. 运行 `python generate_version.py` 更新版本信息
   - 自动从`app_config.json`读取APK版本
   - 自动生成新的资源版本号
4. 部署到服务器
5. 用户打开应用，点击Logo 8次检查更新
6. 系统提示"发现内容更新"
7. 用户确认，自动热更新

### 应用更新（APK更新）
1. **创建新tag**（如 `v0.7.2`）
   ```bash
   git tag v0.7.2
   git push origin v0.7.2
   ```
2. GitHub Actions自动触发
3. 自动提取版本号并更新`app_config.json`
4. 自动构建APK
5. 自动上传到GitHub Release
6. 用户检查更新时提示下载新APK

**重要：版本号完全自动化，无需手动修改任何文件！**

## 注意事项

1. **版本号管理**
   - APK版本：通过创建tag自动管理（如 `v0.7.2`）
   - 资源版本：每次生成时自动创建时间戳
   - **无需手动修改`app_config.json`**

2. **缓存策略**
   - 热更新会清除所有缓存
   - 更新后首次加载可能较慢
   - Service Worker会重新缓存资源

3. **兼容性**
   - 热更新只在Capacitor环境生效
   - Web版本会自动使用Service Worker缓存
   - 降级方案：如果热更新失败，提示用户手动刷新

4. **测试建议**
   - 测试热更新：只修改HTML内容，不创建新tag
   - 测试APK更新：创建新tag（如 `v0.7.3`）
   - 测试降级：关闭Service Worker，验证降级逻辑

## 相关文件

- `src/static/js/hot-update.js` - 热更新核心逻辑
- `src/static/js/app-update.js` - APK更新逻辑
- `src/templates/base.html` - 引入热更新脚本
- `src/templates/main_index.html` - 主页更新检查
- `generate_version.py` - 版本信息生成
- `app_config.json` - 应用配置（APK版本由GitHub Actions自动更新）
- `output/version.json` - 版本信息文件
- `.github/workflows/android-release-offline.yml` - APK构建和版本自动化

## 未来优化

1. 增量更新：只下载变化的文件
2. 后台更新：静默下载，下次启动应用
3. 更新通知：推送通知提醒用户更新
4. 回滚机制：更新失败时恢复旧版本
5. 差异对比：显示具体更新内容

