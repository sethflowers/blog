// Made-up textures for the town (drawn once at start, pixel by pixel; nothing to download), and normal
// maps for surface relief made from height functions. Ideas and several of them from MSB's gallery.js.
// Each texture covers a known size in metres (boxes have UVs in metres), noted by `m`.
import * as THREE from 'three';
import { hash2, vnoise } from './util.js';

function canvasTex(w, h, draw){
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function pixTex(w, h, fn){
  return canvasTex(w, h, (g) => { const img = g.createImageData(w, h), d = img.data; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){ const c = fn(x, y), i = (y * w + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; } g.putImageData(img, 0, 0); });
}
function normalTex(w, h, height, strength = 2){
  const H = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) H[y * w + x] = height(x, y);
  const t = pixTex(w, h, (x, y) => {
    const at = (a, b) => H[((b + h) % h) * w + ((a + w) % w)];
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1);
    return [(-dx / l * 0.5 + 0.5) * 255, (dy / l * 0.5 + 0.5) * 255, (1 / l * 0.5 + 0.5) * 255];
  });
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
// a texture shown at `m` metres per repeat
const per = (t, m) => { t.repeat.set(1 / m, 1 / m); return t; };

// ---------- heights (for the normal maps) ----------
// weatherboards: 16 px a board (0.2 m), each board's lower edge stands proud of the one below
const sidingH = (x, y) => { const f = (y % 16) / 16; return f * 0.8 + vnoise(x * 0.1, y * 0.4, 3, 12.8) * 0.06; };
const brickH = (x, y) => { const row = Math.floor(y / 16), off = row % 2 ? 24 : 0, fx = (x + off) % 48, fy = y % 16; const j = Math.min(fx, 48 - fx, fy, 16 - fy); return Math.min(1, j / 2) + hash2(x, y, 6) * 0.08; };
const shingleH = (x, y) => { const row = Math.floor(y / 16), off = row % 2 ? 12 : 0, fx = (x + off) % 24, fy = y % 16; return fy / 16 * 0.9 + (fx < 1.2 ? -0.4 : 0) + hash2(x, y, 4) * 0.08; };
const concreteH = (x, y) => { const j = Math.min(x % 128, 128 - (x % 128), y % 128, 128 - (y % 128)); return Math.min(1, j / 2) + hash2(x, y, 5) * 0.06; };
const paverH = (x, y) => { const row = Math.floor(y / 32), off = row % 2 ? 16 : 0, fx = (x + off) % 64, fy = y % 32, j = Math.min(fx, 64 - fx, fy, 32 - fy); return Math.min(1, j / 2.5) + hash2(x, y, 11) * 0.06; };
const plankH = (x, y) => { const fx = x % 32, j = Math.min(fx, 32 - fx); const k = Math.floor(x / 32), fy = (y + Math.floor(hash2(k, 0, 2) * 256)) % 256; return (j < 1 || fy < 1 ? 0 : 1) + vnoise(x * 0.05, y * 0.4, k, 0) * 0.08; };
const plasterH = (x, y) => vnoise(x * 0.09375, y * 0.09375, 12, 24) * 0.6 + vnoise(x * 0.375, y * 0.375, 13, 96) * 0.4;
const asphaltH = (x, y) => hash2(x, y, 7) * 0.6 + vnoise(x * 0.2, y * 0.2, 8, 51.2) * 0.4;

