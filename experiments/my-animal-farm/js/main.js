// My Animal Farm: the main loop. Works three ways from the same game:
//  - VR (WebXR, e.g. a Quest's browser): your real hands hold the brush, the fork, the bucket; point and
//    pull the trigger at a horse or a person to talk to them; the left stick walks, the right stick turns.
//  - iPad / phone: a thumb stick on the left to walk, drag to look, tap things to pick up and use them.
//  - Computer: WASD to walk, drag the mouse to look, click to tap.
import * as THREE from 'three';
import { V, clamp, lerp, damp, angleDiff, fmtMoney, fmtTime } from './util.js';
import { setAnisotropy } from './textures.js';
import { Sky } from './sky.js';
import { buildWorld, pushOut, colliders, PLACES, BARN, PADDOCK, PENS, ARENA, SHOW, stallAt, inBox, insideBarn, STALL_W } from './world.js';
import { Farm, Horse, DAY_START, NIGHT, PRICES, SUPPLY_UNITS, SUPPLY_PACK, isShowDay, dayName, horseValue, SAVE_KEY } from './farm.js';
import { Care, BINS } from './care.js';
import { Riding, GEARS, CLASSES } from './riding.js';
import { BREEDS, COATS } from './horse.js';
import { SPECIES } from './animals.js';
import { Person, Hand } from './people.js';
import { ScreenUI, VRPanel, WristPanel } from './ui.js';
import { startAudio, setListener, sfx, setNight } from './audio.js';

const $ = (id) => document.getElementById(id);
const VERSION = document.body.dataset.version || '';
const TIME_RATE = 1;          // game minutes per real second
const EYE = 1.6, REACH = 3.2;

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
renderer.setPixelRatio(dpr);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true; renderer.xr.setReferenceSpaceType('local-floor'); renderer.xr.setFoveation(0.5);
document.body.prepend(renderer.domElement);
setAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 1200);
const rig = new THREE.Group(); rig.add(camera); scene.add(rig);

const sky = new Sky(scene, renderer);
const world = buildWorld(scene);
const farm = new Farm(scene, world);
const care = new Care(scene, farm, world);
const riding = new Riding(scene, farm, world);
const screenUI = new ScreenUI();
const vrPanel = new VRPanel(scene);
const wrist = new WristPanel();

// the rider you see in third person
const rider = new Person({ rider: true, helmet: true, seed: 5, shirt: 0x2a4a7a });
rider.root.visible = false; scene.add(rider.root);

// ---------- state ----------
let mode = 'title';           // 'title' | 'screen' | 'vr'
const player = { pos: V(PLACES.start.x, 0, PLACES.start.z), yaw: 0, pitch: -0.1, vel: V(), leading: null, held: null, view: 'third' };
player.yaw = Math.PI;         // facing north, toward the barn
const settings = { snap: true, quality: 'auto' };
try { Object.assign(settings, JSON.parse(localStorage.getItem('my-animal-farm-settings') || '{}')); } catch (e) {}
const saveSettings = () => { try { localStorage.setItem('my-animal-farm-settings', JSON.stringify(settings)); } catch (e) {} };
const headPos = V(), headQuat = new THREE.Quaternion();
let paused = false, gameTime = 0, saveT = 0, hudT = 0;
const msgs = [];
farm.on('say', ({ text, kind }) => { msgs.push({ text, kind, t: kind === 'hint' ? 3.5 : 5 }); while (msgs.length > 3) msgs.shift(); if (kind === 'money') sfx.coin(); else if (kind === 'bad') sfx.bad(); drawWrist(); });
farm.on('hoof', ({ horse, i, gait }) => { if (horse.root.visible && horse.pos.distanceToSquared(player.pos) < 900) sfx.hoof(horse.pos, groundAt(horse.pos), gait); });
farm.on('roll', (h) => { if (h.pos.distanceTo(player.pos) < 30) sfx.snort(h.pos); });
farm.on('horseGone', (h) => { if (player.leading === h) player.leading = null; });

function groundAt(p){
  if (inBox(p, ARENA) || inBox(p, SHOW)) return 'sand';
  if (insideBarn(p)) return Math.abs(p.x) < BARN.aisle ? 'hard' : 'sand';
  if (inBox(p, { x0: -8, x1: 8, z0: -4, z1: 8 }) || inBox(p, { x0: -3, x1: 3, z0: 8, z1: 30 }) || inBox(p, { x0: -90, x1: 120, z0: 24, z1: 30 })) return 'gravel';
  return 'grass';
}

// ---------- hotspots: invisible shapes for things you tap or touch ----------
const hot = [];
function hotspot(type, pos, size, extra = {}){
  const m = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshBasicMaterial({ visible: false }));
  m.position.copy(pos); m.userData.hot = { type, ...extra }; scene.add(m); hot.push(m); return m;
}
farm.stalls.forEach((s, i) => {
  hotspot('rack', s.rackPos.clone().setY(1.15), [0.7, 0.9, 1.0], { stall: i });
  hotspot('tub', s.tubPos, [0.6, 0.35, 0.6], { stall: i });
  hotspot('stall', V(s.center.x, 0.12, s.center.z), [Math.abs(s.xb - s.xa) - 0.2, 0.25, STALL_W - 0.2], { stall: i });
});
hotspot('hayStack', V(PLACES.hayStack.x, 0.8, PLACES.hayStack.z + 0.25), [1.1, 1.6, 1.9]);
hotspot('carrots', V(PLACES.carrots.x, PLACES.carrots.y + 0.1, PLACES.carrots.z), [0.5, 0.3, 0.4]);
hotspot('shavings', V(PLACES.shavings.x, 0.7, PLACES.shavings.z), [0.6, 1.4, 0.85]);
for (const [k, p] of Object.entries(BINS)) hotspot('bin', V(p.x, 0.45, p.z), k === 'grain' ? [0.7, 0.9, 0.7] : [0.5, 0.7, 0.5], { bin: k });
hotspot('tap', world.fixtures.tap.pos, [0.35, 0.5, 0.5]);
hotspot('heap', V(PLACES.manureHeap.x, 0.6, PLACES.manureHeap.z), [3.6, 1.2, 3]);
hotspot('board', world.fixtures.board.pos, [0.3, 1.2, 1.6]);
hotspot('rail', V(PLACES.rail.x, 1.0, PLACES.rail.z), [2.8, 0.4, 0.3]);
hotspot('lights', world.barnLights.switchPos, [0.3, 0.4, 0.2]);
hotspot('paddockTrough', V(-13, 0.4, -7), [1.9, 0.7, 0.8]);
hotspot('showOffice', V(28, 1.6, 33.4), [3, 2.4, 0.6]);
farm.pens.forEach((p, i) => {
  hotspot('feeder', V(p.feedPos.x, 0.35, p.feedPos.z), [1.5, 0.6, 0.6], { pen: i });
  hotspot('trough', V(p.waterPos.x, 0.35, p.waterPos.z), [1.3, 0.6, 0.65], { pen: i });
  if (p.kind === 'chicken') hotspot('nest', V((p.x0 + p.x1) / 2 - 1.95, 1.1, p.z0 + 1.6), [1.0, 0.6, 0.6], { pen: i });
});

// Work out what a raycast hit is.
function resolve(obj, point){
  for (let o = obj; o; o = o.parent){
    const u = o.userData;
    if (u.itemRef) return { type: 'item', item: u.itemRef, point };
    if (u.ringHoof != null && u.horse) return { type: 'hoof', horse: u.horse, hoof: u.ringHoof, point: u.horse.model.hoof(u.ringHoof) };
    if (u.hot) return { ...u.hot, point };
    if (u.kind === 'manure' || u.kind === 'wet') return { type: u.kind, stall: u.stall, index: u.index, point };
    if (u.kind === 'dropping') return { type: 'dropping', pen: u.pen, index: u.index, point };
    if (u.kind === 'eggs') return { type: 'nest', pen: u.pen, point };
    if (u.stallBucket != null) return { type: 'stallBucket', stall: u.stallBucket, point };
    if (u.visitor) return { type: 'visitor', offer: farm.offers.find((x) => x.id === u.visitor), point };
    const h = farm.horses.find((x) => x.root === o);
    if (h) return horseTarget(h, point);
    const a = farm.animals.find((x) => x.root === o);
    if (a) return { type: 'pet', animal: a, point };
  }
  return null;
}
// a hit on a horse: its head, a hoof, or its body
function horseTarget(h, point){
  const m = h.model;
  if (point.distanceTo(m.poll()) < 0.35 || point.distanceTo(m.muzzle()) < 0.3) return { type: 'head', horse: h, point };
  let best = -1, bd = 0.28;
  for (let i = 0; i < 4; i++){ const d = point.distanceTo(m.hoof(i)); if (d < bd){ bd = d; best = i; } }
  if (best >= 0 || point.y < 0.45 * m.scale) {
    if (best < 0){ bd = 9; for (let i = 0; i < 4; i++){ const d = point.distanceTo(m.hoof(i)); if (d < bd){ bd = d; best = i; } } }
    return { type: 'hoof', horse: h, hoof: best, point };
  }
  return { type: 'horse', horse: h, point };
}
const raycaster = new THREE.Raycaster();
function pickables(){
  const list = [...hot];
  for (const it of care.pickables()) if (it.mesh.visible && (!it.held || it.kind === 'barrow')) list.push(it.mesh);
  for (const b of care.stallBuckets) list.push(b);
  for (const r of hoofRingMeshes) if (r.visible) list.push(r);
  for (const h of farm.horses) if (h.root.visible && h !== riding.horse) list.push(h.root);
  for (const a of farm.animals) list.push(a.root);
  for (const s of farm.stalls){ list.push(...s.manureMeshes); if (s.wetMesh && s.wetMesh.visible) list.push(s.wetMesh); }
  for (const p of farm.pens){ list.push(...p.droppingMeshes, ...p.eggMeshes); }
  for (const v of farm.visitors){ list.push(v.person.root); if (v.horse) list.push(v.horse.root); }
  return list;
}
function castFrom(origin, dir, far = 8){
  raycaster.set(origin, dir); raycaster.far = far;
  const hits = raycaster.intersectObjects(pickables(), true);
  // the bedding hotspot is big: prefer anything else hit just behind it
  for (const h of hits){
    if (held() && h.object.userData.itemRef === held()) continue;
    const r = resolve(h.object, h.point);
    if (!r) continue;
    if (r.type === 'stall'){ const other = hits.find((x) => x !== h && x.distance < h.distance + 1.2 && resolve(x.object, x.point) && resolve(x.object, x.point).type !== 'stall'); if (other) return { ...resolve(other.object, other.point), dist: other.distance }; }
    return { ...r, dist: h.distance };
  }
  return null;
}

