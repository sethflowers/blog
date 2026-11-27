// Tests Character Creator in headless Chromium and saves screenshots. Quick (about a minute).
//
//   npm i --prefix _tools/vr-test iwer        (once; the VR part uses Meta's emulated Quest 3)
//   NODE_PATH=$(npm root -g) node _tools/character-creator/test.mjs [outDir] [--full]
//
// Serves the repo the way Jekyll would publish it (front matter stripped, version filled in). Checks:
// the loading screen; the title and version; the designer opens with a person on the turntable; the
// sliders really reshape them (age, weight, the nose...); each tab's controls; hair, clothes and shoes
// change; the four drawing styles and the cartoon dial; undo and redo; saving, naming, the gallery,
// opening and deleting; character codes and seed numbers make exactly the same person again; an old
// save is upgraded; memory stays flat over random people; no console errors; and in VR: the board
// appears beside the person once the headset is posed, the trigger picks a tab and drags a slider,
// B hides the board. --full adds a contact sheet of every preset and more random people.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(HERE, '../..');
const OUT = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'character-creator-shots');
const FULL = process.argv.includes('--full');
fs.mkdirSync(OUT, { recursive: true });
let IWER = null;
try { IWER = fs.readFileSync(require.resolve('iwer/build/iwer.min.js', { paths: [HERE, path.join(HERE, '../vr-test'), ...(process.env.NODE_PATH || '').split(':')] }), 'utf8'); }
catch (e) { console.log('(IWER not installed: skipping the VR part. npm i --prefix _tools/vr-test iwer)'); }

const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.html': 'text/html', '.webp': 'image/webp', '.bin': 'application/octet-stream' };
function page(name){
  const src = fs.readFileSync(path.join(ROOT, '_experiments', name + '.html'), 'utf8');
  const fm = src.match(/^---\n([\s\S]*?)\n---\n/);
  const version = (fm[1].match(/version:\s*"?([^"\n]+)"?/) || [])[1];
  return src.slice(fm[0].length).replace(/\{% endraw %\}\{\{ page\.version \}\}\{% raw %\}/g, version).replace(/\{% (end)?raw %\}/g, '');
}
const VERSION = (fs.readFileSync(path.join(ROOT, '_experiments/character-creator.html'), 'utf8').match(/version:\s*"?([^"\n]+)"?/) || [])[1];
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
const BASE = `http://127.0.0.1:${server.address().port}/experiments/character-creator/`;

let failures = 0;
const T0 = Date.now();
const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what + (process.env.TIMING ? `  [${Math.round((Date.now() - T0) / 1000)} s]` : '')); if (!ok) failures++; return ok; };
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
if (IWER) await ctx.addInitScript({ content: IWER + `
;window.__iwer = new IWER.XRDevice(IWER.metaQuest3, { stereoEnabled: false });
window.__iwer.installRuntime({ forceInstall: true });
` });
const pg = await ctx.newPage();
const errors = [];
pg.on('pageerror', (e) => errors.push(e.message + ' ' + (e.stack || '').split('\n').slice(1, 4).join(' ')));
pg.on('console', (m) => { if (m.type() === 'error' && !/GL Driver|GPU stall/.test(m.text())) errors.push(m.text()); });
const ev = (s, a) => pg.evaluate(s, a);
const wait = (ms) => pg.waitForTimeout(ms);
const shot = async (name) => { await ev('__cc.renderNow()'); await pg.screenshot({ path: path.join(OUT, name + '.png'), timeout: 120000 }); };
const settle = () => ev('__cc.settle()');

console.log('Character Creator ' + VERSION);
await pg.goto(BASE);
await pg.waitForFunction('window.__cc', null, { timeout: 180000 }).catch((e) => { console.log('the designer did not start:', errors.join(' | ')); throw e; });
await ev('__cc.noThumbs = true');
await ev('localStorage.clear()');
await wait(300);
check((await pg.textContent('.build-version')).includes(VERSION), 'title shows version ' + VERSION);
check(await ev(`getComputedStyle(document.getElementById('loading')).display === 'none' || document.getElementById('loading').classList.contains('done')`), 'the loading screen has gone');
if (!process.env.SKIP_LOADING){ const { checkLoading } = await import('../loading-check.mjs'); await checkLoading({ browser, url: BASE, check, main: pg, game: '__cc', shot: path.join(OUT, '00-loading.png') }); }
await shot('01-title');

