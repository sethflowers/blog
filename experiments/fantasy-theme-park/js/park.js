// The park's state, and the one way of changing it.
//
// The map is N x N cells of CELL metres (600 m square, centred on the origin, -Z north). Each cell has
// a ground paint, maybe water (its surface level), maybe a path (surface + flags) and a land (section).
// Heights are at the cell corners. Everything else (trees, lamps, the gate, car parks, arches...) is
// an object in `objects`.
//
// Every change goes through an Edit (park.begin(label) ... park.commit()), which records the old value
// of everything it touches: that gives unlimited undo / redo, and tells the world which parts to
// rebuild (park.on('change', fn) gets { heights, paint, water, paths, lands: rects, objects: Set }).
import { clamp, fbm, rng, uid, smooth, lerp } from './util.js';
import { THEMES } from './names.js';

export const CELL = 2;
export const N = 300;
export const HALF = N * CELL / 2;          // 300 m
export const EDGE = 4;                     // cells round the edge that can't be changed (they meet the countryside)
export const SAVE_VERSION = 1;
export const HIGHWAY_Z = HALF + 14;      // the highway runs east-west just south of the map

export const SURFACES = [null,
  { id: 1, key: 'pavers', name: 'Brick pavers' }, { id: 2, key: 'cobbles', name: 'Cobbles' }, { id: 3, key: 'flagstone', name: 'Flagstones' },
  { id: 4, key: 'crazy', name: 'Crazy paving' }, { id: 5, key: 'tarmac', name: 'Tarmac' }, { id: 6, key: 'boards', name: 'Boardwalk' },
  { id: 7, key: 'gravel', name: 'Gravel' }, { id: 8, key: 'road', name: 'Road' }];
export const ROAD = 8;
export const QUEUE = 1;     // path flag
export const GROUNDS = ['Grass', 'Earth', 'Rock', 'Sand'];

export const cellX = (i) => -HALF + (i + 0.5) * CELL;
export const cellOf = (x) => Math.floor((x + HALF) / CELL);
export const vtx = (i, j) => j * (N + 1) + i;

// --- the land the park is built on ---------------------------------------------------------------
export const LANDS = {
  meadow: { name: 'Meadow Valley', about: 'Gentle green fields with a pond and woods.' },
  lake: { name: 'Lakeside', about: 'A big lake to the north-west with wooded shores.' },
  hills: { name: 'Hill Country', about: 'Rolling hills rising to the north.' },
  coast: { name: 'Coastal Cliffs', about: 'Cliffs and a sandy cove where the land meets the sea.' },
};
// the shape of the land outside the map as well (the countryside uses this too)
export function groundShape(type, seed, x, z){
  const n = (fx, oct, s) => fbm(x / fx + 100, z / fx + 100, oct, seed + s);
  let h = (n(260, 4, 1) - 0.5) * 8 + (n(60, 3, 2) - 0.5) * 1.5 + (type === 'hills' ? 0 : 1.8);
  if (type === 'hills') h += smooth((-z + 50) / 400) * (n(180, 4, 3) * 40) + (n(120, 3, 4) - 0.5) * 6;
  if (type === 'lake'){ const d = Math.hypot((x + 130) / 1.3, z + 120); h -= 9 * smooth(1 - (d - 60) / 70); }
  if (type === 'coast'){ const edge = -150 + (n(120, 3, 5) - 0.5) * 80; h += z < edge ? -14 * smooth((edge - z) / 25) : 0; h += smooth((z - edge) / 200) * 3; }
  if (type === 'meadow'){ const d = Math.hypot(x - 110, z + 90); h -= 4 * smooth(1 - (d - 18) / 30); }
  // level along the south, where the highway runs past the park
  return lerp(h, 0, smooth(1 - Math.abs(z - HIGHWAY_Z) / 60));
}
export function waterLevelFor(type){ return type === 'coast' ? -3 : type === 'lake' ? -2.5 : type === 'meadow' ? -1.2 : null; }

