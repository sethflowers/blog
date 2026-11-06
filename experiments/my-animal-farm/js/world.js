// The farm. A centre-aisle barn with eight stalls, a feed room and a tack room; a turnout paddock; a
// sand riding arena with jumps; pens for goats, sheep, pigs and chickens; the farmhouse; and down the
// lane the show grounds. Also the colliders that stop you (and your horse), and named places.
//
// Directions: -Z is north (the barn), +X is east (the arena). Units are metres.
import * as THREE from 'three';
import { V, Batch, boxUV, rng, fbm, vnoise, clamp, textCanvas, mergeGeometries, ellipsoid } from './util.js';
import { mat, tex } from './textures.js';

export const BARN = { x0: -5.5, x1: 5.5, z0: -22.6, z1: -4, aisle: 1.5, wallH: 4.2, peak: 7.4 };
export const STALL_W = 3.6;
export const ARENA = { x0: 10, x1: 50, z0: 0, z1: 20, gate: { x: 10, z0: 8, z1: 11.5 } };
export const PADDOCK = { x0: -44, x1: -10, z0: -30, z1: 0, gate: { x: -10, z0: -4.5, z1: -1 } };
export const SHOW = { x0: 20, x1: 80, z0: 34, z1: 74, gate: { z: 34, x0: 26, x1: 30 } };
export const PENS = [
  { kind: 'goat',    x0: 10, x1: 21, z0: -20, z1: -9, gate: 'south' },
  { kind: 'sheep',   x0: 23, x1: 34, z0: -20, z1: -9, gate: 'south' },
  { kind: 'pig',     x0: 10, x1: 21, z0: -33, z1: -22, gate: 'south' },
  { kind: 'chicken', x0: 23, x1: 34, z0: -33, z1: -22, gate: 'south' },
];
export const PLACES = {
  start: V(0, 0, 4), rail: V(6.5, 0, -1.2), board: V(-11.2, 0, 10.6), dropoff: V(-5, 0, 17),
  manureHeap: V(3.5, 0, -27.5), barnDoor: V(0, 0, -4), backDoor: V(0, 0, -22.6),
  tap: V(-5.2, 1.0, -21.4), hayStack: V(-4.3, 0, -20.2), grainBin: V(-2.3, 0, -21.8), shavings: V(-4.4, 0, -22.0), carrots: V(-2.0, 0.9, -19.05),
  arenaGate: V(10, 0, 9.75), paddockGate: V(-10, 0, -2.75), showStart: V(50, 0, 38), house: V(-16, 0, 12),
};

// ---------- colliders ----------
// Boxes { x0, x1, z0, z1, h, kind } and circles { x, z, r, h }. Anything below `h` blocks.
export const colliders = [];
const addBox = (x0, x1, z0, z1, h = 2, kind = 'wall') => { colliders.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1), h, kind }); };
const addCircle = (x, z, r, h = 3) => colliders.push({ x, z, r, h, circle: true });
// Push a point out of everything it overlaps (radius r). opts.ignore(kind) skips some colliders.
export function pushOut(p, r, opts = {}){
  for (let it = 0; it < 2; it++){
    for (const c of colliders){
      if (opts.ignore && opts.ignore(c)) continue;
      if (c.disabled) continue;
      if (c.circle){
        const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), m = c.r + r;
        if (d < m && d > 1e-6){ p.x = c.x + dx / d * m; p.z = c.z + dz / d * m; }
        continue;
      }
      const cx = Math.max(c.x0, Math.min(p.x, c.x1)), cz = Math.max(c.z0, Math.min(p.z, c.z1));
      const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-10){ const d = Math.sqrt(d2); p.x = cx + dx / d * r; p.z = cz + dz / d * r; }
      else {
        // inside the box: leave by the nearest side
        const o = [p.x - c.x0 + r, c.x1 - p.x + r, p.z - c.z0 + r, c.z1 - p.z + r], m = Math.min(...o), k = o.indexOf(m);
        if (k === 0) p.x = c.x0 - r; else if (k === 1) p.x = c.x1 + r; else if (k === 2) p.z = c.z0 - r; else p.z = c.z1 + r;
      }
    }
  }
  return p;
}
export const inBox = (p, b, m = 0) => p.x > b.x0 - m && p.x < b.x1 + m && p.z > b.z0 - m && p.z < b.z1 + m;
export function insideBarn(p){ return inBox(p, BARN); }
export function stallAt(p){
  if (!inBox(p, { x0: BARN.x0, x1: BARN.x1, z0: BARN.z0 + 3.8, z1: BARN.z1 })) return -1;
  if (Math.abs(p.x) < BARN.aisle) return -1;
  const k = Math.floor((BARN.z1 - 0.4 - p.z) / STALL_W);
  if (k < 0 || k > 3) return -1;
  return (p.x < 0 ? 0 : 4) + k;
}

// ---------- materials ----------
let M = null;
function materials(){
  if (M) return M;
  M = {
    grass: mat('grass', { rep: 1, rough: 0.95, vc: true }),
    dirt: mat('dirt', { rough: 0.95 }),
    sand: mat('sand', { rough: 0.95 }),
    gravel: mat('gravel', { rough: 0.95 }),
    barnRed: mat('barnRed', { rough: 0.8 }),
    pine: mat('pine', { rough: 0.75 }),
    oak: mat('oak', { rough: 0.75 }),
    white: mat('whitePaint', { rough: 0.6 }),
    trim: mat('whitePaint', { rough: 0.55, color: 0xf4f2ec }),
    roof: mat('metalRoof', { rough: 0.45, metal: 0.55 }),
    shingles: mat('shingles', { rough: 0.9 }),
    clap: mat('clapboard', { rough: 0.7 }),
    concrete: mat('concrete', { rough: 0.9 }),
    rubber: mat('rubber', { rough: 0.95 }),
    metal: mat('plain-metal', { color: 0x2a2c2e, rough: 0.4, metal: 0.8 }),
    steel: mat('plain-steel', { color: 0x9aa2a8, rough: 0.35, metal: 0.9 }),
    glass: mat('plain-glass', { color: 0x1a2630, rough: 0.08, metal: 0.6 }),
    bark: mat('bark', { rough: 0.95 }),
    leaves: mat('leaves', { rough: 0.9, alpha: 0.5, side: THREE.DoubleSide }),
    hay: mat('hay', { rough: 0.95 }),
    shavings: mat('shavings', { rough: 0.95 }),
    stone: mat('plain-stone', { color: 0x8a8580, rough: 0.9 }),
    red: mat('plain-red', { color: 0xb02a22, rough: 0.6 }),
    blue: mat('plain-blue', { color: 0x2a4aa8, rough: 0.6 }),
    yellow: mat('plain-yellow', { color: 0xe8c030, rough: 0.6 }),
    green: mat('plain-green', { color: 0x2e7a3a, rough: 0.6 }),
    black: mat('plain-black', { color: 0x161616, rough: 0.5 }),
    water: new THREE.MeshStandardMaterial({ color: 0x3a5a6a, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.85 }),
    manure: mat('dirt', { color: 0x6a5a38, rough: 0.9 }),
    muck: mat('dirt', { color: 0x4a3a24, rough: 0.95 }),
    plastic: mat('plain-plastic', { color: 0x2f6fb0, rough: 0.5 }),
  };
  return M;
}
export function worldMaterials(){ return materials(); }

// ---------- building blocks ----------
// A post-and-rail fence from a to b with `rails` rails; gaps is a list of [t0, t1] (0..1) left open.
function fence(B, a, b, { rails = 3, h = 1.3, mat: fm, postMat, spacing = 2.6, gaps = [], collide = true, postR = 0.065, railT = 0.05, railH = 0.14 } = {}){
  const len = Math.hypot(b.x - a.x, b.z - a.z), dir = V((b.x - a.x) / len, 0, (b.z - a.z) / len), yaw = Math.atan2(dir.x, dir.z);
  const n = Math.max(1, Math.round(len / spacing));
  const open = (t) => gaps.some(([g0, g1]) => t > g0 + 1e-3 && t < g1 - 1e-3);
  for (let i = 0; i <= n; i++){
    const t = i / n; if (open(t)) continue;
    B.box(postR * 2, h + 0.1, postR * 2, postMat || fm, a.x + dir.x * len * t, (h + 0.1) / 2, a.z + dir.z * len * t, yaw);
  }
  for (let i = 0; i < n; i++){
    const t0 = i / n, t1 = (i + 1) / n, tm = (t0 + t1) / 2;
    if (open(tm)) continue;
    for (let r = 0; r < rails; r++){
      const y = h - r * (h - 0.25) / Math.max(1, rails - 1) - railH / 2;
      B.box(railT, railH, len / n + 0.02, fm, a.x + dir.x * len * tm + (-dir.z) * postR, y, a.z + dir.z * len * tm + dir.x * postR, yaw, 1);
    }
  }
  if (collide){
    // colliders along the open stretches
    const cuts = [0, ...gaps.flat(), 1].sort((x, y) => x - y);
    for (let i = 0; i < cuts.length - 1; i++){
      const t0 = cuts[i], t1 = cuts[i + 1]; if (open((t0 + t1) / 2)) continue;
      const p0 = { x: a.x + dir.x * len * t0, z: a.z + dir.z * len * t0 }, p1 = { x: a.x + dir.x * len * t1, z: a.z + dir.z * len * t1 };
      addBox(p0.x - 0.08, p1.x + 0.08, p0.z - 0.08, p1.z + 0.08, h, 'fence');
    }
  }
}
// A rectangle of fence with an opening on one side.
function fenceRect(B, b, opts, gate){
  const c = [V(b.x0, 0, b.z0), V(b.x1, 0, b.z0), V(b.x1, 0, b.z1), V(b.x0, 0, b.z1)];
  for (let i = 0; i < 4; i++){
    const a = c[i], d = c[(i + 1) % 4];
    const g = gate && gate.side === i ? [[gate.t0, gate.t1]] : [];
    fence(B, a, d, { ...opts, gaps: g });
  }
}

