// Farm dogs and barn cats. They roam free (not in a pen), eat from the bowls by the barn door, and help:
// a dog follows you about, fetches tools you ask for and keeps foxes off the hens at night; a cat
// keeps the mice out of the feed room. Both like being petted.
import * as THREE from 'three';
import { V, loft, limb, ellipsoid, clamp, damp, rng, angleDiff } from './util.js';
import { mat } from './textures.js';
import { pushOut, insideBarn, inBox, HOUSE } from './world.js';

export const PET_KINDS = {
  dog: { name: 'Dog', price: 250, max: 3, breeds: ['border collie', 'golden retriever', 'farm collie', 'black labrador'] },
  cat: { name: 'Cat', price: 60, max: 4, breeds: ['tabby cat', 'ginger cat', 'black cat', 'white cat'] },
};
const COLORS = {
  dog: [{ body: 0x1c1a18, white: 0xf2efe8 }, { body: 0xd8a050, white: 0xe8c890 }, { body: 0x7a4a28, white: 0xf0eadf }, { body: 0x161412, white: null }],
  cat: [{ body: 0x8a7a66, white: 0xd8d0c0, stripes: 0x4a3e30 }, { body: 0xd88a3a, white: 0xf0e0c8, stripes: 0xa85a20 }, { body: 0x181818, white: null }, { body: 0xf0ece4, white: null }],
};
const NAMES = {
  dog: ['Scout', 'Bramble', 'Shep', 'Molly', 'Buddy', 'Fern', 'Rex', 'Tess', 'Jasper', 'Poppy'],
  cat: ['Whiskers', 'Marmalade', 'Socks', 'Pumpkin', 'Shadow', 'Tiger', 'Mittens', 'Luna', 'Smokey', 'Biscuit'],
};

