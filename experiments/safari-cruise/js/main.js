// Safari Cruise: the main loop. Plays two ways from the same game:
//  - iPad / phone / computer: a camera that flies over the safari (drag to turn, pinch or scroll to zoom,
//    two fingers or WASD to move); tap animals, trucks and job markers; panels for everything you
//    manage; hop on a tour truck, or drive your own jeep with the thumb stick.
//  - VR (WebXR, e.g. a Quest's browser): you stand in the safari (or tower over it at giant size), a
//    tablet in your left hand holds the same panels, you point with the right controller and pull the
//    trigger. Riding sits you in a truck; driving puts you behind the wheel of your jeep.
import * as THREE from 'three';
import { V, clamp, lerp, damp, angleDiff, fmtMoney } from './util.js';
import { World, ZONES, LANE, IN, OUT } from './world.js';
import { SPECIES } from './animals.js';
import { PlayerJeep, SEATS, TRUCK_COLOURS } from './vehicles.js';
import { Safari, SAVE_KEY, STAFF, JOBS, UPGRADES, TRUCK_PRICE, MAX_TRUCKS, MAX_PER_ZONE, MAX_STAFF, DAY_SECONDS } from './sim.js';
import { ScreenPanel, Tablet } from './ui.js';
import { startAudio, setListener, sfx, engines, call } from './audio.js';

const $ = (id) => document.getElementById(id);
const VERSION = document.body.dataset.version || '';

// ---------- renderer, sky and sun ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true; renderer.xr.setReferenceSpaceType('local-floor'); renderer.xr.setFoveation(0.6);
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 3000);
const rig = new THREE.Group(); rig.add(camera); scene.add(rig);
const SUN_DIR = V(0.5, 0.6, 0.32).normalize();
scene.fog = new THREE.Fog(0xe2d6bc, 220, 1500);
const skyDome = new THREE.Mesh(new THREE.SphereGeometry(2000, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { sun: { value: SUN_DIR } },
  vertexShader: 'varying vec3 d; void main(){ d = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }',
  fragmentShader: `uniform vec3 sun; varying vec3 d;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
    void main(){ vec3 v = normalize(d); float y = max(v.y, 0.0);
      vec3 c = mix(vec3(0.89, 0.84, 0.74), vec3(0.32, 0.55, 0.86), pow(y, 0.5));
      float s = max(dot(v, sun), 0.0); c += vec3(1.0, 0.9, 0.7) * (pow(s, 300.0) * 2.5 + pow(s, 6.0) * 0.18);
      if (v.y > 0.02){ vec2 uv = v.xz / (v.y + 0.12) * 1.4; float k = n(uv) * 0.5 + n(uv * 2.3) * 0.3 + n(uv * 5.1) * 0.2; c = mix(c, vec3(1.0, 0.98, 0.95), smoothstep(0.6, 0.86, k) * smoothstep(0.02, 0.35, v.y) * 0.8); }
      if (v.y < 0.0) c = vec3(0.86, 0.8, 0.68);
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
    }`,
}));
skyDome.frustumCulled = false; skyDome.renderOrder = -1; scene.add(skyDome);
const hemi = new THREE.HemisphereLight(0xdce8ff, 0x8a7448, 1.15); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d8, 2.8);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 400 });
scene.add(sun, sun.target);

// ---------- the game ----------
const world = new World(scene);
const sim = new Safari(world, scene);
const jeep = new PlayerJeep(world);
const panel = new ScreenPanel();
const tablet = new Tablet();
jeep.reset(world.road(world.depotS + 6, -LANE).p, 0);
{ const R = world.road(world.depotS + 6, -LANE); jeep.reset(R.p, Math.atan2(R.t.x, R.t.z)); }

let mode = 'title';             // 'title' | 'screen' | 'vr'
let view = 'map';               // 'map' | 'ride' | 'drive'
let gameTime = 0, saveT = 0, hudT = 0, callT = 5;
const orbit = { target: world.lodgePoint(0, 10).p.clone(), yaw: 2.4, pitch: 0.55, dist: 90, follow: null };
const look = { yaw: 0, pitch: 0 };
let camStyle = 'chase';         // driving: 'chase' | 'cockpit'
let rideTruck = null;
let fixing = null;              // { job, t }
const msgs = [];
const stick = { x: 0, y: 0, id: null };

sim.on('say', ({ text, kind }) => say(text, kind));
sim.on('money', (n) => { if (n > 0){ payAcc += n; } else if (mode === 'screen') moneyPop(fmtMoney(n), true); });
sim.on('day', (r) => {
  sfx.day();
  say(`Day ${r.day} is over: ${r.visitors} visitors · took ${fmtMoney(r.income)} · spent ${fmtMoney(r.costs)} · ${r.profit >= 0 ? 'profit' : 'loss'} ${fmtMoney(Math.abs(r.profit))}`, 'money');
});
sim.on('breakdown', (t) => { sfx.bad(); if (rideTruck === t) say('Oh no, your truck has broken down! A mechanic is on the way.', 'bad'); });
sim.on('didJob', (j) => { sfx.good(); });
let payAcc = 0, lastPay = 0;

function say(text, kind = ''){
  if (msgs.some((m) => m.text === text)) return;
  msgs.push({ text, kind, t: 5 });
  while (msgs.length > 3) msgs.shift();
  if (kind === 'bad') sfx.bad();
  drawMsgs(); refreshTablet();
}
function drawMsgs(){
  const box = $('h-msg'); box.innerHTML = '';
  for (const m of msgs){ const d = document.createElement('div'); d.className = 'msg ' + m.kind; d.textContent = m.text; box.appendChild(d); }
}
function moneyPop(text, neg){
  const p = document.createElement('div'); p.className = 'pop' + (neg ? ' neg' : ''); p.textContent = text; $('h-money').appendChild(p);
  setTimeout(() => p.remove(), 1500);
}

// ---------- icons ----------
const iconCache = new Map();
function icon(e, bg = '#5a3a1a'){
  const k = e + bg; if (iconCache.has(k)) return iconCache.get(k);
  const c = document.createElement('canvas'); c.width = c.height = 96; const g = c.getContext('2d');
  g.fillStyle = bg; g.beginPath(); g.roundRect ? g.roundRect(0, 0, 96, 96, 18) : g.rect(0, 0, 96, 96); g.fill();
  g.font = '60px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(e, 48, 54);
  iconCache.set(k, c); return c;
}
const pct = (v) => Math.round(v) + '%';
const bar = (v) => '▮'.repeat(Math.round(clamp(v / 20, 0, 5))) + '▯'.repeat(5 - Math.round(clamp(v / 20, 0, 5)));
function starText(r){ const s = Math.round(r * 2) / 2; return '★'.repeat(Math.floor(s)) + (s % 1 ? '½' : '') + ` ${r.toFixed(1)}`; }

