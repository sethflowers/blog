// Things you can pick up: a sword, a pistol, a ball, crates, melons and pumpkins on posts (which the
// sword really cuts in two, along the line of the swing), and bottles on the range rail.
// Loose things fall, bounce, settle flat and roll; they go home if lost.
import * as THREE from 'three';
import { BoxBuilder, boxGeo, blockMaterial, COL, rng } from './util.js';
import { surfaceHeight, solids, pillars, rayGround, PLACES } from './world.js';
import { sfx } from './audio.js';

const UPV = new THREE.Vector3(0, 1, 0);
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), q1 = new THREE.Quaternion(), m1 = new THREE.Matrix4(), m2 = new THREE.Matrix4();
const R = rng(5);

// ---------- particles: one instanced mesh of little cubes ----------
export class Particles {
  constructor(scene, n = 500){
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), n);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.n = n; this.next = 0;
    this.p = []; const c = new THREE.Color(1, 1, 1);
    for (let i = 0; i < n; i++){ this.p.push({ life: 0, max: 1, pos: new THREE.Vector3(), vel: new THREE.Vector3(), size: 0.03, g: 1, rot: new THREE.Euler() }); this.mesh.setColorAt(i, c); }
    this.mat = new THREE.Matrix4(); this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < n; i++) this.mesh.setMatrixAt(i, this.zero);
    scene.add(this.mesh);
    this.col = new THREE.Color(); this.any = false;
  }
  burst(pos, color, count, speed = 2, size = 0.035, life = 0.8, gravity = 1, dir = null){
    for (let k = 0; k < count; k++){
      const i = this.next; this.next = (this.next + 1) % this.n;
      const p = this.p[i];
      p.life = p.max = life * (0.6 + R() * 0.6);
      p.pos.copy(pos);
      p.vel.set(R() - 0.5, R() * 0.8 + 0.2, R() - 0.5).normalize().multiplyScalar(speed * (0.4 + R() * 0.8));
      if (dir) p.vel.addScaledVector(dir, speed * 0.6);
      p.size = size * (0.6 + R() * 0.8); p.g = gravity;
      p.rot.set(R() * 3, R() * 3, R() * 3);
      this.col.set(color); const j = 0.85 + R() * 0.3; this.col.r *= j; this.col.g *= j; this.col.b *= j;
      this.mesh.setColorAt(i, this.col);
    }
    this.mesh.instanceColor.needsUpdate = true; this.any = true;
  }
  update(dt){
    if (!this.any) return;
    let alive = false;
    for (let i = 0; i < this.n; i++){
      const p = this.p[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0){ this.mesh.setMatrixAt(i, this.zero); continue; }
      alive = true;
      p.vel.y -= 9.8 * p.g * dt;
      p.pos.addScaledVector(p.vel, dt);
      const fl = surfaceHeight(p.pos.x, p.pos.z, p.pos.y) + p.size / 2;
      if (p.pos.y < fl){ p.pos.y = fl; p.vel.multiplyScalar(0.4); p.vel.y = Math.abs(p.vel.y) * 0.3; }
      p.rot.x += dt * 4; p.rot.y += dt * 3;
      const s = p.size * Math.min(1, p.life / p.max * 3);
      this.mat.makeRotationFromEuler(p.rot).scale(v1.set(s, s, s)).setPosition(p.pos);
      this.mesh.setMatrixAt(i, this.mat);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.any = alive;
  }
}

// ---------- the things ----------
let nextId = 1;
export class Item {
  constructor(kind, mesh, half, opts = {}){
    this.id = nextId++;
    this.kind = kind; this.mesh = mesh; this.half = half.clone();
    this.radius = opts.radius ?? half.length();
    this.vel = new THREE.Vector3(); this.angVel = new THREE.Vector3();
    this.held = null; this.holster = null; this.sleeping = true;
    this.restitution = opts.restitution ?? 0.3;
    this.sphere = !!opts.sphere;
    this.grabPoint = opts.grabPoint || null;      // local point you snap-grab by (sword hilt, gun grip)
    this.holdQuat = opts.holdQuat || null;        // orientation in the hand for a snap grab
    this.holsterQuat = opts.holsterQuat || null;
    this.holsterSide = opts.holsterSide ?? null;
    this.chop = opts.chop || null;                // { outer, inner, cut[6], size }
    this.home = null; this.idle = 0; this.cool = 0; this.age = 0; this.dead = false;
    this.freeOffset = new THREE.Matrix4();
    this.spawnT = opts.spawnIn ? 0 : 1;
    this.grounded = false;
  }
  setHome(){ this.home = { pos: this.mesh.position.clone(), quat: this.mesh.quaternion.clone() }; }
}

