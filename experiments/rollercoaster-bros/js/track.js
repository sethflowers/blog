// The track: pieces joined end to end on a grid, starting and ending at the station.
//
// The ground is a grid of 8 m tiles; track heights come in 4 m levels. Every piece starts and ends on a
// grid point, level and unrolled, facing north, east, south or west, so any piece fits after any other.
// Each piece is a path in its own frame (forward f, right r, up u, in metres) plus a roll. Placed in the
// world it is sampled finely, given a smooth "up" (a rotation-minimising frame, so loops turn the
// riders upside down by themselves; banking and barrel rolls are added on top), and swept into rails.
import * as THREE from 'three';
import { V, clamp, smooth, merge, placed } from './util.js';

export const TILE = 8, LEVEL = 4, BASE_Y = 0.9, MAX_LEVEL = 12;
// the park: x from -GRID_X to GRID_X tiles, z from -GRID_N (north) to GRID_S (south)
export const GRID_X = 30, GRID_N = 24, GRID_S = 14;
const inPark = (i, j) => Math.abs(i) <= GRID_X && j >= -GRID_N && j <= GRID_S;
const inParkXZ = (x, z) => Math.abs(x) <= (GRID_X + 0.4) * TILE && z >= -(GRID_N + 0.4) * TILE && z <= (GRID_S + 0.4) * TILE;
// every coaster in the park, and the ground kept free for stations and queues
export const WORLD = { tracks: [], reserved: new Map() };
export function reserve(x0, x1, z0, z1, lo, hi){
  for (let x = x0; x <= x1; x += TILE / 4) for (let z = z0; z <= z1; z += TILE / 4) WORLD.reserved.set(key(x, z), { lo, hi });
}
export const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];          // north, east, south, west (x, z)
const PI = Math.PI;

