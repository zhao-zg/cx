/**
 * Service Worker for 特会信息合集
 * 纯路由版：不管理版本，缓存生命周期由安装对话框负责
 */

const CACHE_NAME = 'cx-main';
const SCOPE = self.registration.scope;
const SCOPE_PATH = new URL(SCOPE).pathname;

const CONFIG = {
  TIMEOUT: 5000,
  CACHEABLE_TYPES: ['basic', 'cors']
};

// --------------------------------------------------------------------------
// 1. 生命周期
// --------------------------------------------------------------------------

self.addEventListener('install', event => {
  // 无需预缓存；缓存由安装对话框管理
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

// --------------------------------------------------------------------------
// 2. URL 规范化 (处理中文路径)
// --------------------------------------------------------------------------

function normalizeUrl(urlStr) {
  try {
    let url = new URL(urlStr);
    let decodedPath = decodeURIComponent(url.pathname);
    
    if (decodedPath.endsWith('/index.html')) {
      decodedPath = decodedPath.slice(0, -10);
    }
    
    // 目录补全斜杠
    if (!decodedPath.split('/').pop().includes('.') && !decodedPath.endsWith('/')) {
      decodedPath += '/';
    }

    return url.origin + decodedPath;
  } catch (e) {
    return urlStr;
  }
}

// --------------------------------------------------------------------------
// 3. 请求拦截
// --------------------------------------------------------------------------

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const request = event.request;
  const normalizedUrl = normalizeUrl(request.url);
  const path = request.url.startsWith(SCOPE) ? new URL(request.url).pathname.slice(SCOPE_PATH.length) : null;

  // 版本检查不能用离线旧版本冒充当前部署。
  if (path === 'version.json') {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  // 安装/更新时 cacheAllTrainings 使用 cache:'no-cache' 发起请求，
  // 由页面侧显式调用 cache.put 管理，SW 不再介入，避免双重写缓存竞争。
  // 注意：Chrome 刷新页面时导航请求的 cache 属性也是 'no-cache'，
  // 必须排除导航请求，否则离线刷新会跳过拦截导致 ERR_INTERNET_DISCONNECTED。
  if (request.cache === 'no-cache' && request.mode !== 'navigate') return;

  const shell = path !== null && (path === '' || path === 'index.html' || path === 'manifest.json'
    || /^(js|css|vendor)\//.test(path));
  const batch = path && /^(\d{4}-\d{2})\//.exec(path);
  async function findCached() {
    // 显式缓存的最新训练优先于历史资源包或旧 SW 写入 cx-main 的同名文件。
    if (batch) {
      const options = { cacheName: 'cx-' + batch[1] };
      const cached = await caches.match(request, options) || await caches.match(normalizedUrl, options);
      if (cached) return cached;
    }
    return await caches.match(normalizedUrl) || await caches.match(request);
  }

  async function fetchAndCache() {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.TIMEOUT);
    try {
      const options = { signal: controller.signal };
      if (shell) options.cache = 'no-cache';
      const response = await fetch(request, options);
      const type = response.headers.get('Content-Type') || '';
      if (shell && (/^text\/html\b/i.test(type) && path !== '' && path !== 'index.html')) {
        throw new Error('Invalid shell response: ' + path);
      }

      // 登录/提示页标记为 no-store，不能覆盖离线首页。
      if (response.status === 200 && CONFIG.CACHEABLE_TYPES.includes(response.type)
          && !/\bno-store\b/i.test(response.headers.get('Cache-Control') || '')) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(normalizedUrl, copy))
          .catch(err => console.warn('[SW] 缓存写入失败:', err)));
      }
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  const responsePromise = (async () => {
    if (!shell) return await findCached() || await fetchAndCache();
    // 核心页面及脚本重新验证 HTTP 缓存；离线才使用 Cache Storage。
    try {
      const response = await fetchAndCache();
      if (response.status < 500) return response;
      return await findCached() || response;
    } catch (err) {
      const cached = await findCached();
      if (cached) return cached;
      throw err;
    }
  })();

  event.respondWith(responsePromise.catch(async err => {
    if (request.mode === 'navigate') {
      // 先尝试缓存的 index.html（SPA fallback），避免直接返回离线空壳
      return await caches.match(SCOPE)
        || new Response(getOfflineHTML(), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
    }
    throw err;
  }));
});

// --------------------------------------------------------------------------
// 4. 工具
// --------------------------------------------------------------------------

function getOfflineHTML() {
  return `<!DOCTYPE html><html lang="zh-CN"><body><div style="text-align:center;margin-top:50px;"><h1>📱 离线状态</h1><p>当前页面尚未缓存</p><button onclick="location.reload()">刷新重试</button></div></body></html>`;
}

self.addEventListener('message', event => {
  if (!event.data) return;

  if (event.data.type === 'SKIP_WAITING') self.skipWaiting();

  if (event.data.type === 'CLEAR_ALL_CACHES') {
    event.waitUntil(
      caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
    );
  }

  // 查询当前缓存状态（通过 MessageChannel port 回复）
  if (event.data.type === 'CACHE_INFO') {
    const port = event.ports && event.ports[0];
    if (!port) return;
    event.waitUntil(
      caches.keys().catch(() => []).then(allKeys => {
        const trainingCacheCount = allKeys.filter(k => k.startsWith('cx-') && k !== 'cx-main').length;
        port.postMessage({
          trainingCacheCount: trainingCacheCount,
          ok: allKeys.includes('cx-main')
        });
      }).catch(err => {
        port.postMessage({ ok: false });
      })
    );
  }

  // 仅清除 cx-* 离线缓存，保留用户 localStorage 数据
  if (event.data.type === 'CLEAR_CACHE') {
    const port = event.ports && event.ports[0];
    event.waitUntil(
      caches.keys()
        .then(keys => Promise.all(keys.filter(k => k.startsWith('cx-')).map(k => caches.delete(k))))
        .then(() => { if (port) port.postMessage({ ok: true }); })
        .catch(err => { if (port) port.postMessage({ ok: false, error: err.message }); })
    );
  }
});