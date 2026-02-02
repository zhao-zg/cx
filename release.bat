@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ============================================================
echo  发布新版本
echo ============================================================
echo.

REM 读取当前版本号
for /f "tokens=2 delims=:, " %%a in ('findstr /C:"\"version\"" app_config.json') do (
    set CURRENT_VERSION=%%a
    set CURRENT_VERSION=!CURRENT_VERSION:"=!
)

echo 当前版本: v!CURRENT_VERSION!
echo.

REM 输入新版本号
set /p NEW_VERSION="请输入新版本号 (直接回车使用当前版本): "
if "!NEW_VERSION!"=="" (
    set NEW_VERSION=!CURRENT_VERSION!
    echo 使用当前版本: v!NEW_VERSION!
) else (
    echo 新版本: v!NEW_VERSION!
    
    REM 更新 app_config.json
    python -c "import json; f=open('app_config.json','r',encoding='utf-8'); d=json.load(f); f.close(); d['version']='!NEW_VERSION!'; f=open('app_config.json','w',encoding='utf-8'); json.dump(d,f,ensure_ascii=False,indent=2); f.close()"
    echo ✓ app_config.json 已更新
)

echo.

REM 确认是否继续
set /p CONFIRM="确认发布 v!NEW_VERSION! 吗？(y/n): "
if /i not "!CONFIRM!"=="y" (
    echo 已取消
    exit /b 0
)

echo.
echo === 创建并推送 tag ===

REM 如果版本号有变化，先提交 app_config.json
if not "!NEW_VERSION!"=="!CURRENT_VERSION!" (
    echo 提交版本更新...
    git add app_config.json
    git commit -m "更新版本号到 v!NEW_VERSION!"
    git push
    echo ✓ 版本更新已提交
    echo.
)

REM 创建 tag
git tag -a v!NEW_VERSION! -m "Release v!NEW_VERSION!"
if errorlevel 1 (
    echo ✗ 创建 tag 失败
    exit /b 1
)
echo ✓ Tag v!NEW_VERSION! 已创建

REM 推送 tag
git push origin v!NEW_VERSION!
if errorlevel 1 (
    echo ✗ 推送 tag 失败
    exit /b 1
)
echo ✓ Tag v!NEW_VERSION! 已推送到 GitHub

echo.
echo ============================================================
echo ✓ 发布完成！
echo ============================================================
echo.
echo GitHub Actions 将自动：
echo   1. 构建离线版 APK
echo   2. 创建 GitHub Release
echo   3. 上传 APK 到 Release
echo.
echo 查看构建进度：
echo https://github.com/zhao-zg/cx/actions
echo.

pause
