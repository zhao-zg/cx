/**
 * 纲目展开/收起功能
 * 共享于纲目页面和晨兴页面
 */

// 展开/收起子节点
function toggleSection(id) {
    var element = document.getElementById(id);
    if (!element) return;

    var buttons = document.querySelectorAll('button[onclick*="' + id + '"]');
    var button = buttons[0];

    if (element.style.display === 'none' || element.style.display === '') {
        element.style.display = 'block';
        if (button) button.classList.add('expanded');
    } else {
        element.style.display = 'none';
        if (button) button.classList.remove('expanded');
    }
}

// 展开/收起经文
function toggleScripture(id) {
    var element = document.getElementById(id);
    if (!element) return;

    var buttons = document.querySelectorAll('button[onclick*="' + id + '"]');
    var button = buttons[0];

    if (element.style.display === 'none' || element.style.display === '') {
        // 展开
        element.style.display = 'block';
        if (button) button.textContent = '收起经文';
    } else {
        // 收起：先获取布局信息，再决定滚动策略
        var vh = window.innerHeight;

        // 找到触发行（含按钮的 .outline-item 或 .scripture-section）
        var triggerRow = button
            ? (button.closest('.outline-item') || button.closest('.scripture-section'))
            : null;

        // 找文档中触发行之后的第一个 .outline-item
        var allItems = Array.prototype.slice.call(document.querySelectorAll('.outline-item'));
        var nextItem = null;
        if (triggerRow) {
            var triggerIdx = allItems.indexOf(triggerRow);
            if (triggerIdx === -1) {
                // triggerRow 是 .scripture-section，找它之后的第一个 .outline-item
                for (var i = 0; i < allItems.length; i++) {
                    if (triggerRow.compareDocumentPosition(allItems[i]) & Node.DOCUMENT_POSITION_FOLLOWING) {
                        nextItem = allItems[i];
                        break;
                    }
                }
            } else {
                nextItem = allItems[triggerIdx + 1] || null;
            }
        }

        // 判断可见性（元素顶部在 [0, vh) 内则视为"在屏幕上"）
        var triggerRect = triggerRow ? triggerRow.getBoundingClientRect() : null;
        var triggerVisible = triggerRect && triggerRect.top >= 0 && triggerRect.top < vh;

        var nextRect = nextItem ? nextItem.getBoundingClientRect() : null;
        var nextVisible = nextRect && nextRect.top >= 0 && nextRect.top < vh;

        // 执行收起
        element.style.display = 'none';
        if (button) button.textContent = '展开经文';

        if (triggerVisible) {
            // 情形3：触发行在屏幕内 → 直接收起，不滚动
        } else if (!triggerVisible && nextVisible) {
            // 情形2：触发行不在屏幕，但下一行在屏幕 → 保持下一行位置不变
            var nextTopBefore = nextRect.top;
            requestAnimationFrame(function () {
                var newNextTop = nextItem.getBoundingClientRect().top;
                window.scrollBy(0, newNextTop - nextTopBefore);
            });
        } else {
            // 情形1：两者都不在屏幕 → 滚到上下两行中点居中
            requestAnimationFrame(function () {
                var r1 = triggerRow ? triggerRow.getBoundingClientRect() : null;
                var r2 = nextItem ? nextItem.getBoundingClientRect() : null;
                var midTop, midBottom;
                if (r1 && r2) {
                    midTop = r1.top; midBottom = r2.bottom;
                } else if (r1) {
                    midTop = r1.top; midBottom = r1.bottom;
                } else if (r2) {
                    midTop = r2.top; midBottom = r2.bottom;
                } else { return; }
                var midpoint = (midTop + midBottom) / 2;
                window.scrollBy(0, midpoint - vh / 2);
            });
        }
    }
}

// 展开到指定级别（仅纲目页面使用）
function expandToLevel(maxLevel) {
    // 更新按钮状态
    document.querySelectorAll('.level-btn').forEach(function(btn) {
        btn.classList.remove('active');
    });
    if (event && event.target) {
        event.target.classList.add('active');
    }
    
    // 获取所有 subsections
    document.querySelectorAll('.subsections').forEach(function(subsection) {
        var parentLevel = parseInt(subsection.getAttribute('data-parent-level')) || 1;
        var toggleBtn = subsection.previousElementSibling ? subsection.previousElementSibling.querySelector('.toggle-btn') : null;
        
        if (parentLevel < maxLevel) {
            // 展开
            subsection.style.display = 'block';
            if (toggleBtn) toggleBtn.classList.add('expanded');
        } else {
            // 收起
            subsection.style.display = 'none';
            if (toggleBtn) toggleBtn.classList.remove('expanded');
        }
    });
}
