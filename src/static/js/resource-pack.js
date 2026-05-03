/*!
 * resource-pack.js — 历史训练资源包下载管理
 *
 * 暴露：window.CXResourcePack
 *   .showPacksDialog()   打开资源包选择弹层
 *   .isPackCached(pack)  → Promise<boolean>  判断某资源包是否已缓存
 */
(function (win) {
  'use strict';

  var CACHE_NAME = 'cx-main';

  // ── 工具 ────────────────────────────────────────────────────────────────

  function getRoot() {
    return win.CX_ROOT || './';
  }

  // 将 zip 条目路径拼接为与 SW cache 一致的完整 URL
  // zip 内条目格式：2001-06/training.json  2025-04/images/hymn_1.png 等
  function entryToUrl(entryName) {
    // 去除首尾斜线，拼接到当前 origin
    var clean = entryName.replace(/^\/+/, '');
    // 主页与子页面 CX_ROOT 不同，统一用 origin + '/' + path 确保与 SW 截获的 URL 一致
    return win.location.origin + '/' + clean;
  }

  // 格式化字节数
  function fmtSize(bytes) {
    if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return bytes + ' B';
  }

  // ── 清单获取 ─────────────────────────────────────────────────────────────

  var _manifest = null;

  function fetchManifest() {
    if (_manifest) return Promise.resolve(_manifest);

    // 优先从镜像服务器取（保证获取到最新版），失败时尝试相对路径（本地/PWA 缓存）
    var servers = (win.CX_SERVERS && win.CX_SERVERS.cloudflare) || [];
    var urls = servers.map(function (s) {
      return s.replace(/\/$/, '') + '/resource-packs.json';
    });
    urls.push(getRoot() + 'resource-packs.json');

    function tryNext(idx) {
      if (idx >= urls.length) return Promise.reject(new Error('无法获取资源包清单'));
      return fetch(urls[idx] + '?t=' + Date.now(), { cache: 'no-cache' })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function (data) {
          _manifest = data;
          return data;
        })
        .catch(function () { return tryNext(idx + 1); });
    }
    return tryNext(0);
  }

  // ── 缓存检查 ──────────────────────────────────────────────────────────────

  function isPackCached(pack) {
    if (!('caches' in win)) return Promise.resolve(false);
    // 检查该包第一个训练的 training.json 是否在缓存中
    var probe = pack.trainings && pack.trainings[0];
    if (!probe) return Promise.resolve(false);
    var url = entryToUrl(probe.path + '/training.json');
    return caches.open(CACHE_NAME).then(function (cache) {
      return cache.match(url).then(function (r) { return !!r; });
    }).catch(function () { return false; });
  }

  // ── 下载单个资源包 ────────────────────────────────────────────────────────

  function downloadPack(pack, onProgress) {
    // 确保 JSZip 已加载
    function ensureJSZip() {
      if (win.JSZip) return Promise.resolve();
      return new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = getRoot() + 'vendor/jszip.min.js';
        s.onload = resolve;
        s.onerror = function () { reject(new Error('JSZip 加载失败')); };
        document.head.appendChild(s);
      });
    }

    // 从镜像服务器下载 zip（带进度）
    function fetchZip() {
      var servers = (win.CX_SERVERS && win.CX_SERVERS.cloudflare) || [];
      var baseUrls = servers.map(function (s) { return s.replace(/\/$/, ''); });
      baseUrls.push(win.location.origin);

      function tryServer(idx) {
        if (idx >= baseUrls.length) return Promise.reject(new Error('所有镜像均失败'));
        var url = baseUrls[idx] + '/' + pack.path;
        return fetch(url, { cache: 'no-cache' })
          .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            // 带进度读取
            var total = parseInt(r.headers.get('content-length') || '0', 10) || pack.size_bytes || 0;
            var loaded = 0;
            var reader = r.body && r.body.getReader();
            if (!reader) return r.arrayBuffer();
            var chunks = [];
            function pump() {
              return reader.read().then(function (result) {
                if (result.done) {
                  var merged = new Uint8Array(loaded);
                  var offset = 0;
                  chunks.forEach(function (c) { merged.set(c, offset); offset += c.length; });
                  return merged.buffer;
                }
                chunks.push(result.value);
                loaded += result.value.length;
                if (onProgress && total) onProgress(loaded / total * 0.8); // 0-80% 下载阶段
                return pump();
              });
            }
            return pump();
          })
          .catch(function () { return tryServer(idx + 1); });
      }
      return tryServer(0);
    }

    return ensureJSZip()
      .then(fetchZip)
      .then(function (arrayBuf) {
        if (onProgress) onProgress(0.8);
        return new win.JSZip().loadAsync(arrayBuf);
      })
      .then(function (zip) {
        if (!('caches' in win)) throw new Error('此环境不支持 Cache API');
        return caches.open(CACHE_NAME).then(function (cache) {
          var files = [];
          zip.forEach(function (relativePath, zipEntry) {
            if (!zipEntry.dir) files.push({ path: relativePath, entry: zipEntry });
          });
          var done = 0;
          function nextFile() {
            if (done >= files.length) return Promise.resolve();
            var item = files[done];
            done++;
            return item.entry.async('arraybuffer').then(function (buf) {
              var url = entryToUrl(item.path);
              // 推断 content-type
              var ext = item.path.split('.').pop().toLowerCase();
              var mimeMap = {
                json: 'application/json', js: 'application/javascript',
                png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
                gif: 'image/gif', webp: 'image/webp',
              };
              var mime = mimeMap[ext] || 'application/octet-stream';
              var blob = new Blob([buf], { type: mime });
              var resp = new Response(blob, {
                status: 200, headers: { 'Content-Type': mime }
              });
              return cache.put(url, resp);
            }).then(function () {
              if (onProgress) onProgress(0.8 + (done / files.length) * 0.2);
              return nextFile();
            });
          }
          return nextFile();
        });
      });
  }

  // ── 下载全部资源包 ────────────────────────────────────────────────────────

  function downloadAll(onProgressPack) {
    return fetchManifest().then(function (manifest) {
      var packs = manifest.packs || [];
      var idx = 0;
      function next() {
        if (idx >= packs.length) return Promise.resolve();
        var pack = packs[idx++];
        if (onProgressPack) onProgressPack(pack, idx - 1, packs.length);
        return downloadPack(pack).then(next);
      }
      return next();
    });
  }

  // ── 弹层 UI ───────────────────────────────────────────────────────────────

  function showPacksDialog() {
    var existing = document.getElementById('cxResourcePackMask');
    if (existing) { document.body.removeChild(existing); }

    var mask = document.createElement('div');
    mask.id = 'cxResourcePackMask';
    mask.className = 'cx-dialog-mask';
    mask.innerHTML =
      '<div class="cx-dialog" style="max-width:420px;padding:0 0 4px">' +
        '<div class="cx-dialog-title" style="padding:18px 16px 8px;font-size:16px">📦 历史资源包</div>' +
        '<div id="cxRpContent" style="padding:0 16px 8px;max-height:60vh;overflow-y:auto">' +
          '<div style="text-align:center;padding:24px 0;color:var(--text-secondary)">⏳ 加载清单中…</div>' +
        '</div>' +
        '<div style="padding:8px 16px 12px;display:flex;gap:8px;justify-content:flex-end">' +
          '<button id="cxRpDownloadAllBtn" style="display:none;padding:7px 14px;background:var(--brand);color:#fff;border:none;border-radius:8px;font-size:13px;cursor:pointer">全部下载</button>' +
          '<button id="cxRpCloseBtn" style="padding:7px 20px;background:var(--surface-alt);border:1px solid var(--border);border-radius:8px;font-size:13px;cursor:pointer;color:var(--text-secondary)">关闭</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(mask);

    // 注册到 backStack
    win.CX && win.CX.backStack && win.CX.backStack.push(closeDialog);

    function closeDialog() {
      if (mask.parentNode) mask.parentNode.removeChild(mask);
    }

    document.getElementById('cxRpCloseBtn').addEventListener('click', function () {
      win.CX && win.CX.backStack && win.CX.backStack.pop();
      closeDialog();
    });
    mask.addEventListener('click', function (e) {
      if (e.target === mask) {
        win.CX && win.CX.backStack && win.CX.backStack.pop();
        closeDialog();
      }
    });

    // 加载清单并渲染列表
    fetchManifest().then(function (manifest) {
      renderPackList(manifest.packs || []);
    }).catch(function (err) {
      document.getElementById('cxRpContent').innerHTML =
        '<div style="color:var(--error);padding:16px 0">获取清单失败：' + err.message + '</div>';
    });

    function renderPackList(packs) {
      var content = document.getElementById('cxRpContent');
      if (!packs.length) {
        content.innerHTML = '<div style="padding:16px 0;color:var(--text-secondary)">暂无资源包</div>';
        return;
      }

      // 检查所有包缓存状态
      Promise.all(packs.map(function (p) { return isPackCached(p); })).then(function (cachedArr) {
        var html = packs.map(function (pack, i) {
          var cached = cachedArr[i];
          return '<div class="cx-rp-item" id="cxRpItem_' + i + '" style="' +
            'display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-size:14px;font-weight:500;color:var(--text-primary)">' + pack.label + '</div>' +
              '<div style="font-size:12px;color:var(--text-secondary);margin-top:2px">' +
                pack.training_count + ' 个训练 · ' + fmtSize(pack.size_bytes) +
              '</div>' +
              '<div class="cx-rp-progress" id="cxRpProg_' + i + '" style="display:none;margin-top:6px">' +
                '<div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden">' +
                  '<div class="cx-rp-bar" id="cxRpBar_' + i + '" style="height:100%;width:0%;background:var(--brand);transition:width .2s"></div>' +
                '</div>' +
                '<div class="cx-rp-pct" id="cxRpPct_' + i + '" style="font-size:11px;color:var(--text-secondary);margin-top:2px">0%</div>' +
              '</div>' +
            '</div>' +
            '<button class="cx-rp-btn" id="cxRpBtn_' + i + '" data-idx="' + i + '" style="' +
              'flex-shrink:0;padding:5px 12px;border-radius:8px;border:1px solid var(--border);' +
              'font-size:12px;cursor:pointer;background:' + (cached ? 'var(--surface-alt)' : 'var(--brand)') + ';' +
              'color:' + (cached ? 'var(--text-secondary)' : '#fff') + '">' +
              (cached ? '✓ 已缓存' : '⬇ 下载') +
            '</button>' +
          '</div>';
        }).join('');
        content.innerHTML = html;

        // 绑定单包下载按钮
        packs.forEach(function (pack, i) {
          document.getElementById('cxRpBtn_' + i).addEventListener('click', function () {
            if (cachedArr[i]) return; // 已缓存，无需重复下载
            startPackDownload(pack, i, packs, cachedArr);
          });
        });

        // 全部下载按钮（有未缓存包才显示）
        var hasUncached = cachedArr.some(function (c) { return !c; });
        var allBtn = document.getElementById('cxRpDownloadAllBtn');
        if (allBtn && hasUncached) {
          allBtn.style.display = '';
          allBtn.addEventListener('click', function () {
            allBtn.disabled = true;
            allBtn.textContent = '下载中…';
            packs.reduce(function (promise, pack, i) {
              return promise.then(function () {
                if (cachedArr[i]) return Promise.resolve();
                return startPackDownload(pack, i, packs, cachedArr);
              });
            }, Promise.resolve()).then(function () {
              allBtn.textContent = '✓ 全部下载完成';
            }).catch(function (err) {
              allBtn.disabled = false;
              allBtn.textContent = '全部下载';
              alert('下载失败：' + err.message);
            });
          });
        }
      });
    }

    function startPackDownload(pack, i, packs, cachedArr) {
      var btn = document.getElementById('cxRpBtn_' + i);
      var progEl = document.getElementById('cxRpProg_' + i);
      var barEl = document.getElementById('cxRpBar_' + i);
      var pctEl = document.getElementById('cxRpPct_' + i);
      if (btn) { btn.disabled = true; btn.textContent = '下载中…'; }
      if (progEl) progEl.style.display = '';

      return downloadPack(pack, function (ratio) {
        var pct = Math.round(ratio * 100);
        if (barEl) barEl.style.width = pct + '%';
        if (pctEl) pctEl.textContent = pct + '%';
      }).then(function () {
        cachedArr[i] = true;
        if (btn) {
          btn.disabled = false;
          btn.textContent = '✓ 已缓存';
          btn.style.background = 'var(--surface-alt)';
          btn.style.color = 'var(--text-secondary)';
        }
        if (progEl) progEl.style.display = 'none';
        // 刷新主页 grid，使已下载的训练高亮显示
        if (win.refreshHomeGrid) win.refreshHomeGrid();
      }).catch(function (err) {
        if (btn) { btn.disabled = false; btn.textContent = '⬇ 重试'; }
        if (progEl) progEl.style.display = 'none';
        alert('下载失败：' + err.message);
        throw err;
      });
    }
  }

  // ── 公开 API ──────────────────────────────────────────────────────────────

  win.CXResourcePack = {
    showPacksDialog: showPacksDialog,
    isPackCached: isPackCached,
    downloadPack: downloadPack,
    downloadAll: downloadAll,
  };

}(window));
