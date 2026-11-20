// The photo editor's engine: a description of every edit (crop, straighten, filter, adjustments,
// drawing, stickers, words) and one function that draws the picture from it. No DOM here: the HTML
// editor (editor-ui.js) and the VR editor panel both drive the same state, so every tool works on both.
//
// state = { rot, flip, aspect, zoom, cx, cy, angle, filter, strength, adj: {...}, strokes, stickers, text, frame, border }
// The source picture never changes; render() rebuilds the result from it each time (fast enough at
// preview size, ~700 px), and bake() draws it full size when you're done.

export const ADJUST = [
  { id: 'bright', name: 'Brightness', icon: '☀️', min: -100, max: 100 },
  { id: 'contrast', name: 'Contrast', icon: '🌗', min: -100, max: 100 },
  { id: 'sat', name: 'Saturation', icon: '🎨', min: -100, max: 100 },
  { id: 'warmth', name: 'Warmth', icon: '🌡', min: -100, max: 100 },
  { id: 'tint', name: 'Tint', icon: '💜', min: -100, max: 100 },
  { id: 'highlights', name: 'Highlights', icon: '🔆', min: -100, max: 100 },
  { id: 'shadows', name: 'Shadows', icon: '🌑', min: -100, max: 100 },
  { id: 'fade', name: 'Fade', icon: '🌫', min: 0, max: 100 },
  { id: 'vignette', name: 'Vignette', icon: '⭕', min: 0, max: 100 },
  { id: 'grain', name: 'Grain', icon: '🎞', min: 0, max: 100 },
  { id: 'sharpen', name: 'Sharpen', icon: '🔪', min: 0, max: 100 },
  { id: 'blur', name: 'Soften', icon: '💧', min: 0, max: 100 },
];

// filters: a set of adjustments plus (sometimes) a special look; Strength fades them in and out
export const FILTERS = [
  { id: 'none', name: 'Original' },
  { id: 'vivid', name: 'Vivid', adj: { sat: 40, contrast: 18, bright: 4 } },
  { id: 'sunny', name: 'Golden', adj: { warmth: 45, bright: 8, fade: 10, sat: 10 } },
  { id: 'cool', name: 'Icy', adj: { warmth: -45, tint: -8, bright: 5, contrast: 8 } },
  { id: 'noir', name: 'Noir', mode: 'gray', adj: { contrast: 40, vignette: 45 } },
  { id: 'sepia', name: 'Sepia', mode: 'sepia', adj: { fade: 15, vignette: 30 } },
  { id: 'vintage', name: 'Vintage', adj: { warmth: 25, fade: 35, sat: -30, vignette: 40, grain: 30, tint: 8 } },
  { id: 'dream', name: 'Dreamy', mode: 'glow', adj: { bright: 10, sat: 12, fade: 8 } },
  { id: 'pop', name: 'Pop Art', mode: 'poster', adj: { sat: 70, contrast: 20 } },
  { id: 'comic', name: 'Comic', mode: 'comic', adj: { sat: 35 } },
  { id: 'sketch', name: 'Sketch', mode: 'sketch' },
  { id: 'neon', name: 'Neon', mode: 'neon' },
  { id: 'duo', name: 'Duotone', mode: 'map', map: ['#1b1464', '#ff4fa3', '#ffe96a'] },
  { id: 'heat', name: 'Thermal', mode: 'map', map: ['#000020', '#3a00a0', '#e0004a', '#ff9a00', '#ffff80'] },
  { id: 'pixel', name: 'Pixel', mode: 'pixel', adj: { sat: 20 } },
  { id: 'paint', name: 'Painting', mode: 'paint', adj: { sat: 25, contrast: 10 } },
];

