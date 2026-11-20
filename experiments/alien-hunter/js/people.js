// The townsfolk: realistic, rigged, animated people (Microsoft's Rocketbox avatars, MIT licence, the
// same 18 as MSB: each converted by _tools/msb/rocketbox.mjs into a .glb with walk, idle, nod and
// head-shake animations). Every person in a town is a different one of them, and each walks in their
// own way (a style laid over the shared animation: lean, arm swing, bounce, sway...).
//
// What's inside them: a skeleton (a real person) or a green alien (an alien in disguise), built from a
// few shared shapes placed every frame between the avatar's own joints (shoulder to elbow, hip to
// knee...), so the insides walk, flinch and fall exactly as the body does. All the insides of all the
// people are drawn as a handful of instanced meshes, in three sets:
//  - X: for the X-ray (its own layer, INNER, which only the X-ray camera looks at; glowing);
//  - F: shown in the normal view while someone is being zapped (the cartoon electrocution flash);
//  - D: dead aliens, lying in the street (normal view and X-ray; lit like everything else).
// People wander the walking graph (sidewalks, park paths, into houses and shops and round the rooms),
// chat now and then; a revealed alien runs from you.
import * as THREE from 'three';
import { GLTFLoader } from '/experiments/alien-hunter/lib/addons/GLTFLoader.js';
import { clone as cloneSkinned } from '/experiments/alien-hunter/lib/addons/SkeletonUtils.js';
import { V, clamp, damp, angleDiff, ellipsoid, mergeGeometries, paint, placed, textCanvas, roundRect, rng } from './util.js';

export const INNER = 6;

const BASE = '/experiments/alien-hunter/models/';
const FEMALE = ['Sue', 'Ann', 'Meg', 'Liz', 'Kim', 'Amy', 'Eve', 'Ivy', 'Zoe', 'Fay', 'Dot', 'Mae', 'Bea', 'Joy', 'Pam', 'Rose'];
const MALE = ['Bob', 'Pat', 'Tom', 'Joe', 'Sam', 'Dan', 'Ray', 'Max', 'Ted', 'Gus', 'Ned', 'Hal', 'Lou', 'Ben', 'Jim', 'Al'];
const HUMAN_LINES = ['Lovely day!', 'Have you seen my cat?', 'Hello there!', 'I need more milk.', 'Nice weather today.', 'Off to the shops!', 'My feet hurt.', 'Hi, neighbour!', 'What a nice town.', 'Is it lunch yet?', 'I love this street.', 'Busy busy busy!'];
const ALIEN_LINES = ['Greetings, fellow human.', 'I too enjoy breathing air.', 'My skin is normal skin.', 'Take me to your... bakery.', 'Beep. I mean, hello!', 'Nice weather for Earthlings.', 'I have one normal head.', 'Hello! I am a human person.', 'Mmm, delicious Earth food.'];
const BONE = '#e8f4ff', SOCKET = '#0a0e1a', GREEN = '#5ad83a', GREEN2 = '#a8f07a', DGREEN = '#2a8a2a';

// ---------- loading the people ----------
export async function loadPeople(){
  const v = document.body.dataset.version || '0', L = new GLTFLoader();
  const list = await fetch(BASE + 'people/list.json?v=' + v).then((r) => { if (!r.ok) throw new Error('people list'); return r.json(); });
  const gltfs = await Promise.all(list.map((P) => L.loadAsync(BASE + 'people/' + P.id + '.glb?v=' + v)));
  return gltfs.map((g, i) => ({ scene: g.scene, clips: Object.fromEntries(g.animations.map((c) => [c.name, c])), height: list[i].height, female: list[i].female, id: list[i].id }));
}

// ---------- everyone walks a little differently (from MSB) ----------
function makeStyle(R){
  const r = (a, b) => a + R() * (b - a);
  return { lean: r(-0.05, 0.14), headDown: r(-0.06, 0.12), headSide: r(-0.07, 0.07), swing: r(0.55, 1.3), elbow: r(0, 0.35), armOut: r(0, 0.13),
    turnout: r(-0.02, 0.2), sway: r(0, 0.07), bounce: r(0, 0.035), shoulders: r(-0.06, 0.08), idleRate: r(0.25, 0.6), idleShift: r(0.01, 0.045) };
}
const _q = new THREE.Quaternion(), _p = new THREE.Quaternion(), _pi = new THREE.Quaternion(), _a = V(), _rootQ = new THREE.Quaternion();
const AX = { right: V(1, 0, 0), up: V(0, 1, 0), fwd: V(0, 0, 1) };
// turn a bone by an angle about one of the person's own axes
function turn(b, axis, angle){
  if (!b || !angle) return;
  _a.copy(AX[axis]).applyQuaternion(_rootQ);
  b.parent.getWorldQuaternion(_p);
  _q.setFromAxisAngle(_a, angle);
  _q.premultiply(_pi.copy(_p).invert()).multiply(_p);
  b.quaternion.premultiply(_q);
}
function applyStyle(P, S, walkW, t, lean){
  const B = P.bones, w = walkW, st = 1 - walkW;
  P.model.updateMatrixWorld(true);
  P.model.parent.getWorldQuaternion(_rootQ);
  const walk = P.act.walk, ph = (walk.time / walk.getClip().duration) * Math.PI * 2;
  for (const s of ['L', 'R']){
    const ua = B[s + '_UpperArm']; if (!ua) continue;
    const k = 1 + (S.swing - 1) * w;
    ua.userData.anim = (ua.userData.anim || new THREE.Quaternion()).copy(ua.quaternion);
    ua.quaternion.slerpQuaternions(P.rest[s + '_UpperArm'], ua.userData.anim, Math.min(1.35, k));
  }
  P.model.updateMatrixWorld(true);
  const sign = { L: 1, R: -1 };
  turn(B.Spine1, 'right', S.lean * (0.6 + 0.4 * w) + lean);
  turn(B.Pelvis, 'fwd', Math.sin(ph) * S.sway * w + Math.sin(t * S.idleRate) * S.idleShift * st);
  for (const s of ['L', 'R']){
    turn(B[s + '_Clavicle'], 'fwd', sign[s] * S.shoulders);
    turn(B[s + '_UpperArm'], 'fwd', sign[s] * S.armOut);
    turn(B[s + '_Forearm'], 'right', -S.elbow * (0.4 + 0.6 * w));
    turn(B[s + '_Thigh'], 'up', sign[s] * S.turnout);
  }
  turn(B.Head, 'right', S.headDown); turn(B.Head, 'fwd', S.headSide);
  return Math.abs(Math.sin(ph)) * S.bounce * w;
}

