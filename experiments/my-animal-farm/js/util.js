// Shared helpers: seeded random, noise, merging geometry, lofted (swept) shapes, canvas text.
import * as THREE from 'three';

export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const UP = new THREE.Vector3(0, 1, 0);
export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
export const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
export function angleDiff(a, b){ let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }

// Seeded random, so the farm is laid out the same every time.
export function rng(seed){
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function hash2(x, z, s = 0){
  let h = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// smooth value noise; wraps every `per` cells when given (for seamless textures)
export function vnoise(x, z, s = 0, per = 0){
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const px = Array.isArray(per) ? per[0] : per, pz = Array.isArray(per) ? per[1] : per;
  const wx = (a) => px ? ((a % px) + px) % px : a, wz = (a) => pz ? ((a % pz) + pz) % pz : a;
  const a = hash2(wx(xi), wz(zi), s), b = hash2(wx(xi + 1), wz(zi), s), c = hash2(wx(xi), wz(zi + 1), s), d = hash2(wx(xi + 1), wz(zi + 1), s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, z, oct = 4, s = 0, per = 0){
  let t = 0, amp = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++){ t += amp * vnoise(x * f, z * f, s + i * 17, Array.isArray(per) ? [per[0] * f, per[1] * f] : per ? per * f : 0); n += amp; amp *= 0.5; f *= 2; }
  return t / n;
}

// Merge geometries that share attributes (position, normal, uv, and optionally color) into one.
export function mergeGeometries(list){
  const geos = list.map((g) => (g.index ? g.toNonIndexed() : g));
  const names = ['position', 'normal', 'uv', 'color'].filter((n) => geos.every((g) => g.attributes[n]));
  let count = 0; for (const g of geos) count += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  for (const n of names){
    const size = geos[0].attributes[n].itemSize, arr = new Float32Array(count * size);
    let o = 0; for (const g of geos){ arr.set(g.attributes[n].array, o); o += g.attributes[n].array.length; }
    out.setAttribute(n, new THREE.BufferAttribute(arr, size));
  }
  out.computeBoundingSphere(); out.computeBoundingBox();
  return out;
}

// Bake a mesh's transform (relative to `root`) into a copy of its geometry.
export function bakedGeometry(mesh, root){
  mesh.updateWorldMatrix(true, false);
  const g = mesh.geometry.clone();
  const m = root ? new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(mesh.matrixWorld) : mesh.matrixWorld;
  g.applyMatrix4(m);
  return g;
}

// Builds static scenery: add geometry per material, then one mesh per material at the end.
export class Batch {
  constructor(){ this.groups = new Map(); }
  add(geo, mat, matrix){
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    if (!g.attributes.uv){ g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); }
    if (!this.groups.has(mat)) this.groups.set(mat, []);
    this.groups.get(mat).push(g);
    return this;
  }
  box(sx, sy, sz, mat, x, y, z, ry = 0, uvScale = 1, rx = 0, rz = 0){
    const g = boxUV(sx, sy, sz, uvScale);
    return this.add(g, mat, new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V(1, 1, 1)));
  }
  cyl(r0, r1, h, mat, x, y, z, seg = 10, rx = 0, rz = 0, ry = 0){
    const g = new THREE.CylinderGeometry(r1, r0, h, seg);
    return this.add(g, mat, new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V(1, 1, 1)));
  }
  build(parent, { shadows = true, receive = true } = {}){
    const meshes = [];
    for (const [mat, geos] of this.groups){
      const m = new THREE.Mesh(mergeGeometries(geos), mat);
      m.castShadow = shadows; m.receiveShadow = receive; m.matrixAutoUpdate = false;
      parent.add(m); meshes.push(m);
    }
    this.groups.clear();
    return meshes;
  }
}

// A box whose texture coordinates are in metres (times uvScale), so textures keep their size on any box.
export function boxUV(sx, sy, sz, uvScale = 1){
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const uv = g.attributes.uv, n = g.attributes.normal, p = g.attributes.position;
  for (let i = 0; i < uv.count; i++){
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (nx > 0.5) uv.setXY(i, z * uvScale, y * uvScale);
    else if (ny > 0.5) uv.setXY(i, x * uvScale, z * uvScale);
    else uv.setXY(i, x * uvScale, y * uvScale);
  }
  return g;
}

