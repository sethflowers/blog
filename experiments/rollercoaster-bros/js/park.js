// The park: flat grass as far as you can see (no trees), the station, the queue, the paths and the
// entrance gate; the visitors who come to ride; and your money.
import * as THREE from 'three';
import { V, clamp, lerp, rng, merge, placed, noiseTexture, textCanvas, roundRect } from './util.js';
import { CAR_GAP, PARK } from './train.js';

export const SAVE_KEY = 'rollercoaster-bros-save';
export const START_MONEY = 200;

// ---------- the places ----------
const QUEUE = [[10.8, 0, 12], [10.8, 0, 8.6], [9.6, 0, 8.6], [9.6, 0, -2], [8.2, 0, -2], [8.2, 0, 8.6], [6.8, 0, 8.6], [6.8, 0, -2], [5.4, 0, -2], [5.4, 0, 5], [4.4, 0.55, 5], [3.0, 0.55, 3.5]];
const ENTRY = [[9.4, 0, 31], [10.8, 0, 22], [10.8, 0, 12]];
const EXIT = [[3.0, 0.55, -8.2], [4.6, 0.55, -10.2], [8, 0, -12], [14, 0, -12], [14, 0, 20], [12.4, 0, 31], [12.4, 0, 40]];
const SPAWN = V(9.4, 0, 40);

// queue positions measured along the queue line from its front
const qPts = QUEUE.map((p) => V(...p)).reverse();
const qLen = [0]; for (let i = 1; i < qPts.length; i++) qLen.push(qLen[i - 1] + qPts[i].distanceTo(qPts[i - 1]));
function queueSpot(d, out = V()){
  for (let i = 1; i < qPts.length; i++) if (d <= qLen[i] || i === qPts.length - 1){ const f = clamp((d - qLen[i - 1]) / (qLen[i] - qLen[i - 1])); return out.copy(qPts[i - 1]).lerp(qPts[i], f); }
  return out.copy(qPts[0]);
}
const QUEUE_GAP = 0.8, QUEUE_MAX = Math.floor(qLen[qLen.length - 1] / QUEUE_GAP);