// ---------- holding things ----------
const handsVR = [new Hand('left'), new Hand('right')];
const held = (i = 1) => player.heldBy ? player.heldBy[i] : null;
player.heldBy = [null, null];
function pickUp(it, hand = 1){
  // whatever's in that hand goes back
  const cur = player.heldBy[hand];
  if (cur && cur !== it) putBack(cur);
  if (it.held != null){ const other = player.heldBy.indexOf(it); if (other >= 0) player.heldBy[other] = null; }
  player.heldBy[hand] = it; it.held = { hand }; it.homeNow = false; it.onFloor = false;
  if (it.kind !== 'barrow'){
    if (mode === 'vr') attachToHand(it, hand); else attachToView(it);
  }
  sfx.pickup();
  hintFor(it);
}
function putBack(it){
  const i = player.heldBy.indexOf(it); if (i >= 0) player.heldBy[i] = null;
  it.held = null;
  scene.attach(it.mesh);
  if (it.temp){
    // a flake or carrot you didn't use goes back where it came from
    const S = farm.state.supplies;
    if (it.kind === 'flake') S.loose = (S.loose || 0) + 1; else if (it.kind === 'carrot') S.carrots++; else if (it.kind === 'bag'){ S.shavings++; farm.refreshSupplies(); }
    care.dropTemp(it);
  } else if (it.kind !== 'barrow') care.home(it);
}
function dropHere(it){
  // VR: let go of something in mid-air: it falls where it is
  const i = player.heldBy.indexOf(it); if (i >= 0) player.heldBy[i] = null;
  it.held = null; scene.attach(it.mesh);
  it.mesh.rotation.set(0, it.mesh.rotation.y, 0);
}
const VIEW_POSE = {
  curry: [V(0.22, -0.2, -0.45), [0.6, 0, 0]], brush: [V(0.22, -0.2, -0.45), [0.6, 0.3, 0]], hoofpick: [V(0.2, -0.2, -0.4), [-0.6, 0, 0.3]],
  pad: [V(0.25, -0.32, -0.6), [0.3, 0, 0]], saddle: [V(0.25, -0.35, -0.65), [0.3, -0.4, 0]], bridle: [V(0.22, -0.15, -0.5), [0, 0.3, 0]],
  fork: [V(0.3, -0.05, -0.55), [0.5, 0, -0.2]], bucket: [V(0.25, -0.15, -0.5), [0.1, 0, 0]], scoop: [V(0.2, -0.2, -0.45), [0.3, -0.5, 0]],
  flake: [V(0.22, -0.25, -0.55), [0.4, 0.3, 0]], carrot: [V(0.2, -0.18, -0.4), [0.3, -0.6, 0]], bag: [V(0.25, -0.35, -0.65), [0.4, 0.3, 0]],
  shears: [V(0.2, -0.18, -0.42), [0.4, -0.5, 0]],
};
function attachToView(it){
  camera.add(it.mesh);
  const [p, r] = VIEW_POSE[it.kind] || [V(0.2, -0.2, -0.5), [0, 0, 0]];
  it.mesh.position.copy(p); it.mesh.rotation.set(...r);
  it.mesh.traverse((o) => { if (o.isMesh) o.castShadow = false; });
}
const GRIP_POSE = {
  curry: [V(0, -0.01, -0.03), [0, 0, Math.PI / 2]], brush: [V(0, -0.01, -0.03), [0, 0, Math.PI / 2]], hoofpick: [V(0, -0.02, -0.02), [-Math.PI / 2, 0, 0]],
  pad: [V(0, -0.05, -0.15), [0, 0, 0]], saddle: [V(0, -0.1, -0.15), [0, 0, 0]], bridle: [V(0, -0.02, -0.02), [0, 0, 0]],
  fork: [V(0, 0, -0.02), [-Math.PI / 2 + 0.3, 0, 0]], bucket: [V(0, 0.02, -0.02), [0, 0, 0]], scoop: [V(0, 0.06, -0.02), [-Math.PI / 2, 0, 0]],
  flake: [V(0, -0.05, -0.12), [0, 0, 0]], carrot: [V(0, 0, -0.06), [0, 0, 0]], bag: [V(0, -0.1, -0.2), [0, 0, 0]], shears: [V(0, 0, -0.04), [-Math.PI / 2, 0, 0]],
};
function attachToHand(it, hand){
  handsVR[hand].group.add(it.mesh);
  const [p, r] = GRIP_POSE[it.kind] || [V(), [0, 0, 0]];
  it.mesh.position.copy(p); it.mesh.rotation.set(...r);
}
function hintFor(it){
  const t = {
    curry: 'Curry comb: rub it in circles over the muddy patches to loosen the dirt.',
    brush: 'Body brush: flick it along the coat to lift the loosened dirt away.',
    hoofpick: 'Hoof pick: tap each hoof with a yellow ring round it (in VR, touch it with the pick). She lifts her foot and you scrape it clean.',
    pad: 'Saddle pad: put it on the horse\'s back first.',
    saddle: 'Saddle: goes on top of the pad, then do up the girth.',
    bridle: 'Bridle: put it over the horse\'s head.',
    fork: 'Manure fork: lift droppings and wet bedding into the wheelbarrow.',
    barrow: 'Pushing the wheelbarrow. Tip it on the muck heap behind the barn.',
    bucket: 'Water bucket: fill it at the tap in the feed room.',
    scoop: 'Feed scoop: fill it from a feed bin.',
    flake: 'A flake of hay: put it in a horse\'s hay rack or the goat/sheep feeder.',
    carrot: 'A carrot: give it to a horse (or a goat!).',
    bag: 'Shavings: spread them in a clean stall.',
    shears: 'Shears: for sheep with long fleeces.',
  }[it.kind];
  if (t) farm.say(t, 'hint');
}

// a flake, carrot or bag that got used up leaves your hand
care.onDropTemp = (it) => { const i = player.heldBy.indexOf(it); if (i >= 0) player.heldBy[i] = null; };

function toggleLights(){
  const on = !world.barnLights.on;
  world.barnLights.set(on); farm.state.lights = on; sfx.ui();
  farm.say(on ? 'Barn lights on.' : 'Barn lights off.', 'hint');
}

// ---------- leading a horse ----------
function startLead(h){
  if (riding.horse) return;
  if (player.leading && player.leading !== h) letGo();
  if (h.mode === 'stall' && h.stall){ /* walk it out */ }
  h.mode = 'led'; h.data.place = 'led'; h.leader = { pos: player.pos }; h.tie = null;
  player.leading = h;
  sfx.nicker(h.model.muzzle());
  farm.say(`Leading ${h.data.name}. Let go in a stall, in the paddock or at the hitching rail.`, 'hint');
}
function letGo(){
  const h = player.leading; if (!h) return;
  player.leading = null;
  const p = h.pos;
  const si = stallAt(p);
  if (si >= 0 && (!farm.stalls[si].horse || farm.stalls[si].horse === h.data.id)){
    if (h.stall && h.data.stall !== si) h.stall.horse = null;
    h.toStall(si); farm.say(`${h.data.name} is in stall ${si + 1}.`, 'hint'); return;
  }
  if (inBox(p, PADDOCK, -0.5)){ h.toPaddock(); farm.say(`${h.data.name} is out in the paddock.`, 'hint'); sfx.whinny(h.model.muzzle()); return; }
  if (p.distanceTo(PLACES.rail) < 3.5){ tieAtRail(h); return; }
  h.mode = 'loose'; h.data.place = 'loose'; h.leader = null;
  farm.say(`${h.data.name} is standing loose. Tie her up at the rail or put her in a stall.`.replace(/her/g, h.data.sex === 'mare' ? 'her' : 'him'), 'hint');
}
function tieAtRail(h){
  const taken = farm.horses.filter((x) => x !== h && x.mode === 'tied').map((x) => x.tie.pos.x);
  const xs = [PLACES.rail.x - 0.9, PLACES.rail.x + 0.9].filter((x) => !taken.some((t) => Math.abs(t - x) < 0.5));
  const x = xs.length ? xs.reduce((a, b) => (Math.abs(b - h.pos.x) < Math.abs(a - h.pos.x) ? b : a)) : PLACES.rail.x;
  if (player.leading === h) player.leading = null;
  h.tieAt(V(x, 0, PLACES.rail.z + 1.25), Math.PI);
  farm.say(`${h.data.name} is tied at the hitching rail: a good spot to groom and tack up.`, 'hint');
}

// ---------- riding ----------
riding.on('mount', (h) => { if (player.leading === h) player.leading = null; for (const it of player.heldBy) if (it) putBack(it); updateRideUI(); });
riding.on('dismount', (h) => {
  // you step off on the left and hold the reins
  const side = V(Math.cos(h.yaw), 0, -Math.sin(h.yaw));
  player.pos.copy(h.pos).addScaledVector(side, 1.0).addScaledVector(V(Math.sin(h.yaw), 0, Math.cos(h.yaw)), 0.6);
  pushOut(player.pos, 0.3, { ignore: ignoreCol });
  if (mode === 'vr'){ placeRigAt(player.pos); }
  player.yaw = h.yaw;
  startLead(h);
  updateRideUI();
});
riding.on('results', (r) => {
  if (r.eliminated) return;
  const rows = r.table.map((x, i) => ({ title: `${i + 1}. ${x.name}`, sub: `${x.faults} faults · ${x.time.toFixed(1)}s` }));
  showPanel({ title: r.place === 1 ? 'You won!' : `Results: ${['', '1st', '2nd', '3rd', '4th'][r.place] || r.place + 'th'} place`, sections: [
    { text: `${r.cls.name}: ${r.faults} faults (${r.rails} rails, ${r.refusals} refusals, ${r.timeFaults} time) in ${r.time.toFixed(1)} seconds.${r.prize ? ' Prize money: ' + fmtMoney(r.prize) + '.' : ''}${r.place <= 4 ? ' Your rosette is on the board in the tack room.' : ''}` },
    { rows }, { buttons: [{ label: 'OK', kind: 'primary', go: closePanel }] }] });
});

// ---------- panels ----------
function showPanel(spec){
  paused = true;
  const s = { ...spec, onClose: () => { paused = false; if (spec.onClose) spec.onClose(); } };
  if (mode === 'vr') vrPanel.show(s, panelAnchor ? null : headPos, headQuat); else screenUI.show(s);
  sfx.ui();
}
let panelAnchor = null;
function closePanel(){ if (mode === 'vr') vrPanel.close(); else screenUI.close(); }
function refreshPanel(fn){ closePanel(); fn(); }
const pct = (v) => Math.round(clamp(v, 0, 100));

