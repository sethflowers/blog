// Tests MSB (Make Sell Buy) in headless Chromium and saves screenshots. About a minute.
//
//   npm i --prefix _tools/vr-test iwer        (once; the VR part uses Meta's emulated Quest 3)
//   NODE_PATH=$(npm root -g) node _tools/msb/test.mjs [outDir]
//
// Chromium's fake camera (a moving test pattern) checks the real-camera path: the camera starts, the
// shutter takes a picture, the editor opens with it. A real photo (one of MediaPipe's sample pictures,
// downloaded once into the system's temp folder; a drawn one if that fails) is then edited with every
// tool, kept, hung, offered for by a visitor and sold; the Art Market sells art, decorations, frames and
// the wing; pictures survive a reload; memory stays flat while pictures and visitors come and go; and
// VR: the camera in your hand, the editor panel worked with the trigger, the menu.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(HERE, '../..');
const OUT = path.resolve(process.argv[2] || 'msb-shots');
fs.mkdirSync(OUT, { recursive: true });
let IWER = null;
try { IWER = fs.readFileSync(require.resolve('iwer/build/iwer.min.js', { paths: [HERE, path.join(HERE, '../vr-test'), ...(process.env.NODE_PATH || '').split(':')] }), 'utf8'); }
catch (e) { console.log('(IWER not installed: skipping the VR part. npm i --prefix _tools/vr-test iwer)'); }

// a real photo to edit
const PIC_DIR = path.join(os.tmpdir(), 'msb-test-pictures'); fs.mkdirSync(PIC_DIR, { recursive: true });
const PIC = path.join(PIC_DIR, 'cats_and_dogs.jpg');
if (!fs.existsSync(PIC)){ try { const r = await fetch('https://storage.googleapis.com/mediapipe-assets/cats_and_dogs.jpg'); if (r.ok) fs.writeFileSync(PIC, Buffer.from(await r.arrayBuffer())); } catch (e) { /* drawn instead */ } }

const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.html': 'text/html' };
function page(name){
  const src = fs.readFileSync(path.join(ROOT, '_experiments', name + '.html'), 'utf8');
  const fm = src.match(/^---\n([\s\S]*?)\n---\n/);
  const version = (fm[1].match(/version:\s*"?([^"\n]+)"?/) || [])[1];
  return src.slice(fm[0].length).replace(/\{% endraw %\}\{\{ page\.version \}\}\{% raw %\}/g, version).replace(/\{% (end)?raw %\}/g, '');
}
const VERSION = (fs.readFileSync(path.join(ROOT, '_experiments/msb.html'), 'utf8').match(/version:\s*"?([^"\n]+)"?/) || [])[1];
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const m = url.match(/^\/experiments\/([^/]+)\/(index\.html)?$/);
  try {
    if (m){ res.writeHead(200, { 'content-type': 'text/html' }); return res.end(page(m[1])); }
    const file = url.startsWith('/__pic/') ? PIC : path.join(ROOT, url);
    if (!file.startsWith(ROOT) && file !== PIC) throw new Error('outside');
    const body = fs.readFileSync(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }); res.end(body);
  } catch (e) { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const BASE = `${ORIGIN}/experiments/msb/`;

let failures = 0;
const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) failures++; return ok; };
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, permissions: ['camera'] });
await ctx.addInitScript({ content: 'globalThis.__boxLog = [];' });
if (IWER) await ctx.addInitScript({ content: IWER + `
;window.__iwer = new IWER.XRDevice(IWER.metaQuest3, { stereoEnabled: false });
window.__iwer.installRuntime({ forceInstall: true });
` });
const pg = await ctx.newPage();
const errors = [];
pg.on('pageerror', (e) => errors.push(e.message + ' ' + (e.stack || '').split('\n').slice(1, 4).join(' ')));
pg.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const ev = (s, a) => pg.evaluate(s, a);
const wait = (ms) => pg.waitForTimeout(ms);
const shot = async (name) => { await ev('__msb.renderNow()'); await pg.screenshot({ path: path.join(OUT, name + '.png'), timeout: 120000 }); };
const snapDOM = async (name) => { await wait(120); await pg.screenshot({ path: path.join(OUT, name + '.png'), timeout: 120000 }); };
const nextFrame = async () => { const t = await ev('__msb.time'), start = Date.now(); while ((await ev('__msb.time')) === t && Date.now() - start < 20000) await wait(30); };
const panelTitle = () => ev(`document.querySelector('#panel.show h2')?.textContent || ''`);
const clickPanel = (re) => ev(`(() => { const b = [...document.querySelectorAll('#panel button')].find((b) => ${re}.test(b.textContent)); if (b) b.click(); return !!b; })()`);

