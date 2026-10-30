// Wildcat: you are a European wildcat in a big forest. Bears, wolves and wild boar roam; get close to one
// and it will fight you, and it won't let you run. Claw, pounce and dodge. Catch rabbits to heal.
import * as THREE from 'three';
import { makeTextures } from './textures.js';
import { createWorld, DEN, LAKE, EDGE } from './world.js';
import { SPECIES, COATS, newAnim, advance, pose } from './species.js';
import { makeCreature, buildSpecies, furLOD } from './creature.js';
import { initAudio, sfx, setListener, setMuted, isMuted } from './audio.js';
import { clamp, lerp } from './noise.js';

const $ = (id) => document.getElementById(id);
const Q = new URLSearchParams(location.search);
const TEST = Q.has('test');
const isTouchDevice = matchMedia('(pointer: coarse)').matches;
const QUALITY = Q.has('q') ? +Q.get('q') : TEST ? 1 : isTouchDevice ? 1 : 2;
if (isTouchDevice) document.body.classList.add('touch');

// ---------------------------------------------------------------- renderer, camera
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY > 1 ? 1.75 : 1.25));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 1400);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

let world, T;
const tick = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------- tuning
// What you can be. Every cat coat plays the same; the animals you beat play like themselves.
const PLAY = {
  cat:    { hp: 100, walk: 1.5, trot: 3.8, sprint: 8.6, swipe: 11, pounce: 26, leap: 1, attack: 'swipe', verb: 'claw' },
  bear:   { hp: 240, walk: 1.4, trot: 3.6, sprint: 8.0, swipe: 30, pounce: 40, leap: 0.75, attack: 'swipe', verb: 'paw' },
  wolf:   { hp: 140, walk: 1.6, trot: 4.3, sprint: 9.6, swipe: 17, pounce: 28, leap: 1, attack: 'bite', verb: 'bite' },
  boar:   { hp: 170, walk: 1.3, trot: 3.6, sprint: 8.8, swipe: 18, pounce: 32, leap: 0.8, attack: 'gore', verb: 'tusk' },
  rabbit: { hp: 45, walk: 1.0, trot: 4.0, sprint: 10.5, swipe: 4, pounce: 7, leap: 1.15, attack: 'bite', verb: 'nip' },
  hare:   { hp: 55, walk: 1.2, trot: 4.5, sprint: 11.5, swipe: 5, pounce: 9, leap: 1.3, attack: 'bite', verb: 'nip' },
  mouse:  { hp: 20, walk: 0.4, trot: 1.5, sprint: 4.5, swipe: 2, pounce: 3, leap: 0.5, attack: 'bite', verb: 'nibble' },
  squirrel: { hp: 30, walk: 0.7, trot: 2.5, sprint: 7.0, swipe: 3, pounce: 5, leap: 1.0, attack: 'bite', verb: 'nip' },
  deer:   { hp: 150, walk: 1.4, trot: 4.5, sprint: 11.0, swipe: 16, pounce: 22, leap: 1.1, attack: 'swipe', verb: 'kick' },
};
const CHOICES = ['cat', 'ginger', 'black', 'snow', 'spotted', 'bear', 'wolf', 'boar', 'deer', 'hare', 'rabbit', 'squirrel', 'mouse'];
const kindOf = (key) => COATS[key] ? 'cat' : key;
let unlocked = new Set(['cat', 'ginger', 'black', 'snow', 'spotted']);
try { for (const k of JSON.parse(localStorage.getItem('wildcat-unlocked') || '[]')) unlocked.add(k); } catch (e) {}
let chosen = 'cat';
try { const c = localStorage.getItem('wildcat-animal'); if (c && unlocked.has(c)) chosen = c; } catch (e) {}
const me = { key: 'cat', kind: 'cat', def: SPECIES.cat, P: PLAY.cat };
let CAT_STATS = PLAY.cat;
let offer = null;           // a just-beaten animal you can become, for a few seconds
const FOES = {
  bear: { name: 'BROWN BEAR', hp: 380, walk: 1.2, chase: 8.4, reach: 1.9, notice: 24, engage: 10, xp: 60, size: 3 },
  wolf: { name: 'GREY WOLF', hp: 80, walk: 1.4, chase: 9.4, reach: 1.3, notice: 30, engage: 12, xp: 22, size: 1.6 },
  boar: { name: 'WILD BOAR', hp: 170, walk: 1.0, chase: 8.8, reach: 1.25, notice: 20, engage: 10, xp: 35, size: 2 },
  // prey: they run (each with a moment's freeze first), and heal you when caught
  rabbit:   { name: 'RABBIT', hp: 1, walk: 0.5, chase: 6.8, reach: 0, notice: 6, engage: 0, xp: 4, size: 0.4, prey: true, heal: 35, freeze: 0.7, wander: 1.2 },
  hare:     { name: 'BROWN HARE', hp: 1, walk: 0.6, chase: 8.0, reach: 0, notice: 9, engage: 0, xp: 8, size: 0.6, prey: true, heal: 45, freeze: 0.5, wander: 1.4 },
  mouse:    { name: 'WOOD MOUSE', hp: 1, walk: 0.2, chase: 3.4, reach: 0, notice: 3, engage: 0, xp: 2, size: 0.15, prey: true, heal: 12, freeze: 0.3, wander: 0.4 },
  squirrel: { name: 'RED SQUIRREL', hp: 1, walk: 0.4, chase: 6.0, reach: 0, notice: 6, engage: 0, xp: 4, size: 0.3, prey: true, heal: 20, freeze: 0.6, wander: 0.9 },
  deer:     { name: 'ROE DEER', hp: 24, walk: 1.1, chase: 8.0, reach: 0, notice: 15, engage: 0, xp: 18, size: 1.6, prey: true, heal: 70, freeze: 0.5, wander: 1.1 },
};
const RANKS = ['KITTEN', 'YOUNG CAT', 'HUNTER', 'STALKER', 'FIGHTER', 'WARRIOR', 'BEAR BEATER', 'LEGEND OF THE WOODS', 'KING OF THE WILD'];
const LEVEL_XP = [0, 40, 100, 190, 310, 460, 650, 880, 1150];

// ---------------------------------------------------------------- state
let state = 'title';           // title | play | pause | dead
const cat = { x: DEN.x, z: DEN.z, y: 0, vx: 0, vz: 0, vy: 0, yaw: Math.PI, hp: 100, maxHp: 100, stam: 100, stamWait: 0, level: 1, xp: 0,
  act: null, actT: 0, combo: 0, queued: null, invuln: 0, ground: true, hurtT: 0, dead: 0, eatT: 0, sprinting: false, swipeSide: 1, hitDone: false,
  speed: 0, kx: 0, kz: 0, stepPh: 0 };
const stats = { wins: 0, caught: 0, bears: 0, wolves: 0, boars: 0, rabbits: 0 };
let best = { wins: 0, level: 1 };
try { best = Object.assign(best, JSON.parse(localStorage.getItem('wildcat-best') || '{}')); } catch (e) {}
let catObj = null, catA = newAnim();
const animals = [];
const view = { yaw: Math.PI, pitch: 0.3, dist: 2.4, manualT: 0, shake: 0, x: 0, y: 0, z: 0 };
let time = 0, fightActive = false, fightBeat = 0, hunterT = 25;

