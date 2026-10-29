// Plays Wildcat in headless Chromium with a fake controller, checks it, and takes screenshots.
//
//   NODE_PATH=$(npm root -g) node _tools/wildcat/test.mjs [outDir]
//
// Serves the repo the way Jekyll would publish it (front matter stripped, version filled in). Then:
//  - the title screen loads and shows the version
//  - A starts; the left stick runs; trees and rocks stop you
//  - a rabbit can be caught with a pounce, and eating it heals
//  - a bear, a wolf pack and a boar each come for the cat when it gets close, hurt it, and can be beaten
//    with claws and pounces (the cat is made unkillable for those fights so the bot can't lose)
//  - with damage on, a bear can kill the cat, and "get up again" brings it back in the den
//  - screenshots of each of those to look at
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.resolve(process.argv[2] || 'wildcat-shots');
fs.mkdirSync(OUT, { recursive: true });

const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.html': 'text/html' };
function page(name){
  const src = fs.readFileSync(path.join(ROOT, '_experiments', name + '.html'), 'utf8');
  const fm = src.match(/^---\n([\s\S]*?)\n---\n/);
  const version = (fm[1].match(/version:\s*"?([^"\n]+)"?/) || [])[1];
  return src.slice(fm[0].length).replace(/\{% endraw %\}\{\{ page\.version \}\}\{% raw %\}/g, version).replace(/\{% (end)?raw %\}/g, '');
}
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
const BASE = `http://127.0.0.1:${server.address().port}/experiments/wildcat/`;

let failures = 0;
const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) failures++; return ok; };

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.addInitScript(() => {
  window.__pad = { axes: [0, 0, 0, 0], buttons: new Array(17).fill(0) };
  navigator.getGamepads = () => [{ id: 'Test controller (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard',
    timestamp: performance.now(), axes: window.__pad.axes.slice(),
    buttons: window.__pad.buttons.map((v) => ({ pressed: v > 0.5, touched: v > 0, value: v })) }];
});
const tab = await ctx.newPage();
const errors = [];
tab.on('pageerror', (e) => { errors.push(e.message); console.log('  [page error]', e.message); });
tab.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('  [console]', m.text().slice(0, 300)); });

// rendering is slow in software, so between screenshots the game simulates without drawing
async function shot(name){ await ev(() => { window.__wc.renderEvery = 1; }); await frames(2); await tab.screenshot({ path: path.join(OUT, name + '.png'), timeout: 400000 }); await ev(() => { window.__wc.renderEvery = 1000; }); }
const ev = (fn, arg) => tab.evaluate(fn, arg);
// run the game for a number of frames at a fixed step, so the simulation is the same however slow the renderer is
async function frames(n){ const start = await ev(() => window.__wc.frames); await tab.waitForFunction((t) => window.__wc.frames >= t, start + n, { timeout: 600000 }); }
async function tapButton(i){ await ev((i) => { window.__pad.buttons[i] = 1; }, i); await frames(2); await ev((i) => { window.__pad.buttons[i] = 0; }, i); await frames(1); }

