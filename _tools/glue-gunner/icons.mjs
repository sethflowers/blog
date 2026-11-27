// Renders Glue Gunner's app icons from the game itself: an alien's screaming head up close against
// the dusk sky, a glue string stuck to it, and saves them into experiments/glue-gunner/.
//   NODE_PATH=$(npm root -g) node _tools/glue-gunner/icons.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = path.resolve(HERE, '../..');
const OUT = path.join(ROOT, 'experiments/glue-gunner');
function page(){
  const src = fs.readFileSync(path.join(ROOT, '_experiments/glue-gunner.html'), 'utf8');
  const fm = src.match(/^---\n([\s\S]*?)\n---\n/), version = (fm[1].match(/version:\s*"?([^"\n]+)"?/) || [])[1];
  return src.slice(fm[0].length).replace(/\{% endraw %\}\{\{ page\.version \}\}\{% raw %\}/g, version).replace(/\{% (end)?raw %\}/g, '');
}
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  try {
    if (url === '/experiments/glue-gunner/'){ res.writeHead(200, { 'content-type': 'text/html' }); return res.end(page()); }
    const f = path.join(ROOT, url), body = fs.readFileSync(f); res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' }); res.end(body);
  } catch (e) { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const pg = await browser.newPage({ viewport: { width: 512, height: 512 } });
await pg.goto(`http://127.0.0.1:${server.address().port}/experiments/glue-gunner/`);
await pg.waitForFunction('window.__gg', null, { timeout: 120000 });
await pg.evaluate(() => {
  const G = __gg; G.noRender = true;
  document.getElementById('loading').style.display = 'none';
  G.startScreen(false); G.closePanels(); G.paused = true;
  document.getElementById('title').classList.add('hidden');
  document.getElementById('hud').style.display = 'none';
  for (const b of G.aliens){ b.hold = true; b.noticeT = 1e9; b.place(40 + b.id % 10 * 3, 20, 0); }
  // the alien: 1.1 m in front of you, screaming
  G.standAt({ x: 0, z: 1.1, yaw: 0 });
  const a = G.aliens[0];
  a.place(0, 0, 0.3); a.state = 'notice'; a.stateT = 0; a.scream = 0.7;
  G.advance(0.3);
  G.standAt({ x: 0.6, z: 1.45, yaw: 0 });
  const p = new G.player.pos.constructor(); a.boneWorld('head', p);
  G.aimAt({ x: p.x + 0.02, y: p.y - 0.2, z: p.z });
  G.camera.fov = 42; G.camera.aspect = 1; G.camera.updateProjectionMatrix();
});
await pg.evaluate(() => { const G = __gg; G.gunScreen.visible = false; G.renderer.render(G.scene, G.camera); });
const png = await pg.screenshot();
for (const [name, size] of [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180]]){
  const data = await pg.evaluate(async ([src, S]) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + src; await img.decode();
    const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
    g.drawImage(img, 0, 0, S, S);
    // a glue drip across the bottom
    g.scale(S / 512, S / 512);
    g.fillStyle = '#ffd23a'; g.shadowColor = 'rgba(255,190,40,0.8)'; g.shadowBlur = 16;
    g.beginPath(); g.moveTo(0, 470); for (let x = 0; x <= 512; x += 32) g.quadraticCurveTo(x + 16, 470 + (x % 64 ? 30 : 6), x + 32, 470); g.lineTo(512, 512); g.lineTo(0, 512); g.fill();
    for (const [x, r, l] of [[90, 9, 40], [250, 12, 34], [400, 8, 26]]){ g.beginPath(); g.arc(x, 490 + l, r, 0, 7); g.fill(); g.fillRect(x - r * 0.6, 480, r * 1.2, l + 6); }
    return c.toDataURL('image/png').split(',')[1];
  }, [png.toString('base64'), size]);
  fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'));
  console.log('wrote', name);
}
await browser.close(); server.close();
