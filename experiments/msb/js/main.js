// MSB (Make · Sell · Buy): your own art gallery, in first person.
//  - Make: take a photo with the device's real camera (📷), edit it (crop, filters, adjustments,
//    drawing, stickers, words, frame), and it becomes an artwork in My Art.
//  - Sell: sell it to the dealer straight away, or hang it on a wall: visitors wander in, look at the
//    pictures and offer to buy the ones they like.
//  - Buy: the Art Market desk sells paintings by other artists (hang them, sell them on), frames,
//    decorations that bring more visitors, and the east wing.
//  On an iPad: left thumb walks, drag to look, tap things. Computer: WASD, drag, click.
//  In VR: left stick walks, right stick turns; the camera is in your right hand (A takes it out,
//  trigger takes the picture); point and pull the trigger at things; X opens the menu, B closes.
import * as THREE from 'three';
import { V, clamp, damp, textCanvas, roundRect, wrapText, fmtMoney } from './util.js';
import { Gallery, START, FRAMES, DECOR, DESK } from './gallery.js';
import { Visitors } from './visitors.js';
import { loadPeople } from './people.js';
import { ScreenPanel, VRPanel } from './ui.js';
import { startAudio, sfx } from './audio.js';
import { cam, startCamera, stopCamera, flipCamera, snap, cameraSupported, setZoom } from './camera.js';
import { EditSession, HtmlEditor, vrEditorSpec } from './editor-ui.js';
import { putPicture, delPicture, pictureOf, thumbOf, appraise, nameFor, marketPiece, STAR_NAMES, starText, forgetPicture } from './art.js';

// let the loading screen say "Building…" (and draw it) before the gallery is built
if (window.__loading) await window.__loading();

const $ = (id) => document.getElementById(id);
const VERSION = document.body.dataset.version || '';
const SAVE_KEY = 'msb-v1';

// ---------- renderer, lights ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
// filmic tone mapping: bright sunlight and dim corners in one picture, like a camera sees them
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.25;
renderer.setClearColor(0x9ad0f5, 1);
renderer.xr.enabled = true; renderer.xr.setReferenceSpaceType('local-floor'); renderer.xr.setFoveation(0.5);
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
// the sky: blue fading to pale at the horizon, with soft clouds (a shader on a big sphere that follows you)
const sky = new THREE.Mesh(new THREE.SphereGeometry(350, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  vertexShader: 'varying vec3 d; void main(){ d = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }',
  fragmentShader: `varying vec3 d;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
    void main(){ vec3 v = normalize(d); float y = max(v.y, 0.0);
      vec3 c = mix(vec3(0.82, 0.9, 0.97), vec3(0.32, 0.58, 0.92), pow(y, 0.55));
      if (v.y > 0.02){ vec2 uv = v.xz / (v.y + 0.12) * 1.3; float k = n(uv) * 0.5 + n(uv * 2.3) * 0.3 + n(uv * 5.1) * 0.2;
        c = mix(c, vec3(1.0), smoothstep(0.55, 0.78, k) * smoothstep(0.02, 0.25, v.y) * 0.9); }
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
    }`,
}));
sky.frustumCulled = false; sky.renderOrder = -1; scene.add(sky);
scene.fog = new THREE.Fog(0xc8dcec, 70, 330);
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 400);
const rig = new THREE.Group(); rig.add(camera); scene.add(rig);
// light: the sun (through the skylights and windows: the ceiling and walls cast shadows), a little
// sky light, and the room's own light bouncing about (scene.environment, below)
const hemi = new THREE.HemisphereLight(0xdfeeff, 0xb89a78, 0.8); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d8, 3.4);
const SUN_DIR = V(0.32, 1, 0.42).normalize();
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.05;
Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 80 });
sun.position.copy(SUN_DIR).multiplyScalar(40).add(V(6, 0, 4)); sun.target.position.set(6, 0, 4);
scene.add(sun, sun.target);

// ---------- the gallery, visitors, panels ----------
const gallery = new Gallery(scene);
// walls, ceilings and floors don't cast shadows (the light comes through the skylights)
const NO_SHADOW = ['skylight', 'lamp', 'glass', 'wains-white', 'wains-green', 'wains-navy', 'wains-red', 'rail', 'skirt',
  'floor', 'plaza', 'grass', 'asphalt', 'concrete', 'curb', 'road-paint', 'mat', 'soil'];
gallery.root.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && NO_SHADOW.includes(o.material.name)) o.castShadow = false; });
// the room's own light: a blurred picture of the gallery seen from the middle, made once and used as the
// light that bounces off everything (and the floor's reflections). Twice, so light bounces twice.
{
  const pm = new THREE.PMREMGenerator(renderer);
  let env = null;
  for (let k = 0; k < 2; k++){
    const e = pm.fromScene(scene, 0.04, 0.1, 400, { size: 128, position: new THREE.Vector3(0, 1.7, 5) });
    if (env) env.dispose(); env = e; scene.environment = env.texture; scene.environmentIntensity = 1.0;
  }
  pm.dispose();
}
// the people: realistic models if they load (the simple built-in ones otherwise)
let peopleKinds = null;
try { peopleKinds = await loadPeople(); } catch (e) { console.warn('people models did not load, using simple ones', e); }
const visitors = new Visitors(scene, gallery, peopleKinds);
const panel = new ScreenPanel();
const vrPanel = new VRPanel();
scene.add(vrPanel.mesh); vrPanel.mesh.visible = false;
const editor = new HtmlEditor();

// ---------- the camera you carry (on screen at the bottom right; in VR in your right hand) ----------
function makeCamera(){
  const g = new THREE.Group();
  const body = new THREE.MeshLambertMaterial({ color: '#2a2a30' }), trim = new THREE.MeshLambertMaterial({ color: '#c8c8d0' }), red = new THREE.MeshLambertMaterial({ color: '#e0303a' });
  const add = (geo, m, x, y, z, rx = 0) => { const k = new THREE.Mesh(geo, m); k.position.set(x, y, z); k.rotation.x = rx; g.add(k); return k; };
  add(new THREE.BoxGeometry(0.13, 0.085, 0.05), body, 0, 0, 0);
  add(new THREE.BoxGeometry(0.135, 0.02, 0.052), trim, 0, 0.035, 0);
  add(new THREE.CylinderGeometry(0.03, 0.033, 0.045, 20), trim, 0.01, -0.002, -0.045, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 20), new THREE.MeshBasicMaterial({ color: '#101820' }), 0.01, -0.002, -0.07, Math.PI / 2);
  add(new THREE.BoxGeometry(0.03, 0.012, 0.02), red, -0.04, 0.05, 0);
  add(new THREE.BoxGeometry(0.025, 0.016, 0.006), new THREE.MeshBasicMaterial({ color: '#fffbe0' }), -0.035, 0.022, -0.026);
  // the screen on the back: what the camera sees
  const scr = add(new THREE.PlaneGeometry(0.1, 0.066), new THREE.MeshBasicMaterial({ color: '#000', toneMapped: false }), 0, -0.004, 0.0265);
  g.userData.screen = scr;
  return g;
}
const camScreen = makeCamera();
camScreen.position.set(0.25, -0.2, -0.46); camScreen.rotation.set(0.25, -0.4, 0.06); camScreen.scale.setScalar(0.8); camScreen.visible = false;
{ // on screen its back shows a little "tap CAMERA" picture
  const t = textCanvas(256, 168), g = t.ctx, gr = g.createLinearGradient(0, 0, 256, 168); gr.addColorStop(0, '#2a3a52'); gr.addColorStop(1, '#101820');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 168); g.fillStyle = 'rgba(255,255,255,0.08)'; g.beginPath(); g.moveTo(0, 0); g.lineTo(150, 0); g.lineTo(60, 168); g.lineTo(0, 168); g.fill();
  g.font = '64px "Apple Color Emoji","Noto Color Emoji",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('📷', 128, 70);
  g.fillStyle = '#ffcf4a'; g.font = 'bold 24px Arial'; g.fillText('MSB', 128, 136); t.tex.needsUpdate = true;
  const m = camScreen.userData.screen.material; m.map = t.tex; m.color.set('#fff');
}
camera.add(camScreen);
const camVR = makeCamera(); camVR.visible = false; scene.add(camVR);
// what the VR camera's screen shows: the real camera when the headset gives it to us, else the gallery
const viewTarget = new THREE.WebGLRenderTarget(512, 384);
viewTarget.texture.colorSpace = THREE.SRGBColorSpace;
const viewCam = new THREE.PerspectiveCamera(55, 4 / 3, 0.1, 200);
let videoTex = null;
const laser = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 1, 6).translate(0, 0.5, 0).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffcf4a', transparent: true, opacity: 0.75 }));
laser.visible = false; scene.add(laser);
// a watch on your left wrist in VR: money, offers, version
const watch = textCanvas(256, 160);
const watchMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.0625), new THREE.MeshBasicMaterial({ map: watch.tex, toneMapped: false }));
watchMesh.visible = false; scene.add(watchMesh);
// a message board that follows you in VR (the HTML messages can't be seen in a headset)
const board = textCanvas(512, 120);
const boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.117), new THREE.MeshBasicMaterial({ map: board.tex, transparent: true, toneMapped: false, depthTest: false }));
boardMesh.renderOrder = 11; boardMesh.visible = false; scene.add(boardMesh);

