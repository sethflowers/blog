// Buildings, made from a kit rather than stock models.
//
// A building is data (an object of type 'building'):
//   floors: [[ 'i,j', ... ], ...]   the rooms of each storey, cells of 2 m on the building's own grid
//                                    (a storey's cells must stand on the storey below)
//   walls:  { 'i,j,l,d': style }     the style of an outside wall (d: 0 north, 1 east, 2 south, 3 west):
//                                    plain, window, door, arch, shop, open; anything not listed is a window
//   roof:   hip | gable | flat | battlement | cone | dome     fitted to whatever the top of each part is
//   m:      { wall, base, roof, trim, floor }                 materials ('plaster#e8c8b0' = tinted)
//   timber: true for timber framing on the upper storeys
//   towers: [{ i, j, h, roof }]      round towers centred on grid corners, h storeys tall
//   extras: [{ kind: 'chimney' | 'awning' | 'sign', ... }]
// The building stands at (x, z) (its grid's corner, on the park's 2 m grid), turned by r (quarter turns).
// Its floor is level, a little above the highest ground under it, on a stone foundation.
//
// buildBuilding() turns that into geometry, built in each wall's own frame so the same wall styles
// serve every side. Convex corners get quoins (or timber posts) standing 3 cm proud, so wall ends never
// show two faces in the same place; floors, ceilings and roofs never share a plane with anything.
import * as THREE from 'three';
import { Batch, UNIT_BOX, lathe } from './util.js';
import { mat } from './materials.js';
import { resolveMat } from './models.js';
import { boardTexture } from './structures.js';
import { menuTexture, boardPlane } from './shops.js';
import { CELL } from './park.js';

export const H = 4, SLAB = 0.2, T = 0.25, WALLH = H - SLAB;
export const STYLES = [['window', 'Window'], ['plain', 'Plain'], ['door', 'Door'], ['arch', 'Arch'], ['shop', 'Shopfront'], ['open', 'Open']];
export const ROOFS = [['hip', 'Hipped'], ['gable', 'Gabled'], ['flat', 'Flat'], ['battlement', 'Battlements'], ['cone', 'Spire'], ['dome', 'Dome']];
export const MATS = {
  wall: [['plaster#efe6d4', 'Cream render'], ['plaster#e6c6aa', 'Pink render'], ['plaster#c4d4dc', 'Blue render'], ['plaster#cfd8bc', 'Sage render'], ['ashlar', 'Limestone'], ['brick', 'Brick'], ['boardwall', 'Boards'], ['marble', 'Marble'], ['rockface', 'Rough stone']],
  roof: [['slate', 'Slate'], ['tiles', 'Clay tiles'], ['shingles', 'Shingles'], ['copper', 'Copper']],
  trim: [['darkwood', 'Dark oak'], ['wood', 'Pine'], ['white', 'White'], ['iron', 'Black'], ['paint#2a5a3a', 'Green'], ['paint#7a2a2a', 'Red'], ['paint#2a3a6a', 'Blue']],
  base: [['ashlar', 'Limestone'], ['brick', 'Brick'], ['rockface', 'Rough stone'], ['stone', 'Grey stone']],
  floor: [['boards', 'Boards'], ['floortile', 'Stone flags'], ['pavers', 'Brick'], ['cobbles', 'Cobbles']],
};
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
export const key = (i, j) => i + ',' + j;
export const ekey = (i, j, l, d) => `${i},${j},${l},${d}`;
export const parse = (k) => k.split(',').map(Number);

// materials: 'plaster#e6c6aa' is plaster tinted, 'paint#2a5a3a' a painted colour
export function bmat(k){
  if (k.startsWith('paint') && !k.includes('#') && /^paint[0-9a-f]{6}$/.test(k)) return mat(k, { c: parseInt(k.slice(5), 16), r: 0.5 });
  // inside a building: the same material with a soft fill (as if from light bouncing in at the windows),
  // so rooms aren't black in the day
  if (k === 'interior') return mat('interior', { t: 'plaster', m: 3, r: 0.95, c: 0xf2ebe0, e: 0x40382c, ei: 0.55 });
  if (k.endsWith('~in')){ const b = k.slice(0, -3); return mat(b, { e: 0x2e2820, ei: 0.5 }); }
  if (k.includes('#')){ const [name, hex] = k.split('#'); return name === 'paint' ? mat('paint' + hex, { c: parseInt(hex, 16), r: 0.5 }) : mat(name + hex, { c: parseInt(hex, 16) }); }
  return resolveMat(k);
}

