# Copilot Instructions

## 代码修改规范

- **禁止使用 PowerShell 命令修改代码文件**（包括 `Set-Content`、`Out-File`、`Add-Content`、重定向 `>`、`>>`、`$lines[...] | Set-Content` 等方式）。
  PowerShell 的文本 cmdlet 默认使用系统代码页（如 GBK）读取文件，再以 UTF-8 BOM 写回，会导致中文字符乱码，且可能破坏字符串字面量（如丢失引号）。
- 需要生成或覆写文件内容时，一律使用：
  1. `create_file` / `replace_string_in_file` 工具直接操作，或
  2. Node.js 脚本，以 `fs.writeFileSync(path, content, 'utf8')` 写入（无 BOM）。

## 弹框/遮罩层规范

所有覆盖全屏的弹框遮罩层，**必须**在挂载到 `document.body` 后立即调用：

```js
if (win.CX && win.CX.lockOverlayScroll) win.CX.lockOverlayScroll(mask);
```

**背景**：`window.CX.lockOverlayScroll`（定义于 `theme-toggle.js`）通过绑定 `touchstart` / `touchmove` 事件，实现：
- 遮罩空白区域：阻止触摸穿透，背景页面不滚动
- 弹框内可滚动子元素（`overflow:auto/scroll`）：允许在边界内滚动，到顶/到底时才阻止

**注意**：`lockOverlayScroll` 必须在元素已挂载到 DOM 后调用（即 `appendChild` 之后）。

## 弹框系统返回键（backStack）规范

除进度类弹框（用户不可中途关闭）外，所有用户操作弹框**必须**支持系统返回键 / 浏览器历史后退，pattern 如下：

```js
// 挂载后注册到 backStack（系统返回键直接调用此 fn 关闭）
document.body.appendChild(mask);
if (win.CX && win.CX.backStack) win.CX.backStack.push(function() {
    if (mask.parentNode) mask.parentNode.removeChild(mask);
});

// 手动关闭（按钮/遮罩点击）：先移除 DOM，再 pop（内部调 history.back()）
function closeDialog() {
    if (mask.parentNode) mask.parentNode.removeChild(mask);
    if (win.CX && win.CX.backStack) win.CX.backStack.pop();
}
```

**已接入的弹框**：
| 弹框 | 文件 | lockOverlayScroll | backStack |
|---|---|:---:|:---:|
| 主题/设置面板 | `theme-toggle.js` | ✅ | ✅ |
| 清理数据对话框 | `theme-toggle.js` | ✅ | ✅ |
| 赞助对话框 | `theme-toggle.js` | ✅ | ✅ |
| 经文弹框 | `scripture-popup.js` | ✅ | ✅ |
| App 更新对话框 | `app-update.js` | ✅ | ✅ |
| APK 更新对话框 | `app-update.js` | ✅ | ✅ |
| 资源管理对话框 | `resource-pack.js` | ✅ | ✅ |
| 管理面板 | `index.html` | ✅ | ✅ |
| 朗读权限提示 | `speech.js` | — | — (一次性提示，不需要) |
| 首次安装进度框 | `index.html` | — | — (进度弹框，不可中途关闭) |

**新增弹框时的检查清单**：
1. 遮罩元素使用 `position:fixed;inset:0` 覆盖全屏
2. `document.body.appendChild(mask)` 之后立即调用 `CX.lockOverlayScroll(mask)`
3. CSS 加上 `touch-action:none;overscroll-behavior:none`（见 `.cx-dialog-mask`）
4. 注册到 `CX.backStack.push(closeFn)`，手动关闭时先 removeChild 再 `backStack.pop()`
5. 将新弹框加入上表
