// The vehicles: the big open-sided tour trucks that carry visitors round the loop, the staff jeeps
// (vet, keeper, mechanic) that go out to jobs, and the manager's jeep that you can drive yourself.
import * as THREE from 'three';
import { V, clamp, lerp, damp, smooth, boxUV, mergeGeometries, angleDiff, textCanvas, roundRect } from './util.js';
import { canvasCloth } from './textures.js';
import { LANE, ZONES, IN, OUT } from './world.js';

const TAU = Math.PI * 2;
const mats = new Map();
function M(color, rough = 0.6, metal = 0.1, extra = {}){ const k = color + ':' + rough + ':' + metal + JSON.stringify(extra); if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra })); return mats.get(k); }

// a little helper to build one vehicle out of boxes and cylinders, merged per material
class Kit {
  constructor(){ this.parts = new Map(); }
  add(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0){
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V(1, 1, 1)));
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(g); return this;
  }
  box(w, h, d, mat, x, y, z, rx = 0, ry = 0, rz = 0){ return this.add(boxUV(w, h, d, 0.5), mat, x, y, z, rx, ry, rz); }
  cyl(r0, r1, h, mat, x, y, z, rx = 0, ry = 0, rz = 0, seg = 10){ return this.add(new THREE.CylinderGeometry(r1, r0, h, seg), mat, x, y, z, rx, ry, rz); }
  build(parent){ for (const [mat, list] of this.parts){ const m = new THREE.Mesh(mergeGeometries(list), mat); m.castShadow = true; m.receiveShadow = true; parent.add(m); } this.parts.clear(); }
}
function wheel(r, w){
  const g = new THREE.Group();
  const tyre = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 18).rotateZ(Math.PI / 2), M(0x1c1c1c, 0.85));
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.04, 10).rotateZ(Math.PI / 2), M(0xd8d0b8, 0.4, 0.5));
  tyre.castShadow = true; g.add(tyre, hub);
  // a tread line so you can see it turning
  const tread = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.06, r * 0.9), M(0x2e2e2e, 0.9)); tread.position.y = r * 0.55; g.add(tread);
  return g;
}

export const TRUCK_COLOURS = [
  { name: 'Safari Green', body: 0x4a5a32, trim: 0xe8d8a8 },
  { name: 'Sand', body: 0xc8a868, trim: 0x5a3a20 },
  { name: 'Zebra', body: 0xf0eee8, trim: 0x1a1a1a },
  { name: 'Sunset Orange', body: 0xd8702a, trim: 0xf4e8c8 },
  { name: 'Savanna Blue', body: 0x2a5a8a, trim: 0xf0e0b0 },
  { name: 'Lion Gold', body: 0xd8a82a, trim: 0x6a3a1a },
];
export const SEATS = 12;

