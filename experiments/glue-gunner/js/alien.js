// The aliens: tall, gaunt, eyeless-looking stalkers with a long ridged skull, a lipless mouth full of
// needle teeth that opens far back along the cheeks, six small glowing eyes, a rib cage pushing
// through wet dark skin, very long arms with three-clawed hands, backward-bending legs and a tail.
//
// Every alien is ONE skinned mesh (plus one for teeth/claws/spines and one for the eyes) on its own
// skeleton of 30 bones. The shape is built once and shared by every alien: they differ only in
// their pose, their size and their skin tint. Skin is smoothly blended between bones at the joints,
// so it bends like a body, not like a doll.
//
// Ripping a part off: the torn bone is shrunk to nothing on the alien (its skin collapses into the
// joint, which gets a wound cap), and a "debris" copy is made that shares the same shape but has a
// skeleton where only that part is left. So tearing never builds new geometry.
import * as THREE from 'three';
import { V, clamp, lerp, damp, rng, vnoise, angleDiff } from './util.js';

// ---------- the skeleton ----------
// name, parent, bind position (metres, alien standing at the origin facing +Z; about 2.3 m tall)
const SIDE = [['L', 1], ['R', -1]];   // (the alien's left is +X)
const DEF = [
  ['root', null, [0, 0, 0]],
  ['hips', 'root', [0, 1.10, -0.02]],
  ['spine', 'hips', [0, 1.26, -0.045]],
  ['chest', 'spine', [0, 1.52, -0.01]],
  ['neck', 'chest', [0, 1.79, -0.01]],
  ['head', 'neck', [0, 2.0, 0.02]],
  ['jaw', 'head', [0, 1.972, 0.0]],
  ['tail1', 'hips', [0, 1.05, -0.16]],
  ['tail2', 'tail1', [0, 0.93, -0.5]],
  ['tail3', 'tail2', [0, 0.7, -0.86]],
];
for (const [n, s] of SIDE){
  DEF.push(['arm' + n, 'chest', [s * 0.21, 1.765, -0.02]]);
  DEF.push(['fore' + n, 'arm' + n, [s * 0.31, 1.27, -0.05]]);
  DEF.push(['hand' + n, 'fore' + n, [s * 0.35, 0.86, 0.02]]);
  DEF.push(['thigh' + n, 'hips', [s * 0.12, 1.06, -0.01]]);
  DEF.push(['shin' + n, 'thigh' + n, [s * 0.17, 0.62, 0.19]]);
  DEF.push(['meta' + n, 'shin' + n, [s * 0.17, 0.30, -0.11]]);
  DEF.push(['toe' + n, 'meta' + n, [s * 0.17, 0.06, 0.05]]);
}
export const BONE = {};
DEF.forEach((d, i) => { BONE[d[0]] = i; });
const BIND = DEF.map((d) => V(...d[2]));
const PARENT = DEF.map((d) => (d[1] ? BONE[d[1]] : -1));
const CHILDREN = DEF.map((_, i) => DEF.map((d, j) => (PARENT[j] === i ? j : -1)).filter((j) => j >= 0));
function subtreeOf(i){ const out = [i]; for (const c of CHILDREN[i]) out.push(...subtreeOf(c)); return out; }
const SUB = DEF.map((_, i) => subtreeOf(i));
const subtree = (i) => SUB[i];
// where each part ends (for the hit capsules and wound caps), in bind coordinates
const TIP = { head: [0, 1.99, 0.40], jaw: [0, 1.925, 0.37], tail3: [0, 0.3, -1.32] };
for (const [n, s] of SIDE){ TIP['hand' + n] = [s * 0.36, 0.5, 0.12]; TIP['toe' + n] = [s * 0.17, 0.025, 0.24]; }
// hit capsules: bone, end (a bone or a tip), radius
const CAPS = [
  ['hips', 'spine', 0.16], ['spine', 'chest', 0.14], ['chest', 'neck', 0.19], ['neck', 'head', 0.075],
  ['head', 'tip', 0.12], ['jaw', 'tip', 0.06], ['tail1', 'tail2', 0.075], ['tail2', 'tail3', 0.055], ['tail3', 'tip', 0.04],
];
for (const [n] of SIDE){
  CAPS.push(['arm' + n, 'fore' + n, 0.065], ['fore' + n, 'hand' + n, 0.052], ['hand' + n, 'tip', 0.05],
    ['thigh' + n, 'shin' + n, 0.09], ['shin' + n, 'meta' + n, 0.055], ['meta' + n, 'toe' + n, 0.045], ['toe' + n, 'tip', 0.045]);
}
const CAP_END = CAPS.map(([b, e]) => (e === 'tip' ? V(...TIP[b]).sub(BIND[BONE[b]]) : BIND[BONE[e]].clone().sub(BIND[BONE[b]])));
// which bone gives way when a part is pulled hard (hips: the alien is torn in half at the waist)
export function tearBoneFor(name){ return name === 'hips' || name === 'chest' ? 'spine' : name; }
// how hard (newtons) a part can be pulled before it rips off
const STRENGTH = { jaw: 1100, head: 1900, neck: 2000, spine: 2700, tail1: 1500, tail2: 1200, tail3: 900 };
for (const [n] of SIDE) Object.assign(STRENGTH, { ['arm' + n]: 1700, ['fore' + n]: 1450, ['hand' + n]: 1200, ['thigh' + n]: 2000, ['shin' + n]: 1550, ['meta' + n]: 1300, ['toe' + n]: 1100 });
export function strengthOf(name){ return STRENGTH[tearBoneFor(name)] || 1500; }
// what each part is called (for messages)
export function partName(name){
  const n = name.replace(/[LR]$/, ''), side = /L$/.test(name) ? 'left ' : /R$/.test(name) ? 'right ' : '';
  return side + ({ arm: 'arm', fore: 'forearm', hand: 'hand', thigh: 'leg', shin: 'leg', meta: 'foot', toe: 'toes', jaw: 'jaw', head: 'head', neck: 'head', spine: 'top half', tail1: 'tail', tail2: 'tail', tail3: 'tail tip' })[n];
}
// rough mass of each part with everything hanging off it (kg), for debris
const MASS = { head: 6, jaw: 1.5, neck: 8, spine: 38, tail1: 7, tail2: 4, tail3: 2 };
for (const [n] of SIDE) Object.assign(MASS, { ['arm' + n]: 7, ['fore' + n]: 4, ['hand' + n]: 1.5, ['thigh' + n]: 11, ['shin' + n]: 5, ['meta' + n]: 3, ['toe' + n]: 1 });

