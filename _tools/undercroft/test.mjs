// Plays the Undercroft in headless Chromium with a fake controller, checks it, and takes screenshots.
//
//   NODE_PATH=$(npm root -g) node _tools/undercroft/test.mjs [outDir]      (SEED=n to pick the maze)
//
// Serves the repo the way Jekyll would publish it (front matter stripped, version filled in). Then:
//  - controls: A starts, the left stick walks, walls stop you, the right stick turns, the bag opens and equips
//  - fighting: a zombie hurts you, the sword kills it; eating heals; deep water kills you
//  - a whole level, played by a bot with the sticks and buttons (with damage switched off so the bot
//    can't lose): walk through every power gate, free every prisoner (one past the water, one in the
//    monster's hall), freeze the water to cross it, blow open the cracked wall with a bomb, open every
//    chest, and walk out up the stairs
//  - screenshots of the title, the start, a zombie, the monster, a power gate, a cell, the bag, ice, the
//    way out, and a view with the torch out (checked for brightness)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.resolve(process.argv[2] || 'undercroft-shots');
fs.mkdirSync(OUT, { recursive: true });

const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.html': 'text/html', '.glb': 'model/gltf-binary' };
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
const BASE = `http://127.0.0.1:${server.address().port}/experiments/undercroft/`;

let failures = 0;
const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) failures++; return ok; };

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
// a standard-mapping controller whose sticks and buttons the test sets through window.__pad
await ctx.addInitScript(() => {
  window.__pad = { axes: [0, 0, 0, 0], buttons: new Array(17).fill(0) };
  navigator.getGamepads = () => [{ id: 'Test controller (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard',
    timestamp: performance.now(), axes: window.__pad.axes.slice(),
    buttons: window.__pad.buttons.map((v) => ({ pressed: v > 0.5, touched: v > 0, value: v })) }];
});
const tab = await ctx.newPage();
const errors = [];
tab.on('pageerror', (e) => errors.push(String(e.stack || e)));
tab.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && m.text().includes('[undercroft]'))) errors.push(m.text()); });

const seed = process.env.SEED || '1';
await tab.goto(BASE + '?test&seed=' + seed);
await tab.waitForFunction(() => window.__uc && window.__uc.ready, null, { timeout: 240000 });
const shot = async (name) => { await tab.evaluate(() => window.__uc.render()); await tab.screenshot({ path: path.join(OUT, name + '.png') }); console.log('  shot ' + name); };
const ev = (fn, arg) => tab.evaluate(fn, arg);
await shot('01-title');
const version = await tab.textContent('.build-version');
check(/^v\d+\.\d+$/.test(version.trim()), `title shows the version (${version.trim()})`);

// ---------- the controller ----------
const none = () => new Array(17).fill(0);
const pad = (axes, buttons) => ev(([a, b]) => { window.__pad.axes = a; window.__pad.buttons = b; }, [axes, buttons || none()]);
const adv = (s, draw) => ev(([s, d]) => window.__uc.advance(s, d), [s, !!draw]);
const press = async (i, hold) => { const b = none(); b[i] = 1; await pad([0, 0, 0, 0], b); await adv(hold || 1 / 60); await pad([0, 0, 0, 0]); await adv(1 / 30); };
const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

await press(B.A);
check(await ev(() => window.__uc.state) === 'play', 'A on the controller starts the game');
await adv(0.5);
await shot('02-start');
check(await ev(() => document.querySelectorAll('#hearts .heart').length) === 5, 'five hearts on screen');

// walk and turn
const p0 = await ev(() => ({ ...window.__uc.player }));
await pad([0, -1, 0, 0]); await adv(1.2);
const p1 = await ev(() => ({ ...window.__uc.player }));
check(Math.hypot(p1.x - p0.x, p1.z - p0.z) > 1, 'left stick walks');
await adv(6);
check(!(await ev(() => window.__uc.solidAt(window.__uc.player.x, window.__uc.player.z))), 'walls stop you');
const y0 = await ev(() => window.__uc.player.yaw);
await pad([0, 0, 1, 0]); await adv(0.4); await pad([0, 0, 0, 0]);
check(await ev(() => window.__uc.player.yaw) < y0 - 0.3, 'right stick turns');

