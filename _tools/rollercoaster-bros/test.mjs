// Plays Rollercoaster Bros in headless Chromium, checks it, and saves screenshots.
//
//   npm i --prefix _tools/vr-test iwer        (once; the VR part uses Meta's emulated Quest 3)
//   NODE_PATH=$(npm root -g) node _tools/rollercoaster-bros/test.mjs [outDir]
//
// Serves the repo the way Jekyll would publish it (front matter stripped, version filled in). Then, on
// screen: the title and version, the welcome, building a simple loop by hand and with Finish, the train
// running, visitors queueing, riding and paying, riding it yourself, watching, the speed choices, buying
// hills / drops / a loop / a barrel roll / a jump and building with them, blocked pieces, undo, new
// trains and paint, saving and loading. Then in VR: entering a session at giant size, the tablet on the
// left hand, pressing a tablet button with the right-hand pointer, and riding in the front seat.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(HERE, '../..');
const OUT = path.resolve(process.argv[2] || 'rollercoaster-bros-shots');
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
const VERSION = (fs.readFileSync(path.join(ROOT, '_experiments/rollercoaster-bros.html'), 'utf8').match(/version:\s*"?([^"\n]+)"?/) || [])[1];
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
const BASE = `http://127.0.0.1:${server.address().port}/experiments/rollercoaster-bros/`;

let failures = 0;
const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) failures++; return ok; };
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1024, height: 700 } });
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
const shot = async (name) => {
  await ev('__rcb.noRender = false'); await wait(500);
  await pg.screenshot({ path: path.join(OUT, name + '.png'), timeout: 120000 });
  await ev('__rcb.noRender = true');
};
const waitGame = async (sec) => {
  const t0 = await ev('__rcb.time'), start = Date.now();
  while ((await ev('__rcb.time')) - t0 < sec){
    if (Date.now() - start > 30000 + sec * 15000) throw new Error('the game stopped running' + (errors.length ? ': ' + errors.slice(-3).join(' | ') : ''));
    await wait(50);
  }
};
const until = async (expr, sec, what) => {
  const t0 = await ev('__rcb.time');
  while (!(await ev(expr))){
    if ((await ev('__rcb.time')) - t0 > sec){ check(false, what + ' (timed out)'); return false; }
    await wait(100);
  }
  return check(true, what);
};
const add = (t) => ev(`__rcb.addPiece('${t}')`);

console.log('Rollercoaster Bros ' + VERSION);
const started = Date.now();
await pg.goto(BASE);
await pg.waitForFunction('window.__rcb', null, { timeout: 90000 }).catch((e) => { console.log('the game did not start:', errors.join(' | ')); throw e; });
await ev('localStorage.clear()');
await wait(800);
check((await pg.textContent('.build-version')).includes(VERSION), 'title shows version ' + VERSION);
check(await ev('__rcb.track.complete'), 'a demo coaster runs behind the title');
await shot('01-title');

// ---------- on screen ----------
await ev(`document.getElementById('b-play').click()`);
await wait(600);
check(await ev('__rcb.mode') === 'screen', 'Play starts the game on the screen');
check(await ev('__rcb.track.pieces.length') === 1, 'a new park has only the station');
check(await ev(`!!document.querySelector('#panel.show') && document.querySelector('#panel h2').textContent.includes('Welcome')`), 'a welcome explains what to do');
await shot('02-welcome');
await ev('__rcb.closePanels(); __rcb.noRender = true; __rcb.timeScale = 3');
check(await ev(`document.querySelectorAll('#palette .pb:not(.locked):not(.tool)').length`) === 3, 'at first you can only build straights and turns');
check(await ev('__rcb.park.state.money') === 200, 'you start with $200');
// locked pieces send you to the shop
await ev(`[...document.querySelectorAll('#palette .pb.locked')][0].click()`);
check(await ev(`document.querySelector('#panel h2').textContent.includes('Shop')`), 'tapping a locked piece opens the shop');
await ev('__rcb.closePanels()');

