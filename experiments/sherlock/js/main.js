// Sherlock: a murder mystery on a night train. Plays the same game three ways:
//  - iPad: thumb stick on the left to walk, drag to look, tap things and people to examine them;
//  - computer: WASD / arrows to walk, drag to look, click things (E examines what's in front of you);
//  - VR (WebXR, e.g. a Quest's browser): left stick walks, right stick turns, your notebook is in your
//    left hand; point at things with the right controller and pull the trigger.
import * as THREE from 'three';
import { V, clamp, angleDiff, textCanvas, roundRect, wrapText } from './util.js';
import { Train, HW } from './train.js';
import { Scene3D } from './evidence.js';
import { Game, SAVE_KEY, fmtTime } from './game.js';
import { ScreenPanel, Tablet } from './ui.js';
import { CastEditor, listCast } from './cast.js';
import { DIFFICULTY, CAR_NAME } from './mystery.js';
import { startAudio, sfx, outdoors } from './audio.js';

// let the loading screen say "Building the train…" (and draw it) before the world is built
if (window.__loading) await window.__loading();

const $ = (id) => document.getElementById(id);
const VERSION = document.body.dataset.version || '';
const EYE = 1.6, WALK = 1.7, RUN = 2.8;

// ---------- renderer, camera ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true; renderer.xr.setReferenceSpaceType('local-floor'); renderer.xr.setFoveation(0.5);
document.body.prepend(renderer.domElement);
renderer.domElement.id = 'game';

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0a0e16, 45, 320);
const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 1500);
const rig = new THREE.Group(); rig.add(camera); scene.add(rig);

// ---------- the train and the game ----------
const train = new Train(scene);
const crime = new Scene3D(train);
const panel = new ScreenPanel();
const tablet = new Tablet();

let mode = 'title';             // title | screen | vr
const player = { pos: V(0, 0, 30), yaw: 0, pitch: 0 };
const stick = { x: 0, y: 0 };
const keys = {};
const msgs = [];
let hudT = 0, saveT = 0, ctxT = 0, gameTime = 0;
const settings = { snap: true, sound: true };
try { Object.assign(settings, JSON.parse(localStorage.getItem('sherlock-settings') || '{}')); } catch (e) {}
const saveSettings = () => { try { localStorage.setItem('sherlock-settings', JSON.stringify(settings)); } catch (e) {} };

// a fader: a black bubble round your head (works on screen and in VR)
const fader = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
fader.renderOrder = 999; fader.visible = false; camera.add(fader);
let fadeTo = 0, fadeCb = null;
// an arrow over where to go next (seen through walls)
const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 4).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: 0xffd84a, depthTest: false, transparent: true, opacity: 0.85 }));
arrow.renderOrder = 50; arrow.visible = false; scene.add(arrow);
let arrowT = 0;

const app = {
  scene, renderer, camera, train, crime,
  isVR: () => mode === 'vr',
  say, showPanel, closePanels, refreshHUD: () => { hudT = 0; refreshTablet(); },
  myPos: () => (mode === 'vr' ? V(headPos.x, 0, headPos.z) : V(player.pos.x, 0, player.pos.z)),
  myYaw: () => (mode === 'vr' ? headYaw() : player.yaw),
  standAt, setPower, fade, loadingMsg, pointAt, clearMsgs, toTitle, newCasePanel,
};
const game = new Game(app);

function setPower(v){ train.setPower(v); }
function pointAt(p, t = 12){ arrow.position.set(p.x, 1.3, p.z); arrow.visible = true; arrowT = t; }
function clearMsgs(){ msgs.length = 0; drawMsgs(); refreshTablet(); board.life = 0; }
function fade(to, cb){ fadeTo = to; fadeCb = cb || null; fader.visible = true; }

// ---------- messages ----------
function say(text, kind = ''){
  if (msgs.some((m) => m.text === text)) return;
  msgs.push({ text, kind, t: 7 });
  while (msgs.length > 3) msgs.shift();
  drawMsgs(); refreshTablet(); vrMessage(text);
}
function drawMsgs(){
  const box = $('h-msg'); box.innerHTML = '';
  for (const m of msgs){ const d = document.createElement('div'); d.className = 'msg ' + m.kind; d.textContent = m.text; box.appendChild(d); }
}
// the loading overlay for slow things later (a new case's passengers)
function loadingMsg(text, f){
  const L = $('busy');
  if (!text){ L.classList.remove('show'); vrBusy(null); return; }
  L.classList.add('show'); $('busy-text').textContent = text + (f != null ? ` ${Math.round(f * 100)}%` : '');
  vrBusy(text);
}

// ---------- panels ----------
let vrPage = null;
function showPanel(spec){
  spec.close = () => closePanels();
  if (mode === 'vr'){ vrPage = spec; vrs.tablet = true; tablet.show(spec); }
  else panel.show(spec);
}
function closePanels(){ panel.close(); vrPage = null; refreshTablet(); }
function panelOpen(){ return mode === 'vr' ? !!vrPage : !!panel.open; }

