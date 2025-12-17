# APK 朗读功能说明

## 当前状态

APK 版本中的朗读功能可能不可用，这是因为：

1. **Android WebView 限制**：Android WebView 对 Web Speech API 的支持非常有限
2. **浏览器差异**：Web Speech API 主要在 Chrome、Edge 等现代浏览器中可用

## 解决方案

### 方案 1：使用浏览器版本（推荐）
如果需要使用朗读功能，建议使用浏览器访问网站：
- https://cx.zhaozg.dpdns.org/
- https://cx.zhaozg.cloudns.org/
- https://cx.xzdjx.dynv6.net/
- https://zhao-zg.github.io/cx/

在 Chrome、Edge 等浏览器中，朗读功能完全可用。

### 方案 2：添加原生 TTS 支持（需要开发）
如果必须在 APK 中使用朗读功能，需要：

1. 安装 Capacitor Text-to-Speech 插件：
```bash
npm install @capacitor-community/text-to-speech
npx cap sync
```

2. 修改 `src/static/js/speech.js`，添加对 Capacitor TTS 的支持：
```javascript
// 检测是否在 Capacitor 环境中
if (window.Capacitor && window.Capacitor.Plugins.TextToSpeech) {
  // 使用 Capacitor TTS
  const { TextToSpeech } = window.Capacitor.Plugins;
  // ... 实现 TTS 逻辑
} else if ('speechSynthesis' in window) {
  // 使用 Web Speech API（浏览器）
  // ... 现有逻辑
}
```

3. 在 Android manifest 中添加权限（如果需要）

## 当前行为

- **浏览器版本**：朗读功能正常工作
- **在线版 APK**：跳转到远程网站后，朗读功能可能不可用（显示"浏览器不支持朗读"）
- **离线版 APK**：朗读功能可能不可用（显示"浏览器不支持朗读"）

## 建议

对于大多数用户：
- 如果需要朗读功能，使用浏览器访问网站
- 如果不需要朗读功能，APK 版本提供了更好的应用体验（独立图标、全屏显示等）

如果朗读功能是核心需求，建议实现方案 2（添加原生 TTS 支持）。
