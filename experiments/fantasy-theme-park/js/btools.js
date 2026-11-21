// The building tools, driven like every other tool (down / move / up from a finger, the mouse or the
// VR laser), but working from the pointer's ray, since walls and roofs are above the ground.
//  - 'building': put down a ready-made building (or move one), with a ghost that is green where it fits;
//    the ghost snaps to the park's 2 m grid and turns in quarter turns.
//  - 'bedit': change a building. Modes: rooms (paint or rub out rooms on a storey; the storeys above
//    are cut away so you can see in), walls (tap a wall to give it the chosen style), roof, look
//    (materials), extras (towers, chimneys, awnings, signs). Each stroke or tap is one undoable edit.
import * as THREE from 'three';
import { N, CELL, HALF } from './park.js';
import { CATALOG } from './models.js';
import { buildBuilding, fromTemplate, levels, groundCells, bounds, edges, edgeEnds, key, ekey, parse, toLocal, toWorld, H, WALLH, levelSets, TEMPLATES } from './buildings.js';
import { disposeStructure } from './structures.js';

const snap = (v) => Math.round(v / CELL) * CELL;
export class BuildingTools {
  constructor(tools){ this.T = tools; this.ghost = null; this.ghostKey = ''; this.stroke = null; }
  get app(){ return this.T.app; }
  get P(){ return this.T.app.park; }
  say(t, k){ this.T.say(t, k); }

  // --- where a building would stand: centred on the point, snapped to the grid, turned in quarter turns
  placed(src, p, quarter){
    const o = JSON.parse(JSON.stringify(src)), b = bounds(o), r = quarter * Math.PI / 2;
    o.r = r;
    const cx = (b.i0 + b.i1 + 1) * CELL / 2, cz = (b.j0 + b.j1 + 1) * CELL / 2, c = Math.cos(r), s = Math.sin(r);
    o.x = snap(p.x - (cx * c + cz * s)); o.z = snap(p.z - (-cx * s + cz * c));
    return o;
  }
  // why a building can't stand where it is (or null)
  problem(o, ignore){
    const P = this.P, S = P.s;
    for (const [x, z] of groundCells(o)){
      const i = Math.floor((x + HALF) / CELL), j = Math.floor((z + HALF) / CELL);
      if (!P.editable(i, j)) return 'That is outside the park.';
      const k = j * N + i;
      if (S.path[k]) return 'Buildings go beside paths, not on them.';
      if (!Number.isNaN(S.water[k])) return 'Not in the water.';
      const b = this.app.objects.bcells.get(k); if (b && b.id !== ignore) return 'That overlaps another building.';
      const st = this.T.inStructure(x, z, true); if (st) return st.type === 'lot' ? 'That is in the car park.' : 'That is in the entrance.';
    }
    const { floorY, lo } = levels(o, P);
    if (floorY - lo > 3.2) return 'The ground is too steep here: level it first (Land tool).';
    return null;
  }
  clearGhost(){ if (this.ghost){ disposeStructure(this.ghost); this.ghost = null; this.ghostKey = ''; } }
  showGhost(o, bad){
    const k = JSON.stringify([o.floors, o.towers, o.roof, o.r, o.extras && o.extras.length]);
    if (k !== this.ghostKey){
      this.clearGhost();
      this.ghost = buildBuilding({ ...o, x: 0, z: 0, r: 0 }, { groundAt: () => 0 }); this.ghostKey = k;
      this.ghost.renderOrder = 7; this.app.scene.add(this.ghost);
    }
    const m = bad ? this.T.ghostBad : this.T.ghostOk;
    this.ghost.traverse((c) => { if (c.isMesh) c.material = m; });
    this.ghost.position.set(o.x, levels(o, this.P).floorY, o.z); this.ghost.rotation.y = o.r || 0; this.ghost.visible = true;
  }

