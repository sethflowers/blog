// The Undercroft: level layout. A maze of rooms on a tile grid, plus everything the game places in it.
// Pure data, no three.js: generateLevel(seed, levelNo) returns the grid and lists of things to build.
//
// Tiles are TILE metres square. Rooms ("cells" of the maze) sit on odd tile coordinates, with the
// tiles between them either rock or a short corridor. Around the maze is PAD tiles of solid rock, so
// the way out and the prison cells can be cut into it.

export const TILE = 2.6;
export const CEIL = 3.2;
export const HALL_CEIL = 8.0;
export const STAIR_RISE = 1.5;
export const PAD = 2;

export const T = { ROCK: 0, FLOOR: 1, STAIRS: 2, LANDING: 3, CELL: 4, WATER: 5, HALL: 6, PILLAR: 7, CRACKED: 8 };
export const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function mulberry(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export function floorOf(t){ return t === T.LANDING ? STAIR_RISE : t === T.WATER ? -1.0 : 0; }
export function ceilOf(t){ return (t === T.HALL || t === T.PILLAR) ? HALL_CEIL : (t === T.STAIRS || t === T.LANDING) ? STAIR_RISE + CEIL : CEIL; }

// breadth-first walking distance over tiles that pass(type, x, z)
export function bfs(lv, from, pass){
  const { W, g } = lv, dist = new Int32Array(W * W).fill(-1);
  const q = [from[0], from[1]]; dist[from[1] * W + from[0]] = 0;
  for (let k = 0; k < q.length; k += 2){
    const x = q[k], z = q[k + 1], d = dist[z * W + x];
    for (const [dx, dz] of DIRS){
      const a = x + dx, b = z + dz;
      if (a < 0 || b < 0 || a >= W || b >= W) continue;
      const id = b * W + a;
      if (dist[id] >= 0 || !pass(g[id], a, b)) continue;
      dist[id] = d + 1; q.push(a, b);
    }
  }
  return dist;
}

export function generateLevel(seed, levelNo){
  const rng = mulberry(seed);
  const pick = (arr) => arr[(rng() * arr.length) | 0];
  const shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--){ const j = (rng() * (i + 1)) | 0; [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };

  const n = Math.min(13, 9 + 2 * Math.floor((levelNo - 1) / 2));     // rooms per side: 9, 9, 11, 11, 13...
  const W = n * 2 + 1 + PAD * 2;
  const g = new Uint8Array(W * W);
  const TI = (i) => PAD + 1 + i * 2;                                    // room index -> tile index
  const at = (x, z) => (x < 0 || z < 0 || x >= W || z >= W) ? T.ROCK : g[z * W + x];
  const set = (x, z, v) => { g[z * W + x] = v; };
  const h0 = Math.floor(n / 2) - 1;                                     // the great hall: the middle 3 x 3 rooms
  const inHall = (i, j) => i >= h0 && i <= h0 + 2 && j >= h0 && j <= h0 + 2;

  // 1. a perfect maze (recursive backtracker) from the corner room, remembering each room's parent
  const parent = new Int32Array(n * n).fill(-1), depth = new Int32Array(n * n);
  const seen = new Uint8Array(n * n);
  const stack = [0]; seen[0] = 1; set(TI(0), TI(0), T.FLOOR);
  while (stack.length){
    const c = stack[stack.length - 1], ci = c % n, cj = (c / n) | 0;
    const opts = DIRS.filter(([dx, dz]) => { const a = ci + dx, b = cj + dz; return a >= 0 && b >= 0 && a < n && b < n && !seen[b * n + a]; });
    if (!opts.length){ stack.pop(); continue; }
    const [dx, dz] = pick(opts), a = ci + dx, b = cj + dz, k = b * n + a;
    seen[k] = 1; parent[k] = c; depth[k] = depth[c] + 1;
    set(TI(ci) + dx, TI(cj) + dz, T.FLOOR); set(TI(a), TI(b), T.FLOOR);
    stack.push(k);
  }
  // subtree sizes, and whether a subtree contains any of the hall
  const order = Array.from({ length: n * n }, (_, k) => k).sort((a, b) => depth[b] - depth[a]);
  const size = new Int32Array(n * n).fill(1), hasHall = new Uint8Array(n * n);
  for (const k of order){
    if (inHall(k % n, (k / n) | 0)) hasHall[k] = 1;
    if (parent[k] >= 0){ size[parent[k]] += size[k]; hasHall[parent[k]] |= hasHall[k]; }
  }
  const inSubtree = (k, root) => { for (let c = k; c >= 0; c = parent[c]) if (c === root) return true; return false; };
  const startRoom = 0;
  // 2. a branch cut off by deep water (needs the freeze power), and a small one walled up behind a cracked wall (needs a bomb)
  const pickBranch = (lo, hi, avoid) => {
    const c = [];
    for (let k = 1; k < n * n; k++){
      if (hasHall[k] || size[k] < lo || size[k] > hi || depth[k] < 3) continue;
      if (avoid >= 0 && (inSubtree(k, avoid) || inSubtree(avoid, k))) continue;
      c.push(k);
    }
    return c.length ? pick(c) : -1;
  };
  let waterRoot = pickBranch(8, 18, -1);
  if (waterRoot < 0) waterRoot = pickBranch(4, 30, -1);
  let crackRoot = pickBranch(3, 7, waterRoot);
  if (crackRoot < 0) crackRoot = pickBranch(2, 12, waterRoot);
  const regionOf = (k) => (waterRoot >= 0 && inSubtree(k, waterRoot)) ? 'water' : (crackRoot >= 0 && inSubtree(k, crackRoot)) ? 'crack' : 'main';
  const gateTile = (k) => { const p = parent[k]; return [(TI(k % n) + TI(p % n)) / 2, (TI((k / n) | 0) + TI((p / n) | 0)) / 2]; };

  // 3. knock through some dead ends for loops, but never across a region's edge
  for (let k = 0; k < n * n; k++){
    const i = k % n, j = (k / n) | 0, x = TI(i), z = TI(j);
    const exits = DIRS.filter(([dx, dz]) => at(x + dx, z + dz)).length;
    if (exits !== 1 || k === startRoom || rng() > 0.35) continue;
    const opts = DIRS.filter(([dx, dz]) => { const a = i + dx, b = j + dz;
      return a >= 0 && b >= 0 && a < n && b < n && !at(x + dx, z + dz) && regionOf(b * n + a) === regionOf(k); });
    if (opts.length){ const [dx, dz] = pick(opts); set(x + dx, z + dz, T.FLOOR); }
  }
  // 4. open the hall up: 5 x 5 tiles under one high vault, with four great pillars
  for (let z = TI(h0); z <= TI(h0 + 2); z++) for (let x = TI(h0); x <= TI(h0 + 2); x++) set(x, z, T.HALL);
  for (const z of [TI(h0) + 1, TI(h0 + 1) + 1]) for (const x of [TI(h0) + 1, TI(h0 + 1) + 1]) set(x, z, T.PILLAR);
  // 5. the water and the cracked wall go in last (the braiding above respected their regions)
  const waterGate = waterRoot >= 0 ? gateTile(waterRoot) : null;
  const crackGate = crackRoot >= 0 ? gateTile(crackRoot) : null;
  if (waterGate) set(waterGate[0], waterGate[1], T.WATER);
  if (crackGate) set(crackGate[0], crackGate[1], T.CRACKED);

  // which tiles you can reach from the start without crossing water or the cracked wall, and which lie beyond each
  const lv = { W, g, n };
  const walk = (t) => t === T.FLOOR || t === T.HALL || t === T.STAIRS || t === T.LANDING;
  const S = [TI(0), TI(0)];
  const mainD = bfs(lv, S, walk);
  const regionTile = new Uint8Array(W * W);                // 1 main, 2 beyond the water, 3 behind the cracked wall
  for (let k = 0; k < W * W; k++) if (mainD[k] >= 0) regionTile[k] = 1;
  const flood = (gate, label) => {
    if (!gate) return;
    for (const [dx, dz] of DIRS){
      const a = gate[0] + dx, b = gate[1] + dz;
      if (!walk(at(a, b)) || regionTile[b * W + a]) continue;
      const d = bfs(lv, [a, b], (t, x, z) => walk(t) && regionTile[z * W + x] !== 1);
      for (let k = 0; k < W * W; k++) if (d[k] >= 0 && !regionTile[k]) regionTile[k] = label;
    }
  };
  flood(waterGate, 2); flood(crackGate, 3);
  const regionAt = (x, z) => regionTile[z * W + x];
  const allD = bfs(lv, S, (t) => t !== T.ROCK && t !== T.PILLAR);   // walking distance ignoring the obstacles
  const dAt = (x, z) => allD[z * W + x];

  const rooms = [];   // every room tile with how many ways out it has
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++){
    const x = TI(i), z = TI(j), t = at(x, z);
    if (t !== T.FLOOR) continue;
    rooms.push({ x, z, exits: DIRS.filter(([dx, dz]) => walk(at(x + dx, z + dz)) || at(x + dx, z + dz) === T.WATER || at(x + dx, z + dz) === T.CRACKED).length,
      region: regionAt(x, z), d: dAt(x, z), boundary: i === 0 || j === 0 || i === n - 1 || j === n - 1, i, j });
  }
  const used = new Set();
  const key = (x, z) => x + ',' + z;
  const near = (x, z, r) => { for (const k of used){ const [a, b] = k.split(',').map(Number); if (Math.abs(a - x) + Math.abs(b - z) < r) return true; } return false; };

  // 6. the way out: the boundary room in the main region furthest to walk to, stairs cut outward from it
  let exit = null, bestD = -1;
  for (const r of rooms){
    if (!r.boundary || r.region !== 1) continue;
    for (const [dx, dz] of DIRS){
      const a = r.i + dx, b = r.j + dz;
      if (a >= 0 && b >= 0 && a < n && b < n) continue;
      const score = r.d + (r.exits === 1 ? 6 : 0);
      if (score > bestD){ bestD = score; exit = { room: [r.x, r.z], dir: [dx, dz] }; }
    }
  }
  exit.stairs = [exit.room[0] + exit.dir[0], exit.room[1] + exit.dir[1]];
  exit.landing = [exit.room[0] + exit.dir[0] * 2, exit.room[1] + exit.dir[1] * 2];
  set(exit.stairs[0], exit.stairs[1], T.STAIRS);
  set(exit.landing[0], exit.landing[1], T.LANDING);
  used.add(key(...exit.room)); used.add(key(TI(0), TI(0)));

  // 7. prison cells: a rock tile next to a room, opened up behind iron bars
  const cells = [];
  const cellSpot = (filter) => {
    const opts = [];
    for (let z = 1; z < W - 1; z++) for (let x = 1; x < W - 1; x++){
      if (at(x, z) !== T.ROCK) continue;
      for (const [dx, dz] of DIRS){
        const cx = x - dx, cz = z - dz, ct = at(cx, cz);           // the tile you stand on to see in
        if (!(ct === T.FLOOR || ct === T.HALL)) continue;
        if (DIRS.some(([ex, ez]) => at(x + ex, z + ez) === T.CELL || at(x + ex, z + ez) === T.STAIRS || at(x + ex, z + ez) === T.LANDING)) continue;
        if (!filter(cx, cz, ct)) continue;
        opts.push({ tile: [x, z], from: [cx, cz], dir: [dx, dz], score: dAt(cx, cz) + rng() * 6 });
      }
    }
    return opts;
  };
  const addCell = (opts, far) => {
    if (!opts.length) return;
    opts.sort((a, b) => far ? b.score - a.score : a.score - b.score);
    const c = opts.find((o) => !near(o.from[0], o.from[1], 6)) || opts[0];
    set(c.tile[0], c.tile[1], T.CELL); used.add(key(...c.from)); cells.push(c);
  };
  // one in the far reaches of the main maze, one beyond the water, one off the monster's hall
  addCell(cellSpot((x, z, t) => t === T.FLOOR && regionAt(x, z) === 1 && dAt(x, z) > 10 && x % 2 && z % 2), true);
  addCell(cellSpot((x, z, t) => t === T.FLOOR && regionAt(x, z) === 2), true);
  addCell(cellSpot((x, z, t) => t === T.HALL), false);
  for (let k = 1; k < levelNo && k < 3; k++) addCell(cellSpot((x, z, t) => t === T.FLOOR && regionAt(x, z) === 1 && dAt(x, z) > 6), true);

  // 8. the four power gates, in quiet rooms of the main maze, spread apart. Freeze is never behind the water.
  const gateRooms = shuffle(rooms.filter((r) => r.region === 1 && !used.has(key(r.x, r.z)) && r.d > 3))
    .sort((a, b) => (a.exits === 1 ? 0 : 1) - (b.exits === 1 ? 0 : 1));
  const gates = [];
  for (const kind of shuffle(['magnet', 'bomb', 'freeze', 'shield'])){
    const r = gateRooms.find((o) => !near(o.x, o.z, 8)) || gateRooms.find((o) => !used.has(key(o.x, o.z)));
    if (!r) break;
    // face it along the way in, so you walk through it
    const [dx, dz] = DIRS.find(([a, b]) => walk(at(r.x + a, r.z + b))) || [0, 1];
    gates.push({ kind, tile: [r.x, r.z], axis: [dx, dz] }); used.add(key(r.x, r.z));
  }
  // the bomb has to come before the cracked wall can be opened; it always does (both are in reach from the start)

  // 9. a pool: a dead-end room flooded, with something tempting on a stone in the middle (magnet it, or freeze and walk)
  let pool = null;
  const poolRoom = rooms.find((r) => r.region === 1 && r.exits === 1 && !used.has(key(r.x, r.z)) && r.d > 4 && !near(r.x, r.z, 3));
  if (poolRoom){ set(poolRoom.x, poolRoom.z, T.WATER); pool = [poolRoom.x, poolRoom.z]; used.add(key(poolRoom.x, poolRoom.z)); }

  // 10. chests: the spear out in the main maze, the crossbow beyond the water, the hammer behind the cracked wall
  const chests = [];
  const freeRoom = (region, far) => {
    const opts = rooms.filter((r) => r.region === region && !used.has(key(r.x, r.z)) && at(r.x, r.z) === T.FLOOR && !near(r.x, r.z, 4));
    if (!opts.length) return null;
    opts.sort((a, b) => far ? b.d - a.d : a.d - b.d);
    return far ? opts[(rng() * Math.min(3, opts.length)) | 0] : opts[(rng() * opts.length) | 0];
  };
  const chestAt = (r, contents) => {
    if (!r) return;
    // against a rock side of the room, lid facing into it
    const back = DIRS.filter(([dx, dz]) => at(r.x + dx, r.z + dz) === T.ROCK);
    const [dx, dz] = back.length ? pick(back) : [0, -1];
    chests.push({ tile: [r.x, r.z], back: [dx, dz], contents }); used.add(key(r.x, r.z));
  };
  chestAt(freeRoom(1, false), { weapon: 'spear' });
  chestAt(freeRoom(2, true) || freeRoom(1, true), { weapon: 'crossbow', bolts: 10 });
  chestAt(freeRoom(3, true) || freeRoom(1, true), { weapon: 'hammer', food: 'drumstick' });
  chestAt(freeRoom(1, true), { food: 'cheese', bolts: 6 });

  // 11. food lying about, a pickup of bolts or two
  const items = [];
  const foods = ['bread', 'apple', 'apple', 'cheese', 'bread', 'drumstick', 'apple', 'bread'];
  for (const f of foods){
    const r = freeRoom(rng() < 0.75 ? 1 : 2, false) || freeRoom(1, false);
    if (!r) break;
    items.push({ kind: 'food', food: f, tile: [r.x, r.z], off: [(rng() - 0.5) * 1.4, (rng() - 0.5) * 1.4] }); used.add(key(r.x, r.z));
  }
  if (pool) items.push({ kind: 'food', food: 'drumstick', tile: pool, off: [0, 0], onStone: true });

  // 12. zombies waiting in the dark, and the monster in its hall
  const zombies = [];
  const zRooms = shuffle(rooms.filter((r) => r.d > 9 && !used.has(key(r.x, r.z))));
  const zCount = 3 + levelNo;
  for (let k = 0; k < zCount && k < zRooms.length; k++){ zombies.push({ tile: [zRooms[k].x, zRooms[k].z] }); used.add(key(zRooms[k].x, zRooms[k].z)); }
  const hallCentre = [TI(h0 + 1), TI(h0 + 1)];

  const start = [TI(0), TI(0)];
  const startDir = DIRS.find(([dx, dz]) => walk(at(start[0] + dx, start[1] + dz))) || [1, 0];
  return { W, g, n, seed, levelNo, start, startDir, exit, cells, gates, chests, items, pool, zombies,
    hall: { x0: TI(h0), x1: TI(h0 + 2), centre: hallCentre }, waterGate, crackGate, regionTile };
}
