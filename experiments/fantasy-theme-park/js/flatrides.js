// More flat rides, each built from its design and animated by itself:
//   drop tower, swing ride, swinging ship, teacups, scrambler.
// A builder returns a group whose userData has:
//   animate(state, dt, on)  moves it (state: { t, phase, phaseT, power } kept by rides.js; on: running)
//   seat                    an Object3D for a rider (its +z forward, eyes 1 m above it)
//   colliders, glows        for walking into it, and lights at night
import * as THREE from 'three';
import { Batch, lathe, clamp, damp } from './util.js';
import { mat } from './materials.js';
import { resolveMat } from './models.js';

const paint = (hex) => mat('paint' + hex.slice(1), { c: parseInt(hex.slice(1), 16), r: 0.45 });
const stripeMats = new Map();
function stripes(a, b, n = 16){
  const k = a + b + n; let m = stripeMats.get(k); if (m) return m;
  const c = document.createElement('canvas'); c.width = 512; c.height = 32; const g = c.getContext('2d');
  for (let i = 0; i < n; i++){ g.fillStyle = i % 2 ? b : a; g.fillRect(i * 512 / n, 0, 512 / n + 1, 32); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.8, side: THREE.DoubleSide }); stripeMats.set(k, m);
  return m;
}
const M = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
const shadows = (g) => g.traverse((m) => { if (m.isMesh){ m.castShadow = true; m.receiveShadow = true; } });
function built(B, C, C2){ const g = B.build((k) => k === 'P' ? paint(C) : k === 'P2' ? paint(C2) : k === 'S' ? stripes(C, C2, 20) : resolveMat(k)); shadows(g); return g; }
// a simple seat with a lap bar, facing +z
function seat(B, x, y, z, ry = 0, key = 'P2'){
  B.add(new THREE.BoxGeometry(0.55, 0.08, 0.5), key, M(x, y, z, 0, ry)); B.add(new THREE.BoxGeometry(0.55, 0.6, 0.08), key, M(x - Math.sin(ry) * 0.25, y + 0.3, z - Math.cos(ry) * 0.25, 0, ry));
  B.add(new THREE.TorusGeometry(0.22, 0.025, 6, 12, Math.PI), 'chrome', M(x + Math.sin(ry) * 0.18, y + 0.32, z + Math.cos(ry) * 0.18, 0, ry));
}
function base(B, R, h = 0.35){ B.add(lathe([[0, 0], [R + 0.3, 0], [R + 0.3, h], [R + 0.15, h + 0.05], [0, h + 0.05]], 40), 'ashlar', null); }
const fence = (B, R) => { for (let k = 0; k < 28; k++){ const a = k / 28 * Math.PI * 2; B.add(new THREE.BoxGeometry(0.06, 1.0, 0.06), 'iron', M(Math.cos(a) * R, 0.5, Math.sin(a) * R)); } B.add(new THREE.TorusGeometry(R, 0.03, 6, 64).rotateX(Math.PI / 2), 'iron', M(0, 1.0, 0)); };

