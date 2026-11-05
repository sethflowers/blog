// Plays VR Test in headless Chromium through a real WebXR session, using Meta's emulated Quest 3
// (IWER) for the headset and controllers, checks it, and saves screenshots.
//
//   npm i --prefix _tools/vr-test iwer        (once)
//   NODE_PATH=$(npm root -g) node _tools/vr-test/test.mjs [outDir]
//
// Serves the repo the way Jekyll would publish it (front matter stripped, version filled in). Then:
//  - the title screen loads and shows the version; Enter VR starts a session
//  - your height is measured; looking down shows your body, legs and feet
//  - the left stick walks you, the right stick turns you, A jumps
//  - your hands sit on the controllers and the fingers follow trigger, grip and thumb touches
//  - the sword can be picked up and really cuts a melon; it goes in the hip holster
//  - the pistol shoots a bottle off the range rail
//  - a chicken can be picked up; the mirror shows you; a villager talks to you
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(HERE, '../..');
const OUT = path.resolve(process.argv[2] || 'vr-test-shots');
fs.mkdirSync(OUT, { recursive: true });
let iwerPath;
try { iwerPath = require.resolve('iwer/build/iwer.min.js', { paths: [HERE, ...(process.env.NODE_PATH || '').split(':')] }); }
catch (e) { console.error('IWER is missing: run  npm i --prefix _tools/vr-test iwer'); process.exit(2); }
const IWER = fs.readFileSync(iwerPath, 'utf8');

const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.html': 'text/html' };
function page(name){
  const src = fs.readFileSync(path.join(ROOT, '_experiments', name + '.html'), 'utf8');
  const fm = src.match(/^---\n([\s\S]*?)\n---\n/);
  const version = (fm[1].match(/version:\s*"?([^"\n]+)"?/) || [])[1];
  return src.slice(fm[0].length).replace(/\{% endraw %\}\{\{ page\.version \}\}\{% raw %\}/g, version).replace(/\{% (end)?raw %\}/g, '');
}
const VERSION = (fs.readFileSync(path.join(ROOT, '_experiments/vr-test.html'), 'utf8').match(/version:\s*"?([^"\n]+)"?/) || [])[1];
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
const BASE = `http://127.0.0.1:${server.address().port}/experiments/vr-test/`;

let failures = 0;
const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) failures++; return ok; };

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
// the emulated headset goes in before the page's own scripts run
await ctx.addInitScript({ content: IWER + `
;window.__iwer = new IWER.XRDevice(IWER.metaQuest3, { stereoEnabled: false });
window.__iwer.installRuntime({ forceInstall: true });
// test helpers: poses are given in world space and turned into the headset's tracking space
window.__t = {
  frames(n = 1){ return new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }); },
  local(p){ const T = window.__vrtest; return T.rig.worldToLocal(new T.rig.position.constructor(...p)); },
  localQ(q){ const T = window.__vrtest; return T.rig.quaternion.clone().invert().multiply(new T.rig.quaternion.constructor(...q)); },
  head(p, yaw = 0, pitch = 0){
    const T = window.__vrtest, L = this.local(p), d = window.__iwer;
    d.position.set(L.x, L.y, L.z);
    const Q = T.rig.quaternion.constructor, E = new (T.rig.rotation.constructor)(pitch, yaw - T.rig.rotation.y, 0, 'YXZ');
    const q = new Q().setFromEuler(E); d.quaternion.set(q.x, q.y, q.z, q.w);
  },
  // put the GRIP (palm) of a controller at a world position and orientation
  async grip(side, p, q){
    const T = window.__vrtest, h = T.hands[side === 'left' ? 0 : 1], c = window.__iwer.controllers[side];
    const Q = T.rig.quaternion.constructor, V = T.rig.position.constructor;
    for (let it = 0; it < 3; it++){
      await this.frames(1);
      if (!h.rayQuat) continue;
      // grip = ray * offset, measured from the last frame
      const off = h.rayQuat.clone().invert().multiply(h.quat);
      const offPos = h.pos.clone().sub(h.rayPos).applyQuaternion(h.rayQuat.clone().invert());
      const gq = new Q(...q), rq = gq.clone().multiply(off.clone().invert());
      const rp = new V(...p).sub(offPos.applyQuaternion(rq));
      const L = this.local(rp.toArray()), LQ = T.rig.quaternion.clone().invert().multiply(rq);
      c.position.set(L.x, L.y, L.z); c.quaternion.set(LQ.x, LQ.y, LQ.z, LQ.w);
    }
    await this.frames(1);
  },
  btn(side, id, v){ const c = window.__iwer.controllers[side]; c.updateButtonValue(id, v); },
  touch(side, id, t){ const c = window.__iwer.controllers[side]; c.updateButtonTouch(id, t); },
  stick(side, x, y){ window.__iwer.controllers[side].updateAxes('thumbstick', x, y); },
  teleport(x, z, yaw = 0){ const T = window.__vrtest; T.rig.position.set(x, 0, z); T.rig.rotation.set(0, yaw, 0); T.rig.updateMatrixWorld(true); },
};
` });
const pg = await ctx.newPage();
const errors = [];
pg.on('pageerror', (e) => errors.push(e.message));
pg.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const shot = (name) => pg.screenshot({ path: path.join(OUT, name + '.png') });
const ev = (s) => pg.evaluate(s);
const wait = (ms) => pg.waitForTimeout(ms);
// headless frames are slow and the game caps its time step, so wait on the game's own clock
const waitGame = async (sec) => { const t0 = await ev('__vrtest.time'); while ((await ev('__vrtest.time')) - t0 < sec) await wait(40); };
const q = (yaw, pitch = 0, roll = 0) => ev(`(() => { const T = __vrtest, Q = T.rig.quaternion.constructor, E = T.rig.rotation.constructor; return new Q().setFromEuler(new E(${pitch}, ${yaw}, ${roll}, 'YXZ')).toArray(); })()`);

