---
AIGC:
  ContentProducer: '001191110102MAD55U9H0F10002'
  ContentPropagator: '001191110102MAD55U9H0F10002'
  Label: '1'
  ProduceID: '0178e88a-d461-4de0-a24d-0301a6d7bcbc'
  PropagateID: '0178e88a-d461-4de0-a24d-0301a6d7bcbc'
  ReservedCode1: 'dfaec2f4-4edf-43aa-992e-80ed1d9889e7'
  ReservedCode2: 'dfaec2f4-4edf-43aa-992e-80ed1d9889e7'
---

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

**重要提示**：
- ⚠️ Cloudflare Pages 构建环境没有 sudo 权限，无法安装 LibreOffice
- ✅ **请确保所有文档都是 `.docx` 格式**（不要使用 `.doc` 格式）
- ✅ 如果有 `.doc` 文件，请在本地用 Word 转换为 `.docx` 后再推送

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

---

# 多 Cloudflare 账户容灾部署

## 架构概览

```
                    push main / 手动触发
                           │
                    ┌──────▼──────┐
                    │   build job  │  生成静态文件（只执行一次）
                    └──────┬──────┘
                           │ upload-artifact
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌─────────┐  ┌─────────┐  ┌─────────┐
        │ CF 账户1 │  │ CF 账户2 │  │ CF 账户N │  matrix 并行部署
        └─────────┘  └─────────┘  └─────────┘
              │            │            │
              ▼            ▼            ▼
         域名1.com    域名2.com    域名N.com
              └────────────┼────────────┘
                           │
                    ┌──────▼──────┐
                    │  前端竞速    │  smartFetch 自动选最快镜像
                    └─────────────┘
```

- **同步部署**：每次推送 main，所有账户同时部署（matrix 并行）
- **容灾**：任一账户故障，前端竞速自动切换到可用镜像
- **无感扩展**：增减账户只需改 3 处配置，无需改代码逻辑

## 配置文件

| 文件 | 用途 |
|------|------|
| `.github/workflows/deploy.yml` | CI/CD 部署流程，matrix 多账户并行 |
| `.github/workflows/test-cloudflare.yml` | 多账户 Secrets/API 连通性测试 |
| `config.yaml` → `remote_servers.cloudflare` | 前端域名列表（remote-config.js 注入） |
| `worker-get/worker.js` → `FALLBACK_BASES` | APK 代理下载镜像列表 |

## 新增账户步骤

### 1. Cloudflare 侧

1. 登录新 Cloudflare 账户
2. 创建 Pages 项目，名称为 `cx`
3. 绑定自定义域名（如 `cx2.11891189.xyz`）
4. 确认 DNS 记录正确

### 2. GitHub Secrets

在 repo Settings → Secrets and variables → Actions 添加：

| Secret 名 | 值 |
|-----------|-----|
| `CLOUDFLARE_ACCOUNT_ID_N` | 新账户的 Account ID |
| `CLOUDFLARE_API_TOKEN_N` | 新账户的 API Token（需 Cloudflare Pages - Edit 权限） |

`N` 为账户序号，从 1 开始递增。

### 3. deploy.yml

在 `env.DEPLOY_TARGETS` 列表新增一行：

```yaml
env:
  DEPLOY_TARGETS: |
    [
      { "account": "1", "label": "主账户" },
      { "account": "2", "label": "备用账户" },
      { "account": "3", "label": "新账户" }  ← 新增
    ]
```

### 4. config.yaml

在 `remote_servers.cloudflare` 添加新域名：

```yaml
remote_servers:
  cloudflare:
    - https://cx.1189.dpdns.org/
    - https://cx.zhaozg.cloudns.org/
    - https://cx.zhaozg.dpdns.org/
    - https://cx2.11891189.xyz/     # ← 新增
```

### 5. worker.js（可选）

如需 APK 代理也覆盖新账户，在 `FALLBACK_BASES` 添加：

```javascript
const FALLBACK_BASES = [
  // ... 现有镜像 ...
  'https://cx2.11891189.xyz/'       // ← 新增
];
```

### 6. test-cloudflare.yml（与 deploy.yml 同步）

更新 `DEPLOY_TARGETS` 与 deploy.yml 保持一致，然后手动触发测试。

## 移除账户

1. 从 `deploy.yml` 的 `DEPLOY_TARGETS` 删除对应行
2. 从 `config.yaml` 删除对应域名
3. 从 `worker.js` 删除对应镜像（如有）
4. GitHub Secrets 可保留或删除（不影响运行）

## Secrets 命名规则

| 后缀 | Secret | 说明 |
|------|--------|------|
| `_1` | `CLOUDFLARE_ACCOUNT_ID_1` | 账户 1 的 Account ID |
| `_1` | `CLOUDFLARE_API_TOKEN_1` | 账户 1 的 API Token |
| `_2` | `CLOUDFLARE_ACCOUNT_ID_2` | 账户 2 的 Account ID |
| `_2` | `CLOUDFLARE_API_TOKEN_2` | 账户 2 的 API Token |
| `_N` | `CLOUDFLARE_ACCOUNT_ID_N` | 第 N 个账户的 Account ID |
| `_N` | `CLOUDFLARE_API_TOKEN_N` | 第 N 个账户的 API Token |

## 部署行为

- **并行部署**：所有账户同时部署（max-parallel: 4）
- **独立重试**：每个账户独立 3 次重试，互不影响
- **fail-fast: false**：一个账户失败不阻止其他账户
- **部分成功**：部分账户部署失败不标记整体失败（容灾模式）
- **构建只执行一次**：build job 产出通过 artifact 共享给所有部署 job

## 前端容灾选路

前端通过 `smartFetch` 策略自动选路（无需改动）：

1. **日常请求**（1 次）：直取 localStorage 记录的最快镜像
2. **失败时竞速**：并发请求所有镜像，取最快响应
3. **全败降级**：降级本地文件
4. **持久记忆**：竞速结果写入 localStorage，重启后仍可用

新增账户域名加入 `config.yaml` 后，前端自动纳入竞速池，无需改任何 JS 代码。