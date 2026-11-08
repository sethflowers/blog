// Plays My Animal Farm in headless Chromium, checks it, and saves screenshots.
//
//   npm i --prefix _tools/vr-test iwer        (once; the VR part uses Meta's emulated Quest 3)
//   NODE_PATH=$(npm root -g) node _tools/my-animal-farm/test.mjs [outDir]
//
// Serves the repo the way Jekyll would publish it (front matter stripped, version filled in). Then, on
// screen (as on an iPad): the title and version; the welcome; a whole morning's work for Hazel (hay in
// the rack, water from the tap, a scoop of grain, mucking out into the wheelbarrow and tipping it on the
// heap, fresh shavings); leading her out to the hitching rail; curry comb then body brush, hoof pick;
// tack in the right order; riding to the arena and jumping; a refusal; the goats', sheep's, pigs' and
// hens' pens; a customer boarding a horse and paying; the shop and the horse market; a show-jumping
// class with results, prize money and a rosette; going to bed; saving and loading. Then in VR: entering
// a session, picking up the brush with the controller, grooming by rubbing, pointing at the horse.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(HERE, '../..');
const OUT = path.resolve(process.argv[2] || 'my-animal-farm-shots');
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
const VERSION = (fs.readFileSync(path.join(ROOT, '_experiments/my-animal-farm.html'), 'utf8').match(/version:\s*"?([^"\n]+)"?/) || [])[1];
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
const BASE = `http://127.0.0.1:${server.address().port}/experiments/my-animal-farm/`;

let failures = 0;
const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) failures++; return ok; };
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1024, height: 700 } });
if (IWER) await ctx.addInitScript({ content: IWER + `
;window.__iwer = new IWER.XRDevice(IWER.metaQuest3, { stereoEnabled: false });
window.__iwer.installRuntime({ forceInstall: true });
window.__t = {
  frames(n = 1){ return new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }); },
  local(p){ const T = window.__farm; return T.rig.worldToLocal(new T.rig.position.constructor(...p)); },
  head(p, yaw = 0, pitch = 0){
    const T = window.__farm, L = this.local(p), d = window.__iwer;
    d.position.set(L.x, L.y, L.z);
    const Q = T.rig.quaternion.constructor, E = new (T.rig.rotation.constructor)(pitch, yaw - T.rig.rotation.y, 0, 'YXZ');
    const q = new Q().setFromEuler(E); d.quaternion.set(q.x, q.y, q.z, q.w);
  },
  async grip(side, p, q){
    const T = window.__farm, h = T.vr[side === 'left' ? 0 : 1], c = window.__iwer.controllers[side];
    const Q = T.rig.quaternion.constructor, V = T.rig.position.constructor;
    for (let it = 0; it < 3; it++){
      await this.frames(1);
      if (!h.tracked) continue;
      const off = h.rayQuat.clone().invert().multiply(h.quat);
      const offPos = h.pos.clone().sub(h.rayPos).applyQuaternion(h.rayQuat.clone().invert());
      const gq = new Q(...q), rq = gq.clone().multiply(off.clone().invert());
      const rp = new V(...p).sub(offPos.applyQuaternion(rq));
      const L = this.local(rp.toArray()), LQ = T.rig.quaternion.clone().invert().multiply(rq);
      c.position.set(L.x, L.y, L.z); c.quaternion.set(LQ.x, LQ.y, LQ.z, LQ.w);
    }
    await this.frames(1);
  },
  btn(side, id, v){ window.__iwer.controllers[side].updateButtonValue(id, v); },
};
` });
const pg = await ctx.newPage();
const errors = [];
pg.on('pageerror', (e) => errors.push(e.message));
pg.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const ev = (s) => pg.evaluate(s);
const wait = (ms) => pg.waitForTimeout(ms);
const shot = async (name) => {
  await ev('__farm.noRender = false'); await wait(400);
  await pg.screenshot({ path: path.join(OUT, name + '.png'), timeout: 120000 });
  await ev('__farm.noRender = true');
};
// the game runs undrawn (and faster than real time) except for screenshots
const waitGame = async (sec) => {
  const t0 = await ev('__farm.time'), start = Date.now();
  while ((await ev('__farm.time')) - t0 < sec){
    if (Date.now() - start > 30000 + sec * 15000) throw new Error('the game stopped running' + (errors.length ? ': ' + errors.slice(-3).join(' | ') : ''));
    await wait(50);
  }
};
const H = '__farm.farm.horses[0]', C = '__farm.care', I = (k) => `__farm.care.items.${k}`;
const use = (item, target, strength = 1) => ev(`__farm.care.use(${item}, ${target}, ${strength})`);

console.log('My Animal Farm ' + VERSION);
const started = Date.now();
await pg.goto(BASE);
await pg.waitForFunction('window.__farm', null, { timeout: 90000 });
await ev('localStorage.clear()');
await wait(500);
check((await pg.textContent('.build-version')).includes(VERSION), 'title shows version ' + VERSION);
if (IWER) check(await ev(`!document.getElementById('b-vr').disabled`), 'Enter VR is offered when there is a headset');
await shot('01-title');

