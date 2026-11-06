// The horse. A smooth body built from cross-sections (like a sculptor's armature), legs with real
// joints (elbow, knee, fetlock, pastern, hoof in front; stifle, hock, fetlock behind) placed with IK so
// the hooves plant on the ground, a mane and tail of hair cards, and coat colours with markings.
//
// It walks, trots, canters and gallops with the right footfalls, jumps, grazes, eats from the rack,
// drinks, dozes with a hind leg cocked, swishes its tail, flicks its ears and follows you on a lead.
//
// Dirt is painted on the coat vertex by vertex: the curry comb loosens caked mud into dust, the body
// brush takes the dust away. Tack goes on piece by piece: saddle pad, saddle, girth, bridle.
import * as THREE from 'three';
import { V, loft, limb, ellipsoid, clamp, lerp, damp, smooth, ik2, vnoise, fbm, rng, angleDiff } from './util.js';
import { tex, mat } from './textures.js';

// ---------- breeds and coats ----------
export const BREEDS = {
  thoroughbred: { name: 'Thoroughbred', scale: 1.0, width: 0.96, jump: 0.75, speed: 0.95, stamina: 0.8, calm: 0.45, price: 6500 },
  warmblood:    { name: 'Warmblood', scale: 1.04, width: 1.04, jump: 0.92, speed: 0.8, stamina: 0.8, calm: 0.7, price: 12000 },
  quarter:      { name: 'Quarter Horse', scale: 0.95, width: 1.08, jump: 0.6, speed: 0.85, stamina: 0.75, calm: 0.85, price: 4200 },
  arabian:      { name: 'Arabian', scale: 0.92, width: 0.94, jump: 0.62, speed: 0.85, stamina: 0.98, calm: 0.5, price: 5500 },
  connemara:    { name: 'Connemara Pony', scale: 0.85, width: 1.02, jump: 0.8, speed: 0.7, stamina: 0.85, calm: 0.8, price: 3800 },
  friesian:     { name: 'Friesian', scale: 1.03, width: 1.1, jump: 0.5, speed: 0.7, stamina: 0.7, calm: 0.8, price: 9000 },
  appaloosa:    { name: 'Appaloosa', scale: 0.95, width: 1.02, jump: 0.66, speed: 0.78, stamina: 0.8, calm: 0.8, price: 4600 },
  shetland:     { name: 'Shetland Pony', scale: 0.62, width: 1.2, jump: 0.35, speed: 0.5, stamina: 0.7, calm: 0.6, price: 1500 },
};
const srgb = (r, g, b) => [Math.pow(r, 2.2), Math.pow(g, 2.2), Math.pow(b, 2.2)];
export const COATS = {
  bay:       { name: 'Bay', body: srgb(0.52, 0.27, 0.13), points: srgb(0.06, 0.05, 0.05), mane: 0x141010 },
  darkbay:   { name: 'Dark Bay', body: srgb(0.3, 0.15, 0.08), points: srgb(0.05, 0.04, 0.04), mane: 0x0e0a0a },
  chestnut:  { name: 'Chestnut', body: srgb(0.64, 0.32, 0.14), points: null, mane: 0x8a4a22 },
  black:     { name: 'Black', body: srgb(0.075, 0.065, 0.065), points: null, mane: 0x0a0a0a },
  grey:      { name: 'Dapple Grey', body: srgb(0.78, 0.78, 0.77), points: srgb(0.45, 0.45, 0.46), mane: 0xd8d8d4, dapple: true },
  palomino:  { name: 'Palomino', body: srgb(0.86, 0.66, 0.36), points: null, mane: 0xf2e8d0 },
  buckskin:  { name: 'Buckskin', body: srgb(0.8, 0.63, 0.4), points: srgb(0.07, 0.06, 0.05), mane: 0x141010 },
  pinto:     { name: 'Pinto', body: srgb(0.5, 0.26, 0.13), points: srgb(0.08, 0.06, 0.05), mane: 0x221812, patches: true },
  appaloosa: { name: 'Appaloosa', body: srgb(0.45, 0.24, 0.12), points: srgb(0.08, 0.06, 0.05), mane: 0x2a1c14, blanket: true },
};
const WHITE = srgb(0.93, 0.92, 0.9), SKIN = srgb(0.22, 0.2, 0.2), PINK = srgb(0.62, 0.48, 0.46);
const MUD = srgb(0.36, 0.27, 0.17), DUST = srgb(0.62, 0.56, 0.47);

