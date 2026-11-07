// Draws Rollercoaster Bros' app icons (a loop-the-loop against the sky) with a canvas in headless
// Chromium and saves them into experiments/rollercoaster-bros/.
//   NODE_PATH=$(npm root -g) node _tools/rollercoaster-bros/icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const OUT = path.resolve(HERE, '../../experiments/rollercoaster-bros');

const browser = await chromium.launch();
const pg = await browser.newPage();
for (const [name, size] of [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180]]){
  const data = await pg.evaluate((S) => {
    const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
    const k = S / 512;
    g.scale(k, k);
    const sky = g.createLinearGradient(0, 0, 0, 512); sky.addColorStop(0, '#2a6ad8'); sky.addColorStop(1, '#9ad0f8');
    g.fillStyle = sky; g.fillRect(0, 0, 512, 512);
    g.fillStyle = '#4a9a3a'; g.fillRect(0, 400, 512, 112);
    // the track: in from the left, round a loop, out to the right
    const pts = [];
    for (let t = 0; t <= 1.0001; t += 0.005){
      const a = 2 * Math.PI * t;
      pts.push([60 + 390 * t + 120 * Math.sin(a), 380 - 120 * (1 - Math.cos(a))]);
    }
    // supports
    g.strokeStyle = '#e8e8ec'; g.lineWidth = 12;
    for (const x of [90, 420]){ g.beginPath(); g.moveTo(x, 390); g.lineTo(x, 420); g.stroke(); }
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const [w, col] of [[44, '#7a1410'], [30, '#e8302a'], [8, '#ffd84a']]){
      g.strokeStyle = col; g.lineWidth = w; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
    }
    // the train at the top of the loop (upside down)
    g.save(); g.translate(255, 140); g.rotate(Math.PI);
    g.fillStyle = '#ffd84a'; g.beginPath(); g.roundRect(-70, -44, 140, 40, 12); g.fill();
    g.fillStyle = '#1e4aa8'; g.fillRect(-60, -30, 120, 10);
    g.restore();
    return c.toDataURL('image/png').split(',')[1];
  }, size);
  fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'));
  console.log('wrote', name);
}
await browser.close();
