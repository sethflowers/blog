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
  model.traverse((o) => {
    if (o.isMesh){ o.material = kind.mats[o.material.name] || o.material; o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
    if (o.isBone && /Head$/.test(o.name) && !head) head = o;
  });
  // stand it on the ground, the right height, facing +z
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model), s = height / Math.max(0.5, box.max.y - box.min.y);
  model.scale.multiplyScalar(s); model.position.y = -box.min.y * s;
  const mixer = new THREE.AnimationMixer(model);
  const act = {};
  for (const [n, c] of Object.entries(kind.clips)){ act[n] = mixer.clipAction(c); }
  for (const n of ['agree', 'headShake']){ if (act[n]){ act[n].setLoop(THREE.LoopOnce, 1); act[n].clampWhenFinished = false; } }
  act.idle.play(); act.walk.play(); act.walk.setEffectiveWeight(0);
  return { model, mixer, act, head, gesture: null };
}
