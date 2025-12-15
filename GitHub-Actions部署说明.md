# GitHub Actions 部署到 Cloudflare Pages

## 📋 方案说明

使用 GitHub Actions 构建（有 sudo 权限，可以安装 LibreOffice），然后自动部署到 Cloudflare Pages。

### 优势

- ✅ **支持 .doc 和 .docx 格式**：GitHub Actions 可以安装 LibreOffice
- ✅ **自动化部署**：推送代码自动触发构建和部署
- ✅ **完全免费**：GitHub Actions 和 Cloudflare Pages 都免费
- ✅ **更快的构建**：GitHub Actions 有 sudo 权限，可以缓存依赖

## 🚀 设置步骤

### 步骤 1: 获取 Cloudflare API Token

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 点击右上角头像 → **My Profile**
3. 左侧菜单选择 **API Tokens**
4. 点击 **Create Token**
5. 使用模板 **Edit Cloudflare Workers** 或创建自定义 Token
6. 权限设置：
   ```
   Account - Cloudflare Pages - Edit
   ```
7. 点击 **Continue to summary** → **Create Token**
8. **复制并保存 Token**（只显示一次）

### 步骤 2: 获取 Cloudflare Account ID

1. 在 Cloudflare Dashboard 首页
2. 右侧可以看到 **Account ID**
3. 点击复制

### 步骤 3: 在 Cloudflare 创建 Pages 项目

1. 进入 **Workers & Pages**
2. 点击 **Create application** → **Pages**
3. 选择 **Direct Upload**（不是 Connect to Git）
4. 项目名称：`cx-training`（或其他名称，需要与 workflow 中的 `projectName` 一致）
5. 点击 **Create project**

### 步骤 4: 配置 GitHub Secrets

1. 进入你的 GitHub 仓库
2. 点击 **Settings** → **Secrets and variables** → **Actions**
3. 点击 **New repository secret**，添加以下 secrets：

   **Secret 1: CLOUDFLARE_API_TOKEN**
   ```
   Name: CLOUDFLARE_API_TOKEN
   Value: <你在步骤1获取的 API Token>
   ```

   **Secret 2: CLOUDFLARE_ACCOUNT_ID**
   ```
   Name: CLOUDFLARE_ACCOUNT_ID
   Value: <你在步骤2获取的 Account ID>
   ```

### 步骤 5: 推送代码触发部署

```bash
git add .
git commit -m "配置 GitHub Actions 部署"
git push origin main
```

## 📊 工作流程

```
推送代码到 GitHub
    ↓
GitHub Actions 触发
    ↓
1. 检出代码
2. 设置 Python 3.9
3. 安装 LibreOffice (sudo apt-get)
4. 安装 Python 依赖
5. 运行 python main.py 生成 HTML
    ↓
部署 output 文件夹到 Cloudflare Pages
    ↓
网站自动更新
```

## 🔍 查看部署状态

### GitHub Actions

1. 进入 GitHub 仓库
2. 点击 **Actions** 标签
3. 查看最新的 workflow 运行状态
4. 点击可以查看详细日志

### Cloudflare Pages

1. 进入 Cloudflare Dashboard
2. **Workers & Pages** → 选择你的项目
3. 查看 **Deployments** 标签
4. 可以看到部署历史和状态

## ⚙️ 自定义配置

### 修改项目名称

编辑 `.github/workflows/deploy.yml`：

```yaml
projectName: 你的项目名称  # 修改这里
```

### 修改 Python 版本

```yaml
python-version: '3.10'  # 修改这里
```

### 添加环境变量

在 workflow 中添加：

```yaml
- name: 生成静态文件
  env:
    MY_VAR: value
  run: |
    python main.py
```

## 🎯 与直接连接 GitHub 的对比

| 特性 | GitHub Actions 部署 | Cloudflare 直接连接 |
|------|-------------------|-------------------|
| 支持 .doc 格式 | ✅ 是 | ❌ 否 |
| 支持 .docx 格式 | ✅ 是 | ✅ 是 |
| 需要配置 | ⚙️ 需要 API Token | ✅ 无需配置 |
| 构建环境 | GitHub (Ubuntu) | Cloudflare |
| sudo 权限 | ✅ 有 | ❌ 无 |
| 构建时间 | 2-3 分钟 | 40-90 秒 |
| 免费额度 | 2000 分钟/月 | 无限制 |

## 💡 使用建议

### 推荐使用 GitHub Actions 如果：
- ✅ 你有 .doc 格式的文档
- ✅ 需要安装系统级软件包
- ✅ 需要更灵活的构建环境

### 推荐直接连接 GitHub 如果：
- ✅ 所有文档都是 .docx 格式
- ✅ 不需要安装额外软件
- ✅ 想要更简单的配置

## 🔧 故障排除

### Q: GitHub Actions 失败，提示 API Token 无效？

**A:** 检查：
1. API Token 是否正确复制
2. Token 权限是否包含 Cloudflare Pages Edit
3. Token 是否已过期

### Q: 部署成功但网站没有更新？

**A:** 
1. 检查 Cloudflare Pages 项目名称是否匹配
2. 查看 Cloudflare Pages 的 Deployments 标签
3. 可能需要等待 1-2 分钟 CDN 刷新

### Q: 构建失败，提示找不到文档？

**A:** 
1. 确保文档文件已推送到 GitHub
2. 检查 `config.yaml` 中的文件路径
3. 查看 GitHub Actions 日志中的错误信息

### Q: 如何查看构建日志？

**A:** 
1. GitHub 仓库 → Actions 标签
2. 点击最新的 workflow 运行
3. 展开各个步骤查看详细日志

## 📚 相关文档

- [GitHub Actions 文档](https://docs.github.com/actions)
- [Cloudflare Pages 文档](https://developers.cloudflare.com/pages/)
- [Cloudflare Pages Action](https://github.com/cloudflare/pages-action)

## 🎉 完成

配置完成后，每次推送代码到 main 分支，GitHub Actions 会自动：
1. 构建项目（支持 .doc 和 .docx）
2. 部署到 Cloudflare Pages
3. 网站自动更新

完全自动化，无需手动操作！
