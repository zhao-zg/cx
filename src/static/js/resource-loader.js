/**
 * 资源加载器 - 支持热更新
 * 在 Capacitor 环境下优先从 hot-update 目录加载资源
 */
(function() {
    'use strict';

    window.ResourceLoader = {
        // 配置
        config: {
            hotUpdateDir: 'hot-update',
            cacheKey: 'cx_resource_cache'
        },

        // 缓存已检查的文件路径
        checkedPaths: new Map(),

        /**
         * 检查热更新文件是否存在
         */
        checkHotUpdateFile: async function(path) {
            // 如果已经检查过，直接返回缓存结果
            if (this.checkedPaths.has(path)) {
                return this.checkedPaths.get(path);
            }

            // 非 Capacitor 环境，直接返回 false
            if (!window.Capacitor || !window.Capacitor.Plugins || !window.Capacitor.Plugins.Filesystem) {
                this.checkedPaths.set(path, false);
                return false;
            }

            try {
                var Filesystem = window.Capacitor.Plugins.Filesystem;
                var DIRECTORY_DATA = 'DATA';
                
                var hotUpdatePath = this.config.hotUpdateDir + '/' + path;
                
                // 尝试读取文件信息
                await Filesystem.stat({
                    path: hotUpdatePath,
                    directory: DIRECTORY_DATA
                });
                
                // 文件存在
                this.checkedPaths.set(path, true);
                return true;
            } catch (e) {
                // 文件不存在
                this.checkedPaths.set(path, false);
                return false;
            }
        },

        /**
         * 从热更新目录读取文件
         */
        readHotUpdateFile: async function(path) {
            if (!window.Capacitor || !window.Capacitor.Plugins || !window.Capacitor.Plugins.Filesystem) {
                throw new Error('Capacitor Filesystem 不可用');
            }

            var Filesystem = window.Capacitor.Plugins.Filesystem;
            var DIRECTORY_DATA = 'DATA';
            
            var hotUpdatePath = this.config.hotUpdateDir + '/' + path;
            
            try {
                var result = await Filesystem.readFile({
                    path: hotUpdatePath,
                    directory: DIRECTORY_DATA,
                    encoding: 'utf8'
                });
                
                return result.data;
            } catch (e) {
                throw new Error('读取热更新文件失败: ' + e.message);
            }
        },

        /**
         * 加载脚本（支持热更新）
         */
        loadScript: async function(src) {
            var self = this;
            
            // 检查是否有热更新版本
            var hasHotUpdate = await this.checkHotUpdateFile(src);
            
            if (hasHotUpdate) {
                console.log('[资源加载] 使用热更新版本:', src);
                
                try {
                    // 从热更新目录读取
                    var content = await this.readHotUpdateFile(src);
                    
                    // 创建 script 标签并执行
                    var script = document.createElement('script');
                    script.textContent = content;
                    script.setAttribute('data-hot-update', 'true');
                    script.setAttribute('data-src', src);
                    document.head.appendChild(script);
                    
                    return true;
                } catch (e) {
                    console.error('[资源加载] 热更新脚本加载失败，降级到原始版本:', src, e);
                    // 降级到原始版本
                    return this.loadScriptFallback(src);
                }
            } else {
                // 使用原始版本
                return this.loadScriptFallback(src);
            }
        },

        /**
         * 加载原始脚本（降级方案）
         */
        loadScriptFallback: function(src) {
            return new Promise(function(resolve, reject) {
                var script = document.createElement('script');
                script.src = src;
                script.onload = function() {
                    resolve(true);
                };
                script.onerror = function() {
                    reject(new Error('脚本加载失败: ' + src));
                };
                document.head.appendChild(script);
            });
        },

        /**
         * 加载样式（支持热更新）
         */
        loadStyle: async function(href) {
            var hasHotUpdate = await this.checkHotUpdateFile(href);
            
            if (hasHotUpdate) {
                console.log('[资源加载] 使用热更新样式:', href);
                
                try {
                    var content = await this.readHotUpdateFile(href);
                    
                    var style = document.createElement('style');
                    style.textContent = content;
                    style.setAttribute('data-hot-update', 'true');
                    style.setAttribute('data-href', href);
                    document.head.appendChild(style);
                    
                    return true;
                } catch (e) {
                    console.error('[资源加载] 热更新样式加载失败，降级到原始版本:', href, e);
                    return this.loadStyleFallback(href);
                }
            } else {
                return this.loadStyleFallback(href);
            }
        },

        /**
         * 加载原始样式（降级方案）
         */
        loadStyleFallback: function(href) {
            return new Promise(function(resolve, reject) {
                var link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = href;
                link.onload = function() {
                    resolve(true);
                };
                link.onerror = function() {
                    reject(new Error('样式加载失败: ' + href));
                };
                document.head.appendChild(link);
            });
        },

        /**
         * 获取资源 URL（用于 fetch 等场景）
         */
        getResourceUrl: async function(path) {
            var hasHotUpdate = await this.checkHotUpdateFile(path);
            
            if (hasHotUpdate && window.Capacitor && window.Capacitor.Plugins) {
                // 返回热更新路径标记
                return 'capacitor://hot-update/' + path;
            } else {
                // 返回原始路径
                return path;
            }
        },

        /**
         * 清除缓存
         */
        clearCache: function() {
            this.checkedPaths.clear();
            console.log('[资源加载] 缓存已清除');
        }
    };

    console.log('[资源加载] 模块已加载');
})();
