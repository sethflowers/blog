// The world: blocky terrain, trees, rocks, flowers, the weapon table, chopping posts, the shooting
// range, the mirror shed and the sky. Static things are merged into a handful of meshes.
import * as THREE from 'three';
import { BoxBuilder, blockMaterial, vnoise, hash2, rng, COL, textCanvas, wrapText } from './util.js';

export const SIZE = 512;          // the world is SIZE x SIZE one-metre cells, centred on the origin
const HALF = SIZE / 2;
export const STEP = 0.55;         // the highest ledge you can walk up
export const WATER = -0.1;        // lakes fill everything below this
export const EDGE = 205;          // past this the mountains start; vehicles stop here

// Places on the map, shared with the rest of the game.
export const PLACES = {
  table: { x: 0, z: -1.5, w: 1.7, d: 0.7, h: 0.85 },
  mirror: { x: -4.2, z: -1.2, w: 2.2, h: 2.3 },        // mirror on the shed's east face (plane x = mirror.x)
  shed: { x0: -8.4, x1: -4.2, z0: -3.6, z1: 1.2, h: 3.0 },
  posts: [ { x: 3.6, z: 0.2 }, { x: 3.9, z: -1.4 }, { x: 4.2, z: -3.0 }, { x: 3.0, z: -4.4 } ],
  range: { z: -11, x0: -3.2, x1: 3.2, h: 1.05 },
  pond: { x: -9, z: 9, r: 3.6 },
  meadow: { x: -3, z: 14 },
  yard: { x: 12, z: 5, r: 7.5 },
  clear: { x: -1.9, z: -0.6 },
  sign: { x: 1.8, z: -0.9 },
};

// ----- height map -----
const heights = new Float32Array(SIZE * SIZE);
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const fbm = (x, z) => vnoise(x, z) * 0.6 + vnoise(x * 2.1 + 17, z * 2.1 - 9) * 0.28 + vnoise(x * 4.3 - 5, z * 4.3 + 31) * 0.12;
// the roads: a ring round the valley and a road from the vehicle yard out east to it
export const ROAD = { ring: 58, width: 2.6 };
export function onRoad(x, z){
  const r = Math.hypot(x, z);
  if (Math.abs(r - ROAD.ring) < ROAD.width) return true;
  if (x > 14 && x < ROAD.ring + 2 && Math.abs(z - 5) < ROAD.width) return true;
  return false;
}
function rawHeight(x, z){
  const r = Math.hypot(x, z);
  let h = 0;
  // the valley: little plateaus half a block high
  if (r > 9 && r < 19){ const n = vnoise(x * 0.12 + 40, z * 0.12 - 7); if (n > 0.66) h = 0.5; if (n > 0.8 && r > 12) h = 1.0; }
  // open country: big, gentle hills (half-block steps a truck can climb), shallow lakes in the hollows
  const w = smooth(20, 48, r);
  if (w > 0){
    let c = (fbm(x * 0.0065 + 3.1, z * 0.0065 - 7.7) - 0.36) * 24 + (vnoise(x * 0.03 + 11, z * 0.03) - 0.5) * 2.4;
    if (c < 0) c = Math.max(c * 0.3, -1.5);
    if (onRoad(x, z)) c = Math.max(c, 0) * 0.85;          // roads stay out of the water
    h = h * (1 - w) + c * w;
  }
  // mountains all round the edge
  if (r > EDGE) h = Math.max(h, 0) + Math.pow(r - EDGE, 1.35) * 0.7 + vnoise(x * 0.05, z * 0.05) * 10 * smooth(EDGE, EDGE + 30, r);
  // keep the middle flat and the pond low
  const p = PLACES.pond, pr = Math.hypot(x - p.x, z - p.z);
  if (pr < p.r) h = -0.5; else if (pr < p.r + 1.2) h = Math.min(h, 0);
  if (Math.abs(x) < 7 && z > -14 && z < 4) h = Math.min(h, 0);
  if (Math.hypot(x - PLACES.meadow.x, z - PLACES.meadow.z) < 8) h = Math.min(h, 0);
  if (Math.hypot(x - PLACES.yard.x, z - PLACES.yard.z) < PLACES.yard.r) h = Math.min(h, 0);
  return Math.round(h * 2) / 2;
}
for (let i = 0; i < SIZE; i++) for (let j = 0; j < SIZE; j++) heights[i * SIZE + j] = rawHeight(j - HALF + 0.5, i - HALF + 0.5);

export function cellHeight(ix, iz){
  if (ix < 0 || iz < 0 || ix >= SIZE || iz >= SIZE) return 80;
  return heights[iz * SIZE + ix];
}
// Terrain height under a point.
export function groundHeight(x, z){ return cellHeight(Math.floor(x + HALF), Math.floor(z + HALF)); }