export function newParkState({ name, mode = 'sandbox', land = 'meadow', seed = (Math.random() * 1e9) | 0 }){
  const S = {
    v: SAVE_VERSION, id: uid(), name, mode, land, seed, created: Date.now(),
    time: 9 * 60, day: 1, money: mode === 'sandbox' ? 0 : 50000,
    heights: new Float32Array((N + 1) * (N + 1)), paint: new Uint8Array(N * N), water: new Float32Array(N * N).fill(NaN),
    path: new Uint8Array(N * N), pflags: new Uint8Array(N * N), zone: new Uint8Array(N * N),
    lands: [], objects: [], camera: null,
  };
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) S.heights[vtx(i, j)] = groundShape(land, seed, -HALF + i * CELL, -HALF + j * CELL);
  // a start: the entrance gate facing the highway (south), a plaza and a path in, and a car park by the road
  const gz = HALF - 60;
  // flatten round the entrance (the edge band is already level at 0), feathered into the land round it
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++){
    const x = -HALF + i * CELL, z = -HALF + j * CELL;
    const d = Math.max(Math.abs(x) - 50, gz - 30 - z, 0);
    if (d < 30) S.heights[vtx(i, j)] = lerp(0, S.heights[vtx(i, j)], smooth(d / 30));
  }
  // water fills whatever is below its level (after the levelling); sand on the shore, rock on steep ground
  const wl = waterLevelFor(land);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++){
    const hs = [S.heights[vtx(i, j)], S.heights[vtx(i + 1, j)], S.heights[vtx(i, j + 1)], S.heights[vtx(i + 1, j + 1)]];
    const lo = Math.min(...hs), hi = Math.max(...hs), k = j * N + i;
    if (wl !== null && lo < wl) S.water[k] = wl;
    if (wl !== null && lo < wl + 0.8 && (land === 'coast' || land === 'lake')) S.paint[k] = 3;
    if (hi - lo > 1.6) S.paint[k] = 2;
    if (cellX(j) > gz - 34 && Math.abs(cellX(i)) < 56){ S.water[k] = NaN; S.paint[k] = 0; }
  }
  const lay = (x0, z0, x1, z1, s) => { for (let j = cellOf(z0); j <= cellOf(z1); j++) for (let i = cellOf(x0); i <= cellOf(x1); i++) S.path[j * N + i] = s; };
  lay(-8, gz - 24, 7.9, gz - 6.1, 1);          // the plaza inside the gate
  lay(-3, gz - 6, 2.9, gz + 5.9, 1);           // through the gate
  lay(-8, gz + 6, 7.9, gz + 11.9, 1);          // the forecourt outside
  lay(-2, gz + 12, 1.9, gz + 19.9, 1);         // the walk from the car park
  lay(-3, gz + 44, 2.9, HALF - 0.1, ROAD);     // the road in from the highway
  S.objects.push({ id: uid(), type: 'gate', x: 0, z: gz, r: 0 });
  S.objects.push({ id: uid(), type: 'lot', x: 0, z: gz + 32, r: 0, w: 20, d: 12, name: 'Visitor Parking' });
  for (const x of [-7, 7]) for (const dz of [-21, -9]) S.objects.push({ id: uid(), type: 'lamp1', x, z: gz + dz, r: 0 });
  S.objects.push({ id: uid(), type: 'fountain', x: 0, z: gz - 15, r: 0 });
  // woods: clumps of trees scattered over the land (not on water, paths or the start)
  const r = rng(seed + 9), kinds = ['oak', 'oak', 'birch', 'pine', 'pine', 'cypress', 'willow'];
  for (let c = 0; c < 60; c++){
    const cx = (r() - 0.5) * (N - 20) * CELL, cz = (r() - 0.5) * (N - 20) * CELL, kind = kinds[Math.floor(r() * kinds.length)], n = 3 + Math.floor(r() * 12);
    for (let t = 0; t < n; t++){
      const x = cx + (r() - 0.5) * 40, z = cz + (r() - 0.5) * 40, i = cellOf(x), j = cellOf(z);
      if (i < EDGE || j < EDGE || i >= N - EDGE || j >= N - EDGE) continue;
      const k = j * N + i;
      if (!isNaN(S.water[k]) || S.path[k] || (Math.abs(x) < 75 && z > gz - 75)) continue;
      S.objects.push({ id: uid(), type: kind === 'willow' && r() < 0.5 ? 'oak' : kind, x, z, r: r() * 6.28, s: 0.8 + r() * 0.45 });
    }
  }
  return S;
}

// Older saves: fill in what they lack. (Version 1 is the first.)
export function upgrade(S){
  if (!S.lands) S.lands = [];
  if (!S.objects) S.objects = [];
  if (!S.day) S.day = 1;
  S.v = SAVE_VERSION;
  return S;
}