// ---------- the tour truck ----------
export function buildTruck(colour, number){
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const C = TRUCK_COLOURS[colour % TRUCK_COLOURS.length];
  const paint = M(C.body, 0.45, 0.25), trim = M(C.trim, 0.55, 0.1), dark = M(0x1e1e1e, 0.7), metal = M(0x9a9a98, 0.35, 0.7);
  const glass = M(0x203040, 0.05, 0.3, { transparent: true, opacity: 0.45 }), seat = M(0x6a3a22, 0.6), floor = M(0x5a4a3a, 0.9);
  const k = new Kit();
  // chassis and cab (the cab is at the front, +z)
  k.box(2.3, 0.35, 7.0, dark, 0, 0.75, 0);
  k.box(2.5, 1.1, 2.0, paint, 0, 1.5, 2.6);                 // engine and cab lower
  k.box(2.4, 0.45, 1.3, paint, 0, 2.27, 2.25);               // cab upper (low, so riders can see over it)
  k.box(2.3, 0.4, 0.05, glass, 0, 2.3, 2.92, -0.2);         // windscreen
  k.box(2.52, 0.18, 0.15, metal, 0, 0.9, 3.62);             // bumper
  k.box(1.6, 0.6, 0.06, M(0x2a2a2a, 0.5, 0.5), 0, 1.5, 3.62); // grille
  for (const sx of [-0.85, 0.85]){ k.cyl(0.14, 0.14, 0.06, M(0xfff8e0, 0.2, 0.1, { emissive: 0x332a10 }), sx, 1.55, 3.64, Math.PI / 2); }
  // wheel arches
  for (const z of [2.4, -2.2]) for (const sx of [-1, 1]) k.box(0.3, 0.25, 1.5, paint, sx * 1.18, 1.25, z);
  // the passenger deck: a floor, low sides, benches, a canvas roof on posts
  k.box(2.5, 0.12, 4.8, floor, 0, 1.15, -1.0);
  for (const sx of [-1, 1]){ k.box(0.08, 0.55, 4.8, paint, sx * 1.22, 1.45, -1.0); k.box(0.1, 0.06, 4.8, trim, sx * 1.22, 1.75, -1.0); k.box(0.06, 0.06, 4.8, metal, sx * 1.22, 2.25, -1.0); }
  k.box(2.5, 0.55, 0.08, paint, 0, 1.45, -3.38);
  for (let r = 0; r < 4; r++){ const z = 0.6 - r * 1.15; k.box(2.2, 0.12, 0.5, seat, 0, 1.62, z); k.box(2.2, 0.55, 0.08, seat, 0, 1.92, z - 0.26); }
  for (const z of [1.25, -1.0, -3.3]) for (const sx of [-1, 1]) k.cyl(0.04, 0.04, 1.85, metal, sx * 1.2, 2.17, z);
  k.add(boxUV(2.7, 0.08, 5.0, 0.5), M(0xffffff, 0.95, 0, { map: canvasCloth() }), 0, 3.12, -1.0);
  k.box(2.75, 0.12, 0.08, trim, 0, 3.08, 1.5); k.box(2.75, 0.12, 0.08, trim, 0, 3.08, -3.5);
  // spare wheel on the back, a ladder, stripes
  k.cyl(0.5, 0.5, 0.3, dark, 0, 1.45, -3.6, Math.PI / 2);
  for (const sx of [-1, 1]) k.box(0.04, 0.12, 6.9, trim, sx * 1.26, 1.05, 0.1);
  k.build(body);
  // the number painted on the doors
  const tc = textCanvas(128, 128), c = tc.ctx;
  c.fillStyle = '#' + C.trim.toString(16).padStart(6, '0'); c.beginPath(); c.arc(64, 64, 56, 0, TAU); c.fill();
  c.fillStyle = '#' + C.body.toString(16).padStart(6, '0'); c.font = 'bold 80px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(number), 64, 70);
  for (const sx of [-1, 1]){ const d = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), new THREE.MeshStandardMaterial({ map: tc.tex, transparent: true, roughness: 0.6 })); d.position.set(sx * 1.256, 1.55, 2.6); d.rotation.y = sx * Math.PI / 2; body.add(d); }
  // wheels
  const wheels = [];
  for (const z of [2.4, -2.2]) for (const sx of [-1, 1]){ const w = wheel(0.58, 0.42); w.position.set(sx * 1.05, 0.58, z); body.add(w); wheels.push(w); }
  // hazard lights (flash when broken down)
  const hz = [];
  for (const [x, z] of [[-1.15, 3.55], [1.15, 3.55], [-1.15, -3.42], [1.15, -3.42]]){ const h = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.06), new THREE.MeshStandardMaterial({ color: 0xff9a20, emissive: 0x000000 })); h.position.set(x, 1.2, z); body.add(h); hz.push(h); }
  // where the riders sit (4 rows of 3), facing forward
  const seats = []; for (let r = 0; r < 4; r++) for (let i = 0; i < 3; i++) seats.push(V(-0.72 + i * 0.72, 1.68, 0.55 - r * 1.15));
  return { root, body, wheels, hz, seats, wheelR: 0.58 };
}

