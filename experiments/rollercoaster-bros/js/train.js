// The train: three cars of four seats, in one of several styles, running round the track.
// Speed: the station launches it at the speed you pick; after that, going down makes it faster and
// going up slower (it never quite stops, so it always gets round a loop), then it brakes back into the
// station, lets riders off and on, and goes again.
import * as THREE from 'three';
import { V, clamp, damp, rng } from './util.js';
import { BASE_Y } from './track.js';

export const CARTS = [
  { id: 'classic', name: 'Classic Red', price: 0, text: 'A shiny red train.' },
  { id: 'ocean', name: 'Ocean Wave', price: 300, text: 'Blue and white, with fins.' },
  { id: 'lightning', name: 'Lightning', price: 800, text: 'Yellow and black, super fast looking.' },
  { id: 'dragon', name: 'Dragon', price: 1500, text: 'A green dragon with wings and spikes.' },
  { id: 'shark', name: 'Shark', price: 2200, text: 'Grey shark with a big fin and teeth.' },
  { id: 'rocket', name: 'Rocket', price: 3000, text: 'A space rocket with flames out the back!' },
  { id: 'rainbow', name: 'Rainbow', price: 4000, text: 'Every car a different colour.' },
  { id: 'gold', name: 'Golden King', price: 7000, text: 'Solid gold, with a crown.' },
];
export const SPEEDS = [
  { name: 'Slow', v: 6, icon: '🐢' }, { name: 'Gentle', v: 9, icon: '🙂' }, { name: 'Normal', v: 12, icon: '😃' },
  { name: 'Fast', v: 16, icon: '😆' }, { name: 'Turbo', v: 21, icon: '🚀' },
];
export const SEATS = [[-0.32, -0.35], [0.32, -0.35], [-0.32, 0.55], [0.32, 0.55]];   // x, z in a car
export const CAR_GAP = 2.6, PARK = 13, SEAT_Y = 0.48;

const matCache = new Map();
function mat(color, metal = 0.2, rough = 0.5, emissive = 0){
  const k = color + ':' + metal + ':' + rough + ':' + emissive;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough, emissive: emissive ? color : 0, emissiveIntensity: emissive }));
  return matCache.get(k);
}
function box(parent, w, h, d, m, x, y, z, rx = 0, ry = 0, rz = 0){
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.rotation.set(rx, ry, rz);
  b.castShadow = true; parent.add(b); return b;
}
function cyl(parent, r0, r1, h, m, x, y, z, rx = 0, ry = 0, rz = 0, seg = 12){
  const c = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, h, seg), m); c.position.set(x, y, z); c.rotation.set(rx, ry, rz);
  c.castShadow = true; parent.add(c); return c;
}
function ball(parent, r, m, x, y, z, sx = 1, sy = 1, sz = 1){
  const b = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), m); b.position.set(x, y, z); b.scale.set(sx, sy, sz); b.castShadow = true; parent.add(b); return b;
}

