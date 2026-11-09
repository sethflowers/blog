// Does a game work offline? Opens each game online for a few seconds (ONLINE_MS, default 8000) and
// closes it, then cuts the network and opens it again, the way an iPad does when you start it from
// the home screen with no connection. Reports anything that failed to load and whether the page ran.
//   NODE_PATH=$(npm root -g) node _tools/offline-check.mjs my-animal-farm [other-game ...]
// With no names it checks every game that has a service worker. Takes a few seconds per game.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.glb': 'model/gltf-binary' };
// the page as Jekyll would publish it: front matter off, the version filled in, raw tags gone
function page(name){
  const src = fs.readFileSync(path.join(ROOT, '_experiments', name + '.html'), 'utf8');
  const fm = src.match(/^---\n([\s\S]*?)\n---\n/);
  const version = fm ? (fm[1].match(/version:\s*"?([^"\n]+)"?/) || [])[1] : '';
  return (fm ? src.slice(fm[0].length) : src).replace(/\{% endraw %\}\{\{ page\.version \}\}\{% raw %\}/g, version).replace(/\{% (end)?raw %\}/g, '');
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
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const ONLINE_MS = +(process.env.ONLINE_MS || 8000);   // how long the game is open online before it's closed

let names = process.argv.slice(2);
if (!names.length) names = fs.readdirSync(path.join(ROOT, 'experiments')).filter((n) => fs.existsSync(path.join(ROOT, 'experiments', n, 'sw.js')) && fs.existsSync(path.join(ROOT, '_experiments', n + '.html')));

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let bad = 0;
for (const name of names){
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 700 } });
  const pg = await ctx.newPage();
  await pg.goto(`${ORIGIN}/`).catch(() => {});
  const failed = [], errors = [];
  pg.on('requestfailed', (r) => failed.push(r.url().replace(ORIGIN, '')));
  pg.on('response', (r) => { if (r.status() >= 400) failed.push(r.url().replace(ORIGIN, '') + ' ' + r.status()); });
  pg.on('pageerror', (e) => errors.push(e.message));
  pg.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const url = `${ORIGIN}/experiments/${name}/`;
  // online, briefly: open it and close it again after a few seconds, before a big game has finished
  // building its world (people do that, and a slow iPad takes a while); the offline copy must already
  // be saved by then
  const online = await ctx.newPage();
  online.on('requestfailed', (r) => failed.push('online: ' + r.url().replace(ORIGIN, '')));
  await online.goto(url, { waitUntil: 'commit', timeout: 60000 });
  await online.waitForTimeout(ONLINE_MS);
  await online.close();
  const sw = await pg.evaluate(async (u) => {
    if (!('serviceWorker' in navigator)) return 'not supported';
    const r = await navigator.serviceWorker.getRegistration(u);
    return r && r.active ? 'ready' : r ? 'still installing' : 'not registered';
  }, url).catch((e) => 'unknown: ' + e.message);
  const onlineFailed = [...failed]; failed.length = 0; errors.length = 0;
  // offline: open it again, as from the home screen with no connection
  await ctx.setOffline(true);
  let loaded = true;
  try { await pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 }); } catch (e) { loaded = false; errors.push('page did not load: ' + e.message.split('\n')[0]); }
  // let every script and module arrive (from the saved copy) and run
  await pg.waitForTimeout(8000);
  const offlineNote = loaded ? await pg.evaluate(() => (document.getElementById('offline') || {}).textContent || '').catch(() => '') : '';
  const title = loaded ? await pg.title().catch(() => '') : '';
  const ok = loaded && sw === 'ready' && !failed.length && !errors.length;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: after ${ONLINE_MS / 1000}s online the offline copy was ${sw}; offline ${loaded ? `loaded "${title}"` : 'did NOT load'}${offlineNote ? ` (title says "${offlineNote}")` : ''}`);
  for (const f of onlineFailed) console.log(`       online failed: ${f}`);
  for (const f of failed) console.log(`       offline failed: ${f}`);
  for (const e of errors.slice(0, 5)) console.log(`       error: ${e}`);
  await ctx.close();
}
await browser.close(); server.close();
console.log(bad ? `\n${bad} game(s) don't work offline` : '\nall work offline');
process.exit(bad ? 1 : 0);