// a staff jeep (an open Land Rover kind of thing) or your own
export function buildJeep(kind){
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const col = { vet: 0xf0f0ec, keeper: 0x3a6a3a, mechanic: 0xd8782a, manager: 0x2a3a5a }[kind];
  const paint = M(col, 0.45, 0.25), dark = M(0x1e1e1e, 0.7), metal = M(0x9a9a98, 0.35, 0.7), seat = M(0x3a2a20, 0.7);
  const glass = M(0x203040, 0.05, 0.3, { transparent: true, opacity: 0.4 });
  const k = new Kit();
  k.box(1.8, 0.3, 4.0, dark, 0, 0.6, 0);
  k.box(1.85, 0.75, 1.5, paint, 0, 1.1, 1.2);       // bonnet
  k.box(1.85, 0.6, 2.5, paint, 0, 1.0, -0.8);       // tub
  k.box(1.7, 0.6, 0.05, glass, 0, 1.75, 0.45, -0.25);
  k.box(1.8, 0.06, 0.06, metal, 0, 2.06, 0.38);
  for (const sx of [-0.88, 0.88]) k.box(0.06, 0.65, 0.06, metal, sx, 1.72, 0.42, -0.25);
  for (const sx of [-0.45, 0.45]){ k.box(0.6, 0.12, 0.6, seat, sx, 1.3, -0.1); k.box(0.6, 0.6, 0.1, seat, sx, 1.6, -0.42); }
  k.box(1.6, 0.12, 0.6, seat, 0, 1.3, -1.2);
  // roll bar
  for (const sx of [-0.85, 0.85]) k.cyl(0.04, 0.04, 1.1, metal, sx, 1.85, -0.7);
  k.box(1.74, 0.07, 0.07, metal, 0, 2.38, -0.7);
  k.box(1.9, 0.14, 0.14, metal, 0, 0.75, 2.02);
  for (const sx of [-0.65, 0.65]) k.cyl(0.11, 0.11, 0.05, M(0xfff8e0, 0.2, 0.1, { emissive: 0x332a10 }), sx, 1.2, 1.97, Math.PI / 2);
  k.cyl(0.4, 0.4, 0.25, dark, 0, 1.2, -2.15, Math.PI / 2);   // spare wheel
  // the job's kit in the back
  if (kind === 'vet'){ k.box(0.7, 0.45, 0.5, M(0xf4f4f4, 0.5), 0, 1.5, -1.7); k.box(0.5, 0.12, 0.04, M(0xd82020, 0.5), 0, 1.5, -1.95); k.box(0.12, 0.4, 0.04, M(0xd82020, 0.5), 0, 1.5, -1.95); }
  if (kind === 'keeper'){ k.box(1.2, 0.5, 0.8, M(0xd8c890, 1), 0, 1.5, -1.6); k.cyl(0.25, 0.25, 0.6, M(0x2a5aa8, 0.5), 0.55, 1.6, -1.7); }
  if (kind === 'mechanic'){ k.box(0.9, 0.4, 0.5, M(0xc82a2a, 0.4, 0.3), 0, 1.45, -1.7); k.cyl(0.35, 0.35, 0.22, dark, 0.5, 1.6, -1.3, 0, 0, Math.PI / 2); }
  if (kind === 'manager'){ k.box(1.9, 0.08, 1.4, M(0xd8c8a0, 0.95, 0, { map: canvasCloth() }), 0, 2.42, -0.2); }
  k.build(body);
  if (kind === 'vet'){
    const tc = textCanvas(64, 64), c = tc.ctx; c.fillStyle = '#fff'; c.fillRect(0, 0, 64, 64); c.fillStyle = '#d02020'; c.fillRect(24, 8, 16, 48); c.fillRect(8, 24, 48, 16);
    for (const sx of [-1, 1]){ const d = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.45), new THREE.MeshStandardMaterial({ map: tc.tex })); d.position.set(sx * 0.932, 1.05, -0.8); d.rotation.y = sx * Math.PI / 2; body.add(d); }
  }
  const wheels = [];
  for (const z of [1.25, -1.25]) for (const sx of [-1, 1]){ const w = wheel(0.42, 0.3); w.position.set(sx * 0.85, 0.42, z); body.add(w); wheels.push(w); }
  // a driver
  const driver = person(kind === 'vet' ? 0xf0f0f0 : kind === 'mechanic' ? 0x2a4a8a : 0x7a6a3a, 0xc8946a, kind !== 'mechanic');
  driver.position.set(0.45, 0.62, -0.1); body.add(driver);
  return { root, body, wheels, driver, wheelR: 0.42 };
}
// a simple seated/standing person for drivers and staff
export function person(shirt, skin, hat){
  const g = new THREE.Group();
  const s = M(shirt, 0.85), sk = M(skin, 0.6), pants = M(0x4a4030, 0.9);
  const k = new Kit();
  k.box(0.36, 0.5, 0.22, s, 0, 1.15, 0); k.cyl(0.07, 0.07, 0.1, sk, 0, 1.45, 0);
  k.add(new THREE.SphereGeometry(0.12, 10, 8), sk, 0, 1.6, 0);
  for (const sx of [-0.1, 0.1]) k.box(0.13, 0.75, 0.15, pants, sx, 0.52, 0);
  for (const sx of [-0.23, 0.23]) k.box(0.09, 0.5, 0.1, s, sx, 1.12, 0);
  if (hat){ k.cyl(0.2, 0.2, 0.03, M(0xc8b080, 0.9), 0, 1.7, 0); k.cyl(0.11, 0.12, 0.12, M(0xc8b080, 0.9), 0, 1.76, 0); }
  k.build(g);
  return g;
}