// ---------- saving ----------
const DEFAULTS = { v: 1, money: 150, fame: 0, art: [], frames: ['wood', 'black'], decor: [], wing: false, welcomed: false, turn: 'snap',
  nextId: 1, made: 0, sold: 0, earned: 0, bought: 0, market: [], marketT: 0, gifted: false };
let save = { ...DEFAULTS };
function upgrade(s){
  const o = { ...DEFAULTS, ...s, v: 1 };
  o.art = (o.art || []).filter((a) => a && a.id);
  for (const a of o.art){ if (a.forSale === undefined) a.forSale = true; if (!a.frame) a.frame = 'wood'; }
  if (!Array.isArray(o.frames) || !o.frames.length) o.frames = ['wood', 'black'];
  return o;
}
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
  boardMesh.visible = !!m && mode === 'vr' && vrs.posed && !vrPage;
  if (!m) return;
  g.fillStyle = m.kind === 'bad' ? 'rgba(170,30,40,0.92)' : m.kind === 'good' ? 'rgba(30,120,50,0.92)' : m.kind === 'money' ? 'rgba(170,110,10,0.94)' : 'rgba(30,26,40,0.92)';
  roundRect(g, 2, 2, 508, 116, 22); g.fill();
  g.fillStyle = '#fff'; g.font = 'bold 28px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const lines = wrapText(g, m.text, 480).slice(0, 3);
  lines.forEach((l, i) => g.fillText(l, 256, 60 + (i - (lines.length - 1) / 2) * 32));
  board.tex.needsUpdate = true;
}

// ---------- artworks ----------
const artById = (id) => save.art.find((a) => a.id === id);
const slotOf = (a) => (a && a.slot != null ? gallery.slots[a.slot] : null);
const dealerPrice = (a) => Math.max(5, Math.round(a.value * 0.7 / 5) * 5);
function labelFor(a){ return { title: a.title, artist: a.kind === 'market' ? a.artist : 'by you', price: a.forSale ? fmtMoney(a.value) : 'Not for sale', forSale: a.forSale }; }
async function hangArt(a, s){
  if (!s || !gallery.slotOpen(s)) return false;
  if (s.art && s.art !== a){ const old = s.art; old.slot = null; gallery.unhang(s); }
  const prev = slotOf(a); if (prev && prev !== s) gallery.unhang(prev);
  a.slot = s.i;
  const pic = await pictureOf(a);
  if (a.slot !== s.i) return false;   // moved again while the picture was loading
  gallery.hang(s, a, pic, labelFor(a));
  return true;
}
function takeDown(a){ const s = slotOf(a); if (s) gallery.unhang(s); a.slot = null; }
function nearestFreeSlot(){
  const p = player.pos;
  return gallery.slots.filter((s) => !s.art && gallery.slotOpen(s)).sort((a, b) => a.view.distanceTo(p) - b.view.distanceTo(p))[0] || null;
}
function slotName(s){
  if (s.wing) return 'the east wing';
  const n = s.n;
  if (Math.abs(s.pos.z) < 0.5) return 'the middle wall';
  return n.z > 0.5 ? 'the back wall' : n.z < -0.5 ? 'the front wall' : n.x > 0.5 ? 'the left wall' : 'the right wall';
}
async function hangNearest(a){
  const s = nearestFreeSlot();
  if (!s){ say('Every wall is full! Take a picture down, sell some, or buy the east wing.', 'bad'); return false; }
  await hangArt(a, s); store(); sfx.hang();
  say(`🖼 "${a.title}" is hanging on ${slotName(s)}.`, 'good');
  refreshHUD();
  return true;
}
function earn(n, why){ save.money += n; save.earned += n; popMoney(n); say(`💰 +${fmtMoney(n)}: ${why}`, 'money'); sfx.cash(); }
function sellTo(a, price, who){
  const s = slotOf(a);
  if (s) gallery.unhang(s);
  save.art = save.art.filter((x) => x !== a);
  if (a.kind === 'photo') delPicture(a.id); else forgetPicture(a.id);
  save.sold++; save.fame += a.kind === 'photo' ? 1 : 0.5;
  earn(price, `"${a.title}" sold to ${who}`);
  for (const v of visitors.list) if (v.offer && v.offer.art === a) visitors.decline(v);
  store(); refreshHUD();
}
// a new photo, finished in the editor
async function addPhoto(canvas, state, edits){
  const id = 'p' + (save.nextId++);
  const ap = appraise(canvas, edits);
  const a = { id, kind: 'photo', title: nameFor(canvas, Date.now()), artist: 'You', value: ap.value, stars: ap.stars, edits, frame: state.frame || 'wood',
    forSale: true, slot: null, made: Date.now(), w: canvas.width, h: canvas.height };
  await putPicture(id, canvas);
  save.art.unshift(a); save.made++;
  store();
  sfx.win();
  refreshHUD();
  return a;
}

