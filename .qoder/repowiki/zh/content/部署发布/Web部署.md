# Web部署

<cite>
**本文引用的文件**
- [DEPLOYMENT.md](file://DEPLOYMENT.md)
- [build.sh](file://build.sh)
- [.cfignore](file://.cfignore)
- [package.json](file://package.json)
- [requirements.txt](file://requirements.txt)
- [config.yaml](file://config.yaml)
- [main.py](file://main.py)
- [down_resource.py](file://down_resource.py)
- [export_bible_sql_json.py](file://export_bible_sql_json.py)
- [generate_version.py](file://generate_version.py)
- [update_changelog.py](file://update_changelog.py)
- [encrypt_app_update.py](file://encrypt_app_update.py)
- [run.bat](file://run.bat)
- [run.ps1](file://run.ps1)
- [release.bat](file://release.bat)
- [worker-get/worker.js](file://worker-get/worker.js)
- [functions/_middleware.js](file://functions/_middleware.js)
</cite>

## 更新摘要
**所做更改**
- 新增Cloudflare Pages Functions访问时间控制功能章节
- 更新配置管理章节以包含access_time配置详解
- 增强部署流程说明以反映中间件自动生成机制
- 新增访问时间控制的配置选项和使用方法
- 更新故障排除指南以包含访问时间相关的常见问题
- 新增weekly scheduling restrictions功能的详细说明

## 目录
1. [简介](#简介)
2. [项目结构](#项目结构)
3. [核心组件](#核心组件)
4. [架构总览](#架构总览)
5. [详细组件分析](#详细组件分析)
6. [依赖关系分析](#依赖关系分析)
7. [性能考虑](#性能考虑)
8. [故障排除指南](#故障排除指南)
9. [结论](#结论)
10. [附录](#附录)

## 简介
本指南面向需要在Cloudflare Pages上部署CX项目Web前端的工程师与运维人员。内容涵盖从GitHub仓库连接到自动部署、构建命令与环境变量配置、静态资源生成与输出目录、自定义域名与回滚策略、预览部署、访问时间控制功能、常见问题排查以及部署后验证与监控建议。同时对项目中的build.sh脚本执行流程进行深入解析，帮助读者理解静态文件生成过程与输出目录的作用。

**更新** 新增Cloudflare Pages Functions访问时间控制功能，通过config.yaml中的access_time配置实现时间段和星期的访问控制，增强部署基础设施的安全性和访问控制能力。该功能支持weekly scheduling restrictions，提供灵活的访问时间管理。

## 项目结构
该项目采用多语言混合架构：前端静态资源由构建脚本生成；后端逻辑用于数据导出与资源准备；工具脚本负责版本管理、更新加密与发布流程。与Web部署直接相关的关键文件包括：
- 构建与部署：build.sh、DEPLOYMENT.md
- 静态资源与忽略规则：.cfignore、src/static、src/templates
- 依赖与运行：package.json（前端）、requirements.txt（Python）
- 配置：config.yaml、capacitor.config.json
- 工具脚本：generate_version.py、export_bible_sql_json.py、down_resource.py、update_changelog.py、encrypt_app_update.py
- 运行脚本：run.bat、run.ps1、release.bat
- 辅助服务：worker-get/worker.js
- **新增** 访问控制：functions/_middleware.js（自动生成）

```mermaid
graph TB
A["源代码与资源<br/>src/static, src/templates, resource/*"] --> B["构建脚本<br/>build.sh"]
B --> C["静态站点产物<br/>output 目录"]
C --> D["Cloudflare Pages<br/>自动部署"]
E["依赖声明<br/>package.json, requirements.txt"] --> B
F["配置文件<br/>config.yaml, capacitor.config.json"] --> B
G["工具脚本<br/>generate_version.py, export_bible_sql_json.py, down_resource.py"] --> B
H["辅助服务<br/>worker-get/worker.js"] -.-> D
I["访问控制中间件<br/>functions/_middleware.js"] -.-> D
J["访问时间配置<br/>access_time"] --> I
K["星期调度限制<br/>weekly scheduling"] --> I
```

**图表来源**
- [build.sh](file://build.sh)
- [DEPLOYMENT.md](file://DEPLOYMENT.md)
- [package.json](file://package.json)
- [requirements.txt](file://requirements.txt)
- [config.yaml](file://config.yaml)
- [functions/_middleware.js](file://functions/_middleware.js)

**章节来源**
- [DEPLOYMENT.md](file://DEPLOYMENT.md)
- [build.sh](file://build.sh)
- [.cfignore](file://.cfignore)

## 核心组件
- 构建脚本：负责拉取资源、生成JSON数据、编译模板、打包静态文件，最终输出至Cloudflare Pages可识别的静态目录。
- 依赖管理：前端依赖通过package.json管理，Python工具链通过requirements.txt管理。
- 配置中心：config.yaml集中管理应用配置，capacitor.config.json用于移动端/跨平台配置。
- 工具链：版本生成、圣经数据导出、资源下载、变更日志更新、更新加密与发布脚本。
- 运行与发布：run.bat/run.ps1用于本地开发运行，release.bat用于发布流程。
- **新增** 访问时间控制：通过functions/_middleware.js实现Cloudflare Pages Functions中间件，提供时间段和星期的访问控制。

**章节来源**
- [build.sh](file://build.sh)
- [package.json](file://package.json)
- [requirements.txt](file://requirements.txt)
- [config.yaml](file://config.yaml)
- [generate_version.py](file://generate_version.py)
- [export_bible_sql_json.py](file://export_bible_sql_json.py)
- [down_resource.py](file://down_resource.py)
- [update_changelog.py](file://update_changelog.py)
- [encrypt_app_update.py](file://encrypt_app_update.py)
- [run.bat](file://run.bat)
- [run.ps1](file://run.ps1)
- [release.bat](file://release.bat)
- [functions/_middleware.js](file://functions/_middleware.js)

## 架构总览
下图展示了从代码提交到Cloudflare Pages静态站点上线的端到端流程，包括资源准备、构建、输出与部署触发，以及新增的访问时间控制中间件。

```mermaid
sequenceDiagram
participant Dev as "开发者"
participant GH as "GitHub 仓库"
participant CF as "Cloudflare Pages"
participant Build as "构建脚本 build.sh"
participant MW as "访问控制中间件"
participant Out as "静态输出目录"
Dev->>GH : 推送代码/触发工作流
GH-->>CF : 触发自动部署(Webhook/分支保护)
CF->>Build : 执行构建命令
Build->>Build : 拉取资源/生成数据/编译模板
Build->>MW : 生成 functions/_middleware.js
MW->>MW : 根据 config.yaml access_time 配置生成
Build->>Out : 输出静态文件
CF-->>Dev : 提供预览/生产URL
CF->>MW : 请求到达时执行访问控制
MW-->>CF : 返回403或放行请求
```

**图表来源**
- [DEPLOYMENT.md](file://DEPLOYMENT.md)
- [build.sh](file://build.sh)
- [functions/_middleware.js](file://functions/_middleware.js)

## 详细组件分析

### Cloudflare Pages 自动部署配置
- 仓库连接
  - 在Cloudflare Pages中选择对应GitHub仓库，确保已授权访问。
  - 分支选择：通常为main或master，确保受保护分支策略开启以阻止直接推送。
  - 预览部署：启用"启用预览"以在Pull Request时自动生成预览链接。
- 构建命令
  - 使用项目提供的构建脚本作为统一入口，避免硬编码路径差异导致的失败。
  - 构建命令示例参考：[DEPLOYMENT.md](file://DEPLOYMENT.md) 中的"部署"部分。
- 环境变量
  - 若构建脚本或工具链需要访问外部资源（如API密钥、数据库连接），请在Cloudflare Pages设置中添加环境变量，并在脚本中安全读取。
  - 注意：不要在仓库中提交敏感信息，使用Cloudflare Pages的加密环境变量功能。
- 输出目录
  - 构建脚本应将静态文件输出到Cloudflare Pages可识别的目录（如output），并在Pages设置中正确配置。
  - 可通过.gitignore或.cfignore控制哪些文件不被上传到Pages。

**章节来源**
- [DEPLOYMENT.md](file://DEPLOYMENT.md)
- [.cfignore](file://.cfignore)

### 访问时间控制配置
**新增** Cloudflare Pages Functions访问时间控制功能通过config.yaml中的access_time配置实现，提供灵活的时间段和星期访问控制。

- 配置选项
  - enabled: true/false - 是否启用访问时间控制
  - allow_start: 6-23 - 允许访问的开始时间（整点）
  - allow_end: 6-23 - 允许访问的结束时间（不含该小时）
  - timezone_offset: -12到+14 - UTC偏移（北京时间=+8）
  - allow_days: [0-6]数组 - 允许访问的星期（0=周日，6=周六）
- 自动生成机制
  - 构建时根据config.yaml配置自动生成functions/_middleware.js
  - 支持动态星期检查和时间段检查
  - 关闭配置时自动删除中间件文件

**章节来源**
- [config.yaml](file://config.yaml)
- [functions/_middleware.js](file://functions/_middleware.js)

### build.sh 脚本执行流程与作用
build.sh是Web部署的核心自动化脚本，其职责包括：
- 资源准备：调用down_resource.py下载或同步所需资源。
- 数据生成：调用export_bible_sql_json.py生成JSON数据，供前端使用。
- 版本管理：调用generate_version.py生成版本号或版本元数据。
- 模板编译与静态打包：根据config.yaml配置，编译模板并生成静态文件。
- **新增** 访问时间控制：调用generate_pages_middleware函数生成Cloudflare Pages Functions中间件。
- 输出目录：将最终静态文件写入指定输出目录，供Cloudflare Pages托管。

```mermaid
flowchart TD
Start(["开始"]) --> Prep["准备资源<br/>down_resource.py"]
Prep --> Gen["生成数据<br/>export_bible_sql_json.py"]
Gen --> Ver["生成版本<br/>generate_version.py"]
Ver --> Compile["编译模板/打包静态文件"]
Compile --> MW["生成访问控制中间件<br/>generate_pages_middleware"]
MW --> Out["输出到静态目录"]
Out --> End(["结束"])
```

**图表来源**
- [build.sh](file://build.sh)
- [down_resource.py](file://down_resource.py)
- [export_bible_sql_json.py](file://export_bible_sql_json.py)
- [generate_version.py](file://generate_version.py)
- [main.py](file://main.py)

**章节来源**
- [build.sh](file://build.sh)
- [down_resource.py](file://down_resource.py)
- [export_bible_sql_json.py](file://export_bible_sql_json.py)
- [generate_version.py](file://generate_version.py)
- [main.py](file://main.py)

### 静态文件生成与输出目录
- 生成过程
  - 构建脚本按顺序执行资源下载、数据导出、版本生成与模板编译，最终形成完整的静态站点。
  - **新增** 访问时间控制中间件随静态文件一起生成和部署。
- 输出目录
  - 输出目录需与Cloudflare Pages的"构建产物目录"一致。若Pages未找到静态文件，请检查输出目录名称与路径是否正确。
  - 可通过.cfignore排除不必要的文件，减少上传体积与构建时间。

**章节来源**
- [build.sh](file://build.sh)
- [.cfignore](file://.cfignore)

### 自定义域名与回滚机制
- 自定义域名
  - 在Cloudflare Pages设置中绑定自定义域名，并在Cloudflare DNS中配置CNAME或记录指向Pages提供的域。
  - 启用HTTPS证书自动签发，确保全站HTTPS。
- 回滚机制
  - Cloudflare Pages支持基于提交历史的回滚操作。若新版本出现严重问题，可在Pages控制台选择之前的成功构建进行回滚。
  - 建议每次发布前保留最近一次成功的构建版本，便于快速回滚。

**章节来源**
- [DEPLOYMENT.md](file://DEPLOYMENT.md)

### 预览部署
- Pull Request预览
  - 启用预览后，每次PR都会生成独立的预览URL，便于在合并前进行联调与验收。
- 本地预览
  - 在本地运行构建脚本后，使用静态服务器预览输出目录，确保与Pages环境一致。

**章节来源**
- [DEPLOYMENT.md](file://DEPLOYMENT.md)

### 访问时间控制中间件详解
**新增** functions/_middleware.js是Cloudflare Pages Functions的访问控制中间件，由main.py根据config.yaml配置自动生成。

- 功能特性
  - 时间段控制：基于allow_start和allow_end配置限制访问时间
  - 星期控制：支持allow_days数组限制特定星期的访问
  - 时区支持：通过timezone_offset参数支持不同地区的本地时间
  - 自动删除：配置关闭时自动清理中间件文件
- 技术实现
  - 使用Cloudflare Pages Functions onRequest钩子
  - 动态计算本地时间（UTC + TZ_OFFSET）
  - 支持Retry-After头部用于客户端重试控制
  - 返回403状态码和X-Maintenance头部便于监控

**章节来源**
- [functions/_middleware.js](file://functions/_middleware.js)
- [main.py](file://main.py)

### Weekly Scheduling Restrictions 功能详解
**新增** weekly scheduling restrictions是访问时间控制系统的高级功能，允许用户精确控制每周特定日期的访问权限。

- 配置示例
  ```yaml
  access_time:
    enabled: true
    allow_start: 6
    allow_end: 23
    timezone_offset: 8
    allow_days: [1, 2, 3, 4, 5]  # 仅工作日可访问（周一到周五）
  ```
- 功能特点
  - 支持0-6的星期数组配置（0=周日，6=周六）
  - 当allow_days未配置或为空时，默认每天均可访问
  - 自动生成ALLOW_DAYS常量和星期检查逻辑
  - 提供详细的错误响应信息，包括允许访问的具体星期
- 错误响应机制
  - 时间段不在允许范围内：返回403状态码，包含Retry-After头部
  - 星期不在允许范围内：返回403状态码，包含X-Maintenance头部
  - 响应消息包含具体的访问限制说明和允许访问的星期列表

**章节来源**
- [config.yaml](file://config.yaml)
- [functions/_middleware.js](file://functions/_middleware.js)
- [main.py](file://main.py)

## 依赖关系分析
- 构建脚本依赖关系
  - build.sh依赖多个工具脚本与配置文件，形成一条清晰的执行链。
  - package.json与requirements.txt分别管理前端与后端依赖，确保构建环境一致性。
  - **新增** 访问时间控制中间件依赖config.yaml配置文件。
- 关键依赖链
  - 资源准备 → 数据导出 → 版本生成 → 模板编译 → 访问控制中间件 → 静态输出
  - 配置文件（config.yaml、capacitor.config.json）贯穿整个流程，影响输出结构与行为。

```mermaid
graph LR
Pkg["package.json"] --> BS["build.sh"]
Req["requirements.txt"] --> BS
CFG["config.yaml"] --> BS
CFG --> MW["访问控制中间件"]
CAP["capacitor.config.json"] --> BS
Down["down_resource.py"] --> BS
Exp["export_bible_sql_json.py"] --> BS
GenV["generate_version.py"] --> BS
MWGen["generate_pages_middleware"] --> MW
BS --> Out["静态输出目录"]
MW --> Out
```

**图表来源**
- [build.sh](file://build.sh)
- [package.json](file://package.json)
- [requirements.txt](file://requirements.txt)
- [config.yaml](file://config.yaml)
- [down_resource.py](file://down_resource.py)
- [export_bible_sql_json.py](file://export_bible_sql_json.py)
- [generate_version.py](file://generate_version.py)
- [main.py](file://main.py)

**章节来源**
- [build.sh](file://build.sh)
- [package.json](file://package.json)
- [requirements.txt](file://requirements.txt)
- [config.yaml](file://config.yaml)
- [main.py](file://main.py)

## 性能考虑
- 构建优化
  - 使用缓存策略减少重复下载与编译时间，例如缓存node_modules与Python虚拟环境。
  - 将大型资源外置到CDN或单独托管，降低Pages构建压力。
  - **新增** 访问控制中间件为纯JavaScript，执行开销极小，不影响页面加载性能。
- 静态资源优化
  - 启用压缩与Gzip/Brotli传输，合理拆分与懒加载资源。
  - 利用Cloudflare的缓存策略与边缘加速提升访问速度。
- 监控与告警
  - 通过Cloudflare Analytics与Pages日志监控构建成功率与访问异常。
  - 对关键页面设置健康检查，及时发现可用性问题。
  - **新增** 访问时间控制中间件返回的X-Maintenance头部可用于监控访问控制效果。

## 故障排除指南
- Python版本不匹配
  - 症状：构建过程中出现Python模块导入错误或语法不兼容。
  - 解决：在Cloudflare Pages的构建环境中固定Python版本，或在本地使用与项目一致的Python版本运行构建脚本。
- 依赖安装失败
  - 症状：pip install或npm install超时或报错。
  - 解决：检查网络连通性与代理设置；清理缓存并重试；必要时使用国内镜像源。
- 构建命令未生效
  - 症状：Pages未执行构建或找不到静态文件。
  - 解决：确认Pages设置中的"构建命令"与"构建产物目录"与项目实际一致；检查build.sh权限与shebang。
- 输出目录不正确
  - 症状：静态文件未被Pages识别。
  - 解决：核对build.sh输出目录名称与Pages配置一致；使用.cfignore排除无关文件。
- 预览失败
  - 症状：PR未生成预览URL或预览页面空白。
  - 解决：检查构建日志中的错误；确保模板编译与静态资源生成成功；确认自定义域名与DNS配置正确。
- **新增** 访问时间控制失效
  - 症状：访问控制中间件未生效或返回403错误。
  - 解决：检查config.yaml中access_time配置是否正确；确认functions/_middleware.js已生成；验证Cloudflare Pages Functions部署状态。
- **新增** 星期调度限制错误
  - 症状：allow_days配置无效或星期检查失败。
  - 解决：确认allow_days数组格式正确（0-6的整数数组）；检查星期名称映射是否符合预期；验证中间件代码中的ALLOW_DAYS常量生成。

**章节来源**
- [DEPLOYMENT.md](file://DEPLOYMENT.md)
- [build.sh](file://build.sh)
- [.cfignore](file://.cfignore)
- [config.yaml](file://config.yaml)
- [functions/_middleware.js](file://functions/_middleware.js)

## 结论
通过规范化的Cloudflare Pages自动部署配置与build.sh脚本的统一执行，CX项目的Web前端可以稳定、高效地交付到全球边缘网络。新增的Cloudflare Pages Functions访问时间控制功能进一步增强了部署基础设施的安全性和访问控制能力。该功能支持weekly scheduling restrictions，为用户提供灵活的时间管理选项。建议在团队内固化部署流程文档，明确环境变量与输出目录约定，并建立预览与回滚机制，以保障发布质量与应急响应能力。

## 附录

### 附录A：常用文件与用途速览
- 构建与部署
  - build.sh：统一构建入口，生成静态文件
  - DEPLOYMENT.md：部署说明与流程
- 依赖与运行
  - package.json：前端依赖
  - requirements.txt：Python依赖
- 配置
  - config.yaml：应用配置（包含access_time访问控制）
  - capacitor.config.json：跨平台配置
- 工具链
  - generate_version.py：版本生成
  - export_bible_sql_json.py：数据导出
  - down_resource.py：资源下载
  - update_changelog.py：变更日志更新
  - encrypt_app_update.py：更新加密
- 运行与发布
  - run.bat / run.ps1：本地运行
  - release.bat：发布脚本
- 辅助服务
  - worker-get/worker.js：辅助服务
- **新增** 访问控制
  - functions/_middleware.js：Cloudflare Pages Functions中间件

**章节来源**
- [build.sh](file://build.sh)
- [DEPLOYMENT.md](file://DEPLOYMENT.md)
- [package.json](file://package.json)
- [requirements.txt](file://requirements.txt)
- [config.yaml](file://config.yaml)
- [generate_version.py](file://generate_version.py)
- [export_bible_sql_json.py](file://export_bible_sql_json.py)
- [down_resource.py](file://down_resource.py)
- [update_changelog.py](file://update_changelog.py)
- [encrypt_app_update.py](file://encrypt_app_update.py)
- [run.bat](file://run.bat)
- [run.ps1](file://run.ps1)
- [release.bat](file://release.bat)
- [worker-get/worker.js](file://worker-get/worker.js)
- [functions/_middleware.js](file://functions/_middleware.js)