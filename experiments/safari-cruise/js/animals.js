// The animals. Each is built at start-up from smooth lofted shapes (body, neck, head, two-part legs),
// coated in a coat painted pixel by pixel (zebra stripes, giraffe patches, cheetah spots...). They walk
// with proper leg swings, graze, drink, lie down, wallow, swim, come to the feeder when hungry, look
// at the trucks going by, leave dung, get dirty and sometimes get poorly.
import * as THREE from 'three';
import { V, loft, limb, ellipsoid, clamp, lerp, damp, rng, angleDiff, vnoise, fbm, hash2, mergeGeometries, smooth } from './util.js';
import { paint, mix, mul } from './textures.js';
import { ZONES } from './world.js';

const TAU = Math.PI * 2;
const bellyK = (u, w = 0.14) => clamp(1 - Math.abs(u - 0.75) / w);

// ---------- coats ----------
// each coat: fn(u, v, leg) → colour. u goes round the body (0.25 = the spine, 0.75 = the belly), v along it.
const COATS = {
  zebra(u, v, leg){
    const w = vnoise(u * 4, v * 5, 3, [4, 0]) - 0.5;
    const f = leg ? v * 26 : v * 15 + w * 0.9 + (v < 0.28 ? (0.28 - v) * Math.cos(u * TAU) * 3 : 0);
    const s = Math.sin(f * TAU) + (leg ? 0.15 : 0.05);
    let b = s > 0.08 ? 0.06 : 0.93;
    if (!leg) b = lerp(b, 0.93, smooth((bellyK(u, 0.12) - 0.3) * 2));
    const n = (hash2(u * 512, v * 512) - 0.5) * 0.05;
    return [b + 0.02 + n, b + n, b - 0.03 + n];
  },
  giraffe(u, v, leg){
    if (leg && v > 0.55) return [0.9, 0.84, 0.7];
    const su = 7, sv = leg ? 10 : 9, x = u * su, y = v * sv;
    let d1 = 9, d2 = 9;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++){
      const ci = Math.floor(x) + i, cj = Math.floor(y) + j, wi = ((ci % su) + su) % su;
      const px = ci + 0.2 + hash2(wi, cj, 5) * 0.6, py = cj + 0.2 + hash2(wi, cj, 6) * 0.6;
      const d = Math.hypot((x - px) * 0.9, y - py);
      if (d < d1){ d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    const line = smooth((d2 - d1 - 0.05) / 0.08);
    const patch = mix([0.52, 0.27, 0.11], [0.7, 0.42, 0.18], hash2(Math.floor(x), Math.floor(y), 9));
    let c = mix([0.92, 0.86, 0.7], patch, line);
    if (!leg) c = mix(c, [0.9, 0.84, 0.7], bellyK(u, 0.1) * 0.8);
    return c;
  },
  cheetah(u, v, leg){
    let c = mix([0.86, 0.66, 0.36], [0.78, 0.56, 0.28], clamp(1 - Math.abs(u - 0.25) * 3));
    if (!leg) c = mix(c, [0.95, 0.92, 0.84], bellyK(u, 0.16));
    const x = u * 16, y = v * (leg ? 30 : 22), i = Math.floor(x), j = Math.floor(y);
    const px = i + 0.25 + hash2(i % 16, j, 1) * 0.5, py = j + 0.25 + hash2(i % 16, j, 2) * 0.5;
    if (Math.hypot(x - px, (y - py) * 1.1) < 0.24 && (leg || bellyK(u, 0.12) < 0.5)) c = [0.08, 0.06, 0.05];
    return c;
  },
  tiger(u, v, leg){
    let c = mix([0.92, 0.52, 0.14], [0.82, 0.4, 0.08], clamp(1 - Math.abs(u - 0.25) * 3));
    const bel = leg ? 0 : bellyK(u, 0.17);
    c = mix(c, [0.96, 0.94, 0.88], smooth(bel * 1.6));
    const w = vnoise(u * 6, v * 8, 7, [6, 0]);
    const s = Math.sin((v * (leg ? 18 : 13) + w * 0.8 + Math.sin(u * TAU * 2) * 0.12) * TAU);
    const width = 0.55 + (vnoise(u * 3, v * 20, 4, [3, 0]) - 0.5) * 0.6;
    if (s > width && bel < 0.7 && (!leg || v < 0.7)) c = [0.06, 0.05, 0.04];
    return c;
  },
  lion(u, v, leg){
    let c = mix([0.8, 0.62, 0.38], [0.7, 0.52, 0.3], clamp(1 - Math.abs(u - 0.25) * 3) * (0.5 + fbm(u * 4, v * 6, 2, 4, [4, 0]) * 0.5));
    if (!leg) c = mix(c, [0.9, 0.82, 0.66], bellyK(u, 0.15));
    return mul(c, 0.94 + (hash2(u * 300, v * 300) - 0.5) * 0.08);
  },
  wildebeest(u, v, leg){
    let c = mix([0.42, 0.42, 0.42], [0.32, 0.31, 0.3], fbm(u * 4, v * 6, 2, 8, [4, 0]));
    if (!leg && v > 0.45 && Math.sin(v * 40 + Math.sin(u * TAU) * 0.6) > 0.55 && bellyK(u, 0.2) < 0.4) c = mul(c, 0.55);
    if (leg) c = mul(c, lerp(1, 0.6, clamp(v * 1.5)));
    return c;
  },
  impala(u, v, leg){
    let c = [0.62, 0.36, 0.2];
    if (!leg){ const side = Math.abs(u - 0.75); if (side < 0.16) c = [0.94, 0.9, 0.84]; else if (side < 0.2) c = [0.8, 0.6, 0.4]; }
    else c = mix(c, [0.78, 0.6, 0.42], clamp(v * 2));
    return mul(c, 0.96 + (hash2(u * 300, v * 300) - 0.5) * 0.06);
  },
  elephant(u, v){
    const w = vnoise(u * 60, v * 14, 2, [60, 0]), n = fbm(u * 5, v * 5, 3, 3, [5, 0]);
    return mul([0.52, 0.49, 0.47], 0.86 + n * 0.16 - smooth((w - 0.7) / 0.2) * 0.07 + (hash2(u * 700, v * 700) - 0.5) * 0.05);
  },
  rhino(u, v){
    const n = fbm(u * 6, v * 6, 3, 13, [6, 0]), fold = Math.abs(Math.sin((v * 3 + vnoise(u * 5, v * 3, 2, [5, 0]) * 0.4) * TAU / 2));
    return mul([0.56, 0.53, 0.49], 0.86 + n * 0.18 - smooth((fold - 0.96) / 0.04) * 0.08 + (hash2(u * 700, v * 700) - 0.5) * 0.05);
  },
  hippo(u, v){
    const n = fbm(u * 5, v * 5, 3, 23, [5, 0]);
    return mix(mul([0.42, 0.36, 0.36], 0.85 + n * 0.25), [0.72, 0.5, 0.45], bellyK(u, 0.3) * 0.8);
  },
  warthog(u, v, leg){
    const n = fbm(u * 6, v * 6, 2, 33, [6, 0]);
    return mul(leg ? [0.36, 0.3, 0.26] : [0.44, 0.37, 0.31], 0.8 + n * 0.3 + (hash2(u * 400, v * 400) > 0.9 ? -0.15 : 0));
  },
  bear(u, v){
    const n = fbm(u * 8, v * 10, 3, 43, [8, 0]), f = hash2(u * 512, v * 512);
    return mul([0.4, 0.26, 0.15], 0.78 + n * 0.35 + (f - 0.5) * 0.12);
  },
  croc(u, v, leg){
    const top = clamp(1 - Math.abs(u - 0.25) * 2.4);
    let c = mix([0.78, 0.74, 0.56], [0.3, 0.32, 0.18], leg ? 0.8 : smooth(top * 1.8 + 0.1));
    const sx = (u * 14) % 1, sy = (v * 40) % 1;
    if (top > 0.4 && (sx < 0.1 || sy < 0.12)) c = mul(c, 0.6);
    return mul(c, 0.9 + (hash2(Math.floor(u * 14), Math.floor(v * 40)) - 0.5) * 0.25);
  },
  ostrich(u, v){
    const f = vnoise(u * 30, v * 20, 5, [30, 0]);
    return mul([0.13, 0.12, 0.11], 0.8 + f * 0.6);
  },
};
const coatCache = new Map();
function coat(name, leg){
  const key = name + (leg ? '-leg' : '');
  if (!coatCache.has(key)) coatCache.set(key, paint(leg ? 128 : 256, leg ? 128 : 256, (u, v) => COATS[name](u, v, leg)));
  return coatCache.get(key);
}
const plain = new Map();
function pmat(color, rough = 0.6, metal = 0){ const k = color + ':' + rough; if (!plain.has(k)) plain.set(k, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal })); return plain.get(k); }

