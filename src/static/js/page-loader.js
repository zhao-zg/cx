/**
 * 页面加载器 - 拦截页面导航，支持热更新
 */
(function() {
    'use strict';

    // 只在 Capacitor 环境下启用
    if (!window.Capacitor || !window.Capacitor.Plugins) {
        return;
    }

    var Filesystem = window.Capacitor.Plugins.Filesystem;
    if (!Filesystem) {
        return;
    }

    var DIRECTORY_DATA = 'DATA';
    var HOT_UPDATE_DIR = 'hot-update';

    /**
     * 拦截链接点击
     */
    function interceptLinks() {
        document.addEventListener('click', function(e) {
            var target = e.target;
            
            // 查找最近的 <a> 标签
            while (target && target.tagName !== 'A') {
                target = target.parentElement;
            }
            
            if (!target || target.tagName !== 'A') {
                return;
            }

            var href = target.getAttribute('href');
            
            // 只拦截相对路径的 HTML 链接
            if (!href || href.startsWith('http') || href.startsWith('#') || href.startsWith('javascript:')) {
                return;
            }

            // 只拦截 .html 和 .htm 文件
            if (!href.endsWith('.html') && !href.endsWith('.htm')) {
                return;
            }

            // 阻止默认行为
            e.preventDefault();
            
            // 加载页面
            loadPage(href);
        }, true);
    }

    /**
     * 加载页面（优先从热更新目录）
     */
    async function loadPage(path) {
        try {
            // 规范化路径
            var normalizedPath = path.replace(/^\.\//, '');
            
            // 检查热更新文件是否存在
            var hotUpdatePath = HOT_UPDATE_DIR + '/' + normalizedPath;
            var useHotUpdate = false;
            
            try {
                await Filesystem.stat({
                    path: hotUpdatePath,
                    directory: DIRECTORY_DATA
                });
                useHotUpdate = true;
                console.log('[页面加载] 使用热更新版本:', normalizedPath);
            } catch (e) {
                console.log('[页面加载] 使用原始版本:', normalizedPath);
            }

            if (useHotUpdate) {
                // 从热更新目录读取
                var result = await Filesystem.readFile({
                    path: hotUpdatePath,
                    directory: DIRECTORY_DATA,
                    encoding: 'utf8'
                });
                
                // 替换当前页面内容
                document.open();
                document.write(result.data);
                document.close();
                
                // 更新 URL（不刷新页面）
                history.pushState(null, '', path);
                
                // 重新初始化拦截器
                setTimeout(interceptLinks, 100);
            } else {
                // 使用原始导航
                window.location.href = path;
            }
        } catch (e) {
            console.error('[页面加载] 加载失败:', path, e);
            // 降级到原始导航
            window.location.href = path;
        }
    }

    // 初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', interceptLinks);
    } else {
        interceptLinks();
    }

    // 处理浏览器后退/前进
    window.addEventListener('popstate', function() {
        window.location.reload();
    });

    console.log('[页面加载] 拦截器已启用');
})();