// ---------------------------------------------------------------- particles: blood drops, fur tufts, dust
const PN = 260;
const parts = [];
const partMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ roughness: 0.6 }), PN);
partMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
partMesh.frustumCulled = false;
scene.add(partMesh);
for (let i = 0; i < PN; i++){ parts.push({ life: 0 }); partMesh.setColorAt(i, new THREE.Color(1, 1, 1)); }
let partNext = 0;
const _c = new THREE.Color();
function burst(kind, x, y, z, n, dirx = 0, dirz = 0){
  for (let k = 0; k < n; k++){
    const p = parts[partNext]; partNext = (partNext + 1) % PN;
    const blood = kind === 'blood', fur = kind === 'fur';
    p.life = blood ? 0.9 + Math.random() * 0.4 : fur ? 1.6 : 0.8; p.max = p.life;
    p.x = x; p.y = y; p.z = z;
    const sp = blood ? 2.5 : fur ? 1.2 : 0.8;
    p.vx = (Math.random() - 0.5) * sp + dirx * 2; p.vz = (Math.random() - 0.5) * sp + dirz * 2; p.vy = Math.random() * sp * (blood ? 1 : 0.6) + (fur ? 0.6 : 0.3);
    p.s = blood ? 0.008 + Math.random() * 0.012 : fur ? 0.01 : 0.012 + Math.random() * 0.015;
    p.kind = kind; p.drag = fur ? 2.5 : kind === 'dust' ? 3 : 0.3; p.g = fur ? 1.2 : kind === 'dust' ? -0.1 : 9.8;
    _c.set(blood ? 0x5a0704 : fur ? 0x6a5a48 : 0x5a4a38);
    partMesh.setColorAt((partNext + PN - 1) % PN, _c);
  }
  partMesh.instanceColor.needsUpdate = true;
}
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
function updateParts(dt){
  for (let i = 0; i < PN; i++){
    const p = parts[i];
    if (p.life <= 0){ _m4.makeScale(0, 0, 0); partMesh.setMatrixAt(i, _m4); continue; }
    p.life -= dt;
    p.vy -= p.g * dt; const dr = Math.exp(-p.drag * dt); p.vx *= dr; p.vz *= dr; if (p.kind !== 'blood') p.vy *= dr;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    const gy = world.heightAt(p.x, p.z);
    if (p.y < gy + 0.005){ p.y = gy + 0.005; p.vx = p.vz = p.vy = 0; }
    const k = Math.min(1, p.life / p.max * 3);
    _s.setScalar(p.s * k);
    _m4.compose(_v.set(p.x, p.y, p.z), _q, _s);
    partMesh.setMatrixAt(i, _m4);
  }
  partMesh.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- animals
function placeOnGround(o, dt, def){
  const L = def.radius * 1.4;
  const s = Math.sin(o.yaw), c = Math.cos(o.yaw);
  const hf = world.heightAt(o.x + s * L, o.z + c * L), hb = world.heightAt(o.x - s * L, o.z - c * L);
  const h = world.heightAt(o.x, o.z);
  const targetPitch = Math.atan2(hb - hf, L * 2) * 0.85;
  o.pitch = o.pitch === undefined ? targetPitch : lerp(o.pitch, targetPitch, 1 - Math.exp(-dt * 8));
  if (o.ground !== false) o.y = Math.max(h, Math.min((hf + hb) / 2, h + 0.1));
}
function spawn(kind, x, z, extra = {}){
  const def = SPECIES[kind], st = FOES[kind];
  const obj = makeCreature(def, QUALITY);
  scene.add(obj);
  const a = { kind, def, st, obj, A: newAnim(), x, z, y: world.heightAt(x, z), yaw: Math.random() * 6.28, pitch: 0, hp: st.hp, maxHp: st.hp,
    state: 'wander', t: 0, wx: x, wz: z, home: { x, z }, speed: 0, vx: 0, vz: 0, engaged: false, dead: false, deadT: 0, cool: 1 + Math.random() * 2,
    move: null, hitDone: false, stagger: 0, voiceT: Math.random() * 10, pack: null, ...extra };
  animals.push(a);
  return a;
}
function despawn(a){ scene.remove(a.obj); animals.splice(animals.indexOf(a), 1); }

function freeSpot(minD, maxD){
  for (let tries = 0; tries < 60; tries++){
    const ang = Math.random() * Math.PI * 2, d = minD + Math.random() * (maxD - minD);
    const x = cat.x + Math.sin(ang) * d, z = cat.z + Math.cos(ang) * d;
    if (Math.hypot(x, z) > EDGE - 10 || world.isWater(x, z) || world.slopeAt(x, z) > 0.3) continue;
    if (Math.hypot(x - DEN.x, z - DEN.z) < 30) continue;
    return { x, z };
  }
  return null;
}
function population(){
  const count = (k) => animals.filter((a) => a.kind === k && !a.dead).length;
  const want = { bear: 2, wolf: 1, boar: 2, rabbit: 9, hare: 4, mouse: 8, squirrel: 6 };
  // a wolf "slot" is a pack of two or three
  const packs = new Set(animals.filter((a) => a.kind === 'wolf' && !a.dead).map((a) => a.pack)).size;
  for (const k of ['bear', 'boar']){
    if (count(k) < want[k]){ const p = freeSpot(70, 160); if (p) spawn(k, p.x, p.z); }
  }
  // lots of small things to hunt, close by; a few at a time so the start isn't a stall
  for (const k of ['rabbit', 'hare', 'mouse', 'squirrel']){
    for (let i = 0; i < 2 && count(k) < want[k]; i++){ const p = freeSpot(k === 'mouse' ? 10 : 18, k === 'mouse' ? 45 : 75); if (p) spawn(k, p.x, p.z); }
  }
  // roe deer come in small herds
  const herds = new Set(animals.filter((a) => a.kind === 'deer' && !a.dead).map((a) => a.herd)).size;
  if (herds < 2){
    const p = freeSpot(40, 120);
    if (p){ const id = Math.random(); for (let i = 0; i < 3; i++) spawn('deer', p.x + (Math.random() - 0.5) * 8, p.z + (Math.random() - 0.5) * 8, { herd: id }); }
  }
  if (packs < want.wolf){
    const p = freeSpot(90, 170);
    if (p){ const id = Math.random(); const n = stats.wins > 3 ? 3 : 2; for (let i = 0; i < n; i++) spawn('wolf', p.x + i * 2, p.z + (i % 2) * 2, { pack: id }); }
  }
  // far away and not fighting: let them go
  for (const a of animals.slice()){
    const d = Math.hypot(a.x - cat.x, a.z - cat.z);
    if ((d > (a.st.prey ? 130 : 240) && !a.engaged) || (a.dead && a.deadT > 45)) despawn(a);
  }
}

function catDist(a){ return Math.hypot(a.x - cat.x, a.z - cat.z); }
function angleTo(a, x, z){ return Math.atan2(x - a.x, z - a.z); }
function wrapA(v){ while (v > Math.PI) v -= Math.PI * 2; while (v < -Math.PI) v += Math.PI * 2; return v; }
function turnTo(a, yaw, rate, dt){ const d = wrapA(yaw - a.yaw); const s = clamp(d, -rate * dt, rate * dt); a.yaw += s; return s / Math.max(dt, 1e-4); }
function facing(a, x, z){ return Math.abs(wrapA(angleTo(a, x, z) - a.yaw)); }

function engage(a){
  if (a.engaged || a.dead || cat.dead) return;
  a.engaged = true; a.state = 'fight'; a.cool = 0.8 + Math.random();
  if (a.pack) for (const b of animals) if (b.pack === a.pack && !b.dead && !b.engaged){ b.engaged = true; b.state = 'fight'; b.cool = 1.5 + Math.random() * 1.5; }
  if (!fightActive){
    banner(a.kind === 'wolf' ? 'WOLVES!' : 'A ' + a.st.name.split(' ').pop() + '!', 'It has seen you. Fight!');
    sfx.hiss();
  }
  voice(a, true);
}
function voice(a, angry){
  const p = [a.x, a.z];
  if (a.kind === 'bear') angry ? sfx.roar(p) : sfx.growl(p, 70);
  else if (a.kind === 'wolf') angry ? sfx.snarl(p) : (Math.random() < 0.3 ? sfx.howl(p) : null);
  else if (a.kind === 'boar') angry ? sfx.squeal(p) : sfx.grunt(p);
}

function hurtAnimal(a, dmg, big){
  if (a.dead) return;
  a.hp -= dmg; a.A.hurt = 1;
  const hx = (a.x + cat.x) / 2, hz = (a.z + cat.z) / 2, hy = a.y + a.def.height * 0.6;
  burst('blood', hx, hy, hz, big ? 14 : 7, (a.x - cat.x) * 0.3, (a.z - cat.z) * 0.3);
  burst('fur', hx, hy, hz, big ? 8 : 4);
  sfx.hit([a.x, a.z], big);
  if (a.st.prey){ if (a.hp <= 0) killAnimal(a); else { a.A.hurt = 1; a.freeze = 0; } return; }
  if (!a.engaged) engage(a);
  // small animals (and anyone, when pounced) get knocked off their move
  if (big || (a.kind === 'wolf' && Math.random() < 0.3)){ a.move = null; a.stagger = big ? 0.9 : 0.35; a.A.rear = 0; a.A.swipe = 0; }
  const d = catDist(a) || 1, kb = (big ? 2.5 : 1) / a.st.size;
  a.vx += (a.x - cat.x) / d * kb * 3; a.vz += (a.z - cat.z) / d * kb * 3;
  if (a.hp <= 0) killAnimal(a);
  else if (Math.random() < 0.3) voice(a, true);
}
function killAnimal(a){
  a.dead = true; a.deadT = 0; a.engaged = false; a.state = 'dead'; a.move = null;
  if (a.st.prey){
    stats.caught++; stats[a.kind + 's'] = (stats[a.kind + 's'] || 0) + 1;
    if (a.kind === 'deer') sfx.squeal([a.x, a.z]); else sfx.squeak([a.x, a.z]);
    // eat it: heal up
    cat.eatT = 1.4; cat.act = null;
    const heal = a.st.heal; cat.hp = Math.min(cat.maxHp, cat.hp + heal); sfx.eat();
    hint('YOU CAUGHT A ' + a.st.name + '  +' + heal, 2.5);
    gainXp(a.st.xp);
    unlock(a.kind);
    return;
  }
  stats.wins++; stats[a.kind + 's'] = (stats[a.kind + 's'] || 0) + 1;
  unlock(a.kind);
  sfx.roar([a.x, a.z], 0.6);
  gainXp(a.st.xp);
  if (!animals.some((b) => b.engaged && !b.dead)){
    setTimeout(() => { if (state === 'play' && !cat.dead){ banner('YOU WON', winLine(a)); sfx.win(); } }, 700);
  }
}
// beat an animal and you can be one: now (for a few seconds), or any time from the menu
function unlock(kind){
  const fresh = !unlocked.has(kind);
  unlocked.add(kind);
  try { localStorage.setItem('wildcat-unlocked', JSON.stringify([...unlocked])); } catch (e) {}
  if (kind === me.key) return;
  offer = { kind, t: 9 };
  setTimeout(() => { if (offer && offer.kind === kind && state === 'play') hint((isTouchDevice ? 'TAP BECOME' : 'Y / E') + ' TO BECOME THE ' + SPECIES[kind].label.toUpperCase(), 6); }, fresh ? 3600 : 1500);
  if (fresh) setTimeout(() => { if (state === 'play') banner('NEW ANIMAL', 'You can be a ' + SPECIES[kind].label.toLowerCase() + ' now.'); }, 2600);
  renderChooser();
}
function winLine(a){
  return a.kind === 'bear' ? 'The bear is beaten. Nothing in these woods is bigger.' : a.kind === 'wolf' ? 'The pack is gone.' : 'The boar is down.';
}
function gainXp(n){
  cat.xp += n;
  while (cat.level < LEVEL_XP.length && cat.xp >= LEVEL_XP[cat.level]){
    cat.level++; cat.maxHp = maxHpFor(); cat.hp = cat.maxHp;
    setTimeout(() => banner('LEVEL ' + cat.level, 'You are a ' + RANKS[cat.level - 1].toLowerCase() + ' now. Stronger claws, more health.'), 1800);
  }
  updateHud();
}

function hurtCat(dmg, fromX, fromZ, knock){
  if (cat.invuln > 0 || cat.dead) return false;
  cat.hits = (cat.hits || 0) + 1;
  if (window.__wc.god){ cat.invuln = 0.55; return false; }
  cat.hp = Math.max(0, cat.hp - dmg); cat.invuln = 0.55; cat.hurtT = 1; view.shake = Math.min(1, 0.3 + dmg / 40);
  const dx = cat.x - fromX, dz = cat.z - fromZ, d = Math.hypot(dx, dz) || 1;
  cat.kx += dx / d * knock; cat.kz += dz / d * knock;
  if (knock > 5){ cat.vy = 3; cat.ground = false; }
  const hy = cat.y + me.def.height * 0.6;
  burst('blood', cat.x, hy, cat.z, 8, dx / d, dz / d);
  burst('fur', cat.x, hy, cat.z, 6, dx / d, dz / d);
  sfx.hurt(); sfx.hit([cat.x, cat.z], dmg > 20);
  $('hurt').classList.remove('on'); void $('hurt').offsetWidth; $('hurt').classList.add('on');
  if (cat.hp <= 0) killCat();
  updateHud();
  return true;
}
function killCat(){
  cat.dead = 0.001; cat.act = null; offer = null;
  if (me.kind === 'cat') sfx.yowl(); else if (FOES[me.kind].prey) sfx.squeak([cat.x, cat.z]); else sfx.roar([cat.x, cat.z], 0.7);
  for (const a of animals) if (a.engaged){ a.engaged = false; a.state = 'wander'; a.move = null; a.wx = a.x + (Math.random() - 0.5) * 40; a.wz = a.z + (Math.random() - 0.5) * 40; }
}

// ---------------------------------------------------------------- foe brains
function updateAnimal(a, dt){
  const A = a.A, st = a.st, d = catDist(a);
  a.t += dt; a.cool -= dt; a.stagger = Math.max(0, a.stagger - dt);
  A.hurt = Math.max(0, A.hurt - dt * 3);
  let speed = 0, wantYaw = a.yaw, turnRate = 3;
  if (a.dead){
    a.deadT += dt; A.dead = Math.min(1, A.dead + dt * 1.6); A.speed = 0; A.jaw = 0;
    a.vx *= Math.exp(-dt * 4); a.vz *= Math.exp(-dt * 4); a.x += a.vx * dt; a.z += a.vz * dt;
    placeOnGround(a, dt, a.def);
    return;
  }
  const catAngle = angleTo(a, cat.x, cat.z);
  a.voiceT -= dt;
  if (a.voiceT < 0){ a.voiceT = 8 + Math.random() * 14; if (d < 90) voice(a, a.engaged); }

  if (st.prey){
    // nibble the grass; bolt from the cat, zig-zagging (and a herd runs together)
    const herdRuns = a.herd && animals.some((b) => b !== a && b.herd === a.herd && b.state === 'flee' && Math.hypot(a.x - b.x, a.z - b.z) < 20);
    if ((d < st.notice || (herdRuns && d < 45)) && !cat.dead){
      if (a.state !== 'flee'){ a.state = 'flee'; a.zig = 0.5; a.zigA = 0; a.freeze = st.freeze; }
      a.freeze -= dt;
      a.zig -= dt; if (a.zig < 0){ a.zig = 0.4 + Math.random() * 0.5; a.zigA = (Math.random() - 0.5) * 1.6; }
      wantYaw = catAngle + Math.PI + a.zigA * (a.kind === 'deer' ? 0.4 : 1); speed = a.freeze > 0 ? 0 : st.chase; turnRate = a.freeze > 0 ? 0 : (a.kind === 'deer' ? 4 : 9);
    } else {
      a.state = 'wander';
      if (Math.hypot(a.wx - a.x, a.wz - a.z) < 0.5 || a.t > 6){ a.t = 0; a.wx = a.x + (Math.random() - 0.5) * 6; a.wz = a.z + (Math.random() - 0.5) * 6; a.pause = Math.random() * 3; }
      a.pause -= dt;
      if (a.pause < 0){ wantYaw = angleTo(a, a.wx, a.wz); speed = st.wander; } else A.headPitch = 0.5;
    }
  } else if (!a.engaged){
    A.rear = Math.max(0, A.rear - dt * 2); A.swipe = 0; A.crouch = Math.max(0, A.crouch - dt * 2);
    const sees = !cat.dead && d < st.notice;
    if (sees && state === 'play'){
      // noticed: stare, then come for the cat
      if (a.state !== 'stalk'){ a.state = 'stalk'; a.t = 0; voice(a, false); }
      wantYaw = catAngle; turnRate = 4;
      if (a.t > 1.2) speed = a.kind === 'wolf' ? 3.5 : 2.6;
      A.headPitch = -0.1;
      if (d < st.engage) engage(a);
    } else if (a.state === 'hunt' && !cat.dead){
      // drawn toward the cat from far away
      wantYaw = catAngle; speed = st.walk * 2.2;
      if (d < st.notice) a.state = 'stalk';
    } else {
      a.state = 'wander';
      if (Math.hypot(a.wx - a.x, a.wz - a.z) < 2 || a.t > 25){
        a.t = 0; a.pause = Math.random() < 0.4 ? 2 + Math.random() * 5 : 0;
        a.wx = a.home.x + (Math.random() - 0.5) * 70; a.wz = a.home.z + (Math.random() - 0.5) * 70;
      }
      a.pause = (a.pause || 0) - dt;
      if (a.pause < 0){ wantYaw = angleTo(a, a.wx, a.wz); speed = st.walk; turnRate = 1.5; }
      else A.headPitch = lerp(A.headPitch, 0.55, dt);        // head down, grazing / sniffing
    }
  } else {
    fightBrain(a, dt, d, catAngle);
    speed = a.wantSpeed; wantYaw = a.wantYaw; turnRate = a.turnRate;
  }

  // move: steer, accelerate, slide off trees and rocks, stay out of the lake
  const w = turnTo(a, wantYaw, turnRate, dt);
  A.turn = lerp(A.turn, w, 1 - Math.exp(-dt * 6));
  if (a.stagger > 0) speed = 0;
  a.speed = lerp(a.speed, speed, 1 - Math.exp(-dt * (speed > a.speed ? 3 : 6)));
  let mvx = Math.sin(a.yaw) * a.speed + a.vx, mvz = Math.cos(a.yaw) * a.speed + a.vz;
  a.vx *= Math.exp(-dt * 5); a.vz *= Math.exp(-dt * 5);
  const nx = a.x + mvx * dt, nz = a.z + mvz * dt;
  if (!world.isWater(nx, nz)){ a.x = nx; a.z = nz; } else if (!a.engaged){ a.wx = a.x - (nx - a.x) * 40; a.wz = a.z - (nz - a.z) * 40; }
  if (world.collide(a, a.def.radius * 0.6) && !a.engaged && a.state === 'wander') a.t = 99;
  // keep animals from passing through one another (and the cat)
  for (const b of animals) if (b !== a && !b.dead){
    const dx = a.x - b.x, dz = a.z - b.z, dd = Math.hypot(dx, dz), m = (a.def.radius + b.def.radius) * 0.75;
    if (dd < m && dd > 1e-3){ a.x += dx / dd * (m - dd) * 0.5; a.z += dz / dd * (m - dd) * 0.5; }
  }
  if (!cat.dead){
    const m = a.def.radius * 0.8 + me.def.radius * 0.6 + 0.05;
    if (d < m && d > 1e-3 && cat.ground){ const k = (m - d); cat.x -= (a.x - cat.x) / d * k * 0.7; cat.z -= (a.z - cat.z) / d * k * 0.7; a.x += (a.x - cat.x) / d * k * 0.3; a.z += (a.z - cat.z) / d * k * 0.3; }
  }
  A.speed = a.speed;
  placeOnGround(a, dt, a.def);
  // footsteps you can hear when big things come close
  const prev = A.phase; advance(a.def, A, dt);
  if (a.speed > 0.5 && d < 40 && Math.floor(prev * 2) !== Math.floor(A.phase * 2)) sfx.step([a.x, a.z], a.st.size, a.speed > 4);
}

function fightBrain(a, dt, d, catAngle){
  const A = a.A, st = a.st;
  a.wantYaw = catAngle; a.wantSpeed = 0; a.turnRate = 3.5;
  if (cat.dead){ a.engaged = false; return; }
  const m = a.move;
  if (m){
    m.t += dt;
    const k = a.kind;
    if (m.type === 'swipe'){                       // bear: rear a little and rake with a paw
      A.rear = Math.min(0.35, m.t * 1.2) * (m.t < 0.85 ? 1 : Math.max(0, 1 - (m.t - 0.85) * 4));
      A.swipe = clamp(m.t / 0.9, 0, 1); A.swipeSide = m.side;
      a.turnRate = m.t < 0.4 ? 3 : 0.5;
      if (!m.hit && m.t > 0.5){ m.hit = true; if (d < st.reach + 0.5 && facing(a, cat.x, cat.z) < 1.2) hurtCat(18, a.x, a.z, 5); else sfx.swipe(); }
      if (m.t > 1.1){ a.move = null; A.swipe = 0; a.cool = 1.0 + Math.random() * 1.3; }
    } else if (m.type === 'slam'){                 // bear: stand up tall, roar, and crash down
      a.turnRate = m.t < 0.9 ? 2 : 0;
      A.rear = m.t < 0.9 ? Math.min(1, m.t / 0.6) : Math.max(0, 1 - (m.t - 0.9) / 0.18);
      A.jaw = m.t < 0.9 ? Math.min(1, m.t * 2) : 0.3;
      if (m.t > 0.9 && m.t < 1.1) a.wantSpeed = 3;
      if (!m.hit && m.t > 1.08){
        m.hit = true; view.shake = Math.max(view.shake, 0.5);
        burst('dust', a.x + Math.sin(a.yaw) * 1.2, a.y + 0.05, a.z + Math.cos(a.yaw) * 1.2, 10);
        sfx.hit([a.x, a.z], true);
        if (d < st.reach + 0.9 && facing(a, cat.x, cat.z) < 1.0) hurtCat(32, a.x, a.z, 9);
      }
      if (m.t > 1.6){ a.move = null; A.jaw = 0; a.cool = 1.6 + Math.random() * 1.4; }
    } else if (m.type === 'lunge'){                // wolf: crouch, then leap in and bite
      if (m.t < 0.45){ A.crouch = Math.min(1, m.t / 0.3); a.turnRate = 6; A.jaw = 0.4; }
      else if (m.t < 0.8){ A.crouch = 0; A.bite = (m.t - 0.45) / 0.35; a.wantSpeed = 0; a.turnRate = 0.5;
        const s = 9.5; a.vx = Math.sin(a.yaw) * s; a.vz = Math.cos(a.yaw) * s;
        if (!m.hit && d < st.reach){ m.hit = true; hurtCat(9, a.x, a.z, 3.5); }
      } else { A.bite = 0; A.jaw = 0; a.wantSpeed = -2; a.wantYaw = catAngle; }
      if (m.t > 1.3){ a.move = null; A.bite = 0; a.cool = 0.9 + Math.random() * 1.6; }
    } else if (m.type === 'charge'){               // boar: paw the ground, then charge in a straight line
      if (m.t < 0.8){ a.turnRate = 5; A.headPitch = 0.35; A.crouch = 0.3; if (Math.floor(m.t * 5) !== Math.floor((m.t - dt) * 5)) burst('dust', a.x, a.y, a.z, 2); }
      else {
        A.crouch = 0; a.turnRate = 0.35; A.headPitch = 0.4; a.wantSpeed = 11.5;
        if (!m.hit && d < a.def.radius + 0.45){ m.hit = true; A.gore = 0.01; hurtCat(17, a.x, a.z, 10); }
        if (A.gore > 0) A.gore = Math.min(1, A.gore + dt * 2.5);
        if (m.t > 2.1 || (m.hit && m.t > 1.2)){ a.move = null; A.gore = 0; A.headPitch = 0; a.cool = 1.2 + Math.random() * 1.2; }
        return;
      }
    } else if (m.type === 'gore'){                 // boar up close: toss the tusks
      A.gore = clamp(m.t / 0.6, 0, 1); a.turnRate = 3;
      if (!m.hit && m.t > 0.3){ m.hit = true; if (d < st.reach + 0.4 && facing(a, cat.x, cat.z) < 1.0) hurtCat(12, a.x, a.z, 6); }
      if (m.t > 0.7){ a.move = null; A.gore = 0; a.cool = 0.9 + Math.random(); }
    }
    return;
  }
  A.crouch = Math.max(0, A.crouch - dt * 3); A.rear = Math.max(0, A.rear - dt * 2.5); A.jaw = Math.max(0, A.jaw - dt * 2); A.headPitch = lerp(A.headPitch, 0, dt * 3);
  if (a.stagger > 0) return;
  // close the distance, but hold off just outside reach and circle while waiting to strike
  const want = st.reach * 1.25;
  if (d > want + 6) a.wantSpeed = st.chase;
  else if (d > want + 0.4) a.wantSpeed = lerp(2, st.chase * 0.6, clamp((d - want) / 6, 0, 1));
  else if (d < want - 0.6) a.wantSpeed = -1.2;
  else { a.wantSpeed = 0.9; a.wantYaw = catAngle + (a.circle || (a.circle = Math.random() < 0.5 ? 1.2 : -1.2)); }
  // packs: wolves spread around the cat rather than queueing
  if (a.kind === 'wolf'){
    for (const b of animals) if (b !== a && b.engaged && !b.dead && b.kind === 'wolf' && Math.hypot(a.x - b.x, a.z - b.z) < 2.5 && d < 5){ a.wantYaw = catAngle + (a.circle > 0 ? 1.4 : -1.4); a.wantSpeed = 2.5; }
  }
  // ready to strike: stop circling and square up first
  if (a.cool <= 0){ a.wantYaw = catAngle; a.turnRate = 4.5; }
  if (a.cool <= 0 && facing(a, cat.x, cat.z) < 0.5){
    const k = a.kind;
    if (k === 'bear' && d < st.reach + 1.4) a.move = { type: Math.random() < 0.35 ? 'slam' : 'swipe', t: 0, side: Math.random() < 0.5 ? 1 : -1 };
    else if (k === 'wolf' && d < 4.2){
      // only one wolf jumps at a time
      if (!animals.some((b) => b !== a && b.move && b.kind === 'wolf')) a.move = { type: 'lunge', t: 0 };
      else a.cool = 0.4;
    }
    else if (k === 'boar' && d > 3.5 && d < 14) a.move = { type: 'charge', t: 0 };
    else if (k === 'boar' && d < st.reach + 0.6) a.move = { type: 'gore', t: 0 };
    if (a.move){
      if (k === 'bear' && a.move.type === 'slam') sfx.roar([a.x, a.z]);
      else if (k === 'wolf') sfx.snarl([a.x, a.z]);
      else if (k === 'boar') a.move.type === 'charge' ? sfx.squeal([a.x, a.z]) : sfx.grunt([a.x, a.z]);
      else if (Math.random() < 0.4) sfx.growl([a.x, a.z], 75);
    }
  }
}

// ---------------------------------------------------------------- input
try { if ('gamepadInputEmulation' in navigator) navigator.gamepadInputEmulation = 'gamepad'; } catch (e) {}
const keys = {}, look = { dx: 0, dy: 0 }, pressed = new Set(), touch = { move: null, look: null, mx: 0, my: 0 }, held = {};
let padPrev = [];
addEventListener('keydown', (e) => {
  if (e.repeat) return; keys[e.code] = true;
  const map = { Space: 'pounce', KeyJ: 'swipe', KeyK: 'dodge', KeyQ: 'dodge', ControlLeft: 'dodge', KeyE: 'become', KeyY: 'become', ArrowLeft: 'prevAnimal', ArrowRight: 'nextAnimal', Escape: 'pause', KeyP: 'pause', KeyM: 'mute', Enter: 'confirm' };
  if (map[e.code]){ pressed.add(map[e.code]); if (e.code === 'Space') e.preventDefault(); }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
renderer.domElement.addEventListener('mousedown', (e) => {
  if (state !== 'play' || document.body.classList.contains('touch')) return;
  if (!document.pointerLockElement && !TEST){ lockPointer(); return; }
  if (e.button === 0) pressed.add('swipe'); if (e.button === 2) pressed.add('dodge');
});
addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('mousemove', (e) => { if (document.pointerLockElement && state === 'play'){ look.dx += e.movementX; look.dy += e.movementY; } });
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && state === 'play' && !document.body.classList.contains('touch')) pause(); });
function lockPointer(){ if (TEST || document.body.classList.contains('touch')) return; try { const p = renderer.domElement.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) {} }

