// Plays Glue Gunner in headless Chromium, checks it, and saves screenshots. Quick (about a minute).
//
//   npm i --prefix _tools/vr-test iwer        (once; the VR part uses Meta's emulated Quest 3)
//   NODE_PATH=$(npm root -g) node _tools/glue-gunner/test.mjs [outDir]
//
// Serves the repo the way Jekyll would publish it (front matter stripped, version filled in). Checks:
// the loading screen, the title and version, ten aliens on the deck, no z-fighting in the scenery,
// the welcome, walking (and the lip stopping you), the glue gun: shot 1 sticks a string to an alien,
// shot 2 sticks the other end to a block, the string shrinks, lifts the alien and rips a part off;
// gluing a head kills; aliens hurting you; dying; clearing a wave and the next one climbing up over
// the edges; memory staying flat over waves; draw calls; saving; and in VR: both guns in your hands,
// the trigger shooting, the stick walking, the menu board, B closing it.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(HERE, '../..');
const OUT = path.resolve(process.argv[2] || 'glue-gunner-shots');
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
const VERSION = (fs.readFileSync(path.join(ROOT, '_experiments/glue-gunner.html'), 'utf8').match(/version:\s*"?([^"\n]+)"?/) || [])[1];
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
const BASE = `http://127.0.0.1:${server.address().port}/experiments/glue-gunner/`;

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
// the game is run forward inside the page (__gg.advance) instead of waiting for frames, and nothing
// is drawn except one frame for each screenshot
const shot = async (name) => { await ev('__gg.renderNow()'); await pg.screenshot({ path: path.join(OUT, name + '.png'), timeout: 120000 }); };
const nextFrame = async () => { const t = await ev('__gg.time'), start = Date.now(); while ((await ev('__gg.time')) === t && Date.now() - start < 20000) await wait(30); };
const until = async (expr, sec, what) => check(await ev(`__gg.advance(${sec}, () => (${expr}))`), what + ((await ev(expr)) ? '' : ' (timed out)'));

console.log('Glue Gunner ' + VERSION);
const started = Date.now();
await pg.goto(BASE);
await pg.waitForFunction('window.__gg', null, { timeout: 120000 }).catch((e) => { console.log('the game did not start:', errors.join(' | ')); throw e; });
await ev('localStorage.clear()');
await ev('__gg.noRender = true');
await wait(500);
check((await pg.textContent('.build-version')).includes(VERSION), 'title shows version ' + VERSION);
if (!process.env.SKIP_LOADING){ const { checkLoading } = await import('../loading-check.mjs'); await checkLoading({ browser, url: BASE, check, main: pg, game: '__gg', shot: path.join(OUT, '00-loading.png') }); }
check(await ev('__gg.aliens.length') === 10, `ten aliens on the deck behind the title (${await ev('__gg.aliens.length')})`);
await shot('01-title');

// the scenery: no two surfaces in the same place
{
  const { findCoplanar } = await import('../coplanar.mjs');
  const flicker = findCoplanar(JSON.parse(await ev('JSON.stringify(globalThis.__boxLog)'))).filter((h) => h.area >= 0.005);
  check(flicker.length === 0, `no flickering (coplanar) scenery faces${flicker.length ? ': ' + flicker.slice(0, 4).map((h) => `${h.a} | ${h.b}`).join(' || ') : ''}`);
}

