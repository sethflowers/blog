// Plays Alien Hunter in headless Chromium, checks it, and saves screenshots. Quick (about a minute).
//
//   npm i --prefix _tools/vr-test iwer        (once; the VR part uses Meta's emulated Quest 3)
//   NODE_PATH=$(npm root -g) node _tools/alien-hunter/test.mjs [outDir]
//
// Serves the repo the way Jekyll would publish it (front matter stripped, version filled in). Checks:
// the loading screen, the title and version, the welcome, walking (and walls stopping you), doors
// opening, going into a house, the X-ray tablet revealing a person and an alien, zapping an alien
// (it falls down dead) and a person (they say ow), clearing a town and the next one, no z-fighting
// in the scenery, memory staying flat over several towns, saving, and in VR: the tablet and gun in
// your hands, the tablet's X-ray screen scanning, zapping with the trigger, walking, the menu board.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(HERE, '../..');
const OUT = path.resolve(process.argv[2] || 'alien-hunter-shots');
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
const VERSION = (fs.readFileSync(path.join(ROOT, '_experiments/alien-hunter.html'), 'utf8').match(/version:\s*"?([^"\n]+)"?/) || [])[1];
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
const BASE = `http://127.0.0.1:${server.address().port}/experiments/alien-hunter/`;

let failures = 0;
const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) failures++; return ok; };
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
// the game is run forward inside the page (__ah.advance) instead of waiting for frames, and nothing
// is drawn except one frame for each screenshot
const shot = async (name) => { await ev('__ah.renderNow()'); await pg.screenshot({ path: path.join(OUT, name + '.png'), timeout: 120000 }); };
const nextFrame = async () => { const t = await ev('__ah.time'), start = Date.now(); while ((await ev('__ah.time')) === t && Date.now() - start < 20000) await wait(30); };
const until = async (expr, sec, what) => check(await ev(`__ah.advance(${sec}, () => (${expr}))`), what + ((await ev(expr)) ? '' : ' (timed out)'));

console.log('Alien Hunter ' + VERSION);
const started = Date.now();
await pg.goto(BASE);
await pg.waitForFunction('window.__ah', null, { timeout: 120000 }).catch((e) => { console.log('the game did not start:', errors.join(' | ')); throw e; });
await ev('localStorage.clear()');
await ev('__ah.noRender = true');
await wait(500);
check((await pg.textContent('.build-version')).includes(VERSION), 'title shows version ' + VERSION);
if (!process.env.SKIP_LOADING){ const { checkLoading } = await import('../loading-check.mjs'); await checkLoading({ browser, url: BASE, check, main: pg, game: '__ah', shot: path.join(OUT, '00-loading.png') }); }
check(await ev('__ah.people.list.length') >= 10, 'people are walking about behind the title');
await shot('01-title');

// the scenery: no two surfaces in the same place
{
  const { findCoplanar } = await import('../coplanar.mjs');
  const flicker = findCoplanar(JSON.parse(await ev('JSON.stringify(globalThis.__boxLog)'))).filter((h) => h.area >= 0.005);
  check(flicker.length === 0, `no flickering (coplanar) scenery faces${flicker.length ? ': ' + flicker.slice(0, 4).map((h) => `${h.a.m}/${h.b.m} at ${h.a.p.map((v) => v.toFixed(2))}`).join(' | ') : ''}`);
}

