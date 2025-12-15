# 部署到 Cloudflare Pages

本项目配置了自动部署到 Cloudflare Pages。每次推送到 `main` 分支时，GitHub Actions 会自动构建并部署。

## 初次设置步骤

### 1. 在 Cloudflare 创建 Pages 项目

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 **Pages** 部分
3. 点击 **Create a project**
4. 选择 **Direct Upload** 方式（因为我们使用 GitHub Actions）
5. 输入项目名称（例如：`cx-training`）

### 2. 获取 Cloudflare API Token

1. 在 Cloudflare Dashboard，点击右上角头像
2. 选择 **My Profile** → **API Tokens**
3. 点击 **Create Token**
4. 使用 **Edit Cloudflare Workers** 模板，或创建自定义 token
5. 权限设置：
   - Account - Cloudflare Pages - Edit
6. 复制生成的 API Token

### 3. 获取 Cloudflare Account ID

1. 在 Cloudflare Dashboard 主页
2. 右侧可以看到 **Account ID**
3. 复制这个 ID

### 4. 在 GitHub 设置 Secrets

1. 进入你的 GitHub 仓库
2. 点击 **Settings** → **Secrets and variables** → **Actions**
3. 点击 **New repository secret**
4. 添加以下两个 secrets：
   - `CLOUDFLARE_API_TOKEN`: 粘贴你的 API Token
   - `CLOUDFLARE_ACCOUNT_ID`: 粘贴你的 Account ID

### 5. 修改工作流配置（如果需要）

编辑 `.github/workflows/deploy.yml`：
- 修改 `projectName` 为你的 Cloudflare Pages 项目名称
- 如果主分支不是 `main`，修改 `branches` 配置

## 部署流程

1. 修改代码或资源文件
2. 提交并推送到 GitHub：
   ```bash
   git add .
   git commit -m "更新内容"
   git push origin main
   ```
3. GitHub Actions 会自动：
   - 安装 Python 依赖
   - 运行 `python main.py` 生成 output 文件
   - 将 output 文件夹部署到 Cloudflare Pages
4. 几分钟后，你的网站就会更新

## 手动触发部署

如果需要手动触发部署：
1. 进入 GitHub 仓库的 **Actions** 标签
2. 选择 **Deploy to Cloudflare Pages** 工作流
3. 点击 **Run workflow**

## 查看部署状态

- **GitHub Actions**: 在仓库的 **Actions** 标签查看构建日志
- **Cloudflare Pages**: 在 Cloudflare Dashboard 的 Pages 项目中查看部署历史

## 自定义域名（可选）

1. 在 Cloudflare Pages 项目设置中
2. 进入 **Custom domains**
3. 添加你的域名
4. 按照提示配置 DNS 记录

## 注意事项

- 确保 `resource` 文件夹中的 `.doc` 和 `.docx` 文件已提交到仓库
- 如果文件较大，考虑使用 Git LFS
- 每次推送都会触发构建，建议在本地测试后再推送
