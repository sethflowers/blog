// Plays Safari Cruise in headless Chromium, checks it, and saves screenshots.
//
//   npm i --prefix _tools/vr-test iwer        (once; the VR part uses Meta's emulated Quest 3)
//   NODE_PATH=$(npm root -g) node _tools/safari-cruise/test.mjs [outDir]
//
// Serves the repo the way Jekyll would publish it (front matter stripped, version filled in). Then, on
// screen: the title and version, the welcome, the safari from above, visitors arriving, queueing,
// boarding and paying, trucks touring, animals in every enclosure, tapping an animal, jobs appearing
// and staff driving out to do them, a breakdown and its repair, a service at the garage, riding a
// truck, driving the jeep and fixing a job yourself, the shop (an enclosure, animals, a truck, an
// upgrade), staff, the office and ticket price, the end of a day, saving and loading. Then in VR:
// walking about, the tablet, pointing at a tablet button, riding and driving.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(HERE, '../..');
const OUT = path.resolve(process.argv[2] || 'safari-cruise-shots');
const ONLY = process.env.ONLY || '';
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
const VERSION = (fs.readFileSync(path.join(ROOT, '_experiments/safari-cruise.html'), 'utf8').match(/version:\s*"?([^"\n]+)"?/) || [])[1];
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
const BASE = `http://127.0.0.1:${server.address().port}/experiments/safari-cruise/`;

let failures = 0;
const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) failures++; return ok; };
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 960, height: 660 } });
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
// Speed: the game is run forward inside the page (__sc.advance) instead of waiting for frames, and
// nothing is drawn except one frame for each screenshot. In VR the controllers' state only changes on
// a headset frame, so after moving a stick or pulling a trigger the test waits for a real frame
// (drawn at a fraction of the headset's resolution) and then runs the game forward the same way.
const shot = async (name) => {
  await ev('__sc.renderNow()');
  await pg.screenshot({ path: path.join(OUT, name + '.png'), timeout: 180000 });
};
const nextFrame = async () => { const t = await ev('__sc.time'), start = Date.now(); while ((await ev('__sc.time')) === t && Date.now() - start < 20000) await wait(30); };
const waitGame = (sec) => ev(`__sc.advance(${sec})`);
const until = async (expr, sec, what) => check(await ev(`__sc.advance(${sec}, () => (${expr}))`), what + ((await ev(expr)) ? '' : ' (timed out)'));

// stand `back` metres from a point (on the road side of it), looking at it
const look = (expr, back = 10, side = 0) => ev(`(() => { const W = __sc.world, c = (${expr}); const pol = W.polar(c.x, c.z); const dir = pol.lat > 0 ? -1 : 1; const p = W.at(pol.phi + ${side} / 150, pol.lat + dir * ${back}); __sc.standAt(p, c); __sc.player.pitch = Math.atan2(c.y - (p.y + 1.6), ${back}) * 0.8; })()`);
console.log('Safari Cruise ' + VERSION);
const started = Date.now();
await pg.goto(BASE);
await pg.waitForFunction('window.__sc', null, { timeout: 120000 }).catch((e) => { console.log('the game did not start:', errors.join(' | ')); throw e; });
await ev('localStorage.clear()');
await ev('__sc.noRender = true');
await wait(1000);
check((await pg.textContent('.build-version')).includes(VERSION), 'title shows version ' + VERSION);
check(await ev('__sc.sim.animals.length') >= 10, 'animals are out behind the title');
await shot('01-title');

