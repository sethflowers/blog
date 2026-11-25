// The evidence: pictures of fingerprints and shoe prints (drawn from code, so every person's are their
// own and the same every time), and the things at the crime scene: the weapon, the spill and the
// footprints through it, a thread, sparkles that show where to look (Easy and Medium) and numbered
// yellow markers on what you've already looked at.
import * as THREE from 'three';
import { V, mat, textCanvas } from './util.js';
import { rng } from './mystery.js';

// ---------- fingerprints ----------
const printCache = new Map();
// pattern: loop / whorl / arch; seed: whose; part: 'full' | 'partial' | 'smudged'
export function fingerprint(pattern, seed, part = 'full', size = 200){
  const key = `${pattern}-${seed}-${part}-${size}`;
  if (printCache.has(key)) return printCache.get(key);
  const W = size, H = Math.round(size * 1.3);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), img = g.createImageData(W, H), d = img.data;
  const R = rng(seed * 7919 + 13);
  const a1 = R() * 6.28, a2 = R() * 6.28, a3 = R() * 6.28, f1 = 2 + R() * 3, f2 = 2 + R() * 3, cx = (R() - 0.5) * 0.16, cy = -0.12 + (R() - 0.5) * 0.12, tilt = (R() - 0.5) * 0.5, freq = 30 + R() * 6;
  const breaks = []; for (let k = 0; k < 14; k++) breaks.push([R() * 1.6 - 0.8, R() * 2 - 1, 0.02 + R() * 0.03]);
  const lean = R() < 0.5 ? -1 : 1;
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++){
    let x = (px / W - 0.5) * 2, y = (py / H - 0.5) * 2;
    const e = x * x / 0.8 + y * y / 0.95;
    let ink = 0;
    if (e < 1){
      // a little warp, different for everyone
      const wx = x + 0.05 * Math.sin(f1 * y + a1) + 0.03 * Math.sin(f2 * (x + y) + a3), wy = y + 0.05 * Math.sin(f2 * x + a2);
      const rx = wx * Math.cos(tilt) - wy * Math.sin(tilt), ry = wx * Math.sin(tilt) + wy * Math.cos(tilt);
      let phi;
      if (pattern === 'arch') phi = (ry + 0.45 * Math.exp(-rx * rx * 3.5) * (1 - Math.abs(ry - cy) * 0.5));
      else if (pattern === 'whorl'){ const dx = rx - cx, dy = (ry - cy) * 1.15; const r = Math.hypot(dx, dy); phi = r + 0.012 * Math.atan2(dy, dx) * lean; if (ry > 0.55) phi = Math.min(phi, 0.5 + (0.9 - ry) * 0.2); }
      else {
        // loop: nested U shapes round a short slanted line, opening down to one side
        const ax = cx, ay = cy, bx = cx - 0.5 * lean, by = cy + 0.7;
        const vx = bx - ax, vy = by - ay, t = Math.max(0, Math.min(1, ((rx - ax) * vx + (ry - ay) * vy) / (vx * vx + vy * vy)));
        phi = Math.hypot(rx - ax - vx * t, ry - ay - vy * t);
        if (ry > by) phi = Math.min(phi, 0.15 + (ry - by) * 0.4 + Math.abs(rx - bx) * 0.2);
      }
      let v = 0.5 + 0.5 * Math.sin(phi * freq * 2.2);
      for (const b of breaks){ const dd = (x - b[0]) ** 2 + (y - b[1]) ** 2; if (dd < b[2] * b[2]) v *= 0.2; }
      ink = v > 0.52 ? 1 : 0;
      ink *= Math.min(1, (1 - e) * 6);
      if (part === 'partial'){ const m = x * 0.6 + y * 0.8; if (m > 0.25 + 0.15 * Math.sin(y * 6)) ink = 0; }
      if (part === 'smudged') ink *= 0.35 + 0.4 * Math.sin(x * 9 + y * 3);
    }
    const i = (py * W + px) * 4, k = Math.round(250 - ink * 200);
    d[i] = k; d[i + 1] = k; d[i + 2] = Math.round(k * 1.02); d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  printCache.set(key, c);
  return c;
}

