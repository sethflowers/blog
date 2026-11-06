// A huge, friendly dragon. It circles high over the valley; raise both hands over your head and it
// comes down and lands near you (or in its meadow if there's no room). Sitting, it watches you, blinks,
// breathes, and rumbles happily when you pet it. Hitting it just gets a huff of smoke.
import * as THREE from 'three';
import { multiBox, rng } from './util.js';
import { groundHeight, surfaceHeight, solidAt, columns, cellOf, pillars, PLACES, EDGE } from './world.js';
import { blobShadow } from './avatar.js';
import { sfx } from './audio.js';

const R = rng(77);
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), m1 = new THREE.Matrix4(), q1 = new THREE.Quaternion();
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const C = { body: 0x3fae7a, dark: 0x2f8a5c, belly: 0xf2d36b, spike: 0xf08a3c, wing: 0xb488e0, horn: 0xf2e6c8, eye: 0xffffff, pupil: 0x1a1a2a, cheek: 0xf29bb4 };

export class Dragon {
  constructor(scene, particles){
    this.particles = particles;
    const root = this.root = new THREE.Group(); scene.add(root);
    // body
    const spikes = [];
    for (let i = 0; i < 6; i++) spikes.push([0.18, 0.3, 0.3, C.spike, 0, 0.92, -1.5 + i * 0.6]);
    this.body = multiBox([[1.8, 1.6, 4.0, { all: C.body, ny: C.belly }], [1.4, 0.3, 3.6, C.belly, 0, -0.72, 0], ...spikes]);
    this.body.position.set(0, 2.0, 0); root.add(this.body);
    // neck: a chain of segments; the head on the end
    this.neck = [];
    let parent = root, at = new THREE.Vector3(0, 2.5, -1.9);
    for (let i = 0; i < 4; i++){
      const g = new THREE.Group(); g.position.copy(at);
      const s = 0.95 - i * 0.08;
      g.add(multiBox([[s, s, 0.8, { all: C.body, ny: C.belly }, 0, 0, -0.35], [0.14, 0.24, 0.22, C.spike, 0, s / 2 + 0.1, -0.35]]));
      parent.add(g); this.neck.push(g); parent = g; at = new THREE.Vector3(0, 0, -0.72);
    }
    const head = this.head = new THREE.Group(); head.position.set(0, 0, -0.75); parent.add(head);
    const hb = [
      [1.0, 0.85, 1.0, C.body, 0, 0.05, -0.4], [0.8, 0.5, 0.8, C.body, 0, -0.1, -1.15], [0.72, 0.08, 0.7, C.belly, 0, -0.36, -1.1],
      [0.1, 0.06, 0.06, 0x1d4d33, -0.18, 0.12, -1.56], [0.1, 0.06, 0.06, 0x1d4d33, 0.18, 0.12, -1.56],     // nostrils
      [0.12, 0.45, 0.12, C.horn, -0.3, 0.6, 0.0], [0.12, 0.45, 0.12, C.horn, 0.3, 0.6, 0.0],           // horns
      [0.14, 0.12, 0.3, C.spike, 0, 0.5, 0.0],
    ];
    for (const s of [-1, 1]){
      hb.push([0.3, 0.32, 0.08, C.eye, s * 0.3, 0.2, -0.92], [0.15, 0.2, 0.04, C.pupil, s * 0.3, 0.17, -0.97], [0.06, 0.06, 0.02, 0xffffff, s * 0.26, 0.24, -0.995]);
      hb.push([0.2, 0.1, 0.04, C.cheek, s * 0.38, -0.12, -0.92]);
      // a smile along the side of the snout
      hb.push([0.04, 0.05, 0.5, 0x1d4d33, s * 0.405, -0.2, -1.2], [0.04, 0.05, 0.1, 0x1d4d33, s * 0.405, -0.15, -0.92]);
    }
    head.add(multiBox(hb));
    this.jaw = new THREE.Group(); this.jaw.position.set(0, -0.32, -0.75);
    this.jaw.add(multiBox([[0.74, 0.18, 0.75, { all: C.body, py: 0xd45a6a }, 0, -0.06, -0.38], [0.06, 0.08, 0.06, 0xffffff, -0.2, 0.06, -0.7], [0.06, 0.08, 0.06, 0xffffff, 0.2, 0.06, -0.7]]));
    head.add(this.jaw);
    // eyelids, hung from the top of the eyes; scale.y 0 = open, 1 = shut
    this.lids = new THREE.Group(); this.lids.position.set(0, 0.37, -0.93);
    this.lids.add(multiBox([[0.34, 0.36, 0.1, C.dark, -0.3, -0.18, 0], [0.34, 0.36, 0.1, C.dark, 0.3, -0.18, 0]]));
    this.lids.scale.y = 0.02; head.add(this.lids);
    // tail
    this.tail = []; parent = root; at = new THREE.Vector3(0, 2.15, 1.9);
    for (let i = 0; i < 6; i++){
      const g = new THREE.Group(); g.position.copy(at);
      const s = 0.85 - i * 0.11;
      const parts = [[s, s, 0.8, { all: C.body, ny: C.belly }, 0, 0, 0.38], [0.1, 0.2, 0.2, C.spike, 0, s / 2 + 0.08, 0.38]];
      if (i === 5) parts.push([0.7, 0.12, 0.6, C.spike, 0, 0, 0.95]);
      g.add(multiBox(parts));
      parent.add(g); this.tail.push(g); parent = g; at = new THREE.Vector3(0, 0, 0.74);
    }
    // legs
    this.legs = [[-0.75, -1.3], [0.75, -1.3], [-0.8, 1.3], [0.8, 1.3]].map(([x, z]) => {
      const g = new THREE.Group(); g.position.set(x, 1.6, z);
      g.add(multiBox([[0.55, 0.9, 0.7, C.body, 0, -0.35, 0], [0.42, 0.8, 0.45, C.body, 0, -1.1, 0.05], [0.55, 0.18, 0.7, C.dark, 0, -1.5, -0.1],
        [0.1, 0.1, 0.14, C.horn, -0.18, -1.55, -0.48], [0.1, 0.1, 0.14, C.horn, 0, -1.55, -0.48], [0.1, 0.1, 0.14, C.horn, 0.18, -1.55, -0.48]]));
      root.add(g); return g;
    });
    // wings: an inner and an outer panel on each side
    this.wings = [-1, 1].map((s) => {
      const inner = new THREE.Group(); inner.position.set(s * 0.85, 2.75, -0.8);
      inner.add(multiBox([[3.2, 0.14, 0.18, C.dark, s * 1.6, 0.04, -0.9], [3.2, 0.06, 2.2, C.wing, s * 1.6, 0, 0.2]]));
      const outer = new THREE.Group(); outer.position.set(s * 3.2, 0, 0);
      outer.add(multiBox([[3.0, 0.12, 0.16, C.dark, s * 1.5, 0.04, -0.9], [3.0, 0.05, 1.8, C.wing, s * 1.5, 0, 0.0], [1.6, 0.05, 0.6, C.wing, s * 0.8, 0, 1.15]]));
      inner.add(outer); root.add(inner);
      return { s, inner, outer };
    });
    this.shadow = blobShadow(8); scene.add(this.shadow);

    // flight
    this.pos = new THREE.Vector3(20, 18, 0);
    this.vel = new THREE.Vector3(0, 0, -9);
    this.yaw = 0; this.pitch = 0; this.bank = 0; this.lastYaw = 0;
    this.orbit = 0; this.state = 'fly'; this.timer = 0;
    this.spot = new THREE.Vector3(); this.landYaw = 0;
    this.flap = 0; this.flapRate = 3.2; this.lastFlapSin = 0;
    this.happy = 0; this.purrCool = 0; this.heartT = 0; this.blinkT = 3; this.blink = 0; this.shake = 0; this.huffCool = 0;
    this.lookYaw = 0; this.lookPitch = 0;
    this.hitCool = 0;
    this.colliders = null;
    this.events = [];
    this.t = 0;
  }
  emit(type){ this.events.push(type); if (this.events.length > 50) this.events.shift(); }