// ---------- on screen ----------
await ev(`document.getElementById('b-play').click()`);
await ev('__gg.paused = true');   // (on screen the test runs the game itself)
await wait(300);
check(await ev('__gg.mode') === 'screen', 'Play starts the game on the screen');
check(await ev(`!!document.querySelector('#panel.show') && document.querySelector('#panel h2').textContent.includes('Glue Gunner')`), 'a welcome explains the glue gun');
await shot('02-welcome');
await ev('__gg.closePanels()');
check(await ev('__gg.aliens.length') === 10 && await ev('__gg.lvl.n') === 1, 'wave 1: ten aliens');
await ev('__gg.advance(0.5)');
await shot('03-start');
// walking
const p0 = await ev('__gg.player.pos.clone()');
await ev('__gg.stick.y = -1'); await ev('__gg.advance(1.5)'); await ev('__gg.stick.y = 0');
check(await ev(`__gg.player.pos.distanceTo(new __gg.player.pos.constructor(${p0.x}, ${p0.y}, ${p0.z}))`) > 5, 'the thumb stick walks you forward');
// the lip stops you at the edge
await ev('__gg.standAt({ x: 0, z: 22, yaw: Math.PI })');
await ev('__gg.stick.y = -1'); await ev('__gg.advance(2)'); await ev('__gg.stick.y = 0');
check(await ev('__gg.player.pos.z') < 24.4, `the lip stops you at the edge (z ${(await ev('__gg.player.pos.z')).toFixed(2)})`);

// close up: an alien, held still, from the front and the side
const setup = `(() => { const G = __gg; for (const a of G.aliens){ a.hold = true; a.noticeT = 1e9; a.state = 'prowl'; }
  const a = G.aliens[0]; G.standAt({ x: 0, z: 0, yaw: 0 }); a.place(0, -4.2, 0); a.update({ dt: 0.016, player: G.player.pos, playerHead: G.player.pos, aliens: G.aliens, world: G.world, attackers: new Set(), wave: 1 });
  for (const b of G.aliens.slice(1)) b.place(30 + b.id, 20, 0); return a.id; })()`;
await ev(setup);
await ev(`(() => { const a = __gg.aliens[0]; a.place(0, -3.2, 0.25); __gg.aimAt({ x: 0, y: 1.55, z: -3.2 }); __gg.player.pitch += 0.06; })()`);
await ev('__gg.advance(0.3)');
await shot('04-alien-front');
await ev(`(() => { const a = __gg.aliens[0]; a.state = 'notice'; a.stateT = 0; a.scream = 1.2; __gg.advance(0.35); __gg.aimAt({ x: 0, y: 1.7, z: -3.2 }); __gg.player.pitch += 0.04; })()`);
await shot('04b-alien-scream');
await ev(`(() => { const a = __gg.aliens[0]; a.state = 'prowl'; a.scream = 0; a.place(0, -4, Math.PI / 2); __gg.standAt({ x: -2.6, z: -1.2, yaw: 0 }); __gg.advance(0.4); __gg.aimAt({ x: 0, y: 1.2, z: -4 }); })()`);
await shot('04c-alien-side');

// ---------- the glue gun ----------
// an alien 9 m in front of you, with a block above and beyond it
const B = await ev(`(() => { const G = __gg, b = G.world.blocks.find((b) => Math.abs(b.base.x) < 30 && Math.abs(b.base.z) < 18 && b.base.y < 6.5) || G.world.blocks[0];
  const a = G.aliens[0]; a.place(b.pos.x - 1.5, b.pos.z + 0.5, 0); a.hold = true;
  G.standAt({ x: b.pos.x - 1.5, z: b.pos.z + 10, yaw: 0 }); return { x: b.pos.x, y: b.pos.y, z: b.pos.z, i: b.i }; })()`);
// shot 1: at the alien's left forearm
const aimBone = (name) => `(() => { const G = __gg, a = G.aliens[0]; a.root.updateMatrixWorld(true); const p = new G.player.pos.constructor(); a.boneWorld('${name}', p);
  const c = new G.player.pos.constructor(); a.boneWorld('hand${name.endsWith('L') ? 'L' : 'R'}', c); p.lerp(c, 0.4); G.aimAt(p); return p.toArray(); })()`;
