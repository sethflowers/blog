// Materials: every texture is painted at start-up on a canvas (no image files), seamless, 512 px,
// with a normal map worked out from a matching height painting. mat(name) caches one material per
// name; textures are set per world metre (merged geometry has UVs in metres, see util.mergeParts).
import * as THREE from 'three';
import { fbm, vnoise, hash2, rng, clamp } from './util.js';

const S = 512;
let renderer = null;
export function setRenderer(r){ renderer = r; }

// --- painting helpers --------------------------------------------------------------------------
function canvas(){ const c = document.createElement('canvas'); c.width = c.height = S; c.getContext('2d', { willReadFrequently: true }); return c; }
// draw something nine times (offset by ±S) so shapes crossing an edge wrap round: seamless tiles
function wrap(fn){ for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) fn(dx, dy); }
const rgb = (r, g, b) => `rgb(${r | 0},${g | 0},${b | 0})`;
const grey = (v) => rgb(v, v, v);

// per-pixel pass over both canvases: fn(x, y, col[r,g,b], h) may change them
function perPixel(cc, hc, fn, keepAlpha = false){
  const cx = cc.getContext('2d'), hx = hc.getContext('2d');
  const ci = cx.getImageData(0, 0, S, S), hi = hx.getImageData(0, 0, S, S);
  const cd = ci.data, hd = hi.data, col = [0, 0, 0], ho = [0];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++){
    const i = (y * S + x) * 4;
    col[0] = cd[i]; col[1] = cd[i + 1]; col[2] = cd[i + 2]; ho[0] = hd[i];
    fn(x, y, col, ho, cd[i + 3]);
    cd[i] = col[0]; cd[i + 1] = col[1]; cd[i + 2] = col[2]; if (!keepAlpha) cd[i + 3] = 255; hd[i] = hd[i + 1] = hd[i + 2] = ho[0]; hd[i + 3] = 255;
  }
  cx.putImageData(ci, 0, 0); hx.putImageData(hi, 0, 0);
}
// nearest and second-nearest jittered points (wrapping), for cobbles and crazy paving
function voronoi(cells, seed){
  const pts = [];
  const r = rng(seed);
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) pts.push([(i + 0.15 + 0.7 * r()) / cells * S, (j + 0.15 + 0.7 * r()) / cells * S, r()]);
  return (x, y) => {
    const ci = Math.floor(x / S * cells), cj = Math.floor(y / S * cells);
    let d1 = 1e9, d2 = 1e9, id = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++){
      let ii = ci + di, jj = cj + dj, ox = 0, oy = 0;
      if (ii < 0){ ii += cells; ox = -S; } else if (ii >= cells){ ii -= cells; ox = S; }
      if (jj < 0){ jj += cells; oy = -S; } else if (jj >= cells){ jj -= cells; oy = S; }
      const p = pts[jj * cells + ii];
      const d = Math.hypot(p[0] + ox - x, p[1] + oy - y);
      if (d < d1){ d2 = d1; d1 = d; id = p[2]; } else if (d < d2) d2 = d;
    }
    return [d1, d2, id];
  };
}

// normal map from the height canvas (strength: how deep the bumps are)
function normalMap(hc, strength){
  const hd = hc.getContext('2d').getImageData(0, 0, S, S).data;
  const out = canvas(), ox = out.getContext('2d'), img = ox.createImageData(S, S), d = img.data;
  const H = (x, y) => hd[(((y + S) % S) * S + ((x + S) % S)) * 4] / 255;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++){
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1), i = (y * S + x) * 4;
    d[i] = (-dx / l * 0.5 + 0.5) * 255; d[i + 1] = (dy / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  ox.putImageData(img, 0, 0);
  return out;
}

