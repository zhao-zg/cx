# Copilot Instructions

## 代码修改规范

- **禁止使用 PowerShell 命令修改代码文件**（包括 `Set-Content`、`Out-File`、`Add-Content`、重定向 `>`、`>>`、`$lines[...] | Set-Content` 等方式）。
  PowerShell 的文本 cmdlet 默认使用系统代码页（如 GBK）读取文件，再以 UTF-8 BOM 写回，会导致中文字符乱码，且可能破坏字符串字面量（如丢失引号）。
- 需要生成或覆写文件内容时，一律使用：
  1. `create_file` / `replace_string_in_file` 工具直接操作，或
  2. Node.js 脚本，以 `fs.writeFileSync(path, content, 'utf8')` 写入（无 BOM）。

## 弹框开发规范（优先使用 CX.openDialog）

### CX.openDialog — 通用弹框工厂（推荐）

`theme-toggle.js` 中的 `window.CX.openDialog(opts)` 统一封装了所有弹框样板代码（遮罩创建、lockOverlayScroll、backStack 注册、遮罩点击关闭、冒泡阻止），**新增弹框应优先使用它**：

```js
var dlg = window.CX.openDialog({
    id: 'myDialogMask',          // 可选，用于防止重复打开；重复时返回 null
    html: '<div class="cx-dialog">...</div>',  // 遮罩内的 innerHTML
    // className: 'cx-dialog-mask',  // 默认值，一般不需要改
    // onClose: function() {},       // 关闭后回调（可选）
});
if (!dlg) return;  // id 重复守卫

// dlg.mask  — 遮罩 DOM 元素，用于继续绑定内部事件
// dlg.close — 主动关闭函数（消耗 history 记录）
dlg.mask.addEventListener('click', function(e) {
    var t = e.target;
    if (t.getAttribute('data-action') === 'cancel') { dlg.close(); return; }
    // ... 其他内部事件委托
});
var closeBtn = document.getElementById('myDialogClose');
if (closeBtn) closeBtn.addEventListener('click', dlg.close);
```

**openDialog 已自动处理**：遮罩 `appendChild`、`lockOverlayScroll`、`backStack.push`、`e.target === mask` 时 `stopPropagation + close()`。
**无需手动做**：mask.id 赋值、class 赋值、append、lockOverlay、backStack push/pop、mask 点击关闭逻辑。

---

### 低层 API（仅当 openDialog 不适用时使用）

进度类弹框（不可中途关闭）或有特殊结构时，手动处理：

```js
// 挂载后注册到 backStack（系统返回键直接调用此 fn 关闭）
document.body.appendChild(mask);
if (win.CX && win.CX.lockOverlayScroll) win.CX.lockOverlayScroll(mask);
if (win.CX && win.CX.backStack) win.CX.backStack.push(function() {
    if (mask.parentNode) mask.parentNode.removeChild(mask);
});

// 手动关闭（按钮/遮罩点击）：先移除 DOM，再 pop（内部调 history.back()）
function closeDialog() {
    if (mask.parentNode) mask.parentNode.removeChild(mask);
    if (win.CX && win.CX.backStack) win.CX.backStack.pop();
}
// 遮罩点击关闭时必须 stopPropagation，避免冒泡误触主题面板关闭
mask.addEventListener('click', function(e) {
    if (e.target === mask) { e.stopPropagation(); closeDialog(); }
});
```

**背景**：`window.CX.lockOverlayScroll` 通过绑定 `touchstart` / `touchmove` 防滚动穿透；`backStack` 统一管理系统返回键。

---

**已接入的弹框**：
| 弹框 | 文件 | 使用 openDialog |
|---|---|:---:|
| 清理数据对话框 | `theme-toggle.js` | ✅ |
| 赞助对话框 | `theme-toggle.js` | ✅ |
| 反馈问题对话框 | `theme-toggle.js` | ✅ |
| 主题/设置面板 | `theme-toggle.js` | 低层 API（panel 形态） |
| 经文弹框 | `scripture-popup.js` | 低层 API（自有结构） |
| App 更新对话框 | `app-update.js` | 低层 API（自有结构） |
| APK 更新对话框 | `app-update.js` | 低层 API（自有结构） |
| 资源管理对话框 | `resource-pack.js` | ✅ |
| 管理面板 | `index.html` | 低层 API |
| 朗读权限提示 | `speech.js` | — (一次性提示，不需要) |
| 首次安装进度框 | `index.html` | — (进度弹框，不可中途关闭) |

**新增弹框时的检查清单**：
1. 优先用 `CX.openDialog`，填 `id`、`html` 两个字段即可
2. 若手动创建：class `cx-dialog-mask`，`touch-action:none;overscroll-behavior:none`
3. 遮罩点击必须 `e.stopPropagation()`，防止冒泡误触设置面板
4. 将新弹框加入上表