// A smooth "lofted" shape: rings of points swept along a path. Each section is
// { p: [x,y,z] centre, rx, ry, top?, bottom? } (half width, half height, and how flat the top and
// bottom are). Sections are smoothed with Catmull-Rom. The shape lies in the YZ plane (an animal seen
// from the side), so the ring's sideways axis is always +X.
export function loft(sections, { ring = 16, steps = 6, capStart = true, capEnd = true, uvScale = 1 } = {}){
  const pts = sections.map((s) => V(...s.p));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const n = (sections.length - 1) * steps;
  const lerpSec = (u) => {
    const f = u * (sections.length - 1), i = Math.min(sections.length - 2, Math.floor(f)), t = f - i;
    const a = sections[Math.max(0, i - 1)], b = sections[i], c = sections[i + 1], d = sections[Math.min(sections.length - 1, i + 2)];
    const cr = (k) => { const p0 = a[k] ?? b[k], p1 = b[k], p2 = c[k], p3 = d[k] ?? c[k];
      return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t); };
    return { rx: Math.max(0.002, cr('rx')), ry: Math.max(0.002, cr('ry')), top: lerp(b.top ?? 0, c.top ?? 0, t), bottom: lerp(b.bottom ?? 0, c.bottom ?? 0, t), sx: lerp(b.sx ?? 0, c.sx ?? 0, t) };
  };
  const pos = [], uv = [], idx = [];
  const side = V(1, 0, 0), up = V(), tan = V();
  let len = 0, prev = null;
  for (let j = 0; j <= n; j++){
    const u = j / n, c = curve.getPoint(u);
    if (prev) len += c.distanceTo(prev); prev = c.clone();
    curve.getTangent(u, tan);
    up.crossVectors(tan, side).normalize();
    const s = lerpSec(u);
    for (let i = 0; i <= ring; i++){
      const a = (i / ring) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      // flatten the top (spine) or bottom a little
      const f = sa > 0 ? 1 - s.top * sa * sa : 1 - s.bottom * sa * sa;
      const x = s.rx * ca * f, y = s.ry * sa;
      pos.push(c.x + side.x * x + up.x * y + s.sx, c.y + side.y * x + up.y * y, c.z + side.z * x + up.z * y);
      uv.push(i / ring, len * uvScale);
    }
  }
  const R = ring + 1;
  for (let j = 0; j < n; j++) for (let i = 0; i < ring; i++){
    const a = j * R + i, b = a + 1, c = a + R, d = c + 1;
    // counter-clockwise seen from outside (around the ring, then along the path)
    idx.push(a, b, c, b, d, c);
  }
  // end caps: a fan to the centre, wound so the cap faces outward (away from the shape)
  const cap = (j, end) => {
    const c = curve.getPoint(j / n), ci = pos.length / 3;
    const out = curve.getTangent(j / n).multiplyScalar(end ? 1 : -1);
    pos.push(c.x, c.y, c.z); uv.push(0.5, 0.5);
    const tri = (a, b) => fanFacing(pos, ci, a, b, out) ? idx.push(ci, a, b) : idx.push(ci, b, a);
    for (let i = 0; i < ring; i++){ const a = j * R + i; tri(a, a + 1); }
  };
  if (capStart) cap(0, false);
  if (capEnd) cap(n, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // the seam where the ring closes gets averaged normals
  fixSeam(g, ring, n);
  return g;
}
function fixSeam(g, ring, n){
  const N = g.attributes.normal, R = ring + 1;
  for (let j = 0; j <= n; j++){
    const a = j * R, b = j * R + ring;
    const x = N.getX(a) + N.getX(b), y = N.getY(a) + N.getY(b), z = N.getZ(a) + N.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    N.setXYZ(a, x / l, y / l, z / l); N.setXYZ(b, x / l, y / l, z / l);
  }
}