// ---------- HUD ----------
function updateHUD(){
  if (mode !== 'screen') return;
  const S = sim.state;
  $('h-mval').textContent = fmtMoney(S.money);
  $('h-money').classList.toggle('debt', S.money < 0);
  $('h-rate').innerHTML = `📅 Day <b>${S.day}</b> · 🕑 <b>${sim.clockText()}</b><br>⭐ <b>${starText(S.rep)}</b> · 👥 <b>${sim.queue.length}</b> waiting<br>🎟 <b>${fmtMoney(S.ticket)}</b> · 🧍 <b>${S.today.visitors}</b> visitors today`;
  document.body.classList.toggle('driving', view === 'drive');
  document.body.classList.toggle('riding', view === 'ride');
  $('b-drive').textContent = view === 'drive' ? '🗺 Map' : '🚙 Drive';
  $('b-ride').textContent = view === 'ride' ? '🗺 Map' : '🚌 Ride a truck';
  // jobs
  const J = $('jobs'); J.innerHTML = '';
  const list = sim.jobs.slice(0, view === 'map' ? 6 : 3);
  for (const j of list){
    const b = document.createElement('button'); b.className = 'job' + (j.assigned ? ' busy' : '');
    const status = j.assigned ? (j.assigned.state === 'working' ? `${STAFF[j.staff].icon} ${j.verb === 'Treat' ? 'treating' : 'working'}... ${Math.round(j.progress * 100)}%` : `${STAFF[j.staff].icon} on the way`) : !sim.staff.some((s) => s.kind === j.staff) ? `⚠ no ${STAFF[j.staff].name.toLowerCase()}: hire one!` : j.type === 'service' && !sim.jobReady(j) ? '🔩 after this tour' : `⏳ waiting for a ${STAFF[j.staff].name.toLowerCase()}`;
    b.innerHTML = `<span class="ji">${j.icon}</span><span>${j.label}<small>${status}</small></span>`;
    b.onclick = () => { startAudio(); sfx.click(); jobPanel(j); };
    J.appendChild(b);
  }
  if (sim.jobs.length > list.length){ const b = document.createElement('button'); b.className = 'job more'; b.textContent = `+ ${sim.jobs.length - list.length} more jobs`; b.onclick = () => jobsPanel(); J.appendChild(b); }
  // driving
  if (view === 'drive'){ $('speedo').textContent = `${Math.round(Math.abs(jeep.v) * 2.237)} mph · ${ZONES[world.polar(jeep.pos.x, jeep.pos.z).zone].name}`; }
  else if (view === 'ride' && rideTruck){ $('speedo').textContent = `🚌 Truck ${rideTruck.number} · ${ZONES[world.polar(rideTruck.pos.x, rideTruck.pos.z).zone].name}${rideTruck.state === 'station' ? ' · at the station' : ''}`; }
  const fj = nearJob();
  $('b-fix').classList.toggle('show', view === 'drive' && !!fj);
  if (fj) $('b-fix').textContent = `🔧 ${fj.verb}: ${shortLabel(fj)}`;
}
function shortLabel(j){ if (j.type === 'vet' || j.type === 'wash') return j.target.name; if (j.type === 'repair' || j.type === 'service') return 'Truck ' + j.target.number; return ZONES[j.target].name; }

// ---------- panels ----------
function showPanel(spec){ if (mode === 'vr'){ vrPage = spec; refreshTablet(); } else panel.show(spec); }
function closePanels(){ panel.close(); vrPage = null; refreshTablet(); }
const money = () => fmtMoney(sim.state.money);

function lookAt(p, dist = 30){ if (view !== 'map') leaveVehicle(); orbit.target.copy(p); orbit.dist = dist; orbit.follow = null; if (mode === 'vr') vrTeleport(p); }
function follow(fn, dist = 22){ if (view !== 'map') leaveVehicle(); orbit.follow = fn; orbit.dist = dist; if (mode === 'vr') vrTeleport(fn()); }