export const ASPECTS = [
  { id: 'free', name: 'Original', r: 0 }, { id: 'square', name: 'Square', r: 1 },
  { id: '4:3', name: '4:3', r: 4 / 3 }, { id: '3:4', name: '3:4', r: 3 / 4 },
  { id: '16:9', name: 'Wide', r: 16 / 9 }, { id: '9:16', name: 'Tall', r: 9 / 16 },
];
export const COLORS = ['#ffffff', '#111111', '#ff3b30', '#ff9500', '#ffd60a', '#34c759', '#00c7be', '#0a84ff', '#5e5ce6', '#ff2d92', '#a2845e'];
export const BRUSHES = [
  { id: 'pen', name: 'Pen', icon: '🖊' }, { id: 'marker', name: 'Marker', icon: '🖍' },
  { id: 'neon', name: 'Neon', icon: '✨' }, { id: 'rainbow', name: 'Rainbow', icon: '🌈' },
];
export const STICKERS = ['😎', '😂', '😍', '🥳', '🤩', '😺', '🐶', '🦄', '👑', '🎩', '🕶', '💖', '⭐', '🌈', '🔥', '⚡', '🌸', '🍕', '🎈', '🎉', '💬', '👍', '🚀', '🌙'];
export const FONTS = [
  { id: 'sans', name: 'Clean', css: 'bold {s}px "Avenir Next", "Helvetica Neue", Arial, sans-serif' },
  { id: 'serif', name: 'Classic', css: 'italic bold {s}px Georgia, "Times New Roman", serif' },
  { id: 'impact', name: 'Loud', css: '900 {s}px Impact, "Arial Black", "Helvetica Neue", sans-serif' },
  { id: 'hand', name: 'Fun', css: 'bold {s}px "Marker Felt", "Comic Sans MS", "Chalkboard SE", cursive' },
];
export const TEXT_STYLES = [{ id: 'outline', name: 'Outline' }, { id: 'shadow', name: 'Shadow' }, { id: 'banner', name: 'Banner' }, { id: 'plain', name: 'Plain' }];
export const CAPTIONS = ['Masterpiece', 'Hello world!', 'Best day ever', 'Look at this!', 'Wow', 'Home sweet home', 'My favourite', 'Art!'];
export const BORDERS = [{ id: 'none', name: 'None' }, { id: 'white', name: 'White mat' }, { id: 'polaroid', name: 'Instant' }, { id: 'black', name: 'Black mat' }];

export function newState(){
  return {
    rot: 0, flip: false, aspect: 'free', zoom: 1, cx: 0.5, cy: 0.5, angle: 0,
    filter: 'none', strength: 100,
    adj: Object.fromEntries(ADJUST.map((a) => [a.id, 0])),
    strokes: [], stickers: [], text: { str: '', color: '#ffffff', size: 0.1, v: 0.86, style: 'outline', font: 'sans' },
    frame: 'wood', border: 'none',
  };
}
export const clone = (s) => JSON.parse(JSON.stringify(s));
// how many different kinds of edit went into a picture (it makes it worth more)
export function editsUsed(s){
  const n = newState(), used = [];
  if (s.rot || s.flip || s.aspect !== 'free' || s.zoom > 1.01 || Math.abs(s.angle) > 0.2) used.push('crop');
  if (s.filter !== 'none' && s.strength > 10) used.push('filter');
  if (ADJUST.some((a) => Math.abs(s.adj[a.id] - n.adj[a.id]) > 4)) used.push('adjust');
  if (s.strokes.length) used.push('draw');
  if (s.stickers.length) used.push('stickers');
  if (s.text.str.trim()) used.push('text');
  if (s.border !== 'none') used.push('border');
  return used;
}

const C = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

// the source turned and flipped (cached: it only changes when you press rotate or flip)
const baseCache = new WeakMap();
function baseOf(src, rot, flip){
  let m = baseCache.get(src); if (!m){ m = {}; baseCache.set(src, m); }
  const k = rot + (flip ? 'f' : '');
  if (m[k]) return m[k];
  const sw = src.width, sh = src.height, side = rot % 2 ? [sh, sw] : [sw, sh];
  const c = C(side[0], side[1]), g = c.getContext('2d');
  g.translate(c.width / 2, c.height / 2); g.rotate(rot * Math.PI / 2); if (flip) g.scale(-1, 1);
  g.drawImage(src, -sw / 2, -sh / 2);
  for (const key of Object.keys(m)) delete m[key];   // keep only one turned copy around
  m[k] = c; return c;
}

