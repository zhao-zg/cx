// Service Worker for 夏季训练
const CACHE_NAME = 'cx-2025-夏季-v1';

// 所有需要缓存的资源
const RESOURCES = [
  './',
  './index.html',
  './manifest.json',
  './js/speech.js',
  './js/font-control.js',

  './1_cv.htm',
  './1_dg.htm',
  './1_cx.htm',
  './1_sg.htm',
  './1_ts.htm',
  './1_zs.htm',
  './1_h.htm',

  './2_cv.htm',
  './2_dg.htm',
  './2_cx.htm',
  './2_sg.htm',
  './2_ts.htm',
  './2_zs.htm',
  './2_h.htm',

  './3_cv.htm',
  './3_dg.htm',
  './3_cx.htm',
  './3_sg.htm',
  './3_ts.htm',
  './3_zs.htm',
  './3_h.htm',

  './4_cv.htm',
  './4_dg.htm',
  './4_cx.htm',
  './4_sg.htm',
  './4_ts.htm',
  './4_zs.htm',
  './4_h.htm',

  './5_cv.htm',
  './5_dg.htm',
  './5_cx.htm',
  './5_sg.htm',
  './5_ts.htm',
  './5_zs.htm',
  './5_h.htm',

  './6_cv.htm',
  './6_dg.htm',
  './6_cx.htm',
  './6_sg.htm',
  './6_ts.htm',
  './6_zs.htm',
  './6_h.htm',

  './7_cv.htm',
  './7_dg.htm',
  './7_cx.htm',
  './7_sg.htm',
  './7_ts.htm',
  './7_zs.htm',
  './7_h.htm',

  './8_cv.htm',
  './8_dg.htm',
  './8_cx.htm',
  './8_sg.htm',
  './8_ts.htm',
  './8_zs.htm',
  './8_h.htm',

  './9_cv.htm',
  './9_dg.htm',
  './9_cx.htm',
  './9_sg.htm',
  './9_ts.htm',
  './9_zs.htm',
  './9_h.htm',

  './10_cv.htm',
  './10_dg.htm',
  './10_cx.htm',
  './10_sg.htm',
  './10_ts.htm',
  './10_zs.htm',
  './10_h.htm',

  './11_cv.htm',
  './11_dg.htm',
  './11_cx.htm',
  './11_sg.htm',
  './11_ts.htm',
  './11_zs.htm',
  './11_h.htm',

  './12_cv.htm',
  './12_dg.htm',
  './12_cx.htm',
  './12_sg.htm',
  './12_ts.htm',
  './12_zs.htm',
  './12_h.htm',

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

// 请求拦截 - 网络优先策略（有网络时获取最新，离线时使用缓存）
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request).then(response => {
      // 网络请求成功，更新缓存
      if (response.ok && event.request.method === 'GET') {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, clone);
        });
      }
      return response;
    }).catch(() => {
      // 网络失败，使用缓存
      return caches.match(event.request).then(cached => {
        return cached || caches.match('./index.html');
      });
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