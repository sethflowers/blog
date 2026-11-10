// The park: flat grass as far as you can see (no trees), a main avenue with an entrance gate, and up to
// seven coasters side by side along it, each with its own station, queue, train and settings; the
// visitors who come to ride them; and your money. You can have lots of parks, each with its own name, and
// each either "earn it" (start with $200 and buy things) or "free build" (everything free from the start).
// Coaster designs are saved to a library that every park shares.
import * as THREE from 'three';
import { V, clamp, lerp, rng, merge, placed, noiseTexture, textCanvas, roundRect } from './util.js';
import { Track, TILE, reserve } from './track.js';
import { Train, SPEEDS } from './train.js';

export const SAVE_KEY = 'rollercoaster-bros-save';          // version 1.0 and 1.1 kept one park here
export const PARKS_KEY = 'rollercoaster-bros-parks';        // { current, list: [{ id, name, free, ... }] }
const parkKey = (id) => 'rollercoaster-bros-park-' + id;
export const DESIGNS_KEY = 'rollercoaster-bros-designs';
export const START_MONEY = 200;
// where coasters can go (the x of each station, in tiles), in the order they're used
export const PLOTS = [0, 7, -7, 14, -14, 21, -21];
export const COASTER_PRICE = [0, 1000, 2500, 4000, 6000, 9000, 12000];
export const PARK_NAMES = ['Sunny Hills', 'Thrill Town', 'Loopy Land', 'Wild World', 'Coaster Kingdom', 'Funtopia', 'Rainbow Park', 'Adventure Bay', 'Mega Fun Park', 'Screamville'];
export const NAMES = ['Thunder Run', 'Loop Monster', 'Dragon Flyer', 'Sky Screamer', 'Twister', 'Big Dipper', 'Comet', 'Wild Mouse', 'Cyclone', 'Rocket Rush', 'Viper', 'Tornado', 'Brain Shaker', 'The Beast', 'Zoomer', 'Mega Bro'];
const AVENUE = 24;          // z of the main avenue
const GATES = [V(10.9, 0, 46), V(-182, 0, AVENUE), V(196, 0, AVENUE)];

// ---------- the places, relative to a coaster's station ----------
const QUEUE = [[10.8, 0, 12], [10.8, 0, 8.6], [9.6, 0, 8.6], [9.6, 0, -2], [8.2, 0, -2], [8.2, 0, 8.6], [6.8, 0, 8.6], [6.8, 0, -2], [5.4, 0, -2], [5.4, 0, 5], [4.4, 0.55, 5], [3.0, 0.55, 3.5]];
const EXIT = [[3.0, 0.55, -8.2], [4.6, 0.55, -10.2], [8, 0, -12], [14, 0, -12], [14, 0, AVENUE]];
const qPts = QUEUE.map((p) => V(...p)).reverse();
const qLen = [0]; for (let i = 1; i < qPts.length; i++) qLen.push(qLen[i - 1] + qPts[i].distanceTo(qPts[i - 1]));
function queueSpot(d, ox, out = V()){
  for (let i = 1; i < qPts.length; i++) if (d <= qLen[i] || i === qPts.length - 1){ const f = clamp((d - qLen[i - 1]) / (qLen[i] - qLen[i - 1])); return out.copy(qPts[i - 1]).lerp(qPts[i], f).setX(out.x + ox); }
  return out.copy(qPts[0]).setX(qPts[0].x + ox);
}
const QUEUE_GAP = 0.8, QUEUE_MAX = Math.floor(qLen[qLen.length - 1] / QUEUE_GAP);
const nearestGate = (x) => GATES.reduce((a, g) => (Math.abs(g.x - x) < Math.abs(a.x - x) ? g : a));
// walking from a gate along the avenue (and back)
function routeIn(gate, ox){
  const r = [];
  if (gate.z !== AVENUE) r.push(V(gate.x - 1.5, 0, AVENUE));
  r.push(V(ox + 10.8, 0, AVENUE), V(ox + 10.8, 0, 12));
  return r;
}
function routeOut(ox){
  const g = nearestGate(ox + 14), r = EXIT.map((p) => V(p[0] + ox, p[1], p[2]));
  if (g.z !== AVENUE) r.push(V(g.x + 1.5, 0, AVENUE), V(g.x + 1.5, 0, g.z + 2)); else r.push(V(g.x, 0, AVENUE));
  return r;
}

