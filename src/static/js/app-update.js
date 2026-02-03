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
        if (window.Capacitor.CapacitorHttp) return window.Capacitor.CapacitorHttp;
        if (window.Capacitor.Plugins) {
            if (window.Capacitor.Plugins.CapacitorHttp) return window.Capacitor.Plugins.CapacitorHttp;
            if (window.Capacitor.Plugins.Http) return window.Capacitor.Plugins.Http;
        }
        return null;
    }
    
    // 使用 CapacitorHttp 下载文件（返回 Blob）
    async function downloadWithCapacitorHttp(url, options) {
        var CapacitorHttp = getCapacitorHttp();
        if (!CapacitorHttp) throw new Error('CapacitorHttp 不可用');
        
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
        
        if (httpResponse.data instanceof Blob) return httpResponse.data;
        if (typeof httpResponse.data === 'string') {
            var binaryString = atob(httpResponse.data);
            var bytes = new Uint8Array(binaryString.length);
            for (var i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            return new Blob([bytes], { type: options.mimeType || 'application/octet-stream' });
        }
        throw new Error('未知的响应数据类型');
    }
    
    // 分块下载文件（公共函数）
    async function downloadFileInChunks(downloadUrl, onProgress) {
        var CapacitorHttp = getCapacitorHttp();
        if (!CapacitorHttp) throw new Error('CapacitorHttp 不可用');
        
        // 获取文件大小
        var contentLength = 0;
        try {
            var sizeResponse = await CapacitorHttp.get({
                url: downloadUrl,
                headers: { 'Range': 'bytes=0-0' },
                connectTimeout: 10000,
                readTimeout: 10000
            });
            var contentRange = sizeResponse.headers['content-range'] || sizeResponse.headers['Content-Range'];
            if (contentRange) {
                var match = contentRange.match(/\/(\d+)/);
                if (match) {
                    contentLength = parseInt(match[1]);
                    console.log('[APK下载] 文件大小:', (contentLength / 1024 / 1024).toFixed(2), 'MB');
                }
            }
        } catch (e) {
            console.warn('[APK下载] 无法获取文件大小:', e.message);
        }
        
        var chunkSize = 1024 * 1024; // 1MB
        var downloadedBytes = 0;
        
        if (contentLength > 0 && contentLength > chunkSize) {
            // 大文件分块下载
            var chunks = [];
            var numChunks = Math.ceil(contentLength / chunkSize);
            var lastUpdateTime = Date.now();
            var lastDownloadedBytes = 0;
            
            console.log('[APK下载] 分', numChunks, '块下载');
            
            for (var i = 0; i < numChunks; i++) {
                var start = i * chunkSize;
                var end = Math.min(start + chunkSize - 1, contentLength - 1);
                
                var chunkResponse = await CapacitorHttp.get({
                    url: downloadUrl,
                    headers: { 'Range': 'bytes=' + start + '-' + end },
                    responseType: 'blob',
                    connectTimeout: 30000,
                    readTimeout: 60000
                });
                
                if (chunkResponse.status !== 200 && chunkResponse.status !== 206) {
                    throw new Error('分块下载失败: HTTP ' + chunkResponse.status);
                }
                
                var chunkBlob;
                if (chunkResponse.data instanceof Blob) {
                    chunkBlob = chunkResponse.data;
                } else if (typeof chunkResponse.data === 'string') {
                    var binaryString = atob(chunkResponse.data);
                    var bytes = new Uint8Array(binaryString.length);
                    for (var j = 0; j < binaryString.length; j++) {
                        bytes[j] = binaryString.charCodeAt(j);
                    }
                    chunkBlob = new Blob([bytes]);
                } else {
                    throw new Error('未知的响应数据类型');
                }
                
                chunks.push(chunkBlob);
                downloadedBytes += chunkBlob.size;
                
                // 更新进度
                if (onProgress) {
                    var now = Date.now();
                    var progress = 10 + Math.round((downloadedBytes / contentLength) * 70);
                    var downloadedMB = (downloadedBytes / 1024 / 1024).toFixed(2);
                    var totalMB = (contentLength / 1024 / 1024).toFixed(2);
                    var timeDiff = (now - lastUpdateTime) / 1000;
                    var bytesDiff = downloadedBytes - lastDownloadedBytes;
                    var speed = timeDiff > 0 ? Math.round(bytesDiff / 1024 / timeDiff) : 0;
                    
                    onProgress('下载中: ' + downloadedMB + ' / ' + totalMB + ' MB', progress, speed, downloadedBytes);
                    lastUpdateTime = now;
                    lastDownloadedBytes = downloadedBytes;
                }
            }
            
            return { blob: new Blob(chunks, { type: 'application/vnd.android.package-archive' }), size: downloadedBytes };
        } else {
            // 小文件直接下载
            if (onProgress) onProgress('下载中...', 30, 0, 0);
            var blob = await downloadWithCapacitorHttp(downloadUrl, {
                connectTimeout: 60000,
                readTimeout: 300000,
                mimeType: 'application/vnd.android.package-archive'
            });
            return { blob: blob, size: blob.size };
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
                onProgress(Math.round((i / bytes.length) * 100));
            }
        }
        return btoa(binary);
    }
    
    // 保存文件到 Capacitor Filesystem
    async function saveToFilesystem(filepath, base64Data, directory) {
        var Filesystem = window.Capacitor.Plugins.Filesystem;
        if (!Filesystem) throw new Error('Filesystem 插件未加载');
        
        var dirPath = filepath.substring(0, filepath.lastIndexOf('/'));
        if (dirPath) {
            try {
                await Filesystem.mkdir({ path: dirPath, directory: directory, recursive: true });
            } catch (e) { }
        }
        
        await Filesystem.writeFile({ path: filepath, data: base64Data, directory: directory, recursive: true });
        var getUriResult = await Filesystem.getUri({ path: filepath, directory: directory });
        return getUriResult.uri;
    }

    // ==================== AppUpdate 对象 ====================

    const AppUpdate = {
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
        isCapacitor: false,

        init: function() {
            this.isCapacitor = window.Capacitor && window.Capacitor.isNativePlatform();
            if (!this.isCapacitor) return;
            console.log('[更新] 初始化更新模块');
            this.loadConfig();
        },

        loadConfig: function() {
            return fetch('/app_config.json')
                .then(function(response) { return response.json(); })
                .then(function(config) {
                    this.config.currentVersion = config.version;
                    if (config.remote_urls && config.remote_urls.length > 0) {
                        this.config.versionUrl = config.remote_urls[0] + 'version.json';
                    }
                    console.log('[更新] 当前版本:', this.config.currentVersion);
                }.bind(this))
                .catch(function(error) { console.error('[更新] 加载配置失败:', error); });
        },

        compareVersion: function(v1, v2) {
            if (v1 === '未知' || v2 === '未知') return null;
            var parts1 = v1.replace('v', '').split('.').map(function(n) { return parseInt(n) || 0; });
            var parts2 = v2.replace('v', '').split('.').map(function(n) { return parseInt(n) || 0; });
            for (var i = 0; i < Math.max(parts1.length, parts2.length); i++) {
                var p1 = parts1[i] || 0, p2 = parts2[i] || 0;
                if (p1 > p2) return 1;
                if (p1 < p2) return -1;
            }
            return 0;
        },

        downloadApk: async function(url, onProgress, onComplete, onError) {
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
            var saveAttempts = [
                { dir: 'EXTERNAL', path: 'Download/' + filename, name: 'Download 目录' },
                { dir: 'CACHE', path: 'downloads/' + filename, name: '缓存目录' },
                { dir: 'DATA', path: 'downloads/' + filename, name: '数据目录' }
            ];
            
            try {
                var blob, sourceName, downloadUrl;
                var startDownloadTime = Date.now();
                var isGitHubUrl = url.indexOf('github.com') !== -1 || url.indexOf('githubusercontent.com') !== -1;
                
                if (CapacitorHttp) {
                    if (isGitHubUrl) {
                        // GitHub URL：测速选择最快线路
                        console.log('[APK下载] GitHub URL，使用快速测速策略');
                        if (onProgress) onProgress('正在测速选择最快线路...', 0, 0, 0);
                        
                        var downloadSources = [{ name: 'GitHub 直连', url: url }];
                        this.config.mirrors.forEach(function(mirror, index) {
                            downloadSources.push({ name: '镜像 ' + (index + 1), url: mirror + url });
                        });
                        
                        // 竞速测速
                        var testPromises = downloadSources.map(function(source) {
                            return new Promise(function(resolve) {
                                var startTime = Date.now();
                                var timeout = setTimeout(function() {
                                    resolve({ source: source, responseTime: Infinity, success: false });
                                }, 5000);
                                
                                CapacitorHttp.get({
                                    url: source.url,
                                    headers: { 'Range': 'bytes=0-102399' },
                                    connectTimeout: 5000,
                                    readTimeout: 5000
                                }).then(function(response) {
                                    clearTimeout(timeout);
                                    var responseTime = Date.now() - startTime;
                                    if (response.status === 200 || response.status === 206) {
                                        console.log('[测速]', source.name, ':', responseTime, 'ms');
                                        resolve({ source: source, responseTime: responseTime, success: true });
                                    } else {
                                        resolve({ source: source, responseTime: Infinity, success: false });
                                    }
                                }).catch(function() {
                                    clearTimeout(timeout);
                                    resolve({ source: source, responseTime: Infinity, success: false });
                                });
                            });
                        });
                        
                        // 等待最快的源
                        var fastestSource = null, fastestTime = Infinity;
                        var racePromise = Promise.race(testPromises.map(function(p) {
                            return p.then(function(r) { return r.success ? r : new Promise(function(){}); });
                        }));
                        
                        var quickResult = await Promise.race([
                            racePromise,
                            new Promise(function(resolve) { setTimeout(function() { resolve(null); }, 2000); })
                        ]);
                        
                        if (quickResult && quickResult.success) {
                            fastestSource = quickResult.source;
                            fastestTime = quickResult.responseTime;
                        } else {
                            var testResults = await Promise.all(testPromises);
                            testResults.forEach(function(r) {
                                if (r.success && r.responseTime < fastestTime) {
                                    fastestTime = r.responseTime;
                                    fastestSource = r.source;
                                }
                            });
                        }
                        
                        if (!fastestSource) throw new Error('所有下载源都不可用');
                        
                        console.log('[APK下载] 选择:', fastestSource.name, '(', fastestTime, 'ms)');
                        sourceName = fastestSource.name;
                        downloadUrl = fastestSource.url;
                    } else {
                        // 非 GitHub URL（如 Cloudflare），直接下载
                        console.log('[APK下载] 直接下载:', url);
                        sourceName = 'Cloudflare';
                        downloadUrl = url;
                    }
                    
                    if (onProgress) onProgress('使用 ' + sourceName + ' 下载中...', 10, 0, 0);
                    var result = await downloadFileInChunks(downloadUrl, onProgress);
                    blob = result.blob;
                    
                    var downloadTime = ((Date.now() - startDownloadTime) / 1000).toFixed(1);
                    console.log('[APK下载] 下载完成:', (result.size / 1024 / 1024).toFixed(2), 'MB, 耗时:', downloadTime, 's');
                    
                } else {
                    // 降级到镜像站
                    console.log('[APK下载] CapacitorHttp 不可用，使用镜像站');
                    if (onProgress) onProgress('准备使用镜像站下载...', 0, 0, 0);
                    
                    for (var i = 0; i < this.config.mirrors.length; i++) {
                        try {
                            var mirrorUrl = this.config.mirrors[i] + url;
                            var response = await fetch(mirrorUrl, { method: 'GET', cache: 'no-cache' });
                            if (!response.ok) throw new Error('HTTP ' + response.status);
                            blob = await response.blob();
                            sourceName = '镜像 ' + (i + 1);
                            break;
                        } catch (e) {
                            if (i === this.config.mirrors.length - 1) throw new Error('所有镜像站都失败');
                        }
                    }
                }
                
                if (onProgress) onProgress('下载完成，正在保存...', 80, 0, blob.size);
                
                var base64 = await blobToBase64(blob, function(progress) {
                    if (onProgress) onProgress('正在处理文件 (' + progress + '%)...', 80 + Math.round(progress * 0.1), 0, blob.size);
                });
                
                if (onProgress) onProgress('正在保存到本地...', 90, 0, blob.size);
                
                var fileUri = null, savedDir = null;
                for (var i = 0; i < saveAttempts.length; i++) {
                    try {
                        fileUri = await saveToFilesystem(saveAttempts[i].path, base64, saveAttempts[i].dir);
                        savedDir = saveAttempts[i].name;
                        console.log('[APK下载] 文件已保存到:', savedDir, fileUri);
                        break;
                    } catch (e) {
                        if (i === saveAttempts.length - 1) throw new Error('无法保存文件: ' + e.message);
                    }
                }
                
                if (!fileUri) throw new Error('文件保存失败');
                
                if (onProgress) onProgress('准备安装...', 95, 0, blob.size);
                
                // 安装 APK
                var installed = false;
                var ApkInstaller = window.Capacitor.Plugins && window.Capacitor.Plugins.ApkInstaller;
                
                if (ApkInstaller) {
                    try {
                        if (onProgress) onProgress('打开安装程序...', 98, 0, blob.size);
                        await ApkInstaller.install({ filePath: fileUri });
                        installed = true;
                    } catch (e) {
                        console.error('[APK安装] ApkInstaller 失败:', e);
                    }
                }
                
                if (!installed && window.Capacitor.Plugins.Share) {
                    try {
                        if (onProgress) onProgress('打开系统选择器...', 99, 0, blob.size);
                        await window.Capacitor.Plugins.Share.share({
                            title: '安装 APK',
                            text: '请选择"包安装程序"',
                            url: fileUri,
                            dialogTitle: '选择安装程序'
                        });
                        installed = true;
                    } catch (e) {
                        console.error('[APK安装] Share 失败:', e);
                    }
                }
                
                if (!installed) {
                    alert('无法自动打开安装器\n\n文件已下载到: ' + savedDir + '\n文件: ' + filename + '\n\n请手动到文件管理器安装');
                }
                
                if (onProgress) onProgress('完成', 100, 0, blob.size);
                if (onComplete) onComplete(sourceName);
                
            } catch (error) {
                console.error('[APK下载] 失败:', error);
                if (onError) onError(error);
            }
        }
    };

    // 初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { AppUpdate.init(); });
    } else {
        AppUpdate.init();
    }

    window.AppUpdate = AppUpdate;
})();