// ---------- the pieces ----------
const turn = (R, s) => ({
  f: R, r: s * R, du: 0, dh: s,
  path: (t) => { const a = t * PI / 2, m = R * TILE; return [m * Math.sin(a), s * m * (1 - Math.cos(a)), 0]; },
  roll: (t) => s * (R === 1 ? 0.55 : 0.4) * Math.sin(PI * t),
});
const slope = (L, H) => ({
  f: L, r: 0, du: H, dh: 0, slope: true,
  path: (t) => [L * TILE * t, 0, H * LEVEL * (1 - Math.cos(PI * t)) / 2],
});
const LOOP_R = 6.5;
export const PIECES = {
  straight: { name: 'Straight', group: 'starter', fun: 0.03, f: 1, r: 0, du: 0, dh: 0, path: (t) => [TILE * t, 0, 0] },
  left: { name: 'Left turn', group: 'starter', fun: 0.12, ...turn(1, -1) },
  right: { name: 'Right turn', group: 'starter', fun: 0.12, ...turn(1, 1) },
  bigLeft: { name: 'Wide left', group: 'wide', fun: 0.12, ...turn(2, -1) },
  bigRight: { name: 'Wide right', group: 'wide', fun: 0.12, ...turn(2, 1) },
  up: { name: 'Hill up', group: 'hills', fun: 0.2, ...slope(2, 1) },
  down: { name: 'Hill down', group: 'hills', fun: 0.35, ...slope(2, -1) },
  steepUp: { name: 'Steep climb', group: 'steep', fun: 0.3, ...slope(2, 2) },
  steepDown: { name: 'Big drop', group: 'steep', fun: 0.7, ...slope(2, -2) },
  loop: {
    name: 'Loop', group: 'loop', fun: 1.4, inversions: 1, f: 2, r: 0, du: 0, dh: 0, samples: 120,
    // a vertical loop that drifts forward, and swings a little sideways so it misses itself
    path: (t) => { const a = 2 * PI * t; return [2 * TILE * t + LOOP_R * Math.sin(a), 3.5 * Math.sin(a) * Math.sin(PI * t), LOOP_R * (1 - Math.cos(a))]; },
  },
  jump: {
    name: 'Jump', group: 'jump', fun: 1.6, jumps: 1, f: 3, r: 0, du: 0, dh: 0, samples: 80,
    path: (t) => [3 * TILE * t, 0, 5.5 * (1 - Math.cos(2 * PI * t)) / 2],
    gap: (t) => t > 0.3 && t < 0.7,
  },
  roll: {
    name: 'Barrel roll', group: 'roll', fun: 1.3, inversions: 1, f: 2, r: 0, du: 0, dh: 0, samples: 90,
    // the riders' hearts stay on a straight line while the track turns round it
    path: (t) => { const a = rollAngle(t), h = 1.1; return [2 * TILE * t, -h * Math.sin(a), h * (1 - Math.cos(a))]; },
    roll: (t) => rollAngle(t),
  },
  hang: {
    name: 'Upside down', group: 'hang', fun: 1.5, inversions: 1, f: 3, r: 0, du: 0, dh: 0, samples: 120,
    // roll over, ride along upside down over a little hump, then roll the rest of the way round
    path: (t) => { const a = hangAngle(t), h = 1.1; return [3 * TILE * t, -h * Math.sin(a), 2.5 * Math.sin(PI * t) ** 2 + h * (1 - Math.cos(a))]; },
    roll: (t) => hangAngle(t),
  },
  station: { name: 'Station', group: 'none', fun: 0, f: 2, r: 0, du: 0, dh: 0, path: (t) => [2 * TILE * t, 0, 0] },
};
function rollAngle(t){ return 2 * PI * smooth((t - 0.12) / 0.76); }
function hangAngle(t){ return PI * (smooth((t - 0.05) / 0.2) + smooth((t - 0.75) / 0.2)); }
export const BUILD_ORDER = ['straight', 'left', 'right', 'bigLeft', 'bigRight', 'up', 'down', 'steepUp', 'steepDown', 'loop', 'roll', 'hang', 'jump'];
export const GROUPS = {
  starter: { name: 'Starter track', price: 0, pieces: ['straight', 'left', 'right'] },
  wide: { name: 'Wide turns', price: 150, pieces: ['bigLeft', 'bigRight'], text: 'Long sweeping curves.' },
  hills: { name: 'Hills', price: 300, pieces: ['up', 'down'], text: 'Go up, then whoosh down.' },
  steep: { name: 'Big drops', price: 800, pieces: ['steepUp', 'steepDown'], text: 'Climb high and drop fast!' },
  loop: { name: 'Loop-the-loop', price: 1500, pieces: ['loop'], text: 'Go all the way round, upside down.' },
  roll: { name: 'Barrel roll', price: 2500, pieces: ['roll'], text: 'Spin right round the track.' },
  hang: { name: 'Upside down', price: 3200, pieces: ['hang'], text: 'Roll over and ride along upside down!' },
  jump: { name: 'Jump', price: 4000, pieces: ['jump'], text: 'Fly off the track and land again!' },
};
export const COLORS = [
  { name: 'Red', rail: 0xd8302a, spine: 0x8a1e1a }, { name: 'Blue', rail: 0x2a6ad8, spine: 0x1a3a8a },
  { name: 'Green', rail: 0x2aa84a, spine: 0x1a6a2a }, { name: 'Yellow', rail: 0xf0c020, spine: 0xa07a10 },
  { name: 'Purple', rail: 0x8a3ad8, spine: 0x50208a }, { name: 'Orange', rail: 0xf07a20, spine: 0x9a4a10 },
  { name: 'Pink', rail: 0xf060a8, spine: 0xa03a70 }, { name: 'Black', rail: 0x303034, spine: 0x18181a },
];

// ---------- frames ----------
// a hanging coaster's track is this much higher, with the train hanging under it
export const HANG = 2.5;
const node = (i, j, level, lift = 0) => V(i * TILE, BASE_Y + level * LEVEL + lift, j * TILE);
// How steep the track is where two pieces join: one climb (or drop) straight after another joins into
// one long smooth slope; anything else is flat at the join.
function jointGrade(a, b){
  const A = PIECES[a], B = PIECES[b];
  if (!A || !B || !A.slope || !B.slope || Math.sign(A.du) !== Math.sign(B.du)) return 0;
  return (A.du + B.du) * LEVEL / ((A.f + B.f) * TILE);
}
const key = (x, z) => Math.round(2 * x / TILE) + ',' + Math.round(2 * z / TILE);

