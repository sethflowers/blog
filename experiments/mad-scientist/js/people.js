// The customers: cartoon people, mostly head, with googly eyes, a round nose, assorted hair and hats.
// Each is a tree of parts (legs, torso, arms, neck, head, eyes, ears, nose, mouth, hair, hat) so the
// effects can grab a part and do something silly with it: blow the eyes up, flap giant ears, stretch
// the neck, drop the hair on the floor, swap the whole person for a pig or a beetle...
// Every shape is made once and shared (kit()), and materials are cached by colour, so a customer
// leaving frees nothing and leaks nothing.
import * as THREE from 'three';
import { V, clamp, lerp, rng, toon, keep, ellipsoid, mergeGeometries, paint, angleDiff } from './util.js';
import { COLOURS, ANIMAL_SAY, EFFECTS } from './recipes.js';

const SKIN = ['#ffd8b8', '#f0b890', '#d89a6a', '#a8704a', '#7a4a2a', '#ffe0c8'];
const SHIRT = ['#ff4a5a', '#3a8aff', '#ffd23a', '#4ad86a', '#b85aff', '#ff8a2a', '#2ad8d0', '#ffffff', '#ff6ab8'];
const PANTS = ['#2a3a6a', '#3a2a1a', '#4a4a52', '#1a5a3a', '#6a2a4a', '#2a6a8a'];
const HAIR = ['#2a1a10', '#6a3a1a', '#e8c050', '#c8501a', '#1a1a1a', '#a8a8b0', '#ff5ab0', '#5ac8ff'];
const STYLES = ['mop', 'spiky', 'afro', 'bun', 'pigtails', 'mohawk', 'none', 'mop', 'spiky'];
const HATS = ['none', 'none', 'none', 'top', 'cap', 'beanie', 'party'];
export const HIP = 0.58, LEG = 0.53, ARM = 0.42, HEAD_R = 0.24;