// a sign with text, painted on a canvas
export function sign(text, w = 1.6, h = 0.5, { bg = '#f4efe2', fg = '#3a2a1a', font = 'bold 64px Georgia, serif', border = '#6a4a2a' } = {}){
  const tc = textCanvas(512, Math.round(512 * h / w));
  const g = tc.ctx, W = tc.canvas.width, H = tc.canvas.height;
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.strokeStyle = border; g.lineWidth = 12; g.strokeRect(6, 6, W - 12, H - 12);
  g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  let size = parseInt(font.match(/(\d+)px/)[1]);
  while (g.measureText(text).width > W - 40 && size > 12){ size -= 4; g.font = font.replace(/\d+px/, size + 'px'); }
  g.fillText(text, W / 2, H / 2 + 4);
  tc.tex.needsUpdate = true;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tc.tex, roughness: 0.7 }));
  m.userData.canvas = tc;
  return m;
}

// ---------- the world ----------
export function buildWorld(scene){
  const M = materials();
  const root = new THREE.Group(); scene.add(root);
  const B = new Batch();          // static, casts shadows
  const F = new Batch();          // flat ground pieces (receive only)
  const R = rng(42);
  const world = { root, stalls: [], fixtures: {}, jumps: [], showJumps: [], animated: [], signs: {} };

  // ground: a big field with gentle colour variation so the grass texture doesn't look tiled
  {
    const size = 900, seg = 150;
    const g = new THREE.PlaneGeometry(size, size, seg, seg); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position, uv = g.attributes.uv, col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++){
      const x = p.getX(i), z = p.getZ(i), d = Math.hypot(x - 15, z - 15);
      // hills far away, flat farm in the middle
      const hill = Math.max(0, d - 140) / 260;
      const y = hill * hill * 70 * (0.4 + fbm(x * 0.008, z * 0.008, 4, 3)) - 0.02;
      p.setY(i, y);
      uv.setXY(i, x / 3.2, z / 3.2);
      const n = fbm(x * 0.03, z * 0.03, 3, 5), m = vnoise(x * 0.2, z * 0.2, 6);
      const k = 0.78 + n * 0.32 + m * 0.06;
      col[i * 3] = k * (0.95 + hill * 0.1); col[i * 3 + 1] = k; col[i * 3 + 2] = k * 0.9;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const ground = new THREE.Mesh(g, M.grass); ground.receiveShadow = true; ground.name = 'ground';
    root.add(ground);
    world.ground = ground;
  }
  // a flat strip of ground cover (path, sand) just above the grass
  const strip = (x0, x1, z0, z1, m, y = 0.012, uvs = 0.3) => {
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0); g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv, p = g.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getX(i) + (x0 + x1) / 2) * uvs, (p.getZ(i) + (z0 + z1) / 2) * uvs);
    F.add(g, m, new THREE.Matrix4().makeTranslation((x0 + x1) / 2, y, (z0 + z1) / 2));
  };
  // gravel drive, lane and yard
  strip(-8, 8, -4, 8, M.gravel, 0.014, 0.7);        // barnyard
  strip(-3, 3, 8, 30, M.gravel, 0.013, 0.7);       // drive down to the lane
  strip(-90, 120, 24, 30, M.gravel, 0.012, 0.7);   // the lane
  strip(-10, -3, 14, 20, M.gravel, 0.015, 0.7);    // parking by the house
  strip(-1.6, 1.6, -27, -22.6, M.dirt, 0.014, 0.4); // behind the barn to the muck heap
  strip(1.6, 7, -30, -24, M.dirt, 0.013, 0.4);
  strip(8, 10.2, -36, 0, M.dirt, 0.013, 0.4);       // path past the pens
  strip(10, 36, -21.8, -20.2, M.dirt, 0.014, 0.4);
  strip(-10, -8, -6, 1, M.dirt, 0.014, 0.4);        // worn patch at the paddock gate
  strip(-14, -10, -6, 1, M.dirt, 0.015, 0.4);
  strip(4, 10, -2.6, 0.4, M.dirt, 0.016, 0.4);      // by the hitching rail
  strip(24, 32, 26, 34, M.gravel, 0.014, 0.7);     // into the show grounds
  // arena footing
  strip(ARENA.x0, ARENA.x1, ARENA.z0, ARENA.z1, M.sand, 0.03, 0.22);
  strip(SHOW.x0, SHOW.x1, SHOW.z0, SHOW.z1, M.sand, 0.03, 0.22);
  // pens: trampled dirt
  for (const p of PENS) strip(p.x0, p.x1, p.z0, p.z1, M.dirt, 0.02, 0.35);

  buildBarn(B, F, root, world, M);
  buildPaddock(B, root, world, M);
  buildArena(B, root, world, M, ARENA, false);
  buildArena(B, root, world, M, SHOW, true);
  buildPens(B, root, world, M);
  buildHouse(B, root, world, M);
  buildSurroundings(B, root, world, M, R);

  B.build(root);
  F.build(root, { shadows: false });
  buildGrass(root, M);

  world.update = (dt, t) => { for (const a of world.animated) a(dt, t); };
  return world;
}

