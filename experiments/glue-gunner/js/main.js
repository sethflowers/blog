// Glue Gunner: the main loop. You're on a floating deck the size of a football field, high in an
// alien sky, with ten aliens. Your gun shoots glue strings: the first shot sticks one end to
// whatever it hits, the second shot sticks the other end. Then the glue sets and the string shrinks,
// hard: glue an alien to a floating block and it's hauled up off its feet until something rips off.
//  - iPad / computer: first person. Left thumb (or WASD) walks, drag to look, tap (or click) shoots
//    where you tap, the big GLUE button (or Space) shoots the middle, ✂ (or C) cuts every string.
//  - VR: a glue gun in each hand (triggers). Left stick walks, right stick turns, grip cuts the
//    strings, X/Y opens the menu, B closes it.
import * as THREE from 'three';
import { V, clamp, damp, angleDiff, textCanvas, roundRect, wrapText } from './util.js';
import { World, START, SUN_DIR, HX, HZ } from './world.js';
import { Alien, Debris, alienKit, partName, BONE } from './alien.js';
import { Glue, MAX_STRINGS, endPos } from './glue.js';
import { Effects } from './fx.js';
import { makeGun, setGunState, drawGunScreen } from './gear.js';
import { ScreenPanel, VRPanel } from './ui.js';
import { startAudio, sfx, setHealthForAudio } from './audio.js';

// let the loading screen say "Building…" (and draw it) before the world is built
if (window.__loading) await window.__loading();

const $ = (id) => document.getElementById(id);
const VERSION = document.body.dataset.version || '';
const SAVE_KEY = 'glue-gunner-v1';

// ---------- renderer, sky, light ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.92;
renderer.setClearColor(0x2a1430, 1);
renderer.xr.enabled = true; renderer.xr.setReferenceSpaceType('local-floor'); renderer.xr.setFoveation(0.5);
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 2400);
const rig = new THREE.Group(); rig.add(camera); scene.add(rig);
scene.fog = new THREE.Fog(0x2a1628, 60, 380);
// dusk: a low orange sun, a cold purple sky light, and the sky's own light bouncing about
scene.add(new THREE.HemisphereLight(0x6a5aa8, 0x2a1810, 0.55));
const sun = new THREE.DirectionalLight(0xffb070, 3.4);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04;
Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 1, far: 220 });
scene.add(sun, sun.target);
// a cool rim light from the far side, so the aliens' wet skin catches an edge against the dark
const rim = new THREE.DirectionalLight(0x7a8aff, 1.8); rim.position.copy(SUN_DIR).multiplyScalar(-100).setY(40); scene.add(rim);

// ---------- the world, aliens, glue ----------
const world = new World(scene);
{
  // the sky's light on everything (and what metal and wet skin reflect): made once from the sky alone
  const pm = new THREE.PMREMGenerator(renderer), envScene = new THREE.Scene();
  envScene.add(world.sky.clone()); envScene.add(new THREE.HemisphereLight(0xffffff, 0x000000, 0));
  const e = pm.fromScene(envScene, 0.02, 0.1, 1000);
  scene.environment = e.texture; scene.environmentIntensity = 0.55;
  pm.dispose();
}
alienKit();
const fx = new Effects(scene);
const glue = new Glue(scene);
const panel = new ScreenPanel();
const vrPanel = new VRPanel();
scene.add(vrPanel.mesh); vrPanel.mesh.visible = false;

// ---------- saving ----------
const DEFAULTS = { v: 1, wave: 1, score: 0, best: 0, bestWave: 1, turn: 'snap', welcomed: false, kills: 0, tears: 0 };
let save = { ...DEFAULTS };
function upgrade(s){ return { ...DEFAULTS, ...s, v: 1 }; }
function load(){ try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (s) save = upgrade(s); return !!s; } catch (e) { return false; } }
function store(){ try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* private browsing */ } }
const hadSave = load();

// ---------- you ----------
const EYE = 1.65, WALK = 4.2, RUN = 6.6, MAXHP = 100;
const player = { pos: V(START.x, 0, START.z), yaw: START.yaw, pitch: -0.05, hp: MAXHP, hurtT: 9, flash: 0, shake: 0, dead: false };
function standAt(s){
  player.pos.set(s.x, 0, s.z); player.yaw = s.yaw ?? player.yaw; player.pitch = -0.05;
  if (mode === 'vr') vrPlace(player.pos, player.yaw);
}
const stuck = { t: 0, slip: 0 };
function bump(p){
  // aliens push you out of the way first, then the crates and the lip (so nothing pins you against a wall);
  // pushing without getting anywhere for half a second lets you slip past them
  if (stuck.slip <= 0) for (const a of aliens){
    if (a.dead || !a.grounded || a.climb) continue;
    const r = 0.35 + 0.35 * a.s, dx = p.x - a.root.position.x, dz = p.z - a.root.position.z, d2 = dx * dx + dz * dz;
    if (d2 < r * r && d2 > 1e-6){ const d = Math.sqrt(d2); p.x = a.root.position.x + dx / d * r; p.z = a.root.position.z + dz / d * r; }
  }
  world.collideGround(p, 0.3);
}
function moveAndBump(p, dx, dz, dt){
  const x0 = p.x, z0 = p.z;
  p.x += dx; p.z += dz; bump(p);
  const want = Math.hypot(dx, dz), got = Math.hypot(p.x - x0, p.z - z0);
  stuck.slip -= dt;
  if (want > 1e-4 && got < want * 0.3){ stuck.t += dt; if (stuck.t > 0.5){ stuck.slip = 0.8; stuck.t = 0; } } else stuck.t = 0;
}
function walk(dt, mx, my, run){
  const l = Math.hypot(mx, my); if (l > 1){ mx /= l; my /= l; }
  if (l < 0.05) return;
  const sp = (run || l > 0.95 ? RUN : WALK) * dt;
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  moveAndBump(player.pos, fx * -my * sp + -fz * mx * sp, fz * -my * sp + fx * mx * sp, dt);
}
function hurt(dmg, from){
  if (player.dead || mode === 'title' || lvl.over) return;
  player.hp = Math.max(0, player.hp - dmg); player.hurtT = 0; player.flash = 1; player.shake = 0.35;
  sfx.hurt(); haptic(0, 1, 160); haptic(1, 1, 160);
  if (from){ const a = Math.atan2(from.x - headPos.x, from.z - headPos.z); hurtDir = a; }
  if (player.hp <= 0){ player.dead = true; gameOver(); }
}
let hurtDir = null;

