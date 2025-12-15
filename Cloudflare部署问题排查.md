# Cloudflare Pages 部署问题排查指南

## 🚨 当前问题

GitHub Actions 部署时出现错误：
```
Cloudflare API returned non-200: 404
Project not found
```

## ✅ 快速排查步骤

### 步骤 1：运行诊断测试（最重要！）

1. 打开你的 GitHub 仓库
2. 点击顶部 **Actions** 标签
3. 在左侧找到 **测试 Cloudflare 配置**
4. 点击右侧蓝色按钮 **Run workflow**
5. 再次点击绿色 **Run workflow** 确认
6. 等待 10 秒，刷新页面
7. 点击运行记录查看结果

**测试会告诉你：**
- ✅ 你的 Secrets 是否配置正确
- ✅ API 连接是否成功
- 📋 你账户下所有的 Cloudflare Pages 项目
- ✅/❌ 是否找到 `cx` 项目

### 步骤 2：根据测试结果修复

#### 情况 A：测试显示"未找到项目 cx"

**可能原因：**
1. 项目名称不对（比如实际是 `CX` 或 `Cx`）
2. 项目在不同的账户下
3. 项目还没创建

**解决方法：**

**方法 1：** 修改 workflow 中的项目名称
```yaml
# 编辑 .github/workflows/deploy.yml
projectName: cx  # 改成测试显示的实际项目名称
```

**方法 2：** 在 Cloudflare 创建项目
1. 访问 https://dash.cloudflare.com/
2. 点击 **Workers & Pages**
3. 点击 **Create application** → **Pages** → **Connect to Git**
4. 选择 **Create project without Git**
5. 项目名称输入：`cx`（小写）
6. 点击 **Create project**

#### 情况 B：测试显示"API 连接失败"

**可能原因：**
- Account ID 错误
- API Token 无效或权限不足

**解决方法：**

1. **检查 Account ID**
   - 访问 https://dash.cloudflare.com/
   - 在右侧找到 **Account ID**
   - 复制这个 ID

2. **更新 GitHub Secret**
   - 进入 GitHub 仓库 → **Settings** → **Secrets and variables** → **Actions**
   - 点击 `CLOUDFLARE_ACCOUNT_ID`
   - 点击 **Update**
   - 粘贴正确的 Account ID
   - 点击 **Update secret**

3. **检查 API Token**
   - 访问 https://dash.cloudflare.com/profile/api-tokens
   - 找到你的 Token，点击 **Edit**
   - 确认权限包含：`Account - Cloudflare Pages - Edit`
   - 如果没有，删除旧 Token，创建新的

4. **创建新的 API Token**（如果需要）
   - 点击 **Create Token**
   - 选择 **Edit Cloudflare Workers** 模板
   - 或自定义权限：`Account - Cloudflare Pages - Edit`
   - 点击 **Continue to summary** → **Create Token**
   - 复制 Token（只显示一次！）
   - 在 GitHub 更新 `CLOUDFLARE_API_TOKEN` Secret

#### 情况 C：测试显示"Secrets 未配置"

**解决方法：**

1. 进入 GitHub 仓库 → **Settings** → **Secrets and variables** → **Actions**
2. 点击 **New repository secret**
3. 添加两个 secrets：

**Secret 1：**
- Name: `CLOUDFLARE_API_TOKEN`
- Value: 你的 Cloudflare API Token

**Secret 2：**
- Name: `CLOUDFLARE_ACCOUNT_ID`
- Value: 你的 Cloudflare Account ID

## 🔄 修复后重新部署

1. 进入 GitHub 仓库 → **Actions**
2. 点击最新的失败记录
3. 点击右上角 **Re-run jobs** → **Re-run all jobs**

或者：
- 提交任何代码到 `main` 分支
- 会自动触发新的部署

## 📋 检查清单

在运行诊断测试前，确认：

- [ ] 已在 Cloudflare 创建了项目（名称：`cx`）
- [ ] 已获取 Cloudflare Account ID
- [ ] 已创建 API Token（权限：Cloudflare Pages - Edit）
- [ ] 已在 GitHub 添加两个 Secrets
- [ ] Secrets 的值没有多余的空格

## 💡 提示

1. **项目名称区分大小写**
   - `cx` ≠ `CX` ≠ `Cx`
   - 必须完全匹配

2. **API Token 只显示一次**
   - 创建后立即复制
   - 如果忘记了，需要重新创建

3. **Account ID 在哪里找**
   - Cloudflare Dashboard 右侧
   - 或者在任何项目的 URL 中：
     `https://dash.cloudflare.com/[这里是Account ID]/pages/...`

4. **诊断测试很重要**
   - 可以看到你账户下所有项目
   - 可以确认 API 连接是否正常
   - 可以快速定位问题

## 🆘 还是不行？

如果按照上面的步骤还是失败，请提供：

1. **诊断测试的完整输出**
   - 运行 "测试 Cloudflare 配置" workflow
   - 复制所有输出内容

2. **Cloudflare 项目列表**
   - 访问 https://dash.cloudflare.com/
   - 点击 **Workers & Pages**
   - 截图或列出所有项目名称

3. **API Token 权限**
   - 访问 https://dash.cloudflare.com/profile/api-tokens
   - 截图权限设置（隐藏 Token 值）

有了这些信息，可以快速帮你解决问题！