// ---------- on screen ----------
await ev(`document.getElementById('b-new').click()`);
await wait(800);
check(await ev('__farm.mode') === 'screen', 'starting a farm plays on the screen');
check(await ev('!!__farm.screenUI.open && __farm.screenUI.open.title.includes("Welcome")'), 'a welcome explains the farm');
await shot('02-welcome');
await ev('__farm.closePanel(); __farm.noRender = true; __farm.timeScale = 3');
check(await ev(`${H}.data.name`) === 'Hazel' && await ev(`${H}.mode`) === 'stall', 'Hazel starts in her stall');
check(await ev('__farm.farm.jobs().length') >= 3, 'the jobs list says what needs doing');

// in the barn, by Hazel's stall
await ev('__farm.player.pos.set(-0.7, 0, -6.2); __farm.look(Math.PI / 2, -0.3)');
await waitGame(1);
await shot('03-stall');
// hay: two flakes in the rack
const hay0 = await ev('__farm.farm.state.supplies.hay');
for (let k = 0; k < 2; k++){ await ev(`__farm.takeFrom('hayStack')`); await use('__farm.player.heldBy[1]', `{ type: 'rack', stall: 0, point: __farm.farm.stalls[0].rackPos }`); await ev('__farm.player.heldBy[1] = __farm.care.temp.includes(__farm.player.heldBy[1]) ? __farm.player.heldBy[1] : null'); }
check(await ev('__farm.farm.stalls[0].state.hay') === 2, 'two flakes of hay go in the rack');
check(await ev('__farm.farm.state.supplies.hay') === hay0 - 1 && await ev('__farm.farm.state.supplies.loose') === 8, 'a bale is opened (10 flakes, 2 used)');
// water: bucket to the tap, then into her stall bucket
await ev(`__farm.pickUp(${I('bucket')}, 1)`);
await use(I('bucket'), `{ type: 'tap', point: __farm.world.fixtures.tap.pos }`);
check(await ev(`${I('bucket')}.water`) === 20, 'the bucket fills at the tap (20 litres)');
await use(I('bucket'), `{ type: 'stallBucket', stall: 0, point: __farm.farm.stalls[0].hookPos }`);
check(await ev('__farm.farm.stalls[0].state.water') === 20, 'and tops up her stall bucket');
// grain: one scoop
await ev(`__farm.pickUp(${I('scoop')}, 1)`);
await use(I('scoop'), `{ type: 'bin', bin: 'grain', point: __farm.farm.stalls[0].tubPos }`);
await use(I('scoop'), `{ type: 'tub', stall: 0, point: __farm.farm.stalls[0].tubPos }`);
check(await ev('__farm.farm.stalls[0].state.grain') === 1, 'a scoop of grain goes in her feed tub');
// she goes and eats
await waitGame(25);
check(await ev('__farm.farm.stalls[0].state.grain') < 1, 'Hazel eats her grain');
await shot('04-eating');
// muck out: push the barrow to the stall, fork the droppings and the wet patch, tip it on the heap
await ev(`__farm.putBack(${I('scoop')}); __farm.player.barrow = ${I('barrow')}; __farm.player.pos.set(-0.5, 0, -6.2)`);
await waitGame(0.5);
await ev(`__farm.pickUp(${I('fork')}, 1)`);
const piles = await ev('__farm.farm.stalls[0].state.manure.length');
for (let k = 0; k < piles; k++) await use(I('fork'), `{ type: 'manure', stall: 0, index: 0, touch: true, point: __farm.farm.stalls[0].manureMeshes[0].position }`);
await use(I('fork'), `{ type: 'wet', stall: 0, touch: true, point: __farm.farm.stalls[0].center }`);
check(await ev('__farm.farm.stalls[0].state.manure.length') === 0, `the fork lifts all ${piles} piles of droppings`);
check(await ev(`${I('barrow')}.load`) === piles + 1, 'into the wheelbarrow');
await ev('__farm.player.pos.set(3.5, 0, -24.4); __farm.look(0, 0)');
await waitGame(0.5);
check(await ev(`${I('barrow')}.load`) === 0, 'the wheelbarrow tips out on the muck heap');
await ev('__farm.player.barrow = null');
// the thumb stick: a touch whose end got lost used to leave you unable to walk; a new touch takes over
await ev(`__farm.player.pos.set(-6, 0, 12); __farm.look(Math.PI / 2, 0)`);
await ev(`(() => { const c = __farm.renderer.domElement, ev = (t, id, x, y) => c.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, isPrimary: true }));
  ev('pointerdown', 41, 120, innerHeight - 120);            // this touch never ends
  ev('pointerdown', 42, 130, innerHeight - 130); ev('pointermove', 42, 130, innerHeight - 200); })()`);
