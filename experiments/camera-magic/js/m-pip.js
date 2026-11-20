// 🐾 Pip: a little 3D critter who lives in the camera picture.
//  - hold up an open hand and Pip hops onto it, and rides along as you move it;
//  - pinch (thumb and finger together) near Pip to pick it up by the scruff; open to drop it;
//  - with no hands about, Pip hops on top of things the object spotter sees ("Ooh, a cup!");
//  - tap Pip to tickle it, tap anywhere else to send it there, 🍓 drops a berry for it to chase.
import * as THREE from 'three';
import { R } from '/experiments/camera-magic/js/vision.js';
import { handPoints, drawObjects } from '/experiments/camera-magic/js/draw.js';
import { boxToScreen } from '/experiments/camera-magic/js/camera.js';
import { getRenderer, addLights, makePip, animatePip } from '/experiments/camera-magic/js/three-layer.js';
import { nameOf, iconOf } from '/experiments/camera-magic/js/labels.js';
import { h, $, say, burst, rand, clamp, dist, pick } from '/experiments/camera-magic/js/util.js';
import { sfx } from '/experiments/camera-magic/js/audio.js';

let scene = null, ocam = null, pip = null;
const S = {
  x: 0, y: 0,                // Pip's feet, screen pixels
  size: 100,
  state: 'idle',             // idle | hop | held | fall
  hop: null,                 // { fx, fy, tx, ty, t, dur, high }
  vy: 0, face: 0, rest: 0,
  target: null, why: '',     // where Pip wants to be, and why ('hand', 'thing', 'tap', 'berry', 'wander')
  berry: null, seen: '', seenT: 0, saidAt: 0,
  speech: '', speechT: 0, showBoxes: true, ready: false,
};

function floorY(){ return innerHeight - Math.max(70, innerHeight * 0.12); }

function build(){
  if (scene) return;
  scene = new THREE.Scene();
  addLights(scene);
  ocam = new THREE.OrthographicCamera(-1, 1, 1, -1, -2000, 2000);
  ocam.position.z = 500;
  pip = makePip();
  scene.add(pip);
}

function speak(text, sec = 2.2){ S.speech = text; S.speechT = sec; }

function hopTo(tx, ty){
  // hops a bit at a time toward the target, in an arc
  const step = S.size * 2.6;
  const dx = tx - S.x, dy = ty - S.y, d = Math.hypot(dx, dy);
  const k = d > step ? step / d : 1;
  const ex = S.x + dx * k, ey = S.y + dy * k;
  S.hop = { fx: S.x, fy: S.y, tx: ex, ty: ey, t: 0, dur: 0.32 + 0.18 * Math.min(1, d / step), high: S.size * (0.35 + Math.max(0, (S.y - ey) / S.size) * 0.25) };
  S.state = 'hop';
  if (Math.abs(dx) > 4) S.face = dx > 0 ? 0.7 : -0.7;
}

// the hands Pip can see: where each palm is, whether it's pinching and where
function readHands(){
  return R.hands.map((hd) => {
    const s = handPoints(hd);
    const size = dist(s[0], s[9]) || 1;
    const pinch = dist(s[4], s[8]) < size * 0.38;
    const palm = { x: (s[0].x + s[5].x + s[17].x) / 3, y: (s[0].y + s[5].y + s[17].y) / 3 };
    return { pinch, at: { x: (s[4].x + s[8].x) / 2, y: (s[4].y + s[8].y) / 2 }, palm, size, open: !pinch };
  });
}