// ---------- scenery ----------
export function buildPark(scene){
  const grassTex = noiseTexture(256, 0x5a9a3a, 0.12, 3, 160);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

  const groups = new Map();
  const add = (mat, g) => { if (!groups.has(mat)) groups.set(mat, []); groups.get(mat).push(g); };
  const M = (c, r = 0.8, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
  const paving = new THREE.MeshStandardMaterial({ map: noiseTexture(128, 0xc8b89a, 0.08, 5, 1), roughness: 0.9 });
  paving.map.repeat.set(1, 1);
  const concrete = M(0xb8b4ac, 0.85), wood = M(0x8a5a32, 0.8), white = M(0xf4f2ec, 0.6), red = M(0xd83a2a, 0.6), yellow = M(0xf4c430, 0.6), blue = M(0x2a6ad8, 0.6), dark = M(0x2a2a30, 0.5, 0.5), metal = M(0xc8ccd4, 0.35, 0.8);
  const B = new THREE.BoxGeometry(1, 1, 1);
  const box = (mat, x, y, z, sx, sy, sz, ry = 0) => add(mat, placed(B, x, y, z, 0, ry, 0, sx, sy, sz));
  const C = new THREE.CylinderGeometry(1, 1, 1, 10);
  const cyl = (mat, x, y, z, r, h) => add(mat, placed(C, x, y, z, 0, 0, 0, r, h, r));

  // paths: a strip under every leg of the walking routes
  const strip = (pts, w) => { for (let i = 1; i < pts.length; i++){ const a = V(...pts[i - 1]), b = V(...pts[i]); const len = a.distanceTo(b) + w; const m = a.clone().add(b).multiplyScalar(0.5); box(paving, m.x, 0.02, m.z, w, 0.04, len, Math.atan2(b.x - a.x, b.z - a.z)); } };
  strip([[9.4, 0, 46], ...ENTRY], 2.6);
  strip(EXIT.slice(2), 2.6);
  box(paving, 8.6, 0.02, 3.3, 7.4, 0.04, 14.2);     // under the queue
  box(paving, 11, 0.02, 38, 9, 0.04, 10);           // the plaza by the gate

  // the station platform and its roof
  box(concrete, 2.55, 0.275, 0, 2.9, 0.55, 18.4);
  box(yellow, 1.16, 0.56, 0, 0.12, 0.02, 18.4);     // the yellow line at the edge
  box(concrete, 4.6, 0.275, -10.4, 2.2, 0.55, 3);   // steps down to the exit
  for (const z of [-9, -3, 3, 9]) for (const x of [-1.5, 4.2]) cyl(white, x, 2.3, z, 0.14, 4.6);
  box(red, 1.35, 4.75, 0, 6.8, 0.3, 19.2);
  for (let k = 0; k < 8; k++) box(k % 2 ? white : red, 1.35, 5.0, -8.4 + k * 2.4, 6.4, 0.22, 2.4);
  // queue rails
  for (const x of [6.1, 7.5, 8.9, 10.3]) { box(metal, x, 0.9, 3.1 + (x === 6.1 || x === 8.9 ? 0.7 : -0.7), 0.06, 0.06, 9.2); for (let z = -1.4; z <= 8; z += 2.4) cyl(metal, x, 0.45, z + (x === 6.1 || x === 8.9 ? 0.7 : -0.7), 0.05, 0.9); }
  box(metal, 8.2, 0.9, 9.3, 5.6, 0.06, 0.06); box(metal, 8.2, 0.9, -2.7, 6, 0.06, 0.06);
  // the entrance gate (an arch) and a few benches, lamps and flower beds
  for (const x of [6.2, 15.6]){ box(red, x, 3, 44, 0.8, 6, 0.8); box(yellow, x, 6.2, 44, 1.1, 0.4, 1.1); }
  box(blue, 10.9, 6.6, 44, 10.6, 1.4, 0.5);
  for (const [x, z, ry] of [[7.6, 18, Math.PI / 2], [7.6, 26, Math.PI / 2], [16.2, 8, -Math.PI / 2], [16.2, 0, -Math.PI / 2]]){
    box(wood, x, 0.45, z, 1.8, 0.08, 0.5, ry); box(wood, x + Math.sin(ry) * -0.22, 0.75, z, 1.8, 0.5, 0.08, ry);
    for (const s of [-0.75, 0.75]) box(dark, x + Math.cos(ry) * s, 0.22, z - Math.sin(ry) * s, 0.08, 0.44, 0.5, ry);
  }
  const lamps = [[12.4, 16], [12.4, 28], [16, -6], [16, 12], [5, 14]];
  for (const [x, z] of lamps){ cyl(dark, x, 1.8, z, 0.07, 3.6); }
  const flowers = [];
  const fr = rng(11);
  for (const [cx, cz, w, d] of [[5.5, 24, 3, 5], [16.5, 24, 3, 6], [3.5, 38, 4, 3], [19, 36, 3, 4]]){
    box(M(0x5a3a22, 1), cx, 0.08, cz, w, 0.16, d);
    for (let k = 0; k < w * d * 3; k++) flowers.push([cx + (fr() - 0.5) * (w - 0.3), cz + (fr() - 0.5) * (d - 0.3), [0xe83a5a, 0xf4d030, 0xf4f4f4, 0x9a4ae8, 0xf08a2a][Math.floor(fr() * 5)]]);
  }
  const fmats = new Map();
  for (const [x, z, c] of flowers){ if (!fmats.has(c)) fmats.set(c, M(c, 0.7)); add(fmats.get(c), placed(new THREE.SphereGeometry(0.09, 6, 4), x, 0.25, z)); }

  for (const [mat, list] of groups){ const m = new THREE.Mesh(merge(list), mat); m.castShadow = true; m.receiveShadow = true; scene.add(m); }

  // glowing lamp heads
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff4c0, emissive: 0xfff0b0, emissiveIntensity: 0.6 });
  for (const [x, z] of lamps){ const s = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8), lampMat); s.position.set(x, 3.7, z); scene.add(s); }

  // signs
  const sign = (text, w, h, colour, fg, pos, ry, size = 0.5) => {
    const tc = textCanvas(1024, Math.round(1024 * h / w));
    const g = tc.ctx; g.fillStyle = colour; roundRect(g, 0, 0, 1024, tc.canvas.height, 40); g.fill();
    g.strokeStyle = '#ffffff'; g.lineWidth = 16; roundRect(g, 12, 12, 1000, tc.canvas.height - 24, 32); g.stroke();
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    let fs = tc.canvas.height * size; g.font = `bold ${fs}px "Arial Black", Arial, sans-serif`;
    while (g.measureText(text).width > 940 && fs > 10){ fs -= 4; g.font = `bold ${fs}px "Arial Black", Arial, sans-serif`; }
    g.fillText(text, 512, tc.canvas.height / 2 + fs * 0.05);
    // two faces back to back, so the words read the right way round from both sides
    const m = new THREE.Group();
    for (const flip of [0, Math.PI]){ const f = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tc.tex })); f.rotation.y = flip; f.position.z = flip ? -0.01 : 0.01; m.add(f); }
    m.position.copy(pos); m.rotation.y = ry; scene.add(m);
    return { mesh: m, tc };
  };
  sign('ROLLERCOASTER BROS', 9.6, 1.25, '#2a6ad8', '#ffe040', V(10.9, 6.6, 44.27), 0);
  sign('ROLLERCOASTER BROS', 12, 1.4, '#d83a2a', '#ffffff', V(4.86, 4.2, 0), Math.PI / 2);
  sign('QUEUE HERE', 3, 0.7, '#f4c430', '#2a2a2a', V(10.8, 2.4, 12.6), 0).mesh.position.y = 2.2;
  box; // (signposts are drawn above)
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 8), dark); post.position.set(10.8, 1.1, 12.5); scene.add(post);
  const price = sign('TICKET $5', 2.4, 0.8, '#ffffff', '#d83a2a', V(12.1, 2.2, 12.6), 0);
  const p2 = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 8), dark); p2.position.set(12.1, 1.1, 12.5); scene.add(p2);
  return {
    setPrice(n){
      if (price.n === n) return; price.n = n;
      const g = price.tc.ctx, c = price.tc.canvas;
      g.clearRect(0, 0, c.width, c.height);
      g.fillStyle = '#ffffff'; roundRect(g, 0, 0, c.width, c.height, 40); g.fill();
      g.strokeStyle = '#d83a2a'; g.lineWidth = 20; roundRect(g, 14, 14, c.width - 28, c.height - 28, 30); g.stroke();
      g.fillStyle = '#d83a2a'; g.font = `bold ${c.height * 0.55}px "Arial Black", Arial`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(n ? 'TICKET $' + n : 'CLOSED', c.width / 2, c.height / 2);
      price.tc.tex.needsUpdate = true;
    },
  };
}

