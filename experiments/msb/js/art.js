// Artworks: your photos (kept in the browser's IndexedDB, as JPEGs) and the paintings on the art
// market (painted from a seed, so they never need storing), what they're worth, their names, and the
// little pictures shown in lists.
import { rng } from './util.js';

// ---------- storage of the pictures themselves ----------
const DB = 'msb-pictures', STORE = 'pics';
let dbp = null;
const mem = new Map();   // when IndexedDB isn't there (some private windows), pictures live here for the visit
function db(){
  if (dbp) return dbp;
  dbp = new Promise((res) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
      setTimeout(() => res(null), 4000);
    } catch (e) { res(null); }
  });
  return dbp;
}
function tx(mode, fn){
  return db().then((d) => new Promise((res) => {
    if (!d){ res(fn(null)); return; }
    try {
      const t = d.transaction(STORE, mode), st = t.objectStore(STORE);
      const r = fn(st);
      if (r && 'onsuccess' in r){ r.onsuccess = () => res(r.result); r.onerror = () => res(undefined); }
      else t.oncomplete = () => res(r);
    } catch (e) { res(fn(null)); }
  }));
}
const toBlob = (c) => new Promise((res) => c.toBlob((b) => res(b), 'image/jpeg', 0.88));
export async function putPicture(id, canvas){
  const blob = await toBlob(canvas);
  mem.set(id, blob);
  await tx('readwrite', (st) => st ? st.put(blob, id) : null);
  return blob;
}
export async function delPicture(id){ mem.delete(id); canvases.delete(id); thumbs.delete(id); await tx('readwrite', (st) => st ? st.delete(id) : null); }
async function getBlob(id){ const b = await tx('readonly', (st) => st ? st.get(id) : null); return b || mem.get(id) || null; }

// a picture as a canvas (photos from storage, market paintings painted again from their seed)
const canvases = new Map();
export async function pictureOf(art){
  if (canvases.has(art.id)) return canvases.get(art.id);
  let c;
  if (art.kind === 'market') c = paintMarket(art.style, art.seed, 640);
  else {
    const blob = await getBlob(art.id);
    if (!blob) c = missing();
    else {
      const url = URL.createObjectURL(blob);
      try { const img = new Image(); img.src = url; await img.decode(); c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); }
      catch (e) { c = missing(); }
      URL.revokeObjectURL(url);
    }
  }
  canvases.set(art.id, c);
  // keep only a handful of big pictures in memory
  if (canvases.size > 12){ const k = canvases.keys().next().value; canvases.delete(k); }
  return c;
}
function missing(){
  const c = document.createElement('canvas'); c.width = 400; c.height = 300; const g = c.getContext('2d');
  g.fillStyle = '#ddd'; g.fillRect(0, 0, 400, 300); g.fillStyle = '#888'; g.font = 'bold 28px Arial'; g.textAlign = 'center'; g.fillText('picture missing', 200, 160);
  return c;
}
// a small square picture for lists and the VR panels (cached)
const thumbs = new Map();
export function thumbOf(art, size = 128){
  const k = art.id;
  if (thumbs.has(k)) return thumbs.get(k);
  const t = document.createElement('canvas'); t.width = t.height = size;
  const g = t.getContext('2d'); g.fillStyle = '#e8e2d4'; g.fillRect(0, 0, size, size);
  thumbs.set(k, t);
  const fit = (c) => { const s = Math.min(size / c.width, size / c.height), w = c.width * s, h = c.height * s; g.clearRect(0, 0, size, size); g.drawImage(c, (size - w) / 2, (size - h) / 2, w, h); };
  if (art.kind === 'market' && !canvases.has(art.id)){ fit(paintMarket(art.style, art.seed, 256)); return t; }   // painted straight away
  pictureOf(art).then((c) => { const s = Math.min(size / c.width, size / c.height), w = c.width * s, h = c.height * s; g.clearRect(0, 0, size, size); g.drawImage(c, (size - w) / 2, (size - h) / 2, w, h); if (thumbOf.onReady) thumbOf.onReady(art); });
  return t;
}
export function forgetPicture(id){ canvases.delete(id); thumbs.delete(id); }

