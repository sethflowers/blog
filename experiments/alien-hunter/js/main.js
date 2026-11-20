// Alien Hunter: the main loop. About half the townsfolk are aliens in disguise. Walk round the town
// (in and out of the houses and shops), look at people through your X-ray camera tablet to see what's
// inside them (bones, or a little green alien), and zap the aliens with your Shock Gun.
//  - iPad / computer: first person. Left thumb (or WASD) walks, drag to look, tap (or click) zaps
//    where you tap, 📱 raises the tablet: the middle of the screen becomes the X-ray view.
//  - VR: the tablet is in your left hand (its screen shows what's in front of it, X-rayed), the gun is
//    in your right (pull the trigger). Left stick walks, right stick turns, X/Y opens the menu.
// The X-ray view: the town drawn as glowing see-through edges (one override material), then, over
// it, the insides of people (their own layer, INNER), which nothing else ever draws.
import * as THREE from 'three';
import { V, clamp, damp } from './util.js';
import { Town, START, FLOOR_Y } from './town.js';
import { People, INNER } from './people.js';
import { makeGun, makeTablet, drawStrip, Effects } from './gear.js';
import { ScreenPanel, VRPanel } from './ui.js';
import { startAudio, sfx } from './audio.js';
import { textCanvas, roundRect, wrapText } from './util.js';

// let the loading screen say "Building…" (and draw it) before the town is built
if (window.__loading) await window.__loading();

const $ = (id) => document.getElementById(id);
const VERSION = document.body.dataset.version || '';
const SAVE_KEY = 'alien-hunter-v1';

// ---------- renderer, sky and sun ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x9ad8ff, 1);
renderer.xr.enabled = true; renderer.xr.setReferenceSpaceType('local-floor'); renderer.xr.setFoveation(0.5);
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 900);
const rig = new THREE.Group(); rig.add(camera); scene.add(rig);
const SUN_DIR = V(0.45, 0.75, 0.35).normalize();
scene.fog = new THREE.Fog(0xb8e4ff, 120, 520);
const sky = new THREE.Mesh(new THREE.SphereGeometry(800, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  vertexShader: 'varying vec3 d; void main(){ d = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }',
  fragmentShader: `varying vec3 d;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
    void main(){ vec3 v = normalize(d); float y = max(v.y, 0.0);
      vec3 c = mix(vec3(0.75, 0.9, 1.0), vec3(0.3, 0.6, 1.0), pow(y, 0.6));
      if (v.y > 0.03){ vec2 uv = v.xz / (v.y + 0.15) * 1.1; float k = n(uv) * 0.6 + n(uv * 2.1) * 0.4; c = mix(c, vec3(1.0), step(0.62, k) * smoothstep(0.03, 0.3, v.y)); }
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
    }`,
}));
sky.frustumCulled = false; sky.renderOrder = -1; scene.add(sky);
scene.add(new THREE.HemisphereLight(0xe0f0ff, 0x6a8a4a, 1.5));
const sun = new THREE.DirectionalLight(0xfff6e0, 2.2);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.08;
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 260 });
scene.add(sun, sun.target);

// ---------- the town, its people, your gear ----------
const town = new Town(scene);
const people = new People(scene, town);
const effects = new Effects(scene);
const panel = new ScreenPanel();
const vrPanel = new VRPanel();
scene.add(vrPanel.mesh); vrPanel.mesh.visible = false;

// the X-ray look: every surface as a faint glow, brightest where you see it edge-on, fading with distance
const xrayMat = new THREE.ShaderMaterial({
  uniforms: { col: { value: new THREE.Color('#4ac8ff') }, far: { value: 34 } },
  vertexShader: `#include <common>
    varying vec3 vN; varying vec3 vV;
    void main(){
      #include <beginnormal_vertex>
      #include <defaultnormal_vertex>
      #include <begin_vertex>
      #include <project_vertex>
      vN = normalize(transformedNormal); vV = -mvPosition.xyz;
    }`,
  fragmentShader: `uniform vec3 col; uniform float far; varying vec3 vN; varying vec3 vV;
    void main(){ float d = length(vV); float r = 1.0 - abs(dot(normalize(vN), vV / d));
      float a = (0.05 + pow(r, 2.5) * 0.8) * (1.0 - smoothstep(far * 0.45, far, d));
      gl_FragColor = vec4(col * a, 1.0); }`,
  blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
});
const XRAY_BG = 0x06102a;

