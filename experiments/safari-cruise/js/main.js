// Safari Cruise: the main loop. Plays two ways from the same game:
//  - iPad / phone / computer: a camera that flies over the safari (drag to turn, pinch or scroll to zoom,
//    two fingers or WASD to move); tap animals, trucks and job markers; panels for everything you
//    manage; hop on a tour truck, or drive your own jeep with the thumb stick.
//  - VR (WebXR, e.g. a Quest's browser): you stand in the safari (or tower over it at giant size), a
//    tablet in your left hand holds the same panels, you point with the right controller and pull the
//    trigger. Riding sits you in a truck; driving puts you behind the wheel of your jeep.
import * as THREE from 'three';
import { V, clamp, lerp, damp, angleDiff, fmtMoney } from './util.js';
import { World, ZONES, LANE, IN, OUT, ROAD_W } from './world.js';
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
scene.fog = new THREE.Fog(0xc4d2bc, 140, 1100);
const skyDome = new THREE.Mesh(new THREE.SphereGeometry(2000, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { sun: { value: SUN_DIR } },
  vertexShader: 'varying vec3 d; void main(){ d = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }',
  fragmentShader: `uniform vec3 sun; varying vec3 d;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
    void main(){ vec3 v = normalize(d); float y = max(v.y, 0.0);
      vec3 c = mix(vec3(0.8, 0.86, 0.8), vec3(0.34, 0.56, 0.84), pow(y, 0.55));
      float s = max(dot(v, sun), 0.0); c += vec3(1.0, 0.9, 0.7) * (pow(s, 300.0) * 2.5 + pow(s, 6.0) * 0.18);
      if (v.y > 0.02){ vec2 uv = v.xz / (v.y + 0.12) * 1.4; float k = n(uv) * 0.5 + n(uv * 2.3) * 0.3 + n(uv * 5.1) * 0.2; c = mix(c, vec3(1.0, 0.98, 0.95), smoothstep(0.5, 0.82, k) * smoothstep(0.02, 0.35, v.y) * 0.9); }
      if (v.y < 0.0) c = vec3(0.6, 0.68, 0.56);
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
    }`,
}));
skyDome.frustumCulled = false; skyDome.renderOrder = -1; scene.add(skyDome);
const hemi = new THREE.HemisphereLight(0xdcecff, 0x4a6a34, 1.2); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff4e0, 2.6);
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
let view = 'walk';              // 'walk' (on foot) | 'ride' (on a truck) | 'drive' (your jeep)
let gameTime = 0, saveT = 0, hudT = 0, callT = 5;
const look = { yaw: 0, pitch: 0 };
let camStyle = 'cockpit';       // driving: 'cockpit' | 'chase'
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
  $('b-drive').textContent = view === 'drive' ? '🚶 Get out' : '🚙 Jeep';
  $('b-ride').textContent = view === 'ride' ? '🚶 Get off' : '🚌 Ride a truck';
  // jobs
  const J = $('jobs'); J.innerHTML = '';
  const list = sim.jobs.slice(0, view === 'walk' ? 5 : 3);
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
  else if (view === 'walk'){ const me = myPos(), pol = world.polar(me.x, me.z), Z = ZONES[pol.zone]; $('speedo').textContent = `📍 ${pol.zone && (pol.lat < -IN || pol.lat > OUT) ? 'Outside the fence' : Z.name}`; }
  else if (view === 'ride' && rideTruck){ $('speedo').textContent = `🚌 Truck ${rideTruck.number} · ${ZONES[world.polar(rideTruck.pos.x, rideTruck.pos.z).zone].name}${rideTruck.state === 'station' ? ' · at the station' : ''}`; }
  const fj = nearJob();
  $('b-fix').classList.toggle('show', view !== 'ride' && !!fj);
  if (fj) $('b-fix').textContent = `🔧 ${fj.verb}: ${shortLabel(fj)}`;
}
function shortLabel(j){ if (j.type === 'vet' || j.type === 'wash') return j.target.name; if (j.type === 'repair' || j.type === 'service') return 'Truck ' + j.target.number; return ZONES[j.target].name; }