// ---------- species ----------
// size: metres of body length · walk / run: m/s · appeal: how much visitors love them
export const SPECIES = {
  zebra:      { name: 'Zebra', plural: 'Zebras', icon: '🦓', appeal: 3, walk: 1.3, run: 6, food: 'hay', herd: true, price: 900 },
  wildebeest: { name: 'Wildebeest', plural: 'Wildebeest', icon: '🐃', appeal: 2, walk: 1.3, run: 5.5, food: 'hay', herd: true, price: 700 },
  ostrich:    { name: 'Ostrich', plural: 'Ostriches', icon: '🪶', appeal: 2, walk: 1.5, run: 7, food: 'hay', price: 600 },
  giraffe:    { name: 'Giraffe', plural: 'Giraffes', icon: '🦒', appeal: 5, walk: 1.2, run: 4, food: 'hay', price: 2500 },
  impala:     { name: 'Impala', plural: 'Impala', icon: '🦌', appeal: 2, walk: 1.2, run: 7, food: 'hay', herd: true, price: 500 },
  rhino:      { name: 'White Rhino', plural: 'Rhinos', icon: '🦏', appeal: 5, walk: 1.0, run: 4, food: 'hay', wallow: true, price: 3500 },
  warthog:    { name: 'Warthog', plural: 'Warthogs', icon: '🐗', appeal: 2, walk: 1.1, run: 4.5, food: 'hay', wallow: true, price: 400 },
  elephant:   { name: 'Elephant', plural: 'Elephants', icon: '🐘', appeal: 6, walk: 1.1, run: 3.5, food: 'hay', wade: true, price: 5000 },
  hippo:      { name: 'Hippo', plural: 'Hippos', icon: '🦛', appeal: 5, walk: 0.9, run: 3, food: 'hay', swim: true, price: 4000 },
  crocodile:  { name: 'Crocodile', plural: 'Crocodiles', icon: '🐊', appeal: 4, walk: 0.5, run: 2, food: 'meat', swim: true, price: 3000 },
  lion:       { name: 'Lion', plural: 'Lions', icon: '🦁', appeal: 6, walk: 1.0, run: 6, food: 'meat', lazy: true, price: 5500 },
  cheetah:    { name: 'Cheetah', plural: 'Cheetahs', icon: '🐆', appeal: 5, walk: 1.2, run: 16, food: 'meat', sprinter: true, price: 4500 },
  tiger:      { name: 'Tiger', plural: 'Tigers', icon: '🐅', appeal: 6, walk: 1.1, run: 6, food: 'meat', lazy: true, price: 6000 },
  bear:       { name: 'Brown Bear', plural: 'Bears', icon: '🐻', appeal: 5, walk: 1.0, run: 5, food: 'meat', wade: true, price: 4500 },
};
const NAMES = ['Kito', 'Zuri', 'Amani', 'Jabari', 'Nia', 'Tumaini', 'Baraka', 'Imani', 'Sefu', 'Asha', 'Kamau', 'Dalia', 'Juma', 'Neema', 'Rafiki', 'Pendo', 'Moyo', 'Tatu', 'Bahati', 'Faraji', 'Hodari', 'Kesi', 'Malaika', 'Nuru', 'Shani', 'Taji', 'Wanjiru', 'Zawadi', 'Duma', 'Simba', 'Rocky', 'Pebble', 'Bramble', 'Sunny', 'Mabel', 'Otis', 'Hugo', 'Luna', 'Willow', 'Biscuit', 'Maple', 'Ziggy', 'Gus', 'Daisy', 'Raja', 'Indira', 'Kodiak', 'Juniper', 'Maya', 'Nala'];
export function randomName(R = Math.random){ return NAMES[Math.floor(R() * NAMES.length)]; }

