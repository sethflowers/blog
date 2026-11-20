// 🎩 Dress up: hats, glasses, a clown nose, cat ears and whiskers or a moustache that follow your face
// (the face tracker finds 478 points on it), and a backdrop that swaps everything behind you (the
// cut-out tool). Open your mouth wide for sparkles; wink for a star. Best with the selfie camera.
import { R } from '/experiments/camera-magic/js/vision.js';
import { toScreen, drawCovering, cam } from '/experiments/camera-magic/js/camera.js';
import { personLayer } from '/experiments/camera-magic/js/draw.js';
import { h, burst, bits, save, store, rand } from '/experiments/camera-magic/js/util.js';
import { sfx } from '/experiments/camera-magic/js/audio.js';

const ITEMS = [['crown', '👑 Crown'], ['party', '🎉 Party hat'], ['shades', '🕶 Shades'], ['nose', '🔴 Clown nose'], ['cat', '🐱 Cat'], ['tache', '🥸 Moustache']];
const BACKS = [['none', '🚫 No backdrop'], ['space', '🌌 Space'], ['beach', '🏖 Beach'], ['sea', '🐠 Under the sea'], ['rainbow', '🌈 Rainbow']];
const S = { on: new Set(save.dress || ['crown']), back: save.back || 'none', backCanvas: null, backKey: '', winkT: 0, sparkT: 0 };

const mode = {
  id: 'dress', icon: '🎩', name: 'Dress up',
  hint: 'Look at the selfie camera. Pick hats and things below; open your mouth wide for sparkles!',
  camera: 'user',
  needs(){ const n = new Set(['face']); if (S.back !== 'none') n.add('segment'); return n; },
  bar(){
    const items = ITEMS.map(([k, label]) => h('button', { class: 'chip' + (S.on.has(k) ? ' on' : ''), onclick: (e) => {
      S.on.has(k) ? S.on.delete(k) : S.on.add(k);
      e.currentTarget.classList.toggle('on', S.on.has(k)); sfx.click();
      save.dress = [...S.on]; store();
    } }, label));
    const backs = BACKS.map(([k, label]) => h('button', { class: 'chip back' + (S.back === k ? ' on' : ''), 'data-back': k, onclick: (e) => {
      S.back = k; save.back = k; store(); sfx.click();
      for (const b of e.currentTarget.parentNode.querySelectorAll('.back')) b.classList.toggle('on', b.dataset.back === k);
    } }, label));
    return [...items, h('span', { class: 'sep' }), ...backs];
  },
  enter(){}, exit(){},
  update(dt){
    S.winkT -= dt; S.sparkT -= dt;
    const f = R.face;
    if (!f) return;
    const b = f.blend;
    if ((b.jawOpen || 0) > 0.35 && S.sparkT <= 0){
      const m = mid(toScreen(f.pts[13].x, f.pts[13].y), toScreen(f.pts[14].x, f.pts[14].y));
      burst(m.x, m.y, 4, ['#fff6a0', '#ffffff', '#a0f0ff', '#ffb0f0']);
      for (let i = bits.length - 4; i < bits.length; i++) if (bits[i]){ bits[i].vy = rand(-500, -250); bits[i].vx = rand(-160, 160); }
      sfx.sparkle(); S.sparkT = 0.05;
    }
    const wl = b.eyeBlinkLeft || 0, wr = b.eyeBlinkRight || 0;
    if (Math.abs(wl - wr) > 0.45 && Math.max(wl, wr) > 0.55 && S.winkT <= 0){
      const eye = wl > wr ? f.pts[473] || f.pts[263] : f.pts[468] || f.pts[33];
      const p = toScreen(eye.x, eye.y);
      burst(p.x, p.y, 16, ['#ffd23a', '#fff']); sfx.gold(); S.winkT = 1.2;
    }
  },
  draw(ctx){
    if (S.back !== 'none' && R.mask){
      drawBackdrop(ctx);
      const p = personLayer(R.mask);
      if (p) drawCovering(ctx, p);
    }
    const f = R.face;
    if (!f) return;
    const P = (i) => toScreen(f.pts[i].x, f.pts[i].y);
    let L = P(33), Rr = P(263);
    if (L.x > Rr.x){ const t = L; L = Rr; Rr = t; }
    const ang = Math.atan2(Rr.y - L.y, Rr.x - L.x);
    const eye = Math.hypot(Rr.x - L.x, Rr.y - L.y);     // eye corner to eye corner: the size of everything
    const k = eye / 100;
    const at = (p, fn) => { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(ang); ctx.scale(k, k); fn(); ctx.restore(); };
    const top = P(10), nose = P(1), lipTop = P(0), noseBase = P(2);
    if (S.on.has('cat')) at(top, () => catEars(ctx));
    if (S.on.has('crown')) at(top, () => crown(ctx));
    if (S.on.has('party')) at(top, () => partyHat(ctx));
    if (S.on.has('shades')) at(mid(L, Rr), () => shades(ctx));
    if (S.on.has('tache')) at(mid(noseBase, lipTop), () => tache(ctx));
    if (S.on.has('cat')) at(nose, () => catNose(ctx));
    if (S.on.has('nose')) at(nose, () => clownNose(ctx));
  },
  state: S,
};
export default mode;

