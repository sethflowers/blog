// One-off structures, each built for its own object (they carry names or sizes): the park's entrance
// gate (with the park's name across it), land arches (with the land's name), car parks, fences and
// walls (drawn from one point to another), and name signs.
import * as THREE from 'three';
import { Batch, rng } from './util.js';
import { mat } from './materials.js';
import { resolveMat } from './models.js';
import { THEMES } from './names.js';

// --- name boards: big serif capitals on a painted board, redrawn when the name changes ----------------
export function boardTexture(text, { bg = '#173826', fg = '#f2d27a', border = '#c8a050', w = 1024, h = 192, font = 'Georgia, "Times New Roman", serif' } = {}){
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  const grad = g.createLinearGradient(0, 0, 0, h); grad.addColorStop(0, 'rgba(255,255,255,.10)'); grad.addColorStop(1, 'rgba(0,0,0,.25)'); g.fillStyle = grad; g.fillRect(0, 0, w, h);
  g.strokeStyle = border; g.lineWidth = h * 0.045; g.strokeRect(h * 0.08, h * 0.08, w - h * 0.16, h - h * 0.16);
  g.lineWidth = h * 0.015; g.strokeRect(h * 0.15, h * 0.15, w - h * 0.3, h - h * 0.3);
  const label = String(text || '').toUpperCase();
  let size = h * 0.5; g.font = `bold ${size}px ${font}`;
  const room = w - h * 0.6;
  const spacing = (s) => s * 0.08;
  const width = (s) => { g.font = `bold ${s}px ${font}`; return g.measureText(label).width + spacing(s) * Math.max(0, label.length - 1); };
  while (width(size) > room && size > 10) size -= 2;
  g.font = `bold ${size}px ${font}`; g.textBaseline = 'middle';
  let x = (w - width(size)) / 2;
  g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowOffsetY = size * 0.05; g.shadowBlur = size * 0.08;
  g.fillStyle = fg;
  for (const ch of label){ g.fillText(ch, x, h / 2 + size * 0.04); x += g.measureText(ch).width + spacing(size); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function boardMesh(text, w, h, opts){
  const tex = boardTexture(text, { ...opts, w: 1024, h: Math.max(96, Math.round(1024 * h / w)) });
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.05 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  mesh.userData.ownMaterial = true;
  return mesh;
}
// free a structure's own textures and materials (boards), as well as its shapes
export function disposeStructure(g){
  g.traverse((o) => {
    if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    if (o.userData.ownMaterial){ if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
  });
  if (g.parent) g.parent.remove(g);
}

// --- the park's entrance -----------------------------------------------------------------------------
export function buildGate(name){
  const B = new Batch(), g = new THREE.Group();
  const add = (key, geo, x, y, z, rx = 0, ry = 0, sx = 1, sy = 1, sz = 1) => B.add(geo, key, new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0)), new THREE.Vector3(sx, sy, sz)));
  // the gatehouse wall with its arch, 3 m deep
  // the outline goes round the opening (an arch-shaped hole touching the ground would leave a strip of
  // wall lying across the opening at exactly the path's height, which flickered against it)
  const sh = new THREE.Shape(); sh.moveTo(-4.6, 0); sh.lineTo(-3.2, 0); sh.lineTo(-3.2, 5.2); sh.absarc(0, 5.2, 3.2, Math.PI, 0, true);
  sh.lineTo(3.2, 0); sh.lineTo(4.6, 0); sh.lineTo(4.6, 11.2); sh.lineTo(-4.6, 11.2); sh.lineTo(-4.6, 0);
  const wall = new THREE.ExtrudeGeometry(sh, { depth: 3, bevelEnabled: false, curveSegments: 18 });
  add('ashlar', wall, 0, 0, -1.5);
  // the arch's voussoirs: a band of lighter stone round the opening, standing 3 cm proud
  for (const z of [1.53, -1.53]){
    const band = new THREE.Shape(); band.absarc(0, 5.2, 3.75, 0, Math.PI, false); band.lineTo(-3.2, 5.2); band.absarc(0, 5.2, 3.2, Math.PI, 0, true); band.lineTo(3.75, 5.2);
    add('marble', new THREE.ExtrudeGeometry(band, { depth: 0.06, bevelEnabled: false, curveSegments: 18 }), 0, 0, z - 0.03);
  }
  // battlements
  for (let x = -4.2; x <= 4.21; x += 1.05) B.box('ashlar', x, 11.6, 0, 0.6, 0.8, 3.2);
  B.box('stone', 0, 11.15, 0, 9.4, 0.15, 3.3);
  // round towers with slate cones, gold finials and pennants
  for (const s of [-1, 1]){
    const tx = s * 7;
    add('ashlar', new THREE.CylinderGeometry(3, 3.2, 14, 28), tx, 7, 0);
    add('stone', new THREE.CylinderGeometry(3.35, 3.35, 0.5, 28), tx, 14.2, 0);
    add('slate', new THREE.ConeGeometry(3.5, 7.5, 28), tx, 18.2, 0);
    add('gold', new THREE.SphereGeometry(0.25, 12, 8), tx, 22.1, 0);
    add('gold', new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6), tx, 23.2, 0);
    const pen = new THREE.BufferGeometry(); pen.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1.9, -0.35, 0.15, 0, -0.7, 0], 3)); pen.computeVertexNormals();
    B.add(pen, 'pennant', new THREE.Matrix4().makeTranslation(tx, 24.2, 0));
    // arrow-slit windows and a lit window high up (glass set 3 cm into the wall)
    for (const [a, y] of [[Math.PI / 2, 4.5], [Math.PI / 2, 9], [Math.PI / 2 + s * 0.7, 6.5]]){
      const wx = tx + Math.cos(a) * 2.97, wz = Math.sin(a) * 2.97;
      add('glass', new THREE.BoxGeometry(0.5, 1.6, 0.1), wx, y, wz, 0, -a + Math.PI / 2);
      add('stone', new THREE.BoxGeometry(0.9, 0.18, 0.3), tx + Math.cos(a) * 3.08, y - 0.86, Math.sin(a) * 3.08, 0, -a + Math.PI / 2);
    }
    // ticket booths: stone below, timber-framed plaster above, slate hip roof
    const bx = s * 13.8;
    B.box('ashlar', bx, 1.25, 0, 7.4, 2.5, 5);
    B.box('plaster', bx, 3.6, 0, 7.4, 2.2, 5);
    for (const fx of [-3.4, -1.2, 1.2, 3.4]) B.box('darkwood', bx + fx, 3.6, 2.53, 0.2, 2.2, 0.06);
    B.box('darkwood', bx, 2.55, 2.53, 7.4, 0.2, 0.06); B.box('darkwood', bx, 4.65, 2.53, 7.4, 0.2, 0.06);
    add('slate', new THREE.ConeGeometry(5.4, 3, 4), bx, 6.2, 0, 0, Math.PI / 4, 1.05, 1, 0.72);
    // ticket windows with striped awnings
    for (const fx of [-1.8, 1.8]){
      B.box('glass', bx + fx, 1.6, 2.52, 1.3, 1.1, 0.06);
      B.box('wood', bx + fx, 0.95, 2.7, 1.5, 0.08, 0.45);
      const aw = new THREE.PlaneGeometry(1.7, 0.9, 1, 1); aw.rotateX(-1.05);
      B.add(aw, 'awning', new THREE.Matrix4().makeTranslation(bx + fx, 2.45, 2.85));
    }
    // lanterns either side of the arch
    g.userData.glows = (g.userData.glows || []).concat([[s * 4.0, 4.2, 2.08], [s * 4.0, 4.2, -2.08]]);
    for (const z of [1.9, -1.9]){
      B.box('iron', s * 4.0, 4.65, z, 0.06, 0.06, 0.4);
      B.box('lampglass', s * 4.0, 4.2, z + Math.sign(z) * 0.18, 0.3, 0.45, 0.3);
      add('glow', new THREE.SphereGeometry(0.1, 8, 6), s * 4.0, 4.2, z + Math.sign(z) * 0.18);
      add('iron', new THREE.ConeGeometry(0.28, 0.25, 4), s * 4.0, 4.55, z + Math.sign(z) * 0.18, 0, Math.PI / 4);
    }
  }
  // turnstiles under the arch
  for (const x of [-2.1, -0.7, 0.7, 2.1]){ B.box('chrome', x, 0.5, 0, 0.12, 1.0, 0.7); add('chrome', new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6), x + 0.35, 0.9, 0, 0, 0, 1, 1, 1); }
  const body = B.build((k) => k === 'pennant' ? mat('pennant', { c: 0xa82a2a, r: 0.7, side: THREE.DoubleSide }) : k === 'awning' ? awningMat() : resolveMat(k));
  body.traverse((o) => { if (o.isMesh){ o.castShadow = true; o.receiveShadow = true; } });
  g.add(body);
  // the park's name across both faces
  for (const s of [1, -1]){
    const b = boardMesh(name, 7.8, 1.5);
    b.position.set(0, 9.75, s * 1.56); if (s < 0) b.rotation.y = Math.PI;
    g.add(b);
  }
  g.userData.colliders = [{ c: [-7, 0], r: 3.2 }, { c: [7, 0], r: 3.2 }, { box: [-17.5, -2.5, -10.1, 2.5] }, { box: [10.1, -2.5, 17.5, 2.5] }, { box: [-4.6, -1.5, -3.2, 1.5] }, { box: [3.2, -1.5, 4.6, 1.5] }];
  return g;
}
let awning = null;
function awningMat(){
  if (awning) return awning;
  const c = document.createElement('canvas'); c.width = 256; c.height = 32; const g = c.getContext('2d');
  for (let i = 0; i < 8; i++){ g.fillStyle = i % 2 ? '#f0e8d8' : '#1e5a3a'; g.fillRect(i * 32, 0, 32, 32); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.repeat.set(0.6, 1);
  awning = new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, side: THREE.DoubleSide });
  return awning;
}