// ---------- people ----------
const SHIRTS = [0xe83a3a, 0x3a7ae8, 0x3ab84a, 0xf4c430, 0x9a4ad8, 0xf08a2a, 0x2ac8c8, 0xf060a8, 0xf4f4f4, 0x2a2a2a];
const SKINS = [0xf2d0b0, 0xe0b090, 0xc08a60, 0x9a6a44, 0x6a4a30, 0xf6dcc4];
const HAIRS = [0x2a1a10, 0x5a3a1a, 0xc89a4a, 0x1a1a1a, 0x8a3a1a, 0xe8d8a0, 0x9a9a9a];
const PANTS = [0x2a3a6a, 0x3a3a3a, 0x6a5a3a, 0x2a4a8a, 0x8a2a2a, 0xd8d0c0];
const SAYINGS_HAPPY = ['Wheee!', 'Again! Again!', 'That was awesome!', 'Best ride ever!', 'So fast!', 'I loved it!', 'Woo-hoo!', 'My tummy flipped!'];
const SAYINGS_SCARED = ['Too scary for me!', 'No way!', 'Too fast!', 'Maybe next time...'];
const matCache = new Map();
const mat = (c) => { if (!matCache.has(c)) matCache.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 })); return matCache.get(c); };

class Person {
  constructor(look, kid){
    this.look = look;
    const g = this.root = new THREE.Group();
    const s = kid ? 0.72 : 1;
    const mk = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; return o; };
    this.legs = [];
    for (const side of [-1, 1]){
      const hip = new THREE.Group(); hip.position.set(side * 0.1 * s, 0.82 * s, 0); g.add(hip);
      const leg = mk(new THREE.BoxGeometry(0.13 * s, 0.82 * s, 0.15 * s), mat(look.pants), 0, -0.41 * s, 0); hip.add(leg);
      hip.add(mk(new THREE.BoxGeometry(0.14 * s, 0.08 * s, 0.24 * s), mat(0x2a2a2a), 0, -0.8 * s, -0.04 * s));
      this.legs.push(hip);
    }
    g.add(mk(new THREE.BoxGeometry(0.38 * s, 0.56 * s, 0.24 * s), mat(look.shirt), 0, 1.1 * s, 0));
    g.add(mk(new THREE.SphereGeometry(0.13 * s, 12, 9), mat(look.skin), 0, 1.53 * s, 0));
    const hair = mk(new THREE.SphereGeometry(0.137 * s, 12, 9), mat(look.hair), 0, 1.58 * s, 0.02 * s); hair.scale.set(1, 0.75, 1); g.add(hair);
    this.arms = [];
    for (const side of [-1, 1]){
      const sh = new THREE.Group(); sh.position.set(side * 0.24 * s, 1.34 * s, 0); g.add(sh);
      sh.add(mk(new THREE.BoxGeometry(0.1 * s, 0.56 * s, 0.1 * s), mat(look.shirt), 0, -0.26 * s, 0));
      sh.add(mk(new THREE.SphereGeometry(0.055 * s, 8, 6), mat(look.skin), 0, -0.56 * s, 0));
      this.arms.push(sh);
    }
    this.phase = Math.random() * 6;
    this.height = 1.7 * s;
  }
  animate(dt, speed, wave = 0){
    this.phase += dt * speed * 5.2;
    const a = Math.sin(this.phase) * Math.min(0.6, speed * 0.4);
    this.legs[0].rotation.x = a; this.legs[1].rotation.x = -a;
    this.arms[0].rotation.x = -a * 0.8; this.arms[1].rotation.x = a * 0.8 - wave * (2.6 + Math.sin(this.phase * 3) * 0.3);
  }
}