// ---------- panels: one description, drawn as HTML on screen or as a floating board in VR ----------
let vrPage = null;
function showPanel(spec){ if (mode === 'vr'){ vrPage = spec; boardMesh.visible = false; if (!spec.keepPlace) vrs.placePanel = true; vrPanel.show(spec); vrPanel.mesh.visible = vrs.posed; } else panel.show(spec); }
function closePanels(){ panel.close(); vrPage = null; vrPanel.mesh.visible = false; laser.visible = false; if (mode === 'vr') drawBoard(); }
const money = () => fmtMoney(save.money);
function howTo(){
  if (mode === 'vr') return [
    'MAKE: press A to take out your camera (right hand). Pull the trigger to take a picture, then edit it.',
    'SELL: hang pictures on the walls. Visitors offer to buy what they like. Or sell to the dealer from My Art.',
    'BUY: point at the Art Market desk by the door and pull the trigger.',
    'Left stick walks, right stick turns. Point and pull the trigger at frames, people and the desk. X opens the menu, B closes it.',
  ];
  return [
    'MAKE: tap 📷 to take a photo with your camera, then edit it however you like.',
    'SELL: hang it on a wall (tap an empty frame). Visitors look round and offer to buy what they like, or sell it to the dealer from 🖼 My Art.',
    'BUY: the 🛒 Art Market (the desk by the door) sells other artists\' paintings, frames, decorations and the east wing.',
    'Walk with your left thumb (or WASD), drag to look around, tap things.',
  ];
}
function welcome(){
  save.welcomed = true; store();
  showPanel({ title: '🖼 Welcome to your gallery!', money: money(), sections: [
    { text: 'This empty gallery is all yours. Make art, sell it, buy more. Your aunt sent a painting to get you started: it\'s on the back wall.' },
    { heading: 'How it works', list: howTo() },
    { buttons: [{ label: '📷 Take my first photo', kind: 'primary', go: () => { closePanels(); openCamera(); } }, { label: 'Look around first', go: closePanels }] },
  ] });
}
function menu(){
  showPanel({ title: '☰ Menu', money: money(), sections: [
    { text: `⭐ Fame ${Math.floor(save.fame)} · ${save.art.length} artworks · ${save.made} photos made · ${save.sold} sold · ${fmtMoney(save.earned)} earned · v${VERSION}` },
    { buttons: [{ label: '▶ Back to the gallery', kind: 'primary', go: closePanels }, { label: '📷 Camera', go: () => { closePanels(); openCamera(); } }] },
    { buttons: [{ label: '🖼 My Art', go: myArt }, { label: '🛒 Art Market', go: () => shop() }, { label: '❓ How to play', go: () => showPanel({ title: '❓ How to play', sections: [{ list: howTo() }, { buttons: [{ label: 'OK', kind: 'primary', go: closePanels }] }] }) }] },
    ...(mode === 'vr' ? [{ heading: 'Turning', buttons: [{ label: 'Snap turn', on: save.turn === 'snap', go: () => { save.turn = 'snap'; store(); menu(); } }, { label: 'Smooth turn', on: save.turn === 'smooth', go: () => { save.turn = 'smooth'; store(); menu(); } }] }] : []),
    { buttons: [{ label: '🏠 Title screen', kind: 'danger', go: () => { closePanels(); toTitle(); } }] },
  ] });
}
// your artworks: little items you can hang, keep or sell
function myArt(){
  const list = save.art;
  showPanel({ title: '🖼 My Art', money: money(), sections: [
    list.length ? { text: `${list.length} artwork${list.length > 1 ? 's' : ''}. Tap one to hang, keep or sell it.` } : { text: 'Nothing yet! Take a photo with 📷 or buy a painting at the 🛒 Art Market.' },
    { rows: list.slice(0, 40).map((a) => ({ icon: thumbOf(a), on: !!slotOf(a), title: a.title, sub: `${a.kind === 'market' ? a.artist : 'Your photo'} · worth ${fmtMoney(a.value)} · ${slotOf(a) ? 'on the wall' : 'in storage'}${a.forSale ? '' : ' · keeping'}`, button: { label: 'Open', go: () => artPanel(a) } })) },
    { buttons: [{ label: '📷 Take a new photo', kind: 'primary', go: () => { closePanels(); openCamera(); } }, { label: 'Close', go: closePanels }] },
  ] });
}
function starsList(a){ const st = a.stars; if (!st) return []; return Object.keys(STAR_NAMES).map((k) => `${STAR_NAMES[k]}: ${starText(st[k])}`); }
async function artPanel(a, fresh = false){
  const pic = await pictureOf(a);
  const s = slotOf(a);
  const offers = visitors.list.filter((v) => v.offer && v.offer.art === a);
  showPanel({ title: fresh ? '✨ Your new artwork!' : '🖼 ' + a.title, money: money(), sections: [
    { image: pic, maxH: 260, vrH: 420 },
    { text: `"${a.title}" ${a.kind === 'market' ? `by ${a.artist}` : 'by you'} · worth about ${fmtMoney(a.value)}${s ? ' · hanging on ' + slotName(s) : ''}` },
    ...(a.stars ? [{ list: starsList(a) }] : []),
    ...offers.map((v) => ({ rows: [{ title: `🙋 ${v.name} offers ${fmtMoney(v.offer.price)}`, sub: 'waiting by the picture', buttons: [{ label: 'Sell', kind: 'primary', go: () => { acceptOffer(v); closePanels(); } }, { label: 'No', go: () => { visitors.decline(v); artPanel(a); } }] }] })),
    { heading: 'Keep it', buttons: [
      s ? { label: '📦 Take it down', go: () => { takeDown(a); store(); sfx.click(); refreshHUD(); artPanel(a); } } : { label: '🖼 Hang it on a wall', kind: 'primary', go: async () => { closePanels(); await hangNearest(a); } },
      { label: a.forSale ? '🔒 Not for sale' : '🏷 Put it up for sale', go: () => { a.forSale = !a.forSale; if (s) gallery.drawLabel(s, labelFor(a)); store(); artPanel(a); } },
      { label: '🎲 New name', go: () => { a.title = nameFor(pic, Math.random() * 1e9); if (s) gallery.drawLabel(s, labelFor(a)); store(); artPanel(a, fresh); } },
    ] },
    { heading: 'Sell it', buttons: [
      { label: `💰 Sell to the dealer: ${fmtMoney(dealerPrice(a))}`, kind: 'danger', go: () => { const p = dealerPrice(a); closePanels(); sellTo(a, p, 'the dealer'); } },
      ...(mode === 'vr' ? [] : [{ label: '✏️ Rename', go: () => { const t = prompt('Name your artwork', a.title); if (t && t.trim()){ a.title = t.trim().slice(0, 40); if (s) gallery.drawLabel(s, labelFor(a)); store(); } artPanel(a, fresh); } }]),
    ] },
    { text: a.forSale ? 'Hang it up and visitors may offer more than the dealer pays.' : 'Visitors can admire it, but it\'s not for sale.' },
    { buttons: [{ label: fresh ? '✓ Keep it' : 'Close', go: () => { closePanels(); if (fresh) say(`📦 "${a.title}" is in 🖼 My Art.`); } }, { label: '🖼 My Art', go: myArt }] },
  ] });
}
function slotPanel(s){
  if (!gallery.slotOpen(s)){ say('That\'s in the east wing: buy it at the 🛒 Art Market.'); return; }
  if (s.art) return artPanel(s.art);
  const free = save.art.filter((a) => !slotOf(a));
  showPanel({ title: '🖼 An empty spot', money: money(), sections: [
    free.length ? { text: 'Which artwork goes here?' } : { text: 'You have nothing in storage to hang. Take a photo or buy a painting!' },
    { rows: free.slice(0, 30).map((a) => ({ icon: thumbOf(a), title: a.title, sub: `worth ${fmtMoney(a.value)}`, button: { label: 'Hang here', kind: 'primary', go: async () => { closePanels(); await hangArt(a, s); store(); sfx.hang(); say(`🖼 "${a.title}" is up!`, 'good'); refreshHUD(); } } })) },
    { buttons: [{ label: '📷 Take a photo', go: () => { closePanels(); openCamera(); } }, { label: 'Close', go: closePanels }] },
  ] });
}
function visitorPanel(v){
  const o = v.offer;
  const art = (o && o.art) || (v.target && v.target.art);
  showPanel({ title: `🙋 ${v.name}`, money: money(), sections: [
    { text: `${v.name} loves art that's ${v.like}. ${art ? `Looking at "${art.title}".` : 'Just looking around.'}` },
    ...(o ? [{ text: `${v.name} offers ${fmtMoney(o.price)} for "${o.art.title}" (it's worth about ${fmtMoney(o.art.value)}).` }, { buttons: [{ label: `💰 Sell for ${fmtMoney(o.price)}`, kind: 'primary', go: () => { acceptOffer(v); closePanels(); } }, { label: 'No, thanks', kind: 'danger', go: () => { visitors.decline(v); closePanels(); } }] }] : []),
    { buttons: [{ label: '💬 What do you think?', go: () => { const t = visitors.chat(v); say(`${v.name}: ${t}`); } }, { label: 'Close', go: closePanels }] },
  ] });
}
function acceptOffer(v){
  const o = visitors.accept(v);
  if (!o || !save.art.includes(o.art)) return;
  sellTo(o.art, o.price, v.name);
}
function decorPanel(spot){
  const D = DECOR[spot.kind];
  showPanel({ title: `${D.icon} ${D.name}`, money: money(), sections: [
    { text: `Decorations make the gallery nicer: more visitors come, and they pay more. (+${D.fame} appeal)` },
    { buttons: [{ label: `Sell it back: ${fmtMoney(Math.round(D.price / 2))}`, kind: 'danger', go: () => { removeDecor(spot); save.money += Math.round(D.price / 2); store(); closePanels(); sfx.cash(); refreshHUD(); } }, { label: 'Close', go: closePanels }] },
  ] });
}
function removeDecor(spot){
  if (spot.mesh){ gallery.root.remove(spot.mesh); spot.mesh = null; }
  if (spot.wall){ const i = gallery.walls.indexOf(spot.wall); if (i >= 0) gallery.walls.splice(i, 1); spot.wall = null; }
  if (spot.pickBox){ gallery.pick.remove(spot.pickBox); spot.pickBox = null; }
  save.decor = save.decor.filter((d) => d !== spot.i);
}
const appeal = () => save.fame / 4 + save.decor.reduce((n, i) => n + (DECOR[gallery.decorSpots[i].kind] || { fame: 0 }).fame, 0);

