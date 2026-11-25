// Plays Sherlock in headless Chromium, checks it, and saves screenshots.
//
//   npm i --prefix _tools/vr-test iwer        (once; the VR part uses Meta's emulated Quest 3)
//   NODE_PATH=$(npm root -g) node _tools/sherlock/test.mjs [outDir] [--full]
//
// Quick by default (about a minute): the mystery generator (thousands of cases: always exactly one
// answer, hard enough for its level), the loading screen, the title and version, a new Easy case (the
// story, the blackout, walking to the body), examining the clues, questioning people, the notebook and
// its comparisons, a wrong accusation on Easy (a warning), the right one (solved), a wrong one on
// Medium (lost), saving and loading, your own photo people, memory over several cases, no console
// errors, then VR: the notebook in your hand, pointing at a button and at the body.
// --full also plays a Hard case and checks the scenery for overlapping surfaces.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(HERE, '../..');
const args = process.argv.slice(2);
const FULL = args.includes('--full');
const OUT = path.resolve(args.find((a) => !a.startsWith('--')) || 'sherlock-shots');
fs.mkdirSync(OUT, { recursive: true });
let IWER = null;
try { IWER = fs.readFileSync(require.resolve('iwer/build/iwer.min.js', { paths: [HERE, path.join(HERE, '../vr-test'), ...(process.env.NODE_PATH || '').split(':')] }), 'utf8'); }
catch (e) { console.log('(IWER not installed: skipping the VR part. npm i --prefix _tools/vr-test iwer)'); }

let failures = 0;
const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) failures++; return ok; };
const t0 = Date.now();

// ---------- 1. the mystery generator, on its own ----------
{
  const M = await import(pathToFileURL(path.join(ROOT, 'experiments/sherlock/js/mystery.js')).href);
  console.log('The mystery generator');
  for (const d of ['easy', 'medium', 'hard']){
    let bad = 0, maxAtt = 0, n = 1500;
    for (let s = 1; s <= n; s++){
      const m = M.makeMystery({ seed: s * 7 + 3, difficulty: d });
      maxAtt = Math.max(maxAtt, m.attempts);
      const P = m.people, cand = m.candidates.map((i) => P[i]), mur = P[m.murderer];
      const ok = M.solves(m.kinds, m.clues, cand, mur, M.DIFFICULTY[d].minClues)
        && m.victim !== m.murderer && new Set(P.map((p) => p.prof)).size === 7 && new Set(P.map((p) => p.avatar)).size === 7
        && P.filter((p) => p.i !== m.victim).every((p) => p.says && p.says.where && p.place)
        // people who were together really were somewhere else than the murderer, and vouch for each other
        && m.pairs.every(([a, b]) => P[a].place === P[b].place && P[a].with === b && P[b].with === a)
        && (!m.kinds.includes('direction') || m.dirWitness != null) && (!m.kinds.includes('height') || m.heightWitness != null);
      if (!ok) bad++;
    }
    check(!bad, `${d}: ${n} mysteries, each solvable by exactly one person and hard enough (worst ${maxAtt} tries)${bad ? ` (${bad} bad)` : ''}`);
  }
  // your own people: they come along, keep their job, and "never the victim" holds
  const cast = [0, 1, 2, 3, 4].map((k) => ({ id: 'c' + k, name: 'Person ' + k, female: k % 2 === 0, avatar: k % 2 ? 9 + k : k, prof: k === 0 ? 'baker' : null, hair: 'brown', height: k === 1 ? 'tall' : null, neverVictim: true }));
  let castOk = true;
  for (let s = 1; s <= 300; s++){
    const m = M.makeMystery({ seed: s, difficulty: ['easy', 'medium', 'hard'][s % 3], cast });
    const mine = m.people.filter((p) => p.cast);
    if (mine.length !== 5 || m.people[m.victim].cast || mine.find((p) => p.cast === 'c0').prof !== 'baker' || mine.find((p) => p.cast === 'c1').heightBand !== 'tall') castOk = false;
  }
  check(castOk, 'your own people are on the train, keep their job and height, and are never the victim');
  const seven = [0, 1, 2, 3, 4, 5, 6].map((k) => ({ id: 'c' + k, name: 'P' + k, female: true, avatar: k, hair: 'brown', neverVictim: true }));
  const m7 = M.makeMystery({ seed: 5, difficulty: 'medium', cast: seven });
  check(!m7.people[m7.victim].cast, 'with seven "never the victim" people, the victim is someone made up');
}