const RAINBOW = [0xe83a3a, 0xf0a020, 0x3ab84a, 0x3a7ae8, 0x9a4ad8];
// Build one car. Local frame: -Z is forward, +Y up, the rails at y = 0.
function buildCar(style, index, count){
  const g = new THREE.Group();
  const front = index === 0, back = index === count - 1;
  const S = {
    classic: { body: 0xd8282a, trim: 0xf0f0f0, seat: 0x2a2a2a, metal: 0.35 },
    ocean: { body: 0x1e6ad8, trim: 0xffffff, seat: 0x0e2a5a, metal: 0.3 },
    lightning: { body: 0xf6cc1a, trim: 0x1a1a1a, seat: 0x1a1a1a, metal: 0.3 },
    dragon: { body: 0x2a9a3a, trim: 0xe8c040, seat: 0x5a2a1a, metal: 0.15 },
    shark: { body: 0x7a8a9a, trim: 0xf4f4f4, seat: 0x2a3a4a, metal: 0.25 },
    rocket: { body: 0xe8eaf0, trim: 0xd8302a, seat: 0x2a2a3a, metal: 0.3 },
    rainbow: { body: RAINBOW[index % RAINBOW.length], trim: 0xffffff, seat: 0x3a2a5a, metal: 0.3 },
    gold: { body: 0xf4c430, trim: 0x7a2ab0, seat: 0x6a1a8a, metal: 0.45 },
  }[style];
  const body = mat(S.body, S.metal, style === 'gold' ? 0.25 : 0.4), trim = mat(S.trim, 0.3, 0.4), seat = mat(S.seat, 0.05, 0.8);
  const dark = mat(0x2a2a2e, 0.4, 0.5), chrome = mat(0xd8dce4, 0.5, 0.3);
  // under-frame and wheels round the rails
  box(g, 1.25, 0.16, 2.1, dark, 0, 0.2, 0);
  g.userData.wheels = [];
  for (const x of [-0.55, 0.55]) for (const z of [-0.75, 0.75]){
    const w = cyl(g, 0.13, 0.13, 0.12, dark, x, 0.13, z, 0, 0, Math.PI / 2, 10);
    g.userData.wheels.push(w);
    box(g, 0.08, 0.32, 0.1, dark, x * 1.12, 0.05, z);
  }
  // tub
  box(g, 1.5, 0.16, 2.2, body, 0, 0.32, 0);
  for (const s of [-1, 1]) box(g, 0.12, 0.55, 2.2, body, s * 0.72, 0.62, 0);
  box(g, 1.5, 0.6, 0.12, body, 0, 0.62, 1.08);
  for (const sx of [-1, 1]) box(g, 0.16, 0.08, 2.28, trim, sx * 0.72, 0.92, 0);     // the rim round the top
  box(g, 1.56, 0.08, 0.14, trim, 0, 0.92, 1.1);
  for (const s of [-1, 1]) box(g, 0.14, 0.1, 2.26, trim, s * 0.73, 0.5, 0);
  // seats and lap bars
  for (const z of [-0.35, 0.55]){
    box(g, 1.3, 0.12, 0.5, seat, 0, SEAT_Y - 0.06, z);
    box(g, 1.3, 0.62, 0.1, seat, 0, SEAT_Y + 0.28, z + 0.26, -0.12);
    box(g, 1.2, 0.06, 0.06, chrome, 0, 0.86, z - 0.3);
    for (const s of [-1, 1]) box(g, 0.05, 0.3, 0.05, chrome, s * 0.6, 0.72, z - 0.26);
  }
  // nose (every car has a bumper; the front car gets the style's face)
  box(g, 1.5, 0.42, 0.3, body, 0, 0.52, -1.15);
  if (front){
    box(g, 1.5, 0.4, 0.6, body, 0, 0.42, -1.5, 0.3);
    for (const s of [-1, 1]) ball(g, 0.1, mat(0xfff6c0, 0, 0.3, 1.2), s * 0.5, 0.62, -1.82);
  }
  // style extras
  if (style === 'classic'){
    if (front) box(g, 0.5, 0.18, 0.05, mat(0xffd84a, 0.6, 0.3), 0, 0.72, -1.82);
  } else if (style === 'ocean'){
    for (const s of [-1, 1]) for (let k = 0; k < 3; k++) box(g, 0.02, 0.07, 0.4, trim, s * 0.79, 0.55 + k * 0.1, -0.6 + k * 0.5, 0, 0, 0);
    const fin = box(g, 0.08, 0.5, 0.6, trim, 0, 1.1, 0.95, -0.5); fin.scale.set(1, 1, 1);
  } else if (style === 'lightning'){
    for (const s of [-1, 1]){
      const bolt = new THREE.Shape([[0, 0], [0.35, 0.25], [0.2, 0.25], [0.6, 0.55], [0.18, 0.32], [0.33, 0.32]].map(([x, y]) => new THREE.Vector2(x, y)));
      const m = new THREE.Mesh(new THREE.ShapeGeometry(bolt), mat(0x1a1a1a, 0.2, 0.5)); m.position.set(s * 0.785, 0.38, s > 0 ? -0.6 : 0.6); m.rotation.y = s * Math.PI / 2; m.scale.setScalar(1.4); g.add(m);
    }
    if (front) for (const s of [-1, 1]) box(g, 0.08, 0.06, 0.8, mat(0x1a1a1a, 0.3, 0.4), s * 0.45, 0.8, -1.5, 0.35);
  } else if (style === 'dragon'){
    const scale = mat(0xe8c040, 0.2, 0.5);
    for (let k = 0; k < 3; k++) cyl(g, 0.12, 0.0, 0.3, scale, 0, 1.05, -0.8 + k * 0.7, 0, 0, 0, 4);
    for (const s of [-1, 1]){
      const wing = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape([[0, 0], [0.9, 0.2], [1.1, 0.7], [0.7, 0.45], [0.5, 0.75], [0.3, 0.4], [0, 0.5]].map(([x, y]) => new THREE.Vector2(x, y)))), mat(0x1e7a2a, 0.1, 0.6));
      wing.material.side = THREE.DoubleSide; wing.position.set(s * 0.78, 0.65, 0.2); wing.rotation.set(0, s > 0 ? 0 : Math.PI, -0.2); wing.rotation.order = 'YXZ'; wing.rotation.x = 0;
      wing.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2; wing.rotation.z = 0; wing.scale.setScalar(0.9);
      g.add(wing); (g.userData.flap || (g.userData.flap = [])).push(wing);
    }
    if (front){
      const head = new THREE.Group(); head.position.set(0, 1.0, -1.85); g.add(head);
      box(head, 0.6, 0.45, 0.8, body, 0, 0, -0.1);
      box(head, 0.5, 0.25, 0.5, body, 0, -0.08, -0.6);
      for (const s of [-1, 1]){
        ball(head, 0.09, mat(0xffe040, 0, 0.3, 0.8), s * 0.24, 0.12, -0.35);
        ball(head, 0.045, mat(0x101010, 0, 0.3), s * 0.29, 0.13, -0.42);
        cyl(head, 0.07, 0.0, 0.35, scale, s * 0.18, 0.35, 0.05, -0.5, 0, s * -0.3, 6);
        ball(head, 0.035, mat(0x101010, 0, 0.5), s * 0.12, 0.0, -0.86);
      }
      for (let k = 0; k < 4; k++) cyl(head, 0.03, 0.0, 0.1, mat(0xffffff, 0, 0.4), -0.18 + k * 0.12, -0.24, -0.78, Math.PI, 0, 0, 5);
      g.userData.head = head;
    }
    if (back){ const tail = cyl(g, 0.18, 0.02, 1.4, body, 0, 0.6, 1.8, Math.PI / 2 - 0.2, 0, 0, 8); g.userData.tail = tail; }
  } else if (style === 'shark'){
    box(g, 0.08, 0.7, 0.7, body, 0, 1.2, 0.85, -0.6).geometry.translate(0, 0, 0);
    for (const s of [-1, 1]) box(g, 0.02, 0.2, 0.3, mat(0x40505a, 0, 0.6), s * 0.79, 0.62, -0.75, 0, 0, 0);
    if (front){
      box(g, 1.3, 0.12, 0.5, mat(0xf4f4f4, 0, 0.5), 0, 0.3, -1.6, 0.35);
      for (let k = 0; k < 7; k++) cyl(g, 0.05, 0, 0.13, mat(0xffffff, 0, 0.4), -0.54 + k * 0.18, 0.42, -1.75, 0, 0, 0, 4);
      for (const s of [-1, 1]) ball(g, 0.07, mat(0x101010, 0, 0.2), s * 0.62, 0.72, -1.52);
    }
  } else if (style === 'rocket'){
    for (const s of [-1, 1]) box(g, 0.05, 0.5, 0.7, trim, s * 0.95, 0.45, 0.7, 0, 0, s * 0.4);
    box(g, 0.05, 0.6, 0.6, trim, 0, 1.15, 0.85);
    if (front) cyl(g, 0.45, 0.04, 1.0, trim, 0, 0.5, -1.95, -Math.PI / 2, 0, 0, 16);
    if (back){
      const flame = cyl(g, 0.4, 0.0, 1.4, new THREE.MeshBasicMaterial({ color: 0xffa020, transparent: true, opacity: 0.85 }), 0, 0.6, 1.95, Math.PI / 2, 0, 0, 12);
      flame.castShadow = false; g.userData.flame = flame;
      cyl(g, 0.45, 0.45, 0.2, dark, 0, 0.6, 1.2, Math.PI / 2, 0, 0, 12);
    }
  } else if (style === 'rainbow'){
    for (const sx of [-1, 1]) for (let k = 0; k < 5; k++) box(g, 0.03, 0.08, 2.2, mat(RAINBOW[(k + index + 1) % 5], 0.3, 0.4), sx * 0.785, 0.4 + k * 0.09, 0);
  } else if (style === 'gold'){
    for (const s of [-1, 1]) for (let k = 0; k < 4; k++) ball(g, 0.06, mat([0xe82a4a, 0x2ae84a, 0x2a6ae8, 0xe82ad8][k], 0.2, 0.15, 0.3), s * 0.79, 0.65, -0.75 + k * 0.5);
    if (front){
      const crown = new THREE.Group(); crown.position.set(0, 0.72, -1.72); crown.scale.setScalar(0.6); g.add(crown);
      cyl(crown, 0.35, 0.35, 0.18, body, 0, 0, 0, 0, 0, 0, 16);
      for (let k = 0; k < 6; k++){ const a = k / 6 * Math.PI * 2; cyl(crown, 0.07, 0.0, 0.25, body, Math.sin(a) * 0.33, 0.2, Math.cos(a) * 0.33, 0, 0, 0, 5); ball(crown, 0.035, mat(0xe82a4a, 0.1, 0.2, 0.4), Math.sin(a) * 0.33, 0.34, Math.cos(a) * 0.33); }
    }
  }
  return g;
}