// ---------- building the shape ----------
// A tube swept along a smooth path, with a radius (rx sideways, ry along `ref`) at each control
// point, an optional radius multiplier mod(u, angle) for ribs and ridges, rounded ends, vertex
// colours col(u, angle, point, outward, bump) and skin weights skin(u) → [bone, w, bone2, w2].
const TMP = { c: V(), t: V(), n: V(), b: V(), p: V(), o: V() };
function cr(a, b, c, d, t){ return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t); }
function tube(o){
  const { pts, radii, ring = 18, steps = 6, ref = [0, 0, 1], mod, col, skin, capStart = true, capEnd = true, uvK = 7, tip0 = 0.7, tip1 = 0.7 } = o;
  const P = pts.map((p) => V(...p));
  const curve = new THREE.CatmullRomCurve3(P, false, 'centripetal');
  const n = (P.length - 1) * steps;
  const rAt = (u) => {
    const f = u * (radii.length - 1), i = Math.min(radii.length - 2, Math.floor(f)), t = f - i;
    const a = radii[Math.max(0, i - 1)], b = radii[i], c = radii[i + 1], d = radii[Math.min(radii.length - 1, i + 2)];
    return [Math.max(0.002, cr(a[0], b[0], c[0], d[0], t)), Math.max(0.002, cr(a[1], b[1], c[1], d[1], t))];
  };
  // frames carried along the path without twisting
  const C = [], T = [], N = [], U = [];
  for (let j = 0; j <= n; j++){ const u = j / n; U.push(u); C.push(curve.getPointAt(u)); T.push(curve.getTangentAt(u).normalize()); }
  const r0 = V(...ref); let n0 = r0.clone().addScaledVector(T[0], -r0.dot(T[0]));
  if (n0.lengthSq() < 1e-6) n0 = V(1, 0, 0).addScaledVector(T[0], -T[0].x);
  N.push(n0.normalize());
  for (let j = 1; j <= n; j++){
    const ax = V().crossVectors(T[j - 1], T[j]), l = ax.length(), nn = N[j - 1].clone();
    if (l > 1e-6) nn.applyAxisAngle(ax.divideScalar(l), Math.acos(clamp(T[j - 1].dot(T[j]), -1, 1)));
    N.push(nn.addScaledVector(T[j], -nn.dot(T[j])).normalize());
  }
  const pos = [], uv = [], colr = [], si = [], sw = [], idx = [];
  const R = ring + 1;
  let len = 0;
  const pushRing = (c, t, nn, rx, ry, u, vlen, scaleR = 1) => {
    const b = V().crossVectors(t, nn);
    const circ = Math.PI * (rx + ry), rep = Math.max(1, Math.round(circ * uvK));
    for (let i = 0; i <= ring; i++){
      const a = (i / ring) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const m = (mod ? mod(u, a) : 1) * scaleR;
      const p = V().copy(c).addScaledVector(b, ca * rx * m).addScaledVector(nn, sa * ry * m);
      const out = V().copy(b).multiplyScalar(ca).addScaledVector(nn, sa).normalize();
      pos.push(p.x, p.y, p.z); uv.push((i / ring) * rep, vlen * uvK);
      const k = col ? col(u, a, p, out, m / scaleR - 1) : [1, 1, 1];
      colr.push(k[0], k[1], k[2]);
      const s = skin(u);
      si.push(s[0], s[2] ?? 0, 0, 0); sw.push(s[1], s[3] ?? 0, 0, 0);
    }
  };
  // rounded start cap rings
  const capRings = (j, dir, tipK) => {
    const [rx, ry] = rAt(U[j]), rr = Math.min(rx, ry);
    const list = [];
    for (let k = 3; k >= 1; k--){ const f = k / 4 * Math.PI / 2; list.push({ off: Math.sin(f) * rr * tipK, s: Math.cos(f) }); }
    return list.map((q) => ({ c: C[j].clone().addScaledVector(T[j], dir * q.off), s: q.s, rx, ry }));
  };
  let rings = 0;
  if (capStart){
    for (const q of capRings(0, -1, tip0)){ pushRing(q.c, T[0], N[0], q.rx, q.ry, 0, -0.02, q.s); rings++; }
  }
  for (let j = 0; j <= n; j++){
    if (j) len += C[j].distanceTo(C[j - 1]);
    const [rx, ry] = rAt(U[j]);
    pushRing(C[j], T[j], N[j], rx, ry, U[j], len); rings++;
  }
  if (capEnd){
    for (const q of capRings(n, 1, tip1).reverse()){ pushRing(q.c, T[n], N[n], q.rx, q.ry, 1, len + 0.02, q.s); rings++; }
  }
  for (let j = 0; j < rings - 1; j++) for (let i = 0; i < ring; i++){
    const a = j * R + i, b = a + 1, c = a + R, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  // close the ends with a fan to a centre point
  const fan = (ringIdx, centre, u, flip) => {
    const ci = pos.length / 3;
    pos.push(centre.x, centre.y, centre.z); uv.push(0.5, 0);
    const k = colr.slice(ringIdx * R * 3, ringIdx * R * 3 + 3); colr.push(k[0], k[1], k[2]);
    const s = skin(u); si.push(s[0], s[2] ?? 0, 0, 0); sw.push(s[1], s[3] ?? 0, 0, 0);
    for (let i = 0; i < ring; i++){ const a = ringIdx * R + i, b = a + 1; if (flip) idx.push(ci, b, a); else idx.push(ci, a, b); }
  };
  { const [rx, ry] = rAt(0); fan(0, C[0].clone().addScaledVector(T[0], -(capStart ? Math.min(rx, ry) * tip0 : 0)), 0, false); }
  { const [rx, ry] = rAt(1); fan(rings - 1, C[n].clone().addScaledVector(T[n], capEnd ? Math.min(rx, ry) * tip1 : 0), 1, true); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  // make sure the faces point outward (a mid ring vertex's normal should point away from the path)
  const mj = (capStart ? 3 : 0) + Math.floor(n / 2), vi = mj * R + 1;
  const nv = V().fromBufferAttribute(g.attributes.normal, vi), pv = V().fromBufferAttribute(g.attributes.position, vi).sub(C[Math.floor(n / 2)]);
  if (nv.dot(pv) < 0){ const ix = g.index.array; for (let i = 0; i < ix.length; i += 3){ const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.computeVertexNormals(); }
  // the seam where the ring closes gets averaged normals
  const Nn = g.attributes.normal;
  for (let j = 0; j < rings; j++){
    const a = j * R, b = j * R + ring;
    const x = Nn.getX(a) + Nn.getX(b), y = Nn.getY(a) + Nn.getY(b), z = Nn.getZ(a) + Nn.getZ(b), l = Math.hypot(x, y, z) || 1;
    Nn.setXYZ(a, x / l, y / l, z / l); Nn.setXYZ(b, x / l, y / l, z / l);
  }
  // a point on the surface at (u, angle), for placing eyes and teeth on it
  g.userData.surf = (u, a) => {
    const j = Math.round(clamp(u) * n), b = V().crossVectors(T[j], N[j]), [rx, ry] = rAt(U[j]), m = mod ? mod(U[j], a) : 1;
    return V().copy(C[j]).addScaledVector(b, Math.cos(a) * rx * m).addScaledVector(N[j], Math.sin(a) * ry * m);
  };
  g.userData.centre = (u) => C[Math.round(clamp(u) * n)].clone();
  g.userData.uAtZ = (z) => { let best = 0, bd = Infinity; for (let j = 0; j <= n; j++){ const d = Math.abs(C[j].z - z); if (d < bd){ bd = d; best = U[j]; } } return best; };
  return g;
}
// skin weights from the joints along a path: joints are [point, bone] in order; each vertex
// belongs to the bone of the segment it is in, blended with the neighbour within `blend` metres of a joint
function jointSkin(joints, blend = 0.06, startBone = null){
  const d = [0];
  for (let i = 1; i < joints.length; i++) d.push(d[i - 1] + V(...joints[i][0]).distanceTo(V(...joints[i - 1][0])));
  const L = d[d.length - 1];
  return (u) => {
    const x = u * L;
    let k = 0; while (k < joints.length - 1 && x > d[k + 1]) k++;
    const own = BONE[joints[k][1]];
    // near the start of this segment: blend with the bone before
    const prev = k > 0 ? BONE[joints[k - 1][1]] : startBone != null ? BONE[startBone] : null;
    const into = x - d[k];
    if (prev != null && into < blend){ const w = 0.5 + 0.5 * (into / blend); return [own, w, prev, 1 - w]; }
    const next = k + 1 < joints.length - 1 ? BONE[joints[k + 1][1]] : null;
    const left = d[k + 1] - x;
    if (next != null && left < blend){ const w = 0.5 + 0.5 * (left / blend); return [own, w, next, 1 - w]; }
    return [own, 1];
  };
}
const one = (name) => () => [BONE[name], 1];
function merge(list){
  let nv = 0, ni = 0; for (const g of list){ nv += g.attributes.position.count; ni += g.index.count; }
  const out = new THREE.BufferGeometry();
  for (const [name, size, Arr] of [['position', 3, Float32Array], ['normal', 3, Float32Array], ['uv', 2, Float32Array], ['color', 3, Float32Array], ['skinIndex', 4, Uint16Array], ['skinWeight', 4, Float32Array]]){
    const a = new Arr(nv * size); let o = 0;
    for (const g of list){ a.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(a, size));
  }
  const ix = new Uint32Array(ni); let o = 0, base = 0;
  for (const g of list){ const s = g.index.array; for (let i = 0; i < s.length; i++) ix[o++] = s[i] + base; base += g.attributes.position.count; g.dispose(); }
  out.setIndex(new THREE.BufferAttribute(ix, 1));
  out.computeBoundingSphere();
  out.userData.keep = true;
  return out;
}
// a little sphere (eyes) skinned to one bone
function blob(c, r, bone, color, w = 10, h = 8){
  const g = new THREE.SphereGeometry(r, w, h); g.translate(c.x, c.y, c.z);
  const n = g.attributes.position.count, k = new THREE.Color(color);
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(n).fill(0).flatMap(() => [k.r, k.g, k.b]), 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(n).fill(0).flatMap(() => [BONE[bone], 0, 0, 0]), 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(n).fill(0).flatMap(() => [1, 0, 0, 0]), 4));
  return g;
}
// a curved spike (tooth, claw, spine): from base along a bending path to a sharp point
function spike(base, dir, len, r, bone, c0, c1, bend = V(0, 0, 0), ring = 6){
  const d = dir.clone().normalize(), b = V(...base);
  const mid = b.clone().addScaledVector(d, len * 0.5).addScaledVector(bend, len * 0.25);
  const end = b.clone().addScaledVector(d, len).addScaledVector(bend, len * 0.7);
  const ref = Math.abs(d.y) > 0.9 ? [0, 0, 1] : [0, 1, 0];
  const k0 = new THREE.Color(c0), k1 = new THREE.Color(c1);
  return tube({ pts: [b.toArray(), mid.toArray(), end.toArray()], radii: [[r, r], [r * 0.62, r * 0.62], [r * 0.08, r * 0.08]], ring, steps: 3, ref,
    capStart: false, capEnd: false, skin: one(bone), col: (u) => { const k = k0.clone().lerp(k1, Math.pow(u, 1.5)); return [k.r, k.g, k.b]; } });
}

// colours of the skin
const SKIN = { back: new THREE.Color('#101311'), belly: new THREE.Color('#3b3c36'), ridge: new THREE.Color('#6c6858'), dark: new THREE.Color('#0a0b0a'),
  gum: new THREE.Color('#3e0a0d'), mouth: new THREE.Color('#2a0507'), socket: new THREE.Color('#050605'), vein: new THREE.Color('#2c2a3a') };
function skinCol(p, out, bump, extra = 0){
  // pale underneath and in front, dark on the back; ridges (ribs, knuckles, vertebrae) catch the light
  const front = out.z * 0.6 - out.y * 0.5;
  const k = SKIN.back.clone().lerp(SKIN.belly, clamp(0.35 + front * 0.6 + extra));
  // mottling
  const m = vnoise(p.x * 18 + 3, p.y * 18 + p.z * 11) * 0.6 + vnoise(p.x * 47, p.y * 41 + p.z * 37, 5) * 0.4;
  k.multiplyScalar(0.6 + m * 0.7);
  // dark veins
  const v = Math.pow(1 - Math.abs(vnoise(p.x * 9 + p.z * 7, p.y * 9, 9) * 2 - 1), 10);
  k.lerp(SKIN.vein, v * 0.6);
  if (bump > 0) k.lerp(SKIN.ridge, clamp(bump * 5));
  return k;
}
const toArr = (k) => [k.r, k.g, k.b];

function buildShape(){
  const body = [], detail = [], eyes = [];
  // --- torso: hips, a pinched waist, a rib cage pushing through the skin, narrow shoulders
  body.push(tube({
    pts: [[0, 0.98, -0.035], [0, 1.10, -0.035], [0, 1.26, -0.06], [0, 1.42, -0.03], [0, 1.57, -0.005], [0, 1.70, -0.02], [0, 1.79, -0.03]],
    radii: [[0.1, 0.08], [0.135, 0.095], [0.082, 0.068], [0.15, 0.13], [0.172, 0.135], [0.158, 0.108], [0.105, 0.072]],
    ring: 32, steps: 9, ref: [0, 0, 1],
    mod: (u, a) => {
      const sa = Math.sin(a), ca = Math.cos(a);
      let m = 1;
      // ribs: sharp ridges that sweep down toward the front, fading at the breastbone and the back
      const zone = clamp((u - 0.4) / 0.06) * clamp((0.86 - u) / 0.05);
      const ur = (u - 0.42 + 0.07 * Math.max(0, sa)) / 0.42;
      const w = Math.sin(ur * Math.PI * 6.5);
      const side = (1 - Math.pow(Math.max(0, sa), 10)) * clamp((sa + 0.75) * 1.6);
      m += (0.085 * Math.pow(Math.max(0, w), 6) - 0.03 * Math.pow(Math.max(0, -w), 2)) * zone * side;
      // breastbone ridge, a deeply hollow belly under the ribs
      m += 0.05 * zone * Math.pow(Math.max(0, sa), 40);
      m -= 0.12 * clamp((u - 0.2) / 0.1) * clamp((0.42 - u) / 0.07) * Math.max(0, sa);
      // hip bones
      m += 0.05 * Math.exp(-Math.pow((u - 0.17) / 0.04, 2)) * Math.pow(Math.abs(ca), 8);
      // vertebrae down the back
      m += 0.12 * Math.pow(Math.max(0, -sa), 40) * Math.pow(Math.max(0, Math.sin(u * Math.PI * 22)), 2);
      // shoulder blades
      m += 0.08 * Math.exp(-Math.pow((u - 0.8) / 0.06, 2)) * Math.exp(-Math.pow((Math.abs(ca) - 0.55) / 0.2, 2)) * Math.max(0, -sa);
      return m;
    },
    col: (u, a, p, out, bump) => toArr(skinCol(p, out, bump * 0.8, -0.1)),
    skin: jointSkin([[[0, 0.98, 0], 'hips'], [[0, 1.26, 0], 'spine'], [[0, 1.52, 0], 'chest'], [[0, 1.79, 0], 'chest']], 0.07),
  }));
  // --- neck: thin and sinewy, vertebrae down the back
  body.push(tube({
    pts: [[0, 1.68, -0.035], [0, 1.82, -0.02], [0, 1.94, 0.0], [0, 2.05, -0.03]],
    radii: [[0.085, 0.075], [0.058, 0.052], [0.052, 0.05], [0.07, 0.07]],
    ring: 18, steps: 6, ref: [0, 0, 1],
    mod: (u, a) => { const sa = Math.sin(a), ca = Math.cos(a); return 1 + 0.16 * Math.pow(Math.max(0, -sa), 20) * Math.pow(Math.max(0, Math.sin(u * Math.PI * 7)), 2)
      + 0.1 * Math.pow(Math.max(0, sa * 0.7 + Math.abs(ca) * 0.7), 16); },
    col: (u, a, p, out, bump) => toArr(skinCol(p, out, bump * 0.7)),
    skin: jointSkin([[[0, 1.68, 0], 'chest'], [[0, 1.79, 0], 'neck'], [[0, 2.0, 0], 'head'], [[0, 2.05, 0], 'head']], 0.06),
  }));
  // --- the head: a long skull swept back into a ridged crest, a narrow face, the upper jaw
  const headPts = [[0, 2.32, -0.38], [0, 2.23, -0.2], [0, 2.11, -0.02], [0, 2.045, 0.15], [0, 2.0, 0.29], [0, 1.98, 0.405]];
  const headR = [[0.012, 0.012], [0.066, 0.06], [0.112, 0.104], [0.092, 0.072], [0.056, 0.038], [0.014, 0.013]];
  const headMod = (u, a) => {
    const sa = Math.sin(a), ca = Math.cos(a);
    let m = 1;
    // the crest: a sharp ridge along the top of the skull, with ribs across it
    m += 0.22 * Math.pow(Math.max(0, sa), 18) * clamp(1 - u * 1.4) * (1 + 0.4 * Math.pow(Math.max(0, Math.sin(u * 40)), 4));
    // brow ridges over the eyes, hollow cheeks under them
    m += 0.08 * Math.exp(-Math.pow((u - 0.6) / 0.06, 2)) * Math.pow(Math.max(0, sa * 0.8 + Math.abs(ca) * 0.6), 4);
    m -= 0.09 * Math.exp(-Math.pow((u - 0.7) / 0.1, 2)) * Math.pow(Math.max(0, Math.abs(ca)), 2) * Math.max(0, -sa + 0.2);
    // flat underneath, where the mouth is
    m -= 0.18 * Math.pow(Math.max(0, -sa), 3) * clamp((u - 0.45) / 0.15);
    // bony ridges running back along the skull, and cheekbones
    m += 0.035 * Math.pow(Math.max(0, Math.cos((a - Math.PI / 2) * 5)), 6) * Math.max(0, sa) * clamp((0.75 - u) * 3);
    m += 0.07 * Math.exp(-Math.pow((u - 0.52) / 0.07, 2)) * Math.pow(Math.abs(ca), 8);
    return m;
  };
  // (in the head's frame, angle 0 is the alien's right (-X), pi its left (+X), -pi/2 straight down)
  const sideA = (s, a) => (s > 0 ? Math.PI - a : a);
  const headShape = tube({ pts: headPts, radii: headR, ring: 26, steps: 8, ref: [0, 1, 0], tip0: 0.4, tip1: 0.35, mod: headMod, skin: one('head') });
  // the eyes: three on each side of the face, sunk into dark sockets
  const eyeAt = [];
  for (const s of [1, -1]) for (const [z, a, r] of [[0.14, 0.45, 0.0115], [0.185, 0.36, 0.0095], [0.1, 0.6, 0.009], [0.225, 0.3, 0.0072]]){
    const u = headShape.userData.uAtZ(z), p = headShape.userData.surf(u, sideA(s, a)), c = headShape.userData.centre(u);
    eyeAt.push({ p: c.lerp(p, 0.96), r });
  }
  const sampleOnly = [headShape];
  body.push(tube({
    pts: headPts, radii: headR, ring: 26, steps: 8, ref: [0, 1, 0], tip0: 0.4, tip1: 0.35, mod: headMod,
    col: (u, a, p, out, bump) => {
      let k = skinCol(p, out, bump * 0.6, 0.05);
      // dark sockets round the eyes, the gums along the mouth
      for (const e of eyeAt){ const d = p.distanceTo(e.p); if (d < e.r * 3.6) k.lerp(SKIN.socket, clamp((e.r * 3.6 - d) / (e.r * 1.6))); }
      const sa = Math.sin(a);
      if (u > 0.45 && sa < -0.35) k.lerp(SKIN.gum, clamp((-sa - 0.35) * 3) * clamp((u - 0.45) * 8));
      return toArr(k);
    },
    skin: one('head'),
  }));
  // --- the lower jaw, hinged far back so the mouth opens very wide
  const jawShape = tube({
    pts: [[0, 1.975, -0.03], [0, 1.94, 0.13], [0, 1.928, 0.28], [0, 1.926, 0.37]],
    radii: [[0.078, 0.042], [0.068, 0.031], [0.045, 0.023], [0.019, 0.016]],
    ring: 18, steps: 6, ref: [0, 1, 0], tip0: 0.5, tip1: 0.6,
    mod: (u, a) => 1 - 0.25 * Math.pow(Math.max(0, Math.sin(a)), 3) * clamp(u * 4) + 0.18 * Math.pow(Math.max(0, -Math.sin(a)), 14),
    col: (u, a, p, out, bump) => { const k = skinCol(p, out, bump, 0.15); if (Math.sin(a) > 0.3) k.lerp(SKIN.gum, clamp((Math.sin(a) - 0.3) * 2.5)); return toArr(k); },
    skin: one('jaw'),
  });
  body.push(jawShape);
  // the inside of the mouth (seen when it opens): a dark red tongue and throat
  body.push(tube({
    pts: [[0, 1.965, -0.04], [0, 1.952, 0.12], [0, 1.945, 0.3]], radii: [[0.06, 0.03], [0.06, 0.022], [0.035, 0.014]], ring: 12, steps: 4, ref: [0, 1, 0],
    col: (u) => toArr(SKIN.mouth.clone().lerp(new THREE.Color('#5a1418'), u)), skin: one('jaw'),
  }));
  // --- teeth: long needles along both jaws, longest at the front, crossing outside the closed mouth
  const tr = rng(77);
  for (const s of [1, -1]){
    for (let i = 0; i < 12; i++){
      const z = 0.03 + i * 0.029, f = i / 11, u = headShape.userData.uAtZ(z);
      const base = headShape.userData.centre(u).lerp(headShape.userData.surf(u, sideA(s, -0.95)), 0.9);
      const len = 0.025 + f * 0.025 + tr() * 0.022 + (i === 3 || i === 9 ? 0.035 : 0);
      detail.push(spike(base.toArray(), V(s * (0.02 + tr() * 0.06), -1, 0.05 + f * 0.25 + (tr() - 0.5) * 0.2), len, 0.0036 + f * 0.0016, 'head', '#4a3a24', '#e8dfc0', V((tr() - 0.5) * 0.2, 0, 0.25)));
    }
    for (let i = 0; i < 11; i++){
      const z = 0.05 + i * 0.03, f = i / 10, u = jawShape.userData.uAtZ(z);
      const base = jawShape.userData.centre(u).lerp(jawShape.userData.surf(u, sideA(s, 0.9)), 0.88);
      const len = 0.022 + f * 0.022 + tr() * 0.018 + (i === 8 ? 0.03 : 0);
      detail.push(spike(base.toArray(), V(s * (0.02 + tr() * 0.06), 1, 0.08 + (tr() - 0.5) * 0.2), len, 0.0034 + f * 0.0014, 'jaw', '#4a3a24', '#e8dfc0', V((tr() - 0.5) * 0.2, 0, 0.2)));
    }
  }
  // spines on the crest
  for (let i = 0; i < 4; i++){ const z = -0.32 + i * 0.09; detail.push(spike([0, 2.29 - i * 0.04, z], V(0, 0.6, -1), 0.07 - i * 0.012, 0.012, 'head', '#2a2620', '#b8ac8a', V(0, 0.4, 0))); }
  for (const e of eyeAt) eyes.push(blob(e.p, e.r, 'head', '#ffffff', 10, 8));
  // dorsal spines down the back
  for (let i = 0; i < 8; i++){
    const y = 1.32 + i * 0.062, f = i / 7;
    const zb = -0.045 - lerp(0.085, 0.13, Math.sin(f * Math.PI)) - (y > 1.52 ? 0.0 : 0);
    detail.push(spike([0, y, zb], V(0, 0.55, -1), 0.06 + Math.sin(f * Math.PI) * 0.07, 0.013, y < 1.52 ? 'spine' : 'chest', '#1a1814', '#a89c7c', V(0, 0.5, 0)));
  }
  // --- arms: very long, bony elbows, three long clawed fingers and a thumb
  for (const [n, s] of SIDE){
    const sh = [s * 0.10, 1.74, -0.02], sho = [s * 0.21, 1.765, -0.02], mid = [s * 0.27, 1.52, -0.035], el = [s * 0.31, 1.27, -0.05], fm = [s * 0.335, 1.06, -0.015], wr = [s * 0.35, 0.86, 0.02];
    body.push(tube({
      pts: [sh, sho, mid, el, fm, wr],
      radii: [[0.055, 0.05], [0.058, 0.054], [0.044, 0.042], [0.038, 0.04], [0.04, 0.034], [0.026, 0.021]],
      ring: 18, steps: 7, ref: [0, 0, 1],
      mod: (u, a) => { const sa = Math.sin(a); return 1 + 0.25 * Math.exp(-Math.pow((u - 0.6) / 0.03, 2)) * Math.pow(Math.max(0, -sa), 4)   // the elbow
        + 0.06 * Math.exp(-Math.pow((u - 0.8) / 0.12, 2)) * Math.pow(Math.max(0, sa), 2) + 0.04 * Math.exp(-Math.pow((u - 0.12) / 0.07, 2))
        + 0.07 * Math.pow(Math.abs(Math.sin(a * 2)), 10) * clamp((u - 0.62) * 8) * clamp((0.92 - u) * 8); },   // tendons down the forearm
      col: (u, a, p, out, bump) => toArr(skinCol(p, out, bump * 0.7, -0.05).multiplyScalar(lerp(1, 0.7, u))),
      skin: jointSkin([[sh, 'chest'], [sho, 'arm' + n], [el, 'fore' + n], [wr, 'fore' + n]], 0.06),
    }));
    // the palm, the fingers and the claws
    const palm0 = V(...wr), palm1 = V(s * 0.362, 0.755, 0.045);
    body.push(tube({ pts: [palm0.toArray(), [s * 0.358, 0.81, 0.03], palm1.toArray()], radii: [[0.028, 0.017], [0.035, 0.016], [0.034, 0.014]], ring: 12, steps: 4, ref: [0, 0, 1],
      col: (u, a, p, out, bump) => toArr(skinCol(p, out, bump, -0.1).multiplyScalar(0.7)), skin: one('hand' + n) }));
    for (const [dx, dz, L] of [[-0.022, -0.005, 1], [0, 0.004, 1.12], [0.022, -0.002, 1.02]]){
      const k0 = palm1.clone().add(V(s * dx, 0, dz)), k1 = k0.clone().add(V(s * dx * 0.3, -0.12 * L, 0.02)), k2 = k1.clone().add(V(s * dx * 0.2, -0.1 * L, 0.035));
      body.push(tube({ pts: [k0.toArray(), k1.toArray(), k2.toArray()], radii: [[0.012, 0.011], [0.01, 0.0095], [0.0085, 0.008]], ring: 8, steps: 4, ref: [0, 0, 1],
        mod: (u) => 1 + 0.35 * Math.exp(-Math.pow((u - 0.5) / 0.05, 2)),
        col: (u, a, p, out, bump) => toArr(skinCol(p, out, bump, -0.1).multiplyScalar(0.6)), skin: one('hand' + n) }));
      detail.push(spike(k2.toArray(), V(0, -1, 0.5), 0.085 * L, 0.008, 'hand' + n, '#141210', '#050505', V(0, -0.2, 0.7)));
    }
    const t0 = V(s * 0.345, 0.8, 0.05), t1 = V(s * 0.33, 0.74, 0.095);
    body.push(tube({ pts: [t0.toArray(), [s * 0.336, 0.77, 0.075], t1.toArray()], radii: [[0.012, 0.011], [0.01, 0.01], [0.009, 0.008]], ring: 8, steps: 3, ref: [0, 0, 1],
      col: (u, a, p, out, bump) => toArr(skinCol(p, out, bump, -0.1).multiplyScalar(0.6)), skin: one('hand' + n) }));
    detail.push(spike(t1.toArray(), V(-s * 0.2, -0.6, 1), 0.06, 0.007, 'hand' + n, '#141210', '#050505', V(0, -0.5, 0.2)));
    // a hooked spur behind the elbow, two small spikes on the shoulder
    detail.push(spike([s * 0.315, 1.27, -0.085], V(s * 0.1, 0.2, -1), 0.09, 0.013, 'fore' + n, '#1a1814', '#a89c7c', V(0, 0.6, 0)));
    detail.push(spike([s * 0.2, 1.81, -0.05], V(s * 0.4, 0.7, -0.6), 0.06, 0.011, 'arm' + n, '#1a1814', '#a89c7c', V(0, 0.4, 0)));
    detail.push(spike([s * 0.24, 1.77, -0.07], V(s * 0.5, 0.4, -0.8), 0.045, 0.009, 'arm' + n, '#1a1814', '#a89c7c', V(0, 0.4, 0)));
  }
  // --- legs: backward-bending, a long foot standing on three clawed toes, a spur on the hock
  for (const [n, s] of SIDE){
    const hip = [s * 0.08, 1.07, -0.02], h2 = [s * 0.125, 1.01, 0.0], th = [s * 0.155, 0.83, 0.1], kn = [s * 0.17, 0.62, 0.19], sh = [s * 0.17, 0.46, 0.05],
          hk = [s * 0.17, 0.30, -0.11], mt = [s * 0.17, 0.17, -0.03], ball = [s * 0.17, 0.06, 0.05];
    body.push(tube({
      pts: [hip, h2, th, kn, sh, hk, mt, ball],
      radii: [[0.065, 0.06], [0.082, 0.075], [0.07, 0.066], [0.05, 0.052], [0.044, 0.042], [0.034, 0.034], [0.03, 0.027], [0.034, 0.03]],
      ring: 18, steps: 6, ref: [0, 0, 1],
      mod: (u, a) => { const sa = Math.sin(a); return 1 + 0.2 * Math.exp(-Math.pow((u - 0.39) / 0.03, 2)) * Math.pow(Math.max(0, sa), 3)   // the kneecap
        + 0.3 * Math.exp(-Math.pow((u - 0.72) / 0.025, 2)) * Math.pow(Math.max(0, -sa), 3)   // the hock
        + 0.06 * Math.exp(-Math.pow((u - 0.2) / 0.08, 2)) * Math.pow(Math.max(0, sa), 2); },
      col: (u, a, p, out, bump) => toArr(skinCol(p, out, bump * 0.6, -0.05).multiplyScalar(lerp(1, 0.68, u))),
      skin: jointSkin([[hip, 'hips'], [h2, 'thigh' + n], [kn, 'shin' + n], [hk, 'meta' + n], [ball, 'meta' + n]], 0.06, null),
    }));
    for (const [dx, L] of [[-0.035, 0.85], [0, 1.1], [0.035, 0.9]]){
      const a0 = V(s * 0.17 + s * dx * 0.4, 0.055, 0.05), a1 = V(s * 0.17 + s * dx, 0.04, 0.05 + 0.1 * L), a2 = V(s * 0.17 + s * dx * 1.2, 0.03, 0.05 + 0.17 * L);
      body.push(tube({ pts: [a0.toArray(), a1.toArray(), a2.toArray()], radii: [[0.022, 0.02], [0.016, 0.015], [0.012, 0.011]], ring: 8, steps: 3, ref: [0, 1, 0],
        col: (u, a, p, out, bump) => toArr(skinCol(p, out, bump, -0.1).multiplyScalar(0.6)), skin: one('toe' + n) }));
      detail.push(spike(a2.toArray(), V(0, -0.5, 1), 0.06 * L, 0.009, 'toe' + n, '#141210', '#050505', V(0, -0.8, 0)));
    }
    detail.push(spike([s * 0.17, 0.3, -0.135], V(0, -0.3, -1), 0.07, 0.012, 'meta' + n, '#1a1814', '#a89c7c', V(0, 0.5, 0)));
  }
  // --- the tail: ridged segments, ending in a hooked barb
  const tailPts = [[0, 1.08, -0.08], [0, 1.0, -0.33], [0, 0.92, -0.5], [0, 0.79, -0.7], [0, 0.7, -0.86], [0, 0.5, -1.1], [0, 0.32, -1.3]];
  body.push(tube({
    pts: tailPts, radii: [[0.085, 0.08], [0.07, 0.065], [0.058, 0.054], [0.046, 0.043], [0.036, 0.034], [0.024, 0.022], [0.012, 0.012]],
    ring: 14, steps: 7, ref: [0, 1, 0],
    mod: (u, a) => 1 + 0.14 * Math.pow(Math.max(0, Math.sin(u * Math.PI * 20)), 6) + 0.18 * Math.pow(Math.max(0, Math.sin(a)), 12),
    col: (u, a, p, out, bump) => toArr(skinCol(p, out, bump * 0.25, -0.15)),
    skin: jointSkin([[tailPts[0], 'hips'], [[0, 1.05, -0.16], 'tail1'], [[0, 0.93, -0.5], 'tail2'], [[0, 0.7, -0.86], 'tail3'], [tailPts[6], 'tail3']], 0.07),
  }));
  detail.push(spike([0, 0.31, -1.3], V(0, -0.5, -1), 0.16, 0.02, 'tail3', '#1a1814', '#cfc4a0', V(0, 0.9, 0), 8));
  for (const g of sampleOnly) g.dispose();
  return { body: merge(body), detail: merge(detail), eyes: merge(eyes) };
}

// wet, wrinkled skin: a tiling bump texture turned into a normal map
function skinNormalMap(){
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), img = g.createImageData(S, S), H = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++){
    const u = x / S, v = y / S;
    // wrinkles that run round the limbs, pores, and veins
    const w = 1 - Math.abs(vnoise(u * 10, v * 34, 1, [10, 34]) * 2 - 1);
    const w2 = 1 - Math.abs(vnoise(u * 22, v * 70, 2, [22, 70]) * 2 - 1);
    const pore = vnoise(u * 90, v * 90, 3, 90);
    const vein = Math.pow(1 - Math.abs(vnoise(u * 6, v * 6, 4, 6) * 2 - 1), 14);
    H[y * S + x] = w * w * 0.55 + w2 * w2 * 0.25 + pore * 0.18 + vein * 0.5;
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++){
    const h = (xx, yy) => H[((yy + S) % S) * S + ((xx + S) % S)];
    const dx = (h(x + 1, y) - h(x - 1, y)) * 3.2, dy = (h(x, y + 1) - h(x, y - 1)) * 3.2;
    const l = Math.hypot(dx, dy, 1), i = (y * S + x) * 4;
    img.data[i] = (-dx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

// a raw wound: a ragged disc of torn flesh and ichor with a stub of bone in the middle (+Y points out)
function woundGeometry(){
  const parts = [];
  const g = new THREE.CircleGeometry(1, 20, 0, Math.PI * 2); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 1; i < p.count; i++){ const x = p.getX(i), z = p.getZ(i), a = Math.atan2(z, x), r = 1.05 + 0.25 * Math.sin(a * 7) * Math.cos(a * 3); p.setXYZ(i, x * r, -0.15 * r, z * r); }
  p.setY(0, 0.25);
  const col = []; for (let i = 0; i < p.count; i++){ const k = new THREE.Color(i === 0 ? '#c8e82a' : i % 3 ? '#4a6a10' : '#6a1a1a'); col.push(k.r, k.g, k.b); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  parts.push(g.toNonIndexed());
  const b = new THREE.CylinderGeometry(0.22, 0.3, 0.6, 7); b.translate(0.1, 0.25, 0);
  const bc = []; for (let i = 0; i < b.attributes.position.count; i++) bc.push(0.85, 0.8, 0.66);
  b.setAttribute('color', new THREE.Float32BufferAttribute(bc, 3));
  parts.push(b.toNonIndexed());
  const out = new THREE.BufferGeometry();
  for (const n of ['position', 'normal', 'color']){
    const arr = new Float32Array(parts.reduce((s, q) => s + q.attributes[n].array.length, 0)); let o = 0;
    for (const q of parts){ arr.set(q.attributes[n].array, o); o += q.attributes[n].array.length; }
    out.setAttribute(n, new THREE.BufferAttribute(arr, 3));
  }
  out.computeVertexNormals(); out.userData.keep = true;
  return out;
}

// ---------- the shared kit: shapes, materials, bind matrices (made once) ----------
let KIT = null;
export function alienKit(){
  if (KIT) return KIT;
  const shape = buildShape();
  const normalMap = skinNormalMap();
  const skinMat = (tint) => new THREE.MeshPhysicalMaterial({ color: tint, vertexColors: true, roughness: 0.5, metalness: 0, normalMap, normalScale: new THREE.Vector2(1, 1),
    clearcoat: 0.6, clearcoatRoughness: 0.3, sheen: 0.25, sheenColor: new THREE.Color('#3a3448'), sheenRoughness: 0.6 });
  const rig = makeRig(); rig[0].updateMatrixWorld(true);
  KIT = {
    shape,
    skins: [skinMat('#ffffff'), skinMat('#cfd8d4'), skinMat('#dcd0cc')],
    detailMat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.05 }),
    eyeMat: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffc65a').multiplyScalar(1.6), toneMapped: false }),
    woundGeo: woundGeometry(),
    woundMat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, emissive: '#2a3a00', emissiveIntensity: 0.6 }),
    inverses: rig.map((b) => b.matrixWorld.clone().invert()),
  };
  return KIT;
}
function makeRig(){
  const bones = DEF.map((d) => { const b = new THREE.Bone(); b.name = d[0]; return b; });
  DEF.forEach((d, i) => { if (PARENT[i] >= 0){ bones[PARENT[i]].add(bones[i]); bones[i].position.copy(BIND[i]).sub(BIND[PARENT[i]]); } });
  return bones;
}
function skinned(kit, skeleton, variant){
  const id = new THREE.Matrix4();
  const body = new THREE.SkinnedMesh(kit.shape.body, kit.skins[variant]);
  const detail = new THREE.SkinnedMesh(kit.shape.detail, kit.detailMat);
  const eyes = new THREE.SkinnedMesh(kit.shape.eyes, kit.eyeMat);
  for (const m of [body, detail, eyes]){ m.bind(skeleton, id); m.frustumCulled = false; }
  body.castShadow = detail.castShadow = true; body.receiveShadow = true;
  return [body, detail, eyes];
}
// the direction a part points in its parent's frame (bind pose), for aiming it at things
const SEG_DIR = DEF.map((d, i) => {
  const c = CHILDREN[i].find((j) => !/tail1|thigh/.test(DEF[j][0]) || DEF[i][0] !== 'hips');
  const e = TIP[d[0]] ? V(...TIP[d[0]]) : c != null ? BIND[c] : null;
  return e ? e.clone().sub(BIND[i]).normalize() : V(0, 1, 0);
});
SEG_DIR[BONE.chest] = BIND[BONE.neck].clone().sub(BIND[BONE.chest]).normalize();
SEG_DIR[BONE.spine] = BIND[BONE.chest].clone().sub(BIND[BONE.spine]).normalize();