console.log('VR Test ' + VERSION);
await pg.goto(BASE);
await wait(1500);
check((await pg.textContent('.build-version')).includes(VERSION), 'title shows version ' + VERSION);
check(await ev(`!document.getElementById('enter-vr').disabled`), 'Enter VR is offered (emulated headset found)');
await shot('01-title');

// ---- into VR ----
await ev(`__iwer.position.set(0, 1.7, 0)`);
await pg.click('#enter-vr');
await wait(500);
await waitGame(3);
check(await ev(`__vrtest.mode`) === 'vr', 'Enter VR starts an immersive session');
check(Math.abs(await ev(`__vrtest.eyeHeight`) - 1.7) < 0.05, 'measures your eye height (1.7 m)');
// hands out in front, then look down at yourself
await ev(`__t.head([0, 1.7, 1.2], 0, -1.1)`);
await ev(`__t.grip('left', [-0.25, 1.15, 0.85], ${JSON.stringify(await q(0, 0.6))})`);
await ev(`__t.grip('right', [0.25, 1.15, 0.85], ${JSON.stringify(await q(0, 0.6))})`);
await wait(800);
const hp = await ev(`(() => { const h = __vrtest.hands[1], a = __vrtest.avatar; return { d: a.hands[1].group.position.distanceTo(h.pos), feet: a.feet.map(f => f.pos.y), pelvis: a.pelvis.y } })()`);
check(hp.d < 0.01, 'the right hand model sits on the right controller');
check(hp.feet.every((y) => Math.abs(y) < 0.05) && hp.pelvis > 0.75 && hp.pelvis < 1.05, `feet on the ground, hips at ${hp.pelvis.toFixed(2)} m`);
await shot('02-look-down');

// fingers follow the buttons
await ev(`__t.btn('right', 'trigger', 1); __t.btn('right', 'squeeze', 1); __t.touch('right', 'a-button', true)`);
await wait(400);
let pose = await ev(`({ ...__vrtest.avatar.hands[1].pose })`);
check(pose.index > 0.9 && pose.grip > 0.9 && pose.thumb > 0.9, 'trigger, grip and thumb touch curl the fingers into a fist');
await ev(`__t.btn('right', 'trigger', 0); __t.touch('right', 'trigger', false); __t.btn('right', 'squeeze', 0); __t.touch('right', 'a-button', false)`);
await wait(400);
pose = await ev(`({ ...__vrtest.avatar.hands[1].pose })`);
check(pose.index < 0.15 && pose.thumb < 0.15, 'lifting the finger and thumb opens them (pointing)');
await ev(`__t.head([0, 1.7, 1.2], 0, -0.25)`);
await ev(`__t.grip('left', [-0.2, 1.3, 0.75], ${JSON.stringify(await q(0, 0.3))})`);
await ev(`__t.grip('right', [0.2, 1.3, 0.75], ${JSON.stringify(await q(0, 0.3))})`);
await ev(`__t.btn('left', 'squeeze', 1); __t.touch('left', 'thumbstick', true)`);
await wait(500);
await shot('03-hands');
await ev(`__t.btn('left', 'squeeze', 0); __t.touch('left', 'thumbstick', false)`);

