// Plays Fantasy Theme Park in headless Chromium, checks it, and saves screenshots.
//
//   npm i --prefix _tools/vr-test iwer        (once; the VR part uses Meta's emulated Quest 3)
//   NODE_PATH=$(npm root -g) node _tools/fantasy-theme-park/test.mjs [outDir] [--full]
//
// Quick by default: the loading screen, the title and version, making and naming a park, laying paths
// (a line, a plaza, a queue, a bridge over new water), planting and placing things (and being refused
// where they can't go), shaping the land, a land with its arch, a car park, undo and redo, renaming the
// park, saving and opening it again, walking, memory staying flat while things come and go, and VR (the
// tablet, building with the laser, life-size). --full adds every land type and a night tour.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { serve, version } from './serve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const FULL = process.argv.includes('--full');
const OUT = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || 'fantasy-theme-park-shots');
fs.mkdirSync(OUT, { recursive: true });
let IWER = null;
try { IWER = fs.readFileSync(require.resolve('iwer/build/iwer.min.js', { paths: [HERE, path.join(HERE, '../vr-test'), ...(process.env.NODE_PATH || '').split(':')] }), 'utf8'); }
catch (e) { console.log('(IWER not installed: skipping the VR part. npm i --prefix _tools/vr-test iwer)'); }

const VERSION = version('fantasy-theme-park');
const { server, base } = await serve();
const BASE = base('fantasy-theme-park');
let failures = 0;
const T0 = Date.now();
const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what + `  [${Math.round((Date.now() - T0) / 1000)}s]`); if (!ok) failures++; return ok; };
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1024, height: 700 } });
if (IWER) await ctx.addInitScript({ content: IWER + `
;window.__iwer = new IWER.XRDevice(IWER.metaQuest3, { stereoEnabled: false });
window.__iwer.installRuntime({ forceInstall: true });
` });
await ctx.addInitScript({ content: 'window.__ftpNoRender = true;' });
const pg = await ctx.newPage();
const errors = [];
pg.on('pageerror', (e) => errors.push(e.message + ' ' + (e.stack || '').split('\n').slice(1, 4).join(' ')));
pg.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
pg.on('dialog', (d) => d.accept());
const ev = (s, a) => pg.evaluate(s, a);
const wait = (ms) => pg.waitForTimeout(ms);
const shot = async (name) => { await ev('__ftp.noRender = false'); await wait(700); await pg.screenshot({ path: path.join(OUT, name + '.png'), timeout: 120000 }); await ev('__ftp.noRender = true'); };
const started = Date.now();
const ready = () => pg.waitForFunction('window.__ftp && document.getElementById("loading").style.display === "none"', null, { timeout: 180000 });
// drive a tool with points on the ground, as a finger would
const stroke = (pts, dt = 0) => ev(async ([pts, dt]) => {
  const A = window.__ftp, T = A.tools, P = (p) => ({ x: p[0], z: p[1], y: A.surfaceAt(p[0], p[1]) });
  T.down(P(pts[0])); for (const p of pts.slice(1)){ T.move(P(p)); if (dt) T.frame(dt); }
  T.up(P(pts[pts.length - 1]));
}, [pts, dt]);
const count = (type) => ev((t) => __ftp.park.s.objects.filter((o) => o.type === t).length, type);
const pathCells = () => ev(() => __ftp.park.s.path.reduce((a, v) => a + (v ? 1 : 0), 0));

console.log('Fantasy Theme Park ' + VERSION + (FULL ? ' (full)' : ' (quick: --full for more)'));
await pg.goto(BASE);
await ready().catch((e) => { console.log('the game did not start:', errors.join(' | ')); throw e; });
check((await pg.textContent('.build-version')).includes(VERSION), 'title shows version ' + VERSION);
{ const { checkLoading } = await import('../loading-check.mjs'); await checkLoading({ browser, url: BASE, check, main: pg, game: '__ftp', shot: path.join(OUT, '00-loading.png') }); }
check(await ev('__ftp.mode') === 'title' && await ev('__ftp.demo'), 'the title shows a park behind it (not saved)');
check(await ev(`getComputedStyle(document.getElementById('b-continue')).display === 'none'`), 'no Continue button before there are parks');
await shot('01-title');

// (reported: the ground under the entrance flickered: a strip of the gateway's wall lay across the opening at path height)
check(await ev(`(() => { const g = __ftp.objects.structs.get(__ftp.park.s.objects.find((o) => o.type === 'gate').id); let bad = 0;
  g.traverse((m) => { if (!m.isMesh || !m.geometry.index) return; const p = m.geometry.attributes.position, ix = m.geometry.index.array;
    for (let k = 0; k < ix.length; k += 3){ const ys = [0, 1, 2].map((q) => p.getY(ix[k + q])), xs = [0, 1, 2].map((q) => p.getX(ix[k + q]));
      const zs = [0, 1, 2].map((q) => p.getZ(ix[k + q])), ux = xs[1] - xs[0], uz = zs[1] - zs[0], vx = xs[2] - xs[0], vz = zs[2] - zs[0], ny = uz * vx - ux * vz;
      if (ny > 1e-6 && Math.max(...ys) < 0.02 && Math.min(...ys) > -0.02 && Math.max(...xs.map(Math.abs)) < 3.15) bad++; } });
  return bad === 0; })()`), 'nothing lies across the entrance\'s opening at path height (no flicker)');
// ---------- a new park ----------
await pg.click('#b-new'); await wait(300);
check(await ev(`document.getElementById('newpark').classList.contains('show')`) && (await pg.inputValue('#np-name')).length > 3, 'New park suggests a name');
await pg.fill('#np-name', ''); await pg.click('#np-go'); await wait(200);
check((await pg.textContent('#np-msg')).includes('name'), 'a park needs a name');
await pg.fill('#np-name', 'Test Kingdom'); await pg.click('[data-land="meadow"]'); await pg.click('[data-mode="sandbox"]'); await pg.click('#np-go');
await pg.waitForFunction('__ftp.mode === "build" && !__ftp.demo', null, { timeout: 60000 });
check(true, 'Build it opens the new park');
await wait(1500);
check((await ev('(async () => (await (await import("/experiments/fantasy-theme-park/js/store.js?v=' + VERSION + '")).listParks()).length)()')) === 1, 'the park is saved on the device');
check(await ev('__ftp.park.s.name') === 'Test Kingdom' && await count('gate') === 1 && await count('lot') === 1, 'it starts with its entrance and a car park');
if (FULL) await shot('02-new-park');
await ev('__ftp.noRender = true');

const gz = await ev('__ftp.park.s.objects.find((o) => o.type === "gate").z');
// ---------- paths ----------
await ev(`__ftp.ui.act('tab:paths'); __ftp.ui.act('pmode:line')`);
check(await ev('__ftp.tools.kind') === 'path' && await ev(`document.querySelectorAll('#tray .card').length`) === 8, 'the Paths tray shows the surfaces');
const trees0 = await ev('__ftp.park.s.objects.length');
let cells = await pathCells();
await stroke([[0, gz - 26], [0, gz - 120]]);
const c1 = await pathCells();
check(c1 - cells >= 90, `a straight path is laid (${c1 - cells} cells)`);
await ev(`__ftp.ui.act('pmode:area'); __ftp.ui.act('surf:3')`);
await stroke([[-14, gz - 120], [14, gz - 140]]);
check(await pathCells() - c1 > 100, 'a plaza is laid');
await ev(`__ftp.ui.act('pmode:brush'); __ftp.ui.act('surf:1'); __ftp.ui.act('queue')`);
await stroke([[20, gz - 130], [40, gz - 130], [40, gz - 120]]);
check(await ev(`__ftp.park.s.pflags.some((f) => f & 1)`), 'a queue line is laid');
// water, then a path across it: a bridge
await ev(`__ftp.ui.act('tab:terrain'); __ftp.ui.act('wmode:add'); __ftp.ui.act('size:10')`);
await stroke([[-60, gz - 70], [-80, gz - 70]]);
const wl = await ev(`__ftp.park.waterAt(-70, ${gz - 70})`);
check(!Number.isNaN(wl), 'water can be added (it digs its own bed)');
check(await ev(`__ftp.park.groundAt(-70, ${gz - 70})`) < wl - 0.5, 'the bed is below the water');
await ev(`__ftp.ui.act('tab:paths'); __ftp.ui.act('pmode:line')`);
await stroke([[-40, gz - 70], [-100, gz - 70]]);
check(await ev(`__ftp.park.pathHeight(-70, ${gz - 70})`) > wl + 0.5, 'a path over the water becomes a bridge above it');
await ev('__ftp.focus(-70, ' + (gz - 70) + ', 50); __ftp.want.pitch = 0.35; __ftp.want.yaw = 0.6');
if (FULL) await shot('03-bridge');