// ---------- on screen ----------
await ev(`document.getElementById('b-new').style.display = ''; document.getElementById('b-play').click()`);
await wait(800);
check(await ev('__sc.mode') === 'screen', 'Play starts the game on the screen');
check(await ev(`!!document.querySelector('#panel.show') && document.querySelector('#panel h2').textContent.includes('Welcome')`), 'a welcome explains what to do');
await shot('02-welcome');
await ev('__sc.closePanels()');
const S0 = await ev('({ money: __sc.sim.state.money, trucks: __sc.sim.trucks.length, staff: __sc.sim.staff.length, animals: __sc.sim.animals.length, open: Object.keys(__sc.sim.state.open) })');
check(S0.money === 6000 && S0.trucks === 2 && S0.staff === 3, `a new safari: $6,000, 2 trucks, 3 staff (${JSON.stringify(S0)})`);
check(S0.open.join() === 'plains,giraffe' && S0.animals === 15, 'two enclosures open with 15 animals');
check(await ev('__sc.view') === 'walk', 'you start on foot at the Lodge');
await shot('03-lodge');
// walking: the thumb stick moves you; fences stop you
const p0 = await ev('__sc.player.pos.clone()');
await ev('__sc.stick.y = -1'); await waitGame(2); await ev('__sc.stick.y = 0');
check(await ev(`__sc.player.pos.distanceTo(new __sc.player.pos.constructor(${p0.x}, ${p0.y}, ${p0.z}))`) > 5, 'the thumb stick walks you forward');
await ev(`(() => { const W = __sc.world, Z = __sc.ZONES[1], ph = (Z.phi0 + Z.phi1) / 2; __sc.standAt(W.at(ph, 58), W.at(ph, 80)); })()`);
await ev('__sc.stick.y = -1'); await waitGame(4); await ev('__sc.stick.y = 0');
check(await ev('__sc.world.polar(__sc.player.pos.x, __sc.player.pos.z).lat') < 62.2, 'you can\'t walk through a fence');
await ev(`(() => { const W = __sc.world, Z = __sc.ZONES[1], ph = Z.phi0 + 0.06; __sc.standAt(W.at(ph, 12), W.at(ph + 0.12, -25)); })()`);
await shot('04-jungle');

// visitors come, queue, board and pay; the trucks go round
await until('__sc.sim.crowd.list.length > 2', 40, 'visitors arrive at the car park and walk in');
await until('__sc.sim.queue.length > 0', 60, 'they queue on the station platform');
await until('__sc.sim.state.today.visitors > 0', 120, 'they board a truck');
check(await ev('__sc.sim.state.money') > 6000 - 200, 'and pay for their tickets');
await until('__sc.sim.trucks.some((t) => t.state === "touring" && t.riders.filter(Boolean).length > 0 && t.lapS > 150)', 120, 'a truck sets off round the loop with riders');
const lt = await ev('__sc.sim.trucks.findIndex((t) => t.state === "touring" && t.riders.filter(Boolean).length > 0)');
await look(`__sc.sim.trucks[${lt}].pos.clone().add(__sc.sim.trucks[${lt}].fwd.clone().multiplyScalar(14))`, 9, 0);
await waitGame(1.5);
await shot('05-truck-touring');
await ev('__sc.standAt(__sc.world.lodgePoint(-24, 12).p, __sc.world.lodgePoint(0, 7).p)');
await shot('06-station');

