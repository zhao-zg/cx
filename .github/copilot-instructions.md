# Copilot Instructions

## 代码修改规范

- **禁止使用 PowerShell 命令修改代码文件**（包括 `Set-Content`、`Out-File`、`Add-Content`、重定向 `>`、`>>`、`$lines[...] | Set-Content` 等方式）。
  PowerShell 的文本 cmdlet 默认使用系统代码页（如 GBK）读取文件，再以 UTF-8 BOM 写回，会导致中文字符乱码，且可能破坏字符串字面量（如丢失引号）。
- 需要生成或覆写文件内容时，一律使用：
  1. `create_file` / `replace_string_in_file` 工具直接操作，或
  2. Node.js 脚本，以 `fs.writeFileSync(path, content, 'utf8')` 写入（无 BOM）。