const stickEl = $('stick'), knobEl = $('knob');
addEventListener('touchstart', (e) => {
  document.body.classList.add('touch');
  if (state !== 'play') return;
  for (const t of e.changedTouches){
    if (t.target.closest && t.target.closest('.tbtn')) continue;
    if (t.clientX < innerWidth * 0.45 && !touch.move){
      touch.move = { id: t.identifier, x: t.clientX, y: t.clientY }; touch.mx = touch.my = 0;
      stickEl.style.left = t.clientX + 'px'; stickEl.style.top = t.clientY + 'px'; stickEl.classList.add('on');
    } else if (!touch.look) touch.look = { id: t.identifier, x: t.clientX, y: t.clientY };
  }
}, { passive: true });
addEventListener('touchmove', (e) => {
  for (const t of e.changedTouches){
    if (touch.move && t.identifier === touch.move.id){
      let dx = (t.clientX - touch.move.x) / 50, dy = (t.clientY - touch.move.y) / 50;
      const l = Math.hypot(dx, dy); if (l > 1.25){ dx *= 1.25 / l; dy *= 1.25 / l; }
      touch.mx = dx; touch.my = dy; knobEl.style.transform = `translate(${dx * 40}px, ${dy * 40}px)`;
    } else if (touch.look && t.identifier === touch.look.id){
      look.dx += (t.clientX - touch.look.x) * 1.6; look.dy += (t.clientY - touch.look.y) * 1.6;
      touch.look.x = t.clientX; touch.look.y = t.clientY;
    }
  }
}, { passive: true });
function endTouch(e){
  for (const t of e.changedTouches){
    if (touch.move && t.identifier === touch.move.id){ touch.move = null; touch.mx = touch.my = 0; stickEl.classList.remove('on'); knobEl.style.transform = ''; }
    if (touch.look && t.identifier === touch.look.id) touch.look = null;
  }
}
addEventListener('touchend', endTouch); addEventListener('touchcancel', endTouch);
for (const el of document.querySelectorAll('.tbtn')){
  const a = el.dataset.act;
  el.addEventListener('touchstart', (e) => { e.preventDefault(); held[a] = true; pressed.add(a); el.classList.add('down'); }, { passive: false });
  el.addEventListener('touchend', (e) => { e.preventDefault(); held[a] = false; el.classList.remove('down'); }, { passive: false });
  el.addEventListener('click', () => { if (!document.body.classList.contains('touch')) pressed.add(a); });
}
// B on an Xbox controller is "back" in the browser: keep a history entry to absorb it
history.pushState({ wc: 1 }, '');
addEventListener('popstate', () => { history.pushState({ wc: 1 }, ''); pressed.add('dodge'); });

