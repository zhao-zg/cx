# 安卓APP打包指南

## 前置要求

1. **Node.js** (v16+)
2. **Android Studio** (最新版本)
3. **Java JDK** (11 或 17)
4. **Python 3** (已有)

## 快速开始

### 1. 安装依赖

```bash
# 安装 Node.js 依赖
npm install

# 或使用 yarn
yarn install
```

### 2. 初始化 Capacitor（首次运行）

```bash
# 添加安卓平台
npm run cap:add
```

### 3. 生成静态网站并同步到安卓项目

```bash
# 生成网站内容
python main.py

# 同步到安卓项目
npm run cap:sync
```

### 4. 打开 Android Studio 进行开发

```bash
npm run cap:open
```

在 Android Studio 中：
- 连接安卓设备或启动模拟器
- 点击 Run 按钮运行应用

### 5. 构建发布版 APK

```bash
# 方式1: 使用 npm 脚本（推荐）
npm run android:build

# 方式2: 手动构建
cd android
./gradlew assembleRelease
```

生成的 APK 位于：
```
android/app/build/outputs/apk/release/app-release-unsigned.apk
```

## 签名 APK（发布到应用商店）

### 1. 生成密钥库

```bash
keytool -genkey -v -keystore my-release-key.keystore -alias my-key-alias -keyalg RSA -keysize 2048 -validity 10000
```

### 2. 配置签名

在 `android/app/build.gradle` 中添加：

```gradle
android {
    ...
    signingConfigs {
        release {
            storeFile file("../../my-release-key.keystore")
            storePassword "你的密码"
            keyAlias "my-key-alias"
            keyPassword "你的密码"
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
    }
}
```

### 3. 构建签名的 APK

```bash
cd android
./gradlew assembleRelease
```

签名的 APK 位于：
```
android/app/build/outputs/apk/release/app-release.apk
```

## 应用图标和启动画面

### 自定义图标

1. 准备一个 1024x1024 的 PNG 图标
2. 使用在线工具生成各种尺寸：https://icon.kitchen/
3. 将生成的资源放入 `android/app/src/main/res/` 对应目录

### 自定义启动画面

编辑 `android/app/src/main/res/values/styles.xml`

## 常见问题

### Q: 如何更新应用内容？

```bash
# 1. 更新 resource 文件夹中的文档
# 2. 重新生成网站
python main.py

# 3. 同步到安卓项目
npm run cap:sync

# 4. 重新构建
npm run android:build
```

### Q: 如何调试应用？

1. 在 Chrome 中打开 `chrome://inspect`
2. 连接安卓设备并运行应用
3. 点击 "inspect" 查看控制台

### Q: 应用体积太大？

- 删除不需要的训练批次
- 压缩图片资源
- 在 `build.gradle` 中启用 `minifyEnabled true`

## 版本更新

修改 `android/app/build.gradle` 中的版本号：

```gradle
android {
    defaultConfig {
        versionCode 2  // 每次发布递增
        versionName "1.1.0"  // 显示给用户的版本
    }
}
```

## 发布到 Google Play

1. 在 [Google Play Console](https://play.google.com/console) 创建应用
2. 上传签名的 APK 或 AAB
3. 填写应用信息、截图等
4. 提交审核

## 🤖 自动化发布（推荐）

本项目支持 GitHub Actions 自动构建和发布！

### 快速发布

```bash
# 创建版本标签
git tag v1.0.0
git push origin v1.0.0

# GitHub 会自动构建并发布 APK 到 Releases
```

详细说明请查看 [RELEASE.md](RELEASE.md)

## 技术支持

- Capacitor 文档: https://capacitorjs.com/docs
- Android 开发文档: https://developer.android.com
- GitHub Actions 文档: https://docs.github.com/actions
