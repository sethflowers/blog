// Screenshots of the Undercroft model previewer (or any page in the repo), in headless Chromium.
//
//   NODE_PATH=$(npm root -g) node _tools/undercroft/shoot.mjs <preview-module> <out-prefix> [views-json]
//
// <preview-module> is a path like /_tools/undercroft/previews/beast.js. Its default export builds the
// scene (see preview.html). If it also exports `views` (an array of { name, ...anything }), each view is
// passed to its exported `show(ctx, view)` before a screenshot is taken, giving <out-prefix>-<name>.png.
// Without views, one shot is written to <out-prefix>.png. Console errors are printed and fail the run.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [modPath, outPrefix] = process.argv.slice(2);
const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.html': 'text/html', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, url);
  try { if (!file.startsWith(ROOT)) throw 0; const b = fs.readFileSync(file); res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 750 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); else console.log('  page:', m.text()); });
await page.goto(`http://127.0.0.1:${server.address().port}/_tools/undercroft/preview.html?m=${encodeURIComponent(modPath)}`);
try { await page.waitForFunction(() => window.ready, null, { timeout: 180000 }); }
catch (e) { console.log('never became ready', errors); process.exit(1); }
const views = await page.evaluate(async (m) => { const mod = await import(m); return mod.views || null; }, modPath);
fs.mkdirSync(path.dirname(path.resolve(outPrefix)), { recursive: true });
if (!views){ await page.screenshot({ path: outPrefix + '.png' }); console.log('wrote ' + outPrefix + '.png'); }
else for (const v of views){
  await page.evaluate(async ([m, v]) => { const mod = await import(m); await mod.show(window.ctx, v); window.ctx.render(); }, [modPath, v]);
  await page.screenshot({ path: `${outPrefix}-${v.name}.png` });
  console.log(`wrote ${outPrefix}-${v.name}.png`);
}
await browser.close(); server.close();
if (errors.length){ console.log('ERRORS:\n  ' + errors.join('\n  ')); process.exit(1); }
