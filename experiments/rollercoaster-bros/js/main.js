// Rollercoaster Bros: the main loop. Plays two ways from the same game:
//  - iPad / phone / computer: a camera that orbits the park (drag to turn, pinch or scroll to zoom, two
//    fingers or WASD to move), a row of track pieces to tap along the bottom, and buttons to ride, watch,
//    set the speed and shop.
//  - VR (WebXR, e.g. a Quest's browser): you stand in the park (or tower over it at giant size), a tablet
//    in your left hand holds the same buttons, you point with the right controller and pull the trigger.
//    Riding puts you in the front seat.
import * as THREE from 'three';
import { V, clamp, lerp, damp, fmtMoney } from './util.js';
import { PIECES, GROUPS, BUILD_ORDER, COLORS, pieceIcon, TILE, GRID_X, GRID_N, GRID_S } from './track.js';
import { CARTS, SPEEDS, PARK } from './train.js';
import { Park, PLOTS, NAMES, PARK_NAMES, readParks, deletePark, chooseParkId } from './park.js';
import { ScreenPanel, Tablet } from './ui.js';
import { startAudio, setListener, sfx, trainSound } from './audio.js';

const $ = (id) => document.getElementById(id);
const VERSION = document.body.dataset.version || '';

// ---------- renderer and the sky ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true; renderer.xr.setReferenceSpaceType('local-floor'); renderer.xr.setFoveation(0.5);
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 1500);
const rig = new THREE.Group(); rig.add(camera); scene.add(rig);
scene.fog = new THREE.Fog(0xcfe2f4, 160, 700);
const skyDome = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { sun: { value: V(0.45, 0.75, 0.35).normalize() } },
  vertexShader: 'varying vec3 d; void main(){ d = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }',
  fragmentShader: `uniform vec3 sun; varying vec3 d;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
    void main(){ vec3 v = normalize(d); float y = max(v.y, 0.0);
      vec3 c = mix(vec3(0.81, 0.89, 0.96), vec3(0.24, 0.5, 0.88), pow(y, 0.6));
      float s = max(dot(v, sun), 0.0); c += vec3(1.0, 0.95, 0.8) * (pow(s, 200.0) * 2.0 + pow(s, 8.0) * 0.15);
      if (v.y > 0.02){ vec2 uv = v.xz / (v.y + 0.1) * 1.6; float k = n(uv) * 0.5 + n(uv * 2.1) * 0.3 + n(uv * 4.3) * 0.2; c = mix(c, vec3(1.0), smoothstep(0.58, 0.85, k) * smoothstep(0.02, 0.3, v.y) * 0.85); }
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
    }`,
}));
skyDome.frustumCulled = false; skyDome.renderOrder = -1; scene.add(skyDome);
const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x5a7a3a, 1.1); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff4e0, 2.6);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04;
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 300 });
scene.add(sun, sun.target);
const SUN_DIR = V(0.45, 0.75, 0.35).normalize();

// ---------- the game ----------
const park = new Park(scene);
// the coaster you're building / riding / watching (the others keep running by themselves)
let cur = null, track = null, train = null;
function select(c, fly){
  if (cur && cur !== c && view === 'ride') stopRide();
  cur = c; track = c.track; train = c.train;
  park.state.current = park.coasters.indexOf(c);
  if (fly){ view = 'build'; orbit.follow = true; orbit.target.copy(track.endPoint()).setY(0); }
  if (fly && mode === 'vr') vrStand();
  refreshPalette(); updateHUD(); refreshTablet();
}
const panel = new ScreenPanel();
const tablet = new Tablet();

let mode = 'title';             // 'title' | 'screen' | 'vr'
let view = 'build';             // 'build' | 'watch' | 'ride'
let gameTime = 0, saveT = 0, hudT = 0;
const orbit = { target: V(0, 0, -6), yaw: 0.6, pitch: 0.55, dist: 60, follow: true };
const look = { yaw: 0, pitch: 0 };     // looking around from your seat
const msgs = [];
const building = [];            // pieces waiting to go down one by one (Finish)
let buildT = 0;
let screamT = 0, lastPay = 0, payAcc = 0, payN = 0;

park.on('say', ({ text, kind }) => say(text, kind));
park.on('pay', ({ amount }) => { payAcc += amount; payN++; });
park.on('scared', (c) => { if (!park.scaredT || gameTime - park.scaredT > 40){ park.scaredT = gameTime; say(`Some people think ${c.name} is too scary! A slower speed might help.`, 'bad'); } });
park.on('dispatch', (c) => { sfx.bell(c.train.cars[0].position); });
park.on('arrive', (c) => { sfx.hiss(c.train.cars[0].position); if (c.train.riders().length) sfx.cheer(c.train.cars[1].position); refreshTablet(); });

function say(text, kind = ''){
  msgs.push({ text, kind, t: 4.5 });
  while (msgs.length > 3) msgs.shift();
  if (kind === 'bad') sfx.bad();
  drawMsgs(); refreshTablet();
}
function drawMsgs(){
  const box = $('h-msg'); box.innerHTML = '';
  for (const m of msgs){ const d = document.createElement('div'); d.className = 'msg ' + m.kind; d.textContent = m.text; box.appendChild(d); }
}

// ---------- building ----------
// money: a free-build park has as much as you like, and everything in it is free
const cash = () => (park.free ? '∞ Free' : fmtMoney(park.state.money));
const cost = (n) => (park.free ? 'Free' : fmtMoney(n));
const owned = () => BUILD_ORDER.filter((t) => park.owns(PIECES[t].group));
function addPiece(type, quiet){
  if (!park.owns(PIECES[type].group)){ shop('parts'); return false; }
  if (view === 'ride') stopRide();
  const r = track.add(type);
  if (!r.ok){
    if (!quiet){ say(r.why, 'bad'); track.preview(type, false, r.s); }
    return false;
  }
  track.clearGhost();
  sfx.place();
  changed();
  if (track.complete) finished();
  return true;
}
function finished(){
  sfx.done();
  say('Your coaster is finished! People are coming to ride it.', 'good');
  if (!park.state.built){ park.state.built = true; setTimeout(() => { if (mode !== 'title') say('Tap “Ride it!” to have a go yourself.', ''); }, 2500); }
}
function undo(){
  building.length = 0;
  if (!track.undo()){ sfx.bad(); return; }
  sfx.undo(); changed();
}
function finishTrack(){
  if (track.complete){ say('It\'s already finished!', ''); return; }
  const path = track.finish(owned());
  if (!path){ say('I can\'t find a way back to the station from here. Undo a few pieces and try again.', 'bad'); return; }
  building.push(...path); buildT = 0;
}
function clearTrack(){
  const go = () => { building.length = 0; track.reset(); changed(); sfx.undo(); closePanels(); };
  if (track.pieces.length <= 1) return;
  showPanel({ title: 'Start again?', sections: [{ text: 'Take away all of the track (but keep the station)?' }, { buttons: [{ label: 'Yes, clear it', kind: 'danger', go }, { label: 'No', go: closePanels }] }] });
}
// whenever the track changes: the train goes back to the station, people get off
function changed(){
  if (view === 'ride') stopRide();
  park.clearRiders(cur);
  train.reset();
  cur.rerate();
  park.save();
  orbit.follow = true;
  refreshPalette(); updateHUD(); refreshTablet();
}

