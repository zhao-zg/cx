/**
 * Service Worker for 特会信息合集
 * 修复版：解决 Response body already used 错误
 */

const CACHE_VERSION = '{{ cache_version }}';
const CACHE_NAME = 'cx-main-' + CACHE_VERSION;

const CONFIG = {
  TIMEOUT: 5000,
  CORE_RESOURCES: [
    {%- for resource in core_resources %}
    '{{ resource }}'{% if not loop.last %},{% endif %}
    {%- endfor %}
  ],
  TRAINING_PAGES: [
    {%- for page in training_pages %}
    '{{ page }}'{% if not loop.last %},{% endif %}
    {%- endfor %}
  ],
  CACHEABLE_TYPES: ['basic', 'cors']
};

// --------------------------------------------------------------------------
// 1. 生命周期
// --------------------------------------------------------------------------

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(
        CONFIG.CORE_RESOURCES.map(url => 
          fetch(new Request(url, { cache: 'reload' }))
            .then(res => res.ok ? cache.put(url, res) : null)
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key.startsWith('cx-main-') && key !== CACHE_NAME)
          .map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
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

  // search-index.json 使用 stale-while-revalidate 策略
  if (request.url.includes('search-index.json')) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  event.respondWith((async () => {
    // 1. 缓存优先 (尝试原始 URL 和规范化 URL)
    const cached = await caches.match(request) || await caches.match(normalizedUrl);
    if (cached) return cached;

    // 2. 缓存未命中
    return fetchAndCache(request, normalizedUrl);
  })());
});

/**
 * search-index.json: stale-while-revalidate
 * 有缓存就立即返回，同时后台异步更新缓存
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then(response => {
    if (response && response.status === 200 && CONFIG.CACHEABLE_TYPES.includes(response.type)) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  return cached || fetchPromise;
}

/**
 * 核心修复：请求并缓存
 */
async function fetchAndCache(request, normalizedUrl) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.TIMEOUT);

  try {
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timeoutId);

    // 检查响应是否有效且值得缓存
    if (response && response.status === 200 && CONFIG.CACHEABLE_TYPES.includes(response.type)) {
      const cache = await caches.open(CACHE_NAME);
      
      /* 关键修复：
         1. 存储原始请求：使用 response.clone()
         2. 如果有规范化路径：再 clone 一次
         3. 最后的 response 返回给浏览器使用
      */
      cache.put(request, response.clone());
      
      if (request.url !== normalizedUrl) {
        cache.put(normalizedUrl, response.clone());
      }
    }
    return response; 
  } catch (err) {
    if (request.mode === 'navigate') {
      return new Response(getOfflineHTML(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
    throw err;
  }
}

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
      Promise.all([
        caches.open(CACHE_NAME).then(c => c.keys()).catch(() => []),
        caches.keys().catch(() => [])
      ]).then(([coreKeys, allKeys]) => {
        const trainingCacheCount = allKeys.filter(k => k.startsWith('cx-') && !k.startsWith('cx-main-')).length;
        port.postMessage({
          cacheVersion:   CACHE_VERSION,
          cachedCoreCount: coreKeys.length,
          totalCore:      CONFIG.CORE_RESOURCES.length,
          trainingCacheCount: trainingCacheCount,
          ok: coreKeys.length > 0
        });
      }).catch(err => {
        port.postMessage({ cacheVersion: CACHE_VERSION, cachedCoreCount: 0, totalCore: 0, ok: false });
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