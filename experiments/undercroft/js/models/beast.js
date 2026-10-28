// The Undercroft's beast, from an 8-year-old's drawing: a very tall four-legged thing with a horse's barrel,
// a swan's S-shaped neck, a hooked beak that opens wide, a curled horn, two tall spiked wings standing up
// like arches, a heavy hanging tail, and iron coil springs between its ankles and its flat flipper feet.
//
// It's one SkinnedMesh with a material group per surface (hide, ivory, wing membrane, eyes, hair, iron),
// so it costs six draw calls. The body and the head are sculpted as signed distance fields (anatomy built
// from capsules and ellipsoids melted together: ribs, spine, shoulder blades, hip bones, muscles) and turned
// into triangles with surface nets. Everything else (beak, horn, wing bones, spikes, springs, feet, tail
// hair) is swept along curves. All of it is skinned to one skeleton, so update() only turns bones.
// The hide has no UVs: wrinkles, scales and mottling come from beast_skin.jpg projected from three sides
// in bind-pose space, so the texture rides along with the skin.
import * as THREE from 'three';

const TEX = '/experiments/undercroft/tex/';
const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/* ---------------- skeleton ----------------
   Joint positions in the bind pose, in metres (origin on the ground between the feet, facing +Z).
   Every bone binds with no rotation, so update() rotations are about the body's own axes. */
const J = {
  body: [0, 2.55, 0],
  neck0: [0, 2.92, 1.32], neck1: [0, 3.6, 1.98], neck2: [0, 4.35, 2.06], neck3: [0, 5.0, 1.8],
  head: [0, 5.5, 1.95], jaw: [0, 5.55, 2.12],
  tail0: [0, 2.92, -1.72], tail1: [0, 2.56, -2.12], tail2: [0, 1.8, -2.3], tail3: [0, 1.05, -2.36],
};
// legs: hip/shoulder, knee, ankle. The spring hangs from the ankle; the foot sits under it.
const SPRING_LEN = 0.32, FOOT_Y = 0.13;
const LEGS = [
  { n: 'FL', hip: [0.42, 2.3, 1.15], knee: [0.42, 1.32, 1.15], ankle: [0.42, 0.45, 1.15], front: true },
  { n: 'FR', hip: [-0.42, 2.3, 1.15], knee: [-0.42, 1.32, 1.15], ankle: [-0.42, 0.45, 1.15], front: true },
  { n: 'HL', hip: [0.4, 2.4, -1.32], knee: [0.42, 1.3, -1.32], ankle: [0.42, 0.45, -1.32], front: false },
  { n: 'HR', hip: [-0.4, 2.4, -1.32], knee: [-0.42, 1.3, -1.32], ankle: [-0.42, 0.45, -1.32], front: false },
];
// wings (left = +X; the right one is mirrored): root on the back, wrist high up, three fingers fanning back.
// Finger curves are quadratic beziers relative to the wrist: [control, tip].
const WING_ROOT = [0.3, 3.0, 0.72], WRIST = [0.52, 5.12, 0.55];
const FINGERS = [
  [[0.1, 0.95, -1.05], [0.3, -0.55, -2.7]],   // the long top finger: the back half of the arch
  [[0.08, -0.15, -1.0], [0.22, -1.3, -2.2]],
  [[0.05, -0.75, -0.55], [0.12, -1.78, -1.2]],
];
const BACK_EDGE = [-0.03, 0.06, -1.75];       // where the membrane meets the back, relative to the root

const BONES = []; const BI = {};
function bone(name, parent, pos){ BI[name] = BONES.length; BONES.push({ name, parent, pos }); }
bone('body', null, J.body);
bone('neck0', 'body', J.neck0); bone('neck1', 'neck0', J.neck1); bone('neck2', 'neck1', J.neck2); bone('neck3', 'neck2', J.neck3);
bone('head', 'neck3', J.head); bone('jaw', 'head', J.jaw);
bone('tail0', 'body', J.tail0); bone('tail1', 'tail0', J.tail1); bone('tail2', 'tail1', J.tail2); bone('tail3', 'tail2', J.tail3);
for (const L of LEGS){
  bone(L.n + 'up', 'body', L.hip); bone(L.n + 'lo', L.n + 'up', L.knee);
  bone(L.n + 'spring', L.n + 'lo', L.ankle); bone(L.n + 'foot', L.n + 'lo', [L.ankle[0], FOOT_Y, L.ankle[2]]);
}
for (const s of [1, -1]){
  const S = s > 0 ? 'L' : 'R', M = (p) => [p[0] * s, p[1], p[2]];
  bone('w' + S + 'root', 'body', M(WING_ROOT)); bone('w' + S + 'wrist', 'w' + S + 'root', M(WRIST));
  for (let f = 0; f < 3; f++) bone('w' + S + 'f' + f, 'w' + S + 'wrist', M(WRIST));
}
const NEIGH = BONES.map((b, i) => { const n = [i]; if (b.parent) n.push(BI[b.parent]); BONES.forEach((c, j) => { if (c.parent === b.name) n.push(j); }); return n; });

/* ---------------- noise ---------------- */
function hash3(i, j, k){ const n = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453; return n - Math.floor(n); }
function vnoise(x, y, z){
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const l = lerp;
  return l(l(l(hash3(ix, iy, iz), hash3(ix + 1, iy, iz), fx), l(hash3(ix, iy + 1, iz), hash3(ix + 1, iy + 1, iz), fx), fy),
           l(l(hash3(ix, iy, iz + 1), hash3(ix + 1, iy, iz + 1), fx), l(hash3(ix, iy + 1, iz + 1), hash3(ix + 1, iy + 1, iz + 1), fx), fy), fz);
}
const fbm = (x, y, z) => vnoise(x, y, z) * 0.55 + vnoise(x * 2.1, y * 2.1, z * 2.1) * 0.3 + vnoise(x * 4.3, y * 4.3, z * 4.3) * 0.15;

/* ---------------- signed distance sculpting ----------------
   A primitive is { op: add|sub, bone, k (blend radius), f(x,y,z) -> distance, box }. The box lets the
   field skip primitives that can't change the result at a point. */
