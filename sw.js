// sw.js — Five Years Diary Service Worker
// v1.0 · 2026-04
//
// 策略：
// - install时缓存核心资源（HTML本体）
// - 静态资源（HTML/CSS/JS）：网络优先，失败则回退缓存
// - 字体（Google Fonts）：缓存优先，因为字体很少变
// - 其他：直接走网络
//
// 注意：这是PWA的基础离线壳。日记数据本身存在localStorage，
// localStorage本来就在本地，离线读写不受SW影响。

const CACHE_VERSION = 'diary-v102';
const CORE_CACHE = `${CACHE_VERSION}-core`;
const FONT_CACHE = `${CACHE_VERSION}-fonts`;

// 安装时要预缓存的核心资源
const CORE_ASSETS = [
  './',
  './index.html',
];

// install: 预缓存核心资源
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CORE_CACHE)
      .then(cache => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// activate: 清理旧版本缓存
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => !key.startsWith(CACHE_VERSION))
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// fetch: 路由不同请求到不同策略
self.addEventListener('fetch', event => {
  const { request } = event;

  // 只处理GET
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Google Fonts: 缓存优先（字体几乎不变，离线场景必须能用）
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request, FONT_CACHE));
    return;
  }

  // 同源请求：网络优先，失败回退缓存
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request, CORE_CACHE));
    return;
  }

  // 其他跨域请求：直接走网络，不缓存
});

// 缓存优先策略：先查缓存，没有再请求网络并写入缓存
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    // 只缓存成功响应（opaque响应也存，字体常见）
    if (response.ok || response.type === 'opaque') {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // 网络失败且无缓存——返回一个明确的失败响应
    return new Response('', { status: 504, statusText: 'Offline and not cached' });
  }
}

// 网络优先策略：先请求网络（更新缓存），失败回退缓存
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    // HTML请求降级到根页面
    if (request.headers.get('accept')?.includes('text/html')) {
      const fallback = await cache.match('./index.html');
      if (fallback) return fallback;
    }
    return new Response('Offline', { status: 504, statusText: 'Offline' });
  }
}