// ---------- the Art Market ----------
function marketItems(){
  while (save.market.length < 4) save.market.push((Math.random() * 1e9) >>> 0);
  return save.market.map((seed) => ({ seed, ...marketPiece(seed, save.fame) }));
}
let shopTab = 'art';
function shop(tab = shopTab){
  shopTab = tab;
  const tabs = [['art', '🎨 Art'], ['decor', '🪴 Decor'], ['frames', '🖼 Frames'], ['gallery', '🏛 Gallery']].map(([id, label]) => ({ label, on: tab === id, go: () => shop(id) }));
  const secs = [];
  if (tab === 'art'){
    secs.push({ text: 'Paintings by other artists. Hang them and sell them on: visitors often pay more than you did.' });
    secs.push({ rows: marketItems().map((m) => ({ icon: marketThumb(m), title: `"${m.title}"`, sub: `${m.artist} · ${fmtMoney(m.value)}`, button: { label: `Buy ${fmtMoney(m.value)}`, disabled: save.money < m.value, go: () => buyArt(m) } })) });
    secs.push({ buttons: [{ label: '🔄 Show me different art ($10)', disabled: save.money < 10, go: () => { save.money -= 10; save.market = []; store(); refreshHUD(); shop('art'); } }] });
  } else if (tab === 'decor'){
    secs.push({ text: 'Decorations bring more visitors, and they pay more.' });
    secs.push({ rows: Object.entries(DECOR).map(([k, D]) => { const spot = gallery.freeSpot(k); return { title: `${D.icon} ${D.name}`, sub: spot ? `${fmtMoney(D.price)} · +${D.fame} appeal` : 'No room for another one', button: { label: `Buy ${fmtMoney(D.price)}`, disabled: !spot || save.money < D.price, go: () => buyDecor(k) } }; }) });
  } else if (tab === 'frames'){
    secs.push({ text: 'Frames you own can be chosen in the editor\'s 🖼 Frame tab.' });
    secs.push({ rows: Object.entries(FRAMES).map(([k, F]) => ({ title: F.name + ' frame', sub: save.frames.includes(k) ? 'You have it' : fmtMoney(F.price), button: save.frames.includes(k) ? { label: '✓ Owned', disabled: true, go(){} } : { label: `Buy ${fmtMoney(F.price)}`, disabled: save.money < F.price, go: () => { save.money -= F.price; save.frames.push(k); save.bought++; store(); sfx.cash(); say(`🖼 New frame: ${F.name}!`, 'good'); refreshHUD(); shop('frames'); } } })) });
  } else {
    secs.push({ text: save.wing ? 'The east wing is open: 8 more spots for pictures.' : 'Open the east wing: 8 more spots for pictures, room for more decorations.' });
    if (!save.wing) secs.push({ buttons: [{ label: '🏛 Open the east wing: $600', kind: 'primary', disabled: save.money < 600, go: () => { save.money -= 600; save.wing = true; gallery.openWing(true); store(); sfx.win(); closePanels(); say('🏛 The east wing is open! Hang more pictures there.', 'good'); refreshHUD(); } }] });
  }
  showPanel({ title: '🛒 Art Market', money: money(), tabs, sections: [...secs, { buttons: [{ label: 'Close', go: closePanels }] }] });
}
const mthumbs = new Map();
function marketThumb(m){ if (!mthumbs.has(m.seed)){ mthumbs.set(m.seed, thumbOf({ id: 'm' + m.seed, kind: 'market', style: m.style, seed: m.seed })); if (mthumbs.size > 30) mthumbs.delete(mthumbs.keys().next().value); } return mthumbs.get(m.seed); }
function buyArt(m){
  if (save.money < m.value) return;
  save.money -= m.value; save.bought++;
  const a = { id: 'm' + m.seed, kind: 'market', seed: m.seed, style: m.style, title: m.title, artist: m.artist, value: Math.round(m.value * (1.05 + Math.random() * 0.3) / 5) * 5, paid: m.value,
    stars: { colour: 2, bold: 1 + (m.seed % 3), detail: 1 + (m.seed % 2), creative: 2 }, frame: 'gold', forSale: true, slot: null, made: Date.now() };
  if (!save.frames.includes('gold')) a.frame = 'wood';
  if (artById(a.id)) a.id += 'b' + save.nextId++;
  save.art.unshift(a);
  save.market = save.market.filter((x) => x !== m.seed);
  store(); sfx.cash(); refreshHUD();
  say(`🎨 You bought "${m.title}" by ${m.artist}!`, 'good');
  artPanel(a);
}
function buyDecor(kind){
  const D = DECOR[kind], spot = gallery.freeSpot(kind);
  if (!spot || save.money < D.price) return;
  save.money -= D.price; save.bought++;
  gallery.placeDecor(spot); save.decor.push(spot.i);
  store(); sfx.cash(); refreshHUD();
  say(`${D.icon} A new ${D.name.toLowerCase()} for the gallery!`, 'good');
  shop('decor');
}

// ---------- you ----------
const EYE = 1.6, WALK = 2.6, RUN = 4.6;
const player = { pos: V(START.x, 0, START.z), yaw: START.yaw, pitch: 0 };
function standAt(s){
  player.pos.set(s.x, 0, s.z); if (s.yaw !== undefined) player.yaw = s.yaw; player.pitch = s.pitch || 0;
  if (mode === 'vr') vrPlace(player.pos, player.yaw);
}
// visitors push you out of the way first, then walls; push for half a second and you slip past them
const stuck = { t: 0, slip: 0 };
function bump(p, low){
  if (stuck.slip <= 0) for (const v of visitors.list){
    if (!v.active) continue;
    const r = 0.55, dx = p.x - v.pos.x, dz = p.z - v.pos.z, d2 = dx * dx + dz * dz;
    if (d2 < r * r && d2 > 1e-6){ const d = Math.sqrt(d2); p.x = v.pos.x + dx / d * r; p.z = v.pos.z + dz / d * r; }
  }
  gallery.collide(p, 0.3, low);
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

// ---------- pointing at things (tap on screen, trigger in VR) ----------
const raycaster = new THREE.Raycaster();
function wallDist(o, d){
  // the nearest tall wall along a ray (flat: walls go floor to ceiling)
  let best = 99;
  for (const w of gallery.walls){
    if (!w.tall) continue;
    let t0 = 0, t1 = best;
    for (const [oa, da, a0, a1] of [[o.x, d.x, w.x0, w.x1], [o.z, d.z, w.z0, w.z1]]){
      if (Math.abs(da) < 1e-9){ if (oa < a0 || oa > a1){ t0 = 1; t1 = 0; } continue; }
      let ta = (a0 - oa) / da, tb = (a1 - oa) / da; if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    }
    if (t0 <= t1 && t0 > 0.05) best = Math.min(best, t0);
  }
  return best;
}
function pickAt(o, d, far = 14){
  raycaster.set(o, d); raycaster.far = far;
  const objs = [...gallery.pick.children, ...visitors.list.filter((v) => v.active).map((v) => v.pick)];
  const hits = raycaster.intersectObjects(objs, false);
  const wd = wallDist(o, V(d.x, 0, d.z).normalize()) / Math.max(0.05, Math.hypot(d.x, d.z));
  // visitors in front of a picture win
  const h = hits.find((x) => x.object.userData.kind === 'visitor' && x.distance < wd + 0.3) || hits.find((x) => x.distance < wd + 0.35);
  return h ? h.object.userData : null;
}
function use(target){
  if (!target) return false;
  startAudio(); sfx.click();
  if (target.kind === 'slot') slotPanel(target.slot);
  else if (target.kind === 'visitor') visitorPanel(target.v);
  else if (target.kind === 'desk') shop();
  else if (target.kind === 'decor') decorPanel(target.spot);
  return true;
}
function tapScreen(x, y){
  camera.updateMatrixWorld(true);
  raycaster.setFromCamera(new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1), camera);
  return use(pickAt(raycaster.ray.origin.clone(), raycaster.ray.direction.clone()));
}