console.log('MSB ' + VERSION);
const started = Date.now();
await pg.goto(BASE);
await pg.waitForFunction('window.__msb', null, { timeout: 120000 }).catch((e) => { console.log('the game did not start:', errors.join(' | ')); throw e; });
await ev('__msb.noRender = true');
await wait(400);
check((await pg.textContent('.build-version')).includes(VERSION), 'title shows version ' + VERSION);
if (!process.env.SKIP_LOADING){ const { checkLoading } = await import('../loading-check.mjs'); await checkLoading({ browser, url: BASE, check, main: pg, game: '__msb', shot: path.join(OUT, '00-loading.png') }); }
await shot('01-title');
{
  const { findCoplanar } = await import('../coplanar.mjs');
  const flicker = findCoplanar(JSON.parse(await ev('JSON.stringify(globalThis.__boxLog)'))).filter((h) => h.area >= 0.005);
  check(flicker.length === 0, `no flickering (coplanar) scenery faces${flicker.length ? ': ' + flicker.slice(0, 4).map((h) => `${h.a.m}/${h.b.m} at ${h.a.p.map((v) => v.toFixed(2))}`).join(' | ') : ''}`);
}

// ---------- play on the screen ----------
await ev(`document.getElementById('b-play').click()`);
await wait(300);
check(await ev('__msb.mode') === 'screen', 'Play starts the game on the screen');
check(/Welcome/.test(await panelTitle()), 'a welcome explains Make, Sell and Buy');
await snapDOM('02-welcome');
await ev('__msb.closePanels()');
check(await ev(`__msb.gallery.slots[2].art?.title`) === 'A Present', 'a first painting hangs on the back wall');
await shot('03-gallery');
await ev('__msb.standAt({ x: 0, z: -7.2, yaw: 0 })'); await ev('__msb.lookAt(0, 1.65, -10)');
await shot('03b-first-painting');
// walking, and a wall stops you
await ev('__msb.standAt(__msb.START)');
await ev('__msb.stick.y = -1'); await ev('__msb.advance(1.5)'); await ev('__msb.stick.y = 0');
check(await ev('__msb.player.pos.z') < 3, `the thumb stick walks you forward (z ${(await ev('__msb.player.pos.z')).toFixed(1)})`);
await ev('__msb.stick.y = -1'); await ev('__msb.advance(8)'); await ev('__msb.stick.y = 0');
check(Math.abs(await ev('__msb.player.pos.z') - 0.45) < 0.05, `the wall in the middle stops you (z ${(await ev('__msb.player.pos.z')).toFixed(2)})`);

// ---------- MAKE: the real camera ----------
await ev(`document.getElementById('b-cam').click()`);
await pg.waitForFunction('__msb.cam.live || /not|No /.test(document.getElementById("cam-msg").textContent)', null, { timeout: 20000 }).catch(() => {});
check(await ev('__msb.cam.live'), 'the 📷 button starts the device\'s camera');
await snapDOM('04-camera');
await ev(`document.getElementById('cam-shoot').click()`);
await pg.waitForFunction('__msb.editor.isOpen', null, { timeout: 5000 }).catch(() => {});
check(await ev('__msb.editor.isOpen && !__msb.cam.stream'), 'the shutter takes the picture, turns the camera off and opens the editor');
const camSize = await ev('[__msb.session.src.width, __msb.session.src.height]');
check(camSize[0] > 100 && camSize[1] > 100, `the photo came from the camera (${camSize.join('×')})`);
await snapDOM('05-editor-camera-photo');
await ev(`document.getElementById('ed-cancel').click()`);   // nothing edited yet: no question asked
check(!(await ev('__msb.editor.isOpen')), 'Bin it closes the editor');

