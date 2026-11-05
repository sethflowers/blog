// VR Test: the main loop. Starts the WebXR session, reads the controllers, moves you around with the
// sticks (or your own feet), and runs the world, your body, the things you hold and the creatures.
// Without a headset it runs on screen with mouse and keyboard so it can be tried (and tested) anywhere.
import * as THREE from 'three';
import { buildWorld, surfaceHeight, pushOut, PLACES, STEP } from './world.js';
import { Avatar, yawOf } from './avatar.js';
import { Items, Particles } from './items.js';
import { Creatures, Villagers } from './creatures.js';
import { startAudio, setListener, sfx } from './audio.js';
import { textCanvas, boxMesh, COL } from './util.js';

const $ = (id) => document.getElementById(id);
const VERSION = document.body.dataset.version || '';

// ---------- renderer, scene, the player's rig ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation(0.6);
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 600);
const rig = new THREE.Group();
rig.add(camera);
scene.add(rig);
rig.position.set(0, 0, 1.2);

const world = buildWorld(scene);
const particles = new Particles(scene);
const creatures = new Creatures(scene, particles);
const villagers = new Villagers(scene);
const items = new Items(scene, { particles, creatures, npcs: villagers });

// ---------- your body, and its reflection ----------
const avatar = new Avatar({ head: true, firstPerson: true });
avatar.headM.visible = false; avatar.neckM.visible = false;   // you don't see your own head
scene.add(avatar.root);
avatar.onStep = (i, p) => sfx.step(p);

const M = PLACES.mirror;
const mirrorGroup = new THREE.Group();
mirrorGroup.matrixAutoUpdate = false;
mirrorGroup.matrixWorldNeedsUpdate = true;
mirrorGroup.matrix.set(-1, 0, 0, 2 * M.x, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);   // reflect across the plane x = M.x
scene.add(mirrorGroup);
const mirrorAvatar = new Avatar({ head: true });
mirrorGroup.add(mirrorAvatar.root);
const mirrorItems = new Map();

// ---------- holsters on your hips: left for the sword, right for the pistol ----------
const holsters = [0, 1].map((i) => ({ side: i ? 1 : -1, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), item: null, mesh: null }));
holsters[0].mesh = boxMesh(0.07, 0.2, 0.05, 0x5a3418, 0, -0.08, 0);   // scabbard top
holsters[1].mesh = boxMesh(0.06, 0.12, 0.1, 0x5a3418, 0, -0.04, 0.02); // pistol holster
for (const h of holsters) scene.add(h.mesh);

// ---------- controllers ----------
function makeHand(side){
  return {
    side, tracked: false, idx: -1, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), rayQuat: null,
    vel: new THREE.Vector3(), angVel: new THREE.Vector3(), hist: [], prevQuat: new THREE.Quaternion(),
    trigger: 0, squeeze: 0, triggerTouch: false, thumbTouch: false, stick: { x: 0, y: 0 },
    a: false, b: false, stickPress: false, last: {}, triggerDown: false, squeezeDown: false, squeezeUp: false,
    aDown: false, bDown: false, stickDown: false, held: null, heldCreature: null, gamepad: null,
    curl: { index: 0.2, grip: 0.2, thumb: 0 },
    haptic(v, ms){ const g = this.gamepad; try { if (g && g.hapticActuators && g.hapticActuators[0]) g.hapticActuators[0].pulse(v, ms); else if (g && g.vibrationActuator) g.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: v, weakMagnitude: v }); } catch (e) {} },
  };
}
const hands = [makeHand('left'), makeHand('right')];
const gripObj = [renderer.xr.getControllerGrip(0), renderer.xr.getControllerGrip(1)];
const rayObj = [renderer.xr.getController(0), renderer.xr.getController(1)];
const sourceOf = [null, null];
for (let i = 0; i < 2; i++){
  rig.add(gripObj[i], rayObj[i]);
  gripObj[i].addEventListener('connected', (e) => { sourceOf[i] = e.data; });
  gripObj[i].addEventListener('disconnected', () => { sourceOf[i] = null; });
}