// --- the park object ---------------------------------------------------------------------------
export class Park {
  constructor(state){
    this.s = upgrade(state);
    this.listeners = [];
    this.undoStack = []; this.redoStack = [];
    this.rec = null;
    this.byId = new Map(this.s.objects.map((o) => [o.id, o]));
    this.dirty = false;
  }
  on(fn){ this.listeners.push(fn); }
  emit(ch){ for (const f of this.listeners) f(ch); }

  // --- reading -----
  inMap(i, j){ return i >= 0 && j >= 0 && i < N && j < N; }
  editable(i, j){ return i >= EDGE && j >= EDGE && i < N - EDGE && j < N - EDGE; }
  // ground height at a point (bilinear over the cell's corners)
  groundAt(x, z){
    const fx = (x + HALF) / CELL, fz = (z + HALF) / CELL;
    const i = clamp(Math.floor(fx), 0, N - 1), j = clamp(Math.floor(fz), 0, N - 1), u = clamp(fx - i), v = clamp(fz - j);
    const H = this.s.heights;
    // the cell is split into two triangles the same way the terrain mesh splits it
    const a = H[vtx(i, j)], b = H[vtx(i + 1, j)], c = H[vtx(i, j + 1)], d = H[vtx(i + 1, j + 1)];
    return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
  }
  cellIndex(x, z){ const i = cellOf(x), j = cellOf(z); return this.inMap(i, j) ? j * N + i : -1; }
  pathAt(x, z){ const k = this.cellIndex(x, z); return k < 0 ? 0 : this.s.path[k]; }
  waterAt(x, z){ const k = this.cellIndex(x, z); return k < 0 ? NaN : this.s.water[k]; }
  // where you stand: on a path (its top, or a bridge deck) or the ground
  floorAt(x, z){
    const k = this.cellIndex(x, z);
    if (k >= 0 && this.buildingFloor){ const b = this.buildingFloor(k); if (b !== null) return b; }
    if (k >= 0 && this.s.path[k]){ const y = this.pathHeight ? this.pathHeight(x, z) : null; if (y !== null && y !== undefined) return y; }
    return this.groundAt(x, z);
  }
  landAt(x, z){ const k = this.cellIndex(x, z); return k < 0 ? null : this.s.lands[this.s.zone[k] - 1] || null; }
  obj(id){ return this.byId.get(id); }