// the gun you hold on screen (attached to the camera, bottom right)
const gunScreen = makeGun();
gunScreen.position.set(0.24, -0.25, -0.5); gunScreen.rotation.set(0.04, 0.1, 0);
gunScreen.visible = false; camera.add(gunScreen);
// in VR: the gun in your right hand, the tablet in your left (both along the controllers' pointing rays)
const xrTarget = new THREE.WebGLRenderTarget(512, 320, { samples: 0 });
xrTarget.texture.colorSpace = THREE.SRGBColorSpace;
const gunVR = makeGun(); gunVR.visible = false; scene.add(gunVR);
const tabletVR = makeTablet(xrTarget.texture); tabletVR.visible = false; scene.add(tabletVR);
const tabletCam = new THREE.PerspectiveCamera(46, 512 / 320, 0.05, 80);
const xrayCam = new THREE.PerspectiveCamera();
// a message board above the tablet (VR players can't see the HTML messages)
const board = textCanvas(512, 120);
const boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.063), new THREE.MeshBasicMaterial({ map: board.tex, transparent: true, toneMapped: false }));
boardMesh.position.set(0, 0.155, 0); boardMesh.visible = false; tabletVR.add(boardMesh);
const laser = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 1, 6).translate(0, 0.5, 0).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#8dff5a', transparent: true, opacity: 0.7 }));
laser.visible = false; scene.add(laser);
// hidden while the X-ray view is drawn
// (and so are the ground, roads and floors: seen edge-on they would flood the view with glow)
const NOT_XRAY = [sky, people.fx, gunScreen, gunVR, tabletVR, vrPanel.mesh, laser, ...town.flat];

// ---------- saving ----------
const DEFAULTS = { v: 1, town: 1, score: 0, best: 0, turn: 'snap', welcomed: false, zapped: 0, oops: 0 };
let save = { ...DEFAULTS };
function upgrade(s){ return { ...DEFAULTS, ...s, v: 1 }; }
function load(){ try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (s) save = upgrade(s); return !!s; } catch (e) { return false; } }
function store(){ try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* private browsing */ } }
const hadSave = load();

// ---------- messages ----------
const msgs = [];
function say(text, kind = ''){
  if (msgs.some((m) => m.text === text)) return;
  msgs.push({ text, kind, t: 5 });
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
  g.fillStyle = m.kind === 'bad' ? 'rgba(170,30,40,0.92)' : m.kind === 'good' ? 'rgba(30,120,50,0.92)' : 'rgba(30,18,60,0.92)';
  roundRect(g, 2, 2, 508, 116, 22); g.fill();
  g.fillStyle = '#fff'; g.font = 'bold 30px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const lines = wrapText(g, m.text, 480).slice(0, 3);
  lines.forEach((l, i) => g.fillText(l, 256, 60 + (i - (lines.length - 1) / 2) * 34));
  board.tex.needsUpdate = true;
}

// ---------- a town's worth of aliens ----------
let lvl = { n: 1, count: 0, aliens: 0, t: 0, zapped: 0, oops: 0, done: false, doneT: 0 };
function startTown(n){
  const count = Math.min(24, 10 + 2 * n);
  const aliens = Math.max(2, Math.round(count * (0.42 + Math.random() * 0.16)));
  people.spawn(count, aliens, player.pos, n, (Date.now() ^ (n * 7919)) >>> 0);
  lvl = { n, count, aliens, t: 0, zapped: 0, oops: 0, done: false, doneT: 0 };
  updateHUD(true);
}
people.on('revealed', (p) => {
  if (p.alien){ sfx.alien(); say(`👽 ${p.name} is an ALIEN in disguise! Zap it with your shock gun!`, 'bad'); haptic(1, 0.6, 120); }
  else { sfx.human(); say(`✓ ${p.name} is a real person. Leave them be!`, 'good'); }
});
people.on('zapped', () => sfx.hit());
people.on('killed', (p) => {
  sfx.die(); save.score += 100; save.zapped++; lvl.zapped++;
  effects.puff(V(p.pos.x, p.pos.y + 1.2 * p.look.scale, p.pos.z), '#d8ffc8', 2.2);
  const left = people.aliensLeft;
  say(left ? `Zapped! +100 ⭐  ${left} alien${left > 1 ? 's' : ''} to go.` : 'Zapped! That was the last alien!', 'good');
  haptic(1, 0.8, 200);
  store();
});
people.on('hurt', (p) => {
  sfx.ow(); save.score = Math.max(0, save.score - 50); save.oops++; lvl.oops++;
  say(`Oops! ${p.name} was a real person. −50 ⭐ Scan people before you zap!`, 'bad');
  store();
});
people.on('speak', (p) => { if (Math.hypot(p.pos.x - player.pos.x, p.pos.z - player.pos.z) < 12) sfx.speak(p.alien); });
function checkWin(dt){
  if (lvl.done || mode === 'title'){ if (lvl.done && !lvl.shown){ lvl.doneT -= dt; if (lvl.doneT <= 0){ lvl.shown = true; clearedPanel(); } } return; }
  lvl.t += dt;
  if (people.list.length && people.aliensLeft === 0){
    lvl.done = true; lvl.doneT = 2.2; lvl.shown = false;
    const bonus = lvl.oops ? 0 : 50 * lvl.aliens;
    lvl.bonus = bonus; save.score += bonus; save.best = Math.max(save.best, save.score); save.town = lvl.n + 1; store();
  }
}