// ---------- the barn ----------
function buildBarn(B, F, root, world, M){
  const { x0, x1, z0, z1, aisle, wallH, peak } = BARN;
  const W = x1 - x0, D = z1 - z0, cz = (z0 + z1) / 2;
  // floors: concrete aisle, rubber mats under the stalls
  F.box(aisle * 2, 0.06, D, M.concrete, 0, 0.03, cz, 0, 0.5);
  // outer walls: red board siding with white corner trim
  const t = 0.12;
  B.box(t, wallH, D, M.barnRed, x0, wallH / 2, cz, 0, 0.25);
  B.box(t, wallH, D, M.barnRed, x1, wallH / 2, cz, 0, 0.25);
  // front and back walls with the big doorway in the middle (3.4 m wide, 3.4 high)
  for (const z of [z0, z1]){
    const side = (W - 3.4) / 2;
    B.box(side, wallH, t, M.barnRed, x0 + side / 2, wallH / 2, z, 0, 0.25);
    B.box(side, wallH, t, M.barnRed, x1 - side / 2, wallH / 2, z, 0, 0.25);
    B.box(3.4, wallH - 3.4, t, M.barnRed, 0, 3.4 + (wallH - 3.4) / 2, z, 0, 0.25);
    // gable: triangle of siding
    const gable = new THREE.Shape([new THREE.Vector2(x0, wallH), new THREE.Vector2(x1, wallH), new THREE.Vector2(0, peak)]);
    const gg = new THREE.ShapeGeometry(gable); const uv = gg.attributes.uv, pp = gg.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pp.getX(i) * 0.25, pp.getY(i) * 0.25);
    const front = new THREE.Matrix4().makeTranslation(0, 0, z + (z === z1 ? t / 2 : -t / 2));
    if (z === z0) front.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
    B.add(gg, M.barnRed, front);
    const back = new THREE.Matrix4().makeTranslation(0, 0, z + (z === z1 ? -t / 2 : t / 2));
    if (z === z1) back.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
    B.add(gg, M.barnRed, back);
    // trim round the door and the corners, and the classic white X on the sliding doors
    B.box(0.16, 3.5, 0.16, M.trim, -1.78, 1.75, z + (z === z1 ? 0.08 : -0.08));
    B.box(0.16, 3.5, 0.16, M.trim, 1.78, 1.75, z + (z === z1 ? 0.08 : -0.08));
    B.box(3.72, 0.16, 0.16, M.trim, 0, 3.48, z + (z === z1 ? 0.08 : -0.08));
    const out = z === z1 ? 1 : -1;
    for (const sx of [-1, 1]){
      // the sliding door, pushed open along the wall
      const dx = sx * 3.45, dz = z + out * 0.2;
      B.box(1.8, 3.3, 0.08, M.barnRed, dx, 1.7, dz, 0, 0.25);
      B.box(1.8, 0.12, 0.1, M.trim, dx, 0.1, dz + out * 0.01); B.box(1.8, 0.12, 0.1, M.trim, dx, 3.3, dz + out * 0.01);
      B.box(0.12, 3.3, 0.1, M.trim, dx - 0.84, 1.7, dz + out * 0.01); B.box(0.12, 3.3, 0.1, M.trim, dx + 0.84, 1.7, dz + out * 0.01);
      B.box(0.12, 3.5, 0.1, M.trim, dx, 1.7, dz + out * 0.015, 0, 1, 0, 0.5); B.box(0.12, 3.5, 0.1, M.trim, dx, 1.7, dz + out * 0.015, 0, 1, 0, -0.5);
      B.box(4.2, 0.1, 0.1, M.metal, sx * 2.6, 3.62, z + out * 0.22);
    }
    // gable window and a lamp over the door
    B.box(1.1, 1.1, 0.06, M.glass, 0, 5.3, z + out * 0.08); B.box(1.3, 0.1, 0.1, M.trim, 0, 4.75, z + out * 0.1); B.box(1.3, 0.1, 0.1, M.trim, 0, 5.85, z + out * 0.1);
    B.box(0.1, 1.2, 0.1, M.trim, -0.6, 5.3, z + out * 0.1); B.box(0.1, 1.2, 0.1, M.trim, 0.6, 5.3, z + out * 0.1);
    B.box(0.1, 1.2, 0.1, M.trim, 0, 5.3, z + out * 0.1); B.box(1.2, 0.1, 0.1, M.trim, 0, 5.3, z + out * 0.1);
  }
  for (const x of [x0, x1]) for (const z of [z0, z1]) B.box(0.2, wallH, 0.2, M.trim, x, wallH / 2, z);
  // windows along the sides, one per stall
  for (let k = 0; k < 4; k++){
    const z = z1 - 0.4 - STALL_W * (k + 0.5);
    for (const x of [x0, x1]){
      const o = x < 0 ? -1 : 1;
      B.box(0.06, 0.9, 1.1, M.glass, x + o * 0.05, 2.7, z);
      B.box(0.1, 0.1, 1.3, M.trim, x + o * 0.08, 3.2, z); B.box(0.1, 0.1, 1.3, M.trim, x + o * 0.08, 2.2, z);
      B.box(0.1, 1.1, 0.1, M.trim, x + o * 0.08, 2.7, z - 0.6); B.box(0.1, 1.1, 0.1, M.trim, x + o * 0.08, 2.7, z + 0.6);
      B.box(0.1, 1.1, 0.06, M.trim, x + o * 0.08, 2.7, z);
    }
  }
  // roof: two metal slopes with an overhang, a ridge cap and a cupola with a horse weathervane
  const over = 0.6, slopeW = Math.hypot(W / 2 + over, (peak - wallH) * (W / 2 + over) / (W / 2));
  const ang = Math.atan2(peak - wallH, W / 2);
  for (const s of [-1, 1]){
    const g = boxUV(slopeW, 0.08, D + 1.2, 0.5);
    const m = new THREE.Matrix4().compose(V(s * (W / 4 + over / 2) * 1, wallH + (peak - wallH) / 2 - over * Math.tan(ang) / 2 + 0.05, cz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -s * ang)), V(1, 1, 1));
    B.add(g, M.roof, m);
  }
  B.box(0.3, 0.12, D + 1.2, M.roof, 0, peak + 0.06, cz);
  // cupola
  B.box(1.4, 1.2, 1.4, M.barnRed, 0, peak + 0.6, cz, 0, 0.5);
  B.box(1.5, 0.1, 1.5, M.trim, 0, peak + 1.2, cz);
  for (const s of [-1, 1]){
    B.box(1.2, 0.08, 1.9, M.roof, s * 0.42, peak + 1.5, cz, 0, 1, 0, -s * 0.7);
    B.box(0.05, 0.7, 0.9, M.white, s * 0.71, peak + 0.6, cz);   // louvres
  }
  B.cyl(0.02, 0.02, 1.2, M.metal, 0, peak + 2.2, cz, 6);
  {
    // the weathervane horse: a flat silhouette
    const s = new THREE.Shape();
    const pts = [[-0.45, 0], [-0.3, 0.05], [-0.25, -0.2], [-0.2, -0.2], [-0.15, 0.02], [0.2, 0.02], [0.27, -0.2], [0.32, -0.2], [0.3, 0.05], [0.38, 0.18], [0.5, 0.15], [0.52, 0.2], [0.4, 0.3], [0.3, 0.22], [-0.3, 0.2], [-0.5, 0.05]];
    s.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) s.lineTo(p[0], p[1]);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: false });
    const vane = new THREE.Mesh(g, M.metal); vane.position.set(0, peak + 2.55, cz); vane.castShadow = true;
    root.add(vane);
    world.animated.push((dt, t) => { vane.rotation.y = Math.sin(t * 0.05) * 0.8 + Math.sin(t * 0.31) * 0.1; });
  }
  // inside: posts and beams
  for (let k = 0; k <= 4; k++){
    const z = z1 - 0.4 - STALL_W * k;
    for (const x of [-aisle, aisle]) B.box(0.2, wallH, 0.2, M.oak, x, wallH / 2, z);
    B.box(W, 0.25, 0.2, M.oak, 0, wallH - 0.12, z);
  }
  B.box(0.2, 0.25, D, M.oak, -aisle, wallH - 0.12, cz); B.box(0.2, 0.25, D, M.oak, aisle, wallH - 0.12, cz);
  // ceiling boards (the hay loft floor)
  B.box(W, 0.06, D, M.pine, 0, wallH + 0.03, cz, 0, 0.5);
  // hanging lamps down the aisle
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff2c8, emissive: 0xffd890, emissiveIntensity: 1.2 });
  for (let k = 0; k < 5; k++){
    const z = z1 - 1.8 - k * 3.6;
    B.cyl(0.01, 0.01, 0.6, M.metal, 0, wallH - 0.3, z, 4);
    B.cyl(0.28, 0.06, 0.18, M.metal, 0, wallH - 0.65, z, 12);
    B.add(new THREE.SphereGeometry(0.07, 10, 6), lampMat, new THREE.Matrix4().makeTranslation(0, wallH - 0.75, z));
  }
  // colliders: outer walls (with the doorways open)
  addBox(x0 - 0.1, x0 + 0.1, z0, z1, 4); addBox(x1 - 0.1, x1 + 0.1, z0, z1, 4);
  for (const z of [z0, z1]){ addBox(x0, -1.75, z - 0.1, z + 0.1, 4); addBox(1.75, x1, z - 0.1, z + 0.1, 4); }

  // ----- stalls -----
  for (let k = 0; k < 4; k++){
    const za = z1 - 0.4 - STALL_W * k, zb = za - STALL_W, zc = (za + zb) / 2;
    for (const s of [-1, 1]){
      const id = (s < 0 ? 0 : 4) + k;
      const xa = s * aisle, xb = s * (x1 - 0.06), xc = (xa + xb) / 2;
      F.box(Math.abs(xb - xa), 0.04, STALL_W, M.rubber, xc, 0.02, zc, 0, 0.5);
      // dividing walls: 1.4 m of boards with bars above
      for (const z of [za, zb]){
        B.box(Math.abs(xb - xa), 1.4, 0.06, M.pine, xc, 0.7, z, 0, 0.5);
        B.box(Math.abs(xb - xa), 0.08, 0.1, M.metal, xc, 1.42, z);
        B.box(Math.abs(xb - xa), 0.06, 0.08, M.metal, xc, 2.3, z);
        for (let i = 1; i < 16; i++) B.box(0.022, 0.86, 0.022, M.metal, xa + (xb - xa) * i / 16, 1.86, z);
        addBox(xa, xb, z - 0.08, z + 0.08, 2.3);
      }
      // front onto the aisle, with a sliding door (left open a bit when a horse is out)
      const front = xa + s * 0.03;
      for (const [z0s, z1s] of [[zb, zc - 0.6], [zc + 0.6, za]]){
        B.box(0.06, 1.3, Math.abs(z1s - z0s), M.pine, front, 0.65, (z0s + z1s) / 2, 0, 0.5);
        B.box(0.1, 0.08, Math.abs(z1s - z0s), M.metal, front, 1.32, (z0s + z1s) / 2);
        B.box(0.08, 0.06, Math.abs(z1s - z0s), M.metal, front, 2.3, (z0s + z1s) / 2);
        const n = Math.round(Math.abs(z1s - z0s) / 0.1);
        for (let i = 1; i < n; i++) B.box(0.022, 0.96, 0.022, M.metal, front, 1.82, z0s + (z1s - z0s) * i / n);
        addBox(front - 0.06, front + 0.06, Math.min(z0s, z1s), Math.max(z0s, z1s), 2.3);
      }
      B.box(0.08, 0.06, 4.2, M.metal, front + s * 0.05, 2.42, zc - 0.9);  // door track
      const door = new THREE.Group();
      {
        const DB = new Batch();
        DB.box(0.06, 1.3, 1.2, M.pine, 0, 0.65, 0, 0, 0.5);
        DB.box(0.08, 0.08, 1.24, M.metal, 0, 1.32, 0); DB.box(0.08, 0.06, 1.24, M.metal, 0, 2.3, 0);
        DB.box(0.08, 2.3, 0.06, M.metal, 0, 1.15, -0.6); DB.box(0.08, 2.3, 0.06, M.metal, 0, 1.15, 0.6);
        for (let i = 1; i < 12; i++) DB.box(0.02, 0.96, 0.02, M.metal, 0, 1.82, -0.6 + i * 0.1);
        DB.build(door);
      }
      door.position.set(front - s * 0.09, 0, zc);
      root.add(door);
      const doorCol = { x0: front - s * 0.09 - 0.06, x1: front - s * 0.09 + 0.06, z0: zc - 0.6, z1: zc + 0.6, h: 2.3, kind: 'door' };
      doorCol.x0 = Math.min(doorCol.x0, doorCol.x1); doorCol.x1 = Math.max(front - s * 0.09 - 0.06, front - s * 0.09 + 0.06);
      colliders.push(doorCol);
      // name plate on the door
      const plate = sign('Empty', 0.5, 0.16, { font: 'bold 70px Georgia, serif', bg: '#2a1a10', fg: '#f0d890', border: '#c8a050' });
      plate.position.set(front - s * 0.09 - s * 0.045, 1.15, zc); plate.rotation.y = -s * Math.PI / 2;
      root.add(plate);
      // the bedding: pine shavings, a little heaped
      const bed = new THREE.Mesh(boxUV(Math.abs(xb - xa) - 0.1, 0.12, STALL_W - 0.12, 0.6), new THREE.MeshStandardMaterial({ map: M.shavings.map, normalMap: M.shavings.normalMap, roughness: 0.95, color: 0xffffff }));
      bed.position.set(xc, 0.07, zc); bed.receiveShadow = true;
      root.add(bed);
      // hay rack in the back corner
      const rackPos = V(s * (x1 - 0.35), 1.25, zb + 0.55);
      const RB = new Batch();
      RB.box(0.5, 0.06, 0.8, M.metal, 0, -0.45, 0);
      for (let i = 0; i < 6; i++) RB.box(0.02, 0.9, 0.02, M.metal, -s * 0.24, 0, -0.38 + i * 0.152, 0, 1, 0, s * 0.3);
      RB.box(0.04, 0.04, 0.8, M.metal, -s * 0.36, 0.4, 0);
      const rack = new THREE.Group(); rack.position.copy(rackPos); RB.build(rack); root.add(rack);
      const rackHay = new THREE.Mesh(boxUV(0.36, 0.5, 0.7, 2), M.hay); rackHay.position.set(rackPos.x - s * 0.08, rackPos.y - 0.18, rackPos.z); rackHay.castShadow = true;
      root.add(rackHay);
      // feed tub in the other back corner
      const tubPos = V(s * (x1 - 0.32), 0.85, za - 0.45);
      const tub = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.26, 18, 1, true), M.plastic); tub.position.copy(tubPos); tub.castShadow = true;
      const tubBottom = new THREE.Mesh(new THREE.CircleGeometry(0.22, 18), M.plastic); tubBottom.rotation.x = -Math.PI / 2; tubBottom.position.set(0, -0.12, 0); tub.add(tubBottom);
      tub.material.side = THREE.DoubleSide;
      const grain = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.21, 0.06, 18), mat('dirt', { color: 0xc8a060, rough: 0.8 })); grain.position.set(0, -0.06, 0); tub.add(grain);
      root.add(tub);
      // water bucket hook by the front, so it can be filled from the aisle
      const hookPos = V(s * (aisle + 0.28), 1.05, za - 0.35);
      B.box(0.1, 0.12, 0.04, M.metal, hookPos.x, hookPos.y + 0.18, hookPos.z);
      world.stalls.push({ id, side: s, center: V(xc, 0, zc), za, zb, xa, xb, door, doorOpen: 0, doorCol, plate, bed, rack, rackHay, tub, grain, hookPos, tubPos, rackPos, front });
    }
  }
  // ----- feed room (west) and tack room (east) at the back -----
  const rz1 = z1 - 0.4 - STALL_W * 4, rz0 = z0;
  for (const s of [-1, 1]){
    const xa = s * aisle, xb = s * x1;
    F.box(Math.abs(xb - xa), 0.05, rz1 - rz0, M.concrete, (xa + xb) / 2, 0.025, (rz0 + rz1) / 2, 0, 0.5);
    // wall to the aisle with a doorway
    const dz0 = rz1 - 0.4, dz1 = rz1 - 1.6;
    B.box(0.1, wallH, rz0 - dz1 < 0 ? dz1 - rz0 : 0.01, M.pine, xa, wallH / 2, (rz0 + dz1) / 2, 0, 0.5);
    B.box(0.1, wallH, 0.4, M.pine, xa, wallH / 2, rz1 - 0.2, 0, 0.5);
    B.box(0.1, wallH - 2.4, 1.2, M.pine, xa, 2.4 + (wallH - 2.4) / 2, (dz0 + dz1) / 2, 0, 0.5);
    addBox(xa - 0.06, xa + 0.06, rz0, dz1, 4); addBox(xa - 0.06, xa + 0.06, dz0, rz1, 4);
    const lab = sign(s < 0 ? 'FEED ROOM' : 'TACK ROOM', 1.0, 0.24, { font: 'bold 64px Georgia, serif' });
    lab.position.set(xa + s * -0.06, 2.65, (dz0 + dz1) / 2); lab.rotation.y = -s * Math.PI / 2; root.add(lab);
  }
  // feed room: hay stack, grain bin, shavings, tap and sink, carrots
  {
    const fx = world.fixtures;
    const hay = new THREE.Group(); hay.position.copy(PLACES.hayStack); root.add(hay);
    fx.hayStack = { group: hay, bales: [] };
    const baleG = boxUV(0.9, 0.38, 0.48, 1.6);
    for (let i = 0; i < 12; i++){
      const b = new THREE.Mesh(baleG, M.hay);
      const layer = Math.floor(i / 4), j = i % 4;
      b.position.set((j % 2) * 0.5 - 0.25 + (layer % 2) * 0.02, 0.2 + layer * 0.39, Math.floor(j / 2) * 0.95 - 0.2);
      b.rotation.y = Math.PI / 2 + (Math.random() - 0.5) * 0.05; b.castShadow = b.receiveShadow = true;
      // two strings round each bale
      for (const o of [-0.2, 0.2]){ const st = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.39, 0.49), M.yellow); st.position.x = o; b.add(st); }
      hay.add(b); fx.hayStack.bales.push(b);
    }
    // grain bin: galvanised can with a lid
    const bin = new THREE.Group(); bin.position.copy(PLACES.grainBin); root.add(bin);
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.3, 0.8, 24), M.steel); can.position.y = 0.4; can.castShadow = true; bin.add(can);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.05, 24), M.steel); lid.position.set(0, 0.82, 0); bin.add(lid);
    const lidH = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.03), M.metal); lidH.position.y = 0.06; lid.add(lidH);
    const binSign = sign('GRAIN', 0.4, 0.14, { font: 'bold 70px Arial' }); binSign.position.set(0, 0.55, 0.311); bin.add(binSign);
    fx.grainBin = { group: bin, lid };
    // shavings bags
    const sh = new THREE.Group(); sh.position.copy(PLACES.shavings); root.add(sh);
    const bagM = mat('plain-bag', { color: 0x3a7a3a, rough: 0.5 });
    fx.shavings = { group: sh, bags: [] };
    for (let i = 0; i < 6; i++){
      const bg = new THREE.Mesh(boxUV(0.55, 0.22, 0.8), bagM); bg.position.set(0, 0.11 + i * 0.22, 0); bg.rotation.y = (i % 2) * 0.1; bg.castShadow = true;
      const lab = sign('PINE SHAVINGS', 0.4, 0.12, { font: 'bold 50px Arial', bg: '#e8e0c0', fg: '#2a5a2a', border: '#2a5a2a' });
      lab.rotation.x = -Math.PI / 2; lab.position.y = 0.112; bg.add(lab);
      sh.add(bg); fx.shavings.bags.push(bg);
    }
    // the tap over a sink on the outside wall
    const tp = PLACES.tap;
    B.box(0.5, 0.25, 0.6, M.steel, tp.x + 0.1, 0.7, tp.z);
    B.box(0.06, 0.7, 0.06, M.steel, tp.x + 0.1, 0.35, tp.z);
    B.cyl(0.02, 0.02, 0.3, M.steel, tp.x - 0.05, tp.y + 0.15, tp.z, 8, 0, Math.PI / 2);
    B.cyl(0.02, 0.018, 0.12, M.steel, tp.x + 0.1, tp.y + 0.24, tp.z, 8);
    const tapStream = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.4, 8), M.water); tapStream.position.set(tp.x + 0.1, tp.y - 0.02, tp.z); tapStream.visible = false;
    root.add(tapStream);
    fx.tap = { pos: V(tp.x + 0.1, tp.y + 0.1, tp.z), stream: tapStream };
    // a basket of carrots on a shelf
    B.box(0.6, 0.04, 0.4, M.oak, PLACES.carrots.x, PLACES.carrots.y - 0.02, PLACES.carrots.z);
    B.box(0.04, 0.9, 0.04, M.oak, PLACES.carrots.x - 0.26, 0.45, PLACES.carrots.z - 0.16); B.box(0.04, 0.9, 0.04, M.oak, PLACES.carrots.x + 0.26, 0.45, PLACES.carrots.z - 0.16);
    B.box(0.04, 0.9, 0.04, M.oak, PLACES.carrots.x - 0.26, 0.45, PLACES.carrots.z + 0.16); B.box(0.04, 0.9, 0.04, M.oak, PLACES.carrots.x + 0.26, 0.45, PLACES.carrots.z + 0.16);
    const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.14, 16, 1, true), mat('plain-wicker', { color: 0x9a7444, rough: 0.9, side: THREE.DoubleSide }));
    basket.position.set(PLACES.carrots.x, PLACES.carrots.y + 0.07, PLACES.carrots.z); root.add(basket);
    const cm = mat('plain-carrot', { color: 0xe06a1a, rough: 0.6 });
    for (let i = 0; i < 7; i++){
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.18, 8), cm); c.rotation.z = Math.PI / 2 + (Math.random() - 0.5); c.rotation.y = Math.random() * 6;
      c.position.set(PLACES.carrots.x + (Math.random() - 0.5) * 0.2, PLACES.carrots.y + 0.13, PLACES.carrots.z + (Math.random() - 0.5) * 0.2); root.add(c);
    }
    fx.carrots = { pos: PLACES.carrots.clone().setY(PLACES.carrots.y + 0.1) };
    addBox(-5.4, -3.6, -21.0, -18.9, 1.5, 'stack'); addBox(-2.65, -1.95, -22.15, -21.45, 0.9, 'stack'); addBox(-4.75, -4.05, -22.5, -21.5, 1.3, 'stack');
    // feed chart on the wall
    const chart = sign('Feed: hay AM + PM · grain 1 scoop · water 2x', 2.0, 0.4, { font: 'bold 40px Arial', bg: '#fffbe8' });
    chart.position.set(-x1 + 0.08, 2.0, -20.8); chart.rotation.y = Math.PI / 2; root.add(chart);
  }
  // tack room: saddle racks, bridle hooks, grooming box, ribbons wall
  {
    const fx = world.fixtures;
    fx.saddleRacks = []; fx.bridleHooks = []; fx.padShelf = [];
    for (let i = 0; i < 3; i++){
      const z = rz1 - 0.8 - i * 1.1, x = x1 - 0.45;
      B.box(0.5, 0.06, 0.06, M.oak, x, 1.2, z);
      B.box(0.06, 0.2, 0.06, M.oak, x + 0.22, 1.1, z);
      B.box(0.1, 0.24, 0.3, M.oak, x, 1.31, z, 0, 1, 0.78);
      B.box(0.1, 0.24, 0.3, M.oak, x, 1.31, z, 0, 1, -0.78);
      fx.saddleRacks.push(V(x, 1.42, z));
      B.box(0.06, 0.12, 0.06, M.metal, x1 - 0.1, 1.95, z);
      fx.bridleHooks.push(V(x1 - 0.14, 1.9, z));
    }
    // a wooden grooming box on the floor
    const gb = V(2.4, 0, rz1 - 0.6);
    B.box(0.6, 0.25, 0.32, M.oak, gb.x, 0.125, gb.z);
    B.box(0.03, 0.3, 0.03, M.oak, gb.x - 0.25, 0.3, gb.z); B.box(0.03, 0.3, 0.03, M.oak, gb.x + 0.25, 0.3, gb.z);
    B.box(0.52, 0.03, 0.03, M.oak, gb.x, 0.44, gb.z);
    fx.groomBox = gb;
    // ribbons won go up on this board
    const rb = sign('', 1.8, 1.1, { bg: '#2a3a2a', border: '#6a4a2a' }); rb.position.set(4.5, 2.4, z0 + 0.08); root.add(rb);
    fx.ribbonBoard = { mesh: rb, pos: V(4.5, 2.4, z0 + 0.1) };
    fx.ribbonGroup = new THREE.Group(); root.add(fx.ribbonGroup);
  }
  // the manure heap behind the barn, in a three-sided bay
  {
    const h = PLACES.manureHeap;
    B.box(4, 1.2, 0.2, M.oak, h.x, 0.6, h.z - 1.6); B.box(0.2, 1.2, 3.2, M.oak, h.x - 2, 0.6, h.z); B.box(0.2, 1.2, 3.2, M.oak, h.x + 2, 0.6, h.z);
    addBox(h.x - 2.1, h.x + 2.1, h.z - 1.7, h.z - 1.5, 1.2); addBox(h.x - 2.1, h.x - 1.9, h.z - 1.6, h.z + 1.6, 1.2); addBox(h.x + 1.9, h.x + 2.1, h.z - 1.6, h.z + 1.6, 1.2);
    const pile = new THREE.Mesh(ellipsoid(1.4, 0.6, 1.1, 18, 10), M.muck);
    const p = pile.geometry.attributes.position;
    for (let i = 0; i < p.count; i++){ const y = p.getY(i); p.setY(i, Math.max(0, y) * (0.8 + vnoise(p.getX(i) * 4, p.getZ(i) * 4, 9) * 0.5)); }
    pile.geometry.computeVertexNormals();
    pile.position.set(h.x, 0, h.z - 0.4); pile.castShadow = pile.receiveShadow = true; root.add(pile);
    world.fixtures.manureHeap = { pos: V(h.x, 0.5, h.z - 0.2), pile };
  }
}