// the bag: Y opens it, the d-pad moves, A equips, B closes
await ev(() => window.__uc.give('spear'));
await press(B.Y);
check(await ev(() => window.__uc.state) === 'inv', 'Y opens the bag');
await press(B.RIGHT); await press(B.A);
await shot('03-bag');
check(await ev(() => window.__uc.inv.weapon) === 'spear', 'the bag equips the spear');
await press(B.B);
check(await ev(() => window.__uc.state) === 'play', 'B closes the bag');
await press(B.RB);
check(await ev(() => window.__uc.inv.weapon) === 'sword', 'RB swaps back to the sword');

// ---------- fighting ----------
const startTile = await ev(() => window.__uc.level.start);
const [sx, sz] = await ev((t) => window.__uc.center(t[0], t[1]), startTile);
const dir = await ev(() => window.__uc.level.startDir);
await ev(([x, z, d]) => { window.__uc.place(x, z, Math.atan2(-d[0], -d[1]), 0); }, [sx, sz, dir]);
await ev(([x, z, d]) => { const zb = window.__uc.spawnZombie(x + d[0] * 1.6, z + d[1] * 1.6, false); zb.aware = true; zb.yaw = Math.atan2(-d[0], -d[1]); window.__testZombie = zb; }, [sx, sz, dir]);
const hp0 = await ev(() => window.__uc.player.hp);
await adv(2.5);
const hp1 = await ev(() => window.__uc.player.hp);
check(hp1 < hp0, `a zombie hurts you (${hp0} → ${hp1} half-hearts)`);
await shot('04-zombie');
let swings = 0;
for (; swings < 12; swings++){
  if (await ev(() => window.__testZombie.state === 'dead')) break;
  // face it, then swing
  await ev(() => { const z = window.__testZombie; const p = window.__uc.player; p.yaw = Math.atan2(-(z.x - p.x), -(z.z - p.z)); });
  await press(B.RT); await adv(0.5);
}
check(await ev(() => window.__testZombie.state === 'dead'), `the sword kills a zombie (${swings} swings)`);
await adv(1.0);
await shot('05-zombie-down');
// eating
await ev(() => { window.__uc.give('bread'); });
const hpBefore = await ev(() => window.__uc.player.hp);
await press(B.X);
check(await ev(() => window.__uc.player.hp) > hpBefore, 'X eats and heals');