function readPad(){
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let pad = null; for (const p of pads) if (p && p.connected !== false){ pad = p; break; }
  if (!pad) return null;
  const btn = (i) => !!(pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.5));
  const was = (i) => btn(i) && !padPrev[i];
  const dz = (v, d) => { const a = Math.abs(v); return a < d ? 0 : Math.sign(v) * (a - d) / (1 - d); };
  const out = { lx: pad.axes[0] || 0, ly: pad.axes[1] || 0, rx: dz(pad.axes[2] || 0, 0.12), ry: dz(pad.axes[3] || 0, 0.12), sprint: btn(10) || btn(6) || btn(4) };
  const ll = Math.hypot(out.lx, out.ly), lk = ll > 0.15 ? (ll - 0.15) / 0.85 / ll : 0; out.lx *= lk; out.ly *= lk;
  const map = { 0: 'pounce', 2: 'swipe', 7: 'swipe', 5: 'swipe', 1: 'dodge', 9: 'pause', 3: 'become', 14: 'prevAnimal', 15: 'nextAnimal' };
  for (const k in map) if (was(+k)) pressed.add(map[k]);
  if (was(0) || was(9)) pressed.add('confirm');
  padPrev = pad.buttons.map((b) => !!(b && (b.pressed || b.value > 0.5)));
  return out;
}

