// Tests Camera Magic in headless Chromium and saves screenshots. About a minute.
//
//   npm i --prefix _tools/vr-test iwer        (once; the AR part uses Meta's emulated Quest 3)
//   NODE_PATH=$(npm root -g) node _tools/camera-magic/test.mjs [outDir]
//
// Chromium's fake camera (a moving test pattern) checks that the camera starts. Then real photos stand
// in for the camera (MediaPipe's own sample pictures, downloaded once into the system's temp folder),
// so the models have something to find: a cat and dogs, a pointing hand, a face, a body. Every mode is
// checked with them, then the headset's AR mode with an emulated Quest 3 (bubbles popped by moving a
// controller into them, the memory counts staying flat while bubbles come and go, B to leave).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { checkLoading } from '../loading-check.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(HERE, '../..');
const OUT = path.resolve(process.argv[2] || 'camera-magic-shots');
fs.mkdirSync(OUT, { recursive: true });
let IWER = null;
try { IWER = fs.readFileSync(require.resolve('iwer/build/iwer.min.js', { paths: [HERE, path.join(HERE, '../vr-test'), ...(process.env.NODE_PATH || '').split(':')] }), 'utf8'); }
catch (e) { console.log('(IWER not installed: skipping the AR part. npm i --prefix _tools/vr-test iwer)'); }

// the test pictures
const PICS = ['cats_and_dogs.jpg', 'pointing_up.jpg', 'portrait.jpg', 'pose.jpg'];
const PIC_DIR = path.join(os.tmpdir(), 'camera-magic-test-pictures');
fs.mkdirSync(PIC_DIR, { recursive: true });
for (const p of PICS){
  const f = path.join(PIC_DIR, p);
  if (fs.existsSync(f)) continue;
  const r = await fetch('https://storage.googleapis.com/mediapipe-assets/' + p);
  if (!r.ok) throw new Error('could not download the test picture ' + p);
  fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
}

const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.html': 'text/html', '.wasm': 'application/wasm' };
function page(name){
  const src = fs.readFileSync(path.join(ROOT, '_experiments', name + '.html'), 'utf8');
  const fm = src.match(/^---\n([\s\S]*?)\n---\n/);
  const version = (fm[1].match(/version:\s*"?([^"\n]+)"?/) || [])[1];
  return src.slice(fm[0].length).replace(/\{% endraw %\}\{\{ page\.version \}\}\{% raw %\}/g, version).replace(/\{% (end)?raw %\}/g, '');
}
const VERSION = (fs.readFileSync(path.join(ROOT, '_experiments/camera-magic.html'), 'utf8').match(/version:\s*"?([^"\n]+)"?/) || [])[1];
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const m = url.match(/^\/experiments\/([^/]+)\/(index\.html)?$/);
  try {
    if (m){ res.writeHead(200, { 'content-type': 'text/html' }); return res.end(page(m[1])); }
    const file = url.startsWith('/__pics/') ? path.join(PIC_DIR, path.basename(url)) : path.join(ROOT, url);
    if (!file.startsWith(ROOT) && !file.startsWith(PIC_DIR)) throw new Error('outside');
    const body = fs.readFileSync(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }); res.end(body);
  } catch (e) { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const BASE = `${ORIGIN}/experiments/camera-magic/`;

let failures = 0;
const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) failures++; return ok; };
const T0 = Date.now();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
console.log('Camera Magic ' + VERSION);

const ctx = await browser.newContext({ viewport: { width: 1024, height: 700 }, permissions: ['camera'] });
if (IWER) await ctx.addInitScript({ content: IWER + `
;window.__iwer = new IWER.XRDevice(IWER.metaQuest3, { stereoEnabled: false });
window.__iwer.installRuntime({ forceInstall: true });
` });
const pg = await ctx.newPage();
const errors = [];
pg.on('pageerror', (e) => errors.push(e.message + ' ' + (e.stack || '').split('\n').slice(1, 3).join(' ')));
pg.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const ev = (s, a) => pg.evaluate(s, a);
const shot = (name) => pg.screenshot({ path: path.join(OUT, name + '.png') });
const until = async (expr, sec, what) => {
  const ok = await pg.waitForFunction(expr, null, { timeout: sec * 1000, polling: 100 }).then(() => true, () => false);
  return check(ok, what + (ok ? '' : ' (timed out)'));
};
const pic = (name, mirror = false) => ev(([n, m]) => window.__cm.useImage('/__pics/' + n, { mirror: m }), [name, mirror]);
const chip = (sel) => pg.click('#bar ' + sel);