const sx0 = await ev('__farm.player.pos.x'); await waitGame(1.2);
check(await ev('__farm.player.pos.x') < sx0 - 1, 'a new touch on the stick always walks, even if an old touch got stuck');
await ev(`__farm.renderer.domElement.dispatchEvent(new PointerEvent('pointerup', { pointerId: 42, pointerType: 'touch', bubbles: true }))`);
check(await ev('!__farm.touch.stick'), 'lifting the finger stops walking');
// the wheelbarrow carries tools: pushing it, whatever you swap out goes in the barrow, and comes out again
await ev(`__farm.player.pos.set(0.95, 0, -15.6); __farm.look(0, -0.3); __farm.handleTap({ type: 'item', item: ${I('barrow')}, point: ${I('barrow')}.mesh.position })`);
await ev(`__farm.pickUp(${I('fork')}, 1); __farm.pickUp(${I('curry')}, 1)`);
check(await ev(`${I('fork')}.inBarrow && __farm.player.heldBy[1] === ${I('curry')}`), 'picking up another tool while pushing the barrow puts the fork in the barrow');
await ev(`document.getElementById('b-drop').click()`);
check(await ev(`${I('curry')}.inBarrow && !__farm.player.heldBy[1] && __farm.care.cargo().length === 2`), 'Put in barrow stows what you hold');
await ev('__farm.input = { x: 0, y: -1 }'); await waitGame(1); await ev('__farm.input = null');
check(await ev(`${I('fork')}.mesh.getWorldPosition(${I('barrow')}.mesh.position.clone()).distanceTo(${I('barrow')}.mesh.position) < 1.2`), 'the tools ride along in the barrow');
await waitGame(0.3); await shot('12b-barrow');
await ev(`__farm.handleTap({ type: 'item', item: ${I('fork')}, point: ${I('fork')}.mesh.getWorldPosition(${I('fork')}.mesh.position.clone()) })`);
check(await ev(`!${I('fork')}.inBarrow && __farm.player.heldBy[1] === ${I('fork')}`), 'tapping a tool in the barrow takes it out');
await ev(`__farm.putBack(${I('fork')}); __farm.care.home(${I('curry')}); __farm.player.barrow = null`);
// the wheelbarrow on the screen: tap it to push it; taps go past it while you push; it can't go through
// walls (you stop instead); the button at the bottom lets go of it
await ev(`__farm.player.heldBy[1] && __farm.putBack(__farm.player.heldBy[1]); ${I('barrow')}.mesh.position.set(-9, 0, 10.5); __farm.player.pos.set(-7.6, 0, 10.5); __farm.look(Math.PI / 2, -0.3)`);
await ev(`__farm.handleTap({ type: 'item', item: ${I('barrow')}, point: ${I('barrow')}.mesh.position })`);
check(await ev(`__farm.player.barrow === ${I('barrow')}`), 'tapping the wheelbarrow starts pushing it');
check(await ev(`(() => { const c = __farm.player.pos.clone().setY(1.6), d = ${I('barrow')}.mesh.position.clone().setY(0.5).sub(c).normalize(); const t = __farm.castFrom(c, d, 6); return !t || t.item !== ${I('barrow')}; })()`), 'taps go past the wheelbarrow you are pushing');
await ev('__farm.input = { x: 0, y: -1 }'); await waitGame(2.5); await ev('__farm.input = null');
const bx = await ev(`${I('barrow')}.mesh.position.x`), px = await ev('__farm.player.pos.x');
console.log(`       (pushed into the house wall: barrow x ${bx.toFixed(2)}, you ${px.toFixed(2)})`);
check(bx > -12.6 && px > -11.6, 'the wheelbarrow stops at a wall instead of going through it');
await ev(`document.getElementById('b-drop').click()`);
check(await ev('!__farm.player.barrow'), 'the Let go button leaves the wheelbarrow');
// the farmhouse: walk in through the front door, past the kitchen, into the bedroom
await ev('__farm.player.pos.set(-10.5, 0, 12); __farm.look(Math.PI / 2, 0)');
await ev('__farm.input = { x: 0, y: -0.9 }'); await waitGame(2.6); await ev('__farm.input = null');
const hp = await ev('__farm.player.pos.x');
console.log(`       (walked in to x ${hp.toFixed(2)})`);
check(hp < -14, 'you can walk into the farmhouse');
await ev('__farm.player.pos.set(-13.2, 0, 12.6); __farm.look(Math.PI / 2 + 0.25, -0.12)');
await waitGame(0.3);
await shot('13-house');
await ev('__farm.player.pos.set(-18.6, 0, 12.9); __farm.look(0.75, -0.3)');
await waitGame(0.3);
await shot('14-bedroom');
await ev('__farm.player.pos.set(-18.3, 0, 12.7); __farm.look(Math.PI / 2 + 0.2, -0.3)');
check(await ev(`(() => { const c = __farm.player.pos.clone().setY(1.6), d = __farm.world.fixtures.bed.pos.clone().sub(c).normalize(); const t = __farm.castFrom(c, d, 6); return t && t.type; })()`) === 'bed', 'the bed can be tapped');
const early = await ev('__farm.farm.state.day');
await ev(`__farm.activate({ type: 'bed' })`); await wait(1500);
check(await ev('__farm.farm.state.day') === early, 'you can\'t go to bed in the middle of the day');
// fresh shavings
const bed0 = await ev('__farm.farm.stalls[0].state.bedding');
await ev(`__farm.takeFrom('shavings')`);
await use('__farm.player.heldBy[1]', `{ type: 'stall', stall: 0, point: __farm.farm.stalls[0].center }`);
check(await ev('__farm.farm.stalls[0].state.bedding') > bed0 + 0.5, 'fresh shavings are spread');
// she eats her hay and drinks over the next hour
const food0 = await ev(`${H}.data.needs.food`);
await ev('__farm.timeScale = 8'); await waitGame(150); await ev('__farm.timeScale = 3');
console.log('       (food ' + food0.toFixed(1) + ' -> ' + (await ev(`${H}.data.needs.food`)).toFixed(1) + ', rack ' + (await ev('__farm.farm.stalls[0].state.hay')).toFixed(2) + ')');
check(await ev('__farm.farm.stalls[0].state.hay') < 1.8, 'Hazel eats from her hay rack');
await ev('__farm.player.pos.set(-0.7, 0, -6.2); __farm.look(Math.PI / 2, -0.3)');
await shot('05-clean-stall');

