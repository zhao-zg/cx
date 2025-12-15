#!/bin/bash
# Cloudflare Pages 构建脚本

set -e  # 遇到错误立即退出

echo "🚀 开始构建..."

# 1. 安装 LibreOffice（如果需要处理 .doc 文件）
echo "📦 检查并安装 LibreOffice..."
# 在 Cloudflare Pages 的 Linux 环境中，使用 apt 安装
if ! command -v soffice &> /dev/null; then
    echo "LibreOffice 未安装，正在安装..."
    apt-get update -qq
    apt-get install -y -qq libreoffice-writer libreoffice-core --no-install-recommends
    echo "✓ LibreOffice 安装完成"
else
    echo "✓ LibreOffice 已安装"
fi

# 2. 安装 Python 依赖
echo "📦 安装 Python 依赖..."
pip install -r requirements.txt

# 3. 生成静态文件
echo "🔨 生成静态文件..."
python main.py

echo "✅ 构建完成！"