// Boxes the player and loose items bump into: { x0, x1, z0, z1, y0, top }.
export const solids = [];
// Round things that move or are few (posts, vehicles, the dragon): { x, z, r, top, y0? }.
export const pillars = [];
// The thousands of tree trunks and rocks live on a grid so only nearby ones are looked at.
const GRID = 8, grid = new Map();
const gk = (gx, gz) => gx * 100003 + gz;
export function addStatic(p){ const k = gk(Math.floor(p.x / GRID), Math.floor(p.z / GRID)); let l = grid.get(k); if (!l){ l = []; grid.set(k, l); } l.push(p); }
// every round collider near (x, z): the moving ones and the trees/rocks around
// (fills and returns one shared array: use it straight away, don't keep it)
const NEAR = [];
export function nearPillars(x, z){
  NEAR.length = 0;
  for (const p of pillars) NEAR.push(p);
  const gx = Math.floor(x / GRID), gz = Math.floor(z / GRID);
  for (let a = gx - 1; a <= gx + 1; a++) for (let b = gz - 1; b <= gz + 1; b++){ const l = grid.get(gk(a, b)); if (l) for (const p of l) NEAR.push(p); }
  return NEAR;
}

// ----- blocks you build (half-metre cubes on a grid) -----
export const VOX = 0.5;
// column "i,k" -> Map(j -> type). Kept here because the ground, walls and rays all need it.
export const columns = new Map();
export const cellOf = (v) => Math.floor(v / VOX);
export function blockAt(i, j, k){ const c = columns.get(i + ',' + k); return c ? c.get(j) : undefined; }
export function setBlock(i, j, k, t){
  const key = i + ',' + k; let c = columns.get(key);
  if (t === undefined || t === null){ if (c){ c.delete(j); if (!c.size) columns.delete(key); } return; }
  if (!c){ c = new Map(); columns.set(key, c); }
  c.set(j, t);
}
// Is this point inside something solid (terrain, a block, a box like the table)?
export function solidAt(x, y, z){
  if (y < groundHeight(x, z)) return true;
  if (blockAt(cellOf(x), cellOf(y), cellOf(z)) !== undefined) return true;
  for (const s of solids) if (x > s.x0 && x < s.x1 && z > s.z0 && z < s.z1 && y < s.top && y > s.y0) return true;
  for (const p of nearPillars(x, z)) if (y < p.top && y > (p.y0 ?? -1e9) && (x - p.x) ** 2 + (z - p.z) ** 2 < p.r * p.r) return true;
  return false;
}

// Height of the highest thing (ground, table top, post, block...) under (x, z) that isn't far above y.
export function surfaceHeight(x, z, y = 1e9){
  let h = groundHeight(x, z);
  for (const s of solids) if (x > s.x0 && x < s.x1 && z > s.z0 && z < s.z1 && s.top <= y + 0.25 && s.top > h) h = s.top;
  for (const p of nearPillars(x, z)) if (p.top <= y + 0.25 && p.top > h && (x - p.x) ** 2 + (z - p.z) ** 2 < p.r * p.r) h = p.top;
  const c = columns.get(cellOf(x) + ',' + cellOf(z));
  if (c) for (const j of c.keys()){ const top = (j + 1) * VOX; if (top <= y + 0.25 && top > h) h = top; }
  return h;
}

