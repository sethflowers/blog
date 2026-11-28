// Mad Scientist: the main loop. You run Dr. Mad's Ice Cream Lab. Customers come in and queue at the
// counter; you scoop a base flavour into a cone, add up to two mad ingredients from the jars, and
// serve it. They eat it on the spot, and the recipe does whatever it does to them (recipes.js: the
// same recipe always does the same thing). Everything you serve goes into the catalogue, so you can
// give the next customer exactly what they ask for.
//  - iPad / computer: tap (or click) the tubs, jars, bell and bin in the shop, or use the tray of big
//    buttons along the bottom. Drag to look; the left thumb (or WASD) walks behind the counter.
//  - VR: point with either controller and pull the trigger. Left stick walks, right stick turns,
//    X/Y opens the menu, B closes it, A serves.
import * as THREE from 'three';
import { V, clamp, damp, angleDiff, textCanvas, roundRect, wrapText, fmtMoney } from './util.js';
import { World, TOP, CONE_AT, QUEUE, DOOR, SKYLIGHT, PLAYER_BOX } from './world.js';
import { Person, reaction, peopleKit } from './people.js';
import { Cone, SCOOP_Y, scoopBall } from './icecream.js';
import { Particles } from './fx.js';
import { BASES, INGREDIENTS, ING, BASE, EFFECTS, FINDABLE, outcome, recipeKey, recipeName, effectName, effectEmoji, describe } from './recipes.js';
import { ScreenPanel, VRPanel } from './ui.js';
import { startAudio, sfx } from './audio.js';

// let the loading screen say "Building…" (and draw it) before the shop is built
if (window.__loading) await window.__loading();

const $ = (id) => document.getElementById(id);
const VERSION = document.body.dataset.version || '';
const SAVE_KEY = 'mad-scientist-v1';
const PRICE = 5, PATIENCE = 80;
const TIP = { any: 3, delicious: 8, effect: 15, discovery: 10 };

// ---------- renderer, scene, light ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x8ad0ff, 1);
renderer.xr.enabled = true; renderer.xr.setReferenceSpaceType('local-floor'); renderer.xr.setFoveation(0.5);
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 80);
const rig = new THREE.Group(); rig.add(camera); scene.add(rig);
scene.add(new THREE.HemisphereLight(0xfff4f0, 0xb8a0c8, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(2, 6, 4); scene.add(sun);
const vatLight = new THREE.PointLight(0x6aff3a, 2.5, 4, 1.5); vatLight.position.set(3.7, 1.6, 1.6); scene.add(vatLight);
const teslaLight = new THREE.PointLight(0x9ae0ff, 0, 5, 1.5); teslaLight.position.set(-3.8, 2.0, 1.7); scene.add(teslaLight);

const world = new World(scene);
const fx = new Particles(scene);
const panel = new ScreenPanel();
const vrPanel = new VRPanel();
scene.add(vrPanel.mesh); vrPanel.mesh.visible = false;

// ---------- saving ----------
const START_INGS = INGREDIENTS.filter((i) => !i.price).map((i) => i.id);
const START_BASES = BASES.filter((b) => !b.price).map((b) => b.id);
const DEFAULTS = { v: 1, money: 10, day: 1, ings: START_INGS, bases: START_BASES, cat: {}, found: {}, served: 0, earned: 0, turn: 'snap', welcomed: false };
let save = structuredClone(DEFAULTS);
// fill in whatever an older save lacks (new ingredients that are free, new fields)
function upgrade(s){
  const o = { ...structuredClone(DEFAULTS), ...s, v: 1 };
  for (const id of START_INGS) if (!o.ings.includes(id)) o.ings.push(id);
  for (const id of START_BASES) if (!o.bases.includes(id)) o.bases.push(id);
  o.ings = o.ings.filter((id) => ING[id]); o.bases = o.bases.filter((id) => BASE[id]);
  return o;
}
function load(){ try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (s) save = upgrade(s); return !!s; } catch (e) { return false; } }
function store(){ try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* private browsing */ } }
let hadSave = load();
world.setStock(save.ings, save.bases);

// ---------- you ----------
const EYE = 1.85, WALK = 1.8;
const START = { x: 0, z: 0.5, yaw: 0, pitch: -0.42 };
const player = { pos: V(START.x, 0, START.z), yaw: START.yaw, pitch: START.pitch };
function standAt(s){ player.pos.set(s.x, 0, s.z); player.yaw = s.yaw ?? 0; player.pitch = s.pitch ?? START.pitch; if (mode === 'vr') vrPlace(player.pos, player.yaw); }
function keepIn(p){ p.x = clamp(p.x, PLAYER_BOX.x0, PLAYER_BOX.x1); p.z = clamp(p.z, PLAYER_BOX.z0, PLAYER_BOX.z1); }
function walk(dt, mx, my){
  const l = Math.hypot(mx, my); if (l > 1){ mx /= l; my /= l; }
  if (l < 0.05) return;
  const sp = WALK * dt, fx_ = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  player.pos.x += fx_ * -my * sp + -fz * mx * sp; player.pos.z += fz * -my * sp + fx_ * mx * sp;
  keepIn(player.pos);
}

// ---------- the cone you're making ----------
const cone = new Cone(); cone.group.position.copy(CONE_AT); scene.add(cone.group);
const cur = { base: null, ings: [] };
const flyers = [];   // scoops and blobs flying into the cone, cones flying to customers
const ballPool = {};
function flyBall(base, from){
  const b = (ballPool[base] = ballPool[base] || []).find((x) => !x.parent) || (() => { const g = scoopBall(base); ballPool[base].push(g); return g; })();
  b.position.copy(from); scene.add(b);
  flyers.push({ obj: b, from: from.clone(), to: CONE_AT.clone().add(V(0, SCOOP_Y, 0)), t: 0, dur: 0.35, arc: 0.25, done: () => { scene.remove(b); cone.set(cur.base, cur.ings); cone.group.scale.set(1.15, 0.85, 1.15); fx.stars(CONE_AT.clone().add(V(0, SCOOP_Y + 0.08, 0)), 5, ['#ffffff']); } });
}
function chooseBase(id, quiet){
  if (!save.bases.includes(id)){ say(`🔒 ${BASE[id].name} isn't in stock. Buy it in the Supply Shop (${fmtMoney(BASE[id].price)}).`); sfx.click(); return false; }
  if (busyServing()) return false;
  startAudio();
  cur.base = id; world.bump('tub', id); sfx.scoop();
  const t = world.tubs.find((t) => t.id === id);
  if (quiet) cone.set(cur.base, cur.ings); else flyBall(id, t.g.position.clone().add(V(0, 0.1, 0)));
  coneChanged();
  return true;
}
function addIng(id, quiet){
  const d = ING[id];
  if (!save.ings.includes(id)){ say(`🔒 ${d.emoji} ${d.name} is locked. Buy it in the Supply Shop (${fmtMoney(d.price)}).`); sfx.click(); return false; }
  if (busyServing()) return false;
  if (!cur.base){ say('Scoop a flavour into the cone first (the tubs in the middle).'); sfx.click(); return false; }
  if (cur.ings.length >= 2){ say('Only room for two ingredients! Bin it to start again.'); sfx.click(); return false; }
  startAudio();
  cur.ings.push(id); world.bump('jar', id); sfx.glop();
  if (!quiet){
    // a blob of the stuff flies from the jar into the cone
    const i = INGREDIENTS.findIndex((x) => x.id === id), from = world.slots[i].clone().add(V(0, 0.22, 0)), to = CONE_AT.clone().add(V(0, SCOOP_Y + 0.05, 0));
    for (let k = 0; k < 6; k++){ const q = fx.add(4, from, V(0, 0, 0), { life: 0.4, size: 0.05, color: d.color }); q.arc = { from: from.clone(), to, d: k * 0.04 }; arcs.push(q); }
    setTimeout(() => { cone.set(cur.base, cur.ings); fx.stars(to, 6, [d.color, '#ffffff']); cone.group.scale.set(1.12, 0.9, 1.12); }, 320);
  } else cone.set(cur.base, cur.ings);
  coneChanged();
  return true;
}
const arcs = [];
function binIt(){
  if (busyServing()) return;
  if (!cur.base){ say('The cone is already empty.'); return; }
  cur.base = null; cur.ings = []; sfx.bin(); world.bump('bin');
  fx.smoke(CONE_AT.clone().add(V(0, SCOOP_Y, 0)), 5, '#ffffff', 0.12);
  cone.set(null, []); coneChanged();
}
function setRecipe(base, ings){
  if (busyServing()) return false;
  if (!save.bases.includes(base) || ings.some((i) => !save.ings.includes(i))){ say('You need to buy an ingredient for that one first.'); return false; }
  cur.base = null; cur.ings = [];
  chooseBase(base, true); for (const i of ings) addIng(i, true);
  sfx.pop(); fx.stars(CONE_AT.clone().add(V(0, SCOOP_Y + 0.05, 0)), 10);
  return true;
}
const busyServing = () => flyers.some((f) => f.serving);
function coneChanged(){ updateHUD(true); drawWrist(); refreshTray(); }
// what the cone in front of you will do, if you've made it before
function coneStatus(){
  if (!cur.base) return { text: 'Empty cone: tap a tub to scoop a flavour', known: null };
  const name = recipeName(cur.base, cur.ings);
  const k = save.cat[recipeKey(cur.base, cur.ings)];
  return { text: name, known: k ? describe(k) : null };
}

