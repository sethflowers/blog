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

// ---------- a new park ----------
await pg.click('#b-new'); await wait(300);
check(await ev(`document.getElementById('newpark').classList.contains('show')`) && (await pg.inputValue('#np-name')).length > 3, 'New park suggests a name');
await pg.fill('#np-name', ''); await pg.click('#np-go'); await wait(200);
check((await pg.textContent('#np-msg')).includes('name'), 'a park needs a name');
await pg.fill('#np-name', 'Test Kingdom'); await pg.click('[data-land="meadow"]'); await pg.click('#np-go');
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
await ev(`__ftp.setMode('build')`);

// ---------- night ----------
await ev(`__ftp.park.s.time = 22 * 60; __ftp.focus(0, ${gz - 20}, 70); __ftp.want.pitch = 0.35; __ftp.want.yaw = Math.PI + 0.3`);
await wait(300);
check(await ev('__ftp.objects.lightCount') > 8, `lamps glow at night (${await ev('__ftp.objects.lightCount')} lights)`);
await shot('06-night');
await ev(`__ftp.park.s.time = 11 * 60`);

// ---------- memory: things come and go, the shapes don't pile up ----------
await ev('__ftp.noRender = false'); await wait(300);
const mem = () => ev('({ g: __ftp.renderer.info.memory.geometries, t: __ftp.renderer.info.memory.textures })');
const churn = () => ev(`(() => { const A = __ftp, P = A.park;
  for (let k = 0; k < 6; k++){
    P.begin('churn'); const ids = []; for (let i = 0; i < 20; i++) ids.push(P.addObject({ type: i % 2 ? 'bench' : 'lamp2', x: -40 + i, z: ${gz - 200}, r: 0 }).id); P.commit();
    P.begin('churn'); P.addObject({ type: 'sign', x: -50, z: ${gz - 205}, r: 0, name: 'Hello' + k }); P.addObject({ type: 'lot', x: -100, z: ${gz - 210}, w: 8, d: 8, r: 0 }); P.addObject({ type: 'fence_wall', x: -60, z: ${gz - 200}, x2: -50, z2: ${gz - 190}, r: 0 }); P.commit();
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
  await ev('__ftp.vr.end()'); await wait(800);
  check(!(await ev('__ftp.vr.active')) && await ev('__ftp.rig.scale.x') === 1, 'leaving VR puts the screen view back');
}

check(errors.length === 0, 'no errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
console.log(`${failures ? failures + ' FAILED' : 'all passed'} in ${Math.round((Date.now() - started) / 1000)} s; screenshots in ${OUT}`);
await browser.close(); server.close();
process.exit(failures ? 1 : 0);