// ---------- on screen ----------
await ev(`document.getElementById('b-play').click()`);
await wait(300);
check(await ev('__ah.mode') === 'screen', 'Play starts the game on the screen');
check(await ev(`!!document.querySelector('#panel.show') && document.querySelector('#panel h2').textContent.includes('Alien Hunter')`), 'a welcome explains how to hunt');
await shot('02-welcome');
await ev('__ah.closePanels()');
const L0 = await ev('({ n: __ah.lvl.n, count: __ah.people.list.length, aliens: __ah.people.list.filter((p) => p.alien).length })');
check(L0.n === 1 && L0.count === 12 && L0.aliens >= 5 && L0.aliens <= 7, `town 1: 12 people, about half of them aliens (${L0.aliens})`);
await shot('03-street');
// close up: some townsfolk
await ev(`(() => { const p = __ah.people.list.find((p) => Math.min(Math.abs(p.pos.x), Math.abs(p.pos.z)) < 7) || __ah.people.list[0];
  for (const q of __ah.people.list){ q.state = 'idle'; q.wait = 3; q.path = []; }
  const s = { x: Math.abs(p.pos.x) < 7 ? p.pos.x * 0.2 : p.pos.x, z: Math.abs(p.pos.x) < 7 ? p.pos.z : p.pos.z * 0.2 };
  __ah.standAt(s); __ah.aimAt(p); __ah.player.pitch -= 0.05; })()`);
await shot('03b-people');
// walking
await ev('__ah.standAt(__ah.START)');
const p0 = await ev('__ah.player.pos.clone()');
await ev('__ah.stick.y = -1'); await ev('__ah.advance(1.5)'); await ev('__ah.stick.y = 0');
check(await ev(`__ah.player.pos.distanceTo(new __ah.player.pos.constructor(${p0.x}, ${p0.y}, ${p0.z}))`) > 4, 'the thumb stick walks you forward');
// a wall stops you: walk into the side of the first house on Main Street
await ev('__ah.standAt({ x: -52, z: -9, yaw: Math.PI / 2 })');   // in its front yard, facing west, alongside the wall
await ev('__ah.standAt({ x: -46.5, z: -14.5, yaw: Math.PI / 2 })');
await ev('__ah.stick.y = -1'); await ev('__ah.advance(2)'); await ev('__ah.stick.y = 0');
check(await ev('__ah.player.pos.x') > -48.1, `walls stop you (x ${(await ev('__ah.player.pos.x')).toFixed(2)})`);
// doors: walk up to a house's door and it opens; walk in
const H = await ev(`(() => { const h = __ah.town.houses.find((h) => !h.shop); const n = __ah.town.nodes; return { porch: n[h.porch], inside: n[h.inside], id: h.id, yaw: h.yaw }; })()`);
await ev(`__ah.standAt({ x: ${H.porch.x}, z: ${H.porch.z}, yaw: ${H.yaw} })`);
await ev('__ah.advance(1)');
check(await ev(`__ah.town.doors[${H.id}].a`) > 1, 'a door swings open when you walk up to it');
// (someone standing in the doorway: you slip past them after pushing for half a second)
await ev(`(() => { const n = __ah.town.nodes, h = __ah.town.houses[${H.id}], q = __ah.people.list[0]; q.state = 'idle'; q.wait = 1e9; q.path = []; q.target = null; q.pos.set(n[h.inside].x * 0.6 + n[h.porch].x * 0.4, 0.12, n[h.inside].z * 0.6 + n[h.porch].z * 0.4); })()`);
await ev('__ah.stick.y = -1'); await ev('__ah.advance(2.2)'); await ev('__ah.stick.y = 0');
check(await ev(`__ah.town.inHouse(__ah.player.pos.x, __ah.player.pos.z)?.id`) === H.id, 'you can walk in through the door (slipping past someone in the way)');
check(Math.abs(await ev('__ah.player.pos.y') - await ev('__ah.FLOOR_Y')) < 0.01, 'and stand on the floor inside');
await ev(`(() => { const h = __ah.town.houses[${H.id}], n = __ah.town.nodes[h.inside], p = h.toWorld(-1.2, -1.5); __ah.standAt({ x: n.x, z: n.z }); __ah.aimAt({ x: p.x, y: 1.0, z: p.z }); })()`);
await shot('04-inside-house');
const shopH = await ev(`(() => { const h = __ah.town.houses.find((h) => h.shop); const n = __ah.town.nodes; return { inside: n[h.inside], yaw: h.yaw }; })()`);
await ev(`__ah.standAt({ x: ${shopH.inside.x}, z: ${shopH.inside.z}, yaw: ${shopH.yaw} })`); await ev('__ah.player.pitch = -0.1');
await shot('05-inside-shop');