function horsePanel(h){
  const D = h.data, N = D.needs, T = D.tack;
  const clean = 100 - h.model.dirtiness() * 140, hooves = 100 - Math.max(...D.hooves) * 100;
  const B = BREEDS[D.breed];
  const buttons = [];
  const ridingThis = riding.horse === h;
  if (!ridingThis){
    if (player.leading === h) buttons.push({ label: 'Let go here', go: () => { closePanel(); letGo(); } });
    else buttons.push({ label: h.mode === 'stall' ? 'Lead out' : 'Lead', kind: 'primary', go: () => { closePanel(); startLead(h); } });
    if (player.pos.distanceTo(PLACES.rail) < 6 && h.mode !== 'tied') buttons.push({ label: 'Tie to rail', go: () => { closePanel(); tieAtRail(h); } });
    if (h.tacked() && h.mode !== 'stall') buttons.push({ label: 'Ride', kind: 'primary', go: () => { closePanel(); riding.mount(h); } });
    if (T.saddle && !T.girth) buttons.push({ label: 'Do up girth', go: () => { care.girth(h); refreshPanel(() => horsePanel(h)); } });
    if (T.bridle) buttons.push({ label: 'Take off bridle', go: () => { const it = care.untack(h, 'bridle'); if (it) pickUp(it, 1); refreshPanel(() => horsePanel(h)); } });
    if (T.saddle) buttons.push({ label: 'Take off saddle', go: () => { const it = care.untack(h, 'saddle'); if (it) pickUp(it, 1); refreshPanel(() => horsePanel(h)); } });
    if (T.pad && !T.saddle) buttons.push({ label: 'Take off pad', go: () => { const it = care.untack(h, 'pad'); if (it) pickUp(it, 1); refreshPanel(() => horsePanel(h)); } });
  } else buttons.push({ label: 'Dismount', go: () => { closePanel(); riding.dismount(); } });
  const tackList = ['pad', 'saddle', 'girth', 'bridle'].filter((k) => T[k]).map((k) => ({ pad: 'pad', saddle: 'saddle', girth: 'girth done up', bridle: 'bridle' }[k]));
  const where = { stall: `in stall ${D.stall + 1}`, paddock: 'in the paddock', tied: 'tied at the rail', led: 'on a lead', loose: 'standing loose', ridden: 'being ridden' }[h.mode] || '';
  showPanel({ title: D.name, sections: [
    { text: `${D.age}-year-old ${COATS[D.coat].name.toLowerCase()} ${B.name} ${D.sex}, ${where}.${D.owner ? ` Boarding for ${D.owner.who} (${D.owner.daysLeft} more day${D.owner.daysLeft === 1 ? '' : 's'}).` : ''}` },
    { bars: [['Food', N.food], ['Water', N.water], ['Energy', N.energy], ['Happiness', N.happy], ['Health', N.health], ['Clean coat', clean], ['Hooves', hooves, hooves < 60 ? 'pick them out' : ''], ['Shoes', D.shoes]] },
    { bars: [['Jumping', D.skill * 100, `${Math.round(D.skill * 100)}%`], ['Fitness', D.fitness * 100]] },
    { text: tackList.length ? `Wearing: ${tackList.join(', ')}.` : 'No tack on (just a halter).' },
    { buttons },
  ] });
}
function animalPanel(a){
  const D = a.data;
  const btns = [{ label: 'Pet', kind: 'primary', go: () => { D.happy = Math.min(100, D.happy + 5); sfx.bleat(a.pos, a.kind); closePanel(); } }];
  showPanel({ title: `${D.name} the ${SPECIES[a.kind].name.toLowerCase()}`, sections: [
    { text: D.owner ? `Boarding for ${D.owner.who} (${D.owner.daysLeft} more days).` : `One of your ${a.kind === 'chicken' ? 'hens' : a.kind + 's'}.` },
    { bars: [['Food', D.food], ['Water', D.water], ['Happiness', D.happy], ['Health', D.health], ...(a.kind === 'sheep' ? [['Fleece', D.wool * 100]] : [])] },
    { buttons: btns },
  ] });
}
function visitorPanel(o){
  if (!o) return;
  if (o.pickup){
    const h = farm.horseById(o.pickup), a = farm.animals.find((x) => x.data.id === o.pickup), D = (h || a).data;
    const avg = (D.owner.scores || []).reduce((x, y) => x + y, 0) / Math.max(1, (D.owner.scores || []).length);
    showPanel({ title: o.who, sections: [{ text: `"I've come to collect ${D.name}. How did it go?" They paid ${fmtMoney(D.owner.paid || 0)} so far; your care score is ${Math.round(avg * 100)}%. Great care earns a tip.` }, { buttons: [{ label: `Hand over ${D.name}`, kind: 'primary', go: () => { closePanel(); farm.acceptOffer(o); } }] }] });
    return;
  }
  const what = o.kind === 'horse' ? `my ${BREEDS[o.horse.breed].name.toLowerCase()} ${o.horse.name}` : `my ${o.n} ${o.kind === 'chicken' ? 'hens' : o.kind + (o.n > 1 ? 's' : '')}`;
  showPanel({ title: o.who, sections: [
    { text: `"Hello! Could you look after ${what} for ${o.days} days? I'll pay up to ${fmtMoney(o.rate)} a day, depending on how well they're cared for."` },
    { buttons: [{ label: 'Yes, happy to', kind: 'primary', go: () => { closePanel(); farm.acceptOffer(o); } }, { label: 'Sorry, not now', go: () => { closePanel(); farm.declineOffer(o); } }] },
  ] });
}

// The Farm Office: jobs, horses, shop, animals, shows, the day
let officeTab = 'jobs';
function office(tab = officeTab){
  officeTab = tab;
  const S = farm.state;
  const tabs = [['jobs', 'Jobs'], ['horses', 'Horses'], ['shop', 'Shop'], ['animals', 'Animals'], ['shows', 'Shows'], ['day', 'Day']].map(([id, label]) => ({ label, active: id === tab, go: () => refreshPanel(() => office(id)) }));
  const secs = [{ text: `${dayName(S.day)}, day ${S.day} · ${fmtTime(S.minutes)} · ${fmtMoney(S.money)}${isShowDay(S.day) ? ' · Show day!' : ''}` }];
  if (tab === 'jobs'){
    const J = farm.jobs();
    secs.push({ heading: 'Still to do', list: J.length ? J.map((j) => j.text) : ['All done! Ride, train for the next show, or go to bed early.'] });
    secs.push({ heading: 'Supplies', text: `Hay: ${S.supplies.hay} bales${S.supplies.loose ? ` + ${S.supplies.loose} flakes` : ''} · Grain: ${S.supplies.grain} scoops · Shavings: ${S.supplies.shavings} bags · Carrots: ${S.supplies.carrots} · Pig feed: ${S.supplies.pigfeed} · Corn: ${S.supplies.corn} · Eggs: ${S.supplies.eggs} · Fleeces: ${S.supplies.wool || 0}` });
  }
  if (tab === 'horses'){
    secs.push({ heading: 'Your horses', rows: farm.horses.map((h) => ({ title: h.data.name + (h.data.owner ? ` (boarder)` : ''), sub: `${BREEDS[h.data.breed].name} · food ${pct(h.data.needs.food)} · water ${pct(h.data.needs.water)} · happy ${pct(h.data.needs.happy)} · jump ${Math.round(h.data.skill * 100)}%`, button: h.data.owner ? null : { label: `Sell ${fmtMoney(horseValue(h.data))}`, go: () => { farm.sellHorse(h); refreshPanel(() => office('horses')); } } })) });
    secs.push({ heading: 'Horses for sale (new ones every 3 days)', rows: farm.market().map((d) => ({ title: `${d.name}: ${BREEDS[d.breed].name}`, sub: `${COATS[d.coat].name} ${d.sex}, ${d.age} yrs, jumping ${Math.round(d.skill * 100)}% (breed talent ${Math.round(BREEDS[d.breed].jump * 100)}%)`, button: { label: fmtMoney(d.price), disabled: S.money < d.price, go: () => { farm.buyHorse(d); refreshPanel(() => office('horses')); } } })) });
  }
  if (tab === 'shop'){
    const names = { hay: 'Hay bale (10 flakes)', grain: 'Bag of grain (30 scoops)', shavings: 'Bag of pine shavings', carrots: 'Carrots (10)', pigfeed: 'Pig feed (30 scoops)', corn: 'Chicken corn (30 scoops)' };
    secs.push({ heading: 'Supplies (delivered to the feed room)', rows: Object.keys(PRICES).filter((k) => names[k]).map((k) => ({ title: names[k], sub: `You have ${S.supplies[k]} ${SUPPLY_UNITS[k]}`, button: { label: fmtMoney(PRICES[k]), disabled: S.money < PRICES[k], go: () => { if (farm.buySupply(k)) sfx.coin(); refreshPanel(() => office('shop')); } } })) });
    secs.push({ heading: 'Services', rows: [
      { title: 'Farrier', sub: 'New shoes and trimmed hooves for every horse that needs them', button: { label: `${fmtMoney(PRICES.farrier)} each`, go: () => { farm.callFarrier(); refreshPanel(() => office('shop')); } } },
      { title: 'Vet', sub: 'Checks and treats every animal on the farm', button: { label: fmtMoney(PRICES.vet), go: () => { farm.callVet(); refreshPanel(() => office('shop')); } } },
    ] });
    secs.push({ heading: 'Sell produce', rows: [
      { title: `Eggs: ${S.supplies.eggs}`, sub: '50¢ each', button: { label: 'Sell', disabled: !S.supplies.eggs, go: () => { farm.sellProduce('eggs'); refreshPanel(() => office('shop')); } } },
      { title: `Fleeces: ${S.supplies.wool || 0}`, sub: '$18 each', button: { label: 'Sell', disabled: !S.supplies.wool, go: () => { farm.sellProduce('wool'); refreshPanel(() => office('shop')); } } },
    ] });
  }
  if (tab === 'animals'){
    secs.push({ heading: 'Buy animals', rows: Object.entries(SPECIES).map(([k, sp]) => { const pen = farm.pens.find((p) => p.kind === k); return { title: sp.name, sub: `${pen.list.length}/${farm.penCapacity(k)} in the pen · eats ${sp.food}`, button: { label: fmtMoney(sp.price), disabled: S.money < sp.price || pen.list.length >= farm.penCapacity(k), go: () => { farm.buyAnimal(k); refreshPanel(() => office('animals')); } } }; }) });
    secs.push({ heading: 'Boarders', text: farm.offers.length ? `${farm.offers.map((o) => o.who).join(', ')} waiting by the house.` : 'Customers come by in the morning to ask if you can look after their animals. Good care means more pay and tips.' });
  }
  if (tab === 'shows'){
    const why = riding.showOpen();
    secs.push({ text: why || 'The show is on today at the show grounds (down the lane). Enter while you\'re riding there.' });
    secs.push({ rows: CLASSES.map((c) => ({ title: c.name, sub: `Entry ${fmtMoney(c.fee)} · prizes ${c.prizes.slice(0, 3).map(fmtMoney).join(' / ')}`, button: { label: (S.shows[S.day] || []).includes(c.id) ? 'Done' : 'Enter', disabled: !!why || (S.shows[S.day] || []).includes(c.id), go: () => { if (riding.enter(c)) closePanel(); } } })) });
    secs.push({ heading: 'Rosettes won', text: S.ribbons.length ? S.ribbons.map((r) => `${['', '1st', '2nd', '3rd', '4th'][r.place]} ${CLASSES.find((c) => c.id === r.cls).name} (${r.horse}, day ${r.day})`).join(' · ') : 'None yet.' });
  }
  if (tab === 'day'){
    secs.push({ text: S.minutes >= 18 * 60 || S.minutes < DAY_START ? 'Done for the day? Check every horse has hay and water for the night.' : 'You can go to bed from 6pm.' });
    secs.push({ buttons: [
      { label: 'Sleep until morning', kind: 'primary', disabled: S.minutes < 18 * 60 && S.minutes >= DAY_START, go: () => { closePanel(); goToSleep(); } },
      { label: settings.snap ? 'VR turning: snap' : 'VR turning: smooth', go: () => { settings.snap = !settings.snap; saveSettings(); refreshPanel(() => office('day')); } },
      { label: 'Save', go: () => { farm.save(); farm.say('Saved.', 'hint'); } },
      { label: 'Back to title', go: () => { closePanel(); toTitle(); } },
    ] });
    secs.push({ text: `Earned so far: ${fmtMoney(S.earned)}. Version ${VERSION}.` });
  }
  showPanel({ title: 'Farm Office', tabs, sections: secs });
}
function goToSleep(){
  if (riding.horse) riding.dismount();
  if (player.leading) letGo();
  for (const it of [...player.heldBy]) if (it) putBack(it);
  const f = $('fade'); f.classList.add('on');
  setTimeout(() => {
    if (farm.sleep()){
      player.pos.set(PLACES.board.x + 2.5, 0, PLACES.board.z + 1); player.yaw = -Math.PI / 2;
      if (mode === 'vr') placeRigAt(player.pos);
      farm.say(`Good morning! ${dayName(farm.state.day)}, day ${farm.state.day}.${isShowDay(farm.state.day) ? ' It\'s show day!' : ''}`, 'info');
    }
    setTimeout(() => f.classList.remove('on'), 400);
  }, 700);
}

