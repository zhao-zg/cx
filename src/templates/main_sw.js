// Service Worker for 主恢复训练合集
const CACHE_VERSION = '{{ cache_version }}';
const CACHE_NAME = 'cx-main-' + CACHE_VERSION;

// 获取 Service Worker 的基础 URL
const BASE_URL = self.location.origin + self.location.pathname.replace(/\/[^\/]*$/, '/');

// 初始安装时只缓存核心资源（主页和各训练目录页）
const CORE_RESOURCES = [
  BASE_URL,  // 主页 (/)，访问 /index.html 时会自动规范化为 /
  BASE_URL + 'manifest.json',
{% for training in trainings %}
  BASE_URL + '{{ training.path }}/',  // 训练目录页，访问 /path/index.html 时会自动规范化为 /path/
  BASE_URL + '{{ training.path }}/manifest.json',
{% endfor %}
];

// 所有资源列表（用于手动缓存）
const ALL_RESOURCES = [
  ...CORE_RESOURCES,
{% for training in trainings %}
{% for i in range(1, training.chapter_count + 1) %}
  BASE_URL + '{{ training.path }}/{{ i }}_cv.htm',
  BASE_URL + '{{ training.path }}/{{ i }}_cx.htm',
  BASE_URL + '{{ training.path }}/{{ i }}_sg.htm',
  BASE_URL + '{{ training.path }}/{{ i }}_ts.htm',
  BASE_URL + '{{ training.path }}/{{ i }}_zs.htm',
  BASE_URL + '{{ training.path }}/{{ i }}_h.htm',
{% endfor %}
{% endfor %}
{% for image_path in image_paths %}
  BASE_URL + '{{ image_path }}',
{% endfor %}
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