// ---------- settings and state ----------
const settings = { smoothTurn: true, run: false };
try { const s = JSON.parse(localStorage.getItem('vr-test-settings') || '{}'); if (typeof s.smoothTurn === 'boolean') settings.smoothTurn = s.smoothTurn; } catch (e) {}
const saveSettings = () => { try { localStorage.setItem('vr-test-settings', JSON.stringify({ smoothTurn: settings.smoothTurn })); } catch (e) {} };
const player = { pos: new THREE.Vector3(), head: new THREE.Vector3(), speed: 0, vy: 0, air: false, moveVel: new THREE.Vector3(), snapReady: true };
let eyeHeight = 1.62, calib = { t: 0, n: 0, sum: 0, done: false };
let mode = 'title';            // 'title' | 'vr' | 'desktop'
let toast = { text: '', t: 0 };
const headPos = new THREE.Vector3(), headQuat = new THREE.Quaternion();

// ---------- the watch on your left wrist ----------
const watch = new THREE.Group();
const watchFace = textCanvas(256, 160);
const watchBody = boxMesh(0.07, 0.012, 0.05, 0x2a2a2e, 0, 0, 0);
const watchScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.062, 0.04), new THREE.MeshBasicMaterial({ map: watchFace.tex }));
watchBody.rotation.x = Math.PI / 2; watchScreen.position.z = 0.0065;
watch.add(watchBody, watchScreen);
scene.add(watch);
const watchLocal = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0)).setPosition(-0.032, 0.105, 0.005);
let gameTime = 0, fps = 0, frames = 0, fpsT = 0, watchT = 0;
function drawWatch(){
  const g = watchFace.ctx;
  g.fillStyle = '#0d1a14'; g.fillRect(0, 0, 256, 160);
  const d = new Date();
  g.fillStyle = '#7dffb0'; g.textAlign = 'center'; g.textBaseline = 'top';
  g.font = 'bold 54px ui-monospace, Menlo, Consolas, monospace';
  g.fillText(`${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`, 128, 6);
  g.font = 'bold 26px ui-monospace, Menlo, Consolas, monospace';
  g.fillStyle = fps >= 70 ? '#7dffb0' : fps >= 55 ? '#ffd27d' : '#ff8a7d';
  g.fillText(`${fps} fps`, 128, 68);
  g.fillStyle = '#a8c8ff';
  g.fillText(toast.t > 0 ? toast.text : (settings.smoothTurn ? 'smooth turn' : 'snap turn'), 128, 100);
  g.fillStyle = '#5a7a6a'; g.font = '18px ui-monospace, Menlo, Consolas, monospace';
  g.fillText(`v${VERSION}`, 128, 134);
  watchFace.tex.needsUpdate = true;
}
function say(text){ toast = { text, t: 2.5 }; drawWatch(); }

