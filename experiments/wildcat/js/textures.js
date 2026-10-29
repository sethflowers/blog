// Every texture in the game is painted here at start-up, from noise and canvas strokes, so there is
// nothing to download. Ground, rock and bark get a colour map and a normal map; the pine branches and
// ferns are cut-out cards painted with a canvas.
import * as THREE from 'three';
import { tfbm, tnoise, mulberry, clamp, smooth } from './noise.js';

function canvas(w, h){ const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function tex(c, srgb = true, repeat = true){
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

// a normal map from a height field (Float32Array, w*h), wrapping at the edges
function normalFrom(hgt, w, h, strength){
  const c = canvas(w, h), g = c.getContext('2d'), img = g.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const l = hgt[y * w + ((x - 1 + w) % w)], r = hgt[y * w + ((x + 1) % w)];
    const u = hgt[((y - 1 + h) % h) * w + x], dn = hgt[((y + 1) % h) * w + x];
    let nx = (l - r) * strength, ny = (dn - u) * strength, nz = 1;
    const k = 1 / Math.hypot(nx, ny, nz); nx *= k; ny *= k; nz *= k;
    const i = (y * w + x) * 4;
    d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255; d[i + 2] = (nz * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return tex(c, false);
}

// paint a w*h colour map and height map from a per-pixel function returning [r, g, b, height]
function paint(w, h, fn){
  const c = canvas(w, h), g = c.getContext('2d'), img = g.createImageData(w, h), d = img.data;
  const hgt = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const [r, gg, b, hh] = fn(x / w, y / h, x, y);
    const i = (y * w + x) * 4;
    d[i] = clamp(r, 0, 1) * 255; d[i + 1] = clamp(gg, 0, 1) * 255; d[i + 2] = clamp(b, 0, 1) * 255; d[i + 3] = 255;
    hgt[y * w + x] = hh;
  }
  g.putImageData(img, 0, 0);
  return { c, g, hgt };
}

// Worley-ish cells for pebbles and leaf litter: distance to the nearest of a few jittered points per cell (tileable)
function cells(u, v, n, s){
  const x = u * n, y = v * n, xi = Math.floor(x), yi = Math.floor(y);
  let best = 9, id = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++){
    const cx = xi + i, cy = yi + j, wx = ((cx % n) + n) % n, wy = ((cy % n) + n) % n;
    const px = cx + tnoise(wx + 0.5, wy + 0.5, 1e6, s), py = cy + tnoise(wx + 0.5, wy + 0.5, 1e6, s + 1);
    const dd = Math.hypot(x - px, y - py);
    if (dd < best){ best = dd; id = tnoise(wx + 0.5, wy + 0.5, 1e6, s + 2); }
  }
  return [best, id];
}

export function makeTextures(quality){
  const S = quality > 1 ? 512 : 256;
  const T = {};

  // ---- grass ground: the soil between grass blades, with dead thatch and green
  {
    const { c, hgt } = paint(S, S, (u, v) => {
      const n = tfbm(u * 8, v * 8, 8, 5, 3), m = tfbm(u * 48, v * 48, 48, 3, 9), f = tfbm(u * 128, v * 128, 128, 2, 4);
      const green = smooth(0.38, 0.62, n);
      let r = 0.17 + 0.08 * m, g = 0.15 + 0.06 * m, b = 0.08 + 0.03 * m;
      r = r * (1 - green) + (0.15 + 0.06 * f) * green; g = g * (1 - green) + (0.24 + 0.08 * f) * green; b = b * (1 - green) + 0.07 * green;
      const dry = smooth(0.55, 0.75, f) * 0.6;
      r += dry * 0.14; g += dry * 0.11; b += dry * 0.04;
      return [r, g, b, n * 0.4 + m * 0.4 + f * 0.3];
    });
    T.grass = tex(c); T.grassN = normalFrom(hgt, S, S, 3);
  }
  // ---- forest floor: pine needles, small leaves and dark soil
  {
    const rnd = mulberry(7);
    const { c, g, hgt } = paint(S, S, (u, v) => {
      const n = tfbm(u * 6, v * 6, 6, 5, 11), m = tfbm(u * 40, v * 40, 40, 2, 12);
      const [d, id] = cells(u, v, 22, 40);
      const leaf = d < 0.35 ? 1 - d / 0.35 : 0;
      let r = 0.17 + 0.06 * n + 0.04 * m, gg = 0.12 + 0.04 * n + 0.02 * m, b = 0.07 + 0.02 * n;
      if (leaf > 0){ const k = smooth(0, 0.3, leaf); r += k * (0.12 + id * 0.12); gg += k * (0.05 + id * 0.06); b += k * 0.02; }
      return [r, gg, b, n * 0.5 + leaf * 0.5 + m * 0.2];
    });
    // pine needles scattered on top
    g.lineCap = 'round';
    for (let i = 0; i < S * 5; i++){
      const x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI, l = S * (0.012 + rnd() * 0.02);
      const t = rnd();
      g.strokeStyle = `rgba(${130 + t * 70 | 0},${70 + t * 40 | 0},${30 + t * 15 | 0},${0.55 + rnd() * 0.4})`;
      g.lineWidth = S / 512 * (0.8 + rnd());
      for (const ox of [0, -S, S]) for (const oy of [0, -S, S]){
        g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l); g.stroke();
      }
    }
    T.dirt = tex(c); T.dirtN = normalFrom(hgt, S, S, 4);
  }
  // ---- rock: grey granite with lichen and cracks
  {
    const { c, hgt } = paint(S, S, (u, v) => {
      const n = tfbm(u * 4, v * 4, 4, 6, 21), m = tfbm(u * 48, v * 48, 48, 2, 22);
      const crack = Math.pow(1 - Math.abs(tfbm(u * 5, v * 5, 5, 4, 23) - 0.5) * 2, 18);
      const lichen = smooth(0.58, 0.66, tfbm(u * 10, v * 10, 10, 4, 24));
      const moss = smooth(0.62, 0.72, tfbm(u * 3, v * 3, 3, 4, 25));
      let k = 0.34 + 0.18 * n + 0.12 * (m - 0.5);
      let r = k, g = k * 0.98, b = k * 0.95;
      r = r * (1 - lichen) + (0.62 + m * 0.1) * lichen; g = g * (1 - lichen) + (0.6 + m * 0.1) * lichen; b = b * (1 - lichen) + 0.45 * lichen;
      r = r * (1 - moss) + 0.16 * moss; g = g * (1 - moss) + 0.22 * moss; b = b * (1 - moss) + 0.07 * moss;
      r *= 1 - crack * 0.7; g *= 1 - crack * 0.7; b *= 1 - crack * 0.7;
      return [r, g, b, n + m * 0.3 - crack * 0.4 + lichen * 0.05];
    });
    T.rock = tex(c); T.rockN = normalFrom(hgt, S, S, 5);
  }
  // ---- bark: deep vertical furrows, plates of reddish brown and grey
  {
    const W = S / 2, H = S;
    const { c, hgt } = paint(W, H, (u, v) => {
      const warp = tfbm(u * 4, v * 2, 4, 3, 31) * 0.6;
      const f = Math.abs(Math.sin((u * 9 + warp) * Math.PI));
      const plates = tfbm(u * 6, v * 14, 6, 4, 32);
      const ridge = Math.pow(f, 0.35) * smooth(0.25, 0.6, plates + 0.2);
      const m = tfbm(u * 30, v * 30, 30, 2, 33);
      let r = 0.10 + 0.25 * ridge + 0.05 * m, g = 0.08 + 0.16 * ridge + 0.04 * m, b = 0.06 + 0.11 * ridge + 0.03 * m;
      const grey = smooth(0.5, 0.8, tfbm(u * 3, v * 5, 3, 3, 34)) * ridge;
      r += grey * 0.08; g += grey * 0.1; b += grey * 0.1;
      return [r, g, b, ridge + m * 0.2];
    });
    T.bark = tex(c); T.barkN = normalFrom(hgt, W, H, 6);
  }
  // ---- pine branch spray: a stem with needles both sides, drawn several times on one card
  {
    const W = S, H = S, c = canvas(W, H), g = c.getContext('2d'), rnd = mulberry(5);
    g.clearRect(0, 0, W, H); g.lineCap = 'round';
    const sprig = (x0, y0, ang, len, wid) => {
      const steps = 34;
      for (let i = 0; i < steps; i++){
        const t = i / steps, x = x0 + Math.cos(ang) * len * t, y = y0 + Math.sin(ang) * len * t;
        const nl = len * 0.16 * (1 - t * 0.55);
        for (const side of [-1, 1]){
          const a = ang + side * (0.9 + rnd() * 0.35) - 0.25 * side * t;
          const sh = 0.45 + rnd() * 0.55;
          g.strokeStyle = `rgb(${18 + sh * 35 | 0},${40 + sh * 55 | 0},${16 + sh * 22 | 0})`;
          g.lineWidth = wid;
          g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * nl, y + Math.sin(a) * nl); g.stroke();
        }
      }
      g.strokeStyle = 'rgb(60,40,24)'; g.lineWidth = wid * 1.6;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len); g.stroke();
    };
    // the main branch runs from the left edge (the trunk) to the right; side sprigs fan off it
    const w = W / 512;
    g.fillStyle = 'rgb(18,34,14)';
    g.beginPath(); g.ellipse(W * 0.45, H * 0.5, W * 0.42, H * 0.2, 0, 0, Math.PI * 2); g.fill();
    for (let k = 0; k < 7; k++){
      const t = 0.08 + k * 0.13, x = W * t, y = H * 0.5;
      sprig(x, y, -0.6 - rnd() * 0.5, W * (0.32 - t * 0.12), 2.4 * w);
      sprig(x, y, 0.6 + rnd() * 0.5, W * (0.32 - t * 0.12), 2.4 * w);
    }
    sprig(0, H * 0.5, 0, W * 0.98, 2.8 * w);
    T.needles = tex(c, true, false);
  }
  // ---- needle mat: short needles all over, for the cone-shaped tiers of the pines (tiles sideways)
  {
    const W = S, H = S, c = canvas(W, H), g = c.getContext('2d'), rnd = mulberry(17);
    g.lineCap = 'round';
    // a solid dark-green body that ends in a wavy edge, with needles drawn over it
    g.fillStyle = 'rgb(16,30,13)'; g.beginPath(); g.moveTo(0, 0);
    for (let x = 0; x <= W; x += W / 32) g.lineTo(x, H * (0.58 + 0.08 * Math.sin(x / W * Math.PI * 12) + rnd() * 0.06));
    g.lineTo(W, 0); g.closePath(); g.fill();
    for (let i = 0; i < W * 9; i++){
      const x = rnd() * W, y = rnd() * H, a = Math.PI * 0.5 + (rnd() - 0.5) * 1.6, l = H * (0.03 + rnd() * 0.035);
      // fewer needles toward the outer (lower) edge so the tier ends in a ragged fringe
      if (y > H * (0.72 + rnd() * 0.28)) continue;
      const sh = 0.35 + rnd() * 0.65;
      g.strokeStyle = `rgb(${14 + sh * 30 | 0},${30 + sh * 52 | 0},${12 + sh * 20 | 0})`;
      g.lineWidth = W / 512 * (1.2 + rnd());
      for (const ox of [0, -W, W]){ g.beginPath(); g.moveTo(x + ox, y); g.lineTo(x + ox + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
    }
    T.needleMat = tex(c, true, false); T.needleMat.wrapS = THREE.RepeatWrapping;
  }
  // ---- fern frond card
  {
    const W = S / 2, H = S, c = canvas(W, H), g = c.getContext('2d'), rnd = mulberry(9);
    g.lineCap = 'round';
    const x0 = W / 2;
    for (let i = 0; i < 40; i++){
      const t = i / 40, y = H * (0.98 - t * 0.95), len = W * 0.45 * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.08));
      for (const side of [-1, 1]){
        const sh = 0.6 + rnd() * 0.4;
        g.fillStyle = `rgb(${40 * sh | 0},${95 * sh | 0},${28 * sh | 0})`;
        g.beginPath();
        g.moveTo(x0, y);
        g.quadraticCurveTo(x0 + side * len * 0.5, y - H * 0.03, x0 + side * len, y - H * 0.012);
        g.quadraticCurveTo(x0 + side * len * 0.5, y + H * 0.005, x0, y + H * 0.008);
        g.fill();
      }
    }
    g.strokeStyle = 'rgb(50,70,25)'; g.lineWidth = 3 * W / 256;
    g.beginPath(); g.moveTo(x0, H); g.lineTo(x0, H * 0.03); g.stroke();
    T.fern = tex(c, true, false);
  }
  // ---- birch bark: white with black dashes
  {
    const W = S / 2, H = S;
    const { c, hgt } = paint(W, H, (u, v) => {
      const n = tfbm(u * 4, v * 8, 4, 4, 41);
      const dash = smooth(0.62, 0.7, tfbm(u * 3, v * 40, 3, 3, 42)) * smooth(0.4, 0.6, tnoise(u * 6, v * 6, 6, 43));
      const k = 0.78 + 0.12 * n;
      return [k * (1 - dash * 0.85), k * (1 - dash * 0.85) * 0.98, k * (1 - dash * 0.85) * 0.93, n - dash];
    });
    T.birch = tex(c); T.birchN = normalFrom(hgt, W, H, 3);
  }
  // ---- birch leaf cluster card
  {
    const W = S, H = S, c = canvas(W, H), g = c.getContext('2d'), rnd = mulberry(13);
    g.fillStyle = 'rgb(40,66,22)'; g.beginPath(); g.ellipse(W / 2, H / 2, W * 0.3, H * 0.27, 0, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 420; i++){
      const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * W * 0.44;
      const x = W / 2 + Math.cos(a) * rr, y = H / 2 + Math.sin(a) * rr * 0.9, s = W * (0.018 + rnd() * 0.014);
      const sh = 0.55 + rnd() * 0.45, yel = rnd() < 0.18;
      g.fillStyle = yel ? `rgb(${170 * sh | 0},${150 * sh | 0},${40 * sh | 0})` : `rgb(${70 * sh | 0},${120 * sh | 0},${35 * sh | 0})`;
      g.save(); g.translate(x, y); g.rotate(rnd() * Math.PI * 2);
      g.beginPath(); g.ellipse(0, 0, s, s * 0.62, 0, 0, Math.PI * 2); g.fill(); g.restore();
    }
    T.leaves = tex(c, true, false);
  }
  // ---- small ripples for the lake
  {
    const { hgt } = paint(S / 2, S / 2, (u, v) => {
      const h = tfbm(u * 6, v * 6, 6, 5, 51) + 0.4 * tfbm(u * 16, v * 16, 16, 3, 52);
      return [0, 0, 0, h];
    });
    T.waterN = normalFrom(hgt, S / 2, S / 2, 10);
  }
  return T;
}
