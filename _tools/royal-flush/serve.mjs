// Serves the repo the way Jekyll would publish it (front matter off, version filled in, raw tags gone).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.html': 'text/html' };
export function version(name){ return (fs.readFileSync(path.join(ROOT, '_experiments', name + '.html'), 'utf8').match(/version:\s*"?([^"\n]+)"?/) || [])[1]; }
function page(name){
  const src = fs.readFileSync(path.join(ROOT, '_experiments', name + '.html'), 'utf8');
  const fm = src.match(/^---\n([\s\S]*?)\n---\n/);
  return src.slice(fm[0].length).replace(/\{% endraw %\}\{\{ page\.version \}\}\{% raw %\}/g, version(name)).replace(/\{% (end)?raw %\}/g, '');
}
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
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}
