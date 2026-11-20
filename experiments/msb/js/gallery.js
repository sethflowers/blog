// The gallery: a bright main hall with a free-standing wall in the middle, a closed east wing you can
// buy, an entrance onto a little plaza, the art market desk, picture spots on every wall (frames are
// hung there when you hang a picture), decoration spots, and the walls you bump into.
import * as THREE from 'three';
import { mergeVertices } from '/experiments/msb/lib/addons/BufferGeometryUtils.js';
import { V, Batch, textCanvas, roundRect, wrapText, mergeGeometries, boxUV, ellipsoid, paint, placed, rng, hash2, vnoise } from './util.js';

export const H = 5.2;              // ceiling height
export const MAIN = { x0: -14, x1: 14, z0: -10, z1: 10 };
export const WING = { x0: 14.3, x1: 26, z0: -8, z1: 8 };
export const PART = { x0: -5, x1: 5, z0: -0.15, z1: 0.15, h: 3.6 };
export const START = { x: 0, z: 7.5, yaw: 0 };
export const DOOR = { x: 0, z: 10.15 };            // the entrance (visitors come and go here)
export const DESK = { x: -10.2, z: 7.4 };          // the art market desk
const T = 0.3;                                       // wall thickness

// materials (cached by name)
const mats = new Map();
// physically based (MeshStandardMaterial): lit by the sun, the sky light and the room's own reflected
// light (scene.environment, made in main.js). The old brightening glows are toned right down.
function lam(name, opts = {}){
  if (!mats.has(name)){
    const o = { roughness: 0.88, metalness: 0, ...opts };
    if (o.emissive && !opts.glow){ o.emissive = o.emissive.clone().multiplyScalar(0.15); }
    delete o.glow;
    const m = new THREE.MeshStandardMaterial(o); m.name = name; mats.set(name, m);
  }
  return mats.get(name);
}
function bas(name, opts){ if (!mats.has(name)){ const m = new THREE.MeshBasicMaterial(opts); m.name = name; mats.set(name, m); } return mats.get(name); }
function canvasTex(w, h, draw, repeat = true){
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat){ t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}
// a canvas filled pixel by pixel
function pixTex(w, h, fn, repeat = true){
  return canvasTex(w, h, (g) => { const img = g.createImageData(w, h), d = img.data; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){ const c = fn(x, y), i = (y * w + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; } g.putImageData(img, 0, 0); }, repeat);
}
// a normal map from a height function (0..1), for surface relief: grooves, joints, plaster
function normalTex(w, h, height, strength = 2, repeat = true){
  const H = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) H[y * w + x] = height(x, y);
  const t = pixTex(w, h, (x, y) => {
    const at = (a, b) => H[((b + h) % h) * w + ((a + w) % w)];
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1);
    return [(-dx / l * 0.5 + 0.5) * 255, (dy / l * 0.5 + 0.5) * 255, (1 / l * 0.5 + 0.5) * 255];
  }, repeat);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
const woodH = (x, y) => { const c = Math.floor(x / 128), xl = x - c * 128, xh = xl < 64 ? xl : 128 - xl; const q = (y + xh) / 32, f = q - Math.floor(q); const e = Math.min(f, 1 - f) * 32, sm = Math.min(xh, 64 - xh); return (e < 1.3 || sm < 1.1 ? 0 : 1) + vnoise((xh - y) * 0.06, f * 8, 5) * 0.08; };
const stoneH = (x, y) => { const row = Math.floor(y / 32), off = row % 2 ? 32 : 0, fx = (x + off) % 64, fy = y % 32; const j = Math.min(fx, 64 - fx, fy, 32 - fy); return Math.min(1, j / 3) + vnoise(x * 0.25, y * 0.25, 4, 64) * 0.25; };
const paverH = (x, y) => { const fx = x % 128, fy = y % 128, j = Math.min(fx, 128 - fx, fy, 128 - fy); return Math.min(1, j / 2.5) + hash2(x, y, 11) * 0.05; };
const plasterH = (x, y) => vnoise(x * 0.09375, y * 0.09375, 12, 24) * 0.6 + vnoise(x * 0.375, y * 0.375, 13, 96) * 0.4;
// polished oak parquet laid in chevrons (each plank runs from a seam to the next; it tiles every 512 px)
function woodTex(){
  return pixTex(512, 512, (x, y) => {
    const c = Math.floor(x / 128), xl = x - c * 128, half = xl < 64 ? 0 : 1, xh = half ? 128 - xl : xl;
    const q = (y + xh) / 32, stripe = ((Math.floor(q) % 16) + 16) % 16, f = q - Math.floor(q);
    const k = hash2(c * 2 + half, stripe, 3), tone = 0.82 + k * 0.32;
    const along = (xh - y) * 0.7, grain = vnoise(along * 0.05, f * 6 + k * 40, 5, 0) * 0.5 + vnoise(along * 0.21, f * 14, 6) * 0.25;
    let r = (128 + grain * 52) * tone, g = (86 + grain * 36) * tone, b = (54 + grain * 20) * tone;
    const edge = Math.min(f, 1 - f) * 32, seam = Math.min(xh, 64 - xh);
    const dark = (edge < 1.2 ? 0.55 : 1) * (seam < 1.0 ? 0.6 : 1);
    return [r * dark, g * dark, b * dark];
  });
}
// sandstone blocks for the outside walls (each block 0.5 m high, 1 m long: the texture is 2 m square)
function stoneTex(){
  return pixTex(256, 256, (x, y) => {
    const row = Math.floor(y / 32), off = row % 2 ? 32 : 0, col = Math.floor((x + off) / 64);
    const fx = (x + off) % 64, fy = y % 32, joint = fx < 2 || fy < 2;
    const k = hash2(col, row, 9), n = vnoise(x * 0.0625, y * 0.0625, 2, 16) * 0.6 + vnoise(x * 0.3, y * 0.3, 4) * 0.4;
    const t = 0.88 + k * 0.16 + (n - 0.5) * 0.18;
    return joint ? [150, 138, 118] : [222 * t, 204 * t, 170 * t];
  });
}
// big granite paving slabs for the plaza
function paverTex(){
  return pixTex(256, 256, (x, y) => {
    const fx = x % 128, fy = y % 128, joint = fx < 2 || fy < 2, k = hash2(Math.floor(x / 128), Math.floor(y / 128), 4);
    const speck = hash2(x, y, 11), n = vnoise(x * 0.0625, y * 0.0625, 3, 16);
    const t = (k < 0.5 ? 0.86 : 1.0) * (0.9 + n * 0.16) * (speck > 0.93 ? 0.75 : speck < 0.05 ? 1.15 : 1);
    return joint ? [110, 106, 100] : [196 * t, 192 * t, 184 * t];
  });
}
function grassTex(){
  return pixTex(256, 256, (x, y) => {
    const n = vnoise(x * 0.0390625, y * 0.0390625, 1, 10) * 0.5 + vnoise(x * 0.15625, y * 0.15625, 2, 40) * 0.3 + hash2(x, y, 3) * 0.2;
    return [70 + n * 60, 118 + n * 70, 44 + n * 30];
  });
}
function asphaltTex(){
  return pixTex(256, 256, (x, y) => { const n = hash2(x, y, 7) * 0.5 + vnoise(x * 0.09375, y * 0.09375, 2, 24) * 0.5; const v = 62 + n * 34; return [v, v, v + 3]; });
}
function concreteTex(){
  return pixTex(128, 128, (x, y) => { const joint = x % 128 < 2 || y % 64 < 2; const n = hash2(x, y, 5) * 0.4 + vnoise(x * 0.09375, y * 0.09375, 8, 12) * 0.6; const v = joint ? 140 : 182 + n * 30; return [v, v - 2, v - 6]; });
}
function hedgeTex(){
  return pixTex(128, 128, (x, y) => { const n = vnoise(x * 0.25, y * 0.25, 4, [32, 32]) * 0.6 + hash2(x, y, 2) * 0.4; return [36 + n * 50, 78 + n * 70, 28 + n * 30]; });
}
// a townhouse front: windows with white frames and curtains, on a wall that the material's colour tints
function facadeTex(){
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#f0ece4'; g.fillRect(0, 0, w, h);
    const R = rng(21);
    for (let i = 0; i < 1500; i++){ g.fillStyle = `rgba(0,0,0,${R() * 0.05})`; g.fillRect(R() * w, R() * h, 3, 2); }
    // two floors of two windows (each tile = 6 m wide, 6 m high)
    for (const wy of [30, 158]) for (const wx of [40, 156]){
      g.fillStyle = '#d8d2c6'; g.fillRect(wx - 6, wy - 6, 72, 92);
      g.fillStyle = '#fafafa'; g.fillRect(wx - 3, wy - 3, 66, 86);
      const sky = g.createLinearGradient(0, wy, 0, wy + 80); sky.addColorStop(0, '#6a8aa8'); sky.addColorStop(1, '#2a3a4a');
      g.fillStyle = sky; g.fillRect(wx, wy, 60, 80);
      g.fillStyle = R() < 0.5 ? '#c86a5a' : '#e8d8a8'; g.globalAlpha = 0.8; g.fillRect(wx, wy, 14, 80); g.fillRect(wx + 46, wy, 14, 80); g.globalAlpha = 1;
      g.fillStyle = '#fafafa'; g.fillRect(wx + 28, wy, 4, 80); g.fillRect(wx, wy + 36, 60, 4);
      g.fillStyle = '#b8b0a0'; g.fillRect(wx - 8, wy + 82, 76, 8);
    }
  });
}

// the picture frame styles you can choose
export const FRAMES = {
  wood: { name: 'Oak', color: '#9a6a3a', w: 0.07, d: 0.05, price: 0 },
  black: { name: 'Black', color: '#1e1e22', w: 0.05, d: 0.045, price: 0 },
  white: { name: 'White', color: '#f2f0ea', w: 0.06, d: 0.045, price: 40 },
  gold: { name: 'Gold', color: '#d8a83a', w: 0.1, d: 0.06, price: 120 },
  neon: { name: 'Neon', color: '#ff3ab8', w: 0.045, d: 0.04, price: 200, glow: true },
  ornate: { name: 'Palace', color: '#c9932a', w: 0.16, d: 0.08, price: 350, ornate: true },
};
function frameMat(id){
  const F = FRAMES[id] || FRAMES.wood;
  if (F.glow) return bas('frame-' + id, { color: F.color });
  const metal = id === 'gold' || id === 'ornate';
  return lam('frame-' + id, { color: F.color, metalness: metal ? 0.9 : 0, roughness: metal ? 0.32 : id === 'black' ? 0.45 : 0.6 });
}

