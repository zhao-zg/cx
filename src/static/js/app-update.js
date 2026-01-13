/**
 * APK 内部更新功能
 * 支持应用内下载和安装APK
 */
(function() {
    'use strict';

    const AppUpdate = {
        // 配置
        config: {
            versionUrl: null,
            currentVersion: null, // 从app_config.json动态读取
            checkInterval: 24 * 60 * 60 * 1000, // 24小时
            storageKey: 'cx_last_update_check'
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
                console.log('[更新] 非原生应用环境，跳过更新检查');
                return;
            }

            console.log('[更新] 初始化更新检查');
            
            this.loadConfig().then(function() {
                if (this.shouldCheckUpdate()) {
                    this.checkForUpdate();
                }
                this.addUpdateButton();
            }.bind(this));
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
                    console.log('[更新] 版本检查URL:', this.config.versionUrl);
                }.bind(this))
                .catch(function(error) {
                    console.error('[更新] 加载配置失败:', error);
                    // 如果加载失败，尝试从meta标签读取
                    this.loadVersionFromMeta();
                }.bind(this));
        },

        /**
         * 从meta标签加载版本（备用方案）
         */
        loadVersionFromMeta: function() {
            const metaVersion = document.querySelector('meta[name="app-version"]');
            if (metaVersion) {
                this.config.currentVersion = metaVersion.getAttribute('content');
                console.log('[更新] 从meta标签读取版本:', this.config.currentVersion);
            } else {
                console.warn('[更新] 无法获取版本号');
            }
        },

        /**
         * 是否应该检查更新
         */
        shouldCheckUpdate: function() {
            try {
                const lastCheck = localStorage.getItem(this.config.storageKey);
                if (!lastCheck) return true;
                
                const lastCheckTime = parseInt(lastCheck);
                const now = Date.now();
                
                return (now - lastCheckTime) > this.config.checkInterval;
            } catch (e) {
                return true;
            }
        },

        /**
         * 检查更新
         */
        checkForUpdate: function(manual) {
            if (!this.config.versionUrl) {
                console.warn('[更新] 未配置版本检查URL');
                if (manual) {
                    this.showMessage('未配置更新服务器');
                }
                return;
            }

            console.log('[更新] 开始检查更新...');
            
            if (manual) {
                this.showMessage('正在检查更新...', 2000);
            }

            localStorage.setItem(this.config.storageKey, Date.now().toString());

            fetch(this.config.versionUrl + '?t=' + Date.now())
                .then(function(response) {
                    return response.json();
                })
                .then(function(versionInfo) {
                    console.log('[更新] 服务器版本:', versionInfo);
                    
                    if (this.compareVersion(versionInfo.app_version, this.config.currentVersion) > 0) {
                        console.log('[更新] 发现新版本:', versionInfo.app_version);
                        this.showUpdateDialog(versionInfo);
                    } else {
                        console.log('[更新] 已是最新版本');
                        if (manual) {
                            this.showMessage('已是最新版本 v' + this.config.currentVersion);
                        }
                    }
                }.bind(this))
                .catch(function(error) {
                    console.error('[更新] 检查更新失败:', error);
                    if (manual) {
                        this.showMessage('检查更新失败，请稍后重试');
                    }
                }.bind(this));
        },

        /**
         * 比较版本号
         */
        compareVersion: function(v1, v2) {
            const parts1 = v1.split('.').map(function(n) { return parseInt(n) || 0; });
            const parts2 = v2.split('.').map(function(n) { return parseInt(n) || 0; });
            
            for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
                const p1 = parts1[i] || 0;
                const p2 = parts2[i] || 0;
                
                if (p1 > p2) return 1;
                if (p1 < p2) return -1;
            }
            
            return 0;
        },

        /**
         * 显示更新对话框
         */
        showUpdateDialog: function(versionInfo) {
            const message = '发现新版本 v' + versionInfo.app_version + '\n\n' +
                          (versionInfo.changelog || '包含新功能和改进') + '\n\n' +
                          '是否立即下载更新？';
            
            if (confirm(message)) {
                this.downloadUpdate(versionInfo);
            }
        },

        /**
         * 下载更新
         */
        downloadUpdate: function(versionInfo) {
            const apkUrl = versionInfo.apk_url;
            
            if (!apkUrl) {
                this.showMessage('未找到APK下载地址');
                return;
            }

            if (this.downloading) {
                this.showMessage('正在下载中，请稍候...');
                return;
            }

            console.log('[更新] 开始下载:', apkUrl);
            this.downloading = true;
            this.downloadProgress = 0;
            
            // 显示下载进度
            this.showDownloadProgress();

            // 使用Capacitor Http插件下载
            this.downloadWithCapacitor(apkUrl, versionInfo.app_version);
        },

        /**
         * 使用Capacitor下载APK
         */
        downloadWithCapacitor: function(url, version) {
            const { Filesystem, CapacitorHttp } = window.Capacitor.Plugins;
            
            if (!Filesystem) {
                this.showMessage('文件系统不可用');
                this.downloading = false;
                return;
            }

            // 使用CapacitorHttp下载（支持进度）
            if (CapacitorHttp) {
                this.downloadWithHttp(url, version);
            } else {
                // 降级方案：使用fetch
                this.downloadWithFetch(url, version);
            }
        },

        /**
         * 使用Http插件下载（支持进度）
         */
        downloadWithHttp: function(url, version) {
            const { CapacitorHttp, Filesystem, Directory } = window.Capacitor.Plugins;
            
            console.log('[更新] 使用Http插件下载...');
            
            // 下载到临时文件
            CapacitorHttp.downloadFile({
                url: url,
                filePath: 'tehui_v' + version + '.apk',
                fileDirectory: Directory.Cache,
                // 进度回调（如果支持）
                progress: function(progressEvent) {
                    if (progressEvent.lengthComputable) {
                        this.downloadProgress = Math.round((progressEvent.loaded / progressEvent.total) * 100);
                        this.updateDownloadProgress();
                    }
                }.bind(this)
            }).then(function(result) {
                console.log('[更新] 下载完成:', result.path);
                this.downloading = false;
                this.hideDownloadProgress();
                this.showMessage('下载完成，准备安装...');
                
                // 安装APK
                this.installApk(result.path, version);
            }.bind(this)).catch(function(error) {
                console.error('[更新] 下载失败:', error);
                this.downloading = false;
                this.hideDownloadProgress();
                this.showMessage('下载失败: ' + (error.message || '未知错误'));
            }.bind(this));
        },

        /**
         * 使用Fetch下载（降级方案）
         */
        downloadWithFetch: function(url, version) {
            console.log('[更新] 使用Fetch下载...');
            
            fetch(url)
                .then(function(response) {
                    if (!response.ok) {
                        throw new Error('下载失败: ' + response.status);
                    }
                    
                    const contentLength = response.headers.get('content-length');
                    if (!contentLength) {
                        return response.blob();
                    }
                    
                    // 支持进度的下载
                    const total = parseInt(contentLength);
                    let loaded = 0;
                    
                    const reader = response.body.getReader();
                    const chunks = [];
                    
                    const self = this;
                    function readChunk() {
                        return reader.read().then(function(result) {
                            if (result.done) {
                                return new Blob(chunks);
                            }
                            
                            chunks.push(result.value);
                            loaded += result.value.length;
                            self.downloadProgress = Math.round((loaded / total) * 100);
                            self.updateDownloadProgress();
                            
                            return readChunk();
                        });
                    }
                    
                    return readChunk();
                }.bind(this))
                .then(function(blob) {
                    console.log('[更新] 下载完成，保存文件...');
                    return this.saveApkFile(blob, version);
                }.bind(this))
                .then(function(filePath) {
                    this.downloading = false;
                    this.hideDownloadProgress();
                    this.showMessage('下载完成，准备安装...');
                    this.installApk(filePath, version);
                }.bind(this))
                .catch(function(error) {
                    console.error('[更新] 下载失败:', error);
                    this.downloading = false;
                    this.hideDownloadProgress();
                    this.showMessage('下载失败: ' + (error.message || '未知错误'));
                }.bind(this));
        },

        /**
         * 保存APK文件
         */
        saveApkFile: function(blob, version) {
            return new Promise(function(resolve, reject) {
                const reader = new FileReader();
                
                reader.onloadend = function() {
                    const base64Data = reader.result.split(',')[1];
                    const fileName = 'tehui_v' + version + '.apk';
                    const { Filesystem, Directory } = window.Capacitor.Plugins;
                    
                    Filesystem.writeFile({
                        path: fileName,
                        data: base64Data,
                        directory: Directory.Cache
                    }).then(function(result) {
                        console.log('[更新] 文件已保存:', result.uri);
                        resolve(result.uri);
                    }).catch(function(error) {
                        reject(error);
                    });
                };
                
                reader.onerror = function() {
                    reject(new Error('读取文件失败'));
                };
                
                reader.readAsDataURL(blob);
            }.bind(this));
        },

        /**
         * 安装APK
         */
        installApk: function(fileUri, version) {
            console.log('[更新] 准备安装APK:', fileUri);
            
            // Android需要使用Intent打开APK
            if (window.Capacitor.getPlatform() === 'android') {
                // 使用Capacitor的App插件打开文件
                const { App } = window.Capacitor.Plugins;
                
                if (App && App.openUrl) {
                    App.openUrl({ url: fileUri }).then(function() {
                        console.log('[更新] 已打开安装界面');
                    }).catch(function(error) {
                        console.error('[更新] 打开安装界面失败:', error);
                        // 尝试使用Browser插件
                        this.openWithBrowser(fileUri);
                    }.bind(this));
                } else {
                    this.openWithBrowser(fileUri);
                }
            } else {
                this.showMessage('当前平台不支持自动安装');
            }
        },

        /**
         * 使用浏览器打开（降级方案）
         */
        openWithBrowser: function(fileUri) {
            const { Browser } = window.Capacitor.Plugins;
            
            if (Browser) {
                Browser.open({ url: fileUri }).catch(function(error) {
                    console.error('[更新] 打开失败:', error);
                    this.showMessage('无法打开安装程序，请手动安装');
                }.bind(this));
            } else {
                window.open(fileUri, '_system');
            }
        },

        /**
         * 显示下载进度
         */
        showDownloadProgress: function() {
            const progressDiv = document.createElement('div');
            progressDiv.id = 'downloadProgress';
            progressDiv.className = 'download-progress';
            progressDiv.innerHTML = `
                <div class="progress-content">
                    <div class="progress-text">正在下载更新...</div>
                    <div class="progress-bar-container">
                        <div class="progress-bar-fill" id="progressBarFill"></div>
                    </div>
                    <div class="progress-percent" id="progressPercent">0%</div>
                </div>
            `;
            document.body.appendChild(progressDiv);
        },

        /**
         * 更新下载进度
         */
        updateDownloadProgress: function() {
            const fill = document.getElementById('progressBarFill');
            const percent = document.getElementById('progressPercent');
            
            if (fill) {
                fill.style.width = this.downloadProgress + '%';
            }
            if (percent) {
                percent.textContent = this.downloadProgress + '%';
            }
        },

        /**
         * 隐藏下载进度
         */
        hideDownloadProgress: function() {
            const progressDiv = document.getElementById('downloadProgress');
            if (progressDiv) {
                progressDiv.remove();
            }
        },

        /**
         * 添加更新按钮
         */
        addUpdateButton: function() {
            const isMainPage = window.location.pathname === '/' || 
                              window.location.pathname.endsWith('index.html');
            
            if (!isMainPage) return;

            const container = document.querySelector('.container');
            if (!container) return;

            const updateBtn = document.createElement('button');
            updateBtn.className = 'update-check-btn';
            updateBtn.textContent = '检查更新';
            updateBtn.onclick = function() {
                this.checkForUpdate(true);
            }.bind(this);

            const footer = document.querySelector('.footer');
            if (footer) {
                footer.insertBefore(updateBtn, footer.firstChild);
            }
        },

        /**
         * 显示消息
         */
        showMessage: function(message, duration) {
            const oldMsg = document.getElementById('updateMessage');
            if (oldMsg) {
                oldMsg.remove();
            }

            const msgDiv = document.createElement('div');
            msgDiv.id = 'updateMessage';
            msgDiv.className = 'update-message';
            msgDiv.textContent = message;
            document.body.appendChild(msgDiv);

            if (duration !== 0) {
                setTimeout(function() {
                    msgDiv.remove();
                }, duration || 3000);
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
