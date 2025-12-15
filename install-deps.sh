#!/bin/bash
# Cloudflare Pages 依赖安装脚本（构建命令）

set -e

echo "📦 安装依赖..."

# 1. 安装 LibreOffice
if ! command -v soffice &> /dev/null; then
    echo "正在安装 LibreOffice..."
    apt-get update -qq
    apt-get install -y -qq libreoffice-writer libreoffice-core --no-install-recommends
    echo "✓ LibreOffice 已安装"
else
    echo "✓ LibreOffice 已存在"
fi

# 2. 安装 Python 依赖
echo "正在安装 Python 依赖..."
pip install -r requirements.txt

echo "✅ 依赖安装完成"
