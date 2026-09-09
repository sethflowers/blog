/* Service worker for Henry's Nightfall.
   Precaches everything the game needs so it runs with no connection once it
   has been opened once. Cached files are served immediately and refreshed in
   the background, so an update shows up the next time the game is opened. */
var CACHE = 'henrys-nightfall-v2';
var BASE = '/experiments/nightfall-zombie-fps/';
var ASSETS = [
  BASE,
  BASE + 'three.min.js',
  BASE + 'manifest.json',
  BASE + 'icon-192.png',
  BASE + 'icon-512.png',
  BASE + 'apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('henrys-nightfall-') === 0 && k !== CACHE; })
                             .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.indexOf(BASE) !== 0) return;

  // The page itself, whatever the query string or navigation flavour.
  var key = (req.mode === 'navigate' || url.pathname === BASE) ? BASE : url.pathname;

  e.respondWith(
    caches.open(CACHE).then(function (c) {
      return c.match(key).then(function (cached) {
        var network = fetch(req).then(function (res) {
          if (res && res.ok) c.put(key, res.clone());
          return res;
        }).catch(function () { return cached; });
        return cached || network;
      });
    })
  );
});
