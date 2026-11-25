// The passengers: realistic, rigged, animated people (Microsoft's Rocketbox avatars, MIT licence, the
// same 18 as MSB, Alien Hunter and Fantasy Theme Park: _tools/msb/rocketbox.mjs made them, with idle,
// walk, nod ("agree") and head-shake animations). Only the bodies a mystery needs are loaded.
//
// Each person can wear their profession's hat, and can have a photo head (cast.js) in place of the
// avatar's own: its head and hair are hidden and the photo head rides on the head bone.
// The victim lies on the floor, face up, still.
import * as THREE from 'three';
import { GLTFLoader } from '../lib/addons/GLTFLoader.js';
import { clone as cloneSkinned } from '../lib/addons/SkeletonUtils.js';
import { V, damp, angleDiff, mat } from './util.js';
import { AVATARS } from './mystery.js';

const BASE = '/experiments/sherlock/models/people/';
const kinds = new Map();         // avatar index → { scene, clips, height, head: { box } }
const loader = new GLTFLoader();

// load the bodies a mystery needs (each once); progress(done, total)
export async function loadKinds(list, progress){
  const want = [...new Set(list)].filter((i) => !kinds.has(i));
  let done = 0; const total = want.length;
  if (progress) progress(0, total);
  await Promise.all(want.map(async (i) => {
    const g = await loader.loadAsync(BASE + AVATARS[i].id + '.glb?v=' + (document.body.dataset.version || '0'));
    const scene = g.scene; scene.updateMatrixWorld(true);
    // the head: its size and place, measured from the head mesh at rest (model space)
    const box = new THREE.Box3(), v = V();
    scene.traverse((o) => { if (o.isSkinnedMesh && o.material.name === 'head'){ for (let k = 0; k < o.geometry.attributes.position.count; k++){ o.getVertexPosition(k, v); v.applyMatrix4(o.matrixWorld); box.expandByPoint(v); } } });
    const all = new THREE.Box3().setFromObject(scene);
    kinds.set(i, { scene, clips: Object.fromEntries(g.animations.map((c) => [c.name, c])), height: all.max.y - all.min.y, minY: all.min.y, head: box, female: AVATARS[i].female });
    done++; if (progress) progress(done, total);
  }));
}
export const kindLoaded = (i) => kinds.has(i);

// ---------- hats ----------
const hatGeo = new Map();
function hatShape(kind){
  if (hatGeo.has(kind)) return hatGeo.get(kind);
  const parts = [];
  const lathe = (pts, col, seg = 20) => { const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg); parts.push([g, col]); };
  const W = 0xf6f4ee;
  switch (kind){
    case 'toque': lathe([[0, 0], [0.105, 0], [0.11, 0.04], [0.1, 0.08], [0.13, 0.16], [0.14, 0.22], [0.11, 0.26], [0, 0.27]], W); break;
    case 'baker': lathe([[0, 0], [0.105, 0], [0.11, 0.05], [0.12, 0.08], [0.1, 0.1], [0, 0.1]], W); break;
    case 'cap': lathe([[0, 0], [0.105, 0], [0.11, 0.03], [0.1, 0.07], [0, 0.09]], 0x2a3a5a); { const b = new THREE.CylinderGeometry(0.09, 0.09, 0.012, 16, 1, false, -Math.PI / 2, Math.PI); b.scale(1, 1, 0.8); b.translate(0, 0.005, 0.06); parts.push([b, 0x2a3a5a]); } break;
    case 'conductor': lathe([[0, 0], [0.105, 0], [0.105, 0.035], [0.12, 0.08], [0.1, 0.09], [0, 0.09]], 0x1a2440); { const b = new THREE.CylinderGeometry(0.09, 0.09, 0.012, 16, 1, false, -Math.PI / 2, Math.PI); b.scale(1, 1, 0.8); b.translate(0, 0.005, 0.07); parts.push([b, 0x101010]); const band = new THREE.CylinderGeometry(0.107, 0.107, 0.02, 20, 1, true); band.translate(0, 0.025, 0); parts.push([band, 0xc8a050]); } break;
    case 'straw': lathe([[0, 0.12], [0.1, 0.12], [0.11, 0.02], [0.24, 0.0], [0.24, -0.01], [0.105, 0.0], [0, 0.0]], 0xd8c080); break;
    case 'bucket': lathe([[0, 0.11], [0.1, 0.11], [0.11, 0.01], [0.17, -0.04], [0.165, -0.05], [0.105, 0.0], [0, 0.0]], 0xe0b020); break;
    case 'beret': { const g = new THREE.SphereGeometry(0.13, 18, 10); g.scale(1, 0.32, 1); g.translate(0.02, 0.03, -0.01); parts.push([g, 0x8a1a1a]); } break;
    case 'veil': lathe([[0, 0.1], [0.1, 0.1], [0.11, 0.0], [0.2, -0.01], [0.105, 0.005], [0, 0.0]], 0xf0f0e8); { const v = new THREE.CylinderGeometry(0.19, 0.19, 0.18, 18, 1, true); v.translate(0, -0.1, 0); parts.push([v, 0x202020, true]); } break;
    default: return null;
  }
  const out = parts.map(([g, col, see]) => { g.userData.keep = true; return new THREE.Mesh(g, see ? mat('veilNet', { color: col, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }) : mat('hat' + col.toString(16), { color: col, rough: 0.8 })); });
  hatGeo.set(kind, out); return out;
}

