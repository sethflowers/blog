// Makes MSB's people animations: takes the walk, idle, nod (agree) and head-shake clips from three.js's
// Mixamo "Xbot" model (downloaded once into the system's temp folder) and retargets them onto the two
// people the game uses (Michelle and the Ready Player Me man, in experiments/msb/models/), saving
// experiments/msb/models/clips.json. Run it again if a model changes.
//   NODE_PATH=$(npm root -g) node _tools/msb/people.mjs
//
// Retargeting: each bone turns in world space by as much as the source bone turned from its rest
// pose; first each target bone's rest is turned to point the way the source's does, which matches an
// A-pose rig to a T-pose one.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const XBOT = path.join(os.tmpdir(), 'msb-Xbot.glb');
if (!fs.existsSync(XBOT)){
  const r = await fetch('https://raw.githubusercontent.com/mrdoob/three.js/r180/examples/models/gltf/Xbot.glb');
  if (!r.ok) throw new Error('could not download Xbot.glb');
  fs.writeFileSync(XBOT, Buffer.from(await r.arrayBuffer()));
}
const srv = http.createServer((q, r) => {
  const u = q.url.split('?')[0];
  if (u === '/') { r.writeHead(200, { 'content-type': 'text/html' }); return r.end('<script type="importmap">{"imports":{"three":"/experiments/msb/lib/three.module.min.js"}}</script>'); }
  const f = u === '/xbot.glb' ? XBOT : path.join(ROOT, u);
  try { r.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' }); r.end(fs.readFileSync(f)); } catch (e) { r.writeHead(404); r.end(); }
});
await new Promise((r) => srv.listen(0, r));
const browser = await chromium.launch();
const pg = await browser.newPage();
pg.on('pageerror', (e) => console.log('error:', e.message));
await pg.goto(`http://127.0.0.1:${srv.address().port}/`);
const json = await pg.evaluate(async () => {
  const THREE = await import('three');
  const { GLTFLoader } = await import('/experiments/msb/lib/addons/GLTFLoader.js');
  const SU = await import('/experiments/msb/lib/addons/SkeletonUtils.js');
  const L = new GLTFLoader();
  const xb = await L.loadAsync('/xbot.glb');
  const key = (n) => n.replace('mixamorig', '');
  function retarget(clip, srcRoot, dst){
    const src = SU.clone(srcRoot); src.updateMatrixWorld(true); dst.updateMatrixWorld(true);
    const sb = {}, list = [], wp = (o) => o.getWorldPosition(new THREE.Vector3());
    src.traverse((o) => { if (o.isBone) sb[key(o.name)] = o; });
    dst.traverse((o) => {
      if (!o.isBone || !sb[key(o.name)]) return;
      const k = key(o.name), Lb = { t: o, s: sb[k], Wt: o.getWorldQuaternion(new THREE.Quaternion()), Ws: sb[k].getWorldQuaternion(new THREE.Quaternion()), vals: [] };
      const tc = o.children.find((c) => c.isBone && sb[key(c.name)]);
      if (tc && k !== 'Hips'){ const sc = sb[key(tc.name)]; const dt = wp(tc).sub(wp(o)).normalize(), ds = wp(sc).sub(wp(sb[k])).normalize(); if (dt.lengthSq() > 0.5 && ds.lengthSq() > 0.5) Lb.Wt.premultiply(new THREE.Quaternion().setFromUnitVectors(dt, ds)); }
      list.push(Lb);
    });
    const mx = new THREE.AnimationMixer(src); mx.clipAction(clip).play();
    const fps = 24, n = Math.max(2, Math.round(clip.duration * fps)), times = [], tw = new Map(), q = new THREE.Quaternion(), pw = new THREE.Quaternion();
    for (let f = 0; f <= n; f++){
      const time = clip.duration * f / n; times.push(+time.toFixed(3));
      mx.setTime(time); src.updateMatrixWorld(true); tw.clear();
      for (const Lb of list){
        const Qt = Lb.s.getWorldQuaternion(new THREE.Quaternion()).multiply(Lb.Ws.clone().invert()).multiply(Lb.Wt);
        tw.set(Lb.t, Qt);
        const par = Lb.t.parent; if (tw.has(par)) pw.copy(tw.get(par)); else par.getWorldQuaternion(pw);
        q.copy(pw).invert().multiply(Qt);
        Lb.vals.push(+q.x.toFixed(3), +q.y.toFixed(3), +q.z.toFixed(3), +q.w.toFixed(3));
      }
    }
    // a bone that hardly moves (fingers, toes) keeps one key
    const tracks = list.map((Lb) => {
      const v = Lb.vals; let still = true;
      for (let i = 4; i < v.length && still; i++) if (Math.abs(v[i] - v[i % 4]) > 0.004) still = false;
      return still ? new THREE.QuaternionKeyframeTrack(Lb.t.name + '.quaternion', [0], v.slice(0, 4)) : new THREE.QuaternionKeyframeTrack(Lb.t.name + '.quaternion', times, v);
    });
    return new THREE.AnimationClip(clip.name, clip.duration, tracks);
  }
  const out = {};
  for (const m of ['Michelle', 'readyplayer.me']){
    const g = await L.loadAsync(`/experiments/msb/models/${m}.glb`);
    out[m] = ['idle', 'walk', 'agree', 'headShake'].map((n) => THREE.AnimationClip.toJSON(retarget(xb.animations.find((c) => c.name === n), xb.scene, g.scene)));
  }
  return JSON.stringify(out);
});
fs.writeFileSync(path.join(ROOT, 'experiments/msb/models/clips.json'), json);
console.log('wrote clips.json', Math.round(json.length / 1024) + ' KB');
await browser.close(); srv.close();
