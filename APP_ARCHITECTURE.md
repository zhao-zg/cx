# 应用架构说明

## 📱 双包设计

本项目采用**静态包 + 动态内容**的分离架构：

### 1. 静态包（APK）
- **内容**：只包含应用框架和启动页
- **大小**：约 5-10 MB
- **更新频率**：很少更新，只在修复 bug 或添加新功能时
- **构建方式**：推送版本标签（如 v1.0.0）

### 2. 动态内容（网站）
- **内容**：所有训练文档、HTML 页面
- **托管**：GitHub Pages
- **更新频率**：随时更新，无需重新安装 APK
- **构建方式**：推送代码到 main 分支

## 🔄 更新机制

### 自动更新
- 应用启动时自动检查更新（静默）
- 如果有新版本，自动下载并缓存

### 手动更新
- 点击 Logo 图标 **10 次** - 触发强制更新检查
- **长按** Logo 图标 - 显示服务器选择器，可切换内容源

### 多服务器支持
应用内置多个内容服务器地址：
1. https://cx.zhaozg.dpdns.org/
2. https://cx.zhaozg.cloudns.org/
3. https://cx.07170501.dynv6.net/
4. https://cx.xzdjx.dynv6.net/
5. https://zhao-zg.github.io/cx/

- 自动选择最快的服务器
- 长按 Logo 可手动切换
- 自动故障转移

## 📂 文件结构

```
项目根目录/
├── src/templates/
│   ├── app_index.html          # APK 启动页（静态包）
│   ├── main_index.html         # 网站主页（动态内容）
│   └── ...其他模板
├── output/                     # 生成的网站内容
│   ├── index.html             # 主页
│   ├── version.json           # 版本信息
│   └── ...其他文件
├── app_config.json            # 应用配置
├── generate_version.py        # 版本生成脚本
└── main.py                    # 主生成脚本
```

## 🚀 发布流程

### 发布新内容（不需要更新 APK）

```bash
# 1. 更新 resource 文件夹中的文档
# 2. 提交并推送
git add resource/
git commit -m "更新训练内容"
git push origin main

# GitHub Actions 会自动：
# - 生成网站
# - 生成 version.json
# - 部署到 GitHub Pages
```

用户打开应用时会自动获取新内容，无需重新安装。

### 发布新 APK（修复 bug 或新功能）

```bash
# 1. 修改代码
# 2. 提交并推送
git add .
git commit -m "修复某个问题"
git push origin main

# 3. 创建版本标签
git tag v1.0.1
git push origin v1.0.1

# GitHub Actions 会自动构建并发布 APK
```

## ⚙️ 配置

### 修改远程内容地址

编辑 `app_config.json`（仅用于文档说明，实际配置在 `src/templates/app_index.html` 中）：

```json
{
  "remote_urls": [
    "https://cx.zhaozg.dpdns.org/",
    "https://cx.zhaozg.cloudns.org/",
    "https://cx.07170501.dynv6.net/",
    "https://cx.xzdjx.dynv6.net/",
    "https://zhao-zg.github.io/cx/"
  ],
  "app_name": "特会信息",
  "app_id": "com.conference.info",
  "version": "1.0.0"
}
```

要添加或修改服务器地址，编辑 `src/templates/app_index.html` 中的 `CONFIG.REMOTE_URLS` 数组。

### 启用 GitHub Pages

1. 进入仓库 Settings > Pages
2. Source 选择 `gh-pages` 分支
3. 保存

## 🔍 版本管理

### version.json 格式

```json
{
  "version": "20231216120000",
  "timestamp": "2023-12-16T12:00:00",
  "files": [
    "index.html",
    "2025-秋季/index.html",
    ...
  ],
  "file_count": 150
}
```

- `version`: 时间戳格式的版本号
- `timestamp`: ISO 格式的时间戳
- `files`: 所有文件列表
- `file_count`: 文件总数

## 💡 优势

1. **用户体验好**
   - 首次安装后，内容更新无需重新下载 APK
   - 更新速度快，只下载变化的内容

2. **维护成本低**
   - 内容更新不需要重新打包和发布 APK
   - 不需要通过应用商店审核

3. **灵活性高**
   - 可以随时更新内容
   - 可以快速修复内容错误

4. **体积小**
   - APK 只包含框架，体积很小
   - 内容在线加载，不占用安装空间

## 🛠️ 本地测试

### 测试动态内容

```bash
# 生成网站
python main.py

# 启动本地服务器
cd output
python -m http.server 8000

# 浏览器访问
http://localhost:8000
```

### 测试 APK

```bash
# 构建 APK
npm run android:build

# 或使用脚本
./build-android.bat  # Windows
./build-android.sh   # Linux/Mac
```

## 📊 监控

### 查看部署状态

- 内容部署：https://github.com/你的用户名/你的仓库/actions/workflows/deploy-content.yml
- APK 构建：https://github.com/你的用户名/你的仓库/actions/workflows/android-release.yml

### 查看已发布内容

- 网站：https://你的用户名.github.io/你的仓库/
- APK：https://github.com/你的用户名/你的仓库/releases

## 🔐 安全性

- 所有内容通过 HTTPS 传输
- 使用 Service Worker 缓存，支持离线访问
- 版本校验确保内容完整性

## 🎯 最佳实践

1. **频繁更新内容**：直接推送到 main 分支
2. **很少更新 APK**：只在必要时发布新版本
3. **版本号规范**：遵循语义化版本（v1.0.0, v1.1.0, v2.0.0）
4. **测试后发布**：本地测试通过后再推送