// Pushes a circle (x, z, radius r, feet at y) out of everything solid it overlaps. Returns true if moved.
// Only things taller than maxStep above the feet count. opts.minTop / opts.maxTop limit it to obstacles
// whose tops are above / below a height (so you can lean over a table but not through a wall).
export function pushOut(pos, r, y, maxStep = STEP, opts = {}){
  let moved = false;
  const lo = Math.max(y + maxStep, opts.minTop ?? -1e9), hi = opts.maxTop ?? 1e9;
  const pushBox = (x0, x1, z0, z1) => {
    const cx = Math.max(x0, Math.min(pos.x, x1)), cz = Math.max(z0, Math.min(pos.z, z1));
    const dx = pos.x - cx, dz = pos.z - cz, d2 = dx * dx + dz * dz;
    if (d2 >= r * r) return;
    if (d2 > 1e-8){ const d = Math.sqrt(d2); pos.x = cx + dx / d * r; pos.z = cz + dz / d * r; }
    else { // centre inside: leave by the nearest side
      const o = [pos.x - x0, x1 - pos.x, pos.z - z0, z1 - pos.z], m = Math.min(...o), k = o.indexOf(m);
      if (k === 0) pos.x = x0 - r; else if (k === 1) pos.x = x1 + r; else if (k === 2) pos.z = z0 - r; else pos.z = z1 + r;
    }
    moved = true;
  };
  for (const s of solids){
    if (s.top <= lo || s.top > hi || s.y0 > y + 1.6) continue;
    pushBox(s.x0, s.x1, s.z0, s.z1);
  }
  for (const p of nearPillars(pos.x, pos.z)){
    if (p.top <= lo || p.top > hi || (p.y0 ?? -1e9) > y + 1.6 || (opts.ignore && p.owner === opts.ignore)) continue;
    const dx = pos.x - p.x, dz = pos.z - p.z, d2 = dx * dx + dz * dz, rr = r + p.r;
    if (d2 < rr * rr){ const d = Math.sqrt(d2) || 1e-4; pos.x = p.x + dx / d * rr; pos.z = p.z + dz / d * rr; moved = true; }
  }
  // built blocks: a column is a wall where it has a block between your knees and your head
  const bi = cellOf(pos.x), bk = cellOf(pos.z);
  for (let i = bi - 1; i <= bi + 1; i++) for (let k = bk - 1; k <= bk + 1; k++){
    const c = columns.get(i + ',' + k); if (!c) continue;
    let top = -1e9;
    for (const j of c.keys()){ const b = j * VOX, t = b + VOX; if (b < y + 1.6 && t > y + maxStep) top = Math.max(top, t); }
    if (top <= lo || top > hi) continue;
    pushBox(i * VOX, (i + 1) * VOX, k * VOX, (k + 1) * VOX);
  }
  // terrain ledges too high to step up: treat the cell as a wall
  const fx = Math.floor(pos.x + HALF), fz = Math.floor(pos.z + HALF);
  for (let ix = fx - 1; ix <= fx + 1; ix++) for (let iz = fz - 1; iz <= fz + 1; iz++){
    const ch = cellHeight(ix, iz);
    if (ch <= lo || ch > hi) continue;
    const x0 = ix - HALF, z0 = iz - HALF;
    const cx = Math.max(x0, Math.min(pos.x, x0 + 1)), cz = Math.max(z0, Math.min(pos.z, z0 + 1));
    const dx = pos.x - cx, dz = pos.z - cz, d2 = dx * dx + dz * dz;
    if (d2 < r * r && d2 > 1e-8){ const d = Math.sqrt(d2); pos.x = cx + dx / d * r; pos.z = cz + dz / d * r; moved = true; }
  }
  return moved;
}

// Ray against the terrain, blocks and boxes (marching), for bullets. Returns distance or Infinity.
export function rayGround(o, d, max){
  let t = 0;
  const stepLen = 0.08;
  while (t < max){
    if (solidAt(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t)) return t;
    t += stepLen;
  }
  return Infinity;
}

