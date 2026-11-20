// Realistic people: avatars from Microsoft's Rocketbox library (MIT licence), each converted by
// _tools/msb/rocketbox.mjs into a small .glb (512 px textures, physically based materials) with walk,
// idle, nod and head-shake animations retargeted onto its skeleton. Every visitor is a different
// person. If they can't load, visitors.js falls back to its own simple people.
import * as THREE from 'three';
import { GLTFLoader } from '/experiments/msb/lib/addons/GLTFLoader.js';
import { clone as cloneSkinned } from '/experiments/msb/lib/addons/SkeletonUtils.js';

const BASE = '/experiments/msb/models/';
const V = () => document.body.dataset.version || '0';

export async function loadPeople(){
  // the visitors: Microsoft Rocketbox avatars (MIT licence), each its own person (_tools/msb/rocketbox.mjs)
  const L = new GLTFLoader();
  const list = await fetch(BASE + 'people/list.json?v=' + V()).then((r) => { if (!r.ok) throw new Error('people list'); return r.json(); });
  const gltfs = await Promise.all(list.map((P) => L.loadAsync(BASE + 'people/' + P.id + '.glb?v=' + V())));
  return gltfs.map((g, i) => ({ scene: g.scene, mats: {}, clips: Object.fromEntries(g.animations.map((c) => [c.name, c])), height: list[i].height, female: list[i].female, id: list[i].id }));
}

// a person: a copy of the model in an outfit, its animation mixer and actions
export function makePerson(kind, height){
  const model = cloneSkinned(kind.scene);
  let head = null;
  const bones = {};
  model.traverse((o) => {
    if (o.isMesh){ o.material = kind.mats[o.material.name] || o.material; o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
    if (o.isBone){ bones[o.name.replace(/^Bip01_?/, '')] = o; if (/Head$/.test(o.name) && !head) head = o; }
  });
  const rest = {}; for (const [k, b] of Object.entries(bones)) rest[k] = b.quaternion.clone();
  // stand it on the ground, the right height, facing +z
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model), s = height / Math.max(0.5, box.max.y - box.min.y);
  model.scale.multiplyScalar(s); model.position.y = -box.min.y * s;
  const mixer = new THREE.AnimationMixer(model);
  const act = {};
  for (const [n, c] of Object.entries(kind.clips)){ act[n] = mixer.clipAction(c); }
  for (const n of ['agree', 'headShake']){ if (act[n]){ act[n].setLoop(THREE.LoopOnce, 1); act[n].clampWhenFinished = false; } }
  act.idle.play(); act.walk.play(); act.walk.setEffectiveWeight(0);
  return { model, mixer, act, head, bones, rest, gesture: null };
}

// ---------- everyone walks a little differently ----------
// A style per person, laid on top of the shared walk and idle after the animation has posed the body:
// leaning forward or upright, a head tilt, big or small arm swings, arms close in or held out, toes
// out or straight, hip sway, bounce. Rotations are about the person's own forward / right / up axes.
export function makeStyle(R){
  const r = (a, b) => a + R() * (b - a);
  return { lean: r(-0.05, 0.14), headDown: r(-0.06, 0.12), headSide: r(-0.07, 0.07), swing: r(0.55, 1.3), elbow: r(0, 0.35), armOut: r(0, 0.13),
    turnout: r(-0.02, 0.2), sway: r(0, 0.07), bounce: r(0, 0.035), shoulders: r(-0.06, 0.08), idleRate: r(0.25, 0.6), idleShift: r(0.01, 0.045) };
}
const _q = new THREE.Quaternion(), _p = new THREE.Quaternion(), _a = new THREE.Vector3(), _rootQ = new THREE.Quaternion();
const AX = { right: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0), fwd: new THREE.Vector3(0, 0, 1) };
// turn a bone by an angle about one of the person's own axes
function turn(b, axis, angle){
  if (!b || !angle) return;
  _a.copy(AX[axis]).applyQuaternion(_rootQ);
  b.parent.getWorldQuaternion(_p);
  _q.setFromAxisAngle(_a, angle);
  _q.premultiply(_p.clone().invert()).multiply(_p);   // that world turn, in the parent's frame
  b.quaternion.premultiply(_q);
}
// walkW: how much they're walking (0 standing, 1 walking); t: time; returns an extra bounce for the body
export function applyStyle(P, S, walkW, t){
  const B = P.bones, w = walkW, st = 1 - walkW;
  P.model.updateMatrixWorld(true);
  P.model.parent.getWorldQuaternion(_rootQ);
  const walk = P.act.walk, ph = walk.getClip().duration ? (walk.time / walk.getClip().duration) * Math.PI * 2 : 0;
  // (the swing scale works on the pose the animation set, before any other turn)
  for (const s of ['L', 'R']){
    const ua = B[s + '_UpperArm']; if (!ua) continue;
    const k = 1 + (S.swing - 1) * w;
    ua.userData.anim = (ua.userData.anim || new THREE.Quaternion()).copy(ua.quaternion);
    ua.quaternion.slerpQuaternions(P.rest[s + '_UpperArm'], ua.userData.anim, Math.min(1.35, k));
  }
  P.model.updateMatrixWorld(true);
  const sign = { L: 1, R: -1 };
  turn(B.Spine1, 'right', S.lean * (0.6 + 0.4 * w));
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