// what tapping (or pointing and pulling the trigger at) something with an empty hand does
function activate(t, handIdx = 1){
  if (!t) return false;
  const it = player.heldBy[handIdx];
  if (t.type === 'board'){ office('jobs'); return true; }
  if (t.type === 'lights'){ toggleLights(); return true; }
  if (t.type === 'showOffice'){ office('shows'); return true; }
  if (t.type === 'visitor'){ visitorPanel(t.offer); return true; }
  if (!it){
    if (t.type === 'horse' || t.type === 'head' || t.type === 'hoof'){ horsePanel(t.horse); return true; }
    if (t.type === 'pet'){ animalPanel(t.animal); return true; }
  }
  return false;
}

// a tap on the screen (or a click)
function tap(x, y){
  if (mode !== 'screen' || paused) return;
  const ndc = new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const t = castFrom(raycaster.ray.origin.clone(), raycaster.ray.direction.clone(), 40);
  if (!t) return;
  const d = Math.hypot(t.point.x - player.pos.x, t.point.z - player.pos.z);
  const far = t.type === 'board' || t.type === 'visitor' || t.type === 'showOffice' ? 6 : REACH;
  if (riding.horse && t.type !== 'board' && t.type !== 'showOffice'){ if (t.horse === riding.horse) horsePanel(riding.horse); return; }
  if (d > far){ farm.say('Walk a bit closer.', 'hint'); return; }
  handleTap(t);
}
function handleTap(t){
  const it = player.heldBy[1];
  // pick up an item
  if (t.type === 'item'){
    if (t.item === it){ return; }
    if (it && it.kind === 'fork' && t.item.kind === 'barrow'){ if (care.use(it, { type: 'barrow', point: t.point })) return; }
    if (t.item.kind === 'barrow'){ if (player.barrow){ player.barrow = null; farm.say('Left the wheelbarrow here.', 'hint'); } else { player.barrow = t.item; t.item.homeNow = false; hintFor(t.item); } return; }
    pickUp(t.item, 1); return;
  }
  if (it){
    // use what you're holding on what you tapped
    const target = { ...t, touch: true };
    if (t.type === 'heap' && player.barrow){ care.use(player.barrow, target); return; }
    if (it.kind === 'hoofpick' && t.horse){ const i = t.hoof ?? nearestHoof(t.horse, t.point); care.use(it, { type: 'hoof', horse: t.horse, hoof: i, point: t.horse.model.hoof(i) }, 1); return; }
    if ((it.kind === 'curry' || it.kind === 'brush') && t.horse){ care.use(it, { type: 'horse', horse: t.horse, point: t.point }, 1); swing(it, t.point); return; }
    if ((it.kind === 'pad' || it.kind === 'saddle' || it.kind === 'bridle' || it.kind === 'carrot') && t.horse){ if (care.use(it, { type: t.type === 'head' ? 'head' : 'horse', horse: t.horse, point: t.point })){ player.heldBy[1] = null; if (it.kind !== 'carrot') camera.remove(it.mesh), scene.add(it.mesh); } return; }
    if (it.kind === 'carrot' && t.type === 'pet'){ if (care.use(it, t)) player.heldBy[1] = null; return; }
    if (it.kind === 'shears' && t.type === 'pet'){ care.use(it, t); return; }
    if (t.type === 'manure' || t.type === 'wet' || t.type === 'dropping'){ if (it.kind === 'fork'){ care.use(it, target); swing(it, t.point); } else farm.say('Use the manure fork for that (it\'s on the rack by the back door).', 'hint'); return; }
    if (t.type === 'nest'){ collectEggs(t.pen); return; }
    const before = it.temp;
    const ok = care.use(it, target);
    if (ok){ swing(it, t.point); if (before && !care.temp.includes(it)) player.heldBy[1] = null; return; }
    if (activate(t)) return;
    if (t.type === 'hayStack' || t.type === 'carrots' || t.type === 'shavings'){ takeFrom(t.type); return; }
    return;
  }
  // empty hand
  if (t.type === 'hayStack' || t.type === 'carrots' || t.type === 'shavings'){ takeFrom(t.type); return; }
  if (t.type === 'nest'){ collectEggs(t.pen); return; }
  if (t.type === 'heap' && player.barrow){ care.use(player.barrow, t); return; }
  if (t.type === 'tap') { farm.say('Pick up the water bucket first (it\'s on the floor by the tap).', 'hint'); return; }
  if (t.type === 'bin') { farm.say('Pick up the feed scoop first (it hangs on the grain bin).', 'hint'); return; }
  if (t.type === 'rack' || t.type === 'tub' || t.type === 'stallBucket'){ const s = farm.stalls[t.stall].state; farm.say(`Hay rack: ${s.hay.toFixed(1)} flakes · grain tub: ${s.grain > 0 ? 'some' : 'empty'} · water: ${Math.round(s.water)} of 20 litres.`, 'hint'); return; }
  activate(t);
}
function takeFrom(type){
  const it = type === 'hayStack' ? care.takeFlake() : type === 'carrots' ? care.takeCarrot() : care.takeBag();
  if (it) pickUp(it, 1);
}
function collectEggs(pi){
  const p = farm.pens[pi];
  if (!p.saved.eggs){ farm.say('No eggs yet. Hens lay in the morning.', 'hint'); return; }
  farm.state.supplies.eggs += p.saved.eggs; farm.say(`Collected ${p.saved.eggs} eggs.`, 'good'); p.saved.eggs = 0; farm.refreshPen(pi); sfx.pickup();
}
function nearestHoof(h, p){ let b = 0, bd = 9; for (let i = 0; i < 4; i++){ const d = p.distanceTo(h.model.hoof(i)); if (d < bd){ bd = d; b = i; } } return b; }
// on screen, show the tool reaching to where you used it for a moment
let swingT = 0, swingItem = null, swingPoint = V();
function swing(it, p){ swingT = 0.35; swingItem = it; swingPoint.copy(p); }

// ---------- screen input: thumb stick, look, tap, groom by dragging ----------
const touch = { stick: null, stickId: null, look: new Map(), keys: {}, groom: null };
const stickEl = $('stick'), knobEl = $('knob');
function stickZone(x, y){ return x < window.innerWidth * 0.42 && y > window.innerHeight * 0.42; }
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (mode !== 'screen' || paused) return;
  startAudio();
  renderer.domElement.setPointerCapture(e.pointerId);
  if (e.pointerType !== 'mouse' && touch.stickId == null && stickZone(e.clientX, e.clientY)){
    touch.stickId = e.pointerId; touch.stick = { x0: e.clientX, y0: e.clientY, x: 0, y: 0 };
    stickEl.style.left = (e.clientX - 60) + 'px'; stickEl.style.top = (e.clientY - 60) + 'px'; stickEl.classList.add('on');
    return;
  }
  const L = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
  // holding a curry comb or brush and touching the horse: rub instead of looking round
  const it = player.heldBy[1];
  if (it && (it.kind === 'curry' || it.kind === 'brush' || it.kind === 'hoofpick')){
    raycaster.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
    const t = castFrom(raycaster.ray.origin.clone(), raycaster.ray.direction.clone(), REACH + 1);
    if (t && t.horse) L.groom = t.horse;
  }
  touch.look.set(e.pointerId, L);
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (mode !== 'screen') return;
  if (e.pointerId === touch.stickId){
    const dx = e.clientX - touch.stick.x0, dy = e.clientY - touch.stick.y0, d = Math.hypot(dx, dy), m = Math.min(d, 55) / (d || 1);
    touch.stick.x = dx * m / 55; touch.stick.y = dy * m / 55;
    knobEl.style.transform = `translate(${dx * m}px, ${dy * m}px)`;
    return;
  }
  const L = touch.look.get(e.pointerId); if (!L) return;
  const dx = e.clientX - L.x, dy = e.clientY - L.y; L.x = e.clientX; L.y = e.clientY; L.moved += Math.hypot(dx, dy);
  if (L.groom){
    raycaster.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
    const hit = raycaster.intersectObject(L.groom.root, true)[0];
    const it = player.heldBy[1];
    if (hit && it && hit.point.distanceTo(player.pos.clone().setY(1.2)) < REACH + 0.5){
      if (it.kind === 'hoofpick'){ const i = nearestHoof(L.groom, hit.point); care.use(it, { type: 'hoof', horse: L.groom, hoof: i, point: hit.point }, Math.min(1, Math.hypot(dx, dy) * 0.02)); }
      else care.use(it, { type: 'horse', horse: L.groom, point: hit.point }, Math.min(1.2, Math.hypot(dx, dy) * 0.03));
      swingT = 0.2; swingItem = it; swingPoint.copy(hit.point);
    }
    return;
  }
  if (riding.horse && player.view === 'third'){ camOrbit.yaw -= dx * 0.006; camOrbit.pitch = clamp(camOrbit.pitch + dy * 0.004, -0.2, 0.9); return; }
  player.yaw -= dx * 0.005; player.pitch = clamp(player.pitch - dy * 0.005, -1.35, 1.25);
});
const endPointer = (e) => {
  if (e.pointerId === touch.stickId){ touch.stickId = null; touch.stick = null; stickEl.classList.remove('on'); knobEl.style.transform = ''; return; }
  const L = touch.look.get(e.pointerId); if (!L) return;
  touch.look.delete(e.pointerId);
  if (L.moved < 12 && performance.now() - L.t < 500) tap(e.clientX, e.clientY);
};
renderer.domElement.addEventListener('pointerup', endPointer);
renderer.domElement.addEventListener('pointercancel', (e) => { touch.look.delete(e.pointerId); if (e.pointerId === touch.stickId){ touch.stickId = null; touch.stick = null; stickEl.classList.remove('on'); } });
addEventListener('keydown', (e) => {
  touch.keys[e.code] = true;
  if (mode !== 'screen') return;
  if (riding.horse){
    if (e.code === 'KeyW' || e.code === 'ArrowUp') riding.input.up = true;
    if (e.code === 'KeyS' || e.code === 'ArrowDown') riding.input.down = true;
    if (e.code === 'Space') riding.input.jump = true;
    if (e.code === 'KeyX') riding.dismount();
  }
  if (e.code === 'KeyM' || e.code === 'Escape'){ if (screenUI.open) closePanel(); else if (e.code === 'KeyM') office(); }
});
addEventListener('keyup', (e) => { touch.keys[e.code] = false; });
// on-screen buttons
$('b-menu').onclick = () => { if (!paused) office(); };
$('b-jobs').onclick = () => { if (!paused) office('jobs'); };
$('b-drop').onclick = () => { const it = player.heldBy[1]; if (it) putBack(it); if (player.barrow){ player.barrow = null; } updateHeldUI(); };
$('b-lead').onclick = () => { if (player.leading) letGo(); };
$('b-up').onclick = () => { riding.input.up = true; };
$('b-down').onclick = () => { riding.input.down = true; };
$('b-jump').onpointerdown = (e) => { e.preventDefault(); riding.input.jump = true; };
$('b-off').onclick = () => riding.dismount();
$('b-view').onclick = () => { player.view = player.view === 'third' ? 'first' : 'third'; };