console.log('loading screen');
// with service workers blocked: this game's worker saves every file for offline as soon as the page
// starts, and takes the page over, so the file the check holds back would arrive from the worker
const noWorkers = { browserType: () => ({ launch: async (o) => {
  const b = await browser.browserType().launch(o), nc = b.newContext.bind(b);
  b.newContext = (opts = {}) => nc({ ...opts, serviceWorkers: 'block' });
  return b;
} }) };
await checkLoading({ browser: noWorkers, url: BASE + '?cpu', check, game: '__cm', shot: path.join(OUT, '00-loading.png') });

console.log('title and camera');
// the CPU only: headless Chromium's software GPU is slow, and the GPU path is the iPad's business
await pg.goto(BASE + '?cpu');
await pg.waitForFunction(() => window.__cm, null, { timeout: 60000 });
check((await pg.textContent('#title .build-version')).trim() === 'v' + VERSION, `the title screen shows the version (v${VERSION})`);
check(await ev(() => !document.getElementById('b-start').disabled), 'the Start button is ready');
await pg.waitForFunction(() => document.getElementById('loading').style.display === 'none');
await shot('01-title');
await pg.click('#b-start');
await until(() => window.__cm.cam.live && window.__cm.cam.w > 0 && window.__cm.playing, 20, 'the camera starts (Chromium\'s fake camera)');
check(await ev(() => document.getElementById('video').style.display === 'block'), 'the camera picture fills the screen');
await until(() => window.__cm.vision.status.objects === 'ready', 60, 'the object spotter loads');
await pg.waitForTimeout(500);
await shot('02-live-camera');

console.log('🔍 what it sees');
await pic('cats_and_dogs.jpg');
// (the small object model calls the poodle and the corgi cats too, but it finds all four animals)
await until(() => window.__cm.R.objects.filter((o) => o.label === 'cat' || o.label === 'dog').length >= 3, 20, 'it spots the animals in the cats-and-dogs picture');
await pg.waitForTimeout(300);
await shot('03-objects');
await pic('pointing_up.jpg');
await chip('[data-k=hands]');
await until(() => window.__cm.R.hands.length === 1, 40, 'the hand tracker finds the hand');
await shot('04-hand');
await pic('portrait.jpg');
await chip('[data-k=hands]');
await chip('[data-k=face]'); await chip('[data-k=segment]');
await until(() => window.__cm.R.face && window.__cm.R.face.pts.length >= 468, 40, 'the face tracker finds the face (468+ points)');
await until(() => window.__cm.R.mask && window.__cm.R.mask.data.length > 1000, 30, 'the cut-out tool makes a person mask');
const maskOk = await ev(() => { const m = window.__cm.R.mask; let n = 0; for (const v of m.data) if (v > 0.5) n++; return n / m.data.length; });
check(maskOk > 0.1 && maskOk < 0.9, `the mask covers the person, not everything (${Math.round(maskOk * 100)}% of the picture)`);
await shot('05-face-cutout');
await pic('pose.jpg');
await chip('[data-k=face]'); await chip('[data-k=segment]'); await chip('[data-k=pose]');
await until(() => window.__cm.R.pose && window.__cm.R.pose.pts.length === 33, 40, 'the body tracker finds the body (33 points)');
await shot('06-pose');
await chip('[data-k=pose]');

console.log('🧭 hunt');
await pg.click('#tabs [data-mode=hunt]');
await pic('cats_and_dogs.jpg');
await ev(() => window.__cm.modes.hunt.setClue(['cat']));
await until(() => window.__cm.modes.hunt.state.found.includes('cat'), 20, 'holding the camera on a cat finds the "cat" clue');
check(/Clue 2 of 6/.test(await pg.textContent('#banner')), 'the next clue shows');
await shot('07-hunt');

