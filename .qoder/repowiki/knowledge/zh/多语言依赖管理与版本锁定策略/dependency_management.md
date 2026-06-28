该项目采用混合技术栈（Python + Node.js/Capacitor + Android），其依赖管理呈现出分层、多工具协同的特征，主要通过 `requirements.txt`、`package.json`/`package-lock.json` 以及 Gradle 构建系统来维护。

### 1. Python 后端依赖管理
- **声明方式**：使用标准的 `requirements.txt` 文件声明运行时依赖。
- **核心库**：包括 `python-docx`（文档解析）、`PyYAML`（配置处理）、`Jinja2`（模板渲染）、`Pillow`（图像处理）以及 `playwright`（自动化测试/渲染）。
- **版本控制**：采用最小版本约束（如 `>=0.8.11`），未提供 `requirements.lock` 或 `pip-tools` 生成的严格锁定文件，这意味着在持续集成环境中可能存在轻微的非确定性构建风险，但通过指定最小版本保证了基本兼容性。
- **环境隔离**：项目根目录包含 `.venv`，表明开发过程中使用虚拟环境隔离 Python 依赖。

### 2. Node.js 前端与 Capacitor 依赖管理
- **包管理器**：使用 npm，通过 `package.json` 声明依赖，并生成 `package-lock.json` (lockfileVersion 3) 进行严格的版本锁定。
- **核心框架**：基于 `@capacitor/core` (^6.0.0) 构建跨平台应用，依赖多个官方插件（如 `@capacitor/app`, `@capacitor/filesystem`）以及社区插件 `@capacitor-community/text-to-speech`。
- **开发工具**：引入 `javascript-obfuscator` 用于代码混淆，增强发布版本的安全性。
- **同步机制**：通过 `npx cap sync` 命令将 Web 资源与原生依赖同步，这是 Capacitor 工作流中连接 JS 依赖与原生依赖的关键环节。

### 3. Android 原生依赖管理
- **构建系统**：使用 Gradle。原生依赖并非直接在 `build.gradle` 中硬编码所有版本，而是通过 Capacitor 的同步机制动态生成 `android/app/capacitor.build.gradle`。
- **依赖注入**：`capacitor.build.gradle` 中明确引用了同步后的插件模块（如 `implementation project(':capacitor-app')`）。
- **仓库配置**：在 `android/capacitor-cordova-android-plugins/build.gradle` 中配置了 `google()` 和 `mavenCentral()` 作为主要远程仓库，确保能获取 AndroidX 及 Cordova 兼容库。
- **版本协调**：Android 编译 SDK 版本（compileSdk 34）和 Java 版本（VERSION_17）在项目级 Gradle 配置中统一管理，确保与 Capacitor 6.x 的要求一致。

### 4. 开发者规范与建议
- **同步顺序**：修改 `package.json` 中的 Capacitor 插件后，必须运行 `npm run cap:sync` 以更新 Android 项目的 `capacitor.build.gradle` 和原生依赖。
- **Python 环境**：新成员初始化项目时，应首先创建虚拟环境并执行 `pip install -r requirements.txt`。
- **版本升级**：升级 Capacitor 核心库时，需同时检查 `@capacitor/android` 等原生平台的对等依赖（peerDependencies）版本要求，避免同步冲突。