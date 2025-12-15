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

// 请求拦截 - 缓存优先策略
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
      caches.match(normalizedRequest).then(cached => {
        if (cached) {
          return cached;
        }
        return fetch(normalizedRequest).then(response => {
          // 只缓存成功的响应（200-299）
          if (response.ok && response.status >= 200 && response.status < 300 && normalizedRequest.method === 'GET') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(normalizedRequest, clone);
            });
          }
          return response;
        }).catch(err => {
          // 网络错误时，如果有缓存则返回缓存，否则返回主页
          return caches.match(normalizedRequest).then(cachedResponse => {
            return cachedResponse || caches.match('./');
          });
        });
      }).catch(() => {
        return caches.match('./');
      })
    );
    return;
  }
  
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) {
        return cached;
      }
      return fetch(event.request).then(response => {
        // 只缓存成功的响应（200-299）
        if (response.ok && response.status >= 200 && response.status < 300 && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(err => {
        // 网络错误时，如果有缓存则返回缓存，否则返回主页
        return caches.match(event.request).then(cachedResponse => {
          return cachedResponse || caches.match('./');
        });
      });
    }).catch(() => {
      return caches.match('./');
    })
  );
});

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