let K = null;
function blobTex(){
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31); gr.addColorStop(0, 'rgba(0,0,0,0.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
}
function stripeTex(rainbow){
  const c = document.createElement('canvas'); c.width = 64; c.height = 256; const g = c.getContext('2d');
  const cols = rainbow ? ['#ff3a3a', '#ff9a1a', '#ffe82a', '#3ad84a', '#3a8aff', '#a04aff'] : ['#ffffff', '#ff2a4a'];
  const n = rainbow ? 12 : 10;
  for (let i = 0; i < n; i++){ g.fillStyle = cols[i % cols.length]; g.fillRect(0, i * 256 / n, 64, 256 / n + 1); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
// a geometry painted by a function of position (spots on a cow or a ladybird)
function painted(g, f){
  const p = g.attributes.position, a = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i++){ c.set(f(p.getX(i), p.getY(i), p.getZ(i))); a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g;
}
function kit(){
  if (K) return K;
  K = {};
  const k = (g) => keep(g);
  K.leg = k(new THREE.CapsuleGeometry(0.072, 0.38, 4, 10).translate(0, -0.265, 0));
  K.shoe = k(ellipsoid(0.085, 0.055, 0.13, 12, 8).translate(0, 0, 0.035));
  K.torso = k(new THREE.LatheGeometry([[0.001, 0], [0.17, 0.01], [0.235, 0.12], [0.245, 0.3], [0.205, 0.47], [0.12, 0.56], [0.001, 0.58]].map(([r, y]) => new THREE.Vector2(r, y)), 18));
  K.arm = k(new THREE.CapsuleGeometry(0.05, 0.3, 4, 8).translate(0, -0.2, 0));
  K.hand = k(new THREE.SphereGeometry(0.062, 12, 8));
  K.neck = k(new THREE.CylinderGeometry(0.062, 0.07, 1, 10, 1, true).translate(0, 0.5, 0));
  K.head = k(new THREE.SphereGeometry(HEAD_R, 24, 18).translate(0, 0.22, 0));
  K.eye = k(ellipsoid(0.066, 0.074, 0.045, 14, 10));
  K.pupil = k(new THREE.SphereGeometry(0.03, 10, 8));
  K.lid = k(new THREE.SphereGeometry(0.069, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1, 1.1, 0.7));
  K.nose = k(ellipsoid(0.045, 0.04, 0.05, 10, 8));
  K.longNose = k(new THREE.ConeGeometry(0.045, 1, 10).rotateX(Math.PI / 2).translate(0, 0, 0.5));
  K.smile = k(new THREE.TorusGeometry(0.06, 0.014, 6, 14, Math.PI).rotateZ(Math.PI));
  K.mouthO = k(ellipsoid(0.05, 0.045, 0.025, 12, 8));
  K.ear = k(ellipsoid(0.03, 0.065, 0.048, 10, 8).translate(0.018, 0, 0));
  K.blush = k(new THREE.CircleGeometry(0.035, 12));
  K.shadow = k(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
  // hair, relative to the head group (the head's centre is at y 0.22)
  const C = 0.22, cap = (r = 0.268, th = 0.52) => new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, Math.PI * th).translate(0, C, -0.01);
  K.hair = {
    mop: k(cap()),
    spiky: k(mergeGeometries([cap(0.262, 0.42), ...Array.from({ length: 9 }, (_, i) => { const a = i / 9 * Math.PI * 2, t = i % 3 === 0 ? 0.15 : 0.45; return new THREE.ConeGeometry(0.06, 0.16, 6).translate(0, 0.08, 0).rotateX(t).rotateY(a).translate(0, C + 0.22, 0); })])),
    afro: k(new THREE.SphereGeometry(0.34, 16, 12).scale(1, 0.9, 1).translate(0, C + 0.1, -0.06)),
    bun: k(mergeGeometries([cap(), new THREE.SphereGeometry(0.1, 12, 8).translate(0, C + 0.3, -0.06)])),
    pigtails: k(mergeGeometries([cap(), new THREE.SphereGeometry(0.085, 10, 8).scale(1, 1.4, 1).translate(0.27, C - 0.04, -0.05), new THREE.SphereGeometry(0.085, 10, 8).scale(1, 1.4, 1).translate(-0.27, C - 0.04, -0.05)])),
    mohawk: k(mergeGeometries(Array.from({ length: 6 }, (_, i) => new THREE.ConeGeometry(0.05, 0.2, 4).scale(0.5, 1, 1.4).translate(0, 0.1, 0).rotateX(-1.2 + i * 0.48).translate(0, C, 0)).map((g) => g.translate(0, 0.0, 0)).concat([new THREE.SphereGeometry(0.03, 4, 3)].map((g) => g.translate(0, C + 0.24, 0))))),
    frizz: k(mergeGeometries([new THREE.IcosahedronGeometry(0.3, 1).translate(0, C + 0.17, -0.09), ...Array.from({ length: 14 }, (_, i) => { const a = i / 14 * Math.PI * 2; return new THREE.ConeGeometry(0.06, 0.24, 5).translate(0, 0.42, 0).rotateZ(Math.cos(a) * 1.2).rotateX(Math.sin(a) * 1.2).translate(0, C, 0); })])),
  };
  K.hats = {
    top: k(mergeGeometries([new THREE.CylinderGeometry(0.29, 0.29, 0.02, 20).translate(0, 0, 0), new THREE.CylinderGeometry(0.17, 0.18, 0.3, 18).translate(0, 0.16, 0)])),
    cap: k(mergeGeometries([new THREE.SphereGeometry(0.285, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.45).translate(0, -0.05, 0), new THREE.CylinderGeometry(0.17, 0.17, 0.018, 16, 1, false, -Math.PI / 2, Math.PI).scale(1, 1, 1.3).translate(0, 0.02, 0.2)])),
    beanie: k(mergeGeometries([new THREE.SphereGeometry(0.29, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1, 1.15, 1).translate(0, -0.08, 0), new THREE.SphereGeometry(0.07, 8, 6).translate(0, 0.27, 0)])),
    party: k(mergeGeometries([new THREE.ConeGeometry(0.13, 0.34, 14).translate(0, 0.17, 0), new THREE.SphereGeometry(0.045, 8, 6).translate(0, 0.35, 0)])),
  };
  // a huge beard: hangs from the chin
  K.beard = k(mergeGeometries([new THREE.ConeGeometry(0.2, 1, 12, 3).rotateX(Math.PI).translate(0, -0.5, 0).scale(1, 1, 0.55), new THREE.TorusGeometry(0.07, 0.025, 6, 12, Math.PI).translate(0, 0.04, 0.05)]));
  // the little ghost left when someone explodes: a sheet with a wavy hem
  const gh = new THREE.LatheGeometry([[0.001, 0.62], [0.14, 0.6], [0.22, 0.48], [0.25, 0.25], [0.27, 0.02], [0.28, 0]].map(([r, y]) => new THREE.Vector2(r, y)), 24, 0, Math.PI * 2);
  { const p = gh.attributes.position; for (let i = 0; i < p.count; i++){ if (p.getY(i) < 0.05){ const a = Math.atan2(p.getZ(i), p.getX(i)); p.setY(i, p.getY(i) + Math.sin(a * 7) * 0.04); } } gh.computeVertexNormals(); }
  K.ghost = k(gh);
  // a bolt of lightning: a jagged ribbon, top to bottom 1 m
  { const parts = []; let x = 0, y = 1; while (y > 0){ const nx = x + (Math.random() - 0.5) * 0.22, ny = y - 0.1 - Math.random() * 0.06, L = Math.hypot(nx - x, ny - y); parts.push(new THREE.BoxGeometry(0.025, L, 0.025).rotateZ(-Math.atan2(nx - x, y - ny)).translate((x + nx) / 2, (y + ny) / 2, 0)); x = nx; y = ny; } K.bolt = k(mergeGeometries(parts)); }
  // ---- animals and the bug (each part shared) ----
  const pink = '#ffa8c0', dpink = '#ff7aa0';
  K.pig = {
    body: k(paint(ellipsoid(0.3, 0.26, 0.42, 18, 12).translate(0, 0.48, 0), pink)),
    head: k(mergeGeometries([paint(new THREE.SphereGeometry(0.22, 18, 12).translate(0, 0.64, 0.38), pink), paint(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 14).rotateX(Math.PI / 2).translate(0, 0.6, 0.6), dpink),
      paint(new THREE.SphereGeometry(0.022, 6, 4).translate(0.04, 0.61, 0.645), '#5a2030'), paint(new THREE.SphereGeometry(0.022, 6, 4).translate(-0.04, 0.61, 0.645), '#5a2030'),
      paint(new THREE.ConeGeometry(0.07, 0.13, 4).rotateZ(-0.6).translate(0.14, 0.84, 0.36), dpink), paint(new THREE.ConeGeometry(0.07, 0.13, 4).rotateZ(0.6).translate(-0.14, 0.84, 0.36), dpink),
      paint(new THREE.TorusGeometry(0.05, 0.016, 6, 12, Math.PI).rotateZ(Math.PI).translate(0, 0.53, 0.56), '#a03050')])),
    leg: k(paint(new THREE.CylinderGeometry(0.06, 0.055, 0.3, 8).translate(0, -0.15, 0), pink)),
    tail: k(paint(new THREE.TorusGeometry(0.05, 0.014, 6, 12, Math.PI * 1.6).translate(0, 0.55, -0.44), dpink)),
    eyes: [[0.08, 0.72, 0.56], [-0.08, 0.72, 0.56]], hatAt: [0, 0.84, 0.36], legs: [[0.15, 0.3, 0.22], [-0.15, 0.3, 0.22], [0.15, 0.3, -0.22], [-0.15, 0.3, -0.22]],
  };
  const green = '#5ad83a', dgreen = '#3aa82a';
  K.frog = {
    body: k(mergeGeometries([paint(ellipsoid(0.32, 0.2, 0.3, 18, 12).translate(0, 0.24, 0), green), paint(ellipsoid(0.22, 0.1, 0.2, 12, 8).translate(0, 0.16, 0.08), '#e8f8a0'),
      paint(ellipsoid(0.13, 0.08, 0.22, 10, 8).translate(0.28, 0.1, -0.05), dgreen), paint(ellipsoid(0.13, 0.08, 0.22, 10, 8).translate(-0.28, 0.1, -0.05), dgreen)])),
    head: k(mergeGeometries([paint(new THREE.SphereGeometry(0.1, 12, 10).translate(0.13, 0.44, 0.15), green), paint(new THREE.SphereGeometry(0.1, 12, 10).translate(-0.13, 0.44, 0.15), green),
      paint(new THREE.TorusGeometry(0.2, 0.016, 6, 20, Math.PI).rotateZ(Math.PI).scale(1, 0.35, 1).translate(0, 0.26, 0.2), '#2a6a1a')])),
    leg: k(paint(new THREE.CylinderGeometry(0.04, 0.035, 0.14, 6).translate(0, -0.07, 0), green)),
    eyes: [[0.13, 0.47, 0.24], [-0.13, 0.47, 0.24]], hatAt: [0, 0.4, 0.05], legs: [[0.16, 0.12, 0.2], [-0.16, 0.12, 0.2]],
  };
  K.chicken = {
    body: k(mergeGeometries([paint(ellipsoid(0.22, 0.24, 0.28, 16, 12).translate(0, 0.52, 0), '#ffffff'), paint(ellipsoid(0.05, 0.14, 0.18, 8, 6).translate(0.21, 0.54, -0.02), '#f0f0f0'), paint(ellipsoid(0.05, 0.14, 0.18, 8, 6).translate(-0.21, 0.54, -0.02), '#f0f0f0'),
      paint(new THREE.ConeGeometry(0.1, 0.2, 6).rotateX(-1).translate(0, 0.66, -0.28), '#ffffff')])),
    head: k(mergeGeometries([paint(new THREE.SphereGeometry(0.13, 14, 10).translate(0, 0.86, 0.17), '#ffffff'), paint(new THREE.ConeGeometry(0.045, 0.11, 6).rotateX(Math.PI / 2).translate(0, 0.84, 0.34), '#ffb81a'),
      paint(new THREE.SphereGeometry(0.04, 8, 6).translate(0, 1.0, 0.2), '#ff2a2a'), paint(new THREE.SphereGeometry(0.035, 8, 6).translate(0, 1.0, 0.12), '#ff2a2a'), paint(new THREE.SphereGeometry(0.035, 8, 6).translate(0, 0.99, 0.27), '#ff2a2a'),
      paint(ellipsoid(0.025, 0.045, 0.025, 8, 6).translate(0, 0.76, 0.29), '#ff2a2a')])),
    leg: k(paint(mergeGeometries([new THREE.CylinderGeometry(0.018, 0.018, 0.3, 5).translate(0, -0.15, 0), new THREE.BoxGeometry(0.08, 0.015, 0.1).translate(0, -0.3, 0.03)]), '#ffb81a')),
    eyes: [[0.07, 0.9, 0.27], [-0.07, 0.9, 0.27]], hatAt: [0, 1.02, 0.15], legs: [[0.08, 0.32, 0], [-0.08, 0.32, 0]],
  };
  const spots = (x, y, z) => (Math.sin(x * 13) * Math.sin(y * 11 + 1) * Math.sin(z * 9 + 2) > 0.18 ? '#1a1a1a' : '#ffffff');
  K.cow = {
    body: k(mergeGeometries([painted(ellipsoid(0.3, 0.3, 0.52, 20, 14).translate(0, 0.62, 0), spots), paint(new THREE.CylinderGeometry(0.02, 0.012, 0.4, 5).translate(0, -0.2, 0).rotateX(0.3).translate(0, 0.78, -0.5), '#1a1a1a'),
      paint(ellipsoid(0.1, 0.07, 0.1, 10, 6).translate(0, 0.36, -0.1), '#ffb0c0')])),
    head: k(mergeGeometries([painted(ellipsoid(0.17, 0.2, 0.2, 16, 12).translate(0, 0.88, 0.55), (x, y, z) => (x > 0.06 && y > 0.9 ? '#1a1a1a' : '#ffffff')), paint(ellipsoid(0.15, 0.1, 0.1, 14, 8).translate(0, 0.78, 0.7), '#ffb0c0'),
      paint(new THREE.SphereGeometry(0.02, 6, 4).translate(0.05, 0.78, 0.8), '#5a2030'), paint(new THREE.SphereGeometry(0.02, 6, 4).translate(-0.05, 0.78, 0.8), '#5a2030'),
      paint(new THREE.ConeGeometry(0.03, 0.14, 6).rotateZ(-0.9).translate(0.17, 1.06, 0.5), '#f0e0c0'), paint(new THREE.ConeGeometry(0.03, 0.14, 6).rotateZ(0.9).translate(-0.17, 1.06, 0.5), '#f0e0c0'),
      paint(ellipsoid(0.1, 0.035, 0.05, 8, 6).translate(0.22, 0.95, 0.47), '#ffffff'), paint(ellipsoid(0.1, 0.035, 0.05, 8, 6).translate(-0.22, 0.95, 0.47), '#ffffff')])),
    leg: k(painted(new THREE.CylinderGeometry(0.065, 0.06, 0.4, 8).translate(0, -0.2, 0), (x, y) => (y < -0.33 ? '#3a2a1a' : '#ffffff'))),
    eyes: [[0.08, 0.97, 0.7], [-0.08, 0.97, 0.7]], hatAt: [0, 1.08, 0.52], legs: [[0.17, 0.4, 0.3], [-0.17, 0.4, 0.3], [0.17, 0.4, -0.3], [-0.17, 0.4, -0.3]],
  };
  // the bug: a giant ladybird with a black head
  K.bug = {
    body: k(mergeGeometries([painted(new THREE.SphereGeometry(0.4, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.62, 1.25).translate(0, 0.16, 0), (x, y, z) => {
      if (Math.abs(x) < 0.015 && y > 0.2) return '#1a1a1a';
      for (const [sx, sz] of [[0.18, 0.18], [-0.18, 0.18], [0.2, -0.15], [-0.2, -0.15], [0.07, -0.35], [-0.07, -0.35], [0.28, 0.02], [-0.28, 0.02]]) if (Math.hypot(x - sx, z - sz) < 0.08) return '#1a1a1a';
      return '#e8201a'; }), paint(new THREE.CircleGeometry(0.4, 22).rotateX(Math.PI / 2).scale(1, 1, 1.25).translate(0, 0.16, 0), '#1a1a1a')])),
    head: k(mergeGeometries([paint(new THREE.SphereGeometry(0.17, 14, 10).scale(1.1, 0.85, 0.9).translate(0, 0.22, 0.5), '#1a1a1a'),
      paint(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 4).translate(0, 0.15, 0).rotateZ(-0.5).rotateX(0.6).translate(0.06, 0.34, 0.56), '#1a1a1a'), paint(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 4).translate(0, 0.15, 0).rotateZ(0.5).rotateX(0.6).translate(-0.06, 0.34, 0.56), '#1a1a1a'),
      paint(new THREE.SphereGeometry(0.025, 6, 4).translate(0.19, 0.55, 0.72), '#1a1a1a'), paint(new THREE.SphereGeometry(0.025, 6, 4).translate(-0.19, 0.55, 0.72), '#1a1a1a')])),
    leg: k(paint(mergeGeometries([new THREE.CylinderGeometry(0.018, 0.018, 0.22, 5).translate(0, 0.11, 0).rotateZ(-1.1), new THREE.CylinderGeometry(0.015, 0.01, 0.24, 5).translate(0, -0.12, 0).translate(0.2, 0.1, 0)]), '#1a1a1a')),
    eyes: [[0.08, 0.3, 0.63], [-0.08, 0.3, 0.63]], hatAt: [0, 0.36, 0.48], legs: [[0.25, 0.12, 0.25], [0.28, 0.12, 0], [0.25, 0.12, -0.25], [-0.25, 0.12, 0.25], [-0.28, 0.12, 0], [-0.25, 0.12, -0.25]],
  };
  // materials
  K.eyeMat = toon('eye-white', '#ffffff');
  K.pupilMat = toon('pupil', '#111111');
  K.mouthMat = toon('mouth', '#7a1a2a');
  K.blushMat = new THREE.MeshBasicMaterial({ color: '#ff6a8a', transparent: true, opacity: 0.6, depthWrite: false }); K.blushMat.name = 'blush';
  K.vcMat = toon('vc', '#ffffff', { vertexColors: true });
  K.ghostMat = toon('ghost', '#f4fbff', { transparent: true, opacity: 0.85, emissive: '#405060' });
  K.boltMat = new THREE.MeshBasicMaterial({ color: '#fffbd0', toneMapped: false }); K.boltMat.name = 'bolt';
  K.shadowMat = new THREE.MeshBasicMaterial({ map: blobTex(), transparent: true, depthWrite: false }); K.shadowMat.name = 'shadow';
  K.rainbow = toon('fx-rainbow', '#ffffff', { map: stripeTex(true) });
  K.stripes = toon('fx-stripes', '#ffffff', { map: stripeTex(false) });
  K.soot = toon('soot', '#3a3436');
  K.red = toon('hot-red', '#ff3a2a');
  return K;
}
export function peopleKit(){ return kit(); }
// the effect colour skins (rainbow and stripes scroll: main.js moves their texture each frame)
function effectSkin(id){
  const k = kit();
  if (id === 'rainbow') return k.rainbow;
  if (id === 'stripes') return k.stripes;
  const c = COLOURS.find((c) => c.id === id) || COLOURS[0];
  return toon('fx-' + c.id, c.c);
}
const shiny = new Map();
function shinySkin(color){
  if (!shiny.has(color)){ const m = new THREE.MeshPhongMaterial({ color, shininess: 160, specular: '#ffffff' }); m.name = 'shiny-' + color; shiny.set(color, m); }
  return shiny.get(color);
}