function swordMesh(){
  const B = new BoxBuilder(48);
  // hilt along +Z from the hand, blade along -Z toward the thumb
  B.box(0, 0, 0.02, 0.032, 0.032, 0.17, 0x5a3418);                      // grip wrapped in leather
  B.box(0, 0, 0.115, 0.05, 0.05, 0.04, 0xd4a72c);                       // pommel
  B.box(0, 0, -0.08, 0.2, 0.04, 0.035, 0xd4a72c);                       // cross-guard
  B.box(0, 0, -0.43, 0.055, 0.016, 0.66, { all: 0xd8dde4, px: 0xb8c0ca, nx: 0xb8c0ca });   // blade
  B.box(0, 0, -0.43, 0.012, 0.02, 0.6, 0x9aa3ae);                        // fuller
  B.box(0, 0, -0.79, 0.035, 0.014, 0.06, 0xd8dde4);                      // tip
  B.box(0, 0, -0.83, 0.016, 0.012, 0.03, 0xd8dde4);
  return new THREE.Mesh(B.build(), blockMaterial());
}
function gunMesh(){
  const g = new THREE.Group();
  const B = new BoxBuilder(48);
  const rake = 0.26;   // the handle leans back
  const hm = new THREE.Matrix4().makeRotationX(-rake);
  B.box(0, -0.045, 0.0, 0.032, 0.11, 0.045, 0x4a3122, hm);              // handle (centred on the hand)
  B.box(0, 0.035, -0.06, 0.036, 0.04, 0.2, 0x34373d);                   // frame
  B.box(0, -0.005, -0.045, 0.012, 0.035, 0.05, 0x2a2c30);               // trigger guard
  B.box(0, 0.0, -0.035, 0.008, 0.025, 0.008, 0xb0b5bc);                 // trigger
  B.box(0, 0.035, -0.17, 0.02, 0.02, 0.04, 0x2a2c30);                   // muzzle
  const body = new THREE.Mesh(B.build(), blockMaterial());
  const slide = new THREE.Mesh(boxGeo(0.034, 0.028, 0.19, { all: 0x5b6068, py: 0x6a7079 }, 0, 0.068, -0.065), blockMaterial());
  const sight = new THREE.Mesh(boxGeo(0.008, 0.012, 0.012, 0xe8d24a, 0, 0.088, -0.15), blockMaterial());
  slide.add(sight);
  const flash = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.07), new THREE.MeshBasicMaterial({ color: 0xffd36a }));
  flash.position.set(0, 0.035, -0.22); flash.visible = false;
  const flash2 = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.12), new THREE.MeshBasicMaterial({ color: 0xfff2b0 }));
  flash2.position.set(0, 0.035, -0.25); flash.add(flash2); flash2.position.set(0, 0, -0.04);
  g.add(body, slide, flash);
  g.userData.slide = slide; g.userData.flash = flash;
  return g;
}
function bottleMesh(color){
  const B = new BoxBuilder(48);
  B.box(0, -0.035, 0, 0.075, 0.15, 0.075, color);
  B.box(0, 0.06, 0, 0.05, 0.04, 0.05, color);
  B.box(0, 0.1, 0, 0.03, 0.05, 0.03, color);
  B.box(0, 0.13, 0, 0.034, 0.015, 0.034, 0xd0d0d0);
  return new THREE.Mesh(B.build(), blockMaterial());
}
function chopMesh(size, outer, inner, cut){
  const k = ['px', 'nx', 'py', 'ny', 'pz', 'nz'], faces = {};
  k.forEach((f, i) => { faces[f] = cut[i] ? inner : outer; });
  return new THREE.Mesh(new BoxBuilder(40).box(0, 0, 0, size.x, size.y, size.z, faces, null, { ao: 0.08 }).build(), blockMaterial());
}

const FRUIT = [
  { name: 'melon', outer: 0x3f8f2a, inner: 0xe8433f, size: [0.3, 0.28, 0.3] },
  { name: 'pumpkin', outer: 0xe8892a, inner: 0xf3c46a, size: [0.32, 0.26, 0.32] },
];