// ---------- the aliens and the pieces torn off them ----------
const aliens = [], debris = [];
const MAX_DEBRIS = 44, MAX_CORPSES = 14;
let lvl = { n: 1, total: 0, spawned: 0, queue: 0, spawnT: 0, kills: 0, t: 0, done: false, doneT: 0, over: false };
function aliveCount(){ return aliens.filter((a) => !a.dead).length + lvl.queue; }
function addAlien(opts){ const a = new Alien(scene, opts); aliens.push(a); return a; }
function removeAlien(a){ glue.dropOwner(a); a.dispose(); aliens.splice(aliens.indexOf(a), 1); }
function removeDebris(d){ glue.dropOwner(d); d.dispose(); debris.splice(debris.indexOf(d), 1); }
function clearAll(){
  while (aliens.length) removeAlien(aliens[0]);
  while (debris.length) removeDebris(debris[0]);
  glue.cutAll(); fx.clearSplats();
}
const waveSize = (n) => (n === 1 ? 10 : Math.min(16, 8 + 2 * n));
// a new wave: the first is already prowling the deck; later ones climb up over the edges
function startWave(n, fresh){
  if (fresh) clearAll();
  lvl = { n, total: waveSize(n), spawned: 0, queue: 0, spawnT: 1, kills: 0, t: 0, done: false, doneT: 0, over: false };
  if (n === 1 || fresh){
    // already on the deck, prowling, scattered away from you
    for (let i = 0; i < lvl.total; i++){
      let x, z, k = 0;
      do { x = -18 + Math.random() * 70; z = -21 + Math.random() * 42; k++; } while (k < 40 && (Math.hypot(x - player.pos.x, z - player.pos.z) < 22 || aliens.some((a) => Math.hypot(a.root.position.x - x, a.root.position.z - z) < 4)));
      const p = V(x, 0, z); world.collideGround(p, 0.5);
      const a = addAlien({ notice: 3 + i * 0.9 + Math.random() * 3 });
      a.place(p.x, p.z, Math.random() * 6.28);
    }
    lvl.spawned = lvl.total;
  } else {
    lvl.queue = lvl.total;
  }
  updateHUD(true);
}
function spawnClimber(){
  // somewhere along the edge, out of your face
  let x, z, k = 0;
  do {
    const side = Math.random();
    if (side < 0.7){ x = -HX + 6 + Math.random() * (HX * 2 - 12); z = Math.random() < 0.5 ? -HZ : HZ; }
    else { z = -HZ + 5 + Math.random() * (HZ * 2 - 10); x = Math.random() < 0.5 ? -HX : HX; }
    k++;
  } while (k < 30 && Math.hypot(x - player.pos.x, z - player.pos.z) < 14);
  const inward = V(-Math.sign(Math.abs(x) >= HX ? x : 0), 0, -Math.sign(Math.abs(z) >= HZ ? z : 0)).normalize();
  const a = addAlien({ notice: 0 });
  a.yaw = Math.atan2(inward.x, inward.z);
  a.place(x - inward.x * 0.7, z - inward.z * 0.7, a.yaw);
  a.climb = { from: V(x - inward.x * 0.7, -2.4, z - inward.z * 0.7), to: V(x + inward.x * 1.6, 0, z + inward.z * 1.6), t: 0, dur: 1.7 };
  a.state = 'hunt';
  lvl.queue--; lvl.spawned++;
}
// who may charge you right now (the rest circle, waiting their turn)
const attackers = new Set();
let pickT = 0;
function chooseAttackers(){
  attackers.clear();
  const n = Math.min(2 + Math.floor(lvl.n / 2), 5);
  const list = aliens.filter((a) => !a.dead && a.state !== 'prowl' && a.state !== 'notice' && !a.climb)
    .sort((a, b) => a.root.position.distanceToSquared(player.pos) - b.root.position.distanceToSquared(player.pos));
  for (let i = 0; i < Math.min(n, list.length); i++) attackers.add(list[i].id);
}
// make room: the oldest pieces and corpses lying far from you are cleared away
function tidy(){
  const far = (o) => o.com.distanceTo(player.pos) > 14;
  const held = (o) => glue.strings.some((s) => s.a.owner === o || s.b.owner === o) || (glue.pending && glue.pending.end.owner === o);
  while (debris.length > MAX_DEBRIS){ const d = debris.find((d) => far(d) && !held(d)) || debris.find((d) => !held(d)) || debris[0]; removeDebris(d); }
  const dead = aliens.filter((a) => a.dead);
  if (dead.length > MAX_CORPSES){ const a = dead.find((a) => far(a) && !held(a)) || dead[0]; removeAlien(a); }
}

// ---------- shooting ----------
// the nearest thing along a ray: an alien's part, a torn-off piece, a block, or the deck and the things on it
function pick(o, d, far = 90){
  let best = null;
  const w = world.ray(o, d, far);
  if (w) best = { t: w.t, point: w.point, block: w.block, kind: w.kind };
  for (const a of aliens){
    if (a.root.position.distanceTo(o) > far + 3) continue;
    const h = a.ray(o, d, best ? best.t : far);
    if (h && (!best || h.t < best.t)) best = { t: h.t, point: h.point, alien: a, bone: h.bone, name: h.name, kind: 'alien' };
  }
  for (const b of debris){
    const h = b.ray(o, d, best ? best.t : far);
    if (h && (!best || h.t < best.t)) best = { t: h.t, point: h.point, debris: b, bone: h.bone, name: h.name, kind: 'debris' };
  }
  return best;
}
let cool = 0;
const muzzles = {};
function muzzleOf(gun, out){ const g = gunObj(gun); return g ? g.userData.muzzle.getWorldPosition(out) : out.copy(headPos); }
function gunObj(id){ return id === 'screen' ? gunScreen : id === 'L' ? gunL : gunR; }
function shoot(o, d, gunId){
  if (cool > 0 || mode === 'title' || player.dead || lvl.over) return null;
  if (glue.flying.length) return null;
  startAudio();
  const g = gunObj(gunId);
  g.updateMatrixWorld(true);
  const hit = pick(o, d);
  const from = g.userData.muzzle.getWorldPosition(V());
  const dir = hit ? hit.point.clone().sub(from).normalize() : d.clone();
  if (!glue.fire(from, dir, hit, gunId)) return null;
  cool = 0.2; sfx.shoot(); g.userData.kick = 1;
  fx.spray(from, dir, 4, 3, 0.25, 1, 0.6);
  haptic(gunId === 'L' ? 0 : 1, 0.6, 50);
  hints.shots++;
  return hit;
}
const raycaster = new THREE.Raycaster();
function shootScreen(x, y){
  camera.updateMatrixWorld(true);
  raycaster.setFromCamera(new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1), camera);
  return shoot(raycaster.ray.origin.clone(), raycaster.ray.direction.clone(), 'screen');
}
function cut(){
  const n = glue.cutAll();
  if (n){ sfx.snap(); say(`✂ Cut ${n} string${n > 1 ? 's' : ''}.`); }
  else say('No strings to cut.');
}