console.log('🫧 bubbles');
await pg.click('#tabs [data-mode=bubbles]');
await pic('pointing_up.jpg');
await until(() => window.__cm.vision.status.hands === 'ready' && window.__cm.R.hands.length === 1, 30, 'the hand is found in bubble mode');
await until(() => window.__cm.modes.bubbles.state.tips.length === 5, 5, 'its five fingertips are on screen');
// a bubble right at the pointing fingertip pops
await ev(() => { const S = window.__cm.modes.bubbles.state, t = S.tips[1]; S.bubbles.push({ x: t.x, y: t.y + 5, r: 40, vy: 0, wob: 0, kind: 'plain', hue: 200 }); });
await until(() => window.__cm.modes.bubbles.state.popped >= 1, 5, 'a fingertip pops a bubble');
// and tapping one pops it too
const before = await ev(() => window.__cm.modes.bubbles.state.popped);
await ev(() => { const S = window.__cm.modes.bubbles.state; S.bubbles.push({ x: 200, y: 400, r: 50, vy: 0, wob: 0, kind: 'gold', hue: 0 }); });
await pg.mouse.click(200, 400);
await until(`window.__cm.modes.bubbles.state.popped > ${before}`, 5, 'tapping a bubble pops it');
await pg.waitForTimeout(200);
await shot('08-bubbles');

console.log('🐾 Pip');
await pg.click('#tabs [data-mode=pip]');
await until(() => window.__cm.modes.pip.state.why === 'hand', 10, 'Pip heads for the open hand');
await until(() => { const S = window.__cm.modes.pip.state; return S.why === 'hand' && S.state === 'idle' && Math.hypot(S.x - S.target.x, S.y - S.target.y) < S.size * 0.3; }, 15, 'Pip hops onto the hand');
await pg.waitForTimeout(300);
await shot('09-pip-on-hand');
await pic('cats_and_dogs.jpg');
await until(() => window.__cm.modes.pip.state.why === 'thing', 10, 'with no hand, Pip goes to sit on a thing it sees');
await until(() => document.getElementById('speech').style.display === 'block', 5, 'Pip says what it sees');
await pg.waitForTimeout(2500);
await shot('10-pip-on-thing');

console.log('🎩 dress up');
await pg.click('#tabs [data-mode=dress]');
// an iPad held upright, like a selfie (the test portrait is tall: a wide screen crops the face off)
await pg.setViewportSize({ width: 700, height: 1000 });
await pic('portrait.jpg', true);
await chip(':text("Shades")'); await chip(':text("Moustache")'); await chip('[data-back=space]');
await until(() => window.__cm.R.face && window.__cm.R.mask, 30, 'dress up finds the face and the person');
await pg.waitForTimeout(500);
await shot('11-dress-up');
const costume = await ev(() => { const f = window.__cm.R.face, p = f && f.pts[10]; return p && p.y > 0.05; });
check(costume, 'the face is in view for the costume');
await chip('[data-back=none]');
await pg.waitForTimeout(300);
await shot('11b-dress-up-no-backdrop');
await pg.setViewportSize({ width: 1024, height: 700 });

console.log('📸 photo');
await pg.click('#b-photo');
await until(() => document.getElementById('photo').classList.contains('show') && document.getElementById('ph-img').naturalWidth > 0, 5, 'the photo button takes a photo and shows it');
await shot('12-photo');
await pg.click('#ph-close');

console.log('🌍 look around');
await pg.click('#tabs [data-mode=look]');
await pg.waitForTimeout(300);
const target = await ev(() => {
  // turn to face the first balloon, then tap where it is on screen
  const L = window.__cm.modes.look, b = L.state.balloons[0].mesh.position;
  L.state.dragYaw = Math.atan2(-b.x, -b.z); L.state.pitch = 0;
  return true;
});
await pg.waitForTimeout(300);
const xy = await ev(() => { const L = window.__cm.modes.look, v = L.state.balloons[0].mesh.position.clone().project(L.camera3); return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight }; });
await shot('13-look-around');
await pg.mouse.click(xy.x, xy.y);
await until(() => window.__cm.modes.look.state.popped === 1, 5, 'tapping a balloon pops it');
// drag to look
const yaw0 = await ev(() => window.__cm.modes.look.state.dragYaw);
await pg.mouse.move(500, 350); await pg.mouse.down(); await pg.mouse.move(700, 350, { steps: 5 }); await pg.mouse.up();
check(await ev(`window.__cm.modes.look.state.dragYaw !== ${yaw0}`), 'dragging turns the view');

