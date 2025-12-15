# 部署到 GitHub 和 Cloudflare Pages
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "部署到 GitHub 和 Cloudflare Pages" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 生成输出文件
Write-Host "[1/4] 生成输出文件..." -ForegroundColor Yellow
python main.py
if ($LASTEXITCODE -ne 0) {
    Write-Host "错误: 生成失败" -ForegroundColor Red
    Read-Host "按任意键退出"
    exit 1
}
Write-Host ""

# 添加所有更改
Write-Host "[2/4] 添加文件到 Git..." -ForegroundColor Yellow
git add .
Write-Host ""

# 提交更改
Write-Host "[3/4] 提交更改..." -ForegroundColor Yellow
$commitMsg = Read-Host "请输入提交信息"
if ([string]::IsNullOrWhiteSpace($commitMsg)) {
    $commitMsg = "更新内容"
}
git commit -m $commitMsg
Write-Host ""

# 推送到 GitHub
Write-Host "[4/4] 推送到 GitHub..." -ForegroundColor Yellow
git push origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host "错误: 推送失败，请检查网络连接和权限" -ForegroundColor Red
    Read-Host "按任意键退出"
    exit 1
}
Write-Host ""

Write-Host "========================================" -ForegroundColor Green
Write-Host "部署完成！" -ForegroundColor Green
Write-Host "GitHub Actions 将自动构建并部署到 Cloudflare Pages" -ForegroundColor Green
Write-Host "请访问 GitHub Actions 查看部署进度" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Read-Host "按任意键退出"