// ---------- the customers ----------
const customers = [];   // everyone in the shop
const queue = [];       // those waiting at the counter, front first
const BUBBLES = [];
let seedN = Math.floor(Math.random() * 1e6);
function orderText(o){
  if (o.kind === 'any') return 'One ice cream, please!';
  const a = EFFECTS[o.kind === 'delicious' ? 'delicious' : o.id].ask;
  return o.text || (o.text = a[Math.floor(Math.random() * a.length)]);
}
// what a new customer wants: anything; something delicious; or one of the effects (mostly ones
// you've found, so the catalogue is worth looking in)
function reachable(){
  const s = new Set();
  for (const id of save.ings){ const e = ING[id].effect; if (e) s.add(e); }
  if (save.ings.includes('puffer')) s.add('explode');
  return [...s];
}
function makeOrder(demo){
  if (demo) return { kind: 'any' };
  const r = Math.random(), reach = reachable(), known = reach.filter((id) => save.found[id]);
  if (save.served < 2 || r < 0.32) return { kind: 'any' };
  if (r < 0.52) return { kind: 'delicious' };
  const pool = known.length && Math.random() < 0.75 ? known : reach;
  if (!pool.length) return { kind: 'any' };
  return { kind: 'effect', id: pool[Math.floor(Math.random() * pool.length)] };
}
function spawnCustomer(demo){
  const p = new Person(scene, seedN++);
  p.root.position.set(DOOR.x, 0, DOOR.z - 1.5);
  const c = { p, order: makeOrder(demo), state: 'enter', path: [V(DOOR.x, 0, DOOR.z + 0.6), V(1.3, 0, -7.4)], patience: PATIENCE, t: 0, demo: !!demo, tip: 0 };
  customers.push(c); queue.push(c);
  return c;
}
function removeCustomer(c){
  c.p.dispose();
  customers.splice(customers.indexOf(c), 1);
  const i = queue.indexOf(c); if (i >= 0) queue.splice(i, 1);
  releaseBubble(c);
}
const front = () => (queue[0] && queue[0].state === 'order' ? queue[0] : null);
const SPEED = { walk: 1.25, waddle: 0.7, scurry: 2.2, scuttle: 2.0, trot: 1.2, hop: 1.4, bounce: 1.3, dance: 0.8 };
function moveTo(c, target, dt, speed){
  const p = c.p.root.position, d = V(target.x - p.x, 0, target.z - p.z), L = d.length();
  if (L < 0.05){ c.p.speed = damp(c.p.speed, 0, 10, dt); return true; }
  const s = Math.min(L, speed * dt); p.addScaledVector(d.normalize(), s);
  c.p.speed = damp(c.p.speed, speed, 8, dt);
  const yaw = Math.atan2(d.x, d.z); c.p.root.rotation.y += angleDiff(c.p.root.rotation.y, yaw) * Math.min(1, dt * 8);
  return false;
}
function faceYou(c, dt){
  const p = c.p.root.position, yaw = Math.atan2(headPos.x - p.x, headPos.z - p.z);
  c.p.root.rotation.y += angleDiff(c.p.root.rotation.y, yaw) * Math.min(1, dt * 5);
}
function updateCustomer(c, dt){
  const P = c.p; c.t += dt; P.state = c.state;
  const ctx = { fx };
  if (c.state === 'enter'){
    const target = c.path[0] || QUEUE[Math.min(queue.indexOf(c), QUEUE.length - 1)];
    if (moveTo(c, target, dt, SPEED.walk) && c.path.length) c.path.shift();
    else if (!c.path.length && P.root.position.distanceTo(target) < 0.1) c.state = 'queue';
  } else if (c.state === 'queue'){
    const i = queue.indexOf(c), target = QUEUE[Math.min(i, QUEUE.length - 1)];
    const there = moveTo(c, target, dt, SPEED.walk);
    if (there){ faceYou(c, dt); P.lookAt = headPos; }
    if (there && i === 0){
      c.state = 'order'; c.t = 0; P.speak(orderText(c.order), 4.5); sayOrder(c); updateHUD(true); drawWrist();
    }
  } else if (c.state === 'order'){
    faceYou(c, dt); P.lookAt = headPos;
    if (!paused() && !c.demo) c.patience -= dt;
    if (c.t > 6 && !P.say && Math.random() < dt * 0.15) P.speak(orderText(c.order), 3);
    if (c.demo && c.t > 2.5 && !busyServing()) demoServe(c);
    if (c.patience <= 0){
      c.state = 'leave'; P.speak('Too slow! Hmph!', 2.5); P.events.push(['huff']); c.huffed = true;
      queue.splice(queue.indexOf(c), 1); c.path = leavePath(P);
      say(`😤 A customer gave up waiting and left.`, 'bad');
    }
  } else if (c.state === 'served'){
    faceYou(c, dt);   // (the cone is flying over)
  } else if (c.state === 'eat'){
    faceYou(c, dt);
    // raise the cone, lick lick lick, crunch the cone, gulp
    const t = c.t, arm = P.arms[1];
    arm.g.rotation.x = damp(arm.g.rotation.x, -2.0, 10, dt);
    const m = V(), h = V(); P.mouthPos(m); P.handPos(h);
    const lick = t > 0.3 && t < 1.7 ? Math.max(0, Math.sin((t - 0.3) * Math.PI * 2.2)) : 0;
    c.cone.group.position.copy(h).lerp(m.clone().add(V(0, -SCOOP_Y - 0.02, 0)).addScaledVector(V(Math.sin(P.root.rotation.y), 0, Math.cos(P.root.rotation.y)), 0.1 - lick * 0.08), Math.min(1, t * 3) * 0.8 + lick * 0.2);
    c.cone.eaten(1 - clamp((t - 0.3) / 1.6));
    P.mouthO.visible = lick > 0.3; P.mouth.visible = !P.mouthO.visible;
    if (lick > 0.95 && !c.lickOn){ c.lickOn = true; if (t < 1.3) sfx.lick(); else sfx.crunch(); } else if (lick < 0.5) c.lickOn = false;
    if (t > 2.0){
      scene.remove(c.cone.group); c.cone.inUse = false; c.cone = null;
      P.mouthO.visible = false; P.mouth.visible = true; P.holding = false; sfx.gulp();
      c.state = 'react'; c.t = 0;
      P.apply(c.result.effects);
      c.reactFor = c.result.effects.some((e) => e.id === 'explode') ? 4.2 : 3.6;
    }
  } else if (c.state === 'react'){
    if (!P.alt && !P.ghost) faceYou(c, dt);
    P.lookAt = headPos;
    if (!P.holding) P.arms[1].g.rotation.x = damp(P.arms[1].g.rotation.x, 0, 4, dt);
    // shrunk: they hop up onto the counter so you can see them
    if ((P.fx.has('tiny') || P.alt) && !P.ghost && c.t > 1.1){ const u = clamp((c.t - 1.1) / 0.45); P.root.position.y = TOP * u + Math.sin(u * Math.PI) * 0.25; P.root.position.z = -1.55 + 0.6 * u; c.perched = true; }
    if (c.t > 0.7 && !c.said){ c.said = true; react(c); }
    if (c.t > c.reactFor){ finish(c); c.state = 'leave'; queue.splice(queue.indexOf(c), 1); c.path = leavePath(P); c.t = 0; }
  } else if (c.state === 'leave'){
    const m = P.mode;
    if (c.perched && P.root.position.y > 0){ P.root.position.y = Math.max(0, P.root.position.y - dt * 2.5); P.root.position.z -= dt * 0.8; P.events.length = 0; P.update(dt, { fx }); return; }
    if (m === 'float' || m === 'ghost'){
      // up and out through the skylight
      P.rise += dt * (m === 'ghost' ? 0 : 0.5);
      moveTo(c, SKYLIGHT, dt, 0.6); P.speed = 0;
      if (P.rise > 4.5 || (P.ghost && P.ghost.position.y > 5)) c.state = 'gone';
    } else {
      const target = c.path[0];
      if (!target) c.state = 'gone';
      else if (moveTo(c, target, dt, SPEED[m] || SPEED.walk)) c.path.shift();
    }
  }
  P.update(dt, ctx);
  // swollen customers stand back from the counter
  P.place();
  for (const [type, data] of P.events) customerEvent(c, type, data);
  P.events.length = 0;
}
function leavePath(P){
  const p = P.root.position;
  return [V(Math.max(p.x, 1.9), 0, Math.min(p.z - 0.5, -2.0)), V(2.4, 0, -7.6), V(DOOR.x, 0, DOOR.z + 0.4), V(DOOR.x, 0, DOOR.z - 2)];
}
function customerEvent(c, type, data){
  const near = c.p.root.position.distanceTo(headPos) < 9;
  if (!near && type !== 'boom') return;
  const S = { boing: sfx.boing, pop: sfx.pop, inflate: sfx.inflate, shrink: sfx.shrink, stretch: sfx.stretch, grow: sfx.grow, plop: sfx.plop, poof: sfx.poof, fuse: sfx.fuse, boom: sfx.boom, zap: sfx.zap, fire: sfx.fire, vanish: sfx.vanish, hairfall: sfx.hairfall, yum: sfx.yum, huff: sfx.huff };
  if (type === 'talk') sfx.talk(data, c.p.voice);
  else if (type === 'wheee') sfx.wheee(c.p.voice);
  else if (type === 'animal') ({ pig: sfx.oink, frog: sfx.ribbit, chicken: sfx.bok, cow: sfx.moo })[data]?.();
  else if (type === 'bug') sfx.bug();
  else if (S[type]) S[type]();
  if (type === 'boom'){ shake = 0.4; for (const o of customers) if (o !== c && o.state !== 'leave' && o.p.root.position.distanceTo(c.p.root.position) < 4){ o.p.speak(['AAAH!', 'Eek!', 'Whoa!', 'Did you see that?!'][Math.floor(Math.random() * 4)], 1.8); } }
  if (type === 'poof' && Math.random() < 0.6){ const o = queue[1]; if (o && o !== c) setTimeout(() => o.p.speak(['Whoa!', 'Um...', 'Is that safe?', 'Cool!', 'I want that one!'][Math.floor(Math.random() * 5)], 2), 900); }
}