// ---------- paddock ----------
function buildPaddock(B, root, world, M){
  const P = PADDOCK;
  const gateT0 = (P.gate.z0 - P.z0) / (P.z1 - P.z0), gateT1 = (P.gate.z1 - P.z0) / (P.z1 - P.z0);
  // corners in order: (x0,z0) (x1,z0) (x1,z1) (x0,z1); side 1 is x = x1 from z0 to z1
  fenceRect(B, P, { rails: 3, h: 1.4, mat: M.oak, spacing: 3 }, { side: 1, t0: gateT0, t1: gateT1 });
  // the gate itself, swung open against the fence
  B.box(0.06, 1.2, 3.4, M.steel, P.x1 + 1.7, 0.7, P.gate.z0 - 0.0, Math.PI / 2);
  // water trough and a run-in shelter
  const tr = V(-13, 0, -7);
  B.box(1.8, 0.55, 0.7, M.steel, tr.x, 0.3, tr.z);
  const water = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.02, 0.6), M.water); water.position.set(tr.x, 0.52, tr.z); root.add(water);
  addBox(tr.x - 0.9, tr.x + 0.9, tr.z - 0.35, tr.z + 0.35, 0.6);
  world.fixtures.paddockTrough = { pos: tr, water };
  const sx = -38, sz = -25;
  B.box(8, 2.8, 0.15, M.oak, sx, 1.4, sz - 2.5, 0, 0.3); B.box(0.15, 2.8, 5, M.oak, sx - 4, 1.4, sz, 0, 0.3); B.box(0.15, 2.8, 5, M.oak, sx + 4, 1.4, sz, 0, 0.3);
  B.box(8.6, 0.08, 5.8, M.roof, sx, 2.95, sz, 0, 0.5, 0.12);
  addBox(sx - 4, sx + 4, sz - 2.6, sz - 2.4, 3); addBox(sx - 4.1, sx - 3.9, sz - 2.5, sz + 2.5, 3); addBox(sx + 3.9, sx + 4.1, sz - 2.5, sz + 2.5, 3);
  world.fixtures.paddockGate = PLACES.paddockGate;
}

