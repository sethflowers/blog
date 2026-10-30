/* Service worker for Dungeon Strikedown (it lives in undercroft/, its old name, so installs keep working).
   Precaches everything the game needs, so once it has been opened online it opens and plays with no
   connection at all, from the home screen too. Cached files are served first and refreshed in the
   background, so an update shows up the next time the game is opened.

   A new version only takes over once every file is in its cache: if the network drops halfway through,
   it copies what it can from the old cache, and if anything is still missing it gives up and the old
   version (with its complete cache) carries on. */
var CACHE = 'undercroft-v4';
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

// Safari won't use a redirected response for a page, so keep a clean copy of anything that was redirected.
function clean(res){
  if (!res.redirected) return Promise.resolve(res);
  return res.blob().then(function (body){ return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers }); });
}

self.addEventListener('install', function (e){
  e.waitUntil(
    caches.open(CACHE).then(function (c){
      return Promise.all(ASSETS.map(function (url){
        return fetch(new Request(url, { cache: 'reload' }))
          .then(function (res){ if (!res.ok) throw new Error(url + ' ' + res.status); return clean(res); })
          .catch(function (){ return caches.match(url).then(function (old){ if (!old) throw new Error('missing ' + url); return old; }); })
          .then(function (res){ return c.put(url, res); });
      }));
    }).then(function (){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e){
  e.waitUntil(
    caches.keys().then(function (keys){
      return Promise.all(keys.filter(function (k){ return k.indexOf('undercroft-') === 0 && k !== CACHE; })
                             .map(function (k){ return caches.delete(k); }));
    }).then(function (){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e){
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  var navigating = req.mode === 'navigate';
  if (!navigating && url.pathname.indexOf(BASE) !== 0) return;

  // Any way into the game (from the home screen, a link, with a query string) gets the one cached page.
  var key = (navigating || url.pathname === BASE || url.pathname === BASE + 'index.html') ? BASE : url.pathname;

  e.respondWith(
    caches.open(CACHE).then(function (c){
      return c.match(key).then(function (hit){ return hit || caches.match(key); }).then(function (cached){
        var network = fetch(req).then(function (res){
          if (res && res.ok) return clean(res).then(function (r){ c.put(key, r.clone()); return r; });
          return cached || res;
        }).catch(function (){ return cached || Response.error(); });
        if (cached){ e.waitUntil(network.catch(function (){})); return cached; }
        return network;
      });
    })
  );
});