// (reported: painting water up a slope carved a trench with walls and no water in it)
{
  // raise a hill to paint up
  await ev(`__ftp.ui.act('tab:terrain'); __ftp.ui.act('tmode:raise'); __ftp.ui.act('size:16')`);
  await stroke([[130, gz - 170], [130, gz - 170]], 2.0);
  const up = [130, gz - 140, gz - 172];
  if (up){
    await ev(`__ftp.ui.act('tab:terrain'); __ftp.ui.act('wmode:add'); __ftp.ui.act('size:6')`);
    const pts = []; for (let k = 0; k <= 12; k++) pts.push([up[0], up[1] + (up[2] - up[1]) * k / 12]);
    await stroke(pts);
    const r = await ev(`(() => { const P = __ftp.park; let deep = 0, dry = 0, wet = 0; for (const [x, z] of ${JSON.stringify(pts)}){ const w = P.waterAt(x, z), g = P.groundAt(x, z); if (Number.isNaN(w)) dry++; else { wet++; deep = Math.max(deep, w - g); } } return { deep, dry, wet }; })()`);
    check(r.wet > 0 && r.deep < 2.2, `water painted up a hill fills the low end, level (${r.wet} wet, deepest ${r.deep.toFixed(1)} m)`);
    check(r.dry > 0 && (await ev(`document.getElementById('toasts').textContent`)).includes("can't climb"), 'and stops where the hill rises, saying why (no trench)' + (r.dry ? '' : ' ' + await ev(`${JSON.stringify(pts)}.map(([x, z]) => __ftp.park.groundAt(x, z).toFixed(1)).join(' ')`)));
  }
}
// ---------- trees and things ----------
const place = (type, x, z) => ev(([t, x, z]) => { const A = __ftp; A.tools.set('place', { type: t }); A.tools.down({ x, z, y: 0 }); A.tools.up({ x, z, y: 0 }); }, [type, x, z]);
let n = await count('oak');
await place('oak', 30, gz - 60);
check(await count('oak') === n + 1, 'a tree can be planted' + (await count('oak') === n + 1 ? '' : ` (${await count('oak') - n}; ${await ev('__ftp.ui.toasts.map((t) => t.text).join(" / ")')})`));
await place('oak', 0, gz - 60);
check(await count('oak') === n + 1 && (await ev(`document.getElementById('toasts').textContent`)).includes('path'), 'a tree can\'t go on a path, and it says why');
n = await count('lamp1');
await place('lamp1', 2.6, gz - 60); await place('bench', -2.6, gz - 62); await place('bedRed', 10, gz - 130); await place('fountain', 0, gz - 130);
check(await count('lamp1') === n + 1 && await count('bench') === 1 && await count('fountain') >= 2, 'lamps, benches and fountains go on paths');
check(await ev(`__ftp.park.s.objects.length`) < trees0 + 20, 'trees in the way of the paths were cleared');
await ev(`__ftp.tools.set('place', { type: 'oak', scatter: true })`);
n = await count('oak');
await stroke([[60, gz - 60], [70, gz - 70], [80, gz - 60], [90, gz - 70], [100, gz - 60]]);
check(await count('oak') > n + 1, `scatter plants a wood (${await count('oak') - n} oaks)`);
await ev(`__ftp.tools.set('fence', { type: 'railing' })`);
await stroke([[-20, gz - 40], [-10, gz - 40], [-5, gz - 46]]);
check(await count('fence_railing') === 1, 'a fence is drawn from one point to another');

// ---------- the land ----------
const h0 = await ev(`__ftp.park.groundAt(80, ${gz - 160})`);
await ev(`__ftp.ui.act('tab:terrain'); __ftp.ui.act('tmode:raise')`);
await stroke([[80, gz - 160], [80, gz - 160]], 1.0);
check(await ev(`__ftp.park.groundAt(80, ${gz - 160})`) > h0 + 1, 'holding Raise raises the ground');
const oakOnHill = await ev(`(() => { const o = __ftp.park.s.objects.find((o) => o.type === 'oak' && Math.hypot(o.x - 80, o.z - ${gz - 160}) < 4); return o ? o.id : null; })()`);
void oakOnHill;
await ev(`__ftp.ui.act('tmode:paint'); __ftp.ui.act('ground:3')`);
await stroke([[50, gz - 100], [60, gz - 100]]);
check(await ev(`__ftp.park.s.paint[__ftp.park.cellIndex(55, ${gz - 100})]`) === 3, 'the ground can be painted (sand)');

// ---------- lands and arches ----------
await ev(`__ftp.ui.act('tab:lands')`);
check((await ev(`document.getElementById('tray').textContent`)).includes('New land'), 'Lands offers a New land');
await ev(`__ftp.ui.act('newland')`); await wait(100);
check(await ev('__ftp.ui.dialog && __ftp.ui.dialog.title') === 'Choose a theme', 'a new land asks for its theme');
await ev(`__ftp.ui.act('dlg:dragon')`); await wait(100);
check(await ev('__ftp.ui.dialog && __ftp.ui.dialog.input !== undefined') && (await pg.inputValue('#dlg-input')).length > 3, 'then its name (with a suggestion)');
await pg.fill('#dlg-input', "Dragon's Reach"); await pg.click('[data-act="dlg:ok"]'); await wait(100);
check(await ev('__ftp.park.s.lands.length') === 1 && await ev('__ftp.tools.opts.land') === 1, 'the land is made and ready to paint');
await ev(`__ftp.ui.act('size:16')`);
await stroke([[0, gz - 100], [0, gz - 150], [20, gz - 150]]);
check(await ev(`__ftp.park.landAt(0, ${gz - 130}).name`) === "Dragon's Reach", 'painting puts cells in the land');
await ev(`__ftp.ui.act('tool:arch')`);
await stroke([[0, gz - 90], [0, gz - 90]]);
check(await count('arch') === 1, 'an arch goes across the path');
const arch = await ev(`__ftp.park.s.objects.find((o) => o.type === 'arch')`);
check(Math.abs(arch.w - 4) < 0.01 && Math.abs(arch.x) < 0.01, `it spans the path (${arch.w} m)`);
await ev(`__ftp.select(__ftp.park.s.objects.find((o) => o.type === 'arch').id); const a = __ftp.park.s.objects.find((o) => o.type === 'arch'); __ftp.focus(a.x, a.z + 2, 26); __ftp.want.pitch = 0.18; __ftp.want.yaw = 0.25; __ftp.ui.act('tab:select')`);
await shot('04-arch');

// ---------- a car park ----------
await ev(`__ftp.ui.act('tab:park')`);
check(await ev('__ftp.tools.kind') === 'lot', 'Park starts the car park tool');
await stroke([[60, gz + 10], [100, gz + 36]]);
check(await count('lot') === 2, 'a car park is dragged out');
check(await ev(`__ftp.ui.panel() && __ftp.ui.panel().lines.join(' ').includes('cars')`), 'its panel says how many cars it holds');
await stroke([[0, gz + 5], [40, gz + 30]]);
check(await count('lot') === 2 && (await ev(`document.getElementById('toasts').textContent`)).length > 0, 'a car park over a path is refused, with a reason');