  // --- placing (and moving) ---------------------------------------------------------------------------
  source(){
    const opts = this.T.opts;
    if (opts.move){ const o = this.P.obj(opts.move); return o ? JSON.parse(JSON.stringify(o)) : null; }
    return fromTemplate(opts.tpl || 'blank');
  }
  quarter(){ const opts = this.T.opts, base = opts.move ? Math.round(((this.P.obj(opts.move) || {}).r || 0) / (Math.PI / 2)) : 0; return (((base + Math.round(this.T.rot / (Math.PI / 2))) % 4) + 4) % 4; }
  placeHover(p){
    if (!p){ if (this.ghost) this.ghost.visible = false; return; }
    const src = this.source(); if (!src) return;
    const o = this.placed(src, p, this.quarter());
    this.showGhost(o, !!this.problem(o, this.T.opts.move));
  }
  placeUp(p){
    if (!p) return;
    const src = this.source(); if (!src) return;
    const o = this.placed(src, p, this.quarter()), why = this.problem(o, this.T.opts.move);
    if (why) return this.say(why, 'bad');
    const P = this.P;
    P.begin(this.T.opts.move ? 'Move building' : 'Build ' + o.name.toLowerCase());
    // trees and rocks in the way are cleared
    const cells = new Set(groundCells(o).map(([x, z]) => P.cellIndex(x, z)));
    for (const q of P.s.objects.slice()) if (CATALOG[q.type] && CATALOG[q.type].cat !== 'furniture' && CATALOG[q.type].cat !== 'lights' && cells.has(P.cellIndex(q.x, q.z))) P.removeObject(q.id);
    let id;
    if (this.T.opts.move){ id = this.T.opts.move; P.changeObject(id, { x: o.x, z: o.z, r: o.r }); }
    else id = P.addObject(o).id;
    P.commit();
    this.clearGhost();
    this.app.audio && this.app.audio.click();
    this.T.rot = 0;
    if (this.T.opts.move){ this.T.set('select'); this.app.select(id); }
    else { this.app.select(id); this.say('Built. Tap Edit (or keep building) to change its rooms, walls and roof.', 'good'); }
  }

