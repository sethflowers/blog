// 🔍 "What it sees": every model the demo has, switched on and off with chips, drawn over the camera.
import { R, timing, status } from '/experiments/camera-magic/js/vision.js';
import { drawObjects, drawHands, drawPose, drawFaceDots, drawMask } from '/experiments/camera-magic/js/draw.js';
import { nameOf, iconOf } from '/experiments/camera-magic/js/labels.js';
import { h, $, save, store } from '/experiments/camera-magic/js/util.js';

const CHIPS = [
  ['objects', '📦 Things'], ['hands', '✋ Hands'], ['face', '🙂 Face'], ['pose', '🧍 Body'], ['segment', '✂️ Cut-out'],
];
const on = new Set(save.spot || ['objects']);

export default {
  id: 'spot', icon: '🔍', name: 'What it sees',
  hint: 'Point the camera at things around you. Switch on hands, face, body and cut-out below.',
  needs(){ return on; },
  bar(){
    return CHIPS.map(([k, label]) => h('button', { class: 'chip' + (on.has(k) ? ' on' : ''), 'data-k': k, onclick: (e) => {
      on.has(k) ? on.delete(k) : on.add(k);
      e.currentTarget.classList.toggle('on', on.has(k));
      save.spot = [...on]; store();
    } }, label));
  },
  enter(){},
  exit(){},
  update(){},
  draw(ctx){
    if (on.has('segment')) drawMask(ctx, R.mask);
    if (on.has('pose')) drawPose(ctx, R.pose);
    if (on.has('face')) drawFaceDots(ctx, R.face);
    if (on.has('hands')) drawHands(ctx, R.hands);
    if (on.has('objects')) drawObjects(ctx, R.objects);
  },
  // a short live summary, refreshed a few times a second (not every frame)
  summary(){
    const bits = [];
    if (on.has('objects')) bits.push(R.objects.length ? R.objects.map((o) => iconOf(o.label) + ' ' + nameOf(o.label)).join(', ') : 'no things spotted');
    if (on.has('hands')) bits.push(R.hands.length + (R.hands.length === 1 ? ' hand' : ' hands'));
    if (on.has('face')) bits.push(R.face ? 'a face' + (R.face.blend.jawOpen > 0.4 ? ' (mouth open!)' : (R.face.blend.mouthSmileLeft > 0.5 ? ' (smiling)' : '')) : 'no face');
    if (on.has('pose')) bits.push(R.pose ? 'a body' : 'no body');
    const ms = [...on].filter((k) => status[k] === 'ready').map((k) => `${k} ${Math.round(timing[k] || 0)} ms`).join(' · ');
    return bits.join(' · ') + (ms ? `\n${ms}` : '');
  },
};
