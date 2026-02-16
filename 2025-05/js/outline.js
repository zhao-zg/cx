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
        element.style.display = 'block';
        if (button) button.textContent = '收起经文';
    } else {
        element.style.display = 'none';
        if (button) button.textContent = '展开经文';
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
