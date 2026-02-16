/**
 * Service Worker for 特会信息合集
 * 修复版：解决 Response body already used 错误
 */

const CACHE_VERSION = '20260216003932';
const CACHE_NAME = 'cx-main-' + CACHE_VERSION;

const CONFIG = {
  TIMEOUT: 5000,
  CORE_RESOURCES: [
    './',
    './manifest.json',
    './trainings.json',
    './version.json',
    './icons/icon-512.png',
    './icons/icon-180.png',
    './icons/icon-384.png',
    './icons/icon-16.png',
    './icons/icon-96.png',
    './icons/icon-48.png',
    './icons/icon-144.png',
    './icons/icon-192.png',
    './icons/icon-72.png',
    './icons/icon-64.png',
    './icons/icon-167.png',
    './icons/icon-32.png',
    './icons/icon-152.png',
    './icons/icon-128.png',
    './icons/icon-256.png',
    './icons/icon-120.png',
    './icons/icon.svg',
    './js/app-update.js',
    './js/nav-stack.js',
    './js/theme-toggle.js',
    './vendor/jszip.min.js'
  ],
  TRAINING_PAGES: [
    './2025-07/8_ts.htm',
    './2025-07/7_zs.htm',
    './2025-07/6_ts.htm',
    './2025-07/2_h.htm',
    './2025-07/1_cv.htm',
    './2025-07/8_sg.htm',
    './2025-07/6_zs.htm',
    './2025-07/9_sg.htm',
    './2025-07/12_ts.htm',
    './2025-07/9_ts.htm',
    './2025-07/9_cv.htm',
    './2025-07/10_ts.htm',
    './2025-07/6_sg.htm',
    './2025-07/',
    './2025-07/5_ts.htm',
    './2025-07/7_cx.htm',
    './2025-07/5_h.htm',
    './2025-07/5_cx.htm',
    './2025-07/4_sg.htm',
    './2025-07/4_cv.htm',
    './2025-07/1_cx.htm',
    './2025-07/2_cx.htm',
    './2025-07/motto.htm',
    './2025-07/11_zs.htm',
    './2025-07/11_cv.htm',
    './2025-07/7_sg.htm',
    './2025-07/11_ts.htm',
    './2025-07/6_cx.htm',
    './2025-07/3_zs.htm',
    './2025-07/12_cx.htm',
    './2025-07/9_zs.htm',
    './2025-07/2_zs.htm',
    './2025-07/10_cv.htm',
    './2025-07/9_h.htm',
    './2025-07/4_zs.htm',
    './2025-07/9_cx.htm',
    './2025-07/10_zs.htm',
    './2025-07/6_cv.htm',
    './2025-07/1_sg.htm',
    './2025-07/10_h.htm',
    './2025-07/motto_song.htm',
    './2025-07/5_zs.htm',
    './2025-07/3_sg.htm',
    './2025-07/11_sg.htm',
    './2025-07/12_sg.htm',
    './2025-07/8_zs.htm',
    './2025-07/12_cv.htm',
    './2025-07/11_h.htm',
    './2025-07/4_cx.htm',
    './2025-07/3_cx.htm',
    './2025-07/3_ts.htm',
    './2025-07/8_cx.htm',
    './2025-07/7_ts.htm',
    './2025-07/7_cv.htm',
    './2025-07/3_cv.htm',
    './2025-07/4_ts.htm',
    './2025-07/12_zs.htm',
    './2025-07/11_cx.htm',
    './2025-07/10_sg.htm',
    './2025-07/4_h.htm',
    './2025-07/5_cv.htm',
    './2025-07/2_sg.htm',
    './2025-07/2_cv.htm',
    './2025-07/6_h.htm',
    './2025-07/10_cx.htm',
    './2025-07/8_h.htm',
    './2025-07/12_h.htm',
    './2025-07/1_ts.htm',
    './2025-07/5_sg.htm',
    './2025-07/3_h.htm',
    './2025-07/2_ts.htm',
    './2025-07/7_h.htm',
    './2025-07/8_cv.htm',
    './2025-07/1_zs.htm',
    './2025-07/1_h.htm',
    './2025-07/js/outline.js',
    './2025-07/js/speech.js',
    './2025-07/js/toc-redirect.js',
    './2025-07/js/highlight.js',
    './2025-07/js/nav-stack.js',
    './2025-07/js/theme-toggle.js',
    './2025-06/6_ts.htm',
    './2025-06/2_h.htm',
    './2025-06/1_cv.htm',
    './2025-06/6_zs.htm',
    './2025-06/6_sg.htm',
    './2025-06/',
    './2025-06/5_ts.htm',
    './2025-06/5_h.htm',
    './2025-06/5_cx.htm',
    './2025-06/4_sg.htm',
    './2025-06/4_cv.htm',
    './2025-06/1_cx.htm',
    './2025-06/2_cx.htm',
    './2025-06/motto.htm',
    './2025-06/6_cx.htm',
    './2025-06/3_zs.htm',
    './2025-06/2_zs.htm',
    './2025-06/4_zs.htm',
    './2025-06/6_cv.htm',
    './2025-06/1_sg.htm',
    './2025-06/5_zs.htm',
    './2025-06/3_sg.htm',
    './2025-06/4_cx.htm',
    './2025-06/3_cx.htm',
    './2025-06/3_ts.htm',
    './2025-06/3_cv.htm',
    './2025-06/4_ts.htm',
    './2025-06/4_h.htm',
    './2025-06/5_cv.htm',
    './2025-06/2_sg.htm',
    './2025-06/2_cv.htm',
    './2025-06/6_h.htm',
    './2025-06/1_ts.htm',
    './2025-06/5_sg.htm',
    './2025-06/3_h.htm',
    './2025-06/2_ts.htm',
    './2025-06/1_zs.htm',
    './2025-06/1_h.htm',
    './2025-06/js/outline.js',
    './2025-06/js/speech.js',
    './2025-06/js/toc-redirect.js',
    './2025-06/js/highlight.js',
    './2025-06/js/nav-stack.js',
    './2025-06/js/theme-toggle.js',
    './2025-05/8_ts.htm',
    './2025-05/7_zs.htm',
    './2025-05/6_ts.htm',
    './2025-05/2_h.htm',
    './2025-05/1_cv.htm',
    './2025-05/8_sg.htm',
    './2025-05/6_zs.htm',
    './2025-05/9_sg.htm',
    './2025-05/9_ts.htm',
    './2025-05/9_cv.htm',
    './2025-05/6_sg.htm',
    './2025-05/',
    './2025-05/5_ts.htm',
    './2025-05/7_cx.htm',
    './2025-05/5_h.htm',
    './2025-05/5_cx.htm',
    './2025-05/4_sg.htm',
    './2025-05/4_cv.htm',
    './2025-05/1_cx.htm',
    './2025-05/2_cx.htm',
    './2025-05/motto.htm',
    './2025-05/7_sg.htm',
    './2025-05/6_cx.htm',
    './2025-05/3_zs.htm',
    './2025-05/9_zs.htm',
    './2025-05/2_zs.htm',
    './2025-05/9_h.htm',
    './2025-05/4_zs.htm',
    './2025-05/9_cx.htm',
    './2025-05/6_cv.htm',
    './2025-05/1_sg.htm',
    './2025-05/5_zs.htm',
    './2025-05/3_sg.htm',
    './2025-05/8_zs.htm',
    './2025-05/4_cx.htm',
    './2025-05/3_cx.htm',
    './2025-05/3_ts.htm',
    './2025-05/8_cx.htm',
    './2025-05/7_ts.htm',
    './2025-05/7_cv.htm',
    './2025-05/3_cv.htm',
    './2025-05/4_ts.htm',
    './2025-05/4_h.htm',
    './2025-05/5_cv.htm',
    './2025-05/2_sg.htm',
    './2025-05/2_cv.htm',
    './2025-05/6_h.htm',
    './2025-05/8_h.htm',
    './2025-05/1_ts.htm',
    './2025-05/5_sg.htm',
    './2025-05/3_h.htm',
    './2025-05/2_ts.htm',
    './2025-05/7_h.htm',
    './2025-05/8_cv.htm',
    './2025-05/1_zs.htm',
    './2025-05/1_h.htm',
    './2025-05/js/outline.js',
    './2025-05/js/speech.js',
    './2025-05/js/toc-redirect.js',
    './2025-05/js/highlight.js',
    './2025-05/js/nav-stack.js',
    './2025-05/js/theme-toggle.js',
    './2025-04/8_ts.htm',
    './2025-04/7_zs.htm',
    './2025-04/6_ts.htm',
    './2025-04/2_h.htm',
    './2025-04/1_cv.htm',
    './2025-04/8_sg.htm',
    './2025-04/6_zs.htm',
    './2025-04/9_sg.htm',
    './2025-04/12_ts.htm',
    './2025-04/9_ts.htm',
    './2025-04/9_cv.htm',
    './2025-04/10_ts.htm',
    './2025-04/6_sg.htm',
    './2025-04/',
    './2025-04/5_ts.htm',
    './2025-04/7_cx.htm',
    './2025-04/5_h.htm',
    './2025-04/5_cx.htm',
    './2025-04/4_sg.htm',
    './2025-04/4_cv.htm',
    './2025-04/1_cx.htm',
    './2025-04/2_cx.htm',
    './2025-04/motto.htm',
    './2025-04/11_zs.htm',
    './2025-04/11_cv.htm',
    './2025-04/7_sg.htm',
    './2025-04/11_ts.htm',
    './2025-04/6_cx.htm',
    './2025-04/3_zs.htm',
    './2025-04/12_cx.htm',
    './2025-04/9_zs.htm',
    './2025-04/2_zs.htm',
    './2025-04/10_cv.htm',
    './2025-04/9_h.htm',
    './2025-04/4_zs.htm',
    './2025-04/9_cx.htm',
    './2025-04/10_zs.htm',
    './2025-04/6_cv.htm',
    './2025-04/1_sg.htm',
    './2025-04/10_h.htm',
    './2025-04/motto_song.htm',
    './2025-04/5_zs.htm',
    './2025-04/3_sg.htm',
    './2025-04/11_sg.htm',
    './2025-04/12_sg.htm',
    './2025-04/8_zs.htm',
    './2025-04/12_cv.htm',
    './2025-04/11_h.htm',
    './2025-04/4_cx.htm',
    './2025-04/3_cx.htm',
    './2025-04/3_ts.htm',
    './2025-04/8_cx.htm',
    './2025-04/7_ts.htm',
    './2025-04/7_cv.htm',
    './2025-04/3_cv.htm',
    './2025-04/4_ts.htm',
    './2025-04/12_zs.htm',
    './2025-04/11_cx.htm',
    './2025-04/10_sg.htm',
    './2025-04/4_h.htm',
    './2025-04/5_cv.htm',
    './2025-04/2_sg.htm',
    './2025-04/2_cv.htm',
    './2025-04/6_h.htm',
    './2025-04/10_cx.htm',
    './2025-04/8_h.htm',
    './2025-04/12_h.htm',
    './2025-04/1_ts.htm',
    './2025-04/5_sg.htm',
    './2025-04/3_h.htm',
    './2025-04/2_ts.htm',
    './2025-04/7_h.htm',
    './2025-04/8_cv.htm',
    './2025-04/1_zs.htm',
    './2025-04/1_h.htm',
    './2025-04/js/outline.js',
    './2025-04/js/speech.js',
    './2025-04/js/toc-redirect.js',
    './2025-04/js/highlight.js',
    './2025-04/js/nav-stack.js',
    './2025-04/js/theme-toggle.js'
  ],
  CACHEABLE_TYPES: ['basic', 'cors']
};