// ---------- body shape ----------
// Cross-sections of the trunk, tail to chest (horse faces +Z). [z, centre y, half width, half height, flat top]
const BODY = [
  [-0.99, 1.31, 0.08, 0.12, 0.2], [-0.93, 1.32, 0.19, 0.25, 0.3], [-0.78, 1.34, 0.26, 0.29, 0.35], [-0.5, 1.31, 0.275, 0.31, 0.25],
  [-0.18, 1.27, 0.29, 0.355, 0.2], [0.15, 1.26, 0.285, 0.37, 0.2], [0.42, 1.28, 0.24, 0.36, 0.3], [0.64, 1.25, 0.2, 0.31, 0.25],
  [0.78, 1.21, 0.14, 0.21, 0.2], [0.84, 1.19, 0.05, 0.08, 0.2],
];
export function bodyAt(z){
  // Catmull-Rom through the sections, by z
  let i = 0; while (i < BODY.length - 2 && BODY[i + 1][0] < z) i++;
  const a = BODY[Math.max(0, i - 1)], b = BODY[i], c = BODY[i + 1], d = BODY[Math.min(BODY.length - 1, i + 2)];
  const t = clamp((z - b[0]) / (c[0] - b[0]));
  const cr = (k) => 0.5 * ((2 * b[k]) + (-a[k] + c[k]) * t + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t * t + (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * t * t * t);
  return { cy: cr(1), rx: cr(2), ry: cr(3), top: lerp(b[4], c[4], t) };
}
// a point on the body surface at length z and angle a (0 = right side, pi/2 = top), pushed out by off
export function bodySurface(z, a, off = 0, w = 1){
  const s = bodyAt(z), sa = Math.sin(a), f = sa > 0 ? 1 - s.top * sa * sa : 1;
  return V(-(s.rx * w + off) * Math.cos(a) * f, s.cy + (s.ry + off) * sa, z);
}

// leg layout (horse space). Front: elbow pivot; hind: stifle pivot.
const LEGS = [
  { name: 'LF', front: true, x: 0.11, y: 1.06, z: 0.52, l1: 0.5, l2: 0.34, foot: 0.215, bend: 1 },
  { name: 'RF', front: true, x: -0.11, y: 1.06, z: 0.52, l1: 0.5, l2: 0.34, foot: 0.215, bend: 1 },
  { name: 'LH', front: false, x: 0.135, y: 1.13, z: -0.58, l1: 0.56, l2: 0.42, foot: 0.215, bend: -1 },
  { name: 'RH', front: false, x: -0.135, y: 1.13, z: -0.58, l1: 0.56, l2: 0.42, foot: 0.215, bend: -1 },
];
// footfall timing per gait (fraction of a stride each leg is offset), share of the stride on the ground,
// how high a hoof lifts, and the body's bounce
const GAITS = {
  walk:   { off: [0.25, 0.75, 0.0, 0.5], duty: 0.64, lift: 0.1, freq: (v) => 0.55 + 0.26 * v, bob: 0.012, bobN: 2, pitch: 0.01, nod: 0.05 },
  trot:   { off: [0.0, 0.5, 0.5, 0.0], duty: 0.44, lift: 0.17, freq: (v) => 1.15 + 0.09 * v, bob: 0.035, bobN: 2, pitch: 0.01, nod: 0.015 },
  canter: { off: [0.3, 0.56, 0.0, 0.3], duty: 0.38, lift: 0.22, freq: (v) => 1.5 + 0.05 * v, bob: 0.05, bobN: 1, pitch: 0.07, nod: 0.08 },
  gallop: { off: [0.42, 0.55, 0.0, 0.1], duty: 0.3, lift: 0.26, freq: (v) => 1.85 + 0.035 * v, bob: 0.05, bobN: 1, pitch: 0.06, nod: 0.09 },
};
export function gaitFor(v, cur){
  // with a little hysteresis so it doesn't flicker between gaits
  const up = { stand: 0.06, walk: 2.0, trot: 4.6, canter: 8.4 }, dn = { walk: 0.03, trot: 1.75, canter: 4.1, gallop: 7.8 };
  const order = ['stand', 'walk', 'trot', 'canter', 'gallop'];
  let i = order.indexOf(cur); if (i < 0) i = 0;
  while (i < 4 && v > up[order[i]]) i++;
  while (i > 0 && v < dn[order[i]]) i--;
  return order[i];
}

// shared materials
let SM = null;
function shared(){
  if (SM) return SM;
  const coat = tex('coat');
  SM = {
    coat: new THREE.MeshStandardMaterial({ map: coat.map, normalMap: coat.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), vertexColors: true, roughness: 0.52, metalness: 0.0 }),
    eye: new THREE.MeshStandardMaterial({ color: 0x0a0806, roughness: 0.05, metalness: 0.2 }),
    hoof: new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 0.55 }),
    hoofLight: new THREE.MeshStandardMaterial({ color: 0x8a7a64, roughness: 0.55 }),
    nostril: new THREE.MeshStandardMaterial({ color: 0x120e0c, roughness: 0.6 }),
    leather: mat('leather', { rough: 0.55 }),
    leatherDark: mat('leather', { rough: 0.5, color: 0x5a4a40 }),
    pad: mat('quilt', { rough: 0.85 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.25, metalness: 0.95 }),
    halter: [0xc02828, 0x2850c0, 0x2a8a3a, 0x8a2ab0, 0xe08a1a].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 })),
  };
  return SM;
}