function tex(c, srgb = true){
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 4;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// --- the paintings -----------------------------------------------------------------------------
// each returns [colourCanvas, heightCanvas]
const P = {};

P.grass = (seed = 1) => {
  const c = canvas(), h = canvas(), cx = c.getContext('2d'), hx = h.getContext('2d');
  perPixel(c, h, (x, y, col, ho) => {
    const n = fbm(x / 64, y / 64, 4, seed, 8), m = fbm(x / 16, y / 16, 3, seed + 5, 32);
    col[0] = 74 + 44 * n + 12 * m; col[1] = 94 + 40 * n + 14 * m; col[2] = 48 + 18 * n; ho[0] = 90 + 60 * m;
  });
  const r = rng(seed * 7 + 3);
  for (let i = 0; i < 9000; i++){
    const x = r() * S, y = r() * S, a = -Math.PI / 2 + (r() - 0.5) * 1.6, l = 4 + r() * 9, t = r();
    const col = t < 0.1 ? rgb(160 + r() * 40, 150 + r() * 30, 90) : rgb(52 + 70 * t, 82 + 70 * t, 34 + 30 * t);
    wrap((dx, dy) => {
      cx.strokeStyle = col; cx.lineWidth = 1 + r() * 0.8; cx.beginPath(); cx.moveTo(x + dx, y + dy); cx.lineTo(x + dx + Math.cos(a) * l, y + dy + Math.sin(a) * l); cx.stroke();
      hx.strokeStyle = grey(150 + 100 * t); hx.lineWidth = 1.4; hx.beginPath(); hx.moveTo(x + dx, y + dy); hx.lineTo(x + dx + Math.cos(a) * l, y + dy + Math.sin(a) * l); hx.stroke();
    });
  }
  return [c, h];
};
P.dirt = () => {
  const c = canvas(), h = canvas(), cx = c.getContext('2d'), hx = h.getContext('2d');
  perPixel(c, h, (x, y, col, ho) => {
    const n = fbm(x / 48, y / 48, 5, 31, 10.6667), g = hash2(x, y, 3);
    col[0] = 104 + 50 * n + 16 * g; col[1] = 80 + 38 * n + 12 * g; col[2] = 56 + 24 * n + 8 * g; ho[0] = 100 + 90 * n + 30 * g;
  });
  const r = rng(77);
  for (let i = 0; i < 900; i++){
    const x = r() * S, y = r() * S, s = 1.5 + r() * 4, v = 110 + r() * 70;
    wrap((dx, dy) => { cx.fillStyle = rgb(v, v * 0.9, v * 0.78); cx.beginPath(); cx.ellipse(x + dx, y + dy, s, s * 0.75, r() * 3, 0, 7); cx.fill();
      hx.fillStyle = grey(220); hx.beginPath(); hx.ellipse(x + dx, y + dy, s, s * 0.75, 0, 0, 7); hx.fill(); });
  }
  return [c, h];
};
P.rock = () => {
  const c = canvas(), h = canvas();
  perPixel(c, h, (x, y, col, ho) => {
    const n = fbm(x / 128, y / 64, 5, 41, [4, 8]), m = fbm(x / 32, y / 32, 3, 42, 16);
    const crack = Math.abs(vnoise(x / 32, y / 64, 43, [16, 8]) - 0.5) < 0.02 ? -40 : 0;
    const v = 108 + 70 * n + 24 * m + crack;
    col[0] = v * 1.02; col[1] = v * 0.98; col[2] = v * 0.92; ho[0] = clamp(60 + 150 * n + 40 * m + crack * 2, 0, 255);
  });
  return [c, h];
};
P.sand = () => {
  const c = canvas(), h = canvas();
  perPixel(c, h, (x, y, col, ho) => {
    const g = hash2(x, y, 9), rip = Math.sin((y + 18 * fbm(x / 64, y / 64, 3, 51, 8)) / S * Math.PI * 2 * 24);
    col[0] = 196 + 18 * g + 6 * rip; col[1] = 176 + 16 * g + 6 * rip; col[2] = 134 + 14 * g + 4 * rip; ho[0] = 128 + 40 * rip + 30 * g;
  });
  return [c, h];
};
// basket-weave brick pavers in warm reds (2 m tile: 16 x 8 bricks of 0.25 x 0.125 m)
P.pavers = () => {
  const c = canvas(), h = canvas(), cx = c.getContext('2d'), hx = h.getContext('2d'), r = rng(5);
  cx.fillStyle = rgb(150, 136, 112); cx.fillRect(0, 0, S, S); hx.fillStyle = grey(40); hx.fillRect(0, 0, S, S);
  const u = S / 16;
  for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++){
    const horiz = (i + j) % 2 === 0;
    for (let k = 0; k < 2; k++){
      const x = horiz ? i * 2 * u : i * 2 * u + k * u, y = horiz ? j * 2 * u + k * u : j * 2 * u;
      const w = horiz ? 2 * u : u, hh = horiz ? u : 2 * u, t = r();
      cx.fillStyle = rgb(140 + 50 * t, 66 + 26 * t, 50 + 16 * t);
      cx.beginPath(); cx.roundRect(x + 1.5, y + 1.5, w - 3, hh - 3, 3); cx.fill();
      hx.fillStyle = grey(200 + 40 * r()); hx.beginPath(); hx.roundRect(x + 2, y + 2, w - 4, hh - 4, 4); hx.fill();
    }
  }
  grain(c, h, 22, 18);
  return [c, h];
};
P.cobbles = () => {
  const c = canvas(), h = canvas(), vo = voronoi(20, 61);
  perPixel(c, h, (x, y, col, ho) => {
    const [d1, d2, id] = vo(x, y), e = d2 - d1, edge = clamp(e / 7), dome = clamp(1 - d1 / 16);
    const v = (96 + 60 * id) * (0.45 + 0.55 * edge) + 10 * hash2(x, y, 4);
    col[0] = v * 1.02; col[1] = v * 0.97; col[2] = v * 0.9; ho[0] = 40 + 200 * edge * (0.6 + 0.4 * dome);
  });
  return [c, h];
};
// sandstone flags in staggered courses of different lengths
P.flagstone = () => {
  const c = canvas(), h = canvas(), cx = c.getContext('2d'), hx = h.getContext('2d'), r = rng(8);
  cx.fillStyle = rgb(120, 112, 100); cx.fillRect(0, 0, S, S); hx.fillStyle = grey(30); hx.fillRect(0, 0, S, S);
  const rows = 5, rh = S / rows;
  for (let j = 0; j < rows; j++){
    let x = r() * S; const end = x + S;
    while (x < end){
      const w = Math.min(end - x, rh * (0.9 + r() * 1.3)), t = r();
      wrap((dx, dy) => {
        cx.fillStyle = rgb(186 + 30 * t, 170 + 28 * t, 140 + 24 * t); cx.fillRect(x + dx + 2, j * rh + dy + 2, w - 4, rh - 4);
        hx.fillStyle = grey(200 + 30 * t); hx.fillRect(x + dx + 2, j * rh + dy + 2, w - 4, rh - 4);
      });
      x += w;
    }
  }
  grain(c, h, 26, 30, 4);
  return [c, h];
};
P.crazy = () => {
  const c = canvas(), h = canvas(), vo = voronoi(7, 71);
  perPixel(c, h, (x, y, col, ho) => {
    const [d1, d2, id] = vo(x, y), edge = (d2 - d1) > 5 ? 1 : 0, t = id, g = hash2(x, y, 5);
    const v = edge ? 1 : 0.4;
    col[0] = (170 + 50 * t + 10 * g) * v; col[1] = (150 + 40 * t + 10 * g) * v; col[2] = (128 + 34 * t + 10 * g) * v; ho[0] = edge ? 200 + 30 * g : 40;
  });
  return [c, h];
};
P.tarmac = () => {
  const c = canvas(), h = canvas();
  perPixel(c, h, (x, y, col, ho) => {
    const g = hash2(x, y, 11), n = fbm(x / 80, y / 80, 3, 12, 6.4), s = g > 0.93 ? 40 : 0;
    const v = 58 + 18 * n + 22 * g + s; col[0] = v; col[1] = v; col[2] = v * 1.04; ho[0] = 100 + 120 * g;
  });
  return [c, h];
};
// planks along U, 0.15 m wide on a 2 m tile
P.boards = () => {
  const c = canvas(), h = canvas(), r = rng(13), n = 13, tint = [];
  for (let i = 0; i < n; i++) tint.push([r(), r() * S]);
  perPixel(c, h, (x, y, col, ho) => {
    const pw = S / n, k = Math.floor(y / pw), f = y / pw - k, [t, off] = tint[k];
    const gap = f < 0.06 || f > 0.94, endJoint = ((x + off) % (S / 2)) < 3;
    const grainv = 0.5 + 0.5 * Math.sin(x / S * Math.PI * 146 + 6 * fbm(x / 64, y / 8, 3, 14 + k, [8, 64]));
    const v = gap || endJoint ? 0.35 : 0.8 + 0.2 * grainv;
    col[0] = (132 + 40 * t) * v; col[1] = (100 + 30 * t) * v; col[2] = (70 + 20 * t) * v; ho[0] = gap || endJoint ? 20 : 170 + 60 * grainv;
  });
  return [c, h];
};
P.gravel = () => {
  const c = canvas(), h = canvas(), vo = voronoi(48, 91);
  perPixel(c, h, (x, y, col, ho) => {
    const [d1, d2, id] = vo(x, y), edge = clamp((d2 - d1) / 3);
    const v = (150 + 70 * id) * (0.5 + 0.5 * edge);
    col[0] = v; col[1] = v * 0.95; col[2] = v * 0.86; ho[0] = 60 + 190 * edge;
  });
  return [c, h];
};
P.concrete = () => {
  const c = canvas(), h = canvas();
  perPixel(c, h, (x, y, col, ho) => {
    const g = hash2(x, y, 15), n = fbm(x / 50, y / 50, 4, 16, 10.24);
    const v = 168 + 26 * n + 14 * g; col[0] = v; col[1] = v * 0.99; col[2] = v * 0.95; ho[0] = 120 + 60 * g;
  });
  return [c, h];
};
// dressed limestone in courses (2 m tile: 6 courses of 0.33 m)
P.ashlar = () => {
  const c = canvas(), h = canvas(), cx = c.getContext('2d'), hx = h.getContext('2d'), r = rng(17);
  cx.fillStyle = rgb(150, 140, 122); cx.fillRect(0, 0, S, S); hx.fillStyle = grey(50); hx.fillRect(0, 0, S, S);
  const rows = 6, rh = S / rows;
  for (let j = 0; j < rows; j++){
    let x = (j % 2) * rh * 0.8 + r() * 20; const end = x + S;
    while (x < end){
      const w = Math.min(end - x, rh * (1.3 + r() * 1.2)), t = r();
      wrap((dx, dy) => {
        cx.fillStyle = rgb(206 + 22 * t, 194 + 20 * t, 168 + 18 * t); cx.fillRect(x + dx + 2, j * rh + dy + 2, w - 4, rh - 4);
        hx.fillStyle = grey(210); hx.fillRect(x + dx + 2, j * rh + dy + 2, w - 4, rh - 4);
      });
      x += w;
    }
  }
  grain(c, h, 18, 22, 3);
  return [c, h];
};
P.brick = () => {
  const c = canvas(), h = canvas(), cx = c.getContext('2d'), hx = h.getContext('2d'), r = rng(19);
  cx.fillStyle = rgb(176, 166, 150); cx.fillRect(0, 0, S, S); hx.fillStyle = grey(50); hx.fillRect(0, 0, S, S);
  const rows = 26, rh = S / rows, bw = S / 9;
  for (let j = 0; j < rows; j++) for (let i = -1; i < 10; i++){
    const x = i * bw + (j % 2) * bw / 2, t = r();
    cx.fillStyle = rgb(150 + 46 * t, 70 + 26 * t, 52 + 16 * t); cx.fillRect(x + 1.5, j * rh + 1.5, bw - 3, rh - 3);
    hx.fillStyle = grey(210); hx.fillRect(x + 1.5, j * rh + 1.5, bw - 3, rh - 3);
  }
  grain(c, h, 20, 16);
  return [c, h];
};
P.slate = () => {
  const c = canvas(), h = canvas(), r = rng(23), rows = 16, cols = 10, t = [];
  for (let i = 0; i < rows * cols; i++) t.push(r());
  perPixel(c, h, (x, y, col, ho) => {
    const rh = S / rows, j = Math.floor(y / rh), f = y / rh - j, off = (j % 2) * 0.5;
    const ci = Math.floor((x / S * cols + off) % cols), fx = (x / S * cols + off) % 1;
    const tt = t[j * cols + ci], edge = fx < 0.04 || f > 0.92;
    const v = (70 + 26 * tt) * (edge ? 0.55 : 1) + 8 * hash2(x, y, 6);
    col[0] = v * 0.92; col[1] = v * 0.96; col[2] = v * 1.08; ho[0] = edge ? 30 : 80 + 160 * f;
  });
  return [c, h];
};
P.wood = () => {
  const c = canvas(), h = canvas();
  perPixel(c, h, (x, y, col, ho) => {
    const g = 0.5 + 0.5 * Math.sin(y / S * Math.PI * 340 + 10 * fbm(x / 128, y / 16, 3, 25, [4, 32]));
    const v = 0.78 + 0.22 * g;
    col[0] = 150 * v; col[1] = 112 * v; col[2] = 76 * v; ho[0] = 100 + 120 * g;
  });
  return [c, h];
};
P.bark = () => {
  const c = canvas(), h = canvas();
  perPixel(c, h, (x, y, col, ho) => {
    const ridge = Math.abs(Math.sin(x / S * Math.PI * 14 + 3 * fbm(x / 32, y / 128, 3, 27, [16, 4])));
    const v = 46 + 50 * ridge + 12 * hash2(x, y, 7);
    col[0] = v * 1.1; col[1] = v * 0.95; col[2] = v * 0.8; ho[0] = 40 + 200 * ridge;
  });
  return [c, h];
};
P.plaster = () => {
  const c = canvas(), h = canvas();
  perPixel(c, h, (x, y, col, ho) => {
    const n = fbm(x / 40, y / 40, 4, 29, 12.8), g = hash2(x, y, 8);
    const v = 222 + 18 * n + 8 * g; col[0] = v; col[1] = v * 0.97; col[2] = v * 0.91; ho[0] = 110 + 70 * n + 30 * g;
  });
  return [c, h];
};
// leaves for tree crowns: many small leaves on a transparent card, light enough to tint per species
P.leaves = () => {
  const c = canvas(), cx = c.getContext('2d'), r = rng(31);
  for (let i = 0; i < 1400; i++){
    const x = S / 2 + (r() - 0.5) * S * 0.94 * Math.sqrt(r()) * 1.1, y = S / 2 + (r() - 0.5) * S * 0.94 * Math.sqrt(r()) * 1.1;
    if (Math.hypot(x - S / 2, y - S / 2) > S * 0.47) continue;
    const t = r(), a = r() * Math.PI * 2;
    cx.fillStyle = rgb(150 + 90 * t, 175 + 70 * t, 120 + 60 * t);
    cx.save(); cx.translate(x, y); cx.rotate(a); cx.beginPath(); cx.ellipse(0, 0, 9 + 6 * r(), 4 + 2 * r(), 0, 0, 7); cx.fill();
    cx.strokeStyle = 'rgba(60,80,40,.5)'; cx.lineWidth = 1; cx.beginPath(); cx.moveTo(-8, 0); cx.lineTo(8, 0); cx.stroke(); cx.restore();
  }
  return [c, null];
};
P.hedge = () => {
  const c = canvas(), h = canvas(), cx = c.getContext('2d'), hx = h.getContext('2d'), r = rng(41);
  cx.fillStyle = rgb(28, 48, 22); cx.fillRect(0, 0, S, S); hx.fillStyle = grey(30); hx.fillRect(0, 0, S, S);
  for (let i = 0; i < 6000; i++){
    const x = r() * S, y = r() * S, t = r(), a = r() * 6.28, l = 5 + 4 * r();
    wrap((dx, dy) => {
      cx.save(); cx.translate(x + dx, y + dy); cx.rotate(a); cx.fillStyle = rgb(40 + 60 * t, 70 + 70 * t, 28 + 30 * t); cx.beginPath(); cx.ellipse(0, 0, l, l * 0.45, 0, 0, 7); cx.fill(); cx.restore();
      hx.fillStyle = grey(90 + 160 * t); hx.beginPath(); hx.ellipse(x + dx, y + dy, l * 0.8, l * 0.4, a, 0, 7); hx.fill();
    });
  }
  return [c, h];
};
// clay roof tiles: rows of rounded pantiles (2 m tile: 10 rows, 8 across), rows along U, downhill along V
P.tiles = () => {
  const c = canvas(), h = canvas(), r = rng(47), rows = 10, cols = 8, t = [];
  for (let i = 0; i < rows * cols; i++) t.push(r());
  perPixel(c, h, (x, y, col, ho) => {
    const rh = S / rows, j = Math.floor(y / rh), f = y / rh - j, cw = S / cols, ci = Math.floor((x + (j % 2) * cw / 2) / cw) % cols, fx = ((x + (j % 2) * cw / 2) % cw) / cw;
    const round = Math.sin(fx * Math.PI), shade = 0.55 + 0.45 * round * (0.6 + 0.4 * f), tt = t[j * cols + ci];
    const v = shade * (f > 0.9 ? 0.6 : 1);
    col[0] = (158 + 50 * tt) * v; col[1] = (78 + 26 * tt) * v; col[2] = (52 + 14 * tt) * v; ho[0] = 40 + 200 * round * (0.4 + 0.6 * f);
  });
  grain(c, h, 14, 10, 3);
  return [c, h];
};
// wooden shingles: staggered rows of narrow boards
P.shingles = () => {
  const c = canvas(), h = canvas(), r = rng(53), rows = 14, cols = 12, t = [];
  for (let i = 0; i < rows * cols; i++) t.push(r());
  perPixel(c, h, (x, y, col, ho) => {
    const rh = S / rows, j = Math.floor(y / rh), f = y / rh - j, cw = S / cols, xx = x + (j % 2) * cw / 2, ci = Math.floor(xx / cw) % cols, fx = (xx % cw) / cw;
    const tt = t[j * cols + ci], edge = fx < 0.06 || f > 0.92, g = 0.85 + 0.15 * Math.sin(xx * 0.9 + tt * 9);
    const v = (edge ? 0.45 : 1) * g * (0.75 + 0.25 * f);
    col[0] = (120 + 40 * tt) * v; col[1] = (92 + 30 * tt) * v; col[2] = (66 + 20 * tt) * v; ho[0] = edge ? 30 : 80 + 160 * f;
  });
  return [c, h];
};
P.needles = () => {
  const c = canvas(), cx = c.getContext('2d'), r = rng(37);
  for (let i = 0; i < 2600; i++){
    const x = r() * S, y = r() * S;
    if (Math.hypot(x - S / 2, y - S / 2) > S * 0.47) continue;
    const t = r(), a = r() * Math.PI * 2, l = 8 + 8 * r();
    cx.strokeStyle = rgb(120 + 100 * t, 160 + 80 * t, 120 + 60 * t); cx.lineWidth = 2;
    cx.beginPath(); cx.moveTo(x, y); cx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); cx.stroke();
  }
  return [c, null];
};
P.water = () => {
  const c = canvas(), h = canvas();
  perPixel(c, h, (x, y, col, ho) => {
    const n = fbm(x / 40, y / 40, 5, 33, 12.8);
    col[0] = col[1] = col[2] = 128; ho[0] = 255 * n;
  });
  return [c, h];
};

