// Running the safari: the clock, visitors and tickets, the trucks' tours, the animals' needs, the jobs
// that come up (sick animals, dirty animals, dung, empty feeders, broken-down and worn-out trucks), the
// staff who drive out to do them, the money, the star rating, and saving.
import * as THREE from 'three';
import { V, clamp, lerp, rng, ellipsoid, mergeGeometries, textCanvas } from './util.js';
import { ZONES, LANE } from './world.js';
import { Animal, SPECIES } from './animals.js';
import { Truck, StaffJeep, SEATS, TRUCK_COLOURS, Puffs } from './vehicles.js';
import { Crowd, Riders, randomLook } from './people.js';

export const SAVE_KEY = 'safari-cruise-v1';
export const DAY_SECONDS = 360;                 // one day (9 am to 6 pm) lasts six minutes
export const STAFF = {
  vet: { name: 'Vet', plural: 'Vets', icon: '🩺', wage: 80, does: 'Treats sick animals' },
  keeper: { name: 'Keeper', plural: 'Keepers', icon: '🧹', wage: 60, does: 'Feeds and washes the animals, cleans up dung' },
  mechanic: { name: 'Mechanic', plural: 'Mechanics', icon: '🔧', wage: 70, does: 'Fixes broken-down trucks and services worn ones' },
};
export const JOBS = {
  vet: { icon: '🤒', staff: 'vet', work: 9, cost: 80, verb: 'Treat' },
  wash: { icon: '🛁', staff: 'keeper', work: 7, cost: 10, verb: 'Wash' },
  clean: { icon: '💩', staff: 'keeper', work: 9, cost: 0, verb: 'Clean up' },
  feed: { icon: '🌾', staff: 'keeper', work: 6, cost: 40, verb: 'Feed' },
  repair: { icon: '🛠', staff: 'mechanic', work: 11, cost: 120, verb: 'Repair' },
  service: { icon: '🔩', staff: 'mechanic', work: 14, cost: 150, verb: 'Service' },
};
export const UPGRADES = {
  roads: { name: 'Smooth roads', icon: '🛣', price: 6000, text: 'Trucks wear out 40% slower and break down less.' },
  clinic: { name: 'Animal clinic', icon: '🏥', price: 7500, text: 'Animals get sick half as often.' },
  feeders: { name: 'Big feeders', icon: '🌾', price: 4000, text: 'Feeders hold twice as much food.' },
  cafe: { name: 'Lodge café', icon: '☕', price: 5000, text: 'Every visitor spends $4 more at the café.' },
  radios: { name: 'Staff radios', icon: '📻', price: 3000, text: 'Staff drive out to jobs 40% faster.' },
};
export const TRUCK_PRICE = 4500, MAX_TRUCKS = 6, MAX_PER_ZONE = 8, MAX_STAFF = 8;
const BREAKDOWNS = { tyre: 'a flat tyre', engine: 'an overheated engine', battery: 'a flat battery', fuel: 'run out of fuel' };

let jobId = 1;
export class Safari {
  constructor(world, scene){
    this.world = world; this.scene = scene;
    this.animals = []; this.trucks = []; this.staff = []; this.jobs = [];
    this.crowd = new Crowd(scene, 160);
    this.puffs = new Puffs(scene);
    this.queue = []; this.listeners = {};
    this.dungMesh = this.makeDung();
    this.state = null; this.t = 0; this.tick = 0;
    this.spawnT = 2;
  }
  on(ev, fn){ (this.listeners[ev] ||= []).push(fn); }
  emit(ev, data){ for (const f of this.listeners[ev] || []) f(data); }
  say(text, kind = ''){ this.emit('say', { text, kind }); }