// ---------- 2. the game in a browser ----------
const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.html': 'text/html', '.glb': 'model/gltf-binary' };
function page(name){
  const src = fs.readFileSync(path.join(ROOT, '_experiments', name + '.html'), 'utf8');
  const fm = src.match(/^---\n([\s\S]*?)\n---\n/);
  const version = (fm[1].match(/version:\s*"?([^"\n]+)"?/) || [])[1];
  return src.slice(fm[0].length).replace(/\{% endraw %\}\{\{ page\.version \}\}\{% raw %\}/g, version).replace(/\{% (end)?raw %\}/g, '');
}
const VERSION = (fs.readFileSync(path.join(ROOT, '_experiments/sherlock.html'), 'utf8').match(/version:\s*"?([^"\n]+)"?/) || [])[1];
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
const BASE = `http://127.0.0.1:${server.address().port}/experiments/sherlock/`;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

console.log('Sherlock ' + VERSION);
if (!process.env.NO_LOADING){
  const { checkLoading } = await import(pathToFileURL(path.join(ROOT, '_tools/loading-check.mjs')).href);
  await checkLoading({ browser, url: BASE, check, game: '__sherlock', shot: path.join(OUT, '00-loading.png') });
}
const ctx = await browser.newContext({ viewport: { width: 1024, height: 700 } });
if (IWER) await ctx.addInitScript({ content: IWER + `
;window.__iwer = new IWER.XRDevice(IWER.metaQuest3, { stereoEnabled: false });
window.__iwer.installRuntime({ forceInstall: true });
` });
const pg = await ctx.newPage();
const errors = [];
pg.on('pageerror', (e) => errors.push(e.message + ' ' + (e.stack || '').split('\n').slice(1, 4).join(' ')));
pg.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const ev = (s, a) => pg.evaluate(s, a);
const wait = (ms) => pg.waitForTimeout(ms);
const shot = async (name) => { await ev('__sherlock.renderNow()'); await pg.screenshot({ path: path.join(OUT, name + '.png'), timeout: 120000 }); };
const until = async (expr, sec, what) => check(await ev(`__sherlock.advance(${sec}, () => (${expr}))`), what + ((await ev(expr)) ? '' : ' (timed out)'));

await pg.goto(BASE);
await pg.waitForFunction(() => window.__sherlock, null, { timeout: 120000 });
await ev('__sherlock.noRender = true');
check(await ev(`document.querySelector('#title .build-version').textContent === 'v${VERSION}'`), `the title screen shows the version (v${VERSION})`);
await shot('01-title');
// no two scenery surfaces in the same place (they flicker, badly in a headset)
{
  const { findCoplanar } = await import(pathToFileURL(path.join(ROOT, '_tools/coplanar.mjs')).href);
  const boxes = (await ev('__sherlock.train.boxLog')).map((b) => ({ batch: 0, p: b.min.map((v, k) => (v + b.max[k]) / 2), s: b.min.map((v, k) => b.max[k] - v), r: [0, 0, 0], m: b.m, tag: b.tag }));
  const flicker = findCoplanar(boxes);
  check(flicker.length === 0, `no flickering (coplanar) scenery faces (${boxes.length} boxes)${flicker.length ? ': ' + flicker.slice(0, 6).map((h) => JSON.stringify(h).slice(0, 200)).join(' || ') : ''}`);
}