// ---------- undo / redo ----------
const before = await ev('__ftp.park.s.objects.length');
await ev(`__ftp.ui.act('undo')`);
check(await count('lot') === 1, 'undo takes the car park away');
await ev(`__ftp.ui.act('redo')`);
check(await count('lot') === 2 && await ev('__ftp.park.s.objects.length') === before, 'redo puts it back (and the trees it cleared)');
const hB = await ev(`__ftp.park.groundAt(80, ${gz - 160})`);
for (let k = 0; k < 6; k++) await ev(`__ftp.ui.act('undo')`);
for (let k = 0; k < 6; k++) await ev(`__ftp.ui.act('redo')`);
check(await ev(`__ftp.park.groundAt(80, ${gz - 160})`) === hB && await ev('__ftp.park.s.objects.length') === before, 'six undos and six redos give the same park');
// a second finger arriving cancels a stroke (the ground goes back)
const hC = await ev(`__ftp.park.groundAt(-120, ${gz - 160})`);
await ev(`(() => { const A = __ftp; A.ui.act('tab:terrain'); A.ui.act('tmode:raise'); A.tools.down({ x: -120, z: ${gz - 160}, y: 0 }); A.tools.frame(0.5); A.tools.cancel(); })()`);
check(await ev(`__ftp.park.groundAt(-120, ${gz - 160})`) === hC, 'a cancelled stroke leaves no change');

// ---------- buildings ----------
// point the "pointer" straight down at (x, z), or along a direction, as a finger (or the VR laser) would
const rayDown = (x, z) => ev(([x, z]) => { const A = __ftp; A.lastRay = new A.ray.ray.constructor(new A.rig.position.constructor(x, 300, z), new A.rig.position.constructor(0, -1, 0)); }, [x, z]);
const rayFrom = (o, d) => ev(([o, d]) => { const A = __ftp; A.lastRay = new A.ray.ray.constructor(new A.rig.position.constructor(...o), new A.rig.position.constructor(...d).normalize()); }, [o, d]);
await ev(`__ftp.ui.act('tab:buildings')`);
check(await ev(`document.querySelectorAll('#tray .card').length`) >= 10, 'the Buildings tray shows the ready-made buildings (with pictures)');
await ev(`__ftp.ui.act('btpl:tavern')`);
await stroke([[0, gz - 60], [0, gz - 60]]);
check(await count('building') === 0 && (await ev(`document.getElementById('toasts').textContent`)).includes('beside paths'), 'a building can\'t go on a path, and it says why');
await stroke([[40, gz - 30], [40, gz - 30]]);
check(await count('building') === 1, 'a tavern is built');
const B = () => ev(`__ftp.park.s.objects.find((o) => o.type === 'building')`);
let b = await B();
check(b.x % 2 === 0 && b.z % 2 === 0 && b.floors.length === 2, 'it lines up with the park\'s grid, two storeys');
check(await ev(`document.querySelector('#panel h2').textContent === 'Tavern' && !!document.querySelector('[data-act="bedit"]')`), 'its panel offers Edit');
const fy = await ev(`__ftp.objects.structs.get(__ftp.park.s.objects.find((o) => o.type === 'building').id).userData.floorY`);
check(Math.abs(await ev(`__ftp.park.floorAt(${b.x + 3}, ${b.z + 3})`) - fy) < 0.01, 'inside, the floor is the building\'s floor');
await pg.click('[data-act="bedit"]');
check(await ev('__ftp.tools.kind') === 'bedit' && await ev('!!__ftp.objects.cut'), 'Edit opens the building (the storeys above lifted off)');
// rooms: add one on the ground floor next to it (east of the 4 x 3 footprint)
await rayDown(b.x + 9, b.z + 1);
await ev(`(() => { const T = __ftp.tools; T.down(null); T.up(null); })()`);
b = await B();
check(b.floors[0].length === 13 && b.floors[0].includes('4,0'), 'a room can be added');
await ev(`__ftp.ui.act('blevel:1')`); await rayDown(b.x + 9, b.z + 1);
await ev(`(() => { const T = __ftp.tools; T.down(null); T.up(null); })()`);
check((await B()).floors[1].includes('4,0'), 'and one above it');
await ev(`__ftp.ui.act('blevel:0')`); await rayDown(b.x + 9, b.z + 1);
await ev(`(() => { const T = __ftp.tools; T.down(null); T.up(null); })()`);
b = await B();
check(!b.floors[0].includes('4,0') && !b.floors[1].includes('4,0'), 'rubbing out a room takes away the rooms above it too');
// walls: a door on the south side of the west room
await ev(`__ftp.ui.act('bmode:walls'); __ftp.ui.act('bstyle:arch')`);
await rayFrom([b.x + 1, fy + 2, b.z + 15], [0, 0, -1]);
await ev(`(() => { const T = __ftp.tools; T.down(null); T.up(null); })()`);
check((await B()).walls['0,2,0,2'] === 'arch', 'tapping a wall gives it the chosen style (an arch)');
await ev(`__ftp.ui.act('bstyle:door')`); await rayFrom([b.x + 1, fy + 6, b.z + 15], [0, 0, -1]);
await ev(`(() => { const T = __ftp.tools; T.down(null); T.up(null); })()`);
check(!(await B()).walls['0,2,1,2'] && (await ev(`document.getElementById('toasts').textContent`)).includes('ground floor'), 'doors only go on the ground floor (and it says so)');
await ev(`__ftp.ui.act('bmode:roof'); __ftp.ui.act('broof:gable'); __ftp.ui.act('bmode:look'); __ftp.ui.act('bmat:wall:brick'); __ftp.ui.act('btimber')`);
b = await B();
check(b.roof === 'gable' && b.m.wall === 'brick' && !b.timber, 'the roof and materials can be changed');
await ev(`__ftp.ui.act('bmode:extras'); __ftp.ui.act('bextra:tower')`); await rayDown(b.x + 0.3, b.z + 0.2);
await ev(`(() => { const T = __ftp.tools; T.down(null); T.up(null); })()`);
check((await B()).towers.length === 1, 'a round tower goes on a corner');
await ev(`__ftp.ui.act('baddstorey')`);
check((await B()).floors.length === 3, 'a storey can be added');
await ev(`__ftp.ui.act('undo')`);
check((await B()).floors.length === 2, 'and undone');
await ev(`__ftp.ui.act('bdone')`);
check(await ev('__ftp.tools.kind') === 'select' && await ev('!__ftp.objects.cut') && await ev(`__ftp.selected === __ftp.park.s.objects.find((o) => o.type === 'building').id`), 'Done closes the editor and puts the roof back');
// walk in through the arch, not through a wall
await ev(`__ftp.setMode('walk')`);
await ev(`(() => { const W = __ftp.walker, b = __ftp.park.s.objects.find((o) => o.type === 'building'); W.x = b.x + 1; W.z = b.z + 8; for (let k = 0; k < 40; k++) __ftp.walkTo(W, W.x, W.z - 0.15); })()`);
check(await ev(`__ftp.walker.z`) < b.z + 5.5 && Math.abs(await ev(`__ftp.park.floorAt(__ftp.walker.x, __ftp.walker.z)`) - fy) < 0.01, 'you can walk in through the arch, onto its floor');
await ev(`(() => { const W = __ftp.walker, b = __ftp.park.s.objects.find((o) => o.type === 'building'); W.x = b.x + 5; W.z = b.z + 8; for (let k = 0; k < 40; k++) __ftp.walkTo(W, W.x, W.z - 0.15); })()`);
check(await ev(`__ftp.walker.z`) > b.z + 6, 'but not through a wall');
await ev(`(() => { const W = __ftp.walker, b = __ftp.park.s.objects.find((o) => o.type === 'building'); W.x = b.x + 3.2; W.z = b.z + 1.4; W.yaw = Math.PI + 0.35; W.pitch = 0.0; })()`);
await shot('05b-inside');
await ev(`__ftp.setMode('build')`);
// a few more, for the picture
await ev(`(() => { const A = __ftp; for (const [t, x, z] of [['shoprow', -30, ${gz} - 40], ['keep', -40, ${gz} - 80], ['townhouse', 30, ${gz} - 60], ['pavilion', 30, ${gz} - 90]]){ A.ui.act('btpl:' + t); A.tools.down({ x, z, y: 0 }); A.tools.up({ x, z, y: 0 }); } A.ui.act('tab:select'); })()`);
check(await count('building') >= 4, `more buildings go up (${await count('building')})`);
await ev(`__ftp.focus(0, ${gz} - 55, 95); __ftp.want.pitch = 0.42; __ftp.want.yaw = Math.PI + 0.3`);
await shot('04b-buildings');

