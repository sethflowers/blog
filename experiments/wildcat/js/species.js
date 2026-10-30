// The animals: a European wildcat (you), a brown bear, a grey wolf, a wild boar, and rabbits to hunt.
// All measurements are real-world sizes in metres. +Z is forward, Y is up, the origin is the ground.
// Every animal shares the same bone names, so one function poses them all.
import { vnoise, clamp, smooth, lerp } from './noise.js';

const cone = (bone, a, b, ra, rb, x = {}) => ({ type: 'cone', bone, a, b, ra, rb, ...x });
const ell = (bone, c, r, x = {}) => ({ type: 'ell', bone, c, r, ...x });
const mirror = (p, s) => [p[0] * s, p[1], p[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const n3 = (x, y, z, f, s = 0) => vnoise(x * f + z * f * 0.37, y * f - z * f * 0.61, s);

// The shared skeleton: hips (root), chest, neck, head, jaw, four legs of three bones and a tail chain.
// J holds the joint positions for the left side (+X); the right side is mirrored.
function skeleton(J){
  const B = [
    { name: 'root', at: J.hip },
    { name: 'chest', parent: 'root', at: J.chest },
    { name: 'neck', parent: 'chest', at: J.neck },
    { name: 'head', parent: 'neck', at: J.head },
    { name: 'jaw', parent: 'head', at: J.jaw },
  ];
  for (const [S, s] of [['L', 1], ['R', -1]]){
    B.push({ name: 'fUp' + S, parent: 'chest', at: mirror(J.shoulder, s) }, { name: 'fLo' + S, parent: 'fUp' + S, at: mirror(J.elbow, s) },
      { name: 'fPaw' + S, parent: 'fLo' + S, at: mirror(J.wrist, s) },
      { name: 'hUp' + S, parent: 'root', at: mirror(J.hipJ, s) }, { name: 'hLo' + S, parent: 'hUp' + S, at: mirror(J.knee, s) },
      { name: 'hMet' + S, parent: 'hLo' + S, at: mirror(J.hock, s) });
  }
  J.tail.slice(0, -1).forEach((p, i) => B.push({ name: 't' + i, parent: i ? 't' + (i - 1) : 'root', at: p }));
  return B;
}
// legs and tail as tapered capsules; R gives the radii [upperTop, upperBottom, lowerTop, lowerBottom, footTop, footBottom]
function limbs(J, F, H, T, paw, x = {}){
  const P = [];
  for (const [S, s] of [['L', 1], ['R', -1]]){
    const m = (p) => mirror(p, s);
    P.push(cone('fUp' + S, m(J.shoulder), m(J.elbow), F[0], F[1], { tag: 'leg' }),
      cone('fLo' + S, m(J.elbow), m(J.wrist), F[2], F[3], { tag: 'leg' }),
      cone('fPaw' + S, m(J.wrist), m(J.fToe), F[4], F[5], { tag: 'paw', fur: x.pawFur ?? 0.7 }),
      ell('fPaw' + S, m(add(J.fToe, [0, paw[1] * 0.2, -paw[2] * 0.4])), [paw[0], paw[1], paw[2]], { tag: 'paw', fur: x.pawFur ?? 0.7, k: x.pawK }),
      cone('hUp' + S, m(J.hipJ), m(J.knee), H[0], H[1], { tag: 'thigh' }),
      cone('hLo' + S, m(J.knee), m(J.hock), H[2], H[3], { tag: 'leg' }),
      cone('hMet' + S, m(J.hock), m(J.hToe), H[4], H[5], { tag: 'leg' }),
      ell('hMet' + S, m(add(J.hToe, [0, paw[1] * 0.2, -paw[2] * 0.4])), [paw[0], paw[1], paw[2] * (x.hindPawLong || 1)], { tag: 'paw', fur: x.pawFur ?? 0.7, k: x.pawK }));
  }
  for (let i = 0; i < J.tail.length - 1; i++) P.push(cone('t' + i, J.tail[i], J.tail[i + 1], T[i], T[i + 1], { tag: 'tail', fur: x.tailFur ?? 1, k: x.tailK }));
  return P;
}

// The cat's markings, for any coat: base colour, the dark of the stripes, the pale of the belly and chin.
// pattern: 'tabby' (stripes and a ringed tail), 'spots' (rosettes), or 'plain' (a whisper of stripes).
function catColor(coat){
  const { base, dark, cream } = coat, pattern = coat.pattern || 'tabby', tip = coat.tip || dark;
  const markK = pattern === 'plain' ? 0.25 : 0.85;
  return function(x, y, z, tag){
    let c = base;
    const wob = n3(x, y, z, 40, 1) * 1.6;
    const spot = pattern === 'spots' && n3(x * 1.7, y * 1.7, z * 1.7, 55, 21) > 0.66;
    if (tag === 'tail'){
      if (z < -0.585) return tip;                                    // the blunt tip
      if (pattern === 'spots') return spot ? mix3(base, dark, 0.8) : base;
      return Math.sin(z * 52 + 1.4) > 0.35 ? mix3(base, dark, markK) : mix3(base, cream, 0.1);
    }
    if (tag === 'body' || tag === 'neck'){
      const top = smooth(0.29, 0.34, y), belly = smooth(0.24, 0.19, y);
      // vertical wavy stripes down the flanks (or spots), a dark line along the spine
      const stripe = pattern === 'spots' ? spot : Math.sin(z * 75 + wob * 2.2 + y * 6) > 0.45 && Math.abs(x) > 0.025 && belly < 0.5;
      c = stripe ? mix3(base, dark, markK) : base;
      if (Math.abs(x) < 0.02 && top > 0.5 && z < 0.12) c = mix3(base, dark, markK);
      c = mix3(c, cream, belly * 0.85);
      if (tag === 'neck' && y < 0.3) c = mix3(c, cream, 0.6);
    } else if (tag === 'leg' || tag === 'thigh'){
      const bar = pattern === 'spots' ? spot : Math.sin(y * 95 + wob) > 0.6 && y > 0.06;
      c = bar ? mix3(base, dark, markK * 0.95) : mix3(base, cream, 0.2);
      if (tag === 'leg' && Math.abs(x) < 0.05) c = mix3(c, cream, 0.5);
    } else if (tag === 'paw'){
      c = y < 0.012 ? mix3(dark, [0.1, 0.08, 0.07], 0.5) : mix3(base, cream, 0.35);
    } else if (tag === 'head' || tag === 'cheek'){
      // four dark lines over the forehead, a dark line from the eye corner down the cheek
      const fore = y > 0.383 && Math.abs(Math.sin(x * 210)) > 0.75 && z < 0.29;
      const cheekLine = tag === 'cheek' && Math.abs(y - 0.35 + (z - 0.28) * 0.6) < 0.004 && Math.abs(x) > 0.03;
      c = fore || cheekLine ? mix3(base, dark, markK * 0.95) : base;
      if (y < 0.345) c = mix3(c, cream, 0.6);
    } else if (tag === 'muzzle' || tag === 'chin') c = mix3(cream, coat.chin || [0.85, 0.8, 0.7], 0.5);
    else if (tag === 'ear') c = mix3(base, dark, 0.4);
    return mix3(c, [c[0] * 0.8, c[1] * 0.8, c[2] * 0.8], n3(x, y, z, 90, 3) * 0.6);
  };
}

// ============================================================ the wildcat
const CAT_J = {
  hip: [0, 0.27, -0.17], chest: [0, 0.28, 0.10], neck: [0, 0.31, 0.19], head: [0, 0.36, 0.25], jaw: [0, 0.342, 0.272],
  shoulder: [0.055, 0.265, 0.13], elbow: [0.062, 0.15, 0.085], wrist: [0.056, 0.035, 0.125], fToe: [0.056, 0.016, 0.165],
  hipJ: [0.06, 0.26, -0.19], knee: [0.07, 0.165, -0.10], hock: [0.064, 0.07, -0.245], hToe: [0.06, 0.016, -0.185],
  tail: [[0, 0.285, -0.27], [0, 0.245, -0.39], [0, 0.185, -0.49], [0, 0.135, -0.57], [0, 0.11, -0.635]],
};
export const CAT = {
  name: 'cat', res: 84, blend: 0.035, radius: 0.16, height: 0.38,
  fur: { len: 0.014, density: 480, shells: 18, comb: [0, -0.25, -0.75] },
  eyeColor: ['#e6d35a', '#8d7a1c'], slitEyes: true,
  bones: skeleton(CAT_J),
  prims: [
    ell('root', [0, 0.262, -0.15], [0.066, 0.082, 0.125], { tag: 'body' }),
    cone('root', [0, 0.25, -0.08], [0, 0.255, 0.03], 0.068, 0.07, { tag: 'body' }),
    ell('chest', [0, 0.262, 0.075], [0.068, 0.09, 0.115], { tag: 'body' }),
    cone('neck', [0, 0.295, 0.14], [0, 0.345, 0.235], 0.056, 0.046, { tag: 'neck', fur: 1.2 }),
    ell('head', [0, 0.366, 0.268], [0.045, 0.042, 0.047], { tag: 'head' }),
    ell('head', [0, 0.352, 0.283], [0.052, 0.03, 0.032], { tag: 'cheek', fur: 1.3 }),
    ell('head', [0, 0.349, 0.31], [0.027, 0.022, 0.024], { tag: 'muzzle', fur: 0.5, k: 0.02 }),
    ell('jaw', [0, 0.333, 0.297], [0.021, 0.011, 0.024], { tag: 'chin', fur: 0.6, k: 0.015 }),
    ...[1, -1].map((s) => cone('head', [0.03 * s, 0.395, 0.255], [0.046 * s, 0.452, 0.245], 0.022, 0.004, { tag: 'ear', fur: 0.35, k: 0.012 })),
    ...limbs(CAT_J, [0.034, 0.024, 0.02, 0.015, 0.015, 0.014], [0.05, 0.028, 0.022, 0.016, 0.014, 0.014], [0.031, 0.03, 0.029, 0.028, 0.026],
      [0.018, 0.012, 0.023], { tailFur: 1.7, pawFur: 0.5, pawK: 0.015 }),
  ],
  color: catColor({ base: [0.46, 0.39, 0.29], dark: [0.1, 0.085, 0.07], cream: [0.68, 0.6, 0.47] }),
  eyes: [1, -1].map((s) => ({ bone: 'head', at: [0.025 * s, 0.377, 0.303], r: 0.0115, dir: [0.28 * s, 0.02, 1] })),
  extras: [
    { type: 'ell', bone: 'head', at: [0, 0.355, 0.331], size: [0.0065, 0.0042, 0.004], mat: 'nose' },
    { type: 'ell', bone: 'head', at: [0, 0.337, 0.29], size: [0.017, 0.008, 0.022], mat: 'mouth' },
    ...[1, -1].map((s) => ({ type: 'cone', bone: 'head', at: [0.011 * s, 0.338, 0.318], r: 0.0024, len: 0.011, dir: [0, -1, 0.15] })),
    ...[1, -1].map((s) => ({ type: 'cone', bone: 'jaw', at: [0.01 * s, 0.334, 0.312], r: 0.002, len: 0.008, dir: [0, 1, 0.15] })),
  ],
  gait: { walk: 0.9, run: 7, stride: 0.42, runStride: 1.25, swing: 0.55, fBend: 1.1, hBend: 0.9, bob: 0.012, tailLift: -0.15, jawOpen: 0.7,
    rearAngle: 0.9, crouchDrop: 0.08, deadDrop: 0.17 },
};

// ============================================================ brown bear
const BEAR_J = {
  hip: [0, 0.88, -0.55], chest: [0, 0.95, 0.3], neck: [0, 0.98, 0.6], head: [0, 0.94, 0.84], jaw: [0, 0.84, 0.93],
  shoulder: [0.22, 0.9, 0.4], elbow: [0.245, 0.5, 0.3], wrist: [0.235, 0.12, 0.38], fToe: [0.235, 0.05, 0.53],
  hipJ: [0.22, 0.86, -0.62], knee: [0.245, 0.5, -0.45], hock: [0.235, 0.16, -0.68], hToe: [0.235, 0.06, -0.42],
  tail: [[0, 0.9, -0.98], [0, 0.82, -1.07]],
};
export const BEAR = {
  name: 'bear', res: 76, blend: 0.16, radius: 0.75, height: 1.25,
  fur: { len: 0.075, density: 150, shells: 18, comb: [0, -0.45, -0.5] },
  eyeColor: ['#6a4520', '#2a1608'], slitEyes: false,
  bones: skeleton(BEAR_J),
  prims: [
    ell('root', [0, 0.86, -0.55], [0.36, 0.4, 0.46], { tag: 'body' }),
    cone('root', [0, 0.82, -0.3], [0, 0.85, 0.12], 0.42, 0.44, { tag: 'body' }),
    ell('chest', [0, 0.9, 0.27], [0.37, 0.45, 0.45], { tag: 'body' }),
    ell('chest', [0, 1.14, 0.32], [0.25, 0.18, 0.32], { tag: 'hump', fur: 1.3 }),
    cone('neck', [0, 0.98, 0.5], [0, 0.96, 0.8], 0.3, 0.25, { tag: 'neck', fur: 1.2 }),
    ell('head', [0, 0.95, 0.91], [0.2, 0.19, 0.2], { tag: 'head' }),
    cone('head', [0, 0.92, 0.98], [0, 0.875, 1.17], 0.11, 0.075, { tag: 'muzzle', fur: 0.45, k: 0.08 }),
    ell('jaw', [0, 0.815, 1.04], [0.08, 0.045, 0.12], { tag: 'chin', fur: 0.5, k: 0.06 }),
    ...[1, -1].map((s) => ell('head', [0.135 * s, 1.11, 0.86], [0.055, 0.06, 0.032], { tag: 'ear', fur: 0.8, k: 0.05 })),
    ...limbs(BEAR_J, [0.17, 0.13, 0.12, 0.1, 0.1, 0.09], [0.22, 0.14, 0.12, 0.09, 0.085, 0.09], [0.065, 0.045],
      [0.095, 0.05, 0.12], { pawFur: 0.8, hindPawLong: 1.4, pawK: 0.08 }),
  ],
  color(x, y, z, tag){
    const base = [0.27, 0.17, 0.1], dark = [0.1, 0.065, 0.04], tip = [0.5, 0.37, 0.24];
    let c = base;
    if (tag === 'leg' || tag === 'paw' || tag === 'thigh') c = mix3(base, dark, tag === 'thigh' ? 0.35 : 0.75);
    if (tag === 'hump' || (tag === 'body' && y > 1.1) || tag === 'neck' && y > 1.05) c = mix3(base, tip, 0.55);
    if (tag === 'muzzle') c = mix3(base, tip, 0.35);
    if (tag === 'ear') c = dark;
    if (tag === 'body' && y < 0.6) c = mix3(c, dark, 0.4);
    return mix3(c, tip, n3(x, y, z, 6, 5) * 0.35);
  },
  eyes: [1, -1].map((s) => ({ bone: 'head', at: [0.085 * s, 0.985, 1.05], r: 0.023, dir: [0.3 * s, 0.08, 1] })),
  extras: [
    { type: 'ell', bone: 'head', at: [0, 0.89, 1.2], size: [0.048, 0.033, 0.03], mat: 'dark' },
    { type: 'ell', bone: 'head', at: [0, 0.84, 1.03], size: [0.075, 0.03, 0.11], mat: 'mouth' },
    ...[1, -1].map((s) => ({ type: 'cone', bone: 'head', at: [0.04 * s, 0.84, 1.13], r: 0.012, len: 0.045, dir: [0, -1, 0.1] })),
    ...[1, -1].map((s) => ({ type: 'cone', bone: 'jaw', at: [0.04 * s, 0.8, 1.1], r: 0.01, len: 0.035, dir: [0, 1, 0.15] })),
    ...[1, -1].flatMap((s) => [-1, 0, 1].map((k) => ({ type: 'cone', bone: 'fPaw' + (s > 0 ? 'L' : 'R'), at: [0.235 * s + k * 0.045, 0.05, 0.6], r: 0.012, len: 0.08, dir: [k * 0.1, -0.5, 1], mat: 'dark' }))),
  ],
  gait: { walk: 1.3, run: 9, stride: 1.4, runStride: 3.2, swing: 0.42, fBend: 0.9, hBend: 0.6, bob: 0.03, tailLift: 0, jawOpen: 0.55,
    rearAngle: 1.15, crouchDrop: 0.12, deadDrop: 0.5 },
};

// ============================================================ grey wolf
const WOLF_J = {
  hip: [0, 0.7, -0.38], chest: [0, 0.72, 0.22], neck: [0, 0.78, 0.4], head: [0, 0.86, 0.56], jaw: [0, 0.8, 0.62],
  shoulder: [0.12, 0.69, 0.27], elbow: [0.13, 0.42, 0.18], wrist: [0.12, 0.1, 0.25], fToe: [0.12, 0.03, 0.32],
  hipJ: [0.12, 0.68, -0.42], knee: [0.14, 0.45, -0.27], hock: [0.13, 0.18, -0.5], hToe: [0.13, 0.03, -0.42],
  tail: [[0, 0.7, -0.58], [0, 0.58, -0.72], [0, 0.46, -0.81], [0, 0.35, -0.87], [0, 0.27, -0.89]],
};
export const WOLF = {
  name: 'wolf', res: 80, blend: 0.08, radius: 0.4, height: 0.9,
  fur: { len: 0.042, density: 230, shells: 18, comb: [0, -0.3, -0.75] },
  eyeColor: ['#f0c040', '#a06810'], slitEyes: false,
  bones: skeleton(WOLF_J),
  prims: [
    ell('root', [0, 0.68, -0.36], [0.14, 0.17, 0.25], { tag: 'body' }),
    cone('root', [0, 0.65, -0.15], [0, 0.66, 0.08], 0.155, 0.19, { tag: 'body' }),
    ell('chest', [0, 0.66, 0.2], [0.17, 0.25, 0.26], { tag: 'body' }),
    cone('neck', [0, 0.74, 0.3], [0, 0.84, 0.53], 0.16, 0.12, { tag: 'neck', fur: 1.5 }),
    ell('head', [0, 0.87, 0.59], [0.105, 0.1, 0.11], { tag: 'head' }),
    cone('head', [0, 0.85, 0.65], [0, 0.81, 0.84], 0.06, 0.035, { tag: 'muzzle', fur: 0.45, k: 0.04 }),
    cone('jaw', [0, 0.79, 0.66], [0, 0.775, 0.81], 0.04, 0.024, { tag: 'chin', fur: 0.5, k: 0.03 }),
    ...[1, -1].map((s) => cone('head', [0.06 * s, 0.94, 0.56], [0.075 * s, 1.04, 0.55], 0.042, 0.008, { tag: 'ear', fur: 0.6, k: 0.025 })),
    ...limbs(WOLF_J, [0.075, 0.05, 0.04, 0.032, 0.032, 0.03], [0.1, 0.06, 0.05, 0.034, 0.032, 0.03], [0.05, 0.065, 0.065, 0.05, 0.03],
      [0.032, 0.024, 0.045], { tailFur: 1.9, pawFur: 0.5, pawK: 0.04 }),
  ],
  color(x, y, z, tag){
    const base = [0.44, 0.41, 0.36], dark = [0.13, 0.12, 0.11], cream = [0.74, 0.7, 0.62], tan = [0.5, 0.45, 0.38];
    let c = base;
    if (tag === 'body' || tag === 'neck'){
      const saddle = smooth(0.74, 0.86, y) * (z < 0.35 ? 1 : 0.4);
      c = mix3(base, dark, saddle * 0.75);
      c = mix3(c, cream, smooth(0.6, 0.5, y));
      if (tag === 'neck' && y < 0.78) c = mix3(c, cream, 0.6);
    } else if (tag === 'leg' || tag === 'thigh') c = mix3(tan, cream, smooth(0.4, 0.1, y) * 0.6);
    else if (tag === 'paw') c = cream;
    else if (tag === 'tail') c = z < -0.84 ? dark : mix3(base, dark, smooth(0.6, 0.7, y) * 0.6);
    else if (tag === 'head') c = y > 0.9 ? mix3(base, dark, 0.3) : mix3(base, cream, smooth(0.86, 0.8, y));
    else if (tag === 'muzzle' || tag === 'chin') c = y > 0.84 ? mix3(base, dark, 0.2) : cream;
    else if (tag === 'ear') c = mix3(base, dark, 0.5);
    return mix3(c, dark, n3(x, y, z, 12, 7) * 0.25);
  },
  eyes: [1, -1].map((s) => ({ bone: 'head', at: [0.05 * s, 0.9, 0.655], r: 0.014, dir: [0.35 * s, 0.05, 1] })),
  extras: [
    { type: 'ell', bone: 'head', at: [0, 0.832, 0.85], size: [0.017, 0.012, 0.012], mat: 'dark' },
    { type: 'ell', bone: 'head', at: [0, 0.795, 0.7], size: [0.035, 0.015, 0.1], mat: 'mouth' },
    ...[1, -1].map((s) => ({ type: 'cone', bone: 'head', at: [0.022 * s, 0.795, 0.79], r: 0.006, len: 0.025, dir: [0, -1, 0.1] })),
    ...[1, -1].map((s) => ({ type: 'cone', bone: 'jaw', at: [0.018 * s, 0.785, 0.77], r: 0.005, len: 0.02, dir: [0, 1, 0.15] })),
  ],
  gait: { walk: 1.3, run: 10, stride: 0.95, runStride: 2.6, swing: 0.5, fBend: 1.0, hBend: 0.8, bob: 0.02, tailLift: 0.1, jawOpen: 0.65,
    rearAngle: 0.7, crouchDrop: 0.12, deadDrop: 0.45 },
};

// ============================================================ wild boar
const BOAR_J = {
  hip: [0, 0.62, -0.45], chest: [0, 0.7, 0.18], neck: [0, 0.7, 0.38], head: [0, 0.64, 0.52], jaw: [0, 0.5, 0.6],
  shoulder: [0.16, 0.62, 0.25], elbow: [0.17, 0.36, 0.21], wrist: [0.16, 0.1, 0.27], fToe: [0.16, 0.025, 0.31],
  hipJ: [0.15, 0.58, -0.5], knee: [0.17, 0.36, -0.4], hock: [0.16, 0.15, -0.57], hToe: [0.16, 0.025, -0.53],
  tail: [[0, 0.66, -0.74], [0, 0.55, -0.8], [0, 0.44, -0.81]],
};
export const BOAR = {
  name: 'boar', res: 76, blend: 0.1, radius: 0.45, height: 0.95,
  fur: { len: 0.04, density: 130, shells: 14, comb: [0, -0.15, -0.9] },
  eyeColor: ['#9a6024', '#3a1a06'], slitEyes: false,
  bones: skeleton(BOAR_J),
  prims: [
    ell('root', [0, 0.58, -0.42], [0.2, 0.24, 0.3], { tag: 'body' }),
    cone('root', [0, 0.6, -0.2], [0, 0.63, 0.1], 0.25, 0.29, { tag: 'body' }),
    ell('chest', [0, 0.62, 0.17], [0.24, 0.32, 0.3], { tag: 'body' }),
    ell('chest', [0, 0.86, 0.1], [0.08, 0.12, 0.36], { tag: 'mane', fur: 2.2, k: 0.12 }),
    cone('neck', [0, 0.66, 0.3], [0, 0.61, 0.5], 0.24, 0.18, { tag: 'neck', fur: 1.3 }),
    cone('head', [0, 0.65, 0.5], [0, 0.5, 0.86], 0.16, 0.065, { tag: 'head' }),
    ell('head', [0, 0.48, 0.89], [0.058, 0.052, 0.026], { tag: 'snout', fur: 0, k: 0.04 }),
    cone('jaw', [0, 0.48, 0.58], [0, 0.44, 0.8], 0.07, 0.04, { tag: 'chin', k: 0.05 }),
    ...[1, -1].map((s) => cone('head', [0.09 * s, 0.74, 0.52], [0.135 * s, 0.84, 0.46], 0.05, 0.01, { tag: 'ear', fur: 1.2, k: 0.03 })),
    ...limbs(BOAR_J, [0.09, 0.06, 0.045, 0.035, 0.034, 0.034], [0.13, 0.07, 0.05, 0.035, 0.035, 0.033], [0.022, 0.015, 0.012],
      [0.034, 0.038, 0.04], { pawFur: 0, tailFur: 0.7 }),
  ],
  color(x, y, z, tag){
    const base = [0.2, 0.16, 0.12], dark = [0.07, 0.06, 0.05], grizzle = [0.42, 0.36, 0.28];
    let c = mix3(base, grizzle, n3(x, y, z, 10, 9) * 0.5);
    if (tag === 'mane') c = dark;
    if (tag === 'leg' || tag === 'thigh') c = mix3(c, dark, 0.6);
    if (tag === 'paw') c = [0.06, 0.05, 0.045];
    if (tag === 'snout') c = [0.36, 0.27, 0.25];
    return c;
  },
  eyes: [1, -1].map((s) => ({ bone: 'head', at: [0.1 * s, 0.67, 0.64], r: 0.017, dir: [0.8 * s, 0.1, 0.6] })),
  extras: [
    ...[1, -1].map((s) => ({ type: 'ell', bone: 'head', at: [0.022 * s, 0.48, 0.913], size: [0.011, 0.016, 0.006], mat: 'dark' })),
    ...[1, -1].map((s) => ({ type: 'cone', bone: 'jaw', at: [0.058 * s, 0.47, 0.75], r: 0.013, len: 0.09, dir: [0.35 * s, 1, 0.35], cast: true })),
    { type: 'ell', bone: 'head', at: [0, 0.47, 0.7], size: [0.05, 0.02, 0.12], mat: 'mouth' },
  ],
  gait: { walk: 1.1, run: 9, stride: 0.8, runStride: 2.2, swing: 0.45, fBend: 0.8, hBend: 0.6, bob: 0.025, tailLift: 0.3, jawOpen: 0.4,
    rearAngle: 0.5, crouchDrop: 0.1, deadDrop: 0.4 },
};

// ============================================================ rabbit
const RAB_J = {
  hip: [0, 0.13, -0.06], chest: [0, 0.12, 0.05], neck: [0, 0.15, 0.09], head: [0, 0.185, 0.12], jaw: [0, 0.165, 0.15],
  shoulder: [0.028, 0.11, 0.07], elbow: [0.032, 0.06, 0.065], wrist: [0.03, 0.016, 0.085], fToe: [0.03, 0.008, 0.105],
  hipJ: [0.04, 0.12, -0.06], knee: [0.05, 0.075, 0.0], hock: [0.045, 0.02, -0.085], hToe: [0.045, 0.008, 0.03],
  tail: [[0, 0.13, -0.14], [0, 0.135, -0.17]],
};
export const RABBIT = {
  name: 'rabbit', res: 60, blend: 0.03, radius: 0.1, height: 0.22,
  fur: { len: 0.011, density: 600, shells: 10, comb: [0, -0.2, -0.8] },
  eyeColor: ['#3a2010', '#080402'], slitEyes: false,
  bones: skeleton(RAB_J),
  prims: [
    ell('root', [0, 0.11, -0.07], [0.065, 0.075, 0.08], { tag: 'body' }),
    ell('chest', [0, 0.105, 0.035], [0.05, 0.06, 0.06], { tag: 'body' }),
    ell('head', [0, 0.185, 0.14], [0.035, 0.038, 0.045], { tag: 'head' }),
    cone('neck', [0, 0.125, 0.06], [0, 0.175, 0.125], 0.036, 0.028, { tag: 'body' }),
    ell('head', [0, 0.175, 0.175], [0.022, 0.02, 0.02], { tag: 'muzzle' }),
    ...[1, -1].map((s) => cone('head', [0.015 * s, 0.22, 0.125], [0.026 * s, 0.31, 0.085], 0.013, 0.009, { tag: 'ear', fur: 0.4, k: 0.01 })),
    ...[1, -1].map((s) => ell('hUp' + (s > 0 ? 'L' : 'R'), [0.045 * s, 0.09, -0.05], [0.025, 0.045, 0.05], { tag: 'body' })),
    ...limbs(RAB_J, [0.016, 0.012, 0.01, 0.009, 0.009, 0.009], [0.02, 0.014, 0.012, 0.01, 0.012, 0.012], [0.02, 0.02],
      [0.012, 0.009, 0.02], { hindPawLong: 2 }),
    ell('t0', [0, 0.135, -0.155], [0.022, 0.022, 0.02], { tag: 'tail', fur: 1.5 }),
  ],
  color(x, y, z, tag){
    const base = [0.46, 0.37, 0.26], white = [0.85, 0.82, 0.76], dark = [0.15, 0.12, 0.09];
    let c = mix3(base, dark, n3(x, y, z, 120, 11) * 0.4);
    if (tag === 'body' && y < 0.08) c = white;
    if (tag === 'tail') c = white;
    if (tag === 'ear' && y > 0.29) c = dark;
    if (tag === 'muzzle' && y < 0.17) c = white;
    return c;
  },
  eyes: [1, -1].map((s) => ({ bone: 'head', at: [0.028 * s, 0.195, 0.152], r: 0.0095, dir: [1 * s, 0.1, 0.35] })),
  extras: [{ type: 'ell', bone: 'head', at: [0, 0.18, 0.193], size: [0.005, 0.004, 0.003], mat: 'dark' }],
  gait: { walk: 0.6, run: 8, stride: 0.25, runStride: 0.9, swing: 0.6, fBend: 0.8, hBend: 1.0, bob: 0.02, tailLift: 0, jawOpen: 0.3,
    rearAngle: 0.6, crouchDrop: 0.03, deadDrop: 0.08, hop: true },
};

export const SPECIES = { cat: CAT, bear: BEAR, wolf: WOLF, boar: BOAR, rabbit: RABBIT };

// Other cats to be: same body, a different coat and eyes.
const coat = (name, label, c, eyeColor) => ({ ...CAT, name, label, color: catColor(c), eyeColor });
export const COATS = {
  cat: Object.assign(CAT, { label: 'Wildcat' }),
  ginger: coat('cat-ginger', 'Ginger tabby', { base: [0.76, 0.45, 0.2], dark: [0.52, 0.25, 0.09], cream: [0.93, 0.82, 0.64], tip: [0.55, 0.27, 0.1] }, ['#eaa83a', '#9a5410']),
  black: coat('cat-black', 'Black cat', { base: [0.05, 0.046, 0.042], dark: [0.02, 0.019, 0.018], cream: [0.075, 0.07, 0.065], chin: [0.08, 0.075, 0.07], pattern: 'plain' }, ['#cde24e', '#5a8a18']),
  snow: coat('cat-snow', 'Snow cat', { base: [0.84, 0.83, 0.8], dark: [0.36, 0.36, 0.38], cream: [0.96, 0.95, 0.93] }, ['#92cdf2', '#2a66a6']),
  spotted: coat('cat-spotted', 'Spotted cat', { base: [0.72, 0.58, 0.38], dark: [0.16, 0.11, 0.07], cream: [0.9, 0.84, 0.72], pattern: 'spots' }, ['#d9c050', '#7a6a12']),
};
for (const [k, d] of Object.entries(COATS)) SPECIES[k] = d;
BEAR.label = 'Brown bear'; WOLF.label = 'Grey wolf'; BOAR.label = 'Wild boar'; RABBIT.label = 'Rabbit';

// ============================================================ more prey
// A copy of an animal at another size: every position, radius and stride scaled together.
function scaled(def, k, over){
  const v = (a) => a.map((x) => x * k);
  const d = {
    ...def, ...over,
    radius: def.radius * k, height: def.height * k, blend: def.blend * k,
    fur: { ...def.fur, len: def.fur.len * k, density: def.fur.density / k, ...(over.fur || {}) },
    bones: def.bones.map((b) => ({ ...b, at: v(b.at) })),
    prims: def.prims.map((p) => p.type === 'cone' ? { ...p, a: v(p.a), b: v(p.b), ra: p.ra * k, rb: p.rb * k, k: p.k && p.k * k }
      : { ...p, c: v(p.c), r: v(p.r), k: p.k && p.k * k }),
    eyes: def.eyes.map((e) => ({ ...e, at: v(e.at), r: e.r * k, base: undefined, baseDir: undefined })),
    extras: (def.extras || []).map((x) => ({ ...x, at: v(x.at), size: x.size && v(x.size), len: x.len && x.len * k, r: x.r && x.r * k })),
    gait: { ...def.gait, walk: def.gait.walk * k, run: def.gait.run * k, stride: def.gait.stride * k, runStride: def.gait.runStride * k,
      bob: def.gait.bob * k, crouchDrop: def.gait.crouchDrop * k, deadDrop: def.gait.deadDrop * k, ...(over.gait || {}) },
  };
  // markings are written for the original size
  const col = over.color || def.color;
  d.color = (x, y, z, tag, p) => col(x / k, y / k, z / k, tag, p);
  return d;
}

// a brown hare: a bigger, leggier rabbit with black-tipped ears and amber eyes
export const HARE = scaled(RABBIT, 1.45, {
  name: 'hare', label: 'Brown hare', res: 64, eyeColor: ['#e0a040', '#6a3a08'],
  color(x, y, z, tag){
    const base = [0.55, 0.42, 0.28], white = [0.86, 0.83, 0.77], dark = [0.08, 0.07, 0.06];
    let c = mix3(base, [0.3, 0.24, 0.17], n3(x, y, z, 110, 13) * 0.6);
    if (tag === 'body' && y < 0.075) c = white;
    if (tag === 'tail') c = z < -0.16 ? dark : white;
    if (tag === 'ear' && y > 0.28) c = dark;
    if (tag === 'muzzle' && y < 0.17) c = white;
    return c;
  },
});

// a wood mouse: a round body, big ears and eyes, a long bare tail
const MOUSE_J = {
  hip: [0, 0.035, -0.025], chest: [0, 0.035, 0.02], neck: [0, 0.04, 0.035], head: [0, 0.045, 0.045], jaw: [0, 0.04, 0.06],
  shoulder: [0.012, 0.032, 0.025], elbow: [0.014, 0.018, 0.022], wrist: [0.013, 0.006, 0.03], fToe: [0.013, 0.002, 0.037],
  hipJ: [0.015, 0.032, -0.03], knee: [0.018, 0.02, -0.014], hock: [0.016, 0.006, -0.036], hToe: [0.016, 0.002, -0.02],
  tail: [[0, 0.028, -0.058], [0, 0.02, -0.09], [0, 0.012, -0.12], [0, 0.008, -0.15], [0, 0.007, -0.17]],
};
export const MOUSE = {
  name: 'mouse', label: 'Wood mouse', res: 72, blend: 0.006, radius: 0.03, height: 0.06,
  fur: { len: 0.0035, density: 2200, shells: 8, comb: [0, -0.2, -0.8] },
  eyeColor: ['#2a160a', '#050302'], slitEyes: false,
  bones: skeleton(MOUSE_J),
  prims: [
    ell('root', [0, 0.031, -0.022], [0.023, 0.025, 0.037], { tag: 'body' }),
    ell('chest', [0, 0.031, 0.016], [0.018, 0.02, 0.024], { tag: 'body' }),
    ell('head', [0, 0.042, 0.05], [0.014, 0.014, 0.02], { tag: 'head' }),
    cone('head', [0, 0.04, 0.06], [0, 0.036, 0.078], 0.009, 0.004, { tag: 'muzzle', fur: 0.5 }),
    ...[1, -1].map((s) => ell('head', [0.012 * s, 0.056, 0.044], [0.008, 0.009, 0.003], { tag: 'ear', fur: 0.2, k: 0.003 })),
    ...limbs(MOUSE_J, [0.006, 0.004, 0.0035, 0.003, 0.003, 0.003], [0.009, 0.005, 0.004, 0.003, 0.003, 0.003], [0.003, 0.0026, 0.0022, 0.0018, 0.0015],
      [0.0035, 0.0022, 0.005], { tailFur: 0.1, pawFur: 0.2 }),
  ],
  color(x, y, z, tag){
    const base = [0.46, 0.34, 0.22], belly = [0.82, 0.78, 0.7], pink = [0.72, 0.56, 0.52];
    if (tag === 'tail' || tag === 'paw') return pink;
    if (tag === 'ear') return mix3(pink, base, 0.4);
    let c = mix3(base, [0.3, 0.22, 0.14], n3(x, y, z, 400, 17) * 0.5);
    if (y < 0.022) c = belly;
    return c;
  },
  eyes: [1, -1].map((s) => ({ bone: 'head', at: [0.011 * s, 0.047, 0.059], r: 0.0036, dir: [0.8 * s, 0.2, 0.6] })),
  extras: [{ type: 'ell', bone: 'head', at: [0, 0.036, 0.079], size: [0.002, 0.0016, 0.0014], mat: 'nose' }],
  gait: { walk: 0.25, run: 3.5, stride: 0.05, runStride: 0.16, swing: 0.6, fBend: 0.9, hBend: 0.9, bob: 0.003, tailLift: 0.1, jawOpen: 0.3,
    rearAngle: 0.7, crouchDrop: 0.008, deadDrop: 0.02 },
};

// a red squirrel: rust-red with a white front, ear tufts and a huge tail curled up over its back
const SQ_J = {
  hip: [0, 0.1, -0.06], chest: [0, 0.1, 0.04], neck: [0, 0.12, 0.08], head: [0, 0.14, 0.1], jaw: [0, 0.125, 0.12],
  shoulder: [0.025, 0.09, 0.06], elbow: [0.028, 0.05, 0.05], wrist: [0.026, 0.012, 0.07], fToe: [0.026, 0.005, 0.086],
  hipJ: [0.03, 0.095, -0.07], knee: [0.038, 0.06, -0.02], hock: [0.034, 0.015, -0.08], hToe: [0.034, 0.005, -0.03],
  tail: [[0, 0.105, -0.12], [0, 0.16, -0.17], [0, 0.24, -0.16], [0, 0.29, -0.11], [0, 0.31, -0.06]],
};
export const SQUIRREL = {
  name: 'squirrel', label: 'Red squirrel', res: 70, blend: 0.015, radius: 0.07, height: 0.22,
  fur: { len: 0.009, density: 750, shells: 12, comb: [0, -0.2, -0.8] },
  eyeColor: ['#2a160a', '#050302'], slitEyes: false,
  bones: skeleton(SQ_J),
  prims: [
    ell('root', [0, 0.095, -0.055], [0.044, 0.05, 0.064], { tag: 'body' }),
    ell('chest', [0, 0.095, 0.03], [0.037, 0.045, 0.045], { tag: 'body' }),
    ell('head', [0, 0.14, 0.113], [0.029, 0.029, 0.034], { tag: 'head' }),
    ell('head', [0, 0.133, 0.143], [0.016, 0.015, 0.016], { tag: 'muzzle' }),
    ...[1, -1].map((s) => cone('head', [0.018 * s, 0.163, 0.105], [0.022 * s, 0.195, 0.1], 0.009, 0.003, { tag: 'ear', fur: 1.8, k: 0.005 })),
    ...limbs(SQ_J, [0.012, 0.009, 0.008, 0.007, 0.007, 0.006], [0.022, 0.012, 0.009, 0.008, 0.008, 0.008], [0.02, 0.02, 0.02, 0.018, 0.012],
      [0.008, 0.006, 0.014], { tailFur: 3.2, hindPawLong: 1.6 }),
  ],
  color(x, y, z, tag){
    const base = [0.62, 0.3, 0.13], white = [0.9, 0.86, 0.78];
    if (tag === 'tail') return mix3([0.52, 0.24, 0.09], [0.7, 0.4, 0.2], n3(x, y, z, 200, 19) * 0.6);
    let c = mix3(base, [0.45, 0.2, 0.08], n3(x, y, z, 260, 18) * 0.5);
    if ((tag === 'body' && y < 0.085 && z > -0.03) || (tag === 'muzzle' && y < 0.13)) c = white;
    return c;
  },
  eyes: [1, -1].map((s) => ({ bone: 'head', at: [0.022 * s, 0.148, 0.13], r: 0.0065, dir: [0.8 * s, 0.15, 0.6] })),
  extras: [{ type: 'ell', bone: 'head', at: [0, 0.136, 0.159], size: [0.004, 0.003, 0.0025], mat: 'dark' }],
  gait: { walk: 0.5, run: 6, stride: 0.12, runStride: 0.45, swing: 0.6, fBend: 0.8, hBend: 1.0, bob: 0.01, tailLift: 0, jawOpen: 0.3,
    rearAngle: 0.8, crouchDrop: 0.02, deadDrop: 0.05, hop: true },
};

// a roe deer: slim and long-legged, red-brown, a white rump, big ears, a dark nose with a white band
const DEER_J = {
  hip: [0, 0.78, -0.38], chest: [0, 0.8, 0.2], neck: [0, 0.88, 0.34], head: [0, 1.1, 0.5], jaw: [0, 1.05, 0.56],
  shoulder: [0.1, 0.76, 0.26], elbow: [0.11, 0.5, 0.2], wrist: [0.1, 0.2, 0.24], fToe: [0.1, 0.03, 0.28],
  hipJ: [0.1, 0.76, -0.42], knee: [0.12, 0.52, -0.3], hock: [0.11, 0.28, -0.52], hToe: [0.11, 0.03, -0.47],
  tail: [[0, 0.8, -0.56], [0, 0.74, -0.6]],
};
export const DEER = {
  name: 'deer', label: 'Roe deer', res: 76, blend: 0.05, radius: 0.33, height: 1.2,
  fur: { len: 0.012, density: 420, shells: 12, comb: [0, -0.3, -0.7] },
  eyeColor: ['#3a2410', '#0a0502'], slitEyes: false,
  bones: skeleton(DEER_J),
  prims: [
    ell('root', [0, 0.76, -0.34], [0.13, 0.15, 0.22], { tag: 'body' }),
    cone('root', [0, 0.74, -0.14], [0, 0.76, 0.08], 0.14, 0.16, { tag: 'body' }),
    ell('chest', [0, 0.76, 0.18], [0.14, 0.18, 0.2], { tag: 'body' }),
    cone('neck', [0, 0.84, 0.28], [0, 1.06, 0.47], 0.08, 0.055, { tag: 'neck' }),
    ell('head', [0, 1.11, 0.53], [0.058, 0.064, 0.08], { tag: 'head' }),
    cone('head', [0, 1.09, 0.58], [0, 1.045, 0.7], 0.045, 0.027, { tag: 'muzzle', k: 0.03 }),
    cone('jaw', [0, 1.04, 0.58], [0, 1.025, 0.68], 0.025, 0.015, { tag: 'chin', k: 0.02 }),
    ...[1, -1].map((s) => cone('head', [0.04 * s, 1.16, 0.5], [0.095 * s, 1.24, 0.47], 0.032, 0.012, { tag: 'ear', fur: 0.5, k: 0.02 })),
    ...limbs(DEER_J, [0.055, 0.035, 0.026, 0.02, 0.018, 0.016], [0.08, 0.04, 0.03, 0.02, 0.018, 0.016], [0.03, 0.02],
      [0.016, 0.024, 0.022], { pawFur: 0, pawK: 0.01 }),
  ],
  color(x, y, z, tag){
    const base = [0.56, 0.33, 0.18], pale = [0.78, 0.66, 0.52], white = [0.9, 0.88, 0.84];
    if (tag === 'paw') return [0.08, 0.06, 0.05];
    let c = mix3(base, [0.42, 0.24, 0.12], n3(x, y, z, 30, 23) * 0.4);
    if (tag === 'tail' || (tag === 'body' && z < -0.5 && y > 0.62)) return white;      // the rump patch
    if (tag === 'body' && y < 0.66) c = mix3(c, pale, 0.6);
    if (tag === 'leg' || tag === 'thigh') c = mix3(c, [0.4, 0.28, 0.18], 0.4);
    if (tag === 'muzzle') c = z > 0.66 ? [0.08, 0.06, 0.05] : z > 0.62 ? white : c;
    if (tag === 'chin') c = white;
    if (tag === 'ear') c = mix3(c, [0.2, 0.15, 0.1], 0.3);
    return c;
  },
  eyes: [1, -1].map((s) => ({ bone: 'head', at: [0.05 * s, 1.14, 0.6], r: 0.017, dir: [0.7 * s, 0.1, 0.7] })),
  extras: [{ type: 'ell', bone: 'head', at: [0, 1.05, 0.705], size: [0.022, 0.016, 0.012], mat: 'dark' }],
  gait: { walk: 1.1, run: 11, stride: 1.0, runStride: 3.0, swing: 0.55, fBend: 1.2, hBend: 1.0, bob: 0.03, tailLift: 0.2, jawOpen: 0.3,
    rearAngle: 0.6, crouchDrop: 0.08, deadDrop: 0.45 },
};
Object.assign(SPECIES, { hare: HARE, mouse: MOUSE, squirrel: SQUIRREL, deer: DEER });

// ============================================================ posing
// A holds the animation state: phase, speed, and 0..1 amounts for each special move.
const LEGS = [
  // [upper, lower, foot, front?, side, walk offset, run offset]
  ['hUpL', 'hLoL', 'hMetL', false, 1, 0.0, 0.0],
  ['fUpL', 'fLoL', 'fPawL', true, 1, 0.25, 0.55],
  ['hUpR', 'hLoR', 'hMetR', false, -1, 0.5, 0.08],
  ['fUpR', 'fLoR', 'fPawR', true, -1, 0.75, 0.65],
];
const ease = (t) => t * t * (3 - 2 * t);
export function newAnim(){
  return { phase: Math.random(), speed: 0, turn: 0, swipe: 0, swipeSide: 1, rear: 0, crouch: 0, leap: 0, dead: 0, hurt: 0, bite: 0, gore: 0, jaw: 0,
    headYaw: 0, headPitch: 0, tailWag: 0, time: Math.random() * 10, air: 0 };
}
export function advance(def, A, dt){
  const g = def.gait;
  const run = clamp((A.speed - g.walk) / (g.run - g.walk), 0, 1);
  const stride = lerp(g.stride, g.runStride, run);
  A.phase = (A.phase + dt * A.speed / stride) % 1;
  A.time += dt;
}
export function pose(group, def, A){
  const B = group.userData.bones, g = def.gait;
  for (const k in B){ B[k].rotation.set(0, 0, 0); B[k].position.copy(B[k].userData.rest); }
  const run = clamp((A.speed - g.walk) / (g.run - g.walk), 0, 1);
  const moving = clamp(A.speed / g.walk, 0, 1) * (1 - A.dead);
  const duty = lerp(0.62, 0.38, run);
  const amp = g.swing * lerp(0.75, 1.15, run) * moving;
  const T = A.time;

  for (const [up, lo, ft, front, side, wo, ro] of LEGS){
    const off = g.hop ? (front ? 0.5 : 0) + (side > 0 ? 0 : 0.05) : lerp(wo, ro, run);
    const p = (A.phase + off) % 1;
    let s, lift;
    if (p < duty){ s = 1 - 2 * p / duty; lift = 0; }
    else { const q = (p - duty) / (1 - duty); s = -1 + 2 * ease(q); lift = Math.sin(q * Math.PI); }
    lift *= moving;
    if (front){
      B[up].rotation.x = -s * amp;
      B[lo].rotation.x = lift * g.fBend;
      B[ft].rotation.x = lift * g.fBend * 0.7 + s * amp * 0.3;
    } else {
      B[up].rotation.x = -s * amp * 0.9;
      B[lo].rotation.x = lift * g.hBend * 0.8 + s * amp * 0.2;
      B[ft].rotation.x = -lift * g.hBend * 1.1;
    }
  }
  // body: a bob with each step, rocking in the gallop, leaning into turns
  const root = B.root;
  const ph = A.phase * Math.PI * 2;
  root.position.y -= Math.abs(Math.sin(ph * 2)) * g.bob * moving * (0.6 + run);
  root.rotation.x = Math.sin(ph) * 0.07 * run;
  B.chest.rotation.x = -Math.sin(ph) * 0.06 * run;
  root.rotation.z = clamp(-A.turn * 0.04 * (A.speed + 1), -0.25, 0.25);
  B.chest.rotation.y = clamp(A.turn * 0.12, -0.3, 0.3);
  // head: steady, looking where it wants
  B.neck.rotation.x = -root.rotation.x * 0.8 + A.headPitch * 0.6;
  B.head.rotation.x = A.headPitch * 0.4;
  B.neck.rotation.y = A.headYaw * 0.5; B.head.rotation.y = A.headYaw * 0.5;
  // tail: swings with the stride, lifts when running, flicks idly
  for (let i = 0; i < 4; i++){
    const t = B['t' + i]; if (!t) break;
    t.rotation.x = g.tailLift * (i === 0 ? 1 : 0.3) - run * 0.18 + Math.sin(T * 1.3 + i) * 0.04 - A.crouch * 0.1;
    t.rotation.y = Math.sin(ph + i * 0.7) * 0.12 * moving + Math.sin(T * 2.1 - i * 0.8) * (0.08 + A.tailWag) * (i + 1) * 0.4;
  }
  B.jaw.rotation.x = A.jaw * g.jawOpen;

  // ---- special moves, layered on top
  if (A.crouch > 0){
    const c = A.crouch;
    root.position.y -= c * g.crouchDrop;
    for (const S of ['L', 'R']){
      B['fUp' + S].rotation.x += -0.55 * c; B['fLo' + S].rotation.x += 1.1 * c; B['fPaw' + S].rotation.x += -0.55 * c;
      B['hUp' + S].rotation.x += -0.5 * c; B['hLo' + S].rotation.x += 0.9 * c; B['hMet' + S].rotation.x += -0.4 * c;
    }
    B.neck.rotation.x += 0.15 * c;
  }
  if (A.rear > 0){
    const r = ease(A.rear), a = r * g.rearAngle;
    root.rotation.x -= a;
    for (const S of ['L', 'R']){ B['hUp' + S].rotation.x += a * 0.85; B['hMet' + S].rotation.x += a * 0.15; B['fUp' + S].rotation.x += -r * 0.6; B['fLo' + S].rotation.x += -r * 0.4; }
    B.neck.rotation.x += a * 0.55;
    root.position.z -= Math.sin(a) * 0.05;
  }
  if (A.swipe > 0){
    // one forelimb reaches up and forward, then rakes across and down
    const p = A.swipe, S = A.swipeSide > 0 ? 'L' : 'R', s = A.swipeSide;
    const raise = p < 0.4 ? ease(p / 0.4) : 1 - ease((p - 0.4) / 0.6);
    const rake = p < 0.4 ? 0 : ease(Math.min(1, (p - 0.4) / 0.3));
    B['fUp' + S].rotation.x += -1.7 * raise - 0.4 * rake;
    B['fUp' + S].rotation.z += s * (0.5 * raise - 0.9 * rake * (1 - raise * 0.5));
    B['fLo' + S].rotation.x += -0.5 * raise;
    B['fPaw' + S].rotation.x += -0.6 * raise;
    root.rotation.x -= 0.12 * raise; B.chest.rotation.z += s * 0.15 * raise;
    B.neck.rotation.y += -s * 0.2 * raise;
    A.jaw = Math.max(A.jaw, raise * 0.6);
    B.jaw.rotation.x = A.jaw * g.jawOpen;
  }
  if (A.leap > 0){
    const l = A.leap;
    for (const S of ['L', 'R']){
      B['fUp' + S].rotation.x += -1.25 * l; B['fLo' + S].rotation.x += -0.2 * l; B['fPaw' + S].rotation.x += -0.4 * l;
      B['hUp' + S].rotation.x += 0.9 * l; B['hLo' + S].rotation.x += 0.4 * l; B['hMet' + S].rotation.x += 0.4 * l;
    }
    B.neck.rotation.x += -0.2 * l;
    for (let i = 0; i < 4; i++) if (B['t' + i]) B['t' + i].rotation.x += -0.15 * l;
  }
  if (A.bite > 0){
    const p = A.bite, lunge = Math.sin(Math.min(1, p) * Math.PI);
    B.neck.rotation.x += lunge * 0.25; B.head.rotation.x += -lunge * 0.2;
    B.jaw.rotation.x = (p < 0.55 ? ease(p / 0.55) : Math.max(0, 1 - (p - 0.55) * 8)) * g.jawOpen * 1.3;
    root.rotation.x += lunge * 0.06;
  }
  if (A.gore > 0){
    const p = A.gore, toss = p < 0.35 ? -ease(p / 0.35) * 0.3 : -0.3 + ease((p - 0.35) / 0.3) * 1.1 - ease(clamp((p - 0.65) / 0.35, 0, 1)) * 0.8;
    B.neck.rotation.x += -toss; B.head.rotation.x += -toss * 0.4;
  }
  if (A.hurt > 0){
    const h = A.hurt;
    B.neck.rotation.x -= h * 0.3; B.neck.rotation.y += Math.sin(T * 40) * h * 0.15; root.rotation.z += Math.sin(T * 31) * h * 0.06;
  }
  if (A.dead > 0){
    const d = ease(A.dead);
    root.rotation.z = d * 1.45; root.position.y -= d * g.deadDrop; root.position.x += d * g.deadDrop * 0.4;
    for (const S of ['L', 'R']){ B['fUp' + S].rotation.x = lerp(B['fUp' + S].rotation.x, -0.3, d); B['hUp' + S].rotation.x = lerp(B['hUp' + S].rotation.x, 0.25, d);
      B['fLo' + S].rotation.x = lerp(B['fLo' + S].rotation.x, 0.4, d); B['hLo' + S].rotation.x = lerp(B['hLo' + S].rotation.x, 0.3, d); }
    B.neck.rotation.x = lerp(B.neck.rotation.x, 0.3, d); B.jaw.rotation.x = Math.max(B.jaw.rotation.x, 0.25 * d);
  }
}