export class Items {
  constructor(scene, { particles, creatures, npcs }){
    this.scene = scene; this.particles = particles; this.creatures = creatures; this.npcs = npcs;
    this.list = [];
    this.tracers = [];
    for (let i = 0; i < 4; i++){
      const t = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xfff0a0 }));
      t.visible = false; t.userData.life = 0; scene.add(t); this.tracers.push(t);
    }
    this.posts = PLACES.posts.map((p, i) => ({ ...p, item: null, timer: 0.1 + i * 0.15, fruit: FRUIT[i % 2] }));
    this.bottleSlots = [];
    this.events = [];     // things the test can read: 'cut', 'shot', 'shatter', 'grab', ...

    const T = PLACES.table;
    // sword
    const sword = this.add(new Item('sword', swordMesh(), new THREE.Vector3(0.1, 0.02, 0.45), { radius: 0.45, grabPoint: new THREE.Vector3(0, 0, 0.02), holdQuat: new THREE.Quaternion(), holsterQuat: new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + 0.25, 0, 0)), holsterSide: 0 }));
    // lying flat on the table, blade pointing left
    sword.mesh.position.set(T.x - 0.2, T.h + 0.026, T.z + 0.05); sword.mesh.rotation.set(0, Math.PI / 2 + 0.12, 0);
    // gun
    const gun = this.add(new Item('gun', gunMesh(), new THREE.Vector3(0.02, 0.08, 0.12), { radius: 0.16, grabPoint: new THREE.Vector3(0, -0.035, 0.0), holdQuat: new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + 0.26, 0, 0)), holsterQuat: new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), holsterSide: 1 }));
    gun.mesh.position.set(T.x + 0.45, T.h + 0.02, T.z + 0.05); gun.mesh.quaternion.setFromEuler(new THREE.Euler(0, -0.4, Math.PI / 2));
    gun.recoil = 0; gun.slideT = 0;
    // ball
    const ballGeo = new THREE.IcosahedronGeometry(0.1, 1);
    const cols = []; const pa = ballGeo.attributes.position;
    for (let i = 0; i < pa.count; i += 3){ const c = new THREE.Color(Math.abs(pa.getY(i)) < 0.035 ? 0xffffff : 0xe23b3b); for (let k = 0; k < 3; k++) cols.push(c.r, c.g, c.b); }
    ballGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const ball = this.add(new Item('ball', new THREE.Mesh(ballGeo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })), new THREE.Vector3(0.1, 0.1, 0.1), { radius: 0.1, sphere: true, restitution: 0.72 }));
    ball.mesh.position.set(T.x + 0.0, T.h + 0.1, T.z - 0.12);
    // crates
    for (let i = 0; i < 2; i++){
      const s = new THREE.Vector3(0.2, 0.2, 0.2);
      const c = this.add(new Item('crate', chopMesh(s, 0xa77a45, 0xdcb57e, [0, 0, 0, 0, 0, 0]), s.clone().multiplyScalar(0.5), { chop: { outer: 0xa77a45, inner: 0xdcb57e, cut: [0, 0, 0, 0, 0, 0], size: s } }));
      c.mesh.position.set(T.x - 0.08 + i * 0.22, T.h + 0.1, T.z + 0.17); c.mesh.rotation.y = 0.2 * i;
    }
    for (const it of this.list) it.setHome();

    // bottles on the range rail
    const Rg = PLACES.range;
    for (let i = 0; i < 7; i++) this.bottleSlots.push({ x: Rg.x0 + 0.4 + i * ((Rg.x1 - Rg.x0 - 0.8) / 6), z: Rg.z, y: Rg.h, item: null, timer: 0.1 + i * 0.1 });
    this.swishCool = 0;
  }
  add(item){ this.list.push(item); this.scene.add(item.mesh); return item; }
  remove(item){ item.dead = true; this.scene.remove(item.mesh); const i = this.list.indexOf(item); if (i >= 0) this.list.splice(i, 1); }
  get(kind){ return this.list.find((i) => i.kind === kind); }
  emit(type, data = {}){ this.events.push({ type, t: performance.now(), ...data }); if (this.events.length > 200) this.events.shift(); }

  // ---- spawning fruit on posts, bottles on the rail ----
  respawnStuff(dt){
    for (const p of this.posts){
      const it0 = p.item;
      if (it0 && (it0.dead || it0.held || it0.mesh.position.distanceTo(v1.set(p.x, 1.0 + it0.half.y, p.z)) > 0.3)){
        p.item = null;
        if (!it0.dead){ it0.temp = true; it0.age = 0; }   // knocked off: it fades away in a while
      }
      if (p.item) continue;
      p.timer -= dt;
      if (p.timer > 0) continue;
      p.timer = 3.5;
      const f = p.fruit, s = new THREE.Vector3(...f.size);
      const it = this.add(new Item(f.name, chopMesh(s, f.outer, f.inner, [0, 0, 0, 0, 0, 0]), s.clone().multiplyScalar(0.5), { chop: { outer: f.outer, inner: f.inner, cut: [0, 0, 0, 0, 0, 0], size: s }, spawnIn: true }));
      it.mesh.position.set(p.x, 1.0 + s.y / 2, p.z); it.mesh.rotation.y = R() * 0.6;
      it.isFruit = true; p.item = it;
      sfx.pop(it.mesh.position);
    }
    for (const b of this.bottleSlots){
      if (b.item && !b.item.dead) continue;
      b.timer -= dt; if (b.timer > 0) continue;
      b.timer = 4;
      const it = this.add(new Item('bottle', bottleMesh(R() < 0.5 ? 0x3c9a5a : 0x9a5a2a), new THREE.Vector3(0.0375, 0.11, 0.0375), { radius: 0.1, spawnIn: true }));
      it.mesh.position.set(b.x, b.y + 0.11, b.z); b.item = it;
    }
  }

  // ---- the main update: hands, holsters, physics, weapons ----
  update(dt, hands, holsters){
    this.respawnStuff(dt);
    this.swishCool -= dt;
    for (const h of hands) this.handUpdate(dt, h, holsters);
    for (const it of [...this.list]){
      it.age += dt; it.cool -= dt;
      if (it.spawnT < 1){ it.spawnT = Math.min(1, it.spawnT + dt * 4); it.mesh.scale.setScalar(0.01 + 0.99 * (1 - (1 - it.spawnT) ** 3)); }
      if (it.held) continue;
      if (it.holster){ this.followHolster(it, holsters); continue; }
      if (!it.sleeping) this.physics(dt, it);
      // pieces fade away after a while; lost things go home
      if (it.kind === 'piece' || it.temp){
        if (it.age > 20){ it.mesh.scale.multiplyScalar(1 - Math.min(1, dt * 3)); if (it.mesh.scale.x < 0.05) this.remove(it); }
        continue;
      }
      if (it.home){
        it.idle += dt;
        const far = it.mesh.position.y < -3 || Math.hypot(it.mesh.position.x, it.mesh.position.z) > 33;
        if (far || (it.idle > 40 && it.mesh.position.distanceTo(it.home.pos) > 2)) this.sendHome(it);
      }
    }
    // gun bits
    const gun = this.get('gun');
    if (gun){
      gun.recoil *= Math.exp(-dt * 14); gun.slideT = Math.max(0, gun.slideT - dt * 10);
      gun.mesh.userData.slide.position.z = gun.slideT * 0.035;
      if (gun.flashT > 0){ gun.flashT -= dt; if (gun.flashT <= 0) gun.mesh.userData.flash.visible = false; }
    }
    for (const t of this.tracers){ if (t.userData.life > 0){ t.userData.life -= dt; if (t.userData.life <= 0) t.visible = false; } }
    // too many bits: clear the oldest
    const pieces = this.list.filter((i) => i.kind === 'piece' && !i.held);
    if (pieces.length > 50) pieces.slice(0, pieces.length - 50).forEach((p) => { p.age = Math.max(p.age, 20); });
  }

  sendHome(it){
    this.particles.burst(it.mesh.position, 0xffffff, 10, 1.5, 0.04, 0.5, 0.2);
    it.mesh.position.copy(it.home.pos); it.mesh.quaternion.copy(it.home.quat);
    it.vel.set(0, 0, 0); it.angVel.set(0, 0, 0); it.sleeping = true; it.idle = 0; it.holster = null;
    it.spawnT = 0;
    sfx.pop(it.mesh.position);
  }
  recallAll(){
    for (const it of this.list) if (it.home && !it.held) { if (it.holster) continue; this.sendHome(it); }
  }

  // ---- hands ----
  handUpdate(dt, h, holsters){
    if (!h.tracked){ if (h.held) this.release(h, holsters); return; }
    if (h.held && h.held.dead){ h.held = null; }
    if (h.held){
      if (h.squeezeUp || h.squeeze < 0.25){ this.release(h, holsters); return; }
      const it = h.held;
      this.place(it, h);
      if (it.kind === 'sword') this.swordUpdate(dt, it, h);
      if (it.kind === 'gun' && h.triggerDown) this.fire(it, h);
      return;
    }
    if (h.squeezeDown){
      // nearest thing in reach: snap-grab points first, then anything you're touching
      let best = null, bd = 1e9;
      for (const it of this.list){
        if (it.dead || it.spawnT < 0.5) continue;
        let d;
        if (it.grabPoint){ v1.copy(it.grabPoint).applyMatrix4(it.mesh.matrixWorld); d = v1.distanceTo(h.pos) - 0.06; }
        else d = it.mesh.position.distanceTo(h.pos) - it.radius * 0.9;
        if (d < 0.07 && d < bd){ bd = d; best = it; }
      }
      if (best){ this.grab(h, best); return; }
      const c = this.creatures && this.creatures.grabAt(h);
      if (c){ h.heldCreature = c; h.haptic(0.4, 40); this.emit('grab', { kind: c.kind }); return; }
    }
    if (h.heldCreature){
      if (h.squeezeUp || h.squeeze < 0.25){ this.creatures.release(h.heldCreature, h.vel); h.heldCreature = null; }
      else this.creatures.holdUpdate(h.heldCreature, h);
    }
  }
  grab(h, it){
    // take it from the other hand if need be
    if (it.held && it.held !== h) it.held.held = null;
    it.held = h; h.held = it; it.holster = null; it.sleeping = false; it.idle = 0; it.spawnT = 1; it.mesh.scale.setScalar(1);
    if (!it.holdQuat){
      // keep it where it was relative to the hand
      m1.compose(h.pos, h.quat, v1.set(1, 1, 1)).invert();
      it.mesh.updateMatrix();
      it.freeOffset.multiplyMatrices(m1, it.mesh.matrix);
    }
    if (it.isFruit) for (const p of this.posts) if (p.item === it){ p.item = null; it.temp = true; it.age = 0; }
    if (it.temp || it.kind === 'piece') it.age = 0;
    for (const b of this.bottleSlots) if (b.item === it) b.item = null;
    h.haptic(0.35, 30);
    sfx.grab(h.pos);
    this.emit('grab', { kind: it.kind });
    if (it.kind === 'sword'){ it.prevBase = null; }
  }
  place(it, h){
    if (it.holdQuat){
      if (it.kind === 'gun' && h.rayQuat){
        // aim where the controller's own pointer aims: barrel along the ray, top toward the thumb
        v1.set(0, 0, -1).applyQuaternion(h.rayQuat);
        v2.set(0, 0, -1).applyQuaternion(h.quat);           // thumb side of the hand
        v2.addScaledVector(v1, -v2.dot(v1)).normalize();
        v3.crossVectors(v2, v1.clone().negate());           // x = y cross z
        m1.makeBasis(v3, v2, v1.clone().negate());
        it.mesh.quaternion.setFromRotationMatrix(m1);
      } else it.mesh.quaternion.copy(h.quat).multiply(it.holdQuat);
      if (it.kind === 'gun' && it.recoil > 0.001) it.mesh.quaternion.multiply(q1.setFromAxisAngle(v1.set(1, 0, 0), it.recoil));
      // put its grab point in the palm
      v1.copy(it.grabPoint).applyQuaternion(it.mesh.quaternion);
      it.mesh.position.copy(h.pos).sub(v1);
    } else {
      m1.compose(h.pos, h.quat, v1.set(1, 1, 1)).multiply(it.freeOffset);
      m1.decompose(it.mesh.position, it.mesh.quaternion, v1);
    }
    it.mesh.updateMatrixWorld();
  }
  release(h, holsters){
    const it = h.held; h.held = null;
    if (!it) return;
    it.held = null; it.idle = 0;
    // close to an empty holster? it goes in
    if (it.holsterQuat && holsters){
      const hs = holsters[it.holsterSide];
      if (hs && !hs.item && it.mesh.position.distanceTo(hs.pos) < 0.28){
        hs.item = it; it.holster = hs; sfx.holster(hs.pos); h.haptic(0.3, 30); this.emit('holster', { kind: it.kind });
        return;
      }
    }
    it.vel.copy(h.vel).multiplyScalar(1.2);
    it.angVel.copy(h.angVel);
    it.sleeping = false;
    const hs = holsters && it.holsterQuat ? holsters[it.holsterSide] : null;
    this.emit('release', { kind: it.kind, speed: it.vel.length(), holsterDist: hs ? it.mesh.position.distanceTo(hs.pos) : null });
  }
  followHolster(it, holsters){
    const hs = it.holster;
    if (!hs || hs.item !== it){ it.holster = null; it.sleeping = false; return; }
    it.mesh.quaternion.copy(hs.quat).multiply(it.holsterQuat);
    v1.copy(it.grabPoint).applyQuaternion(it.mesh.quaternion);
    it.mesh.position.copy(hs.pos).sub(v1);
    it.mesh.updateMatrixWorld();
  }

  // ---- loose things ----
  physics(dt, it){
    const p = it.mesh.position;
    it.vel.y -= 9.8 * dt;
    p.addScaledVector(it.vel, dt);
    const w = it.angVel.length();
    if (w > 1e-4){ q1.setFromAxisAngle(v1.copy(it.angVel).divideScalar(w), w * dt); it.mesh.quaternion.premultiply(q1); }
    // how far the lowest point sits below the centre
    let ey;
    if (it.sphere) ey = it.radius;
    else {
      m1.makeRotationFromQuaternion(it.mesh.quaternion); const e = m1.elements;
      ey = Math.abs(e[1]) * it.half.x + Math.abs(e[5]) * it.half.y + Math.abs(e[9]) * it.half.z;
    }
    // walls: solids and pillars push it out sideways
    const r = Math.min(it.radius, 0.2);
    for (const s of solids){
      if (p.y - ey >= s.top - 0.02 || p.y + ey < s.y0) continue;
      if (p.x > s.x0 - r && p.x < s.x1 + r && p.z > s.z0 - r && p.z < s.z1 + r){
        const o = [p.x - (s.x0 - r), (s.x1 + r) - p.x, p.z - (s.z0 - r), (s.z1 + r) - p.z], mn = Math.min(...o), k = o.indexOf(mn);
        // if it's only just below the top, put it on top instead
        if (s.top - (p.y - ey) < 0.12 && it.vel.y <= 0.5){ p.y = s.top + ey; continue; }
        if (k === 0){ p.x = s.x0 - r; it.vel.x = -Math.abs(it.vel.x) * 0.4; } else if (k === 1){ p.x = s.x1 + r; it.vel.x = Math.abs(it.vel.x) * 0.4; }
        else if (k === 2){ p.z = s.z0 - r; it.vel.z = -Math.abs(it.vel.z) * 0.4; } else { p.z = s.z1 + r; it.vel.z = Math.abs(it.vel.z) * 0.4; }
      }
    }
    for (const pl of pillars){
      if (p.y - ey >= pl.top - 0.02) continue;
      const dx = p.x - pl.x, dz = p.z - pl.z, rr = pl.r + r, d2 = dx * dx + dz * dz;
      if (d2 < rr * rr){ const d = Math.sqrt(d2) || 1e-3, nx = dx / d, nz = dz / d; p.x = pl.x + nx * rr; p.z = pl.z + nz * rr; const vn = it.vel.x * nx + it.vel.z * nz; if (vn < 0){ it.vel.x -= 1.4 * vn * nx; it.vel.z -= 1.4 * vn * nz; } }
    }
    const floor = surfaceHeight(p.x, p.z, p.y - ey + 0.15);
    it.grounded = false;
    if (p.y - ey <= floor){
      p.y = floor + ey;
      const impact = -it.vel.y;
      if (impact > 1.0){
        it.vel.y = impact * it.restitution;
        if (impact > 1.6) sfx.thud(p, impact);
        it.angVel.multiplyScalar(0.7);
        if (it.kind === 'bottle' && impact > 4) { this.shatter(it); return; }
      } else it.vel.y = 0;
      it.grounded = true;
      if (it.sphere){
        // roll
        const f = Math.exp(-dt * 0.8); it.vel.x *= f; it.vel.z *= f;
        it.angVel.set(it.vel.z, 0, -it.vel.x).divideScalar(it.radius);
      } else {
        const f = Math.exp(-dt * 7); it.vel.x *= f; it.vel.z *= f; it.angVel.multiplyScalar(Math.exp(-dt * 8));
        // tip over onto the nearest flat side
        v1.set(0, 1, 0).applyQuaternion(q1.copy(it.mesh.quaternion).invert());
        const ax = Math.abs(v1.x), ay = Math.abs(v1.y), az = Math.abs(v1.z);
        if (ax >= ay && ax >= az) v2.set(Math.sign(v1.x), 0, 0); else if (ay >= az) v2.set(0, Math.sign(v1.y), 0); else v2.set(0, 0, Math.sign(v1.z));
        v2.applyQuaternion(it.mesh.quaternion);
        q1.setFromUnitVectors(v2, UPV);
        const target = q1.multiply(it.mesh.quaternion);
        it.mesh.quaternion.slerp(target, Math.min(1, dt * 8));
      }
      if (it.vel.lengthSq() < 0.0025 && it.angVel.lengthSq() < 0.01 && !it.sphere){ it.sleeping = true; it.vel.set(0, 0, 0); it.angVel.set(0, 0, 0); }
      if (it.sphere && it.vel.lengthSq() < 0.0004){ it.sleeping = true; it.vel.set(0, 0, 0); it.angVel.set(0, 0, 0); }
    }
    it.mesh.updateMatrixWorld();
    // thrown things knock bottles off and bump animals
    const sp = it.vel.length();
    if (sp > 3){
      for (const b of this.list){
        if (b.kind !== 'bottle' || b === it || b.held) continue;
        if (b.mesh.position.distanceTo(p) < it.radius + 0.07) { this.shatter(b); this.emit('knock', { by: it.kind }); }
      }
      if (this.creatures){ const c = this.creatures.hitSphere(p, it.radius + 0.05); if (c){ this.creatures.hit(c, it.vel.clone().normalize(), 0.6); it.vel.multiplyScalar(-0.3); } }
      if (this.npcs){ const n = this.npcs.hitSphere(p, it.radius + 0.05); if (n){ this.npcs.hit(n, it.vel.clone().normalize()); it.vel.multiplyScalar(-0.3); } }
    }
  }

  // ---- the sword ----
  swordUpdate(dt, sw, h){
    const base = v1.set(0, 0, -0.12).applyMatrix4(sw.mesh.matrixWorld).clone();
    const tip = v2.set(0, 0, -0.84).applyMatrix4(sw.mesh.matrixWorld).clone();
    if (!sw.prevBase){ sw.prevBase = base.clone(); sw.prevTip = tip.clone(); return; }
    const tipSpeed = tip.distanceTo(sw.prevTip) / Math.max(dt, 1e-3);
    if (tipSpeed > 5 && this.swishCool <= 0){ sfx.swish(tip, tipSpeed); this.swishCool = 0.3; }
    const N = 7, pts = [], prev = [];
    for (let i = 0; i < N; i++){ const t = i / (N - 1); pts.push(new THREE.Vector3().lerpVectors(base, tip, t)); prev.push(new THREE.Vector3().lerpVectors(sw.prevBase, sw.prevTip, t)); }
    const seg = (a, b, c) => { v3.subVectors(b, a); const l2 = v3.lengthSq(); let t = l2 > 0 ? v3.dot(c.clone().sub(a)) / l2 : 0; t = Math.max(0, Math.min(1, t)); return { d: a.clone().addScaledVector(v3, t).distanceTo(c), p: a.clone().addScaledVector(v3, t) }; };
    const sweepHit = (center, r) => {
      let best = null;
      for (let i = 0; i < N; i++){ const s = seg(prev[i], pts[i], center); if (s.d < r && (!best || s.d < best.d)) best = { ...s, i }; }
      return best;
    };
    for (const it of [...this.list]){
      if (it === sw || it.held || it.dead || it.cool > 0 || it.holster) continue;
      if (!it.chop && it.kind !== 'bottle' && it.kind !== 'ball') continue;
      const r = it.kind === 'bottle' ? 0.08 : Math.max(it.half.x, it.half.y, it.half.z) * 1.05;
      const hit = sweepHit(it.mesh.position, r);
      if (!hit) continue;
      const pv = v3.subVectors(pts[hit.i], prev[hit.i]).divideScalar(Math.max(dt, 1e-3)).clone();
      const speed = pv.length();
      if (it.kind === 'bottle'){ if (speed > 1) this.shatter(it); continue; }
      if (it.kind === 'ball' || speed < 1.8){
        // a gentle touch just pushes it
        it.sleeping = false; it.vel.addScaledVector(pv, it.kind === 'ball' ? 0.9 : 0.5); it.vel.y += 0.5; it.cool = 0.15;
        if (speed > 1) sfx.bonk(it.mesh.position);
        continue;
      }
      const bladeDir = new THREE.Vector3().subVectors(tip, base).normalize();
      const n = new THREE.Vector3().crossVectors(bladeDir, pv).normalize();
      if (n.lengthSq() < 0.5) n.set(0, 1, 0);
      this.cut(it, n, hit.p, pv);
      h.haptic(0.8, 60);
    }
    // animals and people get a bonk, not a cut
    const tipVel = v3.subVectors(tip, sw.prevTip).divideScalar(Math.max(dt, 1e-3)).clone();
    if (tipVel.length() > 2.2){
      for (let i = 2; i < N; i++){
        if (this.creatures){ const c = this.creatures.hitSphere(pts[i], 0.05); if (c && c.hitCool <= 0){ this.creatures.hit(c, tipVel.clone().normalize(), 0.8); h.haptic(0.6, 50); this.emit('bonk', { kind: c.kind }); break; } }
        if (this.npcs){ const n = this.npcs.hitSphere(pts[i], 0.05); if (n && n.hitCool <= 0){ this.npcs.hit(n, tipVel.clone().normalize()); h.haptic(0.6, 50); break; } }
      }
    }
    sw.prevBase.copy(base); sw.prevTip.copy(tip);
  }

  // Cut a box in two along (roughly) the plane with normal n through point p.
  cut(it, n, p, sweepVel){
    const ch = it.chop, size = ch.size;
    const qi = q1.copy(it.mesh.quaternion).invert();
    const nl = n.clone().applyQuaternion(qi);
    const pl = p.clone().sub(it.mesh.position).applyQuaternion(qi);
    const axes = [Math.abs(nl.x), Math.abs(nl.y), Math.abs(nl.z)];
    const order = [0, 1, 2].sort((a, b) => axes[b] - axes[a]);
    const sz = [size.x, size.y, size.z];
    const k = order.find((a) => sz[a] > 0.07);
    sfx.chop(p);
    this.particles.burst(p, ch.inner, 10, 2.2, 0.025, 0.7, 1, sweepVel.clone().normalize());
    this.emit('cut', { kind: it.kind });
    if (k === undefined){ this.particles.burst(it.mesh.position, ch.inner, 14, 2, 0.03, 0.9); this.particles.burst(it.mesh.position, ch.outer, 8, 2, 0.03, 0.9); this.remove(it); return; }
    const h = sz[k] / 2;
    const c = Math.max(-h * 0.55, Math.min(h * 0.55, [pl.x, pl.y, pl.z][k]));
    const make = (lo, hi, sign) => {
      const ns = sz.slice(); ns[k] = hi - lo;
      const cut = ch.cut.slice(); cut[k * 2 + (sign > 0 ? 1 : 0)] = 1;     // the new face is a cut face
      const s = new THREE.Vector3(...ns);
      const piece = this.add(new Item('piece', chopMesh(s, ch.outer, ch.inner, cut), s.clone().multiplyScalar(0.5), { chop: { outer: ch.outer, inner: ch.inner, cut, size: s } }));
      const off = [0, 0, 0]; off[k] = (lo + hi) / 2;
      piece.mesh.quaternion.copy(it.mesh.quaternion);
      piece.mesh.position.set(...off).applyQuaternion(it.mesh.quaternion).add(it.mesh.position);
      const ax = new THREE.Vector3(); ax.setComponent(k, sign); ax.applyQuaternion(it.mesh.quaternion);
      piece.vel.copy(it.vel).addScaledVector(ax, 1.3).addScaledVector(sweepVel, 0.15); piece.vel.y += 1.0;
      piece.angVel.set(R() - 0.5, R() - 0.5, R() - 0.5).multiplyScalar(6);
      piece.sleeping = false; piece.cool = 0.12;
      piece.mesh.updateMatrixWorld();
      return piece;
    };
    make(-h, c, -1); make(c, h, 1);
    this.remove(it);
  }

  shatter(it){
    const col = it.kind === 'bottle' ? 0x5ab07a : 0xaaaaaa;
    this.particles.burst(it.mesh.position, col, 18, 2.5, 0.025, 0.9, 1);
    this.particles.burst(it.mesh.position, 0xe0f0e8, 8, 2, 0.015, 0.6, 1);
    sfx.shatter(it.mesh.position);
    this.emit('shatter', { kind: it.kind });
    if (it.held) it.held.held = null;
    this.remove(it);
  }

  // ---- the gun ----
  fire(gun, h){
    const muzzle = new THREE.Vector3(0, 0.035, -0.2).applyMatrix4(gun.mesh.matrixWorld);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(gun.mesh.quaternion).normalize();
    gun.recoil = 0.35; gun.slideT = 1; gun.flashT = 0.045; gun.mesh.userData.flash.visible = true;
    gun.mesh.userData.flash.rotation.z = R() * Math.PI;
    sfx.shot(muzzle);
    h.haptic(1.0, 70);
    const max = 60;
    let best = { t: rayGround(muzzle, dir, max), type: 'ground' };
    // solid boxes (shed, hay, table)
    for (const s of solids){
      const t = rayBox(muzzle, dir, s.x0, s.y0, s.z0, s.x1, s.top, s.z1);
      if (t < best.t) best = { t, type: 'solid' };
    }
    for (const it of this.list){
      if (it === gun || it.held || it.holster) continue;
      const r = it.kind === 'bottle' ? 0.07 : it.radius * 0.8;
      const t = raySphere(muzzle, dir, it.mesh.position, r);
      if (t < best.t) best = { t, type: 'item', it };
    }
    if (this.creatures){ const c = this.creatures.raycast(muzzle, dir, best.t); if (c) best = { t: c.t, type: 'creature', c: c.c }; }
    if (this.npcs){ const n = this.npcs.raycast(muzzle, dir, best.t); if (n) best = { t: n.t, type: 'npc', n: n.n }; }
    const end = muzzle.clone().addScaledVector(dir, Math.min(best.t, max));
    // tracer
    const tr = this.tracers.find((t) => !t.visible) || this.tracers[0];
    const len = Math.min(best.t, max);
    tr.position.copy(muzzle).addScaledVector(dir, len / 2);
    tr.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    tr.scale.set(0.012, 0.012, len); tr.visible = true; tr.userData.life = 0.05;
    this.emit('shot', { hit: best.type, kind: best.it ? best.it.kind : best.c ? best.c.kind : null });
    if (best.type === 'item'){
      const it = best.it;
      if (it.kind === 'bottle') this.shatter(it);
      else if (it.chop){
        const n = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(R() - 0.5, 1, R() - 0.5)).normalize();
        it.vel.addScaledVector(dir, 2);
        this.cut(it, n, end, dir.clone().multiplyScalar(6));
      } else { it.sleeping = false; it.vel.addScaledVector(dir, 6).y += 2; sfx.bonk(end); }
    } else if (best.type === 'creature'){
      this.creatures.hit(best.c, dir, 1.2);
    } else if (best.type === 'npc'){
      this.npcs.hit(best.n, dir);
    } else if (best.t < max){
      this.particles.burst(end, best.type === 'ground' ? 0x8a6142 : 0xc8a060, 8, 1.6, 0.03, 0.6, 1, dir.clone().negate());
    }
  }
}

export function raySphere(o, d, c, r){
  v1.subVectors(c, o); const tc = v1.dot(d); if (tc < 0) return Infinity;
  const d2 = v1.lengthSq() - tc * tc; if (d2 > r * r) return Infinity;
  return tc - Math.sqrt(r * r - d2);
}
export function rayBox(o, d, x0, y0, z0, x1, y1, z1){
  let tmin = 0, tmax = Infinity;
  const lo = [x0, y0, z0], hi = [x1, y1, z1], oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
  for (let i = 0; i < 3; i++){
    if (Math.abs(dd[i]) < 1e-9){ if (oo[i] < lo[i] || oo[i] > hi[i]) return Infinity; continue; }
    let t1 = (lo[i] - oo[i]) / dd[i], t2 = (hi[i] - oo[i]) / dd[i];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}