// ---------- the palette (screen) ----------
const icons = {}; for (const t of BUILD_ORDER) icons[t] = pieceIcon(t, 96);
function refreshPalette(){
  const P = $('palette'); P.innerHTML = '';
  const tool = (ic, label, go, cls = '') => { const b = document.createElement('button'); b.className = 'pb tool ' + cls; b.innerHTML = `<span class="ic">${ic}</span>${label}`; b.onclick = () => { startAudio(); go(); }; P.appendChild(b); return b; };
  tool('↶', 'Undo', undo);
  if (!track.complete) tool('✓', 'Finish', finishTrack, 'go');
  for (const t of BUILD_ORDER){
    const P0 = PIECES[t], own = park.owns(P0.group);
    if (!own && t !== GROUPS[P0.group].pieces[0]) continue;     // show one locked piece per pack
    const b = document.createElement('button'); b.className = 'pb' + (own ? '' : ' locked');
    const img = new Image(); img.src = icons[t].toDataURL(); b.appendChild(img);
    const l = document.createElement('span'); l.textContent = own ? P0.name : GROUPS[P0.group].name; b.appendChild(l);
    if (!own){ const pr = document.createElement('span'); pr.className = 'price'; pr.textContent = '🔒 ' + cost(GROUPS[P0.group].price); b.appendChild(pr); }
    b.onclick = () => { startAudio(); addPiece(t); };
    b.onpointerenter = (e) => { if (e.pointerType === 'mouse' && own && !track.complete){ const c = track.check(t); track.preview(t, c.ok, c.s, 999); } };
    b.onpointerleave = () => { if (track.ghostT > 100) track.clearGhost(); };
    P.appendChild(b);
  }
  const sep = document.createElement('div'); sep.className = 'sep'; P.appendChild(sep);
  tool('🗑', 'Clear', clearTrack);
}

// ---------- HUD ----------
function updateHUD(){
  if (mode !== 'screen') return;
  const S = park.state, R = cur.rating;
  $('h-name').textContent = '🎢 ' + cur.name;
  $('h-money').textContent = park.free ? '🌈 Free build' : fmtMoney(S.money);
  if (track.complete){
    $('h-rate').innerHTML = `⭐ Fun <b>${R.excitement.toFixed(1)}</b> · 😱 Scary <b>${R.intensity.toFixed(1)}</b><br>🎟 Ticket <b>${fmtMoney(cur.ticket(R))}</b> · 👥 Waiting <b>${park.queueLength(cur)}</b><br>🏆 Riders <b>${(cur.data.riders || 0).toLocaleString()}</b>${park.coasters.length > 1 ? ` · park <b>${S.riders.toLocaleString()}</b>` : ''}`;
  } else $('h-rate').innerHTML = `🚧 <b>Build back to the station</b><br>to open your coaster!`;
  $('b-ride').disabled = !track.complete;
  $('b-ride').textContent = view === 'ride' ? '⬅ Get off' : '🎢 Ride it!';
  $('b-watch').disabled = !track.complete;
  $('b-watch').textContent = view === 'watch' ? '🏗 Build' : '🎥 Watch';
  $('b-speed').textContent = `⚡ ${SPEEDS[cur.data.speed].name}`;
  document.body.classList.toggle('riding', view === 'ride');
  document.body.classList.toggle('watching', view === 'watch');
  $('b-look').style.display = view === 'ride' ? '' : 'none';
  $('b-off').textContent = view === 'ride' ? '⬅ Get off' : '🏗 Build';
}
function moneyPop(text){
  const p = document.createElement('div'); p.className = 'pop'; p.textContent = text; $('h-money').appendChild(p);
  setTimeout(() => p.remove(), 1500);
}

