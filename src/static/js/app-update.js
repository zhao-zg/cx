/**
 * APK 内部更新功能
 * 支持应用内下载和安装APK
 */
(function() {
    'use strict';

    // ==================== 公共工具函数 ====================
    
    // 获取 CapacitorHttp（兼容多种访问方式）
    function getCapacitorHttp() {
        if (!window.Capacitor) return null;
        
        // 方式1: Capacitor 6.x (从 core 导出)
        if (window.Capacitor.CapacitorHttp) {
            return window.Capacitor.CapacitorHttp;
        }
        
        // 方式2: 通过 Plugins
        if (window.Capacitor.Plugins) {
            if (window.Capacitor.Plugins.CapacitorHttp) {
                return window.Capacitor.Plugins.CapacitorHttp;
            }
            // 方式3: Http 别名
            if (window.Capacitor.Plugins.Http) {
                return window.Capacitor.Plugins.Http;
            }
        }
        
        return null;
    }
    
    // 使用 CapacitorHttp 下载文件（返回 Blob）
    async function downloadWithCapacitorHttp(url, options) {
        var CapacitorHttp = getCapacitorHttp();
        if (!CapacitorHttp) {
            throw new Error('CapacitorHttp 不可用');
        }
        
        var httpResponse = await CapacitorHttp.get({
            url: url,
            responseType: 'blob',
            connectTimeout: options.connectTimeout || 60000,
            readTimeout: options.readTimeout || 120000,
            headers: options.headers || {}
        });
        
        if (httpResponse.status !== 200 && httpResponse.status !== 206) {
            throw new Error('HTTP ' + httpResponse.status);
        }
        
        // 处理响应数据
        if (httpResponse.data instanceof Blob) {
            return httpResponse.data;
        } else if (typeof httpResponse.data === 'string') {
            // base64 转 Blob
            var binaryString = atob(httpResponse.data);
            var bytes = new Uint8Array(binaryString.length);
            for (var i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            return new Blob([bytes], { type: options.mimeType || 'application/octet-stream' });
        } else {
            throw new Error('未知的响应数据类型');
        }
    }
    
    // 使用镜像站下载（返回 Blob）
    async function downloadWithMirrors(url, mirrors, onProgress) {
        for (var i = 0; i < mirrors.length; i++) {
            try {
                var mirrorUrl = mirrors[i] + url;
                console.log('[下载] 尝试镜像', i + 1, '/', mirrors.length, ':', mirrors[i]);
                
                if (onProgress) {
                    onProgress('尝试镜像 ' + (i + 1) + '/' + mirrors.length + '...', 10 + i * 10);
                }
                
                // 优先使用 CapacitorHttp
                var CapacitorHttp = getCapacitorHttp();
                var blob;
                
                if (CapacitorHttp) {
                    blob = await downloadWithCapacitorHttp(mirrorUrl, {
                        connectTimeout: 30000,
                        readTimeout: 120000
                    });
                } else {
                    // 降级到 fetch
                    var response = await fetch(mirrorUrl, {
                        method: 'GET',
                        cache: 'no-cache'
                    });
                    if (!response.ok) throw new Error('HTTP ' + response.status);
                    blob = await response.blob();
                }
                
                console.log('[下载] 镜像', i + 1, '下载成功，大小:', blob.size, 'bytes');
                return { blob: blob, mirror: mirrors[i] };
                
            } catch (err) {
                console.warn('[下载] 镜像', i + 1, '失败:', err.message);
                if (i === mirrors.length - 1) {
                    throw new Error('所有镜像站都失败');
                }
            }
        }
    }
    
    // Blob 转 base64
    async function blobToBase64(blob, onProgress) {
        var arrayBuffer = await blob.arrayBuffer();
        var bytes = new Uint8Array(arrayBuffer);
        var binary = '';
        var chunkSize = 8192;
        
        for (var i = 0; i < bytes.length; i += chunkSize) {
            var chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
            binary += String.fromCharCode.apply(null, chunk);
            
            if (onProgress && i % (chunkSize * 10) === 0) {
                var progress = Math.round((i / bytes.length) * 100);
                onProgress(progress);
            }
        }
        
        return btoa(binary);
    }
    
    // 保存文件到 Capacitor Filesystem
    async function saveToFilesystem(filepath, base64Data, directory) {
        var Filesystem = window.Capacitor.Plugins.Filesystem;
        if (!Filesystem) {
            throw new Error('Filesystem 插件未加载');
        }
        
        // 确保目录存在
        var dirPath = filepath.substring(0, filepath.lastIndexOf('/'));
        if (dirPath) {
            try {
                await Filesystem.mkdir({
                    path: dirPath,
                    directory: directory,
                    recursive: true
                });
            } catch (e) {
                console.log('[保存] 目录已存在或创建失败:', e.message);
            }
        }
        
        // 写入文件
        var writeResult = await Filesystem.writeFile({
            path: filepath,
            data: base64Data,
            directory: directory,
            recursive: true
        });
        
        console.log('[保存] 文件已保存:', writeResult.uri);
        
        // 获取文件 URI
        var getUriResult = await Filesystem.getUri({
            path: filepath,
            directory: directory
        });
        
        return getUriResult.uri;
    }

    // ==================== AppUpdate 对象 ====================

    const AppUpdate = {
        // 配置
        config: {
            versionUrl: null,
            currentVersion: null,
            mirrors: [
                'https://gh-proxy.com/',
                'https://ghproxy.net/',
                'https://proxy.11891189.xyz/',
                'https://proxy.07170501.xyz/'
            ]
        },

        // 是否在Capacitor环境中
        isCapacitor: false,
        
        // 下载状态
        downloading: false,
        downloadProgress: 0,

        /**
         * 初始化
         */
        init: function() {
            this.isCapacitor = window.Capacitor && window.Capacitor.isNativePlatform();
            
            if (!this.isCapacitor) {
                console.log('[更新] 非原生应用环境');
                return;
            }

            console.log('[更新] 初始化更新模块');
            this.loadConfig();
        },

        /**
         * 加载配置
         */
        loadConfig: function() {
            return fetch('/app_config.json')
                .then(function(response) {
                    return response.json();
                })
                .then(function(config) {
                    this.config.currentVersion = config.version;
                    if (config.remote_urls && config.remote_urls.length > 0) {
                        this.config.versionUrl = config.remote_urls[0] + 'version.json';
                    }
                    console.log('[更新] 当前版本:', this.config.currentVersion);
                }.bind(this))
                .catch(function(error) {
                    console.error('[更新] 加载配置失败:', error);
                }.bind(this));
        },

        /**
         * 比较版本号
         */
        compareVersion: function(v1, v2) {
            if (v1 === '未知' || v2 === '未知') return null;
            
            const parts1 = v1.replace('v', '').split('.').map(function(n) { return parseInt(n) || 0; });
            const parts2 = v2.replace('v', '').split('.').map(function(n) { return parseInt(n) || 0; });
            
            for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
                const p1 = parts1[i] || 0;
                const p2 = parts2[i] || 0;
                
                if (p1 > p2) return 1;
                if (p1 < p2) return -1;
            }
            
            return 0;
        },

        /**
         * 下载 APK（竞速策略或镜像站降级）
         */
        downloadApk: async function(url, onProgress, onComplete, onError) {
            console.log('[APK下载] 开始下载:', url);
            
            if (!window.Capacitor || !window.Capacitor.Plugins) {
                if (onError) onError(new Error('非 Capacitor 环境'));
                return;
            }
            
            var Filesystem = window.Capacitor.Plugins.Filesystem;
            if (!Filesystem) {
                if (onError) onError(new Error('Filesystem 插件未加载'));
                return;
            }
            
            var CapacitorHttp = getCapacitorHttp();
            var filename = url.split('/').pop();
            var filepath = 'downloads/' + filename;
            
            try {
                var blob, sourceName;
                
                // 如果 CapacitorHttp 可用，使用竞速下载
                if (CapacitorHttp) {
                    console.log('[APK下载] 使用竞速策略');
                    if (onProgress) onProgress('正在测速选择最快线路...', 0);
                    
                    // 构建所有下载源
                    var downloadSources = [{ name: 'GitHub 直连', url: url }];
                    this.config.mirrors.forEach(function(mirror, index) {
                        downloadSources.push({ name: '镜像站 ' + (index + 1), url: mirror + url });
                    });
                    
                    if (onProgress) onProgress('正在测试 ' + downloadSources.length + ' 个下载源...', 5);
                    
                    // 竞速测试
                    var testResults = await Promise.allSettled(
                        downloadSources.map(function(source) {
                            return new Promise(function(resolve, reject) {
                                var startTime = Date.now();
                                CapacitorHttp.get({
                                    url: source.url,
                                    headers: { 'Range': 'bytes=0-1023' },
                                    connectTimeout: 10000,
                                    readTimeout: 10000
                                }).then(function(response) {
                                    var responseTime = Date.now() - startTime;
                                    if (response.status === 200 || response.status === 206) {
                                        console.log('[APK下载]', source.name, '响应时间:', responseTime, 'ms');
                                        resolve({ source: source, responseTime: responseTime });
                                    } else {
                                        reject(new Error('HTTP ' + response.status));
                                    }
                                }).catch(reject);
                            });
                        })
                    );
                    
                    // 找出最快的源
                    var fastestSource = null;
                    var fastestTime = Infinity;
                    testResults.forEach(function(result) {
                        if (result.status === 'fulfilled' && result.value.responseTime < fastestTime) {
                            fastestTime = result.value.responseTime;
                            fastestSource = result.value.source;
                        }
                    });
                    
                    if (!fastestSource) {
                        throw new Error('所有下载源都不可用');
                    }
                    
                    console.log('[APK下载] 选择最快源:', fastestSource.name);
                    if (onProgress) onProgress('使用 ' + fastestSource.name + ' 下载...', 10);
                    
                    blob = await downloadWithCapacitorHttp(fastestSource.url, {
                        connectTimeout: 60000,
                        readTimeout: 300000,
                        mimeType: 'application/vnd.android.package-archive'
                    });
                    sourceName = fastestSource.name;
                    
                } else {
                    // 降级到镜像站
                    console.log('[APK下载] CapacitorHttp 不可用，使用镜像站');
                    if (onProgress) onProgress('准备使用镜像站下载...', 0);
                    
                    var result = await downloadWithMirrors(url, this.config.mirrors, onProgress);
                    blob = result.blob;
                    sourceName = result.mirror;
                }
                
                console.log('[APK下载] 下载完成，大小:', blob.size, 'bytes');
                if (onProgress) onProgress('下载完成，正在保存...', 80);
                
                // 转换并保存
                var base64 = await blobToBase64(blob, function(progress) {
                    if (onProgress) onProgress('正在处理文件...', 80 + Math.round(progress * 0.1));
                });
                
                if (onProgress) onProgress('正在保存到本地...', 90);
                var fileUri = await saveToFilesystem(filepath, base64, 'CACHE');
                
                if (onProgress) onProgress('准备安装...', 95);
                
                // 打开安装程序
                if (window.Capacitor.Plugins.FileOpener) {
                    await window.Capacitor.Plugins.FileOpener.open({
                        filePath: fileUri,
                        contentType: 'application/vnd.android.package-archive'
                    });
                } else if (window.Capacitor.Plugins.Browser) {
                    await window.Capacitor.Plugins.Browser.open({ url: fileUri });
                }
                
                if (onProgress) onProgress('下载完成！', 100);
                if (onComplete) onComplete(sourceName);
                
            } catch (error) {
                console.error('[APK下载] 失败:', error);
                if (onError) onError(error);
            }
        }
    };

    // 页面加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            AppUpdate.init();
        });
    } else {
        AppUpdate.init();
    }

    // 导出到全局
    window.AppUpdate = AppUpdate;

})();