// ---------- the camera (screen): the real camera full screen, a shutter, then the editor ----------
let camBusy = false;
async function openCamera(){
  if (mode === 'vr'){ vrs.camOut = true; vrStartCamera(); say('📷 Point the camera and pull the trigger to take a picture. Right stick up and down zooms. A puts it away.'); return; }
  closePanels();
  startAudio();
  const C = $('cam');
  C.classList.add('show'); document.body.classList.add('camera');
  $('cam-msg').textContent = 'Starting the camera…'; $('cam-msg').style.display = 'block';
  $('cam-alt').style.display = 'none';
  try {
    await startCamera(cam.facing);
    $('cam-msg').style.display = 'none';
    showZoom();
  } catch (e) {
    $('cam-msg').textContent = cam.error || 'The camera did not start.';
    $('cam-alt').style.display = 'inline-block';
  }
}
// pinch the camera's picture to zoom (or the 1× 2× 3× buttons, or the mouse wheel)
const camTouch = new Map(); let camPinch = null;
function showZoom(){
  $('cam-zlabel').textContent = cam.zoom.toFixed(cam.zoom < 10 ? 1 : 0) + '×';
  for (const b of document.querySelectorAll('#cam-zbtns button')) b.classList.toggle('on', Math.abs(+b.dataset.z - cam.zoom) < 0.05);
  $('cam-zoom').classList.toggle('show', cam.live);
}
function camZoom(z){ setZoom(z); showZoom(); }
{
  const C = $('cam');
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) C.addEventListener(ev, (e) => e.preventDefault());
  C.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; e.preventDefault(); camTouch.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (camTouch.size === 2){ const [a, b] = [...camTouch.values()]; camPinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: cam.zoom }; } });
  C.addEventListener('pointermove', (e) => { const p = camTouch.get(e.pointerId); if (!p) return; p.x = e.clientX; p.y = e.clientY; if (camPinch && camTouch.size >= 2){ const [a, b] = [...camTouch.values()]; camZoom(camPinch.z * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(20, camPinch.d)); } });
  const up = (e) => { camTouch.delete(e.pointerId); if (camTouch.size < 2) camPinch = null; };
  C.addEventListener('pointerup', up); C.addEventListener('pointercancel', up);
  C.addEventListener('wheel', (e) => { e.preventDefault(); camZoom(cam.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)); }, { passive: false });
  for (const b of document.querySelectorAll('#cam-zbtns button')) b.addEventListener('click', (e) => { e.stopPropagation(); camZoom(+b.dataset.z); });
}
function closeCamera(){ stopCamera(); camTouch.clear(); camPinch = null; $('cam').classList.remove('show'); document.body.classList.remove('camera'); }
async function shutter(){
  if (camBusy) return;
  const shot = cam.live ? snap() : null;
  if (!shot){ $('cam-msg').textContent = 'No picture from the camera yet.'; $('cam-msg').style.display = 'block'; return; }
  camBusy = true;
  sfx.shutter(); flash();
  setTimeout(() => { camBusy = false; closeCamera(); edit(shot); }, 180);
}
// with no camera: a photo of the gallery from where you stand
function gallerySnap(w = 1280, h = 960, from = null){
  const rt = new THREE.WebGLRenderTarget(w, h, { samples: 4 }); rt.texture.colorSpace = THREE.SRGBColorSpace;
  const c3 = new THREE.PerspectiveCamera(from && from.fov ? from.fov : 60, w / h, 0.1, 200);
  if (from){ c3.position.copy(from.pos); c3.quaternion.copy(from.quat); }
  else { camera.updateMatrixWorld(true); camera.matrixWorld.decompose(c3.position, c3.quaternion, c3.scale); c3.scale.set(1, 1, 1); }
  c3.updateMatrixWorld(true);
  const was = [camScreen.visible, camVR.visible, vrPanel.mesh.visible, laser.visible, boardMesh.visible, watchMesh.visible];
  camScreen.visible = camVR.visible = vrPanel.mesh.visible = laser.visible = boardMesh.visible = watchMesh.visible = false;
  const xr = renderer.xr.enabled; renderer.xr.enabled = false;
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, c3);
  const px = new Uint8Array(w * h * 4); renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
  renderer.setRenderTarget(prev); renderer.xr.enabled = xr;
  [camScreen.visible, camVR.visible, vrPanel.mesh.visible, laser.visible, boardMesh.visible, watchMesh.visible] = was;
  rt.dispose();
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'), img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  g.putImageData(img, 0, 0);
  return c;
}
function flash(){ const f = $('flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }

// ---------- editing ----------
let session = null;
function edit(src){
  session = new EditSession(src, {
    frames: save.frames,
    onDone: async (canvas, state, edits) => {
      const s = session; session = null;
      editor.close(); if (mode === 'vr') closePanels();
      void s;
      const a = await addPhoto(canvas, state, edits);
      artPanel(a, true);
    },
    onCancel: () => { session = null; editor.close(); closePanels(); say('🗑 Photo thrown away.'); },
  });
  if (mode === 'vr'){ session.onChange = () => { vrs.editDirty = true; }; showPanel(vrEditorSpec(session)); }
  else editor.open(session);
}

// ---------- screen input: a thumb stick, drag to look, tap to use ----------
const touch = { stickId: null, stick: null, look: new Map() };
const keys = {};
const stick = { x: 0, y: 0 };
const stickEl = $('stick'), knobEl = $('knob');
function stickZone(x, y){ return x < innerWidth * 0.42 && y > innerHeight * 0.4; }
const canInput = () => mode === 'screen' && !panel.open && !editor.isOpen && !document.body.classList.contains('camera');
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (!canInput()) return;
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
  if (canInput() && L.moved < 12 && performance.now() - L.t < 450) tapScreen(e.clientX, e.clientY);
});
const cancelPointer = (e) => { touch.look.delete(e.pointerId); if (e.pointerId === touch.stickId) releaseStick(); };
renderer.domElement.addEventListener('pointercancel', cancelPointer);
renderer.domElement.addEventListener('lostpointercapture', cancelPointer);
addEventListener('pointerup', (e) => { if (e.target !== renderer.domElement) cancelPointer(e); });
addEventListener('pointercancel', cancelPointer);
const resetInput = () => { releaseStick(); touch.look.clear(); for (const k in keys) keys[k] = false; };
addEventListener('blur', resetInput);
document.addEventListener('visibilitychange', () => { if (document.hidden){ resetInput(); if (mode !== 'title') store(); } });
addEventListener('keydown', (e) => {
  if (mode !== 'screen' || editor.isOpen || e.target.tagName === 'INPUT') return;
  if (document.body.classList.contains('camera')){ if (e.code === 'Space' || e.code === 'Enter'){ e.preventDefault(); shutter(); } if (e.code === 'Escape') closeCamera(); return; }
  keys[e.code] = true;
  if (e.code === 'Escape'){ if (panel.open) closePanels(); else menu(); }
  if (panel.open) return;
  if (e.code === 'KeyC'){ e.preventDefault(); openCamera(); }
  if (e.code === 'KeyI') myArt();
  if (e.code === 'KeyB') shop();
  if (e.code === 'Space' || e.code === 'Enter'){ e.preventDefault(); tapScreen(innerWidth / 2, innerHeight / 2); }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
const press = (id, fn) => $(id).addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); startAudio(); fn(); });
press('b-cam', () => openCamera());
press('b-art', () => { sfx.click(); myArt(); });
press('b-shop', () => { sfx.click(); shop(); });
press('b-menu', () => { sfx.click(); menu(); });
press('cam-shoot', () => shutter());
press('cam-flip', async () => { try { await flipCamera(); $('cam-msg').style.display = 'none'; showZoom(); } catch (e) { $('cam-msg').textContent = cam.error; $('cam-msg').style.display = 'block'; } });
press('cam-close', () => closeCamera());
press('cam-alt', () => { closeCamera(); sfx.shutter(); flash(); edit(gallerySnap()); });

