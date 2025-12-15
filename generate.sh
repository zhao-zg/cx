#!/bin/bash
# Cloudflare Pages 生成脚本（部署命令）

set -e

echo "🔨 生成静态文件..."
python main.py

echo "✅ 生成完成"