// ---------- panels: shop, speed, menu ----------
function showPanel(spec){ if (mode === 'vr'){ vrPage = spec; refreshTablet(); } else panel.show(spec); }
function closePanels(){ panel.close(); vrPage = null; refreshTablet(); }
function cartIcon(c){
  const cv = document.createElement('canvas'); cv.width = cv.height = 96; const g = cv.getContext('2d');
  const cols = { classic: ['#d8282a', '#f0f0f0'], ocean: ['#1e6ad8', '#ffffff'], lightning: ['#f6cc1a', '#1a1a1a'], dragon: ['#2a9a3a', '#e8c040'], shark: ['#7a8a9a', '#f4f4f4'], rocket: ['#e8eaf0', '#d8302a'], rainbow: ['#e83a3a', '#3a7ae8'], gold: ['#e8b830', '#7a2ab0'] }[c.id];
  g.fillStyle = '#1e3a7a'; g.fillRect(0, 0, 96, 96);
  g.fillStyle = cols[0]; g.beginPath(); g.moveTo(8, 40); g.lineTo(80, 40); g.quadraticCurveTo(92, 40, 92, 58); g.lineTo(92, 66); g.lineTo(8, 66); g.closePath(); g.fill();
  g.fillStyle = cols[1]; g.fillRect(8, 52, 84, 5);
  if (c.id === 'rainbow') ['#e83a3a', '#f0a020', '#3ab84a', '#3a7ae8'].forEach((x, i) => { g.fillStyle = x; g.fillRect(8 + i * 21, 40, 21, 12); });
  g.fillStyle = '#2a2a2e'; for (const x of [24, 72]){ g.beginPath(); g.arc(x, 70, 7, 0, 7); g.fill(); }
  g.font = '30px sans-serif'; g.textAlign = 'center'; g.fillText({ classic: '🎢', ocean: '🌊', lightning: '⚡', dragon: '🐉', shark: '🦈', rocket: '🚀', rainbow: '🌈', gold: '👑' }[c.id], 48, 32);
  return cv;
}
const cartIcons = Object.fromEntries(CARTS.map((c) => [c.id, cartIcon(c)]));
let shopTab = 'parts';
function shop(tab = shopTab){
  shopTab = tab;
  const S = park.state, D = cur.data;
  const tabs = [['parts', '🛤 Track parts'], ['carts', '🚃 Trains'], ['paint', '🎨 Paint']].map(([k, l]) => ({ label: l, on: tab === k, go: () => shop(k) }));
  const sections = [];
  if (tab === 'parts'){
    sections.push({ text: 'New kinds of track. Buy them once and use them as much as you like.' });
    sections.push({ rows: Object.entries(GROUPS).filter(([k]) => k !== 'starter').map(([k, G]) => {
      const own = park.owns(k);
      return { title: G.name, sub: G.text, icon: icons[G.pieces[0]], on: own, button: own ? { label: '✓ Yours', disabled: true, go(){} } : { label: cost(G.price), disabled: !park.afford(G.price), go: () => buyGroup(k) } };
    }) });
  } else if (tab === 'carts'){
    sections.push({ text: `Cool new trains. Buy one once and use it on any of your coasters (this one is ${cur.name}).` });
    sections.push({ rows: CARTS.map((c) => {
      const own = park.hasCart(c.id), using = train.style === c.id;
      return { title: c.name, sub: c.text, icon: cartIcons[c.id], on: using, button: using ? { label: '✓ Riding', disabled: true, go(){} } : own ? { label: 'Use it', go: () => { D.cart = c.id; train.setStyle(c.id); sfx.click(); park.save(); shop('carts'); } } : { label: cost(c.price), disabled: !park.afford(c.price), go: () => buyCart(c) } };
    }) });
  } else {
    sections.push({ text: `Pick a colour for ${cur.name}'s track (free!).` });
    sections.push({ grid: COLORS.map((c, i) => ({ label: c.name, on: track.color === i, icon: swatch(c.rail), go: () => { D.color = i; track.setColor(i); sfx.click(); park.save(); shop('paint'); } })) });
  }
  showPanel({ title: '🛒 Shop', money: cash(), tabs, sections, onClose(){} });
}
function swatch(hex){ const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.fillStyle = '#' + hex.toString(16).padStart(6, '0'); g.beginPath(); g.arc(32, 32, 26, 0, 7); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 4; g.stroke(); return c; }
function buyGroup(k){
  const G = GROUPS[k];
  if (!park.spend(G.price)){ say('Not enough money yet!', 'bad'); return; }
  if (!park.state.groups.includes(k)) park.state.groups.push(k); sfx.buy(); park.save();
  say(`You bought ${G.name}! Find ${G.pieces.length > 1 ? 'them' : 'it'} at the bottom.`, 'good');
  refreshPalette(); shop('parts');
}
function buyCart(c){
  if (!park.spend(c.price)){ say('Not enough money yet!', 'bad'); return; }
  if (!park.state.carts.includes(c.id)) park.state.carts.push(c.id);
  cur.data.cart = c.id; train.setStyle(c.id); sfx.buy(); park.save();
  say(`Your coaster now has the ${c.name} train!`, 'good');
  shop('carts');
}
function speedPanel(){
  const S = cur.data;
  const rows = SPEEDS.map((sp, i) => {
    const r = track.complete ? track.rate(sp.v) : null;
    return { title: `${sp.icon} ${sp.name}`, sub: r ? `Fun ${r.excitement.toFixed(1)} · Scary ${r.intensity.toFixed(1)} · ticket ${fmtMoney(Math.round(2 + r.excitement * 2))}` : `Leaves the station at ${Math.round(sp.v * 2.237)} mph`, on: S.speed === i,
      button: S.speed === i ? { label: '✓ Now', disabled: true, go(){} } : { label: 'Pick', go: () => setSpeed(i, true) } };
  });
  showPanel({ title: `⚡ How fast is ${cur.name}?`, sections: [{ text: 'Faster is more fun, and people pay more... but if it gets too scary (over 7) some won\'t ride.' }, { rows }] });
}
function setSpeed(i, reopen){
  cur.data.speed = clamp(i, 0, SPEEDS.length - 1); cur.rerate(); park.save(); sfx.click();
  updateHUD(); refreshTablet();
  if (reopen) speedPanel();
}
function menu(){
  const S = park.state;
  showPanel({ title: '☰ ' + S.name, sections: [
    { text: park.free ? `🌈 A free-build park: everything is free! · Riders: ${S.riders}` : `Money: ${fmtMoney(S.money)} · Earned so far: ${fmtMoney(S.earned)} · Riders: ${S.riders}` },
    { heading: 'How to play', list: [
      'Tap the track pieces at the bottom to add them to the end of your track (the yellow arrow).',
      'Get back round to the station (from behind it, at ground level) to finish your coaster. “Finish” does it for you.',
      'People come and ride. Each ride earns you a ticket. A more fun coaster has a dearer ticket and more people.',
      'Buy hills, big drops, loops, barrel rolls, upside-down track and jumps in the Shop, and new trains and colours.',
      'Your theme parks: make as many parks as you like from the title screen. Each has its own name, coasters and money.',
      'Coasters: build more coasters side by side to make a theme park, and save designs you like to build again. Make one a hanging coaster to ride under the track!',
      'To go really fast, climb up high (a chain lift pulls you up) and then take a big drop.',
      'Too fast or too wild and some people will be too scared to ride!',
    ] },
    { buttons: [{ label: 'Back to the game', kind: 'primary', go: closePanels }, { label: '🏞 Other parks', go: () => { closePanels(); toTitle(); openParks(); } }, { label: 'Title screen', go: () => { closePanels(); toTitle(); } }] },
  ] });
}
// ---------- your coasters, and saved designs ----------
function coastersPanel(){
  const S = park.state, price = park.newPrice, plot = park.nextPlot();
  const rows = park.coasters.map((c) => {
    const R = c.rating, here = c === cur;
    return { title: c.name, on: here, icon: icons[c.track.types().find((t) => ['loop', 'roll', 'hang', 'jump', 'steepDown'].includes(t)) || 'left'],
      sub: c.track.complete ? `Fun ${R.excitement.toFixed(1)} · ${c.data.riders || 0} riders · ${fmtMoney(c.data.earned || 0)} earned` : `Being built (${c.track.types().length} pieces)`,
      button: here ? { label: '✓ Here', disabled: true, go(){} } : { label: 'Go there', go: () => { select(c, true); closePanels(); say(`Now building ${c.name}.`, ''); } } };
  });
  showPanel({ title: '🎢 Your coasters', money: cash(), sections: [
    { text: 'Build a whole theme park! Every coaster earns money on its own. Tap one to go and build or ride it.' },
    { rows },
    { buttons: [
      { label: plot < 0 ? 'The park is full' : `＋ New coaster (${cost(price)})`, kind: 'primary', disabled: plot < 0 || !park.afford(price), go: newCoaster },
    ] },
    { heading: cur.name + (cur.track.hang ? ' (hanging coaster)' : ''), buttons: [
      { label: cur.track.hang ? '⬆ Make it sit on top' : '🦇 Make it a hanging coaster', go: toggleHang },
      { label: '✏ Rename', go: renameCoaster },
      { label: '💾 Save design', go: saveDesign },
      { label: `📂 Saved designs (${park.designs.length})`, go: designsPanel },
      { label: '💥 Knock down', kind: 'danger', disabled: park.coasters.length <= 1, go: knockDown },
    ] },
  ] });
}
// a hanging coaster: the track is above you and your feet dangle
function toggleHang(){
  if (view === 'ride') stopRide();
  building.length = 0;
  const r = cur.setHang(!cur.track.hang);
  changed(); sfx.done();
  const what = cur.track.hang ? `${cur.name} is a hanging coaster now: the track is above you!` : `${cur.name} sits on top of its track again.`;
  say(r.kept < r.of ? `${what} (only ${r.kept} of ${r.of} pieces fit: finish it off yourself)` : what, r.kept < r.of ? 'bad' : 'good');
  coastersPanel();
}
function newCoaster(){
  const c = park.addCoaster();
  if (!c){ say('Not enough money yet!', 'bad'); return; }
  sfx.buy(); park.save();
  select(c, true); closePanels();
  say(`${c.name} has a brand new station! Build its track.`, 'good');
}
function renameCoaster(){
  let name;
  if (mode === 'vr'){ const used = park.coasters.map((c) => c.name); const free = NAMES.filter((n) => !used.includes(n)); name = free[Math.floor(Math.random() * free.length)]; }
  else name = prompt('What is this coaster called?', cur.name);
  if (!name || !name.trim()) return;
  park.rename(cur, name.trim().slice(0, 24)); park.save(); sfx.click();
  coastersPanel(); updateHUD();
}
function knockDown(){
  const c = cur;
  showPanel({ title: `Knock down ${c.name}?`, sections: [
    { text: 'The station and all of its track will be gone for good. (Save its design first if you might want it again!)' },
    { buttons: [{ label: '💾 Save design first', go: () => { saveDesign(); knockDown(); } }, { label: '💥 Knock it down', kind: 'danger', go: () => {
      if (view === 'ride') stopRide();
      if (park.removeCoaster(c)){ sfx.undo(); select(park.current, true); park.save(); closePanels(); say(`${c.name} is gone.`, ''); }
    } }, { label: 'No', go: coastersPanel }] },
  ] });
}
function saveDesign(){
  if (track.pieces.length <= 1){ say('Build some track first!', 'bad'); return; }
  const name = park.saveDesign(cur);
  sfx.buy(); say(`Saved “${name}”. Build it again any time from Saved designs.`, 'good');
  if (panel.open || vrPage) designsPanel();
}
function designsPanel(){
  const rows = park.designs.map((d, i) => {
    const miss = park.missing(d, PIECES);
    const loops = d.track.filter((t) => PIECES[t] && PIECES[t].inversions).length;
    return { title: d.name, icon: icons[d.track.find((t) => ['loop', 'roll', 'hang', 'jump', 'steepDown'].includes(t)) || 'left'],
      sub: miss.length ? `Needs: ${miss.map((g) => GROUPS[g].name).join(', ')}` : `${d.track.length} pieces${loops ? ` · ${loops} upside down` : ''}${d.hang ? ' · hanging' : ''}`,
      button: { label: 'Build here', disabled: miss.length > 0, go: () => buildDesign(i) } };
  });
  showPanel({ title: '📂 Saved designs', money: cash(), sections: [
    { text: rows.length ? `“Build here” puts a design on ${cur.name} (its track now is taken away). Saved designs stay even if you start a new park.` : 'No saved designs yet. Build a coaster you like and press “Save design”.' },
    { rows },
    ...(rows.length ? [{ heading: 'Throw a design away', buttons: park.designs.slice(0, 6).map((d, i) => ({ label: '✕ ' + d.name, go: () => { park.designs.splice(i, 1); park.saveDesigns(); sfx.undo(); designsPanel(); } })) }] : []),
    { buttons: [{ label: '💾 Save this one', go: saveDesign }, { label: '⬅ Coasters', go: coastersPanel }] },
  ] });
}
function buildDesign(i){
  const d = park.designs[i];
  if (view === 'ride') stopRide();
  building.length = 0;
  if (!!d.hang !== cur.track.hang){ cur.data.hang = !!d.hang; cur.track.hang = !!d.hang; train.setStyle(train.style); }
  track.load(d.track);
  if (d.color != null){ track.setColor(d.color); cur.data.color = d.color; }
  if (d.cart && park.hasCart(d.cart)){ train.setStyle(d.cart); cur.data.cart = d.cart; }
  if (d.speed != null) cur.data.speed = d.speed;
  changed();
  const got = track.types().length;
  closePanels();
  if (got < d.track.length) say(`Only ${got} of ${d.track.length} pieces fit here (something is in the way). Finish it off yourself!`, 'bad');
  else { sfx.done(); say(`${cur.name} is now “${d.name}”!`, 'good'); }
}
$('b-shop').onclick = () => { startAudio(); sfx.click(); shop(); };
$('b-speed').onclick = () => { startAudio(); sfx.click(); speedPanel(); };
$('b-coasters').onclick = () => { startAudio(); sfx.click(); coastersPanel(); };
$('b-menu').onclick = () => { startAudio(); sfx.click(); menu(); };
$('b-ride').onclick = () => { startAudio(); if (view === 'ride') stopRide(); else startRide(); };
$('b-watch').onclick = () => { startAudio(); sfx.click(); if (view === 'ride') stopRide(); view = view === 'watch' ? 'build' : 'watch'; updateHUD(); };
$('b-off').onclick = () => { sfx.click(); if (view === 'ride') stopRide(); else { view = 'build'; updateHUD(); } };
$('b-look').onclick = () => { look.yaw = 0; look.pitch = 0; };

