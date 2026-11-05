// Shared helpers: blocky geometry with per-face colours, the pixel noise texture every block uses,
// canvas text, two-bone IK and a seeded random.
import * as THREE from 'three';

export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const UP = new THREE.Vector3(0, 1, 0);

// Seeded random, so the world is the same every time.
export function rng(seed){
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function hash2(x, z){
  let h = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// Smooth value noise.
export function vnoise(x, z){
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// A 16x16 grey speckle, multiplied over vertex colours: it's what makes everything look "pixel".
let noiseTex = null;
export function pixelTexture(){
  if (noiseTex) return noiseTex;
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const g = c.getContext('2d'); const r = rng(7);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++){
    const v = 200 + Math.floor(r() * 56) - (r() < 0.12 ? 30 : 0);
    g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, y, 1, 1);
  }
  noiseTex = new THREE.CanvasTexture(c);
  noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping;
  noiseTex.magFilter = THREE.NearestFilter;
  noiseTex.minFilter = THREE.LinearMipmapLinearFilter;
  noiseTex.colorSpace = THREE.SRGBColorSpace;
  noiseTex.anisotropy = 4;
  return noiseTex;
}

let blockMat = null;
// The one material for all blocky things: vertex colour times the speckle texture, Lambert lit.
export function blockMaterial(){
  if (!blockMat) blockMat = new THREE.MeshLambertMaterial({ map: pixelTexture(), vertexColors: true });
  return blockMat;
}

const _c = new THREE.Color();
// Collects boxes into one BufferGeometry (one draw call). Each box can have a colour per face and a
// transform. Texture coordinates are in world units so the speckle is the same size everywhere.
export class BoxBuilder {
  constructor(density = 32){ this.p = []; this.n = []; this.uv = []; this.c = []; this.density = density / 16; }
  // faces: one colour for all, or an object { px,nx,py,ny,pz,nz } (missing -> 'all'); shade darkens the bottom of sides.
  box(cx, cy, cz, sx, sy, sz, colors, matrix = null, opts = {}){
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const col = (k) => { const v = typeof colors === 'object' && !(colors instanceof THREE.Color) && colors !== null && !Array.isArray(colors) ? (colors[k] ?? colors.all) : colors; return _c.set(v); };
    const skip = opts.skip || {};
    const F = [
      ['px', [1,0,0], [[hx,-hy,hz],[hx,-hy,-hz],[hx,hy,-hz],[hx,hy,hz]], [sz, sy]],
      ['nx', [-1,0,0],[[-hx,-hy,-hz],[-hx,-hy,hz],[-hx,hy,hz],[-hx,hy,-hz]], [sz, sy]],
      ['py', [0,1,0], [[-hx,hy,hz],[hx,hy,hz],[hx,hy,-hz],[-hx,hy,-hz]], [sx, sz]],
      ['ny', [0,-1,0],[[-hx,-hy,-hz],[hx,-hy,-hz],[hx,-hy,hz],[-hx,-hy,hz]], [sx, sz]],
      ['pz', [0,0,1], [[-hx,-hy,hz],[hx,-hy,hz],[hx,hy,hz],[-hx,hy,hz]], [sx, sy]],
      ['nz', [0,0,-1],[[hx,-hy,-hz],[-hx,-hy,-hz],[-hx,hy,-hz],[hx,hy,-hz]], [sx, sy]],
    ];
    const nm = matrix ? new THREE.Matrix3().getNormalMatrix(matrix) : null;
    const v = new THREE.Vector3(), nn = new THREE.Vector3();
    const d = this.density;
    const ao = opts.ao ?? 0.18;
    for (const [k, nrm, corners, [w, h]] of F){
      if (skip[k]) continue;
      col(k);
      const base = _c.clone();
      const quad = [];
      for (let i = 0; i < 4; i++){
        v.set(cx + corners[i][0], cy + corners[i][1], cz + corners[i][2]);
        if (matrix) v.applyMatrix4(matrix);
        quad.push([v.x, v.y, v.z]);
      }
      nn.set(...nrm); if (nm) nn.applyMatrix3(nm).normalize();
      const uvs = [[0,0],[w*d,0],[w*d,h*d],[0,h*d]];
      // offset uvs a little by position so neighbouring boxes don't repeat exactly
      const ou = ((cx * 7.3 + cz * 3.1) % 1), ov = ((cy * 5.7 + cz * 2.3) % 1);
      const order = [0,1,2,0,2,3];
      for (const i of order){
        this.p.push(...quad[i]); this.n.push(nn.x, nn.y, nn.z);
        this.uv.push(uvs[i][0] + ou, uvs[i][1] + ov);
        // simple occlusion: the bottom of side faces is a touch darker, bottoms darker still
        let s = 1;
        if (k !== 'py' && k !== 'ny' && (i === 0 || i === 1)) s = 1 - ao;
        if (k === 'ny') s = 0.7;
        this.c.push(base.r * s, base.g * s, base.b * s);
      }
    }
    return this;
  }
  build(){
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  }
}

// One box as its own geometry (for moving parts).
export function boxGeo(sx, sy, sz, colors, cx = 0, cy = 0, cz = 0, opts){
  return new BoxBuilder().box(cx, cy, cz, sx, sy, sz, colors, null, opts).build();
}
export function boxMesh(sx, sy, sz, colors, cx = 0, cy = 0, cz = 0, opts){
  return new THREE.Mesh(boxGeo(sx, sy, sz, colors, cx, cy, cz, opts), blockMaterial());
}

// Several boxes as one mesh: list of [sx, sy, sz, colors, cx, cy, cz].
export function multiBox(list, opts){
  const B = new BoxBuilder();
  for (const [sx, sy, sz, c, cx = 0, cy = 0, cz = 0] of list) B.box(cx, cy, cz, sx, sy, sz, c, null, opts);
  return new THREE.Mesh(B.build(), blockMaterial());
}

// Text drawn on a canvas, for signs, speech bubbles and the watch.
export function textCanvas(w, h){
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return { canvas: c, ctx: c.getContext('2d'), tex };
}
export function wrapText(ctx, text, maxW){
  const out = [];
  for (const para of text.split('\n')){
    const words = para.split(' '); let line = '';
    for (const w of words){
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && line){ out.push(line); line = w; } else line = t;
    }
    out.push(line);
  }
  return out;
}

