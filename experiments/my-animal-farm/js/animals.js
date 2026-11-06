// Goats, sheep, pigs and hens. Each lives in its pen, wanders, eats from the trough, drinks, rests in
// the shelter at night and makes droppings you have to clean up. Hens lay eggs; sheep grow wool.
import * as THREE from 'three';
import { V, loft, limb, ellipsoid, clamp, lerp, damp, rng, angleDiff } from './util.js';
import { mat, tex } from './textures.js';

export const SPECIES = {
  goat:    { name: 'Goat', price: 180, board: 14, food: 'hay', speed: 0.9, size: 1 },
  sheep:   { name: 'Sheep', price: 220, board: 14, food: 'hay', speed: 0.7, size: 1 },
  pig:     { name: 'Pig', price: 260, board: 16, food: 'pig feed', speed: 0.6, size: 1 },
  chicken: { name: 'Hen', price: 25, board: 4, food: 'corn', speed: 0.8, size: 1 },
};
const VARIANTS = {
  goat: [{ body: 0xf0ece4, face: 0xf0ece4 }, { body: 0x8a5a3a, face: 0x2a1a10 }, { body: 0x2a2420, face: 0xe8e0d0 }, { body: 0xc89a6a, face: 0xc89a6a }],
  sheep: [{ body: 0xeee8da, face: 0x1a1612 }, { body: 0xf2ecde, face: 0xf0e8dc }, { body: 0x5a4a40, face: 0x2a2220 }],
  pig: [{ body: 0xf0b8a8, spots: null }, { body: 0xf0c0b0, spots: 0x2a2020 }, { body: 0x3a2a28, spots: null }],
  chicken: [{ body: 0xa8582a }, { body: 0xf4f0e8 }, { body: 0x2a2a2a }, { body: 0xd8a050 }],
};