// ---------- the editor, with a real photo ----------
await ev(`(async () => { const img = new Image(); img.src = '/__pic/x.jpg'; try { await img.decode(); } catch (e) { const c = document.createElement('canvas'); c.width = 1200; c.height = 900; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 900); gr.addColorStop(0, '#6ab8f0'); gr.addColorStop(1, '#f0d8a0'); g.fillStyle = gr; g.fillRect(0, 0, 1200, 900); g.fillStyle = '#c84a2a'; g.beginPath(); g.arc(600, 500, 220, 0, 7); g.fill(); window.__testPic = c; return; } const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); window.__testPic = c; })()`);
await ev('__msb.edit(window.__testPic)');
await wait(200);
check(await ev('__msb.editor.isOpen'), 'a photo opens in the editor');
const tabs = await ev(`[...document.querySelectorAll('#ed-tabs .etab')].map((b) => b.textContent)`);
check(tabs.length === 7, `seven tools: ${tabs.join(', ')}`);
await snapDOM('06-editor-filters');
// filters
await ev(`[...document.querySelectorAll('#ed-tray .thumb')].find((b) => /Vivid/.test(b.textContent)).click()`);
check(await ev('__msb.session.s.filter') === 'vivid', 'picking a filter thumbnail uses it');
const px = async () => ev(`(() => { const c = document.getElementById('ed-canvas'), d = c.getContext('2d').getImageData(c.width / 2 - 20, c.height / 2 - 20, 40, 40).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += Math.abs(d[i] - d[i + 1]) + Math.abs(d[i + 1] - d[i + 2]); return s / (d.length / 4); })()`);
await wait(150);
const satVivid = await px();
await ev(`[...document.querySelectorAll('#ed-tray .thumb')].find((b) => /Noir/.test(b.textContent)).click()`); await wait(150);
check(await px() < satVivid * 0.2, 'Noir makes it black and white');
await snapDOM('07-editor-noir');
// strength slider
await ev(`(() => { const r = document.querySelector('#ed-tray input[type=range]'); r.value = 40; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); })()`);
check(await ev('__msb.session.s.strength') === 40, 'the Strength slider fades the filter');
await ev(`[...document.querySelectorAll('#ed-tray .thumb')].find((b) => /Pop Art/.test(b.textContent)).click()`);
await ev(`(() => { const r = document.querySelector('#ed-tray input[type=range]'); r.value = 100; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); })()`);
// adjustments
await ev(`document.querySelector('.etab[data-tab=adjust]').click()`);
await ev(`(() => { const r = document.querySelector('#ed-tray input[type=range]'); r.value = 35; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); })()`);
check(await ev('__msb.session.s.adj.bright') === 35, 'the Brightness slider works');
await ev(`[...document.querySelectorAll('#ed-tray .ebtn')].find((b) => /Vignette/.test(b.textContent)).click()`);
await ev(`(() => { const r = document.querySelector('#ed-tray input[type=range]'); r.value = 60; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); })()`);
check(await ev('__msb.session.s.adj.vignette') === 60, 'and Vignette (12 adjustments to choose from)');
await snapDOM('08-editor-adjust');
// undo and redo
await ev(`document.getElementById('ed-undo').click()`);
check(await ev('__msb.session.s.adj.vignette') === 0, 'Undo takes the last change back');
await ev(`document.getElementById('ed-redo').click()`);
check(await ev('__msb.session.s.adj.vignette') === 60, 'Redo puts it back');
// crop: square, turn, zoom by dragging/pinching is in the session
await ev(`document.querySelector('.etab[data-tab=crop]').click()`);
await ev(`[...document.querySelectorAll('#ed-tray .ebtn')].find((b) => b.textContent === 'Square').click()`);
await wait(150);
check(await ev(`(() => { const c = document.getElementById('ed-canvas'); return Math.abs(c.width - c.height) < 3; })()`), 'Square crop makes a square picture');
await ev(`(() => { const r = document.querySelectorAll('#ed-tray input[type=range]')[0]; r.value = 1.5; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); })()`);
// drag the picture to move the crop
{
  const b = await pg.locator('#ed-canvas').boundingBox();
  const cx0 = await ev('__msb.session.s.cx');
  await pg.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.5); await pg.mouse.down(); await pg.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.5, { steps: 5 }); await pg.mouse.up();
  check(await ev('__msb.session.s.cx') > cx0 + 0.02, 'dragging the picture moves the crop');
}
await snapDOM('09-editor-crop');
// draw with the finger (mouse here)
await ev(`document.querySelector('.etab[data-tab=draw]').click()`);
await ev(`[...document.querySelectorAll('#ed-tray .ebtn')].find((b) => /Neon/.test(b.textContent)).click()`);
{
  const b = await pg.locator('#ed-canvas').boundingBox();
  await pg.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.25); await pg.mouse.down();
  for (let i = 0; i <= 12; i++) await pg.mouse.move(b.x + b.width * (0.2 + i * 0.05), b.y + b.height * (0.25 + Math.sin(i / 2) * 0.08));
  await pg.mouse.up();
}
check(await ev('__msb.session.s.strokes.length === 1 && __msb.session.s.strokes[0].pts.length > 5'), 'drawing on the picture makes a line');
// stickers
await ev(`document.querySelector('.etab[data-tab=sticker]').click()`);
await ev(`[...document.querySelectorAll('#ed-tray .emoji')][0].click()`);
await ev(`[...document.querySelectorAll('#ed-tray .emoji')][8].click()`);
check(await ev('__msb.session.s.stickers.length') === 2, 'tapping stickers adds them');
{
  const st = await ev('__msb.session.s.stickers[1]'), R = await ev('__msb.session.rect');
  const b = await pg.locator('#ed-canvas').boundingBox();
  const sx = b.x + (R.x + st.u * R.w) * b.width, sy = b.y + (R.y + st.v * R.h) * b.height;
  await pg.mouse.move(sx, sy); await pg.mouse.down(); await pg.mouse.move(b.x + b.width * 0.75, b.y + b.height * 0.3, { steps: 5 }); await pg.mouse.up();
  check(await ev('__msb.session.s.stickers[1].u') > 0.65, 'a sticker can be dragged into place');
}
await ev(`(() => { const r = document.querySelector('#ed-tray input[type=range]'); r.value = 35; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); })()`);
check(Math.abs(await ev('__msb.session.s.stickers[1].s') - 0.35) < 0.01, 'and sized with its slider');
await snapDOM('10-editor-stickers');
// words
await ev(`document.querySelector('.etab[data-tab=text]').click()`);
await pg.fill('#ed-tray .etext', 'My cats!');
await ev(`document.querySelector('#ed-tray .etext').dispatchEvent(new Event('change'))`);
await ev(`[...document.querySelectorAll('#ed-tray .ebtn')].find((b) => b.textContent === 'Loud').click()`);
check(await ev('__msb.session.s.text.str') === 'My cats!' && await ev('__msb.session.s.text.font') === 'impact', 'typing words and picking a font');
// frame and mat
await ev(`document.querySelector('.etab[data-tab=frame]').click()`);
await ev(`[...document.querySelectorAll('#ed-tray .ebtn')].find((b) => /Black/.test(b.textContent) && !/mat/.test(b.textContent)).click()`);
await ev(`[...document.querySelectorAll('#ed-tray .ebtn')].find((b) => /Instant/.test(b.textContent)).click()`);
check(await ev('__msb.session.s.frame') === 'black' && await ev('__msb.session.s.border') === 'polaroid', 'choosing a frame and a mat');
check(await ev(`[...document.querySelectorAll('#ed-tray .ebtn.locked')].length`) >= 3, 'frames you haven\'t bought are locked');
await snapDOM('11-editor-finished');
// compare (hold)
await ev(`document.getElementById('ed-compare').dispatchEvent(new PointerEvent('pointerdown'))`); await wait(120);
check(await ev('__msb.session.comparing'), 'holding 👁 Before shows the original');
await snapDOM('12-editor-before');
await ev(`document.getElementById('ed-compare').dispatchEvent(new PointerEvent('pointerup'))`);
// done: it becomes an artwork, worth something, in My Art
const n0 = await ev('__msb.save.art.length');
await ev(`document.getElementById('ed-done').click()`);
await pg.waitForFunction(`/new artwork/.test(document.querySelector('#panel.show h2')?.textContent || '')`, null, { timeout: 10000 }).catch(() => {});
check(await ev('__msb.save.art.length') === n0 + 1, 'Done makes it an artwork in My Art');
const art = await ev('__msb.save.art[0]');
check(art.value >= 30 && art.stars && art.title.length > 3, `"${art.title}" is worth ${art.value} (${JSON.stringify(art.stars)})`);
check(art.edits.length >= 6, `the edits count: ${art.edits.join(', ')}`);
check(await ev(`new Promise((res) => { const r = indexedDB.open('msb-pictures'); r.onsuccess = () => { const q = r.result.transaction('pics').objectStore('pics').get('${art.id}'); q.onsuccess = () => res(!!q.result && q.result.size > 10000); q.onerror = () => res(false); }; r.onerror = () => res(false); })`), 'the picture is saved on the device');
await snapDOM('13-new-artwork');
await clickPanel(/Keep it$/);
check(await ev(`document.querySelectorAll('#strip .item').length`) >= 1, 'it shows as a little item along the bottom');
await shot('14-item-strip');
// hang it
await ev(`__msb.standAt({ x: 4.5, z: -6, yaw: 0 })`);
await ev(`__msb.hangNearest(__msb.save.art[0])`);
const slot = await ev(`__msb.save.art[0].slot`);
check(slot != null && await ev(`__msb.gallery.slots[${slot}].art === __msb.save.art[0]`), 'Hang it puts it on the nearest empty wall');
await ev(`(() => { const s = __msb.gallery.slots[${slot}]; __msb.standAt({ x: s.view.x + s.n.x * 0.4, z: s.view.z + s.n.z * 0.4 }); __msb.lookAt(s.pos.x, 1.55, s.pos.z); })()`);
await shot('15-hung-on-the-wall');
// tapping a frame opens its panel
await ev('__msb.closePanels()');
await ev(`__msb.tapScreen(innerWidth / 2, innerHeight / 2)`);
check(/🖼/.test(await panelTitle()), 'tapping a picture on the wall opens it');
await ev('__msb.closePanels()');
// an empty spot
await ev(`(() => { const s = __msb.gallery.slots.find((s) => !s.art && !s.wing); __msb.standAt({ x: s.view.x, z: s.view.z }); __msb.lookAt(s.pos.x, 1.65, s.pos.z); window.__emptySlot = s.i; })()`);
await ev(`__msb.tapScreen(innerWidth / 2, innerHeight / 2)`);
check(/empty spot/.test(await panelTitle()), 'tapping an empty spot asks what to hang there');
await ev('__msb.closePanels()');

