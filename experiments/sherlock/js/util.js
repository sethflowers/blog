// Small helpers shared by the game's modules.
import * as THREE from 'three';
import { mergeGeometries } from '../lib/addons/BufferGeometryUtils.js';
export { mergeGeometries };

export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
export const angleDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

export function textCanvas(w, h){
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { canvas: c, ctx, tex };
}
export function wrapText(ctx, text, maxW){
  const out = [];
  for (const para of String(text).split('\n')){
    const words = para.split(' '); let line = '';
    for (const w of words){
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && line){ out.push(line); line = w; } else line = t;
    }
    out.push(line);
  }
  return out;
}
export function roundRect(g, x, y, w, h, r){
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
// free the shapes of something thrown away for good (not the shared cached materials and textures;
// geometries marked userData.keep are shared too)
export function disposeTree(obj){
  if (!obj) return;
  obj.traverse((o) => { if (o.geometry && !o.geometry.userData.keep) o.geometry.dispose(); });
}

// ---------- materials and textures, cached by name ----------
const mats = new Map(), texs = new Map();
export function mat(name, opts = {}){
  if (mats.has(name)) return mats.get(name);
  const { color = 0xffffff, rough = 0.8, metal = 0, map = null, emissive = 0x000000, emissiveIntensity = 1, transparent = false, opacity = 1, side = THREE.FrontSide, basic = false, depthWrite = true, alphaTest = 0, polygonOffset = false } = opts;
  const m = basic
    ? new THREE.MeshBasicMaterial({ color, map, transparent, opacity, side, depthWrite, alphaTest })
    : new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, map, emissive, emissiveIntensity, transparent, opacity, side, depthWrite, alphaTest });
  if (polygonOffset){ m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; }
  m.name = name;
  mats.set(name, m); return m;
}
// a canvas texture drawn once by draw(ctx, size), cached by name (512 px unless asked)
export function tex(name, draw, { size = 512, repeat = [1, 1], srgb = true } = {}){
  if (texs.has(name)) return texs.get(name);
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); t.anisotropy = 4;
  texs.set(name, t); return t;
}
// a little seeded noise for textures
export function noiseRng(seed){ let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// ---------- Batch: everything static merged into one mesh per material ----------
// Boxes are logged (Batch.log) so the test can check that no two surfaces sit in the same place.
export class Batch {
  constructor(){ this.parts = new Map(); this.log = []; }
  add(geo, material, matrix){
    if (matrix) geo.applyMatrix4(matrix);
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!this.parts.has(material)) this.parts.set(material, []);
    this.parts.get(material).push(g);
    return g;
  }
  // a box from (x0,y0,z0) to (x1,y1,z1), UVs in metres (so textures repeat at a sensible size)
  box(x0, y0, z0, x1, y1, z1, material, uvScale = 1, tag = ''){
    const w = x1 - x0, h = y1 - y0, d = z1 - z0;
    if (w <= 0 || h <= 0 || d <= 0) return;
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv, n = g.attributes.normal;
    for (let i = 0; i < uv.count; i++){
      const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
      const sx = ax > 0.5 ? d : w, sy = ay > 0.5 ? d : h;
      uv.setXY(i, uv.getX(i) * sx * uvScale, uv.getY(i) * sy * uvScale);
    }
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.add(g, material);
    this.log.push({ min: [x0, y0, z0], max: [x1, y1, z1], tag: tag || material.name, m: material.name });
  }
  build(parent){
    const out = [];
    for (const [m, list] of this.parts){
      const g = mergeGeometries(list, false);
      list.forEach((x) => x.dispose());
      const mesh = new THREE.Mesh(g, m); mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      mesh.receiveShadow = false; mesh.castShadow = false;
      parent.add(mesh); out.push(mesh);
    }
    this.parts.clear();
    return out;
  }
}
