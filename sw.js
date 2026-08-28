const CACHE_NAME = 'malargue-cache-v15';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './assets/logo.svg',
  './assets/logo.jpg',
  './assets/logo.png',
  './assets/normas.jpg',
  './assets/depto-main.jpg',
  './assets/depto-living.jpg',
  './assets/depto-hab1.jpg',
  './assets/depto-hab2.jpg',
  './assets/depto-cocina.jpg',
  './assets/mapa_malargue.png',
  './assets/turismo-main.jpg',
  './assets/guia-local.jpg'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS).catch(err => {
        console.warn('Algunos archivos no se pudieron precachear (pueden no existir aún):', err);
      });
    })
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    self.clients.claim().then(() => {
      return caches.keys().then((keys) => {
        return Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) {
              return caches.delete(key);
            }
          })
        );
      });
    })
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.url.includes('supabase.co')) {
    e.respondWith(fetch(e.request));
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(e.request);
      })
  );
});
