// Makes Sherlock's app icons from the game itself: a view down the dining car (the lamps, the Coke on its
// table) through a big brass magnifying glass, and saves them into experiments/sherlock/.
//   NODE_PATH=$(npm root -g) node _tools/sherlock/icons.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const OUT = path.join(ROOT, 'experiments/sherlock');
const { chromium } = createRequire(import.meta.url)('playwright');
function page(){
  const src = fs.readFileSync(path.join(ROOT, '_experiments/sherlock.html'), 'utf8'), fm = src.match(/^---\n([\s\S]*?)\n---\n/);
  const v = (fm[1].match(/version:\s*"?([^"\n]+)"?/) || [])[1];
  return src.slice(fm[0].length).replace(/\{% endraw %\}\{\{ page\.version \}\}\{% raw %\}/g, v).replace(/\{% (end)?raw %\}/g, '');
}
const srv = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  if (u === '/experiments/sherlock/'){ r.writeHead(200, { 'content-type': 'text/html' }); return r.end(page()); }
  try { const b = fs.readFileSync(path.join(ROOT, u)); r.writeHead(200, { 'content-type': u.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' }); r.end(b); } catch (e) { r.writeHead(404); r.end(); }
});
await new Promise((r) => srv.listen(0, r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await browser.newPage({ viewport: { width: 600, height: 600 } });
await pg.goto(`http://127.0.0.1:${srv.address().port}/experiments/sherlock/`);
await pg.waitForFunction(() => window.__sherlock);
await pg.evaluate(() => { document.getElementById('title').classList.add('hidden'); __sherlock.noRender = true; });
await pg.waitForTimeout(800);
// sitting at the Coke's table, looking at the bottle and down the car
await pg.evaluate(() => {
  const S = __sherlock, c = S.train.cokePos;
  S.standAt(c.x + 0.02, c.z - 0.5, 0); S.player.pitch = -0.36;
  S.player.pos.y = -0.48;
  S.camera.fov = 42; S.camera.updateProjectionMatrix();
  S.renderNow();
});
const shot = await pg.screenshot({ type: 'png' });
const data = await pg.evaluate(async (b64) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
  const out = {};
  for (const S of [512, 192, 180]){
    const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'); g.scale(S / 512, S / 512);
    g.fillStyle = '#1a1410'; g.fillRect(0, 0, 512, 512);
    // the game's view, seen through the lens
    g.save(); g.beginPath(); g.arc(230, 220, 165, 0, 7); g.clip(); g.drawImage(img, 30, 20, 400, 400); g.restore();
    const shine = g.createRadialGradient(180, 160, 10, 230, 220, 170); shine.addColorStop(0, 'rgba(255,255,255,0.28)'); shine.addColorStop(0.5, 'rgba(255,255,255,0.04)'); shine.addColorStop(1, 'rgba(0,0,0,0.25)');
    g.fillStyle = shine; g.beginPath(); g.arc(230, 220, 165, 0, 7); g.fill();
    // brass rim and wooden handle
    g.lineWidth = 34; g.strokeStyle = '#c8a050'; g.beginPath(); g.arc(230, 220, 182, 0, 7); g.stroke();
    g.lineWidth = 6; g.strokeStyle = '#f4dc9a'; g.beginPath(); g.arc(230, 220, 192, 3.6, 4.6); g.stroke();
    g.lineWidth = 4; g.strokeStyle = '#6a4a14'; g.beginPath(); g.arc(230, 220, 166, 0, 7); g.stroke();
    g.save(); g.translate(380, 370); g.rotate(-Math.PI / 4);
    g.fillStyle = '#c8a050'; g.fillRect(-26, 0, 52, 40);
    g.fillStyle = '#5a2e14'; g.beginPath(); g.roundRect(-24, 38, 48, 130, 20); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(-14, 48, 8, 110);
    g.restore();
    out[S] = c.toDataURL('image/png').split(',')[1];
  }
  return out;
}, shot.toString('base64'));
for (const [name, size] of [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180]]){ fs.writeFileSync(path.join(OUT, name), Buffer.from(data[size], 'base64')); console.log('wrote', name); }
await browser.close(); srv.close();