// ---- walking and turning ----
let z0 = await ev(`__vrtest.rig.position.z`);
await ev(`__t.head([0, 1.7, 1.2], 0, 0)`);
await ev(`__t.stick('left', 0, -1)`);
await waitGame(1);
await ev(`__t.stick('left', 0, 0)`);
await waitGame(0.3);
let z1 = await ev(`__vrtest.rig.position.z`);
check(z0 - z1 > 1.0 && z0 - z1 < 3.5, `left stick walks forward (${(z0 - z1).toFixed(2)} m)`);
let yaw0 = await ev(`__vrtest.rig.rotation.y`);
await ev(`__t.stick('right', 1, 0)`); await waitGame(0.5); await ev(`__t.stick('right', 0, 0)`); await waitGame(0.2);
let yaw1 = await ev(`__vrtest.rig.rotation.y`);
check(yaw1 < yaw0 - 0.3, `right stick turns you right (${((yaw0 - yaw1) * 180 / Math.PI).toFixed(0)}°)`);
// snap turn
await ev(`__t.btn('left', 'y-button', 1)`); await wait(150); await ev(`__t.btn('left', 'y-button', 0)`); await wait(150);
check(await ev(`__vrtest.settings.smoothTurn`) === false, 'Y switches to snap turning');
yaw0 = await ev(`__vrtest.rig.rotation.y`);
await ev(`__t.stick('right', -1, 0)`); await wait(400); await ev(`__t.stick('right', 0, 0)`); await wait(200);
yaw1 = await ev(`__vrtest.rig.rotation.y`);
check(Math.abs(yaw1 - yaw0 - Math.PI / 6) < 0.01, 'snap turn is one 30° step');
await ev(`__t.btn('left', 'y-button', 1)`); await wait(150); await ev(`__t.btn('left', 'y-button', 0)`); await wait(150);
// jump
await ev(`__t.btn('right', 'a-button', 1)`); await waitGame(0.25);
const hy = await ev(`__vrtest.rig.position.y`);
await ev(`__t.btn('right', 'a-button', 0)`); await waitGame(1.2);
check(hy > 0.2 && Math.abs(await ev(`__vrtest.rig.position.y`)) < 0.02, `A jumps (${hy.toFixed(2)} m up) and you land`);
// walking into the table stops you
await ev(`__t.teleport(0, 0.4, 0); __t.head([0, 1.7, 0.4], 0, 0)`);
await ev(`__t.stick('left', 0, -1)`); await waitGame(1.5); await ev(`__t.stick('left', 0, 0)`);
const headZ = await ev(`__vrtest.head[2]`);
check(headZ > -1.2, `the table blocks you (head stopped at z=${headZ.toFixed(2)})`);