// ---------- panels: one description, drawn as HTML on screen or as a floating board in VR ----------
let vrPage = null;
function showPanel(spec){ if (mode === 'vr'){ vrPage = spec; vrs.placePanel = true; vrPanel.show(spec); vrPanel.mesh.visible = vrs.posed; } else panel.show(spec); }
function closePanels(){ panel.close(); vrPage = null; vrPanel.mesh.visible = false; laser.visible = false; }
function howTo(){
  if (mode === 'vr') return [
    'Your X-ray tablet is in your LEFT hand: point it at people. Its screen shows what\'s inside them.',
    'Your shock gun is in your RIGHT hand: pull the trigger to zap.',
    'Left stick walks, right stick turns. X or Y opens the menu, B closes it.',
  ];
  return [
    'Walk with your left thumb (or WASD). Drag anywhere to look round.',
    'Tap 📱 X-Ray (or X) to raise your tablet: hold people in its screen for a moment to see inside them.',
    'Tap ⚡ Zap (or Space) to zap what\'s in the middle, or tap straight on someone.',
    'Doors open when you walk up to them: aliens love to hide indoors!',
  ];
}
function welcome(){
  save.welcomed = true; store();
  showPanel({ title: '👽 Alien Hunter', sections: [
    { text: 'Aliens have sneaked into town dressed up as people. About half the people you meet are aliens in disguise!' },
    { heading: 'How to hunt', list: [...howTo(), 'Bones inside? A real person. A little green alien inside? Zap it!'] },
    { buttons: [{ label: 'Let\'s go!', kind: 'primary', go: () => { closePanels(); sfx.click(); } }] },
  ] });
}
function menu(){
  showPanel({ title: '☰ Menu', money: 'v' + VERSION, sections: [
    { text: `Town ${lvl.n} · ${people.aliensLeft} of ${lvl.aliens} aliens left · ⭐ ${save.score} (best ${save.best})` },
    { buttons: [{ label: '▶ Keep hunting', kind: 'primary', go: closePanels }, { label: '❓ How to play', go: () => showPanel({ title: '❓ How to play', sections: [{ list: howTo() }, { buttons: [{ label: 'OK', kind: 'primary', go: closePanels }] }] }) }] },
    ...(mode === 'vr' ? [{ heading: 'Turning', buttons: [{ label: 'Snap turn', on: save.turn === 'snap', go: () => { save.turn = 'snap'; store(); menu(); } }, { label: 'Smooth turn', on: save.turn === 'smooth', go: () => { save.turn = 'smooth'; store(); menu(); } }] }] : []),
    { buttons: [{ label: '🔄 Restart this town', go: () => { closePanels(); standAt(START); startTown(lvl.n); say(`Town ${lvl.n} again: ${lvl.aliens} aliens are hiding. Find them!`); } }, { label: '🏠 Title screen', kind: 'danger', go: () => { closePanels(); toTitle(); } }] },
  ] });
}
function clearedPanel(){
  sfx.win();
  const mm = Math.floor(lvl.t / 60), ss = Math.floor(lvl.t % 60);
  showPanel({ title: '🎉 Town cleared!', money: '⭐ ' + save.score, sections: [
    { text: `You found and zapped all ${lvl.aliens} aliens in town ${lvl.n} in ${mm}:${String(ss).padStart(2, '0')}.` },
    { list: [`👽 Aliens zapped: ${lvl.zapped}`, `😬 Real people zapped by mistake: ${lvl.oops}`, lvl.bonus ? `✨ No-mistakes bonus: +${lvl.bonus} ⭐` : 'No bonus this time: scan people before you zap them!', `🏆 Best score: ${save.best}`] },
    { text: `More aliens are landing in the next town (${Math.min(24, 10 + 2 * (lvl.n + 1))} people to check).` },
    { buttons: [{ label: 'Next town ▶', kind: 'primary', go: nextTown }] },
  ] });
}
function nextTown(){ closePanels(); sfx.click(); standAt(START); startTown(lvl.n + 1); say(`Town ${lvl.n}: ${lvl.aliens} aliens are hiding among ${lvl.count} people. Go get them!`); }

// ---------- you ----------
const EYE = 1.6, WALK = 3.0, RUN = 5.6;
const player = { pos: V(START.x, 0, START.z), yaw: START.yaw, pitch: 0, eyeY: EYE };
function standAt(s){
  player.pos.set(s.x, town.groundAt(s.x, s.z), s.z); player.yaw = s.yaw ?? player.yaw; player.pitch = 0; player.eyeY = player.pos.y + EYE;
  if (mode === 'vr') vrPlace(player.pos, player.yaw);
}
// people push you out of the way first, then walls (so nobody pins you against a wall); if you've
// been pushing without getting anywhere for half a second, you slip past people
const stuck = { t: 0, slip: 0 };
function bump(p, low){
  if (stuck.slip <= 0) for (const q of people.list){
    if (q.dead) continue;
    const r = 0.3 + 0.24 * q.look.wide * q.look.scale, dx = p.x - q.pos.x, dz = p.z - q.pos.z, d2 = dx * dx + dz * dz;
    if (d2 < r * r && d2 > 1e-6){ const d = Math.sqrt(d2); p.x = q.pos.x + dx / d * r; p.z = q.pos.z + dz / d * r; }
  }
  town.collide(p, 0.3, low);
}
function moveAndBump(p, dx, dz, low, dt){
  const x0 = p.x, z0 = p.z;
  p.x += dx; p.z += dz;
  bump(p, low);
  const want = Math.hypot(dx, dz), got = Math.hypot(p.x - x0, p.z - z0);
  stuck.slip -= dt;
  if (want > 1e-4 && got < want * 0.3){ stuck.t += dt; if (stuck.t > 0.5){ stuck.slip = 0.8; stuck.t = 0; } } else stuck.t = 0;
}
function walk(dt, mx, my, run){
  const l = Math.hypot(mx, my); if (l > 1){ mx /= l; my /= l; }
  if (l < 0.05) return;
  const sp = (run || l > 0.95 ? RUN : WALK) * dt;
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  moveAndBump(player.pos, fx * -my * sp + -fz * mx * sp, fz * -my * sp + fx * mx * sp, true, dt);
}