// ---------- riding ----------
function startRide(){
  if (!track.complete){ say('Finish your track first!', 'bad'); return; }
  closePanels();
  const v = train.seats[0];
  if (v && v !== 'player'){
    const free = train.emptySeats().find((i) => i > 0);
    if (free != null) train.seatRider(free, v); else { v.state = 'queue'; v.root.visible = true; v.joined = -1; }
  }
  train.seatRider(0, 'player');
  view = 'ride'; look.yaw = 0; look.pitch = 0;
  if (mode === 'vr') vrSeat();
  sfx.click(); updateHUD(); refreshTablet();
}
function stopRide(){
  if (train.seats[0] === 'player') train.seatRider(0, null);
  view = 'build';
  if (mode === 'vr') vrStand();
  updateHUD(); refreshTablet();
}

// ---------- screen input: orbit, look, zoom, pan ----------
const pointers = new Map();
let pinch = null;
const keys = {};
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (mode !== 'screen') return;
  startAudio();
  renderer.domElement.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2){ const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; }
});
renderer.domElement.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId); if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (pointers.size >= 2 && pinch){
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    if (view !== 'ride'){ orbit.dist = clamp(orbit.dist * pinch.d / Math.max(20, d), 8, 220); pan(mx - pinch.mx, my - pinch.my); }
    pinch = { d, mx, my };
    return;
  }
  if (view === 'ride'){ look.yaw = clamp(look.yaw - dx * 0.005, -2.6, 2.6); look.pitch = clamp(look.pitch - dy * 0.005, -1.2, 1.2); }
  else { orbit.yaw -= dx * 0.006; orbit.pitch = clamp(orbit.pitch + dy * 0.005, 0.08, 1.45); }
});
const up = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; };
renderer.domElement.addEventListener('pointerup', up); renderer.domElement.addEventListener('pointercancel', up);
renderer.domElement.addEventListener('wheel', (e) => { e.preventDefault(); if (view !== 'ride') orbit.dist = clamp(orbit.dist * Math.exp(e.deltaY * 0.0012), 8, 220); }, { passive: false });
function pan(dx, dy){
  const s = orbit.dist * 0.0022;
  const f = V(-Math.sin(orbit.yaw), 0, -Math.cos(orbit.yaw)), r = V(Math.cos(orbit.yaw), 0, -Math.sin(orbit.yaw));
  orbit.target.addScaledVector(r, -dx * s).addScaledVector(f, dy * s);
  clampTarget(); orbit.follow = false;
}
function clampTarget(){ const L = TILE * (GRID_X + 4); orbit.target.x = clamp(orbit.target.x, -L, L); orbit.target.z = clamp(orbit.target.z, -TILE * (GRID_N + 1), TILE * (GRID_S + 1) + 40); }
addEventListener('keydown', (e) => {
  if (mode !== 'screen') return;
  keys[e.code] = true;
  if (e.code === 'KeyZ' || e.code === 'Backspace'){ e.preventDefault(); undo(); }
  if (e.code === 'KeyR'){ if (view === 'ride') stopRide(); else startRide(); }
  if (e.code === 'Escape'){ if (panel.open) closePanels(); else if (view !== 'build'){ if (view === 'ride') stopRide(); view = 'build'; updateHUD(); } }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });

