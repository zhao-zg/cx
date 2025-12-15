// Service Worker for 主恢复训练合集
const CACHE_VERSION = '{{ cache_version }}';
const CACHE_NAME = 'cx-main-' + CACHE_VERSION;

// 初始安装时只缓存核心资源（主页和各训练目录页）
const CORE_RESOURCES = [
  './',
  './manifest.json',
{% for training in trainings %}
  './{{ training.path }}/',
  './{{ training.path }}/manifest.json',
  './{{ training.path }}/js/speech.js',
  './{{ training.path }}/js/font-control.js',
{% endfor %}
];

// 所有资源列表（用于手动缓存）
const ALL_RESOURCES = [
  ...CORE_RESOURCES,
{% for training in trainings %}
{% for i in range(1, training.chapter_count + 1) %}
  './{{ training.path }}/{{ i }}_cv.htm',
  './{{ training.path }}/{{ i }}_dg.htm',
  './{{ training.path }}/{{ i }}_cx.htm',
  './{{ training.path }}/{{ i }}_sg.htm',
  './{{ training.path }}/{{ i }}_ts.htm',
  './{{ training.path }}/{{ i }}_zs.htm',
  './{{ training.path }}/{{ i }}_h.htm',
{% endfor %}
{% endfor %}
];

// 安装事件 - 只预缓存核心资源
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(CORE_RESOURCES);
    })
  );
  self.skipWaiting();
});

// 激活事件 - 清理旧缓存
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// 请求拦截 - 缓存优先策略（离线优先）
self.addEventListener('fetch', event => {
  // 规范化 URL：将 index.html 请求重定向到目录
  let requestUrl = new URL(event.request.url);
  if (requestUrl.pathname.endsWith('/index.html')) {
    requestUrl.pathname = requestUrl.pathname.replace(/\/index\.html$/, '/');
    const normalizedRequest = new Request(requestUrl.toString(), {
      method: event.request.method,
      headers: event.request.headers,
      mode: event.request.mode,
      credentials: event.request.credentials,
      redirect: event.request.redirect
    });
    
    event.respondWith(
      // 优先从缓存返回
      caches.match(normalizedRequest).then(cached => {
        // 如果有缓存，立即返回
        if (cached) {
          return cached;
        }
        
        // 没有缓存时，尝试网络请求（带超时）
        return fetchWithTimeout(normalizedRequest, 5000).then(response => {
          if (response.ok && response.status >= 200 && response.status < 300 && normalizedRequest.method === 'GET') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(normalizedRequest, clone);
            });
          }
          return response;
        }).catch(err => {
          // 网络失败，返回离线页面提示
          console.log('离线或网络超时:', normalizedRequest.url);
          return new Response('离线模式：请先缓存此页面', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: new Headers({
              'Content-Type': 'text/html; charset=utf-8'
            })
          });
        });
      })
    );
    return;
  }
  
  event.respondWith(
    // 优先从缓存返回
    caches.match(event.request).then(cached => {
      // 如果有缓存，立即返回
      if (cached) {
        return cached;
      }
      
      // 没有缓存时，尝试网络请求（带超时）
      return fetchWithTimeout(event.request, 5000).then(response => {
        if (response.ok && response.status >= 200 && response.status < 300 && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(err => {
        // 网络失败，返回离线页面提示
        console.log('离线或网络超时:', event.request.url);
        return new Response('离线模式：请先缓存此页面', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: new Headers({
            'Content-Type': 'text/html; charset=utf-8'
          })
        });
      });
    })
  );
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

// 接收消息 - 手动缓存和跳过等待
self.addEventListener('message', event => {
  if (event.data === 'cache-all') {
    event.waitUntil(
      caches.open(CACHE_NAME).then(cache => {
        return cache.addAll(ALL_RESOURCES).then(() => {
          self.clients.matchAll().then(clients => {
            clients.forEach(client => client.postMessage({ type: 'cached', success: true }));
          });
        });
      }).catch(err => {
        self.clients.matchAll().then(clients => {
          clients.forEach(client => client.postMessage({ type: 'cached', success: false, error: err.message }));
        });
      })
    );
  } else if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