// ---------- the shock gun ----------
let cool = 0;
function zap(o, d, from, gun){
  if (cool > 0 || mode === 'title') return null;
  cool = 0.32; startAudio(); sfx.zap();
  gun.userData.kick = 1;
  const far = town.rayWall(o, d, 60);
  const hit = people.rayHit(o, d, far);
  const end = o.clone().addScaledVector(d, hit ? hit.t : far);
  if (hit) end.y = Math.max(end.y, hit.p.pos.y + 0.4);
  effects.fire(from, end, !!hit);
  if (hit) people.zap(hit.p);
  haptic(1, 0.5, 60);
  return hit ? hit.p : null;
}
const raycaster = new THREE.Raycaster();
function zapScreen(x, y){
  camera.updateMatrixWorld(true);
  raycaster.setFromCamera(new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1), camera);
  return zap(raycaster.ray.origin.clone(), raycaster.ray.direction.clone(), gunScreen.userData.muzzle.getWorldPosition(V()), gunScreen);
}
function updateGun(g, dt){
  const U = g.userData;
  U.kick = Math.max(0, U.kick - dt * 6);
  U.tip.scale.setScalar(1 + U.kick * 0.8 + Math.sin(gameTime * 9) * 0.08);
  return U.kick;
}

// ---------- the X-ray tablet ----------
let xrayOn = false, xrRect = null, scanBeep = 0, hintXray = false;
const scanState = { progress: 0, seen: 0, focus: null };
function toggleXray(on = !xrayOn){
  xrayOn = on; startAudio(); sfx.click();
  document.body.classList.toggle('xray', xrayOn);
  $('b-xray').classList.toggle('on', xrayOn);
  measureXray();
  if (xrayOn && !hintXray){ hintXray = true; say('Hold people in the X-ray screen for a moment to see what\'s inside them.'); }
}
function measureXray(){
  const r = $('xr-screen').getBoundingClientRect();
  if (!r.width) return;
  xrRect = { x: r.left, y: innerHeight - r.bottom, w: r.width, h: r.height,
    ndc: [r.left / innerWidth * 2 - 1, 1 - r.bottom / innerHeight * 2, r.right / innerWidth * 2 - 1, 1 - r.top / innerHeight * 2] };
}
// draw the X-ray view with camera `cam` into whatever is set up (target, scissor), already cleared
function drawXray(cam){
  const vis = NOT_XRAY.map((o) => o.visible);
  for (const o of NOT_XRAY) o.visible = false;
  // name tags and the bolt are only drawn over the X-ray, not as glowing outlines in it
  const tags = people.list.filter((p) => p.tag && p.tag.visible).map((p) => p.tag);
  tags.push(effects.group);
  renderer.shadowMap.autoUpdate = false;
  const auto = renderer.autoClear; renderer.autoClear = false;
  const fog = scene.fog; scene.fog = null;
  cam.layers.set(0); scene.overrideMaterial = xrayMat;
  for (const t of tags) t.visible = false;
  renderer.render(scene, cam);
  scene.overrideMaterial = null;
  for (const t of tags) t.visible = true;
  renderer.clearDepth();
  cam.layers.set(INNER);
  renderer.render(scene, cam);
  cam.layers.set(0);
  scene.fog = fog; renderer.autoClear = auto; renderer.shadowMap.autoUpdate = true;
  NOT_XRAY.forEach((o, i) => { o.visible = vis[i]; });
}
function syncXrayCam(){
  camera.updateMatrixWorld(true);
  camera.matrixWorld.decompose(xrayCam.position, xrayCam.quaternion, xrayCam.scale);
  xrayCam.fov = camera.fov; xrayCam.aspect = camera.aspect; xrayCam.near = 0.1; xrayCam.far = 120; xrayCam.updateProjectionMatrix(); xrayCam.updateMatrixWorld(true);
}
function renderScreenXray(){
  if (!xrRect) measureXray();
  if (!xrRect) return;
  syncXrayCam();
  renderer.setScissorTest(true); renderer.setScissor(xrRect.x, xrRect.y, xrRect.w, xrRect.h);
  renderer.setClearColor(XRAY_BG, 1); renderer.clear(true, true, false);
  drawXray(xrayCam);
  renderer.setScissorTest(false); renderer.setClearColor(0x9ad8ff, 1);
}
function renderTabletXray(){
  const rt = renderer.getRenderTarget();
  renderer.xr.enabled = false;
  renderer.setRenderTarget(xrTarget); renderer.setClearColor(XRAY_BG, 1); renderer.clear(true, true, false);
  drawXray(tabletCam);
  renderer.setRenderTarget(rt); renderer.setClearColor(0x9ad8ff, 1);
  renderer.xr.enabled = true;
}
function scanUI(){
  // what the tablet says: scanning someone, or what the person you're pointing at is
  const S = scanState, f = S.focus;
  let text, cls = '';
  if (S.progress > 0){ text = `Scanning… ${Math.round(S.progress * 100)}%`; }
  else if (f){ text = f.alien ? `👽 ${f.name}: ALIEN!` : `✓ ${f.name}: human`; cls = f.alien ? 'bad' : 'good'; }
  else text = 'Point me at people';
  return { text, cls };
}

