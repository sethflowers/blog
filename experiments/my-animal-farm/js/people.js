// People: customers who bring animals, the rider you see on the iPad (third person), and your hands in VR.
import * as THREE from 'three';
import { V, ellipsoid, limb, damp, clamp, rng } from './util.js';
import { mat } from './textures.js';

const SKINS = [0xf2cfae, 0xd9a77c, 0xa86e48, 0x6e4430, 0xf6dcc6];
const HAIRS = [0x2a1a10, 0x6a4022, 0xd8b060, 0x1a1a1a, 0x9a5a30, 0x8a8a8a];
const SHIRTS = [0x3a6ab0, 0xb03a3a, 0x3a8a4a, 0xe0c040, 0x7a4a9a, 0xf0f0f0, 0x2a4a6a, 0xd07a3a];
const PANTS = [0x2a3a5a, 0x3a3a3a, 0x6a5a40, 0xd8d0c0];

export class Person {
  constructor(opts = {}){
    const R = rng(opts.seed || 1);
    const pick = (a) => a[Math.floor(R() * a.length)];
    this.o = { skin: pick(SKINS), hair: pick(HAIRS), shirt: pick(SHIRTS), pants: pick(PANTS), long: R() < 0.5, helmet: false, height: 1.7, ...opts };
    const o = this.o;
    const skin = mat('skin', { color: o.skin, rough: 0.6 }), shirt = mat('plain-cloth', { color: o.shirt, rough: 0.85 }), pants = o.rider ? mat('plain-breeches', { color: 0xe8e2d4, rough: 0.8 }) : mat('denim', { color: o.pants === PANTS[0] ? 0xffffff : o.pants, rough: 0.9 });
    const boot = mat('leather', { color: 0x3a3a3a, rough: 0.5 }), hair = mat('plain-hair', { color: o.hair, rough: 0.7 });
    this.root = new THREE.Group();
    const s = o.height / 1.7;
    this.root.scale.setScalar(s);
    // hips, torso, head
    this.hips = new THREE.Group(); this.hips.position.y = 0.95; this.root.add(this.hips);
    const pelvis = new THREE.Mesh(ellipsoid(0.17, 0.11, 0.11), pants); this.hips.add(pelvis);
    this.torso = new THREE.Group(); this.hips.add(this.torso);
    const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.28, 4, 12), shirt); chest.position.y = 0.27; chest.scale.set(1.1, 1, 0.75); this.torso.add(chest);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 10), skin); neck.position.y = 0.55; this.torso.add(neck);
    this.head = new THREE.Group(); this.head.position.y = 0.62; this.torso.add(this.head);
    const headM = new THREE.Mesh(ellipsoid(0.095, 0.115, 0.105, 16, 12), skin); headM.position.y = 0.08; this.head.add(headM);
    const nose = new THREE.Mesh(ellipsoid(0.018, 0.028, 0.02, 8, 6), skin); nose.position.set(0, 0.07, 0.1); this.head.add(nose);
    for (const sx of [-1, 1]){
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), mat('plain-eye', { color: 0x1a1410, rough: 0.2 })); e.position.set(sx * 0.035, 0.1, 0.09); this.head.add(e);
      const ear = new THREE.Mesh(ellipsoid(0.015, 0.03, 0.02, 8, 6), skin); ear.position.set(sx * 0.095, 0.08, 0); this.head.add(ear);
    }
    if (o.helmet){
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.115, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat('plain-helmet', { color: 0x1a1a24, rough: 0.35 }));
      h.position.y = 0.11; h.scale.set(1, 0.95, 1.08); this.head.add(h);
      const peak = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.01, 0.06), mat('plain-helmet', { color: 0x1a1a24, rough: 0.35 })); peak.position.set(0, 0.11, 0.12); peak.rotation.x = 0.2; this.head.add(peak);
    } else {
      const hm = new THREE.Mesh(new THREE.SphereGeometry(0.102, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hair); hm.position.y = 0.09; hm.rotation.x = -0.25; this.head.add(hm);
      if (o.long){ const tail = new THREE.Mesh(ellipsoid(0.08, 0.14, 0.05), hair); tail.position.set(0, -0.02, -0.08); this.head.add(tail); }
    }
    // arms
    this.arms = [-1, 1].map((sx) => {
      const sh = new THREE.Group(); sh.position.set(sx * 0.19, 0.46, 0); this.torso.add(sh);
      sh.add(new THREE.Mesh(limb(0.28, 0.05, 0.042), shirt));
      const el = new THREE.Group(); el.position.y = -0.28; sh.add(el);
      el.add(new THREE.Mesh(limb(0.25, 0.04, 0.032), o.short ? skin : shirt));
      const hand = new THREE.Mesh(ellipsoid(0.035, 0.06, 0.02), skin); hand.position.y = -0.29; el.add(hand);
      return { sh, el };
    });
    // legs
    this.legs = [-1, 1].map((sx) => {
      const hip = new THREE.Group(); hip.position.set(sx * 0.09, -0.02, 0); this.hips.add(hip);
      hip.add(new THREE.Mesh(limb(0.44, 0.075, 0.055), pants));
      const knee = new THREE.Group(); knee.position.y = -0.44; hip.add(knee);
      knee.add(new THREE.Mesh(limb(0.42, 0.052, 0.04), o.rider ? boot : pants));
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.24), boot); foot.position.set(0, -0.44, 0.05); knee.add(foot);
      return { hip, knee };
    });
    this.root.traverse((m) => { if (m.isMesh){ m.castShadow = true; } });
    this.t = Math.random() * 10; this.wave = 0;
  }
  // pose: 'stand' | 'walk' | 'ride' | 'sit'; speed for walking; wave 0..1
  update(dt, { pose = 'stand', speed = 0, wave = 0, look = 0, reins = 0 } = {}){
    this.t += dt * (pose === 'walk' ? 1.6 + speed * 1.4 : 1);
    const t = this.t;
    if (pose === 'ride'){
      // seated: thighs forward and down round the horse, lower legs back, heels down
      this.hips.position.y = 0;
      for (let i = 0; i < 2; i++){
        const L = this.legs[i];
        L.hip.rotation.set(-1.0, 0, (i ? -1 : 1) * 0.32); L.knee.rotation.x = 1.25;
        const A = this.arms[i]; A.sh.rotation.set(-0.5 - reins * 0.2, 0, (i ? -1 : 1) * 0.15); A.el.rotation.x = -0.9;
      }
      this.torso.rotation.x = 0.08;
      this.head.rotation.y = look;
      return;
    }
    if (pose === 'sit'){
      this.hips.position.y = 0.45;
      for (let i = 0; i < 2; i++){ this.legs[i].hip.rotation.set(-1.5, 0, 0); this.legs[i].knee.rotation.x = 1.5; this.arms[i].sh.rotation.set(-0.3, 0, 0); this.arms[i].el.rotation.x = -0.6; }
      return;
    }
    this.hips.position.y = 0.95 + (pose === 'walk' ? Math.abs(Math.sin(t * Math.PI)) * 0.025 : 0);
    const sw = pose === 'walk' ? Math.sin(t * Math.PI) * 0.45 : 0;
    for (let i = 0; i < 2; i++){
      const sg = i ? -1 : 1, L = this.legs[i], A = this.arms[i];
      L.hip.rotation.set(sw * sg, 0, 0); L.knee.rotation.x = pose === 'walk' ? Math.max(0, Math.sin(t * Math.PI + (i ? Math.PI : 0) - 0.6)) * 0.7 : 0.03;
      A.sh.rotation.set(-sw * sg * 0.7, 0, (i ? -1 : 1) * 0.08); A.el.rotation.x = -0.25 - (pose === 'walk' ? 0.2 : 0);
    }
    // a wave with the right arm
    this.wave = damp(this.wave, wave, 6, dt);
    if (this.wave > 0.01){
      const A = this.arms[1];
      A.sh.rotation.z = -2.5 * this.wave; A.el.rotation.x = 0; A.el.rotation.z = Math.sin(t * 8) * 0.4 * this.wave;
    }
    this.torso.rotation.x = 0;
    this.head.rotation.y = damp(this.head.rotation.y, look, 4, dt);
  }
}

