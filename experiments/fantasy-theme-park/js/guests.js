// Guests (and staff), simulated in game time.
//
// Getting about: guests walk on paths (and car parks). For each place they go to (a ride's entrance, a
// stall, a building's door, the gate, a car park...) a flow field is worked out once over the path cells
// (breadth first, from the target cells outwards) and kept until the paths change; a guest steps to the
// next cell nearer, to a spot of its own a little off the cell's middle, so they don't walk in single file.
//
// Each guest has needs (hunger, thirst, the toilet, energy, nausea), money, a taste for thrills, and a
// happiness that everything nudges. Every so often they choose what to do next: eat, drink, find a toilet,
// sit down, ride something they'd like (not too scary, not too dear, not too long a queue), or go home.
// They think about what happens to them ("Wyrmfire Run was amazing!", "I can't find a toilet").
//
// Arriving: cars come off the highway, along the park's road to a free bay in a car park, and the people
// walk to the gate (with no car park, a bus drops them at the gate). At closing time they go back to their
// cars, which drive away.
import * as THREE from 'three';
import { N, CELL, HALF, ROAD, QUEUE, cellX } from './park.js';
import { CATALOG, model } from './models.js';
import { GOODS } from './shops.js';
import { lotBays } from './structures.js';
import { carGeometry } from './highway.js';
import { stationCells, flatRadius, SPEEDS } from './rides.js';
import { DRAWN } from './trackrides.js';
import { groundCells, edges, styleOf, toWorld } from './buildings.js';
import { mat } from './materials.js';
import { resolveMat } from './models.js';
import { rng, clamp, angleDiff } from './util.js';
import { fmt } from './economy.js';

