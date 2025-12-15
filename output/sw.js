// Service Worker for 主恢复训练合集
const CACHE_VERSION = '20251215165158';
const CACHE_NAME = 'cx-main-' + CACHE_VERSION;

// 获取 Service Worker 的基础 URL
const BASE_URL = self.location.origin + self.location.pathname.replace(/\/[^\/]*$/, '/');

// 初始安装时只缓存核心资源（主页和各训练目录页）
const CORE_RESOURCES = [
  BASE_URL,
  BASE_URL + 'manifest.json',

  BASE_URL + '2025-06-感恩节/',
  BASE_URL + '2025-06-感恩节/manifest.json',
  BASE_URL + '2025-06-感恩节/js/speech.js',
  BASE_URL + '2025-06-感恩节/js/font-control.js',

  BASE_URL + '2025-05-秋季/',
  BASE_URL + '2025-05-秋季/manifest.json',
  BASE_URL + '2025-05-秋季/js/speech.js',
  BASE_URL + '2025-05-秋季/js/font-control.js',

  BASE_URL + '2025-04-夏季/',
  BASE_URL + '2025-04-夏季/manifest.json',
  BASE_URL + '2025-04-夏季/js/speech.js',
  BASE_URL + '2025-04-夏季/js/font-control.js',

];

