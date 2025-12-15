# Cloudflare Pages 配置检查清单

## ✅ 检查项目是否存在

1. 访问 https://dash.cloudflare.com/
2. 点击 **Workers & Pages**
3. 确认看到名为 `cx` 的项目
4. 点击项目，记下项目详情

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

## 🚀 重新运行部署

配置正确后：
1. 进入 GitHub 仓库 → **Actions**
2. 点击失败的 workflow
3. 点击 **Re-run jobs** → **Re-run all jobs**

## 📞 需要帮助？

如果仍然失败，请提供：
1. GitHub Actions 的完整错误日志
2. Cloudflare 项目名称
3. 是否看到两个 Secrets 都已配置

我可以帮你进一步诊断问题。