// what you can buy to decorate the gallery
export const DECOR = {
  plant: { name: 'Potted plant', icon: '🪴', price: 40, fame: 1 },
  bench: { name: 'Bench', icon: '🪑', price: 70, fame: 1 },
  sculpture: { name: 'Sculpture', icon: '🗿', price: 180, fame: 3 },
  rug: { name: 'Big rug', icon: '🟥', price: 90, fame: 1 },
  fountain: { name: 'Little fountain', icon: '⛲', price: 300, fame: 4 },
};

// soft shadows where things meet the floor (a cheap stand-in for ambient occlusion): a dark band
// fading away from the foot of each wall, and soft patches under furniture
let aoStripMat = null, aoBlobMat = null;
function aoMats(){
  if (aoStripMat) return;
  const c = document.createElement('canvas'); c.width = 4; c.height = 64; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 64); gr.addColorStop(0, 'rgba(0,0,0,0.5)'); gr.addColorStop(0.25, 'rgba(0,0,0,0.22)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 64);
  const t = new THREE.CanvasTexture(c); t.flipY = false;
  aoStripMat = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, toneMapped: false }); aoStripMat.name = 'ao';
  const b = document.createElement('canvas'); b.width = b.height = 64; const bg = b.getContext('2d');
  const rg = bg.createRadialGradient(32, 32, 4, 32, 32, 31); rg.addColorStop(0, 'rgba(0,0,0,0.5)'); rg.addColorStop(0.55, 'rgba(0,0,0,0.25)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
  bg.fillStyle = rg; bg.fillRect(0, 0, 64, 64);
  aoBlobMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(b), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, toneMapped: false }); aoBlobMat.name = 'ao';
}
// a flat quad on the floor from (x0, z0) to (x1, z1); v runs from the edge at "from" outward
function floorQuad(x0, z0, x1, z1, y, vAlongZ, flip){
  const g = new THREE.BufferGeometry();
  const P = [x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1];
  let U = vAlongZ ? [0, 0, 1, 0, 1, 1, 0, 1] : [0, 0, 0, 1, 1, 1, 1, 0];
  if (flip) U = U.map((v, i) => (i % 2 ? 1 - v : v));
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  return g;
}
export class Gallery {
  constructor(scene){
    this.scene = scene;
    this.root = new THREE.Group(); scene.add(this.root);
    this.walls = [];       // { x0, x1, z0, z1, tall }
    this.slots = [];       // picture spots
    this.decorSpots = [];  // decoration spots
    this.pick = new THREE.Group(); this.root.add(this.pick);   // invisible boxes for pointing at things
    this.flat = [];
    this.wingOpen = false;
    this.build();
  }

