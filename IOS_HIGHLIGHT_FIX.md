# iOS 划线功能修复说明

## 问题
iOS设备上的划线标记功能无效，但Android设备正常工作。

## 原因分析
iOS的文本选择和触摸事件处理与Android有显著差异：
1. iOS的`selectionchange`事件触发时机不同
2. iOS需要更长的延迟来等待文本选择完成
3. iOS的触摸事件可能会干扰文本选择
4. iOS对按钮点击事件的处理更严格

## 修复内容

### 1. 优化事件监听时机
- `touchend`延迟从100ms增加到150ms（iOS需要更长时间）
- `selectionchange`延迟从300ms增加到500ms
- 使用独立的定时器变量，避免冲突

### 2. 改进工具栏显示
- 添加`z-index: 10000`确保工具栏在最上层
- iOS特定的强制重绘技巧（opacity 0.99 -> 1）
- 移动端工具栏使用`!important`确保样式优先级

### 3. 优化按钮点击
- 同时监听`touchend`和`click`事件
- 使用`preventDefault()`和`stopPropagation()`防止事件冲突
- 工具栏添加触摸事件阻止冒泡

### 4. 增强CSS兼容性
- 添加`-webkit-user-select: none`防止误选
- 添加`touch-action: manipulation`优化触摸响应
- 移动端工具栏z-index设为10000

### 5. 改进触摸隐藏逻辑
- iOS延迟隐藏工具栏，避免干扰选择
- 检查选择状态后再决定是否隐藏
- 长按删除使用独立的target变量

## 测试要点

### iOS设备测试
1. 长按选择文本，工具栏应出现在底部
2. 点击颜色按钮，文本应被标记
3. 标记后工具栏应自动隐藏
4. 点击"清除"按钮应弹出确认对话框
5. 长按已标记的文本应弹出删除确认

### Android设备测试
确保修复不影响Android的正常功能

## 技术细节

### 事件处理顺序
```
iOS: touchstart -> selectionchange -> touchend -> 显示工具栏
Android: touchstart -> touchend -> selectionchange -> 显示工具栏
```

### 延迟时间调整
- `touchend`: 150ms（iOS需要更长）
- `selectionchange`: 500ms（iOS需要更长）
- 工具栏隐藏: 100ms延迟检查选择状态

### 按钮事件绑定
```javascript
// 同时绑定两种事件，确保兼容性
btn.addEventListener('touchend', handleClick);
btn.addEventListener('click', handleClick);
```

## 相关文件
- `src/static/js/highlight.js` - 主要修复文件
- `src/templates/base.html` - CSS样式优化