// ---------- ray tests ----------
const _a = V(), _b = V(), _w = V(), _d = V();
// closest approach of a ray (o, d unit) to the segment a-b: { t (along the ray), dist, p (on the segment) } (reused object)
const _hit = { t: 0, dist: 0, p: V() }, _q1 = V();
function raySeg(o, d, a, b){
  const u = _d.subVectors(b, a), w = _w.subVectors(o, a);
  const B = d.dot(u), C = u.dot(u), D = d.dot(w), E = u.dot(w);
  const den = C - B * B;
  const s = den < 1e-8 ? clamp(E / C) : clamp((E - B * D) / den);
  _hit.p.copy(a).addScaledVector(u, s);
  _hit.t = Math.max(0, _q1.subVectors(_hit.p, o).dot(d));
  _q1.copy(o).addScaledVector(d, _hit.t);
  _hit.dist = _q1.distanceTo(_hit.p);
  return _hit;
}
// test the ray against a set of bones (by index) of a rig; returns the nearest hit { t, bone, point }
function rayRig(bones, alive, o, d, far, scale){
  let best = null;
  for (let k = 0; k < CAPS.length; k++){
    const [bn, , r0] = CAPS[k], i = BONE[bn];
    if (!alive[i]) continue;
    const bone = bones[i];
    _a.setFromMatrixPosition(bone.matrixWorld);
    _b.copy(CAP_END[k]).applyMatrix4(bone.matrixWorld);
    const r = r0 * scale * 1.25;   // (a little generous: these are fast, thin targets)
    const h = raySeg(o, d, _a, _b);
    if (h.dist > r || h.t > far) continue;
    const t = Math.max(0, h.t - Math.sqrt(Math.max(0, r * r - h.dist * h.dist)));
    if (!best || t < best.t){
      // where it lands: on the capsule's surface, toward the shooter
      const pt = V().copy(o).addScaledVector(d, t);
      const surf = h.p.clone().add(pt.sub(h.p).normalize().multiplyScalar(r0 * scale * 0.9));
      best = { t, bone, name: bn, point: surf };
    }
  }
  return best;
}

