// Plays the Undercroft in headless Chromium with a fake controller and takes screenshots.
//
//   NODE_PATH=$(npm root -g) node _tools/undercroft/test.mjs [outDir]
//
// Serves the repo the way Jekyll would publish it (front matter stripped, version filled in), so no
// Jekyll install is needed. Checks: the page loads without errors, A on the controller starts it,
// the left stick walks, walls stop you, and following the shortest route with the sticks reaches
// the stairs and wins. Screenshots go to outDir (default: ./undercroft-shots).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.resolve(process.argv[2] || 'undercroft-shots');
fs.mkdirSync(OUT, { recursive: true });

const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.html': 'text/html' };
function page(name){
  const src = fs.readFileSync(path.join(ROOT, '_experiments', name + '.html'), 'utf8');
  const fm = src.match(/^---\n([\s\S]*?)\n---\n/);
  const version = (fm[1].match(/version:\s*"?([^"\n]+)"?/) || [])[1];
  return src.slice(fm[0].length).replace(/\{% endraw %\}\{\{ page\.version \}\}\{% raw %\}/g, version)
    .replace(/\{% (end)?raw %\}/g, '');
}
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
const BASE = `http://127.0.0.1:${server.address().port}/experiments/undercroft/`;

let failures = 0;
const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) failures++; };

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
// a standard-mapping controller whose sticks and buttons the test sets through window.__pad
await ctx.addInitScript(() => {
  window.__pad = { axes: [0, 0, 0, 0], buttons: new Array(17).fill(0) };
  navigator.getGamepads = () => [{ id: 'Test controller (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard',
    timestamp: performance.now(), axes: window.__pad.axes.slice(),
    buttons: window.__pad.buttons.map((v) => ({ pressed: v > 0.5, touched: v > 0, value: v })) }];
});
const tab = await ctx.newPage();
const errors = [];
tab.on('pageerror', (e) => errors.push(String(e)));
tab.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const seed = process.env.SEED || '1';
await tab.goto(BASE + '?test&seed=' + seed);
await tab.waitForFunction(() => window.__uc && window.__uc.ready, null, { timeout: 120000 });
const shot = async (name) => { await tab.screenshot({ path: path.join(OUT, name + '.png') }); console.log('  shot ' + name); };
await shot('01-title');
const version = await tab.textContent('.build-version');
check(/^v\d+\.\d+$/.test(version.trim()), `title shows the version (${version.trim()})`);

const pad = (axes, buttons) => tab.evaluate(([a, b]) => { window.__pad.axes = a; window.__pad.buttons = b; }, [axes, buttons]);
const press = async (i) => { const b = new Array(17).fill(0); b[i] = 1; await pad([0, 0, 0, 0], b);
  await tab.evaluate(() => window.__uc.advance(1 / 60)); await pad([0, 0, 0, 0], new Array(17).fill(0));
  await tab.evaluate(() => window.__uc.advance(1 / 60)); };
const none = new Array(17).fill(0);

await press(0);
check(await tab.evaluate(() => window.__uc.state) === 'play', 'A on the controller starts the game');
await tab.evaluate(() => window.__uc.advance(0.5));
await shot('02-start');

// walk forward with the left stick
const p0 = await tab.evaluate(() => ({ ...window.__uc.player }));
await pad([0, -1, 0, 0], none);
await tab.evaluate(() => window.__uc.advance(1.5));
const p1 = await tab.evaluate(() => ({ ...window.__uc.player }));
check(Math.hypot(p1.x - p0.x, p1.z - p0.z) > 1, `left stick walks (${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(2)} m in 1.5 s)`);
// keep pushing: you must end up against a wall, never inside one
await tab.evaluate(() => window.__uc.advance(6));
const inRock = await tab.evaluate(() => window.__uc.tileAt(window.__uc.player.x, window.__uc.player.z) === 0);
check(!inRock, 'walls stop you');
await shot('03-against-a-wall');
// turn with the right stick
const y0 = await tab.evaluate(() => window.__uc.player.yaw);
await pad([0, 0, 1, 0], none);
await tab.evaluate(() => window.__uc.advance(0.5));
check(await tab.evaluate(() => window.__uc.player.yaw) < y0 - 0.3, 'right stick turns');
await pad([0, 0, 0, 0], none);