// --- drop tower: a tall column; a ring of seats is hauled up slowly, held, then dropped -----------------------
export function buildDrop(o){
  const g = new THREE.Group(), H = o.size || 45, B = new Batch(), C = o.color || '#2a4a9a', C2 = o.color2 || '#c8983a';
  base(B, 4.2); fence(B, 5.6);
  B.add(new THREE.CylinderGeometry(1.0, 1.25, H, 16), 'P', M(0, H / 2, 0));
  for (let y = 4; y < H; y += 4) B.add(new THREE.TorusGeometry(1.08, 0.06, 6, 24).rotateX(Math.PI / 2), 'P2', M(0, y, 0));
  B.add(new THREE.CylinderGeometry(1.6, 1.0, 2.2, 16), 'P2', M(0, H + 1.1, 0)); B.add(new THREE.ConeGeometry(1.3, 3, 16), 'P', M(0, H + 3.7, 0));
  const glows = [];
  for (let y = 6; y < H; y += 6){ B.add(new THREE.SphereGeometry(0.1, 6, 4), 'glow', M(1.06, y, 0)); B.add(new THREE.SphereGeometry(0.1, 6, 4), 'glow', M(-1.06, y, 0)); }
  B.add(new THREE.SphereGeometry(0.25, 8, 6), 'glow', M(0, H + 5.3, 0)); glows.push([0, H + 5.3, 0]);
  g.add(built(B, C, C2));
  const car = new THREE.Group(), CB = new Batch();
  CB.add(new THREE.CylinderGeometry(2.6, 2.6, 0.5, 24, 1, true), 'P2', M(0, 0.9, 0)); CB.add(new THREE.CylinderGeometry(1.25, 2.6, 0.12, 24), 'P2', M(0, 1.15, 0));
  for (let k = 0; k < 16; k++){ const a = k / 16 * Math.PI * 2; seat(CB, Math.cos(a) * 2.25, 0.45, Math.sin(a) * 2.25, Math.PI / 2 - a + Math.PI); }
  car.add(built(CB, C, C2)); g.add(car);
  const s = new THREE.Object3D(); s.position.set(2.25, 0.45, 0); s.rotation.y = Math.PI / 2; car.add(s);
  g.userData = { seat: s, glows, colliders: [{ c: [0, 0], r: 5.6 }],
    animate(st, dt, on){
      // up (slowly, 0 to 18 s), wait at the top (to 21 s), drop (to 23 s), brake and settle
      if (!on){ car.position.y = damp(car.position.y, 0, 2, dt); st.t = 0; return; }
      st.t += dt; const t = st.t % 30, top = H - 4;
      let y; if (t < 18) y = top * (0.5 - 0.5 * Math.cos(Math.PI * t / 18)); else if (t < 21) y = top; else if (t < 22.6) y = top - 0.5 * 18 * (t - 21) ** 2; else y = Math.max(0, top - 0.5 * 18 * 1.6 ** 2) * Math.exp(-(t - 22.6) * 2.5);
      car.position.y = Math.max(0, y); car.rotation.y += dt * 0.05;
    } };
  return g;
}
// --- swing ride: a tower whose top turns (and tilts), swinging seats out on chains ----------------------------
export function buildSwing(o){
  const g = new THREE.Group(), R = (o.size || 16) / 2, B = new Batch(), C = o.color || '#6a2a7a', C2 = o.color2 || '#f0e8d8', Hc = 9;
  base(B, R * 0.45); fence(B, R + 1.5);
  B.add(new THREE.CylinderGeometry(0.7, 0.9, Hc, 14), 'P', M(0, Hc / 2, 0));
  g.add(built(B, C, C2));
  const top = new THREE.Group(); top.position.y = Hc; g.add(top);
  const TB = new Batch(); const can = new THREE.ConeGeometry(R * 0.75, 2.4, 32, 1, true); can.userData.keepUV = true;
  TB.add(can, 'S', M(0, 1.6, 0)); TB.add(new THREE.CylinderGeometry(R * 0.75, R * 0.75, 0.6, 32, 1, true), 'P', M(0, 0.2, 0));
  const glows = [];
  for (let k = 0; k < 24; k++){ const a = k / 24 * Math.PI * 2; TB.add(new THREE.SphereGeometry(0.07, 6, 4), 'glow', M(Math.cos(a) * (R * 0.75 + 0.02), 0.2, Math.sin(a) * (R * 0.75 + 0.02))); }
  for (let k = 0; k < 6; k++){ const a = k / 6 * Math.PI * 2; glows.push([Math.cos(a) * R * 0.75, Hc + 0.2, Math.sin(a) * R * 0.75]); }
  top.add(built(TB, C, C2));
  const swings = [], n = Math.round(R * 2);
  let s0 = null;
  for (let k = 0; k < n; k++){
    const a = k / n * Math.PI * 2, pivot = new THREE.Group(); pivot.position.set(Math.cos(a) * R * 0.7, 0, Math.sin(a) * R * 0.7); pivot.rotation.y = -a;
    const SB = new Batch(); for (const z of [-0.2, 0.2]) SB.add(new THREE.CylinderGeometry(0.012, 0.012, 5, 4), 'chrome', M(0, -2.5, z)); seat(SB, 0, -5.1, 0, Math.PI / 2);
    const arm = new THREE.Group(); arm.add(built(SB, C, C2)); pivot.add(arm); top.add(pivot); swings.push(arm);
    if (!s0){ s0 = new THREE.Object3D(); s0.position.set(0, -5.1, 0); s0.rotation.y = Math.PI / 2; arm.add(s0); }
  }
  g.userData = { seat: s0, glows, colliders: [{ c: [0, 0], r: R + 1.5 }],
    animate(st, dt, on){
      st.power = damp(st.power || 0, on ? 1 : 0, 0.5, dt);
      top.rotation.y -= dt * 1.1 * st.power;
      top.rotation.x = Math.sin((st.t = (st.t || 0) + dt) * 0.25) * 0.12 * st.power;
      for (const s of swings) s.rotation.z = 0.95 * st.power;   // flung outwards
    } };
  return g;
}
// --- swinging ship: a boat on two arms, swinging higher and higher ----------------------------------------
export function buildShip(o){
  const g = new THREE.Group(), L = o.size || 14, B = new Batch(), C = o.color || '#5a3018', C2 = o.color2 || '#c8983a', Hp = L * 0.62;
  for (const s of [-1, 1]) for (const f of [-1, 1]){ const top = new THREE.Vector3(0, Hp, s * 2.2), foot = new THREE.Vector3(f * L * 0.42, 0, s * 3); const mid = top.clone().add(foot).multiplyScalar(0.5);
    B.add(new THREE.CylinderGeometry(0.22, 0.32, top.distanceTo(foot), 10), 'P2', new THREE.Matrix4().compose(mid, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(foot).normalize()), new THREE.Vector3(1, 1, 1))); B.box('ashlar', foot.x, 0.25, foot.z, 1.2, 0.5, 1.2); }
  B.add(new THREE.CylinderGeometry(0.35, 0.35, 5, 12).rotateX(Math.PI / 2), 'iron', M(0, Hp, 0));
  B.box('boards', 0, 0.6, 4.2, L * 0.6, 0.2, 2.2);
  g.add(built(B, C, C2));
  const swing = new THREE.Group(); swing.position.y = Hp; g.add(swing);
  const SB = new Batch();
  for (const z of [-1.6, 1.6]) SB.add(new THREE.CylinderGeometry(0.16, 0.16, Hp - 2.4, 8), 'iron', M(0, -(Hp - 2.4) / 2, z));
  // the hull: a long boat shape, rows of benches inside
  const hull = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2); hull.scale(L / 2, 1.6, 1.7);
  SB.add(hull, 'P', M(0, -Hp + 2.6, 0)); SB.add(new THREE.BoxGeometry(L * 0.9, 0.12, 3.2), 'boards', M(0, -Hp + 2.2, 0));
  for (let x = -L * 0.38; x <= L * 0.38; x += 1.4) SB.box('wood', x, -Hp + 2.5, 0, 0.5, 0.5, 2.8);
  const style = o.style || 'pirate';
  if (style === 'dragon'){ SB.add(new THREE.ConeGeometry(0.5, 3.4, 10), 'P2', M(L / 2 + 0.8, -Hp + 3.6, 0, 0, 0, -1.0)); SB.add(new THREE.SphereGeometry(0.7, 12, 8), 'P2', M(L / 2 + 1.9, -Hp + 4.8, 0)); }
  else if (style === 'viking'){ for (const s of [-1, 1]) for (let x = -L * 0.35; x <= L * 0.35; x += 1.6) SB.add(new THREE.CylinderGeometry(0.55, 0.55, 0.08, 16).rotateX(Math.PI / 2), 'P2', M(x, -Hp + 3.1, s * 1.72)); SB.add(new THREE.TorusGeometry(0.9, 0.2, 8, 16, Math.PI * 1.2), 'P2', M(L / 2 + 0.2, -Hp + 4.2, 0)); }
  else { SB.add(new THREE.CylinderGeometry(0.1, 0.12, 5, 8), 'darkwood', M(0, -Hp + 5, 0)); const sail = new THREE.PlaneGeometry(3, 2.6, 1, 1); SB.add(sail, 'S', M(0, -Hp + 5.6, 0.05)); SB.add(new THREE.BoxGeometry(1.2, 1, 3.2), 'P2', M(-L / 2 + 0.6, -Hp + 3.4, 0)); }
  swing.add(built(SB, C, C2));
  const s = new THREE.Object3D(); s.position.set(0, -Hp + 2.75, 1.0); s.rotation.y = 0; swing.add(s);
  g.userData = { seat: s, glows: [], colliders: [{ box: [-L * 0.45, -3.4, L * 0.45, 3.4] }],
    animate(st, dt, on){
      st.power = damp(st.power || 0, on ? 1 : 0, 0.15, dt); st.t = (st.t || 0) + dt;
      swing.rotation.z = Math.sin(st.t * Math.sqrt(9.8 / Hp)) * (o.speed ? 0.6 + 0.25 * o.speed : 0.8) * st.power;
    } };
  return g;
}
// --- teacups: a turning floor, three turning platforms, cups spinning on each -----------------------------
export function buildCups(o){
  const g = new THREE.Group(), R = (o.size || 13) / 2, B = new Batch(), C = o.color || '#c86a9a', C2 = o.color2 || '#f0e8d8';
  base(B, R + 0.4); fence(B, R + 1.4); g.add(built(B, C, C2));
  const floor = new THREE.Group(); floor.position.y = 0.42; g.add(floor);
  const FB = new Batch(); FB.add(new THREE.CylinderGeometry(R, R, 0.1, 48), 'S', null); floor.add(built(FB, C, C2));
  const plats = [], cups = [];
  let s0 = null;
  for (let p = 0; p < 3; p++){
    const a = p / 3 * Math.PI * 2, plat = new THREE.Group(); plat.position.set(Math.cos(a) * R * 0.52, 0.1, Math.sin(a) * R * 0.52); floor.add(plat); plats.push(plat);
    const PB = new Batch(); PB.add(new THREE.CylinderGeometry(R * 0.42, R * 0.42, 0.1, 32), 'boards', null); plat.add(built(PB, C, C2));
    for (let c = 0; c < 3; c++){
      const b = c / 3 * Math.PI * 2, cup = new THREE.Group(); cup.position.set(Math.cos(b) * R * 0.25, 0.05, Math.sin(b) * R * 0.25); plat.add(cup); cups.push(cup);
      const CB = new Batch();
      CB.add(lathe([[0, 0.1], [0.5, 0.1], [0.8, 0.5], [0.95, 1.0], [0.9, 1.05], [0.8, 0.6], [0.45, 0.25], [0, 0.25]], 24), (c + p) % 2 ? 'P' : 'P2', null);
      CB.add(new THREE.TorusGeometry(0.3, 0.06, 8, 16, Math.PI), (c + p) % 2 ? 'P2' : 'P', M(0.95, 0.7, 0, 0, 0, -Math.PI / 2));
      CB.add(new THREE.CylinderGeometry(0.12, 0.12, 0.6, 10), 'chrome', M(0, 0.55, 0)); CB.add(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 16), 'chrome', M(0, 0.85, 0));
      cup.add(built(CB, C, C2));
      if (!s0){ s0 = new THREE.Object3D(); s0.position.set(0, 0.3, -0.45); cup.add(s0); }
    }
  }
  g.userData = { seat: s0, glows: [], colliders: [{ c: [0, 0], r: R + 1.4 }],
    animate(st, dt, on){
      st.power = damp(st.power || 0, on ? 1 : 0, 0.6, dt); const p = st.power * (0.6 + 0.3 * (o.speed ?? 1));
      floor.rotation.y += dt * 0.35 * p; for (const pl of plats) pl.rotation.y -= dt * 0.9 * p; cups.forEach((c, i) => { c.rotation.y += dt * (1.2 + (i % 3) * 0.6) * p; });
    } };
  return g;
}
// --- scrambler: arms turning one way, each with a cluster of cars turning the other ------------------------
export function buildScrambler(o){
  const g = new THREE.Group(), R = (o.size || 15) / 2, B = new Batch(), C = o.color || '#2a6a4a', C2 = o.color2 || '#c8983a';
  base(B, R + 0.4); fence(B, R + 1.4);
  B.add(new THREE.CylinderGeometry(0.6, 0.9, 3.2, 12), 'P', M(0, 1.6, 0)); g.add(built(B, C, C2));
  const hub = new THREE.Group(); hub.position.y = 3.0; g.add(hub);
  const arms = [];
  let s0 = null;
  for (let k = 0; k < 3; k++){
    const a = k / 3 * Math.PI * 2, arm = new THREE.Group(); arm.rotation.y = -a; hub.add(arm);
    const AB = new Batch(); AB.add(new THREE.BoxGeometry(R * 0.62, 0.3, 0.3), 'P', M(R * 0.31, 0, 0)); arm.add(built(AB, C, C2));
    const head = new THREE.Group(); head.position.set(R * 0.62, 0, 0); arm.add(head); arms.push(head);
    for (let c = 0; c < 4; c++){
      const b = c / 4 * Math.PI * 2, CB = new Batch();
      CB.add(new THREE.BoxGeometry(1.8, 0.1, 0.12), 'P', M(0.9 * Math.cos(b), 0, 0.9 * Math.sin(b), 0, -b)); CB.add(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6), 'iron', M(1.8 * Math.cos(b), -1.2, 1.8 * Math.sin(b)));
      CB.add(new THREE.BoxGeometry(1.3, 0.6, 0.9), 'P2', M(1.8 * Math.cos(b), -2.55, 1.8 * Math.sin(b), 0, -b)); seat(CB, 1.8 * Math.cos(b), -2.6, 1.8 * Math.sin(b), Math.PI / 2 - b, 'P');
      head.add(built(CB, C, C2));
      if (!s0){ s0 = new THREE.Object3D(); s0.position.set(1.8, -2.6, 0); s0.rotation.y = Math.PI / 2; head.add(s0); }
    }
  }
  g.userData = { seat: s0, glows: [], colliders: [{ c: [0, 0], r: R + 1.4 }],
    animate(st, dt, on){
      st.power = damp(st.power || 0, on ? 1 : 0, 0.5, dt); const p = st.power * (0.7 + 0.3 * (o.speed ?? 1));
      hub.rotation.y += dt * 0.9 * p; for (const h of arms) h.rotation.y -= dt * 1.9 * p;
    } };
  return g;
}
export const FLAT_BUILD = { drop: buildDrop, swing: buildSwing, ship: buildShip, cups: buildCups, scrambler: buildScrambler };
void clamp;