function animalPanel(a){
  const D = a.data, S = SPECIES[a.kind], Z = ZONES[a.zone];
  const jobs = sim.jobs.filter((j) => j.target === a);
  const rows = [
    { title: `❤️ Health ${pct(D.health)}`, sub: D.sick ? 'Poorly! The vet needs to see this one.' : D.health > 80 ? 'Fit and well' : 'Getting better' },
    { title: `🛁 Clean ${pct(100 - D.dirt)}`, sub: D.dirt > 80 ? 'Very muddy: a keeper should give it a wash' : D.dirt > 50 ? 'A bit muddy' : 'Nice and clean' },
    { title: `🌾 Full ${pct(100 - D.hunger)}`, sub: sim.food(a.zone) < 0.05 ? 'The feeder in here is empty!' : D.hunger > 60 ? 'Hungry: off to the feeder' : 'Not hungry' },
  ];
  const buttons = [];
  for (const j of jobs) buttons.push({ label: j.assigned ? `${STAFF[j.staff].icon} On the way` : `${STAFF[j.staff].icon} Send ${STAFF[j.staff].name.toLowerCase()}`, disabled: !!j.assigned, go: () => { if (!sim.hurry(j)) say(`No ${STAFF[j.staff].name.toLowerCase()} free right now.`, 'bad'); else sfx.click(); animalPanel(a); } });
  buttons.push({ label: '👀 Follow', go: () => { closePanels(); follow(() => a.centre(), 14); } });
  showPanel({ title: `${S.icon} ${a.name} the ${S.name}`, money: money(), sections: [{ text: `Lives in ${Z.name}. ${S.food === 'meat' ? 'Eats meat.' : 'Eats hay and grass.'}` }, { rows }, { buttons }] });
}
function truckPanel(t){
  const D = t.data;
  const state = t.broken ? '⚠ Broken down!' : t.state === 'station' ? 'At the station, loading' : t.state === 'depot' ? 'In the garage for a service' : t.state === 'toDepot' || t.state === 'fromDepot' ? 'Driving in to the garage' : `On tour · ${ZONES[world.polar(t.pos.x, t.pos.z).zone].name}`;
  const job = sim.jobs.find((j) => j.target === t);
  const buttons = [{ label: '🚌 Ride on it', go: () => { closePanels(); startRide(t); } }, { label: '👀 Follow', go: () => { closePanels(); follow(() => t.pos.clone().setY(t.pos.y + 2), 26); } }];
  if (job && !job.assigned && sim.jobReady(job)) buttons.push({ label: '🔧 Send mechanic', go: () => { if (!sim.hurry(job)) say('No mechanic free right now.', 'bad'); truckPanel(t); } });
  else if (!job && D.condition < 95) buttons.push({ label: '🔩 Service after tour', go: () => { sim.requestService(t); sfx.click(); truckPanel(t); } });
  showPanel({ title: `🚌 Truck ${t.number}`, money: money(), sections: [
    { rows: [{ title: `🔧 Condition ${pct(D.condition)} ${bar(D.condition)}`, sub: D.condition < 40 ? 'Worn out: it needs a service soon, or it will break down a lot' : D.condition < 70 ? 'A bit worn' : 'Running well' }, { title: `👥 ${t.riders.filter(Boolean).length} of ${SEATS} seats full`, sub: state }, { title: `🛣 ${D.km.toFixed(1)} km driven`, sub: t.serviceNext ? 'Going to the garage after this tour' : '' }] },
    { buttons },
  ] });
}
function jobPanel(j){
  const p = sim.jobPos(j);
  const who = j.assigned ? `${j.assigned.name} is ${j.assigned.state === 'working' ? 'doing it now' : 'on the way'}.` : sim.staff.some((s) => s.kind === j.staff) ? `Waiting for a ${STAFF[j.staff].name.toLowerCase()} to be free.` : `You haven't got a ${STAFF[j.staff].name.toLowerCase()}! Hire one in Staff, or drive there and do it yourself.`;
  const buttons = [];
  if (!j.assigned && sim.jobReady(j)) buttons.push({ label: `${STAFF[j.staff].icon} Send now`, kind: 'primary', go: () => { if (sim.hurry(j)){ sfx.click(); closePanels(); } else say(`No ${STAFF[j.staff].name.toLowerCase()} free right now.`, 'bad'); } });
  buttons.push({ label: '👀 Look', go: () => { closePanels(); lookAt(p, 26); } });
  buttons.push({ label: '🚙 Drive there', go: () => { closePanels(); driveTo(p); } });
  showPanel({ title: `${j.icon} ${j.label}`, money: money(), sections: [{ text: who }, { text: `${jobHelp(j)}${j.cost ? ` It costs ${fmtMoney(j.cost)} in supplies.` : ''}` }, { buttons }] });
}
function jobHelp(j){
  return { vet: 'Sick animals look sad to visitors and get worse. The vet will treat them.', wash: 'Muddy animals can get poorly. A keeper will hose them down.', clean: 'Dung piles up in the enclosure. A keeper will clean it up.', feed: 'The feeder is running out. A keeper will fill it up.', repair: 'A broken-down truck holds up all the trucks behind it! A mechanic will fix it.', service: 'Worn trucks break down more. It will go to the garage after its tour, and a mechanic will service it.' }[j.type];
}
function jobsPanel(){
  showPanel({ title: '📋 Jobs to do', money: money(), sections: [{ rows: sim.jobs.map((j) => ({ title: `${j.icon} ${j.label}`, sub: j.assigned ? `${j.assigned.name} is on it` : `Waiting for a ${STAFF[j.staff].name.toLowerCase()}`, button: { label: 'Open', go: () => jobPanel(j) } })) }, { text: sim.jobs.length ? '' : 'Nothing to do. Everything is fine!' }] });
}
let animalsTab = 1;
function animalsPanel(k = animalsTab){
  animalsTab = k;
  const open = ZONES.filter((Z) => !Z.lodge && sim.isOpen(Z));
  if (!open.find((Z) => Z.k === k)) k = animalsTab = open[0].k;
  const Z = ZONES[k];
  const tabs = open.map((O) => ({ label: `${O.icon} ${O.name.split(' ')[0]}`, on: O.k === k, go: () => animalsPanel(O.k) }));
  const list = sim.animals.filter((a) => a.zone === k);
  const rows = list.map((a) => ({ icon: icon(SPECIES[a.kind].icon, a.data.sick ? '#b83a24' : '#5a3a1a'), title: `${a.name} the ${SPECIES[a.kind].name}${a.data.sick ? ' 🤒' : ''}`, sub: `❤️ ${pct(a.data.health)} · 🛁 ${pct(100 - a.data.dirt)} · 🌾 ${pct(100 - a.data.hunger)}`, button: { label: '👀 Look', go: () => { closePanels(); follow(() => a.centre(), 14); } } }));
  const f = sim.food(k) / sim.foodCap();
  showPanel({ title: '🦒 Animals', money: money(), tabs, sections: [
    { text: `${Z.name}: ${list.length} animals · feeder ${pct(f * 100)} full · ${sim.dung[k].length} dung piles` },
    { rows },
    { buttons: [{ label: '🛒 Buy more animals', go: () => shopPanel('animals') }] },
  ] });
}
function trucksPanel(){
  const S = sim.state;
  const rows = sim.trucks.map((t) => ({ icon: icon('🚌', '#' + TRUCK_COLOURS[t.data.colour % TRUCK_COLOURS.length].body.toString(16).padStart(6, '0')), title: `Truck ${t.number} · ${pct(t.data.condition)} ${t.broken ? '⚠ broken down' : ''}`, sub: `${t.riders.filter(Boolean).length}/${SEATS} riders · ${t.state === 'station' ? 'loading' : t.state === 'depot' ? 'in the garage' : 'on tour'}${t.serviceNext ? ' · service due' : ''}`, button: { label: 'Open', go: () => truckPanel(t) } }));
  showPanel({ title: '🚚 Trucks', money: money(), sections: [
    { text: 'Each truck carries 12 visitors round the safari. More trucks carry more people, but they all need looking after.' },
    { rows },
    { buttons: [{ label: `Buy a truck (${fmtMoney(TRUCK_PRICE)})`, kind: 'primary', disabled: sim.trucks.length >= MAX_TRUCKS || S.money < TRUCK_PRICE, go: () => { const t = sim.buyTruck(); if (t){ sfx.buy(); say(`Truck ${t.number} has arrived!`, 'good'); } trucksPanel(); } },
      { label: 'Sell a truck', kind: 'danger', disabled: sim.trucks.length <= 1, go: () => { const t = sim.trucks.slice().reverse().find((x) => !x.riders.filter(Boolean).length && !x.player); if (t && sim.sellTruck(t)){ sfx.coin(); say(`Sold truck ${t.number}.`, ''); } else say('All the trucks have people on them right now.', 'bad'); trucksPanel(); } }] },
  ] });
}
function staffPanel(){
  const rows = Object.entries(STAFF).map(([k, s]) => {
    const n = sim.staff.filter((x) => x.kind === k).length, busy = sim.staff.filter((x) => x.kind === k && x.job).length;
    return { icon: icon(s.icon, '#3a6a2a'), title: `${n} ${n === 1 ? s.name : s.plural} · ${fmtMoney(s.wage)} a day each`, sub: `${s.does}. ${busy} busy now.`, button: { label: '+ Hire', disabled: sim.staff.length >= MAX_STAFF, go: () => { sim.hire(k); sfx.buy(); staffPanel(); } } };
  });
  const fire = Object.entries(STAFF).map(([k, s]) => ({ label: `− ${s.name}`, disabled: !sim.staff.some((x) => x.kind === k), go: () => { sim.fire(k); sfx.click(); staffPanel(); } }));
  showPanel({ title: '👷 Staff', money: money(), sections: [{ text: 'Staff drive out to jobs by themselves. Wages are paid at the end of each day.' }, { rows }, { heading: 'Let someone go', buttons: fire }] });
}
let shopTab = 'enclosures';
function shopPanel(tab = shopTab){
  shopTab = tab;
  const S = sim.state;
  const tabs = [['enclosures', '🗺 Enclosures'], ['animals', '🦓 Animals'], ['upgrades', '⭐ Upgrades']].map(([k, l]) => ({ label: l, on: tab === k, go: () => shopPanel(k) }));
  const sections = [];
  if (tab === 'enclosures'){
    sections.push({ text: 'Open a new enclosure on the loop. It comes with its first animals.' });
    sections.push({ rows: ZONES.filter((Z) => !Z.lodge).map((Z) => {
      const open = sim.isOpen(Z);
      return { icon: icon(Z.icon, open ? '#3a6a2a' : '#5a3a1a'), on: open, title: Z.name, sub: Z.species.map((k, i) => `${Z.start[i]} ${Z.start[i] === 1 ? SPECIES[k].name : SPECIES[k].plural}`).join(', '),
        button: open ? { label: '✓ Open', disabled: true, go(){} } : { label: fmtMoney(Z.price), disabled: S.money < Z.price, go: () => { if (sim.openZone(Z)){ sfx.buy(); say(`${Z.name} is open! The animals are moving in.`, 'good'); closePanels(); lookAt(world.at((Z.phi0 + Z.phi1) / 2, 0), 70); } } } };
    }) });
  } else if (tab === 'animals'){
    sections.push({ text: `More animals make the safari more exciting (up to ${MAX_PER_ZONE} in each enclosure).` });
    for (const Z of ZONES){
      if (Z.lodge || !sim.isOpen(Z)) continue;
      const n = sim.animals.filter((a) => a.zone === Z.k).length;
      sections.push({ heading: `${Z.icon} ${Z.name} (${n}/${MAX_PER_ZONE})`, rows: Z.species.map((k) => ({ icon: icon(SPECIES[k].icon), title: SPECIES[k].name, sub: `Visitors love them: ${'★'.repeat(Math.min(6, SPECIES[k].appeal))}`, button: { label: fmtMoney(SPECIES[k].price), disabled: n >= MAX_PER_ZONE || S.money < SPECIES[k].price, go: () => { const a = sim.buyAnimal(k, Z.k); if (a){ sfx.buy(); say(`Welcome ${a.name} the ${SPECIES[k].name.toLowerCase()}!`, 'good'); } shopPanel('animals'); } } })) });
    }
  } else {
    sections.push({ text: 'Make the whole safari run better.' });
    sections.push({ rows: Object.entries(UPGRADES).map(([k, u]) => ({ icon: icon(u.icon, '#3a5a8a'), on: !!S.upgrades[k], title: u.name, sub: u.text, button: S.upgrades[k] ? { label: '✓ Done', disabled: true, go(){} } : { label: fmtMoney(u.price), disabled: S.money < u.price, go: () => { if (sim.buyUpgrade(k)){ sfx.buy(); say(`${u.name}: done!`, 'good'); } shopPanel('upgrades'); } } })) });
  }
  showPanel({ title: '🛒 Shop', money: money(), tabs, sections });
}
function officePanel(){
  const S = sim.state, fair = sim.fairTicket();
  const rows = S.days.slice().reverse().map((d) => ({ title: `Day ${d.day}: ${d.profit >= 0 ? '+' : '−'}${fmtMoney(Math.abs(d.profit))}`, sub: `${d.visitors} visitors · took ${fmtMoney(d.income)} · spent ${fmtMoney(d.costs)} (wages ${fmtMoney(d.wages)})` }));
  showPanel({ title: '📋 Safari Office', money: money(), sections: [
    { heading: 'Tickets', text: `A ride costs ${fmtMoney(S.ticket)}. Visitors think about ${fmtMoney(fair)} is fair for what there is to see. Dearer tickets earn more from each person, but fewer people come and they're harder to please.` },
    { buttons: [{ label: '− $5', go: () => { sim.setTicket(S.ticket - 5); sfx.click(); officePanel(); } }, { label: '− $1', go: () => { sim.setTicket(S.ticket - 1); sfx.click(); officePanel(); } }, { label: `🎟 ${fmtMoney(S.ticket)}`, disabled: true, go(){} }, { label: '+ $1', go: () => { sim.setTicket(S.ticket + 1); sfx.click(); officePanel(); } }, { label: '+ $5', go: () => { sim.setTicket(S.ticket + 5); sfx.click(); officePanel(); } }] },
    { heading: 'Today', text: `Day ${S.day}, ${sim.clockText()} · ${S.today.visitors} visitors · took ${fmtMoney(S.today.income)} · spent ${fmtMoney(S.today.costs)} · rating ${starText(S.rep)}` },
    { heading: 'Every day', text: `Wages ${fmtMoney(sim.staff.reduce((n, s) => n + STAFF[s.kind].wage, 0))} · upkeep ${fmtMoney(ZONES.filter((Z) => !Z.lodge && sim.isOpen(Z)).length * 30 + sim.trucks.length * 25)} (enclosures and trucks)` },
    { heading: 'The last few days', rows: rows.length ? rows : [{ title: 'No days finished yet', sub: `A day lasts ${DAY_SECONDS / 60} minutes.` }] },
    { text: `All time: ${S.visitors.toLocaleString()} visitors · ${fmtMoney(S.earned)} taken.` },
  ] });
}
function menu(){
  showPanel({ title: '☰ Menu', money: money(), sections: [
    { heading: 'How to play', list: [
      'You run a drive-through safari. Visitors arrive at the Lodge, pay for a ticket and ride a tour truck all the way round the loop.',
      'Happy visitors (lots of animals, healthy and clean, no breakdowns, a fair price) give you more stars, and more people come.',
      'Jobs pop up with red markers: sick or muddy animals, dung to clean, empty feeders, broken-down or worn-out trucks. Your staff drive out to do them. Hire more if they can\'t keep up.',
      'You can do jobs yourself: drive your jeep there and press Fix it.',
      'Spend your money on new enclosures, more animals, more trucks and upgrades in the Shop.',
    ] },
    { buttons: [{ label: 'Back to the safari', kind: 'primary', go: closePanels }, { label: 'Title screen', go: () => { closePanels(); toTitle(); } }] },
  ] });
}
function welcome(){
  showPanel({ title: 'Welcome, Safari Manager!', money: money(), sections: [
    { text: 'You\'ve taken over Safari Cruise: a drive-through safari park. Two enclosures are open (zebras, wildebeest and ostriches; giraffes and impala) and two tour trucks are carrying visitors round.' },
    { list: [
      'Tap animals, trucks and the red job markers to see what they need.',
      'Your vet, keeper and mechanic go out to jobs by themselves.',
      '🚙 Drive takes you round in your own jeep. 🚌 Ride hops you on a tour truck.',
      'Earn money to open the rhinos, elephants, hippos, lions, cheetahs, tigers and bears!',
    ] },
    { buttons: [{ label: 'Let\'s go!', kind: 'primary', go: closePanels }] },
  ] });
}
$('b-animals').onclick = () => { startAudio(); sfx.click(); animalsPanel(); };
$('b-trucks').onclick = () => { startAudio(); sfx.click(); trucksPanel(); };
$('b-staff').onclick = () => { startAudio(); sfx.click(); staffPanel(); };
$('b-shop').onclick = () => { startAudio(); sfx.click(); shopPanel(); };
$('b-office').onclick = () => { startAudio(); sfx.click(); officePanel(); };
$('b-menu').onclick = () => { startAudio(); sfx.click(); menu(); };
$('b-drive').onclick = () => { startAudio(); sfx.click(); if (view === 'drive') leaveVehicle(); else startDrive(); };
$('b-ride').onclick = () => { startAudio(); sfx.click(); if (view === 'ride') leaveVehicle(); else startRide(); };
$('b-out').onclick = () => { sfx.click(); leaveVehicle(); };
$('b-next').onclick = () => { sfx.click(); nextTruck(); };
$('b-cam').onclick = () => { sfx.click(); camStyle = camStyle === 'chase' ? 'cockpit' : 'chase'; look.yaw = 0; look.pitch = 0; };
$('b-horn').onclick = () => { sfx.horn(jeep.pos); };
$('b-fix').onclick = () => { startFix(); };