await ev(aimBone('foreL'));
const r1 = await ev(`(() => { const h = __gg.shootScreen(innerWidth / 2, innerHeight / 2); return h ? h.kind + ':' + (h.name || '') : null; })()`);
check(/^alien:/.test(r1 || ''), `shot 1 hits the alien (${r1})`);
await until('!!__gg.glue.pending', 1, 'and sticks the first end of a string to it');
check(await ev('__gg.glue.pending.end.kind') === 'alien', 'the string is stuck to the alien');
await ev('__gg.advance(0.2)');
await shot('05-shot-one');
// shot 2: at the block
await ev(`__gg.aimAt({ x: ${B.x}, y: ${B.y}, z: ${B.z} })`);
await ev('__gg.advance(0.25)');
const r2 = await ev(`(() => { const h = __gg.shootScreen(innerWidth / 2, innerHeight / 2); return h ? h.kind : null; })()`);
check(r2 === 'block', `shot 2 hits the floating block (${r2})`);
await until('__gg.glue.count === 1 && !__gg.glue.pending', 1, 'and ties the string between the alien and the block');
await until('!__gg.aliens[0].grounded', 3, 'the string shrinks and lifts the alien off its feet');
await ev('__gg.advance(0.25)');
await ev(`__gg.aimAt({ x: ${B.x - 0.5}, y: ${B.y - 1.6}, z: ${B.z} })`);
await shot('06-lifted');
await until('__gg.debris.length > 0', 6, 'until something rips off');
const torn = await ev('__gg.debris[0] && __gg.debris[0].name');
check(/fore|arm|hand/.test(torn || ''), `the part it was stuck by came off (${torn})`);
check(await ev('__gg.glue.strings[0] && __gg.glue.strings[0].a.kind === "debris" || __gg.glue.strings[0].b.kind === "debris"'), 'the torn-off part hangs from the string');
check(await ev('__gg.save.score') >= 25, 'ripping a part off scores');
await ev('__gg.advance(0.3)');
await ev(`__gg.aimAt({ x: ${B.x - 0.8}, y: 1.6, z: ${B.z} })`);
await shot('07-torn');
await ev('__gg.advance(1.2)');
await shot('07b-after');
// the head: glue it to the deck's far side and it comes off; the alien dies
const kills0 = await ev('__gg.lvl.kills');
await ev(`(() => { const G = __gg, a = G.aliens[1]; a.place(5, 2, Math.PI); a.hold = true; G.standAt({ x: 5, z: 10, yaw: 0 }); G.glue.cutAll(); })()`);
await ev(`(() => { const G = __gg, a = G.aliens[1]; a.root.updateMatrixWorld(true); const p = new G.player.pos.constructor(); a.boneWorld('head', p); p.y += 0.08; p.z += 0.05; G.aimAt(p); })()`);
const r3 = await ev(`(() => { const h = __gg.shootScreen(innerWidth / 2, innerHeight / 2); return h ? h.kind + ':' + h.name : null; })()`);
check(/alien:(head|jaw|neck)/.test(r3 || ''), `a shot at the head sticks to it (${r3})`);
await ev('__gg.advance(0.3)');
const blk2 = await ev(`(() => { const G = __gg, a = G.aliens[1]; let best = null; for (const b of G.world.blocks){ const d = Math.hypot(b.pos.x - a.root.position.x, b.pos.z - a.root.position.z); if (!best || d < best.d) best = { d, b }; } return best.b.pos.toArray(); })()`);
await ev(`__gg.aimAt({ x: ${blk2[0]}, y: ${blk2[1]}, z: ${blk2[2]} })`);
const r4 = await ev(`(() => { const h = __gg.shootScreen(innerWidth / 2, innerHeight / 2); return h ? h.kind : null; })()`);
check(r4 === 'block', `the other end sticks to a block (${r4})`);
await until('__gg.aliens[1].dead', 8, 'its head comes off and it dies');
check(await ev('__gg.lvl.kills') === kills0 + 1, 'the kill is counted');
await ev('__gg.advance(2)');
await ev(`(() => { const a = __gg.aliens[1]; __gg.standAt({ x: a.root.position.x - 3, z: a.root.position.z + 3, yaw: 0 }); __gg.aimAt({ x: a.root.position.x, y: 0.5, z: a.root.position.z }); })()`);
await shot('08-dead');
// two aliens glued together tear each other apart
await ev(`(() => { const G = __gg; G.glue.cutAll(); const a = G.aliens[2], b = G.aliens[3]; a.place(-10, 0, Math.PI / 2); b.place(-4, 0, -Math.PI / 2); a.hold = b.hold = true; G.standAt({ x: -7, z: 8, yaw: 0 }); })()`);
const pair = async (k) => { await ev(`(() => { const G = __gg, a = G.aliens[${k}]; a.root.updateMatrixWorld(true); const p = new G.player.pos.constructor(); a.boneWorld('chest', p); G.aimAt(p); })()`);
  await ev('__gg.shootScreen(innerWidth / 2, innerHeight / 2)'); await ev('__gg.advance(0.35)'); };
