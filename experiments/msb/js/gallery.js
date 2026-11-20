// The gallery: a bright main hall with a free-standing wall in the middle, a closed east wing you can
// buy, an entrance onto a little plaza, the art market desk, picture spots on every wall (frames are
// hung there when you hang a picture), decoration spots, and the walls you bump into.
import * as THREE from 'three';
import { V, Batch, textCanvas, roundRect, wrapText, mergeGeometries, boxUV, ellipsoid, paint, placed, rng } from './util.js';

export const H = 5.2;              // ceiling height
export const MAIN = { x0: -14, x1: 14, z0: -10, z1: 10 };
export const WING = { x0: 14.3, x1: 26, z0: -8, z1: 8 };
export const PART = { x0: -5, x1: 5, z0: -0.15, z1: 0.15, h: 3.6 };
export const START = { x: 0, z: 7.5, yaw: 0 };
export const DOOR = { x: 0, z: 10.15 };            // the entrance (visitors come and go here)
export const DESK = { x: -10.2, z: 7.4 };          // the art market desk
const T = 0.3;                                       // wall thickness

// materials (cached by name)
const mats = new Map();
function lam(name, opts){ if (!mats.has(name)){ const m = new THREE.MeshLambertMaterial(opts); m.name = name; mats.set(name, m); } return mats.get(name); }
function bas(name, opts){ if (!mats.has(name)){ const m = new THREE.MeshBasicMaterial(opts); m.name = name; mats.set(name, m); } return mats.get(name); }
function canvasTex(w, h, draw, repeat = true){
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat){ t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}
function woodTex(){
  return canvasTex(512, 512, (g, w, h) => {
    const R = rng(7);
    const planks = 8, ph = h / planks;
    for (let i = 0; i < planks; i++){
      const base = 150 + R() * 40;
      g.fillStyle = `rgb(${base + 40},${base - 10},${base - 70})`; g.fillRect(0, i * ph, w, ph);
      for (let k = 0; k < 40; k++){ g.strokeStyle = `rgba(90,50,20,${0.05 + R() * 0.08})`; g.lineWidth = 1 + R() * 2; const y = i * ph + R() * ph; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + R() * 6 - 3, w * 0.6, y + R() * 6 - 3, w, y); g.stroke(); }
      g.fillStyle = 'rgba(60,30,10,0.55)'; g.fillRect(0, i * ph, w, 2);
      const off = R() * w; g.fillRect(off, i * ph, 2, ph);
    }
  });
}
function stoneTex(){
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#cfc8bc'; g.fillRect(0, 0, w, h);
    const R = rng(3); for (let i = 0; i < 2500; i++){ g.fillStyle = `rgba(${R() < 0.5 ? '255,255,255' : '80,70,60'},${R() * 0.12})`; g.fillRect(R() * w, R() * h, 2, 2); }
    g.strokeStyle = 'rgba(90,80,70,0.35)'; g.lineWidth = 2;
    for (let i = 0; i <= 4; i++){ g.beginPath(); g.moveTo(0, i * h / 4); g.lineTo(w, i * h / 4); g.stroke(); g.beginPath(); g.moveTo(i * w / 4, 0); g.lineTo(i * w / 4, h); g.stroke(); }
  });
}
function grassTex(){
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#6aa64a'; g.fillRect(0, 0, w, h);
    const R = rng(5); for (let i = 0; i < 3000; i++){ g.fillStyle = `rgba(${R() < 0.5 ? '160,210,110' : '40,90,30'},${0.2 + R() * 0.3})`; g.fillRect(R() * w, R() * h, 1.5, 3); }
  });
}

// the picture frame styles you can choose
export const FRAMES = {
  wood: { name: 'Oak', color: '#9a6a3a', w: 0.07, d: 0.05, price: 0 },
  black: { name: 'Black', color: '#1e1e22', w: 0.05, d: 0.045, price: 0 },
  white: { name: 'White', color: '#f2f0ea', w: 0.06, d: 0.045, price: 40 },
  gold: { name: 'Gold', color: '#d8a83a', w: 0.1, d: 0.06, price: 120 },
  neon: { name: 'Neon', color: '#ff3ab8', w: 0.045, d: 0.04, price: 200, glow: true },
  ornate: { name: 'Palace', color: '#c9932a', w: 0.16, d: 0.08, price: 350, ornate: true },
};
function frameMat(id){
  const F = FRAMES[id] || FRAMES.wood;
  if (F.glow) return bas('frame-' + id, { color: F.color });
  return lam('frame-' + id, { color: F.color, emissive: id === 'gold' || id === 'ornate' ? new THREE.Color('#3a2a08') : new THREE.Color(0) });
}

// what you can buy to decorate the gallery
export const DECOR = {
  plant: { name: 'Potted plant', icon: '🪴', price: 40, fame: 1 },
  bench: { name: 'Bench', icon: '🪑', price: 70, fame: 1 },
  sculpture: { name: 'Sculpture', icon: '🗿', price: 180, fame: 3 },
  rug: { name: 'Big rug', icon: '🟥', price: 90, fame: 1 },
  fountain: { name: 'Little fountain', icon: '⛲', price: 300, fame: 4 },
};