// ---------- riding and driving ----------
function startRide(t){
  closePanels();
  if (view === 'drive') view = 'map';
  if (!t){
    // the truck nearest to where you're looking (or the one at the station)
    const at = mode === 'vr' ? headPos : orbit.target;
    t = sim.trucks.slice().sort((a, b) => a.pos.distanceToSquared(at) - b.pos.distanceToSquared(at))[0];
  }
  if (!t) return;
  if (rideTruck) leaveTruck();
  rideTruck = t; t.player = true;
  const free = sim.firstFreeSeat(t); t.playerSeat = free >= 0 ? free : 1;
  // the front-row middle seat is the best one
  if (!t.riders[1]) t.playerSeat = 1;
  t.ridersMesh.refresh(t.playerSeat);
  view = 'ride'; look.yaw = 0; look.pitch = 0;
  if (mode === 'vr') vrSit();
  say(`You're riding on truck ${t.number}. Enjoy the safari!`, '');
  updateHUD(); refreshTablet();
}
function leaveTruck(){ if (!rideTruck) return; rideTruck.player = false; rideTruck.ridersMesh.refresh(-1); rideTruck = null; }
function nextTruck(){ if (!sim.trucks.length) return; const i = (sim.trucks.indexOf(rideTruck) + 1) % sim.trucks.length; startRide(sim.trucks[i]); }
function startDrive(){
  closePanels();
  if (rideTruck){ orbit.target.copy(rideTruck.pos); leaveTruck(); }
  view = 'drive'; look.yaw = 0; look.pitch = 0;
  jeep.m.root.visible = true;
  if (mode === 'vr') vrSit();
  if (!sim.state.tips.drive){ sim.state.tips.drive = true; say(mode === 'vr' ? 'Left stick: go and stop. Right stick: steer.' : 'Use the thumb stick (or WASD / the arrow keys) to drive. Go and see the animals!', ''); }
  updateHUD(); refreshTablet();
}
function driveTo(p){
  // put the jeep on the road near the job, facing the right way
  const pol = world.polar(p.x, p.z), s = world.sOfPhi(pol.phi) - 25, R = world.road(s, -LANE);
  jeep.reset(R.p, Math.atan2(R.t.x, R.t.z));
  startDrive();
}
function leaveVehicle(){
  if (view === 'ride' && rideTruck){ orbit.target.copy(rideTruck.pos); leaveTruck(); }
  if (view === 'drive'){ orbit.target.copy(jeep.pos); }
  fixing = null; $('fixbar').style.display = 'none';
  view = 'map'; orbit.follow = null; orbit.dist = Math.max(40, orbit.dist);
  if (mode === 'vr') vrStand();
  updateHUD(); refreshTablet();
}
// a job close enough to the jeep to do yourself
function nearJob(){
  if (view !== 'drive') return null;
  let best = null, bd = 13 * 13;
  for (const j of sim.jobs){ if (!sim.jobReady(j)) continue; const p = sim.jobPos(j), d = (p.x - jeep.pos.x) ** 2 + (p.z - jeep.pos.z) ** 2; if (d < bd){ bd = d; best = j; } }
  return best;
}
function startFix(){
  const j = nearJob(); if (!j || fixing) return;
  fixing = { job: j, t: 0 };
  if (j.target && j.target.held !== undefined) j.target.held = true;
  if (j.type === 'repair' || j.type === 'service') sfx.spanner(jeep.pos); else if (j.type === 'wash') sfx.splash(sim.jobPos(j));
}
function updateFix(dt){
  if (!fixing) return;
  const j = fixing.job;
  if (!sim.jobs.includes(j)){ fixing = null; $('fixbar').style.display = 'none'; return; }
  const p = sim.jobPos(j);
  if (Math.hypot(p.x - jeep.pos.x, p.z - jeep.pos.z) > 16){ fixing = null; $('fixbar').style.display = 'none'; say('Too far away! Drive back and try again.', 'bad'); return; }
  fixing.t += dt / 3;
  sim.workEffects(j, jeep.pos, dt);
  if (Math.random() < dt * 2 && (j.type === 'repair' || j.type === 'service')) sfx.spanner(p);
  if (mode === 'screen'){ $('fixbar').style.display = 'block'; $('fixbar').firstChild.style.width = Math.round(fixing.t * 100) + '%'; $('fixbar').lastChild.textContent = `${j.verb}ing... ${Math.round(fixing.t * 100)}%`.replace('eing', 'ing'); }
  if (fixing.t >= 1){
    if (j.assigned){ /* the staff member turns back */ }
    sim.finishJob(j, true); fixing = null; $('fixbar').style.display = 'none';
    say(`Job done! ${j.label.replace(/ (is poorly|needs a wash|needs cleaning|has broken down|needs a service)$/, '')}: sorted.`, 'good');
  }
}