// drive the shortest route with the sticks: turn toward the next waypoint, walk when facing it
const route = await tab.evaluate(() => window.__uc.path());
check(route && route.length > 5, `the stairs can be reached (${route ? route.length : 0} tiles away)`);
const [sx, sz] = route[0];
await tab.evaluate(([x, z]) => window.__uc.place(x, z), [sx, sz]);
let wp = 1, secs = 0, shotsTaken = 0;
while (secs < 400 && wp < route.length){
  const st = await tab.evaluate(() => { const p = window.__uc.player; return { x: p.x, z: p.z, yaw: p.yaw, state: window.__uc.state }; });
  if (st.state === 'won') break;
  const [tx, tz] = route[wp];
  const dx = tx - st.x, dz = tz - st.z;
  if (Math.hypot(dx, dz) < 0.5){ wp++; continue; }
  const want = Math.atan2(-dx, -dz);
  let diff = want - st.yaw; while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
  const turn = Math.max(-1, Math.min(1, -diff * 2.5));
  const fwd = Math.abs(diff) < 0.5 ? -1 : 0;
  const b = none.slice(); b[7] = 1;   // hold RT to hurry
  await pad([0, fwd, turn, 0], b);
  await tab.evaluate(() => window.__uc.advance(0.1, false));
  secs += 0.1;
}
await pad([0, 0, 0, 0], none);
const finalState = await tab.evaluate(() => window.__uc.state);
check(finalState === 'won', `walking the route with the sticks reaches the way out (${secs.toFixed(1)} s, state ${finalState})`);
await shot('04-won');

// framed views for a look at the lighting: the stairs, the nearest wall torch, a long corridor
const views = await tab.evaluate(() => {
  const uc = window.__uc, m = uc.maze, T = uc.TILE, out = [];
  const [ex, ez] = m.exitRoom, [dx, dz] = m.exitDir;
  out.push({ name: '05-the-way-out', x: (ex + 0.5 - dx * 0.9) * T, z: (ez + 0.5 - dz * 0.9) * T, yaw: Math.atan2(-dx, -dz), pitch: 0.12 });
  return out;
});
await tab.evaluate(() => { window.__uc.start(); });
for (const v of views){ await tab.evaluate((v) => window.__uc.place(v.x, v.z, v.yaw, v.pitch), v); await tab.evaluate(() => window.__uc.advance(0.3)); await shot(v.name); }
// views along the route, every few tiles
for (let k = 2; k < route.length - 2; k += Math.max(3, Math.floor(route.length / 6))){
  const [x, z] = route[k], [nx, nz] = route[k + 1];
  await tab.evaluate(([x, z, yaw]) => { window.__uc.place(x, z, yaw, 0); window.__uc.advance(0.3); }, [x, z, Math.atan2(-(nx - x), -(nz - z))]);
  await shot('06-route-' + String(k).padStart(2, '0'));
}
// with the torch out, the corridors must still be visible: dim, but not black
const brightness = () => tab.evaluate(() => {
  const src = document.querySelector('canvas'), c = document.createElement('canvas');
  c.width = 160; c.height = 90; const g = c.getContext('2d'); g.drawImage(src, 0, 0, 160, 90);
  const d = g.getImageData(0, 0, 160, 90).data; let sum = 0;
  for (let k = 0; k < d.length; k += 4) sum += 0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2];
  return sum / (d.length / 4);
});
const dark = [];
await tab.evaluate(() => window.__uc.torch(false));
for (const k of [2, Math.floor(route.length / 2)]){
  const [x, z] = route[k], [nx, nz] = route[k + 1];
  await tab.evaluate(([x, z, yaw]) => { window.__uc.place(x, z, yaw, 0); window.__uc.advance(0.3); }, [x, z, Math.atan2(-(nx - x), -(nz - z))]);
  dark.push(await brightness());
  await shot('07-no-torch-' + String(k).padStart(2, '0'));
}
await tab.evaluate(() => { window.__uc.torch(true); window.__uc.advance(0.1); });
const lit = await brightness();
check(Math.min(...dark) > 12, `without the torch you can still see (mean brightness ${dark.map((v) => v.toFixed(1)).join(', ')} of 255; torch lit ${lit.toFixed(1)})`);
check(lit > Math.max(...dark) * 1.2, 'the torch still makes a clear difference');

const info = await tab.evaluate(() => window.__uc.info());
console.log('  render', JSON.stringify(info));
check(errors.length === 0, 'no errors in the console' + (errors.length ? ':\n    ' + errors.slice(0, 5).join('\n    ') : ''));

await browser.close();
server.close();
console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
