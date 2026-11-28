// The shop: Dr. Mad's Ice Cream Lab. A cartoon parlour (checkerboard floor, mint and pink walls, a
// sign over the windows, a street outside) with a mad laboratory behind the counter (a crackling Tesla
// coil, a bubbling vat, flasks, a chalkboard of formulas). On the counter: the tubs of base flavours,
// the cone holder, the serve bell, the bin, and two stepped racks of labelled ingredient jars.
// Static scenery is merged into one mesh per material (Batch); the jars are instanced.
import * as THREE from 'three';
import { V, Batch, toon, keep, textCanvas, roundRect, wrapText, rng, mergeGeometries, paint, ellipsoid } from './util.js';
import { INGREDIENTS, BASES } from './recipes.js';

export const TOP = 0.95;                                   // the counter top
export const CONE_AT = V(0, TOP + 0.045, -0.54);           // where the cone stands
export const ROOM = { x0: -5, x1: 5, z0: -9, z1: 2.6, h: 3.2 };
export const DOOR = V(2.6, 0, -9);
export const QUEUE = [V(0, 0, -1.55), V(0.1, 0, -2.55), V(-0.1, 0, -3.5), V(0.1, 0, -4.45), V(0, 0, -5.4), V(0.2, 0, -6.35)];
export const SKYLIGHT = V(0, ROOM.h, -3);
export const PLAYER_BOX = { x0: -2.4, x1: 2.4, z0: -0.15, z1: 1.6 };
const JAR_R = 0.07, JAR_H = 0.18;

function canvasTex(w, h, draw, { repeat = false, srgb = true } = {}){
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat){ t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4; return t;
}
const sign = (w, h, draw) => canvasTex(w, h, draw);