// ---------- the guns ----------
const gunScreen = makeGun();
gunScreen.position.set(0.19, -0.19, -0.48); gunScreen.rotation.set(0.05, 0.2, 0.06);
gunScreen.visible = false; camera.add(gunScreen);
const gunL = makeGun(true), gunR = makeGun();
gunL.visible = gunR.visible = false; scene.add(gunL, gunR);
// where each VR gun is pointing: a little dot on whatever it would hit
const dotMat = new THREE.SpriteMaterial({ map: (() => { const t = textCanvas(64, 64); const g = t.ctx; g.fillStyle = '#ffd23a'; g.beginPath(); g.arc(32, 32, 14, 0, 7); g.fill(); g.strokeStyle = '#000'; g.lineWidth = 4; g.stroke(); t.tex.needsUpdate = true; return t.tex; })(), depthTest: false, transparent: true, toneMapped: false });
const dots = [new THREE.Sprite(dotMat), new THREE.Sprite(dotMat)];
for (const s of dots){ s.visible = false; s.renderOrder = 20; s.scale.setScalar(0.06); scene.add(s); }
const laser = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 1, 6).translate(0, 0.5, 0).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffd23a', transparent: true, opacity: 0.7 }));
laser.visible = false; scene.add(laser);
// a message board above the left gun (VR players can't see the HTML messages)
const board = textCanvas(512, 120);
const boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.063), new THREE.MeshBasicMaterial({ map: board.tex, transparent: true, toneMapped: false }));
boardMesh.position.set(0, 0.18, 0.02); boardMesh.rotation.x = -0.6; boardMesh.visible = false; gunL.add(boardMesh);
// a red glow round your head when you're hit (VR)
const hurtShell = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12), new THREE.MeshBasicMaterial({ color: '#c00010', transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, toneMapped: false }));
hurtShell.renderOrder = 30; hurtShell.visible = false; camera.add(hurtShell);
function updateGun(g, dt){
  const U = g.userData;
  U.kick = Math.max(0, U.kick - dt * 7);
  setGunState(g, !!glue.pending, gameTime);
  return U.kick;
}

// ---------- messages ----------
const msgs = [];
function say(text, kind = ''){
  if (msgs.some((m) => m.text === text)) return;
  msgs.push({ text, kind, t: 4.5 });
  while (msgs.length > 3) msgs.shift();
  drawMsgs(); drawBoard();
}
function drawMsgs(){
  const box = $('h-msg'); box.innerHTML = '';
  for (const m of msgs){ const d = document.createElement('div'); d.className = 'msg ' + m.kind; d.textContent = m.text; box.appendChild(d); }
}
function drawBoard(){
  const m = msgs[msgs.length - 1], g = board.ctx;
  g.clearRect(0, 0, 512, 120);
  boardMesh.visible = !!m && mode === 'vr';
  if (!m) return;
  g.fillStyle = m.kind === 'bad' ? 'rgba(170,20,30,0.92)' : m.kind === 'good' ? 'rgba(60,110,10,0.92)' : 'rgba(20,14,24,0.92)';
  roundRect(g, 2, 2, 508, 116, 22); g.fill();
  g.fillStyle = '#fff'; g.font = 'bold 30px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const lines = wrapText(g, m.text, 480).slice(0, 3);
  lines.forEach((l, i) => g.fillText(l, 256, 60 + (i - (lines.length - 1) / 2) * 34));
  board.tex.needsUpdate = true;
}
// the hint along the bottom: what your next shot does
const hints = { shots: 0 };
function hintText(){
  if (mode === 'title') return '';
  const pro = save.tears >= 4;
  if (glue.flying.length) return '';
  if (glue.pending) return pro ? 'Shot 2: stick the other end' : 'Shot 2 ▶ now stick the OTHER end to a floating block (or another alien). The glue shrinks and pulls!';
  return pro ? '' : 'Shot 1 ▶ shoot an alien to stick a glue string to it';
}

// ---------- events from the aliens, the glue and the pieces ----------
function panOf(p){ const a = Math.atan2(p.x - headPos.x, p.z - headPos.z); return clamp(Math.sin(angleDiff(player.yaw + Math.PI, a)) * -1, -1, 1); }
function handleEvents(){
  for (const e of glue.events){
    if (e[0] === 'stick'){
      const p = e[2], near = p.distanceTo(headPos) < 30;
      sfx.splat(!near); fx.spray(p, V(0, 1, 0), 10, 2.5, 0.8, 1, 0.8);
      const f = e[1];
      if (f.end.kind === 'alien'){ const a = f.end.owner; if (!a.dead){ a.scream = Math.max(a.scream, 0.6); if (a.state === 'prowl'){ a.state = 'notice'; a.stateT = 0; } sfx.shriek(panOf(a.com)); } }
      if (!f.second && f.end.kind === 'alien' && save.tears < 4) say('Stuck! Now shoot again to stick the other end to a floating block above it.');
    }
    if (e[0] === 'tie'){ sfx.tie(); haptic(1, 0.4, 40); }
    if (e[0] === 'miss'){ sfx.miss(); if (!e[1].second && save.tears < 4) say('Missed: the glue needs something to stick to.'); }
    if (e[0] === 'snap'){ /* the string lets go */ }
    if (e[0] === 'tear'){
      const [, alien, deb, name] = e;
      const p = deb.group.position.clone();
      sfx.tear(panOf(p)); haptic(0, 0.8, 120); haptic(1, 0.8, 120);
      // a burst of ichor from both torn ends
      fx.spray(p, deb.vel.clone().normalize(), 46, 5, 0.7, 0, 1.2);
      fx.spray(p, V(0, 1, 0), 26, 3, 1, 0, 1);
      save.tears++; hints.tears = (hints.tears || 0) + 1;
      const big = deb.name === 'spine';
      if (!alien.dead || big || deb.name === 'head'){
        const what = big ? 'Torn in HALF!' : `Ripped off its ${partName(deb.name)}!`;
        say(`${what} +25`, 'good');
      }
      save.score += 25; store();
    }
  }
  for (const a of aliens){
    for (const [type, data] of a.events){
      if (type === 'shriek'){ if (a.com.distanceTo(headPos) < 40) sfx.shriek(panOf(a.com), a.scream > 1); }
      else if (type === 'hiss'){ if (a.com.distanceTo(headPos) < 20) sfx.hiss(panOf(a.com)); }
      else if (type === 'swipe') sfx.swipe(panOf(a.com));
      else if (type === 'hit') hurt(data.dmg, data.from);
      else if (type === 'thud' || type === 'land'){ if (a.com.distanceTo(headPos) < 30) sfx.thud(type === 'land' ? 1 : 0.6); fx.spray(a.com.clone().setY(0.2), V(0, 1, 0), 8, 2, 1, 0, 0.8); }
      else if (type === 'die'){
        lvl.kills++; save.kills++; save.score += 100; sfx.kill();
        const left = aliveCount();
        say(left ? `Kill! +100 · ${left} alien${left > 1 ? 's' : ''} left` : 'That was the last one!', 'good');
        store();
      }
      else if (type === 'void'){ save.score += 150; say('Into the abyss! +150', 'good'); }
      else if (type === 'tear'){ if (!debris.includes(data.debris)){ debris.push(data.debris); tidy(); } }
    }
    a.events.length = 0;
  }
}

