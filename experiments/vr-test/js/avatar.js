// The player's body. Everything is placed in world space each frame from the head and the two
// controller grips: the torso hangs under the head, arms reach the hands with two-bone IK (the elbow
// follows the forearm direction the controller implies), and the feet step on their own to stay under
// the hips. A second copy, flipped, is what the mirror shows.
import * as THREE from 'three';
import { boxGeo, boxMesh, multiBox, blockMaterial, solveIK, placeLimb, COL, UP } from './util.js';

const REF_EYE = 1.62;            // body proportions below are for someone with eyes 1.62 m up

// A blocky hand with jointed fingers, modelled in WebXR grip space for the right hand:
// -Z runs along the controller handle toward the thumb, +X out of the back of the hand, +Y up the arm.
// The left hand is the same model mirrored in X.
export class Hand {
  constructor(side, color = COL.skin, simple = false){
    this.side = side;
    this.group = new THREE.Group();
    if (side === 'left') this.group.scale.x = -1;
    this.pose = { index: 0.2, grip: 0.2, thumb: 0 };
    this.simple = simple;
    if (simple){
      // one piece: palm, loosely curled fingers, thumb, cuff (for villagers)
      this.group.add(multiBox([[0.028, 0.09, 0.086, color, 0.027, 0.03, 0], [0.05, 0.03, 0.07, COL.shirt, 0.02, 0.085, 0.012],
        [0.024, 0.05, 0.08, color, 0.018, -0.035, 0.0], [0.022, 0.05, 0.022, color, 0.015, 0.0, -0.055]]));
      return;
    }
    const mat = blockMaterial();
    const palm = new THREE.Mesh(boxGeo(0.028, 0.09, 0.086, color), mat);
    palm.position.set(0.027, 0.03, 0);
    this.group.add(palm);
    // a cuff at the wrist, the colour of the sleeve
    const cuff = new THREE.Mesh(boxGeo(0.05, 0.03, 0.07, COL.shirt), mat);
    cuff.position.set(0.02, 0.085, 0.012);
    this.group.add(cuff);
    this.fingers = [];
    const zs = [-0.032, -0.011, 0.011, 0.031], l1 = [0.045, 0.048, 0.045, 0.036], l2 = [0.038, 0.042, 0.038, 0.03];
    for (let i = 0; i < 4; i++){
      const k = new THREE.Group(); k.position.set(0.026, -0.014, zs[i]);
      const a = new THREE.Mesh(boxGeo(0.021, l1[i], 0.019, color, 0, -l1[i] / 2, 0), mat);
      const j = new THREE.Group(); j.position.set(0, -l1[i], 0);
      const b = new THREE.Mesh(boxGeo(0.019, l2[i], 0.018, color, 0, -l2[i] / 2, 0), mat);
      j.add(b); k.add(a, j); this.group.add(k);
      this.fingers.push({ k, j });
    }
    this.thumb = new THREE.Group(); this.thumb.position.set(0.018, 0.032, -0.042);
    const t1 = new THREE.Mesh(boxGeo(0.022, 0.042, 0.022, color, 0, -0.021, 0), mat);
    this.thumbTip = new THREE.Group(); this.thumbTip.position.set(0, -0.042, 0);
    this.thumbTip.add(new THREE.Mesh(boxGeo(0.02, 0.032, 0.02, color, 0, -0.016, 0), mat));
    this.thumb.add(t1, this.thumbTip);
    this.group.add(this.thumb);
    // current pose (smoothed): index curl, other fingers curl, thumb down
    this.pose = { index: 0.2, grip: 0.2, thumb: 0 };
  }
  // index/grip 0..1 (open..fist), thumb 0 (up) .. 1 (resting on the buttons)
  setPose(index, grip, thumb){
    const p = this.pose; p.index = index; p.grip = grip; p.thumb = thumb;
    if (this.simple) return;
    const f = this.fingers;
    for (let i = 0; i < 4; i++){
      const c = i === 0 ? index : grip;
      f[i].k.rotation.z = -c * 1.45;
      f[i].j.rotation.z = -c * 1.7;
    }
    // thumb: from sticking up along -Z (thumbs up) to lying over the end of the handle
    _a.set(0, -0.32, -1).normalize(); _b.set(-0.55, -0.75, -0.42).normalize();
    _a.lerp(_b, thumb).normalize();
    this.thumb.quaternion.setFromUnitVectors(_down, _a);
    this.thumbTip.rotation.z = -0.35 * thumb;
    this.thumbTip.rotation.x = 0.2 * thumb;
  }
  copyPose(o){ this.setPose(o.pose.index, o.pose.grip, o.pose.thumb); }
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _down = new THREE.Vector3(0, -1, 0);

// blob shadow texture
let shadowTex = null;
export function blobShadow(size){
  if (!shadowTex){
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,0.45)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    shadowTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  m.rotation.x = -Math.PI / 2; m.renderOrder = 1;
  return m;
}

const tmp = {
  fwd: new THREE.Vector3(), up: new THREE.Vector3(), right: new THREE.Vector3(), v: new THREE.Vector3(), w: new THREE.Vector3(),
  neck: new THREE.Vector3(), axis: new THREE.Vector3(), q: new THREE.Quaternion(), m: new THREE.Matrix4(),
  wpos: new THREE.Vector3(), wrist: new THREE.Vector3(), elbow: new THREE.Vector3(), pole: new THREE.Vector3(), gy: new THREE.Vector3(), gx: new THREE.Vector3(),
  hip: new THREE.Vector3(), knee: new THREE.Vector3(), ankle: new THREE.Vector3(), a: new THREE.Vector3(), b: new THREE.Vector3(),
};
const wrapAngle = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
export const yawOf = (v) => Math.atan2(-v.x, -v.z);
const fwdOf = (yaw, out) => out.set(-Math.sin(yaw), 0, -Math.cos(yaw));

export class Avatar {
  constructor({ head = false, shirt = COL.shirt, pants = COL.pants, skin = COL.skin, hair = COL.hair, simpleHands = false, firstPerson = false } = {}){
    this.firstPerson = firstPerson;
    this.root = new THREE.Group();
    this.parts = [];
    const add = (m) => { this.root.add(m); this.parts.push(m); return m; };
    const limb = (w, d, c) => add(boxMesh(w, 1, d, c, 0, 0.5, 0));
    this.pelvisM = limb(0.35, 0.21, pants);
    this.belly = limb(0.33, 0.2, shirt);
    this.chest = limb(0.38, 0.22, shirt);
    this.upper = [limb(0.1, 0.1, shirt), limb(0.1, 0.1, shirt)];
    // forearms a little flatter than they are wide, like real ones, so a watch can sit on top
    this.fore = [limb(0.072, 0.06, skin), limb(0.072, 0.06, skin)];
    // where a watch sits on the back of the left forearm, just above the wrist (updated every frame)
    this.watchMatrix = new THREE.Matrix4();
    this.thigh = [limb(0.15, 0.15, pants), limb(0.15, 0.15, pants)];
    this.shin = [limb(0.12, 0.12, pants), limb(0.12, 0.12, pants)];
    this.foot = [add(boxMesh(0.12, 0.08, 0.27, { all: COL.shoe, ny: 0x1d140e }, 0, 0.04, -0.06)), add(boxMesh(0.12, 0.08, 0.27, { all: COL.shoe, ny: 0x1d140e }, 0, 0.04, -0.06))];
    this.hands = [new Hand('left', skin, simpleHands), new Hand('right', skin, simpleHands)];
    for (const h of this.hands) add(h.group);
    this.headM = null;
    if (head){
      const g = new THREE.Group();
      const hb = [[0.23, 0.25, 0.24, skin], [0.25, 0.07, 0.26, hair, 0, 0.12, 0.005], [0.25, 0.17, 0.06, hair, 0, 0.04, 0.105], [0.08, 0.02, 0.01, 0x9a4a3a, 0, -0.07, -0.122]];
      for (const sx of [-1, 1]) hb.push([0.05, 0.035, 0.01, 0xffffff, sx * 0.055, 0.02, -0.122], [0.025, 0.035, 0.01, 0x2a3a6a, sx * 0.045, 0.02, -0.126]);
      g.add(multiBox(hb));
      this.headM = add(g);
      this.neckM = limb(0.09, 0.09, skin);
    }
    this.shadow = blobShadow(0.8); this.root.add(this.shadow); this.parts.push(this.shadow);

    this.s = 1;
    this.bodyYaw = 0;
    this.pelvis = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.lastPelvis = null;
    this.feet = [0, 1].map(() => ({ pos: new THREE.Vector3(), yaw: 0, stepping: false, from: new THREE.Vector3(), to: new THREE.Vector3(), t: 0, dur: 0.25, fromYaw: 0, toYaw: 0, init: false }));
    this.airborne = false;
    this._bfwd = new THREE.Vector3();
    this.onStep = null;      // callback(footIndex, position) when a foot lands
  }