// ---------------------------------------------------------------- the cat
function updateCat(dt, pad){
  const A = catA, onGround = cat.ground;
  cat.invuln = Math.max(0, cat.invuln - dt); cat.hurtT = Math.max(0, cat.hurtT - dt * 3); A.hurt = cat.hurtT;
  if (cat.dead){
    cat.dead += dt; A.dead = Math.min(1, A.dead + dt * 2); A.speed = 0; cat.speed = 0;
    if (cat.dead > 2.6 && state === 'play') showDead();
    return;
  }
  // camera-relative stick
  let mx = 0, mz = 0;
  if (keys.KeyW || keys.ArrowUp) mz -= 1; if (keys.KeyS || keys.ArrowDown) mz += 1;
  if (keys.KeyA || keys.ArrowLeft) mx -= 1; if (keys.KeyD || keys.ArrowRight) mx += 1;
  if (pad){ mx += pad.lx; mz += pad.ly; }
  mx += touch.mx; mz += touch.my;
  if (window.__wc.stick){ mx += window.__wc.stick[0]; mz += window.__wc.stick[1]; }
  let m = Math.hypot(mx, mz); if (m > 1){ mx /= m; mz /= m; m = 1; }
  const fx = -Math.sin(view.yaw), fz = -Math.cos(view.yaw), rx = Math.cos(view.yaw), rz = -Math.sin(view.yaw);
  const dirx = fx * -mz + rx * mx, dirz = fz * -mz + rz * mx;
  const wantSprint = !!(keys.ShiftLeft || keys.ShiftRight || (pad && pad.sprint) || Math.hypot(touch.mx, touch.my) > 1.1 || window.__wc.sprint);
  cat.sprinting = wantSprint && m > 0.3 && cat.stam > 1 && onGround;
  cat.stamWait -= dt;
  if (cat.sprinting){ cat.stam = Math.max(0, cat.stam - dt * 16); cat.stamWait = 0.8; }
  else if (cat.stamWait <= 0) cat.stam = Math.min(100, cat.stam + dt * 24);
  if (cat.eatT > 0){ cat.eatT -= dt; A.crouch = Math.min(1, A.crouch + dt * 4); A.headPitch = 0.8; m = 0; }
  else A.headPitch = lerp(A.headPitch, 0, dt * 4);

  // actions
  const focus = nearestFoe(6);
  const tryAct = (name) => {
    if (cat.eatT > 0) return false;
    if (name === 'swipe' && onGround && (!cat.act || (cat.act === 'swipe' && cat.actT > 0.26))){
      cat.act = 'swipe'; cat.actT = 0; cat.hitDone = false; cat.swipeSide = -cat.swipeSide; attackSound();
      if (focus) cat.yaw = angleTo(cat, focus.x, focus.z);
      return true;
    }
    if (name === 'pounce' && onGround && !cat.act && cat.stam >= 20){
      cat.act = 'pounce'; cat.actT = 0; cat.hitDone = false; cat.stam -= 20; cat.stamWait = 0.6;
      let sp = 6.5 * CAT_STATS.leap;
      const tgt = nearestFoe(7 * CAT_STATS.leap, true);
      let vy = 4.0 * CAT_STATS.leap;
      // at something: a flatter, faster leap that comes down on it
      if (tgt){
        // lead a moving target: aim where it will be when the cat comes down
        const lx = tgt.x + Math.sin(tgt.yaw) * tgt.speed * 0.4, lz = tgt.z + Math.cos(tgt.yaw) * tgt.speed * 0.4;
        cat.yaw = Math.atan2(lx - cat.x, lz - cat.z); vy = 3.4 * CAT_STATS.leap; cat.pounceAt = tgt;
        sp = clamp((Math.hypot(lx - cat.x, lz - cat.z) - tgt.def.radius * 0.5) / 0.42, 3, 11);
      }
      else { cat.pounceAt = null; if (m > 0.2) cat.yaw = Math.atan2(dirx, dirz); }
      cat.vx = Math.sin(cat.yaw) * sp; cat.vz = Math.cos(cat.yaw) * sp; cat.vy = vy; cat.ground = false;
      sfx.pounce(); return true;
    }
    if (name === 'dodge' && onGround && (!cat.act || cat.act === 'swipe') && cat.stam >= 15){
      cat.act = 'dodge'; cat.actT = 0; cat.stam -= 15; cat.stamWait = 0.5; cat.invuln = Math.max(cat.invuln, 0.35);
      let ddx = dirx, ddz = dirz;
      if (m < 0.2){ ddx = -Math.sin(cat.yaw); ddz = -Math.cos(cat.yaw); }
      const l = Math.hypot(ddx, ddz) || 1;
      cat.vx = ddx / l * 7.5; cat.vz = ddz / l * 7.5; cat.vy = 2.2; cat.ground = false;
      sfx.hiss(); return true;
    }
    return false;
  };
  for (const p of ['dodge', 'pounce', 'swipe']) if (pressed.has(p)){ if (!tryAct(p) && p === 'swipe' && cat.act === 'swipe') cat.queued = 'swipe'; }
  if (cat.queued && cat.act === 'swipe' && cat.actT > 0.26){ cat.queued = null; tryAct('swipe'); }

  if (cat.act){
    cat.actT += dt;
    if (cat.act === 'swipe'){
      const pr = clamp(cat.actT / 0.42, 0, 1);
      if (CAT_STATS.attack === 'swipe'){ A.swipe = pr; A.swipeSide = cat.swipeSide; }
      else if (CAT_STATS.attack === 'bite') A.bite = pr;
      else A.gore = pr;
      // a little lunge at whatever you're clawing, so it lands
      if (focus && cat.actT < 0.16){
        const d = catDist(focus) - focus.def.radius * 0.8 - me.def.radius * 0.6 - 0.2;
        if (d > 0 && d < 1.4){ const st = Math.min(d, 5 * dt); cat.x += Math.sin(cat.yaw) * st; cat.z += Math.cos(cat.yaw) * st; }
      }
      if (!cat.hitDone && cat.actT > 0.16){
        cat.hitDone = true;
        const dmg = (CAT_STATS.swipe + Math.random() * 3) * (1 + (cat.level - 1) * 0.22);
        for (const a of animals){
          if (a.dead) continue;
          const d = catDist(a), reach = 0.45 + a.def.radius + me.def.radius * 0.6;
          if (d < reach && facing(cat, a.x, a.z) < 1.1) hurtAnimal(a, dmg, false);
        }
      }
      if (cat.actT > 0.42){ cat.act = null; A.swipe = 0; A.bite = 0; A.gore = 0; }
      m *= 0.3;
    } else if (cat.act === 'pounce'){
      A.leap = Math.min(1, A.leap + dt * 8);
      // steer in the air toward what you leapt at, a little faster than it can run
      const t = cat.pounceAt;
      if (t && !t.dead && !cat.hitDone){
        const want = angleTo(cat, t.x, t.z);
        turnTo(cat, want, 8, dt);
        // time left in the air, and the speed that lands right on it (up to a limit)
        const above = Math.max(0, cat.y - world.heightAt(cat.x, cat.z));
        const tLeft = (cat.vy + Math.sqrt(cat.vy * cat.vy + 26 * above)) / 13;
        const need = Math.hypot(t.x - cat.x, t.z - cat.z) / Math.max(tLeft, 0.08);
        const sp = clamp(Math.max(need, t.speed + 2.5), 0, 14);
        cat.vx = Math.sin(cat.yaw) * sp; cat.vz = Math.cos(cat.yaw) * sp;
      }
      if (!cat.hitDone){
        for (const a of animals){
          if (a.dead) continue;
          const d = Math.hypot(a.x - cat.x, a.z - cat.z);
          if (d < a.def.radius + me.def.radius * 0.5 + (a.st.prey && a.kind !== 'deer' ? 0.4 : 0.25) && cat.y - a.y < a.def.height * 1.2 + 0.4){
            cat.hitDone = true;
            hurtAnimal(a, CAT_STATS.pounce * (1 + (cat.level - 1) * 0.15), true);
            // bounce back off it
            cat.vx = -Math.sin(cat.yaw) * 3; cat.vz = -Math.cos(cat.yaw) * 3; cat.vy = Math.max(cat.vy, 2.5);
            break;
          }
        }
      }
    } else if (cat.act === 'dodge'){
      A.crouch = 0.4;
    }
  }
  if (cat.act !== 'pounce') A.leap = Math.max(0, A.leap - dt * 5);
  if (cat.eatT <= 0 && cat.act !== 'dodge') A.crouch = Math.max(0, A.crouch - dt * 4);

  // running and turning
  if (cat.ground){
    const top = cat.sprinting ? CAT_STATS.sprint : lerp(CAT_STATS.walk, CAT_STATS.trot, clamp((m - 0.3) / 0.6, 0, 1));
    const target = m > 0.05 ? top * Math.min(1, m * 1.4) : 0;
    let turnRate = 7;
    if (m > 0.05 && cat.act !== 'swipe'){
      const want = Math.atan2(dirx, dirz);
      const w = turnTo(cat, want, turnRate, dt); A.turn = lerp(A.turn, w, 1 - Math.exp(-dt * 8));
    } else A.turn = lerp(A.turn, 0, 1 - Math.exp(-dt * 8));
    // in a fight the cat squares up to its enemy when it isn't running
    if (focus && m < 0.05 && !cat.act) turnTo(cat, angleTo(cat, focus.x, focus.z), 5, dt);
    cat.speed = lerp(cat.speed, target, 1 - Math.exp(-dt * (target > cat.speed ? 6 : 10)));
    cat.vx = Math.sin(cat.yaw) * cat.speed; cat.vz = Math.cos(cat.yaw) * cat.speed;
  }
  let vx = cat.vx + cat.kx, vz = cat.vz + cat.kz;
  cat.kx *= Math.exp(-dt * 6); cat.kz *= Math.exp(-dt * 6);
  const nx = cat.x + vx * dt, nz = cat.z + vz * dt;
  if (!world.isWater(nx, nz, 0.3)){ cat.x = nx; cat.z = nz; }
  else if (!cat.lakeHint){ cat.lakeHint = true; hint('TOO DEEP TO SWIM', 2); }
  world.collide(cat, Math.max(0.12, me.def.radius * 0.6));
  const gy = world.heightAt(cat.x, cat.z);
  if (!cat.ground){
    cat.vy -= 13 * dt; cat.y += cat.vy * dt;
    if (cat.y <= gy){
      cat.y = gy; cat.ground = true; cat.vy = 0;
      if (cat.act === 'pounce' || cat.act === 'dodge'){ cat.act = null; sfx.land(); burst('dust', cat.x, gy, cat.z, 3); cat.speed = Math.hypot(cat.vx, cat.vz) * 0.4; }
    }
  } else cat.y = gy;
  const ground = { x: cat.x, z: cat.z, yaw: cat.yaw, pitch: catObj.userData.pitch, ground: cat.ground, y: cat.y };
  placeOnGround(ground, dt, me.def); catObj.userData.pitch = ground.pitch;
  A.speed = cat.ground ? cat.speed : 0;
  const prev = A.phase; advance(me.def, A, dt);
  if (cat.ground && cat.speed > 0.6 && Math.floor(prev * 2) !== Math.floor(A.phase * 2)) sfx.step(null, me.kind === 'cat' ? 0.6 : FOES[me.kind].size, cat.sprinting);
  // health creeps back when nothing is fighting you
  if (!fightActive && cat.hp < cat.maxHp) cat.hp = Math.min(cat.maxHp, cat.hp + dt * 1.2);
}
function nearestFoe(range, includePrey){
  let best = null, bd = range;
  for (const a of animals){
    if (a.dead || (!a.engaged && !(includePrey && a.st.prey))) continue;
    const d = catDist(a);
    if (d < bd){ bd = d; best = a; }
  }
  return best;
}