// ---------- panels: one description, drawn as HTML on screen or as a floating board in VR ----------
let vrPage = null;
function showPanel(spec){ if (mode === 'vr'){ vrPage = spec; vrs.placePanel = true; vrPanel.show(spec); vrPanel.mesh.visible = vrs.posed; } else panel.show(spec); }
function closePanels(){ panel.close(); vrPage = null; vrPanel.mesh.visible = false; laser.visible = false; }
const paused = () => (mode === 'screen' && !!panel.open) || (mode === 'vr' && !!vrPage);
function howTo(){
  const common = [
    'Shot 1 sticks one end of a glue string to whatever it hits. Shot 2 sticks the other end.',
    'Then the glue sets and the string SHRINKS. Glue an alien to a floating block: it gets hauled into the air until its arm, leg, head or tail rips off.',
    'Glue two aliens together, an alien to the deck, or to a block past the edge to fling it into the sky.',
    'Rip off a head, tear one in half, or three limbs, and it dies. Don\'t let them reach you: they slash.',
  ];
  if (mode === 'vr') return [...common, 'A glue gun in each hand: pull either trigger. Grip cuts every string. Left stick walks, right stick turns, X/Y menu.'];
  return [...common, 'Walk with your left thumb (or WASD). Drag to look. Tap something (or the GLUE button, or Space) to shoot. ✂ (or C) cuts every string.'];
}
function welcome(){
  save.welcomed = true; store();
  showPanel({ title: '🧪 Glue Gunner', sections: [
    { text: 'You\'re on a landing deck floating in the sky. Ten aliens are on it with you. You have a glue gun.' },
    { heading: 'How to rip them apart', list: howTo() },
    { buttons: [{ label: 'Let\'s go!', kind: 'primary', go: () => { closePanels(); sfx.click(); } }] },
  ] });
}
function menu(){
  showPanel({ title: '☰ Menu', money: 'v' + VERSION, sections: [
    { text: `Wave ${lvl.n} · ${aliveCount()} aliens left · ❤ ${Math.ceil(player.hp)} · ⭐ ${save.score} (best ${save.best})` },
    { buttons: [{ label: '▶ Keep going', kind: 'primary', go: closePanels }, { label: '❓ How to play', go: () => showPanel({ title: '❓ How to play', sections: [{ list: howTo() }, { buttons: [{ label: 'OK', kind: 'primary', go: closePanels }] }] }) }] },
    ...(mode === 'vr' ? [{ heading: 'Turning', buttons: [{ label: 'Snap turn', on: save.turn === 'snap', go: () => { save.turn = 'snap'; store(); menu(); } }, { label: 'Smooth turn', on: save.turn === 'smooth', go: () => { save.turn = 'smooth'; store(); menu(); } }] }] : []),
    { buttons: [{ label: '✂ Cut all strings', go: () => { closePanels(); cut(); } }, { label: '🔄 Restart wave', go: () => { closePanels(); restartWave(); } }, { label: '🏠 Title', kind: 'danger', go: () => { closePanels(); toTitle(); } }] },
  ] });
}
function restartWave(){
  player.hp = MAXHP; player.dead = false; player.hurtT = 9;
  standAt(START);
  startWave(lvl.n, true);
  say(`Wave ${lvl.n}: ${lvl.total} aliens. Good luck.`);
}
function gameOver(){
  lvl.over = true; sfx.dead(); store();
  save.best = Math.max(save.best, save.score); save.bestWave = Math.max(save.bestWave, lvl.n); store();
  setTimeout(() => showPanel({ title: '💀 Torn apart', money: '⭐ ' + save.score, sections: [
    { text: `They got you on wave ${lvl.n}. You killed ${lvl.kills} of ${lvl.total} this wave.` },
    { list: [`🏆 Best score: ${save.best}`, `🌊 Best wave: ${save.bestWave}`, 'Keep moving: stick them to blocks before they get close.'] },
    { buttons: [{ label: '🔄 Try this wave again', kind: 'primary', go: () => { closePanels(); save.score = Math.max(0, save.score - 100); restartWave(); } }, { label: '🏠 Title', kind: 'danger', go: () => { closePanels(); toTitle(); } }] },
  ] }), 1400);
}
function wavePanel(){
  sfx.win();
  const bonus = 150 * lvl.n;
  save.score += bonus; save.best = Math.max(save.best, save.score); save.wave = lvl.n + 1; save.bestWave = Math.max(save.bestWave, lvl.n + 1); store();
  const mm = Math.floor(lvl.t / 60), ss = Math.floor(lvl.t % 60);
  showPanel({ title: `🎉 Wave ${lvl.n} cleared!`, money: '⭐ ' + save.score, sections: [
    { text: `All ${lvl.total} aliens dead in ${mm}:${String(ss).padStart(2, '0')}. Wave bonus +${bonus}.` },
    { text: `Wave ${lvl.n + 1}: ${waveSize(lvl.n + 1)} more are climbing up over the edges. You get some health back.` },
    { buttons: [{ label: `Wave ${lvl.n + 1} ▶`, kind: 'primary', go: nextWave }] },
  ] });
}
function nextWave(){
  closePanels(); sfx.wave();
  player.hp = Math.min(MAXHP, player.hp + 50);
  startWave(lvl.n + 1, false);
  say(`Wave ${lvl.n}: ${lvl.total} aliens are climbing onto the deck!`, 'bad');
}
function checkWave(dt){
  if (mode === 'title' || lvl.over) return;
  lvl.t += dt;
  if (lvl.queue > 0){ lvl.spawnT -= dt; if (lvl.spawnT <= 0){ lvl.spawnT = 0.8 + Math.random() * 1.4; spawnClimber(); } }
  if (!lvl.done && lvl.queue === 0 && aliens.length && aliens.every((a) => a.dead)){ lvl.done = true; lvl.doneT = 2.5; }
  if (lvl.done && lvl.doneT > 0){ lvl.doneT -= dt; if (lvl.doneT <= 0) wavePanel(); }
}

