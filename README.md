# Word文档静态网站生成器

## 项目概述

这是一个从Word文档自动生成静态HTML网站的工具，专门用于处理宗教训练课程内容。

## 功能特性

- ✅ 从Word文档(.docx)提取结构化内容
- ✅ **自动检测文档格式** (支持混合使用)
- ✅ **批量处理多个批次** (自动扫描子文件夹)
- ✅ **跨平台支持** (Windows/Linux/Mac，无需 win32com)
- ✅ 支持多层级大纲结构（篇、大点、中点、小点、小a点）
- ✅ 生成多种页面类型：
  - 首页（目录页）
  - 大纲页（概要）
  - 纲目页（详细内容）
  - 晨兴页（每周晨兴内容,支持分页）
  - 听抄页（职事信息）
  - 职事信息摘录页
  - 诗歌页（自动提取图片）
- ✅ **移动端优先响应式设计**
- ✅ 触摸友好的交互（44px 最小触摸目标）
- ✅ 可折叠的内容区域
- ✅ 统一的导航和样式

## ⚠️ 重要：.doc 格式处理

**本项目已移除 win32com 依赖，使用纯跨平台方案**

如果你的文档是 `.doc` 格式（旧版Word二进制格式），需要先转换为 `.docx`：

### 快速转换方法

1. **手动转换（推荐）**: 在 Word 中打开，另存为 `.docx`
2. **自动转换**: 使用提供的转换脚本（需要安装 LibreOffice）
   ```bash
   python convert_doc_to_docx.py
   ```

详细说明请查看 [DOC格式说明.md](DOC格式说明.md)

## 依赖要求

- Python 3.8+
- python-docx (文档解析)
- Pillow (图片处理)
- jinja2 (模板引擎)
- PyYAML (配置文件)
- **可选**: LibreOffice (用于 .doc 转换)

## 项目结构

```
cx/
├── resource/              # Word源文档(批量处理)
│   ├── 2025-秋季/        # 批次文件夹
│   │   ├── 听抄.docx
│   │   ├── 经文.docx
│   │   └── 晨兴.doc
│   └── 2025-夏季/        # 另一批次
│       ├── 听抄.doc
│       ├── 经文.docx
│       └── 晨兴.doc
├── src/                   # Python源代码
│   ├── models.py         # 数据模型
│   ├── parser_improved.py # Word文档解析器 (支持双格式)
│   ├── generator.py      # HTML生成器
│   └── templates/        # Jinja2模板 (移动端优先)
│       ├── base.html     # 基础模板
│       ├── index.html    # 首页模板
│       ├── outline.html  # 纲目页模板
│       ├── morning_revival.html  # 晨兴页模板
│       └── ...           # 其他模板
├── output/               # 生成的HTML文件(按批次组织)
│   ├── 2025-秋季/
│   │   ├── index.html
│   │   └── ...
│   └── 2025-夏季/
│       ├── index.html
│       └── ...
├── config.yaml          # 配置文件
├── main.py              # 主程序入口(批量版)
├── 使用指南.md           # 详细使用指南
├── 文档格式支持说明.md   # 文档格式说明
├── 批量生成说明.md       # 批量处理说明
└── README.md            # 本文件
```

## 安装依赖

```bash
cd G:/project/go/cx
python -m venv .venv
### 1. 配置

编辑 `config.yaml`，设置训练信息和文档路径：

```yaml
title: "二〇二五年秋季国际长老及负责弟兄训练"
subtitle: "马太福音五至七章极重要的方面"
year: 2025
season: "秋季"

# 批量处理配置
resource_dir: "resource"  # 包含批次子文件夹的目录
output_dir: "output"      # 输出根目录
```

### 2. 准备文档

按批次组织文档:

```
resource/
├── 2025-秋季/
│   ├── 听抄.docx
│   ├── 经文.docx
│   └── 晨兴.doc
└── 2025-夏季/
    ├── 听抄.doc
    ├── 经文.docx
    └── 晨兴.doc
```

**文档格式支持**:
- ✅ 支持 `.doc` 和 `.docx` 混合使用
- ✅ 自动检测文档格式
- ✅ 每个批次独立配置
- 详见 `批量生成说明.md`

# 文档路径 (支持 .doc 和 .docx 两种格式,会自动检测)
listen_doc: "resource/听抄.docx"
scripture_doc: "resource/经文.docx"
morning_revival_doc: "resource/晨兴.doc"
```

**文档格式支持**:
- ✅ 支持 `.doc` 和 `.docx` 混合使用
- ✅ 自动检测文档格式
- ✅ 可省略扩展名让程序自动查找
- 详见 `文档格式支持说明.md`

### 2. 运行

```bash
python main.py
```

### 3. 查看结果

生成的HTML文件在 `output/` 目录中。

## 数据模型

### Chapter（篇章）
- id: 篇章编号（1-9）
- title: 篇章标题
- sections: 大点列表
- content: 听抄内容

### Section（大点）
- level: 层级（壹贰叁...）
- title: 标题
- subsections: 中点列表
- content: 正文内容

### SubSection（中点/小点）
- level: 层级（一二三... / 1 2 3...）
- title: 标题
- points: 子项列表
- content: 正文内容

## Word文档样式映射

| Word样式 | 含义 | HTML标签 |
|---------|------|----------|
| 121文章篇题 | 篇章标题 | `<h1>` |
| 131文章大点 | 大点（壹贰叁） | `<h2>` |
| 132文章中点 | 中点（一二三） | `<h3>` |
| 133文章小点 | 小点（1 2 3） | `<h4>` |
| 134文章小a点 | 小a点（a b c） | `<h5>` |
| 8888文章正文 | 正文内容 | `<p>` |

## 页面类型说明

### 1. 首页 (index.html)
- 显示所有篇章列表
- 每篇提供多个链接：大纲、纲目、听抄、晨兴等

### 2. 大纲页 (1_dg.htm)
- 只显示大纲结构
- 可展开查看详细内容

### 3. 纲目页 (1_cv.htm)
- 显示完整的大纲和内容
- 包含经文引用
- 可折叠的内容区域

### 4. 晨兴页 (1_h_1.htm ~ 1_h_6.htm)
- 按周划分（周一到周六）
- 每日的晨兴内容

### 5. 经文页
- 显示相关经文内容

## 开发计划

- [x] 项目架构设计
- [ ] Word文档解析器
- [ ] 数据模型实现
- [ ] HTML模板设计
- [ ] 样式和交互
- [ ] 主程序整合
- [ ] 测试和优化

## 技术栈

- **Python 3.12+**
- **python-docx**: Word文档解析
- **Jinja2**: HTML模板引擎
- **PyYAML**: 配置文件解析

## 🚀 一键部署到 Cloudflare Pages

本项目支持一键自动部署到 Cloudflare Pages（免费、全球 CDN、自动 HTTPS）。

### 快速开始

**首次设置（3 步）：**
1. 推送代码到 GitHub
2. 在 Cloudflare 连接 GitHub 仓库
3. 配置构建命令：`python main.py`

详细步骤查看 [QUICK_START.md](QUICK_START.md)

**日常使用（一键部署）：**
```bash
# Windows
deploy.bat

# PowerShell
.\deploy.ps1
```

### 自动化流程

每次推送到 GitHub 后，Cloudflare Pages 会自动：
1. 检测到代码更新
2. 运行 `python main.py` 生成静态文件
3. 部署 `output` 文件夹到全球 CDN
4. 网站自动更新（2-5 分钟）

**无需配置 GitHub Actions，Cloudflare 直接连接 GitHub！**

## 许可证

本项目仅供内部使用。
