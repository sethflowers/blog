// Plays Mad Scientist in headless Chromium, checks it, and saves screenshots. Quick (about a minute).
//
//   npm i --prefix _tools/vr-test iwer        (once; the VR part uses Meta's emulated Quest 3)
//   NODE_PATH=$(npm root -g) node _tools/mad-scientist/test.mjs [outDir] [--full]
//
// Serves the repo the way Jekyll would publish it (front matter stripped, version filled in). Checks:
// the loading screen, the title and version, no z-fighting in the scenery, the welcome, a customer
// coming to the counter and ordering, scooping and adding ingredients (tapping the 3D tubs and jars,
// and the tray buttons), serving, the customer eating it and the effect happening, recipes always
// doing the same thing, the catalogue filling up and "Make this", discoveries and their prize,
// requests and tips, a customer giving up, the end of the day and the Supply Shop, saving and old
// saves, every effect (a gallery of screenshots), memory staying flat as customers come and go, draw
// calls, and in VR: pointing at a tub, a jar and the bell with the trigger, the wrist board, the menu
// board and B closing it.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(HERE, '../..');
const OUT = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || 'mad-scientist-shots');
const FULL = process.argv.includes('--full');
fs.mkdirSync(OUT, { recursive: true });
let IWER = null;
try { IWER = fs.readFileSync(require.resolve('iwer/build/iwer.min.js', { paths: [HERE, path.join(HERE, '../vr-test'), ...(process.env.NODE_PATH || '').split(':')] }), 'utf8'); }
catch (e) { console.log('(IWER not installed: skipping the VR part. npm i --prefix _tools/vr-test iwer)'); }

const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.html': 'text/html' };
function page(name){
  const src = fs.readFileSync(path.join(ROOT, '_experiments', name + '.html'), 'utf8');
  const fm = src.match(/^---\n([\s\S]*?)\n---\n/);
  const version = (fm[1].match(/version:\s*"?([^"\n]+)"?/) || [])[1];
  return src.slice(fm[0].length).replace(/\{% endraw %\}\{\{ page\.version \}\}\{% raw %\}/g, version).replace(/\{% (end)?raw %\}/g, '');
}
const VERSION = (fs.readFileSync(path.join(ROOT, '_experiments/mad-scientist.html'), 'utf8').match(/version:\s*"?([^"\n]+)"?/) || [])[1];
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const m = url.match(/^\/experiments\/([^/]+)\/(index\.html)?$/);
  try {
    if (m){ res.writeHead(200, { 'content-type': 'text/html' }); return res.end(page(m[1])); }
    const file = path.join(ROOT, url);
    if (!file.startsWith(ROOT)) throw new Error('outside');
    const body = fs.readFileSync(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }); res.end(body);
  } catch (e) { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://127.0.0.1:${server.address().port}/experiments/mad-scientist/`;

let failures = 0;
const T0 = Date.now();
const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what + (process.env.TIMING ? `  [${Math.round((Date.now() - T0) / 1000)} s]` : '')); if (!ok) failures++; return ok; };
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1024, height: 700 } });
await ctx.addInitScript({ content: 'globalThis.__boxLog = [];' });
if (IWER) await ctx.addInitScript({ content: IWER + `
;window.__iwer = new IWER.XRDevice(IWER.metaQuest3, { stereoEnabled: false });
window.__iwer.installRuntime({ forceInstall: true });
` });
const pg = await ctx.newPage();
const errors = [];
pg.on('pageerror', (e) => errors.push(e.message + ' ' + (e.stack || '').split('\n').slice(1, 4).join(' ')));
pg.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const ev = (s) => pg.evaluate(s);
const wait = (ms) => pg.waitForTimeout(ms);
const shot = async (name) => { await ev('__ms.renderNow()'); await pg.screenshot({ path: path.join(OUT, name + '.png'), timeout: 120000 }); };
const nextFrame = async () => { const t = await ev('__ms.time'), start = Date.now(); while ((await ev('__ms.time')) === t && Date.now() - start < 20000) await wait(30); };
const until = async (expr, sec, what) => check(await ev(`__ms.advance(${sec}, () => (${expr}))`), what + ((await ev(expr)) ? '' : ' (timed out)'));
// where a world point lands on the screen
const screenOf = (expr) => ev(`(() => { const p = (${expr}).clone().project(__ms.camera); return { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight }; })()`);
// a tap on the canvas at a screen point (pointer events, like a finger)
const tap = async (pt) => { await pg.mouse.move(pt.x, pt.y); await pg.mouse.down(); await pg.mouse.up(); };