// ---------- what a picture is worth ----------
// Looks at the finished picture: how colourful, how bold (contrast), how much detail, and how many
// kinds of edit went into it. Each gives up to 3 stars; the price grows with the stars.
export function appraise(canvas, edits = []){
  const S = 96, c = document.createElement('canvas'); c.width = S; c.height = Math.max(1, Math.round(S * canvas.height / canvas.width));
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(canvas, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height).data, n = c.width * c.height;
  let rgM = 0, ybM = 0, rgS = 0, ybS = 0, lM = 0, lS = 0;
  const L = new Float32Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4){
    const r = d[i], gg = d[i + 1], b = d[i + 2], rg = r - gg, yb = 0.5 * (r + gg) - b;
    rgM += rg; ybM += yb; rgS += rg * rg; ybS += yb * yb;
    L[p] = 0.299 * r + 0.587 * gg + 0.114 * b; lM += L[p]; lS += L[p] * L[p];
  }
  rgM /= n; ybM /= n; lM /= n;
  const sdRG = Math.sqrt(Math.max(0, rgS / n - rgM * rgM)), sdYB = Math.sqrt(Math.max(0, ybS / n - ybM * ybM));
  const colourful = Math.sqrt(sdRG * sdRG + sdYB * sdYB) + 0.3 * Math.sqrt(rgM * rgM + ybM * ybM);   // Hasler & Süsstrunk
  const contrast = Math.sqrt(Math.max(0, lS / n - lM * lM));
  let det = 0; const W = c.width;
  for (let y = 1; y < c.height - 1; y++) for (let x = 1; x < W - 1; x++){ const p = y * W + x; det += Math.abs(4 * L[p] - L[p - 1] - L[p + 1] - L[p - W] - L[p + W]); }
  det /= Math.max(1, (W - 2) * (c.height - 2));
  const star = (v, a, b, cc) => (v >= cc ? 3 : v >= b ? 2 : v >= a ? 1 : 0);
  const stars = { colour: star(colourful, 15, 33, 55), bold: star(contrast, 30, 48, 64), detail: star(det, 6, 13, 22), creative: Math.min(3, edits.length) };
  const total = stars.colour + stars.bold + stars.detail + stars.creative;
  const value = Math.round((20 + total * 8 + total * total * 1.2) / 5) * 5;
  return { value, stars, total, raw: { colourful: Math.round(colourful), contrast: Math.round(contrast), detail: Math.round(det) } };
}
export const STAR_NAMES = { colour: 'Colourful', bold: 'Bold', detail: 'Detail', creative: 'Creative edits' };
export const starText = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);

// ---------- names ----------
const ADJ = { red: ['Crimson', 'Scarlet', 'Ruby', 'Fiery'], orange: ['Amber', 'Tangerine', 'Copper', 'Autumn'], yellow: ['Golden', 'Sunny', 'Lemon', 'Honey'],
  green: ['Emerald', 'Mossy', 'Spring', 'Leafy'], cyan: ['Seaside', 'Teal', 'Glacier', 'Lagoon'], blue: ['Blue', 'Sapphire', 'Midnight', 'Ocean'],
  purple: ['Violet', 'Plum', 'Twilight', 'Lavender'], pink: ['Rosy', 'Candy', 'Blushing', 'Flamingo'], gray: ['Silver', 'Quiet', 'Misty', 'Stone'],
  dark: ['Shadowy', 'Night', 'Secret', 'Velvet'], light: ['Bright', 'Airy', 'Pale', 'Morning'] };
const NOUN = ['Afternoon', 'Dream', 'Study', 'Moment', 'Memory', 'Window', 'Corner', 'Story', 'Song', 'Daydream', 'Adventure', 'Secret', 'Wonder', 'Hour', 'Sketch', 'View', 'Mood', 'Light'];
export function nameFor(canvas, seed = Math.random() * 1e9){
  const S = 32, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(canvas, 0, 0, S, S);
  const d = g.getImageData(0, 0, S, S).data;
  const bins = {}; let lum = 0;
  for (let i = 0; i < d.length; i += 4){
    const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255, mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), l = (mx + mn) / 2, s = mx - mn;
    lum += l;
    let k;
    if (s < 0.12) k = l < 0.25 ? 'dark' : l > 0.8 ? 'light' : 'gray';
    else {
      let h = mx === r ? ((gg - b) / s) % 6 : mx === gg ? (b - r) / s + 2 : (r - gg) / s + 4; h = (h * 60 + 360) % 360;
      k = h < 15 || h >= 340 ? 'red' : h < 40 ? 'orange' : h < 70 ? 'yellow' : h < 160 ? 'green' : h < 195 ? 'cyan' : h < 255 ? 'blue' : h < 300 ? 'purple' : 'pink';
    }
    bins[k] = (bins[k] || 0) + (k === 'gray' ? 0.5 : 1);
  }
  const top = Object.entries(bins).sort((a, b) => b[1] - a[1])[0][0];
  const R = rng(seed >>> 0), pick = (a) => a[Math.floor(R() * a.length)];
  const forms = [() => `${pick(ADJ[top])} ${pick(NOUN)}`, () => `The ${pick(ADJ[top])} ${pick(NOUN)}`, () => `${pick(ADJ[top])} ${pick(NOUN)} No. ${2 + Math.floor(R() * 8)}`];
  return pick(forms)();
}