// build a simple loop by hand: out of the station, round to the left and back in
check(!(await ev(`__rcb.addPiece('right')`)), 'a right turn straight out of the station is refused (the platform steps are there)');
for (const t of ['straight', 'left', 'left', 'straight', 'straight', 'straight']) await add(t);
check(!(await ev('__rcb.track.complete')), 'not finished yet');
await waitGame(0.5);
await shot('03-building');
for (const t of ['left', 'left']) await add(t);
check(await ev('__rcb.track.complete'), 'four turns and some straights make a finished loop');
await ev('__rcb.undo(); __rcb.undo()');
check(!(await ev('__rcb.track.complete')), 'undo opens it up again');
await ev('__rcb.finishTrack()');
await until('__rcb.track.complete', 10, 'Finish builds the way back to the station');
await shot('04-finished');
// people come, queue, ride and pay
await until('__rcb.train.state === "running"', 12, 'the train sets off');
await until('__rcb.park.visitors.length > 2', 30, 'visitors come to the park');
await until('__rcb.park.state.riders > 0', 120, 'visitors get on the train');
await until('__rcb.park.state.money > 200', 5, 'and pay for a ticket');
const r1 = await ev('__rcb.park.rating');
check(r1.excitement > 1 && r1.excitement < 4, `a simple loop is a little bit fun (${r1.excitement})`);
await ev('__rcb.orbit.target.set(6, 0, 4); __rcb.orbit.follow = false; __rcb.orbit.dist = 30; __rcb.orbit.yaw = 1.2; __rcb.orbit.pitch = 0.4');
await shot('05-queue');
await until('__rcb.train.state === "running" && __rcb.train.riders().length > 0', 60, 'the train goes round with riders');
await waitGame(1.5);
await ev('document.getElementById("b-watch").click()');
await shot('06-watch');
await ev('document.getElementById("b-off").click()');
check(await ev('__rcb.view') === 'build', 'back to building');

// ride it yourself
await ev(`document.getElementById('b-ride').click()`);
check(await ev('__rcb.view') === 'ride' && await ev('__rcb.train.seats[0] === "player"'), 'Ride puts you in the front seat');
await until('__rcb.train.state === "running" && __rcb.train.v > 5', 30, 'off you go');
await shot('07-ride');
await ev('__rcb.stopRide()');

// money: buy everything along the way
const m0 = await ev('__rcb.park.state.money');
await ev('__rcb.shop("parts")');
await shot('08-shop');
const spent = await ev(`(() => { __rcb.park.state.money = 20000; for (const g of ['wide', 'hills', 'steep', 'loop', 'roll', 'jump']) __rcb.buyGroup(g); return 20000 - __rcb.park.state.money; })()`);
check(await ev('__rcb.park.state.groups.length') === 7, 'every kind of track can be bought');
check(spent === 150 + 300 + 800 + 1500 + 2500 + 4000, 'and it costs what it says');
await ev('__rcb.closePanels()');
void m0;