export class World {
  constructor(scene){
    this.scene = scene;
    const root = this.root = new THREE.Group(); scene.add(root);
    const B = new Batch();
    // ---------- materials ----------
    const floorTex = canvasTex(256, 256, (g) => { for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++){ g.fillStyle = (i + j) % 2 ? '#ff9ac0' : '#fff4e0'; g.fillRect(i * 128, j * 128, 128, 128); } g.strokeStyle = 'rgba(0,0,0,0.08)'; g.lineWidth = 3; g.strokeRect(0, 0, 256, 256); g.strokeRect(128, 0, 0, 256); }, { repeat: true });
    const wallTex = canvasTex(512, 512, (g) => {
      // 3.2 m tall: pink stripes up to 1.1 m, a rail, mint with big dots above
      g.fillStyle = '#a8f0d8'; g.fillRect(0, 0, 512, 512);
      g.fillStyle = 'rgba(255,255,255,0.55)'; for (let y = 30; y < 330; y += 70) for (let x = (y / 70) % 2 ? 35 : 0; x < 520; x += 70){ g.beginPath(); g.arc(x, y, 9, 0, 7); g.fill(); }
      const y1 = 512 * (1 - 1.1 / 3.2);
      for (let x = 0; x < 512; x += 64){ g.fillStyle = '#ff8ab8'; g.fillRect(x, y1, 32, 512 - y1); g.fillStyle = '#ffc0d8'; g.fillRect(x + 32, y1, 32, 512 - y1); }
      g.fillStyle = '#ffffff'; g.fillRect(0, y1 - 10, 512, 16); g.fillStyle = '#e87aa8'; g.fillRect(0, y1 + 4, 512, 4);
    }, { repeat: true });
    const counterTex = canvasTex(256, 256, (g) => { for (let x = 0; x < 256; x += 64){ g.fillStyle = '#ff5a8a'; g.fillRect(x, 0, 32, 256); g.fillStyle = '#ffffff'; g.fillRect(x + 32, 0, 32, 256); } }, { repeat: true });
    const M = this.M = {
      floor: toon('floor', '#ffffff', { map: floorTex }),
      wall: toon('wall', '#ffffff', { map: wallTex }),
      ceiling: toon('ceiling', '#fff8ec'),
      trim: toon('trim', '#ffffff'),
      counter: toon('counter', '#ffffff', { map: counterTex }),
      top: toon('counter-top', '#f4f8ff'),
      wood: toon('wood', '#c8844a'),
      drawer: toon('drawer', '#b8f0e0'),
      dark: toon('dark', '#3a3440'),
      metal: toon('metal', '#b8c0d0'),
      brass: toon('brass', '#ffc83a'),
      red: toon('red', '#ff3a4a'),
      lab: toon('lab-bench', '#5a6a7a'),
      board: toon('chalk', '#2a4a3a'),
      goo: toon('goo', '#6aff3a', { emissive: '#2a8a10' }),
      purple: toon('purple-goo', '#c050ff', { emissive: '#5a1a8a' }),
      blue: toon('blue-goo', '#3ad8ff', { emissive: '#105a8a' }),
      glass: new THREE.MeshPhongMaterial({ color: '#e8f8ff', transparent: true, opacity: 0.3, shininess: 120, specular: '#ffffff', depthWrite: false }),
    };
    M.glass.name = 'glass';
    // ---------- the room ----------
    const R = ROOM, H = R.h;
    const floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(R.x1 - R.x0, R.z1 - R.z0).rotateX(-Math.PI / 2)), M.floor);
    floor.position.set((R.x0 + R.x1) / 2, 0, (R.z0 + R.z1) / 2);
    { const uv = floor.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (R.x1 - R.x0) / 1.0, uv.getY(i) * (R.z1 - R.z0) / 1.0); }
    root.add(floor);
    // walls: the texture is placed by height in the world (pink stripes up to 1.1 m on every piece)
    const wallBox = (sx, sy, sz, x, y, z) => {
      const g = new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z), p = g.attributes.position, nn = g.attributes.normal, uv = g.attributes.uv;
      for (let i = 0; i < p.count; i++){ const u = Math.abs(nn.getX(i)) > 0.5 ? p.getZ(i) : p.getX(i); uv.setXY(i, u / H, Math.abs(nn.getY(i)) > 0.5 ? p.getZ(i) / H : p.getY(i) / H); }
      B.add(g, M.wall);
    };
    wallBox(0.2, H, R.z1 - R.z0 + 0.4, R.x0 - 0.1, H / 2, (R.z0 + R.z1) / 2);
    wallBox(0.2, H, R.z1 - R.z0 + 0.4, R.x1 + 0.1, H / 2, (R.z0 + R.z1) / 2);
    wallBox(R.x1 - R.x0, H, 0.2, 0, H / 2, R.z1 + 0.1);
    // the front wall, with two windows and the door
    const fz = R.z0 - 0.1, seg = (x0, x1, y0, y1) => wallBox(x1 - x0, y1 - y0, 0.2, (x0 + x1) / 2, (y0 + y1) / 2, fz);
    const WIN = [[-3.6, -1.4], [-0.9, 1.3]], DX = [2.1, 3.1], WY = [0.85, 2.3], DH = 2.25;
    seg(R.x0, WIN[0][0], 0, H); seg(WIN[0][1], WIN[1][0], 0, H); seg(WIN[1][1], DX[0], 0, H); seg(DX[1], R.x1, 0, H);
    for (const [a, b] of WIN){ seg(a, b, 0, WY[0]); seg(a, b, WY[1], H); }
    seg(DX[0], DX[1], DH, H);
    // window frames (they stand 2 cm proud of the wall on both sides) and the door frame
    for (const [a, b] of WIN){
      const cx = (a + b) / 2, w = b - a;
      B.box(w + 0.16, 0.08, 0.24, M.trim, cx, WY[0] - 0.02, fz); B.box(w + 0.16, 0.08, 0.24, M.trim, cx, WY[1] + 0.02, fz);
      B.box(0.08, WY[1] - WY[0] - 0.04, 0.24, M.trim, a + 0.02, (WY[0] + WY[1]) / 2, fz); B.box(0.08, WY[1] - WY[0] - 0.04, 0.24, M.trim, b - 0.02, (WY[0] + WY[1]) / 2, fz);
      B.box(0.04, WY[1] - WY[0] - 0.1, 0.06, M.trim, cx, (WY[0] + WY[1]) / 2, fz); B.box(w - 0.1, 0.04, 0.06, M.trim, cx, (WY[0] + WY[1]) / 2, fz);
    }
    B.box(0.1, DH, 0.26, M.trim, DX[0] + 0.03, DH / 2, fz); B.box(0.1, DH, 0.26, M.trim, DX[1] - 0.03, DH / 2, fz); B.box(1.12, 0.1, 0.26, M.trim, (DX[0] + DX[1]) / 2, DH + 0.03, fz);
    // the ceiling, with an open skylight over the queue (balloons and ghosts float out of it)
    const S = SKYLIGHT, sw = 0.75;
    const ceil = (x0, x1, z0, z1) => B.box(x1 - x0, 0.2, z1 - z0, M.ceiling, (x0 + x1) / 2, H + 0.1, (z0 + z1) / 2);
    ceil(R.x0 - 0.2, R.x1 + 0.2, S.z + sw, R.z1 + 0.2); ceil(R.x0 - 0.2, R.x1 + 0.2, R.z0 - 0.2, S.z - sw);
    ceil(R.x0 - 0.2, S.x - sw, S.z - sw, S.z + sw); ceil(S.x + sw, R.x1 + 0.2, S.z - sw, S.z + sw);
    for (const s of [-1, 1]){ B.box(sw * 2 + 0.2, 0.38, 0.1, M.trim, S.x, H + 0.03, S.z + s * (sw + 0.04)); B.box(0.1, 0.38, sw * 2 - 0.02, M.trim, S.x + s * (sw + 0.04), H + 0.03, S.z); }
    this.skyHole = new THREE.Mesh(keep(new THREE.PlaneGeometry(sw * 2 + 0.4, sw * 2 + 0.4).rotateX(Math.PI / 2)), new THREE.MeshBasicMaterial({ map: canvasTex(128, 128, (g) => { const gr = g.createLinearGradient(0, 0, 128, 128); gr.addColorStop(0, '#5ab8ff'); gr.addColorStop(1, '#a8e0ff'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); g.fillStyle = '#fff'; for (const [x, y, r] of [[40, 50, 18], [60, 46, 22], [82, 54, 16]]){ g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); } }) }));
    this.skyHole.position.set(S.x, H + 1.2, S.z); root.add(this.skyHole);
    // the street outside (through the windows and the door)
    const street = new THREE.Mesh(keep(new THREE.PlaneGeometry(16, 7)), new THREE.MeshBasicMaterial({ map: canvasTex(1024, 448, (g, w, h) => {
      const sky = g.createLinearGradient(0, 0, 0, h * 0.7); sky.addColorStop(0, '#4aa8ff'); sky.addColorStop(1, '#c8ecff'); g.fillStyle = sky; g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff'; for (const [x, y] of [[120, 70], [420, 40], [760, 90], [930, 50]]) for (const [dx, dy, r] of [[0, 0, 26], [28, -8, 32], [58, 2, 24]]){ g.beginPath(); g.arc(x + dx, y + dy, r, 0, 7); g.fill(); }
      const houses = ['#ffb84a', '#7ad8ff', '#ff8ab0', '#b8f07a', '#c8a0ff', '#ffe07a'];
      for (let i = 0; i < 9; i++){ const x = i * 118 - 20, hh = 120 + (i * 37) % 70; g.fillStyle = houses[i % houses.length]; g.fillRect(x, h * 0.62 - hh, 104, hh); g.fillStyle = '#7a3a2a'; g.beginPath(); g.moveTo(x - 8, h * 0.62 - hh); g.lineTo(x + 52, h * 0.62 - hh - 46); g.lineTo(x + 112, h * 0.62 - hh); g.fill(); g.fillStyle = '#ffffffcc'; g.fillRect(x + 18, h * 0.62 - hh + 24, 26, 26); g.fillRect(x + 60, h * 0.62 - hh + 24, 26, 26); }
      g.fillStyle = '#5ab84a'; for (let i = 0; i < 7; i++){ g.beginPath(); g.arc(60 + i * 150, h * 0.6, 34, 0, 7); g.fill(); }
      g.fillStyle = '#c8c0b8'; g.fillRect(0, h * 0.62, w, h * 0.12); g.fillStyle = '#4a4a52'; g.fillRect(0, h * 0.74, w, h * 0.26);
      g.fillStyle = '#ffe04a'; for (let x = 0; x < w; x += 90) g.fillRect(x, h * 0.86, 50, 8);
    }) }));
    street.position.set(0, 2.2, R.z0 - 2.6); root.add(street);
    // the door: swings open when someone comes or goes
    this.door = new THREE.Group(); this.door.position.set(DX[0] + 0.06, 0, R.z0 - 0.02); root.add(this.door);
    const leaf = new THREE.Mesh(keep(mergeGeometries([paint(new THREE.BoxGeometry(0.86, 2.14, 0.05).translate(0.45, 1.08, 0), '#ff6a9a'), paint(new THREE.BoxGeometry(0.6, 0.9, 0.06).translate(0.45, 1.5, 0), '#c8f0ff'), paint(new THREE.SphereGeometry(0.035, 8, 6).translate(0.8, 1.05, 0.05), '#ffc83a')])), toon('vc-door', '#ffffff', { vertexColors: true }));
    this.door.add(leaf); this.doorOpen = 0; this.doorWant = 0;
    // ---------- the counter ----------
    const CZ0 = -1.14, CZ1 = -0.38, CX = 2.6;
    B.box(CX * 2 - 0.1, TOP - 0.09, (CZ1 - CZ0) - 0.08, M.counter, 0, (TOP - 0.09) / 2, (CZ0 + CZ1) / 2, 0, 1 / 1.2);
    B.box(CX * 2, 0.09, CZ1 - CZ0, M.top, 0, TOP - 0.045, (CZ0 + CZ1) / 2);
    // your side of the counter: drawers and cupboards (each front stands 2 cm proud, with a knob)
    for (let i = 0; i < 8; i++){
      const x = -CX + 0.05 + 0.32 + i * 0.645, top = i % 3 === 1;
      if (top){ for (const [y, h] of [[0.62, 0.2], [0.38, 0.2], [0.14, 0.2]]){ B.box(0.6, h, 0.02, M.drawer, x, y, CZ1 - 0.03); B.box(0.12, 0.025, 0.03, M.brass, x, y + 0.03, CZ1 - 0.01); } }
      else { B.box(0.6, 0.7, 0.02, M.drawer, x, 0.42, CZ1 - 0.03); B.cyl(0.022, 0.022, 0.03, M.brass, x + 0.22, 0.6, CZ1 - 0.01, 8, Math.PI / 2); }
    }
    // the jar racks: three steps on each end of the counter
    const RX = [0.82, 1.84];
    for (const s of [-1, 1]){
      const cx = s * (RX[0] + RX[1]) / 2, w = RX[1] - RX[0];
      B.box(w, 0.13, 0.48, M.wood, cx, TOP + 0.065, -0.88);
      B.box(w, 0.26, 0.24, M.wood, cx, TOP + 0.13, -1.0);
    }
    // the cone holder
    B.cyl(0.05, 0.035, 0.05, M.metal, CONE_AT.x, TOP + 0.025, CONE_AT.z, 14);
    // ---------- the jars ----------
    this.slots = [];
    for (let tier = 0; tier < 3; tier++) for (const s of [1, -1]) for (let c = 0; c < 4; c++){
      const x = s * (RX[0] + 0.14 + c * 0.245), y = TOP + tier * 0.13 + (tier ? 0 : 0), z = -0.54 - tier * 0.23;
      this.slots.push(V(x, y, z));
    }
    const n = INGREDIENTS.length;
    this.jarGlass = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(JAR_R, JAR_R, JAR_H, 16, 1, true).translate(0, JAR_H / 2, 0)), M.glass, n);
    this.jarGoo = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(JAR_R - 0.008, JAR_R - 0.008, JAR_H * 0.7, 14).translate(0, JAR_H * 0.35 + 0.01, 0)), toon('jar-goo', '#ffffff', { emissive: '#303030' }), n);
    this.jarLid = new THREE.InstancedMesh(keep(mergeGeometries([new THREE.CylinderGeometry(JAR_R + 0.008, JAR_R + 0.008, 0.035, 16).translate(0, JAR_H + 0.0175, 0), new THREE.SphereGeometry(0.022, 8, 6).translate(0, JAR_H + 0.045, 0)])), toon('jar-lid', '#ffffff'), n);
    this.jarBase = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(JAR_R + 0.004, JAR_R + 0.004, 0.012, 16).translate(0, 0.006, 0)), M.metal, n);
    for (const m of [this.jarGlass, this.jarGoo, this.jarLid, this.jarBase]){ m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(m); }
    this.jarGlass.renderOrder = 3;
    // labels: one texture (a grid of 4 × 8 labels), one merged mesh facing you
    this.labels = textCanvas(1024, 1024);
    const lg = [];
    INGREDIENTS.forEach((ing, i) => {
      const p = this.slots[i], g = new THREE.PlaneGeometry(0.17, 0.085);
      const col = i % 4, row = Math.floor(i / 4), uv = g.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, (col + uv.getX(k)) / 4, 1 - (row + 1 - uv.getY(k)) / 8);
      g.translate(p.x, p.y + JAR_H * 0.42, p.z + JAR_R + 0.012);
      lg.push(g);
    });
    this.labelMesh = new THREE.Mesh(keep(mergeGeometries(lg)), new THREE.MeshBasicMaterial({ map: this.labels.tex, transparent: true }));
    root.add(this.labelMesh);
    this.jarState = INGREDIENTS.map(() => ({ unlocked: false, lift: 0, hot: 0 }));
    // ---------- the tubs of base flavour ----------
    this.tubs = BASES.map((b, i) => {
      const g = new THREE.Group(); g.position.set(-0.56 + i * 0.28, TOP, -0.86); root.add(g);
      const tub = new THREE.Mesh(keep(new THREE.BoxGeometry(0.24, 0.07, 0.2).translate(0, 0.035, 0)), M.metal); g.add(tub);
      const mound = new THREE.Mesh(keep(ellipsoid(0.1, 0.05, 0.08, 16, 10).translate(0, 0.07, 0)), toon('base-' + b.id, b.color)); g.add(mound);
      const lid = new THREE.Mesh(keep(new THREE.BoxGeometry(0.25, 0.02, 0.21).translate(0, 0.08, 0)), toon('tub-lid', '#c8d0e0')); g.add(lid);
      const tag = textCanvas(256, 96); const tagM = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.22, 0.08)), new THREE.MeshBasicMaterial({ map: tag.tex, transparent: true }));
      tagM.position.set(0, 0.17, -0.07); g.add(tagM);
      return { id: b.id, g, mound, lid, tag, tagM, unlocked: false, lift: 0 };
    });
    // ---------- the bell and the bin ----------
    this.bell = new THREE.Group(); this.bell.position.set(0.42, TOP, -0.56); root.add(this.bell);
    this.bell.add(new THREE.Mesh(keep(new THREE.CylinderGeometry(0.075, 0.08, 0.02, 18).translate(0, 0.01, 0)), M.dark));
    this.bellDome = new THREE.Mesh(keep(new THREE.SphereGeometry(0.065, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.02, 0)), M.brass); this.bell.add(this.bellDome);
    this.bellBtn = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.008, 0.008, 0.03, 6).translate(0, 0.1, 0)), M.brass); this.bell.add(this.bellBtn);
    this.bin = new THREE.Group(); this.bin.position.set(-0.42, TOP, -0.56); root.add(this.bin);
    this.bin.add(new THREE.Mesh(keep(new THREE.CylinderGeometry(0.075, 0.06, 0.15, 16, 1, true).translate(0, 0.075, 0)), toon('bin', '#4a8a5a', { side: THREE.DoubleSide })));
    this.bin.add(new THREE.Mesh(keep(new THREE.CircleGeometry(0.06, 16).rotateX(-Math.PI / 2).translate(0, 0.01, 0)), M.dark));
    for (const [obj, text, col, w] of [[this.bell, 'SERVE', '#ffc83a', 0.2], [this.bin, 'BIN', '#7ae08a', 0.14]]){
      const t = sign(256, 96, (g) => { g.fillStyle = col; roundRect(g, 4, 4, 248, 88, 20); g.fill(); g.fillStyle = '#1a1420'; g.font = 'bold 60px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 50); });
      const m = new THREE.Mesh(keep(new THREE.PlaneGeometry(w, w * 0.375)), new THREE.MeshBasicMaterial({ map: t, transparent: true })); m.position.set(0, 0.2, 0.0); m.rotation.x = -0.35; obj.add(m);
      obj.userData.label = m;
    }
    // ---------- signs ----------
    const bigSign = sign(1024, 256, (g) => {
      g.fillStyle = '#3a1a5a'; roundRect(g, 6, 6, 1012, 244, 50); g.fill(); g.strokeStyle = '#6aff3a'; g.lineWidth = 10; roundRect(g, 12, 12, 1000, 232, 46); g.stroke();
      g.textAlign = 'center'; g.fillStyle = '#6aff3a'; g.font = 'bold italic 92px "Trebuchet MS", Arial'; g.fillText('DR. MAD\'S', 512, 112);
      g.fillStyle = '#ff8ad8'; g.font = 'bold 74px "Trebuchet MS", Arial'; g.fillText('ICE CREAM LAB', 512, 200);
    });
    const s1 = new THREE.Mesh(keep(new THREE.PlaneGeometry(3.6, 0.9)), new THREE.MeshBasicMaterial({ map: bigSign, transparent: true })); s1.position.set(-1.25, 2.78, R.z0 + 0.02); root.add(s1);
    const menu = sign(512, 640, (g) => {
      g.fillStyle = '#2a4a3a'; roundRect(g, 4, 4, 504, 632, 30); g.fill(); g.strokeStyle = '#c8844a'; g.lineWidth = 14; roundRect(g, 8, 8, 496, 624, 28); g.stroke();
      g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.font = 'bold 64px "Trebuchet MS", Arial'; g.fillText('MENU', 256, 90);
      g.font = '38px "Trebuchet MS", Arial'; g.textAlign = 'left';
      [['1 scoop', '$5'], ['Sprinkles', 'free'], ['Mad stuff', 'free!'], ['Side effects', '???']].forEach(([a, b], i) => { g.fillStyle = '#fff'; g.fillText(a, 50, 180 + i * 70); g.textAlign = 'right'; g.fillStyle = '#ffe07a'; g.fillText(b, 462, 180 + i * 70); g.textAlign = 'left'; });
      g.fillStyle = '#ff8ad8'; g.font = 'italic 30px "Trebuchet MS", Arial'; g.textAlign = 'center';
      wrapText(g, 'Every scoop is an experiment!', 420).forEach((l, i) => g.fillText(l, 256, 500 + i * 40));
    });
    const m1 = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.2, 1.5)), new THREE.MeshBasicMaterial({ map: menu })); m1.position.set(R.x0 + 0.02, 1.9, -4.2); m1.rotation.y = Math.PI / 2; root.add(m1);
    const warn = sign(512, 640, (g) => {
      g.fillStyle = '#ffe02a'; roundRect(g, 4, 4, 504, 632, 30); g.fill();
      g.fillStyle = '#1a1a1a'; for (let x = -40; x < 560; x += 60){ g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 30, 0); g.lineTo(x, 40); g.lineTo(x - 30, 40); g.fill(); }
      g.textAlign = 'center'; g.font = 'bold 54px Arial'; g.fillText('⚠ WARNING ⚠', 256, 110);
      g.font = '32px Arial'; g.textAlign = 'left';
      ['Side effects may include:', '• floating away', '• exploding', '• becoming a frog', '• extra eyes', '• baldness', 'No refunds for ghosts.'].forEach((l, i) => g.fillText(l, 36, 180 + i * 62));
    });
    const w1 = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.1, 1.38)), new THREE.MeshBasicMaterial({ map: warn })); w1.position.set(R.x1 - 0.02, 1.8, -3.8); w1.rotation.y = -Math.PI / 2; root.add(w1);
    const chalk = sign(1024, 512, (g) => {
      g.fillStyle = '#2a4a3a'; g.fillRect(0, 0, 1024, 512); g.strokeStyle = '#c8844a'; g.lineWidth = 24; g.strokeRect(0, 0, 1024, 512);
      g.fillStyle = 'rgba(255,255,255,0.88)'; g.font = '52px "Comic Sans MS", "Chalkboard SE", cursive';
      g.fillText('ICE + CREAM = ?!', 60, 110); g.fillText('🎈 + 🦉 = 👀🎈 ??', 60, 200); g.fillText('E = mc² + sprinkles', 60, 290);
      g.font = '40px "Comic Sans MS", "Chalkboard SE", cursive'; g.fillText('TODO: stop customers exploding', 60, 390); g.fillText('(or don\'t)', 640, 450);
    });
    const c1 = new THREE.Mesh(keep(new THREE.PlaneGeometry(2.4, 1.2)), new THREE.MeshBasicMaterial({ map: chalk })); c1.position.set(0, 2.0, R.z1 - 0.02); c1.rotation.y = Math.PI; root.add(c1);
    // ---------- the laboratory behind the counter ----------
    B.box(4.2, 0.9, 0.7, M.lab, 0, 0.45, R.z1 - 0.38); B.box(4.3, 0.06, 0.78, M.dark, 0, 0.93, R.z1 - 0.4);
    // shelves on the side walls behind the counter, with flasks
    for (const s of [-1, 1]){ for (const y of [1.3, 1.85]) B.box(0.34, 0.05, 2.2, M.wood, s * (R.x1 - 0.17), y, 1.1); }
    const flaskG = keep(mergeGeometries([new THREE.SphereGeometry(0.09, 14, 10).translate(0, 0.09, 0), new THREE.CylinderGeometry(0.025, 0.03, 0.12, 10, 1, true).translate(0, 0.22, 0)]));
    const flaskLiquid = keep(new THREE.SphereGeometry(0.075, 12, 8, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.65).translate(0, 0.09, 0));
    const r = rng(42), gooMats = [M.goo, M.purple, M.blue];
    const flasks = [];
    for (const s of [-1, 1]) for (const y of [1.325, 1.875]) for (let i = 0; i < 5; i++) flasks.push([s * (R.x1 - 0.17), y, 0.3 + i * 0.4 + r() * 0.1]);
    for (let i = 0; i < 8; i++) flasks.push([-1.8 + i * 0.5 + r() * 0.1, 0.96, R.z1 - 0.4]);
    const fG = flaskG.clone(); void fG;
    for (const [x, y, z] of flasks){ const k = Math.floor(r() * 3); B.add(flaskLiquid, gooMats[k], new THREE.Matrix4().makeTranslation(x, y, z)); B.add(flaskG, M.glass, new THREE.Matrix4().makeTranslation(x, y, z)); }
    // the vat, bubbling green
    const VAT = V(3.7, 0, 1.6);
    B.cyl(0.62, 0.6, 1.2, M.metal, VAT.x, 0.6, VAT.z, 24);
    B.cyl(0.66, 0.66, 0.08, M.dark, VAT.x, 1.2, VAT.z, 24);
    this.vatGoo = new THREE.Mesh(keep(new THREE.CircleGeometry(0.58, 24).rotateX(-Math.PI / 2)), M.goo); this.vatGoo.position.set(VAT.x, 1.25, VAT.z); root.add(this.vatGoo);
    this.vat = VAT;
    for (const y of [1.6, 2.4]) B.box(0.12, 0.12, 0.12, M.metal, VAT.x, y, R.z1 - 0.08);
    B.cyl(0.05, 0.05, 2.0, M.metal, VAT.x, 2.2, R.z1 - 0.12, 10);
    // the Tesla coil
    const TES = V(-3.8, 0, 1.7);
    B.cyl(0.35, 0.4, 0.4, M.dark, TES.x, 0.2, TES.z, 18);
    B.cyl(0.14, 0.14, 1.4, M.brass, TES.x, 1.1, TES.z, 16);
    for (let i = 0; i < 12; i++) B.add(new THREE.TorusGeometry(0.155, 0.012, 6, 18).rotateX(Math.PI / 2), M.red, new THREE.Matrix4().makeTranslation(TES.x, 0.5 + i * 0.1, TES.z));
    B.add(new THREE.TorusGeometry(0.28, 0.1, 10, 24).rotateX(Math.PI / 2), M.metal, new THREE.Matrix4().makeTranslation(TES.x, 1.88, TES.z));
    this.tesla = V(TES.x, 1.88, TES.z);
    this.arcGeo = new THREE.BufferGeometry(); this.arcGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 2 * 40), 3));
    this.arcs = new THREE.LineSegments(this.arcGeo, new THREE.LineBasicMaterial({ color: '#c8f0ff', toneMapped: false })); this.arcs.frustumCulled = false; root.add(this.arcs);
    // decor in the customer area: tables and chairs, a potted mutant plant with an eye
    for (const [x, z] of [[-3.6, -2.6], [-3.6, -5.4], [-3.6, -7.6]]){
      B.cyl(0.42, 0.42, 0.04, M.top, x, 0.76, z, 20); B.cyl(0.04, 0.04, 0.74, M.metal, x, 0.37, z, 8); B.cyl(0.22, 0.25, 0.03, M.metal, x, 0.015, z, 14);
      for (const s of [-1, 1]){ B.cyl(0.2, 0.2, 0.06, M.red, x + s * 0.7, 0.48, z, 16); B.cyl(0.03, 0.03, 0.45, M.metal, x + s * 0.7, 0.225, z, 6); }
    }
    B.cyl(0.2, 0.15, 0.36, M.red, 4.4, 0.18, -8.4, 14);
    this.plant = new THREE.Group(); this.plant.position.set(4.4, 0.36, -8.4); root.add(this.plant);
    this.plant.add(new THREE.Mesh(keep(new THREE.CylinderGeometry(0.03, 0.04, 0.8, 6).translate(0, 0.4, 0)), M.goo));
    const ph = new THREE.Mesh(keep(new THREE.SphereGeometry(0.2, 14, 10).translate(0, 0.95, 0)), toon('plant', '#5ad83a')); this.plant.add(ph);
    // lamps hanging over the counter and the shop
    const shade = keep(new THREE.ConeGeometry(0.26, 0.24, 18, 1, true).translate(0, -0.12, 0)), bulb = keep(new THREE.SphereGeometry(0.08, 10, 8).translate(0, -0.2, 0));
    for (const [x, z] of [[-1.5, -0.8], [1.5, -0.8], [-2.5, -4.8], [2, -5.6], [0, 1.4]]){
      B.cyl(0.006, 0.006, 0.5, M.dark, x, H - 0.25, z, 4);
      B.add(shade, toon('shade', '#ff6a9a', { side: THREE.DoubleSide }), new THREE.Matrix4().makeTranslation(x, H - 0.5, z));
      B.add(bulb, toon('bulb', '#fff8d0', { emissive: '#fff0b0' }), new THREE.Matrix4().makeTranslation(x, H - 0.5, z));
    }
    B.build(root, { shadows: false, receive: false });
    // what can be pointed at and used
    this.proxies = [];
    INGREDIENTS.forEach((ing, i) => { const p = this.slots[i]; this.proxies.push({ kind: 'jar', id: ing.id, i, box: new THREE.Box3(V(p.x - JAR_R - 0.03, p.y, p.z - JAR_R - 0.03), V(p.x + JAR_R + 0.03, p.y + JAR_H + 0.06, p.z + JAR_R + 0.03)) }); });
    this.tubs.forEach((t) => { const p = t.g.position; this.proxies.push({ kind: 'tub', id: t.id, box: new THREE.Box3(V(p.x - 0.13, p.y - 0.01, p.z - 0.11), V(p.x + 0.13, p.y + 0.26, p.z + 0.11)) }); });
    this.proxies.push({ kind: 'bell', id: 'bell', box: new THREE.Box3(V(0.42 - 0.11, TOP - 0.01, -0.56 - 0.09), V(0.42 + 0.11, TOP + 0.26, -0.56 + 0.09)) });
    this.proxies.push({ kind: 'bin', id: 'bin', box: new THREE.Box3(V(-0.42 - 0.1, TOP - 0.01, -0.56 - 0.09), V(-0.42 + 0.1, TOP + 0.26, -0.56 + 0.09)) });
    this.proxies.push({ kind: 'cone', id: 'cone', box: new THREE.Box3(V(-0.06, TOP, CONE_AT.z - 0.06), V(0.06, TOP + 0.3, CONE_AT.z + 0.06)) });
    this.hover = null; this.arcT = 0;
    this.setStock([], []);
  }
  // which jars and tubs are open (the rest show a padlock and a price)
  setStock(ings, bases){
    const g = this.labels.ctx;
    INGREDIENTS.forEach((ing, i) => {
      const un = ings.includes(ing.id); this.jarState[i].unlocked = un;
      const x = (i % 4) * 256, y = Math.floor(i / 4) * 128;
      g.clearRect(x, y, 256, 128);
      g.fillStyle = un ? '#fffaf0' : '#8a8090'; roundRect(g, x + 4, y + 4, 248, 120, 18); g.fill();
      g.strokeStyle = un ? ing.color : '#4a4450'; g.lineWidth = 8; roundRect(g, x + 8, y + 8, 240, 112, 16); g.stroke();
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '48px Arial'; g.fillStyle = '#000'; g.fillText(un ? ing.emoji : '🔒', x + 46, y + 64);
      g.fillStyle = un ? '#1a1420' : '#ffffff';
      const words = ing.name.split(' '), lines = words.length > 1 ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : [ing.name];
      if (!un) { g.font = 'bold 30px Arial'; g.fillText(lines[0], x + 160, y + 44); g.fillStyle = '#ffe07a'; g.font = 'bold 34px Arial'; g.fillText('$' + ing.price, x + 160, y + 88); }
      else { g.font = 'bold 30px Arial'; let fs = 30; while (Math.max(...lines.map((l) => g.measureText(l).width)) > 160 && fs > 18){ fs -= 2; g.font = `bold ${fs}px Arial`; } lines.forEach((l, k) => g.fillText(l, x + 160, y + 64 + (k - (lines.length - 1) / 2) * (fs + 4))); }
    });
    this.labels.tex.needsUpdate = true;
    for (const t of this.tubs){
      t.unlocked = bases.includes(t.id);
      t.mound.visible = t.unlocked; t.lid.visible = !t.unlocked;
      const b = BASES.find((b) => b.id === t.id), g2 = t.tag.ctx;
      g2.clearRect(0, 0, 256, 96); g2.fillStyle = t.unlocked ? b.color : '#8a8090'; roundRect(g2, 4, 4, 248, 88, 18); g2.fill();
      g2.fillStyle = t.unlocked && t.id !== 'choc' ? '#1a1420' : '#ffffff'; g2.font = 'bold 34px Arial'; g2.textAlign = 'center'; g2.textBaseline = 'middle';
      g2.fillText(t.unlocked ? b.name : `🔒 $${b.price}`, 128, 50); t.tag.tex.needsUpdate = true;
    }
    this.drawJars();
  }
  drawJars(){
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = V(), c = new THREE.Color();
    INGREDIENTS.forEach((ing, i) => {
      const p = this.slots[i], st = this.jarState[i], lift = st.lift, hot = st.hot;
      const k = 1 + hot * 0.12;
      q.setFromEuler(new THREE.Euler(-lift * 0.5, 0, 0));
      m.compose(V(p.x, p.y + lift * 0.12, p.z), q, s.set(k, k, k));
      this.jarGlass.setMatrixAt(i, m); this.jarLid.setMatrixAt(i, m); this.jarBase.setMatrixAt(i, m);
      this.jarGoo.setMatrixAt(i, st.unlocked ? m : new THREE.Matrix4().makeScale(0, 0, 0));
      this.jarGoo.setColorAt(i, c.set(ing.color));
      this.jarLid.setColorAt(i, c.set(st.unlocked ? (ing.nice ? '#ff8ad8' : '#6aff3a') : '#6a6470'));
    });
    for (const im of [this.jarGlass, this.jarGoo, this.jarLid, this.jarBase]){ im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
  }
  // the nearest usable thing along a ray
  ray(o, d, far = 8){
    const r = new THREE.Ray(o, d), p = V();
    let best = null;
    for (const x of this.proxies){ if (r.intersectBox(x.box, p)){ const t = p.distanceTo(o); if (t < far && (!best || t < best.t)) best = { ...x, t, point: p.clone() }; } }
    return best;
  }
  // a jar or tub lifts when it's used, and grows a little when pointed at
  bump(kind, id){
    if (kind === 'jar'){ const i = INGREDIENTS.findIndex((x) => x.id === id); if (i >= 0) this.jarState[i].lift = 1; }
    if (kind === 'tub'){ const t = this.tubs.find((t) => t.id === id); if (t) t.lift = 1; }
    if (kind === 'bell') this.bellPress = 1;
  }
  setHover(h){
    const key = h ? h.kind + ':' + h.id : null;
    if (key === this.hover) return;
    this.hover = key;
    INGREDIENTS.forEach((ing, i) => { this.jarState[i].hotWant = h && h.kind === 'jar' && h.id === ing.id ? 1 : 0; });
    for (const t of this.tubs) t.hot = h && h.kind === 'tub' && h.id === t.id ? 1 : 0;
    this.bell.userData.hot = h && h.kind === 'bell' ? 1 : 0; this.bin.userData.hot = h && h.kind === 'bin' ? 1 : 0;
  }
  update(time, dt, fx){
    // jars settle back after being used
    let moved = false;
    for (const st of this.jarState){
      const want = st.hotWant || 0;
      if (st.lift > 0){ st.lift = Math.max(0, st.lift - dt * 2.2); moved = true; }
      if (Math.abs(st.hot - want) > 0.001){ st.hot += (want - st.hot) * Math.min(1, dt * 14); moved = true; }
    }
    if (moved) this.drawJars();
    for (const t of this.tubs){ if (t.lift > 0) t.lift = Math.max(0, t.lift - dt * 3); const k = 1 + (t.hot || 0) * 0.08; t.g.scale.set(k, k + t.lift * 0.15, k); }
    for (const o of [this.bell, this.bin]){ const k = 1 + (o.userData.hot || 0) * 0.15; o.scale.setScalar(k); }
    if (this.bellPress > 0){ this.bellPress = Math.max(0, this.bellPress - dt * 5); this.bellBtn.position.y = -this.bellPress * 0.02; }
    // the door swings open when someone is near it
    this.doorOpen += (this.doorWant - this.doorOpen) * Math.min(1, dt * 5);
    this.door.rotation.y = this.doorOpen * 1.4;
    // the Tesla coil: jagged arcs, redrawn a few times a second
    this.arcT -= dt;
    if (this.arcT <= 0){
      this.arcT = 0.05 + Math.random() * 0.08;
      const a = this.arcGeo.attributes.position.array; let n = 0;
      const arcs = Math.random() < 0.3 ? 0 : 1 + Math.floor(Math.random() * 3);
      a.fill(0);
      for (let k = 0; k < arcs; k++){
        const ang = Math.random() * Math.PI * 2, len = 0.4 + Math.random() * 0.5, steps = 12;
        let p = this.tesla.clone().add(V(Math.cos(ang) * 0.36, 0, Math.sin(ang) * 0.36));
        const dir = V(Math.cos(ang), (Math.random() - 0.3) * 0.8, Math.sin(ang)).normalize();
        for (let s = 0; s < steps && n < 39; s++){
          const q = p.clone().addScaledVector(dir, len / steps).add(V((Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.08));
          a.set([p.x, p.y, p.z, q.x, q.y, q.z], n * 6); n++; p = q;
        }
      }
      this.arcGeo.attributes.position.needsUpdate = true;
      this.arcFlash = arcs;
    }
    // the vat bubbles, and so does the plant
    if (fx && Math.random() < dt * 6) fx.bubbles(V(this.vat.x + (Math.random() - 0.5) * 0.8, 1.27, this.vat.z + (Math.random() - 0.5) * 0.8), 1, '#9aff7a');
    this.vatGoo.position.y = 1.25 + Math.sin(time * 2) * 0.01;
    this.plant.rotation.z = Math.sin(time * 0.9) * 0.08; this.plant.rotation.x = Math.sin(time * 0.7) * 0.05;
  }
}