// ---- the sword ----
await ev(`__t.teleport(0, -0.5, 0); __t.head([0, 1.7, -0.6], 0, -0.6)`);
await wait(300);
const swordGrab = await ev(`(() => { const s = __vrtest.items.get('sword'); return s.grabPoint.clone().applyMatrix4(s.mesh.matrixWorld).toArray(); })()`);
await ev(`__t.grip('right', ${JSON.stringify(swordGrab)}, ${JSON.stringify(await q(0, 0.4))})`);
await ev(`__t.btn('right', 'squeeze', 1)`);
await wait(300);
check(await ev(`__vrtest.hands[1].held && __vrtest.hands[1].held.kind`) === 'sword', 'grip picks up the sword');
await ev(`__t.grip('right', [0.3, 1.3, -0.95], ${JSON.stringify(await q(0, 0.7))})`);
await wait(300);
await shot('04-sword');
// walk up to the first melon and chop down through it
await waitGame(4);
const melon = await ev(`(() => { const p = __vrtest.items.posts[0]; return p.item ? p.item.mesh.position.toArray() : null })()`);
check(!!melon, 'a melon sits on the first post');
if (melon){
  await ev(`__t.teleport(${melon[0]}, ${melon[2] + 0.75}, 0); __t.head([${melon[0]}, 1.7, ${melon[2] + 0.75}], 0, -0.5)`);
  await wait(300);
  const bladeLeft = await q(Math.PI / 2);   // blade pointing to -x
  const hx = melon[0] + 0.5, hz = melon[2];
  await ev(`__t.grip('right', [${hx}, 1.7, ${hz}], ${JSON.stringify(bladeLeft)})`);
  await wait(200);
  await ev(`(async () => {
    const c = __iwer.controllers.right, L0 = c.position.y;
    for (let k = 1; k <= 8; k++){ c.position.y = L0 - k * 0.12; await __t.frames(1); }
  })()`);
  await wait(300);
  const cuts = await ev(`__vrtest.items.events.filter(e => e.type === 'cut').length`);
  check(cuts >= 1, 'a fast downward swing cuts the melon');
  const pieces = await ev(`__vrtest.items.list.filter(i => i.kind === 'piece').length`);
  check(pieces >= 2, `the melon falls apart in pieces (${pieces})`);
  await ev(`__t.head([${melon[0]}, 1.7, ${melon[2] + 0.75}], 0, -0.7)`);
  await wait(700);
  await shot('05-melon-cut');
}
// holster the sword on the left hip
await ev(`__t.teleport(0, 0.6, 0); __t.head([0, 1.7, 0.6], 0, -0.9)`);
await wait(600);
const hol = await ev(`__vrtest.holsters[0].pos.toArray()`);
await ev(`__t.grip('right', ${JSON.stringify(hol)}, ${JSON.stringify(await q(0, -1.2))})`);
await ev(`__t.btn('right', 'squeeze', 0)`);
await waitGame(0.3);
const rel = await ev(`__vrtest.items.events.filter(e => e.type === 'release' && e.kind === 'sword').pop() || null`);
check(await ev(`__vrtest.holsters[0].item && __vrtest.holsters[0].item.kind`) === 'sword', 'letting go by the left hip holsters the sword' + (rel && rel.holsterDist != null ? ` (released ${rel.holsterDist.toFixed(2)} m away)` : ''));
await ev(`__t.grip('right', [0.25, 1.2, 0.3], ${JSON.stringify(await q(0, 0.3))})`);
await wait(300);
await shot('06-holstered');

// ---- the pistol ----
await ev(`__t.teleport(0, -0.5, 0); __t.head([0, 1.7, -0.6], 0, -0.5)`);
await wait(300);
const gunGrab = await ev(`(() => { const s = __vrtest.items.get('gun'); return s.grabPoint.clone().applyMatrix4(s.mesh.matrixWorld).toArray(); })()`);
await ev(`__t.grip('right', ${JSON.stringify(gunGrab)}, ${JSON.stringify(await q(0, 0.4))})`);
await ev(`__t.btn('right', 'squeeze', 1)`);
await wait(300);
check(await ev(`__vrtest.hands[1].held && __vrtest.hands[1].held.kind`) === 'gun', 'grip picks up the pistol');
await ev(`__t.teleport(0, -6.5, 0); __t.head([0, 1.7, -6.5], 0, -0.05)`);
await waitGame(2.5);
const bottle = await ev(`(() => { const b = __vrtest.items.list.find(i => i.kind === 'bottle' && Math.abs(i.mesh.position.x) < 0.8); return b ? b.mesh.position.toArray() : null })()`);
check(!!bottle, 'bottles stand on the range rail');
if (bottle){
  // point the controller's ray at the bottle
  await ev(`(async () => {
    const T = __vrtest, h = T.hands[1], c = __iwer.controllers.right;
    const V = T.rig.position.constructor, Q = T.rig.quaternion.constructor;
    const from = new V(0.2, 1.45, -6.8), to = new V(${bottle[0]}, ${bottle[1]}, ${bottle[2]});
    const dir = to.clone().sub(from).normalize();
    const q = new Q().setFromUnitVectors(new V(0, 0, -1), dir);
    const L = __t.local(from.toArray()), LQ = __t.localQ(q.toArray());
    c.position.set(L.x, L.y, L.z); c.quaternion.set(LQ.x, LQ.y, LQ.z, LQ.w);
    await __t.frames(3);
  })()`);
  await shot('07-aim');
  await ev(`__t.btn('right', 'trigger', 1)`); await wait(60);
  await shot('08-shot');
  await ev(`__t.btn('right', 'trigger', 0)`); await wait(300);
  const shots = await ev(`__vrtest.items.events.filter(e => e.type === 'shot')`);
  check(shots.length >= 1, 'the trigger fires the pistol');
  check(shots.some((s) => s.kind === 'bottle'), `the shot hits the bottle (hit: ${shots.map((s) => s.kind || s.hit).join(', ')})`);
  check(await ev(`__vrtest.items.events.some(e => e.type === 'shatter')`), 'the bottle shatters');
}
// put the gun in the right holster
const hol2 = await ev(`__vrtest.holsters[1].pos.toArray()`);
await ev(`__t.grip('right', ${JSON.stringify(hol2)}, ${JSON.stringify(await q(0, -1.2))})`);
await ev(`__t.btn('right', 'squeeze', 0)`); await wait(300);
check(await ev(`__vrtest.holsters[1].item && __vrtest.holsters[1].item.kind`) === 'gun', 'the pistol goes in the right hip holster');

