// Everything you pick up and use. The same jobs work with your real hands in VR (hold a brush and
// stroke the horse; hold the bucket under the tap; drop a flake of hay in the rack) and on the iPad (tap
// a tool to pick it up, then tap or drag on what you want to use it on).
//
// Grooming: curry comb first (loosens the mud), then the body brush (lifts it away), hoof pick on each
// hoof. Tack: saddle pad, then saddle, then do up the girth, then the bridle. Feeding: flakes of hay in
// the rack, a scoop of grain in the tub (not too much!), a bucket of water from the tap. Mucking out:
// fork the droppings and the wet bedding into the wheelbarrow, tip it on the muck heap, spread fresh
// shavings. The pens need feed, water and cleaning too; hens lay eggs and sheep need shearing.
import * as THREE from 'three';
import { V, clamp, lerp, damp, ellipsoid, boxUV, fmtMoney } from './util.js';
import { mat, tex } from './textures.js';
import { PLACES, BARN, PADDOCK, PENS, stallAt, inBox, worldMaterials, sign } from './world.js';
import { bodySurface } from './horse.js';
import { sfx } from './audio.js';

const GB = V(2.4, 0, -19.4);   // grooming box
export const BINS = { grain: V(-2.3, 0, -21.8), pigfeed: V(-3.1, 0, -22.15), corn: V(-3.65, 0, -22.15) };
const BARROW_HOME = V(0.95, 0, -17.2);