// ---------- screen input ----------
const pointers = new Map();
let pinch = null, tap = null;
const keys = {};
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (mode !== 'screen') return;
  startAudio();
  renderer.domElement.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  tap = pointers.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
  if (pointers.size === 2){ const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; }
});
renderer.domElement.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId); if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 10) tap = null;
  if (pointers.size >= 2 && pinch){
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    if (view === 'map'){ orbit.dist = clamp(orbit.dist * pinch.d / Math.max(20, d), 10, 480); pan(mx - pinch.mx, my - pinch.my); }
    else if (view === 'drive' && camStyle === 'chase'){ chase.dist = clamp(chase.dist * pinch.d / Math.max(20, d), 6, 30); }
    pinch = { d, mx, my };
    return;
  }
  if (view === 'map'){ orbit.yaw -= dx * 0.005; orbit.pitch = clamp(orbit.pitch + dy * 0.004, 0.08, 1.48); }
  else { look.yaw = clamp(look.yaw - dx * 0.005, -2.8, 2.8); look.pitch = clamp(look.pitch - dy * 0.004, -1.1, 1.1); }
});
const up = (e) => {
  pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null;
  if (tap && performance.now() - tap.t < 450 && view === 'map'){ pick(tap.x, tap.y); }
  tap = null;
};
renderer.domElement.addEventListener('pointerup', up); renderer.domElement.addEventListener('pointercancel', up);
renderer.domElement.addEventListener('wheel', (e) => { e.preventDefault(); if (view === 'map') orbit.dist = clamp(orbit.dist * Math.exp(e.deltaY * 0.0012), 10, 480); else if (view === 'drive') chase.dist = clamp(chase.dist * Math.exp(e.deltaY * 0.001), 6, 30); }, { passive: false });
function pan(dx, dy){
  const s = orbit.dist * 0.0022;
  const f = V(-Math.sin(orbit.yaw), 0, -Math.cos(orbit.yaw)), r = V(Math.cos(orbit.yaw), 0, -Math.sin(orbit.yaw));
  orbit.target.addScaledVector(r, -dx * s).addScaledVector(f, dy * s);
  const l = Math.hypot(orbit.target.x, orbit.target.z); if (l > 400) orbit.target.multiplyScalar(400 / l);
  orbit.follow = null;
}
addEventListener('keydown', (e) => {
  if (mode !== 'screen') return;
  keys[e.code] = true;
  if (e.code === 'Escape'){ if (panel.open) closePanels(); else if (view !== 'map') leaveVehicle(); }
  if (e.code === 'KeyF' && view === 'drive') startFix();
  if (e.code === 'KeyH' && view === 'drive') sfx.horn(jeep.pos);
  if (e.code === 'KeyC' && view !== 'map'){ camStyle = camStyle === 'chase' ? 'cockpit' : 'chase'; }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
// the thumb stick for driving
$('stick').addEventListener('pointerdown', (e) => { startAudio(); stick.id = e.pointerId; $('stick').setPointerCapture(e.pointerId); moveStick(e); });
$('stick').addEventListener('pointermove', (e) => { if (e.pointerId === stick.id) moveStick(e); });
const stickUp = (e) => { if (e.pointerId === stick.id){ stick.id = null; stick.x = stick.y = 0; $('knob').style.transform = ''; } };
$('stick').addEventListener('pointerup', stickUp); $('stick').addEventListener('pointercancel', stickUp);
function moveStick(e){
  const r = $('stick').getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let x = (e.clientX - cx) / (r.width / 2), y = (e.clientY - cy) / (r.height / 2); const l = Math.hypot(x, y); if (l > 1){ x /= l; y /= l; }
  stick.x = x; stick.y = y; $('knob').style.transform = `translate(${x * 44}px, ${y * 44}px)`;
}
// tapping on something in the world
const raycaster = new THREE.Raycaster();
function pick(x, y){
  raycaster.setFromCamera(new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1), camera);
  return pickRay(raycaster);
}
function pickRay(rc){
  rc.camera = camera;
  const markers = sim.jobs.map((j) => j.marker).filter(Boolean);
  const mh = rc.intersectObjects(markers, false)[0];
  if (mh){ const j = sim.jobs.find((x) => x.marker === mh.object); if (j){ sfx.click(); jobPanel(j); return true; } }
  const objs = [...sim.animals.filter((a) => a.root.visible).map((a) => a.root), ...sim.trucks.map((t) => t.root), ...sim.staff.map((s) => s.jeep.root)];
  const hit = rc.intersectObjects(objs, true).find((h) => h.object.visible);
  if (!hit) return false;
  const u = hit.object.userData;
  if (u.animal){ sfx.click(); animalPanel(u.animal); call(u.animal.kind, u.animal.pos); return true; }
  if (u.truck){ sfx.click(); truckPanel(u.truck); return true; }
  if (u.jeep){ const s = sim.staff.find((x) => x.jeep === u.jeep); if (s){ sfx.click(); showPanel({ title: `${STAFF[s.kind].icon} ${s.name}`, money: money(), sections: [{ text: s.job ? `Working on: ${s.job.label}` : s.state === 'returning' ? 'Driving back to the garage.' : 'Waiting at the garage for a job.' }, { buttons: [{ label: 'OK', go: closePanels }] }] }); return true; } }
  return false;
}

// ---------- the screen camera ----------
const chase = { dist: 11, pos: V(), init: false };
function placeScreenCamera(dt){
  rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0); rig.scale.setScalar(1);
  if (view === 'ride' && rideTruck){
    camera.position.copy(rideTruck.seatEye(rideTruck.playerSeat));
    rideTruck.m.body.updateWorldMatrix(true, false);
    const q = new THREE.Quaternion().setFromRotationMatrix(rideTruck.m.body.matrixWorld);
    camera.quaternion.copy(q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(look.pitch, look.yaw, 0, 'YXZ')));
    if (!pointers.size){ look.pitch = damp(look.pitch, 0, 0.3, dt); }
    camera.fov = 72; camera.updateProjectionMatrix();
    return;
  }
  if (view === 'drive'){
    if (camStyle === 'cockpit'){
      camera.position.copy(jeep.eye());
      camera.quaternion.copy(jeep.quat).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(look.pitch, look.yaw, 0, 'YXZ')));
      if (!pointers.size){ look.yaw = damp(look.yaw, 0, 0.6, dt); look.pitch = damp(look.pitch, 0, 0.6, dt); }
      camera.fov = 72;
    } else {
      const f = V(Math.sin(jeep.yaw + look.yaw), 0, Math.cos(jeep.yaw + look.yaw));
      const want = jeep.pos.clone().addScaledVector(f, -chase.dist).add(V(0, chase.dist * 0.42 + 1.5, 0));
      want.y = Math.max(want.y, world.height(want.x, want.z) + 1.5);
      if (!chase.init){ chase.pos.copy(want); chase.init = true; }
      chase.pos.lerp(want, Math.min(1, dt * 4));
      camera.position.copy(chase.pos);
      camera.lookAt(jeep.pos.clone().add(V(0, 1.6, 0)).addScaledVector(f, 4));
      if (!pointers.size) look.yaw = damp(look.yaw, 0, 0.8, dt);
      camera.fov = 62;
    }
    camera.updateProjectionMatrix();
    return;
  }
  chase.init = false;
  camera.fov = 55; camera.updateProjectionMatrix();
  const k = (c) => (keys[c] ? 1 : 0);
  const mx = k('KeyD') - k('KeyA'), mz = k('KeyS') - k('KeyW');
  if (mx || mz) pan(-mx * 700 * dt, -mz * 700 * dt);
  orbit.yaw += (k('ArrowLeft') - k('ArrowRight')) * dt * 1.5;
  orbit.pitch = clamp(orbit.pitch + (k('ArrowUp') - k('ArrowDown')) * dt, 0.08, 1.48);
  if (orbit.follow){ orbit.target.lerp(orbit.follow(), Math.min(1, dt * 3)); }
  const t = orbit.target, d = orbit.dist;
  t.y = damp(t.y, world.height(t.x, t.z) + 1, 3, dt);
  camera.position.set(t.x + Math.sin(orbit.yaw) * Math.cos(orbit.pitch) * d, t.y + Math.sin(orbit.pitch) * d, t.z + Math.cos(orbit.yaw) * Math.cos(orbit.pitch) * d);
  camera.position.y = Math.max(world.height(camera.position.x, camera.position.z) + 2, camera.position.y);
  camera.lookAt(t);
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
const handMeshes = [0, 1].map((i) => {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.025, 0.08, 4, 10), new THREE.MeshStandardMaterial({ color: i ? 0x3a7a2a : 0x8a5a2a, roughness: 0.5 }));
  m.rotation.x = Math.PI / 2; g.add(m);
  g.visible = false; scene.add(g); return g;
});
const tabletHolder = new THREE.Group(); scene.add(tabletHolder);
tabletHolder.add(tablet.mesh); tablet.mesh.position.set(0, 0.2, -0.05); tablet.mesh.rotation.x = -0.35;
tabletHolder.visible = false;
const laser = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 1, 6), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.7 }));
laser.geometry.translate(0, 0.5, 0); laser.geometry.rotateX(-Math.PI / 2); laser.visible = false; scene.add(laser);
const dot = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff })); dot.visible = false; scene.add(dot);
const headPos = V(), headQuat = new THREE.Quaternion();
const v1 = V(), v2 = V();
const vrs = { giant: true, tablet: true, snapReady: true, seatHead: null, seatYaw: 0 };
let vrPage = null;
const GIANT = 14;

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
  tabletHolder.visible = L.tracked && vrs.tablet;
  if (tabletHolder.visible){ tabletHolder.position.copy(L.pos); tabletHolder.quaternion.copy(L.quat); tabletHolder.scale.setScalar(rig.scale.x); }
  laser.visible = false; dot.visible = false;
  let onTablet = false;
  if (R.tracked){
    const dir = V(0, 0, -1).applyQuaternion(R.rayQuat);
    if (tabletHolder.visible){
      tabletHolder.updateMatrixWorld(true);
      const hit = tablet.ray(R.rayPos, dir, R.triggerDown, 3 * rig.scale.x);
      if (hit){
        onTablet = true;
        laser.visible = true; dot.visible = true;
        laser.position.copy(R.rayPos); laser.lookAt(hit.point); laser.scale.set(rig.scale.x, rig.scale.x, R.rayPos.distanceTo(hit.point));
        dot.position.copy(hit.point); dot.scale.setScalar(rig.scale.x);
        if (hit.clicked){ R.haptic(0.3, 30); sfx.click(); refreshTablet(); }
        if (Math.abs(R.stick.y) > 0.3) tablet.scrollBy(R.stick.y * dt * 900);
      }
    }
    // pointing at the world: pull the trigger on an animal, a truck or a job marker (or, driving, to fix a job)
    if (!onTablet && R.triggerDown){
      if (view === 'drive' && nearJob()) startFix();
      else { const rc = new THREE.Raycaster(R.rayPos, dir, 0, 600 * rig.scale.x); if (pickRay(rc)){ R.haptic(0.4, 40); vrs.tablet = true; } }
    }
  }
  if (R.aDown){ if (view === 'map') startRide(); else leaveVehicle(); }
  if (R.bDown){ if (view === 'map') setGiant(!vrs.giant); else if (view === 'drive') sfx.horn(jeep.pos); else nextTruck(); }
  if (L.aDown || L.bDown){ vrs.tablet = !vrs.tablet; }
  if (view !== 'map') return;
  const sx = R.stick.x;
  if (Math.abs(sx) > 0.7 && vrs.snapReady && !onTablet){ turnRig(-Math.sign(sx) * Math.PI / 6); vrs.snapReady = false; }
  if (Math.abs(sx) < 0.35) vrs.snapReady = true;
  let mx = L.stick.x, my = L.stick.y; if (Math.hypot(mx, my) < 0.15){ mx = 0; my = 0; }
  if (mx || my){
    const f = V(0, 0, -1).applyQuaternion(headQuat); f.y = 0; f.normalize();
    const r = V(-f.z, 0, f.x);
    const sp = 3.5 * rig.scale.x * dt;
    rig.position.addScaledVector(f, -my * sp).addScaledVector(r, mx * sp);
    const l = Math.hypot(rig.position.x, rig.position.z); if (l > 420){ rig.position.x *= 420 / l; rig.position.z *= 420 / l; }
  }
  // stand on the ground (at normal size; a giant stands on the ground too)
  rig.position.y = world.height(headPos.x, headPos.z);
}
function turnRig(a){ v1.copy(headPos); rig.position.sub(v1).applyAxisAngle(V(0, 1, 0), a).add(v1); rig.rotation.y += a; rig.updateMatrixWorld(true); }
function setGiant(on){
  vrs.giant = on;
  const before = V(headPos.x, 0, headPos.z);
  rig.scale.setScalar(on ? GIANT : 1);
  rig.updateMatrixWorld(true);
  const local = camera.position.clone().multiplyScalar(rig.scale.x).applyQuaternion(rig.quaternion);
  rig.position.set(before.x - local.x, world.height(before.x, before.z), before.z - local.z);
  sfx.whoosh(); refreshTablet();
}
// jump to a spot (standing a little way back from it)
function vrTeleport(p){
  const s = vrs.giant ? GIANT : 1, back = vrs.giant ? 45 : 8;
  const f = V(0, 0, -1).applyQuaternion(headQuat); f.y = 0; if (f.lengthSq() < 0.01) f.set(0, 0, -1); f.normalize();
  const local = camera.position.clone().multiplyScalar(s).applyQuaternion(rig.quaternion);
  const stand = p.clone().addScaledVector(f, -back);
  rig.position.set(stand.x - local.x, world.height(stand.x, stand.z), stand.z - local.z);
  rig.updateMatrixWorld(true);
}
// sitting in a truck or the jeep: the whole play space rides along
function vrSit(){ vrs.seatHead = null; }
function vrSeatAt(eye, q){
  if (!vrs.seatHead){
    vrs.seatHead = camera.position.clone();
    const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ'); vrs.seatYaw = e.y;
  }
  rig.scale.setScalar(1);
  const rq = q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), -vrs.seatYaw));
  // keep the horizon level (only turn with the vehicle) so nobody feels sick
  const e = new THREE.Euler().setFromQuaternion(rq, 'YXZ'); rq.setFromEuler(new THREE.Euler(0, e.y, 0, 'YXZ'));
  rig.quaternion.copy(rq);
  rig.position.copy(eye).sub(vrs.seatHead.clone().applyQuaternion(rq));
  rig.updateMatrixWorld(true);
}
function vrStand(){
  vrs.seatHead = null;
  const p = headPos.clone();
  rig.quaternion.identity(); rig.rotation.set(0, 0, 0);
  rig.scale.setScalar(vrs.giant ? GIANT : 1);
  const local = camera.position.clone().multiplyScalar(rig.scale.x);
  const stand = vrs.giant ? p.clone().add(V(0, 0, 40)) : p.clone().add(V(4, 0, 4));
  rig.position.set(stand.x - local.x, world.height(stand.x, stand.z), stand.z - local.z);
  rig.updateMatrixWorld(true);
}
function vrDrive(dt){
  const L = vr[0], R = vr[1];
  let th = -L.stick.y, st = R.stick.x;
  if (Math.abs(th) < 0.12) th = 0; if (Math.abs(st) < 0.12) st = 0;
  jeep.update(dt, th, st);
}