// ---------- arenas and jumps ----------
// A show jump: two wing standards and coloured poles. type: 'cross', 'vertical', 'oxer'.
export function makeJump({ type = 'vertical', height = 0.8, width = 3.4, colors = [0xffffff, 0xc02020], show = false }){
  const g = new THREE.Group();
  const M = materials();
  const wingM = M.white, poleMats = colors.map((c) => mat('plain-pole', { color: c, rough: 0.5 }));
  const spread = type === 'oxer' ? 0.9 : 0;
  const planes = type === 'oxer' ? [-spread / 2, spread / 2] : [0];
  const poles = [];
  for (const pz of planes){
    for (const sx of [-1, 1]){
      // wing standard: a post with a little panel
      const post = new THREE.Mesh(boxUV(0.1, 1.9, 0.1), wingM); post.position.set(sx * (width / 2 + 0.05), 0.95, pz); post.castShadow = true; g.add(post);
      if (show || pz === planes[0]){
        const wing = new THREE.Mesh(boxUV(0.06, 1.3, 0.6), show ? poleMats[1] : M.white); wing.position.set(sx * (width / 2 + 0.36), 0.65, pz); wing.castShadow = true; g.add(wing);
        const post2 = new THREE.Mesh(boxUV(0.1, 1.5, 0.1), wingM); post2.position.set(sx * (width / 2 + 0.7), 0.75, pz); g.add(post2);
      }
      // the metal cup that holds the pole
      const cup = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.12), M.metal); cup.position.set(sx * (width / 2 - 0.02), height - 0.06, pz); g.add(cup);
    }
    if (type === 'cross' && pz === 0){
      for (const s of [-1, 1]){
        const p = makePole(width + 0.2, poleMats);
        p.position.set(0, height / 2 + 0.05, 0); p.rotation.z = s * Math.atan2(height - 0.1, width / 2) * 0.95;
        g.add(p); poles.push({ mesh: p, rest: p.position.clone(), restRot: p.rotation.clone(), top: height * 0.5, down: false });
      }
    } else {
      const p = makePole(width, poleMats); p.position.set(0, height, pz); g.add(p);
      poles.push({ mesh: p, rest: p.position.clone(), restRot: p.rotation.clone(), top: height, down: false });
      // a lower filler pole on verticals
      const p2 = makePole(width, poleMats); p2.position.set(0, height * 0.45, pz); g.add(p2);
    }
  }
  if (show){
    // flower boxes in front
    const fb = new THREE.Mesh(boxUV(width * 0.8, 0.28, 0.4), M.oak); fb.position.set(0, 0.14, -spread / 2 - 0.5); g.add(fb);
    for (let i = 0; i < 9; i++){
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), mat('plain-flower' + (i % 3), { color: [0xe83a6a, 0xf0e040, 0xffffff][i % 3], rough: 0.7 }));
      f.position.set(-width * 0.36 + i * width * 0.09, 0.32, -spread / 2 - 0.5); g.add(f);
    }
  }
  g.userData = { type, height, width, spread, poles };
  return g;
}
// a pole painted in bands of two colours (one mesh, striped texture)
const poleMats = new Map();
function makePole(len, mats){
  const cols = mats.map((m) => '#' + m.color.getHexString());
  const key = cols.join();
  if (!poleMats.has(key)){
    const c = document.createElement('canvas'); c.width = 256; c.height = 8;
    const g = c.getContext('2d');
    for (let i = 0; i < 6; i++){ g.fillStyle = cols[i % cols.length]; g.fillRect(i * 256 / 6, 0, 256 / 6 + 1, 8); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    poleMats.set(key, new THREE.MeshStandardMaterial({ map: t, roughness: 0.45 }));
  }
  const geo = new THREE.CylinderGeometry(0.05, 0.05, len, 10, 1);
  // stripes run along the pole: map the cylinder's height to u
  const uv = geo.attributes.uv, p = geo.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getY(i) / len + 0.5, uv.getX(i));
  const m = new THREE.Mesh(geo, poleMats.get(key));
  m.rotation.z = Math.PI / 2; m.castShadow = true;
  const g = new THREE.Group(); g.add(m);
  return g;
}