// Two-bone IK. a: root, t: target, l1/l2 lengths, pole: a direction the middle joint bends toward.
// Writes the middle joint into out and returns how far the target really is.
const _d = new THREE.Vector3(), _p = new THREE.Vector3();
export function solveIK(a, t, l1, l2, pole, out){
  _d.subVectors(t, a);
  let dist = _d.length();
  if (dist < 1e-5){ _d.set(0, -1, 0); dist = 1e-5; } else _d.divideScalar(dist);
  const dc = Math.min(Math.max(dist, Math.abs(l1 - l2) + 1e-4), l1 + l2 - 1e-4);
  const cosA = (l1 * l1 + dc * dc - l2 * l2) / (2 * l1 * dc);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  _p.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_p.lengthSq() < 1e-8){ _p.set(0, 0, 1).addScaledVector(_d, -_d.z); }
  _p.normalize();
  out.copy(a).addScaledVector(_d, l1 * cosA).addScaledVector(_p, l1 * sinA);
  return dist;
}

// Points a unit-length limb mesh (a box from y=0 to y=1) from a to b, rolled so its +Z faces `face`.
const _y = new THREE.Vector3(), _z = new THREE.Vector3(), _x = new THREE.Vector3(), _m = new THREE.Matrix4();
export function placeLimb(mesh, a, b, face){
  _y.subVectors(b, a); const len = _y.length(); if (len < 1e-6) return;
  _y.divideScalar(len);
  _z.copy(face).addScaledVector(_y, -face.dot(_y));
  if (_z.lengthSq() < 1e-8){ _z.set(1, 0, 0).cross(_y); }
  _z.normalize(); _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z);
  mesh.quaternion.setFromRotationMatrix(_m);
  mesh.position.copy(a);
  mesh.scale.set(1, len, 1);
}

// Colour palette shared by the world and the creatures.
export const COL = {
  grass: 0x6dbb45, grass2: 0x5aa83a, dirt: 0x8a6142, stone: 0x8d8f93, stone2: 0x74767a,
  sand: 0xd9c98f, water: 0x3f78d0, trunk: 0x6b4a2b, leaves: 0x3f8f2e, leaves2: 0x4f9f36,
  plank: 0xb48a55, plank2: 0x9b7444, skin: 0xe0ac85, shirt: 0x3b7dd8, pants: 0x3a3f5c, shoe: 0x3a2a20,
  hair: 0x4a3020, white: 0xf2f2ee,
};
