// Draws Alien Hunter's app icons (an alien glowing inside a person's outline on the X-ray tablet's
// screen) with a canvas in headless Chromium and saves them into experiments/alien-hunter/.
//   NODE_PATH=$(npm root -g) node _tools/alien-hunter/icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = path.resolve(HERE, '../../experiments/alien-hunter');

const browser = await chromium.launch();
const pg = await browser.newPage();
for (const [name, size] of [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180]]){
  const data = await pg.evaluate((S) => {
    const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
    g.scale(S / 512, S / 512);
    const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
    const bg = g.createRadialGradient(256, 220, 40, 256, 256, 360); bg.addColorStop(0, '#5a2a9a'); bg.addColorStop(1, '#1a0a3a');
    g.fillStyle = bg; g.fillRect(0, 0, 512, 512);
    // the tablet
    g.fillStyle = '#3a2a5a'; rr(56, 70, 400, 372, 44); g.fill();
    g.lineWidth = 12; g.strokeStyle = '#8dff5a'; rr(56, 70, 400, 372, 44); g.stroke();
    g.fillStyle = '#06102a'; rr(84, 98, 344, 316, 16); g.fill();
    g.save(); rr(84, 98, 344, 316, 16); g.clip();
    // the disguise: a person's outline, glowing blue
    g.strokeStyle = '#4ac8ff'; g.lineWidth = 7; g.shadowColor = '#4ac8ff'; g.shadowBlur = 18;
    g.beginPath(); g.arc(256, 200, 70, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.ellipse(256, 380, 110, 110, 0, Math.PI, 0); g.stroke();
    g.shadowBlur = 0;
    // the alien inside
    g.fillStyle = '#5dff3a'; g.shadowColor = '#5dff3a'; g.shadowBlur = 22;
    g.beginPath(); g.ellipse(256, 205, 50, 60, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(256, 380, 62, 70, 0, Math.PI, 0); g.fill();
    g.shadowBlur = 0;
    g.lineWidth = 6; g.strokeStyle = '#5dff3a';
    g.beginPath(); g.moveTo(236, 152); g.lineTo(214, 112); g.moveTo(276, 152); g.lineTo(298, 112); g.stroke();
    g.fillStyle = '#ff5ad8'; g.beginPath(); g.arc(212, 108, 11, 0, 7); g.arc(300, 108, 11, 0, 7); g.fill();
    g.fillStyle = '#050508';
    for (const s of [-1, 1]){ g.save(); g.translate(256 + s * 23, 205); g.rotate(s * 0.45); g.beginPath(); g.ellipse(0, 0, 15, 24, 0, 0, 7); g.fill(); g.restore(); }
    g.fillStyle = '#fff'; g.beginPath(); g.arc(230, 196, 5, 0, 7); g.arc(282 + 4, 196, 5, 0, 7); g.fill();
    g.restore();
    // the camera lens dot
    g.fillStyle = '#8dff5a'; g.beginPath(); g.arc(256, 84, 6, 0, 7); g.fill();
    return c.toDataURL('image/png').split(',')[1];
  }, size);
  fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'));
  console.log('wrote', name);
}
await browser.close();
