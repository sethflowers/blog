// The farm's state and everything that happens over time: the clock, money, supplies, horses and what
// they need, stalls (hay, grain, water, manure, bedding), pens, customers who board animals with you,
// and saving. Also how each horse behaves: in its stall, out in the paddock, tied at the rail, on a lead.
import * as THREE from 'three';
import { V, clamp, lerp, damp, rng, angleDiff, ellipsoid, fmtMoney, vnoise } from './util.js';
import { HorseModel, BREEDS, COATS } from './horse.js';
import { Animal, SPECIES } from './animals.js';
import { Person } from './people.js';
import { BARN, STALL_W, PADDOCK, PENS, PLACES, ARENA, SHOW, pushOut, stallAt, inBox, colliders, worldMaterials } from './world.js';
import { mat } from './textures.js';

export const SAVE_KEY = 'my-animal-farm-save';
export const DAY_START = 6 * 60, NIGHT = 21 * 60;
export const PRICES = { hay: 9, grain: 28, shavings: 8, carrots: 4, pigfeed: 16, corn: 12, farrier: 90, vet: 120 };
export const SUPPLY_UNITS = { hay: 'bales', grain: 'scoops', shavings: 'bags', carrots: 'carrots', pigfeed: 'scoops', corn: 'scoops' };
export const SUPPLY_PACK = { hay: 1, grain: 30, shavings: 1, carrots: 10, pigfeed: 30, corn: 30 };
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const isShowDay = (d) => d % 3 === 0;
export const dayName = (d) => WEEKDAYS[(d - 1) % 7];

const HORSE_NAMES = ['Hazel', 'Biscuit', 'Storm', 'Willow', 'Duke', 'Maple', 'Shadow', 'Poppy', 'Comet', 'Juniper', 'Rocket', 'Honey', 'Ranger', 'Bramble', 'Misty', 'Apollo', 'Clover', 'Dakota', 'Pepper', 'Sable', 'Ziggy', 'Bella', 'Moose', 'Tinker', 'Indigo', 'Fable', 'Rosie', 'Cinder', 'Lucky', 'Penny'];
const CUSTOMER_NAMES = ['Mrs. Alvarez', 'Mr. Chen', 'Dr. Patel', 'The Nguyen family', 'Mrs. O\'Brien', 'Mr. Okafor', 'Ms. Lindqvist', 'Grandpa Joe', 'Mrs. Rossi', 'Mr. Kowalski', 'Ms. Haddad', 'Coach Rivera'];

export function randomHorse(R, opts = {}){
  const d = makeHorse(R, opts);
  // the asking price: breed, a bit of luck, and how well trained it already is
  d.value = Math.round(BREEDS[d.breed].price * (0.8 + R() * 0.5) * (0.9 + d.skill * 0.4) / 50) * 50;
  return d;
}
function makeHorse(R, opts){
  const breeds = Object.keys(BREEDS), coats = Object.keys(COATS);
  const breed = opts.breed || breeds[Math.floor(R() * breeds.length)];
  let coat = opts.coat || coats[Math.floor(R() * coats.length)];
  if (breed === 'friesian') coat = 'black';
  if (breed === 'appaloosa' && R() < 0.7) coat = 'appaloosa';
  if (coat === 'appaloosa' && breed !== 'appaloosa') coat = 'bay';
  const socks = [0, 1, 2, 3].map(() => (R() < 0.35 ? 1 + Math.floor(R() * 3) : 0));
  const face = ['none', 'star', 'stripe', 'blaze', 'snip'][Math.floor(R() * 5)];
  const B = BREEDS[breed];
  return {
    id: 'h' + Math.floor(R() * 1e9).toString(36), name: opts.name || HORSE_NAMES[Math.floor(R() * HORSE_NAMES.length)], breed, coat, socks, face,
    halter: Math.floor(R() * 5), seed: Math.floor(R() * 1e6), age: 4 + Math.floor(R() * 12), sex: R() < 0.5 ? 'mare' : 'gelding',
    skill: clamp(0.15 + R() * 0.35), fitness: 0.5 + R() * 0.3, owner: null,
    needs: { food: 70, water: 70, energy: 90, happy: 70, health: 100 }, hooves: [0.4, 0.4, 0.4, 0.4], shoes: 70 + R() * 30, dirt: 0.3,
    tack: { pad: false, saddle: false, girth: false, bridle: false }, place: 'stall', stall: -1, grainToday: 0, ...opts,
    value: 0,
  };
}

// ---------- a horse: its body (the model) and what it does ----------
export class Horse {
  constructor(data, farm){
    this.data = data; this.farm = farm;
    this.model = new HorseModel({ breed: data.breed, coat: data.coat, socks: data.socks, face: data.face, halter: data.halter, seed: data.seed });
    this.root = this.model.root;
    this.pos = V(); this.yaw = 0; this.speed = 0; this.turn = 0;
    this.mode = 'stall'; this.target = null; this.act = null; this.actT = 0; this.wait = 1;
    this.neck = 0; this.chewing = false; this.alert = false; this.rest = false; this.headYaw = 0;
    this.leader = null; this.tie = null; this.control = null;
    this.lift = [0, 0, 0, 0];
    this.model.setTack({ halter: true, ...data.tack });
    if (data.dirt > 0) this.model.addDirt(data.dirt * 1.3, 'all', data.seed % 97);
    this.manureT = 60 + Math.random() * 120;
  }
  get breed(){ return BREEDS[this.data.breed]; }
  get stall(){ return this.data.stall >= 0 ? this.farm.stalls[this.data.stall] : null; }
  tacked(){ const t = this.data.tack; return t.pad && t.saddle && t.girth && t.bridle; }
  setTack(k, v){ this.data.tack[k] = v; if (k === 'saddle' && !v) this.data.tack.girth = false; this.model.setTack({ [k]: v, girth: this.data.tack.girth }); }

  // put the horse somewhere
  toStall(i){
    const s = this.farm.stalls[i];
    if (this.stall && this.stall.horse === this.data.id && this.data.stall !== i) this.stall.horse = null;
    this.data.stall = i; s.horse = this.data.id;
    this.mode = 'stall'; this.data.place = 'stall'; this.leader = null; this.tie = null;
    if (!inBox(this.pos, this.stallBox(), 0.2)) { this.pos.copy(s.center); this.yaw = s.side > 0 ? -Math.PI / 2 : Math.PI / 2; }
    this.target = null; this.wait = 0.5;
    this.farm.refreshStall(i);
  }
  toPaddock(){ this.mode = 'paddock'; this.data.place = 'paddock'; this.leader = null; this.tie = null; this.target = null; this.wait = 1; }
  tieAt(point, yaw){ this.mode = 'tied'; this.data.place = 'tied'; this.tie = { pos: point.clone(), yaw }; this.leader = null; }
  stallBox(){
    const s = this.stall; if (!s) return null;
    const x0 = Math.min(s.xa, s.xb), x1 = Math.max(s.xa, s.xb);
    return { x0: x0 + 0.75, x1: x1 - 0.75, z0: s.zb + 0.85, z1: s.za - 0.85 };
  }

