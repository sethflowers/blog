// Props for the Undercroft: the weapons (also used as first-person viewmodels), food, a chest, the
// power gates, cell bars, a portcullis, a brazier, bombs, a crumbling wall and a heap of skulls.
// Everything is built from code at load time; the surface textures are tex/props_*.jpg (made by
// _tools/undercroft/make_props_textures.py) plus the dungeon's own wall textures for the stone.
// Units are metres, +Y up. Geometries and materials are cached and shared between instances; only the
// glowing bits that animate per instance (gate magic, bomb runes) get their own materials.
import * as THREE from 'three';
import { mergeGeometries } from '../../lib/utils/BufferGeometryUtils.js';

const TEX = new URL('../../tex/', import.meta.url).href;
const V3 = THREE.Vector3, V2 = THREE.Vector2;
const TAU = Math.PI * 2;

// ---------- small maths ----------

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const j = (r) => r() - 0.5;
function rng(seed){ // mulberry32: the same props every load
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hash3(x, y, z){ const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return h - Math.floor(h); }
function noise3(x, y, z){
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  let fx = x - X, fy = y - Y, fz = z - Z;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const L = (a, b, t) => a + (b - a) * t;
  const h = (i, j, k) => hash3(X + i, Y + j, Z + k);
  return L(L(L(h(0, 0, 0), h(1, 0, 0), fx), L(h(0, 1, 0), h(1, 1, 0), fx), fy),
           L(L(h(0, 0, 1), h(1, 0, 1), fx), L(h(0, 1, 1), h(1, 1, 1), fx), fy), fz);
}
function fbm3(x, y, z, oct = 3){
  let s = 0, a = 1, n = 0;
  for (let i = 0; i < oct; i++){ s += a * noise3(x, y, z); n += a; a *= 0.5; x *= 2.03; y *= 2.03; z *= 2.03; }
  return s / n;
}

// ---------- textures and materials (created on first use, then shared) ----------

const loader = new THREE.TextureLoader();
const texCache = {};
function tex(name, srgb = false){
  if (!texCache[name]){
    const t = loader.load(TEX + name);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texCache[name] = t;
  }
  return texCache[name];
}
const mats = {};
function mat(key, make){ return mats[key] || (mats[key] = make()); }
const envKey = (env) => (env ? env.uuid : '');

// forged steel: blades, heads, fittings. Vertex colours darken the forge-blackened parts.
const steelMat = (env) => mat('steel' + envKey(env), () => new THREE.MeshStandardMaterial({
  color: 0xa0a5ab, metalness: 1, roughness: 1, roughnessMap: tex('props_steel_rough.jpg'),
  normalMap: tex('props_steel_normal.jpg'), normalScale: new V2(0.35, 0.35),
  envMap: env || null, envMapIntensity: 1.4, vertexColors: true }));
// wrought iron with rust: bands, bars, bombs. Roughness in G, metalness in B of the same map.
const ironMat = (env) => mat('iron' + envKey(env), () => new THREE.MeshStandardMaterial({
  map: tex('props_iron_albedo.jpg', true), normalMap: tex('props_iron_normal.jpg'), normalScale: new V2(0.9, 0.9),
  roughnessMap: tex('props_iron_rm.jpg'), metalnessMap: tex('props_iron_rm.jpg'), roughness: 1, metalness: 1,
  envMap: env || null, envMapIntensity: 1.0, vertexColors: true }));
// one oak texture, tinted per wood: old oak (chest), pale ash (spear), walnut (crossbow), hickory (hammer)
const WOODS = { oak: [0.8, 0.76, 0.7], ash: [1.12, 1.05, 0.94], walnut: [0.66, 0.52, 0.44], hickory: [0.95, 0.85, 0.74] };
const woodMat = (kind) => mat('wood-' + kind, () => new THREE.MeshStandardMaterial({
  color: new THREE.Color().setRGB(...WOODS[kind]), map: tex('props_wood_albedo.jpg', true),
  normalMap: tex('props_wood_normal.jpg'), normalScale: new V2(0.6, 0.6), roughnessMap: tex('props_wood_rough.jpg'),
  roughness: 1, metalness: 0, vertexColors: true }));
// the 2x2 misc atlas: leather | bone / cord | feather
const MISC = { leather: [0, 1], bone: [1, 1], cord: [0, 0], feather: [1, 0] };
const miscMat = (key, side = THREE.FrontSide) => mat('misc-' + key, () => new THREE.MeshStandardMaterial({
  map: tex('props_misc_albedo.jpg', true), normalMap: tex('props_misc_normal.jpg'), normalScale: new V2(0.7, 0.7),
  roughnessMap: tex('props_misc_rough.jpg'), roughness: 1, metalness: 0, vertexColors: true, side }));
// the 2x2 food atlas: apple | bread crust / cheese | roast chicken and bone
const FOOD = { apple: [0, 1], bread: [1, 1], cheese: [0, 0], chicken: [1, 0] };
const foodMat = () => mat('food', () => new THREE.MeshStandardMaterial({
  map: tex('props_food_albedo.jpg', true), normalMap: tex('props_food_normal.jpg'), normalScale: new V2(0.8, 0.8),
  roughnessMap: tex('props_food_rough.jpg'), roughness: 1, metalness: 0 }));
// the dungeon's own wall, so gates and the cracked wall match it (one texture repeat per 3.2 m)
const stoneMat = () => mat('stone', () => new THREE.MeshStandardMaterial({
  map: tex('wall_albedo.jpg', true), normalMap: tex('wall_normal.jpg'), roughnessMap: tex('wall_rough.jpg'),
  roughness: 1, metalness: 0, vertexColors: true }));
const coalMat = () => mat('coal', () => new THREE.MeshStandardMaterial({
  map: tex('props_coals_albedo.jpg', true), emissiveMap: tex('props_coals_emit.jpg', true),
  emissive: new THREE.Color(1, 0.75, 0.6), emissiveIntensity: 3.2, roughness: 0.95, metalness: 0 }));

// ---------- geometry helpers ----------

const KEEP = ['position', 'normal', 'uv', 'color'];
// Makes a geometry mergeable: non-indexed, only position/normal/uv/color, with a colour tint
// (a number for grey or [r, g, b], linear) multiplied into its vertex colours.
function prep(g, tint = 1){
  if (g.index) g = g.toNonIndexed();
  for (const k of Object.keys(g.attributes)) if (!KEEP.includes(k)) g.deleteAttribute(k);
  const n = g.attributes.position.count;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  const t = Array.isArray(tint) ? tint : [tint, tint, tint];
  if (!g.attributes.color){
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++){ c[i * 3] = t[0]; c[i * 3 + 1] = t[1]; c[i * 3 + 2] = t[2]; }
    g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  } else if (tint !== 1){
    const c = g.attributes.color;
    for (let i = 0; i < n; i++) c.setXYZ(i, c.getX(i) * t[0], c.getY(i) * t[1], c.getZ(i) * t[2]);
  }
  g.groups = [];
  return g;
}
const merge = (list) => mergeGeometries(list.map((g) => (Array.isArray(g) ? prep(g[0], g[1]) : prep(g))));
// faceted shading for hard-edged forgings and hewn stone
function flat(g){ g = g.index ? g.toNonIndexed() : g; g.deleteAttribute('normal'); g.computeVertexNormals(); return g; }

// Box-projected UVs at a world scale (s per metre), per triangle. `grain` names the axis that should
// run along v (wood grain); ou/ov shift the texture so neighbouring boards differ.
function projUV(g, s = 1, grain = null, ou = 0, ov = 0){
  if (g.index) g = g.toNonIndexed();
  const p = g.attributes.position, n = p.count;
  const uv = new Float32Array(n * 2);
  const a = new V3(), b = new V3(), c = new V3(), nr = new V3();
  for (let i = 0; i < n; i += 3){
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    nr.subVectors(b, a).cross(c.clone().sub(a));
    const ax = Math.abs(nr.x), ay = Math.abs(nr.y), az = Math.abs(nr.z);
    let U = 'x', V = 'y';
    if (ax >= ay && ax >= az){ U = 'z'; V = 'y'; } else if (ay >= az){ U = 'x'; V = 'z'; }
    if (grain && U === grain){ U = V; V = grain; }
    for (let k = 0; k < 3; k++){
      const q = k === 0 ? a : k === 1 ? b : c;
      uv[(i + k) * 2] = q[U] * s + ou; uv[(i + k) * 2 + 1] = q[V] * s + ov;
    }
  }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
// remap 0..1 UVs into one quadrant of a 2x2 atlas, inset a little against mip bleeding
function atlas(g, [cu, cv]){
  const uv = g.attributes.uv, m = 0.012;
  for (let i = 0; i < uv.count; i++){
    uv.setXY(i, (cu + m + clamp(uv.getX(i)) * (1 - 2 * m)) * 0.5, (cv + m + clamp(uv.getY(i)) * (1 - 2 * m)) * 0.5);
  }
  return g;
}
function scaleUV(g, su, sv, ou = 0, ov = 0){
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su + ou, uv.getY(i) * sv + ov);
  return g;
}
// push vertices about by smooth noise; `axes` picks which coordinates move (planar faces stay planar
// when their normal axis is left out)
function jitter(g, amp, freq, seed = 0, axes = [1, 1, 1]){
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++){
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    p.setXYZ(i,
      x + axes[0] * (fbm3(x * freq + seed, y * freq, z * freq) - 0.5) * 2 * amp,
      y + axes[1] * (fbm3(x * freq, y * freq + seed + 31, z * freq) - 0.5) * 2 * amp,
      z + axes[2] * (fbm3(x * freq, y * freq, z * freq + seed + 67) - 0.5) * 2 * amp);
  }
  return g;
}
const lathe = (pts, segs, phiStart = 0, phiLen = TAU) => new THREE.LatheGeometry(pts.map(([r, y]) => new V2(r, y)), segs, phiStart, phiLen);
function box(w, h, d, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0){
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx || ry || rz) g.applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)));
  return g.translate(x, y, z);
}
// a round rod between two points
function rod(a, b, r, segs = 6, open = true){
  const d = new V3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r, r, d.length(), segs, 1, open);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), d.normalize()));
  return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}
// a domed rivet head at p, facing n
function rivet(p, n, s = 1){
  const g = new THREE.CylinderGeometry(0.0028 * s, 0.0058 * s, 0.0032 * s, 5);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), n.clone().normalize()));
  return g.translate(p.x + n.x * 0.0016 * s, p.y + n.y * 0.0016 * s, p.z + n.z * 0.0016 * s);
}