  // --- editing ---------------------------------------------------------------------------------------------
  get o(){ return this.P.obj(this.T.opts.id); }
  floorY(){ const g = this.app.objects.structs.get(this.T.opts.id); return g ? g.userData.floorY : 0; }
  // the pointer's ray in the building's own frame
  localRay(){
    const o = this.o, ray = this.app.lastRay; if (!o || !ray) return null;
    const [lx, lz] = toLocal(o, ray.origin.x, ray.origin.z), c = Math.cos(o.r || 0), s = Math.sin(o.r || 0);
    return { o: [lx, ray.origin.y - this.floorY(), lz], d: [ray.direction.x * c - ray.direction.z * s, ray.direction.y, ray.direction.x * s + ray.direction.z * c] };
  }
  // where the ray meets the level y (building frame): [x, z] or null
  onPlane(y){ const r = this.localRay(); if (!r || Math.abs(r.d[1]) < 1e-6) return null; const t = (y - r.o[1]) / r.d[1]; if (t < 0) return null; return [r.o[0] + r.d[0] * t, r.o[2] + r.d[2] * t]; }
  // the outside wall under the ray (closest)
  pickEdge(){
    const o = this.o, r = this.localRay(); if (!o || !r) return null;
    let best = null, bt = 1e9;
    for (const e of edges(o)){
      const { a, b } = edgeEnds(e.i, e.j, e.d), y0 = e.l * H, y1 = y0 + WALLH;
      const alongX = a[1] === b[1], plane = alongX ? a[1] : a[0], ax = alongX ? 2 : 0;
      if (Math.abs(r.d[ax]) < 1e-6) continue;
      const t = (plane - r.o[ax]) / r.d[ax]; if (t < 0 || t >= bt) continue;
      const hx = r.o[0] + r.d[0] * t, hy = r.o[1] + r.d[1] * t, hz = r.o[2] + r.d[2] * t;
      const u = alongX ? hx : hz, u0 = Math.min(alongX ? a[0] : a[1], alongX ? b[0] : b[1]);
      if (u < u0 - 0.02 || u > u0 + CELL + 0.02 || hy < y0 || hy > y1) continue;
      best = e; bt = t;
    }
    return best;
  }
  editDown(p){
    const T = this.T, opts = T.opts, o = this.o; if (!o) return T.set('select');
    if (opts.mode === 'rooms'){
      const L = opts.level || 0, q = this.onPlane(L * H + 0.02); if (!q) return;
      const i = Math.floor(q[0] / CELL), j = Math.floor(q[1] / CELL), has = o.floors[L] && o.floors[L].includes(key(i, j));
      this.P.begin(has ? 'Remove rooms' : 'Add rooms');
      this.stroke = { add: !has, level: L, told: false };
      this.paintRoom(i, j);
    } else if (opts.mode === 'walls') this.applyWall();
    else if (opts.mode === 'extras') this.applyExtra();
    void p;
  }
  editMove(){
    if (!this.stroke) return;
    const q = this.onPlane(this.stroke.level * H + 0.02); if (!q) return;
    this.paintRoom(Math.floor(q[0] / CELL), Math.floor(q[1] / CELL));
  }
  editUp(){ if (this.stroke){ this.stroke = null; this.P.commit(); this.app.ui.refresh(); } }
  editCancel(){ if (this.stroke){ this.stroke = null; this.P.cancel(); this.app.objects.refresh(this.o); } }
  paintRoom(i, j){
    const o = this.o, S = this.stroke, L = S.level, k = key(i, j);
    const floors = o.floors.map((l) => l.slice());
    if (S.add){
      if (floors[L].includes(k)) return;
      if (L > 0 && !floors[L - 1].includes(k)){ if (!S.told){ S.told = true; this.say('A room upstairs needs a room under it.'); } return; }
      if (L === 0){
        const test = { ...o, floors: [[k]], towers: [] }, why = this.problem(test, o.id);
        if (why){ if (!S.told){ S.told = true; this.say(why, 'bad'); } return; }
        const [x, z] = toWorld(o, i * CELL + 1, j * CELL + 1), ck = this.P.cellIndex(x, z);
        for (const q of this.P.s.objects.slice()) if (CATALOG[q.type] && CATALOG[q.type].cat !== 'furniture' && CATALOG[q.type].cat !== 'lights' && this.P.cellIndex(q.x, q.z) === ck) this.P.removeObject(q.id);
      }
      floors[L].push(k);
    } else {
      if (!floors[L].includes(k)) return;
      if (L === 0 && floors[0].length === 1){ if (!S.told){ S.told = true; this.say('A building needs at least one room: to take it away, use Remove.'); } return; }
      for (let l = L; l < floors.length; l++) floors[l] = floors[l].filter((c) => c !== k);
      while (floors.length > 1 && !floors[floors.length - 1].length) floors.pop();
    }
    this.P.changeObject(o.id, { floors });
    this.app.objects.refresh(this.o);
  }
  applyWall(){
    const e = this.pickEdge(), st = this.T.opts.style || 'window';
    if (!e) return this.say('Tap one of the building\'s outside walls.');
    if ((st === 'door' || st === 'shop') && e.l > 0) return this.say('Doors and shopfronts go on the ground floor.', 'bad');
    const o = this.o, walls = { ...(o.walls || {}) }, k = ekey(e.i, e.j, e.l, e.d);
    if (st === 'window') delete walls[k]; else walls[k] = st;
    this.P.begin('Wall'); this.P.changeObject(o.id, { walls }); this.P.commit();
    this.app.audio && this.app.audio.click();
  }
  applyExtra(){
    const o = this.o, kind = this.T.opts.extra || 'tower', P = this.P;
    const extras = (o.extras || []).slice(), towers = (o.towers || []).slice();
    if (kind === 'tower' || (kind === 'remove' && !this.pickEdge())){
      const q = this.onPlane(0.02); if (!q) return;
      const vi = Math.round(q[0] / CELL), vj = Math.round(q[1] / CELL), at = towers.findIndex((t) => t.i === vi && t.j === vj);
      if (kind === 'remove'){
        if (at >= 0){ towers.splice(at, 1); P.begin('Remove tower'); P.changeObject(o.id, { towers }); P.commit(); return; }
        // or a chimney on that cell
        const ci = Math.floor(q[0] / CELL), cj = Math.floor(q[1] / CELL), ch = extras.findIndex((x) => x.kind === 'chimney' && x.i === ci && x.j === cj);
        if (ch >= 0){ extras.splice(ch, 1); P.begin('Remove chimney'); P.changeObject(o.id, { extras }); P.commit(); return; }
        return this.say('Tap a tower, chimney, awning or sign to take it away.');
      }
      if (at >= 0) towers.splice(at, 1);
      else {
        const test = { ...o, floors: [[]], towers: [{ i: vi, j: vj, h: 1 }] }, why = this.problem(test, o.id);
        if (why) return this.say(why, 'bad');
        towers.push({ i: vi, j: vj, h: o.floors.length + 1, roof: this.T.opts.towerRoof || 'cone' });
      }
      P.begin('Tower'); P.changeObject(o.id, { towers }); P.commit(); return;
    }
    if (kind === 'chimney'){
      // the highest storey under the ray
      for (let l = o.floors.length - 1; l >= 0; l--){
        const q = this.onPlane(l * H + H); if (!q) continue;
        const i = Math.floor(q[0] / CELL), j = Math.floor(q[1] / CELL);
        if (!o.floors[l].includes(key(i, j))) continue;
        const at = extras.findIndex((x) => x.kind === 'chimney' && x.i === i && x.j === j);
        if (at >= 0) extras.splice(at, 1); else extras.push({ kind: 'chimney', i, j });
        P.begin('Chimney'); P.changeObject(o.id, { extras }); P.commit(); return;
      }
      return this.say('Tap the roof where the chimney goes.');
    }
    const e = this.pickEdge(); if (!e) return this.say('Tap one of the outside walls.');
    const same = (x) => (x.kind === 'awning' || x.kind === 'sign') && x.i === e.i && x.j === e.j && x.l === e.l && x.d === e.d;
    if (kind === 'remove'){ const n = extras.length; const left = extras.filter((x) => !same(x)); if (left.length === n) return this.say('Nothing there to take away.'); P.begin('Remove'); P.changeObject(o.id, { extras: left }); P.commit(); return; }
    if (kind === 'awning'){
      if (e.l > 0) return this.say('Awnings go over the ground floor.', 'bad');
      const left = extras.filter((x) => !(same(x) && x.kind === 'awning'));
      if (left.length === extras.length) left.push({ kind: 'awning', i: e.i, j: e.j, l: e.l, d: e.d, color: this.T.opts.color || '#1e5a3a' });
      P.begin('Awning'); P.changeObject(o.id, { extras: left }); P.commit(); return;
    }
    if (kind === 'sign'){
      const had = extras.find((x) => same(x) && x.kind === 'sign');
      this.app.ui.askName({ title: 'What should the sign say?', value: had ? had.text : o.name }).then((text) => {
        if (!text) return;
        const left = this.o.extras.filter((x) => !(same(x) && x.kind === 'sign'));
        left.push({ kind: 'sign', i: e.i, j: e.j, l: e.l, d: e.d, text, color: this.T.opts.color || '#173826' });
        P.begin('Sign'); P.changeObject(o.id, { extras: left }); P.commit();
      });
    }
  }
  // edits made from buttons (not the pointer)
  set(fields, label){ const o = this.o; if (!o) return; this.P.begin(label); this.P.changeObject(o.id, fields); this.P.commit(); }
  addStorey(){
    const o = this.o; if (!o) return;
    if (o.floors.length >= 6) return this.say('Six storeys is the most.', 'bad');
    this.set({ floors: [...o.floors, o.floors[o.floors.length - 1].slice()] }, 'Add a storey');
    this.T.opts.level = o.floors.length - 1;
  }
  removeStorey(){
    const o = this.o; if (!o) return;
    if (o.floors.length <= 1) return this.say('A building needs a ground floor.', 'bad');
    this.set({ floors: o.floors.slice(0, -1) }, 'Remove the top storey');
    this.T.opts.level = Math.min(this.T.opts.level || 0, o.floors.length - 1);
  }
  // cut the building open above the storey being edited (rooms mode)
  updateCut(){
    const T = this.T, objs = this.app.objects;
    const want = T.kind === 'bedit' && T.opts.mode === 'rooms' && this.o ? { id: T.opts.id, level: T.opts.level || 0 } : null;
    const was = objs.cut;
    if (JSON.stringify(want) === JSON.stringify(was)) return;
    objs.cut = want;
    if (was && this.P.obj(was.id)) objs.refresh(this.P.obj(was.id));
    if (want) objs.refresh(this.o);
  }
}
export { TEMPLATES, levelSets, parse };
void THREE;