// the crop rectangle (in the turned source's pixels) and the output's shape
export function cropRect(src, s){
  const b = baseOf(src, s.rot, s.flip), bw = b.width, bh = b.height;
  const A = ASPECTS.find((a) => a.id === s.aspect) || ASPECTS[0];
  const r = A.r || bw / bh;
  let w = bw, h = bw / r; if (h > bh){ h = bh; w = bh * r; }
  w /= s.zoom; h /= s.zoom;
  const x = Math.min(Math.max(s.cx * bw - w / 2, 0), bw - w), y = Math.min(Math.max(s.cy * bh - h / 2, 0), bh - h);
  return { base: b, x, y, w, h, r };
}
// keep the crop centre where the crop rectangle actually is (after zooming out or changing shape)
export function settleCrop(src, s){
  const R = cropRect(src, s);
  s.cx = (R.x + R.w / 2) / R.base.width; s.cy = (R.y + R.h / 2) / R.base.height;
}

// draw the picture described by `s` from `src` into canvas `out` (resized so its longest side is `max`)
// opts.plain: only the crop (for Compare)
export function render(src, s, out, max = 720, opts = {}){
  const R = cropRect(src, s);
  const bord = opts.plain ? 'none' : s.border;
  const pad = bord === 'none' ? 0 : 0.06, padB = bord === 'polaroid' ? 0.2 : pad;
  let W, H; if (R.r >= 1){ W = max; H = Math.round(max / R.r); } else { H = max; W = Math.round(max * R.r); }
  const OW = Math.round(W * (1 + pad * 2)), OH = Math.round(H + W * (pad + padB));
  if (out.width !== OW || out.height !== OH){ out.width = OW; out.height = OH; }
  const g = out.getContext('2d', { willReadFrequently: true });
  // the picture itself, on its own canvas first (the pixel work happens there)
  const pic = scratch(W, H), pg = pic.getContext('2d', { willReadFrequently: true });
  pg.save(); pg.fillStyle = '#000'; pg.fillRect(0, 0, W, H);
  pg.imageSmoothingQuality = 'high';
  const th = (s.angle || 0) * Math.PI / 180, ca = Math.abs(Math.cos(th)), sa = Math.abs(Math.sin(th));
  const cover = Math.max(ca + sa * H / W, ca + sa * W / H);
  pg.translate(W / 2, H / 2); pg.rotate(th); pg.scale(W / R.w * cover, H / R.h * cover);
  pg.drawImage(R.base, -(R.x + R.w / 2), -(R.y + R.h / 2));
  pg.restore();
  if (!opts.plain){
    pixels(pg, W, H, s);
    drawStrokes(pg, W, H, s.strokes);
    drawStickers(pg, W, H, s.stickers);
    drawText(pg, W, H, s.text);
  }
  // the mat round it
  if (bord !== 'none'){ g.fillStyle = bord === 'black' ? '#111' : bord === 'polaroid' ? '#fbfaf4' : '#f4f1ea'; g.fillRect(0, 0, OW, OH); }
  const ox = Math.round(W * pad), oy = Math.round(W * pad);
  g.drawImage(pic, 0, 0, W, H, ox, oy, W, H);
  return { x: ox / OW, y: oy / OH, w: W / OW, h: H / OH };   // where the picture is inside the output (for pointing)
}
const scratches = {};
function scratch(w, h){
  const k = 'p'; let c = scratches[k];
  if (!c){ c = scratches[k] = C(w, h); }
  if (c.width !== w || c.height !== h){ c.width = w; c.height = h; }
  return c;
}