// ---------- the insides: shared shapes ----------
const keep = (g) => { g.userData.keep = true; return g; };
const P_ = (g, c, ...a) => paint(placed(g, ...a), c);
const merge = (parts) => keep(mergeGeometries(parts));
let SH = null;
function shapes(){
  if (SH) return SH;
  // (frames: +y up, +z forward, origin as noted; segments run along +y from 0 to 1)
  const skull = [P_(ellipsoid(0.085, 0.1, 0.1, 16, 12), BONE, 0, 0.01, 0), P_(ellipsoid(0.06, 0.035, 0.06, 12, 8), BONE, 0, -0.085, 0.035),
    P_(new THREE.SphereGeometry(0.026, 10, 8), SOCKET, -0.033, 0.01, 0.082), P_(new THREE.SphereGeometry(0.026, 10, 8), SOCKET, 0.033, 0.01, 0.082),
    P_(new THREE.SphereGeometry(0.012, 6, 4), SOCKET, 0, -0.03, 0.095)];
  for (let i = -2; i <= 2; i++) skull.push(P_(new THREE.BoxGeometry(0.012, 0.016, 0.01), '#ffffff', i * 0.014, -0.06, 0.088));
  const rib = [];   // origin: the top of the chest (Spine2)
  for (const [y, r] of [[0.1, 0.1], [0.06, 0.12], [0.015, 0.13], [-0.03, 0.13], [-0.075, 0.12], [-0.115, 0.105]])
    rib.push(P_(new THREE.TorusGeometry(r, 0.011, 5, 20, Math.PI * 1.55).rotateX(Math.PI / 2).rotateY(Math.PI / 2 + Math.PI * 0.225), BONE, 0, y, 0.015, 0, 0, 0, 1, 1, 0.72));
  rib.push(P_(new THREE.BoxGeometry(0.03, 0.17, 0.015), BONE, 0, 0.0, 0.105));
  rib.push(P_(new THREE.SphereGeometry(0.04, 10, 8), '#ff3050', 0.03, -0.03, 0.04));
  const pelvis = [P_(ellipsoid(0.14, 0.07, 0.08, 14, 8), BONE, 0, 0.02, 0), P_(new THREE.SphereGeometry(0.04, 8, 6), SOCKET, 0, 0.02, 0.06)];
  const spine = []; for (let i = 0; i < 12; i++) spine.push(P_(new THREE.BoxGeometry(0.04, 0.05, 0.035), BONE, 0, (i + 0.5) / 12, -0.03));
  const shaft = [P_(new THREE.CylinderGeometry(1, 1, 1, 8).translate(0, 0.5, 0), BONE)];
  const joint = [P_(new THREE.SphereGeometry(1, 10, 8), BONE)];
  const hand = [P_(ellipsoid(0.035, 0.3, 0.015, 8, 6), BONE, 0, 0.3, 0)];
  for (const x of [-0.03, -0.01, 0.01, 0.03]) hand.push(P_(new THREE.CylinderGeometry(0.007, 0.007, 0.5, 5), BONE, x, 0.75, 0));
  const foot = [P_(new THREE.BoxGeometry(0.06, 1, 0.03), BONE, 0, 0.5, 0)];
  // the alien
  const aHead = [P_(ellipsoid(0.09, 0.1, 0.085, 16, 12), GREEN, 0, 0, 0), P_(new THREE.SphereGeometry(0.085, 14, 10), GREEN, 0, 0.06, -0.015),
    P_(ellipsoid(0.03, 0.045, 0.02, 10, 8), '#050508', -0.04, 0.005, 0.07, 0, 0, -0.45), P_(ellipsoid(0.03, 0.045, 0.02, 10, 8), '#050508', 0.04, 0.005, 0.07, 0, 0, 0.45),
    P_(new THREE.SphereGeometry(0.009, 6, 4), '#ffffff', -0.033, 0.022, 0.086), P_(new THREE.SphereGeometry(0.009, 6, 4), '#ffffff', 0.047, 0.022, 0.086),
    P_(ellipsoid(0.018, 0.006, 0.006, 8, 4), DGREEN, 0, -0.055, 0.078),
    P_(new THREE.CylinderGeometry(0.006, 0.006, 0.13, 6), GREEN, -0.055, 0.17, 0, 0, 0, 0.45), P_(new THREE.CylinderGeometry(0.006, 0.006, 0.13, 6), GREEN, 0.055, 0.17, 0, 0, 0, -0.45),
    P_(new THREE.SphereGeometry(0.02, 8, 6), '#ff5ad8', -0.085, 0.225, 0), P_(new THREE.SphereGeometry(0.02, 8, 6), '#ff5ad8', 0.085, 0.225, 0)];
  const aBody = [P_(ellipsoid(0.13, 0.27, 0.095, 16, 12), GREEN, 0, 0, 0), P_(ellipsoid(0.085, 0.16, 0.06, 12, 8), GREEN2, 0, -0.04, 0.045)];
  for (const [x, y] of [[-0.04, 0.06], [0.045, 0.0], [-0.02, -0.09]]) aBody.push(P_(new THREE.SphereGeometry(0.018, 8, 6), '#f0ff6a', x, y, 0.1));
  const aLimb = [P_(new THREE.CylinderGeometry(0.7, 1, 1, 8).translate(0, 0.5, 0), GREEN)];
  const aHand = [P_(new THREE.SphereGeometry(0.035, 8, 6), GREEN2, 0, 0, 0)];
  for (const a of [-0.5, 0, 0.5]) aHand.push(P_(new THREE.CylinderGeometry(0.006, 0.01, 0.08, 5), GREEN2, Math.sin(a) * 0.04, -0.06, 0, 0, 0, a));
  const aFoot = [P_(ellipsoid(0.045, 0.03, 0.09, 10, 6), DGREEN, 0, 0, 0.04)];
  const xe = [];
  for (const sx of [-1, 1]) for (const a of [-1, 1]) xe.push(P_(new THREE.BoxGeometry(0.06, 0.012, 0.008), '#ffffff', sx * 0.04, 0.005, 0.09, 0, 0, a * Math.PI / 4));
  SH = { skull: merge(skull), rib: merge(rib), pelvis: merge(pelvis), spine: merge(spine), shaft: merge(shaft), joint: merge(joint), hand: merge(hand), foot: merge(foot),
    aHead: merge(aHead), aBody: merge(aBody), aLimb: merge(aLimb), aHand: merge(aHand), aFoot: merge(aFoot), xeyes: merge(xe),
    goo: keep(new THREE.CircleGeometry(0.6, 24).rotateX(-Math.PI / 2).scale(1, 1, 1.5)), blob: keep(new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2)) };
  return SH;
}
const PER = { skull: 1, rib: 1, pelvis: 1, spine: 1, shaft: 10, joint: 12, hand: 2, foot: 2, aHead: 1, aBody: 1, aLimb: 9, aHand: 2, aFoot: 2, xeyes: 1 };
// one set of instanced meshes (every shape), filled afresh each frame it's needed
class InnerSet {
  constructor(parent, material, layers, cap){
    this.m = {};
    for (const [k, n] of Object.entries(PER)){
      const im = new THREE.InstancedMesh(shapes()[k], material, n * cap);
      im.frustumCulled = false; im.count = 0; im.visible = false;
      im.layers.disableAll(); for (const l of layers) im.layers.enable(l);
      parent.add(im); this.m[k] = im;
    }
    this.n = {};
  }
  begin(){ for (const k in this.m) this.n[k] = 0; }
  put(k, mat){ const im = this.m[k], i = this.n[k]++; im.setMatrixAt(i, mat); }
  end(){ for (const k in this.m){ const im = this.m[k]; im.count = this.n[k]; im.visible = im.count > 0; if (im.count) im.instanceMatrix.needsUpdate = true; } }
  set castShadow(v){ for (const k in this.m) this.m[k].castShadow = v; }
}
export const materials = {
  get vc(){ return mats.vc || (mats.vc = Object.assign(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }), { name: 'vc' })); },
  get glow(){ return mats.glow || (mats.glow = Object.assign(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), { name: 'xray-inner' })); },
  get goo(){ return mats.goo || (mats.goo = new THREE.MeshStandardMaterial({ color: '#6ae83a', roughness: 0.15, emissive: '#143a08' })); },
  get blob(){
    if (mats.blob) return mats.blob;
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 3, 32, 32, 31); gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return (mats.blob = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, toneMapped: false }));
  },
};
const mats = {};