  // ---- being called ----
  call(player){
    if (this.state === 'rest' && this.spot.distanceTo(v1.set(player.pos.x, this.spot.y, player.pos.z)) < 14) { this.happy = 2; return false; }
    const spot = this.findSpot(player) || new THREE.Vector3(PLACES.meadow.x, 0, PLACES.meadow.z);
    spot.y = groundHeight(spot.x, spot.z);
    this.spot.copy(spot);
    this.landYaw = Math.atan2(-(player.pos.x - spot.x), -(player.pos.z - spot.z));
    if (this.state === 'rest') this.takeOff();
    this.state = this.state === 'takeoff' ? 'takeoff' : 'approach';
    this.called = true;
    sfx.roar(this.pos);
    this.emit('called');
    return true;
  }
  findSpot(player){
    const yaw = player.yaw ?? 0, g0 = groundHeight(player.pos.x, player.pos.z);
    for (const off of [0, 0.7, -0.7, 1.4, -1.4, 2.2, -2.2, Math.PI]){
      const a = yaw + off, x = player.pos.x - Math.sin(a) * 8, z = player.pos.z - Math.cos(a) * 8;
      if (this.clear(x, z, g0)) return new THREE.Vector3(x, g0, z);
    }
    return null;
  }
  // flat, open ground for a 6 x 7 m dragon?
  clear(x, z, g0){
    for (let dx = -3; dx <= 3; dx += 1) for (let dz = -3.5; dz <= 3.5; dz += 1){
      const px = x + dx, pz = z + dz;
      if (Math.abs(groundHeight(px, pz) - g0) > 0.01) return false;
      if (Math.hypot(px, pz) > EDGE - 5) return false;
      if (solidAt(px, g0 + 0.3, pz) || solidAt(px, g0 + 2, pz)) return false;
      if (columns.has(cellOf(px) + ',' + cellOf(pz))) return false;
    }
    return true;
  }
  takeOff(){ this.state = 'takeoff'; this.timer = 0; this.setColliders(false); sfx.roar(this.pos); }
  setColliders(on){
    if (this.colliders){ for (const c of this.colliders){ const i = pillars.indexOf(c); if (i >= 0) pillars.splice(i, 1); } this.colliders = null; }
    if (on){
      const f = v1.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      this.colliders = [-1.3, 0, 1.4].map((k) => ({ x: this.pos.x + f.x * k, z: this.pos.z + f.z * k, r: 1.05, top: this.pos.y + 2.9, y0: this.pos.y }));
      pillars.push(...this.colliders);
    }
  }