// a big coaster: clear and build with hills, a drop, a loop, a roll and a jump
await ev('__rcb.track.reset(); __rcb.addPiece("straight")');
for (const t of ['up', 'steepUp', 'straight', 'steepDown', 'down', 'loop', 'bigLeft', 'roll', 'left', 'straight', 'jump', 'bigLeft', 'up', 'down', 'loop']) await add(t);
check(await ev('__rcb.track.types().length') === 16, 'hills, drops, loops, a barrel roll and a jump all fit');
check(!(await ev(`__rcb.addPiece('steepDown')`)) && await ev('__rcb.track.types().length') === 16, 'track can\'t go under the ground');
await ev('__rcb.finishTrack()');
await until('__rcb.track.complete', 10, 'Finish closes the big coaster too');
const r2 = await ev('__rcb.park.rating');
check(r2.excitement > r1.excitement + 3, `the big coaster is much more fun (${r2.excitement})`);
check(r2.inversions === 3, 'it turns you upside down three times');
await ev('__rcb.orbit.follow = false; __rcb.orbit.target.set(-10, 4, -40); __rcb.orbit.dist = 110; __rcb.orbit.yaw = 0.9; __rcb.orbit.pitch = 0.5');
await shot('09-big-coaster');
// upside down at the top of a loop, and the train jumping
const loopTop = await ev(`(() => { const T = __rcb.track; let best = null; for (const p of T.path) if (p.piece.type === 'loop' && (!best || p.pos.y > best.pos.y)) best = p; return { s: best.s, up: best.up.y }; })()`);
check(loopTop.up < -0.95, 'the top of the loop is upside down');
// ride: put the train at the top of the loop (riders' view)
await ev(`__rcb.startRide(); __rcb.timeScale = 1; __rcb.train.state = 'running'; __rcb.train.dist = ${loopTop.s} - 13 + 1.5; __rcb.train.s = 13 + __rcb.train.dist; __rcb.train.v = 4`);
await shot('10-ride-loop');
const jump = await ev(`(() => { const T = __rcb.track; const p = T.path.find((p) => p.piece.type === 'jump' && p.gap); return p.s; })()`);
await ev(`__rcb.train.dist = ${jump} - 13 + 3; __rcb.train.s = 13 + __rcb.train.dist; __rcb.train.v = 15`);
await shot('11-ride-jump');
await ev('__rcb.stopRide(); __rcb.timeScale = 3; __rcb.train.reset()');

// speed
await ev('__rcb.speedPanel()');
await shot('12-speed');
await ev('__rcb.setSpeed(4)');
const r3 = await ev('__rcb.park.rating');
check(r3.intensity > r2.intensity && r3.excitement > r2.excitement, `turbo is more fun and scarier (fun ${r3.excitement}, scary ${r3.intensity})`);
await ev('__rcb.closePanels()');
await until('__rcb.train.state === "running" && __rcb.train.v > 20', 40, 'turbo goes fast (47 mph)');
await until('__rcb.train.state === "loading"', 120, 'and comes back to the station');

// trains and paint
const looks = [];
for (const c of ['ocean', 'lightning', 'dragon', 'shark', 'rocket', 'rainbow', 'gold']){
  await ev(`__rcb.park.state.money += 10000; __rcb.buyCart(__rcb.CARTS.find((x) => x.id === '${c}'))`);
  looks.push(await ev('__rcb.train.style'));
}
check(looks.join() === 'ocean,lightning,dragon,shark,rocket,rainbow,gold', 'new trains can be bought and used');
await ev('__rcb.closePanels(); __rcb.track.setColor(4)');
for (const [i, c] of ['dragon', 'rocket', 'shark', 'gold'].entries()){
  await ev(`__rcb.train.setStyle('${c}'); __rcb.train.reset(); __rcb.orbit.follow = false; __rcb.orbit.target.set(0, 1.5, -2.5); __rcb.orbit.dist = 9; __rcb.orbit.yaw = -0.9; __rcb.orbit.pitch = 0.25`);
  await shot(`13-train-${i}-${c}`);
}
await ev('__rcb.shop("carts")');
await shot('14-shop-trains');
await ev('__rcb.closePanels()');

// save and load
await ev('__rcb.park.save()');
const saved = await ev('JSON.parse(localStorage.getItem("rollercoaster-bros-save"))');
check(saved.track.length === (await ev('__rcb.track.types().length')) && saved.carts.length === 8, 'the park is saved');
await pg.reload();
await pg.waitForFunction('window.__rcb', null, { timeout: 90000 });
await wait(500);
await ev(`document.getElementById('b-play').click()`);
await wait(400);
check(await ev('__rcb.track.complete') && await ev('__rcb.track.types().length') === saved.track.length, 'and comes back after a reload');
check(await ev('__rcb.train.style') === saved.cart && await ev('__rcb.park.state.speed') === 4, 'with the same train and speed');
await ev('__rcb.noRender = true; __rcb.timeScale = 3');
await waitGame(20);
await ev('__rcb.orbit.follow = false; __rcb.orbit.target.set(4, 2, 0); __rcb.orbit.dist = 45; __rcb.orbit.yaw = 0.5; __rcb.orbit.pitch = 0.35');
await shot('15-park');