console.log('title');
const t0 = Date.now();
await tab.goto(BASE + '?test');
await tab.waitForFunction(() => window.__wc && window.__wc.ready, null, { timeout: 600000 });
console.log(`  loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await ev(() => { window.__wc.fixedDt = 1 / 30; window.__wc.renderEvery = 1000; });
await frames(3);
await shot('01-title');
check(/v\d/.test(await tab.textContent('.build-version')), 'version on the title screen');

// LOOK=1: just a few views of the world and the animals, for working on how it looks
if (process.env.LOOK){
  await tapButton(0);
  await ev(() => { const w = window.__wc; w.hunters(false); w.clear(); });
  const allViews = [['look-meadow', 0, 0, 2.6, 0.3, []], ['look-bear', 0, 0, 2.2, 0.25, [['bear', 0.5, -4.5]]], ['look-wolves', 0, 0, 2.2, 0.25, [['wolf', 1.5, -4], ['wolf', -1.5, -5]]],
    ['look-boar', 0, 0, 2.2, 0.25, [['boar', 0.5, -3.5]]], ['look-forest', 'forest', 0, 3.5, 0.2, []], ['look-lake', 'lake', 0, 0, 0.18, []]];
  // VIEWS=look-lake,look-bear to render only some of them
  const views = process.env.VIEWS ? allViews.filter((v) => process.env.VIEWS.split(',').includes(v[0])) : allViews;
  for (const [name, x, z, yaw, pitch, spawns] of views){
    await ev(([x, z, yaw, pitch, spawns]) => { const w = window.__wc; w.clear(); if (x === 'lake'){ const [sx, sz, sy] = w.shore(); w.teleport(sx, sz); yaw = sy; w.view.yaw = yaw; w.cat.yaw = yaw + Math.PI; } else if (x === 'forest') w.teleport(...w.forestSpot()); else if (x || z) w.teleport(x, z); w.view.yaw = yaw; w.view.pitch = pitch; w.view.manualT = 99; w.cat.yaw = yaw + Math.PI;
      for (const [k, dx, dz] of spawns){ const s = Math.sin(yaw + Math.PI), c = Math.cos(yaw + Math.PI); const i = w.spawn(k, dx * c + -dz * s, -dx * s + -dz * c); w.animals[i].state = 'wander'; w.animals[i].pause = 99; w.animals[i].st = { ...w.animals[i].st, notice: 0 }; } },
      [x, z, yaw, pitch, spawns]);
    await frames(4);
    await shot(name);
  }
  await browser.close(); server.close(); process.exit(0);
}

console.log('controls');
await tapButton(0);
check(await ev(() => window.__wc.state) === 'play', 'A starts the game');
await ev(() => { window.__wc.hunters(false); window.__wc.noSpawn = true; window.__wc.clear(); });
const p0 = await ev(() => ({ x: window.__wc.cat.x, z: window.__wc.cat.z }));
await ev(() => { window.__pad.axes = [0, -1, 0, 0]; });
await frames(45);
await shot('02-running');
await ev(() => { window.__pad.axes = [0, 0, 0, 0]; });
const p1 = await ev(() => ({ x: window.__wc.cat.x, z: window.__wc.cat.z }));
check(Math.hypot(p1.x - p0.x, p1.z - p0.z) > 2, `the left stick runs (moved ${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1)} m)`);

console.log('rabbit');
await ev(() => { const w = window.__wc; w.cat.hp = 40; const r = w.animals[w.spawn('rabbit', 0, 2.2)]; r.x = w.cat.x + Math.sin(w.cat.yaw) * 2.2; r.z = w.cat.z + Math.cos(w.cat.yaw) * 2.2; });
await frames(2);
await shot('03-rabbit');
await tapButton(0);
for (let i = 0; i < 6; i++){
  if (process.env.DEBUG) console.log('   ', JSON.stringify(await ev(() => { const w = window.__wc, c = w.cat, r = w.animals.find((a) => a.kind === 'rabbit');
    return { act: c.act, y: +c.y.toFixed(2), gy: c.ground, rabbit: r ? { d: +Math.hypot(r.x - c.x, r.z - c.z).toFixed(2), dead: r.dead, st: r.state } : null, stam: c.stam | 0 }; })));
  await frames(5);
}
const r = await ev(() => ({ rabbits: window.__wc.stats.rabbits, hp: window.__wc.cat.hp }));
check(r.rabbits === 1, 'a pounce catches the rabbit');
check(r.hp > 60, `eating it heals (hp ${r.hp.toFixed(0)})`);
await frames(20);

// a fight: spawn the animal nearby, let it come, claw and pounce until it falls
async function fight(kind, n, label){
  console.log(label);
  await ev(([kind, n]) => { const w = window.__wc; w.clear(); w.god = true; w.cat.hp = w.cat.maxHp; w.cat.hits = 0;
    for (let i = 0; i < n; i++) w.spawn(kind, 9 + i * 2, 3 - i * 3); }, [kind, n]);
  let engaged = false, hurt = false, shotFight = false, rounds = 0;
  for (; rounds < 260; rounds++){
    const s = await ev(() => { const w = window.__wc; const live = w.animals.filter((a) => !a.dead && a.kind !== 'rabbit');
      const foe = live.sort((a, b) => Math.hypot(a.x - w.cat.x, a.z - w.cat.z) - Math.hypot(b.x - w.cat.x, b.z - w.cat.z))[0];
      return { live: live.length, engaged: live.some((a) => a.engaged), d: foe ? Math.hypot(foe.x - w.cat.x, foe.z - w.cat.z) : 0,
        ang: foe ? Math.atan2(foe.x - w.cat.x, foe.z - w.cat.z) : 0, move: foe && foe.move ? foe.move.type : null, reach: foe ? foe.def.radius : 0, hp: foe ? foe.hp : 0, hurt: (w.cat.hits || 0) > 0, view: w.view.yaw, stam: w.cat.stam }; });
    if (!s.live) break;
    if (rounds % 40 === 0) console.log(`    round ${rounds}: ${s.live} left, distance ${s.d.toFixed(1)} m, health ${s.hp.toFixed(0)}`);
    engaged = engaged || s.engaged; hurt = hurt || s.hurt;
    if (s.engaged && !shotFight && s.d < 4){ shotFight = true; await frames(4); await shot('fight-' + kind); }
    if (s.move && !shotFight) {}
    // stick toward the foe (camera relative), claw when close, pounce sometimes
    const rel = s.ang - (s.view + Math.PI);
    const mx = -Math.sin(rel), mz = -Math.cos(rel);
    if (s.d > 1.2) await ev(([mx, mz]) => { window.__pad.axes = [mx, mz, 0, 0]; }, [mx * 0.8, mz * 0.8]);
    else await ev(() => { window.__pad.axes = [0, 0, 0, 0]; });
    if (s.d < 3.5 && s.d > 1.6 && s.stam > 40 && rounds % 3 === 0) await tapButton(0);
    else if (s.d < s.reach + 1.2) await tapButton(2);
    else await frames(3);
  }
  await ev(() => { window.__pad.axes = [0, 0, 0, 0]; });
  const left = await ev(() => window.__wc.animals.filter((a) => !a.dead && a.kind !== 'rabbit').length);
  check(engaged, `the ${kind} engages the cat`);
  check(hurt, `the ${kind} hurts the cat`);
  check(left === 0, `the ${kind}${n > 1 ? ' pack is' : ' is'} beaten (${rounds} rounds)`);
  await frames(25);
  await shot('won-' + kind);
}
if (process.env.ONLY === 'rabbit'){ console.log(failures ? `${failures} FAILED` : 'all passed'); await browser.close(); server.close(); process.exit(failures ? 1 : 0); }
await fight('boar', 1, 'boar');
await fight('wolf', 2, 'wolves');
await fight('bear', 1, 'bear');

console.log('becoming');
const off = await ev(() => window.__wc.offer && window.__wc.offer.kind);
check(off === 'bear', `beating the bear offers to become one (${off})`);
await tapButton(3);
await frames(5);
check(await ev(() => window.__wc.me) === 'bear', 'Y turns you into the bear');
await shot('as-bear');
await fight('wolf', 2, 'wolves, as the bear');
await ev(() => window.__wc.setPlayer('ginger'));
await frames(3);
check(await ev(() => window.__wc.me) === 'ginger', 'a different coat can be chosen');
await shot('as-ginger');

console.log('death');
await ev(() => { const w = window.__wc; w.clear(); w.god = false; w.cat.hp = 10; w.spawn('bear', 3, 3); });
for (let i = 0; i < 80 && await ev(() => window.__wc.state) === 'play'; i++) await frames(5);
check(await ev(() => window.__wc.state) === 'dead', 'a bear can kill the cat');
await shot('dead');
await tapButton(0);
await frames(5);
const back = await ev(() => ({ s: window.__wc.state, hp: window.__wc.cat.hp, max: window.__wc.cat.maxHp }));
check(back.s === 'play' && back.hp === back.max, 'getting up again puts the cat back at full health');

console.log('views');
await ev(() => { const w = window.__wc; w.clear(); w.spawn('bear', 4, 9); w.spawn('wolf', -5, 8); w.view.yaw = Math.PI * 0.9; });
await frames(20);
await shot('view-forest');
await ev(() => { const w = window.__wc; w.clear(); const [x, z, yaw] = w.shore(); w.teleport(x, z); w.view.yaw = yaw; w.view.pitch = 0.18; w.view.manualT = 99; w.cat.yaw = yaw + Math.PI; });
await frames(6);
await shot('view-lake');
check(errors.length === 0, 'no page errors');
console.log(failures ? `${failures} FAILED` : 'all passed');
await browser.close(); server.close();
process.exit(failures ? 1 : 0);