// the tablet's pages
let tabletT = 0;
function refreshTablet(){ tabletT = 0; }
function tabletSpec(){
  const S = sim.state;
  if (vrPage) return { ...vrPage, sections: [...(vrPage.sections || []), { buttons: [{ label: '⬅ Back', go: () => { vrPage = null; refreshTablet(); } }] }] };
  const last = msgs.length ? msgs[msgs.length - 1].text : null;
  const status = `Day ${S.day} · ${sim.clockText()} · ⭐ ${S.rep.toFixed(1)} · 👥 ${sim.queue.length} waiting`;
  const jobRows = sim.jobs.slice(0, view === 'map' ? 4 : 2).map((j) => ({ title: `${j.icon} ${shortLabel(j)}`, sub: j.assigned ? `${j.assigned.name} is on it` : j.label, button: { label: j.assigned ? 'Look' : 'Send', go: () => { if (!j.assigned && sim.hurry(j)) sfx.click(); else jobPanel(j); } } }));
  if (view === 'ride'){
    return { title: `🚌 Truck ${rideTruck ? rideTruck.number : ''}`, money: money(), sections: [
      { text: last || status },
      { rows: jobRows },
      { buttons: [{ label: '⬅ Get out (A)', kind: 'danger', go: leaveVehicle }, { label: '⏭ Next (B)', go: nextTruck }] },
    ] };
  }
  if (view === 'drive'){
    const fj = nearJob();
    return { title: '🚙 Your jeep', money: money(), sections: [
      { text: fixing ? `${fixing.job.verb}ing... ${Math.round(fixing.t * 100)}%` : last || `${Math.round(Math.abs(jeep.v) * 2.237)} mph · ${ZONES[world.polar(jeep.pos.x, jeep.pos.z).zone].name}` },
      { rows: jobRows },
      { buttons: [{ label: fj ? `🔧 ${fj.verb} (trigger)` : '🔧 Nothing to fix', kind: fj ? 'primary' : '', disabled: !fj || !!fixing, go: startFix }, { label: '📯 Horn (B)', go: () => sfx.horn(jeep.pos) }] },
      { buttons: [{ label: '⬅ Get out (A)', kind: 'danger', go: leaveVehicle }] },
    ] };
  }
  return { title: 'Safari Cruise', money: money(), sections: [
    { text: last || status },
    { rows: jobRows.length ? jobRows : [{ title: '✓ No jobs to do', sub: 'Everything is fine!' }] },
    { buttons: [{ label: '🚙 Drive', kind: 'primary', go: startDrive }, { label: '🚌 Ride (A)', go: () => startRide() }, { label: vrs.giant ? '🧍 Normal (B)' : '🦖 Giant (B)', go: () => setGiant(!vrs.giant) }] },
    { buttons: [{ label: '🦒 Animals', go: () => animalsPanel() }, { label: '🚚 Trucks', go: trucksPanel }, { label: '👷 Staff', go: staffPanel }] },
    { buttons: [{ label: '🛒 Shop', go: () => shopPanel() }, { label: '📋 Office', go: officePanel }, { label: '☰ Menu', go: menu }] },
  ] };
}