console.log('memory');
// switch through every mode a few times: the 3D layer's memory stays flat
const counts = async () => ev(async () => { const { getRenderer } = await import('/experiments/camera-magic/js/three-layer.js'); const r = getRenderer(); return [r.info.memory.geometries, r.info.memory.textures]; });
const m1 = await counts();
for (let i = 0; i < 3; i++) for (const m of ['pip', 'look', 'spot', 'bubbles']){ await pg.click(`#tabs [data-mode=${m}]`); await pg.waitForTimeout(150); }
await ev(() => { window.__cm.modes.look.scatter(); });
await pg.click('#tabs [data-mode=look]'); await pg.waitForTimeout(200);
const m2 = await counts();
check(m2[0] <= m1[0] + 2 && m2[1] <= m1[1], `switching modes and new balloons don't pile up memory (geometries ${m1[0]} → ${m2[0]}, textures ${m1[1]} → ${m2[1]})`);

if (IWER){
  console.log('🥽 AR (emulated Quest 3)');
  await pg.click('#b-stop');
  await until(() => !document.getElementById('b-ar').disabled, 10, 'the "Play in AR" button is on (the headset can do AR)');
  await pg.click('#b-ar');
  await until(() => window.__cm.AR.on, 10, 'AR starts');
  await until(() => window.__cm.arInfo().posed && window.__cm.arInfo().pip, 10, 'once the headset knows where you are, Pip and the hint appear');
  await until(() => window.__cm.arInfo().bubbles >= 3, 15, 'bubbles float up around you');
  // move the right controller into a bubble
  const popped = await ev(async () => {
    const AR = window.__cm.AR, b = AR.bubbles[0].mesh.position;
    // the controller's tip is 5 cm along the handle (forward, -Z) from its grip
    window.__iwer.controllers.right.position.set(b.x, b.y, b.z + 0.05);
    const t0 = performance.now();
    while (performance.now() - t0 < 5000 && AR.popped < 1) await new Promise((r) => setTimeout(r, 50));
    return AR.popped;
  });
  check(popped >= 1, 'touching a bubble with a controller pops it');
  const g1 = await ev(() => window.__cm.arInfo().geometries);
  // churn: lots of bubbles come and go
  await ev(async () => {
    const AR = window.__cm.AR;
    for (let i = 0; i < 30; i++){
      while (!AR.bubbles.length) await new Promise((r) => setTimeout(r, 30));
      const b = AR.bubbles[0].mesh.position; window.__iwer.controllers.right.position.set(b.x, b.y, b.z + 0.05);
      const n = AR.popped; const t0 = performance.now();
      while (AR.popped === n && performance.now() - t0 < 2000) await new Promise((r) => setTimeout(r, 30));
    }
  });
  const info = await ev(() => window.__cm.arInfo());
  check(info.popped >= 20 && info.geometries <= g1 + 1, `popping ${info.popped} bubbles keeps the memory flat (geometries ${g1} → ${info.geometries})`);
  await shot('14-ar');
  await ev(() => { window.__iwer.controllers.right.updateButtonValue('b-button', 1); });
  await until(() => !window.__cm.AR.on, 10, 'B leaves AR');
  await ev(() => { window.__iwer.controllers.right.updateButtonValue('b-button', 0); });
}

// (MediaPipe reports "INFO: Created TensorFlow Lite XNNPACK delegate" as a console error)
const bad = errors.filter((e) => !/favicon|^INFO: /.test(e));
check(!bad.length, 'no errors in the console' + (bad.length ? ':\n     ' + bad.slice(0, 6).join('\n     ') : ''));
const gErr = await ev(() => window.__cm.errors);
check(!gErr.length, 'no errors in the frame loop' + (gErr.length ? ': ' + gErr[0] : ''));
console.log(`\n${failures ? failures + ' FAILED' : 'all passed'} in ${Math.round((Date.now() - T0) / 1000)} s · screenshots in ${OUT}`);
await browser.close(); server.close();
process.exit(failures ? 1 : 0);