function mid(a, b){ return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

// ---- the costume pieces, drawn in a space where the eyes are 100 units apart, +y down ----
function crown(ctx){
  ctx.translate(0, -18);
  ctx.beginPath();
  ctx.moveTo(-75, 0); ctx.lineTo(-85, -80); ctx.lineTo(-45, -40); ctx.lineTo(0, -100); ctx.lineTo(45, -40); ctx.lineTo(85, -80); ctx.lineTo(75, 0); ctx.closePath();
  const g = ctx.createLinearGradient(0, -100, 0, 0); g.addColorStop(0, '#fff08a'); g.addColorStop(1, '#e0a010');
  ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = '#9a6a00'; ctx.stroke();
  for (const [x, y, c] of [[-85, -80, '#ff3a5a'], [0, -100, '#3a8aff'], [85, -80, '#3ad07a']]){ ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, 10, 0, 6.283); ctx.fill(); }
  for (const [x, c] of [[-40, '#ff3a5a'], [0, '#3ad07a'], [40, '#3a8aff']]){ ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(x, -18, 9, 12, 0, 0, 6.283); ctx.fill(); }
}
function partyHat(ctx){
  ctx.translate(30, -10); ctx.rotate(0.25);
  ctx.save();
  ctx.beginPath(); ctx.moveTo(-55, 0); ctx.lineTo(0, -160); ctx.lineTo(55, 0); ctx.closePath();
  ctx.fillStyle = '#ff5aa0'; ctx.fill(); ctx.clip();
  ctx.fillStyle = '#ffe14a';
  for (let y = -150; y < 10; y += 40){ ctx.beginPath(); ctx.moveTo(-80, y); ctx.lineTo(80, y - 30); ctx.lineTo(80, y - 14); ctx.lineTo(-80, y + 16); ctx.fill(); }
  ctx.restore();
  ctx.fillStyle = '#5ad1ff'; for (let i = 0; i < 7; i++){ ctx.beginPath(); ctx.arc(-50 + i * 16.6, 0, 9, 0, 6.283); ctx.fill(); }
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, -165, 16, 0, 6.283); ctx.fill();
}
function shades(ctx){
  ctx.fillStyle = '#111'; ctx.strokeStyle = '#111'; ctx.lineWidth = 8;
  for (const sx of [-1, 1]){
    ctx.beginPath(); ctx.ellipse(sx * 33, 2, 36, 25, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = 'rgba(120,160,255,.45)'; ctx.beginPath(); ctx.ellipse(sx * 33 - 12, -6, 12, 6, -0.4, 0, 6.283); ctx.fill(); ctx.fillStyle = '#111';
  }
  ctx.beginPath(); ctx.moveTo(-6, -4); ctx.quadraticCurveTo(0, -12, 6, -4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-68, -4); ctx.lineTo(-92, -10); ctx.moveTo(68, -4); ctx.lineTo(92, -10); ctx.stroke();
}
function clownNose(ctx){
  const g = ctx.createRadialGradient(-6, -8, 2, 0, 0, 24);
  g.addColorStop(0, '#ff9a9a'); g.addColorStop(0.4, '#ff2020'); g.addColorStop(1, '#a00000');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 24, 0, 6.283); ctx.fill();
}
function catEars(ctx){
  for (const sx of [-1, 1]){
    ctx.save(); ctx.translate(sx * 62, -10); ctx.rotate(sx * 0.35);
    ctx.fillStyle = '#5a4030'; ctx.beginPath(); ctx.moveTo(-34, 10); ctx.lineTo(0, -75); ctx.lineTo(34, 10); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ff9ec0'; ctx.beginPath(); ctx.moveTo(-18, 4); ctx.lineTo(0, -48); ctx.lineTo(18, 4); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}
function catNose(ctx){
  ctx.fillStyle = '#ff7aa8'; ctx.beginPath(); ctx.moveTo(-10, -4); ctx.lineTo(10, -4); ctx.lineTo(0, 8); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(30,20,20,.85)'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  for (const sx of [-1, 1]) for (const dy of [-8, 4, 16]){ ctx.beginPath(); ctx.moveTo(sx * 22, 10); ctx.lineTo(sx * 80, 10 + dy * 1.6); ctx.stroke(); }
}
function tache(ctx){
  ctx.fillStyle = '#3a2414';
  ctx.beginPath();
  ctx.moveTo(0, -4);
  ctx.bezierCurveTo(18, -16, 42, -10, 50, 4); ctx.bezierCurveTo(58, 16, 70, 10, 72, 2);
  ctx.bezierCurveTo(74, 22, 50, 26, 36, 14); ctx.bezierCurveTo(24, 6, 10, 10, 0, 12);
  ctx.bezierCurveTo(-10, 10, -24, 6, -36, 14); ctx.bezierCurveTo(-50, 26, -74, 22, -72, 2);
  ctx.bezierCurveTo(-70, 10, -58, 16, -50, 4); ctx.bezierCurveTo(-42, -10, -18, -16, 0, -4);
  ctx.fill();
}

// ---- backdrops, drawn once at screen size and reused ----
function drawBackdrop(ctx){
  const key = S.back + innerWidth + 'x' + innerHeight;
  if (S.backKey !== key){
    S.backKey = key;
    const c = S.backCanvas || (S.backCanvas = document.createElement('canvas'));
    c.width = innerWidth; c.height = innerHeight;
    paint(c.getContext('2d'), S.back, c.width, c.height);
  }
  ctx.drawImage(S.backCanvas, 0, 0, innerWidth, innerHeight);
}
function paint(g, kind, W, H){
  const lin = (stops) => { const gr = g.createLinearGradient(0, 0, 0, H); stops.forEach(([o, c]) => gr.addColorStop(o, c)); return gr; };
  // the same picture every time: a fixed seed
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  if (kind === 'space'){
    g.fillStyle = lin([[0, '#05051a'], [1, '#1a0a3a']]); g.fillRect(0, 0, W, H);
    for (let i = 0; i < 400; i++){ g.fillStyle = `rgba(255,255,255,${0.3 + rnd() * 0.7})`; const r = rnd() * 1.8 + 0.3; g.beginPath(); g.arc(rnd() * W, rnd() * H, r, 0, 6.283); g.fill(); }
    const pr = Math.min(W, H) * 0.18, px = W * 0.8, py = H * 0.25;
    const pg = g.createRadialGradient(px - pr * 0.4, py - pr * 0.4, pr * 0.1, px, py, pr); pg.addColorStop(0, '#ffcf8a'); pg.addColorStop(1, '#b0502a');
    g.fillStyle = pg; g.beginPath(); g.arc(px, py, pr, 0, 6.283); g.fill();
    g.strokeStyle = 'rgba(255,220,170,.7)'; g.lineWidth = pr * 0.08; g.beginPath(); g.ellipse(px, py, pr * 1.6, pr * 0.35, -0.3, 0, 6.283); g.stroke();
  } else if (kind === 'beach'){
    g.fillStyle = lin([[0, '#4ab0ff'], [0.55, '#bfe8ff'], [0.56, '#1a8ad0'], [0.72, '#46c0e0'], [0.73, '#f4dca0'], [1, '#e8c47a']]); g.fillRect(0, 0, W, H);
    g.fillStyle = '#fff36a'; g.beginPath(); g.arc(W * 0.18, H * 0.18, Math.min(W, H) * 0.09, 0, 6.283); g.fill();
    g.fillStyle = 'rgba(255,255,255,.9)';
    for (let i = 0; i < 4; i++){ const x = rnd() * W, y = rnd() * H * 0.35; for (let j = 0; j < 4; j++){ g.beginPath(); g.arc(x + j * 30, y + (j % 2) * 8, 26, 0, 6.283); g.fill(); } }
  } else if (kind === 'sea'){
    g.fillStyle = lin([[0, '#2ac0e0'], [1, '#04305a']]); g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,.25)';
    for (let i = 0; i < 40; i++){ g.beginPath(); g.arc(rnd() * W, rnd() * H, 3 + rnd() * 12, 0, 6.283); g.fill(); }
    g.font = `${Math.round(Math.min(W, H) * 0.08)}px system-ui,sans-serif`; g.textAlign = 'center';
    for (const f of ['🐠', '🐟', '🐡', '🐙', '🦀', '🐠']) g.fillText(f, rnd() * W, H * 0.15 + rnd() * H * 0.8);
  } else if (kind === 'rainbow'){
    g.fillStyle = lin([[0, '#9ad8ff'], [1, '#e8f6ff']]); g.fillRect(0, 0, W, H);
    const cols = ['#ff3a3a', '#ff9a2a', '#ffe02a', '#4ad04a', '#3a8aff', '#7a4aff'], R0 = Math.max(W, H) * 0.55, bw = R0 * 0.07;
    cols.forEach((c, i) => { g.strokeStyle = c; g.lineWidth = bw; g.beginPath(); g.arc(W / 2, H * 1.05, R0 - i * bw, Math.PI, 0); g.stroke(); });
  }
}