let cache = null;
export function textures(){
  if (cache) return cache;
  const T = {};
  // grass: 3 m
  T.grass = per(pixTex(256, 256, (x, y) => {
    const n = vnoise(x * 0.0390625, y * 0.0390625, 1, 10) * 0.5 + vnoise(x * 0.15625, y * 0.15625, 2, 40) * 0.3 + hash2(x, y, 3) * 0.2;
    return [62 + n * 52, 104 + n * 62, 40 + n * 26];
  }), 3);
  // asphalt: 4 m
  T.asphalt = per(pixTex(256, 256, (x, y) => { const n = hash2(x, y, 7) * 0.5 + vnoise(x * 0.09375, y * 0.09375, 2, 24) * 0.5; const v = 56 + n * 30; return [v, v, v + 3]; }), 4);
  T.asphaltN = per(normalTex(256, 256, asphaltH, 1.2), 4);
  // concrete sidewalk slabs, 1.5 m square (the texture is two by two)
  T.concrete = per(pixTex(256, 256, (x, y) => { const j = x % 128 < 2 || y % 128 < 2; const n = hash2(x, y, 5) * 0.35 + vnoise(x * 0.05, y * 0.05, 8, 12.8) * 0.65; const v = j ? 128 : 172 + n * 30; return [v, v - 2, v - 7]; }), 3);
  T.concreteN = per(normalTex(256, 256, concreteH, 2), 3);
  // brick pavers for front paths and the park: 1 m
  T.paver = per(pixTex(128, 128, (x, y) => { const row = Math.floor(y / 32), off = row % 2 ? 16 : 0, fx = (x + off) % 64, fy = y % 32, j = fx < 2 || fy < 2, k = hash2(Math.floor((x + off) / 64), row, 4); const t = 0.85 + k * 0.25; return j ? [120, 112, 100] : [172 * t, 120 * t, 92 * t]; }), 1);
  T.paverN = per(normalTex(128, 128, paverH, 2.5), 1);
  // weatherboard siding, near white (the material's colour paints it): 2 m (boards 0.2 m)
  T.siding = per(pixTex(128, 160, (x, y) => { const f = (y % 16) / 16, n = vnoise(x * 0.08, y * 0.3, 2, 10.24) * 0.06 + hash2(x, y, 9) * 0.04; const v = (f > 0.88 ? 0.72 : 0.92 + f * 0.08) - n; return [255 * v, 255 * v, 255 * v]; }), 2);
  T.sidingN = per(normalTex(128, 160, sidingH, 3), 2);
  // red brick: 1.5 m (bricks 0.25 m by 0.08 m)
  T.brick = per(pixTex(288, 96 * 3, (x, y) => {
    const row = Math.floor(y / 16), off = row % 2 ? 24 : 0, col = Math.floor((x + off) / 48), fx = (x + off) % 48, fy = y % 16, j = fx < 2 || fy < 2;
    const k = hash2(col, row, 8), n = vnoise(x * 0.2, y * 0.2, 3) * 0.15, t = 0.78 + k * 0.32 - n;
    return j ? [190, 184, 172] : [158 * t, 72 * t, 52 * t];
  }), 1.5);
  T.brickN = per(normalTex(288, 288, brickH, 2.5), 1.5);
  // roof shingles, grey (tinted): 2 m
  T.shingle = per(pixTex(192, 192, (x, y) => { const row = Math.floor(y / 16), off = row % 2 ? 12 : 0, fx = (x + off) % 24, k = hash2(Math.floor((x + off) / 24), row, 4), f = (y % 16) / 16, v = (0.7 + k * 0.3) * (0.75 + f * 0.25) * (fx < 1.2 ? 0.6 : 1) + hash2(x, y, 3) * 0.06; return [210 * v, 210 * v, 214 * v]; }), 2);
  T.shingleN = per(normalTex(192, 192, shingleH, 3), 2);
  // wood floor planks: 1.5 m
  T.planks = per(pixTex(256, 256, (x, y) => { const k = Math.floor(x / 32), t = 0.82 + hash2(k, 1, 2) * 0.3, g = vnoise(x * 0.06, y * 0.012 + k * 9, k, 0) * 0.5 + vnoise(x * 0.3, y * 0.05, k + 3, 0) * 0.2; const fx = x % 32, fy = (y + Math.floor(hash2(k, 0, 2) * 256)) % 256, edge = fx < 1 || fy < 1 ? 0.6 : 1; return [(150 + g * 50) * t * edge, (102 + g * 34) * t * edge, (62 + g * 20) * t * edge]; }), 1.5);
  T.planksN = per(normalTex(256, 256, plankH, 2), 1.5);
  // shop floor tiles: 1.2 m (four tiles)
  T.tiles = per(pixTex(128, 128, (x, y) => { const j = x % 64 < 2 || y % 64 < 2, chk = (Math.floor(x / 64) + Math.floor(y / 64)) % 2, n = hash2(x, y, 1) * 0.05; const v = (chk ? 0.92 : 0.7) - n; return j ? [150, 150, 150] : [236 * v, 232 * v, 222 * v]; }), 1.2);
  // plaster for inside walls: 1.6 m
  T.plasterN = per(normalTex(256, 256, plasterH, 1.2), 1.6);
  // hedges: 1 m
  T.hedge = per(pixTex(128, 128, (x, y) => { const n = vnoise(x * 0.25, y * 0.25, 4, 32) * 0.6 + hash2(x, y, 2) * 0.4; return [34 + n * 44, 70 + n * 64, 26 + n * 26]; }), 1);
  cache = T;
  return T;
}