// 所有资源列表（用于手动缓存）
const ALL_RESOURCES = [
  ...CORE_RESOURCES,


  BASE_URL + '2025-06-感恩节/1_cv.htm',
  BASE_URL + '2025-06-感恩节/1_dg.htm',
  BASE_URL + '2025-06-感恩节/1_cx.htm',
  BASE_URL + '2025-06-感恩节/1_sg.htm',
  BASE_URL + '2025-06-感恩节/1_ts.htm',
  BASE_URL + '2025-06-感恩节/1_zs.htm',
  BASE_URL + '2025-06-感恩节/1_h.htm',

  BASE_URL + '2025-06-感恩节/2_cv.htm',
  BASE_URL + '2025-06-感恩节/2_dg.htm',
  BASE_URL + '2025-06-感恩节/2_cx.htm',
  BASE_URL + '2025-06-感恩节/2_sg.htm',
  BASE_URL + '2025-06-感恩节/2_ts.htm',
  BASE_URL + '2025-06-感恩节/2_zs.htm',
  BASE_URL + '2025-06-感恩节/2_h.htm',

  BASE_URL + '2025-06-感恩节/3_cv.htm',
  BASE_URL + '2025-06-感恩节/3_dg.htm',
  BASE_URL + '2025-06-感恩节/3_cx.htm',
  BASE_URL + '2025-06-感恩节/3_sg.htm',
  BASE_URL + '2025-06-感恩节/3_ts.htm',
  BASE_URL + '2025-06-感恩节/3_zs.htm',
  BASE_URL + '2025-06-感恩节/3_h.htm',

  BASE_URL + '2025-06-感恩节/4_cv.htm',
  BASE_URL + '2025-06-感恩节/4_dg.htm',
  BASE_URL + '2025-06-感恩节/4_cx.htm',
  BASE_URL + '2025-06-感恩节/4_sg.htm',
  BASE_URL + '2025-06-感恩节/4_ts.htm',
  BASE_URL + '2025-06-感恩节/4_zs.htm',
  BASE_URL + '2025-06-感恩节/4_h.htm',

  BASE_URL + '2025-06-感恩节/5_cv.htm',
  BASE_URL + '2025-06-感恩节/5_dg.htm',
  BASE_URL + '2025-06-感恩节/5_cx.htm',
  BASE_URL + '2025-06-感恩节/5_sg.htm',
  BASE_URL + '2025-06-感恩节/5_ts.htm',
  BASE_URL + '2025-06-感恩节/5_zs.htm',
  BASE_URL + '2025-06-感恩节/5_h.htm',

  BASE_URL + '2025-06-感恩节/6_cv.htm',
  BASE_URL + '2025-06-感恩节/6_dg.htm',
  BASE_URL + '2025-06-感恩节/6_cx.htm',
  BASE_URL + '2025-06-感恩节/6_sg.htm',
  BASE_URL + '2025-06-感恩节/6_ts.htm',
  BASE_URL + '2025-06-感恩节/6_zs.htm',
  BASE_URL + '2025-06-感恩节/6_h.htm',



  BASE_URL + '2025-05-秋季/1_cv.htm',
  BASE_URL + '2025-05-秋季/1_dg.htm',
  BASE_URL + '2025-05-秋季/1_cx.htm',
  BASE_URL + '2025-05-秋季/1_sg.htm',
  BASE_URL + '2025-05-秋季/1_ts.htm',
  BASE_URL + '2025-05-秋季/1_zs.htm',
  BASE_URL + '2025-05-秋季/1_h.htm',

  BASE_URL + '2025-05-秋季/2_cv.htm',
  BASE_URL + '2025-05-秋季/2_dg.htm',
  BASE_URL + '2025-05-秋季/2_cx.htm',
  BASE_URL + '2025-05-秋季/2_sg.htm',
  BASE_URL + '2025-05-秋季/2_ts.htm',
  BASE_URL + '2025-05-秋季/2_zs.htm',
  BASE_URL + '2025-05-秋季/2_h.htm',

  BASE_URL + '2025-05-秋季/3_cv.htm',
  BASE_URL + '2025-05-秋季/3_dg.htm',
  BASE_URL + '2025-05-秋季/3_cx.htm',
  BASE_URL + '2025-05-秋季/3_sg.htm',
  BASE_URL + '2025-05-秋季/3_ts.htm',
  BASE_URL + '2025-05-秋季/3_zs.htm',
  BASE_URL + '2025-05-秋季/3_h.htm',

  BASE_URL + '2025-05-秋季/4_cv.htm',
  BASE_URL + '2025-05-秋季/4_dg.htm',
  BASE_URL + '2025-05-秋季/4_cx.htm',
  BASE_URL + '2025-05-秋季/4_sg.htm',
  BASE_URL + '2025-05-秋季/4_ts.htm',
  BASE_URL + '2025-05-秋季/4_zs.htm',
  BASE_URL + '2025-05-秋季/4_h.htm',

  BASE_URL + '2025-05-秋季/5_cv.htm',
  BASE_URL + '2025-05-秋季/5_dg.htm',
  BASE_URL + '2025-05-秋季/5_cx.htm',
  BASE_URL + '2025-05-秋季/5_sg.htm',
  BASE_URL + '2025-05-秋季/5_ts.htm',
  BASE_URL + '2025-05-秋季/5_zs.htm',
  BASE_URL + '2025-05-秋季/5_h.htm',

  BASE_URL + '2025-05-秋季/6_cv.htm',
  BASE_URL + '2025-05-秋季/6_dg.htm',
  BASE_URL + '2025-05-秋季/6_cx.htm',
  BASE_URL + '2025-05-秋季/6_sg.htm',
  BASE_URL + '2025-05-秋季/6_ts.htm',
  BASE_URL + '2025-05-秋季/6_zs.htm',
  BASE_URL + '2025-05-秋季/6_h.htm',

  BASE_URL + '2025-05-秋季/7_cv.htm',
  BASE_URL + '2025-05-秋季/7_dg.htm',
  BASE_URL + '2025-05-秋季/7_cx.htm',
  BASE_URL + '2025-05-秋季/7_sg.htm',
  BASE_URL + '2025-05-秋季/7_ts.htm',
  BASE_URL + '2025-05-秋季/7_zs.htm',
  BASE_URL + '2025-05-秋季/7_h.htm',

  BASE_URL + '2025-05-秋季/8_cv.htm',
  BASE_URL + '2025-05-秋季/8_dg.htm',
  BASE_URL + '2025-05-秋季/8_cx.htm',
  BASE_URL + '2025-05-秋季/8_sg.htm',
  BASE_URL + '2025-05-秋季/8_ts.htm',
  BASE_URL + '2025-05-秋季/8_zs.htm',
  BASE_URL + '2025-05-秋季/8_h.htm',

  BASE_URL + '2025-05-秋季/9_cv.htm',
  BASE_URL + '2025-05-秋季/9_dg.htm',
  BASE_URL + '2025-05-秋季/9_cx.htm',
  BASE_URL + '2025-05-秋季/9_sg.htm',
  BASE_URL + '2025-05-秋季/9_ts.htm',
  BASE_URL + '2025-05-秋季/9_zs.htm',
  BASE_URL + '2025-05-秋季/9_h.htm',



  BASE_URL + '2025-04-夏季/1_cv.htm',
  BASE_URL + '2025-04-夏季/1_dg.htm',
  BASE_URL + '2025-04-夏季/1_cx.htm',
  BASE_URL + '2025-04-夏季/1_sg.htm',
  BASE_URL + '2025-04-夏季/1_ts.htm',
  BASE_URL + '2025-04-夏季/1_zs.htm',
  BASE_URL + '2025-04-夏季/1_h.htm',

  BASE_URL + '2025-04-夏季/2_cv.htm',
  BASE_URL + '2025-04-夏季/2_dg.htm',
  BASE_URL + '2025-04-夏季/2_cx.htm',
  BASE_URL + '2025-04-夏季/2_sg.htm',
  BASE_URL + '2025-04-夏季/2_ts.htm',
  BASE_URL + '2025-04-夏季/2_zs.htm',
  BASE_URL + '2025-04-夏季/2_h.htm',

  BASE_URL + '2025-04-夏季/3_cv.htm',
  BASE_URL + '2025-04-夏季/3_dg.htm',
  BASE_URL + '2025-04-夏季/3_cx.htm',
  BASE_URL + '2025-04-夏季/3_sg.htm',
  BASE_URL + '2025-04-夏季/3_ts.htm',
  BASE_URL + '2025-04-夏季/3_zs.htm',
  BASE_URL + '2025-04-夏季/3_h.htm',

  BASE_URL + '2025-04-夏季/4_cv.htm',
  BASE_URL + '2025-04-夏季/4_dg.htm',
  BASE_URL + '2025-04-夏季/4_cx.htm',
  BASE_URL + '2025-04-夏季/4_sg.htm',
  BASE_URL + '2025-04-夏季/4_ts.htm',
  BASE_URL + '2025-04-夏季/4_zs.htm',
  BASE_URL + '2025-04-夏季/4_h.htm',

  BASE_URL + '2025-04-夏季/5_cv.htm',
  BASE_URL + '2025-04-夏季/5_dg.htm',
  BASE_URL + '2025-04-夏季/5_cx.htm',
  BASE_URL + '2025-04-夏季/5_sg.htm',
  BASE_URL + '2025-04-夏季/5_ts.htm',
  BASE_URL + '2025-04-夏季/5_zs.htm',
  BASE_URL + '2025-04-夏季/5_h.htm',

  BASE_URL + '2025-04-夏季/6_cv.htm',
  BASE_URL + '2025-04-夏季/6_dg.htm',
  BASE_URL + '2025-04-夏季/6_cx.htm',
  BASE_URL + '2025-04-夏季/6_sg.htm',
  BASE_URL + '2025-04-夏季/6_ts.htm',
  BASE_URL + '2025-04-夏季/6_zs.htm',
  BASE_URL + '2025-04-夏季/6_h.htm',

  BASE_URL + '2025-04-夏季/7_cv.htm',
  BASE_URL + '2025-04-夏季/7_dg.htm',
  BASE_URL + '2025-04-夏季/7_cx.htm',
  BASE_URL + '2025-04-夏季/7_sg.htm',
  BASE_URL + '2025-04-夏季/7_ts.htm',
  BASE_URL + '2025-04-夏季/7_zs.htm',
  BASE_URL + '2025-04-夏季/7_h.htm',

  BASE_URL + '2025-04-夏季/8_cv.htm',
  BASE_URL + '2025-04-夏季/8_dg.htm',
  BASE_URL + '2025-04-夏季/8_cx.htm',
  BASE_URL + '2025-04-夏季/8_sg.htm',
  BASE_URL + '2025-04-夏季/8_ts.htm',
  BASE_URL + '2025-04-夏季/8_zs.htm',
  BASE_URL + '2025-04-夏季/8_h.htm',

  BASE_URL + '2025-04-夏季/9_cv.htm',
  BASE_URL + '2025-04-夏季/9_dg.htm',
  BASE_URL + '2025-04-夏季/9_cx.htm',
  BASE_URL + '2025-04-夏季/9_sg.htm',
  BASE_URL + '2025-04-夏季/9_ts.htm',
  BASE_URL + '2025-04-夏季/9_zs.htm',
  BASE_URL + '2025-04-夏季/9_h.htm',

  BASE_URL + '2025-04-夏季/10_cv.htm',
  BASE_URL + '2025-04-夏季/10_dg.htm',
  BASE_URL + '2025-04-夏季/10_cx.htm',
  BASE_URL + '2025-04-夏季/10_sg.htm',
  BASE_URL + '2025-04-夏季/10_ts.htm',
  BASE_URL + '2025-04-夏季/10_zs.htm',
  BASE_URL + '2025-04-夏季/10_h.htm',

  BASE_URL + '2025-04-夏季/11_cv.htm',
  BASE_URL + '2025-04-夏季/11_dg.htm',
  BASE_URL + '2025-04-夏季/11_cx.htm',
  BASE_URL + '2025-04-夏季/11_sg.htm',
  BASE_URL + '2025-04-夏季/11_ts.htm',
  BASE_URL + '2025-04-夏季/11_zs.htm',
  BASE_URL + '2025-04-夏季/11_h.htm',

  BASE_URL + '2025-04-夏季/12_cv.htm',
  BASE_URL + '2025-04-夏季/12_dg.htm',
  BASE_URL + '2025-04-夏季/12_cx.htm',
  BASE_URL + '2025-04-夏季/12_sg.htm',
  BASE_URL + '2025-04-夏季/12_ts.htm',
  BASE_URL + '2025-04-夏季/12_zs.htm',
  BASE_URL + '2025-04-夏季/12_h.htm',



  BASE_URL + '2025-06-感恩节/images/hymn_1_晨兴.png',

  BASE_URL + '2025-06-感恩节/images/hymn_2_晨兴.png',

  BASE_URL + '2025-06-感恩节/images/hymn_3_晨兴.png',

  BASE_URL + '2025-06-感恩节/images/hymn_4_晨兴.png',

  BASE_URL + '2025-06-感恩节/images/hymn_5_晨兴.png',

  BASE_URL + '2025-06-感恩节/images/hymn_6_晨兴.png',

  BASE_URL + '2025-05-秋季/images/hymn_1_晨兴x.png',

  BASE_URL + '2025-05-秋季/images/hymn_2_晨兴x.png',

  BASE_URL + '2025-05-秋季/images/hymn_3_晨兴x.png',

  BASE_URL + '2025-05-秋季/images/hymn_4_晨兴x.png',

  BASE_URL + '2025-05-秋季/images/hymn_5_晨兴x.png',

  BASE_URL + '2025-05-秋季/images/hymn_6_晨兴x.png',

  BASE_URL + '2025-05-秋季/images/hymn_7_晨兴x.png',

  BASE_URL + '2025-05-秋季/images/hymn_8_晨兴x.png',

  BASE_URL + '2025-05-秋季/images/hymn_9_晨兴x.png',

  BASE_URL + '2025-04-夏季/images/hymn_10_晨兴2.png',

  BASE_URL + '2025-04-夏季/images/hymn_11_晨兴2.png',

  BASE_URL + '2025-04-夏季/images/hymn_12_晨兴2.png',

  BASE_URL + '2025-04-夏季/images/hymn_1_晨兴x.png',

  BASE_URL + '2025-04-夏季/images/hymn_2_晨兴x.png',

  BASE_URL + '2025-04-夏季/images/hymn_3_晨兴x.png',

  BASE_URL + '2025-04-夏季/images/hymn_4_晨兴x.png',

  BASE_URL + '2025-04-夏季/images/hymn_5_晨兴x.png',

  BASE_URL + '2025-04-夏季/images/hymn_6_晨兴x.png',

  BASE_URL + '2025-04-夏季/images/hymn_7_晨兴2.png',

  BASE_URL + '2025-04-夏季/images/hymn_8_晨兴2.png',

  BASE_URL + '2025-04-夏季/images/hymn_9_晨兴2.png',

];