// ---------- building a quadruped ----------
// p: the shape (all in metres; the animal faces +z, the ground is y = 0)
function quadruped(kind, p, R){
  const skin = new THREE.MeshStandardMaterial({ map: coat(p.coat || kind), roughness: p.rough ?? 0.85 });
  const legM = new THREE.MeshStandardMaterial({ map: coat(p.coat || kind, true), roughness: p.rough ?? 0.85 });
  const L = p.L, uvs = 1 / L;
  const yc = p.H - p.ry;                     // body centre height at the shoulder
  const yr = yc - (p.slope || 0);            // ... and at the rump
  const yAt = (z) => lerp(yr, yc, (z / L) + 0.5);
  const secs = [
    [-0.5, 0.42, 0.5, 0], [-0.44, 0.85, 0.88, 0], [-0.3, 1, 1, 0], [-0.05, 1, p.belly ?? 1.02, 0], [0.18, 0.98, 1, 0], [0.34, 0.9, 1, p.hump || 0], [0.46, 0.62, 0.72, (p.hump || 0) * 0.5], [0.5, 0.36, 0.42, 0],
  ].map(([f, kx, ky, up]) => ({ p: [0, yAt(f * L) + up * p.ry, f * L], rx: p.rx * kx, ry: p.ry * ky, top: 0.06, bottom: 0.08 }));
  const geos = { skin: [], leg: [], horn: [], dark: [], eye: [], extra: [] };
  geos.skin.push(loft(secs, { ring: 18, steps: 4, uvScale: uvs }));
  // neck + head live in one group that pivots at the base of the neck
  const neck = new THREE.Group();
  const nb = V(0, yc + p.ry * (p.neckUp ?? 0.35), L * 0.5 - p.rx * 0.5);
  neck.position.copy(nb);
  const na = p.neckAngle, nl = p.neckLen;
  const nd = V(0, Math.sin(na), Math.cos(na));
  const nsec = [];
  for (let i = 0; i <= 3; i++){
    const t = i / 3, q = nd.clone().multiplyScalar(lerp(-p.nr0 * 0.6, nl, t));
    nsec.push({ p: [0, q.y, q.z], rx: lerp(p.nr0, p.nr1, t) * 0.85, ry: lerp(p.nr0 * 1.1, p.nr1, t) });
  }
  const ngeos = { skin: [loft(nsec, { ring: 14, steps: 3, uvScale: uvs, capStart: false, v0: 0.85 })], leg: [], horn: [], dark: [], eye: [], extra: [] };
  // the head: a loft from the back of the skull to the muzzle, pitched down by headDrop
  const headPos = nd.clone().multiplyScalar(nl);
  const hd = p.headDrop ?? 0.9, hl = p.headLen, hr = p.headR;
  const hdir = V(0, -Math.sin(hd), Math.cos(hd));
  const H = (along, up = 0, side = 0) => headPos.clone().addScaledVector(hdir, along).add(V(side, 0, 0)).addScaledVector(V(0, Math.cos(hd), Math.sin(hd)), up);
  const hs = (p.headShape || [[-0.15, 1, 1], [0.15, 0.95, 1], [0.5, 0.75, 0.8], [0.85, 0.55, 0.6], [1, 0.45, 0.5]]).map(([f, kx, ky]) => { const q = H(f * hl); return { p: [0, q.y, q.z], rx: hr * kx * (p.headW || 0.8), ry: hr * ky }; });
  ngeos.skin.push(loft(hs, { ring: 14, steps: 3, uvScale: uvs, v0: 0.3 }));
  // eyes
  for (const sx of [-1, 1]){
    const e = ellipsoid(hr * 0.13, hr * 0.13, hr * 0.13, 8, 6), q = H(hl * (p.eyeAt ?? 0.2), hr * 0.35, sx * hr * (p.headW || 0.8) * 0.92);
    e.translate(q.x, q.y, q.z); ngeos.dark.push(e);
  }
  // ears
  if (p.ears){
    const [es, ek] = p.ears;
    for (const sx of [-1, 1]){
      const e = ek === 'round' ? ellipsoid(es * 0.5, es * 0.5, es * 0.18, 8, 6) : ellipsoid(es * 0.28, es * 0.6, es * 0.12, 8, 6);
      if (ek !== 'round'){ e.translate(0, es * 0.5, 0); e.rotateZ(-sx * 0.9); e.rotateX(-0.3); }
      const q = H(-hl * 0.02, hr * 0.75, sx * hr * 0.55); e.translate(q.x, q.y, q.z); ngeos.skin.push(e);
    }
  }
  // the mane along the top of the neck (zebra, giraffe, wildebeest)
  if (p.mane){
    const ms = []; for (let i = 0; i <= 3; i++){ const t = i / 3, q = nd.clone().multiplyScalar(lerp(0, nl * 0.95, t)).add(V(0, lerp(p.nr0, p.nr1, t) * 0.92, 0)); ms.push({ p: [0, q.y + p.mane[1] * 0.4, q.z - 0.02], rx: 0.025, ry: p.mane[1] }); }
    (p.mane[0] === 'dark' ? ngeos.dark : ngeos.skin).push(loft(ms, { ring: 6, steps: 2, uvScale: uvs }));
  }
  // legs: an upper and a lower part, with the foot
  const legs = [];
  for (const [front, z] of [[true, L * 0.5 - (p.legInF ?? 0.18) * L], [false, -L * 0.5 + (p.legInB ?? 0.16) * L]]){
    for (const sx of [-1, 1]){
      const top = (front ? yc : yr) - p.ry * 0.1, len = top;
      const a = len * (front ? 0.52 : 0.5), b = len - a;
      const hip = new THREE.Group(); hip.position.set(sx * p.rx * (p.legSpread ?? 0.62), top, z);
      const r0 = p.legR[0] * (front ? 1 : 1.12), r1 = p.legR[1], rk = lerp(r0, r1, 0.55);
      const up = new THREE.Mesh(limb(a + rk * 0.5, r0, rk, { seg: 8, uvScale: uvs * 2 }), legM); hip.add(up);
      const knee = new THREE.Group(); knee.position.y = -a; hip.add(knee);
      const lowerG = limb(b, rk, r1, { seg: 8, uvScale: uvs * 2, v0: a * uvs * 2 });
      if (p.foot === 'hoof' || p.foot === 'pad'){
        knee.add(new THREE.Mesh(lowerG, legM));
        const h = p.foot === 'hoof' ? new THREE.CylinderGeometry(r1 * 1.05, r1 * 1.25, r1 * 1.3, 8) : new THREE.CylinderGeometry(r1 * 1.08, r1 * 1.15, r1 * 0.5, 10);
        h.translate(0, -b + (p.foot === 'pad' ? r1 * 0.25 : r1 * 0.55), 0);
        knee.add(new THREE.Mesh(h, p.foot === 'pad' ? pmat(0x5a5450, 0.9) : pmat(0x2a2420, 0.6)));
      } else {
        const h = ellipsoid(r1 * 1.3, r1 * 0.9, r1 * 1.9, 8, 6); h.translate(0, -b + r1 * 0.7, r1 * 0.7);
        knee.add(new THREE.Mesh(mergeGeometries([withUV(lowerG), withUV(h)]), legM));
      }
      legs.push({ hip, knee, front, sx, len, a, b });
    }
  }
  // tail
  const tail = new THREE.Group(); tail.position.set(0, yr + p.ry * 0.55, -L * 0.5 + 0.02);
  if (p.tail){
    const [tl, tr, tuft] = p.tail;
    const tg = limb(tl, tr, tr * 0.45, { seg: 6, uvScale: uvs, v0: 0.02 }); tg.rotateX(p.tailUp ?? -0.25);
    const tparts = { skin: [tg], dark: [] };
    if (tuft){ const t = ellipsoid(tr * 1.6, tl * 0.18, tr * 1.6, 8, 6); t.translate(0, -tl, 0); t.rotateX(p.tailUp ?? -0.25); tparts.dark.push(t); }
    if (tparts.skin.length) tail.add(new THREE.Mesh(tparts.skin[0], skin));
    if (tparts.dark.length) tail.add(new THREE.Mesh(tparts.dark[0], pmat(tuft === true ? 0x1e1610 : tuft, 0.9)));
  }
  const m = { skin, legM, geos, ngeos, neck, legs, tail, headPos, hdir, H, nd, nl, hl, hr, yc, yr, L };
  if (p.extras) p.extras(m, R);
  // build the body and neck meshes, one per material
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const matFor = (k) => ({ skin, leg: legM, horn: pmat(p.hornColor ?? 0x8a7a68, 0.45), dark: pmat(p.darkColor ?? 0x1e1610, 0.9), eye: pmat(0x0a0806, 0.15), extra: p.extraMat || skin }[k]);
  const add = (into, gs) => { for (const [k, list] of Object.entries(gs)){ if (!list.length) continue; const mesh = new THREE.Mesh(mergeGeometries(list.map((g) => withUV(g))), matFor(k)); into.add(mesh); } };
  add(body, geos); add(neck, ngeos);
  body.add(neck, tail); for (const l of legs) body.add(l.hip);
  root.traverse((o) => { if (o.isMesh){ o.castShadow = true; o.receiveShadow = false; } });
  // how far the neck has to bow for the mouth to reach the grass
  const mouthRel = headPos.clone().addScaledVector(hdir, hl);
  const reach = nb.y + mouthRel.y;   // mouth height when standing
  const graze = clamp(p.graze ?? Math.atan2(reach - 0.15, Math.max(0.2, mouthRel.z)) * 0.9, 0, 1.6);
  return { root, body, neck, legs, tail, skin, legM, P: { ...p, hipY: yc, graze, eye: nb.y + headPos.y } };
}
function withUV(g){
  const ng = g.index ? g.toNonIndexed() : g;
  if (!ng.attributes.uv) ng.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(ng.attributes.position.count * 2), 2));
  if (!ng.attributes.normal) ng.computeVertexNormals();
  return ng;
}
// a horn: a curved tapered tube from `base` growing along `dir`, bending by `curl`
function horn(base, dir, len, r, curl = 0, curlAxis = V(1, 0, 0), seg = 5){
  const secs = []; const d = dir.clone().normalize(), q = new THREE.Quaternion(); let p = base.clone();
  for (let i = 0; i <= seg; i++){
    const t = i / seg; secs.push({ p: [p.x, p.y, p.z], rx: Math.max(0.004, r * (1 - t * 0.92)), ry: Math.max(0.004, r * (1 - t * 0.92)) });
    q.setFromAxisAngle(curlAxis, curl / seg); d.applyQuaternion(q); p = p.clone().addScaledVector(d, len / seg);
  }
  return tube(secs);
}
// a tube along any 3D path (sections with p, rx, ry), with its own frame
function tube(secs, ring = 7){
  const pos = [], idx = [], n = secs.length;
  const pts = secs.map((s) => V(...s.p));
  for (let j = 0; j < n; j++){
    const t = (j < n - 1 ? pts[j + 1].clone().sub(pts[j]) : pts[j].clone().sub(pts[j - 1])).normalize();
    let side = V(1, 0, 0); if (Math.abs(t.dot(side)) > 0.9) side = V(0, 0, 1);
    const up = V().crossVectors(t, side).normalize(); side.crossVectors(up, t).normalize();
    for (let i = 0; i <= ring; i++){ const a = (i / ring) * TAU; const q = pts[j].clone().addScaledVector(side, Math.cos(a) * secs[j].rx).addScaledVector(up, Math.sin(a) * secs[j].ry); pos.push(q.x, q.y, q.z); }
  }
  const R = ring + 1;
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < ring; i++){ const a = j * R + i, b = a + 1, c = a + R, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// ---------- the shapes ----------
const SHAPES = {
  zebra: { L: 1.65, H: 1.3, rx: 0.3, ry: 0.36, belly: 1.05, neckAngle: 0.95, neckLen: 0.72, nr0: 0.24, nr1: 0.14, headLen: 0.58, headR: 0.15, headDrop: 1.15, headW: 0.68, legR: [0.085, 0.04], foot: 'hoof', ears: [0.2, 'pointed'], mane: ['dark', 0.07], tail: [0.62, 0.035, true], tailUp: 0.1,
    headShape: [[-0.1, 1, 1], [0.2, 0.92, 0.95], [0.55, 0.62, 0.72], [0.9, 0.55, 0.62], [1, 0.48, 0.5]],
    extras(m){ const q = m.H(m.hl * 0.97); const g = ellipsoid(m.hr * 0.42, m.hr * 0.4, m.hr * 0.25, 8, 6); g.translate(q.x, q.y, q.z); m.ngeos.dark.push(g); } },
  wildebeest: { L: 1.6, H: 1.32, rx: 0.3, ry: 0.38, hump: 0.15, slope: 0.2, neckAngle: 0.7, neckLen: 0.55, nr0: 0.27, nr1: 0.17, headLen: 0.6, headR: 0.15, headDrop: 1.35, headW: 0.75, legR: [0.08, 0.035], foot: 'hoof', ears: [0.16, 'pointed'], mane: ['dark', 0.1], tail: [0.6, 0.03, true], tailUp: 0.15, darkColor: 0x1a1816,
    extras(m){
      for (const sx of [-1, 1]){ const b = m.H(-0.02, m.hr * 0.9, sx * m.hr * 0.4); m.ngeos.horn.push(horn(b, V(sx, -0.25, 0.1), 0.38, 0.045, -sx * 2.2, V(0, 0, 1), 6)); }
      const q = m.H(m.hl * 0.4, -m.hr * 0.9); const beard = new THREE.ConeGeometry(0.06, 0.32, 6); beard.rotateX(Math.PI); beard.translate(q.x, q.y - 0.12, q.z); m.ngeos.dark.push(beard);
    } },
  giraffe: { L: 1.9, H: 2.55, rx: 0.4, ry: 0.42, slope: 0.55, neckAngle: 1.15, neckLen: 2.1, nr0: 0.3, nr1: 0.11, neckUp: 0.2, headLen: 0.6, headR: 0.13, headDrop: 1.5, headW: 0.75, legR: [0.11, 0.05], foot: 'hoof', ears: [0.18, 'pointed'], mane: ['skin', 0.06], tail: [0.95, 0.03, true], tailUp: 0.05, graze: 0.15, legInF: 0.12, legInB: 0.12,
    extras(m){ for (const sx of [-1, 1]){ const b = m.H(0.02, m.hr * 0.9, sx * m.hr * 0.4); const o = new THREE.CylinderGeometry(0.03, 0.035, 0.18, 6); o.translate(0, 0.09, 0); o.rotateZ(-sx * 0.2); o.translate(b.x, b.y, b.z); m.ngeos.dark.push(o); const k = ellipsoid(0.045, 0.045, 0.045, 6, 5); k.translate(b.x - sx * 0.035, b.y + 0.18, b.z); m.ngeos.dark.push(k); } },
    darkColor: 0x3a2a1a },
  impala: { L: 1.1, H: 0.95, rx: 0.2, ry: 0.24, neckAngle: 0.95, neckLen: 0.42, nr0: 0.14, nr1: 0.08, headLen: 0.3, headR: 0.085, headDrop: 1.1, headW: 0.75, legR: [0.05, 0.02], foot: 'hoof', ears: [0.14, 'pointed'], tail: [0.25, 0.025, 0x1a1410], tailUp: 0.3,
    extras(m, R){ if (R() < 0.5) for (const sx of [-1, 1]){ const b = m.H(0.02, m.hr * 0.9, sx * m.hr * 0.35); m.ngeos.horn.push(horn(b, V(sx * 0.35, 1, -0.5), 0.5, 0.025, 0.9, V(1, 0, 0), 6)); } },
    hornColor: 0x3a3028 },
  rhino: { L: 2.6, H: 1.65, rx: 0.62, ry: 0.62, hump: 0.12, slope: 0.08, belly: 1.08, neckAngle: 0.05, neckLen: 0.35, nr0: 0.5, nr1: 0.38, neckUp: 0.05, headLen: 0.85, headR: 0.32, headDrop: 0.75, headW: 0.85, legR: [0.2, 0.13], foot: 'pad', ears: [0.22, 'pointed'], tail: [0.45, 0.04, true], tailUp: 0.1, rough: 0.9, graze: 0.75,
    headShape: [[-0.15, 1, 1], [0.2, 0.95, 0.95], [0.55, 0.82, 0.78], [0.85, 0.75, 0.62], [1, 0.62, 0.5]],
    extras(m){ const a = m.H(m.hl * 0.9, m.hr * 0.45); m.ngeos.horn.push(horn(a, V(0, 1, 0.45), 0.55, 0.11, -0.5, V(1, 0, 0), 5)); const b = m.H(m.hl * 0.62, m.hr * 0.68); m.ngeos.horn.push(horn(b, V(0, 1, 0.1), 0.24, 0.08, -0.2, V(1, 0, 0), 4)); },
    hornColor: 0x6a6258 },
  warthog: { L: 0.95, H: 0.72, rx: 0.24, ry: 0.27, hump: 0.08, slope: 0.08, neckAngle: 0.1, neckLen: 0.15, nr0: 0.2, nr1: 0.18, neckUp: 0.2, headLen: 0.45, headR: 0.15, headDrop: 0.9, headW: 0.85, legR: [0.06, 0.03], foot: 'hoof', ears: [0.12, 'pointed'], mane: ['dark', 0.08], tail: [0.35, 0.015, true], tailUp: -2.6, graze: 0.8,
    extras(m){ for (const sx of [-1, 1]){ const b = m.H(m.hl * 0.82, -m.hr * 0.1, sx * m.hr * 0.4); m.ngeos.horn.push(horn(b, V(sx * 0.5, 0.4, 0.3), 0.2, 0.025, -sx * 2, V(0, 0, 1), 5)); const w = ellipsoid(0.04, 0.03, 0.04, 6, 5); const q = m.H(m.hl * 0.55, m.hr * 0.1, sx * m.hr * 0.7); w.translate(q.x, q.y, q.z); m.ngeos.skin.push(w); } },
    hornColor: 0xe8dcc0 },
  elephant: { L: 3.2, H: 3.0, rx: 0.85, ry: 0.95, belly: 1.06, slope: 0.25, neckAngle: 0.35, neckLen: 0.35, nr0: 0.75, nr1: 0.68, neckUp: 0.1, headLen: 0.75, headR: 0.62, headDrop: 0.9, headW: 0.9, legR: [0.3, 0.24], foot: 'pad', tail: [1.0, 0.05, true], tailUp: 0.05, rough: 0.95, graze: 0.35, legInF: 0.15, legInB: 0.15,
    headShape: [[-0.2, 0.9, 0.9], [0.1, 1, 1.05], [0.5, 0.92, 0.95], [0.85, 0.6, 0.65], [1, 0.42, 0.45]],
    extras(m){
      // the trunk hangs from the end of the face and curls a little forward at the tip
      const secs = []; const s0 = m.H(m.hl * 0.95, -m.hr * 0.05);
      for (let i = 0; i <= 8; i++){ const t = i / 8; secs.push({ p: [0, s0.y - t * 1.6 + Math.max(0, t - 0.8) * 1.2, s0.z + t * 0.25 + Math.max(0, t - 0.75) * 0.6], rx: lerp(0.2, 0.07, t), ry: lerp(0.2, 0.07, t) }); }
      const tr = tube(secs, 10); m.ngeos.skin.push(tr);
      // big ears that hang down beside the head
      for (const sx of [-1, 1]){ const e = ellipsoid(0.08, 0.75, 0.6, 12, 8); const pa = e.attributes.position; for (let i = 0; i < pa.count; i++){ const y = pa.getY(i); pa.setY(i, y - Math.max(0, -y) * 0.3); } const q = m.H(-m.hl * 0.05, m.hr * 0.1, sx * m.hr * 0.95); e.rotateY(sx * -0.5); e.translate(q.x + sx * 0.2, q.y - 0.25, q.z - 0.3); m.ngeos.skin.push(e); }
      // tusks
      for (const sx of [-1, 1]){ const b = m.H(m.hl * 0.85, -m.hr * 0.45, sx * m.hr * 0.35); m.ngeos.horn.push(horn(b, V(sx * 0.1, -0.7, 0.7), 0.75, 0.065, -1.3, V(1, 0, 0), 6)); }
    }, hornColor: 0xeee4cc },
  hippo: { L: 2.5, H: 1.45, rx: 0.68, ry: 0.62, belly: 1.12, neckAngle: 0.1, neckLen: 0.2, nr0: 0.58, nr1: 0.55, neckUp: 0.1, headLen: 0.9, headR: 0.42, headDrop: 0.35, headW: 0.95, legR: [0.2, 0.15], foot: 'pad', ears: [0.12, 'round'], tail: [0.3, 0.06, false], tailUp: 0.2, rough: 0.5, graze: 0.55, legInF: 0.16, legInB: 0.15,
    headShape: [[-0.15, 1, 1], [0.2, 0.85, 0.9], [0.55, 0.78, 0.72], [0.85, 0.95, 0.78], [1, 0.8, 0.6]],
    extras(m){ for (const sx of [-1, 1]){ const n = ellipsoid(0.07, 0.06, 0.07, 6, 5); const q = m.H(m.hl * 0.92, m.hr * 0.55, sx * m.hr * 0.4); n.translate(q.x, q.y, q.z); m.ngeos.skin.push(n); const e = ellipsoid(0.09, 0.08, 0.09, 8, 6); const r = m.H(m.hl * 0.18, m.hr * 0.8, sx * m.hr * 0.6); e.translate(r.x, r.y, r.z); m.ngeos.skin.push(e); } } },
  lion: { L: 1.7, H: 1.1, rx: 0.3, ry: 0.32, belly: 0.92, neckAngle: 0.45, neckLen: 0.35, nr0: 0.26, nr1: 0.22, headLen: 0.45, headR: 0.2, headDrop: 0.55, headW: 0.9, legR: [0.1, 0.06], foot: 'paw', ears: [0.12, 'round'], tail: [0.95, 0.035, true], tailUp: 0.45, graze: 0.5,
    headShape: [[-0.15, 1, 1], [0.2, 1, 1], [0.55, 0.78, 0.75], [0.85, 0.65, 0.62], [1, 0.55, 0.48]],
    extras(m, R){
      const q = m.H(m.hl * 0.98, -m.hr * 0.05); const n = ellipsoid(m.hr * 0.25, m.hr * 0.18, m.hr * 0.15, 8, 6); n.translate(q.x, q.y, q.z); m.ngeos.dark.push(n);
      if (m.male){
        // a big shaggy mane round the head and neck
        const mane = ellipsoid(0.42, 0.5, 0.42, 14, 10); const pa = mane.attributes.position;
        for (let i = 0; i < pa.count; i++){ const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i); const k = 1 + (vnoise(x * 12 + 3, y * 12 + z * 9, 8) - 0.5) * 0.5; pa.setXYZ(i, x * k, y * k, z * k); }
        mane.computeVertexNormals(); const c = m.H(-0.05, 0.02); mane.translate(c.x, c.y - 0.05, c.z - 0.12); m.ngeos.extra.push(mane);
      }
    }, darkColor: 0x2a1a12 },
  cheetah: { L: 1.25, H: 0.85, rx: 0.19, ry: 0.24, belly: 0.82, neckAngle: 0.5, neckLen: 0.3, nr0: 0.15, nr1: 0.12, headLen: 0.26, headR: 0.12, headDrop: 0.5, headW: 0.9, legR: [0.065, 0.03], foot: 'paw', ears: [0.08, 'round'], tail: [0.75, 0.03, false], tailUp: 0.6, graze: 0.45,
    headShape: [[-0.15, 1, 1], [0.25, 1, 1], [0.6, 0.75, 0.75], [0.9, 0.6, 0.62], [1, 0.5, 0.48]],
    extras(m){ for (const sx of [-1, 1]){ const t = new THREE.CylinderGeometry(0.008, 0.008, 0.14, 4); const q = m.H(m.hl * 0.55, m.hr * 0.05, sx * m.hr * 0.55); t.rotateX(0.4); t.translate(q.x, q.y, q.z); m.ngeos.dark.push(t); } const q = m.H(m.hl * 0.98); const n = ellipsoid(0.03, 0.025, 0.02, 6, 5); n.translate(q.x, q.y, q.z); m.ngeos.dark.push(n); } },
  tiger: { L: 1.9, H: 1.05, rx: 0.32, ry: 0.33, belly: 0.95, neckAngle: 0.35, neckLen: 0.35, nr0: 0.28, nr1: 0.24, headLen: 0.42, headR: 0.22, headDrop: 0.5, headW: 0.95, legR: [0.11, 0.065], foot: 'paw', ears: [0.12, 'round'], tail: [1.0, 0.04, false], tailUp: 0.5, graze: 0.5,
    headShape: [[-0.15, 1, 1], [0.2, 1.05, 1], [0.55, 0.8, 0.78], [0.85, 0.65, 0.62], [1, 0.55, 0.48]],
    extras(m){ for (const sx of [-1, 1]){ const c = ellipsoid(0.1, 0.11, 0.12, 8, 6); const q = m.H(m.hl * 0.45, -m.hr * 0.25, sx * m.hr * 0.55); c.translate(q.x, q.y, q.z); m.ngeos.extra.push(c); } const q = m.H(m.hl * 0.98); const n = ellipsoid(0.05, 0.035, 0.03, 6, 5); n.translate(q.x, q.y, q.z); m.ngeos.dark.push(n); },
    extraMat: pmat(0xf0ece0, 0.9) },
  bear: { L: 1.7, H: 1.25, rx: 0.42, ry: 0.42, hump: 0.2, slope: 0.1, belly: 1.0, neckAngle: 0.15, neckLen: 0.35, nr0: 0.32, nr1: 0.27, headLen: 0.48, headR: 0.24, headDrop: 0.55, headW: 0.95, legR: [0.15, 0.1], foot: 'paw', ears: [0.12, 'round'], tail: [0.12, 0.05, false], tailUp: 0.5, graze: 0.65, rough: 1,
    headShape: [[-0.15, 1, 1], [0.2, 1.05, 1.0], [0.55, 0.7, 0.7], [0.85, 0.5, 0.5], [1, 0.4, 0.4]],
    extras(m){ const q = m.H(m.hl * 0.98); const n = ellipsoid(0.07, 0.05, 0.05, 6, 5); n.translate(q.x, q.y, q.z); m.ngeos.dark.push(n); }, darkColor: 0x1a1210 },
};
SHAPES.lion.coat = 'lion';