function buildArena(B, root, world, M, A, show){
  const W = A.x1 - A.x0, D = A.z1 - A.z0;
  // white post and rail fence, with an opening for the gate
  const gate = show ? { side: 0, t0: (A.gate.x0 - A.x0) / W, t1: (A.gate.x1 - A.x0) / W } : { side: 3, t0: 1 - (A.gate.z1 - A.z0) / D, t1: 1 - (A.gate.z0 - A.z0) / D };
  fenceRect(B, A, { rails: 3, h: 1.3, mat: M.white, spacing: 2.5 }, gate);
  // kick boards along the bottom, letter markers round the side (dressage letters)
  const letters = ['A', 'K', 'E', 'H', 'C', 'M', 'B', 'F'];
  const lp = [[A.x0 + 0.6, (A.z0 + A.z1) / 2], [A.x0 + W * 0.15, A.z1 - 0.6], [(A.x0 + A.x1) / 2, A.z1 - 0.6], [A.x1 - W * 0.15, A.z1 - 0.6], [A.x1 - 0.6, (A.z0 + A.z1) / 2], [A.x1 - W * 0.15, A.z0 + 0.6], [(A.x0 + A.x1) / 2, A.z0 + 0.6], [A.x0 + W * 0.15, A.z0 + 0.6]];
  if (!show) lp.forEach(([x, z], i) => {
    const s = sign(letters[i], 0.35, 0.35, { font: 'bold 260px Arial', bg: '#ffffff', fg: '#111', border: '#ffffff' });
    s.position.set(x, 0.45, z); s.lookAt((A.x0 + A.x1) / 2, 0.45, (A.z0 + A.z1) / 2); root.add(s);

  });
  // jumps
  if (!show){
    const list = [
      { type: 'cross', height: 0.6, x: 17, z: 4, yaw: Math.PI / 2 },
      { type: 'vertical', height: 0.8, x: 30, z: 4, yaw: Math.PI / 2 },
      { type: 'oxer', height: 0.9, x: 43, z: 10, yaw: 0, colors: [0xffffff, 0x2a4ab0] },
      { type: 'vertical', height: 1.0, x: 30, z: 16, yaw: -Math.PI / 2, colors: [0xffffff, 0x2a8a3a] },
      { type: 'cross', height: 0.5, x: 17, z: 16, yaw: -Math.PI / 2, colors: [0xffffff, 0xd0a020] },
    ];
    for (const j of list){
      const m = makeJump(j); m.position.set(j.x, 0.03, j.z); m.rotation.y = j.yaw; root.add(m);
      world.jumps.push({ mesh: m, ...m.userData, x: j.x, z: j.z, yaw: j.yaw });
    }
    const s = sign('RIDING ARENA', 2.2, 0.5); s.position.set(A.x0 - 0.15, 1.9, A.gate.z0 - 1.3); s.rotation.y = -Math.PI / 2; root.add(s);
    B.box(0.12, 2.2, 0.12, M.oak, A.x0 - 0.2, 1.1, A.gate.z0 - 0.15); B.box(0.12, 2.2, 0.12, M.oak, A.x0 - 0.2, 1.1, A.gate.z0 - 2.45);
    // mounting block by the gate
    B.box(0.8, 0.35, 0.6, M.oak, A.x0 + 1.2, 0.18, A.gate.z1 + 1); B.box(0.8, 0.18, 0.35, M.oak, A.x0 + 1.2, 0.44, A.gate.z1 + 1.12);
  } else {
    buildShowGrounds(B, root, world, M, A);
  }
}

// The show grounds: a bigger arena with a course of numbered jumps, grandstands, flags and a judge's box.
export const COURSE = [
  { type: 'vertical', x: 32, z: 44, yaw: Math.PI / 2, colors: [0xffffff, 0xc02020] },
  { type: 'oxer', x: 46, z: 44, yaw: Math.PI / 2, colors: [0xffffff, 0x2040b0] },
  { type: 'vertical', x: 62, z: 44, yaw: Math.PI / 2, colors: [0xf0d020, 0x1a1a1a] },
  { type: 'oxer', x: 73, z: 56, yaw: 0, colors: [0xffffff, 0x2a8a3a] },
  { type: 'vertical', x: 62, z: 67, yaw: -Math.PI / 2, colors: [0xffffff, 0xe07020] },
  { type: 'vertical', x: 48, z: 63, yaw: -Math.PI / 2, colors: [0xffffff, 0x8a2ab0] },
  { type: 'oxer', x: 36, z: 67, yaw: -Math.PI / 2, colors: [0xffffff, 0xc02020] },
  { type: 'vertical', x: 30, z: 52, yaw: -2.62, colors: [0x2040b0, 0xffffff] },
];
// the timing line (start and finish) you ride through: from a to b, on x = 24
export const SHOW_START = { a: V(24, 0, 37), b: V(24, 0, 49) };   // the timing line you ride through
function buildShowGrounds(B, root, world, M, A){
  for (let i = 0; i < COURSE.length; i++){
    const c = COURSE[i];
    const m = makeJump({ type: c.type, height: 1.0, colors: c.colors, show: true, width: 3.6 });
    m.position.set(c.x, 0.03, c.z); m.rotation.y = c.yaw; root.add(m);
    const num = sign(String(i + 1), 0.4, 0.4, { font: 'bold 240px Arial', bg: '#ffffff', fg: '#c02020', border: '#c02020' });
    num.position.set(2.55, 1.75, 0); num.rotation.y = 0; m.add(num);
    const num2 = num.clone(); num2.rotation.y = Math.PI; num2.position.x = 2.55; m.add(num2);
    world.showJumps.push({ mesh: m, ...m.userData, x: c.x, z: c.z, yaw: c.yaw, num: i + 1 });
  }
  // timing posts
  for (const p of [SHOW_START.a, SHOW_START.b]){
    B.box(0.14, 1.6, 0.14, M.red, p.x, 0.8, p.z);
    B.box(0.2, 0.2, 0.2, M.black, p.x, 1.7, p.z);
  }
  // grandstands along the south side (outside the fence) with spectators, facing the arena
  for (const x of [34, 50, 66]){
    for (let r = 0; r < 4; r++){
      B.box(12, 0.08, 0.7, M.oak, x, 0.45 + r * 0.45, 76 + r * 0.7);
      B.box(12, 0.45 + r * 0.45, 0.06, M.metal, x, (0.45 + r * 0.45) / 2, 75.65 + r * 0.7);
    }
    B.box(12.2, 0.1, 3.6, M.roof, x, 3.9, 77.1, 0, 1, -0.12);
    for (const sx of [-6, 6]) for (const sz of [75.7, 78.6]) B.box(0.1, 3.9, 0.1, M.metal, x + sx, 1.95, sz);
    addBox(x - 6.1, x + 6.1, 75.4, 79, 3);
  }
  // judge's box on stilts outside the north-east corner
  B.box(3, 2.2, 3, M.white, 78, 3.4, 31); B.box(3.4, 0.12, 3.4, M.roof, 78, 4.6, 31);
  B.box(2.4, 0.9, 0.05, M.glass, 78, 3.8, 32.52);
  for (const sx of [-1.3, 1.3]) for (const sz of [-1.3, 1.3]) B.box(0.14, 2.3, 0.14, M.oak, 78 + sx, 1.15, 31 + sz);
  addBox(76.5, 79.5, 29.5, 32.5, 3);
  // banner and flags
  const banner = sign('MAPLE HILL SHOW JUMPING', 9, 1.1, { font: 'bold 90px Georgia, serif', bg: '#1a3a7a', fg: '#ffffff', border: '#f0c040' });
  banner.position.set(50, 4.7, 75.2); banner.rotation.y = Math.PI; root.add(banner);
  const flagCols = [0xc02020, 0xffffff, 0x2040b0, 0xf0c040, 0x2a8a3a];
  const flags = [];
  for (let i = 0; i < 12; i++){
    const z = A.z0 + 2 + i * 3.3, x = A.x1 + 1.5;
    B.cyl(0.04, 0.03, 6, M.white, x, 3, z, 6);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.6, 6, 1), mat('plain-flag' + (i % 5), { color: flagCols[i % 5], rough: 0.8, side: THREE.DoubleSide }));
    f.position.set(x, 5.6, z + 0.5); f.rotation.y = Math.PI / 2; root.add(f); flags.push(f);
  }
  world.animated.push((dt, t) => {
    for (let i = 0; i < flags.length; i++){
      const p = flags[i].geometry.attributes.position;
      for (let k = 0; k < p.count; k++){ const x = p.getX(k) + 0.5; p.setZ(k, Math.sin(t * 4 + x * 5 + i) * 0.08 * x); }
      p.needsUpdate = true;
    }
  });
  // spectators: seated people, two instanced meshes (bodies and heads) with a colour each
  const R = rng(9);
  const bodyG = new THREE.CapsuleGeometry(0.17, 0.35, 3, 8), headG = new THREE.SphereGeometry(0.11, 10, 8);
  const shirts = [0xc04040, 0x3060c0, 0xe0c040, 0x40a060, 0xffffff, 0x404040, 0xe080a0], skins = [0xf0c8a0, 0xd0a070, 0x8a5a3a, 0xf4d4b4];
  const seats = [];
  for (const x of [34, 50, 66]) for (let r = 0; r < 4; r++) for (let i = 0; i < 9; i++){ if (R() < 0.35) continue; seats.push([x - 5.2 + i * 1.3 + (R() - 0.5) * 0.3, 0.45 + r * 0.45, 76 + r * 0.7, R() * 6]); }
  const bodies = new THREE.InstancedMesh(bodyG, new THREE.MeshStandardMaterial({ roughness: 0.8 }), seats.length);
  const heads = new THREE.InstancedMesh(headG, new THREE.MeshStandardMaterial({ roughness: 0.6 }), seats.length);
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  seats.forEach(([x, y, z], i) => {
    bodies.setMatrixAt(i, m4.makeTranslation(x, y + 0.4, z)); bodies.setColorAt(i, col.set(shirts[i % 7]));
    heads.setMatrixAt(i, m4.makeTranslation(x, y + 0.88, z)); heads.setColorAt(i, col.set(skins[i % 4]));
  });
  bodies.castShadow = true; root.add(bodies, heads);
  world.cheer = 0;
  world.animated.push((dt, t) => {
    const was = world.cheer > 0;
    world.cheer = Math.max(0, world.cheer - dt);
    if (!was) return;
    seats.forEach(([x, y, z, ph], i) => {
      const j = world.cheer > 0 ? Math.abs(Math.sin(t * 9 + ph)) * 0.15 : 0;
      bodies.setMatrixAt(i, m4.makeTranslation(x, y + 0.4 + j, z)); heads.setMatrixAt(i, m4.makeTranslation(x, y + 0.88 + j, z));
    });
    bodies.instanceMatrix.needsUpdate = true; heads.instanceMatrix.needsUpdate = true;
  });
  // show office / sign at the entrance
  const s = sign('SHOW ENTRANCE', 2.4, 0.5); s.position.set(28, 2.2, 33.6); s.rotation.y = Math.PI; root.add(s);
  B.box(0.12, 2.5, 0.12, M.oak, 26.6, 1.25, 33.7); B.box(0.12, 2.5, 0.12, M.oak, 29.4, 1.25, 33.7);
}