// Sample a piece placed at grid point (i, j, level) facing d. Returns points with position, tangent,
// up, and whether the rails are drawn there.
// opts: m0, m1 (how steep a slope starts and ends, to join up with the pieces either side), lift.
export function samplePiece(type, i, j, level, d, opts = {}){
  const P = PIECES[type];
  const F = V(DIRS[d][0], 0, DIRS[d][1]), R = V(DIRS[(d + 1) % 4][0], 0, DIRS[(d + 1) % 4][1]), Y = V(0, 1, 0);
  const O = node(i, j, level, opts.lift || 0);
  const m0 = opts.m0 || 0, m1 = opts.m1 || 0;
  let path = P.path;
  if (P.slope && (m0 || m1)){
    // a Hermite curve: right height at each end, and the steepness the neighbouring pieces want
    const Lm = P.f * TILE, H = P.du * LEVEL;
    path = (t) => [Lm * t, 0, H * (3 * t * t - 2 * t * t * t) + Lm * (m0 * (t * t * t - 2 * t * t + t) + m1 * (t * t * t - t * t))];
  }
  const at = (t) => { const [f, r, u] = path(t); return O.clone().addScaledVector(F, f).addScaledVector(R, r).addScaledVector(Y, u); };
  const n = P.samples || Math.max(12, Math.round(P.f * 14));
  const pts = [];
  for (let k = 0; k <= n; k++){
    const t = k / n, e = 1e-4;
    const pos = at(t), tan = at(Math.min(1, t + e)).sub(at(Math.max(0, t - e))).normalize();
    pts.push({ t, pos, tan, up: null, gap: P.gap ? P.gap(t) : false });
  }
  // rotation-minimising frame (double reflection), starting upright
  pts[0].up = V(0, 1, 0);
  for (let k = 0; k < n; k++){
    const a = pts[k], b = pts[k + 1];
    const v1 = b.pos.clone().sub(a.pos), c1 = v1.dot(v1);
    if (c1 < 1e-10){ b.up = a.up.clone(); continue; }
    const rL = a.up.clone().addScaledVector(v1, -2 / c1 * v1.dot(a.up));
    const tL = a.tan.clone().addScaledVector(v1, -2 / c1 * v1.dot(a.tan));
    const v2 = b.tan.clone().sub(tL), c2 = v2.dot(v2);
    b.up = c2 < 1e-10 ? rL : rL.addScaledVector(v2, -2 / c2 * v2.dot(rL));
    b.up.addScaledVector(b.tan, -b.up.dot(b.tan)).normalize();
  }
  // every piece ends upright: spread any leftover twist along it, then add banking / rolls
  const last = pts[n], want = V(0, 1, 0).addScaledVector(last.tan, -last.tan.y).normalize();
  const twist = Math.atan2(last.up.clone().cross(want).dot(last.tan), last.up.dot(want));
  for (const p of pts){
    const roll = twist * p.t + (P.roll ? P.roll(p.t) : 0);
    // positive roll tips the top of the riders toward the right
    if (roll) p.up.applyAxisAngle(p.tan, roll);
    p.side = p.tan.clone().cross(p.up).normalize();
  }
  const ni = i + DIRS[d][0] * P.f + DIRS[(d + 1) % 4][0] * P.r, nj = j + DIRS[d][1] * P.f + DIRS[(d + 1) % 4][1] * P.r;
  return { pts, m0, m1, end: { i: ni, j: nj, level: level + P.du, d: (d + P.dh + 4) % 4 } };
}

// Which ground cells (half a tile across) a piece passes over, and at what heights.
function cellsOf(pts, startKey, endKey, below = 0){
  const cells = new Map();
  for (const p of pts){
    if (p.t < 0.02 || p.t > 0.98) continue;
    const k = key(p.pos.x, p.pos.z);
    if (k === startKey || k === endKey) continue;
    const c = cells.get(k) || { lo: 1e9, hi: -1e9 };
    c.lo = Math.min(c.lo, p.pos.y - below); c.hi = Math.max(c.hi, p.pos.y); cells.set(k, c);
  }
  return cells;
}
const CLEAR = 3.4;
const clash = (a, b) => a.lo - CLEAR < b.hi && b.lo - CLEAR < a.hi;