// ---------- the designer ----------
await ev('__cc.startScreen()');
await wait(300);
check(await ev('__cc.mode') === 'screen', 'Open the designer shows the designer');
check(await ev(`document.querySelectorAll('#tabs button').length`) >= 12, 'a tab for each part of the person');
const H0 = await ev('__cc.character.height()');
check(H0 > 1.5 && H0 < 1.95, `an adult-sized person on the turntable (${(H0 * 100).toFixed(0)} cm)`);
check(await ev('__cc.character.human.body.geometry.index.count') > 30000, 'the body is a detailed mesh');
await shot('02-designer');

// sliders reshape the person
const P = (expr) => ev(`(() => { const p = __cc.character.human.pos; return ${expr}; })()`);
const tip = 'p[__tipI * 3 + 2]';
await ev(`window.__tipI = (() => { const p = __cc.character.human.pos, rv = __cc.data.base.bodyRV; let b = rv[0]; for (const i of rv) if (p[i * 3 + 1] > 0.6 && p[i * 3 + 2] > p[b * 3 + 2]) b = i; return b; })()`);
const z0 = await P(tip);
await ev(`__cc.setValue('mods.nose-trans-backward|forward', 1)`); await settle();
const z1 = await P(tip);
check(z1 > z0 + 0.002, `the nose slider moves the nose forward (${((z1 - z0) * 1000).toFixed(1)} mm)`);
await ev(`__cc.undo()`); await settle();
check(Math.abs((await P(tip)) - z0) < 1e-4, 'undo puts it back');
await ev(`__cc.redo()`); await settle();
check(Math.abs((await P(tip)) - z1) < 1e-4, 'redo does it again');
await ev(`__cc.setValue('macro.height', 1)`); await settle();
const H1 = await ev('__cc.character.height()');
check(H1 > H0 + 0.08, `height makes them taller (${(H0 * 100).toFixed(0)} → ${(H1 * 100).toFixed(0)} cm)`);
await ev(`__cc.setValue('macro.age', 80)`); await settle();
check(await ev(`__cc.character.looks.mats.get('skin').map.image.src.includes('old_')`), 'an 80-year-old gets an older skin');
await ev(`__cc.setValue('macro.age', 25)`); await ev(`__cc.setValue('macro.height', 0.5)`); await settle();

// every tab draws its controls
let bad = [];
for (const c of await ev('[...document.querySelectorAll("#tabs button")].map((b) => b.dataset.cat)')){
  await ev(`__cc.showCat('${c}')`);
  const n = await ev(`document.querySelectorAll('#side-body .ctl, #side-body .grp').length`);
  if (!n) bad.push(c);
}
check(!bad.length, 'every tab has controls' + (bad.length ? ': empty ' + bad.join(', ') : ''));
await ev(`__cc.showCat('face')`); await wait(200);
await shot('03-face-tab');

// parts and clothes
await ev(`__cc.setValue('hair.style', 'long01')`); await ev(`__cc.setValue('outfit.outfit', 'female_casualsuit01')`); await ev(`__cc.setValue('outfit.shoes', 'none')`); await settle();
const worn = await ev('[...__cc.character.human.worn]');
check(worn.includes('long01') && worn.includes('female_casualsuit01') && !worn.some((w) => w.startsWith('shoes')), 'hair, outfit and bare feet change what is worn');
const vis = await ev(`[...__cc.character.human.parts.values()].filter((p) => p.mesh.visible).map((p) => p.def.id)`);
check(!vis.includes('short02') && !vis.includes('shoes04'), 'what was taken off is hidden');

// the four styles and the cartoon dial
for (const r of ['soft', 'toon', 'clay', 'real']){
  await ev(`__cc.setValue('style.render', '${r}')`); await settle();
  const t = await ev(`__cc.character.human.body.material.type`);
  check({ real: /Physical/, soft: /Physical/, toon: /Toon/, clay: /Standard/ }[r].test(t), `drawn ${r}: ${t}`);
  if (r !== 'real'){ await ev(`__cc.frameFor('body')`); await shot('04-style-' + r); }
}
await ev(`__cc.setValue('style.cartoon', 1)`); await settle();
check(await ev(`__cc.character.human.headScale`) > 1.3, 'the cartoon dial makes the head bigger');
await ev(`__cc.setValue('style.cartoon', 0)`); await settle();