// ---------- the model ----------
export class HorseModel {
  constructor(look = {}){
    this.look = { breed: 'thoroughbred', coat: 'bay', socks: [0, 0, 0, 0], face: 'none', halter: 0, seed: 1, ...look };
    const breed = BREEDS[this.look.breed] || BREEDS.thoroughbred;
    this.scale = breed.scale;
    const S = shared();
    const coat = COATS[this.look.coat] || COATS.bay;
    this.coat = coat;
    this.root = new THREE.Group();          // placed in the world
    this.body = new THREE.Group();          // bobs and pitches
    this.root.add(this.body);
    this.root.scale.setScalar(breed.scale);
    this.body.scale.x = breed.width;
    this.parts = [];                         // coat meshes, for dirt and brushing
    // trunk
    const bodyG = loft(BODY.map((s) => ({ p: [0, s[1], s[0]], rx: s[2], ry: s[3], top: s[4] })), { ring: 28, steps: 7, uvScale: 2.2 });
    this.trunk = this.coatMesh(bodyG, this.body, 'body');
    // neck: pivots at the withers so it can lower to graze
    this.neck = new THREE.Group(); this.neck.position.set(0, 1.4, 0.56); this.body.add(this.neck);
    const neckG = loft([
      { p: [0, -0.06, -0.12], rx: 0.2, ry: 0.3 }, { p: [0, 0.06, 0.12], rx: 0.18, ry: 0.28, top: 0.1 }, { p: [0, 0.27, 0.32], rx: 0.14, ry: 0.22, top: 0.15 },
      { p: [0, 0.47, 0.47], rx: 0.11, ry: 0.165, top: 0.15 }, { p: [0, 0.62, 0.58], rx: 0.09, ry: 0.13 }, { p: [0, 0.68, 0.63], rx: 0.07, ry: 0.09 },
    ], { ring: 20, steps: 5, uvScale: 2.2 });
    this.coatMesh(neckG, this.neck, 'neck');
    // head: pivots at the poll
    this.head = new THREE.Group(); this.head.position.set(0, 0.66, 0.62); this.neck.add(this.head);
    const k = 0.86;
    const headG = loft([
      { p: [0, 0.03 * k, -0.06 * k], rx: 0.075, ry: 0.09 }, { p: [0, -0.04 * k, 0.05 * k], rx: 0.1, ry: 0.15 }, { p: [0, -0.15 * k, 0.17 * k], rx: 0.092, ry: 0.13 },
      { p: [0, -0.28 * k, 0.29 * k], rx: 0.074, ry: 0.088 }, { p: [0, -0.4 * k, 0.4 * k], rx: 0.066, ry: 0.074 }, { p: [0, -0.47 * k, 0.47 * k], rx: 0.072, ry: 0.07 },
      { p: [0, -0.505 * k, 0.505 * k], rx: 0.05, ry: 0.045 },
    ], { ring: 26, steps: 6, uvScale: 2.6 });
    this.coatMesh(headG, this.head, 'head');
    // jaw/cheek: the round jowl under the eye
    for (const sx of [1, -1]){
      const j = ellipsoid(0.035, 0.08, 0.09, 12, 8); j.rotateX(0.78); j.translate(sx * 0.052, -0.14, 0.03);
      this.coatMesh(j, this.head, 'jowl');
    }
    // eyes, nostrils, ears
    this.eyes = [];
    for (const sx of [1, -1]){
      const e = new THREE.Mesh(ellipsoid(0.022, 0.018, 0.028, 12, 8), S.eye); e.position.set(sx * 0.088, -0.07, 0.07); this.head.add(e); this.eyes.push(e);
      const lid = new THREE.Mesh(ellipsoid(0.026, 0.008, 0.032, 10, 6), S.eye); lid.position.set(sx * 0.09, -0.055, 0.07); this.head.add(lid);
      const n = new THREE.Mesh(ellipsoid(0.012, 0.022, 0.018, 8, 6), S.nostril); n.position.set(sx * 0.045, -0.39, 0.42); n.rotation.x = -0.8; this.head.add(n);
    }
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.006, 0.06), S.nostril); mouth.position.set(0, -0.44, 0.38); mouth.rotation.x = -0.78; this.head.add(mouth);
    this.ears = [];
    for (const sx of [1, -1]){
      const ear = new THREE.Group(); ear.position.set(sx * 0.05, 0.06, -0.06); this.head.add(ear);
      const g = new THREE.ConeGeometry(0.032, 0.15, 10, 1, true); g.translate(0, 0.075, 0); g.scale(1, 1, 0.6);
      const em = this.coatMesh(g, ear, 'ear'); em.material = this.earMat || (this.earMat = S.coat.clone()); em.material.side = THREE.DoubleSide;
      ear.rotation.set(-0.3, 0, sx * -0.25); this.ears.push(ear);
    }
    // legs
    this.legs = LEGS.map((L, i) => this.buildLeg(L, i));
    // mane, forelock and tail
    this.hairMat = new THREE.MeshStandardMaterial({ map: tex('hair').map, color: coat.mane, roughness: 0.6, alphaTest: 0.35, side: THREE.DoubleSide });
    this.buildMane();
    this.buildTail();
    // tack
    this.tack = {};
    this.buildTack();
    this.root.traverse((o) => { if (o.isMesh){ o.castShadow = true; o.receiveShadow = true; } });
    this.paint();
    // animation state
    this.anim = { phase: 0, gait: 'stand', blend: 0, bob: 0, pitch: 0, roll: 0, neck: 0, headPitch: 0, headYaw: 0, chew: 0, tail: 0, tailT: 0, earT: 0, blink: 0, blinkT: 2, rest: 0, restLeg: 2, lift: [0, 0, 0, 0], feet: LEGS.map((L) => V(L.x, 0, L.z)), jump: null, breathe: 0 };
  }

  coatMesh(g, parent, part){
    const m = new THREE.Mesh(g, shared().coat);
    m.userData.part = part;
    parent.add(m);
    this.parts.push(m);
    return m;
  }

  buildLeg(L, i){
    const S = shared();
    const top = new THREE.Group(); top.position.set(L.x, L.y, L.z); this.body.add(top);
    // the top of each leg starts well inside the body so there's no seam where it joins
    const ug = L.front ? limb(L.l1 + 0.16, 0.09, 0.05, { bulge: 0.12, seg: 12 }) : limb(L.l1 + 0.18, 0.1, 0.052, { bulge: 0.2, seg: 12 });
    ug.translate(0, L.front ? 0.16 : 0.18, 0);
    const upper = this.coatMesh(ug, top, 'leg');
    const joint = new THREE.Group(); joint.position.y = -L.l1; top.add(joint);
    this.coatMesh(ellipsoid(L.front ? 0.058 : 0.05, L.front ? 0.07 : 0.07, L.front ? 0.06 : 0.075, 10, 8), joint, 'leg');
    if (!L.front){ const pt = ellipsoid(0.03, 0.05, 0.04, 8, 6); pt.translate(0, 0.03, -0.065); this.coatMesh(pt, joint, 'leg'); }  // point of hock
    this.coatMesh(limb(L.l2, 0.048, 0.043, { seg: 10 }), joint, 'leg');
    const fet = new THREE.Group(); fet.position.y = -L.l2; joint.add(fet);
    this.coatMesh(ellipsoid(0.05, 0.055, 0.058, 10, 8), fet, 'leg');
    // pastern and hoof: kept roughly upright by the animation
    const foot = new THREE.Group(); fet.add(foot);
    const past = limb(0.15, 0.046, 0.05, { seg: 10 }); past.rotateX(-0.62);
    this.coatMesh(past, foot, 'pastern');
    const hoofG = new THREE.CylinderGeometry(0.05, 0.064, 0.085, 16); hoofG.translate(0, -0.1675, 0.085);
    // slant the front wall of the hoof
    const p = hoofG.attributes.position;
    for (let k = 0; k < p.count; k++){ const y = p.getY(k) + 0.1675; p.setZ(k, p.getZ(k) + (p.getZ(k) - 0.085 > 0 ? -y * 0.5 : 0)); }
    hoofG.computeVertexNormals();
    const white = this.look.socks[i] > 0;
    const hoof = new THREE.Mesh(hoofG, white ? S.hoofLight : S.hoof); foot.add(hoof);
    return { L, top, joint, fet, foot, hoof, upper };
  }

  buildMane(){
    // strands that start on the crest and drape over the right side of the neck, hugging it
    const NECK = [[-0.06, -0.12, 0.2, 0.3], [0.06, 0.12, 0.18, 0.28], [0.27, 0.32, 0.14, 0.22], [0.47, 0.47, 0.11, 0.165], [0.62, 0.58, 0.09, 0.13]];
    const at = (t) => {
      const f = t * (NECK.length - 1), i = Math.min(NECK.length - 2, Math.floor(f)), u = f - i, a = NECK[i], b = NECK[i + 1];
      const ty = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(ty, tz);
      return { y: lerp(a[0], b[0], u), z: lerp(a[1], b[1], u), rx: lerp(a[2], b[2], u), ry: lerp(a[3], b[3], u), ty: ty / l, tz: tz / l };
    };
    const R = rng(this.look.seed * 7 + 3);
    const pos = [], uv = [], idx = [];
    const n = 34, rows = 6;
    for (let k = 0; k < n; k++){
      const t = 0.16 + (k / (n - 1)) * 0.82 + (R() - 0.5) * 0.02, w = 0.07 + R() * 0.03, len = 0.2 + R() * 0.09 + (1 - t) * 0.04;
      const c = at(t), lift = 0.012 + R() * 0.01;
      const base = pos.length / 3;
      for (let j = 0; j <= rows; j++){
        const v = j / rows, d = v * len;
        for (const side of [-0.5, 0.5]){
          // along the neck by `side`, round the neck by distance d from the crest, then hanging down
          const tt = at(clamp(t + side * w / 0.75));
          const r = (tt.rx + tt.ry) / 2, ang = Math.min(Math.PI * 0.62, d / r);
          const ux = -Math.sin(ang) * (tt.rx + lift), uu = Math.cos(ang) * (tt.ry + lift);
          let y = tt.y + uu * tt.tz, z = tt.z - uu * tt.ty, x = ux;
          const rest = d - ang * r;
          if (rest > 0){ y -= rest * 0.9; x -= rest * 0.3; }
          pos.push(x, y, z); uv.push(side + 0.5, 1 - v);
        }
      }
      for (let j = 0; j < rows; j++){ const a = base + j * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    this.mane = new THREE.Mesh(g, this.hairMat);
    this.neck.add(this.mane);
    // forelock over the forehead
    const fg = new THREE.PlaneGeometry(0.1, 0.17, 1, 3); fg.translate(0, -0.085, 0);
    const fl = new THREE.Mesh(fg, this.hairMat); fl.position.set(0, 0.07, -0.02); fl.rotation.x = -0.75; this.head.add(fl);
    const fl2 = fl.clone(); fl2.rotation.y = 0.4; fl2.position.x = 0.01; this.head.add(fl2);
  }

  buildTail(){
    // the dock grows out of the top of the rump and arches back and down; the hair falls from along it
    this.tail = new THREE.Group(); this.tail.position.set(0, 1.4, -0.94); this.body.add(this.tail);
    this.tail.rotation.x = 0.1;
    const dock = limb(0.32, 0.07, 0.035, { seg: 10 }); dock.translate(0, 0.04, 0); dock.rotateX(0.55);
    this.coatMesh(dock, this.tail, 'dock');
    // hair: a fan of cards from the dock, hanging
    this.tailHair = new THREE.Group(); this.tailHair.position.set(0, 0.03, -0.02); this.tail.add(this.tailHair);
    const R = rng(this.look.seed * 13 + 1);
    for (let i = 0; i < 7; i++){
      const len = 0.85 + R() * 0.2, w = 0.05 + R() * 0.03;
      const g = new THREE.PlaneGeometry(w, len, 1, 8); g.translate(0, -len / 2, 0);
      const p = g.attributes.position;
      // starts narrow at the dock, follows its arch back, then falls straight and fans out a little
      for (let k = 0; k < p.count; k++){ const y = -p.getY(k); p.setZ(k, -Math.min(y, 0.3) * 0.6 - Math.sin(Math.min(y, 1) * 1.2) * 0.05); p.setX(k, p.getX(k) * (0.6 + y * 1.1)); }
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, this.hairMat);
      m.rotation.y = (i / 7) * Math.PI; m.rotation.z = (R() - 0.5) * 0.12; m.rotation.x = (R() - 0.5) * 0.1;
      this.tailHair.add(m);
    }
  }

  // ---------- tack: halter, saddle pad, saddle with girth and stirrups, bridle with reins ----------
  buildTack(){
    const S = shared();
    const T = this.tack;
    // halter on the head: noseband, cheek straps, crown strap (coloured nylon)
    const hm = S.halter[this.look.halter % S.halter.length];
    T.halter = new THREE.Group(); this.head.add(T.halter);
    T.halter.add(this.headRing(0.24, 0.022, hm, 0.012), this.headRing(-0.02, 0.022, hm, 0.012));
    for (const sx of [1, -1]){ const c = strap(V(sx * 0.1, -0.01, -0.02), V(sx * 0.082, -0.24 * 0.86, 0.26 * 0.86), 0.02, 0.006, hm); T.halter.add(c); }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.005, 6, 12), S.steel); ring.position.set(0, -0.31, 0.2); T.halter.add(ring);
    T.halterRing = ring;
    // saddle pad: a quilted sheet over the back, a little bigger than the saddle
    T.pad = new THREE.Group(); this.body.add(T.pad);
    T.pad.add(new THREE.Mesh(shell(-0.18, 0.5, 0.42, Math.PI - 0.42, 0.012, 0.02, { flatSides: 0.56 }), S.pad));
    // saddle: seat, raised pommel and cantle, flaps, knee rolls, stirrup leathers and irons, girth
    T.saddle = new THREE.Group(); this.body.add(T.saddle);
    const seat = shell(-0.06, 0.4, 0.62, Math.PI - 0.62, 0.035, 0.05, { lift: (u) => (u < 0.18 ? (0.18 - u) * 0.5 : 0) + (u > 0.85 ? (u - 0.85) * 0.5 : 0) - Math.sin(u * Math.PI) * 0.02 });
    T.saddle.add(new THREE.Mesh(seat, S.leather));
    T.saddle.add(new THREE.Mesh(shell(-0.04, 0.38, 0.25, 0.75, 0.04, 0.035, { flatSides: 0.5 }), S.leatherDark));
    T.saddle.add(new THREE.Mesh(shell(-0.04, 0.38, Math.PI - 0.75, Math.PI - 0.25, 0.04, 0.035, { flatSides: 0.5 }), S.leatherDark));
    T.stirrups = [];
    for (const sx of [1, -1]){
      const top = bodySurface(0.25, sx > 0 ? 0.55 : Math.PI - 0.55, 0.05);
      const lth = new THREE.Group(); lth.position.copy(top); T.saddle.add(lth);
      const leatherStrap = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.48, 0.028), S.leather); leatherStrap.position.y = -0.24; lth.add(leatherStrap);
      const iron = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.008, 6, 16, Math.PI), S.steel); iron.position.y = -0.5; iron.rotation.set(Math.PI, Math.PI / 2, 0); lth.add(iron);
      const tread = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.008, 0.04), S.steel); tread.position.y = -0.56; tread.rotation.y = Math.PI / 2; lth.add(tread);
      lth.rotation.x = 0.04;
      T.stirrups.push(lth);
    }
    // the girth: round the barrel under the belly behind the elbows
    T.girth = new THREE.Group(); this.body.add(T.girth);
    T.girth.add(new THREE.Mesh(band(0.3, -0.25, -Math.PI + 0.25, 0.018, 0.07), S.leatherDark));
    for (const sx of [1, -1]){
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.04, 0.05), S.steel); b.position.copy(bodySurface(0.3, sx > 0 ? -0.2 : -Math.PI + 0.2, 0.03)); T.girth.add(b);
    }
    // bridle: crown, browband, cheekpieces, cavesson noseband, bit, reins to the withers
    T.bridle = new THREE.Group(); this.head.add(T.bridle);
    const lm = S.leatherDark;
    T.bridle.add(this.headRing(0.0, 0.018, lm, 0.008), this.headRing(0.2, 0.026, lm, 0.01));
    const brow = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.007, 6, 16, Math.PI), lm); brow.position.set(0, 0.0, 0.0); brow.rotation.set(-0.85, 0, 0); brow.scale.set(1, 0.6, 1); T.bridle.add(brow);
    for (const sx of [1, -1]){ T.bridle.add(strap(V(sx * 0.098, 0.0, -0.03), V(sx * 0.07, -0.43 * 0.86, 0.43 * 0.86), 0.016, 0.006, lm)); }
    const bit = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.16, 8), S.steel); bit.rotation.z = Math.PI / 2; bit.position.set(0, -0.44 * 0.86, 0.42 * 0.86); T.bridle.add(bit);
    T.bitRings = [];
    for (const sx of [1, -1]){ const r = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.004, 6, 14), S.steel); r.position.set(sx * 0.08, -0.44 * 0.86, 0.42 * 0.86); r.rotation.y = Math.PI / 2; T.bridle.add(r); T.bitRings.push(r); }
    // reins: drawn each frame from the bit to wherever they're held (or resting on the neck)
    T.reins = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.004, 1), lm); this.root.add(m); return m; });
    T.reinMid = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.004, 1), lm); this.root.add(m); return m; });
    this.setTack({ halter: true });
  }
  // a strap ring round the head at a point along it (t: 0 poll .. 0.5 muzzle)
  headRing(t, w, m, thick){
    const k = 0.86, y = -t * k, z = t * k;
    const s = t < 0.05 ? { rx: 0.085, ry: 0.11 } : t < 0.15 ? { rx: 0.1, ry: 0.14 } : t < 0.3 ? { rx: 0.084, ry: 0.105 } : { rx: 0.074, ry: 0.088 };
    const g = new THREE.TorusGeometry(1, thick / 0.1, 6, 24);
    const ring = new THREE.Mesh(g, m);
    ring.scale.set(s.rx + 0.008, s.ry + 0.008, w * 8);
    ring.position.set(0, y, z); ring.rotation.x = Math.PI / 4 + 0.05;
    ring.rotation.order = 'XYZ';
    ring.rotateY(Math.PI / 2); ring.rotateY(-Math.PI / 2);
    // torus lies in XY; tilt it to cross the head
    ring.rotation.set(Math.PI / 2 - 0.78 - Math.PI / 2 + Math.PI / 2, 0, 0);
    ring.rotation.x = 0.78;
    return ring;
  }

  setTack(t){
    const T = this.tack;
    this.tackOn = { ...(this.tackOn || {}), ...t };
    const o = this.tackOn;
    T.halter.visible = !!o.halter && !o.bridle;
    T.pad.visible = !!o.pad;
    T.saddle.visible = !!o.saddle;
    T.girth.visible = !!o.saddle && !!o.girth;
    T.bridle.visible = !!o.bridle;
    for (const r of [...T.reins, ...T.reinMid]) r.visible = !!o.bridle;
  }

  // ---------- colours: coat, points, markings, then dirt on top ----------
  paint(){
    const coat = this.coat, look = this.look;
    this.root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    const v = V(), M4 = new THREE.Matrix4();
    for (const m of this.parts){
      const g = m.geometry, p = g.attributes.position, n = p.count;
      const base = new Float32Array(n * 3);
      M4.multiplyMatrices(inv, m.matrixWorld);
      const legIdx = this.legs ? this.legs.findIndex((l) => isChildOf(m, l.top)) : -1;
      for (let i = 0; i < n; i++){
        v.fromBufferAttribute(p, i).applyMatrix4(M4);       // horse space
        const c = this.colourAt(m.userData.part, v, legIdx);
        base[i * 3] = c[0]; base[i * 3 + 1] = c[1]; base[i * 3 + 2] = c[2];
      }
      m.userData.base = base;
      if (!m.userData.dirt){ m.userData.dirt = new Float32Array(n); m.userData.dust = new Float32Array(n); m.userData.hp = new Float32Array(n * 3); }
      for (let i = 0; i < n; i++){ v.fromBufferAttribute(p, i).applyMatrix4(M4); m.userData.hp[i * 3] = v.x; m.userData.hp[i * 3 + 1] = v.y; m.userData.hp[i * 3 + 2] = v.z; }
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(base), 3));
    }
    this.applyDirt();
  }
  colourAt(part, p, leg){
    const coat = this.coat, look = this.look, seed = look.seed;
    let c = coat.body.slice();
    const n = fbm(p.x * 3 + seed, p.z * 3 + p.y * 2, 3, 4);
    // a little natural shading: darker along the top line and lighter under the belly/flanks for bays
    const shade = 0.92 + n * 0.16;
    c = c.map((x) => x * shade);
    if (coat.dapple && (part === 'body' || part === 'haunch' || part === 'shoulder' || part === 'neck')){
      const d = vnoise(p.x * 14 + seed, p.z * 14 + p.y * 9, 33);
      const ring = clamp(1 - Math.abs(d - 0.55) * 7);
      c = c.map((x) => x * (0.72 + ring * 0.38));
    }
    if (coat.patches && (part === 'body' || part === 'haunch' || part === 'shoulder' || part === 'neck') && fbm(p.x * 1.6 + seed, p.z * 1.4 + p.y * 1.2, 3, 44) > 0.54) c = WHITE.slice();
    if (coat.blanket && p.z < -0.25 && p.y > 0.95 && part !== 'leg'){
      c = WHITE.slice();
      if (vnoise(p.x * 18 + seed, p.z * 18 + p.y * 10, 55) > 0.72) c = coat.points.slice();
    }
    // black points: lower legs, ear rims
    if (coat.points){
      if ((part === 'leg' || part === 'pastern') && p.y < 0.62) c = coat.points.slice().map((x) => x * (0.9 + n * 0.2));
      else if ((part === 'leg') && p.y < 0.8) c = c.map((x, i) => lerp(x, coat.points[i], (0.8 - p.y) / 0.18));
      if (part === 'ear' && p.y > 2.05) c = coat.points.slice();
    }
    // greys have dark muzzles; everyone has a soft dark muzzle
    if (part === 'head'){
      const muz = clamp((-(p.y - 1.75)) * 6);
      c = c.map((x, i) => lerp(x, SKIN[i] * 1.1, muz * 0.85));
    }
    // socks and stockings
    if ((part === 'leg' || part === 'pastern') && leg >= 0){
      const h = [0, 0.18, 0.32, 0.5][look.socks[leg] || 0];
      if (h && p.y < h + vnoise(p.x * 30, p.z * 30, leg) * 0.05) c = WHITE.slice();
    }
    // face markings: star, stripe, blaze (on the front of the head)
    if (part === 'head' && look.face !== 'none'){
      // head space: front of the face is where the surface normal points forward/up; approximate by x ~ 0 and high on the face
      const along = (p.z - 0.9) ;   // grows toward the muzzle
      const w = { star: 0.035, stripe: 0.022, blaze: 0.05, snip: 0.03 }[look.face] || 0;
      const onFace = Math.abs(p.x) < w + vnoise(p.y * 30, p.z * 30, 7) * 0.012;
      const len = { star: [1.92, 2.04], stripe: [1.6, 2.02], blaze: [1.48, 2.04], snip: [1.48, 1.58] }[look.face];
      if (onFace && len && p.y > len[0] && p.y < len[1] && along > 0.95 - 0.9 - 10) {
        // only on the forward-facing side of the head (front half)
        if (this.faceFront(p)) c = (look.face === 'snip' ? PINK : WHITE).slice();
      }
    }
    return c;
  }
  faceFront(p){
    // the face's front plane runs from the forehead (y 2.1, z 1.18) to the muzzle (y 1.47, z 1.6)
    const t = clamp((2.1 - p.y) / 0.63), zf = lerp(1.15, 1.58, t);
    return p.z > zf - 0.03;
  }

  // mix the coat with mud (caked) and dust (loosened) per vertex
  applyDirt(){
    for (const m of this.parts){
      const { base, dirt, dust } = m.userData, col = m.geometry.attributes.color, a = col.array;
      for (let i = 0; i < dirt.length; i++){
        const d = clamp(dirt[i] * 1.25), s = clamp(dust[i] * 1.2) * (1 - d);
        for (let k = 0; k < 3; k++) a[i * 3 + k] = base[i * 3 + k] * (1 - d - s * 0.8) + MUD[k] * d + DUST[k] * s * 0.8;
      }
      col.needsUpdate = true;
    }
  }
  // splash mud on: amount 0..1, where = 'legs' | 'all' | 'roll'
  addDirt(amount, where = 'all', seed = Math.random() * 100){
    for (const m of this.parts){
      const { dirt, hp } = m.userData;
      for (let i = 0; i < dirt.length; i++){
        const y = hp[i * 3 + 1], x = hp[i * 3], z = hp[i * 3 + 2];
        let w = where === 'legs' ? clamp((0.75 - y) * 2.5) : where === 'roll' ? (y > 0.9 ? 0.6 + 0.6 * Math.abs(x) * 3 : 0.4) : 0.35 + clamp((0.8 - y) * 1.5) * 0.65;
        const patch = clamp((fbm(x * 4 + seed, z * 4 + y * 3, 3, 7) - 0.38) * 3.2);
        dirt[i] = clamp(dirt[i] + amount * w * patch);
      }
    }
    this.applyDirt();
  }
  // How much coat is still dirty (0 clean .. 1 filthy)
  dirtiness(){
    let s = 0, n = 0;
    for (const m of this.parts){ const { dirt, dust } = m.userData; for (let i = 0; i < dirt.length; i += 3){ s += Math.min(1, dirt[i] + dust[i] * 0.6); n++; } }
    return n ? s / n : 0;
  }
  // Groom at a world point: curry comb loosens mud into dust, brushes lift the dust. Returns how much was done.
  groom(world, tool, strength, radius = 0.13){
    let done = 0, caked = 0;
    const lp = V();
    for (const m of this.parts){
      if (!m.visible) continue;
      lp.copy(world); m.worldToLocal(lp);
      const g = m.geometry; g.boundingSphere || g.computeBoundingSphere();
      const s = m.getWorldScale(V()).x || 1, r = radius / s;
      if (g.boundingSphere.center.distanceTo(lp) > g.boundingSphere.radius + r) continue;
      const p = g.attributes.position, { dirt, dust } = m.userData;
      for (let i = 0; i < p.count; i++){
        const dx = p.getX(i) - lp.x, dy = p.getY(i) - lp.y, dz = p.getZ(i) - lp.z, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > r * r) continue;
        const w = (1 - Math.sqrt(d2) / r) * strength;
        if (tool === 'curry'){ const t = Math.min(dirt[i], w * 1.6); dirt[i] -= t; dust[i] = Math.min(1, dust[i] + t * 0.9); done += t; }
        else if (tool === 'brush'){ const t = Math.min(dust[i], w * 1.8); dust[i] -= t; const t2 = Math.min(dirt[i], w * 0.25); dirt[i] -= t2; done += t + t2; caked += dirt[i]; }
        else if (tool === 'sponge'){ const t = Math.min(dirt[i] + dust[i], w); dirt[i] = Math.max(0, dirt[i] - w * 0.6); dust[i] = Math.max(0, dust[i] - w); done += t; }
      }
    }
    if (done > 0) this.applyDirt();
    this.caked = caked;      // mud the brush couldn't shift (it needs the curry comb)
    return done;
  }
  // closest distance from a world point to the coat (approximate, using vertices)
  surfaceDistance(world){
    let best = 9;
    const lp = V();
    for (const m of this.parts){
      lp.copy(world); m.worldToLocal(lp);
      const g = m.geometry; if (!g.boundingSphere) g.computeBoundingSphere();
      const s = m.getWorldScale(V()).x || 1;
      const dc = g.boundingSphere.center.distanceTo(lp) - g.boundingSphere.radius;
      if (dc * s > best) continue;
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i += 2){
        const dx = p.getX(i) - lp.x, dy = p.getY(i) - lp.y, dz = p.getZ(i) - lp.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz) * s;
        if (d < best) best = d;
      }
    }
    return best;
  }

  // ---------- animation ----------
  // st: { speed (m/s forward), turn (rad/s), neck (0 up .. 1 grazing), headYaw, chewing, alert, dt, rest (dozing), jump }
  animate(dt, st){
    const A = this.anim;
    const v = Math.max(0, st.speed) / this.scale;    // stride is in model units
    const gait = gaitFor(v * this.scale, A.gait);
    if (gait !== A.gait){ A.gait = gait; A.blend = 0.25; this.onGait && this.onGait(gait); }
    A.blend = Math.max(0, A.blend - dt);
    const G = GAITS[gait === 'stand' ? 'walk' : gait];
    const f = gait === 'stand' ? 0 : G.freq(v * this.scale);
    const prev = A.phase;
    A.phase = (A.phase + f * dt) % 1;
    const stride = f > 0 ? v * G.duty / f : 0;
    // hoof beats: tell the game when a hoof lands
    if (f > 0) for (let i = 0; i < 4; i++){
      const a = (prev + G.off[i]) % 1, b = (A.phase + G.off[i]) % 1;
      if (b < a || (a < 1e-9 && b > 0 && prev === 0)) this.onStep && this.onStep(i, gait);
    }
    // jumping overrides everything
    let jumpY = 0, jumpPitch = 0, tuckF = 0, tuckH = 0;
    if (A.jump){
      const J = A.jump; J.t += dt;
      const u = clamp(J.t / J.dur);
      jumpY = Math.sin(u * Math.PI) * J.h;
      jumpPitch = -Math.sin(u * Math.PI * 2) * 0.32 * Math.min(1, J.h / 0.8 + 0.3);
      tuckF = clamp(Math.sin(clamp(u * 1.25) * Math.PI) * 1.2);
      tuckH = clamp(Math.sin(clamp((u - 0.18) * 1.3) * Math.PI) * 1.2);
      if (u >= 1){ A.jump = null; this.onLand && this.onLand(); }
    }
    // body bounce and rock
    const bobPh = A.phase * Math.PI * 2 * G.bobN;
    const amp = gait === 'stand' ? 0 : 1;
    const targetBob = amp * (gait === 'trot' ? -Math.abs(Math.cos(bobPh / 2 * 2)) * G.bob * 2 + G.bob : Math.sin(bobPh) * G.bob);
    A.bob = damp(A.bob, targetBob, 30, dt);
    A.pitch = damp(A.pitch, amp * Math.sin(A.phase * Math.PI * 2 + 0.6) * G.pitch, 20, dt);
    A.roll = damp(A.roll, clamp(-(st.turn || 0) * v * 0.04, -0.15, 0.15), 6, dt);
    A.breathe += dt * (gait === 'stand' ? 1.6 : 3 + v * 0.4);
    // lying a little lower when resting a hind leg
    A.rest = damp(A.rest, st.rest ? 1 : 0, 2, dt);
    this.body.position.y = A.bob + jumpY - A.rest * 0.02;
    this.body.rotation.set(A.pitch + jumpPitch, 0, A.roll);
    this.trunk.scale.set(1 + Math.sin(A.breathe) * 0.008, 1 + Math.sin(A.breathe) * 0.006, 1);
    // legs: hooves follow the gait; IK puts the joints in place
    for (let i = 0; i < 4; i++){
      const leg = this.legs[i], L = leg.L, foot = A.feet[i];
      let tz = L.z, ty = 0, lift = 0;
      if (f > 0){
        const p = (A.phase + G.off[i]) % 1;
        if (p < G.duty){ const s = p / G.duty; tz += stride * (0.5 - s); }
        else { const s = (p - G.duty) / (1 - G.duty); tz += stride * (-0.5 + smooth(s)); lift = Math.sin(Math.PI * s); ty = lift * G.lift * (L.front ? 1.15 : 0.9) * Math.min(1, 0.4 + v * 0.25); }
      } else if (!L.front && A.rest > 0.01 && i === A.restLeg){
        // a dozing horse cocks one hind leg: hoof tipped up, forward a little
        tz += 0.08 * A.rest; ty = 0.05 * A.rest; lift = 0.5 * A.rest;
      }
      if (A.lift[i] > 0){ ty = Math.max(ty, 0.32 * A.lift[i]); tz += (L.front ? -0.18 : 0.12) * A.lift[i]; lift = Math.max(lift, A.lift[i]); }
      // tucked legs over a jump
      if (L.front && tuckF > 0){ ty = lerp(ty, 0.62, tuckF); tz = lerp(tz, L.z - 0.05, tuckF); lift = Math.max(lift, tuckF); }
      if (!L.front && tuckH > 0){ ty = lerp(ty, 0.5, tuckH); tz = lerp(tz, L.z + 0.1, tuckH); lift = Math.max(lift, tuckH * 0.6); }
      // smooth over gait changes
      const k = A.blend > 0 ? 18 : 60;
      foot.z = damp(foot.z, tz, k, dt); foot.y = damp(foot.y, ty, k, dt);
      // the body moves (bob, pitch) but the hooves stay where they are: undo that for the IK target
      const pitch = this.body.rotation.x, by = this.body.position.y;
      // hoof in body space
      const wy = foot.y - by, wz = foot.z;
      const cy = Math.cos(-pitch), sy = Math.sin(-pitch);
      const hy = wy * cy - wz * sy, hz = wy * sy + wz * cy;
      // fetlock target: above the hoof by the foot height
      const ry = hy + L.foot - L.y, rz = hz - L.z;
      const sol = ik2(ry, rz, L.l1, L.l2, L.bend);
      leg.top.rotation.x = -sol.upper;
      leg.joint.rotation.x = -sol.lower;
      // keep the pastern near upright, folding back as the hoof lifts
      const fold = lift * (L.front ? 1.2 : 0.8);
      leg.foot.rotation.x = sol.upper + sol.lower + pitch + fold;
      if (L.front && tuckF > 0) leg.foot.rotation.x += tuckF * 0.8;
    }
    // neck and head: grazing lowers the neck, the head stays roughly level otherwise
    A.neck = damp(A.neck, st.neck || 0, 2.5, dt);
    const nod = gait === 'stand' ? 0 : Math.sin(A.phase * Math.PI * 2 * (gait === 'walk' ? 2 : 1)) * G.nod;
    this.neck.rotation.x = A.neck * 1.05 + nod * 0.6 - (A.jump ? -jumpPitch * 0.5 : 0) + (st.alert ? -0.12 : 0) - (gait === 'gallop' ? -0.2 : 0);
    A.headYaw = damp(A.headYaw, st.headYaw || 0, 3, dt);
    this.neck.rotation.y = A.headYaw * 0.55;
    this.head.rotation.set(A.neck * 0.35 + nod * 0.4 + (st.headPitch || 0), A.headYaw * 0.45, 0);
    // chewing
    A.chew += dt * (st.chewing ? 9 : 0);
    this.head.position.y = 0.66 + (st.chewing ? Math.sin(A.chew) * 0.004 : 0);
    // ears: forward when alert, flick now and then, back when moving fast
    A.earT -= dt;
    if (A.earT < 0){ A.earT = 1 + Math.random() * 4; A.earFlick = Math.floor(Math.random() * 3); }
    for (let i = 0; i < 2; i++){
      const flick = A.earFlick === i && A.earT > A.earT - 0.3 && Math.random() < 0.02 ? 0.6 : 0;
      const back = gait === 'gallop' ? 0.5 : 0;
      const target = (st.alert ? -0.55 : -0.3) + back + flick + (st.rest ? 0.4 : 0);
      this.ears[i].rotation.x = damp(this.ears[i].rotation.x, target, 8, dt);
      this.ears[i].rotation.y = damp(this.ears[i].rotation.y, (i ? 1 : -1) * (st.rest ? 0.6 : 0.15) + (st.headYaw || 0) * 0.2, 4, dt);
    }
    // blinking
    A.blinkT -= dt; if (A.blinkT < 0){ A.blinkT = 2 + Math.random() * 5; A.blink = 0.15; }
    A.blink = Math.max(0, A.blink - dt);
    const eyeOpen = A.blink > 0 ? 0.15 : st.rest ? 0.45 : 1;
    for (const e of this.eyes) e.scale.y = damp(e.scale.y, eyeOpen, 30, dt);
    // tail: hangs and sways with the gait, swishes at flies, lifts when galloping
    A.tailT -= dt;
    if (A.tailT < 0){ A.tailT = 1.5 + Math.random() * 5; A.tailSwish = 0.6; A.tailDir = Math.random() < 0.5 ? -1 : 1; }
    A.tailSwish = Math.max(0, (A.tailSwish || 0) - dt);
    const sw = A.tailSwish > 0 ? Math.sin(A.tailSwish * 10) * 0.5 * A.tailDir : 0;
    this.tail.rotation.z = damp(this.tail.rotation.z, sw + Math.sin(A.phase * Math.PI * 2) * 0.06 * amp, 10, dt);
    this.tail.rotation.x = damp(this.tail.rotation.x, 0.1 + (gait === 'gallop' || gait === 'canter' ? 0.45 : gait === 'trot' ? 0.2 : 0) + (A.jump ? 0.35 : 0), 5, dt);
    this.tailHair.rotation.x = damp(this.tailHair.rotation.x, (gait === 'gallop' || gait === 'canter') ? 0.5 : 0, 4, dt);
    // mane flutters a little at speed
    this.mane.rotation.z = damp(this.mane.rotation.z, Math.min(0.25, v * 0.025) * Math.sin(A.breathe * 3), 10, dt);
  }
  jump(h, dur){ this.anim.jump = { t: 0, h, dur }; }
  get jumping(){ return !!this.anim.jump; }

  // reins from the bit rings to the hands (or resting on the neck at the withers)
  updateReins(hands){
    const T = this.tack; if (!T.bridle.visible) return;
    this.root.updateMatrixWorld(true);
    for (let i = 0; i < 2; i++){
      const a = T.bitRings[i].getWorldPosition(V());
      const b = hands && hands[i] ? hands[i].clone() : this.body.localToWorld(bodySurface(0.5, i === 0 ? 1.2 : Math.PI - 1.2, 0.02));
      const mid = a.clone().lerp(b, 0.5); mid.y -= hands ? 0.04 : 0.12;
      placeBetween(T.reins[i], a, mid, this.root);
      placeBetween(T.reinMid[i], mid, b, this.root);
    }
  }
  // world positions for interactions
  muzzle(out = V()){ return this.head.localToWorld(out.set(0, -0.45, 0.45)); }
  poll(out = V()){ return this.head.localToWorld(out.set(0, 0.05, -0.02)); }
  saddlePoint(out = V()){ return this.body.localToWorld(out.set(0, 1.68, 0.18)); }
  hoof(i, out = V()){ return this.legs[i].foot.localToWorld(out.set(0, -0.16, 0.08)); }
}

