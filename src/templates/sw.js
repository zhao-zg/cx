// Service Worker for {{ training.title }}
const CACHE_NAME = 'cx-{{ training.year }}-{{ training.season }}-v1';

// 所有需要缓存的资源
const RESOURCES = [
  './',
  './index.html',
  './js/speech.js',
  './js/font-control.js',
{% for chapter in training.chapters %}
  './{{ chapter.number }}_cv.htm',
  './{{ chapter.number }}_dg.htm',
  './{{ chapter.number }}_cx.htm',
  './{{ chapter.number }}_sg.htm',
  './{{ chapter.number }}_ts.htm',
  './{{ chapter.number }}_zs.htm',
  './{{ chapter.number }}_h.htm',
{% endfor %}
];

// 安装事件 - 预缓存资源
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(RESOURCES);
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
      return cached || fetch(event.request).then(response => {
        // 缓存新请求的资源
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, clone);
          });
        }
        return response;
      });
    }).catch(() => {
      // 离线时返回缓存的首页
      return caches.match('./index.html');
    })
  );
});

// 接收消息 - 手动缓存
self.addEventListener('message', event => {
  if (event.data === 'cache-all') {
    event.waitUntil(
      caches.open(CACHE_NAME).then(cache => {
        return cache.addAll(RESOURCES).then(() => {
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
  }
});
