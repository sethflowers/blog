// Rides that follow a route you draw (a closed loop): park railway, swan boats, log flume, go-karts; and the
// dark ride (a show building with cars winding past scenes inside).
// Each builder returns a group whose userData has animate(state, dt, on), seat, colliders, glows (as in
// flatrides.js), plus `station` (where guests board) for the drawn ones.
import * as THREE from 'three';
import { Batch, clamp, damp, rng } from './util.js';
import { mat } from './materials.js';
import { resolveMat } from './models.js';
import { boardTexture } from './structures.js';

export const DRAWN = { railway: 1, boats: 1, flume: 1, karts: 1 };
const paint = (hex) => mat('paint' + hex.slice(1), { c: parseInt(hex.slice(1), 16), r: 0.45 });
const shadows = (g) => g.traverse((m) => { if (m.isMesh){ m.castShadow = true; m.receiveShadow = true; } });
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// tidy a drawn line into an even loop: points every `step` metres, smoothed
export function tidyLoop(raw, step = 4){
  if (raw.length < 3) return null;
  const pts = raw.map(([x, z]) => V(x, 0, z));
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  const L = curve.getLength(); if (L < 40) return null;
  const n = Math.max(12, Math.round(L / step));
  return curve.getSpacedPoints(n).slice(0, n).map((p) => [Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10]);
}
// the route as a 3D curve: heights from the ground (or water), the flume's lift and drop added
function routeCurve(o, park){
  const kind = o.kind, P = o.pts, n = P.length;
  const base = P.map(([x, z]) => { const g = park.groundAt(x, z), w = park.waterAt(x, z); return kind === 'boats' ? (Number.isNaN(w) ? g : w) + 0.05 : g + (kind === 'railway' ? 0.25 : kind === 'karts' ? 0.06 : 0.7); });
  let ys = base;
  if (kind === 'flume'){
    // level, a lift up a third of the way round, then a big drop near the end (to a splash)
    const top = Math.max(...base) + (o.size || 12);
    ys = base.map((b, i) => { const t = i / n; if (t < 0.15) return b; if (t < 0.45) return b + (top - b) * (t - 0.15) / 0.3; if (t < 0.78) return top - (t - 0.45) * 2; if (t < 0.86) return Math.max(b, top - 0.66 - (top - b) * (t - 0.78) / 0.08); return b; });
    ys = ys.map((y, i) => Math.max(y, base[i]));
  }
  return new THREE.CatmullRomCurve3(P.map(([x, z], i) => V(x, ys[i], z)), true, 'centripetal');
}
// sweep a cross-section (pairs of [across, up]) along a curve, as a ribbon or trough
function sweep(curve, prof, segs, closedLoop = true){
  const pos = [], idx = [], uv = [], frames = [];
  for (let k = 0; k <= segs; k++){
    const t = (k % segs) / segs, p = curve.getPointAt(t), tan = curve.getTangentAt(t).normalize();
    const side = V(tan.z, 0, -tan.x).normalize().negate(), up = V(0, 1, 0);
    frames.push([p, side, up]);
    prof.forEach(([a, u], j) => { const q = p.clone().addScaledVector(side, a).addScaledVector(up, u); pos.push(q.x, q.y, q.z); uv.push(j / (prof.length - 1), k * 0.5); });
  }
  const m = prof.length;
  for (let k = 0; k < segs; k++) for (let j = 0; j < m - 1; j++){ const a = k * m + j, b = a + m; idx.push(a, a + 1, b, a + 1, b + 1, b); }   // (wound to face up)
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  g.userData.keepUV = true; void closedLoop;
  return g;
}
// a little station: a platform with a canopy and the ride's name
function stationAt(B, own, curve, name, color){
  const p = curve.getPointAt(0), tan = curve.getTangentAt(0), side = V(tan.z, 0, -tan.x).normalize().negate(), yaw = Math.atan2(tan.x, tan.z);
  const c = p.clone().addScaledVector(side, 3.2);
  const m = (x, y, z, w, h, d, key) => B.add(new THREE.BoxGeometry(w, h, d), key, new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), yaw), V(1, 1, 1)));
  m(c.x, p.y - 0.1, c.z, 3, 0.7, 10, 'boards');
  for (const f of [-4.5, 0, 4.5]) for (const s of [-1.3, 1.3]){ const q = c.clone().addScaledVector(tan, f).addScaledVector(side, s); m(q.x, p.y + 1.6, q.z, 0.12, 3.4, 0.12, 'iron'); }
  m(c.x, p.y + 3.4, c.z, 3.6, 0.2, 10.4, 'P');
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.6), new THREE.MeshStandardMaterial({ map: boardTexture(name, { w: 1024, h: 180, bg: color }), roughness: 0.6 }));
  sign.userData.ownMaterial = true; const q = c.clone().addScaledVector(side, 1.85); sign.position.set(q.x, p.y + 3.75, q.z); sign.rotation.y = yaw + Math.PI / 2; own.push(sign);
  return { x: c.x, z: c.z };
}
// a vehicle following the curve: place it (and its children) at distance s
function follow(obj, curve, L, s, yOff = 0){
  const t = ((s / L) % 1 + 1) % 1, p = curve.getPointAt(t), tan = curve.getTangentAt(t);
  obj.position.copy(p).add(V(0, yOff, 0));
  obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(V(0, 0, 0), tan.clone().negate(), V(0, 1, 0)));
}