// Sweeps a cross-section along a path of points. size(i, s) gives the half-sizes [across, up] at point i
// (s = 0..1 along the path); segs sides round (4 with phase PI/4 makes a square bar). `up` orients the
// section; twist (radians per point) spirals it. UVs: u round the section, v along the path (vScale/m).
function sweep(pts, size, segs = 8, { up = new V3(0, 1, 0), caps = true, twist = 0, phase = 0, vScale = 1 } = {}){
  const pos = [], uv = [], idx = [], n = pts.length;
  const ring = [];
  let len = 0, prevSide = null;
  for (let i = 0; i < n; i++){
    const t = new V3().subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
    let side = new V3().crossVectors(t, up);
    if (side.lengthSq() < 1e-8) side = prevSide.clone(); else side.normalize();
    prevSide = side;
    const upv = new V3().crossVectors(side, t).normalize();
    if (i) len += pts[i].distanceTo(pts[i - 1]);
    const [a, b] = size(i, i / (n - 1));
    const r = [];
    for (let j = 0; j <= segs; j++){
      const th = phase + TAU * j / segs + twist * i;
      const p = pts[i].clone().addScaledVector(side, Math.cos(th) * a).addScaledVector(upv, Math.sin(th) * b);
      pos.push(p.x, p.y, p.z); uv.push(j / segs, len * vScale); r.push(p);
    }
    ring.push(r);
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < segs; j++){
    const a = i * (segs + 1) + j, b = a + segs + 1, c = a + 1, d = b + 1;
    idx.push(a, b, c, c, b, d);
  }
  if (caps) for (const [i, flip] of [[0, false], [n - 1, true]]){
    const base = pos.length / 3;
    pos.push(pts[i].x, pts[i].y, pts[i].z); uv.push(0.5, 0.5);
    for (let j = 0; j <= segs; j++){ const p = ring[i][j]; pos.push(p.x, p.y, p.z); uv.push(0.5 + 0.5 * Math.cos(TAU * j / segs), 0.5 + 0.5 * Math.sin(TAU * j / segs)); }
    for (let j = 0; j < segs; j++) flip ? idx.push(base, base + 2 + j, base + 1 + j) : idx.push(base, base + 1 + j, base + 2 + j);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
const curvePts = (pts, n) => new THREE.CatmullRomCurve3(pts.map((p) => new V3(...p))).getPoints(n - 1);

// A leather strip wound round a grip from y0 to y1: each turn overlaps the last, so the radius climbs
// across a turn and steps down at its edge. rx/rz squash it to an oval.
function wrapGeo(y0, y1, r, { rx = 1, rz = 1, pitch = 0.022, depth = 0.0011, segs = 20, rings = 26, swell = 0 } = {}){
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= rings; i++){
    const s = i / rings, y = y0 + (y1 - y0) * s;
    const rr = r * (1 + swell * Math.sin(Math.PI * s));
    for (let j = 0; j <= segs; j++){
      const u = j / segs, a = u * TAU;
      const f = (((u + (y - y0) / pitch) % 1) + 1) % 1;
      const lip = depth * (f - 0.5) - (f > 0.9 ? depth * (f - 0.9) * 4 : 0);
      pos.push(Math.sin(a) * (rr + lip) * rx, y, Math.cos(a) * (rr + lip) * rz); uv.push(u, s);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++){
    const a = i * (segs + 1) + j, b = a + segs + 1, c = a + 1, d = b + 1;
    idx.push(a, c, b, c, d, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// ---------- blades ----------

// Cross-section of a blade's +X face, from one edge (z = -w) to the other, as strips of [z, x] points
// with hard creases between strips. 'fuller': bevelled edges and a central groove; 'rib': a diamond
// section with a midrib (spearheads).
function bladeSection(w, t, fd, type){
  if (type === 'rib') return [[[-w, 0], [-0.55 * w, 0.5 * t], [0, t]], [[0, t], [0.55 * w, 0.5 * t], [w, 0]]];
  const fz = 0.3 * w, fx = 0.88 * t, depth = fd * 0.55 * t, fuller = [];
  for (let k = 0; k <= 6; k++){ const q = -1 + k / 3; fuller.push([q * fz, fx - depth * Math.pow(1 - q * q, 0.6)]); }
  return [[[-w, 0], [-0.82 * w, 0.4 * t], [-0.62 * w, 0.78 * t]], [[-0.62 * w, 0.78 * t], [-fz, fx]], fuller,
          [[fz, fx], [0.62 * w, 0.78 * t]], [[0.62 * w, 0.78 * t], [0.82 * w, 0.4 * t], [w, 0]]];
}
// a blade along +Y from 0 to len; fn(s) gives { w, t, fd } (half width, half thickness, fuller depth)
function bladeGeo(len, rings, fn, type, y0 = 0){
  const pos = [], uv = [], idx = [];
  const nStrips = bladeSection(1, 1, 1, type).length;
  for (const side of [1, -1]) for (let k = 0; k < nStrips; k++){
    const base = pos.length / 3;
    let m = 0;
    for (let i = 0; i <= rings; i++){
      const s = Math.pow(i / rings, 0.85), y = y0 + s * len;
      const { w, t, fd } = fn(s);
      const st = bladeSection(w, t, fd, type)[k]; m = st.length;
      for (const [z, x] of st){ pos.push(x * side, y, z); uv.push(z * 7 + 0.5 + (side < 0 ? 0.37 : 0), y * 1.6); }
    }
    for (let i = 0; i < rings; i++) for (let j = 0; j < m - 1; j++){
      const a = base + i * m + j, b = a + m, c = a + 1, d = b + 1;
      if (side > 0) idx.push(a, b, c, c, b, d); else idx.push(a, c, b, c, d, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// ---------- weapons ----------

const geoCache = {};
const cached = (key, make) => geoCache[key] || (geoCache[key] = make());
function addMesh(group, geo, material, shadow = true){
  const m = new THREE.Mesh(geo, material);
  m.castShadow = shadow; m.receiveShadow = true;
  group.add(m);
  return m;
}

// Arming sword, 0.95 m: wheel pommel, leather grip, crossguard, fullered blade. Origin mid-grip.
function swordGeos(){
  return cached('sword', () => {
    const L = 0.78, tip = 0.16 / L;
    const blade = bladeGeo(L, 30, (s) => {
      const wt = 0.0265 - 0.009 * Math.min(s, 1 - tip) / (1 - tip);
      const w = s < 1 - tip ? wt : wt * Math.pow(Math.cos((s - 1 + tip) / tip * Math.PI / 2), 0.7);
      const t = (0.0037 - 0.0015 * s) * (s < 1 - tip ? 1 : 0.6 + 0.4 * Math.cos((s - 1 + tip) / tip * Math.PI / 2));
      return { w, t, fd: 1 - smooth(0.5, 0.74, s) };
    }, 'fuller', 0.066);
    // crossguard: an oval bar along Z, the tips swept slightly toward the blade and flared
    const gp = []; for (let i = 0; i <= 20; i++){ const z = -0.1 + 0.2 * i / 20; gp.push(new V3(0, 0.065 + 0.011 * Math.pow(Math.abs(z) / 0.1, 2.2), z)); }
    const guard = sweep(gp, (i, s) => { const e = Math.abs(2 * s - 1), fl = smooth(0.82, 1, e) * 0.0025; return [0.0072 - 0.0018 * e + fl, 0.0062 - 0.0012 * e + fl]; }, 10, { vScale: 3 });
    const block = new THREE.CylinderGeometry(1, 1, 1, 8).scale(0.0105, 0.022, 0.016).translate(0, 0.064, 0);
    const collars = [0.054, -0.054].map((y) => lathe([[0.0118, -0.004], [0.0142, -0.0028], [0.0145, 0], [0.0142, 0.0028], [0.0118, 0.004]], 16).translate(0, y, 0));
    // wheel pommel, its faces turned the same way as the blade's flats
    const pommel = lathe([[0, -0.012], [0.008, -0.012], [0.0095, -0.0095], [0.019, -0.0085], [0.0235, -0.0045], [0.0242, 0],
      [0.0235, 0.0045], [0.019, 0.0085], [0.0095, 0.0095], [0.008, 0.012], [0, 0.012]], 24).rotateZ(Math.PI / 2).translate(0, -0.08, 0);
    const steel = merge([blade, [guard, 0.55], [block, 0.5], [collars[0], 0.5], [collars[1], 0.5], [pommel, 0.55]]);
    const grip = atlas(wrapGeo(-0.052, 0.052, 0.0126, { rx: 0.86, rz: 1.06, swell: 0.1, pitch: 0.021 }), MISC.leather);
    return { steel, leather: prep(grip) };
  });
}

// Spear, 2.0 m: ash shaft with a leather hand wrap, socketed leaf head with a midrib, iron butt cap.
function spearGeos(){
  return cached('spear', () => {
    const shaft = new THREE.CylinderGeometry(0.0152, 0.0166, 1.66, 12, 8, true).translate(0, 0.21, 0);
    jitter(shaft, 0.0006, 3, 1, [1, 0, 1]);
    scaleUV(shaft, 0.11, 1.66, 0.6, 0);
    const wrap = atlas(wrapGeo(-0.13, 0.13, 0.0172, { pitch: 0.03, segs: 14, rings: 34, depth: 0.0012 }), MISC.leather);
    const socket = lathe([[0.0192, 1.0], [0.0205, 1.004], [0.0205, 1.013], [0.0184, 1.018], [0.018, 1.04], [0.0196, 1.044],
      [0.0196, 1.051], [0.0178, 1.056], [0.0142, 1.11], [0.0102, 1.148], [0.0092, 1.16]], 16);
    const head = bladeGeo(0.26, 24, (s) => ({
      w: Math.max(0.0092 * (1 - s * 4), 0.034 * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.8)), 0.85)),
      t: 0.0072 * (1 - s) + 0.0012, fd: 0 }), 'rib', 1.155);
    const rivets = [1, -1].map((x) => new THREE.SphereGeometry(0.0035, 6, 4).translate(x * 0.0183, 1.03, 0));
    const butt = lathe([[0, -0.668], [0.0085, -0.664], [0.0128, -0.65], [0.0168, -0.6], [0.0178, -0.585], [0.0178, -0.575], [0.0166, -0.57]], 14);
    return {
      wood: prep(shaft),
      steel: merge([head, [socket, 0.6], [rivets[0], 0.5], [rivets[1], 0.5], [butt, 0.45]]),
      leather: prep(wrap),
    };
  });
}

// War hammer, 0.85 m: octagonal steel head with a flat face (-Z) and a down-curved back spike,
// langets riveted down the haft, a top spike, leather grip and binding straps.
function hammerGeos(){
  return cached('hammer', () => {
    const haft = new THREE.CylinderGeometry(0.0142, 0.0148, 0.8, 10, 4, true).scale(0.9, 1, 1.15).translate(0, 0.26, 0);
    scaleUV(haft, 0.09, 0.8, 0.55, 0);
    const wrap = atlas(wrapGeo(-0.13, 0.075, 0.0152, { rx: 0.9, rz: 1.15, pitch: 0.024, rings: 30 }), MISC.leather);
    const straps = [0.405, 0.432].map((y) => atlas(wrapGeo(y, y + 0.02, 0.0149, { rx: 0.9, rz: 1.15, pitch: 1, depth: 0.0006, segs: 14, rings: 2 }), MISC.leather));
    // striking end: an octagonal lathe along Z with a chamfered face
    const face = flat(lathe([[0, -0.089], [0.021, -0.089], [0.0262, -0.084], [0.0265, -0.064], [0.022, -0.056], [0.0172, -0.042],
      [0.0172, -0.026], [0.0215, -0.021], [0.0215, 0]], 8, Math.PI / 8).rotateX(Math.PI / 2).translate(0, 0.6, 0));
    const eye = flat(box(0.036, 0.074, 0.042, 0, 0.6, 0));
    const sp = []; for (let i = 0; i <= 10; i++){ const s = i / 10; sp.push(new V3(0, 0.6 - 0.022 * Math.pow(s, 2.2), 0.02 + 0.1 * s)); }
    const spike = flat(sweep(sp, (i, s) => { const r = (0.0165 * Math.pow(1 - s, 0.9) + 0.0012) * Math.SQRT2; return [r * 0.9, r]; }, 4, { phase: Math.PI / 4 }));
    const top = flat(new THREE.ConeGeometry(0.0115, 0.07, 4).rotateY(Math.PI / 4).translate(0, 0.672, 0));
    const langets = [1, -1].map((x) => box(0.003, 0.16, 0.013, x * 0.0143, 0.49, 0));
    const lr = [];
    for (const x of [1, -1]) for (const y of [0.44, 0.52]) lr.push(rivet(new V3(x * 0.0158, y, 0), new V3(x, 0, 0), 0.8));
    const cap = lathe([[0, -0.152], [0.011, -0.15], [0.0158, -0.142], [0.0162, -0.128], [0.0148, -0.124]], 10).scale(0.9, 1, 1.15);
    return {
      wood: prep(haft),
      steel: merge([face, eye, [spike, 0.8], [top, 0.8], [langets[0], 0.6], [langets[1], 0.6], ...lr.map((g) => [g, 0.5]), [cap, 0.5]]),
      leather: merge([wrap, ...straps]),
    };
  });
}

// Crossbow bolt pointing -Z, 0.36 m, origin mid-length: ash shaft, square bodkin head, three vanes.
function boltGeos(){
  return cached('bolt', () => {
    const toZ = (pts, segs, phase = 0) => lathe(pts.map(([r, z]) => [r, -z]), segs, phase).rotateX(Math.PI / 2);
    const shaft = toZ([[0, 0.176], [0.0042, 0.175], [0.0056, 0.12], [0.006, 0.0], [0.0056, -0.13], [0.005, -0.142]], 8);
    scaleUV(shaft, 0.06, 0.4, 0.62, 0.3);
    const head = flat(toZ([[0.0046, -0.135], [0.0064, -0.14], [0.0068, -0.152], [0.006, -0.156], [0.0058, -0.158], [0.0001, -0.186]], 4, Math.PI / 4));
    const vanes = [];
    for (let k = 0; k < 3; k++){
      const s = new THREE.Shape();
      s.moveTo(0.168, 0); s.lineTo(0.168, 0.0095); s.quadraticCurveTo(0.14, 0.0125, 0.118, 0.008); s.quadraticCurveTo(0.104, 0.002, 0.095, 0); s.closePath();
      const g = new THREE.ShapeGeometry(s, 4);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5 + uv.getY(i) / 0.026, (uv.getX(i) - 0.09) / 0.085);
      atlas(g, MISC.feather);
      g.rotateY(-Math.PI / 2).translate(0, 0.0052, 0).rotateZ(k * TAU / 3 + 0.3);
      vanes.push(g);
    }
    return { wood: prep(shaft), steel: prep(head, 0.55), cord: merge(vanes) };
  });
}

// Crossbow, +Y up, shooting -Z, origin where the right hand holds the stock: a walnut tiller, a steel
// prod lashed into its nose, the string drawn back to the nut, a loaded bolt, trigger lever and stirrup.
function crossbowGeos(){
  return cached('crossbow', () => {
    const s = new THREE.Shape();
    s.moveTo(0.17, -0.07); s.lineTo(0.172, 0.03); s.quadraticCurveTo(0.08, 0.036, 0.03, 0.03); s.lineTo(-0.535, 0.03);
    s.quadraticCurveTo(-0.556, 0.03, -0.556, 0.01); s.lineTo(-0.556, -0.02); s.quadraticCurveTo(-0.552, -0.032, -0.5, -0.032);
    s.lineTo(-0.07, -0.032); s.quadraticCurveTo(0.0, -0.032, 0.035, -0.046); s.quadraticCurveTo(0.08, -0.07, 0.17, -0.07);
    const stock = new THREE.ExtrudeGeometry(s, { depth: 0.036, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.005, bevelSegments: 2, curveSegments: 6 });
    stock.rotateY(-Math.PI / 2).translate(0.018, 0, 0);
    const stockW = projUV(stock, 0.5, 'z', 0.3, 0.1);
    // the prod: a flat steel bow through the stock's nose, drawn back toward the shooter
    const pp = []; for (let i = 0; i <= 24; i++){ const x = -0.31 + 0.62 * i / 24, e = Math.abs(x) / 0.31; pp.push(new V3(x, 0.012, -0.482 + 0.075 * e * e)); }
    const prod = sweep(pp, (i, t) => { const e = Math.abs(2 * t - 1); return [0.0068 * (1 - 0.4 * e), 0.0152 * (1 - 0.45 * e)]; }, 8, { vScale: 2 });
    const nocks = [1, -1].map((x) => new THREE.SphereGeometry(0.0072, 8, 6).scale(1, 1.3, 1).translate(x * 0.312, 0.012, -0.407));
    const tipL = new V3(-0.307, 0.012, -0.41), tipR = new V3(0.307, 0.012, -0.41), nut = new V3(0, 0.038, -0.035);
    const string = [rod(tipL, nut, 0.0017, 5), rod(tipR, nut, 0.0017, 5)];
    // lashing: rope loops round the nose and the prod, alternately tilted
    const loops = [];
    for (let k = 0; k < 4; k++){
      const z = -0.462 - k * 0.011, tilt = (k % 2 ? 1 : -1) * 0.28, pts = [];
      for (let i = 0; i <= 16; i++){ const a = TAU * i / 16; pts.push(new V3(Math.cos(a) * 0.0265, 0.003 + Math.sin(a) * 0.033, z + Math.cos(a) * tilt * 0.02)); }
      loops.push(sweep(pts, () => [0.0032, 0.0032], 5, { up: new V3(0, 0, 1), caps: false, vScale: 8 }));
    }
    const cord = merge([...string, ...loops].map((g) => atlas(g, MISC.cord)));
    const nutG = new THREE.CylinderGeometry(0.0125, 0.0125, 0.03, 14).rotateZ(Math.PI / 2).translate(0, 0.03, -0.036);
    const pins = [1, -1].map((x) => new THREE.CylinderGeometry(0.004, 0.004, 0.004, 8).rotateZ(Math.PI / 2).translate(x * 0.0255, -0.012, -0.028));
    const trig = sweep(curvePts([[0, -0.02, -0.03], [0, -0.05, -0.0], [0, -0.07, 0.07], [0, -0.078, 0.15]], 10), (i, t) => [0.0035, 0.0055 * (1 - 0.3 * t)], 6, { up: new V3(1, 0, 0) });
    const stir = sweep(curvePts([[-0.022, -0.005, -0.54], [-0.05, -0.008, -0.585], [-0.042, -0.012, -0.64], [0, -0.014, -0.662], [0.042, -0.012, -0.64], [0.05, -0.008, -0.585], [0.022, -0.005, -0.54]], 22), () => [0.0048, 0.0048], 6);
    const plate = box(0.05, 0.004, 0.06, 0, -0.035, -0.52);
    const bolt = boltGeos();
    const place = (g) => g.clone().translate(0, 0.0422, -0.218);
    return {
      wood: merge([prep(stockW), place(bolt.wood)]),
      steel: place(bolt.steel),
      iron: merge([prod, ...nocks, [nutG, [1.3, 1.2, 1.1]], ...pins, trig, stir, plate]),
      cord: merge([cord, place(bolt.cord)]),
    };
  });
}

export function createWeapon(kind, opts = {}){
  const env = opts.env, g = new THREE.Group();
  g.name = kind;
  if (kind === 'sword'){
    const p = swordGeos();
    addMesh(g, p.steel, steelMat(env)); addMesh(g, p.leather, miscMat('leather'));
  } else if (kind === 'spear'){
    const p = spearGeos();
    addMesh(g, p.wood, woodMat('ash')); addMesh(g, p.steel, steelMat(env)); addMesh(g, p.leather, miscMat('leather'));
  } else if (kind === 'hammer'){
    const p = hammerGeos();
    addMesh(g, p.wood, woodMat('hickory')); addMesh(g, p.steel, steelMat(env)); addMesh(g, p.leather, miscMat('leather'));
  } else if (kind === 'crossbow'){
    const p = crossbowGeos();
    addMesh(g, p.wood, woodMat('walnut')); addMesh(g, p.steel, steelMat(env)); addMesh(g, p.iron, ironMat(env));
    addMesh(g, p.cord, miscMat('cord', THREE.DoubleSide));
  } else throw new Error('unknown weapon ' + kind);
  return g;
}

export function createBolt(opts = {}){
  const p = boltGeos(), g = new THREE.Group();
  g.name = 'bolt';
  addMesh(g, p.wood, woodMat('ash')); addMesh(g, p.steel, steelMat(opts.env)); addMesh(g, p.cord, miscMat('cord', THREE.DoubleSide));
  return g;
}

// ---------- food ----------

// bread slashes in the crust quadrant's (u, v); must match BREAD_SLASHES in make_props_textures.py
const BREAD_SLASHES = [[[0.215, 0.18], [0.285, 0.42]], [[0.215, 0.39], [0.285, 0.63]], [[0.215, 0.6], [0.285, 0.84]]];
function segDist(px, py, [ax, ay], [bx, by], sx, sy){
  const dx = (bx - ax) * sx, dy = (by - ay) * sy, qx = (px - ax) * sx, qy = (py - ay) * sy;
  const t = clamp((qx * dx + qy * dy) / (dx * dx + dy * dy));
  return [Math.hypot(qx - t * dx, qy - t * dy), t, (qx * dy - qy * dx) / Math.hypot(dx, dy)];
}
// a crusty batard: a lathe round its long axis (X), flat underneath, three opened slashes on top
function breadGeo(){
  const L = 0.27, R = 0.062, n = 34, m = 40, pos = [], uv = [], idx = [];
  for (let i = 0; i <= n; i++){
    const s = i / n, x = (s - 0.5) * L;
    const prof = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(2 * s - 1), 2.4)), 0.42);
    for (let j = 0; j <= m; j++){
      const u = j / m, a = u * TAU;
      let r = R * prof * (1 + (fbm3(x * 30, Math.sin(a) * 2, Math.cos(a) * 2) - 0.5) * 0.08);
      for (const sl of BREAD_SLASHES){
        const [d, t, side] = segDist(u, s, sl[0], sl[1], 0.35, 0.26);
        const w = 0.011 * Math.sqrt(Math.sin(Math.PI * t)) + 0.0005;
        const cut = smooth(w, w * 0.4, d), ear = smooth(w * 2.2, w, d) * (1 - cut) * (side > 0 ? 1 : 0);
        r += (-0.008 * cut + 0.004 * ear) * prof;
      }
      let y = Math.sin(a) * r * 0.8; const z = Math.cos(a) * r;
      const yb = -R * 0.42 * prof;
      if (y < yb) y = yb + (y - yb) * 0.12;
      pos.push(x, y, z); uv.push(u, s);
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++){
    const a = i * (m + 1) + j, b = a + m + 1, c = a + 1, d = b + 1;
    idx.push(a, b, c, c, b, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return atlas(g, FOOD.bread);
}
function appleGeo(){
  const prof = curvePts([[0.0005, 0.011], [0.008, 0.006], [0.019, 0.002], [0.031, 0.006], [0.039, 0.017], [0.0425, 0.031],
    [0.0428, 0.043], [0.04, 0.055], [0.034, 0.065], [0.024, 0.0715], [0.014, 0.0718], [0.007, 0.0675], [0.0005, 0.0625]], 22);
  const g = lathe(prof.map((p) => [p.x, p.y]), 28);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++){ // a few soft lobes toward the calyx, and slight lopsidedness
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(x, z);
    const k = 1 + 0.025 * Math.cos(5 * a) * smooth(0.04, 0.0, y) + 0.03 * (fbm3(x * 25, y * 25, z * 25) - 0.5) + 0.02 * Math.sin(a) * y / 0.07;
    p.setXYZ(i, x * k, y, z * k);
  }
  atlas(g, FOOD.apple);
  const stem = sweep(curvePts([[0, 0.058, 0], [0.001, 0.07, 0.001], [0.004, 0.081, 0.002], [0.008, 0.088, 0.003]], 6), (i, t) => [0.0019 * (1 - 0.3 * t), 0.0019 * (1 - 0.3 * t)], 5);
  const su = stem.attributes.uv; for (let i = 0; i < su.count; i++) su.setXY(i, 0.3, 0.995);
  return merge([g, atlas(stem, FOOD.apple)]);
}
// a wedge cut from a hard cheese wheel: waxed rind round the outside, cut faces showing the paste
function cheeseGeo(){
  const R = 0.13, H = 0.075, ang = 0.78;
  const prof = [[0, 0], [0.118, 0], [0.126, 0.004], [0.1305, 0.016], [0.1325, 0.0375], [0.1305, 0.059], [0.126, 0.071], [0.118, 0.075], [0, 0.075]];
  const rind = lathe(prof, 14, 0, ang);
  const uv = rind.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), 0.62 + 0.36 * uv.getY(i));
  atlas(rind, FOOD.cheese);
  const caps = [];
  for (const [phi, sgn] of [[0, -1], [ang, 1]]){
    const tri = THREE.ShapeUtils.triangulateShape(prof.map(([r, y]) => new V2(r, y)), []);
    const pos = [], uvs = [];
    const want = new V3(Math.cos(phi), 0, -Math.sin(phi)).multiplyScalar(sgn);
    for (const t of tri){
      const P = t.map((k) => new V3(prof[k][0] * Math.sin(phi), prof[k][1], prof[k][0] * Math.cos(phi)));
      const nrm = new V3().subVectors(P[1], P[0]).cross(new V3().subVectors(P[2], P[0]));
      const order = nrm.dot(want) > 0 ? [0, 1, 2] : [0, 2, 1];
      for (const o of order){ pos.push(P[o].x, P[o].y, P[o].z); uvs.push(prof[t[o]][0] / R * 0.95 + (phi ? 0.03 : 0), prof[t[o]][1] / H * 0.54); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.computeVertexNormals();
    caps.push(atlas(g, FOOD.cheese));
  }
  const g = merge([rind, ...caps]);
  g.computeBoundingBox();
  const c = g.boundingBox.getCenter(new V3());
  return g.translate(-c.x, 0, -c.z);
}
// a roast chicken leg lying on its side: meaty bulb, skin pulled back from the knuckle bone
function drumstickGeo(){
  const L = 0.17, n = 36, m = 22, pos = [], uv = [], idx = [];
  const prof = [[0, 0], [0.04, 0.02], [0.12, 0.031], [0.28, 0.037], [0.45, 0.034], [0.6, 0.024], [0.7, 0.0155], [0.738, 0.0128],
    [0.75, 0.0085], [0.8, 0.0075], [0.9, 0.0078], [0.95, 0.0112], [0.985, 0.0098], [1, 0]];
  const radius = (s) => { for (let k = 1; k < prof.length; k++) if (s <= prof[k][0]){ const [s0, r0] = prof[k - 1], [s1, r1] = prof[k]; const t = (s - s0) / (s1 - s0); return r0 + (r1 - r0) * (t * t * (3 - 2 * t)); } return 0; };
  for (let i = 0; i <= n; i++){
    const s = i / n, x = s * L, meat = s < 0.745 ? 1 : 0;
    const vv = s < 0.72 ? s : s < 0.755 ? 0.72 + (s - 0.72) / 0.035 * 0.075 : 0.8 + (s - 0.755) / 0.245 * 0.2;
    for (let j = 0; j <= m; j++){
      const u = j / m, a = u * TAU;
      let r = radius(s) * (1 + meat * (fbm3(x * 40, Math.sin(a) * 1.5, Math.cos(a) * 1.5) - 0.5) * 0.22);
      const y = Math.sin(a) * r * (Math.sin(a) < 0 ? 0.8 : 1) + 0.004 * Math.sin(Math.PI * s);
      pos.push(x, y, Math.cos(a) * r); uv.push(u, vv);
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++){
    const a = i * (m + 1) + j, b = a + m + 1, c = a + 1, d = b + 1;
    idx.push(a, b, c, c, b, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  atlas(g, FOOD.chicken);
  g.rotateZ(0.12).rotateY(0.4);
  g.computeBoundingBox();
  const b = g.boundingBox, c = b.getCenter(new V3());
  return g.translate(-c.x, -b.min.y, -c.z);
}
function grounded(g){ g.computeBoundingBox(); return g.translate(0, -g.boundingBox.min.y, 0); }

export function createFood(kind){
  const geo = cached('food-' + kind, () => {
    if (kind === 'bread') return grounded(breadGeo());
    if (kind === 'apple') return grounded(appleGeo());
    if (kind === 'cheese') return cheeseGeo();
    if (kind === 'drumstick') return drumstickGeo();
    throw new Error('unknown food ' + kind);
  });
  const m = new THREE.Mesh(geo, foodMat());
  m.castShadow = m.receiveShadow = true; m.name = kind;
  return m;
}

// ---------- chest ----------

// darken the faces of g that look toward `centre` (the inside of the chest), a cheap stand-in for AO
function shadeInside(g, centre, k){
  const p = g.attributes.position, c = g.attributes.color;
  const a = new V3(), b = new V3(), d = new V3(), n = new V3(), m = new V3();
  for (let i = 0; i < p.count; i += 3){
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); d.fromBufferAttribute(p, i + 2);
    n.subVectors(b, a).cross(m.subVectors(d, a));
    m.copy(a).add(b).add(d).divideScalar(3);
    if (n.dot(m.sub(centre).negate()) > 0) for (let j = 0; j < 3; j++) c.setXYZ(i + j, c.getX(i + j) * k, c.getY(i + j) * k, c.getZ(i + j) * k);
  }
  return g;
}

function chestGeos(){
  return cached('chest', () => {
    const W = 0.9, D = 0.55, H = 0.38, T = 0.022, Y0 = 0.035, h = 0.17;
    const R = (D * D / 4 + h * h) / (2 * h), al = Math.asin(D / 2 / R);
    const r = rng(7), j = () => (r() - 0.5);
    const centre = new V3(0, Y0 + H / 2, 0);
    const boards = [];
    const board = (g, grain) => { g = projUV(g, 1, grain, r(), r()); const k = 0.68 + 0.4 * r(); boards.push(prep(g, [k, k * (0.96 + 0.06 * r()), k * (0.9 + 0.1 * r())])); };
    for (let k = 0; k < 3; k++){ // front, back and side boards, each a little uneven
      const y = Y0 + H / 6 + k * H / 3, bh = H / 3 - 0.004;
      for (const zs of [1, -1]) board(box(W, bh, T, j() * 0.002, y, zs * (D / 2 - T / 2) + j() * 0.003, 0, 0, j() * 0.004), 'x');
      for (const xs of [1, -1]) board(box(T, bh, D - 2 * T, xs * (W / 2 - T / 2) + j() * 0.003, y, 0, j() * 0.004), 'z');
    }
    board(box(W - 2 * T, T, D - 2 * T, 0, Y0 + T / 2, 0), 'x');
    for (const xs of [1, -1]) board(box(0.07, Y0, D + 0.02, xs * 0.33, Y0 / 2, 0), 'z');  // skids
    const bodyWood = shadeInside(merge(boards), centre, 0.35);
    // the lid, in hinge space (origin on the hinge line at the back, front edge at +z = D)
    const arc = (rad, th) => [D / 2 + rad * Math.sin(th), h - R + rad * Math.cos(th)];
    const staves = [], N = 6;
    for (let k = 0; k < N; k++){
      const t0 = -al + 2 * al * k / N, t1 = -al + 2 * al * (k + 1) / N, s = new THREE.Shape();
      const p = [arc(R, t0), arc(R, t1), arc(R - T, t1), arc(R - T, t0)];
      s.moveTo(...p[0]); for (const q of p.slice(1)) s.lineTo(...q);
      const g = new THREE.ExtrudeGeometry(s, { depth: W - 2 * T - 0.004, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(W / 2 - T - 0.002, 0, 0);
      g.translate(0, j() * 0.002, 0);
      staves.push(prep(projUV(g, 1, 'x', r(), r()), 0.85 + 0.25 * r()));
    }
    for (const xs of [1, -1]){ // lid ends: the arch-shaped boards that close the barrel
      const s = new THREE.Shape(); s.moveTo(0, 0);
      for (let i = 0; i <= 12; i++) s.lineTo(...arc(R, -al + 2 * al * i / 12));
      const g = new THREE.ExtrudeGeometry(s, { depth: T, bevelEnabled: false, curveSegments: 1 }).rotateY(-Math.PI / 2).translate(xs * (W / 2 - T / 2) + T / 2, 0, 0);
      staves.push(prep(projUV(g, 1, 'z', r(), r()), 0.9));
    }
    const lidWood = shadeInside(merge(staves), new V3(0, -0.05, D / 2), 0.4);

    const iron = [], lidIron = [];
    const front = new V3(0, 0, 1), back = new V3(0, 0, -1);
    for (const x of [-0.3, 0.3]){ // straps over front, back, and the lid
      iron.push(box(0.044, H + 0.004, 0.004, x, Y0 + H / 2, D / 2 + 0.002), box(0.044, H + 0.004, 0.004, x, Y0 + H / 2, -D / 2 - 0.002));
      for (let k = 0; k < 5; k++){ const y = Y0 + 0.03 + k * (H - 0.06) / 4; iron.push(rivet(new V3(x, y, D / 2 + 0.004), front, 1.4), rivet(new V3(x, y, -D / 2 - 0.004), back, 1.4)); }
      const ap = []; for (let i = 0; i <= 16; i++){ const [z, y] = arc(R + 0.002, -al - 0.03 + (2 * al + 0.06) * i / 16); ap.push(new V3(x, y, z)); }
      lidIron.push(flat(sweep(ap, () => [0.002 * Math.SQRT2, 0.022 * Math.SQRT2], 4, { up: new V3(1, 0, 0), phase: Math.PI / 4 })));
      for (let i = 1; i < 6; i++){ const th = -al + 2 * al * i / 6, [z, y] = arc(R + 0.004, th); lidIron.push(rivet(new V3(x, y, z), new V3(0, Math.cos(th), Math.sin(th)), 1.4)); }
    }
    for (const xs of [1, -1]) for (const zs of [1, -1]){ // corner brackets
      iron.push(box(0.05, H * 0.5, 0.004, xs * (W / 2 - 0.025), Y0 + H * 0.75, zs * (D / 2 + 0.002)));
      iron.push(box(0.004, H * 0.5, 0.05, xs * (W / 2 + 0.002), Y0 + H * 0.75, zs * (D / 2 - 0.025)));
      iron.push(rivet(new V3(xs * (W / 2 - 0.025), Y0 + H * 0.62, zs * (D / 2 + 0.004)), new V3(0, 0, zs)));
      iron.push(rivet(new V3(xs * (W / 2 + 0.004), Y0 + H * 0.62, zs * (D / 2 - 0.025)), new V3(xs, 0, 0)));
    }
    // lock plate with a keyhole, and side handles
    iron.push(flat(box(0.1, 0.11, 0.006, 0, Y0 + H - 0.065, D / 2 + 0.003)));
    iron.push(prep(box(0.009, 0.022, 0.002, 0, Y0 + H - 0.08, D / 2 + 0.0065), 0.05), prep(new THREE.CylinderGeometry(0.0075, 0.0075, 0.002, 10).rotateX(Math.PI / 2).translate(0, Y0 + H - 0.068, D / 2 + 0.0065), 0.05));
    for (const [x, y] of [[-0.04, -0.025], [0.04, -0.025], [-0.04, -0.105], [0.04, -0.105]]) iron.push(rivet(new V3(x, Y0 + H + y, D / 2 + 0.006), front));
    for (const xs of [1, -1]){
      iron.push(box(0.005, 0.05, 0.13, xs * (W / 2 + 0.0025), Y0 + H * 0.72, 0));
      iron.push(new THREE.TorusGeometry(0.048, 0.0065, 6, 12, Math.PI).rotateZ(Math.PI).rotateY(Math.PI / 2).translate(xs * (W / 2 + 0.012), Y0 + H * 0.72 + 0.005, 0));
    }
    // the hasp hangs from the lid's front edge over the lock plate
    lidIron.push(flat(box(0.034, 0.12, 0.005, 0, -0.04, D + 0.0105)), new THREE.CylinderGeometry(0.006, 0.006, 0.04, 8).rotateZ(Math.PI / 2).translate(0, 0.018, D + 0.006));
    lidIron.push(rivet(new V3(0, 0.0, D + 0.013), front), prep(box(0.012, 0.018, 0.004, 0, -0.07, D + 0.014), 0.6));
    return { bodyWood, lidWood, bodyIron: merge(iron), lidIron: merge(lidIron), H: Y0 + H, D };
  });
}

export function createChest(opts = {}){
  const p = chestGeos(), group = new THREE.Group(), lid = new THREE.Group();
  group.name = 'chest';
  addMesh(group, p.bodyWood, woodMat('oak')); addMesh(group, p.bodyIron, ironMat(opts.env));
  lid.position.set(0, p.H, -p.D / 2);
  addMesh(lid, p.lidWood, woodMat('oak')); addMesh(lid, p.lidIron, ironMat(opts.env));
  group.add(lid);
  return { group, lid, setOpen(f){ lid.rotation.x = -clamp(f) * 1.85; } };
}

// ---------- power gates ----------

// the arch of an opening w wide whose crown is at `top`: left foot, up, over, down to the right foot
function archPts(w, top, n = 18){
  const r = w / 2, sp = top - r, pts = [[-r, 0], [-r, sp]];
  for (let k = 1; k < n; k++){ const a = Math.PI - Math.PI * k / n; pts.push([Math.cos(a) * r, sp + Math.sin(a) * r]); }
  pts.push([r, sp], [r, 0]);
  return pts;
}
// one tentacle of the crest: up its right side, round the curled tip, down its left (outline order)
function tentacle(cx, base, L, w0, curl){
  const n = 10, C = [], ang = [];
  let x = cx, y = base;
  for (let i = 0; i <= n; i++){
    const t = i / n, th = curl * (0.15 * t + 0.85 * t * t * t);
    C.push([x, y, th, w0 * (1 - 0.72 * t) + 0.018]);
    x += Math.sin(th) * L / n; y += Math.cos(th) * L / n;
  }
  const right = C.map(([x, y, th, w]) => [x + Math.cos(th) * w / 2, y - Math.sin(th) * w / 2]);
  const left = C.map(([x, y, th, w]) => [x - Math.cos(th) * w / 2, y + Math.sin(th) * w / 2]).reverse();
  const [tx, ty, tth, tw] = C[n], tip = [];
  for (let k = 1; k < 4; k++){ // round the tip from the right side to the left
    const ps = Math.PI * k / 4, c = Math.cos(ps) * tw / 2, f = Math.sin(ps) * tw / 2;
    tip.push([tx + Math.cos(tth) * c + Math.sin(tth) * f, ty - Math.sin(tth) * c + Math.cos(tth) * f]);
  }
  return [...right, ...tip, ...left];
}
const OPENINGS = [[1.72, 2.4], [1.48, 2.27], [1.26, 2.14], [1.06, 2.02]];  // [width, crown] slab hole and each inner order
const SLAB_TOP = 2.6, MED_Y = 2.64;

function gateStoneGeo(){
  return cached('gate-stone', () => {
    const parts = [];
    // the slab: outline drawn counter-clockwise with the doorway cut up from the ground
    const o = [[-1.15, 0], ...archPts(...OPENINGS[0], 20), [1.15, 0]];
    for (let k = 1; k <= 8; k++){ const y = SLAB_TOP * k / 8; o.push([1.15 - 0.03 * k / 8 + (noise3(k * 1.7, 0, 3) - 0.5) * 0.03, y]); }
    const lobes = [[0.99, 0.3, 2.6], [0.72, 0.4, 2.2], [0.445, 0.36, 1.7]];
    for (const [cx, L, curl] of lobes) o.push(...tentacle(cx, SLAB_TOP, L, 0.24, curl));
    for (const [cx, L, curl] of lobes.slice().reverse()) o.push(...tentacle(-cx, SLAB_TOP, L, 0.24, -curl));
    for (let k = 8; k >= 1; k--){ const y = SLAB_TOP * k / 8; o.push([-1.15 + 0.03 * k / 8 + (noise3(k * 1.3, 5, 1) - 0.5) * 0.03, y]); }
    const shape = (pts) => { const s = new THREE.Shape(); s.moveTo(...pts[0]); for (const p of pts.slice(1)) s.lineTo(...p); return s; };
    const ext = (pts, d, bev) => new THREE.ExtrudeGeometry(shape(pts), { depth: d - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev * 0.9, bevelSegments: 2, curveSegments: 4 }).translate(0, 0, -(d - 2 * bev) / 2);
    parts.push(ext(o, 0.6, 0.016));
    // nested orders: each a thinner arch ring set into the one outside it, like doorways within doorways
    for (let k = 1; k < OPENINGS.length; k++){
      const [wo, to] = OPENINGS[k - 1], [wi, ti] = OPENINGS[k];
      const outer = archPts(wo + 0.12, to + 0.06, 20).reverse();
      parts.push(ext([[-(wo + 0.12) / 2, 0], ...archPts(wi, ti, 20), ...outer.slice(0, -1)], 0.6 - 0.13 * k, 0.03));
    }
    // the roundel at the crown that carries the power's sign
    const med = lathe([[0, -0.338], [0.16, -0.338], [0.168, -0.356], [0.2, -0.36], [0.222, -0.34], [0.226, 0], [0.222, 0.34], [0.2, 0.36], [0.168, 0.356], [0.16, 0.338], [0, 0.338]], 22, Math.PI / 22);
    parts.push(med.rotateX(Math.PI / 2).translate(0, MED_Y, 0));
    // rough-hewn: push the outlines about in the plane (the faces stay flat), facet the shading
    const g = flat(merge(parts.map((p) => jitter(jitter(p.index ? p.toNonIndexed() : p, 0.01, 2.2, 3, [1, 1, 0]), 0.004, 9, 7, [1, 1, 0]))));
    projUV(g, 1 / 3.2);
    const p = g.attributes.position, c = g.attributes.color;
    for (let i = 0; i < p.count; i++){ const y = p.getY(i), k = 0.6 + 0.4 * smooth(0, 0.6, y); c.setXYZ(i, k, k * 0.98, k * 0.96); }
    return g;
  });
}

// the glowing sign for each power, as flat shapes about 0.3 m across
function symbolShapes(kind){
  const S = [];
  const rect = (cx, cy, w, h, a) => { const s = new THREE.Shape(), c = Math.cos(a), n = Math.sin(a), pts = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => [cx + x * c - y * n, cy + x * n + y * c]); s.moveTo(...pts[0]); for (const p of pts.slice(1)) s.lineTo(...p); return s; };
  if (kind === 'magnet'){ // a horseshoe magnet, its poles banded
    const R = 0.1, r = 0.052, c = 0.02, yb = -0.07, s = new THREE.Shape();
    s.moveTo(-R, yb); s.lineTo(-R, c); s.absarc(0, c, R, Math.PI, 0, true); s.lineTo(R, yb); s.lineTo(r, yb); s.lineTo(r, c);
    s.absarc(0, c, r, 0, Math.PI, false); s.lineTo(-r, yb); s.closePath(); S.push(s);
    S.push(rect(-(R + r) / 2, yb - 0.032, R - r, 0.045, 0), rect((R + r) / 2, yb - 0.032, R - r, 0.045, 0));
  } else if (kind === 'bomb'){ // a round bomb with its fuse and a spark
    const s = new THREE.Shape(); s.absarc(-0.015, -0.03, 0.09, 0, TAU, false); S.push(s);
    S.push(rect(0.038, 0.053, 0.04, 0.03, -0.75));
    for (let k = 0; k < 5; k++) S.push(rect(0.06 + k * 0.012, 0.075 + Math.sin(k * 0.9) * 0.01 + k * 0.006, 0.014, 0.008, 0.4));
    const st = new THREE.Shape();
    for (let k = 0; k < 16; k++){ const a = TAU * k / 16, rr = k % 2 ? 0.012 : (k % 4 ? 0.03 : 0.042); const p = [0.135 + Math.cos(a) * rr, 0.125 + Math.sin(a) * rr]; k ? st.lineTo(...p) : st.moveTo(...p); }
    S.push(st);
  } else if (kind === 'freeze'){ // a six-armed snowflake
    for (let k = 0; k < 6; k++){
      const a = TAU * k / 6, c = Math.cos(a), n = Math.sin(a);
      S.push(rect(c * 0.066, n * 0.066, 0.132, 0.016, a));
      for (const [d, l] of [[0.07, 0.05], [0.105, 0.035]]) for (const sg of [1, -1]){
        const b = a + sg * 0.85, L = l / 2;
        S.push(rect(c * d + Math.cos(b) * L, n * d + Math.sin(b) * L, l, 0.012, b));
      }
    }
    const hx = new THREE.Shape(); for (let k = 0; k < 6; k++){ const a = TAU * k / 6 + Math.PI / 6, p = [Math.cos(a) * 0.026, Math.sin(a) * 0.026]; k ? hx.lineTo(...p) : hx.moveTo(...p); } S.push(hx);
  } else if (kind === 'flight'){ // a spread wing: a curved shoulder and five feathers fanning down from it
    const sh = new THREE.Shape(); sh.moveTo(-0.13, 0.06); sh.quadraticCurveTo(-0.02, 0.15, 0.13, 0.11); sh.lineTo(0.12, 0.07); sh.quadraticCurveTo(-0.02, 0.1, -0.12, 0.03); sh.closePath(); S.push(sh);
    for (let k = 0; k < 5; k++){
      const x = -0.1 + k * 0.055, l = 0.2 - k * 0.028, a = -0.25 + k * 0.12;
      const f = new THREE.Shape(), c = Math.cos(a), n = Math.sin(a), w = 0.022;
      const pt = (u, v) => [x + u * n + v * c, 0.07 - u * c + v * n];
      f.moveTo(...pt(0, -w)); f.quadraticCurveTo(...pt(l * 0.6, -w * 1.3), ...pt(l, 0)); f.quadraticCurveTo(...pt(l * 0.6, w * 1.3), ...pt(0, w)); f.closePath(); S.push(f);
    }
  } else { // a heater shield with a rim and a cross
    const outline = (k) => { const s = new THREE.Shape(); s.moveTo(-0.1 * k, 0.115 * k); s.lineTo(0.1 * k, 0.115 * k); s.quadraticCurveTo(0.105 * k, -0.04 * k, 0, -0.14 * k); s.quadraticCurveTo(-0.105 * k, -0.04 * k, -0.1 * k, 0.115 * k); return s; };
    const rim = outline(1); rim.holes.push(outline(0.8)); S.push(rim);
    S.push(rect(0, 0.0, 0.026, 0.19, 0), rect(0, 0.035, 0.15, 0.026, 0));
  }
  return S;
}

const GATE_KINDS = {
  magnet: { a: [0.85, 0.04, 0.03], b: [1.0, 0.32, 0.22], spark: [0.85, 0.9, 1.0], sym: [1.0, 0.16, 0.1], kind: 0 },
  bomb:   { a: [1.0, 0.22, 0.02], b: [1.0, 0.62, 0.14], spark: [1.0, 0.7, 0.3], sym: [1.0, 0.45, 0.08], kind: 1 },
  freeze: { a: [0.08, 0.3, 1.0], b: [0.55, 0.82, 1.0], spark: [0.9, 0.97, 1.0], sym: [0.3, 0.6, 1.0], kind: 2 },
  shield: { a: [0.9, 0.5, 0.06], b: [1.0, 0.82, 0.38], spark: [1.0, 0.95, 0.7], sym: [1.0, 0.7, 0.2], kind: 3 },
  flight: { a: [0.1, 0.7, 0.55], b: [0.7, 1.0, 0.9], spark: [1.0, 1.0, 1.0], sym: [0.45, 1.0, 0.8], kind: 4 },
};

const MAGIC_VS = `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
// The swirl inside the innermost arch. One shader for all four powers; uKind picks the flavour:
// 0 magnet (red vortex, silver sparks orbiting), 1 bomb (fire boiling upward, embers), 2 freeze
// (icy vortex with crystal spikes, glints), 3 shield (gold vortex with ripples spreading out).
const MAGIC_FS = `
uniform float uTime, uPower, uHalfW, uSpring, uKind;
uniform vec3 uColA, uColB, uSpark;
varying vec2 vP;
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 4; i++){ s += a * vn(p); p = p * 2.03 + 17.1; a *= .5; } return s; }
float sparks(vec2 g, float t){ vec2 id = floor(g), f = fract(g) - .5; float h = h21(id);
  vec2 o = (vec2(h, fract(h * 13.7)) - .5) * .6; float tw = .5 + .5 * sin(t * 7. + h * 40.);
  return step(.55, fract(h * 71.3)) * smoothstep(.13, .0, length(f - o)) * tw; }
void main(){
  float t = uTime;
  vec2 c = vec2(0., uSpring - 0.2), d = vP - c;
  float r = length(d * vec2(1., .8)), a = atan(d.y, d.x);
  float e = min(uHalfW - abs(vP.x), vP.y);
  if (vP.y > uSpring) e = min(e, uHalfW - length(vP - vec2(0., uSpring)));
  float fade = smoothstep(0., .07, e) * smoothstep(-.02, .25, vP.y);
  float spin = uKind == 1. ? .45 : 1.;
  float ang = a + 2.4 / (r + .35) * spin - t * .9 * spin;
  vec2 q = vec2(cos(ang), sin(ang)) * r;
  vec2 flow = uKind == 1. ? vec2(0., -t * .9) : vec2(0., -t * .25);
  float n = fbm(q * 3. + flow + (uKind == 1. ? vP * 2.5 : vec2(0.)));
  float arms = .5 + .5 * sin(a * 3. + log(r + .05) * 7. - t * 2.2 * spin);
  float core = exp(-r * 3.2);
  float v = n * n * 1.8 * (.25 + .95 * arms * arms) * (.35 + .65 * smoothstep(1.3, 0., r)) + core * .8;
  float extra = 0.;
  if (uKind == 2.) extra = pow(abs(cos(a * 3. + n * 2.)), 24.) * smoothstep(1.1, .1, r) * .9;       // ice spikes
  if (uKind == 3.) extra = pow(.5 + .5 * sin(r * 26. - t * 4.), 6.) * smoothstep(1.2, .2, r) * .6;  // ripples
  if (uKind == 4.) extra = pow(fbm(vec2(vP.x * 9., vP.y * 2. - t * 1.6)), 3.) * 1.2;                // gusts streaming up
  v += extra;
  vec3 col = mix(uColA * .7, uColB, smoothstep(.3, 1.1, v)) * v * 1.7;
  col += mix(uColA, uColB, .5) * exp(-max(e, 0.) * 18.) * 1.1;  // bright rim where the magic meets the stone
  float sp;
  if (uKind == 1.) sp = sparks(vec2(vP.x * 16., vP.y * 9. - t * 2.2), t);
  else sp = sparks(vec2((a / 6.2832 + t * .08 * (1. + 1. / (r + .3))) * 26., r * 11.), t);
  col += uSpark * sp * 4.;
  vec3 ember = vec3(.22, .045, .01) * (.3 + .7 * n) * (core + .2);
  col = mix(ember, col, uPower);
  float alpha = mix(.1, .8, uPower) * smoothstep(-.1, .6, v + core);
  gl_FragColor = vec4(col * fade, alpha * fade);
}`;

export function createPowerGate(kind, opts = {}){
  const K = GATE_KINDS[kind];
  if (!K) throw new Error('unknown power gate ' + kind);
  const group = new THREE.Group();
  group.name = 'gate-' + kind;
  addMesh(group, gateStoneGeo(), stoneMat());
  // the magic, filling the innermost arch (a little oversized, tucked behind the stone)
  const [w3, t3] = OPENINGS[OPENINGS.length - 1];
  const uniforms = {
    uTime: { value: 0 }, uPower: { value: 1 }, uHalfW: { value: w3 / 2 }, uSpring: { value: t3 - w3 / 2 }, uKind: { value: K.kind },
    uColA: { value: new THREE.Color(...K.a) }, uColB: { value: new THREE.Color(...K.b) }, uSpark: { value: new THREE.Color(...K.spark) },
  };
  const magicGeo = cached('gate-magic', () => {
    const s = new THREE.Shape(), pts = archPts(w3 + 0.04, t3 + 0.02, 24);
    s.moveTo(...pts[0]); for (const p of pts.slice(1)) s.lineTo(...p);
    return new THREE.ShapeGeometry(s);
  });
  const magic = new THREE.Mesh(magicGeo, new THREE.ShaderMaterial({
    uniforms, vertexShader: MAGIC_VS, fragmentShader: MAGIC_FS,
    transparent: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    depthWrite: false, side: THREE.DoubleSide }));
  magic.renderOrder = 2;
  group.add(magic);
  // the sign, inlaid in the roundel on both faces
  const symGeo = cached('gate-sym-' + kind, () => {
    const front = new THREE.ShapeGeometry(symbolShapes(kind), 10).translate(0, MED_Y, 0.3415);
    return merge([front, front.clone().rotateY(Math.PI)]);
  });
  const symMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(...K.sym), fog: false });
  addMesh(group, symGeo, symMat, false);
  let light = null;
  if (opts.light){ // optional glow on the surroundings (off by default: the game keeps a fixed light count)
    light = new THREE.PointLight(new THREE.Color(...K.a).lerp(new THREE.Color(...K.b), 0.5), 3, 6, 2);
    light.position.set(0, 1.3, 0); group.add(light);
  }
  let active = true, power = 1, last = null;
  const symCol = new THREE.Color(...K.sym), ember = new THREE.Color(0.25, 0.05, 0.01);
  function apply(t){
    uniforms.uPower.value = 0.04 + 0.96 * power;
    const pulse = 1 + 0.12 * Math.sin(t * 2.3);
    symMat.color.copy(ember).lerp(symCol, power).multiplyScalar((0.5 + 2.1 * power) * pulse);
    if (light) light.intensity = (0.15 + 2.85 * power) * pulse;
  }
  apply(0);
  return {
    group,
    update(t){
      const dt = last === null ? 0 : Math.max(0, Math.min(0.1, t - last)); last = t;
      power += ((active ? 1 : 0) - power) * Math.min(1, dt * 1.5);
      uniforms.uTime.value = t;
      apply(t);
    },
    setActive(on){ active = !!on; },
  };
}

// ---------- cell bars ----------

function padlockGeos(){
  return cached('padlock', () => {
    // a heavy rounded lock body hanging below the shackle (origin at the top of the shackle)
    const s = new THREE.Shape();
    s.moveTo(-0.034, -0.05); s.lineTo(0.034, -0.05); s.quadraticCurveTo(0.048, -0.07, 0.045, -0.1);
    s.quadraticCurveTo(0.04, -0.15, 0, -0.152); s.quadraticCurveTo(-0.04, -0.15, -0.045, -0.1); s.quadraticCurveTo(-0.048, -0.07, -0.034, -0.05);
    const body = new THREE.ExtrudeGeometry(s, { depth: 0.026, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.005, bevelSegments: 2, curveSegments: 6 }).translate(0, 0, -0.013);
    const kp = prep(new THREE.CylinderGeometry(0.0085, 0.0085, 0.003, 10).rotateX(Math.PI / 2).translate(0, -0.095, 0.0205), 0.7);
    const key = prep(box(0.004, 0.016, 0.003, 0, -0.103, 0.0222), 0.03);
    const kh = prep(new THREE.CylinderGeometry(0.0035, 0.0035, 0.003, 8).rotateX(Math.PI / 2).translate(0, -0.093, 0.0222), 0.03);
    const sp = curvePts([[-0.022, -0.05], [-0.022, -0.02], [-0.016, -0.004], [0, 0], [0.016, -0.004], [0.022, -0.02], [0.022, -0.05]].map(([x, y]) => [x, y, 0]), 16);
    const shackle = sweep(sp, () => [0.0075, 0.0075], 8, { up: new V3(0, 0, 1) });
    return { body: merge([projUV(body, 4), kp, key, kh]), shackle: prep(scaleUV(shackle, 1, 1)) };
  });
}

function cellGeos(){
  return cached('cell', () => {
    const r = rng(11), j = () => r() - 0.5;
    const frame = [], door = [];
    const bar = (list, x, y0, y1) => list.push(box(0.022, y1 - y0, 0.022, x + j() * 0.006, (y0 + y1) / 2, j() * 0.004, j() * 0.006, 0, j() * 0.006));
    const strap = (list, x0, x1, y) => list.push(box(x1 - x0, 0.055, 0.012, (x0 + x1) / 2, y + j() * 0.006, 0, 0, 0, j() * 0.004));
    for (const xs of [1, -1]){
      frame.push(box(0.07, 3.2, 0.06, xs * 1.265, 1.6, 0));                         // posts into the walls
      for (let k = 0; k < 6; k++) bar(frame, xs * (0.6 + k * 0.12), 0, 3.2);
      for (const y of [0.1, 1.05]) strap(frame, xs > 0 ? 0.52 : -1.23, xs > 0 ? 1.23 : -0.52, y);
      for (const y of [1.05, 0.1]) for (let k = 0; k < 6; k++) frame.push(rivet(new V3(xs * (0.6 + k * 0.12), y, 0.006), new V3(0, 0, 1), 1.1));
    }
    for (let k = 0; k < 8; k++) bar(frame, -0.42 + k * 0.12, 2.12, 3.2);              // the transom above the door
    for (const y of [2.18, 3.1]) strap(frame, -1.23, 1.23, y);
    frame.push(box(0.05, 0.06, 0.05, -0.52, 2.15, 0));                                  // the doorway's head
    for (const y of [0.32, 1.8]){                                                        // hinge pins on the post side
      frame.push(rod(new V3(-0.5, y - 0.05, 0.03), new V3(-0.5, y + 0.05, 0.03), 0.009, 8, false));
      frame.push(box(0.09, 0.025, 0.008, -0.56, y + 0.06, 0.025));
    }
    frame.push(new THREE.TorusGeometry(0.016, 0.0045, 5, 10).translate(0.565, 1.105, 0.022)); // staple for the lock
    // the door in its own space: hinge line at x = 0, latch side at x = 1.0
    door.push(box(0.04, 2.08, 0.018, 0.03, 1.07, 0), box(0.04, 2.08, 0.018, 0.965, 1.07, 0));
    for (const y of [0.1, 1.05, 2.07]) strap(door, 0.01, 0.99, y);
    for (let k = 0; k < 7; k++){ bar(door, 0.135 + k * 0.122, 0.06, 2.1); for (const y of [0.1, 1.05, 2.07]) door.push(rivet(new V3(0.135 + k * 0.122, y, 0.006), new V3(0, 0, 1), 1.1)); }
    door.push(box(1.25, 0.04, 0.01, 0.5, 1.07, -0.012, 0, 0, Math.atan2(1.85, 0.9)));   // diagonal brace behind
    for (const y of [0.32, 1.8]){ door.push(rod(new V3(0, y - 0.045, 0.03), new V3(0, y - 0.11, 0.03), 0.013, 8, false), box(0.2, 0.04, 0.008, 0.1, y - 0.078, 0.014)); }
    door.push(box(0.11, 0.035, 0.006, 1.03, 1.105, 0.015));                             // the hasp, reaching to the staple
    return { frame: merge(frame.map((g) => projUV(g, 2))), door: merge(door.map((g) => projUV(g, 2))) };
  });
}

export function createCellBars(opts = {}){
  const p = cellGeos(), lp = padlockGeos(), group = new THREE.Group(), door = new THREE.Group(), lock = new THREE.Group();
  group.name = 'cell-bars';
  addMesh(group, p.frame, ironMat(opts.env));
  door.position.set(-0.5, 0, 0);
  addMesh(door, p.door, ironMat(opts.env));
  group.add(door);
  const L0 = new V3(0.565, 1.115, 0.03);
  lock.position.copy(L0);
  addMesh(lock, lp.body, ironMat(opts.env));
  const shackle = addMesh(lock, lp.shackle, ironMat(opts.env));
  group.add(lock);
  return {
    group, door, lock,
    setOpen(f){
      f = clamp(f);
      door.rotation.y = -f * 1.75;                      // swings out toward +Z
      const g = smooth(0, 0.12, f), fall = clamp((f - 0.04) / 0.3);
      shackle.position.y = 0.012 * g; shackle.rotation.y = g * 1.1;
      lock.position.set(L0.x + 0.05 * fall, L0.y - (L0.y - 0.032) * fall * fall, L0.z + 0.16 * fall);
      lock.rotation.set(-1.45 * smooth(0.5, 1, fall), 0, 0.4 * fall);
    },
  };
}

// ---------- portcullis ----------

function portcullisGeo(){
  return cached('portcullis', () => {
    const r = rng(5), j = () => r() - 0.5, parts = [];
    const xs = [], ys = [];
    for (let k = 0; k < 11; k++) xs.push(-1.17 + k * 0.234);
    for (let k = 0; k < 10; k++) ys.push(0.26 + k * 0.32);
    for (const x of xs){
      parts.push(box(0.046, 3.08, 0.046, x + j() * 0.006, 0.12 + 1.54, 0, 0, 0, j() * 0.004));
      parts.push(flat(new THREE.ConeGeometry(0.033, 0.13, 4, 1, true).rotateY(Math.PI / 4).rotateX(Math.PI).translate(x, 0.065, 0)));
    }
    for (const y of ys) for (const zs of [1, -1]){
      parts.push(box(2.5, 0.058, 0.014, 0, y + j() * 0.008, zs * 0.03, 0, 0, j() * 0.003));
      for (const x of xs) parts.push(flat(new THREE.ConeGeometry(0.013, 0.008, 4, 1, true).rotateY(Math.PI / 4).rotateX(zs * Math.PI / 2).translate(x, y, zs * 0.041)));
    }
    return merge(parts.map((g) => projUV(g, 1.5, null, r(), r())));
  });
}

export function createPortcullis(opts = {}){
  const group = new THREE.Group(), grid = new THREE.Group();
  group.name = 'portcullis';
  addMesh(grid, portcullisGeo(), ironMat(opts.env));
  group.add(grid);
  return { group, grid, setRaised(f){ grid.position.y = clamp(f) * 3.15; } };
}

// ---------- brazier ----------

function brazierGeos(){
  return cached('brazier', () => {
    const bowl = lathe([[0, 0.858], [0.07, 0.86], [0.15, 0.884], [0.21, 0.93], [0.25, 0.99], [0.27, 1.045], [0.284, 1.068], [0.292, 1.08],
      [0.286, 1.09], [0.272, 1.084], [0.258, 1.062], [0.238, 1.0], [0.195, 0.946], [0.13, 0.905], [0, 0.89]], 26);
    scaleUV(bowl, 3, 1.5);
    const parts = [bowl];
    for (let k = 0; k < 3; k++){ // twisted square legs ending in scrolled feet
      const a = TAU * k / 3 + 0.3, c = Math.cos(a), s = Math.sin(a);
      const pts = curvePts([[0.16, 0.9], [0.205, 0.7], [0.24, 0.45], [0.27, 0.2], [0.3, 0.05], [0.35, 0.018], [0.385, 0.04], [0.378, 0.072], [0.355, 0.064]], 26)
        .map((p) => new V3(p.x * c, p.y, p.x * s));
      parts.push(flat(sweep(pts, (i, t) => { const r = (0.0115 - 0.004 * smooth(0.6, 1, t)) * Math.SQRT2; return [r, r]; }, 4, { phase: Math.PI / 4, twist: 0.28, up: new V3(-s, 0, c), vScale: 2 })));
    }
    parts.push(new THREE.TorusGeometry(0.243, 0.0075, 5, 30).rotateX(Math.PI / 2).translate(0, 0.45, 0));
    // the coals: a heap of broken lumps on a bed
    const r = rng(3), coal = [lathe([[0, 1.03], [0.1, 1.02], [0.2, 0.995], [0.252, 1.0], [0.24, 0.96]], 16)];
    for (let k = 0; k < 13; k++){
      const ang = r() * TAU, rho = Math.sqrt(r()) * 0.19, sz = 0.045 + r() * 0.03;
      const g = new THREE.IcosahedronGeometry(1, 1).scale(sz, sz * (0.6 + 0.3 * r()), sz * (0.8 + 0.3 * r()));
      g.rotateY(r() * TAU).rotateX(j(r) * 0.6);
      jitter(g, sz * 0.25, 30, k);
      coal.push(flat(g.translate(Math.cos(ang) * rho, 1.02 + 0.035 * (1 - rho / 0.2) + sz * 0.2, Math.sin(ang) * rho)));
    }
    return { iron: merge(parts.map((g) => prep(g))), coal: merge(coal) };
  });
}
export function createBrazier(opts = {}){
  const p = brazierGeos(), group = new THREE.Group(), flameAnchor = new THREE.Object3D();
  group.name = 'brazier';
  addMesh(group, p.iron, ironMat(opts.env));
  addMesh(group, p.coal, coalMat());
  flameAnchor.position.set(0, 1.06, 0);
  group.add(flameAnchor);
  return { group, flameAnchor };
}

// ---------- bomb ----------

const BOMB_R = 0.11;
function bombGeos(){
  return cached('bomb', () => {
    const prof = [];
    for (let k = 0; k <= 26; k++){ // a sphere with a raised forging seam round its middle, opening into a collar
      const ph = -Math.PI / 2 + (Math.PI / 2 + 1.28) * Math.pow(k / 26, 1);
      const seam = 0.0028 * Math.exp(-Math.pow(ph / 0.045, 2));
      prof.push([(BOMB_R + seam) * Math.cos(ph), BOMB_R + (BOMB_R + seam) * Math.sin(ph)]);
    }
    const yc = prof[prof.length - 1][1];
    prof.push([0.034, yc + 0.002], [0.036, yc + 0.006], [0.036, yc + 0.022], [0.031, yc + 0.027], [0.02, yc + 0.027], [0.016, yc + 0.02], [0, yc + 0.019]);
    prof[0][0] = 0.0001;
    const body = lathe(prof, 28);
    scaleUV(body, 2, 1);
    // a rune of glowing grooves on front and back: a stave with forked arms
    const strokes = [[[0, -0.045], [0, 0.045]], [[0, 0.004], [-0.03, 0.036]], [[0, 0.004], [0.03, 0.036]], [[0, -0.022], [-0.026, -0.046]], [[0, -0.022], [0.026, -0.046]]];
    const pos = [];
    for (const zs of [1, -1]) for (const [a, b] of strokes){
      const P = [];
      for (let i = 0; i <= 5; i++){
        const x = a[0] + (b[0] - a[0]) * i / 5, y = a[1] + (b[1] - a[1]) * i / 5;
        const n = new V3(x, y, zs * Math.sqrt(Math.max(0, BOMB_R * BOMB_R - x * x - y * y))).normalize();
        P.push([n.clone().multiplyScalar(BOMB_R + 0.0008).add(new V3(0, BOMB_R, 0)), n]);
      }
      const dir = new V3(b[0] - a[0], b[1] - a[1], 0).normalize();
      for (let i = 0; i < 5; i++){
        const [p0, n0] = P[i], [p1] = P[i + 1], w = new V3().crossVectors(n0, dir).multiplyScalar(0.0032);
        const q = [p0.clone().add(w), p0.clone().sub(w), p1.clone().add(w), p1.clone().sub(w)];
        const tri = zs > 0 ? [0, 1, 2, 2, 1, 3] : [0, 2, 1, 2, 3, 1];
        for (const t of tri) pos.push(q[t].x, q[t].y, q[t].z);
      }
    }
    const rune = new THREE.BufferGeometry();
    rune.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    rune.computeVertexNormals();
    const fusePts = curvePts([[0, yc + 0.012, 0], [0.003, yc + 0.04, 0.002], [0.016, yc + 0.064, 0.008], [0.036, yc + 0.074, 0.016], [0.05, yc + 0.07, 0.02]], 14);
    return { body: prep(body, 0.55), rune, fusePts, top: yc };
  });
}

export function createBomb(opts = {}){
  const p = bombGeos(), group = new THREE.Group();
  group.name = 'bomb';
  addMesh(group, p.body, ironMat(opts.env));
  // each bomb burns its own fuse, so the fuse geometry and the glow materials are per instance
  const segs = 6, fuseGeo = atlas(sweep(p.fusePts, () => [0.0034, 0.0034], segs, { caps: false, vScale: 10 }), MISC.cord);
  addMesh(group, fuseGeo, miscMat('cord'));
  const runeMat = new THREE.MeshBasicMaterial({ color: 0xff5a14, fog: false, side: THREE.DoubleSide });
  addMesh(group, p.rune, runeMat, false);
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffb060, fog: false });
  const spark = new THREE.Mesh(cached('bomb-spark', () => new THREE.IcosahedronGeometry(0.0085, 0)), sparkMat);
  group.add(spark);
  const runeCol = new THREE.Color(1, 0.3, 0.06), sparkCol = new THREE.Color(1, 0.62, 0.25);
  const n = p.fusePts.length - 1;
  let phase = 0, last = null;
  return {
    group,
    update(t, fuse = 0){
      const f = clamp(fuse), dt = last === null ? 0 : Math.max(0, Math.min(0.1, t - last)); last = t;
      // the fuse burns down: hide the burnt rings, and the spark sits on what is left
      const left = Math.max(1, Math.round(n * (1 - 0.85 * f)));
      fuseGeo.setDrawRange(0, left * segs * 6);
      spark.position.copy(p.fusePts[left]);
      const fl = 0.7 + 0.3 * Math.sin(t * 53) * Math.sin(t * 31);
      spark.scale.setScalar(0.8 + 0.5 * fl);
      sparkMat.color.copy(sparkCol).multiplyScalar(5 * fl);
      // the rune blinks, faster and harder as the fuse runs out
      phase += dt * (1.2 + 11 * f * f);
      const blink = Math.pow(0.5 + 0.5 * Math.cos(phase * TAU), 3);
      runeMat.color.copy(runeCol).multiplyScalar(0.35 + blink * (1.5 + 5 * f));
    },
  };
}

// ---------- cracked wall ----------

// Voronoi cells over the panel, finer round the weak spot, with jagged shared edges; each cell is a
// slab of wall, slightly shifted, so the cracks between them open into darkness.
function crackedGeos(){
  return cached('cracked', () => {
    const W = 2.6, H = 3.2, D = 0.16, C = [0.1, 1.25], r = rng(21);
    const sites = [];
    for (let k = 0; k < 15; k++){ const a = r() * TAU, d = Math.sqrt(r()) * 0.85; sites.push([C[0] + Math.cos(a) * d, C[1] + Math.sin(a) * d * 1.2]); }
    for (let k = 0; k < 11; k++) sites.push([(r() - 0.5) * W, r() * H]);
    const onEdge = ([x, y]) => Math.abs(Math.abs(x) - W / 2) < 1e-6 || y < 1e-6 || Math.abs(y - H) < 1e-6;
    const key = ([x, y]) => Math.round(x * 1e4) + ',' + Math.round(y * 1e4);
    const parts = [], rubble = [];
    let removed = 0;
    const order = sites.map((s, i) => [Math.hypot(s[0] - C[0], s[1] - C[1]), i]).sort((a, b) => a[0] - b[0]);
    for (const [dist, i] of order){
      const [sx, sy] = sites[i];
      let poly = [[-W / 2, 0], [W / 2, 0], [W / 2, H], [-W / 2, H]];
      for (let k = 0; k < sites.length; k++){
        if (k === i) continue;
        const [tx, ty] = sites[k], nx = tx - sx, ny = ty - sy, c = (nx * (tx + sx) + ny * (ty + sy)) / 2, out = [];
        for (let m = 0; m < poly.length; m++){
          const P = poly[m], Q = poly[(m + 1) % poly.length], dp = nx * P[0] + ny * P[1] - c, dq = nx * Q[0] + ny * Q[1] - c;
          if (dp <= 0) out.push(P);
          if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)){ const t = dp / (dp - dq); out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]); }
        }
        poly = out;
      }
      // jag the inner edges the same way from both sides (offsets keyed on the sorted end points)
      const jag = [];
      for (let m = 0; m < poly.length; m++){
        const P = poly[m], Q = poly[(m + 1) % poly.length];
        jag.push(P);
        if (onEdge(P) && onEdge(Q) && (Math.abs(P[0] - Q[0]) < 1e-6 || Math.abs(P[1] - Q[1]) < 1e-6)) continue;
        const flip = key(P) > key(Q), A = flip ? Q : P, B = flip ? P : Q;
        const len = Math.hypot(B[0] - A[0], B[1] - A[1]), nx = -(B[1] - A[1]) / len, ny = (B[0] - A[0]) / len;
        const seed = hash3(A[0] * 13.1, A[1] * 7.7, B[0] * 3.3 + B[1]);
        const ins = [];
        for (let q = 1; q <= 4; q++){ const t = q / 5, o = (hash3(seed * 91, q, 1) - 0.5) * Math.min(0.06, len * 0.22); ins.push([A[0] + (B[0] - A[0]) * t + nx * o, A[1] + (B[1] - A[1]) * t + ny * o]); }
        jag.push(...(flip ? ins.reverse() : ins));
      }
      // open the cracks: pull each corner toward the middle, more near the weak spot
      let cx = 0, cy = 0; for (const p of jag){ cx += p[0]; cy += p[1]; } cx /= jag.length; cy /= jag.length;
      const near = Math.exp(-dist * dist / 0.6);
      const pts = jag.map((p) => {
        if (onEdge(p)) return p;
        const dx = cx - p[0], dy = cy - p[1], l = Math.hypot(dx, dy) || 1, g = 0.004 + 0.03 * near;
        return [p[0] + dx / l * g, p[1] + dy / l * g];
      });
      if (dist < 0.45 && removed < 2){ removed++; continue; }  // stones already fallen out
      const s = new THREE.Shape(); s.moveTo(...pts[0]); for (const p of pts.slice(1)) s.lineTo(...p);
      const g = new THREE.ExtrudeGeometry(s, { depth: D, bevelEnabled: false }).translate(0, 0, -D);
      // UVs: the wall texture on the face, at its place in the wall; the broken sides box-projected
      projUV(g, 1 / 3.2);
      const pp = g.attributes.position, col = new Float32Array(pp.count * 3);
      for (let k = 0; k < pp.count; k++){ const z = pp.getZ(k), v = 0.1 + 0.9 * Math.pow((z + D) / D, 4); col[k * 3] = v; col[k * 3 + 1] = v * 0.98; col[k * 3 + 2] = v * 0.96; }
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      // loosened stones near the weak spot lean out of the wall
      const push = near * (0.01 + 0.07 * r()), tilt = near * 0.12;
      g.translate(-cx, -cy, 0).rotateX((r() - 0.5) * tilt).rotateY((r() - 0.5) * tilt).rotateZ((r() - 0.5) * tilt * 0.5).translate(cx, cy, push);
      parts.push(g);
    }
    // rubble and grit fallen at the foot of the wall
    for (let k = 0; k < 22; k++){
      const sz = 0.02 + Math.pow(r(), 2) * 0.1;
      const g = jitter(new THREE.IcosahedronGeometry(sz, 0), sz * 0.3, 20, k);
      g.scale(1, 0.7, 1).translate(C[0] + (r() - 0.5) * 1.1, sz * 0.5, 0.04 + r() * 0.28);
      rubble.push([projUV(flat(g), 1), 0.8]);
    }
    const back = prep(new THREE.PlaneGeometry(W, H).translate(0, H / 2, -D - 0.01), 0.02);
    return { stone: merge([...parts, ...rubble, back]) };
  });
}
function rockGeo(k){
  return cached('rock' + k, () => projUV(flat(jitter(new THREE.IcosahedronGeometry(1, 1), 0.28, 2.5, k * 9).scale(1, 0.75 + 0.1 * k, 0.9)), 0.3, null, k * 0.31, k * 0.17));
}

export function createCrackedWall(opts = {}){
  const p = crackedGeos(), group = new THREE.Group();
  group.name = 'cracked-wall';
  addMesh(group, p.stone, stoneMat());
  const r = rng(99);
  return {
    group,
    // ~16 loose rocks spread over the weak part of the wall, already placed in world space
    debris(){
      group.updateWorldMatrix(true, false);
      const out = [];
      for (let k = 0; k < 16; k++){
        const m = new THREE.Mesh(rockGeo(k % 3), stoneMat());
        const s = 0.05 + r() * 0.1, a = r() * TAU, d = Math.sqrt(r()) * 0.9;
        m.scale.setScalar(s); m.rotation.set(r() * TAU, r() * TAU, 0);
        m.position.set(0.1 + Math.cos(a) * d, 1.25 + Math.sin(a) * d * 1.2, 0.05).applyMatrix4(group.matrixWorld);
        m.castShadow = m.receiveShadow = true;
        out.push(m);
      }
      return out;
    },
  };
}

// ---------- skulls ----------

// A human skull deformed from a sphere: long dome, upright face plane, deep sockets and nose, cheekbones,
// brow and upper teeth. Its grid puts more columns round the face than the back of the head, and the
// poles at crown and base, so the face has no pinch. Vertex colours sink the holes into darkness.
function skullGrid(na, np){
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= np; i++){
    const q = i / np, th = Math.PI * (q + 0.075 * Math.sin(TAU * q));  // rows bunched round the face
    for (let j = 0; j <= na; j++){
      const s = 2 * j / na - 1, a = Math.PI * (0.55 * s + 0.45 * s * s * s);
      pos.push(Math.sin(th) * Math.sin(a), Math.cos(th), Math.sin(th) * Math.cos(a)); uv.push(j / na, 1 - i / np);
    }
  }
  for (let i = 0; i < np; i++) for (let j = 0; j < na; j++){
    const a = i * (na + 1) + j, b = a + na + 1, c = a + 1, d = b + 1;
    if (i > 0) idx.push(a, b, c);
    if (i < np - 1) idx.push(c, b, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
function skullGeo(){
  const g = skullGrid(24, 18);
  const p = g.attributes.position, col = new Float32Array(p.count * 3);
  const gauss = (x, y, c, w) => Math.exp(-((x - c[0]) ** 2 + (y - c[1]) ** 2) / (w * w));
  for (let i = 0; i < p.count; i++){
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const front = smooth(0.3, 0.8, z), low = smooth(0.25, -0.5, y);
    // cranium: a long dome, wider at the back; the face narrows below the brow
    let X = x * 0.069 * (1 - 0.3 * front * low) * (1 + 0.06 * smooth(0.3, -0.7, z) * smooth(-0.6, 0.2, y));
    let Y = y * (y > 0 ? 0.078 : 0.07) * (y < 0 ? 1 - 0.38 * smooth(0.35, -0.45, z) : 1);  // the base rises behind the face
    let Z = z * (z > 0 ? 0.09 : 0.1);
    // the face is a nearly flat, upright plane under the brow, the upper jaw a little forward of it
    const plane = 0.071 + 0.005 * smooth(-0.35, -0.6, y) - 0.014 * smooth(-0.62, -0.85, y);
    if (z > 0 && y < 0.38){ const k = smooth(0.38, 0.1, y); Z = Z * (1 - k) + Math.min(Z, plane) * k; }
    if (Y < -0.054) Y = -0.054 + (Y + 0.054) * 0.25;            // flat underside
    let dark = 0;
    for (const s of [-1, 1]){
      // eye sockets: deep round pits with a crisp rim, set in the face plane
      const e = Math.hypot((x - 0.36 * s) / 0.25, (y - 0.04) / 0.22);
      const pit = smooth(1.05, 0.55, e) * front;
      Z -= 0.04 * pit; X -= s * 0.008 * pit; dark = Math.max(dark, smooth(1.0, 0.45, e) * front);
      Z += 0.004 * smooth(1.3, 1.05, e) * smooth(0.9, 1.1, e) * front;  // the rim stands proud
      X += s * 0.011 * gauss(x, y, [0.8 * s, -0.28], 0.25) * smooth(-0.2, 0.5, z);   // cheekbones
      const tf = gauss(x, y, [0.95 * s, -0.15], 0.33) * smooth(0.65, 0.0, z) * smooth(-0.6, 0.15, z);
      X -= s * 0.01 * tf; dark = Math.max(dark, tf * 0.4);                                        // temples, under the cheekbone arch
    }
    // the nose: an inverted heart-shaped hole between and below the eyes
    const nw = 0.06 + 0.07 * smooth(-0.2, -0.45, y);
    const nose = smooth(1, 0.45, Math.hypot(x / nw, (y + 0.32) / 0.15)) * front;
    Z -= 0.026 * nose; dark = Math.max(dark, smooth(0.0, 0.45, nose));
    Z += 0.006 * Math.exp(-(((y - 0.3) / 0.09) ** 2)) * front * smooth(0.8, 0.3, Math.abs(x));  // brow ridge
    // the upper teeth along the bottom of the face, with dark gaps between them
    const teeth = front * smooth(-0.5, -0.58, y);
    const gaps = teeth * smooth(0.2, 0.95, Math.cos(Math.atan2(x, z) * 32)) * 0.8;
    const under = smooth(-0.6, -0.95, y) * 0.45;
    p.setXYZ(i, X, Y, Z);
    const v = (1 - 0.95 * dark) * (1 - gaps) * (1 - under);
    col[i * 3] = v; col[i * 3 + 1] = v * 0.97; col[i * 3 + 2] = v * 0.92;
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return atlas(g, MISC.bone);
}
function longBoneGeo(){
  return atlas(scaleUV(lathe([[0, -0.205], [0.016, -0.2], [0.024, -0.185], [0.022, -0.165], [0.013, -0.14], [0.011, -0.05], [0.0105, 0.05],
    [0.012, 0.14], [0.02, 0.17], [0.025, 0.19], [0.015, 0.205], [0, 0.208]], 7), 1, 1), MISC.bone);
}

export function createSkullPile(opts = {}){
  const geo = cached('skulls', () => {
    const skull = skullGeo(), bone = longBoneGeo(), parts = [];
    const place = (g, [x, y, z], [rx, ry, rz], s = 1) => { g = g.clone().scale(s, s, s).applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz))); g.computeBoundingBox(); return g.translate(x, y - g.boundingBox.min.y, z); };
    parts.push(place(bone, [0.02, 0, 0.05], [Math.PI / 2, 0, 1.1]));
    parts.push(place(bone, [-0.05, 0.0, -0.03], [Math.PI / 2, 0, -0.5], 0.92));
    parts.push(place(bone, [0.07, 0.03, -0.06], [Math.PI / 2 + 0.15, 0, 0.2], 0.85));
    parts.push(place(skull, [0.1, 0, 0.13], [-0.32, 0.25, 0.03]));
    parts.push(place(skull, [-0.12, 0, 0.09], [-0.28, -0.3, -0.06], 0.96));
    parts.push(place(skull, [-0.01, 0.05, -0.07], [0.32, 0.1, 0.22], 0.98));
    const g = merge(parts);
    g.computeBoundingBox();
    const c = g.boundingBox.getCenter(new V3());
    return g.translate(-c.x, 0, -c.z);
  });
  const m = new THREE.Mesh(geo, miscMat('bone'));
  m.castShadow = m.receiveShadow = true; m.name = 'skull-pile';
  return m;
}
