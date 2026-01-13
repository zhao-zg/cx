/**
 * APK 内部更新功能
 * 支持检查更新、下载APK、安装更新
 */
(function() {
    'use strict';

    const AppUpdate = {
        // 配置
        config: {
            // 版本信息URL（从app_config.json读取）
            versionUrl: null,
            // 当前版本
            currentVersion: '0.7.3',
            // 检查更新间隔（毫秒）
            checkInterval: 24 * 60 * 60 * 1000, // 24小时
            // 存储键
            storageKey: 'cx_last_update_check'
        },

        // 是否在Capacitor环境中
        isCapacitor: false,

        /**
         * 初始化
         */
        init: function() {
            // 检测是否在Capacitor环境
            this.isCapacitor = window.Capacitor && window.Capacitor.isNativePlatform();
            
            if (!this.isCapacitor) {
                console.log('[更新] 非原生应用环境，跳过更新检查');
                return;
            }

            console.log('[更新] 初始化更新检查');
            
            // 加载配置
            this.loadConfig().then(function() {
                // 检查是否需要检查更新
                if (this.shouldCheckUpdate()) {
                    this.checkForUpdate();
                }
                
                // 添加手动检查按钮
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
                    this.config.currentVersion = config.version || this.config.currentVersion;
                    // 使用第一个远程URL作为版本检查地址
                    if (config.remote_urls && config.remote_urls.length > 0) {
                        this.config.versionUrl = config.remote_urls[0] + 'version.json';
                    }
                    console.log('[更新] 当前版本:', this.config.currentVersion);
                    console.log('[更新] 版本检查URL:', this.config.versionUrl);
                }.bind(this))
                .catch(function(error) {
                    console.error('[更新] 加载配置失败:', error);
                });
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

            // 记录检查时间
            localStorage.setItem(this.config.storageKey, Date.now().toString());

            fetch(this.config.versionUrl + '?t=' + Date.now())
                .then(function(response) {
                    return response.json();
                })
                .then(function(versionInfo) {
                    console.log('[更新] 服务器版本:', versionInfo);
                    
                    // 比较版本
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
         * @returns {number} 1: v1 > v2, 0: v1 == v2, -1: v1 < v2
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

            console.log('[更新] 开始下载:', apkUrl);
            this.showMessage('正在下载更新...', 0);

            // 使用Capacitor的文件系统和浏览器插件
            if (window.Capacitor && window.Capacitor.Plugins) {
                this.downloadWithCapacitor(apkUrl, versionInfo.app_version);
            } else {
                // 降级方案：直接打开下载链接
                window.open(apkUrl, '_system');
                this.showMessage('请在浏览器中完成下载和安装');
            }
        },

        /**
         * 使用Capacitor下载APK
         */
        downloadWithCapacitor: function(url, version) {
            const { Filesystem, Browser } = window.Capacitor.Plugins;
            
            if (!Filesystem || !Browser) {
                // 如果插件不可用，使用系统浏览器打开
                window.open(url, '_system');
                this.showMessage('请在浏览器中完成下载和安装');
                return;
            }

            // 下载文件
            fetch(url)
                .then(function(response) {
                    return response.blob();
                })
                .then(function(blob) {
                    return this.saveAndInstallApk(blob, version);
                }.bind(this))
                .catch(function(error) {
                    console.error('[更新] 下载失败:', error);
                    this.showMessage('下载失败，请检查网络连接');
                }.bind(this));
        },

        /**
         * 保存并安装APK
         */
        saveAndInstallApk: function(blob, version) {
            const reader = new FileReader();
            
            reader.onloadend = function() {
                const base64Data = reader.result.split(',')[1];
                const fileName = 'tehui_v' + version + '.apk';
                
                // 保存到下载目录
                const { Filesystem, Directory } = window.Capacitor.Plugins;
                
                Filesystem.writeFile({
                    path: fileName,
                    data: base64Data,
                    directory: Directory.Cache
                }).then(function(result) {
                    console.log('[更新] APK已保存:', result.uri);
                    this.showMessage('下载完成，准备安装...');
                    
                    // 打开APK进行安装
                    this.installApk(result.uri);
                }.bind(this)).catch(function(error) {
                    console.error('[更新] 保存失败:', error);
                    this.showMessage('保存失败: ' + error.message);
                }.bind(this));
            }.bind(this);
            
            reader.readAsDataURL(blob);
        },

        /**
         * 安装APK
         */
        installApk: function(fileUri) {
            // 使用系统浏览器打开APK文件
            const { Browser } = window.Capacitor.Plugins;
            
            if (Browser) {
                Browser.open({ url: fileUri }).catch(function(error) {
                    console.error('[更新] 打开APK失败:', error);
                    this.showMessage('无法打开安装程序');
                }.bind(this));
            }
        },

        /**
         * 添加更新按钮
         */
        addUpdateButton: function() {
            // 在主页添加检查更新按钮
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

            // 插入到页面底部
            const footer = document.querySelector('.footer');
            if (footer) {
                footer.insertBefore(updateBtn, footer.firstChild);
            }
        },

        /**
         * 显示消息
         */
        showMessage: function(message, duration) {
            // 移除旧消息
            const oldMsg = document.getElementById('updateMessage');
            if (oldMsg) {
                oldMsg.remove();
            }

            // 创建新消息
            const msgDiv = document.createElement('div');
            msgDiv.id = 'updateMessage';
            msgDiv.className = 'update-message';
            msgDiv.textContent = message;
            document.body.appendChild(msgDiv);

            // 自动隐藏
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