// ---------- the loop ----------
const clock = new THREE.Clock();
function frame(){ try { step(); } catch (e) { console.error(e); } }
function step(){
  const dt = Math.min(clock.getDelta(), 1 / 20);
  const T = window.__sc, steps = T && T.timeScale > 1 ? Math.round(T.timeScale) : 1;
  for (let k = 0; k < steps; k++){ gameTime += dt; simulate(dt, k === 0); }
  if (T && T.noRender) return;
  if (mode !== 'vr') placeScreenCamera(dt);
  renderer.render(scene, camera);
}
const vehiclePos = [];
function simulate(dt, first){
  if (mode === 'vr'){
    rig.updateMatrixWorld(true);
    renderer.xr.getCamera().matrixWorld.decompose(headPos, headQuat, v1);
    vrUpdate(dt);
  } else { camera.updateMatrixWorld(true); camera.matrixWorld.decompose(headPos, headQuat, v1); }
  if (mode === 'title') titleSpin(dt);
  // driving your jeep
  if (view === 'drive'){
    if (mode === 'vr') vrDrive(dt);
    else {
      const k = (c) => (keys[c] ? 1 : 0);
      let th = -stick.y + k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown'), st = stick.x + k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft');
      jeep.update(dt, clamp(th, -1, 1), clamp(st, -1, 1));
    }
    updateFix(dt);
  }
  // everything that drives opens the gates
  vehiclePos.length = 0;
  for (const t of sim.trucks) vehiclePos.push(t.pos);
  for (const s of sim.staff) if (!s.jeep.parked) vehiclePos.push(s.jeep.pos);
  if (view === 'drive' || mode === 'title') vehiclePos.push(jeep.pos);
  world.updateGates(dt, vehiclePos);
  sim.update(dt, { vehicles: vehiclePos, cam: headPos, markerScale: mode === 'vr' ? (vrs.giant && view === 'map' ? 0.6 : 0.2) : 1 });
  if (mode === 'vr' && view === 'ride' && rideTruck){ rideTruck.m.body.updateWorldMatrix(true, false); vrSeatAt(rideTruck.seatEye(rideTruck.playerSeat), new THREE.Quaternion().setFromRotationMatrix(rideTruck.m.body.matrixWorld)); }
  if (mode === 'vr' && view === 'drive') vrSeatAt(jeep.eye(), jeep.quat);
  // the sun's shadows follow what you're looking at
  const focus = mode === 'vr' ? headPos : view === 'map' ? orbit.target : camera.position;
  const big = mode === 'vr' ? (vrs.giant && view === 'map' ? 150 : 60) : view === 'map' ? clamp(orbit.dist * 0.9, 50, 160) : 60;
  if (sun.shadow.camera.right !== big){ Object.assign(sun.shadow.camera, { left: -big, right: big, top: big, bottom: -big }); sun.shadow.camera.updateProjectionMatrix(); }
  sun.target.position.set(Math.round(focus.x), 0, Math.round(focus.z));
  sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 200);
  skyDome.position.copy(headPos);
  setListener(headPos, v1.set(0, 0, -1).applyQuaternion(headQuat), v2.set(0, 1, 0).applyQuaternion(headQuat));
  if (!first) return;
  // sounds: the nearest truck's engine, your own, and now and then an animal calling
  let nt = null, nd = 1e9; for (const t of sim.trucks){ if (t === rideTruck) continue; const d = t.pos.distanceToSquared(headPos); if (d < nd){ nd = d; nt = t; } }
  engines(nt && nd < 150 * 150 ? nt.pos : null, nt ? nt.v : 0, view === 'drive' ? jeep.v : rideTruck ? rideTruck.v + 2 : 0, view !== 'map', view === 'ride');
  callT -= dt;
  if (callT <= 0){
    callT = 5 + Math.random() * 9;
    const near = sim.animals.filter((a) => a.root.visible && a.pos.distanceToSquared(headPos) < 90 * 90);
    if (near.length){ const a = near[Math.floor(Math.random() * near.length)]; call(a.kind, a.pos); }
  }
  if (payAcc && gameTime - lastPay > 1.5){ lastPay = gameTime; if (mode === 'screen') moneyPop('+' + fmtMoney(payAcc)); sfx.coin(); payAcc = 0; refreshTablet(); }
  for (const m of msgs) m.t -= dt;
  if (msgs.length && msgs[0].t <= 0){ while (msgs.length && msgs[0].t <= 0) msgs.shift(); drawMsgs(); }
  hudT -= dt; if (hudT <= 0){ hudT = 0.3; updateHUD(); }
  if (mode === 'vr'){ tabletT -= dt; if (tabletT <= 0){ tabletT = view === 'map' ? 1 : 0.5; tablet.show(tabletSpec()); } }
  saveT += dt; if (saveT > 15 && mode !== 'title'){ saveT = 0; sim.save(); }
}
renderer.setAnimationLoop(frame);