// A person sitting in a seat (shirt, skin and hair to match the visitor).
export function buildRider(look){
  const g = new THREE.Group();
  const shirt = mat(look.shirt, 0, 0.8), skin = mat(look.skin, 0, 0.7), hair = mat(look.hair, 0, 0.9), pants = mat(look.pants, 0, 0.8);
  box(g, 0.34, 0.45, 0.22, shirt, 0, 0.27, 0.02);
  box(g, 0.32, 0.14, 0.42, pants, 0, 0.04, -0.12);
  const head = ball(g, 0.12, skin, 0, 0.64, 0.0);
  ball(g, 0.125, hair, 0, 0.69, 0.03, 1, 0.75, 1);
  for (const s of [-1, 1]) ball(head.parent, 0.022, mat(0x1a1a1a, 0, 0.5), s * 0.045, 0.66, -0.11);
  g.userData.arms = [];
  for (const s of [-1, 1]){
    const a = new THREE.Group(); a.position.set(s * 0.21, 0.44, 0.02); g.add(a);
    box(a, 0.09, 0.46, 0.09, shirt, 0, -0.2, 0);
    ball(a, 0.055, skin, 0, -0.45, 0);
    a.rotation.x = 0.9;
    g.userData.arms.push(a);
  }
  g.userData.raise = 0; g.userData.want = 0;
  return g;
}

