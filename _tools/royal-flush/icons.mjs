// Draws Royal Flush's app icons with the game's own castle drawing (map.js) on a royal purple sky,
// with a restroom badge, and saves them into experiments/royal-flush/.
//   NODE_PATH=$(npm root -g) node _tools/royal-flush/icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { serve, ROOT } from './serve.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = path.join(ROOT, 'experiments/royal-flush');
const { server, origin } = await serve();
const browser = await chromium.launch();
const pg = await browser.newPage();
await pg.goto(origin + '/experiments/royal-flush/');
await pg.waitForFunction(() => window.__flush);
for (const [name, size] of [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180]]){
  const data = await pg.evaluate(async (S) => {
    const { MapView } = await import('/experiments/royal-flush/js/map.js');
    const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
    g.scale(S / 512, S / 512);
    const sky = g.createRadialGradient(256, 200, 20, 256, 256, 380); sky.addColorStop(0, '#8a5ae0'); sky.addColorStop(0.6, '#4a2690'); sky.addColorStop(1, '#22103f');
    g.fillStyle = sky; g.fillRect(0, 0, 512, 512);
    // sparkles
    g.fillStyle = '#ffe9a0';
    for (const [x, y, r] of [[80, 90, 5], [430, 70, 4], [400, 170, 3], [110, 200, 3], [60, 300, 4], [460, 290, 5], [250, 40, 3]]){
      g.beginPath(); g.moveTo(x, y - r * 3); g.lineTo(x + r, y - r); g.lineTo(x + r * 3, y); g.lineTo(x + r, y + r); g.lineTo(x, y + r * 3); g.lineTo(x - r, y + r); g.lineTo(x - r * 3, y); g.lineTo(x - r, y - r); g.fill();
    }
    // a lawn and the moat
    g.fillStyle = '#5fb2e0'; g.beginPath(); g.ellipse(256, 440, 250, 60, 0, 0, 7); g.fill();
    g.fillStyle = '#9ccb7e'; g.beginPath(); g.ellipse(256, 430, 190, 42, 0, 0, 7); g.fill();
    // the castle, as the map draws it
    const v = Object.create(MapView.prototype);
    Object.assign(v, { g, base: 1, zoom: 5.4, cx: 0, cy: 8, W: 512, H: 512, pad: { top: 0, bottom: 0 } });
    v.cy = 8 + (430 - 14 * 5.4 - 256) / 5.4;   // castle base at y = 430
    v.drawCastle([0, 8]);
    // the restroom badge
    g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.arc(404, 404, 78, 0, 7); g.fill();
    g.fillStyle = '#ffd75a'; g.beginPath(); g.arc(398, 396, 76, 0, 7); g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = 8; g.stroke();
    g.font = '92px "Noto Color Emoji","Apple Color Emoji",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('🚻', 398, 402);
    return c.toDataURL('image/png').split(',')[1];
  }, size);
  fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'));
  console.log('wrote', name);
}
await browser.close(); server.close();