// ---------- panels ----------
function showPanel(spec){ if (mode === 'vr'){ vrPage = spec; refreshTablet(); } else panel.show(spec); }
function closePanels(){ panel.close(); vrPage = null; refreshTablet(); }
const money = () => fmtMoney(sim.state.money);


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
  buttons.push({ label: '🚶 Go there', go: () => goTo(a.centre(), 8) });
  showPanel({ title: `${S.icon} ${a.name} the ${S.name}`, money: money(), sections: [{ text: `Lives in ${Z.name}. ${S.food === 'meat' ? 'Eats meat.' : 'Eats hay and grass.'}` }, { rows }, { buttons }] });
}
function truckPanel(t){
  const D = t.data;
  const state = t.broken ? '⚠ Broken down!' : t.state === 'station' ? 'At the station, loading' : t.state === 'depot' ? 'In the garage for a service' : t.state === 'toDepot' || t.state === 'fromDepot' ? 'Driving in to the garage' : `On tour · ${ZONES[world.polar(t.pos.x, t.pos.z).zone].name}`;
  const job = sim.jobs.find((j) => j.target === t);
  const buttons = [{ label: '🚌 Ride on it', go: () => { closePanels(); startRide(t); } }, { label: '🚶 Go there', go: () => goTo(t.pos, 6) }];
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
  buttons.push({ label: '🚶 Go there', go: () => goTo(p, 6) });
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
  const rows = list.map((a) => ({ icon: icon(SPECIES[a.kind].icon, a.data.sick ? '#b83a24' : '#5a3a1a'), title: `${a.name} the ${SPECIES[a.kind].name}${a.data.sick ? ' 🤒' : ''}`, sub: `❤️ ${pct(a.data.health)} · 🛁 ${pct(100 - a.data.dirt)} · 🌾 ${pct(100 - a.data.hunger)}`, button: { label: '🚶 Go', go: () => goTo(a.centre(), 8) } }));
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
        button: open ? { label: '✓ Open', disabled: true, go(){} } : { label: fmtMoney(Z.price), disabled: S.money < Z.price, go: () => { if (sim.openZone(Z)){ sfx.buy(); say(`${Z.name} is open! The animals are moving in.`, 'good'); goToZone(Z); } } } };
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
      'You can do jobs yourself: walk or drive up to one and press Fix it.',
      'Spend your money on new enclosures, more animals, more trucks and upgrades in the Shop.',
    ] },
    { buttons: [{ label: 'Back to the safari', kind: 'primary', go: closePanels }, { label: 'Title screen', go: () => { closePanels(); toTitle(); } }] },
  ] });
}
function welcome(){
  showPanel({ title: 'Welcome, Safari Manager!', money: money(), sections: [
    { text: 'You\'ve taken over Safari Cruise: a drive-through safari cut into the jungle. You\'re standing at the Lodge. Two enclosures are open (zebras, wildebeest and ostriches; giraffes and impala) and two tour trucks are carrying visitors round.' },
    { list: [
      mode === 'vr' ? 'Left stick to walk, right stick to turn. Point at things and pull the trigger.' : 'Walk with your left thumb (or WASD), drag to look round, tap things to see what they need.',
      'Your vet, keeper and mechanic go out to jobs by themselves. Walk or drive up to a job to do it yourself.',
      '🚙 Jeep to drive round the loop, 🚌 Ride to hop on a tour truck, 🗺 Go to to jump to an enclosure.',
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
$('b-go').onclick = () => { startAudio(); sfx.click(); goPanel(); };

// ---------- getting about: on foot, in your jeep, on a truck ----------
// where you are (your feet), whatever you're doing
function myPos(){ if (view === 'drive') return jeep.pos; if (view === 'ride' && rideTruck) return rideTruck.pos; return mode === 'vr' ? V(headPos.x, 0, headPos.z) : player.pos; }
// stand somewhere (facing a point, if given)
function standAt(p, face){
  player.pos.set(p.x, groundAt(p.x, p.z), p.z);
  if (face) player.yaw = Math.atan2(-(face.x - p.x), -(face.z - p.z));
  player.pitch = 0;
  if (mode === 'vr') vrPlace(player.pos, face ? player.yaw : null);
}
// go and stand by something: on the road side of it, a few metres away
function goTo(p, back = 7){
  if (view !== 'walk') leaveVehicle();
  const pol = world.polar(p.x, p.z), dir = pol.lat > 0 ? -1 : 1;
  const stand = world.at(pol.phi, pol.lat + dir * Math.min(back, Math.abs(pol.lat) + 3));
  standAt(stand, p);
  closePanels(); updateHUD(); refreshTablet();
}
function goToZone(Z){
  // just inside the gate, by the road, looking along it
  const s = world.sOfPhi(Z.phi0) + (Z.lodge ? 30 : 16), R = world.road(s, -(ROAD_W / 2 + 1.2));
  const ahead = R.p.clone().addScaledVector(R.t, 10).addScaledVector(R.n, -6);
  if (Z.lodge){ const p = world.lodgePoint(0, 26).p; standAt(p, world.lodgePoint(0, 6).p); }
  else standAt(R.p, ahead);
  if (view !== 'walk') leaveVehicle(true);
  closePanels(); updateHUD(); refreshTablet();
}
function startRide(t){
  closePanels();
  if (view === 'drive') view = 'walk';
  if (!t){
    const at = myPos();
    t = sim.trucks.slice().sort((a, b) => a.pos.distanceToSquared(at) - b.pos.distanceToSquared(at))[0];
  }
  if (!t) return;
  if (rideTruck) leaveTruck();
  rideTruck = t; t.player = true;
  const free = sim.firstFreeSeat(t); t.playerSeat = free >= 0 ? free : 1;
  if (!t.riders[1]) t.playerSeat = 1;     // the front-row middle seat is the best one
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
  const here = myPos().clone();
  if (rideTruck) leaveTruck();
  // if the jeep is a long way off, someone brings it round for you
  if (jeep.pos.distanceTo(here) > 30){
    const pol = world.polar(here.x, here.z), R = world.road(world.sOfPhi(pol.phi), pol.lat > 0 ? LANE + 1.5 : -LANE - 1.5);
    const p = Math.abs(pol.lat) < 40 ? R.p : here.clone().add(V(2.5, 0, 0));
    jeep.reset(p, Math.abs(pol.lat) < 40 ? Math.atan2(R.t.x, R.t.z) : player.yaw + Math.PI);
    if (!world.inWater(p.x, p.z)) say('Your jeep has been brought round for you.', '');
  }
  view = 'drive'; look.yaw = 0; look.pitch = 0;
  if (mode === 'vr') vrSit();
  if (!sim.state.tips.drive){ sim.state.tips.drive = true; say(mode === 'vr' ? 'Left stick: go and stop. Right stick: steer.' : 'Thumb stick (or WASD / the arrow keys) to drive. Go and see the animals!', ''); }
  updateHUD(); refreshTablet();
}
function driveTo(p){
  // put the jeep on the road near the job, facing the right way
  const pol = world.polar(p.x, p.z), s = world.sOfPhi(pol.phi) - 25, R = world.road(s, -LANE);
  if (rideTruck) leaveTruck();
  jeep.reset(R.p, Math.atan2(R.t.x, R.t.z));
  view = 'walk';
  startDrive();
}
function leaveVehicle(quiet){
  let p = null, face = null;
  if (view === 'ride' && rideTruck){ const t = rideTruck; const R = world.road(t.s, LANE + 3.2); p = R.p; face = t.pos.clone().addScaledVector(t.fwd, 6); leaveTruck(); }
  if (view === 'drive'){
    // step out on the driver's side (or the other, if something's in the way)
    const r = V(Math.cos(jeep.yaw), 0, -Math.sin(jeep.yaw));
    p = jeep.pos.clone().addScaledVector(r, -1.8);
    const q = p.clone(); if (world.collide(q, 0.4)) p = jeep.pos.clone().addScaledVector(r, 1.8);
    face = p.clone().addScaledVector(V(Math.sin(jeep.yaw), 0, Math.cos(jeep.yaw)), 5);
  }
  fixing = null; $('fixbar').style.display = 'none';
  const was = view;
  view = 'walk';
  if (mode === 'vr') vrs.seatHead = null;
  if (p && !quiet) standAt(p, face);
  else if (p && was !== 'walk') standAt(p, face);
  updateHUD(); refreshTablet();
}
// a job close enough to do yourself (on foot, or from the jeep)
function nearJob(){
  if (view === 'ride') return null;
  const me = myPos(), reach = view === 'drive' ? 13 : 7;
  let best = null, bd = reach * reach;
  for (const j of sim.jobs){ if (!sim.jobReady(j)) continue; const p = sim.jobPos(j), d = (p.x - me.x) ** 2 + (p.z - me.z) ** 2; if (d < bd){ bd = d; best = j; } }
  return best;
}
function startFix(){
  const j = nearJob(); if (!j || fixing) return;
  fixing = { job: j, t: 0 };
  if (j.target && j.target.held !== undefined) j.target.held = true;
  if (j.type === 'repair' || j.type === 'service') sfx.spanner(myPos()); else if (j.type === 'wash') sfx.splash(sim.jobPos(j));
}
function updateFix(dt){
  if (!fixing) return;
  const j = fixing.job;
  if (!sim.jobs.includes(j)){ fixing = null; $('fixbar').style.display = 'none'; return; }
  const p = sim.jobPos(j), me = myPos();
  if (Math.hypot(p.x - me.x, p.z - me.z) > (view === 'drive' ? 16 : 10)){ fixing = null; $('fixbar').style.display = 'none'; say('Too far away! Go back and try again.', 'bad'); return; }
  fixing.t += dt / 3;
  sim.workEffects(j, me.clone().setY(world.height(me.x, me.z)), dt);
  if (Math.random() < dt * 2 && (j.type === 'repair' || j.type === 'service')) sfx.spanner(p);
  if (mode === 'screen'){ $('fixbar').style.display = 'block'; $('fixbar').firstChild.style.width = Math.round(fixing.t * 100) + '%'; $('fixbar').lastChild.textContent = `Working... ${Math.round(fixing.t * 100)}%`; }
  if (fixing.t >= 1){
    sim.finishJob(j, true); fixing = null; $('fixbar').style.display = 'none';
    say(`Job done! ${j.label.replace(/ (is poorly|needs a wash|needs cleaning|has broken down|needs a service)$/, '').replace(/ feeder is (nearly )?empty$/, ' feeder')}: sorted.`, 'good');
  }
}
function goPanel(){
  showPanel({ title: '🗺 Go to...', money: money(), sections: [
    { text: 'The safari loop is nearly a kilometre round. Jump straight to the gate of any enclosure (or back to the Lodge).' },
    { grid: ZONES.map((Z) => ({ label: Z.name, sub: Z.lodge ? 'station, garage' : sim.isOpen(Z) ? Z.species.map((k) => SPECIES[k].plural).join(', ') : 'coming soon', icon: icon(Z.icon, sim.isOpen(Z) || Z.lodge ? '#3a6a2a' : '#5a3a1a'), go: () => goToZone(Z) })), cols: 3, cellH: 170 },
  ] });
}

// ---------- screen input: a thumb stick, drag to look, tap things ----------
const touch = { stickId: null, stick: null, look: new Map() };
const keys = {};
const stickEl = $('stick'), knobEl = $('knob');
function stickZone(x, y){ return x < innerWidth * 0.42 && y > innerHeight * 0.42; }
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (mode !== 'screen') return;
  startAudio();
  try { renderer.domElement.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
  if (e.pointerType !== 'mouse' && stickZone(e.clientX, e.clientY) && touch.stickId == null){
    touch.stickId = e.pointerId; touch.stick = { x0: e.clientX, y0: e.clientY };
    stickEl.style.left = (e.clientX - 60) + 'px'; stickEl.style.top = (e.clientY - 60) + 'px'; stickEl.classList.add('on');
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
  if (view === 'walk'){ player.yaw -= dx * 0.005; player.pitch = clamp(player.pitch - dy * 0.005, -1.3, 1.2); }
  else { look.yaw = clamp(look.yaw - dx * 0.005, -2.8, 2.8); look.pitch = clamp(look.pitch - dy * 0.004, -1.1, 1.1); }
});
function releaseStick(){ touch.stickId = null; touch.stick = null; stick.x = stick.y = 0; stickEl.classList.remove('on'); knobEl.style.transform = ''; }
const endPointer = (e) => {
  if (e.pointerId === touch.stickId){ releaseStick(); return; }
  const L = touch.look.get(e.pointerId); if (!L) return;
  touch.look.delete(e.pointerId);
  if (L.moved < 12 && performance.now() - L.t < 500) pick(e.clientX, e.clientY);
};
renderer.domElement.addEventListener('pointerup', endPointer);
const cancelPointer = (e) => { touch.look.delete(e.pointerId); if (e.pointerId === touch.stickId) releaseStick(); };
renderer.domElement.addEventListener('pointercancel', cancelPointer);
renderer.domElement.addEventListener('lostpointercapture', (e) => { if (e.pointerId === touch.stickId) releaseStick(); });
addEventListener('pointerup', cancelPointer); addEventListener('pointercancel', cancelPointer);
const resetInput = () => { releaseStick(); touch.look.clear(); for (const k in keys) keys[k] = false; };
addEventListener('blur', resetInput);
document.addEventListener('visibilitychange', () => { if (document.hidden) resetInput(); });
addEventListener('keydown', (e) => {
  if (mode !== 'screen') return;
  keys[e.code] = true;
  if (e.code === 'Escape'){ if (panel.open) closePanels(); else if (view !== 'walk') leaveVehicle(); }
  if (e.code === 'KeyF') startFix();
  if (e.code === 'KeyH' && view === 'drive') sfx.horn(jeep.pos);
  if (e.code === 'KeyC' && view === 'drive'){ camStyle = camStyle === 'chase' ? 'cockpit' : 'chase'; }
  if (e.code === 'KeyE'){ if (view === 'walk') startDrive(); else leaveVehicle(); }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
// tapping on something in the world
const raycaster = new THREE.Raycaster();
function pick(x, y){
  raycaster.setFromCamera(new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1), camera);
  return pickRay(raycaster);
}
function pickRay(rc){
  rc.camera = camera;
  const markers = sim.jobs.map((j) => j.marker).filter((m) => m && m.visible);
  const mh = rc.intersectObjects(markers, false)[0];
  if (mh){ const j = sim.jobs.find((x) => x.marker === mh.object); if (j){ sfx.click(); jobPanel(j); return true; } }
  const objs = [...sim.animals.filter((a) => a.root.visible).map((a) => a.root), ...sim.trucks.filter((t) => t !== rideTruck).map((t) => t.root), ...sim.staff.map((s) => s.jeep.root)];
  if (view !== 'drive') objs.push(jeep.root);
  const hit = rc.intersectObjects(objs, true).find((h) => h.object.visible);
  if (!hit) return false;
  let o = hit.object; while (o && !o.userData.animal && !o.userData.truck && !o.userData.jeep && o !== jeep.root) o = o.parent;
  if (!o) return false;
  const u = o.userData;
  if (u.animal){ sfx.click(); animalPanel(u.animal); call(u.animal.kind, u.animal.pos); return true; }
  if (u.truck){ sfx.click(); truckPanel(u.truck); return true; }
  if (o === jeep.root){ sfx.click(); startDrive(); return true; }
  if (u.jeep){ const s = sim.staff.find((x) => x.jeep === u.jeep); if (s){ sfx.click(); showPanel({ title: `${STAFF[s.kind].icon} ${s.name}`, money: money(), sections: [{ text: s.job ? `Working on: ${s.job.label}` : s.state === 'returning' ? 'Driving back to the garage.' : 'Waiting at the garage for a job.' }, { buttons: [{ label: 'OK', go: closePanels }] }] }); return true; } }
  return false;
}

// ---------- walking ----------
const EYE = 1.62, WALK = 2.4, RUN = 5.5;
const player = { pos: V(), yaw: 0, pitch: 0 };
function walk(dt, mx, my, run){
  const l = Math.hypot(mx, my); if (l > 1){ mx /= l; my /= l; }
  if (!mx && !my) return;
  const sp = (run || l > 0.92 ? RUN : WALK) * dt;
  const f = V(-Math.sin(player.yaw), 0, -Math.cos(player.yaw)), r = V(-f.z, 0, f.x);
  player.pos.addScaledVector(f, -my * sp).addScaledVector(r, mx * sp);
  bump(player.pos);
}
// fences, trees, buildings, vehicles and the big animals are solid
function bump(p){
  world.collide(p, 0.35);
  for (const a of sim.animals){
    const r = (a.m.P.L || 1) * 0.42 + 0.35, dx = p.x - a.pos.x, dz = p.z - a.pos.z, d2 = dx * dx + dz * dz;
    if (d2 < r * r && d2 > 1e-4){ const d = Math.sqrt(d2); p.x = a.pos.x + dx / d * r; p.z = a.pos.z + dz / d * r; }
  }
  for (const v of [...sim.trucks.map((t) => [t.pos, 2.6]), [jeep.pos, 1.6]]){
    const [c, r] = v, dx = p.x - c.x, dz = p.z - c.z, d2 = dx * dx + dz * dz;
    if (d2 < r * r && d2 > 1e-4){ const d = Math.sqrt(d2); p.x = c.x + dx / d * r; p.z = c.z + dz / d * r; }
  }
  const l = Math.hypot(p.x, p.z); if (l > 400){ p.x *= 400 / l; p.z *= 400 / l; }
  // up onto the station platform (and the garage floor)
  p.y = groundAt(p.x, p.z);
}
function groundAt(x, z){
  const h = world.height(x, z);
  const pol = world.polar(x, z), dS = ((world.sOfPhi(pol.phi) - world.stationS + world.L / 2) % world.L) - world.L / 2;
  if (Math.abs(dS) < 16 && pol.lat > 4.9 && pol.lat < 8.3) return world.lodgeH + 0.9;
  return h;
}

// vehicles face +z but cameras look down -z, so seats turn the view round
const FLIP = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.PI);

// ---------- the screen camera ----------
const chase = { dist: 10, pos: V(), init: false };
function placeScreenCamera(dt){
  rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0); rig.scale.setScalar(1);
  if (mode === 'title'){
    const t = orbit.target, d = orbit.dist;
    camera.position.set(t.x + Math.sin(orbit.yaw) * Math.cos(orbit.pitch) * d, t.y + Math.sin(orbit.pitch) * d, t.z + Math.cos(orbit.yaw) * Math.cos(orbit.pitch) * d);
    camera.lookAt(t); camera.fov = 55; camera.updateProjectionMatrix();
    return;
  }
  if (view === 'ride' && rideTruck){
    camera.position.copy(rideTruck.seatEye(rideTruck.playerSeat));
    rideTruck.m.body.updateWorldMatrix(true, false);
    const q = new THREE.Quaternion().setFromRotationMatrix(rideTruck.m.body.matrixWorld);
    camera.quaternion.copy(q).multiply(FLIP).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(look.pitch, look.yaw, 0, 'YXZ')));
    camera.fov = 72; camera.updateProjectionMatrix();
    return;
  }
  if (view === 'drive'){
    if (camStyle === 'cockpit'){
      camera.position.copy(jeep.eye());
      camera.quaternion.copy(jeep.quat).multiply(FLIP).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(look.pitch, look.yaw, 0, 'YXZ')));
      if (!touch.look.size){ look.yaw = damp(look.yaw, 0, 0.5, dt); look.pitch = damp(look.pitch, 0, 0.5, dt); }
      camera.fov = 72;
    } else {
      const f = V(Math.sin(jeep.yaw + look.yaw), 0, Math.cos(jeep.yaw + look.yaw));
      const want = jeep.pos.clone().addScaledVector(f, -chase.dist).add(V(0, chase.dist * 0.36 + 1.5, 0));
      want.y = Math.max(want.y, world.height(want.x, want.z) + 1.5);
      if (!chase.init){ chase.pos.copy(want); chase.init = true; }
      chase.pos.lerp(want, Math.min(1, dt * 4));
      camera.position.copy(chase.pos);
      camera.lookAt(jeep.pos.clone().add(V(0, 1.6, 0)).addScaledVector(f, 4));
      if (!touch.look.size) look.yaw = damp(look.yaw, 0, 0.8, dt);
      camera.fov = 64;
    }
    camera.updateProjectionMatrix();
    return;
  }
  chase.init = false;
  camera.fov = 70; camera.updateProjectionMatrix();
  camera.position.set(player.pos.x, player.pos.y + EYE, player.pos.z);
  camera.quaternion.setFromEuler(new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ'));
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
const vrs = { tablet: true, snapReady: true, seatHead: null, seatYaw: 0 };
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
  for (const h of vr){ const m = handMeshes[h.i]; m.visible = h.tracked; if (h.tracked){ m.position.copy(h.pos); m.quaternion.copy(h.quat); } }
  tabletHolder.visible = L.tracked && vrs.tablet;
  if (tabletHolder.visible){ tabletHolder.position.copy(L.pos); tabletHolder.quaternion.copy(L.quat); }
  laser.visible = false; dot.visible = false;
  let onTablet = false;
  if (R.tracked){
    const dir = V(0, 0, -1).applyQuaternion(R.rayQuat);
    if (tabletHolder.visible){
      tabletHolder.updateMatrixWorld(true);
      const hit = tablet.ray(R.rayPos, dir, R.triggerDown, 3);
      if (hit){
        onTablet = true;
        laser.visible = true; dot.visible = true;
        laser.position.copy(R.rayPos); laser.lookAt(hit.point); laser.scale.set(1, 1, R.rayPos.distanceTo(hit.point));
        dot.position.copy(hit.point);
        if (hit.clicked){ R.haptic(0.3, 30); sfx.click(); refreshTablet(); }
        if (Math.abs(R.stick.y) > 0.3) tablet.scrollBy(R.stick.y * dt * 900);
      }
    }
    // pointing at the world: the trigger on an animal, a truck or a job marker (or fixes a job you're next to)
    if (!onTablet && R.triggerDown){
      if (nearJob() && !fixing) startFix();
      else { const rc = new THREE.Raycaster(R.rayPos, dir, 0, 600); if (pickRay(rc)){ R.haptic(0.4, 40); vrs.tablet = true; } }
    }
  }
  if (R.aDown){ if (view === 'walk') startRide(); else leaveVehicle(); }
  if (R.bDown){ if (view === 'walk') startDrive(); else if (view === 'drive') sfx.horn(jeep.pos); else nextTruck(); }
  if (L.aDown || L.bDown){ vrs.tablet = !vrs.tablet; }
  if (view !== 'walk') return;
  const sx = R.stick.x;
  if (Math.abs(sx) > 0.7 && vrs.snapReady && !onTablet){ turnRig(-Math.sign(sx) * Math.PI / 6); vrs.snapReady = false; }
  if (Math.abs(sx) < 0.35) vrs.snapReady = true;
  // walking where you look (and your real steps); you can't walk through fences, trees or animals
  let mx = L.stick.x, my = L.stick.y; if (Math.hypot(mx, my) < 0.15){ mx = 0; my = 0; }
  const want = V(headPos.x, 0, headPos.z);
  if (mx || my){
    const f = V(0, 0, -1).applyQuaternion(headQuat); f.y = 0; f.normalize();
    const r = V(-f.z, 0, f.x), sp = (Math.hypot(mx, my) > 0.95 ? RUN : WALK) * dt;
    want.addScaledVector(f, -my * sp).addScaledVector(r, mx * sp);
  }
  bump(want);
  rig.position.x += want.x - headPos.x; rig.position.z += want.z - headPos.z;
  rig.position.y = want.y;
  player.pos.copy(want);
}
function turnRig(a){ v1.copy(headPos); rig.position.sub(v1).applyAxisAngle(V(0, 1, 0), a).add(v1); rig.rotation.y += a; rig.updateMatrixWorld(true); }
// stand the play space so your head is over p (facing yaw, if given)
function vrPlace(p, yaw){
  vrs.seatHead = null;
  // the headset's pose isn't known until its first frame: do it then
  if (!vrs.posed){ vrs.pending = { p: p.clone(), yaw }; return; }
  rig.scale.setScalar(1);
  const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  const ry = yaw != null ? yaw - e.y : new THREE.Euler().setFromQuaternion(rig.quaternion, 'YXZ').y;
  rig.quaternion.setFromEuler(new THREE.Euler(0, ry, 0, 'YXZ'));
  const local = V(camera.position.x, 0, camera.position.z).applyQuaternion(rig.quaternion);
  rig.position.set(p.x - local.x, groundAt(p.x, p.z), p.z - local.z);
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
  const rq = q.clone().multiply(FLIP).multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), -vrs.seatYaw));
  // keep the horizon level (only turn with the vehicle) so nobody feels sick
  const e = new THREE.Euler().setFromQuaternion(rq, 'YXZ'); rq.setFromEuler(new THREE.Euler(0, e.y, 0, 'YXZ'));
  rig.quaternion.copy(rq);
  rig.position.copy(eye).sub(vrs.seatHead.clone().applyQuaternion(rq));
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
  const fj = nearJob();
  const fixRow = fj ? [{ title: `🔧 ${fj.verb}: ${shortLabel(fj)}`, sub: fixing ? `Working... ${Math.round(fixing.t * 100)}%` : 'Pull the trigger to do it yourself', button: { label: fixing ? '...' : 'Fix it', disabled: !!fixing, go: startFix } }] : [];
  const jobRows = sim.jobs.slice(0, view === 'walk' ? 4 : 2).map((j) => ({ title: `${j.icon} ${shortLabel(j)}`, sub: j.assigned ? `${j.assigned.name} is on it` : j.label, button: { label: j.assigned ? 'Open' : 'Send', go: () => { if (!j.assigned && sim.hurry(j)) sfx.click(); else jobPanel(j); } } }));
  if (view === 'ride'){
    return { title: `🚌 Truck ${rideTruck ? rideTruck.number : ''}`, money: money(), sections: [
      { text: last || status },
      { rows: jobRows },
      { buttons: [{ label: '⬅ Get out (A)', kind: 'danger', go: () => leaveVehicle() }, { label: '⏭ Next (B)', go: nextTruck }] },
    ] };
  }
  if (view === 'drive'){
    return { title: '🚙 Your jeep', money: money(), sections: [
      { text: last || `${Math.round(Math.abs(jeep.v) * 2.237)} mph · ${ZONES[world.polar(jeep.pos.x, jeep.pos.z).zone].name}` },
      { rows: [...fixRow, ...jobRows] },
      { buttons: [{ label: '📯 Horn (B)', go: () => sfx.horn(jeep.pos) }, { label: '⬅ Get out (A)', kind: 'danger', go: () => leaveVehicle() }] },
    ] };
  }
  return { title: 'Safari Cruise', money: money(), sections: [
    { text: last || status },
    { rows: [...fixRow, ...(jobRows.length ? jobRows : [{ title: '✓ No jobs to do', sub: 'Everything is fine!' }])] },
    { buttons: [{ label: '🚙 Jeep (B)', kind: 'primary', go: startDrive }, { label: '🚌 Ride (A)', go: () => startRide() }, { label: '🗺 Go to', go: goPanel }] },
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
  if (T && T.noRender && mode !== 'vr') return;     // (a headset only sends its next frame once this one is drawn)
  if (mode !== 'vr') placeScreenCamera(dt);
  renderer.render(scene, camera);
}
const vehiclePos = [];
function simulate(dt, first){
  if (mode === 'vr'){
    rig.updateMatrixWorld(true);
    renderer.xr.getCamera().matrixWorld.decompose(headPos, headQuat, v1);
    // wait for the headset's first real frames before placing you or letting you walk
    if (!vrs.posed){ vrs.frames = renderer.xr.isPresenting ? (vrs.frames || 0) + 1 : 0; }
    if (!vrs.posed && vrs.frames >= 3){ vrs.posed = true; if (vrs.pending){ const q = vrs.pending; vrs.pending = null; vrPlace(q.p, q.yaw); rig.updateMatrixWorld(true); renderer.xr.getCamera().matrixWorld.decompose(headPos, headQuat, v1); } }
    if (vrs.posed) vrUpdate(dt);
  } else if (mode === 'screen' && view === 'walk'){
    headPos.set(player.pos.x, player.pos.y + EYE, player.pos.z);
    headQuat.setFromEuler(new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ'));
  } else { camera.updateMatrixWorld(true); camera.matrixWorld.decompose(headPos, headQuat, v1); }
  if (mode === 'title') titleSpin(dt);
  const k = (c) => (keys[c] ? 1 : 0);
  // walking about
  if (mode === 'screen' && view === 'walk'){
    walk(dt, stick.x + k('KeyD') - k('KeyA'), stick.y + k('KeyS') - k('KeyW'), keys.ShiftLeft || keys.ShiftRight);
    player.yaw += (k('ArrowLeft') - k('ArrowRight')) * dt * 1.8;
    player.pitch = clamp(player.pitch + (k('ArrowUp') - k('ArrowDown')) * dt, -1.3, 1.2);
    player.pos.y = groundAt(player.pos.x, player.pos.z);
  }
  // driving your jeep
  if (view === 'drive'){
    if (mode === 'vr') vrDrive(dt);
    else {
      const th = -stick.y + k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown'), st = stick.x + k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft');
      jeep.update(dt, clamp(th, -1, 1), clamp(st, -1, 1));
    }
  } else jeep.pose(0);
  if (view !== 'ride') updateFix(dt);
  // everything that drives opens the gates (and so do you, walking up to one)
  vehiclePos.length = 0;
  for (const t of sim.trucks) vehiclePos.push(t.pos);
  for (const s of sim.staff) if (!s.jeep.parked) vehiclePos.push(s.jeep.pos);
  vehiclePos.push(view === 'drive' ? jeep.pos : myPos());
  world.updateGates(dt, vehiclePos);
  const animalWatch = view === 'drive' ? [...vehiclePos] : [...vehiclePos.slice(0, -1), myPos()];
  sim.update(dt, { vehicles: animalWatch, cam: headPos, markerScale: mode === 'vr' ? 0.35 : 0.6 });
  if (mode === 'vr' && view === 'ride' && rideTruck){ rideTruck.m.body.updateWorldMatrix(true, false); vrSeatAt(rideTruck.seatEye(rideTruck.playerSeat), new THREE.Quaternion().setFromRotationMatrix(rideTruck.m.body.matrixWorld)); }
  if (mode === 'vr' && view === 'drive') vrSeatAt(jeep.eye(), jeep.quat);
  // the sun's shadows follow you
  const focus = mode === 'title' ? orbit.target : headPos;
  sun.target.position.set(Math.round(focus.x), 0, Math.round(focus.z));
  sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 200);
  skyDome.position.copy(headPos);
  setListener(headPos, v1.set(0, 0, -1).applyQuaternion(headQuat), v2.set(0, 1, 0).applyQuaternion(headQuat));
  if (!first) return;
  // sounds: the nearest truck's engine, your own, and now and then an animal calling
  let nt = null, nd = 1e9; for (const t of sim.trucks){ if (t === rideTruck) continue; const d = t.pos.distanceToSquared(headPos); if (d < nd){ nd = d; nt = t; } }
  engines(nt && nd < 150 * 150 ? nt.pos : null, nt ? nt.v : 0, view === 'drive' ? jeep.v : rideTruck ? rideTruck.v + 2 : 0, view !== 'walk', view === 'ride');
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
  if (mode === 'vr'){ tabletT -= dt; if (tabletT <= 0){ tabletT = view === 'walk' ? 0.7 : 0.5; tablet.show(tabletSpec()); } }
  saveT += dt; if (saveT > 15 && mode !== 'title'){ saveT = 0; sim.save(); }
}
renderer.setAnimationLoop(frame);
// for the headless test: run the game forward without waiting for frames (until cond() is true, if given)
function advance(sec, cond){
  const dt = 1 / 20;
  for (let t = 0; t < sec; t += dt){ gameTime += dt; simulate(dt, true); if (cond && cond()) return true; }
  return cond ? !!cond() : true;
}
function renderNow(){ if (mode !== 'vr') placeScreenCamera(1 / 60); renderer.render(scene, camera); }