// ---------- VR controllers ----------
function makeVRHand(i){
  return { i, side: i ? 'right' : 'left', tracked: false, pos: V(), quat: new THREE.Quaternion(), rayPos: V(), rayQuat: new THREE.Quaternion(), vel: V(), prev: V(),
    trigger: 0, squeeze: 0, stick: { x: 0, y: 0 }, a: false, b: false, last: {}, gamepad: null, lead: null,
    haptic(v, ms){ const g = this.gamepad; try { if (g && g.hapticActuators && g.hapticActuators[0]) g.hapticActuators[0].pulse(v, ms); } catch (e) {} } };
}
const vr = [makeVRHand(0), makeVRHand(1)];
const grips = [renderer.xr.getControllerGrip(0), renderer.xr.getControllerGrip(1)], rays = [renderer.xr.getController(0), renderer.xr.getController(1)];
const sources = [null, null];
for (let i = 0; i < 2; i++){ rig.add(grips[i], rays[i]); grips[i].addEventListener('connected', (e) => { sources[i] = e.data; }); grips[i].addEventListener('disconnected', () => { sources[i] = null; }); }
for (const h of handsVR){ scene.add(h.group); h.group.visible = false; }
const laser = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 1, 6), new THREE.MeshBasicMaterial({ color: 0xffe8a0, transparent: true, opacity: 0.6 }));
laser.geometry.translate(0, 0.5, 0); laser.geometry.rotateX(-Math.PI / 2); laser.visible = false; scene.add(laser);
const leadRope = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1, 6), new THREE.MeshStandardMaterial({ color: 0x2a4ab0, roughness: 0.6 }));
leadRope.geometry.translate(0, 0.5, 0); leadRope.geometry.rotateX(Math.PI / 2); leadRope.visible = false; scene.add(leadRope);
// the screen sits on the back of the left wrist, facing out of the back of the hand, text toward the fingers
handsVR[0].group.add(wrist.mesh); wrist.mesh.position.set(-0.045, 0.07, 0.0);
wrist.mesh.quaternion.setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0)).multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), Math.PI));

const q1 = new THREE.Quaternion(), v1 = V(), v2 = V(), m4 = new THREE.Matrix4();
function readVR(){
  for (const h of vr){
    const idx = sources.findIndex((s) => s && s.handedness === h.side);
    const src = idx >= 0 ? sources[idx] : null, g = src && src.gamepad;
    h.gamepad = g || null;
    h.tracked = !!(src && grips[idx].visible);
    if (h.tracked){
      h.prev.copy(h.pos);
      grips[idx].updateMatrixWorld(true); grips[idx].matrixWorld.decompose(h.pos, h.quat, v1);
      rays[idx].updateMatrixWorld(true); rays[idx].matrixWorld.decompose(h.rayPos, h.rayQuat, v1);
    }
    const B = (k) => (g && g.buttons[k]) || { value: 0, pressed: false };
    h.trigger = B(0).value; h.squeeze = B(1).value; h.stickPress = B(3).pressed; h.a = B(4).pressed; h.b = B(5).pressed;
    const ax = g ? g.axes : [];
    h.stick.x = ax.length >= 4 ? ax[2] : (ax[0] || 0); h.stick.y = ax.length >= 4 ? ax[3] : (ax[1] || 0);
    const L = h.last;
    h.triggerDown = h.trigger > 0.7 && !L.t; h.squeezeDown = h.squeeze > 0.6 && !L.s; h.squeezeUp = h.squeeze < 0.35 && L.s;
    h.aDown = h.a && !L.a; h.bDown = h.b && !L.b;
    L.t = h.trigger > 0.7 ? true : h.trigger < 0.4 ? false : L.t; L.s = h.squeeze > 0.6 ? true : h.squeeze < 0.35 ? false : L.s; L.a = h.a; L.b = h.b;
  }
}
const tipOf = (it, out = V()) => it.mesh.localToWorld(out.copy(it.mesh.userData.tip || V()));
function vrHands(dt){
  for (const h of vr){
    const H = handsVR[h.i];
    H.group.visible = h.tracked;
    if (!h.tracked) continue;
    H.group.position.copy(h.pos); H.group.quaternion.copy(h.quat);
    h.vel.subVectors(h.pos, h.prev).divideScalar(Math.max(dt, 1e-3));
    const it = player.heldBy[h.i];
    H.pose(it || h.lead ? 1 : h.squeeze, it || h.lead ? 0.9 : Math.max(0.1, h.trigger));
    if (vrPanel.open || riding.horse) continue;
    // grab
    if (h.squeezeDown && !it && !h.lead){
      const g = vrGrab(h);
      if (g) h.haptic(0.4, 40);
    }
    // let go
    if (h.squeezeUp){
      if (h.lead){ h.lead = null; if (player.leading) letGo(); }
      else if (it) vrRelease(h, it);
    }
    // things you do by touching with what you hold
    if (player.heldBy[h.i]) vrContact(h, player.heldBy[h.i], dt);
  }
  // the barrow follows your hands
  if (player.barrow && mode === 'vr'){
    const hs = vr.filter((h) => h.barrow);
    if (!hs.length) player.barrow = null;
    else {
      const c = hs.reduce((a, h) => a.add(h.pos), V()).multiplyScalar(1 / hs.length);
      const fwd = V(0, 0, -1).applyQuaternion(headQuat); fwd.y = 0; fwd.normalize();
      const b = player.barrow.mesh; b.position.set(c.x + fwd.x * 0.75, 0, c.z + fwd.z * 0.75); b.rotation.set(0, Math.atan2(fwd.x, fwd.z), 0);
      if (b.position.distanceTo(PLACES.manureHeap) < 2.2 && player.barrow.load > 0) care.use(player.barrow, { type: 'heap', point: b.position });
    }
    for (const h of vr) if (h.barrow && h.squeezeUp) h.barrow = false;
  }
}
function vrGrab(h){
  const p = h.pos;
  // a loose item?
  let best = null, bd = 0.2;
  for (const it of care.pickables()){
    if (it.held || !it.mesh.visible) continue;
    const c = it.kind === 'barrow' ? it.mesh.localToWorld(V(0, 0.55, -0.75)) : it.mesh.getWorldPosition(V());
    const d = c.distanceTo(p) - (it.kind === 'fork' ? 0.4 : it.kind === 'saddle' || it.kind === 'pad' || it.kind === 'bag' ? 0.2 : it.kind === 'barrow' ? 0.25 : 0.05);
    if (d < bd){ bd = d; best = it; }
  }
  if (best){
    if (best.kind === 'barrow'){ player.barrow = best; h.barrow = true; best.homeNow = false; sfx.pickup(); return true; }
    pickUp(best, h.i); return true;
  }
  // a horse: tack off, the girth, the halter (to lead), or into the saddle
  for (const hs of farm.horses){
    if (!hs.root.visible || hs.pos.distanceTo(p) > 3) continue;
    const m = hs.model, T = hs.data.tack;
    const sp = m.saddlePoint();
    if (hs.tacked() && hs.mode !== 'stall' && p.distanceTo(sp) < 0.35){ riding.mount(hs); return true; }
    if (T.saddle && !T.girth){ for (const a of [0.0, Math.PI]){ const gp = m.body.localToWorld(V(Math.cos(a) * 0.36, 0.95, 0.3)); if (p.distanceTo(gp) < 0.3){ care.girth(hs); return true; } } }
    if (T.bridle && p.distanceTo(m.poll()) < 0.25){ const it = care.untack(hs, 'bridle'); if (it){ pickUp(it, h.i); return true; } }
    if (p.distanceTo(m.muzzle()) < 0.35 || p.distanceTo(m.head.localToWorld(V(0, -0.3, 0.2))) < 0.3){ startLead(hs); h.lead = hs; return true; }
    if (T.saddle && p.distanceTo(sp) < 0.35){ const it = care.untack(hs, 'saddle'); if (it){ pickUp(it, h.i); return true; } }
    if (T.pad && !T.saddle && p.distanceTo(sp) < 0.35){ const it = care.untack(hs, 'pad'); if (it){ pickUp(it, h.i); return true; } }
  }
  // the light switch
  if (p.distanceTo(world.barnLights.switchPos) < 0.25){ toggleLights(); return true; }
  // supplies
  if (p.distanceTo(V(PLACES.hayStack.x, Math.min(p.y, 1.4), PLACES.hayStack.z + 0.25)) < 0.75){ const it = care.takeFlake(); if (it){ pickUp(it, h.i); return true; } }
  if (p.distanceTo(world.fixtures.carrots.pos) < 0.35){ const it = care.takeCarrot(); if (it){ pickUp(it, h.i); return true; } }
  if (p.distanceTo(V(PLACES.shavings.x, Math.min(p.y, 1.2), PLACES.shavings.z)) < 0.6){ const it = care.takeBag(); if (it){ pickUp(it, h.i); return true; } }
  for (const [i, pen] of farm.pens.entries()) if (pen.kind === 'chicken' && p.distanceTo(V((pen.x0 + pen.x1) / 2 - 1.95, 1.2, pen.z0 + 1.6)) < 0.6){ collectEggs(i); return true; }
  for (const a of farm.animals) if (p.distanceTo(a.root.position.clone().setY(0.6)) < 0.55){ a.data.happy = Math.min(100, a.data.happy + 3); sfx.bleat(a.pos, a.kind); return true; }
  return false;
}
function vrRelease(h, it){
  const p = tipOf(it);
  // tack goes on when you let go of it over the horse
  for (const hs of farm.horses){
    if (hs.pos.distanceTo(p) > 3) continue;
    if ((it.kind === 'pad' || it.kind === 'saddle') && p.distanceTo(hs.model.saddlePoint()) < 0.5){ if (care.use(it, { type: 'horse', horse: hs, point: p })){ player.heldBy[h.i] = null; scene.attach(it.mesh); return; } }
    if (it.kind === 'bridle' && p.distanceTo(hs.model.poll()) < 0.45){ if (care.use(it, { type: 'head', horse: hs, point: p })){ player.heldBy[h.i] = null; scene.attach(it.mesh); return; } }
  }
  if (it.kind === 'flake'){
    const si = stallAt(p);
    if (si >= 0){ if (care.use(it, { type: 'stall', stall: si, point: p })){ player.heldBy[h.i] = null; return; } }
    for (const [i, pen] of farm.pens.entries()) if (p.distanceTo(pen.feedPos.clone().setY(0.4)) < 0.9){ if (care.use(it, { type: 'feeder', pen: i, point: p })){ player.heldBy[h.i] = null; return; } }
  }
  if (it.kind === 'bag'){ const si = stallAt(p); if (si >= 0 && care.use(it, { type: 'stall', stall: si, point: p })){ player.heldBy[h.i] = null; return; } }
  dropHere(it);
}
function vrContact(h, it, dt){
  const tip = tipOf(it), speed = h.vel.length();
  const F = farm;
  if (it.kind === 'curry' || it.kind === 'brush'){
    for (const hs of F.horses){ if (hs.pos.distanceTo(tip) > 2.5) continue; if (speed > 0.08 && hs.model.surfaceDistance(tip) < 0.07){ if (care.use(it, { type: 'horse', horse: hs, point: tip }, clamp(speed * dt * 6, 0, 0.6))) h.haptic(0.15, 20); } }
  } else if (it.kind === 'hoofpick'){
    for (const hs of F.horses){ if (hs.pos.distanceTo(tip) > 2.5) continue; for (let i = 0; i < 4; i++) if (tip.distanceTo(hs.model.hoof(i)) < 0.2){ care.use(it, { type: 'hoof', horse: hs, hoof: i, point: tip }, speed > 0.1 ? dt * 1.5 : 0); if (speed > 0.1) h.haptic(0.2, 15); } }
  } else if (it.kind === 'fork'){
    for (const s of F.stalls) for (const m of s.manureMeshes){ if (m.position.distanceTo(tip) < 0.28 && !it.load){ const u = m.userData; care.use(it, { type: 'manure', stall: u.stall, index: u.index, point: tip }); h.haptic(0.3, 30); return; } }
    for (const s of F.stalls) if (s.wetMesh.visible && s.wetMesh.position.distanceTo(tip) < 0.5 && !it.load){ care.use(it, { type: 'wet', stall: s.id, point: tip }); return; }
    for (const [pi, p] of F.pens.entries()) for (const m of p.droppingMeshes){ if (m.position.distanceTo(tip) < 0.28 && !it.load){ care.use(it, { type: 'dropping', pen: pi, index: m.userData.index, point: tip }); return; } }
    const b = care.items.barrow; if (it.load && b.mesh.localToWorld(V(0, 0.5, 0)).distanceTo(tip) < 0.6){ care.use(it, { type: 'barrow', point: tip }); h.haptic(0.3, 30); }
  } else if (it.kind === 'bucket'){
    if (tip.distanceTo(world.fixtures.tap.pos) < 0.35) care.use(it, { type: 'tap', point: tip }, dt);
    farm.stalls.forEach((s, i) => { if (tip.distanceTo(s.hookPos) < 0.3) care.use(it, { type: 'stallBucket', stall: i, point: tip }); });
    farm.pens.forEach((p, i) => { if (tip.distanceTo(p.waterPos.clone().setY(0.4)) < 0.7) care.use(it, { type: 'trough', pen: i, point: tip }); });
    if (tip.distanceTo(V(-13, 0.5, -7)) < 1) care.use(it, { type: 'paddockTrough', point: tip });
  } else if (it.kind === 'scoop'){
    for (const [k, bp] of Object.entries(BINS)) if (tip.distanceTo(V(bp.x, k === 'grain' ? 0.8 : 0.6, bp.z)) < 0.35) care.use(it, { type: 'bin', bin: k, point: tip });
    farm.stalls.forEach((s, i) => { if (tip.distanceTo(s.tubPos) < 0.35) care.use(it, { type: 'tub', stall: i, point: tip }); });
    farm.pens.forEach((p, i) => { if (tip.distanceTo(p.feedPos.clone().setY(0.4)) < 0.75) care.use(it, { type: 'feeder', pen: i, point: tip }); });
  } else if (it.kind === 'carrot'){
    for (const hs of F.horses) if (tip.distanceTo(hs.model.muzzle()) < 0.22){ if (care.use(it, { type: 'head', horse: hs, point: tip })){ player.heldBy[h.i] = null; h.haptic(0.3, 60); } return; }
  } else if (it.kind === 'shears'){
    for (const a of F.animals) if (a.kind === 'sheep' && tip.distanceTo(a.root.position.clone().setY(0.7)) < 0.5){ care.use(it, { type: 'pet', animal: a, point: tip }); return; }
  }
}
function vrPointing(){
  // the right hand points (the left too if the right is busy); trigger to choose
  let used = false;
  for (const h of [vr[1], vr[0]]){
    if (!h.tracked || used) continue;
    const dir = V(0, 0, -1).applyQuaternion(h.rayQuat);
    if (vrPanel.open){
      const r = vrPanel.ray(h.rayPos, dir, h.triggerDown);
      laser.visible = true; laser.position.copy(h.rayPos); laser.quaternion.setFromUnitVectors(V(0, 0, 1), dir); laser.scale.set(1, 1, r ? h.rayPos.distanceTo(r.point) : 1.5);
      used = true; if (h.triggerDown) h.haptic(0.2, 20);
      continue;
    }
    if (player.heldBy[h.i] || h.lead || riding.horse) continue;
    const t = castFrom(h.rayPos, dir, 12);
    const can = t && ['horse', 'head', 'hoof', 'pet', 'visitor', 'board', 'showOffice', 'lights'].includes(t.type);
    laser.visible = h.trigger > 0.1 || can; laser.position.copy(h.rayPos); laser.quaternion.setFromUnitVectors(V(0, 0, 1), dir); laser.scale.set(1, 1, t ? Math.min(t.dist, 12) : 3);
    laser.material.color.set(can ? 0xffe060 : 0xffffff);
    if (h.triggerDown && can){ activate(t, h.i); h.haptic(0.2, 30); }
    used = true;
  }
  if (!used) laser.visible = false;
}

