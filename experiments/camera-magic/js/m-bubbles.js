// 🫧 Bubble pop: bubbles float up over the camera picture; pop them with your real fingertips (the
// hand tracker finds them) or by tapping. Gold bubbles are worth 5; a rainbow one starts a frenzy.
// Rounds of 45 seconds, best score kept.
import { R, TIPS } from '/experiments/camera-magic/js/vision.js';
import { handPoints, glow } from '/experiments/camera-magic/js/draw.js';
import { h, say, banner, burst, rand, save, store } from '/experiments/camera-magic/js/util.js';
import { sfx } from '/experiments/camera-magic/js/audio.js';

const ROUND = 45;
const S = { bubbles: [], score: 0, time: ROUND, over: false, spawn: 0, frenzy: 0, popped: 0, tips: [] };

function start(){ S.bubbles.length = 0; S.score = 0; S.time = ROUND; S.over = false; S.frenzy = 0; S.popped = 0; show(); }
function show(){
  if (S.over) banner(`<b>Time's up!</b> You scored ${S.score} <small>Best ${save.best.bubbles || 0} · tap Play again</small>`);
  else banner(`<b>🫧 ${S.score}</b> <small>${Math.ceil(S.time)} s left${S.frenzy > 0 ? ' · 🌈 FRENZY!' : ''}</small>`);
}

function add(){
  const m = Math.min(innerWidth, innerHeight);
  const roll = Math.random();
  const kind = roll < 0.07 ? 'gold' : roll < 0.1 ? 'rainbow' : 'plain';
  const r = kind === 'plain' ? rand(0.05, 0.09) * m : 0.07 * m;
  S.bubbles.push({ x: rand(r, innerWidth - r), y: innerHeight + r, r, vy: rand(55, 105) * (m / 700), wob: rand(0, 6), kind, hue: rand(0, 360) });
}

function pop(b, i){
  S.bubbles.splice(i, 1);
  S.popped++;
  const pts = b.kind === 'gold' ? 5 : 1;
  S.score += pts;
  if (b.kind === 'gold'){ sfx.gold(); burst(b.x, b.y, 24, ['#ffd23a', '#fff1a0', '#ffb000']); say('+5 Gold bubble!', 'good', 1200); }
  else if (b.kind === 'rainbow'){ sfx.gold(); S.frenzy = 5; burst(b.x, b.y, 40); say('🌈 Bubble frenzy!', 'good', 1500); }
  else { sfx.pop(0.8 + Math.random() * 0.6); burst(b.x, b.y, 10, ['#bfefff', '#ffffff', '#c8b8ff']); }
}

const mode = {
  id: 'bubbles', icon: '🫧', name: 'Bubbles',
  hint: 'Hold a hand up in front of the camera and pop the bubbles with your fingertips (or tap them).',
  needs(){ return new Set(['hands']); },
  bar(){ return [h('button', { class: 'chip', onclick: () => { start(); sfx.click(); } }, '▶ Play again')]; },
  enter(){ start(); },
  exit(){ banner(''); },
  update(dt){
    // fingertips on screen
    S.tips.length = 0;
    for (const hd of R.hands){ const s = handPoints(hd); for (const i of TIPS) S.tips.push(s[i]); }
    if (S.over){ show(); return; }
    S.time -= dt;
    S.frenzy = Math.max(0, S.frenzy - dt);
    if (S.time <= 0){
      S.time = 0; S.over = true;
      if (S.score > (save.best.bubbles || 0)){ save.best.bubbles = S.score; store(); say('New best score! 🏆', 'good', 3000); }
      sfx.found();
    }
    S.spawn -= dt;
    if (S.spawn <= 0 && S.bubbles.length < (S.frenzy > 0 ? 30 : 14)){ add(); S.spawn = S.frenzy > 0 ? 0.12 : rand(0.35, 0.8); }
    for (let i = S.bubbles.length - 1; i >= 0; i--){
      const b = S.bubbles[i];
      b.y -= b.vy * dt * (S.frenzy > 0 ? 1.4 : 1); b.wob += dt * 2; b.x += Math.sin(b.wob) * 20 * dt;
      if (b.y < -b.r){ S.bubbles.splice(i, 1); continue; }
      for (const t of S.tips) if (Math.hypot(t.x - b.x, t.y - b.y) < b.r + 14){ pop(b, i); break; }
    }
    show();
  },
  draw(ctx){
    for (const b of S.bubbles) drawBubble(ctx, b);
    for (const t of S.tips) glow(ctx, t.x, t.y, 22, 'rgba(255,255,255,.95)');
  },
  tap(x, y){
    for (let i = S.bubbles.length - 1; i >= 0; i--){
      const b = S.bubbles[i];
      if (Math.hypot(x - b.x, y - b.y) < b.r + 10){ pop(b, i); return true; }
    }
    return false;
  },
  state: S, start, add,
};
export default mode;

function drawBubble(ctx, b){
  const { x, y, r } = b;
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
  if (b.kind === 'gold'){ g.addColorStop(0, 'rgba(255,250,200,.95)'); g.addColorStop(0.7, 'rgba(255,200,40,.6)'); g.addColorStop(1, 'rgba(255,170,0,.9)'); }
  else if (b.kind === 'rainbow'){ g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(0.5, `hsla(${(b.hue + performance.now() / 5) % 360},100%,65%,.55)`); g.addColorStop(1, `hsla(${(b.hue + 120 + performance.now() / 5) % 360},100%,60%,.9)`); }
  else { g.addColorStop(0, 'rgba(255,255,255,.08)'); g.addColorStop(0.75, `hsla(${b.hue},90%,80%,.16)`); g.addColorStop(0.93, `hsla(${b.hue + 60},90%,75%,.5)`); g.addColorStop(1, 'rgba(255,255,255,.85)'); }
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.beginPath(); ctx.ellipse(x - r * 0.38, y - r * 0.42, r * 0.18, r * 0.1, -0.7, 0, 6.283); ctx.fill();
}
