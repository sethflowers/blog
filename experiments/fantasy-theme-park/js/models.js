// The scenery catalogue and the shapes of everything in it. Each model is built once from parts,
// merged into one geometry per material (Model.parts), then drawn instanced (objects.js).
//
// Trees are alpha-tested leaf cards round a dark core, with their normals bent outward from the
// crown's centre (so a crown is lit like a soft ball, not like a pile of cards) and a little wind.
import * as THREE from 'three';
import { mergeParts, rng, lathe, hash2 } from './util.js';
import { mat, texture } from './materials.js';

// --- materials only models use -----------------------------------------------------------------
export const wind = { value: 0 };
const leafMats = new Map();
function leafMat(key){
  let m = leafMats.get(key); if (m) return m;
  const [kind, hex] = key.split(':');
  const T = texture(kind === 'needle' ? 'needles' : 'leaves').map;
  m = new THREE.MeshStandardMaterial({ map: T, alphaTest: 0.5, side: THREE.DoubleSide, color: new THREE.Color(hex), roughness: 0.85 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = wind;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
      #else
        vec3 ip = vec3(0.0);
      #endif
      float sw = max(position.y - 1.5, 0.0) * 0.012;
      transformed.x += sin(uWind * 1.3 + ip.x * 0.21 + ip.z * 0.13 + position.y * 0.4) * sw;
      transformed.z += sin(uWind * 1.1 + ip.z * 0.19 + position.x * 0.5) * sw * 0.7;`);
  };
  m.customProgramCacheKey = () => 'leaf';
  m.name = key;
  leafMats.set(key, m);
  return m;
}
let fallTex = null;
function fallWater(){
  if (fallTex) return fallTex;
  const c = document.createElement('canvas'); c.width = 64; c.height = 256; const g = c.getContext('2d');
  g.fillStyle = 'rgba(200,225,235,0.25)'; g.fillRect(0, 0, 64, 256);
  const r = rng(3);
  for (let i = 0; i < 70; i++){ g.fillStyle = `rgba(255,255,255,${0.2 + r() * 0.5})`; g.fillRect(r() * 64, r() * 256, 1 + r() * 2, 20 + r() * 60); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  fallTex = new THREE.MeshStandardMaterial({ map: t, transparent: true, depthWrite: false, roughness: 0.1, side: THREE.DoubleSide, color: 0xffffff });
  fallTex.name = 'fallwater';
  return fallTex;
}
export function animateModels(t){ wind.value = t; if (fallTex) fallTex.map.offset.y = -t * 0.9; }
const crystal = () => mat('crystal', { c: 0xb8a8f0, r: 0.15, mt: 0.1, e: 0x6a50c0, ei: 0.35 });
export function resolveMat(key){
  if (key.startsWith('leaf:') || key.startsWith('needle:')) return leafMat(key);
  if (key === 'fallwater') return fallWater();
  if (key === 'crystal') return crystal();
  if (key === 'poolwater') return mat('poolwater', { c: 0x2a5a66, r: 0.05, mt: 0.1 });
  if (key === 'leafcore') return mat('leafcore', { c: 0x34502a, r: 1 });
  if (key === 'tint') return mat('tint', { c: 0xffffff, r: 0.7, side: THREE.DoubleSide });
  if (key === 'palm') return mat('palm', { c: 0x4a7a30, r: 0.8, side: THREE.DoubleSide });
  if (key === 'redcap') return mat('redcap', { c: 0xffffff, r: 0.6, vc: true });
  return mat(key);
}

// --- building a model ----------------------------------------------------------------------------
class MB {
  constructor(seed = 1){ this.list = new Map(); this.glows = []; this.r = rng(seed); }
  add(key, geo, pos, rot, scale){
    const m = new THREE.Matrix4().compose(pos ? new THREE.Vector3(...pos) : new THREE.Vector3(), rot instanceof THREE.Quaternion ? rot : new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rot || [0, 0, 0]))), scale ? new THREE.Vector3(...scale) : new THREE.Vector3(1, 1, 1));
    let l = this.list.get(key); if (!l){ l = []; this.list.set(key, l); }
    l.push({ geo, matrix: m });
    return this;
  }
  box(key, x, y, z, w, h, d, ry = 0){ return this.add(key, BOX, [x, y, z], [0, ry, 0], [w, h, d]); }
  cyl(key, x, y, z, rt, rb, h, seg = 12, rot){ return this.add(key, new THREE.CylinderGeometry(rt, rb, h, seg), [x, y, z], rot); }
  sphere(key, x, y, z, r, sx = 1, sy = 1, sz = 1, seg = 12){ return this.add(key, new THREE.SphereGeometry(r, seg, Math.max(6, seg * 0.6 | 0)), [x, y, z], null, [sx, sy, sz]); }
  lathe(key, profile, seg = 16, pos, rot){ return this.add(key, lathe(profile, seg), pos, rot); }
  colored(key, geo, pos, color, rot, scale){
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rot || [0, 0, 0]))), scale ? new THREE.Vector3(...scale) : new THREE.Vector3(1, 1, 1));
    let l = this.list.get(key); if (!l){ l = []; this.list.set(key, l); }
    l.push({ geo, matrix: m, color });
  }
  glow(x, y, z){ this.glows.push([x, y, z]); return this; }
  // a crown of leaf cards in an ellipsoid
  crown(key, cx, cy, cz, rx, ry, rz, n, size, core = 0.5){
    const P = [], Nn = [], U = [], I = [], r = this.r;
    for (let k = 0; k < n; k++){
      const t = 0.5 + 0.5 * Math.sqrt(r()), u = r() * 2 - 1, a = r() * Math.PI * 2, q = Math.sqrt(1 - u * u);
      const px = cx + q * Math.cos(a) * rx * t, py = cy + u * ry * t, pz = cz + q * Math.sin(a) * rz * t;
      // the card faces a random way; its normal points out from the crown
      const nrm = new THREE.Vector3(px - cx, (py - cy) * 0.8 + ry * 0.25, pz - cz).normalize();
      const f = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), s = size * (0.75 + 0.5 * r());
      const ax = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0.3)).normalize().multiplyScalar(s / 2), ay = new THREE.Vector3().crossVectors(f, ax).normalize().multiplyScalar(s / 2);
      const v = P.length / 3;
      for (const [sx, sy, uu, vv] of [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1]]){
        P.push(px + ax.x * sx + ay.x * sy, py + ax.y * sx + ay.y * sy, pz + ax.z * sx + ay.z * sy); Nn.push(nrm.x, nrm.y, nrm.z); U.push(uu, vv);
      }
      I.push(v, v + 1, v + 2, v, v + 2, v + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setIndex(I);
    g.userData.keepUV = true;
    let l = this.list.get(key); if (!l){ l = []; this.list.set(key, l); } l.push({ geo: g, matrix: null });
    if (core) this.sphere('leafcore', cx, cy, cz, 1, rx * core, ry * core, rz * core, 8);
    return this;
  }
  build(info = {}){
    const parts = [];
    for (const [key, l] of this.list){
      const g = mergeParts(l.map((p) => ({ geo: p.geo, matrix: p.matrix, color: p.color })));
      if (g){ g.userData.shared = true; parts.push({ key, geo: g }); }
    }
    let box = new THREE.Box3(); for (const p of parts){ p.geo.computeBoundingBox(); box.union(p.geo.boundingBox); }
    return { parts, glows: this.glows, height: box.max.y, box, ...info };
  }
}
const BOX = new THREE.BoxGeometry(1, 1, 1);

// --- trees -----------------------------------------------------------------------------------------
function trunk(b, h, r0, r1, key = 'bark', lean = 0){ b.cyl(key, lean * h / 2, h / 2, 0, r1, r0, h, 9, [0, 0, -lean]); }
function branch(b, x0, y0, z0, x1, y1, z1, r, key = 'bark'){
  const a = new THREE.Vector3(x0, y0, z0), c = new THREE.Vector3(x1, y1, z1), d = c.clone().sub(a), L = d.length();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  b.add(key, new THREE.CylinderGeometry(r * 0.6, r, L, 6), a.clone().add(c).multiplyScalar(0.5).toArray(), q);
}
const TREES = {
  oak(){ const b = new MB(11); trunk(b, 4.2, 0.42, 0.3);
    for (const [x, y, z] of [[2.2, 5.6, 1.2], [-2.0, 5.3, 1.5], [0.4, 5.8, -2.3], [-0.6, 6.8, 0.2]]){ branch(b, 0, 3.4, 0, x * 0.8, y - 0.4, z * 0.8, 0.2); b.crown('leaf:#5f8a3c', x, y + 0.6, z, 2.4, 1.9, 2.4, 34, 1.9); }
    b.crown('leaf:#6a9442', 0, 7.2, 0, 3.0, 2.2, 3.0, 50, 2.1);
    return b.build({ r: 0.6, canopy: 4.5 }); },
  birch(){ const b = new MB(12); trunk(b, 8, 0.2, 0.1, 'birchbark', 0.04);
    b.crown('leaf:#9ab85a', 0.2, 7.6, 0, 1.9, 3.2, 1.9, 48, 1.4); b.crown('leaf:#a8c062', -0.5, 5.6, 0.6, 1.3, 1.6, 1.3, 18, 1.2);
    return b.build({ r: 0.35, canopy: 2.5 }); },
  pine(){ const b = new MB(13); trunk(b, 12, 0.32, 0.12);
    b.add('leafcore', new THREE.ConeGeometry(2.4, 9, 8), [0, 7.5, 0]);
    for (let t = 0; t < 7; t++){
      const y = 3.6 + t * 1.35, rr = 3.1 * (1 - t / 7.6) + 0.4;
      for (let k = 0; k < 11; k++){ const a = k / 11 * Math.PI * 2 + t; b.crown('needle:#3e6a40', Math.cos(a) * rr * 0.62, y, Math.sin(a) * rr * 0.62, rr * 0.45, 0.55, rr * 0.45, 3, 1.7, 0); }
    }
    b.crown('needle:#46744a', 0, 12.4, 0, 0.6, 1.2, 0.6, 6, 1.1, 0);
    return b.build({ r: 0.5, canopy: 3 }); },
  cypress(){ const b = new MB(14); trunk(b, 2, 0.22, 0.18);
    b.crown('needle:#34583a', 0, 6, 0, 1.15, 5, 1.15, 70, 1.3, 0.75);
    return b.build({ r: 0.5, canopy: 1.2 }); },
  willow(){ const b = new MB(15); trunk(b, 3.6, 0.5, 0.35);
    for (const a of [0, 2.1, 4.2]) branch(b, 0, 3, 0, Math.cos(a) * 2.2, 5.6, Math.sin(a) * 2.2, 0.2);
    b.crown('leaf:#8aac58', 0, 6.4, 0, 3.6, 1.8, 3.6, 46, 1.9);
    // hanging curtains of leaves
    for (let k = 0; k < 26; k++){ const a = k / 26 * Math.PI * 2, rr = 3.1 + b.r() * 0.8; b.crown('leaf:#94b45e', Math.cos(a) * rr, 4.2, Math.sin(a) * rr, 0.35, 1.9, 0.35, 4, 1.3, 0); }
    return b.build({ r: 0.7, canopy: 4.2 }); },
  cherry(){ const b = new MB(16); trunk(b, 2.8, 0.3, 0.22, 'bark', 0.05);
    for (const [x, z] of [[1.4, 0.6], [-1.2, 0.9], [0.2, -1.4]]) { branch(b, 0, 2.4, 0, x, 3.9, z, 0.13); b.crown('leaf:#f2b6c6', x, 4.3, z, 1.7, 1.3, 1.7, 26, 1.4); }
    b.crown('leaf:#f6c4d2', 0, 4.9, 0, 2.2, 1.5, 2.2, 30, 1.5);
    return b.build({ r: 0.4, canopy: 3 }); },
  palm(){ const b = new MB(17);
    let x = 0, y = 0; for (let k = 0; k < 7; k++){ const nx = x + 0.12 * k * 0.4, ny = y + 1.15; b.cyl('bark', (x + nx) / 2, (y + ny) / 2, 0, 0.17, 0.22, 1.2, 8, [0, 0, -0.08 * k * 0.4]); x = nx; y = ny; }
    for (let f = 0; f < 9; f++){
      const a = f / 9 * Math.PI * 2, pts = [];
      for (let s = 0; s <= 5; s++){ const t = s / 5; pts.push([Math.cos(a) * t * 3.6, y + 0.4 + Math.sin(t * Math.PI * 0.75) * 0.9 - t * t * 1.4, Math.sin(a) * t * 3.6, 0.5 * Math.sin(t * Math.PI)]); }
      const P = [], I = [];
      for (const [px, py, pz, w] of pts){ const ox = -Math.sin(a) * w, oz = Math.cos(a) * w; P.push(px + x - ox, py - w * 0.3, pz - oz, px + x + ox, py - w * 0.3, pz + oz, px + x, py, pz); }
      for (let s = 0; s < 5; s++){ const v = s * 3; I.push(v, v + 3, v + 2, v + 2, v + 3, v + 5, v + 2, v + 5, v + 4, v + 2, v + 4, v + 1); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I); g.computeVertexNormals();
      b.add('palm', g);
    }
    b.sphere('darkwood', x, y + 0.2, 0, 0.35);
    return b.build({ r: 0.35, canopy: 3 }); },
  shrub(){ const b = new MB(18); b.crown('leaf:#5a8240', 0, 0.75, 0, 1.0, 0.75, 1.0, 22, 0.95, 0.7); return b.build({ r: 0.6, small: true }); },
  topiaryCone(){ const b = new MB(19); b.add('hedge', new THREE.ConeGeometry(0.85, 2.8, 16), [0, 1.6, 0]); b.cyl('bark', 0, 0.12, 0, 0.08, 0.08, 0.3, 6); return b.build({ r: 0.6 }); },
  topiaryBall(){ const b = new MB(20); b.sphere('hedge', 0, 1.35, 0, 0.75, 1, 1, 1, 16); b.cyl('bark', 0, 0.4, 0, 0.07, 0.08, 0.8, 6); b.sphere('hedge', 0, 0.3, 0, 0.45, 1, 0.6, 1, 12); return b.build({ r: 0.6 }); },
};
const FLOWERS = { red: ['#c8283a', '#e84a50', '#f0d040'], blue: ['#4a5ad0', '#8a6ae0', '#f0f0f0'], gold: ['#f0b020', '#f07020', '#f8e070'], pink: ['#f070a8', '#f8b0d0', '#ffffff'] };
function flowerBed(scheme, square){
  const b = new MB(21), r = b.r, R = 1.7;
  if (square){ for (const [x, z, w, d] of [[0, -R, 2 * R + 0.3, 0.3], [0, R, 2 * R + 0.3, 0.3], [-R, 0, 0.3, 2 * R], [R, 0, 0.3, 2 * R]]) b.box('stone', x, 0.18, z, w, 0.36, d); b.box('soil', 0, 0.12, 0, 2 * R - 0.25, 0.24, 2 * R - 0.25); }
  else { b.lathe('stone', [[R - 0.32, -0.05], [R - 0.32, 0.36], [R + 0.02, 0.38], [R + 0.05, 0.3], [R + 0.05, -0.05]], 28); b.add('soil', new THREE.CylinderGeometry(R - 0.3, R - 0.3, 0.24, 24), [0, 0.12, 0]); }
  const cols = FLOWERS[scheme], leafG = new THREE.IcosahedronGeometry(0.16, 0), flG = new THREE.IcosahedronGeometry(0.07, 0);
  for (let k = 0; k < 90; k++){
    const a = r() * 6.28, d = Math.sqrt(r()) * (R - 0.45); let x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (square){ x = (r() - 0.5) * (2 * R - 0.6); z = (r() - 0.5) * (2 * R - 0.6); }
    b.colored('paint', leafG, [x, 0.3, z], new THREE.Color().setHSL(0.27 + r() * 0.05, 0.45, 0.22 + r() * 0.08), [r(), r(), r()], [1, 0.7, 1]);
    for (let f = 0; f < 3; f++) b.colored('paint', flG, [x + (r() - 0.5) * 0.3, 0.42 + r() * 0.12, z + (r() - 0.5) * 0.3], cols[Math.floor(r() * cols.length)]);
  }
  return b.build({ r: R + 0.1, onPath: true });
}

// --- lights ----------------------------------------------------------------------------------------
function lantern(b, x, y, z, s = 1){
  b.box('lampglass', x, y, z, 0.32 * s, 0.44 * s, 0.32 * s);
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box('iron', x + dx * 0.165 * s, y, z + dz * 0.165 * s, 0.04 * s, 0.48 * s, 0.04 * s);
  b.box('iron', x, y - 0.25 * s, z, 0.38 * s, 0.05 * s, 0.38 * s);
  b.add('iron', new THREE.ConeGeometry(0.3 * s, 0.26 * s, 4), [x, y + 0.36 * s, z], [0, Math.PI / 4, 0]);
  b.sphere('iron', x, y + 0.52 * s, z, 0.045 * s);
  b.sphere('glow', x, y - 0.02 * s, z, 0.1 * s, 1, 1.4, 1, 8);
  b.glow(x, y, z);
}
const LIGHTS = {
  lamp1(){ const b = new MB(31);
    b.lathe('iron', [[0, 0], [0.2, 0], [0.2, 0.12], [0.15, 0.2], [0.15, 0.45], [0.09, 0.6], [0.06, 0.9], [0.05, 2.7], [0.08, 2.78], [0.08, 2.86], [0.11, 2.92], [0, 2.94]], 12);
    lantern(b, 0, 3.2, 0); return b.build({ r: 0.25, onPath: true, light: 1 }); },
  lamp2(){ const b = new MB(32);
    b.lathe('iron', [[0, 0], [0.24, 0], [0.24, 0.14], [0.17, 0.25], [0.17, 0.55], [0.1, 0.7], [0.07, 1], [0.06, 3.3], [0.1, 3.4], [0, 3.45]], 12);
    b.box('iron', 0, 3.42, 0, 1.3, 0.06, 0.06); for (const x of [-0.62, 0.62]){ b.box('iron', x, 3.32, 0, 0.04, 0.2, 0.04); lantern(b, x, 3.0, 0, 0.9); }
    b.add('gold', new THREE.ConeGeometry(0.06, 0.3, 8), [0, 3.62, 0]);
    return b.build({ r: 0.3, onPath: true, light: 2 }); },
  lantern(){ const b = new MB(33);
    b.box('darkwood', 0, 1.5, 0, 0.16, 3, 0.16); b.box('darkwood', 0.35, 2.9, 0, 0.8, 0.1, 0.1); b.box('darkwood', 0.2, 2.65, 0, 0.06, 0.45, 0.06, 0);
    b.box('iron', 0.62, 2.78, 0, 0.02, 0.15, 0.02); lantern(b, 0.62, 2.45, 0, 0.75);
    return b.build({ r: 0.25, onPath: true, light: 1 }); },
  bollard(){ const b = new MB(34);
    b.lathe('iron', [[0, 0], [0.14, 0], [0.14, 0.1], [0.1, 0.16], [0.1, 0.7], [0.13, 0.72], [0, 0.74]], 12);
    b.box('lampglass', 0, 0.82, 0, 0.18, 0.14, 0.18); b.sphere('glow', 0, 0.82, 0, 0.06); b.add('iron', new THREE.ConeGeometry(0.17, 0.12, 4), [0, 0.95, 0], [0, Math.PI / 4, 0]); b.glow(0, 0.82, 0);
    return b.build({ r: 0.2, onPath: true, light: 0.5 }); },
};

// --- furniture -------------------------------------------------------------------------------------
const FURN = {
  bench(){ const b = new MB(41);
    for (const x of [-0.75, 0.75]){ b.box('iron', x, 0.22, 0.12, 0.06, 0.44, 0.06); b.box('iron', x, 0.22, -0.18, 0.06, 0.44, 0.06); b.box('iron', x, 0.44, -0.02, 0.06, 0.05, 0.5); b.box('iron', x, 0.7, -0.24, 0.06, 0.55, 0.05, 0); b.box('iron', x, 0.6, 0.12, 0.06, 0.05, 0.4); }
    for (let k = 0; k < 5; k++) b.box('wood', 0, 0.48, 0.16 - k * 0.085, 1.7, 0.035, 0.07);
    for (let k = 0; k < 3; k++) b.box('wood', 0, 0.62 + k * 0.12, -0.25, 1.7, 0.08, 0.03);
    return b.build({ r: 0.5, onPath: true, seat: true }); },
  bin(){ const b = new MB(42);
    b.lathe('iron', [[0, 0.02], [0.25, 0.02], [0.27, 0.06], [0.27, 0.86], [0.29, 0.9], [0.28, 0.94], [0.16, 1.02], [0.05, 1.05], [0, 1.08]], 16);
    b.cyl('gold', 0, 0.75, 0, 0.276, 0.276, 0.04, 16);
    return b.build({ r: 0.3, onPath: true }); },
  planter(){ const b = new MB(43);
    b.box('stone', 0, 0.35, 0, 1.2, 0.7, 1.2); b.box('stone', 0, 0.72, 0, 1.32, 0.08, 1.32); b.box('soil', 0, 0.78, 0, 1.0, 0.04, 1.0);
    b.crown('leaf:#5a8a42', 0, 1.25, 0, 0.6, 0.5, 0.6, 16, 0.7, 0.7);
    return b.build({ r: 0.7, onPath: true }); },
  picnic(){ const b = new MB(44);
    b.box('wood', 0, 0.74, 0, 1.8, 0.05, 0.8); for (const z of [-0.6, 0.6]) b.box('wood', 0, 0.45, z, 1.8, 0.05, 0.28);
    for (const x of [-0.7, 0.7]) for (const s of [-1, 1]) b.add('wood', BOX, [x, 0.37, 0], [s * 0.6, 0, 0], [0.07, 0.95, 0.07]);
    return b.build({ r: 0.9, onPath: true, seat: true }); },
  clock(){ const b = new MB(45);
    b.lathe('iron', [[0, 0], [0.3, 0], [0.3, 0.2], [0.2, 0.3], [0.2, 0.9], [0.1, 1.1], [0.09, 3.4], [0.16, 3.5], [0, 3.52]], 12);
    b.cyl('iron', 0, 3.95, 0, 0.42, 0.42, 0.24, 24, [Math.PI / 2, 0, 0]); for (const s of [-1, 1]) b.cyl('white', 0, 3.95, s * 0.125, 0.36, 0.36, 0.01, 24, [Math.PI / 2, 0, 0]);
    for (const s of [-1, 1]){ b.box('iron', 0, 4.03, s * 0.135, 0.03, 0.2, 0.005); b.box('iron', 0.08, 3.95, s * 0.135, 0.16, 0.025, 0.005); }
    b.sphere('gold', 0, 4.27, 0, 0.07);
    return b.build({ r: 0.35, onPath: true }); },
};

// --- features ----------------------------------------------------------------------------------------
const FEAT = {
  fountain(){ const b = new MB(51);
    b.lathe('stone', [[3.0, 0], [3.5, 0], [3.55, 0.45], [3.6, 0.5], [3.6, 0.6], [3.2, 0.6], [3.2, 0.18], [0, 0.18]], 40);
    b.add('poolwater', new THREE.CircleGeometry(3.2, 40), [0, 0.45, 0], [-Math.PI / 2, 0, 0]);
    b.lathe('stone', [[0, 0.15], [0.55, 0.15], [0.45, 0.4], [0.28, 0.6], [0.24, 1.6], [0.3, 1.7], [1.2, 1.75], [1.4, 1.95], [1.4, 2.05], [0, 2.05]], 28);
    b.add('poolwater', new THREE.CircleGeometry(1.25, 28), [0, 2.0, 0], [-Math.PI / 2, 0, 0]);
    b.lathe('stone', [[0, 1.95], [0.18, 1.95], [0.12, 2.4], [0.4, 2.55], [0.45, 2.65], [0, 2.7]], 20);
    b.lathe('fallwater', [[1.43, 2.0], [1.5, 1.6], [1.55, 1.0], [1.58, 0.45]], 28);
    b.add('fallwater', new THREE.CylinderGeometry(0.03, 0.07, 1.4, 8, 1, true), [0, 3.35, 0]);
    b.lathe('fallwater', [[0.05, 4.0], [0.25, 3.6], [0.4, 3.0], [0.45, 2.65]], 16);
    return b.build({ r: 3.6, onPath: true, solid: 3.6 }); },
  obelisk(){ const b = new MB(52);
    b.box('stone', 0, 0.3, 0, 1.6, 0.6, 1.6); b.box('stone', 0, 0.9, 0, 1.2, 0.6, 1.2);
    b.add('marble', new THREE.CylinderGeometry(0.28, 0.45, 5, 4), [0, 3.7, 0], [0, Math.PI / 4, 0]);
    b.add('gold', new THREE.ConeGeometry(0.3, 0.5, 4), [0, 6.45, 0], [0, Math.PI / 4, 0]);
    return b.build({ r: 0.9, onPath: true, solid: 0.9 }); },
  urn(){ const b = new MB(53);
    b.box('stone', 0, 0.55, 0, 0.9, 1.1, 0.9); b.box('stone', 0, 1.14, 0, 1.05, 0.08, 1.05);
    b.lathe('marble', [[0, 1.18], [0.22, 1.18], [0.12, 1.3], [0.14, 1.45], [0.42, 1.7], [0.45, 1.95], [0.38, 2.05], [0.42, 2.1], [0, 2.1]], 20);
    b.crown('leaf:#5a8a42', 0, 2.3, 0, 0.45, 0.35, 0.45, 12, 0.5, 0.6);
    return b.build({ r: 0.6, onPath: true, solid: 0.6 }); },
  armillary(){ const b = new MB(54);
    b.lathe('stone', [[0, 0], [0.6, 0], [0.6, 0.15], [0.35, 0.3], [0.25, 1.0], [0.4, 1.15], [0, 1.2]], 16);
    const T = new THREE.TorusGeometry(0.7, 0.03, 6, 40);
    b.add('brass', T, [0, 1.95, 0], [0, 0, 0]); b.add('brass', T, [0, 1.95, 0], [0, Math.PI / 2, 0]); b.add('brass', T, [0, 1.95, 0], [Math.PI / 2, 0, 0.4]);
    b.add('brass', new THREE.TorusGeometry(0.62, 0.025, 6, 36), [0, 1.95, 0], [Math.PI / 2 - 0.41, 0, 0]);
    b.cyl('brass', 0, 1.95, 0, 0.015, 0.015, 1.7, 6, [0.41, 0, 0]); b.sphere('gold', 0, 1.95, 0, 0.1);
    b.cyl('brass', 0, 1.2, 0, 0.04, 0.05, 0.1, 8);
    return b.build({ r: 0.6, onPath: true, solid: 0.6 }); },
  flag(){ const b = new MB(55);
    b.box('stone', 0, 0.2, 0, 0.6, 0.4, 0.6); b.cyl('white', 0, 4.4, 0, 0.04, 0.07, 8, 10); b.sphere('gold', 0, 8.45, 0, 0.09);
    const g = new THREE.PlaneGeometry(1.9, 1.2, 8, 1); const p = g.attributes.position; for (let k = 0; k < p.count; k++) p.setZ(k, Math.sin((p.getX(k) + 0.95) * 2.2) * 0.12 * (p.getX(k) + 0.95));
    g.computeVertexNormals();
    b.add('tint', g, [1.0, 7.6, 0]);
    return b.build({ r: 0.4, onPath: true, tinted: true }); },
  rock(){ return rockModel(61, 1.1); },
  boulder(){ return rockModel(62, 2.4); },
  rocks(){ const b = new MB(63); rockInto(b, 0, 0, 0, 1.6, 1); rockInto(b, 1.9, 0, 0.8, 0.9, 2); rockInto(b, -1.2, 0, 1.6, 0.7, 3); return b.build({ r: 2.2, solid: 2 }); },
  barrels(){ const b = new MB(64);
    for (const [x, z, y] of [[-0.35, 0, 0], [0.35, 0, 0], [0, 0.1, 0.92]]){ b.lathe('wood', [[0, y], [0.28, y], [0.34, y + 0.45], [0.28, y + 0.9], [0, y + 0.9]], 14, [x, 0, z]); for (const h of [0.12, 0.78]) b.cyl('iron', x, y + h, z, 0.31, 0.31, 0.04, 14); }
    return b.build({ r: 0.8, onPath: true, solid: 0.7 }); },
  crates(){ const b = new MB(65); b.box('wood', 0, 0.4, 0, 0.8, 0.8, 0.8, 0.1); b.box('wood', 0.85, 0.3, 0.1, 0.6, 0.6, 0.6, -0.2); b.box('wood', 0.1, 1.1, 0, 0.6, 0.6, 0.6, 0.5);
    return b.build({ r: 0.8, onPath: true, solid: 0.7 }); },
  cannon(){ const b = new MB(66);
    b.box('darkwood', 0, 0.45, 0, 0.7, 0.3, 1.3);
    for (const [x, z] of [[-0.42, -0.45], [0.42, -0.45], [-0.42, 0.45], [0.42, 0.45]]) b.cyl('darkwood', x, 0.3, z, 0.3, 0.3, 0.1, 14, [0, 0, Math.PI / 2]);
    b.lathe('iron', [[0, -0.2], [0.24, -0.2], [0.26, 0.1], [0.2, 0.3], [0.16, 1.5], [0.19, 1.55], [0.12, 1.6], [0, 1.6]], 14, [0, 0.8, -0.3], [-Math.PI / 2 + 0.15, 0, 0]);
    return b.build({ r: 0.8, onPath: true, solid: 0.7 }); },
  toadstool(){ const b = new MB(67);
    b.lathe('white', [[0, 0], [0.5, 0], [0.38, 0.3], [0.3, 1.6], [0.34, 2.0], [0, 2.0]], 16);
    const cap = new THREE.SphereGeometry(1.4, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2); cap.scale(1, 0.55, 1);
    const col = new Float32Array(cap.attributes.position.count * 3), p = cap.attributes.position;
    for (let k = 0; k < p.count; k++){ const spot = hash2(Math.round(p.getX(k) * 3), Math.round(p.getZ(k) * 3), 5) > 0.82 && p.getY(k) > 0.15; col[k * 3] = spot ? 0.95 : 0.62; col[k * 3 + 1] = spot ? 0.93 : 0.08; col[k * 3 + 2] = spot ? 0.88 : 0.06; }
    cap.setAttribute('color', new THREE.BufferAttribute(col, 3)); cap.userData.keepUV = true;
    b.list.set('redcap', [{ geo: cap, matrix: new THREE.Matrix4().makeTranslation(0, 1.9, 0) }]);
    b.add('white', new THREE.CircleGeometry(1.38, 24), [0, 1.9, 0], [Math.PI / 2, 0, 0]);
    return b.build({ r: 0.6, onPath: true, solid: 0.5 }); },
  crystals(){ const b = new MB(68);
    for (let k = 0; k < 7; k++){ const a = k * 2.4, d = k ? 0.5 + b.r() * 0.4 : 0, h = k ? 1 + b.r() * 1.2 : 2.6;
      const g = new THREE.OctahedronGeometry(0.3, 0); g.scale(1, h / 0.6, 1);
      b.add('crystal', g, [Math.cos(a) * d, h / 2 - 0.1, Math.sin(a) * d], [Math.cos(a) * 0.3 * (k ? 1 : 0), 0, Math.sin(a) * 0.3 * (k ? 1 : 0)]); }
    b.glow(0, 1.2, 0);
    return b.build({ r: 0.9, onPath: true, solid: 0.8, light: 0.6 }); },
};
function rockInto(b, x, y, z, s, seed){
  const g = new THREE.IcosahedronGeometry(1, 2), p = g.attributes.position;
  for (let k = 0; k < p.count; k++){ const vx = p.getX(k), vy = p.getY(k), vz = p.getZ(k); const n = 0.75 + 0.5 * hash2(Math.round(vx * 5), Math.round(vy * 5) + Math.round(vz * 5) * 7, seed); p.setXYZ(k, vx * n, Math.max(vy * n * 0.7, -0.3), vz * n); }
  g.computeVertexNormals();
  b.add('rockface', g, [x, y + 0.1 * s, z], [0, seed, 0], [s, s, s]);
}
function rockModel(seed, s){ const b = new MB(seed); rockInto(b, 0, 0, 0, s, seed); return b.build({ r: s * 0.95, solid: s * 0.9 }); }

// --- the catalogue -------------------------------------------------------------------------------
// cat: which tray; r: footprint (m); onPath: may stand on a path; solid: blocks walking within that radius
export const CATALOG = {
  oak: { cat: 'trees', name: 'Oak', make: TREES.oak }, birch: { cat: 'trees', name: 'Silver birch', make: TREES.birch },
  pine: { cat: 'trees', name: 'Scots pine', make: TREES.pine }, cypress: { cat: 'trees', name: 'Cypress', make: TREES.cypress },
  willow: { cat: 'trees', name: 'Weeping willow', make: TREES.willow }, cherry: { cat: 'trees', name: 'Cherry blossom', make: TREES.cherry },
  palm: { cat: 'trees', name: 'Palm', make: TREES.palm },
  shrub: { cat: 'plants', name: 'Shrub', make: TREES.shrub }, topiaryCone: { cat: 'plants', name: 'Topiary cone', make: TREES.topiaryCone },
  topiaryBall: { cat: 'plants', name: 'Topiary ball', make: TREES.topiaryBall },
  bedRed: { cat: 'plants', name: 'Flower bed: red', make: () => flowerBed('red') }, bedBlue: { cat: 'plants', name: 'Flower bed: blue', make: () => flowerBed('blue') },
  bedGold: { cat: 'plants', name: 'Flower bed: gold', make: () => flowerBed('gold', true) }, bedPink: { cat: 'plants', name: 'Flower bed: pink', make: () => flowerBed('pink', true) },
  lamp1: { cat: 'lights', name: 'Gas lamp', make: LIGHTS.lamp1 }, lamp2: { cat: 'lights', name: 'Double lamp', make: LIGHTS.lamp2 },
  lantern: { cat: 'lights', name: 'Lantern post', make: LIGHTS.lantern }, bollard: { cat: 'lights', name: 'Path light', make: LIGHTS.bollard },
  bench: { cat: 'furniture', name: 'Bench', make: FURN.bench }, bin: { cat: 'furniture', name: 'Litter bin', make: FURN.bin },
  planter: { cat: 'furniture', name: 'Planter', make: FURN.planter }, picnic: { cat: 'furniture', name: 'Picnic table', make: FURN.picnic },
  clock: { cat: 'furniture', name: 'Street clock', make: FURN.clock },
  fountain: { cat: 'features', name: 'Fountain', make: FEAT.fountain }, obelisk: { cat: 'features', name: 'Obelisk', make: FEAT.obelisk },
  urn: { cat: 'features', name: 'Urn on a plinth', make: FEAT.urn }, armillary: { cat: 'features', name: 'Armillary sphere', make: FEAT.armillary },
  flag: { cat: 'features', name: 'Flagpole', make: FEAT.flag, colors: ['#b02030', '#2050a0', '#e0b030', '#307040', '#6a3090', '#f0f0f0'] },
  rock: { cat: 'features', name: 'Rock', make: FEAT.rock }, boulder: { cat: 'features', name: 'Boulder', make: FEAT.boulder }, rocks: { cat: 'features', name: 'Rocks', make: FEAT.rocks },
  barrels: { cat: 'props', name: 'Barrels', make: FEAT.barrels }, crates: { cat: 'props', name: 'Crates', make: FEAT.crates },
  cannon: { cat: 'props', name: 'Cannon', make: FEAT.cannon }, toadstool: { cat: 'props', name: 'Giant toadstool', make: FEAT.toadstool },
  crystals: { cat: 'props', name: 'Crystals', make: FEAT.crystals },
};
const built = new Map();
export function model(type){
  let m = built.get(type);
  if (!m){ m = CATALOG[type].make(); built.set(type, m); }
  return m;
}
export const isTree = (type) => CATALOG[type] && (CATALOG[type].cat === 'trees');
