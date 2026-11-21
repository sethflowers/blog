// Rides: coasters (the Rollercoaster Bros track engine, in coaster/) and flat rides you design (a carousel
// and a big wheel), built for each ride object, animated every frame, and ridden from a seat.
//
// coaster: { type: 'coaster', name, x, z (where the station starts, on the 8 m grid), d (0 N, 1 E, 2 S, 3 W),
//            y0 (the height of the rails at the station), hang, pieces: [...], color, cart, speed, open }
// ride:    { type: 'ride', kind: 'carousel' | 'wheel', name, x, z, r, ...its design, open }
import * as THREE from 'three';
import { Track, TILE, LEVEL, PIECES, HANG, COLORS, resetWorld } from './coaster/track.js';
import { Train, CARTS, SPEEDS } from './coaster/train.js';
import { Batch, UNIT_BOX, lathe, clamp, damp } from './util.js';
import { mat, glow } from './materials.js';
import { resolveMat } from './models.js';
import { boardTexture, disposeStructure } from './structures.js';
import { CATALOG } from './models.js';

export { PIECES, COLORS, CARTS, SPEEDS, TILE };
export const COASTER_PIECES = ['straight', 'left', 'right', 'bigLeft', 'bigRight', 'up', 'down', 'steepUp', 'steepDown', 'boost', 'loop', 'roll', 'hang', 'jump'];
const DIRV = [[0, -1], [1, 0], [0, 1], [-1, 0]];
export const FLAT = {
  carousel: { name: 'Carousel', sizes: [10, 12, 14], about: 'Galloping horses (or griffins, dragons and swans) round a mirrored column.' },
  wheel: { name: 'Big wheel', sizes: [20, 30, 40, 50], about: 'A great wheel of gondolas, with a view of the whole park.' },
};
export const MOUNTS = [['horses', 'Horses'], ['griffins', 'Griffins'], ['dragons', 'Dragons'], ['swans', 'Swans'], ['mixed', 'A mixture']];
export const RIDE_COLORS = ['#b02a2a', '#2a4a9a', '#c8983a', '#2a6a4a', '#6a2a7a', '#f0e8d8'];
export function newRide(kind){
  if (kind === 'carousel') return { type: 'ride', kind, name: 'Grand Carousel', size: 12, tiers: 1, mounts: 'horses', color: '#b02a2a', color2: '#f0e8d8', speed: 1, open: true };
  return { type: 'ride', kind: 'wheel', name: 'Big Wheel', size: 30, gondolas: 16, cabin: 'cabin', color: '#f0e8d8', color2: '#2a4a9a', lights: true, speed: 1, open: true };
}
export function newCoaster(hang){ return { type: 'coaster', name: hang ? 'The Bat' : 'Dragon\'s Fury', d: 0, hang: !!hang, pieces: [], color: hang ? 4 : 0, cart: 'classic', speed: 2, open: true }; }
export function flatRadius(o){ return o.kind === 'wheel' ? o.size / 2 + 3 : o.size / 2 + 1.2; }
// the ground a coaster's station stands on: 16 m along the track, 4 m either side
export function stationCells(o){
  const [fx, fz] = DIRV[o.d], [rx, rz] = DIRV[(o.d + 1) % 4], out = [];
  for (let f = 0.5; f < 16; f += 2) for (let r = -3.5; r <= 4.5; r += 2) out.push([o.x + fx * f + rx * r, o.z + fz * f + rz * r]);
  return out;
}