// ---------- moving ----------
function ignoreCol(c){ return c.kind === 'door' && c.disabled; }
const stickVec = { x: 0, y: 0 };
function moveOnFoot(dt, mx, my, yaw){
  const fwd = V(-Math.sin(yaw), 0, -Math.cos(yaw)), right = V(-fwd.z, 0, fwd.x);
  const run = touch.keys.ShiftLeft || Math.hypot(mx, my) > 0.95;
  const sp = run ? 3.6 : 2.2;
  const want = V().addScaledVector(fwd, -my * sp).addScaledVector(right, mx * sp);
  player.vel.lerp(want, Math.min(1, dt * 10));
  const before = player.pos.clone();
  player.pos.addScaledVector(player.vel, dt);
  pushOut(player.pos, 0.28, { ignore: ignoreCol });
  // don't walk through horses
  for (const h of farm.horses){ if (!h.root.visible || h === riding.horse) continue; const fx = Math.sin(h.yaw), fz = Math.cos(h.yaw); for (const o of [-0.6, 0, 0.6]){ const cx = h.pos.x + fx * o * h.model.scale, cz = h.pos.z + fz * o * h.model.scale, dx = player.pos.x - cx, dz = player.pos.z - cz, d = Math.hypot(dx, dz), r = 0.33 * h.model.scale + 0.25; if (d < r && d > 1e-4){ player.pos.x = cx + dx / d * r; player.pos.z = cz + dz / d * r; } } }
  const moved = before.distanceTo(player.pos);
  player.stepT = (player.stepT || 0) + moved;
  if (player.stepT > 0.75){ player.stepT = 0; sfx.step(player.pos, groundAt(player.pos)); }
}
function placeRigAt(p){
  // VR: move the play space so your head is over p
  rig.updateMatrixWorld(true);
  const dx = p.x - headPos.x, dz = p.z - headPos.z;
  rig.position.x += dx; rig.position.z += dz; headPos.x += dx; headPos.z += dz;
}

// ---------- the rider camera ----------
const camOrbit = { yaw: 0, pitch: 0.28, dist: 5.2 };
const camPos = V(), camLook = V();
function seatPos(h, out = V()){ return h.model.body.localToWorld(out.set(0, 1.68 + 0.8, 0.12)); }

// ---------- while you hold the hoof pick, yellow rings show which hooves still need picking ----------
const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
const hoofRingMeshes = [0, 1, 2, 3].map((i) => { const m = new THREE.Mesh(new THREE.RingGeometry(0.11, 0.15, 28), ringMat); m.userData.ringHoof = i; m.rotation.x = -Math.PI / 2; m.visible = false; m.renderOrder = 2; scene.add(m); return m; });
function hoofRings(t){
  const holding = player.heldBy.some((it) => it && it.kind === 'hoofpick');
  let h = null, bd = 4.5;
  if (holding) for (const x of farm.horses){ if (!x.root.visible || x === riding.horse) continue; const d = x.pos.distanceTo(mode === 'vr' ? V(headPos.x, 0, headPos.z) : player.pos); if (d < bd){ bd = d; h = x; } }
  for (let i = 0; i < 4; i++){
    const m = hoofRingMeshes[i];
    m.visible = !!h && h.data.hooves[i] > 0.1;
    if (!m.visible) continue;
    const p = h.model.hoof(i);
    m.position.set(p.x, 0.06 + (insideBarn(p) ? 0.1 : 0), p.z);
    m.scale.setScalar(1 + Math.sin(t * 5 + i) * 0.12);
    m.userData.horse = h;
  }
}

// ---------- stall doors open as you (or a horse you're leading) come near ----------
function doors(dt){
  for (const s of farm.stalls){
    const dc = V(s.front, 0, s.center.z);
    let open = player.pos.distanceTo(dc) < 2.0;
    if (player.leading && player.leading.pos.distanceTo(dc) < 3.2) open = true;
    if (riding.horse && riding.horse.pos.distanceTo(dc) < 3) open = true;
    s.doorOpen = damp(s.doorOpen, open ? 1 : 0, 5, dt);
    s.door.position.z = s.center.z - 1.15 * s.doorOpen;
    s.doorCol.disabled = s.doorOpen > 0.35;
  }
}