// ---------- a whole level, by a bot ----------
await ev(() => { window.__uc.god = true; window.__uc.tryAgain(); });
await adv(0.2);
const L = await ev(() => { const l = window.__uc.level; return { start: l.start, gates: l.gates, cells: l.cells, chests: l.chests, waterGate: l.waterGate, crackGate: l.crackGate, exit: l.exit, hall: l.hall }; });
console.log(`  level: ${L.gates.length} gates, ${L.cells.length} cells, ${L.chests.length} chests, water ${!!L.waterGate}, cracked wall ${!!L.crackGate}`);
let botTime = 0, botDied = false;
const tileNow = () => ev(() => window.__uc.tileOf(window.__uc.player.x, window.__uc.player.z));
// steer along the route with the sticks; fight anything that gets close
async function walkTo(target, opts){
  opts = opts || {};
  const from = await tileNow();
  const route = await ev(([f, t, o]) => window.__uc.path(f, t, o), [from, target, opts]);
  if (!route) return false;
  const pts = await ev((r) => r.map(([i, j]) => window.__uc.center(i, j)), route);
  if (opts.exact) pts.push(opts.exact);
  let wp = 1, t = 0, stuck = 0, last = null;
  while (wp < pts.length && t < 120){
    const st = await ev(() => { const p = window.__uc.player; const z = window.__uc.zombies.find((z) => z.state !== 'dead' && z.state !== 'emerge' && Math.hypot(z.x - p.x, z.z - p.z) < 2.2);
      return { x: p.x, z: p.z, yaw: p.yaw, zx: z ? z.x : null, zz: z ? z.z : null, state: window.__uc.state, inside: !!(window.__uc.shrine || window.__uc.trans) }; });
    if (st.inside){ await pad([0, 0, 0, 0]); return true; }
    if (st.state !== 'play'){ console.log('  bot: the game is in state ' + st.state + ' (' + await ev(() => window.__uc.player.cause) + ')'); botDied = true; return false; }
    let [tx, tz] = pts[wp];
    // about to step onto water that isn't frozen (or is about to thaw): freeze it first
    if (wp < route.length && await ev((t) => { const left = window.__uc.iceLeft(t[0], t[1]); return left !== null && left < 10; }, route[wp])){
      await pad([0, 0, 0, 0]);
      if (await selectPower('freeze')){ await press(B.LT); await adv(0.3); }
    }
    const near = Math.hypot(tx - st.x, tz - st.z);
    if (near < (wp === pts.length - 1 ? 0.35 : 0.6)){ wp++; continue; }
    const b = none(); let fwd = -1;
    if (st.zx !== null){ tx = st.zx; tz = st.zz; b[B.RT] = 1; fwd = 0;          // a zombie in the way: turn and fight it with the sword
      if (await ev(() => window.__uc.inv.weapon !== 'sword')) await ev(() => window.__uc.setWeapon('sword')); }
    const want = Math.atan2(-(tx - st.x), -(tz - st.z));
    let diff = want - st.yaw; while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
    if (Math.abs(diff) > 0.5) fwd = 0;
    b[B.LB + 6] = 0;
    if (!opts.walk) b[10] = 1;                                                 // left-stick click: hurry
    await pad([0, fwd, Math.max(-1, Math.min(1, -diff * 2.5)), 0], b);
    await adv(0.1); t += 0.1; botTime += 0.1;
    if (last && Math.hypot(last[0] - st.x, last[1] - st.z) < 0.01 && fwd) stuck++; else stuck = 0;
    last = [st.x, st.z];
    if (stuck > 30){ await pad([1, 0, 0, 0]); await adv(0.6); stuck = 0; }
  }
  await pad([0, 0, 0, 0]);
  return wp >= pts.length;
}
async function face(x, z){
  await ev(([x, z]) => { const p = window.__uc.player; p.yaw = Math.atan2(-(x - p.x), -(z - p.z)); p.pitch = 0; }, [x, z]);
}
async function selectPower(kind){
  for (let k = 0; k < 5; k++){ if (await ev((k) => window.__uc.inv.powers[window.__uc.inv.power] === k, kind)) return true; await press(B.LB); }
  return false;
}
// steering inside a shrine: no tile grid, straight lines between points chosen to miss the furniture
async function walkXY(target, opts){
  opts = opts || {};
  for (let t = 0; t < (opts.time || 25); t += 0.1){
    const st = await ev(() => { const p = window.__uc.player; return { x: p.x, z: p.z, yaw: p.yaw }; });
    const dx = target[0] - st.x, dz = target[1] - st.z;
    if (Math.hypot(dx, dz) < (opts.near || 0.18)) break;
    const want = Math.atan2(-dx, -dz);
    let diff = want - st.yaw; while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
    const b = none(); if (!opts.walk && Math.hypot(dx, dz) > 1) b[10] = 1;
    await pad([0, Math.abs(diff) < 0.4 ? -Math.min(1, Math.hypot(dx, dz) * 1.5 + 0.2) : 0, Math.max(-1, Math.min(1, -diff * 2.5)), 0], b);
    await adv(0.1);
  }
  await pad([0, 0, 0, 0]);
}
const until = async (fn, arg, secs) => { for (let t = 0; t < secs; t += 0.2){ if (await ev(fn, arg)) return true; await adv(0.2); } return false; };
async function solveShrine(kind){
  const S = await ev(() => { const s = window.__uc.shrine; return { ox: s.ox, oz: s.oz, path: s.path, cols: s.cols, rows: s.rows, order: s.order,
    levers: s.levers && s.levers.map((l) => [l.pos.x, l.pos.z, l.sym]), fires: s.fires && s.fires.map((f) => [f.pos.x, f.pos.z]),
    wheels: s.wheels && s.wheels.map((w) => [w.pos.x, w.pos.z, w.pair]) }; });
  const X = (i) => S.ox - 4.5 + i, Z = (j) => S.oz + 3.5 + j;
  if (kind === 'bomb'){
    // east along row 2 to column 8, north to row 7, then one west onto the plate
    const push = async (from, dir, done) => {
      await walkXY(from); await face(from[0] + dir[0] * 3, from[1] + dir[1] * 3);
      await pad([0, -0.8, 0, 0]); await until(done, null, 12); await pad([0, 0, 0, 0]); await adv(0.6);
    };
    await walkXY([X(1), S.oz + 2.6]);
    await push([X(1), Z(2)], [1, 0], () => window.__uc.shrine.block.i >= 8);
    await walkXY([X(7), Z(1)]);
    await push([X(8), Z(1)], [0, 1], () => window.__uc.shrine.block.j >= 7);
    await walkXY([X(9), Z(6)]);
    await push([X(9), Z(7)], [-1, 0], () => window.__uc.shrine.block.i <= 7);
    await until(() => window.__uc.shrine.doorOpen > 0.95, null, 4);
    await walkXY([S.ox + 0.5, S.oz + 11.8]);
  } else if (kind === 'magnet'){
    for (const [x, z] of S.fires){ await walkXY([x, z - 1.2]); await face(x, z); await press(B.A); }
    await until(() => window.__uc.shrine.doorOpen > 0.95, null, 4);
    await walkXY([S.ox, S.oz + 11.8]);
  } else if (kind === 'freeze'){
    await walkXY([S.ox, S.oz + 2.9]); await adv(2.7);                 // stand on the rune and watch
    await shot('06-shrine-freeze-reveal'); await adv(2.0);
    for (let r = 0; r < 4; r++) await walkXY([S.ox + S.cols[S.path[r]], S.oz + S.rows[r]], { walk: true, near: 0.3 });
    await walkXY([S.ox, S.oz + 12.2]);
  } else if (kind === 'flight'){
    // two wheels whose vents don't overlap set all four blowing
    const pick = [];
    for (let a = 0; a < 4 && !pick.length; a++) for (let b = a + 1; b < 4; b++){
      const cover = new Set([...S.wheels[a][2], ...S.wheels[b][2]]); if (cover.size === 4){ pick.push(S.wheels[a], S.wheels[b]); break; } }
    for (const [x, z] of pick){ await walkXY([x, z - 0.5]); await face(x, z + 1); await press(B.A); await adv(0.5); }
    await walkXY([S.ox, S.oz + 2.6]); await adv(1.5);
    await shot('06-shrine-flight-wind');
    await walkXY([S.ox, S.oz + 12.2], { walk: true, near: 0.3 });
  } else {
    for (const sym of S.order){ const [x, z] = S.levers.find((l) => l[2] === sym); await walkXY([x, z - 0.9]); await face(x, z + 1); await press(B.A); await adv(0.3); }
    await until(() => window.__uc.shrine.doorOpen > 0.95, null, 4);
    await walkXY([S.ox, S.oz + 11.8]);
  }
}
const shrineShots = {};
// 1. every power gate, and the shrine behind it
let shotGate = false;
for (const g of L.gates){
  if (!shotGate){
    // a look at a gate before walking through it
    const route = await ev(([f, t]) => window.__uc.path(f, t), [await tileNow(), g.tile]);
    if (route && route.length > 2){ await walkTo(route[route.length - 2]); const c = await ev((t) => window.__uc.center(t[0], t[1]), g.tile); await face(c[0], c[1]); await adv(0.2); await shot('06-power-gate'); shotGate = true; }
  }
  await walkTo(g.tile);
  await adv(1.2);
  const kind = await ev(() => window.__uc.shrine && window.__uc.shrine.kind);
  if (!check(kind === g.kind, `walking through the ${g.kind} gate takes you into its shrine`)) continue;
  if (!shrineShots[kind]){ await adv(0.3); await shot('06-shrine-' + kind); shrineShots[kind] = true; }
  await solveShrine(kind);
  check(await ev(() => window.__uc.shrine && window.__uc.shrine.solved), `the ${kind} shrine's trial can be solved with the controller`);
  await shot('06-shrine-' + kind + '-solved');
  // through the opened door to the altar, take the power, and be carried back out
  await walkXY(await ev(() => [window.__uc.shrine.ox, window.__uc.shrine.oz + 15.6]));
  await face(...await ev(() => [window.__uc.shrine.ox, window.__uc.shrine.oz + 17]));
  await press(B.A); await adv(5.5);
  check(!(await ev(() => window.__uc.shrine)) && await ev((k) => window.__uc.inv.powers.includes(k), kind), `taking the ${kind} power from the altar brings you back out with it`);
}
check(await ev(() => window.__uc.inv.powers.length) === L.gates.length, `the shrines give all their powers (${await ev(() => window.__uc.inv.powers.join(', '))})`);
// 2. the prisoners. The one past the water needs the ice.
async function freeCell(c){
  const ok = await walkTo(c.from, { water: true });
  if (botDied) return false;
  const door = await ev((c) => window.__uc.world.cells.find((w) => w.tile[0] === c.tile[0] && w.tile[1] === c.tile[1]).door, c);
  await face(door.x, door.z);
  const b = none(); b[B.A] = 1; await pad([0, 0, 0, 0], b); await adv(1.3); await pad([0, 0, 0, 0]); await adv(0.6);
  return ok;
}
const freedBefore = () => ev(() => window.__uc.stats.freed);
if (L.waterGate){
  // walk up to the water, freeze it, cross
  const route = await ev(([f, t]) => window.__uc.path(f, t, { water: true }), [await tileNow(), L.waterGate]);
  await walkTo(route[route.length - 2]);
  const c = await ev((t) => window.__uc.center(t[0], t[1]), L.waterGate); await face(c[0], c[1]);
  await shot('07-water');
  await selectPower('freeze'); await press(B.LT); await adv(1.0);
  check(await ev((t) => window.__uc.world.water.get(t[1] * window.__uc.level.W + t[0]).frozenUntil > 0, L.waterGate), 'LT with the freeze power freezes the water');
  await shot('08-ice');
}
for (const c of L.cells){
  const before = await freedBefore();
  await freeCell(c);
  if (c === L.cells[0]) await shot('09-cell-opened');
  check(await freedBefore() === before + 1, `holding A at the bars frees the prisoner at ${c.tile}`);
}
check(await ev(() => window.__uc.world.portcullis.open), 'freeing everyone opens the gate to the stairs');
// 3. the cracked wall: throw a bomb, step back, blow it
if (L.crackGate){
  const route = await ev(([f, t]) => window.__uc.path(f, t, { crack: true, water: true }), [await tileNow(), L.crackGate]);
  await walkTo(route[route.length - 2], { water: true });
  const c = await ev((t) => window.__uc.center(t[0], t[1]), L.crackGate); await face(c[0], c[1]);
  await shot('10-cracked-wall');
  await selectPower('bomb'); await ev(() => { window.__uc.player.pitch = -0.25; }); await press(B.LT); await adv(1.6);
  await pad([0, 1, 0, 0]); await adv(1.0); await pad([0, 0, 0, 0]);
  await press(B.LT); await adv(0.15);
  await shot('11-explosion');
  await adv(1.5);
  check(await ev(() => window.__uc.world.cracked.broken), 'a bomb breaks the cracked wall');
}
// 4. every chest
for (const ch of L.chests){
  await walkTo(ch.tile, { water: true, crack: true });
  const pos = await ev((t) => window.__uc.world.chests.find((c) => Math.floor(c.pos.x / window.__uc.TILE) === t[0] && Math.floor(c.pos.z / window.__uc.TILE) === t[1]).pos, ch.tile);
  if (botDied) break;
  await face(pos.x, pos.z); await press(B.A); await adv(0.4);
}
const weapons = await ev(() => Object.keys(window.__uc.inv.weapons));
check(weapons.length === 4, `chests hold the other weapons (${weapons.join(', ')})`);
// 5. the monster
const beastShots = await ev(() => { const b = window.__uc.beast; return { x: b.x, z: b.z }; });
const hallTile = L.hall.centre;
await walkTo([L.hall.x0, L.hall.x0], { water: true, crack: true });
await face(beastShots.x, beastShots.z); await ev(() => { window.__uc.player.pitch = 0.35; }); await adv(1.5);
await shot('12-monster');
// make it breathe fire right now, and look
await ev(() => { const b = window.__uc.beast; if (!b.dead){ b.aware = true; b.state = 'inhale'; b.t = 0; } });
await adv(1.4);
await shot('12-monster-fire');
await adv(1.5);
// a litter of little zombies
await ev(() => { const p = window.__uc.player; for (let k = 0; k < 3; k++){ const a = p.yaw + (k - 1) * 0.35; const z = window.__uc.spawnZombie(p.x - Math.sin(a) * 2.6, p.z - Math.cos(a) * 2.6, false, true); z.aware = true; } });
await adv(0.8);
await shot('12-mini-zombies');
await adv(4);
// 6. out
const won = await walkTo(L.exit.landing, { water: true, crack: true });
await adv(0.5);
check(await ev(() => window.__uc.state) === 'won', `the bot finished the level (${botTime.toFixed(0)} s of play, state ${await ev(() => window.__uc.state)})`);
await shot('13-won');