  setScale(eyeHeight){ this.s = Math.min(1.25, Math.max(0.55, eyeHeight / REF_EYE)); }

  // headPos/headQuat: world pose of the eyes. grips: [left, right] each null or { pos, quat }.
  // ground(x, z) -> floor height. airborne: true while jumping/falling.
  update(dt, headPos, headQuat, grips, ground, airborne){
    const s = this.s, T = tmp;
    // ---- facing ----
    T.fwd.set(0, 0, -1).applyQuaternion(headQuat);
    T.up.set(0, 1, 0).applyQuaternion(headQuat);
    T.v.copy(T.fwd).addScaledVector(T.up, -T.fwd.y); T.v.y = 0;
    if (T.v.lengthSq() < 1e-6) T.v.set(0, 0, -1);
    let target = yawOf(T.v);
    if (grips[0] && grips[1]){
      // hands out in front pull the body round a little
      T.w.addVectors(grips[0].pos, grips[1].pos).multiplyScalar(0.5).sub(headPos); T.w.y = 0;
      if (T.w.lengthSq() > 0.04) target += wrapAngle(yawOf(T.w) - target) * 0.3;
    }
    let diff = wrapAngle(target - this.bodyYaw);
    const lim = 0.65;
    if (diff > lim) this.bodyYaw += diff - lim; else if (diff < -lim) this.bodyYaw += diff + lim;
    diff = wrapAngle(target - this.bodyYaw);
    const speed = this.vel.length();
    this.bodyYaw = wrapAngle(this.bodyYaw + diff * Math.min(1, dt * (speed > 0.4 ? 5 : 1.2)));
    const fwd = fwdOf(this.bodyYaw, T.fwd), right = T.right.set(-fwd.z, 0, fwd.x);

    // ---- torso ----
    const torso = 0.56 * s, l1 = 0.45 * s, l2 = 0.43 * s, ankleH = 0.075 * s;
    T.neck.set(0, -0.12 * s, 0.085 * s).applyQuaternion(headQuat).add(headPos);
    if (this.firstPerson) T.neck.addScaledVector(fwd, -0.09 * s);
    const g = ground(T.neck.x, T.neck.z);
    const maxPelvis = g + l1 + l2 + ankleH + 0.03 * s;
    let py = T.neck.y - torso;
    if (!airborne) py = Math.min(py, maxPelvis);
    py = Math.max(py, g + 0.3 * s);
    const dy = T.neck.y - py, horiz = Math.sqrt(Math.max(0, torso * torso - dy * dy));
    this.pelvis.set(T.neck.x - fwd.x * horiz - fwd.x * 0.03 * s, py, T.neck.z - fwd.z * horiz - fwd.z * 0.03 * s);
    if (this.lastPelvis && dt > 0){
      T.v.subVectors(this.pelvis, this.lastPelvis).divideScalar(dt); T.v.y = 0;
      this.vel.lerp(T.v, Math.min(1, dt * 10));
    } else this.lastPelvis = new THREE.Vector3();
    this.lastPelvis.copy(this.pelvis);
    T.axis.subVectors(T.neck, this.pelvis).normalize();
    const at = (f, out) => out.copy(this.pelvis).addScaledVector(T.axis, f * torso);
    // body right, square to the spine
    const bright = T.w.copy(right).addScaledVector(T.axis, -right.dot(T.axis)).normalize();
    const bfwd = this._bfwd.crossVectors(T.axis, bright);            // up x right = forward
    placeLimb(this.pelvisM, at(-0.12, T.a), at(0.14, T.b), bfwd);
    placeLimb(this.belly, at(0.14, T.a), at(0.45, T.b), bfwd);
    placeLimb(this.chest, at(0.45, T.a), at(1.0, T.b), bfwd);
    for (const m of [this.pelvisM, this.belly, this.chest]) m.scale.x = m.scale.z = s;
    if (this.headM){
      this.headM.position.set(0, 0.03 * s, 0.075 * s).applyQuaternion(headQuat).add(headPos);
      this.headM.quaternion.copy(headQuat); this.headM.scale.setScalar(s);
      placeLimb(this.neckM, at(0.95, T.a), T.v.copy(this.headM.position).addScaledVector(T.up, -0.09 * s), bfwd);
      this.neckM.scale.x = this.neckM.scale.z = s;
    }

    // ---- arms ----
    const ua = 0.29 * s, fa = 0.27 * s;
    for (let i = 0; i < 2; i++){
      const side = i === 0 ? -1 : 1, hand = this.hands[i];
      const shoulder = at(0.9, new THREE.Vector3()).addScaledVector(bright, side * 0.2 * s);
      const gp = grips[i];
      if (gp){
        hand.group.position.copy(gp.pos); hand.group.quaternion.copy(gp.quat);
      } else {
        // hanging at the side
        T.m.makeBasis(bright, T.axis, T.v.crossVectors(bright, T.axis));
        hand.group.quaternion.setFromRotationMatrix(T.m);
        hand.group.position.copy(shoulder).addScaledVector(T.axis, -(ua + fa + 0.07)).addScaledVector(bright, side * 0.04 * s).addScaledVector(bfwd, 0.04);
      }
      hand.group.scale.set(side * Math.min(1.1, Math.max(0.8, s)), Math.min(1.1, Math.max(0.8, s)), Math.min(1.1, Math.max(0.8, s)));
      // wrist: up the arm (+Y) and toward the back of the hand from the grip
      T.wrist.set(side * 0.02, 0.08, 0.012).multiply(T.b.set(1, 1, 1).multiplyScalar(Math.abs(hand.group.scale.y))).applyQuaternion(hand.group.quaternion).add(hand.group.position);
      T.gy.set(0, 1, 0).applyQuaternion(hand.group.quaternion);
      T.gx.set(side, 0, 0).applyQuaternion(hand.group.quaternion);
      let a1 = ua, a2 = fa;
      const d = shoulder.distanceTo(T.wrist);
      if (d > a1 + a2){ const k = d / (a1 + a2) * 1.001; a1 *= k; a2 *= k; }
      // where the forearm points says where the elbow is; blend with "down, out and back"
      T.pole.copy(T.wrist).addScaledVector(T.gy, a2).sub(shoulder).normalize().multiplyScalar(0.7);
      T.v.copy(T.axis).multiplyScalar(-1).addScaledVector(bright, side * 0.8).addScaledVector(bfwd, -0.4).normalize().multiplyScalar(0.3);
      T.pole.add(T.v);
      solveIK(shoulder, T.wrist, a1, a2, T.pole, T.elbow);
      placeLimb(this.upper[i], shoulder, T.elbow, bfwd);
      placeLimb(this.fore[i], T.elbow, T.wrist, T.gx);
      this.upper[i].scale.x = this.upper[i].scale.z = s;
      this.fore[i].scale.x = this.fore[i].scale.z = s;
      if (i === 0){
        // the watch lies on the forearm's outer surface (the side the back of the hand faces), its
        // length along the arm, so the arm itself can never cover it
        T.a.subVectors(T.elbow, T.wrist); const fl = T.a.length() || 1; T.a.divideScalar(fl);
        T.b.copy(T.gx).addScaledVector(T.a, -T.gx.dot(T.a)).normalize();
        T.wpos.copy(T.wrist).addScaledVector(T.a, Math.min(0.06 * s, fl * 0.4)).addScaledVector(T.b, 0.03 * s + 0.012);
        // face halfway between the forearm and the back of the hand, the way a wrist turns to read it
        T.b.add(T.gx).normalize();
        T.a.addScaledVector(T.b, -T.a.dot(T.b)).normalize();
        T.v.crossVectors(T.a, T.b); T.a.negate();
        this.watchMatrix.makeBasis(T.a, T.v, T.b).setPosition(T.wpos);
      }
    }

    // ---- legs and stepping feet ----
    this.airborne = airborne;
    const lead = T.v.copy(this.vel).multiplyScalar(0.22);
    if (lead.length() > 0.5) lead.setLength(0.5);
    const want = [0, 1].map((i) => {
      const side = i === 0 ? -1 : 1;
      const p = new THREE.Vector3(this.pelvis.x + right.x * side * 0.11 * s + lead.x, 0, this.pelvis.z + right.z * side * 0.11 * s + lead.z);
      p.y = ground(p.x, p.z);
      return p;
    });
    const anyStepping = this.feet.some((f) => f.stepping);
    for (let i = 0; i < 2; i++){
      const f = this.feet[i], w = want[i];
      if (!f.init || f.pos.distanceTo(w) > 1.6){ f.pos.copy(w); f.yaw = this.bodyYaw; f.stepping = false; f.init = true; }
    }
    if (airborne){
      for (let i = 0; i < 2; i++){
        const f = this.feet[i];
        f.stepping = false;
        f.pos.lerp(T.a.set(want[i].x, this.pelvis.y - (l1 + l2) * 0.92, want[i].z), Math.min(1, dt * 12));
        f.yaw = this.bodyYaw;
        f.landed = false;
      }
    } else {
      // start a step with whichever foot is furthest out, if the other one is planted
      const err = this.feet.map((f, i) => Math.hypot(f.pos.x - want[i].x, f.pos.z - want[i].z) + Math.abs(wrapAngle(this.bodyYaw - f.yaw)) * 0.25 * s);
      const order = err[0] > err[1] ? [0, 1] : [1, 0];
      for (const i of order){
        const f = this.feet[i];
        if (f.landed === false){ f.pos.copy(want[i]); f.landed = true; f.stepping = false; continue; }
        if (f.stepping || anyStepping) continue;
        if (err[i] > 0.2 * s || (speed < 0.1 && err[i] > 0.09 * s && this.idleT > 0.6)){
          f.stepping = true; f.t = 0; f.from.copy(f.pos); f.to.copy(want[i]);
          f.fromYaw = f.yaw; f.toYaw = this.bodyYaw;
          f.dur = Math.max(0.14, Math.min(0.3, 0.3 - speed * 0.045));
          this.idleT = 0;
          break;
        }
      }
      this.idleT = (this.idleT || 0) + dt;
      for (let i = 0; i < 2; i++){
        const f = this.feet[i];
        if (!f.stepping) continue;
        f.t += dt / f.dur;
        // chase a moving target
        f.to.lerp(want[i], Math.min(1, dt * 8));
        const t = Math.min(1, f.t), e = t * t * (3 - 2 * t);
        f.pos.lerpVectors(f.from, f.to, e);
        f.pos.y += Math.sin(Math.PI * t) * 0.09 * s;
        f.yaw = f.fromYaw + wrapAngle(f.toYaw - f.fromYaw) * e;
        if (t >= 1){ f.stepping = false; f.pos.copy(f.to); if (this.onStep) this.onStep(i, f.pos); }
      }
    }
    for (let i = 0; i < 2; i++){
      const side = i === 0 ? -1 : 1, f = this.feet[i];
      T.hip.copy(this.pelvis).addScaledVector(bright, side * 0.1 * s).addScaledVector(T.axis, -0.06 * s);
      T.ankle.copy(f.pos); T.ankle.y += ankleH;
      const reach = l1 + l2;
      if (T.hip.distanceTo(T.ankle) > reach) T.ankle.sub(T.hip).setLength(reach * 0.999).add(T.hip);
      const ff = fwdOf(f.yaw, T.a);
      T.pole.copy(ff).add(bfwd).normalize().addScaledVector(bright, side * 0.15);
      solveIK(T.hip, T.ankle, l1, l2, T.pole, T.knee);
      placeLimb(this.thigh[i], T.hip, T.knee, bfwd);
      placeLimb(this.shin[i], T.knee, T.ankle, ff);
      this.thigh[i].scale.x = this.thigh[i].scale.z = s;
      this.shin[i].scale.x = this.shin[i].scale.z = s;
      const ft = this.foot[i];
      ft.position.copy(T.ankle); ft.position.y -= ankleH;
      ft.rotation.set(0, f.yaw, 0); ft.scale.setScalar(s);
    }
    this.shadow.position.set(this.pelvis.x, g + 0.02, this.pelvis.z);
    this.shadow.scale.setScalar(Math.max(0.3, 1 - (this.pelvis.y - g - 0.9 * s) * 0.4) * s);
  }

