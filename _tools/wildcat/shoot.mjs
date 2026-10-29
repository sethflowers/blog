// Renders _tools/wildcat/preview.html for each animal and pose and saves PNGs.
//   NODE_PATH=$(npm root -g) node _tools/wildcat/shoot.mjs outDir cat:stand bear:rear ...
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.resolve(process.argv[2] || 'wildcat-preview'); fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.js': 'text/javascript', '.html': 'text/html' };
const server = http.createServer((req, res) => { try { const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0])); res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f)); } catch (e) { res.writeHead(404); res.end(); } });
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const tab = await browser.newPage({ viewport: { width: 1200, height: 800 } });
tab.on('console', (m) => console.log('  [page]', m.text())); tab.on('pageerror', (e) => console.log('  [error]', e.message));
for (const item of process.argv.slice(3)){
  const [a, p, extra] = item.split(':');
  await tab.goto(`http://127.0.0.1:${server.address().port}/_tools/wildcat/preview.html?a=${a}&pose=${p || 'stand'}${extra ? '&' + extra : ''}`);
  await tab.waitForFunction(() => document.title.startsWith('done'), null, { timeout: 120000 });
  console.log(item, await tab.title());
  await tab.screenshot({ path: path.join(OUT, `${a}-${p || 'stand'}${extra ? '-' + extra : ''}.png`), clip: extra === 'icon' ? { x: 0, y: 0, width: 512, height: 512 } : undefined });
}
await browser.close(); server.close();