  update(dt, player, hands){
    this.t += dt; this.hitCool -= dt; this.huffCool -= dt; this.purrCool -= dt;
    const st = this.state;
    let flapAmp = 0.75, flapRate = 3.0, folded = 0;
    if (st === 'fly' || st === 'approach'){
      let target;
      if (st === 'fly'){
        // circle round wherever you are (drifting after you as you travel)
        this.center = this.center || new THREE.Vector3(0, 0, -2);
        this.center.lerp(v2.set(player.pos.x, 0, player.pos.z), Math.min(1, dt * 0.08));
        const cx = this.center.x, cz = this.center.z, rad = 30;
        this.orbit = Math.atan2(this.pos.z - cz, this.pos.x - cx) + 0.5;
        const tx = cx + Math.cos(this.orbit) * rad, tz = cz + Math.sin(this.orbit) * rad;
        target = v1.set(tx, Math.max(17, groundHeight(tx, tz) + 14) + Math.sin(this.t * 0.2) * 3, tz);
      } else {
        target = v1.copy(this.spot); target.y += 8;
        // come in from the far side so it lands facing you
        target.x += Math.sin(this.landYaw) * 6; target.z += Math.cos(this.landYaw) * 6;
        if (Math.hypot(this.pos.x - target.x, this.pos.z - target.z) < 3){ this.state = 'descend'; }
      }
      const desired = v2.subVectors(target, this.pos);
      const sp = st === 'approach' ? Math.min(11, 3 + desired.length() * 0.5) : 9;
      desired.setLength(sp);
      this.vel.lerp(desired, Math.min(1, dt * 0.9));
      this.pos.addScaledVector(this.vel, dt);
      const hs = Math.hypot(this.vel.x, this.vel.z);
      const yaw = hs > 0.5 ? Math.atan2(-this.vel.x, -this.vel.z) : this.yaw;
      const yr = wrap(yaw - this.yaw) / Math.max(dt, 1e-3);
      this.yaw = yaw;
      this.bank += (Math.max(-0.6, Math.min(0.6, -yr * 0.5)) - this.bank) * Math.min(1, dt * 2);
      this.pitch += (Math.atan2(this.vel.y, Math.max(hs, 1)) * 0.7 - this.pitch) * Math.min(1, dt * 2);
      if (this.vel.y < -0.5 && st === 'fly') flapAmp = 0.25;    // gliding down
    } else if (st === 'descend'){
      flapRate = 5.5; flapAmp = 0.9;
      const g = this.spot.y;
      this.vel.x += ((this.spot.x - this.pos.x) * 1.2 - this.vel.x) * Math.min(1, dt * 3);
      this.vel.z += ((this.spot.z - this.pos.z) * 1.2 - this.vel.z) * Math.min(1, dt * 3);
      this.vel.y = -Math.min(3, 0.6 + (this.pos.y - g) * 0.5);
      this.pos.addScaledVector(this.vel, dt);
      this.yaw += wrap(this.landYaw - this.yaw) * Math.min(1, dt * 1.5);
      this.bank *= Math.exp(-dt * 3); this.pitch += (-0.05 - this.pitch) * Math.min(1, dt * 3);
      if (this.pos.y <= g + 0.02){
        this.pos.y = g; this.vel.set(0, 0, 0); this.state = 'rest'; this.timer = 0;
        this.particles.burst(v2.copy(this.pos).setY(g + 0.2), 0xc8b088, 30, 4, 0.12, 1.2, 0.3);
        sfx.thud(this.pos, 8); this.setColliders(true); this.emit('landed');
      }
    } else if (st === 'rest'){
      folded = 1;
      this.timer += dt;
      this.pitch *= Math.exp(-dt * 4); this.bank *= Math.exp(-dt * 4);
      this.yaw += wrap(this.landYaw - this.yaw) * Math.min(1, dt * 1.5);
      const near = player.pos.distanceTo(v2.copy(this.pos).setY(player.pos.y)) < 6;
      if (this.timer > 80 && !near && this.happy <= 0){ this.called = false; this.takeOff(); }
    } else if (st === 'takeoff'){
      flapRate = 6; flapAmp = 1;
      this.timer += dt;
      this.vel.set(0, Math.min(5, this.timer * 3), 0);
      this.pos.addScaledVector(this.vel, dt);
      if (this.timer > 2.6){
        this.vel.set(-Math.sin(this.yaw) * 6, 2, -Math.cos(this.yaw) * 6);
        this.state = this.called && this.spot ? 'approach' : 'fly';
        if (this.state === 'approach' && this.pos.distanceTo(this.spot) < 6) this.state = 'fly';
      }
    }

    // wings
    if (!folded){
      this.flap += dt * flapRate;
      const s = Math.sin(this.flap);
      if (this.lastFlapSin > 0 && s <= 0) sfx.whoosh(this.pos, flapAmp);
      this.lastFlapSin = s;
    }
    this.fold = (this.fold ?? 0) + (folded - (this.fold ?? 0)) * Math.min(1, dt * 2);
    const f = this.fold, s = Math.sin(this.flap);
    for (const w of this.wings){
      const flapA = s * flapAmp * 0.7 + 0.1, outA = Math.sin(this.flap - 0.7) * flapAmp * 0.5;
      w.inner.rotation.set(0, w.s * -1.15 * f, w.s * (flapA * (1 - f) + 0.55 * f));
      w.outer.rotation.set(0, w.s * -0.5 * f, w.s * (outA * (1 - f) - 0.9 * f));
    }
    // legs tucked in flight, standing at rest
    const air = 1 - f;
    this.legs.forEach((l, i) => { l.rotation.x = -0.9 * air + (i < 2 ? 0.05 : -0.05) * f; });
    // body breathing; lower when sitting
    this.body.position.y = 2.0 + Math.sin(this.t * 1.3) * 0.05 * f;

    // neck and head: straight out in flight, an S curve looking at you at rest
    let lookY = 0, lookP = 0;
    if (f > 0.5){
      const hp = v1.set(0, 0, 0); this.head.getWorldPosition(hp);
      const to = v2.subVectors(player.head, hp);
      const localYaw = wrap(Math.atan2(-to.x, -to.z) - this.yaw);
      if (to.length() < 20){ lookY = Math.max(-1.1, Math.min(1.1, localYaw)); lookP = Math.max(-0.7, Math.min(0.5, Math.atan2(to.y, Math.hypot(to.x, to.z)))); }
    }
    this.shake = Math.max(0, this.shake - dt);
    const shakeY = Math.sin(this.t * 30) * 0.25 * Math.min(1, this.shake * 2);
    this.lookYaw += (lookY - this.lookYaw) * Math.min(1, dt * 2.5); this.lookPitch += (lookP - this.lookPitch) * Math.min(1, dt * 2.5);
    const restCurve = [0.75, 0.35, -0.15, -0.55];
    this.neck.forEach((g, i) => { g.rotation.set(restCurve[i] * f + 0.05 * air + this.lookPitch * 0.2, this.lookYaw / 4 + (i === 3 ? shakeY : 0), 0); });
    this.head.rotation.set(-0.35 * f + this.lookPitch * 0.25, this.lookYaw / 5, this.happy > 0 ? Math.sin(this.t * 2) * 0.15 : 0);
    // tail: drooping to the ground at rest, swaying
    this.tail.forEach((g, i) => { g.rotation.set((i < 3 ? 0.28 : -0.05) * f + 0.03 * air, Math.sin(this.t * 1.2 - i * 0.6) * (0.08 + 0.1 * f) * (1 + this.happy), 0); });
    // eyes and mouth
    this.blinkT -= dt;
    if (this.blinkT <= 0){ this.blink = 0.18; this.blinkT = 2.5 + R() * 4; }
    this.blink = Math.max(0, this.blink - dt);
    this.happy = Math.max(0, this.happy - dt);
    const lid = this.blink > 0 ? 1 : this.happy > 0 ? 0.55 : 0.02;
    this.lids.scale.y += (lid - this.lids.scale.y) * Math.min(1, dt * 20);
    this.jaw.rotation.x = this.happy > 0 ? 0.18 : (st === 'takeoff' || this.roarT > 0 ? 0.35 : 0.02);

    // place it
    this.root.position.copy(this.pos);
    this.root.rotation.set(this.pitch, this.yaw, this.bank, 'YXZ');
    const g = surfaceHeight(this.pos.x, this.pos.z, this.pos.y + 0.5);
    this.shadow.position.set(this.pos.x, g + 0.03, this.pos.z);
    const hgt = this.pos.y - g;
    this.shadow.scale.setScalar(Math.max(0.4, 1 - hgt * 0.03));
    this.shadow.material.opacity = Math.max(0.15, 1 - hgt * 0.04);

    // petting
    if (st === 'rest' && hands){
      for (const h of hands){
        if (!h.tracked || h.held) continue;
        if (this.touching(h.pos) && h.vel.length() > 0.12){
          this.happy = 2.5;
          if (this.purrCool <= 0){ sfx.purr(h.pos); this.purrCool = 1.6; this.emit('pet'); }
          this.heartT -= dt;
          if (this.heartT <= 0){ this.particles.burst(v1.copy(h.pos).setY(h.pos.y + 0.1), 0xff6fa8, 2, 0.6, 0.05, 1.2, -0.15); this.heartT = 0.25; h.haptic(0.2, 30); }
        }
      }
    }
  }
  // is a point touching the dragon (head, neck or body)?
  touching(p){
    this.head.getWorldPosition(v2); if (v2.distanceTo(p) < 0.95) return true;
    for (const g of this.neck){ g.getWorldPosition(v2); if (v2.distanceTo(p) < 0.75) return true; }
    v2.copy(p); this.root.worldToLocal(v2);
    return Math.abs(v2.x) < 1.1 && v2.y > 1.0 && v2.y < 3.0 && Math.abs(v2.z) < 2.2;
  }
  spheres(){
    const out = [];
    out.push([this.body.getWorldPosition(new THREE.Vector3()), 1.3]);
    out.push([this.head.getWorldPosition(new THREE.Vector3()), 0.75]);
    out.push([this.neck[1].getWorldPosition(new THREE.Vector3()), 0.6]);
    return out;
  }
  raycast(o, d, max){
    let best = null;
    for (const [c, r] of this.spheres()){
      v1.subVectors(c, o); const tc = v1.dot(d); if (tc < 0) continue;
      const d2 = v1.lengthSq() - tc * tc; if (d2 > r * r) continue;
      const t = tc - Math.sqrt(r * r - d2);
      if (t < max && (!best || t < best.t)) best = { t, n: this };
    }
    return best;
  }
  hitSphere(p, r){ for (const [c, rr] of this.spheres()) if (c.distanceTo(p) < r + rr) return this; return null; }
  hit(){
    if (this.hitCool > 0) return;
    this.hitCool = 0.8; this.shake = 0.6;
    // a huff of smoke from the nose
    const nose = v1.set(0, 0.1, -1.6); this.head.localToWorld(nose);
    const dir = v2.set(0, 0, -1).applyQuaternion(this.head.getWorldQuaternion(q1));
    this.particles.burst(nose, 0x9a9a9a, 14, 1.2, 0.12, 1.4, -0.1, dir);
    sfx.huff(nose);
    this.emit('huff');
  }
}