// ---------- screen input: a thumb stick, drag to look, tap to shoot ----------
const touch = { stickId: null, stick: null, look: new Map() };
const keys = {};
const stick = { x: 0, y: 0 };
const stickEl = $('stick'), knobEl = $('knob');
function stickZone(x, y){ return x < innerWidth * 0.42 && y > innerHeight * 0.4; }
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (mode !== 'screen') return;
  startAudio();
  try { renderer.domElement.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
  // a new touch in the stick zone always takes the stick over (even if an old one never ended)
  if (e.pointerType !== 'mouse' && stickZone(e.clientX, e.clientY)){
    touch.stickId = e.pointerId; touch.stick = { x0: e.clientX, y0: e.clientY }; stick.x = stick.y = 0;
    stickEl.style.left = (e.clientX - 60) + 'px'; stickEl.style.top = (e.clientY - 60) + 'px'; stickEl.classList.add('on'); knobEl.style.transform = '';
    return;
  }
  touch.look.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 });
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (mode !== 'screen') return;
  if (e.pointerId === touch.stickId){
    const dx = e.clientX - touch.stick.x0, dy = e.clientY - touch.stick.y0, d = Math.hypot(dx, dy), m = Math.min(d, 55) / (d || 1);
    stick.x = dx * m / 55; stick.y = dy * m / 55;
    knobEl.style.transform = `translate(${dx * m}px, ${dy * m}px)`;
    return;
  }
  const L = touch.look.get(e.pointerId); if (!L) return;
  const dx = e.clientX - L.x, dy = e.clientY - L.y; L.x = e.clientX; L.y = e.clientY; L.moved += Math.hypot(dx, dy);
  const k = e.pointerType === 'mouse' ? 0.004 : 0.0055;
  player.yaw -= dx * k; player.pitch = clamp(player.pitch - dy * k, -1.3, 1.3);
});
function releaseStick(){ touch.stickId = null; touch.stick = null; stick.x = stick.y = 0; stickEl.classList.remove('on'); knobEl.style.transform = ''; }
renderer.domElement.addEventListener('pointerup', (e) => {
  if (e.pointerId === touch.stickId){ releaseStick(); return; }
  const L = touch.look.get(e.pointerId); if (!L) return;
  touch.look.delete(e.pointerId);
  if (mode === 'screen' && L.moved < 12 && performance.now() - L.t < 450 && !panel.open) shootScreen(e.clientX, e.clientY);
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
  if (e.code === 'Space' || e.code === 'Enter'){ e.preventDefault(); shootScreen(innerWidth / 2, innerHeight / 2); }
  if (e.code === 'KeyC' || e.code === 'KeyR'){ cut(); }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
const press = (id, fn) => $(id).addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); startAudio(); fn(); });
press('b-fire', () => shootScreen(innerWidth / 2, innerHeight / 2));
press('b-cut', () => cut());
press('b-menu', () => { sfx.click(); menu(); });