// ---------- scenery ----------
const M = (c, r = 0.8, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
const MATS = {};
function mats(){
  if (MATS.paving) return MATS;
  Object.assign(MATS, {
    paving: new THREE.MeshStandardMaterial({ map: noiseTexture(128, 0xc8b89a, 0.08, 5, 1), roughness: 0.9 }),
    concrete: M(0xb8b4ac, 0.85), wood: M(0x8a5a32, 0.8), white: M(0xf4f2ec, 0.6), red: M(0xd83a2a, 0.6), yellow: M(0xf4c430, 0.6),
    blue: M(0x2a6ad8, 0.6), dark: M(0x2a2a30, 0.5, 0.5), metal: M(0xc8ccd4, 0.35, 0.8), soil: M(0x5a3a22, 1),
    lamp: new THREE.MeshStandardMaterial({ color: 0xfff4c0, emissive: 0xfff0b0, emissiveIntensity: 0.6 }),
  });
  return MATS;
}
// collects boxes and cylinders by material, then makes one mesh per material
class Builder {
  constructor(){ this.groups = new Map(); this.B = new THREE.BoxGeometry(1, 1, 1); this.C = new THREE.CylinderGeometry(1, 1, 1, 10); }
  add(mat, g){ if (!this.groups.has(mat)) this.groups.set(mat, []); this.groups.get(mat).push(g); }
  box(mat, x, y, z, sx, sy, sz, ry = 0){ this.add(mat, placed(this.B, x, y, z, 0, ry, 0, sx, sy, sz)); }
  cyl(mat, x, y, z, r, h){ this.add(mat, placed(this.C, x, y, z, 0, 0, 0, r, h, r)); }
  strip(pts, w){ for (let i = 1; i < pts.length; i++){ const a = pts[i - 1], b = pts[i]; const len = a.distanceTo(b) + w; const m = a.clone().add(b).multiplyScalar(0.5); this.box(MATS.paving, m.x, 0.02, m.z, w, 0.04, len, Math.atan2(b.x - a.x, b.z - a.z)); } }
  bench(x, z, ry){ const K = MATS; this.box(K.wood, x, 0.45, z, 1.8, 0.08, 0.5, ry); this.box(K.wood, x + Math.sin(ry) * -0.22, 0.75, z, 1.8, 0.5, 0.08, ry); for (const s of [-0.75, 0.75]) this.box(K.dark, x + Math.cos(ry) * s, 0.22, z - Math.sin(ry) * s, 0.08, 0.44, 0.5, ry); }
  build(parent){ for (const [mat, list] of this.groups){ const m = new THREE.Mesh(merge(list), mat); m.castShadow = true; m.receiveShadow = true; parent.add(m); } }
}
function sign(parent, text, w, h, colour, fg, pos, ry = 0, size = 0.5){
  const tc = textCanvas(1024, Math.round(1024 * h / w));
  const s = { tc, w, h, colour, fg, size };
  s.draw = (t) => {
    const g = tc.ctx, H = tc.canvas.height; g.clearRect(0, 0, 1024, H);
    g.fillStyle = colour; roundRect(g, 0, 0, 1024, H, 40); g.fill();
    g.strokeStyle = fg === '#ffffff' ? '#ffe040' : '#ffffff'; g.lineWidth = 16; roundRect(g, 12, 12, 1000, H - 24, 32); g.stroke();
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    let fs = H * size; g.font = `bold ${fs}px "Arial Black", Arial, sans-serif`;
    while (g.measureText(t).width > 940 && fs > 10){ fs -= 4; g.font = `bold ${fs}px "Arial Black", Arial, sans-serif`; }
    g.fillText(t, 512, H / 2 + fs * 0.05);
    tc.tex.needsUpdate = true;
  };
  s.draw(text);
  // two faces back to back, so the words read the right way round from both sides
  const m = new THREE.Group();
  for (const flip of [0, Math.PI]){ const f = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tc.tex })); f.rotation.y = flip; f.position.z = flip ? -0.01 : 0.01; m.add(f); }
  m.position.copy(pos); m.rotation.y = ry; parent.add(m);
  s.mesh = m;
  return s;
}
function post(parent, x, z, h = 2.2){ const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, h, 8), MATS.dark); p.position.set(x, h / 2, z); parent.add(p); }