// every enclosure (open them all with some extra money) and look at the animals
await ev('__sc.sim.state.money += 300000');
await ev('for (const Z of __sc.ZONES) if (!Z.lodge) __sc.sim.openZone(Z)');
check(await ev('__sc.ZONES.filter((Z) => !Z.lodge).every((Z) => __sc.sim.isOpen(Z))'), 'all nine enclosures can be opened');
const kinds = await ev('[...new Set(__sc.sim.animals.map((a) => a.kind))]');
check(kinds.length === 14, `14 kinds of animal (${kinds.join(', ')})`);
await waitGame(20); let n = 7;
for (const k of ['zebra', 'giraffe', 'rhino', 'elephant', 'hippo', 'lion', 'cheetah', 'tiger', 'bear', 'ostrich', 'crocodile', 'warthog']){
  if (ONLY && !ONLY.includes('animals')) break;
  await ev(`(() => { const a = __sc.sim.animals.find((x) => x.kind === '${k}' && !x.inWater) || __sc.sim.animals.find((x) => x.kind === '${k}'); a.held = true; const c = a.centre(), d = ${'elephant giraffe hippo rhino crocodile'.includes(k) ? 11 : 6}; const f = new c.constructor(Math.cos(a.yaw), 0, -Math.sin(a.yaw)); const p = c.clone().addScaledVector(f, d); __sc.standAt(p, c); __sc.player.pitch = Math.atan2(c.y - (__sc.world.height(p.x, p.z) + 1.6), d) * 0.7; })()`);
  await waitGame(0.3);
  await shot(String(n++).padStart(2, '0') + '-' + k);
}
await ev('for (const a of __sc.sim.animals) a.held = false');
// tapping an animal shows how it is
await ev(`(() => { const W = __sc.world, a = __sc.sim.animals.find((x) => x.kind === 'giraffe'); a.held = true; const c = a.centre(), pol = W.polar(c.x, c.z), dir = pol.lat > 0 ? 1 : -1; const p = W.at(pol.phi, pol.lat + dir * 10); __sc.standAt(p, c); })()`);
await ev('for (const j of __sc.sim.jobs) if (j.marker) j.marker.visible = false');
await ev('__sc.renderNow()');
await ev(`(() => { const a = __sc.sim.animals.find((x) => x.kind === 'giraffe'); __sc.camera.updateMatrixWorld(); const p = a.centre().project(__sc.camera); __sc.pick((p.x + 1) / 2 * innerWidth, (1 - p.y) / 2 * innerHeight); })()`);
check(await ev(`document.querySelector('#panel h2') && document.querySelector('#panel h2').textContent.includes('Giraffe')`), 'tapping a giraffe shows its health, cleanliness and hunger');
await shot('19-animal-panel');
await ev(`__sc.sim.animals.find((x) => x.kind === 'giraffe').held = false`);
await ev('for (const j of __sc.sim.jobs) if (j.marker) j.marker.visible = true');
await ev('__sc.closePanels()');

// jobs: make some problems and watch the staff deal with them
const a0 = await ev(`(() => { const a = __sc.sim.animals.find((x) => x.zone === 1 && x.kind === 'zebra'); a.data.sick = true; a.tint(); return a.data.id; })()`);
await ev(`(() => { const a = __sc.sim.animals.find((x) => x.zone === 2); a.data.dirt = 95; })()`);
await ev(`__sc.sim.foodLevels[1] = 0.1`);
await ev(`(() => { const W = __sc.world; for (let i = 0; i < 10; i++){ const p = W.randomSpot(1); __sc.sim.dung[1].push(p); } __sc.sim.refreshDung(); })()`);
await until('__sc.sim.jobs.some((j) => j.type === "vet") && __sc.sim.jobs.some((j) => j.type === "wash") && __sc.sim.jobs.some((j) => j.type === "feed") && __sc.sim.jobs.some((j) => j.type === "clean")', 5, 'jobs appear: a sick animal, a muddy one, an empty feeder, dung');
await waitGame(1);
check(await ev(`document.querySelectorAll('#jobs .job').length`) >= 4, 'the jobs are listed on the screen');
await until('__sc.sim.staff.some((s) => s.kind === "vet" && s.state === "driving")', 5, 'the vet drives out');
await look(`__sc.sim.staff.find((x) => x.kind === 'vet').jeep.pos.clone()`, 12, -8);
await waitGame(2);
await shot('20-vet-on-the-way');
await until(`!__sc.sim.animals.find((a) => a.data.id === '${a0}').data.sick`, 200, 'the vet treats the sick zebra');
await until('!__sc.sim.jobs.some((j) => j.type === "feed" || j.type === "clean" || j.type === "wash")', 300, 'the keeper fills the feeder, cleans up and washes the muddy animal');
check(await ev('__sc.sim.food(1)') > 0.5 && await ev('__sc.sim.dung[1].length') < 4, 'the feeder is full and the dung is gone');