// ---------- serving ----------
const servedCones = [];
function getServeCone(){ let c = servedCones.find((x) => !x.inUse); if (!c){ c = new Cone(); servedCones.push(c); } c.inUse = true; return c; }
function serve(){
  startAudio();
  const c = front();
  world.bump('bell'); sfx.ding();
  if (!c){ say(queue.length ? 'Wait for them to reach the counter.' : 'Nobody is waiting yet.'); return false; }
  if (!cur.base){ say('The cone is empty! Scoop a flavour first.'); return false; }
  if (busyServing()) return false;
  return handOver(c, cur.base, cur.ings);
}
function handOver(c, base, ings){
  const res = outcome(base, ings);
  c.result = res; c.state = 'served'; c.t = 0;
  const sc = getServeCone(); sc.set(base, ings); sc.whole(); sc.group.position.copy(CONE_AT); scene.add(sc.group); c.cone = sc;
  // the cone flies over the counter into their hand
  const to = V(); c.p.handPos(to);
  flyers.push({ obj: sc.group, from: CONE_AT.clone(), to: to.clone().add(V(0, 0.05, 0)), t: 0, dur: 0.5, arc: 0.3, serving: true, done: () => { c.state = 'eat'; c.t = 0; c.p.holding = true; } });
  cur.base = null; cur.ings = []; cone.set(null, []);
  if (!c.demo){ save.money += PRICE; save.earned += PRICE; dayStats.earned += PRICE; coinPop(CONE_AT.clone().add(V(0, 0.3, -0.3)), PRICE); sfx.till(); }
  coneChanged();
  return true;
}
function demoServe(c){
  // the title screen: serve random recipes so the effects show off behind the menu
  const pool = INGREDIENTS.filter((i) => !i.nice).map((i) => i.id), n = Math.random() < 0.6 ? 1 : 2, ings = [];
  for (let i = 0; i < n; i++) ings.push(pool[Math.floor(Math.random() * pool.length)]);
  handOver(c, BASES[Math.floor(Math.random() * 3)].id, ings);
}
// their reaction, and whether they got what they wanted
function react(c){
  const res = c.result, P = c.p, effs = res.effects;
  const main = effs.find((e) => e.id === 'explode') || effs.find((e) => e.id === 'bug' || e.id === 'animal') || effs[0];
  P.speak(reaction(P, main), 3.2);
  if (c.demo) return;
  const o = c.order, got = (id) => effs.some((e) => e.id === id);
  let tip = 0, verdict = '';
  if (o.kind === 'any'){ if (got('delicious')) tip = TIP.any; }
  else if (o.kind === 'delicious'){ if (got('delicious')) tip = TIP.delicious; else verdict = 'bad'; }
  else if (o.kind === 'effect'){ if (got(o.id)) { tip = TIP.effect; verdict = 'good'; } else verdict = 'bad'; }
  c.tip = tip;
  if (verdict === 'good') setTimeout(() => { if (!P.ghost && !P.alt) P.speak('YES! Just what I wanted!', 2.4); sfx.fanfare(); }, 1700);
  if (verdict === 'bad') setTimeout(() => { if (!P.ghost && !P.alt) P.speak(o.kind === 'delicious' ? 'I said DELICIOUS!' : 'That is NOT what I asked for!', 2.4); sfx.wah(); }, 1800);
  // the catalogue: every recipe you serve, and the effects you've found
  const key = res.key, cat = save.cat[key], fresh = !cat;
  save.cat[key] = { base: res.base, ings: res.ings, effects: res.effects, n: (cat ? cat.n : 0) + 1, day: cat ? cat.day : save.day };
  const newFx = effs.filter((e) => e.id !== 'plain' && !save.found[e.id]);
  for (const e of newFx){ save.found[e.id] = save.day; dayStats.found.push(e.id); }
  save.served++; dayStats.served++;
  if (newFx.length){
    setTimeout(() => { sfx.fanfare(); banner(`🔬 NEW DISCOVERY! ${newFx.map((e) => effectEmoji(e) + ' ' + effectName(e)).join(' + ')}`, `Science prize: +${fmtMoney(TIP.discovery * newFx.length)} · ${Object.keys(save.found).length} of ${FINDABLE.length} effects found`); }, 900);
    save.money += TIP.discovery * newFx.length; save.earned += TIP.discovery * newFx.length; dayStats.earned += TIP.discovery * newFx.length;
  } else if (fresh) say(`📖 New recipe in the catalogue: ${describe(res)}`);
  store();
}
function finish(c){
  if (c.demo || !c.tip) return;
  save.money += c.tip; save.earned += c.tip; dayStats.earned += c.tip; dayStats.tips += c.tip;
  const p = V(); c.p.top(p);
  coinPop(p.add(V(0, 0.1, 0)), c.tip, true); sfx.coin();
  say(`💰 Tip: +${fmtMoney(c.tip)}${c.order.kind === 'effect' ? ' for giving them exactly what they asked for!' : '!'}`, 'good');
  store(); updateHUD(true);
}

// ---------- the day ----------
let day = { n: 1, total: 8, spawned: 0, spawnT: 1, over: false, endT: 0 };
let dayStats = { served: 0, earned: 0, tips: 0, found: [] };
const perDay = (n) => Math.min(16, 7 + n);
function startDay(n){
  clearShop();
  day = { n, total: perDay(n), spawned: 0, spawnT: 1.5, over: false, endT: 0 };
  dayStats = { served: 0, earned: 0, tips: 0, found: [] };
  updateHUD(true);
}
function clearShop(){
  while (customers.length) removeCustomer(customers[0]);
  for (const f of flyers.splice(0)) if (f.obj.parent && f.obj !== cone.group) f.obj.parent.remove(f.obj);
  for (const c of servedCones){ c.inUse = false; if (c.group.parent) c.group.parent.remove(c.group); }
  fx.clear();
}
function dayTick(dt){
  if (mode === 'title'){
    // the title screen: a few customers come in for the demo
    if (customers.length < 3){ day.spawnT -= dt; if (day.spawnT <= 0){ day.spawnT = 3 + Math.random() * 3; spawnCustomer(true); } }
    return;
  }
  if (day.over) return;
  if (day.spawned < day.total){
    day.spawnT -= dt;
    const waiting = queue.length;
    if (day.spawnT <= 0 && waiting < 4){ day.spawnT = 5 + Math.random() * 6; spawnCustomer(false); day.spawned++; sfx.doorbell(); }
  } else if (!customers.length){
    day.endT += dt;
    if (day.endT > 1.2){ day.over = true; endOfDay(); }
  }
}
function endOfDay(){
  save.day = day.n + 1; store();
  sfx.fanfare();
  const found = dayStats.found.map((id) => `${EFFECTS[id].emoji} ${EFFECTS[id].name}`);
  showPanel({ title: `🌙 Day ${day.n} is over!`, money: fmtMoney(save.money), sections: [
    { text: `You served ${dayStats.served} customer${dayStats.served === 1 ? '' : 's'} and took ${fmtMoney(dayStats.earned)} (${fmtMoney(dayStats.tips)} in tips).` },
    ...(found.length ? [{ heading: 'New discoveries today', list: found }] : [{ text: 'No new discoveries today. Try some new mixes tomorrow!' }]),
    { text: `${Object.keys(save.found).length} of ${FINDABLE.length} effects found · ${Object.keys(save.cat).length} recipes in the catalogue.` },
    { buttons: [{ label: '🛒 Supply Shop', go: () => shop(true) }, { label: `Day ${day.n + 1} ▶`, kind: 'primary', go: nextDay }] },
  ] });
}
function nextDay(){ closePanels(); sfx.doorbell(); startDay(save.day); say(`☀ Day ${day.n}: ${day.total} customers are on their way.`); }

// ---------- messages ----------
const msgs = [];
function say(text, kind = ''){
  if (msgs.some((m) => m.text === text)) return;
  msgs.push({ text, kind, t: 4.5 });
  while (msgs.length > 3) msgs.shift();
  drawMsgs(); drawWrist();
}
function drawMsgs(){
  const box = $('h-msg'); box.innerHTML = '';
  for (const m of msgs){ const d = document.createElement('div'); d.className = 'msg ' + m.kind; d.textContent = m.text; box.appendChild(d); }
}
let bannerT = 0;
function banner(title, sub){
  const b = $('banner'); b.innerHTML = ''; const h = document.createElement('b'); h.textContent = title; const s = document.createElement('small'); s.textContent = sub; b.append(h, s);
  b.classList.remove('show'); void b.offsetWidth; b.classList.add('show'); bannerT = 4;
  vrBanner(title, sub);
  fx.confetti(CONE_AT.clone().add(V(0, 0.8, -0.4)), 50);
}
function sayOrder(c){
  if (c.demo) return;
  const o = c.order;
  if (o.kind === 'effect'){
    const known = save.found[o.id];
    say(known ? `They want: ${EFFECTS[o.id].emoji} ${EFFECTS[o.id].name}. Look it up in the 📖 catalogue!` : `They want: ${EFFECTS[o.id].emoji} ${EFFECTS[o.id].name}. Nobody's found that one yet: experiment!`);
  }
}