// ---------- shops, food and facilities ----------
await ev(`__ftp.ui.act('tab:shops')`);
check(await ev(`document.querySelectorAll('#tray .card').length`) >= 11, 'the Shops tray shows stalls, seating and facilities');
await stroke([[-8, gz - 124], [-8, gz - 124]]);
check(await count('stall') === 1, 'a kiosk goes on the plaza');
const ST = () => ev(`__ftp.park.s.objects.find((o) => o.type === 'stall')`);
let st = await ST();
check(st.name.length > 2 && st.menu.length >= 3 && await ev(`document.querySelector('#panel h2').textContent`) === st.name, `it gets a name (${st.name}) and a menu, and its panel opens`);
await pg.click('[data-act="menuedit"]');
check(await ev(`document.querySelectorAll('#panel .prow').length`) >= 8, 'Menu lists what it could sell');
const p0 = st.menu[0].price, id0 = st.menu[0].id;
await pg.click(`[data-act="dlg:u-${id0}"]`); await pg.click(`[data-act="dlg:u-${id0}"]`);
check((await ST()).menu.find((m) => m.id === id0).price === p0 + 1, 'prices go up in 50 cents');
await pg.click(`[data-act="dlg:t-${id0}"]`);
check(!(await ST()).menu.some((m) => m.id === id0), 'tapping a thing takes it off the menu');
await pg.click('[data-act="dlg:done"]');
await ev(`__ftp.select(__ftp.park.s.objects.find((o) => o.type === 'stall').id)`); await pg.click('[data-act="stalldesign"]');
await pg.click('[data-act="dlg:k-cart"]'); await pg.click('[data-act="dlg:c-#2a3a6a"]'); await pg.click('[data-act="dlg:done"]');
st = await ST();
check(st.kind === 'cart' && st.color === '#2a3a6a', 'its shape and colours can be changed (a blue cart)');
// a building as a restaurant, with tables
const bid = await ev(`__ftp.park.s.objects.find((o) => o.type === 'building').id`);
await ev(`__ftp.select('${bid}'); __ftp.ui.act('buse')`);
await pg.click('[data-act="dlg:restaurant"]');
let bo = await ev(`__ftp.park.obj('${bid}')`);
check(bo.use === 'restaurant' && bo.menu.length >= 6, `a building becomes a restaurant (${bo.name}), with a menu`);
check(await ev(`__ftp.objects.structs.get('${bid}').userData.fit.counter`) > 0, 'its inside gets a counter (and a menu board)');
await ev(`(() => { const A = __ftp, b = A.park.obj('${bid}'); const [x, z] = A.buildingCentre(b); A.tools.set('place', { type: 'tableset' }); A.tools.down({ x: x - 1, z: z + 1, y: 0 }); A.tools.up({ x: x - 1, z: z + 1, y: 0 }); A.select('${bid}'); })()`);
{ const t = await ev(`__ftp.ui.panel().lines.join(' ') + ' | ' + __ftp.ui.toasts.map((x) => x.text).join(' / ') + ' | ' + __ftp.park.s.objects.filter((o) => o.type === 'tableset').length`); check(/([4-9]|\d\d) seats/.test(t), 'tables put inside give it seats' + (/([4-9]|\d\d) seats/.test(t) ? '' : ' (' + t + ')')); }
// another as toilets
await ev(`(() => { const A = __ftp; A.ui.act('btpl:blank'); A.tools.down({ x: -60, z: ${gz} - 20, y: 0 }); A.tools.up({ x: -60, z: ${gz} - 20, y: 0 }); A.ui.act('buse'); })()`);
await pg.click('[data-act="dlg:toilets"]');
check(await ev(`(() => { const o = __ftp.park.s.objects.filter((o) => o.type === 'building').pop(); return o.use === 'toilets' && __ftp.objects.structs.get(o.id).userData.fit.cubicles >= 2; })()`), 'a building can be toilets (cubicles and sinks inside)');
// your designs
await ev(`__ftp.select(__ftp.park.s.objects.find((o) => o.type === 'stall').id); __ftp.ui.act('savedesign')`);
await pg.fill('#dlg-input', 'Blue Cart'); await pg.click('[data-act="dlg:ok"]'); await wait(300);
check(await ev('__ftp.blueprints.length') === 1, 'a stall can be saved as a design');
await ev(`__ftp.ui.act('tab:shops')`);
check((await ev(`document.getElementById('tray').textContent`)).includes('Blue Cart'), 'it shows under Your designs');
await ev(`__ftp.ui.act('sbp:' + __ftp.blueprints[0].id)`);
await stroke([[8, gz - 124], [8, gz - 124]]);
check(await count('stall') === 2 && await ev(`__ftp.park.s.objects.filter((o) => o.type === 'stall').pop().kind`) === 'cart', 'and built again from there');
await ev(`(() => { const s = __ftp.park.s.objects.find((o) => o.type === 'stall'); __ftp.select(null); __ftp.ui.act('tab:select'); __ftp.focus(s.x, s.z + 1, 14); __ftp.want.pitch = 0.22; __ftp.want.yaw = 0.3; })()`);
await shot('04c-stalls');