function placeScreenCamera(dt){
  rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0); rig.scale.setScalar(1);
  if (view === 'ride'){
    const car = train.cars[0];
    camera.position.copy(train.seatEye());
    camera.quaternion.copy(car.quaternion).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(look.pitch, look.yaw, 0, 'YXZ')));
    if (!pointers.size){ look.yaw = damp(look.yaw, 0, 0.4, dt); look.pitch = damp(look.pitch, 0, 0.4, dt); }
    camera.fov = 78; camera.updateProjectionMatrix();
    return;
  }
  camera.fov = 60; camera.updateProjectionMatrix();
  // keyboard: WASD moves, arrows turn
  const k = (c) => (keys[c] ? 1 : 0);
  const mx = k('KeyD') - k('KeyA'), mz = k('KeyS') - k('KeyW');
  if (mx || mz) pan(-mx * 600 * dt, -mz * 600 * dt);
  orbit.yaw += (k('ArrowLeft') - k('ArrowRight')) * dt * 1.5;
  orbit.pitch = clamp(orbit.pitch + (k('ArrowUp') - k('ArrowDown')) * dt, 0.08, 1.45);
  let target = orbit.target;
  if (view === 'watch'){
    const c = train.cars[1].position;
    orbit.watch = orbit.watch || c.clone(); orbit.watch.lerp(c, Math.min(1, dt * 4));
    target = orbit.watch;
    // swing round behind the train (and a little to the side) unless you're turning the camera yourself
    if (!pointers.size && train.frontFwd && train.v > 1){
      const f = train.frontFwd, want = Math.atan2(-f.x, -f.z) + 0.7;
      orbit.yaw += Math.atan2(Math.sin(want - orbit.yaw), Math.cos(want - orbit.yaw)) * (1 - Math.exp(-1.2 * dt));
      orbit.pitch = damp(orbit.pitch, 0.38, 1, dt);
    }
  } else if (orbit.follow){
    const e = track.endPoint(); e.y = Math.max(0, e.y - 2);
    if (track.complete) e.set(cur.ox, 0, 0);
    orbit.target.lerp(e, Math.min(1, dt * 2.5));
  }
  const d = view === 'watch' ? clamp(orbit.dist, 10, 24) : orbit.dist;
  camera.position.set(target.x + Math.sin(orbit.yaw) * Math.cos(orbit.pitch) * d, target.y + Math.sin(orbit.pitch) * d, target.z + Math.cos(orbit.yaw) * Math.cos(orbit.pitch) * d);
  camera.position.y = Math.max(1.2, camera.position.y);
  camera.lookAt(target);
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
// simple hands: a rounded controller shape in each hand
const handMeshes = [0, 1].map((i) => {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.025, 0.08, 4, 10), new THREE.MeshStandardMaterial({ color: i ? 0x2a6ad8 : 0xd8302a, roughness: 0.5 }));
  m.rotation.x = Math.PI / 2; g.add(m);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 6, 16), new THREE.MeshStandardMaterial({ color: 0xffe040 })); ring.position.set(0, 0.02, -0.04); ring.rotation.x = 0.6; g.add(ring);
  g.visible = false; scene.add(g); return g;
});
// the tablet sits above your left hand, facing you
const tabletHolder = new THREE.Group(); scene.add(tabletHolder);
tabletHolder.add(tablet.mesh); tablet.mesh.position.set(0, 0.2, -0.05); tablet.mesh.rotation.x = -0.35;
tabletHolder.visible = false;
const laser = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 1, 6), new THREE.MeshBasicMaterial({ color: 0xffe040, transparent: true, opacity: 0.7 }));
laser.geometry.translate(0, 0.5, 0); laser.geometry.rotateX(-Math.PI / 2); laser.visible = false; scene.add(laser);
const dot = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff })); dot.visible = false; scene.add(dot);
const headPos = V(), headQuat = new THREE.Quaternion();
const v1 = V(), v2 = V();
const vrs = { giant: true, tablet: true, snapReady: true, seatHead: null, seatYaw: 0 };
let vrPage = null;

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
  for (const h of vr){ const m = handMeshes[h.i]; m.visible = h.tracked; if (h.tracked){ m.position.copy(h.pos); m.quaternion.copy(h.quat); m.scale.setScalar(rig.scale.x); } }
  // the tablet on the left hand
  tabletHolder.visible = L.tracked && vrs.tablet;
  if (tabletHolder.visible){ tabletHolder.position.copy(L.pos); tabletHolder.quaternion.copy(L.quat); tabletHolder.scale.setScalar(rig.scale.x); }
  // pointing with the right hand
  laser.visible = false; dot.visible = false;
  if (R.tracked && tabletHolder.visible){
    const dir = V(0, 0, -1).applyQuaternion(R.rayQuat);
    tabletHolder.updateMatrixWorld(true);
    const hit = tablet.ray(R.rayPos, dir, R.triggerDown, 3 * rig.scale.x);
    if (hit){
      laser.visible = true; dot.visible = true;
      laser.position.copy(R.rayPos); laser.lookAt(hit.point); laser.scale.set(rig.scale.x, rig.scale.x, R.rayPos.distanceTo(hit.point));
      dot.position.copy(hit.point); dot.scale.setScalar(rig.scale.x);
      if (hit.clicked){ R.haptic(0.3, 30); sfx.click(); refreshTablet(); }
      if (Math.abs(R.stick.y) > 0.3) tablet.scrollBy(R.stick.y * dt * 900);
    }
  }
  // buttons: A rides, B giant size, X/Y shows or hides the tablet
  if (R.aDown){ if (view === 'ride') stopRide(); else startRide(); }
  if (R.bDown){ if (view === 'ride') stopRide(); else setGiant(!vrs.giant); }
  if (L.aDown || L.bDown){ vrs.tablet = !vrs.tablet; }
  if (view === 'ride') return;     // (the seat is placed after the train moves)
  // turning (snap, round your head)
  const sx = R.stick.x;
  if (Math.abs(sx) > 0.7 && vrs.snapReady && !laser.visible){ turnRig(-Math.sign(sx) * Math.PI / 6); vrs.snapReady = false; }
  if (Math.abs(sx) < 0.35) vrs.snapReady = true;
  // walking (or striding, when you're a giant) where you look
  let mx = L.stick.x, my = L.stick.y; if (Math.hypot(mx, my) < 0.15){ mx = 0; my = 0; }
  if (mx || my){
    const f = V(0, 0, -1).applyQuaternion(headQuat); f.y = 0; f.normalize();
    const r = V(-f.z, 0, f.x);
    const sp = 3.2 * rig.scale.x * dt;
    rig.position.addScaledVector(f, -my * sp).addScaledVector(r, mx * sp);
    const lim = TILE * (GRID_X + 6); rig.position.x = clamp(rig.position.x, -lim, lim); rig.position.z = clamp(rig.position.z, -TILE * (GRID_N + 2), TILE * (GRID_S + 2) + 40);
  }
}
function turnRig(a){ v1.copy(headPos); rig.position.sub(v1).applyAxisAngle(V(0, 1, 0), a).add(v1); rig.rotation.y += a; rig.updateMatrixWorld(true); }
// giant size: the park becomes a model you can stand over and build on
const GIANT = 9;
function setGiant(on){
  vrs.giant = on;
  const before = V(headPos.x, 0, headPos.z);
  rig.scale.setScalar(on ? GIANT : 1);
  rig.updateMatrixWorld(true);
  const local = camera.position.clone().multiplyScalar(rig.scale.x).applyQuaternion(rig.quaternion);
  rig.position.set(before.x - local.x, 0, before.z - local.z);
  sfx.whoosh(); refreshTablet();
}
function vrSeat(){
  // you sit in the front seat: the whole play space rides with the car
  const car = train.cars[0];
  if (!vrs.seatHead){
    // remember how your head sits in the play space, so it lines up with the seat
    vrs.seatHead = camera.position.clone();
    const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ'); vrs.seatYaw = e.y;
  }
  rig.scale.setScalar(1);
  const q = car.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), -vrs.seatYaw));
  rig.quaternion.copy(q);
  const eye = train.seatEye();
  rig.position.copy(eye).sub(vrs.seatHead.clone().applyQuaternion(q));
  rig.updateMatrixWorld(true);
}
function vrStand(){
  vrs.seatHead = null;
  rig.quaternion.identity(); rig.rotation.set(0, 0, 0);
  rig.scale.setScalar(vrs.giant ? GIANT : 1);
  const ox = cur ? cur.ox : 0;
  if (vrs.giant) rig.position.set(ox - camera.position.x * GIANT, 0, 46 - camera.position.z * GIANT);
  else rig.position.set(ox + 12 - camera.position.x, 0, 16 - camera.position.z);
  rig.updateMatrixWorld(true);
}

