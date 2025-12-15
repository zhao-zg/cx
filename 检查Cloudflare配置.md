# Cloudflare Pages 配置检查清单

## 🔍 第一步：运行诊断测试

1. 进入 GitHub 仓库 → **Actions** 标签
2. 点击左侧 **测试 Cloudflare 配置** workflow
3. 点击右侧 **Run workflow** → **Run workflow** 按钮
4. 等待测试完成（约 10 秒）
5. 查看测试结果，会显示：
   - ✅ Secrets 是否配置
   - ✅ API 连接是否成功
   - 📋 你的所有 Cloudflare Pages 项目列表
   - ✅/❌ 是否找到 `cx` 项目

**根据测试结果继续下面的步骤**

---

## ✅ 检查项目是否存在

1. 访问 https://dash.cloudflare.com/
2. 点击 **Workers & Pages**
3. 确认看到名为 `cx` 的项目
4. 点击项目，记下项目详情

**重要：** 项目名称必须完全匹配，区分大小写！

## ✅ 检查 Account ID

1. 在 Cloudflare Dashboard 右侧可以看到 **Account ID**
2. 复制这个 ID
3. 进入 GitHub 仓库 → **Settings** → **Secrets and variables** → **Actions**
4. 检查 `CLOUDFLARE_ACCOUNT_ID` 的值是否与 Dashboard 显示的一致

**如何更新：**
- 点击 `CLOUDFLARE_ACCOUNT_ID`
- 点击 **Update**
- 粘贴正确的 Account ID
- 点击 **Update secret**

## ✅ 检查 API Token 权限

1. 访问 https://dash.cloudflare.com/profile/api-tokens
2. 找到你创建的 Token
3. 点击 **Edit** 查看权限

**必需的权限：**
```
Account - Cloudflare Pages - Edit
```

**如果权限不对：**
1. 删除旧的 Token
2. 创建新的 Token：
   - 使用模板 **Edit Cloudflare Workers**
   - 或自定义权限：`Account - Cloudflare Pages - Edit`
3. 复制新的 Token
4. 在 GitHub 更新 `CLOUDFLARE_API_TOKEN` Secret

## ✅ 检查 GitHub Secrets

进入 GitHub 仓库 → **Settings** → **Secrets and variables** → **Actions**

应该看到两个 secrets：
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

**如果缺少任何一个：**
1. 点击 **New repository secret**
2. 添加缺失的 secret

## ✅ 检查项目名称

在 `.github/workflows/deploy.yml` 中：
```yaml
projectName: cx  # 必须与 Cloudflare 中的项目名称完全一致
```

**注意：**
- 名称区分大小写
- 不能有空格
- 必须完全匹配

## 🔧 常见问题

### 问题 1：API Token 无效

**症状：**
```
Cloudflare API returned non-200: 401
```

**解决：**
1. 重新创建 API Token
2. 确保权限包含 `Cloudflare Pages - Edit`
3. 更新 GitHub Secret

### 问题 2：Account ID 错误

**症状：**
```
Cloudflare API returned non-200: 404
Project not found
```

**解决：**
1. 检查 Cloudflare Dashboard 右侧的 Account ID
2. 确保 GitHub Secret 中的值完全一致
3. 注意不要有多余的空格

### 问题 3：项目名称不匹配

**症状：**
```
Project not found. The specified project name does not match
```

**解决：**
1. 在 Cloudflare 检查项目的确切名称
2. 修改 `.github/workflows/deploy.yml` 中的 `projectName`
3. 提交并推送

## 🔧 高级诊断

### 方法 1：手动测试 API

在本地终端运行（替换你的实际值）：

```bash
# 替换为你的实际值
ACCOUNT_ID="你的Account ID"
API_TOKEN="你的API Token"

# 列出所有项目
curl -X GET \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/pages/projects" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" | jq '.'
```

### 方法 2：检查 API Token 范围

1. 访问 https://dash.cloudflare.com/profile/api-tokens
2. 找到你的 Token，点击 **Edit**
3. 确认 **Permissions** 包含：
   ```
   Account - Cloudflare Pages - Edit
   ```
4. 确认 **Account Resources** 选择了正确的账户

### 方法 3：重新创建项目

如果项目确实存在但 API 找不到，可能需要：

1. 在 Cloudflare 删除 `cx` 项目
2. 重新创建项目：
   - 项目名称：`cx`（小写）
   - 不要连接 Git（我们用 API 部署）
3. 重新运行 GitHub Actions

## 🚀 重新运行部署

配置正确后：
1. 进入 GitHub 仓库 → **Actions**
2. 点击失败的 workflow
3. 点击 **Re-run jobs** → **Re-run all jobs**

## 📊 诊断测试结果解读

### 场景 1：找到项目列表，但没有 `cx`

**原因：** 项目名称不匹配或项目不存在

**解决：**
- 检查 Cloudflare 中的实际项目名称
- 修改 `.github/workflows/deploy.yml` 中的 `projectName`
- 或在 Cloudflare 创建名为 `cx` 的项目

### 场景 2：API 返回 401 错误

**原因：** API Token 无效

**解决：**
- 重新创建 API Token
- 更新 GitHub Secret `CLOUDFLARE_API_TOKEN`

### 场景 3：API 返回 403 错误

**原因：** API Token 权限不足

**解决：**
- 编辑 Token，添加 `Cloudflare Pages - Edit` 权限
- 或重新创建 Token

### 场景 4：API 返回 404 错误

**原因：** Account ID 不正确

**解决：**
- 检查 Cloudflare Dashboard 右侧的 Account ID
- 更新 GitHub Secret `CLOUDFLARE_ACCOUNT_ID`

## 📞 需要帮助？

如果仍然失败，请提供：
1. **诊断测试** 的完整输出（运行 "测试 Cloudflare 配置" workflow）
2. Cloudflare 项目列表截图
3. API Token 权限截图（隐藏 Token 值）

这样可以快速定位问题！
