/**
 * 划线标记功能
 * 支持文本选中后划线、保存到本地存储、恢复划线
 */
(function() {
    'use strict';

    const CXHighlight = {
        // 配置
        config: {
            storageKey: 'cx_highlights',
            colors: {
                yellow: '#fff59d',
                green: '#a5d6a7',
                blue: '#90caf9',
                pink: '#f48fb1'
            },
            defaultColor: 'yellow'
        },

        // 当前页面的划线数据
        highlights: [],
        
        // 当前选中的颜色
        currentColor: 'yellow',
        
        // 选择变化定时器
        selectionTimeout: null,

        /**
         * 初始化
         */
        init: function() {
            this.createToolbar();
            this.loadHighlights();
            this.restoreHighlights();
            this.setupEventListeners();
        },

        /**
         * 从本地存储加载划线数据
         */
        loadHighlights: function() {
            try {
                const pageKey = this.getPageKey();
                const allData = JSON.parse(localStorage.getItem(this.config.storageKey) || '{}');
                this.highlights = allData[pageKey] || [];
                console.log('[划线] 加载划线数据:', this.highlights.length, '条');
            } catch (e) {
                console.error('[划线] 加载失败:', e);
                this.highlights = [];
            }
        },

        /**
         * 保存划线数据到本地存储
         */
        saveHighlights: function() {
            try {
                const pageKey = this.getPageKey();
                const allData = JSON.parse(localStorage.getItem(this.config.storageKey) || '{}');
                allData[pageKey] = this.highlights;
                localStorage.setItem(this.config.storageKey, JSON.stringify(allData));
                console.log('[划线] 保存成功:', this.highlights.length, '条');
            } catch (e) {
                console.error('[划线] 保存失败:', e);
            }
        },

        /**
         * 获取当前页面的唯一标识
         */
        getPageKey: function() {
            return window.location.pathname;
        },

        /**
         * 恢复页面上的划线
         */
        restoreHighlights: function() {
            this.highlights.forEach(function(highlight) {
                this.applyHighlight(highlight);
            }.bind(this));
        },

        /**
         * 应用单个划线
         */
        applyHighlight: function(highlight) {
            const container = document.querySelector('.content');
            if (!container) return;

            // 查找文本节点
            const textNodes = this.getTextNodes(container);
            let charCount = 0;

            for (let i = 0; i < textNodes.length; i++) {
                const node = textNodes[i];
                const nodeLength = node.textContent.length;
                const nodeStart = charCount;
                const nodeEnd = charCount + nodeLength;

                // 检查这个节点是否包含需要划线的文本
                if (nodeEnd > highlight.start && nodeStart < highlight.end) {
                    const startOffset = Math.max(0, highlight.start - nodeStart);
                    const endOffset = Math.min(nodeLength, highlight.end - nodeStart);

                    // 创建划线标记
                    const range = document.createRange();
                    range.setStart(node, startOffset);
                    range.setEnd(node, endOffset);

                    const mark = document.createElement('mark');
                    mark.className = 'cx-highlight';
                    mark.style.backgroundColor = this.config.colors[highlight.color] || this.config.colors[this.config.defaultColor];
                    mark.dataset.highlightId = highlight.id;
                    
                    try {
                        range.surroundContents(mark);
                    } catch (e) {
                        // 如果无法直接包裹（跨越多个元素），使用备用方法
                        console.warn('[划线] 无法应用划线:', e);
                    }
                }

                charCount += nodeLength;
            }
        },

        /**
         * 获取容器内所有文本节点
         */
        getTextNodes: function(element) {
            const textNodes = [];
            const walker = document.createTreeWalker(
                element,
                NodeFilter.SHOW_TEXT,
                {
                    acceptNode: function(node) {
                        // 跳过已经被标记的节点
                        if (node.parentElement && node.parentElement.classList.contains('cx-highlight')) {
                            return NodeFilter.FILTER_REJECT;
                        }
                        // 跳过空白节点
                        if (!node.textContent.trim()) {
                            return NodeFilter.FILTER_REJECT;
                        }
                        return NodeFilter.FILTER_ACCEPT;
                    }
                }
            );

            let node;
            while (node = walker.nextNode()) {
                textNodes.push(node);
            }

            return textNodes;
        },

        /**
         * 添加新的划线
         */
        addHighlight: function(color) {
            const selection = window.getSelection();
            if (!selection.rangeCount || selection.isCollapsed) {
                return;
            }

            const range = selection.getRangeAt(0);
            const container = document.querySelector('.content');
            if (!container || !container.contains(range.commonAncestorContainer)) {
                return;
            }

            // 计算选中文本在容器中的位置
            const position = this.getSelectionPosition(container, range);
            if (!position) return;

            // 创建划线数据
            const highlight = {
                id: Date.now().toString(),
                start: position.start,
                end: position.end,
                text: range.toString(),
                color: color || this.currentColor,
                timestamp: Date.now()
            };

            // 保存并应用
            this.highlights.push(highlight);
            this.saveHighlights();
            
            // 清除选择
            selection.removeAllRanges();
            
            // 重新渲染所有划线
            this.clearAllMarks();
            this.restoreHighlights();

            console.log('[划线] 添加划线:', highlight);
        },

        /**
         * 获取选中文本在容器中的位置
         */
        getSelectionPosition: function(container, range) {
            const textNodes = this.getTextNodes(container);
            let charCount = 0;
            let start = -1;
            let end = -1;

            for (let i = 0; i < textNodes.length; i++) {
                const node = textNodes[i];
                const nodeLength = node.textContent.length;

                if (node === range.startContainer) {
                    start = charCount + range.startOffset;
                }
                if (node === range.endContainer) {
                    end = charCount + range.endOffset;
                    break;
                }

                charCount += nodeLength;
            }

            if (start >= 0 && end >= 0 && end > start) {
                return { start: start, end: end };
            }

            return null;
        },

        /**
         * 清除所有划线标记（DOM）
         */
        clearAllMarks: function() {
            const marks = document.querySelectorAll('.cx-highlight');
            marks.forEach(function(mark) {
                const parent = mark.parentNode;
                while (mark.firstChild) {
                    parent.insertBefore(mark.firstChild, mark);
                }
                parent.removeChild(mark);
            });
        },

        /**
         * 清除所有划线数据
         */
        clearAllHighlights: function() {
            if (!confirm('确定要清除本页所有划线吗？')) {
                return;
            }

            this.highlights = [];
            this.saveHighlights();
            this.clearAllMarks();
            console.log('[划线] 已清除所有划线');
        },

        /**
         * 删除单个划线
         */
        removeHighlight: function(id) {
            this.highlights = this.highlights.filter(function(h) {
                return h.id !== id;
            });
            this.saveHighlights();
            this.clearAllMarks();
            this.restoreHighlights();
        },

        /**
         * 创建工具栏
         */
        createToolbar: function() {
            const toolbar = document.createElement('div');
            toolbar.id = 'highlightToolbar';
            toolbar.className = 'highlight-toolbar';
            toolbar.style.display = 'none';
            
            // 阻止工具栏上的触摸事件冒泡，避免触发文本选择取消
            toolbar.addEventListener('touchstart', function(e) {
                e.stopPropagation();
            });
            
            toolbar.addEventListener('touchend', function(e) {
                e.stopPropagation();
            });
            
            // 颜色按钮
            Object.keys(this.config.colors).forEach(function(colorName) {
                const btn = document.createElement('button');
                btn.className = 'highlight-color-btn';
                btn.style.backgroundColor = this.config.colors[colorName];
                btn.title = '划线 - ' + colorName;
                
                // 使用 touchend 和 click 双重事件，确保iOS兼容
                const handleClick = function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.addHighlight(colorName);
                    toolbar.style.display = 'none';
                }.bind(this);
                
                btn.addEventListener('touchend', handleClick);
                btn.addEventListener('click', handleClick);
                
                toolbar.appendChild(btn);
            }.bind(this));

            // 清除按钮
            const clearBtn = document.createElement('button');
            clearBtn.className = 'highlight-clear-btn';
            clearBtn.textContent = '清除';
            clearBtn.title = '清除本页所有划线';
            
            const handleClearClick = function(e) {
                e.preventDefault();
                e.stopPropagation();
                this.clearAllHighlights();
                toolbar.style.display = 'none';
            }.bind(this);
            
            clearBtn.addEventListener('touchend', handleClearClick);
            clearBtn.addEventListener('click', handleClearClick);
            
            toolbar.appendChild(clearBtn);

            document.body.appendChild(toolbar);
        },

        /**
         * 设置事件监听
         */
        setupEventListeners: function() {
            const self = this;

            // 监听文本选择（桌面端）
            document.addEventListener('mouseup', function(e) {
                setTimeout(function() {
                    self.handleTextSelection(e);
                }, 10);
            });

            // 监听文本选择（移动端）
            document.addEventListener('touchend', function(e) {
                setTimeout(function() {
                    self.handleTextSelection(e);
                }, 150); // iOS需要更长的延迟
            });

            // 监听选择变化（移动端长按选择）- iOS特别需要
            let selectionChangeTimer = null;
            document.addEventListener('selectionchange', function() {
                // 使用防抖，避免频繁触发
                clearTimeout(selectionChangeTimer);
                selectionChangeTimer = setTimeout(function() {
                    const selection = window.getSelection();
                    if (selection && selection.toString().trim().length > 0) {
                        self.handleTextSelection();
                    }
                }, 500); // iOS需要更长的延迟
            });

            // 点击其他地方隐藏工具栏
            document.addEventListener('mousedown', function(e) {
                const toolbar = document.getElementById('highlightToolbar');
                if (toolbar && !toolbar.contains(e.target)) {
                    toolbar.style.display = 'none';
                }
            });

            // 移动端触摸隐藏工具栏
            document.addEventListener('touchstart', function(e) {
                const toolbar = document.getElementById('highlightToolbar');
                if (toolbar && !toolbar.contains(e.target)) {
                    // 检查是否点击的是已划线的文本
                    if (!e.target.classList.contains('cx-highlight')) {
                        // iOS需要延迟隐藏，避免干扰选择
                        setTimeout(function() {
                            const selection = window.getSelection();
                            if (!selection || selection.toString().trim().length === 0) {
                                toolbar.style.display = 'none';
                            }
                        }, 100);
                    }
                }
            });

            // 双击划线可以删除
            document.addEventListener('dblclick', function(e) {
                if (e.target.classList.contains('cx-highlight')) {
                    const id = e.target.dataset.highlightId;
                    if (id && confirm('删除这个划线？')) {
                        self.removeHighlight(id);
                    }
                }
            });

            // 移动端长按删除划线
            let longPressTimer;
            let longPressTarget = null;
            
            document.addEventListener('touchstart', function(e) {
                if (e.target.classList.contains('cx-highlight')) {
                    longPressTarget = e.target;
                    const targetId = e.target.dataset.highlightId;
                    longPressTimer = setTimeout(function() {
                        if (longPressTarget && targetId) {
                            if (confirm('删除这个划线？')) {
                                self.removeHighlight(targetId);
                            }
                        }
                        longPressTarget = null;
                    }, 800); // 长按800ms
                }
            });

            document.addEventListener('touchend', function() {
                clearTimeout(longPressTimer);
                longPressTarget = null;
            });

            document.addEventListener('touchmove', function() {
                clearTimeout(longPressTimer);
                longPressTarget = null;
            });
        },

        /**
         * 处理文本选择
         */
        handleTextSelection: function() {
            const toolbar = document.getElementById('highlightToolbar');
            if (!toolbar) return;

            const selection = window.getSelection();
            if (!selection) {
                toolbar.style.display = 'none';
                return;
            }

            const selectedText = selection.toString().trim();

            if (selectedText.length > 0 && selection.rangeCount > 0) {
                try {
                    // 检查选择是否在内容区域内
                    const range = selection.getRangeAt(0);
                    const container = document.querySelector('.content');
                    if (!container || !container.contains(range.commonAncestorContainer)) {
                        toolbar.style.display = 'none';
                        return;
                    }

                    // 移动端：固定在底部
                    if (this.isMobile()) {
                        toolbar.style.position = 'fixed';
                        toolbar.style.bottom = '10px';
                        toolbar.style.left = '50%';
                        toolbar.style.top = 'auto';
                        toolbar.style.transform = 'translateX(-50%)';
                        toolbar.style.zIndex = '10000'; // 确保在最上层
                        toolbar.style.display = 'flex';
                        
                        // iOS需要强制重绘
                        toolbar.style.opacity = '0.99';
                        setTimeout(function() {
                            toolbar.style.opacity = '1';
                        }, 10);
                    } else {
                        // 桌面端：使用 requestAnimationFrame 确保流畅显示
                        const rect = range.getBoundingClientRect();
                        
                        toolbar.style.position = 'absolute';
                        toolbar.style.transform = 'none';
                        toolbar.style.display = 'flex';
                        toolbar.style.opacity = '0'; // 先设为透明
                        
                        // 使用 requestAnimationFrame 在下一帧计算位置
                        requestAnimationFrame(() => {
                            // 计算工具栏位置
                            let top = rect.top - toolbar.offsetHeight - 10 + window.scrollY;
                            let left = rect.left + (rect.width / 2) - (toolbar.offsetWidth / 2);
                            
                            // 确保工具栏不超出屏幕
                            const maxLeft = window.innerWidth - toolbar.offsetWidth - 10;
                            const minLeft = 10;
                            left = Math.max(minLeft, Math.min(left, maxLeft));
                            
                            // 如果工具栏会超出顶部，显示在选择区域下方
                            if (top < 10) {
                                top = rect.bottom + 10 + window.scrollY;
                            }
                            
                            toolbar.style.left = left + 'px';
                            toolbar.style.top = top + 'px';
                            toolbar.style.opacity = '1'; // 位置设置完成后显示
                        });
                    }
                } catch (e) {
                    console.warn('[划线] 无法显示工具栏:', e);
                    toolbar.style.display = 'none';
                }
            } else {
                toolbar.style.display = 'none';
            }
        },

        /**
         * 检测是否为移动端
         */
        isMobile: function() {
            return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) 
                || window.innerWidth <= 768;
        }
    };

    // 页面加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            CXHighlight.init();
        });
    } else {
        CXHighlight.init();
    }

    // 导出到全局
    window.CXHighlight = CXHighlight;

})();