// --- reading a building ------------------------------------------------------------------------------
export function levelSets(o){ return o.floors.map((l) => new Set(l)); }
export function exterior(sets, i, j, l, d){ const [di, dj] = DIRS[d]; return sets[l].has(key(i, j)) && !sets[l].has(key(i + di, j + dj)); }
export function styleOf(o, i, j, l, d){ return (o.walls && o.walls[ekey(i, j, l, d)]) || 'window'; }
// the outside walls: { i, j, l, d, a: [x, z], b: [x, z], startConvex, endConvex }
export function edges(o, sets = levelSets(o)){
  const out = [];
  sets.forEach((S, l) => { for (const k of S){ const [i, j] = parse(k); for (let d = 0; d < 4; d++) if (exterior(sets, i, j, l, d)) out.push({ i, j, l, d, ...edgeEnds(i, j, d), startConvex: exterior(sets, i, j, l, (d + 3) % 4), endConvex: exterior(sets, i, j, l, (d + 1) % 4) }); } });
  return out;
}
// an edge's ends (A to B), going so that "inward" is to the right-hand side of the wall's frame
export function edgeEnds(i, j, d){
  const x0 = i * CELL, z0 = j * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
  return [{ a: [x0, z0], b: [x1, z0] }, { a: [x1, z0], b: [x1, z1] }, { a: [x1, z1], b: [x0, z1] }, { a: [x0, z1], b: [x0, z0] }][d];
}
// the wall's frame: x along the wall (0..2), y up from the storey's floor, z inward from the outer face
function frame(e, y){
  const ax = (e.b[0] - e.a[0]) / CELL, az = (e.b[1] - e.a[1]) / CELL;
  const X = new THREE.Vector3(ax, 0, az), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3().crossVectors(X, Y);
  return new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(e.a[0], y, e.a[1]);
}
export function bounds(o){
  let i0 = 1e9, j0 = 1e9, i1 = -1e9, j1 = -1e9;
  for (const k of o.floors[0] || []){ const [i, j] = parse(k); i0 = Math.min(i0, i); j0 = Math.min(j0, j); i1 = Math.max(i1, i); j1 = Math.max(j1, j); }
  for (const t of o.towers || []){ i0 = Math.min(i0, t.i - 1); j0 = Math.min(j0, t.j - 1); i1 = Math.max(i1, t.i); j1 = Math.max(j1, t.j); }
  return { i0, j0, i1, j1 };
}
// local <-> world (the building's grid turned by r about its corner)
export function toWorld(o, lx, lz){ const c = Math.cos(o.r || 0), s = Math.sin(o.r || 0); return [o.x + lx * c + lz * s, o.z - lx * s + lz * c]; }
export function toLocal(o, x, z){ const c = Math.cos(o.r || 0), s = Math.sin(o.r || 0), dx = x - o.x, dz = z - o.z; return [dx * c - dz * s, dx * s + dz * c]; }
// the park cells under the building's ground floor (and its towers)
export function groundCells(o){
  const out = [];
  for (const k of o.floors[0] || []){ const [i, j] = parse(k); out.push(toWorld(o, i * CELL + 1, j * CELL + 1)); }
  for (const t of o.towers || []) for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) out.push(toWorld(o, t.i * CELL + dx, t.j * CELL + dz));
  return out;
}
// the floor's height: 15 cm above the highest ground under the building; and the lowest ground
export function levels(o, park){
  let hi = -1e9, lo = 1e9;
  for (const k of o.floors[0] || []){ const [i, j] = parse(k); for (const [dx, dz] of [[0, 0], [2, 0], [0, 2], [2, 2]]){ const [x, z] = toWorld(o, i * CELL + dx, j * CELL + dz), g = park.groundAt(x, z); hi = Math.max(hi, g); lo = Math.min(lo, g); } }
  for (const t of o.towers || []){ const [x, z] = toWorld(o, t.i * CELL, t.j * CELL), g = park.groundAt(x, z); hi = Math.max(hi, g); lo = Math.min(lo, g); }
  if (hi < -1e8){ hi = 0; lo = 0; }
  return { floorY: hi + 0.15, lo };
}
// greedy rectangles covering a set of cells (for fitting roofs)
export function rects(cells){
  const left = new Set(cells), out = [];
  while (left.size){
    let best = null;
    for (const k of left){
      const [i, j] = parse(k);
      // grow right as far as possible, then down for each width
      let w = 0; while (left.has(key(i + w, j))) w++;
      for (let ww = 1; ww <= w; ww++){
        let h = 0; outer: while (true){ for (let x = 0; x < ww; x++) if (!left.has(key(i + x, j + h))) break outer; h++; }
        const a = ww * h, sq = Math.min(ww, h) / Math.max(ww, h);
        if (!best || a + sq * 0.01 > best.a) best = { i, j, w: ww, h, a: a + sq * 0.01 };
      }
    }
    for (let x = 0; x < best.w; x++) for (let y = 0; y < best.h; y++) left.delete(key(best.i + x, best.j + y));
    out.push(best);
  }
  return out;
}