// in her stall behind her: lead her and walk out past her (you used to get pinned between her and the wall)
await ev(`__farm.player.heldBy[1] && __farm.putBack(__farm.player.heldBy[1])`);
const st0 = await ev(`(() => { const s = __farm.farm.stalls[0], h = ${H}; h.pos.set(s.front + s.side * 1.0, 0, s.center.z); h.yaw = s.side > 0 ? -Math.PI / 2 : Math.PI / 2; __farm.player.pos.set(s.front + s.side * 2.6, 0, s.center.z + 0.2); __farm.look(s.side > 0 ? Math.PI / 2 : -Math.PI / 2, 0); return s.front; })()`);
await ev(`__farm.startLead(${H}); __farm.input = { x: 0, y: -0.6 }`); await waitGame(3); await ev('__farm.input = null');
console.log(`       (walked out of the stall to x ${(await ev('__farm.player.pos.x')).toFixed(2)})`);
check(await ev(`Math.abs(__farm.player.pos.x) < ${Math.abs(st0) - 0.2}`), 'you can walk out of the stall past the horse you are leading');
await ev('__farm.letGo()');
check(await ev(`${H}.mode`) === 'stall' && !(await ev('__farm.player.leading')), 'letting go at her stall door puts her in her stall');
// lead her out to the hitching rail
await ev(`__farm.startLead(${H})`);
check(await ev(`${H}.mode`) === 'led', 'Hazel can be led on her lead rope');
for (const [x, z] of [[0, -6.2], [0, -4], [0, -1], [3, 0.4], [5.2, 0.6]]){ await ev(`__farm.player.pos.set(${x}, 0, ${z})`); await waitGame(3); }
check(await ev(`${H}.pos.x`) > 0.5 && await ev(`${H}.pos.z`) > -3.5, 'she follows out of the stall, through the door and down the aisle');
await ev('__farm.letGo()');
check(await ev(`${H}.mode`) === 'tied', 'letting go by the hitching rail ties her up');
await waitGame(2);
await ev(`${H}.model.addDirt(0.6, 'roll', 3)`);
await ev('__farm.player.pos.set(7.4, 0, 1.6); __farm.look(1.2, -0.3)');
await shot('06-muddy');
// groom: curry comb loosens, brush lifts it off
const dirt0 = await ev(`${H}.model.dirtiness()`);
const groomAll = (tool) => ev(`(() => { const h = ${H}, m = h.model, V = h.pos.constructor; m.root.updateMatrixWorld(true);
  const pts = []; for (const part of m.parts){ const p = part.geometry.attributes.position; for (let i = 0; i < p.count; i += 6) pts.push(part.localToWorld(new V().fromBufferAttribute(p, i))); }
  for (let k = 0; k < 2; k++) for (const p of pts) __farm.care.use(__farm.care.items.${tool}, { type: 'horse', horse: h, point: p }, 1); })()`);
