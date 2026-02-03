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
            alert('[调试] 开始下载 APK');
            
            if (!window.Capacitor || !window.Capacitor.Plugins) {
                alert('[错误] 非 Capacitor 环境');
                if (onError) onError(new Error('非 Capacitor 环境'));
                return;
            }
            
            var Filesystem = window.Capacitor.Plugins.Filesystem;
            if (!Filesystem) {
                alert('[错误] Filesystem 插件未加载');
                if (onError) onError(new Error('Filesystem 插件未加载'));
                return;
            }
            
            // 先请求存储权限
            try {
                alert('[调试] 开始检查存储权限');
                
                // 尝试使用 Capacitor 5+ 的权限 API
                if (window.Capacitor.Plugins.Permissions) {
                    try {
                        var permResult = await window.Capacitor.Plugins.Permissions.query({ name: 'storage' });
                        alert('[调试] 权限状态: ' + permResult.state);
                        
                        if (permResult.state !== 'granted') {
                            alert('需要存储权限才能下载 APK\n\n请在下一步允许存储权限');
                            var requestResult = await window.Capacitor.Plugins.Permissions.request({ name: 'storage' });
                            alert('[调试] 权限请求结果: ' + requestResult.state);
                            
                            if (requestResult.state !== 'granted') {
                                throw new Error('用户拒绝了存储权限');
                            }
                        }
                    } catch (e) {
                        alert('[警告] 权限 API 调用失败:\n' + e.message);
                    }
                } else {
                    alert('[提示] 没有权限 API，跳过权限检查');
                }
            } catch (e) {
                alert('[警告] 权限检查失败:\n' + e.message);
            }
            
            var CapacitorHttp = getCapacitorHttp();
            var filename = url.split('/').pop();
            
            // 尝试多个保存位置
            var saveAttempts = [
                { dir: 'EXTERNAL', path: 'Download/' + filename, name: 'Download 目录' },
                { dir: 'CACHE', path: 'downloads/' + filename, name: '缓存目录' },
                { dir: 'DATA', path: 'downloads/' + filename, name: '数据目录' }
            ];
            
            var savedLocation = null;
            
            alert('[调试] 准备下载，文件名: ' + filename);
            
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
                    
                    // 竞速测速：谁先完成就用谁（最快 1-2 秒）
                    var testPromises = downloadSources.map(function(source) {
                        return new Promise(function(resolve) {
                            var startTime = Date.now();
                            var timeout = setTimeout(function() {
                                resolve({ source: source, responseTime: Infinity, speed: 0, success: false });
                            }, 5000);
                            
                            CapacitorHttp.get({
                                url: source.url,
                                headers: { 'Range': 'bytes=0-102399' }, // 前 100KB
                                connectTimeout: 5000,
                                readTimeout: 5000
                            }).then(function(response) {
                                clearTimeout(timeout);
                                var responseTime = Date.now() - startTime;
                                if (response.status === 200 || response.status === 206) {
                                    // 计算速度 (KB/s)
                                    var speed = Math.round(102400 / 1024 / (responseTime / 1000));
                                    console.log('[测速]', source.name, ':', responseTime, 'ms,', speed, 'KB/s');
                                    resolve({ source: source, responseTime: responseTime, speed: speed, success: true });
                                } else {
                                    resolve({ source: source, responseTime: Infinity, speed: 0, success: false });
                                }
                            }).catch(function() {
                                clearTimeout(timeout);
                                resolve({ source: source, responseTime: Infinity, speed: 0, success: false });
                            });
                        });
                    });
                    
                    // 竞速：使用 Promise.race 获取第一个成功的源
                    var fastestSource = null;
                    var fastestTime = Infinity;
                    
                    // 等待第一个成功的结果
                    var racePromise = Promise.race(
                        testPromises.map(function(p) {
                            return p.then(function(result) {
                                if (result.success) {
                                    return result;
                                } else {
                                    return new Promise(function() {}); // 永不resolve，让其他继续竞争
                                }
                            });
                        })
                    );
                    
                    // 设置 2 秒超时，如果 2 秒内没有任何源成功，则等待所有结果
                    var quickResult = await Promise.race([
                        racePromise,
                        new Promise(function(resolve) {
                            setTimeout(function() {
                                resolve(null);
                            }, 2000);
                        })
                    ]);
                    
                    if (quickResult && quickResult.success) {
                        // 2 秒内有源成功，直接使用
                        fastestSource = quickResult.source;
                        fastestTime = quickResult.responseTime;
                        console.log('[APK下载] 快速选择:', fastestSource.name, '(', fastestTime, 'ms)');
                    } else {
                        // 2 秒内没有成功，等待所有结果并选择最快的
                        console.log('[APK下载] 等待所有测速结果...');
                        var testResults = await Promise.all(testPromises);
                        
                        testResults.forEach(function(result) {
                            if (result.success && result.responseTime < fastestTime) {
                                fastestTime = result.responseTime;
                                fastestSource = result.source;
                            }
                        });
                    }
                    
                    if (!fastestSource) {
                        throw new Error('所有下载源都不可用');
                    }
                    
                    console.log('[APK下载] 选择最快源:', fastestSource.name, '(', fastestTime, 'ms)');
                    sourceName = fastestSource.name;
                    downloadUrl = fastestSource.url;
                    
                    // 使用 CapacitorHttp 下载（避免跨域问题）
                    if (onProgress) onProgress('使用 ' + sourceName + ' 下载中...', 10, 0, 0);
                    
                    // 先获取文件大小（使用 Range 请求前 1 字节）
                    var contentLength = 0;
                    try {
                        var sizeResponse = await CapacitorHttp.get({
                            url: downloadUrl,
                            headers: { 'Range': 'bytes=0-0' },
                            connectTimeout: 10000,
                            readTimeout: 10000
                        });
                        
                        // 从 Content-Range 头获取总大小
                        var contentRange = sizeResponse.headers['content-range'] || sizeResponse.headers['Content-Range'];
                        if (contentRange) {
                            // Content-Range: bytes 0-0/12345678
                            var match = contentRange.match(/\/(\d+)/);
                            if (match) {
                                contentLength = parseInt(match[1]);
                                console.log('[APK下载] 文件大小:', (contentLength / 1024 / 1024).toFixed(2), 'MB');
                            }
                        }
                    } catch (e) {
                        console.warn('[APK下载] 无法获取文件大小:', e.message);
                    }
                    
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
                
                // 尝试保存到多个位置
                var fileUri = null;
                var savedDir = null;
                
                alert('[调试] 开始尝试保存文件');
                
                for (var i = 0; i < saveAttempts.length; i++) {
                    try {
                        alert('[调试] 尝试保存到: ' + saveAttempts[i].name + '\n目录: ' + saveAttempts[i].dir + '\n路径: ' + saveAttempts[i].path);
                        fileUri = await saveToFilesystem(saveAttempts[i].path, base64, saveAttempts[i].dir);
                        savedDir = saveAttempts[i].name;
                        alert('[成功] 文件已保存！\n\n位置: ' + saveAttempts[i].name + '\n路径: ' + fileUri);
                        break;
                    } catch (e) {
                        alert('[失败] 保存到 ' + saveAttempts[i].name + ' 失败\n\n错误: ' + e.message);
                        if (i === saveAttempts.length - 1) {
                            // 所有位置都失败
                            throw new Error('无法保存文件到任何位置\n\n最后错误: ' + e.message);
                        }
                    }
                }
                
                if (!fileUri) {
                    throw new Error('文件保存失败，未获得文件路径');
                }
                
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
                var installMsg = '[准备安装]\n\n';
                installMsg += '文件: ' + filename + '\n';
                installMsg += '位置: ' + savedDir + '\n';
                installMsg += '大小: ' + (blob.size / 1024 / 1024).toFixed(2) + ' MB\n';
                installMsg += '路径: ' + fileUri + '\n\n';
                installMsg += '即将尝试打开安装程序...';
                alert(installMsg);
                
                // 安装 APK - 使用自定义插件
                var installed = false;
                var installError = null;
                
                alert('[调试] 文件路径:\n' + fileUri + '\n\n准备打开安装程序...');
                
                // 方法1: 使用自定义 ApkInstaller 插件（最可靠）
                if (window.Capacitor.Plugins.ApkInstaller) {
                    try {
                        alert('[调试] 尝试方法1: ApkInstaller 插件');
                        if (onProgress) onProgress('打开安装程序...', 98, 0, blob.size);
                        
                        var result = await window.Capacitor.Plugins.ApkInstaller.install({
                            filePath: fileUri
                        });
                        
                        installed = true;
                        alert('[成功] 安装程序已打开！\n\n' + result.message);
                    } catch (e) {
                        installError = e;
                        alert('[失败] ApkInstaller 失败:\n' + e.message);
                    }
                } else {
                    alert('[提示] ApkInstaller 插件不可用\n\n将尝试其他方法...');
                }
                
                // 方法2: 尝试直接跳转（降级方案）
                if (!installed) {
                    try {
                        alert('[调试] 尝试方法2: 直接跳转');
                        if (onProgress) onProgress('打开安装程序...', 99, 0, blob.size);
                        
                        window.location.href = fileUri;
                        installed = true;
                        
                        await new Promise(function(resolve) { setTimeout(resolve, 1000); });
                    } catch (e) {
                        installError = e;
                        alert('[失败] 方法2 失败:\n' + e.message);
                    }
                }
                
                // 保底方案：显示详细的手动安装指引
                if (!installed || installError) {
                    // 尝试复制文件路径到剪贴板
                    var pathCopied = false;
                    try {
                        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Clipboard) {
                            await window.Capacitor.Plugins.Clipboard.write({
                                string: fileUri.replace('file://', '')
                            });
                            pathCopied = true;
                        }
                    } catch (e) {
                        console.log('无法复制到剪贴板:', e);
                    }
                    
                    var manualMsg = '📱 APK 已下载完成！\n\n';
                    manualMsg += '📂 文件位置：\n';
                    manualMsg += savedDir + '\n\n';
                    manualMsg += '📄 文件名：\n';
                    manualMsg += filename + '\n\n';
                    manualMsg += '💾 文件大小：\n';
                    manualMsg += (blob.size / 1024 / 1024).toFixed(2) + ' MB\n\n';
                    
                    if (pathCopied) {
                        manualMsg += '✅ 文件路径已复制到剪贴板\n\n';
                    }
                    
                    manualMsg += '━━━━━━━━━━━━━━━━\n\n';
                    manualMsg += '📋 手动安装步骤：\n\n';
                    manualMsg += '1️⃣ 打开"文件管理器"应用\n\n';
                    
                    if (savedDir.indexOf('Download') >= 0) {
                        manualMsg += '2️⃣ 进入"Download"或"下载"文件夹\n\n';
                    } else if (savedDir.indexOf('缓存') >= 0) {
                        manualMsg += '2️⃣ 进入以下路径：\n';
                        manualMsg += 'Android/data/\n';
                        manualMsg += 'com.tehui.offline/\n';
                        manualMsg += 'cache/downloads/\n\n';
                    } else {
                        manualMsg += '2️⃣ 使用搜索功能\n';
                        manualMsg += '   搜索：' + filename + '\n\n';
                    }
                    
                    manualMsg += '3️⃣ 找到并点击 APK 文件\n\n';
                    manualMsg += '4️⃣ 如果提示"未知来源"：\n';
                    manualMsg += '   • 点击"设置"\n';
                    manualMsg += '   • 允许"安装未知应用"\n';
                    manualMsg += '   • 返回继续安装\n\n';
                    manualMsg += '5️⃣ 点击"安装"按钮\n\n';
                    manualMsg += '6️⃣ 等待安装完成\n\n';
                    manualMsg += '━━━━━━━━━━━━━━━━\n\n';
                    manualMsg += '💡 提示：\n';
                    manualMsg += '• 安装完成后可覆盖旧版本\n';
                    manualMsg += '• 数据不会丢失\n';
                    
                    if (pathCopied) {
                        manualMsg += '• 完整路径已在剪贴板中\n';
                        manualMsg += '  可粘贴到文件管理器搜索';
                    } else {
                        manualMsg += '• 如找不到文件，请重新下载';
                    }
                    
                    alert(manualMsg);
                }
                
                if (installed) {
                    if (onProgress) onProgress('安装程序已打开！', 100, 0, blob.size);
                    if (onComplete) onComplete(sourceName);
                } else {
                    // 所有方法都失败，提供手动安装指引
                    var errorMsg = '无法自动打开安装程序\n\n';
                    errorMsg += '文件已保存到: ' + savedDir + '\n';
                    errorMsg += '路径: ' + fileUri + '\n';
                    errorMsg += '文件名: ' + filename + '\n\n';
                    errorMsg += '请手动安装:\n';
                    errorMsg += '1. 打开文件管理器\n';
                    errorMsg += '2. 找到上述位置的文件\n';
                    errorMsg += '3. 点击文件进行安装\n\n';
                    
                    if (installError) {
                        errorMsg += '错误详情: ' + installError.message;
                    }
                    
                    alert(errorMsg);
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