// ---------- HUD ----------
let lastMsgKey = '';
function updateHUD(){
  const S = farm.state;
  $('h-money').textContent = fmtMoney(S.money);
  $('h-time').textContent = `${dayName(S.day).slice(0, 3)} · Day ${S.day} · ${fmtTime(S.minutes)}`;
  const J = farm.jobs();
  $('h-jobs').innerHTML = '';
  for (const j of J.slice(0, 3)){ const li = document.createElement('li'); li.textContent = j.text; $('h-jobs').appendChild(li); }
  if (!J.length){ const li = document.createElement('li'); li.textContent = 'All jobs done!'; $('h-jobs').appendChild(li); }
  // only redraw the messages when they change (redrawing replays their pop-in animation)
  const key = msgs.map((m) => m.text).join('|');
  if (key !== lastMsgKey){
    lastMsgKey = key;
    const box = $('h-msg'), keep = new Map([...box.children].map((el) => [el.textContent, el]));
    box.innerHTML = '';
    for (const m of msgs){ const d = keep.get(m.text) || document.createElement('div'); d.className = 'msg ' + (m.kind || ''); d.textContent = m.text; box.appendChild(d); keep.delete(m.text); }
  }
  updateHeldUI(); updateRideUI();
  const sh = riding.show;
  $('h-show').style.display = sh.state !== 'idle' ? 'block' : 'none';
  if (sh.state !== 'idle') $('h-show').textContent = sh.state === 'entered' ? `${sh.cls.name}: ride through the red posts to start` : `${sh.cls.name} · ${sh.time.toFixed(1)}s / ${sh.cls.time}s · faults ${sh.faults} · next: ${sh.next < 8 ? sh.next + 1 : 'finish'}`;
}
function updateHeldUI(){
  const it = player.heldBy[1];
  $('held').style.display = it || player.barrow ? 'flex' : 'none';
  $('held-name').textContent = it ? it.name + (it.kind === 'bucket' ? ` (${Math.round(it.water)} L)` : it.kind === 'scoop' && it.amount ? ` (${it.content === 'pigfeed' ? 'pig feed' : it.content})` : it.kind === 'fork' && it.load ? ' (loaded)' : '') + (player.barrow ? ' + wheelbarrow' : '') : player.barrow ? `Wheelbarrow (${player.barrow.load} forkfuls)` : '';
  $('b-lead').style.display = player.leading ? 'block' : 'none';
  if (player.leading) $('b-lead').textContent = `Let go of ${player.leading.data.name}`;
}
function updateRideUI(){
  const r = !!riding.horse;
  document.body.classList.toggle('riding', r);
  if (r) $('gear').textContent = GEARS[riding.gear] + (riding.horse.data.needs.energy < 25 ? ' (tired)' : '');
}
function drawWrist(){
  if (mode !== 'vr') return;
  const S = farm.state, it = player.heldBy[1] || player.heldBy[0];
  const m = msgs[msgs.length - 1];
  const sh = riding.show;
  if (sh.state !== 'idle'){
    // the round, on your wrist: clock, faults, next fence
    wrist.draw([sh.cls.name, sh.state === 'entered' ? 'Ride through the' : `${sh.time.toFixed(1)}s of ${sh.cls.time}s`, sh.state === 'entered' ? 'red timing posts' : `Faults: ${sh.faults}`, sh.state === 'entered' ? 'to start' : sh.next < 8 ? `Next: fence ${sh.next + 1}` : 'Back through the posts!']);
    return;
  }
  wrist.draw([`${fmtTime(S.minutes)}  ${fmtMoney(S.money)}`, riding.horse ? `${riding.horse.data.name}: ${GEARS[riding.gear]}` : it ? it.name : player.leading ? `Leading ${player.leading.data.name}` : `Day ${S.day}`, m ? m.text.slice(0, 26) : (farm.jobs()[0] || { text: 'All done!' }).text.slice(0, 26), m && m.text.length > 26 ? m.text.slice(26, 52) : 'X: Farm Office']);
}

// ---------- the frame ----------
const clock = new THREE.Clock();
let frameErrors = 0;
function frame(time, xrFrame){
  try { step(xrFrame); }
  catch (e){ if (frameErrors++ < 5) console.error(e); if (frameErrors < 3) setTimeout(() => { throw e; }); }
}
function step(xrFrame){
  const dt = Math.min(clock.getDelta(), 1 / 20);
  const T = window.__farm, steps = T && T.timeScale > 1 ? Math.round(T.timeScale) : 1;
  const draw = !(T && T.noRender);
  for (let k = 0; k < steps; k++){ gameTime += dt; simulate(dt, k === 0); }
  if (!draw) return;
  if (mode === 'screen' || mode === 'title') placeScreenCamera(dt);
  renderer.render(scene, camera);
}
function simulate(dt, first){
  const S = farm.state;
  if (mode === 'vr'){
    const ref = renderer.xr.getReferenceSpace();
    rig.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    // three.js has already placed the camera from the headset pose
    const xrCam = renderer.xr.getCamera();
    xrCam.matrixWorld.decompose(headPos, headQuat, v1);
    readVR();
  } else if (mode === 'screen'){
    headPos.set(player.pos.x, EYE, player.pos.z);
    headQuat.setFromEuler(new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ'));
  }
  if (mode === 'title'){ titleSpin(dt); farm.update(dt, { player: V(0, 0, 60) }); world.update(dt, gameTime); sky.update(S ? S.minutes : 600, V(0, 0, 0), dt); return; }

  // input → movement
  let mx = 0, my = 0;
  if (mode === 'screen'){
    if (touch.stick){ mx = touch.stick.x; my = touch.stick.y; }
    const K = touch.keys;
    if (!riding.horse){ mx += (K.KeyD ? 1 : 0) - (K.KeyA ? 1 : 0); my += (K.KeyS ? 1 : 0) - (K.KeyW ? 1 : 0); }
    else mx += (K.KeyD || K.ArrowRight ? 1 : 0) - (K.KeyA || K.ArrowLeft ? 1 : 0);
    if (!riding.horse){ if (K.ArrowLeft) player.yaw += dt * 1.8; if (K.ArrowRight) player.yaw -= dt * 1.8; }
    const TI = window.__farm && window.__farm.input; if (TI){ mx += TI.x || 0; my += TI.y || 0; }
  }
  if (!paused){
    // the clock
    farm.tick(dt * TIME_RATE, dt, {});
    if (riding.horse){
      // riding: stick sideways steers; forward/back changes gear (flick)
      let steer = mx, gy = my;
      if (mode === 'vr'){ steer = vr[0].stick.x; gy = vr[0].stick.y; if (vr[1].aDown) riding.input.jump = true; if (vr[1].bDown) riding.dismount(); }
      riding.input.steer = Math.abs(steer) > 0.12 ? steer : 0;
      if (gy < -0.65 && !player.gearLatch){ riding.input.up = true; player.gearLatch = true; }
      else if (gy > 0.65 && !player.gearLatch){ riding.input.down = true; player.gearLatch = true; }
      else if (Math.abs(gy) < 0.3) player.gearLatch = false;
      if (touch.stick && Math.abs(gy) > 0.65){ player.gearRepeat = (player.gearRepeat || 0) + dt; if (player.gearRepeat > 0.7){ player.gearLatch = false; player.gearRepeat = 0; } } else player.gearRepeat = 0;
    } else if (mode === 'screen'){
      moveOnFoot(dt, mx, my, player.yaw);
    } else if (mode === 'vr'){
      vrLocomotion(dt);
    }
    riding.update(dt);
    if (riding.horse){
      const h = riding.horse;
      if (mode === 'vr'){
        // you sit in the saddle: the play space rides along with the horse (only a little of its bounce)
        const seat = seatPos(h);
        player.seatSmoothY = damp(player.seatSmoothY ?? seat.y, seat.y, 6, dt);
        const yaw = h.yaw + Math.PI + (player.seatYaw || 0);
        rig.rotation.y = yaw;
        rig.updateMatrixWorld(true);
        const local = player.seatHead || V(0, 1.2, 0);
        const off = local.clone().applyAxisAngle(V(0, 1, 0), yaw);
        rig.position.set(seat.x - off.x, lerp(player.seatSmoothY, seat.y, 0.3) - local.y + 0.0, seat.z - off.z);
        player.pos.set(h.pos.x, 0, h.pos.z);
        h.reinHands = vr.every((x) => x.tracked) ? vr.map((x) => x.pos.clone()) : null;
      } else { player.pos.set(h.pos.x, 0, h.pos.z); h.reinHands = null; }
    }
    if (mode === 'vr') vrHands(dt);
    if (mode === 'vr') vrPointing();
    // a horse on a lead follows you (or the hand holding the rope)
    if (player.leading){
      const L = player.leading;
      const leadHand = vr.find((h) => h.lead === L);
      L.leader = { pos: mode === 'vr' && leadHand ? leadHand.pos.clone().setY(0) : player.pos };
      if (L.pos.distanceTo(player.pos) > 14) letGo();
    }
    // the lead rope
    if (player.leading){
      const L = player.leading, a = L.model.tack.halterRing.getWorldPosition(V());
      const leadHand = vr.find((h) => h.lead === L);
      const b = mode === 'vr' && leadHand ? leadHand.pos.clone() : player.pos.clone().setY(1.0).addScaledVector(V(-Math.sin(player.yaw), 0, -Math.cos(player.yaw)), 0.3);
      leadRope.visible = true; leadRope.position.copy(a); leadRope.lookAt(b); leadRope.scale.set(1, 1, a.distanceTo(b));
    } else leadRope.visible = false;
    for (const t of farm.horses) if (t.mode === 'tied'){ /* rope to the rail */ }
    farm.update(dt, { player: player.pos });
    care.update(dt);
    doors(dt);
    hoofRings(gameTime);
    world.update(dt, gameTime);
  }
  // the screen: what you hold sits at the bottom right of the view
  if (mode === 'screen'){
    const it = player.heldBy[1];
    if (it && it.mesh.parent === camera){
      const [p] = VIEW_POSE[it.kind] || [V(0.2, -0.2, -0.5)];
      if (swingT > 0 && swingItem === it){ swingT -= dt; const lp = camera.worldToLocal(swingPoint.clone()); it.mesh.position.lerp(lp, 0.5); }
      else it.mesh.position.lerp(p, Math.min(1, dt * 10));
    }
    if (player.barrow && !player.heldBy[1]){ /* pushing the barrow with both hands */ }
    if (player.barrow){
      const b = player.barrow.mesh, fwd = V(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
      b.position.set(player.pos.x + fwd.x * 1.25, 0, player.pos.z + fwd.z * 1.25); b.rotation.set(0, player.yaw + Math.PI, 0);
      if (b.position.distanceTo(PLACES.manureHeap) < 2.4 && player.barrow.load > 0) care.use(player.barrow, { type: 'heap', point: b.position });
    }
  }
  // rider model (third person on screen)
  rider.root.visible = !!riding.horse && mode === 'screen' && player.view === 'third';
  if (riding.horse && rider.root.visible){
    const h = riding.horse;
    rider.root.position.copy(h.model.body.localToWorld(V(0, 1.62, 0.12)));
    rider.root.quaternion.copy(h.model.body.getWorldQuaternion(q1));
    rider.root.scale.setScalar(0.95);
    rider.update(dt, { pose: 'ride', reins: 1 });
  }
  // light and time of day
  const night = S.minutes > NIGHT + 30 || S.minutes < DAY_START - 30 ? 1 : 0;
  setNight(night);
  sky.update(S.minutes, player.pos, dt);
  // your eyes adjust to the dim barn
  const indoors = insideBarn(headPos) || inBox(headPos, BARN, 0.6);
  renderer.toneMappingExposure = damp(renderer.toneMappingExposure, indoors ? 1.75 : 1.0, 2.5, dt);
  setListener(headPos, v1.set(0, 0, -1).applyQuaternion(headQuat), v2.set(0, 1, 0).applyQuaternion(headQuat));
  if (first){
    hudT -= dt; saveT += dt;
    for (const m of msgs) m.t -= dt;
    while (msgs.length && msgs[0].t <= 0) msgs.shift();
    if (hudT <= 0){ hudT = riding.show.state === 'riding' ? 0.1 : 0.25; if (mode === 'screen') updateHUD(); else drawWrist(); }
    if (saveT > 30){ saveT = 0; farm.save(); }
  }
}
function vrLocomotion(dt){
  const L = vr[0], R = vr[1];
  if (vrPanel.open){ if (Math.abs(R.stick.y) > 0.3) vrPanel.scrollBy(R.stick.y * dt * 900); }
  // turning
  const sx = R.stick.x;
  if (!vrPanel.open){
    let turn = 0;
    if (settings.snap){ if (Math.abs(sx) > 0.7 && player.snapReady){ turn = -Math.sign(sx) * Math.PI / 6; player.snapReady = false; } if (Math.abs(sx) < 0.35) player.snapReady = true; }
    else if (Math.abs(sx) > 0.2) turn = -Math.sign(sx) * (Math.abs(sx) - 0.2) * 2.2 * dt;
    if (turn){ v1.copy(headPos); rig.position.sub(v1).applyAxisAngle(V(0, 1, 0), turn).add(v1); rig.rotation.y += turn; rig.updateMatrixWorld(true); }
  }
  // walking where you look, and your real steps
  let mx = L.stick.x, my = L.stick.y; if (Math.hypot(mx, my) < 0.15){ mx = 0; my = 0; }
  const yaw = Math.atan2(-(V(0, 0, -1).applyQuaternion(headQuat).x), -(V(0, 0, -1).applyQuaternion(headQuat).z));
  const before = V(headPos.x, 0, headPos.z);
  player.pos.set(headPos.x, 0, headPos.z);
  moveOnFoot(dt, mx, my, yaw);
  rig.position.x += player.pos.x - before.x; rig.position.z += player.pos.z - before.z;
  // menu on the left controller
  if (L.aDown) office();      // X
  if (L.bDown) office('jobs'); // Y
  void dt;
}
renderer.setAnimationLoop(frame);

function placeScreenCamera(dt){
  if (mode === 'title') return;
  if (riding.horse && player.view === 'third'){
    const h = riding.horse;
    const yaw = h.yaw + Math.PI + camOrbit.yaw;
    camOrbit.yaw = damp(camOrbit.yaw, 0, touch.look.size ? 0 : 0.6, dt);
    const target = h.model.body.localToWorld(V(0, 1.6, 0.3));
    const want = V(target.x + Math.sin(yaw) * camOrbit.dist * Math.cos(camOrbit.pitch), target.y + 0.4 + Math.sin(camOrbit.pitch) * camOrbit.dist, target.z + Math.cos(yaw) * camOrbit.dist * Math.cos(camOrbit.pitch));
    // keep the camera out of walls a bit
    camPos.lerp(want, Math.min(1, dt * 6)); camLook.lerp(target, Math.min(1, dt * 10));
    rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0);
    camera.position.copy(camPos); camera.lookAt(camLook);
    headPos.copy(camPos); headQuat.copy(camera.quaternion);
    return;
  }
  if (riding.horse){
    const p = seatPos(riding.horse);
    rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0);
    camera.position.copy(p);
    camera.quaternion.setFromEuler(new THREE.Euler(player.pitch, riding.horse.yaw + Math.PI + player.yaw - (player.rideYaw0 ?? player.yaw), 0, 'YXZ'));
    return;
  }
  rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0);
  camera.position.set(player.pos.x, EYE, player.pos.z);
  camera.quaternion.setFromEuler(new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ'));
  camPos.copy(camera.position); camLook.copy(camPos).add(V(0, 0, -1).applyQuaternion(camera.quaternion));
}
riding.on('mount', () => { player.rideYaw0 = player.yaw; camPos.copy(camera.position); camOrbit.yaw = 0; if (mode === 'vr'){ const e = new THREE.Euler().setFromQuaternion(headQuat, 'YXZ'); player.seatYaw = 0; const hl = camera.position.clone(); player.seatHead = V(hl.x, hl.y, hl.z); void e; } });