// ---------- the screen camera ----------
const orbit = { a: 0 };
function placeScreenCamera(dt){
  rig.position.set(0, 0, 0); rig.quaternion.identity();
  if (mode === 'title'){
    const a = orbit.a;
    camera.position.set(Math.sin(a) * 6, 2.4, 3 + Math.cos(a) * 3);
    camera.lookAt(Math.sin(a) * 2, 1.7, -10);
  } else {
    camera.position.set(player.pos.x, player.pos.y + EYE, player.pos.z);
    camera.quaternion.setFromEuler(new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ'));
  }
  camera.updateMatrixWorld(true);
  void dt;
}

// ---------- VR ----------
function makeVRHand(i){
  return { i, side: i ? 'right' : 'left', tracked: false, rayPos: V(), rayQuat: new THREE.Quaternion(), gripPos: V(), gripQuat: new THREE.Quaternion(),
    trigger: 0, stick: { x: 0, y: 0 }, a: false, b: false, last: {}, gamepad: null,
    haptic(v, ms){ const g = this.gamepad; try { if (g && g.hapticActuators && g.hapticActuators[0]) g.hapticActuators[0].pulse(v, ms); } catch (e) { /* no rumble */ } } };
}
const vr = [makeVRHand(0), makeVRHand(1)];
const rays = [renderer.xr.getController(0), renderer.xr.getController(1)];
const grips = [renderer.xr.getControllerGrip(0), renderer.xr.getControllerGrip(1)];
const sources = [null, null];
for (let i = 0; i < 2; i++){ rig.add(rays[i]); rig.add(grips[i]); rays[i].addEventListener('connected', (e) => { sources[i] = e.data; }); rays[i].addEventListener('disconnected', () => { sources[i] = null; }); }
const headPos = V(), headQuat = new THREE.Quaternion(), v1 = V();
const vrs = { posed: false, frames: 0, snapReady: true, pending: null, placePanel: false, frame: 0, camOut: false, editDirty: false, editT: 0, pickT: 0, aim: null };
function readVR(){
  for (const h of vr){
    const idx = sources.findIndex((s) => s && s.handedness === h.side);
    const src = idx >= 0 ? sources[idx] : null, g = src && src.gamepad;
    h.gamepad = g || null;
    h.tracked = !!(src && rays[idx].visible);
    if (h.tracked){
      rays[idx].updateMatrixWorld(true); rays[idx].matrixWorld.decompose(h.rayPos, h.rayQuat, v1);
      if (grips[idx].visible){ grips[idx].updateMatrixWorld(true); grips[idx].matrixWorld.decompose(h.gripPos, h.gripQuat, v1); } else { h.gripPos.copy(h.rayPos); h.gripQuat.copy(h.rayQuat); }
    }
    const B = (k) => (g && g.buttons[k]) || { value: 0, pressed: false };
    h.trigger = B(0).value; h.a = B(4).pressed; h.b = B(5).pressed;
    const ax = g ? g.axes : [];
    h.stick.x = ax.length >= 4 ? ax[2] : (ax[0] || 0); h.stick.y = ax.length >= 4 ? ax[3] : (ax[1] || 0);
    const L = h.last;
    h.held = h.trigger > 0.5;
    h.triggerDown = h.trigger > 0.7 && !L.t; h.aDown = h.a && !L.a; h.bDown = h.b && !L.b;
    L.t = h.trigger > 0.7 ? true : h.trigger < 0.4 ? false : L.t; L.a = h.a; L.b = h.b;
  }
}
// try the headset's real camera; when it isn't available, the camera shows (and photographs) the gallery
let vrCamTried = false;
async function vrStartCamera(){
  if (vrCamTried) return; vrCamTried = true;
  if (!cameraSupported()) return;
  try { await startCamera('environment'); if (cam.live){ videoTex = new THREE.VideoTexture($('cam-video')); videoTex.colorSpace = THREE.SRGBColorSpace; say('📷 Your headset\'s camera is on.'); } }
  catch (e) { say('📷 The headset didn\'t share its camera, so your camera photographs the gallery.'); }
}
function vrShoot(){
  if (session) return;
  sfx.shutter(); vr[1].haptic(0.6, 80);
  let shot = null;
  if (cam.live && videoTex) shot = snap();
  if (!shot){ const q = camVR.quaternion.clone(); shot = gallerySnap(1024, 768, { pos: camVR.getWorldPosition(V()).addScaledVector(V(0, 0, -1).applyQuaternion(q), 0.08), quat: q, fov: viewCam.fov }); }
  vrs.camOut = false;
  edit(shot);
}
function vrUpdate(dt){
  readVR();
  const L = vr[0], R = vr[1];
  // the camera in your right hand (along the pointing ray, screen towards you)
  camVR.visible = R.tracked && vrs.camOut && !session;
  if (camVR.visible){
    camVR.position.copy(V(0, 0.01, -0.06).applyQuaternion(R.rayQuat)).add(R.rayPos);
    camVR.quaternion.copy(R.rayQuat);
    const scr = camVR.userData.screen;
    if (videoTex && cam.live){ if (scr.material.map !== videoTex){ scr.material.map = videoTex; scr.material.color.set('#fff'); scr.material.needsUpdate = true; } }
    else {
      if (scr.material.map !== viewTarget.texture){ scr.material.map = viewTarget.texture; scr.material.color.set('#fff'); scr.material.needsUpdate = true; }
      if ((vrs.frame++ & 1) === 0){
        viewCam.position.copy(camVR.position); viewCam.quaternion.copy(camVR.quaternion); viewCam.updateMatrixWorld(true);
        const was = [camVR.visible, vrPanel.mesh.visible, laser.visible, boardMesh.visible, watchMesh.visible];
        camVR.visible = vrPanel.mesh.visible = laser.visible = boardMesh.visible = watchMesh.visible = false;
        const rt = renderer.getRenderTarget(); renderer.xr.enabled = false;
        renderer.setRenderTarget(viewTarget); renderer.clear(); renderer.render(scene, viewCam);
        renderer.setRenderTarget(rt); renderer.xr.enabled = true;
        [camVR.visible, vrPanel.mesh.visible, laser.visible, boardMesh.visible, watchMesh.visible] = was;
      }
    }
  }
  // the watch on your left wrist
  watchMesh.visible = L.tracked;
  if (L.tracked){
    watchMesh.position.copy(V(0, 0.035, 0.12).applyQuaternion(L.gripQuat)).add(L.gripPos);
    watchMesh.quaternion.copy(L.gripQuat).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, Math.PI / 2)));
  }
  // the message board, low in front of you
  if (boardMesh.visible){ const f = V(0, 0, -1).applyQuaternion(headQuat); f.y = 0; f.normalize(); boardMesh.position.copy(headPos).addScaledVector(f, 1.1); boardMesh.position.y = headPos.y - 0.42; boardMesh.lookAt(headPos.x, headPos.y - 0.3, headPos.z); }
  // panels float in front of you; they come back if you turn away from them
  laser.visible = false;
  let onPanel = false;
  if (vrPage){
    if (session && vrs.editDirty){ vrs.editT -= dt; if (vrs.editT <= 0){ vrs.editDirty = false; vrs.editT = 0.06; vrPage = vrEditorSpec(session); vrPage.keepPlace = true; vrPanel.show(vrPage); } }
    const fwd = V(0, 0, -1).applyQuaternion(headQuat); fwd.y = 0; fwd.normalize();
    const to = v1.copy(vrPanel.mesh.position).sub(headPos); to.y = 0; to.normalize();
    if (vrs.placePanel || fwd.dot(to) < 0.4){
      vrs.placePanel = false;
      vrPanel.mesh.position.copy(headPos).addScaledVector(fwd, 1.1); vrPanel.mesh.position.y = headPos.y - 0.12;
      vrPanel.mesh.lookAt(headPos.x, headPos.y - 0.12, headPos.z);
    }
    vrPanel.mesh.visible = true;
    if (R.tracked){
      const dir = V(0, 0, -1).applyQuaternion(R.rayQuat);
      vrPanel.mesh.updateMatrixWorld(true);
      const page = vrPage;
      const hit = vrPanel.ray(R.rayPos, dir, R.triggerDown, 4, R.held);
      if (hit){
        onPanel = true; laser.visible = true;
        laser.position.copy(R.rayPos); laser.lookAt(hit.point); laser.scale.set(1, 1, R.rayPos.distanceTo(hit.point));
        if (hit.clicked){ R.haptic(0.3, 30); sfx.click(); if (vrPage && vrPage === page && !vrPage.editor) vrPanel.show(vrPage); }
      }
      if (Math.abs(R.stick.y) > 0.3 && hit) vrPanel.scrollBy(R.stick.y * dt * 900);
    }
    if (R.bDown || L.bDown){ if (session) session.cancel(); else closePanels(); return; }
  } else {
    if (L.aDown){ menu(); return; }
    if (R.aDown){ vrs.camOut = !vrs.camOut; sfx.click(); if (vrs.camOut){ vrStartCamera(); say('📷 Pull the trigger to take a picture. Right stick up and down zooms. A puts it away.'); } }
    if (R.bDown && vrs.camOut){ vrs.camOut = false; }
  }
  if (!onPanel && !vrPage && R.tracked){
    if (vrs.camOut){
      // the right stick up and down zooms the camera (the headset's own camera, or the view of the gallery)
      if (Math.abs(R.stick.y) > 0.25){
        vrs.zoom = clamp((vrs.zoom || 1) * Math.exp(-R.stick.y * dt * 1.6), 1, 5);
        viewCam.fov = 55 / vrs.zoom; viewCam.updateProjectionMatrix();
        if (cam.live) setZoom(vrs.zoom);
        vrs.zoomShow = 1.5;
      }
      if (R.triggerDown) vrShoot();
    }
    else {
      // point at frames, people and the desk (checked 20 times a second)
      vrs.pickT -= dt;
      if (vrs.pickT <= 0 || R.triggerDown){ vrs.pickT = 0.05; vrs.aim = pickAt(R.rayPos, V(0, 0, -1).applyQuaternion(R.rayQuat), 10); }
      if (vrs.aim){ laser.visible = true; laser.position.copy(R.rayPos); laser.quaternion.copy(R.rayQuat); laser.scale.set(1, 1, 3); }
      if (R.triggerDown && vrs.aim){ R.haptic(0.3, 30); use(vrs.aim); }
    }
  }
  // turning: snap or smooth (a setting)
  const sx = onPanel ? 0 : R.stick.x;
  if (save.turn === 'smooth'){ if (Math.abs(sx) > 0.2) turnRig(-sx * dt * 2.2); }
  else {
    if (Math.abs(sx) > 0.7 && vrs.snapReady){ turnRig(-Math.sign(sx) * Math.PI / 6); vrs.snapReady = false; }
    if (Math.abs(sx) < 0.35) vrs.snapReady = true;
  }
  // walking where you look; walls stop you (and your real head), benches only stop the stick
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
  rig.position.y = 0;
  player.pos.set(want.x, 0, want.z);
  player.yaw = new THREE.Euler().setFromQuaternion(headQuat, 'YXZ').y;
}
function turnRig(a){ v1.copy(headPos); rig.position.sub(v1).applyAxisAngle(V(0, 1, 0), a).add(v1); rig.rotation.y += a; rig.updateMatrixWorld(true); }
// stand the play space so your head is over p, facing yaw; not before the headset has a real pose
function vrPlace(p, yaw){
  if (!vrs.posed){ vrs.pending = { p: p.clone(), yaw }; return; }
  const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  rig.quaternion.setFromEuler(new THREE.Euler(0, yaw - e.y, 0, 'YXZ'));
  const local = V(camera.position.x, 0, camera.position.z).applyQuaternion(rig.quaternion);
  rig.position.set(p.x - local.x, 0, p.z - local.z);
  rig.updateMatrixWorld(true);
}
let watchLast = '';
function drawWatch(){
  const offers = visitors.list.filter((v) => v.offer).length;
  const key = `${save.money}|${offers}|${Math.floor(save.fame)}`;
  if (key === watchLast) return; watchLast = key;
  const g = watch.ctx; g.fillStyle = '#1e1a28'; roundRect(g, 0, 0, 256, 160, 26); g.fill();
  g.strokeStyle = '#ffcf4a'; g.lineWidth = 6; roundRect(g, 3, 3, 250, 154, 24); g.stroke();
  g.fillStyle = '#ffcf4a'; g.font = 'bold 44px Arial'; g.textAlign = 'center'; g.fillText(money(), 128, 56);
  g.fillStyle = '#fff'; g.font = 'bold 26px Arial'; g.fillText(`⭐${Math.floor(save.fame)}  🙋${offers} offer${offers === 1 ? '' : 's'}`, 128, 96);
  g.fillStyle = '#aaa'; g.font = '20px Arial'; g.fillText(`MSB v${VERSION} · X menu`, 128, 136);
  watch.tex.needsUpdate = true;
}