// ---------- screen input: a thumb stick, drag to look, tap to zap ----------
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
  player.yaw -= dx * k; player.pitch = clamp(player.pitch - dy * k, -1.2, 1.2);
});
function releaseStick(){ touch.stickId = null; touch.stick = null; stick.x = stick.y = 0; stickEl.classList.remove('on'); knobEl.style.transform = ''; }
renderer.domElement.addEventListener('pointerup', (e) => {
  if (e.pointerId === touch.stickId){ releaseStick(); return; }
  const L = touch.look.get(e.pointerId); if (!L) return;
  touch.look.delete(e.pointerId);
  if (mode === 'screen' && L.moved < 12 && performance.now() - L.t < 450 && !panel.open) zapScreen(e.clientX, e.clientY);
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
  if (e.code === 'KeyX' || e.code === 'Tab'){ e.preventDefault(); toggleXray(); }
  if (e.code === 'Space' || e.code === 'Enter'){ e.preventDefault(); zapScreen(innerWidth / 2, innerHeight / 2); }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
const press = (id, fn) => $(id).addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); startAudio(); fn(); });
press('b-zap', () => zapScreen(innerWidth / 2, innerHeight / 2));
press('b-xray', () => toggleXray());
press('b-menu', () => { sfx.click(); menu(); });