// ----- building it -----
export function buildWorld(scene){
  const B = new BoxBuilder(32);
  const R = rng(42);
  const trees = [], rocks = [];
  const jit = (hex, amt) => { const c = new THREE.Color(hex); const k = 1 + (R() - 0.5) * amt; c.r *= k; c.g *= k; c.b *= k; return c; };

  const pond = PLACES.pond;
  // trees in the valley (placed by hand-picked rules) and all over the open country (on a jittered grid)
  const free = (x, z) => {
    if (Math.abs(x) < 7.5 && z > -14.5 && z < 4.5) return false;
    if (Math.hypot(x - pond.x, z - pond.z) < pond.r + 1.5) return false;
    if (Math.hypot(x - PLACES.meadow.x, z - PLACES.meadow.z) < 9) return false;
    if (Math.hypot(x - PLACES.yard.x, z - PLACES.yard.z) < PLACES.yard.r + 1.5) return false;
    return true;
  };
  let tries = 0, valley = 0;
  while (valley < 40 && tries++ < 3000){
    const a = R() * Math.PI * 2, r = 8 + R() * 22;
    const x = Math.floor(Math.cos(a) * r) + 0.5, z = Math.floor(Math.sin(a) * r) + 0.5;
    if (!free(x, z) || trees.some((t) => Math.hypot(t.x - x, t.z - z) < 3.2)) continue;
    const g = groundHeight(x, z); if (g < 0 || onRoad(x, z)) continue;
    trees.push({ x, z, g, h: 3 + Math.floor(R() * 3) * 0.5, birch: R() < 0.25 }); valley++;
  }
  for (let gx = -42; gx < 42; gx++) for (let gz = -42; gz < 42; gz++){
    const x = Math.floor(gx * 6 + 1 + hash2(gx, gz) * 4) + 0.5, z = Math.floor(gz * 6 + 1 + hash2(gz + 99, gx) * 4) + 0.5;
    const r = Math.hypot(x, z);
    if (r < 31 || r > EDGE + 8) continue;
    const forest = vnoise(x * 0.018 + 50, z * 0.018 - 20);
    if (hash2(gx + 7, gz - 3) > (forest > 0.55 ? 0.85 : 0.07)) continue;
    const g = groundHeight(x, z);
    if (g < 0 || onRoad(x, z) || onRoad(x + 1.5, z) || onRoad(x - 1.5, z) || onRoad(x, z + 1.5) || onRoad(x, z - 1.5)) continue;
    let lo = g, hi = g; for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]){ const n = groundHeight(x + dx, z + dz); lo = Math.min(lo, n); hi = Math.max(hi, n); }
    if (lo < 0 || hi - lo > 0.5) continue;
    trees.push({ x, z, g, h: 3 + Math.floor(hash2(gx, gz + 5) * 4) * 0.5, birch: hash2(gx - 2, gz) < 0.22 });
  }
  for (const t of trees) addStatic({ x: t.x, z: t.z, r: 0.3, top: t.g + t.h + 2 });
  // boulders
  for (let i = 0; i < 260; i++){
    const a = R() * Math.PI * 2, r = 9 + Math.sqrt(R()) * (EDGE - 9);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!free(x, z) || onRoad(x, z) || trees.some((t) => Math.abs(t.x - x) < 2.2 && Math.abs(t.z - z) < 2.2)) continue;
    const g = groundHeight(x, z); if (g < 0) continue;
    const s = 0.6 + R() * (r > 30 ? 1.4 : 0.7);
    rocks.push({ x, z, g, s });
    addStatic({ x, z, r: s * 0.6, top: g + s - 0.05 });
  }

  // flowers and grass tufts
  for (let i = 0; i < 420; i++){
    const x = (R() - 0.5) * 50, z = (R() - 0.5) * 50;
    const g = groundHeight(x, z); if (g > 1 || g < 0) continue;
    if (Math.abs(x - PLACES.table.x) < 1.5 && Math.abs(z - PLACES.table.z) < 1.2) continue;
    if (Math.hypot(x - pond.x, z - pond.z) < pond.r + 1) continue;
    if (R() < 0.55){
      const s = 0.12 + R() * 0.12;
      B.box(x, g + s / 2, z, 0.04, s, 0.04, 0x3f8a2a, null, { skip: { ny: true, py: true } });
      B.box(x + 0.05, g + s * 0.45, z, 0.04, s * 0.7, 0.04, 0x4b9a33, null, { skip: { ny: true, py: true } });
      B.box(x - 0.03, g + s * 0.4, z + 0.04, 0.04, s * 0.6, 0.04, 0x4b9a33, null, { skip: { ny: true, py: true } });
    } else {
      const c = [0xe8473b, 0xf2d33b, 0xffffff, 0x9b5de5, 0xff8fc8][Math.floor(R() * 5)];
      B.box(x, g + 0.11, z, 0.025, 0.22, 0.025, 0x3f8a2a, null, { skip: { ny: true } });
      B.box(x, g + 0.24, z, 0.08, 0.06, 0.08, c, null, { skip: { ny: true }, ao: 0 });
    }
  }

  // ----- the weapon table -----
  const T = PLACES.table, plank = COL.plank;
  B.box(T.x, T.h - 0.04, T.z, T.w, 0.08, T.d, { all: jit(plank, 0.04), py: 0xc39a64 }, null, { ao: 0.1 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    B.box(T.x + sx * (T.w / 2 - 0.08), (T.h - 0.08) / 2, T.z + sz * (T.d / 2 - 0.08), 0.1, T.h - 0.08, 0.1, COL.plank2);
  solids.push({ x0: T.x - T.w / 2, x1: T.x + T.w / 2, z0: T.z - T.d / 2, z1: T.z + T.d / 2, y0: 0, top: T.h });

  // ----- chopping posts (a melon goes on each) -----
  for (const p of PLACES.posts){
    B.box(p.x, 0.5, p.z, 0.22, 1.0, 0.22, { all: jit(COL.trunk, 0.06), py: 0xa07a52 }, null, { ao: 0.3 });
    pillars.push({ x: p.x, z: p.z, r: 0.14, top: 1.0 });
  }
  // a straw dummy next to them is just for looks: a hay bale stack
  for (let i = 0; i < 3; i++) B.box(5.6, 0.25 + i * 0.5, -2.2 + (i % 2) * 0.1, 1.0, 0.5, 0.6, { all: 0xd8b84a, py: 0xe6c85a }, null, { ao: 0.25 });
  solids.push({ x0: 5.1, x1: 6.1, z0: -2.5, z1: -1.6, y0: 0, top: 1.5 });

  // ----- shooting range: a fence rail with bottles on it, a back-stop behind -----
  const Rg = PLACES.range;
  B.box((Rg.x0 + Rg.x1) / 2, Rg.h - 0.05, Rg.z, Rg.x1 - Rg.x0, 0.1, 0.24, { all: jit(COL.plank, 0.05), py: 0xc39a64 });
  for (let x = Rg.x0; x <= Rg.x1 + 0.01; x += (Rg.x1 - Rg.x0) / 4) B.box(x, (Rg.h - 0.1) / 2, Rg.z, 0.16, Rg.h - 0.1, 0.16, COL.plank2);
  solids.push({ x0: Rg.x0 - 0.1, x1: Rg.x1 + 0.1, z0: Rg.z - 0.12, z1: Rg.z + 0.12, y0: 0, top: Rg.h });
  // hay back-stop
  for (let i = 0; i < 7; i++) for (let j = 0; j < 2; j++) B.box(-3 + i * 1.0, 0.3 + j * 0.6, Rg.z - 3.2, 0.98, 0.6, 0.8, { all: jit(0xd8b84a, 0.1), py: 0xe6c85a }, null, { ao: 0.25 });
  solids.push({ x0: -3.5, x1: 3.5, z0: Rg.z - 3.6, z1: Rg.z - 2.8, y0: 0, top: 1.2 });

  // ----- the mirror shed -----
  const S = PLACES.shed, M = PLACES.mirror, sky = 0xbcd9f2, wall = 0.12;
  const mz0 = M.z - M.w / 2, mz1 = M.z + M.w / 2;
  const outer = jit(COL.plank, 0.05);
  // front wall (east, x = S.x1) with a hole for the mirror
  const fx = S.x1 - wall / 2;
  B.box(fx, S.h / 2, (S.z0 + mz0) / 2, wall, S.h, mz0 - S.z0, { all: outer, nx: sky });
  B.box(fx, S.h / 2, (mz1 + S.z1) / 2, wall, S.h, S.z1 - mz1, { all: outer, nx: sky });
  B.box(fx, (S.h + M.h + 0.05) / 2, M.z, wall, S.h - M.h - 0.05, M.w, { all: outer, nx: sky });
  B.box(fx, 0.025, M.z, wall, 0.05, M.w, outer);
  // mirror frame
  const frame = 0x5a3c22;
  B.box(S.x1 + 0.03, M.h + 0.09, M.z, 0.08, 0.1, M.w + 0.2, frame);
  B.box(S.x1 + 0.03, 0.05, M.z, 0.08, 0.1, M.w + 0.2, frame);
  B.box(S.x1 + 0.03, M.h / 2 + 0.05, mz0 - 0.05, 0.08, M.h + 0.1, 0.1, frame);
  B.box(S.x1 + 0.03, M.h / 2 + 0.05, mz1 + 0.05, 0.08, M.h + 0.1, 0.1, frame);
  // back and side walls; their inner faces are the "reflected" sky
  B.box(S.x0 + wall / 2, S.h / 2, (S.z0 + S.z1) / 2, wall, S.h, S.z1 - S.z0, { all: outer, px: sky });
  B.box((S.x0 + S.x1) / 2, S.h / 2, S.z0 + wall / 2, S.x1 - S.x0, S.h, wall, { all: outer, pz: sky });
  B.box((S.x0 + S.x1) / 2, S.h / 2, S.z1 - wall / 2, S.x1 - S.x0, S.h, wall, { all: outer, nz: sky });
  // floor inside looks like the meadow, the ceiling like sky; a roof on top
  B.box((S.x0 + S.x1) / 2, 0.01, (S.z0 + S.z1) / 2, S.x1 - S.x0 - 0.1, 0.02, S.z1 - S.z0 - 0.1, COL.grass, null, { ao: 0 });
  B.box((S.x0 + S.x1) / 2, S.h - 0.05, (S.z0 + S.z1) / 2, S.x1 - S.x0, 0.1, S.z1 - S.z0, { all: outer, ny: 0xcfe4f6 });
  for (let i = 0; i < 5; i++){
    const w = (S.x1 - S.x0 + 0.6) * (1 - i * 0.18);
    B.box((S.x0 + S.x1) / 2, S.h + 0.1 + i * 0.2, (S.z0 + S.z1) / 2, w, 0.2, S.z1 - S.z0 + 0.6, { all: 0xa0462e, py: 0xb4553a }, null, { ao: 0.2 });
  }
  solids.push({ x0: S.x0, x1: S.x1, z0: S.z0, z1: S.z1, y0: 0, top: S.h + 1 });

  // ----- a little fenced pen for the animals' corner -----
  const pen = { x0: 7, x1: 15, z0: -12, z1: -5 };
  const fence = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.round(len / 1.4);
    for (let i = 0; i <= n; i++){ const t = i / n; B.box(x0 + (x1 - x0) * t, 0.45, z0 + (z1 - z0) * t, 0.14, 0.9, 0.14, COL.plank2); pillars.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, r: 0.1, top: 0.9 }); }
    for (const y of [0.35, 0.72]) B.box((x0 + x1) / 2, y, (z0 + z1) / 2, Math.abs(x1 - x0) + 0.1, 0.08, Math.abs(z1 - z0) + 0.1, COL.plank);
  };
  fence(pen.x0, pen.z0, pen.x1, pen.z0);
  fence(pen.x1, pen.z0, pen.x1, pen.z1);
  fence(pen.x0, pen.z1, pen.x0 + 2.5, pen.z1);           // a gap in the near side so animals can wander out
  fence(pen.x0, pen.z0, pen.x0, pen.z1);
  // the fence rails as thin walls for the player
  solids.push({ x0: pen.x0, x1: pen.x1, z0: pen.z0 - 0.06, z1: pen.z0 + 0.06, y0: 0, top: 0.9 });
  solids.push({ x0: pen.x1 - 0.06, x1: pen.x1 + 0.06, z0: pen.z0, z1: pen.z1, y0: 0, top: 0.9 });
  solids.push({ x0: pen.x0 - 0.06, x1: pen.x0 + 0.06, z0: pen.z0, z1: pen.z1, y0: 0, top: 0.9 });
  solids.push({ x0: pen.x0, x1: pen.x0 + 2.5, z0: pen.z1 - 0.06, z1: pen.z1 + 0.06, y0: 0, top: 0.9 });
  PLACES.pen = pen;
  // a trough
  B.box(12.5, 0.2, -10.6, 1.6, 0.4, 0.5, { all: COL.plank2, py: 0x5b8fd0 });
  solids.push({ x0: 11.7, x1: 13.3, z0: -10.85, z1: -10.35, y0: 0, top: 0.4 });

  // sign posts
  const SG = PLACES.sign;
  B.box(SG.x, 0.6, SG.z, 0.1, 1.2, 0.1, COL.plank2);
  pillars.push({ x: SG.x, z: SG.z, r: 0.1, top: 1.9 });

  const mesh = new THREE.Mesh(B.build(), blockMaterial());
  mesh.matrixAutoUpdate = false;
  scene.add(mesh);

  // ----- signs with words on them -----
  const welcome = sign(1.7, 1.15, 'VR TEST  v' + (document.body.dataset.version || ''), 'Walk with the left stick, or just walk. Right stick turns. Click left stick to run.\nGrip grabs (point + grip pulls things to you). Trigger fires. Let go of a weapon by your hip to holster it.\nBUILD: rest a finger on the right trigger, pull to place, hold and sweep for rows. Right stick up/down picks the block. Left trigger or a punch breaks.\nBoth hands up: call the dragon. Touch a vehicle + grip to get in, click left stick to get out.\nA jump  B bring things back  X set height  Y snap turn');
  welcome.position.set(SG.x, 1.68, SG.z + 0.07); welcome.rotation.y = -0.35;
  scene.add(welcome);
  const mirrorSign = sign(0.9, 0.3, 'MIRROR', null);
  mirrorSign.position.set(S.x1 + 0.08, M.h + 0.38, M.z); mirrorSign.rotation.y = Math.PI / 2;
  scene.add(mirrorSign);
  const rangeSign = sign(1.0, 0.32, 'TARGETS', null);
  rangeSign.position.set(0, 1.9, Rg.z - 2.75);
  scene.add(rangeSign);

  // ----- sky dome, a square sun, drifting clouds -----
  const skyGeo = new THREE.SphereGeometry(400, 24, 12);
  const top = new THREE.Color(0x3f86e0), hor = new THREE.Color(0xc4e2fa), cols = [];
  const pa = skyGeo.attributes.position;
  for (let i = 0; i < pa.count; i++){ const t = Math.max(0, pa.getY(i) / 400); const c = hor.clone().lerp(top, Math.pow(t, 0.6)); cols.push(c.r, c.g, c.b); }
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const skyMesh = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  skyMesh.renderOrder = -10;
  scene.add(skyMesh);
  const sunDir = new THREE.Vector3(0.45, 0.75, 0.35).normalize();
  const sun = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshBasicMaterial({ color: 0xfff6c8, fog: false, depthWrite: false }));
  sun.position.copy(sunDir).multiplyScalar(350); sun.lookAt(0, 0, 0); sun.renderOrder = -9;
  scene.add(sun);

  const CB = new BoxBuilder(4);
  const cr = rng(9);
  for (let i = 0; i < 26; i++){
    const x = (cr() - 0.5) * 300, z = (cr() - 0.5) * 300, n = 2 + Math.floor(cr() * 4);
    for (let k = 0; k < n; k++) CB.box(x + k * 7 * (cr() - 0.3), 0, z + (cr() - 0.5) * 10, 10 + cr() * 14, 3, 8 + cr() * 10, 0xffffff, null, { ao: 0.05 });
  }
  const clouds = new THREE.Mesh(CB.build(), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.88, fog: false, depthWrite: false }));
  clouds.position.y = 60; clouds.renderOrder = -8;
  scene.add(clouds);

  scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x6b5a3a, 1.6));
  const dl = new THREE.DirectionalLight(0xfff1d6, 1.9); dl.position.copy(sunDir); scene.add(dl);
  scene.fog = new THREE.Fog(0xc4e2fa, 45, VIEW - 5);
  scene.background = new THREE.Color(0xc4e2fa);

  const terrain = new Terrain(scene, trees, rocks);
  return {
    terrain,
    update(dt, at){ clouds.position.x += dt * 1.2; if (clouds.position.x > 150) clouds.position.x -= 300; if (at) terrain.update(at); },
  };
}