function model(kind, c){
  const dog = kind === 'dog';
  const P = dog ? { len: 0.8, r: 0.13, ry: 0.16, legL: 0.46, legR: 0.034, head: 0.12 } : { len: 0.44, r: 0.085, ry: 0.095, legL: 0.19, legR: 0.02, head: 0.07 };
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const coat = mat('coat', { color: c.body, rough: 0.8 });
  const white = c.white != null ? mat('coat', { color: c.white, rough: 0.8 }) : coat;
  const cy = P.legL + P.ry * 0.85, L = P.len;
  const sec = (z, rx, ry, dy = 0) => ({ p: [0, cy + dy, z], rx, ry });
  const secs = dog
    ? [sec(-L / 2, P.r * 0.5, P.ry * 0.5, 0.02), sec(-L / 2 + 0.07, P.r * 0.9, P.ry * 0.8, 0.02), sec(-L * 0.12, P.r * 0.8, P.ry * 0.68, 0.04), sec(L * 0.22, P.r * 1.02, P.ry * 1.25, -0.02), sec(L / 2 - 0.06, P.r * 0.92, P.ry * 1.15, 0.0), sec(L / 2, P.r * 0.45, P.ry * 0.55, 0.04)]
    : [sec(-L / 2, P.r * 0.45, P.ry * 0.45), sec(-L / 2 + 0.06, P.r * 0.85, P.ry * 0.85), sec(-L * 0.1, P.r * 0.9, P.ry * 0.82, -0.01), sec(L * 0.25, P.r, P.ry * 1.05, 0.01), sec(L / 2 - 0.05, P.r * 0.85, P.ry * 0.95, 0.03), sec(L / 2, P.r * 0.4, P.ry * 0.5, 0.05)];
  body.add(new THREE.Mesh(loft(secs, { ring: 16, steps: 4, uvScale: 2 }), coat));
  if (c.white != null){ const chest = new THREE.Mesh(ellipsoid(P.r * 0.75, P.ry * 0.8, P.r * 0.6, 12, 8), white); chest.position.set(0, cy - P.ry * 0.25, L / 2 - 0.06); body.add(chest); }
  // a tabby's darker saddle
  if (c.stripes){ const sd = new THREE.Mesh(ellipsoid(P.r * 0.7, P.ry * 0.5, L * 0.36, 12, 8), mat('coat', { color: c.stripes, rough: 0.8 })); sd.position.set(0, cy + P.ry * 0.62, -L * 0.04); body.add(sd); }
  // neck and head
  const neck = new THREE.Group(); neck.position.set(0, cy + P.ry * 0.4, L / 2 - 0.04); body.add(neck);
  neck.add(new THREE.Mesh(loft([{ p: [0, -0.04, -0.04], rx: P.r * 0.6, ry: P.r * 0.65 }, { p: [0, P.head * 0.9, P.head * 0.35], rx: P.r * 0.48, ry: P.r * 0.5 }], { ring: 12, steps: 3 }), coat));
  const head = new THREE.Group(); head.position.set(0, P.head * 1.15, P.head * 0.45); neck.add(head);
  const H = P.head;
  const eyeM = mat('plain-peteye', { color: dog ? 0x2a1a08 : 0x8aa030, rough: 0.1 });
  if (dog){
    head.add(new THREE.Mesh(ellipsoid(H * 0.72, H * 0.68, H * 0.78, 14, 10), coat));
    const muzzle = new THREE.Mesh(loft([{ p: [0, -H * 0.12, H * 0.3], rx: H * 0.42, ry: H * 0.42 }, { p: [0, -H * 0.22, H * 0.85], rx: H * 0.3, ry: H * 0.28 }, { p: [0, -H * 0.26, H * 1.32], rx: H * 0.24, ry: H * 0.22 }], { ring: 12, steps: 3 }), c.white != null ? white : coat);
    head.add(muzzle);
    if (c.white != null){ const blaze = new THREE.Mesh(ellipsoid(H * 0.16, H * 0.5, H * 0.6, 10, 6), white); blaze.position.set(0, H * 0.25, H * 0.35); head.add(blaze); }
    const nose = new THREE.Mesh(ellipsoid(H * 0.17, H * 0.13, H * 0.12, 10, 6), mat('plain-petnose', { color: 0x141210, rough: 0.3 })); nose.position.set(0, -H * 0.2, H * 1.38); head.add(nose);
    const tongue = new THREE.Mesh(ellipsoid(H * 0.1, H * 0.03, H * 0.16, 8, 4), mat('plain-tongue', { color: 0xd86070, rough: 0.4 })); tongue.position.set(0, -H * 0.5, H * 1.05); tongue.rotation.x = 0.5; head.add(tongue);
    for (const sx of [-1, 1]){
      const e = new THREE.Mesh(new THREE.SphereGeometry(H * 0.12, 8, 6), eyeM); e.position.set(sx * H * 0.36, H * 0.12, H * 0.62); head.add(e);
      // floppy ears hanging down the sides of the head
      const ear = new THREE.Mesh(ellipsoid(H * 0.09, H * 0.48, H * 0.3, 10, 6), coat);
      ear.position.set(sx * H * 0.66, H * 0.02, -H * 0.05); ear.rotation.set(0.15, 0, sx * 0.28); head.add(ear);
    }
  } else {
    head.add(new THREE.Mesh(ellipsoid(H * 0.82, H * 0.78, H * 0.85, 14, 10), coat));
    const snout = new THREE.Mesh(ellipsoid(H * 0.36, H * 0.3, H * 0.35, 12, 8), c.white != null ? white : coat); snout.position.set(0, -H * 0.22, H * 0.62); head.add(snout);
    const nose = new THREE.Mesh(ellipsoid(H * 0.15, H * 0.11, H * 0.1, 10, 6), mat('plain-catnose', { color: 0xd88a8a, rough: 0.3 })); nose.position.set(0, -H * 0.12, H * 0.95); head.add(nose);
    for (const sx of [-1, 1]){
      const e = new THREE.Mesh(new THREE.SphereGeometry(H * 0.13, 8, 6), eyeM); e.position.set(sx * H * 0.38, H * 0.18, H * 0.62); head.add(e);
      const ear = new THREE.Mesh(new THREE.ConeGeometry(H * 0.28, H * 0.55, 4), coat);
      ear.position.set(sx * H * 0.5, H * 0.75, -H * 0.05); ear.rotation.set(0, Math.PI / 4, sx * -0.25); head.add(ear);
    }
  }
  // the dog carries things here
  const mouth = new THREE.Group(); mouth.position.set(0, -H * 0.42, H * 1.15); head.add(mouth);
  // tail
  const tail = new THREE.Group(); tail.position.set(0, cy + P.ry * 0.5, -L / 2 + 0.02); body.add(tail);
  const tl = dog ? 0.42 : 0.32;
  const tg = dog ? ellipsoid(0.045, tl / 2, 0.045, 10, 8) : new THREE.CylinderGeometry(0.013, 0.018, tl, 8); tg.translate(0, tl / 2, 0);
  const tm = new THREE.Mesh(tg, coat); tm.rotation.x = dog ? -2.3 : -2.5; tail.add(tm);
  // legs
  const legs = [];
  for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]){
    const top = new THREE.Group(); top.position.set(x * P.r * 0.55, P.legL + 0.02, z * (L / 2 - 0.1)); body.add(top);
    top.add(new THREE.Mesh(limb(P.legL + 0.02, P.legR * 1.5, P.legR, { seg: 8 }), z > 0 && c.white != null ? white : coat));
    const paw = new THREE.Mesh(ellipsoid(P.legR * 1.3, P.legR * 0.8, P.legR * 1.6, 8, 6), z > 0 && c.white != null ? white : coat); paw.position.set(0, -P.legL - 0.005, P.legR * 0.5); top.add(paw);
    legs.push(top);
  }
  g.traverse((m) => { if (m.isMesh){ m.castShadow = true; m.receiveShadow = true; } });
  return { g, body, neck, head, tail, legs, mouth, P };
}