// ---------- truck on the loop ----------
let truckId = 1;
export class Truck {
  constructor(world, data = {}){
    this.world = world;
    this.data = { id: data.id || ('t' + Date.now().toString(36) + (truckId++)), number: data.number || truckId, colour: data.colour ?? 0, condition: data.condition ?? 100, km: data.km || 0, ...data };
    this.m = buildTruck(this.data.colour, this.data.number);
    this.root = this.m.root; this.root.traverse((o) => { o.userData.truck = this; });
    world.scene.add(this.root);
    this.s = data.s ?? world.stationS; this.v = 0;
    this.state = 'station';       // 'station' | 'touring' | 'broken' | 'toDepot' | 'depot' | 'fromDepot'
    this.wait = 6; this.riders = []; this.broken = null; this.serviceNext = false; this.lapS = 0;
    this.offT = 0; this.pos = V(); this.fwd = V(0, 0, 1); this.player = false; this.hzT = 0;
    this.place(0);
  }
  get number(){ return this.data.number; }
  get condition(){ return this.data.condition; }
  setColour(c){ this.data.colour = c; const parent = this.root.parent; parent.remove(this.root); this.m = buildTruck(c, this.data.number); this.root = this.m.root; this.root.traverse((o) => { o.userData.truck = this; }); parent.add(this.root); this.place(0); }
  // where it is: on the road at s (or on its way into or out of the garage)
  place(dt){
    const W = this.world;
    let p, yaw, t;
    if (this.state === 'toDepot' || this.state === 'depot' || this.state === 'fromDepot'){
      // a curve off the road into the garage bay, and another back out further along
      const k = smooth(this.offT), c = W.depotPos;
      const out = this.state === 'fromDepot';
      const a = W.road(W.depotS + (out ? 14 : -14), LANE).p, mid = W.road(W.depotS + (out ? 5 : -5), LANE + 4).p;
      const q = (u) => V().copy(a).multiplyScalar((1 - u) ** 2).addScaledVector(mid, 2 * u * (1 - u)).addScaledVector(c, u * u);
      p = q(k); const p2 = q(Math.min(1, k + 0.02)), p1 = q(Math.max(0, k - 0.02));
      yaw = Math.atan2(p2.x - p1.x, p2.z - p1.z) + (out ? Math.PI : 0);
      p.y = W.height(p.x, p.z);
    } else {
      const R = W.road(this.s, LANE); p = R.p; t = R.t; yaw = Math.atan2(t.x, t.z);
    }
    this.pos.copy(p); this.fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
    // pitch with the slope
    const hF = W.height(p.x + this.fwd.x * 2.5, p.z + this.fwd.z * 2.5), hB = W.height(p.x - this.fwd.x * 2.5, p.z - this.fwd.z * 2.5);
    this.root.position.copy(p);
    this.root.rotation.set(0, yaw, 0);
    this.m.body.rotation.x = Math.atan2(hB - hF, 5);
    // a flat tyre makes it lean
    this.m.body.rotation.z = damp(this.m.body.rotation.z, this.broken && this.broken.kind === 'tyre' ? 0.06 : 0, 3, dt || 1);
    for (const w of this.m.wheels) w.rotation.x += this.v * (dt || 0) / this.m.wheelR;
    // hazard lights
    this.hzT += dt || 0;
    const on = this.broken && Math.floor(this.hzT * 2.5) % 2 === 0;
    for (const h of this.m.hz) h.material.emissive.setHex(on ? 0xff8a10 : 0x000000);
  }
  // ahead: the s of the truck in front (or null), animals in the way, etc. Returns the speed it wants.
  update(dt, ctx){
    const W = this.world, D = this.data;
    let want = 0;
    if (this.state === 'station'){
      this.v = 0; this.wait -= dt;
      if (this.wait <= 0 && !this.broken){
        if (ctx.canDepart(this)){ this.state = 'touring'; this.lapS = 0; ctx.onDepart(this); }
        else this.wait = 1;
      }
    }
    if (this.state === 'touring'){
      want = this.player ? 7 : 8;
      // slow down near animals so everyone can look; stop if one is on the road just ahead
      const ahead = ctx.animalsNear(this.pos, this.fwd);
      if (ahead.blocking) want = 0; else if (ahead.near) want = 4.5;
      // keep well back from the truck in front
      const gap = ctx.gapAhead(this);
      if (gap < 30) want = Math.min(want, Math.max(0, (gap - 14) * 0.5));
      // stop at the station (or turn off into the garage, when it's due a service)
      const stopAt = this.serviceNext ? W.depotS - 14 : W.stationS;
      const toStop = ((stopAt - this.s) % W.L + W.L) % W.L;
      if (this.lapS > 100){ if (toStop < 22) want = Math.min(want, Math.max(0.8, toStop * 0.35)); if (toStop < 0.6){ this.arrive(ctx, this.serviceNext); want = 0; } }
      if (this.broken) want = 0;
      const acc = want > this.v ? 1.4 : 3.0;
      this.v = want > this.v ? Math.min(want, this.v + acc * dt) : Math.max(want, this.v - acc * dt);
      if (this.state === 'touring'){
        this.s = (this.s + this.v * dt) % W.L; this.lapS += this.v * dt;
        // wear
        const wear = this.v * dt * 0.00085 * (ctx.wearMul || 1);
        D.condition = Math.max(0, D.condition - wear); D.km += this.v * dt / 1000;
        // breakdowns happen more as the truck gets worn
        if (!this.broken && this.v > 1){
          const c = D.condition / 100, risk = (0.0004 + 0.012 * (1 - c) ** 3) * dt * (ctx.breakMul || 1);
          if (Math.random() < risk) ctx.breakDown(this);
        }
      }
    }
    if (this.state === 'toDepot'){ this.offT = Math.min(1, this.offT + dt * 0.12); this.v = 3; if (this.offT >= 1){ this.state = 'depot'; this.v = 0; ctx.atDepot(this); } }
    if (this.state === 'depot'){ this.v = 0; }
    if (this.state === 'fromDepot'){
      this.offT = Math.max(0, this.offT - dt * 0.12); this.v = 3;
      if (this.offT <= 0){ this.state = 'touring'; this.s = W.depotS + 14; this.lapS = 150; this.v = 2; this.serviceNext = false; }
    }
    this.place(dt);
  }
  // at the end of a tour: the riders get off (at the station, or at the garage if it's going in for a service)
  arrive(ctx, depot){
    if (depot){ this.state = 'toDepot'; this.offT = 0; ctx.onArrive(this, true); return; }
    this.state = 'station'; this.v = 0; this.wait = 9;
    this.s = this.world.stationS;
    ctx.onArrive(this, false);
  }
  leaveDepot(){ if (this.state === 'depot'){ this.state = 'fromDepot'; } }
  // the eye of someone sitting in the front row (for riding along)
  seatEye(i = 1, out = V()){
    const s = this.m.seats[i];
    this.m.body.updateWorldMatrix(true, false);
    return out.set(s.x, s.y + 0.98, s.z + 0.05).applyMatrix4(this.m.body.matrixWorld);
  }
}

