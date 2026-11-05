// The world: blocky terrain, trees, rocks, flowers, the weapon table, chopping posts, the shooting
// range, the mirror shed and the sky. Static things are merged into a handful of meshes.
import * as THREE from 'three';
import { BoxBuilder, blockMaterial, vnoise, hash2, rng, COL, textCanvas, wrapText } from './util.js';

export const SIZE = 72;           // terrain is SIZE x SIZE one-metre cells, centred on the origin
const HALF = SIZE / 2;
export const STEP = 0.55;         // the highest ledge you can walk up

// Places on the map, shared with the rest of the game.
export const PLACES = {
  table: { x: 0, z: -1.5, w: 1.7, d: 0.7, h: 0.85 },
  mirror: { x: -4.2, z: -1.2, w: 2.2, h: 2.3 },        // mirror on the shed's east face (plane x = mirror.x)
  shed: { x0: -8.4, x1: -4.2, z0: -3.6, z1: 1.2, h: 3.0 },
  posts: [ { x: 3.6, z: 0.2 }, { x: 3.9, z: -1.4 }, { x: 4.2, z: -3.0 }, { x: 3.0, z: -4.4 } ],
  range: { z: -11, x0: -3.2, x1: 3.2, h: 1.05 },
  pond: { x: -9, z: 9, r: 3.6 },
  sign: { x: 1.8, z: -0.9 },
};

// ----- height map -----
const heights = new Float32Array(SIZE * SIZE);
function rawHeight(x, z){
  const r = Math.hypot(x, z);
  let h = 0;
  // little plateaus in the meadow, half a block high
  if (r > 9 && r < 19){ const n = vnoise(x * 0.12 + 40, z * 0.12 - 7); if (n > 0.66) h = 0.5; if (n > 0.8 && r > 12) h = 1.0; }
  // hills, then a ring of cliffs you can't climb
  if (r > 18){
    const t = (r - 18) / 10;
    const n = vnoise(x * 0.09, z * 0.09) * 0.6 + vnoise(x * 0.23 + 9, z * 0.23) * 0.4;
    h = Math.max(h, t * t * 3.2 + n * t * 2.4);
  }
  if (r > 27) h = Math.max(h, 3.5 + (r - 27) * 1.0 + vnoise(x * 0.2, z * 0.2) * 2.5);
  // keep the middle flat and the pond low
  const p = PLACES.pond, pr = Math.hypot(x - p.x, z - p.z);
  if (pr < p.r) h = -0.5; else if (pr < p.r + 1.2) h = Math.min(h, 0);
  if (Math.abs(x) < 7 && z > -14 && z < 4) h = Math.min(h, 0);
  return Math.round(h * 2) / 2;
}
for (let i = 0; i < SIZE; i++) for (let j = 0; j < SIZE; j++) heights[i * SIZE + j] = rawHeight(j - HALF + 0.5, i - HALF + 0.5);

export function cellHeight(ix, iz){
  if (ix < 0 || iz < 0 || ix >= SIZE || iz >= SIZE) return 12;
  return heights[iz * SIZE + ix];
}
// Terrain height under a point.
export function groundHeight(x, z){ return cellHeight(Math.floor(x + HALF), Math.floor(z + HALF)); }

// Boxes the player and loose items bump into: { x0, x1, z0, z1, y0, top }.
export const solids = [];
// Round things (tree trunks, posts): { x, z, r, top }.
export const pillars = [];

// Height of the highest thing (ground, table top, post...) under (x, z) that isn't far above y.
export function surfaceHeight(x, z, y = 1e9){
  let h = groundHeight(x, z);
  for (const s of solids) if (x > s.x0 && x < s.x1 && z > s.z0 && z < s.z1 && s.top <= y + 0.25 && s.top > h) h = s.top;
  for (const p of pillars) if (p.top <= y + 0.25 && p.top > h && (x - p.x) ** 2 + (z - p.z) ** 2 < p.r * p.r) h = p.top;
  return h;
}

