# Android应用配置

<cite>
**本文引用的文件**
- [AndroidManifest.xml](file://android/app/src/main/AndroidManifest.xml)
- [capacitor.config.json](file://capacitor.config.json)
- [capacitor.build.gradle](file://android/app/capacitor.build.gradle)
- [build.gradle](file://android/app/build.gradle)
- [proguard-rules.pro](file://android/app/proguard-rules.pro)
- [NativeTTSPlugin.java](file://android/app/src/main/java/com/tehui/offline/NativeTTSPlugin.java)
- [Bridge.java](file://node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/Bridge.java)
- [CapConfig.java](file://node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/CapConfig.java)
- [CUSTOM_PLUGIN_SETUP.md](file://CUSTOM_PLUGIN_SETUP.md)
- [INSTALL_PLUGINS.md](file://INSTALL_PLUGINS.md)
- [app_config.json](file://app_config.json)
- [generate_version.py](file://generate_version.py)
- [package.json](file://package.json)
</cite>

## 更新摘要
**所做更改**
- 更新了版本号配置部分，反映从1.4.17到1.4.18的版本升级
- 新增了版本管理流程说明，包括app_config.json和generate_version.py的协作
- 补充了版本号在不同配置文件中的作用和一致性要求

## 目录
1. [简介](#简介)
2. [项目结构](#项目结构)
3. [核心组件](#核心组件)
4. [架构概览](#架构概览)
5. [详细组件分析](#详细组件分析)
6. [版本管理与更新流程](#版本管理与更新流程)
7. [依赖关系分析](#依赖关系分析)
8. [性能考虑](#性能考虑)
9. [故障排除指南](#故障排除指南)
10. [结论](#结论)
11. [附录](#附录)

## 简介
本文件为Android应用配置的详细技术文档，重点涵盖以下方面：
- AndroidManifest.xml的配置项：应用权限声明、组件注册、Intent过滤器等
- Capacitor配置文件设置：应用ID、名称、版本号、WebView配置等
- Android图标资源的组织结构和命名规范
- 应用权限系统：网络访问、存储权限、外部存储等
- 应用签名配置和发布准备指导
- ProGuard混淆配置与性能优化建议
- 版本管理系统：多文件版本号同步与一致性保证

本指南旨在帮助开发者快速理解并正确配置Android应用，确保功能完整性和安全性，特别是在版本管理方面提供完整的指导。

## 项目结构
Android应用采用标准的Android Gradle项目结构，并通过Capacitor框架进行跨平台开发。关键配置文件分布如下：
- 应用清单与构建：AndroidManifest.xml、build.gradle、capacitor.build.gradle
- Capacitor配置：capacitor.config.json
- 版本管理：app_config.json、generate_version.py
- 混淆规则：proguard-rules.pro
- 插件与权限：NativeTTSPlugin.java及相关文档

```mermaid
graph TB
subgraph "Android应用层"
AMF["AndroidManifest.xml"]
BG["build.gradle"]
CBG["capacitor.build.gradle"]
PR["proguard-rules.pro"]
end
subgraph "配置管理层"
CFG["capacitor.config.json"]
ACFG["app_config.json"]
GV["generate_version.py"]
PKG["package.json"]
end
subgraph "插件与权限层"
NTP["NativeTTSPlugin.java"]
DOC1["CUSTOM_PLUGIN_SETUP.md"]
DOC2["INSTALL_PLUGINS.md"]
end
CFG --> AMF
CFG --> CBG
ACFG --> GV
GV --> AMF
PKG --> GV
AMF --> BG
CBG --> BG
PR --> BG
NTP --> AMF
DOC1 --> AMF
DOC2 --> AMF
```

**图表来源**
- [AndroidManifest.xml](file://android/app/src/main/AndroidManifest.xml)
- [build.gradle](file://android/app/build.gradle)
- [capacitor.build.gradle](file://android/app/capacitor.build.gradle)
- [capacitor.config.json](file://capacitor.config.json)
- [app_config.json](file://app_config.json)
- [generate_version.py](file://generate_version.py)
- [package.json](file://package.json)
- [proguard-rules.pro](file://android/app/proguard-rules.pro)
- [NativeTTSPlugin.java](file://android/app/src/main/java/com/tehui/offline/NativeTTSPlugin.java)
- [CUSTOM_PLUGIN_SETUP.md](file://CUSTOM_PLUGIN_SETUP.md)
- [INSTALL_PLUGINS.md](file://INSTALL_PLUGINS.md)

**章节来源**
- [AndroidManifest.xml](file://android/app/src/main/AndroidManifest.xml)
- [capacitor.config.json](file://capacitor.config.json)
- [app_config.json](file://app_config.json)
- [generate_version.py](file://generate_version.py)
- [package.json](file://package.json)
- [capacitor.build.gradle](file://android/app/capacitor.build.gradle)
- [build.gradle](file://android/app/build.gradle)
- [proguard-rules.pro](file://android/app/proguard-rules.pro)
- [NativeTTSPlugin.java](file://android/app/src/main/java/com/tehui/offline/NativeTTSPlugin.java)
- [CUSTOM_PLUGIN_SETUP.md](file://CUSTOM_PLUGIN_SETUP.md)
- [INSTALL_PLUGINS.md](file://INSTALL_PLUGINS.md)

## 核心组件
本节概述Android应用配置的核心组件及其职责：
- 应用清单（AndroidManifest.xml）：定义应用元数据、权限、组件和Intent过滤器
- 构建脚本（build.gradle、capacitor.build.gradle）：管理应用ID、版本、签名、依赖和混淆
- Capacitor配置（capacitor.config.json）：控制WebView行为、应用URL、包名等
- 版本管理（app_config.json、generate_version.py）：统一管理应用版本号，确保多文件一致性
- 混淆规则（proguard-rules.pro）：保护代码并优化性能
- 权限与插件（NativeTTSPlugin.java及相关文档）：实现特定功能所需的权限声明与配置

**章节来源**
- [AndroidManifest.xml](file://android/app/src/main/AndroidManifest.xml)
- [capacitor.config.json](file://capacitor.config.json)
- [app_config.json](file://app_config.json)
- [generate_version.py](file://generate_version.py)
- [capacitor.build.gradle](file://android/app/capacitor.build.gradle)
- [build.gradle](file://android/app/build.gradle)
- [proguard-rules.pro](file://android/app/proguard-rules.pro)
- [NativeTTSPlugin.java](file://android/app/src/main/java/com/tehui/offline/NativeTTSPlugin.java)

## 架构概览
下图展示了Android应用配置在运行时的关键交互流程：

```mermaid
sequenceDiagram
participant Dev as "开发者"
participant ACFG as "应用配置<br/>app_config.json"
participant GV as "版本生成器<br/>generate_version.py"
participant CFG as "Capacitor配置<br/>capacitor.config.json"
participant AMF as "应用清单<br/>AndroidManifest.xml"
participant GRD as "构建脚本<br/>build.gradle"
participant CBG as "Capacitor构建脚本<br/>capacitor.build.gradle"
participant APP as "应用"
Dev->>ACFG : 更新版本号1.4.17 → 1.4.18
Dev->>GV : 执行版本生成脚本
Dev->>CFG : 设置应用ID/名称/版本/WebView参数
Dev->>AMF : 声明权限/组件/Intent过滤器
Dev->>CBG : 配置Capacitor相关参数
Dev->>GRD : 配置签名/依赖/混淆
ACFG-->>GV : 提供版本信息
GV-->>APP : 生成版本文件version.json
CFG-->>APP : 提供运行时配置
AMF-->>APP : 提供权限与组件信息
CBG-->>APP : 注入Capacitor桥接与插件
GRD-->>APP : 生成签名APK/Bundle
```

**图表来源**
- [app_config.json](file://app_config.json)
- [generate_version.py](file://generate_version.py)
- [capacitor.config.json](file://capacitor.config.json)
- [AndroidManifest.xml](file://android/app/src/main/AndroidManifest.xml)
- [capacitor.build.gradle](file://android/app/capacitor.build.gradle)
- [build.gradle](file://android/app/build.gradle)

## 详细组件分析

### AndroidManifest.xml配置详解
AndroidManifest.xml是应用的"宪法"，必须准确声明以下内容：
- 应用标识与元数据：应用ID、版本号、名称等
- 权限声明：网络访问、存储访问、外部存储等
- 组件注册：Activity、Service、BroadcastReceiver、ContentProvider
- Intent过滤器：处理自定义协议、文件类型、系统事件等
- 元数据：WebView配置、调试模式、硬件特性要求等

权限系统要点：
- 网络访问：INTERNET、ACCESS_NETWORK_STATE
- 存储权限：READ_EXTERNAL_STORAGE、WRITE_EXTERNAL_STORAGE（Android 12+需配合管理存储）
- 外部存储：MANAGE_EXTERNAL_STORAGE（仅在需要管理所有文件时使用）
- 特定功能：如忽略电池优化（REQUEST_IGNORE_BATTERY_OPTIMIZATIONS）

组件与Intent过滤器：
- Activity需声明主题、启动模式、是否可导出
- 自定义协议需在Activity中添加Intent过滤器以支持Deep Link
- 广播接收器需明确广播类别与权限

**章节来源**
- [AndroidManifest.xml](file://android/app/src/main/AndroidManifest.xml)
- [NativeTTSPlugin.java](file://android/app/src/main/java/com/tehui/offline/NativeTTSPlugin.java)
- [CUSTOM_PLUGIN_SETUP.md](file://CUSTOM_PLUGIN_SETUP.md)
- [INSTALL_PLUGINS.md](file://INSTALL_PLUGINS.md)

### Capacitor配置文件设置
capacitor.config.json用于控制WebView行为与应用运行时参数：
- 应用ID与包名：与build.gradle中的applicationId保持一致
- 应用名称与版本：影响应用显示名称与更新机制
- WebView配置：启用/禁用调试、缓存策略、跨域策略等
- 应用URL：开发环境与生产环境的入口地址
- 插件配置：启用或禁用特定Capacitor插件

加载与验证：
- Capacitor在运行时从assets目录加载该配置文件
- 若配置缺失或格式错误，CLI会提示复制配置或修复JSON格式

**章节来源**
- [capacitor.config.json](file://capacitor.config.json)
- [CapConfig.java](file://node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/CapConfig.java)

### Android图标资源组织与命名规范
图标资源按密度分组存放于mipmap目录中，命名规范如下：
- mdpi：基础密度（1x）
- hdpi：1.5x
- xhdpi：2x
- xxhdpi：3x
- xxxhdpi：4x

命名建议：
- 使用统一前缀（如ic_launcher），后跟状态（normal、pressed、focused等）
- 文件名应简洁且具描述性，避免特殊字符
- 尺寸与比例严格遵循各密度标准，确保在不同设备上清晰显示

**章节来源**
- [AndroidManifest.xml](file://android/app/src/main/AndroidManifest.xml)

### 权限系统与最佳实践
权限分为两类：
- 正常权限：安装时自动授予（如网络访问）
- 危险权限：需运行时申请（如存储、相机、麦克风）

最佳实践：
- 仅声明必要权限，避免过度索取
- 在首次使用前解释权限用途，提升用户信任
- 对于外部存储管理，优先使用分区存储策略
- 定期审查权限列表，移除不再使用的权限

**章节来源**
- [AndroidManifest.xml](file://android/app/src/main/AndroidManifest.xml)
- [NativeTTSPlugin.java](file://android/app/src/main/java/com/tehui/offline/NativeTTSPlugin.java)

### 应用签名与发布准备
签名配置：
- debug签名：开发阶段自动生成，无需手动配置
- release签名：需配置keystore路径、别名、密码等
- Gradle任务：通过signingConfigs定义签名参数

发布准备：
- 生成签名APK/Bundle：使用assembleRelease或bundleRelease
- 代码混淆：启用ProGuard/R8并维护混淆规则
- 签名校验：确保签名与应用ID匹配，避免覆盖安装失败

**章节来源**
- [build.gradle](file://android/app/build.gradle)
- [capacitor.build.gradle](file://android/app/capacitor.build.gradle)

### ProGuard混淆与性能优化
混淆规则：
- proguard-rules.pro用于定义保留规则与混淆策略
- 建议保留接口、注解类、序列化类等关键元素
- 避免对第三方库进行不必要混淆，防止运行时异常

性能优化：
- 启用R8代码压缩与内联
- 移除未使用资源与代码
- 优化WebView加载策略，减少首屏时间
- 合理使用多进程与后台服务，避免耗电

**章节来源**
- [proguard-rules.pro](file://android/app/proguard-rules.pro)
- [build.gradle](file://android/app/build.gradle)

## 版本管理与更新流程

### 版本号配置与同步
应用采用多文件版本管理策略，确保版本信息的一致性和准确性：

**主要版本配置文件**：
- app_config.json：应用核心版本信息（当前版本1.4.18）
- generate_version.py：版本生成和同步工具
- package.json：npm包版本管理
- capacitor.config.json：Capacitor运行时版本配置

**版本号升级流程**：
1. 更新app_config.json中的version字段从1.4.17到1.4.18
2. 运行generate_version.py生成version.json
3. 同步版本信息到其他配置文件
4. 执行构建流程生成新版本APK

**版本生成机制**：
- generate_version.py从app_config.json读取版本号
- 自动生成APK文件名：TeHui-v1.4.18.apk
- 生成version.json包含apk_version和apk_file信息
- 支持可选的APK大小信息记录

```mermaid
flowchart TD
A[开始版本升级] --> B[更新app_config.json<br/>version: 1.4.17 → 1.4.18]
B --> C[运行generate_version.py]
C --> D[读取app_config.json]
D --> E[生成version.json]
E --> F[生成APK文件名<br/>TeHui-v1.4.18.apk]
F --> G[版本同步完成]
```

**图表来源**
- [app_config.json](file://app_config.json)
- [generate_version.py](file://generate_version.py)

**章节来源**
- [app_config.json](file://app_config.json)
- [generate_version.py](file://generate_version.py)
- [package.json](file://package.json)
- [capacitor.config.json](file://capacitor.config.json)

## 依赖关系分析
下图展示配置文件之间的依赖关系与相互影响：

```mermaid
graph TB
ACFG["app_config.json<br/>版本源文件"]
GV["generate_version.py<br/>版本生成器"]
VJ["version.json<br/>生成结果"]
CFG["capacitor.config.json"]
AMF["AndroidManifest.xml"]
CBG["capacitor.build.gradle"]
BG["build.gradle"]
PR["proguard-rules.pro"]
PKG["package.json"]
ACFG --> GV
GV --> VJ
ACFG --> CFG
CFG --> AMF
CFG --> CBG
AMF --> BG
CBG --> BG
PR --> BG
PKG --> GV
```

**图表来源**
- [app_config.json](file://app_config.json)
- [generate_version.py](file://generate_version.py)
- [capacitor.config.json](file://capacitor.config.json)
- [AndroidManifest.xml](file://android/app/src/main/AndroidManifest.xml)
- [capacitor.build.gradle](file://android/app/capacitor.build.gradle)
- [build.gradle](file://android/app/build.gradle)
- [proguard-rules.pro](file://android/app/proguard-rules.pro)
- [package.json](file://package.json)

**章节来源**
- [app_config.json](file://app_config.json)
- [generate_version.py](file://generate_version.py)
- [capacitor.config.json](file://capacitor.config.json)
- [AndroidManifest.xml](file://android/app/src/main/AndroidManifest.xml)
- [capacitor.build.gradle](file://android/app/capacitor.build.gradle)
- [build.gradle](file://android/app/build.gradle)
- [proguard-rules.pro](file://android/app/proguard-rules.pro)
- [package.json](file://package.json)

## 性能考虑
- WebView优化：合理设置缓存策略与跨域策略，减少网络请求开销
- 资源优化：使用合适密度的图标与图片，避免超大资源导致内存压力
- 代码优化：启用R8压缩，精简无用代码；维护混淆规则，避免误删关键类
- 权限最小化：仅申请必要权限，降低运行时检查成本
- 版本管理优化：通过自动化脚本减少手动操作，提高版本发布的准确性

## 故障排除指南
常见问题与解决方案：
- 权限缺失：运行时检测到权限未在清单中声明，需在AndroidManifest.xml补充相应权限
- 配置加载失败：capacitor.config.json格式错误或未复制到assets，需修复JSON并执行复制命令
- 签名不匹配：release签名与应用ID不一致导致安装失败，需重新生成签名或调整应用ID
- 混淆冲突：第三方库被错误混淆导致崩溃，需在proguard-rules.pro中添加保留规则
- 版本不一致：app_config.json与生成的version.json版本号不匹配，需重新运行generate_version.py

定位与诊断：
- 查看Bridge日志输出，确认缺失的权限与配置项
- 检查Capacitor配置加载过程，确保文件存在且格式正确
- 使用Android Studio的Build Analyzer与APK Analyzer分析性能瓶颈
- 验证版本生成脚本的输出文件，确保version.json正确生成

**章节来源**
- [Bridge.java](file://node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/Bridge.java)
- [CapConfig.java](file://node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/CapConfig.java)
- [generate_version.py](file://generate_version.py)

## 结论
Android应用配置涉及多个层面的协同工作：清单文件定义权限与组件、构建脚本管理签名与混淆、Capacitor配置控制运行时行为、版本管理系统确保多文件一致性。随着版本号从1.4.17升级到1.4.18，新的版本管理流程通过app_config.json和generate_version.py实现了自动化版本生成和同步，显著提升了版本发布的效率和准确性。遵循本文档的配置建议与最佳实践，可显著提升应用的安全性、稳定性与性能表现。发布前务必完成签名配置、混淆规则校验、权限审查以及版本号同步，确保应用顺利上线并获得良好用户体验。

## 附录
- 参考文档：CUSTOM_PLUGIN_SETUP.md、INSTALL_PLUGINS.md
- 关键实现：NativeTTSPlugin.java中对权限声明的说明与使用
- 版本管理工具：generate_version.py提供了完整的版本生成和同步功能
- 配置文件：app_config.json作为版本信息的单一事实来源

**章节来源**
- [CUSTOM_PLUGIN_SETUP.md](file://CUSTOM_PLUGIN_SETUP.md)
- [INSTALL_PLUGINS.md](file://INSTALL_PLUGINS.md)
- [NativeTTSPlugin.java](file://android/app/src/main/java/com/tehui/offline/NativeTTSPlugin.java)
- [generate_version.py](file://generate_version.py)
- [app_config.json](file://app_config.json)