// ---------- title screen ----------
let spin = 0;
function titleSpin(dt){
  spin += dt * 0.04;
  rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0);
  const c = V(-1, 0, -6);
  camera.position.set(c.x + Math.sin(spin) * 15, 4.5, c.z + Math.cos(spin) * 15 + 4);
  camera.lookAt(c.x, 1.5, c.z);
}
function toTitle(){
  if (renderer.xr.isPresenting){ renderer.xr.getSession().end(); }
  farm.save();
  mode = 'title'; $('title').classList.remove('hidden'); document.body.classList.remove('playing');
  refreshTitle();
}
function refreshTitle(){
  const has = !!localStorage.getItem(SAVE_KEY);
  $('b-new').textContent = has ? 'Start a new farm' : 'Start your farm';
}
function ensureGame(fresh){
  if (fresh || !farm.state){ if (fresh || !farm.load()) farm.newGame(); care.syncTack(); }
  world.barnLights.set(!!farm.state.lights);
}
function startScreen(fresh){
  startAudio(); ensureGame(fresh);
  mode = 'screen'; $('title').classList.add('hidden'); document.body.classList.add('playing');
  player.pos.copy(PLACES.start); player.yaw = 0; player.pitch = -0.08;
  clock.getDelta();
  if (farm.state.day === 1 && farm.state.minutes < 7 * 60 + 5) welcome();
  updateHUD();
}
async function startVR(fresh){
  startAudio(); ensureGame(fresh);
  try {
    const session = await navigator.xr.requestSession('immersive-vr', { requiredFeatures: ['local-floor'], optionalFeatures: ['bounded-floor', 'hand-tracking'] });
    session.addEventListener('end', () => { if (mode === 'vr'){ mode = 'title'; $('title').classList.remove('hidden'); document.body.classList.remove('playing'); camera.position.set(0, 0, 0); farm.save(); for (const h of handsVR) h.group.visible = false; laser.visible = false; } });
    sky.setShadowQuality(1024, 28);
    await renderer.xr.setSession(session);
    try { if (session.supportedFrameRates && session.updateTargetFrameRate){ const r = [...session.supportedFrameRates]; if (r.includes(72)) await session.updateTargetFrameRate(72); } } catch (e) {}
    mode = 'vr'; $('title').classList.add('hidden');
    rig.position.set(PLACES.start.x, 0, PLACES.start.z); rig.rotation.set(0, 0, 0);
    player.pos.copy(PLACES.start);
    clock.getDelta();
    drawWrist();
    if (farm.state.day === 1 && farm.state.minutes < 7 * 60 + 5) welcome();
  } catch (e) { $('status').textContent = 'Could not start VR: ' + (e && e.message ? e.message : e); }
}
function welcome(){
  showPanel({ title: 'Welcome to your farm!', sections: [
    { text: 'This is Hazel, your warmblood mare. She\'s in the first stall on the left in the big red barn, and she\'s hungry, thirsty and muddy. You also have two goats and four hens.' },
    { list: [
      'Feed room (back left of the barn): hay, grain bins, the water tap, carrots, shavings.',
      'Tack room (back right): saddle, saddle pad, bridle, and the grooming box with curry comb, brush and hoof pick.',
      'Muck out with the manure fork and wheelbarrow, and tip it on the heap behind the barn.',
      'Lead Hazel to the hitching rail by the barn door to groom and tack up, then ride in the arena and practise jumping.',
      'Every third day there\'s a show at the show grounds down the lane. Customers come in the morning with animals to look after.',
      'The Farm Office (on the house porch, or the ☰ button) has your jobs list, the shop and the shows.',
    ] },
    { buttons: [{ label: 'Let\'s go!', kind: 'primary', go: closePanel }] },
  ] });
}
$('b-play').onclick = () => startScreen(false);
$('b-vr').onclick = () => startVR(false);
$('b-new').onclick = () => {
  if (localStorage.getItem(SAVE_KEY) && !confirm('Start a new farm? Your saved farm will be replaced.')) return;
  localStorage.removeItem(SAVE_KEY);
  if (navigator.xr && $('b-vr').dataset.ok === '1' && confirm('Play the new farm in VR? (Cancel to play on this screen.)')) startVR(true); else startScreen(true);
};
refreshTitle();
if (navigator.xr && navigator.xr.isSessionSupported){
  navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
    $('b-vr').disabled = !ok; $('b-vr').dataset.ok = ok ? '1' : '0';
    $('status').textContent = ok ? 'Headset found: press Enter VR.' : 'No VR headset here: play on this screen (or open this page in a headset\'s browser).';
  }).catch(() => { $('b-vr').disabled = true; });
} else { $('b-vr').disabled = true; $('status').textContent = 'Play on this screen, or open this page in a VR headset\'s browser.'; }
// show the farm behind the title
if (!farm.load()) farm.newGame();
care.syncTack();

addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
addEventListener('pagehide', () => farm.save());
document.addEventListener('visibilitychange', () => { if (document.hidden) farm.save(); });

// ---------- for the headless test ----------
window.__farm = {
  get mode(){ return mode; }, farm, care, riding, world, player, renderer, camera, scene, settings, vr, vrPanel, screenUI, rig, sky, classes: CLASSES,
  timeScale: 1, noRender: false, input: null,
  startScreen, startVR, office, horsePanel, closePanel, tap, handleTap, pickUp, putBack, startLead, letGo, tieAtRail, activate, castFrom, resolve, takeFrom, collectEggs,
  get time(){ return gameTime; }, get head(){ return headPos.toArray(); },
  look(yaw, pitch){ player.yaw = yaw; player.pitch = pitch; },
  // tap whatever is at a world point (projects it to the screen first)
  tapWorld(p){ const v = V(...p).project(camera); tap((v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight); },
};
