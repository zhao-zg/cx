/**
 * 热更新功能
 * 支持只更新HTML/JS/CSS等资源文件，无需重新安装APK
 */
(function() {
    'use strict';

    const HotUpdate = {
        // 配置
        config: {
            versionUrl: null,
            currentVersion: null,
            resourceVersion: null, // 资源版本号（独立于APK版本）
        },

        // 是否在Capacitor环境中
        isCapacitor: false,
        
        // 更新状态
        updating: false,
        updateProgress: 0,

        /**
         * 初始化
         */
        init: function() {
            this.isCapacitor = window.Capacitor && window.Capacitor.isNativePlatform();
            
            console.log('[热更新] 初始化模块');
            
            // 加载配置
            this.loadConfig();
            
            // 检查是否有待应用的更新
            this.checkPendingUpdate();
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
                    
                    // 从localStorage读取资源版本
                    var savedResourceVersion = localStorage.getItem('resource_version');
                    
                    if (savedResourceVersion) {
                        // 已有保存的资源版本
                        this.config.resourceVersion = savedResourceVersion;
                        console.log('[热更新] APK版本:', this.config.currentVersion);
                        console.log('[热更新] 资源版本:', this.config.resourceVersion);
                    } else {
                        // 首次运行，尝试从内置的 version.json 读取初始资源版本
                        console.log('[热更新] 首次运行，读取内置资源版本...');
                        fetch('/version.json')
                            .then(function(response) {
                                return response.json();
                            })
                            .then(function(versionInfo) {
                                // 使用内置的资源版本号
                                var initialResourceVersion = versionInfo.resource_version || '0';
                                this.config.resourceVersion = initialResourceVersion;
                                localStorage.setItem('resource_version', initialResourceVersion);
                                console.log('[热更新] APK版本:', this.config.currentVersion);
                                console.log('[热更新] 初始资源版本:', this.config.resourceVersion);
                            }.bind(this))
                            .catch(function(error) {
                                // 如果读取失败，使用 0 作为初始值
                                console.warn('[热更新] 无法读取内置 version.json:', error);
                                this.config.resourceVersion = '0';
                                localStorage.setItem('resource_version', '0');
                                console.log('[热更新] APK版本:', this.config.currentVersion);
                                console.log('[热更新] 资源版本（默认）:', this.config.resourceVersion);
                            }.bind(this));
                    }
                }.bind(this))
                .catch(function(error) {
                    console.error('[热更新] 加载配置失败:', error);
                }.bind(this));
        },

        /**
         * 检查待应用的更新
         */
        checkPendingUpdate: function() {
            const pendingUpdate = localStorage.getItem('pending_hot_update');
            if (pendingUpdate === 'true') {
                console.log('[热更新] 发现待应用的更新，准备重载...');
                localStorage.removeItem('pending_hot_update');
                
                // 延迟重载，确保页面完全加载
                setTimeout(function() {
                    this.showMessage('应用更新中...', 1000);
                    setTimeout(function() {
                        window.location.reload();
                    }, 1000);
                }.bind(this), 500);
            }
        },

        /**
         * 检查更新（同时检查APK和资源更新）
         */
        checkForUpdate: function(manual) {
            if (!this.config.versionUrl) {
                console.warn('[热更新] 未配置版本检查URL');
                if (manual) {
                    this.showMessage('未配置更新服务器');
                }
                return;
            }

            console.log('[热更新] 开始检查更新...');
            
            if (manual) {
                this.showMessage('正在检查更新...', 2000);
            }

            fetch(this.config.versionUrl + '?t=' + Date.now())
                .then(function(response) {
                    return response.json();
                })
                .then(function(versionInfo) {
                    console.log('[热更新] 服务器版本信息:', versionInfo);
                    
                    const apkNewer = this.compareVersion(versionInfo.app_version, this.config.currentVersion) > 0;
                    const resourceNewer = this.compareVersion(versionInfo.resource_version || versionInfo.app_version, 
                                                             this.config.resourceVersion) > 0;
                    
                    if (apkNewer) {
                        // APK版本更新，需要下载完整包
                        console.log('[热更新] 发现新APK版本:', versionInfo.app_version);
                        this.showApkUpdateDialog(versionInfo);
                    } else if (resourceNewer) {
                        // 只有资源更新，可以热更新
                        console.log('[热更新] 发现资源更新:', versionInfo.resource_version || versionInfo.app_version);
                        this.showHotUpdateDialog(versionInfo);
                    } else {
                        console.log('[热更新] 已是最新版本');
                        if (manual) {
                            this.showMessage('已是最新版本 v' + this.config.currentVersion);
                        }
                    }
                }.bind(this))
                .catch(function(error) {
                    console.error('[热更新] 检查更新失败:', error);
                    if (manual) {
                        this.showMessage('检查更新失败，请稍后重试');
                    }
                }.bind(this));
        },

        /**
         * 比较版本号
         * 支持语义化版本号（0.7.9）和时间戳版本号（20260201234248）
         */
        compareVersion: function(v1, v2) {
            const s1 = String(v1);
            const s2 = String(v2);
            
            // 检测是否为时间戳格式（纯数字，长度>=8）或初始值 0
            const isTimestamp1 = /^\d+$/.test(s1);
            const isTimestamp2 = /^\d+$/.test(s2);
            
            // 如果都是纯数字（时间戳或 0），直接比较数值
            if (isTimestamp1 && isTimestamp2) {
                const n1 = parseInt(s1);
                const n2 = parseInt(s2);
                if (n1 > n2) return 1;
                if (n1 < n2) return -1;
                return 0;
            }
            
            // 如果一个是纯数字，一个是语义化版本号
            if (isTimestamp1 !== isTimestamp2) {
                // 时间戳格式的版本号总是比语义化版本号新
                // 因为时间戳是用于热更新的，而语义化版本号是 APK 版本
                console.warn('[热更新] 版本号格式不一致:', v1, 'vs', v2, '- 假设时间戳更新');
                return isTimestamp1 ? 1 : -1;
            }
            
            // 都是语义化版本号，按 . 分割比较
            const parts1 = s1.split('.').map(function(n) { return parseInt(n) || 0; });
            const parts2 = s2.split('.').map(function(n) { return parseInt(n) || 0; });
            
            for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
                const p1 = parts1[i] || 0;
                const p2 = parts2[i] || 0;
                
                if (p1 > p2) return 1;
                if (p1 < p2) return -1;
            }
            
            return 0;
        },

        /**
         * 显示APK更新对话框
         */
        showApkUpdateDialog: function(versionInfo) {
            const message = '发现新版本 v' + versionInfo.app_version + '\n\n' +
                          '当前版本: v' + this.config.currentVersion + '\n' +
                          '最新版本: v' + versionInfo.app_version + '\n\n' +
                          '此更新需要重新安装APK\n\n' +
                          (versionInfo.changelog || '包含新功能和改进') + '\n\n' +
                          '是否立即下载更新？';
            
            if (confirm(message)) {
                // 调用APK更新功能
                if (window.AppUpdate) {
                    window.AppUpdate.downloadUpdate(versionInfo);
                } else {
                    this.showMessage('APK更新功能不可用');
                }
            }
        },

        /**
         * 显示热更新对话框
         */
        showHotUpdateDialog: function(versionInfo) {
            const resourceVersion = versionInfo.resource_version || versionInfo.app_version;
            
            // 格式化时间戳为可读格式
            let versionDisplay = resourceVersion;
            if (/^\d{14}$/.test(resourceVersion)) {
                // 时间戳格式：20260201235132 -> 2026-02-01 23:51
                const year = resourceVersion.substring(0, 4);
                const month = resourceVersion.substring(4, 6);
                const day = resourceVersion.substring(6, 8);
                const hour = resourceVersion.substring(8, 10);
                const minute = resourceVersion.substring(10, 12);
                versionDisplay = year + '-' + month + '-' + day + ' ' + hour + ':' + minute;
            }
            
            const message = '发现内容更新\n\n' +
                          '当前资源: ' + (this.config.resourceVersion === '0' ? '初始版本' : this.formatResourceVersion(this.config.resourceVersion)) + '\n' +
                          '最新资源: ' + versionDisplay + '\n\n' +
                          '无需重装，快速更新\n\n' +
                          (versionInfo.changelog || '包含内容更新和优化') + '\n\n' +
                          '是否立即更新？';
            
            if (confirm(message)) {
                this.performHotUpdate(versionInfo);
            }
        },

        /**
         * 格式化资源版本号为可读格式
         */
        formatResourceVersion: function(version) {
            if (/^\d{14}$/.test(version)) {
                const year = version.substring(0, 4);
                const month = version.substring(4, 6);
                const day = version.substring(6, 8);
                const hour = version.substring(8, 10);
                const minute = version.substring(10, 12);
                return year + '-' + month + '-' + day + ' ' + hour + ':' + minute;
            }
            return version;
        },

        /**
         * 执行热更新
         */
        performHotUpdate: function(versionInfo) {
            if (this.updating) {
                this.showMessage('正在更新中，请稍候...');
                return;
            }

            console.log('[热更新] 开始热更新...');
            this.updating = true;
            this.updateProgress = 0;
            
            // 显示更新进度
            this.showUpdateProgress();

            // 步骤1: 不清除缓存，直接更新（0% → 90%）
            this.updateProgressText('正在检查更新...');
            this.updateCriticalResources(versionInfo)
                .then(function() {
                    console.log('[热更新] 关键资源已更新');
                    this.updateProgress = 90;
                    this.updateUpdateProgress();
                    this.updateProgressText('正在应用更新...');
                    
                    // 保存新的资源版本号
                    const resourceVersion = versionInfo.resource_version || versionInfo.app_version;
                    localStorage.setItem('resource_version', resourceVersion);
                    
                    // 标记有待应用的更新
                    localStorage.setItem('pending_hot_update', 'true');
                    
                    this.updateProgress = 100;
                    this.updateUpdateProgress();
                    this.updateProgressText('更新完成');
                    
                    setTimeout(function() {
                        this.updating = false;
                        this.hideUpdateProgress();
                        this.showMessage('更新完成，即将重启应用...', 1500);
                        
                        // 重载页面应用更新
                        setTimeout(function() {
                            window.location.reload();
                        }, 1500);
                    }.bind(this), 500);
                }.bind(this))
                .catch(function(error) {
                    console.error('[热更新] 更新失败:', error);
                    this.updating = false;
                    this.hideUpdateProgress();
                    this.showMessage('更新失败: ' + (error.message || '未知错误'));
                }.bind(this));
        },

        /**
         * 更新关键资源（只更新必需的文件，其他文件由 Service Worker 按需更新）
         */
        updateCriticalResources: function(versionInfo) {
            return new Promise(function(resolve, reject) {
                // 关键文件列表（必须立即更新的）
                const criticalFiles = [
                    'index.html',
                    'manifest.json',
                    'sw.js',
                    'version.json'
                ];
                
                console.log('[热更新] 更新', criticalFiles.length, '个关键文件');
                
                let loaded = 0;
                const total = criticalFiles.length;
                
                const loadPromises = criticalFiles.map(function(file) {
                    return fetch('/' + file, { 
                        cache: 'reload',
                        mode: 'cors'
                    })
                        .then(function(response) {
                            if (!response.ok) {
                                throw new Error('HTTP ' + response.status);
                            }
                            loaded++;
                            // 更新进度：0% → 90%
                            const progress = Math.round((loaded / total) * 90);
                            this.updateProgress = progress;
                            this.updateUpdateProgress();
                            
                            // 强制缓存到 Service Worker
                            return caches.open('cx-main-' + Date.now()).then(function(cache) {
                                return cache.put('/' + file, response.clone()).then(function() {
                                    return response;
                                });
                            });
                        }.bind(this))
                        .catch(function(error) {
                            console.warn('[热更新] 更新失败:', file, error);
                            loaded++;
                            return null;
                        });
                }.bind(this));
                
                Promise.all(loadPromises)
                    .then(function() {
                        // 通知 Service Worker 更新
                        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                            navigator.serviceWorker.controller.postMessage({
                                type: 'SKIP_WAITING'
                            });
                        }
                        resolve();
                    })
                    .catch(function(error) {
                        console.error('[热更新] 更新失败:', error);
                        reject(error);
                    });
            }.bind(this));
        },

        /**
         * 更新进度文本
         */
        updateProgressText: function(text) {
            const progressText = document.querySelector('#hotUpdateProgress .progress-text');
            if (progressText) {
                progressText.textContent = text;
            }
        },

        /**
         * 清除Service Worker缓存
         */
        clearServiceWorkerCache: function() {
            return new Promise(function(resolve, reject) {
                if ('serviceWorker' in navigator && 'caches' in window) {
                    // 清除所有缓存
                    caches.keys().then(function(cacheNames) {
                        return Promise.all(
                            cacheNames.map(function(cacheName) {
                                console.log('[热更新] 删除缓存:', cacheName);
                                return caches.delete(cacheName);
                            })
                        );
                    }).then(function() {
                        // 通知Service Worker更新
                        if (navigator.serviceWorker.controller) {
                            navigator.serviceWorker.controller.postMessage({
                                type: 'SKIP_WAITING'
                            });
                        }
                        resolve();
                    }).catch(function(error) {
                        reject(error);
                    });
                } else {
                    // 没有Service Worker，直接清除localStorage缓存标记
                    console.log('[热更新] 无Service Worker，清除缓存标记');
                    resolve();
                }
            });
        },

        /**
         * 显示更新进度
         */
        showUpdateProgress: function() {
            const progressDiv = document.createElement('div');
            progressDiv.id = 'hotUpdateProgress';
            progressDiv.className = 'download-progress';
            progressDiv.innerHTML = `
                <div class="progress-content">
                    <div class="progress-text">正在更新内容...</div>
                    <div class="progress-bar-container">
                        <div class="progress-bar-fill" id="hotUpdateBarFill"></div>
                    </div>
                    <div class="progress-percent" id="hotUpdatePercent">0%</div>
                </div>
            `;
            document.body.appendChild(progressDiv);
        },

        /**
         * 更新进度
         */
        updateUpdateProgress: function() {
            const fill = document.getElementById('hotUpdateBarFill');
            const percent = document.getElementById('hotUpdatePercent');
            
            if (fill) {
                fill.style.width = this.updateProgress + '%';
            }
            if (percent) {
                percent.textContent = this.updateProgress + '%';
            }
        },

        /**
         * 隐藏更新进度
         */
        hideUpdateProgress: function() {
            const progressDiv = document.getElementById('hotUpdateProgress');
            if (progressDiv) {
                progressDiv.remove();
            }
        },

        /**
         * 显示消息
         */
        showMessage: function(message, duration) {
            const oldMsg = document.getElementById('hotUpdateMessage');
            if (oldMsg) {
                oldMsg.remove();
            }

            const msgDiv = document.createElement('div');
            msgDiv.id = 'hotUpdateMessage';
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
            HotUpdate.init();
        });
    } else {
        HotUpdate.init();
    }

    // 导出到全局
    window.HotUpdate = HotUpdate;

})();