function randomLook(r){
  const pick = (a) => a[Math.floor(r() * a.length)];
  return { shirt: pick(SHIRTS), skin: pick(SKINS), hair: pick(HAIRS), pants: pick(PANTS) };
}

// speech bubbles over people's heads
class Bubble {
  constructor(scene){
    this.tc = textCanvas(512, 160);
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tc.tex, depthTest: true, transparent: true }));
    this.sprite.scale.set(1.8, 0.56, 1); this.sprite.visible = false; scene.add(this.sprite); this.t = 0;
  }
  show(text, who){
    const g = this.tc.ctx; g.clearRect(0, 0, 512, 160);
    g.fillStyle = 'rgba(255,255,255,0.95)'; roundRect(g, 8, 8, 496, 116, 40); g.fill();
    g.beginPath(); g.moveTo(230, 120); g.lineTo(256, 154); g.lineTo(282, 120); g.fill();
    g.fillStyle = '#2a2a3a'; g.textAlign = 'center'; g.textBaseline = 'middle';
    let fs = 54; g.font = `bold ${fs}px Arial`; while (g.measureText(text).width > 470){ fs -= 3; g.font = `bold ${fs}px Arial`; }
    g.fillText(text, 256, 68); this.tc.tex.needsUpdate = true;
    this.who = who; this.t = 3; this.sprite.visible = true;
  }
  update(dt){
    if (this.t <= 0) return;
    this.t -= dt;
    if (this.t <= 0 || !this.who.root.visible){ this.sprite.visible = false; this.t = 0; return; }
    this.sprite.position.copy(this.who.root.position).add(V(0, this.who.person.height + 0.55, 0));
  }
}