// ---------- the track ----------
export class Track {
  // oi: which tile column (x) this coaster's station is in; it always faces north
  // hang: a hanging coaster (the track above, the train under it)
  constructor(scene, oi = 0, hang = false){
    this.scene = scene; this.oi = oi; this.hang = !!hang;
    WORLD.tracks.push(this);
    this.group = new THREE.Group(); scene.add(this.group);
    this.color = 0;
    this.mats = {
      rail: new THREE.MeshStandardMaterial({ color: COLORS[0].rail, metalness: 0.45, roughness: 0.35 }),
      spine: new THREE.MeshStandardMaterial({ color: COLORS[0].spine, metalness: 0.4, roughness: 0.45 }),
      tie: new THREE.MeshStandardMaterial({ color: 0x8a8a90, metalness: 0.5, roughness: 0.5 }),
      support: new THREE.MeshStandardMaterial({ color: 0xe8e8ec, metalness: 0.3, roughness: 0.5 }),
      ghost: new THREE.MeshBasicMaterial({ color: 0x40ff60, transparent: true, opacity: 0.45, depthWrite: false }),
      bad: new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.5, depthWrite: false }),
    };
    this.supports = null;
    this.pieces = [];
    this.reset();
    // a pulsing arrow at the end of the track, pointing where the next piece goes
    const ag = new THREE.ConeGeometry(0.9, 2.2, 4); ag.rotateX(-PI / 2);
    this.arrow = new THREE.Mesh(ag, new THREE.MeshBasicMaterial({ color: 0xffe040, transparent: true, opacity: 0.85 }));
    scene.add(this.arrow);
    this.ghost = new THREE.Group(); scene.add(this.ghost); this.ghostT = 0;
  }
  // take it all away (the coaster is knocked down)
  dispose(){
    for (const p of this.pieces) if (p.mesh){ this.group.remove(p.mesh); p.mesh.geometry.dispose(); }
    this.clearGhost();
    for (const o of [this.group, this.arrow, this.ghost, this.supports]) this.scene.remove(o);
    if (this.supports) this.supports.geometry.dispose();
    WORLD.tracks.splice(WORLD.tracks.indexOf(this), 1);
  }
  setColor(c){ this.color = c; this.mats.rail.color.setHex(COLORS[c].rail); this.mats.spine.color.setHex(COLORS[c].spine); }
  reset(){
    for (const p of this.pieces) if (p.mesh){ this.group.remove(p.mesh); p.mesh.geometry.dispose(); }
    this.pieces = [];
    this.place('station', this.oi, 1, 0, 0);
    this.changed();
  }
  get lift(){ return this.hang ? HANG : 0; }
  get end(){ return this.pieces[this.pieces.length - 1].end; }
  get start(){ return { i: this.oi, j: 1, level: 0, d: 0 }; }
  get complete(){ const e = this.end, s = this.start; return this.pieces.length > 1 && e.i === s.i && e.j === s.j && e.level === s.level && e.d === s.d; }
  types(){ return this.pieces.slice(1).map((p) => p.type); }

  // Would this piece fit at the end of the track? (and where would it go)
  check(type, from = this.end, extra = null){
    // extra: a chain of pieces being tried out (linked by .prev) that aren't on the track yet
    if (this.complete && extra === null) return { ok: false, why: 'The track is finished! Undo a piece to change it.' };
    const { i, j, level, d } = from;
    const P = PIECES[type];
    if (level + P.du < 0) return { ok: false, why: 'That would go under the ground.' };
    if (level + P.du > MAX_LEVEL) return { ok: false, why: 'That\'s too high!' };
    // the piece before (to join slopes up smoothly)
    const prev = extra ? extra.type : (from === this.end ? this.pieces[this.pieces.length - 1].type : null);
    const m0 = jointGrade(prev, type);
    const mk = type + i + ',' + j + ',' + level + ',' + d + ',' + m0;
    const s = (this.memo && this.memo.get(mk)) || samplePiece(type, i, j, level, d, { m0, lift: this.lift });
    if (this.memo) this.memo.set(mk, s);
    const e = s.end;
    if (!inPark(e.i, e.j)) return { ok: false, why: 'That would leave the park.', s };
    for (const p of s.pts) if (!inParkXZ(p.pos.x, p.pos.z)) return { ok: false, why: 'That would leave the park.', s };
    const sk = key(i * TILE, j * TILE), ek = key(e.i * TILE, e.j * TILE);
    const cells = s.cells || (s.cells = cellsOf(s.pts, sk, ek, this.lift));
    const endY = BASE_Y + e.level * LEVEL, endCell = { lo: endY, hi: endY + this.lift };
    const closing = e.i === this.start.i && e.j === this.start.j && e.level === 0 && e.d === 0;
    const hit = (k, c, isEnd) => {
      for (const o of this.occ.get(k) || []){ if (clash(c, o) && !(isEnd && o.end && closing && o.station)) return true; }
      for (const t of WORLD.tracks){ if (t === this || !t.occ) continue; for (const o of t.occ.get(k) || []) if (clash(c, o)) return 'other'; }
      for (let q = extra; q; q = q.prev){ const o = q.cells.get(k) || q.ends.get(k); if (o && clash(c, o)) return true; }
      return false;
    };
    const crash = (h) => ({ ok: false, why: h === 'other' ? 'That would crash into another coaster.' : 'That would crash into the track.', s });
    for (const [k, c] of cells){ const h = hit(k, c, false); if (h) return crash(h); }
    if (ek !== sk){ const h = hit(ek, endCell, true); if (h) return crash(h); }
    const R = WORLD.reserved;
    for (const [k, c] of cells){ const o = R.get(k); if (o && clash(c, o)) return { ok: false, why: 'A station is in the way.', s }; }
    const o = R.get(ek); if (o && clash(endCell, o) && !closing) return { ok: false, why: 'A station is in the way.', s };
    return { ok: true, s, cells, sk, ek, closing };
  }
  place(type, i, j, level, d, pre){
    const s = pre ? pre.s : samplePiece(type, i, j, level, d, { lift: this.lift });
    const sk = key(i * TILE, j * TILE), ek = key(s.end.i * TILE, s.end.j * TILE);
    const y0 = BASE_Y + level * LEVEL, y1 = BASE_Y + s.end.level * LEVEL, L = this.lift;
    const piece = { type, i, j, level, d, pts: s.pts, end: s.end, m0: s.m0, m1: s.m1, cells: pre ? pre.cells : cellsOf(s.pts, sk, ek, L),
      ends: new Map([[sk, { lo: y0, hi: y0 + L }], [ek, { lo: y1, hi: y1 + L }]]) };
    piece.mesh = this.meshFor(piece.pts, false);
    this.group.add(piece.mesh);
    this.pieces.push(piece);
    return piece;
  }
  add(type){
    const c = this.check(type);
    if (!c.ok) return c;
    const e = this.end;
    this.place(type, e.i, e.j, e.level, e.d, c);
    this.changed();
    return c;
  }
  undo(){
    if (this.pieces.length <= 1) return false;
    const p = this.pieces.pop();
    this.group.remove(p.mesh); p.mesh.geometry.dispose();
    this.changed();
    return true;
  }
  load(types){
    this.reset();
    for (const t of types){ if (!PIECES[t] || this.complete) break; const c = this.check(t); if (!c.ok) break; const e = this.end; this.place(t, e.i, e.j, e.level, e.d, c); }
    this.changed();
  }

  // Find a way back to the station with the pieces you have (breadth-first over grid points).
  finish(owned){
    if (this.complete) return [];
    this.memo = new Map();
    try { return this.search(owned); } finally { this.memo = null; }
  }
  search(owned){
    const COST = { straight: 2, left: 3, right: 3, bigLeft: 4, bigRight: 4, down: 2, steepDown: 2, up: 9, steepUp: 12 };
    const moves = Object.keys(COST).filter((t) => owned.includes(t));
    const goal = this.start;
    const id = (s) => s.i + ',' + s.j + ',' + s.level + ',' + s.d;
    const best = new Map([[id(this.end), 0]]);
    const h = (s) => Math.round(1.5 * (Math.abs(s.i - goal.i) + Math.abs(s.j - goal.j)) + s.level);   // a guess at the cost left
    const buckets = [[{ st: this.end, chain: null, cost: 0 }]];
    let expanded = 0;
    for (let c = 0; c < buckets.length; c++){
      for (const item of buckets[c] || []){
        if (best.get(id(item.st)) < item.cost) continue;
        if (++expanded > 25000) return null;
        for (const m of moves){
          const r = this.check(m, item.st, item.chain || undefined);
          if (!r.ok) continue;
          const e = r.s.end, k = id(e), nc = item.cost + COST[m];
          if (best.has(k) && best.get(k) <= nc) continue;
          best.set(k, nc);
          const y0 = BASE_Y + item.st.level * LEVEL, y1 = BASE_Y + e.level * LEVEL, L = this.lift;
          const link = { type: m, prev: item.chain, cells: r.cells, ends: new Map([[r.sk, { lo: y0, hi: y0 + L }], [r.ek, { lo: y1, hi: y1 + L }]]) };
          if (e.i === goal.i && e.j === goal.j && e.level === goal.level && e.d === goal.d){
            const out = []; for (let q = link; q; q = q.prev) out.unshift(q.type); return out;
          }
          const pr = nc + h(e);
          (buckets[pr] || (buckets[pr] = [])).push({ st: e, chain: link, cost: nc });
        }
      }
    }
    return null;
  }

  // ---------- after a change: the whole ride as one list of points ----------
  changed(){
    // slopes next to slopes join up into one smooth climb or drop
    const P = this.pieces;
    for (let k = 1; k < P.length; k++){
      const p = P[k], m0 = jointGrade(P[k - 1].type, p.type), m1 = k + 1 < P.length ? jointGrade(p.type, P[k + 1].type) : 0;
      if ((p.m0 || 0) === m0 && (p.m1 || 0) === m1) continue;
      const s = samplePiece(p.type, p.i, p.j, p.level, p.d, { m0, m1, lift: this.lift });
      p.pts = s.pts; p.m0 = m0; p.m1 = m1;
      p.cells = cellsOf(s.pts, key(p.i * TILE, p.j * TILE), key(s.end.i * TILE, s.end.j * TILE), this.lift);
      this.group.remove(p.mesh); p.mesh.geometry.dispose();
      p.mesh = this.meshFor(p.pts, false); this.group.add(p.mesh);
    }
    this.speedCache = new Map();
    this.occ = new Map();
    const put = (k, c) => { if (!this.occ.has(k)) this.occ.set(k, []); this.occ.get(k).push(c); };
    for (const p of this.pieces){
      for (const [k, c] of p.cells) put(k, c);
      for (const [k, c] of p.ends) put(k, { ...c, end: true, station: p.type === 'station' });
    }
    this.path = [];
    let s = 0;
    for (const p of this.pieces){
      for (let k = (this.path.length ? 1 : 0); k < p.pts.length; k++){
        const q = p.pts[k];
        if (this.path.length) s += q.pos.distanceTo(this.path[this.path.length - 1].pos);
        this.path.push({ ...q, s, piece: p });
      }
    }
    this.length = s;
    this.buildSupports();
    this.placeArrow();
  }
  // position, tangent and up at a distance along the ride (wrapping round when it's a circuit)
  at(s, out = {}){
    const P = this.path, L = this.length;
    if (this.complete) s = ((s % L) + L) % L; else s = clamp(s, 0, L);
    let lo = 0, hi = P.length - 1;
    while (hi - lo > 1){ const m = (lo + hi) >> 1; if (P[m].s <= s) lo = m; else hi = m; }
    const a = P[lo], b = P[hi], f = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
    out.pos = (out.pos || V()).copy(a.pos).lerp(b.pos, f);
    out.tan = (out.tan || V()).copy(a.tan).lerp(b.tan, f).normalize();
    out.up = (out.up || V()).copy(a.up).lerp(b.up, f).normalize();
    out.gap = a.gap && b.gap;
    out.piece = a.piece;
    return out;
  }

  // ---------- meshes ----------
  meshFor(pts, ghost){
    const rails = [], spines = [], ties = [];
    const runs = [];   // stretches where the rails are drawn
    let cur = null;
    for (const p of pts){ if (p.gap){ cur = null; continue; } if (!cur){ cur = []; runs.push(cur); } cur.push(p); }
    for (const run of runs){
      if (run.length < 2) continue;
      for (const side of [-0.55, 0.55]) rails.push(tube(run, (p) => p.pos.clone().addScaledVector(p.side, side), 0.075, 6));
      const sp = this.hang ? 0.42 : -0.42, ty = this.hang ? 0.18 : -0.18;
      spines.push(tube(run, (p) => p.pos.clone().addScaledVector(p.up, sp), 0.17, 6));
      // cross ties every metre or so
      let acc = 1;
      for (let k = 1; k < run.length; k++){
        acc += run[k].pos.distanceTo(run[k - 1].pos);
        if (acc < 1.1) continue; acc = 0;
        const p = run[k], m = new THREE.Matrix4().makeBasis(p.side, p.up, p.tan.clone().negate()).setPosition(p.pos.clone().addScaledVector(p.up, ty));
        const g = TIE.clone(); g.applyMatrix4(m); ties.push(g);
      }
    }
    const group = new THREE.Group();
    const add = (list, mat) => { if (!list.length) return; const m = new THREE.Mesh(merge(list), ghost || mat); m.castShadow = !ghost; m.receiveShadow = !ghost; group.add(m); };
    add(rails, this.mats.rail); add(spines, this.mats.spine); add(ties, this.mats.tie);
    group.geometry = { dispose(){ for (const c of group.children) c.geometry.dispose(); } };
    return group;
  }
  buildSupports(){
    if (this.supports){ this.scene.remove(this.supports); this.supports.geometry.dispose(); }
    const geos = [];
    const all = this.path;
    const col = new THREE.CylinderGeometry(0.16, 0.2, 1, 8).toNonIndexed();
    const foot = new THREE.CylinderGeometry(0.45, 0.5, 0.25, 8).toNonIndexed();
    let acc = 3;
    for (let k = 1; k < all.length; k++){
      acc += all[k].pos.distanceTo(all[k - 1].pos);
      const p = all[k];
      if (acc < 5.5 || p.gap || p.up.y < 0.75) continue;
      // a hanging coaster's supports stand beside it and reach over the top, clear of the train
      const top = this.hang ? p.pos.clone().addScaledVector(p.side, 2.1).add(V(0, 0.75, 0)) : p.pos.clone().addScaledVector(p.up, -0.55);
      if (top.y < 0.25) { acc = 0; continue; }
      // not through another bit of track below
      let blocked = false;
      for (const q of all){ if (q !== p && q.pos.y < top.y - 1.2 && Math.abs(q.pos.x - top.x) < 1.4 && Math.abs(q.pos.z - top.z) < 1.4){ blocked = true; break; } }
      if (blocked) continue;
      acc = 0;
      const g = col.clone(); g.applyMatrix4(new THREE.Matrix4().compose(V(top.x, top.y / 2, top.z), new THREE.Quaternion(), V(1, top.y, 1))); geos.push(g);
      geos.push(placed(foot, top.x, 0.12, top.z));
      if (this.hang){
        const over = p.pos.clone().addScaledVector(p.up, 0.6), mid = top.clone().add(over).multiplyScalar(0.5), len = top.distanceTo(over);
        const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), over.clone().sub(top).normalize());
        const arm = col.clone(); arm.applyMatrix4(new THREE.Matrix4().compose(mid, q, V(0.8, len, 0.8))); geos.push(arm);
      }
    }
    this.supports = new THREE.Mesh(geos.length ? merge(geos) : new THREE.BufferGeometry(), this.mats.support);
    this.supports.castShadow = true; this.supports.receiveShadow = true;
    this.scene.add(this.supports);
  }
  placeArrow(){
    if (!this.arrow) return;
    const e = this.end;
    this.arrow.visible = !this.complete;
    this.arrow.position.copy(node(e.i, e.j, e.level, this.lift)).add(V(DIRS[e.d][0] * 2.5, 2.2, DIRS[e.d][1] * 2.5));
    this.arrow.rotation.set(0, Math.atan2(-DIRS[e.d][0], -DIRS[e.d][1]), 0);
  }
  // show what a piece would look like for a moment (green if it fits, red if not)
  preview(type, ok, s, time = 1.2){
    this.clearGhost();
    if (!s) return;
    const m = this.meshFor(s.pts, ok ? this.mats.ghost : this.mats.bad);
    this.ghost.add(m); this.ghostT = time;
  }
  clearGhost(){ for (const c of [...this.ghost.children]){ this.ghost.remove(c); c.geometry.dispose(); } }
  update(dt, time, showArrow){
    if (this.ghostT > 0){ this.ghostT -= dt; if (this.ghostT <= 0) this.clearGhost(); }
    this.arrow.visible = showArrow && !this.complete;
    this.arrow.material.opacity = 0.55 + 0.35 * Math.sin(time * 5);
  }
  endPoint(){ const e = this.end; return node(e.i, e.j, e.level, this.lift); }

  // ---------- how good is it? ----------
  // Speeds: the station launches the train at the speed you pick. After that it's real(ish) physics:
  // going down makes it faster and going up slower, with a little drag. If it slows right down on a
  // climb, a chain lift pulls it up slowly (so a tall climb then a big drop is how to go really fast). It
  // never quite stops, so it always gets round a loop.
  speeds(v0){
    if (!this.speedCache) this.speedCache = new Map();
    if (this.speedCache.has(v0)) return this.speedCache.get(v0);
    const P = this.path, out = new Float32Array(P.length);
    const g = 9.8, DRAG = 0.0007, LIFT = 4.5, PARK_S = 13;
    let v2 = v0 * v0;
    for (let k = 0; k < P.length; k++){
      const p = P[k];
      if (p.s <= PARK_S || p.piece.type === 'station'){ out[k] = v0; v2 = v0 * v0; continue; }
      const q = P[k - 1], ds = p.s - q.s, dy = p.pos.y - q.pos.y;
      v2 = v2 - 2 * g * dy - 2 * DRAG * v2 * ds;
      if (dy > 0 && p.tan.y > 0.12 && v2 < LIFT * LIFT) v2 = LIFT * LIFT;        // the chain lift
      v2 = clamp(v2, 9, 48 * 48);
      out[k] = Math.sqrt(v2);
    }
    this.speedCache.set(v0, out);
    return out;
  }
  // how fast the train wants to go at a distance along the ride
  speedAt(s, v0){
    const P = this.path, sp = this.speeds(v0);
    if (!P.length) return v0;
    s = clamp(s, 0, this.length);
    let lo = 0, hi = P.length - 1;
    while (hi - lo > 1){ const m = (lo + hi) >> 1; if (P[m].s <= s) lo = m; else hi = m; }
    const a = P[lo], b = P[hi], f = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
    return sp[lo] + (sp[hi] - sp[lo]) * f;
  }
  rate(v0){
    const types = this.types();
    let fun = 0, inv = 0, jumps = 0, drops = 0;
    const kinds = new Set();
    for (const t of types){ const P = PIECES[t]; fun += P.fun; inv += P.inversions || 0; jumps += P.jumps || 0; kinds.add(t); if (t === 'steepDown') drops++; }
    let maxY = BASE_Y, maxV = v0;
    const sp = this.speeds(v0);
    this.path.forEach((p, k) => { maxY = Math.max(maxY, p.pos.y - this.lift); maxV = Math.max(maxV, sp[k]); });
    const tight = types.filter((t) => t === 'left' || t === 'right').length;
    const raw = fun + kinds.size * 0.15 + (maxY - BASE_Y) / 10 + (v0 - 6) / 6 + (maxV - v0) / 8 + this.length / 300 + (this.hang ? 0.8 : 0);
    const excitement = this.complete ? Math.round(100 * (1 - Math.exp(-raw / 7))) / 10 : 0;
    const intensity = Math.round(clamp(0.5 + v0 * 0.22 + inv * 0.7 + jumps * 0.9 + drops * 0.4 + (maxV - v0) / 9 + (this.hang ? 0.4 : 0) + Math.min(1.5, tight * (v0 / 16) ** 2 * 0.15), 0, 10) * 10) / 10;
    return { excitement, intensity, maxSpeed: maxV, maxHeight: maxY - BASE_Y, length: this.length, inversions: inv, jumps, pieces: types.length };
  }
}

