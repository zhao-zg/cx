#!/usr/bin/env pwsh
# 一键设置 Cloudflare Pages 部署

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  一键设置 Cloudflare Pages 部署" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查是否已推送到 GitHub
Write-Host "[1/3] 检查 Git 状态..." -ForegroundColor Yellow
$remotes = git remote -v
if ($remotes -notmatch "github.com") {
    Write-Host "❌ 错误: 未找到 GitHub 远程仓库" -ForegroundColor Red
    Write-Host ""
    Write-Host "请先添加 GitHub 远程仓库:" -ForegroundColor Yellow
    Write-Host "  git remote add origin https://github.com/你的用户名/你的仓库名.git"
    Write-Host "  git push -u origin main"
    Read-Host "按 Enter 键退出"
    exit 1
}

Write-Host "✓ 已连接到 GitHub" -ForegroundColor Green
Write-Host ""

# 推送代码
Write-Host "[2/3] 推送代码到 GitHub..." -ForegroundColor Yellow
git add .
git commit -m "配置 Cloudflare Pages 部署" 2>$null
git push origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠ 推送失败或无新更改" -ForegroundColor Yellow
} else {
    Write-Host "✓ 代码已推送" -ForegroundColor Green
}
Write-Host ""

# 打开 Cloudflare Pages
Write-Host "[3/3] 打开 Cloudflare Pages 设置页面..." -ForegroundColor Yellow
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  请在浏览器中完成以下步骤:" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. 点击 'Create application' → 'Pages'" -ForegroundColor White
Write-Host "2. 点击 'Connect to Git' → 选择 'GitHub'" -ForegroundColor White
Write-Host "3. 授权并选择你的仓库" -ForegroundColor White
Write-Host "4. 配置构建设置:" -ForegroundColor White
Write-Host ""
Write-Host "   Production branch: main" -ForegroundColor Cyan
Write-Host ""
Write-Host "   构建命令 (Build command):" -ForegroundColor Cyan
Write-Host "   chmod +x build.sh && ./build.sh" -ForegroundColor Green
Write-Host ""
Write-Host "   输出目录 (Build output directory):" -ForegroundColor Cyan
Write-Host "   output" -ForegroundColor Green
Write-Host ""
Write-Host "5. 环境变量 (Environment variables):" -ForegroundColor White
Write-Host "   PYTHON_VERSION = 3.9" -ForegroundColor Cyan
Write-Host "   DEBIAN_FRONTEND = noninteractive" -ForegroundColor Cyan
Write-Host ""
Write-Host "6. 点击 'Save and Deploy'" -ForegroundColor White
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Start-Process "https://dash.cloudflare.com/"

Write-Host "✅ 浏览器已打开，请按照上述步骤配置" -ForegroundColor Green
Write-Host ""
Write-Host "配置完成后，每次推送代码都会自动部署！" -ForegroundColor Yellow
Write-Host ""
Read-Host "按 Enter 键退出"