// ---------- animal pens ----------
function buildPens(B, root, world, M){
  world.pens = [];
  for (const P of PENS){
    const W = P.x1 - P.x0;
    // side 0 is z = z0 (north) from x0 to x1; side 2 is z = z1 (south) from x1 to x0
    const small = P.kind === 'chicken';
    fenceRect(B, P, { rails: small ? 0 : 4, h: small ? 1.6 : 1.1, mat: M.oak, spacing: 2.2 }, { side: 2, t0: 0.42, t1: 0.58 });
    if (small){
      // chicken wire: a see-through mesh on each side
      const wire = mat('plain-wire', { color: 0x9a9a9a, rough: 0.5, metal: 0.6, side: THREE.DoubleSide });
      const wm = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.5, roughness: 0.5, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false });
      for (const [a, b] of [[[P.x0, P.z0], [P.x1, P.z0]], [[P.x1, P.z0], [P.x1, P.z1]], [[P.x0, P.z0], [P.x0, P.z1]]]){
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.5), wm); m.position.set((a[0] + b[0]) / 2, 0.75, (a[1] + b[1]) / 2); m.rotation.y = a[0] === b[0] ? Math.PI / 2 : 0; root.add(m);
      }
      for (const seg of [[P.x0, P.x0 + W * 0.42], [P.x0 + W * 0.58, P.x1]]){
        const len = seg[1] - seg[0];
        const m = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.5), wm); m.position.set((seg[0] + seg[1]) / 2, 0.75, P.z1); root.add(m);
      }
      B.box(W, 0.06, 0.06, M.oak, (P.x0 + P.x1) / 2, 1.55, P.z0); void wire;
    }
    // a shelter at the back
    const sx = (P.x0 + P.x1) / 2, sz = P.z0 + 1.6;
    if (P.kind === 'chicken'){
      // a coop on legs with a ramp and nest boxes
      B.box(3, 1.4, 2, M.barnRed, sx, 1.3, sz, 0, 0.3);
      B.box(3.4, 0.08, 2.4, M.roof, sx, 2.1, sz, 0, 0.5, 0.15);
      for (const ox of [-1.3, 1.3]) for (const oz of [-0.8, 0.8]) B.box(0.1, 0.6, 0.1, M.oak, sx + ox, 0.3, sz + oz);
      B.box(0.4, 0.04, 1.4, M.oak, sx + 0.8, 0.35, sz + 1.5, 0, 1, -0.55);
      B.box(0.9, 0.5, 0.5, M.oak, sx - 1.95, 1.05, sz);
      addBox(sx - 2.2, sx + 1.5, sz - 1, sz + 1, 2);
    } else {
      B.box(W - 1, 0.1, 3, M.roof, sx, 2.3, sz, 0, 0.5, 0.1);
      B.box(W - 1, 2.2, 0.12, M.oak, sx, 1.1, P.z0 + 0.15, 0, 0.3);
      for (const ox of [-(W - 1) / 2 + 0.1, (W - 1) / 2 - 0.1]) B.box(0.12, 2.3, 0.12, M.oak, sx + ox, 1.15, sz + 1.4);
    }
    // feed trough and water trough near the gate so you can fill them over the fence
    const feedPos = V(P.x0 + W * 0.3, 0, P.z1 - 0.8), waterPos = V(P.x0 + W * 0.72, 0, P.z1 - 0.8);
    B.box(1.4, 0.35, 0.5, M.oak, feedPos.x, 0.25, feedPos.z);
    const feed = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.04, 0.4), mat('hay', { rough: 0.95, color: P.kind === 'pig' ? 0xb08050 : P.kind === 'chicken' ? 0xd8b060 : 0xffffff })); feed.position.set(feedPos.x, 0.43, feedPos.z); root.add(feed);
    B.box(1.2, 0.45, 0.55, M.steel, waterPos.x, 0.25, waterPos.z);
    const water = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.02, 0.45), M.water); water.position.set(waterPos.x, 0.45, waterPos.z); root.add(water);
    // a pig needs a wallow
    let wallow = null;
    if (P.kind === 'pig'){
      wallow = new THREE.Mesh(new THREE.CircleGeometry(1.4, 24), mat('dirt', { color: 0x5a4028, rough: 0.2 })); wallow.rotation.x = -Math.PI / 2; wallow.position.set(P.x1 - 2.4, 0.03, (P.z0 + P.z1) / 2 + 1); root.add(wallow);
    }
    const lab = sign({ goat: 'GOATS', sheep: 'SHEEP', pig: 'PIGS', chicken: 'HENS' }[P.kind], 1, 0.3);
    lab.position.set(P.x0 + W * 0.42 - 0.6, 1.25, P.z1 + 0.06); root.add(lab);
    world.pens.push({ ...P, feedPos, waterPos, feed, water, wallow, droppings: [], center: V(sx, 0, (P.z0 + P.z1) / 2 + 1) });
  }
}

// ---------- the farmhouse ----------
function buildHouse(B, root, world, M){
  const hx = -17, hz = 12, W = 9, D = 8, H = 5.6;
  B.box(W + 0.4, 0.6, D + 0.4, M.stone, hx, 0.3, hz);
  B.box(W, H, D, M.clap, hx, 0.6 + H / 2, hz, 0, 0.35);
  // gable roof with shingles
  const ang = 0.62, half = D / 2 + 0.5, slope = half / Math.cos(ang);
  for (const s of [-1, 1]){
    B.box(W + 1, 0.12, slope, M.shingles, hx, 0.6 + H + Math.tan(ang) * half / 2 - 0.2, hz + s * half / 2, 0, 0.4, s * ang);
  }
  const gable = new THREE.Shape([new THREE.Vector2(-D / 2, 0), new THREE.Vector2(D / 2, 0), new THREE.Vector2(0, Math.tan(ang) * D / 2)]);
  for (const s of [-1, 1]){
    const g = new THREE.ShapeGeometry(gable); const uv = g.attributes.uv, p = g.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) * 0.35, p.getY(i) * 0.35);
    B.add(g, M.clap, new THREE.Matrix4().makeTranslation(hx + s * W / 2, 0.6 + H, hz).multiply(new THREE.Matrix4().makeRotationY(s * Math.PI / 2)));
  }
  B.box(0.6, 2, 0.6, M.stone, hx - 2.5, 0.6 + H + 1.6, hz - 1.5);    // chimney
  // windows and door on the east face (toward the yard)
  const ex = hx + W / 2 + 0.03;
  for (const [y, z] of [[2.0, hz - 2.6], [2.0, hz + 2.6], [4.6, hz - 2.6], [4.6, hz + 2.6], [4.6, hz]]){
    B.box(0.05, 1.3, 1.0, M.glass, ex, y, z);
    B.box(0.1, 0.1, 1.2, M.trim, ex + 0.03, y + 0.7, z); B.box(0.1, 0.1, 1.2, M.trim, ex + 0.03, y - 0.7, z);
    B.box(0.1, 1.4, 0.1, M.trim, ex + 0.03, y, z - 0.55); B.box(0.1, 1.4, 0.1, M.trim, ex + 0.03, y, z + 0.55);
    B.box(0.08, 1.4, 0.45, M.green, ex + 0.04, y, z - 0.85); B.box(0.08, 1.4, 0.45, M.green, ex + 0.04, y, z + 0.85);
  }
  B.box(0.06, 2.2, 1.1, mat('plain-door', { color: 0x7a2a1a, rough: 0.6 }), ex, 1.7, hz);
  // porch with posts and a roof
  B.box(2.6, 0.15, W - 0.6, M.oak, ex + 1.3, 0.55, hz, 0, 0.5);
  for (const z of [hz - 4, hz - 1.3, hz + 1.3, hz + 4]) B.box(0.14, 2.8, 0.14, M.trim, ex + 2.45, 2.0, z);
  B.box(2.9, 0.12, W, M.shingles, ex + 1.35, 3.45, hz, 0, 0.5, -0.2);
  B.box(0.9, 0.22, 1.4, M.oak, ex + 3, 0.3, hz, 0, 0.5); B.box(0.5, 0.15, 1.4, M.oak, ex + 3.45, 0.1, hz, 0, 0.5);
  addBox(hx - W / 2 - 0.2, hx + W / 2 + 0.2, hz - D / 2 - 0.2, hz + D / 2 + 0.2, 5);
  // the farm office notice board on the porch: where you buy, sell and enter shows
  const bp = PLACES.board;
  B.box(0.1, 1.6, 0.1, M.oak, bp.x, 0.8, bp.z - 0.75); B.box(0.1, 1.6, 0.1, M.oak, bp.x, 0.8, bp.z + 0.75);
  const board = sign('FARM OFFICE', 1.5, 1.0, { font: 'bold 80px Georgia, serif', bg: '#3a2a1a', fg: '#f4e8c8', border: '#a07040' });
  board.position.set(bp.x + 0.06, 1.55, bp.z); board.rotation.y = Math.PI / 2; root.add(board);
  world.fixtures.board = { mesh: board, pos: V(bp.x + 0.1, 1.5, bp.z) };
  // mailbox at the end of the drive
  B.box(0.1, 1.1, 0.1, M.oak, 3.6, 0.55, 24.5); B.box(0.25, 0.25, 0.5, M.black, 3.6, 1.2, 24.5);
  const farmSign = sign('MY ANIMAL FARM', 3, 0.7, { font: 'bold 92px Georgia, serif', bg: '#f4efe2' });
  farmSign.position.set(-4.2, 2.1, 25.6); farmSign.rotation.y = Math.PI; root.add(farmSign);
  B.box(0.18, 2.6, 0.18, M.oak, -5.8, 1.3, 25.6); B.box(0.18, 2.6, 0.18, M.oak, -2.6, 1.3, 25.6); B.box(3.6, 0.15, 0.18, M.oak, -4.2, 2.55, 25.6);
  // the hitching rail by the barn, where horses are tied to be groomed and tacked up
  const rp = PLACES.rail;
  B.box(0.14, 1.2, 0.14, M.oak, rp.x - 1.3, 0.6, rp.z); B.box(0.14, 1.2, 0.14, M.oak, rp.x + 1.3, 0.6, rp.z);
  B.cyl(0.05, 0.05, 2.8, M.oak, rp.x, 1.12, rp.z, 10, 0, Math.PI / 2);
  addBox(rp.x - 1.4, rp.x + 1.4, rp.z - 0.1, rp.z + 0.1, 1.2);
  // a wheelbarrow parking spot and a tool rack by the back door are made by the items module
}