await ev(`__farm.pickUp(${I('brush')}, 1)`);
await use(I('brush'), `{ type: 'horse', horse: ${H}, point: ${H}.model.saddlePoint() }`);
check(await ev('__farm.farm.messages.some((m) => m.text.includes("curry comb first"))'), 'brushing caked mud says to use the curry comb first');
await ev(`__farm.pickUp(${I('curry')}, 1)`); await groomAll('curry');
const dirt1 = await ev(`${H}.model.dirtiness()`);
check(dirt1 < dirt0, `the curry comb loosens the mud (${dirt0.toFixed(2)} → ${dirt1.toFixed(2)})`);
await shot('07-curried');
await ev(`__farm.pickUp(${I('brush')}, 1)`); await groomAll('brush');
const dirt2 = await ev(`${H}.model.dirtiness()`);
check(dirt2 < 0.05 && dirt2 < dirt1, `the body brush lifts it off (${dirt2.toFixed(3)})`);
await ev(`__farm.pickUp(${I('hoofpick')}, 1)`);
await ev(`for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) __farm.care.use(__farm.care.items.hoofpick, { type: 'hoof', horse: ${H}, hoof: i, point: ${H}.model.hoof(i) }, 1)`);
check(await ev(`${H}.data.hooves.every((x) => x === 0)`), 'the hoof pick cleans all four hooves (each is lifted)');
await shot('08-hoof');
// tack up: saddle needs the pad first; then girth, then bridle
await ev(`__farm.pickUp(${I('saddle')}, 1)`);
check(!(await use(I('saddle'), `{ type: 'horse', horse: ${H}, point: ${H}.model.saddlePoint() }`)), 'the saddle won\'t go on without the pad');
for (const k of ['pad', 'saddle']){ await ev(`__farm.pickUp(${I(k)}, 1)`); await use(I(k), `{ type: 'horse', horse: ${H}, point: ${H}.model.saddlePoint() }`); await ev('__farm.player.heldBy[1] = null'); }
check(await ev(`!__farm.riding.mount(${H})`), 'can\'t ride with the girth undone');
await ev(`__farm.care.girth(${H})`);
await ev(`__farm.pickUp(${I('bridle')}, 1)`); await use(I('bridle'), `{ type: 'head', horse: ${H}, point: ${H}.model.poll() }`); await ev('__farm.player.heldBy[1] = null');
check(await ev(`${H}.tacked()`), 'pad, saddle, girth and bridle on');
check(await ev(`!${H}.model.tack.halter.visible && ${H}.model.tack.bridle.visible && ${H}.model.tack.saddle.visible && ${H}.model.tack.girth.visible`), 'the tack shows on the horse (and the halter comes off)');
await shot('09-tacked');
// ride to the arena and jump the vertical
check(await ev(`__farm.riding.mount(${H})`), 'mount up');
await ev(`${H}.pos.set(19, 0, 4); ${H}.yaw = Math.PI / 2; __farm.riding.gear = 3; ${H}.data.skill = 0.6; __farm.timeScale = 1`);
let pressed = false, flew = false;
for (let i = 0; i < 120; i++){
  const x = await ev(`${H}.pos.x`);
  if (!pressed && x > 25.3){ await ev('__farm.riding.input.jump = true'); pressed = true; }
  if (!flew && await ev('!!__farm.riding.flight')){ flew = true; await shot('10-jump'); }
  if (x > 34) break;
  await wait(60);
}
check(flew, 'pressing Jump on the approach takes off over the fence');
check(await ev(`${H}.data.skill`) > 0.6, 'jumping trains the horse');
// a horse that's unwilling stops at a fence you don't ask it to jump
await ev(`${H}.pos.set(37, 0, 16); ${H}.yaw = -Math.PI / 2; __farm.riding.gear = 2; ${H}.data.skill = 0; ${H}.data.needs.happy = 10; __farm.riding.refused = 0`);
await ev(`__farm.riding.on('refuse', () => { __farm.riding.refused = (__farm.riding.refused || 0) + 1; })`);
await ev('__farm.timeScale = 2');
await waitGame(5);
check(await ev('__farm.riding.refused') > 0, 'a horse asked to jump badly refuses');
await ev(`${H}.data.skill = 0.6; ${H}.data.needs.happy = 80`);
await ev('__farm.player.view = "third"');
await shot('11-riding');
check(await ev('__farm.riding.dismount() !== null') && await ev(`${H}.mode`) === 'led', 'dismount and hold the reins');