// --- building the geometry ---------------------------------------------------------------------------------
// opts: { cut: storey to cut away above (shows inside while editing) }
export function buildBuilding(o, park, opts = {}){
  const B = new Batch(), g = new THREE.Group();
  const sets = levelSets(o), m = { wall: 'plaster#efe6d4', base: 'ashlar', roof: 'slate', trim: 'darkwood', floor: 'boards', ...(o.m || {}) };
  const cut = opts.cut ?? 99, top = Math.min(sets.length - 1, cut);
  const { floorY, lo } = levels(o, park);
  const found = lo - floorY - 0.35;   // the foundation goes this far down (relative to the floor)
  const glows = [], cols = [];
  const box = (k, M, x0, x1, y0, y1, z0, z1) => {
    const c = new THREE.Matrix4().compose(new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), new THREE.Quaternion(), new THREE.Vector3(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)));
    B.add(UNIT_BOX, k, M ? M.clone().multiply(c) : c);
  };
  const W = m.wall, I = 'interior', R = m.trim, G = 'winglass', BS = m.base;
  const timberAt = (l) => o.timber && l >= 1;
  // floors and ceilings: the ground floor on its foundation; each storey's ceiling is the next one's floor
  for (let l = 0; l <= top; l++) for (const k of sets[l]){
    const [i, j] = parse(k), x0 = i * CELL, z0 = j * CELL, y = l * H;
    if (l === 0) box(BS, null, x0, x0 + CELL, found, 0, z0, z0 + CELL);
    else box(BS, null, x0, x0 + CELL, y - SLAB, y, z0, z0 + CELL);
    box((l === 0 && m.floor === 'boards' ? 'floortile' : m.floor) + '~in', null, x0, x0 + CELL, y, y + 0.02, z0, z0 + CELL);
    // the ceiling's underside (2 cm below the slab, inside), unless this storey is cut open
    if (l !== cut) box(I, null, x0, x0 + CELL, y + WALLH - 0.02, y + WALLH, z0, z0 + CELL);
    const above = l + 1 < sets.length && sets[l + 1].has(k);
    // the ceiling (where there's a storey above, its floor slab is the ceiling); none on the storey cut open
    if (l !== cut && !above) box(BS, null, x0, x0 + CELL, y + WALLH, y + H, z0, z0 + CELL);
  }
  // the outside walls
  const posts = new Set();
  for (const e of edges(o, sets)){
    if (e.l > top) continue;
    const M = frame(e, e.l * H), st = styleOf(o, e.i, e.j, e.l, e.d), L = CELL, h = WALLH;
    const s0 = e.startConvex ? T : 0, s1 = L - (e.endConvex ? T : 0);
    const solid = (x0, x1, y0, y1) => { box(W, M, x0, x1, y0, y1, 0, T); if (st !== 'arch') box(I, M, Math.max(x0, s0), Math.min(x1, s1), y0, y1, T, T + 0.02); };
    const hole = (x0, x1, y0, y1) => { solid(0, x0, 0, h); solid(x1, L, 0, h); if (y0 > 0) solid(x0, x1, 0, y0); solid(x0, x1, y1, h); };
    const frameAround = (x0, x1, y0, y1, sill) => {
      box(R, M, x0 - 0.08, x0, y0, y1 + 0.1, -0.04, 0.06); box(R, M, x1, x1 + 0.08, y0, y1 + 0.1, -0.04, 0.06); box(R, M, x0 - 0.08, x1 + 0.08, y1, y1 + 0.1, -0.04, 0.06);
      if (sill) box(BS, M, x0 - 0.14, x1 + 0.14, y0 - 0.07, y0, -0.1, 0.06);
    };
    if (st === 'plain') solid(0, L, 0, h);
    else if (st === 'window'){
      const y0 = 0.95, y1 = 2.45;
      hole(0.5, 1.5, y0, y1); frameAround(0.5, 1.5, y0, y1, true);
      box(G, M, 0.5, 1.5, y0, y1, 0.1, 0.13);
      box(R, M, 0.98, 1.02, y0, y1, 0.07, 0.1); box(R, M, 0.5, 1.5, 1.9, 1.94, 0.07, 0.1);
    } else if (st === 'door'){
      hole(0.4, 1.6, 0, 2.5); frameAround(0.4, 1.6, 0, 2.5, false);
      // the door stands open, inward
      box(R, M, 0.4, 0.46, 0.02, 2.45, T, T + 1.15);
      if (e.l === 0) glows.push([...localPt(M, 0.15, 2.6, -0.25), 0]), box('iron', M, 0.1, 0.2, 2.45, 2.85, -0.3, -0.0), box('glow', M, 0.08, 0.22, 2.48, 2.7, -0.32, -0.18);
    } else if (st === 'shop'){
      hole(0.15, 1.85, 0.55, 2.75);
      box(G, M, 0.15, 1.85, 0.55, 2.75, 0.08, 0.11);
      for (const x of [0.72, 1.28]) box(R, M, x - 0.03, x + 0.03, 0.55, 2.75, 0.04, 0.08);
      box(R, M, 0.15, 1.85, 0.05, 0.55, -0.02, 0.1); box(R, M, 0.05, 1.95, 2.75, 3.15, -0.065, 0.06);
    } else if (st === 'arch'){
      // (the outline goes round the opening: no strip of wall left lying across the doorway)
      const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(0.3, 0); sh.lineTo(0.3, 1.9); sh.absarc(1, 1.9, 0.7, Math.PI, 0, true); sh.lineTo(1.7, 0); sh.lineTo(L, 0); sh.lineTo(L, h); sh.lineTo(0, h); sh.lineTo(0, 0);
      B.add(new THREE.ExtrudeGeometry(sh, { depth: T, bevelEnabled: false, curveSegments: 12 }), W, M.clone());
      box(BS, M, 0.88, 1.12, 2.45, 2.75, -0.04, T + 0.02);
    } else if (st === 'open'){
      box(W, M, 0, L, h - 0.4, h, 0, T);
      for (const [px, end] of [[0, e.a], [L, e.b]]){ const pk = end[0] + ',' + end[1] + ',' + e.l; if (posts.has(pk)) continue; posts.add(pk); column(B, BS, R, end[0], e.l * H, end[1], h - 0.4, M, px); }
    }
    // timber framing (upper storeys), on plain and window walls
    if (timberAt(e.l) && (st === 'plain' || st === 'window')){
      const tz0 = -0.03, tz1 = 0.0;
      box(R, M, 0, L, 0, 0.16, tz0, tz1); box(R, M, 0, L, h - 0.16, h, tz0, tz1);
      if (st === 'plain'){ box(R, M, 0.94, 1.06, 0.16, h - 0.16, tz0, tz1); const br = new THREE.Matrix4().compose(new THREE.Vector3(0.5, h / 2, -0.015), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.atan2(h - 0.32, 0.88)), new THREE.Vector3(Math.hypot(h - 0.32, 0.88), 0.11, 0.03)); B.add(UNIT_BOX, R, M.clone().multiply(br)); }
      else { box(R, M, 0.3, 0.42, 0.16, 0.95, tz0, tz1); box(R, M, 1.58, 1.7, 0.16, 0.95, tz0, tz1); }
    }
    // the base course round the ground storey (and the foundation under it), a string course between storeys
    if (e.l === 0){ box(BS, M, -0.0, L, found, 0, -0.03, T); if (st !== 'door' && st !== 'arch' && st !== 'open') box(BS, M, 0, L, 0, 0.5, -0.03, 0.02); }
    else box(timberAt(e.l) ? R : BS, M, 0, L, -SLAB, 0.02, -0.04, 0.02);
    // corners: quoins (stone) or posts (timber), 3 cm proud of both faces
    if (e.startConvex && st !== 'open'){
      const k = timberAt(e.l) ? R : BS, w = timberAt(e.l) ? 0.3 : 0.42;
      box(k, M, -0.05, w - 0.05, e.l === 0 ? found : -SLAB, h, -0.05, w - 0.05);
    }
    // a wall you can't walk through (ground storey): its solid parts
    if (e.l === 0 && st !== 'open'){
      const parts = st === 'door' ? [[0, 0.4], [1.6, L]] : st === 'arch' ? [[0, 0.3], [1.7, L]] : [[0, L]];
      for (const [x0, x1] of parts){ const p0 = localPt(M, x0, 0, 0), p1 = localPt(M, x1, 0, T); cols.push({ box: [Math.min(p0[0], p1[0]), Math.min(p0[2], p1[2]), Math.max(p0[0], p1[0]), Math.max(p0[2], p1[2])] }); }
    }
  }
  // roofs over every part with nothing above it
  for (let l = 0; l <= top; l++){
    const tops = [...sets[l]].filter((k) => !(l + 1 < sets.length && l + 1 <= top && sets[l + 1].has(k)));
    if (!tops.length || l === cut) continue;
    const y = l * H + H, style = o.roof || 'hip';
    if (style === 'flat' || style === 'battlement'){
      const ts = new Set(tops);
      for (const k of tops){ const [i, j] = parse(k); box('concrete', null, i * CELL, i * CELL + CELL, y, y + 0.03, j * CELL, j * CELL + CELL); }
      for (const k of tops){
        const [i, j] = parse(k);
        for (let d = 0; d < 4; d++){
          const [di, dj] = DIRS[d], nk = key(i + di, j + dj);
          if (ts.has(nk) || (l + 1 < sets.length && sets[l + 1].has(nk))) continue;
          const M = frame({ ...edgeEnds(i, j, d) }, y);
          box(W, M, 0, CELL, 0, 0.9, 0, T); box(BS, M, -0.04, CELL, 0.9, 1.0, -0.04, T + 0.04);
          if (style === 'battlement') for (const x of [0.25, 1.25]) box(W, M, x, x + 0.5, 1.0, 1.65, 0, T);
        }
      }
      continue;
    }
    for (const r of rects(tops)) roofOver(B, style, m.roof, W, R, r.i * CELL, r.j * CELL, (r.i + r.w) * CELL, (r.j + r.h) * CELL, y);
  }
  // round towers
  for (const t of o.towers || []){
    const x = t.i * CELL, z = t.j * CELL, hh = Math.min(t.h, top + 1) * H + 0.8, R0 = 1.7;
    B.add(new THREE.CylinderGeometry(R0, R0 + 0.12, hh - found, 24), W, new THREE.Matrix4().makeTranslation(x, (hh + found) / 2, z));
    B.add(new THREE.CylinderGeometry(R0 + 0.15, R0 + 0.15, 0.3, 24), BS, new THREE.Matrix4().makeTranslation(x, hh, z));
    for (let l = 0; l < Math.min(t.h, top + 1); l++) for (let a = 0; a < 4; a++){
      const ang = a * Math.PI / 2 + Math.PI / 4, wx = x + Math.cos(ang) * (R0 - 0.02), wz = z + Math.sin(ang) * (R0 - 0.02);
      B.add(new THREE.BoxGeometry(0.32, 1.2, 0.12), G, new THREE.Matrix4().compose(new THREE.Vector3(wx, l * H + 1.9, wz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -ang + Math.PI / 2), new THREE.Vector3(1, 1, 1)));
    }
    const tr = t.roof || 'cone';
    if (tr === 'cone') B.add(new THREE.ConeGeometry(R0 + 0.45, (R0 + 0.45) * 2.6, 24), m.roof, new THREE.Matrix4().makeTranslation(x, hh + 0.15 + (R0 + 0.45) * 1.3, z)), B.add(new THREE.SphereGeometry(0.16, 10, 8), 'gold', new THREE.Matrix4().makeTranslation(x, hh + 0.15 + (R0 + 0.45) * 2.6 + 0.1, z));
    else if (tr === 'dome') B.add(new THREE.SphereGeometry(R0 + 0.1, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), 'copper', new THREE.Matrix4().makeTranslation(x, hh + 0.15, z));
    else for (let a = 0; a < 10; a++){ const ang = a / 10 * Math.PI * 2; B.add(UNIT_BOX, W, new THREE.Matrix4().compose(new THREE.Vector3(x + Math.cos(ang) * (R0 - 0.1), hh + 0.5, z + Math.sin(ang) * (R0 - 0.1)), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -ang), new THREE.Vector3(0.3, 0.7, 0.55))); }
    cols.push({ c: [x, z], r: R0 + 0.1 });
  }
  // extras
  const own = [];
  for (const ex of o.extras || []){
    if (ex.kind === 'chimney'){
      const lv = topLevel(sets, ex.i, ex.j); if (lv < 0 || lv > top) continue;
      const x = ex.i * CELL + 1, z = ex.j * CELL + 1, y0 = lv * H + WALLH, y1 = lv * H + H + 3.4;
      box('brick', null, x - 0.35, x + 0.35, y0, y1, z - 0.35, z + 0.35); box(BS, null, x - 0.42, x + 0.42, y1, y1 + 0.15, z - 0.42, z + 0.42);
      box('iron', null, x - 0.12, x + 0.12, y1 + 0.15, y1 + 0.45, z - 0.12, z + 0.12);
    } else if (ex.kind === 'awning' || ex.kind === 'sign'){
      if (!sets[ex.l] || !exterior(sets, ex.i, ex.j, ex.l, ex.d) || ex.l > top) continue;
      const M = frame(edgeEnds(ex.i, ex.j, ex.d), ex.l * H);
      if (ex.kind === 'awning'){
        const geo = new THREE.PlaneGeometry(1.94, 1.35); geo.rotateX(Math.PI / 2 - 0.5); geo.translate(1, 2.7 - 0.33, -0.6); geo.userData.keepUV = true;
        B.add(geo, 'awning:' + (ex.color || '#1e5a3a'), M.clone());
        box('iron', M, 0.05, 0.09, 2.05, 2.7, -1.18, -1.14); box('iron', M, 1.91, 1.95, 2.05, 2.7, -1.18, -1.14);
      } else {
        const tex = boardTexture(ex.text || 'Shop', { bg: ex.color || '#173826', w: 1024, h: 256 });
        const sm = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 });
        const pm = new THREE.Mesh(new THREE.PlaneGeometry(1.86, 0.46), sm);
        pm.userData.ownMaterial = true;
        const pos = localPt(M, 1, 3.45, -0.075); pm.position.set(...pos);
        const X = new THREE.Vector3().setFromMatrixColumn(M, 0), Z = new THREE.Vector3().setFromMatrixColumn(M, 2);
        pm.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X.clone().negate(), new THREE.Vector3(0, 1, 0), Z.clone().negate()));
        own.push(pm);
        box(R, M, 0.02, 1.98, 3.17, 3.73, -0.07, 0.0);
      }
    }
  }
  // fitted out for what it's for
  const fit = o.use ? fitOut(B, o, sets, box, own, m) : null;
  // lamps inside: one hanging lamp to about every six cells of each storey
  for (let l = 0; l <= top; l++){
    const cells = [...sets[l]].map(parse), picked = cells.filter(([i, j]) => ((i % 3) + 3) % 3 === 1 && ((j % 3) + 3) % 3 === 1);
    const list = picked.length ? picked : cells.length ? [cells[Math.floor(cells.length / 2)]] : [];
    for (const [i, j] of list){
      const x = i * CELL + 1, z = j * CELL + 1, y = l * H + WALLH;
      box('brass', null, x - 0.015, x + 0.015, y - 0.6, y, z - 0.015, z + 0.015);
      B.add(new THREE.ConeGeometry(0.28, 0.22, 12, 1, true), 'brass', new THREE.Matrix4().makeTranslation(x, y - 0.68, z));
      B.add(new THREE.SphereGeometry(0.09, 10, 8), 'glow', new THREE.Matrix4().makeTranslation(x, y - 0.76, z));
      glows.push([x, y - 0.76, z, l * H + 0.02]);
    }
  }
  const body = B.build(matFor);
  body.traverse((c) => { if (c.isMesh){ c.castShadow = c.name !== 'winglass' && c.name !== 'glow'; c.receiveShadow = true; } });
  g.add(body);
  for (const p of own) g.add(p);
  g.userData = { glows, colliders: cols, floorY, building: true, fit };
  return g;
}
// the inside, fitted out for the building's use, along the back wall (the side away from the first door)
export const USES = [['', 'Nothing yet'], ['food', 'Food counter'], ['restaurant', 'Restaurant'], ['shop', 'Shop'], ['toilets', 'Toilets'], ['firstaid', 'First aid']];
function fitOut(B, o, sets, box, own, m){
  const g0 = sets[0], all = edges({ floors: [o.floors[0]] });
  const door = all.find((e) => ['door', 'shop', 'arch', 'open'].includes(styleOf(o, e.i, e.j, 0, e.d))) || all.find((e) => e.d === 2) || all[0];
  if (!door) return null;
  const back = (door.d + 2) % 4, side = [(door.d + 1) % 4, (door.d + 3) % 4];
  const backWalls = all.filter((e) => e.d === back), frontWalls = all.filter((e) => e.d === door.d && !(e.i === door.i && e.j === door.j));
  const W = (e) => frame(e, 0), out = { seats: 0, cubicles: 0, counter: 0, beds: 0 };
  const R = m.trim, use = o.use;
  if (use === 'food' || use === 'restaurant' || use === 'shop'){
    backWalls.forEach((e, k) => {
      const M = W(e);
      if (use !== 'shop' || k === 0){
        box(R, M, 0.02, 1.98, 0, 0.98, 1.0, 1.55); box('wood', M, 0, 2.0, 0.98, 1.04, 0.95, 1.6); out.counter++;
      }
      // shelves on the back wall, with things on them
      for (const y of [1.3, 1.85]){
        box('wood', M, 0.15, 1.85, y, y + 0.04, T + 0.02, T + 0.4);
        for (let n = 0; n < 5; n++){ const c = ['#c84a3a', '#e8c040', '#4a8ac8', '#5aa05a', '#f0e8d8'][(n + k + (y > 1.5 ? 2 : 0)) % 5]; B.add(UNIT_BOX, 'paint' + c.slice(1), new THREE.Matrix4().compose(new THREE.Vector3(...localPt(M, 0.3 + n * 0.32, y + 0.14, T + 0.2)), new THREE.Quaternion(), new THREE.Vector3(0.2, 0.24, 0.2))); }
      }
    });
    if (use === 'shop'){
      // a display table in the middle of the shop
      const mid = [...g0].map(parse).filter(([i, j]) => !backWalls.some((e) => e.i === i && e.j === j) && !(i === door.i && j === door.j))[0];
      if (mid){ const [i, j] = mid; box('wood', null, i * CELL + 0.5, i * CELL + 1.5, 0.7, 0.76, j * CELL + 0.5, j * CELL + 1.5); box('darkwood', null, i * CELL + 0.95, i * CELL + 1.05, 0, 0.7, j * CELL + 0.95, j * CELL + 1.05); }
    }
    // the menu board, on the back wall in the middle
    const mid = backWalls[Math.floor(backWalls.length / 2)];
    if (mid && o.menu){
      const M = W(mid), mb = boardPlane(menuTexture(o.name || '', o.menu), 1.2, 1.5);
      mb.position.set(...localPt(M, 1, 2.75, T + 0.03));
      const X = new THREE.Vector3().setFromMatrixColumn(M, 0), Z = new THREE.Vector3().setFromMatrixColumn(M, 2);
      mb.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, new THREE.Vector3(0, 1, 0), Z));
      own.push(mb);
    }
  } else if (use === 'toilets'){
    for (const e of backWalls){
      const M = W(e);
      for (const [x0, x1] of [[0, 1], [1, 2]]){
        // a cubicle: side panels, a front with its door open, the toilet against the wall
        box('white', M, x0 + 0.02, x0 + 0.06, 0.15, 2.0, T + 0.02, T + 1.45);
        box('white', M, x0 + 0.06, x0 + 0.18, 0.15, 2.0, T + 1.41, T + 1.45); box('white', M, x0 + 0.82, x1 - 0.02, 0.15, 2.0, T + 1.41, T + 1.45);
        box('paint' + '2a3a6a', M, x0 + 0.18, x0 + 0.22, 0.15, 1.95, T + 1.45, T + 2.05);
        B.add(lathe([[0, 0], [0.17, 0], [0.2, 0.38], [0.22, 0.42], [0, 0.42]], 14), 'white', M.clone().multiply(new THREE.Matrix4().makeTranslation(x0 + 0.5, 0, T + 0.4)));
        box('white', M, x0 + 0.32, x0 + 0.68, 0.42, 0.85, T + 0.02, T + 0.2);
        out.cubicles++;
      }
      box('white', M, 1.94, 2.0, 0.15, 2.0, T + 0.02, T + 1.45);
    }
    for (const e of frontWalls){
      const M = W(e);
      box('white', M, 0.6, 1.4, 0.8, 0.95, T + 0.02, T + 0.5); box('chrome', M, 0.95, 1.05, 0.95, 1.15, T + 0.05, T + 0.15); box('chrome', M, 0.6, 1.4, 1.3, 2.1, T + 0.02, T + 0.04);
    }
  } else if (use === 'firstaid'){
    for (const e of backWalls){
      const M = W(e);
      box('white', M, 0.3, 1.7, 0.45, 0.6, T + 0.1, T + 2.0); box('chrome', M, 0.3, 1.7, 0.1, 0.45, T + 0.1, T + 0.14); box('chrome', M, 0.3, 1.7, 0.1, 0.45, T + 1.96, T + 2.0);
      box('paint' + 'c8d8e8', M, 0.35, 1.65, 0.6, 0.7, T + 0.15, T + 0.5); out.beds++;
    }
  }
  return out;
}
function topLevel(sets, i, j){ let t = -1; sets.forEach((S, l) => { if (S.has(key(i, j))) t = l; }); return t; }
function localPt(M, x, y, z){ return new THREE.Vector3(x, y, z).applyMatrix4(M).toArray(); }
function column(B, base, trim, x, y, z, h){
  B.add(new THREE.CylinderGeometry(0.17, 0.2, h, 14), base, new THREE.Matrix4().makeTranslation(x, y + h / 2, z));
  B.add(UNIT_BOX, base, new THREE.Matrix4().compose(new THREE.Vector3(x, y + 0.1, z), new THREE.Quaternion(), new THREE.Vector3(0.5, 0.2, 0.5)));
  B.add(UNIT_BOX, base, new THREE.Matrix4().compose(new THREE.Vector3(x, y + h - 0.08, z), new THREE.Quaternion(), new THREE.Vector3(0.48, 0.16, 0.48)));
  void trim;
}
const awnings = new Map();
function matFor(k){
  if (k.startsWith('awning:')){
    const col = k.slice(7); let m = awnings.get(col); if (m) return m;
    const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
    for (let i = 0; i < 8; i++){ g.fillStyle = i % 2 ? '#f0e8d8' : col; g.fillRect(i * 32, 0, 32, 64); }
    g.fillStyle = 'rgba(0,0,0,.15)'; for (let i = 0; i < 8; i++){ g.beginPath(); g.arc(i * 32 + 16, 64, 16, Math.PI, 0); g.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, side: THREE.DoubleSide }); awnings.set(col, m);
    return m;
  }
  return bmat(k);
}