// ---------- reading input ----------
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), q1 = new THREE.Quaternion(), m1 = new THREE.Matrix4();
function readVRInput(session){
  for (const h of hands){
    const idx = sourceOf.findIndex((s) => s && s.handedness === h.side);
    const src = idx >= 0 ? sourceOf[idx] : null;
    h.idx = idx;
    const g = src && src.gamepad;
    h.gamepad = g || null;
    h.tracked = !!(src && gripObj[idx].visible);
    if (h.tracked){
      gripObj[idx].updateMatrixWorld(true);
      gripObj[idx].matrixWorld.decompose(h.pos, h.quat, v1);
      rayObj[idx].updateMatrixWorld(true);
      h.rayQuat = h.rayQuat || new THREE.Quaternion(); h.rayPos = h.rayPos || new THREE.Vector3();
      rayObj[idx].matrixWorld.decompose(h.rayPos, h.rayQuat, v1);
    }
    const B = (k) => (g && g.buttons[k]) || { value: 0, pressed: false, touched: false };
    h.trigger = B(0).value; h.squeeze = B(1).value;
    h.triggerTouch = B(0).touched || h.trigger > 0.05;
    h.stickPress = B(3).pressed; h.a = B(4).pressed; h.b = B(5).pressed;
    h.thumbTouch = B(3).touched || B(4).touched || B(5).touched || B(6).touched || h.a || h.b;
    const ax = g ? g.axes : [];
    h.stick.x = ax.length >= 4 ? ax[2] : (ax[0] || 0); h.stick.y = ax.length >= 4 ? ax[3] : (ax[1] || 0);
  }
}
function edges(){
  for (const h of hands){
    const L = h.last;
    h.triggerDown = h.trigger > 0.7 && !L.trig; h.squeezeDown = h.squeeze > 0.6 && !L.sq; h.squeezeUp = h.squeeze < 0.35 && L.sq;
    h.aDown = h.a && !L.a; h.bDown = h.b && !L.b; h.stickDown = h.stickPress && !L.sp;
    L.trig = h.trigger > 0.7 ? true : h.trigger < 0.5 ? false : L.trig;
    L.sq = h.squeeze > 0.6 ? true : h.squeeze < 0.35 ? false : L.sq;
    L.a = h.a; L.b = h.b; L.sp = h.stickPress;
  }
}
// hand velocity from the last few frames, for throwing
function handMotion(dt){
  for (const h of hands){
    if (!h.tracked){ h.hist.length = 0; continue; }
    h.hist.push({ p: h.pos.clone(), q: h.quat.clone(), dt });
    if (h.hist.length > 5) h.hist.shift();
    if (h.hist.length >= 2){
      const a = h.hist[0], b = h.hist[h.hist.length - 1];
      let T = 0; for (let i = 1; i < h.hist.length; i++) T += h.hist[i].dt;
      if (T > 0){
        h.vel.subVectors(b.p, a.p).divideScalar(T);
        q1.copy(a.q).invert().premultiply(b.q);
        if (q1.w < 0){ q1.x = -q1.x; q1.y = -q1.y; q1.z = -q1.z; q1.w = -q1.w; }
        const ang = 2 * Math.acos(Math.min(1, q1.w)), s = Math.sqrt(1 - q1.w * q1.w);
        if (s > 1e-4) h.angVel.set(q1.x / s, q1.y / s, q1.z / s).multiplyScalar(ang / T); else h.angVel.set(0, 0, 0);
      }
    }
    // fingers follow what your fingers are touching on the controller
    const c = h.curl, k = Math.min(1, dt * 18);
    let ti = h.triggerTouch ? 0.35 + 0.65 * h.trigger : 0.04;
    let tg = 0.12 + 0.88 * h.squeeze;
    let tt = h.thumbTouch ? 1 : 0;
    if (h.held){ tg = Math.max(tg, 1); if (h.held.kind !== 'gun') ti = Math.max(ti, 0.9); else ti = Math.max(ti, 0.3); tt = Math.max(tt, 0.7); }
    if (h.heldCreature){ tg = Math.max(tg, 0.75); ti = Math.max(ti, 0.7); }
    c.index += (ti - c.index) * k; c.grip += (tg - c.grip) * k; c.thumb += (tt - c.thumb) * k;
  }
}