// ---------- the art market: paintings by other (made-up) artists ----------
export const STYLES = ['blocks', 'grid', 'circles', 'hills', 'waves', 'dots', 'splash', 'stripes', 'sunset', 'flowers'];
const FIRST = ['Mira', 'Theo', 'Juno', 'Felix', 'Iris', 'Oscar', 'Nova', 'Hugo', 'Luna', 'Rafa', 'Ada', 'Kai', 'Zora', 'Milo', 'Esme', 'Otto'];
const LAST = ['Vasquez', 'Lindqvist', 'Okafor', 'Moreau', 'Tanaka', 'Bellini', 'Novak', 'Haddad', 'Quill', 'Ferreira', 'Dubois', 'Kowalski', 'Achebe', 'Sato'];
const STYLE_TITLES = { blocks: ['Fields of Colour', 'Two Moods', 'Glow', 'Untitled (Red)'], grid: ['Composition', 'City Grid', 'Boogie', 'Order'],
  circles: ['Orbits', 'Several Circles', 'Bubbles', 'Planets'], hills: ['Rolling Hills', 'Valley Morning', 'Far Away', 'The Meadow'],
  waves: ['The Wave', 'Tide', 'Ripples', 'Sea Breeze'], dots: ['Confetti', 'Rain of Dots', 'Specks', 'Pointillist Picnic'],
  splash: ['Splash!', 'Drips', 'Energy', 'Action No. 5'], stripes: ['Stripes', 'Rhythm', 'Barcode', 'Sunday Lines'],
  sunset: ['Sunset', 'Evening Sea', 'Last Light', 'Dusk'], flowers: ['Garden', 'Bouquet', 'Wildflowers', 'Blooms'] };