// ---------- SELL: visitors make offers ----------
await ev(`__msb.standAt({ x: 0, z: 6, yaw: 0 })`);
const money0 = await ev('__msb.save.money');
// make the visitors keen: they come quickly and like what they see
await ev(`(() => { const V = __msb.visitors; V.spawnT = 0; V.R = (() => { let s = 7; return () => { s = (s * 16807) % 2147483647; return (s % 1000) / 1000 * 0.4; }; })(); })()`);
const gotOffer = await ev(`__msb.advance(240, () => __msb.visitors.list.some((v) => v.offer && v.offer.art === __msb.save.art[0]))`);
check(gotOffer, 'a visitor looks at your picture and offers to buy it');
check(await ev(`document.querySelectorAll('#jobs .job').length`) >= 1, 'the offer shows as a card with Sell and ✕');
const offer = await ev(`(() => { const v = __msb.visitors.list.find((v) => v.offer && v.offer.art === __msb.save.art[0]); return v && { id: v.id, price: v.offer.price, name: v.name }; })()`);
if (offer){
  await ev(`(() => { const v = __msb.visitors.list[${offer.id}]; const s = v.offer.slot; __msb.standAt({ x: s.view.x + s.n.x * 2.5 + 1.2, z: s.view.z + s.n.z * 2.5 }); __msb.lookAt(v.pos.x, 1.4, v.pos.z); })()`);
  await shot('16-visitor-offer');
  await ev(`(() => { __msb.refreshHUD(true); const b = document.querySelector('#jobs .jyes'); b.click(); })()`);
  check(await ev('__msb.save.money') === money0 + offer.price, `selling to ${offer.name} earns ${offer.price}`);
  check(!(await ev(`__msb.save.art.some((a) => a.id === '${art.id}')`)) && await ev(`!__msb.gallery.slots[${slot}].art`), 'and the picture leaves the wall');
}
// sell to the dealer
await ev(`__msb.addPhoto(window.__testPic, { frame: 'wood' }, ['filter'])`);
const a2 = await ev('__msb.save.art[0]');
await ev(`__msb.artPanel(__msb.save.art[0])`); await wait(150);
const m1 = await ev('__msb.save.money');
await clickPanel(/Sell to the dealer/);
check(await ev('__msb.save.money') === m1 + Math.max(5, Math.round(a2.value * 0.7 / 5) * 5), 'Sell to the dealer pays straight away (70%)');

