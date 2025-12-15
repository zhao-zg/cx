// Service Worker for 主恢复训练合集
const CACHE_VERSION = '{{ cache_version }}';
const CACHE_NAME = 'cx-main-' + CACHE_VERSION;

// 初始安装时只缓存核心资源（主页和各训练目录页）
const CORE_RESOURCES = [
  './',
  './index.html',
  './manifest.json',
{% for training in trainings %}
  './{{ training.path }}/index.html',
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
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) {
        return cached;
      }
      return fetch(event.request).then(response => {
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, clone);
          });
        }
        return response;
      });
    }).catch(() => {
      return caches.match('./index.html');
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
