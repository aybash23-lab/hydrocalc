/*
 * Service worker PWA «Гидравлический расчёт трубопровода».
 * Кэширует оболочку приложения: расчёт полностью работает офлайн.
 */
'use strict';

var CACHE = 'hydrocalc-v1.0.0';

var ASSETS = [
  './',
  './index.html',
  './app.css',
  './calc.js',
  './chart.js',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) { return cache.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Навигация: сначала сеть, при отсутствии связи — кэш
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(function () {
        return caches.match('./index.html');
      })
    );
    return;
  }

  // Статика: сначала кэш, фоновое обновление при удачной сети
  event.respondWith(
    caches.match(req).then(function (cached) {
      var fetched = fetch(req).then(function (resp) {
        if (resp && resp.ok && resp.type === 'basic') {
          var clone = resp.clone();
          caches.open(CACHE).then(function (cache) { cache.put(req, clone); });
        }
        return resp;
      }).catch(function () { return cached; });
      return cached || fetched;
    })
  );
});