function smin(a, b, k){ const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
function smax(a, b, k){ return -smin(-a, -b, k); }
// tapered capsule a -> b, radius r1 -> r2; sx < 1 squeezes it sideways (necks are deeper than wide)
function cap(bone, a, b, r1, r2, k, o = {}){
  const sx = o.sx || 1, sy = o.sy || 1, disp = o.disp;
  const bx = (b[0] - a[0]) / sx, by = (b[1] - a[1]) / sy, bz = b[2] - a[2], bb = bx * bx + by * by + bz * bz || 1e-9;
  const f = (x, y, z) => {
    const px = (x - a[0]) / sx, py = (y - a[1]) / sy, pz = z - a[2];
    const t = clamp((px * bx + py * by + pz * bz) / bb, 0, 1);
    const dx = px - bx * t, dy = py - by * t, dz = pz - bz * t;
    let d = (Math.sqrt(dx * dx + dy * dy + dz * dz) - (r1 + (r2 - r1) * t)) * Math.min(1, sx, sy);
    if (disp) d += disp(x, y, z, t);
    return d;
  };
  const r = Math.max(r1, r2) + (o.amp || 0) + k;
  return { op: o.sub ? 'sub' : 'add', bone, k, f, box: [Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, Math.min(a[2], b[2]) - r, Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r, Math.max(a[2], b[2]) + r] };
}
// ellipsoid with optional tilt about X (pitch) and Z (roll), and an optional surface displacement
function ell(bone, c, r, k, o = {}){
  const rx = o.rx || 0, rz = o.rz || 0, cx = Math.cos(rx), sxr = Math.sin(rx), cz = Math.cos(rz), szr = Math.sin(rz), disp = o.disp;
  const f = (x, y, z) => {
    let px = x - c[0], py = y - c[1], pz = z - c[2];
    if (rz){ const t = px * cz + py * szr; py = -px * szr + py * cz; px = t; }
    if (rx){ const t = py * cx + pz * sxr; pz = -py * sxr + pz * cx; py = t; }
    const ax = px / r[0], ay = py / r[1], az = pz / r[2];
    const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
    const k1 = Math.sqrt(ax * ax / (r[0] * r[0]) + ay * ay / (r[1] * r[1]) + az * az / (r[2] * r[2])) || 1e-9;
    let d = k0 * (k0 - 1) / k1;
    if (disp) d += disp(x, y, z);
    return d;
  };
  const m = Math.max(r[0], r[1], r[2]) + (o.amp || 0) + k;
  return { op: o.sub ? 'sub' : 'add', bone, k, f, box: [c[0] - m, c[1] - m, c[2] - m, c[0] + m, c[1] + m, c[2] + m] };
}
function field(prims){
  return (x, y, z) => {
    let d = 1e9;
    for (let i = 0; i < prims.length; i++){
      const p = prims[i], b = p.box;
      const ox = Math.max(b[0] - x, 0, x - b[3]), oy = Math.max(b[1] - y, 0, y - b[4]), oz = Math.max(b[2] - z, 0, z - b[5]);
      const lb = Math.sqrt(ox * ox + oy * oy + oz * oz);
      if (p.op === 'add'){ if (lb > d + p.k) continue; d = smin(d, p.f(x, y, z), p.k); }
      else { if (lb > 0) continue; d = smax(d, -p.f(x, y, z), p.k); }
    }
    return d;
  };
}
const mirror = (fn) => [fn(1, 'L'), fn(-1, 'R')];
const X = (s, p) => [p[0] * s, p[1], p[2]];

// The body: barrel, ribs, spine, shoulder blades, hip bones, haunches, legs, neck and tail dock.
function bodyPrims(){
  const P = [];
  // ribs show through the flanks of the deep chest: ridges that sweep back as they go down
  const ribs = (x, y, z) => {
    const m = sstep(0.22, 0.42, Math.abs(x)) * sstep(1.98, 2.3, y) * (1 - sstep(2.8, 3.02, y)) * sstep(-0.6, -0.2, z) * (1 - sstep(0.75, 1.1, z));
    if (m <= 0) return 0;
    const w = 0.5 + 0.5 * Math.sin((z + (3.0 - y) * 0.32) * TAU / 0.25);
    return -0.03 * m * w * w * w + 0.012 * m;
  };
  P.push(ell('body', [0, 2.55, 0.5], [0.5, 0.62, 1.05], 0.3, { disp: ribs, amp: 0.03 }));      // ribcage
  P.push(ell('body', [0, 2.66, -0.62], [0.42, 0.46, 0.95], 0.3));                            // loins, tucked-up belly
  P.push(ell('body', [0, 2.68, -1.28], [0.46, 0.44, 0.6], 0.25));                            // croup
  P.push(ell('body', [0, 2.38, 1.3], [0.4, 0.48, 0.38], 0.22));                              // breast
  P.push(ell('body', [0, 2.98, 0.95], [0.28, 0.24, 0.55], 0.2));                             // withers
  // spine: a row of knuckled vertebrae along the top line, from withers to tail
  const knuckles = (x, y, z, t) => -0.02 * Math.pow(0.5 + 0.5 * Math.sin(z * TAU / 0.21), 3);
  P.push(cap('body', [0, 3.1, 1.15], [0, 3.02, 0.1], 0.07, 0.06, 0.06, { disp: knuckles, amp: 0.02 }));
  P.push(cap('body', [0, 3.02, 0.1], [0, 3.04, -0.95], 0.06, 0.06, 0.06, { disp: knuckles, amp: 0.02 }));
  P.push(cap('body', [0, 3.04, -0.95], [0, 3.06, -1.6], 0.06, 0.07, 0.06, { disp: knuckles, amp: 0.02 }));
  for (const [s] of [[1], [-1]]){
    P.push(ell('body', X(s, [0.36, 2.78, 0.95]), [0.1, 0.36, 0.22], 0.12, { rx: 0.35, rz: -0.2 * s }));   // shoulder blade
    P.push(ell('body', X(s, [0.37, 2.96, -0.92]), [0.12, 0.09, 0.13], 0.12));                            // hip bone point
    P.push(ell('body', X(s, [0.2, 2.68, -1.82]), [0.11, 0.12, 0.1], 0.12));                              // seat bone
    P.push(ell('body', X(s, [0.47, 2.32, -0.25]), [0.05, 0.25, 0.7], 0.2, { rx: 0.2 }));                  // flank fold
  }
  // legs: heavy muscle at the top, sinew and bone below the knee
  for (const L of LEGS){
    const s = Math.sign(L.hip[0]), up = L.n + 'up', lo = L.n + 'lo';
    if (L.front){
      P.push(ell(up, [L.hip[0], 2.0, 1.17], [0.19, 0.5, 0.24], 0.18));                                   // forearm muscle
      P.push(ell(up, [L.hip[0] - s * 0.02, 2.08, 0.9], [0.13, 0.22, 0.14], 0.12));                       // elbow
      P.push(cap(up, [L.hip[0], 1.95, 1.17], L.knee, 0.15, 0.1, 0.1));
    } else {
      P.push(ell(up, [L.hip[0] * 1.02, 2.28, -1.4], [0.21, 0.55, 0.33], 0.2));                            // haunch
      P.push(cap(up, [L.hip[0], 1.95, -1.42], L.knee, 0.17, 0.1, 0.1));
    }
    P.push(ell(lo, [L.knee[0], L.knee[1] - 0.02, L.knee[2] + (L.front ? 0.03 : -0.04)], [0.1, 0.13, 0.11], 0.06));  // knee knob
    P.push(cap(lo, L.knee, L.ankle, 0.075, 0.06, 0.05));                                                // cannon bone
    P.push(cap(lo, [L.knee[0], L.knee[1] - 0.1, L.knee[2] - 0.07], [L.ankle[0], L.ankle[1] + 0.12, L.ankle[2] - 0.065], 0.035, 0.03, 0.06));   // tendon
    P.push(ell(lo, [L.ankle[0], L.ankle[1] + 0.02, L.ankle[2] - 0.01], [0.085, 0.08, 0.09], 0.05));     // ankle knob
  }
  // neck: deep and narrow, with a ridge of vertebrae along its back and the windpipe in front
  const N = [J.neck0, J.neck1, J.neck2, J.neck3, J.head], R = [0.37, 0.3, 0.25, 0.21, 0.18];
  const nb = ['neck0', 'neck1', 'neck2', 'neck3'];
  P.push(cap('neck0', [0, 2.6, 1.0], J.neck0, 0.42, 0.37, 0.25, { sx: 0.85 }));
  for (let i = 0; i < 4; i++){
    const a = N[i], b = N[i + 1];
    P.push(cap(nb[i], a, b, R[i], R[i + 1], 0.12, { sx: 0.82 }));
    // the crest along the back of the neck (offset toward -Z, i.e. the outside of the S) and windpipe in front
    const back = (p) => [p[0], p[1] + 0.02, p[2] - 0.62 * R[i]], front = (p) => [p[0], p[1] - 0.03, p[2] + 0.75 * R[i]];
    const bump = (x, y, z, t) => -0.018 * Math.pow(0.5 + 0.5 * Math.sin(t * TAU * 3.5), 3);
    P.push(cap(nb[i], back(a), back(b), 0.075, 0.06, 0.08, { disp: bump, amp: 0.02 }));
    P.push(cap(nb[i], front(a), front(b), 0.06, 0.05, 0.1));
  }
  // tail dock
  P.push(cap('tail0', [0, 2.95, -1.6], J.tail1, 0.15, 0.1, 0.12));
  P.push(cap('tail1', J.tail1, [0, 2.2, -2.24], 0.1, 0.06, 0.06));
  return P;
}

// The head, sculpted finer: a long skull, a heavy brow over deep sockets, sunken temples, cheekbones, and a
// lower jaw split from the face by the mouth so it can drop open. The neck top overlaps the body's neck.
const EYE = [0.168, 5.705, 2.36], EYE_R = 0.05;
function headPrims(){
  const P = [];
  P.push(cap('neck3', J.neck3, J.head, 0.198, 0.168, 0.06, { sx: 0.82 }));
  P.push(ell('head', [0, 5.66, 2.1], [0.19, 0.19, 0.27], 0.1));                     // cranium
  P.push(ell('head', [0, 5.72, 1.97], [0.12, 0.12, 0.13], 0.08));                   // back of the skull
  P.push(ell('head', [0, 5.665, 2.5], [0.115, 0.095, 0.3], 0.1));                   // face, running into the beak
  P.push(cap('head', [0, 5.83, 1.98], [0, 5.79, 2.4], 0.035, 0.03, 0.06));           // ridge down the middle of the skull
  mirror((s) => {
    P.push(cap('head', X(s, [0.135, 5.775, 2.2]), X(s, [0.115, 5.765, 2.47]), 0.048, 0.04, 0.05));   // brow
    P.push(cap('head', X(s, [0.165, 5.6, 2.05]), X(s, [0.14, 5.62, 2.42]), 0.038, 0.03, 0.04));      // cheekbone
    P.push(ell('jaw', X(s, [0.15, 5.55, 2.1]), [0.065, 0.08, 0.1], 0.06));                            // jaw muscle
    P.push(cap('jaw', X(s, [0.13, 5.53, 2.0]), X(s, [0.07, 5.5, 2.66]), 0.05, 0.04, 0.05));           // jawbone
  });
  P.push(ell('jaw', [0, 5.47, 2.33], [0.1, 0.065, 0.3], 0.08));                       // throat pouch
  mirror((s) => {
    P.push(ell('head', X(s, EYE), [0.058, 0.052, 0.072], 0.025, { sub: true }));      // eye socket
    P.push(ell('head', X(s, [0.205, 5.71, 2.06]), [0.05, 0.08, 0.09], 0.05, { sub: true }));   // sunken temple
  });
  P.push(ell('jaw', [0, 5.565, 2.62], [0.135, 0.02, 0.48], 0.012, { sub: true }));   // the mouth
  return P;
}

/* ---------------- surface nets ----------------
   One vertex per grid cell the surface passes through, one quad per grid edge it crosses. Each vertex is
   then pulled onto the surface, and normals come straight from the field. */
function surfaceNets(sdf, lo, hi, cell){
  const nx = Math.ceil((hi[0] - lo[0]) / cell) + 1, ny = Math.ceil((hi[1] - lo[1]) / cell) + 1, nz = Math.ceil((hi[2] - lo[2]) / cell) + 1;
  const V = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++)
    V[i + nx * (j + ny * k)] = sdf(lo[0] + i * cell, lo[1] + j * cell, lo[2] + k * cell);
  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const cellV = new Int32Array(cx * cy * cz).fill(-1);
  const pos = [];
  const C = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const vals = new Float32Array(8);
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++){
    let neg = 0;
    for (let c = 0; c < 8; c++){ const v = V[(i + C[c][0]) + nx * ((j + C[c][1]) + ny * (k + C[c][2]))]; vals[c] = v; if (v < 0) neg++; }
    if (neg === 0 || neg === 8) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (let e = 0; e < 12; e++){
      const a = E[e][0], b = E[e][1], va = vals[a], vb = vals[b];
      if ((va < 0) === (vb < 0)) continue;
      const t = va / (va - vb);
      sx += C[a][0] + (C[b][0] - C[a][0]) * t; sy += C[a][1] + (C[b][1] - C[a][1]) * t; sz += C[a][2] + (C[b][2] - C[a][2]) * t; n++;
    }
    cellV[i + cx * (j + cy * k)] = pos.length / 3;
    pos.push(lo[0] + (i + sx / n) * cell, lo[1] + (j + sy / n) * cell, lo[2] + (k + sz / n) * cell);
  }
  const idx = [];
  const cv = (i, j, k) => cellV[i + cx * (j + cy * k)];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, d, c, a, c, b); else idx.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < cz; k++) for (let j = 1; j < cy; j++) for (let i = 0; i < cx; i++){
    const a = V[i + nx * (j + ny * k)] < 0, b = V[i + 1 + nx * (j + ny * k)] < 0;
    if (a !== b) quad(cv(i, j - 1, k - 1), cv(i, j, k - 1), cv(i, j, k), cv(i, j - 1, k), !a);
  }
  for (let k = 1; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 1; i < cx; i++){
    const a = V[i + nx * (j + ny * k)] < 0, b = V[i + nx * (j + 1 + ny * k)] < 0;
    if (a !== b) quad(cv(i - 1, j, k - 1), cv(i - 1, j, k), cv(i, j, k), cv(i, j, k - 1), !a);
  }
  for (let k = 0; k < cz; k++) for (let j = 1; j < cy; j++) for (let i = 1; i < cx; i++){
    const a = V[i + nx * (j + ny * k)] < 0, b = V[i + nx * (j + ny * (k + 1))] < 0;
    if (a !== b) quad(cv(i - 1, j - 1, k), cv(i, j - 1, k), cv(i, j, k), cv(i - 1, j, k), !a);
  }
  // pull each vertex onto the surface and take its normal from the field's gradient
  const nor = new Float32Array(pos.length), h = cell * 0.3;
  for (let p = 0; p < pos.length; p += 3){
    for (let it = 0; it < 2; it++){
      const x = pos[p], y = pos[p + 1], z = pos[p + 2];
      const gx = sdf(x + h, y, z) - sdf(x - h, y, z), gy = sdf(x, y + h, z) - sdf(x, y - h, z), gz = sdf(x, y, z + h) - sdf(x, y, z - h);
      const l = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
      nor[p] = gx / l; nor[p + 1] = gy / l; nor[p + 2] = gz / l;
      if (it === 0){
        const d = clamp(sdf(x, y, z), -cell * 0.5, cell * 0.5);
        pos[p] -= nor[p] * d; pos[p + 1] -= nor[p + 1] * d; pos[p + 2] -= nor[p + 2] * d;
      }
    }
  }
  // wind every triangle so it faces the way the field's normal does
  for (let t = 0; t < idx.length; t += 3){
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const d = fx * (nor[a] + nor[b] + nor[c]) + fy * (nor[a + 1] + nor[b + 1] + nor[c + 1]) + fz * (nor[a + 2] + nor[b + 2] + nor[c + 2]);
    if (d < 0){ const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp; }
  }
  return { pos: Float32Array.from(pos), nor, idx };
}