// fine grain on top of a painting (colour and height)
function grain(c, h, cAmt, hAmt, blotch = 0){
  perPixel(c, h, (x, y, col, ho) => {
    const g = hash2(x, y, 99) - 0.5, b = blotch ? (fbm(x / 30, y / 30, 3, 98, 17.0667) - 0.5) * blotch * 10 : 0;
    col[0] += g * cAmt + b; col[1] += g * cAmt + b; col[2] += g * cAmt + b; ho[0] = clamp(ho[0] + g * hAmt, 0, 255);
  });
}

// --- the cache ---------------------------------------------------------------------------------
const texCache = new Map();
export function texture(name){
  let t = texCache.get(name);
  if (!t){
    const [c, h] = P[name]();
    t = { map: tex(c), normal: h ? tex(normalMap(h, NORMAL[name] || 3), false) : null };
    texCache.set(name, t);
  }
  return t;
}
const NORMAL = { grass: 2.5, dirt: 3, rock: 5, sand: 2, pavers: 4, cobbles: 6, flagstone: 3, crazy: 4, tarmac: 1.5, boards: 4, gravel: 5, concrete: 1.5, ashlar: 4, brick: 4, slate: 4, wood: 2, bark: 6, plaster: 1.5, water: 2, hedge: 5, tiles: 4, shingles: 4 };