const d0 = await ev('__gg.debris.length');
await pair(2); await pair(3);
check(await ev('__gg.glue.count') === 1, 'two aliens glued to each other');
await until(`__gg.debris.length > ${d0}`, 8, 'pull each other until one tears');
await shot('09-pair');

// aliens hurt you
await ev(`(() => { const G = __gg; G.glue.cutAll(); G.player.hp = 100; const a = G.aliens[4]; a.hold = false; a.state = 'hunt'; a.noticeT = 0; a.place(G.player.pos.x, G.player.pos.z - 1.3, 0); })()`);
await until('__gg.player.hp < 100', 4, 'an alien next to you slashes you');
await shot('10-hurt');
// dying
await ev('__gg.hurt(500)');
await ev('__gg.advance(0.2)'); await wait(1600); await ev('__gg.advance(0.1)');
check(await ev(`!!document.querySelector('#panel.show') && /Torn apart/.test(document.querySelector('#panel h2').textContent)`), 'losing all your health ends the wave (Torn apart)');
await ev(`[...document.querySelectorAll('#panel button')].find((b) => /Try/.test(b.textContent)).click()`);
check(await ev('__gg.player.hp') === 100 && await ev('__gg.aliens.length') === 10 && !(await ev('__gg.lvl.over')), 'Try again restarts the wave with ten aliens');

// clear the wave: the next one climbs up over the edges
await ev(`for (const a of __gg.aliens) a.die()`);
await until(`!!document.querySelector('#panel.show') && document.querySelector('#panel h2').textContent.includes('cleared')`, 6, 'killing every alien clears the wave');
await shot('11-cleared');
await ev(`[...document.querySelectorAll('#panel button')].find((b) => /Wave 2/.test(b.textContent)).click()`);
check(await ev('__gg.lvl.n') === 2 && await ev('__gg.lvl.total') === 12, 'wave 2: twelve aliens');
await until('__gg.aliens.some((a) => a.climb)', 3, 'they climb up over the edge');
await ev(`(() => { const a = __gg.aliens.find((a) => a.climb); a.climb.t = 0.45; const p = a.root.position; __gg.standAt({ x: p.x * 0.85, z: p.z * 0.75, yaw: 0 }); __gg.aimAt({ x: p.x, y: 0.6, z: p.z }); })()`);
await shot('12-climbing');
await ev('__gg.player.hp = 1e9');   // (standing still while they all arrive)
await until('__gg.lvl.queue === 0 && __gg.aliens.filter((a) => !a.dead && !a.climb).length >= 12', 30, 'all of wave 2 gets onto the deck');
await ev('__gg.player.hp = 100');
check(await ev('__gg.save.wave') === 2, 'the wave reached is saved');

// memory: waves come and go, parts get torn off, without leaking shapes or textures
await ev('__gg.renderNow()');
const mem0 = await ev('({ g: __gg.renderer.info.memory.geometries, t: __gg.renderer.info.memory.textures })');
for (let i = 0; i < 4; i++){
  await ev(`(() => { const G = __gg; for (const a of G.aliens.slice(0, 6)){ if (!a.dead && !a.climb){ a.tear('foreL'); a.tear('head'); } } for (const a of G.aliens) a.die(); G.advance(1); G.startWave(1, true); G.advance(0.5); G.renderNow(); })()`);
}
const mem1 = await ev('({ g: __gg.renderer.info.memory.geometries, t: __gg.renderer.info.memory.textures })');
check(mem1.g <= mem0.g + 1 && mem1.t <= mem0.t + 2, `memory stays flat over waves (geometries ${mem0.g} → ${mem1.g}, textures ${mem0.t} → ${mem1.t})`);
const calls = await ev('(() => { __gg.standAt(__gg.START); __gg.renderNow(); return __gg.renderer.info.render.calls; })()');
check(calls < 260, `draw calls: ${calls}`);
// saving
check(await ev(`JSON.parse(localStorage.getItem('glue-gunner-v1')).score === __gg.save.score`), 'the game is saved');

