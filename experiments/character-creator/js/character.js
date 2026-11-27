// The character, for the designer and for any other game.
//
//   import { createCharacter, savedCharacters } from './character.js';
//   const people = savedCharacters();                  // [{ id, name, spec, code, thumb }] made in the designer
//   const c = await createCharacter(people[0].spec);   // or a code: await createCharacter('CC2-...') or a seed: 1234
//   scene.add(c.root);  ...  c.update(dt);              // breathing, blinking, glancing
//   c.bones.head, c.bones['upperarm01.L'] ...           // a THREE.Bone for each of MakeHuman's 163 bones
//   await c.set(otherSpec);                              // reshape / re-dress (only what changed is rebuilt)
//   c.dispose();
//
// It needs three.js as 'three' in the page's import map; everything else is in this folder and
// ../data (copy both folders into another game, and add their files to its service worker).
import * as THREE from 'three';
import { loadHumanData, Human } from './mh.js';
import { Looks } from './looks.js';
import { initControls, upgrade, shapeOf, partsOf, fromCode, clone, defaults } from './spec.js';

export const SAVE_KEY = 'character-creator-v1';
let ready = null;
export function loadCharacterData(progress){
  if (!ready) ready = loadHumanData(progress).then((data) => { initControls(data.manifest, data.parts); return data; });
  return ready;
}
// the characters saved in the designer (on this device: every game on this site can read them)
export function savedCharacters(){
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}'); return Array.isArray(s.characters) ? s.characters : []; } catch (e) { return []; }
}

export class Character {
  constructor(data){
    this.data = data;
    this.human = new Human(data);
    this.looks = new Looks();
    this.root = this.human.root;
    this.bones = this.human.boneByName;
    this.spec = null;
    this.t = Math.random() * 100;
    this.look = new THREE.Vector2();
    this.lookTarget = null;    // a world point to look at (the camera, say), or null
  }
  async set(specIn){
    const spec = upgrade(specIn);
    const prev = this.spec;
    const shape = shapeOf(spec), parts = partsOf(spec);
    const shapeKey = JSON.stringify(shape), partsKey = parts.join(',');
    let changed = false;
    if (!prev || partsKey !== this.partsKey){ this.human.setParts(parts); this.partsKey = partsKey; changed = true; }
    if (!prev || shapeKey !== this.shapeKey){ this.human.setShape(shape); this.shapeKey = shapeKey; changed = true; }
    this.human.headScale = shape.headScale;
    this.spec = spec;
    const lookKey = JSON.stringify([spec.style, spec.skin, spec.eyes, spec.brows.color, spec.hair.color, spec.outfit, partsKey, spec.macro.gender, spec.macro.age, spec.macro.african, spec.macro.asian, spec.macro.caucasian]);
    if (changed || lookKey !== this.lookKey){ await this.looks.apply(this.human, spec, this.data.manifest); this.lookKey = lookKey; }
    this.human.relax();
    return this;
  }
  // how tall they stand (metres, to the top of the head)
  height(){
    const p = this.human.pos, rv = this.data.base.bodyRV; let top = -Infinity;
    for (let i = 0; i < rv.length; i++){ const y = p[rv[i] * 3 + 1]; if (y > top) top = y; }
    return (top - this.human.footY) * (1 + (this.human.headScale - 1) * 0.12);
  }
  headPosition(target = new THREE.Vector3()){ return this.bones.head.getWorldPosition(target); }
  update(dt){
    this.t += dt;
    // glance: towards the look target, with little saccades
    let lx = 0, ly = 0;
    if (this.lookTarget){
      const head = this.headPosition(new THREE.Vector3());
      const d = this.lookTarget.clone().sub(head);
      const inv = new THREE.Quaternion(); this.root.getWorldQuaternion(inv); inv.invert(); d.applyQuaternion(inv);
      lx = Math.atan2(d.x, d.z); ly = Math.atan2(d.y, Math.hypot(d.x, d.z));
      lx = Math.max(-0.9, Math.min(0.9, lx)); ly = Math.max(-0.5, Math.min(0.5, ly));
    }
    this.sacT = (this.sacT || 0) - dt;
    if (this.sacT <= 0){ this.sacT = 0.6 + Math.random() * 2.5; this.sac = [(Math.random() - 0.5) * 0.14, (Math.random() - 0.5) * 0.08]; }
    const k = 1 - Math.exp(-dt * 12);
    this.look.x += (lx + (this.sac ? this.sac[0] : 0) - this.look.x) * k;
    this.look.y += (ly + (this.sac ? this.sac[1] : 0) - this.look.y) * k;
    this.human.idle(this.t, dt, this.look);
  }
  dispose(){ this.human.dispose(); this.looks.dispose(); }
}

// spec: a spec object, a character code ('CC2-...'), a seed number, or nothing (the default person)
export async function createCharacter(spec, opts = {}){
  const data = await loadCharacterData(opts.progress);
  const c = new Character(data);
  let s = spec;
  if (typeof s === 'string' || typeof s === 'number') s = fromCode(String(s));
  await c.set(s ? clone(s) : defaults());
  return c;
}