// --- land arches: two pillars and a sign across a path, in the land's theme ------------------------------
const ARCH_STYLE = {
  main: { pillar: 'brick', cap: 'stone', beam: 'iron', bg: '#1a3a2a', fg: '#f2d27a', trim: 'gold' },
  castle: { pillar: 'ashlar', cap: 'slate', beam: 'ashlar', bg: '#22305a', fg: '#f0e0b0', trim: 'gold' },
  wood: { pillar: 'bark', cap: 'hedge', beam: 'darkwood', bg: '#2a3a1e', fg: '#e8f0c0', trim: 'brass' },
  dragon: { pillar: 'rockface', cap: 'iron', beam: 'iron', bg: '#2a1410', fg: '#f09040', trim: 'iron' },
  pirate: { pillar: 'darkwood', cap: 'darkwood', beam: 'wood', bg: '#1a2a3a', fg: '#f0e0c0', trim: 'brass' },
  frontier: { pillar: 'wood', cap: 'wood', beam: 'wood', bg: '#5a3018', fg: '#f8e0b0', trim: 'iron' },
  sky: { pillar: 'marble', cap: 'gold', beam: 'marble', bg: '#2a2a5a', fg: '#f0f0ff', trim: 'gold' },
};
export function buildArch(theme, name, width = 8){
  const st = ARCH_STYLE[theme] || ARCH_STYLE.main, B = new Batch(), g = new THREE.Group(), hw = width / 2 + 0.45;
  for (const s of [-1, 1]){
    const x = s * hw;
    if (theme === 'dragon' || theme === 'wood' || theme === 'frontier' || theme === 'pirate'){
      B.add(new THREE.CylinderGeometry(0.32, 0.42, 5.6, 10), st.pillar, new THREE.Matrix4().makeTranslation(x, 2.8, 0));
    } else {
      B.box(st.pillar, x, 2.6, 0, 0.8, 5.2, 0.8);
      B.box('stone', x, 0.2, 0, 1.0, 0.4, 1.0);
      B.box(st.cap, x, 5.35, 0, 1.0, 0.3, 1.0);
    }
    if (theme === 'castle'){ B.add(new THREE.ConeGeometry(0.7, 1.6, 4), 'slate', new THREE.Matrix4().compose(new THREE.Vector3(x, 6.3, 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4), new THREE.Vector3(1, 1, 1))); B.add(new THREE.SphereGeometry(0.15, 8, 6), 'gold', new THREE.Matrix4().makeTranslation(x, 7.15, 0)); }
    else if (theme === 'wood'){ const r = rng(5); for (let k = 0; k < 4; k++) B.add(new THREE.IcosahedronGeometry(0.7 + r() * 0.3, 1), 'hedge', new THREE.Matrix4().makeTranslation(x + (r() - 0.5), 5.6 + r() * 0.6, (r() - 0.5))); }
    else if (theme === 'sky' || theme === 'main'){ B.add(new THREE.SphereGeometry(0.28, 14, 10), st.trim, new THREE.Matrix4().makeTranslation(x, 5.8, 0)); }
    else if (theme === 'dragon'){ for (const a of [-0.3, 0.3]) B.add(new THREE.ConeGeometry(0.12, 1.1, 6), 'iron', new THREE.Matrix4().compose(new THREE.Vector3(x, 6, a), new THREE.Quaternion().setFromEuler(new THREE.Euler(a, 0, 0)), new THREE.Vector3(1, 1, 1))); }
  }
  // the beam across, and a decorative arch under it
  B.box(st.beam, 0, 5.05, 0, width + 1.6, 0.35, 0.4);
  if (theme === 'main' || theme === 'sky' || theme === 'castle'){
    const arc = new THREE.TorusGeometry(width / 2, 0.06, 6, 32, Math.PI);
    B.add(arc, st.trim, new THREE.Matrix4().compose(new THREE.Vector3(0, 4.9 - width / 2 * 0.35, 0), new THREE.Quaternion(), new THREE.Vector3(1, 0.35, 1)));
  }
  const body = B.build(resolveMat);
  body.traverse((o) => { if (o.isMesh){ o.castShadow = true; o.receiveShadow = true; } });
  g.add(body);
  const bw = Math.min(width + 0.6, Math.max(4, name.length * 0.42 + 1));
  for (const s of [1, -1]){
    const b = boardMesh(name, bw, 1.05, { bg: st.bg, fg: st.fg, border: st.fg });
    b.position.set(0, 5.85, s * 0.23); if (s < 0) b.rotation.y = Math.PI;
    g.add(b);
  }
  // the board's backing (the boards sit 3 cm in front of it)
  const backing = new Batch(); backing.box(st.beam, 0, 5.85, 0, bw + 0.2, 1.2, 0.4);
  const bk = backing.build(resolveMat); bk.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.add(bk);
  g.userData.colliders = [{ c: [-hw, 0], r: 0.5 }, { c: [hw, 0], r: 0.5 }];
  return g;
}
export const archThemeColor = (theme) => (THEMES[theme] || THEMES.main).color;