// ---------- trees, hedges, far fields ----------
function buildSurroundings(B, root, world, M, R){
  // trees: instanced, two meshes (trunk and crown) per kind
  const trunkG = new THREE.CylinderGeometry(0.18, 0.32, 4, 8); trunkG.translate(0, 2, 0);
  const crowns = [];
  for (let k = 0; k < 3; k++){
    const parts = [];
    for (let i = 0; i < 5; i++){
      const g = new THREE.IcosahedronGeometry(1.6 + R() * 0.9, 1);
      const p = g.attributes.position;
      for (let j = 0; j < p.count; j++){ const x = p.getX(j), y = p.getY(j), z = p.getZ(j), n = 0.75 + vnoise(x * 2 + k, z * 2 + y, 3) * 0.5; p.setXYZ(j, x * n, y * n * 0.85, z * n); }
      g.computeVertexNormals();
      const uv = g.attributes.uv; for (let j = 0; j < uv.count; j++) uv.setXY(j, p.getX(j) * 0.6, p.getY(j) * 0.6 + p.getZ(j) * 0.3);
      g.translate((R() - 0.5) * 2.4, 4.6 + R() * 2.2, (R() - 0.5) * 2.4);
      parts.push(g);
    }
    crowns.push(mergeGeometries(parts));
  }
  const crownMat = new THREE.MeshStandardMaterial({ map: tex('leaves').map, color: 0xf0ffe0, roughness: 0.85, alphaTest: 0.45, side: THREE.DoubleSide });
  const solidCrown = new THREE.MeshStandardMaterial({ color: 0x4a6e30, roughness: 0.95 });
  const spots = [];
  const ok = (x, z) => {
    const boxes = [{ x0: -48, x1: 54, z0: -38, z1: 30 }, { x0: SHOW.x0 - 6, x1: SHOW.x1 + 6, z0: 22, z1: SHOW.z1 + 6 }, { x0: -95, x1: 125, z0: 22, z1: 32 }];
    return !boxes.some((b) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1);
  };
  // a row of big shade trees along the drive and by the house, then woods around
  for (const [x, z] of [[-7, 22], [6, 22], [-25, 18], [-26, 4], [-8, -32], [40, -14], [52, -2], [-24, 22]]) spots.push([x, z, 1.15]);
  for (let i = 0; i < 260; i++){
    const a = R() * Math.PI * 2, d = 70 + R() * 140, x = 15 + Math.cos(a) * d, z = 15 + Math.sin(a) * d;
    if (ok(x, z)) spots.push([x, z, 0.8 + R() * 0.6]);
  }
  for (let i = 0; i < 40; i++){ const x = -90 + R() * 200, z = 34 + R() * 60; if (ok(x, z)) spots.push([x, z, 0.8 + R() * 0.5]); }
  const per = Math.ceil(spots.length / 3);
  const trunkMesh = new THREE.InstancedMesh(trunkG, M.bark, spots.length);
  const crownMeshes = crowns.map((g, k) => new THREE.InstancedMesh(g, k === 0 ? crownMat : crownMat, per));
  // the inner crowns are much simpler (they're only there so the trees aren't see-through)
  const inner = [0, 1, 2].map((k) => { const g = new THREE.IcosahedronGeometry(2.6, 0); g.scale(1, 0.8, 1); g.translate(0, 5.4, 0); return g; });
  const solid = inner.map((g) => new THREE.InstancedMesh(g, solidCrown, per));
  const counts = [0, 0, 0];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  spots.forEach(([x, z, s], i) => {
    const k = i % 3;
    q.setFromAxisAngle(V(0, 1, 0), R() * 6.28);
    m4.compose(V(x, 0, z), q, V(s, s, s));
    trunkMesh.setMatrixAt(i, m4);
    // an inner solid crown so trees don't look see-through, and the leafy one slightly bigger
    solid[k].setMatrixAt(counts[k], new THREE.Matrix4().compose(V(x, 0.2 * s, z), q, V(s * 0.86, s * 0.9, s * 0.86)));
    crownMeshes[k].setMatrixAt(counts[k]++, m4);
    if (Math.hypot(x - 10, z - 5) < 60) addCircle(x, z, 0.35 * s, 4);
  });
  crownMeshes.forEach((m, k) => { m.count = counts[k]; m.castShadow = true; m.receiveShadow = true; root.add(m); });
  solid.forEach((m, k) => { m.count = counts[k]; m.castShadow = false; root.add(m); });
  trunkMesh.castShadow = true; root.add(trunkMesh);
  // a long wooden boundary fence along the lane
  fence(B, V(-90, 0, 23), V(-6, 0, 23), { rails: 3, h: 1.2, mat: M.oak, spacing: 3, collide: true });
  fence(B, V(6, 0, 23), V(24, 0, 23), { rails: 3, h: 1.2, mat: M.oak, spacing: 3, collide: true });
  fence(B, V(32, 0, 23), V(120, 0, 23), { rails: 3, h: 1.2, mat: M.oak, spacing: 3, collide: true });
  // hay bales out in a field (round ones)
  const roundG = new THREE.CylinderGeometry(0.75, 0.75, 1.2, 20); roundG.rotateZ(Math.PI / 2);
  for (const [x, z] of [[-60, -40], [-56, -44], [-64, -46], [62, -30], [66, -26]]){
    const b = new THREE.Mesh(roundG, M.hay); b.position.set(x, 0.75, z); b.rotation.y = R() * 3; b.castShadow = true; root.add(b);
    addCircle(x, z, 0.8, 1.5);
  }
}

// ---------- grass tufts ----------
function buildGrass(root, M){
  // a clump of a dozen blades, instanced many times around the farm (not on paths, sand or in buildings)
  const blades = [];
  const R = rng(5);
  for (let i = 0; i < 12; i++){
    const h = 0.12 + R() * 0.16, w = 0.012 + R() * 0.008, a = R() * Math.PI * 2, r = R() * 0.08, lean = (R() - 0.5) * 0.5;
    const g = new THREE.BufferGeometry();
    const x = Math.cos(a) * r, z = Math.sin(a) * r, dx = Math.cos(a + 1.57) * w, dz = Math.sin(a + 1.57) * w, tx = Math.cos(a) * lean * h, tz = Math.sin(a) * lean * h;
    g.setAttribute('position', new THREE.Float32BufferAttribute([x - dx, 0, z - dz, x + dx, 0, z + dz, x + tx, h, z + tz], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
    const k = 0.5 + R() * 0.3;
    g.setAttribute('color', new THREE.Float32BufferAttribute([0.18 * k, 0.3 * k, 0.1 * k, 0.18 * k, 0.3 * k, 0.1 * k, 0.45 * k + 0.2, 0.6 * k + 0.2, 0.25 * k], 3));
    blades.push(g);
  }
  const geo = mergeGeometries(blades);
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
  const N = 9000;
  const inst = new THREE.InstancedMesh(geo, m, N);
  const no = [BARN, ARENA, SHOW, ...PENS, { x0: -8.5, x1: 8.5, z0: -4, z1: 8.5 }, { x0: -3.5, x1: 3.5, z0: 8, z1: 30 }, { x0: -95, x1: 125, z0: 23.5, z1: 30.5 },
    { x0: -22, x1: -11.5, z0: 7.5, z1: 16.5 }, { x0: -10.5, x1: -2.5, z0: 13.5, z1: 20.5 }, { x0: -15, x1: -7.5, z0: -6.5, z1: 1.5 }, { x0: 3.5, x1: 10.5, z0: -3, z1: 1 }, { x0: -2, x1: 8, z0: -31, z1: -22 }, { x0: 7.5, x1: 10.7, z0: -36, z1: 0 }, { x0: 9.5, x1: 37, z0: -22, z1: -20 }];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  let n = 0;
  for (let i = 0; i < N * 3 && n < N; i++){
    const x = -50 + R() * 140, z = -40 + R() * 80;
    if (no.some((b) => x > b.x0 - 0.3 && x < b.x1 + 0.3 && z > b.z0 - 0.3 && z < b.z1 + 0.3)) continue;
    // thicker by the fences and in the far fields
    if (fbm(x * 0.15, z * 0.15, 2, 8) < 0.38) continue;
    const s = 0.7 + R() * 0.9;
    q.setFromAxisAngle(V(0, 1, 0), R() * 6.28);
    m4.compose(V(x, 0, z), q, V(s, s * (0.8 + R() * 0.6), s));
    inst.setMatrixAt(n++, m4);
  }
  inst.count = n; inst.receiveShadow = true;
  root.add(inst);
}