// a pitched roof over the rectangle x0..x1, z0..z1, its eaves at height y
function roofOver(B, style, roofMat, wallMat, trimMat, x0, z0, x1, z1, y){
  const ov = 0.35, W = x1 - x0, D = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  if (style === 'cone' || style === 'dome'){
    const rr = Math.max(W, D) / 2;
    if (style === 'cone'){ const R = rr * 1.2 + ov; B.add(new THREE.ConeGeometry(R, R * 1.9, 4 * Math.max(4, Math.round(rr * 3))), roofMat, new THREE.Matrix4().makeTranslation(cx, y + R * 0.95, cz)); B.add(new THREE.SphereGeometry(0.15, 10, 8), 'gold', new THREE.Matrix4().makeTranslation(cx, y + R * 1.9 + 0.08, cz)); }
    else { B.add(new THREE.CylinderGeometry(rr * 0.98, rr * 0.98, 0.6, 32), wallMat, new THREE.Matrix4().makeTranslation(cx, y + 0.3, cz)); B.add(new THREE.SphereGeometry(rr, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), 'copper', new THREE.Matrix4().makeTranslation(cx, y + 0.6, cz)); B.add(new THREE.SphereGeometry(0.18, 10, 8), 'gold', new THREE.Matrix4().makeTranslation(cx, y + 0.6 + rr + 0.1, cz)); }
    return;
  }
  const pitch = 0.75, along = W >= D;                   // the ridge runs the long way
  const half = (along ? D : W) / 2, rise = half * pitch, drop = ov * pitch;
  const ex0 = x0 - ov, ex1 = x1 + ov, ez0 = z0 - ov, ez1 = z1 + ov, ye = y - drop, yr = y + rise;
  const P = (x, yy, z) => new THREE.Vector3(x, yy, z);
  const faces = [];
  if (style === 'gable'){
    if (along){ faces.push([P(ex0, ye, ez1), P(ex1, ye, ez1), P(ex1, yr, cz), P(ex0, yr, cz)], [P(ex1, ye, ez0), P(ex0, ye, ez0), P(ex0, yr, cz), P(ex1, yr, cz)]); }
    else { faces.push([P(ex1, ye, ez1), P(ex1, ye, ez0), P(cx, yr, ez0), P(cx, yr, ez1)], [P(ex0, ye, ez0), P(ex0, ye, ez1), P(cx, yr, ez1), P(cx, yr, ez0)]); }
    // the gable ends, in the wall's material, flush with the walls
    // (both windings: seen from outside, and from the attic)
    const tri = (a, b, c) => { for (const q of [[a, b, c], [a, c, b]]){ const geo = new THREE.BufferGeometry().setFromPoints(q); geo.computeVertexNormals(); B.add(geo, wallMat, null); } };
    if (along) for (const x of [x0, x1]) tri(P(x, y, z0), P(x, y, z1), P(x, yr - 0.1, cz));
    else for (const z of [z0, z1]) tri(P(x0, y, z), P(x1, y, z), P(cx, yr - 0.1, z));
  } else {
    // hipped: the ridge is shortened by half the depth at each end
    if (along){
      const r0 = Math.min(cx, x0 + half), r1 = Math.max(cx, x1 - half);
      faces.push([P(ex0, ye, ez1), P(ex1, ye, ez1), P(r1, yr, cz), P(r0, yr, cz)], [P(ex1, ye, ez0), P(ex0, ye, ez0), P(r0, yr, cz), P(r1, yr, cz)],
        [P(ex1, ye, ez1), P(ex1, ye, ez0), P(r1, yr, cz)], [P(ex0, ye, ez0), P(ex0, ye, ez1), P(r0, yr, cz)]);
    } else {
      const r0 = Math.min(cz, z0 + half), r1 = Math.max(cz, z1 - half);
      faces.push([P(ex1, ye, ez1), P(ex1, ye, ez0), P(cx, yr, r0), P(cx, yr, r1)], [P(ex0, ye, ez0), P(ex0, ye, ez1), P(cx, yr, r1), P(cx, yr, r0)],
        [P(ex0, ye, ez1), P(ex1, ye, ez1), P(cx, yr, r1)], [P(ex1, ye, ez0), P(ex0, ye, ez0), P(cx, yr, r0)]);
    }
  }
  for (const f of faces){ B.add(roofFace(f, 0), roofMat, null); B.add(roofFace(f, -0.12, true), 'darkwood', null); }
  // fascia boards along the eaves
  if (style === 'gable'){ if (along){ B.box(trimMat, cx, ye - 0.08, ez0, ex1 - ex0, 0.16, 0.05); B.box(trimMat, cx, ye - 0.08, ez1, ex1 - ex0, 0.16, 0.05); } else { B.box(trimMat, ex0, ye - 0.08, cz, 0.05, 0.16, ez1 - ez0); B.box(trimMat, ex1, ye - 0.08, cz, 0.05, 0.16, ez1 - ez0); } }
}
// one roof face (3 or 4 points, counter-clockwise seen from above): UVs run along the eave and up the slope
function roofFace(pts, dy, flip){
  const p = pts.map((v) => v.clone().add(new THREE.Vector3(0, dy, 0)));
  const e = p[1].clone().sub(p[0]).normalize(), n = new THREE.Vector3().crossVectors(p[1].clone().sub(p[0]), p[2].clone().sub(p[0])).normalize();
  const up = new THREE.Vector3().crossVectors(n, e).normalize();
  const pos = [], uv = [], idx = [];
  p.forEach((v) => { pos.push(v.x, v.y, v.z); uv.push(v.dot(e), v.dot(up)); });
  if (p.length === 3) idx.push(0, 1, 2); else idx.push(0, 1, 2, 0, 2, 3);
  if (flip) for (let k = 0; k < idx.length; k += 3){ const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.computeVertexNormals(); g.userData.keepUV = true;
  return g;
}

// --- ready-made buildings (all from the same kit, so they can be changed) --------------------------------------
const rect = (w, d, i0 = 0, j0 = 0) => { const out = []; for (let j = j0; j < j0 + d; j++) for (let i = i0; i < i0 + w; i++) out.push(key(i, j)); return out; };
const front = (w, d, l, style, cols) => Object.fromEntries((cols || [...Array(w).keys()]).map((i) => [ekey(i, d - 1, l, 2), style]));
export const TEMPLATES = {
  cottage: { name: 'Cottage', theme: 'main', make: () => ({ floors: [rect(3, 2)], roof: 'gable', m: { wall: 'plaster#efe6d4', roof: 'tiles', trim: 'paint#2a5a3a', base: 'rockface' }, walls: { ...front(3, 2, 0, 'door', [1]) }, extras: [{ kind: 'chimney', i: 2, j: 0 }] }) },
  townhouse: { name: 'Townhouse', theme: 'main', make: () => ({ floors: [rect(2, 2), rect(2, 2), rect(2, 2)], roof: 'gable', timber: true, m: { wall: 'plaster#efe6d4', roof: 'tiles', trim: 'darkwood', base: 'ashlar' }, walls: { [ekey(0, 1, 0, 2)]: 'door', [ekey(1, 1, 0, 2)]: 'shop' }, extras: [{ kind: 'sign', i: 1, j: 1, l: 0, d: 2, text: 'Bakery' }] }) },
  shoprow: { name: 'Shop row', theme: 'main', make: () => ({ floors: [rect(6, 2), rect(6, 2)], roof: 'hip', m: { wall: 'brick', roof: 'slate', trim: 'paint#2a3a6a', base: 'ashlar' }, walls: { ...front(6, 2, 0, 'shop'), [ekey(1, 1, 0, 2)]: 'door', [ekey(4, 1, 0, 2)]: 'door' }, extras: [{ kind: 'awning', i: 0, j: 1, l: 0, d: 2, color: '#2a3a6a' }, { kind: 'awning', i: 2, j: 1, l: 0, d: 2, color: '#7a2a2a' }, { kind: 'awning', i: 3, j: 1, l: 0, d: 2, color: '#2a3a6a' }, { kind: 'awning', i: 5, j: 1, l: 0, d: 2, color: '#7a2a2a' }, { kind: 'chimney', i: 1, j: 0 }, { kind: 'chimney', i: 4, j: 0 }] }) },
  tavern: { name: 'Tavern', theme: 'castle', make: () => ({ floors: [rect(4, 3), rect(4, 3)], roof: 'hip', timber: true, m: { wall: 'plaster#e6c6aa', roof: 'slate', trim: 'darkwood', base: 'rockface' }, walls: { [ekey(1, 2, 0, 2)]: 'door' }, extras: [{ kind: 'sign', i: 2, j: 2, l: 0, d: 2, text: 'The Golden Goose' }, { kind: 'chimney', i: 0, j: 0 }] }) },
  guardhouse: { name: 'Gatehouse tower', theme: 'castle', make: () => ({ floors: [rect(3, 3), rect(3, 3)], roof: 'battlement', m: { wall: 'ashlar', base: 'rockface', trim: 'darkwood', roof: 'slate' }, walls: { [ekey(1, 2, 0, 2)]: 'arch', [ekey(1, 0, 0, 0)]: 'arch' }, towers: [{ i: 3, j: 3, h: 3, roof: 'cone' }] }) },
  keep: { name: 'Castle keep', theme: 'castle', make: () => ({ floors: [rect(4, 4), rect(4, 4), rect(4, 4)], roof: 'battlement', m: { wall: 'ashlar', base: 'rockface', trim: 'darkwood', roof: 'slate' }, walls: { [ekey(1, 3, 0, 2)]: 'arch', [ekey(2, 3, 0, 2)]: 'arch' }, towers: [{ i: 0, j: 0, h: 4, roof: 'cone' }, { i: 4, j: 0, h: 4, roof: 'cone' }, { i: 0, j: 4, h: 4, roof: 'cone' }, { i: 4, j: 4, h: 4, roof: 'cone' }] }) },
  pavilion: { name: 'Pavilion', theme: 'sky', make: () => ({ floors: [rect(3, 3)], roof: 'dome', m: { wall: 'marble', base: 'marble', trim: 'white', roof: 'copper' }, walls: Object.fromEntries(edges({ floors: [rect(3, 3)] }).map((e) => [ekey(e.i, e.j, 0, e.d), 'arch'])) }) },
  saloon: { name: 'Saloon', theme: 'frontier', make: () => ({ floors: [rect(4, 3), rect(4, 3)], roof: 'flat', m: { wall: 'boardwall', base: 'stone', trim: 'wood', roof: 'shingles' }, walls: { ...front(4, 3, 0, 'window'), [ekey(1, 2, 0, 2)]: 'door', [ekey(2, 2, 0, 2)]: 'door' }, extras: [{ kind: 'sign', i: 1, j: 2, l: 1, d: 2, text: 'Saloon', color: '#5a3018' }, { kind: 'awning', i: 0, j: 2, l: 0, d: 2, color: '#8a5a2a' }, { kind: 'awning', i: 3, j: 2, l: 0, d: 2, color: '#8a5a2a' }] }) },
  warehouse: { name: 'Harbour warehouse', theme: 'pirate', make: () => ({ floors: [rect(4, 3)], roof: 'gable', m: { wall: 'boardwall', base: 'rockface', trim: 'darkwood', roof: 'shingles' }, walls: { [ekey(1, 2, 0, 2)]: 'door', [ekey(2, 2, 0, 2)]: 'door' } }) },
  hut: { name: 'Woodland hut', theme: 'wood', make: () => ({ floors: [rect(2, 2)], roof: 'cone', m: { wall: 'plaster#cfd8bc', base: 'rockface', trim: 'darkwood', roof: 'shingles' }, walls: { [ekey(0, 1, 0, 2)]: 'door' } }) },
  blank: { name: 'Plain building', theme: 'main', make: () => ({ floors: [rect(2, 2)], roof: 'hip', m: { wall: 'plaster#efe6d4', roof: 'slate', trim: 'darkwood', base: 'ashlar' }, walls: { [ekey(0, 1, 0, 2)]: 'door' } }) },
};
export function fromTemplate(id){ const t = TEMPLATES[id]; return { type: 'building', tpl: id, name: t.name, walls: {}, towers: [], extras: [], ...t.make() }; }
