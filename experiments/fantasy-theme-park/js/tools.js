// The building tools. The same tool code is driven by a finger or the mouse on screen and by the
// laser in VR: down(p) / move(p) / up(p) with p = the point on the ground ({ x, y, z }), plus hover(p)
// for the preview and frame(dt) for brushes that act while held. Every stroke is one Edit, so it can
// be undone as a whole, and cancel() (a second finger arriving) takes it back.
import * as THREE from 'three';
import { N, CELL, HALF, cellOf, cellX, vtx, ROAD, QUEUE, SURFACES } from './park.js';
import { CATALOG, model, resolveMat } from './models.js';
import { objName, isStructure } from './objects.js';
import { clamp, smooth, uid } from './util.js';
import { FENCES } from './structures.js';
import { BuildingTools } from './btools.js';
import { RideTools } from './ridetools.js';
import { stationCells, flatRadius } from './rides.js';
import { DRAWN } from './trackrides.js';
import { newStall } from './shops.js';
import { foodName, shopName } from './names.js';

export const TERRAIN_MODES = [['raise', 'Raise'], ['lower', 'Lower'], ['flatten', 'Level'], ['smooth', 'Smooth'], ['paint', 'Paint']];

export class Tools {
  constructor(app){
    this.app = app; this.park = app.park;
    this.kind = 'select'; this.opts = {};
    this.stroke = null;
    this.B = new BuildingTools(this);
    this.R = new RideTools(this);
    this.rot = 0;
    // preview: cells (path lines, areas, car parks), and a ghost of the thing being placed
    const cg = new THREE.PlaneGeometry(CELL * 0.94, CELL * 0.94); cg.rotateX(-Math.PI / 2);
    this.cellMat = new THREE.MeshBasicMaterial({ color: 0x7ad07a, transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
    this.cells = new THREE.InstancedMesh(cg, this.cellMat, 6000); this.cells.count = 0; this.cells.frustumCulled = false; this.cells.renderOrder = 6;
    app.scene.add(this.cells);
    this.ghostOk = new THREE.MeshStandardMaterial({ color: 0x80e080, transparent: true, opacity: 0.55, depthWrite: false, emissive: 0x204020 });
    this.ghostBad = new THREE.MeshStandardMaterial({ color: 0xe06060, transparent: true, opacity: 0.55, depthWrite: false, emissive: 0x401010 });
    this.ghost = null; this.ghostType = null;
    this.brush = app.terrain.uniforms.brush.value;
    this.last = null;
  }
  get P(){ return this.app.park; }
  say(t, kind){ this.app.ui.toast(t, kind); }

  set(kind, opts = {}){
    this.cancel();
    this.kind = kind; this.opts = { ...this.defaults(kind), ...opts };
    this.clearGhost(); this.B.clearGhost(); this.R && this.R.clearGhost(); this.cells.count = 0;
    this.B.updateCut();
    this.app.terrain.uniforms.gridShow.value = ['path', 'lot', 'land', 'terrain'].includes(kind) ? 1 : 0;
    this.app.terrain.uniforms.landShow.value = kind === 'land' ? 1 : 0;
    this.brush.w = 0;
    this.app.ui.refresh();
  }
  defaults(kind){
    return { path: { surface: 1, width: 2, mode: 'brush', queue: false }, terrain: { mode: 'raise', size: 6, ground: 0 }, water: { mode: 'add', size: 6 },
      land: { mode: 'paint', size: 6, land: this.P.s.lands.length ? 1 : 0 }, place: { type: 'oak', scatter: false }, fence: { type: 'railing' }, bulldoze: { size: 2 }, bedit: { mode: 'rooms', level: 0, style: 'window', extra: 'tower' } }[kind] || {};
  }
  get brushSize(){ return this.kind === 'path' ? this.opts.width : this.opts.size || 4; }
  usesDrag(){ return !['select', 'cedit', 'redit'].includes(this.kind); }

  // --- the pointer -----
  hover(p){
    this.last = p;
    if (this.kind === 'building') return this.B.placeHover(p);
    if (this.kind === 'coaster' || this.kind === 'ride') return this.R.hover(p);
    if (this.kind === 'drawride') return;
    if (this.kind === 'bedit') return;
    if (!p){ this.brush.w = 0; if (this.ghost) this.ghost.visible = false; return; }
    if (this.stroke) return;
    const k = this.kind;
    if (k === 'terrain' || k === 'water' || k === 'land' || k === 'bulldoze' || (k === 'path' && this.opts.mode !== 'area')){
      this.brush.set(p.x, p.z, k === 'path' ? this.opts.width * CELL / 2 : this.opts.size, 1);
    } else this.brush.w = 0;
    if (k === 'place' || k === 'arch' || k === 'sign' || k === 'move' || k === 'stall' || k === 'fwsite') this.showGhost(p);
    if (k === 'path' && this.opts.mode !== 'brush'){ this.previewCells(this.lineCells(p, p)); }
    if (k === 'lot') this.previewCells(this.rectCells(p, p, true), true);
  }
  down(p){
    this.cancel();
    if (this.kind === 'bedit'){ this.B.editDown(p); return; }
    if (this.kind === 'drawride'){ this.R.drawDown(p); return; }
    if (!p) return;
    this.last = p;
    const k = this.kind, P = this.P;
    if (k === 'select') return;
    this.stroke = { start: p, prev: p, moved: 0, t: 0 };
    if (k === 'path'){ P.begin(this.opts.mode === 'erase' ? 'Remove path' : this.opts.surface === ROAD ? 'Road' : this.opts.queue ? 'Queue' : 'Path'); if (this.opts.mode === 'brush' || this.opts.mode === 'erase') this.pathBrush(p, p); else this.previewCells(this.lineCells(p, p)); }
    else if (k === 'terrain' || k === 'water' || k === 'land'){ P.begin({ terrain: 'Landscaping', water: this.opts.mode === 'add' ? 'Water' : 'Drain water', land: 'Paint land' }[k]); this.stroke.level = k === 'water' ? this.lowestUnder(p) : P.groundAt(p.x, p.z); this.brushAt(p, 1 / 30); }
    else if (k === 'bulldoze'){ P.begin('Bulldoze'); this.bulldozeAt(p, true); }
    else if (k === 'fence'){ this.stroke.fence = true; }
    else if (k === 'lot'){ this.previewCells(this.rectCells(p, p, true), true); }
    else if (k === 'place' && this.opts.scatter){ P.begin('Plant trees'); this.scatter(p); }
    else this.showGhost(p);
  }
  move(p){
    if (!p) return;
    this.last = p;
    if (this.kind === 'bedit'){ this.B.editMove(); return; }
    if (this.kind === 'drawride'){ this.R.drawMove(p); return; }
    const s = this.stroke;
    if (!s){ this.hover(p); return; }
    s.moved += Math.hypot(p.x - s.prev.x, p.z - s.prev.z);
    const k = this.kind;
    if (k === 'path'){ if (this.opts.mode === 'brush' || this.opts.mode === 'erase') this.pathBrush(s.prev, p); else if (this.opts.mode === 'area') this.previewCells(this.rectCells(s.start, p)); else this.previewCells(this.lineCells(s.start, p)); this.brush.set(p.x, p.z, this.opts.width * CELL / 2, this.opts.mode === 'area' ? 0 : 1); }
    else if (k === 'terrain' || k === 'water' || k === 'land' || k === 'bulldoze') this.brush.set(p.x, p.z, this.opts.size, 1);
    // brushes fill in along the stroke (a fast finger mustn't leave gaps)
    if (k === 'land' || k === 'water' || k === 'bulldoze'){
      const L = Math.hypot(p.x - s.prev.x, p.z - s.prev.z), step = Math.max(0.5, (this.opts.size || 3) / 2), n = Math.max(1, Math.ceil(L / step));
      for (let i = 1; i <= n; i++){ const q = { x: s.prev.x + (p.x - s.prev.x) * i / n, z: s.prev.z + (p.z - s.prev.z) * i / n, y: p.y }; if (k === 'bulldoze') this.bulldozeAt(q, false); else this.brushAt(q, 0); }
    }
    if (k === 'place' && this.opts.scatter){ if (Math.hypot(p.x - s.prev.x, p.z - s.prev.z) > 2.5) this.scatter(p); else return; }
    else if (k === 'place' || k === 'arch' || k === 'sign' || k === 'move' || k === 'stall' || k === 'fwsite') this.showGhost(p);
    if (k === 'coaster' || k === 'ride') this.R.hover(p);
    if (k === 'fence') this.previewFence(s.start, p);
    if (k === 'lot') this.previewCells(this.rectCells(s.start, p, true), true);
    s.prev = p;
  }
  frame(dt){
    const s = this.stroke;
    if (s && this.kind === 'terrain' && this.last) this.brushAt(this.last, dt);
  }
  up(p){
    if (this.kind === 'bedit'){ this.B.editUp(); return; }
    if (this.kind === 'drawride'){ this.R.drawUp(p); return; }
    const s = this.stroke; if (!s) return;
    p = p || this.last || s.start;
    this.stroke = null;
    const k = this.kind, P = this.P;
    if (k === 'path'){
      if (this.opts.mode === 'line' || this.opts.mode === 'area'){ this.layCells(this.opts.mode === 'area' ? this.rectCells(s.start, p) : this.lineCells(s.start, p)); }
      this.cells.count = 0; this.finish();
    } else if (k === 'terrain' || k === 'water' || k === 'land' || k === 'bulldoze') this.finish();
    else if (k === 'place'){ if (this.opts.scatter) this.finish(); else this.placeAt(p); }
    else if (k === 'move') this.placeAt(p);
    else if (k === 'arch') this.placeArch(p);
    else if (k === 'sign') this.placeSign(p);
    else if (k === 'fence') this.placeFence(s.start, p);
    else if (k === 'lot'){ this.placeLot(s.start, p); this.cells.count = 0; }
    else if (k === 'building') this.B.placeUp(p);
    else if (k === 'coaster' || k === 'ride') this.R.up(p);
    else if (k === 'stall') this.placeStall(p);
    else if (k === 'fwsite'){ const why = this.app.objects.canPlace('fireworks', p.x, p.z); if (why) this.say(why, 'bad'); else { this.P.begin('Fireworks site'); const o = this.P.addObject({ type: 'fireworks', x: round(p.x), z: round(p.z), r: 0, style: 'peony' }); this.finish(); this.app.select(o.id); this.say('Fireworks go up from here at 9 pm. Tap it to choose their style, or to try them now.', 'good'); } }
  }
  cancel(){
    if (this.kind === 'bedit') this.B.editCancel();
    if (this.kind === 'drawride' && this.R) this.R.drawCancel();
    if (this.kind === 'building' && this.stroke){ this.stroke = null; return; }
    if (this.stroke){ this.stroke = null; this.P.cancel(); this.cells.count = 0; if (this.ghost && this.kind === 'fence') this.clearGhost(); }
  }
  finish(){ const r = this.P.commit(); this.app.ui.refresh(); return r; }

  // --- paths -----
  // the first of w cells centred on x (so a 2-cell path drawn along a cell edge sits either side of it)
  static first(x, w){ return Math.round((x + HALF) / CELL - w / 2); }
  cellsInBrush(x, z, w){
    const out = [], i0 = Tools.first(x, w), j0 = Tools.first(z, w);
    for (let dj = 0; dj < w; dj++) for (let di = 0; di < w; di++) out.push([i0 + di, j0 + dj]);
    return out;
  }
  pathBrush(a, b){
    const L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / 0.7)), seen = new Set(), cells = [];
    for (let t = 0; t <= n; t++){
      const x = a.x + (b.x - a.x) * t / n, z = a.z + (b.z - a.z) * t / n;
      for (const c of this.cellsInBrush(x, z, this.opts.width)){ const key = c[0] + ',' + c[1]; if (!seen.has(key)){ seen.add(key); cells.push(c); } }
    }
    this.layCells(cells, true);
  }
  // straight from a to b along whichever axis it mostly goes (a corner if both), w wide
  lineCells(a, b){
    const w = this.opts.width, out = [];
    const horiz = Math.abs(b.x - a.x) >= Math.abs(b.z - a.z);
    // the first leg runs along the main direction, centred on the start; the second (if any) turns the corner
    if (horiz){
      const j0 = Tools.first(a.z, w), i0 = cellOf(a.x), i1 = cellOf(b.x), c0 = Tools.first(b.x, w), j1 = cellOf(b.z);
      for (let i = Math.min(i0, i1); i <= Math.max(i0, i1); i++) for (let d = 0; d < w; d++) out.push([i, j0 + d]);
      for (let j = Math.min(j0, j1); j <= Math.max(j0 + w - 1, j1); j++) for (let d = 0; d < w; d++) if (Math.abs(b.z - a.z) > CELL) out.push([c0 + d, j]);
    } else {
      const i0 = Tools.first(a.x, w), j0 = cellOf(a.z), j1 = cellOf(b.z), c0 = Tools.first(b.z, w), i1 = cellOf(b.x);
      for (let j = Math.min(j0, j1); j <= Math.max(j0, j1); j++) for (let d = 0; d < w; d++) out.push([i0 + d, j]);
      for (let i = Math.min(i0, i1); i <= Math.max(i0 + w - 1, i1); i++) for (let d = 0; d < w; d++) if (Math.abs(b.x - a.x) > CELL) out.push([i, c0 + d]);
    }
    return out;
  }
  rectCells(a, b, even){
    let i0 = cellOf(Math.min(a.x, b.x)), i1 = cellOf(Math.max(a.x, b.x)), j0 = cellOf(Math.min(a.z, b.z)), j1 = cellOf(Math.max(a.z, b.z));
    if (even){ i1 = Math.max(i1, i0 + 5); j1 = Math.max(j1, j0 + 5); }
    const out = []; for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) out.push([i, j]);
    return out;
  }
  previewCells(cells, lot){
    const m = new THREE.Matrix4(), P = this.P; let n = 0, bad = false;
    for (const [i, j] of cells){
      if (n >= 6000) break;
      if (!P.editable(i, j)){ bad = true; continue; }
      const x = cellX(i), z = cellX(j);
      m.makeTranslation(x, Math.max(P.floorAt(x, z), P.waterAt(x, z) || -1e9) + 0.3, z);
      this.cells.setMatrixAt(n++, m);
    }
    if (lot) bad = bad || !!this.lotProblem(cells);
    this.cells.count = n; this.cells.instanceMatrix.needsUpdate = true;
    this.cellMat.color.set(bad ? 0xe07070 : this.opts.mode === 'erase' ? 0xe0a060 : 0x7ad07a);
  }
  // lay (or erase) path cells; trees and rocks in the way are cleared
  layCells(cells, live){
    const P = this.P, S = P.s, erase = this.opts.mode === 'erase', s = this.opts.surface, q = this.opts.queue && s !== ROAD ? QUEUE : 0;
    const blocked = [];
    let changed = false;
    for (const [i, j] of cells){
      if (!P.editable(i, j)) continue;
      const k = j * N + i;
      if (erase){ changed = P.setCell('path', i, j, 0) || changed; P.setCell('pflags', i, j, 0); continue; }
      const x = cellX(i), z = cellX(j);
      if (this.inStructure(x, z)){ blocked.push('struct'); continue; }
      changed = P.setCell('path', i, j, s) || changed; P.setCell('pflags', i, j, q);
      // clear things that can't stand on a path
      for (const o of S.objects.slice()){
        if (!CATALOG[o.type] || model(o.type).onPath) continue;
        if (Math.abs(o.x - x) < 1.4 && Math.abs(o.z - z) < 1.4) P.removeObject(o.id);
      }
      void k;
    }
    if (blocked.length && !live) this.say('The path stops at buildings, the car park and the entrance.');
    return changed;
  }
  inStructure(x, z, noBuildings, ignore){
    if (!noBuildings){ const b = this.app.objects.buildingAt(x, z); if (b && b.id !== ignore) return b; }
    // rides: a flat ride's circle, a coaster's station
    if (this.app.rides) for (const it of this.app.rides.items.values()){
      const o = it.o; if (o.id === ignore) continue;
      if (o.type === 'ride' && DRAWN[o.kind]){ if ((o.pts || []).some(([px, pz]) => Math.abs(px - x) < 3 && Math.abs(pz - z) < 3)) return o; continue; }
      if (o.type === 'ride' && Math.hypot(x - o.x, z - o.z) < flatRadius(o)) return o;
      if (o.type === 'coaster' && stationCells(o).some(([cx, cz]) => Math.abs(cx - x) <= 1 && Math.abs(cz - z) <= 1)) return o;
    }
    for (const o of this.P.s.objects){
      if (o.type === 'lot' && Math.abs(x - o.x) < o.w && Math.abs(z - o.z) < o.d) return o;
      if (o.type === 'gate'){ const c = Math.cos(o.r || 0), s = Math.sin(o.r || 0), lx = (x - o.x) * c - (z - o.z) * s, lz = (x - o.x) * s + (z - o.z) * c; if (Math.abs(lz) < 2.6 && Math.abs(lx) > 3 && Math.abs(lx) < 18) return o; }
    }
    return null;
  }

  // --- terrain, water, lands: brushes -----
  brushAt(p, dt){
    const P = this.P, S = P.s, k = this.kind, R = this.opts.size, m = this.opts.mode;
    const ci0 = Math.max(4, cellOf(p.x - R) - 1), ci1 = Math.min(N - 5, cellOf(p.x + R) + 1), cj0 = Math.max(4, cellOf(p.z - R) - 1), cj1 = Math.min(N - 5, cellOf(p.z + R) + 1);
    if (k === 'land'){
      const L = m === 'erase' ? 0 : this.opts.land;
      if (!L && m !== 'erase'){ if (!this.stroke.told){ this.stroke.told = true; this.say('Make a land first: tap "New land".'); } return; }
      for (let j = cj0; j <= cj1; j++) for (let i = ci0; i <= ci1; i++) if (Math.hypot(cellX(i) - p.x, cellX(j) - p.z) <= R) P.setCell('zone', i, j, L);
      return;
    }
    if (k === 'water'){
      // water stays level: it fills to just below the lowest ground where the stroke began, and won't
      // climb a hill (rather than carving a trench up it)
      const L = this.stroke.level - 0.3, H = S.heights;
      // (judged by a cell's highest corner: lowering the water's edge mustn't let the next cell up the hill in, a step at a time)
      const highCorner = (i, j) => Math.max(H[vtx(i, j)], H[vtx(i + 1, j)], H[vtx(i, j + 1)], H[vtx(i + 1, j + 1)]);
      for (let j = cj0; j <= cj1; j++) for (let i = ci0; i <= ci1; i++){
        const d = Math.hypot(cellX(i) - p.x, cellX(j) - p.z);
        if (d > R || this.inStructure(cellX(i), cellX(j))) continue;
        if (m === 'drain'){ P.setCell('water', i, j, NaN); continue; }
        if (Number.isNaN(S.water[j * N + i]) && highCorner(i, j) > L + 1.2){ if (!this.stroke.told){ this.stroke.told = true; this.say('Water stays level, so it can\'t climb the hill. Lower the ground there first (Land → Lower).'); } continue; }
        if (P.setCell('water', i, j, L)){ const cx = cellX(i), cz = cellX(j); for (const o of S.objects.slice()) if (CATALOG[o.type] && Math.abs(o.x - cx) <= 1 && Math.abs(o.z - cz) <= 1) P.removeObject(o.id); }
      }
      if (m === 'add'){
        const wet = (ii, jj) => ii >= 0 && jj >= 0 && ii < N && jj < N && !Number.isNaN(S.water[jj * N + ii]);
        const ring = (i, j) => { let n = 0; for (const [di, dj] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) if (wet(i + di, j + dj)) n++; return n; };
        for (let j = cj0 - 1; j <= cj1 + 2; j++) for (let i = ci0 - 1; i <= ci1 + 2; i++){
          const x = -HALF + i * CELL, z = -HALF + j * CELL, d = Math.hypot(x - p.x, z - p.z);
          if (d > R + 2 * CELL || i < 5 || j < 5 || i > N - 5 || j > N - 5) continue;
          const n = ring(i, j), h = H[vtx(i, j)];
          if (n === 4){ const target = L - 0.5 - 1.2 * smooth(1 - d / (R + CELL)); if (h > target) P.setHeight(i, j, target); }   // the bed
          else if (n > 0){ if (h > L - 0.05) P.setHeight(i, j, L - 0.05); }                                                    // the water's edge, just under its surface
          else {
            // one corner further out: halfway down to the water, so the bank slopes instead of standing up like a wall
            let near = false; for (const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) if (ring(i + di, j + dj) > 0) near = true;
            if (near && h > L + 0.6 && !this.nearStructure(x, z)) P.setHeight(i, j, h + (L + 0.6 - h) * 0.5);
          }
        }
      }
      return;
    }
    // terrain
    if (m === 'paint'){
      for (let j = cj0; j <= cj1; j++) for (let i = ci0; i <= ci1; i++) if (Math.hypot(cellX(i) - p.x, cellX(j) - p.z) <= R) P.setCell('paint', i, j, this.opts.ground);
      return;
    }
    if (!dt) return;
    const rate = 3.5 * dt, H = S.heights, lvl = this.stroke.level;
    const vi0 = Math.max(5, Math.floor((p.x - R + HALF) / CELL)), vi1 = Math.min(N - 5, Math.ceil((p.x + R + HALF) / CELL));
    const vj0 = Math.max(5, Math.floor((p.z - R + HALF) / CELL)), vj1 = Math.min(N - 5, Math.ceil((p.z + R + HALF) / CELL));
    const before = m === 'smooth' ? Float32Array.from(H) : null;
    for (let j = vj0; j <= vj1; j++) for (let i = vi0; i <= vi1; i++){
      const x = -HALF + i * CELL, z = -HALF + j * CELL, d = Math.hypot(x - p.x, z - p.z);
      if (d > R) continue;
      if (this.inStructure(x, z) || this.nearStructure(x, z)) continue;
      const f = smooth(1 - d / R), h = H[vtx(i, j)];
      let nh = h;
      if (m === 'raise') nh = h + rate * f;
      else if (m === 'lower') nh = h - rate * f;
      else if (m === 'flatten') nh = h + (lvl - h) * Math.min(1, 6 * dt * (0.3 + f));
      else if (m === 'smooth'){ const B = before, avg = (B[vtx(i - 1, j)] + B[vtx(i + 1, j)] + B[vtx(i, j - 1)] + B[vtx(i, j + 1)]) / 4; nh = h + (avg - h) * Math.min(1, 8 * dt * f); }
      P.setHeight(i, j, clamp(nh, -20, 60));
    }
  }
  // the lowest ground under the brush (where water would settle)
  lowestUnder(p){
    const R = this.opts.size || 4, H = this.P.s.heights; let lo = 1e9;
    for (let j = cellOf(p.z - R); j <= cellOf(p.z + R) + 1; j++) for (let i = cellOf(p.x - R); i <= cellOf(p.x + R) + 1; i++){
      if (i < 0 || j < 0 || i > N || j > N) continue;
      if (Math.hypot(-HALF + i * CELL - p.x, -HALF + j * CELL - p.z) <= R) lo = Math.min(lo, H[vtx(i, j)]);
    }
    return lo < 1e8 ? lo : this.P.groundAt(p.x, p.z);
  }
  nearStructure(x, z){
    // (a ground corner: any of the four cells round it under a building)
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) if (this.app.objects.buildingAt(x + dx, z + dz)) return true;
    for (const o of this.P.s.objects){
      if (o.type === 'lot' && Math.abs(x - o.x) < o.w + 2.5 && Math.abs(z - o.z) < o.d + 2.5) return true;
      if (o.type === 'gate' && Math.abs(x - o.x) < 20 && Math.abs(z - o.z) < 5) return true;
    }
    return false;
  }

  // --- placing things -----
  showGhost(p){
    const type = this.kind === 'fwsite' ? 'fireworks' : this.kind === 'arch' ? 'arch' : this.kind === 'sign' ? 'sign' : this.kind === 'move' ? this.P.obj(this.opts.id)?.type : this.opts.type;
    if (!type) return;
    if (this.ghostType !== type){
      this.clearGhost();
      this.ghost = new THREE.Group(); this.ghostType = type;
      if (CATALOG[type]) for (const part of model(type).parts) this.ghost.add(new THREE.Mesh(part.geo, this.ghostOk));
      else {
        const H = type === 'arch' ? 6.5 : type === 'sign' ? 2.6 : type === 'lot' ? 0.3 : 3;
        const W = type === 'arch' ? 9 : 2.4;
        const g = new THREE.BoxGeometry(W, H, type === 'arch' ? 0.8 : 0.3); g.translate(0, H / 2, 0);
        this.ghost.add(new THREE.Mesh(g, this.ghostOk)); this.ghost.userData.own = g;
      }
      this.ghost.renderOrder = 7;
      this.app.scene.add(this.ghost);
    }
    const g = this.ghost; g.visible = true;
    let x = p.x, z = p.z, r = this.rot;
    if (type === 'arch'){ const a = this.archFit(p); if (a){ x = a.x; z = a.z; r = a.r; g.scale.set(a.w / 8, 1, 1); } }
    const o = this.kind === 'move' ? this.P.obj(this.opts.id) : null;
    g.position.set(x, this.P.floorAt(x, z), z); g.rotation.y = this.kind === 'move' ? (o ? o.r || 0 : 0) + this.rot : r;
    if (o && o.s) g.scale.setScalar(o.s);
    const why = type === 'arch' ? (this.archFit(p) ? null : 'x') : CATALOG[type] ? this.app.objects.canPlace(type, x, z, { ignore: this.opts.id }) : null;
    const m = why ? this.ghostBad : this.ghostOk;
    g.traverse((c) => { if (c.isMesh) c.material = m; });
  }
  clearGhost(){
    if (this.ghost){ this.app.scene.remove(this.ghost); if (this.ghost.userData.own) this.ghost.userData.own.dispose(); this.ghost.traverse((c) => { if (c.geometry && !c.geometry.userData.shared) c.geometry.dispose(); }); }
    this.ghost = null; this.ghostType = null;
  }
  placeAt(p){
    const P = this.P;
    if (this.kind === 'move'){
      const o = P.obj(this.opts.id); if (!o) return this.set('select');
      if (o.type === 'gate' || o.type === 'lot' || isStructure(o.type)){ /* moved whole */ }
      const why = CATALOG[o.type] || o.type === 'stall' ? this.app.objects.canPlace(o.type, p.x, p.z, { ignore: o.id, s: o.s }) : null;
      if (why) return this.say(why, 'bad');
      P.begin('Move ' + objName(o).toLowerCase()); P.changeObject(o.id, { x: p.x, z: p.z, r: (o.r || 0) + this.rot }); this.finish();
      this.rot = 0;
      this.app.select(o.id);
      return this.set('select');
    }
    const type = this.opts.type, why = this.app.objects.canPlace(type, p.x, p.z);
    if (why) return this.say(why, 'bad');
    const tree = CATALOG[type].cat === 'trees';
    const o = { type, x: round(p.x), z: round(p.z), r: tree ? Math.random() * 6.28 : this.rot, s: tree ? 0.85 + Math.random() * 0.35 : 1 };
    if (CATALOG[type].colors) o.color = this.opts.color || CATALOG[type].colors[0];
    P.begin('Place ' + CATALOG[type].name.toLowerCase()); P.addObject(o); this.finish();
    this.app.audio && this.app.audio.click();
  }
  scatter(p){
    const type = this.opts.type, tries = 4;
    for (let k = 0; k < tries; k++){
      const a = Math.random() * 6.28, d = Math.sqrt(Math.random()) * 6, x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      if (this.app.objects.canPlace(type, x, z)) continue;
      this.P.addObject({ type, x: round(x), z: round(z), r: Math.random() * 6.28, s: 0.75 + Math.random() * 0.5 });
      break;
    }
  }
  // an arch fits across a path: find the path's width there and which way it runs
  archFit(p){
    const P = this.P, S = P.s, i = cellOf(p.x), j = cellOf(p.z);
    if (!P.inMap(i, j) || !S.path[j * N + i]) return null;
    const isP = (ii, jj) => P.inMap(ii, jj) && S.path[jj * N + ii];
    let l = i, r = i; while (isP(l - 1, j) && r - l < 6) l--; while (isP(r + 1, j) && r - l < 6) r++;
    let u = j, d = j; while (isP(i, u - 1) && d - u < 6) u--; while (isP(i, d + 1) && d - u < 6) d++;
    const wx = r - l + 1, wz = d - u + 1;
    if (Math.min(wx, wz) > 5) return null;
    // the path runs along the longer way: the arch spans the shorter
    if (wx <= wz) return { x: -HALF + (l + r + 1) / 2 * CELL, z: cellX(j), r: 0, w: wx * CELL };
    return { x: cellX(i), z: -HALF + (u + d + 1) / 2 * CELL, r: Math.PI / 2, w: wz * CELL };
  }
  placeArch(p){
    const a = this.archFit(p);
    if (!a) return this.say('Arches go across a path (up to 10 m wide). Tap on a path.', 'bad');
    const L = this.P.s.zone[cellOf(p.z) * N + cellOf(p.x)] || this.opts.land || 0;
    if (!L) return this.say('Paint a land here first (Lands), then put its arch across the path into it.', 'bad');
    this.P.begin('Land arch'); const o = this.P.addObject({ type: 'arch', x: a.x, z: a.z, r: a.r, w: a.w, land: L }); this.finish();
    this.app.select(o.id);
  }
  placeStall(p){
    const why = this.app.objects.canPlace('stall', p.x, p.z);
    if (why) return this.say(why, 'bad');
    const bp = this.opts.bp && (this.app.blueprints || []).find((d) => d.id === this.opts.bp);
    const o = bp ? JSON.parse(JSON.stringify(bp.data)) : newStall(this.opts.kind || 'kiosk');
    if (!bp && o.kind !== 'info'){ const th = (this.P.landAt(p.x, p.z) || {}).theme || 'main'; o.name = o.sells === 'gifts' ? shopName() : foodName(th); }
    // facing the nearest path (unless you've turned it yourself)
    let r = this.rot;
    if (!r && !this.P.pathAt(p.x, p.z)){ let best = 1e9; for (let dx = -6; dx <= 6; dx += 2) for (let dz = -6; dz <= 6; dz += 2){ if (!this.P.pathAt(p.x + dx, p.z + dz)) continue; const d = dx * dx + dz * dz; if (d < best){ best = d; r = Math.atan2(dx, dz); } } }
    Object.assign(o, { type: 'stall', x: round(p.x), z: round(p.z), r });
    this.P.begin('Build ' + (bp ? bp.name : 'a stall')); const added = this.P.addObject(o); this.finish();
    this.app.select(added.id);
    this.app.audio && this.app.audio.click();
  }
  placeSign(p){
    const why = this.app.objects.canPlace('sign', p.x, p.z);
    if (why) return this.say(why, 'bad');
    this.app.ui.askName({ title: 'What should the sign say?', value: 'Welcome', suggest: null }).then((name) => {
      if (!name) return;
      this.P.begin('Sign'); const o = this.P.addObject({ type: 'sign', x: round(p.x), z: round(p.z), r: this.rot, name, color: '#173826' }); this.finish();
      this.app.select(o.id);
    });
  }
  previewFence(a, b){
    this.clearGhost();
    const L = Math.hypot(b.x - a.x, b.z - a.z); if (L < 0.5) return;
    const g = new THREE.BoxGeometry(L, FENCES[this.opts.type].h, 0.3); g.translate(0, FENCES[this.opts.type].h / 2, 0);
    this.ghost = new THREE.Mesh(g, this.ghostOk); this.ghost.userData.own = g; this.ghostType = 'fence';
    this.ghost.position.set((a.x + b.x) / 2, this.P.floorAt((a.x + b.x) / 2, (a.z + b.z) / 2), (a.z + b.z) / 2);
    this.ghost.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);
    this.app.scene.add(this.ghost);
  }
  placeFence(a, b){
    this.clearGhost();
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    if (L < 1) return this.say('Drag from where the fence starts to where it ends.');
    this.P.begin(FENCES[this.opts.type].name); this.P.addObject({ type: 'fence_' + this.opts.type, x: round(a.x), z: round(a.z), x2: round(b.x), z2: round(b.z), r: 0 }); this.finish();
  }
  lotProblem(cells){
    const P = this.P, S = P.s;
    for (const [i, j] of cells){
      if (!P.editable(i, j)) return 'A car park has to be inside the park.';
      const k = j * N + i;
      if (S.path[k]) return 'Car parks can\'t go over paths: put the car park beside the path.';
      if (!Number.isNaN(S.water[k])) return 'Not on water.';
      if (this.inStructure(cellX(i), cellX(j))) return 'That overlaps the car park or the entrance.';
    }
    return null;
  }
  placeLot(a, b){
    const cells = this.rectCells(a, b, true), why = this.lotProblem(cells);
    if (why) return this.say(why, 'bad');
    const P = this.P, S = P.s;
    let i0 = 1e9, j0 = 1e9, i1 = -1, j1 = -1; for (const [i, j] of cells){ i0 = Math.min(i0, i); j0 = Math.min(j0, j); i1 = Math.max(i1, i); j1 = Math.max(j1, j); }
    const w = i1 - i0 + 1, d = j1 - j0 + 1, cx = -HALF + (i0 + w / 2) * CELL, cz = -HALF + (j0 + d / 2) * CELL;
    P.begin('Car park');
    // level the ground under it (to its average height), and clear trees
    let sum = 0, n = 0; for (let j = j0; j <= j1 + 1; j++) for (let i = i0; i <= i1 + 1; i++){ sum += S.heights[vtx(i, j)]; n++; }
    const lvl = sum / n;
    for (let j = j0 - 2; j <= j1 + 3; j++) for (let i = i0 - 2; i <= i1 + 3; i++){
      const inside = i >= i0 && i <= i1 + 1 && j >= j0 && j <= j1 + 1, h = S.heights[vtx(i, j)];
      if (inside) P.setHeight(i, j, lvl); else { const dd = Math.max(i0 - i, i - i1 - 1, j0 - j, j - j1 - 1); P.setHeight(i, j, h + (lvl - h) * (dd === 1 ? 0.66 : 0.33)); }
    }
    for (const o of S.objects.slice()) if (CATALOG[o.type] && Math.abs(o.x - cx) < w + 1 && Math.abs(o.z - cz) < d + 1) P.removeObject(o.id);
    const o = P.addObject({ type: 'lot', x: cx, z: cz, r: 0, w, d, name: 'Car Park ' + (S.objects.filter((q) => q.type === 'lot').length + 1) });
    this.finish();
    this.app.select(o.id);
    this.say(`A car park with room for ${w * d > 0 ? Math.floor((w * 2 - 2) / 2.5) * Math.max(1, Math.floor((d * 2) / 12) * 2) : 0} cars. Join it to a road and a path.`);
  }

  // --- bulldozing -----
  bulldozeAt(p, first){
    const P = this.P, R = this.opts.size;
    if (first){
      // a tap on something: that one thing (structures too, but not the entrance)
      const hit = this.app.pickAt ? this.app.pickAt() : null;
      if (hit){
        if (hit.type === 'gate'){ this.say('The park needs its entrance: you can move it instead (tap it with Select).', 'bad'); return; }
        P.removeObject(hit.id); this.stroke.hit = true; return;
      }
    }
    for (const o of P.s.objects.slice()){
      if (o.type === 'gate') continue;
      if (o.type === 'lot' || o.type === 'arch' || o.type === 'sign' || o.type.startsWith('fence_')) continue;
      if (Math.hypot(o.x - p.x, o.z - p.z) < R) P.removeObject(o.id);
    }
    if (this.opts.paths !== false) for (let j = cellOf(p.z - R); j <= cellOf(p.z + R); j++) for (let i = cellOf(p.x - R); i <= cellOf(p.x + R); i++){
      if (!P.editable(i, j) || Math.hypot(cellX(i) - p.x, cellX(j) - p.z) > R) continue;
      P.setCell('path', i, j, 0); P.setCell('pflags', i, j, 0);
    }
  }
}
const round = (v) => Math.round(v * 20) / 20;
export { SURFACES };