export class Train {
  constructor(scene, track){
    this.scene = scene; this.track = track;
    this.group = new THREE.Group(); scene.add(this.group);
    this.count = 3;
    this.seats = new Array(this.count * 4).fill(null);     // a visitor, 'player', or null
    this.riderMeshes = new Array(this.count * 4).fill(null);
    this.s = PARK; this.v = 0; this.dist = 0; this.state = 'closed'; this.dwell = 3;
    this.listeners = {};
    this.rand = rng(7);
    this.tmp = {}; this.tmpB = {};
    this.setStyle('classic');
  }
  on(ev, fn){ (this.listeners[ev] || (this.listeners[ev] = [])).push(fn); }
  emit(ev, x){ for (const f of this.listeners[ev] || []) f(x); }
  setStyle(id){
    this.style = id;
    for (const c of this.cars || []) this.group.remove(c);
    this.cars = [];
    for (let k = 0; k < this.count; k++){ const c = buildCar(id, k, this.count); this.cars.push(c); this.group.add(c); }
    for (let i = 0; i < this.seats.length; i++){ const r = this.riderMeshes[i]; this.riderMeshes[i] = null; if (r) this.seatRider(i, this.seats[i]); }
    this.pose(0);
  }
  seatRider(i, who){
    const old = this.riderMeshes[i];
    if (old && old.parent) old.parent.remove(old);
    this.riderMeshes[i] = null;
    this.seats[i] = who;
    if (!who || who === 'player') return;
    const r = buildRider(who.look);
    const [x, z] = SEATS[i % 4];
    r.position.set(x, SEAT_Y, z);
    this.cars[Math.floor(i / 4)].add(r);
    this.riderMeshes[i] = r;
  }
  emptySeats(){ const out = []; for (let i = 0; i < this.seats.length; i++) if (!this.seats[i]) out.push(i); return out; }
  riders(){ return this.seats.filter((x) => x && x !== 'player'); }
  // back to the station at once (the track was changed)
  reset(){
    this.s = PARK; this.v = 0; this.dist = 0; this.state = this.track.complete ? 'loading' : 'closed'; this.dwell = 4;
    this.pose(0);
  }
  get atStation(){ return this.state === 'loading' || this.state === 'closed'; }

