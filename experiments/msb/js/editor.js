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
  { id: 'pen', name: 'Pen', icon: '🖊' }, { id: 'pencil', name: 'Pencil', icon: '✏️' }, { id: 'marker', name: 'Marker', icon: '🖍' },
  { id: 'highlight', name: 'Highlighter', icon: '🖌' }, { id: 'spray', name: 'Spray', icon: '💨' }, { id: 'neon', name: 'Neon', icon: '✨' },
  { id: 'rainbow', name: 'Rainbow', icon: '🌈' }, { id: 'eraser', name: 'Eraser', icon: '🧽' },
];
// brush sizes, as a share of the picture's width
export const SIZES = [{ id: 'XS', v: 0.004 }, { id: 'S', v: 0.009 }, { id: 'M', v: 0.018 }, { id: 'L', v: 0.034 }, { id: 'XL', v: 0.065 }];
// what to do with a selection
export const SEL_FX = [
  { id: 'none', name: 'Just select', icon: '⬚' }, { id: 'pop', name: 'Colour pop', icon: '🎨', tip: 'everything else black and white' },
  { id: 'blur', name: 'Blur the rest', icon: '💧' }, { id: 'spot', name: 'Spotlight', icon: '🔦', tip: 'the rest goes dark' },
  { id: 'cut', name: 'Cut out', icon: '✂️', tip: 'a new background' }, { id: 'bright', name: 'Make it shine', icon: '✨' },
];
export const BACKDROPS = ['#ffffff', '#111111', '#ffd6e8', '#cfe8ff', '#d8f5d0', '#fff2b0', 'sunset', 'sky', 'stripes', 'dots'];
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
    sel: { lasso: [], magic: [], invert: false }, selFx: 'none', selBg: '#ffffff',
    frame: 'wood', border: 'none',
  };
}
export const clone = (s) => JSON.parse(JSON.stringify(s));
export const hasSel = (s) => !!(s.sel && (s.sel.lasso.length || s.sel.magic.length));
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
  if (hasSel(s) && s.selFx !== 'none') used.push('select');
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
let depth = 0;
export function render(src, s, out, max = 720, opts = {}){
  depth++;
  try { return renderNow(src, s, out, max, opts); } finally { depth--; }
}
function renderNow(src, s, out, max, opts){
  const R = cropRect(src, s);
  const bord = opts.plain ? 'none' : s.border;
  const pad = bord === 'none' ? 0 : 0.06, padB = bord === 'polaroid' ? 0.2 : pad;
  let W, H; if (R.r >= 1){ W = max; H = Math.round(max / R.r); } else { H = max; W = Math.round(max * R.r); }
  const OW = Math.round(W * (1 + pad * 2)), OH = Math.round(H + W * (pad + padB));
  if (out.width !== OW || out.height !== OH){ out.width = OW; out.height = OH; }
  const g = out.getContext('2d', { willReadFrequently: true });
  // the picture itself, on its own canvas first (the pixel work happens there)
  const pic = scratch(W, H, depth), pg = pic.getContext('2d', { willReadFrequently: true });
  pg.save(); pg.fillStyle = '#000'; pg.fillRect(0, 0, W, H);
  pg.imageSmoothingQuality = 'high';
  const th = (s.angle || 0) * Math.PI / 180, ca = Math.abs(Math.cos(th)), sa = Math.abs(Math.sin(th));
  const cover = Math.max(ca + sa * H / W, ca + sa * W / H);
  pg.translate(W / 2, H / 2); pg.rotate(th); pg.scale(W / R.w * cover, H / R.h * cover);
  pg.drawImage(R.base, -(R.x + R.w / 2), -(R.y + R.h / 2));
  pg.restore();
  if (!opts.plain){
    pixels(pg, W, H, s);
    if (hasSel(s) && s.selFx !== 'none' && !opts.noSelFx) selectionFx(src, s, pg, W, H);
    if (!opts.noStrokes) drawStrokes(pg, W, H, s.strokes);
    if (!opts.noStickers) drawStickers(pg, W, H, s.stickers, opts.cuts);
    if (!opts.noText) drawText(pg, W, H, s.text);
  }
  // the mat round it
  if (bord !== 'none'){ g.fillStyle = bord === 'black' ? '#111' : bord === 'polaroid' ? '#fbfaf4' : '#f4f1ea'; g.fillRect(0, 0, OW, OH); }
  const ox = Math.round(W * pad), oy = Math.round(W * pad);
  g.drawImage(pic, 0, 0, W, H, ox, oy, W, H);
  return { x: ox / OW, y: oy / OH, w: W / OW, h: H / OH };   // where the picture is inside the output (for pointing)
}
const scratches = {};
function scratch(w, h, d = 0){
  const k = 'p' + d; let c = scratches[k];
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
function drawStrokes(out, W, H, strokes){
  if (!strokes.length) return;
  const layer = scratchN('strokes', W, H), g = layer.getContext('2d');
  g.clearRect(0, 0, W, H);
  strokes.forEach((st, k) => {
    if (!st.pts.length) return;
    g.save();
    g.lineCap = 'round'; g.lineJoin = 'round';
    const lw = st.size * W, P = (p) => [p[0] * W, p[1] * H];
    g.lineWidth = lw; g.strokeStyle = st.color; g.fillStyle = st.color;
    g.globalAlpha = st.alpha == null ? 1 : st.alpha;
    if (st.brush === 'eraser'){ g.globalCompositeOperation = 'destination-out'; g.strokeStyle = g.fillStyle = '#000'; g.globalAlpha = 1; }
    if (st.brush === 'marker'){ g.globalAlpha *= 0.55; g.lineWidth = lw * 1.6; }
    if (st.brush === 'highlight'){ g.globalAlpha *= 0.35; g.lineWidth = lw * 2.4; g.lineCap = 'butt'; }
    if (st.brush === 'pencil'){ g.globalAlpha *= 0.85; g.lineWidth = Math.max(1, lw * 0.6); }
    if (st.brush === 'neon'){ g.shadowColor = st.color; g.shadowBlur = lw * 2.5; }
    if (st.brush === 'spray'){
      // dots scattered round the path (the same every time: seeded by the stroke)
      let seed = 9973 * (k + 1);
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (let i = 0; i < st.pts.length; i++){
        const [x, y] = P(st.pts[i]);
        for (let d = 0; d < 14; d++){ const a = rnd() * 6.283, r = Math.sqrt(rnd()) * lw * 1.6; g.globalAlpha = (st.alpha == null ? 1 : st.alpha) * (0.25 + rnd() * 0.5); g.fillRect(x + Math.cos(a) * r, y + Math.sin(a) * r, Math.max(1, lw * 0.12), Math.max(1, lw * 0.12)); }
      }
      g.restore(); return;
    }
    if (st.brush === 'rainbow'){
      for (let i = 1; i < st.pts.length; i++){
        g.strokeStyle = `hsl(${(i * 9) % 360},95%,58%)`;
        const a = P(st.pts[i - 1]), b = P(st.pts[i]);
        g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      }
      if (st.pts.length === 1){ const a = P(st.pts[0]); g.fillStyle = 'hsl(0,95%,58%)'; g.beginPath(); g.arc(a[0], a[1], lw / 2, 0, 7); g.fill(); }
      g.restore(); return;
    }
    if (st.pts.length === 1){ const a = P(st.pts[0]); g.beginPath(); g.arc(a[0], a[1], g.lineWidth / 2, 0, 7); g.fill(); }
    else {
      const a0 = P(st.pts[0]); g.beginPath(); g.moveTo(a0[0], a0[1]);
      for (let i = 1; i < st.pts.length - 1; i++){
        const a = P(st.pts[i]), b = P(st.pts[i + 1]);
        g.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      }
      const L = P(st.pts[st.pts.length - 1]); g.lineTo(L[0], L[1]);
      g.stroke();
      if (st.brush === 'neon'){ g.shadowBlur = 0; g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = lw * 0.35; g.stroke(); }
    }
    g.restore();
  });
  out.drawImage(layer, 0, 0);
}
const scratchesN = {};
function scratchN(k, w, h){ let c = scratchesN[k]; if (!c) c = scratchesN[k] = C(w, h); if (c.width !== w || c.height !== h){ c.width = w; c.height = h; } return c; }

// ---------- the selection: draw round something (lasso) or tap it (magic wand) ----------
// The mask is worked out at about 320 px (on the picture before filters), cached, and scaled up with
// smoothing, which gives it a soft edge.
const maskCache = { key: '', canvas: null };
export function selectionMask(src, s){
  const key = JSON.stringify([s.sel, s.rot, s.flip, s.aspect, s.zoom, s.cx, s.cy, s.angle]);
  if (maskCache.key === key && maskCache.canvas) return maskCache.canvas;
  const plain = C(1, 1);
  render(src, { ...newState(), rot: s.rot, flip: s.flip, aspect: s.aspect, zoom: s.zoom, cx: s.cx, cy: s.cy, angle: s.angle }, plain, 320, { plain: true });
  const W = plain.width, H = plain.height;
  const m = C(W, H), g = m.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff';
  for (const poly of s.sel.lasso){ if (poly.length < 3) continue; g.beginPath(); g.moveTo(poly[0][0] * W, poly[0][1] * H); for (const p of poly) g.lineTo(p[0] * W, p[1] * H); g.closePath(); g.fill(); }
  if (s.sel.magic.length){
    const d = plain.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    const img = g.getImageData(0, 0, W, H), o = img.data;
    for (const seed of s.sel.magic){
      const fill = flood(d, W, H, Math.floor(seed.u * W), Math.floor(seed.v * H), seed.tol);
      for (let p = 0; p < W * H; p++) if (fill[p]){ o[p * 4] = o[p * 4 + 1] = o[p * 4 + 2] = o[p * 4 + 3] = 255; }
    }
    g.putImageData(img, 0, 0);
  }
  if (s.sel.invert){ g.globalCompositeOperation = 'xor'; g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.globalCompositeOperation = 'source-over'; }
  maskCache.key = key; maskCache.canvas = m;
  return m;
}
// grow a region from (x, y) over pixels whose colour is close to the seed's (and to their neighbours'),
// then fill small holes in it
function flood(d, W, H, x, y, tol){
  const n = W * H, out = new Uint8Array(n);
  if (x < 0 || y < 0 || x >= W || y >= H) return out;
  const i0 = (y * W + x) * 4, r0 = d[i0], g0 = d[i0 + 1], b0 = d[i0 + 2];
  const lim = (tol || 30) * 2.2, step = lim * 0.55;
  const dist = (i, r, g, b) => { const dr = d[i] - r, dg = d[i + 1] - g, db = d[i + 2] - b; return Math.sqrt(dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11) * 1.6; };
  const stack = [y * W + x]; out[y * W + x] = 1;
  while (stack.length){
    const p = stack.pop(), px = p % W, py = (p / W) | 0, i = p * 4;
    for (const [qx, qy] of [[px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]]){
      if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
      const q = qy * W + qx; if (out[q]) continue;
      const j = q * 4;
      if (dist(j, r0, g0, b0) < lim && dist(j, d[i], d[i + 1], d[i + 2]) < step){ out[q] = 1; stack.push(q); }
    }
  }
  // close little holes: a pixel surrounded mostly by the region joins it
  for (let pass = 0; pass < 2; pass++){
    const copy = out.slice();
    for (let yy = 1; yy < H - 1; yy++) for (let xx = 1; xx < W - 1; xx++){
      const p = yy * W + xx; if (copy[p]) continue;
      let c = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) c += copy[p + dy * W + dx];
      if (c >= 5) out[p] = 1;
    }
  }
  return out;
}
// the mask at the picture's size, as 0..1 per pixel
function maskAt(src, s, W, H){
  const m = selectionMask(src, s), c = scratchN('mask', W, H), g = c.getContext('2d', { willReadFrequently: true });
  g.clearRect(0, 0, W, H); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(m, 0, 0, W, H);
  const d = g.getImageData(0, 0, W, H).data, a = new Float32Array(W * H);
  for (let p = 0; p < W * H; p++) a[p] = d[p * 4 + 3] / 255;
  return a;
}
function selectionFx(src, s, g, W, H){
  const a = maskAt(src, s, W, H), img = g.getImageData(0, 0, W, H), d = img.data;
  let other = null;
  if (s.selFx === 'blur'){ other = new Uint8ClampedArray(d); const r = Math.max(2, Math.round(Math.max(W, H) / 60)); boxBlur(other, W, H, r); boxBlur(other, W, H, r); boxBlur(other, W, H, r); }
  if (s.selFx === 'cut'){ const b = scratchN('bg', W, H); paintBackdrop(b.getContext('2d'), W, H, s.selBg); other = b.getContext('2d').getImageData(0, 0, W, H).data; }
  for (let p = 0, i = 0; p < W * H; p++, i += 4){
    const k = a[p];
    let r = d[i], gg = d[i + 1], b = d[i + 2];
    if (s.selFx === 'bright'){ if (k > 0){ const L = 0.299 * r + 0.587 * gg + 0.114 * b; const f = 1 + 0.25 * k; r = (L + (r - L) * (1 + 0.4 * k)) * f; gg = (L + (gg - L) * (1 + 0.4 * k)) * f; b = (L + (b - L) * (1 + 0.4 * k)) * f; } d[i] = r; d[i + 1] = gg; d[i + 2] = b; continue; }
    if (k >= 1) continue;
    let R, G, B;
    if (s.selFx === 'pop'){ const L = 0.299 * r + 0.587 * gg + 0.114 * b; R = G = B = L; }
    else if (s.selFx === 'spot'){ R = r * 0.28; G = gg * 0.28; B = b * 0.32; }
    else { R = other[i]; G = other[i + 1]; B = other[i + 2]; }
    d[i] = R + (r - R) * k; d[i + 1] = G + (gg - G) * k; d[i + 2] = B + (b - B) * k;
  }
  g.putImageData(img, 0, 0);
}
export function paintBackdrop(g, W, H, bg){
  if (bg === 'sunset' || bg === 'sky'){ const gr = g.createLinearGradient(0, 0, 0, H); if (bg === 'sunset'){ gr.addColorStop(0, '#3a1c71'); gr.addColorStop(0.5, '#d76d77'); gr.addColorStop(1, '#ffaf7b'); } else { gr.addColorStop(0, '#4a9ae8'); gr.addColorStop(1, '#d8f0ff'); } g.fillStyle = gr; g.fillRect(0, 0, W, H); return; }
  if (bg === 'stripes'){ const n = 12; for (let i = 0; i < n; i++){ g.fillStyle = i % 2 ? '#ffe28a' : '#ff8ab8'; g.fillRect(i * W / n, 0, W / n + 1, H); } return; }
  if (bg === 'dots'){ g.fillStyle = '#2a3a8a'; g.fillRect(0, 0, W, H); g.fillStyle = '#ffd84a'; const s = Math.max(W, H) / 14; for (let y = 0; y < H + s; y += s) for (let x = ((y / s) % 2) * s / 2; x < W + s; x += s){ g.beginPath(); g.arc(x, y, s * 0.18, 0, 7); g.fill(); } return; }
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
}
// the selected part of the finished picture as its own image (to become a sticker), cropped to it
export function cutOut(src, s, cuts){
  const pic = C(1, 1);
  const st = { ...s, border: 'none', stickers: [], text: { ...s.text, str: '' }, selFx: 'none' };
  render(src, st, pic, 900, { cuts });
  const W = pic.width, H = pic.height, a = maskAt(src, s, W, H);
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (a[y * W + x] > 0.5){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 <= x0 || y1 <= y0) return null;
  const g = pic.getContext('2d', { willReadFrequently: true }), img = g.getImageData(0, 0, W, H);
  for (let p = 0; p < W * H; p++) img.data[p * 4 + 3] = Math.round(img.data[p * 4 + 3] * a[p]);
  g.putImageData(img, 0, 0);
  const pad = 2; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  const out = C(x1 - x0 + 1, y1 - y0 + 1); out.getContext('2d').drawImage(pic, -x0, -y0);
  return { canvas: out, u: (x0 + x1) / 2 / W, v: (y0 + y1) / 2 / H, w: (x1 - x0) / W };
}
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
function drawStickers(g, W, H, list, cuts){
  for (const s of list){
    g.save();
    g.translate(s.u * W, s.v * H); g.rotate(s.r || 0);
    const px = s.s * W;
    if (s.cut != null){
      const c = cuts && cuts[s.cut];
      if (c){ const h = px * c.height / c.width; g.shadowColor = 'rgba(0,0,0,0.4)'; g.shadowBlur = px * 0.04; g.shadowOffsetY = px * 0.02; g.drawImage(c, -px / 2, -h / 2, px, h); }
      g.restore(); continue;
    }
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
export function bake(src, s, max = 1024, cuts){ const c = C(1, 1); render(src, s, c, max, { cuts }); return c; }

// downscale a camera frame (or any image) into a canvas no bigger than max on its long side
export function toCanvas(img, max = 1600){
  const w = img.videoWidth || img.naturalWidth || img.width, h = img.videoHeight || img.naturalHeight || img.height;
  const k = Math.min(1, max / Math.max(w, h)), c = C(w * k, h * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}
