# 快速开始指南 - 一键部署

## 🚀 第一次设置（只需 3 步）

### 步骤 1: 推送代码到 GitHub

```bash
# 如果还没有远程仓库，先在 GitHub 创建一个
# 然后添加远程仓库
git remote add origin https://github.com/你的用户名/你的仓库名.git

# 推送代码
git push -u origin main
```

### 步骤 2: 在 Cloudflare 连接 GitHub

**方法 A：一键设置（推荐）**

运行脚本：
```bash
# Windows CMD
setup-cloudflare.bat

# PowerShell
.\setup-cloudflare.ps1
```

脚本会自动推送代码并打开 Cloudflare 设置页面，按照提示配置即可！

**方法 B：手动设置**

1. 访问 https://dash.cloudflare.com/
2. 点击 **Workers & Pages** → **Create application**
3. 选择 **Pages** → **Connect to Git**
4. 授权并选择你的 GitHub 仓库
5. 配置构建设置：
   ```
   Production branch: main
   构建命令: chmod +x build.sh && ./build.sh
   输出目录: output
   ```
6. 添加环境变量：
   ```
   PYTHON_VERSION = 3.9
   DEBIAN_FRONTEND = noninteractive
   ```
7. 点击 **Save and Deploy**

**提示**：构建脚本会自动检测并安装 LibreOffice 来处理 `.doc` 文件，在 Cloudflare Pages 的 Linux 环境中使用 apt 安装

### 步骤 3: 等待部署完成 ✅

首次部署需要 2-5 分钟。完成后你会得到一个 URL：
```
https://你的项目名.pages.dev
```

## 📝 日常使用 - 一键部署

### 方法 1: 使用部署脚本（推荐）⭐

**Windows CMD:**
```bash
deploy.bat
```

**PowerShell:**
```powershell
.\deploy.ps1
```

脚本会自动：
1. 运行 `python main.py` 生成文件（可选）
2. 添加所有更改到 Git
3. 提示输入提交信息
4. 推送到 GitHub
5. **Cloudflare 自动检测并部署** 🎉

### 方法 2: 手动操作

```bash
# 1. 添加更改
git add .

# 2. 提交
git commit -m "更新内容"

# 3. 推送（Cloudflare 会自动部署）
git push origin main
```

就这么简单！推送后 Cloudflare 会自动：
- 检测到推送
- 运行 `python main.py`
- 部署 `output` 文件夹

## 📊 查看部署状态

### Cloudflare Pages（推荐）
1. 访问 https://dash.cloudflare.com/
2. 点击 **Workers & Pages**
3. 选择你的项目
4. 查看 **Deployments** 标签
   - 🟢 绿色勾号 = 部署成功
   - 🟡 黄色圆圈 = 正在部署
   - 🔴 红色叉号 = 部署失败（点击查看日志）

### 部署通知
Cloudflare 会发送邮件通知部署状态（可在设置中配置）

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

**A:** 不需要。`.gitignore` 已配置忽略 `output` 文件夹，Cloudflare 会在云端重新生成。

### Q: 为什么选择 Cloudflare Pages？

**A:** 
- ✅ 完全免费（无限带宽）
- ✅ 全球 CDN 加速
- ✅ 自动 HTTPS
- ✅ 自动构建和部署
- ✅ 支持自定义域名
- ✅ 每次推送自动部署

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