function isChildOf(o, p){ while (o){ if (o === p) return true; o = o.parent; } return false; }
// stretch a unit-length box between two world points (as a child of root)
function placeBetween(mesh, a, b, root){
  const la = root.worldToLocal(a.clone()), lb = root.worldToLocal(b.clone());
  mesh.position.copy(la).add(lb).multiplyScalar(0.5);
  mesh.scale.set(1, 1, Math.max(0.001, la.distanceTo(lb)));
  mesh.lookAt(root.localToWorld(lb.clone()));
}
// A strap as a thin box between two points
function strap(a, b, w, t, m){
  const g = new THREE.BoxGeometry(t, w, a.distanceTo(b)); const s = new THREE.Mesh(g, m);
  s.position.copy(a).add(b).multiplyScalar(0.5); s.lookAt(b); s.lookAt(s.position.clone().add(b.clone().sub(a)));
  return s;
}
// A curved sheet over the horse's back from z0 to z1 and angle a0 to a1 (pi/2 = top), off the coat by `off`.
function shell(z0, z1, a0, a1, off, thick, { lift, flatSides = 0 } = {}){
  const nz = 14, na = 18, pos = [], uv = [], idx = [];
  for (let side = 0; side < 2; side++){
    for (let j = 0; j <= nz; j++){
      const u = j / nz, z = lerp(z0, z1, u);
      for (let i = 0; i <= na; i++){
        const a = lerp(a0, a1, i / na);
        const p = bodySurface(z, a, off + (side ? thick : 0));
        if (lift) p.y += lift(u);
        // the sides hang straighter (a pad drapes)
        if (flatSides && Math.sin(a) < flatSides){ const k = (flatSides - Math.sin(a)) / flatSides; p.x *= 1 - k * 0.04; }
        pos.push(p.x, p.y, p.z); uv.push(i / na * 2, u * 2);
      }
    }
  }
  const R = na + 1, half = (nz + 1) * R;
  for (let j = 0; j < nz; j++) for (let i = 0; i < na; i++){
    const a = j * R + i, b = a + 1, c = a + R, d = c + 1;
    idx.push(a + half, b + half, c + half, b + half, d + half, c + half);   // outer
    idx.push(a, c, b, b, c, d);                                           // inner
  }
  // edges
  for (let j = 0; j < nz; j++){ for (const i of [0, na]){ const a = j * R + i, c = a + R; if (i === 0) idx.push(a, a + half, c, c, a + half, c + half); else idx.push(a, c, a + half, c, c + half, a + half); } }
  for (let i = 0; i < na; i++){ for (const j of [0, nz]){ const a = j * R + i, b = a + 1; if (j === 0) idx.push(a, b, a + half, b, b + half, a + half); else idx.push(a, a + half, b, b, a + half, b + half); } }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
// a band round the barrel at z, from angle a0 to a1 (going under the belly)
function band(z, a0, a1, off, w){
  const n = 24, pos = [], idx = [];
  for (let i = 0; i <= n; i++){
    const a = lerp(a0, a1, i / n);
    for (const dz of [-w / 2, w / 2]){ const p = bodySurface(z + dz, a, off); pos.push(p.x, p.y, p.z); }
  }
  for (let i = 0; i < n; i++){ const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3, a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