// ---------- shoe prints ----------
const soleCache = new Map();
// the outline of a sole of a given type, in a box w × h (pointing up), filled by the tread
function solePath(g, w, h, type){
  g.beginPath();
  const heel = type === 'heel' || type === 'smooth';
  g.ellipse(w * 0.5, h * 0.27, w * 0.42, h * 0.25, 0, Math.PI, 0);
  g.bezierCurveTo(w * 0.94, h * 0.45, w * 0.78, h * 0.6, w * 0.72, h * 0.66);
  if (heel){ g.lineTo(w * 0.3, h * 0.66); g.closePath(); g.moveTo(w * 0.28, h * 0.74); g.lineTo(w * 0.72, h * 0.74); g.lineTo(w * 0.7, h * 0.98); g.lineTo(w * 0.3, h * 0.98); g.closePath(); }
  else { g.lineTo(w * 0.74, h * 0.92); g.quadraticCurveTo(w * 0.5, h * 1.02, w * 0.26, h * 0.92); g.lineTo(w * 0.3, h * 0.6); g.bezierCurveTo(w * 0.1, h * 0.5, w * 0.06, h * 0.4, w * 0.08, h * 0.27); g.closePath(); }
}
function tread(g, w, h, type, col){
  g.fillStyle = col; g.strokeStyle = col;
  if (type === 'workboot'){ for (let y = 0.06; y < 1; y += 0.085) for (let x = 0.12; x < 0.9; x += 0.2) g.fillRect(w * (x + (Math.round(y * 12) % 2) * 0.08), h * y, w * 0.12, h * 0.05); }
  else if (type === 'welly'){ g.lineWidth = w * 0.06; for (let y = 0.05; y < 1; y += 0.08){ g.beginPath(); g.moveTo(w * 0.05, h * y); g.lineTo(w * 0.5, h * (y + 0.04)); g.lineTo(w * 0.95, h * y); g.stroke(); } }
  else if (type === 'trainer'){ g.lineWidth = w * 0.04; for (let y = 0.04; y < 1; y += 0.06){ g.beginPath(); for (let x = 0; x <= 1.01; x += 0.1) g.lineTo(w * x, h * (y + ((x * 10) % 2 ? 0.025 : 0))); g.stroke(); } for (let k = 0; k < 6; k++){ g.beginPath(); g.arc(w * 0.5, h * 0.22, w * (0.05 + k * 0.05), 0, Math.PI * 2); g.stroke(); } }
  else if (type === 'clog'){ g.lineWidth = w * 0.03; for (let y = 0.05; y < 1; y += 0.1){ g.beginPath(); g.moveTo(0, h * y); g.lineTo(w, h * y); g.stroke(); } for (let x = 0.1; x < 1; x += 0.2){ g.beginPath(); g.moveTo(w * x, 0); g.lineTo(w * x, h); g.stroke(); } }
  else { g.fillRect(0, 0, w, h); }
}
// a picture of a shoe print, the size written under it (pass size = 0 for none)
export function shoePrint(type, size, opts = {}){
  const key = `${type}-${size}-${opts.ink || ''}-${opts.mirror ? 1 : 0}`;
  if (soleCache.has(key)) return soleCache.get(key);
  const W = 120, H = 260, c = document.createElement('canvas'); c.width = W; c.height = H + (size ? 46 : 0);
  const g = c.getContext('2d');
  if (!opts.transparent){ g.fillStyle = '#f4efe2'; g.fillRect(0, 0, c.width, c.height); }
  if (opts.mirror){ g.translate(W, 0); g.scale(-1, 1); }
  const ink = opts.ink || '#3a2a1a';
  // the sole: its tread, clipped to the outline, with a darker rim
  g.save(); solePath(g, W, H, type); g.clip();
  if (type === 'smooth' || type === 'heel'){ g.fillStyle = ink; g.globalAlpha = 0.75; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
  else { g.globalAlpha = 0.25; g.fillStyle = ink; g.fillRect(0, 0, W, H); g.globalAlpha = 1; tread(g, W, H, type, ink); }
  g.restore();
  g.strokeStyle = ink; g.lineWidth = 5; solePath(g, W, H, type); g.stroke();
  if (opts.mirror) g.setTransform(1, 0, 0, 1, 0, 0);
  if (size){ g.fillStyle = '#2a2016'; g.font = 'bold 30px Arial'; g.textAlign = 'center'; g.fillText('size ' + size, W / 2, H + 36); }
  soleCache.set(key, c);
  return c;
}

// ---------- the crime scene in 3D ----------
const MEDIUM_COL = { lounge: 0xc8b84a, observation: 0x1e2a36, baggage: 0x0a0a0a, kitchen: 0xf4f2ea, sleeper: 0x4a2412 };
const sharedGeo = new Map();
function geo(name, make){ if (!sharedGeo.has(name)){ const g = make(); g.userData.keep = true; sharedGeo.set(name, g); } return sharedGeo.get(name); }

// the weapons, lying on their side (y up, length along x)
export function weaponMesh(id){
  const G = new THREE.Group();
  const add = (g, m) => { const x = new THREE.Mesh(g, m); G.add(x); return x; };
  const brass = mat('brass'), wood = mat('weaponWood', { color: 0x8a5a2a, rough: 0.6 }), iron = mat('iron'), steel = mat('steel');
  if (id === 'candlestick'){ const g = new THREE.LatheGeometry([[0, 0], [0.07, 0], [0.07, 0.015], [0.025, 0.04], [0.018, 0.22], [0.035, 0.24], [0.03, 0.27], [0.015, 0.27], [0, 0.26]].map(([a, b]) => new THREE.Vector2(a, b)), 16); g.rotateZ(Math.PI / 2); g.translate(0.13, 0.04, 0); add(g, brass); }
  else if (id === 'book'){ add(new THREE.BoxGeometry(0.3, 0.08, 0.22), mat('bookRed', { color: 0x7a1a1a, rough: 0.7 })).position.y = 0.04; }
  else if (id === 'stick'){ const g = new THREE.CylinderGeometry(0.012, 0.012, 0.9, 8); g.rotateZ(Math.PI / 2); g.translate(0, 0.012, 0); add(g, mat('blackWood', { color: 0x1a1210, rough: 0.4 })); const k = new THREE.SphereGeometry(0.03, 10, 8); k.translate(0.46, 0.03, 0); add(k, mat('silver', { color: 0xd8d8e0, rough: 0.2, metal: 1 })); }
  else if (id === 'wrench'){ add(new THREE.BoxGeometry(0.4, 0.02, 0.05), iron).position.y = 0.01; const h = new THREE.TorusGeometry(0.045, 0.018, 6, 12, Math.PI * 1.5); h.rotateX(Math.PI / 2); h.translate(0.22, 0.012, 0); add(h, iron); }
  else if (id === 'rollingpin'){ const g = new THREE.CylinderGeometry(0.035, 0.035, 0.3, 14); g.rotateZ(Math.PI / 2); g.translate(0, 0.035, 0); add(g, wood); for (const s of [-1, 1]){ const h = new THREE.CylinderGeometry(0.015, 0.015, 0.09, 8); h.rotateZ(Math.PI / 2); h.translate(s * 0.195, 0.035, 0); add(h, wood); } }
  else if (id === 'pan'){ const p = new THREE.CylinderGeometry(0.13, 0.11, 0.045, 18); p.translate(0, 0.023, 0); add(p, iron); const h = new THREE.BoxGeometry(0.22, 0.02, 0.035); h.translate(0.24, 0.035, 0); add(h, iron); }
  else if (id === 'bookend'){ add(new THREE.BoxGeometry(0.16, 0.18, 0.1), mat('stone', { color: 0x9a9488, rough: 0.9 })).position.y = 0.09; const hd = new THREE.SphereGeometry(0.06, 10, 8); hd.translate(0.03, 0.2, 0); add(hd, mat('stone')); }
  else if (id === 'extinguisher'){ const b = new THREE.CylinderGeometry(0.075, 0.075, 0.45, 14); b.rotateZ(Math.PI / 2); b.translate(0, 0.075, 0); add(b, mat('extRed', { color: 0xc01a1a, rough: 0.4, metal: 0.3 })); const t = new THREE.CylinderGeometry(0.02, 0.02, 0.08, 8); t.rotateZ(Math.PI / 2); t.translate(0.26, 0.075, 0); add(t, steel); }
  return G;
}

export class Scene3D {
  constructor(train){
    this.train = train;
    this.group = new THREE.Group(); train.group.add(this.group);
    this.sparkles = []; this.markers = [];
    // shared shapes
    this.footGeo = geo('foot', () => new THREE.PlaneGeometry(0.11, 0.28).rotateX(-Math.PI / 2));
    this.puddleGeo = geo('puddle', () => { const g = new THREE.CircleGeometry(0.26, 24); g.rotateX(-Math.PI / 2); const p = g.attributes.position; for (let i = 0; i < p.count; i++){ const a = Math.atan2(p.getZ(i), p.getX(i)); const k = 1 + 0.25 * Math.sin(a * 3) + 0.12 * Math.sin(a * 7); p.setX(i, p.getX(i) * k * 1.3); p.setZ(i, p.getZ(i) * k); } return g; });
    this.sparkGeo = geo('spark', () => new THREE.OctahedronGeometry(0.028, 0));
    this.tentGeo = geo('tent', () => { const g = new THREE.CylinderGeometry(0.001, 0.07, 0.13, 3, 1); g.rotateY(Math.PI / 6); g.translate(0, 0.065, 0); return g; });
    this.sparkMat = mat('sparkle', { basic: true, color: 0xffd040, transparent: true, opacity: 0.95 });
  }
  clear(){
    for (const o of [...this.group.children]){ this.group.remove(o); o.traverse((m) => { if (m.geometry && !m.geometry.userData.keep) m.geometry.dispose(); if (m.material && m.material.userData.own){ if (m.material.map) m.material.map.dispose(); m.material.dispose(); } }); }
    this.sparkles = []; this.markers = []; this.markerN = 0;
  }
  // lay out the scene for mystery m. Returns where things are: { body, weapon, prints[], puddle, fibre, door, glass }
  build(m){
    this.clear();
    const T = this.train, S = T.scenes[m.scene], out = {};
    out.body = S.body;
    // the weapon, dropped near the body
    const w = weaponMesh(m.weapon); w.position.set(S.weapon.x, 0.0, S.weapon.z); w.rotation.y = 0.7; this.group.add(w);
    out.weapon = V(S.weapon.x, 0.12, S.weapon.z);
    // the spill next to the body, and footprints from it towards the way the murderer went
    const dir = m.clues.direction ? m.clues.direction.dir : (m.murderer % 2 ? 'front' : 'back');
    const ex = T.exit(m.scene, dir);
    const toward = Math.sign(ex.z - S.body.z) || 1;
    const pz = S.body.z + toward * 0.55, px = S.body.x + (S.body.x > 0 ? -0.32 : 0.32);
    const pm = new THREE.MeshStandardMaterial({ color: MEDIUM_COL[m.scene], roughness: m.scene === 'kitchen' ? 0.9 : 0.35, metalness: 0, transparent: true, opacity: m.scene === 'kitchen' ? 0.95 : 0.72, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    pm.userData.own = true;
    const pud = new THREE.Mesh(this.puddleGeo, pm); pud.position.set(px, 0.024, pz); this.group.add(pud);
    out.puddle = V(px, 0.05, pz);
    // footprints: left, right, left... fading as the spill wears off their shoes
    const sole = m.clues.foot.sole;
    const ink = '#' + new THREE.Color(MEDIUM_COL[m.scene]).getHexString();
    out.prints = [];
    const stepX = (ex.x - px), n = 7;
    for (let k = 0; k < n; k++){
      const t = (k + 1) / (n + 1), side = k % 2 ? 1 : -1;
      const z = pz + toward * (0.5 + k * 0.62), x = px + stepX * Math.min(1, (k * 0.62) / Math.max(1, Math.abs(ex.z - pz))) + side * 0.1;
      if (Math.abs(z - pz) > Math.abs(ex.z - pz) + 0.3) break;
      const tx = new THREE.CanvasTexture(shoePrint(sole, 0, { transparent: true, ink: '#ffffff', mirror: side > 0 })); tx.colorSpace = THREE.SRGBColorSpace;
      const fm = new THREE.MeshBasicMaterial({ map: tx, color: ink, transparent: true, opacity: 0.9 * (1 - t * 0.75), depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
      fm.userData.own = true;
      const f = new THREE.Mesh(this.footGeo, fm); f.position.set(x, 0.034, z); f.rotation.y = toward > 0 ? Math.PI : 0; this.group.add(f);
      out.prints.push(V(x, 0.05, z));
    }
    // a thread caught on the door frame they went through
    const C = T.cars[m.scene], dz = dir === 'front' ? C.z0 + 0.04 : C.z1 - 0.04, dx = C.door[0] - 0.02;
    const thread = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(0, 0, 0), V(0.02, -0.04, 0.01), V(-0.01, -0.09, 0.02), V(0.015, -0.13, 0.0)]), 12, 0.004, 5), new THREE.MeshStandardMaterial({ color: m.people[m.murderer].coat ? coatColour(m.people[m.murderer].coat) : 0x888888, roughness: 1 }));
    thread.material.userData.own = true;
    thread.position.set(dx, 1.12, dz); this.group.add(thread);
    out.fibre = V(dx, 1.08, dz);
    out.door = T.doorAt(m.scene, dz).pos;
    out.doorFront = dir === 'front';
    out.exit = ex; out.dir = dir;
    // a glass someone left there
    const gp = T.glassPos && T.glassPos[m.scene] ? T.glassPos[m.scene].clone() : V(S.weapon.x + 0.3, 0.0, S.weapon.z + 0.8);
    const gl = new THREE.Mesh(geo('tumbler', () => new THREE.CylinderGeometry(0.035, 0.03, 0.09, 12).translate(0, 0.045, 0)), mat('tumbler', { color: 0xdde8f0, transparent: true, opacity: 0.45, rough: 0.05 }));
    gl.position.copy(gp); this.group.add(gl);
    out.glass = gp.clone().add(V(0, 0.06, 0));
    this.where = out;
    return out;
  }
  // a sparkle over something not yet looked at
  sparkle(id, pos){ const s = new THREE.Mesh(this.sparkGeo, this.sparkMat); s.position.copy(pos); s.userData = { id, base: pos.clone(), t: Math.random() * 6 }; this.group.add(s); this.sparkles.push(s); return s; }
  unsparkle(id){ for (const s of this.sparkles.filter((x) => x.userData.id === id)){ this.group.remove(s); } this.sparkles = this.sparkles.filter((x) => x.userData.id !== id); }
  // a numbered yellow marker next to something you've examined
  marker(id, pos){
    if (this.markers.some((m) => m.userData.id === id)) return;
    this.markerN = (this.markerN || 0) + 1;
    const t = textCanvas(128, 128), g = t.ctx; g.fillStyle = '#f4c430'; g.fillRect(0, 0, 128, 128); g.fillStyle = '#111'; g.font = 'bold 80px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(this.markerN), 64, 70); t.tex.needsUpdate = true;
    const m = new THREE.MeshStandardMaterial({ map: t.tex, roughness: 0.6 }); m.userData.own = true;
    const tent = new THREE.Mesh(this.tentGeo, m); tent.position.set(pos.x + 0.18, 0.04, pos.z + 0.12); tent.userData.id = id;
    this.group.add(tent); this.markers.push(tent);
  }
  update(dt, showUnder){
    for (const s of this.sparkles){
      const u = s.userData; u.t += dt;
      s.visible = showUnder ? showUnder(u.base) : true;
      s.position.y = u.base.y + 0.45 + Math.sin(u.t * 2) * 0.05;
      s.rotation.y += dt * 2; s.scale.setScalar(0.7 + 0.4 * Math.abs(Math.sin(u.t * 3)));
    }
  }
}
export function coatColour(name){ return new THREE.Color({ pink: '#e48aa8', purple: '#8a4ab0', brown: '#6a4428', green: '#5a6a30', grey: '#8a8a8a', black: '#222226', white: '#eeeeea', beige: '#cdb894', red: '#b02a2a', blue: '#3a5a9a', yellow: '#e0c030', orange: '#e07a20' }[name] || '#888888'); }
