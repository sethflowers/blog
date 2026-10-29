/* Service worker for The Undercroft.
   Precaches everything the game needs so it runs with no connection once it
   has been opened once. Cached files are served immediately and refreshed in
   the background, so an update shows up the next time the game is opened. */
var CACHE = 'undercroft-v3';
var BASE = '/experiments/undercroft/';
var ASSETS = [
  BASE,
  BASE + 'apple-touch-icon.png',
  BASE + 'icon-192.png',
  BASE + 'icon-512.png',
  BASE + 'manifest.json',
  BASE + 'js/audio.js',
  BASE + 'js/env.js',
  BASE + 'js/game.js',
  BASE + 'js/level.js',
  BASE + 'js/shrines.js',
  BASE + 'js/world.js',
  BASE + 'lib/three.core.min.js',
  BASE + 'lib/three.module.min.js',
  BASE + 'tex/beast_membrane.jpg',
  BASE + 'tex/beast_skin.jpg',
  BASE + 'tex/ceil_albedo.jpg',
  BASE + 'tex/ceil_normal.jpg',
  BASE + 'tex/ceil_rough.jpg',
  BASE + 'tex/cobweb.png',
  BASE + 'tex/floor_albedo.jpg',
  BASE + 'tex/floor_normal.jpg',
  BASE + 'tex/floor_rough.jpg',
  BASE + 'tex/people.bin',
  BASE + 'tex/people_detail.jpg',
  BASE + 'tex/people_hair.png',
  BASE + 'tex/people_head_col.jpg',
  BASE + 'tex/people_head_dat.jpg',
  BASE + 'tex/people_head_nrm.jpg',
  BASE + 'tex/people_head_zom.jpg',
  BASE + 'tex/props_coals_albedo.jpg',
  BASE + 'tex/props_coals_emit.jpg',
  BASE + 'tex/props_food_albedo.jpg',
  BASE + 'tex/props_food_normal.jpg',
  BASE + 'tex/props_food_rough.jpg',
  BASE + 'tex/props_iron_albedo.jpg',
  BASE + 'tex/props_iron_normal.jpg',
  BASE + 'tex/props_iron_rm.jpg',
  BASE + 'tex/props_misc_albedo.jpg',
  BASE + 'tex/props_misc_normal.jpg',
  BASE + 'tex/props_misc_rough.jpg',
  BASE + 'tex/props_steel_normal.jpg',
  BASE + 'tex/props_steel_rough.jpg',
  BASE + 'tex/props_wood_albedo.jpg',
  BASE + 'tex/props_wood_normal.jpg',
  BASE + 'tex/props_wood_rough.jpg',
  BASE + 'tex/wall_albedo.jpg',
  BASE + 'tex/wall_normal.jpg',
  BASE + 'tex/wall_rough.jpg',
  BASE + 'tex/water_normal.jpg',
  BASE + 'tex/wood_albedo.jpg',
  BASE + 'js/models/beast.js',
  BASE + 'js/models/people.js',
  BASE + 'js/models/props.js',
  BASE + 'js/models/stubs.js',
  BASE + 'lib/loaders/GLTFLoader.js',
  BASE + 'lib/postprocessing/EffectComposer.js',
  BASE + 'lib/postprocessing/MaskPass.js',
  BASE + 'lib/postprocessing/OutputPass.js',
  BASE + 'lib/postprocessing/Pass.js',
  BASE + 'lib/postprocessing/RenderPass.js',
  BASE + 'lib/postprocessing/ShaderPass.js',
  BASE + 'lib/postprocessing/UnrealBloomPass.js',
  BASE + 'lib/shaders/CopyShader.js',
  BASE + 'lib/shaders/LuminosityHighPassShader.js',
  BASE + 'lib/shaders/OutputShader.js',
  BASE + 'lib/utils/BufferGeometryUtils.js',
  BASE + 'lib/utils/SkeletonUtils.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // One asset failing must not throw away the whole install: the page and
      // its scripts and textures are what matter.
      return Promise.all(ASSETS.map(function (url) {
        return c.add(new Request(url, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('undercroft-') === 0 && k !== CACHE; })
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