// --- car parks: tarmac, bays, kerbs, lamp posts and a sign ---------------------------------------------
// the rows of bays (5 m deep) with aisles (7 m) between, across the car park's depth
// rows of bays across the depth: pairs facing each other over a 7 m aisle (back to back between pairs);
// a row is only laid where its aisle fits too (a lone last row once had no aisle, and cars drove over
// the bays to reach it), and the rows are centred, leaving a lane at each end
function lotRows(D){
  const rows = [], end = D / 2 - 0.4; let z = -D / 2 + 0.4;
  while (z + 12 <= end){ rows.push(z); z += 12; if (z + 5 <= end){ rows.push(z); z += 5; } else { z -= 7; break; } }
  if (!rows.length) return [-D / 2 + 0.4];
  const last = rows.length % 2 ? rows[rows.length - 1] + 12 : rows[rows.length - 1] + 5, shift = (end - last) / 2;
  return rows.map((r) => r + shift);
}
const LANE = 2.4;   // a lane down each side of a car park, wide enough for a car (cars drive down it to their aisle)
// where each bay is (in the park), and which way a car in it faces
export function lotBays(o){
  const W = o.w * 2, D = o.d * 2, rows = lotRows(D), out = [];
  rows.forEach((rz, ri) => { for (let x = -W / 2 + LANE; x + 2.5 <= W / 2 - LANE; x += 2.5) out.push({ x: o.x + x + 1.25, z: o.z + rz + 2.5, yaw: ri % 2 ? -Math.PI / 2 : Math.PI / 2,   /* nose in: the car's length along the bay (its model runs along x) */ aisle: o.z + rz + (ri % 2 ? -3.5 : 8.5) }); });
  return out;
}
export function buildLot(o, park){
  const W = o.w * 2, D = o.d * 2, g = new THREE.Group(), B = new Batch();
  const y0 = park.groundAt(o.x, o.z);
  // the surface (the ground under it is levelled when the lot is placed)
  const surf = new THREE.PlaneGeometry(W - 0.4, D - 0.4); surf.rotateX(-Math.PI / 2);
  B.add(surf, 'tarmac', new THREE.Matrix4().makeTranslation(0, 0.06, 0));
  // kerbs round the edge
  for (const [x, z, w, d] of [[0, -D / 2 + 0.1, W, 0.2], [0, D / 2 - 0.1, W, 0.2], [-W / 2 + 0.1, 0, 0.2, D - 0.4], [W / 2 - 0.1, 0, 0.2, D - 0.4]]) B.box('kerb', x, 0.06, z, w, 0.24, d);
  // rows of bays: bays (5 m) and aisles (7 m) across the depth
  const rows = lotRows(D);
  const line = (x, zz, w, d) => B.box('line', x, 0.075, zz, w, 0.01, d);
  let bays = 0;
  for (let rI = 0; rI < rows.length; rI++){
    const rz = rows[rI];
    for (let x = -W / 2 + LANE; x + 2.5 <= W / 2 - LANE; x += 2.5){ line(x, rz + 2.5, 0.1, 4.8); bays++; }
    line(-W / 2 + LANE + Math.floor((W - 2 * LANE) / 2.5) * 2.5, rz + 2.5, 0.1, 4.8);
  }
  // lamp posts down the middle
  const glows = [];
  for (let x = -W / 2 + 8; x <= W / 2 - 6; x += 14){
    const lz = rows.length > 1 ? (rows[0] + 5 + 3.5) : 0;
    B.add(new THREE.CylinderGeometry(0.07, 0.12, 7, 8), 'iron', new THREE.Matrix4().makeTranslation(x, 3.5, lz));
    B.box('iron', x, 7.0, lz, 1.6, 0.08, 0.12);
    for (const s of [-1, 1]){ B.box('iron', x + s * 0.8, 6.9, lz, 0.5, 0.18, 0.3); B.add(new THREE.BoxGeometry(0.42, 0.04, 0.24), 'glow', new THREE.Matrix4().makeTranslation(x + s * 0.8, 6.8, lz)); glows.push([x + s * 0.8, 6.7, lz]); }
  }
  const body = B.build(resolveMat);
  body.traverse((m) => { if (m.isMesh){ m.receiveShadow = true; m.castShadow = m.name === 'iron'; } });
  g.add(body);
  // the sign at the corner nearest the road
  const sign = new THREE.Group();
  const post = new Batch(); post.box('iron', -1.1, 1.4, 0, 0.1, 2.8, 0.1); post.box('iron', 1.1, 1.4, 0, 0.1, 2.8, 0.1); post.box('iron', 0, 2.25, 0, 2.6, 1.15, 0.06);
  sign.add(post.build(resolveMat));
  for (const s of [1, -1]){ const b = boardMesh('P  ' + (o.name || 'Car park'), 2.4, 0.95, { bg: '#1a3a6a', fg: '#ffffff', border: '#ffffff', font: '"Helvetica Neue", Arial, sans-serif' }); b.position.set(0, 2.25, s * 0.04); if (s < 0) b.rotation.y = Math.PI; sign.add(b); }
  sign.position.set(W / 2 - 1.5, 0, D / 2 + 1.2);
  g.add(sign);
  g.userData.glows = glows; g.userData.bays = bays; g.userData.y0 = y0;
  return g;
}

