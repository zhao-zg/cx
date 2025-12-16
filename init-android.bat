@echo off
chcp 65001 >nul
echo 初始化安卓项目...

REM 确保 android 目录存在
if not exist "android" (
    echo 添加安卓平台...
    call npx cap add android
)

echo ✓ 安卓项目初始化完成
pause
