/* Service worker for Henry's Nightfall 2.
   Precaches everything the game needs so it runs with no connection once it
   has been opened once. The page is fetched from the network first so an update shows up
   straight away; scripts and icons are served from the cache and refreshed
   in the background. */
// Not prefixed 'henrys-nightfall-': the first game's worker clears caches with that prefix.
var CACHE = 'nightfall-two-v4';
var BASE = '/experiments/henrys-nightfall-2/';
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
      return Promise.all(keys.filter(function (k) { return k.indexOf('nightfall-two-') === 0 && k !== CACHE; })
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

  // The page: network first (past the HTTP cache) so a new version shows up straight away;
  // the cached copy only offline, or when the network takes more than three seconds.
  if (key === BASE) {
    e.respondWith(
      caches.open(CACHE).then(function (c) {
        var network = fetch(BASE, { cache: 'no-store' }).then(function (res) {
          if (res && res.ok) c.put(BASE, res.clone());
          return res;
        });
        var slow = new Promise(function (resolve) { setTimeout(resolve, 3000); });
        return Promise.race([network.catch(function () {}), slow]).then(function (res) {
          if (res && res.ok) return res;
          return c.match(BASE).then(function (cached) { return cached || network; });
        });
      })
    );
    return;
  }

  e.respondWith(
    caches.open(CACHE).then(function (c) {
      return c.match(key).then(function (cached) {
        var network = fetch(new Request(req, { cache: 'no-cache' })).then(function (res) {
          if (res && res.ok) c.put(key, res.clone());
          return res;
        }).catch(function () { return cached; });
        return cached || network;
      });
    })
  );
});