// ---------- rides ----------
await ev(`__ftp.ui.act('tab:rides')`);
check(await ev(`document.querySelectorAll('#tray .card').length`) === 15, 'the Rides tray offers coasters, flat rides, and water and track rides');
await ev(`__ftp.ui.act('newcoaster')`);
await stroke([[-130, gz - 170], [-130, gz - 170]]);
check(await count('coaster') === 1 && await ev('__ftp.tools.kind') === 'cedit', 'a coaster station goes down, and the Ride Workshop opens');
for (const t of ['straight', 'up', 'up', 'loop']) await ev(`__ftp.ui.act('cpiece:${t}')`);   // (staying up off the ground: the land is different every time)
const CO = () => ev(`__ftp.park.s.objects.find((o) => o.type === 'coaster')`);
check((await CO()).pieces.length === 4, `track pieces are laid (${(await CO()).pieces.join(', ')})` + ((await CO()).pieces.length === 4 ? '' : ' ' + await ev(`__ftp.ui.toasts.map((t) => t.text).join(' / ')`)));
await ev(`__ftp.ui.act('cfinish')`);
let cst = await ev(`__ftp.rides.stats(__ftp.park.s.objects.find((o) => o.type === 'coaster'))`);
check(cst && cst.complete && cst.fun > 2 && cst.inversions >= 1, `Finish closes the circuit (fun ${cst && cst.fun}, scary ${cst && cst.scary}, queasy ${cst && cst.queasy})`);
await ev(`__ftp.ui.act('cundo')`);
check(!(await ev(`__ftp.rides.stats(__ftp.park.s.objects.find((o) => o.type === 'coaster')).complete`)), 'taking a piece off opens the circuit again');
await ev(`__ftp.ui.act('undo')`);
check(await ev(`__ftp.rides.stats(__ftp.park.s.objects.find((o) => o.type === 'coaster')).complete`), 'and Undo puts it back');
await ev(`__ftp.ui.act('ccart:rocket'); __ftp.ui.act('ccolor:1'); __ftp.ui.act('cdone')`);
check((await CO()).cart === 'rocket' && (await CO()).color === 1, 'its train and colour can be changed');
// ride it
await ev(`__ftp.ride(__ftp.park.s.objects.find((o) => o.type === 'coaster'))`);
check(await ev('__ftp.mode') === 'ride', 'Ride it puts you in the front seat');
await ev('__ftp.timeScale = 3');
const coId = await ev(`__ftp.park.s.objects.find((o) => o.type === 'coaster').id`);
const ran = await pg.waitForFunction((id) => { const t = __ftp.rides.get(id).train; return t.state === 'running' && t.v > 8; }, coId, { timeout: 60000 }).then(() => true, () => false);
check(ran, 'the train sets off and picks up speed');
check(await ev(`__ftp.camera.position.distanceTo(__ftp.rides.get('${coId}').train.seatEye(new __ftp.rig.position.constructor())) < 0.3`), 'your eyes are in the seat');
await shot('12-riding');
await ev(`__ftp.ui.act('walk')`);
check(await ev('__ftp.mode') === 'build' && !(await ev('__ftp.riding')), 'Get off puts you back');
await ev('__ftp.timeScale = 1');
// (reported: a hanging coaster said "too low" for every piece, then the game froze)
await ev(`__ftp.ui.act('tab:rides'); __ftp.ui.act('newhang')`);
await stroke([[-200, gz - 170], [-200, gz - 170]]);
const hang = await ev(`(() => { const o = __ftp.park.s.objects.filter((o) => o.type === 'coaster').pop(); return o.hang ? o.id : null; })()`);
check(!!hang, 'a hanging coaster station goes down');
await ev(`__ftp.ui.act('cpiece:straight'); __ftp.ui.act('cpiece:up'); __ftp.ui.act('cpiece:left')`);
check((await ev(`__ftp.park.obj('${hang}').pieces`)).length === 3, `its first pieces lay (no "too low") (${await ev(`__ftp.ui.toasts.map((t) => t.text).join(' / ')`)})`);
const tf = Date.now(); await ev(`__ftp.ui.act('cfinish')`); const finishMs = Date.now() - tf;
check(finishMs < 4000, `Finish answers quickly, whatever it finds (${finishMs} ms)`);
await ev(`__ftp.ui.act('cdone')`);
// flat rides
await ev(`__ftp.ui.act('tab:rides'); __ftp.ui.act('newride:carousel')`);
await stroke([[-150, gz - 40], [-150, gz - 40]]);
await ev(`__ftp.ui.act('tab:rides'); __ftp.ui.act('newride:wheel')`);
await stroke([[-185, gz - 95], [-185, gz - 95]]);
check(await ev(`__ftp.park.s.objects.filter((o) => o.type === 'ride').map((o) => o.kind).sort().join()`) === 'carousel,wheel', 'a carousel and a big wheel go up');
// more rides (1.5): each goes up, animates when it runs, and can be ridden
{
  const spots = { drop: [-150, gz - 230], swing: [-110, gz - 240], ship: [-75, gz - 240], cups: [-40, gz - 240], scrambler: [-200, gz - 235] };
  for (const [kind, [x, z]] of Object.entries(spots)){ await ev(`__ftp.ui.act('tab:rides'); __ftp.ui.act('newride:${kind}')`); await stroke([[x, z], [x, z]]); }
  const kinds = await ev(`__ftp.park.s.objects.filter((o) => o.type === 'ride').map((o) => o.kind).sort().join()`);
  check(['cups', 'drop', 'scrambler', 'ship', 'swing'].every((k) => kinds.includes(k)), `a drop tower, swing ride, swinging ship, teacups and scrambler go up (${kinds})`);
  await ev('__ftp.timeScale = 3'); await wait(4000);
  const moving = await ev(`(() => { const out = {}; for (const it of __ftp.rides.items.values()) if (it.st) out[it.o.kind] = Object.values(it.st).some((v) => v > 0.01); return out; })()`);
  check(Object.keys(moving).length >= 5 && Object.values(moving).every(Boolean), `they all move (${JSON.stringify(moving)})`);
  for (const kind of ['drop', 'ship']){
    await ev(`__ftp.ride(__ftp.park.s.objects.find((o) => o.kind === '${kind}'))`); await wait(600);
    check(await ev(`__ftp.mode === 'ride' && __ftp.camera.position.distanceTo(__ftp.riding.seat().eye) < 0.5`), `the ${kind} can be ridden`);
    await ev('__ftp.stopRide()');
  }
  await ev('__ftp.timeScale = 1');
  const sh = await ev(`__ftp.park.s.objects.find((o) => o.kind === 'ship').id`);
  await ev(`__ftp.select('${sh}'); __ftp.ui.act('redit'); __ftp.ui.act('rstyle:viking'); __ftp.ui.act('rdone')`);
  check(await ev(`__ftp.park.obj('${sh}').style`) === 'viking', 'the ship can be a longship');
  await ev(`(() => { const o = __ftp.park.obj('${sh}'); __ftp.select(null); __ftp.ui.act('tab:select'); __ftp.focus(-95, ${gz} - 236, 60); __ftp.want.pitch = 0.25; __ftp.want.yaw = 0.3; })()`);
  await shot('13b-more-rides');
}
// water and track rides (1.6): drawn as a loop
{
  const loop = (cx, cz, rx, rz) => { const out = []; for (let a = 0; a <= 6.4; a += 0.3) out.push([cx + Math.cos(a) * rx, cz + Math.sin(a) * rz]); return out; };
  // a lake for the boats first
  await ev(`__ftp.ui.act('tab:terrain'); __ftp.ui.act('wmode:add'); __ftp.ui.act('size:16')`);
  await stroke(loop(150, gz - 260, 10, 6));
  await ev(`__ftp.ui.act('tab:rides'); __ftp.ui.act('drawride:boats')`); await stroke(loop(150, gz - 260, 9, 6));
  await ev(`__ftp.ui.act('tab:rides'); __ftp.ui.act('drawride:railway')`); await stroke(loop(200, gz - 160, 30, 22));
  await ev(`__ftp.ui.act('tab:rides'); __ftp.ui.act('drawride:flume')`); await stroke(loop(200, gz - 260, 22, 14));
  await ev(`__ftp.ui.act('tab:rides'); __ftp.ui.act('drawride:karts')`); await stroke(loop(55, gz - 280, 16, 8));
  await ev(`__ftp.ui.act('tab:rides'); __ftp.ui.act('newride:dark')`); await stroke([[100, gz - 300 + 20], [100, gz - 300 + 20]]);
  const built = await ev(`__ftp.park.s.objects.filter((o) => o.type === 'ride').map((o) => o.kind)`);
  check(['boats', 'railway', 'flume', 'karts', 'dark'].every((k) => built.includes(k)), `swan boats, a railway, a log flume, go-karts and a dark ride are built (${built.join(', ')}; ${await ev(`__ftp.ui.toasts.map((t) => t.text).join(' / ')`)})`);
  await ev(`__ftp.ui.act('tab:rides'); __ftp.ui.act('drawride:boats')`); await stroke(loop(0, gz - 140, 14, 8));
  check((await ev(`__ftp.ui.toasts.map((t) => t.text).join(' ')`)).includes('water all the way round'), 'boats drawn on dry land are refused, with the reason');
  for (const kind of ['railway', 'flume']){
    await ev(`__ftp.ride(__ftp.park.s.objects.find((o) => o.kind === '${kind}'))`); await wait(600);
    check(await ev(`__ftp.mode === 'ride' && __ftp.camera.position.distanceTo(__ftp.riding.seat().eye) < 0.5`), `the ${kind} can be ridden`);
    await ev('__ftp.stopRide()');
  }
  await ev(`(() => { __ftp.select(null); __ftp.ui.act('tab:select'); __ftp.focus(185, ${gz} - 220, 120); __ftp.want.pitch = 0.5; __ftp.want.yaw = 0.4; })()`);
  await shot('13c-track-rides');
}
const car = await ev(`__ftp.park.s.objects.find((o) => o.kind === 'carousel').id`);
// (reported: riding the big wheel you couldn't see anything: the cabin glass was opaque)
check(await ev(`(() => { const o = __ftp.park.s.objects.find((o) => o.kind === 'wheel'), it = __ftp.rides.get(o.id); let ok = false; it.group.userData.mounts[0].traverse((m) => { if (m.isMesh && m.material.transparent && m.material.opacity < 0.4) ok = true; }); return ok; })()`), 'the big wheel\'s cabins have glass you can see through');

await ev(`__ftp.select('${car}'); __ftp.ui.act('redit'); __ftp.ui.act('rmounts:mixed'); __ftp.ui.act('rtiers:2'); __ftp.ui.act('rdone')`);
check(await ev(`__ftp.park.obj('${car}').mounts === 'mixed' && __ftp.park.obj('${car}').tiers === 2`), 'the carousel can be redesigned (two tiers of mixed animals)');
// (reported: the animals faced the middle) each animal faces the way the carousel turns
check(await ev(`(() => { const it = __ftp.rides.get('${car}'), V = __ftp.rig.position.constructor; let worst = 1;
  for (const m of it.group.userData.mounts){ m.updateWorldMatrix(true, false); const p = m.getWorldPosition(new V()).sub(it.group.position); p.y = 0;
    const along = new V(1, 0, 0).transformDirection(m.matrixWorld); along.y = 0; along.normalize();
    const travel = new V(p.z, 0, -p.x).normalize(); worst = Math.min(worst, along.dot(travel)); }
  return worst > 0.95; })()`), 'every carousel animal faces the way it goes round (not in at the middle)');