// ---------- VR ----------
if (IWER){
  await ev('__rcb.timeScale = 1');
  await ev('__rcb.startVR(false)');
  await pg.waitForFunction('__rcb.mode === "vr"', null, { timeout: 30000 });
  check(true, 'VR session starts');
  check(await ev('__rcb.rig.scale.x') > 5, 'you start at giant size, over the park');
  // hold the left controller up in front, point the right one at the tablet
  await ev(`(() => { const d = window.__iwer; d.position.set(0, 1.6, 0); d.quaternion.set(0, 0, 0, 1);
    d.controllers.left.position.set(-0.1, 1.25, -0.35); d.controllers.left.quaternion.set(0, 0, 0, 1);
    d.controllers.right.position.set(0.15, 1.3, -0.2); d.controllers.right.quaternion.set(0, 0, 0, 1); })()`);
  await wait(1500);
  check(await ev('__rcb.vr[0].tracked && __rcb.vr[1].tracked'), 'both controllers are tracked');
  check(await ev('__rcb.tablet.mesh.visible && __rcb.tablet.mesh.parent.visible'), 'the tablet is on your left hand');
  await ev('__rcb.noRender = false');
  await wait(800);
  await pg.screenshot({ path: path.join(OUT, '16-vr-giant.png') });
  // aim the right pointer at the tablet's "Giant / Normal" button and pull the trigger
  const aim = await ev(`(() => { const T = __rcb.tablet, h = T.hits.find((x) => /Normal/.test(x.b.label)); if (!h) return null;
    const u = (h.x + h.w / 2) / T.W, v = 1 - (h.y + h.h / 2) / T.H;
    const p = T.mesh.localToWorld(new T.mesh.position.constructor((u - 0.5) * 0.3, (v - 0.5) * 0.375, 0));
    return p.toArray(); })()`);
  if (check(!!aim, 'the tablet has a Normal size button')){
    await ev(`(() => { const T = __rcb, R = T.vr[1]; const target = new T.rig.position.constructor(...${JSON.stringify(aim)});
      const from = R.rayPos.clone(); const dir = target.clone().sub(from).normalize();
      // turn the controller so its pointer faces the button (in rig space)
      const inv = T.rig.quaternion.clone().invert(); const d = dir.applyQuaternion(inv);
      const q = new T.rig.quaternion.constructor().setFromUnitVectors(new T.rig.position.constructor(0, 0, -1), d);
      window.__iwer.controllers.right.quaternion.set(q.x, q.y, q.z, q.w); })()`);
    await wait(600);
    await ev(`window.__iwer.controllers.right.updateButtonValue('trigger', 1)`); await wait(400);
    await ev(`window.__iwer.controllers.right.updateButtonValue('trigger', 0)`); await wait(400);
    check(await ev('__rcb.rig.scale.x') === 1, 'pointing and pulling the trigger on the tablet works (now normal size)');
  }
  await pg.screenshot({ path: path.join(OUT, '17-vr-normal.png') });
  await ev('__rcb.startRide()');
  await until('__rcb.train.state === "running" && __rcb.train.v > 8', 40, 'riding in VR');
  check(await ev('__rcb.camera.getWorldPosition(new __rcb.rig.position.constructor()).distanceTo(__rcb.train.seatEye()) < 0.3'), 'your head is in the front seat');
  await pg.screenshot({ path: path.join(OUT, '18-vr-ride.png') });
  await ev('__rcb.stopRide()');
}

check(errors.length === 0, 'no errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
console.log(`${failures ? failures + ' FAILED' : 'all passed'} in ${Math.round((Date.now() - started) / 1000)} s; screenshots in ${OUT}`);
await browser.close(); server.close();
process.exit(failures ? 1 : 0);