// ---------- BUY: the Art Market ----------
await ev('__msb.save.money = 2000');
await ev(`(() => { const D = __msb.DESK; __msb.standAt({ x: D.x, z: D.z - 3 }); __msb.lookAt(D.x, 1.2, D.z); })()`);
await shot('17-art-market-desk');
await ev(`__msb.tapScreen(innerWidth / 2, innerHeight / 2)`);
check(/Art Market/.test(await panelTitle()), 'tapping the desk opens the Art Market');
await snapDOM('18-art-market');
await clickPanel(/^Buy \$/);
check(await ev(`__msb.save.art[0].kind === 'market'`), 'buying a painting puts it in My Art');
await ev('__msb.shop("decor")'); await clickPanel(/^Buy \$/);
check(await ev('__msb.save.decor.length') === 1, 'buying a decoration puts it in the gallery');
await ev('__msb.shop("frames")'); await clickPanel(/^Buy \$/);
check(await ev('__msb.save.frames.length') === 3, 'buying a frame');
await ev('__msb.shop("gallery")'); await clickPanel(/east wing/);
check(await ev('__msb.save.wing && __msb.gallery.wingOpen'), 'opening the east wing');
await ev(`__msb.hangArt(__msb.save.art[0], __msb.gallery.slots.find((s) => s.wing))`);
await ev(`__msb.standAt({ x: 11.5, z: 0.5, yaw: -Math.PI / 2 })`); await ev('__msb.lookAt(22, 1.6, -3)');
await shot('19-east-wing');
// buy all the decorations to see them
await ev(`(() => { for (const k of ['plant', 'plant', 'bench', 'sculpture', 'sculpture', 'rug', 'fountain', 'plant']) __msb.buyDecor(k); __msb.closePanels(); })()`);
await ev(`__msb.standAt({ x: -6, z: 8, yaw: 0 })`); await ev('__msb.lookAt(3, 1.0, -5)');
await shot('20-decorated');