// ---------- moving and turning ----------
function locomotion(dt){
  const L = hands[0], Rh = hands[1];
  // turning: right stick, around your head
  const sx = Math.abs(Rh.stick.x) > 0.2 ? Rh.stick.x : 0;
  let turn = 0;
  if (settings.smoothTurn) turn = -Math.sign(sx) * Math.pow(Math.max(0, Math.abs(sx) - 0.2) / 0.8, 1.4) * 2.2 * dt;
  else {
    if (Math.abs(Rh.stick.x) > 0.7 && player.snapReady){ turn = -Math.sign(Rh.stick.x) * Math.PI / 6; player.snapReady = false; }
    if (Math.abs(Rh.stick.x) < 0.35) player.snapReady = true;
  }
  if (turn){
    v1.copy(headPos);
    rig.position.sub(v1).applyAxisAngle(THREE.Object3D.DEFAULT_UP, turn).add(v1);
    rig.rotation.y += turn;
    rig.updateMatrixWorld(true);
    // the head turned with the rig; recompute it
    headPos.copy(v1);
    headQuat.premultiply(q1.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, turn));
  }
  // walking: left stick, the way your head faces
  let mx = L.stick.x, my = L.stick.y; const mag = Math.hypot(mx, my);
  if (mag < 0.15){ mx = my = 0; } else { const k = Math.min(1, (mag - 0.15) / 0.85) / mag; mx *= k; my *= k; }
  if (L.stickDown){ settings.run = !settings.run; say(settings.run ? 'running' : 'walking'); }
  if (mag < 0.15 && settings.run && player.moveVel.lengthSq() < 0.01) settings.run = false;
  v1.set(0, 0, -1).applyQuaternion(headQuat); v1.y = 0; if (v1.lengthSq() < 1e-4) v1.set(0, 0, -1); v1.normalize();
  v2.set(-v1.z, 0, v1.x);
  const speed = settings.run ? 4.2 : 2.6;
  const want = new THREE.Vector3().addScaledVector(v1, -my * speed).addScaledVector(v2, mx * speed);
  player.moveVel.lerp(want, Math.min(1, dt * (want.lengthSq() > player.moveVel.lengthSq() ? 10 : 14)));
  // step the head and push it out of walls, then move the rig by however far the head got
  const target = v1.copy(headPos).addScaledVector(player.moveVel, dt);
  target.y = 0;
  const feet = rig.position.y;
  pushOut(target, 0.22, feet);
  const dx = target.x - headPos.x, dz = target.z - headPos.z;
  rig.position.x += dx; rig.position.z += dz;
  headPos.x += dx; headPos.z += dz;
  // up and down: follow the ground, jump with A, fall off ledges
  const ground = surfaceHeight(headPos.x, headPos.z, feet + STEP);
  if (Rh.aDown && !player.air){ player.vy = 4.3; player.air = true; }
  if (player.air || ground < feet - 0.08){
    player.air = true;
    player.vy -= 9.8 * dt;
    rig.position.y += player.vy * dt;
    if (rig.position.y <= ground){ rig.position.y = ground; player.air = false; player.vy = 0; sfx.step(headPos); }
  } else {
    rig.position.y += (ground - feet) * Math.min(1, dt * 14);
    player.vy = 0;
  }
  headPos.y += rig.position.y - feet;
  rig.updateMatrixWorld(true);
  player.speed = Math.hypot(player.moveVel.x, player.moveVel.z);
}