// ---------- item meshes ----------
function build(kind){
  const g = new THREE.Group();
  const add = (geo, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.castShadow = true; g.add(o); return o; };
  const wood = mat('oak', { rough: 0.6 }), steel = mat('plain-steel', { color: 0xb8bcc0, rough: 0.3, metal: 0.9 });
  switch (kind){
    case 'curry': {
      const rub = mat('plain-rubber-red', { color: 0xb02a2a, rough: 0.7 });
      add(ellipsoid(0.055, 0.025, 0.075, 14, 8), rub, 0, 0.02, 0);
      for (let i = 0; i < 4; i++) add(new THREE.TorusGeometry(0.03 - i * 0.006, 0.004, 4, 16), rub, 0, -0.005, 0, Math.PI / 2);
      add(new THREE.BoxGeometry(0.08, 0.008, 0.02), mat('leather', { rough: 0.6 }), 0, 0.05, 0);
      g.userData.tip = V(0, -0.01, 0);
      break;
    }
    case 'brush': {
      add(boxUV(0.07, 0.025, 0.17), wood, 0, 0.02, 0);
      add(new THREE.BoxGeometry(0.062, 0.03, 0.16), mat('plain-bristle', { color: 0x2a2018, rough: 0.95 }), 0, -0.008, 0);
      add(new THREE.BoxGeometry(0.075, 0.006, 0.08), mat('leather', { rough: 0.6 }), 0, 0.037, 0);
      g.userData.tip = V(0, -0.025, 0);
      break;
    }
    case 'hoofpick': {
      add(new THREE.CylinderGeometry(0.012, 0.012, 0.11, 8), mat('plain-blue', { color: 0x2a5ab0, rough: 0.5 }), 0, 0, 0);
      add(new THREE.CylinderGeometry(0.004, 0.003, 0.07, 6), steel, 0, 0.08, 0.0);
      add(new THREE.CylinderGeometry(0.004, 0.002, 0.035, 6), steel, 0, 0.11, 0.014, Math.PI / 2);
      g.userData.tip = V(0, 0.11, 0.03);
      break;
    }
    case 'fork': {
      add(new THREE.CylinderGeometry(0.014, 0.014, 1.2, 8), wood, 0, 0.35, 0);
      add(new THREE.BoxGeometry(0.3, 0.02, 0.03), mat('plain-fork', { color: 0x2a6ac0, rough: 0.45 }), 0, -0.26, 0);
      for (let i = 0; i < 12; i++) add(new THREE.CylinderGeometry(0.005, 0.003, 0.3, 5), mat('plain-fork', { color: 0x2a6ac0, rough: 0.45 }), -0.135 + i * 0.0245, -0.4, 0.04, 0.35);
      const load = new THREE.Group(); load.position.set(0, -0.38, 0.09); g.add(load); load.visible = false;
      for (let i = 0; i < 5; i++) { const b = new THREE.Mesh(ellipsoid(0.05, 0.04, 0.05, 8, 6), mat('dirt', { color: 0x6a5434, rough: 0.7 })); b.position.set((i - 2) * 0.05, 0.02, 0); load.add(b); }
      g.userData.load = load; g.userData.tip = V(0, -0.42, 0.06);
      break;
    }
    case 'bucket': {
      const plastic = mat('plain-bucket', { color: 0x2a6ac0, rough: 0.45, side: THREE.DoubleSide });
      add(new THREE.CylinderGeometry(0.15, 0.12, 0.28, 18, 1, true), plastic, 0, -0.18, 0);
      add(new THREE.CircleGeometry(0.12, 18), plastic, 0, -0.32, 0, -Math.PI / 2);
      add(new THREE.TorusGeometry(0.15, 0.006, 4, 20, Math.PI), steel, 0, -0.04, 0, 0, Math.PI / 2, 0);
      const water = add(new THREE.CircleGeometry(0.145, 18), worldMaterials().water, 0, -0.1, 0, -Math.PI / 2);
      g.userData.water = water; g.userData.tip = V(0, -0.2, 0);
      break;
    }
    case 'scoop': {
      const m = mat('plain-scoop', { color: 0xd8d4c8, rough: 0.4, metal: 0.2, side: THREE.DoubleSide });
      add(new THREE.CylinderGeometry(0.06, 0.055, 0.15, 14, 1, true), m, 0, 0, 0.06, Math.PI / 2);
      add(new THREE.CircleGeometry(0.055, 14), m, 0, 0, -0.015, Math.PI);
      add(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 8), m, 0, -0.07, -0.02);
      const fill = add(new THREE.SphereGeometry(0.055, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat('dirt', { color: 0xc8a060, rough: 0.8 }), 0, 0.0, 0.07);
      fill.scale.set(1, 0.5, 1.3); fill.visible = false;
      g.userData.fill = fill; g.userData.tip = V(0, 0, 0.12);
      break;
    }
    case 'flake': {
      add(boxUV(0.4, 0.38, 0.09, 2), mat('hay', { rough: 0.95 }), 0, 0, 0);
      g.userData.tip = V(0, 0, 0);
      break;
    }
    case 'carrot': {
      add(new THREE.ConeGeometry(0.022, 0.18, 10), mat('plain-carrot', { color: 0xe06a1a, rough: 0.6 }), 0, 0, 0.0, Math.PI / 2);
      add(new THREE.ConeGeometry(0.02, 0.06, 6), mat('plain-green', { color: 0x3a8a3a, rough: 0.7 }), 0, 0, -0.11, -Math.PI / 2);
      g.userData.tip = V(0, 0, 0.09);
      break;
    }
    case 'bag': {
      add(boxUV(0.5, 0.2, 0.75), mat('plain-bag', { color: 0x3a7a3a, rough: 0.5 }), 0, 0, 0);
      g.userData.tip = V(0, -0.1, 0);
      break;
    }
    case 'shears': {
      for (const s of [-1, 1]){
        add(new THREE.BoxGeometry(0.012, 0.004, 0.16), steel, s * 0.012, 0, 0.1, 0, s * 0.08);
        add(new THREE.TorusGeometry(0.025, 0.006, 6, 12), mat('plain-red', { color: 0xb02a22, rough: 0.6 }), s * 0.025, 0, -0.02, Math.PI / 2);
      }
      g.userData.tip = V(0, 0, 0.17);
      break;
    }
    case 'pad': {
      const sh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.6), mat('quilt', { rough: 0.85 })); g.add(sh); sh.castShadow = true;
      g.userData.tip = V(0, 0, 0);
      break;
    }
    case 'saddle': {
      const L = mat('leather', { rough: 0.55 });
      add(ellipsoid(0.2, 0.06, 0.26, 16, 8), L, 0, 0, 0);
      add(ellipsoid(0.12, 0.07, 0.06, 12, 6), L, 0, 0.05, 0.22);
      add(ellipsoid(0.15, 0.08, 0.06, 12, 6), L, 0, 0.06, -0.22);
      for (const s of [-1, 1]){ add(new THREE.BoxGeometry(0.02, 0.32, 0.3), mat('leather', { rough: 0.5, color: 0x5a4a40 }), s * 0.2, -0.13, 0.02, 0, 0, s * 0.25); add(new THREE.TorusGeometry(0.05, 0.007, 6, 12, Math.PI), steel, s * 0.25, -0.38, 0.05, Math.PI); }
      g.userData.tip = V(0, -0.03, 0);
      break;
    }
    case 'bridle': {
      const L = mat('leather', { rough: 0.5, color: 0x5a4a40 });
      add(new THREE.TorusGeometry(0.1, 0.008, 6, 20), L, 0, 0, 0, 0, Math.PI / 2);
      add(new THREE.TorusGeometry(0.07, 0.008, 6, 20), L, 0, -0.18, 0, 0, Math.PI / 2);
      add(new THREE.CylinderGeometry(0.005, 0.005, 0.14, 6), steel, 0, -0.25, 0, 0, 0, Math.PI / 2);
      add(new THREE.TorusGeometry(0.22, 0.006, 4, 24, Math.PI), L, 0, -0.3, -0.05, 0, Math.PI / 2, Math.PI);
      g.userData.tip = V(0, -0.1, 0);
      break;
    }
    case 'barrow': {
      const body = mat('plain-barrow', { color: 0x2a7a3a, rough: 0.4, metal: 0.3, side: THREE.DoubleSide });
      const tray = new THREE.CylinderGeometry(0.45, 0.32, 0.32, 4, 1, true); tray.rotateY(Math.PI / 4); tray.scale(1, 1, 1.4);
      add(tray, body, 0, 0.55, 0);
      add(new THREE.BoxGeometry(0.44, 0.02, 0.6), body, 0, 0.4, 0);
      add(new THREE.CylinderGeometry(0.17, 0.17, 0.08, 16), mat('plain-tyre', { color: 0x161616, rough: 0.8 }), 0, 0.17, 0.62, 0, 0, Math.PI / 2);
      for (const s of [-1, 1]){ add(new THREE.CylinderGeometry(0.016, 0.016, 1.3, 8), steel, s * 0.24, 0.45, -0.25, Math.PI / 2 - 0.25); add(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 6), steel, s * 0.2, 0.2, -0.3, 0.2); }
      const load = new THREE.Mesh(ellipsoid(0.36, 0.12, 0.5, 12, 8), mat('dirt', { color: 0x6a5434, rough: 0.8 })); load.position.y = 0.55; g.add(load);
      g.userData.load = load; g.userData.tip = V(0, 0.6, 0);
      break;
    }
  }
  g.traverse((o) => { if (o.isMesh){ o.castShadow = true; o.userData.item = g; } });
  return g;
}