// ---------- the screen camera ----------
const orbit = { a: 0 };
function placeScreenCamera(dt){
  rig.position.set(0, 0, 0); rig.quaternion.identity();
  if (mode === 'title'){
    const a = orbit.a;
    camera.position.set(Math.sin(a) * 34, 15, Math.cos(a) * 34 + 4);
    camera.lookAt(0, 1.5, 0);
  } else {
    player.eyeY = damp(player.eyeY, player.pos.y + EYE, 14, dt);
    camera.position.set(player.pos.x, player.eyeY, player.pos.z);
    camera.quaternion.setFromEuler(new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ'));
  }
  camera.updateMatrixWorld(true);
}

// ---------- VR ----------
function makeVRHand(i){
  return { i, side: i ? 'right' : 'left', tracked: false, rayPos: V(), rayQuat: new THREE.Quaternion(),
    trigger: 0, stick: { x: 0, y: 0 }, a: false, b: false, last: {}, gamepad: null,
    haptic(v, ms){ const g = this.gamepad; try { if (g && g.hapticActuators && g.hapticActuators[0]) g.hapticActuators[0].pulse(v, ms); } catch (e) { /* no rumble */ } } };
}
const vr = [makeVRHand(0), makeVRHand(1)];
const rays = [renderer.xr.getController(0), renderer.xr.getController(1)];
const sources = [null, null];
for (let i = 0; i < 2; i++){ rig.add(rays[i]); rays[i].addEventListener('connected', (e) => { sources[i] = e.data; }); rays[i].addEventListener('disconnected', () => { sources[i] = null; }); }
const headPos = V(), headQuat = new THREE.Quaternion(), v1 = V();
const vrs = { posed: false, frames: 0, snapReady: true, pending: null, placePanel: false, frame: 0, groundY: 0 };
function haptic(hand, v, ms){ if (mode === 'vr') vr[hand].haptic(v, ms); }
function readVR(){
  for (const h of vr){
    const idx = sources.findIndex((s) => s && s.handedness === h.side);
    const src = idx >= 0 ? sources[idx] : null, g = src && src.gamepad;
    h.gamepad = g || null;
    h.tracked = !!(src && rays[idx].visible);
    if (h.tracked){ rays[idx].updateMatrixWorld(true); rays[idx].matrixWorld.decompose(h.rayPos, h.rayQuat, v1); }
    const B = (k) => (g && g.buttons[k]) || { value: 0, pressed: false };
    h.trigger = B(0).value; h.a = B(4).pressed; h.b = B(5).pressed;
    const ax = g ? g.axes : [];
    h.stick.x = ax.length >= 4 ? ax[2] : (ax[0] || 0); h.stick.y = ax.length >= 4 ? ax[3] : (ax[1] || 0);
    const L = h.last;
    h.triggerDown = h.trigger > 0.7 && !L.t; h.aDown = h.a && !L.a; h.bDown = h.b && !L.b;
    L.t = h.trigger > 0.7 ? true : h.trigger < 0.4 ? false : L.t; L.a = h.a; L.b = h.b;
  }
}
const TABLET_OFF = V(0, 0.05, -0.1), TABLET_TILT = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.35, 0, 0));
function vrUpdate(dt){
  readVR();
  const L = vr[0], R = vr[1];
  // the tablet in your left hand, its camera looking where the controller points
  tabletVR.visible = L.tracked;
  if (L.tracked){
    tabletVR.position.copy(TABLET_OFF).applyQuaternion(L.rayQuat).add(L.rayPos);
    tabletVR.quaternion.copy(L.rayQuat).multiply(TABLET_TILT);
    tabletCam.position.copy(tabletVR.position).addScaledVector(V(0, 0, -1).applyQuaternion(L.rayQuat), 0.03);
    tabletCam.quaternion.copy(L.rayQuat); tabletCam.updateMatrixWorld(true);
  }
  gunVR.visible = R.tracked;
  if (R.tracked){
    gunVR.position.copy(V(0, -0.01, 0.06).applyQuaternion(R.rayQuat)).add(R.rayPos);
    gunVR.quaternion.copy(R.rayQuat);
    const k = updateGun(gunVR, dt); gunVR.position.addScaledVector(V(0, 0, 1).applyQuaternion(R.rayQuat), k * 0.03);
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
    if (R.tracked){
      const dir = V(0, 0, -1).applyQuaternion(R.rayQuat);
      vrPanel.mesh.updateMatrixWorld(true);
      const hit = vrPanel.ray(R.rayPos, dir, R.triggerDown, 4);
      if (hit){
        onPanel = true; laser.visible = true;
        laser.position.copy(R.rayPos); laser.lookAt(hit.point); laser.scale.set(1, 1, R.rayPos.distanceTo(hit.point));
        if (hit.clicked){ R.haptic(0.3, 30); sfx.click(); if (vrPage) vrPanel.show(vrPage); }
      }
      if (Math.abs(R.stick.y) > 0.3 && hit) vrPanel.scrollBy(R.stick.y * dt * 900);
    }
    if (R.bDown || L.bDown){ closePanels(); return; }
  } else if (L.aDown || L.bDown){ menu(); return; }
  if (!onPanel && R.triggerDown && R.tracked){
    const dir = V(0, 0, -1).applyQuaternion(R.rayQuat);
    zap(R.rayPos.clone(), dir, gunVR.userData.muzzle.getWorldPosition(V()), gunVR);
  }
  // turning: snap or smooth (a setting)
  const sx = onPanel ? 0 : R.stick.x;
  if (save.turn === 'smooth'){ if (Math.abs(sx) > 0.2) turnRig(-sx * dt * 2.2); }
  else {
    if (Math.abs(sx) > 0.7 && vrs.snapReady){ turnRig(-Math.sign(sx) * Math.PI / 6); vrs.snapReady = false; }
    if (Math.abs(sx) < 0.35) vrs.snapReady = true;
  }
  // walking where you look; walls stop you (and your real head), furniture only stops the stick
  let mx = L.stick.x, my = L.stick.y; if (Math.hypot(mx, my) < 0.15){ mx = 0; my = 0; }
  const want = V(headPos.x, 0, headPos.z);
  let dx = 0, dz = 0;
  if (mx || my){
    const f = V(0, 0, -1).applyQuaternion(headQuat); f.y = 0; f.normalize();
    const sp = (Math.hypot(mx, my) > 0.95 ? RUN * 0.8 : WALK * 0.8) * dt;
    dx = f.x * -my * sp - f.z * mx * sp; dz = f.z * -my * sp + f.x * mx * sp;
  }
  moveAndBump(want, dx, dz, !!(mx || my), dt);
  rig.position.x += want.x - headPos.x; rig.position.z += want.z - headPos.z;
  vrs.groundY = damp(vrs.groundY, town.groundAt(want.x, want.z), 10, dt);
  rig.position.y = vrs.groundY;
  player.pos.set(want.x, vrs.groundY, want.z);
  player.yaw = new THREE.Euler().setFromQuaternion(headQuat, 'YXZ').y;
  // the tablet's strip: the scan, aliens left, the score and the version
  const ui = scanUI();
  drawStrip(tabletVR, ui.text, `👽${people.aliensLeft} ⭐${save.score} v${VERSION}`, scanState.progress, ui.cls);
}
function turnRig(a){ v1.copy(headPos); rig.position.sub(v1).applyAxisAngle(V(0, 1, 0), a).add(v1); rig.rotation.y += a; rig.updateMatrixWorld(true); }
// stand the play space so your head is over p, facing yaw; not before the headset has a real pose
function vrPlace(p, yaw){
  if (!vrs.posed){ vrs.pending = { p: p.clone(), yaw }; return; }
  const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  const ry = yaw - e.y;
  rig.quaternion.setFromEuler(new THREE.Euler(0, ry, 0, 'YXZ'));
  const local = V(camera.position.x, 0, camera.position.z).applyQuaternion(rig.quaternion);
  vrs.groundY = town.groundAt(p.x, p.z);
  rig.position.set(p.x - local.x, vrs.groundY, p.z - local.z);
  rig.updateMatrixWorld(true);
}

