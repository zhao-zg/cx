#!/bin/bash

echo "========================================"
echo "安卓APP构建脚本"
echo "========================================"
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "[错误] 未找到 Node.js，请先安装 Node.js"
    echo "下载地址: https://nodejs.org/"
    exit 1
fi

# 检查是否已安装依赖
if [ ! -d "node_modules" ]; then
    echo "[1/5] 安装 Node.js 依赖..."
    npm install
    if [ $? -ne 0 ]; then
        echo "[错误] 依赖安装失败"
        exit 1
    fi
else
    echo "[1/5] Node.js 依赖已安装"
fi

# 检查是否已添加安卓平台
if [ ! -d "android" ]; then
    echo "[2/5] 添加安卓平台..."
    npx cap add android
    if [ $? -ne 0 ]; then
        echo "[错误] 添加安卓平台失败"
        exit 1
    fi
else
    echo "[2/5] 安卓平台已存在"
fi

# 生成静态网站
echo "[3/5] 生成静态网站内容..."
python main.py
if [ $? -ne 0 ]; then
    echo "[错误] 网站生成失败"
    exit 1
fi

# 同步到安卓项目
echo "[4/5] 同步到安卓项目..."
npx cap sync
if [ $? -ne 0 ]; then
    echo "[错误] 同步失败"
    exit 1
fi

# 打开 Android Studio
echo "[5/5] 打开 Android Studio..."
echo ""
echo "========================================"
echo "构建准备完成！"
echo "========================================"
echo ""
echo "接下来在 Android Studio 中："
echo "1. 等待 Gradle 同步完成"
echo "2. 连接安卓设备或启动模拟器"
echo "3. 点击 Run 按钮运行应用"
echo "4. 或选择 Build > Build Bundle(s) / APK(s) > Build APK(s)"
echo ""
npx cap open android