// The parts of the park every coaster shares: grass, the avenue, the gates, flowers.
export function buildPark(scene){
  const K = mats(), b = new Builder();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial({ map: noiseTexture(256, 0x5a9a3a, 0.12, 3, 200), roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  b.box(K.paving, 7, 0.02, AVENUE, 380, 0.04, 4);                 // the avenue
  b.strip([V(9.4, 0, 48), V(9.4, 0, AVENUE)], 2.6); b.strip([V(12.4, 0, AVENUE), V(12.4, 0, 48)], 2.6);
  b.box(K.paving, 11, 0.02, 40, 9, 0.04, 12);                      // the plaza by the main gate
  // the main gate and a smaller one at each end of the avenue
  for (const x of [6.2, 15.6]){ b.box(K.red, x, 3, 44, 0.8, 6, 0.8); b.box(K.yellow, x, 6.2, 44, 1.1, 0.4, 1.1); }
  b.box(K.blue, 10.9, 6.6, 44, 10.6, 1.4, 0.5);
  for (const g of GATES.slice(1)) for (const dz of [-2.6, 2.6]){ b.box(K.red, g.x, 2.2, AVENUE + dz, 0.6, 4.4, 0.6); b.box(K.blue, g.x, 4.6, AVENUE, 0.5, 0.9, 6.4); }
  const fr = rng(11);
  for (const [cx, cz, w, d] of [[3.5, 38, 4, 3], [19, 36, 3, 4], [4, 30, 4, 3], [18, 30, 4, 3]]){
    b.box(K.soil, cx, 0.08, cz, w, 0.16, d);
    for (let k = 0; k < w * d * 3; k++){
      const c = [0xe83a5a, 0xf4d030, 0xf4f4f4, 0x9a4ae8, 0xf08a2a][Math.floor(fr() * 5)];
      if (!K['f' + c]) K['f' + c] = M(c, 0.7);
      b.add(K['f' + c], placed(new THREE.SphereGeometry(0.09, 6, 4), cx + (fr() - 0.5) * (w - 0.3), 0.25, cz + (fr() - 0.5) * (d - 0.3)));
    }
  }
  b.bench(7.6, 32, Math.PI / 2); b.bench(14.4, 32, -Math.PI / 2);
  b.build(scene);
  const gate = sign(scene, 'ROLLERCOASTER BROS', 9.6, 1.25, '#2a6ad8', '#ffe040', V(10.9, 6.6, 44.27));
  for (const g of GATES.slice(1)) sign(scene, 'WELCOME', 5.6, 0.8, '#2a6ad8', '#ffe040', V(g.x, 4.6, AVENUE), Math.PI / 2);
  // empty plots: a sign saying a coaster could go here
  const plots = PLOTS.map((i) => {
    const g = new THREE.Group(); g.position.x = i * TILE; scene.add(g);
    post(g, 1.4, 17, 2.6); post(g, 6.6, 17, 2.6);
    sign(g, 'COASTER SITE', 6, 1.2, '#f4c430', '#2a2a2a', V(4, 2.4, 17));
    return g;
  });
  return { plots, gate };
}

// One coaster's station, queue and signs (removed if the coaster is knocked down).
function buildStation(scene, ox, name){
  const K = mats(), b = new Builder(), g = new THREE.Group(); g.position.x = ox; scene.add(g);
  b.strip([V(10.8, 0, AVENUE), V(10.8, 0, 12)], 2.6);
  b.strip(EXIT.slice(2).map((p) => V(...p)), 2.6);
  b.box(K.paving, 8.6, 0.02, 3.3, 7.4, 0.04, 14.2);     // under the queue
  b.box(K.concrete, 2.55, 0.275, 0, 2.9, 0.55, 18.4);
  b.box(K.yellow, 1.16, 0.56, 0, 0.12, 0.02, 18.4);     // the yellow line at the edge
  b.box(K.concrete, 4.6, 0.275, -10.4, 2.2, 0.55, 3);   // steps down to the exit
  for (const z of [-9, -3, 3, 9]) for (const x of [-1.5, 4.2]) b.cyl(K.white, x, 2.3, z, 0.14, 4.6);
  b.box(K.red, 1.35, 4.75, 0, 6.8, 0.3, 19.2);
  for (let k = 0; k < 8; k++) b.box(k % 2 ? K.white : K.red, 1.35, 5.0, -8.4 + k * 2.4, 6.4, 0.22, 2.4);
  for (const x of [6.1, 7.5, 8.9, 10.3]){ const o = x === 6.1 || x === 8.9 ? 0.7 : -0.7; b.box(K.metal, x, 0.9, 3.1 + o, 0.06, 0.06, 9.2); for (let z = -1.4; z <= 8; z += 2.4) b.cyl(K.metal, x, 0.45, z + o, 0.05, 0.9); }
  b.box(K.metal, 8.2, 0.9, 9.3, 5.6, 0.06, 0.06); b.box(K.metal, 8.2, 0.9, -2.7, 6, 0.06, 0.06);
  b.bench(16.2, 8, -Math.PI / 2); b.bench(16.2, 0, -Math.PI / 2);
  const lamps = [[16, -6], [16, 12], [5, 14], [12.4, 18]];
  for (const [x, z] of lamps){ b.cyl(K.dark, x, 1.8, z, 0.07, 3.6); }
  b.build(g);
  for (const [x, z] of lamps){ const s = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8), K.lamp); s.position.set(x, 3.7, z); g.add(s); }
  const title = sign(g, name.toUpperCase(), 12, 1.4, '#d83a2a', '#ffffff', V(4.86, 4.2, 0), Math.PI / 2);
  sign(g, 'QUEUE HERE', 3, 0.7, '#f4c430', '#2a2a2a', V(10.8, 2.2, 12.6)); post(g, 10.8, 12.5);
  const price = sign(g, 'CLOSED', 2.4, 0.8, '#ffffff', '#d83a2a', V(12.1, 2.2, 12.6), 0, 0.55); post(g, 12.1, 12.5);
  return { group: g, setName(n){ title.draw(n.toUpperCase()); }, setPrice(n){ if (price.n === n) return; price.n = n; price.draw(n ? 'TICKET $' + n : 'CLOSED'); } };
}
// the ground each plot keeps free of track: platform, roof, queue, exit steps
export function reservePlots(){
  for (const i of PLOTS){
    const ox = i * TILE;
    reserve(ox + 2.6, ox + 4.6, -10, 10, 0, 5.2);
    reserve(ox - 1.6, ox + 0.5, -9.6, 9.6, 0, 5.2);
    reserve(ox + 4.8, ox + 12, -3, 13, 0, 3);
    reserve(ox + 2.6, ox + 6, -13, -9, 0, 3);
  }
}