// ---------- an alien ----------
let nextId = 1;
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _v = V(), _v2 = V(), _v3 = V(), _m = new THREE.Matrix4();
const UPV = V(0, 1, 0), DOWN = V(0, -1, 0);
export class Alien {
  constructor(scene, opts = {}){
    const kit = alienKit();
    this.id = nextId++;
    this.scene = scene;
    this.R = rng(opts.seed ?? (Math.random() * 1e9) | 0);
    this.s = opts.scale ?? 0.92 + this.R() * 0.22;
    this.root = new THREE.Group(); this.root.scale.setScalar(this.s);
    this.bones = makeRig();
    this.root.add(this.bones[0]);
    this.skeleton = new THREE.Skeleton(this.bones, kit.inverses);
    this.meshes = skinned(kit, this.skeleton, opts.variant ?? (this.R() * 3) | 0);
    for (const m of this.meshes) this.root.add(m);
    scene.add(this.root);
    this.alive = DEF.map(() => true);   // bones still attached
    this.wounds = [];
    // the body: a point mass at the centre (com), moved by its legs or by glue strings
    this.mass = 70 * this.s;
    this.com = V(); this.vel = V(); this.force = V(); this.yaw = 0;
    this.grounded = true; this.air = 0;
    this.state = 'prowl'; this.stateT = 0;
    this.hp = 1; this.dead = false; this.deadT = 0; this.lie = 0; this.lieQ = new THREE.Quaternion(); this.sink = 0;
    this.torn = 0; this.legs = 2; this.arms = 2;
    this.phase = this.R() * 6.28; this.speed = 0; this.run = 0; this.crouch = 0.3;
    this.want = V(); this.target = null;
    this.noticeT = opts.notice ?? 1.5 + this.R() * 6;
    this.attackT = 0; this.attackSide = 1; this.hitDone = false; this.cool = 0;
    this.scream = 0; this.struggle = 0; this.pull = V(); this.tension = 0; this.stuckBones = [];
    this.twitch = new THREE.Euler(); this.twitchT = this.R() * 2; this.look = { yaw: 0, pitch: 0 };
    this.jaw = 0; this.breath = this.R() * 6; this.flail = this.R() * 10;
    this.stagger = 0; this.climb = null;
    this.leap = null;
    this.events = [];
  }
  get pos(){ return this.root.position; }
  // put it standing at (x, z) facing yaw
  place(x, z, yaw){
    this.yaw = yaw; this.root.position.set(x, 0, z);
    this.root.quaternion.setFromAxisAngle(UPV, yaw);
    this.com.set(x, 1.1 * this.s, z); this.vel.set(0, 0, 0); this.grounded = true;
    this.pose(0); this.root.updateMatrixWorld(true);
  }
  emit(type, data){ this.events.push([type, data]); }
  // the hit test: the nearest part of this alien along the ray
  ray(o, d, far){ return rayRig(this.bones, this.alive, o, d, far, this.s); }
  boneWorld(name, out){ return out.setFromMatrixPosition(this.bones[BONE[name]].matrixWorld); }
  // a glue end on this alien: where it is now
  endPos(bone, local, out){ return out.copy(local).applyMatrix4(bone.matrixWorld); }