  build(){
    const b = new Batch();
    const rep = (t, k) => { t.repeat.set(k, k); return t; };
    const col = (c) => new THREE.Color(c);
    const nrm = (t, k) => rep(t, k);
    const plasterN = nrm(normalTex(256, 256, plasterH, 1.2), 1 / 1.6), N2 = new THREE.Vector2(0.35, 0.35);
    const P = { normalMap: plasterN, normalScale: N2 };
    const M = {
      wall: lam('wall', { color: '#f3efe6', emissive: col('#2e2c28'), ...P }),
      green: lam('wall-green', { color: '#3e6e58', emissive: col('#0e1c16'), ...P }),
      navy: lam('wall-navy', { color: '#2a4a74', emissive: col('#0a1424'), ...P }),
      red: lam('wall-red', { color: '#7e2c38', emissive: col('#1c080c'), ...P }),
      wWhite: lam('wains-white', { color: '#e2d9c6', emissive: col('#26221c') }), wGreen: lam('wains-green', { color: '#2c5242', emissive: col('#08120e') }),
      wNavy: lam('wains-navy', { color: '#1e385a', emissive: col('#060c18') }), wRed: lam('wains-red', { color: '#5e1e2a', emissive: col('#120406') }),
      rail: lam('rail', { color: '#c9a464', emissive: col('#2a1c06'), metalness: 0.6, roughness: 0.38 }), skirt: lam('skirt', { color: '#2e2822' }),
      floor: new THREE.MeshStandardMaterial({ map: rep(woodTex(), 1 / 4.2), normalMap: nrm(normalTex(512, 512, woodH, 3), 1 / 4.2), normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.3, metalness: 0, envMapIntensity: 0.9 }),
      ceil: lam('ceiling', { color: '#f4f2ee', emissive: col('#6e6b65'), glow: true }), beam: lam('beam', { color: '#ece7dc', emissive: col('#5e5a54'), glow: true }),
      sky: bas('skylight', { color: '#eef7ff' }), lamp: bas('lamp', { color: '#fff3c8' }),
      stone: lam('stone', { map: rep(stoneTex(), 1 / 2), normalMap: nrm(normalTex(256, 256, stoneH, 2.5), 1 / 2), roughness: 0.92 }), cornice: lam('cornice', { color: '#e9dfc8', emissive: col('#1a160e') }), plinth: lam('plinth', { color: '#8c867a' }),
      column: lam('column', { color: '#f2ede2', emissive: col('#22201a') }),
      bronze: lam('bronze', { color: '#3a3630', metalness: 0.6, roughness: 0.45 }), dark: lam('dark', { color: '#2a2a2e' }), trim: lam('trim', { color: '#5a5650' }),
      desk: lam('desk', { color: '#5a3820', roughness: 0.55 }), deskTop: lam('desk-top', { color: '#f2eee6', emissive: col('#26241e'), roughness: 0.22 }),
      rope: lam('rope', { color: '#a01a2a' }), brass: lam('brass', { color: '#d8b04a', emissive: col('#2a1a00'), metalness: 0.85, roughness: 0.3 }),
      glass: Object.assign(new THREE.MeshStandardMaterial({ color: '#cfe6f2', transparent: true, opacity: 0.18, depthWrite: false, roughness: 0.05, metalness: 0.1 }), { name: 'glass' }),
    };
    M.floor.name = 'floor';
    this.M = M;
    const h = H;
    // floors: the hall, the wing, the doorway between them
    b.box(28.6, 0.2, 20.6, M.floor, 0, -0.1, 0, 0, 1);
    b.box(11.7, 0.2, 16, M.floor, (WING.x0 + WING.x1) / 2, -0.1, 0, 0, 1);
    b.box(0.32, 0.2, 4, M.floor, 14.15, -0.1, 0, 0, 1);
    const wall = (x0, x1, z0, z1, y0 = 0, y1 = h, mat = M.wall, collide = true) => {
      b.box(x1 - x0, y1 - y0, z1 - z0, mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, 0, 1);
      if (collide && y0 < 1.5) this.walls.push({ x0, x1, z0, z1, tall: true });
    };
    // the hall: a warm white north wall, a deep green west wall, white south and east walls
    wall(MAIN.x0 - T, MAIN.x1 + T, MAIN.z0 - T, MAIN.z0);
    wall(MAIN.x0 - T, MAIN.x0, MAIN.z0, MAIN.z1 + T, 0, h, M.green);
    // the south wall has tall windows onto the plaza, and the entrance in the middle
    const WIN = [[-12.75, -10.25], [-5.75, -3.25], [3.25, 5.75], [10.25, 12.75]], WY0 = 0.95, WY1 = 4.0;
    this.windows = WIN;
    const xsS = [-14, -12.75, -10.25, -5.75, -3.25, -2, 2, 3.25, 5.75, 10.25, 12.75, 14.3];
    const isWin = (a, c) => WIN.some(([p, q]) => Math.abs(p - a) < 1e-6 && Math.abs(q - c) < 1e-6);
    for (let i = 0; i < xsS.length - 1; i++){
      const a = xsS[i], c = xsS[i + 1];
      if (a === -2) wall(a, c, MAIN.z1, MAIN.z1 + T, 3.2, h, M.wall, false);
      else if (isWin(a, c)){ wall(a, c, MAIN.z1, MAIN.z1 + T, 0, WY0); wall(a, c, MAIN.z1, MAIN.z1 + T, WY1, h, M.wall, false); }
      else wall(a, c, MAIN.z1, MAIN.z1 + T);
    }
    wall(MAIN.x1, MAIN.x1 + T, MAIN.z0, -2); wall(MAIN.x1, MAIN.x1 + T, 2, MAIN.z1);
    wall(MAIN.x1, MAIN.x1 + T, -2, 2, 3.4, h, M.wall, false);
    // the wing: deep red walls (its west wall is the hall's east wall, with a red skin 1 cm thick)
    wall(WING.x0 - 0.01, WING.x1 + T, WING.z0 - T, WING.z0, 0, h - 0.01, M.red);
    wall(WING.x0 - 0.01, WING.x1 + T, WING.z1, WING.z1 + T, 0, h - 0.01, M.red);
    wall(WING.x1, WING.x1 + T, WING.z0, WING.z1, 0, h - 0.01, M.red);
    b.box(0.01, h - 0.02, 6, M.red, 14.305, (h - 0.02) / 2, -5); b.box(0.01, h - 0.02, 6, M.red, 14.305, (h - 0.02) / 2, 5);
    // the free-standing wall: navy blue, with a brass cap
    b.box(PART.x1 - PART.x0, PART.h, PART.z1 - PART.z0, M.navy, 0, PART.h / 2, 0, 0, 1);
    b.box(PART.x1 - PART.x0 + 0.06, 0.06, PART.z1 - PART.z0 + 0.06, M.rail, 0, PART.h + 0.03, 0);
    this.walls.push({ x0: PART.x0, x1: PART.x1, z0: PART.z0, z1: PART.z1, tall: true });
    // panelling below the pictures: a panel 1.5 cm proud, a rail 3 cm, a skirting board 2.5 cm, and stiles
    const RAIL = 0.78;
    aoMats();
    const ao = new Batch();
    const run = (axis, at, dir, a, c, wm) => {
      const L = c - a, mid = (a + c) / 2;
      const piece = (d, y0, y1, m, pa = a, pc = c) => {
        const t = d, cc = at + dir * t / 2, len = pc - pa, mm = (pa + pc) / 2;
        if (axis === 'z') b.box(len, y1 - y0, t, m, mm, (y0 + y1) / 2, cc); else b.box(t, y1 - y0, len, m, cc, (y0 + y1) / 2, mm);
      };
      piece(0.015, 0, RAIL, wm); piece(0.03, RAIL, RAIL + 0.05, M.rail); piece(0.025, 0, 0.14, M.skirt);
      // the soft shadow on the floor at its foot
      const W = 0.6, y = 0.006;
      if (axis === 'z'){ const z1 = at + dir * W; ao.add(floorQuad(a, Math.min(at, z1), c, Math.max(at, z1), y, true, dir < 0), aoStripMat); }
      else { const x1 = at + dir * W; ao.add(floorQuad(Math.min(at, x1), a, Math.max(at, x1), c, y, false, dir < 0), aoStripMat); }
      const n = Math.max(1, Math.round(L / 1.3));
      for (let k = 1; k < n; k++){ const p = a + L * k / n; piece(0.022, 0.14, RAIL, wm, p - 0.025, p + 0.025); }
      void mid;
    };
    run('z', MAIN.z0, 1, MAIN.x0, MAIN.x1, M.wWhite);
    run('x', MAIN.x0, 1, MAIN.z0, MAIN.z1, M.wGreen);
    // (the south wall in the pieces it's built from, so each panel sits against one piece of wall)
    for (let i = 0; i < xsS.length - 1; i++){ const a = Math.max(MAIN.x0, xsS[i]), c = Math.min(MAIN.x1, xsS[i + 1]); if (a === -2) continue; run('z', MAIN.z1, -1, a === 2 ? 2.02 : a, c === -2 ? -2.02 : c, M.wWhite); }
    run('x', MAIN.x1, -1, MAIN.z0, -2.02, M.wWhite); run('x', MAIN.x1, -1, 2.02, MAIN.z1, M.wWhite);
    run('z', WING.z0, 1, 14.31, WING.x1, M.wRed); run('z', WING.z1, -1, 14.31, WING.x1, M.wRed); run('x', WING.x1, -1, WING.z0, WING.z1, M.wRed);
    run('x', 14.31, 1, WING.z0, -2.02, M.wRed); run('x', 14.31, 1, 2.02, WING.z1, M.wRed);
    // round the free-standing wall
    b.box(10.03, RAIL, 0.33, M.wNavy, 0, RAIL / 2, 0); b.box(10.06, 0.05, 0.36, M.rail, 0, RAIL + 0.025, 0); b.box(10.05, 0.14, 0.35, M.skirt, 0, 0.07, 0);
    for (const x of [-3.75, -1.25, 1.25, 3.75]) b.box(0.05, RAIL - 0.14, 0.344, M.wNavy, x, (RAIL + 0.14) / 2, 0);
    // soft shadows round the free-standing wall, under the desk and the columns
    for (const d of [-1, 1]) ao.add(floorQuad(-5.3, d < 0 ? -0.75 : 0.15, 5.3, d < 0 ? -0.15 : 0.75, 0.006, true, d < 0), aoStripMat);
    ao.add(floorQuad(DESK.x - 2.1, DESK.z - 0.9, DESK.x + 2.1, DESK.z + 0.9, 0.007, true, false), aoBlobMat);
    for (const z of [-2.55, 2.55]) ao.add(floorQuad(13.45 - 0.6, z - 0.6, 13.45 + 0.6, z + 0.6, 0.007, true, false), aoBlobMat);
    this.aoMeshes = ao.build(this.root, { shadows: false, receive: false });
    // door frames (4 cm proud): the entrance, and both sides of the wing's doorway
    const frame = (axis, at, dir, a, c, top) => {
      const d = 0.04, cc = at + dir * d / 2;
      if (axis === 'z'){ b.box(0.18, top + 0.16, d, M.rail, a - 0.09, (top + 0.16) / 2, cc); b.box(0.18, top + 0.16, d, M.rail, c + 0.09, (top + 0.16) / 2, cc); b.box(c - a + 0.36, 0.16, d, M.rail, (a + c) / 2, top + 0.08, cc); }
      else { b.box(d, top + 0.16, 0.18, M.rail, cc, (top + 0.16) / 2, a - 0.09); b.box(d, top + 0.16, 0.18, M.rail, cc, (top + 0.16) / 2, c + 0.09); b.box(d, 0.16, c - a + 0.36, M.rail, cc, top + 0.08, (a + c) / 2); }
    };
    frame('z', MAIN.z1, -1, -2, 2, 3.2);
    frame('x', 14.31, 1, -2, 2, 3.4);
    // the wing's doorway, from the hall: two columns holding up a beam
    for (const z of [-2.55, 2.55]){
      b.box(0.52, 0.2, 0.52, M.column, 13.45, 0.1, z); b.cyl(0.2, 0.17, 3.0, M.column, 13.45, 1.7, z, 20); b.box(0.5, 0.2, 0.5, M.column, 13.45, 3.3, z);
      b.cyl(0.235, 0.235, 0.05, M.rail, 13.45, 0.225, z, 20);
      this.walls.push({ x0: 13.2, x1: 13.7, z0: z - 0.25, z1: z + 0.25, tall: true });
    }
    b.box(0.76, 0.3, 5.8, M.column, 13.58, 3.55, 0);
    b.box(0.79, 0.04, 5.83, M.rail, 13.575, 3.72, 0);
    // tall windows: bronze frames, glass, sills inside and out, stone surrounds outside
    for (const [a, c] of WIN){
      const zc = MAIN.z1 + T / 2, wm = (a + c) / 2;
      b.box(0.06, WY1 - WY0, 0.06, M.bronze, a + 0.03, (WY0 + WY1) / 2, zc); b.box(0.06, WY1 - WY0, 0.06, M.bronze, c - 0.03, (WY0 + WY1) / 2, zc);
      b.box(c - a - 0.12, 0.06, 0.06, M.bronze, wm, WY0 + 0.03, zc); b.box(c - a - 0.12, 0.06, 0.06, M.bronze, wm, WY1 - 0.03, zc);
      b.box(0.05, WY1 - WY0 - 0.12, 0.05, M.bronze, wm, (WY0 + WY1) / 2, zc); b.box(c - a - 0.12, 0.05, 0.05, M.bronze, wm, 3.1, zc);
      b.box(c - a - 0.12, WY1 - WY0 - 0.12, 0.012, M.glass, wm, (WY0 + WY1) / 2, zc);
      b.box(c - a + 0.16, 0.04, 0.07, M.rail, wm, WY0 + 0.02, MAIN.z1 - 0.035);
      b.box(c - a + 0.2, 0.07, 0.26, M.cornice, wm, WY0 - 0.035, MAIN.z1 + T + 0.13);
      b.box(0.18, WY1 - WY0 + 0.18, 0.06, M.cornice, a - 0.09, (WY0 + WY1 + 0.18) / 2, 10.47); b.box(0.18, WY1 - WY0 + 0.18, 0.06, M.cornice, c + 0.09, (WY0 + WY1 + 0.18) / 2, 10.47);
      b.box(c - a, 0.18, 0.06, M.cornice, wm, WY1 + 0.09, 10.47);
      b.box(0.32, 0.42, 0.09, M.cornice, wm, WY1 + 0.08, 10.485);
    }
    // the ceiling: beams between the skylights
    // (in pieces round the skylights: the sun shines in through them)
    const slab = (x0, x1, z0, z1, y0) => b.box(x1 - x0, 0.3, z1 - z0, M.ceil, (x0 + x1) / 2, y0 + 0.15, (z0 + z1) / 2, 0, 1);
    const holes = (X0, X1, Z0, Z1, hx, hz, y0) => {
      const zs = [Z0, ...hz.flat(), Z1];
      for (let i = 0; i < zs.length - 1; i++){
        const z0 = zs[i], z1 = zs[i + 1];
        if (i % 2 === 0){ slab(X0, X1, z0, z1, y0); continue; }
        const xs = [X0, ...hx.flat(), X1];
        for (let k = 0; k < xs.length - 1; k += 2) slab(xs[k], xs[k + 1], z0, z1, y0);
      }
    };
    holes(-14.3, 14.3, -10.3, 10.3, [[-11.5, -6.5], [-2.5, 2.5], [6.5, 11.5]], [[-6.3, -3.7], [3.7, 6.3]], h);
    holes(14.3, 26, -8.3, 8.3, [[17, 23]], [[-6.5, -3.9], [3.9, 6.5]], h - 0.01);
    for (const z of [-6.45, -3.55, 3.55, 6.45]) b.box(28, 0.36, 0.3, M.beam, 0, h - 0.18, z);
    for (const x of [-11.65, -6.35, -2.65, 2.65, 6.35, 11.65]) b.box(0.3, 0.36, 20, M.beam, x, h - 0.18, 0);
    for (const z of [-3.65, 3.65]) b.box(11.7, 0.36, 0.3, M.beam, 20.15, h - 0.19, z);
    // skylight glass up in the openings (frosted: it glows, and lets the sun through)
    for (const x of [-9, 0, 9]) for (const z of [-5, 5]) b.box(5, 0.04, 2.6, M.sky, x, h + 0.2, z, 0, 1);
    b.box(6, 0.04, 2.6, M.sky, 20, h + 0.19, -5.2); b.box(6, 0.04, 2.6, M.sky, 20, h + 0.19, 5.2);
    // pendant lamps
    for (const [x, z] of [[-9, 0], [9, 0], [0, 8.2], [-9, 8.2], [9, 8.2], [20.15, 0]]){
      b.cyl(0.008, 0.008, h - 3.3, M.dark, x, (h + 3.3) / 2, z, 6);
      b.cyl(0.12, 0.42, 0.34, M.bronze, x, 3.13, z, 22);
      b.cyl(0.38, 0.38, 0.02, M.lamp, x, 2.955, z, 22);
    }
    // the art market desk: walnut, a marble top, brass trim
    b.box(3.2, 1.0, 0.9, M.desk, DESK.x, 0.5, DESK.z); b.box(3.36, 0.06, 1.04, M.deskTop, DESK.x, 1.03, DESK.z);
    b.box(3.22, 0.04, 0.92, M.brass, DESK.x, 0.08, DESK.z);
    for (const dx of [-1.05, 0, 1.05]) b.box(0.9, 0.62, 0.02, M.wGreen, DESK.x + dx, 0.55, DESK.z + 0.46);
    b.box(0.5, 0.32, 0.4, M.dark, DESK.x + 0.9, 1.22, DESK.z - 0.1);
    b.cyl(0.08, 0.06, 0.3, M.column, DESK.x - 1.1, 1.21, DESK.z, 14);
    this.walls.push({ x0: DESK.x - 1.68, x1: DESK.x + 1.68, z0: DESK.z - 0.52, z1: DESK.z + 0.52, tall: false });
    // the wing's rope barrier (until you buy the wing)
    this.barrier = new THREE.Group();
    const bb = new Batch();
    for (const z of [-1.7, 0, 1.7]){ bb.cyl(0.05, 0.05, 1.0, M.brass, 13.0, 0.5, z, 10); bb.cyl(0.18, 0.18, 0.04, M.brass, 13.0, 0.02, z, 14); bb.add(new THREE.SphereGeometry(0.07, 10, 8), M.brass, new THREE.Matrix4().makeTranslation(13.0, 1.04, z)); }
    for (const z of [-0.85, 0.85]){ const c = new THREE.CatmullRomCurve3([V(13.0, 0.93, z - 0.85), V(13.0, 0.78, z), V(13.0, 0.93, z + 0.85)]); bb.add(new THREE.TubeGeometry(c, 12, 0.025, 6), M.rope); }
    bb.build(this.barrier, { shadows: true });
    this.barrierSign = this.sign('East wing\nopening soon', 'Buy it in the 🛒 shop', 1.1, 0.7, '#3a2a6a');
    this.barrierSign.position.set(12.9, 1.7, 0); this.barrierSign.rotation.y = -Math.PI / 2; this.barrier.add(this.barrierSign);
    this.root.add(this.barrier);
    this.barrierWall = { x0: 12.9, x1: 14.05, z0: -2, z1: 2, tall: true };
    this.walls.push(this.barrierWall);
    // the gallery's name in gold letters high on the north wall, and over the door inside
    this.root.add(this.lettering('MSB GALLERY', 'MAKE · SELL · BUY', 8.4, 1.1, -9.99, 0, 4.05, 0));
    const ds = this.sign('🛒 ART MARKET', 'Buy art, frames & decorations', 2.4, 0.7, '#7a2a44');
    ds.position.set(DESK.x, 2.3, DESK.z + 0.1); this.root.add(ds);
    const ds2 = ds.clone(); ds2.rotation.y = Math.PI; ds2.position.z -= 0.02; this.root.add(ds2);
    this.deskPick = this.addPick(DESK.x, 1.2, DESK.z, 3.3, 2.6, 1.2, { kind: 'desk' });
    // a welcome mat at the door
    b.box(3, 0.02, 1.6, lam('mat', { color: '#5a2a3a' }), 0, 0.012, 8.9);
    b.build(this.root);
    this.buildFacade();
    this.buildOutside();
    this.buildSlots();
    this.buildDecorSpots();
  }
  // big letters (a canvas on a plane, no background)
  lettering(title, sub, w, h, z, x, y, ry){
    const W = 1024, Hh = Math.round(W * h / w), tc = textCanvas(W, Hh), g = tc.ctx;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const gr = g.createLinearGradient(0, 0, 0, Hh * 0.7); gr.addColorStop(0, '#f8e2a0'); gr.addColorStop(0.5, '#d4a548'); gr.addColorStop(1, '#a87a28');
    g.font = `900 ${Math.round(Hh * 0.5)}px Georgia, "Times New Roman", serif`;
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillText(title, W / 2 + 4, Hh * 0.38 + 5);
    g.fillStyle = gr; g.fillText(title, W / 2, Hh * 0.38);
    g.font = `bold ${Math.round(Hh * 0.17)}px Arial`; g.fillStyle = '#b8903c'; g.fillText(sub.split('').join(String.fromCharCode(8202)), W / 2, Hh * 0.83);
    tc.tex.needsUpdate = true;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tc.tex, transparent: true, depthWrite: false, toneMapped: false }));
    m.position.set(x, y, z); m.rotation.y = ry;
    return m;
  }

  // a sign: a canvas drawn once, on a plane
  sign(title, sub, w, h, bg){
    const px = 512, tc = textCanvas(px, Math.round(px * h / w)), g = tc.ctx, W = tc.canvas.width, Hh = tc.canvas.height;
    g.fillStyle = bg; roundRect(g, 0, 0, W, Hh, 24); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 6; roundRect(g, 8, 8, W - 16, Hh - 16, 18); g.stroke();
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const lines = title.split('\n'); let fs = Math.min(Hh * (sub ? 0.36 : 0.5) / lines.length * 1.4, 90);
    g.font = `bold ${fs}px Arial`; while (lines.some((l) => g.measureText(l).width > W - 40) && fs > 14){ fs -= 2; g.font = `bold ${fs}px Arial`; }
    lines.forEach((l, i) => g.fillText(l, W / 2, Hh * (sub ? 0.42 : 0.5) + (i - (lines.length - 1) / 2) * fs * 1.05));
    if (sub){ g.font = `${Math.round(fs * 0.48)}px Arial`; g.fillStyle = '#ffe8a8'; g.fillText(sub, W / 2, Hh * 0.8); }
    tc.tex.needsUpdate = true;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tc.tex, toneMapped: false }));
    return m;
  }
  addPick(x, y, z, sx, sy, sz, data, ry = 0){
    const m = new THREE.Mesh(this.pickGeo || (this.pickGeo = new THREE.BoxGeometry(1, 1, 1)), this.pickMat || (this.pickMat = new THREE.MeshBasicMaterial({ visible: false })));
    m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.y = ry; m.userData = data; this.pick.add(m); m.updateMatrixWorld(true);
    return m;
  }

  // ---------- the outside of the building ----------
  buildFacade(){
    const b = new Batch(), M = this.M;
    const box = (x0, x1, z0, z1, y0, y1, m) => b.box(x1 - x0, y1 - y0, z1 - z0, m, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, 0, 1);
    const TOP = 6.0, C0 = 5.25, C1 = 5.55, P1 = 0.45;   // parapet top, cornice band, plinth top
    // stone cladding on every outside wall (straight onto the wall), a projecting cornice, a granite plinth
    const clad = (x0, x1, z0, z1, y0 = -0.25, y1 = TOP) => box(x0, x1, z0, z1, y0, y1, M.stone);
    clad(-14.44, 14.44, -10.44, -10.3); clad(-14.44, -14.3, -10.3, 10.44);
    const xs = [-14.44, -12.75, -10.25, -5.75, -3.25, -2, 2, 3.25, 5.75, 10.25, 12.75, 14.44];
    for (let i = 0; i < xs.length - 1; i++){
      const a = xs[i], c = xs[i + 1], win = this.windows.some(([p, q]) => Math.abs(p - a) < 1e-6 && Math.abs(q - c) < 1e-6);
      if (a === -2) clad(a, c, 10.3, 10.44, 3.2, TOP);
      else if (win){ clad(a, c, 10.3, 10.44, -0.25, 0.88); clad(a, c, 10.3, 10.44, 4.0, TOP); }
      else clad(a, c, 10.3, 10.44);
      if (a !== -2) box(a, c, 10.44, 10.48, -0.25, P1, M.plinth);
    }
    clad(14.3, 14.44, -10.3, -8.44); clad(14.3, 14.44, 8.44, 10.3);
    clad(14.3, 26.44, -8.44, -8.3); clad(14.3, 26.44, 8.3, 8.44); clad(26.3, 26.44, -8.3, 8.3);
    // plinth and cornice: north, west, (south done above), the corners by the wing, the wing
    box(-14.48, 14.48, -10.48, -10.44, -0.25, P1, M.plinth); box(-14.48, -14.44, -10.44, 10.48, -0.25, P1, M.plinth);
    box(14.44, 14.48, -10.48, -8.48, -0.25, P1, M.plinth); box(14.44, 14.48, 8.48, 10.48, -0.25, P1, M.plinth);
    box(14.44, 26.48, -8.48, -8.44, -0.25, P1, M.plinth); box(14.44, 26.48, 8.44, 8.48, -0.25, P1, M.plinth); box(26.44, 26.48, -8.44, 8.44, -0.25, P1, M.plinth);
    const K = 0.2;
    box(-14.44 - K, 14.44 + K, -10.44 - K, -10.44, C0, C1, M.cornice); box(-14.44 - K, -14.44, -10.44, 10.44, C0, C1, M.cornice);
    box(-14.44 - K, 14.44 + K, 10.44, 10.44 + K, C0, C1, M.cornice);
    box(14.44, 14.44 + K, -10.44, -8.44 - K, C0, C1, M.cornice); box(14.44, 14.44 + K, 8.44 + K, 10.44, C0, C1, M.cornice);
    box(14.44, 26.44 + K, -8.44 - K, -8.44, C0, C1, M.cornice); box(14.44, 26.44 + K, 8.44, 8.44 + K, C0, C1, M.cornice); box(26.44, 26.44 + K, -8.44, 8.44, C0, C1, M.cornice);
    // little blocks (dentils) under the front cornice
    for (let x = -14.3; x <= 14.3; x += 0.5) box(x - 0.08, x + 0.08, 10.44, 10.54, C0 - 0.12, C0, M.cornice);
    // the entrance: a landing, a canopy on two columns, lights under it
    box(-3.3, 3.3, 10.44, 12.9, -0.2, -0.005, M.plinth);
    box(-3.4, 3.4, 10.44, 13.0, 3.5, 3.76, M.cornice);
    box(-3.44, 3.44, 12.96, 13.04, 3.46, 3.8, M.rail);
    for (const x of [-3.0, 3.0]){
      b.box(0.5, 0.2, 0.5, M.column, x, 0.1 - 0.005, 12.6); b.cyl(0.2, 0.17, 3.1, M.column, x, 1.745, 12.6, 20); b.box(0.5, 0.2, 0.5, M.column, x, 3.395, 12.6);
      this.walls.push({ x0: x - 0.25, x1: x + 0.25, z0: 12.35, z1: 12.85, tall: true });
    }
    for (const x of [-1.6, 0, 1.6]) b.cyl(0.14, 0.14, 0.02, M.lamp, x, 3.49, 11.7, 14);
    b.build(this.root);
    // the name over the canopy, and banners
    this.root.add(this.lettering('MSB GALLERY', 'MAKE · SELL · BUY', 6.4, 1.15, 10.46, 0, 4.55, 0));
    const banner = (word, colA, colB, x, z, ry) => {
      const tc = textCanvas(256, 512), g = tc.ctx;
      const gr = g.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, colA); gr.addColorStop(1, colB); g.fillStyle = gr; g.fillRect(0, 0, 256, 512);
      g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(14, 0, 6, 512); g.fillRect(236, 0, 6, 512);
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '900 92px Georgia, serif';
      [...word].forEach((ch, i) => g.fillText(ch, 128, 90 + i * 98));
      g.font = 'bold 26px Arial'; g.fillText('MSB GALLERY', 128, 480);
      tc.tex.needsUpdate = true;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.2), new THREE.MeshLambertMaterial({ map: tc.tex, emissive: new THREE.Color('#222'), side: THREE.DoubleSide }));
      m.position.set(x, 3.75, z); m.rotation.y = ry; m.castShadow = true; this.root.add(m);
      const rod = new THREE.Mesh(this.rodGeo || (this.rodGeo = new THREE.CylinderGeometry(0.02, 0.02, 1.3, 8).rotateZ(Math.PI / 2)), M.bronze); rod.position.set(x, 4.88, z); rod.rotation.y = ry; this.root.add(rod);
    };
    banner('MAKE', '#e04a8a', '#a02a5a', -8, 10.62, 0);
    banner('SELL', '#2aa860', '#16703c', 8, 10.62, 0);
    banner('BUY', '#3a7ad8', '#1e4a98', 20.2, 8.62, 0);
  }

  buildOutside(){
    // everything outside the building lives in its own group
    const keep = this.root; this.outside = new THREE.Group(); keep.add(this.outside); this.root = this.outside;
    try { this.buildOutsideNow(); } finally { this.root = keep; }
  }
  buildOutsideNow(){
    const b = new Batch(), M = this.M;
    const rep = (t, k) => { t.repeat.set(k, k); return t; };
    const O = {
      plaza: lam('plaza', { map: rep(paverTex(), 1 / 2), normalMap: rep(normalTex(256, 256, paverH, 2.5), 1 / 2), roughness: 0.8 }), grass: lam('grass', { map: rep(grassTex(), 1 / 3) }),
      hedge: lam('hedge', { map: rep(hedgeTex(), 1 / 1.2) }), asphalt: lam('asphalt', { map: rep(asphaltTex(), 1 / 4) }),
      concrete: lam('concrete', { map: rep(concreteTex(), 1 / 2) }), curb: lam('curb', { color: '#b4b0a6' }), paint: lam('road-paint', { color: '#eeeae0' }),
      soil: lam('soil', { color: '#4a3424' }), wood: lam('bench-wood', { color: '#8a5a32' }), roof: lam('roof', { color: '#4a4c54' }),
    };
    const facade = facadeTex(); facade.repeat.set(1 / 6, 1 / 6);
    const houseMats = ['#c86450', '#e8dcc0', '#8aa0b8', '#9ab08a', '#d8a868', '#b8b0c8'].map((c, i) => lam('house' + i, { color: c, map: facade }));
    const box = (x0, x1, z0, z1, y0, y1, m, uv = 1) => b.box(x1 - x0, y1 - y0, z1 - z0, m, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, 0, uv);
    // the ground
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), O.grass); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.25; ground.receiveShadow = true;
    ground.geometry.attributes.uv.array.forEach((v, i, a) => { a[i] = v * 400; }); this.root.add(ground);
    // the plaza, a round inlay where the fountain goes
    box(-18, 18, 10.15, 22.35, -0.22, -0.02, O.plaza);
    const inlayTex = canvasTex(256, 256, (g) => { g.fillStyle = '#8a8478'; g.beginPath(); g.arc(128, 128, 127, 0, 7); g.fill(); g.strokeStyle = '#c8c0b0'; g.lineWidth = 8; for (const r of [120, 92, 64]){ g.beginPath(); g.arc(128, 128, r, 0, 7); g.stroke(); } for (let k = 0; k < 16; k++){ const a = k / 16 * 6.283; g.beginPath(); g.moveTo(128 + Math.cos(a) * 64, 128 + Math.sin(a) * 64); g.lineTo(128 + Math.cos(a) * 120, 128 + Math.sin(a) * 120); g.stroke(); } }, false);
    const inlay = new THREE.Mesh(new THREE.CircleGeometry(3, 40), new THREE.MeshLambertMaterial({ map: inlayTex, transparent: true }));
    inlay.rotation.x = -Math.PI / 2; inlay.position.set(0, -0.012, 15.5); inlay.receiveShadow = true; this.root.add(inlay);
    // hedges round the plaza (they keep you in) on a low stone curb
    const hedge = (x0, x1, z0, z1) => { box(x0, x1, z0, z1, -0.1, 1.25, O.hedge); box(x0 - 0.06, x1 + 0.06, z0 - 0.06, z1 + 0.06, -0.25, 0.08, M.plinth); this.walls.push({ x0, x1, z0, z1, tall: true }); };
    hedge(-17, 17, 21.6, 22.4); hedge(-17.8, -17, 10.3, 22.4); hedge(17, 17.8, 10.3, 22.4);
    void hedge;
    // planters along the front, full of flowers
    const flowers = [];
    for (const xc of [-8, 8]){
      box(xc - 1.4, xc + 1.4, 10.6, 11.4, -0.02, 0.55, M.cornice); box(xc - 1.3, xc + 1.3, 10.7, 11.3, 0.4, 0.5, O.soil);
      for (let k = 0; k < 34; k++) flowers.push([xc - 1.2 + Math.random() * 2.4, 0.5 + Math.random() * 0.12, 10.75 + Math.random() * 0.5]);
      this.walls.push({ x0: xc - 1.4, x1: xc + 1.4, z0: 10.6, z1: 11.4, tall: false });
    }
    // flower beds along the hedges
    for (const [x0, x1, z] of [[-16.6, -6, 20.9], [6, 16.6, 20.9]]){
      box(x0, x1, z - 0.5, z + 0.5, -0.02, 0.18, M.cornice); box(x0 + 0.1, x1 - 0.1, z - 0.4, z + 0.4, 0.05, 0.16, O.soil);
      for (let k = 0; k < 60; k++) flowers.push([x0 + 0.2 + Math.random() * (x1 - x0 - 0.4), 0.16 + Math.random() * 0.12, z - 0.35 + Math.random() * 0.7]);
      this.walls.push({ x0, x1, z0: z - 0.5, z1: z + 0.5, tall: false });
    }
    // park benches facing the fountain
    const bench = (x, z, ry) => {
      const parts = [];
      for (let k = 0; k < 4; k++) parts.push(paint(boxUV(1.8, 0.04, 0.09).translate(0, 0.45, -0.18 + k * 0.12), '#8a5a32'));
      for (let k = 0; k < 3; k++) parts.push(paint(boxUV(1.8, 0.09, 0.035).translate(0, 0.62 + k * 0.13, -0.27).rotateX(-0.12), '#8a5a32'));
      for (const sx of [-0.8, 0.8]){ parts.push(paint(boxUV(0.06, 0.45, 0.5).translate(sx, 0.225, -0.05), '#2a2a2e')); parts.push(paint(boxUV(0.06, 0.5, 0.05).translate(sx, 0.7, -0.29), '#2a2a2e')); }
      const g = mergeGeometries(parts); g.applyMatrix4(new THREE.Matrix4().compose(V(x, -0.02, z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), ry), V(1, 1, 1)));
      b.add(g, this.vcMat || (this.vcMat = lam('vc', { vertexColors: true })));
      const along = Math.abs(Math.sin(ry)) > 0.5;
      this.walls.push(along ? { x0: x - 0.3, x1: x + 0.3, z0: z - 0.95, z1: z + 0.95, tall: false } : { x0: x - 0.95, x1: x + 0.95, z0: z - 0.3, z1: z + 0.3, tall: false });
    };
    bench(-5.6, 15.5, -Math.PI / 2); bench(5.6, 15.5, Math.PI / 2); bench(-11, 18.6, Math.PI); bench(11, 18.6, Math.PI);
    // street lamps
    for (const [x, z] of [[-4.2, 19.6], [4.2, 19.6], [-13.5, 13.6], [13.5, 13.6], [-14, 21], [14, 21], [-40, 23.6], [-20, 23.6], [0, 23.6], [20, 23.6], [40, 23.6]]){
      b.cyl(0.13, 0.13, 0.4, M.bronze, x, 0.0, z, 10); b.cyl(0.05, 0.07, 3.6, M.bronze, x, 2.0, z, 8);
      b.cyl(0.16, 0.1, 0.12, M.bronze, x, 3.86, z, 8); b.cyl(0.12, 0.15, 0.4, M.lamp, x, 4.12, z, 8); b.cyl(0.03, 0.2, 0.18, M.bronze, x, 4.41, z, 8);
      if (z < 22) this.walls.push({ x0: x - 0.15, x1: x + 0.15, z0: z - 0.15, z1: z + 0.15, tall: false });
    }
    // the street beyond the hedge: pavements, kerbs, the road with its markings
    box(-90, 90, 22.4, 24.6, -0.22, 0.0, O.concrete); box(-90, 90, 24.6, 24.8, -0.22, 0.02, O.curb);
    box(-90, 90, 24.8, 31.0, -0.24, -0.1, O.asphalt);
    for (let x = -88; x < 90; x += 6) box(x, x + 3, 27.92, 28.08, -0.1, -0.095, O.paint);
    box(-90, 90, 31.0, 31.2, -0.22, 0.02, O.curb); box(-90, 90, 31.2, 33.4, -0.22, 0.0, O.concrete);
    // townhouses across the road
    const R = rng(77);
    for (let x = -66; x < 66;){
      const w = 7 + Math.floor(R() * 4), hh = 7 + Math.floor(R() * 3) * 3, m = houseMats[Math.floor(R() * houseMats.length)];
      const x0 = x, x1 = x + w - 0.02;
      box(x0, x1, 33.6, 41.5, -0.25, hh, m, 1);
      box(x0 - 0.05, x1 + 0.05, 33.5, 41.6, hh, hh + 0.3, M.cornice);
      // a pitched roof (or a flat one with a parapet)
      if (R() < 0.6){
        const g = new THREE.BufferGeometry(), y0 = hh + 0.3, y1 = y0 + 2.6, z0 = 33.5, z1 = 41.6, zc = (z0 + z1) / 2;
        const P = [x0, y0, z0, x1, y0, z0, x1, y1, zc, x0, y0, z0, x1, y1, zc, x0, y1, zc, x1, y0, z1, x0, y0, z1, x0, y1, zc, x1, y0, z1, x0, y1, zc, x1, y1, zc,
          x0, y0, z0, x0, y1, zc, x0, y0, z1, x1, y0, z0, x1, y0, z1, x1, y1, zc];
        for (let t = 0; t < P.length; t += 9) for (let k = 0; k < 3; k++){ const tmp = P[t + 3 + k]; P[t + 3 + k] = P[t + 6 + k]; P[t + 6 + k] = tmp; }   // wound to face outwards
        g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.computeVertexNormals();
        b.add(g, O.roof);
      } else box(x0, x1, 33.6, 41.5, hh + 0.3, hh + 1.0, m, 1);
      box(x0 + w / 2 - 0.6, x0 + w / 2 + 0.6, 33.58, 33.62, -0.02, 2.3, M.desk);
      box(x0 + w / 2 - 0.9, x0 + w / 2 + 0.9, 33.0, 33.6, -0.02, 0.18, M.cornice);
      x += w;
    }
    b.build(this.root, { shadows: true });
    this.buildFlowers(flowers);
    this.buildTrees();
    this.buildCars();
    this.buildHills();
  }
  buildFlowers(list){
    const g = new THREE.IcosahedronGeometry(0.06, 0), m = new THREE.MeshLambertMaterial({ color: '#fff' });
    const im = new THREE.InstancedMesh(g, m, list.length), mx = new THREE.Matrix4(), c = new THREE.Color();
    const cols = ['#ff4a7a', '#ffd23a', '#ffffff', '#c84aff', '#ff8a3a', '#ff3a3a'];
    list.forEach(([x, y, z], i) => { mx.makeTranslation(x, y, z); im.setMatrixAt(i, mx); im.setColorAt(i, c.set(cols[i % cols.length])); });
    // leaves under them
    const lg = new THREE.IcosahedronGeometry(0.1, 0), lm = lam('leaf', { color: '#3a7a32' });
    const il = new THREE.InstancedMesh(lg, lm, list.length);
    list.forEach(([x, y, z], i) => { mx.compose(V(x, y - 0.08, z), new THREE.Quaternion(), V(1.2, 0.7, 1.2)); il.setMatrixAt(i, mx); });
    this.root.add(im, il);
  }
  // trees: a trunk with branches and a leafy crown made of lumpy blobs, darker underneath (vertex colours)
  treeGeo(seed, tall){
    const R = rng(seed), parts = [];
    const trunkH = tall ? 3.2 : 2.4;
    parts.push(paint(new THREE.CylinderGeometry(0.11, 0.2, trunkH, 9).translate(0, trunkH / 2, 0), '#5a4230'));
    for (let k = 0; k < 4; k++){
      const a = k / 4 * 6.283 + R(), len = 1.0 + R() * 0.6;
      const br = new THREE.CylinderGeometry(0.035, 0.07, len, 6).translate(0, len / 2, 0);
      br.applyMatrix4(new THREE.Matrix4().compose(V(0, trunkH * (0.7 + R() * 0.25), 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(a) * 0.8, 0, -Math.cos(a) * 0.8)), V(1, 1, 1)));
      parts.push(paint(br, '#5a4230'));
    }
    const n = tall ? 9 : 8, base = new THREE.Color('#3f7a2e'), dark = new THREE.Color('#24501c'), light = new THREE.Color('#6aa844');
    for (let k = 0; k < n; k++){
      // (vertices shared, so the crown is smooth rather than faceted)
      const ico = new THREE.IcosahedronGeometry(1, 1); ico.deleteAttribute('normal'); ico.deleteAttribute('uv');
      const blob = mergeVertices(ico), p = blob.attributes.position;
      const r = tall ? 0.75 + R() * 0.35 : 0.9 + R() * 0.55;
      const cx = tall ? (R() - 0.5) * 0.9 : (R() - 0.5) * 2.4, cz = tall ? (R() - 0.5) * 0.9 : (R() - 0.5) * 2.4;
      const cy = tall ? trunkH + 0.4 + k * 0.62 : trunkH + 0.8 + R() * 1.6;
      const colA = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++){
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i), j = 1 + (hash2(Math.round(x * 50) + k * 7, Math.round(y * 50) + Math.round(z * 50) * 3, seed) - 0.5) * 0.35;
        p.setXYZ(i, cx + x * r * j, cy + y * r * j * 0.85, cz + z * r * j);
        const t = Math.max(0, Math.min(1, (y + 1) / 2 * 0.8 + (cy - trunkH) / 6)), c = dark.clone().lerp(base, t).lerp(light, Math.max(0, t - 0.6) * 1.2);
        c.multiplyScalar(0.9 + hash2(i, k, seed) * 0.2);
        colA.set([c.r, c.g, c.b], i * 3);
      }
      blob.setAttribute('color', new THREE.BufferAttribute(colA, 3));
      blob.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(p.count * 2), 2));
      blob.computeVertexNormals();
      parts.push(blob);
    }
    const g = mergeGeometries(parts.map((q) => (q.attributes.uv ? q : (q.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(q.attributes.position.count * 2), 2)), q))));
    g.userData.keep = true;
    return g;
  }
  buildTrees(){
    const R = rng(31), spots = { round: [], tall: [], roundFar: [], tallFar: [] };
    const ok = (x, z) => !(x > -16 && x < 28 && z > -12.5 && z < 10.8) && !(x > -18.5 && x < 18.5 && z > 9.8 && z < 23) && !(z > 22 && z < 34);
    for (const [x, z] of [[-15.6, 11.8], [15.6, 11.8], [-15.6, 18.5], [15.6, 18.5]]) spots.round.push([x, z, 1]);
    for (const x of [-35, -25, -15, -5, 5, 15, 25, 35]) spots.round.push([x + 2.5, 23.6, 0.9]);
    let tries = 0;
    while (spots.round.length + spots.tall.length < 70 && tries++ < 3000){
      const x = (R() - 0.5) * 140, z = -70 + R() * 92;
      if (!ok(x, z)) continue;
      const far = Math.abs(x - 6) > 30 || z < -16 || z > 26;
      (R() < 0.3 ? (far ? spots.tallFar : spots.tall) : (far ? spots.roundFar : spots.round)).push([x, z, 0.8 + R() * 0.5]);
    }
    const mat = this.vcMat || (this.vcMat = lam('vc', { vertexColors: true }));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    const geos = { round: this.treeGeo(3, false), tall: this.treeGeo(5, true) };
    for (const [kind, list] of Object.entries(spots)){
      if (!list.length) continue;
      const tall = kind.startsWith('tall'), far = kind.endsWith('Far');
      const im = new THREE.InstancedMesh(geos[tall ? 'tall' : 'round'], mat, list.length);
      list.forEach(([x, z, s], i) => {
        q.setFromAxisAngle(V(0, 1, 0), R() * 6.28); m4.compose(V(x, -0.25, z), q, V(s, s * (0.9 + R() * 0.2), s)); im.setMatrixAt(i, m4);
        im.setColorAt(i, c.setHSL(0.25 + (R() - 0.5) * 0.06, 0.25 + R() * 0.2, 0.75 + R() * 0.25));
        if (Math.abs(x) < 18 && z < 22 && z > 10) this.walls.push({ x0: x - 0.25, x1: x + 0.25, z0: z - 0.25, z1: z + 0.25, tall: false });
      });
      im.castShadow = !far; im.receiveShadow = true;   // (only trees near the plaza are inside the sun's shadow area)
      this.root.add(im);
    }
  }
  // parked cars along the road: bodies in different colours, dark glass and wheels
  buildCars(){
    const body = [], dark = [];
    body.push(boxUV(4.1, 0.62, 1.78).translate(0, 0.62, 0));
    body.push(boxUV(2.3, 0.5, 1.6).translate(-0.25, 1.17, 0));
    dark.push(boxUV(2.2, 0.42, 1.64).translate(-0.25, 1.17, 0));            // the windows, just proud of the cabin
    for (const sx of [-1.3, 1.3]) for (const sz of [-0.8, 0.8]) dark.push(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 14).rotateX(Math.PI / 2).translate(sx, 0.34, sz));
    const gB = mergeGeometries(body.map((g) => g.index ? g.toNonIndexed() : g)), gD = mergeGeometries(dark.map((g) => g.index ? g.toNonIndexed() : g));
    // the glass box pokes out of the cabin by 2 cm on every side so the two never share a surface
    gD.userData.keep = gB.userData.keep = true;
    const cars = [[-30, 25.7, 0], [-18, 25.7, 0], [6, 25.7, 0], [27, 25.7, 0], [-8, 30.3, Math.PI], [16, 30.3, Math.PI], [38, 30.3, Math.PI]];
    const ib = new THREE.InstancedMesh(gB, lam('car', { color: '#fff' }), cars.length), id = new THREE.InstancedMesh(gD, lam('car-dark', { color: '#1c2228' }), cars.length);
    const cols = ['#c0262e', '#2a5aa8', '#f2f2ee', '#2a2a2e', '#e8b02a', '#3a8a5a', '#9aa0a8'], m4 = new THREE.Matrix4(), c = new THREE.Color();
    cars.forEach(([x, z, ry], i) => { m4.compose(V(x, -0.1, z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), ry), V(1, 1, 1)); ib.setMatrixAt(i, m4); id.setMatrixAt(i, m4); ib.setColorAt(i, c.set(cols[i % cols.length])); });
    ib.castShadow = id.castShadow = true;
    this.root.add(ib, id);
  }
  // distant hills all the way round
  buildHills(){
    const pos = [], N = 72;
    for (let i = 0; i < N; i++){
      const a0 = i / N * 6.283, a1 = (i + 1) / N * 6.283, R0 = 230, hh = (k) => 6 + vnoise(k * 0.25, 0, 8, N * 0.25) * 30 + vnoise(k * 0.875, 3, 9, N * 0.875) * 8, h0 = hh(i), h1 = hh(i + 1);
      const p = (a, r, y) => [Math.cos(a) * r, y, Math.sin(a) * r];
      pos.push(...p(a0, R0, -1), ...p(a1, R0, -1), ...p(a1, R0, h1), ...p(a0, R0, -1), ...p(a1, R0, h1), ...p(a0, R0, h0));
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    // darker at the foot, lighter (hazier) at the top
    const cols = []; for (let i = 0; i < pos.length; i += 3){ const t = Math.max(0, pos[i + 1]) / 50; cols.push(0.33 + t * 0.25, 0.47 + t * 0.2, 0.36 + t * 0.25); }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: true }));
    this.root.add(m);
  }

  // ---------- picture spots ----------
  // each: a place on a wall (centre at eye height), the way it faces, where to stand to look at it
  buildSlots(){
    const add = (x, z, ry, wing = false, w = 1.8) => {
      const n = V(Math.sin(ry), 0, Math.cos(ry));
      const s = { i: this.slots.length, pos: V(x, 1.65, z), ry, n, wing, maxW: w, maxH: 1.3, view: V(x + n.x * 2.4, 0, z + n.z * 2.4), art: null, group: null };
      this.slots.push(s);
      s.pickBox = this.addPick(x + n.x * 0.1, 1.65, z + n.z * 0.1, w + 0.2, 1.7, 0.25, { kind: 'slot', slot: s }, ry);
    };
    // main hall: north wall (5), west wall (3), east wall (2), south wall (2), the middle wall (2 each side)
    for (const x of [-10.5, -5.25, 0, 5.25, 10.5]) add(x, MAIN.z0 + 0.005, 0);
    for (const z of [-6, 0, 6]) add(MAIN.x0 + 0.005, z, Math.PI / 2);
    for (const z of [-6, 6]) add(MAIN.x1 - 0.005, z, -Math.PI / 2);
    for (const x of [-8, 8]) add(x, MAIN.z1 - 0.005, Math.PI);
    for (const x of [-2.5, 2.5]){ add(x, PART.z0 - 0.005, Math.PI, false, 1.6); add(x, PART.z1 + 0.005, 0, false, 1.6); }
    this.mainSlots = this.slots.length;
    // the wing: north (3), south (3), east (2)
    for (const x of [16.8, 20.2, 23.6]){ add(x, WING.z0 + 0.005, 0, true); add(x, WING.z1 - 0.005, Math.PI, true); }
    for (const z of [-3.2, 3.2]) add(WING.x1 - 0.005, z, -Math.PI / 2, true);
    // shared pieces: the empty-spot outline, the track light over each spot
    const outline = canvasTex(256, 200, (g, w, h) => {
      g.clearRect(0, 0, w, h); g.lineWidth = 6;
      g.setLineDash([16, 12]); g.strokeStyle = 'rgba(40,30,20,0.35)'; roundRect(g, 6, 6, w - 12, h - 12, 12); g.stroke();
      g.lineDashOffset = 14; g.strokeStyle = 'rgba(255,248,230,0.55)'; roundRect(g, 6, 6, w - 12, h - 12, 12); g.stroke();
      g.font = 'bold 30px Arial'; g.textAlign = 'center';
      g.fillStyle = 'rgba(40,30,20,0.45)'; g.fillText('＋ hang a', w / 2 + 2, h / 2 - 4); g.fillText('picture here', w / 2 + 2, h / 2 + 32);
      g.fillStyle = 'rgba(255,248,230,0.75)'; g.fillText('＋ hang a', w / 2, h / 2 - 6); g.fillText('picture here', w / 2, h / 2 + 30);
    }, false);
    this.emptyMat = new THREE.MeshBasicMaterial({ map: outline, transparent: true, depthWrite: false });
    this.emptyGeo = new THREE.PlaneGeometry(1.3, 1.0);
    const lights = new Batch();
    for (const s of this.slots){
      const e = new THREE.Mesh(this.emptyGeo, this.emptyMat);
      e.position.copy(s.pos).addScaledVector(s.n, 0.012); e.rotation.y = s.ry; this.root.add(e); s.empty = e;
      e.visible = !s.wing;
      // a little lamp on an arm above the spot, pointing down at it
      const top = s.pos.clone().addScaledVector(s.n, 0.0); top.y = 2.75;
      const arm = new THREE.Matrix4().compose(top.clone().addScaledVector(s.n, 0.22), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s.ry, 0)), V(1, 1, 1));
      lights.add(new THREE.BoxGeometry(0.04, 0.04, 0.44), this.M.trim, arm);
      lights.add(new THREE.CylinderGeometry(0.06, 0.09, 0.2, 10), this.M.dark, new THREE.Matrix4().compose(top.clone().addScaledVector(s.n, 0.44), new THREE.Quaternion().setFromEuler(new THREE.Euler(s.n.z * 0.6, 0, -s.n.x * 0.6)), V(1, 1, 1)));
      lights.add(new THREE.CircleGeometry(0.07, 12).rotateX(Math.PI / 2), this.M.lamp, new THREE.Matrix4().compose(top.clone().addScaledVector(s.n, 0.44).add(V(0, -0.101, 0)), new THREE.Quaternion().setFromEuler(new THREE.Euler(s.n.z * 0.6, 0, -s.n.x * 0.6)), V(1, 1, 1)));
    }
    // a soft pool of light on the wall over each spot (one shared texture, drawn without lighting)
    const pool = canvasTex(128, 128, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h * 0.2, 4, w / 2, h * 0.35, w * 0.6); gr.addColorStop(0, 'rgba(255,240,200,0.3)'); gr.addColorStop(1, 'rgba(255,240,200,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, false);
    this.poolMat = new THREE.MeshBasicMaterial({ map: pool, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const poolGeo = new THREE.PlaneGeometry(2.6, 2.6);
    for (const s of this.slots){ const p = new THREE.Mesh(poolGeo, this.poolMat); p.position.copy(s.pos).addScaledVector(s.n, 0.006); p.position.y = 1.95; p.rotation.y = s.ry; p.renderOrder = 1; this.root.add(p); s.pool = p; p.visible = !s.wing; }
    this.lightMeshes = lights.build(this.root, { shadows: false });
    this.frameGeoCache = new Map();
    this.picGeo = new THREE.PlaneGeometry(1, 1); this.picGeo.userData.keep = true;
  }
  slotOpen(s){ return !s.wing || this.wingOpen; }
  openWing(on = true){
    this.wingOpen = on;
    this.barrier.visible = !on;
    const i = this.walls.indexOf(this.barrierWall);
    if (on && i >= 0) this.walls.splice(i, 1);
    if (!on && i < 0) this.walls.push(this.barrierWall);
    for (const s of this.slots) if (s.wing){ s.empty.visible = on && !s.art; s.pool.visible = on; }
    for (const d of this.decorSpots) if (d.wing && d.mesh) d.mesh.visible = on;
  }

  // hang a picture (a canvas) in a spot, framed; returns its size on the wall
  hang(s, art, canvas, label){
    this.unhang(s);
    const F = FRAMES[art.frame] || FRAMES.wood;
    const asp = canvas.width / canvas.height;
    let w = s.maxW, h = w / asp; if (h > s.maxH){ h = s.maxH; w = h * asp; }
    const g = new THREE.Group();
    g.position.copy(s.pos); g.rotation.y = s.ry;
    // the picture: a texture no bigger than 512 px, drawn without lighting so its colours stay true
    const k = Math.min(1, 512 / Math.max(canvas.width, canvas.height)), c = document.createElement('canvas');
    c.width = Math.round(canvas.width * k); c.height = Math.round(canvas.height * k); c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const pic = new THREE.Mesh(this.picGeo, new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    pic.scale.set(w, h, 1); pic.position.z = F.d * 0.5 + 0.004;   // set into the frame, 4 mm in front of its back
    g.add(pic);
    // the frame: four bars (one shape per size and style, rebuilt when a new size is needed)
    const fg = this.frameGeo(w, h, F);
    const frame = new THREE.Mesh(fg, frameMat(art.frame)); frame.castShadow = true; g.add(frame);
    // the label beside it
    if (!s.label){
      s.label = textCanvas(256, 128);
      s.labelMesh = new THREE.Mesh(this.labelGeo || (this.labelGeo = new THREE.PlaneGeometry(0.34, 0.17)), new THREE.MeshBasicMaterial({ map: s.label.tex, toneMapped: false }));
    }
    this.drawLabel(s, label);
    s.labelMesh.position.set(w / 2 + F.w + 0.3, -0.25, 0.008);
    g.add(s.labelMesh);
    this.root.add(g);
    g.updateMatrixWorld(true);
    s.group = g; s.pic = pic; s.tex = tex; s.frame = frame; s.art = art; s.size = [w, h];
    s.empty.visible = false;
    return [w, h];
  }
  frameGeo(w, h, F){
    const key = `${w.toFixed(3)}x${h.toFixed(3)}:${F.w}:${F.d}:${F.ornate ? 1 : 0}`;
    if (this.frameGeoCache.has(key)) return this.frameGeoCache.get(key);
    const fw = F.w, d = F.d, parts = [];
    const bar = (sx, sy, x, y) => parts.push(placed(boxUV(sx, sy, d), x, y, d / 2));
    bar(w + fw * 2, fw, 0, h / 2 + fw / 2); bar(w + fw * 2, fw, 0, -h / 2 - fw / 2);
    bar(fw, h, -w / 2 - fw / 2, 0); bar(fw, h, w / 2 + fw / 2, 0);
    if (F.ornate){
      // a raised inner moulding and corner rosettes
      const i = 0.03, dd = d + 0.02;
      const ib = (sx, sy, x, y) => parts.push(placed(boxUV(sx, sy, 0.02), x, y, dd - 0.01));
      ib(w + fw * 1.2, i, 0, h / 2 + fw * 0.55); ib(w + fw * 1.2, i, 0, -h / 2 - fw * 0.55);
      ib(i, h + fw * 1.1 - i * 2, -w / 2 - fw * 0.55, 0); ib(i, h + fw * 1.1 - i * 2, w / 2 + fw * 0.55, 0);
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) parts.push(placed(new THREE.SphereGeometry(fw * 0.42, 10, 8), sx * (w / 2 + fw / 2), sy * (h / 2 + fw / 2), d + 0.01));
    }
    const g = mergeGeometries(parts);
    // the frame's back sits 1 cm off the wall
    g.translate(0, 0, 0.01);
    if (this.frameGeoCache.size > 40){ const [k0, g0] = this.frameGeoCache.entries().next().value; if (!this.inUse(g0)){ g0.dispose(); this.frameGeoCache.delete(k0); } }
    this.frameGeoCache.set(key, g);
    return g;
  }
  inUse(g){ return this.slots.some((s) => s.frame && s.frame.geometry === g); }
  unhang(s){
    if (!s.group) return;
    this.root.remove(s.group);
    s.group.remove(s.labelMesh);
    s.pic.material.dispose(); s.tex.dispose();
    s.group = s.pic = s.tex = s.frame = null; s.art = null;
    s.empty.visible = this.slotOpen(s);
  }
  drawLabel(s, L){
    const g = s.label.ctx;
    g.fillStyle = '#fbfaf6'; g.fillRect(0, 0, 256, 128);
    g.strokeStyle = '#c8c0b0'; g.lineWidth = 3; g.strokeRect(2, 2, 252, 124);
    g.fillStyle = '#222'; g.textAlign = 'left'; g.textBaseline = 'top';
    g.font = 'bold 24px Arial'; const t = wrapText(g, L.title, 232).slice(0, 2); t.forEach((l, i) => g.fillText(l, 12, 10 + i * 26));
    g.font = 'italic 19px Georgia'; g.fillStyle = '#555'; g.fillText(L.artist, 12, 12 + t.length * 26);
    g.font = 'bold 22px Arial'; g.fillStyle = L.forSale ? '#1a7a3a' : '#7a4a9a'; g.fillText(L.price, 12, 96);
    if (L.sold){ g.fillStyle = '#d0202a'; g.beginPath(); g.arc(228, 104, 13, 0, 7); g.fill(); }
    s.label.tex.needsUpdate = true;
  }

  // ---------- decorations ----------
  buildDecorSpots(){
    const add = (kind, x, z, ry = 0, wing = false) => this.decorSpots.push({ i: this.decorSpots.length, kind, pos: V(x, 0, z), ry, wing, mesh: null });
    add('plant', -13.2, -9.2); add('plant', 13.2, -9.2); add('plant', -13.2, 9.2); add('plant', 3.0, 9.0); add('plant', 25.2, -7.2, 0, true); add('plant', 25.2, 7.2, 0, true);
    add('bench', 0, -5.6, 0); add('bench', 0, 4.6, Math.PI); add('bench', -9.5, -1.6, Math.PI / 2); add('bench', 20.2, 0, 0, true);
    add('sculpture', -9.5, 3.6); add('sculpture', 9.0, -3.0); add('sculpture', 9.0, 3.6); add('sculpture', 17.5, 0, 0, true);
    add('rug', 0, -5.0); add('rug', 20.2, 0, Math.PI / 2, true);
    add('fountain', 0, 15.5);
  }
  freeSpot(kind){ return this.decorSpots.find((d) => d.kind === kind && !d.mesh && (!d.wing || this.wingOpen)); }
  placeDecor(spot){
    const m = this.decorMesh(spot.kind, spot.i);
    m.position.copy(spot.pos); m.rotation.y = spot.ry;
    const R = { plant: 0.55, bench: 1.2, sculpture: 0.75, fountain: 1.9 }[spot.kind];
    if (R){ aoMats(); const sh = new THREE.Mesh(this.blobGeo || (this.blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)), aoBlobMat); sh.scale.set(R * 2, 1, spot.kind === 'bench' ? R : R * 2); sh.position.y = 0.007; m.add(sh); }
    this.root.add(m); m.updateMatrixWorld(true);
    spot.mesh = m;
    const r = { plant: 0.4, bench: 0, sculpture: 0.5, rug: 0, fountain: 1.4 }[spot.kind];
    if (spot.kind === 'bench'){ const along = Math.abs(Math.sin(spot.ry)) > 0.5; this.walls.push(spot.wall = along ? { x0: spot.pos.x - 0.3, x1: spot.pos.x + 0.3, z0: spot.pos.z - 1.0, z1: spot.pos.z + 1.0, tall: false } : { x0: spot.pos.x - 1.0, x1: spot.pos.x + 1.0, z0: spot.pos.z - 0.3, z1: spot.pos.z + 0.3, tall: false }); }
    else if (r) this.walls.push(spot.wall = { x0: spot.pos.x - r, x1: spot.pos.x + r, z0: spot.pos.z - r, z1: spot.pos.z + r, tall: false });
    spot.pickBox = this.addPick(spot.pos.x, 0.6, spot.pos.z, 1.2, 1.2, 1.2, { kind: 'decor', spot });
    return m;
  }
  // the shapes of each decoration are made once and shared by every copy
  decorMesh(kind, seed){
    this.decorGeo = this.decorGeo || {};
    if (!this.decorGeo[kind]){
      const parts = [];
      const C = (g, col) => parts.push(paint(g, col));
      if (kind === 'plant'){
        C(new THREE.CylinderGeometry(0.28, 0.2, 0.5, 14).translate(0, 0.25, 0), '#c8643a');
        C(new THREE.CylinderGeometry(0.29, 0.29, 0.05, 14).translate(0, 0.5, 0), '#a8502a');
        const R = rng(11);
        for (let i = 0; i < 9; i++){ const a = i / 9 * 6.28, l = 0.5 + R() * 0.4; C(placed(ellipsoid(0.09, l / 2, 0.035, 8, 6), Math.cos(a) * 0.15, 0.5 + l / 2, Math.sin(a) * 0.15, Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45), i % 2 ? '#3a8a3a' : '#4aa04a'); }
      } else if (kind === 'bench'){
        C(boxUV(2.0, 0.08, 0.6).translate(0, 0.45, 0), '#9a6a3a');
        for (const x of [-0.85, 0.85]) C(boxUV(0.08, 0.45, 0.55).translate(x, 0.225, 0), '#2a2a2e');
      } else if (kind === 'sculpture'){
        C(boxUV(0.8, 1.0, 0.8).translate(0, 0.5, 0), '#f2f0ea');
        C(new THREE.TorusKnotGeometry(0.22, 0.07, 64, 10).translate(0, 1.38, 0), '#d8b04a');
      } else if (kind === 'rug'){
        C(boxUV(4.4, 0.012, 2.4).translate(0, 0.007, 0), '#8a2a3a');
        C(boxUV(4.0, 0.012, 2.0).translate(0, 0.009, 0), '#c8a060');   // 2 mm above, and smaller (inset border)
        C(boxUV(3.6, 0.012, 1.6).translate(0, 0.011, 0), '#3a4a7a');
      } else if (kind === 'fountain'){
        const ring = new THREE.TorusGeometry(1.3, 0.16, 8, 32).rotateX(Math.PI / 2).translate(0, 0.25, 0);
        C(ring, '#cfc8bc');
        C(new THREE.CylinderGeometry(1.25, 1.25, 0.2, 32).translate(0, 0.12, 0), '#4aa8e0');
        C(new THREE.CylinderGeometry(0.12, 0.2, 1.1, 12).translate(0, 0.6, 0), '#cfc8bc');
        C(new THREE.CylinderGeometry(0.55, 0.3, 0.14, 20).translate(0, 1.15, 0), '#cfc8bc');
        C(ellipsoid(0.12, 0.35, 0.12, 10, 8).translate(0, 1.5, 0), '#8ad0ff');
      }
      const g = mergeGeometries(parts); g.userData.keep = true;
      this.decorGeo[kind] = g;
    }
    const m = new THREE.Mesh(this.decorGeo[kind], this.decorMat || (this.decorMat = lam('decor', { vertexColors: true })));
    m.castShadow = kind !== 'rug'; m.receiveShadow = true;
    if (kind === 'sculpture') m.rotation.y = seed;
    return m;
  }

  // ---------- bumping into things ----------
  // push a circle (radius r) out of the walls; low things (benches, the desk) only stop the stick
  collide(p, r, low = true){
    for (let k = 0; k < 2; k++) for (const w of this.walls){
      if (!w.tall && !low) continue;
      const cx = Math.max(w.x0, Math.min(p.x, w.x1)), cz = Math.max(w.z0, Math.min(p.z, w.z1));
      const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-9){ const d = Math.sqrt(d2); p.x = cx + dx / d * r; p.z = cz + dz / d * r; }
      else {
        // inside the box: out the nearest side
        const o = [[p.x - w.x0 + r, -1, 0], [w.x1 - p.x + r, 1, 0], [p.z - w.z0 + r, 0, -1], [w.z1 - p.z + r, 0, 1]].sort((a, b) => a[0] - b[0])[0];
        p.x += o[1] * o[0]; p.z += o[2] * o[0];
      }
    }
  }
  // which room a point is in
  where(x, z){ if (x > MAIN.x1 + 0.1) return 'wing'; if (z > MAIN.z1 + 0.1) return 'plaza'; return 'main'; }
  // the path for a visitor from a to b (around the middle wall, through the doorways)
  route(a, b){
    const pts = [];
    const ra = this.where(a.x, a.z), rb = this.where(b.x, b.z);
    let cur = a;
    const go = (p) => { pts.push(p); cur = p; };
    const main = (to) => {
      // around the free-standing wall if the straight line crosses it
      const dz = to.z - cur.z;
      if (Math.abs(dz) > 1e-6){
        const t = -cur.z / dz, x = cur.x + (to.x - cur.x) * t;
        if (t > 0 && t < 1 && x > PART.x0 - 0.8 && x < PART.x1 + 0.8){
          const ex = x < 0 ? PART.x0 - 1.4 : PART.x1 + 1.4;
          go(V(ex, 0, cur.z > 0 ? 1.2 : -1.2)); go(V(ex, 0, cur.z > 0 ? -1.2 : 1.2));
        }
      }
      go(to);
    };
    const inDoor = V(0, 0, MAIN.z1 - 1.2), outDoor = V(0, 0, MAIN.z1 + 1.2), wIn = V(MAIN.x1 - 1.2, 0, 0), wOut = V(WING.x0 + 1.0, 0, 0);
    if (ra === 'plaza'){ go(outDoor); go(inDoor); }
    if (ra === 'wing' && rb !== 'wing'){ go(wOut); go(wIn); }
    if (rb === 'wing' && ra !== 'wing'){ main(wIn); go(wOut); go(b.clone()); return pts; }
    if (rb === 'plaza'){ main(inDoor); go(outDoor); go(b.clone()); return pts; }
    if (rb === 'wing'){ go(b.clone()); return pts; }
    main(b.clone());
    return pts;
  }
}