  // --- changing: everything goes through an edit -----
  begin(label){
    if (this.rec) this.commit();
    this.rec = { label, layers: {}, objs: new Map(), dirty: newDirty() };
    return this;
  }
  _layer(name){ return this.rec.layers[name] || (this.rec.layers[name] = new Map()); }
  _mark(kind, i, j){ const d = this.rec.dirty; const r = d[kind]; if (!r){ d[kind] = [i, j, i, j]; return; } r[0] = Math.min(r[0], i); r[1] = Math.min(r[1], j); r[2] = Math.max(r[2], i); r[3] = Math.max(r[3], j); }
  setHeight(i, j, h){
    if (i < 0 || j < 0 || i > N || j > N) return;
    const k = vtx(i, j), H = this.s.heights;
    if (H[k] === h) return;
    const L = this._layer('heights'); if (!L.has(k)) L.set(k, H[k]);
    H[k] = h; this._mark('heights', i, j);
  }
  setCell(layer, i, j, v){
    if (!this.inMap(i, j)) return false;
    const A = this.s[layer], k = j * N + i;
    if (A[k] === v || (Number.isNaN(A[k]) && Number.isNaN(v))) return false;
    const L = this._layer(layer); if (!L.has(k)) L.set(k, A[k]);
    A[k] = v; this._mark(layer === 'pflags' ? 'path' : layer, i, j);
    return true;
  }
  addObject(o){
    if (!o.id) o.id = uid();
    this.s.objects.push(o); this.byId.set(o.id, o);
    if (!this.rec.objs.has(o.id)) this.rec.objs.set(o.id, null);
    this.rec.dirty.objects.add(o.id);
    return o;
  }
  removeObject(id){
    const o = this.byId.get(id); if (!o) return;
    if (!this.rec.objs.has(id)) this.rec.objs.set(id, JSON.stringify(o));
    this.s.objects.splice(this.s.objects.indexOf(o), 1); this.byId.delete(id);
    this.rec.dirty.objects.add(id);
  }
  // change an object's fields (records the old copy first)
  changeObject(id, fields){
    const o = this.byId.get(id); if (!o) return;
    if (!this.rec.objs.has(id)) this.rec.objs.set(id, JSON.stringify(o));
    Object.assign(o, fields);
    this.rec.dirty.objects.add(id);
  }
  // lands list: record the whole list (it's small)
  setLands(list){
    if (!this.rec.landsBefore) this.rec.landsBefore = JSON.stringify(this.s.lands);
    this.s.lands = list; this.rec.dirty.landList = true;
  }
  setName(name){ if (this.rec.nameBefore === undefined) this.rec.nameBefore = this.s.name; this.s.name = name; this.rec.dirty.name = true; }
  // finish the edit: push it for undo, tell the world
  commit(){
    const r = this.rec; if (!r) return null;
    this.rec = null;
    const empty = !Object.values(r.layers).some((m) => m.size) && !r.objs.size && !r.landsBefore && r.nameBefore === undefined;
    if (empty) return null;
    // the "after" values, for redo
    r.after = {};
    for (const [name, m] of Object.entries(r.layers)){ const A = name === 'heights' ? this.s.heights : this.s[name]; const a = new Map(); for (const k of m.keys()) a.set(k, A[k]); r.after[name] = a; }
    r.objsAfter = new Map(); for (const id of r.objs.keys()){ const o = this.byId.get(id); r.objsAfter.set(id, o ? JSON.stringify(o) : null); }
    if (r.landsBefore) r.landsAfter = JSON.stringify(this.s.lands);
    if (r.nameBefore !== undefined) r.nameAfter = this.s.name;
    this.undoStack.push(r); if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack.length = 0;
    this.dirty = true;
    this.emit(r.dirty);
    return r;
  }
  cancel(){ if (!this.rec) return; const r = this.rec; this.rec = null; this._apply(r, false); }
  get canUndo(){ return this.undoStack.length > 0; }
  get canRedo(){ return this.redoStack.length > 0; }
  undo(){ const r = this.undoStack.pop(); if (!r) return null; this._apply(r, false); this.redoStack.push(r); this.dirty = true; return r.label; }
  redo(){ const r = this.redoStack.pop(); if (!r) return null; this._apply(r, true); this.undoStack.push(r); this.dirty = true; return r.label; }
  _apply(r, forward){
    const dirty = newDirty();
    for (const [name, before] of Object.entries(r.layers)){
      const vals = forward ? r.after[name] : before, A = name === 'heights' ? this.s.heights : this.s[name];
      const W = name === 'heights' ? N + 1 : N;
      for (const [k, v] of vals){ A[k] = v; const i = k % W, j = (k - i) / W; const kind = name === 'pflags' ? 'path' : name; const d = dirty[kind]; if (!d) dirty[kind] = [i, j, i, j]; else { d[0] = Math.min(d[0], i); d[1] = Math.min(d[1], j); d[2] = Math.max(d[2], i); d[3] = Math.max(d[3], j); } }
    }
    const objs = forward ? r.objsAfter : r.objs;
    for (const [id, json] of (objs || new Map())){
      const cur = this.byId.get(id);
      if (cur){ this.s.objects.splice(this.s.objects.indexOf(cur), 1); this.byId.delete(id); }
      if (json){ const o = JSON.parse(json); this.s.objects.push(o); this.byId.set(id, o); }
      dirty.objects.add(id);
    }
    if (r.landsBefore){ this.s.lands = JSON.parse(forward ? r.landsAfter : r.landsBefore); dirty.landList = true; }
    if (r.nameBefore !== undefined){ this.s.name = forward ? r.nameAfter : r.nameBefore; dirty.name = true; }
    this.emit(dirty);
  }

  // --- lands -----
  addLand(theme, name){
    const list = this.s.lands.map((l) => ({ ...l }));
    const used = new Set(list.map((l) => l.color));
    const palette = ['#c8a050', '#7a90c8', '#5a9a5a', '#c85a3a', '#3a8aa8', '#c8784a', '#9a8ad8', '#c86a9a', '#6ab0a0', '#a0a04a'];
    const color = (THEMES[theme] && !used.has(THEMES[theme].color)) ? THEMES[theme].color : palette.find((c) => !used.has(c)) || '#888888';
    list.push({ name, theme, color });
    this.setLands(list);
    return list.length;   // its number in the land layer (1-based)
  }
}
function newDirty(){ return { objects: new Set() }; }