// ---------- your hands in VR: a riding glove with fingers that curl ----------
export class Hand {
  constructor(side){
    this.side = side;
    const g = mat('leather', { color: 0x3a2a20, rough: 0.6 });
    this.group = new THREE.Group();
    const sx = side === 'left' ? -1 : 1;
    // grip space: -Z toward the thumb, +Y up the arm, palm wrapped round the controller handle
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.095, 0.085), g); palm.position.set(sx * 0.012, 0.0, 0.0); this.group.add(palm);
    this.fingers = [];
    for (let i = 0; i < 4; i++){
      const f = new THREE.Group(); f.position.set(sx * 0.0, -0.05, -0.03 + i * 0.022); this.group.add(f);
      const a = new THREE.Mesh(new THREE.CapsuleGeometry(0.009, 0.035, 3, 6), g); a.position.y = -0.022; f.add(a);
      const b = new THREE.Group(); b.position.y = -0.045; f.add(b);
      const c = new THREE.Mesh(new THREE.CapsuleGeometry(0.008, 0.025, 3, 6), g); c.position.y = -0.016; b.add(c);
      this.fingers.push({ f, b });
    }
    const th = new THREE.Group(); th.position.set(sx * -0.01, 0.0, -0.045); this.group.add(th);
    const tm = new THREE.Mesh(new THREE.CapsuleGeometry(0.01, 0.04, 3, 6), g); tm.position.set(0, -0.025, 0); th.add(tm);
    th.rotation.x = 0.8;
    this.thumb = th;
    this.group.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    this.curl = 0;
  }
  // grip 0 open .. 1 closed fist; index separately
  pose(grip, index){
    const sx = this.side === 'left' ? -1 : 1;
    for (let i = 0; i < 4; i++){
      const c = i === 0 ? index : grip, F = this.fingers[i];
      F.f.rotation.set(0, 0, sx * c * 1.3); F.b.rotation.set(0, 0, sx * c * 1.4);
    }
    this.thumb.rotation.z = sx * grip * 0.6;
  }
}
