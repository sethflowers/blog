// Renders Fantasy Theme Park's app icons from the game itself (the entrance gate at golden hour) and
// saves them into experiments/fantasy-theme-park/.
//   NODE_PATH=$(npm root -g) node _tools/fantasy-theme-park/icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { serve } from './serve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const OUT = path.resolve(HERE, '../../experiments/fantasy-theme-park');

const { server, base } = await serve();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const pg = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
await pg.goto(base('fantasy-theme-park'));
await pg.waitForFunction('window.__ftp && document.getElementById("loading").style.display === "none"', null, { timeout: 180000 });
await pg.addStyleTag({ content: '#title,#hud,#panel,.build-version{display:none !important}' });
// the gate, from outside, a little below the towers' tops, in the evening light
await pg.evaluate(() => {
  const A = window.__ftp; A.titleCam = () => {};
  const g = A.park.s.objects.find((o) => o.type === 'gate');
  A.park.s.time = 18.6 * 60;
  Object.assign(A.want, { x: g.x, z: g.z, yaw: 0.0, pitch: 0.16, dist: 46 }); Object.assign(A.orbit, A.want);
  A.camera.fov = 40; A.camera.updateProjectionMatrix();
  A.placeCamera(); A.camera.position.y += 2; A.camera.lookAt(g.x, 9.5, g.z);
  A.placeCamera = () => {};
});
await pg.waitForTimeout(2500);
const shot = await pg.screenshot({ clip: { x: 0, y: 0, width: 512, height: 512 } });
const data = await pg.evaluate(async (b64) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
  const out = {};
  for (const [name, S] of [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180]]){
    const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, S, S);
    out[name] = c.toDataURL('image/png').split(',')[1];
  }
  return out;
}, shot.toString('base64'));
for (const [name, b] of Object.entries(data)){ fs.writeFileSync(path.join(OUT, name), Buffer.from(b, 'base64')); console.log('wrote', name); }
await browser.close(); server.close();
