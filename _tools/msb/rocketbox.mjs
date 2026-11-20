// Makes MSB's visitors from Microsoft's Rocketbox avatar library (MIT licence,
// github.com/microsoft/Microsoft-Rocketbox): downloads each chosen avatar's FBX and textures (once, into
// the system's temp folder), shrinks the 2048 px textures to 512 px, loads the FBX in headless Chromium,
// gives it physically based materials, retargets the walk / idle / nod / head-shake animations (from
// three.js's Mixamo "Xbot") onto its 3ds Max "Bip01" skeleton, and saves one small .glb per person in
// experiments/msb/models/people/, plus a list (people.json).
//   NODE_PATH=$(npm root -g) node _tools/msb/rocketbox.mjs
// Needs Python with Pillow (to read the .tga textures).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const OUT = path.join(ROOT, 'experiments/msb/models/people');
const CACHE = path.join(os.tmpdir(), 'msb-rocketbox');
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CACHE, { recursive: true });
const REPO = 'https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/Assets/Avatars/Adults/';

// who: [folder, height in metres, a word for the plan]
const PEOPLE = JSON.parse(fs.readFileSync(path.join(HERE, 'people.json'), 'utf8'));

async function get(url, file){
  if (fs.existsSync(file) && fs.statSync(file).size > 1000) return;
  const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${url}`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}
// 1. download and shrink
for (const P of PEOPLE){
  const dir = path.join(CACHE, P.id); fs.mkdirSync(dir, { recursive: true });
  const fbx = path.join(dir, P.id + '.fbx');
  await get(`${REPO}${P.id}/Export/${P.id}.fbx`, fbx);
  // the texture names are inside the FBX (…\textures\f001_body_color.tga)
  const names = [...new Set((fs.readFileSync(fbx).toString('latin1').match(/[a-z0-9_]+_(body|head|opacity)_(color|normal)\.tga/gi) || []).map((s) => s.toLowerCase()))];
  for (const n of names.filter((n) => /_(body|head|opacity)_color|_body_normal/.test(n))){
    const small = path.join(dir, n.replace('.tga', n.includes('opacity') ? '.png' : '.jpg'));
    if (fs.existsSync(small)) continue;
    const tga = path.join(dir, n);
    await get(`${REPO}${P.id}/Textures/${n}`, tga);
    execFileSync('python3', ['-c', `import sys; from PIL import Image
im = Image.open(sys.argv[1]); im = im.resize((512, 512), Image.LANCZOS)
if sys.argv[2].endswith('.png'): im.convert('RGBA').quantize(colors=96, method=Image.FASTOCTREE).save(sys.argv[2], optimize=True)
else: im.convert('RGB').save(sys.argv[2], quality=84, optimize=True)`, tga, small]);
    fs.unlinkSync(tga);   // (12 MB each)
  }
  console.log('got', P.id);
}
// 2. convert in the browser
const XBOT = path.join(os.tmpdir(), 'msb-Xbot.glb');
await get('https://raw.githubusercontent.com/mrdoob/three.js/r180/examples/models/gltf/Xbot.glb', XBOT);
const srv = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  if (u === '/'){ r.writeHead(200, { 'content-type': 'text/html' }); return r.end('<script type="importmap">{"imports":{"three":"/experiments/msb/lib/three.module.min.js"}}</script>'); }
  const f = u === '/xbot.glb' ? XBOT : u.startsWith('/cache/') ? path.join(CACHE, u.slice(7)) : path.join(ROOT, u);
  let body; try { body = fs.readFileSync(f); } catch (e) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.png') ? 'image/png' : f.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream' }); r.end(body);
});
await new Promise((r) => srv.listen(0, r));
const browser = await chromium.launch();
const pg = await browser.newPage();
pg.on('pageerror', (e) => console.log('error:', e.message));
await pg.goto(`http://127.0.0.1:${srv.address().port}/`);
for (const P of PEOPLE){
  const files = fs.readdirSync(path.join(CACHE, P.id));
  const glb = await pg.evaluate(async ({ P, files }) => {
    const THREE = await import('three');
    const { FBXLoader } = await import('/_tools/msb/vendor/FBXLoader.js');
    const { GLTFLoader } = await import('/experiments/msb/lib/addons/GLTFLoader.js');
    const { GLTFExporter } = await import('/_tools/msb/vendor/GLTFExporter.js');
    const SU = await import('/experiments/msb/lib/addons/SkeletonUtils.js');
    const { mergeVertices } = await import('/experiments/msb/lib/addons/BufferGeometryUtils.js');
    // (the FBX asks for textures that aren't there: hand it an empty picture instead)
    const mgr = new THREE.LoadingManager(); mgr.setURLModifier((u) => (/\.tga$/i.test(u) ? 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' : u));
    const fbx = await new FBXLoader(mgr).loadAsync(`/cache/${P.id}/${P.id}.fbx`);
    const tl = new THREE.TextureLoader();
    const tex = async (part, kind, color = true) => {
      const f = files.find((n) => n.includes(`_${part}_${kind}.`)); if (!f) return null;
      const t = await tl.loadAsync(`/cache/${P.id}/${f}`); t.flipY = true; if (color) t.colorSpace = THREE.SRGBColorSpace; t.userData.mimeType = f.endsWith('.png') ? 'image/png' : 'image/jpeg';
      return t;
    };
    const maps = { body: await tex('body', 'color'), head: await tex('head', 'color'), opacity: await tex('opacity', 'color'), bodyN: await tex('body', 'normal', false) };
    let mesh = null; fbx.traverse((o) => { if (o.isSkinnedMesh && !mesh) mesh = o; });
    mesh.material = [].concat(mesh.material).map((m) => {
      const part = /opacity/i.test(m.name) ? 'opacity' : /head/i.test(m.name) ? 'head' : 'body';
      const s = new THREE.MeshStandardMaterial({ name: part, map: maps[part], roughness: part === 'head' ? 0.6 : 0.82, metalness: 0 });
      if (part === 'body' && maps.bodyN){ s.normalMap = maps.bodyN; }
      if (part === 'opacity'){ s.transparent = false; s.alphaTest = 0.4; s.side = THREE.DoubleSide; s.roughness = 0.55; }
      return s;
    });
    // keep only the person (drop helper objects), bones renamed the way three.js names them
    const key = (n) => n.replace(/^mixamorig:?/, '');
    // Mixamo bone → Rocketbox (3ds Max biped) bone
    const MAP = { Hips: 'Bip01_Pelvis', Spine: 'Bip01_Spine', Spine1: 'Bip01_Spine1', Spine2: 'Bip01_Spine2', Neck: 'Bip01_Neck', Head: 'Bip01_Head' };
    for (const [s, S] of [['Left', 'L'], ['Right', 'R']]){
      Object.assign(MAP, { [s + 'Shoulder']: `Bip01_${S}_Clavicle`, [s + 'Arm']: `Bip01_${S}_UpperArm`, [s + 'ForeArm']: `Bip01_${S}_Forearm`, [s + 'Hand']: `Bip01_${S}_Hand`,
        [s + 'UpLeg']: `Bip01_${S}_Thigh`, [s + 'Leg']: `Bip01_${S}_Calf`, [s + 'Foot']: `Bip01_${S}_Foot`, [s + 'ToeBase']: `Bip01_${S}_Toe0` });
      ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].forEach((f, i) => { MAP[`${s}Hand${f}1`] = `Bip01_${S}_Finger${i}`; MAP[`${s}Hand${f}2`] = `Bip01_${S}_Finger${i}1`; MAP[`${s}Hand${f}3`] = `Bip01_${S}_Finger${i}2`; });
    }
    const xb = await new GLTFLoader().loadAsync('/xbot.glb');
    function retarget(clip){
      const src = SU.clone(xb.scene); src.updateMatrixWorld(true); fbx.updateMatrixWorld(true);
      const sb = {}; src.traverse((o) => { if (o.isBone) sb[key(o.name)] = o; });
      const tb = {}; fbx.traverse((o) => { if (o.isBone) tb[o.name] = o; });
      const wp = (o) => o.getWorldPosition(new THREE.Vector3());
      const list = [];
      // parents first (the target's hierarchy order)
      const order = []; fbx.traverse((o) => { if (o.isBone) order.push(o); });
      const inv = Object.fromEntries(Object.entries(MAP).map(([a, b]) => [b, a]));
      for (const o of order){
        const k = inv[o.name]; if (!k || !sb[k]) continue;
        const L = { t: o, s: sb[k], Wt: o.getWorldQuaternion(new THREE.Quaternion()), Ws: sb[k].getWorldQuaternion(new THREE.Quaternion()), vals: [] };
        // point each target bone (at rest) the way the source's points
        const tcName = Object.entries(MAP).find(([a]) => sb[a] && sb[a].parent === sb[k] && tb[MAP[a]]);
        if (tcName && k !== 'Hips'){ const tc = tb[tcName[1]], sc = sb[tcName[0]]; const dt = wp(tc).sub(wp(o)).normalize(), ds = wp(sc).sub(wp(sb[k])).normalize(); L.Wt.premultiply(new THREE.Quaternion().setFromUnitVectors(dt, ds)); }
        list.push(L);
      }
      const mx = new THREE.AnimationMixer(src); mx.clipAction(clip).play();
      const fps = 24, n = Math.max(2, Math.round(clip.duration * fps)), times = [], tw = new Map(), q = new THREE.Quaternion(), pw = new THREE.Quaternion();
      for (let f = 0; f <= n; f++){
        const time = clip.duration * f / n; times.push(+time.toFixed(3));
        mx.setTime(time); src.updateMatrixWorld(true); tw.clear();
        for (const L of list){
          const Qt = L.s.getWorldQuaternion(new THREE.Quaternion()).multiply(L.Ws.clone().invert()).multiply(L.Wt);
          tw.set(L.t, Qt);
          // the parent's world turn: animated if it's one of ours, else as it rests (it may itself sit under animated bones)
          let par = L.t.parent;
          if (tw.has(par)) pw.copy(tw.get(par));
          else { par.getWorldQuaternion(pw); let up = par.parent; while (up && !tw.has(up)) up = up.parent; if (up){ const rest = up.getWorldQuaternion(new THREE.Quaternion()).invert(); pw.premultiply(rest).premultiply(tw.get(up)); } }
          q.copy(pw).invert().multiply(Qt);
          L.vals.push(+q.x.toFixed(3), +q.y.toFixed(3), +q.z.toFixed(3), +q.w.toFixed(3));
        }
      }
      const tracks = list.map((L) => { const v = L.vals; let still = true; for (let i = 4; i < v.length && still; i++) if (Math.abs(v[i] - v[i % 4]) > 0.0012) still = false;
        return still ? new THREE.QuaternionKeyframeTrack(L.t.name + '.quaternion', [0], v.slice(0, 4)) : new THREE.QuaternionKeyframeTrack(L.t.name + '.quaternion', times, v); });
      return new THREE.AnimationClip(clip.name, clip.duration, tracks);
    }
    const clips = ['idle', 'walk', 'agree', 'headShake'].map((n) => retarget(xb.animations.find((c) => c.name === n)));
    // one mesh per material, each with only its own vertices (the exporter would otherwise write every
    // vertex once for each of the 14 material groups)
    const g = mesh.geometry, mats = [].concat(mesh.material), names = ['position', 'normal', 'uv', 'skinIndex', 'skinWeight'];
    const parts = [];
    mats.forEach((m, mi) => {
      const tris = []; const idx = g.index ? g.index.array : null;
      for (const gr of g.groups.filter((q) => q.materialIndex === mi)) for (let k = gr.start; k < gr.start + gr.count; k++) tris.push(idx ? idx[k] : k);
      if (!tris.length) return;
      const remap = new Map(), out = {}; names.forEach((n) => { out[n] = []; });
      const nidx = tris.map((v) => { if (!remap.has(v)){ remap.set(v, remap.size); for (const n of names){ const a = g.attributes[n]; for (let c = 0; c < a.itemSize; c++) out[n].push(a.array[v * a.itemSize + c]); } } return remap.get(v); });
      const ng = new THREE.BufferGeometry();
      for (const n of names){ const a = g.attributes[n]; const T = n === 'skinIndex' ? Uint16Array : Float32Array; ng.setAttribute(n, new THREE.BufferAttribute(new T(out[n]), a.itemSize)); }
      ng.setIndex(nidx);
      const sm = new THREE.SkinnedMesh(mergeVertices(ng, 1e-5), m);   // (the FBX gives every corner of every triangle its own vertex) sm.name = m.name; sm.position.copy(mesh.position); sm.quaternion.copy(mesh.quaternion); sm.scale.copy(mesh.scale);
      parts.push(sm);
    });
    const parent = mesh.parent;
    for (const sm of parts){ parent.add(sm); sm.bind(mesh.skeleton, mesh.bindMatrix); }
    parent.remove(mesh); mesh = parts[0];
    // drop everything but the skinned mesh and its bones
    const keep = new Set(); mesh.skeleton.bones.forEach((b) => { let o = b; while (o){ keep.add(o); o = o.parent; } }); for (const sm of parts){ let o = sm; while (o){ keep.add(o); o = o.parent; } }
    const drop = []; fbx.traverse((c) => { if (!keep.has(c) && !c.isBone && c !== fbx) drop.push(c); }); drop.forEach((c) => c.parent && c.parent.remove(c));
    const ab = await new GLTFExporter().parseAsync(fbx, { binary: true, animations: clips, onlyVisible: false });
    return Array.from(new Uint8Array(ab));
  }, { P, files });
  fs.writeFileSync(path.join(OUT, P.id + '.glb'), Buffer.from(glb));
  console.log('wrote', P.id + '.glb', Math.round(glb.length / 1024) + ' KB');
}
fs.writeFileSync(path.join(OUT, 'list.json'), JSON.stringify(PEOPLE));
console.log('wrote list.json');
await browser.close(); srv.close();