// the tablet's pages
let tabletT = 0;
function refreshTablet(){ tabletT = 0; }
function tabletSpec(){
  const S = park.state, R = cur.rating, D = cur.data;
  if (vrPage) return { ...vrPage, sections: [...(vrPage.sections || []), { buttons: [{ label: '⬅ Back', go: () => { vrPage = null; refreshTablet(); } }] }] };
  if (view === 'ride'){
    return { title: '🎢 Riding!', money: cash(), sections: [
      { text: `Speed: ${Math.round(train.v * 2.237)} mph · ${SPEEDS[D.speed].name}` },
      { buttons: [{ label: '⬅ Get off (A)', kind: 'danger', go: stopRide }] },
      { buttons: [{ label: '− Slower', disabled: D.speed === 0, go: () => setSpeed(D.speed - 1) }, { label: '+ Faster', disabled: D.speed === SPEEDS.length - 1, go: () => setSpeed(D.speed + 1) }] },
    ] };
  }
  const grid = [];
  for (const t of BUILD_ORDER){
    const P0 = PIECES[t], own = park.owns(P0.group);
    if (!own && t !== GROUPS[P0.group].pieces[0]) continue;
    grid.push(own ? { label: P0.name, icon: icons[t], disabled: track.complete, go: () => addPiece(t) } : { label: '🔒 ' + cost(GROUPS[P0.group].price), icon: icons[t], go: () => shop('parts') });
  }
  const last = msgs.length ? msgs[msgs.length - 1].text : null;
  const status = last || (track.complete ? `Open! ⭐ Fun ${R.excitement.toFixed(1)} · 😱 ${R.intensity.toFixed(1)} · 🎟 ${fmtMoney(cur.ticket(R))} · 👥 ${park.queueLength(cur)}` : 'Build back round to the station!');
  return { title: cur.name, money: cash(), sections: [
    { text: status },
    { grid, cols: 4, cellH: 150 },
    { buttons: [{ label: '↶ Undo', go: undo }, { label: '✓ Finish', disabled: track.complete, go: finishTrack }, { label: '🗑 Clear', go: clearTrack }] },
    { buttons: [{ label: '−', disabled: D.speed === 0, go: () => setSpeed(D.speed - 1) }, { label: `⚡ ${SPEEDS[D.speed].name}`, go: speedPanel }, { label: '+', disabled: D.speed === SPEEDS.length - 1, go: () => setSpeed(D.speed + 1) }] },
    { buttons: [{ label: '🎢 Ride (A)', kind: 'primary', disabled: !track.complete, go: startRide }, { label: vrs.giant ? '🧍 Normal (B)' : '🦖 Giant (B)', go: () => setGiant(!vrs.giant) }, { label: '🛒 Shop', go: () => shop() }] },
    { buttons: [{ label: '🎢 Coasters', go: () => coastersPanel() }, { label: '💾 Save design', go: saveDesign }] },
  ] };
}

