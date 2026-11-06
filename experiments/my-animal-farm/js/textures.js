// Every texture in the game is painted here at start-up (no image files to download): grass, dirt,
// arena sand, wood, roofing, bedding, hay, leather, horse hair... Each one gets a matching normal map
// worked out from its height, so light catches the grain, planks and pebbles.
import * as THREE from 'three';
import { vnoise, fbm, hash2, rng, clamp, lerp } from './util.js';

let anisotropy = 4;
export function setAnisotropy(a){ anisotropy = a; }

// Paint a seamless texture of size x size. f(u, v, x, y) returns [r, g, b, height(0..1), alpha?].
function paint(size, f, { alpha = false, normal = 1.5 } = {}){
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); const img = g.createImageData(size, size); const d = img.data;
  const H = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++){
    const r = f(x / size, y / size, x, y), i = (y * size + x) * 4;
    d[i] = clamp(r[0], 0, 255); d[i + 1] = clamp(r[1], 0, 255); d[i + 2] = clamp(r[2], 0, 255); d[i + 3] = alpha ? clamp(r[4] ?? 255, 0, 255) : 255;
    H[y * size + x] = r[3] ?? 0.5;
  }
  g.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  let normalMap = null;
  if (normal){
    const n = document.createElement('canvas'); n.width = n.height = size;
    const ng = n.getContext('2d'); const ni = ng.createImageData(size, size); const nd = ni.data;
    const at = (x, y) => H[((y + size) % size) * size + ((x + size) % size)];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++){
      const dx = (at(x + 1, y) - at(x - 1, y)) * normal * size / 256, dy = (at(x, y + 1) - at(x, y - 1)) * normal * size / 256;
      const l = Math.hypot(dx, dy, 1), i = (y * size + x) * 4;
      nd[i] = (-dx / l * 0.5 + 0.5) * 255; nd[i + 1] = (dy / l * 0.5 + 0.5) * 255; nd[i + 2] = (1 / l * 0.5 + 0.5) * 255; nd[i + 3] = 255;
    }
    ng.putImageData(ni, 0, 0);
    normalMap = new THREE.CanvasTexture(n);
  }
  for (const t of [map, normalMap]) if (t){ t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = anisotropy; }
  return { map, normalMap };
}
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