// Pushes a circle (x, z, radius r, feet at y) out of everything solid it overlaps. Returns the push.
export function pushOut(pos, r, y, maxStep = STEP){
  let moved = false;
  for (const s of solids){
    if (s.top <= y + maxStep || s.y0 > y + 1.6) continue;
    const cx = Math.max(s.x0, Math.min(pos.x, s.x1)), cz = Math.max(s.z0, Math.min(pos.z, s.z1));
    const dx = pos.x - cx, dz = pos.z - cz, d2 = dx * dx + dz * dz;
    if (d2 < r * r){
      if (d2 > 1e-8){ const d = Math.sqrt(d2); pos.x = cx + dx / d * r; pos.z = cz + dz / d * r; }
      else { // centre inside: leave by the nearest side
        const o = [pos.x - s.x0, s.x1 - pos.x, pos.z - s.z0, s.z1 - pos.z], m = Math.min(...o), k = o.indexOf(m);
        if (k === 0) pos.x = s.x0 - r; else if (k === 1) pos.x = s.x1 + r; else if (k === 2) pos.z = s.z0 - r; else pos.z = s.z1 + r;
      }
      moved = true;
    }
  }
  for (const p of pillars){
    if (p.top <= y + maxStep) continue;
    const dx = pos.x - p.x, dz = pos.z - p.z, d2 = dx * dx + dz * dz, rr = r + p.r;
    if (d2 < rr * rr){ const d = Math.sqrt(d2) || 1e-4; pos.x = p.x + dx / d * rr; pos.z = p.z + dz / d * rr; moved = true; }
  }
  // terrain ledges too high to step up: treat the cell as a wall
  const fx = Math.floor(pos.x + HALF), fz = Math.floor(pos.z + HALF);
  for (let ix = fx - 1; ix <= fx + 1; ix++) for (let iz = fz - 1; iz <= fz + 1; iz++){
    if (cellHeight(ix, iz) <= y + maxStep) continue;
    const x0 = ix - HALF, z0 = iz - HALF;
    const cx = Math.max(x0, Math.min(pos.x, x0 + 1)), cz = Math.max(z0, Math.min(pos.z, z0 + 1));
    const dx = pos.x - cx, dz = pos.z - cz, d2 = dx * dx + dz * dz;
    if (d2 < r * r && d2 > 1e-8){ const d = Math.sqrt(d2); pos.x = cx + dx / d * r; pos.z = cz + dz / d * r; moved = true; }
  }
  return moved;
}

// Ray against the terrain (marching), for bullets. Returns distance or Infinity.
export function rayGround(o, d, max){
  let t = 0;
  const stepLen = 0.1;
  while (t < max){
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    if (y < surfaceHeight(x, z, y)) return t;
    t += stepLen;
  }
  return Infinity;
}