// ---------- the loop ----------
const clock = new THREE.Clock();
function frame(){
  try { step(); } catch (e) { console.error(e); }
}
function step(){
  const dt = Math.min(clock.getDelta(), 1 / 20);
  const T = window.__rcb, steps = T && T.timeScale > 1 ? Math.round(T.timeScale) : 1;
  for (let k = 0; k < steps; k++){ gameTime += dt; simulate(dt, k === 0); }
  if (T && T.noRender) return;
  if (mode !== 'vr') placeScreenCamera(dt);
  renderer.render(scene, camera);
}
function simulate(dt, first){
  if (mode === 'vr'){
    rig.updateMatrixWorld(true);
    renderer.xr.getCamera().matrixWorld.decompose(headPos, headQuat, v1);
    vrUpdate(dt);
  } else { camera.updateMatrixWorld(true); camera.matrixWorld.decompose(headPos, headQuat, v1); }
  if (mode === 'title') titleSpin(dt);
  // pieces from Finish go down one at a time
  if (building.length){ buildT -= dt; if (buildT <= 0){ buildT = 0.13; const t = building.shift(); if (!addPiece(t, true)){ building.length = 0; say('Something is in the way. Try Finish again.', 'bad'); } } }
  for (const c of park.coasters) c.train.update(dt, c.speedV, gameTime);
  if (mode === 'vr' && view === 'ride') vrSeat();
  park.update(dt);
  track.update(dt, gameTime, mode !== 'title' && view === 'build');
  // screams on the big moments
  screamT -= dt;
  for (const c of park.coasters){ const T = c.train; if (T.thrill > 1.2 && screamT <= 0 && T.riders().length){ screamT = 3 + Math.random() * 3; sfx.scream(T.cars[1].position, Math.min(4, 1 + T.riders().length / 3)); } }
  // the rumble comes from the train you're on, or the nearest one
  const near = view === 'ride' ? train : park.coasters.map((c) => c.train).reduce((a, b) => (b.cars[1].position.distanceTo(headPos) < a.cars[1].position.distanceTo(headPos) ? b : a));
  trainSound(near.cars[1].position, near.v, view === 'ride');
  // the sun's shadows follow what you're looking at
  const focus = mode === 'vr' ? headPos : (view === 'ride' || view === 'watch') ? train.cars[1].position : orbit.target;
  sun.target.position.set(Math.round(focus.x), 0, Math.round(focus.z));
  sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 150);
  skyDome.position.copy(headPos);
  setListener(headPos, v1.set(0, 0, -1).applyQuaternion(headQuat), v2.set(0, 1, 0).applyQuaternion(headQuat));
  if (!first) return;
  // money coming in
  if (payN && gameTime - lastPay > 1.2){ lastPay = gameTime; if (mode === 'screen') moneyPop('+' + fmtMoney(payAcc)); sfx.coin(); payAcc = 0; payN = 0; refreshTablet(); }
  for (const m of msgs) m.t -= dt;
  if (msgs.length && msgs[0].t <= 0){ while (msgs.length && msgs[0].t <= 0) msgs.shift(); drawMsgs(); }
  hudT -= dt; if (hudT <= 0){ hudT = 0.3; updateHUD(); if (view === 'ride') $('speedo').textContent = `${Math.round(train.v * 2.237)} mph`; else if (view === 'watch') $('speedo').textContent = `🎥 ${Math.round(train.v * 2.237)} mph`; }
  if (mode === 'vr'){ tabletT -= dt; if (tabletT <= 0){ tabletT = view === 'ride' ? 0.25 : 1; tablet.show(tabletSpec()); } }
  saveT += dt; if (saveT > 10 && mode !== 'title'){ saveT = 0; park.save(); }
}
renderer.setAnimationLoop(frame);

// ---------- title screen ----------
let spin = 0;
function titleSpin(dt){
  spin += dt * 0.05;
  rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0); rig.scale.setScalar(1);
  orbit.target.set(0, 4, -10); orbit.yaw = spin; orbit.pitch = 0.32; orbit.dist = 62; orbit.follow = false;
}
// a coaster to look at behind the title, when there's no saved park yet
const DEMO = ['straight', 'up', 'steepUp', 'steepDown', 'loop', 'bigLeft', 'straight', 'roll', 'left', 'up', 'down', 'jump', 'left', 'straight'];
function showDemo(){
  park.newGame(); select(park.current);
  track.load(DEMO);
  const f = track.finish(BUILD_ORDER);
  if (f) for (const t of f){ const c = track.check(t); if (!c.ok) break; const e = track.end; track.place(t, e.i, e.j, e.level, e.d, c); }
  track.changed(); train.setStyle('dragon'); train.reset(); cur.rerate();
}
function toTitle(){
  if (renderer.xr.isPresenting) renderer.xr.getSession().end();
  park.save();
  mode = 'title'; view = 'build'; $('title').classList.remove('hidden'); document.body.classList.remove('playing');
  refreshTitle();
}
function refreshTitle(){
  const idx = readParks(), p = idx.list.find((q) => q.id === idx.current);
  $('t-park').innerHTML = '';
  if (p){
    const b = document.createElement('b'); b.textContent = p.name;
    $('t-park').append('🏞 ', b, ` · ${p.free ? '🌈 free build' : fmtMoney(p.money ?? 200)} · ${p.coasters || 1} coaster${(p.coasters || 1) > 1 ? 's' : ''}`);
  }
  $('b-parks').textContent = idx.list.length ? `🏞 Your theme parks (${idx.list.length})` : '🏞 Your theme parks';
}
// behind the title: the park you'll play, or a demo coaster
function titleScene(){
  if (park.load() && park.coasters.some((c) => c.track.pieces.length > 1)) select(park.current);
  else showDemo();
  refreshPalette();
}
// load the park you're playing (there always is one by now)
function ensureGame(){
  if (!park.state.id && !park.load()) park.newGame();
  view = 'build';
  select(park.current);
  orbit.target.copy(track.endPoint()).setY(0); orbit.yaw = 0.7; orbit.pitch = 0.6; orbit.dist = 55; orbit.follow = true;
  refreshPalette();
}
// made: the park was only just made (so it's already loaded)
function startScreen(made){
  if (!made && !readParks().current){ newParkDialog('screen'); return; }
  startAudio(); if (!made) park.load(); ensureGame();
  mode = 'screen'; $('title').classList.add('hidden'); document.body.classList.add('playing');
  clock.getDelta();
  updateHUD();
  if (track.pieces.length <= 1 && !park.state.built) welcome();
}
async function startVR(made){
  if (!made && !readParks().current){ newParkDialog('vr'); return; }
  startAudio(); if (!made) park.load(); ensureGame();
  try {
    const session = await navigator.xr.requestSession('immersive-vr', { requiredFeatures: ['local-floor'], optionalFeatures: ['bounded-floor'] });
    session.addEventListener('end', () => {
      if (mode === 'vr'){ mode = 'title'; view = 'build'; $('title').classList.remove('hidden'); document.body.classList.remove('playing'); camera.position.set(0, 0, 0); camera.quaternion.identity(); park.save(); tabletHolder.visible = false; laser.visible = false; dot.visible = false; for (const m of handMeshes) m.visible = false; refreshTitle(); }
    });
    sun.shadow.mapSize.set(1024, 1024); if (sun.shadow.map){ sun.shadow.map.dispose(); sun.shadow.map = null; }
    await renderer.xr.setSession(session);
    try { if (session.supportedFrameRates && session.updateTargetFrameRate){ const r = [...session.supportedFrameRates]; if (r.includes(72)) await session.updateTargetFrameRate(72); } } catch (e) {}
    mode = 'vr'; $('title').classList.add('hidden');
    vrs.giant = true; vrs.tablet = true; vrPage = null;
    rig.rotation.set(0, 0, 0); rig.scale.setScalar(GIANT); rig.position.set(cur.ox, 0, 46);
    clock.getDelta();
    refreshTablet();
    if (track.pieces.length <= 1 && !park.state.built) welcome();
  } catch (e) { $('status').textContent = 'Could not start VR: ' + (e && e.message ? e.message : e); }
}
function welcome(){
  showPanel({ title: `Welcome to ${park.state.name}!`, sections: [
    { text: 'This is your station. Build a rollercoaster that goes out of the front of it and comes all the way back round into the back of it.' },
    { list: [
      'Tap a track piece to add it where the yellow arrow is.',
      'To start with you only have straights and turns: enough for a simple loop. “Finish” builds the way back for you.',
      'When it\'s finished, people come to ride it and pay for tickets.',
      park.free ? 'This is a free-build park: every track piece and train is yours already, and new coasters are free!' : 'Spend your money on hills, drops, loops, barrel rolls, upside-down track, jumps and cool new trains!',
    ] },
    { buttons: [{ label: 'Let\'s build!', kind: 'primary', go: closePanels }] },
  ] });
}
$('b-play').onclick = () => startScreen(false);
$('b-vr').onclick = () => startVR(false);
$('b-parks').onclick = () => openParks();