// a breakdown: the trucks behind wait, a mechanic comes and fixes it
const tb = await ev(`(() => { const t = __sc.sim.trucks.find((x) => x.state === 'touring'); if (!t) return -1; __sc.sim.breakDown(t); return __sc.sim.trucks.indexOf(t); })()`);
if (check(tb >= 0, 'a truck breaks down')){
  await waitGame(4);
  check(await ev(`__sc.sim.trucks[${tb}].v`) === 0, 'it stops');
  check(await ev('__sc.sim.jobs.some((j) => j.type === "repair")'), 'a repair job appears');
  await look(`__sc.sim.trucks[${tb}].pos.clone()`, 10, 8);
  await shot('21-breakdown');
  await until(`!__sc.sim.trucks[${tb}].broken`, 200, 'the mechanic fixes it');
  await until(`__sc.sim.trucks[${tb}].v > 1`, 30, 'and it carries on');
}
// a worn-out truck goes in for a service at the end of its tour
const ts = await ev(`(() => { const t = __sc.sim.trucks.find((x) => x.state === 'touring' && !x.broken); t.data.condition = 30; return __sc.sim.trucks.indexOf(t); })()`);
await until(`__sc.sim.trucks[${ts}].serviceNext`, 3, 'a worn truck is booked in for a service');
await until(`__sc.sim.trucks[${ts}].state === 'depot' || __sc.sim.trucks[${ts}].data.condition === 100`, 400, 'it drives into the garage after its tour');
await waitGame(1);
await ev('__sc.standAt(__sc.world.road(__sc.world.depotS + 14, 4).p, __sc.world.depotPos)');
await shot('22-garage');
await until(`__sc.sim.trucks[${ts}].data.condition === 100`, 200, 'a mechanic services it (good as new)');
await until(`__sc.sim.trucks[${ts}].state === 'station' || __sc.sim.trucks[${ts}].state === 'touring' && __sc.sim.trucks[${ts}].v > 0`, 120, 'and it goes back to work');

// riding a truck
await ev(`document.getElementById('b-ride').click()`);
check(await ev('__sc.view') === 'ride' && await ev('!!__sc.rideTruck'), 'Ride puts you on a truck');
await until('__sc.rideTruck.state === "touring" && __sc.rideTruck.v > 1 && __sc.world.polar(__sc.rideTruck.pos.x, __sc.rideTruck.pos.z).zone > 1', 300, 'off round the safari');
await waitGame(1);
await shot('23-riding');
await ev(`document.getElementById('b-out').click()`);
check(await ev('__sc.view') === 'walk', 'Get out puts you back on foot');

// driving the jeep, and fixing a job yourself
await ev(`document.getElementById('b-drive').click()`);
check(await ev('__sc.view') === 'drive', 'Drive puts you in your jeep');
await ev('__sc.stick.y = -1'); await waitGame(3); await ev('__sc.stick.y = 0');
check(await ev('__sc.jeep.v') > 4, 'the thumb stick drives it');
await shot('24-driving');
await ev('__sc.camStyle = "cockpit"'); await shot('25-cockpit'); await ev('__sc.camStyle = "chase"');
const jid = await ev(`(() => { const a = __sc.sim.animals.find((x) => x.zone === 3 && !x.inWater); a.data.dirt = 99; __sc.sim.scanJobs(); const j = __sc.sim.jobs.find((x) => x.target === a && x.type === 'wash'); a.held = true; return j ? j.id : null; })()`);
await ev(`(() => { const j = __sc.sim.jobs.find((x) => x.id === ${jid}); const p = __sc.sim.jobPos(j); const W = __sc.world; const pol = W.polar(p.x, p.z); const q = W.at(pol.phi, pol.lat - Math.sign(pol.lat) * 6); __sc.jeep.reset(q, Math.atan2(p.x - q.x, p.z - q.z)); })()`);
await waitGame(0.5);
check(await ev(`__sc.nearJob() && __sc.nearJob().id === ${jid}`), 'driving up to a job offers Fix it');
await ev('__sc.startFix()');
await until(`!__sc.sim.jobs.some((x) => x.id === ${jid})`, 10, 'and you can do it yourself');
await ev(`document.getElementById('b-out').click()`);