await ev(`(() => { const o = __ftp.park.obj('${car}'); __ftp.select(null); __ftp.focus(o.x, o.z, 30); __ftp.want.pitch = 0.2; __ftp.want.yaw = 0.5; })()`);
await shot('13-carousel');

// ---------- selecting, naming ----------
await ev(`__ftp.ui.act('tab:select'); __ftp.select(__ftp.park.s.objects.find((o) => o.type === 'bench').id)`);
check(await ev(`document.getElementById('panel').classList.contains('show') && document.querySelector('#panel h2').textContent === 'Bench'`), 'tapping a bench shows its panel');
const r0 = await ev(`__ftp.park.s.objects.find((o) => o.type === 'bench').r`);
await pg.click('[data-act="objrot:1"]');
check(Math.abs(await ev(`__ftp.park.s.objects.find((o) => o.type === 'bench').r`) - r0 - Math.PI / 12) < 1e-6, 'Turn turns it 15°');
await ev(`__ftp.ui.act('renamepark')`); await wait(100);
await pg.fill('#dlg-input', 'Starfall Kingdom'); await pg.click('[data-act="dlg:ok"]'); await wait(200);
check(await ev('__ftp.park.s.name') === 'Starfall Kingdom' && (await pg.textContent('#t-name')) === 'Starfall Kingdom', 'the park can be renamed (on the HUD and the gate)');

// ---------- walking ----------
await ev(`__ftp.setMode('walk'); const g = __ftp.park.s.objects.find((o) => o.type === 'gate'); __ftp.walker.x = 0; __ftp.walker.z = g.z - 30; __ftp.walker.yaw = 0`);
const w0 = await ev('__ftp.walker.z');
await pg.keyboard.down('w'); await wait(1500); await pg.keyboard.up('w');
check(await ev('__ftp.walker.z') < w0 - 1, 'W walks forward');
check(await ev(`document.body.classList.contains('walking') && getComputedStyle(document.getElementById('dock')).display === 'none'`), 'walking hides the build tools');
await ev(`__ftp.walker.yaw = Math.PI; __ftp.walker.z = ${gz} - 12; __ftp.walker.pitch = 0.12`);
await shot('05-walk');
await ev(`__ftp.walker.x = 0; __ftp.walker.z = ${gz - 1}; __ftp.walker.yaw = Math.PI; for (let k = 0; k < 60; k++) __ftp.walkTo(__ftp.walker, __ftp.walker.x + 0.15, ${gz - 1})`);
check(await ev('__ftp.walker.x') < 3.2, 'you can\'t walk through the side of the gateway');
await ev(`(() => { const A = __ftp, P = A.park, S = P.s; for (let k = 0; k < S.water.length; k++) if (!Number.isNaN(S.water[k]) && !S.path[k] && S.water[k] > P.groundAt(-300 + (k % 300) * 2 + 1, -300 + Math.floor(k / 300) * 2 + 1) + 0.6){ A.walker.x = -300 + (k % 300) * 2 + 1; A.walker.z = -300 + Math.floor(k / 300) * 2 + 1; break; } })()`);
const ws = await ev('[__ftp.walker.x, __ftp.walker.z]');
await ev(`(() => { const W = __ftp.walker; for (let k = 0; k < 30; k++) __ftp.walkTo(W, W.x + 0.15, W.z); })()`);
check(Math.abs(await ev('__ftp.walker.x') - ws[0]) > 1, 'standing in water (somehow), you can still walk out (reported: walking froze)');
await ev(`__ftp.setMode('build')`);

// ---------- night ----------
await ev(`__ftp.park.s.time = 22 * 60; __ftp.focus(0, ${gz - 20}, 70); __ftp.want.pitch = 0.35; __ftp.want.yaw = Math.PI + 0.3`);
await wait(300);
check(await ev('__ftp.objects.lightCount') > 8, `lamps glow at night (${await ev('__ftp.objects.lightCount')} lights)`);
await shot('06-night');
check(await ev(`(() => { const im = __ftp.objects.inst.get('lamp1'); const g = im && im.meshes.find((m) => m.material.name === 'lampglass'); return !!g && g.material.emissiveIntensity > 0.5; })()`), 'the lamps themselves light up at night (their glass glows)');
{
  // a lamp on a slope: its pool of light lies on the ground, not a flat disc above or below it
  const sp = await ev(`(() => { const P = __ftp.park; for (let x = -200; x <= 200; x += 8) for (let z = -200; z <= 150; z += 8){ const s = Math.abs(P.groundAt(x + 3, z) - P.groundAt(x - 3, z)); if (s > 1.2 && s < 3 && !__ftp.objects.canPlace('lamp1', x, z)) return [x, z]; } return null; })()`);
  if (sp){
    await ev(`(() => { const P = __ftp.park; P.begin('lamp'); P.addObject({ type: 'lamp1', x: ${sp[0]}, z: ${sp[1]}, r: 0 }); P.commit(); __ftp.objects.updateLights(1); })()`);
    const off = await ev(`(() => { const p = __ftp.objects.pools.geometry.attributes.position, P = __ftp.park; let worst = 0; for (let k = 0; k < p.count; k++){ const x = p.getX(k), z = p.getZ(k); if (Math.hypot(x - ${sp[0]}, z - ${sp[1]}) > 4) continue; worst = Math.max(worst, Math.abs(p.getY(k) - P.floorAt(x, z) - 0.05)); } return worst; })()`);
    check(off < 0.02, `a lamp's light lies on the slope under it (within ${off.toFixed(3)} m)`);
  }
}

// (reported: it was nearly always night) a Skip to morning button in the evening; nights race by
const d0 = await ev('__ftp.park.s.day'); await ev('__ftp.ui.drawTop()');
check(await ev(`!!document.querySelector('[data-act="morning"]')`), 'in the evening there\'s a Skip to morning button');
await pg.click('[data-act="morning"]');
check(await ev('__ftp.park.s.time') === 480 && await ev('__ftp.park.s.day') === d0 + 1, 'it skips to 8 o\'clock the next morning');
await ev('__ftp.park.s.time = 23 * 60'); const tn = await ev('__ftp.park.s.time'); await wait(1500);
check(await ev('__ftp.park.s.time') - tn > 8, 'nights go by quickly while the park is shut');
await ev(`__ftp.park.s.time = 11 * 60`);

// ---------- memory: things come and go, the shapes don't pile up ----------
await ev('__ftp.noRender = false'); await wait(300);
const mem = () => ev('({ g: __ftp.renderer.info.memory.geometries, t: __ftp.renderer.info.memory.textures })');
const churn = () => ev(`(() => { const A = __ftp, P = A.park;
  for (let k = 0; k < 6; k++){
    P.begin('churn'); const ids = []; for (let i = 0; i < 20; i++) ids.push(P.addObject({ type: i % 2 ? 'bench' : 'lamp2', x: -40 + i, z: ${gz - 200}, r: 0 }).id); P.commit();
    P.begin('churn'); P.addObject({ type: 'sign', x: -50, z: ${gz - 205}, r: 0, name: 'Hello' + k }); P.addObject({ type: 'lot', x: -100, z: ${gz - 210}, w: 8, d: 8, r: 0 }); P.addObject({ type: 'fence_wall', x: -60, z: ${gz - 200}, x2: -50, z2: ${gz - 190}, r: 0 }); P.addObject({ type: 'building', x: -80, z: ${gz - 230}, r: 0, name: 'Tmp', floors: [['0,0', '1,0'], ['0,0']], walls: {}, towers: [{ i: 0, j: 0, h: 2 }], extras: [{ kind: 'sign', i: 0, j: 0, l: 0, d: 0, text: 'Hi' + k }] }); P.commit();
    P.undo(); P.undo();
  } })()`);
await churn(); await wait(400); const m1 = await mem();
await churn(); await wait(400); const m2 = await mem();
check(m2.g <= m1.g + 2 && m2.t <= m1.t + 1, `geometries and textures stay flat as things come and go (${m1.g} → ${m2.g}, ${m1.t} → ${m2.t})`);
const rc = await ev('(() => { __ftp.renderer.render(__ftp.scene, __ftp.camera); return __ftp.renderer.info.render.calls; })()');
check(rc < 400, `draw calls stay low (${rc})`);
await ev('__ftp.noRender = true');

