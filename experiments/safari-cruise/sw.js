/* Service worker for Safari Cruise.
   Caches everything the game needs so it runs offline once it has been opened.
   Everything comes from the network first (so an update arrives the next time you open it); the
   cached copy is only used when the network fails (or, for the page itself, takes over 4 seconds).
   Scripts are requested with ?v=<version> by the page, and are cached by that full address, so an old
   copy can never stand in for a new version. */
var CACHE = 'safari-cruise-v1';
var BASE = '/experiments/safari-cruise/';
var ASSETS = [
  BASE,
  BASE + 'manifest.json',
  BASE + 'icon-192.png',
  BASE + 'icon-512.png',
  BASE + 'apple-touch-icon.png',
  BASE + 'lib/three.core.min.js',
  BASE + 'lib/three.module.min.js',
  BASE + 'js/animals.js',
  BASE + 'js/audio.js',
  BASE + 'js/main.js',
  BASE + 'js/people.js',
  BASE + 'js/sim.js',
  BASE + 'js/textures.js',
  BASE + 'js/ui.js',
  BASE + 'js/util.js',
  BASE + 'js/vehicles.js',
  BASE + 'js/world.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // add one by one so a single failure doesn't lose the rest; skip the browser's own HTTP cache
      return Promise.all(ASSETS.map(function (a) {
        return fetch(a, { cache: 'reload' }).then(function (res) { if (res.ok) return c.put(a, res); }).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('safari-cruise-') === 0 && k !== CACHE; })
                             .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.indexOf(BASE) !== 0) return;
  var page = req.mode === 'navigate' || url.pathname === BASE || url.pathname === BASE + 'index.html';
  // the page by its path; everything else by its full address (including ?v=)
  var key = page ? BASE : url.pathname + url.search;
  e.respondWith(
    caches.open(CACHE).then(function (c) {
      var network = fetch(page ? BASE : req.url, { cache: 'no-store' }).then(function (res) {
        if (res && res.ok) c.put(key, res.clone());
        return res;
      });
      var fallback = function () {
        return c.match(key).then(function (hit) { return hit || c.match(url.pathname); }).then(function (hit) { return hit || network; });
      };
      if (!page) return network.catch(fallback);
      var slow = new Promise(function (resolve) { setTimeout(resolve, 4000); });
      return Promise.race([network.catch(function () {}), slow]).then(function (res) {
        return (res && res.ok) ? res : fallback();
      });
    })
  );
});