function quadruped(kind, v, R){
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const legs = [];
  const P = {
    goat:  { len: 0.85, h: 0.72, r: 0.2, ry: 0.24, legL: 0.48, neckLen: 0.3, headL: 0.24, legR: 0.03 },
    sheep: { len: 0.95, h: 0.72, r: 0.27, ry: 0.28, legL: 0.42, neckLen: 0.2, headL: 0.22, legR: 0.028 },
    pig:   { len: 1.05, h: 0.62, r: 0.3, ry: 0.3, legL: 0.28, neckLen: 0.05, headL: 0.26, legR: 0.045 },
  }[kind];
  const bodyMat = kind === 'sheep' ? mat('wool', { color: v.body, rough: 1, normal: 2 }) : kind === 'pig' ? mat('skin', { color: v.body, rough: 0.55 }) : mat('coat', { color: v.body, rough: 0.7 });
  const faceMat = kind === 'sheep' ? mat('skin', { color: v.face, rough: 0.7 }) : kind === 'pig' ? bodyMat : mat('coat', { color: v.face, rough: 0.7 });
  const cy = P.legL + P.ry * 0.9, L = P.len;
  const sec = (z, rx, ry, dy = 0) => ({ p: [0, cy + dy, z], rx, ry });
  const bodyG = loft([sec(-L / 2, P.r * 0.4, P.ry * 0.4), sec(-L / 2 + 0.08, P.r * 0.85, P.ry * 0.85), sec(-L * 0.15, P.r, P.ry), sec(L * 0.15, P.r * 0.98, P.ry * 0.98), sec(L / 2 - 0.1, P.r * 0.8, P.ry * 0.85, 0.02), sec(L / 2, P.r * 0.4, P.ry * 0.5, 0.03)], { ring: 18, steps: 5, uvScale: 2 });
  if (kind === 'sheep'){
    // lumpy fleece
    const p = bodyG.attributes.position;
    for (let i = 0; i < p.count; i++){ const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const k = 1 + (Math.sin(x * 40) * Math.sin(y * 37) * Math.sin(z * 41)) * 0.03; p.setXYZ(i, x * k, cy + (y - cy) * k, z); }
    bodyG.computeVertexNormals();
  }
  const bm = new THREE.Mesh(bodyG, bodyMat); body.add(bm);
  if (v.spots){
    for (let i = 0; i < 5; i++){ const s = new THREE.Mesh(ellipsoid(0.12, 0.1, 0.14), mat('skin', { color: v.spots, rough: 0.55 })); const a = R() * Math.PI; s.position.set(Math.cos(a) * P.r * 0.88, cy + Math.sin(a) * P.ry * 0.85, (R() - 0.5) * L * 0.7); s.scale.set(0.35, 1, 1); s.lookAt(0, cy, s.position.z); body.add(s); }
  }
  // neck and head
  const neck = new THREE.Group(); neck.position.set(0, cy + P.ry * 0.4, L / 2 - 0.08); body.add(neck);
  if (P.neckLen > 0.1){
    const ng = loft([{ p: [0, -0.05, -0.05], rx: P.r * 0.5, ry: P.r * 0.55 }, { p: [0, P.neckLen * 0.6, P.neckLen * 0.4], rx: P.r * 0.38, ry: P.r * 0.4 }, { p: [0, P.neckLen, P.neckLen * 0.55], rx: P.r * 0.33, ry: P.r * 0.35 }], { ring: 12, steps: 4 });
    neck.add(new THREE.Mesh(ng, kind === 'sheep' ? bodyMat : bodyMat));
  }
  const head = new THREE.Group(); head.position.set(0, P.neckLen, P.neckLen * 0.6); neck.add(head);
  if (kind === 'pig'){
    head.position.set(0, -0.05, 0.12);
    head.add(new THREE.Mesh(loft([{ p: [0, 0, -0.1], rx: 0.17, ry: 0.17 }, { p: [0, -0.02, 0.06], rx: 0.14, ry: 0.13 }, { p: [0, -0.04, 0.18], rx: 0.08, ry: 0.07 }, { p: [0, -0.04, 0.24], rx: 0.07, ry: 0.06 }], { ring: 14, steps: 4 }), bodyMat));
    const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.065, 0.03, 16), mat('skin', { color: 0xe09a90, rough: 0.5 })); snout.rotation.x = Math.PI / 2; snout.position.set(0, -0.04, 0.25); head.add(snout);
    for (const sx of [-1, 1]){
      const n = new THREE.Mesh(new THREE.CircleGeometry(0.012, 8), mat('plain-nostril', { color: 0x3a2020 })); n.position.set(sx * 0.022, -0.04, 0.266); head.add(n);
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.12, 3), bodyMat); ear.position.set(sx * 0.09, 0.1, 0.0); ear.rotation.set(0.9, 0, sx * -0.5); head.add(ear);
    }
  } else {
    const hl = P.headL;
    head.add(new THREE.Mesh(loft([{ p: [0, 0.02, -0.05], rx: 0.065, ry: 0.07 }, { p: [0, -0.04, 0.05], rx: 0.06, ry: 0.065 }, { p: [0, -0.1, hl * 0.6], rx: 0.045, ry: 0.045 }, { p: [0, -0.13, hl * 0.85], rx: 0.04, ry: 0.035 }], { ring: 12, steps: 4 }), faceMat));
    for (const sx of [-1, 1]){
      const ear = new THREE.Mesh(ellipsoid(0.02, 0.05, 0.012), faceMat); ear.position.set(sx * 0.075, 0.02, -0.02); ear.rotation.z = sx * (kind === 'sheep' ? 1.3 : 1.1); head.add(ear);
      if (kind === 'goat'){ const horn = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.13, 8), mat('plain-horn', { color: 0x8a7a60, rough: 0.5 })); horn.position.set(sx * 0.03, 0.08, -0.06); horn.rotation.x = -0.6; head.add(horn); }
    }
    if (kind === 'goat'){ const beard = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.08, 6), faceMat); beard.position.set(0, -0.17, hl * 0.6); beard.rotation.x = Math.PI; head.add(beard); }
  }
  const eyeM = mat('plain-eye2', { color: 0x1a1208, rough: 0.15 });
  for (const sx of [-1, 1]){ const e = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), eyeM); e.position.set(sx * (kind === 'pig' ? 0.1 : 0.058), kind === 'pig' ? 0.05 : -0.01, kind === 'pig' ? 0.09 : 0.04); head.add(e); }
  // tail
  const tail = new THREE.Group(); tail.position.set(0, cy + P.ry * 0.5, -L / 2 + 0.02); body.add(tail);
  if (kind === 'pig'){ const t = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.008, 6, 12, Math.PI * 1.6), bodyMat); t.rotation.y = Math.PI / 2; t.position.z = -0.03; tail.add(t); }
  else { const t = new THREE.Mesh(ellipsoid(0.03, kind === 'sheep' ? 0.1 : 0.06, 0.03), kind === 'sheep' ? bodyMat : bodyMat); t.position.y = kind === 'goat' ? 0.04 : -0.07; t.rotation.x = kind === 'goat' ? -0.6 : 0.2; tail.add(t); }
  // legs: swing from the hip and shoulder
  const legMat = kind === 'sheep' ? faceMat : bodyMat;
  const hoofMat = mat('plain-hoof', { color: kind === 'pig' ? 0x6a5040 : 0x2a2420, rough: 0.6 });
  for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]){
    const top = new THREE.Group(); top.position.set(x * P.r * 0.55, P.legL + 0.05, z * (L / 2 - 0.16)); body.add(top);
    top.add(new THREE.Mesh(limb(P.legL + 0.05, P.legR * 1.6, P.legR, { seg: 8 }), legMat));
    const h = new THREE.Mesh(new THREE.CylinderGeometry(P.legR, P.legR * 1.1, 0.04, 8), hoofMat); h.position.y = -P.legL - 0.03; top.add(h);
    legs.push(top);
  }
  g.traverse((m) => { if (m.isMesh){ m.castShadow = true; m.receiveShadow = true; } });
  return { g, body, neck, head, tail, legs, P };
}