// ---------- the pixel work: tone, colour, the filter's look, vignette, grain, sharpen and soften ----------
function pixels(g, W, H, s){
  const F = FILTERS.find((f) => f.id === s.filter) || FILTERS[0];
  const k = F.id === 'none' ? 0 : s.strength / 100;
  const a = {}; for (const A of ADJUST) a[A.id] = s.adj[A.id] + ((F.adj && F.adj[A.id]) || 0) * k;
  const busy = F.mode || ADJUST.some((A) => Math.abs(a[A.id]) > 0.5);
  if (!busy) return;
  const img = g.getImageData(0, 0, W, H), d = img.data, n = W * H;
  // the special looks that need neighbours work on a copy first
  if (F.mode && k > 0){
    const orig = k < 1 ? new Uint8ClampedArray(d) : null;
    look(F, d, W, H);
    if (orig) for (let i = 0; i < d.length; i += 4){ d[i] = orig[i] + (d[i] - orig[i]) * k; d[i + 1] = orig[i + 1] + (d[i + 1] - orig[i + 1]) * k; d[i + 2] = orig[i + 2] + (d[i + 2] - orig[i + 2]) * k; }
  }
  if (a.blur > 0.5){ const r = Math.max(1, Math.round(a.blur / 100 * Math.max(W, H) / 70)); const b = new Uint8ClampedArray(d); boxBlur(b, W, H, r); boxBlur(b, W, H, r); const t = Math.min(1, a.blur / 60); for (let i = 0; i < d.length; i++) if ((i & 3) !== 3) d[i] += (b[i] - d[i]) * t; }
  if (a.sharpen > 0.5){ const b = new Uint8ClampedArray(d); boxBlur(b, W, H, Math.max(1, Math.round(Math.max(W, H) / 500))); const t = a.sharpen / 100 * 1.6; for (let i = 0; i < d.length; i++) if ((i & 3) !== 3) d[i] = d[i] + (d[i] - b[i]) * t; }
  // tone curve, one table for all three channels
  const lut = new Uint8ClampedArray(256);
  const br = a.bright / 100, ct = a.contrast / 100, hi = a.highlights / 100, sh = a.shadows / 100, fd = a.fade / 100;
  const cf = ct >= 0 ? 1 + ct * 1.6 : 1 + ct * 0.8;
  for (let i = 0; i < 256; i++){
    let v = i / 255;
    v = br >= 0 ? v + (1 - v) * br * 0.6 : v * (1 + br * 0.6);
    v = (v - 0.5) * cf + 0.5;
    const w = Math.min(1, Math.max(0, v));
    v += hi * 0.35 * w * w * (1 - w) * 2.2 + sh * 0.35 * (1 - w) * (1 - w) * w * 2.6;
    v = v * (1 - fd * 0.35) + fd * 0.12;
    lut[i] = clamp255(Math.round(v * 255));
  }
  const sat = 1 + a.sat / 100 * (a.sat > 0 ? 1.1 : 1), wr = a.warmth / 100 * 28, tn = a.tint / 100 * 22;
  const vig = a.vignette / 100, grain = a.grain / 100 * 46;
  const cx = W / 2, cy = H / 2, rmax = Math.hypot(cx, cy);
  let seed = 12345;
  for (let p = 0, i = 0; p < n; p++, i += 4){
    let r = lut[d[i]], gg = lut[d[i + 1]], b = lut[d[i + 2]];
    if (sat !== 1){ const L = 0.299 * r + 0.587 * gg + 0.114 * b; r = L + (r - L) * sat; gg = L + (gg - L) * sat; b = L + (b - L) * sat; }
    if (wr || tn){ r += wr; b -= wr; gg -= tn; r += tn * 0.5; b += tn * 0.5; }
    if (vig > 0){ const x = (p % W) - cx, y = ((p / W) | 0) - cy, q = Math.max(0, Math.hypot(x, y) / rmax - 0.35), f = 1 - vig * q * q * 2.0; r *= f; gg *= f; b *= f; }
    if (grain > 0){ seed = (seed * 1103515245 + 12345) & 0x7fffffff; const z = ((seed >> 8) / 8388608 - 0.5) * grain; r += z; gg += z; b += z; }
    d[i] = r; d[i + 1] = gg; d[i + 2] = b;
  }
  g.putImageData(img, 0, 0);
}