// ---- a chicken ----
const chick = await ev(`(() => { const c = __vrtest.creatures.list.find(c => c.kind === 'chicken'); c.state = 'idle'; c.timer = 99; return [c.pos.x, c.pos.z]; })()`);
await ev(`__t.teleport(${chick[0]}, ${chick[1] + 0.9}, 0); __t.head([${chick[0]}, 1.7, ${chick[1] + 0.9}], 0, -0.9)`);
await ev(`(() => { const c = __vrtest.creatures.list.find(c => c.kind === 'chicken'); c.state = 'idle'; c.timer = 99; })()`);
await wait(200);
const cc = await ev(`(() => { const c = __vrtest.creatures.list.find(c => c.kind === 'chicken'); c.state = 'idle'; c.timer = 99; return __vrtest.creatures.center(c).toArray(); })()`);
await ev(`__t.grip('right', ${JSON.stringify(cc)}, ${JSON.stringify(await q(0, 0.3))})`);
await ev(`__t.btn('right', 'squeeze', 1)`); await wait(300);
check(await ev(`!!__vrtest.hands[1].heldCreature`), 'grip picks up a chicken');
await ev(`__t.grip('right', [${chick[0] + 0.2}, 1.35, ${chick[1] + 0.5}], ${JSON.stringify(await q(0, 0.3))})`);
await ev(`__t.head([${chick[0]}, 1.7, ${chick[1] + 0.9}], 0, -0.3)`);
await wait(300);
await shot('09-chicken');
await ev(`__t.btn('right', 'squeeze', 0)`); await waitGame(2);
check(await ev(`!__vrtest.hands[1].heldCreature && !__vrtest.creatures.list.find(c => c.kind === 'chicken').air`), 'let go, the chicken flaps down and lands');

// ---- the mirror ----
const M = await ev(`({ x: -4.2, z: -1.2 })`);
await ev(`__t.teleport(${M.x + 1.7}, ${M.z}, 0); __t.head([${M.x + 1.7}, 1.7, ${M.z}], Math.PI / 2, -0.1)`);
await ev(`__t.grip('left', [${M.x + 1.4}, 1.9, ${M.z - 0.3}], ${JSON.stringify(await q(Math.PI / 2, 0.2))})`);
await ev(`__t.grip('right', [${M.x + 1.3}, 1.2, ${M.z + 0.35}], ${JSON.stringify(await q(Math.PI / 2, 0.6))})`);
await wait(1200);
check(await ev(`(() => { let g = __vrtest.mirrorAvatar.root.parent; return g.visible })()`), 'standing in front of the mirror shows your reflection');
await shot('10-mirror');

// ---- a villager ----
const mara = await ev(`__vrtest.villagers.list[0].pos.toArray()`);
await ev(`__t.teleport(${mara[0]}, ${mara[2] + 2}, 0); __t.head([${mara[0]}, 1.7, ${mara[2] + 2}], 0, 0)`);
await waitGame(2.5);
const talk = await ev(`(() => { const n = __vrtest.villagers.list[0]; return { text: n.text, bubble: n.bubble.visible, wave: n.waveT } })()`);
check(talk.bubble && talk.text.length > 0, `Mara turns to you and talks ("${talk.text}")`);
await shot('11-villager');

// ---- animals and the wider view ----
await ev(`__t.teleport(8, 0, 0); __t.head([8, 1.7, 0], 0.4, -0.15)`);
await wait(1500);
await shot('12-animals');
const info = await ev(`({ calls: __vrtest.renderer.info.render.calls, tris: __vrtest.renderer.info.render.triangles })`);
console.log(`  info  ${info.calls} draw calls, ${info.tris} triangles in the last frame`);
check(info.calls < 400, 'draw calls stay modest');

check(errors.length === 0, 'no errors on the page' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close();
server.close();
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
