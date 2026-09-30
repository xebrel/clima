// Service Worker para DroneWeather Pro
const CACHE_NAME = 'droneweather-v2';
const STATIC_ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icone.png',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Estratégia Stale-While-Revalidate para assets estáticos e Network-First para APIs
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Se for chamada para as APIs de previsão, sempre busca da rede
  if (url.includes('api.open-meteo.com') || url.includes('services.swpc.noaa.gov') || url.includes('nominatim.openstreetmap.org')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match(event.request);
      })
    );
    return;
  }

  // Para arquivos do aplicativo (HTML, JS, ícones): responde com cache ou rede
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Busca atualização em segundo plano para a próxima vez
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
          }
        }).catch(() => {});
        return cachedResponse;
      }
      return fetch(event.request);
    })
  );
});