// ---------- memory: pictures and visitors come and go ----------
const drawAll = () => ev(`(() => { for (const v of __msb.visitors.list) v.root.traverse((o) => { o.frustumCulled = false; }); __msb.gallery.root.traverse((o) => { o.frustumCulled = false; }); __msb.renderNow(); })()`);
const churn = (i) => ev(`(async () => { const M = __msb; const a = M.save.art.find((a) => a.kind === 'market'); const free = M.gallery.slots.filter((s) => M.gallery.slotOpen(s) && (!s.art || s.art === a));
    await M.hangArt(a, free[${i} % free.length]); M.advance(4); M.takeDown(a); M.advance(4); M.renderNow(); })()`);
for (let i = 0; i < 6; i++) await churn(i);   // (each spot makes its label once, the first time it's used)
await drawAll();
const mem0 = await ev('({ g: __msb.renderer.info.memory.geometries, t: __msb.renderer.info.memory.textures })');
for (let i = 0; i < 12; i++) await churn(i);
await drawAll();
const mem1 = await ev('({ g: __msb.renderer.info.memory.geometries, t: __msb.renderer.info.memory.textures })');
check(mem1.g <= mem0.g + 1 && mem1.t <= mem0.t, `memory stays flat while pictures go up and down (geometries ${mem0.g} → ${mem1.g}, textures ${mem0.t} → ${mem1.t})`);
const calls = await ev('(() => { __msb.standAt(__msb.START); __msb.renderNow(); return __msb.renderer.info.render.calls; })()');
check(calls < 250, `draw calls: ${calls}`);

// ---------- saving: a reload brings everything back ----------
await ev(`(async () => { const M = __msb; const p = M.save.art.find((a) => a.kind === 'photo'); if (!p) await M.addPhoto(window.__testPic, { frame: 'black' }, ['filter', 'draw']); const q = M.save.art.find((a) => a.kind === 'photo'); await M.hangArt(q, M.gallery.slots[0]); M.store(); })()`);
const keep = await ev(`__msb.save.art.find((a) => a.kind === 'photo').id`);
await pg.reload();
await pg.waitForFunction('window.__msb', null, { timeout: 120000 });
await ev('__msb.noRender = true');
await pg.waitForFunction(`__msb.gallery.slots[0].art && __msb.gallery.slots[0].art.id === '${keep}'`, null, { timeout: 10000 }).catch(() => {});
check(await ev(`__msb.gallery.slots[0].art?.id`) === keep, 'after a reload your photo is back on the wall');
check(await ev(`__msb.gallery.slots[0].tex && __msb.gallery.slots[0].tex.image.width > 100`), 'with its picture (from the device\'s storage)');
check(await ev('__msb.save.wing && __msb.save.decor.length > 3'), 'and the wing and decorations too');