// the ostrich: two long legs, a feathery body, a long bare neck
function ostrich(R){
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const feather = new THREE.MeshStandardMaterial({ map: coat('ostrich'), roughness: 1 });
  const skinM = pmat(0xc8a8a0, 0.7), white = pmat(0xf0ece4, 0.95);
  const male = R() < 0.5;
  const fm = male ? feather : new THREE.MeshStandardMaterial({ color: 0x6a5a48, roughness: 1, map: coat('ostrich') });
  const b = new THREE.Mesh(ellipsoid(0.42, 0.38, 0.6, 14, 10), fm); b.position.y = 1.25; body.add(b);
  const tl = new THREE.Mesh(ellipsoid(0.32, 0.25, 0.25, 10, 8), male ? white : fm); tl.position.set(0, 1.35, -0.55); body.add(tl);
  for (const sx of [-1, 1]){ const w = new THREE.Mesh(ellipsoid(0.08, 0.28, 0.45, 8, 6), fm); w.position.set(sx * 0.4, 1.28, -0.05); body.add(w); const wt = new THREE.Mesh(ellipsoid(0.05, 0.12, 0.15, 6, 5), white); wt.position.set(sx * 0.44, 1.2, -0.42); body.add(wt); }
  const neck = new THREE.Group(); neck.position.set(0, 1.45, 0.45); body.add(neck);
  const ng = [];
  for (let i = 0; i <= 4; i++){ const t = i / 4; ng.push({ p: [0, t * 0.95, Math.sin(t * 1.4) * 0.18], rx: lerp(0.09, 0.04, t), ry: lerp(0.09, 0.04, t) }); }
  neck.add(new THREE.Mesh(loft(ng, { ring: 10, steps: 3 }), skinM));
  const head = new THREE.Mesh(ellipsoid(0.07, 0.065, 0.09, 10, 8), skinM); head.position.set(0, 0.98, 0.22); neck.add(head);
  const beak = new THREE.Mesh(ellipsoid(0.04, 0.025, 0.08, 8, 6), pmat(0xd8b898, 0.6)); beak.position.set(0, 0.96, 0.32); neck.add(beak);
  for (const sx of [-1, 1]){ const e = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), pmat(0x0a0806, 0.15)); e.position.set(sx * 0.055, 1.0, 0.24); neck.add(e); }
  const legs = [];
  for (const sx of [-1, 1]){
    const hip = new THREE.Group(); hip.position.set(sx * 0.18, 1.15, 0.05); body.add(hip);
    hip.add(new THREE.Mesh(limb(0.5, 0.11, 0.06), skinM));
    const knee = new THREE.Group(); knee.position.y = -0.5; hip.add(knee);
    knee.add(new THREE.Mesh(limb(0.62, 0.05, 0.035), skinM));
    const toe = new THREE.Mesh(ellipsoid(0.05, 0.03, 0.11, 6, 5), skinM); toe.position.set(0, -0.62, 0.06); knee.add(toe);
    legs.push({ hip, knee, front: sx < 0, sx, len: 1.15, a: 0.5, b: 0.62, biped: true });
  }
  const tail = new THREE.Group();
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { root, body, neck, legs, tail, skin: fm, legM: skinM, P: { hipY: 1.15, graze: 1.9, eye: 2.4, biped: true, L: 1.2 } };
}