const GEN = {
  grass(){
    return paint(512, (u, v) => {
      const big = fbm(u * 4, v * 4, 4, 1, 4), mid = fbm(u * 16, v * 16, 3, 2, 16);
      const blade = vnoise(u * 160, v * 40, 3, [160, 40]) * 0.6 + vnoise(u * 90, v * 200, 4, [90, 200]) * 0.4;
      const dry = clamp((fbm(u * 6, v * 6, 3, 9, 6) - 0.55) * 4);
      let c = mix([46, 74, 26], [96, 124, 46], big * 0.6 + mid * 0.4);
      c = mix(c, [128, 122, 64], dry * 0.55);
      const k = 0.62 + blade * 0.62;
      const clover = vnoise(u * 50, v * 50, 7, 50) > 0.82 ? 1 : 0;
      if (clover) c = mix(c, [60, 104, 40], 0.5);
      return [...mul(c, k), blade * 0.8 + mid * 0.2];
    }, { normal: 2.2 });
  },
  dirt(){
    return paint(512, (u, v, x, y) => {
      const n = fbm(u * 8, v * 8, 5, 11, 8), f = vnoise(u * 120, v * 120, 12, 120);
      let c = mix([84, 62, 42], [128, 98, 68], n);
      let h = n * 0.6 + f * 0.2;
      const cell = hash2(Math.floor(u * 70), Math.floor(v * 70), 5);
      if (cell > 0.93){ const pc = 0.8 + 0.4 * hash2(Math.floor(u * 70), Math.floor(v * 70), 6); c = mix(c, [150 * pc, 140 * pc, 126 * pc], 0.7); h += 0.4; }
      return [...mul(c, 0.85 + f * 0.3), h];
    }, { normal: 2 });
  },
  sand(){
    return paint(512, (u, v) => {
      const n = fbm(u * 6, v * 6, 4, 21, 6), g1 = vnoise(u * 256, v * 256, 22, 256), g2 = vnoise(u * 64, v * 64, 23, 64);
      // raked lines and hoof-churned patches
      const rake = Math.sin((u * 40 + fbm(u * 3, v * 3, 2, 24, 3) * 2) * Math.PI * 2) * 0.5 + 0.5;
      const churn = clamp((fbm(u * 10, v * 10, 3, 25, 10) - 0.5) * 3);
      let c = mix([176, 150, 112], [206, 184, 146], n * 0.5 + g2 * 0.5);
      c = mix(c, [150, 124, 90], churn * 0.4);
      const k = 0.88 + g1 * 0.22;
      return [...mul(c, k), g1 * 0.35 + rake * 0.25 * (1 - churn) + churn * g2 * 0.4];
    }, { normal: 1.6 });
  },
  gravel(){
    return paint(512, (u, v) => {
      const cx = u * 90, cy = v * 90, ix = Math.floor(cx), iy = Math.floor(cy);
      let best = 9, shade = 0.5;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++){
        const px = ix + a + hash2(((ix + a) % 90 + 90) % 90, ((iy + b) % 90 + 90) % 90, 31), py = iy + b + hash2(((ix + a) % 90 + 90) % 90, ((iy + b) % 90 + 90) % 90, 32);
        const d = Math.hypot(cx - px, cy - py); if (d < best){ best = d; shade = hash2(((ix + a) % 90 + 90) % 90, ((iy + b) % 90 + 90) % 90, 33); }
      }
      const h = clamp(1 - best * 1.4);
      const c = mix([120, 112, 100], [168, 160, 146], shade);
      return [...mul(c, 0.78 + h * 0.3), h];
    }, { normal: 2.5 });
  },
  // vertical boards, painted barn red
  barnRed(){ return boards([132, 38, 30], [160, 54, 40], 8, true, 0.55); },
  // stall walls and fences: natural pine, horizontal boards
  pine(){ return boards([150, 108, 64], [190, 146, 94], 6, false, 0.3); },
  oak(){ return boards([92, 64, 40], [120, 86, 54], 4, false, 0.35); },
  whitePaint(){ return boards([218, 216, 208], [236, 234, 228], 1, false, 0.08); },
  clapboard(){
    return paint(512, (u, v) => {
      const row = v * 10, f = row - Math.floor(row);
      const shade = 0.82 + f * 0.2 - (f < 0.06 ? 0.3 : 0);
      const n = vnoise(u * 60, v * 400, 41, [60, 400]);
      return [...mul([226, 222, 210], shade * (0.96 + n * 0.06)), f * 0.6 + n * 0.05];
    });
  },
  metalRoof(){
    return paint(256, (u, v) => {
      const s = (u * 8) % 1, rib = s < 0.08 ? 1 : 0;
      const n = fbm(u * 6, v * 6, 3, 51, 6), streak = vnoise(u * 80, v * 4, 52, [80, 4]);
      const c = mix([78, 90, 88], [104, 116, 112], n * 0.6 + streak * 0.4);
      return [...mul(c, rib ? 1.15 : 0.95), rib ? 1 : 0.3 + streak * 0.05];
    }, { normal: 3 });
  },
  shingles(){
    return paint(512, (u, v) => {
      const row = Math.floor(v * 16), off = row % 2 ? 0.5 : 0, col = Math.floor(u * 10 + off), f = v * 16 - row;
      const tone = 0.75 + hash2(col, row, 61) * 0.35, n = vnoise(u * 200, v * 200, 62, 200);
      const edge = (u * 10 + off) % 1 < 0.03 ? 0.6 : 1;
      return [...mul([70, 66, 64], tone * edge * (0.85 + n * 0.3) * (0.8 + f * 0.25)), f * 0.8 + n * 0.1];
    }, { normal: 2 });
  },
  concrete(){
    return paint(512, (u, v) => {
      const n = fbm(u * 5, v * 5, 5, 71, 5), f = vnoise(u * 200, v * 200, 72, 200);
      const crack = Math.abs(fbm(u * 3, v * 3, 4, 73, 3) - 0.5) < 0.006 ? 0.7 : 1;
      const c = mix([128, 126, 120], [164, 162, 156], n);
      return [...mul(c, crack * (0.9 + f * 0.15)), n * 0.3 + f * 0.2];
    }, { normal: 1 });
  },
  // rubber stall mats
  rubber(){
    return paint(256, (u, v) => {
      const d = ((u * 24) % 1 - 0.5) ** 2 + ((v * 24) % 1 - 0.5) ** 2 < 0.06 ? 1 : 0, n = vnoise(u * 100, v * 100, 81, 100);
      return [...mul([40, 40, 42], 0.85 + n * 0.25 + d * 0.15), d * 0.5 + n * 0.1];
    });
  },
  // pine shavings bedding
  shavings(){
    return paint(512, (u, v, x, y) => {
      const n = fbm(u * 10, v * 10, 3, 91, 10);
      // curly flakes: angled noise streaks
      const a = vnoise(u * 40, v * 40, 92, 40) * Math.PI * 2;
      const s = vnoise((u * Math.cos(a) - v * Math.sin(a)) * 160, (u * Math.sin(a) + v * Math.cos(a)) * 30, 93);
      const c = mix([196, 164, 110], [236, 214, 166], s * 0.7 + n * 0.3);
      return [...mul(c, 0.82 + s * 0.3), s * 0.7 + n * 0.3];
    }, { normal: 2.5 });
  },
  // hay / straw: long crossing stalks
  hay(){
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const g = c.getContext('2d'); const R = rng(101);
    g.fillStyle = '#9c8c4c'; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 2600; i++){
      const x = R() * 512, y = R() * 512, a = (R() - 0.5) * 0.9 + (R() < 0.5 ? 0 : Math.PI / 2) * 0.25, L = 30 + R() * 90;
      const t = R(); g.strokeStyle = `rgb(${150 + t * 80},${140 + t * 70},${70 + t * 50})`; g.lineWidth = 1 + R() * 2.2;
      for (const ox of [-512, 0, 512]) for (const oy of [-512, 0, 512]){
        g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + Math.cos(a) * L, y + oy + Math.sin(a) * L); g.stroke();
      }
    }
    // green tint in places (good hay is a little green)
    for (let i = 0; i < 40; i++){ g.fillStyle = `rgba(110,140,60,${0.05 + R() * 0.08})`; g.beginPath(); g.arc(R() * 512, R() * 512, 20 + R() * 60, 0, 7); g.fill(); }
    return fromCanvas(c, 2);
  },
  leather(){
    return paint(256, (u, v) => {
      const n = fbm(u * 12, v * 12, 4, 111, 12), p = vnoise(u * 120, v * 120, 112, 120);
      const c = mix([72, 38, 20], [110, 62, 34], n);
      return [...mul(c, 0.85 + p * 0.25), p * 0.4 + n * 0.2];
    }, { normal: 1.2 });
  },
  quilt(){
    return paint(256, (u, v) => {
      const a = ((u + v) * 8) % 1, b = ((u - v + 1) * 8) % 1, seam = Math.min(a, 1 - a, b, 1 - b);
      const h = clamp(seam * 6), n = vnoise(u * 160, v * 160, 121, 160);
      return [235 * (0.8 + h * 0.2 + n * 0.05), 235 * (0.8 + h * 0.2 + n * 0.05), 235 * (0.8 + h * 0.2 + n * 0.05), h];
    }, { normal: 2 });
  },
  bark(){
    return paint(256, (u, v) => {
      const n = fbm(u * 6, v * 2, 4, 131, [6, 2]), r = vnoise(u * 40, v * 6, 132, [40, 6]);
      const ridge = Math.abs(Math.sin((u * 14 + n * 1.5) * Math.PI));
      const c = mix([54, 44, 36], [104, 92, 80], ridge * 0.6 + r * 0.4);
      return [...c, ridge * 0.7 + r * 0.3];
    }, { normal: 3 });
  },
  // a leafy clump with transparent gaps, for tree crowns and hedges
  leaves(){
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d'); const R = rng(141);
    for (let i = 0; i < 900; i++){
      const x = R() * 256, y = R() * 256, s = 4 + R() * 7, a = R() * Math.PI, t = R();
      g.fillStyle = `rgb(${60 + t * 70},${100 + t * 70},${34 + t * 36})`;
      g.save(); g.translate(x, y); g.rotate(a); g.beginPath(); g.ellipse(0, 0, s, s * 0.45, 0, 0, 7); g.fill(); g.restore();
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = anisotropy;
    return { map: t, normalMap: null };
  },
  // fine short hair, multiplied over a horse's coat colour (light grey so the colour shows true)
  coat(){
    return paint(512, (u, v) => {
      const h1 = vnoise(u * 300, v * 30, 151, [300, 30]), h2 = vnoise(u * 180, v * 22, 152, [180, 22]), n = fbm(u * 8, v * 8, 3, 153, 8);
      const k = 205 + (h1 * 0.6 + h2 * 0.4) * 40 + n * 10;
      return [k, k, k, h1 * 0.6 + h2 * 0.4];
    }, { normal: 0.8 });
  },
  // long hair for manes and tails: strands with see-through gaps at the ends
  hair(){
    const c = document.createElement('canvas'); c.width = 128; c.height = 512;
    const g = c.getContext('2d'); const R = rng(161);
    for (let i = 0; i < 420; i++){
      const x = R() * 128, len = 300 + R() * 212, w = 0.8 + R() * 1.6, t = R();
      const grd = g.createLinearGradient(0, 0, 0, len);
      grd.addColorStop(0, `rgba(${200 + t * 55},${200 + t * 55},${200 + t * 55},1)`);
      grd.addColorStop(0.85, `rgba(${200 + t * 55},${200 + t * 55},${200 + t * 55},0.9)`);
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.strokeStyle = grd; g.lineWidth = w; g.beginPath(); g.moveTo(x, 0);
      g.bezierCurveTo(x + (R() - 0.5) * 20, len * 0.3, x + (R() - 0.5) * 30, len * 0.7, x + (R() - 0.5) * 30, len); g.stroke();
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = anisotropy;
    return { map: t, normalMap: null };
  },
  wool(){
    return paint(256, (u, v) => {
      const n = fbm(u * 24, v * 24, 4, 171, 24), b = vnoise(u * 60, v * 60, 172, 60);
      const k = 190 + n * 50 + b * 20;
      return [k, k * 0.96, k * 0.88, n * 0.7 + b * 0.3];
    }, { normal: 3 });
  },
  feathers(){
    return paint(256, (u, v) => {
      const row = v * 20, f = row - Math.floor(row), off = Math.floor(row) % 2 ? 0.5 : 0, cu = (u * 14 + off) % 1;
      const s = clamp(1 - Math.hypot(cu - 0.5, f - 0.2) * 1.8), n = vnoise(u * 100, v * 100, 181, 100);
      const k = 200 + s * 40 + n * 15;
      return [k, k, k, s];
    }, { normal: 1.5 });
  },
  skin(){
    return paint(256, (u, v) => {
      const n = fbm(u * 20, v * 20, 4, 191, 20); const k = 210 + n * 40;
      return [k, k, k, n];
    }, { normal: 0.6 });
  },
  denim(){
    return paint(128, (u, v, x, y) => {
      const t = ((x + y) % 4 < 2) ? 1 : 0.85, n = vnoise(u * 40, v * 40, 201, 40);
      return [70 * t + n * 20, 96 * t + n * 20, 140 * t + n * 25, t];
    }, { normal: 0.5 });
  },
};
function fromCanvas(c, normalStrength){
  const g = c.getContext('2d'), s = c.width, img = g.getImageData(0, 0, s, s).data;
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace;
  const n = document.createElement('canvas'); n.width = n.height = s;
  const ng = n.getContext('2d'); const ni = ng.createImageData(s, s); const nd = ni.data;
  const at = (x, y) => { const i = (((y + s) % s) * s + ((x + s) % s)) * 4; return (img[i] + img[i + 1] + img[i + 2]) / 765; };
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++){
    const dx = (at(x + 1, y) - at(x - 1, y)) * normalStrength * 2, dy = (at(x, y + 1) - at(x, y - 1)) * normalStrength * 2;
    const l = Math.hypot(dx, dy, 1), i = (y * s + x) * 4;
    nd[i] = (-dx / l * 0.5 + 0.5) * 255; nd[i + 1] = (dy / l * 0.5 + 0.5) * 255; nd[i + 2] = (1 / l * 0.5 + 0.5) * 255; nd[i + 3] = 255;
  }
  ng.putImageData(ni, 0, 0);
  const normalMap = new THREE.CanvasTexture(n);
  for (const t of [map, normalMap]){ t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = anisotropy; }
  return { map, normalMap };
}
// Boards: `count` across the texture, vertical (barn siding) or horizontal (stall walls, fences).
function boards(c0, c1, count, vertical, grainK){
  return paint(512, (u0, v0) => {
    const u = vertical ? u0 : v0, v = vertical ? v0 : u0;
    const b = Math.floor(u * count), f = u * count - b;
    const tone = hash2(b, 0, 211);
    const grain = vnoise(f * 6 + b * 13, v * 70, 212, [0, 70]) * 0.6 + vnoise(f * 18 + b * 7, v * 180, 213, [0, 180]) * 0.4;
    const knot = Math.max(0, 1 - Math.hypot((f - 0.5) * 3, ((v * 3 + tone * 7) % 1 - 0.5) * 6) * 1.5) * (tone > 0.6 ? 1 : 0);
    let c = mix(c0, c1, tone * 0.6 + grain * grainK * 2);
    c = mul(c, 1 - knot * 0.35);
    const gap = f < 0.025 || f > 0.975;
    if (gap) c = mul(c, 0.35);
    return [...c, gap ? 0 : 0.6 + grain * 0.25 - knot * 0.2];
  }, { normal: 2 });
}

