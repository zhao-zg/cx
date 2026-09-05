/**
 * 并发竞速工具：多个 URL 同时发起请求，首个成功者获胜。
 *
 * 用法：
 *   CX.raceFastest(urls, {
 *     fetchOptions: { cache: 'no-cache' },
 *     timeout: 10000,
 *     logPrefix: '[下载]',
 *     validate: function(r) { return r.ok; },
 *     transform: function(r, idx, url) { return r.json(); }
 *   }).then(function(result) {
 *     // result = { value, idx, url }
 *   }).catch(function(err) {
 *     // 所有 URL 均失败
 *   });
 */
(function () {
    'use strict';

    function raceFastest(urls, options) {
        options = options || {};
        if (!urls || !urls.length) return Promise.reject(new Error('raceFastest: urls 为空'));

        var fetchOptions = options.fetchOptions || { cache: 'no-cache' };
        var timeout = options.timeout || 10000;
        var transform = options.transform || function (r) { return r; };
        var validate = options.validate || function (r) { return r && r.ok !== false; };
        var logPrefix = options.logPrefix || '[raceFastest]';

        // 单一 URL 走简化路径
        if (urls.length === 1) {
            var singleUrl = urls[0];
            console.log(logPrefix, '请求:', singleUrl);
            return fetch(singleUrl, fetchOptions)
                .then(function (r) {
                    if (!validate(r)) throw new Error('HTTP ' + (r && r.status));
                    return Promise.resolve(transform(r, 0, singleUrl))
                        .then(function (value) { return { value: value, idx: 0, url: singleUrl }; });
                });
        }

        console.log(logPrefix, '并发竞速 ' + urls.length + ' 个源');

        return new Promise(function (resolve, reject) {
            var settled = false;
            var finished = 0;
            var total = urls.length;
            var errors = [];

            var controllers = [];

            // 总超时
            var timer = setTimeout(function () {
                if (settled) return;
                settled = true;
                for (var i = 0; i < controllers.length; i++) {
                    try { controllers[i] && controllers[i].abort(); } catch (e) {}
                }
                reject(new Error(logPrefix + ' 总超时 (' + timeout + 'ms)，已完成 ' + finished + '/' + total));
            }, timeout);

            function onSuccess(value, idx, url) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                console.log(logPrefix, '首个成功: #' + idx, url, '(' + (Date.now() - startTime) + 'ms)');
                // 取消其余请求
                for (var i = 0; i < controllers.length; i++) {
                    if (i === idx) continue;
                    try { controllers[i] && controllers[i].abort(); } catch (e) {}
                }
                resolve({ value: value, idx: idx, url: url });
            }

            function onFail(err, idx) {
                finished++;
                errors.push({ idx: idx, err: err });
                if (settled) return;
                if (finished >= total) {
                    settled = true;
                    clearTimeout(timer);
                    var msg = errors.map(function (e) { return '#' + e.idx + ': ' + (e.err && e.err.message || e.err); }).join('; ');
                    reject(new Error(logPrefix + ' 所有源均失败 - ' + msg));
                }
            }

            var startTime = Date.now();

            urls.forEach(function (url, idx) {
                var controller = (typeof AbortController === 'function') ? new AbortController() : null;
                if (controller) controllers[idx] = controller;

                var opts = fetchOptions;
                if (controller) {
                    // 复制避免污染原对象
                    opts = {};
                    for (var k in fetchOptions) opts[k] = fetchOptions[k];
                    opts.signal = controller.signal;
                }

                fetch(url, opts)
                    .then(function (r) {
                        if (settled) return;
                        if (!validate(r)) throw new Error('HTTP ' + (r && r.status));
                        return Promise.resolve(transform(r, idx, url));
                    })
                    .then(function (value) {
                        if (settled) return;
                        onSuccess(value, idx, url);
                    })
                    .catch(function (err) {
                        if (settled && err && err.name === 'AbortError') return;
                        onFail(err, idx);
                    });
            });
        });
    }

    // 暴露
    window.CX = window.CX || {};
    window.CX.raceFastest = raceFastest;
})();