// ---------- items: where they live, how they're held ----------
const STOW_SLOTS = [[-0.16, 0.62, 0.22], [0.16, 0.62, 0.22], [-0.16, 0.62, -0.12], [0.16, 0.62, -0.12]];
const DEFS = {
  curry:    { name: 'Curry comb', home: V(2.25, 0.3, GB.z), homeRot: [0, 0, 0] },
  brush:    { name: 'Body brush', home: V(2.45, 0.3, GB.z), homeRot: [0, 0, 0] },
  hoofpick: { name: 'Hoof pick', home: V(2.6, 0.29, GB.z), homeRot: [Math.PI / 2, 0, 0] },
  pad:      { name: 'Saddle pad', home: V(5.05, 1.36, -21.8), homeRot: [0, Math.PI / 2, 0] },
  saddle:   { name: 'Saddle', home: V(5.05, 1.49, -19.6), homeRot: [0, Math.PI / 2, 0] },
  bridle:   { name: 'Bridle', home: V(5.32, 1.82, -20.7), homeRot: [0, 0, 0] },
  fork:     { name: 'Manure fork', home: V(1.2, 0.8, -22.35), homeRot: [-0.15, 0, 0] },
  barrow:   { name: 'Wheelbarrow', home: BARROW_HOME, homeRot: [0, Math.PI, 0] },
  bucket:   { name: 'Water bucket', home: V(-4.7, 0.33, -21.4), homeRot: [0, 0, 0] },
  scoop:    { name: 'Feed scoop', home: V(-2.3, 0.88, -21.45), homeRot: [0, 0, 0] },
  shears:   { name: 'Shears', home: V(28.5, 1.05, -8.9), homeRot: [0, 0, Math.PI / 2] },
};

export class Care {
  constructor(scene, farm, world){
    this.scene = scene; this.farm = farm; this.world = world;
    this.items = {};
    for (const k of Object.keys(DEFS)){
      const mesh = build(k);
      const it = { kind: k, mesh, ...DEFS[k], held: null, load: 0, content: null, amount: 0, water: 0, onFloor: false };
      mesh.userData.itemRef = it;
      this.items[k] = it;
      scene.add(mesh);
      this.home(it);
    }
    this.temp = [];          // flakes, carrots, bags carried around
    this.buildExtras();
    this.stallBuckets = farm.stalls.map((s) => this.makeStallBucket(s));
    farm.on('stall', (i) => this.refreshStallBucket(i));
    farm.on('tackHome', () => { for (const k of ['pad', 'saddle', 'bridle']) if (!this.items[k].held) this.home(this.items[k]); });
    farm.stalls.forEach((s, i) => this.refreshStallBucket(i));
    this.fill = { t: 0 };
    this.lastTip = [V(), V()];
    this.sayT = 0;
  }
  say(t, kind){ this.farm.say(t, kind); }
  get S(){ return this.farm.state; }