// ---------- speech bubbles (a pool, redrawn only when what they say changes) ----------
for (let i = 0; i < 6; i++){
  const tc = textCanvas(512, 256);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tc.tex, transparent: true, depthTest: true, toneMapped: false }));
  s.scale.set(0.84, 0.42, 1); s.visible = false; s.renderOrder = 6; scene.add(s);
  BUBBLES.push({ s, tc, owner: null, key: '' });
}
function releaseBubble(c){ const b = BUBBLES.find((b) => b.owner === c); if (b){ b.owner = null; b.s.visible = false; b.key = ''; } }
function drawBubble(b, text, icon, bar, kind){
  const g = b.tc.ctx; g.clearRect(0, 0, 512, 256);
  g.fillStyle = kind === 'cross' ? '#ffd8d8' : '#ffffff'; g.strokeStyle = '#1a1420'; g.lineWidth = 8;
  roundRect(g, 8, 8, 496, 196, 44); g.fill(); g.stroke();
  g.beginPath(); g.moveTo(210, 200); g.lineTo(256, 250); g.lineTo(290, 200); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = kind === 'cross' ? '#ffd8d8' : '#ffffff'; g.fillRect(214, 192, 72, 14);
  let x0 = 34;
  if (icon){ g.font = '84px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#000'; g.fillText(icon, 84, 104); x0 = 140; }
  g.fillStyle = '#1a1420'; g.textAlign = icon ? 'left' : 'center'; g.textBaseline = 'middle';
  let fs = 44, lines; do { g.font = `bold ${fs}px "Trebuchet MS", Arial`; lines = wrapText(g, text, 512 - x0 - 34); fs -= 3; } while (lines.length > 3 && fs > 24);
  const lh = fs + 6, cx = icon ? x0 : 256;
  lines.slice(0, 3).forEach((l, i) => g.fillText(l, cx, 104 + (i - (Math.min(3, lines.length) - 1) / 2) * lh - (bar != null ? 10 : 0)));
  if (bar != null){ g.fillStyle = '#e0dce8'; roundRect(g, 60, 168, 392, 18, 9); g.fill(); g.fillStyle = bar > 0.5 ? '#3ac84a' : bar > 0.25 ? '#ffb020' : '#ff3a3a'; roundRect(g, 60, 168, Math.max(18, 392 * bar), 18, 9); g.fill(); }
  b.tc.tex.needsUpdate = true;
}
function updateBubbles(){
  for (const c of customers){
    const P = c.p, ordering = c.state === 'order';
    const text = P.say ? P.say.text : null;
    let b = BUBBLES.find((b) => b.owner === c);
    if (!text){ if (b) releaseBubble(c); continue; }
    if (!b){ b = BUBBLES.find((b) => !b.owner); if (!b) continue; b.owner = c; b.key = ''; }
    const icon = ordering && c.order.kind === 'effect' ? EFFECTS[c.order.id].emoji : ordering && c.order.kind === 'delicious' ? '😋' : null;
    const bar = ordering && !c.demo ? Math.round(clamp(c.patience / PATIENCE) * 20) / 20 : null;
    const kind = c.huffed ? 'cross' : '';
    const key = text + '|' + icon + '|' + bar + '|' + kind;
    if (key !== b.key){ b.key = key; drawBubble(b, text, icon, bar, kind); }
    const p = V(); P.top(p);
    b.s.position.copy(p).add(V(0, 0.28, 0)); b.s.visible = true;
  }
}
// "+$5" floating up from the till (and over a tipping customer)
const POPS = [];
for (let i = 0; i < 4; i++){ const tc = textCanvas(256, 96); const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tc.tex, transparent: true, depthTest: false, toneMapped: false })); s.scale.set(0.36, 0.135, 1); s.visible = false; s.renderOrder = 7; scene.add(s); POPS.push({ s, tc, t: 9 }); }
function coinPop(p, amount, big){
  const q = POPS.reduce((a, b) => (a.t > b.t ? a : b)); const g = q.tc.ctx; g.clearRect(0, 0, 256, 96);
  g.font = 'bold 64px "Trebuchet MS", Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 10; g.strokeStyle = '#3a2a00'; g.strokeText('+' + fmtMoney(amount), 128, 50); g.fillStyle = big ? '#7aff5a' : '#ffd23a'; g.fillText('+' + fmtMoney(amount), 128, 50);
  q.tc.tex.needsUpdate = true; q.s.position.copy(p); q.t = 0; q.s.visible = true; q.s.scale.set(big ? 0.5 : 0.36, big ? 0.19 : 0.135, 1);
  fx.stars(p, 8, ['#ffd23a', '#fff8a0']);
}

// ---------- panels: one description, drawn as HTML on screen or as a board in VR ----------
let vrPage = null;
function showPanel(spec){ if (mode === 'vr'){ vrPage = spec; vrs.placePanel = true; vrPanel.show(spec); vrPanel.mesh.visible = vrs.posed; } else panel.show(spec); }
function closePanels(){ panel.close(); vrPage = null; vrPanel.mesh.visible = false; laser.visible = false; }
const paused = () => (mode === 'screen' && !!panel.open) || (mode === 'vr' && !!vrPage);
function howTo(){
  const common = [
    'A customer comes to the counter and says what they want.',
    'Scoop a flavour from a tub (the middle of the counter), then add up to two ingredients from the jars.',
    'Ring the SERVE bell. They eat it right away... and whatever your recipe does happens to them!',
    'The same recipe always does the same thing. Everything you serve goes in the 📖 catalogue: look up how to give them what they ask for (big tips).',
    'Found a new effect? You get a science prize. Spend your money on new ingredients in the 🛒 Supply Shop.',
  ];
  if (mode === 'vr') return [...common, 'Point at things and pull the trigger. A serves. Left stick walks, right stick turns, X/Y: menu, B closes it.'];
  return [...common, 'Tap the tubs, jars, bell and bin (or use the buttons along the bottom). Drag to look around; WASD or your left thumb walks.'];
}
function welcome(){
  save.welcomed = true; store();
  showPanel({ title: '🧪 Dr. Mad\'s Ice Cream Lab', sections: [
    { text: 'You\'re a mad scientist, and you sell ice cream. With mad ingredients. Your customers eat it straight away, and anything could happen to them!' },
    { heading: 'How it works', list: howTo() },
    { buttons: [{ label: 'Open the shop!', kind: 'primary', go: () => { closePanels(); sfx.doorbell(); } }] },
  ] });
}
function menu(){
  showPanel({ title: '☰ Menu', money: 'v' + VERSION, sections: [
    { text: `Day ${day.n} · ${fmtMoney(save.money)} · ${Object.keys(save.found).length} of ${FINDABLE.length} effects found` },
    { buttons: [{ label: '▶ Keep going', kind: 'primary', go: closePanels }, { label: '📖 Catalogue', go: () => catalogue() }] },
    { buttons: [{ label: '🛒 Supply Shop', go: () => shop() }, { label: '❓ How to play', go: () => showPanel({ title: '❓ How to play', sections: [{ list: howTo() }, { buttons: [{ label: 'OK', kind: 'primary', go: closePanels }] }] }) }] },
    ...(mode === 'vr' ? [{ heading: 'Turning', buttons: [{ label: 'Snap turn', on: save.turn === 'snap', go: () => { save.turn = 'snap'; store(); menu(); } }, { label: 'Smooth turn', on: save.turn === 'smooth', go: () => { save.turn = 'smooth'; store(); menu(); } }] }] : []),
    { buttons: [{ label: '🏠 Title', kind: 'danger', go: () => { closePanels(); toTitle(); } }] },
  ] });
}
// the catalogue: the effects you've found, and every recipe you've served (filter by effect)
let catFilter = null;
function catalogue(filter){
  if (filter !== undefined) catFilter = filter;
  const found = save.found, all = Object.values(save.cat);
  const list = all.filter((r) => !catFilter || r.effects.some((e) => e.id === catFilter)).sort((a, b) => (b.day - a.day) || (b.n - a.n)).slice(0, 40);
  const fr = front();
  showPanel({ title: '📖 Catalogue', money: `${Object.keys(found).length}/${FINDABLE.length}`, sections: [
    ...(fr && fr.order.kind === 'effect' ? [{ text: `The customer wants: ${EFFECTS[fr.order.id].emoji} ${EFFECTS[fr.order.id].name}.` }] : []),
    { heading: 'Effects found (tap one to see its recipes)', cols: 4, cellH: 120, grid: FINDABLE.map((id) => found[id]
      ? { label: EFFECTS[id].emoji + ' ' + EFFECTS[id].name, on: catFilter === id, go: () => { sfx.click(); catalogue(catFilter === id ? null : id); } }
      : { label: '❓ ???', disabled: true, go: () => {} }) },
    { heading: catFilter ? `Recipes that do: ${EFFECTS[catFilter].emoji} ${EFFECTS[catFilter].name}` : `Recipes you've made (${all.length})`,
      ...(list.length ? { rows: list.map((r) => ({ title: recipeName(r.base, r.ings), sub: '→ ' + describe(r) + (r.n > 1 ? `  (×${r.n})` : ''),
        button: { label: 'Make this', disabled: !save.bases.includes(r.base) || r.ings.some((i) => !save.ings.includes(i)), go: () => { if (setRecipe(r.base, r.ings)){ closePanels(); say(`🍦 Made: ${recipeName(r.base, r.ings)}. Ring the bell to serve it.`); } } } })) }
        : { text: catFilter ? 'None yet.' : 'Nothing yet: serve some ice cream and see what happens!' }) },
    { buttons: [...(catFilter ? [{ label: 'Show all', go: () => catalogue(null) }] : []), { label: 'Close', kind: 'primary', go: closePanels }] },
  ] });
}
function shop(fromDayEnd){
  const items = [...BASES.filter((b) => b.price).map((b) => ({ ...b, kind: 'base' })), ...INGREDIENTS.filter((i) => i.price).map((i) => ({ ...i, kind: 'ing' }))];
  const owned = (it) => (it.kind === 'base' ? save.bases : save.ings).includes(it.id);
  const forSale = items.filter((it) => !owned(it)).sort((a, b) => a.price - b.price);
  showPanel({ title: '🛒 Supply Shop', money: fmtMoney(save.money), sections: [
    { text: forSale.length ? 'New ingredients for your lab. What do they do? Only one way to find out...' : 'You own everything! Now find all the effects.' },
    { rows: forSale.map((it) => ({ title: `${it.emoji} ${it.name}`, sub: it.kind === 'base' ? 'A new flavour of ice cream' : it.nice ? 'Something nice (probably)' : 'Mad stuff. Effects unknown!',
      button: { label: `Buy ${fmtMoney(it.price)}`, disabled: save.money < it.price, go: () => buy(it, fromDayEnd) } })) },
    { buttons: [fromDayEnd ? { label: `Day ${day.n + 1} ▶`, kind: 'primary', go: nextDay } : { label: 'Close', kind: 'primary', go: closePanels }] },
  ] });
}
function buy(it, fromDayEnd){
  if (save.money < it.price) return;
  save.money -= it.price;
  (it.kind === 'base' ? save.bases : save.ings).push(it.id);
  store(); world.setStock(save.ings, save.bases); refreshTray(true); sfx.till();
  say(`🛒 Bought ${it.emoji} ${it.name}! It's on the counter now.`, 'good');
  shop(fromDayEnd);
}