  update(dt, ctx){
    const D = this.data, N = D.needs;
    let speed = 0, turn = 0;
    this.chewing = false; this.alert = false; this.rest = false;
    let neck = 0, headYaw = 0;
    const playerD = ctx.player ? Math.hypot(ctx.player.x - this.pos.x, ctx.player.z - this.pos.z) : 99;
    const lookAtPlayer = () => {
      if (playerD < 6){ const a = Math.atan2(ctx.player.x - this.pos.x, ctx.player.z - this.pos.z); headYaw = clamp(angleDiff(this.yaw, a), -1, 1); this.alert = true; }
    };
    const goTo = (p, maxSpeed = 1.2, stopAt = 0.15) => {
      const dx = p.x - this.pos.x, dz = p.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d < stopAt) return true;
      const want = Math.atan2(dx, dz), da = angleDiff(this.yaw, want);
      turn = clamp(da * 2, -1.2, 1.2);
      speed = Math.min(maxSpeed, d * 1.2) * (Math.abs(da) < 0.8 ? 1 : 0.25);
      return false;
    };
    const faceTo = (yaw) => { const da = angleDiff(this.yaw, yaw); turn = clamp(da * 2, -1, 1); return Math.abs(da) < 0.1; };

    switch (this.mode){
      case 'stall': {
        const s = this.stall, box = this.stallBox();
        this.wait -= dt;
        if (!this.act && this.wait <= 0){
          // choose: hay, grain, water, look out over the door, doze
          const hungry = N.food < 96, thirsty = N.water < 92;
          if (s.state.grain > 0) this.act = 'grain';
          else if (thirsty && s.state.water > 0.5 && Math.random() < 0.5) this.act = 'water';
          else if (hungry && s.state.hay > 0) this.act = 'hay';
          else this.act = Math.random() < 0.5 ? 'door' : 'doze';
          this.actT = 6 + Math.random() * 14;
        }
        if (this.act){
          const sd = s.side, P = this.farm.stallSpots(s);
          const spot = P[this.act];
          if (spot){
            if (goTo(spot.pos, 0.9)){
              if (faceTo(spot.yaw)){
                if (this.act === 'hay' && s.state.hay > 0){ neck = 0.25; this.chewing = true; }
                if (this.act === 'grain' && s.state.grain > 0){ neck = 0.75; this.chewing = true; }
                if (this.act === 'water' && s.state.water > 0){ neck = 0.5; }
                if (this.act === 'door'){ lookAtPlayer(); }
                if (this.act === 'doze'){ this.rest = true; neck = 0.25; }
                this.actT -= dt;
              }
            }
          } else this.actT = 0;
          if (this.actT <= 0 || (this.act === 'hay' && s.state.hay <= 0) || (this.act === 'grain' && s.state.grain <= 0)){ this.act = null; this.wait = 1 + Math.random() * 3; }
          if (playerD < 2.5 && (this.act === 'doze')) { this.act = 'door'; }
        }
        // stay inside the stall
        if (box){ this.pos.x = clamp(this.pos.x, box.x0, box.x1); this.pos.z = clamp(this.pos.z, box.z0, box.z1); }
        break;
      }
      case 'paddock': {
        this.wait -= dt;
        if (!this.target && this.wait <= 0){
          const r = Math.random();
          if (N.water < 70 && r < 0.4){ this.target = V(PLACES.paddockGate.x - 3, 0, -7.9); this.act = 'drink'; }
          else { this.target = V(lerp(PADDOCK.x0 + 3, PADDOCK.x1 - 3, Math.random()), 0, lerp(PADDOCK.z0 + 3, PADDOCK.z1 - 3, Math.random())); this.act = 'wander'; }
        }
        if (this.target){
          if (goTo(this.target, this.act === 'wander' && Math.random() < 0.002 ? 3 : 1.2, 0.5)){ this.target = null; this.wait = 5 + Math.random() * 20; this.graze = this.act === 'wander'; }
        }
        if (!this.target){ if (this.graze){ neck = 1; this.chewing = true; } else { neck = 0.5; } if (playerD < 4) lookAtPlayer(); }
        this.pos.x = clamp(this.pos.x, PADDOCK.x0 + 1.2, PADDOCK.x1 - 1.2); this.pos.z = clamp(this.pos.z, PADDOCK.z0 + 1.2, PADDOCK.z1 - 1.2);
        break;
      }
      case 'tied': {
        goTo(this.tie.pos, 0.8, 0.1) && faceTo(this.tie.yaw);
        lookAtPlayer();
        if (playerD > 3) this.rest = true;
        break;
      }
      case 'led': {
        // follow the person leading, a little behind and to the side
        const L = this.leader;
        if (L){
          let lp = L.pos;
          // in and out of stalls: go through the doorway, not the wall
          const inS = stallAt(this.pos), leadS = stallAt(lp);
          const st = inS >= 0 ? this.farm.stalls[inS] : leadS >= 0 ? this.farm.stalls[leadS] : null;
          if (st && inS !== leadS){
            const out = V(st.front - st.side * 1.1, 0, st.center.z), inn = V(st.front + st.side * 0.9, 0, st.center.z);
            const offLine = Math.abs(this.pos.z - st.center.z) > 0.35;
            if (inS >= 0) lp = offLine && Math.abs(this.pos.x - st.front) > 0.6 ? inn : out.clone().add(V(-st.side * 1.2, 0, 0));
            else lp = offLine || Math.abs(this.pos.x - st.front) > 1.6 ? out : inn.clone().add(V(st.side * 1.0, 0, 0));
            if (inS >= 0 && Math.abs(this.pos.x - st.front) > 0.6 && offLine){ goTo(lp, 1.0, 0.1); break; }
            goTo(lp, 1.2, 0.1); break;
          }
          const d = Math.hypot(lp.x - this.pos.x, lp.z - this.pos.z);
          const muzzleD = 1.25;   // the horse's head is ahead of its body
          if (d > muzzleD + 0.6){ goTo(lp, Math.min(4.5, 0.8 + (d - muzzleD) * 1.6), muzzleD); }
          else { const a = Math.atan2(lp.x - this.pos.x, lp.z - this.pos.z); faceTo(a); }
          headYaw = clamp(angleDiff(this.yaw, Math.atan2(lp.x - this.pos.x, lp.z - this.pos.z)), -0.8, 0.8);
        }
        break;
      }
      case 'loose': {
        neck = 1; this.chewing = Math.random() < 0.5;
        lookAtPlayer();
        break;
      }
      case 'ridden': case 'show': {
        const c = this.control || { speed: 0, turn: 0 };
        speed = c.speed; turn = c.turn; neck = c.neck || 0;
        break;
      }
      case 'away': break;
    }
    // a hoof is held up while it's being picked
    for (let i = 0; i < 4; i++){ this.model.anim.lift[i] = damp(this.model.anim.lift[i], this.lift[i] ? 1 : 0, 6, dt); }
    if (this.lift.some((x) => x)){ speed = 0; turn = 0; }
    // move
    if (this.mode !== 'ridden' && this.mode !== 'show'){ this.speed = damp(this.speed, speed, 4, dt); this.turn = turn; }
    else { this.speed = speed; this.turn = turn; }
    this.yaw += this.turn * dt;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    this.pos.x += fx * this.speed * dt; this.pos.z += fz * this.speed * dt;
    // bump into walls and fences: body, chest and quarters
    if (this.mode !== 'stall' && this.mode !== 'away' && !(this.model.jumping)){
      const s = this.model.scale;
      const pts = [0, 0.75 * s, -0.75 * s].map((o) => V(this.pos.x + fx * o, 0, this.pos.z + fz * o));
      let cx = 0, cz = 0;
      for (const p of pts){ const q = p.clone(); pushOut(q, 0.36 * s, { ignore: this.ignoreCollider }); cx += q.x - p.x; cz += q.z - p.z; }
      if (cx || cz){ this.pos.x += cx; this.pos.z += cz; this.bumped = true; } else this.bumped = false;
    }
    this.neck = neck; this.headYaw = headYaw;
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    this.model.animate(dt, { speed: this.speed, turn: this.turn, neck, headYaw, chewing: this.chewing, alert: this.alert, rest: this.rest });
    this.model.updateReins(this.reinHands || null);
  }
}