export class Rides {
  constructor(app){
    this.app = app; this.scene = app.scene; this.park = app.park;
    this.items = new Map();       // id -> { o, group, track?, train?, flat? }
    resetWorld();
    for (const o of this.park.s.objects) if (o.type === 'coaster' || o.type === 'ride') this.build(o);
  }
  dispose(){ for (const id of [...this.items.keys()]) this.remove(id); resetWorld(); }
  remove(id){
    const it = this.items.get(id); if (!it) return;
    if (it.track){ it.track.dispose(); this.scene.remove(it.train.group); it.train.group.traverse((m) => { if (m.geometry) m.geometry.dispose(); }); }
    if (it.group) disposeStructure(it.group);
    this.items.delete(id);
  }
  // the park changed: these objects (re)build
  update(ids){
    for (const id of ids){
      const o = this.park.obj(id), it = this.items.get(id);
      if (!o){ if (it) this.remove(id); continue; }
      if (o.type !== 'coaster' && o.type !== 'ride') continue;
      if (it && o.type === 'coaster' && it.track && it.key === coasterKey(o)){ this.restyle(it, o); continue; }
      this.remove(id); this.build(o);
    }
  }
  build(o){
    if (o.type === 'coaster') return this.buildCoaster(o);
    const group = o.kind === 'carousel' ? buildCarousel(o) : buildWheel(o);
    group.position.set(o.x, this.park.groundAt(o.x, o.z), o.z); group.rotation.y = o.r || 0;
    this.scene.add(group);
    this.items.set(o.id, { o, group, flat: true, t: 0, angle: 0, spin: 0 });
  }
  // --- coasters -----
  env(o){
    const P = this.park, objs = this.app.objects, lift = o.hang ? HANG : 0;
    return (pos) => {
      const g = P.groundAt(pos.x, pos.z), low = pos.y - (o.hang ? lift + 1.6 : 0.6);
      if (low < g) return o.hang ? 'Too low: the riders hanging under it would hit the ground.' : 'That would go into the hill.';
      const b = objs.buildingAt(pos.x, pos.z);
      if (b && pos.y < objs.structs.get(b.id).userData.floorY + b.floors.length * 4 + 5) return 'A building is in the way.';
      if (P.pathAt(pos.x, pos.z) && low < P.floorAt(pos.x, pos.z) + 3) return 'Too low over the path: people need 3 m of headroom (climb first).';
      const st = this.app.tools.inStructure(pos.x, pos.z, true, o.id);
      if (st && st.type === 'gate' && pos.y < g + 26) return 'The entrance is in the way.';
      if (st && st.type === 'lot' && pos.y < g + 4) return 'Too low over the car park.';
      if (st && st.type === 'coaster' && pos.y < g + 7) return 'Another coaster\'s station is in the way.';
      for (const it of this.items.values()) if (it.flat && Math.hypot(pos.x - it.o.x, pos.z - it.o.z) < flatRadius(it.o) && pos.y < g + it.o.size + 4) return 'Another ride is in the way.';
      return null;
    };
  }
  buildCoaster(o){
    const st = { i: Math.round(o.x / TILE), j: Math.round(o.z / TILE), d: o.d };
    const track = new Track(this.scene, { st, y0: o.y0, hang: o.hang, env: this.env(o), groundAt: (x, z) => this.park.groundAt(x, z) });
    track.setColor(o.color || 0);
    track.load(o.pieces || []);
    track.arrow.visible = false;
    const train = new Train(this.scene, track); train.setStyle(o.cart || 'classic'); train.reset();
    const group = buildStation(o, this.park);
    this.scene.add(group);
    this.items.set(o.id, { o, track, train, group, key: coasterKey(o) });
  }
  restyle(it, o){
    it.o = o;
    if (it.track.color !== o.color) it.track.setColor(o.color || 0);
    if (it.train.style !== o.cart) it.train.setStyle(o.cart || 'classic');
    if (it.group.userData.name !== o.name){ disposeStructure(it.group); it.group = buildStation(o, this.park); this.scene.add(it.group); }
  }
  get(id){ return this.items.get(id); }
  // the ride under a ray (closest): a flat ride's drum, a coaster's station
  pick(ray, maxT){
    let best = null, bt = maxT;
    for (const it of this.items.values()){
      const o = it.o; let cx, cz, r, h, y0;
      if (o.type === 'ride'){ cx = o.x; cz = o.z; r = flatRadius(o) - 1; h = o.kind === 'wheel' ? o.size + 3 : 7; y0 = it.group.position.y; }
      else { const [fx, fz] = DIRV[o.d]; cx = o.x + fx * 8; cz = o.z + fz * 8; r = 7; h = 7; y0 = o.y0 - 1; }
      const ox = ray.origin.x - cx, oz = ray.origin.z - cz, dx = ray.direction.x, dz = ray.direction.z, a = dx * dx + dz * dz, b = 2 * (ox * dx + oz * dz), c = ox * ox + oz * oz - r * r, disc = b * b - 4 * a * c;
      if (disc < 0 || a < 1e-9) continue;
      for (const t of [(-b - Math.sqrt(disc)) / (2 * a), (-b + Math.sqrt(disc)) / (2 * a)]){ if (t < 0 || t > bt) continue; const y = ray.origin.y + ray.direction.y * t; if (y < y0 - 0.5 || y > y0 + h) continue; best = o; bt = t; break; }
    }
    return best ? { o: best, t: bt } : null;
  }
  // ratings: fun, scary and queasy, out of 10
  stats(o){
    const it = this.items.get(o.id); if (!it) return null;
    if (o.type === 'coaster'){
      const v0 = SPEEDS[o.speed ?? 2].v, r = it.track.rate(v0);
      const tight = it.track.types().filter((t) => t === 'left' || t === 'right').length;
      const queasy = Math.round(clamp(r.intensity * 0.45 + r.inversions * 0.9 + tight * 0.08 * (v0 / 12) + (o.hang ? 0.6 : 0), 0, 10) * 10) / 10;
      return { fun: r.excitement, scary: r.intensity, queasy, topSpeed: r.maxSpeed, height: r.maxHeight, length: r.length, complete: it.track.complete, pieces: r.pieces, inversions: r.inversions };
    }
    if (o.kind === 'carousel') return { fun: Math.round((3.2 + o.size * 0.08 + (o.tiers - 1) * 0.8 + (o.mounts === 'mixed' ? 0.4 : 0.2)) * 10) / 10, scary: 0.4 + o.speed * 0.3, queasy: Math.round((0.8 + o.speed * 0.6 + (o.tiers - 1) * 0.2) * 10) / 10, topSpeed: (o.size / 2 - 1) * (0.5 + o.speed * 0.25), height: 3 * o.tiers, complete: true };
    return { fun: Math.round((3 + o.size * 0.06 + (o.cabin === 'open' ? 0.6 : 0.2) + (o.lights ? 0.3 : 0)) * 10) / 10, scary: Math.round((0.6 + o.size * 0.05 + (o.cabin === 'open' ? 0.8 : 0)) * 10) / 10, queasy: 0.6, topSpeed: o.size / 2 * 0.12, height: o.size + 3, complete: true };
  }
  // every frame
  frame(dt, time){
    for (const it of this.items.values()){
      const o = it.o;
      if (it.track){ if (o.open !== false || it.riding) it.train.update(dt, SPEEDS[o.speed ?? 2].v, time); continue; }
      const on = o.open !== false || it.riding;
      if (o.kind === 'carousel'){
        it.spin = damp(it.spin, on ? 0.32 + 0.14 * (o.speed || 1) : 0, 0.6, dt);
        it.angle += it.spin * dt; const rot = it.group.userData.rotor; rot.rotation.y = it.angle;
        for (const m of it.group.userData.mounts) m.position.y = m.userData.y0 + 0.28 * Math.sin(it.angle * 3 + m.userData.phase) * clamp(it.spin * 3);
      } else {
        it.spin = damp(it.spin, on ? 0.035 + 0.012 * (o.speed || 1) : 0, 0.4, dt);
        it.angle += it.spin * dt; const w = it.group.userData.rotor; w.rotation.x = it.angle;
        for (const g of it.group.userData.mounts) g.rotation.x = -it.angle;   // gondolas hang upright
      }
    }
  }
  // riding: where your eyes are, and which way is forward and up (world), each frame
  seat(o){
    const it = this.items.get(o.id); if (!it) return null;
    const eye = new THREE.Vector3(), fwd = new THREE.Vector3(), up = new THREE.Vector3();
    if (it.track){
      return () => { it.train.seatEye(eye); fwd.copy(it.train.frontFwd || new THREE.Vector3(0, 0, -1)); up.copy(it.train.frontUp || new THREE.Vector3(0, 1, 0)); return { eye, fwd, up }; };
    }
    const m = it.group.userData.mounts[0];
    return () => {
      if (o.kind === 'carousel'){ m.updateWorldMatrix(true, false); m.localToWorld(eye.set(0, 1.55, 0)); const c = it.group.position; fwd.set(eye.z - c.z, 0, -(eye.x - c.x)).normalize(); up.set(0, 1, 0); }
      else { m.updateWorldMatrix(true, false); m.localToWorld(eye.set(0, -1.0, 0.1)); fwd.set(0, 0, 1).applyQuaternion(it.group.quaternion); up.set(0, 1, 0); }
      return { eye, fwd, up };
    };
  }
  startRide(o){ const it = this.items.get(o.id); if (it){ it.riding = true; if (it.train){ it.train.reset(); it.train.seatRider(0, 'player'); } } }
  endRide(o){ const it = o && this.items.get(o.id); if (it){ it.riding = false; if (it.train) it.train.seatRider(0, null); } }
}
const coasterKey = (o) => JSON.stringify([o.x, o.z, o.d, o.y0, o.hang, o.pieces]);

