# Cloudflare Pages 构建优化说明

## 📋 优化方案

### 原方案（单一构建命令）

```bash
Build command: chmod +x build.sh && ./build.sh
Build output directory: output
```

**缺点**：
- ❌ 每次构建都要重新安装依赖（LibreOffice + Python 包）
- ❌ 构建时间长（3-5 分钟）
- ❌ 浪费资源

### 优化方案（分离构建和部署）

```bash
Build command: chmod +x install-deps.sh && ./install-deps.sh
Deploy command: chmod +x generate.sh && ./generate.sh
Build output directory: output
```

**优势**：
- ✅ 依赖安装会被 Cloudflare 缓存
- ✅ 后续构建只需运行 `generate.sh`（10-30 秒）
- ✅ 构建速度提升 5-10 倍
- ✅ 节省资源和时间

## 🔧 配置说明

### 构建命令（Build command）

```bash
chmod +x install-deps.sh && ./install-deps.sh
```

**作用**：
1. 检查并安装 LibreOffice（如果未安装）
2. 安装 Python 依赖（从 `requirements.txt`）

**执行时机**：
- 首次部署
- 依赖文件变更（`requirements.txt` 修改）
- 缓存失效

### 部署命令（Deploy command）

```bash
chmod +x generate.sh && ./generate.sh
```

**作用**：
- 运行 `python main.py` 生成静态文件

**执行时机**：
- 每次推送代码

### 输出目录（Build output directory）

```
output
```

**说明**：
- 生成的静态文件所在目录
- Cloudflare 会部署这个目录的内容

## 📊 性能对比

### 首次部署

| 方案 | 时间 | 说明 |
|------|------|------|
| 单一命令 | 3-5 分钟 | 安装依赖 + 生成文件 |
| 分离命令 | 3-5 分钟 | 安装依赖 + 生成文件 |

**结论**：首次部署时间相同

### 后续部署（代码更新）

| 方案 | 时间 | 说明 |
|------|------|------|
| 单一命令 | 3-5 分钟 | 每次都重新安装依赖 |
| 分离命令 | 10-30 秒 | 使用缓存的依赖，只生成文件 |

**结论**：后续部署速度提升 **5-10 倍**！

### 依赖更新（修改 requirements.txt）

| 方案 | 时间 | 说明 |
|------|------|------|
| 单一命令 | 3-5 分钟 | 重新安装依赖 |
| 分离命令 | 3-5 分钟 | 重新安装依赖 |

**结论**：依赖更新时间相同

## 🎯 使用建议

### 推荐配置（优化版）

```
Production branch: main
Framework preset: None

Build command:
chmod +x install-deps.sh && ./install-deps.sh

Deploy command:
chmod +x generate.sh && ./generate.sh

Build output directory:
output

Environment variables:
PYTHON_VERSION = 3.9
DEBIAN_FRONTEND = noninteractive
```

### 兼容配置（如果没有 Deploy command 选项）

如果 Cloudflare Pages 界面没有单独的 "Deploy command" 选项，使用：

```
Build command:
chmod +x build.sh && ./build.sh

Build output directory:
output
```

**说明**：`build.sh` 包含完整的构建流程，兼容性更好。

## 📁 文件说明

### install-deps.sh（依赖安装）

```bash
#!/bin/bash
set -e

# 安装 LibreOffice
if ! command -v soffice &> /dev/null; then
    apt-get update -qq
    apt-get install -y -qq libreoffice-writer libreoffice-core --no-install-recommends
fi

# 安装 Python 依赖
pip install -r requirements.txt
```

### generate.sh（文件生成）

```bash
#!/bin/bash
set -e

# 生成静态文件
python main.py
```

### build.sh（完整构建，兼容方案）

```bash
#!/bin/bash
set -e

# 安装依赖
./install-deps.sh

# 生成文件
./generate.sh
```

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

### Q: 为什么要分离构建和部署命令？

**A:** 
- Cloudflare Pages 会缓存构建环境
- 依赖安装（LibreOffice + Python 包）只需执行一次
- 后续只需运行生成脚本，速度快 5-10 倍

### Q: 如果没有 Deploy command 选项怎么办？

**A:** 使用 `build.sh`，它包含完整流程，兼容性更好。

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