// ---------- VR ----------
if (IWER){
  await ev('__msb.xrScale = 0.3');
  await ev('__msb.startVR(false)');
  await pg.waitForFunction('__msb.mode === "vr"', null, { timeout: 30000 });
  check(true, 'VR session starts');
  await ev(`(() => { const d = window.__iwer; d.position.set(0, 1.6, 0); d.quaternion.set(0, 0, 0, 1);
    d.controllers.left.position.set(-0.2, 1.3, -0.3); d.controllers.left.quaternion.set(0, 0, 0, 1);
    d.controllers.right.position.set(0.2, 1.3, -0.3); d.controllers.right.quaternion.set(0, 0, 0, 1); })()`);
  await pg.waitForFunction('__msb.vrs.posed', null, { timeout: 30000 });
  await nextFrame(); await nextFrame();
  check(await ev('__msb.vr[0].tracked && __msb.vr[1].tracked'), 'both controllers are tracked');
  check(await ev('__msb.watchMesh.visible'), 'a watch on your left wrist shows money and the version');
  const btn = async (hand, name) => { await ev(`window.__iwer.controllers.${hand}.updateButtonValue('${name}', 1)`); await nextFrame(); await nextFrame(); await ev(`window.__iwer.controllers.${hand}.updateButtonValue('${name}', 0)`); await nextFrame(); await nextFrame(); };
  await btn('right', 'a-button');
  check(await ev('__msb.vrs.camOut && __msb.camVR.visible'), 'A takes the camera out (in your right hand)');
  await pg.waitForFunction('__msb.cam.live || true', null, { timeout: 3000 });
  await nextFrame(); await nextFrame(); await nextFrame();
  await pg.screenshot({ path: path.join(OUT, '21-vr-camera.png'), timeout: 120000 });
  await btn('right', 'trigger');
  await pg.waitForFunction('!!__msb.session', null, { timeout: 10000 }).catch(() => {});
  check(await ev('!!__msb.session && !!__msb.vrPage && __msb.vrPage.editor'), 'the trigger takes the picture and opens the editor panel');
  await nextFrame(); await nextFrame();
  // point at the Vivid filter on the panel and pull the trigger
  const aimAt = async (pred) => {
    const aim = await ev(`(() => { const T = __msb.vrPanel, h = T.hits.find((x) => x.b && (${pred})(x.b)); if (!h) return null;
      const u = (h.x + h.w / 2) / T.W, v = 1 - (h.y + h.h / 2) / T.H;
      return T.mesh.localToWorld(new T.mesh.position.constructor((u - 0.5) * 0.8, (v - 0.5) * 1.0, 0)).toArray(); })()`);
    if (!aim) return false;
    await ev(`(() => { const R = __msb.vr[1], target = new __msb.rig.position.constructor(...${JSON.stringify(aim)});
      const d = target.sub(R.rayPos).normalize().applyQuaternion(__msb.rig.quaternion.clone().invert());
      const q = new __msb.rig.quaternion.constructor().setFromUnitVectors(new __msb.rig.position.constructor(0, 0, -1), d);
      window.__iwer.controllers.right.quaternion.set(q.x, q.y, q.z, q.w); })()`);
    await nextFrame(); await nextFrame(); await nextFrame();
    return true;
  };
  check(await aimAt('(b) => b.label === "Vivid"'), 'the editor panel shows the filters');
  await btn('right', 'trigger');
  check(await ev('__msb.session && __msb.session.s.filter') === 'vivid', 'pointing and pulling the trigger picks a filter');
  await nextFrame(); await nextFrame();
  await pg.screenshot({ path: path.join(OUT, '22-vr-editor.png'), timeout: 120000 });
  // draw on the picture with the trigger held
  await ev('__msb.session.setTab("draw")'); await nextFrame(); await nextFrame(); await nextFrame();
  const imgAim = await ev(`(() => { const T = __msb.vrPanel, h = T.hits.find((x) => x.img); if (!h) return null; const P = (fx, fy) => { const u = (h.x + h.w * fx) / T.W, v = 1 - (h.y + h.h * fy) / T.H; return T.mesh.localToWorld(new T.mesh.position.constructor((u - 0.5) * 0.8, (v - 0.5) * 1.0, 0)).toArray(); }; return [P(0.3, 0.4), P(0.5, 0.5), P(0.7, 0.45)]; })()`);
  if (check(!!imgAim, 'the picture on the panel can be pointed at')){
    const aimPoint = (p) => ev(`(() => { const R = __msb.vr[1], target = new __msb.rig.position.constructor(...${JSON.stringify(p)});
      const d = target.sub(R.rayPos).normalize().applyQuaternion(__msb.rig.quaternion.clone().invert());
      const q = new __msb.rig.quaternion.constructor().setFromUnitVectors(new __msb.rig.position.constructor(0, 0, -1), d);
      window.__iwer.controllers.right.quaternion.set(q.x, q.y, q.z, q.w); })()`);
    await aimPoint(imgAim[0]); await nextFrame(); await nextFrame();
    await ev(`window.__iwer.controllers.right.updateButtonValue('trigger', 1)`); await nextFrame(); await nextFrame();
    await aimPoint(imgAim[1]); await nextFrame(); await nextFrame();
    await aimPoint(imgAim[2]); await nextFrame(); await nextFrame();
    await ev(`window.__iwer.controllers.right.updateButtonValue('trigger', 0)`); await nextFrame(); await nextFrame();
    check(await ev('__msb.session && __msb.session.s.strokes.length === 1 && __msb.session.s.strokes[0].pts.length >= 2'), 'holding the trigger on the picture draws on it');
  }
  await ev('__msb.session.setTab("filter")'); await nextFrame(); await nextFrame(); await nextFrame();
  const nArt = await ev('__msb.save.art.length');
  check(await aimAt('(b) => /Done/.test(b.label)'), 'the editor panel has a Done button');
  await btn('right', 'trigger');
  await pg.waitForFunction(`__msb.save.art.length === ${nArt + 1}`, null, { timeout: 10000 }).catch(() => {});
  check(await ev('__msb.save.art.length') === nArt + 1, 'Done in VR makes the artwork');
  await pg.waitForFunction(`__msb.vrPage && /new artwork/.test(__msb.vrPage.title)`, null, { timeout: 10000 }).catch(() => {});
  check(await ev('!!__msb.vrPage && /new artwork/.test(__msb.vrPage.title)'), 'and shows it, with Keep and Sell');
  await nextFrame(); await nextFrame();
  await pg.screenshot({ path: path.join(OUT, '23-vr-new-artwork.png'), timeout: 120000 });
  check(await aimAt('(b) => /Hang it/.test(b.label)'), 'a Hang it button');
  await btn('right', 'trigger');
  await pg.waitForFunction('__msb.save.art[0].slot != null', null, { timeout: 10000 }).catch(() => {});
  check(await ev('__msb.save.art[0].slot != null'), 'which hangs it on a wall');
  // the menu
  await btn('left', 'x-button');
  check(await ev(`!!__msb.vrPage && /Menu/.test(__msb.vrPage.title)`), 'X opens the menu');
  const inFront = await ev(`(() => { const m = __msb.vrPanel.mesh.position, h = __msb.head; return Math.hypot(m.x - h[0], m.z - h[2]) > 0.7 && Math.abs(m.y - h[1]) < 0.5; })()`);
  check(inFront, 'in front of you at head height');
  await btn('right', 'b-button');
  check(!(await ev('__msb.vrPage')), 'B closes it');
  // walking
  const h0 = await ev('__msb.head');
  await ev(`window.__iwer.controllers.left.updateAxes('thumbstick', 0, -1)`); await nextFrame(); await nextFrame();
  await ev('__msb.advance(1.5)');
  await ev(`window.__iwer.controllers.left.updateAxes('thumbstick', 0, 0)`); await nextFrame(); await nextFrame();
  const h1 = await ev('__msb.head');
  check(Math.hypot(h1[0] - h0[0], h1[2] - h0[2]) > 1.5, 'the left stick walks you');
  await ev('__msb.renderer.xr.getSession().end()'); await wait(500);
  check(await ev('__msb.mode') === 'title', 'leaving VR goes back to the title');
}

check(errors.length === 0, 'no errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
console.log(`${failures ? failures + ' FAILED' : 'all passed'} in ${Math.round((Date.now() - started) / 1000)} s; screenshots in ${OUT}`);
await browser.close(); server.close();
process.exit(failures ? 1 : 0);
