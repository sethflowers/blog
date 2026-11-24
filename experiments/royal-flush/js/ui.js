// Screen furniture shared by the game: messages, the celebration, the hand-washing mini-game, the
// panel shell. (The content of the restroom card and the panels lives in main.js.)
import { $, clamp } from './util.js';
import { bubble } from './sound.js';

// ---------- messages at the top: only the new one is added, so nothing replays or flickers ----------
export function toast(text, kind = '', ms = 3200){
  const box = $('msgs'), el = document.createElement('div');
  el.className = 'msg ' + kind; el.innerHTML = text;
  box.appendChild(el);
  while (box.children.length > 2) box.firstChild.remove();
  setTimeout(() => { el.style.transition = 'opacity .4s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 450); }, ms);
}

// ---------- panel shell ----------
export function openPanel(title, html, onClose){
  const p = $('panel');
  p.innerHTML = `<div class="pn"><div class="pn-head"><h2>${title}</h2><button class="x" data-close aria-label="Close">✕</button></div><div class="pn-body">${html}</div></div>`;
  p.classList.add('show');
  p.onclick = (e) => { if (e.target === p || e.target.closest('[data-close]')){ closePanel(); onClose && onClose(); } };
  return p.querySelector('.pn-body');
}
export function closePanel(){ const p = $('panel'); p.classList.remove('show'); p.innerHTML = ''; }
export const panelOpen = () => $('panel').classList.contains('show');

// ---------- celebration: toilet paper streamers and confetti ----------
let partyT = 0;
export function party(big, small, ms = 2200){
  const P = $('party'), cv = $('party-cv'), g = cv.getContext('2d');
  $('party-text').innerHTML = `<b>${big}</b>${small ? `<span>${small}</span>` : ''}`;
  P.classList.add('show');
  const dpr = Math.min(2, devicePixelRatio || 1), W = innerWidth, H = innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const COLS = ['#ffd75a', '#ff5a8a', '#5ac8ff', '#7ae07a', '#c08aff'];
  const bits = [];
  for (let i = 0; i < 70; i++){
    const paper = i < 14;
    bits.push({ x: Math.random() * W, y: -20 - Math.random() * H * 0.6, vy: 120 + Math.random() * 160, vx: (Math.random() - 0.5) * 60,
      a: Math.random() * 6, va: (Math.random() - 0.5) * 6, w: paper ? 16 : 6 + Math.random() * 6, h: paper ? 60 + Math.random() * 50 : 10,
      c: paper ? '#ffffff' : COLS[i % COLS.length], paper, ph: Math.random() * 6 });
  }
  const id = ++partyT, t0 = performance.now();
  let last = t0;
  const step = (t) => {
    if (id !== partyT) return;
    const dt = Math.min(0.05, (t - last) / 1000); last = t;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    for (const b of bits){
      b.y += b.vy * dt; b.x += (b.vx + Math.sin(t / 300 + b.ph) * 40) * dt; b.a += b.va * dt;
      g.save(); g.translate(b.x, b.y); g.rotate(b.paper ? Math.sin(t / 400 + b.ph) * 0.5 : b.a);
      g.fillStyle = b.c;
      if (b.paper){
        // a streamer of toilet paper, with its perforations
        g.shadowColor = 'rgba(0,0,0,.2)'; g.shadowBlur = 4;
        g.beginPath();
        for (let k = 0; k <= 8; k++){ const yy = -b.h / 2 + b.h * k / 8, xx = Math.sin(k * 0.9 + t / 200 + b.ph) * 6; k ? g.lineTo(xx - b.w / 2, yy) : g.moveTo(xx - b.w / 2, yy); }
        for (let k = 8; k >= 0; k--){ const yy = -b.h / 2 + b.h * k / 8, xx = Math.sin(k * 0.9 + t / 200 + b.ph) * 6; g.lineTo(xx + b.w / 2, yy); }
        g.fill(); g.shadowBlur = 0;
        g.strokeStyle = 'rgba(180,180,200,.7)'; g.setLineDash([2, 3]); g.lineWidth = 1;
        for (let k = 1; k < 3; k++){ const yy = -b.h / 2 + b.h * k / 3, xx = Math.sin(k * 2.4 + t / 200 + b.ph) * 6; g.beginPath(); g.moveTo(xx - b.w / 2, yy); g.lineTo(xx + b.w / 2, yy); g.stroke(); }
        g.setLineDash([]);
      } else g.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      g.restore();
    }
    if (t - t0 < ms) requestAnimationFrame(step);
    else { P.classList.remove('show'); g.clearRect(0, 0, W, H); }
  };
  requestAnimationFrame(step);
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- the hand-washing mini-game: scrub the screen for 20 seconds ----------
// Scrubbing only counts while your finger is moving. Resolves with the seconds scrubbed (0–20).
export function wash(){
  return new Promise((resolve) => {
    const W = $('wash'), cv = $('wash-cv'), g = cv.getContext('2d');
    W.classList.add('show');
    const dpr = Math.min(2, devicePixelRatio || 1);
    const size = () => { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; };
    size();
    const bubbles = [];
    let scrubbed = 0, lastMove = -1, last = performance.now(), done = false, finger = null, lastBubble = 0;
    const NEED = 20;
    const move = (e) => {
      const p = { x: e.clientX, y: e.clientY };
      if (finger && Math.hypot(p.x - finger.x, p.y - finger.y) > 3) lastMove = performance.now();
      finger = p;
      if (performance.now() - lastBubble > 30){
        lastBubble = performance.now();
        for (let i = 0; i < 2; i++) bubbles.push({ x: p.x + (Math.random() - 0.5) * 50, y: p.y + (Math.random() - 0.5) * 50, r: 6 + Math.random() * 22, vy: -20 - Math.random() * 50, life: 2 + Math.random() * 2 });
        if (Math.random() < 0.25) bubble();
      }
    };
    const down = (e) => { e.preventDefault(); finger = { x: e.clientX, y: e.clientY }; try { cv.setPointerCapture(e.pointerId); } catch (x) {} };
    const up = () => { finger = null; };
    cv.addEventListener('pointerdown', down); cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up); cv.addEventListener('lostpointercapture', up);
    const finish = () => {
      if (done) return; done = true;
      W.classList.remove('show');
      cv.removeEventListener('pointerdown', down); cv.removeEventListener('pointermove', move);
      cv.removeEventListener('pointerup', up); cv.removeEventListener('pointercancel', up); cv.removeEventListener('lostpointercapture', up);
      $('wash-skip').onclick = null;
      resolve(Math.min(NEED, scrubbed));
    };
    $('wash-skip').onclick = finish;
    wash.scrubFor = (sec) => { scrubbed += sec; };   // for the test
    const step = (t) => {
      if (done) return;
      const dt = Math.min(0.1, (t - last) / 1000); last = t;
      if (lastMove > 0 && t - lastMove < 160) scrubbed += dt;
      const left = Math.max(0, NEED - scrubbed);
      $('wash-time').textContent = left > 0 ? Math.ceil(left) : '✨';
      $('wash-fill').style.width = clamp(scrubbed / NEED * 100, 0, 100) + '%';
      $('wash-skip').textContent = left > 0 ? (scrubbed > 0.5 ? 'Done (partial bonus)' : 'Skip') : 'Squeaky clean!';
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, innerWidth, innerHeight);
      // soap foam builds up as you go
      g.fillStyle = `rgba(255,255,255,${0.08 + 0.25 * scrubbed / NEED})`;
      g.fillRect(0, innerHeight * (1 - scrubbed / NEED * 0.6), innerWidth, innerHeight);
      for (let i = bubbles.length - 1; i >= 0; i--){
        const b = bubbles[i]; b.y += b.vy * dt; b.x += Math.sin(t / 300 + i) * 10 * dt; b.life -= dt;
        if (b.life <= 0){ bubbles.splice(i, 1); continue; }
        g.globalAlpha = Math.min(1, b.life);
        g.beginPath(); g.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        g.fillStyle = 'rgba(255,255,255,.18)'; g.fill(); g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1.5; g.stroke();
        g.beginPath(); g.arc(b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.22, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,.9)'; g.fill();
        g.globalAlpha = 1;
      }
      if (bubbles.length > 260) bubbles.splice(0, bubbles.length - 260);
      if (left <= 0 && !step.end) step.end = t;
      if (step.end && t - step.end > 900) return finish();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