// ---------- the farm ----------
export class Farm {
  constructor(scene, world){
    this.scene = scene; this.world = world;
    this.stalls = world.stalls.map((s) => ({ ...s, horse: null, state: { hay: 0, grain: 0, water: 20, manure: [], wet: 0, bedding: 1 }, manureMeshes: [], wetMesh: null }));
    this.horses = []; this.animals = [];
    this.pens = world.pens.map((p) => ({ ...p, feedAmt: 0, waterAmt: 0, list: [], droppingMeshes: [], eggs: 0, eggMeshes: [] }));
    this.offers = []; this.visitors = [];
    this.messages = [];
    this.listeners = {};
    this.manureG = (() => {
      // a pile of droppings: a few lumpy balls
      const parts = []; const R = rng(3);
      for (let i = 0; i < 6; i++){ const g = ellipsoid(0.055, 0.045, 0.05, 8, 6); g.translate((R() - 0.5) * 0.16, 0.03 + (i > 3 ? 0.04 : 0), (R() - 0.5) * 0.16); parts.push(g); }
      return parts;
    })();
    this.manureMat = mat('dirt', { color: 0x6a5434, rough: 0.7 });
    this.wetMat = new THREE.MeshStandardMaterial({ color: 0x5a4a30, roughness: 0.6, transparent: true, opacity: 0.55, depthWrite: false });
  }
  on(ev, f){ (this.listeners[ev] = this.listeners[ev] || []).push(f); }
  emit(ev, a){ for (const f of this.listeners[ev] || []) f(a); }
  say(text, kind = 'info'){ this.messages.push({ text, kind, t: 4.5 }); this.emit('say', { text, kind }); }

