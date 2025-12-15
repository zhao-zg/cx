@echo off
chcp 65001 >nul
echo ========================================
echo   一键设置 Cloudflare Pages 部署
echo ========================================
echo.

REM 检查是否已推送到 GitHub
echo [1/3] 检查 Git 状态...
git remote -v | findstr "github.com" >nul
if errorlevel 1 (
    echo ❌ 错误: 未找到 GitHub 远程仓库
    echo.
    echo 请先添加 GitHub 远程仓库:
    echo   git remote add origin https://github.com/你的用户名/你的仓库名.git
    echo   git push -u origin main
    pause
    exit /b 1
)

echo ✓ 已连接到 GitHub
echo.

REM 推送代码
echo [2/3] 推送代码到 GitHub...
git add .
git commit -m "配置 Cloudflare Pages 部署" 2>nul
git push origin main
if errorlevel 1 (
    echo ⚠ 推送失败或无新更改
) else (
    echo ✓ 代码已推送
)
echo.

REM 打开 Cloudflare Pages
echo [3/3] 打开 Cloudflare Pages 设置页面...
echo.
echo ========================================
echo   请在浏览器中完成以下步骤:
echo ========================================
echo.
echo 1. 点击 "Create application" → "Pages"
echo 2. 点击 "Connect to Git" → 选择 "GitHub"
echo 3. 授权并选择你的仓库
echo 4. 配置构建设置:
echo.
echo    Production branch: main
echo.
echo    构建命令 (Build command):
echo    chmod +x build.sh ^&^& ./build.sh
echo.
echo    输出目录 (Build output directory):
echo    output
echo.
echo 5. 环境变量 (Environment variables):
echo    PYTHON_VERSION = 3.9
echo    DEBIAN_FRONTEND = noninteractive
echo.
echo 6. 点击 "Save and Deploy"
echo.
echo ========================================
echo.

start https://dash.cloudflare.com/

echo ✅ 浏览器已打开，请按照上述步骤配置
echo.
echo 配置完成后，每次推送代码都会自动部署！
echo.
pause