// 安装事件 - 只预缓存核心资源
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(CORE_RESOURCES).catch(err => {
        console.error('缓存核心资源失败:', err);
        // 即使失败也继续安装，避免阻塞
        return Promise.resolve();
      });
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
    }).then(() => {
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
          // 网络失败，返回友好的离线页面
          console.log('离线或网络超时:', normalizedRequest.url);
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
                       min-height: 100vh; margin: 0; background: #f7fafc; }
                .container { text-align: center; padding: 20px; }
                h1 { color: #667eea; margin-bottom: 20px; }
                p { color: #666; line-height: 1.8; }
                button { margin-top: 20px; padding: 12px 24px; background: #667eea; 
                         color: white; border: none; border-radius: 6px; cursor: pointer; }
              </style>
            </head>
            <body>
              <div class="container">
                <h1>📱 离线模式</h1>
                <p>当前处于离线状态，此页面尚未缓存。</p>
                <p>请连接网络后重新访问。</p>
                <button onclick="location.reload()">重新加载</button>
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
        // 网络失败，返回友好的离线页面
        console.log('离线或网络超时:', event.request.url);
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
                     min-height: 100vh; margin: 0; background: #f7fafc; }
              .container { text-align: center; padding: 20px; }
              h1 { color: #667eea; margin-bottom: 20px; }
              p { color: #666; line-height: 1.8; }
              button { margin-top: 20px; padding: 12px 24px; background: #667eea; 
                       color: white; border: none; border-radius: 6px; cursor: pointer; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>📱 离线模式</h1>
              <p>当前处于离线状态，此页面尚未缓存。</p>
              <p>请连接网络后重新访问。</p>
              <button onclick="location.reload()">重新加载</button>
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