// codes and seed numbers make exactly the same person
const same = await ev(`(() => {
  const C = __cc; const s = C.fromSeed(4242); s.nose = s.nose; s.mods['nose-hump-decr|incr'] = 0.5; s.hair.color = '#123456'; s.name = 'Zoë';
  const code = C.toCode(s), back = C.fromCode(code), seed = C.fromCode('4242'), seed2 = C.fromSeed(4242);
  return { code, ok: JSON.stringify(back) === JSON.stringify(s), seedOk: JSON.stringify(seed) === JSON.stringify(seed2), len: code.length };
})()`);
check(same.ok, `a character code gives exactly the same person (${same.code})`);
check(same.seedOk, 'a seed number gives the same person every time');
check(same.len < 40, `a tweaked random person has a short code (${same.len} characters)`);
const presetsOk = await ev(`__cc.PRESETS().every((p) => JSON.stringify(__cc.fromCode(__cc.toCode(p))) === JSON.stringify(p))`);
check(presetsOk, 'every preset survives its code');

// saving, the gallery, opening, deleting
await ev(`__cc.openCode('CC2-')`); await settle();
await ev(`__cc.spec.name = 'Test Person'; __cc.saveCurrent()`); await settle();
check(await ev(`__cc.save.characters.length === 1 && __cc.save.characters[0].name === 'Test Person' && __cc.save.characters[0].thumb.startsWith('data:image/jpeg')`), 'Save keeps the person with a name and a portrait');
check(await ev(`JSON.parse(localStorage.getItem('character-creator-v1')).characters.length === 1`), 'saved in this browser');
await ev(`__cc.showCat('saved')`); await wait(200);
check(await ev(`document.querySelectorAll('#side-body .pc').length === 1`), 'the gallery shows them');
await shot('05-saved');
await ev(`__cc.randomPerson()`); await settle();
await ev(`__cc.openSaved(__cc.save.characters[0])`); await settle();
check(await ev(`__cc.spec.name === 'Test Person'`), 'opening them brings them back');
// an old save (version 1, with missing and unknown fields) is upgraded, not lost
const up = await ev(`(() => { const s = { v: 1, name: 'Old', macro: { gender: 1 }, nonsense: 5, hair: { style: 'gone-style' } }; localStorage.setItem('cc-old', JSON.stringify(s));
  const u = __cc.fromCode(__cc.toCode(Object.assign({}, __cc.spec, s))); return { name: u.name, ok: u.v === 2 && u.hair.style !== 'gone-style' }; })()`);
check(up.ok, 'an old or broken save is upgraded with sensible values');

// memory stays flat over many random people
await ev('__cc.noRender = true');
const mem0 = await ev('({ g: __cc.studio.renderer.info.memory.geometries, t: __cc.studio.renderer.info.memory.textures })');
for (let i = 0; i < (FULL ? 30 : 10); i++){ await ev('__cc.randomPerson()'); await settle(); await ev('__cc.renderNow()'); }
const mem1 = await ev('({ g: __cc.studio.renderer.info.memory.geometries, t: __cc.studio.renderer.info.memory.textures })');
await ev('__cc.randomPerson()'); await settle(); await ev('__cc.renderNow()');
for (let i = 0; i < 5; i++){ await ev('__cc.randomPerson()'); await settle(); await ev('__cc.renderNow()'); }
const mem2 = await ev('({ g: __cc.studio.renderer.info.memory.geometries, t: __cc.studio.renderer.info.memory.textures })');
check(mem2.g <= mem1.g + 2 && mem2.g < 200, `geometries stay flat over random people (${mem0.g} → ${mem1.g} → ${mem2.g})`);
check(mem2.t < 140, `textures stay bounded (${mem0.t} → ${mem1.t} → ${mem2.t})`);
const calls = await ev('(__cc.renderNow(), __cc.studio.renderer.info.render.calls)');
check(calls < 120, `draw calls (${calls})`);
await ev('__cc.noRender = false');

// a few people up close
await ev(`__cc.replaceSpec(__cc.PRESETS()[2])`); await settle(); await ev(`__cc.frameFor('face'); __cc.studio.frame('face', __cc.character, true)`);
await shot('06-face-front');
await ev(`__cc.studio.turntable.rotation.y = 0.7`); await shot('07-face-side');
await ev(`__cc.studio.turntable.rotation.y = 0; __cc.replaceSpec(__cc.PRESETS()[1])`); await settle(); await ev(`__cc.studio.frame('face', __cc.character, true)`);
await shot('08-face-ava');
await ev(`__cc.studio.frame('body', __cc.character, true)`); await shot('09-body-ava');
if (FULL){
  for (const [i, p] of (await ev('__cc.PRESETS().map((p) => p.name)')).entries()){
    await ev(`__cc.replaceSpec(__cc.PRESETS()[${i}])`); await settle(); await ev(`__cc.studio.frame('head', __cc.character, true)`);
    await shot(`20-preset-${String(i).padStart(2, '0')}-${p.replace(/\W+/g, '')}`);
  }
}

