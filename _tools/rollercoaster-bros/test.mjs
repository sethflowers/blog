// Plays Rollercoaster Bros in headless Chromium, checks it, and saves screenshots.
//
//   npm i --prefix _tools/vr-test iwer        (once; the VR part uses Meta's emulated Quest 3)
//   NODE_PATH=$(npm root -g) node _tools/rollercoaster-bros/test.mjs [outDir] [--full]
//
// By default it's quick (about a minute): it loads, makes a park, builds a coaster and a hanging coaster,
// rides it, and does the VR part. --full plays the whole lot (about five minutes):
// Serves the repo the way Jekyll would publish it (front matter stripped, version filled in). Then, on
// screen: the title and version, naming your first theme park, the welcome, building a simple loop by hand and with Finish, the train
// running, visitors queueing, riding and paying, riding it yourself, watching, the speed choices, buying
// hills / drops / a loop / a barrel roll / a jump and building with them, blocked pieces, undo, new
// trains and paint, more coasters side by side (a theme park), saving a design and building it again,
// the upside-down piece, saving and loading, a second park in free-build mode (everything free, track up to
// level 12), switching and deleting parks, and loading a park saved by version 1.0. Then in VR: entering a session at giant size, the tablet on the
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
const FULL = process.argv.includes('--full');
const OUT = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || 'rollercoaster-bros-shots');
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
pg.on('dialog', (d) => d.accept());
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

console.log('Rollercoaster Bros ' + VERSION + (FULL ? ' (full)' : ' (quick: --full for everything)'));
const started = Date.now();
await pg.goto(BASE);
await pg.waitForFunction('window.__rcb', null, { timeout: 90000 }).catch((e) => { console.log('the game did not start:', errors.join(' | ')); throw e; });
await ev('localStorage.clear()');
await wait(800);
check((await pg.textContent('.build-version')).includes(VERSION), 'title shows version ' + VERSION);
check(await ev('__rcb.track.complete'), 'a demo coaster runs behind the title');
await shot('01-title');