  // ---------- new game / load / save ----------
  newGame(){
    const R = rng(Date.now() % 100000);
    this.state = {
      v: 1, day: 1, minutes: 7 * 60, money: 3000, earned: 0,
      supplies: { hay: 10, grain: 40, shavings: 5, carrots: 12, pigfeed: 0, corn: 30, eggs: 0, wool: 0 },
      horses: [randomHorse(rng(11), { name: 'Hazel', breed: 'warmblood', coat: 'bay', socks: [0, 0, 1, 0], face: 'star', skill: 0.3, sex: 'mare', age: 8 })],
      stalls: this.stalls.map(() => ({ hay: 0, grain: 0, water: 6, manure: [], wet: 0.3, bedding: 0.7 })),
      animals: [], pens: this.pens.map((p) => ({ feed: 0.3, water: 0.4, droppings: [], eggs: 0 })),
      offers: [], ribbons: [], market: null, marketDay: 0, nextOfferDay: 1, log: [], shows: {}, farrierDay: 0,
      tutorial: 0,
    };
    const h = this.state.horses[0]; h.stall = 0; h.needs = { food: 45, water: 40, energy: 90, happy: 65, health: 100 }; h.dirt = 0.5; h.hooves = [0.7, 0.7, 0.6, 0.6];
    this.state.stalls[0].manure = [[0.6, 0.8], [-0.4, -0.9], [0.9, -0.3]];
    this.state.animals.push(...[0, 1].map((i) => new Animal('goat', { variant: i, seed: 100 + i }).data));
    this.state.animals.push(...[0, 1, 2, 3].map((i) => new Animal('chicken', { variant: i, seed: 200 + i }).data));
    this.build();
  }
  load(){
    try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (s && s.v === 1){ this.state = s; this.build(); return true; } } catch (e) {}
    return false;
  }
  save(){
    if (!this.state) return;
    for (const h of this.horses){ h.data.dirt = clamp(h.model.dirtiness() * 1.4); }
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.state)); } catch (e) {}
  }
  // make the 3D world match the saved state
  build(){
    for (const h of this.horses) this.scene.remove(h.root);
    for (const a of this.animals) this.scene.remove(a.root);
    this.horses = []; this.animals = [];
    for (const p of this.pens){ p.list = []; }
    this.stalls.forEach((s, i) => { s.state = this.state.stalls[i]; s.horse = null; });
    this.pens.forEach((p, i) => { const ps = this.state.pens[i]; p.saved = ps; p.feedAmt = ps.feed; p.waterAmt = ps.water; });
    for (const d of this.state.horses) this.addHorse(d);
    for (const d of this.state.animals) this.addAnimal(d);
    this.stalls.forEach((s, i) => this.refreshStall(i));
    this.pens.forEach((p, i) => this.refreshPen(i));
    this.refreshSupplies();
    this.refreshRibbons();
    this.spawnVisitors();
  }
  addHorse(d){
    const h = new Horse(d, this);
    this.horses.push(h);
    this.scene.add(h.root);
    if (d.place === 'paddock'){ h.pos.set(-20 - Math.random() * 10, 0, -10 - Math.random() * 10); h.toPaddock(); if (d.stall >= 0) this.stalls[d.stall].horse = d.id; }
    else if (d.place === 'away'){ h.mode = 'away'; h.root.visible = false; }
    else {
      let i = d.stall;
      if (i < 0 || (this.stalls[i].horse && this.stalls[i].horse !== d.id)) i = this.freeStall();
      if (i < 0){ h.pos.set(-20, 0, -10); h.toPaddock(); }
      else { h.pos.copy(this.stalls[i].center); h.yaw = this.stalls[i].side > 0 ? -Math.PI / 2 : Math.PI / 2; h.toStall(i); }
    }
    h.root.position.copy(h.pos);
    h.model.onStep = (i, gait) => this.emit('hoof', { horse: h, i, gait });
    return h;
  }
  addAnimal(d){
    const a = new Animal(d.kind, d);
    a.data = d;
    const pen = this.pens.find((p) => p.kind === d.kind);
    a.place(pen); pen.list.push(a);
    this.animals.push(a);
    this.scene.add(a.root);
    return a;
  }
  freeStall(){ return this.stalls.findIndex((s) => !s.horse); }
  horseById(id){ return this.horses.find((h) => h.data.id === id); }
  penCapacity(kind){ return kind === 'chicken' ? 12 : 6; }

  // where in a stall a horse stands to eat hay, grain, drink, look out
  stallSpots(s){
    if (s._spots) return s._spots;
    const sd = s.side, xIn = sd * (BARN.x1 - 1.7);
    const rack = s.rackPos, tub = s.tubPos, hook = s.hookPos;
    const at = (x, z, tx, tz) => ({ pos: V(x, 0, z), yaw: Math.atan2(tx - x, tz - z) });
    s._spots = {
      hay: at(sd * (BARN.x1 - 1.55), s.zb + 1.2, rack.x, rack.z),
      grain: at(sd * (BARN.x1 - 1.6), s.za - 1.25, tub.x, tub.z),
      water: at(sd * (BARN.aisle + 1.3), s.za - 1.35, hook.x, hook.z),
      door: at(sd * (BARN.aisle + 1.35), s.center.z - 0.2, sd * BARN.aisle - sd, s.center.z),
      doze: at(s.center.x, s.center.z, s.center.x + sd, s.center.z + 0.6),
    };
    return s._spots;
  }

  // ---------- visuals of the stall's state ----------
  refreshStall(i){
    const s = this.stalls[i], st = s.state;
    // hay in the rack, grain in the tub
    s.rackHay.visible = st.hay > 0.05; s.rackHay.scale.y = clamp(st.hay / 3, 0.15, 1.3); s.rackHay.position.y = s.rackPos.y - 0.4 + 0.25 * s.rackHay.scale.y;
    s.grain.visible = st.grain > 0.02; s.grain.position.y = -0.1 + Math.min(1, st.grain) * 0.06;
    // manure piles
    for (const m of s.manureMeshes) this.scene.remove(m);
    s.manureMeshes = st.manure.map(([x, z], k) => {
      const m = new THREE.Group();
      for (const g of this.manureG) { const mm = new THREE.Mesh(g, this.manureMat); mm.castShadow = true; m.add(mm); }
      m.position.set(s.center.x + x, 0.12, s.center.z + z); m.rotation.y = k * 2.1;
      m.userData = { kind: 'manure', stall: i, index: k };
      this.scene.add(m);
      return m;
    });
    // wet patch and how fresh the bedding looks
    if (!s.wetMesh){ s.wetMesh = new THREE.Mesh(new THREE.CircleGeometry(0.6, 20), this.wetMat.clone()); s.wetMesh.rotation.x = -Math.PI / 2; s.wetMesh.position.set(s.center.x + s.side * 0.5, 0.135, s.center.z - 0.5); s.wetMesh.userData = { kind: 'wet', stall: i }; this.scene.add(s.wetMesh); }
    s.wetMesh.visible = st.wet > 0.08; s.wetMesh.material.opacity = clamp(st.wet) * 0.75; s.wetMesh.scale.setScalar(0.6 + st.wet * 0.8);
    const fresh = clamp(st.bedding);
    s.bed.material.color.setRGB(0.55 + fresh * 0.45, 0.5 + fresh * 0.5, 0.42 + fresh * 0.58);
    s.bed.scale.y = 0.3 + fresh * 0.9; s.bed.position.y = 0.01 + 0.06 * s.bed.scale.y;
    // name plate
    const h = s.horse ? this.horseById(s.horse) : null;
    const tc = s.plate.userData.canvas, g = tc.ctx, W = tc.canvas.width, H = tc.canvas.height;
    g.fillStyle = '#2a1a10'; g.fillRect(0, 0, W, H); g.strokeStyle = '#c8a050'; g.lineWidth = 10; g.strokeRect(5, 5, W - 10, H - 10);
    g.fillStyle = '#f0d890'; g.font = 'bold 84px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(h ? h.data.name : `Stall ${i + 1}`, W / 2, H / 2 + 4); tc.tex.needsUpdate = true;
    // water bucket level is drawn by the items module (the bucket lives there)
    this.emit('stall', i);
  }
  refreshPen(i){
    const p = this.pens[i];
    p.feed.visible = p.feedAmt > 0.02; p.feed.scale.y = 1; p.feed.position.y = 0.36 + clamp(p.feedAmt) * 0.08;
    p.water.visible = p.waterAmt > 0.02; p.water.position.y = 0.1 + clamp(p.waterAmt) * 0.36;
    for (const m of p.droppingMeshes) this.scene.remove(m);
    p.droppingMeshes = p.saved.droppings.map(([x, z], k) => {
      const g = new THREE.Group();
      const n = p.kind === 'chicken' ? 2 : p.kind === 'pig' ? 5 : 4;
      for (let j = 0; j < n; j++){ const mm = new THREE.Mesh(this.manureG[j], this.manureMat); mm.scale.setScalar(p.kind === 'pig' ? 1 : 0.55); g.add(mm); }
      g.position.set(x, 0.0, z); g.userData = { kind: 'dropping', pen: i, index: k }; this.scene.add(g); return g;
    });
    for (const m of p.eggMeshes) this.scene.remove(m);
    p.eggMeshes = [];
    if (p.kind === 'chicken'){
      const em = mat('plain-egg', { color: 0xf2e6d0, rough: 0.4 });
      for (let k = 0; k < p.saved.eggs; k++){
        const e = new THREE.Mesh(ellipsoid(0.022, 0.03, 0.022, 10, 8), em);
        e.position.set((p.x0 + p.x1) / 2 - 1.95 + (k % 4) * 0.08 - 0.12, 1.33, p.z0 + 1.6 + Math.floor(k / 4) * 0.08 - 0.08);
        e.userData = { kind: 'eggs', pen: i }; this.scene.add(e); p.eggMeshes.push(e);
      }
    }
    this.emit('pen', i);
  }
  refreshSupplies(){
    const S = this.state.supplies, fx = this.world.fixtures;
    fx.hayStack.bales.forEach((b, k) => { b.visible = k < S.hay; });
    fx.shavings.bags.forEach((b, k) => { b.visible = k < S.shavings; });
    this.emit('supplies');
  }
  refreshRibbons(){
    const g = this.world.fixtures.ribbonGroup;
    while (g.children.length) g.remove(g.children[0]);
    const cols = [0x2050c0, 0xc02020, 0xf0f0f0, 0xf0d020];
    this.state.ribbons.slice(-15).forEach((r, k) => {
      const c = cols[(r.place - 1) % 4];
      const rosette = new THREE.Group();
      const m = mat('plain-ribbon' + r.place, { color: c, rough: 0.6, side: THREE.DoubleSide });
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.01, 18), m); disc.rotation.x = Math.PI / 2; rosette.add(disc);
      const mid = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.015, 12), mat('plain-gold', { color: 0xf0c040, rough: 0.3, metal: 0.6 })); mid.rotation.x = Math.PI / 2; mid.position.z = 0.01; rosette.add(mid);
      for (const sx of [-1, 1]){ const tail = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 0.14), m); tail.position.set(sx * 0.025, -0.1, 0); tail.rotation.z = sx * 0.2; rosette.add(tail); }
      const bp = this.world.fixtures.ribbonBoard.pos;
      rosette.position.set(bp.x - 0.7 + (k % 5) * 0.35, bp.y + 0.3 - Math.floor(k / 5) * 0.35, bp.z + 0.03);
      g.add(rosette);
    });
  }

  // ---------- time passing ----------
  // called every frame with game minutes passed
  tick(dtMin, realDt, ctx){
    const S = this.state;
    const prevMin = S.minutes;
    S.minutes += dtMin;
    const h = dtMin / 60;
    for (const horse of this.horses) this.horseNeeds(horse, h, dtMin);
    this.pens.forEach((p, i) => this.penNeeds(p, i, h));
    // events on the hour
    if (Math.floor(prevMin / 60) !== Math.floor(S.minutes / 60)) this.hourly(Math.floor(S.minutes / 60));
    if (S.minutes >= 24 * 60){ this.newDay(); }
  }
  horseNeeds(horse, h, dtMin){
    const D = horse.data, N = D.needs;
    if (D.place === 'away') return;
    const stall = horse.stall && horse.mode === 'stall' ? horse.stall : null;
    // eating: hay from the rack, grain from the tub (only while the horse is actually there and chewing)
    if (stall){
      const st = stall.state;
      if (horse.act === 'hay' && horse.chewing && st.hay > 0){ const e = Math.min(st.hay, h * 0.6); st.hay -= e; N.food = Math.min(100, N.food + e * 16); if (Math.random() < h * 3) this.refreshStall(D.stall); }
      if (horse.act === 'grain' && horse.chewing && st.grain > 0){ const e = Math.min(st.grain, h * 4); st.grain -= e; N.food = Math.min(100, N.food + e * 14); N.energy = Math.min(100, N.energy + e * 12); if (st.grain <= 0) this.refreshStall(D.stall); }
      if (horse.act === 'water' && st.water > 0 && horse.speed < 0.1){ const e = Math.min(st.water, h * 24); st.water -= e; N.water = Math.min(100, N.water + e * 2.6); this.emit('stall', D.stall); }
      // making a mess: manure every couple of hours, and a wet patch
      horse.manureT -= dtMin;
      if (horse.manureT <= 0){
        horse.manureT = 120 + Math.random() * 80;
        if (st.manure.length < 14){
          const b = horse.stallBox(), back = V(-Math.sin(horse.yaw) * 1.0, 0, -Math.cos(horse.yaw) * 1.0);
          const x = clamp(horse.pos.x + back.x + (Math.random() - 0.5) * 0.3, b.x0 - 0.6, b.x1 + 0.6) - stall.center.x, z = clamp(horse.pos.z + back.z, b.z0 - 0.6, b.z1 + 0.6) - stall.center.z;
          st.manure.push([+x.toFixed(2), +z.toFixed(2)]);
          this.refreshStall(D.stall);
        }
      }
      st.wet = Math.min(1, st.wet + h * 0.035);
      st.bedding = Math.max(0, st.bedding - h * 0.012);
      D.hooves = D.hooves.map((x) => Math.min(1, x + h * (0.02 + st.wet * 0.02 + st.manure.length * 0.002)));
      N.energy = Math.min(100, N.energy + h * 6);
      N.happy = clamp(N.happy - h * (0.6 + (st.manure.length > 5 ? 1.5 : 0) + (st.wet > 0.6 ? 1 : 0)), 0, 100);
    } else if (horse.mode === 'paddock'){
      if (horse.chewing) N.food = Math.min(100, N.food + h * 5);
      N.happy = Math.min(100, N.happy + h * 5);
      N.energy = Math.min(100, N.energy + h * 4);
      if (horse.act === 'drink' && !horse.target){ N.water = Math.min(100, N.water + h * 40); }
      horse.manureT -= dtMin; if (horse.manureT <= 0) horse.manureT = 120 + Math.random() * 80;
      // horses love to roll in the paddock (and come back dusty)
      if (Math.random() < h * 0.35){ horse.model.addDirt(0.35, 'roll'); this.emit('roll', horse); }
      else if (Math.random() < h * 1.2) horse.model.addDirt(0.05, 'legs');
      D.hooves = D.hooves.map((x) => Math.min(1, x + h * 0.03));
    } else {
      N.energy = Math.min(100, N.energy + h * 2);
    }
    // everyone gets hungry and thirsty
    N.food = Math.max(0, N.food - h * 3.2);
    N.water = Math.max(0, N.water - h * 4.2);
    // health suffers from neglect
    let hurt = 0;
    if (N.food < 15) hurt += 2; if (N.water < 15) hurt += 3;
    if (D.hooves.some((x) => x > 0.85)) hurt += 0.5;
    if (stall && stall.state.manure.length > 9) hurt += 0.5;
    if (D.shoes < 15) hurt += 0.6;
    N.health = clamp(N.health - hurt * h + (hurt === 0 ? h * 0.8 : 0), 0, 100);
    if (N.food < 30 || N.water < 30) N.happy = Math.max(0, N.happy - h * 3);
  }
  penNeeds(p, i, h){
    if (!p.list.length) return;
    for (const a of p.list){
      const D = a.data;
      D.food = Math.max(0, D.food - h * 3.5); D.water = Math.max(0, D.water - h * 4.5);
      D.happy = clamp(D.happy + h * ((D.food > 40 && D.water > 40 ? 0.8 : -2) - (p.saved.droppings.length > 6 ? 1.5 : 0)), 0, 100);
      let hurt = (D.food < 15 ? 2 : 0) + (D.water < 15 ? 3 : 0) + (p.saved.droppings.length > 12 ? 0.5 : 0);
      D.health = clamp(D.health - hurt * h + (hurt === 0 ? h * 0.6 : 0), 0, 100);
      if (a.kind === 'sheep') D.wool = Math.min(1, D.wool + h * 0.004);
    }
    // droppings now and then
    p.dropT = (p.dropT || 0) - h * p.list.length;
    if (p.dropT <= 0){
      p.dropT = p.kind === 'chicken' ? 6 : 4;
      if (p.saved.droppings.length < 20){
        const a = p.list[Math.floor(Math.random() * p.list.length)];
        p.saved.droppings.push([+(a.pos.x + (Math.random() - 0.5) * 0.4).toFixed(2), +(a.pos.z - 0.4).toFixed(2)]);
        this.refreshPen(i);
      }
    }
    p.saved.feed = p.feedAmt; p.saved.water = p.waterAmt;
  }
  hourly(hour){
    const S = this.state;
    // the morning: hens lay, customers come by
    if (hour === 8){
      this.pens.forEach((p, i) => { if (p.kind === 'chicken' && p.list.length){ const laid = p.list.filter((a) => a.data.food > 30 && a.data.water > 30 && Math.random() < 0.85).length; p.saved.eggs = Math.min(16, p.saved.eggs + laid); this.refreshPen(i); if (laid) this.say(`The hens laid ${laid} egg${laid > 1 ? 's' : ''}.`); } });
    }
    if (hour === 9) this.morningVisitors();
    if (hour === 17) this.eveningCheck();
    if (hour === NIGHT / 60) this.say('It\'s getting dark. Give the horses their evening hay, then go to bed (Farm Office > Sleep).');
    this.save();
  }
  newDay(){
    const S = this.state;
    S.minutes -= 24 * 60; S.day++;
    this.dailyPay();
    for (const h of this.horses){ h.data.shoes = Math.max(0, h.data.shoes - 2.5); h.data.grainToday = 0; }
  }
  // sleeping: skip to 6am, with the night passing for everyone (they eat what you left them)
  sleep(){
    const S = this.state;
    if (S.minutes < 18 * 60 && S.minutes >= DAY_START){ this.say('It\'s too early to go to bed.'); return false; }
    // bring horses in from outside first? Horses left out stay out (that's fine on a summer night)
    let mins = S.minutes < DAY_START ? DAY_START - S.minutes : 24 * 60 - S.minutes + DAY_START;
    const step = 30;
    while (mins > 0){
      const m = Math.min(step, mins); mins -= m;
      for (const horse of this.horses){
        // overnight they eat and drink what's there
        const st = horse.stall && horse.mode === 'stall' ? horse.stall.state : null, N = horse.data.needs;
        if (st){
          if (st.hay > 0 && N.food < 96){ horse.act = 'hay'; horse.chewing = true; } else if (st.water > 0 && N.water < 92){ horse.act = 'water'; horse.speed = 0; } else horse.act = null;
        }
        this.horseNeeds(horse, m / 60, m);
        horse.act = null; horse.chewing = false;
      }
      this.pens.forEach((p, i) => {
        // pen animals eat and drink from the troughs overnight
        for (const a of p.list){ if (p.feedAmt > 0 && a.data.food < 90){ const e = Math.min(p.feedAmt, 0.01 * m / 30); p.feedAmt -= e; a.data.food = Math.min(100, a.data.food + e * 600); } if (p.waterAmt > 0 && a.data.water < 90){ const e = Math.min(p.waterAmt, 0.012 * m / 30); p.waterAmt -= e; a.data.water = Math.min(100, a.data.water + e * 600); } }
        this.penNeeds(p, i, m / 60);
      });
      S.minutes += m;
      if (S.minutes >= 24 * 60) this.newDay();
    }
    S.minutes = DAY_START;
    this.stalls.forEach((s, i) => this.refreshStall(i)); this.pens.forEach((p, i) => this.refreshPen(i));
    // horses that were tied up or loose overnight get put back by the farmhand (and you lose a bit of happiness)
    for (const h of this.horses){
      if (h.mode === 'tied' || h.mode === 'loose' || h.mode === 'led'){ const i = h.data.stall >= 0 ? h.data.stall : this.freeStall(); if (i >= 0){ h.toStall(i); h.pos.copy(this.stalls[i].center); h.data.needs.happy -= 10; } }
      // tack left on overnight
      if (h.data.tack.saddle || h.data.tack.bridle){ for (const k of ['pad', 'saddle', 'girth', 'bridle']) h.setTack(k, false); this.say(`The farmhand took ${h.data.name}'s tack off overnight.`); this.emit('tackHome'); }
    }
    this.spawnVisitors();
    this.save();
    this.emit('morning');
    return true;
  }
  // boarders pay each day for the care they got
  dailyPay(){
    const S = this.state;
    let total = 0;
    const lines = [];
    for (const h of this.horses){
      const D = h.data; if (!D.owner) continue;
      const score = careScore(D.needs, h.model.dirtiness(), D.hooves, h.stall ? h.stall.state : null);
      const pay = Math.round(D.owner.rate * (0.4 + 0.6 * score));
      D.owner.paid = (D.owner.paid || 0) + pay; D.owner.scores = [...(D.owner.scores || []), score]; D.owner.daysLeft--;
      total += pay; lines.push(`${D.name}: ${fmtMoney(pay)} (${Math.round(score * 100)}% care)`);
    }
    for (const a of this.animals){
      const D = a.data; if (!D.owner) continue;
      const pen = this.pens.find((p) => p.kind === a.kind);
      const score = clamp((D.food + D.water + D.happy + D.health) / 400 - pen.saved.droppings.length * 0.02);
      const pay = Math.round(D.owner.rate * (0.4 + 0.6 * score));
      D.owner.paid = (D.owner.paid || 0) + pay; D.owner.scores = [...(D.owner.scores || []), score]; D.owner.daysLeft--;
      total += pay; lines.push(`${D.name}: ${fmtMoney(pay)}`);
    }
    if (total > 0){ S.money += total; S.earned += total; this.say(`Boarding paid ${fmtMoney(total)} for yesterday.`, 'money'); this.emit('money', total); }
  }
  eveningCheck(){
    const hungry = this.horses.filter((h) => h.mode === 'stall' && h.stall && h.stall.state.hay < 1).map((h) => h.data.name);
    if (hungry.length) this.say(`Evening feed: ${hungry.join(', ')} ${hungry.length > 1 ? 'need' : 'needs'} hay in the rack.`);
  }

  // ---------- customers ----------
  morningVisitors(){
    const S = this.state;
    // someone collecting an animal whose stay is over
    for (const h of this.horses) if (h.data.owner && h.data.owner.daysLeft <= 0 && !this.offers.some((o) => o.pickup === h.data.id)) this.offers.push({ id: 'p' + h.data.id, pickup: h.data.id, who: h.data.owner.who, kind: 'horse' });
    for (const a of this.animals) if (a.data.owner && a.data.owner.daysLeft <= 0 && !this.offers.some((o) => o.pickup === a.data.id)) this.offers.push({ id: 'p' + a.data.id, pickup: a.data.id, who: a.data.owner.who, kind: a.kind });
    // a new customer, sometimes
    if (S.day >= S.nextOfferDay && Math.random() < 0.8 && !this.offers.some((o) => !o.pickup)){
      const R = rng(S.day * 31 + 7);
      const horse = R() < 0.6 && this.freeStall() >= 0;
      const kinds = ['goat', 'sheep', 'pig', 'chicken'].filter((k) => this.pens.find((p) => p.kind === k).list.length < this.penCapacity(k));
      const days = 2 + Math.floor(R() * 4), who = CUSTOMER_NAMES[Math.floor(R() * CUSTOMER_NAMES.length)];
      if (horse){
        const d = randomHorse(R, {}); d.needs = { food: 60, water: 60, energy: 80, happy: 70, health: 100 }; d.dirt = 0.25 + R() * 0.3;
        const rate = Math.round((45 + R() * 40) / 5) * 5;
        this.offers.push({ id: 'o' + S.day, kind: 'horse', who, days, rate, horse: d });
      } else if (kinds.length){
        const kind = kinds[Math.floor(R() * kinds.length)];
        const n = kind === 'chicken' ? 3 + Math.floor(R() * 3) : 1 + Math.floor(R() * 2);
        const rate = SPECIES[kind].board * n;
        this.offers.push({ id: 'o' + S.day, kind, n, who, days, rate });
      }
      S.nextOfferDay = S.day + 1;
    }
    this.spawnVisitors();
    if (this.offers.length) this.say(`${this.offers[0].who} has arrived by the house.`);
  }
  // people (and their trailer) waiting by the house
  spawnVisitors(){
    for (const v of this.visitors){ this.scene.remove(v.person.root); if (v.trailer) this.scene.remove(v.trailer); if (v.horse) this.scene.remove(v.horse.root); }
    this.visitors = [];
    this.offers.slice(0, 2).forEach((o, k) => {
      const p = new Person({ seed: hashStr(o.who) });
      p.root.position.set(PLACES.dropoff.x - k * 3, 0, PLACES.dropoff.z); p.root.rotation.y = Math.PI * 0.9;
      p.root.traverse((m) => { if (m.isMesh) m.userData.visitor = o.id; });
      this.scene.add(p.root);
      const trailer = makeTruck(); trailer.position.set(PLACES.dropoff.x - 2 - k * 3, 0, PLACES.dropoff.z + 4.5); trailer.rotation.y = 0;
      this.scene.add(trailer);
      let horse = null;
      if (o.kind === 'horse' && o.horse){ horse = new Horse({ ...o.horse }, this); horse.mode = 'loose'; horse.pos.set(PLACES.dropoff.x - k * 3 + 1.4, 0, PLACES.dropoff.z + 1.2); horse.yaw = -2.4; this.scene.add(horse.root); horse.root.traverse((m) => { if (m.isMesh) m.userData.visitor = o.id; }); }
      if (o.pickup){ const hh = this.horseById(o.pickup); void hh; }
      this.visitors.push({ offer: o, person: p, trailer, horse, t: 0 });
    });
  }
  acceptOffer(o){
    const S = this.state;
    if (o.pickup){
      // collecting: they pay a bonus for great care
      const h = this.horseById(o.pickup), a = this.animals.find((x) => x.data.id === o.pickup);
      const D = (h || a).data, scores = D.owner.scores || [1], avg = scores.reduce((x, y) => x + y, 0) / scores.length;
      const tip = avg > 0.85 ? Math.round(D.owner.rate * 1.5) : avg > 0.7 ? Math.round(D.owner.rate * 0.5) : 0;
      S.money += tip; S.earned += tip;
      // the same owner may have several animals
      const owner = D.owner.who;
      const go = [...this.horses.filter((x) => x.data.owner && x.data.owner.who === owner && x.data.owner.daysLeft <= 0), ...this.animals.filter((x) => x.data.owner && x.data.owner.who === owner && x.data.owner.daysLeft <= 0)];
      for (const x of go) this.removeCreature(x);
      this.offers = this.offers.filter((x) => !(x.pickup && go.some((g) => g.data.id === x.pickup)));
      this.say(tip ? `${owner} was delighted! Tip: ${fmtMoney(tip)} (care ${Math.round(avg * 100)}%).` : `${owner} took their animals home (care ${Math.round(avg * 100)}%).`, 'money');
      this.spawnVisitors(); this.save();
      return true;
    }
    if (o.kind === 'horse'){
      const i = this.freeStall(); if (i < 0){ this.say('No free stall for another horse.'); return false; }
      const d = { ...o.horse, owner: { who: o.who, rate: o.rate, daysLeft: o.days, paid: 0, scores: [] }, stall: i, place: 'stall' };
      S.horses.push(d); const h = this.addHorse(d);
      // they lead it in: it starts at the trailer and walks to its stall
      this.say(`${d.name} is in stall ${i + 1}. ${o.who} pays up to ${fmtMoney(o.rate)} a day for ${o.days} days, depending on the care.`, 'money');
      void h;
    } else {
      const pen = this.pens.find((p) => p.kind === o.kind);
      if (pen.list.length + o.n > this.penCapacity(o.kind)){ this.say(`The ${o.kind} pen is too full.`); return false; }
      for (let k = 0; k < o.n; k++){ const a = new Animal(o.kind, { owner: { who: o.who, rate: Math.round(o.rate / o.n), daysLeft: o.days, paid: 0, scores: [] } }); S.animals.push(a.data); this.addAnimal(a.data); }
      this.say(`${o.n} ${o.kind === 'chicken' ? 'hens' : o.kind + (o.n > 1 ? 's' : '')} for ${o.days} days. ${o.who} pays up to ${fmtMoney(o.rate)} a day.`, 'money');
    }
    this.offers = this.offers.filter((x) => x !== o);
    this.spawnVisitors(); this.save();
    return true;
  }
  declineOffer(o){ this.offers = this.offers.filter((x) => x !== o); this.spawnVisitors(); this.say(`${o.who} drove off.`); }
  removeCreature(x){
    const S = this.state;
    if (x instanceof Horse){
      if (x.stall && x.stall.horse === x.data.id){ x.stall.horse = null; this.refreshStall(x.data.stall); }
      this.scene.remove(x.root); this.horses = this.horses.filter((h) => h !== x); S.horses = S.horses.filter((d) => d !== x.data);
      this.emit('horseGone', x);
    } else {
      const pen = this.pens.find((p) => p.kind === x.kind); pen.list = pen.list.filter((a) => a !== x);
      this.scene.remove(x.root); this.animals = this.animals.filter((a) => a !== x); S.animals = S.animals.filter((d) => d !== x.data);
    }
  }

  // ---------- buying and selling ----------
  market(){
    const S = this.state;
    if (!S.market || S.marketDay !== Math.floor((S.day - 1) / 3)){
      S.marketDay = Math.floor((S.day - 1) / 3);
      const R = rng(S.marketDay * 977 + 13);
      S.market = [0, 1, 2, 3].map(() => { const d = randomHorse(R, {}); d.price = d.value; d.needs = { food: 80, water: 80, energy: 90, happy: 75, health: 100 }; d.dirt = 0.1; d.hooves = [0.1, 0.1, 0.1, 0.1]; d.shoes = 100; return d; });
    }
    return S.market;
  }
  buyHorse(d){
    const S = this.state;
    if (S.money < d.price){ this.say('Not enough money.'); return false; }
    const i = this.freeStall(); if (i < 0){ this.say('All eight stalls are full.'); return false; }
    S.money -= d.price; S.market = S.market.filter((x) => x !== d);
    const nd = { ...d, stall: i, place: 'stall', owner: null }; delete nd.price;
    S.horses.push(nd); this.addHorse(nd);
    this.say(`${nd.name} the ${BREEDS[nd.breed].name} is yours! She's in stall ${i + 1}.`.replace('She', nd.sex === 'mare' ? 'She' : 'He'), 'money');
    this.save(); return true;
  }
  sellHorse(h){
    const S = this.state;
    if (h.data.owner) return false;
    if (this.horses.filter((x) => !x.data.owner).length <= 1){ this.say('You can\'t sell your last horse.'); return false; }
    const price = horseValue(h.data);
    S.money += price; this.removeCreature(h); this.say(`Sold ${h.data.name} for ${fmtMoney(price)}.`, 'money'); this.save();
    return true;
  }
  buyAnimal(kind){
    const S = this.state, pen = this.pens.find((p) => p.kind === kind), price = SPECIES[kind].price;
    if (pen.list.length >= this.penCapacity(kind)){ this.say('That pen is full.'); return false; }
    if (S.money < price){ this.say('Not enough money.'); return false; }
    S.money -= price; const a = new Animal(kind, {}); S.animals.push(a.data); this.addAnimal(a.data);
    this.say(`Bought ${a.data.name} the ${SPECIES[kind].name.toLowerCase()}.`, 'money'); this.save(); return true;
  }
  buySupply(k){
    const S = this.state;
    if (S.money < PRICES[k]){ this.say('Not enough money.'); return false; }
    if (k === 'hay' && S.supplies.hay >= 12){ this.say('The hay stack is full (12 bales).'); return false; }
    if (k === 'shavings' && S.supplies.shavings >= 6){ this.say('No room for more shavings (6 bags).'); return false; }
    S.money -= PRICES[k]; S.supplies[k] += SUPPLY_PACK[k];
    this.refreshSupplies(); this.save(); return true;
  }
  sellProduce(k){
    const S = this.state, price = k === 'eggs' ? 0.5 : 18, n = S.supplies[k];
    if (!n){ this.say(`No ${k} to sell.`); return; }
    S.money += n * price; S.earned += n * price; S.supplies[k] = 0; this.say(`Sold ${n} ${k === 'eggs' ? 'eggs' : 'fleeces'} for ${fmtMoney(n * price)}.`, 'money'); this.save();
  }
  callFarrier(){
    const S = this.state;
    const need = this.horses.filter((h) => h.data.shoes < 85);
    if (!need.length){ this.say('Everyone\'s shoes are in good shape.'); return; }
    const cost = need.length * PRICES.farrier;
    if (S.money < cost){ this.say(`The farrier needs ${fmtMoney(cost)}.`); return; }
    S.money -= cost; for (const h of need){ h.data.shoes = 100; h.data.hooves = [0, 0, 0, 0]; }
    S.minutes += 45;
    this.say(`The farrier reshod ${need.length} horse${need.length > 1 ? 's' : ''} (${fmtMoney(cost)}).`, 'money'); this.save();
  }
  callVet(){
    const S = this.state;
    const sick = [...this.horses.map((h) => h.data.needs), ...this.animals.map((a) => a.data)].filter((n) => n.health < 90);
    if (S.money < PRICES.vet){ this.say(`The vet costs ${fmtMoney(PRICES.vet)}.`); return; }
    S.money -= PRICES.vet;
    for (const n of sick) n.health = 100;
    S.minutes += 40;
    this.say(sick.length ? `The vet treated ${sick.length} animal${sick.length > 1 ? 's' : ''} (${fmtMoney(PRICES.vet)}).` : `The vet checked everyone: all healthy (${fmtMoney(PRICES.vet)}).`, 'money'); this.save();
  }

  // ---------- today's jobs: a checklist worked out from the state ----------
  jobs(){
    const S = this.state, J = [];
    const morning = S.minutes < 12 * 60, evening = S.minutes >= 16 * 60;
    for (const h of this.horses){
      const D = h.data, st = h.stall ? h.stall.state : null, n = D.name;
      if (h.mode === 'stall' && st){
        if (st.hay < 1 && D.needs.food < 85) J.push({ text: `Give ${n} hay (2–3 flakes in the rack)`, done: false, where: 'feed' });
        if (st.water < 8) J.push({ text: `Fill ${n}'s water bucket`, done: false, where: 'water' });
        if (st.manure.length > 0 || st.wet > 0.3) J.push({ text: `Muck out ${n}'s stall (${st.manure.length} piles${st.wet > 0.3 ? ', wet bedding' : ''})`, done: false, where: 'muck' });
        if (st.bedding < 0.5) J.push({ text: `Add fresh shavings to ${n}'s stall`, done: false, where: 'bedding' });
      }
      if (h.model.dirtiness() > 0.12) J.push({ text: `Groom ${n}: curry comb, then body brush`, done: false, where: 'groom' });
      if (D.hooves.some((x) => x > 0.45)) J.push({ text: `Pick out ${n}'s hooves: hoof pick from the grooming kit, then tap each hoof`, done: false, where: 'hooves' });
      if (D.needs.happy < 60 && h.mode === 'stall') J.push({ text: `Turn ${n} out in the paddock or go for a ride`, done: false, where: 'turnout' });
      if (D.shoes < 30) J.push({ text: `${n} needs the farrier (Farm Office)`, done: false, where: 'office' });
      if (D.needs.health < 60) J.push({ text: `${n} is unwell: call the vet (Farm Office)`, done: false, where: 'office' });
    }
    for (const p of this.pens){
      if (!p.list.length) continue;
      const name = { goat: 'goats', sheep: 'sheep', pig: 'pigs', chicken: 'hens' }[p.kind];
      if (p.feedAmt < 0.25) J.push({ text: `Feed the ${name} (${p.kind === 'pig' ? 'pig feed' : p.kind === 'chicken' ? 'corn' : 'hay'})`, done: false, where: 'pens' });
      if (p.waterAmt < 0.3) J.push({ text: `Fill the ${name}' water trough`, done: false, where: 'pens' });
      if (p.saved.droppings.length > 3) J.push({ text: `Clean the ${name}' pen`, done: false, where: 'pens' });
      if (p.kind === 'chicken' && p.saved.eggs > 0) J.push({ text: `Collect ${p.saved.eggs} egg${p.saved.eggs > 1 ? 's' : ''} from the coop`, done: false, where: 'pens' });
      if (p.kind === 'sheep' && p.list.some((a) => a.data.wool > 0.8)) J.push({ text: 'Shear the sheep (shears hang on the pen gate)', done: false, where: 'pens' });
    }
    if (this.offers.length) J.unshift({ text: `${this.offers[0].who} is waiting by the house`, done: false, where: 'house' });
    if (isShowDay(S.day) && S.minutes < 17 * 60 && !S.shows[S.day]) J.push({ text: 'Show day! Tack up and ride to the show grounds (9am–5pm)', done: false, where: 'show' });
    void morning; void evening;
    return J;
  }

  update(dt, ctx){
    for (const h of this.horses) h.update(dt, ctx);
    const night = this.state.minutes > NIGHT || this.state.minutes < DAY_START;
    for (const p of this.pens) for (const a of p.list) a.update(dt, p, night, ctx.player);
    for (const v of this.visitors){
      v.t += dt;
      const near = ctx.player && v.person.root.position.distanceTo(V(ctx.player.x, 0, ctx.player.z)) < 6;
      v.person.update(dt, { pose: 'stand', wave: near && v.t % 6 < 2 ? 1 : 0, look: 0 });
      if (v.horse) v.horse.update(dt, ctx);
    }
    for (const m of this.messages) m.t -= dt;
    this.messages = this.messages.filter((m) => m.t > 0);
  }
}