// ---------- title screen ----------
let spin = 0;
function titleSpin(dt){
  spin += dt * 0.03;
  // fly slowly round the giraffes and zebras
  const Z = ZONES[2], p = world.at(Z.phi0 + 0.02, 0);
  orbit.target.set(p.x, p.y + 2, p.z); orbit.yaw = spin + 3.6; orbit.pitch = 0.2; orbit.dist = 55; orbit.follow = null;
  // and let the manager's jeep go round on its own
  jeep.m.root.visible = false;
}
function toTitle(){
  if (renderer.xr.isPresenting) renderer.xr.getSession().end();
  leaveVehicle(); sim.save();
  mode = 'title'; view = 'map'; $('title').classList.remove('hidden'); document.body.classList.remove('playing');
  refreshTitle();
}
function refreshTitle(){ $('b-new').style.display = localStorage.getItem(SAVE_KEY) ? '' : 'none'; }
let fresh = false;
function ensureGame(newOne){
  if (newOne){ sim.newGame(); fresh = true; }
  view = 'map'; rideTruck = null;
  orbit.target.copy(world.lodgePoint(0, 4).p); orbit.yaw = 2.3; orbit.pitch = 0.5; orbit.dist = 80; orbit.follow = null;
  jeep.m.root.visible = true;
}
function startScreen(newOne){
  startAudio(); ensureGame(newOne);
  mode = 'screen'; $('title').classList.add('hidden'); document.body.classList.add('playing');
  clock.getDelta(); updateHUD();
  if (fresh){ fresh = false; welcome(); sim.save(); }
}
async function startVR(newOne){
  startAudio(); ensureGame(newOne);
  try {
    const session = await navigator.xr.requestSession('immersive-vr', { requiredFeatures: ['local-floor'], optionalFeatures: ['bounded-floor'] });
    session.addEventListener('end', () => {
      if (mode === 'vr'){ leaveVehicle(); mode = 'title'; view = 'map'; $('title').classList.remove('hidden'); document.body.classList.remove('playing'); camera.position.set(0, 0, 0); camera.quaternion.identity(); rig.position.set(0, 0, 0); rig.quaternion.identity(); rig.scale.setScalar(1); sim.save(); tabletHolder.visible = false; laser.visible = false; dot.visible = false; for (const m of handMeshes) m.visible = false; refreshTitle(); }
    });
    sun.shadow.mapSize.set(1024, 1024); if (sun.shadow.map){ sun.shadow.map.dispose(); sun.shadow.map = null; }
    await renderer.xr.setSession(session);
    try { if (session.supportedFrameRates && session.updateTargetFrameRate){ const r = [...session.supportedFrameRates]; if (r.includes(72)) await session.updateTargetFrameRate(72); } } catch (e) {}
    mode = 'vr'; $('title').classList.add('hidden');
    vrs.giant = true; vrs.tablet = true; vrPage = null;
    const st = world.lodgePoint(0, 60).p;
    rig.rotation.set(0, 0, 0); rig.scale.setScalar(GIANT); rig.position.set(st.x, world.lodgeH, st.z);
    // face the safari (towards the middle)
    rig.rotation.y = Math.atan2(st.x, st.z);
    clock.getDelta();
    refreshTablet();
    if (fresh){ fresh = false; welcome(); sim.save(); }
  } catch (e) { $('status').textContent = 'Could not start VR: ' + (e && e.message ? e.message : e); }
}
$('b-play').onclick = () => startScreen(false);
$('b-vr').onclick = () => startVR(false);
$('b-new').onclick = () => {
  if (localStorage.getItem(SAVE_KEY) && !confirm('Start a new safari? Your saved park and money will be lost.')) return;
  localStorage.removeItem(SAVE_KEY);
  if (navigator.xr && $('b-vr').dataset.ok === '1' && confirm('Play the new safari in VR? (Cancel to play on this screen.)')) startVR(true); else startScreen(true);
};
// load the saved safari, or start a new one (it's only saved once you play)
if (!sim.load()){ sim.newGame(); fresh = true; }
refreshTitle();
const vrStatus = (t) => { $('status').textContent = t; };
if (navigator.xr && navigator.xr.isSessionSupported){
  navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
    $('b-vr').disabled = !ok; $('b-vr').dataset.ok = ok ? '1' : '0';
    vrStatus(ok ? 'Headset found: press Enter VR.' : 'No VR headset here: play on this screen (or open this page in a headset\'s browser).');
  }).catch(() => { $('b-vr').disabled = true; vrStatus('Play on this screen, or open this page in a VR headset\'s browser.'); });
} else { $('b-vr').disabled = true; vrStatus('Play on this screen, or open this page in a VR headset\'s browser.'); }

addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
addEventListener('pagehide', () => { if (mode !== 'title') sim.save(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && mode !== 'title') sim.save(); });

// ---------- for the headless test ----------
window.__sc = {
  get mode(){ return mode; }, get view(){ return view; }, world, sim, jeep, renderer, camera, scene, rig, vr, tablet, orbit, vrs, ZONES, SPECIES,
  timeScale: 1, noRender: false, version: VERSION, stick, keys,
  startScreen, startVR, startRide, startDrive, leaveVehicle, nextTruck, closePanels, tabletSpec, animalsPanel, trucksPanel, staffPanel, shopPanel, officePanel, jobPanel, animalPanel, truckPanel, menu,
  startFix, nearJob, driveTo, setGiant, lookAt, pick,
  get rideTruck(){ return rideTruck; }, get fixing(){ return fixing; }, get time(){ return gameTime; }, get head(){ return headPos.toArray(); },
  set camStyle(v){ camStyle = v; },
};
void lerp; void angleDiff; void IN; void OUT; void JOBS; void MAX_TRUCKS;