// --- fences and walls: from (x, z) to (x2, z2) ------------------------------------------------------
export const FENCES = {
  railing: { name: 'Iron railing', h: 1.4 }, picket: { name: 'Picket fence', h: 1.0 }, wall: { name: 'Stone wall', h: 1.2 }, hedgerow: { name: 'Hedge', h: 1.6 },
};
export function buildFence(o, park){
  const B = new Batch(), dx = o.x2 - o.x, dz = o.z2 - o.z, L = Math.hypot(dx, dz), ry = Math.atan2(-dz, dx);
  const n = Math.max(1, Math.round(L / 2)), step = L / n;
  const at = (t) => { const x = o.x + dx * t, z = o.z + dz * t; return [x, park.floorAt(x, z), z]; };
  const kind = o.type.slice(6);
  const seg = (key, t0, t1, y0, h, thick) => {
    const [ax, ay, az] = at(t0), [bx, by, bz] = at(t1);
    const len = Math.hypot(bx - ax, bz - az);
    const m = new THREE.Matrix4().compose(new THREE.Vector3((ax + bx) / 2, (ay + by) / 2 + y0 + h / 2, (az + bz) / 2), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, Math.atan2(by - ay, len))), new THREE.Vector3(len + (key === 'hedge' || key === 'ashlar' ? 0.02 : 0), h, thick));
    B.add(new THREE.BoxGeometry(1, 1, 1), key, m);
  };
  for (let k = 0; k <= n; k++){
    const [x, y, z] = at(k / n);
    if (kind === 'railing'){ B.box('iron', x, y + 0.75, z, 0.09, 1.5, 0.09, ry); B.add(new THREE.SphereGeometry(0.07, 8, 6), 'gold', new THREE.Matrix4().makeTranslation(x, y + 1.55, z)); }
    if (kind === 'picket'){ B.box('white', x, y + 0.55, z, 0.1, 1.1, 0.1, ry); }
    if (kind === 'wall' && k < n){ /* walls are continuous */ }
  }
  for (let k = 0; k < n; k++){
    const t0 = k / n, t1 = (k + 1) / n;
    if (kind === 'railing'){
      seg('iron', t0, t1, 1.25, 0.04, 0.05); seg('iron', t0, t1, 0.15, 0.04, 0.05);
      const bars = Math.round(step / 0.14);
      for (let b = 1; b < bars; b++){ const t = t0 + (t1 - t0) * b / bars, [x, y, z] = at(t); B.box('iron', x, y + 0.72, z, 0.022, 1.2, 0.022, ry); B.add(new THREE.ConeGeometry(0.03, 0.1, 4), 'iron', new THREE.Matrix4().makeTranslation(x, y + 1.37, z)); }
    }
    if (kind === 'picket'){
      seg('white', t0, t1, 0.3, 0.07, 0.04); seg('white', t0, t1, 0.75, 0.07, 0.04);
      const bars = Math.round(step / 0.15);
      for (let b = 1; b < bars; b++){ const t = t0 + (t1 - t0) * b / bars, [x, y, z] = at(t); B.box('white', x + Math.sin(ry) * 0.04, y + 0.5, z + Math.cos(ry) * 0.04, 0.08, 0.95, 0.025, ry); }
    }
    if (kind === 'wall'){ seg('ashlar', t0, t1, -0.2, 1.3, 0.5); seg('stone', t0, t1, 1.1, 0.12, 0.62); }
    if (kind === 'hedgerow'){ seg('hedge', t0, t1, -0.1, 1.7, 0.9); }
  }
  const g = B.build(resolveMat);
  g.traverse((m) => { if (m.isMesh){ m.castShadow = true; m.receiveShadow = true; } });
  return g;
}

