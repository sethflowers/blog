/* Service worker for Character Creator: it works offline (on an iPad from the home screen, in a
   headset with no Wi-Fi) once it has been opened online.

   - Registered as sw.js?v=<version> as soon as the page starts (not once it has finished loading:
     the body data takes a while to arrive, and closing the page before then used to leave nothing
     saved). A new version means a new worker, which saves that version's files in its own cache.
   - On install it saves the page, every script and every data file (the list of data files comes
     from data/files.json, written by _tools/character-creator/build_assets.py), all under exactly the
     addresses the page asks for (?v=<version>), then a marker the title screen checks.
   - Scripts, data, icons: from the saved copy first (instant, and a bad connection can't hang the
     start), the network only if missing. They can't be stale: the address includes the version.
   - The page: from the network first so an update arrives, falling back to the saved copy when
     offline or after 3 seconds. */
var V = new URL(self.location.href).searchParams.get('v') || '0';
var CACHE = 'character-creator-' + V;
var BASE = '/experiments/character-creator/';
var READY = BASE + '__offline-ready__';
var SCRIPTS = ['lib/three.core.min.js', 'lib/three.module.min.js',
  'js/character.js', 'js/looks.js', 'js/main.js', 'js/mh.js', 'js/spec.js', 'js/studio.js', 'js/ui.js', 'js/util.js', 'js/vr.js'];
var STATIC = ['manifest.json', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return fetch(BASE + 'data/files.json?v=' + V, { cache: 'reload' }).then(function (r) { return r.json(); }).then(function (data) {
        var assets = [BASE].concat(SCRIPTS.concat(data).concat(['data/files.json']).map(function (f) { return BASE + f + '?v=' + V; }), STATIC.map(function (f) { return BASE + f; }));
        // every file, past the browser's HTTP cache; the marker only goes in if all of them made it
        return Promise.all(assets.map(function (a) {
          return fetch(a, { cache: 'reload' }).then(function (res) { if (!res.ok) throw new Error(a); return c.put(a, res); });
        }));
      }).then(function () { return c.put(READY, new Response(V)); });
    }).catch(function () { /* partly saved: the fetch handler fills in the rest as the page loads */ })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('character-creator-') === 0 && k !== CACHE; })
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
      var net = fromNetwork(c, BASE, BASE);
      var slow = new Promise(function (resolve) { setTimeout(resolve, 3000); });
      return Promise.race([net.catch(function () {}), slow]).then(function (res) {
        if (res && res.ok) return res;
        return c.match(BASE).then(function (hit) { return hit || net; });
      });
    }
    var key = url.pathname + url.search;
    return c.match(key).then(function (hit) {
      return hit || fromNetwork(c, req, key).catch(function () { return c.match(url.pathname); });
    });
  }));
});