export function careScore(N, dirt, hooves, stall){
  let s = (N.food + N.water + N.happy + N.health) / 400;
  s -= dirt * 0.4;
  s -= Math.max(0, Math.max(...hooves) - 0.5) * 0.3;
  if (stall) s -= Math.min(0.25, stall.manure.length * 0.025 + stall.wet * 0.08);
  return clamp(s);
}
export function horseValue(D){
  const B = BREEDS[D.breed];
  // a dealer pays less than the asking price, unless you've trained the horse up
  return Math.round(B.price * (0.55 + D.skill * 0.6) * (D.needs.health / 100) / 50) * 50;
}
function hashStr(s){ let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h) + 1; }

// a pickup truck with a horse trailer, for visitors
function makeTruck(){
  const g = new THREE.Group();
  const paint = mat('plain-truck', { color: 0x8a1a1a, rough: 0.35, metal: 0.4 }), dark = mat('plain-tyre', { color: 0x161616, rough: 0.8 }), glass = mat('plain-glass2', { color: 0x223038, rough: 0.05, metal: 0.5 });
  const box = (w, h, d, m, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = true; g.add(b); return b; };
  box(2.0, 0.9, 5.2, paint, 0, 0.95, 0);
  box(1.9, 0.8, 2.2, paint, 0, 1.8, -0.5);
  box(1.92, 0.5, 1.6, glass, 0, 1.9, -0.6);
  for (const x of [-0.95, 0.95]) for (const z of [-1.6, 1.6]){ const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 18), dark); w.rotation.z = Math.PI / 2; w.position.set(x, 0.42, z); g.add(w); }
  // trailer behind
  const tw = mat('plain-trailer', { color: 0xdedad2, rough: 0.4, metal: 0.3 });
  const t = box(2.1, 2.3, 4.2, tw, 0, 1.55, 5.2);
  box(2.12, 0.2, 4.22, paint, 0, 1.1, 5.2);
  for (const x of [-1.05, 1.05]) for (const z of [4.6, 5.8]){ const w = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.25, 16), dark); w.rotation.z = Math.PI / 2; w.position.set(x, 0.36, z); g.add(w); }
  void t;
  return g;
}
export { makeTruck };