// ---------- HUD ----------
function updateHUD(){
  if (mode !== 'screen') return;
  const k = game.kase;
  if (!k){ $('h-case').textContent = ''; $('jobs').innerHTML = ''; return; }
  $('h-case').innerHTML = `🔎 <b>${DIFFICULTY[k.m.difficulty].name} case</b> · ⏱ ${fmtTime(k.time)}<br>📍 ${whereAmI()}`;
  const J = $('jobs');
  const list = game.stage === 'intro' || game.stage === 'dark' || game.stage === 'result' || game.stage === 'gather' ? [] : k.jobs().slice(0, 4);
  const sig = list.map((j) => j.text).join('|');
  if (J.dataset.sig !== sig){
    J.dataset.sig = sig; J.innerHTML = '';
    for (const j of list){ const b = document.createElement('button'); b.className = 'job' + (j.last ? ' last' : ''); b.textContent = j.text; b.onclick = () => { startAudio(); sfx.click(); game.followJob(j); }; J.appendChild(b); }
  }
  const show = game.stage === 'investigate' || game.stage === 'arrive';
  $('topbtns').style.visibility = show ? 'visible' : 'hidden';
}
function whereAmI(){ const me = app.myPos(), c = train.carAt(me.z); if (!c) return 'Between the cars'; if (c.id === 'sleeper'){ const cab = train.cabins.find((q) => me.z > q.z0 && me.z < q.z1 && me.x < 0.45); if (cab) return `${c.name}, cabin ${train.cabins.indexOf(cab) + 1}`; } return c.name; }
// the thing in front of you, for the big Examine button
function frontThing(){
  const me = app.myPos(), yaw = app.myYaw(), fx = Math.sin(yaw) * -1, fz = Math.cos(yaw) * -1;
  let best = null, bd = 1e9;
  const consider = (id, p, name, r = 2.4) => {
    const dx = p.x - me.x, dz = p.z - me.z, d = Math.hypot(dx, dz); if (d > r) return;
    const dot = d < 0.6 ? 1 : (dx * fx + dz * fz) / d; if (dot < 0.45) return;
    const score = d - dot; if (score < bd){ bd = score; best = { id, name }; }
  };
  if (!game.m) return null;
  for (const it of game.items) consider(it.id, it.pos, it.name);
  for (const it of train.items) consider(it.id, it.pos, it.name, 2);
  for (const P of game.people){ if (P.info.i === game.m.victim) continue; consider('person:' + P.info.i, P.holder.position, P.info.name.split(' ')[0]); }
  if (game.conductor) consider('conductor', game.conductor.holder.position, 'the conductor');
  return best;
}
function updateContext(){
  const b = $('b-use');
  const t = mode === 'screen' && (game.stage === 'investigate' || game.stage === 'arrive') && !panel.open ? frontThing() : null;
  b.classList.toggle('show', !!t);
  if (t){ const label = (t.id.startsWith('person:') || t.id === 'conductor' ? '💬 Talk to ' : '🔍 ') + t.name; if (b.textContent !== label) b.textContent = label; b.dataset.id = t.id; }
}
$('b-use').onclick = () => { startAudio(); sfx.click(); if ($('b-use').dataset.id) game.use($('b-use').dataset.id); };
$('b-notebook').onclick = () => { startAudio(); sfx.click(); game.notebook(); };
$('b-accuse').onclick = () => { startAudio(); sfx.click(); game.accusePanel(); };
$('b-menu').onclick = () => { startAudio(); sfx.click(); menu(); };

function menu(){
  showPanel({ title: '☰ Menu', sections: [
    { text: `Sherlock v${VERSION}` },
    { heading: 'Turning in VR', buttons: [{ label: 'Snap turns', on: settings.snap, go: () => { settings.snap = true; saveSettings(); menu(); } }, { label: 'Smooth turning', on: !settings.snap, go: () => { settings.snap = false; saveSettings(); menu(); } }] },
    { heading: 'How to play', text: 'Look at the crime scene: the body, the weapon, the footprints. Ask everyone where they were when the lights went out, take their fingerprints and look at their shoes. People who were together can vouch for each other. Use your notebook to compare the clues, cross off the people who can\'t have done it, then accuse the murderer!' },
    { buttons: [{ label: '🚂 Start a new mystery', go: () => newCasePanel() }, { label: '🏠 Save and go to the title screen', go: () => toTitle() }] },
  ] });
}

// ---------- the VR notebook's home page ----------
let tabletT = 0;
function tabletSpec(){
  if (vrPage) return vrPage;
  const k = game.kase, sections = [];
  if (msgs.length) sections.push({ text: msgs.map((m) => m.text).join('\n\n') });
  if (k && game.stage !== 'result'){
    sections.push({ heading: `${DIFFICULTY[k.m.difficulty].name} case · ${fmtTime(k.time)}`, text: '📍 ' + whereAmI() });
    if (game.stage === 'investigate' || game.stage === 'arrive') sections.push({ rows: k.jobs().slice(0, 4).map((j) => ({ title: j.text, go: () => game.followJob(j) })) });
  }
  sections.push({ buttons: [{ label: '📓 Notebook', go: () => game.notebook() }, { label: '👉 Accuse', kind: 'danger', disabled: !(game.stage === 'investigate'), go: () => game.accusePanel() }, { label: '☰ Menu', go: () => menu() }, { label: '🚪 Leave VR', go: () => { const s = renderer.xr.getSession(); if (s) s.end(); } }] });
  sections.push({ text: `v${VERSION} · B / Y hides this notebook` });
  return { title: '🔎 Sherlock', sections };
}
function refreshTablet(){ if (mode === 'vr') tablet.show(tabletSpec()); }