// the shop, staff, office
await ev('__sc.closePanels(); __sc.shopPanel("animals")');
await shot('26-shop');
const nA = await ev('__sc.sim.animals.length');
await ev(`[...document.querySelectorAll('#panel .row button')].find((b) => !b.disabled).click()`);
check(await ev('__sc.sim.animals.length') === nA + 1, 'buying an animal adds it to its enclosure');
const nT = await ev('__sc.sim.trucks.length');
await ev('__sc.trucksPanel()'); await ev(`[...document.querySelectorAll('#panel .btns button')].find((b) => b.textContent.includes('Buy')).click()`);
check(await ev('__sc.sim.trucks.length') === nT + 1, 'buying a truck');
await ev('__sc.staffPanel()'); await shot('27-staff');
const nS = await ev('__sc.sim.staff.length');
await ev(`document.querySelector('#panel .row button').click()`);
check(await ev('__sc.sim.staff.length') === nS + 1, 'hiring a vet');
await ev('__sc.shopPanel("upgrades")'); await ev(`document.querySelector('#panel .row button').click()`);
check(await ev('__sc.sim.state.upgrades.roads'), 'buying an upgrade (smooth roads)');
await ev('__sc.officePanel()');
const t0 = await ev('__sc.sim.state.ticket');
await ev(`[...document.querySelectorAll('#panel .btns button')].find((b) => b.textContent === '+ $5').click()`);
check(await ev('__sc.sim.state.ticket') === t0 + 5, 'the ticket price can be changed');
await shot('28-office');
await ev('__sc.closePanels()');
// the end of the day: wages, a report
const day = await ev('__sc.sim.state.day');
await ev('__sc.sim.state.clock = 0.999');
await waitGame(1);
check(await ev('__sc.sim.state.day') === day + 1 && await ev('__sc.sim.state.days.length') > 0, 'the day ends with a report and wages are paid');
// saving and loading
await ev('__sc.sim.save()');
const saved = await ev('JSON.parse(localStorage.getItem("safari-cruise-v1"))');
await pg.reload();
await pg.waitForFunction('window.__sc', null, { timeout: 120000 });
await ev('__sc.noRender = true');
check(await ev('__sc.sim.animals.length') === saved.animals.length && await ev('__sc.sim.trucks.length') === saved.trucks.length && await ev('__sc.sim.staff.length') === saved.staff.vet + saved.staff.keeper + saved.staff.mechanic, 'the safari comes back after a reload');
check(await ev('Math.round(__sc.sim.state.money)') === Math.round(saved.money), 'with the same money');
await ev(`document.getElementById('b-play').click()`);
await wait(500);
await waitGame(30); await ev('__sc.goToZone(__sc.ZONES[6])');
check(await ev('__sc.world.polar(__sc.player.pos.x, __sc.player.pos.z).zone') === 6, 'Go to takes you to an enclosure (Lion Pride)');
await shot('29-lion-pride');

