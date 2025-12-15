# 快速开始指南

## 第一次部署到 Cloudflare Pages

### 步骤 1: 推送代码到 GitHub

如果还没有推送到 GitHub：

```bash
# 如果还没有远程仓库，先创建一个
# 然后添加远程仓库
git remote add origin https://github.com/你的用户名/你的仓库名.git

# 推送代码
git push -u origin main
```

如果已经有远程仓库：

```bash
git push origin main
```

### 步骤 2: 在 Cloudflare 创建 Pages 项目

1. 访问 https://dash.cloudflare.com/
2. 点击左侧菜单的 **Workers & Pages**
3. 点击 **Create application** → **Pages** → **Connect to Git**
4. 选择你的 GitHub 仓库
5. 配置构建设置：
   - **Framework preset**: None
   - **Build command**: `python main.py`
   - **Build output directory**: `output`
6. 点击 **Save and Deploy**

### 步骤 3: 获取 Cloudflare API Token 和 Account ID

#### 获取 API Token:
1. 在 Cloudflare Dashboard，点击右上角头像
2. 选择 **My Profile** → **API Tokens**
3. 点击 **Create Token**
4. 选择 **Edit Cloudflare Workers** 模板
5. 或者创建自定义 token，权限设置：
   - Account - Cloudflare Pages - Edit
6. 复制生成的 API Token

#### 获取 Account ID:
1. 在 Cloudflare Dashboard 主页
2. 右侧可以看到 **Account ID**
3. 复制这个 ID

### 步骤 4: 在 GitHub 设置 Secrets

1. 进入你的 GitHub 仓库
2. 点击 **Settings** → **Secrets and variables** → **Actions**
3. 点击 **New repository secret**
4. 添加两个 secrets：

**Secret 1:**
- Name: `CLOUDFLARE_API_TOKEN`
- Value: 粘贴你的 API Token

**Secret 2:**
- Name: `CLOUDFLARE_ACCOUNT_ID`
- Value: 粘贴你的 Account ID

### 步骤 5: 修改工作流配置

编辑 `.github/workflows/deploy.yml`，修改项目名称：

```yaml
projectName: 你的项目名称  # 改成你在 Cloudflare 创建的项目名称
```

### 步骤 6: 提交并推送

```bash
git add .github/workflows/deploy.yml
git commit -m "配置 Cloudflare Pages 项目名称"
git push origin main
```

## 日常使用

### 方法 1: 使用部署脚本（推荐）

**Windows CMD:**
```bash
deploy.bat
```

**PowerShell:**
```powershell
.\deploy.ps1
```

脚本会自动：
1. 运行 `python main.py` 生成文件
2. 添加所有更改到 Git
3. 提示输入提交信息
4. 推送到 GitHub
5. 触发自动部署

### 方法 2: 手动操作

```bash
# 1. 生成文件（可选，CI 会自动生成）
python main.py

# 2. 添加更改
git add .

# 3. 提交
git commit -m "更新内容"

# 4. 推送
git push origin main
```

## 查看部署状态

### GitHub Actions
1. 进入 GitHub 仓库
2. 点击 **Actions** 标签
3. 查看最新的工作流运行状态

### Cloudflare Pages
1. 进入 Cloudflare Dashboard
2. 点击 **Workers & Pages**
3. 选择你的项目
4. 查看部署历史和日志

## 常见问题

### Q: 部署失败怎么办？

**A:** 检查以下几点：
1. GitHub Secrets 是否正确设置
2. Cloudflare 项目名称是否匹配
3. 查看 GitHub Actions 日志找出错误原因

### Q: 如何回滚到之前的版本？

**A:** 
1. 在 Cloudflare Pages 项目中
2. 进入 **Deployments** 标签
3. 找到之前的部署
4. 点击 **Rollback to this deployment**

### Q: 如何使用自定义域名？

**A:**
1. 在 Cloudflare Pages 项目设置中
2. 进入 **Custom domains**
3. 添加你的域名
4. 按照提示配置 DNS 记录

### Q: 本地生成的 output 文件夹需要提交吗？

**A:** 不需要。`.gitignore` 已经配置忽略 output 文件夹，因为 CI 会自动生成。

## 高级配置

### 修改构建命令

编辑 `.github/workflows/deploy.yml`：

```yaml
- name: Generate output files
  run: |
    python main.py
    # 添加其他命令
```

### 添加环境变量

在 GitHub Secrets 中添加，然后在工作流中使用：

```yaml
env:
  MY_VAR: ${{ secrets.MY_VAR }}
```

## 获取帮助

- GitHub Actions 文档: https://docs.github.com/actions
- Cloudflare Pages 文档: https://developers.cloudflare.com/pages/
- 项目问题: 在 GitHub 仓库创建 Issue