// --------------------------------------------------------------------------
// 1. 生命周期
// --------------------------------------------------------------------------

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(
        CONFIG.CORE_RESOURCES.map(url => 
          fetch(new Request(url, { cache: 'reload' }))
            .then(res => res.ok ? cache.put(url, res) : null)
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key.startsWith('cx-main-') && key !== CACHE_NAME)
          .map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

// --------------------------------------------------------------------------
// 2. URL 规范化 (处理中文路径)
// --------------------------------------------------------------------------

function normalizeUrl(urlStr) {
  try {
    let url = new URL(urlStr);
    let decodedPath = decodeURIComponent(url.pathname);
    
    if (decodedPath.endsWith('/index.html')) {
      decodedPath = decodedPath.slice(0, -10);
    }
    
    // 目录补全斜杠
    if (!decodedPath.split('/').pop().includes('.') && !decodedPath.endsWith('/')) {
      decodedPath += '/';
    }

    return url.origin + decodedPath;
  } catch (e) {
    return urlStr;
  }
}

// --------------------------------------------------------------------------
// 3. 请求拦截
// --------------------------------------------------------------------------

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const request = event.request;
  const normalizedUrl = normalizeUrl(request.url);

  event.respondWith((async () => {
    // 1. 缓存优先 (尝试原始 URL 和规范化 URL)
    const cached = await caches.match(request) || await caches.match(normalizedUrl);
    if (cached) return cached;

    // 2. 缓存未命中
    return fetchAndCache(request, normalizedUrl);
  })());
});