/* ---------------- geometry assembly ----------------
   Every piece writes into the shared buffers of the material it uses. A vertex has position, normal,
   uv (for the hide: x = how scaly, y = how wet; for membrane and hair: real texture coordinates),
   colour (baked shading), and up to four bone weights. */
const MAT = { skin: 0, ivory: 1, membrane: 2, eye: 3, hair: 4, iron: 5 };
class Buf {
  constructor(){ this.p = []; this.n = []; this.uv = []; this.c = []; this.si = []; this.sw = []; this.i = []; }
  get count(){ return this.p.length / 3; }
  vert(x, y, z, nx, ny, nz, u, v, r, g, b, w){
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, v); this.c.push(r, g, b);
    // w = [bone, weight, bone, weight, ...]
    let tot = 0; for (let k = 1; k < w.length; k += 2) tot += w[k];
    for (let k = 0; k < 4; k++){ this.si.push(k * 2 < w.length ? w[k * 2] : 0); this.sw.push(k * 2 < w.length ? w[k * 2 + 1] / tot : 0); }
  }
}
// area-weighted vertex normals for pieces built from triangles
function normalsFor(B, start, idxStart){
  const p = B.p, n = B.n;
  for (let v = start; v < B.count; v++){ n[v * 3] = n[v * 3 + 1] = n[v * 3 + 2] = 0; }
  for (let t = idxStart; t < B.i.length; t += 3){
    const a = B.i[t] * 3, b = B.i[t + 1] * 3, c = B.i[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const q of [a, b, c]){ n[q] += nx; n[q + 1] += ny; n[q + 2] += nz; }
  }
  for (let v = start; v < B.count; v++){
    const l = Math.hypot(n[v * 3], n[v * 3 + 1], n[v * 3 + 2]) || 1;
    n[v * 3] /= l; n[v * 3 + 1] /= l; n[v * 3 + 2] /= l;
  }
}
// Sweep a cross-section along a path. path(t) -> [x,y,z]; section(a, t) -> [side, up] offset for angle a.
// Frames are carried along the path from `up`. m points around (no seam vertex), n steps along.
function sweep(B, o){
  const { path, section, n, m } = o;
  const start = B.count, i0 = B.i.length;
  const P = [], T = [];
  for (let i = 0; i <= n; i++) P.push(path(i / n));
  for (let i = 0; i <= n; i++){
    const a = P[Math.max(0, i - 1)], b = P[Math.min(n, i + 1)];
    const t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(...t) || 1;
    T.push([t[0] / l, t[1] / l, t[2] / l]);
  }
  let U = o.up || [0, 1, 0];
  for (let i = 0; i <= n; i++){
    const t = T[i], d = U[0] * t[0] + U[1] * t[1] + U[2] * t[2];
    U = [U[0] - t[0] * d, U[1] - t[1] * d, U[2] - t[2] * d];
    const ul = Math.hypot(...U) || 1; U = [U[0] / ul, U[1] / ul, U[2] / ul];
    const S = [U[1] * t[2] - U[2] * t[1], U[2] * t[0] - U[0] * t[2], U[0] * t[1] - U[1] * t[0]];
    for (let j = 0; j < m; j++){
      const [sx, sy] = section(j / m * TAU, i / n);
      const x = P[i][0] + S[0] * sx + U[0] * sy, y = P[i][1] + S[1] * sx + U[1] * sy, z = P[i][2] + S[2] * sx + U[2] * sy;
      const col = o.color ? o.color(x, y, z, i / n, j / m) : [1, 1, 1];
      const uv = o.uv ? o.uv(x, y, z, i / n, j / m) : [0, 0.5];
      B.vert(x, y, z, 0, 0, 0, uv[0], uv[1], col[0], col[1], col[2], o.weights(x, y, z, i / n));
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++){
    const a = start + i * m + j, b = start + i * m + (j + 1) % m, c = a + m, d = b + m;
    B.i.push(a, b, c, b, d, c);
  }
  // close the ends with a fan
  for (const [end, ring] of [[o.cap0, 0], [o.cap1, n]]){
    if (!end) continue;
    const q = P[ring], col = o.color ? o.color(q[0], q[1], q[2], ring / n, 0) : [1, 1, 1];
    const c = B.count; B.vert(q[0], q[1], q[2], 0, 0, 0, 0, 0.5, col[0], col[1], col[2], o.weights(q[0], q[1], q[2], ring / n));
    for (let j = 0; j < m; j++){
      const a = start + ring * m + j, b = start + ring * m + (j + 1) % m;
      if (ring === 0) B.i.push(c, b, a); else B.i.push(c, a, b);
    }
  }
  normalsFor(B, start, i0);
  if (o.flip) for (let t = i0; t < B.i.length; t += 3){ const tmp = B.i[t + 1]; B.i[t + 1] = B.i[t + 2]; B.i[t + 2] = tmp; }
}
const bez = (a, c, b, t) => { const u = 1 - t; return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1], u * u * a[2] + 2 * u * t * c[2] + t * t * b[2]]; };
const rigid = (b) => () => [BI[b], 1];

// Skin weights for a sculpted mesh: find the nearest primitive's bone, then blend with its parent and
// children by how close their own primitives are (`soft` metres of falloff).
function sdfWeights(prims, x, y, z, soft){
  const best = new Float32Array(BONES.length).fill(1e9);
  let bi = 0, bd = 1e9;
  for (const P of prims){
    if (P.op !== 'add') continue;
    const d = P.f(x, y, z), b = BI[P.bone];
    if (d < best[b]) best[b] = d;
    if (d < bd){ bd = d; bi = b; }
  }
  const ws = [];
  for (const b of NEIGH[bi]){ const dd = best[b] - bd; if (dd < soft * 3) ws.push([b, Math.exp(-dd / soft)]); }
  ws.sort((a, b) => b[1] - a[1]);
  const out = [];
  for (let k = 0; k < Math.min(4, ws.length); k++) out.push(ws[k][0], ws[k][1]);
  return out;
}

