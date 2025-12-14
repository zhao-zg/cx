@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo  Word文档静态网站生成器
echo ========================================
echo.

if not exist ".venv\Scripts\python.exe" (
    echo 错误: 虚拟环境不存在
    echo 请先安装：
    echo   python -m venv .venv
    echo   .venv\Scripts\pip install python-docx jinja2 pyyaml
    pause
    exit /b 1
)

echo 正在生成HTML文件...
echo.

.venv\Scripts\python.exe main.py

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo 生成成功！
    echo ========================================
    echo.
    echo HTML文件位于 output 目录中
    echo.
    
    set /p OPEN="是否在浏览器中打开首页？(Y/N): "
    if /i "%OPEN%"=="Y" (
        start "" "output\index.html"
    )
) else (
    echo.
    echo 生成失败，请检查错误信息。
)

echo.
pause
