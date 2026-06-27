本项目采用 **Python 静态生成 + Capacitor 混合打包** 的构建模式，通过 GitHub Actions 实现全自动化的 CI/CD 流程。核心逻辑分为 Web 端静态站点生成与 Android APK 离线打包两条主线。

### 1. 核心构建工具链
- **Web 前端构建**: 使用 `python main.py` 作为主入口，解析 `resource/` 目录下的 Word/TXT 文档，结合 `src/generator.py` 和 Jinja2 模板生成静态 HTML、JSON 数据及 Service Worker 脚本。
- **Android 客户端构建**: 基于 **Capacitor v6**，通过 `npx cap sync android` 将生成的 `output/` 目录同步至原生工程，再调用 Gradle (`./gradlew assembleRelease`) 进行编译、签名与资源压缩。
- **依赖管理**: 
  - Python: `requirements.txt` (含 `python-docx`, `playwright`, `PyYAML` 等)。
  - Node.js: `package.json` (含 `@capacitor/core`, `javascript-obfuscator` 等)。
  - Java: JDK 17 (Temurin) + Android SDK (Gradle)。

### 2. 自动化流水线 (GitHub Actions)
项目配置了三套核心工作流：
- **`deploy.yml` (Web 部署)**: 监听 `main` 分支变动。在 Ubuntu 环境下安装 LibreOffice 以支持 `.doc` 解析，生成静态文件后自动部署至 **Cloudflare Pages** 和 **GitHub Pages**。同时会从 GitHub Release 下载最新 APK 并注入到 `version.json` 中供 PWA 检测更新。
- **`android-release-offline.yml` (APK 发布)**: 监听 Git Tag (`v*.*.*`)。执行完整的 Android 构建流程，包括：
  - **环境准备**: 安装 Python, Node.js, JDK 17, LibreOffice。
  - **代码混淆**: 使用 `javascript-obfuscator` 对关键 JS 文件（如 `app-update.js`）进行加密，保护远程服务器地址。
  - **资源裁剪**: 根据 `config.yaml` 中的 `max_latest_trainings` 策略，仅保留最新 N 个训练批次打入 APK，控制体积。
  - **签名与打包**: 使用内置的 Base64 编码密钥 (`offline-key.keystore.b64`) 进行 Release 签名，并开启 `minifyEnabled` 和 `shrinkResources`。
  - **发布**: 创建 GitHub Release 并上传 APK，随后触发 Web 端重新部署以同步版本信息。
- **`auto-download.yml` / `test-cloudflare.yml`**: 辅助性的资源下载与 Cloudflare 环境测试流程。

### 3. 本地开发与发布规范
- **本地构建**: 
  - Web: `npm run build` (即 `python main.py`)。
  - Android: `npm run android:dev` (同步并打开 Android Studio) 或 `npm run android:build` (命令行直接打包)。
- **版本发布**: 
  - 运行根目录下的 `release.bat` 脚本。该脚本会自动更新 `app_config.json` 中的版本号，记录 `changelog.json`，并推送 Git Tag 触发 CI。
  - 严禁在本地手动运行 `encrypt_app_update.py`，以免污染源码；加密仅在 CI 环境中执行。
- **资源处理约定**: 
  - 优先使用 `.docx` 格式以确保 Cloudflare Pages 无头构建兼容性（CF 环境无 LibreOffice）。
  - 历史合辑资源通过 `tools/build-trainings-json.js` 单独处理为 JSON 索引。

### 4. 关键配置文件
- `config.yaml`: 定义资源路径、输出目录、最大保留训练数等全局参数。
- `capacitor.config.json`: 配置 App ID、应用名称及 Web 资产目录 (`output`)。
- `build.sh`: 专为 Cloudflare Pages 设计的轻量级构建脚本，仅执行依赖安装与 Python 生成。
- `android/variables.gradle`: 统一管理 Android 编译 SDK 版本与依赖库版本。