// --- signs: a post with a board saying whatever you like ---------------------------------------------------
export function buildSign(o){
  const g = new THREE.Group(), B = new Batch();
  B.box('darkwood', -1.05, 1.25, 0, 0.14, 2.5, 0.14); B.box('darkwood', 1.05, 1.25, 0, 0.14, 2.5, 0.14); B.box('darkwood', 0, 2.0, 0, 2.3, 0.95, 0.08);
  B.add(new THREE.ConeGeometry(0.12, 0.2, 4), 'gold', new THREE.Matrix4().makeTranslation(-1.05, 2.6, 0)); B.add(new THREE.ConeGeometry(0.12, 0.2, 4), 'gold', new THREE.Matrix4().makeTranslation(1.05, 2.6, 0));
  const body = B.build(resolveMat); body.traverse((m) => { if (m.isMesh) m.castShadow = true; }); g.add(body);
  for (const s of [1, -1]){ const b = boardMesh(o.name || 'Welcome', 2.1, 0.8, { bg: o.color || '#173826' }); b.position.set(0, 2.0, s * 0.045); if (s < 0) b.rotation.y = Math.PI; g.add(b); }
  g.userData.colliders = [{ c: [-1.05, 0], r: 0.2 }, { c: [1.05, 0], r: 0.2 }];
  return g;
}