// ---------------------------------------------------------------- camera
const camTarget = new THREE.Vector3();
function updateCamera(dt, pad){
  let yawRate = 0, pitchRate = 0;
  if (pad){ const k = (v) => Math.sign(v) * Math.pow(Math.abs(v), 1.6); yawRate -= k(pad.rx) * 2.8; pitchRate += k(pad.ry) * 1.6; }
  const mdx = look.dx, mdy = look.dy; look.dx = look.dy = 0;
  view.yaw += yawRate * dt - mdx * 0.0026; view.pitch += pitchRate * dt + mdy * 0.0022;
  if (Math.abs(yawRate) > 0.01 || Math.abs(mdx) > 0) view.manualT = 1.5;
  view.manualT -= dt;
  view.pitch = clamp(view.pitch, -0.25, 1.2);
  // in a fight, swing round to keep the enemy in view; otherwise drift in behind the cat when it runs
  const foe = nearestFoe(25);
  const big = Math.max(0.4, Math.pow(me.def.height / 0.38, 0.65));
  let dist = 2.4 * big;
  if (foe){
    const between = Math.atan2(cat.x - foe.x, cat.z - foe.z);
    if (view.manualT < 0) view.yaw += wrapA(between - view.yaw) * (1 - Math.exp(-dt * 2.2));
    dist = 2.3 * big + foe.def.height * 1.6;
  } else if (view.manualT < 0 && cat.speed > 2.5){
    view.yaw += wrapA(cat.yaw + Math.PI - view.yaw) * (1 - Math.exp(-dt * 0.8));
  }
  view.dist = lerp(view.dist, dist, 1 - Math.exp(-dt * 2));
  camTarget.set(cat.x, cat.y + me.def.height * 0.85 + (foe ? foe.def.height * 0.25 : 0), cat.z);
  const cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
  let x = camTarget.x + Math.sin(view.yaw) * cp * view.dist, z = camTarget.z + Math.cos(view.yaw) * cp * view.dist, y = camTarget.y + sp * view.dist;
  // pull in closer rather than sit inside a boulder or tree
  for (let k = 0; k < 8 && world.blocked(x, z, 0.35); k++){ x = lerp(x, camTarget.x, 0.25); z = lerp(z, camTarget.z, 0.25); y = lerp(y, camTarget.y, 0.15); }
  const gy = world.heightAt(x, z) + 0.22;
  if (y < gy) y = gy;
  // smooth follow
  const k = 1 - Math.exp(-dt * 12);
  view.x = lerp(view.x || x, x, k); view.y = lerp(view.y || y, y, k); view.z = lerp(view.z || z, z, k);
  camera.position.set(view.x, view.y, view.z);
  camera.lookAt(camTarget);
  if (view.shake > 0){
    view.shake = Math.max(0, view.shake - dt * 2.5);
    const s = view.shake * view.shake * 0.05;
    camera.position.x += (Math.random() - 0.5) * s; camera.position.y += (Math.random() - 0.5) * s;
  }
  camera.fov = lerp(camera.fov, cat.sprinting ? 62 : 55, 1 - Math.exp(-dt * 3)); camera.updateProjectionMatrix();
  setListener(camera.position.x, camera.position.z, view.yaw);
}

