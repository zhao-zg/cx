该项目采用**分层混合配置架构**，通过 YAML、JSON 和 JavaScript 对象共同管理构建期与运行期的配置。系统核心围绕 `config.yaml`（Python 生成器）和 `window.CX_SERVERS`（前端运行时）展开，实现了从静态内容生成到离线客户端动态更新的闭环。

### 1. 配置体系架构
*   **构建期配置 (Build-time)**：由 `main.py` 读取 `config.yaml`，控制 Python 解析器如何处理 Word/TXT 文档、生成目录结构以及输出路径。同时读取 `app_config.json` 获取应用元数据（如版本号）。
*   **运行时配置 (Runtime)**：前端通过 `remote-config.js` 注入全局变量 `window.CX_SERVERS`。该文件在构建时由 Python 脚本根据 `config.yaml` 中的 `remote_servers` 字段自动生成，并对 URL 进行 Base64 混淆以增强安全性。
*   **原生桥接配置 (Native Bridge)**：`capacitor.config.json` 定义了 Android 应用的 ID、名称及 Web 视图行为（如允许混合内容），是 PWA 转为 APK 的关键桥梁。

### 2. 关键配置文件
*   **`config.yaml`**：核心构建配置。定义了资源目录 (`resource_base_dir`)、输出目录 (`output_dir`)、批量处理策略 (`batch_processing`) 以及远程服务器列表（Cloudflare 镜像、GitHub API、推送服务）。
*   **`app_config.json`**：存储应用基础信息，包括 `app_name`、`app_id` 和 `version`。前端在检查更新时会优先读取此文件。
*   **`capacitor.config.json`**：Capacitor 框架配置，指定 `webDir: "output"`，将生成的静态站点包装为原生应用。
*   **`src/static/js/remote-config.js`**：由 `main.py` 动态生成。包含混淆后的服务器地址数组，供前端 `app-update.js` 和 `resource-pack.js` 进行并发测速和资源拉取。

### 3. 配置加载与生效逻辑
1.  **生成阶段**：`main.py` 启动时加载 `config.yaml`，调用 `generate_remote_config_js` 将明文 URL 转换为 Base64 编码的 JS 对象，写入 `output/js/remote-config.js`。
2.  **初始化阶段**：前端 `index.html` 加载后，`app-update.js` 初始化 `AppUpdate` 模块，从 `localStorage` 或 `app_config.json` 获取当前版本。
3.  **动态决策**：在执行更新检查或资源包下载时，前端使用 `CX.raceFastest` 工具对 `window.CX_SERVERS` 中的多个镜像源进行并发竞速，自动选择响应最快的节点。

### 4. 开发者规范
*   **URL 管理**：所有外部服务地址必须统一在 `config.yaml` 的 `remote_servers` 中维护，禁止在前端代码中硬编码 URL。
*   **版本同步**：发布新版本时，需同步更新 `app_config.json` 中的 `version` 字段，并确保 GitHub Release 标签与之匹配。
*   **敏感信息**：虽然 `remote-config.js` 进行了 Base64 混淆，但不应在其中存储真正的密钥（Secrets）。推送服务的 Token 目前直接写在配置中，生产环境建议通过环境变量注入。
*   **批量策略**：通过 `batch_processing.max_latest_trainings` 控制默认打包的训练数量，避免生成的 APK 体积过大。