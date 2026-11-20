// Draws MSB's app icons (a sunset painting from the game's own art market in a gold frame, with the
// camera's red button and "MSB" under it) in headless Chromium and saves them into experiments/msb/.
//   NODE_PATH=$(npm root -g) node _tools/msb/icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = path.join(ROOT, 'experiments/msb');
// serve the game's files so the page can import its painter (art.js)
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<script type="importmap">{"imports":{"three":"/experiments/msb/lib/three.module.min.js"}}</script>'); }
  try { res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' }); res.end(fs.readFileSync(f)); } catch (e) { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch();
const pg = await browser.newPage();
await pg.goto(`http://127.0.0.1:${server.address().port}/`);
for (const [name, size] of [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180]]){
  const data = await pg.evaluate(async (S) => {
    const { paintMarket } = await import('/experiments/msb/js/art.js');
    const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
    g.scale(S / 512, S / 512);
    const bg = g.createRadialGradient(256, 200, 40, 256, 256, 380); bg.addColorStop(0, '#3a3050'); bg.addColorStop(1, '#16121e');
    g.fillStyle = bg; g.fillRect(0, 0, 512, 512);
    // the frame
    g.fillStyle = '#c9932a'; g.fillRect(76, 50, 360, 300);
    g.fillStyle = '#ffd86a'; g.fillRect(90, 64, 332, 272);
    g.fillStyle = '#a8701a'; g.fillRect(100, 74, 312, 252);
    g.drawImage(paintMarket('sunset', 424242, 640), 106, 80, 300, 240);
    // MSB
    g.fillStyle = '#ffcf4a'; g.font = '900 120px Georgia'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowOffsetY = 6; g.fillText('MSB', 256, 466); g.shadowColor = 'transparent';
    // the camera's red shutter dot
    g.fillStyle = '#ff6aa8'; g.beginPath(); g.arc(420, 70, 40, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(420, 70, 16, 0, 7); g.fill();
    return c.toDataURL('image/png').split(',')[1];
  }, size);
  fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'));
  console.log('wrote', name);
}
await browser.close(); server.close();