// ---------- one coaster ----------
export class Coaster {
  constructor(park, data){
    this.park = park; this.data = data;
    this.oi = PLOTS[data.plot]; this.ox = this.oi * TILE;
    this.track = new Track(park.scene, this.oi, data.hang);
    this.track.setColor(data.color || 0);
    this.track.load(data.track || []);
    this.train = new Train(park.scene, this.track);
    this.train.setStyle(data.cart || 'classic');
    this.train.reset();
    this.station = buildStation(park.scene, this.ox, data.name);
    this.train.on('arrive', () => { park.unload(this); park.emit('arrive', this); });
    this.train.on('dispatch', () => park.emit('dispatch', this));
    this.rerate();
  }
  get name(){ return this.data.name; }
  get speedV(){ return SPEEDS[this.data.speed] ? SPEEDS[this.data.speed].v : 12; }
  get rating(){ return this.cached || this.rerate(); }
  rerate(){ this.cached = this.track.rate(this.speedV); return this.cached; }
  ticket(r = this.rating){ return this.track.complete ? Math.round(2 + r.excitement * 2) : 0; }
  // how many people a minute this coaster draws (0 while it's shut)
  appeal(){ return this.track.complete ? 1 / clamp(6.5 - this.rating.excitement * 0.55, 1.1, 6.5) : 0; }
  queueSpot(d, out){ return queueSpot(d, this.ox, out); }
  // switch between sitting on top of the track and hanging under it (the track is built again higher or
  // lower, as far as it fits); returns how many pieces were kept
  setHang(h){
    this.park.clearRiders(this);
    const types = this.track.types();
    this.data.hang = !!h; this.track.hang = !!h;
    this.track.load(types);
    this.train.setStyle(this.train.style); this.train.reset();
    this.rerate();
    return { kept: this.track.types().length, of: types.length };
  }
  sync(){ this.data.track = this.track.types(); this.data.cart = this.train.style; this.data.color = this.track.color; this.data.hang = this.track.hang; }
  dispose(){
    this.track.dispose();
    this.park.scene.remove(this.train.group);
    this.park.scene.remove(this.station.group);
  }
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

// ---------- the park's state: money, what you own, the coasters, the visitors ----------
// ---------- the list of parks ----------
export function readParks(){
  let idx = null;
  try { idx = JSON.parse(localStorage.getItem(PARKS_KEY) || 'null'); } catch (e) {}
  if (!idx || !Array.isArray(idx.list)) idx = { current: null, list: [] };
  // a park saved before there could be more than one becomes "My Park"
  try {
    const old = localStorage.getItem(SAVE_KEY);
    if (old && !idx.list.length){
      idx.list.push({ id: 'p1', name: 'My Park', free: false });
      idx.current = 'p1';
      localStorage.setItem(parkKey('p1'), old);
      localStorage.setItem(PARKS_KEY, JSON.stringify(idx));
      localStorage.removeItem(SAVE_KEY);
    }
  } catch (e) {}
  if (!idx.list.some((p) => p.id === idx.current)) idx.current = idx.list.length ? idx.list[0].id : null;
  return idx;
}
function writeParks(idx){ try { localStorage.setItem(PARKS_KEY, JSON.stringify(idx)); } catch (e) {} }
export function deletePark(id){
  const idx = readParks();
  idx.list = idx.list.filter((p) => p.id !== id);
  if (idx.current === id) idx.current = idx.list.length ? idx.list[0].id : null;
  writeParks(idx);
  try { localStorage.removeItem(parkKey(id)); } catch (e) {}
}
export function chooseParkId(id){ const idx = readParks(); idx.current = id; writeParks(idx); }

export class Park {
  constructor(scene){
    this.scene = scene;
    this.scenery = buildPark(scene);
    reservePlots();
    this.coasters = [];
    this.visitors = [];
    this.rand = rng(1234);
    this.spawnT = 2;
    this.listeners = {};
    this.bubbles = [new Bubble(scene), new Bubble(scene), new Bubble(scene), new Bubble(scene)];
    this.designs = [];
    try { this.designs = JSON.parse(localStorage.getItem(DESIGNS_KEY) || '[]'); } catch (e) {}
    this.newGame();
  }
  on(ev, fn){ (this.listeners[ev] || (this.listeners[ev] = [])).push(fn); }
  emit(ev, x){ for (const f of this.listeners[ev] || []) f(x); }
  say(text, kind = ''){ this.emit('say', { text, kind }); }