// ---------- the tray of big buttons (screen) ----------
let trayKey = '';
function refreshTray(force){
  const key = save.bases.join() + '|' + save.ings.join() + '|' + cur.base + '|' + cur.ings.join();
  if (key === trayKey && !force) return; trayKey = key;
  const t = $('tray'); t.innerHTML = '';
  const add = (label, emoji, cls, go, title) => { const b = document.createElement('button'); b.className = 'tb ' + cls; b.title = title || label; const e = document.createElement('i'); e.textContent = emoji; const s = document.createElement('span'); s.textContent = label; b.append(e, s); b.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); startAudio(); go(); }); t.appendChild(b); return b; };
  for (const b of BASES) if (save.bases.includes(b.id)){ const el = add(b.name, b.emoji, 'base' + (cur.base === b.id ? ' on' : ''), () => chooseBase(b.id)); el.style.setProperty('--c', b.color); }
  const sep = document.createElement('div'); sep.className = 'sep'; t.appendChild(sep);
  for (const i of INGREDIENTS) if (save.ings.includes(i.id)){ const n = cur.ings.filter((x) => x === i.id).length; const el = add(i.name.replace(/ (Gas|Spit|Drops|Earwax|Puffs|Gel|Eggs|Juice|Whiskers|Dust|Salts|Fudge|Tonic|Bits|Tears)$/, ''), i.emoji, 'ing' + (n ? ' on' : ''), () => addIng(i.id), i.name); el.style.setProperty('--c', i.color); if (n > 1){ const x = document.createElement('em'); x.textContent = '×2'; el.appendChild(x); } }
}

// ---------- screen input: a thumb stick, drag to look, tap to use ----------
const touch = { stickId: null, stick: null, look: new Map() };
const keys = {};
const stick = { x: 0, y: 0 };
const stickEl = $('stick'), knobEl = $('knob');
function stickZone(x, y){ return x < Math.min(innerWidth * 0.3, 260) && y > innerHeight * 0.45; }
const raycaster = new THREE.Raycaster();
function pickScreen(x, y){
  camera.updateMatrixWorld(true);
  raycaster.setFromCamera(new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1), camera);
  return world.ray(raycaster.ray.origin, raycaster.ray.direction, 12);
}
function use(h){
  if (!h) return false;
  if (h.kind === 'tub') return chooseBase(h.id);
  if (h.kind === 'jar') return addIng(h.id);
  if (h.kind === 'bell') return serve();
  if (h.kind === 'bin'){ binIt(); return true; }
  if (h.kind === 'cone'){ const s = coneStatus(); say(s.known ? `${s.text} → ${s.known}` : cur.base ? `${s.text}: never tried. What will it do?` : s.text); return true; }
  return false;
}
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (mode !== 'screen') return;
  startAudio();
  try { renderer.domElement.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
  if (e.pointerType !== 'mouse' && stickZone(e.clientX, e.clientY)){
    touch.stickId = e.pointerId; touch.stick = { x0: e.clientX, y0: e.clientY }; stick.x = stick.y = 0;
    stickEl.style.left = (e.clientX - 60) + 'px'; stickEl.style.top = (e.clientY - 60) + 'px'; stickEl.classList.add('on'); knobEl.style.transform = '';
    return;
  }
  touch.look.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 });
});
let hoverT = 0;
renderer.domElement.addEventListener('pointermove', (e) => {
  if (mode !== 'screen') return;
  if (e.pointerId === touch.stickId){
    const dx = e.clientX - touch.stick.x0, dy = e.clientY - touch.stick.y0, d = Math.hypot(dx, dy), m = Math.min(d, 55) / (d || 1);
    stick.x = dx * m / 55; stick.y = dy * m / 55; knobEl.style.transform = `translate(${dx * m}px, ${dy * m}px)`;
    return;
  }
  const L = touch.look.get(e.pointerId);
  if (!L){
    // a mouse hovering: light up what it's over
    if (e.pointerType === 'mouse' && performance.now() - hoverT > 50){ hoverT = performance.now(); const h = pickScreen(e.clientX, e.clientY); world.setHover(h); renderer.domElement.style.cursor = h ? 'pointer' : ''; }
    return;
  }
  const dx = e.clientX - L.x, dy = e.clientY - L.y; L.x = e.clientX; L.y = e.clientY; L.moved += Math.hypot(dx, dy);
  if (L.moved < 8) return;
  const k = e.pointerType === 'mouse' ? 0.004 : 0.005;
  player.yaw -= dx * k; player.pitch = clamp(player.pitch - dy * k, -1.2, 1.0);
});
function releaseStick(){ touch.stickId = null; touch.stick = null; stick.x = stick.y = 0; stickEl.classList.remove('on'); knobEl.style.transform = ''; }
renderer.domElement.addEventListener('pointerup', (e) => {
  if (e.pointerId === touch.stickId){ releaseStick(); return; }
  const L = touch.look.get(e.pointerId); if (!L) return;
  touch.look.delete(e.pointerId);
  if (mode === 'screen' && L.moved < 12 && performance.now() - L.t < 600 && !panel.open){
    const h = pickScreen(e.clientX, e.clientY);
    if (h){ world.setHover(h); setTimeout(() => world.setHover(null), 250); use(h); }
  }
});
const cancelPointer = (e) => { touch.look.delete(e.pointerId); if (e.pointerId === touch.stickId) releaseStick(); };
renderer.domElement.addEventListener('pointercancel', cancelPointer);
renderer.domElement.addEventListener('lostpointercapture', (e) => { touch.look.delete(e.pointerId); if (e.pointerId === touch.stickId) releaseStick(); });
addEventListener('pointerup', (e) => { if (e.target !== renderer.domElement) cancelPointer(e); });
addEventListener('pointercancel', cancelPointer);
const resetInput = () => { releaseStick(); touch.look.clear(); for (const k in keys) keys[k] = false; };
addEventListener('blur', resetInput);
document.addEventListener('visibilitychange', () => { if (document.hidden){ resetInput(); if (mode !== 'title') store(); } });
addEventListener('keydown', (e) => {
  if (mode !== 'screen') return;
  keys[e.code] = true;
  if (e.code === 'Escape'){ if (panel.open) closePanels(); else menu(); }
  if (panel.open) return;
  if (e.code === 'Space' || e.code === 'Enter'){ e.preventDefault(); serve(); }
  if (e.code === 'Backspace' || e.code === 'KeyX'){ binIt(); }
  if (e.code === 'KeyC'){ catalogue(); }
  const n = e.code.match(/^Digit([1-5])$/); if (n){ const b = save.bases[+n[1] - 1]; if (b) chooseBase(b); }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
const press = (id, fn) => $(id).addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); startAudio(); fn(); });
press('b-serve', () => serve());
press('b-bin', () => binIt());
press('b-menu', () => { sfx.click(); menu(); });
press('b-cat', () => { sfx.click(); catalogue(); });