  // things that aren't carried but are touched: feed bins for pig feed and corn, a tool rack
  buildExtras(){
    const steel = mat('plain-steel', { color: 0xb4bac0, rough: 0.42, metal: 0.35 });
    for (const [k, p] of Object.entries(BINS)){
      if (k === 'grain') continue;
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.2, 0.6, 18), steel); can.position.set(p.x, 0.3, p.z); can.castShadow = true; this.scene.add(can);
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.235, 0.04, 18), steel); lid.position.set(p.x, 0.62, p.z); this.scene.add(lid);
      const s = sign(k === 'pigfeed' ? 'PIG FEED' : 'CORN', 0.4, 0.18, { font: 'bold 120px Arial' }); s.position.set(p.x, 0.36, p.z + 0.245); this.scene.add(s);
    }
    // big signs on the wall above the feed bins
    for (const [k, p, text] of [['grain', BINS.grain, 'GRAIN · horses'], ['pigfeed', BINS.pigfeed, 'PIG FEED'], ['corn', BINS.corn, 'CORN · hens']]){
      const s = sign(text, k === 'grain' ? 0.75 : 0.5, 0.22, { font: 'bold 110px Arial' });
      s.position.set(p.x + (k === 'pigfeed' ? 0.12 : k === 'corn' ? -0.08 : 0.15), k === 'grain' ? 1.45 : 1.15, -22.52); this.scene.add(s);
      void k;
    }
    // the grooming kit is labelled too
    const gk = sign('GROOMING KIT', 0.56, 0.2, { font: 'bold 110px Arial' }); gk.position.set(GB.x - 0.312, 0.14, GB.z); gk.rotation.y = -Math.PI / 2; this.scene.add(gk);
    // tool rack on the back wall for the fork
    const wood = mat('oak', { rough: 0.7 });
    const rack = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.08, 0.06), wood); rack.position.set(1.2, 1.4, -22.5); this.scene.add(rack);
    // hook for the shears on the sheep pen gate post
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.3, 0.1), wood); post.position.set(28.5, 0.65, -8.95); this.scene.add(post);
  }
  makeStallBucket(s){
    const g = new THREE.Group();
    const plastic = mat('plain-bucket2', { color: 0x2a5aa0, rough: 0.45, side: THREE.DoubleSide });
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.28, 18, 1, true), plastic); g.add(b);
    const bt = new THREE.Mesh(new THREE.CircleGeometry(0.12, 18), plastic); bt.rotation.x = -Math.PI / 2; bt.position.y = -0.14; g.add(bt);
    const w = new THREE.Mesh(new THREE.CircleGeometry(0.14, 18), worldMaterials().water); w.rotation.x = -Math.PI / 2; g.add(w);
    g.position.copy(s.hookPos); g.userData.water = w;
    g.traverse((o) => { if (o.isMesh){ o.castShadow = true; o.userData.stallBucket = s.id; } });
    this.scene.add(g);
    return g;
  }
  refreshStallBucket(i){
    const st = this.farm.stalls[i].state, w = this.stallBuckets[i].userData.water;
    const f = clamp(st.water / 20);
    w.visible = f > 0.02; w.position.y = -0.13 + f * 0.25; w.scale.setScalar(0.85 + f * 0.15);
  }
  home(it){
    if (it.held) this.release(it);
    if (it.inBarrow) this.unstow(it);
    it.mesh.position.copy(it.home); it.mesh.rotation.set(...it.homeRot); it.onFloor = false; it.homeNow = true;
    this.refreshItem(it);
  }
  refreshItem(it){
    const u = it.mesh.userData;
    if (it.kind === 'fork') u.load.visible = it.load > 0;
    if (it.kind === 'barrow'){ u.load.visible = it.load > 0; u.load.scale.y = clamp(it.load / 8, 0.2, 1.4); u.load.position.y = 0.45 + u.load.scale.y * 0.1; }
    if (it.kind === 'bucket'){ const f = clamp(it.water / 20); u.water.visible = f > 0.02; u.water.position.y = -0.31 + f * 0.26; }
    if (it.kind === 'scoop'){ u.fill.visible = it.amount > 0; u.fill.material = mat('dirt', { color: it.content === 'corn' ? 0xe8c040 : it.content === 'pigfeed' ? 0x9a7a50 : 0xc8a060, rough: 0.8 }); }
  }
  // all the things you could pick up (for raycasts and grabbing)
  pickables(){ return [...Object.values(this.items), ...this.temp]; }
  release(it){ if (it.held){ it.held.item = null; it.held = null; } }

  // the wheelbarrow carries up to four things (tools, flakes, bags of shavings) as well as muck
  cargo(){ return this.pickables().filter((x) => x.inBarrow); }
  stow(it){
    const b = this.items.barrow;
    if (it === b || it.inBarrow || it.onHorse) return false;
    const cargo = this.cargo();
    if (cargo.length >= STOW_SLOTS.length){ this.hint('The wheelbarrow is full of things already.'); return false; }
    this.release(it);
    const slot = STOW_SLOTS.findIndex((_, k) => !cargo.some((c) => c.slot === k));
    it.inBarrow = true; it.slot = slot; it.homeNow = false; it.onFloor = false; it.fallV = 0;
    b.mesh.add(it.mesh);
    const [x, y, z] = STOW_SLOTS[slot];
    if (it.kind === 'fork'){ it.mesh.position.set(x * 0.6, 0.66, -0.1); it.mesh.rotation.set(-(Math.PI / 2 - 0.3), 0, 0); }
    else if (it.kind === 'saddle' || it.kind === 'bag'){ it.mesh.position.set(x, y + 0.08, z); it.mesh.rotation.set(0, Math.PI / 2, 0); }
    else { it.mesh.position.set(x, y, z); it.mesh.rotation.set(it.kind === 'hoofpick' || it.kind === 'shears' ? Math.PI / 2 : 0, slot * 0.8, 0); }
    return true;
  }
  unstow(it){
    if (!it.inBarrow) return;
    it.inBarrow = false; it.slot = null;
    this.scene.attach(it.mesh);
  }

  // a temporary item: a flake of hay, a carrot, a bag of shavings
  makeTemp(kind){
    const mesh = build(kind);
    const it = { kind, mesh, name: { flake: 'Flake of hay', carrot: 'Carrot', bag: 'Bag of shavings' }[kind], temp: true, held: null };
    mesh.userData.itemRef = it;
    this.scene.add(mesh); this.temp.push(it);
    return it;
  }
  dropTemp(it){ this.release(it); it.inBarrow = false; it.mesh.removeFromParent(); this.temp = this.temp.filter((x) => x !== it); this.onDropTemp && this.onDropTemp(it); }

  // ---------- sources: where things come from ----------
  takeFlake(){
    const S = this.S.supplies;
    if (!S.loose){ if (S.hay <= 0){ this.say('The hay stack is empty. Buy hay at the Farm Office.'); return null; } S.hay--; S.loose = 10; this.farm.refreshSupplies(); sfx.hay(PLACES.hayStack); }
    S.loose--;
    return this.makeTemp('flake');
  }
  takeCarrot(){
    const S = this.S.supplies;
    if (S.carrots <= 0){ this.say('No carrots left. Buy more at the Farm Office.'); return null; }
    S.carrots--; return this.makeTemp('carrot');
  }
  takeBag(){
    const S = this.S.supplies;
    if (S.shavings <= 0){ this.say('No shavings left. Buy more at the Farm Office.'); return null; }
    S.shavings--; this.farm.refreshSupplies(); return this.makeTemp('bag');
  }

  // ---------- using a held item on something ----------
  // target: { type, horse?, stall?, pen?, point, hoof?, bin? }. strength: for continuous jobs (VR rubbing, touch dragging).
  // Returns true if something happened.
  use(it, target, strength = 1){
    if (!it || !target) return false;
    const k = it.kind, F = this.farm;
    switch (k){
      case 'curry': case 'brush': {
        if (target.type !== 'horse') return false;
        const h = target.horse;
        const done = h.model.groom(target.point, k, strength * 0.9);
        if (done > 0){
          sfx.brush(target.point, k);
          h.data.needs.happy = Math.min(100, h.data.needs.happy + done * 0.3);
          if (k === 'brush' && h.model.dirtiness() < 0.05 && !h._shinyT){ h._shinyT = 1; this.say(`${h.data.name} is gleaming!`, 'good'); }
        }
        // brushing caked mud does little: you need the curry comb first
        if (k === 'brush' && h.model.caked > 2) this.hint('Use the curry comb first to loosen the caked mud.');
        if (h.model.dirtiness() > 0.05) h._shinyT = 0;
        return done > 0;
      }
      case 'hoofpick': {
        if (target.type !== 'hoof') return false;
        const h = target.horse, i = target.hoof, D = h.data;
        // she picks that foot up for you (one at a time)
        h.lift = [false, false, false, false]; h.lift[i] = true; h._liftT = 1.8;
        const name = ['left front', 'right front', 'left hind', 'right hind'][i];
        const was = D.hooves[i];
        // a tap scrapes it clean; in VR, scraping with the pick does it bit by bit
        if (was > 0){ D.hooves[i] = strength >= 1 ? 0 : Math.max(0, was - 0.35 * strength); sfx.scrape(target.point); }
        if (was > 0.01 && D.hooves[i] <= 0.01){
          const left = D.hooves.filter((x) => x > 0.1).length;
          this.hint(left ? `The ${name} hoof is clean. ${left} more to go (the yellow rings).` : `All four hooves are clean!`);
        } else if (was <= 0.01 && strength >= 1) this.hint(`The ${name} hoof is already clean.`);
        return true;
      }
      case 'pad': case 'saddle': {
        if (target.type !== 'horse') return false;
        const h = target.horse, T = h.data.tack;
        if (h.mode === 'stall' && !h.tacked()) { /* you can tack up in the stall too */ }
        if (k === 'pad'){ if (T.pad){ this.hint('The pad is already on.'); return false; } h.setTack('pad', true); }
        else { if (!T.pad){ this.hint('Put the saddle pad on first, so the saddle doesn\'t rub.'); return false; } if (T.saddle){ this.hint('The saddle is already on.'); return false; } h.setTack('saddle', true); this.hint('Now do up the girth: touch the girth under the saddle.'); }
        this.release(it); it.mesh.visible = false; it.onHorse = h.data.id;
        sfx.tack(target.point);
        return true;
      }
      case 'bridle': {
        if (target.type !== 'horse' && target.type !== 'head') return false;
        const h = target.horse;
        if (h.data.tack.bridle){ this.hint('The bridle is already on.'); return false; }
        h.setTack('bridle', true); this.release(it); it.mesh.visible = false; it.onHorse = h.data.id;
        sfx.tack(target.point);
        if (!h.data.tack.saddle) this.hint('Bridle on. Now the saddle pad and saddle.');
        else if (h.tacked()) this.hint(`${h.data.name} is tacked up and ready to ride!`);
        return true;
      }
      case 'carrot': {
        if (target.type !== 'horse' && target.type !== 'head' && target.type !== 'pet') return false;
        const h = target.horse;
        if (h){ h.data.needs.happy = Math.min(100, h.data.needs.happy + 6); h.chewT = 3; sfx.crunch(target.point); this.say(`${h.data.name} loves carrots!`, 'good'); }
        else if (target.animal){ target.animal.data.happy = Math.min(100, target.animal.data.happy + 6); sfx.crunch(target.point); }
        this.dropTemp(it);
        return true;
      }
      case 'flake': {
        // in a stall rack (or anywhere in the stall), or a goat/sheep pen feeder
        if (target.type === 'rack' || (target.type === 'stall')){
          const st = F.stalls[target.stall].state;
          if (st.hay >= 4){ this.hint('The rack is full.'); return false; }
          st.hay += 1; F.refreshStall(target.stall); this.dropTemp(it); sfx.hay(target.point);
          const h = F.stalls[target.stall].horse && F.horseById(F.stalls[target.stall].horse); if (h) { h.act = null; h.wait = 0.3; sfx.nicker(h.model.muzzle()); }
          return true;
        }
        if (target.type === 'feeder'){
          const p = F.pens[target.pen];
          if (p.kind === 'pig' || p.kind === 'chicken'){ this.hint(p.kind === 'pig' ? 'Pigs eat pig feed: use the scoop at the feed bins.' : 'Hens eat corn: use the scoop at the feed bins.'); return false; }
          p.feedAmt = Math.min(1, p.feedAmt + 0.35); F.refreshPen(target.pen); this.dropTemp(it); sfx.hay(target.point);
          return true;
        }
        return false;
      }
      case 'scoop': {
        if (target.type === 'bin'){
          const S = this.S.supplies, b = target.bin;
          if (S[b] <= 0){ this.say(`The ${b === 'pigfeed' ? 'pig feed' : b} bin is empty. Buy more at the Farm Office.`); return false; }
          if (it.amount > 0 && it.content !== b){ this.hint('Empty the scoop first.'); return false; }
          if (it.amount > 0) return false;
          S[b]--; it.content = b; it.amount = 1; this.refreshItem(it); sfx.grain(target.point);
          return true;
        }
        if (it.amount <= 0) { if (target.type === 'tub' || target.type === 'feeder') this.hint('The scoop is empty. Fill it at the feed bins in the feed room.'); return false; }
        if (target.type === 'tub' || (target.type === 'stall' && target.near === 'tub')){
          if (it.content !== 'grain'){ this.hint('Horses eat grain, not that!'); return false; }
          const s = F.stalls[target.stall], h = s.horse && F.horseById(s.horse);
          s.state.grain += 1; it.amount = 0; this.refreshItem(it); F.refreshStall(target.stall); sfx.grain(target.point);
          if (h){
            h.data.grainToday = (h.data.grainToday || 0) + 1; h.act = null; h.wait = 0.2; sfx.nicker(h.model.muzzle());
            if (h.data.grainToday > 2){ h.data.needs.health = Math.max(0, h.data.needs.health - 25); this.say(`Too much grain! ${h.data.name} has a tummy ache (colic). Call the vet.`, 'bad'); }
          }
          return true;
        }
        if (target.type === 'feeder'){
          const p = F.pens[target.pen];
          const want = p.kind === 'pig' ? 'pigfeed' : p.kind === 'chicken' ? 'corn' : null;
          if (!want){ this.hint('Goats, sheep and cows eat hay. Bring a flake from the hay stack.'); return false; }
          if (it.content !== want){ this.hint(p.kind === 'pig' ? 'Pigs need pig feed.' : 'Hens need corn.'); return false; }
          p.feedAmt = Math.min(1, p.feedAmt + 0.5); it.amount = 0; this.refreshItem(it); F.refreshPen(target.pen); sfx.grain(target.point);
          return true;
        }
        return false;
      }
      case 'bucket': {
        if (target.type === 'tap'){
          if (it.water >= 20) return false;
          it.water = Math.min(20, it.water + (strength >= 1 ? 20 : strength * 8)); this.refreshItem(it); sfx.water(target.point);
          this.world.fixtures.tap.stream.visible = true; this.fill.t = 0.4;
          return true;
        }
        if (it.water <= 0.5){ if (['stallBucket', 'trough', 'paddockTrough'].includes(target.type)) this.hint('The bucket is empty. Fill it at the tap in the feed room.'); return false; }
        if (target.type === 'stallBucket' || (target.type === 'stall' && target.near === 'bucket')){
          const st = F.stalls[target.stall].state; const room = 20 - st.water; if (room < 0.5){ this.hint('That bucket is full.'); return false; }
          const t = Math.min(room, it.water); st.water += t; it.water -= t; this.refreshItem(it); this.refreshStallBucket(target.stall); sfx.pour(target.point);
          return true;
        }
        if (target.type === 'trough'){
          const p = F.pens[target.pen]; if (p.waterAmt >= 1){ this.hint('The trough is full.'); return false; }
          p.waterAmt = Math.min(1, p.waterAmt + it.water / 40); it.water = 0; this.refreshItem(it); F.refreshPen(target.pen); sfx.pour(target.point);
          return true;
        }
        if (target.type === 'paddockTrough'){ it.water = 0; this.refreshItem(it); sfx.pour(target.point); this.hint('The paddock trough is topped up.'); return true; }
        return false;
      }
      case 'fork': {
        const barrow = this.items.barrow;
        const nearBarrow = (p) => barrow.mesh.position.distanceTo(V(p.x, barrow.mesh.position.y, p.z)) < (target.touch ? 6.5 : 0.7);
        if (target.type === 'barrow' && it.load > 0){ barrow.load += it.load; it.load = 0; this.refreshItem(it); this.refreshItem(barrow); sfx.thud(target.point); return true; }
        if (target.type === 'manure' || target.type === 'wet' || target.type === 'dropping'){
          if (it.load > 0 && !target.touch){ this.hint('Tip the fork into the wheelbarrow first.'); return false; }
          if (target.touch && !nearBarrow(target.point)){ this.hint('Bring the wheelbarrow closer (tap it to push it).'); return false; }
          if (barrow.load >= 14){ this.hint('The wheelbarrow is full. Tip it on the muck heap behind the barn.'); return false; }
          if (target.type === 'manure'){ const st = F.stalls[target.stall].state; st.manure.splice(target.index, 1); F.refreshStall(target.stall); }
          else if (target.type === 'wet'){ const st = F.stalls[target.stall].state; st.wet = Math.max(0, st.wet - 0.5); st.bedding = Math.max(0, st.bedding - 0.15); F.refreshStall(target.stall); }
          else { const p = F.pens[target.pen]; p.saved.droppings.splice(target.index, 1); F.refreshPen(target.pen); }
          if (target.touch){ barrow.load += 1; this.refreshItem(barrow); } else { it.load = 1; this.refreshItem(it); }
          sfx.fork(target.point);
          return true;
        }
        return false;
      }
      case 'barrow': {
        if (target.type === 'heap'){
          if (it.load <= 0){ this.hint('The wheelbarrow is empty.'); return false; }
          it.load = 0; this.refreshItem(it); sfx.dump(target.point); this.hint('Wheelbarrow emptied on the muck heap.');
          return true;
        }
        return false;
      }
      case 'bag': {
        if (target.type === 'stall' || target.type === 'rack' || target.type === 'manure' || target.type === 'wet'){
          const st = F.stalls[target.stall].state;
          if (st.manure.length > 2){ this.hint('Muck out the droppings before adding fresh bedding.'); return false; }
          st.bedding = Math.min(1.2, st.bedding + 0.7); st.wet = Math.max(0, st.wet - 0.2); F.refreshStall(target.stall); this.dropTemp(it); sfx.shavings(target.point);
          this.hint('Fresh shavings spread.');
          return true;
        }
        return false;
      }
      case 'shears': {
        if (target.type !== 'pet' || !target.animal || target.animal.kind !== 'sheep') return false;
        const a = target.animal;
        if (a.data.wool < 0.6){ this.hint(`${a.data.name}'s fleece isn't long enough yet.`); return false; }
        a.data.wool = 0; this.S.supplies.wool = (this.S.supplies.wool || 0) + 1; sfx.shears(target.point);
        this.say(`Sheared ${a.data.name}! Sell the fleece at the Farm Office.`, 'good');
        return true;
      }
    }
    return false;
  }
  hint(t){ if (this.lastHint === t && this.sayT > 0) return; this.lastHint = t; this.sayT = 3; this.farm.say(t, 'hint'); }

  // empty-hand jobs on the horse: do up the girth, take tack off
  girth(h){
    const T = h.data.tack;
    if (!T.saddle){ this.hint('There\'s no saddle on.'); return false; }
    if (T.girth){ this.hint('The girth is already done up.'); return false; }
    h.setTack('girth', true); sfx.tack(h.model.saddlePoint()); this.hint(h.data.tack.bridle ? `${h.data.name} is tacked up and ready to ride!` : 'Girth done up. Now the bridle.');
    return true;
  }
  untack(h, piece){
    const T = h.data.tack;
    const order = { bridle: [], saddle: [], pad: ['saddle'] };
    if (!T[piece]) return null;
    if (order[piece].some((p) => T[p])){ this.hint('Take the saddle off before the pad.'); return null; }
    h.setTack(piece, false);
    const it = this.items[piece];
    it.mesh.visible = true; it.onHorse = null;
    sfx.tack(h.model.saddlePoint());
    return it;
  }

  // ---------- each frame ----------
  update(dt){
    this.sayT -= dt;
    if (this.fill.t > 0){ this.fill.t -= dt; if (this.fill.t <= 0) this.world.fixtures.tap.stream.visible = false; }
    for (const h of this.farm.horses){
      if (h._liftT > 0){ h._liftT -= dt; if (h._liftT <= 0) h.lift = [false, false, false, false]; }
      if (h.chewT > 0){ h.chewT -= dt; h.model.anim.chew += dt * 10; }
    }
    // things left on the floor settle on it
    for (const it of this.pickables()){
      if (it.held || it.homeNow || it.inBarrow || it.carried || it.kind === 'barrow') continue;
      if (it.mesh.position.y > 0.08){ it.fallV = (it.fallV || 0) + 9.8 * dt; it.mesh.position.y = Math.max(0.08, it.mesh.position.y - it.fallV * dt); }
      else it.fallV = 0;
      // lost? (dropped far away) send it home
      if (it.mesh.position.length() > 200){ if (it.temp) this.dropTemp(it); else this.home(it); }
    }
    // tack on a horse: the item stays hidden; if the horse leaves (sold, collected) it comes home
    for (const k of ['pad', 'saddle', 'bridle']){
      const it = this.items[k];
      if (it.onHorse && !this.farm.horseById(it.onHorse)){ it.onHorse = null; it.mesh.visible = true; this.home(it); }
      else if (it.onHorse){ const h = this.farm.horseById(it.onHorse); if (!h.data.tack[k]){ it.onHorse = null; it.mesh.visible = true; if (!it.held) this.home(it); } }
    }
  }
  // which horse (if any) is wearing each piece of tack, from the saved state (after loading)
  syncTack(){
    for (const k of ['pad', 'saddle', 'bridle']){
      const it = this.items[k];
      const h = this.farm.horses.find((x) => x.data.tack[k]);
      if (h){ it.onHorse = h.data.id; it.mesh.visible = false; } else { it.onHorse = null; it.mesh.visible = true; this.home(it); }
    }
  }
}