// ---------- walking ----------
function standAt(x, z, yaw){
  if (mode === 'vr'){
    // move the play space so your head is at (x, z), looking along yaw
    if (!vrs.posed){ vrs.pending = { x, z, yaw }; return; }
    rig.updateMatrixWorld(true); renderer.xr.getCamera().matrixWorld.decompose(headPos, headQuat, v1);
    const turn = angleDiff(headYaw(), yaw + Math.PI);   // (headYaw is where the camera looks: facing + π)
    turnRig(turn);
    rig.updateMatrixWorld(true); renderer.xr.getCamera().matrixWorld.decompose(headPos, headQuat, v1);
    rig.position.x += x - headPos.x; rig.position.z += z - headPos.z; rig.position.y = 0;
    rig.updateMatrixWorld(true); renderer.xr.getCamera().matrixWorld.decompose(headPos, headQuat, v1);
  } else { player.pos.set(x, 0, z); player.yaw = yaw + Math.PI; player.pitch = 0; }
}
// (on screen, yaw is the camera's: it looks along -z at yaw 0, so a facing of f means yaw = f + π)
function walk(dt, mx, my, run){
  const l = Math.hypot(mx, my); if (l < 0.08) return;
  if (l > 1){ mx /= l; my /= l; }
  const sp = (run || l > 0.95 ? RUN : WALK) * dt, s = Math.sin(player.yaw), c = Math.cos(player.yaw);
  player.pos.x += (-s * -my + c * mx) * sp; player.pos.z += (-c * -my - s * mx) * sp;
  train.collide(player.pos, 0.24);
}
function placeScreenCamera(){
  const sway = Math.sin(gameTime * 1.3) * 0.004 + Math.sin(gameTime * 3.1) * 0.0015;
  rig.position.set(player.pos.x, player.pos.y, player.pos.z); rig.rotation.set(0, 0, 0);
  camera.position.set(0, EYE + Math.sin(gameTime * 9) * 0.002, 0);
  camera.rotation.set(player.pitch, player.yaw, sway, 'YXZ');
}

// ---------- screen input: a thumb stick, drag to look, tap things ----------
const touch = { stickId: null, stick: null, look: new Map() };
const stickEl = $('stick'), knobEl = $('knob');
const canvas = renderer.domElement;
canvas.style.touchAction = 'none';
function stickZone(x, y){ return x < innerWidth * 0.4 && y > innerHeight * 0.45; }
canvas.addEventListener('pointerdown', (e) => {
  if (mode !== 'screen') return;
  startAudio();
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
  // a new touch in the stick zone always takes the stick over (even if an old one never ended)
  if (e.pointerType !== 'mouse' && stickZone(e.clientX, e.clientY)){
    touch.stickId = e.pointerId; touch.stick = { x0: e.clientX, y0: e.clientY };
    stickEl.style.left = (e.clientX - 60) + 'px'; stickEl.style.top = (e.clientY - 60) + 'px'; stickEl.classList.add('on');
    return;
  }
  touch.look.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: performance.now() });
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId === touch.stickId && touch.stick){
    const dx = e.clientX - touch.stick.x0, dy = e.clientY - touch.stick.y0, d = Math.hypot(dx, dy), m = Math.min(d, 55) / (d || 1);
    stick.x = dx * m / 55; stick.y = dy * m / 55;
    knobEl.style.transform = `translate(${dx * m}px, ${dy * m}px)`;
    return;
  }
  const L = touch.look.get(e.pointerId); if (!L) return;
  const k = e.pointerType === 'mouse' ? 0.005 : 0.006;
  player.yaw -= (e.clientX - L.x) * k; player.pitch = clamp(player.pitch - (e.clientY - L.y) * k, -1.2, 1.1);
  L.x = e.clientX; L.y = e.clientY;
});
function releaseStick(){ touch.stickId = null; touch.stick = null; stick.x = stick.y = 0; stickEl.classList.remove('on'); knobEl.style.transform = ''; }
function endPointer(e){
  if (e.pointerId === touch.stickId){ releaseStick(); return; }
  const L = touch.look.get(e.pointerId); if (!L) return;
  touch.look.delete(e.pointerId);
  if (Math.hypot(e.clientX - L.x0, e.clientY - L.y0) < 10 && performance.now() - L.t < 450) tapAt(e.clientX, e.clientY);
}
canvas.addEventListener('pointerup', endPointer);
const cancelPointer = (e) => { touch.look.delete(e.pointerId); if (e.pointerId === touch.stickId) releaseStick(); };
canvas.addEventListener('pointercancel', cancelPointer);
canvas.addEventListener('lostpointercapture', (e) => { if (e.pointerId === touch.stickId) releaseStick(); touch.look.delete(e.pointerId); });
addEventListener('pointerup', (e) => { if (e.target !== canvas) cancelPointer(e); });
addEventListener('pointercancel', cancelPointer);
function forgetInput(){ releaseStick(); touch.look.clear(); for (const k in keys) keys[k] = false; }
addEventListener('blur', forgetInput);
document.addEventListener('visibilitychange', () => { forgetInput(); if (document.hidden && game.m) game.save(); });
addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
  keys[e.code] = true;
  if (mode !== 'screen') return;
  if (e.code === 'Escape'){ if (panel.open && !panel.open.modal) closePanels(); }
  if (e.code === 'KeyE' && !panel.open){ const t = frontThing(); if (t) game.use(t.id); }
  if (e.code === 'KeyN' && !panel.open) game.notebook();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });

// tapping something: what's under your finger?
const raycaster = new THREE.Raycaster();
function pickables(){ const out = [...train.proxies.children]; for (const it of game.items) out.push(it.proxy); for (const P of game.people) out.push(P.proxy); if (game.conductor) out.push(game.conductor.proxy); return out; }
function pickRay(rc, far = 6){
  rc.far = far;
  // walls stop the ray: only count things closer than the first wall hit
  const hits = rc.intersectObjects(pickables(), false);
  if (!hits.length) return null;
  const wall = rc.intersectObjects(train.meshes, false).find((h) => h.object.material.name !== 'glass');
  const h = hits.find((x) => !wall || x.distance < wall.distance + 0.3);
  return h ? { id: h.object.userData.item, point: h.point, distance: h.distance } : null;
}
function tapAt(x, y){
  if (panel.open || !(game.stage === 'investigate' || game.stage === 'arrive')) return;
  raycaster.setFromCamera(new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1), camera);
  const h = pickRay(raycaster, 8);
  if (h){ sfx.click(); game.use(h.id); }
}

// ---------- VR ----------
function makeVRHand(i){
  return { i, side: i ? 'right' : 'left', tracked: false, pos: V(), quat: new THREE.Quaternion(), rayPos: V(), rayQuat: new THREE.Quaternion(),
    trigger: 0, squeeze: 0, stick: { x: 0, y: 0 }, a: false, b: false, last: {}, gamepad: null,
    haptic(v, ms){ const g = this.gamepad; try { if (g && g.hapticActuators && g.hapticActuators[0]) g.hapticActuators[0].pulse(v, ms); } catch (e) {} } };
}
const vr = [makeVRHand(0), makeVRHand(1)];
const grips = [renderer.xr.getControllerGrip(0), renderer.xr.getControllerGrip(1)], rays = [renderer.xr.getController(0), renderer.xr.getController(1)];
const sources = [null, null];
for (let i = 0; i < 2; i++){ rig.add(grips[i], rays[i]); grips[i].addEventListener('connected', (e) => { sources[i] = e.data; }); grips[i].addEventListener('disconnected', () => { sources[i] = null; }); }
// hands: a glove each (palm on the outside of the handle, fingers curling under, thumb on top)
const handMeshes = [0, 1].map((i) => {
  const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.7 });
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.085, 0.1), m); palm.position.set(i ? 0.035 : -0.035, 0, 0.01); g.add(palm);
  for (let f = 0; f < 4; f++){ const fg = new THREE.Mesh(new THREE.CapsuleGeometry(0.009, 0.035, 3, 6), m); fg.position.set(i ? 0.02 : -0.02, -0.045, -0.03 + f * 0.022); fg.rotation.z = (i ? 1 : -1) * 1.3; g.add(fg); }
  const th = new THREE.Mesh(new THREE.CapsuleGeometry(0.01, 0.04, 3, 6), m); th.position.set(0, 0.04, -0.03); th.rotation.x = Math.PI / 2; g.add(th);
  g.visible = false; scene.add(g); return g;
});
const tabletHolder = new THREE.Group(); scene.add(tabletHolder);
tabletHolder.add(tablet.mesh); tablet.mesh.position.set(0, 0.2, -0.05); tablet.mesh.rotation.x = -0.35;
tabletHolder.visible = false;
const laser = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 1, 6).translate(0, 0.5, 0).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.6 }));
laser.visible = false; scene.add(laser);
const dot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff })); dot.visible = false; scene.add(dot);
// a label for what you're pointing at
const pointLabel = (() => { const t = textCanvas(512, 96); const m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.094), new THREE.MeshBasicMaterial({ map: t.tex, transparent: true, depthTest: false, toneMapped: false })); m.renderOrder = 60; m.visible = false; scene.add(m); return { m, t, text: '' }; })();
function setPointLabel(text){
  if (pointLabel.text === text) return; pointLabel.text = text;
  const g = pointLabel.t.ctx; g.clearRect(0, 0, 512, 96); if (!text) return;
  g.font = 'bold 44px Arial'; const w = Math.min(500, g.measureText(text).width + 40);
  g.fillStyle = 'rgba(30,20,10,0.85)'; roundRect(g, 256 - w / 2, 8, w, 80, 20); g.fill(); g.fillStyle = '#ffe8a0'; g.textAlign = 'center'; g.fillText(text, 256, 64); pointLabel.t.tex.needsUpdate = true;
}
// a message board that appears in front of you for a few seconds (placed only once the headset knows where your head is)
const board = (() => { const t = textCanvas(1024, 256); const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.225), new THREE.MeshBasicMaterial({ map: t.tex, transparent: true, toneMapped: false, depthTest: false })); m.renderOrder = 70; m.visible = false; scene.add(m); return { m, t, life: 0 }; })();
function vrMessage(text, busy){
  if (mode !== 'vr') return;
  const g = board.t.ctx; g.clearRect(0, 0, 1024, 256);
  g.fillStyle = busy ? 'rgba(20,30,50,0.92)' : 'rgba(40,24,10,0.9)'; roundRect(g, 8, 8, 1008, 240, 30); g.fill();
  g.strokeStyle = '#c8a050'; g.lineWidth = 6; roundRect(g, 10, 10, 1004, 236, 28); g.stroke();
  g.fillStyle = '#fff4d8'; g.font = 'bold 40px Georgia'; g.textAlign = 'center';
  const lines = wrapText(g, text, 940).slice(0, 4); lines.forEach((l, i) => g.fillText(l, 512, 128 - (lines.length - 1) * 24 + i * 48 + 14));
  board.t.tex.needsUpdate = true; board.life = busy ? 1e9 : 7; board.placed = false;
}
function vrBusy(text){ if (mode !== 'vr') return; if (text) vrMessage('⏳ ' + text, true); else board.life = 0; }
const headPos = V(), headQuat = new THREE.Quaternion();
const v1 = V();
const vrs = { tablet: true, snapReady: true, posed: false, frames: 0, pending: null, hoverId: null, pointT: 0 };
const headYaw = () => { const f = V(0, 0, -1).applyQuaternion(headQuat); return Math.atan2(-f.x, -f.z); };
function turnRig(a){
  // turn the play space round your head
  rig.updateMatrixWorld(true); renderer.xr.getCamera().matrixWorld.decompose(headPos, headQuat, v1);
  const off = V(rig.position.x - headPos.x, 0, rig.position.z - headPos.z).applyAxisAngle(V(0, 1, 0), a);
  rig.position.set(headPos.x + off.x, rig.position.y, headPos.z + off.z); rig.rotation.y += a;
}
function readVR(){
  for (const h of vr){
    const idx = sources.findIndex((s) => s && s.handedness === h.side);
    const src = idx >= 0 ? sources[idx] : null, g = src && src.gamepad;
    h.gamepad = g || null;
    h.tracked = !!(src && grips[idx].visible);
    if (h.tracked){
      grips[idx].updateMatrixWorld(true); grips[idx].matrixWorld.decompose(h.pos, h.quat, v1);
      rays[idx].updateMatrixWorld(true); rays[idx].matrixWorld.decompose(h.rayPos, h.rayQuat, v1);
    }
    const B = (k) => (g && g.buttons[k]) || { value: 0, pressed: false };
    h.trigger = B(0).value; h.squeeze = B(1).value; h.a = B(4).pressed; h.b = B(5).pressed;
    const ax = g ? g.axes : [];
    h.stick.x = ax.length >= 4 ? ax[2] : (ax[0] || 0); h.stick.y = ax.length >= 4 ? ax[3] : (ax[1] || 0);
    const L = h.last;
    h.triggerDown = h.trigger > 0.7 && !L.t; h.aDown = h.a && !L.a; h.bDown = h.b && !L.b;
    L.t = h.trigger > 0.7 ? true : h.trigger < 0.4 ? false : L.t; L.a = h.a; L.b = h.b;
  }
}
function vrUpdate(dt){
  readVR();
  const L = vr[0], R = vr[1];
  for (const h of vr){ const m = handMeshes[h.i]; m.visible = h.tracked; if (h.tracked){ m.position.copy(h.pos); m.quaternion.copy(h.quat); } }
  tabletHolder.visible = L.tracked && vrs.tablet;
  if (tabletHolder.visible){ tabletHolder.position.copy(L.pos); tabletHolder.quaternion.copy(L.quat); }
  laser.visible = false; dot.visible = false; pointLabel.m.visible = false;
  let onTablet = false;
  if (R.tracked){
    const dir = V(0, 0, -1).applyQuaternion(R.rayQuat);
    if (tabletHolder.visible){
      tabletHolder.updateMatrixWorld(true);
      const hit = tablet.ray(R.rayPos, dir, R.triggerDown, 3);
      if (hit){
        onTablet = true; laser.visible = true; dot.visible = true;
        laser.position.copy(R.rayPos); laser.lookAt(hit.point); laser.scale.set(1, 1, R.rayPos.distanceTo(hit.point));
        dot.position.copy(hit.point);
        if (hit.clicked){ R.haptic(0.3, 30); sfx.click(); refreshTablet(); }
        if (Math.abs(R.stick.y) > 0.3) tablet.scrollBy(R.stick.y * dt * 900);
      }
    }
    // pointing at things in the train (checked 20 times a second)
    if (!onTablet && (game.stage === 'investigate' || game.stage === 'arrive')){
      vrs.pointT -= dt;
      if (vrs.pointT <= 0 || R.triggerDown){
        vrs.pointT = 0.05;
        const rc = new THREE.Raycaster(R.rayPos, dir); const h = pickRay(rc, 6);
        vrs.hover = h;
        if ((h && h.id) !== vrs.hoverId){ vrs.hoverId = h && h.id; if (h) R.haptic(0.15, 15); }
      }
      const h = vrs.hover;
      laser.visible = true; laser.position.copy(R.rayPos);
      const end = h ? h.point : R.rayPos.clone().addScaledVector(dir, 2);
      laser.lookAt(end); laser.scale.set(1, 1, R.rayPos.distanceTo(end));
      if (h){ dot.visible = true; dot.position.copy(h.point); setPointLabel(nameOf(h.id)); pointLabel.m.visible = true; pointLabel.m.position.copy(h.point).add(V(0, 0.15, 0)); pointLabel.m.quaternion.copy(headQuat); }
      if (R.triggerDown && h){ R.haptic(0.4, 40); sfx.click(); game.use(h.id); vrs.tablet = true; }
    }
  }
  if (L.bDown || L.aDown || R.bDown){ vrs.tablet = !vrs.tablet; if (!vrs.tablet) vrPage = null; refreshTablet(); }
  // the message board: in front of you, follows if you turn away
  if (board.life > 0){
    board.life -= dt; board.m.visible = board.life > 0;
    const f = V(0, 0, -1).applyQuaternion(headQuat); f.y = 0; f.normalize();
    const want = headPos.clone().addScaledVector(f, 1.3).add(V(0, -0.15, 0));
    if (!board.placed || board.m.position.distanceTo(want) > 0.9){ board.m.position.copy(want); board.m.lookAt(headPos.x, want.y, headPos.z); board.placed = true; }
  } else board.m.visible = false;
  if (game.stage === 'gather' || game.stage === 'result' || game.stage === 'intro') return;
  // turning
  const sx = R.stick.x;
  if (settings.snap){ if (Math.abs(sx) > 0.7 && vrs.snapReady && !onTablet){ turnRig(-Math.sign(sx) * Math.PI / 6); vrs.snapReady = false; } if (Math.abs(sx) < 0.35) vrs.snapReady = true; }
  else if (Math.abs(sx) > 0.2 && !onTablet) turnRig(-sx * dt * 2.2);
  // walking where you look; your real head is only stopped by tall things (walls)
  let mx = L.stick.x, my = L.stick.y; if (Math.hypot(mx, my) < 0.15){ mx = 0; my = 0; }
  const want = V(headPos.x, 0, headPos.z);
  if (mx || my){
    const f = V(0, 0, -1).applyQuaternion(headQuat); f.y = 0; f.normalize();
    const r = V(-f.z, 0, f.x), sp = (Math.hypot(mx, my) > 0.95 ? RUN : WALK) * dt;
    want.addScaledVector(f, -my * sp).addScaledVector(r, mx * sp);
    train.collide(want, 0.22, false);
  } else train.collide(want, 0.18, true);
  rig.position.x += want.x - headPos.x; rig.position.z += want.z - headPos.z;
}
function nameOf(id){
  if (id.startsWith('person:')){ const P = game.people[+id.slice(7)]; return P ? P.info.name : ''; }
  if (id === 'conductor') return 'The conductor';
  const it = game.item(id); return it ? it.name : '';
}