// ---------- quick: the main things ----------
if (!FULL){
await ev(`document.getElementById('b-play').click()`);
await wait(300);
check(await ev(`document.getElementById('newpark').classList.contains('show')`), 'Play asks you to name a new park');
await pg.fill('#np-name', 'Quick Park'); await pg.click('#np-free'); await pg.click('#np-go');
await wait(500);
check(await ev('__rcb.mode') === 'screen' && await ev('__rcb.park.free'), 'a free-build park starts on the screen');
await ev('__rcb.closePanels(); __rcb.noRender = true; __rcb.timeScale = 3');
for (const t of ['straight', 'left', 'left', 'straight', 'straight', 'straight', 'left', 'left']) await add(t);
check(await ev('__rcb.track.complete'), 'a simple loop can be built');
// draw a track: drag a finger (the mouse) round a big loop on the ground, and it gets built
await ev('__rcb.track.reset(); __rcb.track.changed(); __rcb.train.reset(); __rcb.toggleDraw()');
check(await ev('__rcb.draw.on') && await ev(`[...document.querySelectorAll('#palette .pb.tool')].some((b) => b.textContent.includes('Drawing'))`), 'the Draw tool starts drawing');
check(await ev('Math.abs(__rcb.orbit.yaw) < 0.01 && __rcb.orbit.pitch > 1.4'), 'the camera looks straight down at the park');
await ev('__rcb.orbit.target.set(20, 0, -6); __rcb.orbit.dist = 140'); await ev('__rcb.noRender = false'); await wait(700);
const STROKE = [];
const addArc = (pts) => { for (const p of pts) STROKE.push(p); };
for (let z = -8; z >= -50; z -= 3) STROKE.push([0, z]);
for (let a = 0; a <= 1.001; a += 0.1) STROKE.push([20 - 20 * Math.cos(a * Math.PI), -50 - 20 * Math.sin(a * Math.PI)]);
for (let z = -50; z <= 18; z += 3) STROKE.push([40, z]);
for (let a = 0; a <= 1.001; a += 0.1) STROKE.push([20 + 20 * Math.cos(a * Math.PI), 18 + 16 * Math.sin(a * Math.PI)]);
for (let z = 18; z >= 22; z -= 3) STROKE.push([0, z]);
void addArc;
const screenPts = await ev(`(() => { const C = __rcb.camera, r = __rcb.renderer.domElement.getBoundingClientRect(); return ${JSON.stringify(STROKE)}.map(([x, z]) => { const v = new __rcb.rig.position.constructor(x, 0, z).project(C); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; }); })()`);
check(screenPts.every(([x, y]) => x > 0 && x < 1024 && y > 0 && y < 600), 'the whole loop is on the screen to draw');
await pg.mouse.move(...screenPts[0]); await pg.mouse.down();
for (const p of screenPts.slice(1)) await pg.mouse.move(p[0], p[1], { steps: 3 });
await shot('q0a-drawing');
await ev('__rcb.noRender = false');
await pg.mouse.up();
await wait(300);
await shot('q0b-drawn');
// then draw how high it goes, on the side view of the track
check(await ev(`document.getElementById('heights').classList.contains('show')`), 'then a side view asks how high it goes');
const hc = await ev(`(() => { const r = document.getElementById('hcanvas').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()`);
const hp = (f, m) => [hc[0] + (45 + f * (hc[2] * 2 - 120)) / 2, hc[1] + (hc[3] * 2 - 50 - m * (hc[3] * 2 - 74) / 52) / 2];
await pg.mouse.move(...hp(0.02, 0)); await pg.mouse.down();
for (const [f, m] of [[0.1, 0], [0.18, 12], [0.26, 28], [0.32, 30], [0.4, 14], [0.48, 4], [0.6, 0], [0.98, 0]]) await pg.mouse.move(...hp(f, m), { steps: 6 });
await pg.mouse.up(); await wait(200);
const preview = await ev('__rcb.hts.preview');
check(preview.some((t) => /up|Up/.test(t)) && preview.some((t) => /down|Down/.test(t)), `drawing a hill there turns straights into climbs and drops (${preview.filter((t) => /up|down|Up|Down/.test(t)).join(', ')})`);
await shot('q0b2-heights');
await pg.click('#h-go');
await ev('__rcb.noRender = true');
await until('__rcb.track.complete', 30, 'what you drew is built, and joined up to the station');
check(await ev('__rcb.cur.rating.maxHeight') > 15, `with the hill you drew (${Math.round(await ev('__rcb.cur.rating.maxHeight'))} m high)`);
const drawn = await ev(`(() => { const T = __rcb.track; let maxX = -1e9, minZ = 1e9; for (const p of T.path){ maxX = Math.max(maxX, p.pos.x); minZ = Math.min(minZ, p.pos.z); } return { maxX, minZ, n: T.types().length, turns: T.types().filter((t) => /left|right/i.test(t)).length }; })()`);
check(drawn.maxX > 30 && drawn.maxX < 52 && drawn.minZ < -60 && drawn.minZ > -82, `it goes where it was drawn (${drawn.n} pieces, ${drawn.turns} turns, out to x ${Math.round(drawn.maxX)}, z ${Math.round(drawn.minZ)})`);
await ev('__rcb.noRender = false; __rcb.orbit.follow = false; __rcb.orbit.target.set(20, 0, -20); __rcb.orbit.dist = 150; __rcb.orbit.pitch = 1.2'); await wait(400);
await shot('q0c-built-from-drawing');
await ev('__rcb.noRender = true');
// a hanging coaster: track above, feet dangling
await ev('__rcb.newCoaster(true)');
check(await ev('__rcb.track.hang && __rcb.cur.data.hang') && await ev('__rcb.park.coasters.length') === 2, 'a new hanging coaster');
for (const t of ['straight', 'boost', 'up', 'up', 'steepUp', 'right', 'steepDown', 'down', 'down', 'right', 'loop']) await add(t);
await ev('__rcb.finishTrack()');
await until('__rcb.track.complete', 15, 'its track is finished');
const climb2 = await ev(`__rcb.track.pieces[4].pts[0].tan.y`);
check(climb2 > 0.2, `two hills in a row join into one smooth climb (${climb2.toFixed(2)} steep at the join)`);
const boost = await ev(`(() => { const T = __rcb.track, sp = T.speeds(__rcb.cur.speedV), ks = T.path.map((p, k) => k).filter((k) => T.path[k].piece.type === 'boost'); return { a: sp[ks[0]], b: sp[ks[ks.length - 1]] }; })()`);
check(boost.b > boost.a + 6, `a booster speeds the train up (${Math.round(boost.a * 2.237)} → ${Math.round(boost.b * 2.237)} mph)`);
await until('__rcb.train.boosting && __rcb.train.v > 14', 60, 'and the train really zooms off it');
await ev(`(() => { const p = __rcb.track.path.find((q) => q.piece.type === 'boost'); __rcb.orbit.follow = false; __rcb.orbit.target.copy(p.pos); __rcb.orbit.dist = 12; __rcb.orbit.yaw = 0.9; __rcb.orbit.pitch = 0.35; __rcb.noRender = false; })()`);
await shot('q0d-booster');
await until('__rcb.train.riders().length > 0', 120, 'visitors ride the hanging coaster');
check(await ev('__rcb.train.riderMeshes.filter(Boolean).every((r) => r.userData.legs && r.userData.legs.length === 2)'), 'their legs dangle');
await until('__rcb.train.state === "loading"', 120, 'the train comes back in');
await ev('__rcb.noRender = false; __rcb.orbit.follow = false; __rcb.orbit.target.set(56 + 1, 2, -1); __rcb.orbit.dist = 7.5; __rcb.orbit.yaw = 1.1; __rcb.orbit.pitch = 0.12');
await shot('q1-hanging-train');
await ev('__rcb.startRide()');
check(await ev('!!__rcb.train.riderMeshes[0] && __rcb.train.riderMeshes[0].userData.legs.length === 2'), 'riding it, you can see your own legs dangling');
check(await ev(`__rcb.track.at(__rcb.train.s).pos.y - __rcb.train.seatEye().y > 1`), 'and the track is above your head');
await until('__rcb.train.state === "running" && __rcb.train.v > 6', 60, 'off you go');
await ev('__rcb.timeScale = 1; __rcb.look.pitch = -0.75');
await shot('q2-ride-hanging-look-down');
await ev('__rcb.look.pitch = 0'); await shot('q3-ride-hanging');
await ev('__rcb.stopRide(); __rcb.noRender = true');
}