// ---------- the loop ----------
const clock = new THREE.Clock();
let mode = 'title', gameTime = 0, hudT = 0, saveT = 0;
const doorWho = [];
function frame(){ try { step(); } catch (e) { console.error(e); } }
function step(){
  const dt = Math.min(clock.getDelta(), 1 / 20);
  const T = window.__ah, steps = T && T.timeScale > 1 ? Math.round(T.timeScale) : 1;
  for (let k = 0; k < steps; k++) simulate(dt);
  if (T && T.noRender && mode !== 'vr') return;     // (a headset only sends its next frame once this one is drawn)
  render();
}
function render(){
  if (mode === 'vr'){
    if (vrs.posed && tabletVR.visible && (vrs.frame++ % 2 === 0)) renderTabletXray();
    renderer.render(scene, camera);
    return;
  }
  renderer.render(scene, camera);
  if (mode === 'screen' && xrayOn) renderScreenXray();
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
    if (mode === 'title') orbit.a += dt * 0.05;
    if (mode === 'screen' && !panel.open){
      const k = (c) => (keys[c] ? 1 : 0);
      walk(dt, stick.x + k('KeyD') - k('KeyA'), stick.y + k('KeyS') - k('KeyW'), keys.ShiftLeft || keys.ShiftRight);
      player.yaw += (k('ArrowLeft') - k('ArrowRight')) * dt * 2;
      player.pitch = clamp(player.pitch + (k('ArrowUp') - k('ArrowDown')) * dt * 1.5, -1.2, 1.2);
      player.pos.y = town.groundAt(player.pos.x, player.pos.z);
    }
    placeScreenCamera(dt);
    headPos.copy(camera.position);
    gunScreen.visible = mode === 'screen';
    if (mode === 'screen'){ const k = updateGun(gunScreen, dt); gunScreen.position.z = -0.5 + k * 0.05; gunScreen.rotation.x = 0.04 + k * 0.25; }
  }
  cool -= dt;
  // townsfolk, and the doors they (and you) walk through
  people.update(dt, mode === 'title' ? { x: 999, z: 999 } : player.pos);
  doorWho.length = 0; doorWho.push(player.pos); for (const p of people.list) if (!p.dead) doorWho.push(p.pos);
  town.updateDoors(dt, doorWho);
  // the X-ray scan
  scanState.progress = 0; scanState.seen = 0; scanState.focus = null;
  if (mode === 'screen' && xrayOn){ syncXrayCam(); if (!xrRect) measureXray(); if (xrRect) Object.assign(scanState, people.scan(dt, xrayCam, xrRect.ndc)); }
  if (mode === 'vr' && vrs.posed && tabletVR.visible) Object.assign(scanState, people.scan(dt, tabletCam, [-0.92, -0.92, 0.92, 0.92]));
  if (scanState.progress > 0){ scanBeep -= dt; if (scanBeep <= 0){ scanBeep = 0.16; sfx.beep(scanState.progress); } }
  effects.update(dt);
  checkWin(dt);
  // the sun's shadows follow you
  const focus = mode === 'title' ? V(0, 0, 0) : player.pos;
  sun.target.position.set(Math.round(focus.x), 0, Math.round(focus.z));
  sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 120);
  sky.position.copy(headPos);
  for (const m of msgs) m.t -= dt;
  if (msgs.length && msgs[0].t <= 0){ while (msgs.length && msgs[0].t <= 0) msgs.shift(); drawMsgs(); drawBoard(); }
  hudT -= dt; if (hudT <= 0){ hudT = 0.25; updateHUD(); }
  if (mode === 'screen' && xrayOn) updateScanHUD();
  saveT += dt; if (saveT > 20 && mode !== 'title'){ saveT = 0; store(); }
}
renderer.setAnimationLoop(frame);

// ---------- HUD (only what changed is redrawn) ----------
const hudLast = {};
function setHTML(id, html){ if (hudLast[id] !== html){ hudLast[id] = html; $(id).innerHTML = html; } }
function updateHUD(force){
  if (mode !== 'screen' && !force) return;
  const left = people.aliensLeft, unscanned = people.list.filter((p) => !p.revealed && !p.dead).length;
  setHTML('h-town', `🏘 Town <b>${lvl.n}</b> &nbsp;⭐ <b>${save.score}</b>`);
  setHTML('h-info', `👽 <b>${left}</b> of ${lvl.aliens} aliens left<br>🔎 <b>${unscanned}</b> ${unscanned === 1 ? 'person' : 'people'} not scanned`);
}
function updateScanHUD(){
  const ui = scanUI();
  setHTML('xr-text', ui.text);
  const w = Math.round(scanState.progress * 100) + '%';
  if (hudLast.fill !== w){ hudLast.fill = w; $('xr-fill').style.width = w; }
  if (hudLast.cls !== ui.cls){ hudLast.cls = ui.cls; $('xr-bar').className = ui.cls; }
}