  // a fresh park (with no id it's only for looking at, behind the title, and is never saved)
  newGame(info = {}){
    this.setState({ id: null, name: 'Rollercoaster Bros', free: false, ...info, money: START_MONEY, groups: ['starter'], carts: ['classic'], coasters: [{ name: NAMES[0], plot: 0, track: [], cart: 'classic', speed: 2, color: 0, riders: 0, earned: 0 }], current: 0, riders: 0, earned: 0, built: false });
  }
  // build every coaster from a saved state
  setState(s){
    for (const c of this.coasters) c.dispose();
    for (const v of this.visitors) this.scene.remove(v.root);
    this.visitors = [];
    this.state = s;
    this.coasters = s.coasters.map((d) => new Coaster(this, d));
    this.state.current = clamp(this.state.current || 0, 0, this.coasters.length - 1);
    this.plotSigns();
    this.scenery.gate.draw((s.name || 'Rollercoaster Bros').toUpperCase());
  }
  // make a brand new park, with a name, and money or free building; it becomes the one you play
  create(name, free){
    const id = 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
    const idx = readParks();
    idx.list.push({ id, name, free: !!free }); idx.current = id; writeParks(idx);
    this.newGame({ id, name, free: !!free });
    this.save();
    return id;
  }
  plotSigns(){ this.scenery.plots.forEach((g, i) => { g.visible = !this.coasters.some((c) => c.data.plot === i); }); }
  get current(){ return this.coasters[this.state.current]; }
  get free(){ return !!this.state.free; }
  save(){
    const S = this.state;
    if (!S.id) return;
    for (const c of this.coasters) c.sync();
    try { localStorage.setItem(parkKey(S.id), JSON.stringify(S)); } catch (e) {}
    // what the parks list shows
    const idx = readParks(), e = idx.list.find((p) => p.id === S.id);
    if (e){ Object.assign(e, { name: S.name, free: S.free, money: S.money, coasters: this.coasters.length, riders: S.riders, saved: Date.now() }); writeParks(idx); }
  }
  // load a park (the one you last played, if no id is given)
  load(id){
    try {
      const idx = readParks();
      id = id || idx.current;
      const info = idx.list.find((p) => p.id === id);
      if (!info) return false;
      const s = JSON.parse(localStorage.getItem(parkKey(id)) || 'null');
      if (!s){ this.newGame({ id, name: info.name, free: info.free }); return true; }
      // version 1.0 had one coaster and no list of them
      if (!s.coasters) s.coasters = [{ name: NAMES[0], plot: 0, track: s.track || [], cart: s.cart || 'classic', speed: s.speed ?? 2, color: s.color || 0, riders: s.riders || 0, earned: s.earned || 0 }];
      this.setState({ money: START_MONEY, groups: ['starter'], carts: ['classic'], current: 0, riders: 0, earned: 0, built: false, ...s, id, name: info.name, free: !!info.free });
      return true;
    } catch (e) { return false; }
  }
  // in a free-build park everything is yours and costs nothing
  owns(group){ return this.free || this.state.groups.includes(group); }
  hasCart(id){ return this.free || this.state.carts.includes(id); }
  afford(n){ return this.free || this.state.money >= n; }
  spend(n){ if (this.free) return true; if (this.state.money < n) return false; this.state.money -= n; return true; }