// A tapered limb segment between two radii along -Y (top at 0), slightly squashed sideways.
export function limb(len, r0, r1, { seg = 10, squash = 0.85, bulge = 0 } = {}){
  const s = [];
  const k = 6;
  for (let i = 0; i <= k; i++){
    const t = i / k, r = lerp(r0, r1, t) * (1 + bulge * Math.sin(Math.PI * t));
    s.push({ p: [0, -len * t, 0.00001 * i], rx: r * squash, ry: r });
  }
  // sweep downward: loft expects the path; ring axes: side = X, up = tan x side (here the ring lies in XZ)
  const g = loftDown(s, seg);
  return g;
}
function loftDown(sections, ring){
  const pos = [], idx = [];
  for (const s of sections){
    for (let i = 0; i <= ring; i++){
      const a = (i / ring) * Math.PI * 2;
      pos.push(s.p[0] + Math.cos(a) * s.rx, s.p[1], s.p[2] + Math.sin(a) * s.ry);
    }
  }
  const R = ring + 1;
  for (let j = 0; j < sections.length - 1; j++) for (let i = 0; i < ring; i++){
    const a = j * R + i, b = a + 1, c = a + R, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  // round caps, facing outward (up at the top, down at the bottom)
  for (const [j, end] of [[0, false], [sections.length - 1, true]]){
    const s = sections[j], ci = pos.length / 3;
    pos.push(s.p[0], s.p[1] + (end ? -0.5 : 0.5) * Math.min(s.rx, s.ry), s.p[2]);
    const out = new THREE.Vector3(0, end ? -1 : 1, 0);
    for (let i = 0; i < ring; i++){ const a = j * R + i, b = a + 1; if (fanFacing(pos, ci, a, b, out)) idx.push(ci, a, b); else idx.push(ci, b, a); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// does the triangle (ci, a, b), counter-clockwise, face along `out`?
function fanFacing(pos, ci, a, b, out){
  const P = (k) => new THREE.Vector3(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
  const c = P(ci), e1 = P(a).sub(c), e2 = P(b).sub(c);
  return e1.cross(e2).dot(out) >= 0;
}

// An ellipsoid.
export function ellipsoid(rx, ry, rz, w = 14, h = 10){
  const g = new THREE.SphereGeometry(1, w, h);
  g.scale(rx, ry, rz);
  return g;
}

// A canvas with a texture, for signs, panels and the watch.
export function textCanvas(w, h){
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { canvas: c, ctx, tex };
}
export function wrapText(ctx, text, maxW){
  const words = String(text).split(' '), lines = []; let line = '';
  for (const w of words){
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && line){ lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}
export function roundRect(g, x, y, w, h, r){
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// Two-bone IK in a plane: from the root at (0,0) reach for (ty, tz) with bones l1, l2. Returns the
// angles (radians, around X) of the upper bone from straight down, and of the lower bone relative to
// the upper. bend = +1 bends the joint forward (+z), -1 backward.
export function ik2(ty, tz, l1, l2, bend){
  let d = Math.hypot(ty, tz);
  d = clamp(d, Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
  const base = Math.atan2(tz, -ty);               // angle of the target from straight down (toward +z)
  const a1 = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  const a2 = Math.acos(clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1));
  return { upper: base + bend * a1, lower: -bend * (Math.PI - a2) };
}

export const fmtMoney = (n) => '$' + Math.round(n).toLocaleString('en-US');
export function fmtTime(mins){
  const h = Math.floor(mins / 60) % 24, m = Math.floor(mins % 60);
  const ap = h < 12 ? 'am' : 'pm', hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, '0')} ${ap}`;
}

// Free the GPU memory of everything under `obj` once it's gone for good (visitors driving off, a horse
// sold, a flake of hay eaten). Only the shapes are freed: materials and textures are shared and cached.
// Without this a long session on a headset slowly runs out of memory and the browser kills the page.
export function disposeTree(obj){
  if (!obj) return;
  obj.traverse((o) => { if (o.geometry && !o.geometry.userData.keep) o.geometry.dispose(); });
}