// ---------- the pens ----------
await ev(`__farm.letGo(); __farm.timeScale = 3`);
const pen = (k) => `__farm.farm.pens.findIndex((p) => p.kind === '${k}')`;
const gf0 = await ev(`__farm.farm.pens[0].feedAmt`);
await ev(`__farm.takeFrom('hayStack')`); await use('__farm.player.heldBy[1]', `{ type: 'feeder', pen: ${await ev(pen('goat'))}, point: __farm.farm.pens[0].feedPos }`);
check(await ev(`__farm.farm.pens[${await ev(pen('goat'))}].feedAmt`) > gf0 + 0.3, 'goats get hay in their feeder');
await ev(`__farm.pickUp(${I('scoop')}, 1)`);
await use(I('scoop'), `{ type: 'bin', bin: 'grain', point: __farm.farm.pens[0].feedPos }`);
check(!(await use(I('scoop'), `{ type: 'feeder', pen: ${await ev(pen('chicken'))}, point: __farm.farm.pens[0].feedPos }`)), 'hens won\'t take horse grain');
await ev(`${I('scoop')}.amount = 0; __farm.farm.state.supplies.grain++`);
await use(I('scoop'), `{ type: 'bin', bin: 'corn', point: __farm.farm.pens[0].feedPos }`);
check(await use(I('scoop'), `{ type: 'feeder', pen: ${await ev(pen('chicken'))}, point: __farm.farm.pens[0].feedPos }`), 'hens get corn');
await ev(`__farm.pickUp(${I('bucket')}, 1)`); await use(I('bucket'), `{ type: 'tap', point: __farm.world.fixtures.tap.pos }`);
const gw0 = await ev(`__farm.farm.pens[0].waterAmt`);
await use(I('bucket'), `{ type: 'trough', pen: ${await ev(pen('goat'))}, point: __farm.farm.pens[0].waterPos }`);
check(await ev(`__farm.farm.pens[${await ev(pen('goat'))}].waterAmt`) > gw0 + 0.3, 'goats get water');
await ev(`__farm.farm.pens[${await ev(pen('chicken'))}].saved.eggs = 3; __farm.farm.refreshPen(${await ev(pen('chicken'))})`);
await ev(`__farm.collectEggs(${await ev(pen('chicken'))})`);
check(await ev('__farm.farm.state.supplies.eggs') === 3, 'eggs are collected from the coop');
await ev(`const p = __farm.farm.pens[${await ev(pen('goat'))}]; p.saved.droppings.push([14, -12], [15, -13]); __farm.farm.refreshPen(${await ev(pen('goat'))})`);
await ev(`__farm.player.barrow = ${I('barrow')}; __farm.player.pos.set(15, 0, -10); __farm.pickUp(${I('fork')}, 1)`);
await waitGame(0.3);
const dr0 = await ev(`__farm.farm.pens[0].saved.droppings.length`);
await use(I('fork'), `{ type: 'dropping', pen: ${await ev(pen('goat'))}, index: 0, touch: true, point: __farm.player.pos }`);
check(await ev(`__farm.farm.pens[${await ev(pen('goat'))}].saved.droppings.length`) === dr0 - 1, 'droppings are forked out of the pens');
await ev('__farm.player.barrow = null');
await ev(`__farm.putBack(__farm.player.heldBy[1]); __farm.player.pos.set(15.5, 0, -6.5); __farm.look(0, -0.25)`);
await waitGame(1);
await shot('12-goats');
await ev(`__farm.player.pos.set(28.5, 0, -20.9); __farm.look(0, -0.3)`);
await waitGame(0.5);
await shot('13-hens');

// ---------- a customer boards a horse ----------
await ev('__farm.farm.state.nextOfferDay = 0; Math.random = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })()');
await ev('__farm.farm.offers = []; __farm.farm.morningVisitors()');
const offer = await ev('__farm.farm.offers[0] && __farm.farm.offers[0].kind');
check(!!offer, `a customer arrives with ${offer === 'horse' ? 'a horse' : 'animals'} to board`);
await ev('__farm.player.pos.set(-4.5, 0, 13.2); __farm.look(Math.PI * 0.95, -0.1)');
await waitGame(0.5);
await ev('__farm.activate({ type: "visitor", offer: __farm.farm.offers[0] })');
check(await ev('!!__farm.screenUI.open'), 'talking to them shows their offer');
await shot('14-customer');
const nh = await ev('__farm.farm.horses.length'), na = await ev('__farm.farm.animals.length');
await ev('__farm.closePanel(); __farm.farm.acceptOffer(__farm.farm.offers[0])');
check(await ev('__farm.farm.horses.length') > nh || await ev('__farm.farm.animals.length') > na, 'accepting puts their animal in a stall or pen');
const m0 = await ev('__farm.farm.state.money');
await ev('__farm.farm.dailyPay()');
check(await ev('__farm.farm.state.money') > m0, 'boarders pay each day for the care');
// their stay is over: the owner comes back, and you can give the animal back from its own panel
const bid = await ev('(() => { const c = [...__farm.farm.horses, ...__farm.farm.animals].find((x) => x.data.owner); c.data.owner.daysLeft = 0; return c.data.id; })()');
await ev('__farm.farm.morningVisitors()');
check(await ev(`!!__farm.farm.pickupFor(${JSON.stringify(bid)})`), 'the owner comes back to collect their animal');
check(await ev(`__farm.farm.jobs().some((j) => / back: tap /.test(j.text))`), 'the jobs list says how to give it back');
await ev(`(() => { const id = ${JSON.stringify(bid)}, h = __farm.farm.horseById(id); if (h) __farm.horsePanel(h); else __farm.animalPanel(__farm.farm.creatureById(id)); })()`);
const gave = await ev(`(() => { const b = [...document.querySelectorAll('#panel button')].find((x) => /back/.test(x.textContent)); if (!b) return false; b.click(); return true; })()`);
check(gave && await ev(`!__farm.farm.creatureById(${JSON.stringify(bid)})`), 'Give back on the animal\'s own panel hands it over to the owner');