  // ---------- more coasters ----------
  nextPlot(){ for (let p = 0; p < PLOTS.length; p++) if (!this.coasters.some((c) => c.data.plot === p)) return p; return -1; }
  get newPrice(){ return this.free ? 0 : COASTER_PRICE[Math.min(this.coasters.length, COASTER_PRICE.length - 1)]; }
  addCoaster(){
    const plot = this.nextPlot();
    if (plot < 0 || !this.spend(this.newPrice)) return null;
    const used = this.coasters.map((c) => c.name);
    const name = NAMES.find((n) => !used.includes(n)) || 'Coaster ' + (this.coasters.length + 1);
    const data = { name, plot, track: [], cart: 'classic', speed: 2, color: (this.coasters.length * 3) % 8, riders: 0, earned: 0 };
    this.state.coasters.push(data);
    const c = new Coaster(this, data);
    this.coasters.push(c);
    this.state.current = this.coasters.length - 1;
    this.plotSigns();
    return c;
  }
  removeCoaster(c){
    if (this.coasters.length <= 1) return false;
    this.clearRiders(c);
    for (const v of this.visitors) if (v.coaster === c && (v.state === 'in' || v.state === 'queue')) this.sendHome(v);
    const i = this.coasters.indexOf(c);
    c.dispose();
    this.coasters.splice(i, 1); this.state.coasters.splice(i, 1);
    this.state.current = clamp(this.state.current >= i ? this.state.current - 1 : this.state.current, 0, this.coasters.length - 1);
    this.plotSigns();
    return true;
  }
  rename(c, name){ c.data.name = name; c.station.setName(name); }