// ---------- placing the insides between the joints ----------
const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), S3 = V(), X = V(), Y = V(), Z = V(), T1 = V(), T2 = V(), T3 = V();
const W = { eyes: V(), hUp: V(), hFwd: V(), at: V(), d: V() };
function basis(up, fwd){
  Y.copy(up).normalize();
  Z.copy(fwd).addScaledVector(Y, -fwd.dot(Y));
  if (Z.lengthSq() < 1e-6){ Z.set(1, 0, 0).addScaledVector(Y, -Y.x); }
  Z.normalize(); X.crossVectors(Y, Z);
  M4.makeBasis(X, Y, Z); Q.setFromRotationMatrix(M4);
  return Q;
}
function frame(set, k, origin, up, fwd, s){ set.put(k, M4.compose(origin, basis(up, fwd), S3.set(s, s, s))); }
function seg(set, k, a, b, r, fwd){
  const d = T3.copy(b).sub(a), len = d.length(); if (len < 1e-4) return;
  set.put(k, M4.compose(a, basis(d, fwd), S3.set(r, len, r)));
}
const JOINTS = ['Pelvis', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LEye', 'REye', 'L_Clavicle', 'L_UpperArm', 'L_Forearm', 'L_Hand', 'L_Finger21', 'R_Clavicle', 'R_UpperArm', 'R_Forearm', 'R_Hand', 'R_Finger21', 'L_Thigh', 'L_Calf', 'L_Foot', 'L_Toe0', 'R_Thigh', 'R_Calf', 'R_Foot', 'R_Toe0'];

// ---------- a person ----------
class Person {
  constructor(kind, id, R){
    this.kind = kind; this.id = id; this.female = kind.female;
    this.root = new THREE.Group(); this.root.userData.person = this;
    this.fall = new THREE.Group(); this.root.add(this.fall);
    this.height = kind.height * (0.95 + R() * 0.08);
    const model = cloneSkinned(kind.scene), bones = {};
    model.traverse((o) => {
      if (o.isMesh){ o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
      if (o.isBone) bones[o.name.replace(/^Bip01_?/, '')] = o;
    });
    const rest = {}; for (const [k, b] of Object.entries(bones)) rest[k] = b.quaternion.clone();
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model), s = this.height / Math.max(0.5, box.max.y - box.min.y);
    model.scale.multiplyScalar(s); model.position.y = -box.min.y * s;
    const mixer = new THREE.AnimationMixer(model), act = {};
    for (const [n, c] of Object.entries(kind.clips)) act[n] = mixer.clipAction(c);
    act.idle.play(); act.walk.play(); act.walk.setEffectiveWeight(0);
    for (const n of ['walk', 'idle']) act[n].time = R() * act[n].getClip().duration;
    this.P = { model, mixer, act, bones, rest };
    this.fall.add(model);
    this.J = Object.fromEntries(JOINTS.map((k) => [k, V()]));
    this.style = makeStyle(R);
    this.blob = new THREE.Mesh(shapes().blob, materials.blob); this.blob.position.y = 0.012; this.blob.renderOrder = 1; this.root.add(this.blob);
    this.goo = new THREE.Mesh(shapes().goo, materials.goo); this.goo.visible = false; this.root.add(this.goo);
    this.look = { scale: this.height / 1.75, wide: 1 };
    this.pos = this.root.position;
    this.walkSpeed = 1.0 + R() * 0.4;
    this.blend = 1; this.far = 0;
  }
  get top(){ return this.height + 0.05; }
  // read where every joint is (after the pose has been set)
  readJoints(){
    this.root.updateMatrixWorld(true);
    const B = this.P.bones;
    for (const k of JOINTS){ const b = B[k]; if (b) b.getWorldPosition(this.J[k]); }
  }
}

// ---------- everyone ----------
export class People {
  constructor(scene, town, kinds){
    this.town = town; this.list = []; this.kinds = kinds;
    this.group = new THREE.Group(); scene.add(this.group);
    this.fx = new THREE.Group(); scene.add(this.fx);
    this.handlers = {};
    this.tagMats = { alien: tagMaterial('👽 ALIEN!', '#d83a3a'), human: tagMaterial('✓ HUMAN', '#2a984a') };
    this.bubbles = [0, 1, 2, 3].map(() => {
      const tc = textCanvas(512, 160), s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tc.tex, transparent: true, depthTest: true, toneMapped: false }));
      s.scale.set(1.6, 0.5, 1); s.visible = false; this.fx.add(s);
      return { tc, s, who: null, t: 0 };
    });
    this.chatT = 3;
    // everyone, made once and reused town after town (a different person from each avatar)
    const R = rng(12345);
    this.pool = kinds.map((k, i) => new Person(k, i, R));
    for (const p of this.pool){ p.root.visible = false; this.group.add(p.root); }
    this.flat = this.pool.flatMap((p) => [p.blob, p.goo]);   // (left out of the X-ray view)
    const n = this.pool.length;
    this.sets = {
      X: new InnerSet(this.group, materials.glow, [INNER], n),
      F: new InnerSet(this.group, materials.glow, [0], n),
      D: new InnerSet(this.group, materials.vc, [0, INNER], n),
    };
    this.sets.D.castShadow = true;
    this.R = rng(Date.now() >>> 0);
    this.frame = 0;
  }
  on(n, f){ (this.handlers[n] = this.handlers[n] || []).push(f); }
  emit(n, x){ for (const f of this.handlers[n] || []) f(x); }

  clear(){
    for (const p of this.list){
      p.root.visible = false;
      if (p.tag){ p.root.remove(p.tag); p.tag = null; }
    }
    this.list = [];
    for (const b of this.bubbles){ b.s.visible = false; b.who = null; }
    for (const s of Object.values(this.sets)){ s.begin(); s.end(); }
  }
  // a new town's worth of people: `count` of them (at most one per avatar), `aliens` of those aliens
  spawn(count, aliens, avoid, level, seed = Date.now()){
    this.clear();
    const R = this.R = rng(seed), T = this.town;
    count = Math.min(count, this.pool.length);
    const order = this.pool.slice().sort(() => R() - 0.5).slice(0, count);
    const isAlien = order.map((_, i) => i < aliens);
    for (let i = count - 1; i > 0; i--){ const j = Math.floor(R() * (i + 1)); [isAlien[i], isAlien[j]] = [isAlien[j], isAlien[i]]; }
    const used = new Set(), names = new Set();
    const far = (n) => !used.has(n.i) && Math.hypot(n.x - avoid.x, n.z - avoid.z) > 14;
    const rooms = T.nodes.filter((n) => n.kind === 'room'), walks = T.nodes.filter((n) => n.kind === 'walk');
    order.forEach((p, i) => {
      this.reset(p, isAlien[i], level);
      const pool = p.female ? FEMALE : MALE; let nm; do { nm = pickOf(pool, R); } while (names.has(nm) && names.size < pool.length); names.add(nm); p.name = nm;
      const from = (R() < 0.4 ? rooms : walks).filter(far);
      const n = from.length ? from[Math.floor(R() * from.length)] : walks[Math.floor(R() * walks.length)];
      used.add(n.i);
      p.node = n.i; p.home = n.house >= 0 ? n.house : Math.floor(R() * T.houses.length);
      p.pos.set(n.x + (n.kind === 'walk' ? (R() - 0.5) * 0.8 : 0), T.groundAt(n.x, n.z), n.z);
      p.root.visible = true;
      this.list.push(p);
    });
  }
  reset(p, alien, level){
    Object.assign(p, { alien, flash: false, state: 'idle', wait: 1 + this.R() * 5, path: [], target: null, speed: 0, revealed: false, scanT: 0, dead: false, zapT: 0, fallT: 0, flee: false, scared: 0, revealT: 0 });
    p.yaw = this.R() * Math.PI * 2; p.root.rotation.y = p.yaw;
    p.runSpeed = Math.min(4.4, 2.9 + 0.25 * level);
    p.fall.rotation.set(0, 0, 0); p.fall.position.set(0, 0, 0);
    p.P.model.visible = true; p.goo.visible = false; p.blob.visible = true;
    const { act } = p.P; act.walk.setEffectiveWeight(0); act.idle.setEffectiveWeight(1); p.blend = 1;
    for (const [k, b] of Object.entries(p.P.bones)) b.quaternion.copy(p.P.rest[k]);
  }
  get aliensLeft(){ return this.list.filter((p) => p.alien && !p.dead).length; }

  // ---------- moving about ----------
  goTo(p, dest, speed){
    const path = this.town.path(p.node, dest);
    p.path = path; p.speed = speed; p.target = null;
    p.state = path.length ? 'walk' : 'idle';
    if (!path.length) p.wait = 1 + this.R() * 3;
  }
  wander(p){
    const T = this.town, R = this.R, r = R();
    let dest;
    if (r < 0.3) dest = pickOf(T.houses[p.home].rooms, R);
    else if (r < 0.55){ const shops = T.houses.filter((h) => h.shop); const h = R() < 0.5 ? pickOf(shops, R) : pickOf(T.houses, R); dest = pickOf(h.rooms, R); }
    else dest = pickOf(T.walkNodes, R);
    this.goTo(p, dest, p.walkSpeed);
  }
  runAway(p, from, speed){
    const T = this.town, R = this.R;
    let best = -1, bd = 0;
    for (let i = 0; i < 18; i++){
      const n = T.nodes[Math.floor(R() * T.nodes.length)], d = Math.hypot(n.x - from.x, n.z - from.z);
      if (d > bd){ bd = d; best = n.i; }
    }
    if (best >= 0){ this.goTo(p, best, speed); p.flee = true; }
  }

  // xray: whether the X-ray view is in use (only then are the living people's insides placed)
  update(dt, player, xray){
    const T = this.town, t = (this.time = (this.time || 0) + dt);
    this.frame++;
    for (const p of this.list){
      const dPlayer = Math.hypot(p.pos.x - player.x, p.pos.z - player.z);
      if (p.dead){ this.updateDead(p, dt); continue; }
      let moving = false;
      if (p.state === 'zapped') this.updateZapped(p, dt, player);
      else {
        if (p.alien && p.revealed && !p.flee && dPlayer < 13) this.runAway(p, player, p.runSpeed);
        if (p.scared > 0) p.scared -= dt;
        if (p.state === 'walk'){
          if (!p.target){
            const n = T.nodes[p.path[0]], j = n.kind === 'walk' ? 0.35 : 0;
            p.target = { x: n.x + (this.R() - 0.5) * j * 2, z: n.z + (this.R() - 0.5) * j * 2 };
          }
          const dx = p.target.x - p.pos.x, dz = p.target.z - p.pos.z, d = Math.hypot(dx, dz), step = p.speed * dt;
          if (d <= step + 0.02){
            p.pos.x = p.target.x; p.pos.z = p.target.z; p.node = p.path.shift(); p.target = null;
            if (!p.path.length){ p.state = 'idle'; p.wait = p.flee ? 1 + this.R() * 2 : 2 + this.R() * 7; p.flee = false; }
          } else {
            p.pos.x += dx / d * step; p.pos.z += dz / d * step;
            p.yaw += angleDiff(p.yaw, Math.atan2(dx, dz)) * Math.min(1, dt * 8);
            moving = true;
          }
        } else { p.wait -= dt; if (p.wait <= 0) this.wander(p); }
        p.pos.y = damp(p.pos.y, T.groundAt(p.pos.x, p.pos.z), 12, dt);
        p.root.rotation.y = p.yaw;
      }
      // the body: walking or standing, in their own style; far away, animated less often
      p.far += dt;
      const nearby = dPlayer < 35 || p.state === 'zapped';
      if (!nearby && this.frame % 4 !== p.id % 4) continue;
      const ddt = p.far; p.far = 0;
      const A = p.P.act;
      p.blend = damp(p.blend, moving ? 0 : 1, 6, ddt);
      A.walk.setEffectiveWeight(1 - p.blend); A.idle.setEffectiveWeight(p.blend + 1e-3);
      A.walk.timeScale = Math.max(0.6, p.speed / 1.2) * (p.speed > 2 ? 0.75 : 1);
      p.P.mixer.update(p.state === 'zapped' ? 0 : ddt);   // (zapped: the pose is held, the shaking goes on top)
      const run = moving && p.speed > 2;
      const bounce = nearby ? applyStyle(p.P, p.style, 1 - p.blend, t + p.id * 3.1, run ? 0.22 : 0) : 0;
      if (p.state === 'zapped') this.zapPose(p);
      p.fall.position.y = bounce;
    }
    // the insides
    const { X, F, D } = this.sets;
    X.begin(); F.begin(); D.begin();
    for (const p of this.list){
      const dPlayer = Math.hypot(p.pos.x - player.x, p.pos.z - player.z);
      if (p.dead){ p.readJoints(); this.inside(D, p, true); continue; }
      if (p.state === 'zapped' && p.flash){ p.readJoints(); this.inside(F, p); }
      if (xray && dPlayer < 40){ if (!(p.state === 'zapped' && p.flash)) p.readJoints(); this.inside(X, p); }
    }
    X.end(); F.end(); D.end();
    this.updateBubbles(dt, player);
  }
  // put one person's insides into a set
  inside(set, p, dead){
    const J = p.J, s = p.look.scale;
    const fwd = T1.set(0, 0, 1).applyQuaternion(p.P.model.getWorldQuaternion(_rootQ));
    const up = T2.copy(J.Neck).sub(J.Pelvis);
    const eyes = W.eyes.copy(J.LEye).add(J.REye).multiplyScalar(0.5);
    const hUp = W.hUp.copy(J.Head).sub(J.Neck).normalize(), hFwd = W.hFwd.copy(eyes).sub(J.Head).normalize();
    const at = (back, upBy) => W.at.copy(eyes).addScaledVector(hFwd, -back).addScaledVector(hUp, upBy);
    const d = (a, b) => W.d.copy(a).sub(b);
    if (p.alien){
      frame(set, 'aHead', at(0.065, -0.01), hUp, hFwd, s);
      if (dead) frame(set, 'xeyes', at(0.065, -0.01), hUp, hFwd, s);
      frame(set, 'aBody', W.at.copy(J.Pelvis).lerp(J.Neck, 0.48), up, fwd, s);
      seg(set, 'aLimb', J.Spine2, J.Head, 0.035 * s, fwd);
      for (const L of ['L', 'R']){
        seg(set, 'aLimb', J[L + '_UpperArm'], J[L + '_Forearm'], 0.042 * s, fwd);
        seg(set, 'aLimb', J[L + '_Forearm'], J[L + '_Hand'], 0.032 * s, fwd);
        seg(set, 'aLimb', J[L + '_Thigh'], J[L + '_Calf'], 0.06 * s, fwd);
        seg(set, 'aLimb', J[L + '_Calf'], J[L + '_Foot'], 0.045 * s, fwd);
        frame(set, 'aHand', J[L + '_Hand'], d(J[L + '_Hand'], J[L + '_Finger21']), fwd, s);
        frame(set, 'aFoot', J[L + '_Foot'], up, d(J[L + '_Toe0'], J[L + '_Foot']), s);
      }
      return;
    }
    frame(set, 'skull', at(0.07, 0.005), hUp, hFwd, s);
    frame(set, 'rib', J.Spine2, d(J.Neck, J.Spine1), fwd, s);
    frame(set, 'pelvis', J.Pelvis, d(J.Spine, J.Pelvis), fwd, s);
    seg(set, 'spine', J.Pelvis, J.Neck, s, fwd);
    for (const L of ['L', 'R']){
      seg(set, 'shaft', J[L + '_Clavicle'], J[L + '_UpperArm'], 0.011 * s, fwd);
      seg(set, 'shaft', J[L + '_UpperArm'], J[L + '_Forearm'], 0.017 * s, fwd);
      seg(set, 'shaft', J[L + '_Forearm'], J[L + '_Hand'], 0.014 * s, fwd);
      seg(set, 'shaft', J[L + '_Thigh'], J[L + '_Calf'], 0.022 * s, fwd);
      seg(set, 'shaft', J[L + '_Calf'], J[L + '_Foot'], 0.018 * s, fwd);
      seg(set, 'hand', J[L + '_Hand'], J[L + '_Finger21'], 1, fwd);
      seg(set, 'foot', J[L + '_Foot'], J[L + '_Toe0'], 1, up);
      for (const k of ['_UpperArm', '_Forearm', '_Hand', '_Thigh', '_Calf', '_Foot']) set.put('joint', M4.compose(J[L + k], Q.identity(), S3.setScalar((k === '_Thigh' || k === '_Calf' ? 0.03 : 0.024) * s)));
    }
  }
  updateZapped(p, dt, player){
    p.zapT -= dt;
    p.root.position.x += (Math.random() - 0.5) * 0.03; p.root.position.z += (Math.random() - 0.5) * 0.03;
    p.flash = Math.floor(p.zapT * 16) % 2 === 0;
    p.P.model.visible = !p.flash;
    if (p.zapT > 0) return;
    p.flash = false;
    if (p.alien){ this.die(p); return; }
    p.P.model.visible = true;
    for (const [k, b] of Object.entries(p.P.bones)) if (/Arm|Forearm|Clavicle/.test(k)) b.quaternion.copy(p.P.rest[k]);
    p.state = 'idle'; p.scared = 4;
    this.say(p, pickOf(['Ow! Hey!', 'Ouch! I\'m not an alien!', 'Yikes! What was that for?', 'Bzzzt! Ow!'], this.R), true);
    this.runAway(p, player, 3.0);
    this.emit('hurt', p);
  }
  // arms flung up, shaking (laid over whatever pose they were in)
  zapPose(p){
    const B = p.P.bones, j = () => (Math.random() - 0.5) * 0.25;
    p.P.model.updateMatrixWorld(true); p.P.model.parent.getWorldQuaternion(_rootQ);
    turn(B.L_UpperArm, 'fwd', 1.15 + j()); turn(B.R_UpperArm, 'fwd', -1.15 + j());
    turn(B.L_Forearm, 'fwd', 0.6 + j()); turn(B.R_Forearm, 'fwd', -0.6 + j());
    turn(B.Head, 'right', j()); turn(B.Spine1, 'fwd', j() * 0.4);
  }
  die(p){
    p.dead = true; p.state = 'dead'; p.fallT = 0; p.flash = false;
    p.P.model.visible = false; p.blob.visible = false;
    if (p.tag) p.tag.visible = false;
    p.goo.position.set(0, 0.012, -0.75); p.goo.scale.setScalar(0.01); p.goo.visible = true;
    // arms out, legs apart: the pose it falls in
    p.P.model.updateMatrixWorld(true); p.P.model.parent.getWorldQuaternion(_rootQ);
    const B = p.P.bones;
    for (const [k, b] of Object.entries(B)) if (/Arm|Forearm|Thigh|Calf|Spine|Head|Neck|Clavicle|Hand/.test(k)) b.quaternion.copy(p.P.rest[k]);
    turn(B.L_UpperArm, 'fwd', 0.45); turn(B.R_UpperArm, 'fwd', -0.45);
    turn(B.L_Thigh, 'fwd', 0.25); turn(B.R_Thigh, 'fwd', -0.25);
    this.emit('killed', p);
  }
  updateDead(p, dt){
    if (p.fallT >= 1) return;
    p.fallT = Math.min(1, p.fallT + dt / 0.75);
    const t = p.fallT, e = t < 0.75 ? (t / 0.75) ** 2 : 1 - Math.sin((t - 0.75) / 0.25 * Math.PI) * 0.08;
    p.fall.rotation.x = -Math.PI / 2 * e; p.fall.position.y = 0.12 * e;
    p.goo.scale.setScalar(Math.max(0.01, t));
  }

  // ---------- the shock gun ----------
  rayHit(o, d, far){
    let best = null, bt = far;
    const dl = Math.hypot(d.x, d.z);
    for (const p of this.list){
      if (p.dead) continue;
      const r = 0.3, wx = o.x - p.pos.x, wz = o.z - p.pos.z;
      let t;
      if (dl < 1e-4) t = (p.pos.y + 1 - o.y) / d.y;
      else t = -(wx * d.x + wz * d.z) / (dl * dl);
      if (t < 0 || t > bt) continue;
      const cx = wx + d.x * t, cz = wz + d.z * t, y = o.y + d.y * t - p.pos.y;
      if (cx * cx + cz * cz > r * r || y < 0 || y > p.top) continue;
      bt = t; best = p;
    }
    return best ? { p: best, t: bt } : null;
  }
  zap(p){
    if (p.dead || p.state === 'zapped') return null;
    p.state = 'zapped'; p.zapT = p.alien ? 0.7 : 0.9; p.path = []; p.target = null; p.flee = false;
    if (!p.revealed) this.reveal(p, true);
    this.emit('zapped', p);
    return p.alien ? 'alien' : 'human';
  }

  // ---------- the X-ray tablet ----------
  // everyone the X-ray camera can see (inside rect, in normalised screen coordinates) is scanned; after
  // a moment they are revealed. Returns how far along the furthest scan is, and (focus) the already
  // revealed person nearest the middle of the view.
  scan(dt, cam, rect, range = 32){
    let best = null, seen = 0, focus = null, fd = Infinity;
    const v = V(), cp = cam.getWorldPosition(V()), cx = (rect[0] + rect[2]) / 2, cy = (rect[1] + rect[3]) / 2;
    for (const p of this.list){
      if (p.dead) continue;
      v.set(p.pos.x, p.pos.y + 1.15 * p.look.scale, p.pos.z);
      const dist = v.distanceTo(cp);
      v.project(cam);
      const inView = dist < range && v.z < 1 && v.x > rect[0] && v.x < rect[2] && v.y > rect[1] && v.y < rect[3];
      if (!inView){ p.scanT = Math.max(0, p.scanT - dt * 0.5); continue; }
      seen++;
      if (p.revealed){ const d = Math.hypot(v.x - cx, v.y - cy); if (d < fd){ fd = d; focus = p; } continue; }
      p.scanT += dt;
      if (p.scanT >= 0.7){ this.reveal(p); continue; }
      if (!best || p.scanT > best.scanT) best = p;
    }
    return { progress: best ? clamp(best.scanT / 0.7) : 0, target: best, seen, focus };
  }
  reveal(p, quiet){
    if (p.revealed) return;
    p.revealed = true;
    p.tag = new THREE.Sprite(p.alien ? this.tagMats.alien : this.tagMats.human);
    p.tag.scale.set(0.8, 0.25, 1); p.tag.position.y = p.height + 0.35; p.tag.layers.enable(INNER);
    p.root.add(p.tag);
    if (!quiet){
      this.emit('revealed', p);
      if (p.alien) this.say(p, pickOf(['Uh-oh! Found out!', 'Eek! Run away!', 'Blorp! I mean... bye!', 'You\'ll never catch me!'], this.R), true);
    }
  }

  // ---------- chatter ----------
  say(p, text, force){
    let b = this.bubbles.find((x) => x.who === p) || this.bubbles.find((x) => !x.who);
    if (!b){ if (!force) return; b = this.bubbles.reduce((a, c) => (c.t < a.t ? c : a)); }
    const g = b.tc.ctx; g.clearRect(0, 0, 512, 160);
    g.font = 'bold 40px "Helvetica Neue", Arial, sans-serif';
    const words = text.split(' '), lines = []; let line = '';
    for (const w of words){ const tt = line ? line + ' ' + w : w; if (g.measureText(tt).width > 440 && line){ lines.push(line); line = w; } else line = tt; }
    lines.push(line);
    g.fillStyle = 'rgba(255,255,255,0.94)'; g.strokeStyle = '#3a3a4a'; g.lineWidth = 4;
    roundRect(g, 8, 8, 496, 120, 30); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(230, 126); g.lineTo(256, 154); g.lineTo(280, 126); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.94)'; g.fillRect(232, 118, 46, 10);
    g.fillStyle = '#1a1a2a'; g.textAlign = 'center'; g.textBaseline = 'middle';
    lines.slice(0, 2).forEach((l, i) => g.fillText(l, 256, 68 + (i - (Math.min(2, lines.length) - 1) / 2) * 44));
    b.tc.tex.needsUpdate = true;
    b.who = p; b.t = 3.5; b.s.visible = true;
    this.emit('speak', p);
  }
  updateBubbles(dt, player){
    for (const b of this.bubbles){
      if (!b.who) continue;
      b.t -= dt;
      if (b.t <= 0 || !this.list.includes(b.who)){ b.who = null; b.s.visible = false; continue; }
      const p = b.who;
      b.s.position.set(p.pos.x, p.pos.y + p.top + (p.revealed && !p.dead ? 0.65 : 0.35), p.pos.z);
    }
    this.chatT -= dt;
    if (this.chatT > 0) return;
    this.chatT = 3 + this.R() * 4;
    const near = this.list.filter((p) => !p.dead && p.state !== 'zapped' && !p.revealed && Math.hypot(p.pos.x - player.x, p.pos.z - player.z) < 11);
    if (!near.length) return;
    const p = pickOf(near, this.R);
    this.say(p, p.alien && this.R() < 0.55 ? pickOf(ALIEN_LINES, this.R) : pickOf(HUMAN_LINES, this.R));
  }
}
function pickOf(a, R){ return a[Math.floor(R() * a.length)]; }
function tagMaterial(text, col){
  const tc = textCanvas(384, 120), g = tc.ctx;
  g.fillStyle = col; roundRect(g, 6, 6, 372, 108, 34); g.fill();
  g.strokeStyle = '#ffffff'; g.lineWidth = 8; roundRect(g, 6, 6, 372, 108, 34); g.stroke();
  g.fillStyle = '#ffffff'; g.font = 'bold 56px "Helvetica Neue", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 192, 64);
  tc.tex.needsUpdate = true;
  return new THREE.SpriteMaterial({ map: tc.tex, transparent: true, toneMapped: false });
}