// ---------- the screen camera ----------
const _eu = new THREE.Euler();
let shake = 0, titleA = 0;
function placeScreenCamera(){
  rig.position.set(0, 0, 0); rig.quaternion.identity();
  if (mode === 'title'){
    camera.position.set(Math.sin(titleA) * 1.2, 1.9, 1.6);
    camera.lookAt(Math.sin(titleA) * 0.4, 1.2, -2.6);
  } else {
    const s = shake * shake * 0.2;
    camera.position.set(player.pos.x + (Math.random() - 0.5) * s, EYE + (Math.random() - 0.5) * s, player.pos.z);
    camera.quaternion.setFromEuler(_eu.set(player.pitch, player.yaw, 0, 'YXZ'));
  }
  camera.updateMatrixWorld(true);
}

// ---------- VR ----------
function makeVRHand(i){
  return { i, side: i ? 'right' : 'left', tracked: false, rayPos: V(), rayQuat: new THREE.Quaternion(),
    trigger: 0, grip: false, stick: { x: 0, y: 0 }, a: false, b: false, last: {}, gamepad: null,
    haptic(v, ms){ const g = this.gamepad; try { if (g && g.hapticActuators && g.hapticActuators[0]) g.hapticActuators[0].pulse(v, ms); } catch (e) { /* no rumble */ } } };
}
const vr = [makeVRHand(0), makeVRHand(1)];
const rays = [renderer.xr.getController(0), renderer.xr.getController(1)];
const sources = [null, null];
for (let i = 0; i < 2; i++){ rig.add(rays[i]); rays[i].addEventListener('connected', (e) => { sources[i] = e.data; }); rays[i].addEventListener('disconnected', () => { sources[i] = null; }); }
const headPos = V(0, 1.6, 1), headQuat = new THREE.Quaternion(), v1 = V();
const vrs = { posed: false, frames: 0, snapReady: true, pending: null, placePanel: false };
// in each hand: a test tube of glowing goo, pointing where you point
function makeTube(color){
  const g = new THREE.Group();
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 12, 1, true).rotateX(Math.PI / 2), world.M.glass); g.add(glass);
  const goo = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.08, 4, 10).rotateX(Math.PI / 2).translate(0, 0, -0.02), new THREE.MeshToonMaterial({ color, emissive: color, emissiveIntensity: 0.5 })); g.add(goo);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.025, 12).rotateX(Math.PI / 2).translate(0, 0, 0.09), world.M.red); g.add(cap);
  g.visible = false; scene.add(g); return g;
}
const tubes = [makeTube('#6aff3a'), makeTube('#c050ff')];
const laser = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 1, 6).translate(0, 0.5, 0).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#6aff3a', transparent: true, opacity: 0.8 }));
laser.visible = false; scene.add(laser);
const lasers = [laser, laser.clone()]; scene.add(lasers[1]);
const dotTex = (() => { const t = textCanvas(64, 64); const g = t.ctx; g.fillStyle = '#6aff3a'; g.beginPath(); g.arc(32, 32, 14, 0, 7); g.fill(); g.strokeStyle = '#000'; g.lineWidth = 4; g.stroke(); t.tex.needsUpdate = true; return t.tex; })();
const dots = [0, 1].map(() => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, depthTest: false, transparent: true, toneMapped: false })); s.visible = false; s.renderOrder = 20; s.scale.setScalar(0.025); scene.add(s); return s; });
// a board on the left wrist: money, day, the cone, the order, the version
const wrist = textCanvas(512, 320);
const wristMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.125), new THREE.MeshBasicMaterial({ map: wrist.tex, transparent: true, toneMapped: false }));
wristMesh.visible = false; scene.add(wristMesh);
let wristKey = '';
function drawWrist(){
  if (mode !== 'vr') return;
  const s = coneStatus(), fr = front(), m = msgs[msgs.length - 1];
  const lines = [`💰 ${fmtMoney(save.money)}   Day ${day.n}   🔬 ${Object.keys(save.found).length}/${FINDABLE.length}`,
    cur.base ? s.text : 'Cone: empty', cur.base ? (s.known ? '→ ' + s.known : '→ ??? never tried') : '',
    fr ? `Wants: ${fr.order.kind === 'effect' ? EFFECTS[fr.order.id].emoji + ' ' + EFFECTS[fr.order.id].name : fr.order.kind === 'delicious' ? '😋 something delicious' : 'any ice cream'}` : '',
    m ? m.text : ''];
  const key = lines.join('|');
  if (key === wristKey) return; wristKey = key;
  const g = wrist.ctx; g.clearRect(0, 0, 512, 320);
  g.fillStyle = 'rgba(30,16,48,0.92)'; roundRect(g, 4, 4, 504, 312, 28); g.fill(); g.strokeStyle = '#6aff3a'; g.lineWidth = 6; roundRect(g, 4, 4, 504, 312, 28); g.stroke();
  g.fillStyle = '#ffffff'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.font = 'bold 32px Arial'; g.fillText(lines[0], 22, 48);
  g.font = '26px Arial'; let y = 90;
  for (const l of [lines[1], lines[2], lines[3]]) if (l) for (const w of wrapText(g, l, 470).slice(0, 2)){ g.fillStyle = l === lines[2] ? '#a8ff8a' : '#ffffff'; g.fillText(w, 22, y); y += 32; }
  if (lines[4]){ g.fillStyle = '#ffe07a'; g.font = '22px Arial'; for (const w of wrapText(g, lines[4], 470).slice(0, 2)){ g.fillText(w, 22, y + 4); y += 28; } }
  g.fillStyle = '#8a80a0'; g.font = '20px Arial'; g.textAlign = 'right'; g.fillText('v' + VERSION + '  ·  X: menu  A: serve', 494, 304);
  wrist.tex.needsUpdate = true;
}
// a banner floating over the counter in VR for discoveries
const vrBan = textCanvas(1024, 200);
const vrBanMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.254), new THREE.MeshBasicMaterial({ map: vrBan.tex, transparent: true, toneMapped: false, depthTest: false }));
vrBanMesh.visible = false; vrBanMesh.renderOrder = 9; scene.add(vrBanMesh);
function vrBanner(title, sub){
  if (mode !== 'vr') return;
  const g = vrBan.ctx; g.clearRect(0, 0, 1024, 200); g.fillStyle = 'rgba(60,20,90,0.95)'; roundRect(g, 4, 4, 1016, 192, 40); g.fill(); g.strokeStyle = '#6aff3a'; g.lineWidth = 8; roundRect(g, 4, 4, 1016, 192, 40); g.stroke();
  g.textAlign = 'center'; g.fillStyle = '#fff'; let fs = 46; g.font = `bold ${fs}px Arial`; while (g.measureText(title).width > 960 && fs > 26){ fs -= 2; g.font = `bold ${fs}px Arial`; } g.fillText(title, 512, 88);
  g.fillStyle = '#a8ff8a'; g.font = '34px Arial'; g.fillText(sub, 512, 150); vrBan.tex.needsUpdate = true;
  vrBanMesh.position.set(0, 2.25, -1.0); vrBanMesh.lookAt(headPos); vrBanMesh.visible = true;
}
function readVR(){
  for (const h of vr){
    const idx = sources.findIndex((s) => s && s.handedness === h.side);
    const src = idx >= 0 ? sources[idx] : null, g = src && src.gamepad;
    h.gamepad = g || null;
    h.tracked = !!(src && rays[idx].visible);
    if (h.tracked){ rays[idx].updateMatrixWorld(true); rays[idx].matrixWorld.decompose(h.rayPos, h.rayQuat, v1); }
    const B = (k) => (g && g.buttons[k]) || { value: 0, pressed: false };
    h.trigger = B(0).value; h.grip = B(1).pressed; h.a = B(4).pressed; h.b = B(5).pressed;
    const ax = g ? g.axes : [];
    h.stick.x = ax.length >= 4 ? ax[2] : (ax[0] || 0); h.stick.y = ax.length >= 4 ? ax[3] : (ax[1] || 0);
    const L = h.last;
    h.triggerDown = h.trigger > 0.7 && !L.t; h.aDown = h.a && !L.a; h.bDown = h.b && !L.b; h.gripDown = h.grip && !L.g;
    L.t = h.trigger > 0.7 ? true : h.trigger < 0.4 ? false : L.t; L.a = h.a; L.b = h.b; L.g = h.grip;
  }
}
const FWD = V(0, 0, -1);
function vrUpdate(dt){
  readVR();
  const L = vr[0], R = vr[1];
  [L, R].forEach((h, i) => { tubes[i].visible = h.tracked; if (h.tracked){ tubes[i].position.copy(h.rayPos).add(V(0, 0, -0.03).applyQuaternion(h.rayQuat)); tubes[i].quaternion.copy(h.rayQuat); } });
  // the wrist board rides on the left hand
  wristMesh.visible = L.tracked;
  if (L.tracked){ wristMesh.position.copy(L.rayPos).add(V(0, 0.09, 0.06).applyQuaternion(L.rayQuat)); wristMesh.quaternion.copy(L.rayQuat).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.7, 0, 0))); }
  lasers[0].visible = lasers[1].visible = false; dots[0].visible = dots[1].visible = false;
  let onPanel = false;
  if (vrPage){
    const fwd = V(0, 0, -1).applyQuaternion(headQuat); fwd.y = 0; fwd.normalize();
    const to = v1.copy(vrPanel.mesh.position).sub(headPos); to.y = 0; to.normalize();
    if (vrs.placePanel || fwd.dot(to) < 0.5){
      vrs.placePanel = false;
      vrPanel.mesh.position.copy(headPos).addScaledVector(fwd, 1.1); vrPanel.mesh.position.y = headPos.y - 0.1;
      vrPanel.mesh.lookAt(headPos.x, headPos.y - 0.1, headPos.z);
    }
    vrPanel.mesh.visible = true;
    [R, L].forEach((h, k) => {
      if (!h.tracked || onPanel) return;
      const dir = FWD.clone().applyQuaternion(h.rayQuat);
      vrPanel.mesh.updateMatrixWorld(true);
      const hit = vrPanel.ray(h.rayPos, dir, h.triggerDown, 4);
      if (hit){
        onPanel = true; const ls = lasers[k]; ls.visible = true;
        ls.position.copy(h.rayPos); ls.lookAt(hit.point); ls.scale.set(1, 1, h.rayPos.distanceTo(hit.point));
        if (hit.clicked){ h.haptic(0.3, 30); sfx.click(); if (vrPage) vrPanel.show(vrPage); }
        if (Math.abs(h.stick.y) > 0.3) vrPanel.scrollBy(h.stick.y * dt * 900);
      }
    });
    if (R.bDown || L.bDown){ closePanels(); return; }
  } else if (L.aDown || L.bDown){ menu(); return; }
  if (!vrPage){
    // point at a tub, a jar, the bell or the bin and pull the trigger
    let hov = null;
    [L, R].forEach((h, k) => {
      if (!h.tracked) return;
      const dir = FWD.clone().applyQuaternion(h.rayQuat), hit = world.ray(h.rayPos, dir, 6);
      if (hit){
        const ls = lasers[k]; ls.visible = true; ls.position.copy(h.rayPos); ls.lookAt(hit.point); ls.scale.set(1, 1, hit.t);
        dots[k].visible = true; dots[k].position.copy(hit.point);
        hov = hov || hit;
        if (h.triggerDown){ if (use(hit)) h.haptic(0.5, 40); }
      }
    });
    world.setHover(hov);
    if (R.aDown) serve();
  }
  // turning: snap or smooth (a setting)
  const sx = onPanel ? 0 : R.stick.x;
  if (save.turn === 'smooth'){ if (Math.abs(sx) > 0.2) turnRig(-sx * dt * 2.2); }
  else {
    if (Math.abs(sx) > 0.7 && vrs.snapReady){ turnRig(-Math.sign(sx) * Math.PI / 6); vrs.snapReady = false; }
    if (Math.abs(sx) < 0.35) vrs.snapReady = true;
  }
  // walking behind the counter (the stick stops at the counter; your real head isn't stopped by it)
  let mx = L.stick.x, my = L.stick.y; if (Math.hypot(mx, my) < 0.15 || onPanel){ mx = 0; my = 0; }
  if (mx || my){
    const f = V(0, 0, -1).applyQuaternion(headQuat); f.y = 0; f.normalize();
    const sp = WALK * 0.8 * dt;
    const want = V(headPos.x + f.x * -my * sp - f.z * mx * sp, 0, headPos.z + f.z * -my * sp + f.x * mx * sp);
    keepIn(want);
    rig.position.x += want.x - headPos.x; rig.position.z += want.z - headPos.z;
  }
  rig.position.y = 0;
  player.pos.set(headPos.x, 0, headPos.z);
  drawWrist();
}
function turnRig(a){ v1.copy(headPos); rig.position.sub(v1).applyAxisAngle(V(0, 1, 0), a).add(v1); rig.rotation.y += a; rig.updateMatrixWorld(true); }
// stand the play space so your head is over p, facing yaw; not before the headset has a real pose
function vrPlace(p, yaw){
  if (!vrs.posed){ vrs.pending = { p: p.clone(), yaw }; return; }
  const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  const ry = yaw - e.y;
  rig.quaternion.setFromEuler(new THREE.Euler(0, ry, 0, 'YXZ'));
  const local = V(camera.position.x, 0, camera.position.z).applyQuaternion(rig.quaternion);
  rig.position.set(p.x - local.x, 0, p.z - local.z);
  rig.updateMatrixWorld(true);
}