// the X-ray tablet: look at a real person and an alien until they're revealed
// (someone out on a sidewalk, seen from the middle of the street: walls stop the shock gun)
const look = async (cond) => ev(`(() => { const p = __ah.people.list.find((p) => (${cond}) && Math.min(Math.abs(p.pos.x), Math.abs(p.pos.z)) < 7) || __ah.people.list.find((p) => ${cond}); if (!p) return null;
  if (Math.min(Math.abs(p.pos.x), Math.abs(p.pos.z)) >= 7) p.pos.set(5.25, 0.12, -14 - p.id * 2);
  const s = { x: Math.abs(p.pos.x) < 7 ? 0 : p.pos.x, z: Math.abs(p.pos.z) < 7 ? 0 : p.pos.z, yaw: 0 };
  __ah.standAt(s); __ah.aimAt(p); return p.id; })()`);
// freeze people for the checks below (they'd walk out of view)
await ev(`for (const p of __ah.people.list){ p.state = 'idle'; p.wait = 1e9; p.path = []; p.target = null; }`);
await ev('__ah.toggleXray(true)');
check(await ev('__ah.xrayOn') && await ev(`getComputedStyle(document.getElementById('xray')).display !== 'none'`), 'the X-ray tablet comes up on screen');
const hid = await look('!p.alien && !p.dead');
await until(`__ah.people.list[${hid}].revealed`, 3, 'holding a person in the X-ray screen scans them');
await ev('__ah.advance(0.1)');
check(!(await ev(`__ah.people.list[${hid}].alien`)) && (await ev(`document.getElementById('xr-text').textContent`)).includes('human'), 'a real person shows up as human (bones inside)');
await shot('06-xray-human');
const aid = await look('p.alien && !p.dead');
await ev(`__ah.advance(0.4)`);
check(await ev('__ah.scan.progress') > 0, 'the tablet shows the scan going');
await until(`__ah.people.list[${aid}].revealed`, 3, 'an alien gets scanned');
await ev('__ah.advance(0.1)');
check(/ALIEN/.test(await ev(`document.getElementById('xr-text').textContent`)), 'and shows up as an ALIEN');
await shot('07-xray-alien');
// from the street, the X-ray sees through walls: someone inside a house
await ev(`(() => { const T = __ah.town, p = __ah.people.list.find((p) => !p.dead && T.nodes[p.node].kind === 'room'); if (!p) return;
  const h = T.houses[T.nodes[p.node].house], g = T.nodes[h.gateNode]; __ah.standAt({ x: g.x, z: g.z, yaw: 0 }); __ah.aimAt(p); __ah.player.pitch = -0.05; })()`);
