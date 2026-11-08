// Draws Safari Cruise's app icons (a giraffe and an acacia against a sunset) with a canvas in headless
// Chromium and saves them into experiments/safari-cruise/.
//   NODE_PATH=$(npm root -g) node _tools/safari-cruise/icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const OUT = path.resolve(HERE, '../../experiments/safari-cruise');

const browser = await chromium.launch();
const pg = await browser.newPage();
for (const [name, size] of [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180]]){
  const data = await pg.evaluate((S) => {
    const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
    g.scale(S / 512, S / 512);
    const sky = g.createLinearGradient(0, 0, 0, 512); sky.addColorStop(0, '#e8803a'); sky.addColorStop(0.6, '#f8c860'); sky.addColorStop(1, '#f8e0a0');
    g.fillStyle = sky; g.fillRect(0, 0, 512, 512);
    g.fillStyle = '#fff2c0'; g.beginPath(); g.arc(330, 300, 90, 0, 7); g.fill();
    g.fillStyle = '#5a3a1a'; g.fillRect(0, 410, 512, 102);
    // an acacia
    g.fillStyle = '#3a2410';
    g.beginPath(); g.moveTo(380, 412); g.lineTo(392, 300); g.lineTo(400, 412); g.fill();
    g.lineWidth = 8; g.strokeStyle = '#3a2410'; g.beginPath(); g.moveTo(392, 320); g.lineTo(350, 270); g.moveTo(394, 315); g.lineTo(440, 275); g.stroke();
    g.beginPath(); g.ellipse(395, 262, 100, 26, 0, 0, 7); g.fill();
    // a giraffe silhouette
    g.fillStyle = '#3a2410';
    g.beginPath(); g.ellipse(170, 330, 62, 34, -0.15, 0, 7); g.fill();
    for (const [x, w] of [[122, 12], [140, 12], [196, 12], [214, 12]]) g.fillRect(x, 340, w, 74);
    g.beginPath(); g.moveTo(205, 318); g.lineTo(250, 140); g.lineTo(272, 146); g.lineTo(232, 330); g.fill();
    g.beginPath(); g.ellipse(272, 142, 30, 13, 0.35, 0, 7); g.fill();
    g.fillRect(250, 112, 6, 22); g.fillRect(262, 114, 6, 22);
    g.lineWidth = 5; g.beginPath(); g.moveTo(110, 320); g.lineTo(96, 372); g.stroke();
    return c.toDataURL('image/png').split(',')[1];
  }, size);
  fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'));
  console.log('wrote', name);
}
await browser.close();