function look(F, d, W, H){
  const n = W * H;
  const luma = () => { const L = new Float32Array(n); for (let p = 0, i = 0; p < n; p++, i += 4) L[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; return L; };
  if (F.mode === 'gray'){ for (let i = 0; i < d.length; i += 4){ const L = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = d[i + 1] = d[i + 2] = L; } return; }
  if (F.mode === 'sepia'){ for (let i = 0; i < d.length; i += 4){ const r = d[i], g = d[i + 1], b = d[i + 2]; d[i] = r * 0.393 + g * 0.769 + b * 0.189; d[i + 1] = r * 0.349 + g * 0.686 + b * 0.168; d[i + 2] = r * 0.272 + g * 0.534 + b * 0.131; } return; }
  if (F.mode === 'glow'){ const b = new Uint8ClampedArray(d), r = Math.max(2, Math.round(Math.max(W, H) / 40)); boxBlur(b, W, H, r); boxBlur(b, W, H, r); for (let i = 0; i < d.length; i++) if ((i & 3) !== 3){ const A = d[i] / 255, B = b[i] / 255; d[i] = (1 - (1 - A) * (1 - B * 0.85)) * 255; } return; }
  if (F.mode === 'poster'){ const lv = 4, st = 255 / (lv - 1); for (let i = 0; i < d.length; i++) if ((i & 3) !== 3) d[i] = Math.round(d[i] / st) * st; return; }
  if (F.mode === 'map'){
    const stops = F.map.map(hex), m = stops.length - 1, L = luma();
    for (let p = 0, i = 0; p < n; p++, i += 4){ const t = L[p] / 255 * m, j = Math.min(m - 1, Math.floor(t)), f = t - j, A = stops[j], B = stops[j + 1]; d[i] = A[0] + (B[0] - A[0]) * f; d[i + 1] = A[1] + (B[1] - A[1]) * f; d[i + 2] = A[2] + (B[2] - A[2]) * f; }
    return;
  }
  if (F.mode === 'pixel'){
    const bs = Math.max(4, Math.round(Math.max(W, H) / 56));
    for (let by = 0; by < H; by += bs) for (let bx = 0; bx < W; bx += bs){
      let r = 0, g = 0, b = 0, c = 0;
      for (let y = by; y < Math.min(H, by + bs); y++) for (let x = bx; x < Math.min(W, bx + bs); x++){ const i = (y * W + x) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; c++; }
      r /= c; g /= c; b /= c;
      for (let y = by; y < Math.min(H, by + bs); y++) for (let x = bx; x < Math.min(W, bx + bs); x++){ const i = (y * W + x) * 4; const edge = (x === bx || y === by) ? 0.86 : 1; d[i] = r * edge; d[i + 1] = g * edge; d[i + 2] = b * edge; }
    }
    return;
  }
  if (F.mode === 'paint'){
    // a soft, flattened look: blur, then gather colours into bands
    const r = Math.max(1, Math.round(Math.max(W, H) / 220)); boxBlur(d, W, H, r);
    const st = 255 / 7; for (let i = 0; i < d.length; i++) if ((i & 3) !== 3) d[i] = d[i] * 0.45 + Math.round(d[i] / st) * st * 0.55;
    const E = sobel(luma(), W, H);
    for (let p = 0, i = 0; p < n; p++, i += 4){ const e = Math.min(1, E[p] / 260) * 0.35; d[i] *= 1 - e; d[i + 1] *= 1 - e; d[i + 2] *= 1 - e; }
    return;
  }
  const E = sobel(luma(), W, H);
  if (F.mode === 'sketch'){
    const L = luma();
    for (let p = 0, i = 0; p < n; p++, i += 4){ const v = 255 - Math.min(255, E[p] * 1.4); const t = v * 0.85 + L[p] * 0.15 + 18; d[i] = t; d[i + 1] = t * 0.98; d[i + 2] = t * 0.94; }
    return;
  }
  if (F.mode === 'comic'){
    const st = 255 / 4;
    for (let p = 0, i = 0; p < n; p++, i += 4){
      const ink = E[p] > 120;
      for (let c = 0; c < 3; c++) d[i + c] = ink ? 20 : Math.min(255, Math.round(d[i + c] / st) * st + 12);
      // halftone dots in the darker parts
      const x = p % W, y = (p / W) | 0, L = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
      if (!ink && L < 120 && ((x >> 2) + (y >> 2)) % 2 === 0 && (x & 3) < 2 && (y & 3) < 2){ d[i] *= 0.6; d[i + 1] *= 0.6; d[i + 2] *= 0.6; }
    }
    return;
  }
  if (F.mode === 'neon'){
    const out = new Uint8ClampedArray(d.length);
    for (let p = 0, i = 0; p < n; p++, i += 4){
      const e = Math.min(1, E[p] / 180), r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b, 1);
      // the edges in the picture's own colour, made bright
      out[i] = (r / mx * 255) * e * 1.2 + 8; out[i + 1] = (g / mx * 255) * e * 1.2 + 4; out[i + 2] = (b / mx * 255) * e * 1.2 + 18; out[i + 3] = 255;
    }
    const gl = new Uint8ClampedArray(out); const r = Math.max(2, Math.round(Math.max(W, H) / 120)); boxBlur(gl, W, H, r);
    for (let i = 0; i < d.length; i++) if ((i & 3) !== 3) d[i] = out[i] + gl[i] * 1.3;
  }
}
function sobel(L, W, H){
  const E = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++){
    const p = y * W + x;
    const gx = -L[p - W - 1] - 2 * L[p - 1] - L[p + W - 1] + L[p - W + 1] + 2 * L[p + 1] + L[p + W + 1];
    const gy = -L[p - W - 1] - 2 * L[p - W] - L[p - W + 1] + L[p + W - 1] + 2 * L[p + W] + L[p + W + 1];
    E[p] = Math.sqrt(gx * gx + gy * gy);
  }
  return E;
}
// a box blur of radius r on RGBA data, in place (two passes of it look like a Gaussian)
function boxBlur(d, W, H, r){
  const tmp = new Float32Array(Math.max(W, H) * 4), win = 2 * r + 1;
  for (let y = 0; y < H; y++){
    const row = y * W * 4;
    for (let c = 0; c < 3; c++){
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += d[row + Math.min(W - 1, Math.max(0, k)) * 4 + c];
      for (let x = 0; x < W; x++){
        tmp[x] = acc / win;
        acc += d[row + Math.min(W - 1, x + r + 1) * 4 + c] - d[row + Math.max(0, x - r) * 4 + c];
      }
      for (let x = 0; x < W; x++) d[row + x * 4 + c] = tmp[x];
    }
  }
  for (let x = 0; x < W; x++){
    for (let c = 0; c < 3; c++){
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += d[(Math.min(H - 1, Math.max(0, k)) * W + x) * 4 + c];
      for (let y = 0; y < H; y++){
        tmp[y] = acc / win;
        acc += d[(Math.min(H - 1, y + r + 1) * W + x) * 4 + c] - d[(Math.max(0, y - r) * W + x) * 4 + c];
      }
      for (let y = 0; y < H; y++) d[(y * W + x) * 4 + c] = tmp[y];
    }
  }
}

