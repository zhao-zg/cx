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
        
        var chunkSize = 2 * 1024 * 1024; // 2MB
        var downloadedBytes = 0;
        
        if (contentLength > 0 && contentLength > chunkSize) {
            // 大文件分块下载（批次并发，每批 CONCURRENCY 块）
            var CONCURRENCY = 3;
            var numChunks = Math.ceil(contentLength / chunkSize);
            var chunks = new Array(numChunks);
            var lastUpdateTime = Date.now();
            var lastDownloadedBytes = 0;
            
            console.log('[APK下载] 分', numChunks, '块，每批', CONCURRENCY, '块并发下载');
            
            // 将单块下载封装为函数（闭包捕获索引）
            function fetchChunk(chunkIndex) {
                var start = chunkIndex * chunkSize;
                var end = Math.min(start + chunkSize - 1, contentLength - 1);
                return CapacitorHttp.get({
                    url: downloadUrl,
                    headers: { 'Range': 'bytes=' + start + '-' + end },
                    responseType: 'blob',
                    connectTimeout: 30000,
                    readTimeout: 60000
                }).then(function(chunkResponse) {
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
                    return { index: chunkIndex, blob: chunkBlob };
                });
            }
            
            for (var batchStart = 0; batchStart < numChunks; batchStart += CONCURRENCY) {
                var batchEnd = Math.min(batchStart + CONCURRENCY, numChunks);
                var batchPromises = [];
                for (var i = batchStart; i < batchEnd; i++) {
                    batchPromises.push(fetchChunk(i));
                }
                
                var batchResults = await Promise.all(batchPromises);
                
                batchResults.forEach(function(result) {
                    chunks[result.index] = result.blob;
                    downloadedBytes += result.blob.size;
                });
                
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
            get mirrors() {
                return (window.CX_SERVERS && window.CX_SERVERS.githubMirrors) || [];
            }
        },
        isCapacitor: false,

        init: function() {
            this.isCapacitor = window.Capacitor && window.Capacitor.isNativePlatform();
            if (!this.isCapacitor) return;
            console.log('[更新] 初始化更新模块');
            this.cleanupOldApks();
            this.loadConfig();
        },

        // 清理上次更新遗留的 APK 文件（安装完成后重启时执行）
        cleanupOldApks: async function() {
            var Filesystem = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem;
            if (!Filesystem) return;
            var dirs = [
                { dir: 'EXTERNAL', path: 'Download' },
                { dir: 'CACHE',    path: 'downloads' },
                { dir: 'DATA',     path: 'downloads' }
            ];
            for (var i = 0; i < dirs.length; i++) {
                try {
                    var result = await Filesystem.readdir({ path: dirs[i].path, directory: dirs[i].dir });
                    var files = result && result.files;
                    if (!files) continue;
                    for (var j = 0; j < files.length; j++) {
                        var entry = files[j];
                        var name = typeof entry === 'string' ? entry : (entry && entry.name);
                        if (name && name.endsWith('.apk')) {
                            try {
                                await Filesystem.deleteFile({ path: dirs[i].path + '/' + name, directory: dirs[i].dir });
                                console.log('[更新] 已清理旧 APK:', name);
                            } catch (e) { /* 删除失败忽略 */ }
                        }
                    }
                } catch (e) { /* 目录不存在忽略 */ }
            }
        },

        loadConfig: function() {
            return fetch('/app_config.json')
                .then(function(response) { return response.json(); })
                .then(function(config) {
                    this.config.currentVersion = config.version;
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
                var blob, downloadUrl;
                var startDownloadTime = Date.now();
                var isGitHubUrl = url.indexOf('github.com') !== -1 || url.indexOf('githubusercontent.com') !== -1;
                
                if (CapacitorHttp) {
                    if (isGitHubUrl) {
                        // GitHub URL：测速选择最快线路
                        console.log('[APK下载] GitHub URL，使用快速测速策略');
                        if (onProgress) onProgress('正在选择最快线路...', 0, 0, 0);
                        
                        var downloadSources = [{ name: '线路 1', url: url }];
                        this.config.mirrors.forEach(function(mirror, index) {
                            downloadSources.push({ name: '线路 ' + (index + 2), url: mirror + url });
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
                        
                        if (!fastestSource) throw new Error('所有下载线路都不可用');
                        
                        console.log('[APK下载] 选择:', fastestSource.name, '(', fastestTime, 'ms)');
                        downloadUrl = fastestSource.url;
                    } else {
                        // 非 GitHub URL（如 Cloudflare），直接下载
                        console.log('[APK下载] 直接下载:', url);
                        downloadUrl = url;
                    }
                    
                    if (onProgress) onProgress('正在下载...', 10, 0, 0);
                    var result = await downloadFileInChunks(downloadUrl, onProgress);
                    blob = result.blob;
                    
                    var downloadTime = ((Date.now() - startDownloadTime) / 1000).toFixed(1);
                    console.log('[APK下载] 下载完成:', (result.size / 1024 / 1024).toFixed(2), 'MB, 耗时:', downloadTime, 's');
                    
                } else {
                    // 降级到镜像站
                    console.log('[APK下载] CapacitorHttp 不可用，使用备用线路');
                    if (onProgress) onProgress('准备下载...', 0, 0, 0);
                    
                    for (var i = 0; i < this.config.mirrors.length; i++) {
                        try {
                            var mirrorUrl = this.config.mirrors[i] + url;
                            var response = await fetch(mirrorUrl, { method: 'GET', cache: 'no-cache' });
                            if (!response.ok) throw new Error('HTTP ' + response.status);
                            blob = await response.blob();
                            break;
                        } catch (e) {
                            if (i === this.config.mirrors.length - 1) throw new Error('所有下载线路都失败');
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
                
                if (!installed) {
                    alert('无法自动打开安装器\n\n文件已下载到: ' + savedDir + '\n文件: ' + filename + '\n\n请手动到文件管理器安装');
                }
                
                if (onProgress) onProgress('完成', 100, 0, blob.size);
                if (onComplete) onComplete();
                
            } catch (error) {
                console.error('[APK下载] 失败:', error);
                if (onError) onError(error);
            }
        }
    };

    // ==================== UI 工具函数 ====================
    
    // 获取主题颜色（从全局 THEME 或使用默认值）
    function getTheme() {
        return window.THEME || {
            brand: '#667eea',
            brandDark: '#5b7ce6',
            bg: 'linear-gradient(135deg, #667eea 0%, #5b7ce6 100%)',
            success: '#48bb78',
            successDark: '#38a169'
        };
    }
    
    // 获取当前 APK 版本（异步）
    function getCurrentApkVersion() {
        return new Promise(function(resolve) {
            var cachedVersion = localStorage.getItem('cx_apk_version');
            
            if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
                window.Capacitor.Plugins.App.getInfo().then(function(info) {
                    if (info.version) {
                        localStorage.setItem('cx_apk_version', info.version);
                        console.log('从 Capacitor 实时获取版本:', info.version, '包名:', info.id);
                        resolve(info.version);
                    } else {
                        console.log('Capacitor 未返回版本号，使用缓存:', cachedVersion || '未知');
                        resolve(cachedVersion || '未知');
                    }
                }).catch(function(err) {
                    console.log('获取 Capacitor 版本失败:', err, '使用缓存:', cachedVersion || '未知');
                    resolve(cachedVersion || '未知');
                });
            } else {
                console.log('非 Capacitor 环境，当前版本:', cachedVersion || '未知');
                resolve(cachedVersion || '未知');
            }
        });
    }
    
    // APK 下载进度对话框
    function showApkDownloadProgress(message, progress, speed, downloaded) {
        var THEME = getTheme();
        var dialogId = 'apkDownloadProgressDialog';
        var oldDialog = document.getElementById(dialogId);
        if (oldDialog) oldDialog.remove();
        
        var html = '<div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); z-index: 10001; display: flex; align-items: center; justify-content: center; padding: 20px;" id="' + dialogId + '">';
        html += '<div style="background: white; border-radius: 12px; padding: 24px; max-width: 400px; width: 100%;">';
        html += '<h3 style="color: ' + THEME.brand + '; margin-bottom: 15px; font-size: 18px; text-align: center;">📱 正在下载 APK</h3>';
        html += '<p style="color: #666; margin-bottom: 10px; text-align: center; font-size: 14px;" id="apkProgressMessage">' + message + '</p>';
        
        html += '<p style="color: #999; margin-bottom: 15px; text-align: center; font-size: 12px;" id="apkProgressInfo">';
        if (speed > 0) html += '速度: ' + speed + ' KB/s';
        if (downloaded > 0) {
            if (speed > 0) html += ' | ';
            html += '已下载: ' + (downloaded / 1024 / 1024).toFixed(2) + ' MB';
        }
        html += '</p>';
        
        html += '<div style="background: #e2e8f0; border-radius: 10px; height: 20px; overflow: hidden; margin-bottom: 10px;">';
        html += '<div id="apkProgressBar" style="background: ' + THEME.bg + '; height: 100%; width: ' + progress + '%; transition: width 0.3s;"></div>';
        html += '</div>';
        
        html += '<p style="color: #999; text-align: center; font-size: 12px;" id="apkProgressPercent">' + progress + '%</p>';
        html += '</div></div>';
        
        document.body.insertAdjacentHTML('beforeend', html);
        window.CX.lockOverlayScroll(document.getElementById(dialogId));
    }
    
    function updateApkDownloadProgress(message, progress, speed, downloaded) {
        var msgEl = document.getElementById('apkProgressMessage');
        var barEl = document.getElementById('apkProgressBar');
        var pctEl = document.getElementById('apkProgressPercent');
        var infoEl = document.getElementById('apkProgressInfo');
        
        if (msgEl) msgEl.textContent = message;
        if (barEl) barEl.style.width = progress + '%';
        if (pctEl) pctEl.textContent = progress + '%';
        
        if (infoEl) {
            var info = '';
            if (speed > 0) info += '速度: ' + speed + ' KB/s';
            if (downloaded > 0) {
                if (info) info += ' | ';
                info += '已下载: ' + (downloaded / 1024 / 1024).toFixed(2) + ' MB';
            }
            infoEl.textContent = info || ' ';
        }
    }
    
    function closeApkDownloadProgress() {
        var dialog = document.getElementById('apkDownloadProgressDialog');
        if (dialog) dialog.remove();
    }
    
    // 显示 APK 更新对话框
    function showApkUpdateDialog(release, apk, currentVersion, comparison) {
        var THEME = getTheme();
        var latestVersion = release.tag_name;
        var isVersionUnknown = (currentVersion === '未知');
        
        var html = '<div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); z-index: 10000; display: flex; align-items: center; justify-content: center; padding: 20px;" id="apkUpdateDialog">';
        html += '<div style="background: white; border-radius: 12px; padding: 24px; max-width: 400px; width: 100%; max-height: 80vh; overflow-y: auto;">';
        
        if (isVersionUnknown) {
            html += '<h3 style="color: ' + THEME.brand + '; margin-bottom: 15px; font-size: 20px;">📱 APK 下载</h3>';
        } else if (comparison > 0) {
            html += '<h3 style="color: ' + THEME.brand + '; margin-bottom: 15px; font-size: 20px;">🎉 发现新版本</h3>';
        } else if (comparison === 0) {
            html += '<h3 style="color: ' + THEME.success + '; margin-bottom: 15px; font-size: 20px;">✅ 已是最新版本</h3>';
        } else {
            html += '<h3 style="color: ' + THEME.brand + '; margin-bottom: 15px; font-size: 20px;">📱 版本信息</h3>';
        }
        
        html += '<div style="color: #333; margin-bottom: 20px; font-size: 14px; line-height: 1.6;">';
        html += '<p style="margin-bottom: 10px;">';
        html += '<strong>当前版本：</strong>' + (isVersionUnknown ? '未知' : 'v' + currentVersion) + '<br>';
        html += '<strong>最新版本：</strong>' + latestVersion;
        html += '</p>';
        
        // 显示版本状态提示
        if (isVersionUnknown) {
            html += '<div style="background: #fff3cd; padding: 10px; border-radius: 8px; font-size: 13px; text-align: center; color: #856404; margin-bottom: 15px;">';
            html += '⚠️ 无法获取当前版本号<br>建议下载最新版本';
            html += '</div>';
        } else if (comparison === 0) {
            html += '<div style="background: #e6f7ed; padding: 10px; border-radius: 8px; font-size: 13px; text-align: center; color: ' + THEME.success + '; margin-bottom: 15px;">';
            html += '✨ 您使用的已经是最新版本';
            html += '</div>';
        } else if (comparison > 0) {
            html += '<div style="background: #fff3cd; padding: 10px; border-radius: 8px; font-size: 13px; text-align: center; color: #856404; margin-bottom: 15px;">';
            html += '🎉 发现新版本可更新';
            html += '</div>';
        } else if (comparison < 0) {
            html += '<div style="background: #fff3cd; padding: 10px; border-radius: 8px; font-size: 13px; text-align: center; color: #856404; margin-bottom: 15px;">';
            html += '⚠️ 您的版本比最新版本还新（测试版）';
            html += '</div>';
        }
        
        // 按钮
        var sizeText = apk ? ' (' + (apk.size / 1024 / 1024).toFixed(1) + ' MB)' : '';
        if (isVersionUnknown || comparison > 0) {
            var btnText = isVersionUnknown ? '💾 立即下载' : '💾 立即更新';
            html += '<button style="width: 100%; padding: 12px; margin-bottom: 10px; background: linear-gradient(135deg, ' + THEME.success + ' 0%, ' + THEME.successDark + ' 100%); color: white; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer;" onclick="window.AppUpdate.downloadApkWithUI(\'' + apk.browser_download_url + '\')">';
            html += btnText + sizeText;
            html += '</button>';
        } else {
            html += '<button style="width: 100%; padding: 12px; margin-bottom: 10px; background: ' + THEME.bg + '; color: white; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer;" onclick="window.AppUpdate.downloadApkWithUI(\'' + apk.browser_download_url + '\')">';
            html += '💾 重新下载' + sizeText;
            html += '</button>';
        }
        
        html += '</div>';
        html += '<button style="width: 100%; padding: 12px; background: #f0f0f0; color: #666; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer;" onclick="document.getElementById(\'apkUpdateDialog\').remove()">关闭</button>';
        html += '</div></div>';
        
        document.body.insertAdjacentHTML('beforeend', html);
        window.CX.lockOverlayScroll(document.getElementById('apkUpdateDialog'));
    }
    
    // ==================== 公开接口 ====================
    
    AppUpdate.getCurrentVersion = getCurrentApkVersion;
    
    // 带 UI 的下载 APK 函数
    AppUpdate.downloadApkWithUI = function(url) {
        console.log('[APK下载] 开始下载:', url);
        
        if (!window.Capacitor || !window.Capacitor.Plugins) {
            console.log('[APK下载] 非 Capacitor 环境，使用浏览器下载');
            var link = document.createElement('a');
            link.href = url;
            link.download = url.split('/').pop();
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            setTimeout(function() {
                document.body.removeChild(link);
            }, 100);
            return;
        }
        
        if (!window.AppUpdate) {
            alert('AppUpdate 模块未加载');
            return;
        }
        
        showApkDownloadProgress('正在准备下载...', 0, 0, 0);
        
        window.AppUpdate.downloadApk(
            url,
            function(message, progress, speed, downloaded) {
                updateApkDownloadProgress(message, progress, speed, downloaded);
            },
            function() {
                setTimeout(function() {
                    closeApkDownloadProgress();
                }, 500);
            },
            function(error) {
                closeApkDownloadProgress();
                if (confirm('APK 下载失败\n\n' + error.message + '\n\n是否在浏览器中打开下载链接？')) {
                    window.open(url, '_blank');
                }
            }
        );
    };
    
    // ——————————————————————————————————
    // Changelog 辅助函数
    // ——————————————————————————————————

    // 从服务器 fetch changelog.json，失败时返回 null
    function fetchChangelog(serverUrl) {
        return fetch(serverUrl + 'changelog.json?t=' + Date.now(), { cache: 'no-cache' })
            .then(function(resp) { return resp.ok ? resp.json() : null; })
            .catch(function() { return null; });
    }

    // 筛选 fromVer < v <= toVer 的版本列表，版本号倒序
    function getVersionsBetween(changelog, fromVer, toVer) {
        if (!changelog) return [];
        var from = fromVer.replace('v', '');
        var to = toVer.replace('v', '');
        return Object.keys(changelog).filter(function(v) {
            return AppUpdate.compareVersion(v, from) > 0 && AppUpdate.compareVersion(v, to) <= 0;
        }).sort(function(a, b) {
            var c = AppUpdate.compareVersion(b, a);
            return c > 0 ? -1 : (c < 0 ? 1 : 0);
        });
    }

    // 渲染单版本 changelog HTML
    function renderSingleVersionHtml(version, entry) {
        var THEME = getTheme();
        var html = '<div style="margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid #eee;">';
        html += '<div style="font-weight:600;color:' + THEME.brand + ';margin-bottom:5px;">v' + version;
        if (entry.date) html += ' <span style="font-weight:400;color:#999;font-size:12px;">' + entry.date + '</span>';
        html += '</div>';
        if (entry['new'] && entry['new'].length) {
            html += '<div style="margin-bottom:3px;"><span style="color:#16a34a;font-size:12px;font-weight:600;">✨ 新增</span>';
            html += '<ul style="margin:2px 0 0 14px;padding:0;font-size:13px;color:#333;">';
            entry['new'].forEach(function(item) { html += '<li>' + item + '</li>'; });
            html += '</ul></div>';
        }
        if (entry['opt'] && entry['opt'].length) {
            html += '<div style="margin-bottom:3px;"><span style="color:#2563eb;font-size:12px;font-weight:600;">⚡ 优化</span>';
            html += '<ul style="margin:2px 0 0 14px;padding:0;font-size:13px;color:#333;">';
            entry['opt'].forEach(function(item) { html += '<li>' + item + '</li>'; });
            html += '</ul></div>';
        }
        if (entry['fix'] && entry['fix'].length) {
            html += '<div style="margin-bottom:3px;"><span style="color:#dc2626;font-size:12px;font-weight:600;">🔧 修复</span>';
            html += '<ul style="margin:2px 0 0 14px;padding:0;font-size:13px;color:#333;">';
            entry['fix'].forEach(function(item) { html += '<li>' + item + '</li>'; });
            html += '</ul></div>';
        }
        html += '</div>';
        return html;
    }

    // 填充对话框 changelog（两面板版本）
    // comparison > 0：更新内容内联区显示 (currentVer, latestVer] 区间
    // 历史版本面板显示 <= currentVer 的版本
    function fillChangelogPanel(dialogId, changelog, currentVer, latestVer, comparison) {
        var clInline    = document.getElementById(dialogId + '-cl-inline');
        var histContent = document.getElementById(dialogId + '-hist-content');
        var histBtn     = document.getElementById(dialogId + '-hist-btn');

        var currentClean = currentVer.replace('v', '');
        var latestClean  = latestVer.replace('v', '');

        // 更新内容内联区（仅 comparison > 0 时填充）
        if (comparison > 0 && clInline) {
            var displayVersions = getVersionsBetween(changelog, currentClean, latestClean);
            if (displayVersions.length > 0) {
                var html = '';
                if (displayVersions.length > 1) {
                    html += '<div style="margin-bottom:8px;font-size:12px;color:#666;">本次更新包含以下版本：</div>';
                }
                displayVersions.forEach(function(v) {
                    if (changelog[v]) html += renderSingleVersionHtml(v, changelog[v]);
                });
                clInline.innerHTML = html;
            } else {
                clInline.innerHTML = '<div style="color:#999;font-size:13px;text-align:center;padding:4px 0;">暂无更新说明</div>';
            }
            clInline.style.display = 'block';
        }

        // 历史版本面板（<= currentVer），倒序，每次显示 5 条
        var historyVersions = Object.keys(changelog).filter(function(v) {
            return AppUpdate.compareVersion(v, currentClean) <= 0;
        }).sort(function(a, b) {
            return AppUpdate.compareVersion(b, a); // 倒序：最新在前
        });
        if (histContent && historyVersions.length > 0) {
            var _PAGE = 5;
            var _histShown = 0;
            function _renderHistPage() {
                var end = Math.min(_histShown + _PAGE, historyVersions.length);
                var frag = '';
                for (var i = _histShown; i < end; i++) {
                    if (changelog[historyVersions[i]]) frag += renderSingleVersionHtml(historyVersions[i], changelog[historyVersions[i]]);
                }
                _histShown = end;
                var oldMore = histContent.querySelector('.hist-more-btn');
                if (oldMore) histContent.removeChild(oldMore);
                var tmp = document.createElement('div');
                tmp.innerHTML = frag;
                while (tmp.firstChild) histContent.appendChild(tmp.firstChild);
                if (_histShown < historyVersions.length) {
                    var moreBtn = document.createElement('button');
                    moreBtn.className = 'hist-more-btn';
                    moreBtn.style.cssText = 'width:100%;padding:9px;background:#f8fafc;color:#475569;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;cursor:pointer;margin-top:4px;';
                    moreBtn.textContent = '更多（还有 ' + (historyVersions.length - _histShown) + ' 个版本）';
                    moreBtn.onclick = _renderHistPage;
                    histContent.appendChild(moreBtn);
                }
            }
            _renderHistPage();
            if (histBtn) histBtn.style.display = 'block';
        }
    }

    // 创建通用更新对话框（两面板：主面板 / 历史版本）
    function createUpdateDialog(dialogId, title, statusId, btnId) {
        var THEME = getTheme();

        var html = '<div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;" id="' + dialogId + '">';
        html += '<div style="background:white;border-radius:12px;max-width:400px;width:100%;max-height:88vh;overflow:hidden;">';

        // ── 主面板 ──
        html += '<div id="' + dialogId + '-panel-main" style="display:block;">';
        html += '<div style="padding:20px 20px 16px;overflow-y:auto;max-height:88vh;">';
        html += '<h3 style="color:' + THEME.brand + ';margin-bottom:14px;font-size:18px;text-align:center;">' + title + '</h3>';
        html += '<div style="padding:14px;background:#f8f9ff;border-radius:8px;border:1px solid #e0e4ff;margin-bottom:12px;">';
        html += '<div id="' + statusId + '" style="color:#666;font-size:14px;line-height:1.7;">正在检查...</div>';
        html += '<button id="' + btnId + '" style="display:none;width:100%;padding:10px;margin-top:10px;background:' + THEME.bg + ';color:white;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;">立即更新应用</button>';
        html += '</div>';
        // 更新内容内联区（有新版本时自动显示，changelog 异步填充）
        html += '<div id="' + dialogId + '-cl-inline" style="display:none;background:#f6fff8;border:1px solid #bbf7d0;border-radius:8px;padding:12px 14px;margin-bottom:12px;overflow-y:auto;max-height:260px;font-size:13px;"></div>';
        html += '<button id="' + dialogId + '-hist-btn" style="display:none;width:100%;padding:9px 14px;margin-bottom:12px;background:#f8fafc;color:#475569;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;text-align:left;">📖 历史版本 ›</button>';
        html += '<button id="' + dialogId + '-close" style="width:100%;padding:11px;background:#e2e8f0;color:#4a5568;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;">关闭</button>';
        html += '</div></div>'; // end panel-main

        // ── 历史版本面板 ──
        html += '<div id="' + dialogId + '-panel-hist" style="display:none;">';
        html += '<div style="padding:12px 16px;border-bottom:1px solid #f0f0f0;display:flex;align-items:center;">';
        html += '<button id="' + dialogId + '-hist-back" style="background:none;border:none;color:' + THEME.brand + ';font-size:14px;font-weight:600;cursor:pointer;padding:4px 10px 4px 0;">← 返回</button>';
        html += '<span style="font-size:15px;font-weight:600;color:#222;">📖 历史版本</span>';
        html += '</div>';
        html += '<div id="' + dialogId + '-hist-content" style="padding:14px 16px;overflow-y:auto;max-height:calc(88vh - 50px);font-size:13px;"></div>';
        html += '</div>'; // end panel-hist

        html += '</div></div>'; // end box + overlay
        document.body.insertAdjacentHTML('beforeend', html);

        // 防滚动穿透（使用全局统一工具）
        var _unlockScroll = window.CX.lockOverlayScroll(document.getElementById(dialogId));

        // ── 面板切换 ──
        var _panel = 'main';

        function _show(name) {
            ['main', 'hist'].forEach(function(p) {
                var el = document.getElementById(dialogId + '-panel-' + p);
                if (el) el.style.display = (p === name) ? 'block' : 'none';
            });
            _panel = name;
        }

        // 进入子面板：向 CX.backStack 注册一条「回主面板」回调
        function _navTo(name) {
            window.CX.backStack.push(function() { _show('main'); });
            _show(name);
        }

        // 关闭对话框（关闭按钮调用）：清理 DOM + 消耗 backStack 记录
        function _close() {
            _unlockScroll();
            if (_panel !== 'main') window.CX.backStack.pop();
            window.CX.backStack.pop();
            var dlg = document.getElementById(dialogId);
            if (dlg) dlg.remove();
        }

        // 向 CX.backStack 注册对话框关闭回调（系统返回键触发）
        window.CX.backStack.push(function() {
            _unlockScroll();
            var dlg = document.getElementById(dialogId);
            if (dlg) dlg.remove();
        });

        // 绑定按钮事件
        var el;
        el = document.getElementById(dialogId + '-hist-btn');
        if (el) el.onclick = function() { _navTo('hist'); };
        el = document.getElementById(dialogId + '-hist-back');
        if (el) el.onclick = function() { history.back(); };
        el = document.getElementById(dialogId + '-close');
        if (el) el.onclick = _close;
        return _close;
    }
    
    // 处理版本比较结果并更新 UI
    function handleVersionComparison(statusEl, btnEl, comparison, currentVersion, latestVersion, sizeText, downloadUrl) {
        var currentClean = currentVersion.replace('v', '');
        var latestClean = latestVersion.replace('v', '');
        
        if (comparison > 0) {
            statusEl.innerHTML = '✅ 发现新版本<br>当前: v' + currentClean + '<br>最新: v' + latestClean + sizeText;
            btnEl.style.display = 'block';
            btnEl.textContent = '立即更新' + sizeText;
            btnEl.onclick = function() {
                console.log('[APK更新] 开始下载:', downloadUrl);
                AppUpdate.downloadApkWithUI(downloadUrl);
            };
        } else if (comparison === 0) {
            statusEl.innerHTML = '✅ 已是最新版本<br>版本: v' + currentClean;
            btnEl.style.display = 'block';
            btnEl.textContent = '重新下载' + sizeText;
            btnEl.onclick = function() {
                console.log('[APK更新] 重新下载:', downloadUrl);
                AppUpdate.downloadApkWithUI(downloadUrl);
            };
        } else if (comparison === null) {
            statusEl.innerHTML = '⚠️ 无法比较版本<br>当前: ' + currentVersion + '<br>最新: v' + latestClean;
            btnEl.style.display = 'block';
            btnEl.textContent = '下载最新版' + sizeText;
            btnEl.onclick = function() {
                console.log('[APK更新] 下载最新版:', downloadUrl);
                AppUpdate.downloadApkWithUI(downloadUrl);
            };
        } else {
            statusEl.innerHTML = '当前: v' + currentClean + '<br>远程: v' + latestClean;
        }
    }
    
    // Cloudflare 更新检查
    AppUpdate.showCloudflareUpdateDialog = function() {
        var CLOUDFLARE_SERVERS = (window.CX_SERVERS && window.CX_SERVERS.cloudflare) || [];
        
        console.log('[更新检查] 显示 Cloudflare 更新对话框');
        
        createUpdateDialog('cloudflareUpdateDialog', '🔄 检查更新', 'cfCheckStatus', 'cfUpdateBtn');
        
        var statusEl = document.getElementById('cfCheckStatus');
        var btnEl = document.getElementById('cfUpdateBtn');
        
        if (!statusEl || !btnEl) {
            console.error('[更新检查] 找不到状态元素');
            return;
        }
        
        getCurrentApkVersion().then(function(currentVersion) {
            statusEl.innerHTML = '当前版本: ' + currentVersion + '<br>正在检查远程版本...';
            
            // 并发请求所有服务器，最快成功者获胜
            var ts = Date.now();
            var serverPromises = CLOUDFLARE_SERVERS.map(function(serverUrl, idx) {
                var versionUrl = serverUrl + 'version.json?t=' + ts;
                console.log('[更新检查] 并发请求服务器 ' + (idx + 1) + ': ' + serverUrl);
                return fetch(versionUrl, { cache: 'no-cache' })
                    .then(function(response) {
                        if (!response.ok) throw new Error('HTTP ' + response.status);
                        return response.json();
                    })
                    .then(function(versionInfo) {
                        console.log('[更新检查] 服务器 ' + (idx + 1) + ' 响应成功:', versionInfo);
                        return { serverUrl: serverUrl, versionInfo: versionInfo };
                    });
            });
            
            // Promise.any 兼容写法：第一个成功者获胜
            var racePromise = typeof Promise.any === 'function'
                ? Promise.any(serverPromises)
                : new Promise(function(resolve, reject) {
                    var errors = [];
                    serverPromises.forEach(function(p) {
                        p.then(resolve).catch(function(e) {
                            errors.push(e);
                            if (errors.length === serverPromises.length) {
                                reject(new Error('所有服务器均无法访问'));
                            }
                        });
                    });
                });
            
            return racePromise.then(function(result) {
                var serverUrl = result.serverUrl;
                var versionInfo = result.versionInfo;
                
                var latestVersion = versionInfo.apk_version || versionInfo.version || '未知';
                var apkFile = versionInfo.apk_file || ('TeHui-v' + latestVersion + '.apk');
                var apkSize = versionInfo.apk_size;
                var currentVersionClean = currentVersion.replace('v', '');
                var latestVersionClean = latestVersion.replace('v', '');
                
                var downloadUrl = serverUrl + apkFile;
                var comparison = AppUpdate.compareVersion(latestVersionClean, currentVersionClean);
                var sizeText = apkSize ? ' (' + (apkSize / 1024 / 1024).toFixed(1) + ' MB)' : '';

                handleVersionComparison(statusEl, btnEl, comparison, currentVersion, latestVersion, sizeText, downloadUrl);

                // 发现新版本时预显示 changelog 加载占位
                if (comparison > 0) {
                    var clInline = document.getElementById('cloudflareUpdateDialog-cl-inline');
                    if (clInline) {
                        clInline.style.display = 'block';
                        clInline.innerHTML = '<div style="color:#999;font-size:13px;text-align:center;padding:4px 0;">📋 正在加载更新内容...</div>';
                    }
                }

                // 并行获取 changelog，不阻塞主流程
                fetchChangelog(serverUrl).then(function(changelog) {
                    if (changelog) fillChangelogPanel('cloudflareUpdateDialog', changelog, currentVersion, latestVersion, comparison);
                });
            }).catch(function(error) {
                statusEl.innerHTML = '❌ 所有服务器均无法访问';
                console.error('[更新检查] 所有服务器均失败:', error.message);
            });
        }).catch(function(error) {
            console.error('[更新检查] 失败:', error);
            if (!statusEl.innerHTML.includes('❌')) {
                statusEl.innerHTML = '❌ 检查失败: ' + error.message;
            }
        });
    };
    
    // GitHub 更新检查
    AppUpdate.showGitHubUpdateDialog = function() {
        var GITHUB_API_URL = (window.CX_SERVERS && window.CX_SERVERS.githubApi) || '';
        if (!GITHUB_API_URL) { console.error('[\u66f4\u65b0\u68c0\u67e5] githubApi \u672a\u914d\u7f6e'); return; }
        
        console.log('[更新检查] 显示 GitHub 更新对话框');
        
        createUpdateDialog('githubUpdateDialog', '🔄 检查更新 (GitHub)', 'ghCheckStatus', 'ghUpdateBtn');
        
        var statusEl = document.getElementById('ghCheckStatus');
        var btnEl = document.getElementById('ghUpdateBtn');
        
        if (!statusEl || !btnEl) {
            console.error('[更新检查] 找不到状态元素');
            return;
        }
        
        getCurrentApkVersion().then(function(currentVersion) {
            statusEl.innerHTML = '当前版本: ' + currentVersion + '<br>正在检查远程版本...';
            
            return fetch(GITHUB_API_URL)
                .then(function(response) {
                    if (!response.ok) throw new Error('HTTP ' + response.status);
                    return response.json();
                })
                .then(function(release) {
                    var apk = release.assets.find(function(a) {
                        return a.name.endsWith('.apk');
                    });
                    
                    if (!apk) {
                        statusEl.innerHTML = '❌ 未找到 APK 文件';
                        return;
                    }
                    
                    var latestVersion = release.tag_name;
                    var comparison = AppUpdate.compareVersion(latestVersion.replace('v', ''), currentVersion.replace('v', ''));
                    var sizeText = ' (' + (apk.size / 1024 / 1024).toFixed(1) + ' MB)';

                    handleVersionComparison(statusEl, btnEl, comparison, currentVersion, latestVersion, sizeText, apk.browser_download_url);

                    // 发现新版本时预显示 changelog 加载占位
                    if (comparison > 0) {
                        var clInline = document.getElementById('githubUpdateDialog-cl-inline');
                        if (clInline) {
                            clInline.style.display = 'block';
                            clInline.innerHTML = '<div style="color:#999;font-size:13px;text-align:center;padding:4px 0;">📋 正在加载更新内容...</div>';
                        }
                    }

                    // 从 Cloudflare 服务器获取 changelog（GitHub API 不提供）
                    var CL_SERVERS = (window.CX_SERVERS && window.CX_SERVERS.cloudflare) || [];
                    var clFetches = CL_SERVERS.map(function(u) {
                        return fetchChangelog(u).then(function(d) { if (!d) throw new Error('null'); return d; });
                    });
                    var clRace = typeof Promise.any === 'function'
                        ? Promise.any(clFetches)
                        : new Promise(function(resolve) {
                            var done = false;
                            clFetches.forEach(function(p) { p.then(function(d) { if (!done) { done = true; resolve(d); } }).catch(function() {}); });
                            setTimeout(function() { if (!done) { done = true; resolve(null); } }, 5000);
                        });
                    clRace.then(function(changelog) {
                        if (changelog) fillChangelogPanel('githubUpdateDialog', changelog, currentVersion, latestVersion, comparison);
                    }).catch(function() {});
                });
        }).catch(function(error) {
            console.error('[更新检查] 失败:', error);
            statusEl.innerHTML = '❌ 检查失败: ' + error.message;
        });
    };
    
    // PWA 更新检查对话框（清缓存 + 刷新）
    AppUpdate.showPwaUpdateDialog = function(options) {
        var root = (options && options.root) || './';
        var extStatusEl = (options && options.statusEl) || null;

        console.log('[更新检查] 显示 PWA 更新对话框');

        var closeDialog = createUpdateDialog('pwaUpdateDialog', '🔄 检查更新', 'pwaCheckStatus', 'pwaUpdateBtn');

        var statusEl = document.getElementById('pwaCheckStatus');
        var btnEl    = document.getElementById('pwaUpdateBtn');
        if (!statusEl || !btnEl) return;

        var currentVersion = '';
        try { currentVersion = localStorage.getItem('cx_pwa_version') || ''; } catch(e) {}

        statusEl.innerHTML = (currentVersion ? '当前版本: v' + currentVersion + '<br>' : '') + '正在检查远程版本...';

        fetch(root + 'version.json?t=' + Date.now(), { cache: 'no-cache' })
            .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(function(v) {
                var remoteVersion = v.version || v.apk_version || '';
                var comparison = currentVersion
                    ? AppUpdate.compareVersion(remoteVersion, currentVersion)
                    : 1; // 无本地版本 = 视为有更新

                if (comparison <= 0 && currentVersion) {
                    // 已是最新
                    statusEl.innerHTML = '✅ 已是最新版本<br>版本: v' + remoteVersion;
                    if (extStatusEl) { extStatusEl.textContent = '✓ 已是最新版本 v' + remoteVersion; extStatusEl.className = 'cache-status success'; }
                    btnEl.style.display = 'block';
                    btnEl.textContent = '强制重新加载';
                    btnEl.onclick = function() {
                        closeDialog();
                        var steps = [];
                        if ('caches' in window) {
                            steps.push(caches.keys().then(function(keys) {
                                return Promise.all(keys.filter(function(k) { return k.indexOf('cx-') === 0; }).map(function(k) { return caches.delete(k); }));
                            }));
                        }
                        try { localStorage.removeItem('cx_pwa_version'); } catch(ex) {}
                        try { localStorage.removeItem('cx_all_cached'); } catch(ex) {}
                        Promise.all(steps).then(function() { window.location.replace(root + 'index.html'); });
                    };
                } else {
                    // 有新版本
                    var currentClean = (currentVersion || '').replace('v', '');
                    var remoteClean  = remoteVersion.replace('v', '');
                    statusEl.innerHTML = '✅ 发现新版本<br>' +
                        (currentClean ? '当前: v' + currentClean + '<br>' : '') +
                        '最新: v' + remoteClean;
                    if (extStatusEl) { extStatusEl.textContent = '发现新版本 v' + remoteVersion; extStatusEl.className = 'cache-status'; }

                    // 预显示 changelog 加载占位
                    var clInline = document.getElementById('pwaUpdateDialog-cl-inline');
                    if (clInline) {
                        clInline.style.display = 'block';
                        clInline.innerHTML = '<div style="color:#999;font-size:13px;text-align:center;padding:4px 0;">📋 正在加载更新内容...</div>';
                    }

                    btnEl.style.display = 'block';
                    btnEl.textContent = '立即更新';
                    btnEl.onclick = function() {
                        closeDialog();
                        if (extStatusEl) { extStatusEl.textContent = '正在清除旧缓存...'; extStatusEl.className = 'cache-status'; }
                        var steps = [];
                        if ('caches' in window) {
                            steps.push(caches.keys().then(function(keys) {
                                return Promise.all(keys.filter(function(k) { return k.indexOf('cx-') === 0; }).map(function(k) { return caches.delete(k); }));
                            }).catch(function() {}));
                        }
                        try { localStorage.removeItem('cx_pwa_version'); } catch(ex) {}
                        try { localStorage.removeItem('cx_all_cached'); } catch(ex) {}
                        if (window.CX && window.CX.errorLog) window.CX.errorLog.clear();
                        Promise.all(steps).then(function() { window.location.replace(root + 'index.html'); });
                    };
                }

                // 异步填充 changelog，不阻塞主流程
                fetchChangelog(root).then(function(changelog) {
                    if (changelog) fillChangelogPanel('pwaUpdateDialog', changelog, currentVersion || '0', remoteVersion, comparison);
                });
            })
            .catch(function(e) {
                statusEl.innerHTML = '❌ 检查失败: ' + e.message;
                if (extStatusEl) { extStatusEl.textContent = '检查失败：' + e.message; extStatusEl.className = 'cache-status error'; }
            });
    };

    // 初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { AppUpdate.init(); });
    } else {
        AppUpdate.init();
    }

    window.AppUpdate = AppUpdate;
})();