function hen(v){
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const fm = mat('feathers', { color: v.body, rough: 0.8 });
  const b = new THREE.Mesh(ellipsoid(0.12, 0.13, 0.17, 14, 10), fm); b.position.y = 0.26; body.add(b);
  const tailF = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.16, 8), fm); tailF.position.set(0, 0.36, -0.14); tailF.rotation.x = -0.8; body.add(tailF);
  for (const sx of [-1, 1]){ const w = new THREE.Mesh(ellipsoid(0.03, 0.08, 0.12), fm); w.position.set(sx * 0.11, 0.27, -0.01); body.add(w); }
  const neck = new THREE.Group(); neck.position.set(0, 0.32, 0.1); body.add(neck);
  const head = new THREE.Group(); head.position.set(0, 0.1, 0.03); neck.add(head);
  neck.add(new THREE.Mesh(ellipsoid(0.05, 0.08, 0.05), fm));
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), fm));
  const comb = new THREE.Mesh(ellipsoid(0.01, 0.035, 0.04), mat('plain-comb', { color: 0xd02020, rough: 0.5 })); comb.position.set(0, 0.05, 0.0); head.add(comb);
  const wattle = new THREE.Mesh(ellipsoid(0.01, 0.025, 0.015), mat('plain-comb', { color: 0xd02020, rough: 0.5 })); wattle.position.set(0, -0.04, 0.04); head.add(wattle);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.04, 6), mat('plain-beak', { color: 0xe0b030, rough: 0.5 })); beak.rotation.x = Math.PI / 2; beak.position.set(0, 0, 0.055); head.add(beak);
  for (const sx of [-1, 1]){ const e = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 4), mat('plain-eye2', { color: 0x1a1208, rough: 0.15 })); e.position.set(sx * 0.035, 0.01, 0.03); head.add(e); }
  const legs = [];
  for (const sx of [-1, 1]){
    const top = new THREE.Group(); top.position.set(sx * 0.05, 0.16, 0.0); body.add(top);
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 6), mat('plain-beak', { color: 0xe0b030, rough: 0.5 })); l.position.y = -0.08; top.add(l);
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.008, 0.06), mat('plain-beak', { color: 0xe0b030, rough: 0.5 })); f.position.set(0, -0.16, 0.02); top.add(f);
    legs.push(top);
  }
  g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  return { g, body, neck, head, tail: tailF, legs, P: { legL: 0.16 } };
}