// the crocodile: long and low, with a heavy tail and sprawled legs
function crocodile(R){
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const skin = new THREE.MeshStandardMaterial({ map: coat('croc'), roughness: 0.7 });
  const legM = new THREE.MeshStandardMaterial({ map: coat('croc', true), roughness: 0.7 });
  const L = 3.6, uvs = 1 / L, y = 0.32;
  const s = [[-1.8, 0.02, 0.02], [-1.2, 0.09, 0.07], [-0.5, 0.2, 0.14], [0, 0.32, 0.2], [0.5, 0.36, 0.22], [0.9, 0.3, 0.18], [1.15, 0.2, 0.13], [1.3, 0.17, 0.11], [1.7, 0.12, 0.07], [1.95, 0.08, 0.05]];
  const secs = s.map(([z, rx, ry]) => ({ p: [0, y + (z > 1.1 ? 0.02 : 0), z], rx, ry, top: 0.3, bottom: 0.4 }));
  body.add(new THREE.Mesh(loft(secs, { ring: 14, steps: 3, uvScale: uvs }), skin));
  for (const sx of [-1, 1]){ const e = new THREE.Mesh(ellipsoid(0.04, 0.035, 0.05, 8, 6), pmat(0x6a7a20, 0.2)); e.position.set(sx * 0.1, y + 0.13, 1.2); body.add(e); }
  // teeth along the jaw
  for (let i = 0; i < 9; i++) for (const sx of [-1, 1]){ const t = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.04, 4), pmat(0xf0ecd8, 0.4)); t.rotation.x = Math.PI; t.position.set(sx * lerp(0.15, 0.07, i / 8), y - 0.04, 1.25 + i * 0.08); body.add(t); }
  const legs = [];
  for (const [front, z] of [[true, 0.75], [false, -0.25]]) for (const sx of [-1, 1]){
    const hip = new THREE.Group(); hip.position.set(sx * 0.28, y, z); hip.rotation.z = sx * 1.0; body.add(hip);
    hip.add(new THREE.Mesh(limb(0.22, 0.07, 0.05), legM));
    const knee = new THREE.Group(); knee.position.y = -0.22; knee.rotation.z = -sx * 1.0; hip.add(knee);
    knee.add(new THREE.Mesh(limb(0.16, 0.05, 0.04), legM));
    const f = new THREE.Mesh(ellipsoid(0.07, 0.025, 0.09, 6, 5), legM); f.position.set(0, -0.17, 0.04); knee.add(f);
    legs.push({ hip, knee, front, sx, len: 0.3, a: 0.22, b: 0.16, sprawl: true });
  }
  const neck = new THREE.Group(), tail = new THREE.Group();
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { root, body, neck, legs, tail, skin, legM, P: { hipY: y, graze: 0, eye: 0.5, L } };
}