await shot('07b-xray-through-wall');
// zap the alien: it falls down dead
check(await ev(`__ah.people.list[${aid}].flee`), 'a revealed alien runs away from you');
// (hold it still to aim)
const hold = (id) => ev(`(() => { const p = __ah.people.list[${id}]; p.state = 'idle'; p.wait = 1e9; p.path = []; p.target = null; p.flee = true; })()`);
await hold(aid);
await look(`p.id === ${aid}`);
const zr = await ev(`(() => { const r = __ah.zapScreen(innerWidth / 2, innerHeight / 2); const p = __ah.people.list[${aid}]; return { hit: r && r.id, state: p.state, d: Math.hypot(p.pos.x - __ah.player.pos.x, p.pos.z - __ah.player.pos.z), cool: 0 }; })()`);
if (process.env.DEBUG) console.log(zr);
await ev('__ah.advance(0.05)');
await shot('08-zap');
await ev('__ah.toggleXray(false)'); await ev('__ah.advance(0.15)');
await shot('08b-zapped-alien');
await until(`__ah.people.list[${aid}].dead`, 2, 'zapping an alien kills it');
await ev('__ah.advance(1.2)');
check(await ev(`__ah.people.list[${aid}].fall.rotation.x`) < -1.4, 'it falls down flat');
check(await ev('__ah.save.score') === 100, 'and scores 100');
await ev('__ah.toggleXray(false)');
await ev(`(() => { const p = __ah.people.list[${aid}]; __ah.standAt({ x: p.pos.x + 2.5, z: p.pos.z + 1.5, yaw: 0 }); __ah.aimAt({ x: p.pos.x, y: p.pos.y + 0.2, z: p.pos.z - 0.6 }); })()`);
await shot('09-dead-alien');
// zap a real person: ow, and points off
const hid2 = await look('!p.alien && !p.dead');
await hold(hid2); await look(`p.id === ${hid2}`);
await ev(`__ah.zapScreen(innerWidth / 2, innerHeight / 2)`);
await ev('__ah.advance(0.3)');
await shot('10-zap-human');
await until(`__ah.people.list[${hid2}].state !== 'zapped'`, 2, 'a zapped person recovers');
check(!(await ev(`__ah.people.list[${hid2}].dead`)) && await ev('__ah.save.score') === 50 && await ev('__ah.lvl.oops') === 1, 'zapping a real person doesn\'t kill them, costs 50 and counts a mistake');
// clear the town
await ev(`for (const p of __ah.people.list) if (p.alien && !p.dead){ p.revealed = true; __ah.people.zap(p); }`);
await until('__ah.people.aliensLeft === 0', 3, 'zapping every alien...');
await until(`!!document.querySelector('#panel.show') && document.querySelector('#panel h2').textContent.includes('cleared')`, 4, '...clears the town');
await shot('11-cleared');
check(await ev('__ah.save.town') === 2, 'the next town is saved');
await ev(`[...document.querySelectorAll('#panel button')].find((b) => /Next town/.test(b.textContent)).click()`);
check(await ev('__ah.lvl.n') === 2 && await ev('__ah.people.list.length') === 14, 'Next town: town 2 with 14 people');
// memory: towns come and go without leaking shapes or textures (everyone drawn, not just who's in view)
const drawAll = () => ev(`(() => { for (const p of __ah.people.list) p.root.traverse((o) => { o.frustumCulled = false; }); __ah.renderNow(); })()`);
await drawAll();
const mem0 = await ev('({ g: __ah.renderer.info.memory.geometries, t: __ah.renderer.info.memory.textures })');
for (let i = 0; i < 5; i++){ await ev(`(() => { const L = __ah.people.list; for (const p of L) if (p.alien){ __ah.people.zap(p); } __ah.advance(2); __ah.startTown(3); __ah.advance(1); __ah.renderNow(); })()`); }
await ev('__ah.startTown(2)'); await drawAll();
const mem1 = await ev('({ g: __ah.renderer.info.memory.geometries, t: __ah.renderer.info.memory.textures })');
check(mem1.g <= mem0.g && mem1.t <= mem0.t, `memory stays flat over towns (geometries ${mem0.g} → ${mem1.g}, textures ${mem0.t} → ${mem1.t})`);
const calls = await ev('(() => { __ah.standAt(__ah.START); __ah.renderNow(); return __ah.renderer.info.render.calls; })()');
check(calls < 300, `draw calls in the street: ${calls}`);
// saving
check(await ev(`JSON.parse(localStorage.getItem('alien-hunter-v1')).town === __ah.save.town && __ah.save.town >= 2`), 'the game is saved');