// ---------- saving and opening again ----------
const snap = await ev('({ n: __ftp.park.s.objects.length, h: __ftp.park.groundAt(80, ' + (gz - 160) + '), p: __ftp.park.s.path.reduce((a, v) => a + (v ? 1 : 0), 0), name: __ftp.park.s.name })');
await ev('__ftp.save()'); await wait(500);
await pg.reload(); await ready(); await wait(500);
check(await ev(`getComputedStyle(document.getElementById('b-continue')).display !== 'none' && document.getElementById('b-continue').textContent.includes('Starfall Kingdom')`), 'the title offers to continue your park');
await pg.click('#b-continue');
await pg.waitForFunction('__ftp.mode === "build"', null, { timeout: 60000 });
const snap2 = await ev('({ n: __ftp.park.s.objects.length, h: __ftp.park.groundAt(80, ' + (gz - 160) + '), p: __ftp.park.s.path.reduce((a, v) => a + (v ? 1 : 0), 0), name: __ftp.park.s.name })');
check(JSON.stringify(snap) === JSON.stringify(snap2), 'it opens again exactly as it was (things, ground, paths, name)');
check(await ev('__ftp.blueprints.length') === 1, 'your designs are still there');
// a second park, and the list
await ev('__ftp.toTitle(true)'); await wait(800);
check(await ev(`document.querySelectorAll('#parks-list .pk').length`) === 1 && await ev(`!!document.querySelector('#parks-list img')`), 'Your parks lists it, with a picture');
if (FULL) await shot('07-parks');
if (FULL){
await pg.click('#parks-new'); await pg.fill('#np-name', 'Cliffside Fair'); await pg.click('[data-land="coast"]'); await pg.click('#np-go');
await pg.waitForFunction('__ftp.mode === "build" && __ftp.park.s.name === "Cliffside Fair"', null, { timeout: 60000 }); await wait(800);
check(await ev('!!__ftp.terrain.sea') && await ev('__ftp.park.s.water.some((w) => !Number.isNaN(w))'), 'a Coastal Cliffs park has the sea');
await ev(`__ftp.focus(0, -120, 260); __ftp.want.pitch = 0.45; __ftp.want.yaw = Math.PI`);
if (FULL) await shot('08-coast');
await ev('__ftp.toTitle(true)'); await wait(600);
check(await ev(`document.querySelectorAll('#parks-list .pk').length`) === 2, 'both parks are in the list');
await ev(`document.querySelector('[data-park]').click()`); await pg.waitForFunction('__ftp.mode === "build"', null, { timeout: 60000 });
} else { await ev(`document.querySelector('[data-park]').click()`); await pg.waitForFunction('__ftp.mode === "build"', null, { timeout: 60000 }); }
if (FULL){
  for (const land of ['lake', 'hills']){
    await ev('__ftp.toTitle(true)'); await wait(400);
    await pg.click('#parks-new'); await pg.fill('#np-name', 'Park ' + land); await pg.click(`[data-land="${land}"]`); await pg.click('#np-go');
    await pg.waitForFunction(`__ftp.mode === "build" && __ftp.park.s.land === "${land}"`, null, { timeout: 60000 });
    await ev(`__ftp.focus(-60, -60, 300); __ftp.want.pitch = 0.5; __ftp.want.yaw = 0.8`);
    await shot('09-land-' + land);
  }
}

// ---------- opening day: a Tycoon park, with guests ----------
await ev('__ftp.toTitle(true)'); await wait(500);
await pg.click('#parks-new'); await pg.fill('#np-name', 'Opening Day'); await pg.click('[data-land="meadow"]');
check(await ev(`document.querySelector('[data-mode="tycoon"]').classList.contains('on')`), 'a new park can be a Tycoon park (chosen by default)');
await pg.click('#np-go');
await pg.waitForFunction('__ftp.mode === "build" && __ftp.park.s.name === "Opening Day"', null, { timeout: 60000 }); await wait(500);
check(await ev('__ftp.park.s.mode') === 'tycoon' && await ev('__ftp.park.s.money') === 60000, 'it starts with $60,000');
check(await ev(`__ftp.economy.locked('coaster') && !__ftp.economy.locked('carousel')`), 'coasters are locked at first; the carousel is not');
const tM0 = await ev('__ftp.park.s.money');
await ev(`(() => { const A = __ftp, T = A.tools, gz = ${gz};
  A.ui.act('tab:paths'); A.ui.act('pmode:line'); T.down({ x: 0, z: gz - 26, y: 0 }); T.move({ x: 0, z: gz - 80, y: 0 }); T.up({ x: 0, z: gz - 80, y: 0 });
  A.ui.act('tab:rides'); A.ui.act('newride:carousel'); T.down({ x: 12, z: gz - 50, y: 0 }); T.up({ x: 12, z: gz - 50, y: 0 });
  A.ui.act('tab:shops'); T.down({ x: -3.5, z: gz - 40, y: 0 }); T.up({ x: -3.5, z: gz - 40, y: 0 });
  A.ui.act('btpl:blank'); T.down({ x: -7, z: gz - 60, y: 0 }); T.up({ x: -7, z: gz - 60, y: 0 });
  const b = A.park.s.objects.filter((o) => o.type === 'building').pop(); A.select(b.id); A.ui.act('buse'); A.ui.act('dlg:toilets'); A.ui.act('tab:select'); })()`);
const tM1 = await ev('__ftp.park.s.money');
check(tM1 < tM0 - 5000, `building costs money (${tM0} → ${tM1})`);
await ev(`__ftp.ui.act('undo')`); const tM2 = await ev('__ftp.park.s.money');
check(tM2 > tM1, 'undo gives the money back');
await ev(`__ftp.ui.act('redo')`);
await ev('__ftp.park.s.money = 500');
const nb = await count('building');
await ev(`(() => { const A = __ftp, T = A.tools; A.ui.act('btpl:keep'); T.down({ x: -60, z: ${gz} - 100, y: 0 }); T.up({ x: -60, z: ${gz} - 100, y: 0 }); })()`);
check(await count('building') === nb && (await ev(`document.getElementById('toasts').textContent`)).includes('Not enough money'), 'something you can\'t afford isn\'t built (and it says why)');
await ev('__ftp.park.s.money = 40000');
// open the gates and let a day go by, fast
await ev('__ftp.park.s.time = 9 * 60; __ftp.timeScale = 8; __ftp.speed = 4');
const arrived = await pg.waitForFunction(() => __ftp.guests.summary().inPark >= 15, null, { timeout: 90000 }).then(() => true, () => false);
check(arrived, `guests arrive by car and come in through the gate (${await ev('__ftp.guests.summary().inPark')} in the park, ${await ev('__ftp.guests.cars.length')} cars)`);
const rode = await pg.waitForFunction(() => __ftp.guests.list.some((g) => g.rides > 0), null, { timeout: 90000 }).then(() => true, () => false);
check(rode, 'they queue for the carousel and ride it');
const spent = await pg.waitForFunction(() => { const d = __ftp.park.s.fin[__ftp.park.s.fin.length - 1]; return d.income.entry > 0 && d.income.food > 0; }, null, { timeout: 90000 }).then(() => true, () => false);
check(spent, `they pay to get in and buy from the stall (${JSON.stringify(await ev('__ftp.park.s.fin[__ftp.park.s.fin.length - 1].income'))})`);
check(await ev('__ftp.guests.list.some((g) => g.thoughts.length)'), `they think about it ("${await ev('(__ftp.guests.list.find((g) => g.thoughts.length) || { thoughts: [{ text: "" }] }).thoughts[0].text')}")`);
check(await ev('__ftp.park.s.rating') > 0, `the park gets a rating (${await ev('__ftp.park.s.rating')}★)`);
// tap a guest: their panel
await ev(`(() => { const A = __ftp, g = A.guests.list.find((q) => !q.hidden && q.inPark); A.selectGuest(g); })()`);
check(await ev(`document.querySelector('#panel h2') && __ftp.guestSel && document.querySelector('#panel h2').textContent === __ftp.guestSel.name`), 'tapping a guest shows their name, mood and thoughts');
await ev(`__ftp.ui.act('deselect')`);
// staff, a breakdown
await ev(`__ftp.ui.act('parkinfo'); __ftp.ui.act('dlg:mec+'); __ftp.ui.act('dlg:done')`);
check(await ev('__ftp.guests.staff.filter((s) => s.staff === "mechanic").length') === 1, 'a mechanic can be hired');
await ev(`(() => { const it = [...__ftp.rides.items.values()].find((i) => i.flat); it.broken = true; })()`);
const fixed = await pg.waitForFunction(() => ![...__ftp.rides.items.values()].find((i) => i.flat).broken, null, { timeout: 90000 }).then(() => true, () => false);
check(fixed, 'a broken-down ride is mended by the mechanic');
// a daytime look at the crowd, close up (realistic people near the camera)
await ev(`__ftp.timeScale = 1; __ftp.speed = 1; __ftp.park.s.time = 14 * 60; __ftp.ui.act('tab:select'); __ftp.select(null); __ftp.focus(3, ${gz} - 44, 22); __ftp.want.pitch = 0.28; __ftp.want.yaw = 0.75`);
await pg.waitForFunction(() => __ftp.people.progress === 1, null, { timeout: 60000 }).catch(() => {});
await ev('__ftp.noRender = false'); await wait(2500);
check(await ev('__ftp.people.stats().near') > 0, `the guests nearest you are realistic people (${JSON.stringify(await ev('__ftp.people.stats()'))})`);
await shot('14-guests');
// closing time: everyone goes home
await ev('__ftp.park.s.time = 20.9 * 60; __ftp.timeScale = 8; __ftp.speed = 4');
const home = await pg.waitForFunction(() => __ftp.guests.summary().inPark === 0, null, { timeout: 120000 }).then(() => true, () => false);
check(home, 'at closing time the guests go home');
await ev('__ftp.timeScale = 1; __ftp.speed = 1');