// ---------- on screen (full) ----------
if (FULL){
await ev(`document.getElementById('b-play').click()`);
await wait(300);
check(await ev(`document.getElementById('newpark').classList.contains('show')`) && await ev('__rcb.mode') === 'title', 'with no parks yet, Play asks you to make one');
check(await ev(`document.getElementById('np-go').disabled`), 'you have to give it a name');
await pg.fill('#np-name', 'Sunny Hills');
check(!(await ev(`document.getElementById('np-go').disabled`)) && await ev(`document.getElementById('np-money').classList.contains('on')`), 'then you can build it ("earn it" is picked to start with)');
await shot('02-new-park');
await pg.click('#np-go');
await wait(600);
check(await ev('__rcb.mode') === 'screen', 'Build it! starts the game on the screen');
check(await ev('__rcb.park.state.name') === 'Sunny Hills' && !(await ev('__rcb.park.free')), 'in the park you named, with money');
check(await ev('__rcb.track.pieces.length') === 1, 'a new park has only the station');
check(await ev(`!!document.querySelector('#panel.show') && document.querySelector('#panel h2').textContent.includes('Welcome')`), 'a welcome explains what to do');
await shot('03-welcome');
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
await shot('03b-building');
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
const r1 = await ev('__rcb.cur.rating');
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
const spent = await ev(`(() => { __rcb.park.state.money = 20000; for (const g of ['wide', 'hills', 'steep', 'loop', 'roll', 'hang', 'jump']) __rcb.buyGroup(g); return 20000 - __rcb.park.state.money; })()`);
check(await ev('__rcb.park.state.groups.length') === 8, 'every kind of track can be bought');
check(spent === 150 + 300 + 800 + 1500 + 2500 + 3200 + 4000, 'and it costs what it says');
await ev('__rcb.closePanels()');
void m0;

// a big coaster: clear and build with hills, a drop, a loop, a roll and a jump
await ev('__rcb.track.reset(); __rcb.addPiece("straight")');
for (const t of ['up', 'steepUp', 'straight', 'steepDown', 'down', 'loop', 'bigLeft', 'roll', 'left', 'hang', 'jump', 'bigLeft', 'up', 'down', 'loop']) await add(t);
check(await ev('__rcb.track.types().length') === 16, 'hills, drops, loops, a barrel roll, upside-down track and a jump all fit');
check(!(await ev(`__rcb.addPiece('steepDown')`)) && await ev('__rcb.track.types().length') === 16, 'track can\'t go under the ground');
await ev('__rcb.finishTrack()');
await until('__rcb.track.complete', 10, 'Finish closes the big coaster too');
const r2 = await ev('__rcb.cur.rating');
check(r2.excitement > r1.excitement + 3, `the big coaster is much more fun (${r2.excitement})`);
check(r2.inversions === 4, 'it turns you upside down four times');
await ev('__rcb.orbit.follow = false; __rcb.orbit.target.set(-10, 4, -40); __rcb.orbit.dist = 110; __rcb.orbit.yaw = 0.9; __rcb.orbit.pitch = 0.5');
await shot('09-big-coaster');
// upside down at the top of a loop, and the train jumping
const loopTop = await ev(`(() => { const T = __rcb.track; let best = null; for (const p of T.path) if (p.piece.type === 'loop' && (!best || p.pos.y > best.pos.y)) best = p; return { s: best.s, up: best.up.y }; })()`);
check(loopTop.up < -0.95, 'the top of the loop is upside down');
// ride: put the train at the top of the loop (riders' view)
await ev(`__rcb.startRide(); __rcb.timeScale = 1; __rcb.train.state = 'running'; __rcb.train.dist = ${loopTop.s} - 13 + 1.5; __rcb.train.s = 13 + __rcb.train.dist; __rcb.train.v = 4`);
await shot('10-ride-loop');
const jump = await ev(`(() => { const T = __rcb.track; const p = T.path.find((p) => p.piece.type === 'jump' && p.gap); return p.s; })()`);
// riding along upside down
const hang = await ev(`(() => { const ps = __rcb.track.path.filter((p) => p.piece.type === 'hang'); const mid = ps[Math.floor(ps.length / 2)]; return { s: mid.s, up: mid.up.y, n: ps.filter((p) => p.up.y < -0.95).length / ps.length }; })()`);
check(hang.up < -0.95 && hang.n > 0.3, `the upside-down piece keeps you upside down for a good while (${Math.round(hang.n * 100)}% of it)`);
await ev(`__rcb.train.dist = ${hang.s} - 13 + 2.6; __rcb.train.s = 13 + __rcb.train.dist; __rcb.train.v = 6`);
await shot('10b-ride-upside-down');
await ev(`__rcb.train.dist = ${jump} - 13 + 3; __rcb.train.s = 13 + __rcb.train.dist; __rcb.train.v = 15`);
await shot('11-ride-jump');
await ev('__rcb.stopRide(); __rcb.timeScale = 3; __rcb.train.reset()');

// speed
await ev('__rcb.speedPanel()');
await shot('12-speed');
await ev('__rcb.setSpeed(4)');
const r3 = await ev('__rcb.cur.rating');
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
await ev('__rcb.closePanels(); __rcb.train.setStyle("dragon"); __rcb.cur.data.cart = "dragon"');

// ---------- a theme park: more coasters, saved designs ----------
await ev('__rcb.setSpeed(2)');
const cost2 = await ev('(() => { const m = __rcb.park.state.money; __rcb.newCoaster(); return m - __rcb.park.state.money; })()');
check(await ev('__rcb.park.coasters.length') === 2 && await ev('__rcb.cur.oi') === 7, 'a second coaster gets its own station next door');
check(cost2 === 1000, 'it costs $1,000');
check(await ev('__rcb.track.pieces.length') === 1 && !(await ev('__rcb.park.scenery.plots[1].visible')), 'it starts with just its station (and the "coaster site" sign goes)');
check(await ev(`(() => { const c0 = __rcb.park.coasters[0].track; const p = c0.pieces.find((q, i) => i > 0 && q.type === 'straight' && q.level === 0); return __rcb.track.check('straight', { i: p.i, j: p.j, level: 0, d: p.d }, undefined).why; })()`) === 'That would crash into another coaster.', 'track can\'t crash into another coaster');
for (const t of ['straight', 'straight', 'right', 'up', 'down', 'right', 'loop']) await add(t);
await ev('__rcb.finishTrack()');
await until('__rcb.track.complete', 10, 'the second coaster is finished');
await ev('__rcb.coastersPanel()');
await shot('15-coasters-panel');
await ev('__rcb.saveDesign()');
check(await ev('__rcb.park.designs.length') === 1, 'its design is saved');
await ev('__rcb.designsPanel()');
await shot('16-designs');
// a third coaster on the other side, built from the saved design
await ev('__rcb.park.state.money += 5000; __rcb.newCoaster()');
check(await ev('__rcb.cur.oi') === -7, 'a third coaster goes on the other side of the first');
await ev('__rcb.buildDesign(0)');
const third = await ev('__rcb.track.types().length'), design = await ev('__rcb.park.designs[0].track.length');
if (!(await ev('__rcb.track.complete'))){ await ev('__rcb.finishTrack()'); await until('__rcb.track.complete || __rcb.building === 0', 10, 'finish the rest'); }
check(third > 4 && await ev('__rcb.track.complete'), `the saved design is built on the third coaster (${third} of ${design} pieces fit as they were)`);
await until('__rcb.park.coasters.every((c) => c.train.state === "running" || c.data.riders > 0)', 60, 'all three trains run');
await until('__rcb.park.coasters.filter((c) => (c.data.riders || 0) > 0).length >= 2', 240, 'visitors ride more than one coaster');
await ev('__rcb.select(__rcb.park.coasters[0], true); __rcb.closePanels()');
check(await ev('__rcb.cur.name') === await ev('__rcb.park.coasters[0].name'), 'you can go back to the first coaster');
await ev('__rcb.orbit.follow = false; __rcb.orbit.target.set(0, 4, -30); __rcb.orbit.dist = 170; __rcb.orbit.yaw = 0.25; __rcb.orbit.pitch = 0.55');
await shot('17-theme-park');

// save and load
await ev('__rcb.park.save()');
const saved = await ev('JSON.parse(localStorage.getItem("rollercoaster-bros-park-" + __rcb.park.state.id))');
check((await ev('__rcb.readParks()')).list.map((p) => p.name).join() === 'Sunny Hills', 'it is in your list of parks');
check(saved.coasters.length === 3 && saved.coasters[0].track.length === (await ev('__rcb.track.types().length')) && saved.carts.length === 8, 'the park is saved, all three coasters');
await pg.reload();
await pg.waitForFunction('window.__rcb', null, { timeout: 90000 });
await wait(500);
await ev(`document.getElementById('b-play').click()`);
await wait(400);
check(await ev('__rcb.park.coasters.length') === 3 && await ev('__rcb.park.coasters.every((c) => c.track.complete)'), 'and comes back after a reload');
check(await ev('__rcb.park.coasters[0].train.style') === 'dragon' && await ev('__rcb.park.coasters[0].data.speed') === 2, 'with the same trains and speeds');
await ev('__rcb.noRender = true; __rcb.timeScale = 3');
await waitGame(20);
await ev('__rcb.orbit.follow = false; __rcb.orbit.target.set(4, 2, 0); __rcb.orbit.dist = 45; __rcb.orbit.yaw = 0.5; __rcb.orbit.pitch = 0.35');
await shot('18-park');

// ---------- a second theme park, free build ----------
await ev('__rcb.toTitle()');
await ev(`document.getElementById('b-parks').click()`);
check(await ev(`document.querySelectorAll('#parks-list .prow').length`) === 1, 'Your theme parks lists the park');
await ev(`document.getElementById('parks-new').click()`);
await pg.fill('#np-name', 'Free Land');
await pg.click('#np-free');
await shot('19-new-free-park');
await pg.click('#np-go');
await wait(600);
check(await ev('__rcb.mode') === 'screen' && await ev('__rcb.park.state.name') === 'Free Land' && await ev('__rcb.park.free'), 'a second park, in free-build mode');
check(await ev('__rcb.park.coasters.length') === 1 && await ev('__rcb.track.pieces.length') === 1, 'it starts empty');
check(await ev(`document.querySelectorAll('#palette .pb:not(.locked):not(.tool)').length`) === 14, 'every track piece is yours already');
check((await ev(`document.getElementById('h-money').textContent`)).includes('Free'), 'the money says Free build');
await ev('__rcb.closePanels(); __rcb.noRender = true; __rcb.timeScale = 3');
await ev('__rcb.shop("carts")');
check(await ev(`[...document.querySelectorAll('#panel .row button')].every((b) => !b.disabled || b.textContent.includes('Riding'))`), 'every train can be had');
await ev('__rcb.buyCart(__rcb.CARTS.find((x) => x.id === "gold")); __rcb.closePanels()');
check(await ev('__rcb.train.style') === 'gold' && await ev('__rcb.park.state.money') === 200, 'and costs nothing');
await ev('__rcb.newCoaster()');
check(await ev('__rcb.park.coasters.length') === 2 && await ev('__rcb.park.state.money') === 200, 'new coasters are free too');
// up, up, up: the height limit is level 12 (48 m)
await add('straight');
for (let k = 0; k < 6; k++) await add('steepUp');
check(await ev('__rcb.track.end.level') === 12, `track can climb to level 12 (${Math.round(await ev('__rcb.track.rate(12).maxHeight'))} m up)`);
check(!(await ev(`__rcb.addPiece('steepUp')`)) && (await ev(`__rcb.track.check('up').why`)) === 'That\'s too high!', 'but no higher');
for (const t of ['loop', 'right', 'steepDown', 'steepDown', 'steepDown', 'right', 'steepDown', 'steepDown', 'steepDown']) await add(t);
await ev('__rcb.finishTrack()');
await until('__rcb.track.complete', 15, 'the giant coaster is finished');
// climbs one after another join into one smooth slope (no flat bits at the joins)
const climb = await ev(`(() => { const ps = __rcb.track.path.filter((p) => p.piece.type === 'steepUp'); let minTan = 1, down = 0;
  for (let k = 1; k < ps.length; k++){ if (ps[k].pos.y < ps[k - 1].pos.y - 1e-3) down++; }
  for (const p of __rcb.track.pieces.slice(3, 8)) minTan = Math.min(minTan, p.pts[0].tan.y);
  return { minTan, down }; })()`);
check(climb.down === 0 && climb.minTan > 0.3, `six steep climbs in a row make one smooth climb (steepness at the joins ${climb.minTan.toFixed(2)})`);
const fast = await ev('__rcb.track.rate(12).maxSpeed');
check(fast > 25, `a tall climb then a big drop is really fast at Normal speed (${Math.round(fast * 2.237)} mph)`);
await until('__rcb.train.state === "running" && __rcb.train.v > 25', 200, 'the train really goes that fast');
// a hanging coaster: the track above you
await ev('__rcb.toggleHang()');
check(await ev('__rcb.track.hang && __rcb.track.complete') && await ev('__rcb.cur.data.hang'), 'it can be made a hanging coaster (and the track still fits)');
check(await ev(`(() => { const T = __rcb.train; T.reset(); const eye = T.seatEye(); const p = __rcb.track.at(T.s); return p.pos.y - eye.y > 1; })()`), 'the track is above your head');
await ev('__rcb.closePanels(); __rcb.orbit.follow = false; __rcb.orbit.target.set(57, 3, -4); __rcb.orbit.dist = 16; __rcb.orbit.yaw = 0.8; __rcb.orbit.pitch = 0.2; __rcb.noRender = false');
await shot('20a-hanging-station');
await ev('__rcb.startRide(); __rcb.timeScale = 1');
await until('__rcb.train.state === "running" && __rcb.train.v > 4.4 && __rcb.train.dist > 30', 60, 'riding the hanging coaster');
await shot('20b-ride-hanging');
check(await ev('__rcb.train.riderMeshes[0] && __rcb.train.riderMeshes[0].userData.legs.length === 2'), 'your own legs dangle on a hanging coaster');
await ev('__rcb.stopRide(); __rcb.timeScale = 3; __rcb.noRender = true');
await ev('__rcb.orbit.follow = false; __rcb.orbit.target.set(30, 15, -20); __rcb.orbit.dist = 120; __rcb.orbit.yaw = 0.6; __rcb.orbit.pitch = 0.3; __rcb.noRender = false');
await shot('20-free-park-tall');
await ev('__rcb.orbit.target.set(10.9, 4, 44); __rcb.orbit.dist = 22; __rcb.orbit.yaw = 0; __rcb.orbit.pitch = 0.1');
await shot('21-park-gate');
// back to the first park, then delete this one
await ev('__rcb.toTitle()');
check((await ev(`document.getElementById('t-park').textContent`)).includes('Free Land'), 'the title says which park you\'ll play');
await ev(`document.getElementById('b-parks').click()`);
await shot('22-parks');
await ev(`document.querySelectorAll('#parks-list .pplay')[0].click()`);
check(await ev('__rcb.park.state.name') === 'Sunny Hills' && await ev('__rcb.park.coasters.length') === 3, 'picking the first park brings back its three coasters');
await ev(`document.querySelectorAll('#parks-list .pdel')[1].click()`);
check((await ev('__rcb.readParks()')).list.map((p) => p.name).join() === 'Sunny Hills', 'a park can be deleted');
await ev(`document.getElementById('parks-close').click()`);
await ev(`document.getElementById('b-play').click()`); await wait(300);
check(await ev('__rcb.mode') === 'screen' && await ev('__rcb.park.state.name') === 'Sunny Hills' && await ev('__rcb.park.state.money') > 1000, 'and played again, money and all');

// a park saved by version 1.0 (one coaster) still loads; designs are kept
await ev('__rcb.park.save = () => {}');   // (so leaving the page doesn't save over it)
await ev(`localStorage.removeItem('rollercoaster-bros-parks'); localStorage.setItem('rollercoaster-bros-save', JSON.stringify({ money: 999, groups: ['starter'], carts: ['classic'], cart: 'classic', speed: 1, color: 2, track: ['straight', 'left', 'left', 'straight', 'straight', 'straight', 'left', 'left'], riders: 5, earned: 40 }))`);
await pg.reload(); await pg.waitForFunction('window.__rcb', null, { timeout: 90000 }); await wait(400);
await ev(`document.getElementById('b-play').click()`); await wait(300);
check(await ev('__rcb.park.coasters.length') === 1 && await ev('__rcb.track.complete') && await ev('__rcb.park.state.money') >= 999 && await ev('__rcb.cur.data.speed') === 1, 'a park saved by version 1.0 still loads');
check(await ev('__rcb.park.state.name') === 'My Park' && await ev(`localStorage.getItem('rollercoaster-bros-save') === null`), 'it becomes a park called My Park');
check(await ev('__rcb.park.designs.length') === 1, 'saved designs are kept');
await ev('__rcb.noRender = true; __rcb.timeScale = 3');

}

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
  // drawing in VR: a new coaster, point the laser at the ground and hold the trigger
  const back = await ev('__rcb.park.coasters.indexOf(__rcb.cur)');
  await ev('__rcb.noRender = false'); await wait(800);   // (the head and controllers only move when frames are drawn)
  await ev(`__rcb.park.state.money += 5000; __rcb.park.state.groups.push('hills', 'steep'); __rcb.newCoaster(false); __rcb.closePanels(); __rcb.toggleDraw()`);
  await wait(600);
  const aimAt = (x, z) => ev(`(() => { const T = __rcb, R = T.vr[1]; const target = new T.rig.position.constructor(${x}, 0, ${z});
    const d = target.sub(R.rayPos).normalize().applyQuaternion(T.rig.quaternion.clone().invert());
    const q = new T.rig.quaternion.constructor().setFromUnitVectors(new T.rig.position.constructor(0, 0, -1), d);
    window.__iwer.controllers.right.quaternion.set(q.x, q.y, q.z, q.w); })()`);
  const ox = await ev('__rcb.cur.ox');
  const vrStroke = [];
  for (let z = -8; z >= -40; z -= 4) vrStroke.push([ox, z]);
  for (let a = 0.1; a <= 1.001; a += 0.15) vrStroke.push([ox + 16 - 16 * Math.cos(a * Math.PI / 2), -40 - 16 * Math.sin(a * Math.PI / 2)]);
  await aimAt(...vrStroke[0]); await wait(300);
  await ev(`window.__iwer.controllers.right.updateButtonValue('trigger', 1)`);
  // raise your hand for the middle of the line: that bit goes up
  for (const [n, p] of vrStroke.entries()){ const up = n > 2 && n < 7 ? 0.6 : 0; await ev(`window.__iwer.controllers.right.position.set(0.15, ${1.3 + up}, -0.2)`); await aimAt(...p); await wait(120); }
  await ev(`window.__iwer.controllers.right.position.set(0.15, 1.3, -0.2)`);
  check(await ev('__rcb.draw.pts.length') > 8, `holding the trigger draws on the ground (${await ev('__rcb.draw.pts.length')} points)`);
  await pg.screenshot({ path: path.join(OUT, 'vr-0-drawing.png') });
  await ev(`window.__iwer.controllers.right.updateButtonValue('trigger', 0)`);
  await pg.waitForFunction('__rcb.track.types().length >= 3 && __rcb.building === 0', null, { timeout: 30000 }).catch(() => {});
  const vrTypes = await ev('__rcb.track.types()');
  check(vrTypes.length >= 3 && vrTypes.some((t) => /right/i.test(t)), `letting go builds what you drew in VR (${vrTypes.join(', ')})`);
  check(vrTypes.some((t) => /up/i.test(t)), 'and raising your hand while drawing makes it climb');
  await ev(`__rcb.select(__rcb.park.coasters[${back}], true)`);
  await wait(500);
  await ev('__rcb.noRender = false');
  await wait(800);
  await pg.screenshot({ path: path.join(OUT, '23-vr-giant.png') });
  // aim the right pointer at the tablet's "Giant / Normal" button and pull the trigger
  const aim = await ev(`(() => { const T = __rcb.tablet, h = T.hits.find((x) => /Normal [(]B[)]/.test(x.b.label)); if (!h) return null;
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
  await pg.screenshot({ path: path.join(OUT, '24-vr-normal.png') });
  await ev('__rcb.startRide()');
  await until('__rcb.train.state === "running" && __rcb.train.v > 8', 40, 'riding in VR');
  check(await ev('__rcb.camera.getWorldPosition(new __rcb.rig.position.constructor()).distanceTo(__rcb.train.seatEye()) < 0.3'), 'your head is in the front seat');
  await pg.screenshot({ path: path.join(OUT, '25-vr-ride.png') });
  await ev('__rcb.stopRide()');
}

check(errors.length === 0, 'no errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
console.log(`${failures ? failures + ' FAILED' : 'all passed'} in ${Math.round((Date.now() - started) / 1000)} s; screenshots in ${OUT}`);
await browser.close(); server.close();
process.exit(failures ? 1 : 0);