console.log('Mad Scientist ' + VERSION);
const started = Date.now();
await pg.goto(BASE);
await pg.waitForFunction('window.__ms', null, { timeout: 120000 }).catch((e) => { console.log('the game did not start:', errors.join(' | ')); throw e; });
await ev('localStorage.clear()');
await ev('__ms.noRender = true');
await wait(500);
check((await pg.textContent('.build-version')).includes(VERSION), 'title shows version ' + VERSION);
if (!process.env.SKIP_LOADING){ const { checkLoading } = await import('../loading-check.mjs'); await checkLoading({ browser, url: BASE, check, main: pg, game: '__ms', shot: path.join(OUT, '00-loading.png') }); }
await ev('__ms.advance(6)');
check(await ev('__ms.customers.length') > 0, 'customers come into the shop behind the title');
await shot('01-title');
{
  const { findCoplanar } = await import('../coplanar.mjs');
  const flicker = findCoplanar(JSON.parse(await ev('JSON.stringify(globalThis.__boxLog)'))).filter((h) => h.area >= 0.005);
  check(flicker.length === 0, `no flickering (coplanar) scenery faces${flicker.length ? ': ' + flicker.slice(0, 4).map((h) => `${h.a} | ${h.b}`).join(' || ') : ''}`);
}

// ---------- recipes are fixed ----------
check(await ev(`(() => { const a = __ms.outcome('vanilla', ['helium', 'owl']), b = __ms.outcome('vanilla', ['owl', 'helium']); return a.text === b.text && a.key === b.key; })()`), 'the same ingredients always do the same thing (in any order)');
check(await ev(`__ms.outcome('vanilla', ['helium']).effects[0].id === 'float'`), 'helium makes them float');
check(await ev(`__ms.outcome('vanilla', []).effects[0].id === 'plain' && __ms.outcome('choc', ['sprinkles']).effects[0].id === 'delicious'`), 'plain ice cream is plain, sprinkles are delicious');