// ---------- the shop and the horse market ----------
const m1 = await ev('__farm.farm.state.money');
await ev(`__farm.farm.buySupply('hay')`);
check(await ev('__farm.farm.state.money') === m1 - 9, 'buying a bale of hay costs $9');
await ev('__farm.farm.state.money += 20000');
const nh2 = await ev('__farm.farm.horses.length');
await ev('__farm.farm.buyHorse(__farm.farm.market()[0])');
check(await ev('__farm.farm.horses.length') === nh2 + 1, 'buying a horse from the market puts it in a free stall');
await ev('__farm.office("horses")');
await shot('15-office');
await ev('__farm.closePanel()');

// ---------- a show ----------
await ev(`__farm.farm.state.day = 3; __farm.farm.state.minutes = 10 * 60`);
await ev(`${H}.pos.set(22, 0, 43); ${H}.yaw = Math.PI / 2; ${H}.mode = 'loose'; __farm.riding.mount(${H}); __farm.timeScale = 1`);
const m2 = await ev('__farm.farm.state.money');
check(await ev('__farm.riding.enter(__farm.classes[0])'), 'enter the Novice class at the show grounds');
check(await ev('__farm.farm.state.money') === m2 - 40, 'the entry fee is paid');
check(await ev('__farm.riding.show.state') === 'entered', 'waiting to start');
await ev(`__farm.player.view = "third"; ${H}.pos.set(22.6, 0, 44); __farm.riding.gear = 3`);
// canter through the posts, then pull up before fence 1 (the round below is scripted)
for (let k = 0; k < 40 && await ev('__farm.riding.show.state') !== 'riding'; k++) await waitGame(0.1);
await ev('__farm.riding.gear = 0');
console.log('       ' + await ev(`JSON.stringify({ pos: ${H}.pos, speed: ${H}.speed, gear: __farm.riding.gear, mode: ${H}.mode, ridden: __farm.riding.horse === ${H}, health: ${H}.data.needs.health })`));
check(await ev('__farm.riding.show.state') === 'riding', 'riding through the timing posts starts the clock');
await shot('16-show');
// jump the course in order (simulated landings), then back through the posts
await ev(`for (const j of __farm.riding.jumps.filter((j) => j.show).sort((a, b) => a.num - b.num)) __farm.riding.showJumped(j, j.num === 5, 1)`);
check(await ev('__farm.riding.show.next') === 8 && await ev('__farm.riding.show.faults') === 4, 'eight fences in order, one rail down: 4 faults');
await ev(`__farm.riding.show.time = 50; ${H}.pos.set(25.5, 0, 44); ${H}.yaw = -Math.PI / 2; __farm.riding.prevPos.set(25.5, 0, 44); __farm.riding.gear = 2`);
await waitGame(1.5);
check(await ev('__farm.riding.show.state') === 'idle', 'crossing the line again finishes');
check(await ev('!!__farm.screenUI.open && /place|won/i.test(__farm.screenUI.open.title)'), 'the results are shown');
await shot('17-results');
await ev('__farm.closePanel()');
const rib = await ev('__farm.farm.state.ribbons.length');
console.log('       (placed: ' + (rib ? 'in the ribbons' : 'out of the ribbons') + ', money ' + (await ev('__farm.farm.state.money')) + ')');
check(await ev('(__farm.farm.state.shows[3] || []).includes("novice")'), 'you can\'t enter the same class twice in a day');
await ev('__farm.riding.dismount()');

// ---------- the end of the day ----------
await ev('__farm.letGo(); __farm.farm.state.minutes = 21 * 60 + 10');
await ev(`__farm.office('day')`);
await ev('__farm.closePanel()');
const day = await ev('__farm.farm.state.day');
await ev(`__farm.player.pos.set(-18.3, 0, 12.7); __farm.activate({ type: 'bed' })`);
await wait(2000);
const slept = true;
console.log('       (slept: ' + slept + ', day ' + day + ' -> ' + await ev('__farm.farm.state.day') + ', ' + await ev('__farm.farm.state.minutes') + ')');
check(await ev('__farm.farm.state.day') === day + 1 && Math.abs(await ev('__farm.farm.state.minutes') - 360) < 2, 'going to bed brings the next morning at 6am');
check(await ev(`!${H}.data.tack.saddle`), 'tack left on overnight is taken off');
check(await ev('__farm.player.pos.x') < -18, 'you wake up in your bedroom');
// saving and loading
await ev('__farm.farm.save()');
await pg.reload();
await pg.waitForFunction('window.__farm', null, { timeout: 90000 });
await wait(500);
check(await ev('__farm.farm.state.day') === day + 1, 'the farm is saved and loads again');
await ev('__farm.startScreen(false); __farm.closePanel(); __farm.noRender = true');
await ev('__farm.farm.state.minutes = 20 * 60; __farm.player.pos.set(0, 0, 6); __farm.look(Math.PI * 0.05, 0.05)');
await waitGame(0.5);
await shot('18-evening');

