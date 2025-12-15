# Cloudflare Pages 构建优化说明

## 📋 构建方案

### Cloudflare Pages 配置

```bash
Build command: chmod +x build.sh && ./build.sh
Build output directory: output
```

**说明**：
- Cloudflare Pages 只有一个构建命令字段
- `build.sh` 包含完整的构建流程（安装依赖 + 生成文件）
- Cloudflare 会自动缓存构建环境和依赖

**构建流程**：
1. 安装 Python 依赖（从 `requirements.txt`）
2. 运行 `python main.py` 生成静态文件

**重要限制**：
- ⚠️ Cloudflare Pages 没有 sudo 权限，无法安装 LibreOffice
- ✅ 请确保所有文档都是 `.docx` 格式（不要使用 `.doc`）
- ✅ 如有 `.doc` 文件，请在本地转换为 `.docx` 后推送

**缓存机制**：
- ✅ Cloudflare 自动缓存构建环境
- ✅ Python 依赖安装后会被保留
- ✅ 后续构建速度更快（如果依赖未变更）

## 🔧 配置说明

### 构建命令（Build command）

```bash
chmod +x build.sh && ./build.sh
```

**作用**：
1. 检查并安装 LibreOffice（如果未安装）
2. 安装 Python 依赖（从 `requirements.txt`）
3. 运行 `python main.py` 生成静态文件

**执行时机**：
- 每次推送代码到 GitHub

### 输出目录（Build output directory）

```
output
```

**说明**：
- 生成的静态文件所在目录
- Cloudflare 会部署这个目录的内容

## 📊 性能说明

### 首次部署

| 阶段 | 时间 | 说明 |
|------|------|------|
| 安装 Python 依赖 | 30-60 秒 | pip install |
| 生成静态文件 | 10-30 秒 | python main.py |
| **总计** | **40-90 秒** | 首次部署 |

### 后续部署（代码更新）

| 阶段 | 时间 | 说明 |
|------|------|------|
| 安装 Python 依赖 | 10-20 秒 | 使用缓存 |
| 生成静态文件 | 10-30 秒 | python main.py |
| **总计** | **20-50 秒** | 后续部署 |

**结论**：Cloudflare 自动缓存 Python 依赖，构建速度很快！

### 依赖更新（修改 requirements.txt）

| 阶段 | 时间 | 说明 |
|------|------|------|
| 检查 LibreOffice | <1 秒 | 已安装 |
| 重新安装依赖 | 30-60 秒 | 更新的包 |
| 生成静态文件 | 10-30 秒 | python main.py |
| **总计** | **40-90 秒** | 依赖更新 |

## 🎯 推荐配置

### Cloudflare Pages 配置

```
Production branch: main
Framework preset: None

Build command:
chmod +x build.sh && ./build.sh

Build output directory:
output

Environment variables:
PYTHON_VERSION = 3.9
DEBIAN_FRONTEND = noninteractive
```

**说明**：
- Cloudflare Pages 只有一个构建命令字段
- `build.sh` 包含完整的构建流程
- Cloudflare 会自动缓存构建环境和依赖

## 📁 文件说明

### build.sh（完整构建）

```bash
#!/bin/bash
set -e

echo "🚀 开始构建..."

# 注意：Cloudflare Pages 没有 sudo 权限，无法安装 LibreOffice
# 请确保所有文档都是 .docx 格式

# 1. 安装 Python 依赖
echo "📦 安装 Python 依赖..."
pip install -r requirements.txt

# 2. 生成静态文件
echo "🔨 生成静态文件..."
python main.py

echo "✅ 构建完成！"
```

**说明**：
- 包含完整的构建流程
- ⚠️ 不包含 LibreOffice 安装（Cloudflare Pages 没有权限）
- ✅ 请确保所有文档都是 `.docx` 格式
- 利用 Cloudflare 的缓存机制

## 🚀 一键设置

使用提供的脚本自动配置：

**Windows:**
```bash
setup-cloudflare.bat
```

**PowerShell:**
```powershell
.\setup-cloudflare.ps1
```

脚本会：
1. 推送代码到 GitHub
2. 打开 Cloudflare Pages 设置页面
3. 显示优化的配置说明

## ❓ 常见问题

### Q: Cloudflare Pages 如何缓存依赖？

**A:** 
- Cloudflare 会自动缓存构建环境
- 如果依赖未变更，会重用已安装的包
- LibreOffice 安装后会被保留
- 后续构建速度自动提升 3-5 倍

### Q: 缓存什么时候会失效？

**A:** 
- 修改 `requirements.txt`
- 修改 `install-deps.sh`
- Cloudflare 自动清理（通常 7-30 天）

### Q: 如何强制重新安装依赖？

**A:** 
1. 在 Cloudflare Pages 项目设置中
2. 清除构建缓存
3. 重新部署

## 📚 相关文档

- `一键部署说明.md` - 一键部署指南
- `QUICK_START.md` - 快速开始
- `DEPLOYMENT.md` - 详细部署文档
- `LibreOffice自动安装说明.md` - LibreOffice 安装说明
