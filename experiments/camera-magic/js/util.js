// Small helpers shared by every part of Camera Magic.
export const $ = (id) => document.getElementById(id);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export function shuffle(arr){
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export function h(tag, attrs = {}, ...kids){
  const e = document.createElement(tag);
  for (const k in attrs){
    if (k === 'class') e.className = attrs[k];
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
    else if (k === 'html') e.innerHTML = attrs[k];
    else e.setAttribute(k, attrs[k]);
  }
  for (const c of kids) if (c != null) e.append(c);
  return e;
}

// saved settings and best scores (no game progress to lose, but keep it versioned anyway)
const KEY = 'camera-magic-v1';
export const save = (() => {
  let d = {};
  try { d = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { d = {}; }
  d.best = d.best || {};
  d.found = d.found || {};
  return d;
})();
export function store(){ try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) {} }

// one short message at a time under the mode bar (the HUD never rebuilds itself every frame)
let msgTimer = 0;
export function say(text, kind = '', ms = 2600){
  const el = $('msg');
  if (!el) return;
  el.textContent = text;
  el.className = 'show ' + kind;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { el.className = ''; }, ms);
}

// rounded-rectangle path that works everywhere (older Safari has no ctx.roundRect)
export function rrect(ctx, x, y, w, h, r){
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// a label in a pill, readable over any picture
export function pill(ctx, text, x, y, { bg = 'rgba(20,20,40,.82)', fg = '#fff', size = 18, align = 'left' } = {}){
  ctx.font = `800 ${size}px "Avenir Next","Trebuchet MS",system-ui,sans-serif`;
  const w = ctx.measureText(text).width + size * 0.9, hgt = size * 1.55;
  const x0 = align === 'center' ? x - w / 2 : x;
  ctx.fillStyle = bg; rrect(ctx, x0, y, w, hgt, hgt / 2); ctx.fill();
  ctx.fillStyle = fg; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillText(text, x0 + size * 0.45, y + hgt / 2 + 1);
  return { w, h: hgt };
}

// the big line of text at the top of the screen (a clue, a score); only touched when it changes
let bannerHTML = null;
export function banner(html){
  if (html === bannerHTML) return;
  bannerHTML = html;
  const el = $('banner');
  if (!el) return;
  el.innerHTML = html || '';
  el.style.display = html ? 'block' : 'none';
}

// confetti and sparkles, in screen pixels (shared by every mode)
export const bits = [];
export function burst(x, y, n = 30, colours = ['#ff5a7a', '#ffd23a', '#5ad1ff', '#7aff8a', '#c08aff']){
  for (let i = 0; i < n && bits.length < 400; i++){
    const a = Math.random() * 6.283, s = 120 + Math.random() * 380;
    bits.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 200, life: 1 + Math.random() * 0.8, c: colours[i % colours.length], r: 4 + Math.random() * 5, spin: Math.random() * 6 });
  }
}
export function drawBits(ctx, dt){
  for (let i = bits.length - 1; i >= 0; i--){
    const b = bits[i];
    b.life -= dt; if (b.life <= 0){ bits.splice(i, 1); continue; }
    b.vy += 700 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.spin += dt * 8;
    ctx.globalAlpha = Math.min(1, b.life * 2);
    ctx.fillStyle = b.c;
    ctx.fillRect(b.x - b.r, b.y - b.r * Math.abs(Math.cos(b.spin)), b.r * 2, b.r * 2 * Math.abs(Math.cos(b.spin)) + 1);
  }
  ctx.globalAlpha = 1;
}