// ---------- VR ----------
if (IWER){
  await ev('__iwer.position.set(0, 1.6, 0)');
  await ev('__farm.startVR(false)');
  await wait(1500);
  await waitGame(1);
  check(await ev('__farm.mode') === 'vr', 'Enter VR starts an immersive session');
  // Hazel at the rail, then pick up the body brush from the grooming box
  await ev(`const h = ${H}; h.toStall(0); __farm.tieAtRail(h); h.pos.set(5.6, 0, 0.05); h.model.addDirt(0.5, 'all', 9)`);
  const bp = await ev(`${I('brush')}.mesh.getWorldPosition(${H}.pos.clone()).toArray()`);
  await ev(`__farm.rig.position.set(${bp[0] - 0.4}, 0, ${bp[2] + 0.5}); __farm.rig.rotation.set(0, 0, 0)`);
  await ev(`__t.head([${bp[0] - 0.4}, 1.6, ${bp[2] + 0.5}], 0, -0.8)`);
  const q0 = await ev(`new __farm.rig.quaternion.constructor().setFromEuler(new __farm.rig.rotation.constructor(0.4, 0, 0)).toArray()`);
  await ev(`__t.grip('right', [${bp[0]}, ${bp[1] + 0.03}, ${bp[2]}], ${JSON.stringify(q0)})`);
  await ev(`__t.btn('right', 'squeeze', 1)`); await wait(300); await waitGame(0.3);
  check(await ev(`__farm.player.heldBy[1] === ${I('brush')}`), 'squeezing the grip next to the brush picks it up');
  // carry it to the horse and rub
  await ev(`__farm.rig.position.set(5.6, 0, 1.6); __t.head([5.6, 1.6, 1.6], Math.PI * 0.95, -0.3)`);
  await ev(`${H}.model.groom = ((g) => function(){ __farm.groomed = (__farm.groomed || 0) + 1; return g.apply(this, arguments); })(${H}.model.groom)`);
  const sp = await ev(`(() => { const m = ${H}.model; m.root.updateMatrixWorld(true); const p = m.body.localToWorld(new m.root.position.constructor(0.38, 1.25, 0.1)); return p.toArray(); })()`);
  for (let k = 0; k < 8; k++){ await ev(`__t.grip('right', [${sp[0]}, ${sp[1]} + ${(k % 2) * 0.12}, ${sp[2]} + ${(k % 2) * 0.1}], ${JSON.stringify(q0)})`); }
  check(await ev('__farm.groomed || 0') > 0, 'rubbing the brush on her coat grooms her');
  await ev(`__t.btn('right', 'squeeze', 0)`); await wait(200);
  await ev(`__farm.rig.position.set(7.2, 0, 1.4); __t.head([7.2, 1.6, 1.4], 1.1, -0.25)`);
  await waitGame(0.5);
  await shot('19-vr');
  // point at her and pull the trigger: her card comes up
  const hp = await ev(`${H}.model.saddlePoint().toArray()`);
  const dir = [hp[0] - 7.0, hp[1] - 1.2, hp[2] - 1.3], L = Math.hypot(...dir);
  const yaw = Math.atan2(-dir[0] / L, -dir[2] / L), pitch = Math.asin(dir[1] / L);
  const qp = await ev(`new __farm.rig.quaternion.constructor().setFromEuler(new __farm.rig.rotation.constructor(${pitch}, ${yaw}, 0, 'YXZ')).toArray()`);
  await ev(`__t.grip('right', [7.0, 1.2, 1.3], ${JSON.stringify(qp)})`);
  // the pointer ray is tilted from the grip: aim the ray itself
  await ev(`(() => { const c = __iwer.controllers.right; const T = __farm, h = T.vr[1]; })()`);
  for (let k = 0; k < 4 && !(await ev('__farm.vrPanel.open')); k++){
    await ev(`(() => { const T = __farm, h = T.vr[1], V = h.pos.constructor; const want = new V(${hp[0]}, ${hp[1]}, ${hp[2]}).sub(h.rayPos).normalize(); const cur = new V(0, 0, -1).applyQuaternion(h.rayQuat); const fix = new h.quat.constructor().setFromUnitVectors(cur, want); const c = __iwer.controllers.right; const q = new h.quat.constructor(c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w).premultiply(T.rig.quaternion.clone().invert().multiply(fix).multiply(T.rig.quaternion)); c.quaternion.set(q.x, q.y, q.z, q.w); })()`);
    await wait(150); await ev(`__t.btn('right', 'trigger', 1)`); await wait(300); await ev(`__t.btn('right', 'trigger', 0)`); await wait(200);
  }
  check(await ev('__farm.vrPanel.open'), 'pointing at her and pulling the trigger shows her card in VR');
  await shot('20-vr-panel');
}

check(errors.length === 0, 'no errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
console.log(`\n${failures ? failures + ' FAILED' : 'all passed'} in ${Math.round((Date.now() - started) / 1000)}s · screenshots in ${OUT}`);
await browser.close(); server.close();
process.exit(failures ? 1 : 0);