// ---------- VR ----------
if (IWER){
  await ev('__gg.xrScale = 0.2; __gg.renderer.shadowMap.autoUpdate = false;');
  // (headless headset frames are slow in software: the deck is hidden except for the screenshots)
  const scenery = (on) => ev(`__gg.world.root.visible = ${on}; __gg.world.clouds.visible = ${on};`);
  await ev('__gg.toTitle()'); await ev('__gg.paused = false');
  await ev('__gg.startVR(false)'); await scenery(false);
  await pg.waitForFunction('__gg.mode === "vr"', null, { timeout: 30000 });
  check(true, 'VR session starts');
  await ev(`(() => { const d = window.__iwer; d.position.set(0, 1.6, 0); d.quaternion.set(0, 0, 0, 1);
    d.controllers.left.position.set(-0.2, 1.3, -0.35); d.controllers.left.quaternion.set(0, 0, 0, 1);
    d.controllers.right.position.set(0.2, 1.3, -0.35); d.controllers.right.quaternion.set(0, 0, 0, 1); })()`);
  await pg.waitForFunction('__gg.vrs.posed', null, { timeout: 30000 });
  await nextFrame(); await nextFrame();
  check(await ev('__gg.vr[0].tracked && __gg.vr[1].tracked'), 'both controllers are tracked');
  check(await ev('__gg.gunL.visible && __gg.gunR.visible'), 'a glue gun in each hand');
  const head = await ev('__gg.head');
  check(Math.hypot(head[0] - (-44), head[2] - 0) < 0.6, `you start at the end of the deck (${head.map((v) => v.toFixed(1))})`);
  for (const a of [0]) void a;
  // hold the aliens still, put one in front of you, and shoot it with the right trigger
  await ev(`(() => { const G = __gg; for (const a of G.aliens){ a.hold = true; a.noticeT = 1e9; a.state = 'prowl'; } const h = G.head; G.aliens[0].place(h[0] - 6, h[2], -Math.PI / 2); })()`);
  await ev(`(() => { const R = __gg.vr[1], a = __gg.aliens[0], V = __gg.rig.position.constructor; const p = new V(); a.boneWorld('chest', p);
    const d = p.sub(R.rayPos).normalize().applyQuaternion(__gg.rig.quaternion.clone().invert());
    const q = new __gg.rig.quaternion.constructor().setFromUnitVectors(new V(0, 0, -1), d);
    window.__iwer.controllers.right.quaternion.set(q.x, q.y, q.z, q.w); })()`);
  await nextFrame(); await nextFrame();
  await scenery(true); await nextFrame(); await pg.screenshot({ path: path.join(OUT, '20-vr-aim.png'), timeout: 120000 }); await scenery(false);
  await ev(`window.__iwer.controllers.right.updateButtonValue('trigger', 1)`); await nextFrame(); await nextFrame();
  await ev(`window.__iwer.controllers.right.updateButtonValue('trigger', 0)`); await nextFrame(); await nextFrame();
  await pg.waitForFunction('!!__gg.glue.pending || __gg.glue.flying.length', null, { timeout: 20000 }).catch(() => {});
  check(await ev('!!__gg.glue.pending || __gg.glue.flying.length > 0'), 'the right trigger shoots glue');
  await scenery(true); for (let i = 0; i < 4; i++) await nextFrame();
  await pg.screenshot({ path: path.join(OUT, '21-vr-shot.png'), timeout: 120000 }); await scenery(false);
  // grip cuts the strings
  await ev(`window.__iwer.controllers.left.updateButtonValue('squeeze', 1)`); await nextFrame(); await nextFrame();
  await ev(`window.__iwer.controllers.left.updateButtonValue('squeeze', 0)`); await nextFrame(); await nextFrame();
  check(!(await ev('__gg.glue.pending')), 'the grip cuts the strings');
  // walking
  const h0 = await ev('__gg.head');
  await ev(`window.__iwer.controllers.left.updateAxes('thumbstick', 0, -0.9)`); await nextFrame(); await nextFrame();
  await ev('__gg.advance(1.5)');
  await ev(`window.__iwer.controllers.left.updateAxes('thumbstick', 0, 0)`); await nextFrame(); await nextFrame();
  const h1 = await ev('__gg.head');
  check(Math.hypot(h1[0] - h0[0], h1[2] - h0[2]) > 2, 'the left stick walks you');
  // the menu: X opens it in front of you, its buttons work with the trigger
  await ev(`window.__iwer.controllers.left.updateButtonValue('x-button', 1)`); await nextFrame(); await nextFrame();
  await ev(`window.__iwer.controllers.left.updateButtonValue('x-button', 0)`); await nextFrame(); await nextFrame();
  check(await ev(`!!__gg.vrPage && __gg.vrPage.title.includes('Menu') && __gg.vrPanel.mesh.visible`), 'X opens the menu board');
  const inFront = await ev(`(() => { const m = __gg.vrPanel.mesh.position, h = __gg.head; return Math.hypot(m.x - h[0], m.z - h[2]) > 0.8 && Math.abs(m.y - h[1]) < 0.5; })()`);
  check(inFront, 'in front of you at head height');
  const aim = await ev(`(() => { const T = __gg.vrPanel, h = T.hits.find((x) => /Smooth/.test(x.b.label)); if (!h) return null;
    const u = (h.x + h.w / 2) / T.W, v = 1 - (h.y + h.h / 2) / T.H;
    return T.mesh.localToWorld(new T.mesh.position.constructor((u - 0.5) * 0.8, (v - 0.5) * 1.0, 0)).toArray(); })()`);
  if (check(!!aim, 'the menu has a Smooth turn button')){
    await ev(`(() => { const R = __gg.vr[1], target = new __gg.rig.position.constructor(...${JSON.stringify(aim)});
      const d = target.sub(R.rayPos).normalize().applyQuaternion(__gg.rig.quaternion.clone().invert());
      const q = new __gg.rig.quaternion.constructor().setFromUnitVectors(new __gg.rig.position.constructor(0, 0, -1), d);
      window.__iwer.controllers.right.quaternion.set(q.x, q.y, q.z, q.w); })()`);
    await nextFrame(); await nextFrame(); await nextFrame();
    await pg.screenshot({ path: path.join(OUT, '22-vr-menu.png'), timeout: 120000 });
    await ev(`window.__iwer.controllers.right.updateButtonValue('trigger', 1)`); await nextFrame(); await nextFrame();
    await ev(`window.__iwer.controllers.right.updateButtonValue('trigger', 0)`); await nextFrame(); await nextFrame();
    check(await ev('__gg.save.turn') === 'smooth', 'pointing and pulling the trigger on the menu works (smooth turning)');
  }
  await ev(`window.__iwer.controllers.right.updateButtonValue('b-button', 1)`); await nextFrame(); await nextFrame();
  await ev(`window.__iwer.controllers.right.updateButtonValue('b-button', 0)`); await nextFrame(); await nextFrame();
  check(!(await ev('__gg.vrPage')), 'B closes the menu');
  await scenery(true);
  await ev('__gg.renderer.xr.getSession().end()'); await wait(500);
  check(await ev('__gg.mode') === 'title', 'leaving VR goes back to the title');
}
void FULL;

check(errors.length === 0, 'no errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
console.log(`${failures ? failures + ' FAILED' : 'all passed'} in ${Math.round((Date.now() - started) / 1000)} s; screenshots in ${OUT}`);
await browser.close(); server.close();
process.exit(failures ? 1 : 0);
