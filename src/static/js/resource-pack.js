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
        // 标题
        '<div class="cx-dialog-title" style="padding:14px 16px 0;font-size:16px">训练资源管理</div>' +
        // 标签切换
        '<div style="display:flex;border-bottom:1px solid var(--border);margin:8px 16px 0;gap:0">' +
          '<button id="cxRpTabPack" style="flex:1;padding:7px 0;border:none;border-bottom:2px solid var(--brand);background:none;font-size:13px;font-weight:600;color:var(--brand);cursor:pointer">📦 历史资源包</button>' +
          '<button id="cxRpTabImport" style="flex:1;padding:7px 0;border:none;border-bottom:2px solid transparent;background:none;font-size:13px;color:var(--text-secondary);cursor:pointer">📥 本地导入</button>' +
        '</div>' +
        // 历史资源包面板
        '<div id="cxRpPanelPack">' +
          '<div id="cxRpContent" style="padding:0 16px 8px;max-height:55vh;overflow-y:auto">' +
            '<div style="text-align:center;padding:24px 0;color:var(--text-secondary)">⏳ 加载清单中…</div>' +
          '</div>' +
          '<div style="padding:8px 16px 12px;display:flex;gap:8px;justify-content:flex-end">' +
            '<button id="cxRpDownloadAllBtn" style="display:none;padding:7px 14px;background:var(--brand);color:#fff;border:none;border-radius:8px;font-size:13px;cursor:pointer">全部下载</button>' +
            '<button id="cxRpCloseBtn" style="padding:7px 20px;background:var(--surface-alt);border:1px solid var(--border);border-radius:8px;font-size:13px;cursor:pointer;color:var(--text-secondary)">关闭</button>' +
          '</div>' +
        '</div>' +
        // 本地导入面板（初始隐藏）
        '<div id="cxRpPanelImport" style="display:none">' +
          '<div style="padding:12px 16px 4px">' +
            '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;line-height:1.6">' +
              '支持独立训练（如 2026-1-ICSC.txt）或历史合辑（如 97-25-特会合辑.txt）。<br>导入内容保存在本机，无需网络。' +
            '</div>' +
            '<label style="display:inline-block;padding:7px 14px;background:var(--brand);color:#fff;border-radius:8px;font-size:13px;cursor:pointer">' +
              '📂 选择 TXT 文件' +
              '<input id="cxRpFileInput" type="file" accept=".txt" style="display:none">' +
            '</label>' +
          '</div>' +
          // 进度/状态区
          '<div id="cxRpImportStatus" style="padding:0 16px 4px;min-height:20px"></div>' +
          // 已导入列表
          '<div id="cxRpImportList" style="padding:0 16px 4px;max-height:45vh;overflow-y:auto">' +
            '<div style="text-align:center;padding:16px 0;color:var(--text-secondary);font-size:13px">⏳ 加载中…</div>' +
          '</div>' +
          '<div style="padding:8px 16px 12px;display:flex;justify-content:flex-end">' +
            '<button id="cxRpImportCloseBtn" style="padding:7px 20px;background:var(--surface-alt);border:1px solid var(--border);border-radius:8px;font-size:13px;cursor:pointer;color:var(--text-secondary)">关闭</button>' +
          '</div>' +
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
    document.getElementById('cxRpImportCloseBtn').addEventListener('click', function () {
      win.CX && win.CX.backStack && win.CX.backStack.pop();
      closeDialog();
    });
    mask.addEventListener('click', function (e) {
      if (e.target === mask) {
        win.CX && win.CX.backStack && win.CX.backStack.pop();
        closeDialog();
      }
    });

    // ── 标签切换 ──
    var tabPack = document.getElementById('cxRpTabPack');
    var tabImport = document.getElementById('cxRpTabImport');
    var panelPack = document.getElementById('cxRpPanelPack');
    var panelImport = document.getElementById('cxRpPanelImport');

    function switchTab(tab) {
      if (tab === 'pack') {
        tabPack.style.borderBottomColor = 'var(--brand)';
        tabPack.style.fontWeight = '600';
        tabPack.style.color = 'var(--brand)';
        tabImport.style.borderBottomColor = 'transparent';
        tabImport.style.fontWeight = '';
        tabImport.style.color = 'var(--text-secondary)';
        panelPack.style.display = '';
        panelImport.style.display = 'none';
      } else {
        tabImport.style.borderBottomColor = 'var(--brand)';
        tabImport.style.fontWeight = '600';
        tabImport.style.color = 'var(--brand)';
        tabPack.style.borderBottomColor = 'transparent';
        tabPack.style.fontWeight = '';
        tabPack.style.color = 'var(--text-secondary)';
        panelPack.style.display = 'none';
        panelImport.style.display = '';
      }
    }

    tabPack.addEventListener('click', function () { switchTab('pack'); });
    tabImport.addEventListener('click', function () {
      switchTab('import');
      refreshImportList();
    });

    // ── 本地导入面板逻辑 ──
    var fileInput = document.getElementById('cxRpFileInput');
    var importStatus = document.getElementById('cxRpImportStatus');
    var importList = document.getElementById('cxRpImportList');

    function setImportStatus(msg, type) {
      // type: '' | 'ok' | 'error' | 'progress'
      var color = type === 'error' ? 'var(--error,#d32f2f)' :
                  type === 'ok' ? 'var(--success-text,#2e7d32)' : 'var(--text-secondary)';
      importStatus.innerHTML = '<div style="font-size:12px;color:' + color + ';padding:4px 0;line-height:1.6">' + msg + '</div>';
    }

    function refreshImportList() {
      if (!win.CXLocalImport) {
        importList.innerHTML = '<div style="font-size:12px;color:var(--error);padding:8px 0">导入模块未加载</div>';
        return;
      }
      win.CXLocalImport.listImports().then(function (items) {
        if (!items.length) {
          importList.innerHTML = '<div style="text-align:center;padding:16px 0;color:var(--text-secondary);font-size:13px">暂无已导入训练</div>';
          return;
        }
        var html = items.map(function (item) {
          var date = item.importedAt ? new Date(item.importedAt).toLocaleDateString('zh-CN') : '';
          return '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-size:13px;font-weight:500;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(item.year + ' ' + (item.title || item.season || '')) + '</div>' +
              '<div style="font-size:11px;color:var(--text-secondary);margin-top:1px">' +
                (item.chapter_count || 0) + ' 篇' + (date ? ' · ' + date : '') +
              '</div>' +
            '</div>' +
            '<button class="cx-rp-del-btn" data-path="' + escAttr(item.path) + '" style="flex-shrink:0;padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;cursor:pointer;background:none;color:var(--text-secondary)">🗑</button>' +
          '</div>';
        }).join('');
        importList.innerHTML = html;
        // 绑定删除按钮
        var delBtns = importList.querySelectorAll('.cx-rp-del-btn');
        for (var i = 0; i < delBtns.length; i++) {
          (function(btn) {
            btn.addEventListener('click', function () {
              var path = btn.getAttribute('data-path');
              if (!confirm('确认删除该训练？')) return;
              win.CXLocalImport.deleteImport(path).then(function () {
                refreshImportList();
                if (win.refreshHomeGrid) win.refreshHomeGrid();
              }).catch(function (e) {
                alert('删除失败：' + e.message);
              });
            });
          })(delBtns[i]);
        }
      }).catch(function (e) {
        importList.innerHTML = '<div style="color:var(--error);font-size:12px;padding:8px 0">加载失败：' + escHtml(String(e)) + '</div>';
      });
    }

    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      if (!win.CXLocalImport) {
        setImportStatus('导入模块未加载', 'error');
        return;
      }
      setImportStatus('⏳ 正在读取文件…', '');
      var reader = new FileReader();
      reader.onload = function (e) {
        var text = e.target.result;
        var filename = file.name;
        // 显示进度条包装器
        importStatus.innerHTML = '<div style="font-size:12px;color:var(--text-secondary);padding:4px 0">' +
          '<div id="cxRpImportMsg">⏳ 正在解析…</div>' +
          '<div style="height:4px;background:var(--border);border-radius:2px;margin-top:4px;overflow:hidden">' +
            '<div id="cxRpImportBar" style="height:100%;background:var(--brand);width:0%;transition:width .2s"></div>' +
          '</div>' +
        '</div>';
        win.CXLocalImport.parseAndSave(text, filename, function (done, total, msg) {
          var msgEl = document.getElementById('cxRpImportMsg');
          var barEl = document.getElementById('cxRpImportBar');
          if (msgEl && msg) msgEl.textContent = msg;
          if (barEl && total) barEl.style.width = Math.round(done / total * 100) + '%';
        }).then(function (result) {
          setImportStatus('✅ 成功导入 ' + result.count + ' 个训练', 'ok');
          refreshImportList();
          if (win.refreshHomeGrid) win.refreshHomeGrid();
          fileInput.value = '';
        }).catch(function (err) {
          setImportStatus('❌ 导入失败：' + escHtml(String(err.message || err)), 'error');
          fileInput.value = '';
        });
      };
      reader.onerror = function () {
        setImportStatus('❌ 文件读取失败', 'error');
        fileInput.value = '';
      };
      reader.readAsText(file, 'UTF-8');
    });

    function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function escAttr(s) { return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;'); }

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
