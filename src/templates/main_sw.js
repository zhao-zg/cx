/**
 * Service Worker for 特会信息合集
 * 优化版：解决中文路径乱码、多级目录映射、Index.html 统一
 */

const CACHE_VERSION = '{{ cache_version }}';
const CACHE_NAME = 'cx-main-' + CACHE_VERSION;

const CONFIG = {
  TIMEOUT: 5000,
  // 预缓存资源
  CORE_RESOURCES: [
    './',
    './manifest.json',
    './icons/icon.svg'
  ],
  // 允许缓存的类型
  CACHEABLE_TYPES: ['basic', 'cors']
};

// --------------------------------------------------------------------------
// 1. 安装与激活
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
// 2. 核心逻辑：URL 规范化
// --------------------------------------------------------------------------

/**
 * 规范化 URL，解决中文乱码和 index.html 问题
 * 例如：.../%C3%A6%C2%84%C2%9F... -> .../感恩节/
 */
function normalizeUrl(urlStr) {
  try {
    let url = new URL(urlStr);
    // 1. 解码中文 (处理双重编码导致的乱码)
    let decodedPath = decodeURIComponent(url.pathname);
    
    // 2. 移除末尾的 index.html，统一映射到目录根 /
    if (decodedPath.endsWith('/index.html')) {
      decodedPath = decodedPath.slice(0, -10); // 移除 "index.html"
    }
    
    // 3. 确保目录以 / 结尾 (防止 /path 和 /path/ 不匹配)
    // 如果没有扩展名且不是以 / 结尾，补全它
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

  event.respondWith(async function() {
    // 1. 策略：强制网络（如果设置了 reload）
    if (request.cache === 'no-cache' || request.cache === 'reload') {
      return fetchAndCache(request, normalizedUrl);
    }

    // 2. 尝试从缓存获取
    // 依次尝试：原始 URL -> 规范化后的 URL
    const cacheNames = [request.url, normalizedUrl];
    for (const name of cacheNames) {
      const cached = await caches.match(name);
      if (cached) return cached;
    }

    // 3. 缓存未命中，发起请求
    return fetchAndCache(request, normalizedUrl);
  }());
});

/**
 * 请求网络并存入缓存
 */
async function fetchAndCache(request, normalizedUrl) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.TIMEOUT);

  try {
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timeoutId);

    // 检查是否值得缓存
    if (response && response.status === 200 && CONFIG.CACHEABLE_TYPES.includes(response.type)) {
      const clone = response.clone();
      caches.open(CACHE_NAME).then(cache => {
        // 同时缓存原始 URL 和规范化 URL，确保以后都能搜到
        cache.put(request, clone);
        if (request.url !== normalizedUrl) {
          cache.put(normalizedUrl, response.clone());
        }
      });
    }
    return response;
  } catch (err) {
    // 离线且是页面跳转时，返回离线 HTML
    if (request.mode === 'navigate') {
      return new Response(getOfflineHTML(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
    throw err;
  }
}

// --------------------------------------------------------------------------
// 4. 其他辅助
// --------------------------------------------------------------------------

function getOfflineHTML() {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f0f2f5;color:#666}.card{text-align:center;background:#fff;padding:40px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.1)}button{background:#4e6ef2;color:#fff;border:none;padding:10px 20px;border-radius:4px;cursor:pointer}</style></head><body><div class="card"><h1>📱 离线状态</h1><p>该中文路径内容尚未缓存</p><button onclick="location.reload()">重试</button></div></body></html>`;
}

// 接收消息
self.addEventListener('message', event => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data.type === 'CLEAR_ALL_CACHES') {
    event.waitUntil(
      caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
    );
  }
});