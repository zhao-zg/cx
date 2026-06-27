该仓库未采用专用的日志框架（如 `logging`、`loguru` 或 `structlog`），而是使用 Python 和 Node.js 内置的 **标准输出流（stdout/stderr）** 作为唯一的日志记录方式。

### 1. 核心实现方式
*   **Python**: 直接使用全局 `print()` 函数输出日志。在 `main.py` 中，通过 `sys.stdout.reconfigure(encoding='utf-8')` 确保控制台编码正确，以支持中文日志输出。
*   **Node.js**: 在 `tools/build-batch-txt.js` 等脚本中，使用 `console.error()` 输出构建过程的诊断信息（stderr），使用 `process.stdout.write()` 输出结构化元数据（stdout）。

### 2. 日志结构与约定
*   **状态前缀**: 开发者在 `print` 语句中手动添加 Emoji 或符号前缀来区分日志级别：
    *   `✓` / `✔`: 成功/完成 (Info)
    *   `⚠`: 警告/非致命错误 (Warning)
    *   `✗`: 失败/致命错误 (Error)
    *   `ℹ`: 提示信息 (Info)
    *   `⏳`: 进行中/等待 (Debug/Trace)
*   **分隔线**: 使用 `"="*60` 等字符绘制分隔线，用于在控制台中划分不同的处理批次或阶段。
*   **进程间通信**: 在 Python 调用 Node.js 子进程时（`subprocess.run`），严格区分了日志流：
    *   **stderr**: 用于输出人类可读的构建日志（如 `[TXT] 使用文件: ...`）。
    *   **stdout**: 仅用于输出 JSON 格式的元数据，供父进程解析，严禁混入普通日志文本。

### 3. 关键文件
*   `main.py`: 主入口，包含大量的 `print` 语句用于跟踪文档解析、JSON 生成和资源打包流程。
*   `src/parser_improved.py`: Word 文档解析器，使用 `print(..., file=sys.stderr)` 输出转换状态。
*   `tools/build-batch-txt.js`: Node.js 构建脚本，演示了如何通过 `console.error` 和 `process.stdout` 分离日志与数据。
*   `down_resource.py`: Notion 资源下载器，使用 `print` 输出下载进度和 MD5 校验结果。

### 4. 开发规范
*   **禁止引入日志库**: 保持零依赖（除业务必需库外），不使用 `import logging`。
*   **编码处理**: 在涉及中文输出的地方，必须确保环境或流配置支持 UTF-8。
*   **子进程交互**: 若编写新的 Node.js 工具供 Python 调用，必须将诊断日志写入 `stderr`，将结果数据写入 `stdout`。