// ----- the ground, in 32 m chunks built as you come near and dropped when you leave -----
export const VIEW = 115;                 // how far you can see (the fog closes in by then)
const CH = 32;
class Terrain {
  constructor(scene, trees, rocks){
    this.scene = scene; this.chunks = new Map();
    // trees and rocks sorted into the chunks they stand in
    this.byChunk = new Map();
    const put = (kind, o) => { const k = this.key(Math.floor((o.x + HALF) / CH), Math.floor((o.z + HALF) / CH)); let b = this.byChunk.get(k); if (!b){ b = { trees: [], rocks: [] }; this.byChunk.set(k, b); } b[kind].push(o); };
    trees.forEach((t) => put('trees', t)); rocks.forEach((r) => put('rocks', r));
    this.at = null; this.update(new THREE.Vector3(0, 0, 0), true);
  }
  key(cx, cz){ return cx * 1000 + cz; }
  // build what's in range (all of it at once when asked, else one a frame), drop what's far behind
  update(at, all = false){
    const n = SIZE / CH, want = [];
    for (let cx = 0; cx < n; cx++) for (let cz = 0; cz < n; cz++){
      const x0 = cx * CH - HALF, z0 = cz * CH - HALF;
      const dx = Math.max(x0 - at.x, 0, at.x - (x0 + CH)), dz = Math.max(z0 - at.z, 0, at.z - (z0 + CH));
      const d = Math.hypot(dx, dz), k = this.key(cx, cz), have = this.chunks.get(k);
      if (d < VIEW && !have) want.push([d, cx, cz]);
      else if (d > VIEW + 30 && have){ this.scene.remove(have); have.geometry.dispose(); this.chunks.delete(k); }
    }
    want.sort((a, b) => a[0] - b[0]);
    for (const [, cx, cz] of all ? want : want.slice(0, 1)) this.build(cx, cz);
  }
  build(cx, cz){
    const B = new BoxBuilder(32), R = rng(cx * 7919 + cz);
    const jit = (hex, amt) => { const c = new THREE.Color(hex); const k = 1 + (R() - 0.5) * amt; c.r *= k; c.g *= k; c.b *= k; return c; };
    const pond = PLACES.pond;
    const topKind = (ix, iz, h) => {
      const x = ix - HALF + 0.5, z = iz - HALF + 0.5;
      if (h >= 22) return 'snow';
      if (h >= 13) return 'stone';
      if (onRoad(x, z) && h >= 0) return 'road';
      if (h < 0 || Math.hypot(x - pond.x, z - pond.z) < pond.r + 0.9) return 'sand';
      if (h <= 0.5 && (cellHeight(ix + 1, iz) < 0 || cellHeight(ix - 1, iz) < 0 || cellHeight(ix, iz + 1) < 0 || cellHeight(ix, iz - 1) < 0)) return 'sand';
      return 'grass';
    };
    const TOP = { grass: [COL.grass, COL.grass2], sand: [COL.sand, 0xcfbf86], stone: [COL.stone, COL.stone2], snow: [COL.white, 0xe8eef2], road: [0x9a8566, 0x8f7b5d] };
    for (let iz = cz * CH; iz < (cz + 1) * CH; iz++){
      // tops: runs of the same height and kind become one long face
      let run = null;
      const flush = () => {
        if (!run) return;
        const w = run.end - run.start + 1, x = run.start - HALF + w / 2, z = iz - HALF + 0.5;
        const col = jit(TOP[run.kind][(run.start + iz) % 2 ? 1 : 0], 0.06);
        B.box(x, run.h - 0.0005, z, w, 0.001, 1, { all: col, py: col }, null, { skip: { px: true, nx: true, pz: true, nz: true, ny: true }, ao: 0 });
        run = null;
      };
      for (let ix = cx * CH; ix < (cx + 1) * CH; ix++){
        const h = cellHeight(ix, iz), kind = topKind(ix, iz, h);
        if (run && run.h === h && run.kind === kind && ix - run.start < 16 && hash2(ix, iz) > 0.12) run.end = ix;
        else { flush(); run = { start: ix, end: ix, h, kind }; }
        // sides, where a neighbour is lower: grass/dirt edge then dirt (stone up high)
        const nb = [cellHeight(ix + 1, iz), cellHeight(ix - 1, iz), cellHeight(ix, iz + 1), cellHeight(ix, iz - 1)];
        const lo = Math.min(...nb);
        if (lo < h){
          const x = ix - HALF + 0.5, z = iz - HALF + 0.5;
          const skip = { py: true, ny: true, px: nb[0] >= h, nx: nb[1] >= h, pz: nb[2] >= h, nz: nb[3] >= h };
          const rock = h >= 12, slab = kind === 'grass' ? 0.14 : 0;
          if (slab) B.box(x, h - slab / 2, z, 1, slab, 1, jit(COL.grass, 0.1), null, { skip, ao: 0.05 });
          B.box(x, (h - slab + lo) / 2, z, 1, h - slab - lo, 1, jit(rock ? COL.stone2 : COL.dirt, 0.1), null, { skip, ao: 0.3 });
        }
        // water over anything below the waterline
        if (h < 0){ const x = ix - HALF + 0.5, z = iz - HALF + 0.5; B.box(x, WATER - 0.0005, z, 1, 0.001, 1, { all: 0x3f78d0, py: (ix + iz) % 2 ? 0x3f78d0 : 0x4482d6 }, null, { skip: { px: true, nx: true, pz: true, nz: true, ny: true }, ao: 0 }); }
      }
      flush();
    }
    const stuff = this.byChunk.get(this.key(cx, cz));
    if (stuff){
      for (const t of stuff.trees){
        const trunk = t.birch ? 0xe8e4d8 : COL.trunk, leaf = t.birch ? 0x7fbf4a : COL.leaves;
        B.box(t.x, t.g + t.h / 2, t.z, 0.5, t.h, 0.5, { all: jit(trunk, 0.05), py: 0x9a7650 }, null, { ao: 0.25, skip: { ny: true } });
        // the crown: a cross of leaves, a full layer over it, a cap on top (4 boxes, few faces)
        const top = t.g + t.h - 0.2, c1 = jit(leaf, 0.15), c2 = jit(COL.leaves2, 0.15);
        B.box(t.x, top - 0.9, t.z, 2.7, 0.9, 0.9, c1, null, { ao: 0.25 });
        B.box(t.x, top - 0.9, t.z, 0.9, 0.9, 2.7, c2, null, { ao: 0.25, skip: { py: true } });
        B.box(t.x, top, t.z, 2.7, 0.9, 2.7, c2, null, { ao: 0.25 });
        B.box(t.x + (R() - 0.5) * 0.6, top + 0.9, t.z + (R() - 0.5) * 0.6, 0.9, 0.9, 0.9, c1, null, { ao: 0.2, skip: { ny: true } });
      }
      for (const r of stuff.rocks){
        B.box(r.x, r.g + r.s / 2 - 0.05, r.z, r.s * 1.3, r.s, r.s, jit(COL.stone, 0.15), null, { ao: 0.35, skip: { ny: true } });
        B.box(r.x + r.s * 0.3, r.g + r.s + r.s * 0.2 - 0.05, r.z + r.s * 0.1, r.s * 0.6, r.s * 0.4, r.s * 0.6, jit(COL.stone2, 0.1), null, { skip: { ny: true } });
      }
    }
    const mesh = new THREE.Mesh(B.build(), blockMaterial());
    mesh.matrixAutoUpdate = false;
    this.scene.add(mesh); this.chunks.set(this.key(cx, cz), mesh);
  }
}

