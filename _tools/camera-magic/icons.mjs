// Renders Camera Magic's icons from the game itself: Pip in a camera viewfinder.
//   NODE_PATH=$(npm root -g) node _tools/camera-magic/icons.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'experiments/camera-magic');

const PAGE = `<!doctype html><html><body style="margin:0;background:#000">
<script type="importmap">{"imports":{"three":"/experiments/camera-magic/lib/three.module.min.js"}}</script>
<canvas id="bg" width="512" height="512" style="position:absolute;left:0;top:0"></canvas>
<canvas id="three" width="512" height="512" style="position:absolute;left:0;top:0;width:512px;height:512px"></canvas>
<canvas id="fg" width="512" height="512" style="position:absolute;left:0;top:0"></canvas>
<script type="module">
import * as THREE from 'three';
import { getRenderer, addLights, makePip, animatePip } from '/experiments/camera-magic/js/three-layer.js';
const W = 512;
const bg = document.getElementById('bg').getContext('2d');
const g = bg.createRadialGradient(W * 0.35, W * 0.3, 20, W / 2, W / 2, W * 0.75);
g.addColorStop(0, '#7a3ad8'); g.addColorStop(0.55, '#3a1a80'); g.addColorStop(1, '#140a30');
bg.fillStyle = g; bg.fillRect(0, 0, W, W);
// sparkles
bg.fillStyle = 'rgba(255,255,255,.85)';
for (const [x, y, r] of [[90, 110, 5], [420, 90, 7], [440, 300, 4], [70, 330, 4], [380, 160, 3], [130, 200, 3]]){ bg.beginPath(); bg.arc(x, y, r, 0, 6.283); bg.fill(); }
const renderer = getRenderer();
renderer.setPixelRatio(1); renderer.setSize(W, W, false);
const scene = new THREE.Scene(); addLights(scene);
const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 50); cam.position.set(0, 0.75, 3.3); cam.lookAt(0, 0.62, 0);
const pip = makePip(); pip.rotation.y = -0.25; scene.add(pip);
pip.userData.blink = 5; animatePip(pip, 0.01, { look: { x: 0.3, y: 0.1 } });
renderer.render(scene, cam);
// viewfinder corners
const fg = document.getElementById('fg').getContext('2d');
fg.strokeStyle = '#7af0e0'; fg.lineWidth = 26; fg.lineCap = 'round';
const m = 70, L = 90;
for (const [x, y, dx, dy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, W - m, 1, -1], [W - m, W - m, -1, -1]]){
  fg.beginPath(); fg.moveTo(x, y + dy * L); fg.lineTo(x, y); fg.lineTo(x + dx * L, y); fg.stroke();
}
fg.fillStyle = '#ff4a6a'; fg.beginPath(); fg.arc(W - m - 14, m + 50, 14, 0, 6.283); fg.fill();
window.done = true;
</script></body></html>`;

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/__icon.html'){ res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE); }
  try { const b = fs.readFileSync(path.join(ROOT, url)); res.writeHead(200, { 'content-type': url.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' }); res.end(b); }
  catch (e) { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await browser.newPage({ viewport: { width: 512, height: 512 } });
pg.on('pageerror', (e) => console.log('error', e.message));
await pg.goto(`http://127.0.0.1:${server.address().port}/__icon.html`);
await pg.waitForFunction(() => window.done, null, { timeout: 30000 });
await pg.screenshot({ path: path.join(DIR, 'icon-512.png') });
for (const [name, size] of [['icon-192.png', 192], ['apple-touch-icon.png', 180]]){
  const p2 = await browser.newPage({ viewport: { width: size, height: size } });
  const data = fs.readFileSync(path.join(DIR, 'icon-512.png')).toString('base64');
  await p2.setContent(`<body style="margin:0"><img src="data:image/png;base64,${data}" style="width:${size}px;height:${size}px;display:block"></body>`);
  await p2.screenshot({ path: path.join(DIR, name) });
}
await browser.close(); server.close();
console.log('icons written');