// ---------- VR ----------
if (IWER){
  await ev('__cc.toTitle()');
  await ev(`document.getElementById('b-vr').click()`);
  await pg.waitForFunction('__cc.mode === "vr"', null, { timeout: 30000 }).catch(() => {});
  check(await ev('__cc.mode') === 'vr', 'Design in VR starts a VR session');
  await pg.waitForFunction('__cc.vr.posed', null, { timeout: 60000 }).catch(() => {});
  check(await ev('__cc.vr.posed && __cc.board.mesh.visible'), 'the board appears once the headset has a pose');
  const bp = await ev(`(() => { const b = __cc.board.mesh.position, h = __cc.vr.head; return { d: Math.hypot(b.x - h.x, b.z - h.z), dy: b.y - h.y }; })()`);
  check(bp.d > 0.5 && bp.d < 1.4 && Math.abs(bp.dy) < 0.4, `the board is in front of you at a comfortable height (${bp.d.toFixed(2)} m)`);
  // point the right controller at the 'Body' tab and pull the trigger
  const aim = async (u, v) => ev(`(() => {
    const B = __cc.board, m = B.mesh; m.updateMatrixWorld(true);
    const p = new m.position.constructor((${u} - 0.5) * 0.72, (0.5 - ${v}) * 0.9, 0).applyMatrix4(m.matrixWorld);
    const dev = window.__iwer, c = dev.controllers.right;
    const from = p.clone().add(new m.position.constructor(0, 0, 0.45).applyQuaternion(m.quaternion));
    // where the controller sits in the play space (the rig may have moved)
    const rig = __cc.studio.rig; rig.updateMatrixWorld(true);
    const inv = rig.matrixWorld.clone().invert();
    const lf = from.clone().applyMatrix4(inv), lp = p.clone().applyMatrix4(inv);
    c.position.set(lf.x, lf.y, lf.z);
    const dir = lp.clone().sub(lf).normalize();
    const q = new (__cc.studio.camera.quaternion.constructor)().setFromUnitVectors(new m.position.constructor(0, 0, -1), dir);
    c.quaternion.set(q.x, q.y, q.z, q.w);
  })()`);
  const tabV = (i) => (18 + 88 * i + 41) / 1280;
  await aim(76 / 1024, tabV(2));
  await wait(400);
  await ev(`window.__iwer.controllers.right.updateButtonValue('trigger', 1)`); await wait(400);
  await ev(`window.__iwer.controllers.right.updateButtonValue('trigger', 0)`); await wait(300);
  check(await ev('__cc.cat') === 'body', `the trigger picks a tab on the board (${await ev('__cc.cat')})`);
  // drag the first slider (Female ↔ Male) from the left end to the right
  const hitY = await ev(`(() => { const h = __cc.board.hits.find((h) => h.target.slider); return h ? (h.y + h.h / 2) / 1280 : 0; })()`);
  const g0 = await ev('__cc.spec.macro.gender');
  await aim((150 + 6 + 30) / 1024, hitY); await wait(300);
  await ev(`window.__iwer.controllers.right.updateButtonValue('trigger', 1)`); await wait(300);
  const g0b = await ev('__cc.spec.macro.gender');
  await aim((1024 - 60) / 1024, hitY); await wait(400);
  await ev(`window.__iwer.controllers.right.updateButtonValue('trigger', 0)`); await wait(400);
  const g1 = await ev('__cc.spec.macro.gender');
  check(g1 > g0b + 0.4, `holding the trigger drags a slider (gender ${g0b.toFixed(2)} → ${g1.toFixed(2)})`);
  await ev('__cc.settle()');
  await pg.screenshot({ path: path.join(OUT, '10-vr.png') });
  await ev(`window.__iwer.controllers.right.updateButtonValue('b-button', 1)`); await wait(300);
  await ev(`window.__iwer.controllers.right.updateButtonValue('b-button', 0)`); await wait(300);
  check(await ev('!__cc.board.mesh.visible'), 'B hides the board');
  await ev('__cc.vr.end()'); await wait(500);
  check(await ev('__cc.mode') === 'title', 'leaving VR goes back to the title');
}

check(errors.length === 0, 'no errors in the console' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
console.log(`${failures ? failures + ' FAILED' : 'all passed'} in ${Math.round((Date.now() - T0) / 1000)} s; screenshots in ${OUT}`);
await browser.close(); server.close();
process.exit(failures ? 1 : 0);
