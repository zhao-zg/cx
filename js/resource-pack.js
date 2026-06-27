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
  // 记录初始安装的训练元数据，供删除后展示"可恢复"状态用
  var INITIAL_TRAININGS_KEY = 'cx_initial_trainings';

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
    var bust = '?t=' + Date.now();
    var urls = servers.map(function (s) {
      return s.replace(/\/$/, '') + '/resource-packs.json' + bust;
    });
    urls.push(getRoot() + 'resource-packs.json' + bust);

    if (!win.CX || !win.CX.raceFastest) {
      // 降级：顺序 fallback
      function tryNext(idx) {
        if (idx >= urls.length) return Promise.reject(new Error('无法获取资源包清单'));
        return fetch(urls[idx], { cache: 'no-cache' })
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

    return win.CX.raceFastest(urls, {
      fetchOptions: { cache: 'no-cache' },
      timeout: 10000,
      logPrefix: '[资源清单]',
      validate: function (r) { return r && r.ok; },
      transform: function (r) { return r.json(); }
    }).then(function (result) {
      console.log('[资源清单] 命中: 镜像 #' + (result.idx + 1) + ' (' + result.url + ')');
      _manifest = result.value;
      return result.value;
    });
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

  function _loadInitialTrainings() {
    try { return JSON.parse(win.localStorage.getItem(INITIAL_TRAININGS_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function _saveInitialTrainings(obj) {
    try { win.localStorage.setItem(INITIAL_TRAININGS_KEY, JSON.stringify(obj)); } catch (e) {}
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

  // 恢复已删除的初始安装训练：从服务器重新下载 training.json 缓存到 cx-main
  // onSuccess 回调由调用方（在对话框闭包内）提供，避免模块级函数访问闭包变量
  function restoreInitialTraining(trainingPath, rowEl, onSuccess) {
    var url = win.location.origin + '/' + trainingPath + '/training.json';
    var btn = rowEl.querySelector('.cx-restore-initial');
    if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
    caches.open(CACHE_NAME).then(function (cache) {
      return fetch(url, { cache: 'no-cache' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return cache.put(url, r);
      });
    }).then(function () {
      if (win.refreshHomeGrid) win.refreshHomeGrid();
      if (onSuccess) onSuccess();
    }).catch(function (err) {
      if (btn) { btn.disabled = false; btn.textContent = '↺ 重新安装'; }
      alert('恢复失败：' + (err && err.message ? err.message : '网络错误'));
    });
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
      var urls = baseUrls.map(function (b) { return b + '/' + pack.path; });

      // 资源包可能较大，多个 server 并发拉取会浪费带宽，故使用保守超时
      var RACE_TIMEOUT = 12000;

      function pumpZip(response) {
        var total = parseInt(response.headers.get('content-length') || '0', 10) || pack.size_bytes || 0;
        var loaded = 0;
        var reader = response.body && response.body.getReader();
        if (!reader) return response.arrayBuffer();
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
      }

      if (!win.CX || !win.CX.raceFastest) {
        // 降级：顺序 fallback
        function tryServer(idx) {
          if (idx >= urls.length) return Promise.reject(new Error('所有镜像均失败'));
          return fetch(urls[idx], { cache: 'no-cache' })
            .then(function (r) {
              if (!r.ok) throw new Error('HTTP ' + r.status);
              return pumpZip(r);
            })
            .catch(function () { return tryServer(idx + 1); });
        }
        return tryServer(0);
      }

      // 并发竞速：所有 server 同时拉取，首个响应到达即中止其余并使用其 body
      return win.CX.raceFastest(urls, {
        fetchOptions: { cache: 'no-cache' },
        timeout: RACE_TIMEOUT,
        logPrefix: '[资源包]',
        validate: function (r) { return r && r.ok; },
        transform: function (r) { return r; } // 透传 response，reader 仍在响应体内
      }).then(function (result) {
        console.log('[资源包] 命中: 镜像 #' + (result.idx + 1) + ' (' + result.url + ')');
        return pumpZip(result.value);
      });
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

  // ── 资源管理 dialog（3-Tab：默认 / 历史 / 导入）─────────────────────────────

  // showPacksDialog 现在作为 showCachedDialog 的别名，并切换到历史 Tab
  function showPacksDialog(backFn) {
    showCachedDialog(backFn, 'history');
  }

  function showCachedDialog(backFn, initialTab) {
    var activeTab = initialTab || 'default';
    // 追踪哪些 Tab 已经加载过数据，避免重复请求
    var tabLoaded = { 'default': false, history: false, 'import': false };

    var _tabBtn = 'flex:1;padding:10px 4px;background:none;border:none;border-bottom:2px solid transparent;font-size:13px;cursor:pointer;font-weight:500;color:var(--text-secondary);transition:color .15s,border-color .15s;-webkit-tap-highlight-color:transparent';
    var _tabBtnActive = 'flex:1;padding:10px 4px;background:none;border:none;border-bottom:2px solid var(--brand);font-size:13px;cursor:pointer;font-weight:600;color:var(--brand);transition:color .15s,border-color .15s;-webkit-tap-highlight-color:transparent';

    var dialogHtml =
      '<div class="cx-dialog" style="max-width:440px;padding:0 0 4px;position:relative">' +
        // 标题行
        '<div style="padding:14px 16px 0;font-size:16px;font-weight:600;color:var(--heading)">资源管理</div>' +
        // Tab 导航栏
        '<div style="display:flex;border-bottom:1px solid var(--border);margin:6px 0 0 0">' +
          '<button id="cxTabBtnDefault" style="' + _tabBtn + '">默认</button>' +
          '<button id="cxTabBtnHistory" style="' + _tabBtn + '">历史</button>' +
          '<button id="cxTabBtnImport" style="' + _tabBtn + '">导入</button>' +
        '</div>' +
        // 多选工具栏（仅默认/导入 Tab 可见）
        '<div id="cxCmSelBar" style="display:none;padding:6px 16px;background:var(--surface-alt);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">' +
          '<label style="display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--text-secondary);cursor:pointer">' +
            '<input type="checkbox" id="cxCmSelectAll" style="margin:0"> 全选' +
          '</label>' +
          '<button id="cxCmDeleteSel" class="action-btn danger icon">删除选中(0)</button>' +
        '</div>' +
        // Tab 内容区
        '<div id="cxTabDefault" style="padding:0 16px 8px;max-height:55vh;overflow-y:auto">' +
          '<div style="text-align:center;padding:24px 0;color:var(--text-secondary)">⏳ 加载中…</div>' +
        '</div>' +
        '<div id="cxTabHistory" style="display:none;padding:0 16px 8px;max-height:55vh;overflow-y:auto">' +
          '<div style="text-align:center;padding:24px 0;color:var(--text-secondary)">⏳ 加载清单中…</div>' +
        '</div>' +
        '<div id="cxTabImport" style="display:none;padding:0 16px 8px;max-height:55vh;overflow-y:auto">' +
          '<div style="text-align:center;padding:24px 0;color:var(--text-secondary)">⏳ 加载中…</div>' +
        '</div>' +
        // 底部按钮
        '<div style="padding:8px 16px 12px">' +
          '<button id="cxCmCloseBtn" class="action-btn">关闭</button>' +
        '</div>' +
        // 导入进度遮罩
        '<div id="cxCmImportOverlay" style="display:none;position:absolute;inset:0;background:rgba(0,0,0,.45);border-radius:inherit;align-items:center;justify-content:center;z-index:10">' +
          '<div style="background:var(--surface);border-radius:12px;padding:20px 24px;min-width:220px;text-align:center">' +
            '<div id="cxCmImportMsg" style="font-size:13px;color:var(--text-primary);margin-bottom:8px">解析中…</div>' +
            '<div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden">' +
              '<div id="cxCmImportBar" style="height:100%;width:0%;background:var(--brand);transition:width .3s"></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    var dlg = win.CX.openDialog({
      id: 'cxCacheMgrMask',
      html: dialogHtml,
      onClose: function() { if (backFn) backFn(); }
    });
    if (!dlg) return;
    var mask = dlg.mask;

    document.getElementById('cxCmCloseBtn').addEventListener('click', dlg.close);

    // ── 训练名称格式（与主页保持一致）："2024-01 国际华语特会" ─────────────
    function _trainingLabel(path, year, season, title) {
      var normalPath = (path || '').replace(/^local-/, '');
      var seq  = (season || '').split(' ')[0] || normalPath.split('-')[1] || '';
      var yr   = year || normalPath.split('-')[0] || '';
      var ys   = yr + (seq ? '-' + seq : '');
      var name = season ? (season.split(' ').slice(1).join(' ') || title || path) : (title || path);
      return (ys + (name ? ' ' + name : '')).trim();
    }

    // ── Tab 切换 ──────────────────────────────────────────────────────────
    var selBar       = document.getElementById('cxCmSelBar');
    var selectAllChk = document.getElementById('cxCmSelectAll');
    var deleteSelBtn = document.getElementById('cxCmDeleteSel');

    function switchTab(tabId) {
      activeTab = tabId;
      // 更新 Tab 按钮样式
      ['default', 'history', 'import'].forEach(function (t) {
        var btn = document.getElementById('cxTabBtn' + (t === 'default' ? 'Default' : t === 'history' ? 'History' : 'Import'));
        if (btn) btn.style.cssText = t === tabId ? _tabBtnActive : _tabBtn;
      });
      // 切换内容区显示
      var tabMap = { 'default': 'cxTabDefault', history: 'cxTabHistory', 'import': 'cxTabImport' };
      Object.keys(tabMap).forEach(function (t) {
        var el = document.getElementById(tabMap[t]);
        if (el) el.style.display = t === tabId ? '' : 'none';
      });
      // 多选工具栏：只对默认/导入 Tab 显示（切 Tab 时复位）
      selBar.style.display = 'none';
      selectAllChk.checked = false;
      selectAllChk.indeterminate = false;
      // 懒加载：首次切入才加载
      if (!tabLoaded[tabId]) {
        tabLoaded[tabId] = true;
        if (tabId === 'default')  renderDefaultTab();
        if (tabId === 'history')  renderHistoryTab();
        if (tabId === 'import')   renderImportTab();
      }
    }

    document.getElementById('cxTabBtnDefault').addEventListener('click', function () { switchTab('default'); });
    document.getElementById('cxTabBtnHistory').addEventListener('click', function () { switchTab('history'); });
    document.getElementById('cxTabBtnImport').addEventListener('click', function () { switchTab('import'); });

    // ── 多选工具栏公共逻辑 ────────────────────────────────────────────
    function getCheckboxes() {
      var scope = activeTab === 'default' ? 'cxTabDefault' : 'cxTabImport';
      return Array.prototype.slice.call(
        document.querySelectorAll('#' + scope + ' input[type=checkbox][data-path]')
      );
    }
    function updateSelBar() {
      if (activeTab === 'history') { selBar.style.display = 'none'; return; }
      var boxes   = getCheckboxes();
      var checked = boxes.filter(function (b) { return b.checked; });
      if (boxes.length) {
        selBar.style.display = '';
        deleteSelBtn.textContent   = '删除选中(' + checked.length + ')';
        deleteSelBtn.disabled      = checked.length === 0;
        selectAllChk.indeterminate = checked.length > 0 && checked.length < boxes.length;
        selectAllChk.checked       = boxes.length > 0 && checked.length === boxes.length;
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
        if (activeTab === 'default') { tabLoaded['default'] = false; renderDefaultTab(); }
        if (activeTab === 'import')  { tabLoaded['import'] = false; renderImportTab(); }
      }).catch(function () {
        if (activeTab === 'default') { tabLoaded['default'] = false; renderDefaultTab(); }
        if (activeTab === 'import')  { tabLoaded['import'] = false; renderImportTab(); }
      });
    });

    // ── 默认 Tab ──────────────────────────────────────────────────────
    function renderDefaultTab() {
      var content = document.getElementById('cxTabDefault');
      if (!content) return;
      content.innerHTML = '<div style="text-align:center;padding:24px 0;color:var(--text-secondary)">⏳ 加载中…</div>';
      selBar.style.display = 'none';

      var sources = _loadSources();

      // 从命名缓存中找 training.json（用 keys() 扫描，不依赖精确 URL）
      function _fetchFromNamedCache(tp) {
        return caches.open('cx-' + tp).then(function (c) {
          return c.keys().then(function (reqs) {
            for (var ri = 0; ri < reqs.length; ri++) {
              try {
                if (new URL(reqs[ri].url).pathname.endsWith('/training.json')) return c.match(reqs[ri]);
              } catch (e) {}
            }
            return null;
          });
        }).catch(function () { return null; });
      }

      if (!('caches' in win)) {
        content.innerHTML = '<div style="text-align:center;padding:32px 0;color:var(--text-secondary)">此环境不支持缓存</div>';
        return;
      }

      caches.keys().then(function (allKeys) {
        var namedSet = {};
        allKeys
          .filter(function (k) { return /^cx-\d{4}-\d{2}$/.test(k); })
          .map(function (k) { return k.slice(3); })
          .forEach(function (tp) { namedSet[tp] = true; }); // 初始数据优先级高于历史合辑，无论是否在 packSources 都显示在「默认」Tab

        return caches.open(CACHE_NAME).then(function (cache) {
          return cache.keys().then(function (keys) {
            var mainSet = {};
            keys.forEach(function (req) {
              var m = new URL(req.url).pathname.match(/^\/?([0-9]{4}-[0-9]{2})\/training\.json$/);
              if (m && !sources[m[1]] && !namedSet[m[1]]) mainSet[m[1]] = true;
            });
            var items = Object.keys(namedSet).map(function (tp) { return { tp: tp, isInitial: true }; })
              .concat(Object.keys(mainSet).map(function (tp) { return { tp: tp, isInitial: false }; }));
            items.sort(function (a, b) { return b.tp.localeCompare(a.tp); });
            return items;
          });
        });
      }).then(function (items) {
        return Promise.all(items.map(function (item) {
          var tp  = item.tp;
          var url = win.location.origin + '/' + tp + '/training.json';
          var p   = item.isInitial
            ? _fetchFromNamedCache(tp)
            : caches.open(CACHE_NAME).then(function (c) { return c.match(url); }).catch(function () { return null; });
          return p.then(function (r) {
            if (!r) return null;
            return r.json().then(function (d) {
              return { path: tp, year: d.year, season: d.season, title: d.title || tp, chapter_count: (d.chapters || []).length, isInitial: item.isInitial };
            }).catch(function () { return { path: tp, year: null, season: null, title: tp, chapter_count: 0, isInitial: item.isInitial }; });
          }).catch(function () { return null; });
        })).then(function (arr) {
          var trainings = arr.filter(Boolean);

          // 更新 cx_initial_trainings：保存扫到的初始安装训练元数据，供删除后恢复用
          var savedInitials = _loadInitialTrainings();
          trainings.forEach(function (tr) {
            if (tr.isInitial) {
              savedInitials[tr.path] = { year: tr.year, season: tr.season, title: tr.title, chapter_count: tr.chapter_count };
            }
          });
          _saveInitialTrainings(savedInitials);

          // 追加已删除（缓存已清除）的初始训练
          // restorable = 该 path 仍存在于当前版本（trainings.json 或 resource-packs.json）
          // 若当前版本已无此训练（老版本独有），则标记为不可恢复
          var currentPaths = {};
          trainings.forEach(function (tr) { currentPaths[tr.path] = true; });

          // 收集"当前版本已知"的所有训练 path：来自 window.__cxTrainings 和 manifest
          var knownPaths = {};
          (win.__cxTrainings || []).forEach(function (t) { if (t.path) knownPaths[t.path] = true; });
          if (_manifest) {
            (_manifest.packs || []).forEach(function (pack) {
              (pack.trainings || []).forEach(function (t) { if (t.path) knownPaths[t.path] = true; });
            });
          }
          var hasKnownPaths = Object.keys(knownPaths).length > 0;

          Object.keys(savedInitials).forEach(function (tp) {
            if (!currentPaths[tp] && !sources[tp]) {
              var meta = savedInitials[tp];
              // 若能确定当前版本的已知列表（knownPaths 非空），则检查是否还在列表里
              var restorable = !hasKnownPaths || !!knownPaths[tp];
              trainings.push({ path: tp, year: meta.year, season: meta.season, title: meta.title || tp,
                chapter_count: meta.chapter_count || 0, isInitial: true, deleted: true, restorable: restorable });
            }
          });

          // 排序：现有缓存在前（降序），已删除在后（降序）
          trainings.sort(function (a, b) {
            if (!!a.deleted !== !!b.deleted) return a.deleted ? 1 : -1;
            return b.path.localeCompare(a.path);
          });

          return trainings;
        });
      }).then(function (trainings) {
        if (!trainings.length) {
          content.innerHTML =
            '<div style="text-align:center;padding:28px 16px;color:var(--text-secondary)">' +
              '<div style="font-size:28px;margin-bottom:10px">📱</div>' +
              '<div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:6px">暂无默认训练</div>' +
              '<div style="font-size:11px;line-height:1.8">App 初次安装时写入的训练会在此显示<br>历史合辑包请在「历史」标签中下载</div>' +
            '</div>';
          return;
        }
        var html = '';
        trainings.forEach(function (tr) {
          var label = _trainingLabel(tr.path, tr.year, tr.season, tr.title);
          if (tr.deleted) {
            // 已删除的初始训练：可恢复 → 显示"↺ 重新安装"；已过期 → 显示"已过期"提示
            var rightCol = tr.restorable !== false
              ? '<button class="cx-restore-initial action-btn icon" data-path="' + escAttr(tr.path) + '" ' +
                  'style="font-size:12px;padding:3px 10px;flex-shrink:0">↺ 重新安装</button>'
              : '<span style="font-size:11px;color:var(--text-secondary);flex-shrink:0;padding:3px 6px">已过期</span>';
            html +=
              '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">' +
                '<div style="flex:1;min-width:0;overflow:hidden">' +
                  '<div style="font-size:13px;font-weight:500;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
                    escHtml(label) +
                  '</div>' +
                  '<div style="font-size:11px;color:var(--text-secondary);margin-top:1px">缓存已清除</div>' +
                '</div>' +
                rightCol +
              '</div>';
          } else {
            var badge = tr.isInitial
              ? ' <span style="display:inline-block;font-size:10px;padding:1px 5px;background:rgba(80,160,80,.1);color:#2a7a2a;border:1px solid #2a7a2a;border-radius:4px;margin-left:4px;white-space:nowrap;vertical-align:middle;line-height:1.4">已安装</span>'
              : '';
            html +=
              '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">' +
                '<input type="checkbox" data-path="' + escAttr(tr.path) + '" data-src="default" style="flex-shrink:0;margin:0;width:15px;height:15px">' +
                '<div style="flex:1;min-width:0;overflow:hidden">' +
                  '<div style="font-size:13px;font-weight:500;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
                    escHtml(label) + badge +
                  '</div>' +
                  '<div style="font-size:11px;color:var(--text-secondary);margin-top:1px">' + (tr.chapter_count || 0) + ' 篇</div>' +
                '</div>' +
                '<button class="cx-cm-del-one action-btn danger icon" data-path="' + escAttr(tr.path) + '" data-src="default"' + (tr.isInitial ? ' data-initial="1"' : '') + ' data-label="' + escAttr(label) + '">🗑</button>' +
              '</div>';
          }
        });
        content.innerHTML = html;
        updateSelBar();
        Array.prototype.forEach.call(content.querySelectorAll('input[type=checkbox][data-path]'), function (cb) {
          cb.addEventListener('change', updateSelBar);
        });
        // 绑定重新安装按钮（已删除行）
        Array.prototype.forEach.call(content.querySelectorAll('.cx-restore-initial'), function (btn) {
          btn.addEventListener('click', function () {
            var path = btn.getAttribute('data-path');
            var rowEl = btn.parentElement;
            restoreInitialTraining(path, rowEl, function () {
              tabLoaded['default'] = false; renderDefaultTab();
            });
          });
        });
        Array.prototype.forEach.call(content.querySelectorAll('.cx-cm-del-one'), function (btn) {
          btn.addEventListener('click', function () {
            var path = btn.getAttribute('data-path');
            var isInitial = btn.getAttribute('data-initial') === '1';
            if (!confirm('确认删除该训练的缓存？' + (isInitial ? '\n（已安装训练删除后可在此重新安装）' : ''))) return;
            var rowEl = btn.parentElement;
            var label = btn.getAttribute('data-label') || path;
            deleteTraining(path, function () {
              if (win.refreshHomeGrid) win.refreshHomeGrid();
              if (isInitial && rowEl) {
                // 转换行：保留训练标题，显示"已删除"状态 + 重新安装按钮
                rowEl.innerHTML =
                  '<div style="flex:1;min-width:0;overflow:hidden">' +
                    '<div style="font-size:13px;font-weight:500;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(label) + '</div>' +
                    '<div style="font-size:11px;color:var(--text-secondary);margin-top:1px">缓存已清除</div>' +
                  '</div>' +
                  '<button class="cx-restore-initial action-btn icon" data-path="' + escAttr(path) + '" ' +
                    'style="font-size:12px;padding:3px 10px;flex-shrink:0">↺ 重新安装</button>';
                rowEl.querySelector('.cx-restore-initial').addEventListener('click', function () {
                  restoreInitialTraining(path, rowEl, function () {
                    tabLoaded['default'] = false; renderDefaultTab();
                  });
                });
              } else {
                tabLoaded['default'] = false; renderDefaultTab();
              }
            });
          });
        });
      }).catch(function () {
        content.innerHTML = '<div style="color:var(--error);padding:16px 0">加载失败，请重试</div>';
      });
    }

    // ── 历史 Tab ──────────────────────────────────────────────────────
    function renderHistoryTab() {
      var content = document.getElementById('cxTabHistory');
      if (!content) return;
      content.innerHTML = '<div style="text-align:center;padding:24px 0;color:var(--text-secondary)">⏳ 加载清单中…</div>';

      fetchManifest().then(function (manifest) {
        var packs = manifest.packs || [];
        if (!packs.length) {
          content.innerHTML = '<div style="padding:16px 0;color:var(--text-secondary)">暂无资源包</div>';
          return;
        }

        function makePackRow(pack, i) {
          return '<div class="cx-rp-item" id="cxRpPk_' + i + '" style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-size:14px;font-weight:500;color:var(--text-primary)">' + escHtml(pack.label) + '</div>' +
              '<div style="font-size:12px;color:var(--text-secondary);margin-top:2px">' +
                escHtml(pack.training_count + ' 个训练 · ' + fmtSize(pack.size_bytes)) +
              '</div>' +
              '<div id="cxRpPkProg_' + i + '" style="display:none;margin-top:6px">' +
                '<div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden">' +
                  '<div id="cxRpPkBar_' + i + '" style="height:100%;width:0%;background:var(--brand);transition:width .2s"></div>' +
                '</div>' +
                '<div id="cxRpPkPct_' + i + '" style="font-size:11px;color:var(--text-secondary);margin-top:2px">0%</div>' +
              '</div>' +
            '</div>' +
            '<div style="display:flex;gap:5px;flex-shrink:0" id="cxRpPkBtn_' + i + '_wrap"></div>' +
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
              dBtn.className = 'action-btn danger icon';
              dBtn.addEventListener('click', onDelete); wrap.appendChild(dBtn);
            }
            var cBtn = document.createElement('button');
            cBtn.textContent = '✓ 已缓存'; cBtn.disabled = true;
            cBtn.className = 'action-btn cached icon';
            wrap.appendChild(cBtn);
          } else if (onDownload) {
            var dlBtn = document.createElement('button');
            dlBtn.textContent = '⬇ 下载';
            dlBtn.className = 'action-btn primary icon';
            dlBtn.addEventListener('click', onDownload); wrap.appendChild(dlBtn);
          } else {
            var iBtn = document.createElement('button');
            iBtn.textContent = '未缓存'; iBtn.disabled = true;
            iBtn.className = 'action-btn icon';
            wrap.appendChild(iBtn);
          }
        }

        function startPackDownload(pack, i, cachedArr) {
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
              if (!confirm('确认删除「' + pack.label + '」的缓存？\n（仅删除由该包下载且未被后续操作替换的训练）')) return;
              deletePack(pack, function () {
                cachedArr[i] = false;
                makeActionBtns('cxRpPkBtn_' + i, false,
                  function () { startPackDownload(pack, i, cachedArr); }, null);
                if (win.refreshHomeGrid) win.refreshHomeGrid();
              });
            });
            if (win.refreshHomeGrid) win.refreshHomeGrid();
          }).catch(function (err) {
            if (progEl) progEl.style.display = 'none';
            if (wrap) {
              wrap.innerHTML = '<button style="padding:5px 12px;border-radius:8px;border:none;font-size:12px;cursor:pointer;background:var(--brand);color:#fff">⬇ 重试</button>';
              var retryBtn = wrap.querySelector('button');
              if (retryBtn) retryBtn.addEventListener('click', function () { startPackDownload(pack, i, cachedArr); });
            }
            alert('下载失败：' + err.message);
            throw err;
          });
        }

        var rowsHtml = '';
        packs.forEach(function (pack, i) { rowsHtml += makePackRow(pack, i); });

        content.innerHTML =
          rowsHtml +
          '<div id="cxRpDlAllRow" class="pref-row" style="display:none;border-top:1px solid var(--border);padding-top:10px;margin-top:4px">' +
            '<div class="pref-label-wrap">' +
              '<span class="pref-title">批量下载</span>' +
              '<span class="pref-desc">一次下载所有未缓存资源包</span>' +
            '</div>' +
            '<button id="cxRpDownloadAllBtn" class="action-btn primary icon">⬇ 全部下载</button>' +
          '</div>';

        var cachedArr = new Array(packs.length).fill(false);
        Promise.all(packs.map(isPackCached)).then(function (arr) {
          arr.forEach(function (c, i) { cachedArr[i] = c; });
          packs.forEach(function (pack, i) {
            (function (pk, idx) {
              function refreshBtn() {
                makeActionBtns('cxRpPkBtn_' + idx, cachedArr[idx],
                  cachedArr[idx] ? null : function () { startPackDownload(pk, idx, cachedArr); },
                  cachedArr[idx] ? function () {
                    if (!confirm('确认删除「' + pk.label + '」的缓存？\n（仅删除由该包下载且未被后续操作替换的训练）')) return;
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
          var allRow = document.getElementById('cxRpDlAllRow');
          if (allBtn && hasUncached) {
            if (allRow) allRow.style.display = 'flex';
            allBtn.addEventListener('click', function () {
              allBtn.disabled = true; allBtn.textContent = '下载中…';
              packs.reduce(function (p, pack, i) {
                return p.then(function () {
                  if (cachedArr[i]) return Promise.resolve();
                  return startPackDownload(pack, i, cachedArr);
                });
              }, Promise.resolve()).then(function () {
                allBtn.textContent = '✓ 全部完成';
              }).catch(function (err) {
                allBtn.disabled = false; allBtn.textContent = '全部下载';
                alert('下载失败：' + err.message);
              });
            });
          }
        });
      }).catch(function (err) {
        var c2 = document.getElementById('cxTabHistory');
        if (c2) c2.innerHTML = '<div style="color:var(--error);padding:16px 0">获取清单失败：' + escHtml(err.message) + '</div>';
      });
    }

    // ── 导入 Tab ──────────────────────────────────────────────────────
    function renderImportTab() {
      var content = document.getElementById('cxTabImport');
      if (!content) return;
      content.innerHTML = '<div style="text-align:center;padding:24px 0;color:var(--text-secondary)">⏳ 加载中…</div>';
      selBar.style.display = 'none';

      function doImport() {
        if (!win.CXLocalImport) { alert('导入模块未加载'); return; }
        var fi = document.createElement('input');
        fi.type = 'file';
        fi.accept = '.txt,text/plain';
        fi.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;width:1px;height:1px';
        document.body.appendChild(fi);
        fi.addEventListener('change', function () {
          var file = fi.files && fi.files[0];
          document.body.removeChild(fi);
          if (!file) return;
          // 文件类型检查
          var nameLower = file.name.toLowerCase();
          if (!nameLower.endsWith('.txt') && file.type !== 'text/plain') {
            alert('请选择 .txt 格式的训练文本文件');
            return;
          }
          // 文件大小检查（单文件不超过 500 MB）
          if (file.size > 500 * 1024 * 1024) {
            alert('文件过大（超过 500 MB），请确认是否为正确的训练文本文件');
            return;
          }
          if (file.size < 100) {
            alert('文件内容过少，不是有效的训练文本文件');
            return;
          }
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
              tabLoaded['import'] = false; renderImportTab();
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
      }

      var p_local = win.CXLocalImport
        ? win.CXLocalImport.listImports().catch(function () { return []; })
        : Promise.resolve([]);

      p_local.then(function (localImports) {
        var html = '<div class="pref-row" style="border-bottom:1px solid var(--border);padding-bottom:12px;margin-bottom:4px">' +
          '<div class="pref-label-wrap">' +
            '<span class="pref-title">本地文件</span>' +
            '<span class="pref-desc">导入 TXT 格式训练文本</span>' +
          '</div>' +
          '<button id="cxTabImportFileBtn" class="action-btn primary icon">📂 导入</button>' +
        '</div>';
        if (!localImports.length) {
          html += '<div style="text-align:center;padding:24px 0;color:var(--text-secondary)">暂无本地导入</div>';
        } else {
          localImports.slice().sort(function (a, b) {
            return b.path.replace(/^local-/, '').localeCompare(a.path.replace(/^local-/, ''));
          }).forEach(function (item) {
            var sub = (item.chapter_count || 0) + ' 篇';
            if (item.importedAt) sub += ' · ' + new Date(item.importedAt).toLocaleDateString('zh-CN');
            html +=
              '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">' +
                '<input type="checkbox" data-path="' + escAttr(item.path) + '" data-src="local" style="flex-shrink:0;margin:0;width:15px;height:15px">' +
                '<div style="flex:1;min-width:0;overflow:hidden">' +
                  '<div style="font-size:13px;font-weight:500;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
                    escHtml(_trainingLabel(item.path, item.year, item.season, item.title)) +
                    ' <span style="display:inline-block;font-size:10px;padding:1px 5px;background:rgba(0,112,204,.1);color:var(--brand);border:1px solid var(--brand);border-radius:4px;margin-left:4px;white-space:nowrap;vertical-align:middle;line-height:1.4">本地</span>' +
                  '</div>' +
                  '<div style="font-size:11px;color:var(--text-secondary);margin-top:1px">' + sub + '</div>' +
                '</div>' +
                  '<button class="cx-cm-del-one action-btn danger icon" data-path="' + escAttr(item.path) + '" data-src="local">🗑</button>' +
              '</div>';
          });
        }
        content.innerHTML = html;

        var importFileBtn = document.getElementById('cxTabImportFileBtn');
        if (importFileBtn) importFileBtn.addEventListener('click', doImport);

        updateSelBar();
        Array.prototype.forEach.call(content.querySelectorAll('input[type=checkbox][data-path]'), function (cb) {
          cb.addEventListener('change', updateSelBar);
        });
        Array.prototype.forEach.call(content.querySelectorAll('.cx-cm-del-one'), function (btn) {
          btn.addEventListener('click', function () {
            var path = btn.getAttribute('data-path');
            if (!confirm('确认删除该导入训练？')) return;
            if (win.CXLocalImport) {
              win.CXLocalImport.deleteImport(path).then(function () {
                if (win.refreshHomeGrid) win.refreshHomeGrid();
                tabLoaded['import'] = false; renderImportTab();
              });
            }
          });
        });
      }).catch(function () {
        content.innerHTML = '<div style="color:var(--error);padding:16px 0">加载失败，请重试</div>';
      });
    }

    // ── 初始化：切换到指定 Tab ────────────────────────────────────────
    switchTab(activeTab);
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