  // Copy every part's pose from another avatar (the mirror copy follows the real one).
  copyFrom(o){
    const n = Math.min(this.parts.length, o.parts.length);
    // parts are added in the same order; the mirror copy has a head and neck the real one lacks
    const map = this._map || (this._map = this.buildMap(o));
    for (const [mine, theirs] of map){ mine.position.copy(theirs.position); mine.quaternion.copy(theirs.quaternion); mine.scale.copy(theirs.scale); mine.visible = theirs.visible; }
    for (let i = 0; i < 2; i++) this.hands[i].copyPose(o.hands[i]);
    if (this.headM){ this.headM.visible = true; this.neckM.visible = true; }
    return n;
  }
  buildMap(o){
    const pairs = [[this.pelvisM, o.pelvisM], [this.belly, o.belly], [this.chest, o.chest], [this.shadow, o.shadow]];
    if (this.headM && o.headM) pairs.push([this.headM, o.headM], [this.neckM, o.neckM]);
    for (let i = 0; i < 2; i++){
      pairs.push([this.upper[i], o.upper[i]], [this.fore[i], o.fore[i]], [this.thigh[i], o.thigh[i]], [this.shin[i], o.shin[i]], [this.foot[i], o.foot[i]], [this.hands[i].group, o.hands[i].group]);
    }
    return pairs;
  }
}