// add a sculpted mesh to the hide buffer, with baked crease darkening, countershading and mottling
function addSculpt(B, prims, lo, hi, cell, soft, shade){
  const sdf = field(prims);
  const M = surfaceNets(sdf, lo, hi, cell);
  const base = B.count;
  for (let v = 0; v < M.pos.length / 3; v++){
    const x = M.pos[v * 3], y = M.pos[v * 3 + 1], z = M.pos[v * 3 + 2], nx = M.nor[v * 3], ny = M.nor[v * 3 + 1], nz = M.nor[v * 3 + 2];
    // ambient occlusion from the field: how open is it a little way out along the normal?
    let ao = 0;
    for (const d of [0.04, 0.12, 0.3]) ao += clamp(sdf(x + nx * d, y + ny * d, z + nz * d) / d, 0, 1);
    ao = Math.pow(ao / 3, 1.3);
    const s = shade(x, y, z, nx, ny, nz, ao);
    B.vert(x, y, z, nx, ny, nz, s[3], s[4], s[0], s[1], s[2], sdfWeights(prims, x, y, z, soft));
  }
  for (const i of M.idx) B.i.push(base + i);
}
// how the hide is coloured: dark grey-brown, a little lighter underneath, blotchy, darker in creases,
// scaly on the back and legs, wrinkled hide elsewhere; wetter round the mouth and underneath
function hideShade(x, y, z, nx, ny, nz, ao){
  const blot = fbm(x * 1.7 + 3, y * 1.7, z * 1.7), fine = fbm(x * 6, y * 6 + 7, z * 6);
  const under = sstep(0.1, -0.7, ny) * sstep(3.2, 2.0, y);
  let v = (0.32 + 0.68 * ao) * (0.7 + 0.45 * blot) * (0.9 + 0.2 * fine) * (1 + 0.35 * under);
  const crease = 1 - ao;
  let r = v * (1 + 0.25 * crease), g = v * (0.95 - 0.05 * crease), b = v * (0.92 - 0.1 * crease);
  // the gullet and gums: dark wet red
  const mouth = Math.abs(x) < 0.13 && z > 2.05 && Math.abs(y - (5.565 - (z - 2.1) * 0.02)) < 0.05 ? 1 : 0;
  if (mouth){ r = 0.55 * ao + 0.1; g = 0.12 * ao; b = 0.1 * ao; }
  const scaly = clamp(sstep(-0.1, 0.6, ny) * 0.8 + sstep(1.5, 0.6, y) + (y > 4.9 && ny > -0.2 ? 0.6 : 0) + (fbm(x * 3, y * 3, z * 3) - 0.5) * 0.8, 0, 1) * (1 - mouth);
  const wet = clamp(0.45 + under * 0.3 + (fbm(x * 2, y * 2 + 5, z * 2) - 0.5) + mouth + sstep(2.3, 2.9, z) * sstep(5.2, 5.6, y) * 0.5, 0, 1);
  return [r, g, b, scaly, wet];
}