// ---------- your theme parks (on the title screen) ----------
function openParks(){
  const idx = readParks(), box = $('parks-list');
  box.innerHTML = '';
  if (!idx.list.length){ const d = document.createElement('p'); d.className = 'pempty'; d.textContent = 'No parks yet. Build your first one!'; box.appendChild(d); }
  for (const p of idx.list){
    const row = document.createElement('div'); row.className = 'prow' + (p.id === idx.current ? ' on' : '');
    const t = document.createElement('div'); t.className = 'pt';
    const n = document.createElement('b'); n.textContent = p.name;
    const sub = document.createElement('small');
    sub.textContent = `${p.free ? '🌈 Free build' : '💰 ' + fmtMoney(p.money ?? 200)} · 🎢 ${p.coasters || 1} · 👥 ${(p.riders || 0).toLocaleString()} riders`;
    t.append(n, sub); row.appendChild(t);
    const play = document.createElement('button'); play.className = 'pplay'; play.textContent = p.id === idx.current ? '✓ Picked' : 'Pick';
    play.onclick = () => { chooseParkId(p.id); titleScene(); refreshTitle(); openParks(); };
    const del = document.createElement('button'); del.className = 'pdel'; del.textContent = '🗑'; del.title = 'Delete this park';
    del.onclick = () => {
      if (!confirm(`Delete ${p.name} for good? Its coasters and money will be gone. (Saved designs are kept.)`)) return;
      deletePark(p.id); titleScene(); refreshTitle(); openParks();
    };
    row.append(play, del); box.appendChild(row);
  }
  $('parks').classList.add('show');
}
function closeParks(){ $('parks').classList.remove('show'); }
$('parks-close').onclick = closeParks;
$('parks-new').onclick = () => { closeParks(); newParkDialog(null); };

// making a park: you have to give it a name, and pick money or free building
let npThen = null, npFree = false;
function newParkDialog(then){
  npThen = then; npFree = false;
  const used = readParks().list.map((p) => p.name), left = PARK_NAMES.filter((n) => !used.includes(n));
  $('np-name').value = ''; $('np-name').placeholder = 'e.g. ' + (left[0] || PARK_NAMES[0]);
  npPick(false); npCheck();
  $('newpark').classList.add('show');
  setTimeout(() => $('np-name').focus(), 50);
}
function npPick(free){ npFree = free; $('np-money').classList.toggle('on', !free); $('np-free').classList.toggle('on', free); }
function npCheck(){ $('np-go').disabled = !$('np-name').value.trim(); }
$('np-money').onclick = () => npPick(false);
$('np-free').onclick = () => npPick(true);
$('np-name').oninput = npCheck;
$('np-name').onkeydown = (e) => { if (e.key === 'Enter' && !$('np-go').disabled) $('np-go').click(); };
$('np-dice').onclick = () => { const used = readParks().list.map((p) => p.name); const left = PARK_NAMES.filter((n) => !used.includes(n)); $('np-name').value = (left.length ? left : PARK_NAMES)[Math.floor(Math.random() * (left.length || PARK_NAMES.length))]; npCheck(); };
$('np-cancel').onclick = () => { $('newpark').classList.remove('show'); openParksIfAny(); };
function openParksIfAny(){ if (readParks().list.length && npThen === null) openParks(); }
$('np-go').onclick = () => {
  const name = $('np-name').value.trim().slice(0, 28);
  if (!name) return;
  $('newpark').classList.remove('show');
  createPark(name, npFree, npThen === 'vr' ? 'vr' : 'screen');
};
function createPark(name, free, then = 'screen'){
  park.create(name, free);
  refreshTitle();
  if (then === 'vr') startVR(true); else if (then === 'screen') startScreen(true); else titleScene();
}
refreshTitle();
if (navigator.xr && navigator.xr.isSessionSupported){
  navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
    $('b-vr').disabled = !ok; $('b-vr').dataset.ok = ok ? '1' : '0';
    $('status').textContent = ok ? 'Headset found: press Enter VR.' : 'No VR headset here: play on this screen (or open this page in a headset\'s browser).';
  }).catch(() => { $('b-vr').disabled = true; });
} else { $('b-vr').disabled = true; $('status').textContent = 'Play on this screen, or open this page in a VR headset\'s browser.'; }
titleScene();

addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
addEventListener('pagehide', () => { if (mode !== 'title') park.save(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && mode !== 'title') park.save(); });

// ---------- for the headless test ----------
window.__rcb = {
  get mode(){ return mode; }, get view(){ return view; }, park, renderer, camera, scene, rig, vr, tablet, orbit, vrs,
  timeScale: 1, noRender: false, version: VERSION, CARTS, get track(){ return track; }, get train(){ return train; },
  startScreen, startVR, toTitle, toggleHang, createPark, openParks, readParks, newParkDialog, addPiece, coastersPanel, newCoaster, saveDesign, designsPanel, buildDesign, select, get cur(){ return cur; }, undo, finishTrack, startRide, stopRide, shop, speedPanel, setSpeed, buyGroup, buyCart, setGiant, closePanels, tabletSpec,
  get building(){ return building.length; }, get time(){ return gameTime; }, get head(){ return headPos.toArray(); },
};
void lerp; void PARK;
