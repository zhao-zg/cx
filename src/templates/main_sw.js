// Service Worker for 特会信息合集
const CACHE_VERSION = '{{ cache_version }}';
const CACHE_NAME = 'cx-main-' + CACHE_VERSION;

// 配置项
const CONFIG = {
  // 网络请求超时时间 (ms)
  TIMEOUT: 5000,
  // 允许缓存的资源类型 (防止缓存错误的 API 数据或无关资源)
  CACHEABLE_TYPES: [
    'basic', // 同源资源
    'cors',  // 跨域资源 (如 CDN 图片)
  ],
  // 核心资源 (安装时立即缓存)
  CORE_RESOURCES: [
    './', // 相对路径更安全
    './index.html',
    './manifest.json',
    './icons/icon.svg'
  ]
};

// --------------------------------------------------------------------------
// 1. 生命周期事件 (Lifecycle)
// --------------------------------------------------------------------------

self.addEventListener('install', event => {
  console.log('[SW] 安装版本:', CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // 使用 Promise.allSettled 容错处理
      return Promise.allSettled(
        CONFIG.CORE_RESOURCES.map(url => 
          fetch(new Request(url, { cache: 'reload' }))
            .then(res => {
              if (res.ok) return cache.put(url, res);
              throw new Error(`Status ${res.status}`);
            })
        )
      ).then(results => {
        const failed = results.filter(r => r.status === 'rejected');
        if (failed.length > 0) console.warn('[SW] 部分核心资源缓存失败:', failed);
        console.log('[SW] 核心资源处理完毕');
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  console.log('[SW] 激活版本:', CACHE_VERSION);
  event.waitUntil(
    caches.keys().then(keys => {
      // 清理旧版本主缓存，保留训练数据缓存 (cx-2025-*)
      const oldCaches = keys.filter(key => 
        key.startsWith('cx-main-') && key !== CACHE_NAME
      );
      return Promise.all(oldCaches.map(key => caches.delete(key)));
    }).then(() => {
      console.log('[SW] 旧缓存已清理，接管客户端');
      return self.clients.claim();
    })
  );
});

// --------------------------------------------------------------------------
// 2. 请求拦截策略 (Fetch Strategy)
// --------------------------------------------------------------------------

self.addEventListener('fetch', event => {
  // 只处理 GET 请求
  if (event.request.method !== 'GET') return;

  const request = event.request;
  const url = new URL(request.url);

  // 策略 1: 强制网络策略 (no-cache / reload)
  if (request.cache === 'no-cache' || request.cache === 'reload') {
    event.respondWith(networkOnly(request));
    return;
  }

  // 策略 2: URL 规范化 (处理 /index.html 和 / 的统一)
  // 如果请求的是 index.html，尝试从缓存中查找 / 或 index.html
  if (url.pathname.endsWith('/index.html')) {
    event.respondWith(cacheFirstStrategy(request, true)); 
    return;
  }

  // 策略 3: 通用缓存优先策略
  event.respondWith(cacheFirstStrategy(request));
});

// --------------------------------------------------------------------------
// 3. 核心逻辑函数
// --------------------------------------------------------------------------

/**
 * 缓存优先策略 (Cache First, falling back to Network)
 * @param {Request} request 
 * @param {boolean} normalizeUrl 是否尝试规范化 URL
 */
async function cacheFirstStrategy(request, normalizeUrl = false) {
  let cachedResponse;
  
  // 1. 尝试查找缓存
  cachedResponse = await caches.match(request);
  
  // 1.1 如果启用了规范化且没找到，尝试查找目录根路径
  if (!cachedResponse && normalizeUrl) {
    const rootUrl = request.url.replace(/\/index\.html$/, '/');
    cachedResponse = await caches.match(rootUrl);
  }

  if (cachedResponse) {
    return cachedResponse;
  }

  // 2. 缓存未命中，发起网络请求
  try {
    const networkResponse = await fetchWithTimeout(request, CONFIG.TIMEOUT);
    
    // 3. 智能缓存：只有有效的响应才写入缓存
    if (shouldCache(networkResponse)) {
      const clone = networkResponse.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
    }
    
    return networkResponse;
  } catch (error) {
    console.warn('[SW] 网络请求失败:', request.url, error);
    
    // 4. 离线处理：仅针对页面导航请求返回离线 HTML
    // 避免图片/JS 失败时返回 HTML 导致页面报错
    if (request.mode === 'navigate') {
      return getOfflinePage();
    }
    
    // 其他资源失败返回 undefined (浏览器会报网络错误) 或可返回占位图
    throw error;
  }
}

/**
 * 仅网络策略
 */
async function networkOnly(request) {
  try {
    const response = await fetch(request);
    // 即使是强制网络，如果是成功的 GET，也可以顺便更新缓存（可选，此处保留用户原有逻辑）
    if (shouldCache(response)) {
      const clone = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
    }
    return response;
  } catch (err) {
    // 网络失败尝试读缓存
    const cached = await caches.match(request);
    if (cached) return cached;
    throw err;
  }
}

/**
 * 判断响应是否值得缓存
 * 防止缓存 206 Partial Content, 错误代码, 或不安全的跨域资源
 */
function shouldCache(response) {
  return response && 
         response.status === 200 && 
         CONFIG.CACHEABLE_TYPES.includes(response.type);
}

/**
 * 带超时和中止控制的 Fetch
 */
function fetchWithTimeout(request, timeout) {
  const controller = new AbortController();
  const signal = controller.signal;

  return Promise.race([
    fetch(request, { signal }),
    new Promise((_, reject) =>
      setTimeout(() => {
        controller.abort(); // 超时后真正取消请求，节省流量
        reject(new Error('Request timeout'));
      }, timeout)
    )
  ]);
}

/**
 * 生成离线页面 (精简版)
 */
function getOfflinePage() {
  const offlineHTML = `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>离线模式</title>
      <style>
        body{font-family:-apple-system,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f7fafc;color:#4a5568}
        .box{text-align:center;padding:20px}
        h1{color:#667eea;font-size:1.5rem}
        button{background:#667eea;color:#fff;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;margin-top:15px}
      </style>
    </head>
    <body>
      <div class="box">
        <h1>☁️ 当前处于离线状态</h1>
        <p>请检查网络连接后刷新页面</p>
        <button onclick="location.reload()">重新加载</button>
      </div>
    </body>
    </html>`;
    
  return new Response(offlineHTML, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

// --------------------------------------------------------------------------
// 4. 消息通信
// --------------------------------------------------------------------------

self.addEventListener('message', event => {
  if (!event.data) return;

  switch (event.data.type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
      
    case 'CLEAR_ALL_CACHES':
      event.waitUntil(
        caches.keys().then(keys => Promise.all(
          keys.map(key => caches.delete(key))
        )).then(() => {
          return self.clients.matchAll().then(clients => {
            clients.forEach(client => client.postMessage({ type: 'CACHES_CLEARED' }));
          });
        })
      );
      break;
  }
});