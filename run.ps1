# Word文档静态网站生成器 - 快速启动脚本
# 使用方法：双击运行此文件，或在PowerShell中执行 .\run.ps1

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Word文档静态网站生成器" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查虚拟环境
if (-not (Test-Path ".venv\Scripts\python.exe")) {
    Write-Host "错误: 虚拟环境不存在，请先运行以下命令：" -ForegroundColor Red
    Write-Host "  python -m venv .venv" -ForegroundColor Yellow
    Write-Host "  .venv\Scripts\pip install python-docx jinja2 pyyaml" -ForegroundColor Yellow
    pause
    exit 1
}

# 运行主程序
Write-Host "正在生成HTML文件..." -ForegroundColor Green
Write-Host ""

.venv\Scripts\python.exe main.py

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "生成成功！" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    
    # 询问是否打开浏览器
    $open = Read-Host "是否在浏览器中打开首页？(Y/N)"
    if ($open -eq "Y" -or $open -eq "y") {
        $indexPath = Join-Path $PSScriptRoot "output\index.html"
        Start-Process $indexPath
    }
    
    Write-Host ""
    Write-Host "提示：HTML文件位于 output 目录中" -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "生成失败，请检查错误信息。" -ForegroundColor Red
}

Write-Host ""
Write-Host "按任意键退出..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