/* ---------------- the other pieces ---------------- */
// hooked upper beak and the lower beak, with a row of serrated teeth along each cutting edge
function addBeak(B){
  const ivoryCol = (x, y, z, t) => { const d = 0.45 + 0.55 * sstep(0.0, 0.5, t); const n = 0.85 + 0.3 * fbm(x * 25, y * 25, z * 25); return [d * n * 1.02, d * n * 0.98, d * n * 0.9]; };
  // upper: from inside the face, forward, then hooking down hard at the tip
  const up = (t) => [0, 5.6 - 0.05 * t - 0.2 * Math.pow(sstep(0.55, 1, t), 1.6), 2.5 + 0.78 * t - 0.12 * Math.pow(sstep(0.7, 1, t), 2)];
  const uw = (t) => 0.105 * Math.pow(1 - t, 0.55) + 0.004, uh = (t) => 0.1 * Math.pow(1 - t, 0.7) + 0.006;
  sweep(B.ivory, { path: up, n: 22, m: 14, up: [0, 1, 0], cap0: true,
    section: (a, t) => { const s = Math.sin(a); return [uw(t) * Math.cos(a), s > 0 ? uh(t) * s : 0.18 * uh(t) * s - 0.01 * (1 - t)]; },
    weights: rigid('head'), color: ivoryCol });
  // lower: under the upper one, a little shorter, tip turned up
  const lp = (t) => [0, 5.555 - 0.06 * t + 0.03 * sstep(0.7, 1, t), 2.45 + 0.66 * t];
  const lw = (t) => 0.095 * Math.pow(1 - t, 0.6) + 0.004, lh = (t) => 0.07 * Math.pow(1 - t, 0.7) + 0.005;
  sweep(B.ivory, { path: lp, n: 18, m: 12, up: [0, 1, 0], cap0: true,
    section: (a, t) => { const s = Math.sin(a); return [lw(t) * Math.cos(a), s > 0 ? 0.15 * lh(t) * s : lh(t) * s]; },
    weights: rigid('jaw'), color: ivoryCol });
  // teeth: little hooked cones along both cutting edges
  const tooth = (base, dir, len, r, bone) => {
    sweep(B.ivory, { path: (t) => [base[0] + dir[0] * len * t, base[1] + dir[1] * len * t, base[2] + dir[2] * len * t + 0.012 * t * t],
      n: 2, m: 5, section: (a, t) => [Math.cos(a) * r * (1 - t), Math.sin(a) * r * (1 - t)], up: [0, 0, 1], cap0: true,
      weights: rigid(bone), color: (x, y, z, t) => { const v = 0.5 + 0.5 * t; return [v, v * 0.95, v * 0.82]; } });
  };
  for (const s of [1, -1]){
    for (let k = 0; k < 9; k++){
      const t = 0.08 + k * 0.075, p = up(t);
      tooth([s * uw(t) * 0.85, p[1] - 0.012, p[2]], [s * 0.15, -1, 0.15], 0.035 + 0.02 * Math.sin(k * 2.3) ** 2, 0.011, 'head');
    }
    for (let k = 0; k < 7; k++){
      const t = 0.1 + k * 0.1, p = lp(t);
      tooth([s * lw(t) * 0.8, p[1] + 0.008, p[2]], [s * 0.12, 1, 0.2], 0.03 + 0.015 * Math.sin(k * 1.7) ** 2, 0.01, 'jaw');
    }
  }
}
// the curled horn: rises from the top of the skull and rolls back on itself, ridged like a ram's
function addHorn(B){
  const base = [0, 5.84, 2.12], R0 = 0.17;
  const path = (t) => { const a = t * Math.PI * 1.75, r = R0 * (1 - 0.6 * t); return [0.02 * t, base[1] + r * Math.sin(a) + 0.04 * t, base[2] - R0 + r * Math.cos(a)]; };
  sweep(B.ivory, { path, n: 44, m: 10, up: [1, 0, 0], cap0: true,
    section: (a, t) => { const r = (0.065 * Math.pow(1 - t, 0.9) + 0.004) * (1 + 0.12 * Math.pow(Math.sin(t * 60), 2) * (1 - t)); return [Math.cos(a) * r, Math.sin(a) * r * 1.15]; },
    weights: rigid('head'), color: (x, y, z, t) => { const v = (0.35 + 0.65 * t) * (0.85 + 0.3 * fbm(x * 30, y * 30, z * 30)); return [v, v * 0.93, v * 0.8]; } });
  // a few short spikes along the brow and the back of the skull
  for (const [p, d, l] of [[[0.12, 5.79, 2.24], [0.5, 0.6, -0.6], 0.07], [[-0.12, 5.79, 2.24], [-0.5, 0.6, -0.6], 0.07], [[0.09, 5.8, 1.98], [0.5, 0.5, -0.8], 0.09], [[-0.09, 5.8, 1.98], [-0.5, 0.5, -0.8], 0.09]]){
    const l2 = Math.hypot(...d), dir = d.map((q) => q / l2);
    sweep(B.ivory, { path: (t) => [p[0] + dir[0] * l * t, p[1] + dir[1] * l * t - 0.01 * t * t, p[2] + dir[2] * l * t], n: 3, m: 6, cap0: true, up: [0, 0, 1],
      section: (a, t) => [Math.cos(a) * 0.022 * (1 - t), Math.sin(a) * 0.022 * (1 - t)], weights: rigid('head'), color: () => [0.6, 0.55, 0.47] });
  }
}
// glossy eyes with a slit pupil painted into the vertex colours (amber iris, black slit)
function addEyes(B){
  for (const s of [1, -1]){
    const c = X(s, EYE), start = B.count, i0 = B.i.length, nu = 14, nv = 10;
    for (let i = 0; i <= nv; i++) for (let j = 0; j < nu; j++){
      const th = i / nv * Math.PI, ph = j / nu * TAU;
      const nx = Math.sin(th) * Math.cos(ph), ny = Math.cos(th), nz = Math.sin(th) * Math.sin(ph);
      // eye looks out sideways and a little forward; the pupil is a vertical slit
      const lx = nx * s * 0.8 + nz * 0.6, ly = ny, lz = nz * 0.8 - nx * s * 0.6;
      const iris = sstep(0.55, 0.85, lx), slit = sstep(0.75, 0.95, lx) * (1 - sstep(0.04, 0.12, Math.abs(lz)));
      const v = iris * (1 - slit);
      B.vert(c[0] + nx * EYE_R, c[1] + ny * EYE_R, c[2] + nz * EYE_R, nx, ny, nz, 0, 0, 0.05 + 0.75 * v, 0.03 + 0.35 * v, 0.02 + 0.05 * v, [BI.head, 1]);
    }
    for (let i = 0; i < nv; i++) for (let j = 0; j < nu; j++){
      const a = start + i * nu + j, b = start + i * nu + (j + 1) % nu;
      B.i.push(a, b, a + nu, b, b + nu, a + nu);
    }
    normalsFor(B, start, i0);
  }
}
// wing bones, membranes and the spikes along the top of each arch
function addWings(B){
  for (const s of [1, -1]){
    const S = s > 0 ? 'L' : 'R', M = (p) => [p[0] * s, p[1], p[2]];
    const root = M(WING_ROOT), wrist = M(WRIST);
    const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    const armCtrl = add(M([(WING_ROOT[0] + WRIST[0]) / 2 + 0.1, (WING_ROOT[1] + WRIST[1]) / 2, (WING_ROOT[2] + WRIST[2]) / 2 + 0.22]), [0, 0, 0]);
    const arm = (t) => bez(root, armCtrl, wrist, t);
    const fing = FINGERS.map(([c, tip]) => (t) => bez(wrist, add(wrist, M(c)), add(wrist, M(tip)), t));
    const backEdge = (t) => [root[0] + BACK_EDGE[0] * s * t, root[1] + BACK_EDGE[1] * t - 0.05 * Math.sin(t * Math.PI), root[2] + BACK_EDGE[2] * t];
    const sparCol = (x, y, z, t) => { const v = 0.55 + 0.3 * fbm(x * 5, y * 5, z * 5); return [v, v * 0.95, v * 0.9]; };
    // arm and knuckle (hide covered, scaly)
    sweep(B.skin, { path: arm, n: 14, m: 8, cap0: true, section: (a, t) => { const r = 0.085 - 0.03 * t + 0.03 * Math.exp(-(((t - 0.97) / 0.06) ** 2)); return [Math.cos(a) * r, Math.sin(a) * r * 1.2]; },
      weights: (x, y, z, t) => t > 0.9 ? [BI['w' + S + 'root'], 1 - (t - 0.9) * 5, BI['w' + S + 'wrist'], (t - 0.9) * 5] : [BI['w' + S + 'root'], 1], color: sparCol, uv: () => [0.9, 0.5] });
    fing.forEach((fp, f) => {
      sweep(B.skin, { path: fp, n: 16, m: 7, section: (a, t) => { const r = 0.05 * (1 - t) + 0.008; return [Math.cos(a) * r, Math.sin(a) * r]; },
        weights: rigid('w' + S + 'f' + f), color: sparCol, uv: () => [0.8, 0.5] });
      // a hooked claw at each finger tip
      const tip = fp(1), d = fp(0.97), dir = [tip[0] - d[0], tip[1] - d[1], tip[2] - d[2]], dl = Math.hypot(...dir);
      sweep(B.ivory, { path: (t) => [tip[0] + dir[0] / dl * 0.14 * t, tip[1] + dir[1] / dl * 0.14 * t - 0.06 * t * t, tip[2] + dir[2] / dl * 0.14 * t], n: 4, m: 6, cap0: true,
        section: (a, t) => [Math.cos(a) * 0.022 * (1 - t), Math.sin(a) * 0.022 * (1 - t)], weights: rigid('w' + S + 'f' + f), color: () => [0.55, 0.5, 0.42] });
    });
    // membranes between neighbouring spars; the free edge scallops in between their tips. uv = position
    // in the wing's plane for the vein texture; weights blend across from one spar's bone to the other's.
    const pairs = [[fing[0], fing[1], 'f0', 'f1'], [fing[1], fing[2], 'f1', 'f2'], [fing[2], backEdge, 'f2', 'root']];
    for (const [A, Bc, ba, bb] of pairs){
      const start = B.membrane.count, i0 = B.membrane.i.length, nu = 13, nv = 9;
      for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++){
        const v = j / nv, u = i / nu;
        const uu = u * (1 - 0.22 * Math.sin(v * Math.PI) * u * u);      // scallop the trailing edge
        const pa = A(uu * 0.985), pb = Bc(uu * 0.985);
        const sag = 0.07 * Math.sin(v * Math.PI) * Math.sin(Math.min(1, u * 1.3) * Math.PI * 0.9);
        const x = lerp(pa[0], pb[0], v) - s * sag, y = lerp(pa[1], pb[1], v), z = lerp(pa[2], pb[2], v);
        const edge = Math.min(v, 1 - v, 1 - u);
        const sh = 0.55 + 0.45 * sstep(0.0, 0.25, edge);
        B.membrane.vert(x, y, z, 0, 0, 0, (z - root[2]) / 1.6, (y - root[1]) / 1.6, sh, sh, sh,
          [BI['w' + S + ba], 1 - v + 1e-4, BI['w' + S + bb], v + 1e-4]);
      }
      for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++){
        const a = start + i * (nv + 1) + j, b = a + 1, c = a + nv + 1, d = c + 1;
        if (s > 0) B.membrane.i.push(a, b, c, b, d, c); else B.membrane.i.push(a, c, b, b, c, d);
      }
      normalsFor(B.membrane, start, i0);
    }
    // spikes along the top of the arch: the arm's front edge and the top finger's upper edge
    const spikeRow = (curve, t0, t1, count, len, bone) => {
      for (let k = 0; k < count; k++){
        const t = lerp(t0, t1, (k + 0.5) / count), p = curve(t), q = curve(Math.min(1, t + 0.02)), pq = curve(Math.max(0, t - 0.02));
        const T = [q[0] - pq[0], q[1] - pq[1], q[2] - pq[2]], tl = Math.hypot(...T);
        // outward in the wing plane: rotate the tangent a quarter turn about X, away from the membrane
        let out = [0, T[2] / tl, -T[1] / tl];
        if (out[1] * 0.3 + out[2] < -0.2 && t < 0.5 && curve === arm) out = [0, -out[1], -out[2]];
        if (curve !== arm && out[1] < 0) out = [0, -out[1], -out[2]];
        const L = len * (0.7 + 0.5 * Math.sin(k * 2.7 + s) ** 2) * (1 - 0.4 * Math.abs(t - 0.5));
        const back = [T[0] / tl, T[1] / tl, T[2] / tl];  // rake toward the tip
        sweep(B.ivory, { path: (u) => [p[0] + s * 0.02 * u, p[1] + (out[1] * u + back[1] * 0.35 * u * u) * L, p[2] + (out[2] * u + back[2] * 0.35 * u * u) * L],
          n: 3, m: 6, cap0: true, up: [1, 0, 0],
          section: (a, u) => [Math.cos(a) * 0.035 * (1 - u) ** 1.2, Math.sin(a) * 0.05 * (1 - u) ** 1.2],
          weights: rigid(bone), color: (x, y, z, u) => { const v = 0.35 + 0.65 * u; return [v, v * 0.93, v * 0.8]; } });
      }
    };
    spikeRow(arm, 0.25, 0.95, 6, 0.26, 'w' + S + 'root');
    spikeRow(fing[0], 0.05, 0.9, 8, 0.3, 'w' + S + 'f0');
  }
}
// iron springs, the collars that hold them, and the flat ridged flipper feet with claws
function addLegsBelowAnkle(B){
  for (const L of LEGS){
    const a = L.ankle, sb = L.n + 'spring', fb = L.n + 'foot';
    const ironCol = (x, y, z) => { const r = fbm(x * 18, y * 18, z * 18); const v = 0.6 + 0.4 * r; return [v * (1 + 0.4 * r), v, v * (0.9 - 0.2 * r)]; };
    // collar round the ankle (rides with the lower leg)
    sweep(B.iron, { path: (t) => [a[0], a[1] + 0.05 - t * 0.09, a[2]], n: 3, m: 14, cap1: true,
      section: (ang, t) => { const r = 0.105 + 0.012 * Math.sin(t * Math.PI); return [Math.cos(ang) * r, Math.sin(ang) * r]; }, up: [0, 0, 1],
      weights: rigid(L.n + 'lo'), color: ironCol });
    // the coil: a heavy wire in a helix from just under the collar down to the foot plate
    const turns = 4.5, top = a[1] - 0.035, bot = FOOT_Y + 0.025;
    sweep(B.iron, { path: (t) => { const ang = t * turns * TAU; return [a[0] + Math.cos(ang) * 0.092, lerp(top, bot, t), a[2] + Math.sin(ang) * 0.092]; },
      n: 72, m: 6, up: [0, 1, 0], section: (ang) => [Math.cos(ang) * 0.024, Math.sin(ang) * 0.024],
      weights: rigid(sb), color: ironCol });
    // foot plate the spring sits on
    sweep(B.iron, { path: (t) => [a[0], FOOT_Y + 0.03 - t * 0.04, a[2]], n: 2, m: 14, cap0: true, cap1: true,
      section: (ang) => [Math.cos(ang) * 0.115, Math.sin(ang) * 0.115], up: [0, 0, 1], weights: rigid(fb), color: ironCol });
    // the flipper: a fan from the heel to a scalloped front edge, thick ridges running out to three claws
    const heel = [a[0], 0, a[2] - 0.16], toes = [-0.45, 0, 0.45], na = 18, nr = 9, start = B.skin.count, i0 = B.skin.i.length;
    const R = (an) => { let sc = 1; for (let k = 0; k < 2; k++){ const m0 = (toes[k] + toes[k + 1]) / 2; sc -= 0.13 * Math.exp(-(((an - m0) / 0.17) ** 2)); } return 0.78 * sc / Math.cos(an * 0.8); };
    const ridge = (an) => { let r = 0; for (const t of toes) r = Math.max(r, Math.exp(-(((an - t) / 0.07) ** 2))); return r; };
    const padTop = (an, r) => lerp(0.115, 0.022, Math.pow(r, 0.8)) + ridge(an) * 0.04 * (1 - r * 0.6);
    for (const side of [0, 1]){
      for (let i = 0; i <= nr; i++) for (let j = 0; j <= na; j++){
        const an = lerp(-0.62, 0.62, j / na), r = i / nr, rr = R(an) * r;
        const x = heel[0] + Math.sin(an) * rr, z = heel[2] + Math.cos(an) * rr;
        const y = side === 0 ? padTop(an, r) : 0.004 + 0.01 * r * r;
        const v = 0.45 + 0.25 * ridge(an) + 0.2 * fbm(x * 8, y * 8, z * 8);
        B.skin.vert(x, y, z, 0, 0, 0, 1, 0.7, v, v * 0.95, v * 0.9, [BI[fb], 1]);
      }
    }
    const row = na + 1, half = (nr + 1) * row;
    for (let i = 0; i < nr; i++) for (let j = 0; j < na; j++){
      const p = start + i * row + j;
      B.skin.i.push(p, p + row, p + 1, p + 1, p + row, p + row + 1);                  // top, facing up
      const q = p + half;
      B.skin.i.push(q, q + 1, q + row, q + 1, q + row + 1, q + row);                  // bottom, facing down
    }
    // rim: join the top and bottom round the outside edge
    for (let j = 0; j < na; j++){
      const t0 = start + nr * row + j, b0 = t0 + half;
      B.skin.i.push(t0, b0, t0 + 1, t0 + 1, b0, b0 + 1);
    }
    for (const sideLine of [0, na]) for (let i = 0; i < nr; i++){
      const t0 = start + i * row + sideLine, b0 = t0 + half;
      if (sideLine !== 0) B.skin.i.push(t0, t0 + row, b0, b0, t0 + row, b0 + row); else B.skin.i.push(t0, b0, t0 + row, b0, b0 + row, t0 + row);
    }
    normalsFor(B.skin, start, i0);
    // a hooked claw at the end of each ridge
    for (const an of toes){
      const rr = R(an) * 0.97, p = [heel[0] + Math.sin(an) * rr, 0.035, heel[2] + Math.cos(an) * rr], d = [Math.sin(an), 0, Math.cos(an)];
      sweep(B.ivory, { path: (t) => [p[0] + d[0] * 0.13 * t, p[1] + 0.01 * t - 0.035 * t * t, p[2] + d[2] * 0.13 * t], n: 4, m: 6, cap0: true, up: [0, 1, 0],
        section: (ang, t) => [Math.cos(ang) * 0.03 * (1 - t), Math.sin(ang) * 0.024 * (1 - t)], weights: rigid(fb), color: () => [0.42, 0.38, 0.32] });
    }
  }
}
// tail hair: long cards hanging from the dock, fanned round it, each a little different
function addTail(B){
  const n = 18, segs = 12;
  for (let k = 0; k < n; k++){
    const ang = (k / n) * Math.PI * 1.6 - Math.PI * 0.8 + Math.sin(k * 7.1) * 0.15;
    const len = 2.05 + 0.4 * Math.sin(k * 3.7) ** 2, w0 = 0.12, w1 = 0.26 + 0.08 * Math.sin(k * 5.3) ** 2;
    const root = [Math.sin(ang) * 0.06, 2.42 - 0.12 * (k % 3) * 0.3, -2.18 - Math.cos(ang) * 0.05];
    const sway = Math.sin(k * 2.3) * 0.12, start = B.hair.count, i0 = B.hair.i.length;
    for (let i = 0; i <= segs; i++){
      const t = i / segs;
      const cx = root[0] + Math.sin(ang) * 0.12 * t + sway * t * t, cy = root[1] - len * t, cz = root[2] - 0.32 * Math.sin(t * 2.2) - 0.05 * t;
      const w = lerp(w0, w1, Math.sin(Math.min(1, t * 1.4) * Math.PI * 0.5)) * (1 - 0.45 * t * t);
      // the card faces out from the tail's axis
      const ex = Math.cos(ang) * w * 0.5, ez = Math.sin(ang) * w * 0.5;
      // weights slide down the tail bones with height
      const yb = cy;
      const wt = yb > J.tail2[1] ? [BI.tail1, (yb - J.tail2[1]) / (J.tail1[1] - J.tail2[1]), BI.tail2, 1 - (yb - J.tail2[1]) / (J.tail1[1] - J.tail2[1])]
        : [BI.tail2, clamp((yb - J.tail3[1]) / (J.tail2[1] - J.tail3[1]), 0, 1), BI.tail3, 1 - clamp((yb - J.tail3[1]) / (J.tail2[1] - J.tail3[1]), 0, 1)];
      const v = 0.55 + 0.45 * t;
      B.hair.vert(cx - ex, cy, cz + ez, 0, 0, 0, (k % 4) * 0.25, t, v, v, v, wt);
      B.hair.vert(cx + ex, cy, cz - ez, 0, 0, 0, (k % 4) * 0.25 + 0.25, t, v, v, v, wt);
    }
    for (let i = 0; i < segs; i++){ const a = start + i * 2; B.hair.i.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    normalsFor(B.hair, start, i0);
  }
}

/* ---------------- building the shared geometry (once) ---------------- */
let GEO = null;
function buildGeometry(){
  const t0 = performance.now();
  const B = { skin: new Buf(), ivory: new Buf(), membrane: new Buf(), eye: new Buf(), hair: new Buf(), iron: new Buf() };
  const bp = bodyPrims();
  addSculpt(B.skin, bp, [-0.72, 0.36, -2.4], [0.72, 5.6, 2.25], 0.05, 0.07, hideShade);
  addSculpt(B.skin, headPrims(), [-0.27, 5.0, 1.62], [0.27, 6.0, 3.1], 0.019, 0.03, hideShade);
  addBeak(B); addHorn(B); addEyes(B.eye); addWings(B); addLegsBelowAnkle(B); addTail(B);
  // pack every buffer into one geometry, one group per material
  const order = ['skin', 'ivory', 'membrane', 'eye', 'hair', 'iron'];
  let nv = 0, ni = 0; for (const k of order){ nv += B[k].count; ni += B[k].i.length; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = new Float32Array(nv * 3);
  const si = new Uint16Array(nv * 4), sw = new Float32Array(nv * 4), idx = new Uint32Array(ni);
  const g = new THREE.BufferGeometry();
  let vo = 0, io = 0;
  order.forEach((k, m) => {
    const b = B[k];
    pos.set(b.p, vo * 3); nor.set(b.n, vo * 3); uv.set(b.uv, vo * 2); col.set(b.c, vo * 3); si.set(b.si, vo * 4); sw.set(b.sw, vo * 4);
    for (let i = 0; i < b.i.length; i++) idx[io + i] = b.i[i] + vo;
    g.addGroup(io, b.i.length, m);
    vo += b.count; io += b.i.length;
  });
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  g.userData.triangles = ni / 3;
  g.userData.buildMs = Math.round(performance.now() - t0);
  return g;
}

/* ---------------- materials ---------------- */
let TEXS = null;
function textures(){
  if (TEXS) return TEXS;
  const tl = new THREE.TextureLoader();
  const load = (n) => { const t = tl.load(TEX + n); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t; };
  TEXS = { skin: load('beast_skin.jpg'), membrane: load('beast_membrane.jpg'), hair: hairTexture() };
  return TEXS;
}
// tail hair strands drawn on a canvas: four strips side by side, each strand thinning to a ragged end
function hairTexture(){
  const W = 256, H = 512, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  g.clearRect(0, 0, W, H);
  for (let i = 0; i < 1400; i++){
    const strip = Math.floor(rnd() * 4), x0 = strip * 64 + 3 + rnd() * 58, len = H * (0.55 + rnd() * 0.45);
    const l = 6 + rnd() * 16, grey = rnd() < 0.06 ? 25 : 0;
    g.strokeStyle = `hsla(${20 + rnd() * 15}, ${10 + rnd() * 15}%, ${l + grey}%, ${0.5 + rnd() * 0.5})`;
    g.lineWidth = 0.6 + rnd() * 1.6;
    g.beginPath(); g.moveTo(x0, 0);
    const ph = rnd() * 6, amp = 1 + rnd() * 3;
    for (let y = 8; y < len; y += 8) g.lineTo(clamp(x0 + Math.sin(y * 0.02 + ph) * amp * (y / H) * 3, strip * 64 + 1, strip * 64 + 63), y);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// Shared shader patch for the hide, ivory and iron: triplanar detail from beast_skin.jpg in bind-pose space.
// Height (folds or scales, by uv.x) bumps the normal at real-world scale; mottling darkens the colour and
// varies roughness; uv.y says how wet the surface is (less rough, more clearcoat).
const DETAIL_VERT = ['varying vec3 vBP;', 'varying vec3 vBN;', 'varying vec2 vMask;'].join('\n');
const DETAIL_FRAG = /* glsl */`
uniform sampler2D detailMap;
uniform vec4 detailA;   // tiles per metre, bump depth (m), roughness variation, mottling strength
uniform vec4 detailB;   // cavity darkening, wet roughness, emissive flash, unused
uniform vec3 flashColor;
varying vec3 vBP; varying vec3 vBN; varying vec2 vMask;
vec4 triTex(vec3 p, vec3 w){
  return texture2D(detailMap, p.zy) * w.x + texture2D(detailMap, p.xz + 0.37) * w.y + texture2D(detailMap, p.xy + 0.71) * w.z;
}
float detailH(vec4 t){ return mix(t.r, t.g, vMask.x); }
vec3 bumpNormal(vec3 surfPos, vec3 n, float dHx, float dHy, float faceDir){
  vec3 sx = dFdx(surfPos), sy = dFdy(surfPos);
  vec3 r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1) * faceDir;
  vec3 grad = sign(det) * (dHx * r1 + dHy * r2);
  return normalize(abs(det) * n - grad);
}
`;
function detailMaterial(Kind, params, d){
  const m = new Kind(params);
  m.vertexColors = true;
  const T = textures();
  const u = { detailMap: { value: T.skin }, detailA: { value: new THREE.Vector4(...d.a) }, detailB: { value: new THREE.Vector4(...d.b) }, flashColor: { value: new THREE.Color(0.5, 0.03, 0.01) } };
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = DETAIL_VERT + '\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vBP = position; vBN = normal; vMask = uv;');
    sh.fragmentShader = DETAIL_FRAG + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 dW = pow(abs(normalize(vBN)), vec3(4.0)); dW /= (dW.x + dW.y + dW.z);
        vec3 dP = vBP * detailA.x;
        vec4 dT = triTex(dP, dW);
        float dH = detailH(dT);
        diffuseColor.rgb *= mix(1.0, 0.45 + 1.1 * dT.b, detailA.w) * mix(1.0 - detailB.x, 1.0, dH);
        float dWet = clamp(vMask.y + (1.0 - dH) * 0.25, 0.0, 1.0);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + (dT.b - 0.5) * detailA.z + (0.5 - dWet) * detailB.y + (1.0 - dH) * 0.1, 0.06, 1.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 dpx = dFdx(dP), dpy = dFdy(dP);
          float hx = detailH(triTex(dP + dpx, dW)) - dH, hy = detailH(triTex(dP + dpy, dW)) - dH;
          normal = bumpNormal(-vViewPosition, normal, hx * detailA.y, hy * detailA.y, faceDirection);
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += flashColor * detailB.z;`);
    if (sh.fragmentShader.includes('#include <lights_physical_fragment>'))
      sh.fragmentShader = sh.fragmentShader.replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
          material.clearcoat *= 0.25 + 0.75 * dWet;
        #endif`);
  };
  m.customProgramCacheKey = () => 'beast-detail';
  return m;
}

function makeMaterials(env){
  const T = textures();
  const envI = 0.55;
  const skin = detailMaterial(THREE.MeshPhysicalMaterial, {
    color: new THREE.Color(0x4e4640), roughness: 0.62, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.22,
    sheen: 0.35, sheenColor: new THREE.Color(0x5a4a44), sheenRoughness: 0.5, envMap: env, envMapIntensity: envI,
  }, { a: [1.15, 0.006, 0.35, 0.75], b: [0.5, 0.35, 0, 0] });
  const ivory = detailMaterial(THREE.MeshPhysicalMaterial, {
    color: new THREE.Color(0xb5a78a), roughness: 0.42, clearcoat: 0.3, clearcoatRoughness: 0.35, envMap: env, envMapIntensity: envI,
  }, { a: [3.0, 0.0012, 0.25, 0.4], b: [0.35, 0.2, 0, 0] });
  const iron = detailMaterial(THREE.MeshStandardMaterial, {
    color: new THREE.Color(0x4a443d), roughness: 0.5, metalness: 0.85, envMap: env, envMapIntensity: 0.9,
  }, { a: [4.0, 0.0008, 0.5, 0.8], b: [0.4, 0.3, 0, 0] });
  // wing membrane: thin leathery skin with veins; light from behind glows through it, blood-red
  const membrane = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(0x3d302c), roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.3,
    side: THREE.DoubleSide, vertexColors: true, envMap: env, envMapIntensity: envI });
  const mu = { memMap: { value: T.membrane }, transColor: { value: new THREE.Color(1.0, 0.22, 0.08).multiplyScalar(0.6) }, flashColor: { value: new THREE.Color(0, 0, 0) } };
  membrane.userData.u = mu;
  membrane.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, mu);
    sh.vertexShader = 'varying vec2 vMUv;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vMUv = uv;');
    sh.fragmentShader = 'uniform sampler2D memMap; uniform vec3 transColor; uniform vec3 flashColor; varying vec2 vMUv; float gTrans;\n' + sh.fragmentShader
      .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>
        void RE_Direct_Membrane(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight){
          RE_Direct_Physical(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
          float back = saturate(dot(-geometryNormal, directLight.direction));
          float through = 0.35 + 0.65 * pow(saturate(dot(geometryViewDir, -directLight.direction)), 3.0);
          reflectedLight.directDiffuse += directLight.color * back * through * transColor * gTrans;
        }
        #undef RE_Direct
        #define RE_Direct RE_Direct_Membrane`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec4 mT = texture2D(memMap, vMUv);
        diffuseColor.rgb *= (0.75 + 0.5 * mT.b) * (1.0 - 0.35 * mT.r);
        gTrans = (1.0 - 0.75 * mT.r) * (0.6 + 0.4 * mT.b) * vColor.r;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec2 ux = dFdx(vMUv), uy = dFdy(vMUv);
          float h0 = mT.r * 0.8 + mT.g * 0.4;
          vec4 tx = texture2D(memMap, vMUv + ux), ty = texture2D(memMap, vMUv + uy);
          float hx = tx.r * 0.8 + tx.g * 0.4 - h0, hy = ty.r * 0.8 + ty.g * 0.4 - h0;
          vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
          vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
          float det = dot(sx, r1);
          normal = normalize(abs(det) * normal - sign(det) * 0.004 * (hx * r1 + hy * r2));
        }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += flashColor;');
  };
  membrane.customProgramCacheKey = () => 'beast-membrane';
  // eyes: wet and glassy; the emissive glow follows the iris colour so the slit pupil stays dark-ish
  const eye = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.02, vertexColors: true,
    emissive: new THREE.Color(1.0, 0.16, 0.03), emissiveIntensity: 0.4, envMap: env, envMapIntensity: 1.2 });
  eye.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance *= (0.25 + 1.5 * vColor.r);');
  };
  eye.customProgramCacheKey = () => 'beast-eye';
  const hair = new THREE.MeshStandardMaterial({ map: T.hair, color: new THREE.Color(0.75, 0.7, 0.66), roughness: 0.55, alphaTest: 0.4,
    side: THREE.DoubleSide, vertexColors: true, envMap: env, envMapIntensity: 0.4 });
  return { list: [skin, ivory, membrane, eye, hair, iron], skin, ivory, membrane, eye, hair, iron };
}