// ---------- a new Easy case ----------
await ev('localStorage.clear()');
await pg.click('#b-play');
await pg.waitForSelector('#panel.show', { timeout: 20000 });
check(await ev(`/new mystery/i.test(document.querySelector('#panel h2').textContent)`), 'Play with no saved case asks for a new mystery');
await shot('02-new-case');
await ev(`__sherlock.closePanels(); __sherlock.game.newCase({ difficulty: 'easy', seed: 4242 })`);
await pg.waitForFunction(() => __sherlock.game.stage === 'intro', null, { timeout: 60000 });
const G = '__sherlock.game';
check(await ev(`${G}.people.length === 7 && !!${G}.conductor`), 'seven passengers and the conductor are on the train');
await shot('03-intro');
await ev(`document.querySelector('#panel .btns button').click()`);           // Continue
await until(`${G}.stage === 'dark'`, 2, 'the story continues to the blackout');
await ev('__sherlock.advance(3.5)');
check(await ev('__sherlock.train.power === 0'), 'the lights go out');
await shot('04-blackout');
await until(`${G}.stage === 'arrive'`, 12, 'the lights come back on');
check(await ev(`${G}.people[${G}.m.victim].lying`), 'the victim is lying on the floor');
await shot('05-lights-on');
// walk to the body
const body = await ev(`${G}.where.body`);
await ev(`__sherlock.standAt(${body.x}, ${body.z - 2.2}, 0)`);
await ev(`__sherlock.player.pitch = -0.45`);
await until(`${G}.stage === 'investigate'`, 2, 'walking up to the body starts the investigation');
await shot('06-the-body');
await ev('__sherlock.closePanels()');
await shot('07-crime-scene');

// ---------- investigating ----------
// examine the body (the panel's buttons), the weapon, the footprints
const clickBtn = (re) => ev(`(() => { const b = [...document.querySelectorAll('#panel button')].find((x) => ${re}.test(x.textContent) && !x.disabled); if (b){ b.click(); return true; } return false; })()`);
await ev(`${G}.use('body')`);
check(await clickBtn('/Look closely/') && await ev(`${G}.kase.has('body-look')`), 'looking closely at the body finds a trace');
check(await clickBtn('/pockets/') && await ev(`${G}.kase.has('note')`), 'the victim\'s pockets have a note in them');
await shot('08-body-examined');
const W = await ev(`${G}.where.weapon`);
await ev(`__sherlock.standAt(${W.x}, ${W.z} - 1, 0)`);
await ev(`${G}.use('weapon')`);
check(await clickBtn('/Dust/') && await ev(`${G}.kase.has('weapon-print')`), 'dusting the weapon finds a fingerprint');
await shot('09-weapon-print');
const F = await ev(`${G}.items.find((i) => i.id === 'foot').pos`);
await ev(`__sherlock.standAt(${F.x}, ${F.z} - 1.2, 0)`);
await ev(`${G}.use('foot')`);
check(await clickBtn('/Measure/') && await ev(`${G}.kase.has('foot')`), 'measuring the footprints');
await shot('10-footprints');
check(await ev(`__sherlock.crime.markers.length >= 3`), 'numbered markers appear by the clues you examined');
// a thing that isn't near can't be examined: it says to walk closer
await ev(`__sherlock.standAt(0, 20, 0); ${G}.examine('weapon')`);
check(await ev(`/Walk closer/.test(document.querySelector('#panel').textContent)`), 'far from a clue, it says to walk closer');
await ev('__sherlock.closePanels()');
// question everyone: walk over (stand in front of them), ask everything
const sus = await ev(`${G}.people.filter((P) => P.info.i !== ${G}.m.victim).map((P) => ({ i: P.info.i, x: P.holder.position.x, z: P.holder.position.z, yaw: P.yaw }))`);
let first = true;
for (const p of sus){
  await ev(`__sherlock.standAt(${p.x + Math.sin(p.yaw) * 1.1}, ${p.z + Math.cos(p.yaw) * 1.1}, ${p.yaw + Math.PI}); ${G}.use('person:${p.i}')`);
  for (const re of ['/Where were you/', '/hear or see/', '/What did you think/', '/fingerprints/', '/shoes/', '/carefully/']) await clickBtn(re);
  if (first){ await ev('__sherlock.advance(0.6)'); await shot('11-questioning'); first = false; }
}
check(await ev(`${G}.people.filter((P) => P.info.i !== ${G}.m.victim).every((P) => ['where', 'heard', 'victim', 'prints', 'shoes', 'look'].every((k) => ${G}.kase.has('p' + P.info.i + '-' + k)))`), 'everyone answers questions, gives fingerprints and shows their shoes');
await ev(`(() => { const c = ${G}.conductor.holder.position; __sherlock.standAt(c.x, c.z - 1.1, 0); ${G}.use('conductor'); })()`);
check(await clickBtn('/blackout/') && await ev(`${G}.kase.has('conductor')`), 'the conductor tells you about the blackout');
// the Coke is always on a table, and can be dusted (and sipped)
const coke = await ev('__sherlock.train.cokePos');
check(!!coke && Math.abs(coke.y - 0.78) < 0.02, 'there is a Coke on a table in the dining car');
await ev(`__sherlock.standAt(${coke.x}, ${coke.z} - 0.9, 0); __sherlock.player.pitch = -0.5; ${G}.use('coke')`);
check(await clickBtn('/Dust the bottle/') && await ev(`${G}.kase.has('coke')`), 'the Coke can be dusted for fingerprints');
await ev('__sherlock.closePanels()');
await shot('12-the-coke');
// the notebook: every tab, and the comparisons
for (const t of ['todo', 'clues', 'people', 'suspects']){ await ev(`${G}.notebook('${t}')`); await shot('13-notebook-' + t); }
await ev(`${G}.comparePrints('weapon')`);
check(await ev(`document.querySelectorAll('#panel figcaption.good').length === 1`), 'comparing fingerprints: on Easy, exactly one person\'s matches the weapon');
await shot('14-compare-prints');
await ev(`${G}.compareShoes()`); await shot('15-compare-shoes');
check(await ev(`${G}.kase.shoeCompare().filter((r) => r.match).some((r) => r.p.i === ${G}.m.murderer)`), 'the murderer\'s shoes match the footprints');
// accuse the wrong person (Easy: a warning), then the right one
const wrong = await ev(`${G}.people.find((P) => P.info.i !== ${G}.m.victim && P.info.i !== ${G}.m.murderer).info.i`);
await ev(`${G}.accuse(${G}.people[${wrong}])`);
check(await ev(`/wait a moment/.test(document.querySelector('#panel h2').textContent) && ${G}.kase.warnings === 0 && ${G}.stage === 'investigate'`), 'on Easy, accusing the wrong person gives one warning');
await shot('16-warning');
await ev(`${G}.accusePanel()`); await shot('17-accuse');
await ev(`${G}.accuse(${G}.people[${G}.m.murderer])`);
await until(`${G}.stage === 'result'`, 6, 'accusing the murderer gathers everyone in the lounge');
check(await ev(`/Solved/.test(document.querySelector('#panel h2').textContent)`), 'the right person: case solved');
check(await ev(`!localStorage.getItem(__sherlock.SAVE_KEY)`), 'a finished case is no longer saved');
await ev('__sherlock.advance(1)');
await shot('18-solved');
await ev(`document.querySelector('#panel .pbody').scrollTop = 9999`); await shot('19-solved-explained');