// ---------- title screen ----------
const orbit = { target: V(), yaw: 0, pitch: 0.2, dist: 55 };
let spin = 0;
function titleSpin(dt){
  spin += dt * 0.03;
  const Z = ZONES[2], p = world.at(Z.phi0 + 0.02, 0);
  orbit.target.set(p.x, p.y + 2, p.z); orbit.yaw = spin + 3.6; orbit.pitch = 0.18; orbit.dist = 50;
}
function toTitle(){
  if (renderer.xr.isPresenting) renderer.xr.getSession().end();
  leaveVehicle(true); sim.save();
  mode = 'title'; view = 'walk'; $('title').classList.remove('hidden'); document.body.classList.remove('playing');
  refreshTitle();
}
function refreshTitle(){ $('b-new').style.display = localStorage.getItem(SAVE_KEY) ? '' : 'none'; }
let fresh = false;
// you start at the Lodge, on the walkway, looking at the station and the trucks
function startSpot(){ const p = world.lodgePoint(-5, 20).p; standAt(p, world.lodgePoint(-1, 6).p); }
function ensureGame(newOne){
  if (newOne){ sim.newGame(); fresh = true; }
  view = 'walk'; rideTruck = null;
  startSpot();
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
      if (mode === 'vr'){ leaveVehicle(true); mode = 'title'; view = 'walk'; $('title').classList.remove('hidden'); document.body.classList.remove('playing'); camera.position.set(0, 0, 0); camera.quaternion.identity(); rig.position.set(0, 0, 0); rig.quaternion.identity(); sim.save(); tabletHolder.visible = false; laser.visible = false; dot.visible = false; for (const m of handMeshes) m.visible = false; refreshTitle(); }
    });
    sun.shadow.mapSize.set(1024, 1024); if (sun.shadow.map){ sun.shadow.map.dispose(); sun.shadow.map = null; }
    if (window.__sc && window.__sc.xrScale) renderer.xr.setFramebufferScaleFactor(window.__sc.xrScale);
    await renderer.xr.setSession(session);
    try { if (session.supportedFrameRates && session.updateTargetFrameRate){ const r = [...session.supportedFrameRates]; if (r.includes(72)) await session.updateTargetFrameRate(72); } } catch (e) {}
    mode = 'vr'; $('title').classList.add('hidden');
    vrs.tablet = true; vrPage = null; vrs.posed = false; vrs.frames = 0;
    camera.position.set(0, 1.6, 0); camera.quaternion.identity();
    clock.getDelta();
    startSpot();
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
  get mode(){ return mode; }, get view(){ return view; }, world, sim, jeep, renderer, camera, scene, rig, vr, tablet, vrs, ZONES, SPECIES, player,
  timeScale: 1, noRender: false, version: VERSION, stick, keys,
  startScreen, startVR, startRide, startDrive, leaveVehicle, nextTruck, closePanels, tabletSpec, animalsPanel, trucksPanel, staffPanel, shopPanel, officePanel, jobPanel, animalPanel, truckPanel, menu, goPanel,
  startFix, nearJob, driveTo, goTo, goToZone, standAt, pick, myPos, advance, renderNow,
  get rideTruck(){ return rideTruck; }, get fixing(){ return fixing; }, get time(){ return gameTime; }, get head(){ return headPos.toArray(); },
  set camStyle(v){ camStyle = v; },
};
void lerp; void angleDiff; void IN; void OUT; void JOBS; void MAX_TRUCKS;
