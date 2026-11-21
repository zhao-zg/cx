/**
 * 纲目展开/收起功能
 * 共享于纲目页面和晨读页面
 */

// 展开/收起子节点
function toggleSection(id) {
    var element = document.getElementById(id);
    if (!element) return;
    var isHidden = element.style.display === 'none' || element.style.display === '';
    element.style.display = isHidden ? 'block' : 'none';
    var prefix = document.querySelector('[data-toggle-for="' + id + '"]');
    if (prefix) prefix.classList.toggle('expanded', isHidden);
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
    // 遗历展开/收起
    document.querySelectorAll('.subsections').forEach(function(subsection) {
        var parentLevel = parseInt(subsection.getAttribute('data-parent-level')) || 1;
        var show = parentLevel < maxLevel;
        subsection.style.display = show ? 'block' : 'none';
        var prefix = document.querySelector('[data-toggle-for="' + subsection.id + '"]');
        if (prefix) prefix.classList.toggle('expanded', show);
    });
}