// ---------- a Medium case: the wrong person loses ----------
await ev(`__sherlock.closePanels(); ${G}.newCase({ difficulty: 'medium', seed: 777 })`);
await pg.waitForFunction(() => __sherlock.game.stage === 'intro', null, { timeout: 60000 });
await ev(`${G}.blackout(true)`); await until(`${G}.stage === 'arrive'`, 6, 'Medium: skip the story');
await ev(`${G}.arrive(); __sherlock.closePanels()`);
check(await ev(`${G}.kase.has('body')`), 'Medium: arriving at the body');
// save and load half way through
await ev(`${G}.kase.learn('weapon-print'); ${G}.save()`);
const before = await ev(`({ m: ${G}.m.murderer, v: ${G}.m.victim, names: ${G}.m.people.map((p) => p.name).join() })`);
await ev(`${G}.teardown(); ${G}.m = null`);
await ev(`${G}.loadSaved()`);
const after = await ev(`({ m: ${G}.m.murderer, v: ${G}.m.victim, names: ${G}.m.people.map((p) => p.name).join(), print: ${G}.kase.has('weapon-print'), stage: ${G}.stage })`);
check(after.m === before.m && after.v === before.v && after.names === before.names && after.print && after.stage === 'investigate', 'saving and loading keeps the same mystery and what you found');
await ev('__sherlock.closePanels()');
const wrong2 = await ev(`${G}.people.find((P) => P.info.i !== ${G}.m.victim && P.info.i !== ${G}.m.murderer).info.i`);
await ev(`${G}.accuse(${G}.people[${wrong2}])`);
await until(`${G}.stage === 'result'`, 6, 'Medium: the accusation');
check(await ev(`/lost/i.test(document.querySelector('#panel h2').textContent)`), 'Medium: the wrong person means the case is lost (no warning)');
await shot('20-lost');