// ---------- VR ----------
if (IWER){
  await ev('__ah.xrScale = 0.3');
  await ev('__ah.startVR(false)');
  await pg.waitForFunction('__ah.mode === "vr"', null, { timeout: 30000 });
  check(true, 'VR session starts');
  await ev(`(() => { const d = window.__iwer; d.position.set(0, 1.6, 0); d.quaternion.set(0, 0, 0, 1);
    d.controllers.left.position.set(-0.15, 1.3, -0.35); d.controllers.left.quaternion.set(0, 0, 0, 1);
    d.controllers.right.position.set(0.2, 1.3, -0.3); d.controllers.right.quaternion.set(0, 0, 0, 1); })()`);
  await pg.waitForFunction('__ah.vrs.posed', null, { timeout: 30000 });
  await nextFrame(); await nextFrame();
  check(await ev('__ah.vr[0].tracked && __ah.vr[1].tracked'), 'both controllers are tracked');
  check(await ev('__ah.tabletVR.visible && __ah.gunVR.visible'), 'the tablet is in your left hand and the gun in your right');
  const head = await ev('__ah.head');
  check(Math.hypot(head[0] - 0, head[2] - 9) < 0.5, 'you start on Elm Street');
  // the tablet scans whoever it points at: put a person in front of you
  await ev(`(() => { for (const p of __ah.people.list){ p.state = 'idle'; p.wait = 1e9; p.path = []; } const p = __ah.people.list.find((p) => !p.dead);
    const h = __ah.head; p.pos.set(h[0] - 0.15, __ah.town.groundAt(h[0], h[2] - 4), h[2] - 4); window.__vrTarget = p.id; })()`);
  await nextFrame(); await nextFrame();
  await pg.waitForFunction('__ah.people.list[window.__vrTarget].revealed || __ah.scan.progress > 0', null, { timeout: 30000 }).catch(() => {});
  await pg.waitForFunction('__ah.people.list[window.__vrTarget].revealed', null, { timeout: 30000 }).catch(() => {});
  check(await ev('__ah.people.list[window.__vrTarget].revealed'), 'pointing the tablet at a person scans them');
  await pg.screenshot({ path: path.join(OUT, '20-vr-tablet.png'), timeout: 120000 });
  // zap with the trigger
  const tgt = await ev('__ah.people.list[window.__vrTarget].alien');
  // point the gun at them
  await ev(`(() => { const R = __ah.vr[1], p = __ah.people.list[window.__vrTarget], V = __ah.rig.position.constructor;
    const d = new V(p.pos.x, p.pos.y + 1.1, p.pos.z).sub(R.rayPos).normalize().applyQuaternion(__ah.rig.quaternion.clone().invert());
    const q = new __ah.rig.quaternion.constructor().setFromUnitVectors(new V(0, 0, -1), d);
    window.__iwer.controllers.right.quaternion.set(q.x, q.y, q.z, q.w); })()`);
  await nextFrame(); await nextFrame();
  await ev(`(() => { const p = __ah.people.list[window.__vrTarget]; p.state = 'idle'; p.wait = 1e9; p.path = []; p.target = null; p.flee = true; })()`);
  await ev(`(() => { const p = __ah.people.list[window.__vrTarget], h = __ah.head; p.pos.set(h[0] - 0.15, __ah.town.groundAt(h[0], h[2] - 4), h[2] - 4); })()`);
  await ev(`(() => { const R = __ah.vr[1], p = __ah.people.list[window.__vrTarget], V = __ah.rig.position.constructor;
    const d = new V(p.pos.x, p.pos.y + 1.1, p.pos.z).sub(R.rayPos).normalize().applyQuaternion(__ah.rig.quaternion.clone().invert());
    const q = new __ah.rig.quaternion.constructor().setFromUnitVectors(new V(0, 0, -1), d);
    window.__iwer.controllers.right.quaternion.set(q.x, q.y, q.z, q.w); })()`);
  await nextFrame(); await nextFrame();
  await ev(`window.__iwer.controllers.right.updateButtonValue('trigger', 1)`); await nextFrame(); await nextFrame();
  await ev(`window.__iwer.controllers.right.updateButtonValue('trigger', 0)`); await nextFrame(); await nextFrame();
  check(await ev(`__ah.people.list[window.__vrTarget].state === 'zapped' || __ah.people.list[window.__vrTarget].dead || __ah.lvl.oops > 0`), `the trigger zaps (hit the ${tgt ? 'alien' : 'person'} in front)`);
  await pg.screenshot({ path: path.join(OUT, '21-vr-zap.png'), timeout: 120000 });
  // walking
  const h0 = await ev('__ah.head');
  await ev(`window.__iwer.controllers.left.updateAxes('thumbstick', 0.6, 0)`); await nextFrame(); await nextFrame();
  await ev('__ah.advance(2)');
  await ev(`window.__iwer.controllers.left.updateAxes('thumbstick', 0, 0)`); await nextFrame(); await nextFrame();
  const h1 = await ev('__ah.head');
  check(Math.hypot(h1[0] - h0[0], h1[2] - h0[2]) > 2, 'the left stick walks you');
  // the menu: X opens it in front of you, its buttons work with the trigger
  await ev(`window.__iwer.controllers.left.updateButtonValue('x-button', 1)`); await nextFrame(); await nextFrame();
  await ev(`window.__iwer.controllers.left.updateButtonValue('x-button', 0)`); await nextFrame(); await nextFrame();
  check(await ev(`!!__ah.vrPage && __ah.vrPage.title.includes('Menu') && __ah.vrPanel.mesh.visible`), 'X opens the menu board');
  const inFront = await ev(`(() => { const m = __ah.vrPanel.mesh.position, h = __ah.head; return Math.hypot(m.x - h[0], m.z - h[2]) > 0.8 && Math.abs(m.y - h[1]) < 0.5; })()`);
  check(inFront, 'in front of you at head height');
  const aim = await ev(`(() => { const T = __ah.vrPanel, h = T.hits.find((x) => /Smooth/.test(x.b.label)); if (!h) return null;
    const u = (h.x + h.w / 2) / T.W, v = 1 - (h.y + h.h / 2) / T.H;
    return T.mesh.localToWorld(new T.mesh.position.constructor((u - 0.5) * 0.8, (v - 0.5) * 1.0, 0)).toArray(); })()`);
  if (check(!!aim, 'the menu has a Smooth turn button')){
    await ev(`(() => { const R = __ah.vr[1], target = new __ah.rig.position.constructor(...${JSON.stringify(aim)});
      const d = target.sub(R.rayPos).normalize().applyQuaternion(__ah.rig.quaternion.clone().invert());
      const q = new __ah.rig.quaternion.constructor().setFromUnitVectors(new __ah.rig.position.constructor(0, 0, -1), d);
      window.__iwer.controllers.right.quaternion.set(q.x, q.y, q.z, q.w); })()`);
    await nextFrame(); await nextFrame(); await nextFrame();
    await pg.screenshot({ path: path.join(OUT, '22-vr-menu.png'), timeout: 120000 });
    await ev(`window.__iwer.controllers.right.updateButtonValue('trigger', 1)`); await nextFrame(); await nextFrame();
    await ev(`window.__iwer.controllers.right.updateButtonValue('trigger', 0)`); await nextFrame(); await nextFrame();
    check(await ev('__ah.save.turn') === 'smooth', 'pointing and pulling the trigger on the menu works (smooth turning)');
  }
  await ev(`window.__iwer.controllers.right.updateButtonValue('b-button', 1)`); await nextFrame(); await nextFrame();
  await ev(`window.__iwer.controllers.right.updateButtonValue('b-button', 0)`); await nextFrame(); await nextFrame();
  check(!(await ev('__ah.vrPage')), 'B closes the menu');
  await ev('__ah.renderer.xr.getSession().end()'); await wait(500);
  check(await ev('__ah.mode') === 'title', 'leaving VR goes back to the title');
}

check(errors.length === 0, 'no errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
console.log(`${failures ? failures + ' FAILED' : 'all passed'} in ${Math.round((Date.now() - started) / 1000)} s; screenshots in ${OUT}`);
await browser.close(); server.close();
process.exit(failures ? 1 : 0);