const PALETTES = [
  ['#e63946', '#f1faee', '#a8dadc', '#457b9d', '#1d3557'], ['#ffbe0b', '#fb5607', '#ff006e', '#8338ec', '#3a86ff'],
  ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51'], ['#0b132b', '#1c2541', '#3a506b', '#5bc0be', '#ffffff'],
  ['#f72585', '#7209b7', '#3a0ca3', '#4361ee', '#4cc9f0'], ['#606c38', '#283618', '#fefae0', '#dda15e', '#bc6c25'],
  ['#ffcdb2', '#ffb4a2', '#e5989b', '#b5838d', '#6d6875'], ['#d00000', '#ffba08', '#3f88c5', '#032b43', '#f2f2f2'],
];
export function marketPiece(seed, fame = 0){
  const R = rng(seed), pick = (a) => a[Math.floor(R() * a.length)];
  const style = pick(STYLES);
  const artist = `${pick(FIRST)} ${pick(LAST)}`;
  const value = Math.round((60 + R() * 260 + fame * 4) / 5) * 5;
  return { kind: 'market', seed, style, artist, title: pick(STYLE_TITLES[style]), value };
}
// paint a market picture (always the same for the same seed)
export function paintMarket(style, seed, W = 640){
  const H = Math.round(W * (style === 'grid' || style === 'flowers' ? 1 : 0.75));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), R = rng(seed * 7 + 3), P = PALETTES[Math.floor(R() * PALETTES.length)], col = () => P[Math.floor(R() * P.length)];
  const rr = (a, b) => a + R() * (b - a);
  g.fillStyle = col(); g.fillRect(0, 0, W, H);
  if (style === 'blocks'){
    g.fillStyle = col(); g.fillRect(0, 0, W, H);
    const n = 2 + Math.floor(R() * 2);
    for (let i = 0; i < n; i++){ g.fillStyle = col(); g.globalAlpha = 0.9; const y = H * (0.08 + i * (0.84 / n)); g.fillRect(W * 0.08, y + 6, W * 0.84, H * 0.84 / n - 12); }
    g.globalAlpha = 1;
  } else if (style === 'grid'){
    g.fillStyle = '#f4f1e8'; g.fillRect(0, 0, W, H);
    const xs = [0, rr(0.2, 0.4), rr(0.55, 0.8), 1].map((v) => v * W), ys = [0, rr(0.15, 0.4), rr(0.5, 0.85), 1].map((v) => v * H);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (R() < 0.4){ g.fillStyle = ['#d62828', '#f7c600', '#1d4e9e', '#111'][Math.floor(R() * 4)]; g.fillRect(xs[i], ys[j], xs[i + 1] - xs[i], ys[j + 1] - ys[j]); }
    g.fillStyle = '#111'; const t = W * 0.022;
    for (const x of xs.slice(1, 3)) g.fillRect(x - t / 2, 0, t, H);
    for (const y of ys.slice(1, 3)) g.fillRect(0, y - t / 2, W, t);
  } else if (style === 'circles'){
    for (let i = 0; i < 14; i++){ g.fillStyle = col(); g.globalAlpha = rr(0.5, 0.95); g.beginPath(); g.arc(rr(0, W), rr(0, H), rr(W * 0.03, W * 0.2), 0, 7); g.fill(); if (R() < 0.5){ g.globalAlpha = 1; g.lineWidth = rr(3, 12); g.strokeStyle = col(); g.stroke(); } }
    g.globalAlpha = 1;
  } else if (style === 'hills' || style === 'sunset'){
    const sky = g.createLinearGradient(0, 0, 0, H);
    if (style === 'sunset'){ sky.addColorStop(0, '#2b1055'); sky.addColorStop(0.5, '#d53369'); sky.addColorStop(0.75, '#ffb347'); }
    else { sky.addColorStop(0, '#7ec8ff'); sky.addColorStop(1, '#e8f6ff'); }
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    g.fillStyle = style === 'sunset' ? '#ffe08a' : '#fff6b0'; g.beginPath(); g.arc(rr(0.2, 0.8) * W, H * (style === 'sunset' ? 0.62 : 0.22), W * 0.08, 0, 7); g.fill();
    const greens = style === 'sunset' ? ['#3a1840', '#2a0f30', '#14061c'] : ['#8bc34a', '#4caf50', '#2e7d32'];
    for (let k = 0; k < 3; k++){
      g.fillStyle = greens[k]; g.beginPath(); g.moveTo(0, H);
      const base = H * (0.55 + k * 0.13), a = rr(0.03, 0.09) * H, f = rr(1.5, 4), ph = rr(0, 6);
      for (let x = 0; x <= W; x += 8) g.lineTo(x, base - Math.sin(x / W * f + ph) * a - Math.sin(x / W * f * 2.7) * a * 0.3);
      g.lineTo(W, H); g.fill();
    }
    if (style === 'sunset'){ g.fillStyle = 'rgba(255,220,140,0.5)'; for (let i = 0; i < 6; i++) g.fillRect(W * 0.3 + rr(-40, 40), H * (0.78 + i * 0.035), W * rr(0.1, 0.3), 3); }
  } else if (style === 'waves'){
    for (let k = 0; k < 9; k++){
      g.fillStyle = col(); g.beginPath(); g.moveTo(0, H);
      const base = H * (0.1 + k * 0.1), a = rr(0.02, 0.07) * H, f = rr(2, 6), ph = rr(0, 6);
      for (let x = 0; x <= W; x += 6) g.lineTo(x, base + Math.sin(x / W * f * 6.28 + ph) * a);
      g.lineTo(W, H); g.fill();
    }
  } else if (style === 'dots'){
    g.fillStyle = '#faf6ec'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 900; i++){ g.fillStyle = col(); g.beginPath(); g.arc(rr(0, W), rr(0, H), rr(2, 9), 0, 7); g.fill(); }
  } else if (style === 'splash'){
    g.fillStyle = '#f6f2ea'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 40; i++){
      g.strokeStyle = col(); g.lineWidth = rr(1, 7); g.lineCap = 'round'; g.beginPath();
      let x = rr(0, W), y = rr(0, H); g.moveTo(x, y);
      for (let k = 0; k < 8; k++){ x += rr(-120, 120); y += rr(-90, 90); g.lineTo(x, y); }
      g.stroke();
      g.fillStyle = col(); g.beginPath(); g.arc(rr(0, W), rr(0, H), rr(3, 18), 0, 7); g.fill();
    }
  } else if (style === 'stripes'){
    const n = 6 + Math.floor(R() * 10), vert = R() < 0.6;
    for (let i = 0; i < n; i++){ g.fillStyle = col(); if (vert) g.fillRect(i * W / n, 0, W / n + 1, H); else g.fillRect(0, i * H / n, W, H / n + 1); }
  } else if (style === 'flowers'){
    g.fillStyle = col(); g.fillRect(0, 0, W, H);
    for (let i = 0; i < 9; i++){
      const x = rr(0.1, 0.9) * W, y = rr(0.1, 0.9) * H, r = rr(0.04, 0.09) * W, pc = col();
      g.fillStyle = pc; for (let k = 0; k < 6; k++){ const a = k / 6 * 6.28; g.beginPath(); g.ellipse(x + Math.cos(a) * r, y + Math.sin(a) * r, r * 0.75, r * 0.45, a, 0, 7); g.fill(); }
      g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(x, y, r * 0.5, 0, 7); g.fill();
    }
  }
  // a little canvas texture
  const t = g.getImageData(0, 0, W, H), d = t.data, Rn = rng(seed);
  for (let i = 0; i < d.length; i += 4){ const z = (Rn() - 0.5) * 14; d[i] += z; d[i + 1] += z; d[i + 2] += z; }
  g.putImageData(t, 0, 0);
  return c;
}