// ---------- on screen ----------
await ev(`document.getElementById('b-play').click()`);
await ev('__ms.paused = true');
await wait(200);
check(await ev('__ms.mode') === 'screen', 'Open the shop starts the game on the screen');
check(await ev(`!!document.querySelector('#panel.show') && document.querySelector('#panel h2').textContent.includes('Ice Cream Lab')`), 'a welcome explains the game');
await shot('02-welcome');
await ev('__ms.closePanels()');
check(await ev('__ms.customers.length') === 0 && await ev('__ms.day.n') === 1, 'day 1, the title\'s customers are gone');
await until('!!__ms.front', 40, 'a customer comes in and reaches the counter');
check(await ev(`!!__ms.front.p.say && __ms.front.p.say.text.length > 3`), `they say what they want ("${await ev('__ms.front.p.say && __ms.front.p.say.text')}")`);
check(await ev(`document.getElementById('h-order').textContent.includes('want')`), 'the HUD says what they want');
// tap the chocolate tub and the helium jar in the 3D shop
await ev('__ms.renderNow()');
const tub = await screenOf(`__ms.world.tubs.find((t) => t.id === 'choc').g.position.clone().add(new __ms.player.pos.constructor(0, 0.06, 0))`);
await tap(tub);
check(await ev('__ms.cur.base') === 'choc', 'tapping the chocolate tub scoops chocolate');
const jar = await screenOf(`__ms.world.slots[1].clone().add(new __ms.player.pos.constructor(0, 0.1, 0))`);
await tap(jar);
check(JSON.stringify(await ev('__ms.cur.ings')) === '["helium"]', 'tapping the helium jar adds helium');
await ev('__ms.advance(0.6)');
check(await ev(`document.getElementById('cone-status').textContent.includes('Never tried')`), 'the cone says it has never been tried');
await shot('03-cone');
// the tray: a third ingredient is refused, bin empties
await ev(`[...document.querySelectorAll('#tray .tb')].find((b) => b.title === 'Owl Eye Drops').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
check(JSON.stringify(await ev('__ms.cur.ings')) === '["helium","owl"]', 'the tray button adds owl eye drops');
await ev(`[...document.querySelectorAll('#tray .tb')].find((b) => b.title === 'Chameleon Spit').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
check(await ev('__ms.cur.ings.length') === 2, 'only two ingredients fit');
await ev(`document.getElementById('b-bin').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
check(await ev('!__ms.cur.base && !__ms.cur.ings.length'), 'the bin empties the cone');
// serve chocolate + helium
await ev(`__ms.chooseBase('choc'); __ms.addIng('helium')`);
const money0 = await ev('__ms.save.money');
check(await ev('__ms.serve()'), 'the bell serves it');
check(await ev('__ms.save.money') === money0 + 5, 'they pay $5');
await until(`__ms.customers[0].state === 'eat'`, 2, 'the cone flies over and they eat it');
await ev('__ms.advance(1)');
await shot('04-eating');
await until(`__ms.customers[0].state === 'react'`, 3, 'they finish it');
await ev('__ms.advance(2.2)');
check(await ev(`__ms.customers[0].p.fx.has('float') && __ms.customers[0].p.rise > 0.2`), 'and float up like a balloon');
check(await ev(`!!__ms.save.found.float && !!__ms.save.cat['choc:helium']`), 'the effect is found and the recipe is in the catalogue');
check(await ev('__ms.save.money') === money0 + 5 + 10, 'a new discovery wins a $10 science prize');
await shot('05-float');
await until(`!__ms.customers.some((c) => c.p.fx.has('float'))`, 20, 'the balloon floats out through the skylight');
// the same recipe again says what it does
await ev(`__ms.chooseBase('choc'); __ms.addIng('helium'); __ms.advance(0.6)`);
check(await ev(`document.getElementById('cone-status').textContent.includes('Floats like a balloon')`), 'a recipe made before says what it does');
await ev('__ms.binIt()');
// the catalogue, and Make this
await ev('__ms.catalogue()');
check(await ev(`document.querySelectorAll('#panel .row').length === 1 && document.querySelector('#panel .row').textContent.includes('Helium')`), 'the catalogue lists the recipe');
await shot('06-catalogue');
await ev(`[...document.querySelectorAll('#panel .row button')].find((b) => /Make/.test(b.textContent)).click()`);
check(await ev(`__ms.cur.base === 'choc' && __ms.cur.ings.join() === 'helium' && !document.querySelector('#panel.show')`), '"Make this" fills the cone with that recipe');
// a request: they ask for float and get it: a big tip
await until('!!__ms.front', 40, 'the next customer reaches the counter');
await ev(`__ms.front.order = { kind: 'effect', id: 'float' }`);
const money1 = await ev('__ms.save.money');
await ev('__ms.serve()');
await until(`__ms.customers.some((c) => c.state === 'leave' && c.p.fx.has('float'))`, 10, 'the customer who asked to fly floats away');
check(await ev('__ms.save.money') === money1 + 5 + 15, 'giving them exactly what they asked for earns a $15 tip');
// wanting something delicious and getting a frog... no tip
await until('!!__ms.front', 40, 'another customer');
await ev(`__ms.front.order = { kind: 'delicious' }`);
await ev(`__ms.chooseBase('vanilla'); __ms.addIng('elephant')`);
const money2 = await ev('__ms.save.money');
await ev('__ms.serve()');
await until(`__ms.customers.some((c) => c.state === 'leave')`, 10, 'they eat it and go');
check(await ev('__ms.save.money') === money2 + 5, 'wanting something delicious and getting huge ears: no tip');
// patience runs out
await until('!!__ms.front', 40, 'another customer');
await ev(`__ms.front.patience = 0.5`);
await until(`__ms.customers.some((c) => c.huffed)`, 2, 'a customer kept waiting gives up and leaves');
await ev('__ms.advance(0.3)');
await shot('07-huff');

// ---------- every effect (a gallery) ----------
const ALL = ['plain', 'delicious', 'float', 'colour', 'bigEyes', 'bigEars', 'manyEyes', 'swell', 'bald', 'bug', 'animal', 'explode', 'tiny', 'longNeck', 'longNose', 'fire', 'invisible', 'zap', 'beard', 'bouncy', 'dance'];
const gallery = FULL ? ALL : ['delicious', 'colour', 'bigEyes', 'manyEyes', 'bald', 'bug', 'animal', 'explode', 'zap', 'longNeck'];
await ev(`__ms.standAt(__ms.START)`);
for (const id of ALL){
  const ok = await ev(`(() => { const e = { id: '${id}', power: 1, colour: 'rainbow', animal: 'pig' }; const c = __ms.showEffect([e], 3); __ms.advance(3); return c.p.fx.has('${id}'); })()`);
  if (!ok) check(false, 'effect ' + id);
  if (gallery.includes(id)) await shot('fx-' + id);
}
check(await ev(`(() => { const c = __ms.customers[0]; return !!c; })()`), `all ${ALL.length} effects play without errors`);
await ev(`(() => { __ms.showEffect([{ id: 'explode' }], 4); __ms.advance(1.6); })()`);
check(await ev(`!!__ms.customers[0].p.ghost`), 'exploding leaves a ghost (and smoking shoes)');
await ev(`(() => { __ms.showEffect([{ id: 'bald' }], 5); __ms.advance(2.5); })()`);
check(await ev(`!!__ms.customers[0].p.fallingHair && __ms.customers[0].p.fallingHair.m.position.y < 0.2`), 'hair falls out onto the floor');

// ---------- memory: lots of customers come and go ----------
const churn = (i) => ev(`(() => { for (const id of ['explode', 'bald', 'manyEyes', 'bug', 'animal', 'zap', 'float']){ __ms.showEffect([{ id, animal: ['pig','frog','chicken','cow'][${i}], colour: 'blue' }], 100 + ${i}); __ms.advance(2); __ms.renderNow(); } __ms.startDay(1); __ms.renderNow(); })()`);
for (let i = 0; i < 4; i++) await churn(i);   // (everything drawn once first)
const mem0 = await ev('({ g: __ms.renderer.info.memory.geometries, t: __ms.renderer.info.memory.textures })');
for (let i = 0; i < 8; i++) await churn(i % 4);
const mem1 = await ev('({ g: __ms.renderer.info.memory.geometries, t: __ms.renderer.info.memory.textures })');
check(mem1.g <= mem0.g + 2 && mem1.t <= mem0.t + 1, `memory stays flat as customers come and go (geometries ${mem0.g} → ${mem1.g}, textures ${mem0.t} → ${mem1.t})`);
const calls = await ev('(() => { __ms.standAt(__ms.START); __ms.renderNow(); return __ms.renderer.info.render.calls; })()');
check(calls < 200, `draw calls: ${calls}`);

// ---------- the end of the day, the Supply Shop, saving ----------
await ev(`(() => { const d = __ms.day; d.spawned = d.total; __ms.startDay; })()`);
await until(`!!document.querySelector('#panel.show') && document.querySelector('#panel h2').textContent.includes('over')`, 5, 'when the last customer has gone, the day is over');
await shot('08-day-over');
await ev(`__ms.save.money = 100`);
await ev(`[...document.querySelectorAll('#panel button')].find((b) => /Supply/.test(b.textContent)).click()`);
check(await ev(`document.querySelector('#panel h2').textContent.includes('Supply')`), 'the Supply Shop opens');
await ev(`[...document.querySelectorAll('#panel .row')].find((r) => r.textContent.includes('Beetle')).querySelector('button').click()`);
check(await ev(`__ms.save.ings.includes('beetle') && __ms.save.money === 75`), 'buying Beetle Juice ($25)');
check(await ev(`__ms.world.jarState[9].unlocked`), 'its jar on the counter opens');
await shot('09-shop');
await ev(`[...document.querySelectorAll('#panel button')].find((b) => /Day 2/.test(b.textContent)).click()`);
check(await ev('__ms.day.n') === 2 && await ev('__ms.day.total') === 9, 'day 2 starts with nine customers');
check(await ev(`(() => { const s = JSON.parse(localStorage.getItem('mad-scientist-v1')); return s.day === 2 && s.ings.includes('beetle') && !!s.cat['choc:helium']; })()`), 'the game is saved');
// an old save lacking newer things still loads
await ev(`__ms.save = { money: 3, day: 4, cat: {}, found: { float: 1 } }`);
check(await ev(`__ms.save.ings.includes('helium') && __ms.save.bases.includes('vanilla') && __ms.save.day === 4`), 'an old save is upgraded (missing ingredients filled in)');

// ---------- VR ----------
if (IWER){
  await ev('__ms.xrScale = 0.25;');
  await ev(`__ms.save = { money: 50, day: 1, welcomed: true }`);
  await ev('__ms.toTitle()'); await ev('__ms.paused = false');
  await ev('__ms.startVR(false)');
  await pg.waitForFunction('__ms.mode === "vr"', null, { timeout: 30000 });
  check(true, 'VR session starts');
  await ev(`(() => { const d = window.__iwer; d.position.set(0, 1.6, 0); d.quaternion.set(0, 0, 0, 1);
    d.controllers.left.position.set(-0.2, 1.25, -0.25); d.controllers.left.quaternion.set(0, 0, 0, 1);
    d.controllers.right.position.set(0.2, 1.25, -0.25); d.controllers.right.quaternion.set(0, 0, 0, 1); })()`);
  await pg.waitForFunction('__ms.vrs.posed', null, { timeout: 30000 });
  await nextFrame(); await nextFrame();
  check(await ev('__ms.vr[0].tracked && __ms.vr[1].tracked'), 'both controllers are tracked');
  check(await ev('__ms.wristMesh.visible'), 'the wrist board is on the left hand');
  const pointAt = async (expr) => {
    await ev(`(() => { const R = __ms.vr[1], V = __ms.rig.position.constructor; const p = (${expr});
      const d = p.clone().sub(R.rayPos).normalize().applyQuaternion(__ms.rig.quaternion.clone().invert());
      const q = new __ms.rig.quaternion.constructor().setFromUnitVectors(new V(0, 0, -1), d);
      window.__iwer.controllers.right.quaternion.set(q.x, q.y, q.z, q.w); })()`);
    await nextFrame(); await nextFrame();
  };
  const pull = async (hand = 'right', btn = 'trigger') => { await ev(`window.__iwer.controllers.${hand}.updateButtonValue('${btn}', 1)`); await nextFrame(); await nextFrame(); await ev(`window.__iwer.controllers.${hand}.updateButtonValue('${btn}', 0)`); await nextFrame(); await nextFrame(); };
  await ev(`window.__iwer.controllers.right.position.set(-0.56, 1.25, -0.3)`);
  await pointAt(`__ms.world.tubs.find((t) => t.id === 'vanilla').g.position.clone().add(new V(0, 0.06, 0))`);
  await pg.screenshot({ path: path.join(OUT, '20-vr-point.png'), timeout: 120000 });
  if (process.env.DEBUG) console.log(await ev(`(() => { const R = __ms.vr[1], V = __ms.rig.position.constructor; const d = new V(0, 0, -1).applyQuaternion(R.rayQuat); const h = __ms.world.ray(R.rayPos, d, 6); return { pos: R.rayPos.toArray(), d: d.toArray(), hit: h && h.kind + ':' + h.id, page: !!__ms.vrPage, head: __ms.head }; })()`));
  await pull();
  check(await ev('__ms.cur.base') === 'vanilla', 'pointing at the vanilla tub and pulling the trigger scoops it');
  await ev(`window.__iwer.controllers.right.position.set(-0.96, 1.25, -0.2)`);
  await pointAt(`__ms.world.slots[4].clone().add(new V(0, 0.1, 0))`);
  await pull();
  check(await ev(`__ms.cur.ings.join()`) === 'elephant', 'the trigger on a jar adds that ingredient');
  await ev(`__ms.advance(30, () => !!__ms.front)`);
  await pg.waitForFunction('!!__ms.front', null, { timeout: 30000 }).catch(() => {});
  await ev(`window.__iwer.controllers.right.position.set(0.42, 1.25, -0.25)`);
  await pointAt(`__ms.world.bell.position.clone().add(new V(0, 0.05, 0))`);
  await pull();
  check(await ev(`__ms.customers.some((c) => c.state === 'served' || c.state === 'eat' || c.state === 'react')`), 'the trigger on the bell serves the customer');
  for (let i = 0; i < 6; i++) await nextFrame();
  await pg.screenshot({ path: path.join(OUT, '21-vr-serve.png'), timeout: 120000 });
  // the menu: X opens it in front of you, B closes it
  await pull('left', 'x-button');
  check(await ev(`!!__ms.vrPage && __ms.vrPage.title.includes('Menu') && __ms.vrPanel.mesh.visible`), 'X opens the menu board');
  const inFront = await ev(`(() => { const m = __ms.vrPanel.mesh.position, h = __ms.head; return Math.hypot(m.x - h[0], m.z - h[2]) > 0.8 && Math.abs(m.y - h[1]) < 0.5; })()`);
  check(inFront, 'in front of you at head height');
  const aim = await ev(`(() => { const T = __ms.vrPanel, h = T.hits.find((x) => /Smooth/.test(x.b.label)); if (!h) return null;
    const u = (h.x + h.w / 2) / T.W, v = 1 - (h.y + h.h / 2) / T.H;
    return T.mesh.localToWorld(new T.mesh.position.constructor((u - 0.5) * 0.8, (v - 0.5) * 1.0, 0)).toArray(); })()`);
  if (check(!!aim, 'the menu has a Smooth turn button')){
    await pointAt(`new V(...${JSON.stringify(aim)})`); await nextFrame();
    await pg.screenshot({ path: path.join(OUT, '22-vr-menu.png'), timeout: 120000 });
    await pull();
    check(await ev('__ms.save.turn') === 'smooth', 'pointing and pulling the trigger on the menu works (smooth turning)');
  }
  await pull('right', 'b-button');
  check(!(await ev('__ms.vrPage')), 'B closes the menu');
  await ev('__ms.renderer.xr.getSession().end()'); await wait(500);
  check(await ev('__ms.mode') === 'title', 'leaving VR goes back to the title');
}

check(errors.length === 0, 'no errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
console.log(`${failures ? failures + ' FAILED' : 'all passed'} in ${Math.round((Date.now() - started) / 1000)} s; screenshots in ${OUT}`);
await browser.close(); server.close();
process.exit(failures ? 1 : 0);