/* ---------------- the beast ---------------- */
export function createBeast(opts = {}){
  if (!GEO) GEO = buildGeometry();
  const mats = makeMaterials(opts.env || null);
  const group = new THREE.Group();
  group.name = 'beast';
  // bones
  const bones = BONES.map((b) => { const o = new THREE.Bone(); o.name = b.name; return o; });
  BONES.forEach((b, i) => {
    const p = b.parent ? BONES[BI[b.parent]].pos : [0, 0, 0];
    bones[i].position.set(b.pos[0] - p[0], b.pos[1] - p[1], b.pos[2] - p[2]);
    (b.parent ? bones[BI[b.parent]] : group).add(bones[i]);
  });
  const B = (n) => bones[BI[n]];
  group.updateMatrixWorld(true);
  const mesh = new THREE.SkinnedMesh(GEO, mats.list);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 3.2, 0), 7);
  group.add(mesh);
  mesh.bind(new THREE.Skeleton(bones));
  const rest = bones.map((b) => b.position.clone());

  // attachment points
  const at = (boneName, world) => { const o = new THREE.Object3D(); const p = BONES[BI[boneName]].pos; o.position.set(world[0] - p[0], world[1] - p[1], world[2] - p[2]); B(boneName).add(o); return o; };
  const mouth = at('head', [0, 5.5, 3.02]); mouth.rotation.x = 0.12;
  const eyes = [at('head', [EYE[0], EYE[1], EYE[2]]), at('head', [-EYE[0], EYE[1], EYE[2]])];
  const parts = [];
  const part = (bn, world, radius, kind) => parts.push({ object: at(bn, world), radius, kind });
  part('body', [0, 2.55, 0.95], 0.75, 'body'); part('body', [0, 2.6, 0], 0.68, 'body'); part('body', [0, 2.65, -1.05], 0.68, 'body');
  part('neck1', [0, 3.95, 2.04], 0.36, 'neck'); part('neck2', [0, 4.7, 1.95], 0.3, 'neck'); part('neck3', [0, 5.25, 1.88], 0.27, 'neck');
  part('head', [0, 5.65, 2.45], 0.42, 'head');
  for (const S of ['L', 'R']){
    const s = S === 'L' ? 1 : -1;
    part('w' + S + 'wrist', [WRIST[0] * s, WRIST[1] - 0.3, WRIST[2] - 0.4], 0.6, 'wing');
    part('w' + S + 'f0', [(WRIST[0] + 0.15) * s, WRIST[1] - 0.2, WRIST[2] - 1.6], 0.65, 'wing');
  }
  for (const L of LEGS) part(L.n + 'lo', [L.knee[0], (L.knee[1] + L.ankle[1]) / 2 - 0.1, L.knee[2]], 0.42, 'leg');

  // leg lengths for the IK
  const legs = LEGS.map((L) => ({
    L, up: B(L.n + 'up'), lo: B(L.n + 'lo'), spring: B(L.n + 'spring'), foot: B(L.n + 'foot'),
    a: Math.hypot(L.knee[1] - L.hip[1], L.knee[2] - L.hip[2]), b: Math.hypot(L.ankle[1] - L.knee[1], L.ankle[2] - L.knee[2]),
    hipY: L.hip[1] - J.body[1], hipZ: L.hip[2], ankleLoY: L.ankle[1] - L.knee[1],
    // gait offsets: walk (lateral four-beat) and bound (front pair, then hind pair)
    walk: { HL: 0, FL: 0.25, HR: 0.5, FR: 0.75 }[L.n], bound: { FL: 0, FR: 0.06, HL: 0.5, HR: 0.56 }[L.n],
  }));
  const body = B('body'), neck = ['neck0', 'neck1', 'neck2', 'neck3'].map(B), head = B('head'), jaw = B('jaw');
  const tail = ['tail0', 'tail1', 'tail2', 'tail3'].map(B);
  const wings = ['L', 'R'].map((S) => ({ s: S === 'L' ? 1 : -1, root: B('w' + S + 'root'), wrist: B('w' + S + 'wrist'), f: [0, 1, 2].map((f) => B('w' + S + 'f' + f)) }));
  const st = { t: 0, phase: 0, beat: 0, bob: 0, swayV: 0, sway: 0 };
  const BODY_Y = 2.49;   // standing body height: legs a little bent so the springs carry the weight

  function update(dt, s = {}){
    dt = Math.min(dt || 0, 0.1);
    const speed = s.speed || 0, crouch = s.crouch || 0, air = s.airborne || 0, flap = s.flap || 0;
    const yaw = s.aimYaw || 0, pitch = s.aimPitch || 0, mo = s.mouth || 0, glow = s.eyeGlow || 0, hurt = s.hurt || 0, dead = s.dead || 0;
    st.t += dt;
    const live = 1 - sstep(0.0, 0.35, dead);
    const gal = sstep(3, 7, speed);
    const stride = lerp(2.4, 6.5, gal);
    st.phase = (st.phase + speed * dt / stride) % 1;
    const move = clamp(speed / 1.5, 0, 1) * (1 - air);
    const ph = st.phase * TAU, breath = Math.sin(st.t * 1.3);

    // body: bob with the gait, rock in a gallop, sink for a crouch, stretch out in a leap
    const bob = (Math.cos(ph * 2) * 0.035 * (1 - gal) + Math.cos(ph) * 0.12 * gal) * move;
    const bodyPitch = (Math.sin(ph) * 0.06 * gal * move) + crouch * 0.1 - air * 0.12 + hurt * -0.05;
    let by = BODY_Y + bob - crouch * 0.42 + air * 0.15 + breath * 0.008;
    // collapsing: the legs give way, then it rolls onto its right side
    const dFall = sstep(0.0, 0.45, dead), dRoll = sstep(0.25, 1.0, dead);
    by = lerp(by, 1.1, dFall * (1 - dRoll)); by = lerp(by, 0.6, dRoll);
    body.position.y = by;
    body.rotation.set(lerp(bodyPitch, 0, dRoll) + 0.22 * dFall * (1 - dRoll) + hurt * 0.04 * Math.sin(st.t * 40), 0, dRoll * 1.42 + hurt * 0.05);

    // legs: two-bone IK keeps the feet on the ground while standing and walking
    const amp = clamp(speed * 0.075, 0, 0.5) * live;
    const duty = lerp(0.62, 0.42, gal);
    for (const g of legs){
      const off = lerp(g.walk, g.bound, gal);
      const p = (st.phase + off) % 1;
      let swing, lift, comp;
      if (p < duty){ const t = p / duty; swing = lerp(-amp, amp, t); lift = 0; comp = Math.sin(t * Math.PI) * (0.12 + 0.35 * gal) * clamp(speed / 2, 0, 1); }
      else { const t = (p - duty) / (1 - duty); swing = lerp(amp, -amp, sstep(0, 1, t)); lift = Math.sin(t * Math.PI) * (0.25 + 0.25 * gal) * move; comp = -0.12 * Math.sin(t * Math.PI) * gal; }
      // leap: front legs reach forward, hind legs kick back, springs fully stretched
      swing = lerp(swing, g.L.front ? -0.75 : 0.85, air);
      let sc = 0.9 - comp - crouch * 0.5 + air * 0.4;
      sc = lerp(clamp(sc, 0.4, 1.35), 1.0, 1 - live);
      g.spring.scale.y = sc;
      g.foot.position.y = rest[BI[g.L.n + 'foot']].y - (sc - 1) * SPRING_LEN;
      // hip height above the ground (body pitch moves front and back hips opposite ways)
      const hipY = by + g.hipY * Math.cos(bodyPitch) - g.hipZ * Math.sin(bodyPitch);
      const ankleH = FOOT_Y + SPRING_LEN * sc;
      const ang = swing + bodyPitch;
      let D = (hipY - ankleH) / Math.max(0.3, Math.cos(ang)) - lift;
      D = lerp(D, (g.a + g.b) * 0.985, air);
      D = clamp(D, (g.a + g.b) * 0.45, (g.a + g.b) * 0.999);
      const alpha = Math.acos(clamp((g.a * g.a + D * D - g.b * g.b) / (2 * g.a * D), -1, 1));
      const bend = Math.PI - Math.acos(clamp((g.a * g.a + g.b * g.b - D * D) / (2 * g.a * g.b), -1, 1));
      const k = g.L.front ? 1 : -1;
      let ux = swing - k * alpha, lx = k * bend;
      // dead: buckled, then limp and splayed as it lies on its side
      const left = g.L.hip[0] > 0;
      ux = lerp(ux, (g.L.front ? -0.5 : 0.6) * dFall, 1 - live); lx = lerp(lx, (g.L.front ? 1.3 : -1.3) * dFall * (1 - 0.5 * dRoll), 1 - live);
      g.up.rotation.set(ux, 0, -dRoll * (left ? 0.35 : 0.08));
      g.lo.rotation.x = lx;
      // feet stay flat on the ground; in the air they trail, toes pointing back
      g.foot.rotation.x = lerp(-(ux + lx + bodyPitch) * live + 0.5 * lift, 0.9, air) + (1 - live) * 0.4;
    }

    // neck and head: aim, breathe, recoil when hurt, lift to barf; fall when dead
    const yawC = clamp(yaw, -1.3, 1.3), pitC = clamp(pitch, -0.9, 0.9);
    const nodY = -pitC - mo * 0.25 - hurt * 0.3;
    const wN = [0.12, 0.22, 0.3, 0.36];
    for (let i = 0; i < 4; i++){
      neck[i].rotation.set(nodY * wN[i] * 0.6 + breath * 0.012 + (1 - live) * [0.45, 0.25, -0.1, -0.2][i] - bodyPitch * (i === 0 ? 0.8 : 0),
        yawC * wN[i] * live, (1 - live) * [0.25, 0.25, 0.2, 0.1][i] * dRoll);
    }
    head.rotation.set(nodY * 0.4 + Math.sin(st.t * 0.7) * 0.03 + (1 - live) * 0.3, yawC * 0.25 * live, 0);
    jaw.rotation.x = Math.max(mo * 0.85, dead * 0.25) + Math.sin(st.t * 23) * 0.03 * mo;
    // tail: swings with the gait and hangs heavy; streams back in a leap
    st.swayV += (-(st.sway) * 6 - st.swayV * 2.2 + Math.sin(ph) * speed * 0.6) * dt; st.sway += st.swayV * dt;
    tail[0].rotation.set(-air * 0.6 + speed * 0.015, 0, st.sway * 0.1);
    for (let i = 1; i < 4; i++) tail[i].rotation.set(-air * 0.35 - speed * 0.025 * i * gal, Math.sin(st.t * 0.9 - i) * 0.03, st.sway * 0.12 * i + dRoll * 0.3);

    // wings: folded up into arches at rest; spread wide and beat with flap
    const spread = sstep(0, 1, flap);
    st.beat += dt * lerp(0.8, 9.5, flap);
    const beat = Math.sin(st.beat) * 0.5 * spread, lag = Math.sin(st.beat - 0.9) * 0.4 * spread;
    for (const w of wings){
      const out = (0.12 + spread * 1.25 + beat + Math.sin(st.t * 0.6) * 0.015) * live;
      // dead: the lower (right) wing lies open on the floor, the upper one flops over
      const deadZ = w.s > 0 ? -0.35 * dRoll : 0.45 * dRoll;
      w.root.rotation.set(-0.1 * spread * live, 0.12 * spread * w.s * live, -w.s * out * live + deadZ);
      w.wrist.rotation.set(0.1 * spread, 0, -w.s * lag * 0.6 + w.s * 0.25 * spread);
      w.f[0].rotation.x = 0.18 * spread + 0.1 * (1 - live);
      w.f[1].rotation.x = -0.05 * spread;
      w.f[2].rotation.x = -0.32 * spread - 0.15 * (1 - live);
    }

    // eyes and flashes: uniforms only
    mats.eye.emissiveIntensity = lerp(0.35 + glow * 60, 0.0, 1 - live);
    mats.skin.userData.u.detailB.value.z = hurt * 0.6;
    mats.ivory.userData.u.detailB.value.z = hurt * 0.3;
    mats.membrane.userData.u.flashColor.value.setRGB(hurt * 0.25, hurt * 0.01, 0);
  }
  update(0, {});
  group.updateMatrixWorld(true);
  const ep = new THREE.Vector3(); eyes[0].getWorldPosition(ep);

  return { group, update, mouth, eyes, parts, height: ep.y, mesh, materials: mats, triangles: GEO.userData.triangles, buildMs: GEO.userData.buildMs };
}
