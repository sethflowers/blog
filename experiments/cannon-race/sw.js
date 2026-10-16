/* Service worker for Cannon Race.
   Precaches everything the game needs so it runs with no connection once it
   has been opened once. The page itself is fetched from the network first
   (bypassing the browser's HTTP cache), so a new version shows up the moment
   it is published; the cached copy is only used offline, or if the network
   takes more than three seconds. Scripts and icons are served from the cache
   and refreshed in the background. */
var CACHE = 'cannon-race-v2';
var PAGE_TIMEOUT = 3000;
var BASE = '/experiments/cannon-race/';
var ASSETS = [
  BASE,
  BASE + 'three.min.js',
  BASE + 'cannon.min.js',
  BASE + 'manifest.json',
  BASE + 'icon-192.png',
  BASE + 'icon-512.png',
  BASE + 'apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // One asset failing must not throw away the whole install: without the
      // page and its two scripts there is no offline game at all, and the rest are
      // only icons.
      return Promise.all(ASSETS.map(function (url) {
        return c.add(new Request(url, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('cannon-race-') === 0 && k !== CACHE; })
                             .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  var navigating = (req.mode === 'navigate');
  if (!navigating && url.pathname.indexOf(BASE) !== 0) return;

  // Any navigation into the game — with a query string, from the home screen,
  // or from a link — is answered with the one cached page.
  var key = (navigating || url.pathname === BASE || url.pathname === BASE + 'index.html')
    ? BASE : url.pathname;

  if (key === BASE) {
    e.respondWith(
      caches.open(CACHE).then(function (c) {
        var network = fetch(BASE, { cache: 'no-store' }).then(function (res) {
          if (res && res.ok) c.put(BASE, res.clone());
          return res;
        });
        var slow = new Promise(function (resolve) { setTimeout(resolve, PAGE_TIMEOUT); });
        // Whichever comes first; a slow network still finishes and updates the cache for next time.
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
        }).catch(function () {
          return cached || (navigating ? c.match(BASE) : undefined);
        });
        return cached || network;
      });
    })
  );
});