// ---------- the loop ----------
const clock = new THREE.Clock();
let mode = 'title', gameTime = 0, hudT = 0, saveT = 0;
function frame(){ try { step(); } catch (e) { console.error(e); } }
function step(){
  const dt = Math.min(clock.getDelta(), 1 / 20);
  const T = window.__msb, steps = T && T.timeScale > 1 ? Math.round(T.timeScale) : 1;
  for (let k = 0; k < steps; k++) simulate(dt);
  if (T && T.noRender && mode !== 'vr') return;     // (a headset only sends its next frame once this one is drawn)
  if (mode !== 'vr' && (editor.isOpen || document.body.classList.contains('camera'))) return;   // the 3D view is hidden
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
      drawBoard();
    }
    if (vrs.posed){ vrUpdate(dt); drawWatch(); }
  } else {
    if (mode === 'title') orbit.a += dt * 0.08;
    if (canInput()){
      const k = (c) => (keys[c] ? 1 : 0);
      walk(dt, stick.x + k('KeyD') - k('KeyA'), stick.y + k('KeyS') - k('KeyW'), keys.ShiftLeft || keys.ShiftRight);
      player.yaw += (k('ArrowLeft') - k('ArrowRight')) * dt * 2;
      player.pitch = clamp(player.pitch + (k('ArrowUp') - k('ArrowDown')) * dt * 1.5, -1.2, 1.2);
    }
    placeScreenCamera(dt);
    headPos.copy(camera.position);
    camScreen.visible = mode === 'screen';
    if (camScreen.visible){ camScreen.position.y = -0.17 + Math.sin(gameTime * 1.6) * 0.003 + (Math.hypot(stick.x, stick.y) > 0.1 ? Math.abs(Math.sin(gameTime * 7)) * 0.006 : 0); }
  }
  sky.position.copy(headPos);
  visitors.update(dt, { fame: save.fame, appeal: appeal() + (mode === 'title' ? 4 : 0), player: mode === 'title' ? null : player.pos });
  // the art market changes now and then
  save.marketT += dt; if (save.marketT > 240){ save.marketT = 0; if (save.market.length) save.market.shift(); }
  for (const m of msgs) m.t -= dt;
  if (msgs.length && msgs[0].t <= 0){ while (msgs.length && msgs[0].t <= 0) msgs.shift(); drawMsgs(); drawBoard(); }
  hudT -= dt; if (hudT <= 0){ hudT = 0.3; refreshHUD(); }
  saveT += dt; if (saveT > 20 && mode !== 'title'){ saveT = 0; store(); }
}
renderer.setAnimationLoop(frame);

// visitors' offers and comments
visitors.on('offer', (v) => { if (mode !== 'title'){ sfx.offer(); say(`🙋 ${v.name} offers ${fmtMoney(v.offer.price)} for "${v.offer.art.title}"!`, 'money'); refreshHUD(true); } });
visitors.on('gaveUp', (v) => { if (mode !== 'title') say(`${v.name} got tired of waiting.`); refreshHUD(true); });
visitors.on('viewed', (v, art, op) => { if (mode !== 'title') save.fame += 0.04 + op * 0.06; });
// a photo's little picture has arrived from storage: redraw what shows it
let thumbT = 0;
thumbOf.onReady = () => { hudLast.strip = ''; clearTimeout(thumbT); thumbT = setTimeout(() => { if (panel.open) panel.show(panel.open); if (vrPage) vrPanel.draw(); }, 60); };