const NAMES = ['Ada', 'Ben', 'Cara', 'Dev', 'Ella', 'Finn', 'Gwen', 'Hugo', 'Iris', 'Jack', 'Kira', 'Leo', 'Maya', 'Noah', 'Olive', 'Pete', 'Quinn', 'Rosa', 'Sam', 'Tara', 'Uma', 'Vic', 'Wren', 'Xavi', 'Yara', 'Zack', 'Amir', 'Bea', 'Cole', 'Dina', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivo', 'Jade', 'Kai', 'Lena', 'Milo', 'Nia'];
const FAR = 65535;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const OPEN_H = 9, CLOSE_H = 21;

export class Guests {
  constructor(app){
    this.app = app; this.park = app.park; this.scene = app.scene;
    this.list = []; this.cars = []; this.fields = new Map(); this.places = null; this.mask = null; this.dirty = true;
    this.r = rng((Math.random() * 1e9) | 0); this.nextId = 1; this.spawnT = 2; this.minuteT = 0; this.rateT = 0;
    this.cap = app.touch ? 350 : 700;
    this.stats = { arrived: 0, left: 0 };
    this.thoughtCounts = new Map();
    app.rides.guestsOn = true;
    app.rides.onUnload = (it) => this.unloadFlat(it);
    // cars: one instanced mesh per part of the car
    this.carMeshes = carGeometry().map(({ geo, key }) => { const im = new THREE.InstancedMesh(geo, key === 'body' ? mat('carpaint', { c: 0xffffff, r: 0.3, mt: 0.6 }) : resolveMat(key), 400); im.count = 0; im.castShadow = true; im.frustumCulled = false; im.name = 'parkedCars'; this.scene.add(im); return im; });
    // litter and worse, lying on the paths
    const lg = new THREE.BoxGeometry(0.22, 0.03, 0.16);
    this.litterMesh = new THREE.InstancedMesh(lg, mat('litter', { c: 0xffffff, r: 0.8 }), 500); this.litterMesh.count = 0; this.litterMesh.frustumCulled = false; this.scene.add(this.litterMesh);
    const vg = new THREE.CylinderGeometry(0.45, 0.5, 0.03, 12);
    this.vomitMesh = new THREE.InstancedMesh(vg, mat('vomit', { c: 0x8a8a3a, r: 0.4 }), 200); this.vomitMesh.count = 0; this.vomitMesh.frustumCulled = false; this.scene.add(this.vomitMesh);
    this.litterDirty = true;
    this.staff = [];
    this.syncStaff();
    // coasters: board when the train is in the station, get off when it arrives
    for (const it of app.rides.items.values()) this.hookTrain(it);
  }
  dispose(){
    for (const m of [...this.carMeshes, this.litterMesh, this.vomitMesh]){ this.scene.remove(m); m.dispose(); }
    this.app.rides.onUnload = null; this.app.rides.guestsOn = false;
    for (const g of [...this.list, ...this.staff]) if (g.avatar){ this.app.people.give(g.avatar); g.avatar = null; }
  }
  get E(){ return this.app.economy; }
  // the park changed: paths, objects: recompute where things are (and the fields) when next needed
  changed(ch){
    if (ch.path || ch.water || ch.objects.size) this.dirty = true;
    for (const id of ch.objects){ const it = this.app.rides.get(id); if (it && it.train && !it.hooked) this.hookTrain(it); }
  }
  hookTrain(it){
    if (!it.train || it.hooked) return; it.hooked = true;
    it.train.on('arrive', () => this.unloadTrain(it));
  }

  // --- where everything is ---------------------------------------------------------------------------------
  rebuild(){
    this.dirty = false; this.fields.clear();
    const P = this.park, S = P.s, mask = new Uint8Array(N * N);
    for (let k = 0; k < N * N; k++) if (S.path[k]) mask[k] = S.path[k] === ROAD ? 3 : 1;
    const lots = S.objects.filter((o) => o.type === 'lot');
    for (const o of lots) for (let x = o.x - o.w + 1; x < o.x + o.w; x += 2) for (let z = o.z - o.d + 1; z < o.z + o.d; z += 2){ const k = P.cellIndex(x, z); if (k >= 0 && !mask[k]) mask[k] = 2; }
    this.mask = mask;
    const near = (x, z, r, pred = (m) => m === 1) => { const out = []; for (let dx = -r; dx <= r; dx += 2) for (let dz = -r; dz <= r; dz += 2){ if (dx * dx + dz * dz > r * r + 2) continue; const k = P.cellIndex(x + dx, z + dz); if (k >= 0 && pred(mask[k])) out.push(k); } return [...new Set(out)]; };
    const places = { rides: new Map(), food: [], toilets: [], benches: [], bins: [], firstaid: [], gate: null, lots: [] };
    for (const it of this.app.rides.items.values()){
      const o = it.o; let cells = [];
      if (o.type === 'coaster') for (const [x, z] of stationCells(o)) cells.push(...near(x, z, 3));
      else if (it.group.userData.station && DRAWN[o.kind]){ const st = it.group.userData.station; cells.push(...near(st.x, st.z, 6)); }
      else { const R = flatRadius(o); for (let a = 0; a < 24; a++){ const an = a / 24 * Math.PI * 2; cells.push(...near(o.x + Math.cos(an) * (R + 1.5), o.z + Math.sin(an) * (R + 1.5), 2)); } }
      cells = [...new Set(cells)];
      if (cells.length) places.rides.set(o.id, { key: 'ride:' + o.id, cells, it });
    }
    for (const o of S.objects){
      if (o.type === 'stall'){ const cells = near(o.x, o.z, 4); if (cells.length) places.food.push({ key: 'stall:' + o.id, cells, o, x: o.x, z: o.z, stall: true }); }
      else if (o.type === 'building' && o.use){
        // outside its door (the first door, arch, shopfront or opening)
        const e = edges({ floors: [o.floors[0]] }).find((q) => ['door', 'shop', 'arch', 'open'].includes(styleOf(o, q.i, q.j, 0, q.d)));
        if (!e) continue;
        const D = [[0, -1], [1, 0], [0, 1], [-1, 0]][e.d], [x, z] = toWorld(o, (e.a[0] + e.b[0]) / 2 + D[0] * 1.6, (e.a[1] + e.b[1]) / 2 + D[1] * 1.6);
        const cells = near(x, z, 3); if (!cells.length) continue;
        const pl = { key: 'bld:' + o.id, cells, o, x, z, use: o.use };
        if (o.use === 'toilets') places.toilets.push(pl); else if (o.use === 'firstaid') places.firstaid.push(pl); else places.food.push(pl);
      } else if (CATALOG[o.type] && (model(o.type).seat || model(o.type).seats)){ const cells = near(o.x, o.z, 2); if (cells.length) places.benches.push({ key: 'bench:' + o.id, cells, o, x: o.x, z: o.z, used: 0 }); }
      else if (o.type === 'bin') places.bins.push({ o, x: o.x, z: o.z, fill: 0 });
      else if (o.type === 'gate'){
        const c = Math.cos(o.r || 0), s = Math.sin(o.r || 0), inside = [o.x - 4 * s, o.z - 4 * c], outside = [o.x + 6 * s, o.z + 6 * c];
        const ci = near(inside[0], inside[1], 3), co = near(outside[0], outside[1], 3);
        places.gate = { o, inside, outside, inKey: 'gate:in', outKey: 'gate:out', inCells: ci, outCells: co };
      } else if (o.type === 'lot') places.lots.push({ o, bays: lotBays(o).map((b) => ({ ...b, car: null })), key: 'lot:' + o.id, cells: near(o.x, o.z, Math.max(o.w, o.d) * 2, (m) => m === 2) });
    }
    // which car parks cars can reach (by road from the highway, at the south edge of the map)
    const roadEntry = []; for (let i = 0; i < N; i++) for (let j = N - 6; j < N; j++) if (mask[j * N + i] === 3) roadEntry.push(j * N + i);
    places.roadEntry = roadEntry;
    for (const L of places.lots){ const f = this.bfs(L.cells, (m) => m === 2 || m === 3); L.reachable = roadEntry.some((k) => f[k] < FAR); L.carField = f;
      // and whether people can walk from it to the gate
      L.walk = places.gate && places.gate.outCells.length ? this.field('gate:out', places.gate.outCells)[L.cells[0]] < FAR : false; }
    this.places = places;
    this.litterDirty = true;
  }
  // a flow field to these cells: the number of steps from every walkable cell (FAR where it can't get to)
  bfs(targets, ok = (m) => m === 1 || m === 2){
    const d = new Uint16Array(N * N).fill(FAR), q = new Int32Array(N * N), M = this.mask; let h = 0, t = 0;
    for (const k of targets){ if (d[k] !== 0){ d[k] = 0; q[t++] = k; } }
    while (h < t){
      const k = q[h++], i = k % N, j = (k - i) / N, nd = d[k] + 1;
      for (const [di, dj] of DIRS){ const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue; const kk = jj * N + ii; if (d[kk] <= nd || !ok(M[kk])) continue; d[kk] = nd; q[t++] = kk; }
    }
    return d;
  }
  field(key, cells){ let f = this.fields.get(key); if (!f){ f = this.bfs(cells); this.fields.set(key, f); } return f; }

  // --- the people ---------------------------------------------------------------------------------------
  makeGuest(x, z, extra = {}){
    const R = this.r;
    const g = { id: this.nextId++, name: NAMES[Math.floor(R() * NAMES.length)], look: Math.floor(R() * 18), x, z, y: this.park.floorAt(x, z), yaw: 0, speed: 0, phase: R() * 6.28,
      ox: (R() - 0.5) * 1.1, oz: (R() - 0.5) * 1.1, walk: 1.15 + R() * 0.35, money: Math.round(40 + R() * 90), spent: 0,
      hunger: 0.1 + R() * 0.3, thirst: 0.1 + R() * 0.3, toilet: R() * 0.3, energy: 0.8 + R() * 0.2, nausea: 0, happy: 0.7, thrill: R() * 8 + 1,
      state: 'arriving', goal: null, t: 0, rides: 0, ridden: new Map(), thoughts: [], inPark: false, hidden: false, litter: 0, ...extra };
    this.list.push(g);
    return g;
  }
  think(g, text, kind = ''){
    if (g.thoughts.length && g.thoughts[0].text === text) return;
    g.thoughts.unshift({ text, kind, t: this.park.s.time }); if (g.thoughts.length > 6) g.thoughts.pop();
    this.thoughtCounts.set(text, (this.thoughtCounts.get(text) || 0) + 1);
  }
  // head for a place
  go(g, place, purpose){
    const f = this.field(place.key, place.cells), k = this.park.cellIndex(g.x, g.z);
    if (k < 0 || f[k] >= FAR) return false;
    g.goal = { place, purpose, field: f }; g.state = 'walking'; return true;
  }
  // the next thing to do
  decide(g){
    const P = this.places, S = this.park.s, h = S.time / 60, R = this.r;
    if (!P) return;
    const leave = h >= CLOSE_H - 0.5 || !S.parkOpen || g.energy < 0.12 || g.money < 3 || g.happy < 0.15;
    if (leave){ if (g.happy < 0.2) this.think(g, 'I\'m not enjoying this: I\'m going home.', 'bad'); else if (g.money < 3) this.think(g, 'I\'ve spent all my money.'); else if (g.energy < 0.15) this.think(g, 'I\'m worn out: time to go home.'); return this.goHome(g); }
    if (g.nausea > 0.75 && P.firstaid.length && this.go(g, this.nearest(g, P.firstaid), 'firstaid')) return;
    if (g.toilet > 0.7){ if (P.toilets.length && this.go(g, this.nearest(g, P.toilets), 'toilet')) return; this.think(g, 'I can\'t find a toilet!', 'bad'); g.happy -= 0.08; }
    const food = (want) => P.food.filter((pl) => this.sells(pl, want).length);
    if (g.hunger > 0.6){ const f = food('food'); if (f.length && this.go(g, this.nearest(g, f), 'eat')) return; this.think(g, 'I\'m hungry: is there anywhere to eat?', 'bad'); g.happy -= 0.05; }
    if (g.thirst > 0.6){ const f = food('drinks'); if (f.length && this.go(g, this.nearest(g, f), 'drink')) return; this.think(g, 'I\'m thirsty.', 'bad'); g.happy -= 0.04; }
    if (this.raining && !g.umbrella){ this.think(g, 'It\'s raining!', 'bad'); g.happy -= 0.01; const shops = P.food.filter((pl) => (pl.o.menu || []).some((m) => m.id === 'umbrella')); if (shops.length && R() < 0.6 && this.go(g, this.nearest(g, shops), 'umbrella')) return; }
    if (g.energy < 0.35 && P.benches.length && R() < 0.6 && this.go(g, this.nearest(g, P.benches), 'rest')) return;
    // a ride: the one they'd like best, all things considered
    let best = null, bs = -1e9;
    for (const pl of P.rides.values()){
      const o = pl.it.o; if (o.open === false || pl.it.broken) continue;
      const st = this.app.rides.stats(o); if (!st || !st.complete) continue;
      const times = g.ridden.get(o.id) || 0, price = o.price || 0;
      if (st.scary > g.thrill + 2.5) continue;
      const q = (pl.it.queue || []).length;
      // in the rain, open-air rides lose their charm (not the dark ride, the railway's covered carriages or glazed cabins)
      const wet = this.raining && !(o.kind === 'dark' || (o.kind === 'wheel' && o.cabin !== 'open')) ? 2.5 : 0;
      const score = st.fun * (1 - Math.abs(st.scary - g.thrill) / 14) - times * 2.5 - q * 0.04 - price * 0.15 - wet + R() * 2;
      if (score > bs){ bs = score; best = pl; }
    }
    if (best && R() < 0.85 && this.go(g, best, 'ride')) return;
    if (R() < 0.25){ const f = [...food('snacks'), ...food('gifts')]; if (f.length && this.go(g, f[Math.floor(R() * f.length)], R() < 0.5 ? 'snack' : 'shop')) return; }
    // otherwise, a stroll somewhere else on the paths
    this.wander(g);
  }
  sells(pl, want){
    const menu = pl.o.menu || [];
    return menu.filter((m) => GOODS[m.id] && (want === 'any' || GOODS[m.id].sells === want || (want === 'food' && GOODS[m.id].sells === 'snacks')));
  }
  nearest(g, list){ let b = null, bd = 1e9; for (const p of list){ const d = Math.hypot(p.x - g.x, p.z - g.z) + (p.used || 0) * 4; if (d < bd){ bd = d; b = p; } } return b; }
  wander(g){
    const M = this.mask, R = this.r;
    for (let k = 0; k < 20; k++){
      const i = Math.floor(R() * N), j = Math.floor(R() * N), kk = j * N + i;
      if (M[kk] !== 1) continue;
      if (this.go(g, { key: 'w:' + kk, cells: [kk], x: cellX(i), z: cellX(j) }, 'wander')){ this.fields.delete('w:' + kk); return; }
    }
    g.state = 'idle'; g.t = 4 + R() * 6;
  }
  goHome(g){
    const gate = this.places.gate;
    if (g.inPark && gate && gate.inCells.length && this.go(g, { key: gate.inKey, cells: gate.inCells }, 'exit')) return;
    g.state = 'gone';
  }

  // --- arrivals ------------------------------------------------------------------------------------------
  arrive(){
    const P = this.places, S = this.park.s, R = this.r;
    if (!P || !P.gate) return;
    const n = 1 + Math.floor(R() * 4);
    // by car, to a free bay in a car park the road reaches (and that has a path to the gate)
    const lots = P.lots.filter((L) => L.reachable && L.walk);
    for (const L of lots){
      const bay = L.bays.find((b) => !b.car); if (!bay) continue;
      const car = { x: 0, z: HALF + 14, yaw: 0, state: 'in', bay, lot: L, group: [], color: [0xf0f0f0, 0x202224, 0x9aa0a6, 0x8a1a1a, 0x1a3a7a, 0x2a4a3a, 0xc8c0b0, 0x4a4e54, 0xd0a020][Math.floor(R() * 9)], n, t: 0 };
      bay.car = car;
      const entry = P.roadEntry.reduce((b, k) => (L.carField[k] < (b ? L.carField[b] : FAR) ? k : b), null);
      if (entry === null){ bay.car = null; break; }
      car.cell = entry; car.x = cellX(entry % N); car.z = HALF + 10;
      this.cars.push(car);
      return;
    }
    // or by bus, at the gate
    if (P.gate.outCells.length){ for (let k = 0; k < n; k++){ const g = this.makeGuest(P.gate.outside[0] + (R() - 0.5) * 3, P.gate.outside[1] + R() * 2); this.go(g, { key: P.gate.outKey, cells: P.gate.outCells }, 'enter'); } this.stats.arrived += n; }
    void S;
  }
  // a car's people get out at its bay
  unpark(car){
    const P = this.places;
    for (let k = 0; k < car.n; k++){
      const g = this.makeGuest(car.bay.x + (this.r() - 0.5) * 2, car.bay.z + (this.r() - 0.5) * 2, { car });
      car.group.push(g);
      if (!this.go(g, { key: P.gate.outKey, cells: P.gate.outCells }, 'enter')) g.state = 'gone';
    }
    this.stats.arrived += car.n;
  }

  // --- rides: queues, boarding, getting off ---------------------------------------------------------------------
  queueSpots(pl){
    // the queue's cells, nearest the entrance first (each holds two people); then the entrance itself
    if (pl.spots && pl.spotsAt === this.fieldsVersion) return pl.spots;
    const S = this.park.s, f = this.field(pl.key, pl.cells), q = [];
    for (let k = 0; k < N * N; k++) if (S.pflags[k] & QUEUE && f[k] < 60) q.push(k);
    // no queue line: they line up along the path leading to the ride instead (not all in a heap)
    if (!q.length) for (let k = 0; k < N * N; k++) if (this.mask[k] === 1 && f[k] < 25) q.push(k);
    q.sort((a, b) => f[a] - f[b]);
    const spots = [];
    for (const k of q) for (const [ox, oz] of [[-0.45, -0.3], [0.45, 0.4]]) spots.push([cellX(k % N) + ox, cellX(Math.floor(k / N)) + oz]);
    pl.spots = spots; pl.spotsAt = this.fieldsVersion;
    return spots;
  }
  board(pl, room){
    const it = pl.it, Q = it.queue || [], o = it.o, out = [];
    while (Q.length && out.length < room){
      const g = Q.shift(); if (g.state !== 'queuing') continue;
      const price = o.price || 0;
      if (price > g.money){ this.think(g, `${o.name} is too expensive for me now.`, 'bad'); this.decideLater(g); continue; }
      g.money -= price; g.spent += price; this.E.earn('rides', price); it.income = (it.income || 0) + price;
      g.state = 'riding'; g.hidden = true; g.rideOn = o.id; out.push(g);
      it.ridersToday = (it.ridersToday || 0) + 1;
    }
    return out;
  }
  // the coaster's train is in the station: on with the next riders
  boardTrain(it, pl){
    const T = it.train; if (T.state !== 'loading' || it.loadedThis) return;
    it.loadedThis = true;
    const empty = T.emptySeats().filter((i) => T.seats[i] !== 'player'), riders = this.board(pl, empty.length);
    riders.forEach((g, n) => { const look = SEAT_LOOKS[g.look % SEAT_LOOKS.length]; T.seatRider(empty[n], { guest: g, look }); });
  }
  unloadTrain(it){
    it.loadedThis = false;
    const T = it.train, st = this.app.rides.stats(it.o);
    for (let i = 0; i < T.seats.length; i++){ const w = T.seats[i]; if (w && w.guest){ T.seatRider(i, null); this.afterRide(w.guest, it, st); } }
  }
  unloadFlat(it){
    const st = this.app.rides.stats(it.o);
    for (const g of it.riders) this.afterRide(g, it, st);
    it.riders = [];
    // and on with the next lot (the ride starts again in a moment)
    const pl = this.places && this.places.rides.get(it.o.id);
    if (pl && it.o.open !== false && !it.broken) it.riders = this.board(pl, it.capacity);
    // wear and tear: now and then it breaks down
    this.wear(it);
  }
  afterRide(g, it, st){
    const pl = this.places && this.places.rides.get(it.o.id);
    g.hidden = false; g.state = 'idle'; g.t = 1 + this.r() * 2; g.rideOn = null;
    g.rides++; g.ridden.set(it.o.id, (g.ridden.get(it.o.id) || 0) + 1);
    if (pl){ const k = pl.cells[Math.floor(this.r() * pl.cells.length)]; g.x = cellX(k % N) + g.ox * 0.5; g.z = cellX(Math.floor(k / N)) + g.oz * 0.5; g.y = this.park.floorAt(g.x, g.z); }
    if (!st) return;
    const liked = st.fun - Math.max(0, st.scary - g.thrill) * 0.8;
    g.happy = clamp(g.happy + liked * 0.04 - 0.02);
    g.nausea = clamp(g.nausea + st.queasy * 0.07);
    g.energy = clamp(g.energy - 0.03);
    this.think(g, liked > 6 ? `${it.o.name} was amazing!` : liked > 3.5 ? `${it.o.name} was fun.` : liked > 1 ? `${it.o.name} was all right.` : `${it.o.name} was too much for me.`, liked > 3.5 ? 'good' : liked > 1 ? '' : 'bad');
    if (g.nausea > 0.6 && this.r() < (g.nausea - 0.5) * 0.8){ this.dropLitter(g.x, g.z, 'vomit'); g.nausea *= 0.4; g.happy -= 0.1; this.think(g, 'I feel sick...', 'bad'); }
    if (it.track && it.track.complete) this.wear(it);
  }
  wear(it){
    it.reliability = (it.reliability ?? 1) - 0.004;
    if (!it.broken && this.r() < (1 - it.reliability) * 0.12){
      it.broken = true; it.brokenAt = this.park.s.time;
      for (const g of it.queue || []){ if (g.state === 'queuing'){ this.think(g, `${it.o.name} has broken down!`, 'bad'); g.happy -= 0.06; this.decideLater(g); } }
      it.queue = [];
      this.app.ui.toast(`${it.o.name} has broken down. ${this.park.s.staff.mechanic ? 'A mechanic is on the way.' : 'Hire a mechanic (Park panel), or tap it and Fix it.'}`, 'bad');
    }
  }
  fix(it){ it.broken = false; it.reliability = 0.97; }
  decideLater(g){ g.state = 'idle'; g.t = 0.5 + this.r(); g.goal = null; }

  // --- litter ---------------------------------------------------------------------------------------------
  dropLitter(x, z, kind = 'paper'){
    const L = this.park.s.litter; if (L.length > 480) return;
    if (kind !== 'vomit' && !this.park.pathAt(x, z)) return;
    L.push({ x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, kind, r: Math.floor(this.r() * 6) }); this.litterDirty = true;
  }
  drawLitter(){
    if (!this.litterDirty) return; this.litterDirty = false;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), cols = [0xf0f0e8, 0xd84a3a, 0x3a6ad8, 0xe8c040, 0xffffff, 0x7a5a3a];
    let n = 0, v = 0;
    for (const l of this.park.s.litter){
      const y = this.park.floorAt(l.x, l.z) + 0.02;
      if (l.kind === 'vomit'){ if (v < 200){ this.vomitMesh.setMatrixAt(v++, m.compose(new THREE.Vector3(l.x, y, l.z), q, new THREE.Vector3(1, 1, 1))); } continue; }
      if (n >= 500) continue;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), l.r); this.litterMesh.setMatrixAt(n, m.compose(new THREE.Vector3(l.x, y, l.z), q, new THREE.Vector3(1, 1, 1))); this.litterMesh.setColorAt(n, c.set(cols[l.r])); n++;
    }
    this.litterMesh.count = n; this.vomitMesh.count = v;
    this.litterMesh.instanceMatrix.needsUpdate = true; if (this.litterMesh.instanceColor) this.litterMesh.instanceColor.needsUpdate = true; this.vomitMesh.instanceMatrix.needsUpdate = true;
  }

  // --- staff ------------------------------------------------------------------------------------------------
  syncStaff(){
    const want = this.park.s.staff || { janitor: 0, mechanic: 0 };
    for (const role of ['janitor', 'mechanic']){
      const have = this.staff.filter((s) => s.staff === role);
      while (have.length < want[role]){ const gate = this.places && this.places.gate, at = gate ? gate.inside : [0, 200]; const s = this.makeGuest(at[0], at[1], { staff: role, inPark: true, state: 'idle', t: 1, walk: 1.3 }); this.list.splice(this.list.indexOf(s), 1); this.staff.push(s); have.push(s); }
      while (have.length > want[role]){ const s = have.pop(); this.staff.splice(this.staff.indexOf(s), 1); if (s.avatar){ this.app.people.give(s.avatar); s.avatar = null; } }
    }
  }
  staffDecide(s){
    const P = this.places; if (!P) return;
    if (s.staff === 'mechanic'){
      for (const pl of P.rides.values()) if (pl.it.broken && !pl.it.mechanic){ pl.it.mechanic = s; if (this.go(s, pl, 'fix')){ s.fixing = pl.it; return; } pl.it.mechanic = null; }
    } else {
      // the nearest litter (or a full bin)
      const L = this.park.s.litter; let best = null, bd = 30;
      for (const l of L){ if (l.taken) continue; const d = Math.hypot(l.x - s.x, l.z - s.z); if (d < bd){ bd = d; best = l; } }
      if (best){ const k = this.park.cellIndex(best.x, best.z); if (k >= 0 && this.mask[k]){ best.taken = true; s.sweeping = best; if (this.go(s, { key: 'l:' + k, cells: [k], x: best.x, z: best.z }, 'sweep')){ this.fields.delete('l:' + k); return; } best.taken = false; } }
    }
    this.wander(s);
  }

  // --- every frame (dt in game seconds) --------------------------------------------------------------------
  update(dt){
    if (this.dirty || !this.places) this.rebuild();
    this.raining = !!(this.app.show && this.app.show.wet > 0.5);
    this.fieldsVersion = this.fields.size;
    const S = this.park.s, h = S.time / 60;
    // a game minute: needs, money, arrivals, the rating
    this.minuteT += dt;
    while (this.minuteT >= 1){ this.minuteT -= 1; this.minute(); }
    // arrivals while the park is open
    const open = S.parkOpen && h >= OPEN_H && h < CLOSE_H - 1;
    this.spawnT -= dt;
    if (open && this.spawnT <= 0){
      const want = this.wanted();
      if (this.list.filter((g) => g.state !== 'gone').length < want) this.arrive();
      this.spawnT = 2 + this.r() * 4;
    }
    for (const g of this.list) this.step(g, dt);
    for (const s of this.staff) this.step(s, dt);
    // the rides: boarding coasters
    if (this.places) for (const pl of this.places.rides.values()){
      const it = pl.it;
      if (it.train && it.train.state === 'loading' && it.o.open !== false && !it.broken) this.boardTrain(it, pl);
      if (it.train && it.train.state !== 'loading') it.loadedThis = false;
      // a broken ride with a mechanic beside it gets mended
      if (it.broken && it.mechanic && it.mechanic.state === 'fixing' && it.mechanic.t <= 0){ this.fix(it); it.mechanic.state = 'idle'; it.mechanic = null; this.app.ui.toast(`${it.o.name} is running again.`, 'good'); }
    }
    for (const car of this.cars) this.drive(car, dt);
    this.cars = this.cars.filter((c) => c.state !== 'gone');
    const before = this.list.length;
    this.list = this.list.filter((g) => { if (g.state === 'gone'){ if (g.avatar){ this.app.people.give(g.avatar); g.avatar = null; } return false; } return true; });
    this.stats.left += before - this.list.length;
  }
  // how many guests the park draws now
  wanted(){
    const S = this.park.s, rides = this.places ? [...this.places.rides.values()].filter((p) => p.it.o.open !== false).length : 0;
    const shops = this.places ? this.places.food.length : 0;
    const base = 12 + rides * 32 + shops * 6, mood = 0.55 + (S.rating || 0) / 5;
    const fee = S.mode === 'tycoon' ? clamp(1.3 - (S.entryFee || 0) / 60, 0.3, 1.3) : 1;
    return Math.min(this.cap, Math.round(base * mood * fee));
  }
  minute(){
    const S = this.park.s, h = S.time / 60;
    // closing time (or the park closed): everyone heads home (riders when their ride ends)
    if (h >= CLOSE_H || !S.parkOpen) for (const g of this.list){ if (g.inPark && (g.state === 'queuing' || g.state === 'idle' || (g.state === 'walking' && g.goal && g.goal.purpose !== 'exit' && g.goal.purpose !== 'home'))){ if (g.state === 'queuing'){ const it = g.goal.place.it; if (it.queue) it.queue.splice(it.queue.indexOf(g), 1); } this.goHome(g); } }
    for (const g of this.list){
      if (!g.inPark || g.staff) continue;
      g.hunger = clamp(g.hunger + 0.0045); g.thirst = clamp(g.thirst + 0.0055); g.toilet = clamp(g.toilet + 0.004); g.energy = clamp(g.energy - 0.0014); g.nausea = clamp(g.nausea - 0.015);
      if (g.hunger > 0.9 || g.thirst > 0.9 || g.toilet > 0.95) g.happy = clamp(g.happy - 0.006);
      else if (g.happy < 0.75) g.happy = clamp(g.happy + 0.002);   // a nice day out lifts the mood a little
      // a littered path, or a pretty spot
      if (this.r() < 0.05){ const dirty = S.litter.filter((l) => Math.abs(l.x - g.x) < 6 && Math.abs(l.z - g.z) < 6).length; if (dirty >= 3){ this.think(g, 'This path is filthy.', 'bad'); g.happy -= 0.03; } }
    }
    this.E.minute(this);
    this.rateT++;
    if (this.rateT >= 10){ this.rateT = 0; this.lastRating = this.E.rate(this.list); }
  }
  step(g, dt){
    switch (g.state){
      case 'gone': case 'riding': case 'inside-car': return;
      case 'idle': g.speed = 0; g.t -= dt; if (g.t <= 0){ if (g.staff) this.staffDecide(g); else this.decide(g); } return;
      case 'busy': g.speed = 0; g.t -= dt; if (g.t <= 0) this.finish(g); return;
      case 'fixing': g.speed = 0; g.t -= dt; return;
      case 'queuing': {
        const pl = g.goal && g.goal.place, spots = pl ? this.queueSpots(pl) : [];
        const n = pl && pl.it.queue ? pl.it.queue.indexOf(g) : -1, spot = spots[n] || null;
        if (spot) this.moveTo(g, spot[0], spot[1], dt, 0.25); else g.speed = 0;
        g.t += dt;
        if (g.t > 300){ this.think(g, `The queue for ${pl.it.o.name} is far too long.`, 'bad'); g.happy -= 0.05; if (pl.it.queue) pl.it.queue.splice(pl.it.queue.indexOf(g), 1); this.decideLater(g); }
        return;
      }
      case 'walking': {
        const G = g.goal, k = this.park.cellIndex(g.x, g.z), f = G.field;
        if (k < 0 || f[k] >= FAR){ this.decideLater(g); return; }
        if (f[k] === 0 && Math.hypot(g.x - (cellX(k % N) + g.ox * 0.6), g.z - (cellX(Math.floor(k / N)) + g.oz * 0.6)) < 0.5){ this.reach(g); return; }
        // the next cell nearer (or this cell's spot when here)
        let nk = k;
        if (f[k] > 0){ const i = k % N, j = (k - i) / N; let best = f[k]; for (const [di, dj] of DIRS){ const kk = (j + dj) * N + i + di; if (f[kk] < best){ best = f[kk]; nk = kk; } } }
        this.moveTo(g, cellX(nk % N) + g.ox * 0.6, cellX(Math.floor(nk / N)) + g.oz * 0.6, dt, 0);
        // done with a wrapper: a bin nearby, or on the ground
        if (g.litter > 0){ g.litter -= dt; if (g.litter <= 0) this.binOrDrop(g); }
        return;
      }
    }
  }
  moveTo(g, x, z, dt, stop){
    const dx = x - g.x, dz = z - g.z, d = Math.hypot(dx, dz);
    if (d <= stop + 0.02){ g.speed = 0; return; }
    const v = Math.min(g.walk, d / Math.max(dt, 1e-3)), step = Math.min(d, g.walk * dt);
    g.x += dx / d * step; g.z += dz / d * step; g.y = this.park.floorAt(g.x, g.z);
    g.yaw = g.yaw + angleDiff(g.yaw, Math.atan2(dx, dz)) * Math.min(1, dt * 8);
    g.speed = v;
  }
  binOrDrop(g){
    const b = this.places.bins.find((q) => Math.hypot(q.x - g.x, q.z - g.z) < 8);
    if (b){ b.fill++; return; }
    this.dropLitter(g.x, g.z);
  }
  // arrived where they were going
  reach(g){
    const G = g.goal, pl = G.place, P = this.park.s, R = this.r;
    switch (G.purpose){
      case 'enter': {
        const fee = P.mode === 'tycoon' ? (P.entryFee || 0) : 0;
        if (fee > g.money){ this.think(g, 'It costs too much to get in!', 'bad'); return this.leaveFrom(g); }
        g.money -= fee; g.spent += fee; this.E.earn('entry', fee);
        g.inPark = true; this.E.today().guests++;
        // through the gate
        const gate = this.places.gate; g.x = gate.inside[0] + g.ox; g.z = gate.inside[1] + g.oz; g.y = this.park.floorAt(g.x, g.z);
        if (R() < 0.5) this.think(g, `I've been looking forward to ${P.name}!`, 'good');
        return this.decideLater(g);
      }
      case 'exit': { g.inPark = false; const gate = this.places.gate; g.x = gate.outside[0] + g.ox; g.z = gate.outside[1] + g.oz; return this.leaveFrom(g); }
      case 'home': { g.state = 'gone'; if (g.car){ g.car.back = (g.car.back || 0) + 1; if (g.car.back >= g.car.group.length) g.car.state = 'out'; } return; }
      case 'ride': {
        const it = pl.it; if (it.broken || it.o.open === false){ this.think(g, `${it.o.name} is closed.`, 'bad'); return this.decideLater(g); }
        it.queue = it.queue || []; it.queue.push(g); g.state = 'queuing'; g.t = 0; return;
      }
      case 'toilet': g.state = 'busy'; g.hidden = true; g.t = 8 + R() * 6; return;
      case 'firstaid': g.state = 'busy'; g.hidden = true; g.t = 15; return;
      case 'rest': g.state = 'busy'; g.t = 12 + R() * 12; return;
      case 'sweep': { const l = g.sweeping; if (l){ const L = P.litter, i = L.indexOf(l); if (i >= 0) L.splice(i, 1); this.litterDirty = true; g.sweeping = null; } g.state = 'busy'; g.t = 2; return; }
      case 'fix': g.state = 'fixing'; g.t = 8; return;
      case 'wander': return this.decideLater(g);
      default: { // buying something: eat, drink, snack, shop
        const want = G.purpose === 'eat' ? 'food' : G.purpose === 'drink' ? 'drinks' : G.purpose === 'snack' ? 'snacks' : 'gifts';
        let items = this.sells(pl, want === 'snacks' ? 'snacks' : want).filter((m) => m.price <= g.money);
        if (G.purpose === 'umbrella'){ items = items.filter((m) => m.id === 'umbrella'); if (items.length) g.umbrella = true; }
        if (!items.length){ this.think(g, `${pl.o.name} hasn't got anything I want.`); return this.decideLater(g); }
        const m = items[Math.floor(R() * items.length)], base = GOODS[m.id].price;
        if (m.price > base * 2){ this.think(g, `${GOODS[m.id].name} at ${fmt(m.price)}? That's too expensive.`, 'bad'); g.happy -= 0.03; return this.decideLater(g); }
        g.money -= m.price; g.spent += m.price; this.E.earn(GOODS[m.id].sells === 'gifts' ? 'shops' : 'food', m.price);
        pl.o._sold = (pl.o._sold || 0) + 1;
        g.buying = m; g.state = 'busy';
        g.hidden = !pl.stall; g.t = pl.stall ? 3 : (pl.use === 'restaurant' ? 25 : 8);
        return;
      }
    }
  }
  // finished something that takes a while
  finish(g){
    const G = g.goal, R = this.r;
    g.hidden = false;
    if (G && G.purpose === 'toilet'){ g.toilet = 0; g.happy = clamp(g.happy + 0.03); }
    else if (G && G.purpose === 'firstaid'){ g.nausea = 0; g.happy = clamp(g.happy + 0.05); this.think(g, 'I feel much better now.', 'good'); }
    else if (G && G.purpose === 'rest'){ g.energy = clamp(g.energy + 0.25); }
    else if (g.buying){
      const kind = GOODS[g.buying.id].sells;
      if (kind === 'food'){ g.hunger = clamp(g.hunger - 0.65); g.thirst = clamp(g.thirst + 0.1); }
      if (kind === 'snacks'){ g.hunger = clamp(g.hunger - 0.25); }
      if (kind === 'drinks'){ g.thirst = clamp(g.thirst - 0.7); g.toilet = clamp(g.toilet + 0.15); }
      g.happy = clamp(g.happy + 0.04);
      this.think(g, R() < 0.5 ? `Mmm, a lovely ${GOODS[g.buying.id].name.toLowerCase()}.` : `I bought a ${GOODS[g.buying.id].name.toLowerCase()}.`, 'good');
      if (kind !== 'gifts') g.litter = 20 + R() * 50;
      g.buying = null;
    }
    this.decideLater(g);
  }
  leaveFrom(g){
    if (g.car){ const L = g.car.lot; if (this.go(g, { key: L.key, cells: L.cells }, 'home')) return; }
    g.state = 'gone';
  }

  // --- cars ---------------------------------------------------------------------------------------------------
  drive(car, dt){
    const sp = 9 * dt, P = this.places, L = car.lot;
    if (car.state === 'in'){
      // along the highway to the turning, then the road (cells nearer the car park), then into the bay
      const f = L.carField, k = this.park.cellIndex(car.x, car.z);
      let tx, tz;
      if (k < 0){ tx = cellX(car.cell % N); tz = cellX(Math.floor(car.cell / N)); }
      else if (f[k] > 0 && f[k] < FAR){ const i = k % N, j = (k - i) / N; let best = f[k], nk = k; for (const [di, dj] of DIRS){ const kk = (j + dj) * N + i + di; if (kk >= 0 && kk < N * N && f[kk] < best){ best = f[kk]; nk = kk; } } tx = cellX(nk % N); tz = cellX(Math.floor(nk / N)); }
      else { tx = car.bay.x; tz = car.bay.z; }
      const dx = tx - car.x, dz = tz - car.z, d = Math.hypot(dx, dz);
      if (d < 0.3 && tx === car.bay.x && tz === car.bay.z){ car.state = 'parked'; car.yaw = car.bay.yaw; this.unpark(car); return; }
      if (d > 0.01){ car.x += dx / d * Math.min(d, sp); car.z += dz / d * Math.min(d, sp); car.yaw = Math.atan2(dx, dz) - Math.PI / 2; }
    } else if (car.state === 'out'){
      // back out to the road, then off to the highway
      car.t += dt; car.z += sp; car.yaw = -Math.PI / 2 + Math.PI;
      if (car.t > 0.5 && car.bay.car === car) car.bay.car = null;
      if (car.z > HALF + 30 || car.t > 40) car.state = 'gone';
    }
    void P;
  }
  drawCars(){
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    let n = 0;
    for (const car of this.cars){
      if (n >= 400) break;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), car.yaw);
      m.compose(new THREE.Vector3(car.x, this.park.floorAt(car.x, car.z) + 0.02, car.z), q, new THREE.Vector3(1, 1, 1));
      for (const im of this.carMeshes) im.setMatrixAt(n, m);
      this.carMeshes[0].setColorAt(n, c.set(car.color));
      n++;
    }
    for (const im of this.carMeshes){ im.count = n; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
  }
  // everyone to draw (guests in the park or on their way, and staff)
  drawList(){ return this.list.concat(this.staff); }
  pick(ray, maxT){
    let best = null, bt = maxT;
    for (const g of this.drawList()){
      if (g.hidden) continue;
      const ox = ray.origin.x - g.x, oz = ray.origin.z - g.z, dx = ray.direction.x, dz = ray.direction.z, a = dx * dx + dz * dz, b = 2 * (ox * dx + oz * dz), c = ox * ox + oz * oz - 0.16;
      const disc = b * b - 4 * a * c; if (disc < 0 || a < 1e-9) continue;
      const t = (-b - Math.sqrt(disc)) / (2 * a); if (t < 0 || t > bt) continue;
      const y = ray.origin.y + ray.direction.y * t; if (y < g.y || y > g.y + 1.8) continue;
      best = g; bt = t;
    }
    return best ? { g: best, t: bt } : null;
  }
  summary(){
    const inPark = this.list.filter((g) => g.inPark);
    const top = [...this.thoughtCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    return { inPark: inPark.length, onWay: this.list.length - inPark.length, happy: inPark.length ? inPark.reduce((a, g) => a + g.happy, 0) / inPark.length : 0, top };
  }
}
// seat riders on a coaster (the train's own simple riders), coloured like the guest
const SEAT_LOOKS = [
  { shirt: 0x3a5a8a, skin: 0xe0b896, hair: 0x4a3020, pants: 0x2a2a32 }, { shirt: 0xc84a4a, skin: 0xd8a888, hair: 0x2a1a10, pants: 0x3a3a4a }, { shirt: 0xe8d8b0, skin: 0xc08868, hair: 0x1a1210, pants: 0x4a5a7a },
  { shirt: 0x6a8a5a, skin: 0xf0c8a8, hair: 0xa07040, pants: 0x2a3a5a }, { shirt: 0x8a4a8a, skin: 0xe8c0a0, hair: 0x3a2414, pants: 0x1e2a3a }, { shirt: 0xf0f0f0, skin: 0xa87050, hair: 0x120c08, pants: 0x3a4a6a },
];
void SPEEDS; void groundCells; void HALF; void CELL;