// ---------- the loop ----------
const clock = new THREE.Clock();
let mode = 'title', gameTime = 0, hudT = 0, saveT = 0;
function frame(){ try { step(); } catch (e) { console.error(e); } }
function step(){
  const dt = Math.min(clock.getDelta(), 1 / 20);
  const T = window.__ms, steps = T && T.timeScale > 1 ? Math.round(T.timeScale) : 1;
  if (T && T.paused && mode !== 'vr') return;   // (the test runs the game itself, with advance())
  for (let k = 0; k < steps; k++) simulate(dt);
  if (T && T.noRender && mode !== 'vr') return;
  renderer.render(scene, camera);
}
const rainbowMats = [];
function simulate(dt){
  gameTime += dt;
  if (mode === 'vr'){
    rig.updateMatrixWorld(true);
    renderer.xr.getCamera().matrixWorld.decompose(headPos, headQuat, v1);
    if (!vrs.posed){ vrs.frames = renderer.xr.isPresenting ? vrs.frames + 1 : 0; }
    if (!vrs.posed && vrs.frames >= 3){
      vrs.posed = true;
      if (vrs.pending){ const q = vrs.pending; vrs.pending = null; vrPlace(q.p, q.yaw); rig.updateMatrixWorld(true); renderer.xr.getCamera().matrixWorld.decompose(headPos, headQuat, v1); }
      if (vrPage){ vrs.placePanel = true; vrPanel.mesh.visible = true; }
      drawWrist();
    }
    if (vrs.posed) vrUpdate(dt);
  } else {
    if (mode === 'title') titleA += dt * 0.12;
    if (mode === 'screen' && !panel.open){
      const k = (c) => (keys[c] ? 1 : 0);
      walk(dt, stick.x + k('KeyD') - k('KeyA'), stick.y + k('KeyS') - k('KeyW'));
      player.yaw += (k('ArrowLeft') - k('ArrowRight')) * dt * 2;
      player.pitch = clamp(player.pitch + (k('ArrowUp') - k('ArrowDown')) * dt * 1.5, -1.2, 1.0);
    }
    placeScreenCamera();
    headPos.copy(camera.position);
  }
  shake = Math.max(0, shake - dt);
  world.update(gameTime, dt, fx);
  teslaLight.intensity = world.arcFlash ? 2 + Math.random() * 3 : 0;
  vatLight.intensity = 2.2 + Math.sin(gameTime * 3) * 0.5;
  // the rainbow and stripy skins scroll
  for (const m of [peopleRainbow(), peopleStripes()]) if (m && m.map){ m.map.offset.y = (gameTime * 0.4) % 1; }
  // the cone wobbles back into shape after something lands in it
  cone.group.scale.x = damp(cone.group.scale.x, 1, 8, dt); cone.group.scale.y = damp(cone.group.scale.y, 1, 8, dt); cone.group.scale.z = damp(cone.group.scale.z, 1, 8, dt);
  // things flying through the air (scoops into the cone, cones over the counter)
  for (let i = flyers.length - 1; i >= 0; i--){
    const f = flyers[i]; f.t += dt / f.dur; const t = Math.min(1, f.t);
    f.obj.position.lerpVectors(f.from, f.to, t); f.obj.position.y += Math.sin(t * Math.PI) * f.arc;
    if (f.t >= 1){ flyers.splice(i, 1); f.done && f.done(); }
  }
  for (let i = arcs.length - 1; i >= 0; i--){
    const q = arcs[i], a = q.arc; const t = clamp((q.life - a.d) / 0.3);
    if (!q.on || t >= 1){ arcs.splice(i, 1); q.on = false; continue; }
    q.p.lerpVectors(a.from, a.to, t); q.p.y += Math.sin(t * Math.PI) * 0.2; q.v.set(0, 0, 0);
  }
  if (!paused() || mode === 'title') dayTick(dt);
  // the customers (they carry on while a panel is open, except the waiting doesn't count)
  for (let i = customers.length - 1; i >= 0; i--){
    const c = customers[i];
    updateCustomer(c, dt);
    if (c.state === 'gone') removeCustomer(c);
  }
  // the door opens when someone's near it
  world.doorWant = customers.some((c) => Math.hypot(c.p.root.position.x - DOOR.x, c.p.root.position.z - DOOR.z) < 1.6) ? 1 : 0;
  updateBubbles();
  for (const q of POPS){ if (q.t < 9){ q.t += dt; q.s.position.y += dt * 0.25; q.s.material.opacity = clamp(2 - q.t); if (q.t > 2){ q.s.visible = false; q.t = 9; } } }
  fx.update(dt);
  for (const m of msgs) m.t -= dt;
  if (msgs.length && msgs[0].t <= 0){ while (msgs.length && msgs[0].t <= 0) msgs.shift(); drawMsgs(); drawWrist(); }
  if (bannerT > 0){ bannerT -= dt; if (bannerT <= 0){ $('banner').classList.remove('show'); vrBanMesh.visible = false; } }
  hudT -= dt; if (hudT <= 0){ hudT = 0.2; updateHUD(); }
  saveT += dt; if (saveT > 20 && mode !== 'title'){ saveT = 0; store(); }
}
const peopleRainbow = () => peopleKit().rainbow, peopleStripes = () => peopleKit().stripes;
renderer.setAnimationLoop(frame);