// ---------------------------------------------------------------- HUD
let hintT = 0, bannerT = 0;
function hint(text, sec){ const h = $('hint'); h.textContent = text; h.classList.add('show'); hintT = sec; }
function banner(title, text){ $('bannerTitle').textContent = title; $('bannerText').textContent = text || ''; $('banner').classList.add('show'); bannerT = 3.2; }
function updateHud(){
  $('hpFill').style.width = (cat.hp / cat.maxHp * 100) + '%';
  $('hpText').textContent = Math.ceil(cat.hp) + ' / ' + cat.maxHp;
  $('stFill').style.width = cat.stam + '%';
  $('rank').textContent = RANKS[cat.level - 1];
  $('lvl').textContent = 'LEVEL ' + cat.level;
  const next = LEVEL_XP[cat.level];
  $('xpFill').style.width = next ? ((cat.xp - LEVEL_XP[cat.level - 1]) / (next - LEVEL_XP[cat.level - 1]) * 100) + '%' : '100%';
  $('wins').textContent = stats.wins; $('caught').textContent = stats.caught;
}
function updateFoeBar(){
  const foes = animals.filter((a) => a.engaged && !a.dead).sort((a, b) => catDist(a) - catDist(b));
  const el = $('foeBar');
  if (!foes.length){ el.classList.remove('show'); return; }
  el.classList.add('show');
  const f = foes[0];
  $('foeName').textContent = f.st.name + (foes.length > 1 ? '  ×' + foes.length : '');
  $('foeFill').style.width = Math.max(0, f.hp / f.maxHp * 100) + '%';
}