// ---------- your own people, from photos ----------
// draw three "photos" of a face (front, left side, right side) and add a person with them
await ev('__sherlock.closePanels()');
const facePng = async (kind) => Buffer.from(await pg.evaluate((kind) => {
  const c = document.createElement('canvas'); c.width = c.height = 400; const g = c.getContext('2d');
  g.fillStyle = '#6a8aa0'; g.fillRect(0, 0, 400, 400);
  g.fillStyle = '#3a2414'; g.beginPath(); g.ellipse(200, 150, 125, 110, 0, Math.PI, 0); g.fill();
  g.fillStyle = '#e8b898'; g.beginPath(); g.ellipse(200, 210, kind === 'front' ? 110 : 120, 150, 0, 0, Math.PI * 2); g.fill();
  if (kind === 'front'){
    g.fillStyle = '#fff'; for (const x of [160, 240]){ g.beginPath(); g.ellipse(x, 190, 18, 11, 0, 0, 7); g.fill(); }
    g.fillStyle = '#2a5a9a'; for (const x of [160, 240]){ g.beginPath(); g.arc(x, 190, 8, 0, 7); g.fill(); }
    g.strokeStyle = '#a04040'; g.lineWidth = 7; g.beginPath(); g.arc(200, 260, 40, 0.2, Math.PI - 0.2); g.stroke();
    g.fillStyle = '#d09a80'; g.beginPath(); g.moveTo(200, 200); g.lineTo(188, 240); g.lineTo(212, 240); g.fill();
  } else {
    const s = kind === 'left' ? -1 : 1;
    g.fillStyle = '#d09a80'; g.beginPath(); g.moveTo(200 + s * 110, 200); g.lineTo(200 + s * 140, 240); g.lineTo(200 + s * 112, 245); g.fill();
    g.fillStyle = '#c8987a'; g.beginPath(); g.ellipse(200 - s * 10, 215, 18, 30, 0, 0, 7); g.fill();
  }
  return c.toDataURL('image/png').split(',')[1];
}, kind), 'base64');
await ev(`__sherlock.castEditor.open()`);
await pg.waitForSelector('#cast.show');
await pg.click('#cast .btns button.primary');            // Add a person
await pg.fill('#cast .cast-input', 'Grandma Rose');
const slots = await pg.$$('#cast .cast-slot');
for (const [k, kind] of ['front', 'left', 'right'].entries()){
  const fc = pg.waitForEvent('filechooser');
  await slots[k].click();
  await (await fc).setFiles({ name: kind + '.png', mimeType: 'image/png', buffer: await facePng(kind) });
  await pg.waitForSelector('#cast .cast-align');
  if (k === 0) await pg.screenshot({ path: path.join(OUT, '21-line-up-photo.png') });
  await ev('__sherlock.castEditor.aligning.ok()');
  await pg.waitForFunction(() => !document.querySelector('#cast .cast-layer'));
}
await pg.screenshot({ path: path.join(OUT, '22-add-person.png') });
await clickCast('/Save/');
async function clickCast(re){ return ev(`(() => { const b = [...document.querySelectorAll('#cast button')].find((x) => ${re}.test(x.textContent)); if (b){ b.click(); return true; } return false; })()`); }
await pg.waitForFunction(() => /Grandma Rose/.test(document.querySelector('#cast').textContent) && !document.querySelector('#cast .cast-input'), null, { timeout: 10000 });
check(true, 'adding your own person from three photos (front, left side, right side)');
await clickCast('/Done/');
await ev(`${G}.newCase({ difficulty: 'easy', useCast: true, seed: 99 })`);
await pg.waitForFunction(() => __sherlock.game.stage === 'intro', null, { timeout: 60000 });
const rose = await ev(`(() => { const P = ${G}.people.find((Q) => Q.info.cast); return P ? { i: P.info.i, photo: !!P.photo, victim: P.info.i === ${G}.m.victim, x: P.holder.position.x, z: P.holder.position.z, yaw: P.yaw } : null; })()`);
check(rose && rose.photo && !rose.victim, 'your person is on the train with their photo face, and isn\'t the victim');
await ev(`__sherlock.closePanels(); ${G}.blackout(true)`); await ev('__sherlock.advance(4)');
if (rose){
  await ev(`__sherlock.standAt(${rose.x + Math.sin(rose.yaw) * 0.9}, ${rose.z + Math.cos(rose.yaw) * 0.9}, ${rose.yaw + Math.PI}); __sherlock.player.pitch = 0.05`);
  await ev('__sherlock.advance(1.5)');
  await shot('23-photo-person');
  await ev(`${G}.personPanel(${G}.people[${rose.i}])`); await shot('24-photo-portrait'); await ev('__sherlock.closePanels()');
}

