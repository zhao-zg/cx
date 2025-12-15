// Service Worker for 主恢复训练合集
const CACHE_VERSION = '20251215145011';
const CACHE_NAME = 'cx-main-' + CACHE_VERSION;

// 初始安装时只缓存核心资源（主页和各训练目录页）
const CORE_RESOURCES = [
  './',
  './manifest.json',

  './2025-06-感恩节/',
  './2025-06-感恩节/manifest.json',
  './2025-06-感恩节/js/speech.js',
  './2025-06-感恩节/js/font-control.js',

  './2025-05-秋季/',
  './2025-05-秋季/manifest.json',
  './2025-05-秋季/js/speech.js',
  './2025-05-秋季/js/font-control.js',

  './2025-04-夏季/',
  './2025-04-夏季/manifest.json',
  './2025-04-夏季/js/speech.js',
  './2025-04-夏季/js/font-control.js',

];

// 所有资源列表（用于手动缓存）
const ALL_RESOURCES = [
  ...CORE_RESOURCES,


  './2025-06-感恩节/1_cv.htm',
  './2025-06-感恩节/1_dg.htm',
  './2025-06-感恩节/1_cx.htm',
  './2025-06-感恩节/1_sg.htm',
  './2025-06-感恩节/1_ts.htm',
  './2025-06-感恩节/1_zs.htm',
  './2025-06-感恩节/1_h.htm',

  './2025-06-感恩节/2_cv.htm',
  './2025-06-感恩节/2_dg.htm',
  './2025-06-感恩节/2_cx.htm',
  './2025-06-感恩节/2_sg.htm',
  './2025-06-感恩节/2_ts.htm',
  './2025-06-感恩节/2_zs.htm',
  './2025-06-感恩节/2_h.htm',

  './2025-06-感恩节/3_cv.htm',
  './2025-06-感恩节/3_dg.htm',
  './2025-06-感恩节/3_cx.htm',
  './2025-06-感恩节/3_sg.htm',
  './2025-06-感恩节/3_ts.htm',
  './2025-06-感恩节/3_zs.htm',
  './2025-06-感恩节/3_h.htm',

  './2025-06-感恩节/4_cv.htm',
  './2025-06-感恩节/4_dg.htm',
  './2025-06-感恩节/4_cx.htm',
  './2025-06-感恩节/4_sg.htm',
  './2025-06-感恩节/4_ts.htm',
  './2025-06-感恩节/4_zs.htm',
  './2025-06-感恩节/4_h.htm',

  './2025-06-感恩节/5_cv.htm',
  './2025-06-感恩节/5_dg.htm',
  './2025-06-感恩节/5_cx.htm',
  './2025-06-感恩节/5_sg.htm',
  './2025-06-感恩节/5_ts.htm',
  './2025-06-感恩节/5_zs.htm',
  './2025-06-感恩节/5_h.htm',

  './2025-06-感恩节/6_cv.htm',
  './2025-06-感恩节/6_dg.htm',
  './2025-06-感恩节/6_cx.htm',
  './2025-06-感恩节/6_sg.htm',
  './2025-06-感恩节/6_ts.htm',
  './2025-06-感恩节/6_zs.htm',
  './2025-06-感恩节/6_h.htm',



  './2025-05-秋季/1_cv.htm',
  './2025-05-秋季/1_dg.htm',
  './2025-05-秋季/1_cx.htm',
  './2025-05-秋季/1_sg.htm',
  './2025-05-秋季/1_ts.htm',
  './2025-05-秋季/1_zs.htm',
  './2025-05-秋季/1_h.htm',

  './2025-05-秋季/2_cv.htm',
  './2025-05-秋季/2_dg.htm',
  './2025-05-秋季/2_cx.htm',
  './2025-05-秋季/2_sg.htm',
  './2025-05-秋季/2_ts.htm',
  './2025-05-秋季/2_zs.htm',
  './2025-05-秋季/2_h.htm',

  './2025-05-秋季/3_cv.htm',
  './2025-05-秋季/3_dg.htm',
  './2025-05-秋季/3_cx.htm',
  './2025-05-秋季/3_sg.htm',
  './2025-05-秋季/3_ts.htm',
  './2025-05-秋季/3_zs.htm',
  './2025-05-秋季/3_h.htm',

  './2025-05-秋季/4_cv.htm',
  './2025-05-秋季/4_dg.htm',
  './2025-05-秋季/4_cx.htm',
  './2025-05-秋季/4_sg.htm',
  './2025-05-秋季/4_ts.htm',
  './2025-05-秋季/4_zs.htm',
  './2025-05-秋季/4_h.htm',

  './2025-05-秋季/5_cv.htm',
  './2025-05-秋季/5_dg.htm',
  './2025-05-秋季/5_cx.htm',
  './2025-05-秋季/5_sg.htm',
  './2025-05-秋季/5_ts.htm',
  './2025-05-秋季/5_zs.htm',
  './2025-05-秋季/5_h.htm',

  './2025-05-秋季/6_cv.htm',
  './2025-05-秋季/6_dg.htm',
  './2025-05-秋季/6_cx.htm',
  './2025-05-秋季/6_sg.htm',
  './2025-05-秋季/6_ts.htm',
  './2025-05-秋季/6_zs.htm',
  './2025-05-秋季/6_h.htm',

  './2025-05-秋季/7_cv.htm',
  './2025-05-秋季/7_dg.htm',
  './2025-05-秋季/7_cx.htm',
  './2025-05-秋季/7_sg.htm',
  './2025-05-秋季/7_ts.htm',
  './2025-05-秋季/7_zs.htm',
  './2025-05-秋季/7_h.htm',

  './2025-05-秋季/8_cv.htm',
  './2025-05-秋季/8_dg.htm',
  './2025-05-秋季/8_cx.htm',
  './2025-05-秋季/8_sg.htm',
  './2025-05-秋季/8_ts.htm',
  './2025-05-秋季/8_zs.htm',
  './2025-05-秋季/8_h.htm',

  './2025-05-秋季/9_cv.htm',
  './2025-05-秋季/9_dg.htm',
  './2025-05-秋季/9_cx.htm',
  './2025-05-秋季/9_sg.htm',
  './2025-05-秋季/9_ts.htm',
  './2025-05-秋季/9_zs.htm',
  './2025-05-秋季/9_h.htm',



  './2025-04-夏季/1_cv.htm',
  './2025-04-夏季/1_dg.htm',
  './2025-04-夏季/1_cx.htm',
  './2025-04-夏季/1_sg.htm',
  './2025-04-夏季/1_ts.htm',
  './2025-04-夏季/1_zs.htm',
  './2025-04-夏季/1_h.htm',

  './2025-04-夏季/2_cv.htm',
  './2025-04-夏季/2_dg.htm',
  './2025-04-夏季/2_cx.htm',
  './2025-04-夏季/2_sg.htm',
  './2025-04-夏季/2_ts.htm',
  './2025-04-夏季/2_zs.htm',
  './2025-04-夏季/2_h.htm',

  './2025-04-夏季/3_cv.htm',
  './2025-04-夏季/3_dg.htm',
  './2025-04-夏季/3_cx.htm',
  './2025-04-夏季/3_sg.htm',
  './2025-04-夏季/3_ts.htm',
  './2025-04-夏季/3_zs.htm',
  './2025-04-夏季/3_h.htm',

  './2025-04-夏季/4_cv.htm',
  './2025-04-夏季/4_dg.htm',
  './2025-04-夏季/4_cx.htm',
  './2025-04-夏季/4_sg.htm',
  './2025-04-夏季/4_ts.htm',
  './2025-04-夏季/4_zs.htm',
  './2025-04-夏季/4_h.htm',

  './2025-04-夏季/5_cv.htm',
  './2025-04-夏季/5_dg.htm',
  './2025-04-夏季/5_cx.htm',
  './2025-04-夏季/5_sg.htm',
  './2025-04-夏季/5_ts.htm',
  './2025-04-夏季/5_zs.htm',
  './2025-04-夏季/5_h.htm',

  './2025-04-夏季/6_cv.htm',
  './2025-04-夏季/6_dg.htm',
  './2025-04-夏季/6_cx.htm',
  './2025-04-夏季/6_sg.htm',
  './2025-04-夏季/6_ts.htm',
  './2025-04-夏季/6_zs.htm',
  './2025-04-夏季/6_h.htm',

  './2025-04-夏季/7_cv.htm',
  './2025-04-夏季/7_dg.htm',
  './2025-04-夏季/7_cx.htm',
  './2025-04-夏季/7_sg.htm',
  './2025-04-夏季/7_ts.htm',
  './2025-04-夏季/7_zs.htm',
  './2025-04-夏季/7_h.htm',

  './2025-04-夏季/8_cv.htm',
  './2025-04-夏季/8_dg.htm',
  './2025-04-夏季/8_cx.htm',
  './2025-04-夏季/8_sg.htm',
  './2025-04-夏季/8_ts.htm',
  './2025-04-夏季/8_zs.htm',
  './2025-04-夏季/8_h.htm',

  './2025-04-夏季/9_cv.htm',
  './2025-04-夏季/9_dg.htm',
  './2025-04-夏季/9_cx.htm',
  './2025-04-夏季/9_sg.htm',
  './2025-04-夏季/9_ts.htm',
  './2025-04-夏季/9_zs.htm',
  './2025-04-夏季/9_h.htm',

  './2025-04-夏季/10_cv.htm',
  './2025-04-夏季/10_dg.htm',
  './2025-04-夏季/10_cx.htm',
  './2025-04-夏季/10_sg.htm',
  './2025-04-夏季/10_ts.htm',
  './2025-04-夏季/10_zs.htm',
  './2025-04-夏季/10_h.htm',

  './2025-04-夏季/11_cv.htm',
  './2025-04-夏季/11_dg.htm',
  './2025-04-夏季/11_cx.htm',
  './2025-04-夏季/11_sg.htm',
  './2025-04-夏季/11_ts.htm',
  './2025-04-夏季/11_zs.htm',
  './2025-04-夏季/11_h.htm',

  './2025-04-夏季/12_cv.htm',
  './2025-04-夏季/12_dg.htm',
  './2025-04-夏季/12_cx.htm',
  './2025-04-夏季/12_sg.htm',
  './2025-04-夏季/12_ts.htm',
  './2025-04-夏季/12_zs.htm',
  './2025-04-夏季/12_h.htm',


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
          if (response.ok && normalizedRequest.method === 'GET') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(normalizedRequest, clone);
            });
          }
          return response;
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
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, clone);
          });
        }
        return response;
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