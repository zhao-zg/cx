/*!
 * resource-pack.js — 历史训练资源包下载管理
 *
 * 暴露：window.CXResourcePack
 *   .showPacksDialog()    打开历史资源包下载弹层
 *   .showCachedDialog()   打开已缓存训练管理弹层
 *   .isPackCached(pack)   → Promise<boolean>  判断某资源包是否已缓存
 */
(function (win) {
  'use strict';

  var CACHE_NAME = 'cx-main';
  // cx_ 前缀与其他 localStorage 设置键保持一致；cx- 前缀仅用于 Cache API 名称
  var SOURCES_KEY = 'cx_pack_sources';

  // ── 工具 ───────────────────────────────────────────────────────────────────────────

  function getRoot() {
    return win.CX_ROOT || './';
  }

  // 将 zip 条目路径拼接为与 SW cache 一致的完整 URL
  function entryToUrl(entryName) {
    var clean = entryName.replace(/^\/+/, '');
    return win.location.origin + '/' + clean;
  }

  // 格式化字节数
  function fmtSize(bytes) {
    if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return bytes + ' B';
  }

  function escHtml(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function escAttr(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  // ── 清单获取 ──────────────────────────────────────────────────────────────────

  var _manifest = null;

  function fetchManifest() {
    if (_manifest) return Promise.resolve(_manifest);
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

  // ── 缓存检查 ──────────────────────────────────────────────────────────────────

  function isPackCached(pack) {
    if (!('caches' in win)) return Promise.resolve(false);
    var probe = pack.trainings && pack.trainings[0];
    if (!probe) return Promise.resolve(false);
    var url = entryToUrl(probe.path + '/training.json');
    return caches.open(CACHE_NAME).then(function (cache) {
      return cache.match(url).then(function (r) { return !!r; });
    }).catch(function () { return false; });
  }

  function isTrainingCached(trainingPath) {
    if (!('caches' in win)) return Promise.resolve(false);
    var url = win.location.origin + '/' + trainingPath + '/training.json';
    return caches.open(CACHE_NAME).then(function (cache) {
      return cache.match(url).then(function (r) { return !!r; });
    }).catch(function () { return false; });
  }

  // ── 来源追踪 ──────────────────────────────────────────────────────────────────
  // sources 格式：{ "<trainingPath>": { packPath, packLabel, ts }, … }

  function _loadSources() {
    // 迁移旧 key（cx-pack-sources → cx_pack_sources）
    try {
      var old = win.localStorage.getItem('cx-pack-sources');
      if (old) { win.localStorage.setItem(SOURCES_KEY, old); win.localStorage.removeItem('cx-pack-sources'); }
    } catch (e) {}
    try { return JSON.parse(win.localStorage.getItem(SOURCES_KEY) || '{}'); }
    catch (e) { return {}; }
  }

  function _saveSources(obj) {
    try { win.localStorage.setItem(SOURCES_KEY, JSON.stringify(obj)); } catch (e) {}
  }

  function _markPackSources(pack) {
    var sources = _loadSources();
    var ts = Date.now();
    (pack.trainings || []).forEach(function (t) {
      sources[t.path] = { packPath: pack.path, packLabel: pack.label, ts: ts };
    });
    _saveSources(sources);
  }

  // ── 删除操作（模块级，供多 dialog 共享） ───────────────────────────────────

  // 来源感知删除整包：只删该包下载且未被后续操作覆写的训练
  function deletePack(pack, onDone) {
    if (!('caches' in win)) { if (onDone) onDone(); return; }
    var sources = _loadSources();
    var pathsToDelete = (pack.trainings || []).filter(function (t) {
      var rec = sources[t.path];
      return !rec || rec.packPath === pack.path;
    }).map(function (t) { return t.path; });
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.keys().then(function (keys) {
        var toDelete = keys.filter(function (req) {
          var p = new URL(req.url).pathname.replace(/^\/+/, '');
          return pathsToDelete.some(function (tp) {
            return p === tp + '/training.json' || p.startsWith(tp + '/');
          });
        });
        return Promise.all(toDelete.map(function (req) { return cache.delete(req); }));
      });
    }).then(function () {
      var newSources = _loadSources();
      pathsToDelete.forEach(function (tp) { delete newSources[tp]; });
      _saveSources(newSources);
      if (onDone) onDone();
    }).catch(function () { if (onDone) onDone(); });
  }

  // 删除单个训练缓存：同时清命名缓存 cx-{path} 和 cx-main 内的条目
  function deleteTraining(trainingPath, onDone) {
    if (!('caches' in win)) { if (onDone) onDone(); return; }
    var prefix = '/' + trainingPath + '/';
    var namedName = 'cx-' + trainingPath;
    // 1. 删除命名缓存（初始安装流程写入的 cx-YYYY-NN）
    var p1 = caches.has(namedName).then(function (exists) {
      if (exists) return caches.delete(namedName);
    }).catch(function () {});
    // 2. 删除 cx-main 内该训练的所有条目（资源包写入的）
    var p2 = caches.open(CACHE_NAME).then(function (cache) {
      return cache.keys().then(function (keys) {
        var toDelete = keys.filter(function (req) {
          var p = new URL(req.url).pathname;
          return p === prefix || p.startsWith(prefix);
        });
        return Promise.all(toDelete.map(function (req) { return cache.delete(req); }));
      });
    }).catch(function () {});
    Promise.all([p1, p2])
      .then(function () { if (onDone) onDone(); })
      .catch(function () { if (onDone) onDone(); });
  }

  // ── 下载资源包 ──────────────────────────────────────────────────────────────────

  function downloadPack(pack, onProgress) {
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
                if (onProgress && total) onProgress(loaded / total * 0.8);
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
              var ext = item.path.split('.').pop().toLowerCase();
              var mimeMap = {
                json: 'application/json', js: 'application/javascript',
                png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
                gif: 'image/gif', webp: 'image/webp',
              };
              var mime = mimeMap[ext] || 'application/octet-stream';
              var blob = new Blob([buf], { type: mime });
              var resp = new Response(blob, { status: 200, headers: { 'Content-Type': mime } });
              return cache.put(url, resp);
            }).then(function () {
              if (onProgress) onProgress(0.8 + (done / files.length) * 0.2);
              return nextFile();
            });
          }
          return nextFile();
        });
      })
      .then(function () {
        _markPackSources(pack);
      });
  }

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

  // ── 历史资源包下载 dialog ───────────────────────────────────────────────────────────────

  function showPacksDialog(backFn) {
    var existing = document.getElementById('cxResourcePackMask');
    if (existing) { document.body.removeChild(existing); }
    var mask = document.createElement('div');
    mask.id = 'cxResourcePackMask';
    mask.className = 'cx-dialog-mask';
    var titleHtml = backFn
      ? '<div style="display:flex;align-items:center;gap:6px;padding:14px 16px 10px">' +
          '<button id="cxRpBackBtn" style="padding:4px 8px;background:none;border:none;font-size:16px;cursor:pointer;color:var(--text-secondary);line-height:1">←</button>' +
          '<span style="font-size:16px;font-weight:600;color:var(--heading)">历史资源包</span>' +
        '</div>'
      : '<div class="cx-dialog-title" style="padding:14px 16px 10px;font-size:16px">历史资源包</div>';
    mask.innerHTML =
      '<div class="cx-dialog" style="max-width:420px;padding:0 0 4px">' +
        titleHtml +
        '<div id="cxRpContent" style="padding:0 16px 8px;max-height:55vh;overflow-y:auto">' +
          '<div style="text-align:center;padding:24px 0;color:var(--text-secondary)">⏳ 加载清单中…</div>' +
        '</div>' +
        '<div style="padding:8px 16px 12px;display:flex;gap:8px;justify-content:flex-end">' +
          '<button id="cxRpDownloadAllBtn" style="display:none;padding:7px 14px;background:var(--brand);color:#fff;border:none;border-radius:8px;font-size:13px;cursor:pointer">全部下载</button>' +
          (backFn ? '<button id="cxRpCloseBtn" style="padding:7px 20px;background:var(--surface-alt);border:1px solid var(--border);border-radius:8px;font-size:13px;cursor:pointer;color:var(--text-secondary)">← 返回</button>'
                  : '<button id="cxRpCloseBtn" style="padding:7px 20px;background:var(--surface-alt);border:1px solid var(--border);border-radius:8px;font-size:13px;cursor:pointer;color:var(--text-secondary)">关闭</button>') +
        '</div>' +
      '</div>';
    document.body.appendChild(mask);
    function doClose() { if (mask.parentNode) mask.parentNode.removeChild(mask); }
    function closeDialog() { doClose(); if (backFn) backFn(); }
    win.CX && win.CX.backStack && win.CX.backStack.push(closeDialog);
    document.getElementById('cxRpCloseBtn').addEventListener('click', function () {
      win.CX && win.CX.backStack && win.CX.backStack.pop(); closeDialog();
    });
    if (backFn) {
      var backBtn = document.getElementById('cxRpBackBtn');
      if (backBtn) backBtn.addEventListener('click', function () {
        win.CX && win.CX.backStack && win.CX.backStack.pop(); closeDialog();
      });
    }
    mask.addEventListener('click', function (e) {
      if (e.target === mask) { win.CX && win.CX.backStack && win.CX.backStack.pop(); doClose(); }
    });
    fetchManifest().then(function (manifest) {
      renderPacksUI(manifest.packs || []);
    }).catch(function (err) {
      document.getElementById('cxRpContent').innerHTML =
        '<div style="color:var(--error);padding:16px 0">获取清单失败：' + escHtml(err.message) + '</div>';
    });
    function makeRow(id, labelHtml, subHtml, progId, barId, pctId, btnId) {
      return '<div class="cx-rp-item" id="' + id + '" style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:14px;font-weight:500;color:var(--text-primary)">' + labelHtml + '</div>' +
          '<div style="font-size:12px;color:var(--text-secondary);margin-top:2px">' + subHtml + '</div>' +
          '<div class="cx-rp-progress" id="' + progId + '" style="display:none;margin-top:6px">' +
            '<div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden">' +
              '<div class="cx-rp-bar" id="' + barId + '" style="height:100%;width:0%;background:var(--brand);transition:width .2s"></div>' +
            '</div>' +
            '<div class="cx-rp-pct" id="' + pctId + '" style="font-size:11px;color:var(--text-secondary);margin-top:2px">0%</div>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:5px;flex-shrink:0" id="' + btnId + '_wrap"></div>' +
      '</div>';
    }
    function makeActionBtns(btnId, isCached, onDownload, onDelete) {
      var wrap = document.getElementById(btnId + '_wrap');
      if (!wrap) return;
      wrap.innerHTML = '';
      if (isCached) {
        if (onDelete) {
          var dBtn = document.createElement('button');
          dBtn.textContent = '🗑'; dBtn.title = '删除缓存';
          dBtn.style.cssText = 'padding:5px 9px;border-radius:8px;border:1px solid var(--border);font-size:12px;cursor:pointer;background:none;color:var(--text-secondary)';
          dBtn.addEventListener('click', onDelete); wrap.appendChild(dBtn);
        }
        var cBtn = document.createElement('button');
        cBtn.textContent = '✓ 已缓存'; cBtn.disabled = true;
        cBtn.style.cssText = 'padding:5px 12px;border-radius:8px;border:1px solid var(--border);font-size:12px;cursor:default;background:var(--surface-alt);color:var(--text-secondary)';
        wrap.appendChild(cBtn);
      } else if (onDownload) {
        var dlBtn = document.createElement('button');
        dlBtn.id = btnId;
        dlBtn.textContent = '⬇ 下载';
        dlBtn.style.cssText = 'padding:5px 12px;border-radius:8px;border:none;font-size:12px;cursor:pointer;background:var(--brand);color:#fff';
        dlBtn.addEventListener('click', onDownload); wrap.appendChild(dlBtn);
      } else {
        var iBtn = document.createElement('button');
        iBtn.textContent = '未缓存'; iBtn.disabled = true;
        iBtn.style.cssText = 'padding:5px 12px;border-radius:8px;border:1px solid var(--border);font-size:12px;cursor:default;background:none;color:var(--text-secondary)';
        wrap.appendChild(iBtn);
      }
    }
    function renderPacksUI(packs) {
      var content = document.getElementById('cxRpContent');
      if (!packs.length) {
        content.innerHTML = '<div style="padding:16px 0;color:var(--text-secondary)">暂无资源包</div>';
        return;
      }
      var html = '';
      packs.forEach(function (pack, i) {
        html += makeRow('cxRpPk_' + i, escHtml(pack.label),
          escHtml(pack.training_count + ' 个训练 · ' + fmtSize(pack.size_bytes)),
          'cxRpPkProg_' + i, 'cxRpPkBar_' + i, 'cxRpPkPct_' + i, 'cxRpPkBtn_' + i);
      });
      content.innerHTML = html;
      var cachedArr = new Array(packs.length).fill(false);
      Promise.all(packs.map(isPackCached)).then(function (arr) {
        arr.forEach(function (c, i) { cachedArr[i] = c; });
        packs.forEach(function (pack, i) {
          (function bindPack(pk, idx) {
            function refreshBtn() {
              makeActionBtns('cxRpPkBtn_' + idx, cachedArr[idx],
                cachedArr[idx] ? null : function () { startPackDownload(pk, idx, packs, cachedArr); },
                cachedArr[idx] ? function () {
                  if (!confirm('确认删除"’ + pk.label + ""的缓存？\n（仅删除由该包下载且未被后续操作替换的训练）')) return;
                  deletePack(pk, function () {
                    cachedArr[idx] = false; refreshBtn();
                    if (win.refreshHomeGrid) win.refreshHomeGrid();
                  });
                } : null
              );
            }
            refreshBtn();
          })(pack, i);
        });
        var hasUncached = cachedArr.some(function (c) { return !c; });
        var allBtn = document.getElementById('cxRpDownloadAllBtn');
        if (allBtn && hasUncached) {
          allBtn.style.display = '';
          allBtn.addEventListener('click', function () {
            allBtn.disabled = true; allBtn.textContent = '下载中…';
            packs.reduce(function (p, pack, i) {
              return p.then(function () {
                if (cachedArr[i]) return Promise.resolve();
                return startPackDownload(pack, i, packs, cachedArr);
              });
            }, Promise.resolve()).then(function () {
              allBtn.textContent = '✓ 全部下载完成';
            }).catch(function (err) {
              allBtn.disabled = false; allBtn.textContent = '全部下载';
              alert('下载失败：' + err.message);
            });
          });
        }
      });
    }
    function startPackDownload(pack, i, packs, cachedArr) {
      var progEl = document.getElementById('cxRpPkProg_' + i);
      var barEl  = document.getElementById('cxRpPkBar_' + i);
      var pctEl  = document.getElementById('cxRpPkPct_' + i);
      var wrap   = document.getElementById('cxRpPkBtn_' + i + '_wrap');
      if (wrap) wrap.innerHTML = '<button disabled style="padding:5px 12px;border-radius:8px;border:none;font-size:12px;background:var(--surface-alt);color:var(--text-secondary)">下载中…</button>';
      if (progEl) progEl.style.display = '';
      return downloadPack(pack, function (ratio) {
        var pct = Math.round(ratio * 100);
        if (barEl) barEl.style.width = pct + '%';
        if (pctEl) pctEl.textContent = pct + '%';
      }).then(function () {
        cachedArr[i] = true;
        if (progEl) progEl.style.display = 'none';
        makeActionBtns('cxRpPkBtn_' + i, true, null, function () {
          if (!confirm('确认删除"’ + pack.label + ""的缓存？\n（仅删除由该包下载且未被后续操作替换的训练）')) return;
          deletePack(pack, function () {
            cachedArr[i] = false;
            makeActionBtns('cxRpPkBtn_' + i, false,
              function () { startPackDownload(pack, i, packs, cachedArr); }, null);
            if (win.refreshHomeGrid) win.refreshHomeGrid();
          });
        });
        if (win.refreshHomeGrid) win.refreshHomeGrid();
      }).catch(function (err) {
        if (progEl) progEl.style.display = 'none';
        if (wrap) wrap.innerHTML = '<button style="padding:5px 12px;border-radius:8px;border:none;font-size:12px;cursor:pointer;background:var(--brand);color:#fff">⬇ 重试</button>';
        var retryBtn = wrap && wrap.querySelector('button');
        if (retryBtn) retryBtn.addEventListener('click', function () { startPackDownload(pack, i, packs, cachedArr); });
        alert('下载失败：' + err.message);
        throw err;
      });
    }
  }

  // ── 已缓存训练管理 dialog ───────────────────────────────────────────────────────────────

  function showCachedDialog() {
    var existing = document.getElementById('cxCacheMgrMask');
    if (existing) { document.body.removeChild(existing); }
    var mask = document.createElement('div');
    mask.id = 'cxCacheMgrMask';
    mask.className = 'cx-dialog-mask';
    mask.innerHTML =
      '<div class="cx-dialog" style="max-width:440px;padding:0 0 4px;position:relative">' +
        '<div class="cx-dialog-title" style="padding:14px 16px 0;font-size:16px">已缓存训练</div>' +
        '<div id="cxCmSelBar" style="display:none;padding:6px 16px;background:var(--surface-alt);border-bottom:1px solid var(--border)">' +
          '<label style="display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--text-secondary);cursor:pointer">' +
            '<input type="checkbox" id="cxCmSelectAll" style="margin:0"> 全选' +
          '</label>' +
          '<button id="cxCmDeleteSel" style="float:right;padding:5px 14px;border-radius:8px;border:none;font-size:12px;cursor:pointer;background:#d32f2f;color:#fff">删除选中(0)</button>' +
        '</div>' +
        '<div id="cxCmContent" style="padding:0 16px 8px;max-height:55vh;overflow-y:auto">' +
          '<div style="text-align:center;padding:24px 0;color:var(--text-secondary)">⏳ 加载中…</div>' +
        '</div>' +
        '<div style="padding:8px 16px 12px;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">' +
          '<button id="cxCmPacksBtn" style="padding:7px 14px;background:var(--surface-alt);color:var(--text-primary);border:1px solid var(--border);border-radius:8px;font-size:13px;cursor:pointer;white-space:nowrap">📦 资源包</button>' +
          '<button id="cxCmImportBtn" style="padding:7px 14px;background:var(--surface-alt);color:var(--text-primary);border:1px solid var(--border);border-radius:8px;font-size:13px;cursor:pointer;white-space:nowrap">📂 导入</button>' +
          '<button id="cxCmCloseBtn" style="padding:7px 20px;background:var(--surface-alt);border:1px solid var(--border);border-radius:8px;font-size:13px;cursor:pointer;color:var(--text-secondary);white-space:nowrap">关闭</button>' +
        '</div>' +
        '<div id="cxCmImportOverlay" style="display:none;position:absolute;inset:0;background:rgba(0,0,0,.45);border-radius:inherit;align-items:center;justify-content:center;z-index:10">' +
          '<div style="background:var(--surface);border-radius:12px;padding:20px 24px;min-width:220px;text-align:center">' +
            '<div id="cxCmImportMsg" style="font-size:13px;color:var(--text-primary);margin-bottom:8px">解析中…</div>' +
            '<div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden">' +
              '<div id="cxCmImportBar" style="height:100%;width:0%;background:var(--brand);transition:width .3s"></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(mask);
    win.CX && win.CX.backStack && win.CX.backStack.push(closeDialog);
    function closeDialog() { if (mask.parentNode) mask.parentNode.removeChild(mask); }
    document.getElementById('cxCmCloseBtn').addEventListener('click', function () {
      win.CX && win.CX.backStack && win.CX.backStack.pop(); closeDialog();
    });
    document.getElementById('cxCmPacksBtn').addEventListener('click', function () {
      win.CX && win.CX.backStack && win.CX.backStack.pop(); closeDialog();
      showPacksDialog(showCachedDialog);
    });
    mask.addEventListener('click', function (e) {
      if (e.target === mask) { win.CX && win.CX.backStack && win.CX.backStack.pop(); closeDialog(); }
    });
    var selBar       = document.getElementById('cxCmSelBar');
    var selectAllChk = document.getElementById('cxCmSelectAll');
    var deleteSelBtn = document.getElementById('cxCmDeleteSel');
    function getCheckboxes() {
      return Array.prototype.slice.call(
        document.querySelectorAll('#cxCmContent input[type=checkbox][data-path]')
      );
    }
    function updateSelBar() {
      var boxes   = getCheckboxes();
      var checked = boxes.filter(function (b) { return b.checked; });
      if (boxes.length) {
        selBar.style.display = '';
        deleteSelBtn.textContent        = '删除选中(' + checked.length + ')';
        deleteSelBtn.disabled           = checked.length === 0;
        selectAllChk.indeterminate      = checked.length > 0 && checked.length < boxes.length;
        selectAllChk.checked            = boxes.length > 0 && checked.length === boxes.length;
      } else {
        selBar.style.display = 'none';
      }
    }
    selectAllChk.addEventListener('change', function () {
      getCheckboxes().forEach(function (b) { b.checked = selectAllChk.checked; });
      updateSelBar();
    });
    deleteSelBtn.addEventListener('click', function () {
      var boxes = getCheckboxes().filter(function (b) { return b.checked; });
      if (!boxes.length) return;
      if (!confirm('确认删除选中的 ' + boxes.length + ' 个训练？')) return;
      deleteSelBtn.disabled = true; deleteSelBtn.textContent = '删除中…';
      boxes.reduce(function (p, b) {
        return p.then(function () {
          var path = b.getAttribute('data-path');
          var src  = b.getAttribute('data-src');
          if (src === 'local') return win.CXLocalImport ? win.CXLocalImport.deleteImport(path) : Promise.resolve();
          return new Promise(function (res) { deleteTraining(path, res); });
        });
      }, Promise.resolve()).then(function () {
        if (win.refreshHomeGrid) win.refreshHomeGrid();
        refreshContent();
      }).catch(function () { refreshContent(); });
    });
    // 每次点击动态创建 input，不使用 accept 过滤，兼容各类 PWA/Android 文件管理器
    document.getElementById('cxCmImportBtn').addEventListener('click', function () {
      if (!win.CXLocalImport) { alert('导入模块未加载'); return; }
      var fi = document.createElement('input');
      fi.type = 'file';
      fi.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;width:1px;height:1px';
      document.body.appendChild(fi);
      fi.addEventListener('change', function () {
        var file = fi.files && fi.files[0];
        document.body.removeChild(fi);
        if (!file) return;
        var overlay = document.getElementById('cxCmImportOverlay');
        var msgEl   = document.getElementById('cxCmImportMsg');
        var barEl   = document.getElementById('cxCmImportBar');
        if (overlay) overlay.style.display = 'flex';
        var reader = new FileReader();
        reader.onload = function (e) {
          win.CXLocalImport.parseAndSave(e.target.result, file.name, function (done, total, msg) {
            if (msgEl) msgEl.textContent = msg || ('解析中 ' + done + '/' + total);
            if (barEl && total) barEl.style.width = Math.round(done / total * 100) + '%';
          }).then(function () {
            if (overlay) overlay.style.display = 'none';
            if (win.refreshHomeGrid) win.refreshHomeGrid();
            refreshContent();
          }).catch(function (err) {
            if (overlay) overlay.style.display = 'none';
            alert('导入失败：' + err.message);
          });
        };
        reader.onerror = function () {
          if (overlay) overlay.style.display = 'none';
          alert('文件读取失败，请重试');
        };
        reader.readAsText(file, 'utf-8');
      });
      fi.click();
    });
    refreshContent();
    function refreshContent() {
      var content = document.getElementById('cxCmContent');
      if (!content) return;
      content.innerHTML = '<div style="text-align:center;padding:24px 0;color:var(--text-secondary)">⏳ 加载中…</div>';
      selBar.style.display = 'none';
      var sources = _loadSources();
      var packGroupMap = {};
      Object.keys(sources).forEach(function (tp) {
        var rec = sources[tp];
        var key = rec.packLabel + '||' + rec.packPath;
        if (!packGroupMap[key]) packGroupMap[key] = { packLabel: rec.packLabel, packPath: rec.packPath, paths: [] };
        packGroupMap[key].paths.push(tp);
      });
      var packGroups = Object.keys(packGroupMap).map(function (k) { return packGroupMap[k]; });
      var p_packCached = ('caches' in win)
        ? Promise.all(packGroups.map(function (g) {
            var url = win.location.origin + '/' + g.paths[0] + '/training.json';
            return caches.open(CACHE_NAME).then(function (c) {
              return c.match(url).then(function (r) { return !!r; });
            }).catch(function () { return false; });
          }))
        : Promise.resolve([]);
      var p_netPaths = ('caches' in win)
        ? caches.keys().then(function (allKeys) {
            // 1. 命名缓存 cx-YYYY-NN（初始安装、单独缓存训练写入）
            var sources = _loadSources();
            var fromNamed = allKeys
              .filter(function (k) { return /^cx-\d{4}-\d{2}$/.test(k); })
              .map(function (k) { return k.slice(3); })        // 去掉 'cx-' 前缀
              .filter(function (tp) { return !sources[tp]; }); // 排除已在资源包来源里的
            // 2. cx-main 中匹配 YYYY-NN/training.json 且不在 sources 的条目
            return caches.open(CACHE_NAME).then(function (cache) {
              return cache.keys().then(function (keys) {
                var seen = {};
                fromNamed.forEach(function (tp) { seen[tp] = true; });
                keys.forEach(function (req) {
                  var m = new URL(req.url).pathname.match(/^\/?([\d]{4}-[\d]{2})\/training\.json$/);
                  if (m && !sources[m[1]]) seen[m[1]] = true;
                });
                return Object.keys(seen).sort().reverse();
              });
            });
          })
        : Promise.resolve([]);
      var p_netTrainings = p_netPaths.then(function (paths) {
        return Promise.all(paths.map(function (tp) {
          var url = win.location.origin + '/' + tp + '/training.json';
          // 优先找命名缓存 cx-YYYY-NN，再找 cx-main
          return caches.open('cx-' + tp).then(function (c) {
            return c.match(url);
          }).catch(function () { return null; }).then(function (r) {
            if (r) return r;
            return caches.open(CACHE_NAME).then(function (c) {
              return c.match(url);
            }).catch(function () { return null; });
          }).then(function (r) {
            if (!r) return null;
            return r.json().then(function (d) {
              return { path: tp, title: d.title || tp, chapter_count: (d.chapters || []).length };
            }).catch(function () { return { path: tp, title: tp, chapter_count: 0 }; });
          }).catch(function () { return null; });
        })).then(function (arr) { return arr.filter(Boolean); });
      });
      var p_local = win.CXLocalImport
        ? win.CXLocalImport.listImports().catch(function () { return []; })
        : Promise.resolve([]);
      Promise.all([p_packCached, p_netTrainings, p_local]).then(function (res) {
        var packCachedArr = res[0], netTrainings = res[1], localImports = res[2];
        var html = '', hasAny = false;
        var cachedPacks = packGroups.filter(function (g, i) { return packCachedArr[i]; });
        if (cachedPacks.length) {
          hasAny = true;
          html += '<div style="font-size:11px;font-weight:600;color:var(--text-secondary);padding:10px 0 4px;letter-spacing:.05em">📦 来自资源包</div>';
          cachedPacks.forEach(function (g) {
            html +=
              '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">' +
                '<div style="flex:1;min-width:0">' +
                  '<div style="font-size:13px;font-weight:500;color:var(--text-primary)">' + escHtml(g.packLabel) + '</div>' +
                  '<div style="font-size:11px;color:var(--text-secondary);margin-top:1px">' + g.paths.length + ' 个训练</div>' +
                '</div>' +
                '<button class="cx-cm-del-pack" data-pack-key="' + escAttr(g.packLabel + '||' + g.packPath) + '"'  +
                  ' style="padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;cursor:pointer;background:none;color:var(--text-secondary)">🗑</button>' +
              '</div>';
          });
        }
        // 合并 net + local 为统一列表：本地导入优先（屏蔽同序号网络缓存），按 YYYY-NN 倒序
        var localKeySet = {};
        localImports.forEach(function (li) { localKeySet[li.path.replace(/^local-/, '')] = true; });
        var netFiltered = netTrainings.filter(function (tr) { return !localKeySet[tr.path]; });
        var unifiedItems = netFiltered.map(function (tr) {
          return { type: 'net', path: tr.path, title: tr.title,
                   chapter_count: tr.chapter_count, sortKey: tr.path };
        }).concat(localImports.map(function (item) {
          return { type: 'local', path: item.path,
                   title: item.year + ' ' + (item.title || item.season || ''),
                   chapter_count: item.chapter_count, importedAt: item.importedAt,
                   sortKey: item.path.replace(/^local-/, '') };
        }));
        unifiedItems.sort(function (a, b) { return b.sortKey.localeCompare(a.sortKey); });
        if (unifiedItems.length) {
          hasAny = true;
          unifiedItems.forEach(function (item) {
            var badge = item.type === 'local'
              ? ' <span style="display:inline-block;font-size:10px;padding:1px 5px;background:rgba(0,112,204,.1);color:var(--brand);border:1px solid var(--brand);border-radius:4px;margin-left:4px;white-space:nowrap;vertical-align:middle;line-height:1.4">本地</span>'
              : '';
            var sub = (item.chapter_count || 0) + ' 篇';
            if (item.type === 'local' && item.importedAt) sub += ' · ' + new Date(item.importedAt).toLocaleDateString('zh-CN');
            html +=
              '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">' +
                '<input type="checkbox" data-path="' + escAttr(item.path) + '" data-src="' + item.type + '" style="flex-shrink:0;margin:0;width:15px;height:15px">' +
                '<div style="flex:1;min-width:0;overflow:hidden">' +
                  '<div style="font-size:13px;font-weight:500;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
                    escHtml(item.title) + badge +
                  '</div>' +
                  '<div style="font-size:11px;color:var(--text-secondary);margin-top:1px">' + sub + '</div>' +
                '</div>' +
                '<button class="cx-cm-del-one" data-path="' + escAttr(item.path) + '" data-src="' + item.type + '"' +
                  ' style="padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;cursor:pointer;background:none;color:var(--text-secondary)">🗑</button>' +
              '</div>';
          });
        }
        if (!hasAny) html = '<div style="text-align:center;padding:32px 0;color:var(--text-secondary)">暂无已缓存训练</div>';
        content.innerHTML = html;
        updateSelBar();
        getCheckboxes().forEach(function (cb) { cb.addEventListener('change', updateSelBar); });
        var packDelBtns = content.querySelectorAll('.cx-cm-del-pack');
        for (var pi = 0; pi < packDelBtns.length; pi++) {
          (function (btn) {
            btn.addEventListener('click', function () {
              var key = btn.getAttribute('data-pack-key');
              var g   = packGroupMap[key];
              if (!g) return;
              if (!confirm('确认删除"' + g.packLabel + '"的缓存？\n（仅删除由该包下载且未被后续操作替换的训练）')) return;
              var fakePack = { path: g.packPath, label: g.packLabel,
                trainings: g.paths.map(function (p) { return { path: p }; }) };
              deletePack(fakePack, function () {
                if (win.refreshHomeGrid) win.refreshHomeGrid();
                refreshContent();
              });
            });
          })(packDelBtns[pi]);
        }
        var delOneBtns = content.querySelectorAll('.cx-cm-del-one');
        for (var di = 0; di < delOneBtns.length; di++) {
          (function (btn) {
            btn.addEventListener('click', function () {
              var path = btn.getAttribute('data-path');
              var src  = btn.getAttribute('data-src');
              if (!confirm('确认删除该训练的缓存？')) return;
              var done = function () {
                if (win.refreshHomeGrid) win.refreshHomeGrid();
                refreshContent();
              };
              src === 'local'
                ? (win.CXLocalImport ? win.CXLocalImport.deleteImport(path).then(done) : done())
                : deleteTraining(path, done);
            });
          })(delOneBtns[di]);
        }
      }).catch(function () {
        if (content) content.innerHTML = '<div style="color:var(--error);padding:16px 0">加载失败，请重试</div>';
      });
    }
  }

  // ── 公开 API ──────────────────────────────────────────────────────────────────

  win.CXResourcePack = {
    showPacksDialog: showPacksDialog,
    showCachedDialog: showCachedDialog,
    isPackCached: isPackCached,
    downloadPack: downloadPack,
    downloadAll: downloadAll,
  };

}(window));