// ---------- the loop ----------
const clock = new THREE.Clock();
function frame(){
  try {
    const dt = Math.min(clock.getDelta(), 1 / 20);
    const T = window.__sherlock, steps = T && T.timeScale > 1 ? Math.round(T.timeScale) : 1;
    for (let k = 0; k < steps; k++) simulate(dt, k === 0);
    if (T && T.noRender && mode !== 'vr') return;     // (a headset only sends its next frame once this one is drawn)
    if (mode !== 'vr') placeScreenCamera();
    renderer.render(scene, camera);
  } catch (e) { console.error(e); }
}
function simulate(dt, first){
  gameTime += dt;
  if (mode === 'vr'){
    rig.updateMatrixWorld(true);
    renderer.xr.getCamera().matrixWorld.decompose(headPos, headQuat, v1);
    // wait for the headset's first real frames before placing you or anything in front of you
    if (!vrs.posed){ vrs.frames = renderer.xr.isPresenting ? vrs.frames + 1 : 0; }
    if (!vrs.posed && vrs.frames >= 3){ vrs.posed = true; if (vrs.pending){ const q = vrs.pending; vrs.pending = null; standAt(q.x, q.z, q.yaw); } refreshTablet(); }
    if (vrs.posed) vrUpdate(dt);
  } else {
    if (mode === 'screen' && !panel.open && (game.stage === 'investigate' || game.stage === 'arrive')){
      const k = (c) => (keys[c] ? 1 : 0);
      walk(dt, stick.x + k('KeyD') - k('KeyA'), stick.y + k('KeyS') - k('KeyW'), keys.ShiftLeft || keys.ShiftRight);
      player.yaw += (k('ArrowLeft') - k('ArrowRight')) * dt * 1.8;
      player.pitch = clamp(player.pitch + (k('ArrowUp') - k('ArrowDown')) * dt, -1.2, 1.1);
      if (k('ArrowUp') || k('ArrowDown')){ /* (arrows look; WASD walks) */ }
    }
    headPos.set(player.pos.x, EYE, player.pos.z);
    headQuat.setFromEuler(new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ'));
  }
  if (mode === 'title') titleSpin(dt);
  game.update(dt);
  crime.update(dt, game.m ? (p) => game.sparkleVisible(p) : null);
  train.updateLights(headPos, dt);
  if (first) train.updateOutside(dt);
  if (first){
    const onPlatform = headPos.z > train.cars.observation.z1;
    outdoors(onPlatform ? 1 : 0);
  }
  // the fader
  if (fader.visible){
    const o = fader.material.opacity, d = dt * 2.2;
    fader.material.opacity = fadeTo > o ? Math.min(fadeTo, o + d) : Math.max(fadeTo, o - d);
    if (fader.material.opacity === fadeTo){ if (!fadeTo) fader.visible = false; if (fadeCb){ const f = fadeCb; fadeCb = null; f(); } }
  }
  if (arrow.visible){ arrowT -= dt; arrow.position.y = 1.3 + Math.sin(gameTime * 4) * 0.08; arrow.rotation.y += dt * 2; if (arrowT <= 0 || (game.m && app.myPos().distanceTo(V(arrow.position.x, 0, arrow.position.z)) < 1.5)) arrow.visible = false; }
  if (!first) return;
  for (const m of msgs) m.t -= dt;
  if (msgs.length && msgs[0].t <= 0){ while (msgs.length && msgs[0].t <= 0) msgs.shift(); drawMsgs(); refreshTablet(); }
  hudT -= dt; if (hudT <= 0){ hudT = 0.5; updateHUD(); }
  ctxT -= dt; if (ctxT <= 0){ ctxT = 0.25; updateContext(); }
  if (mode === 'vr'){ tabletT -= dt; if (tabletT <= 0){ tabletT = 1; if (!vrPage) refreshTablet(); } }
  saveT += dt; if (saveT > 10 && mode !== 'title' && game.m){ saveT = 0; game.save(); }
}
renderer.setAnimationLoop(frame);
// for the headless test: run the game forward without waiting for frames (until cond() is true, if given)
function advance(sec, cond){
  const dt = 1 / 20;
  for (let t = 0; t < sec; t += dt){ simulate(dt, true); if (cond && cond()) return true; }
  return cond ? !!cond() : true;
}
function renderNow(){ if (mode !== 'vr') placeScreenCamera(); renderer.render(scene, camera); }

// ---------- title screen ----------
let spin = 0;
function titleSpin(dt){
  // a slow look round the dining car, the Coke on its table
  spin += dt * 0.05;
  const c = train.cokePos;
  player.pos.set(0.1, 0, c.z - 1.6); player.yaw = Math.PI + 0.55 + Math.sin(spin) * 0.35; player.pitch = -0.18;
  if (!game.m) train.setPower(1);
}
function toTitle(){
  if (renderer.xr.isPresenting){ renderer.xr.getSession().end(); return; }
  if (game.m && game.stage !== 'result') game.save();
  closePanels();
  mode = 'title'; $('title').classList.remove('hidden'); document.body.classList.remove('playing');
  refreshTitle();
}
async function refreshTitle(){
  const has = game.hasSave() || (game.m && game.stage !== 'result');
  $('b-play').textContent = has ? '▶ Continue the case' : '▶ Play';
  $('b-new').style.display = has ? '' : 'none';
  const cast = await listCast();
  $('b-cast').textContent = cast.length ? `🎭 Your own people (${cast.length})` : '🎭 Add your own people';
}
// start playing on this screen or in VR: a saved case, the one in progress, or a new one
async function play(vrToo){
  startAudio();
  if (vrToo){ if (!(await startVR())) return; }
  else { mode = 'screen'; $('title').classList.add('hidden'); document.body.classList.add('playing'); }
  if (game.m && game.stage !== 'result' && game.stage !== 'none'){ refreshTablet(); return; }
  if (game.hasSave()){ if (await game.loadSaved()) { refreshTablet(); return; } }
  newCasePanel();
}
// choosing a new case: difficulty, and whether to use your own people
async function newCasePanel(){
  const cast = (await listCast()).filter((p) => p.photos && p.photos.front);
  if (mode === 'title'){ mode = 'screen'; $('title').classList.add('hidden'); document.body.classList.add('playing'); }
  const st = newCasePanel.st = newCasePanel.st || { useCast: cast.length > 0 };
  const go = (d) => async () => {
    closePanels();
    await game.newCase({ difficulty: d, useCast: st.useCast && cast.length > 0 });
    refreshTablet(); updateHUD();
  };
  const sections = [
    { text: 'A new mystery on the Midnight Express: new passengers, a new crime, new clues. How hard should it be?' },
    { buttons: [
      { label: '🟢 Easy', kind: 'primary', go: go('easy') },
      { label: '🟠 Medium', kind: 'primary', go: go('medium') },
      { label: '🔴 Hard', kind: 'primary', go: go('hard') },
    ] },
    { list: true, text: 'Easy: clear clues, sparkles show where to look, and one warning if you accuse the wrong person.\nMedium: you need to put two or three clues together.\nHard: smudged clues, a red herring or two, and no sparkles.' },
  ];
  if (cast.length) sections.push({ heading: 'Your own people', buttons: [{ label: st.useCast ? `✓ Use my people (${cast.length})` : `Use my people (${cast.length})`, on: st.useCast, go: () => { st.useCast = !st.useCast; newCasePanel(); } }] });
  if (game.m && game.stage !== 'result') sections.push({ text: 'Starting a new mystery ends the one you\'re on.' });
  showPanel({ title: '🚂 A new mystery', sections });
}
// ---------- starting VR ----------
async function startVR(){
  if (!navigator.xr) return false;
  try {
    const session = await navigator.xr.requestSession('immersive-vr', { requiredFeatures: ['local-floor'], optionalFeatures: ['bounded-floor'] });
    session.addEventListener('end', () => {
      if (game.m) game.save();
      mode = 'title'; vrPage = null; $('title').classList.remove('hidden'); document.body.classList.remove('playing');
      rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0); camera.position.set(0, 0, 0); camera.quaternion.identity();
      for (const o of [tabletHolder, laser, dot, board.m, pointLabel.m, ...handMeshes]) o.visible = false;
      // back on screen where you were standing
      player.pos.set(headPos.x, 0, headPos.z); player.yaw = headYaw();
      refreshTitle();
    });
    if (window.__sherlock && window.__sherlock.xrScale) renderer.xr.setFramebufferScaleFactor(window.__sherlock.xrScale);
    await renderer.xr.setSession(session);
    try { if (session.supportedFrameRates && session.updateTargetFrameRate){ const r = [...session.supportedFrameRates]; if (r.includes(72)) await session.updateTargetFrameRate(72); } } catch (e) {}
    mode = 'vr'; $('title').classList.add('hidden'); document.body.classList.remove('playing');
    vrs.tablet = true; vrPage = null; vrs.posed = false; vrs.frames = 0;
    // stand where you were on screen (or at the start)
    const st = train.playerStart;
    vrs.pending = game.m ? { x: player.pos.x, z: player.pos.z, yaw: player.yaw - Math.PI } : { x: st.x, z: st.z, yaw: st.yaw };
    clock.getDelta();
    refreshTablet();
    return true;
  } catch (e) { $('status').textContent = 'Could not start VR: ' + (e && e.message ? e.message : e); return false; }
}
$('b-play').onclick = () => play(false);
$('b-vr').onclick = () => play(true);
$('b-new').onclick = () => { startAudio(); newCasePanel(); };
const castEditor = new CastEditor($('cast'), { onChange: () => refreshTitle() });
$('b-cast').onclick = () => { startAudio(); castEditor.open(); };
if (!window.indexedDB) $('b-cast').style.display = 'none';
refreshTitle();
const vrStatus = (t) => { $('status').textContent = t; };
if (navigator.xr && navigator.xr.isSessionSupported){
  navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
    $('b-vr').disabled = !ok;
    vrStatus(ok ? 'Headset found: press Play in VR.' : 'Play on this screen, or open this page in a VR headset\'s browser.');
  }).catch(() => { $('b-vr').disabled = true; });
} else { $('b-vr').disabled = true; vrStatus('Play on this screen, or open this page in a VR headset\'s browser.'); }
// is this version saved for playing offline?
(async () => {
  try {
    if (!('caches' in window)) return;
    for (let i = 0; i < 40; i++){
      const name = 'sherlock-' + VERSION;
      if (await caches.has(name) && await (await caches.open(name)).match('/experiments/sherlock/__offline-ready__')){ $('offline').textContent = '✓ Saved on this device: plays offline'; return; }
      await new Promise((r) => setTimeout(r, 3000));
    }
  } catch (e) { /* no caches here */ }
})();

addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
addEventListener('pagehide', () => { if (game.m) game.save(); });

// ---------- for the headless test ----------
window.__sherlock = {
  get mode(){ return mode; }, game, train, crime, renderer, camera, scene, rig, vr, tablet, vrs, player, stick, keys, settings, panel,
  timeScale: 1, noRender: false, version: VERSION,
  play, startVR, newCasePanel, closePanels, tabletSpec, standAt, advance, renderNow, frontThing, pickRay, tapAt, menu, castEditor, say,
  get vrPage(){ return vrPage; }, get head(){ return headPos.toArray(); }, get time(){ return gameTime; }, get msgs(){ return msgs.map((m) => m.text); },
  SAVE_KEY,
};
void HW; void CAR_NAME;

// the game is ready: hide the loading screen
if (window.__loaded) window.__loaded();