// ---------- HUD (only what changed is redrawn) ----------
const hudLast = {};
function setHTML(id, html){ if (hudLast[id] !== html){ hudLast[id] = html; $(id).innerHTML = html; } }
function esc(s){ return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]); }
function updateHUD(force){
  if (mode !== 'screen' && !force) return;
  const waiting = customers.filter((c) => c.state !== 'leave' && !c.demo).length;
  setHTML('h-money', `💰 <b>${fmtMoney(save.money)}</b>`);
  setHTML('h-info', `☀ Day <b>${day.n}</b> · 👥 <b>${Math.max(0, day.total - day.spawned) + waiting}</b> to go · 🔬 <b>${Object.keys(save.found).length}</b>/${FINDABLE.length}`);
  const s = coneStatus(), fr = front();
  let st = `<span class="cs">${esc(s.text)}</span>`;
  if (cur.base) st += s.known ? `<span class="known">📖 ${esc(s.known)}</span>` : '<span class="unknown">❓ Never tried: what will it do?</span>';
  if (fr && fr.order.kind === 'effect' && cur.base && s.known){ const ok = save.cat[recipeKey(cur.base, cur.ings)].effects.some((e) => e.id === fr.order.id); st += ok ? '<span class="match">✓ Just what they want!</span>' : ''; }
  setHTML('cone-status', st);
  let ord = '';
  if (fr){ const o = fr.order; ord = o.kind === 'effect' ? `They want: <b>${EFFECTS[o.id].emoji} ${esc(EFFECTS[o.id].name)}</b>${save.found[o.id] ? '' : ' (nobody knows how yet!)'}` : o.kind === 'delicious' ? 'They want: <b>😋 something delicious</b>' : 'They want: <b>🍦 any ice cream</b>'; }
  setHTML('h-order', ord);
  $('h-order').style.display = ord ? '' : 'none';
  const canServe = !!(fr && cur.base);
  if (hudLast.serve !== canServe){ hudLast.serve = canServe; $('b-serve').classList.toggle('ready', canServe); }
}

// ---------- title screen, starting and stopping ----------
function toTitle(){
  if (mode === 'vr' && renderer.xr.isPresenting){ mode = 'title'; renderer.xr.getSession().end().catch(() => {}); }
  store(); closePanels();
  mode = 'title'; $('title').classList.remove('hidden'); document.body.classList.remove('playing');
  cur.base = null; cur.ings = []; cone.set(null, []);
  clearShop(); day = { n: save.day, total: 0, spawned: 0, spawnT: 0.5, over: false, endT: 0 };
  refreshTitle();
}
function refreshTitle(){
  const n = Object.keys(save.found).length;
  $('b-new').style.display = hadSave || save.served > 0 ? '' : 'none';
  $('b-play').textContent = save.day > 1 || save.served ? `Open the shop (day ${save.day})` : 'Open the shop';
  $('t-best').textContent = save.served ? `💰 ${fmtMoney(save.money)} · 🔬 ${n} of ${FINDABLE.length} effects found · 📖 ${Object.keys(save.cat).length} recipes` : '';
}
function ensureGame(newOne){
  if (newOne){ const { turn, welcomed } = save; save = { ...structuredClone(DEFAULTS), turn, welcomed }; hadSave = true; store(); world.setStock(save.ings, save.bases); }
  cur.base = null; cur.ings = []; cone.set(null, []);
  standAt(START);
  startDay(save.day);
  refreshTray(true);
}
function startScreen(newOne){
  startAudio(); ensureGame(newOne);
  mode = 'screen'; $('title').classList.add('hidden'); document.body.classList.add('playing');
  clock.getDelta(); updateHUD(true);
  if (!save.welcomed) welcome();
  else say(`☀ Day ${day.n}: ${day.total} customers are on their way.`);
}
async function startVR(newOne){
  startAudio();
  try {
    const session = await navigator.xr.requestSession('immersive-vr', { requiredFeatures: ['local-floor'] });
    session.addEventListener('end', () => {
      if (mode !== 'vr') return;
      mode = 'title'; $('title').classList.remove('hidden'); document.body.classList.remove('playing');
      camera.position.set(0, 0, 0); camera.quaternion.identity(); rig.position.set(0, 0, 0); rig.quaternion.identity();
      for (const o of [...tubes, ...lasers, ...dots, wristMesh, vrBanMesh]) o.visible = false;
      closePanels(); world.setHover(null);
      store(); toTitle();
    });
    if (window.__ms && window.__ms.xrScale) renderer.xr.setFramebufferScaleFactor(window.__ms.xrScale);
    await renderer.xr.setSession(session);
    try { if (session.supportedFrameRates && session.updateTargetFrameRate){ const r = [...session.supportedFrameRates]; if (r.includes(72)) await session.updateTargetFrameRate(72); } } catch (e) { /* keep the default rate */ }
    mode = 'vr'; $('title').classList.add('hidden');
    vrs.posed = false; vrs.frames = 0; vrPage = null; wristKey = '';
    camera.position.set(0, 1.6, 0); camera.quaternion.identity();
    clock.getDelta();
    ensureGame(newOne);
    standAt({ x: 0, z: 0.05, yaw: 0 });
    if (!save.welcomed) welcome();
    else say(`☀ Day ${day.n}: ${day.total} customers are on their way.`);
  } catch (e) { $('status').textContent = 'Could not start VR: ' + (e && e.message ? e.message : e); }
}
$('b-play').onclick = () => startScreen(false);
$('b-vr').onclick = () => startVR(false);
$('b-new').onclick = () => {
  if (save.served > 0 && !confirm('Start a brand new shop? Your money, ingredients and catalogue go back to the start.')) return;
  if (navigator.xr && $('b-vr').dataset.ok === '1' && confirm('Play in VR? (Cancel to play on this screen.)')) startVR(true); else startScreen(true);
};
toTitle();
if (navigator.xr && navigator.xr.isSessionSupported){
  navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
    $('b-vr').disabled = !ok; $('b-vr').dataset.ok = ok ? '1' : '0';
    $('status').textContent = ok ? 'Headset found: press Play in VR.' : 'No VR headset here: play on this screen (or open this page in a headset\'s browser).';
  }).catch(() => { $('b-vr').disabled = true; });
} else { $('b-vr').disabled = true; $('status').textContent = 'Play on this screen, or open this page in a VR headset\'s browser.'; }
// say on the title screen once everything is saved on this device for offline play
(async function offlineReady(){
  if (!('caches' in window) || !navigator.serviceWorker) return;
  const name = 'mad-scientist-' + VERSION;
  for (let i = 0; i < 120; i++){
    try {
      if (await caches.has(name) && await (await caches.open(name)).match('/experiments/mad-scientist/__offline-ready__')){ $('offline').textContent = '✓ Saved on this device: plays offline'; return; }
    } catch (e) { return; }
    await new Promise((r) => setTimeout(r, 1500));
  }
})();
addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
addEventListener('pagehide', () => { if (mode !== 'title') store(); });

// ---------- for the headless test ----------
function advance(sec, cond){
  const dt = 1 / 30;
  for (let t = 0; t < sec; t += dt){ simulate(dt); if (cond && cond()) return true; }
  return cond ? !!cond() : true;
}
function look(p){
  const dx = p.x - player.pos.x, dz = p.z - player.pos.z, dy = p.y - EYE;
  player.yaw = Math.atan2(-dx, -dz); player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  placeScreenCamera();
}
// one customer at the counter showing some effects (for the test's gallery of effects)
function showEffect(effs, seed){
  clearShop(); day.spawned = day.total;
  if (seed != null) seedN = seed;
  const c = spawnCustomer(true); c.p.root.position.copy(QUEUE[0]); c.p.root.rotation.y = 0; c.path = [];
  c.state = 'react'; c.t = 0; c.reactFor = 1e9; c.result = { effects: effs }; c.said = true;
  c.p.apply(effs); return c;
}
window.__ms = {
  get mode(){ return mode; }, get day(){ return day; }, get save(){ return save; }, set save(s){ save = upgrade(s); world.setStock(save.ings, save.bases); refreshTray(true); }, get time(){ return gameTime; },
  get head(){ return headPos.toArray(); }, get vrPage(){ return vrPage; }, get cur(){ return cur; }, get queue(){ return queue; }, get front(){ return front(); },
  world, customers, fx, player, renderer, camera, scene, rig, vr, vrs, vrPanel, panel, cone, stick, keys, wristMesh,
  timeScale: 1, noRender: false, paused: false, version: VERSION, START, outcome,
  startScreen, startVR, toTitle, showEffect, startDay, nextDay, chooseBase, addIng, binIt, serve, setRecipe, spawnCustomer, catalogue, shop, menu, welcome, closePanels, advance, look, standAt, pickScreen, use, buy, endOfDay,
  renderNow(){ if (mode !== 'vr') placeScreenCamera(); renderer.render(scene, camera); },
};

// warm up before the loading screen goes: a customer, a cone and the particles drawn once (behind
// the loading screen) so their shaders are ready and the first customer doesn't stutter
async function warmUp(){
  const p = new Person(scene, 1); p.root.position.set(0, 0, -1.55);
  const c = new Cone(); c.set('vanilla', ['sprinkles', 'tnt']); c.group.position.set(0.3, TOP, -0.6); scene.add(c.group);
  fx.stars(V(0, 1.2, -1), 3); fx.update(0.01);
  scene.traverse((o) => { if (o.isMesh || o.isSprite) for (const m of [].concat(o.material)) if (m && m.map) renderer.initTexture(m.map); });
  try { if (renderer.compileAsync) await renderer.compileAsync(scene, camera); } catch (e) { /* compiled on first draw instead */ }
  placeScreenCamera(); renderer.render(scene, camera);
  p.dispose(); scene.remove(c.group); fx.clear();
}
await warmUp();
if (window.__loaded) window.__loaded();