  // rip a part off: returns the new debris
  tear(name, vel){
    const i = BONE[tearBoneFor(name)];
    if (!this.alive[i]) return null;
    const bone = this.bones[i];
    this.root.updateMatrixWorld(true);
    const deb = new Debris(this.scene, this, i);
    for (const j of subtree(i)) this.alive[j] = false;
    bone.scale.setScalar(1e-4);
    // a wound where it came off
    const kit = alienKit(), w = new THREE.Mesh(kit.woundGeo, kit.woundMat);
    const cap = CAPS.find((c) => c[0] === DEF[i][0]); const r = (cap ? cap[2] : 0.06) * 0.95;
    w.position.copy(bone.position); w.quaternion.setFromUnitVectors(UPV, SEG_DIR[i]); w.scale.setScalar(r);
    w.castShadow = false;
    this.bones[PARENT[i]].add(w); this.wounds.push(w);
    this.bleed = { bone: this.bones[PARENT[i]], at: bone.position.clone(), dir: SEG_DIR[i].clone(), t: 2.5 };
    const nm = DEF[i][0];
    if (/^(arm|fore|hand)/.test(nm)) this.arms = (this.alive[BONE.foreL] ? 1 : 0) + (this.alive[BONE.foreR] ? 1 : 0);
    if (/^(thigh|shin|meta)/.test(nm)) this.legs = (this.alive[BONE.metaL] ? 1 : 0) + (this.alive[BONE.metaR] ? 1 : 0);
    if (!/^(jaw|tail)/.test(nm)) this.torn++;
    if (vel) deb.vel.add(vel);
    const fatal = nm === 'spine' || nm === 'neck' || nm === 'head' || this.torn >= 3;
    this.emit('tear', { name: nm, debris: deb, fatal });
    if (fatal) this.die();
    else { this.stagger = 0.9; this.scream = 1; this.emit('shriek'); }
    return deb;
  }
  die(){
    if (this.dead) return;
    this.dead = true; this.state = 'dead'; this.deadT = 0;
    this.lieDir = this.R() < 0.5 ? -1 : 1;
    this.emit('die');
  }
  // fall over onto the deck (from the feet), on its back or its front
  lieTarget(){
    _q.setFromAxisAngle(UPV, this.yaw); _q2.setFromAxisAngle(V(1, 0, 0), this.lieDir * Math.PI / 2 * 0.97);
    return this.lieQ.copy(_q).multiply(_q2);
  }

