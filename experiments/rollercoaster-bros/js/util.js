// Small shared helpers.
import * as THREE from 'three';

export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const UP = new THREE.Vector3(0, 1, 0);
export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
export const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
export const fmtMoney = (n) => '$' + Math.round(n).toLocaleString('en-US');

export function rng(seed){
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function textCanvas(w, h){
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { canvas: c, ctx, tex };
}
export function roundRect(g, x, y, w, h, r){
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
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

// Merge non-indexed geometries with position + normal (+ color) into one.
export function merge(list){
  const geos = list.map((g) => (g.index ? g.toNonIndexed() : g));
  const names = ['position', 'normal', 'color'].filter((n) => geos.length && geos.every((g) => g.attributes[n]));
  let count = 0; for (const g of geos) count += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  for (const n of names){
    const size = geos[0].attributes[n].itemSize, arr = new Float32Array(count * size);
    let o = 0; for (const g of geos){ arr.set(g.attributes[n].array, o); o += g.attributes[n].array.length; }
    out.setAttribute(n, new THREE.BufferAttribute(arr, size));
  }
  out.computeBoundingSphere();
  return out;
}

// A box (or other geometry) placed with a matrix, for merging.
export function placed(geo, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1){
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.applyMatrix4(new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V(sx, sy, sz)));
  return g;
}

// A simple seeded noise texture (for grass, concrete...).
export function noiseTexture(size, base, vary, seed = 1, repeat = 1){
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), img = g.createImageData(size, size), r = rng(seed);
  const col = { r: ((base >> 16) & 255) / 255, g: ((base >> 8) & 255) / 255, b: (base & 255) / 255 };
  for (let i = 0; i < size * size; i++){
    const n = (r() - 0.5) * vary + (r() < 0.04 ? (r() - 0.5) * vary * 2 : 0);
    img.data[i * 4] = clamp(col.r + n) * 255; img.data[i * 4 + 1] = clamp(col.g + n * 1.1) * 255; img.data[i * 4 + 2] = clamp(col.b + n * 0.8) * 255; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(repeat, repeat); tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
