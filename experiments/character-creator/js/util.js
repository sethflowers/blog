// Small shared helpers: maths, seeded random, noise, canvas text.
import * as THREE from 'three';

export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
export const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
export const smoothstep = (a, b, x) => smooth((x - a) / (b - a));
// a soft bump: 1 at the middle, 0 from distance 1 outwards, with a smooth shoulder
export const bump = (q) => (q >= 1 ? 0 : (1 - q) * (1 - q) * (1 + 2 * q));   // q = squared normalised distance
export const gauss = (q) => Math.exp(-q * 2.2);

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
  const w = (a) => (per ? ((a % per) + per) % per : a);
  const a = hash2(w(xi), w(zi), s), b = hash2(w(xi + 1), w(zi), s), c = hash2(w(xi), w(zi + 1), s), d = hash2(w(xi + 1), w(zi + 1), s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, z, oct = 4, s = 0, per = 0){
  let t = 0, amp = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++){ t += amp * vnoise(x * f, z * f, s + i * 17, per ? per * f : 0); n += amp; amp *= 0.5; f *= 2; }
  return t / n;
}

export function canvas(w, h = w){
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return c;
}
export function canvasTexture(c, srgb = true){
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
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
  r = Math.min(r, w / 2, h / 2);
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
// colours: '#rrggbb' <-> hsl, mixing, darkening
export function hexToRgb(h){ const n = parseInt(String(h).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export function rgbToHex(r, g, b){ return '#' + [r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join(''); }
export function mixHex(a, b, t){ const A = hexToRgb(a), B = hexToRgb(b); return rgbToHex(lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)); }
export function shade(hex, k){ return k >= 0 ? mixHex(hex, '#ffffff', k) : mixHex(hex, '#000000', -k); }
export function rgba(hex, a){ const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }
export function hexToHsl(hex){
  let [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (mx !== mn){
    const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6;
  }
  return [h, s, l];
}
export function hslToHex(h, s, l){
  const f = (n) => { const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
}
// free a group's geometries (not the shared materials or textures)
export function disposeTree(obj){
  if (!obj) return;
  obj.traverse((o) => { if (o.geometry && !o.geometry.userData.keep) o.geometry.dispose(); });
}
