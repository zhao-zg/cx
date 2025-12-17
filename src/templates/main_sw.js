// Service Worker for 特会信息合集
const CACHE_VERSION = '{{ cache_version }}';
const CACHE_NAME = 'cx-main-' + CACHE_VERSION;

// 获取 Service Worker 的基础 URL
const BASE_URL = self.location.origin + self.location.pathname.replace(/\/[^\/]*$/, '/');

// 初始安装时只缓存核心资源（仅主页）
const CORE_RESOURCES = [
  BASE_URL,  // 主页 (/)，访问 /index.html 时会自动规范化为 /
  BASE_URL + 'manifest.json',
  BASE_URL + 'icons/icon.svg',  // 预缓存图标，加快安装后的首次启动
];

// 安装事件 - 只预缓存核心资源
self.addEventListener('install', event => {
  console.log('[SW] 开始安装，版本:', CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] 开始缓存核心资源');
      // 使用 Promise.allSettled 而不是 addAll，避免单个资源失败导致整体失败
      return Promise.allSettled(
        CORE_RESOURCES.map(url => 
          fetch(url, { cache: 'reload' })
            .then(response => {
              if (response.ok) {
                return cache.put(url, response);
              }
              console.warn('[SW] 资源响应失败:', url, response.status);
              return Promise.resolve();
            })
            .catch(err => {
              console.warn('[SW] 缓存资源失败:', url, err);
              return Promise.resolve();
            })
        )
      ).then(results => {
        const successCount = results.filter(r => r.status === 'fulfilled').length;
        console.log('[SW] 核心资源缓存完成:', successCount, '/', CORE_RESOURCES.length);
      });
    }).catch(err => {
      console.error('[SW] 打开缓存失败:', err);
      return Promise.resolve();
    })
  );
  // 立即激活，不等待旧 SW
  self.skipWaiting();
});

// 激活事件 - 清理旧缓存
self.addEventListener('activate', event => {
  console.log('[SW] 激活，版本:', CACHE_VERSION);
  event.waitUntil(
    caches.keys().then(keys => {
      const oldCaches = keys.filter(key => {
        // 只删除旧版本的主缓存 (cx-main-*)
        // 保留训练缓存 (cx-2025-*)
        return key.startsWith('cx-main-') && key !== CACHE_NAME;
      });
      
      if (oldCaches.length > 0) {
        console.log('[SW] 清理旧缓存:', oldCaches);
      }
      
      return Promise.all(
        oldCaches.map(key => caches.delete(key))
      );
    }).then(() => {
      console.log('[SW] 接管所有客户端');
      // 清理完成后立即接管所有客户端
      return self.clients.claim();
    })
  );
});

// 请求拦截 - 缓存优先策略（离线优先）
self.addEventListener('fetch', event => {
  // 只处理 GET 请求
  if (event.request.method !== 'GET') {
    return;
  }
  
  // 如果请求设置了 cache: 'no-cache' 或 'reload'，跳过缓存直接请求网络
  if (event.request.cache === 'no-cache' || event.request.cache === 'reload') {
    event.respondWith(
      fetch(event.request).then(response => {
        // 如果是成功的 GET 请求，更新缓存
        if (response.ok && response.status >= 200 && response.status < 300 && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(err => {
        // 网络失败，尝试返回缓存
        return caches.match(event.request).then(cached => {
          if (cached) {
            return cached;
          }
          throw err;
        });
      })
    );
    return;
  }
  
  // 规范化 URL：将 index.html 请求重定向到目录
  let requestUrl = new URL(event.request.url);
  if (requestUrl.pathname.endsWith('/index.html')) {
    requestUrl.pathname = requestUrl.pathname.replace(/\/index\.html$/, '/');
    // 创建规范化的请求，但不能使用 mode: 'navigate'
    const normalizedRequest = new Request(requestUrl.toString(), {
      method: event.request.method,
      headers: event.request.headers,
      credentials: event.request.credentials,
      redirect: event.request.redirect
    });
    
    event.respondWith(handleRequest(normalizedRequest));
    return;
  }
  
  event.respondWith(handleRequest(event.request));
});

// 带超时的 fetch 函数
function fetchWithTimeout(request, timeout) {
  return Promise.race([
    fetch(request),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('网络请求超时')), timeout)
    )
  ]);
}

// 生成离线页面响应
function createOfflineResponse() {
  return new Response(`
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>离线模式</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; 
               display: flex; align-items: center; justify-content: center; 
               min-height: 100vh; margin: 0; background: #f7fafc; padding: 20px; }
        .container { text-align: center; max-width: 400px; }
        h1 { color: #667eea; margin-bottom: 16px; font-size: 24px; }
        p { color: #666; line-height: 1.8; margin: 12px 0; }
        .buttons { margin-top: 24px; display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
        button { padding: 12px 24px; background: #667eea; 
                 color: white; border: none; border-radius: 8px; cursor: pointer; 
                 font-size: 14px; font-weight: 600; }
        button:active { transform: scale(0.95); }
        .secondary { background: #e2e8f0; color: #4a5568; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>📱 离线模式</h1>
        <p>当前处于离线状态，此页面尚未缓存。</p>
        <p>请连接网络后重新访问，或返回主页查看已缓存的内容。</p>
        <div class="buttons">
          <button onclick="location.reload()">重新加载</button>
          <button class="secondary" onclick="location.href='/'">返回主页</button>
        </div>
      </div>
    </body>
    </html>
  `, {
    status: 200,
    statusText: 'OK',
    headers: new Headers({
      'Content-Type': 'text/html; charset=utf-8'
    })
  });
}

// 处理缓存和网络请求的通用函数
function handleRequest(request) {
  // 使用 caches.match() 会搜索所有缓存（包括手动缓存的训练）
  return caches.match(request).then(cached => {
    if (cached) {
      return cached;
    }
    
    return fetchWithTimeout(request, 5000).then(response => {
      if (response.ok && response.status >= 200 && response.status < 300) {
        const clone = response.clone();
        // 只将新请求的资源缓存到主缓存
        caches.open(CACHE_NAME).then(cache => {
          cache.put(request, clone);
        });
      }
      return response;
    }).catch(err => {
      return createOfflineResponse();
    });
  });
}

// 接收消息 - 跳过等待
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