// ---------- the screen camera ----------
const orbit = { a: 0 };
const _eu = new THREE.Euler();
function placeScreenCamera(dt){
  rig.position.set(0, 0, 0); rig.quaternion.identity();
  if (mode === 'title'){
    const a = orbit.a;
    camera.position.set(Math.sin(a) * 30 - 8, 6.5, Math.cos(a) * 18);
    camera.lookAt(6, 1.2, 0);
  } else {
    const sh = player.shake * player.shake;
    camera.position.set(player.pos.x + (Math.random() - 0.5) * sh * 0.3, EYE + (Math.random() - 0.5) * sh * 0.3 - (player.dead ? 1.2 : 0), player.pos.z);
    camera.quaternion.setFromEuler(_eu.set(player.pitch, player.yaw, player.dead ? 0.5 : 0, 'YXZ'));
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
const headPos = V(), headQuat = new THREE.Quaternion(), v1 = V();
const vrs = { posed: false, frames: 0, snapReady: true, pending: null, placePanel: false, aimT: 0 };
function haptic(hand, v, ms){ if (mode === 'vr') vr[hand].haptic(v, ms); }
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
  // a glue gun in each hand, aimed along the controllers' pointing rays
  for (const [h, g] of [[L, gunL], [R, gunR]]){
    g.visible = h.tracked;
    if (!h.tracked) continue;
    g.position.copy(V(0, -0.01, 0.07).applyQuaternion(h.rayQuat)).add(h.rayPos);
    g.quaternion.copy(h.rayQuat);
    const k = updateGun(g, dt); g.position.addScaledVector(V(0, 0, 1).applyQuaternion(h.rayQuat), k * 0.03);
  }
  // the menu board floats in front of you; it comes back if you turn away from it
  laser.visible = false;
  let onPanel = false;
  if (vrPage){
    const fwd = V(0, 0, -1).applyQuaternion(headQuat); fwd.y = 0; fwd.normalize();
    const to = v1.copy(vrPanel.mesh.position).sub(headPos); to.y = 0; to.normalize();
    if (vrs.placePanel || fwd.dot(to) < 0.5){
      vrs.placePanel = false;
      vrPanel.mesh.position.copy(headPos).addScaledVector(fwd, 1.25); vrPanel.mesh.position.y = headPos.y - 0.1;
      vrPanel.mesh.lookAt(headPos.x, headPos.y - 0.1, headPos.z);
    }
    vrPanel.mesh.visible = true;
    for (const h of [R, L]){
      if (!h.tracked || onPanel) continue;
      const dir = FWD.clone().applyQuaternion(h.rayQuat);
      vrPanel.mesh.updateMatrixWorld(true);
      const hit = vrPanel.ray(h.rayPos, dir, h.triggerDown, 4);
      if (hit){
        onPanel = true; laser.visible = true;
        laser.position.copy(h.rayPos); laser.lookAt(hit.point); laser.scale.set(1, 1, h.rayPos.distanceTo(hit.point));
        if (hit.clicked){ h.haptic(0.3, 30); sfx.click(); if (vrPage) vrPanel.show(vrPage); }
        if (Math.abs(h.stick.y) > 0.3) vrPanel.scrollBy(h.stick.y * dt * 900);
      }
    }
    if (R.bDown || L.bDown){ closePanels(); return; }
  } else if (L.aDown || L.bDown){ menu(); return; }
  if (!vrPage){
    for (const [h, id] of [[L, 'L'], [R, 'R']]) if (h.triggerDown && h.tracked) shoot(h.rayPos.clone(), FWD.clone().applyQuaternion(h.rayQuat), id);
    if (L.gripDown || R.gripDown) cut();
    if (R.aDown) cut();
  }
  // aiming dots (20 times a second)
  vrs.aimT -= dt;
  if (vrs.aimT <= 0){
    vrs.aimT = 0.05;
    [L, R].forEach((h, i) => {
      if (!h.tracked || vrPage){ dots[i].visible = false; return; }
      const hit = pick(h.rayPos, FWD.clone().applyQuaternion(h.rayQuat), 60);
      dots[i].visible = !!hit;
      if (hit){ dots[i].position.copy(hit.point); dots[i].scale.setScalar(0.03 + hit.t * 0.012); dots[i].material.color.set(hit.alien || hit.debris ? '#ff6a4a' : hit.block ? '#6af0ff' : '#ffffff'); }
    });
  }
  // turning: snap or smooth (a setting)
  const sx = onPanel ? 0 : R.stick.x;
  if (save.turn === 'smooth'){ if (Math.abs(sx) > 0.2) turnRig(-sx * dt * 2.2); }
  else {
    if (Math.abs(sx) > 0.7 && vrs.snapReady){ turnRig(-Math.sign(sx) * Math.PI / 6); vrs.snapReady = false; }
    if (Math.abs(sx) < 0.35) vrs.snapReady = true;
  }
  // walking where you look; the lip and crates stop you (and your real head), aliens push you aside
  let mx = L.stick.x, my = L.stick.y; if (Math.hypot(mx, my) < 0.15 || onPanel){ mx = 0; my = 0; }
  const want = V(headPos.x, 0, headPos.z);
  let dx = 0, dz = 0;
  if ((mx || my) && !player.dead){
    const f = V(0, 0, -1).applyQuaternion(headQuat); f.y = 0; f.normalize();
    const sp = (Math.hypot(mx, my) > 0.95 ? RUN * 0.8 : WALK * 0.8) * dt;
    dx = f.x * -my * sp - f.z * mx * sp; dz = f.z * -my * sp + f.x * mx * sp;
  }
  moveAndBump(want, dx, dz, dt);
  rig.position.x += want.x - headPos.x; rig.position.z += want.z - headPos.z;
  rig.position.y = 0;
  player.pos.set(want.x, 0, want.z);
  player.yaw = new THREE.Euler().setFromQuaternion(headQuat, 'YXZ').y;
  // the screen on the left gun
  drawGunScreen(gunL, [`HP ${Math.ceil(player.hp)}   WAVE ${lvl.n}`, `${aliveCount()} aliens left   ${save.score} pts`, glue.pending ? 'NEXT: 2nd end' : 'NEXT: 1st end', `v${VERSION}`]);
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
let mode = 'title', gameTime = 0, hudT = 0, saveT = 0, creakT = 0;
const actx = { dt: 0, player: player.pos, playerHead: headPos, aliens, world, attackers, wave: 1 };
function frame(){ try { step(); } catch (e) { console.error(e); } }
function step(){
  const dt = Math.min(clock.getDelta(), 1 / 20);
  const T = window.__gg, steps = T && T.timeScale > 1 ? Math.round(T.timeScale) : 1;
  if (T && T.paused && mode !== 'vr') return;   // (the test runs the game itself, with advance())
  for (let k = 0; k < steps; k++) simulate(dt);
  if (T && T.noRender && mode !== 'vr') return;     // (a headset only sends its next frame once this one is drawn)
  renderer.render(scene, camera);
}
function simulate(dt){
  gameTime += dt;
  if (mode === 'vr'){
    rig.updateMatrixWorld(true);
    renderer.xr.getCamera().matrixWorld.decompose(headPos, headQuat, v1);
    // wait for the headset's first real frames before placing you or anything in front of you
    if (!vrs.posed){ vrs.frames = renderer.xr.isPresenting ? vrs.frames + 1 : 0; }
    if (!vrs.posed && vrs.frames >= 3){
      vrs.posed = true;
      if (vrs.pending){ const q = vrs.pending; vrs.pending = null; vrPlace(q.p, q.yaw); rig.updateMatrixWorld(true); renderer.xr.getCamera().matrixWorld.decompose(headPos, headQuat, v1); }
      if (vrPage){ vrs.placePanel = true; vrPanel.mesh.visible = true; }
    }
    if (vrs.posed) vrUpdate(dt);
  } else {
    if (mode === 'title') orbit.a += dt * 0.04;
    if (mode === 'screen' && !panel.open && !player.dead){
      const k = (c) => (keys[c] ? 1 : 0);
      walk(dt, stick.x + k('KeyD') - k('KeyA'), stick.y + k('KeyS') - k('KeyW'), keys.ShiftLeft || keys.ShiftRight);
      player.yaw += (k('ArrowLeft') - k('ArrowRight')) * dt * 2;
      player.pitch = clamp(player.pitch + (k('ArrowUp') - k('ArrowDown')) * dt * 1.5, -1.3, 1.3);
    }
    placeScreenCamera(dt);
    headPos.copy(camera.position);
    gunScreen.visible = mode === 'screen' && !player.dead;
    if (mode === 'screen'){ const k = updateGun(gunScreen, dt); gunScreen.position.z = -0.5 + k * 0.06; gunScreen.rotation.x = 0.05 + k * 0.3; }
  }
  const frozen = paused();
  if (frozen){ hudT -= dt; if (hudT <= 0){ hudT = 0.25; updateHUD(); } return; }
  cool -= dt;
  player.hurtT += dt; player.flash = Math.max(0, player.flash - dt * 1.6); player.shake = Math.max(0, player.shake - dt);
  if (player.hurtT > 5 && !player.dead && player.hp < MAXHP) player.hp = Math.min(MAXHP, player.hp + dt * 4);
  setHealthForAudio(mode === 'title' ? 1 : player.hp / MAXHP);
  world.update(gameTime);
  // the glue pulls on everything it holds, then everything moves
  for (const a of aliens){ a.pull.set(0, 0, 0); a.stuckBones.length = 0; }
  for (const d of debris){ d.pull.set(0, 0, 0); d.stuck = null; d.stuckT = 0; }
  glue.step(dt, muzzleOf);
  pickT -= dt; if (pickT <= 0){ pickT = 0.5; chooseAttackers(); }
  actx.dt = dt; actx.wave = lvl.n; actx.calm = mode === 'title';
  const target = mode === 'title' ? V(999, 0, 999) : player.pos;
  actx.player = target; actx.playerHead = mode === 'title' ? target : headPos;
  let near = 0;
  for (const a of aliens){
    a.update(actx);
    if (!a.dead && a.com.distanceTo(headPos) < 25) near++;
    if (a.bleed && Math.random() < 0.6){ const p = a.bleed.at.clone().applyMatrix4(a.bleed.bone.matrixWorld), d = a.bleed.dir.clone().transformDirection(a.bleed.bone.matrixWorld); fx.spray(p, d, 1, 2.2, 0.3, 0, 0.8); }
  }
  sfx.aliensNear = near;
  for (let i = debris.length - 1; i >= 0; i--){
    const d = debris[i];
    d.update(dt, world);
    if (d.bleed > 0 && Math.random() < 0.5){ const p = d.group.position.clone(); fx.spray(p, V(0, -0.3, 0).sub(d.vel.clone().multiplyScalar(0.1)), 1, 1.5, 0.6, 0, 0.7); }
    for (const [t, v] of d.events) if (t === 'thud' && d.com.distanceTo(headPos) < 20) sfx.thud(Math.min(1, v / 8) * 0.6);
    if (d.gone) removeDebris(d);
  }
  // strings creak when they're straining
  creakT -= dt;
  if (creakT <= 0){ const T = glue.strings.reduce((m, s) => Math.max(m, s.T), 0); if (T > 700){ sfx.creak(Math.min(1, T / 2500)); creakT = 0.2 + Math.random() * 0.2; } else creakT = 0.15; }
  handleEvents();
  fx.update(dt, world);
  glue.draw(muzzleOf, gameTime);
  checkWave(dt);
  // the sun's shadows follow you
  const focus = mode === 'title' ? V(4, 0, 0) : player.pos;
  sun.target.position.set(Math.round(focus.x), 0, Math.round(focus.z));
  sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 110);
  world.sky.position.copy(headPos);
  world.planet.position.copy(world.planetDir).multiplyScalar(820).add(headPos);
  for (const m of msgs) m.t -= dt;
  if (msgs.length && msgs[0].t <= 0){ while (msgs.length && msgs[0].t <= 0) msgs.shift(); drawMsgs(); drawBoard(); }
  // hurt: red at the edges of the screen, or round your head in VR
  const red = Math.max(player.flash * 0.85, (1 - player.hp / MAXHP) * 0.5);
  if (mode === 'vr'){ hurtShell.visible = player.flash > 0.01; hurtShell.material.opacity = player.flash * 0.45; }
  else if (hudLast.red !== red.toFixed(2)){ hudLast.red = red.toFixed(2); $('hurt').style.opacity = red.toFixed(2); }
  hudT -= dt; if (hudT <= 0){ hudT = 0.15; updateHUD(); aimHUD(); }
  saveT += dt; if (saveT > 20 && mode !== 'title'){ saveT = 0; store(); }
}
renderer.setAnimationLoop(frame);

// ---------- HUD (only what changed is redrawn) ----------
const hudLast = {};
function setHTML(id, html){ if (hudLast[id] !== html){ hudLast[id] = html; $(id).innerHTML = html; } }
function updateHUD(force){
  if (mode !== 'screen' && !force) return;
  const hp = Math.ceil(player.hp);
  setHTML('h-wave', `🌊 Wave <b>${lvl.n}</b> &nbsp;⭐ <b>${save.score}</b>`);
  setHTML('h-info', `👽 <b>${aliveCount()}</b> left &nbsp;🧵 <b>${glue.count}</b>/${MAX_STRINGS}`);
  const w = hp + '%';
  if (hudLast.hpw !== w){ hudLast.hpw = w; $('hp-fill').style.width = w; $('hp-fill').className = hp < 35 ? 'low' : ''; $('hp-text').textContent = '❤ ' + hp; }
  setHTML('hint', hintText());
  const st = glue.pending ? 'two' : 'one';
  if (hudLast.cross !== st){ hudLast.cross = st; $('cross').className = st; $('cross-n').textContent = glue.pending ? '2' : '1'; $('b-fire').classList.toggle('two', !!glue.pending); }
}
// what's under the crosshair (a few times a second): an alien glows red, a block cyan
function aimHUD(){
  if (mode !== 'screen') return;
  camera.updateMatrixWorld(true);
  const d = V(0, 0, -1).applyQuaternion(camera.quaternion);
  const h = pick(camera.position, d, 90);
  const k = !h ? 'none' : h.alien || h.debris ? 'alien' : h.block ? 'block' : 'world';
  if (hudLast.aim !== k){ hudLast.aim = k; $('cross').dataset.aim = k; }
}

// ---------- title screen, starting and stopping ----------
function toTitle(){
  if (renderer.xr.isPresenting) renderer.xr.getSession().end();
  save.best = Math.max(save.best, save.score);
  store(); closePanels();
  mode = 'title'; $('title').classList.remove('hidden'); document.body.classList.remove('playing');
  player.dead = false; player.hp = MAXHP;
  startWave(1, true);
  refreshTitle();
}
function refreshTitle(){
  $('b-new').style.display = hadSave || save.wave > 1 || save.score > 0 ? '' : 'none';
  $('b-play').textContent = save.wave > 1 ? `Play (wave ${save.wave})` : 'Play';
  $('t-best').textContent = save.best ? `🏆 Best: ${save.best} points · wave ${save.bestWave}` : '';
}
function ensureGame(newOne){
  if (newOne){ const { turn, welcomed, best, bestWave } = save; save = { ...DEFAULTS, turn, welcomed, best, bestWave }; store(); }
  player.hp = MAXHP; player.dead = false; player.hurtT = 9;
  standAt(START);
  startWave(save.wave, true);
}
function startScreen(newOne){
  startAudio(); ensureGame(newOne);
  mode = 'screen'; $('title').classList.add('hidden'); document.body.classList.add('playing');
  clock.getDelta(); updateHUD(true);
  if (!save.welcomed) welcome();
  else say(`Wave ${lvl.n}: ${lvl.total} aliens. Glue them to the blocks and rip them apart!`);
}
async function startVR(newOne){
  startAudio();
  try {
    const session = await navigator.xr.requestSession('immersive-vr', { requiredFeatures: ['local-floor'] });
    session.addEventListener('end', () => {
      if (mode !== 'vr') return;
      mode = 'title'; $('title').classList.remove('hidden'); document.body.classList.remove('playing');
      camera.position.set(0, 0, 0); camera.quaternion.identity(); rig.position.set(0, 0, 0); rig.quaternion.identity();
      gunL.visible = gunR.visible = laser.visible = boardMesh.visible = hurtShell.visible = false; dots[0].visible = dots[1].visible = false; closePanels();
      sun.shadow.mapSize.set(2048, 2048); if (sun.shadow.map){ sun.shadow.map.dispose(); sun.shadow.map = null; }
      store(); refreshTitle();
    });
    // smaller shadows in a headset
    sun.shadow.mapSize.set(1024, 1024); if (sun.shadow.map){ sun.shadow.map.dispose(); sun.shadow.map = null; }
    if (window.__gg && window.__gg.xrScale) renderer.xr.setFramebufferScaleFactor(window.__gg.xrScale);
    await renderer.xr.setSession(session);
    try { if (session.supportedFrameRates && session.updateTargetFrameRate){ const r = [...session.supportedFrameRates]; if (r.includes(72)) await session.updateTargetFrameRate(72); } } catch (e) { /* keep the default rate */ }
    mode = 'vr'; $('title').classList.add('hidden'); gunScreen.visible = false;
    vrs.posed = false; vrs.frames = 0; vrPage = null;
    camera.position.set(0, 1.6, 0); camera.quaternion.identity();
    clock.getDelta();
    ensureGame(newOne);
    if (!save.welcomed) welcome();
    else say(`Wave ${lvl.n}: ${lvl.total} aliens. Glue them to the blocks!`);
  } catch (e) { $('status').textContent = 'Could not start VR: ' + (e && e.message ? e.message : e); }
}
$('b-play').onclick = () => startScreen(false);
$('b-vr').onclick = () => startVR(false);
$('b-new').onclick = () => {
  if ((save.wave > 1 || save.score > 0) && !confirm('Start again from wave 1? Your score goes back to 0.')) return;
  if (navigator.xr && $('b-vr').dataset.ok === '1' && confirm('Play in VR? (Cancel to play on this screen.)')) startVR(true); else startScreen(true);
};
// the deck behind the title, with aliens prowling it
startWave(1, true);
refreshTitle();
if (navigator.xr && navigator.xr.isSessionSupported){
  navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
    $('b-vr').disabled = !ok; $('b-vr').dataset.ok = ok ? '1' : '0';
    $('status').textContent = ok ? 'Headset found: press Play in VR.' : 'No VR headset here: play on this screen (or open this page in a headset\'s browser).';
  }).catch(() => { $('b-vr').disabled = true; });
} else { $('b-vr').disabled = true; $('status').textContent = 'Play on this screen, or open this page in a VR headset\'s browser.'; }
// say on the title screen once everything is saved on this device for offline play
(async function offlineReady(){
  if (!('caches' in window) || !navigator.serviceWorker) return;
  const name = 'glue-gunner-' + VERSION;
  for (let i = 0; i < 120; i++){
    try {
      if (await caches.has(name) && await (await caches.open(name)).match('/experiments/glue-gunner/__offline-ready__')){ $('offline').textContent = '✓ Saved on this device: plays offline'; return; }
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
// advance: run the game forward without drawing (until cond() is true, if given)
function advance(sec, cond){
  const dt = 1 / 30;
  for (let t = 0; t < sec; t += dt){ simulate(dt); if (cond && cond()) return true; }
  return cond ? !!cond() : true;
}
// look straight at a point from where you stand
function aimAt(p){
  const dx = p.x - player.pos.x, dz = p.z - player.pos.z, dy = p.y - EYE;
  player.yaw = Math.atan2(-dx, -dz); player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  placeScreenCamera(0);
}
window.__gg = {
  get mode(){ return mode; }, get lvl(){ return lvl; }, get save(){ return save; }, get time(){ return gameTime; },
  get head(){ return headPos.toArray(); }, get vrPage(){ return vrPage; },
  world, aliens, debris, glue, fx, player, renderer, camera, scene, rig, vr, vrs, vrPanel, panel, gunL, gunR, gunScreen, stick, keys, dots,
  timeScale: 1, noRender: false, paused: false, version: VERSION, START,
  startScreen, startVR, toTitle, startWave, nextWave, restartWave, shoot, shootScreen, cut, aimAt, standAt, menu, welcome, closePanels, advance, pick, hurt, addAlien,
  renderNow(){ if (mode !== 'vr') placeScreenCamera(1 / 60); renderer.render(scene, camera); },
};

// warm up before the loading screen goes: draw an alien, a torn piece, the glue and the splats once
// (behind the loading screen) so their shaders are ready and the first shot doesn't stutter
async function warmUp(){
  const a = new Alien(scene, { scale: 1 }); a.place(START.x + 3, START.z, 0);
  const d = new Debris(scene, a, BONE.armL); d.com.set(START.x + 3, 1, START.z + 1);
  fx.spray(V(START.x + 3, 1, START.z), V(0, 1, 0), 3); fx.splat(START.x + 3, START.z, 0.4);
  scene.traverse((o) => { if (o.isMesh || o.isSprite) for (const m of [].concat(o.material)) for (const k of ['map', 'normalMap', 'roughnessMap', 'alphaMap', 'emissiveMap']) if (m && m[k]) renderer.initTexture(m[k]); });
  try { if (renderer.compileAsync) await renderer.compileAsync(scene, camera); } catch (e) { /* compiled on first draw instead */ }
  camera.position.set(START.x, 1.6, START.z); camera.lookAt(START.x + 3, 1, START.z); camera.updateMatrixWorld(true);
  renderer.render(scene, camera);
  d.dispose(); a.dispose();
  fx.clearSplats();
}
await warmUp();
if (window.__loaded) window.__loaded();