  // ---------- saved designs (kept even when you start a new park) ----------
  saveDesign(c){
    c.sync();
    let name = c.name, n = 2;
    while (this.designs.some((d) => d.name === name)) name = c.name + ' ' + n++;
    this.designs.push({ name, track: c.data.track.slice(), color: c.data.color, cart: c.data.cart, speed: c.data.speed, hang: !!c.data.hang, saved: Date.now() });
    this.saveDesigns();
    return name;
  }
  saveDesigns(){ try { localStorage.setItem(DESIGNS_KEY, JSON.stringify(this.designs)); } catch (e) {} }
  // the track packs a design needs that you haven't bought
  missing(design, PIECES){ return [...new Set(design.track.map((t) => PIECES[t] && PIECES[t].group).filter((g) => g && !this.owns(g)))]; }

  // the train is back: riders get off (and say what they thought)
  unload(c){
    let said = 0;
    const T = c.train;
    for (let i = 0; i < T.seats.length; i++){
      const v = T.seats[i];
      if (!v || v === 'player') continue;
      T.seatRider(i, null);
      v.state = 'out'; v.path = routeOut(c.ox); v.pi = 0;
      v.root.position.set(c.ox + lerp(2.2, 3.6, this.rand()), 0.55, -8 + this.rand() * 3);
      v.root.visible = true;
      if (said < 2 && this.rand() < 0.5){ this.bubble(v, SAYINGS_HAPPY[Math.floor(this.rand() * SAYINGS_HAPPY.length)]); said++; v.wave = 2; }
    }
    c.boardT = 0.6;
  }
  bubble(v, text){ const b = this.bubbles.find((x) => x.t <= 0) || this.bubbles[0]; b.show(text, v); }