const cache = new Map();
export function tex(name){
  if (!cache.has(name)) cache.set(name, GEN[name]());
  return cache.get(name);
}
// A texture repeated `rep` times (a separate copy, since repeat lives on the texture).
function repTex(t, rep){
  if (!t || rep === 1) return t;
  const c = t.clone(); c.repeat.set(rep, rep); c.needsUpdate = true; return c;
}

const mats = new Map();
// Materials are shared by name. opts: color (tint), rough, metal, rep (texture repeats), side, alpha.
export function mat(name, opts = {}){
  const key = name + JSON.stringify(opts);
  if (mats.has(key)) return mats.get(key);
  let m;
  if (!GEN[name]){
    m = new THREE.MeshStandardMaterial({ color: opts.color ?? 0x888888, roughness: opts.rough ?? 0.8, metalness: opts.metal ?? 0, side: opts.side ?? THREE.FrontSide, vertexColors: !!opts.vc });
  } else {
    const t = tex(name), rep = opts.rep ?? 1;
    m = new THREE.MeshStandardMaterial({
      map: repTex(t.map, rep), normalMap: repTex(t.normalMap, rep), color: opts.color ?? 0xffffff,
      roughness: opts.rough ?? 0.85, metalness: opts.metal ?? 0, side: opts.side ?? THREE.FrontSide, vertexColors: !!opts.vc,
    });
    if (opts.alpha){ m.alphaTest = opts.alpha; m.transparent = false; }
    if (opts.normal != null && m.normalMap) m.normalScale.set(opts.normal, opts.normal);
  }
  mats.set(key, m);
  return m;
}