  // ---------- each frame ----------
  // ctx: { dt, t, player (feet position), playerHead, aliens, world, attackers (Set of ids allowed to charge), wave }
  update(ctx){
    const dt = ctx.dt, s = this.s;
    this.stateT += dt;   // (events are cleared by the game once it has handled them)
    this.cool -= dt; this.stagger = Math.max(0, this.stagger - dt); this.scream = Math.max(0, this.scream - dt * 0.9);
    const F = this.force, T = this.tension;
    // ---- climbing over the edge onto the deck (new waves)
    if (this.climb){
      const c = this.climb; c.t += dt / c.dur;
      const k = clamp(c.t), e = k * k * (3 - 2 * k);
      this.root.position.lerpVectors(c.from, c.to, e); this.root.position.y = lerp(c.from.y, 0, Math.min(1, k * 1.3)) + Math.sin(k * Math.PI) * 0.5;
      this.root.quaternion.setFromAxisAngle(UPV, this.yaw);
      this.com.copy(this.root.position).y += 1.1 * s;
      this.speed = 1.2; this.run = 0;
      this.pose(dt, { climb: 1 - k });
      if (c.t >= 1){ this.climb = null; this.grounded = true; this.state = 'hunt'; this.stateT = 0; this.scream = 1; this.emit('shriek'); }
      this.force.set(0, 0, 0); this.root.updateMatrixWorld(true);
      return;
    }
    // ---- glue pulling it about
    const pulled = T > 30;
    this.struggle = damp(this.struggle, pulled && !this.dead ? 1 : 0, 6, dt);
    if (this.grounded){
      // lifted off its feet when pulled up harder than it weighs
      if (F.y > this.mass * 9.8 * 0.95){ this.grounded = false; this.vel.y = Math.max(this.vel.y, 0.5); }
    }
    if (this.grounded && !this.dead){
      this.think(ctx);
      if (!this.grounded){   // (it just leapt: it's in the air from the next frame)
        this.tension = 0; this.force.set(0, 0, 0); this.pose(dt, ctx); this.root.updateMatrixWorld(true); return;
      }
      // its own legs move it; a strong sideways pull drags it along the deck (its claws grip up to a point)
      const want = this.want;
      const k = this.stagger > 0 ? 2 : 8;
      this.vel.x = damp(this.vel.x, want.x, k, dt); this.vel.z = damp(this.vel.z, want.z, k, dt);
      const fh = Math.hypot(F.x, F.z), grip = 450 * s;
      if (fh > grip){ const f = (fh - grip) / fh / this.mass; this.vel.x += F.x * f * dt * 3; this.vel.z += F.z * f * dt * 3; }
      this.vel.y = 0;
      this.root.position.x += this.vel.x * dt; this.root.position.z += this.vel.z * dt;
      ctx.world.collideGround(this.root.position, 0.45 * s);
      this.root.position.y = 0;
      // face where it's going (or its prey)
      const face = this.faceYaw ?? (Math.hypot(this.vel.x, this.vel.z) > 0.3 ? Math.atan2(this.vel.x, this.vel.z) : this.yaw);
      this.yaw += angleDiff(this.yaw, face) * Math.min(1, dt * (this.state === 'attack' ? 4 : 7));
      // upright, leaning a little into a pull
      _q.setFromAxisAngle(UPV, this.yaw);
      if (pulled){ _v.set(F.x, 0, F.z).normalize(); const lean = clamp(T / 2500, 0, 0.45); _q2.setFromAxisAngle(_v2.crossVectors(UPV, _v).normalize(), lean); if (_v2.lengthSq() > 0) _q.premultiply(_q2); }
      this.root.quaternion.slerp(_q, Math.min(1, dt * 10));
      this.com.copy(this.root.position).y += 1.1 * s;
      this.speed = Math.hypot(this.vel.x, this.vel.z);
    } else if (this.grounded && this.dead){
      // falling over, then lying still (sliding if dragged)
      this.deadT += dt;
      const fh = Math.hypot(F.x, F.z), grip = 250;
      if (fh > grip){ const f = (fh - grip) / fh / this.mass; this.vel.x += F.x * f * dt * 3; this.vel.z += F.z * f * dt * 3; }
      this.vel.x *= Math.exp(-dt * 4); this.vel.z *= Math.exp(-dt * 4); this.vel.y = 0;
      this.root.position.x += this.vel.x * dt; this.root.position.z += this.vel.z * dt;
      ctx.world.collideGround(this.root.position, 0.4 * s);
      this.lie = Math.min(1, this.lie + dt * (0.6 + this.lie * 4));
      this.lieTarget(); _q.setFromAxisAngle(UPV, this.yaw);
      this.root.quaternion.slerpQuaternions(_q, this.lieQ, this.lie * this.lie);
      this.root.position.y = lerp(0, 0.1 * s, this.lie) - this.sink;
      this.com.copy(V(0, 1.1, 0).applyQuaternion(this.root.quaternion).multiplyScalar(s).add(this.root.position));
      if (this.lie >= 1 && !this.thud){ this.thud = true; this.emit('thud'); }
      this.speed = 0;
    } else {
      // in the air: gravity, the strings, a little air drag; it hangs from what it's stuck to
      this.air += dt;
      this.vel.y -= 9.8 * dt;
      _v.copy(F).divideScalar(this.mass); if (_v.length() > 160) _v.setLength(160);
      this.vel.addScaledVector(_v, dt);
      this.vel.multiplyScalar(Math.exp(-dt * (pulled ? 1.6 : 0.15)));
      this.com.addScaledVector(this.vel, dt);
      // swing so the stuck part points at whatever is pulling it
      if (pulled && this.stuckBones.length){
        const sb = this.stuckBones[0];
        _v.copy(sb.local).applyMatrix4(sb.bone.matrixWorld).sub(this.com).normalize();   // com → stuck point (now)
        _v2.copy(this.pull).normalize();
        _q.setFromUnitVectors(_v, _v2);
        _q2.copy(_q).multiply(this.root.quaternion);
        this.root.quaternion.slerp(_q2, Math.min(1, dt * 5));
      } else if (!this.dead){
        // falling free: get the feet back under it
        _q.setFromAxisAngle(UPV, this.yaw); this.root.quaternion.slerp(_q, Math.min(1, dt * 3));
      }
      this.root.position.copy(V(0, -1.1, 0).applyQuaternion(this.root.quaternion).multiplyScalar(s).add(this.com));
      // the leap at you
      if (this.leap && !this.dead && !this.hitDone){
        const ph = ctx.playerHead, dx = ph.x - this.com.x, dz = ph.z - this.com.z;
        if (Math.hypot(dx, dz) < 1.2 && Math.abs(ph.y - 0.4 - this.com.y) < 1.4){ this.hitDone = true; this.emit('hit', { dmg: 20, from: this.com.clone() }); }
      }
      // landing on the deck (or falling off the edge into the sky)
      const onDeck = ctx.world.onDeck(this.com.x, this.com.z);
      const floorY = (this.dead ? 0.25 : 1.1) * s;
      if (onDeck && this.com.y <= floorY && this.vel.y <= 0){
        const v = -this.vel.y;
        this.grounded = true; this.air = 0; this.leap = null;
        this.com.y = floorY;
        if (this.dead){ this.lie = 0.6; this.thud = false; this.yaw = new THREE.Euler().setFromQuaternion(this.root.quaternion, 'YXZ').y; }
        else {
          this.yaw = new THREE.Euler().setFromQuaternion(this.root.quaternion, 'YXZ').y;
          this.root.position.set(this.com.x, 0, this.com.z);
          if (v > 6){ this.stagger = clamp(v / 8, 0.6, 2.2); this.emit('land', { v }); }
          if (v > 15){ this.die(); }
        }
        this.vel.set(this.vel.x * 0.3, 0, this.vel.z * 0.3);
      }
      if (this.com.y < -40 && !this.fell){ this.fell = true; this.emit('void'); if (!this.dead) this.die(); }
      this.speed = 0;
    }
    this.tension = 0; this.force.set(0, 0, 0);
    // ---- the pose
    this.pose(dt, ctx);
    this.root.updateMatrixWorld(true);
    if (this.bleed){ this.bleed.t -= dt; if (this.bleed.t <= 0) this.bleed = null; }
  }

  // ---------- what it wants to do ----------
  think(ctx){
    const s = this.s, P = ctx.player, dx = P.x - this.root.position.x, dz = P.z - this.root.position.z, dist = Math.hypot(dx, dz);
    const toYaw = Math.atan2(dx, dz);
    this.faceYaw = null; this.want.set(0, 0, 0);
    const legK = this.legs === 2 ? 1 : this.legs === 1 ? 0.5 : 0.32;
    if (this.stagger > 0 || this.hold){ this.want.set(0, 0, 0); return; }   // (hold: a test keeping it still)
    // stuck by glue: struggle away from the pull, shrieking
    if (this.tension > 30 && this.state !== 'attack'){
      _v.copy(this.pull).setY(0).normalize().multiplyScalar(-1.6 * legK);
      this.want.copy(_v); this.faceYaw = Math.atan2(-this.pull.x, -this.pull.z);
      if (this.R() < ctx.dt * 0.8) this.emit('shriek');
      if (dist < 2.2 * s && this.arms > 0 && this.cool <= 0) this.startAttack();
      return;
    }
    switch (this.state){
      case 'prowl': {
        // creeping about, crouched, sniffing the air
        if (!ctx.calm) this.noticeT -= ctx.dt * (dist < 14 ? 3 : 1);   // (calm: behind the title screen)
        if (!this.target || this.R() < ctx.dt * 0.15 || Math.hypot(this.target.x - this.root.position.x, this.target.z - this.root.position.z) < 1){
          const a = this.R() * 6.28, r = 3 + this.R() * 8;
          this.target = ctx.world.clampDeck(V(this.root.position.x + Math.cos(a) * r, 0, this.root.position.z + Math.sin(a) * r), 3);
        }
        _v.set(this.target.x - this.root.position.x, 0, this.target.z - this.root.position.z).normalize().multiplyScalar(0.9 * legK);
        this.want.copy(_v);
        if (this.noticeT <= 0){ this.state = 'notice'; this.stateT = 0; this.scream = 1.3; this.emit('shriek'); }
        break;
      }
      case 'notice':
        // rears up and screams at you
        this.faceYaw = toYaw;
        if (this.stateT > 1.1){ this.state = 'hunt'; this.stateT = 0; }
        break;
      case 'hunt': {
        this.faceYaw = toYaw;
        const charge = ctx.attackers.has(this.id);
        if (charge){
          // run at you on all fours, maybe leap the last few metres
          const sp = (5.2 + Math.min(ctx.wave, 6) * 0.25) * legK;
          this.want.set(dx / dist * sp, 0, dz / dist * sp);
          if (dist < 1.9 * s && this.arms + (this.alive[BONE.jaw] ? 1 : 0) > 0 && this.cool <= 0) this.startAttack();
          else if (dist > 4.5 && dist < 7.5 && this.legs === 2 && this.cool <= 0 && this.R() < ctx.dt * 0.5){
            // leap
            this.grounded = false; this.leap = true; this.hitDone = false; this.cool = 2.5;
            const t = 0.55; this.vel.set(dx / t, 9.8 * t / 2 + 0.5, dz / t); this.com.y += 0.1; this.scream = 0.8; this.emit('shriek');
          }
        } else {
          // circle you at a distance, waiting for a gap
          const keep = 7 + (this.id % 4) * 1.5, side = this.id % 2 ? 1 : -1;
          const rad = clamp((dist - keep) * 0.8, -1.5, 2.5), tan = 1.4 * side;
          this.want.set((dx / dist) * rad + (-dz / dist) * tan, 0, (dz / dist) * rad + (dx / dist) * tan).multiplyScalar(legK);
          if (this.R() < ctx.dt * 0.12) this.emit('hiss');
        }
        break;
      }
      case 'attack': {
        this.faceYaw = toYaw;
        const u = this.stateT / 0.75;
        this.want.set(dx / dist, 0, dz / dist).multiplyScalar(u < 0.5 ? 1.5 : 0);
        if (u > 0.5 && !this.hitDone){
          this.hitDone = true;
          const ang = Math.abs(angleDiff(this.yaw, toYaw));
          if (dist < 2.5 * s && ang < 1.2) this.emit('hit', { dmg: this.arms > 0 ? 12 : 9, from: this.com.clone() });
        }
        if (u >= 1){ this.state = 'hunt'; this.stateT = 0; this.cool = 0.35 + this.R() * 0.5; }
        break;
      }
    }
    // keep away from the other aliens
    for (const o of ctx.aliens){
      if (o === this || o.dead || !o.grounded) continue;
      const ox = this.root.position.x - o.root.position.x, oz = this.root.position.z - o.root.position.z, d2 = ox * ox + oz * oz, r = 0.9;
      if (d2 < r * r && d2 > 1e-6){ const d = Math.sqrt(d2), k = (r - d) / d * 4; this.want.x += ox * k; this.want.z += oz * k; }
    }
  }
  startAttack(){
    this.state = 'attack'; this.stateT = 0; this.hitDone = false; this.attackSide = -this.attackSide;
    if (this.arms === 1) this.attackSide = this.alive[BONE.foreL] ? 1 : -1;
    this.emit('swipe');
  }

