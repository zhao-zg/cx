/**
 * 主题切换和字体控制功能模块
 * 支持暖色/冷色模式切换和字体大小调整
 */

// 初始化主题切换和字体控制功能
(function() {
    'use strict';
    
    // 字体大小配置
    const fontSizes = [14, 16, 18, 20, 22, 24, 26, 28];
    const defaultSizeIndex = 2; // 默认18px
    let currentSizeIndex = defaultSizeIndex;
    
    // 页面加载时创建主题切换UI
    function initThemeToggle() {
        // 查找container元素（优先使用.container，如果没有则使用body）
        const containerEl = document.querySelector('.container') || document.body;
        
        // 创建设置按钮
        const toggleBtn = document.createElement('div');
        toggleBtn.className = 'theme-toggle-btn';
        toggleBtn.onclick = toggleThemePanel;
        toggleBtn.title = '设置';
        toggleBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v6m0 6v6M1 12h6m6 0h6"/><path d="M4.2 4.2l4.3 4.3m5.5 5.5l4.3 4.3M4.2 19.8l4.3-4.3m5.5-5.5l4.3-4.3"/></svg>';
        containerEl.appendChild(toggleBtn);
        
        // 创建设置面板
        const panel = document.createElement('div');
        panel.className = 'theme-panel';
        panel.id = 'themePanel';
        panel.innerHTML = `
            <div class="theme-panel-header">
                <div class="theme-panel-title">设置</div>
                <button class="theme-panel-close" onclick="toggleThemePanel()" title="关闭">×</button>
            </div>
            
            <div class="theme-section">
                <div class="theme-section-title">阅读模式</div>
                <div class="theme-options">
                    <div class="theme-option" data-theme="warm" onclick="setTheme('warm')">
                        <div class="theme-preview warm"></div>
                        <div class="theme-option-content">
                            <div class="theme-radio"></div>
                            <div class="theme-label">暖色</div>
                        </div>
                    </div>
                    <div class="theme-option" data-theme="cool" onclick="setTheme('cool')">
                        <div class="theme-preview cool"></div>
                        <div class="theme-option-content">
                            <div class="theme-radio"></div>
                            <div class="theme-label">冷色</div>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="theme-section">
                <div class="theme-section-title">字体大小</div>
                <div class="font-size-slider-container">
                    <span class="font-label-small">A</span>
                    <input type="range" class="font-size-slider" id="fontSizeSlider" 
                           min="0" max="7" step="1" value="2" 
                           oninput="handleFontSliderChange(this.value)">
                    <span class="font-label-large">A</span>
                </div>
                <div class="font-size-value" id="fontSizeDisplay">18px</div>
                <div class="font-size-indicator" id="fontSizeIndicator">档位 3/8</div>
            </div>
        `;
        document.body.appendChild(panel);
        
        // 加载保存的主题
        const savedTheme = localStorage.getItem('readingTheme') || 'cool';
        document.documentElement.setAttribute('data-theme', savedTheme);
        updateThemeUI(savedTheme);
        
        // 加载保存的字体大小
        const savedSize = localStorage.getItem('globalFontSize');
        if (savedSize) {
            const savedIndex = fontSizes.indexOf(parseInt(savedSize));
            if (savedIndex !== -1) {
                currentSizeIndex = savedIndex;
                applyFontSize(savedSize);
            }
        }
        updateFontSizeUI();
        
        // 点击外部关闭面板
        document.addEventListener('click', function(e) {
            const panel = document.getElementById('themePanel');
            const btn = document.querySelector('.theme-toggle-btn');
            if (panel && panel.classList.contains('show') && !panel.contains(e.target) && !btn.contains(e.target)) {
                panel.classList.remove('show');
            }
        });
        
        // ESC键关闭面板
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                const panel = document.getElementById('themePanel');
                if (panel && panel.classList.contains('show')) {
                    panel.classList.remove('show');
                }
            }
        });
    }
    
    // 切换主题面板显示/隐藏
    window.toggleThemePanel = function() {
        const panel = document.getElementById('themePanel');
        if (panel) {
            panel.classList.toggle('show');
        }
    };
    
    // 设置主题
    window.setTheme = function(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('readingTheme', theme);
        updateThemeUI(theme);
        
        // 更新meta theme-color
        const themeColor = theme === 'warm' ? '#f0f0ee' : '#f7f8fc';
        const metaThemeColor = document.querySelector('meta[name="theme-color"]');
        if (metaThemeColor) {
            metaThemeColor.setAttribute('content', themeColor);
        }
    };
    
    // 更新主题UI状态
    function updateThemeUI(theme) {
        document.querySelectorAll('.theme-option').forEach(function(option) {
            if (option.getAttribute('data-theme') === theme) {
                option.classList.add('active');
            } else {
                option.classList.remove('active');
            }
        });
    }
    
    // 应用字体大小
    function applyFontSize(size) {
        document.body.style.fontSize = size + 'px';
        localStorage.setItem('globalFontSize', size);
    }
    
    // 更新字体大小UI
    function updateFontSizeUI() {
        const size = fontSizes[currentSizeIndex];
        const display = document.getElementById('fontSizeDisplay');
        if (display) {
            display.textContent = size + 'px';
        }
        
        // 更新滑块位置
        const slider = document.getElementById('fontSizeSlider');
        if (slider) {
            slider.value = currentSizeIndex;
        }
        
        // 更新档位指示器
        const indicator = document.getElementById('fontSizeIndicator');
        if (indicator) {
            indicator.textContent = `档位 ${currentSizeIndex + 1}/8`;
        }
    }
    
    // 滑块变化处理
    window.handleFontSliderChange = function(value) {
        const index = parseInt(value);
        if (index >= 0 && index < fontSizes.length) {
            currentSizeIndex = index;
            const size = fontSizes[currentSizeIndex];
            applyFontSize(size);
            updateFontSizeUI();
        }
    };
    
    // 减小字体
    window.decreaseFontSize = function() {
        if (currentSizeIndex > 0) {
            currentSizeIndex--;
            const size = fontSizes[currentSizeIndex];
            applyFontSize(size);
            updateFontSizeUI();
        }
    };
    
    // 增大字体
    window.increaseFontSize = function() {
        if (currentSizeIndex < fontSizes.length - 1) {
            currentSizeIndex++;
            const size = fontSizes[currentSizeIndex];
            applyFontSize(size);
            updateFontSizeUI();
        }
    };
    
    // 重置字体
    window.resetFontSize = function() {
        currentSizeIndex = defaultSizeIndex;
        const size = fontSizes[currentSizeIndex];
        applyFontSize(size);
        updateFontSizeUI();
    };
    
    // 导出函数供底部控制栏使用
    window.CXFontControl = {
        decrease: decreaseFontSize,
        increase: increaseFontSize,
        reset: resetFontSize
    };
    
    // DOM加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initThemeToggle);
    } else {
        initThemeToggle();
    }
})();