// doorways: going in or out of the barn or the house, a pet heads for the nearest door first
const DOORS = [
  { box: 'barn', in: V(0, 0, -5.2), out: V(0, 0, -2.8) },
  { box: 'barn', in: V(0, 0, -21.4), out: V(0, 0, -23.8) },
  { box: 'house', in: V(HOUSE.x1 - 0.8, 0, HOUSE.hz), out: V(HOUSE.x1 + 0.9, 0, HOUSE.hz) },
];
const inHouse = (p) => inBox(p, HOUSE, -0.2);
function waypoint(from, to){
  for (const box of ['house', 'barn']){
    const inside = box === 'barn' ? insideBarn : inHouse;
    const fi = inside(from), ti = inside(to);
    if (fi === ti) continue;
    let best = null, bd = 1e9;
    for (const d of DOORS) if (d.box === box){ const a = fi ? d.in : d.out, cost = from.distanceTo(a) + a.distanceTo(to); if (cost < bd){ bd = cost; best = d; } }
    const near = fi ? best.in : best.out, far = fi ? best.out : best.in;
    return Math.hypot(from.x - near.x, from.z - near.z) > 0.5 ? near : far;
  }
  return to;
}

let nextId = 1;
export class Pet {
  constructor(data){
    const kind = data.kind, R = rng(data.seed || Math.floor(Math.random() * 1e6));
    this.kind = kind;
    this.data = { id: data.id || ('pet' + Date.now().toString(36) + (nextId++)), kind, name: data.name || NAMES[kind][Math.floor(R() * NAMES[kind].length)], variant: data.variant ?? Math.floor(R() * 4), seed: data.seed || Math.floor(R() * 1e6), food: 80, happy: 80, mode: kind === 'dog' ? 'follow' : 'wander', ...data };
    this.m = model(kind, COLORS[kind][this.data.variant % 4]);
    this.root = this.m.g;
    this.root.traverse((o) => { if (o.isMesh) o.userData.petRef = this; });
    this.pos = V(); this.yaw = R() * 6; this.t = R() * 10; this.speed = 0; this.pose = 'stand'; this.target = null; this.wait = 1 + R() * 3;
    this.job = null;       // { kind: 'fetch', item, phase, t } or { kind: 'eat' }
    this.stuckT = 0; this.ghostT = 0;
  }
  get breed(){ return PET_KINDS[this.kind].breeds[this.data.variant % 4]; }
  // walk toward p; returns true when within `stop`
  goTo(p, speed, stop, dt){
    const wp = waypoint(this.pos, p), d = Math.hypot(wp.x - this.pos.x, wp.z - this.pos.z), dEnd = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
    if (dEnd < stop){ this.speed = damp(this.speed, 0, 8, dt); return true; }
    const want = Math.atan2(wp.x - this.pos.x, wp.z - this.pos.z);
    this.yaw += clamp(angleDiff(this.yaw, want), -dt * 6, dt * 6);
    const sp = speed * (Math.abs(angleDiff(this.yaw, want)) < 0.8 ? 1 : 0.3) * (wp === p ? clamp(dEnd - stop + 0.4, 0.3, 1) : 1);
    this.speed = damp(this.speed, sp, 6, dt);
    const before = this.pos.clone();
    this.pos.x += Math.sin(this.yaw) * this.speed * dt; this.pos.z += Math.cos(this.yaw) * this.speed * dt;
    // small enough to slip under stall doors and between rails; if really stuck, hop over
    if (this.ghostT <= 0) pushOut(this.pos, 0.18, { ignore: (c) => c.kind === 'door' || c.kind === 'stall' });
    if (before.distanceTo(this.pos) < this.speed * dt * 0.25 && d > 0.3) this.stuckT += dt; else this.stuckT = 0;
    if (this.stuckT > 1.2){ this.ghostT = 1.5; this.stuckT = 0; }
    return false;
  }
  update(dt, ctx){
    this.t += dt; this.ghostT -= dt;
    const D = this.data, pl = ctx.player;
    const toPlayer = pl ? Math.hypot(pl.x - this.pos.x, pl.z - this.pos.z) : 99;
    let pose = 'stand', wag = 0;
    const J = this.job;
    if (J && J.kind === 'fetch'){
      J.t += dt;
      const it = J.item;
      if (J.phase === 'go'){
        const ip = it.mesh.getWorldPosition(V()); ip.y = 0;
        if (it.held || it.onHorse){ this.job = null; }
        else if (this.goTo(ip, 4.2, 0.45, dt) || J.t > 25){ ctx.grab(this, it); J.phase = 'back'; J.t = 0; }
      } else {
        if (this.goTo(pl, 4.2, 1.1, dt) || J.t > 25){ ctx.deliver(this, it); this.job = null; wag = 1; }
      }
    } else if (J && J.kind === 'eat'){
      if (!ctx.bowl.amount){ this.job = null; }
      else if (this.goTo(ctx.bowl.pos, 2.2, 0.35, dt)){ pose = 'eat'; J.t = (J.t || 0) + dt; if (J.t > 4){ ctx.eat(this); this.job = null; } }
    } else if (D.food < 60 && ctx.bowl.amount > 0 && !(this.kind === 'dog' && D.mode === 'stay')){
      this.job = { kind: 'eat', t: 0 };
    } else if (this.kind === 'dog'){
      if (D.mode === 'stay' || ctx.night && toPlayer > 30){ pose = D.mode === 'stay' ? 'sit' : 'lie'; }
      else if (toPlayer > 2.4 || this.speed > 0.3 && toPlayer > 1.7){ this.goTo(pl, toPlayer > 7 ? 4.5 : 2.6, 1.7, dt); }
      else { this.speed = damp(this.speed, 0, 8, dt); this.yaw += clamp(angleDiff(this.yaw, Math.atan2(pl.x - this.pos.x, pl.z - this.pos.z)), -dt * 3, dt * 3); this.idle = (this.idle || 0) + dt; pose = this.idle > 1.2 ? 'sit' : 'stand'; wag = 0.6; }
      if (this.speed > 0.3) this.idle = 0;
      // a dog left far behind (you drove off, slept in the house) catches up
      if (D.mode !== 'stay' && toPlayer > 60){ this.pos.set(pl.x + 1.5, 0, pl.z + 1.5); }
    } else {
      // a cat: wanders between favourite spots, naps, and comes for a fuss when you're close
      this.wait -= dt;
      if (pl && toPlayer < 2.6 && D.happy > 40 && !this.napping && Math.random() < dt * 0.15){ this.target = { x: pl.x, z: pl.z, rub: 4 + Math.random() * 3 }; }
      if (this.target){
        const tp = this.target.rub ? V(pl.x, 0, pl.z) : V(this.target.x, 0, this.target.z);
        if (this.goTo(tp, this.target.rub ? 1.2 : 0.9, this.target.rub ? 0.5 : 0.3, dt)){
          if (this.target.rub){ this.target.rub -= dt; wag = 0.3; if (this.target.rub <= 0) { this.target = null; this.wait = 3; } }
          else { this.target = null; this.napping = Math.random() < (ctx.night ? 0.9 : 0.55); this.wait = this.napping ? 25 + Math.random() * 50 : 3 + Math.random() * 6; }
        }
      } else {
        this.speed = damp(this.speed, 0, 8, dt);
        pose = this.napping ? 'lie' : 'sit';
        if (this.wait <= 0){ this.napping = false; const s = ctx.catSpots[Math.floor(Math.random() * ctx.catSpots.length)]; this.target = { x: s.x + (Math.random() - 0.5) * 0.8, z: s.z + (Math.random() - 0.5) * 0.8 }; }
      }
    }
    if (this.speed > 0.15) pose = 'walk';
    this.pose = pose;
    this.animate(dt, wag);
  }
  animate(dt, wag){
    const m = this.m, P = m.P, moving = this.pose === 'walk';
    this.root.position.copy(this.pos); this.root.rotation.y = this.yaw;
    const f = this.speed > 2.5 ? 13 : 9, sw = moving ? Math.sin(this.t * f) * clamp(this.speed * 0.25, 0.25, 0.7) : 0;
    m.legs.forEach((l, i) => { l.rotation.x = (this.speed > 2.5 ? (i < 2 ? sw : -sw) : (i === 0 || i === 3 ? sw : -sw)); });
    const sit = this.pose === 'sit', lie = this.pose === 'lie', eat = this.pose === 'eat';
    m.body.rotation.x = damp(m.body.rotation.x, sit ? -0.4 : 0, 8, dt);
    m.body.position.y = damp(m.body.position.y, lie ? -P.legL * 0.8 : sit ? -P.legL * 0.25 : moving ? Math.abs(Math.sin(this.t * f)) * 0.012 : 0, 8, dt);
    m.body.position.z = damp(m.body.position.z, sit ? -P.len * 0.25 : 0, 8, dt);
    m.legs.forEach((l, i) => { l.rotation.x += sit && i >= 2 ? -1.0 : 0; l.rotation.x += sit && i < 2 ? 0.55 : 0; l.scale.y = lie ? 0.2 : 1; });
    m.neck.rotation.x = damp(m.neck.rotation.x, eat ? 0.9 : lie ? 0.5 : sit ? -0.4 : 0, 8, dt);
    m.tail.rotation.y = Math.sin(this.t * (wag ? 14 : 2)) * (wag ? 0.6 * wag : 0.12);
    // a cat's tail goes up when it walks or wants a fuss; a happy dog's lifts a little
    m.tail.rotation.x = damp(m.tail.rotation.x, this.kind === 'cat' ? (moving || wag ? 1.9 : 0.2) : (moving || wag ? 0.8 : 0), 4, dt);
  }
}

export function defaultPets(){
  return [
    { id: 'pet-scout', kind: 'dog', name: 'Scout', variant: 0, seed: 501 },
    { id: 'pet-whiskers', kind: 'cat', name: 'Whiskers', variant: 0, seed: 502, mode: 'wander' },
  ];
}
