# TTS（文字转语音）使用指南

## Android TTS 权限说明

### ✅ 不需要特殊权限

Android TTS 使用系统内置的文字转语音服务，**不需要**在 AndroidManifest.xml 中声明任何特殊权限。

### 📱 系统要求

1. **Android 版本**: Android 5.1 (API 22) 或更高
2. **TTS 引擎**: 需要安装 TTS 引擎（通常系统自带）
3. **语音包**: 需要下载中文语音包

## 用户端配置

### 1. 检查 TTS 引擎

**路径**: 设置 > 辅助功能 > 文字转语音输出

- 查看是否安装了 TTS 引擎（如 Google 文字转语音）
- 如果没有，需要从 Google Play 安装

### 2. 下载中文语音包

**步骤**:
1. 打开 **设置 > 辅助功能 > 文字转语音输出**
2. 点击 **首选引擎** 旁边的设置图标
3. 选择 **安装语音数据**
4. 下载 **中文（简体）** 或 **中文（繁体）** 语音包

### 3. 测试 TTS

在设置页面中，点击 **"播放"** 按钮测试 TTS 是否正常工作。

## 常见问题

### Q: 为什么朗读按钮不显示？

**A**: 可能的原因：
1. 浏览器不支持（网页版）
2. TTS 插件未正确加载（APP 版）
3. 检查控制台日志查看详细错误

### Q: 点击朗读没有声音？

**A**: 可能的原因：
1. **没有安装 TTS 引擎**
   - 解决：从 Google Play 安装 "Google 文字转语音"
   
2. **没有下载中文语音包**
   - 解决：在 TTS 设置中下载中文语音包
   
3. **TTS 引擎未启用**
   - 解决：在设置中启用 TTS 引擎
   
4. **音量太小**
   - 解决：调高媒体音量

### Q: 朗读声音不自然？

**A**: 可以尝试：
1. 下载更高质量的语音包
2. 调整语速（APP 中有语速控制）
3. 尝试其他 TTS 引擎

## 技术实现

### Capacitor TTS 插件

本应用使用 `@capacitor-community/text-to-speech` 插件：

```javascript
// 检测 TTS 支持
var useCapacitorTTS = window.Capacitor && 
                      window.Capacitor.Plugins && 
                      window.Capacitor.Plugins.TextToSpeech;

// 播放
TextToSpeech.speak({
  text: '要朗读的文本',
  lang: 'zh-CN',
  rate: 1.0,
  pitch: 1.0,
  volume: 1.0
});
```

### 降级策略

如果 Capacitor TTS 不可用，会自动降级到 Web Speech API（浏览器版）。

## 调试

### 查看日志

如果能连接电脑调试：

1. 电脑上打开 Chrome
2. 访问 `chrome://inspect`
3. 连接手机，查看 WebView 控制台
4. 查找 `[TTS]` 开头的日志

### 日志示例

```
[TTS] 环境检测: { hasCapacitor: true, hasTextToSpeech: true, ... }
[TTS] 开始播放，文本长度: 1234, 语速: 1.0
[TTS] 播放完成
```

## 推荐 TTS 引擎

### Android

1. **Google 文字转语音** (推荐)
   - 质量高，支持多种语言
   - 免费，系统集成度好
   
2. **讯飞语音**
   - 中文效果好
   - 需要单独安装

3. **Samsung TTS**
   - 三星设备预装
   - 质量不错

## 参考资料

- [Capacitor TTS 插件文档](https://github.com/capacitor-community/text-to-speech)
- [Android TTS 官方文档](https://developer.android.com/reference/android/speech/tts/TextToSpeech)
- [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)