  update(dt){
    for (const c of this.coasters) c.station.setPrice(c.ticket());
    // new visitors arrive, more for more (and more fun) coasters
    const appeal = this.coasters.map((c) => c.appeal()), total = appeal.reduce((a, b) => a + b, 0);
    if (total > 0){
      this.spawnT -= dt;
      if (this.spawnT <= 0){
        this.spawnT = (0.6 + this.rand() * 0.8) * 2 / total;
        let r = this.rand() * total, c = this.coasters[0];
        for (let i = 0; i < appeal.length; i++){ r -= appeal[i]; if (r <= 0 && appeal[i] > 0){ c = this.coasters[i]; break; } }
        const queued = this.visitors.filter((v) => v.coaster === c && (v.state === 'in' || v.state === 'queue')).length;
        const cap = Math.min(150, 50 + 20 * this.coasters.length);
        if (c.track.complete && queued < QUEUE_MAX - 3 && this.visitors.length < cap){
          const n = 1 + Math.floor(this.rand() * 3);
          for (let k = 0; k < n; k++) this.spawn(c, k);
        }
      }
    }
    for (const c of this.coasters) this.board(c, dt);
    for (const v of this.visitors) this.move(v, dt);
    this.visitors = this.visitors.filter((v) => { if (v.gone){ this.scene.remove(v.root); return false; } return true; });
    for (const b of this.bubbles) b.update(dt);
  }
  // everyone in a coaster's queue shuffles up; people get on while the train waits
  board(c, dt){
    const queue = this.visitors.filter((v) => v.coaster === c && v.state === 'queue').sort((a, b) => a.joined - b.joined);
    queue.forEach((v, i) => { v.slot = i; });
    const T = c.train;
    if (T.state !== 'loading') return;
    c.boardT = (c.boardT || 0) - dt;
    if (c.boardT > 0 || !queue.length || queue[0].root.position.distanceTo(c.queueSpot(0)) > 1.2) return;
    const empty = T.emptySeats();
    if (!empty.length || T.dwell <= 0.6) return;
    const v = queue[0];
    v.state = 'riding'; v.root.visible = false;
    T.seatRider(empty[0], v);
    const t = c.ticket();
    this.state.money += t; this.state.earned += t; this.state.riders++;
    c.data.riders = (c.data.riders || 0) + 1; c.data.earned = (c.data.earned || 0) + t;
    this.emit('pay', { amount: t, coaster: c });
    c.boardT = 0.35;
    if (T.dwell < 1.6 && queue.length > 1 && empty.length > 1) T.dwell = 1.6;
  }
  spawn(c, k){
    const look = randomLook(this.rand), kid = this.rand() < 0.4;
    const p = new Person(look, kid);
    const gate = nearestGate(c.ox + 10.8);
    const v = { person: p, root: p.root, look, coaster: c, state: 'in', path: routeIn(gate, c.ox), pi: 0, speed: 1.4 + this.rand() * 0.6, joined: 0, wave: 0 };
    v.root.position.copy(gate).add(gate.z === AVENUE ? V(0, 0, (this.rand() - 0.5) * 2 + k * 0.4) : V((this.rand() - 0.5) * 2 - 1.5, 0, k * 1.2));
    this.scene.add(v.root);
    this.visitors.push(v);
  }
  sendHome(v){ v.state = 'leave'; v.path = routeOut(v.coaster.ox).slice(4); v.pi = 0; }
  move(v, dt){
    if (v.state === 'riding') return;
    const c = v.coaster;
    let target = null;
    if (v.state === 'in' || v.state === 'out' || v.state === 'leave'){
      target = v.path[v.pi];
      if (!target){
        if (v.state === 'in'){
          // at the queue: is it too scary? (or was it knocked down / is it shut?)
          const R = c.rating;
          if (!this.coasters.includes(c)){ this.sendHome(v); return; }
          if (R.intensity > 7 && this.rand() < (R.intensity - 7) / 4){
            v.state = 'leave'; v.path = [V(c.ox + 12.6, 0, AVENUE - 1), ...routeOut(c.ox).slice(5)]; v.pi = 0;
            this.bubble(v, SAYINGS_SCARED[Math.floor(this.rand() * SAYINGS_SCARED.length)]);
            this.emit('scared', c);
          } else { v.state = 'queue'; v.joined = performance.now() + this.rand(); }
          return;
        }
        v.gone = true; return;
      }
    } else if (v.state === 'queue'){
      target = c.queueSpot((v.slot || 0) * QUEUE_GAP, v.qt || (v.qt = V()));
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
    const x = p.x - c.ox;
    const onPlatform = x > 1.1 && x < 5.8 && p.z > -11.9 && p.z < 9.2 && !(x > 4.0 && p.z > -9);
    p.y = lerp(p.y, onPlatform ? 0.55 : 0, Math.min(1, dt * 10));
    if (v.state === 'queue' && dist < 0.1) v.root.rotation.y = lerp(v.root.rotation.y, Math.PI / 2, dt * 2);
    v.wave = Math.max(0, v.wave - dt);
    v.person.animate(dt, speed, v.wave > 0 ? 1 : 0);
  }
  // the track changed: everyone gets off this coaster's train
  clearRiders(c){
    const T = c.train;
    for (let i = 0; i < T.seats.length; i++){
      const v = T.seats[i];
      if (v && v !== 'player'){ T.seatRider(i, null); v.state = 'out'; v.path = routeOut(c.ox); v.pi = 0; v.root.position.set(c.ox + 3, 0.55, -8); v.root.visible = true; }
    }
  }
  queueLength(c){ return this.visitors.filter((v) => v.coaster === c && v.state === 'queue').length; }
}