// ---------- the frame ----------
const clock = new THREE.Clock();
let xrRefSpace = null;
function frame(time, xrFrame){
  const dt = Math.min(clock.getDelta(), 1 / 30);
  gameTime += dt;
  frames++; fpsT += dt; if (fpsT >= 1){ fps = Math.round(frames / fpsT); frames = 0; fpsT = 0; }
  avatar.root.visible = mode !== 'title';
  for (const h of holsters) h.mesh.visible = mode !== 'title';
  if (mode === 'title'){ watch.visible = false; titleSpin(dt); renderer.render(scene, camera); return; }

  rig.updateMatrixWorld(true);
  if (mode === 'vr'){
    const ref = renderer.xr.getReferenceSpace();
    const pose = xrFrame && ref ? xrFrame.getViewerPose(ref) : null;
    if (pose){
      const t = pose.transform;
      headPos.set(t.position.x, t.position.y, t.position.z).applyMatrix4(rig.matrixWorld);
      headQuat.set(t.orientation.x, t.orientation.y, t.orientation.z, t.orientation.w).premultiply(q1.setFromRotationMatrix(m1.extractRotation(rig.matrixWorld)));
      // learn how tall you are from the first couple of seconds
      if (!calib.done){
        calib.t += dt;
        if (calib.t > 1.2){ calib.sum += t.position.y; calib.n++; }
        if (calib.t > 2.2 && calib.n){ setEyeHeight(calib.sum / calib.n); calib.done = true; }
      }
    }
    readVRInput(renderer.xr.getSession());
  } else desktopInput(dt);
  edges();

  locomotion(dt);
  // the grips moved with the rig
  if (mode === 'vr') readVRInput(renderer.xr.getSession());
  handMotion(dt);

  // buttons
  const L = hands[0], Rh = hands[1];
  if (L.bDown){ settings.smoothTurn = !settings.smoothTurn; saveSettings(); say(settings.smoothTurn ? 'smooth turn' : 'snap turn'); sfx.ui(); }
  if (L.aDown){ calibrateNow(); }
  if (Rh.bDown){ items.recallAll(); say('items returned'); sfx.ui(); }

  player.pos.set(headPos.x, rig.position.y, headPos.z);
  player.head.copy(headPos);

  // body
  const grips = hands.map((h) => h.tracked ? { pos: h.pos, quat: h.quat } : null);
  avatar.update(dt, headPos, headQuat, grips, (x, z) => surfaceHeight(x, z, rig.position.y + STEP), player.air);
  for (let i = 0; i < 2; i++) avatar.hands[i].setPose(hands[i].curl.index, hands[i].curl.grip, hands[i].curl.thumb);
  updateHolsters();

  items.update(dt, hands, holsters);
  creatures.update(dt, player);
  villagers.update(dt, player, headPos);
  particles.update(dt);
  world.update(dt);
  updateMirror();
  // watch
  if (hands[0].tracked){
    watch.visible = true;
    m1.compose(hands[0].pos, hands[0].quat, v1.set(1, 1, 1)).multiply(watchLocal);
    m1.decompose(watch.position, watch.quaternion, v1);
  } else watch.visible = false;
  toast.t -= dt; watchT -= dt;
  if (watchT <= 0){ watchT = 0.5; drawWatch(); }
  // sound follows your head
  setListener(headPos, v1.set(0, 0, -1).applyQuaternion(headQuat), v2.set(0, 1, 0).applyQuaternion(headQuat));

  if (mode === 'desktop'){
    camera.position.copy(headPos).sub(rig.position).applyAxisAngle(THREE.Object3D.DEFAULT_UP, -rig.rotation.y);
    camera.quaternion.copy(headQuat).premultiply(q1.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -rig.rotation.y));
    if (window.__vrtest && window.__vrtest.spectate){
      const s = window.__vrtest.spectate;
      specCam.position.set(...s.pos); specCam.lookAt(...s.look); specCam.aspect = window.innerWidth / window.innerHeight; specCam.updateProjectionMatrix();
      renderer.render(scene, specCam); return;
    }
  }
  renderer.render(scene, camera);
}
const specCam = new THREE.PerspectiveCamera(60, 1, 0.05, 600);
renderer.setAnimationLoop(frame);

function setEyeHeight(h){ eyeHeight = Math.max(1.0, Math.min(2.05, h)); avatar.setScale(eyeHeight); mirrorAvatar.setScale(eyeHeight); }
function calibrateNow(){
  const local = headPos.y - rig.position.y;
  setEyeHeight(local); calib.done = true;
  say(`height set: ${(eyeHeight / 0.93).toFixed(2)} m`); sfx.ui();
}

function updateHolsters(){
  const s = avatar.s;
  const fwd = v1.set(-Math.sin(avatar.bodyYaw), 0, -Math.cos(avatar.bodyYaw)).clone(), right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  m1.makeBasis(right, THREE.Object3D.DEFAULT_UP, fwd.clone().negate());
  for (const h of holsters){
    h.pos.copy(avatar.pelvis).addScaledVector(right, h.side * 0.25 * s).addScaledVector(fwd, 0.03 * s);
    h.pos.y += 0.03 * s;
    h.quat.setFromRotationMatrix(m1);
    h.mesh.position.copy(h.pos); h.mesh.quaternion.copy(h.quat);
  }
}