const TIE = (() => { const g = new THREE.BoxGeometry(1.25, 0.09, 0.14).toNonIndexed(); return g; })();

// sweep a circle along points
function tube(pts, centre, r, seg){
  const pos = [], nor = [];
  const ring = pts.map((p) => {
    const c = centre(p), out = [];
    for (let k = 0; k < seg; k++){
      const a = k / seg * PI * 2, n = p.side.clone().multiplyScalar(Math.cos(a)).addScaledVector(p.up, Math.sin(a));
      out.push([c.clone().addScaledVector(n, r), n]);
    }
    return out;
  });
  for (let i = 0; i < ring.length - 1; i++){
    for (let k = 0; k < seg; k++){
      const a = ring[i][k], b = ring[i][(k + 1) % seg], c = ring[i + 1][k], d = ring[i + 1][(k + 1) % seg];
      for (const [p, n] of [a, c, b, b, c, d]){ pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

// A little picture of a piece (side view for hills, loops and jumps, top view for turns).
export function pieceIcon(type, size = 96, color = '#ffd84a'){
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), P = PIECES[type];
  const pts = [];
  const side = !!(P.du || P.inversions || P.jumps);
  for (let k = 0; k <= 60; k++){
    const [f, r, u] = P.path(k / 60);
    pts.push(side ? [f, -(u + (P.roll ? r * 0.8 : 0)), P.gap && P.gap(k / 60)] : [r, -f, false]);
  }
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const [x, y] of pts){ x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const span = Math.max(x1 - x0, y1 - y0, 6), sc = size * 0.72 / span;
  const cx = size / 2 - (x0 + x1) / 2 * sc, cy = size / 2 - (y0 + y1) / 2 * sc;
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const [w, col] of [[size * 0.13, 'rgba(0,0,0,0.35)'], [size * 0.07, color]]){
    g.strokeStyle = col; g.lineWidth = w; g.beginPath();
    let pen = false;
    for (const [x, y, gap] of pts){ if (gap){ pen = false; continue; } if (pen) g.lineTo(cx + x * sc, cy + y * sc); else { g.moveTo(cx + x * sc, cy + y * sc); pen = true; } }
    g.stroke();
  }
  // where you come in
  const [sx, sy] = pts[0];
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(cx + sx * sc, cy + sy * sc, size * 0.06, 0, PI * 2); g.fill();
  return c;
}