// ---------- the notebook's reasoning agrees with the answer ----------
// with every clue found, the notebook rules out every innocent person and never the murderer
{
  const n = FULL ? 12 : 3;
  const bad = await ev(`(async () => { const G = __sherlock.game, out = [];
    for (const d of ['easy', 'medium', 'hard']) for (let s = 1; s <= ${n}; s++){
      await G.newCase({ difficulty: d, seed: 5000 + s * 13 }); __sherlock.closePanels();
      const k = G.kase; for (const id of ['body', 'body-look', 'note', 'weapon-print', 'foot', 'fibre', 'conductor']) k.learn(id);
      for (const p of k.suspects) for (const f of ['where', 'heard', 'victim', 'prints', 'shoes', 'look']) k.learn('p' + p.i + '-' + f);
      for (const p of k.suspects){ const r = k.reasons(p); const isM = p.i === G.m.murderer; if (isM ? r.out.length : !r.out.length) out.push(d + ' ' + s + ' ' + p.name + (isM ? ' (murderer) ruled out: ' + r.out : ' not ruled out')); }
    } return out; })()`);
  check(!bad.length, `with every clue found, the notebook rules out each innocent person and not the murderer (${3 * n} cases)${bad.length ? ': ' + bad.slice(0, 4).join('; ') : ''}`);
}

// ---------- memory: several cases come and go ----------
const mem = () => ev('({ g: __sherlock.renderer.info.memory.geometries, t: __sherlock.renderer.info.memory.textures })');
// (the same cases twice: the first time round loads people's bodies for the first time)
const churn = async () => { for (let k = 0; k < 4; k++){ await ev(`${G}.newCase({ difficulty: ['easy','medium','hard'][${k} % 3], seed: ${100 + k} })`); await ev(`__sherlock.closePanels(); ${G}.blackout(true); __sherlock.advance(4); __sherlock.renderNow()`); } };
await churn(); const m0 = await mem();
await churn(); const m1 = await mem();
check(m1.g <= m0.g + 5 && m1.t <= m0.t + 3, `memory stays flat over several cases (geometries ${m0.g} → ${m1.g}, textures ${m0.t} → ${m1.t})`);
check(await ev('__sherlock.renderer.info.render.calls') < 400, `draw calls: ${await ev('__sherlock.renderer.info.render.calls')}`);