// --- a coaster's station: a platform beside the track, a canopy over both, the name on it ----------------------
function buildStation(o, park){
  const g = new THREE.Group(), B = new Batch(), [fx, fz] = DIRV[o.d], yaw = Math.atan2(-fx, -fz);
  const base = o.y0 - 0.9, gy = Math.min(...stationCells(o).map(([x, z]) => park.groundAt(x, z)));
  const deck = base + 0.55;
  // in the station's own frame: x across (right +), z along (forward -), the track at x = 0
  B.box('ashlar', 2.6, (deck + gy - 0.3) / 2 - base, -8, 2.6, deck - gy + 0.3, 16);
  B.box('boards', 2.6, deck - base + 0.02, -8, 2.6, 0.04, 16);
  B.box('ashlar', -0.0, (gy - 0.3 + base - 0.2) / 2 - base, -8, 1.6, Math.max(0.1, base - 0.2 - gy + 0.3), 16);
  for (const z of [-1, -8, -15]) for (const x of [-1.6, 3.7]) B.box('iron', x, 2.6, z, 0.16, 5.2, 0.16);
  for (const x of [-1.6, 3.7]) B.box('iron', x, 5.2, -8, 0.2, 0.2, 16);
  // a pitched roof over the platform and the track
  const roof = new THREE.ConeGeometry(4.4, 1.6, 4, 1); roof.rotateY(Math.PI / 4);
  B.add(roof, 'slate', new THREE.Matrix4().compose(new THREE.Vector3(1.05, 6.0, -8), new THREE.Quaternion(), new THREE.Vector3(0.82, 1, 2.6)));
  B.box('iron', 3.7, 1.2, -8, 0.06, 0.06, 15.8); B.box('iron', 3.7, 0.65, -8, 0.06, 0.06, 15.8);   // railing at the back of the platform
  const body = B.build(resolveMat); body.traverse((m) => { if (m.isMesh){ m.castShadow = true; m.receiveShadow = true; } });
  const inner = new THREE.Group(); inner.add(body);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(5, 0.9), new THREE.MeshStandardMaterial({ map: boardTexture(o.name, { w: 1024, h: 184 }), roughness: 0.6 }));
  sign.userData.ownMaterial = true; sign.position.set(1.05, 5.65, 0.06); inner.add(sign);
  const back = sign.clone(); back.material = sign.material; back.userData.ownMaterial = false; back.position.set(1.05, 5.65, -16.06); back.rotation.y = Math.PI; inner.add(back);
  inner.rotation.y = yaw;
  g.add(inner);
  g.position.set(o.x, base, o.z);
  g.userData = { name: o.name, glows: [] };
  return g;
}