// ---------- drawing, stickers, words (all in 0..1 picture coordinates, so they scale with it) ----------
function drawStrokes(g, W, H, strokes){
  for (const st of strokes){
    if (!st.pts.length) continue;
    g.save();
    g.lineCap = 'round'; g.lineJoin = 'round';
    const lw = st.size * W;
    g.lineWidth = st.brush === 'marker' ? lw * 2.2 : lw;
    g.strokeStyle = st.color; g.fillStyle = st.color;
    if (st.brush === 'marker') g.globalAlpha = 0.45;
    if (st.brush === 'neon'){ g.shadowColor = st.color; g.shadowBlur = lw * 2.5; }
    if (st.brush === 'rainbow'){
      for (let i = 1; i < st.pts.length; i++){
        g.strokeStyle = `hsl(${(i * 9) % 360},95%,58%)`;
        g.beginPath(); g.moveTo(st.pts[i - 1][0] * W, st.pts[i - 1][1] * H); g.lineTo(st.pts[i][0] * W, st.pts[i][1] * H); g.stroke();
      }
      if (st.pts.length === 1){ g.fillStyle = 'hsl(0,95%,58%)'; g.beginPath(); g.arc(st.pts[0][0] * W, st.pts[0][1] * H, lw / 2, 0, 7); g.fill(); }
      g.restore(); continue;
    }
    if (st.pts.length === 1){ g.beginPath(); g.arc(st.pts[0][0] * W, st.pts[0][1] * H, g.lineWidth / 2, 0, 7); g.fill(); }
    else {
      g.beginPath(); g.moveTo(st.pts[0][0] * W, st.pts[0][1] * H);
      for (let i = 1; i < st.pts.length - 1; i++){
        const mx = (st.pts[i][0] + st.pts[i + 1][0]) / 2 * W, my = (st.pts[i][1] + st.pts[i + 1][1]) / 2 * H;
        g.quadraticCurveTo(st.pts[i][0] * W, st.pts[i][1] * H, mx, my);
      }
      const L = st.pts[st.pts.length - 1]; g.lineTo(L[0] * W, L[1] * H);
      g.stroke();
      if (st.brush === 'neon'){ g.shadowBlur = 0; g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = lw * 0.35; g.stroke(); }
    }
    g.restore();
  }
}
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
function drawStickers(g, W, H, list){
  for (const s of list){
    g.save();
    g.translate(s.u * W, s.v * H); g.rotate(s.r || 0);
    const px = s.s * W;
    g.font = `${px}px ${EMOJI_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = px * 0.08; g.shadowOffsetY = px * 0.04;
    g.fillText(s.e, 0, px * 0.06);
    g.restore();
  }
}
function drawText(g, W, H, t){
  const str = (t.str || '').trim(); if (!str) return;
  const F = FONTS.find((f) => f.id === t.font) || FONTS[0];
  let px = t.size * W;
  g.save();
  g.font = F.css.replace('{s}', px); g.textAlign = 'center'; g.textBaseline = 'middle';
  while (g.measureText(str).width > W * 0.92 && px > 8){ px *= 0.92; g.font = F.css.replace('{s}', Math.round(px)); }
  const y = t.v * H, x = W / 2;
  if (t.style === 'banner'){
    const w = g.measureText(str).width + px * 1.0;
    g.fillStyle = t.color === '#111111' ? 'rgba(255,255,255,0.88)' : 'rgba(0,0,0,0.6)';
    g.fillRect(x - w / 2, y - px * 0.7, w, px * 1.4);
  }
  if (t.style === 'shadow'){ g.shadowColor = 'rgba(0,0,0,0.75)'; g.shadowBlur = px * 0.18; g.shadowOffsetY = px * 0.06; }
  if (t.style === 'outline'){ g.lineJoin = 'round'; g.lineWidth = Math.max(2, px * 0.16); g.strokeStyle = t.color === '#111111' ? '#ffffff' : '#111111'; g.strokeText(str, x, y); }
  g.fillStyle = t.color; g.fillText(str, x, y);
  g.restore();
}

// the picture's finished size for keeping
export function bake(src, s, max = 1024){ const c = C(1, 1); render(src, s, c, max); return c; }

// downscale a camera frame (or any image) into a canvas no bigger than max on its long side
export function toCanvas(img, max = 1600){
  const w = img.videoWidth || img.naturalWidth || img.width, h = img.videoHeight || img.naturalHeight || img.height;
  const k = Math.min(1, max / Math.max(w, h)), c = C(w * k, h * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}