// ----- building it -----
export function buildWorld(scene){
  const B = new BoxBuilder(32);
  const R = rng(42);
  const jit = (hex, amt) => { const c = new THREE.Color(hex); const k = 1 + (R() - 0.5) * amt; c.r *= k; c.g *= k; c.b *= k; return c; };

  // terrain: a column per cell, grass on top, dirt (or stone up high) down the sides
  const pond = PLACES.pond;
  for (let iz = 0; iz < SIZE; iz++) for (let ix = 0; ix < SIZE; ix++){
    const h = cellHeight(ix, iz);
    const x = ix - HALF + 0.5, z = iz - HALF + 0.5;
    const nb = [cellHeight(ix + 1, iz), cellHeight(ix - 1, iz), cellHeight(ix, iz + 1), cellHeight(ix, iz - 1)];
    const lo = Math.min(h - 0.5, ...nb);
    const nearPond = Math.hypot(x - pond.x, z - pond.z) < pond.r + 0.9;
    const high = h >= 5.5;
    const topCol = nearPond ? jit(COL.sand, 0.08) : (high && h >= 9) ? jit(h >= 11 ? COL.white : COL.stone, 0.1) : jit(hash2(ix, iz) > 0.5 ? COL.grass : COL.grass2, 0.12);
    const sideCol = high ? jit(COL.stone2, 0.1) : jit(COL.dirt, 0.1);
    const skip = { ny: true, px: nb[0] >= h, nx: nb[1] >= h, pz: nb[2] >= h, nz: nb[3] >= h };
    const slab = (nearPond || h >= 9) ? 0 : 0.14;
    // top layer (grass edge) then the rest of the column
    B.box(x, h - (slab || 0.001) / 2, z, 1, slab || 0.001, 1, { all: topCol, py: topCol }, null, { skip, ao: 0.05 });
    if (h - slab - lo > 0.001){
      const s2 = { ...skip, py: true };
      B.box(x, (h - slab + lo) / 2, z, 1, h - slab - lo, 1, sideCol, null, { skip: s2, ao: 0.3 });
    }
  }

  // water: one flat block, opaque so it draws the same everywhere
  B.box(pond.x, -0.12, pond.z, pond.r * 2 + 0.4, 0.04, pond.r * 2 + 0.4, jit(COL.water, 0), null, { skip: { ny: true }, ao: 0 });

  // trees
  const trees = [];
  const free = (x, z, pad) => {
    if (Math.abs(x) < 7.5 && z > -14.5 && z < 4.5) return false;
    if (Math.hypot(x - pond.x, z - pond.z) < pond.r + 1.5) return false;
    for (const t of trees) if (Math.hypot(t.x - x, t.z - z) < pad) return false;
    return true;
  };
  let tries = 0;
  while (trees.length < 46 && tries++ < 3000){
    const a = R() * Math.PI * 2, r = 8 + R() * 22;
    const x = Math.floor(Math.cos(a) * r) + 0.5, z = Math.floor(Math.sin(a) * r) + 0.5;
    if (!free(x, z, 3.2)) continue;
    const g = groundHeight(x, z); if (g > 6) continue;
    trees.push({ x, z, g, h: 3 + Math.floor(R() * 3) * 0.5, birch: R() < 0.25 });
  }
  for (const t of trees){
    const trunk = t.birch ? 0xe8e4d8 : COL.trunk, leaf = t.birch ? 0x7fbf4a : COL.leaves;
    B.box(t.x, t.g + t.h / 2, t.z, 0.5, t.h, 0.5, { all: jit(trunk, 0.05), py: 0x9a7650 }, null, { ao: 0.25 });
    const top = t.g + t.h;
    for (let dy = -1; dy <= 1; dy++){
      const rad = dy === 1 ? 0 : 1;
      for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++){
        if (rad && Math.abs(dx) + Math.abs(dz) === 2 && R() < 0.6) continue;
        if (dy === -1 && dx === 0 && dz === 0) continue;
        B.box(t.x + dx * 0.9, top + dy * 0.9 - 0.2, t.z + dz * 0.9, 0.9, 0.9, 0.9, jit(R() < 0.5 ? leaf : COL.leaves2, 0.15), null, { ao: 0.25 });
      }
    }
    pillars.push({ x: t.x, z: t.z, r: 0.3, top: t.g + t.h + 2 });
  }

  // boulders
  for (let i = 0; i < 18; i++){
    const a = R() * Math.PI * 2, r = 9 + R() * 16;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!free(x, z, 2.2)) continue;
    const g = groundHeight(x, z), s = 0.6 + R() * 0.7;
    B.box(x, g + s / 2 - 0.05, z, s * 1.3, s, s, jit(COL.stone, 0.15), null, { ao: 0.35 });
    B.box(x + s * 0.3, g + s + s * 0.2 - 0.05, z + s * 0.1, s * 0.6, s * 0.4, s * 0.6, jit(COL.stone2, 0.1));
    solids.push({ x0: x - s * 0.65, x1: x + s * 0.65, z0: z - s / 2, z1: z + s / 2, y0: g, top: g + s - 0.05 });
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
  const welcome = sign(1.5, 0.95, 'VR TEST', 'Walk with the left stick, or just walk. Turn with the right stick. Click the left stick to run.\nGrab with the side grip, fire with the trigger. Let go of a weapon by your hip to holster it.\nA: jump    B: bring everything back\nX: set my height    Y: smooth / snap turn');
  welcome.position.set(SG.x, 1.6, SG.z + 0.07); welcome.rotation.y = -0.35;
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
  scene.fog = new THREE.Fog(0xc4e2fa, 35, 110);
  scene.background = new THREE.Color(0xc4e2fa);

  return {
    update(dt){ clouds.position.x += dt * 1.2; if (clouds.position.x > 150) clouds.position.x -= 300; },
  };
}

// A wooden sign with a title and optional text, drawn once.
export function sign(w, h, title, body){
  const px = 512, ph = Math.round(px * h / w);
  const { ctx, tex } = textCanvas(px, ph);
  ctx.fillStyle = '#b48a55'; ctx.fillRect(0, 0, px, ph);
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  for (let y = 0; y < ph; y += 24) ctx.fillRect(0, y, px, 3);
  ctx.strokeStyle = '#5a3c22'; ctx.lineWidth = 12; ctx.strokeRect(6, 6, px - 12, ph - 12);
  ctx.fillStyle = '#2b1a0e'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.font = `bold ${body ? 54 : Math.round(ph * 0.55)}px "Trebuchet MS", Helvetica, Arial, sans-serif`;
  ctx.fillText(title, px / 2, body ? 22 : ph * 0.2);
  if (body){
    ctx.font = '22px "Trebuchet MS", Helvetica, Arial, sans-serif'; ctx.textAlign = 'left';
    const lines = wrapText(ctx, body, px - 56);
    lines.forEach((l, i) => ctx.fillText(l, 28, 92 + i * 28));
  }
  tex.needsUpdate = true;
  const g = new THREE.Group();
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: tex }));
  face.position.z = 0.026;
  const back = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, h + 0.04, 0.05), new THREE.MeshLambertMaterial({ color: 0x6b4a2b }));
  g.add(back, face);
  return g;
}