  update(dt, v0, time){
    const T = this.track;
    if (!T.complete){ this.state = 'closed'; this.s = PARK; this.v = 0; this.pose(dt, time); return; }
    if (this.state === 'closed'){ this.state = 'loading'; this.dwell = 4; }
    if (this.state === 'loading'){
      this.v = 0; this.s = PARK; this.dist = 0;
      this.dwell -= dt;
      if (this.dwell <= 0){ this.state = 'running'; this.emit('dispatch'); }
    } else {
      const mid = T.at(this.s - CAR_GAP, this.tmp);
      const want = T.speedAt(mid.pos.y, v0);
      const left = T.length - this.dist;
      let v = Math.min(want, this.v + 6 * dt);                     // launch
      v = Math.min(v, Math.sqrt(2 * 5 * Math.max(0, left)) + 0.4);  // brakes coming into the station
      this.v = v;
      this.dist += v * dt;
      if (this.dist >= T.length){ this.dist = T.length; this.s = PARK; this.state = 'loading'; this.dwell = 5; this.v = 0; this.emit('arrive'); }
      else this.s = PARK + this.dist;
    }
    this.pose(dt, time);
  }
  // put every car on the track
  pose(dt, time = 0){
    const T = this.track;
    if (!T.path || !T.path.length) return;
    const a = this.tmp, b = this.tmpB;
    const m = new THREE.Matrix4(), X = V(), Z = V();
    this.thrill = 0;
    for (let k = 0; k < this.cars.length; k++){
      const c = this.cars[k], sc = this.s - k * CAR_GAP;
      T.at(sc + 0.8, a); const pa = a.pos.clone(), up = a.up.clone();
      T.at(sc - 0.8, b); const pb = b.pos.clone(); up.add(b.up);
      const fwd = pa.clone().sub(pb).normalize();
      up.addScaledVector(fwd, -up.dot(fwd)).normalize();
      X.crossVectors(fwd, up).normalize(); Z.copy(fwd).negate();
      m.makeBasis(X, up, Z);
      c.quaternion.setFromRotationMatrix(m);
      c.position.copy(pa).add(pb).multiplyScalar(0.5);
      for (const w of c.userData.wheels) w.rotation.x -= this.v * dt / 0.13;
      if (k === 0){ this.frontUp = up.clone(); this.frontFwd = fwd.clone(); }
      // how exciting is it right now? (going fast, falling, upside down)
      const th = clamp((this.v - 9) / 8) + clamp(-fwd.y * 2) + (up.y < 0.2 ? 1 : 0) + (a.gap ? 1 : 0);
      this.thrill = Math.max(this.thrill, th);
      if (c.userData.flame){ const f = c.userData.flame; f.scale.set(1, 0.4 + this.v / 12 + Math.sin(time * 40) * 0.15, 1); f.visible = this.v > 1; }
      if (c.userData.flap) for (const [i, w] of c.userData.flap.entries()) w.rotation.z = Math.sin(time * (2 + this.v * 0.3) + i * Math.PI) * 0.35;
      if (c.userData.tail) c.userData.tail.rotation.z = Math.sin(time * 3) * 0.3;
    }
    // riders put their hands up on the exciting bits
    for (let i = 0; i < this.riderMeshes.length; i++){
      const r = this.riderMeshes[i]; if (!r) continue;
      const u = r.userData;
      if (this.rand() < dt * 2) u.want = this.thrill > 0.6 + (i % 3) * 0.25 ? 1 : 0;
      u.raise = damp(u.raise, u.want, 5, dt);
      u.arms.forEach((arm, j) => { arm.rotation.x = 0.9 + u.raise * (2.0 + 0.2 * Math.sin(time * 9 + i + j)); arm.rotation.z = (j ? 1 : -1) * u.raise * 0.35; });
    }
  }
  // where your eyes are when you ride in the front seat
  seatEye(out = V()){ return this.cars[0].localToWorld(out.set(-0.32, SEAT_Y + 0.8, -0.3)); }
}
void BASE_Y;