// ---------- VR ----------
const pull = async () => {
  await ev(`window.__iwer.controllers.right.updateButtonValue('trigger', 1)`); await pg.waitForFunction('__ftp.vr.trig[1]', null, { timeout: 30000 }).catch(() => {});
  await ev(`window.__iwer.controllers.right.updateButtonValue('trigger', 0)`); await pg.waitForFunction('!__ftp.vr.trig[1]', null, { timeout: 30000 }).catch(() => {});
};
if (IWER){
  await ev('__ftp.noRender = false');
  await ev('__ftp.startVR()');
  await pg.waitForFunction('__ftp.vr.active', null, { timeout: 30000 }).catch(() => {});
  check(await ev('__ftp.vr.active'), 'VR session starts');
  check(await ev('__ftp.rig.scale.x') > 30, 'you start over the park as a model');
  await ev(`(() => { const d = window.__iwer; d.position.set(0, 1.6, 0); d.quaternion.set(0, 0, 0, 1);
    d.controllers.left.position.set(-0.15, 1.25, -0.35); d.controllers.left.quaternion.set(0, 0, 0, 1);
    d.controllers.right.position.set(0.15, 1.3, -0.25); d.controllers.right.quaternion.set(0, 0, 0, 1); })()`);
  await wait(2000);
  check(await ev('!!__ftp.vr.tablet.group.parent && __ftp.vr.tablet.hits.length > 10'), 'the tablet is on your left hand, with the same buttons');
  // aim the right laser at the tablet's Trees tab and pull the trigger
  const aimTab = async (id) => {
    const p = await ev(`(() => { const T = __ftp.vr.tablet, h = T.hits.find((x) => x.id === '${id}'); if (!h) return null; const w = T.mesh.geometry.parameters.width, hh = T.mesh.geometry.parameters.height;
      return T.mesh.localToWorld(new T.mesh.position.constructor(((h.x + h.w / 2) / 1024 - 0.5) * w, (0.5 - (h.y + h.h / 2) / 1344) * hh, 0)).toArray(); })()`);
    if (!p) return false;
    await ev(`(() => { const A = __ftp, R = A.vr.hand('right').ctrl; const from = R.getWorldPosition(new A.rig.position.constructor()); const dir = new A.rig.position.constructor(...${JSON.stringify(p)}).sub(from).normalize();
      const d = dir.applyQuaternion(A.rig.quaternion.clone().invert()); const q = new A.rig.quaternion.constructor().setFromUnitVectors(new A.rig.position.constructor(0, 0, -1), d);
      window.__iwer.controllers.right.quaternion.set(q.x, q.y, q.z, q.w); })()`);
    await wait(700);
    await pull(); return true;
  };
  check(await aimTab('tab:plants') && await ev('__ftp.ui.tab') === 'plants', 'pointing at the tablet and pulling the trigger picks a tab');
  await pg.screenshot({ path: path.join(OUT, '10-vr-model.png') });
  // build with the laser: point at the ground and pull the trigger to plant a tree
  n = await count('oak');
  await ev(`(() => { const A = __ftp; A.tools.set('place', { type: 'oak' }); const R = A.vr.hand('right').ctrl, from = R.getWorldPosition(new A.rig.position.constructor());
    const gt = A.park.s.objects.find((o) => o.type === 'gate'); const g = new A.rig.position.constructor(gt.x + 27, 0, gt.z - 36); g.y = A.park.floorAt(g.x, g.z); const dir = g.sub(from).normalize();
    const d = dir.applyQuaternion(A.rig.quaternion.clone().invert()); const q = new A.rig.quaternion.constructor().setFromUnitVectors(new A.rig.position.constructor(0, 0, -1), d);
    window.__iwer.controllers.right.quaternion.set(q.x, q.y, q.z, q.w); })()`);
  await pg.waitForFunction('!!__ftp.vr.groundPt', null, { timeout: 30000 }).catch(() => {});
  await pull();
  check(await count('oak') === n + 1, 'the laser plants a tree where it points' + (await count('oak') === n + 1 ? '' : ' ' + await ev(`JSON.stringify({ g: __ftp.vr.groundPt, hover: __ftp.vr.hover, kind: __ftp.tools.kind, t: __ftp.ui.toasts.map((t) => t.text) })`)));
  await ev('__ftp.vr.toggleLife()'); await wait(800);
  check(await ev('__ftp.rig.scale.x') === 1 && await ev('__ftp.vr.life'), 'B stands you in the park at full size');
  const head = await ev('__ftp.camera.getWorldPosition(new __ftp.rig.position.constructor()).y - __ftp.park.floorAt(__ftp.camera.getWorldPosition(new __ftp.rig.position.constructor()).x, __ftp.camera.getWorldPosition(new __ftp.rig.position.constructor()).z)');
  check(head > 1.3 && head < 1.9, `your head is at standing height (${head.toFixed(2)} m)`);
  await pg.screenshot({ path: path.join(OUT, '11-vr-life.png') });
  await ev('__ftp.vr.toggleLife()'); await wait(500);
  check(await ev('__ftp.rig.scale.x') > 30, 'and back to the model');
  await ev(`__ftp.ride(__ftp.park.s.objects.find((o) => o.kind === 'carousel'))`); await wait(1500);
  const seatD = await ev(`(() => { const A = __ftp, s = A.riding.seat(); return A.camera.getWorldPosition(new A.rig.position.constructor()).distanceTo(s.eye); })()`);
  check(seatD < 0.5, `riding in VR, your head is on the carousel's horse (${seatD.toFixed(2)} m)`);
  await ev('__ftp.stopRide()'); await wait(400);
  check(await ev('__ftp.rig.scale.x') > 30, 'getting off puts the play space back exactly (the model again)');
  await ev('__ftp.vr.end()'); await wait(800);
  check(!(await ev('__ftp.vr.active')) && await ev('__ftp.rig.scale.x') === 1, 'leaving VR puts the screen view back');
}

// (reported: the picture froze while the clock ran on: the iPad had taken the 3D view away for lack of memory)
await ev(`__ftp.renderer.getContext().getExtension('WEBGL_lose_context').loseContext()`);
await pg.waitForSelector('#lost', { timeout: 10000 }).catch(() => {});
check(await ev(`!!document.getElementById('lost') && document.getElementById('lost').textContent.includes('saved')`), 'if the 3D view is lost, it says so (the park is saved) with a Reload button');
check(errors.length === 0, 'no errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
console.log(`${failures ? failures + ' FAILED' : 'all passed'} in ${Math.round((Date.now() - started) / 1000)} s; screenshots in ${OUT}`);
await browser.close(); server.close();
process.exit(failures ? 1 : 0);
