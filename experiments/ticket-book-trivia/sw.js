/* Service worker for Ticket Book Trivia.
   Precaches everything the page needs so a round can be played with no
   connection once it has been opened once. Cached files are served
   immediately and refreshed in the background, so an update shows up the next
   time the game is opened. */
var CACHE = 'ticket-book-trivia-v1';
var BASE = '/experiments/ticket-book-trivia/';
var ASSETS = [
  BASE,
  BASE + 'manifest.json',
  BASE + 'fonts/bungee-400.woff2',
  BASE + 'fonts/fredoka-var.woff2',
  BASE + 'fonts/courier-prime-400.woff2',
  BASE + 'fonts/courier-prime-700.woff2',
  BASE + 'icon-192.png',
  BASE + 'icon-512.png',
  BASE + 'apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // One asset failing must not throw away the whole install: without the
      // page there is no offline game at all, and the rest are fonts and icons
      // the page already has fallbacks for.
      return Promise.all(ASSETS.map(function (url) {
        return c.add(new Request(url, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('ticket-book-trivia-') === 0 && k !== CACHE; })
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

  e.respondWith(
    caches.open(CACHE).then(function (c) {
      return c.match(key).then(function (cached) {
        var network = fetch(req).then(function (res) {
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