  // ---------- the pose: every bone's rotation, from the gait, the mood and what's happening ----------
  pose(dt, ctx = {}){
    const b = this.bones, s = this.s;
    const climb = ctx.climb || 0;
    this.breath += dt; this.flail += dt * (6 + this.struggle * 4);
    const sp = this.speed / s;
    // the gait: upright stalking walk, or a four-legged gallop when running
    this.run = damp(this.run, this.grounded && sp > 3.2 && this.legs === 2 && !this.dead ? 1 : 0, 5, dt);
    const crawl = this.legs === 0 && !this.dead ? 1 : 0;
    const stride = lerp(1.3, 2.4, this.run);
    this.phase += (this.grounded ? sp / stride : 0) * Math.PI * 2 * dt * (this.legs === 1 ? 0.8 : 1);
    const ph = this.phase, amt = clamp(sp / 1.5) * (1 - this.run);
    const r = this.run;
    this.crouch = damp(this.crouch, this.state === 'prowl' ? 0.5 : this.state === 'hunt' ? 0.25 : 0.15, 3, dt);
    const E = {};
    const set = (n, x = 0, y = 0, z = 0) => { E[n] = [x, y, z]; };
    const add = (n, x = 0, y = 0, z = 0) => { const e = E[n] || (E[n] = [0, 0, 0]); e[0] += x; e[1] += y; e[2] += z; };
    // posture: hunched, head pushed forward
    const breath = Math.sin(this.breath * 1.7) * 0.03;
    set('spine', 0.22 + this.crouch * 0.25 + r * 0.7 + breath, 0, 0);
    set('chest', 0.12 + this.crouch * 0.15 + r * 0.3 - breath, 0, 0);
    set('neck', -0.2 - this.crouch * 0.25 - r * 0.6, 0, 0);
    set('head', -0.18 - r * 0.35, 0, 0);
    set('hips', -r * 0.12, 0, 0);
    // legs
    for (const [n, side] of SIDE){
      const lp = ph + (side > 0 ? 0 : Math.PI);
      const sw = Math.sin(lp), lift = Math.max(0, Math.cos(lp));
      const c = this.crouch;
      // walking
      let th = -0.12 - c * 0.45 - sw * 0.42 * amt, sh = 0.1 + c * 0.55 + lift * 0.55 * amt, mt = -c * 0.25 - lift * 0.25 * amt;
      // galloping: hind legs together, driving
      const gp = ph * 1 + (side > 0 ? 0 : 0.5);
      th = lerp(th, -0.3 - Math.sin(gp) * 0.6, r); sh = lerp(sh, 0.25 + Math.max(0, Math.cos(gp)) * 0.7, r); mt = lerp(mt, -0.2 + Math.sin(gp) * 0.3, r);
      set('thigh' + n, th, 0, side * (0.06 + c * 0.08));
      set('shin' + n, sh, 0, 0);
      set('meta' + n, mt, 0, 0);
      set('toe' + n, -(th + sh + mt) * 0.6, 0, 0);
      // arms: long, hanging, swinging a little; reaching for the ground at a gallop
      const asw = Math.sin(lp + Math.PI);
      let ax = 0.05 - asw * 0.3 * amt - c * 0.25, az = side * (0.12 + c * 0.1), fx = -0.35 - c * 0.3, hx = -0.25;
      const fp = ph + Math.PI * 0.5 + (side > 0 ? 0 : 0.35);
      ax = lerp(ax, -1.3 + Math.sin(fp) * 0.75, r); fx = lerp(fx, -0.15 - Math.max(0, Math.cos(fp)) * 0.7, r); hx = lerp(hx, 0.5, r);
      set('arm' + n, ax, 0, az); set('fore' + n, fx, 0, 0); set('hand' + n, hx, 0, 0);
    }
    // the tail sways, lifts when running
    const tw = Math.sin(this.breath * 1.3) * 0.25;
    set('tail1', 0.05 + r * 0.45, tw, 0); set('tail2', 0.05 + r * 0.25, tw * 1.2, 0); set('tail3', 0.1 + r * 0.2, tw * 1.5, 0);
    // no legs: dragging itself along on its arms, belly to the deck
    if (crawl){
      add('spine', 0.9); add('chest', 0.25); add('neck', -0.8); add('head', -0.3);
      for (const [n, side] of SIDE){ const cp = ph + (side > 0 ? 0 : Math.PI); set('arm' + n, -1.6 + Math.sin(cp) * 0.6, 0, side * 0.3); set('fore' + n, -0.3 - Math.max(0, Math.cos(cp)) * 0.8); }
    }
    // one leg: hopping, lurching
    if (this.legs === 1 && !this.dead){ add('spine', 0.1, 0, Math.sin(ph) * 0.15); }
    // climbing over the edge: arms reaching up and over
    if (climb){
      for (const [n, side] of SIDE){ add('arm' + n, -2.6 * climb + Math.sin(this.breath * 9 + side) * 0.3 * climb, 0, 0); add('fore' + n, -0.6 * climb); }
      add('spine', 0.5 * climb); add('neck', -0.4 * climb);
    }
    // jaw: breathing, wide open when screaming, attacking or struggling
    let jaw = 0.06 + Math.max(0, Math.sin(this.breath * 0.9)) * 0.08;
    // screaming: rears back, arms out, mouth wide, head shaking
    const sc = clamp(this.scream * 1.6);
    if (sc > 0){
      add('chest', -0.35 * sc); add('spine', -0.25 * sc); add('neck', 0.25 * sc); add('head', -0.25 * sc, Math.sin(this.breath * 38) * 0.07 * sc);
      for (const [n, side] of SIDE){ add('arm' + n, -0.5 * sc, 0, side * 0.75 * sc); add('fore' + n, -0.7 * sc); add('hand' + n, 0.4 * sc); }
      jaw = Math.max(jaw, 0.8 * sc);
    }
    // attacking: one arm swings up and back, then slashes down across; the body lunges
    if (this.state === 'attack' && !this.dead){
      const u = clamp(this.stateT / 0.75), side = this.attackSide, n = side > 0 ? 'L' : 'R';
      const wind = clamp(u / 0.45), strike = clamp((u - 0.45) / 0.18), back = clamp((u - 0.7) / 0.3);
      const k = wind * (1 - back);
      add('arm' + n, (-2.5 * wind + 2.9 * strike) * (1 - back), 0, side * (0.5 * wind - 0.6 * strike) * (1 - back));
      add('fore' + n, (-0.9 * wind + 0.6 * strike) * (1 - back));
      add('chest', 0, (side * 0.45 * wind - side * 0.9 * strike) * (1 - back), 0);
      add('spine', 0.35 * strike * (1 - back) - 0.15 * wind * (1 - strike));
      if (this.arms === 0){ add('neck', 0.5 * strike * (1 - back)); add('spine', 0.4 * strike * (1 - back)); }
      jaw = Math.max(jaw, 0.8 * k);
    }
    // struggling against the glue: thrashing, mouth working
    const st = this.struggle;
    if (st > 0.01){
      const f = this.flail;
      for (const [n, side] of SIDE){
        add('arm' + n, Math.sin(f * 1.1 + side) * 0.9 * st, 0, side * (0.4 + Math.sin(f * 0.9 + side * 2) * 0.5) * st);
        add('fore' + n, -Math.abs(Math.sin(f * 1.3 + side)) * 0.9 * st);
        add('thigh' + n, Math.sin(f * 1.2 + side * 1.5) * 0.6 * st * (this.grounded ? 0.3 : 1)); add('shin' + n, Math.abs(Math.sin(f * 1.5 + side)) * 0.7 * st * (this.grounded ? 0.3 : 1));
      }
      add('spine', 0, Math.sin(f * 0.7) * 0.3 * st, Math.sin(f * 0.8) * 0.25 * st); add('chest', 0, 0, Math.sin(f * 0.9 + 1) * 0.2 * st);
      add('tail1', 0, Math.sin(f * 1.4) * 0.6 * st); add('tail2', 0, Math.sin(f * 1.4 - 0.7) * 0.7 * st);
      add('neck', Math.sin(f * 0.6) * 0.2 * st, Math.sin(f * 0.5) * 0.4 * st);
      jaw = Math.max(jaw, (0.55 + Math.sin(f * 2.3) * 0.4) * st);
    }
    // staggering after a hard landing or losing a part
    if (this.stagger > 0 && !this.dead){ const k = clamp(this.stagger); add('spine', 0.35 * k, 0, Math.sin(this.breath * 7) * 0.2 * k); add('neck', 0.3 * k); }
    // the head: tracks you, with sudden jerky twitches
    if (!this.dead && ctx.player){
      const P = ctx.playerHead || ctx.player;
      _v.set(P.x - this.com.x, 0, P.z - this.com.z);
      const yawTo = angleDiff(this.yaw, Math.atan2(_v.x, _v.z));
      const want = this.state === 'prowl' ? Math.sin(this.breath * 0.6) * 0.7 : clamp(yawTo, -1.1, 1.1);
      this.look.yaw = damp(this.look.yaw, want, 6, dt);
      add('neck', 0, this.look.yaw * 0.45, 0); add('head', 0, this.look.yaw * 0.55, -this.look.yaw * 0.15);
      this.twitchT -= dt;
      if (this.twitchT <= 0){
        this.twitchT = (this.state === 'prowl' ? 0.4 : 0.9) + this.R() * 2.2;
        this.twitch.set((this.R() - 0.5) * 0.7, (this.R() - 0.5) * 0.9, (this.R() - 0.5) * 0.9);
      }
      const tk = Math.exp(-dt * 7);
      this.twitch.x *= tk; this.twitch.y *= tk; this.twitch.z *= tk;
      add('head', this.twitch.x, this.twitch.y, this.twitch.z);
      add('neck', this.twitch.x * 0.3, this.twitch.y * 0.3, 0);
      // fingers flex now and then
      add('handL', Math.sin(this.breath * 2.1) * 0.15); add('handR', Math.sin(this.breath * 2.4 + 1) * 0.15);
    }
    // dead: limp, sprawled, mouth hanging open
    if (this.dead){
      const k = this.grounded ? clamp(this.deadT * 3) : 1;
      const L = (n, x, y, z) => { const e = E[n] || (E[n] = [0, 0, 0]); e[0] = lerp(e[0], x, k); e[1] = lerp(e[1], y, k); e[2] = lerp(e[2], z, k); };
      const hang = this.grounded ? 0 : 1;
      L('spine', 0.1 * this.lieDir, 0, 0.1); L('chest', 0.05, 0, -0.05); L('neck', 0.2 * this.lieDir, 0.5, 0); L('head', 0.3 * this.lieDir, 0.3, 0.2);
      for (const [n, side] of SIDE){
        L('arm' + n, hang ? 0.1 : -0.4 * this.lieDir, 0, side * (hang ? 0.15 : 1.1 + (side > 0 ? 0.2 : -0.1))); L('fore' + n, -0.4, 0, 0); L('hand' + n, -0.3, 0, 0);
        L('thigh' + n, hang ? 0.05 : -0.3, 0, side * (hang ? 0.05 : 0.35)); L('shin' + n, hang ? 0.15 : 0.7, 0, 0); L('meta' + n, hang ? -0.1 : -0.5, 0, 0); L('toe' + n, 0, 0, 0);
      }
      L('tail1', 0.4 * this.lieDir, 0.3, 0); L('tail2', 0.1, 0.4, 0); L('tail3', 0, 0.3, 0);
      jaw = lerp(jaw, 0.7, k);
    }
    this.jaw = damp(this.jaw, jaw, 14, dt);
    set('jaw', this.jaw, 0, 0);
    // apply
    for (let i = 1; i < b.length; i++){
      const e = E[DEF[i][0]];
      if (this.alive[i]){ if (e) b[i].quaternion.setFromEuler(_e.set(e[0], e[1], e[2], 'XYZ')); else b[i].quaternion.identity(); }
    }
    // body bob, the root lower at a gallop or a crawl
    const bob = this.grounded && !this.dead ? Math.abs(Math.sin(ph)) * 0.04 * amt + Math.abs(Math.sin(ph)) * 0.08 * r : 0;
    b[BONE.hips].position.y = BIND[BONE.hips].y - this.crouch * 0.16 - r * 0.1 - crawl * 0.75 + bob - (this.legs === 1 ? 0.08 : 0);
    // a part stuck by glue reaches toward whatever is pulling it
    if (this.stuckBones.length && this.struggle > 0.05){
      this.root.updateMatrixWorld(true);
      for (const sb of this.stuckBones){
        let i = BONE[sb.name];
        // aim the whole limb from its root joint (the hand: from the shoulder)
        const n = DEF[i][0];
        if (/^(fore|hand)/.test(n)) i = BONE['arm' + n.slice(-1)];
        else if (/^(shin|meta|toe)/.test(n)) i = BONE['thigh' + n.slice(-1)];
        else if (n === 'head' || n === 'jaw') i = BONE.neck;
        else if (/^tail/.test(n)) i = BONE.tail1;
        else continue;
        if (!this.alive[i]) continue;
        const bone = b[i], parent = b[PARENT[i]];
        parent.getWorldQuaternion(_q).invert();
        _v.copy(sb.dir).applyQuaternion(_q).normalize();
        _q2.setFromUnitVectors(SEG_DIR[i], _v);
        bone.quaternion.slerp(_q2, clamp(this.struggle * Math.min(1, sb.t / 600)));
        // straighten the rest of the limb
        for (const j of subtree(i).slice(1)) if (this.alive[j] && !/toe|jaw/.test(DEF[j][0])) b[j].quaternion.slerp(_q.identity(), 0.6 * this.struggle);
      }
    }
  }
  // free its skeleton (the shape is shared)
  dispose(){
    this.scene.remove(this.root);
    this.skeleton.dispose();
    for (const w of this.wounds) w.removeFromParent();
  }
}