// ---------- the torch out: still visible ----------
await ev(() => { window.__uc.god = false; window.__uc.tryAgain(); window.__uc.torch(false); });
await adv(0.5);
const brightness = await ev(() => { const src = document.querySelector('canvas'), c = document.createElement('canvas');
  c.width = 160; c.height = 90; const g = c.getContext('2d'); window.__uc.render(); g.drawImage(src, 0, 0, 160, 90);
  const d = g.getImageData(0, 0, 160, 90).data; let s = 0; for (let k = 0; k < d.length; k += 4) s += 0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2]; return s / (d.length / 4); });
check(brightness > 10, `without the torch you can still see (mean brightness ${brightness.toFixed(1)})`);
await ev(() => window.__uc.torch(true));
// ---------- flight ----------
await ev(() => { window.__uc.tryAgain(); window.__uc.give('flight'); });
await adv(0.5);
await press(B.LT); await adv(2.5);
check(await ev(() => window.__uc.pw.flying && window.__uc.player.y > 1.62 + 0.8), `LT with the flight power lifts you off the ground (eye at ${(await ev(() => window.__uc.player.y)).toFixed(2)} m)`);
{
  const d = await ev(() => window.__uc.level.startDir), hp = await ev(() => window.__uc.player.hp);
  await ev((d) => { const p = window.__uc.player; const z = window.__uc.spawnZombie(p.x + d[0] * 1.0, p.z + d[1] * 1.0, false); z.aware = true; window.__testZombie = z; }, d);
  await adv(3);
  await shot('15-flying-over-a-zombie');
  check(await ev(() => window.__uc.player.hp) === hp, 'zombies can\'t reach you while you fly');
}
if (L.waterGate){
  const [wx, wz] = await ev((t) => window.__uc.center(t[0], t[1]), L.waterGate);
  await ev(([x, z]) => { window.__uc.place(x, z); window.__uc.player.y += 1.1; }, [wx, wz]); await adv(2);
  check(await ev(() => window.__uc.state) === 'play', 'flying over deep water is safe');
  await ev(() => { window.__uc.pw.flyT = 0.2; }); await adv(2);
  check(await ev(() => window.__uc.pw.flying && window.__uc.state === 'play'), 'when the minute is up over water you keep flying until solid ground');
}
await ev(() => { const [x, z] = window.__uc.center(...window.__uc.level.start); window.__uc.place(x, z); window.__uc.player.y += 1.1; window.__uc.pw.flyT = Math.min(window.__uc.pw.flyT, 0.2); }); await adv(2.5);
check(await ev(() => !window.__uc.pw.flying && window.__uc.player.y < 1.62 + 0.15), 'you land when the minute is up');
await press(B.LT); await adv(0.3);
check(await ev(() => !window.__uc.pw.flying), 'you can\'t fly again straight away');
await ev(() => { const p = window.__uc.player; for (let k = 0; k < 4; k++){ const z = window.__uc.spawnZombie(p.x + 0.5, p.z, false); window.__uc.hurtZombie(z, 99, p, 0); } });
await press(B.LT); await adv(0.3);
check(await ev(() => window.__uc.pw.flying), 'defeating 4 zombies lets you fly again');
// ---------- deep water kills ----------
if (L.waterGate){
  const [wx, wz] = await ev((t) => window.__uc.center(t[0], t[1]), L.waterGate);
  await ev(([x, z]) => window.__uc.place(x, z), [wx, wz]); await adv(3);
  check(await ev(() => window.__uc.state) === 'dead', 'walking into deep water kills you');
  await shot('14-drowned');
}
console.log('  render', JSON.stringify(await ev(() => window.__uc.info())));
check(errors.length === 0, 'no errors in the console' + (errors.length ? ':\n    ' + errors.slice(0, 8).join('\n    ') : ''));
await browser.close();
server.close();
console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
