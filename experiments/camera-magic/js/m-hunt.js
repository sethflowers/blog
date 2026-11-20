// 🧭 Scavenger hunt: a clue at the top ("Something you can drink from"); point the camera at something
// that fits and hold it steady for a moment. Six clues a hunt; skip any you can't find.
import { R } from '/experiments/camera-magic/js/vision.js';
import { drawObjects } from '/experiments/camera-magic/js/draw.js';
import { boxToScreen } from '/experiments/camera-magic/js/camera.js';
import { CLUES, nameOf, iconOf } from '/experiments/camera-magic/js/labels.js';
import { h, say, banner, burst, shuffle, save, store } from '/experiments/camera-magic/js/util.js';
import { sfx } from '/experiments/camera-magic/js/audio.js';

const ROUND = 6, HOLD = 0.6, MIN_SCORE = 0.45;
const S = { clues: [], i: 0, found: [], hold: 0, holdBox: null, cheer: 0, done: false };

function newHunt(){
  S.clues = shuffle(CLUES).slice(0, ROUND); S.i = 0; S.found = []; S.hold = 0; S.cheer = 0; S.done = false;
  show();
}
function clue(){ return S.clues[S.i]; }
function show(){
  if (S.done){
    const n = S.found.length;
    banner(`<b>Hunt over!</b> You found ${n} of ${ROUND} ${'⭐'.repeat(Math.max(1, Math.round(n / 2)))}<small>${S.found.map((l) => iconOf(l)).join(' ') || 'Try again with New hunt'}</small>`);
    return;
  }
  const c = clue();
  banner(`<span class="big">${c.icon}</span> <b>${c.text}</b><small>Clue ${S.i + 1} of ${ROUND} · found ${S.found.length}</small>`);
}
function next(){
  S.i++; S.hold = 0;
  if (S.i >= ROUND){
    S.done = true;
    save.best.hunt = Math.max(save.best.hunt || 0, S.found.length); store();
    sfx.gold();
  }
  show();
}

const mode = {
  id: 'hunt', icon: '🧭', name: 'Hunt',
  hint: 'Read the clue, find it, and hold the camera on it until the ring fills.',
  needs(){ return new Set(['objects']); },
  bar(){
    return [
      h('button', { class: 'chip', onclick: () => { if (S.done) return; say(`Skipped. It could have been: ${clue().any.map(nameOf).join(', ')}`); sfx.click(); next(); } }, '⏭ Skip'),
      h('button', { class: 'chip', onclick: () => { if (!S.done) say(`It can see: ${clue().any.map((l) => iconOf(l) + ' ' + nameOf(l)).join(', ')}`, '', 4000); } }, '💡 Hint'),
      h('button', { class: 'chip', onclick: () => { newHunt(); sfx.click(); } }, '🔁 New hunt'),
    ];
  },
  enter(){ if (!S.clues.length) newHunt(); else show(); },
  exit(){ banner(''); },
  update(dt){
    if (S.done) return;
    S.cheer = Math.max(0, S.cheer - dt);
    const want = clue().any;
    const hit = R.objects.filter((o) => want.includes(o.label) && o.score >= MIN_SCORE).sort((a, b) => b.score - a.score)[0];
    if (hit){
      S.hold += dt; S.holdBox = hit;
      if (S.hold >= HOLD){
        const r = boxToScreen(hit.box);
        burst(r.x + r.w / 2, r.y + r.h / 2, 60);
        sfx.found();
        S.found.push(hit.label);
        save.found[hit.label] = (save.found[hit.label] || 0) + 1; store();
        say(`You found ${/^[aeiou]/i.test(nameOf(hit.label)) ? 'an' : 'a'} ${nameOf(hit.label)}! ${iconOf(hit.label)}`, 'good', 3000);
        next();
      }
    } else { S.hold = Math.max(0, S.hold - dt * 2); if (!S.hold) S.holdBox = null; }
  },
  draw(ctx){
    drawObjects(ctx, R.objects, { faint: true, highlight: S.done ? null : clue().any });
    if (S.holdBox && S.hold > 0 && !S.done){
      const r = boxToScreen(S.holdBox.box);
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rad = Math.max(30, Math.min(r.w, r.h) * 0.25);
      ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(0,0,0,.35)';
      ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 6.283); ctx.stroke();
      ctx.strokeStyle = '#ffe14a';
      ctx.beginPath(); ctx.arc(cx, cy, rad, -Math.PI / 2, -Math.PI / 2 + 6.283 * Math.min(1, S.hold / HOLD)); ctx.stroke();
    }
  },
  // for tests
  state: S, newHunt,
  setClue(labels){ S.clues[S.i] = { text: 'Test clue', icon: '🧪', any: labels }; S.done = false; show(); },
};
export default mode;
