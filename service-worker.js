// service-worker.js

// 記得改版本號，更新程式時只要改這個就會強制使用新版快取
const CACHE_VERSION = 'v1.0.0';
const CACHE_NAME = `korea-travel-${CACHE_VERSION}`;

// 需要預先快取的靜態資源
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'  // 如果暫時沒有 512 圖示，可以先拿掉這行
];

// 安裝階段：預先快取主要檔案
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL);
    })
  );

  // 讓新的 SW 立刻接手（不用等重新整理好幾次）
  self.skipWaiting();
});

// 啟用階段：清掉舊版快取
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key.startsWith('korea-travel-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    })
  );

  // 讓目前開啟中的頁面立刻受新的 SW 控制
  self.clients.claim();
});

// 讀取資源：先走快取，沒有再抓網路（Cache First）
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // 只處理 GET 請求，POST/PUT 之類的放過
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // 只快取同網域的資源（GitHub Pages / 本機）
  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        // 有快取就直接用
        return cachedResponse;
      }

      // 沒有快取就去抓，再塞進快取裡
      return fetch(request)
        .then((networkResponse) => {
          // 失敗或非正常回應就不要放快取
          if (!networkResponse || networkResponse.status !== 200) {
            return networkResponse;
          }

          const clonedResponse = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, clonedResponse);
          });

          return networkResponse;
        })
        .catch(() => {
          // 真的完全離線，而且沒有快取的情況，目前就不做特別 fallback
          // 你之後如果想加「離線提示頁」可以在這裡處理
          return new Response('目前離線中，且沒有可用快取。', {
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        });
    })
  );
});
