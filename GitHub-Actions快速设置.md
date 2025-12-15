# GitHub Actions 快速设置指南

## 🚀 5 分钟完成设置

### 第 1 步：在 Cloudflare 创建项目

1. 访问 https://dash.cloudflare.com/
2. 点击 **Workers & Pages** → **Create application** → **Pages**
3. 选择 **Direct Upload**
4. 输入项目名称（例如：`cx`）
5. 点击 **Create project**
6. **记住项目名称**（后面要用）

### 第 2 步：获取 Cloudflare 信息

**获取 Account ID：**
- 在 Cloudflare Dashboard 右侧可以看到 **Account ID**
- 点击复制

**获取 API Token：**
1. 点击右上角头像 → **My Profile**
2. 左侧菜单 → **API Tokens**
3. 点击 **Create Token**
4. 使用模板 **Edit Cloudflare Workers**
5. 权限设置：`Account - Cloudflare Pages - Edit`
6. 点击 **Create Token**
7. **复制并保存 Token**（只显示一次）

### 第 3 步：配置 GitHub Secrets

1. 进入你的 GitHub 仓库
2. **Settings** → **Secrets and variables** → **Actions**
3. 点击 **New repository secret**，添加两个 secrets：

```
Name: CLOUDFLARE_API_TOKEN
Value: <粘贴你的 API Token>
```

```
Name: CLOUDFLARE_ACCOUNT_ID
Value: <粘贴你的 Account ID>
```

### 第 4 步：修改项目名称

编辑 `.github/workflows/deploy.yml` 文件：

```yaml
projectName: cx-training  # 改为你的项目名称
```

改为：

```yaml
projectName: cx  # 你在第 1 步创建的项目名称
```

### 第 5 步：推送代码

```bash
git add .
git commit -m "配置 GitHub Actions"
git push origin main
```

## ✅ 完成！

推送后，GitHub Actions 会自动：
1. 安装 LibreOffice
2. 生成静态文件
3. 部署到 Cloudflare Pages

查看部署状态：
- GitHub 仓库 → **Actions** 标签
- Cloudflare Dashboard → **Workers & Pages** → 你的项目

## ❓ 常见问题

### Q: 提示 "Project not found"？

**A:** 检查：
1. Cloudflare 项目名称是否正确
2. `.github/workflows/deploy.yml` 中的 `projectName` 是否匹配
3. API Token 权限是否包含 Cloudflare Pages Edit

### Q: 如何查看错误日志？

**A:** 
1. GitHub 仓库 → **Actions** 标签
2. 点击失败的 workflow
3. 展开步骤查看详细日志

### Q: 如何修改项目名称？

**A:** 
1. 在 Cloudflare 创建新项目（或重命名现有项目）
2. 修改 `.github/workflows/deploy.yml` 中的 `projectName`
3. 推送代码

## 📚 详细文档

查看 `GitHub-Actions部署说明.md` 了解更多详情。
