# .doc 格式处理说明

## 问题说明

本项目已移除 `win32com` 依赖，改用跨平台方案。但 `.doc` 格式（旧版 Word 二进制格式）需要特殊处理。

## 解决方案

### 方案 1: 手动转换（推荐）

在 Microsoft Word 中打开 `.doc` 文件，另存为 `.docx` 格式：

1. 打开 `resource/2025-夏季/听抄.doc`
2. 点击"文件" → "另存为"
3. 选择格式为 "Word 文档 (*.docx)"
4. 保存到相同目录
5. 对 `晨兴.doc` 重复相同操作

### 方案 2: 使用LibreOffice自动转换

#### Windows

1. 下载安装 LibreOffice: https://www.libreoffice.org/
2. 运行转换脚本:
```bash
python convert_doc_to_docx.py
```

#### Linux

```bash
# 安装LibreOffice
sudo apt-get install libreoffice

# 运行转换脚本
python convert_doc_to_docx.py
```

#### Mac

```bash
# 安装LibreOffice
brew install libreoffice

# 运行转换脚本
python convert_doc_to_docx.py
```

### 方案 3: 命令行手动转换

如果已安装 LibreOffice，可以直接使用命令行：

```bash
# Linux/Mac
soffice --headless --convert-to docx --outdir resource/2025-夏季 resource/2025-夏季/听抄.doc
soffice --headless --convert-to docx --outdir resource/2025-夏季 resource/2025-夏季/晨兴.doc

# Windows
"C:\Program Files\LibreOffice\program\soffice.exe" --headless --convert-to docx --outdir resource/2025-夏季 resource/2025-夏季/听抄.doc
"C:\Program Files\LibreOffice\program\soffice.exe" --headless --convert-to docx --outdir resource/2025-夏季 resource/2025-夏季/晨兴.doc
```

## 为什么不使用 win32com？

1. **跨平台兼容性**: win32com 只能在 Windows 上运行，且需要安装 Microsoft Word
2. **部署复杂**: 需要额外安装 `pywin32` 包，且依赖 Windows COM 组件
3. **稳定性问题**: COM 自动化在多文档处理时容易出现文件锁定、进程残留等问题
4. **Linux/Mac 支持**: 项目需要在 Linux 服务器上运行

## 技术实现

项目使用以下跨平台技术栈：

- **文档解析**: `python-docx` (纯Python，支持所有平台)
- **图片提取**: `zipfile` + `PIL/Pillow` (从 .docx zip 结构直接提取)
- **.doc 转换**: `LibreOffice` (开源，支持 Windows/Linux/Mac)

## 常见问题

**Q: 为什么 .docx 文件不需要转换？**  
A: `.docx` 是基于 XML 的开放格式，`python-docx` 可以直接解析，无需额外依赖。

**Q: 如果我只有 .doc 文件怎么办？**  
A: 推荐使用方案1（手动转换）或方案2（LibreOffice自动转换）。

**Q: 转换会丢失格式吗？**  
A: LibreOffice 转换通常能保持 99% 的格式兼容性。如果发现问题，建议使用 Microsoft Word 手动转换。
