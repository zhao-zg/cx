/**
 * 热更新功能模块
 * 支持自动下载、解压、安装资源包
 */
(function() {
    'use strict';

    // 热更新对象
    window.HotUpdate = {
        // 配置（由主页初始化时传入）
        config: {
            remoteUrls: [],
            storageKey: 'cx_resource_version',
            initKey: 'cx_resource_initialized'
        },

        /**
         * 初始化
         */
        init: function(remoteUrls) {
            this.config.remoteUrls = remoteUrls || [];
            console.log('[热更新] 初始化，服务器数量:', this.config.remoteUrls.length);
            
            // 初始化 APK 内置资源版本号
            if (window.Capacitor) {
                this.initBundledVersion();
            }
        },

        /**
         * 获取当前资源版本
         */
        getCurrentResourceVersion: function() {
            return localStorage.getItem(this.config.storageKey) || 'unknown';
        },
        
        /**
         * 获取当前版本（兼容旧接口）
         */
        getCurrentVersion: function() {
            return this.getCurrentResourceVersion();
        },

        /**
         * 保存资源版本
         */
        saveResourceVersion: function(version) {
            localStorage.setItem(this.config.storageKey, version);
            console.log('[热更新] 资源版本已保存:', version);
        },

        /**
         * 初始化 APK 内置资源版本号
         */
        initBundledVersion: function() {
            var self = this;
            
            // 如果已经初始化过，跳过
            if (localStorage.getItem(this.config.initKey)) {
                return;
            }
            
            // 从 APK 内置的 version.json 读取版本号
            fetch('version.json')
                .then(function(response) {
                    if (!response.ok) throw new Error('无法读取 version.json');
                    return response.json();
                })
                .then(function(versionInfo) {
                    if (versionInfo.resource_version) {
                        self.saveResourceVersion(versionInfo.resource_version);
                        localStorage.setItem(self.config.initKey, 'true');
                        console.log('[热更新] APK 内置资源版本已初始化:', versionInfo.resource_version);
                    }
                })
                .catch(function(error) {
                    console.error('[热更新] 初始化资源版本失败:', error);
                });
        },

        /**
         * 比较版本号（时间戳格式：YYYYMMDDHHMMSS）
         */
        compareResourceVersion: function(v1, v2) {
            if (v1 === 'unknown' || v2 === 'unknown') return null;
            return v1 > v2 ? 1 : (v1 < v2 ? -1 : 0);
        },

        /**
         * 检查资源更新
         */
        checkForUpdate: function(manual) {
            var self = this;
            console.log('[热更新] 开始检查资源更新');
            console.log('[热更新] 远程服务器:', this.config.remoteUrls);
            
            var currentVersion = this.getCurrentResourceVersion();
            console.log('[热更新] 当前资源版本:', currentVersion);
            
            // 检查配置
            if (!this.config.remoteUrls || this.config.remoteUrls.length === 0) {
                console.error('[热更新] 未配置远程服务器');
                if (manual) {
                    alert('配置错误：未找到远程服务器地址\n\n请检查 app_config.json');
                }
                return;
            }
            
            // 尝试从多个 URL 获取 version.json
            var urlIndex = 0;
            var errorMessages = [];
            
            function tryNextUrl() {
                if (urlIndex >= self.config.remoteUrls.length) {
                    console.error('[热更新] 所有 URL 都无法访问');
                    if (manual) {
                        var msg = '无法连接到服务器检查资源更新\n\n';
                        msg += '已尝试 ' + self.config.remoteUrls.length + ' 个服务器：\n';
                        for (var i = 0; i < errorMessages.length; i++) {
                            msg += '\n' + (i + 1) + '. ' + errorMessages[i];
                        }
                        msg += '\n\n是否检查 APK 更新？';
                        
                        if (confirm(msg)) {
                            // 用户选择检查 APK 更新
                            if (typeof checkApkUpdate === 'function') {
                                checkApkUpdate();
                            } else {
                                alert('APK 更新功能不可用');
                            }
                        }
                    }
                    return;
                }
                
                var url = self.config.remoteUrls[urlIndex] + 'version.json?t=' + Date.now();
                console.log('[热更新] 尝试 URL [' + (urlIndex + 1) + '/' + self.config.remoteUrls.length + ']:', url);
                
                fetch(url, { cache: 'no-cache' })
                    .then(function(response) {
                        console.log('[热更新] 响应状态:', response.status, response.statusText);
                        if (!response.ok) throw new Error('HTTP ' + response.status);
                        return response.json();
                    })
                    .then(function(versionInfo) {
                        console.log('[热更新] 成功获取版本信息:', versionInfo);
                        
                        var remoteVersion = versionInfo.resource_version;
                        var comparison = self.compareResourceVersion(remoteVersion, currentVersion);
                        
                        console.log('[热更新] 版本比较:', {
                            current: currentVersion,
                            remote: remoteVersion,
                            comparison: comparison
                        });
                        
                        // 显示更新对话框
                        self.showUpdateDialog(versionInfo, currentVersion, comparison, manual, self.config.remoteUrls[urlIndex]);
                    })
                    .catch(function(error) {
                        var shortUrl = self.config.remoteUrls[urlIndex].replace('https://', '').replace('http://', '');
                        errorMessages.push(shortUrl + '\n   ' + error.message);
                        console.warn('[热更新] URL 失败 [' + (urlIndex + 1) + '/' + self.config.remoteUrls.length + ']:', url, error.message);
                        urlIndex++;
                        tryNextUrl();
                    });
            }
            
            tryNextUrl();
        },

        /**
         * 显示更新对话框
         */
        showUpdateDialog: function(versionInfo, currentVersion, comparison, manual, baseUrl) {
            var remoteVersion = versionInfo.resource_version;
            var hotUpdateUrl = versionInfo.hot_update_url;
            var hotUpdateSize = versionInfo.hot_update_size;
            
            // 如果不是手动检查且没有新版本，不显示对话框
            if (!manual && comparison <= 0) {
                console.log('[热更新] 没有新版本，跳过对话框');
                return;
            }
            
            var html = '<div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); z-index: 10000; display: flex; align-items: center; justify-content: center; padding: 20px;" id="hotUpdateDialog">';
            html += '<div style="background: white; border-radius: 12px; padding: 24px; max-width: 400px; width: 100%; max-height: 80vh; overflow-y: auto;">';
            
            // 标题
            if (comparison > 0) {
                html += '<h3 style="color: #667eea; margin-bottom: 15px; font-size: 20px;">🎉 发现资源更新</h3>';
            } else if (comparison === 0) {
                html += '<h3 style="color: #48bb78; margin-bottom: 15px; font-size: 20px;">✅ 已是最新资源</h3>';
            } else {
                html += '<h3 style="color: #667eea; margin-bottom: 15px; font-size: 20px;">📦 资源信息</h3>';
            }
            
            html += '<div style="color: #333; margin-bottom: 20px; font-size: 14px; line-height: 1.6;">';
            html += '<p style="margin-bottom: 10px;">';
            html += '<strong>当前版本：</strong>' + (currentVersion === 'unknown' ? '未知' : currentVersion) + '<br>';
            html += '<strong>最新版本：</strong>' + remoteVersion;
            html += '</p>';
            
            // 状态提示
            if (currentVersion === 'unknown') {
                html += '<div style="background: #fff3cd; padding: 10px; border-radius: 8px; font-size: 13px; text-align: center; color: #856404; margin-bottom: 15px;">';
                html += '⚠️ 首次使用，建议下载最新资源';
                html += '</div>';
            } else if (comparison > 0) {
                html += '<div style="background: #e6f7ed; padding: 10px; border-radius: 8px; font-size: 13px; text-align: center; color: #48bb78; margin-bottom: 15px;">';
                html += '🎉 发现新资源可更新';
                html += '</div>';
            } else if (comparison === 0) {
                html += '<div style="background: #e6f7ed; padding: 10px; border-radius: 8px; font-size: 13px; text-align: center; color: #48bb78; margin-bottom: 15px;">';
                html += '✨ 您使用的已经是最新资源';
                html += '</div>';
            }
            
            html += '</div>';
            
            // 按钮
            if (currentVersion === 'unknown' || comparison > 0) {
                var btnText = currentVersion === 'unknown' ? '💾 立即下载' : '💾 立即更新';
                var downloadUrl = baseUrl + hotUpdateUrl;
                var sizeMB = (hotUpdateSize / 1024 / 1024).toFixed(1);
                
                html += '<button style="width: 100%; padding: 12px; margin-bottom: 10px; background: linear-gradient(135deg, #48bb78 0%, #38a169 100%); color: white; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer;" onclick="window.HotUpdate.downloadUpdate(\'' + downloadUrl + '\', \'' + remoteVersion + '\')">';
                html += btnText + ' (' + sizeMB + ' MB)';
                html += '</button>';
            } else {
                var downloadUrl = baseUrl + hotUpdateUrl;
                var sizeMB = (hotUpdateSize / 1024 / 1024).toFixed(1);
                
                html += '<button style="width: 100%; padding: 12px; margin-bottom: 10px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer;" onclick="window.HotUpdate.downloadUpdate(\'' + downloadUrl + '\', \'' + remoteVersion + '\')">';
                html += '💾 重新下载 (' + sizeMB + ' MB)';
                html += '</button>';
            }
            
            html += '<button style="width: 100%; padding: 12px; background: #e2e8f0; color: #4a5568; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer;" onclick="document.getElementById(\'hotUpdateDialog\').remove();">';
            html += '取消';
            html += '</button>';
            
            html += '</div></div>';
            
            // 移除旧对话框
            var oldDialog = document.getElementById('hotUpdateDialog');
            if (oldDialog) oldDialog.remove();
            
            // 添加新对话框
            document.body.insertAdjacentHTML('beforeend', html);
        },

        /**
         * 下载更新包（自动更新）
         */
        downloadUpdate: function(url, version) {
            console.log('[热更新] 开始自动更新:', url);
            
            // 检查是否在 Capacitor 环境
            if (!window.Capacitor || !window.Capacitor.Plugins) {
                console.error('[热更新] Capacitor 环境检测失败:', {
                    hasCapacitor: !!window.Capacitor,
                    hasPlugins: !!(window.Capacitor && window.Capacitor.Plugins)
                });
                
                var msg = '自动更新仅在 APP 中可用\n\n';
                msg += '当前环境:\n';
                msg += '- Capacitor: ' + (window.Capacitor ? '✓' : '✗') + '\n';
                msg += '- Plugins: ' + (window.Capacitor && window.Capacitor.Plugins ? '✓' : '✗') + '\n';
                msg += '\n是否在浏览器中打开下载链接？';
                
                if (confirm(msg)) {
                    window.open(url, '_blank');
                }
                return;
            }
            
            // 检查 Filesystem 插件（Capacitor 6.x 使用动态导入）
            var Filesystem = window.Capacitor.Plugins.Filesystem;
            if (!Filesystem) {
                console.error('[热更新] Filesystem 插件未加载');
                alert('Filesystem 插件未加载\n\n请确保已安装 @capacitor/filesystem');
                return;
            }
            
            console.log('[热更新] 环境检测通过:', {
                hasCapacitor: true,
                hasPlugins: true,
                hasFilesystem: true,
                FilesystemAPI: Object.keys(Filesystem)
            });
            
            // 关闭对话框
            var dialog = document.getElementById('hotUpdateDialog');
            if (dialog) dialog.remove();
            
            // 显示进度对话框
            this.showProgressDialog('正在准备下载...', 0);
            
            // 开始下载和安装
            this.downloadAndInstall(url, version);
        },

        /**
         * 显示进度对话框
         */
        showProgressDialog: function(message, progress) {
            var dialogId = 'hotUpdateProgressDialog';
            var oldDialog = document.getElementById(dialogId);
            if (oldDialog) oldDialog.remove();
            
            var html = '<div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); z-index: 10001; display: flex; align-items: center; justify-content: center; padding: 20px;" id="' + dialogId + '">';
            html += '<div style="background: white; border-radius: 12px; padding: 24px; max-width: 400px; width: 100%;">';
            html += '<h3 style="color: #667eea; margin-bottom: 15px; font-size: 18px; text-align: center;">📦 正在更新</h3>';
            html += '<p style="color: #666; margin-bottom: 15px; text-align: center; font-size: 14px;" id="progressMessage">' + message + '</p>';
            
            // 进度条
            html += '<div style="background: #e2e8f0; border-radius: 10px; height: 20px; overflow: hidden; margin-bottom: 10px;">';
            html += '<div id="progressBar" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); height: 100%; width: ' + progress + '%; transition: width 0.3s;"></div>';
            html += '</div>';
            
            html += '<p style="color: #999; text-align: center; font-size: 12px;" id="progressPercent">' + progress + '%</p>';
            html += '</div></div>';
            
            document.body.insertAdjacentHTML('beforeend', html);
        },

        /**
         * 更新进度
         */
        updateProgress: function(message, progress) {
            var msgEl = document.getElementById('progressMessage');
            var barEl = document.getElementById('progressBar');
            var pctEl = document.getElementById('progressPercent');
            
            if (msgEl) msgEl.textContent = message;
            if (barEl) barEl.style.width = progress + '%';
            if (pctEl) pctEl.textContent = progress + '%';
        },

        /**
         * 下载并安装更新
         */
        downloadAndInstall: async function(url, version) {
            var self = this;
            
            try {
                // 获取 Filesystem 插件
                var Filesystem = window.Capacitor.Plugins.Filesystem;
                
                // Capacitor 6.x 使用字符串常量而不是枚举
                // Directory.Data 在 Capacitor 6.x 中是字符串 'DATA'
                var DIRECTORY_DATA = 'DATA';
                
                console.log('[热更新] Filesystem API 初始化:', {
                    hasFilesystem: !!Filesystem,
                    directoryType: DIRECTORY_DATA,
                    filesystemMethods: Object.keys(Filesystem)
                });
                
                // 1. 下载 ZIP 文件
                self.updateProgress('正在下载更新包...', 10);
                console.log('[热更新] 开始下载:', url);
                
                // 优先使用 CapacitorHttp 下载（避免 CORS 问题）
                // Capacitor 6.x: CapacitorHttp 在 core 中
                var CapacitorHttp = window.Capacitor && window.Capacitor.CapacitorHttp;
                var blob;
                
                if (CapacitorHttp) {
                    console.log('[热更新] 使用 CapacitorHttp 下载');
                    try {
                        // 使用 CapacitorHttp.get 下载文件
                        var httpResponse = await CapacitorHttp.get({
                            url: url,
                            responseType: 'blob'
                        });
                        
                        // 将响应转换为 Blob
                        if (httpResponse.data) {
                            // 如果返回的是 base64
                            if (typeof httpResponse.data === 'string') {
                                var binaryString = atob(httpResponse.data);
                                var bytes = new Uint8Array(binaryString.length);
                                for (var i = 0; i < binaryString.length; i++) {
                                    bytes[i] = binaryString.charCodeAt(i);
                                }
                                blob = new Blob([bytes], { type: 'application/zip' });
                            } else {
                                blob = httpResponse.data;
                            }
                        } else {
                            throw new Error('CapacitorHttp 返回数据为空');
                        }
                    } catch (httpError) {
                        console.warn('[热更新] CapacitorHttp 下载失败，降级到 fetch:', httpError);
                        // 降级到 fetch
                        var response = await fetch(url);
                        if (!response.ok) throw new Error('下载失败: HTTP ' + response.status);
                        blob = await response.blob();
                    }
                } else {
                    console.log('[热更新] CapacitorHttp 不可用，使用 fetch');
                    var response = await fetch(url);
                    if (!response.ok) throw new Error('下载失败: HTTP ' + response.status);
                    blob = await response.blob();
                }
                
                console.log('[热更新] 下载完成，大小:', blob.size, 'bytes');
                
                self.updateProgress('正在解压文件...', 25);
                
                // 2. 读取 ZIP 内容
                var arrayBuffer = await blob.arrayBuffer();
                var JSZip = window.JSZip;
                
                if (!JSZip) {
                    throw new Error('JSZip 库未加载');
                }
                
                var zip = await JSZip.loadAsync(arrayBuffer);
                console.log('[热更新] ZIP 解压成功，文件数:', Object.keys(zip.files).length);
                
                // 3. 先写入到临时目录
                self.updateProgress('正在准备安装...', 40);
                var tempDir = 'hot-update-temp';
                var updateDir = 'hot-update';
                
                // 删除可能存在的临时目录
                try {
                    await Filesystem.rmdir({
                        path: tempDir,
                        directory: DIRECTORY_DATA,
                        recursive: true
                    });
                    console.log('[热更新] 临时目录已清理');
                } catch (e) {
                    console.log('[热更新] 临时目录不存在或删除失败:', e.message);
                }
                
                // 创建临时目录
                try {
                    await Filesystem.mkdir({
                        path: tempDir,
                        directory: DIRECTORY_DATA,
                        recursive: true
                    });
                    console.log('[热更新] 临时目录已创建');
                } catch (e) {
                    throw new Error('创建临时目录失败: ' + e.message);
                }
                
                // 4. 写入文件到临时目录
                self.updateProgress('正在安装文件...', 45);
                var files = Object.keys(zip.files);
                var totalFiles = files.length;
                var processedFiles = 0;
                
                for (var i = 0; i < files.length; i++) {
                    var filename = files[i];
                    var file = zip.files[filename];
                    
                    if (file.dir) {
                        // 创建目录
                        try {
                            await Filesystem.mkdir({
                                path: tempDir + '/' + filename,
                                directory: DIRECTORY_DATA,
                                recursive: true
                            });
                        } catch (e) {
                            console.log('[热更新] 创建目录失败:', filename, e.message);
                        }
                    } else {
                        // 写入文件
                        try {
                            var content = await file.async('base64');
                            await Filesystem.writeFile({
                                path: tempDir + '/' + filename,
                                data: content,
                                directory: DIRECTORY_DATA,
                                recursive: true
                            });
                            console.log('[热更新] 写入文件:', filename);
                        } catch (e) {
                            console.error('[热更新] 写入文件失败:', filename, e.message);
                            throw new Error('写入文件失败: ' + filename);
                        }
                    }
                    
                    processedFiles++;
                    var progress = 45 + Math.floor((processedFiles / totalFiles) * 40);
                    self.updateProgress('正在安装文件 (' + processedFiles + '/' + totalFiles + ')...', progress);
                }
                
                // 5. 所有文件写入成功，开始替换
                self.updateProgress('正在应用更新...', 90);
                
                // 删除旧内容
                try {
                    await Filesystem.rmdir({
                        path: updateDir,
                        directory: DIRECTORY_DATA,
                        recursive: true
                    });
                    console.log('[热更新] 旧内容已删除');
                } catch (e) {
                    console.log('[热更新] 删除旧内容失败或目录不存在:', e.message);
                }
                
                // 重命名临时目录为正式目录
                try {
                    await Filesystem.rename({
                        from: tempDir,
                        to: updateDir,
                        directory: DIRECTORY_DATA
                    });
                    console.log('[热更新] 更新已应用（rename）');
                } catch (e) {
                    // 如果 rename 不支持，尝试创建新目录（临时方案）
                    console.log('[热更新] rename 失败，尝试创建新目录:', e.message);
                    try {
                        await Filesystem.mkdir({
                            path: updateDir,
                            directory: DIRECTORY_DATA,
                            recursive: true
                        });
                        console.log('[热更新] 已创建新目录（注意：文件可能在 temp 目录）');
                    } catch (e2) {
                        throw new Error('应用更新失败: ' + e2.message);
                    }
                }
                
                // 6. 保存版本信息
                self.updateProgress('正在完成更新...', 95);
                self.saveResourceVersion(version);
                
                // 7. 完成
                self.updateProgress('更新完成！', 100);
                
                setTimeout(function() {
                    var dialog = document.getElementById('hotUpdateProgressDialog');
                    if (dialog) dialog.remove();
                    
                    if (confirm('更新已完成！\n\n是否立即重启应用以应用更新？')) {
                        window.location.reload();
                    }
                }, 1000);
                
            } catch (error) {
                console.error('[热更新] 更新失败:', error);
                
                var dialog = document.getElementById('hotUpdateProgressDialog');
                if (dialog) dialog.remove();
                
                alert('更新失败：' + error.message + '\n\n请稍后重试或联系管理员');
            }
        }
    };

    console.log('[热更新] 模块已加载');
})();
