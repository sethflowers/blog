/* Service worker for Wildcat: the game works offline (on an iPad from the home screen, with no
   Wi-Fi) once it has been opened online. Same scheme as My Animal Farm's.

   - It is registered as sw.js?v=<version> as soon as the page starts (not after it has finished
     loading: a big 3D game takes a while to load on an iPad, and closing it before then used to leave
     nothing saved, so the next offline start showed Safari's "not connected to the internet" page).
     A new version means a new worker, which saves that version's files in its own cache.
   - On install it saves the page and every file of this version, under exactly the addresses the page
     asks for (scripts carry ?v=<version>), plus a marker the title screen checks to say it's ready.
   - Scripts, three.js, icons: from the saved copy first (instant, and a bad connection can't hang the
     start), the network only if missing. They can't be stale: the address includes the version.
   - The page: from the network first so an update arrives, falling back to the saved copy when
     offline or after 3 seconds. */
var V = new URL(self.location.href).searchParams.get('v') || '0';
var CACHE = 'wildcat-' + V;
var BASE = '/experiments/wildcat/';
var READY = BASE + '__offline-ready__';
var VERSIONED = ['lib/three.core.min.js', 'lib/three.module.min.js', 'lib/utils/BufferGeometryUtils.js',
  'js/audio.js', 'js/creature.js', 'js/game.js', 'js/noise.js', 'js/species.js', 'js/textures.js', 'js/world.js'];
var STATIC = ['manifest.json', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
var ASSETS = [BASE].concat(VERSIONED.map(function (f) { return BASE + f + '?v=' + V; }), STATIC.map(function (f) { return BASE + f; }));

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // every file, past the browser's HTTP cache; the marker only goes in if all of them made it
      return Promise.all(ASSETS.map(function (a) {
        return fetch(a, { cache: 'reload' }).then(function (res) { if (!res.ok) throw new Error(a); return c.put(a, res); });
      })).then(function () { return c.put(READY, new Response(V)); });
    }).catch(function () { /* partly saved: the fetch handler fills in the rest as the page loads */ })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('wildcat-') === 0 && k !== CACHE; })
                             .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function fromNetwork(c, req, key){
  return fetch(req, { cache: 'no-store' }).then(function (res) {
    if (res && res.ok) c.put(key, res.clone());
    return res;
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.indexOf(BASE) !== 0) return;
  var page = req.mode === 'navigate' || url.pathname === BASE || url.pathname === BASE + 'index.html';
  e.respondWith(caches.open(CACHE).then(function (c) {
    if (page){
      // network first (3 seconds at most), then the saved page
      var net = fromNetwork(c, BASE, BASE);
      var slow = new Promise(function (resolve) { setTimeout(resolve, 3000); });
      return Promise.race([net.catch(function () {}), slow]).then(function (res) {
        if (res && res.ok) return res;
        return c.match(BASE).then(function (hit) { return hit || net; });
      });
    }
    // everything else: the saved copy of exactly this address first, then the network
    var key = url.pathname + url.search;
    return c.match(key).then(function (hit) {
      return hit || fromNetwork(c, req, key).catch(function () { return c.match(url.pathname); });
    });
  }));
});