// The mirror shows a flipped copy of your body and of anything near it.
function updateMirror(){
  const show = mode !== 'title' && headPos.x > M.x && headPos.x < M.x + 4 && Math.abs(headPos.z - M.z) < 2.4;
  mirrorGroup.visible = show;
  if (!show) return;
  mirrorAvatar.copyFrom(avatar);
  const seen = new Set();
  for (const it of items.list){
    const p = it.mesh.position;
    if (!(p.x > M.x && p.x < M.x + 4 && Math.abs(p.z - M.z) < 2.2)) continue;
    let c = mirrorItems.get(it);
    if (!c){ c = it.mesh.clone(); mirrorItems.set(it, c); mirrorGroup.add(c); }
    c.position.copy(p); c.quaternion.copy(it.mesh.quaternion); c.scale.copy(it.mesh.scale); c.visible = true;
    if (it.kind === 'gun'){ c.children[1].position.copy(it.mesh.userData.slide.position); c.children[2].visible = it.mesh.userData.flash.visible; }
    seen.add(it);
  }
  for (const [it, c] of mirrorItems){ if (!seen.has(it)){ if (it.dead){ mirrorGroup.remove(c); mirrorItems.delete(it); } else c.visible = false; } }
}

// ---------- title screen: a slow look round the world behind the menu ----------
let spin = 0;
function titleSpin(dt){
  spin += dt * 0.05;
  camera.position.set(Math.sin(spin) * 3, 2.2, Math.cos(spin) * 3 + 0.5);
  camera.lookAt(Math.sin(spin + 2) * 6, 1.2, Math.cos(spin + 2) * 6 - 2);
  rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0);
  creatures.update(dt, { pos: new THREE.Vector3(0, 0, 50), head: new THREE.Vector3(0, 1.6, 50), speed: 0 });
  villagers.update(dt, { pos: new THREE.Vector3(0, 0, 50), head: new THREE.Vector3(0, 1.6, 50), speed: 0 }, camera.position);
  items.update(dt, [], holsters);
  world.update(dt);
}

// ---------- desktop mode: mouse and keyboard ----------
const keys = {};
const desk = { yaw: 0, pitch: 0, rightGrip: false, leftGrip: false, trigger: false };
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (mode !== 'desktop') return;
  if (e.code === 'KeyE') desk.rightGrip = !desk.rightGrip;
  if (e.code === 'KeyQ') desk.leftGrip = !desk.leftGrip;
  if (e.code === 'Escape' && !document.pointerLockElement) exitDesktop();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('mousemove', (e) => {
  if (mode !== 'desktop' || !document.pointerLockElement) return;
  desk.yaw -= e.movementX * 0.0025; desk.pitch = Math.max(-1.4, Math.min(1.4, desk.pitch - e.movementY * 0.0025));
});
addEventListener('mousedown', (e) => {
  if (mode !== 'desktop') return;
  if (!document.pointerLockElement){ renderer.domElement.requestPointerLock && renderer.domElement.requestPointerLock(); return; }
  if (e.button === 0) desk.trigger = true;
  if (e.button === 2) desk.rightGrip = !desk.rightGrip;
});
addEventListener('mouseup', (e) => { if (e.button === 0) desk.trigger = false; });
addEventListener('contextmenu', (e) => { if (mode === 'desktop') e.preventDefault(); });

