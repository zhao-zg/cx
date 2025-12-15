@echo off
echo ========================================
echo 部署到 GitHub 和 Cloudflare Pages
echo ========================================
echo.

REM 生成输出文件
echo [1/4] 生成输出文件...
python main.py
if errorlevel 1 (
    echo 错误: 生成失败
    pause
    exit /b 1
)
echo.

REM 添加所有更改
echo [2/4] 添加文件到 Git...
git add .
echo.

REM 提交更改
echo [3/4] 提交更改...
set /p commit_msg="请输入提交信息: "
if "%commit_msg%"=="" set commit_msg=更新内容
git commit -m "%commit_msg%"
echo.

REM 推送到 GitHub
echo [4/4] 推送到 GitHub...
git push origin main
if errorlevel 1 (
    echo 错误: 推送失败，请检查网络连接和权限
    pause
    exit /b 1
)
echo.

echo ========================================
echo 部署完成！
echo GitHub Actions 将自动构建并部署到 Cloudflare Pages
echo 请访问 GitHub Actions 查看部署进度
echo ========================================
pause
