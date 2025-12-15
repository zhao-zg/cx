# 创建 Cloudflare Pages 项目用于 API 部署

## 问题说明

通过"上传文件"方式创建的 Cloudflare Pages 项目，无法通过 API 进行后续部署。
需要创建一个专门用于 API 部署的项目。

## ✅ 正确的创建步骤

### 步骤 1：访问 Cloudflare Pages

1. 访问 https://dash.cloudflare.com/
2. 点击左侧 **Workers & Pages**
3. 点击 **Create application**
4. 选择 **Pages** 标签

### 步骤 2：选择创建方式

**重要：** 不要选择"上传文件"！

1. 点击 **Connect to Git**
2. 在弹出的页面中，**不要连接任何仓库**
3. 找到并点击底部的 **Direct Upload** 或 **Create project without Git** 链接

如果没有这个选项，可以：
1. 随便选择一个 Git 仓库（或创建一个空仓库）
2. 项目名称输入：`cx`
3. 创建后，我们通过 API 覆盖部署

### 步骤 3：配置项目

1. **Project name**: `cx`（小写，必须完全匹配）
2. **Production branch**: 留空或选择 `main`
3. **Build settings**: 全部留空（我们不需要 Cloudflare 构建）
4. 点击 **Save and Deploy**

### 步骤 4：验证项目创建

1. 在 Workers & Pages 页面应该能看到 `cx` 项目
2. 点击项目，记下项目 URL

## 🔄 重新运行诊断测试

创建项目后：

1. 进入 GitHub 仓库 → **Actions**
2. 点击 **测试 Cloudflare 配置**
3. 点击 **Run workflow** → **Run workflow**
4. 查看结果，应该显示：✅ 找到项目: cx

## 🚀 重新部署

确认测试通过后：

1. 进入 GitHub 仓库 → **Actions**
2. 点击最新的失败记录
3. 点击 **Re-run jobs** → **Re-run all jobs**

或者提交任何代码触发自动部署。

## 💡 为什么"上传文件"方式不行？

通过"上传文件"创建的项目：
- 是一次性的部署
- 没有关联的项目配置
- API 无法识别或访问

通过 Git 或 Direct Upload 创建的项目：
- 有完整的项目配置
- 可以通过 API 持续部署
- 支持多次部署和版本管理

## 🆘 如果还是找不到创建选项

可以使用 Cloudflare API 创建项目：

```bash
# 替换为你的实际值
ACCOUNT_ID="你的Account ID"
API_TOKEN="你的API Token"

curl -X POST \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/pages/projects" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "cx",
    "production_branch": "main"
  }'
```

或者告诉我，我可以帮你创建一个脚本。