// ---------- a torn-off part, flying, hanging from a string, or lying on the deck ----------
export class Debris {
  constructor(scene, alien, boneIndex){
    const kit = alienKit();
    this.scene = scene; this.alien = alien; this.s = alien.s;
    this.name = DEF[boneIndex][0];
    this.idx = boneIndex;
    this.parts = subtree(boneIndex);
    this.group = new THREE.Group(); this.group.scale.setScalar(alien.s);
    this.bones = makeRig();
    this.group.add(this.bones[0]);
    this.skeleton = new THREE.Skeleton(this.bones, kit.inverses);
    this.meshes = skinned(kit, this.skeleton, kit.skins.indexOf(alien.meshes[0].material));
    for (const m of this.meshes) this.group.add(m);
    // copy the alien's pose, then cut the part loose: it hangs from this group; everything else shrinks away
    for (let i = 0; i < this.bones.length; i++) this.bones[i].quaternion.copy(alien.bones[i].quaternion);
    const src = alien.bones[boneIndex], top = this.bones[boneIndex];
    src.getWorldPosition(this.group.position); src.getWorldQuaternion(this.group.quaternion);
    this.group.add(top); top.position.set(0, 0, 0); top.quaternion.identity();
    this.bones[0].scale.setScalar(1e-4);
    this.alive = DEF.map((_, i) => this.parts.includes(i));
    // a wound on the torn end
    this.wound = new THREE.Mesh(kit.woundGeo, kit.woundMat);
    const cap = CAPS.find((c) => c[0] === this.name);
    this.wound.scale.setScalar((cap ? cap[2] : 0.06) * 0.95);
    this.wound.quaternion.setFromUnitVectors(UPV, SEG_DIR[boneIndex].clone().negate());
    top.add(this.wound);
    scene.add(this.group);
    // physics: a point mass at the part's middle
    let c = V(); for (const j of this.parts) c.add(BIND[j]); c.divideScalar(this.parts.length).sub(BIND[boneIndex]);
    this.comLocal = c;   // (in the group's frame, before scaling)
    this.mass = MASS[this.name] || 4;
    this.com = V(); this.vel = V(); this.force = V(); this.tension = 0; this.pull = V();
    this.spin = V((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
    this.updateCom();
    // carry the alien's motion
    this.vel.copy(alien.vel);
    this.rest = 0; this.age = 0; this.stuck = null; this.bleed = 2;
    this.radius = this.name === 'spine' ? 0.18 : this.name === 'head' || this.name === 'neck' ? 0.12 : 0.06;
    this.events = [];
  }
  updateCom(){ this.com.copy(this.comLocal).multiplyScalar(this.s).applyQuaternion(this.group.quaternion).add(this.group.position); }
  ray(o, d, far){ return rayRig(this.bones, this.alive, o, d, far, this.s); }
  update(dt, world){
    this.age += dt; this.events.length = 0; this.bleed = Math.max(0, this.bleed - dt);
    const pulled = this.tension > 5;
    if (this.rest > 0.5 && !pulled){ this.tension = 0; this.force.set(0, 0, 0); return; }   // asleep on the deck
    this.vel.y -= 9.8 * dt;
    _v.copy(this.force).divideScalar(this.mass); if (_v.length() > 300) _v.setLength(300);
    this.vel.addScaledVector(_v, dt);
    this.vel.multiplyScalar(Math.exp(-dt * (pulled ? 2.2 : 0.1)));
    this.com.addScaledVector(this.vel, dt);
    // tumble; when hanging from a string, swing so the stuck point is uppermost
    if (pulled && this.stuck){
      _v.copy(this.stuck.local).applyMatrix4(this.stuck.bone.matrixWorld).sub(this.com);
      if (_v.lengthSq() > 1e-6){ _v.normalize(); _v2.copy(this.pull).normalize(); _q.setFromUnitVectors(_v, _v2); _q2.copy(_q).multiply(this.group.quaternion); this.group.quaternion.slerp(_q2, Math.min(1, dt * 6)); }
      this.spin.multiplyScalar(Math.exp(-dt * 4));
    }
    const sl = this.spin.length();
    if (sl > 1e-3){ _q.setFromAxisAngle(_v3.copy(this.spin).divideScalar(sl), sl * dt); this.group.quaternion.premultiply(_q); }
    this.group.position.copy(this.comLocal).multiplyScalar(this.s).applyQuaternion(this.group.quaternion).negate().add(this.com);
    this.group.updateMatrixWorld(true);
    // the deck: find its lowest point and keep it above the floor
    if (world.onDeck(this.com.x, this.com.z)){
      let low = Infinity;
      for (const j of this.parts){ _v.setFromMatrixPosition(this.bones[j].matrixWorld); if (_v.y < low) low = _v.y; }
      const tip = TIP[DEF[this.parts[this.parts.length - 1]][0]];
      if (tip){ _v.set(...tip).sub(BIND[this.parts[this.parts.length - 1]]).applyMatrix4(this.bones[this.parts[this.parts.length - 1]].matrixWorld); low = Math.min(low, _v.y); }
      const floor = this.radius * this.s * 0.6;
      if (low < floor){
        const pen = floor - low;
        this.com.y += pen; this.group.position.y += pen;
        if (this.vel.y < -3) this.events.push(['thud', -this.vel.y]);
        if (this.vel.y < 0) this.vel.y *= -0.2;
        this.vel.x *= Math.exp(-dt * 8); this.vel.z *= Math.exp(-dt * 8);
        this.spin.multiplyScalar(Math.exp(-dt * 6));
        // tip over to lie flat-ish
        if (this.vel.lengthSq() < 0.3 && this.spin.lengthSq() < 0.3 && !pulled) this.rest += dt; else this.rest = 0;
        this.group.updateMatrixWorld(true);
      }
    }
    if (this.com.y < -60) this.gone = true;
    this.tension = 0; this.force.set(0, 0, 0);
  }
  dispose(){ this.scene.remove(this.group); this.skeleton.dispose(); }
}
export const ALIEN_BONES = DEF.map((d) => d[0]);
