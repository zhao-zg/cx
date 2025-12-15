# 部署到 Cloudflare Pages

本项目配置了自动部署到 Cloudflare Pages。Cloudflare Pages 会直接连接你的 GitHub 仓库，每次推送时自动构建并部署。

## 一键部署设置（只需设置一次）

### 步骤 1: 推送代码到 GitHub

首先确保代码已推送到 GitHub：

```bash
git push origin main
```

### 步骤 2: 在 Cloudflare 连接 GitHub 仓库

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 点击左侧菜单 **Workers & Pages**
3. 点击 **Create application** → **Pages** → **Connect to Git**
4. 选择 **GitHub**，授权 Cloudflare 访问你的 GitHub
5. 选择你的仓库（例如：`cx-training`）
6. 配置构建设置：
   - **Production branch**: `main`
   - **Framework preset**: `None`
   - **Build command**: `chmod +x build.sh && ./build.sh`
   - **Build output directory**: `output`
   - **Root directory**: `/` (保持默认)
   
   **注意**：Cloudflare Pages 目前不支持分离的构建和部署命令，使用 `build.sh` 包含完整流程。

7. 展开 **Environment variables (advanced)**，添加：
   - Variable name: `PYTHON_VERSION`, Value: `3.9`
   - Variable name: `DEBIAN_FRONTEND`, Value: `noninteractive`
8. 点击 **Save and Deploy**

**注意**：
- 构建脚本会自动检测并安装 LibreOffice（用于转换 `.doc` 文件）
- 如果你的文档都是 `.docx` 格式，LibreOffice 不是必需的
- 在 Cloudflare Pages 的 Linux 环境中，会使用 apt 自动安装 LibreOffice

### 步骤 3: 等待首次部署完成

Cloudflare 会自动：
1. 克隆你的仓库
2. 安装 Python 依赖（从 `requirements.txt`）
3. 运行 `python main.py` 生成静态文件
4. 部署 `output` 文件夹

首次部署大约需要 2-5 分钟。

## 完成！自动部署已启用

从现在开始，每次你推送代码到 GitHub，Cloudflare Pages 会自动：
- 检测到推送
- 重新构建网站
- 自动部署更新

## 日常使用 - 一键部署

使用提供的部署脚本：

**Windows CMD:**
```bash
deploy.bat
```

**PowerShell:**
```powershell
.\deploy.ps1
```

脚本会自动：
1. 运行 `python main.py` 生成文件（可选，Cloudflare 会重新生成）
2. 提交所有更改
3. 推送到 GitHub
4. Cloudflare 自动检测并部署

## 查看部署状态

### Cloudflare Dashboard
1. 进入 **Workers & Pages**
2. 选择你的项目
3. 查看 **Deployments** 标签
   - 绿色勾号 = 部署成功
   - 黄色圆圈 = 正在部署
   - 红色叉号 = 部署失败（点击查看日志）

## 高级功能

### 自定义域名

1. 在 Cloudflare Pages 项目中
2. 进入 **Custom domains** 标签
3. 点击 **Set up a custom domain**
4. 输入你的域名
5. 按照提示配置 DNS 记录（如果域名在 Cloudflare，会自动配置）

### 回滚到之前的版本

1. 在 Cloudflare Pages 项目中
2. 进入 **Deployments** 标签
3. 找到之前的成功部署
4. 点击 **...** → **Rollback to this deployment**

### 预览部署

Cloudflare Pages 会为每个分支创建预览 URL：
- 主分支：`https://你的项目.pages.dev`
- 其他分支：`https://分支名.你的项目.pages.dev`

### 环境变量

如果需要添加环境变量：
1. 进入项目 **Settings** → **Environment variables**
2. 添加变量（例如：`PYTHON_VERSION=3.9`）
3. 重新部署生效

## 常见问题

### Q: 部署失败怎么办？

**A:** 
1. 在 Cloudflare Pages 项目中查看部署日志
2. 常见问题：
   - Python 版本不匹配：添加 `PYTHON_VERSION` 环境变量
   - 依赖安装失败：检查 `requirements.txt`
   - 构建命令错误：确认 `python main.py` 可以正常运行

### Q: 如何查看构建日志？

**A:**
1. 进入 Cloudflare Pages 项目
2. 点击失败的部署
3. 查看 **Build log** 和 **Function log**

### Q: 本地生成的 output 需要提交吗？

**A:** 不需要。`.gitignore` 已配置忽略 `output` 文件夹，Cloudflare 会在云端重新生成。

### Q: 可以禁用自动部署吗？

**A:** 
1. 进入项目 **Settings** → **Builds & deployments**
2. 可以暂停自动部署或配置部署分支

## 注意事项

- ✅ 确保 `resource` 文件夹中的 `.doc` 和 `.docx` 文件已提交到仓库
- ✅ 如果文件较大（>100MB），考虑使用 Git LFS
- ✅ 每次推送都会触发构建，建议在本地测试后再推送
- ✅ 构建时间通常 2-5 分钟，取决于文件数量

## 获取帮助

- Cloudflare Pages 文档: https://developers.cloudflare.com/pages/
- 项目问题: 在 GitHub 仓库创建 Issue
