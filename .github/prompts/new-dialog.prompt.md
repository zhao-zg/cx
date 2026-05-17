---
name: new-dialog
description: 在前端 JS 文件中新增弹框，自动套用 CX.openDialog 模板并更新弹框清单
---

在 `${file}` 中新增一个弹框，功能描述：**${description}**

## 要求

1. **优先使用 `CX.openDialog`**，只有进度类（不可中途关闭）弹框才用低层 API。

2. 使用以下模板（替换 `MY_DIALOG` 和内部 HTML）：

```js
function openMyDialog() {
    var dlg = window.CX.openDialog({
        id: 'myDialogMask',
        html: '<div class="cx-dialog">'
            + '  <div class="cx-dialog-title">标题</div>'
            + '  <div class="cx-dialog-body">内容</div>'
            + '  <div class="cx-dialog-actions">'
            + '    <button class="cx-btn cx-btn-primary" data-action="confirm">确定</button>'
            + '    <button class="cx-btn" data-action="cancel">取消</button>'
            + '  </div>'
            + '</div>',
        onClose: function() { /* 可选清理 */ }
    });
    if (!dlg) return;  // 防止重复打开

    dlg.mask.addEventListener('click', function(e) {
        var t = e.target;
        if (t.getAttribute('data-action') === 'cancel') { dlg.close(); return; }
        if (t.getAttribute('data-action') === 'confirm') {
            // TODO: 业务逻辑
            dlg.close();
        }
    });
}
```

3. **禁止手动做的事**（`openDialog` 已自动处理）：
   - mask.id / class 赋值
   - `document.body.appendChild`
   - `lockOverlayScroll`
   - `backStack.push / pop`
   - mask 点击关闭逻辑

4. 实现后，在 `.github/copilot-instructions.md` 的**已接入的弹框**表格末尾追加一行：

   ```
   | 新弹框描述 | `文件名.js` | ✅ |
   ```