// --- a carousel ---------------------------------------------------------------------------------------
const stripeMats = new Map();
function stripes(a, b, n = 16){
  const k = a + b + n; let m = stripeMats.get(k); if (m) return m;
  const c = document.createElement('canvas'); c.width = 512; c.height = 32; const g = c.getContext('2d');
  for (let i = 0; i < n; i++){ g.fillStyle = i % 2 ? b : a; g.fillRect(i * 512 / n, 0, 512 / n + 1, 32); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.8, side: THREE.DoubleSide }); stripeMats.set(k, m);
  return m;
}
const paint = (hex) => mat('paint' + hex.slice(1), { c: parseInt(hex.slice(1), 16), r: 0.45 });
function mountMesh(kind, body){
  // a carousel animal, 1.5 m long, facing +x (the way the carousel turns), its saddle at y = 0
  const B = new Batch(), add = (geo, k, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => B.add(geo, k, new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz)));
  const S = (r) => new THREE.SphereGeometry(r, 16, 12), C = (r0, r1, h) => new THREE.CylinderGeometry(r1, r0, h, 10);
  if (kind === 'swans'){
    // a swan chariot: a curved seat with a long neck in front
    add(S(0.55), 'B', 0, -0.15, 0, 0, 0, 0, 1.4, 0.75, 0.9);
    add(new THREE.BoxGeometry(0.7, 0.5, 0.8), 'gold', -0.2, 0.1, 0);
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0.6, 0, 0), new THREE.Vector3(0.95, 0.5, 0), new THREE.Vector3(0.8, 1.1, 0), new THREE.Vector3(1.05, 1.3, 0)]);
    add(new THREE.TubeGeometry(curve, 16, 0.09, 8), 'B', 0, 0, 0);
    add(S(0.14), 'B', 1.1, 1.32, 0, 0, 0, 0, 1.3, 0.9, 0.9); add(new THREE.ConeGeometry(0.05, 0.18, 6), 'gold', 1.28, 1.3, 0, 0, 0, -Math.PI / 2);
    for (const s of [-1, 1]) add(S(0.4), 'B', -0.15, 0.05, s * 0.45, 0, 0, 0.3, 1.2, 0.35, 0.3);
    return B;
  }
  // body, neck, head, legs: a prancing horse (griffins get wings and a beak, dragons horns and a spiked tail)
  add(S(0.32), 'B', 0, -0.05, 0, 0, 0, 0, 1.75, 1, 0.85);
  add(C(0.2, 0.14, 0.75), 'B', 0.5, 0.32, 0, 0, 0, -0.65);
  if (kind === 'griffins'){ add(S(0.17), 'B', 0.78, 0.66, 0, 0, 0, 0, 1.2, 1, 0.9); add(new THREE.ConeGeometry(0.07, 0.26, 8), 'gold', 0.98, 0.62, 0, 0, 0, -Math.PI / 2 - 0.4); }
  else { add(C(0.14, 0.1, 0.5), 'B', 0.8, 0.6, 0, 0, 0, -1.9); add(S(0.11), 'B', 0.98, 0.52, 0, 0, 0, 0, 1.2, 1, 1); }
  for (const s of [-1, 1]){ add(new THREE.ConeGeometry(0.05, 0.16, 6), kind === 'dragons' ? 'gold' : 'B', 0.72, 0.84, s * 0.07, 0, 0, kind === 'dragons' ? -0.5 : 0.2); }
  // legs: front pair lifted, back pair down
  for (const s of [-1, 1]){
    add(C(0.07, 0.05, 0.45), 'B', 0.38, -0.32, s * 0.14, 0, 0, 0.9); add(C(0.05, 0.045, 0.35), 'B', 0.62, -0.38, s * 0.14, 0, 0, -0.5);
    add(C(0.08, 0.05, 0.6), 'B', -0.42, -0.5, s * 0.14, 0, 0, -0.25);
  }
  add(new THREE.ConeGeometry(0.08, 0.6, 8), kind === 'dragons' ? 'B' : 'mane', -0.65, -0.12, 0, 0, 0, 2.2);
  if (kind !== 'griffins' && kind !== 'dragons') add(new THREE.BoxGeometry(0.42, 0.1, 0.05), 'mane', 0.56, 0.62, 0, 0, 0, -0.75);
  if (kind === 'griffins') for (const s of [-1, 1]) add(S(0.4), 'gold', -0.05, 0.25, s * 0.32, s * 0.5, 0, 0.35, 1.3, 0.3, 0.12);
  if (kind === 'dragons'){ for (let k = 0; k < 5; k++) add(new THREE.ConeGeometry(0.05, 0.16, 5), 'gold', 0.3 - k * 0.18, 0.28 - Math.abs(k - 1) * 0.03, 0); }
  add(new THREE.BoxGeometry(0.42, 0.06, 0.6), 'saddle', 0, 0.27, 0);
  void body;
  return B;
}
export function buildCarousel(o){
  const g = new THREE.Group(), R = o.size / 2, rotor = new THREE.Group(), B = new Batch(), RB = new Batch();
  const tiers = o.tiers || 1, C = o.color || '#b02a2a', C2 = o.color2 || '#f0e8d8';
  // the fixed base and the centre column
  B.add(lathe([[0, 0], [R + 0.4, 0], [R + 0.4, 0.25], [R + 0.25, 0.3], [0, 0.3]], 48), 'ashlar', null);
  // turning: the floor, the column with mirrors, rounding boards with bulbs, the canopy
  RB.add(new THREE.CylinderGeometry(R, R, 0.12, 48), 'boards', new THREE.Matrix4().makeTranslation(0, 0.42, 0));
  RB.add(new THREE.TorusGeometry(R, 0.06, 6, 64).rotateX(Math.PI / 2), 'brass', new THREE.Matrix4().makeTranslation(0, 0.46, 0));
  const top = 4.2 + (tiers - 1) * 2.6;
  RB.add(new THREE.CylinderGeometry(1.0, 1.1, top, 12), 'P', new THREE.Matrix4().makeTranslation(0, top / 2 + 0.4, 0));
  for (let k = 0; k < 12; k++){ const a = k / 12 * Math.PI * 2; RB.add(new THREE.BoxGeometry(0.55, 1.6, 0.03), 'chrome', new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * 1.08, 2.0, Math.sin(a) * 1.08), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a + Math.PI / 2), new THREE.Vector3(1, 1, 1))); }
  RB.add(new THREE.CylinderGeometry(R + 0.15, R + 0.15, 0.9, 48, 1, true), 'P', new THREE.Matrix4().makeTranslation(0, top - 0.1, 0));
  RB.add(new THREE.CylinderGeometry(R + 0.12, R + 0.12, 0.9, 48, 1, true), 'gold', new THREE.Matrix4().compose(new THREE.Vector3(0, top - 0.1, 0), new THREE.Quaternion(), new THREE.Vector3(0.99, 0.15, 0.99)));
  const glows = [];
  for (let k = 0; k < 32; k++){ const a = k / 32 * Math.PI * 2; RB.add(new THREE.SphereGeometry(0.06, 6, 4), 'glow', new THREE.Matrix4().makeTranslation(Math.cos(a) * (R + 0.17), top - 0.1, Math.sin(a) * (R + 0.17))); }
  for (let k = 0; k < 8; k++){ const a = k / 8 * Math.PI * 2; glows.push([Math.cos(a) * (R + 0.2), top - 0.1, Math.sin(a) * (R + 0.2)]); }
  const can = new THREE.ConeGeometry(R + 0.5, 2.4, 32, 1, true); can.userData.keepUV = true;
  RB.add(can, 'S', new THREE.Matrix4().makeTranslation(0, top + 1.55, 0));
  RB.add(new THREE.SphereGeometry(0.22, 12, 8), 'gold', new THREE.Matrix4().makeTranslation(0, top + 2.85, 0));
  if (tiers > 1) RB.add(new THREE.CylinderGeometry(R * 0.72, R * 0.72, 0.12, 40), 'boards', new THREE.Matrix4().makeTranslation(0, 3.05, 0));
  const rbody = RB.build((k) => k === 'P' ? paint(C) : k === 'S' ? stripes(C, C2, 24) : resolveMat(k));
  rbody.traverse((m) => { if (m.isMesh){ m.castShadow = true; m.receiveShadow = true; } });
  rotor.add(rbody);
  // the animals, on brass poles, in rings
  const kinds = o.mounts === 'mixed' ? ['horses', 'griffins', 'dragons', 'swans'] : [o.mounts || 'horses'];
  const bodyCols = { horses: ['#f4f0e8', '#d8c0a0', '#a07050', '#f4f0e8'], griffins: ['#d8b060'], dragons: ['#3a7a4a', '#7a2a2a'], swans: ['#f8f8f4'] };
  const mounts = [];
  const rings = [{ r: R - 1.0, n: Math.round((R - 1.0) * 1.3), y: 1.5 }, { r: R - 2.3, n: Math.round((R - 2.3) * 1.3), y: 1.45 }];
  if (tiers > 1) rings.push({ r: R * 0.72 - 1.0, n: Math.round((R * 0.72 - 1) * 1.3), y: 4.15 });
  const meshCache = new Map();
  let idx = 0;
  for (const ring of rings){
    if (ring.r < 1.8 || ring.n < 3) continue;
    for (let k = 0; k < ring.n; k++){
      const kind = kinds[idx % kinds.length], col = bodyCols[kind][idx % bodyCols[kind].length]; idx++;
      const mk = kind + col;
      let geo = meshCache.get(mk);
      if (!geo){ geo = mountMesh(kind).build((key) => key === 'B' ? mat('mount' + col, { c: parseInt(col.slice(1), 16), r: 0.35, mt: 0.05 }) : key === 'mane' ? mat('mane', { c: 0xc8a050, r: 0.6 }) : key === 'saddle' ? paint(C) : resolveMat(key)); meshCache.set(mk, geo); }
      const a = (k + (ring.r < R - 1.5 ? 0.5 : 0)) / ring.n * Math.PI * 2;
      const m = new THREE.Group();
      const animal = geo.clone(); animal.traverse((c) => { if (c.isMesh) c.castShadow = true; });
      m.add(animal);
      const pole = new THREE.Mesh(POLE, resolveMat('brass')); pole.position.y = 0.5; m.add(pole);
      m.position.set(Math.cos(a) * ring.r, ring.y, Math.sin(a) * ring.r);
      m.rotation.y = -a + Math.PI;     // facing the way round
      m.userData = { y0: ring.y, phase: idx * 1.7 };
      rotor.add(m); mounts.push(m);
    }
  }
  g.add(B.build(resolveMat)); g.add(rotor);
  g.userData = { rotor, mounts, glows, colliders: [{ c: [0, 0], r: R + 0.4 }] };
  return g;
}
const POLE = (() => { const p = new THREE.CylinderGeometry(0.035, 0.035, 3.2, 8); p.userData.shared = true; return p; })();