// ---------- the park's state: money, what you own, the visitors ----------
export class Park {
  constructor(scene, track, train){
    this.scene = scene; this.track = track; this.train = train;
    this.scenery = buildPark(scene);
    this.visitors = [];
    this.rand = rng(1234);
    this.spawnT = 2; this.boardT = 0;
    this.listeners = {};
    this.bubbles = [new Bubble(scene), new Bubble(scene), new Bubble(scene), new Bubble(scene)];
    this.newGame();
    train.on('arrive', () => this.unload());
    this.track.reserve(2.6, 4.6, -10, 10, 0, 5.2);   // platform and roof
    this.track.reserve(-1.6, 0.5, -9.6, 9.6, 0, 5.2); // under the roof
    this.track.reserve(4.8, 12, -3, 13, 0, 3);        // queue
    this.track.reserve(2.6, 6, -13, -9, 0, 3);        // the steps down from the platform
  }
  on(ev, fn){ (this.listeners[ev] || (this.listeners[ev] = [])).push(fn); }
  emit(ev, x){ for (const f of this.listeners[ev] || []) f(x); }
  say(text, kind = ''){ this.emit('say', { text, kind }); }

  newGame(){
    this.state = { money: START_MONEY, groups: ['starter'], carts: ['classic'], cart: 'classic', speed: 2, color: 0, track: [], riders: 0, earned: 0, built: false };
  }
  save(){
    this.state.track = this.track.types();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.state)); } catch (e) {}
  }
  load(){
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (!s) return false;
      this.newGame(); Object.assign(this.state, s);
      return true;
    } catch (e) { return false; }
  }
  owns(group){ return this.state.groups.includes(group); }
  spend(n){ if (this.state.money < n) return false; this.state.money -= n; return true; }

  get rating(){ return this.cached || this.rerate(); }
  rerate(){ this.cached = this.track.rate(this.speedV); return this.cached; }
  get speedV(){ return [6, 9, 12, 16, 21][this.state.speed] || 12; }
  ticket(r = this.rating){ return this.track.complete ? Math.round(2 + r.excitement * 2) : 0; }

  // the train is back: riders get off (and say what they thought)
  unload(){
    let said = 0;
    for (let i = 0; i < this.train.seats.length; i++){
      const v = this.train.seats[i];
      if (!v || v === 'player') continue;
      this.train.seatRider(i, null);
      v.state = 'out'; v.path = EXIT.map((p) => V(...p)); v.pi = 0;
      v.root.position.set(lerp(2.2, 3.6, this.rand()), 0.55, -8 + this.rand() * 3);
      v.root.visible = true;
      if (said < 2 && this.rand() < 0.5){ this.bubble(v, SAYINGS_HAPPY[Math.floor(this.rand() * SAYINGS_HAPPY.length)]); said++; v.wave = 2; }
    }
    this.boardT = 0.6;
  }
  bubble(v, text){ const b = this.bubbles.find((x) => x.t <= 0) || this.bubbles[0]; b.show(text, v); }

  update(dt, playerRiding){
    const T = this.track, R = this.rating, open = T.complete;
    this.scenery.setPrice(this.ticket(R));
    // new visitors arrive while the coaster is open
    if (open){
      this.spawnT -= dt;
      const queued = this.visitors.filter((v) => v.state === 'in' || v.state === 'queue').length;
      if (this.spawnT <= 0){
        this.spawnT = clamp(6.5 - R.excitement * 0.55, 1.1, 6.5) * (0.6 + this.rand() * 0.8);
        if (queued < QUEUE_MAX - 3 && this.visitors.length < 70){
          const n = 1 + Math.floor(this.rand() * 3);
          for (let k = 0; k < n; k++) this.spawn(k);
        }
      }
    }
    // the queue: everyone shuffles up
    const queue = this.visitors.filter((v) => v.state === 'queue').sort((a, b) => a.joined - b.joined);
    queue.forEach((v, i) => { v.slot = i; });
    // boarding while the train waits in the station
    if (this.train.state === 'loading'){
      this.boardT -= dt;
      if (this.boardT <= 0 && queue.length && queue[0].root.position.distanceTo(queueSpot(0)) < 1.2){
        const empty = this.train.emptySeats();
        if (empty.length && this.train.dwell > 0.6){
          const v = queue[0], seat = empty[0];
          v.state = 'riding'; v.root.visible = false;
          this.train.seatRider(seat, v);
          const t = this.ticket(R);
          this.state.money += t; this.state.earned += t; this.state.riders++;
          this.emit('pay', { amount: t, pos: v.root.position.clone() });
          this.boardT = 0.35;
          // hold the train a moment longer while people are still getting on
          if (this.train.dwell < 1.6 && queue.length > 1 && empty.length > 1) this.train.dwell = 1.6;
        }
      }
    }
    for (const v of this.visitors) this.move(v, dt, R);
    this.visitors = this.visitors.filter((v) => { if (v.gone){ this.scene.remove(v.root); return false; } return true; });
    for (const b of this.bubbles) b.update(dt);
    void playerRiding;
  }
  spawn(k){
    const look = randomLook(this.rand), kid = this.rand() < 0.4;
    const p = new Person(look, kid);
    const v = { person: p, root: p.root, look, state: 'in', path: ENTRY.map((q) => V(...q)), pi: 0, speed: 1.3 + this.rand() * 0.5, joined: 0, wave: 0 };
    v.root.position.copy(SPAWN).add(V((this.rand() - 0.5) * 2, 0, k * 1.2));
    this.scene.add(v.root);
    this.visitors.push(v);
  }
  move(v, dt, R){
    if (v.state === 'riding') return;
    let target = null;
    if (v.state === 'in' || v.state === 'out' || v.state === 'leave'){
      target = v.path[v.pi];
      if (!target){
        if (v.state === 'in'){
          // at the queue: is it too scary?
          if (R.intensity > 7 && this.rand() < (R.intensity - 7) / 4){
            v.state = 'leave'; v.path = [V(12.6, 0, 20), V(12.4, 0, 31), V(12.4, 0, 42)]; v.pi = 0;
            this.bubble(v, SAYINGS_SCARED[Math.floor(this.rand() * SAYINGS_SCARED.length)]);
            this.emit('scared');
          } else { v.state = 'queue'; v.joined = performance.now() + this.rand(); }
          return;
        }
        v.gone = true; return;
      }
    } else if (v.state === 'queue'){
      target = queueSpot((v.slot || 0) * QUEUE_GAP, v.qt || (v.qt = V()));
    }
    const p = v.root.position, d = V(target.x - p.x, 0, target.z - p.z), dist = d.length();
    let speed = 0;
    if (dist > 0.05){
      speed = Math.min(v.speed, dist * 3);
      d.multiplyScalar(Math.min(dist, speed * dt) / dist);
      p.add(d);
      v.root.rotation.y = Math.atan2(-d.x, -d.z);
    } else if (v.state !== 'queue') v.pi++;
    if ((v.state === 'in' || v.state === 'out' || v.state === 'leave') && dist < 0.6) v.pi++;
    // up and down the platform step
    const onPlatform = p.x > 1.1 && p.x < 5.8 && p.z > -11.9 && p.z < 9.2 && !(p.x > 4.0 && p.z > -9);
    p.y = lerp(p.y, onPlatform ? 0.55 : 0, Math.min(1, dt * 10));
    if (v.state === 'queue' && dist < 0.1){ // face the train
      v.root.rotation.y = lerp(v.root.rotation.y, Math.PI / 2, dt * 2);
    }
    v.wave = Math.max(0, v.wave - dt);
    v.person.animate(dt, speed, v.wave > 0 ? 1 : 0);
  }
  clearRiders(){
    for (let i = 0; i < this.train.seats.length; i++){
      const v = this.train.seats[i];
      if (v && v !== 'player'){ this.train.seatRider(i, null); v.state = 'out'; v.path = EXIT.map((p) => V(...p)); v.pi = 0; v.root.position.set(3, 0.55, -8); v.root.visible = true; }
    }
  }
  queueLength(){ return this.visitors.filter((v) => v.state === 'queue').length; }
}
void CAR_GAP; void PARK;