let nextId = 1;
export class Animal {
  constructor(kind, data = {}){
    this.kind = kind;
    const R = rng(data.seed || Math.floor(Math.random() * 1e6));
    const vs = VARIANTS[kind];
    this.data = {
      id: data.id || ('a' + Date.now().toString(36) + (nextId++)), kind, name: data.name || randomName(kind, R), variant: data.variant ?? Math.floor(R() * vs.length),
      seed: data.seed || Math.floor(R() * 1e6), food: 80, water: 80, happy: 75, health: 100, wool: 0.3, owner: null, ...data,
    };
    const v = vs[this.data.variant % vs.length];
    this.m = kind === 'chicken' ? hen(v) : quadruped(kind, v, R);
    this.root = this.m.g;
    this.pos = V(); this.yaw = R() * 6.28; this.speed = 0; this.target = null; this.wait = R() * 3; this.act = 'idle'; this.t = R() * 10;
    this.pen = null;
  }
  place(pen){
    this.pen = pen;
    this.pos.set(lerp(pen.x0 + 1, pen.x1 - 1, Math.random()), 0, lerp(pen.z0 + 2, pen.z1 - 1, Math.random()));
    this.root.position.copy(this.pos);
  }
  // pen: { x0, x1, z0, z1, feedPos, waterPos, feedAmt, waterAmt, center }, night: true at night
  update(dt, pen, night, player){
    this.t += dt;
    const D = this.data;
    this.wait -= dt;
    if (!this.target && this.wait <= 0){
      // what to do next
      const r = Math.random();
      if (night){ this.target = pen.center.clone().add(V((Math.random() - 0.5) * 3, 0, -2 + (Math.random() - 0.5) * 1.5)); this.act = 'sleep'; }
      else if (D.food < 75 && pen.feedAmt > 0 && r < 0.6){ this.target = pen.feedPos.clone().add(V((Math.random() - 0.5) * 1.1, 0, -0.55)); this.act = 'eat'; }
      else if (D.water < 75 && pen.waterAmt > 0 && r < 0.8){ this.target = pen.waterPos.clone().add(V((Math.random() - 0.5) * 0.9, 0, -0.6)); this.act = 'drink'; }
      else { this.target = V(lerp(pen.x0 + 0.8, pen.x1 - 0.8, Math.random()), 0, lerp(pen.z0 + 0.8, pen.z1 - 0.8, Math.random())); this.act = this.kind === 'pig' && pen.wallow && Math.random() < 0.3 ? 'wallow' : 'graze'; if (this.act === 'wallow') this.target = pen.wallow.position.clone().setY(0); }
    }
    let moving = false;
    if (this.target){
      const dx = this.target.x - this.pos.x, dz = this.target.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.15){ this.target = null; this.wait = this.act === 'sleep' ? 30 : this.act === 'graze' ? 2 + Math.random() * 6 : 4 + Math.random() * 4; this.doing = this.act; this.doT = this.wait; }
      else {
        const want = Math.atan2(dx, dz);
        this.yaw += clamp(angleDiff(this.yaw, want), -dt * 3, dt * 3);
        const sp = SPECIES[this.kind].speed * (Math.abs(angleDiff(this.yaw, want)) < 0.6 ? 1 : 0.2);
        this.pos.x += Math.sin(this.yaw) * sp * dt; this.pos.z += Math.cos(this.yaw) * sp * dt; moving = true;
      }
    }
    // keep inside the pen
    this.pos.x = clamp(this.pos.x, pen.x0 + 0.4, pen.x1 - 0.4); this.pos.z = clamp(this.pos.z, pen.z0 + 0.4, pen.z1 - 0.4);
    // doing things
    let headDown = 0;
    if (!moving && this.doT > 0){
      this.doT -= dt;
      if (this.doing === 'eat' && pen.feedAmt > 0){ headDown = 1; const e = Math.min(pen.feedAmt, dt * 0.02); pen.feedAmt -= e; D.food = Math.min(100, D.food + e * 600); }
      if (this.doing === 'drink' && pen.waterAmt > 0){ headDown = 1; const e = Math.min(pen.waterAmt, dt * 0.02); pen.waterAmt -= e; D.water = Math.min(100, D.water + e * 600); }
      if (this.doing === 'graze') headDown = this.kind === 'chicken' ? (Math.sin(this.t * 7) > 0.3 ? 1 : 0) : 0.7;
      if (this.doing === 'wallow'){ D.happy = Math.min(100, D.happy + dt * 0.5); }
    }
    // pose
    const m = this.m;
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    const sleeping = this.doing === 'sleep' && !moving && this.doT > 0;
    const sw = moving ? Math.sin(this.t * 9) * 0.4 : 0;
    m.legs.forEach((l, i) => { l.rotation.x = (i === 0 || i === 3 ? sw : -sw) * (this.kind === 'chicken' ? 1.2 : 1); });
    m.body.position.y = sleeping ? -(m.P.legL * 0.75) : (moving ? Math.abs(Math.sin(this.t * 9)) * 0.015 : 0);
    m.legs.forEach((l) => { l.visible = !sleeping || this.kind === 'chicken'; });
    const wantNeck = headDown ? (this.kind === 'chicken' ? 0.9 : 0.9) : sleeping ? 0.3 : 0;
    m.neck.rotation.x = damp(m.neck.rotation.x, wantNeck, 8, dt);
    if (this.kind !== 'chicken' && player){
      const dx = player.x - this.pos.x, dz = player.z - this.pos.z;
      const look = clamp(angleDiff(this.yaw, Math.atan2(dx, dz)), -0.8, 0.8);
      m.head.rotation.y = damp(m.head.rotation.y, Math.hypot(dx, dz) < 5 && !headDown ? look : 0, 3, dt);
    }
    if (m.tail) m.tail.rotation.z = Math.sin(this.t * (this.kind === 'pig' ? 6 : 3)) * 0.2;
    this.moving = moving;
  }
}

const NAMES = {
  goat: ['Billy', 'Nanny', 'Pepper', 'Clover', 'Biscuit', 'Gruff', 'Daisy', 'Juniper', 'Maple', 'Nutmeg'],
  sheep: ['Woolly', 'Dolly', 'Fluffy', 'Lamb Chop', 'Cotton', 'Shaun', 'Snowball', 'Bramble', 'Puff', 'Marshmallow'],
  pig: ['Wilbur', 'Hamlet', 'Truffle', 'Peanut', 'Rosie', 'Pickles', 'Porkchop', 'Penny', 'Bacon Bit', 'Hazel'],
  chicken: ['Henrietta', 'Nugget', 'Pip', 'Goldie', 'Peck', 'Ginger', 'Feathers', 'Omelette', 'Cluck', 'Sunny'],
};
function randomName(kind, R){ const n = NAMES[kind]; return n[Math.floor(R() * n.length)]; }