// --- a big wheel ----------------------------------------------------------------------------------------
export function buildWheel(o){
  const g = new THREE.Group(), R = o.size / 2, hub = R + 2.5, B = new Batch(), WB = new Batch(), rotor = new THREE.Group();
  const C = o.color || '#f0e8d8', C2 = o.color2 || '#2a4a9a', n = o.gondolas || 16, W = 2.6;
  // A-frame legs either side, a boarding platform under it
  for (const s of [-1, 1]) for (const f of [-1, 1]){
    const top = new THREE.Vector3(s * (W / 2 + 0.5), hub, 0), foot = new THREE.Vector3(s * (W / 2 + 1.6), 0, f * R * 0.55);
    const mid = top.clone().add(foot).multiplyScalar(0.5), len = top.distanceTo(foot);
    B.add(new THREE.CylinderGeometry(0.28, 0.4, len, 10), 'P', new THREE.Matrix4().compose(mid, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(foot).normalize()), new THREE.Vector3(1, 1, 1)));
    B.box('ashlar', foot.x, 0.25, foot.z, 1.4, 0.5, 1.4);
  }
  B.add(new THREE.CylinderGeometry(0.45, 0.45, W + 2.2, 16).rotateZ(Math.PI / 2), 'iron', new THREE.Matrix4().makeTranslation(0, hub, 0));
  B.box('boards', 0, 0.6, R * 0.0, W + 5, 0.2, 6); B.box('ashlar', 0, 0.25, 0, W + 5.2, 0.5, 6.2);
  // the wheel: two rims, spokes, cross bars, lights
  for (const s of [-1, 1]){
    WB.add(new THREE.TorusGeometry(R, 0.18, 8, 96).rotateY(Math.PI / 2), 'P', new THREE.Matrix4().makeTranslation(s * W / 2, 0, 0));
    WB.add(new THREE.TorusGeometry(R * 0.55, 0.12, 6, 64).rotateY(Math.PI / 2), 'P', new THREE.Matrix4().makeTranslation(s * W / 2, 0, 0));
    for (let k = 0; k < n; k++){
      const a = k / n * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      WB.add(new THREE.CylinderGeometry(0.07, 0.07, R, 6), 'P', new THREE.Matrix4().compose(new THREE.Vector3(s * W / 2, ca * R / 2, sa * R / 2), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a), new THREE.Vector3(1, 1, 1)));
    }
  }
  const glows = [];
  for (let k = 0; k < n; k++){
    const a = k / n * Math.PI * 2, y = Math.cos(a) * R, z = Math.sin(a) * R;
    WB.add(new THREE.CylinderGeometry(0.1, 0.1, W, 8).rotateZ(Math.PI / 2), 'iron', new THREE.Matrix4().makeTranslation(0, y, z));
    if (o.lights !== false) for (let q = 0; q < 3; q++){ const aa = (k + q / 3) / n * Math.PI * 2; WB.add(new THREE.SphereGeometry(0.08, 6, 4), 'glow', new THREE.Matrix4().makeTranslation(W / 2 + 0.2, Math.cos(aa) * R, Math.sin(aa) * R)); }
  }
  WB.add(new THREE.CylinderGeometry(1.1, 1.1, W + 0.6, 20).rotateZ(Math.PI / 2), 'P', null);
  const wbody = WB.build((k) => k === 'P' ? paint(C) : resolveMat(k)); wbody.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  rotor.add(wbody); rotor.position.y = hub;
  // gondolas, hanging from each cross bar
  const mounts = [], GB = new Batch();
  if (o.cabin === 'open'){
    GB.box('P2', 0, -1.15, 0, 1.6, 0.12, 1.3); GB.box('wood', 0, -0.85, 0.45, 1.5, 0.5, 0.08); GB.box('wood', 0, -0.85, -0.45, 1.5, 0.5, 0.08);
    for (const x of [-0.75, 0.75]) GB.box('iron', x, -0.6, 0, 0.05, 1.1, 0.05); GB.add(new THREE.ConeGeometry(1.1, 0.4, 4).rotateY(Math.PI / 4), 'P2', new THREE.Matrix4().makeTranslation(0, -0.05, 0));
  } else {
    GB.box('P2', 0, -1.4, 0, 1.6, 0.25, 1.6); GB.box('P2', 0, -0.25, 0, 1.6, 0.2, 1.6);
    for (const [x, z] of [[-0.75, -0.75], [0.75, -0.75], [-0.75, 0.75], [0.75, 0.75]]) GB.box('P2', x, -0.82, z, 0.1, 1.0, 0.1);
    GB.box('glass', 0, -0.82, 0.78, 1.4, 0.95, 0.03); GB.box('glass', 0, -0.82, -0.78, 1.4, 0.95, 0.03); GB.box('glass', 0.78, -0.82, 0, 0.03, 0.95, 1.4); GB.box('glass', -0.78, -0.82, 0, 0.03, 0.95, 1.4);
    GB.add(new THREE.SphereGeometry(0.85, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), 'P2', new THREE.Matrix4().compose(new THREE.Vector3(0, -0.15, 0), new THREE.Quaternion(), new THREE.Vector3(1, 0.4, 1)));
  }
  GB.box('iron', 0, -0.05, 0, 0.06, 0.25, 0.06);
  const gmesh = GB.build((k) => k === 'P2' ? paint(C2) : k === 'P' ? paint(C) : resolveMat(k));
  for (let k = 0; k < n; k++){
    const a = k / n * Math.PI * 2, gp = new THREE.Group();
    const c = gmesh.clone(); c.traverse((m) => { if (m.isMesh) m.castShadow = true; }); gp.add(c);
    gp.position.set(0, Math.cos(a) * R, Math.sin(a) * R);
    rotor.add(gp); mounts.push(gp);
  }
  g.add(B.build((k) => k === 'P' ? paint(C) : resolveMat(k))); g.add(rotor);
  g.traverse((m) => { if (m.isMesh){ m.castShadow = true; m.receiveShadow = true; } });
  g.userData = { rotor, mounts, glows, colliders: [{ box: [-W / 2 - 2.5, -3.2, W / 2 + 2.5, 3.2] }, { c: [W / 2 + 1.6, R * 0.55], r: 0.8 }, { c: [-W / 2 - 1.6, R * 0.55], r: 0.8 }, { c: [W / 2 + 1.6, -R * 0.55], r: 0.8 }, { c: [-W / 2 - 1.6, -R * 0.55], r: 0.8 }] };
  void glow; void CATALOG; void LEVEL; void UNIT_BOX;
  return g;
}