// ---------- title screen, starting and stopping ----------
function toTitle(){
  if (renderer.xr.isPresenting) renderer.xr.getSession().end();
  store(); closePanels();
  mode = 'title'; $('title').classList.remove('hidden'); document.body.classList.remove('playing');
  if (xrayOn) toggleXray(false);
  refreshTitle();
}
function refreshTitle(){
  $('b-new').style.display = hadSave || save.town > 1 || save.score > 0 ? '' : 'none';
  $('b-play').textContent = save.town > 1 ? `Play (town ${save.town})` : 'Play';
}
function ensureGame(newOne){
  if (newOne){ const turn = save.turn; save = { ...DEFAULTS, turn }; store(); }
  standAt(START);
  startTown(save.town);
}
function startScreen(newOne){
  startAudio(); ensureGame(newOne);
  mode = 'screen'; $('title').classList.add('hidden'); document.body.classList.add('playing');
  clock.getDelta(); updateHUD(true); measureXray();
  if (!save.welcomed) welcome();
  else say(`Town ${lvl.n}: ${lvl.aliens} aliens are hiding among ${lvl.count} people. Tap 📱 X-Ray to start scanning!`);
}
async function startVR(newOne){
  startAudio();
  try {
    const session = await navigator.xr.requestSession('immersive-vr', { requiredFeatures: ['local-floor'] });
    session.addEventListener('end', () => {
      if (mode !== 'vr') return;
      mode = 'title'; $('title').classList.remove('hidden'); document.body.classList.remove('playing');
      camera.position.set(0, 0, 0); camera.quaternion.identity(); rig.position.set(0, 0, 0); rig.quaternion.identity();
      tabletVR.visible = gunVR.visible = laser.visible = boardMesh.visible = false; closePanels();
      sun.shadow.mapSize.set(2048, 2048); if (sun.shadow.map){ sun.shadow.map.dispose(); sun.shadow.map = null; }
      store(); refreshTitle();
    });
    // smaller shadows in a headset
    sun.shadow.mapSize.set(1024, 1024); if (sun.shadow.map){ sun.shadow.map.dispose(); sun.shadow.map = null; }
    if (window.__ah && window.__ah.xrScale) renderer.xr.setFramebufferScaleFactor(window.__ah.xrScale);
    await renderer.xr.setSession(session);
    try { if (session.supportedFrameRates && session.updateTargetFrameRate){ const r = [...session.supportedFrameRates]; if (r.includes(72)) await session.updateTargetFrameRate(72); } } catch (e) { /* keep the default rate */ }
    mode = 'vr'; $('title').classList.add('hidden'); gunScreen.visible = false;
    vrs.posed = false; vrs.frames = 0; vrPage = null;
    camera.position.set(0, 1.6, 0); camera.quaternion.identity();
    clock.getDelta();
    if (xrayOn) toggleXray(false);
    ensureGame(newOne);
    if (!save.welcomed) welcome();
    else say(`Town ${lvl.n}: ${lvl.aliens} aliens are hiding among ${lvl.count} people. Point your tablet at people!`);
  } catch (e) { $('status').textContent = 'Could not start VR: ' + (e && e.message ? e.message : e); }
}
$('b-play').onclick = () => startScreen(false);
$('b-vr').onclick = () => startVR(false);
$('b-new').onclick = () => {
  if ((save.town > 1 || save.score > 0) && !confirm('Start again from the first town? Your score goes back to 0.')) return;
  if (navigator.xr && $('b-vr').dataset.ok === '1' && confirm('Play in VR? (Cancel to play on this screen.)')) startVR(true); else startScreen(true);
};
// the town behind the title, with people walking about
startTown(save.town);
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
  const name = 'alien-hunter-' + VERSION;
  for (let i = 0; i < 120; i++){
    try {
      if (await caches.has(name) && await (await caches.open(name)).match('/experiments/alien-hunter/__offline-ready__')){ $('offline').textContent = '✓ Saved on this device: plays offline'; return; }
    } catch (e) { return; }
    await new Promise((r) => setTimeout(r, 1500));
  }
})();
addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  measureXray();
});
addEventListener('pagehide', () => { if (mode !== 'title') store(); });

// ---------- for the headless test ----------
// advance: run the game forward without drawing (until cond() is true, if given)
function advance(sec, cond){
  const dt = 1 / 20;
  for (let t = 0; t < sec; t += dt){ simulate(dt); if (cond && cond()) return true; }
  return cond ? !!cond() : true;
}
// look straight at a person (or a point) from where you stand
function aimAt(p){
  const tx = p.pos ? p.pos.x : p.x, tz = p.pos ? p.pos.z : p.z, ty = p.pos ? p.pos.y + 1.1 * p.look.scale : p.y;
  const dx = tx - player.pos.x, dz = tz - player.pos.z, dy = ty - (player.pos.y + EYE);
  player.yaw = Math.atan2(-dx, -dz); player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  placeScreenCamera(1);
}
window.__ah = {
  get mode(){ return mode; }, get lvl(){ return lvl; }, get save(){ return save; }, get xrayOn(){ return xrayOn; }, get time(){ return gameTime; },
  get head(){ return headPos.toArray(); }, get vrPage(){ return vrPage; }, get scan(){ return scanState; },
  town, people, effects, player, renderer, camera, scene, rig, vr, vrs, vrPanel, panel, tabletVR, gunVR, stick, keys,
  timeScale: 1, noRender: false, version: VERSION, START, FLOOR_Y,
  startScreen, startVR, toTitle, startTown, nextTown, toggleXray, zapScreen, zap, aimAt, standAt, menu, welcome, closePanels, advance,
  renderNow(){ if (mode !== 'vr') placeScreenCamera(1 / 60); render(); },
};
void sfx;

// the game is ready: hide the loading screen
if (window.__loaded) window.__loaded();