// material definitions: painting, metres per tile, roughness, metalness, tint
const DEF = {
  pavers: { t: 'pavers', m: 2, r: 0.85 }, cobbles: { t: 'cobbles', m: 2, r: 0.8 }, flagstone: { t: 'flagstone', m: 3, r: 0.85 },
  crazy: { t: 'crazy', m: 3, r: 0.85 }, tarmac: { t: 'tarmac', m: 3, r: 0.95 }, boards: { t: 'boards', m: 2, r: 0.8 },
  gravel: { t: 'gravel', m: 1.5, r: 0.95 }, concrete: { t: 'concrete', m: 3, r: 0.9 }, kerb: { t: 'concrete', m: 2, r: 0.85, c: 0xd8d4cc },
  ashlar: { t: 'ashlar', m: 2, r: 0.85 }, brick: { t: 'brick', m: 2, r: 0.9 }, slate: { t: 'slate', m: 2, r: 0.7 },
  wood: { t: 'wood', m: 1.5, r: 0.75 }, darkwood: { t: 'wood', m: 1.5, r: 0.7, c: 0x6a5040 }, plaster: { t: 'plaster', m: 3, r: 0.95 },
  bark: { t: 'bark', m: 1, r: 0.95 }, birchbark: { t: 'plaster', m: 1, r: 0.8, c: 0xe8e2d6 }, hedge: { t: 'hedge', m: 1.5, r: 0.9 },
  soil: { t: 'dirt', m: 1.5, r: 1, c: 0x7a6050 }, rockface: { t: 'rock', m: 6, r: 0.9 },
  iron: { c: 0x22252a, r: 0.45, mt: 0.7 }, gold: { c: 0xc8a040, r: 0.3, mt: 1 }, brass: { c: 0xb08a48, r: 0.35, mt: 1 },
  copper: { c: 0x5fa08a, r: 0.6, mt: 0.3 }, white: { c: 0xf2efe8, r: 0.6 }, paint: { c: 0xffffff, r: 0.55, vc: true },
  canvas: { c: 0xffffff, r: 0.85, vc: true, side: THREE.DoubleSide }, glass: { c: 0x203038, r: 0.08, mt: 0.2 },
  stone: { t: 'ashlar', m: 2, r: 0.85, c: 0xc8c0b0 }, marble: { c: 0xe8e4dc, r: 0.3 },
  tyre: { c: 0x18181a, r: 0.9 }, chrome: { c: 0xd0d4d8, r: 0.2, mt: 1 },
  tiles: { t: 'tiles', m: 2, r: 0.75 }, shingles: { t: 'shingles', m: 2, r: 0.85 }, boardwall: { t: 'boards', m: 2, r: 0.8, c: 0xb89a80 },
  floortile: { t: 'flagstone', m: 2, r: 0.5, c: 0xe8e0d0 },
  line: { c: 0xf0eee6, r: 0.8 }, yellowline: { c: 0xe0b030, r: 0.8 },
};
const matCache = new Map();
// mat(name): one shared material per name (materials made by mat are never disposed)
export function mat(name, opts){
  const key = opts ? name + JSON.stringify(opts) : name;
  let m = matCache.get(key);
  if (m) return m;
  const d = { ...(DEF[name] || { c: 0xff00ff }), ...(opts || {}) };
  m = new THREE.MeshStandardMaterial({ color: d.c ?? 0xffffff, roughness: d.r ?? 0.8, metalness: d.mt ?? 0, vertexColors: !!d.vc, side: d.side ?? THREE.FrontSide });
  if (d.t){
    const T = texture(d.t);
    m.map = T.map.clone(); m.map.repeat.set(1 / d.m, 1 / d.m); m.map.needsUpdate = true;
    if (T.normal){ m.normalMap = T.normal.clone(); m.normalMap.repeat.set(1 / d.m, 1 / d.m); m.normalMap.needsUpdate = true; m.normalScale.set(0.9, 0.9); }
  }
  if (d.e){ m.emissive.set(d.e); m.emissiveIntensity = d.ei ?? 1; }
  m.name = name;
  matCache.set(key, m);
  return m;
}
// warm glowing bulbs: their brightness follows the night (set by sky.js)
export const glow = new THREE.MeshStandardMaterial({ color: 0x302a20, emissive: 0xffd8a0, emissiveIntensity: 0, roughness: 0.4 });
glow.name = 'glow';
// window glass: dark by day, a warm lamplit glow after dark (sky.js sets how bright)
export const winGlow = new THREE.MeshStandardMaterial({ color: 0x2a3a42, emissive: 0xffc070, emissiveIntensity: 0, roughness: 0.06, metalness: 0.3, transparent: true, opacity: 0.55, depthWrite: false });
winGlow.name = 'winglass';
// lantern panes: clear warm glass that glows after dark (sky.js sets how bright)
export const lampGlass = new THREE.MeshStandardMaterial({ color: 0xfff0d0, emissive: 0xffc878, emissiveIntensity: 0, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.6, depthWrite: false });
lampGlass.name = 'lampglass';
matCache.set('glow', glow); matCache.set('winglass', winGlow); matCache.set('lampglass', lampGlass);

// a soft round spot, for lamp light on the ground and bulb halos
let spotTex = null;
export function spotTexture(){
  if (spotTex) return spotTex;
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  spotTex = new THREE.CanvasTexture(c); spotTex.colorSpace = THREE.SRGBColorSpace;
  return spotTex;
}
