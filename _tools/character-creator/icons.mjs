// Renders Character Creator's app icons from the designer itself: a face in three-quarter view in the
// studio light, and saves them into experiments/character-creator/.
//   NODE_PATH=$(npm root -g) node _tools/character-creator/icons.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = path.resolve(HERE, '../..');
const OUT = path.join(ROOT, 'experiments/character-creator');
function page(){
  const src = fs.readFileSync(path.join(ROOT, '_experiments/character-creator.html'), 'utf8');
  const fm = src.match(/^---\n([\s\S]*?)\n---\n/), version = (fm[1].match(/version:\s*"?([^"\n]+)"?/) || [])[1];
  return src.slice(fm[0].length).replace(/\{% endraw %\}\{\{ page\.version \}\}\{% raw %\}/g, version).replace(/\{% (end)?raw %\}/g, '');
}
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  try {
    if (url === '/experiments/character-creator/'){ res.writeHead(200, { 'content-type': 'text/html' }); return res.end(page()); }
    const f = path.join(ROOT, url), body = fs.readFileSync(f);
    res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.webp') ? 'image/webp' : 'application/octet-stream' }); res.end(body);
  } catch (e) { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const pg = await browser.newPage({ viewport: { width: 512, height: 512 } });
await pg.goto(`http://127.0.0.1:${server.address().port}/experiments/character-creator/`);
await pg.waitForFunction('window.__cc', null, { timeout: 180000 });
await pg.evaluate(async () => {
  const C = __cc; C.noThumbs = true; C.paused = true;
  document.getElementById('loading').style.display = 'none';
  document.getElementById('title').classList.add('hidden');
  C.replaceSpec(C.PRESETS()[1]); await C.settle();
  C.advance(0.2);
  C.studio.turntable.rotation.y = 0.45;
  C.studio.setFree(null);
  C.studio.frame('face', C.character, true);
  C.studio.want.dist = C.studio.view.dist = 0.62;
  C.studio.update(0.5); C.studio.camera.clearViewOffset(); C.studio.camera.aspect = 1; C.studio.camera.updateProjectionMatrix();
  C.studio.render();
});
const png = await pg.screenshot();
for (const [name, size] of [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180]]){
  const data = await pg.evaluate(async ([src, S]) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + src; await img.decode();
    const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
    g.drawImage(img, 0, 0, S, S);
    // a slider along the bottom: the designer's sign
    g.scale(S / 512, S / 512);
    g.fillStyle = 'rgba(14,15,19,0.72)'; g.fillRect(0, 430, 512, 82);
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.roundRect(60, 465, 392, 12, 6); g.fill();
    g.fillStyle = '#f0b45a'; g.beginPath(); g.roundRect(60, 465, 250, 12, 6); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(310, 471, 22, 0, Math.PI * 2); g.fill();
    return c.toDataURL('image/png').split(',')[1];
  }, [png.toString('base64'), size]);
  fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'));
  console.log('wrote', name);
}
await browser.close(); server.close();