// --- the park railway: rails and sleepers, a little steam train ----------------------------------------
function buildRailway(o, park){
  const g = new THREE.Group(), curve = routeCurve(o, park), L = curve.getLength(), segs = Math.round(L / 1.2), B = new Batch(), own = [], C = o.color || '#2a5a3a', C2 = o.color2 || '#7a2a2a';
  B.add(sweep(curve, [[-1.3, -0.24], [-1.1, -0.02], [1.1, -0.02], [1.3, -0.24]], segs), 'gravel', null);
  for (const a of [-0.55, 0.55]) B.add(sweep(curve, [[a - 0.04, 0.06], [a - 0.04, 0.14], [a + 0.04, 0.14], [a + 0.04, 0.06]], segs), 'chrome', null);
  for (let s = 0; s < L; s += 0.9){ const t = s / L, p = curve.getPointAt(t), tan = curve.getTangentAt(t); B.add(new THREE.BoxGeometry(1.7, 0.1, 0.22), 'darkwood', new THREE.Matrix4().compose(p.clone().add(V(0, 0.02, 0)), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.atan2(tan.x, tan.z)), V(1, 1, 1))); }
  const station = stationAt(B, own, curve, o.name, C);
  const body = B.build((k) => k === 'P' ? paint(C) : resolveMat(k)); shadows(body); g.add(body); for (const m of own) g.add(m);
  // the train: an engine and three carriages
  const cars = [], mk = (eng) => { const c = new THREE.Group(), CB = new Batch();
    if (eng){ CB.add(new THREE.CylinderGeometry(0.55, 0.55, 2.6, 16).rotateX(Math.PI / 2), 'P', new THREE.Matrix4().makeTranslation(0, 1.25, 0.5)); CB.add(new THREE.CylinderGeometry(0.15, 0.22, 0.8, 10), 'iron', new THREE.Matrix4().makeTranslation(0, 2.1, 1.4)); CB.box('P2', 0, 1.5, -1.0, 1.3, 1.6, 1.2); CB.box('iron', 0, 2.35, -1.0, 1.5, 0.12, 1.5); CB.add(new THREE.SphereGeometry(0.12, 8, 6), 'glow', new THREE.Matrix4().makeTranslation(0, 1.5, 1.85)); }
    else { CB.box('P2', 0, 0.85, 0, 1.4, 0.5, 3.2); for (const z of [-1, 0, 1]) CB.box('wood', 0, 1.15, z, 1.2, 0.1, 0.45); for (const x of [-0.65, 0.65]) for (const z of [-1.5, 1.5]) CB.box('iron', x, 1.6, z, 0.06, 1.0, 0.06); CB.box('P', 0, 2.15, 0, 1.6, 0.08, 3.4); }
    CB.box('iron', 0, 0.45, 0, 1.2, 0.3, 3.2); for (const x of [-0.6, 0.6]) for (const z of [-1, 1]) CB.add(new THREE.CylinderGeometry(0.3, 0.3, 0.12, 12).rotateZ(Math.PI / 2), 'iron', new THREE.Matrix4().makeTranslation(x, 0.35, z));
    const m = CB.build((k) => k === 'P' ? paint(C) : k === 'P2' ? paint(C2) : resolveMat(k)); shadows(m); c.add(m); g.add(c); cars.push(c); return c; };
  mk(true); for (let k = 0; k < 3; k++) mk(false);
  const s0 = new THREE.Object3D(); s0.position.set(0.3, 1.2, -0.6); cars[1].add(s0);
  g.userData = { seat: s0, station, glows: [], colliders: [], curve,
    animate(st, dt, on){ st.v = damp(st.v || 0, on ? 6 : 0, 0.5, dt); st.s = (st.s || 0) + st.v * dt; cars.forEach((c, k) => follow(c, curve, L, st.s - k * 3.6, 0)); } };
  g.userData.animate({ s: 0 }, 0, false);
  return g;
}
// --- swan boats on the water ----------------------------------------------------------------------------
function buildBoats(o, park){
  const g = new THREE.Group(), curve = routeCurve(o, park), L = curve.getLength(), B = new Batch(), own = [], C = o.color || '#f8f8f4', C2 = o.color2 || '#c8983a';
  const station = stationAt(B, own, curve, o.name, '#2a5a7a');
  const body = B.build((k) => k === 'P' ? paint('#2a5a7a') : resolveMat(k)); shadows(body); g.add(body); for (const m of own) g.add(m);
  const boats = [], n = Math.max(3, Math.min(10, Math.round(L / 25)));
  for (let k = 0; k < n; k++){
    const b = new THREE.Group(), BB = new Batch();
    BB.add(new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 'P', new THREE.Matrix4().compose(V(0, 0.45, 0), new THREE.Quaternion(), V(0.9, 0.5, 1.4)));
    BB.box('P2', 0, 0.5, -0.2, 1.2, 0.3, 1.0);
    const neck = new THREE.CatmullRomCurve3([V(0, 0.5, 1.0), V(0, 1.1, 1.35), V(0, 1.7, 1.1), V(0, 1.85, 1.35)]);
    BB.add(new THREE.TubeGeometry(neck, 12, 0.1, 8), 'P', null); BB.add(new THREE.SphereGeometry(0.16, 10, 8), 'P', new THREE.Matrix4().makeTranslation(0, 1.85, 1.4)); BB.add(new THREE.ConeGeometry(0.05, 0.2, 6), 'gold', new THREE.Matrix4().compose(V(0, 1.82, 1.6), new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), Math.PI / 2), V(1, 1, 1)));
    for (const s of [-1, 1]) BB.add(new THREE.SphereGeometry(0.6, 12, 8), 'P', new THREE.Matrix4().compose(V(s * 0.6, 0.75, -0.3), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 0, s * 0.4)), V(0.3, 0.4, 1)));
    const m = BB.build((k2) => k2 === 'P' ? paint(C) : k2 === 'P2' ? paint(C2) : resolveMat(k2)); shadows(m); b.add(m); g.add(b); boats.push(b);
  }
  const s0 = new THREE.Object3D(); s0.position.set(0, 0.6, -0.3); boats[0].add(s0);
  g.userData = { seat: s0, station, glows: [], colliders: [], curve,
    animate(st, dt, on){ st.v = damp(st.v || 0, on ? 1.6 : 0.4, 0.3, dt); st.s = (st.s || 0) + st.v * dt; st.t = (st.t || 0) + dt; boats.forEach((b, k) => { follow(b, curve, L, st.s + k * L / boats.length, Math.sin(st.t * 1.3 + k) * 0.04); }); } };
  g.userData.animate({ s: 0 }, 0, false);
  return g;
}
// --- the log flume: a wooden trough with water, a lift, a big drop, logs ------------------------------------
function buildFlume(o, park){
  const g = new THREE.Group(), curve = routeCurve(o, park), L = curve.getLength(), segs = Math.round(L / 0.8), B = new Batch(), own = [], C = o.color || '#8a6a4a', C2 = o.color2 || '#2a5a7a';
  B.add(sweep(curve, [[-1.2, 0.9], [-1.0, 0.0], [-0.8, -0.2], [0.8, -0.2], [1.0, 0.0], [1.2, 0.9]], segs), 'WD', null);
  B.add(sweep(curve, [[-0.95, 0.1], [0.95, 0.1]], segs), 'W', null);
  // supports where it's up off the ground
  for (let s = 0; s < L; s += 4){ const p = curve.getPointAt(s / L), gy = park.groundAt(p.x, p.z); if (p.y - gy > 1.2){ for (const d of [-0.9, 0.9]){ const tan = curve.getTangentAt(s / L), side = V(tan.z, 0, -tan.x).normalize(); B.add(new THREE.BoxGeometry(0.2, p.y - gy, 0.2), 'darkwood', new THREE.Matrix4().makeTranslation(p.x + side.x * d, (p.y + gy) / 2 - 0.2, p.z + side.z * d)); } } }
  const station = stationAt(B, own, curve, o.name, '#5a3018');
  const water = new THREE.MeshStandardMaterial({ color: 0x3a7a8a, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.8 });
  const body = B.build((k) => k === 'W' ? water : k === 'WD' ? mat('wood', { side: THREE.DoubleSide }) : k === 'P' ? paint(C) : resolveMat(k)); shadows(body); g.add(body); for (const m of own) g.add(m);
  const logs = [], n = Math.max(3, Math.min(8, Math.round(L / 30)));
  for (let k = 0; k < n; k++){ const lg = new THREE.Group(), LB = new Batch(); LB.add(new THREE.CylinderGeometry(0.7, 0.7, 3.2, 14, 1, true).rotateX(Math.PI / 2), 'bark', new THREE.Matrix4().makeTranslation(0, 0.45, 0)); LB.box('wood', 0, 0.35, 0, 1.1, 0.12, 2.8); for (const z of [-0.6, 0.4]) LB.box('wood', 0, 0.6, z, 1.0, 0.4, 0.12); const m = LB.build(resolveMat); shadows(m); lg.add(m); g.add(lg); logs.push(lg); }
  const s0 = new THREE.Object3D(); s0.position.set(0, 0.3, 0.6); logs[0].add(s0);
  // the speed: slow on the level, the chain up the lift, fast down the drop (from the height)
  const vAt = (s) => { const t = ((s / L) % 1 + 1) % 1, p = curve.getPointAt(t), tan = curve.getTangentAt(t); return tan.y > 0.05 ? 2.2 : tan.y < -0.2 ? 12 : 3.5; };
  g.userData = { seat: s0, station, glows: [], colliders: [], curve,
    animate(st, dt, on){ if (!st.s) st.s = logs.map((_, k) => k * L / logs.length); logs.forEach((lg, k) => { st.s[k] += (on ? vAt(st.s[k]) : 0) * dt; follow(lg, curve, L, st.s[k], 0); }); } };
  g.userData.animate({}, 0, false);
  return g;
}
// --- go-karts: a tarmac circuit with red and white kerbs and tyre walls, karts racing round --------------------
function buildKarts(o, park){
  const g = new THREE.Group(), curve = routeCurve(o, park), L = curve.getLength(), segs = Math.round(L / 1), B = new Batch(), own = [];
  B.add(sweep(curve, [[-3.2, 0], [3.2, 0]], segs), 'tarmac', null);
  for (const s of [-1, 1]) B.add(sweep(curve, [[s * 3.2, 0.0], [s * 3.6, 0.06]], segs), 'K', null);
  const kerb = (() => { const c = document.createElement('canvas'); c.width = 64; c.height = 64; const x = c.getContext('2d'); x.fillStyle = '#f0f0f0'; x.fillRect(0, 0, 64, 64); x.fillStyle = '#c8282a'; x.fillRect(0, 0, 64, 32); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return new THREE.MeshStandardMaterial({ map: t, roughness: 0.7 }); })();
  for (let s = 0; s < L; s += 1.1) for (const d of [-4.1, 4.1]){ const t = s / L, p = curve.getPointAt(t), tan = curve.getTangentAt(t), side = V(tan.z, 0, -tan.x).normalize(); B.add(new THREE.CylinderGeometry(0.35, 0.35, 0.5, 10), 'tyre', new THREE.Matrix4().makeTranslation(p.x + side.x * d, p.y + 0.25, p.z + side.z * d)); }
  const station = stationAt(B, own, curve, o.name, '#2a2a2a');
  const body = B.build((k) => k === 'K' ? kerb : k === 'P' ? paint('#2a2a2a') : resolveMat(k)); shadows(body); g.add(body); for (const m of own) g.add(m);
  const karts = [], cols = ['#c8282a', '#2a5ac8', '#e8c040', '#2a8a4a', '#f07a20', '#8a3ad8'], R = rng(5);
  for (let k = 0; k < 6; k++){ const kt = new THREE.Group(), KB = new Batch(); KB.box('P', 0, 0.25, 0, 1.0, 0.22, 1.7); KB.box('iron', 0, 0.45, -0.25, 0.5, 0.35, 0.5); KB.add(new THREE.SphereGeometry(0.17, 10, 8), 'P', new THREE.Matrix4().makeTranslation(0, 0.95, -0.25)); for (const x of [-0.5, 0.5]) for (const z of [-0.6, 0.6]) KB.add(new THREE.CylinderGeometry(0.17, 0.17, 0.16, 10).rotateZ(Math.PI / 2), 'tyre', new THREE.Matrix4().makeTranslation(x, 0.17, z));
    const m = KB.build((key) => key === 'P' ? paint(cols[k]) : resolveMat(key)); shadows(m); kt.add(m); g.add(kt); karts.push({ g: kt, s: k * 4, v: 7 + R() * 3, lane: (R() - 0.5) * 3 }); }
  const s0 = new THREE.Object3D(); s0.position.set(0, 0.5, -0.25); karts[0].g.add(s0);
  g.userData = { seat: s0, station, glows: [], colliders: [], curve,
    animate(st, dt, on){ for (const k of karts){ k.s += (on ? k.v : 0) * dt; follow(k.g, curve, L, k.s, 0); const tan = curve.getTangentAt(((k.s / L) % 1 + 1) % 1); k.g.position.x += tan.z * k.lane; k.g.position.z -= tan.x * k.lane; } } };
  g.userData.animate({}, 0, false);
  return g;
}
// --- the dark ride: a themed show building; inside, cars wind past scenes in the dark --------------------------
export const DARK_THEMES = [['dragon', 'Dragon\'s lair'], ['pirate', 'Pirate treasure'], ['haunted', 'Haunted hall']];
export function buildDark(o){
  const g = new THREE.Group(), S = o.size || 20, B = new Batch(), own = [], th = o.style || 'dragon', C = o.color || '#3a2a4a', C2 = o.color2 || '#c8983a';
  const wallKey = th === 'haunted' ? 'darkwood' : th === 'pirate' ? 'boardwall' : 'rockface';
  // the building: walls (the front with an arched entrance), a roof, inside dark and lit by the scenes
  const W = S, D = S, H = 7;
  B.box(wallKey, 0, H / 2, -D / 2, W, H, 0.4); B.box(wallKey, -W / 2, H / 2, 0, 0.4, H, D); B.box(wallKey, W / 2, H / 2, 0, 0.4, H, D);
  B.box(wallKey, -W / 4 - 1, H / 2, D / 2, W / 2 - 2, H, 0.4); B.box(wallKey, W / 4 + 1, H / 2, D / 2, W / 2 - 2, H, 0.4); B.box(wallKey, 0, H - 1.5, D / 2, 4, 3, 0.4);
  B.box('P', 0, H + 0.2, 0, W + 0.8, 0.4, D + 0.8);
  B.box('concrete', 0, 0.05, 0, W - 0.5, 0.1, D - 0.5);
  if (th === 'haunted'){ B.add(new THREE.ConeGeometry(2.5, 5, 4).rotateY(Math.PI / 4), 'slate', new THREE.Matrix4().makeTranslation(-W / 2 + 2, H + 2.8, D / 2 - 2)); B.add(new THREE.ConeGeometry(2.5, 5, 4).rotateY(Math.PI / 4), 'slate', new THREE.Matrix4().makeTranslation(W / 2 - 2, H + 2.8, D / 2 - 2)); }
  else if (th === 'dragon'){ B.add(new THREE.ConeGeometry(1.2, 4, 6), 'P2', new THREE.Matrix4().compose(V(-2.6, H + 1.5, D / 2), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 0, 0.5)), V(1, 1, 1))); B.add(new THREE.ConeGeometry(1.2, 4, 6), 'P2', new THREE.Matrix4().compose(V(2.6, H + 1.5, D / 2), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 0, -0.5)), V(1, 1, 1))); }
  else { B.add(new THREE.CylinderGeometry(0.15, 0.15, 6, 8), 'darkwood', new THREE.Matrix4().makeTranslation(W / 2 - 1.5, H + 3, D / 2 - 1.5)); B.add(new THREE.PlaneGeometry(2.4, 1.6), 'P2', new THREE.Matrix4().makeTranslation(W / 2 - 0.3, H + 4.6, D / 2 - 1.5)); }
  // the route inside: a serpentine, and the scenes beside it
  const pts = [], rows = 3;
  for (let r = 0; r < rows; r++){ const z = D / 2 - 3 - r * (D - 6) / (rows - 1), dir = r % 2 ? -1 : 1; for (const x of dir > 0 ? [-W / 2 + 3, W / 2 - 3] : [W / 2 - 3, -W / 2 + 3]) pts.push(V(x, 0.3, z)); }
  pts.push(V(-W / 2 + 3, 0.3, -D / 2 + 3 + 1), V(-W / 2 + 1.5, 0.3, 0), V(-1.5, 0.3, D / 2 - 1.5), V(1.5, 0.3, D / 2 - 1.5), V(0, 0.3, D / 2 + 2));
  const curve = new THREE.CatmullRomCurve3(pts.slice(0, -1), true, 'centripetal'), L = curve.getLength();
  B.add(sweep(curve, [[-0.8, 0.12], [0.8, 0.12]], Math.round(L)), 'iron', null);
  const glows = [], scenes = new Batch();
  const sceneAt = (x, z, k) => {
    if (th === 'dragon'){ scenes.add(new THREE.SphereGeometry(1.6, 16, 10), 'P2', new THREE.Matrix4().compose(V(x, 1.4, z), new THREE.Quaternion(), V(1.6, 0.9, 1))); scenes.add(new THREE.ConeGeometry(0.5, 1.6, 8), 'P2', new THREE.Matrix4().compose(V(x + 2, 1.6, z), new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), -Math.PI / 2), V(1, 1, 1))); for (const s of [-0.4, 0.4]) scenes.add(new THREE.SphereGeometry(0.16, 8, 6), 'glow', new THREE.Matrix4().makeTranslation(x + 1.5, 2.0, z + s)); scenes.add(new THREE.SphereGeometry(0.6, 8, 6), 'ember', new THREE.Matrix4().makeTranslation(x + 3, 1.2, z)); }
    else if (th === 'pirate'){ for (let c = 0; c < 3; c++){ scenes.box('wood', x + c * 1.2 - 1.2, 0.45, z, 0.9, 0.7, 0.6); scenes.add(new THREE.SphereGeometry(0.5, 10, 6), 'gold', new THREE.Matrix4().compose(V(x + c * 1.2 - 1.2, 0.85, z), new THREE.Quaternion(), V(1, 0.4, 0.8))); } scenes.add(new THREE.SphereGeometry(0.3, 8, 6), 'glow', new THREE.Matrix4().makeTranslation(x, 2.2, z)); }
    else { for (let c = 0; c < 2; c++){ scenes.add(new THREE.SphereGeometry(0.5, 12, 8), 'ghost', new THREE.Matrix4().makeTranslation(x + c * 1.6, 2.2 + c * 0.3, z)); scenes.add(new THREE.ConeGeometry(0.55, 1.6, 12, 1, true), 'ghost', new THREE.Matrix4().makeTranslation(x + c * 1.6, 1.3 + c * 0.3, z)); } scenes.add(new THREE.CylinderGeometry(0.05, 0.05, 1, 6), 'brass', new THREE.Matrix4().makeTranslation(x - 1.5, 1, z)); scenes.add(new THREE.SphereGeometry(0.12, 8, 6), 'glow', new THREE.Matrix4().makeTranslation(x - 1.5, 1.6, z)); }
    glows.push([x, 2.0, z, 0.1]); void k;
  };
  for (let r = 0; r < rows; r++){ const z = D / 2 - 3 - r * (D - 6) / (rows - 1); sceneAt(-1.5, z + (r % 2 ? 2 : -2), r); }
  const ember = mat('ember', { c: 0xff6a20, r: 0.6, e: 0xff5a10, ei: 2 }), ghost = new THREE.MeshStandardMaterial({ color: 0xd8f0ff, emissive: 0x88c8ff, emissiveIntensity: 0.8, transparent: true, opacity: 0.55 });
  const sm = scenes.build((k) => k === 'P2' ? paint(th === 'dragon' ? '#2a5a3a' : C2) : k === 'ember' ? ember : k === 'ghost' ? ghost : resolveMat(k)); g.add(sm);
  const body = B.build((k) => k === 'P' ? paint(C) : k === 'P2' ? paint(C2) : resolveMat(k)); shadows(body); g.add(body);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.2), new THREE.MeshStandardMaterial({ map: boardTexture(o.name, { w: 1024, h: 205, bg: C }), roughness: 0.6 }));
  sign.userData.ownMaterial = true; sign.position.set(0, H - 0.6, D / 2 + 0.25); g.add(sign);
  const cars = [];
  for (let k = 0; k < 4; k++){ const c = new THREE.Group(), CB = new Batch(); CB.box('P2', 0, 0.55, 0, 1.4, 0.6, 1.8); CB.box('P', 0, 0.95, -0.7, 1.4, 0.5, 0.2); const m = CB.build((key) => key === 'P' ? paint(C) : paint(C2)); shadows(m); c.add(m); g.add(c); cars.push(c); }
  const s0 = new THREE.Object3D(); s0.position.set(0, 0.8, 0.1); cars[0].add(s0);
  g.userData = { seat: s0, glows, colliders: [{ box: [-W / 2, -D / 2, W / 2, D / 2 - 0.2] }], station: { x: 0, z: D / 2 + 3 },
    animate(st, dt, on){ st.s = (st.s || 0) + (on ? 1.4 : 0) * dt; cars.forEach((c, k) => follow(c, curve, L, st.s - k * L / cars.length, 0)); } };
  g.userData.animate({}, 0, false);
  return g;
}
export const TRACK_RIDES = {
  railway: { name: 'Park railway', about: 'A steam train round the park, on a line you draw.' },
  boats: { name: 'Swan boats', about: 'Swan boats gliding round a lake (draw on water).' },
  flume: { name: 'Log flume', about: 'Logs floating down a trough you draw, up a lift and down a big splash.' },
  karts: { name: 'Go-karts', about: 'A circuit you draw, karts racing round it.' },
};
export const DRAWN_DEF = { railway: { name: 'Lantern Valley Railway', color: '#2a5a3a', color2: '#7a2a2a', cap: 24 }, boats: { name: 'Swan Lake', color: '#f8f8f4', color2: '#c8983a', cap: 16 }, flume: { name: 'Timber Falls', color: '#8a6a4a', color2: '#2a5a7a', size: 12, cap: 12 }, karts: { name: 'Grand Prix', color: '#c8282a', color2: '#2a2a2a', cap: 6 } };
// a sample route (an oval), for pictures
export function sampleRoute(r = 22){ const pts = []; for (let k = 0; k < 24; k++){ const a = k / 24 * Math.PI * 2; pts.push([Math.cos(a) * r, Math.sin(a) * r * 0.6]); } return tidyLoop(pts); }
export const TRACK_BUILD = { railway: buildRailway, boats: buildBoats, flume: buildFlume, karts: buildKarts, dark: buildDark };
void clamp;