// ---------------------------------------------------------------- flow
function startGame(){
  initAudio();
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
  document.body.classList.add('playing');
  state = 'play';
  lockPointer();
  hint(isTouchDevice ? 'LEFT THUMB TO MOVE · RIGHT THUMB TO LOOK' : 'FIND YOUR WAY IN THE WILD', 4);
}
// ---------------------------------------------------------------- being something else
function maxHpFor(){ return Math.round(PLAY[me.kind].hp * (1 + (cat.level - 1) * 0.15)); }
function attackSound(){
  if (me.kind === 'cat') sfx.swipe();
  else if (me.kind === 'bear'){ sfx.swipe(); if (Math.random() < 0.4) sfx.growl([cat.x, cat.z], 70); }
  else if (me.kind === 'wolf') sfx.snarl([cat.x, cat.z]);
  else if (me.kind === 'boar') sfx.grunt([cat.x, cat.z]);
  else if (me.kind === 'deer') sfx.swipe();
  else sfx.squeak([cat.x, cat.z]);
}
function setPlayer(key){
  if (!SPECIES[key]) key = 'cat';
  const ratio = catObj ? cat.hp / cat.maxHp : 1;
  if (catObj) scene.remove(catObj);
  me.key = key; me.kind = kindOf(key); me.def = SPECIES[key]; me.P = PLAY[me.kind]; CAT_STATS = me.P;
  catObj = makeCreature(me.def, QUALITY); catObj.userData.pitch = 0;
  scene.add(catObj);
  catA = newAnim();
  cat.maxHp = maxHpFor(); cat.hp = Math.max(1, Math.round(cat.maxHp * ratio));
  cat.act = null; cat.eatT = 0;
  chosen = key;
  try { localStorage.setItem('wildcat-animal', key); } catch (e) {}
  renderChooser(); updateHud();
}
function become(key){
  if (!unlocked.has(key) || key === me.key) return;
  setPlayer(key);
  burst('fur', cat.x, cat.y + me.def.height * 0.5, cat.z, 14);
  if (state === 'play') banner('YOU ARE A ' + me.def.label.toUpperCase(), me.kind === 'cat' ? '' : 'Press ' + (isTouchDevice ? 'the claw button' : 'claw') + ' to ' + me.P.verb + '.');
}
// the picker on the title and pause screens
function renderChooser(){
  for (const el of document.querySelectorAll('.chooser')){
    el.innerHTML = '';
    for (const k of CHOICES){
      const b = document.createElement('button');
      const open = unlocked.has(k);
      b.className = 'pick' + (k === chosen ? ' on' : '') + (open ? '' : ' locked');
      b.textContent = open ? SPECIES[k].label : SPECIES[k].label + ' \u2014 beat one';
      b.disabled = !open;
      b.onclick = () => { if (open && k !== chosen) setPlayer(k); };
      el.appendChild(b);
    }
  }
}
function cycleChoice(dir){
  const open = CHOICES.filter((k) => unlocked.has(k));
  const i = open.indexOf(chosen);
  setPlayer(open[(i + dir + open.length) % open.length]);
}
function respawn(){
  for (const a of animals.slice()) despawn(a);
  Object.assign(cat, { x: DEN.x, z: DEN.z, hp: cat.maxHp, stam: 100, dead: 0, act: null, vx: 0, vz: 0, vy: 0, kx: 0, kz: 0, ground: true, eatT: 0, invuln: 2, speed: 0 });
  catA = newAnim(); hunterT = 30;
  for (let i = 0; i < 4; i++) population();
}
function showDead(){
  state = 'dead'; document.body.classList.remove('playing');
  if (document.pointerLockElement) document.exitPointerLock();
  $('deadStat').textContent = `You beat ${stats.wins} ${stats.wins === 1 ? 'animal' : 'animals'} and caught ${stats.caught} to eat. Level ${cat.level}: ${RANKS[cat.level - 1].toLowerCase()}.`;
  saveBest();
  $('dead').classList.remove('hidden');
}
function saveBest(){
  best.wins = Math.max(best.wins, stats.wins); best.level = Math.max(best.level, cat.level);
  try { localStorage.setItem('wildcat-best', JSON.stringify(best)); } catch (e) {}
}
function pause(){
  if (state !== 'play') return;
  state = 'pause'; document.body.classList.remove('playing'); $('pause').classList.remove('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
}
function resume(){ $('pause').classList.add('hidden'); document.body.classList.add('playing'); state = 'play'; lockPointer(); }
$('startBtn').onclick = startGame;
$('resumeBtn').onclick = resume;
$('retryBtn').onclick = () => { $('dead').classList.add('hidden'); respawn(); startGame(); };
$('muteBtn').onclick = () => { setMuted(!isMuted()); $('muteBtn').textContent = isMuted() ? 'SOUND OFF' : 'SOUND ON'; };

// ---------------------------------------------------------------- main loop
let last = performance.now(), birdT = 3, popT = 0, fpsAcc = 0, fpsN = 0, frames = 0;
const pushers = [];
function frame(now){
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (window.__wc.fixedDt) dt = window.__wc.fixedDt;
  frames++;
  const pad = readPad();
  if (state !== 'play'){
    // LB / RB (or the d-pad, or the arrow keys) choose what to be
    const lb = padPrev[4], rb = padPrev[5];
    if (pressed.has('prevAnimal') || (lb && !frame.lb)) cycleChoice(-1);
    if (pressed.has('nextAnimal') || (rb && !frame.rb)) cycleChoice(1);
    frame.lb = lb; frame.rb = rb;
  }
  if (state === 'title' || state === 'dead'){
    if (pressed.has('confirm') && !$('startBtn').disabled) (state === 'dead' ? $('retryBtn') : $('startBtn')).click();
  } else if (state === 'pause'){
    if (pressed.has('pause') || pressed.has('confirm')) resume();
  } else if (state === 'play'){
    if (pressed.has('pause')) pause();
    if (pressed.has('mute')) $('muteBtn').click();
    if (offer){ offer.t -= dt; if (offer.t <= 0) offer = null; }
    $('becomeBtn').classList.toggle('hidden', !offer);
    if (offer) $('becomeBtn').textContent = 'BE ' + SPECIES[offer.kind].label.toUpperCase().split(' ').pop();
    if (pressed.has('become') && offer && !cat.dead){ const k = offer.kind; offer = null; become(k); $('hint').classList.remove('show'); }
  }
  const playing = state === 'play';
  if (world && catObj){
    time += dt;
    if (playing){
      updateCat(dt, pad);
      for (const a of animals.slice()) updateAnimal(a, dt);
      popT -= dt; if (popT < 0 && !window.__wc.noSpawn){ popT = 2; population(); }
      // every so often something far off picks up the cat's scent and comes looking
      hunterT -= dt;
      if (hunterT < 0 && !fightActive){
        hunterT = 35 + Math.random() * 30;
        const c = animals.filter((a) => !a.dead && !a.st.prey && !a.engaged && a.state === 'wander');
        if (c.length){ const a = c[Math.floor(Math.random() * c.length)]; a.state = 'hunt'; for (const b of animals) if (a.pack && b.pack === a.pack) b.state = 'hunt'; voice(a, false); }
      }
      const wasFight = fightActive;
      fightActive = animals.some((a) => a.engaged && !a.dead);
      if (fightActive !== wasFight) sfx.fight(fightActive);
      if (fightActive){ fightBeat += dt * 2.4; if (Math.floor(fightBeat) !== Math.floor(fightBeat - dt * 2.4)) sfx.drum(Math.floor(fightBeat)); }
      birdT -= dt; if (birdT < 0){ birdT = 2 + Math.random() * 6; if (!fightActive) sfx.bird([cat.x + (Math.random() - 0.5) * 60, cat.z + (Math.random() - 0.5) * 60]); }
      updateHud(); updateFoeBar();
      hintT -= dt; if (hintT < 0) $('hint').classList.remove('show');
      bannerT -= dt; if (bannerT < 0) $('banner').classList.remove('show');
    } else if (state === 'title'){
      // the title screen: the camera drifts slowly round the cat in its den
      view.yaw += dt * 0.08;
    }
    // pose and place everything
    catObj.position.set(cat.x, cat.y, cat.z);
    catObj.rotation.set(catObj.userData.pitch || 0, cat.yaw, 0, 'YXZ');
    pose(catObj, me.def, catA);
    furLOD(catObj, camera.position.distanceTo(catObj.position));
    pushers.length = 0;
    pushers.push({ x: cat.x, z: cat.z, r: Math.max(0.35, me.def.radius * 1.6) });
    for (const a of animals){
      const dc = camera.position.distanceTo(a.obj.position);
      a.obj.visible = dc < 170 * clamp(a.def.height * 2.5, 0.25, 1) && !(a.st.prey && a.dead);
      if (!a.obj.visible) continue;
      a.obj.position.set(a.x, a.y, a.z);
      a.obj.rotation.set(a.pitch || 0, a.yaw, 0, 'YXZ');
      pose(a.obj, a.def, a.A);
      furLOD(a.obj, dc);
      if (pushers.length < 8 && dc < 30 && !a.dead) pushers.push({ x: a.x, z: a.z, r: a.def.radius * 1.5 });
    }
    updateCamera(dt, playing ? pad : null);
    world.update(dt, time, cat, pushers);
    // the wind ruffles fur too
    const g = Math.sin(time * 1.3) * 0.5 + Math.sin(time * 0.37) * 0.5;
    for (const k in SPECIES) if (SPECIES[k].gust) SPECIES[k].gust.value.set(g * 0.25, 0, g * 0.12);
    updateParts(dt);
    if (!window.__wc.renderEvery || frames % window.__wc.renderEvery === 0) renderer.render(scene, camera);
    fpsAcc += dt; fpsN++;
    if (fpsAcc > 1){ window.__wc.fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; if (Q.has('fps')) $('debug').textContent = Math.round(window.__wc.fps) + ' fps'; }
  }
  pressed.clear();
}

// ---------------------------------------------------------------- boot
window.__wc = { god: false, stick: null, sprint: false, fixedDt: 0, cat, animals, stats, view,
  get state(){ return state; }, get fight(){ return fightActive; }, get frames(){ return frames; },
  press(a){ pressed.add(a); },
  spawn(kind, dx, dz){ const a = spawn(kind, cat.x + dx, cat.z + dz); a.yaw = angleTo(a, cat.x, cat.z); return animals.indexOf(a); },
  clear(){ for (const a of animals.slice()) despawn(a); },
  hunters: (on) => { hunterT = on ? 0 : 1e9; },
  forestSpot(){ for (let r = 20; r < 300; r += 5) for (let a = 0; a < 6.28; a += 0.2){ const x = Math.sin(a) * r, z = Math.cos(a) * r; if (world.forestAt(x, z) > 0.62 && !world.isWater(x, z)) return [x, z]; } return [0, 0]; },
  shore(){ for (let d = 5; d < 120; d += 0.5){ const x = LAKE.x + d * 0.7, z = LAKE.z + d * 0.7; if (world.heightAt(x, z) > LAKE.level + 0.3) return [x + 1.5, z + 1.5, Math.atan2(0.7, 0.7)]; } return [LAKE.x, LAKE.z, 0]; },
  setPlayer: (k) => setPlayer(k), get me(){ return me.key; }, unlock: (k) => unlock(k), get offer(){ return offer; },
  teleport(x, z){ cat.x = x; cat.z = z; cat.y = world.heightAt(x, z); },
};
async function boot(){
  const L = $('loading');
  L.textContent = 'PAINTING THE FOREST'; await tick();
  T = makeTextures(QUALITY);
  L.textContent = 'GROWING THE TREES'; await tick();
  world = createWorld(renderer, scene, T, QUALITY);
  for (const k of ['cat', 'bear', 'wolf', 'boar', 'rabbit', 'hare', 'mouse', 'squirrel', 'deer']){ L.textContent = 'WAKING THE ' + ({ cat: 'WILDCAT', mouse: 'MICE', deer: 'DEER', wolf: 'WOLVES' }[k] || k.toUpperCase() + 'S'); await tick(); buildSpecies(SPECIES[k], QUALITY); }
  if (chosen !== 'cat'){ await tick(); buildSpecies(SPECIES[chosen], QUALITY); }
  renderChooser();
  setPlayer(chosen);
  cat.y = world.heightAt(cat.x, cat.z);
  view.yaw = 2.4; view.pitch = 0.25;
  for (let i = 0; i < 4; i++) population();
  // warm up: compile every shader before the start button lights
  L.textContent = 'LISTENING TO THE WIND'; await tick();
  updateCamera(0.016, null); world.update(0.016, 0, cat, [{ x: cat.x, z: cat.z, r: 0.3 }]);
  renderer.compile(scene, camera);
  L.textContent = ''; $('startBtn').disabled = false;
  $('best').textContent = best.wins ? `Best: ${best.wins} beaten · ${RANKS[best.level - 1].toLowerCase()}` : '';
  window.__wc.ready = true;
  updateHud();
}
requestAnimationFrame(frame);
boot().catch((e) => { $('loading').textContent = 'SOMETHING WENT WRONG: ' + e.message; console.error(e); });
if ('serviceWorker' in navigator && !TEST && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1'){
  navigator.serviceWorker.register('/experiments/wildcat/sw.js', { scope: '/experiments/wildcat/' }).catch(() => {});
}
