/* Service worker for Sherlock: the game works offline (on an iPad from the home screen, in a headset
   with no Wi-Fi) once it has been opened online. Copied from My Animal Farm's.

   - It is registered as sw.js?v=<version> at the very top of the page (not after it has loaded: closing
     a slow first start early used to leave nothing saved). A new version means a new worker, which
     saves that version's files in its own cache.
   - On install it saves the page and every file of this version, under exactly the addresses the page
     asks for (scripts and models carry ?v=<version>), plus a marker the title screen checks.
   - Scripts, three.js, the people, icons: from the saved copy first (instant, and a bad connection
     can't hang the start), the network only if missing. They can't be stale: the address has the version.
   - The page: from the network first so an update arrives, falling back to the saved copy when
     offline or after 3 seconds. */
var V = new URL(self.location.href).searchParams.get('v') || '0';
var CACHE = 'sherlock-' + V;
var BASE = '/experiments/sherlock/';
var READY = BASE + '__offline-ready__';
var VERSIONED = ['lib/three.core.min.js', 'lib/three.module.min.js', 'lib/addons/GLTFLoader.js', 'lib/addons/SkeletonUtils.js', 'lib/addons/BufferGeometryUtils.js',
  'js/audio.js', 'js/case.js', 'js/cast.js', 'js/evidence.js', 'js/game.js', 'js/main.js', 'js/mystery.js', 'js/people.js', 'js/train.js', 'js/ui.js', 'js/util.js',
  'models/people/Female_Adult_01.glb','models/people/Female_Adult_03.glb','models/people/Female_Adult_04.glb','models/people/Female_Adult_05.glb','models/people/Female_Adult_06.glb','models/people/Female_Adult_08.glb','models/people/Female_Adult_10.glb','models/people/Female_Adult_11.glb','models/people/Female_Adult_12.glb','models/people/Male_Adult_01.glb','models/people/Male_Adult_02.glb','models/people/Male_Adult_03.glb','models/people/Male_Adult_04.glb','models/people/Male_Adult_05.glb','models/people/Male_Adult_06.glb','models/people/Male_Adult_08.glb','models/people/Male_Adult_10.glb','models/people/Male_Adult_12.glb'];
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
      return Promise.all(keys.filter(function (k) { return k.indexOf('sherlock-') === 0 && k !== CACHE; })
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
