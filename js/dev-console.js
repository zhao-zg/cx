/**
 * 开发者调试控制台
 * 脚本加载时立刻开始无条件缓冲所有 console 输出（最多 500 条）。
 * 通过 window.CXDevConsole.init() 创建可视面板（展示历史缓冲）。
 * 通过 window.CXDevConsole.destroy() 仅移除面板，缓冲继续运行。
 * 由 theme-toggle.js 在"开发者模式"开关变更时驱动。
 */
(function() {
    'use strict';

    var _origConsole = {
        log:   console.log.bind(console),
        warn:  console.warn.bind(console),
        error: console.error.bind(console),
        info:  console.info.bind(console),
        debug: console.debug.bind(console)
    };
    var _devLogBuf = [];

    // ── 立即安装拦截，无论面板是否开启 ──────────────────────────────────
    function _hook(level) {
        return function() {
            _origConsole[level].apply(console, arguments);
            var msg = Array.prototype.slice.call(arguments).map(function(a) {
                if (a instanceof Error) return a.message + (a.stack ? '\n' + a.stack : '');
                try { return typeof a === 'object' ? JSON.stringify(a) : String(a); } catch(ex) { return String(a); }
            }).join(' ');
            var entry = { t: Date.now(), level: level, text: msg };
            _devLogBuf.push(entry);
            if (_devLogBuf.length > 500) _devLogBuf.shift();
            // 若面板已打开，实时追加
            var body = document.getElementById('cx-dev-console-body');
            if (body) {
                body.appendChild(_buildLogRow(entry));
                while (body.childNodes.length > 500) body.removeChild(body.firstChild);
                var el = document.getElementById('cx-dev-console');
                if (el && el.classList.contains('expanded')) body.scrollTop = body.scrollHeight;
            }
        };
    }
    console.log   = _hook('log');
    console.warn  = _hook('warn');
    console.error = _hook('error');
    console.info  = _hook('info');
    console.debug = _hook('debug');

    // ── 未捕获异常（浏览器 DevTools 红色报错）──────────────────────────
    window.addEventListener('error', function(e) {
        var src = e.filename ? (e.filename.replace(/^.*\//, '') + ':' + e.lineno + ':' + e.colno + ' ') : '';
        var msg = src + (e.message || String(e));
        if (e.error && e.error.stack) msg += '\n' + e.error.stack;
        _origConsole.error('[uncaught]', msg);
        var entry = { t: Date.now(), level: 'error', text: '[uncaught] ' + msg };
        _devLogBuf.push(entry);
        if (_devLogBuf.length > 500) _devLogBuf.shift();
        var body = document.getElementById('cx-dev-console-body');
        if (body) {
            body.appendChild(_buildLogRow(entry));
            while (body.childNodes.length > 500) body.removeChild(body.firstChild);
            var el = document.getElementById('cx-dev-console');
            if (el && el.classList.contains('expanded')) body.scrollTop = body.scrollHeight;
        }
    });

    // ── 未处理的 Promise rejection ───────────────────────────────────────
    window.addEventListener('unhandledrejection', function(e) {
        var reason = e.reason;
        var msg = reason instanceof Error
            ? reason.message + (reason.stack ? '\n' + reason.stack : '')
            : String(reason);
        _origConsole.error('[unhandledrejection]', msg);
        var entry = { t: Date.now(), level: 'error', text: '[unhandledrejection] ' + msg };
        _devLogBuf.push(entry);
        if (_devLogBuf.length > 500) _devLogBuf.shift();
        var body = document.getElementById('cx-dev-console-body');
        if (body) {
            body.appendChild(_buildLogRow(entry));
            while (body.childNodes.length > 500) body.removeChild(body.firstChild);
            var el = document.getElementById('cx-dev-console');
            if (el && el.classList.contains('expanded')) body.scrollTop = body.scrollHeight;
        }
    });

    function _buildLogRow(entry) {
        var d  = new Date(entry.t);
        var hh = String(d.getHours()).padStart(2, '0');
        var mm = String(d.getMinutes()).padStart(2, '0');
        var ss = String(d.getSeconds()).padStart(2, '0');
        var row = document.createElement('div');
        row.className = 'cx-dev-log' + (entry.level === 'log' ? '' : ' ' + entry.level);
        row.textContent = hh + ':' + mm + ':' + ss + ' ' + entry.text;
        return row;
    }

    function init() {
        if (document.getElementById('cx-dev-console')) return;
        var el = document.createElement('div');
        el.id = 'cx-dev-console';
        el.className = 'collapsed';
        el.innerHTML = [
            '<div id="cx-dev-console-bar">',
            '  <span id="cx-dev-console-title">DEV ▲</span>',
            '  <div id="cx-dev-console-actions">',
            '    <button class="cx-dev-btn" id="cx-dev-clear">清除</button>',
            '    <button class="cx-dev-btn" id="cx-dev-copy">复制</button>',
            '    <button class="cx-dev-btn" id="cx-dev-close">✕</button>',
            '  </div>',
            '</div>',
            '<div id="cx-dev-console-body"></div>'
        ].join('');
        document.body.appendChild(el);

        var bar   = document.getElementById('cx-dev-console-bar');
        var body  = document.getElementById('cx-dev-console-body');
        var title = document.getElementById('cx-dev-console-title');

        // 将历史缓冲全部渲染到面板
        if (_devLogBuf.length) {
            var frag = document.createDocumentFragment();
            for (var bi = 0; bi < _devLogBuf.length; bi++) frag.appendChild(_buildLogRow(_devLogBuf[bi]));
            body.appendChild(frag);
        }

        // bar 点击切换收起 / 展开
        bar.addEventListener('click', function(e) {
            if (e.target.classList.contains('cx-dev-btn')) return;
            var c = el.classList;
            if (c.contains('collapsed')) {
                c.remove('collapsed'); c.add('expanded');
                title.textContent = 'DEV ▼';
                body.scrollTop = body.scrollHeight;
            } else {
                c.remove('expanded'); c.add('collapsed');
                title.textContent = 'DEV ▲';
            }
        });

        // 清除
        document.getElementById('cx-dev-clear').addEventListener('click', function(e) {
            e.stopPropagation();
            body.innerHTML = '';
            _devLogBuf = [];
        });

        // 复制
        document.getElementById('cx-dev-copy').addEventListener('click', function(e) {
            e.stopPropagation();
            var txt = _devLogBuf.map(function(r) { return '[' + r.level + '] ' + r.text; }).join('\n');
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(txt).catch(function() {});
            } else {
                var ta = document.createElement('textarea');
                ta.value = txt;
                ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
                document.body.appendChild(ta);
                ta.select();
                try { document.execCommand('copy'); } catch(ex) {}
                document.body.removeChild(ta);
            }
        });

        // 关闭按钮：仅隐藏面板，不停止拦截
        document.getElementById('cx-dev-close').addEventListener('click', function(e) {
            e.stopPropagation();
            try { localStorage.setItem('cx_dev_mode', '0'); } catch(ex) {}
            var tog = document.getElementById('devModeToggle');
            if (tog) tog.checked = false;
            destroy();
        });
    }

    // 仅移除 DOM，console 拦截和缓冲继续运行
    function destroy() {
        var el = document.getElementById('cx-dev-console');
        if (el && el.parentNode) el.parentNode.removeChild(el);
    }

    window.CXDevConsole = { init: init, destroy: destroy };
})();