// ---------- HUD (only what changed is redrawn) ----------
const hudLast = {};
function setHTML(id, html){ if (hudLast[id] !== html){ hudLast[id] = html; $(id).innerHTML = html; } }
let popT = 0;
function popMoney(n){ const p = document.createElement('div'); p.className = 'pop' + (n < 0 ? ' neg' : ''); p.textContent = (n < 0 ? '−' : '+') + fmtMoney(Math.abs(n)); $('h-money').appendChild(p); clearTimeout(popT); popT = setTimeout(() => p.remove(), 1500); }
function refreshHUD(force){
  if (mode !== 'screen' && !force) return;
  if (force) hudLast.jobs = hudLast.strip = '';
  setHTML('h-mval', money());
  const onWall = save.art.filter((a) => slotOf(a)).length;
  setHTML('h-rate', `⭐ Fame <b>${Math.floor(save.fame)}</b> · 🖼 <b>${onWall}</b> on the walls · 🙋 <b>${visitors.active.length}</b> visitor${visitors.active.length === 1 ? '' : 's'}`);
  // offers waiting for an answer (a card each: tap to sell or say no)
  const offers = visitors.list.filter((v) => v.offer);
  const jk = offers.map((v) => v.id + ':' + v.offer.price + ':' + Math.ceil(v.offer.t / 5)).join('|');
  if (hudLast.jobs !== jk){
    hudLast.jobs = jk;
    const box = $('jobs'); box.innerHTML = '';
    for (const v of offers.slice(0, 4)){
      const d = document.createElement('div'); d.className = 'job';
      d.innerHTML = `<span class="ji">🙋</span><span class="jt">${v.name} offers <b>${fmtMoney(v.offer.price)}</b><small>for "${escapeHTML(v.offer.art.title)}" (worth ${fmtMoney(v.offer.art.value)}) · ${Math.ceil(v.offer.t)}s</small></span>`;
      const yes = document.createElement('button'); yes.className = 'jyes'; yes.textContent = 'Sell';
      yes.onclick = (e) => { e.stopPropagation(); acceptOffer(v); refreshHUD(true); };
      const no = document.createElement('button'); no.className = 'jno'; no.textContent = '✕';
      no.onclick = (e) => { e.stopPropagation(); visitors.decline(v); refreshHUD(true); };
      d.append(yes, no); box.appendChild(d);
    }
  }
  // your artworks as little items along the bottom (newest first): tap one to hang, keep or sell it
  const items = save.art.slice(0, 8);
  const sk = items.map((a) => a.id + (slotOf(a) ? 'w' : '') + a.title).join('|') + save.art.length;
  if (hudLast.strip !== sk){
    hudLast.strip = sk;
    const box = $('strip'); box.innerHTML = '';
    for (const a of items){
      const b = document.createElement('button'); b.className = 'item' + (slotOf(a) ? ' wall' : '');
      const t = thumbOf(a); const img = new Image(); img.src = t.toDataURL(); b.appendChild(img);
      const s = document.createElement('small'); s.textContent = fmtMoney(a.value); b.appendChild(s);
      b.title = a.title;
      b.onclick = (e) => { e.stopPropagation(); sfx.click(); artPanel(a); };
      box.appendChild(b);
    }
    if (save.art.length > items.length){ const m = document.createElement('button'); m.className = 'item more'; m.textContent = `+${save.art.length - items.length}`; m.onclick = () => myArt(); box.appendChild(m); }
    box.style.display = save.art.length ? '' : 'none';
  }
}
const escapeHTML = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- title screen, starting and stopping ----------
async function setupGallery(){
  // put the saved gallery back: the east wing, decorations, the pictures on the walls
  gallery.openWing(!!save.wing);
  for (const d of gallery.decorSpots){ if (d.mesh) removeDecor(d); }
  for (const i of save.decor){ const d = gallery.decorSpots[i]; if (d && !d.mesh) gallery.placeDecor(d); }
  for (const s of gallery.slots) if (s.art) gallery.unhang(s);
  // a first painting, a present, so the first visitors have something to look at
  if (!save.gifted){
    save.gifted = true;
    const seed = 424242, m = marketPiece(seed, 0);
    save.art.push({ id: 'gift', kind: 'market', seed, style: 'sunset', title: 'A Present', artist: 'Your Aunt Ida', value: 90, stars: { colour: 3, bold: 2, detail: 1, creative: 1 }, frame: 'wood', forSale: false, slot: 2, made: Date.now() });
    void m;
  }
  await Promise.all(save.art.filter((a) => a.slot != null).map((a) => { const s = gallery.slots[a.slot]; if (!s || !gallery.slotOpen(s) || s.art){ a.slot = null; return null; } return hangArt(a, s); }));
}
function toTitle(){
  if (renderer.xr.isPresenting) renderer.xr.getSession().end();
  store(); closePanels(); closeCamera(); editor.close(); session = null;
  mode = 'title'; $('title').classList.remove('hidden'); document.body.classList.remove('playing');
  refreshTitle();
}
function refreshTitle(){
  $('b-new').style.display = hadSave || save.made > 0 || save.sold > 0 ? '' : 'none';
  $('b-play').textContent = save.made || save.sold ? `▶ Back to my gallery (${money()})` : '▶ Play';
}
async function newGame(){ const turn = save.turn; for (const a of save.art) if (a.kind === 'photo') delPicture(a.id); save = { ...DEFAULTS, turn }; store(); await setupGallery(); }
async function startScreen(fresh){
  startAudio();
  if (fresh) await newGame();
  standAt(START);
  mode = 'screen'; $('title').classList.add('hidden'); document.body.classList.add('playing');
  clock.getDelta(); refreshHUD(true);
  if (!save.welcomed) welcome();
  else say('Welcome back! 📷 takes a photo, 🛒 is the Art Market.');
}
async function startVR(fresh){
  startAudio();
  try {
    const session = await navigator.xr.requestSession('immersive-vr', { requiredFeatures: ['local-floor'] });
    session.addEventListener('end', () => {
      if (mode !== 'vr') return;
      mode = 'title'; $('title').classList.remove('hidden'); document.body.classList.remove('playing');
      camera.position.set(0, 0, 0); camera.quaternion.identity(); rig.position.set(0, 0, 0); rig.quaternion.identity();
      camVR.visible = laser.visible = boardMesh.visible = watchMesh.visible = false; closePanels();
      sun.shadow.mapSize.set(2048, 2048); if (sun.shadow.map){ sun.shadow.map.dispose(); sun.shadow.map = null; }
      stopCamera(); videoTex = null; vrCamTried = false; vrs.camOut = false;
      store(); refreshTitle();
    });
    sun.shadow.mapSize.set(1024, 1024); if (sun.shadow.map){ sun.shadow.map.dispose(); sun.shadow.map = null; }
    if (window.__msb && window.__msb.xrScale) renderer.xr.setFramebufferScaleFactor(window.__msb.xrScale);
    await renderer.xr.setSession(session);
    try { if (session.supportedFrameRates && session.updateTargetFrameRate){ const r = [...session.supportedFrameRates]; if (r.includes(72)) await session.updateTargetFrameRate(72); } } catch (e) { /* keep the default rate */ }
    if (fresh) await newGame();
    mode = 'vr'; $('title').classList.add('hidden'); camScreen.visible = false;
    vrs.posed = false; vrs.frames = 0; vrPage = null; vrs.camOut = false;
    camera.position.set(0, 1.6, 0); camera.quaternion.identity();
    clock.getDelta();
    standAt(START);
    if (!save.welcomed) welcome();
    else say('Welcome back! Press A for your camera, X for the menu.');
  } catch (e) { $('status').textContent = 'Could not start VR: ' + (e && e.message ? e.message : e); }
}
$('b-play').onclick = () => startScreen(false);
$('b-vr').onclick = () => startVR(false);
$('b-new').onclick = () => {
  if ((save.made || save.sold || save.art.length > 1) && !confirm('Start a new gallery? Your artworks and money will be gone.')) return;
  if (navigator.xr && $('b-vr').dataset.ok === '1' && confirm('Play in VR? (Cancel to play on this screen.)')) startVR(true); else startScreen(true);
};
await setupGallery();
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
  const name = 'msb-' + VERSION;
  for (let i = 0; i < 120; i++){
    try {
      if (await caches.has(name) && await (await caches.open(name)).match('/experiments/msb/__offline-ready__')){ $('offline').textContent = '✓ Saved on this device: plays offline'; return; }
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
  const dt = 1 / 20;
  for (let t = 0; t < sec; t += dt){ simulate(dt); if (cond && cond()) return true; }
  return cond ? !!cond() : true;
}
function lookAt(x, y, z){
  const dx = x - player.pos.x, dz = z - player.pos.z, dy = y - (player.pos.y + EYE);
  player.yaw = Math.atan2(-dx, -dz); player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  placeScreenCamera(1);
}
window.__msb = {
  get mode(){ return mode; }, get save(){ return save; }, get session(){ return session; }, get vrPage(){ return vrPage; }, get time(){ return gameTime; },
  get head(){ return headPos.toArray(); }, get vrs(){ return vrs; },
  gallery, visitors, player, renderer, camera, scene, rig, vr, vrPanel, panel, editor, stick, keys, cam, camVR, watchMesh,
  timeScale: 1, noRender: false, version: VERSION, START, DESK,
  startScreen, startVR, toTitle, openCamera, closeCamera, shutter, edit, gallerySnap, addPhoto, artPanel, myArt, shop, menu, slotPanel, visitorPanel,
  hangArt, hangNearest, takeDown, sellTo, acceptOffer, buyArt, buyDecor, marketItems, tapScreen, use, pickAt, standAt, lookAt, closePanels, advance, store, refreshHUD,
  renderNow(){ if (mode !== 'vr') placeScreenCamera(1 / 60); renderer.render(scene, camera); },
};

// warm up before the loading screen goes: draw every person once (out of sight, behind the loading
// screen) so their shaders, shadow shaders and textures are ready. Without this the game froze for a
// moment when the first visitors walked in.
async function warmUp(){
  const saved = visitors.list.map((v) => [v.root.visible, v.root.position.clone()]);
  visitors.list.forEach((v, i) => { v.root.visible = true; v.root.position.set(-4 + (i % 5) * 2, 0, 2 + Math.floor(i / 5) * 2); });
  scene.traverse((o) => { if (o.isMesh || o.isSprite) for (const m of [].concat(o.material)) for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'alphaMap', 'emissiveMap']) if (m && m[k]) renderer.initTexture(m[k]); });
  try { if (renderer.compileAsync) await renderer.compileAsync(scene, camera); } catch (e) { /* compiled on first draw instead */ }
  placeScreenCamera(0); renderer.render(scene, camera);
  visitors.list.forEach((v, i) => { v.root.visible = saved[i][0]; v.root.position.copy(saved[i][1]); });
}
await warmUp();
// the game is ready: hide the loading screen
if (window.__loaded) window.__loaded();
