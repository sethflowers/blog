// Renders Glue Gunner's alien on its own in headless Chromium, in a few poses and from a few angles,
// for checking its shape after changes:
//   NODE_PATH=$(npm root -g) node _tools/glue-gunner/viewer.mjs [outDir] [pose ...]
// poses: idle walk run scream attack struggle dead torn
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = path.resolve(HERE, '../..');
const OUT = path.resolve(process.argv[2] || 'alien-shots');
const POSES = process.argv.slice(3).length ? process.argv.slice(3) : ['idle', 'walk', 'run', 'scream', 'attack'];
fs.mkdirSync(OUT, { recursive: true });

const PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#222;overflow:hidden}</style>
<script type="importmap">{ "imports": { "three": "/experiments/glue-gunner/lib/three.module.min.js" } }</script></head>
<body><script type="module">
import * as THREE from 'three';
import { Alien } from '/experiments/glue-gunner/js/alien.js';
const r = new THREE.WebGLRenderer({ antialias: true }); r.setSize(innerWidth, innerHeight); r.setPixelRatio(1);
r.toneMapping = THREE.ACESFilmicToneMapping; r.outputColorSpace = THREE.SRGBColorSpace; r.shadowMap.enabled = true;
document.body.appendChild(r.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color('#3a3040');
const cam = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.05, 100);
scene.add(new THREE.HemisphereLight('#9ab0d0', '#3a2a20', 0.7));
const sun = new THREE.DirectionalLight('#ffc890', 3); sun.position.set(3, 3, 2.5); sun.castShadow = true; scene.add(sun);
const rim = new THREE.DirectionalLight('#8090ff', 2.5); rim.position.set(-3, 2, -4); scene.add(rim);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: '#4a4a50' })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const env = new THREE.Scene(); env.add(new THREE.Mesh(new THREE.SphereGeometry(10), new THREE.MeshBasicMaterial({ color: '#8a7a90', side: THREE.BackSide })));
scene.environment = new THREE.PMREMGenerator(r).fromScene(env, 0).texture;
const a = new Alien(scene, { scale: 1, seed: 3, variant: 0 });
a.place(0, 0, 0);
const world = { collideGround(){}, onDeck(){ return true; }, clampDeck(v){ return v; } };
window.view = (pose, yaw, d, h, ty, t) => {
  const ctx = { dt: 1 / 60, player: new THREE.Vector3(0, 0, 5), playerHead: new THREE.Vector3(0, 1.6, 5), aliens: [a], attackers: new Set(), wave: 1, world };
  a.place(0, 0, 0); a.state = 'x'; a.noticeT = 1e9; a.scream = 0; a.struggle = 0; a.dead = false; a.stateT = 0;
  for (let k = 0; k < 90; k++){
    a.speed = pose === 'run' ? 5.5 : pose === 'walk' ? 1.5 : 0;
    if (pose === 'scream') a.scream = 0.8;
    if (pose === 'attack'){ a.state = 'attack'; a.stateT = t; }
    if (pose === 'struggle') a.struggle = 1;
    a.pose(1 / 60, ctx);
  }
  a.root.rotation.set(0, yaw, 0); a.root.updateMatrixWorld(true);
  cam.position.set(0, h, d); cam.lookAt(0, ty, 0);
  r.render(scene, cam);
};
window.tear = (name) => { a.tear(name); };
window.ready = true;
</script></body></html>`;
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/viewer') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE); }
  try { const f = path.join(ROOT, url), body = fs.readFileSync(f); res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' }); res.end(body); }
  catch (e) { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const pg = await browser.newPage({ viewport: { width: 900, height: 900 } });
pg.on('pageerror', (e) => console.log('ERR', e.message, e.stack));
pg.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
await pg.goto(`http://127.0.0.1:${server.address().port}/viewer`);
await pg.waitForFunction('window.ready', null, { timeout: 60000 });
for (const pose of POSES){
  const views = pose === 'face' ? [[0.2, 1.1, 2.0, 1.95]] : [[0.6, 5, 1.3, 1.15], [Math.PI / 2, 5, 1.3, 1.15]];
  let k = 0;
  for (const [yaw, d, h, ty] of views){
    await pg.evaluate(([p, y, d, h, ty]) => window.view(p === 'face' ? 'idle' : p, y, d, h, ty, 0.5), [pose, yaw, d, h, ty]);
    await pg.screenshot({ path: path.join(OUT, `${pose}-${k++}.png`) });
  }
}
await browser.close(); server.close();
console.log('saved in', OUT);