// A wooden sign with a title and optional text, drawn once.
export function sign(w, h, title, body){
  const px = 1024, ph = Math.round(px * h / w), k = 2;
  const { ctx, tex } = textCanvas(px, ph);
  ctx.fillStyle = '#b48a55'; ctx.fillRect(0, 0, px, ph);
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  for (let y = 0; y < ph; y += 24 * k) ctx.fillRect(0, y, px, 3 * k);
  ctx.strokeStyle = '#5a3c22'; ctx.lineWidth = 12 * k; ctx.strokeRect(6 * k, 6 * k, px - 12 * k, ph - 12 * k);
  ctx.fillStyle = '#2b1a0e'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.font = `bold ${body ? 54 * k : Math.round(ph * 0.55)}px "Trebuchet MS", Helvetica, Arial, sans-serif`;
  ctx.fillText(title, px / 2, body ? 20 * k : ph * 0.2);
  if (body){
    ctx.font = `${19 * k}px "Trebuchet MS", Helvetica, Arial, sans-serif`; ctx.textAlign = 'left';
    const lines = wrapText(ctx, body, px - 56 * k);
    lines.forEach((l, i) => ctx.fillText(l, 28 * k, 82 * k + i * 24 * k));
  }
  tex.needsUpdate = true;
  const g = new THREE.Group();
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: tex }));
  face.position.z = 0.026;
  const back = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, h + 0.04, 0.05), new THREE.MeshLambertMaterial({ color: 0x6b4a2b }));
  g.add(back, face);
  return g;
}
