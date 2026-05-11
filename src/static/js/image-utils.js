/**
 * 图片工具模块
 * 1. CX.loadRemoteImage() - 多服务器降级图片加载
 * 2. CX.ImageViewer       - 图片查看器（自动注入 HTML + 手势 + 分享）
 *
 * 全局接口：
 *   openImageViewer(src)  - 打开查看器
 *   closeImageViewer()    - 关闭查看器
 */
(function () {
    'use strict';
    window.CX = window.CX || {};

    // ── 1. 多服务器降级图片加载 ──────────────────────────────────────────────
    // container : DOM 元素，加载结果插入此处
    // servers   : 服务器前缀数组，如 ['https://a.com/', 'https://b.com/']
    // file      : 相对路径，如 'images/qr.png'
    // alt       : img alt 属性
    // options   : { loadingText, errorText, className, cacheBust, onLoad, onError }
    CX.loadRemoteImage = function (container, servers, file, alt, options) {
        if (!container) return;
        var opts = options || {};
        var loadingText = opts.loadingText !== undefined ? opts.loadingText : '加载中…';
        var errorText   = opts.errorText   !== undefined ? opts.errorText   : '加载失败';
        var className   = opts.className   || '';
        var cacheBust   = opts.cacheBust   !== false; // 默认 true

        if (loadingText) {
            container.innerHTML = '<div class="cx-remote-img-loading">' + loadingText + '</div>';
        }

        var ts    = cacheBust ? Date.now() : '';
        var tried = 0;

        function tryNext() {
            if (tried >= servers.length) {
                container.innerHTML = '<div class="cx-remote-img-loading">' + errorText + '</div>';
                if (opts.onError) opts.onError();
                return;
            }
            var url = servers[tried++] + file + (cacheBust ? '?t=' + ts : '');
            var img = new Image();
            img.onload = function () {
                if (!container || container.isConnected === false) return;
                container.innerHTML = '';
                if (className) img.className = className;
                img.alt = alt || '';
                container.appendChild(img);
                if (opts.onLoad) opts.onLoad(img);
            };
            img.onerror = tryNext;
            if (className) img.className = className;
            img.src = url;
        }
        tryNext();
    };

    // ── 2. 图片查看器 ────────────────────────────────────────────────────────
    CX.ImageViewer = (function () {
        var _ready = false;
        var overlay, img, closeBtn, navPrev, navNext, navIndicator;
        var _scale = 1, _tx = 0, _ty = 0;
        var _pinchStartDist = 0, _pinchStartScale = 1;
        var _panStartX = 0, _panStartY = 0, _panStartTx = 0, _panStartTy = 0;
        var _gestured = false;
        var _lastTap = 0;
        // 多图导航
        var _images = [];   // 图片 URL 数组
        var _current = 0;   // 当前索引

        function applyTransform() {
            img.style.transform = 'translate(' + _tx + 'px,' + _ty + 'px) scale(' + _scale + ')';
        }

        function resetTransform() {
            _scale = 1; _tx = 0; _ty = 0;
            img.style.transition = 'transform .25s ease';
            applyTransform();
            setTimeout(function () { img.style.transition = ''; }, 260);
        }

        function dist(t) {
            var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
            return Math.sqrt(dx * dx + dy * dy);
        }

        function isPortrait() { return overlay.classList.contains('portrait'); }

        function updateNavUI() {
            var multi = _images.length > 1;
            if (navPrev)      navPrev.style.display      = multi ? '' : 'none';
            if (navNext)      navNext.style.display      = multi ? '' : 'none';
            if (navIndicator) {
                navIndicator.style.display = multi ? '' : 'none';
                navIndicator.textContent   = (_current + 1) + ' / ' + _images.length;
            }
        }

        function goTo(idx) {
            if (!_images.length) return;
            _current = (idx + _images.length) % _images.length;
            resetTransform();
            img.src = _images[_current];
            overlay.classList.remove('portrait');
            function fitWidth() {
                var vw = overlay.clientWidth, vh = overlay.clientHeight;
                var nw = img.naturalWidth, nh = img.naturalHeight;
                if (!nw || !nh) return;
                if (Math.min(vw, vh * nw / nh) < vw - 1) overlay.classList.add('portrait');
            }
            if (img.complete && img.naturalWidth) { fitWidth(); }
            else { img.onload = fitWidth; }
            updateNavUI();
        }

        function close() {
            overlay.classList.remove('show', 'portrait');
            document.body.style.overflow = '';
            resetTransform();
            _images = []; _current = 0;
        }

        async function shareImage() {
            var src = img.src;
            if (!src) return;
            try {
                var resp = await fetch(src);
                var blob = await resp.blob();
                var ext = blob.type === 'image/png' ? 'png' : 'jpg';
                var parts = src.split('/');
                var filename = (parts[parts.length - 1].split('?')[0]) || ('image.' + ext);

                // Capacitor App：调用原生 ImageSaver 插件
                if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.ImageSaver) {
                    var base64 = await new Promise(function (resolve, reject) {
                        var reader = new FileReader();
                        reader.onload = function () { resolve(reader.result); };
                        reader.onerror = reject;
                        reader.readAsDataURL(blob);
                    });
                    await window.Capacitor.Plugins.ImageSaver.shareImage({
                        base64Data: base64,
                        filename: filename,
                        mimeType: blob.type,
                        title: '分享图片'
                    });
                    return;
                }

                // 浏览器：Web Share API（优先）
                var file = new File([blob], filename, { type: blob.type });
                if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
                    await navigator.share({ files: [file], title: filename });
                    return;
                }

                // fallback：触发下载
                var url = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = url; a.download = filename;
                document.body.appendChild(a); a.click(); document.body.removeChild(a);
                setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
            } catch (e) {
                if (e.name !== 'AbortError') console.error('分享失败:', e);
            }
        }

        function init() {
            if (_ready) return;
            _ready = true;

            // 注入查看器 HTML（新增左右导航按钮和页码指示）
            var wrap = document.createElement('div');
            wrap.innerHTML = [
                '<div id="imageViewer" class="image-viewer-overlay">',
                '  <button class="image-viewer-share-btn" id="viewerShare" title="分享/保存">🔗</button>',
                '  <button class="image-viewer-close" id="viewerClose">✕</button>',
                '  <button class="image-viewer-nav image-viewer-prev" id="viewerPrev" title="上一张">&#8249;</button>',
                '  <button class="image-viewer-nav image-viewer-next" id="viewerNext" title="下一张">&#8250;</button>',
                '  <span class="image-viewer-indicator" id="viewerIndicator"></span>',
                '  <div class="image-viewer-content" id="viewerContent">',
                '    <img id="viewerImage" src="" alt="查看图片">',
                '  </div>',
                '  <span class="image-viewer-hint">双指缩放 · 双击还原 · 上下滑动翻页</span>',
                '</div>'
            ].join('');
            while (wrap.firstChild) document.body.appendChild(wrap.firstChild);

            overlay      = document.getElementById('imageViewer');
            img          = document.getElementById('viewerImage');
            closeBtn     = document.getElementById('viewerClose');
            navPrev      = document.getElementById('viewerPrev');
            navNext      = document.getElementById('viewerNext');
            navIndicator = document.getElementById('viewerIndicator');

            // 双击还原
            img.addEventListener('touchend', function (e) {
                if (e.changedTouches.length !== 1 || e.touches.length > 0) return;
                var now = Date.now();
                if (now - _lastTap < 300) { resetTransform(); _lastTap = 0; return; }
                _lastTap = now;
            });

            // 触摸处理：双指缩放、单指平移、水平滑动翻页
            var _swipeStartX = 0, _swipeStartY = 0, _swipeTracking = false;
            img.addEventListener('touchstart', function (e) {
                _gestured = false;
                _swipeTracking = false;
                if (e.touches.length === 2) {
                    e.preventDefault();
                    _pinchStartDist  = dist(e.touches);
                    _pinchStartScale = _scale;
                } else if (e.touches.length === 1) {
                    if (!isPortrait() || _scale > 1) e.preventDefault();
                    _panStartX  = _swipeStartX = e.touches[0].clientX;
                    _panStartY  = _swipeStartY = e.touches[0].clientY;
                    _panStartTx = _tx;
                    _panStartTy = _ty;
                    _swipeTracking = true;
                }
            }, { passive: false });

            img.addEventListener('touchmove', function (e) {
                _gestured = true;
                if (e.touches.length === 2) {
                    e.preventDefault();
                    var d = dist(e.touches);
                    _scale = Math.min(8, Math.max(1, _pinchStartScale * d / _pinchStartDist));
                    applyTransform();
                } else if (e.touches.length === 1) {
                    if (isPortrait() && _scale <= 1) return;
                    e.preventDefault();
                    _tx = _panStartTx + (e.touches[0].clientX - _panStartX);
                    _ty = _panStartTy + (e.touches[0].clientY - _panStartY);
                    applyTransform();
                }
            }, { passive: false });

            img.addEventListener('touchend', function (e) {
                if (_scale <= 1) { _tx = 0; _ty = 0; applyTransform(); }
                // 垂直滑动翻页（仅在多图且未缩放时生效）
                if (_images.length > 1 && _scale <= 1 && _swipeTracking && e.changedTouches.length === 1) {
                    var dx = e.changedTouches[0].clientX - _swipeStartX;
                    var dy = e.changedTouches[0].clientY - _swipeStartY;
                    if (Math.abs(dy) > 50 && Math.abs(dy) > Math.abs(dx) * 1.5) {
                        if (dy < 0) { goTo(_current + 1); }
                        else        { goTo(_current - 1); }
                    }
                }
                _swipeTracking = false;
            });

            // 背景点击关闭
            overlay.addEventListener('touchend', function (e) {
                if (!_gestured && e.target === overlay) close();
            });
            overlay.addEventListener('click', function (e) {
                if (e.target === overlay) close();
            });

            closeBtn.addEventListener('click', close);
            closeBtn.addEventListener('touchend', function (e) { e.preventDefault(); close(); });

            navPrev.addEventListener('click', function() { goTo(_current - 1); });
            navNext.addEventListener('click', function() { goTo(_current + 1); });

            var shareBtn = document.getElementById('viewerShare');
            if (shareBtn) {
                shareBtn.addEventListener('click', shareImage);
                shareBtn.addEventListener('touchend', function (e) { e.preventDefault(); shareImage(); });
            }

            document.addEventListener('keydown', function (e) {
                if (!overlay.classList.contains('show')) return;
                if (e.key === 'Escape')      close();
                if (e.key === 'ArrowLeft')   goTo(_current - 1);
                if (e.key === 'ArrowRight')  goTo(_current + 1);
            });
        }

        // open(src)              — 单图，向后兼容
        // open(src, images, idx) — 多图，images 为 URL 数组，idx 为起始索引
        function open(src, images, idx) {
            init();
            if (Array.isArray(images) && images.length > 1) {
                _images  = images;
                _current = (typeof idx === 'number') ? idx : images.indexOf(src);
                if (_current < 0) _current = 0;
            } else {
                _images  = [src];
                _current = 0;
            }
            overlay.classList.remove('portrait');
            overlay.classList.add('show');
            document.body.style.overflow = 'hidden';
            updateNavUI();
            goTo(_current);
        }

        return { open: open, close: close };
    })();

    // 全局接口（兼容模板中的 onclick="openImageViewer(src)"）
    window.openImageViewer  = function (src, images, idx) { CX.ImageViewer.open(src, images, idx); };
    window.closeImageViewer = function ()                  { CX.ImageViewer.close(); };

})();