// ---------- staff jeeps ----------
// They drive on the inner lane of the road (either way round), then off the road to the job.
export class StaffJeep {
  constructor(world, kind){
    this.world = world; this.kind = kind;
    this.m = buildJeep(kind); this.root = this.m.root; world.scene.add(this.root);
    this.root.traverse((o) => { o.userData.jeep = this; });
    this.pos = V(); this.yaw = 0; this.v = 0; this.path = []; this.done = null; this.parked = true;
  }
  park(bay){ this.bay = bay; this.pos.copy(bay); this.yaw = this.world.depotYaw + Math.PI / 2; this.path = []; this.parked = true; this.pose(0); }
  // plan: out onto the road, along it, then off to the target
  goTo(target, done){
    const W = this.world, here = W.polar(this.pos.x, this.pos.z), there = W.polar(target.x, target.z);
    const path = [];
    if (Math.abs(here.lat + LANE) > 3){ path.push({ off: W.at(here.phi, -LANE) }); }
    let d = there.phi - here.phi; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU;
    if (Math.abs(d) > 0.004) path.push({ road: here.phi, to: here.phi + d });
    if (Math.abs(there.lat + LANE) > 2) path.push({ off: target.clone() });
    this.path = path; this.done = done; this.parked = false; this.v = 0;
  }
  home(done){ const b = this.bay; this.goTo(b, () => { this.park(b); if (done) done(); }); }
  update(dt){
    const W = this.world;
    if (!this.path.length){ this.v = 0; this.pose(dt); return; }
    const step = this.path[0];
    if (step.off){
      const dx = step.off.x - this.pos.x, dz = step.off.z - this.pos.z, d = Math.hypot(dx, dz);
      const want = Math.atan2(dx, dz); this.yaw += clamp(angleDiff(this.yaw, want), -dt * 2, dt * 2);
      this.v = damp(this.v, Math.min(7, d * 0.8 + 1), 2, dt);
      if (d < 1.2){ this.path.shift(); }
      else { this.pos.x += Math.sin(this.yaw) * this.v * dt; this.pos.z += Math.cos(this.yaw) * this.v * dt; }
    } else {
      // along the road from step.road to step.to (angles)
      const dir = Math.sign(step.to - step.road), Rr = W.road(W.sOfPhi(step.road), 0);
      const sp = damp(this.v, 12, 1, dt); this.v = sp;
      const dphi = sp * dt / Math.max(80, Math.hypot(Rr.p.x, Rr.p.z));
      step.road += dir * dphi;
      const done = dir > 0 ? step.road >= step.to : step.road <= step.to;
      if (done) step.road = step.to;
      const R = W.road(W.sOfPhi(step.road), -LANE * dir);
      const want = Math.atan2(R.t.x * dir, R.t.z * dir);
      this.yaw += clamp(angleDiff(this.yaw, want), -dt * 3, dt * 3);
      this.pos.lerp(R.p, Math.min(1, dt * 6));
      if (done) this.path.shift();
    }
    if (!this.path.length && this.done){ const f = this.done; this.done = null; f(); }
    this.pose(dt);
  }
  pose(dt){
    const W = this.world;
    this.pos.y = W.height(this.pos.x, this.pos.z);
    this.root.position.copy(this.pos); this.root.rotation.y = this.yaw;
    const f = V(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.m.body.rotation.x = Math.atan2(W.height(this.pos.x - f.x * 1.5, this.pos.z - f.z * 1.5) - W.height(this.pos.x + f.x * 1.5, this.pos.z + f.z * 1.5), 3);
    for (const w of this.m.wheels) w.rotation.x += this.v * dt / this.m.wheelR;
  }
}

// ---------- the manager's jeep: you drive it ----------
export class PlayerJeep {
  constructor(world){
    this.world = world; this.m = buildJeep('manager'); this.root = this.m.root; world.scene.add(this.root);
    this.m.driver.visible = false;
    this.pos = V(); this.yaw = 0; this.v = 0; this.steer = 0; this.pitch = 0; this.roll = 0;
  }
  reset(p, yaw){ this.pos.copy(p); this.yaw = yaw; this.v = 0; this.steer = 0; this.pose(0); }
  // throttle -1..1 (negative brakes / reverses), steer -1..1 (negative = left)
  update(dt, throttle, steer){
    const W = this.world;
    this.steer = damp(this.steer, steer, 6, dt);
    const max = 15, rev = -5;
    if (throttle > 0.05) this.v = Math.min(max * throttle, this.v + (this.v < 0 ? 9 : 4.5) * throttle * dt);
    else if (throttle < -0.05){ this.v = this.v > 0.3 ? Math.max(0, this.v - 12 * -throttle * dt) : Math.max(rev, this.v - 3.5 * -throttle * dt); }
    else this.v = damp(this.v, 0, 0.8, dt);
    // off the road it's bumpier and slower
    const { lat } = W.polar(this.pos.x, this.pos.z);
    if (Math.abs(lat) > 5) this.v = clamp(this.v, rev, max * 0.65);
    const turn = this.steer * 0.6 * (this.v / 2.6) / (1 + Math.abs(this.v) * 0.05);
    this.yaw -= turn * dt;
    this.pos.x += Math.sin(this.yaw) * this.v * dt; this.pos.z += Math.cos(this.yaw) * this.v * dt;
    // not through fences, trees, buildings, or out of the park
    if (W.collide(this.pos, 1.3)) this.v *= 0.85;
    const r = Math.hypot(this.pos.x, this.pos.z); if (r > 380){ this.pos.multiplyScalar(380 / r); this.v *= 0.5; }
    if (W.inWater(this.pos.x, this.pos.z)) this.v = clamp(this.v, -2, 2.5);
    this.pose(dt);
  }
  pose(dt){
    const W = this.world;
    this.pos.y = W.height(this.pos.x, this.pos.z);
    const f = V(Math.sin(this.yaw), 0, Math.cos(this.yaw)), r = V(f.z, 0, -f.x);
    const hF = W.height(this.pos.x + f.x * 1.4, this.pos.z + f.z * 1.4), hB = W.height(this.pos.x - f.x * 1.4, this.pos.z - f.z * 1.4);
    const hR = W.height(this.pos.x - r.x * 0.9, this.pos.z - r.z * 0.9), hL = W.height(this.pos.x + r.x * 0.9, this.pos.z + r.z * 0.9);
    this.pitch = damp(this.pitch, Math.atan2(hB - hF, 2.8), 8, dt || 1); this.roll = damp(this.roll, Math.atan2(hR - hL, 1.8), 8, dt || 1);
    this.root.position.set(this.pos.x, (hF + hB) / 2, this.pos.z);
    this.root.rotation.set(0, this.yaw, 0);
    this.m.body.rotation.set(this.pitch, 0, this.roll);
    for (const [i, w] of this.m.wheels.entries()){ w.rotation.x += this.v * (dt || 0) / this.m.wheelR; if (i < 2) w.rotation.y = this.steer * -0.45; }
  }
  // the driver's eye (right-hand drive, like on a real safari)
  eye(out = V()){ this.m.body.updateWorldMatrix(true, false); return out.set(0.45, 2.3, -0.1).applyMatrix4(this.m.body.matrixWorld); }
  get quat(){ this.m.body.updateWorldMatrix(true, false); return new THREE.Quaternion().setFromRotationMatrix(this.m.body.matrixWorld); }
}

// ---------- puffs of smoke (an overheated engine) and water spray (washing) ----------
export class Puffs {
  constructor(scene){
    this.n = 120; this.items = [];
    const g = new THREE.IcosahedronGeometry(0.5, 1);
    this.mesh = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.55, depthWrite: false }), this.n);
    this.mesh.count = 0; this.mesh.frustumCulled = false; scene.add(this.mesh);
    this.M = new THREE.Matrix4(); this.C = new THREE.Color();
  }
  emit(p, vel, life, size, color){ if (this.items.length >= this.n) this.items.shift(); this.items.push({ p: p.clone(), v: vel.clone(), t: 0, life, size, color }); }
  update(dt){
    let i = 0;
    this.items = this.items.filter((o) => (o.t += dt) < o.life);
    for (const o of this.items){
      o.p.addScaledVector(o.v, dt); o.v.multiplyScalar(1 - dt * 0.8);
      const k = o.t / o.life, s = o.size * (0.4 + k * 1.4);
      this.M.makeScale(s, s, s).setPosition(o.p); this.mesh.setMatrixAt(i, this.M);
      this.mesh.setColorAt(i, this.C.setHex(o.color).multiplyScalar(1 - k * 0.3)); i++;
    }
    this.mesh.count = i; this.mesh.instanceMatrix.needsUpdate = true; if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
void IN; void OUT; void ZONES; void lerp;