let nextId = 1;
export class Person {
  constructor(scene, seed){
    const k = kit(), r = rng(seed * 7919 + 17);
    const pick = (a) => a[Math.floor(r() * a.length)];
    this.scene = scene; this.id = nextId++; this.seed = seed;
    this.look = { skin: pick(SKIN), shirt: pick(SHIRT), pants: pick(PANTS), hairC: pick(HAIR), style: pick(STYLES), hat: pick(HATS), hatC: pick(SHIRT), size: 0.92 + r() * 0.26, fat: 0.85 + r() * 0.45 };
    if (this.look.hat !== 'none' && !['mop', 'none', 'pigtails'].includes(this.look.style)) this.look.hat = 'none';
    this.voice = 0.8 + r() * 0.7;
    const L = this.look;
    this.skinMat = toon('skin-' + L.skin, L.skin);
    const root = this.root = new THREE.Group();
    const body = this.body = new THREE.Group(); root.add(body);
    this.shadow = new THREE.Mesh(k.shadow, k.shadowMat); this.shadow.position.y = 0.012; this.shadow.scale.setScalar(0.7); this.shadow.renderOrder = 1; root.add(this.shadow);
    const M = (g, m, parent, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); parent.add(o); return o; };
    // legs and shoes
    this.legs = [-1, 1].map((s) => { const g = new THREE.Group(); g.position.set(s * 0.1, HIP, 0); body.add(g); const leg = M(k.leg, toon('pants-' + L.pants, L.pants), g); const shoe = M(k.shoe, toon('shoe', '#2a2a30'), g, 0, -LEG, 0); return { g, leg, shoe }; });
    this.torso = M(k.torso, toon('shirt-' + L.shirt, L.shirt), body, 0, HIP - 0.06, 0);
    this.torso.scale.set(L.fat, 1, L.fat * 0.9);
    // arms swing from the shoulders
    this.arms = [-1, 1].map((s) => { const g = new THREE.Group(); g.position.set(s * (0.2 + 0.04 * L.fat), HIP + 0.42, 0); g.rotation.z = s * 0.12; body.add(g); const arm = M(k.arm, this.torso.material, g); const hand = M(k.hand, this.skinMat, g, 0, -ARM, 0); return { g, arm, hand, s }; });
    this.neck = new THREE.Group(); this.neck.position.set(0, HIP + 0.47, 0); body.add(this.neck);
    this.neckMesh = M(k.neck, this.skinMat, this.neck); this.neckLen = 0.06; this.neckMesh.scale.y = this.neckLen;
    const head = this.head = new THREE.Group(); head.position.y = this.neckLen; this.neck.add(head);
    this.headMesh = M(k.head, this.skinMat, head);
    // googly eyes
    this.eyes = [-1, 1].map((s) => { const g = new THREE.Group(); g.position.set(s * 0.085, 0.27, 0.19); g.rotation.y = s * 0.25; head.add(g); M(k.eye, k.eyeMat, g); const pupil = M(k.pupil, k.pupilMat, g, 0, 0, 0.035); const lid = M(k.lid, this.skinMat, g); lid.visible = false; return { g, pupil, lid }; });
    this.nose = M(k.nose, this.skinMat, head, 0, 0.2, 0.24);
    this.longNose = M(k.longNose, this.skinMat, head, 0, 0.2, 0.22); this.longNose.visible = false;
    this.mouth = M(k.smile, k.mouthMat, head, 0, 0.12, 0.215);
    this.mouthO = M(k.mouthO, k.mouthMat, head, 0, 0.11, 0.21); this.mouthO.visible = false;
    this.ears = [-1, 1].map((s) => { const g = new THREE.Group(); g.position.set(s * 0.225, 0.21, 0); g.scale.x = s; head.add(g); M(k.ear, this.skinMat, g); return g; });
    this.blush = [-1, 1].map((s) => { const m = M(k.blush, k.blushMat, head, s * 0.15, 0.16, 0.19); m.rotation.y = s * 0.6; m.visible = false; return m; });
    this.hair = L.style !== 'none' ? M(k.hair[L.style], toon('hair-' + L.hairC, L.hairC), head) : null;
    this.hat = L.hat !== 'none' ? M(k.hats[L.hat], toon('hat-' + L.hatC, L.hatC), head, 0, 0.22 + 0.25 + (this.hair ? 0.02 : 0), 0) : null;
    if (this.hat && L.hat === 'party') this.hat.rotation.z = 0.25;
    this.beard = M(k.beard, toon('hair-' + L.hairC, L.hairC), head, 0, 0.06, 0.16); this.beard.visible = false;
    this.extraEyes = []; this.extras = []; this.alt = null;
    this.root.scale.setScalar(L.size);
    scene.add(root);
    // state
    this.t = r() * 10; this.walkPhase = 0; this.speed = 0; this.blinkT = 1 + r() * 3; this.blinkK = 0;
    this.fx = new Set(); this.fxT = 0; this.power = {}; this.mode = 'walk'; this.lookAt = null;
    this.rise = 0; this.bob = 0; this.swell = 1; this.tinyK = 1; this.earK = 1; this.eyeK = 1; this.flap = 0;
    this.say = null;     // { text, t } for the speech bubble
    this.events = [];
  }
  get pos(){ return this.root.position; }
  // the top of the head, in the world (for the speech bubble)
  top(out){
    if (this.alt) return out.copy(this.root.position).setY(this.root.position.y + (this.alt.top || 1) * this.root.scale.y + this.rise);
    this.head.updateWorldMatrix(true, false);
    return out.set(0, 0.62, 0).applyMatrix4(this.head.matrixWorld);
  }
  mouthPos(out){ this.head.updateWorldMatrix(true, false); return out.set(0, 0.12, 0.26).applyMatrix4(this.head.matrixWorld); }
  handPos(out){ const h = this.arms[1].hand; h.updateWorldMatrix(true, false); return out.setFromMatrixPosition(h.matrixWorld); }
  speak(text, t = 3.2){ this.say = { text, t }; this.events.push(['talk', text]); }
  // ---------- effects ----------
  // apply a recipe's effects: each grabs some part of the person (see tick() for how they play out)
  apply(effects){
    this.fxT = 0; this.fxList = effects;
    for (const e of effects){ this.fx.add(e.id); this.power[e.id] = e.power || 1; if (e.colour) this.colourId = e.colour; if (e.animal) this.animal = e.animal; }
    const has = (id) => this.fx.has(id);
    if (has('explode')) this.mode = 'ghost';
    else if (has('bug')) this.mode = 'scuttle';
    else if (has('animal')) this.mode = this.animal === 'frog' ? 'hop' : 'trot';
    else if (has('float')) this.mode = 'float';
    else if (has('bouncy')) this.mode = 'bounce';
    else if (has('dance')) this.mode = 'dance';
    else if (has('tiny')) this.mode = 'scurry';
    else if (has('swell')) this.mode = 'waddle';
    else if (has('invisible')) this.mode = 'walk';
    else this.mode = 'walk';
  }
  // the torso's shape (balloon, swollen): the neck and the arms move with it
  shape(sx, sy, sz){
    this.torso.scale.set(sx, sy, sz);
    this.neck.position.y = HIP - 0.06 + 0.56 * sy - 0.03;
    for (const a of this.arms){ a.g.position.x = a.s * (0.03 + 0.21 * sx); a.g.position.y = HIP - 0.06 + 0.46 * sy; }
  }
  setSkin(m){ for (const o of [this.headMesh, this.neckMesh, this.nose, this.longNose, ...this.arms.map((a) => a.hand), ...this.ears.map((e) => e.children[0]), ...this.eyes.map((e) => e.lid)]) o.material = m; }
  // swap the person for an animal or the bug (their googly eyes and hat come along)
  becomeAlt(kind){
    const k = kit(), A = k[kind], g = new THREE.Group();
    const parts = { body: new THREE.Mesh(A.body, k.vcMat), head: new THREE.Mesh(A.head, k.vcMat), legs: [] };
    g.add(parts.body, parts.head);
    for (const [x, y, z] of A.legs){ const l = new THREE.Mesh(A.leg, k.vcMat); l.position.set(x, y, z); if (kind === 'bug') l.scale.x = Math.sign(x); g.add(l); parts.legs.push(l); }
    if (A.tail){ parts.tail = new THREE.Mesh(A.tail, k.vcMat); g.add(parts.tail); }
    for (const [x, y, z] of A.eyes){ const e = new THREE.Group(); e.position.set(x, y, z); e.scale.setScalar(kind === 'chicken' ? 0.7 : 0.9); g.add(e); e.add(new THREE.Mesh(k.eye, k.eyeMat)); const p = new THREE.Mesh(k.pupil, k.pupilMat); p.position.z = 0.035; e.add(p); }
    if (this.hat){ this.hat.position.set(A.hatAt[0], A.hatAt[1] + 0.02, A.hatAt[2]); this.hat.scale.setScalar(kind === 'chicken' ? 0.55 : 0.75); g.add(this.hat); }
    g.scale.setScalar({ cow: 0.72, pig: 0.8, bug: 0.7, frog: 0.9, chicken: 0.85 }[kind] || 0.8);
    this.body.visible = false;
    this.root.add(g);
    this.alt = { kind, g, parts, top: (kind === 'chicken' ? 1.25 : kind === 'cow' ? 1.3 : kind === 'pig' ? 1.05 : 0.8) * g.scale.x };
    this.shadow.scale.set(0.9, 1, 1.3);
  }
  addExtra(o, parent = this.scene){ parent.add(o); this.extras.push(o); return o; }
  // explode: swell and shake, BOOM, then only the shoes are left (smoking) and a little ghost floats up
  boom(){
    this.body.visible = false;
    const k = kit();
    for (const l of this.legs){ const s = new THREE.Mesh(k.shoe, l.shoe.material); l.shoe.getWorldPosition(s.position); s.position.y = 0.055 * this.root.scale.y; s.rotation.y = this.root.rotation.y; s.scale.setScalar(this.root.scale.x); this.addExtra(s); }
    const gh = new THREE.Group(); gh.add(new THREE.Mesh(k.ghost, k.ghostMat));
    for (const s of [-1, 1]){ const e = new THREE.Mesh(k.pupil, k.pupilMat); e.scale.set(1.3, 1.9, 0.6); e.position.set(s * 0.08, 0.44, 0.22); gh.add(e); }
    const o = new THREE.Mesh(k.mouthO, k.pupilMat); o.position.set(0, 0.3, 0.245); gh.add(o);
    gh.position.copy(this.root.position); gh.position.y += 0.3; gh.rotation.y = this.root.rotation.y;
    this.ghost = this.addExtra(gh); this.ghost.scale.setScalar(0.01);
    this.events.push(['boom']);
  }
  // the hair falls off and drops to the floor
  dropHair(){
    if (!this.hair) return;
    const h = this.hair; h.updateWorldMatrix(true, false);
    const w = new THREE.Mesh(h.geometry, h.material); h.matrixWorld.decompose(w.position, w.quaternion, w.scale);
    h.visible = false; this.addExtra(w);
    this.fallingHair = { m: w, v: V((Math.random() - 0.5) * 0.6, 0.8, 0.5), spin: (Math.random() - 0.5) * 6 };
    if (this.colourId && this.fx.has('colour')) this.setSkin(effectSkin(this.colourId));
    else this.setSkin(shinySkin(this.look.skin));
    this.events.push(['hairfall']);
  }
  zapHair(){
    const k = kit();
    if (this.hair) this.hair.visible = false;
    if (this.hat) this.hat.visible = false;
    this.frizz = new THREE.Mesh(k.hair.frizz, toon('hair-frizz', '#3a3030')); this.head.add(this.frizz);
    this.setSkin(k.soot);
  }
  growEyes(n){
    const k = kit(), r = rng(this.seed + 99);
    for (let i = 0; i < n; i++){
      // spots all over the head (not on the face's two real eyes)
      let p; for (let tries = 0; tries < 30; tries++){ const a = r() * Math.PI * 2, y = -0.2 + r() * 1.1; const s = Math.sqrt(Math.max(0, 1 - y * y)); p = V(Math.cos(a) * s, y, Math.sin(a) * s); if (p.z < 0.55 || p.y > 0.5) break; }
      const e = new THREE.Group(); e.position.copy(p).multiplyScalar(HEAD_R + 0.01).add(V(0, 0.22, 0)); e.lookAt(e.position.clone().sub(V(0, 0.22, 0)).multiplyScalar(3).add(V(0, 0.22, 0)));
      e.scale.setScalar(0.01); e.userData.k = 0.7 + r() * 0.55; e.userData.d = i * 0.08;
      e.add(new THREE.Mesh(k.eye, k.eyeMat)); const pu = new THREE.Mesh(k.pupil, k.pupilMat); pu.position.z = 0.035; e.add(pu); e.userData.pupil = pu; e.userData.ph = r() * 9;
      this.head.add(e); this.extraEyes.push(e);
    }
  }
  // ---------- each frame ----------
  update(dt, ctx){
    this.t += dt;
    const k = kit();
    if (this.say){ this.say.t -= dt; if (this.say.t <= 0) this.say = null; }
    // blinking
    this.blinkT -= dt; if (this.blinkT <= 0){ this.blinkT = 2 + Math.random() * 4; this.blinkK = 0.14; }
    if (this.blinkK > 0){ this.blinkK -= dt; }
    const blink = this.blinkK > 0 && !this.fx.has('delicious');
    for (const e of this.eyes){ e.lid.visible = blink; }
    // pupils look at whoever they're looking at (you, usually), jiggling a bit
    if (this.lookAt){
      this.head.updateWorldMatrix(true, false);
      const loc = this.head.worldToLocal(this.lookAt.clone());
      for (const e of this.eyes){ const d = loc.clone().sub(e.g.position).normalize(); e.pupil.position.set(clamp(d.x * 0.03, -0.03, 0.03) + Math.sin(this.t * 31) * 0.002, clamp(d.y * 0.03, -0.03, 0.03), 0.035); }
    }
    // the effects
    if (this.fx.size) this.tickEffects(dt, ctx);
    // moving: each way of getting about has its own silly animation
    const sp = this.speed, m = this.mode;
    this.walkPhase += dt * (sp > 0.05 ? 9 * Math.min(1.4, sp) : 0);
    const w = Math.sin(this.walkPhase) * Math.min(1, sp * 1.6);
    if (!this.alt){
      this.legs[0].g.rotation.x = w * 0.6; this.legs[1].g.rotation.x = -w * 0.6;
      if (m !== 'dance'){ this.arms[0].g.rotation.x = -w * 0.5 + (this.holding ? 0 : 0); if (!this.holding) this.arms[1].g.rotation.x = w * 0.5; }
      this.body.position.y = Math.abs(Math.cos(this.walkPhase)) * 0.03 * Math.min(1, sp);
      this.body.rotation.z = m === 'waddle' ? Math.sin(this.walkPhase) * 0.15 * Math.min(1, sp * 2) : 0;
    } else {
      const P = this.alt.parts;
      P.legs.forEach((l, i) => { l.rotation.x = Math.sin(this.walkPhase * (this.alt.kind === 'bug' ? 2 : 1) + i * (this.alt.kind === 'bug' ? 2.1 : Math.PI)) * 0.5 * Math.min(1, sp * 2); });
      if (this.alt.kind === 'chicken') P.head.position.z = Math.sin(this.walkPhase * 2) * 0.04 * Math.min(1, sp * 2);
      if (P.tail) P.tail.rotation.z = Math.sin(this.t * 6) * 0.3;
      this.alt.g.position.y = m === 'hop' ? Math.abs(Math.sin(this.walkPhase * 0.5)) * 0.35 * Math.min(1, sp * 2) : 0;
    }
    // idle breathing
    if (!this.fx.has('float') && !this.fx.has('swell')) this.torso.scale.y = 1 + Math.sin(this.t * 2.2) * 0.015;
  }
  tickEffects(dt, ctx){
    const t = (this.fxT += dt), has = (id) => this.fx.has(id), pw = (id) => this.power[id] || 1, fx = ctx.fx;
    const once = (key, at) => { if (t >= at && !this['_' + key]){ this['_' + key] = true; return true; } return false; };
    const elastic = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -8 * x) * Math.cos(x * 14));
    const head = V(); this.mouthPos(head);
    if (has('delicious')){
      if (once('yum', 0.2)){ this.blush.forEach((b) => { b.visible = true; }); this.events.push(['yum']); }
      for (const e of this.eyes) e.g.scale.y = t < 3 ? 0.25 : 1;
      if (t < 2.6 && Math.random() < dt * 5) fx.hearts(head.clone().add(V(0, 0.25, 0)), 1);
      this.body.position.y += Math.max(0, Math.sin(Math.min(t, 1.2) * Math.PI / 0.6)) * 0.12;
    }
    if (has('plain')){ if (t < 1.2){ for (const a of this.arms) a.g.rotation.z = a.s * (0.12 + Math.sin(Math.min(1, t * 2) * Math.PI) * 0.8); } }
    if (has('colour')){
      if (once('col', 0.25)){ this.setSkin(effectSkin(this.colourId)); fx.smoke(head, 6, COLOURS.find((c) => c.id === this.colourId)?.c || '#fff', 0.18); this.events.push(['poof']); }
    }
    if (has('bigEyes')){ const s = 1 + (pw('bigEyes') > 1 ? 3 : 1.8) * elastic(clamp((t - 0.2) / 1.2)); for (const e of this.eyes){ e.g.scale.set(s, s, s); e.g.position.z = 0.19 + (s - 1) * 0.02; } if (once('boing', 0.25)) this.events.push(['boing']); }
    if (has('bigEars')){ const s = 1 + (pw('bigEars') > 1 ? 7 : 4.5) * elastic(clamp((t - 0.2) / 1.4)); this.ears.forEach((e, i) => { e.scale.set((i ? 1 : -1) * s * 0.5, s, s * 0.8); e.rotation.y = (i ? -1 : 1) * (Math.sin(this.t * 9) * 0.5 - 0.2) * clamp(t - 0.6); }); if (once('boing', 0.25)) this.events.push(['boing']); }
    if (has('manyEyes')){ if (once('eyes', 0.2)){ this.growEyes(pw('manyEyes') > 1 ? 22 : 12); this.events.push(['pop']); } for (const e of this.extraEyes){ const u = clamp((t - 0.2 - e.userData.d) / 0.5); e.scale.setScalar(e.userData.k * elastic(u)); const ph = this.t * 1.3 + e.userData.ph; e.userData.pupil.position.set(Math.sin(ph) * 0.025, Math.cos(ph * 1.3) * 0.025, 0.035); } }
    if (has('swell')){ const s = 1 + (pw('swell') > 1 ? 1.3 : 0.75) * elastic(clamp((t - 0.2) / 1.6)); this.swell = s; const wob = Math.sin(this.t * 7) * 0.03; this.shape(this.look.fat * s * 1.3 * (1 + wob), s * 0.9 * (1 - wob), this.look.fat * s * 1.15); this.body.scale.setScalar(1 + (s - 1) * 0.25); if (once('inflate', 0.2)) this.events.push(['inflate']); }
    if (has('tiny')){ const s = 1 - (pw('tiny') > 1 ? 0.85 : 0.68) * clamp((t - 0.3) / 0.6); this.root.scale.setScalar(this.look.size * s); if (once('shrink', 0.3)){ fx.stars(head, 12); this.events.push(['shrink']); } }
    if (has('longNeck')){ const L = 0.06 + (pw('longNeck') > 1 ? 1.2 : 0.75) * elastic(clamp((t - 0.2) / 1.5)); this.neckLen = L; this.neckMesh.scale.y = L; this.head.position.y = L; this.head.rotation.z = Math.sin(this.t * 2) * 0.12 * clamp(t - 1); if (once('stretch', 0.2)) this.events.push(['stretch']); }
    if (has('longNose')){ if (once('nose', 0.2)){ this.nose.visible = false; this.longNose.visible = true; this.events.push(['stretch']); } this.longNose.scale.set(1, 1, 0.1 + (pw('longNose') > 1 ? 0.85 : 0.5) * elastic(clamp((t - 0.2) / 1.2))); }
    if (has('beard')){ if (once('beard', 0.2)){ this.beard.visible = true; this.events.push(['grow']); } const s = clamp((t - 0.2) / 2.2); this.beard.scale.set(0.6 + s * 0.6, 0.05 + s * (pw('beard') > 1 ? 1.25 : 0.85), 1); }
    if (has('bald')){ if (once('bald', 0.35)) this.dropHair(); if (t > 0.4 && t < 3 && Math.random() < dt * 3){ const p = V(); this.head.updateWorldMatrix(true, false); p.set(0.1, 0.46, 0.1).applyMatrix4(this.head.matrixWorld); fx.stars(p, 1, ['#ffffff']); } }
    if (this.fallingHair){
      const F = this.fallingHair, m = F.m;
      F.v.y -= 9.8 * dt; m.position.addScaledVector(F.v, dt); m.rotation.z += F.spin * dt * 0.3; m.rotation.x += F.spin * dt * 0.2;
      if (m.position.y < 0.05){ m.position.y = 0.05; if (Math.abs(F.v.y) > 1){ F.v.y *= -0.35; F.v.x *= 0.6; F.v.z *= 0.6; this.events.push(['plop']); } else { F.v.set(0, 0, 0); F.spin = 0; m.rotation.x = 0; m.rotation.z = Math.PI; } }
    }
    if (has('fire')){
      if (once('fire', 0.3)){ this.setSkin(kit().red); this.events.push(['fire']); }
      if (t > 0.3 && t < 3.4){ const d = V(0, -0.15, 1).applyQuaternion(this.root.quaternion).normalize(); fx.flame(head, d, 2); if (Math.random() < dt * 8) for (const e of this.ears){ const p = V(); e.getWorldPosition(p); fx.smoke(p, 1, '#ffffff', 0.12); } this.mouthO.visible = true; this.mouth.visible = false; }
      else if (t >= 3.4 && !this._fireOut){ this._fireOut = true; this.mouthO.visible = false; this.mouth.visible = true; }
    }
    if (has('zap')){
      if (once('zap', 0.3)){
        const b = new THREE.Mesh(kit().bolt, kit().boltMat); const p = V(); this.top(p); b.position.set(p.x, p.y, p.z); b.scale.set(1.2, 3.2 - p.y, 1); b.rotation.y = Math.random() * 3; this.bolt = this.addExtra(b);
        this.events.push(['zap']); fx.sparks(head, 30);
      }
      if (this.bolt){ this.bolt.visible = t < 0.9 && Math.floor(t * 20) % 2 === 0; }
      if (once('frizz', 0.55)) this.zapHair();
      if (t > 0.5 && Math.random() < dt * 4){ const p = V(); this.top(p); fx.smoke(p, 1, '#5a5a5a', 0.15); }
      if (t > 0.3 && t < 1.1) this.body.position.x = (Math.random() - 0.5) * 0.05;
    }
    if (has('invisible')){
      if (once('vanish', 0.4)){
        fx.stars(head, 16, ['#ffffff', '#c8f0ff']); fx.smoke(head, 6, '#e8f8ff', 0.25); this.events.push(['vanish']);
        for (const o of [this.headMesh, this.neckMesh, this.nose, this.longNose, this.mouth, this.mouthO, this.torso, this.beard, ...this.ears, ...this.blush, ...this.arms.map((a) => a.arm), ...this.arms.map((a) => a.hand), ...this.legs.map((l) => l.leg)]) o.visible = false;
        if (this.hair) this.hair.visible = false;
        this.shadow.visible = false;
        this._invisible = true;
      }
    }
    if (has('float')){
      if (once('float', 0.3)) this.events.push(['inflate']);
      const s = 1 + (pw('float') > 1 ? 0.95 : 0.7) * elastic(clamp((t - 0.3) / 1.0));
      this.shape(this.look.fat * s * 1.15, s * 1.0, this.look.fat * s * 1.1);
      if (t > 1){ this.rise = Math.min(this.rise + dt * 0.35, this.state === 'leave' ? 9 : 1.0); this.root.rotation.z = Math.sin(this.t * 1.6) * 0.08; }
      for (const l of this.legs) l.g.rotation.x = Math.sin(this.t * 3 + l.g.position.x * 20) * 0.3;
      for (const a of this.arms) if (!this.holding) a.g.rotation.z = a.s * (0.6 + Math.sin(this.t * 4) * 0.2);
      if (once('wheee', 1.2)) this.events.push(['wheee']);
    }
    if (has('bouncy')){
      if (t > 0.4){ const ph = (this.t * 2.2) % 1, h = 4 * ph * (1 - ph) * (pw('bouncy') > 1 ? 1.1 : 0.6); this.body.position.y += h; this.body.scale.y = ph < 0.08 || ph > 0.92 ? 0.8 : 1.05; this.body.scale.x = this.body.scale.z = ph < 0.08 || ph > 0.92 ? 1.15 : 0.97; if (ph < this._lastPh) this.events.push(['boing']); this._lastPh = ph; }
    }
    if (has('dance')){
      if (t > 0.3){
        const b = this.t * 7; this.arms[0].g.rotation.z = -(1.8 + Math.sin(b) * 0.6); this.arms[1].g.rotation.z = 1.2 + Math.sin(b + 1.5) * 0.9; this.arms[0].g.rotation.x = 0; if (!this.holding) this.arms[1].g.rotation.x = 0;
        this.body.rotation.z = Math.sin(b * 0.5) * 0.18; this.body.rotation.y = Math.sin(b * 0.25) * 0.8; this.body.position.y += Math.abs(Math.sin(b)) * 0.06;
        if (this.speed < 0.1){ this.legs[0].g.rotation.x = Math.sin(b) * 0.4; this.legs[1].g.rotation.x = -Math.sin(b) * 0.4; }
        if (Math.random() < dt * 3) fx.notes(head.clone().add(V(0, 0.3, 0)), 1);
        if (Math.random() < dt * 6) fx.stars(head.clone().add(V((Math.random() - 0.5) * 1.2, 0.5 + Math.random() * 0.6, (Math.random() - 0.5) * 1.2)), 1, ['#ff4ab8', '#3ad8ff', '#ffe02a']);
      }
    }
    if (has('bug') || has('animal')){
      if (once('transform', 0.45)){ fx.smoke(this.root.position.clone().setY(0.9), 18, '#f0e8ff', 0.4); fx.stars(this.root.position.clone().setY(1.0), 14); this.becomeAlt(has('bug') ? 'bug' : this.animal); this.events.push(['poof']); }
      if (t < 0.45){ const s = 1 + Math.sin(t * 40) * 0.05; this.body.scale.set(s, 1 / s, s); }
      if (once('altsay', 0.9)) this.events.push([has('bug') ? 'bug' : 'animal', this.animal]);
    }
    if (has('explode')){
      if (t < 1.0){ const s = 1 + t * 0.6; this.body.scale.set(s, s, s); this.body.position.x = (Math.random() - 0.5) * 0.06 * t; this.setSkin(Math.floor(t * 12) % 2 ? kit().red : this.skinMat); if (once('fuse', 0.05)) this.events.push(['fuse']); }
      if (once('boom', 1.0)){
        this.boom(); const p = this.root.position.clone().setY(1.0 * this.root.scale.y);
        fx.smoke(p, 26, '#5a5050', 0.55); fx.smoke(p, 12, '#ffb03a', 0.4); fx.confetti(p, 60); fx.sparks(p, 30, ['#ffe03a', '#ff8a1a', '#ffffff']); fx.stars(p, 12);
      }
      if (this.ghost){
        const u = clamp((t - 1.3) / 0.6); this.ghost.scale.setScalar(this.root.scale.x * elastic(u) + 0.001);
        this.ghost.position.y = this.root.position.y + 0.3 + Math.sin(this.t * 2) * 0.06 + this.rise;
        this.ghost.position.x = this.root.position.x; this.ghost.position.z = this.root.position.z;
        this.rise = this.state === 'leave' ? this.rise + dt * 0.5 : Math.min(this.rise + dt * 0.6, 0.85);
        if (Math.random() < dt * 4) for (const s of this.extras.slice(0, 2)) fx.smoke(s.position.clone().setY(0.1), 1, '#7a7070', 0.12);
      }
    }
  }
  // where the person is drawn this frame: floating, shrinking etc. on top of their walking
  place(){
    if (this.rise && !this.ghost) this.body.position.y += this.rise / this.root.scale.y;
    this.shadow.scale.setScalar((this.alt ? 1.1 : 0.7) * (this.swell || 1) * Math.max(0.3, 1 - this.rise * 0.25));
    if (this.alt) this.shadow.scale.z *= 1.4;
  }
  dispose(){
    this.scene.remove(this.root);
    for (const o of this.extras) o.parent && o.parent.remove(o);
    this.extras.length = 0;
  }
}
// the line a customer says after their effect
export function reaction(p, e){
  if (e.id === 'animal') return ANIMAL_SAY[e.animal] || 'Oink!';
  const s = EFFECTS[e.id].say; return s[Math.floor(Math.random() * s.length)];
}
void lerp; void angleDiff;