function desktopInput(dt){
  const T = window.__vrtest && window.__vrtest.input;   // the headless test drives this
  const kx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0), ky = (keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0);
  if (keys.ArrowLeft) desk.yaw += dt * 1.8; if (keys.ArrowRight) desk.yaw -= dt * 1.8;
  const eye = rig.position.y + (T && T.eye != null ? T.eye : 1.62);
  rig.rotation.y = 0;
  headQuat.setFromEuler(new THREE.Euler(desk.pitch, desk.yaw, 0, 'YXZ'));
  headPos.set(rig.position.x, eye, rig.position.z);
  const offs = [[-0.22, -0.3, -0.42], [0.22, -0.3, -0.42]];
  const handBasis = new THREE.Quaternion().setFromRotationMatrix(m1.makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0.3, 1).normalize(), new THREE.Vector3(0, -1, 0.3).normalize()));
  for (let i = 0; i < 2; i++){
    const h = hands[i];
    h.tracked = true; h.gamepad = null;
    if (T && T.hands && T.hands[i]){
      const th = T.hands[i];
      h.pos.set(...th.pos); h.quat.set(...th.quat);
      h.rayQuat = h.rayQuat || new THREE.Quaternion(); h.rayQuat.copy(th.rayQuat ? new THREE.Quaternion(...th.rayQuat) : h.quat);
      h.trigger = th.trigger || 0; h.squeeze = th.squeeze || 0; h.triggerTouch = !!th.triggerTouch || h.trigger > 0.05; h.thumbTouch = !!th.thumbTouch;
      h.stick.x = th.stick ? th.stick[0] : 0; h.stick.y = th.stick ? th.stick[1] : 0; h.a = !!th.a; h.b = !!th.b; h.stickPress = false;
      continue;
    }
    h.pos.set(...offs[i]).applyQuaternion(headQuat).add(headPos);
    h.quat.copy(headQuat).multiply(handBasis);
    h.rayQuat = h.rayQuat || new THREE.Quaternion(); h.rayQuat.copy(headQuat);
    h.trigger = i === 1 && desk.trigger ? 1 : 0; h.triggerTouch = i === 1;
    h.squeeze = (i === 1 ? desk.rightGrip : desk.leftGrip) ? 1 : 0;
    h.thumbTouch = true;
    h.stick.x = i === 0 ? kx : 0; h.stick.y = i === 0 ? ky : 0;
    h.a = i === 1 && !!keys.Space; h.b = i === 1 && !!keys.KeyR; h.stickPress = i === 0 && !!keys.ShiftLeft && !hands[0].last.sp;
  }
}

// ---------- starting and stopping ----------
async function enterVR(){
  startAudio();
  try {
    const session = await navigator.xr.requestSession('immersive-vr', { requiredFeatures: ['local-floor'], optionalFeatures: ['bounded-floor'] });
    session.addEventListener('end', () => { mode = 'title'; $('title').classList.remove('hidden'); camera.position.set(0, 0, 0); });
    await renderer.xr.setSession(session);
    try { if (session.supportedFrameRates && session.updateTargetFrameRate){ const r = [...session.supportedFrameRates]; if (r.includes(90)) await session.updateTargetFrameRate(90); } } catch (e) {}
    startPlay('vr');
  } catch (e) {
    $('status').textContent = 'Could not start VR: ' + (e && e.message ? e.message : e);
  }
}
function startPlay(m){
  mode = m;
  $('title').classList.add('hidden');
  rig.position.set(0, 0, 1.2); rig.rotation.set(0, 0, 0);
  camera.position.set(0, 0, 0); camera.quaternion.identity();
  calib = { t: 0, n: 0, sum: 0, done: m !== 'vr' };
  player.moveVel.set(0, 0, 0); player.air = false;
  desk.yaw = 0; desk.pitch = -0.15;
  avatar.feet.forEach((f) => { f.init = false; });
  avatar.lastPelvis = null;
  clock.getDelta();
  drawWatch();
}
function startDesktop(){ startAudio(); startPlay('desktop'); }
function exitDesktop(){ mode = 'title'; $('title').classList.remove('hidden'); }

$('enter-vr').addEventListener('click', enterVR);
$('try-desktop').addEventListener('click', startDesktop);
if (navigator.xr && navigator.xr.isSessionSupported){
  navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
    $('enter-vr').disabled = !ok;
    $('status').textContent = ok ? 'Put on the headset and press Enter VR.' : 'No VR headset here. Open this page in the headset’s browser, or try it on screen.';
  }).catch(() => { $('status').textContent = 'VR is not available here.'; });
} else {
  $('enter-vr').disabled = true;
  $('status').textContent = 'This browser has no WebXR. Open this page in the headset’s browser, or try it on screen.';
}

addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// for the headless test
window.__vrtest = {
  get mode(){ return mode; }, items, creatures, villagers, avatar, mirrorAvatar, hands, rig, player, settings, holsters, renderer,
  enterVR, startDesktop, spectate: null, input: null,
  get eyeHeight(){ return eyeHeight; }, get time(){ return gameTime; }, get fps(){ return fps; },
  get head(){ return headPos.toArray(); }, get headQuat(){ return headQuat.toArray(); },
};
