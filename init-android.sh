#!/bin/bash
# 初始化安卓项目配置

echo "初始化安卓项目..."

# 确保 android 目录存在
if [ ! -d "android" ]; then
    echo "添加安卓平台..."
    npx cap add android
fi

# 更新 build.gradle 配置
cat > android/variables.gradle << 'EOF'
ext {
    minSdkVersion = 22
    compileSdkVersion = 34
    targetSdkVersion = 34
    androidxActivityVersion = '1.8.0'
    androidxAppCompatVersion = '1.6.1'
    androidxCoordinatorLayoutVersion = '1.2.0'
    androidxCoreVersion = '1.12.0'
    androidxFragmentVersion = '1.6.2'
    coreSplashScreenVersion = '1.0.1'
    androidxWebkitVersion = '1.9.0'
    junitVersion = '4.13.2'
    androidxJunitVersion = '1.1.5'
    androidxEspressoCoreVersion = '3.5.1'
    cordovaAndroidVersion = '10.1.1'
}
EOF

# 更新 app/build.gradle 中的版本信息
if [ -f "android/app/build.gradle" ]; then
    # 检查是否已经有 versionCode 和 versionName
    if ! grep -q "versionCode" android/app/build.gradle; then
        # 在 defaultConfig 中添加版本信息
        sed -i '/defaultConfig {/a\        versionCode 1\n        versionName "1.0.0"' android/app/build.gradle
    fi
fi

echo "✓ 安卓项目初始化完成"