// ---------- VR ----------
if (IWER){
  await ev('__sc.xrScale = 0.3');
  await ev('__sc.startVR(false)');
  await pg.waitForFunction('__sc.mode === "vr"', null, { timeout: 30000 });
  check(true, 'VR session starts');
  await ev(`(() => { const d = window.__iwer; d.position.set(0, 1.6, 0); d.quaternion.set(0, 0, 0, 1);
    d.controllers.left.position.set(-0.1, 1.25, -0.35); d.controllers.left.quaternion.set(0, 0, 0, 1);
    d.controllers.right.position.set(0.15, 1.3, -0.2); d.controllers.right.quaternion.set(0, 0, 0, 1); })()`);
  await wait(1500);
  await until(`__sc.vrs.posed && __sc.world.polar(__sc.head[0], __sc.head[2]).zone === 0 && __sc.rig.scale.x === 1`, 20, 'you start at normal size, at the Lodge');
  await wait(800);
  check(await ev('__sc.vr[0].tracked && __sc.vr[1].tracked'), 'both controllers are tracked');
  check(await ev('__sc.tablet.mesh.visible && __sc.tablet.mesh.parent.visible'), 'the tablet is on your left hand');
  await pg.screenshot({ path: path.join(OUT, '30-vr-lodge.png'), timeout: 180000 });
  const aim = await ev(`(() => { const T = __sc.tablet, h = T.hits.find((x) => /Animals/.test(x.b.label)); if (!h) return null;
    const u = (h.x + h.w / 2) / T.W, v = 1 - (h.y + h.h / 2) / T.H;
    const p = T.mesh.localToWorld(new T.mesh.position.constructor((u - 0.5) * 0.3, (v - 0.5) * 0.375, 0));
    return p.toArray(); })()`);
  if (check(!!aim, 'the tablet has an Animals button')){
    await ev(`(() => { const T = __sc, R = T.vr[1]; const target = new T.rig.position.constructor(...${JSON.stringify(aim)});
      const from = R.rayPos.clone(); const dir = target.clone().sub(from).normalize();
      const inv = T.rig.quaternion.clone().invert(); const d = dir.applyQuaternion(inv);
      const q = new T.rig.quaternion.constructor().setFromUnitVectors(new T.rig.position.constructor(0, 0, -1), d);
      window.__iwer.controllers.right.quaternion.set(q.x, q.y, q.z, q.w); })()`);
    await wait(600);
    await ev(`window.__iwer.controllers.right.updateButtonValue('trigger', 1)`); await wait(400);
    await ev(`window.__iwer.controllers.right.updateButtonValue('trigger', 0)`); await wait(400);
    check((await ev('__sc.tabletSpec().title')).includes('Animals'), 'pointing and pulling the trigger on the tablet works (the Animals page opens)');
  }
  await pg.screenshot({ path: path.join(OUT, '31-vr-tablet.png'), timeout: 180000 });
  await ev('__sc.closePanels()');
  const h0 = await ev('__sc.head');
  await ev(`window.__iwer.controllers.left.updateAxes('thumbstick', 0, -1)`); await nextFrame(); await nextFrame(); await waitGame(2.5); await ev(`window.__iwer.controllers.left.updateAxes('thumbstick', 0, 0)`); await nextFrame(); await nextFrame();
  const h1 = await ev('__sc.head');
  check(Math.hypot(h1[0] - h0[0], h1[2] - h0[2]) > 3, 'walking in VR: the left stick walks you');
  await ev('__sc.startRide()');
  await waitGame(2); await nextFrame();
  check(await ev('__sc.camera.getWorldPosition(new __sc.rig.position.constructor()).distanceTo(__sc.rideTruck.seatEye(__sc.rideTruck.playerSeat)) < 0.4'), 'riding in VR: your head is in a truck seat');
  await pg.screenshot({ path: path.join(OUT, '32-vr-ride.png'), timeout: 180000 });
  await ev('__sc.leaveVehicle(); __sc.startDrive()');
  await ev(`window.__iwer.controllers.left.updateAxes('thumbstick', 0, -1)`); await nextFrame(); await nextFrame();
  await waitGame(3);
  await ev(`window.__iwer.controllers.left.updateAxes('thumbstick', 0, 0)`); await nextFrame(); await nextFrame();
  await nextFrame();
  check(await ev('__sc.jeep.v') > 3, 'driving in VR: the left stick drives the jeep');
  check(await ev('__sc.camera.getWorldPosition(new __sc.rig.position.constructor()).distanceTo(__sc.jeep.eye()) < 0.4'), 'and you are in the driving seat');
  await pg.screenshot({ path: path.join(OUT, '33-vr-drive.png'), timeout: 180000 });
  await ev('__sc.leaveVehicle()');
}

check(errors.length === 0, 'no errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
console.log(`${failures ? failures + ' FAILED' : 'all passed'} in ${Math.round((Date.now() - started) / 1000)} s; screenshots in ${OUT}`);
await browser.close(); server.close();
process.exit(failures ? 1 : 0);