// ---------- a person ----------
const HEIGHT = { short: 0.94, medium: 1.0, tall: 1.07 };
export class Person {
  // o: { avatar, heightBand, hat, photoHead (a function (headSize) → Object3D), name }
  constructor(o){
    const K = kinds.get(o.avatar);
    this.o = o; this.K = K;
    this.holder = new THREE.Group();          // position and turn (yaw)
    this.tilt = new THREE.Group(); this.holder.add(this.tilt);
    const model = this.model = cloneSkinned(K.scene);
    const base = AVATARS[o.avatar].female ? 1.66 : 1.78;
    this.height = base * (HEIGHT[o.heightBand] || 1);
    this.scale = this.height / K.height;
    this.size = HEIGHT[o.heightBand] || 1;        // taller or shorter than the avatar
    this.mu = base / K.height;                    // metres per model unit, at normal height
    model.scale.setScalar(this.scale); model.position.y = -K.minY * this.scale;
    model.traverse((m) => { if (m.isMesh){ m.frustumCulled = false; m.castShadow = false; } if (m.isBone && m.name === 'Bip01_Head') this.headBone = m; });
    this.tilt.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    this.actions = {};
    for (const n of ['idle', 'walk', 'agree', 'headShake']) if (K.clips[n]) this.actions[n] = this.mixer.clipAction(K.clips[n]);
    this.actions.idle.play();
    this.actions.idle.time = Math.random() * 3;
    for (const n of ['agree', 'headShake']){ const a = this.actions[n]; if (a){ a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = false; } }
    this.mixer.addEventListener('finished', () => { this.actions.idle.reset().fadeIn(0.3).play(); });
    this.yaw = 0; this.wantYaw = null; this.lying = false;
    model.updateMatrixWorld(true);
    // the head, in model space at rest: crown, chin, centre
    const H = K.head;
    this.headInfo = { crown: H.max.y, cx: (H.min.x + H.max.x) / 2, cz: (H.min.z + H.max.z) / 2 - 0.01, w: (H.max.x - H.min.x), d: (H.max.z - H.min.z) };
    if (o.photoHead) this.setPhotoHead(o.photoHead);
    if (o.hat && !AVATARS[o.avatar].covered) this.addHat(o.hat);
  }
  // put something on the head bone, given where it goes in the model's own space at rest (the avatars
  // are in centimetres: mu is metres per model unit for a person of normal height). size: the thing's
  // scale ('model' if it's built in model units, else it's in metres and grows with the person)
  onHead(obj, x, y, z, inModelUnits){
    this.model.updateMatrixWorld(true);
    const p = V(x, y, z).applyMatrix4(this.model.matrixWorld);
    // (called while the person is still at the origin, unturned, so the model's space is the tilt's)
    obj.position.copy(p); obj.scale.multiplyScalar(inModelUnits ? this.scale : this.size);
    this.tilt.add(obj); obj.updateMatrixWorld(true);
    this.headBone.attach(obj);
  }
  addHat(kind){
    const shape = hatShape(kind); if (!shape) return;
    const g = new THREE.Group(); for (const m of shape) g.add(m.clone());
    const h = this.headInfo, top = this.photo ? this.photo.crown : h.crown;
    this.onHead(g, h.cx, top - (kind === 'beret' ? 0.03 : kind === 'toque' || kind === 'baker' ? 0.085 : 0.06) / this.mu, h.cz);
    this.hat = g;
  }
  // your own person's face: hide the avatar's head and hair, and wear the photo head instead
  setPhotoHead(make){
    const h = this.headInfo, mu = this.mu;
    const head = make();                       // a unit head: chin y = -1, crown y = +1, |x|,|z| ≤ ~1
    const crown = h.crown - 0.005 / mu, height = 0.245 / mu, cy = crown - height / 2;
    head.scale.set(h.w * 0.5, height / 2, h.d * 0.42);
    this.model.traverse((m) => { if (m.isSkinnedMesh && (m.material.name === 'head' || m.material.name === 'opacity')) m.visible = false; });
    const g = new THREE.Group(); g.add(head);
    this.onHead(g, h.cx, cy, h.cz + 0.005 / mu, true);
    this.photo = { group: g, head, crown };
  }
  // stand somewhere, facing yaw (0 = +z)
  place(x, z, yaw){ this.holder.position.set(x, 0, z); this.yaw = yaw; this.homeYaw = yaw; this.holder.rotation.y = yaw; this.lying = false; this.tilt.rotation.set(0, 0, 0); this.tilt.position.set(0, 0, 0); }
  // lie on the floor, face up, head towards yaw
  lie(x, z, yaw){
    this.place(x, z, yaw);
    this.lying = true;
    this.tilt.rotation.x = -Math.PI / 2;
    this.tilt.position.set(0, 0.13, this.height * 0.5);
    this.actions.idle.time = 0; this.mixer.update(0);
  }
  gesture(name){ const a = this.actions[name]; if (!a || this.lying) return; this.actions.idle.fadeOut(0.25); a.reset().fadeIn(0.25).play(); }
  // turn to look at a point (or back to how they were standing: null)
  lookAt(p){ this.wantYaw = p ? Math.atan2(p.x - this.holder.position.x, p.z - this.holder.position.z) : null; }
  update(dt){
    if (this.lying) return;
    this.mixer.update(dt);
    const want = this.wantYaw ?? this.homeYaw ?? this.yaw;
    this.yaw += angleDiff(this.yaw, want) * (1 - Math.exp(-4 * dt));
    this.holder.rotation.y = this.yaw;
  }
  headPos(target = V()){ return this.headBone.getWorldPosition(target); }
  dispose(){
    this.holder.removeFromParent();
    this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.model);
    // each copy has its own skeleton, whose bone texture must be freed (the shapes and skins are shared)
    const sk = new Set(); this.model.traverse((o) => { if (o.isSkinnedMesh) sk.add(o.skeleton); }); for (const s of sk) s.dispose();
    if (this.photo) this.photo.head.traverse((m) => { if (m.geometry) m.geometry.dispose(); if (m.material && m.material.userData.own){ if (m.material.map) m.material.map.dispose(); m.material.dispose(); } });
  }
}
void damp;