/**
 * 核心修复：请求并缓存
 */
async function fetchAndCache(request, normalizedUrl) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.TIMEOUT);

  try {
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timeoutId);

    // 检查响应是否有效且值得缓存
    if (response && response.status === 200 && CONFIG.CACHEABLE_TYPES.includes(response.type)) {
      const cache = await caches.open(CACHE_NAME);
      
      /* 关键修复：
         1. 存储原始请求：使用 response.clone()
         2. 如果有规范化路径：再 clone 一次
         3. 最后的 response 返回给浏览器使用
      */
      cache.put(request, response.clone());
      
      if (request.url !== normalizedUrl) {
        cache.put(normalizedUrl, response.clone());
      }
    }
    return response; 
  } catch (err) {
    if (request.mode === 'navigate') {
      return new Response(getOfflineHTML(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
    throw err;
  }
}

// --------------------------------------------------------------------------
// 4. 工具
// --------------------------------------------------------------------------

function getOfflineHTML() {
  return `<!DOCTYPE html><html lang="zh-CN"><body><div style="text-align:center;margin-top:50px;"><h1>📱 离线状态</h1><p>当前页面尚未缓存</p><button onclick="location.reload()">刷新重试</button></div></body></html>`;
}

self.addEventListener('message', event => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data.type === 'CLEAR_ALL_CACHES') {
    event.waitUntil(
      caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
    );
  }
});