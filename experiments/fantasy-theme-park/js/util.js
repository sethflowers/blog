// Shared helpers: maths, seeded random and noise, merging geometry (Batch), freeing meshes.
import * as THREE from 'three';

export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
export const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
export function angleDiff(a, b){ let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

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

// Batch: collects many shapes (each with its own transform) and merges them into one geometry per
// material, so static scenery costs one draw call per material. Shapes are BufferGeometries with
// position + normal (+ uv); an optional colour goes into a vertex colour attribute.
export class Batch {
  constructor(){ this.parts = new Map(); }
  add(geo, matKey, matrix, color){
    let list = this.parts.get(matKey); if (!list){ list = []; this.parts.set(matKey, list); }
    list.push({ geo, matrix: matrix ? matrix.clone() : null, color });
  }
  // a box centred at (x, y, z) of size (w, h, d), turned by ry about Y
  box(matKey, x, y, z, w, h, d, ry = 0, color){
    const m = new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), ry), V(w, h, d));
    this.add(UNIT_BOX, matKey, m, color);
  }
  build(mats){
    const group = new THREE.Group();
    for (const [key, list] of this.parts){
      const geo = mergeParts(list);
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, mats(key));
      mesh.name = key;
      group.add(mesh);
    }
    return group;
  }
}
export const UNIT_BOX = boxUV(1, 1, 1);
// a box whose UVs are in metres of its own size (scaled later, so textures are set per world metre by worldUV)
function boxUV(w, h, d){ return new THREE.BoxGeometry(w, h, d); }

// merge shapes: bakes transforms; UVs become world-space (metres) so tiled textures line up everywhere
export function mergeParts(list){
  let nv = 0, ni = 0;
  for (const p of list){ nv += p.geo.attributes.position.count; ni += p.geo.index ? p.geo.index.count : p.geo.attributes.position.count; }
  if (!nv) return null;
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = new Float32Array(nv * 3);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0, anyColor = false;
  const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3(), c = new THREE.Color();
  for (const p of list){
    const g = p.geo, P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    if (p.matrix) nm.getNormalMatrix(p.matrix);
    if (p.color !== undefined && p.color !== null){ c.set(p.color); anyColor = true; } else c.setRGB(1, 1, 1);
    for (let i = 0; i < P.count; i++){
      v.fromBufferAttribute(P, i); if (p.matrix) v.applyMatrix4(p.matrix);
      pos[(vo + i) * 3] = v.x; pos[(vo + i) * 3 + 1] = v.y; pos[(vo + i) * 3 + 2] = v.z;
      if (N){ n.fromBufferAttribute(N, i); if (p.matrix) n.applyMatrix3(nm).normalize(); } else n.set(0, 1, 0);
      nor[(vo + i) * 3] = n.x; nor[(vo + i) * 3 + 1] = n.y; nor[(vo + i) * 3 + 2] = n.z;
      // world-space UVs by the face's main direction (triplanar-ish), so bricks are the same size everywhere
      const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
      if (p.geo.userData.keepUV && U){ uv[(vo + i) * 2] = U.getX(i); uv[(vo + i) * 2 + 1] = U.getY(i); }
      else if (ay >= ax && ay >= az){ uv[(vo + i) * 2] = v.x; uv[(vo + i) * 2 + 1] = v.z; }
      else if (ax >= az){ uv[(vo + i) * 2] = v.z; uv[(vo + i) * 2 + 1] = v.y; }
      else { uv[(vo + i) * 2] = v.x; uv[(vo + i) * 2 + 1] = v.y; }
      if (g.attributes.color && (p.color === undefined || p.color === null)){ anyColor = true; col[(vo + i) * 3] = g.attributes.color.getX(i); col[(vo + i) * 3 + 1] = g.attributes.color.getY(i); col[(vo + i) * 3 + 2] = g.attributes.color.getZ(i); }
      else { col[(vo + i) * 3] = c.r; col[(vo + i) * 3 + 1] = c.g; col[(vo + i) * 3 + 2] = c.b; }
    }
    if (g.index){ for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.getX(i) + vo; io += g.index.count; }
    else { for (let i = 0; i < P.count; i++) idx[io + i] = vo + i; io += P.count; }
    vo += P.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (anyColor) geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere(); geo.computeBoundingBox();
  return geo;
}

// Free the shapes of something thrown away for good (not the shared, cached materials and textures).
export function disposeTree(obj){
  if (!obj) return;
  obj.traverse((o) => {
    if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    if (o.isInstancedMesh && o.dispose) o.dispose();
  });
  if (obj.parent) obj.parent.remove(obj);
}

// A geometry kept for the life of the page (never disposed by disposeTree).
export function shared(geo){ geo.userData.shared = true; return geo; }

// a lathe (turned) shape from [radius, y] pairs, with its ends capped when the radius is 0
export function lathe(profile, seg = 16){
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y)), seg);
  g.userData.keepUV = true;
  return g;
}

// Escape text for HTML.
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// money and numbers
export const money = (n) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