export function buildAnimal(kind, R = Math.random){
  if (kind === 'ostrich') return ostrich(R);
  if (kind === 'crocodile') return crocodile(R);
  const shape = { ...SHAPES[kind] };
  const male = R() < (kind === 'lion' ? 0.35 : 0.5);
  // a little variety in size
  const k = 0.88 + R() * 0.22;
  for (const key of ['L', 'H', 'rx', 'ry', 'neckLen', 'nr0', 'nr1', 'headLen', 'headR', 'slope', 'hump']) if (shape[key]) shape[key] *= k;
  shape.legR = shape.legR.map((v) => v * k);
  if (shape.tail) shape.tail = [shape.tail[0] * k, shape.tail[1] * k, shape.tail[2]];
  const ex = shape.extras;
  shape.extras = ex ? (m, r) => { m.male = male; ex(m, r); } : null;
  const m = quadruped(kind, shape, R);
  m.male = male;
  return m;
}

// ---------- an animal living in its enclosure ----------
let nextId = 1;
export class Animal {
  constructor(world, kind, zone, data = {}){
    this.world = world; this.kind = kind; this.zone = zone; this.S = SPECIES[kind];
    const seed = data.seed || Math.floor(Math.random() * 1e9);
    const R = rng(seed);
    this.data = { id: data.id || ('a' + Date.now().toString(36) + (nextId++)), kind, name: data.name || randomName(R), seed, health: 100, sick: false, dirt: R() * 20, hunger: R() * 30, ...data };
    this.m = buildAnimal(kind, R);
    this.root = this.m.root; this.root.userData.animal = this;
    this.root.traverse((o) => { o.userData.animal = this; });
    this.pos = world.randomSpot(zone, R, { wet: this.S.swim && R() < 0.6 }); this.yaw = R() * TAU;
    this.target = null; this.state = 'idle'; this.wait = R() * 4; this.t = R() * 10; this.phase = R();
    this.speed = 0; this.lie = 0; this.lookYaw = 0; this.neckPitch = 0; this.dungT = 30 + R() * 60;
    this.sickIcon = null; this.visible = true; this.inWater = null; this.cleanT = 0;
    this.root.position.copy(this.pos);
    this.baseColor = this.m.skin.color.clone();
  }
  get name(){ return this.data.name; }
  // dirt and illness show on the coat
  tint(){
    const d = clamp(this.data.dirt / 100), c = this.m.skin.color;
    c.setRGB(lerp(1, 0.62, d), lerp(1, 0.5, d), lerp(1, 0.38, d));
    if (this.data.sick) c.multiply(new THREE.Color(0.92, 0.98, 0.86));
    this.m.legM.color.copy(c);
  }
  // ctx: { dt, world, feeder: { pos, food }, vehicles: [positions], cam: position, onDung, onEat, time }
  update(dt, ctx){
    const D = this.data, S = this.S, W = this.world;
    this.t += dt;
    // needs change slowly
    D.hunger = Math.min(100, D.hunger + dt * 0.11);
    D.dirt = Math.min(100, D.dirt + dt * (S.wallow || S.wade ? 0.05 : 0.032) * (this.state === 'wallow' ? 6 : 1));
    if (D.sick) D.health = Math.max(5, D.health - dt * 0.12); else D.health = Math.min(100, D.health + dt * 0.3);
    const far = ctx.cam ? this.pos.distanceToSquared(ctx.cam) > 260 * 260 : false;
    // choosing what to do next
    this.wait -= dt;
    if (!this.target && this.wait <= 0) this.choose(ctx);
    // moving
    let moving = false, sp = 0;
    if (this.target){
      const dx = this.target.x - this.pos.x, dz = this.target.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d < (this.state === 'run' ? 1.5 : 0.4)){ this.arrive(); }
      else {
        this.lie = Math.max(0, this.lie - dt * 0.8);
        if (this.lie <= 0.05){
          const want = Math.atan2(dx, dz), turn = angleDiff(this.yaw, want);
          this.yaw += clamp(turn, -dt * 1.6, dt * 1.6);
          sp = (this.state === 'run' ? S.run : S.walk) * (D.sick ? 0.45 : 1) * (Math.abs(turn) < 0.7 ? 1 : 0.25);
          // stop for a truck that's right in front
          for (const v of ctx.vehicles){ const vx = v.x - this.pos.x, vz = v.z - this.pos.z; if (vx * vx + vz * vz < 25 && (vx * Math.sin(this.yaw) + vz * Math.cos(this.yaw)) > 0) sp = 0; }
          this.pos.x += Math.sin(this.yaw) * sp * dt; this.pos.z += Math.cos(this.yaw) * sp * dt; moving = sp > 0.05;
          this.timeout = (this.timeout || 0) + dt;
          if (this.timeout > 70){ this.target = null; this.wait = 1; }
        }
      }
    }
    W.keepIn(this.zone, this.pos, 1.5);
    // in the water?
    const pond = W.inWater(this.pos.x, this.pos.z); this.inWater = pond;
    if (pond && !S.swim && !S.wade && !(S.wallow && pond.mud) && this.state !== 'drink'){ // step back out
      const ax = this.pos.x - pond.x, az = this.pos.z - pond.z, l = Math.hypot(ax, az) || 1; this.pos.x = pond.x + ax / l * pond.r; this.pos.z = pond.z + az / l * pond.r;
    }
    // doing things where it is
    if (!moving && this.target == null){
      if (this.state === 'eat' && ctx.feeder && ctx.feeder.food > 0){ const e = Math.min(ctx.feeder.food, dt * 0.004); ctx.feeder.food -= e; D.hunger = Math.max(0, D.hunger - dt * 4); }
      if (this.state === 'wallow') D.dirt = Math.min(100, D.dirt + dt * 0.4);
    }
    // dung
    this.dungT -= dt * (this.state === 'eat' ? 3 : 1);
    if (this.dungT <= 0){ this.dungT = 120 + Math.random() * 120; if (!pond && ctx.onDung) ctx.onDung(this, this.pos.clone().addScaledVector(V(Math.sin(this.yaw), 0, Math.cos(this.yaw)), -(this.m.P.L || 1) * 0.6)); }
    this.moving = moving; this.speed = sp;
    this.visible = !far;
    this.root.visible = !far;
    if (far) return;
    this.pose(dt, ctx, moving, sp, pond);
  }
  choose(ctx){
    const D = this.data, S = this.S, W = this.world, r = Math.random();
    this.timeout = 0;
    // never settle down on the road
    if (Math.abs(W.polar(this.pos.x, this.pos.z).lat) < 6){ this.target = W.randomSpot(this.zone); this.state = 'walk'; return; }
    const restChance = D.sick ? 0.65 : S.lazy ? 0.4 : S.swim ? 0.1 : 0.14;
    if (D.hunger > 45 && ctx.feeder && ctx.feeder.food > 0.02 && r < 0.75){
      const a = Math.random() * TAU, d = this.kind === 'giraffe' ? 1.6 : 2.0 + (this.m.P.L || 1) * 0.6;
      this.target = ctx.feeder.pos.clone().add(V(Math.cos(a) * d, 0, Math.sin(a) * d)); this.state = 'eat'; return;
    }
    if (S.swim && r < (this.kind === 'hippo' ? 0.55 : 0.4)){ this.target = W.randomSpot(this.zone, Math.random, { wet: true }); this.state = 'swim'; return; }
    if (r < restChance){ this.target = null; this.state = 'rest'; this.wait = 20 + Math.random() * 40; return; }
    if (S.wallow && r < restChance + 0.12){ const mud = W.ponds.find((p) => p.zone === this.zone); if (mud){ const a = Math.random() * TAU, d = Math.random() * mud.r * 0.7; this.target = V(mud.x + Math.cos(a) * d, 0, mud.z + Math.sin(a) * d); this.state = 'wallow'; return; } }
    if (r < restChance + 0.2){ const pond = W.ponds.find((p) => p.zone === this.zone); if (pond){ const a = Math.random() * TAU, d = pond.r + 0.8; this.target = V(pond.x + Math.cos(a) * d, 0, pond.z + Math.sin(a) * d); this.state = 'drink'; return; } }
    if (S.sprinter && !D.sick && r > 0.9){ this.target = W.randomSpot(this.zone, Math.random, { margin: 8 }); this.state = 'run'; return; }
    if (S.herd && r > 0.94){ this.target = W.randomSpot(this.zone); this.state = 'run'; return; }
    // wander: often somewhere the visitors can see from the road
    this.target = W.randomSpot(this.zone, Math.random, { nearRoad: Math.random() < 0.45 }); this.state = 'walk';
  }
  arrive(){
    this.target = null;
    const st = this.state;
    if (st === 'eat'){ this.wait = 10 + Math.random() * 12; }
    else if (st === 'drink'){ this.wait = 6 + Math.random() * 6; }
    else if (st === 'swim'){ this.wait = 20 + Math.random() * 40; }
    else if (st === 'wallow'){ this.wait = 15 + Math.random() * 15; }
    else { this.state = Math.random() < 0.6 ? 'graze' : 'idle'; this.wait = 4 + Math.random() * 10; }
  }
  pose(dt, ctx, moving, sp, pond){
    const m = this.m, W = this.world, P = m.P, D = this.data;
    // lying down (resting, poorly, or a croc basking)
    const lying = !moving && !this.target && (this.state === 'rest' || (D.sick && this.state !== 'eat'));
    this.lie = clamp(this.lie + (lying ? dt * 0.6 : -dt * 0.9));
    // the gait: legs swing with a four-beat walk, or a gallop when running
    const freq = sp > 0 ? sp / Math.max(0.5, (P.hipY || 1) * (this.state === 'run' ? 2.6 : 1.1)) : 0;
    this.phase += dt * freq;
    const run = this.state === 'run' && sp > 2;
    const amp = moving ? (run ? 0.75 : 0.42) : 0;
    const offs = P.biped ? [0, 0.5] : run ? [0, 0.1, 0.55, 0.65] : [0, 0.5, 0.25, 0.75];
    m.legs.forEach((l, i) => {
      const ph = (this.phase + offs[i % offs.length]) * TAU;
      const sw = Math.sin(ph) * amp;
      if (l.sprawl){ l.hip.rotation.y = sw * 0.8 * l.sx; return; }
      let knee = Math.max(0, Math.cos(ph)) * amp * 1.4;
      let hip = sw;
      // folded up when lying down
      const fold = smooth(this.lie);
      if (P.biped){ hip = lerp(hip, -1.2, fold); knee = lerp(knee, 2.4, fold); l.hip.rotation.x = hip; l.knee.rotation.x = knee; return; }
      if (l.front){ hip = lerp(hip, -0.25, fold); knee = lerp(knee, 2.5, fold); l.hip.rotation.x = hip; l.knee.rotation.x = knee; }
      else { hip = lerp(-hip, -1.2, fold); knee = lerp(-knee * 0.8, 2.0, fold); l.hip.rotation.x = hip; l.knee.rotation.x = knee; }
      l.hip.rotation.z = fold * l.sx * 0.25;
    });
    // height on the ground, bobbing as it walks; sunk low when lying down; floating in the water
    const fwd = V(Math.sin(this.yaw), 0, Math.cos(this.yaw)), half = (P.L || 1.5) * 0.45;
    const hF = W.height(this.pos.x + fwd.x * half, this.pos.z + fwd.z * half), hB = W.height(this.pos.x - fwd.x * half, this.pos.z - fwd.z * half);
    let y = (hF + hB) / 2;
    let pitch = Math.atan2(hB - hF, half * 2) * 0.8;
    const bob = moving ? Math.abs(Math.sin(this.phase * TAU * (run ? 1 : 2))) * (run ? 0.06 : 0.025) * (P.hipY || 1) : 0;
    let sink = smooth(this.lie) * (P.hipY || 1) * (P.biped ? 0.72 : 0.68);
    if (pond && !pond.mud && (this.S.swim || this.S.wade)){
      const depth = pond.level - y;
      if (this.kind === 'hippo'){ y = Math.max(y, pond.level - (P.hipY || 1) * 1.05 - 0.15 + Math.sin(this.t * 0.7) * 0.05); pitch = 0; }
      else if (this.kind === 'crocodile'){ y = Math.max(y, pond.level - 0.32); pitch = 0; }
      else if (depth > 0) y = y; // wading: walks along the bottom
    }
    if (pond && pond.mud) y -= 0.25;
    m.body.position.y = bob - sink;
    this.root.position.set(this.pos.x, y, this.pos.z);
    this.root.rotation.set(0, this.yaw, 0);
    m.body.rotation.x = pitch;
    // the neck: down to graze, eat or drink; up and round to look at trucks going by
    let want = 0;
    if (!moving && !this.target){
      if (this.state === 'graze' || this.state === 'drink' || (this.state === 'eat' && this.kind !== 'giraffe')) want = P.graze * (0.75 + 0.25 * Math.sin(this.t * 0.8));
      if (this.state === 'eat' && this.kind === 'giraffe') want = -0.2;
      if (this.state === 'rest') want = P.biped ? 0.3 : 0.15;
      if (D.sick) want = Math.max(want, 0.35);
    }
    // look at the nearest vehicle
    let look = 0;
    if (ctx.vehicles.length && !(want > 0.5)){
      let best = 400, bv = null;
      for (const v of ctx.vehicles){ const d = (v.x - this.pos.x) ** 2 + (v.z - this.pos.z) ** 2; if (d < best){ best = d; bv = v; } }
      if (bv) look = clamp(angleDiff(this.yaw, Math.atan2(bv.x - this.pos.x, bv.z - this.pos.z)), -1, 1);
    }
    this.neckPitch = damp(this.neckPitch, want, 3, dt);
    this.lookYaw = damp(this.lookYaw, look, 2, dt);
    m.neck.rotation.set(this.neckPitch, this.lookYaw * 0.8, 0, 'YXZ');
    // tail swish
    m.tail.rotation.z = Math.sin(this.t * (this.S.lazy ? 1.2 : 2.6)) * 0.35;
    m.tail.rotation.x = moving && run ? -0.6 : 0;
    // a sick animal has a little red cross floating over it
    if (this.sickIcon){ this.sickIcon.visible = D.sick; if (D.sick){ this.sickIcon.position.set(this.pos.x, y + (P.eye || 1.5) + 0.9 + Math.sin(this.t * 3) * 0.1, this.pos.z); } }
  }
  // the point to aim a camera at
  centre(out = V()){ return out.set(this.pos.x, this.root.position.y + (this.m.P.hipY || 1) * 0.9, this.pos.z); }
}
