/* Service worker for VR Test.
   Caches everything the game needs so it runs offline once it has been opened.
   Everything is fetched from the network first (so an update arrives the next time you open it),
   falling back to the cached copy when offline or when the network takes more than three seconds. */
var CACHE = 'vr-test-v2';
var BASE = '/experiments/vr-test/';
var ASSETS = [
  BASE,
  BASE + 'manifest.json',
  BASE + 'icon-192.png',
  BASE + 'icon-512.png',
  BASE + 'apple-touch-icon.png',
  BASE + 'lib/three.core.min.js',
  BASE + 'lib/three.module.min.js',
  BASE + 'js/audio.js',
  BASE + 'js/avatar.js',
  BASE + 'js/build.js',
  BASE + 'js/creatures.js',
  BASE + 'js/dragon.js',
  BASE + 'js/items.js',
  BASE + 'js/main.js',
  BASE + 'js/util.js',
  BASE + 'js/vehicles.js',
  BASE + 'js/world.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // add one by one so a single failure doesn't lose the rest
      return Promise.all(ASSETS.map(function (a) { return c.add(a).catch(function () {}); }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('vr-test-') === 0 && k !== CACHE; })
                             .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.indexOf(BASE) !== 0) return;
  var key = (req.mode === 'navigate' || url.pathname === BASE || url.pathname === BASE + 'index.html') ? BASE : url.pathname;
  e.respondWith(
    caches.open(CACHE).then(function (c) {
      var network = fetch(key, { cache: 'no-store' }).then(function (res) {
        if (res && res.ok) c.put(key, res.clone());
        return res;
      });
      var slow = new Promise(function (resolve) { setTimeout(resolve, 3000); });
      return Promise.race([network.catch(function () {}), slow]).then(function (res) {
        if (res && res.ok) return res;
        return c.match(key).then(function (cached) { return cached || network; });
      });
    })
  );
});