const mode = {
  id: 'pip', icon: '🐾', name: 'Pip',
  hint: 'Hold out an open hand for Pip to hop on, pinch to pick Pip up, or show Pip things to sit on.',
  three: true,
  needs(){ return new Set(['hands', 'objects']); },
  bar(){
    return [
      h('button', { class: 'chip', onclick: () => { S.berry = { x: rand(innerWidth * 0.15, innerWidth * 0.85), y: rand(innerHeight * 0.3, floorY()), t: 0 }; speak('A berry! 🍓'); sfx.click(); } }, '🍓 Berry'),
      h('button', { class: 'chip', onclick: () => { S.state = 'idle'; S.x = innerWidth / 2; S.y = floorY(); S.vy = 0; S.hop = null; S.target = null; speak('Here I am!'); sfx.boing(); } }, '🏠 Come back'),
      h('button', { class: 'chip on', onclick: (e) => { S.showBoxes = !S.showBoxes; e.currentTarget.classList.toggle('on', S.showBoxes); } }, '📦 Show what Pip sees'),
    ];
  },
  enter(){
    build();
    S.size = Math.min(innerWidth, innerHeight) * 0.15;
    if (!S.ready){ S.x = innerWidth / 2; S.y = floorY(); S.ready = true; speak('Hi! I\'m Pip!', 2.5); }
  },
  exit(){ $('speech').style.display = 'none'; const r = getRenderer(); r.setClearColor(0, 0); r.clear(); },
  update(dt){
    S.size = Math.min(innerWidth, innerHeight) * 0.15;
    const hands = readHands();
    const fl = floorY();
    S.speechT -= dt; S.rest -= dt;

    // picked up / let go
    if (S.state === 'held'){
      const holder = hands.find((hd) => hd.pinch && dist(hd.at, { x: S.x, y: S.y - S.size * 1.1 }) < S.size * 1.6);
      if (holder){ S.x = holder.at.x; S.y = holder.at.y + S.size * 1.1; }
      else { S.state = 'fall'; S.vy = 0; speak('Wheee!', 1.2); }
    } else {
      const grab = hands.find((hd) => hd.pinch && dist(hd.at, { x: S.x, y: S.y - S.size * 0.5 }) < S.size * 0.9);
      if (grab){ S.state = 'held'; S.hop = null; sfx.giggle(); speak('Hee hee, put me down!', 1.8); pip.userData.happy = 1.2; }
    }

    // choose where to be (when not busy)
    if (S.state !== 'held'){
      const open = hands.filter((hd) => hd.open).sort((a, b) => b.size - a.size)[0];
      const things = R.objects.filter((o) => o.score > 0.4).sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h);
      if (S.berry){ S.target = { x: S.berry.x, y: S.berry.y }; S.why = 'berry'; }
      else if (open){ S.target = { x: open.palm.x, y: open.palm.y }; S.why = 'hand'; }
      else if (things.length){
        const o = things[0], r = boxToScreen(o.box);
        S.target = { x: clamp(r.x + r.w / 2, S.size, innerWidth - S.size), y: clamp(r.y + Math.min(8, r.h * 0.05), S.size * 2, fl) };
        S.why = 'thing';
        if (o.label !== S.seen && performance.now() - S.saidAt > 2500){
          S.seen = o.label; S.saidAt = performance.now();
          speak(pick(['Ooh, ', 'Look, ', 'Wow, ']) + (/^[aeiou]/i.test(nameOf(o.label)) ? 'an ' : 'a ') + nameOf(o.label) + '! ' + iconOf(o.label));
        }
      } else if (S.why !== 'tap' || !S.target){
        if (!S.target || S.why !== 'wander' || S.rest < -4){ S.target = { x: rand(innerWidth * 0.2, innerWidth * 0.8), y: fl }; S.why = 'wander'; S.rest = 0; }
      }
    }

    // move
    if (S.state === 'hop'){
      const p = S.hop; p.t += dt;
      const k = Math.min(1, p.t / p.dur);
      S.x = p.fx + (p.tx - p.fx) * k;
      S.y = p.fy + (p.ty - p.fy) * k - Math.sin(k * Math.PI) * p.high;
      if (k >= 1){ S.state = 'idle'; S.rest = S.why === 'wander' ? rand(0.4, 1.4) : 0.05; }
    } else if (S.state === 'fall'){
      S.vy += 2600 * dt; S.y += S.vy * dt;
      if (S.y >= fl){ S.y = fl; S.state = 'idle'; S.vy = 0; sfx.boing(); }
    } else if (S.state === 'idle' && S.target && S.rest <= 0){
      const d = dist(S, S.target);
      if (d > S.size * 0.25) hopTo(S.target.x, S.target.y);
      else {
        // arrived
        if (S.why === 'berry' && S.berry){ S.berry = null; speak('Yum! 😋', 1.5); sfx.giggle(); pip.userData.happy = 1; burst(S.x, S.y - S.size * 0.6, 14, ['#ff4a6a', '#7aff8a']); }
        else if (S.why === 'hand' && S.speechT < -3){ speak(pick(['Your hand is comfy!', 'Wheee, a ride!', 'Hello up here!']), 1.8); }
        if (S.why === 'hand'){ S.x = S.target.x; S.y = S.target.y; }   // ride along with the hand
        S.face *= 0.9;
        if (S.why === 'tap') S.why = '';
      }
    } else if (S.state === 'idle' && !S.target){
      if (S.y < fl - 2){ S.state = 'fall'; }
    }
    // nothing to stand on and not on a hand or a thing: drop to the floor
    if (S.state === 'idle' && S.why !== 'hand' && S.why !== 'thing' && S.why !== 'berry' && S.why !== 'tap' && S.y < fl - 2){ S.state = 'fall'; }
    S.x = clamp(S.x, S.size * 0.6, innerWidth - S.size * 0.6);
    S.y = clamp(S.y, S.size * 1.5, fl);
    if (S.berry) S.berry.t += dt;

    // place the 3D Pip
    const W = innerWidth, H = innerHeight;
    ocam.left = -W / 2; ocam.right = W / 2; ocam.top = H / 2; ocam.bottom = -H / 2; ocam.updateProjectionMatrix();
    pip.position.set(S.x - W / 2, H / 2 - S.y, 0);
    pip.scale.setScalar(S.size);
    pip.rotation.set(0.18, pip.rotation.y + (S.face - pip.rotation.y) * Math.min(1, dt * 8), S.state === 'held' ? Math.sin(performance.now() / 180) * 0.25 : 0);
    const look = hands[0] ? { x: clamp((hands[0].palm.x - S.x) / 300, -1, 1), y: clamp((S.y - S.size - hands[0].palm.y) / 300, -1, 1) } : null;
    animatePip(pip, dt, { speed: S.state === 'hop' ? 1 : 0, hop: 0, look });

    // speech bubble (HTML, only touched when it changes)
    const sp = $('speech');
    if (S.speechT > 0){
      if (sp.textContent !== S.speech) sp.textContent = S.speech;
      sp.style.display = 'block';
      sp.style.transform = `translate(${Math.round(S.x)}px, ${Math.round(S.y - S.size * 1.45)}px) translate(-50%, -100%)`;
    } else if (sp.style.display !== 'none') sp.style.display = 'none';
  },
  draw(ctx){
    if (S.showBoxes) drawObjects(ctx, R.objects, { faint: true });
    // Pip's shadow (drawn under the 3D layer)
    if (S.state !== 'held'){
      ctx.fillStyle = 'rgba(0,0,0,.25)';
      ctx.beginPath(); ctx.ellipse(S.x, S.y + 2, S.size * 0.45, S.size * 0.12, 0, 0, 6.283); ctx.fill();
    }
    if (S.berry){
      ctx.font = `${Math.round(S.size * 0.45)}px system-ui,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText('🍓', S.berry.x, S.berry.y - Math.abs(Math.sin(S.berry.t * 5)) * 8);
    }
    const r = getRenderer();
    r.render(scene, ocam);
  },
  tap(x, y){
    if (dist({ x, y }, { x: S.x, y: S.y - S.size * 0.5 }) < S.size * 0.7){
      sfx.giggle(); pip.userData.happy = 1.5; speak(pick(['Hee hee!', 'That tickles!', 'Again!']), 1.5);
      burst(S.x, S.y - S.size, 12, ['#ff7ab0', '#ffd23a']);
      if (S.state === 'idle') { S.hop = { fx: S.x, fy: S.y, tx: S.x, ty: S.y, t: 0, dur: 0.45, high: S.size * 0.8 }; S.state = 'hop'; }
      return true;
    }
    S.target = { x, y: Math.min(y, floorY()) }; S.why = 'tap'; S.berry = null;
    return true;
  },
  state: S, get pip(){ return pip; },
};
export default mode;