// ---------- VR ----------
if (IWER){
  await ev(`__sherlock.closePanels(); ${G}.blackout(true); __sherlock.advance(4)`);
  await ev('__sherlock.noRender = false; __sherlock.xrScale = 0.25');
  await ev('__sherlock.play(true)');
  await pg.waitForFunction(() => __sherlock.mode === 'vr', null, { timeout: 30000 });
  await pg.waitForFunction(() => __sherlock.vrs.posed, null, { timeout: 30000 });
  check(true, 'VR starts');
  const b = await ev(`${G}.where.body`);
  // stand by the body (the headset at 1.6 m), notebook in the left hand
  await ev(`__iwer.position.set(0, 1.6, 0); __iwer.quaternion.set(0, 0, 0, 1);
    __iwer.controllers.left.position.set(-0.2, 1.3, -0.35); __iwer.controllers.right.position.set(0.15, 1.3, -0.15);`);
  await wait(500);
  await ev(`__sherlock.standAt(${b.x}, ${b.z} + 2.2, Math.PI)`);
  await wait(800);
  check(await ev('__sherlock.vr[0].tracked && __sherlock.vr[1].tracked'), 'both controllers are tracked');
  check(await ev(`${G}.stage === 'investigate'`), 'walking up to the body in VR starts the investigation');
  await wait(400);
  await pg.screenshot({ path: path.join(OUT, '25-vr.png') });
  // the notebook in your hand shows the panel; point the right controller at a button and pull the trigger
  check(await ev(`!!__sherlock.vrPage && /Zara|Oh no/.test(__sherlock.vrPage.title) || !!__sherlock.vrPage`), 'the panel is on the VR notebook');
  const aim = await ev(`(() => { const T = __sherlock.tablet, h = T.hits.find((r) => r.b.label && /Start investigating/.test(r.b.label)); if (!h) return null;
    const u = (h.x + h.w / 2) / T.W, v = 1 - (h.y + h.h / 2) / T.H;
    const p = T.mesh.localToWorld(new T.mesh.position.constructor((u - 0.5) * 0.3, (v - 0.5) * 0.375, 0));
    return p.toArray(); })()`);
  if (check(!!aim, 'the VR notebook has a "Start investigating" button')){
    await ev(`(() => { const T = __sherlock, R = T.vr[1]; const target = new T.rig.position.constructor(...${JSON.stringify(aim)});
      const dir = target.clone().sub(R.rayPos).normalize();
      const d = dir.applyQuaternion(T.rig.quaternion.clone().invert());
      const q = new T.rig.quaternion.constructor().setFromUnitVectors(new T.rig.position.constructor(0, 0, -1), d);
      window.__iwer.controllers.right.quaternion.set(q.x, q.y, q.z, q.w); })()`);
    await wait(600);
    if (process.env.DEBUG_VR) console.log(await ev(`(() => { const T = __sherlock, R = T.vr[1]; const target = new T.rig.position.constructor(...${JSON.stringify(aim)}); const want = target.clone().sub(R.rayPos).normalize(); const got = new T.rig.position.constructor(0, 0, -1).applyQuaternion(R.rayQuat); return JSON.stringify({ want: want.toArray().map((v) => v.toFixed(2)), got: got.toArray().map((v) => v.toFixed(2)), rig: T.rig.rotation.y.toFixed(2), tablet: T.tablet.hover, ctrl: __iwer.controllers.right.quaternion.toArray ? 1 : 0 }); })()`));
    await ev('__iwer.controllers.right.updateButtonValue("trigger", 1)'); await wait(400); await ev('__iwer.controllers.right.updateButtonValue("trigger", 0)'); await wait(400);
    check(await ev(`/Zara|body|^The|^[A-Z]/.test(__sherlock.vrPage ? __sherlock.vrPage.title : '') && /Look closely|pockets/.test(JSON.stringify(__sherlock.vrPage.sections.map((x) => (x.buttons || []).map((b) => b.label))))`), 'pointing at "Start investigating" on the notebook and pulling the trigger opens the body\'s page');
  }
  await pg.screenshot({ path: path.join(OUT, '26-vr-notebook.png') });
  await ev('__sherlock.renderer.xr.getSession().end()');
  await pg.waitForFunction(() => __sherlock.mode === 'title', null, { timeout: 10000 });
  check(true, 'leaving VR goes back to the title screen');
  await ev('__sherlock.noRender = true');
}
const real = errors.filter((e) => !/favicon|Failed to load resource.*icon/.test(e));
check(!real.length, 'no errors in the console');
errors.length = 0; errors.push(...real);
console.log(`\n${failures ? failures + ' FAILED' : 'all ok'} (${Math.round((Date.now() - t0) / 1000)} s)`);
if (errors.length){ console.log('errors:\n  ' + [...new Set(errors)].slice(0, 12).join('\n  ')); }
await browser.close(); server.close();
process.exit(failures || errors.length ? 1 : 0);
