const CACHE_NAME = 'malargue-cache-v29';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './assets/logo.svg',
  './assets/logo.webp',
  './assets/logo.png',
  './assets/normas.webp',
  './assets/depto-main.webp',
  './assets/depto-living.webp',
  './assets/depto-hab1.webp',
  './assets/depto-hab2.webp',
  './assets/depto-cocina.webp',
  './assets/mapa_malargue.png',
  './assets/turismo-main.webp',
  './assets/guia-local.webp',
  './assets/reloj.webp',
  './assets/payunia.webp',
  './assets/payunia1.webp',
  './assets/castillos.webp',
  './assets/castillos2.webp',
  './assets/volcanmalacara.webp',
  './assets/volcanmalacara1.webp'
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
      .catch(async () => {
        const cached = await caches.match(e.request);
        if (cached) return cached;
        return new Response('Not found', { status: 404 });
      })
  );
});
