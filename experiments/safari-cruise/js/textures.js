// Textures painted at start-up, pixel by pixel, from seamless noise (so nothing is downloaded).
import * as THREE from 'three';
import { fbm, vnoise, hash2, clamp, lerp } from './util.js';

// Paint a w×h texture. fn(u, v, x, y) returns [r, g, b] (0..1). Seamless when fn uses periodic noise.
export function paint(w, h, fn, { repeat = 1, srgb = true, wrap = true } = {}){
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'), img = g.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const col = fn(x / w, y / h, x, y), i = (y * w + x) * 4;
    d[i] = clamp(col[0]) * 255; d[i + 1] = clamp(col[1]) * 255; d[i + 2] = clamp(col[2]) * 255; d[i + 3] = col.length > 3 ? clamp(col[3]) * 255 : 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  if (wrap){ t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.repeat.set(repeat, repeat);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.canvas = c;
  return t;
}
export const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
export const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

const cache = new Map();
function once(name, make){ if (!cache.has(name)) cache.set(name, make()); return cache.get(name); }

// light, grainy detail laid over the ground's vertex colours (grass blades, soil specks)
export const groundDetail = () => once('ground', () => paint(256, 256, (u, v, x, y) => {
  const n = fbm(u * 16, v * 16, 3, 2, 16), s = hash2(x, y, 7), blade = vnoise(u * 64, v * 10, 4, [64, 10]);
  const k = 0.78 + n * 0.3 + (s - 0.5) * 0.12 + (blade - 0.5) * 0.18;
  return [k, k * 0.98, k * 0.92];
}));
// the gravel road
export const gravel = () => once('gravel', () => paint(256, 256, (u, v, x, y) => {
  const n = fbm(u * 8, v * 8, 4, 11, 8), s = hash2(x, y, 3), p = hash2(x >> 1, y >> 1, 5);
  const base = mix([0.62, 0.48, 0.34], [0.74, 0.62, 0.48], n);
  const k = 0.9 + (s - 0.5) * 0.25 + (p > 0.93 ? 0.18 : p < 0.05 ? -0.2 : 0);
  // two wheel ruts, a little darker and smoother
  const rut = Math.exp(-(((u - 0.27) / 0.07) ** 2)) + Math.exp(-(((u - 0.73) / 0.07) ** 2));
  return mul(base, k * (1 - rut * 0.12));
}));
export const thatch = () => once('thatch', () => paint(256, 256, (u, v, x, y) => {
  const n = vnoise(u * 90, v * 6, 21, [90, 6]), m = fbm(u * 6, v * 6, 3, 8, 6), s = hash2(x, y, 2);
  const k = 0.55 + n * 0.45 + (s - 0.5) * 0.15;
  return mix([0.42, 0.33, 0.18], [0.78, 0.65, 0.38], clamp(k * (0.8 + m * 0.4)));
}));
export const wood = () => once('wood', () => paint(128, 256, (u, v) => {
  const n = vnoise(u * 6, v * 60, 5, [6, 60]), g = fbm(u * 3, v * 20, 3, 6, [3, 20]);
  return mul([0.48, 0.34, 0.22], 0.75 + n * 0.3 + g * 0.2);
}));
export const bark = () => once('bark', () => paint(128, 256, (u, v) => {
  const n = vnoise(u * 10, v * 30, 9, [10, 30]), g = fbm(u * 4, v * 8, 3, 3, [4, 8]);
  const k = 0.55 + n * 0.35 + g * 0.3 - (n > 0.8 ? 0.25 : 0);
  return mul([0.42, 0.36, 0.3], k);
}));
export const leaves = () => once('leaves', () => paint(128, 128, (u, v, x, y) => {
  const n = fbm(u * 10, v * 10, 3, 31, 10), s = hash2(x, y, 9);
  return mul([0.9, 1, 0.85], 0.65 + n * 0.45 + (s - 0.5) * 0.2);
}));
export const rockTex = () => once('rock', () => paint(256, 256, (u, v, x, y) => {
  const n = fbm(u * 6, v * 6, 5, 41, 6), c = vnoise(u * 30, v * 30, 2, 30), s = hash2(x, y, 1);
  const k = 0.6 + n * 0.45 + (c > 0.82 ? -0.15 : 0) + (s - 0.5) * 0.1;
  return mix([0.5, 0.42, 0.36], [0.72, 0.64, 0.56], clamp(k - 0.3));
}));
export const water = () => once('water', () => paint(256, 256, (u, v) => {
  const n = fbm(u * 6, v * 6, 4, 51, 6);
  return mix([0.2, 0.3, 0.26], [0.32, 0.42, 0.34], n);
}));
export const canvasCloth = () => once('canvas', () => paint(128, 128, (u, v, x, y) => {
  const w = ((x + y) & 1) ? 0.96 : 1, n = fbm(u * 5, v * 5, 3, 61, 5);
  return mul([0.82, 0.74, 0.56], w * (0.85 + n * 0.2));
}));