export class Gallery {
  constructor(scene){
    this.scene = scene;
    this.root = new THREE.Group(); scene.add(this.root);
    this.walls = [];       // { x0, x1, z0, z1, tall }
    this.slots = [];       // picture spots
    this.decorSpots = [];  // decoration spots
    this.pick = new THREE.Group(); this.root.add(this.pick);   // invisible boxes for pointing at things
    this.flat = [];
    this.wingOpen = false;
    this.build();
  }

  build(){
    const b = new Batch();
    const wood = woodTex(); wood.repeat.set(1 / 2.2, 1 / 2.2);
    const stone = stoneTex(); stone.repeat.set(1 / 3, 1 / 3);
    const grass = grassTex(); grass.repeat.set(1 / 4, 1 / 4);
    const M = {
      wall: lam('wall', { color: '#f4f1ea', emissive: new THREE.Color('#2e2c28') }), outside: lam('outside', { color: '#e4ddd0' }), floor: lam('floor', { map: wood }),
      ceil: lam('ceiling', { color: '#f4f2ee', emissive: new THREE.Color('#9a9790') }), trim: lam('trim', { color: '#5a5650' }), sky: bas('skylight', { color: '#eaf6ff' }),
      plaza: lam('plaza', { map: stone }), grass: lam('grass', { map: grass }), dark: lam('dark', { color: '#2a2a2e' }),
      lamp: bas('lamp', { color: '#fff3c8' }), desk: lam('desk', { color: '#3a3a40' }), deskTop: lam('desk-top', { color: '#d8c8a8' }),
      rope: lam('rope', { color: '#a01a2a' }), brass: lam('brass', { color: '#d8b04a', emissive: new THREE.Color('#2a1a00') }),
      hedge: lam('hedge', { color: '#3f7a32' }), glass: new THREE.MeshLambertMaterial({ color: '#bfe6ff', transparent: true, opacity: 0.25, depthWrite: false }),
    };
    this.M = M;
    // floors (main hall and wing), plaza and grass outside
    b.box(28.6, 0.2, 20.6, M.floor, 0, -0.1, 0, 0, 1);
    b.box(11.7, 0.2, 16, M.floor, (WING.x0 + WING.x1) / 2, -0.1, 0, 0, 1);
    b.box(0.32, 0.2, 4, M.floor, 14.15, -0.1, 0, 0, 1);      // the wing's doorway threshold (between the two floors)
    b.box(36, 0.2, 12.2, M.plaza, 0, -0.12, 16.25, 0, 1);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), M.grass); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.25; ground.receiveShadow = true; this.root.add(ground);
    // walls of the main hall: north, west, south (door gap), east (wing doorway gap)
    const h = H, wy = h / 2;
    const wall = (x0, x1, z0, z1, y0 = 0, y1 = h, mat = M.wall, collide = true) => {
      b.box(x1 - x0, y1 - y0, z1 - z0, mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, 0, 1);
      if (collide && y0 < 1.5) this.walls.push({ x0, x1, z0, z1, tall: true });
    };
    wall(MAIN.x0 - T, MAIN.x1 + T, MAIN.z0 - T, MAIN.z0);                // north
    wall(MAIN.x0 - T, MAIN.x0, MAIN.z0, MAIN.z1 + T);                    // west
    wall(MAIN.x0, -2, MAIN.z1, MAIN.z1 + T); wall(2, MAIN.x1 + T, MAIN.z1, MAIN.z1 + T);   // south, either side of the entrance
    wall(-2, 2, MAIN.z1, MAIN.z1 + T, 3.2, h, M.wall, false);            // over the entrance
    wall(MAIN.x1, MAIN.x1 + T, MAIN.z0, -2); wall(MAIN.x1, MAIN.x1 + T, 2, MAIN.z1);      // east, either side of the wing doorway
    wall(MAIN.x1, MAIN.x1 + T, -2, 2, 3.4, h, M.wall, false);            // over the wing doorway
    // the wing
    wall(WING.x0 - 0.01, WING.x1 + T, WING.z0 - T, WING.z0, 0, h - 0.01);  // north (stops 1 cm short of the hall's walls and ceiling)
    wall(WING.x0 - 0.01, WING.x1 + T, WING.z1, WING.z1 + T, 0, h - 0.01);
    wall(WING.x1, WING.x1 + T, WING.z0, WING.z1, 0, h - 0.01);
    // ceilings, with skylights set 1 cm below them
    b.box(28.6, 0.3, 20.6, M.ceil, 0, h + 0.15, 0, 0, 1);
    b.box(11.7, 0.3, 16.6, M.ceil, (WING.x0 + WING.x1) / 2, h + 0.14, 0, 0, 1);
    for (const x of [-9, 0, 9]) for (const z of [-5, 5]) b.box(5, 0.04, 2.6, M.sky, x, h - 0.03, z, 0, 1);
    b.box(6, 0.04, 2.6, M.sky, 20, h - 0.03, -3.5); b.box(6, 0.04, 2.6, M.sky, 20, h - 0.03, 3.5);
    // the free-standing wall in the middle
    b.box(PART.x1 - PART.x0, PART.h, PART.z1 - PART.z0, M.wall, 0, PART.h / 2, 0, 0, 1);
    b.box(PART.x1 - PART.x0 + 0.02, 0.06, PART.z1 - PART.z0 + 0.02, M.trim, 0, PART.h + 0.03, 0);
    this.walls.push({ x0: PART.x0, x1: PART.x1, z0: PART.z0, z1: PART.z1, tall: true });
    // skirting boards, 1 cm proud of the walls
    const skirt = (x0, x1, z0, z1) => b.box(x1 - x0, 0.12, z1 - z0, M.trim, (x0 + x1) / 2, 0.06, (z0 + z1) / 2);
    skirt(MAIN.x0, MAIN.x1, MAIN.z0, MAIN.z0 + 0.012);
    skirt(MAIN.x0, MAIN.x0 + 0.012, MAIN.z0 + 0.012, MAIN.z1);
    skirt(MAIN.x0 + 0.012, -2, MAIN.z1 - 0.012, MAIN.z1); skirt(2, MAIN.x1, MAIN.z1 - 0.012, MAIN.z1);
    skirt(MAIN.x1 - 0.012, MAIN.x1, MAIN.z0 + 0.012, -2); skirt(MAIN.x1 - 0.012, MAIN.x1, 2, MAIN.z1 - 0.012);
    skirt(PART.x0 - 0.012, PART.x1 + 0.012, PART.z0 - 0.012, PART.z1 + 0.012);
    skirt(WING.x0, WING.x1, WING.z0, WING.z0 + 0.012); skirt(WING.x0, WING.x1, WING.z1 - 0.012, WING.z1); skirt(WING.x1 - 0.012, WING.x1, WING.z0 + 0.012, WING.z1 - 0.012);
    // outside: the building's front, a sign over the door, hedges round the plaza (they keep you in)
    b.box(4.2, 0.1, 0.06, M.trim, 0, 3.25, MAIN.z1 + T + 0.03);
    for (const x of [-1.94, 1.94]) b.box(0.1, 3.19, 0.4, M.trim, x, 1.595, MAIN.z1 + T / 2);   // door posts, 1 cm inside the doorway
    const hedge = (x0, x1, z0, z1) => { b.box(x1 - x0, 1.3, z1 - z0, M.hedge, (x0 + x1) / 2, 0.55, (z0 + z1) / 2); this.walls.push({ x0, x1, z0, z1, tall: true }); };
    hedge(-17, 17, 21.6, 22.4); hedge(-17.8, -17, 10.3, 22.4); hedge(17, 17.8, 10.3, 22.4);
    // track lights over the picture spots go in addSlot; ceiling lamps in the middle
    // the art market desk by the entrance
    b.box(3.2, 1.0, 0.9, M.desk, DESK.x, 0.5, DESK.z); b.box(3.3, 0.05, 1.0, M.deskTop, DESK.x, 1.025, DESK.z);
    this.walls.push({ x0: DESK.x - 1.65, x1: DESK.x + 1.65, z0: DESK.z - 0.5, z1: DESK.z + 0.5, tall: false });
    // the wing's rope barrier (until you buy the wing)
    this.barrier = new THREE.Group();
    const bb = new Batch();
    for (const z of [-1.7, 0, 1.7]){ bb.cyl(0.05, 0.05, 1.0, M.brass, 13.4, 0.5, z, 10); bb.cyl(0.18, 0.18, 0.04, M.brass, 13.4, 0.02, z, 14); bb.add(new THREE.SphereGeometry(0.07, 10, 8), M.brass, new THREE.Matrix4().makeTranslation(13.4, 1.04, z)); }
    for (const z of [-0.85, 0.85]){ const c = new THREE.CatmullRomCurve3([V(13.4, 0.93, z - 0.85), V(13.4, 0.78, z), V(13.4, 0.93, z + 0.85)]); bb.add(new THREE.TubeGeometry(c, 12, 0.025, 6), M.rope); }
    bb.build(this.barrier, { shadows: true });
    this.barrierSign = this.sign('East wing\nopening soon', 'Buy it in the 🛒 shop', 1.1, 0.7, '#3a2a6a');
    this.barrierSign.position.set(13.3, 1.7, 0); this.barrierSign.rotation.y = -Math.PI / 2; this.barrier.add(this.barrierSign);
    this.root.add(this.barrier);
    this.barrierWall = { x0: 13.3, x1: 13.5, z0: -2, z1: 2, tall: true };
    this.walls.push(this.barrierWall);
    // signs: the gallery's name over the entrance (both sides), the desk
    const name = this.sign('MSB GALLERY', 'Make · Sell · Buy', 3.6, 1.0, '#1e1e24');
    name.position.set(0, 4.0, MAIN.z1 + T + 0.02); this.root.add(name);
    const inside = this.sign('MSB GALLERY', 'Make · Sell · Buy', 3.0, 0.85, '#1e1e24');
    inside.position.set(0, 4.1, MAIN.z1 - 0.02); inside.rotation.y = Math.PI; this.root.add(inside);
    const ds = this.sign('🛒 ART MARKET', 'Buy art, frames & decorations', 2.4, 0.7, '#8a2a4a');
    ds.position.set(DESK.x, 2.2, DESK.z + 0.1); this.root.add(ds);
    const ds2 = ds.clone(); ds2.rotation.y = Math.PI; ds2.position.z -= 0.02; this.root.add(ds2);
    this.deskPick = this.addPick(DESK.x, 1.2, DESK.z, 3.3, 2.6, 1.2, { kind: 'desk' });
    // a big cheerful welcome mat at the door
    b.box(3, 0.02, 1.6, lam('mat', { color: '#5a2a3a' }), 0, 0.012, 8.9);
    // glass doors, slid open
    const glass = new THREE.Mesh(boxUV(1.0, 3.1, 0.04), M.glass); glass.position.set(-2.55, 1.55, MAIN.z1 + T + 0.06); this.root.add(glass);
    const glass2 = glass.clone(); glass2.position.x = 2.55; this.root.add(glass2);
    // ceiling lamps in the wing and hall (no real lights: just glowing discs)
    for (const x of [-9, 0, 9]) for (const z of [-8, 8]) if (!(x === 0 && z === 8)) b.cyl(0.35, 0.35, 0.05, M.lamp, x, h - 0.03, z, 18);
    b.build(this.root);
    this.buildTrees();
    this.buildSlots();
    this.buildDecorSpots();
  }

  // a sign: a canvas drawn once, on a plane
  sign(title, sub, w, h, bg){
    const px = 512, tc = textCanvas(px, Math.round(px * h / w)), g = tc.ctx, W = tc.canvas.width, Hh = tc.canvas.height;
    g.fillStyle = bg; roundRect(g, 0, 0, W, Hh, 24); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 6; roundRect(g, 8, 8, W - 16, Hh - 16, 18); g.stroke();
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const lines = title.split('\n'); let fs = Math.min(Hh * (sub ? 0.36 : 0.5) / lines.length * 1.4, 90);
    g.font = `bold ${fs}px Arial`; while (lines.some((l) => g.measureText(l).width > W - 40) && fs > 14){ fs -= 2; g.font = `bold ${fs}px Arial`; }
    lines.forEach((l, i) => g.fillText(l, W / 2, Hh * (sub ? 0.42 : 0.5) + (i - (lines.length - 1) / 2) * fs * 1.05));
    if (sub){ g.font = `${Math.round(fs * 0.48)}px Arial`; g.fillStyle = '#ffe8a8'; g.fillText(sub, W / 2, Hh * 0.8); }
    tc.tex.needsUpdate = true;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tc.tex, toneMapped: false }));
    return m;
  }
  addPick(x, y, z, sx, sy, sz, data, ry = 0){
    const m = new THREE.Mesh(this.pickGeo || (this.pickGeo = new THREE.BoxGeometry(1, 1, 1)), this.pickMat || (this.pickMat = new THREE.MeshBasicMaterial({ visible: false })));
    m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.y = ry; m.userData = data; this.pick.add(m); m.updateMatrixWorld(true);
    return m;
  }

  buildTrees(){
    // round trees on the plaza (one instanced mesh for trunks, one for crowns)
    const spots = [[-14, 14], [-9, 19], [9, 19], [14, 14], [-15.5, 19.5], [15.5, 19.5], [-5, 20], [5, 20]];
    const trunkG = new THREE.CylinderGeometry(0.12, 0.18, 2.2, 8).translate(0, 1.1, 0);
    const crownG = mergeGeometries([placed(ellipsoid(1.3, 1.1, 1.3, 12, 8), 0, 2.9, 0), placed(ellipsoid(0.9, 0.8, 0.9, 10, 7), 0.6, 3.5, 0.3)]);
    const trunks = new THREE.InstancedMesh(trunkG, lam('trunk', { color: '#6a4a2a' }), spots.length);
    const crowns = new THREE.InstancedMesh(crownG, lam('crown', { color: '#4a9a3a' }), spots.length);
    const m = new THREE.Matrix4();
    spots.forEach(([x, z], i) => { const s = 0.85 + (i % 3) * 0.15; m.compose(V(x, -0.02, z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), i), V(s, s, s)); trunks.setMatrixAt(i, m); crowns.setMatrixAt(i, m); this.walls.push({ x0: x - 0.25, x1: x + 0.25, z0: z - 0.25, z1: z + 0.25, tall: false }); });
    trunks.castShadow = crowns.castShadow = true;
    this.root.add(trunks, crowns);
  }

  // ---------- picture spots ----------
  // each: a place on a wall (centre at eye height), the way it faces, where to stand to look at it
  buildSlots(){
    const add = (x, z, ry, wing = false, w = 1.8) => {
      const n = V(Math.sin(ry), 0, Math.cos(ry));
      const s = { i: this.slots.length, pos: V(x, 1.65, z), ry, n, wing, maxW: w, maxH: 1.4, view: V(x + n.x * 2.4, 0, z + n.z * 2.4), art: null, group: null };
      this.slots.push(s);
      s.pickBox = this.addPick(x + n.x * 0.1, 1.65, z + n.z * 0.1, w + 0.2, 1.7, 0.25, { kind: 'slot', slot: s }, ry);
    };
    // main hall: north wall (5), west wall (3), east wall (2), south wall (2), the middle wall (2 each side)
    for (const x of [-10.5, -5.25, 0, 5.25, 10.5]) add(x, MAIN.z0 + 0.005, 0);
    for (const z of [-6, 0, 6]) add(MAIN.x0 + 0.005, z, Math.PI / 2);
    for (const z of [-6, 6]) add(MAIN.x1 - 0.005, z, -Math.PI / 2);
    for (const x of [-8, 8]) add(x, MAIN.z1 - 0.005, Math.PI);
    for (const x of [-2.5, 2.5]){ add(x, PART.z0 - 0.005, Math.PI, false, 1.6); add(x, PART.z1 + 0.005, 0, false, 1.6); }
    this.mainSlots = this.slots.length;
    // the wing: north (3), south (3), east (2)
    for (const x of [16.8, 20.2, 23.6]){ add(x, WING.z0 + 0.005, 0, true); add(x, WING.z1 - 0.005, Math.PI, true); }
    for (const z of [-3.2, 3.2]) add(WING.x1 - 0.005, z, -Math.PI / 2, true);
    // shared pieces: the empty-spot outline, the track light over each spot
    const outline = canvasTex(256, 200, (g, w, h) => {
      g.clearRect(0, 0, w, h); g.setLineDash([16, 12]); g.lineWidth = 6; g.strokeStyle = 'rgba(120,110,150,0.55)'; roundRect(g, 6, 6, w - 12, h - 12, 12); g.stroke();
      g.fillStyle = 'rgba(120,110,150,0.6)'; g.font = 'bold 30px Arial'; g.textAlign = 'center'; g.fillText('＋ hang a', w / 2, h / 2 - 6); g.fillText('picture here', w / 2, h / 2 + 30);
    }, false);
    this.emptyMat = new THREE.MeshBasicMaterial({ map: outline, transparent: true, depthWrite: false });
    this.emptyGeo = new THREE.PlaneGeometry(1.3, 1.0);
    const lights = new Batch();
    for (const s of this.slots){
      const e = new THREE.Mesh(this.emptyGeo, this.emptyMat);
      e.position.copy(s.pos).addScaledVector(s.n, 0.012); e.rotation.y = s.ry; this.root.add(e); s.empty = e;
      e.visible = !s.wing;
      // a little lamp on an arm above the spot, pointing down at it
      const top = s.pos.clone().addScaledVector(s.n, 0.0); top.y = 2.75;
      const arm = new THREE.Matrix4().compose(top.clone().addScaledVector(s.n, 0.22), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s.ry, 0)), V(1, 1, 1));
      lights.add(new THREE.BoxGeometry(0.04, 0.04, 0.44), this.M.trim, arm);
      lights.add(new THREE.CylinderGeometry(0.06, 0.09, 0.2, 10), this.M.dark, new THREE.Matrix4().compose(top.clone().addScaledVector(s.n, 0.44), new THREE.Quaternion().setFromEuler(new THREE.Euler(s.n.z * 0.6, 0, -s.n.x * 0.6)), V(1, 1, 1)));
      lights.add(new THREE.CircleGeometry(0.07, 12).rotateX(Math.PI / 2), this.M.lamp, new THREE.Matrix4().compose(top.clone().addScaledVector(s.n, 0.44).add(V(0, -0.101, 0)), new THREE.Quaternion().setFromEuler(new THREE.Euler(s.n.z * 0.6, 0, -s.n.x * 0.6)), V(1, 1, 1)));
    }
    // a soft pool of light on the wall over each spot (one shared texture, drawn without lighting)
    const pool = canvasTex(128, 128, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h * 0.2, 4, w / 2, h * 0.35, w * 0.6); gr.addColorStop(0, 'rgba(255,240,200,0.3)'); gr.addColorStop(1, 'rgba(255,240,200,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, false);
    this.poolMat = new THREE.MeshBasicMaterial({ map: pool, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const poolGeo = new THREE.PlaneGeometry(2.6, 2.6);
    for (const s of this.slots){ const p = new THREE.Mesh(poolGeo, this.poolMat); p.position.copy(s.pos).addScaledVector(s.n, 0.006); p.position.y = 1.95; p.rotation.y = s.ry; p.renderOrder = 1; this.root.add(p); s.pool = p; p.visible = !s.wing; }
    this.lightMeshes = lights.build(this.root, { shadows: false });
    this.frameGeoCache = new Map();
    this.picGeo = new THREE.PlaneGeometry(1, 1); this.picGeo.userData.keep = true;
  }
  slotOpen(s){ return !s.wing || this.wingOpen; }
  openWing(on = true){
    this.wingOpen = on;
    this.barrier.visible = !on;
    const i = this.walls.indexOf(this.barrierWall);
    if (on && i >= 0) this.walls.splice(i, 1);
    if (!on && i < 0) this.walls.push(this.barrierWall);
    for (const s of this.slots) if (s.wing){ s.empty.visible = on && !s.art; s.pool.visible = on; }
    for (const d of this.decorSpots) if (d.wing && d.mesh) d.mesh.visible = on;
  }

  // hang a picture (a canvas) in a spot, framed; returns its size on the wall
  hang(s, art, canvas, label){
    this.unhang(s);
    const F = FRAMES[art.frame] || FRAMES.wood;
    const asp = canvas.width / canvas.height;
    let w = s.maxW, h = w / asp; if (h > s.maxH){ h = s.maxH; w = h * asp; }
    const g = new THREE.Group();
    g.position.copy(s.pos); g.rotation.y = s.ry;
    // the picture: a texture no bigger than 512 px, drawn without lighting so its colours stay true
    const k = Math.min(1, 512 / Math.max(canvas.width, canvas.height)), c = document.createElement('canvas');
    c.width = Math.round(canvas.width * k); c.height = Math.round(canvas.height * k); c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const pic = new THREE.Mesh(this.picGeo, new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    pic.scale.set(w, h, 1); pic.position.z = F.d * 0.5 + 0.004;   // set into the frame, 4 mm in front of its back
    g.add(pic);
    // the frame: four bars (one shape per size and style, rebuilt when a new size is needed)
    const fg = this.frameGeo(w, h, F);
    const frame = new THREE.Mesh(fg, frameMat(art.frame)); frame.castShadow = true; g.add(frame);
    // the label beside it
    if (!s.label){
      s.label = textCanvas(256, 128);
      s.labelMesh = new THREE.Mesh(this.labelGeo || (this.labelGeo = new THREE.PlaneGeometry(0.34, 0.17)), new THREE.MeshBasicMaterial({ map: s.label.tex, toneMapped: false }));
    }
    this.drawLabel(s, label);
    s.labelMesh.position.set(w / 2 + F.w + 0.3, -0.25, 0.008);
    g.add(s.labelMesh);
    this.root.add(g);
    g.updateMatrixWorld(true);
    s.group = g; s.pic = pic; s.tex = tex; s.frame = frame; s.art = art; s.size = [w, h];
    s.empty.visible = false;
    return [w, h];
  }
  frameGeo(w, h, F){
    const key = `${w.toFixed(3)}x${h.toFixed(3)}:${F.w}:${F.d}:${F.ornate ? 1 : 0}`;
    if (this.frameGeoCache.has(key)) return this.frameGeoCache.get(key);
    const fw = F.w, d = F.d, parts = [];
    const bar = (sx, sy, x, y) => parts.push(placed(boxUV(sx, sy, d), x, y, d / 2));
    bar(w + fw * 2, fw, 0, h / 2 + fw / 2); bar(w + fw * 2, fw, 0, -h / 2 - fw / 2);
    bar(fw, h, -w / 2 - fw / 2, 0); bar(fw, h, w / 2 + fw / 2, 0);
    if (F.ornate){
      // a raised inner moulding and corner rosettes
      const i = 0.03, dd = d + 0.02;
      const ib = (sx, sy, x, y) => parts.push(placed(boxUV(sx, sy, 0.02), x, y, dd - 0.01));
      ib(w + fw * 1.2, i, 0, h / 2 + fw * 0.55); ib(w + fw * 1.2, i, 0, -h / 2 - fw * 0.55);
      ib(i, h + fw * 1.1 - i * 2, -w / 2 - fw * 0.55, 0); ib(i, h + fw * 1.1 - i * 2, w / 2 + fw * 0.55, 0);
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) parts.push(placed(new THREE.SphereGeometry(fw * 0.42, 10, 8), sx * (w / 2 + fw / 2), sy * (h / 2 + fw / 2), d + 0.01));
    }
    const g = mergeGeometries(parts);
    // the frame's back sits 1 cm off the wall
    g.translate(0, 0, 0.01);
    if (this.frameGeoCache.size > 40){ const [k0, g0] = this.frameGeoCache.entries().next().value; if (!this.inUse(g0)){ g0.dispose(); this.frameGeoCache.delete(k0); } }
    this.frameGeoCache.set(key, g);
    return g;
  }
  inUse(g){ return this.slots.some((s) => s.frame && s.frame.geometry === g); }
  unhang(s){
    if (!s.group) return;
    this.root.remove(s.group);
    s.group.remove(s.labelMesh);
    s.pic.material.dispose(); s.tex.dispose();
    s.group = s.pic = s.tex = s.frame = null; s.art = null;
    s.empty.visible = this.slotOpen(s);
  }
  drawLabel(s, L){
    const g = s.label.ctx;
    g.fillStyle = '#fbfaf6'; g.fillRect(0, 0, 256, 128);
    g.strokeStyle = '#c8c0b0'; g.lineWidth = 3; g.strokeRect(2, 2, 252, 124);
    g.fillStyle = '#222'; g.textAlign = 'left'; g.textBaseline = 'top';
    g.font = 'bold 24px Arial'; const t = wrapText(g, L.title, 232).slice(0, 2); t.forEach((l, i) => g.fillText(l, 12, 10 + i * 26));
    g.font = 'italic 19px Georgia'; g.fillStyle = '#555'; g.fillText(L.artist, 12, 12 + t.length * 26);
    g.font = 'bold 22px Arial'; g.fillStyle = L.forSale ? '#1a7a3a' : '#7a4a9a'; g.fillText(L.price, 12, 96);
    if (L.sold){ g.fillStyle = '#d0202a'; g.beginPath(); g.arc(228, 104, 13, 0, 7); g.fill(); }
    s.label.tex.needsUpdate = true;
  }

  // ---------- decorations ----------
  buildDecorSpots(){
    const add = (kind, x, z, ry = 0, wing = false) => this.decorSpots.push({ i: this.decorSpots.length, kind, pos: V(x, 0, z), ry, wing, mesh: null });
    add('plant', -13.2, -9.2); add('plant', 13.2, -9.2); add('plant', -13.2, 9.2); add('plant', 3.0, 9.0); add('plant', 25.2, -7.2, 0, true); add('plant', 25.2, 7.2, 0, true);
    add('bench', 0, -5.6, 0); add('bench', 0, 4.6, Math.PI); add('bench', -9.5, -1.6, Math.PI / 2); add('bench', 20.2, 0, 0, true);
    add('sculpture', -9.5, 3.6); add('sculpture', 9.0, -3.0); add('sculpture', 9.0, 3.6); add('sculpture', 17.5, 0, 0, true);
    add('rug', 0, -5.0); add('rug', 20.2, 0, Math.PI / 2, true);
    add('fountain', 0, 15.5);
  }
  freeSpot(kind){ return this.decorSpots.find((d) => d.kind === kind && !d.mesh && (!d.wing || this.wingOpen)); }
  placeDecor(spot){
    const m = this.decorMesh(spot.kind, spot.i);
    m.position.copy(spot.pos); m.rotation.y = spot.ry;
    this.root.add(m); m.updateMatrixWorld(true);
    spot.mesh = m;
    const r = { plant: 0.4, bench: 0, sculpture: 0.5, rug: 0, fountain: 1.4 }[spot.kind];
    if (spot.kind === 'bench'){ const along = Math.abs(Math.sin(spot.ry)) > 0.5; this.walls.push(spot.wall = along ? { x0: spot.pos.x - 0.3, x1: spot.pos.x + 0.3, z0: spot.pos.z - 1.0, z1: spot.pos.z + 1.0, tall: false } : { x0: spot.pos.x - 1.0, x1: spot.pos.x + 1.0, z0: spot.pos.z - 0.3, z1: spot.pos.z + 0.3, tall: false }); }
    else if (r) this.walls.push(spot.wall = { x0: spot.pos.x - r, x1: spot.pos.x + r, z0: spot.pos.z - r, z1: spot.pos.z + r, tall: false });
    spot.pickBox = this.addPick(spot.pos.x, 0.6, spot.pos.z, 1.2, 1.2, 1.2, { kind: 'decor', spot });
    return m;
  }
  // the shapes of each decoration are made once and shared by every copy
  decorMesh(kind, seed){
    this.decorGeo = this.decorGeo || {};
    if (!this.decorGeo[kind]){
      const parts = [];
      const C = (g, col) => parts.push(paint(g, col));
      if (kind === 'plant'){
        C(new THREE.CylinderGeometry(0.28, 0.2, 0.5, 14).translate(0, 0.25, 0), '#c8643a');
        C(new THREE.CylinderGeometry(0.29, 0.29, 0.05, 14).translate(0, 0.5, 0), '#a8502a');
        const R = rng(11);
        for (let i = 0; i < 9; i++){ const a = i / 9 * 6.28, l = 0.5 + R() * 0.4; C(placed(ellipsoid(0.09, l / 2, 0.035, 8, 6), Math.cos(a) * 0.15, 0.5 + l / 2, Math.sin(a) * 0.15, Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45), i % 2 ? '#3a8a3a' : '#4aa04a'); }
      } else if (kind === 'bench'){
        C(boxUV(2.0, 0.08, 0.6).translate(0, 0.45, 0), '#9a6a3a');
        for (const x of [-0.85, 0.85]) C(boxUV(0.08, 0.45, 0.55).translate(x, 0.225, 0), '#2a2a2e');
      } else if (kind === 'sculpture'){
        C(boxUV(0.8, 1.0, 0.8).translate(0, 0.5, 0), '#f2f0ea');
        C(new THREE.TorusKnotGeometry(0.22, 0.07, 64, 10).translate(0, 1.38, 0), '#d8b04a');
      } else if (kind === 'rug'){
        C(boxUV(4.4, 0.012, 2.4).translate(0, 0.007, 0), '#8a2a3a');
        C(boxUV(4.0, 0.012, 2.0).translate(0, 0.009, 0), '#c8a060');   // 2 mm above, and smaller (inset border)
        C(boxUV(3.6, 0.012, 1.6).translate(0, 0.011, 0), '#3a4a7a');
      } else if (kind === 'fountain'){
        const ring = new THREE.TorusGeometry(1.3, 0.16, 8, 32).rotateX(Math.PI / 2).translate(0, 0.25, 0);
        C(ring, '#cfc8bc');
        C(new THREE.CylinderGeometry(1.25, 1.25, 0.2, 32).translate(0, 0.12, 0), '#4aa8e0');
        C(new THREE.CylinderGeometry(0.12, 0.2, 1.1, 12).translate(0, 0.6, 0), '#cfc8bc');
        C(new THREE.CylinderGeometry(0.55, 0.3, 0.14, 20).translate(0, 1.15, 0), '#cfc8bc');
        C(ellipsoid(0.12, 0.35, 0.12, 10, 8).translate(0, 1.5, 0), '#8ad0ff');
      }
      const g = mergeGeometries(parts); g.userData.keep = true;
      this.decorGeo[kind] = g;
    }
    const m = new THREE.Mesh(this.decorGeo[kind], this.decorMat || (this.decorMat = lam('decor', { vertexColors: true })));
    m.castShadow = kind !== 'rug'; m.receiveShadow = true;
    if (kind === 'sculpture') m.rotation.y = seed;
    return m;
  }

  // ---------- bumping into things ----------
  // push a circle (radius r) out of the walls; low things (benches, the desk) only stop the stick
  collide(p, r, low = true){
    for (let k = 0; k < 2; k++) for (const w of this.walls){
      if (!w.tall && !low) continue;
      const cx = Math.max(w.x0, Math.min(p.x, w.x1)), cz = Math.max(w.z0, Math.min(p.z, w.z1));
      const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-9){ const d = Math.sqrt(d2); p.x = cx + dx / d * r; p.z = cz + dz / d * r; }
      else {
        // inside the box: out the nearest side
        const o = [[p.x - w.x0 + r, -1, 0], [w.x1 - p.x + r, 1, 0], [p.z - w.z0 + r, 0, -1], [w.z1 - p.z + r, 0, 1]].sort((a, b) => a[0] - b[0])[0];
        p.x += o[1] * o[0]; p.z += o[2] * o[0];
      }
    }
  }
  // which room a point is in
  where(x, z){ if (x > MAIN.x1 + 0.1) return 'wing'; if (z > MAIN.z1 + 0.1) return 'plaza'; return 'main'; }
  // the path for a visitor from a to b (around the middle wall, through the doorways)
  route(a, b){
    const pts = [];
    const ra = this.where(a.x, a.z), rb = this.where(b.x, b.z);
    let cur = a;
    const go = (p) => { pts.push(p); cur = p; };
    const main = (to) => {
      // around the free-standing wall if the straight line crosses it
      const dz = to.z - cur.z;
      if (Math.abs(dz) > 1e-6){
        const t = -cur.z / dz, x = cur.x + (to.x - cur.x) * t;
        if (t > 0 && t < 1 && x > PART.x0 - 0.8 && x < PART.x1 + 0.8){
          const ex = x < 0 ? PART.x0 - 1.4 : PART.x1 + 1.4;
          go(V(ex, 0, cur.z > 0 ? 1.2 : -1.2)); go(V(ex, 0, cur.z > 0 ? -1.2 : 1.2));
        }
      }
      go(to);
    };
    const inDoor = V(0, 0, MAIN.z1 - 1.2), outDoor = V(0, 0, MAIN.z1 + 1.2), wIn = V(MAIN.x1 - 1.2, 0, 0), wOut = V(WING.x0 + 1.0, 0, 0);
    if (ra === 'plaza'){ go(outDoor); go(inDoor); }
    if (ra === 'wing' && rb !== 'wing'){ go(wOut); go(wIn); }
    if (rb === 'wing' && ra !== 'wing'){ main(wIn); go(wOut); go(b.clone()); return pts; }
    if (rb === 'plaza'){ main(inDoor); go(outDoor); go(b.clone()); return pts; }
    if (rb === 'wing'){ go(b.clone()); return pts; }
    main(b.clone());
    return pts;
  }
}
