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
         * 下载 APK（优化版：快速测速 + 实时进度 + 正确安装）
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
            var DIRECTORY_CACHE = 'CACHE';
            
            try {
                var blob, sourceName, downloadUrl;
                var startDownloadTime = Date.now();
                
                // 如果 CapacitorHttp 可用，使用快速测速
                if (CapacitorHttp) {
                    console.log('[APK下载] 使用快速测速策略');
                    if (onProgress) onProgress('正在测速选择最快线路...', 0, 0, 0);
                    
                    // 构建所有下载源
                    var downloadSources = [{ name: 'GitHub 直连', url: url }];
                    this.config.mirrors.forEach(function(mirror, index) {
                        downloadSources.push({ 
                            name: '镜像 ' + (index + 1), 
                            url: mirror + url 
                        });
                    });
                    
                    // 快速测速：只测试前 1KB，超时 3 秒
                    var testPromises = downloadSources.map(function(source) {
                        return new Promise(function(resolve) {
                            var startTime = Date.now();
                            var timeout = setTimeout(function() {
                                resolve({ source: source, responseTime: Infinity, success: false });
                            }, 3000);
                            
                            CapacitorHttp.get({
                                url: source.url,
                                headers: { 'Range': 'bytes=0-1023' },
                                connectTimeout: 3000,
                                readTimeout: 3000
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
                    
                    var testResults = await Promise.all(testPromises);
                    
                    // 找出最快的可用源
                    var fastestSource = null;
                    var fastestTime = Infinity;
                    testResults.forEach(function(result) {
                        if (result.success && result.responseTime < fastestTime) {
                            fastestTime = result.responseTime;
                            fastestSource = result.source;
                        }
                    });
                    
                    if (!fastestSource) {
                        throw new Error('所有下载源都不可用');
                    }
                    
                    console.log('[APK下载] 选择最快源:', fastestSource.name, '(', fastestTime, 'ms)');
                    sourceName = fastestSource.name;
                    downloadUrl = fastestSource.url;
                    
                    // 使用 CapacitorHttp 下载（避免跨域问题）
                    if (onProgress) onProgress('使用 ' + sourceName + ' 下载中...', 10, 0, 0);
                    
                    // 先获取文件大小
                    var headResponse = await CapacitorHttp.head({
                        url: downloadUrl,
                        connectTimeout: 10000,
                        readTimeout: 10000
                    });
                    
                    var contentLength = parseInt(headResponse.headers['content-length'] || headResponse.headers['Content-Length'] || '0');
                    console.log('[APK下载] 文件大小:', (contentLength / 1024 / 1024).toFixed(2), 'MB');
                    
                    // 分块下载以显示进度（每块 1MB）
                    var chunkSize = 1024 * 1024; // 1MB
                    var chunks = [];
                    var downloadedBytes = 0;
                    var lastUpdateTime = Date.now();
                    var lastDownloadedBytes = 0;
                    
                    if (contentLength > 0 && contentLength > chunkSize) {
                        // 大文件分块下载
                        var numChunks = Math.ceil(contentLength / chunkSize);
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
                            
                            // 处理响应数据
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
                            var now = Date.now();
                            var progress = 10 + Math.round((downloadedBytes / contentLength) * 70);
                            var downloadedMB = (downloadedBytes / 1024 / 1024).toFixed(2);
                            var totalMB = (contentLength / 1024 / 1024).toFixed(2);
                            
                            // 计算速度
                            var timeDiff = (now - lastUpdateTime) / 1000;
                            var bytesDiff = downloadedBytes - lastDownloadedBytes;
                            var speed = timeDiff > 0 ? Math.round(bytesDiff / 1024 / timeDiff) : 0;
                            
                            if (onProgress) {
                                onProgress(
                                    '下载中: ' + downloadedMB + ' / ' + totalMB + ' MB',
                                    progress,
                                    speed,
                                    downloadedBytes
                                );
                            }
                            
                            lastUpdateTime = now;
                            lastDownloadedBytes = downloadedBytes;
                        }
                        
                        // 合并所有块
                        blob = new Blob(chunks, { type: 'application/vnd.android.package-archive' });
                        
                    } else {
                        // 小文件或无法获取大小，直接下载
                        if (onProgress) onProgress('下载中...', 30, 0, 0);
                        
                        blob = await downloadWithCapacitorHttp(downloadUrl, {
                            connectTimeout: 60000,
                            readTimeout: 300000,
                            mimeType: 'application/vnd.android.package-archive'
                        });
                        
                        downloadedBytes = blob.size;
                    }
                    
                    var downloadTime = ((Date.now() - startDownloadTime) / 1000).toFixed(1);
                    var avgSpeed = Math.round(downloadedBytes / 1024 / (Date.now() - startDownloadTime) * 1000);
                    console.log('[APK下载] 下载完成:', (downloadedBytes / 1024 / 1024).toFixed(2), 'MB, 耗时:', downloadTime, 's, 平均速度:', avgSpeed, 'KB/s');
                    
                } else {
                    // 降级到镜像站
                    console.log('[APK下载] CapacitorHttp 不可用，使用镜像站');
                    if (onProgress) onProgress('准备使用镜像站下载...', 0, 0, 0);
                    
                    var result = await downloadWithMirrors(url, this.config.mirrors, onProgress);
                    blob = result.blob;
                    sourceName = result.mirror;
                    downloadUrl = result.mirror + url;
                }
                
                if (onProgress) onProgress('下载完成，正在保存...', 80, 0, blob.size);
                
                // 转换为 base64
                var base64 = await blobToBase64(blob, function(progress) {
                    if (onProgress) onProgress('正在处理文件 (' + progress + '%)...', 80 + Math.round(progress * 0.1), 0, blob.size);
                });
                
                if (onProgress) onProgress('正在保存到本地...', 90, 0, blob.size);
                
                // 保存文件
                var fileUri = await saveToFilesystem(filepath, base64, DIRECTORY_CACHE);
                console.log('[APK下载] 文件已保存:', fileUri);
                
                if (onProgress) onProgress('准备安装...', 95, 0, blob.size);
                
                // 检查并请求安装权限（Android 8.0+）
                var hasInstallPermission = true;
                if (window.Capacitor.Plugins.Device) {
                    try {
                        var deviceInfo = await window.Capacitor.Plugins.Device.getInfo();
                        var androidVersion = parseInt(deviceInfo.osVersion);
                        
                        // Android 8.0 (API 26) 及以上需要 REQUEST_INSTALL_PACKAGES 权限
                        if (androidVersion >= 8) {
                            console.log('[APK安装] Android', androidVersion, '需要检查安装权限');
                            
                            if (onProgress) onProgress('检查安装权限...', 96, 0, blob.size);
                            
                            // 尝试检查权限（需要自定义插件，这里先跳过）
                            // 如果没有权限，系统会在打开安装程序时自动提示
                        }
                    } catch (e) {
                        console.warn('[APK安装] 无法获取设备信息:', e);
                    }
                }
                
                if (onProgress) onProgress('准备打开安装程序...', 97, 0, blob.size);
                
                // 提示用户即将打开安装程序
                console.log('[APK安装] 文件路径:', fileUri);
                console.log('[APK安装] 文件名:', filename);
                console.log('[APK安装] 文件大小:', (blob.size / 1024 / 1024).toFixed(2), 'MB');
                
                // 安装 APK - 尝试多种方法
                var installed = false;
                var installError = null;
                
                // 方法1: 使用 FileOpener 插件（推荐）
                if (window.Capacitor.Plugins.FileOpener) {
                    try {
                        console.log('[APK安装] 尝试方法1: FileOpener 插件');
                        if (onProgress) onProgress('打开安装程序...', 97, 0, blob.size);
                        
                        await window.Capacitor.Plugins.FileOpener.open({
                            filePath: fileUri,
                            contentType: 'application/vnd.android.package-archive',
                            openWithDefault: true
                        });
                        installed = true;
                        console.log('[APK安装] FileOpener 成功');
                    } catch (e) {
                        installError = e;
                        console.warn('[APK安装] FileOpener 失败:', e.message);
                    }
                }
                
                // 方法2: 使用 Browser 插件
                if (!installed && window.Capacitor.Plugins.Browser) {
                    try {
                        console.log('[APK安装] 尝试方法2: Browser 插件');
                        if (onProgress) onProgress('打开安装程序...', 98, 0, blob.size);
                        
                        await window.Capacitor.Plugins.Browser.open({ 
                            url: fileUri,
                            presentationStyle: 'fullscreen'
                        });
                        installed = true;
                        console.log('[APK安装] Browser 成功');
                    } catch (e) {
                        installError = e;
                        console.warn('[APK安装] Browser 失败:', e.message);
                    }
                }
                
                // 方法3: 使用 App 插件
                if (!installed && window.Capacitor.Plugins.App) {
                    try {
                        console.log('[APK安装] 尝试方法3: App.openUrl');
                        if (onProgress) onProgress('打开安装程序...', 99, 0, blob.size);
                        
                        await window.Capacitor.Plugins.App.openUrl({ url: fileUri });
                        installed = true;
                        console.log('[APK安装] App.openUrl 成功');
                    } catch (e) {
                        installError = e;
                        console.warn('[APK安装] App.openUrl 失败:', e.message);
                    }
                }
                
                // 方法4: 使用 WebView 打开（最后的尝试）
                if (!installed) {
                    try {
                        console.log('[APK安装] 尝试方法4: window.open');
                        window.open(fileUri, '_system');
                        installed = true;
                        console.log('[APK安装] window.open 已调用');
                    } catch (e) {
                        installError = e;
                        console.warn('[APK安装] window.open 失败:', e.message);
                    }
                }
                
                if (installed) {
                    if (onProgress) onProgress('安装程序已打开！', 100, 0, blob.size);
                    if (onComplete) onComplete(sourceName);
                } else {
                    // 所有方法都失败，提供手动安装指引
                    var errorMsg = '无法自动打开安装程序\n\n';
                    errorMsg += '文件已保存到:\n' + fileUri + '\n\n';
                    errorMsg += '请手动安装:\n';
                    errorMsg += '1. 打开文件管理器\n';
                    errorMsg += '2. 进入 Downloads 目录\n';
                    errorMsg += '3. 找到 ' + filename + '\n';
                    errorMsg += '4. 点击安装\n\n';
                    
                    if (installError) {
                        errorMsg += '错误详情: ' + installError.message;
                    }
                    
                    throw new Error(errorMsg);
                }
                
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