  // ---------- a new park, saving and loading ----------
  newGame(){
    this.state = {
      v: 1, money: 6000, day: 1, clock: 0, rep: 3, ticket: 20,
      open: { plains: true, giraffe: true }, animals: [], trucks: [], staff: { vet: 1, keeper: 1, mechanic: 1 },
      food: {}, dung: {}, upgrades: {}, visitors: 0, earned: 0,
      today: { visitors: 0, income: 0, costs: 0, sold: 0 }, days: [], tips: {},
    };
    const S = this.state;
    for (const Z of ZONES) if (S.open[Z.id]){ S.food[Z.k] = 1; this.starterAnimals(Z); }
    S.trucks = [{ number: 1, colour: 0, condition: 92 }, { number: 2, colour: 1, condition: 70 }];
    this.rebuild();
  }
  starterAnimals(Z){
    Z.species.forEach((kind, i) => { for (let n = 0; n < Z.start[i]; n++) this.state.animals.push({ kind, zone: Z.k }); });
  }
  save(){
    if (!this.state) return;
    const S = this.state;
    S.animals = this.animals.map((a) => ({ ...a.data, zone: a.zone }));
    S.trucks = this.trucks.map((t) => ({ id: t.data.id, number: t.data.number, colour: t.data.colour, condition: Math.round(t.data.condition * 10) / 10, km: t.data.km }));
    S.food = {}; for (const f of this.world.feeders) if (f) S.food[f.k] = Math.round(this.food(f.k) * 100) / 100;
    S.dung = {}; for (const [k, list] of Object.entries(this.dung)) S.dung[k] = list.map((d) => [Math.round(d.x * 10) / 10, Math.round(d.z * 10) / 10]);
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) {}
  }
  load(){
    try {
      const S = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (!S || S.v !== 1) return false;
      this.state = { upgrades: {}, tips: {}, days: [], today: { visitors: 0, income: 0, costs: 0, sold: 0 }, ...S };
      this.rebuild();
      return true;
    } catch (e) { return false; }
  }
  // make the animals, trucks and staff from the saved state
  rebuild(){
    const S = this.state, W = this.world;
    for (const a of this.animals){ this.scene.remove(a.root); if (a.sickIcon) this.scene.remove(a.sickIcon); }
    for (const t of this.trucks) this.scene.remove(t.root);
    for (const s of this.staff) this.scene.remove(s.jeep.root);
    for (const j of this.jobs) this.removeMarker(j);
    for (const p of [...this.crowd.list]) this.crowd.remove(p);
    this.animals = []; this.trucks = []; this.staff = []; this.jobs = []; this.queue = [];
    for (const d of S.animals) this.addAnimal(d.kind, d.zone, d);
    S.trucks.forEach((d, i) => this.addTruck(d, i));
    for (const [kind, n] of Object.entries(S.staff)) for (let i = 0; i < n; i++) this.addStaff(kind);
    this.dung = {}; for (const Z of ZONES) this.dung[Z.k] = [];
    for (const [k, list] of Object.entries(S.dung || {})) this.dung[k] = list.map(([x, z]) => V(x, W.height(x, z), z));
    this.foodLevels = {}; for (const Z of ZONES) if (!Z.lodge) this.foodLevels[Z.k] = S.food[Z.k] ?? 1;
    this.refreshDung(); this.refreshZones();
  }
  addAnimal(kind, zone, data = {}){
    const a = new Animal(this.world, kind, zone, data);
    this.scene.add(a.root);
    a.sickIcon = this.makeSickIcon(); this.scene.add(a.sickIcon); a.sickIcon.visible = false;
    a.tint();
    this.animals.push(a);
    return a;
  }
  addTruck(d, i){
    const t = new Truck(this.world, d);
    // spread them out: one at the station, the others round the loop
    t.s = i === 0 ? this.world.stationS : (this.world.stationS - 60 * i + this.world.L) % this.world.L;
    if (i > 0){ t.state = 'touring'; t.lapS = 150; }
    t.riders = []; t.seen = new Set(); t.sickSeen = new Set(); t.breaks = 0;
    t.ridersMesh = new Riders(t);
    t.place(0);
    this.trucks.push(t);
    return t;
  }
  addStaff(kind){
    const j = new StaffJeep(this.world, kind);
    const s = { kind, jeep: j, job: null, state: 'idle', name: STAFF[kind].name + ' ' + (this.staff.filter((x) => x.kind === kind).length + 1) };
    j.park(this.bay(this.staff.length));
    this.staff.push(s);
    return s;
  }
  bay(i){
    const W = this.world, b = W.jeepBays[i % W.jeepBays.length].clone();
    if (i >= W.jeepBays.length){ const R = W.road(W.depotS, 0); b.addScaledVector(R.t, 3.5 * Math.floor(i / W.jeepBays.length)); }
    return b;
  }
  // the board by each enclosure and the "coming soon" signs
  refreshZones(){
    for (const Z of ZONES){
      if (Z.lodge) continue;
      const open = this.isOpen(Z), names = Z.species.map((k) => { const n = this.animals.filter((a) => a.kind === k && a.zone === Z.k).length; return n ? `${n} ${n === 1 ? SPECIES[k].name : SPECIES[k].plural}` : null; }).filter(Boolean).join(' · ');
      this.world.drawBoard(Z.k, open, names);
    }
  }
  isOpen(Z){ return !!this.state.open[Z.id]; }

  // ---------- markers ----------
  makeSickIcon(){
    if (!this.sickTex){ const tc = textCanvas(64, 64), c = tc.ctx; c.fillStyle = '#ffffff'; c.beginPath(); c.arc(32, 32, 30, 0, 7); c.fill(); c.fillStyle = '#e02020'; c.fillRect(25, 10, 14, 44); c.fillRect(10, 25, 44, 14); this.sickTex = tc.tex; }
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.sickTex, depthTest: true }));
    s.scale.setScalar(0.9); return s;
  }
  markerTex(icon){
    this.markerCache ||= new Map();
    if (!this.markerCache.has(icon)){
      const tc = textCanvas(128, 160), c = tc.ctx;
      c.fillStyle = 'rgba(200,40,30,0.95)'; c.beginPath(); c.arc(64, 60, 54, 0, 7); c.fill();
      c.beginPath(); c.moveTo(34, 100); c.lineTo(94, 100); c.lineTo(64, 154); c.closePath(); c.fill();
      c.strokeStyle = '#fff'; c.lineWidth = 6; c.beginPath(); c.arc(64, 60, 51, 0, 7); c.stroke();
      c.font = '64px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#fff'; c.fillText(icon, 64, 64);
      this.markerCache.set(icon, tc.tex);
    }
    return this.markerCache.get(icon);
  }
  addMarker(job){
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.markerTex(JOBS[job.type].icon), depthTest: false, transparent: true }));
    s.renderOrder = 5; s.center.set(0.5, 0); this.scene.add(s); job.marker = s;
  }
  removeMarker(job){ if (job.marker){ this.scene.remove(job.marker); job.marker.material.dispose(); job.marker = null; } }

  // ---------- dung ----------
  makeDung(){
    const parts = []; for (const [x, z, r] of [[0, 0, 0.16], [0.14, 0.05, 0.12], [-0.1, 0.12, 0.11], [0.03, -0.14, 0.1]]){ const g = ellipsoid(r, r * 0.7, r, 7, 5); g.translate(x, r * 0.4, z); parts.push(g.toNonIndexed()); }
    const m = new THREE.InstancedMesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ color: 0x5a4228, roughness: 0.8 }), 400);
    m.count = 0; m.castShadow = false; m.receiveShadow = true; this.scene.add(m);
    return m;
  }
  refreshDung(){
    const M = new THREE.Matrix4(); let n = 0;
    for (const list of Object.values(this.dung)) for (const d of list){ if (n >= 400) break; M.makeTranslation(d.x, d.y, d.z); this.dungMesh.setMatrixAt(n++, M); }
    this.dungMesh.count = n; this.dungMesh.instanceMatrix.needsUpdate = true;
  }
  dropDung(a, p){
    const list = this.dung[a.zone]; if (list.length >= 30) return;
    if (Math.abs(this.world.polar(p.x, p.z).lat) < 4) return;
    p.y = this.world.height(p.x, p.z); list.push(p); this.refreshDung();
  }

  // ---------- food ----------
  food(k){ return this.foodLevels[k] ?? 0; }
  foodCap(){ return this.state.upgrades.feeders ? 2 : 1; }

  // ---------- money ----------
  get money(){ return this.state.money; }
  spend(n, why){ if (this.state.money < n) return false; this.state.money -= n; this.state.today.costs += n; this.emit('money', -n); return true; }
  charge(n){ this.state.money -= n; this.state.today.costs += n; }     // (can go into debt: bills still have to be paid)
  earn(n){ this.state.money += n; this.state.earned += n; this.state.today.income += n; this.emit('money', n); }

  // how attractive the park is, and so how many people come
  appeal(){
    let A = 0;
    for (const a of this.animals){ if (!this.isOpen(ZONES[a.zone])) continue; A += SPECIES[a.kind].appeal * (a.data.sick ? 0.5 : 1); }
    return A;
  }
  fairTicket(){ return Math.round(8 + this.appeal() * 0.28); }
  clockText(){ const m = 9 * 60 + this.state.clock * 540, h = Math.floor(m / 60), mm = Math.floor(m % 60); return `${h > 12 ? h - 12 : h}:${String(mm).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`; }
  stars(){ return Math.round(this.state.rep * 2) / 2; }

  // ---------- jobs ----------
  hasJob(type, target){ return this.jobs.some((j) => j.type === type && j.target === target); }
  addJob(type, target, label, pos){
    const j = { id: jobId++, type, target, label, pos, assigned: null, progress: 0, created: this.t, ...JOBS[type] };
    this.jobs.push(j); this.addMarker(j);
    this.emit('job', j);
    return j;
  }
  jobPos(j, out = V()){
    if (j.type === 'vet' || j.type === 'wash') return j.target.centre(out);
    if (j.type === 'clean'){ const L = this.dung[j.target]; if (!L.length) return out.copy(this.world.feeders[j.target].pos); out.set(0, 0, 0); for (const d of L) out.add(d); out.divideScalar(L.length); out.y = this.world.height(out.x, out.z); return out; }
    if (j.type === 'feed') return out.copy(this.world.feeders[j.target].pos);
    if (j.type === 'repair') return out.copy(j.target.pos);
    if (j.type === 'service') return out.copy(this.world.depotPos);
    return out;
  }
  // where a staff jeep should stop to do a job
  jobStop(j){
    const W = this.world, p = this.jobPos(j);
    if (j.type === 'repair'){ const R = W.road(j.target.s - 9, -LANE); return R.p; }
    if (j.type === 'service') return W.road(W.depotS, 9).p;
    // a few metres short of it, on the side nearest the road
    const pol = W.polar(p.x, p.z), back = W.at(pol.phi, pol.lat - Math.sign(pol.lat) * 5);
    return back;
  }
  scanJobs(){
    const S = this.state, W = this.world;
    for (const a of this.animals){
      if (a.data.sick && !this.hasJob('vet', a)) this.addJob('vet', a, `${a.name} the ${SPECIES[a.kind].name.toLowerCase()} is poorly`);
      if (a.data.dirt > 80 && !a.data.sick && !this.hasJob('wash', a)) this.addJob('wash', a, `${a.name} the ${SPECIES[a.kind].name.toLowerCase()} needs a wash`);
    }
    for (const Z of ZONES){
      if (Z.lodge || !this.isOpen(Z)) continue;
      if (this.dung[Z.k].length >= 9 && !this.hasJob('clean', Z.k)) this.addJob('clean', Z.k, `${Z.name} needs cleaning`);
      if (this.food(Z.k) < 0.25 * this.foodCap() && !this.hasJob('feed', Z.k)) this.addJob('feed', Z.k, `${Z.name} feeder is ${this.food(Z.k) < 0.02 ? 'empty' : 'nearly empty'}`);
    }
    for (const t of this.trucks){
      if (t.broken && !this.hasJob('repair', t)) this.addJob('repair', t, `Truck ${t.number} has broken down`);
      if (t.data.condition < 40 && !t.broken && !t.serviceNext && t.state !== 'depot' && t.state !== 'toDepot' && !this.hasJob('service', t)){ t.serviceNext = true; this.addJob('service', t, `Truck ${t.number} needs a service`); }
    }
  }
  // give each idle staff member the oldest job they can do
  assignJobs(){
    for (const s of this.staff){
      if (s.job || !(s.state === 'idle' || s.state === 'returning')) continue;
      const j = this.jobs.find((x) => !x.assigned && x.staff === s.kind && this.jobReady(x));
      if (!j) continue;
      this.sendStaff(s, j);
    }
  }
  jobReady(j){ return j.type !== 'service' || j.target.state === 'depot'; }
  sendStaff(s, j){
    j.assigned = s; s.job = j; s.state = 'driving';
    if (j.type === 'vet' || j.type === 'wash') j.target.held = true;
    s.jeep.goTo(this.jobStop(j), () => { if (s.job === j){ s.state = 'working'; j.progress = 0; } });
  }
  // finish a job (by staff, or by you)
  finishJob(j, byYou){
    const S = this.state;
    const cost = j.cost || 0;
    if (cost) this.charge(cost);
    if (j.type === 'vet'){ const a = j.target; a.data.sick = false; a.data.health = Math.max(a.data.health, 70); a.held = false; a.tint(); this.say(`${a.name} the ${SPECIES[a.kind].name.toLowerCase()} is feeling better!`, 'good'); }
    if (j.type === 'wash'){ const a = j.target; a.data.dirt = 0; a.held = false; a.tint(); }
    if (j.type === 'clean'){ this.dung[j.target] = []; this.refreshDung(); }
    if (j.type === 'feed'){ this.foodLevels[j.target] = this.foodCap(); }
    if (j.type === 'repair'){ const t = j.target; t.broken = null; t.data.condition = Math.min(100, t.data.condition + 12); this.say(`Truck ${t.number} is fixed and on its way again.`, 'good'); }
    if (j.type === 'service'){ const t = j.target; t.data.condition = 100; t.broken = null; t.leaveDepot(); this.say(`Truck ${t.number} has been serviced: good as new!`, 'good'); }
    if (byYou){ S.tips.didJob = true; this.emit('didJob', j); }
    this.removeJob(j);
  }
  removeJob(j){
    const i = this.jobs.indexOf(j); if (i >= 0) this.jobs.splice(i, 1);
    this.removeMarker(j);
    if (j.assigned){ const s = j.assigned; s.job = null; s.state = 'returning'; s.jeep.home(() => { if (!s.job) s.state = 'idle'; }); }
    this.emit('jobs');
  }

  // ---------- visitors ----------
  queueSpot(i){ const W = this.world; const along = 13 - (i % 13) * 2, row = Math.floor(i / 13); const R = W.road(W.stationS + along, 7.0 + row * 0.9); R.p.y = W.lodgeH + 0.9; return R.p; }
  spawnVisitors(dt){
    const S = this.state, W = this.world;
    const A = this.appeal(), price = S.ticket, fair = this.fairTicket();
    const priceK = clamp(1.6 - 0.6 * price / fair, 0.12, 1.35);
    const rate = 0.022 * (1 + A / 8) * (0.4 + S.rep / 4.2) * priceK;     // people per second
    this.rate = rate;
    this.spawnT -= dt * rate;
    if (this.spawnT > 0) return;
    const group = 1 + Math.floor(Math.random() * 4);
    this.spawnT = group;
    if (this.queue.length + group > 40){ if (!S.tips.queue || this.t - S.tips.queue > 90){ S.tips.queue = this.t; this.say('The queue for the trucks is very long! Buy another truck to carry more people.', 'bad'); } return; }
    const spot = W.carSpots[Math.floor(Math.random() * Math.min(W.carSpots.length, Math.max(4, W.cars.count)))].p;
    const look = randomLook();
    for (let i = 0; i < group; i++){
      const lk = i ? randomLook() : look;
      const v = { shirt: lk.shirt, skin: lk.skin, joined: this.t, state: 'walking' };
      const start = spot.clone().add(V((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2));
      const p = this.crowd.add({ pos: start, path: [W.lodgePoint(0, 44).p, W.lodgePoint(0, 10).p], shirt: v.shirt, skin: v.skin, speed: 1.2 + Math.random() * 0.4, data: v });
      p.y = W.lodgeH; v.walker = p;
      p.onDone = () => { this.queue.push(v); v.state = 'queue'; this.layoutQueue(); };
    }
    // more cars in the car park on a busy day
    W.setCars(Math.min(W.carSpots.length, 6 + this.queue.length * 0.6 + this.trucks.reduce((n, t) => n + t.riders.filter(Boolean).length, 0) * 0.35));
  }
  layoutQueue(){
    this.queue.forEach((v, i) => { const p = this.queueSpot(i); const w = v.walker; if (!w) return; w.path = [p]; w.y = this.world.lodgeH + 0.9; });
  }
  // a truck at the station: fill its seats from the queue, then it goes
  boardTruck(t){
    const S = this.state;
    while (t.riders.filter(Boolean).length < SEATS && this.queue.length){
      const free = this.firstFreeSeat(t); if (free < 0) break;
      const v = this.queue.shift();
      this.crowd.remove(v.walker); v.walker = null; v.state = 'riding'; v.wait = this.t - v.joined;
      t.riders[free] = v;
      this.earn(S.ticket + (S.upgrades.cafe ? 4 : 0));
      S.visitors++; S.today.visitors++;
    }
    t.ridersMesh.refresh(t.player ? t.playerSeat : -1);
    this.layoutQueue();
  }
  firstFreeSeat(t){ for (let i = 0; i < SEATS; i++){ if (!t.riders[i] && !(t.player && t.playerSeat === i)) return i; } return -1; }
  // the riders get off and say what they thought
  unloadTruck(t, atDepot){
    const W = this.world, S = this.state;
    const riders = t.riders.filter(Boolean);
    if (riders.length){
      // how good was it? the animals they saw, poorly ones, dirty enclosures, breakdowns, the wait
      let seen = 0; const kinds = [];
      for (const k of t.seen){ seen += SPECIES[k].appeal; kinds.push(k); }
      const zonesDirty = Object.values(this.dung).filter((l) => l.length >= 9).length;
      let happy = 30 + seen * 3.2 - t.sickSeen.size * 6 - zonesDirty * 3 - t.breaks * 22;
      happy -= Math.max(0, S.ticket - this.fairTicket()) * 1.2;
      const avgWait = riders.reduce((a, v) => a + (v.wait || 0), 0) / riders.length;
      if (avgWait > 150) happy -= 10;
      happy = clamp(happy, 0, 100);
      const stars = happy / 20;
      S.rep = clamp(lerp(S.rep, stars, Math.min(0.5, riders.length * 0.012)), 0.5, 5);
      this.emit('tour', { truck: t, happy, kinds, riders: riders.length });
      this.comment(t, happy, kinds, avgWait);
      // they walk back to their cars
      const from = atDepot ? W.road(W.depotS, 10).p : W.lodgePoint(0, 9).p;
      riders.forEach((v, i) => {
        const spot = W.carSpots[Math.floor(Math.random() * Math.min(W.carSpots.length, Math.max(4, W.cars.count)))].p;
        const p = this.crowd.add({ pos: from.clone().add(V((i % 4) * 0.6 - 1, 0, Math.floor(i / 4) * 0.6)), path: [W.lodgePoint(0, 12).p, W.lodgePoint(0, 46).p, spot], shirt: v.shirt, skin: v.skin, speed: 1.3 });
        p.y = W.lodgeH;
        p.onDone = (pp) => this.crowd.remove(pp);
      });
    }
    t.riders = [];
    t.seen = new Set(); t.sickSeen = new Set(); t.breaks = 0;
    t.ridersMesh.refresh(t.player ? t.playerSeat : -1);
  }
  comment(t, happy, kinds, wait){
    if (Math.random() < 0.55) return;
    const fav = kinds.slice().sort((a, b) => SPECIES[b].appeal - SPECIES[a].appeal)[0];
    const st = '⭐'.repeat(Math.max(1, Math.round(happy / 20)));
    let text;
    if (t.breaks) text = `Truck ${t.number}'s riders: “Our truck broke down! Not great.” ${st}`;
    else if (t.sickSeen.size) text = `Truck ${t.number}'s riders: “Some of the animals looked poorly...” ${st}`;
    else if (wait > 150) text = `Truck ${t.number}'s riders: “We queued for ages!” ${st}`;
    else if (happy > 75 && fav) text = `Truck ${t.number}'s riders loved the ${SPECIES[fav].plural.toLowerCase()}! ${st}`;
    else if (happy < 35) text = `Truck ${t.number}'s riders: “There wasn't much to see.” ${st}`;
    else if (fav) text = `Truck ${t.number}'s riders enjoyed the ${SPECIES[fav].plural.toLowerCase()}. ${st}`;
    if (text) this.say(text, happy > 60 ? 'good' : happy < 35 ? 'bad' : '');
  }

  // ---------- the trucks' world ----------
  truckCtx(){
    if (this._tc) return this._tc;
    const W = this.world;
    const self = this;
    this._tc = {
      canDepart(t){
        if (self.trucks.some((o) => o !== t && o.state === 'touring' && ((o.s - t.s + W.L) % W.L) < 40)) return false;
        if (t.player) return true;
        const n = t.riders.filter(Boolean).length;
        t.waited = (t.waited || 0) + 1;
        return n >= SEATS || (n >= 6 && self.queue.length === 0) || (n > 0 && t.waited > 14);
      },
      onDepart(t){ t.waited = 0; },
      onArrive(t, depot){ self.unloadTruck(t, depot); },
      atDepot(t){ /* a mechanic comes to service it */ },
      gapAhead(t){
        let best = 1e9;
        for (const o of self.trucks){ if (o === t || !(o.state === 'touring' || o.state === 'station')) continue; const d = ((o.s - t.s) % W.L + W.L) % W.L; if (d > 0.01 && d < best) best = d; }
        return best;
      },
      animalsNear(p, f){
        let near = false, blocking = false;
        for (const a of self.animals){
          const dx = a.pos.x - p.x, dz = a.pos.z - p.z, d2 = dx * dx + dz * dz;
          if (d2 > 625) continue;
          near = true;
          const ahead = dx * f.x + dz * f.z, side = Math.abs(dx * f.z - dz * f.x);
          if (ahead > 2 && ahead < 14 && side < 3.2){ blocking = true; if (!a.target && !a.held){ a.state = 'idle'; a.lie = Math.min(a.lie, 0.5); if (a.wait > 3) a.wait = 3; } }   // (it soon wanders off the road)
        }
        return { near, blocking };
      },
      breakDown(t){ self.breakDown(t); },
      get wearMul(){ return self.state.upgrades.roads ? 0.6 : 1; },
      get breakMul(){ return self.state.upgrades.roads ? 0.7 : 1; },
    };
    return this._tc;
  }
  breakDown(t){
    const kinds = Object.keys(BREAKDOWNS), kind = kinds[Math.floor(Math.random() * kinds.length)];
    t.broken = { kind, t: this.t }; t.breaks++;
    const Z = ZONES[this.world.polar(t.pos.x, t.pos.z).zone];
    this.say(`Truck ${t.number} has broken down in ${Z.name} with ${BREAKDOWNS[kind]}! Send a mechanic.`, 'bad');
    this.emit('breakdown', t);
  }

  // ---------- every frame ----------
  update(dt, ctx){
    const S = this.state, W = this.world;
    if (!S) return;
    this.t += dt;
    // the clock
    S.clock += dt / DAY_SECONDS;
    if (S.clock >= 1){ S.clock -= 1; this.endDay(); }
    this.spawnVisitors(dt);
    // trucks
    const tc = this.truckCtx();
    for (const t of this.trucks){
      const was = t.state;
      t.update(dt, tc);
      if (t.state === 'station' && t.wait < 5 && this.queue.length && this.firstFreeSeat(t) >= 0) this.boardTruck(t);
      if (t.broken && t.broken.kind === 'engine' && Math.random() < dt * 6) this.puffs.emit(t.pos.clone().addScaledVector(t.fwd, 3.3).setY(t.pos.y + 2.4), V((Math.random() - 0.5) * 0.4, 1.2, (Math.random() - 0.5) * 0.4), 2.5, 0.5, 0x9a9a9a);
    }
    // what the riders can see (checked a couple of times a second)
    this.tick += dt;
    const scan = this.tick > 0.5; if (scan) this.tick = 0;
    if (scan) for (const t of this.trucks){
      if (t.state !== 'touring') continue;
      for (const a of this.animals){ if (a.pos.distanceToSquared(t.pos) < 45 * 45){ t.seen.add(a.kind); if (a.data.sick) t.sickSeen.add(a.data.id); } }
    }
    // animals
    const vehicles = ctx.vehicles;
    const actx = { vehicles, cam: ctx.cam, onDung: (a, p) => this.dropDung(a, p), feeder: null };
    for (const a of this.animals){
      const f = this.feederObj(a.zone);
      actx.feeder = f;
      if (a.held){ a.target = null; a.wait = 2; if (!a.data.sick) a.state = 'idle'; }
      a.update(dt, actx);
      this.foodLevels[a.zone] = f.food;
      if (!a.data.sick && Math.random() < dt * 0.00016 * (1 + a.data.dirt / 50 + a.data.hunger / 40 + this.dung[a.zone].length / 12) * (S.upgrades.clinic ? 0.5 : 1)){
        a.data.sick = true; a.tint();
        this.say(`${a.name} the ${SPECIES[a.kind].name.toLowerCase()} in ${ZONES[a.zone].name} has fallen ill!`, 'bad');
      }
      if (scan) a.tint();
    }
    for (const f of W.feeders) if (f) f.set(this.food(f.k) / this.foodCap());
    // jobs and staff
    if (scan){ this.scanJobs(); this.assignJobs(); }
    const fast = S.upgrades.radios ? 1.4 : 1;
    for (const s of this.staff){
      s.jeep.update(dt * (s.state === 'working' ? 1 : fast));
      if (s.state === 'working' && s.job){
        const j = s.job;
        j.progress += dt / j.work;
        this.workEffects(j, s.jeep.pos, dt);
        if (j.progress >= 1) this.finishJob(j, false);
      }
      // a job that vanished (fixed by you) sends them home
      if (s.job && !this.jobs.includes(s.job)){ s.job = null; s.state = 'returning'; s.jeep.home(() => { if (!s.job) s.state = 'idle'; }); }
    }
    // job markers float over where they are
    for (const j of this.jobs){ if (!j.marker) continue; const p = this.jobPos(j); j.marker.position.set(p.x, p.y + 3.2, p.z); const d = ctx.cam ? ctx.cam.distanceTo(p) : 50; j.marker.scale.setScalar(clamp(d * 0.05, 2, 26) * (ctx.markerScale || 1)); j.marker.scale.y *= 1.25; }
    this.puffs.update(dt);
    this.crowd.update(dt, W);
  }
  feederObj(k){ this._f ||= {}; const f = this._f[k] ||= { pos: this.world.feeders[k].pos, food: 0 }; f.food = this.food(k); return f; }
  // splashes, sparks and so on while a job is being done
  workEffects(j, from, dt){
    if (Math.random() > dt * 14) return;
    const to = this.jobPos(j);
    if (j.type === 'wash'){ const d = to.clone().sub(from).setY(0).normalize(); this.puffs.emit(from.clone().setY(from.y + 1.6), d.multiplyScalar(5).setY(1.5), 0.8, 0.18, 0x9ad0ff); }
    else if (j.type === 'repair' || j.type === 'service'){ this.puffs.emit(to.clone().setY(to.y + 0.8).add(V((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2)), V((Math.random() - 0.5) * 2, 2, (Math.random() - 0.5) * 2), 0.4, 0.07, 0xffd040); }
    else if (j.type === 'clean'){ this.puffs.emit(to.clone().add(V((Math.random() - 0.5) * 6, 0.3, (Math.random() - 0.5) * 6)), V(0, 0.8, 0), 1.2, 0.3, 0xb89a70); }
    else if (j.type === 'vet'){ this.puffs.emit(to.clone().add(V((Math.random() - 0.5), 1.2, (Math.random() - 0.5))), V(0, 0.8, 0), 1.2, 0.12, 0x80ff90); }
    else if (j.type === 'feed'){ this.puffs.emit(to.clone().add(V((Math.random() - 0.5) * 2, 1.5, (Math.random() - 0.5) * 2)), V(0, -0.5, 0), 1, 0.15, 0xe8d890); }
  }
  // wages and upkeep at the end of each day, and a report
  endDay(){
    const S = this.state;
    let wages = 0; for (const s of this.staff) wages += STAFF[s.kind].wage;
    const upkeep = ZONES.filter((Z) => !Z.lodge && this.isOpen(Z)).length * 30 + this.trucks.length * 25;
    this.charge(wages + upkeep);
    const T = S.today;
    const report = { day: S.day, visitors: T.visitors, income: T.income, costs: T.costs, profit: T.income - T.costs, rep: S.rep, wages, upkeep };
    S.days.push(report); while (S.days.length > 7) S.days.shift();
    S.day++; S.today = { visitors: 0, income: 0, costs: 0, sold: 0 };
    this.emit('day', report);
    this.save();
  }

  // ---------- buying things ----------
  openZone(Z){
    if (this.isOpen(Z)) return false;
    if (!this.spend(Z.price)) return false;
    this.state.open[Z.id] = true;
    this.foodLevels[Z.k] = this.foodCap();
    Z.species.forEach((kind, i) => { for (let n = 0; n < Z.start[i]; n++) this.addAnimal(kind, Z.k); });
    this.refreshZones(); this.save();
    return true;
  }
  buyAnimal(kind, k){
    const n = this.animals.filter((a) => a.zone === k).length;
    if (n >= MAX_PER_ZONE) return false;
    if (!this.spend(SPECIES[kind].price)) return false;
    const a = this.addAnimal(kind, k);
    this.refreshZones(); this.save();
    return a;
  }
  buyTruck(){
    if (this.trucks.length >= MAX_TRUCKS || !this.spend(TRUCK_PRICE)) return false;
    const n = Math.max(0, ...this.trucks.map((t) => t.data.number)) + 1;
    const t = this.addTruck({ number: n, colour: (n - 1) % TRUCK_COLOURS.length, condition: 100 }, 1);
    // it starts just behind the station, waiting its turn
    t.s = (this.world.stationS - 20 + this.world.L) % this.world.L; t.state = 'touring'; t.lapS = 150; t.place(0);
    this.save();
    return t;
  }
  sellTruck(t){
    if (this.trucks.length <= 1 || t.riders.filter(Boolean).length || t.player) return false;
    for (const j of [...this.jobs]) if (j.target === t) this.removeJob(j);
    this.scene.remove(t.root); this.trucks.splice(this.trucks.indexOf(t), 1);
    this.earn(Math.round(TRUCK_PRICE * 0.4 * t.data.condition / 100));
    this.save(); return true;
  }
  hire(kind){
    if (this.staff.length >= MAX_STAFF) return false;
    this.state.staff[kind] = (this.state.staff[kind] || 0) + 1;
    this.addStaff(kind); this.save(); return true;
  }
  fire(kind){
    const list = this.staff.filter((s) => s.kind === kind); if (!list.length) return false;
    const s = list.find((x) => !x.job) || list[list.length - 1];
    if (s.job){ const j = s.job; j.assigned = null; s.job = null; if (j.target && j.target.held !== undefined) j.target.held = false; }
    this.scene.remove(s.jeep.root); this.staff.splice(this.staff.indexOf(s), 1);
    this.state.staff[kind]--;
    this.staff.forEach((x, i) => { if (x.state === 'idle') x.jeep.park(this.bay(i)); else x.jeep.bay = this.bay(i); });
    this.save(); return true;
  }
  buyUpgrade(k){
    if (this.state.upgrades[k] || !this.spend(UPGRADES[k].price)) return false;
    this.state.upgrades[k] = true;
    if (k === 'feeders') for (const Z of ZONES) if (!Z.lodge && this.isOpen(Z)) this.foodLevels[Z.k] = Math.min(2, this.food(Z.k) * 2);
    this.save(); return true;
  }
  setTicket(n){ this.state.ticket = clamp(Math.round(n), 2, 120); this.save(); }
  // send a truck for a service at the end of its tour
  requestService(t){ if (t.state === 'depot' || t.state === 'toDepot') return; t.serviceNext = true; if (!this.hasJob('service', t)) this.addJob('service', t, `Truck ${t.number} needs a service`); }
  // send someone to a job now (or it waits until someone's free)
  hurry(j){ if (j.assigned) return true; const s = this.staff.find((x) => x.kind === j.staff && !x.job && x.state !== 'working'); if (!s || !this.jobReady(j)) return false; s.jeep.path = []; this.sendStaff(s, j); return true; }
}
void rng;
