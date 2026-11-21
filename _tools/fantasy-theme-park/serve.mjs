// Serves the repo the way Jekyll would publish it (front matter stripped, version filled in).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.html': 'text/html' };
export function page(name){
  const src = fs.readFileSync(path.join(ROOT, '_experiments', name + '.html'), 'utf8');
  const fm = src.match(/^---\n([\s\S]*?)\n---\n/);
  const version = (fm[1].match(/version:\s*"?([^"\n]+)"?/) || [])[1];
  return src.slice(fm[0].length).replace(/\{% endraw %\}\{\{ page\.version \}\}\{% raw %\}/g, version).replace(/\{% (end)?raw %\}/g, '');
}
export function version(name){ return (fs.readFileSync(path.join(ROOT, '_experiments', name + '.html'), 'utf8').match(/version:\s*"?([^"\n]+)"?/) || [])[1]; }
export async function serve(){
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
  return { server, base: (name) => `http://127.0.0.1:${server.address().port}/experiments/${name}/` };
}
