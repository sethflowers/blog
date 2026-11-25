// The Midnight Express: six carriages you can walk through, and the stormy night rushing past outside.
// Train coordinates: the floor is y = 0, x runs across (±1.4 m inside the walls), z runs along the train
// from the front (the baggage car, behind the engine) to the back (the observation car and its open
// platform). The train stays still; the countryside moves past it.
//
// Everything static is merged into one mesh per material (Batch). Walls and furniture are also kept as
// rectangles for walking into (tall ones stop your real head in VR; low ones only stop the stick).
// Lamps: glowing fixtures everywhere, and a few real point lights that follow you to the nearest ones.
import * as THREE from 'three';
import { V, clamp, Batch, mat, tex, noiseRng, textCanvas, roundRect } from './util.js';

export const HW = 1.4;          // half the inside width
export const CEIL = 2.45;       // ceiling height
const T = 0.08;                 // wall thickness
const DOOR_H = 2.05;
export const CAR_LIST = [
  { id: 'baggage', name: 'Baggage Car', len: 13, door: [-0.5, 0.5] },
  { id: 'kitchen', name: 'Kitchen Car', len: 11, door: [-0.5, 0.5] },
  { id: 'dining', name: 'Dining Car', len: 15, door: [-0.5, 0.5] },
  { id: 'lounge', name: 'Lounge Car', len: 15, door: [-0.5, 0.5] },
  { id: 'sleeper', name: 'Sleeping Car', len: 20, door: [0.62, 1.35] },
  { id: 'observation', name: 'Observation Car', len: 13, door: [-0.5, 0.5] },
];
const GAP = 0.9;                // the gangway between two cars
const PLATFORM = 2.4;
export const SPEED = 17;        // m/s the countryside rushes past

// ---------- textures ----------
function woodTex(){
  return tex('wood', (g, S) => {
    const R = noiseRng(3);
    g.fillStyle = '#4a2414'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 900; i++){ const y = R() * S; g.strokeStyle = `rgba(${30 + R() * 40},${10 + R() * 18},${4},${0.25 + R() * 0.3})`; g.lineWidth = 1 + R() * 2; g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= S; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 3); g.stroke(); }
    // panels
    g.strokeStyle = 'rgba(20,8,2,0.7)'; g.lineWidth = 6; g.strokeRect(10, 10, S - 20, S - 20);
    g.strokeStyle = 'rgba(160,90,50,0.35)'; g.lineWidth = 3; g.strokeRect(22, 22, S - 44, S - 44);
  }, { repeat: [1, 1] });
}
function carpetTex(name, a, b){
  return tex(name, (g, S) => {
    g.fillStyle = a; g.fillRect(0, 0, S, S);
    g.strokeStyle = b; g.lineWidth = 10;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++){ const x = i * S / 4 + S / 8, y = j * S / 4 + S / 8; g.beginPath(); g.moveTo(x, y - 40); g.lineTo(x + 40, y); g.lineTo(x, y + 40); g.lineTo(x - 40, y); g.closePath(); g.stroke(); }
    const R = noiseRng(9); for (let i = 0; i < 4000; i++){ g.fillStyle = `rgba(0,0,0,${R() * 0.12})`; g.fillRect(R() * S, R() * S, 2, 2); }
  });
}
function planksTex(){
  return tex('planks', (g, S) => {
    const R = noiseRng(5);
    for (let i = 0; i < 8; i++){ const c = 80 + R() * 30; g.fillStyle = `rgb(${c},${c * 0.7},${c * 0.45})`; g.fillRect(i * S / 8, 0, S / 8, S); g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(i * S / 8, 0, 3, S); }
    for (let i = 0; i < 1500; i++){ g.fillStyle = `rgba(30,20,10,${R() * 0.2})`; g.fillRect(R() * S, R() * S, 1, 8 + R() * 30); }
  });
}
function tilesTex(){
  return tex('tiles', (g, S) => {
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++){ g.fillStyle = (i + j) % 2 ? '#2a2a2e' : '#e8e4da'; g.fillRect(i * S / 8, j * S / 8, S / 8, S / 8); }
  });
}
function rainTex(){
  return tex('rain', (g, S) => {
    g.clearRect(0, 0, S, S);
    const R = noiseRng(11);
    for (let i = 0; i < 260; i++){
      const x = R() * S, y = R() * S, r = 1.5 + R() * 4;
      g.fillStyle = 'rgba(200,215,235,0.55)'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      if (R() < 0.4){ g.strokeStyle = 'rgba(200,215,235,0.35)'; g.lineWidth = r * 0.8; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 6, y + 20 + R() * 60); g.stroke(); }
    }
  }, { repeat: [1, 1] });
}
function groundTex(){
  return tex('ground', (g, S) => {
    const R = noiseRng(21);
    g.fillStyle = '#1a2416'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 9000; i++){ const c = R(); g.fillStyle = c < 0.5 ? `rgba(40,58,30,${R() * 0.6})` : `rgba(10,14,8,${R() * 0.6})`; g.fillRect(R() * S, R() * S, 3 + R() * 6, 3 + R() * 6); }
  });
}
function mountainsTex(){
  return tex('mountains', (g, S) => {
    g.clearRect(0, 0, S * 2, S);
    const R = noiseRng(31);
    for (const [base, col, amp] of [[0.55, '#151b28', 0.35], [0.7, '#0e131c', 0.25]]){
      g.fillStyle = col; g.beginPath(); g.moveTo(0, S);
      let h = base; for (let x = 0; x <= S; x += 8){ h = clamp(h + (R() - 0.5) * 0.06, base - amp, base + 0.1); g.lineTo(x, S * h); }
      g.lineTo(S, S); g.closePath(); g.fill();
    }
  }, { size: 1024 });
}

// a sign: big light text on a dark plaque
function signTex(name, text, w = 512, h = 128){
  return tex('sign-' + name, (g) => {
    g.canvas.width = w; g.canvas.height = h;
    g.fillStyle = '#1c1208'; roundRect(g, 0, 0, w, h, 18); g.fill();
    g.strokeStyle = '#c8a050'; g.lineWidth = 8; roundRect(g, 6, 6, w - 12, h - 12, 14); g.stroke();
    g.fillStyle = '#f4dc9a'; g.textAlign = 'center'; g.textBaseline = 'middle';
    let fs = h * 0.56; g.font = `bold ${fs}px Georgia, serif`; while (g.measureText(text).width > w - 40){ fs -= 2; g.font = `bold ${fs}px Georgia, serif`; }
    g.fillText(text, w / 2, h / 2 + 2);
  }, { size: Math.max(w, h) });
}

export class Train {
  constructor(scene){
    this.scene = scene;
    this.group = new THREE.Group(); scene.add(this.group);
    this.walls = [];        // { x0, z0, x1, z1, tall }
    this.items = [];        // things you can look at: { id, name, pos, proxy, text }
    this.lamps = [];        // lamp positions (for the moving point lights)
    this.cars = {};
    this.proxies = new THREE.Group(); this.proxies.visible = false; this.group.add(this.proxies);
    this.spots = {};        // places people stand: place id → [{ x, z, yaw }]
    this.M = {
      wood: mat('wood', { map: woodTex(), rough: 0.55 }),
      woodDark: mat('woodDark', { color: 0x2a140a, rough: 0.5 }),
      ceiling: mat('ceiling', { color: 0xe8dcc0, rough: 0.9 }),
      brass: mat('brass', { color: 0xc8a050, rough: 0.35, metal: 0.8 }),
      red: mat('redCarpet', { map: carpetTex('carpet-red', '#6a1418', '#8a2a20'), rough: 0.95 }),
      blue: mat('blueCarpet', { map: carpetTex('carpet-blue', '#1a2a4a', '#2a3a6a'), rough: 0.95 }),
      green: mat('greenCarpet', { map: carpetTex('carpet-green', '#1a3424', '#2a4a30'), rough: 0.95 }),
      planks: mat('planks', { map: planksTex(), rough: 0.9 }),
      tiles: mat('tiles', { map: tilesTex(), rough: 0.4 }),
      cloth: mat('tablecloth', { color: 0xf4f0e6, rough: 0.9 }),
      velvet: mat('velvet', { color: 0x6a1a24, rough: 0.95 }),
      greenVelvet: mat('greenVelvet', { color: 0x1e4a2e, rough: 0.95 }),
      leather: mat('leather', { color: 0x4a2a18, rough: 0.6 }),
      steel: mat('steel', { color: 0x8a9098, rough: 0.4, metal: 0.7 }),
      iron: mat('iron', { color: 0x2a2a2e, rough: 0.6, metal: 0.5 }),
      white: mat('whiteEnamel', { color: 0xf0f0ea, rough: 0.3 }),
      crate: mat('crate', { color: 0x8a6a40, rough: 0.9 }),
      canvas: mat('canvasBag', { color: 0x9a8a6a, rough: 1 }),
      bedding: mat('bedding', { color: 0xe8e4f0, rough: 0.9 }),
      blanket: mat('blanket', { color: 0x2a3a6a, rough: 0.95 }),
      book: mat('books', { color: 0x6a2a1a, rough: 0.8 }),
      lamp: mat('lamp', { color: 0xfff0c0, emissive: 0xffd890, emissiveIntensity: 1.6, rough: 0.5 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x9ab0c8, map: rainTex(), transparent: true, opacity: 0.32, roughness: 0.05, metalness: 0.2, depthWrite: false }),
      black: mat('blackPaint', { color: 0x141414, rough: 0.6 }),
      plant: mat('plant', { color: 0x2a5a2a, rough: 0.8 }),
      paper: mat('paper', { color: 0xf0ead8, rough: 0.9 }),
      outside: mat('livery', { color: 0x3a0e10, rough: 0.6 }),
    };
    this.M.glass.name = 'glass';
    const B = this.B = new Batch();
    let z = 0;
    CAR_LIST.forEach((C, i) => {
      const car = { ...C, z0: z, z1: z + C.len, i };
      this.cars[C.id] = car;
      z += C.len;
      if (i < CAR_LIST.length - 1){ this.gangway(car, CAR_LIST[i + 1], z, z + GAP); z += GAP; }
    });
    this.length = z;
    for (const C of Object.values(this.cars)){ this.shell(C); this[C.id](C); }
    this.platform(this.cars.observation);
    this.meshes = B.build(this.group);
    this.boxLog = B.log;
    this.buildOutside();
    this.buildLights();
  }
  // ---------- helpers ----------
  wall(x0, z0, x1, z1, tall = true){ this.walls.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), tall }); }
  item(id, name, pos, r, text, extra = {}){
    const proxy = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), mat('proxy', { basic: true }));
    proxy.position.copy(pos); proxy.userData.item = id; this.proxies.add(proxy);
    const it = { id, name, pos: pos.clone(), r, text, proxy, ...extra };
    this.items.push(it); return it;
  }
  // a little brass table lamp with a glowing shade
  tableLamp(x, y, z){
    const B = this.B;
    const base = new THREE.CylinderGeometry(0.05, 0.06, 0.02, 12); base.translate(x, y + 0.01, z); B.add(base, this.M.brass);
    const stem = new THREE.CylinderGeometry(0.008, 0.008, 0.2, 6); stem.translate(x, y + 0.12, z); B.add(stem, this.M.brass);
    const shade = new THREE.CylinderGeometry(0.035, 0.075, 0.09, 14); shade.translate(x, y + 0.24, z); B.add(shade, this.M.lamp);
    this.lamps.push(V(x, y + 0.3, z));
  }
  spot(place, x, z, yaw){ (this.spots[place] = this.spots[place] || []).push({ x, z, yaw }); }
  sign(text, x, y, z, rotY = 0, w = 0.9, h = 0.22){
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: signTex(text, text, 512, Math.round(512 * h / w)), toneMapped: false }));
    m.position.set(x, y, z); m.rotation.y = rotY; this.group.add(m); return m;
  }
  lamp(x, y, z, kind = 'ceiling'){
    const B = this.B;
    // (the brass rim hangs 1.2 cm below the ceiling, the glowing glass below that: nothing flush)
    if (kind === 'ceiling'){ B.box(x - 0.22, y - 0.012, z - 0.22, x + 0.22, y, z + 0.22, this.M.brass, 1, 'lamp-rim'); B.box(x - 0.18, y - 0.07, z - 0.18, x + 0.18, y - 0.024, z + 0.18, this.M.lamp, 1, 'lamp'); }
    else { const g = new THREE.SphereGeometry(0.07, 10, 8); g.translate(x, y, z); B.add(g, this.M.lamp); }
    this.lamps.push(V(x, y - 0.15, z));
  }
  // a side wall from z0 to z1 at side s (-1 left, +1 right) with windows [{ z0, z1 }] between ya and yb
  sideWall(s, z0, z1, wins, ya = 0.95, yb = 1.95, x0 = HW, x1 = HW + T){
    const B = this.B, M = this.M, xa = s < 0 ? -x1 : x0, xb = s < 0 ? -x0 : x1;
    B.box(xa, 0, z0, xb, ya, z1, M.wood, 1.2, 'wall');
    B.box(xa, yb, z0, xb, CEIL, z1, M.wood, 1.2, 'wall');
    let z = z0;
    for (const w of wins){
      B.box(xa, ya, z, xb, yb, w.z0, M.wood, 1.2, 'wall');
      const gl = new THREE.PlaneGeometry(w.z1 - w.z0, yb - ya); gl.rotateY(s < 0 ? Math.PI / 2 : -Math.PI / 2); gl.translate((xa + xb) / 2, (ya + yb) / 2, (w.z0 + w.z1) / 2);
      B.add(gl, M.glass);
      // brass window frame, 1 cm proud of the wall
      const fx = s < 0 ? xb + 0.01 : xa - 0.01, fx2 = s < 0 ? xb + 0.04 : xa - 0.04;
      B.box(Math.min(fx, fx2), ya - 0.04, w.z0 - 0.03, Math.max(fx, fx2), ya, w.z1 + 0.03, M.brass, 1, 'sill');
      z = w.z1;
    }
    B.box(xa, ya, z, xb, yb, z1, M.wood, 1.2, 'wall');
    this.wall(xa, z0, xb, z1, true);
  }
  windows(z0, z1, w = 1.0, gap = 0.55){
    const out = [], n = Math.floor((z1 - z0 - gap) / (w + gap)), start = z0 + (z1 - z0 - (n * w + (n - 1) * gap)) / 2;
    for (let i = 0; i < n; i++) out.push({ z0: start + i * (w + gap), z1: start + i * (w + gap) + w });
    return out;
  }
  // an end wall at z (the wall's inside face) with a doorway [d0, d1]; dir +1 if the car is on the +z side
  endWall(z, dir, door, closed = false){
    const B = this.B, M = this.M, za = dir > 0 ? z - 0.1 : z, zb = dir > 0 ? z : z + 0.1;
    B.box(-HW, 0, za, door[0], CEIL, zb, M.wood, 1.2, 'end');
    B.box(door[1], 0, za, HW, CEIL, zb, M.wood, 1.2, 'end');
    B.box(door[0], DOOR_H, za, door[1], CEIL, zb, M.wood, 1.2, 'end');
    this.wall(-HW, za, door[0], zb); this.wall(door[1], za, HW, zb);
    // door frame (brass), 1 cm proud on both sides
    for (const [fz0, fz1] of [[za - 0.03, za - 0.01], [zb + 0.01, zb + 0.03]]){
      B.box(door[0] - 0.06, 0, fz0, door[0], DOOR_H + 0.06, fz1, M.brass, 1, 'frame');
      B.box(door[1], 0, fz0, door[1] + 0.06, DOOR_H + 0.06, fz1, M.brass, 1, 'frame');
      B.box(door[0], DOOR_H, fz0, door[1], DOOR_H + 0.06, fz1, M.brass, 1, 'frame');
    }
    if (closed){ B.box(door[0], 0, za + 0.03, door[1], DOOR_H, zb - 0.03, M.woodDark, 1, 'door'); this.wall(door[0], za, door[1], zb); }
  }
  shell(C){
    const B = this.B, M = this.M;
    const floor = { baggage: M.planks, kitchen: M.tiles, dining: M.red, lounge: M.green, sleeper: M.blue, observation: M.red }[C.id];
    B.box(-HW - T, -0.12, C.z0, HW + T, 0, C.z1, floor, 1, 'floor');
    B.box(-HW - T, CEIL, C.z0, HW + T, CEIL + 0.1, C.z1, M.ceiling, 1, 'ceiling');
    // the roof outside (a curved look from a couple of boxes) is never seen from inside: skip it
    this.endWall(C.z0, 1, CAR_LIST[C.i - 1] ? C.door : [-0.5, 0.5], C.i === 0);
    this.endWall(C.z1, -1, C.door, false);
    // the car's name over each end door, on the inside
    this.sign(C.name.toUpperCase(), (C.door[0] + C.door[1]) / 2, DOOR_H + 0.2, C.z0 + 0.02, 0, 1.0, 0.2);
    this.sign(C.name.toUpperCase(), (C.door[0] + C.door[1]) / 2, DOOR_H + 0.2, C.z1 - 0.02, Math.PI, 1.0, 0.2);
    // ceiling lamps
    for (let z = C.z0 + 2.2; z < C.z1 - 1; z += 3.6) this.lamp(C.id === 'sleeper' ? 0.95 : 0, CEIL, z);
  }
  gangway(a, b, z0, z1){
    const B = this.B, M = this.M;
    const x0 = Math.min(a.door[0], b.door[0]) - 0.05, x1 = Math.max(a.door[1], b.door[1]) + 0.05;
    // the end walls already stop at z0/z1 (0.1 thick), so the bellows sit between them
    B.box(x0 - 0.06, -0.12, z0, x1 + 0.06, -0.01, z1, M.iron, 1, 'gang-floor');
    const za = z0 + 0.1, zb = z1 - 0.1;     // (between the two cars' end walls, which are 0.1 thick)
    B.box(x0 - 0.06, 0, za, x0, DOOR_H + 0.1, zb, M.black, 1, 'gang-wall');
    B.box(x1, 0, za, x1 + 0.06, DOOR_H + 0.1, zb, M.black, 1, 'gang-wall');
    B.box(x0 - 0.06, DOOR_H + 0.1, za, x1 + 0.06, DOOR_H + 0.16, zb, M.black, 1, 'gang-roof');
    this.wall(x0 - 0.06, z0 - 0.1, x0, z1 + 0.1); this.wall(x1, z0 - 0.1, x1 + 0.06, z1 + 0.1);
    // the doorway walls of each car stop people walking sideways into the gap
    this.wall(-HW, z0, x0 - 0.06, z1); this.wall(x1 + 0.06, z0, HW, z1);
  }
  // ---------- the cars ----------
  baggage(C){
    const B = this.B, M = this.M, z0 = C.z0, z1 = C.z1;
    this.sideWall(-1, z0, z1, this.windows(z0 + 1, z1 - 1, 0.7, 2.2), 1.45, 1.95);
    this.sideWall(1, z0, z1, this.windows(z0 + 1, z1 - 1, 0.7, 2.2), 1.45, 1.95);
    // crates and trunks along both walls
    const R = noiseRng(7);
    for (let z = z0 + 0.6; z < z1 - 1.2; z += 1.15){
      for (const s of [-1, 1]){
        if (s > 0 && z > z0 + 6 && z < z0 + 9.5) continue;     // (the workbench)
        const w = 0.55 + R() * 0.3, h = 0.45 + R() * 0.5, x = s * (HW - w / 2 - 0.02);
        B.box(x - w / 2, 0, z, x + w / 2, h, z + 0.95, R() < 0.5 ? M.crate : M.leather, 1.5, 'crate');
        if (R() < 0.5) B.box(x - w / 2 + 0.05, h, z + 0.1, x + w / 2 - 0.05, h + 0.3 + R() * 0.2, z + 0.75, M.canvas, 1.5, 'bag');
        this.wall(x - w / 2, z, x + w / 2, z + 0.95, false);
      }
    }
    // the workbench, tools on the wall over it
    const wz = z0 + 6.2;
    B.box(HW - 0.6, 0.82, wz, HW, 0.88, wz + 3.2, M.woodDark, 1, 'bench'); B.box(HW - 0.55, 0, wz + 0.05, HW - 0.5, 0.82, wz + 0.1, M.woodDark, 1, 'leg'); B.box(HW - 0.55, 0, wz + 3.1, HW - 0.5, 0.82, wz + 3.15, M.woodDark, 1, 'leg');
    // the tool board stops below the windows (their sills start at 1.41 m)
    B.box(HW - 0.03, 0.95, wz + 0.2, HW - 0.01, 1.38, wz + 3.0, M.planks, 1, 'toolboard');
    for (let k = 0; k < 6; k++){ if (k === 3) continue; B.box(HW - 0.06, 1.0 + (k % 2) * 0.05, wz + 0.4 + k * 0.45, HW - 0.03, 1.3 + (k % 2) * 0.05, wz + 0.48 + k * 0.45, M.steel, 1, 'tool'); }
    B.box(HW - 0.45, 0.88, wz + 2.3, HW - 0.1, 1.08, wz + 2.8, mat('redTin', { color: 0xa82a1a, rough: 0.5, metal: 0.4 }), 1, 'toolbox');
    this.wall(HW - 0.6, wz, HW, wz + 3.2, false);
    this.item('workbench', 'The workbench', V(HW - 0.3, 1.1, wz + 1.6), 0.5, 'A workbench with spanners and screwdrivers hanging over it. One hook is empty: the big iron spanner is missing.', { home: 'wrench' });
    // an oil drum
    const drum = new THREE.CylinderGeometry(0.3, 0.3, 0.85, 16); drum.translate(-HW + 0.35, 0.425, z1 - 0.8); B.add(drum, mat('drum', { color: 0x2a4a2a, rough: 0.5, metal: 0.4 })); this.wall(-HW, z1 - 1.1, -HW + 0.65, z1 - 0.5, false);
    // the locked door to the engine
    this.item('engine-door', 'The door to the engine', V(0, 1.2, z0 + 0.15), 0.5, 'Locked. Only the driver and the fireman are allowed in the engine. They\'ve been shovelling coal all evening and haven\'t left it.');
    this.lamp(-1.0, 2.1, z0 + 4, 'bulb');
    this.spot('baggage', -0.2, z0 + 4.2, Math.PI / 2); this.spot('baggage', 0.35, z0 + 4.9, -Math.PI * 0.7); this.spot('baggage', 0.1, z1 - 2.5, 0);
    this.sceneSpot('baggage', { body: { x: 0, z: z0 + 7.5, yaw: 0.4 }, weapon: { x: -0.55, z: z0 + 6.6 }, puddle: { x: 0.15, z: z0 + 8.3 } });
  }
  kitchen(C){
    const B = this.B, M = this.M, z0 = C.z0, z1 = C.z1;
    this.sideWall(-1, z0, z1, []);       // (the counter side: shelves instead of windows)
    this.sideWall(1, z0, z1, this.windows(z0 + 0.5, z1 - 0.5));
    // counter along the left wall, stove, sink, shelves above
    const cx = -HW + 0.62;
    B.box(-HW, 0, z0 + 0.6, cx, 0.88, z1 - 0.6, M.white, 1, 'counter');
    B.box(-HW, 0.88, z0 + 0.6, cx + 0.02, 0.92, z1 - 0.6, M.steel, 1, 'worktop');
    this.wall(-HW, z0 + 0.6, cx + 0.02, z1 - 0.6, false);
    const sz = z0 + 3.5;
    B.box(-HW + 0.06, 0.92, sz, cx - 0.04, 0.98, sz + 1.0, M.iron, 1, 'stove');
    for (const dz of [0.25, 0.75]){ const r = new THREE.CylinderGeometry(0.12, 0.12, 0.02, 14); r.translate(-HW + 0.32, 0.99, sz + dz); B.add(r, M.black); }
    B.box(-HW + 0.1, 0.8, sz + 2.2, cx - 0.08, 0.93, sz + 2.8, M.steel, 1, 'sink');
    for (const y of [1.45, 1.85]) B.box(-HW, y, z0 + 0.8, -HW + 0.32, y + 0.04, z1 - 0.8, M.woodDark, 1, 'shelf');
    // jars and tins on the shelves
    const R = noiseRng(13);
    for (let z = z0 + 1; z < z1 - 1; z += 0.28){ if (R() < 0.3) continue; const h = 0.12 + R() * 0.16, c = new THREE.CylinderGeometry(0.06, 0.06, h, 10); c.translate(-HW + 0.16, 1.49 + h / 2 + (R() < 0.5 ? 0.4 : 0), z); B.add(c, R() < 0.5 ? M.brass : M.white); }
    // pans hanging over the stove (one hook is empty if the pan is the weapon)
    this.panHooks = V(-HW + 0.3, 1.25, sz + 0.5);
    this.item('stove', 'The kitchen stove', V(-HW + 0.32, 1.1, sz + 0.5), 0.45, 'A big iron stove, still warm. Pans hang over it.', { home: 'pan' });
    this.item('kitchen-shelf', 'The kitchen shelves', V(-HW + 0.2, 1.6, sz + 4.2), 0.45, 'Jars of sugar, tea and spices. There\'s a gap where the rolling pin usually lies.', { home: 'rollingpin' });
    // flour sacks
    for (let k = 0; k < 3; k++){ const s = new THREE.SphereGeometry(0.28, 12, 8); s.scale(1, 1.3, 0.8); s.translate(HW - 0.35, 0.36, z1 - 1.2 - k * 0.55); B.add(s, M.canvas); }
    this.wall(HW - 0.65, z1 - 2.6, HW, z1 - 0.9, false);
    // an icebox
    B.box(HW - 0.7, 0, z0 + 0.4, HW, 1.6, z0 + 1.2, M.white, 1, 'icebox'); this.wall(HW - 0.7, z0 + 0.4, HW, z0 + 1.2, true);
    this.lamp(0, CEIL, z0 + 3.5); this.lamp(0, CEIL, z0 + 7.5);
    this.spot('kitchen', 0.2, z0 + 5.2, Math.PI); this.spot('kitchen', 0.25, z0 + 4.2, 0); this.spot('kitchen', -0.3, z0 + 3.0, -Math.PI / 2);
    this.sceneSpot('kitchen', { body: { x: 0.25, z: z0 + 5.5, yaw: 0.1 }, weapon: { x: 0.85, z: z0 + 4.7 }, puddle: { x: 0.05, z: z0 + 6.6 } });
  }
  dining(C){
    const B = this.B, M = this.M, z0 = C.z0, z1 = C.z1;
    const wins = this.windows(z0 + 0.8, z1 - 2.6, 1.1, 1.1);
    this.sideWall(-1, z0, z1, wins); this.sideWall(1, z0, z1, wins);
    // tables by each window, two chairs each, a lamp on each table
    this.tables = [];
    for (const w of wins){
      const zc = (w.z0 + w.z1) / 2;
      for (const s of [-1, 1]){
        const xa = s < 0 ? -HW : 0.55, xb = s < 0 ? -0.55 : HW;
        B.box(xa, 0.74, zc - 0.45, xb, 0.78, zc + 0.45, M.cloth, 1, 'table');
        B.box((xa + xb) / 2 - 0.05, 0, zc - 0.05, (xa + xb) / 2 + 0.05, 0.74, zc + 0.05, M.brass, 1, 'table-leg');
        for (const dz of [-0.75, 0.75]){
          B.box(xa + 0.08, 0.44, zc + dz - 0.22, xb - 0.08, 0.5, zc + dz + 0.22, M.velvet, 1, 'chair');
          const back = dz < 0 ? [zc + dz - 0.26, zc + dz - 0.2] : [zc + dz + 0.2, zc + dz + 0.26];
          B.box(xa + 0.08, 0.5, back[0], xb - 0.08, 1.15, back[1], M.velvet, 1, 'chair-back');
          B.box(xa + 0.12, 0, zc + dz - 0.18, xa + 0.16, 0.44, zc + dz + 0.18, M.woodDark, 1, 'chair-leg');
        }
        this.wall(xa, zc - 1.0, xb, zc + 1.0, false);
        this.tableLamp(s * (HW - 0.16), 0.78, zc + 0.3);
        this.tables.push({ x: (xa + xb) / 2, z: zc, s });
        // plates and glasses on some tables
        if ((zc * 7 + s) % 3 > 1){ const p = new THREE.CylinderGeometry(0.11, 0.09, 0.015, 16); p.translate((xa + xb) / 2 - s * 0.1, 0.79, zc - 0.2); B.add(p, M.white); }
      }
    }
    // the bar at the back of the car
    const bz = z1 - 2.2;
    B.box(-HW, 0, bz, 0.2, 1.05, bz + 0.5, M.woodDark, 1, 'bar'); B.box(-HW, 1.05, bz - 0.04, 0.24, 1.09, bz + 0.54, M.brass, 1, 'bar-top');
    this.wall(-HW, bz, 0.24, bz + 0.5, false);
    for (let k = 0; k < 7; k++){ const b = new THREE.CylinderGeometry(0.04, 0.045, 0.3, 8); b.translate(-HW + 0.2 + k * 0.16, 1.55, z1 - 0.25); B.add(b, k % 2 ? mat('bottleGreen', { color: 0x1a4a2a, rough: 0.1 }) : mat('bottleBrown', { color: 0x5a2a0a, rough: 0.1 })); }
    B.box(-HW, 1.38, z1 - 0.4, 0.2, 1.4, z1 - 0.1, M.woodDark, 1, 'bar-shelf');
    // the Coke: always on a table
    const T0 = this.tables[2];
    this.cokePos = V(T0.x - T0.s * 0.15, 0.78, T0.z + 0.15);
    this.group.add(cokeBottle(this.cokePos));
    this.item('coke', 'A bottle of Coke', V(this.cokePos.x, 0.9, this.cokePos.z), 0.14, 'An ice-cold bottle of Coke, half drunk. Lots of people had some at dinner.');
    this.spot('dining', T0.x - T0.s * 0.2, T0.z - 0.85, 0.3);     // (you: by the Coke)
    this.spot('conductor', 0.6, bz - 0.7, Math.PI);
    this.playerStart = { x: 0, z: T0.z - 1.1, yaw: 0 };
  }
  lounge(C){
    const B = this.B, M = this.M, z0 = C.z0, z1 = C.z1;
    const wins = this.windows(z0 + 0.6, z1 - 0.6, 1.3, 0.7);
    this.sideWall(-1, z0, z1, wins); this.sideWall(1, z0, z1, wins);
    // a rug in the middle (1 cm above the carpet)
    B.box(-0.9, 0, z0 + 4.5, 0.9, 0.012, z0 + 9, mat('rug', { color: 0x7a3a1a, rough: 1 }), 1, 'rug');
    // armchairs by the windows
    for (const [s, z] of [[-1, z0 + 2.2], [1, z0 + 2.2], [-1, z0 + 10.6], [1, z0 + 10.6], [1, z0 + 12.4]]){
      const x = s * (HW - 0.45);
      B.box(x - 0.38, 0.2, z - 0.38, x + 0.38, 0.45, z + 0.38, M.greenVelvet, 1, 'armchair');
      B.box(s > 0 ? x + 0.25 : x - 0.38, 0.45, z - 0.38, s > 0 ? x + 0.38 : x - 0.25, 1.0, z + 0.38, M.greenVelvet, 1, 'armchair-back');
      for (const dz of [-0.38, 0.3]) B.box(x - 0.3, 0.45, z + dz, x + 0.3, 0.65, z + dz + 0.08, M.greenVelvet, 1, 'armchair-arm');
      B.box(x - 0.36, 0, z - 0.36, x + 0.36, 0.2, z + 0.36, M.woodDark, 1, 'armchair-base');
      this.wall(x - 0.4, z - 0.4, x + 0.4, z + 0.4, false);
    }
    // the card table (where two people play cards)
    const tz = z0 + 6.4;
    const top = new THREE.CylinderGeometry(0.42, 0.42, 0.04, 20); top.translate(0.75, 0.74, tz); B.add(top, M.greenVelvet);
    const leg = new THREE.CylinderGeometry(0.05, 0.08, 0.74, 8); leg.translate(0.75, 0.37, tz); B.add(leg, M.woodDark);
    this.wall(0.33, tz - 0.42, 1.17, tz + 0.42, false);
    for (let k = 0; k < 5; k++) B.box(0.6 + k * 0.06, 0.765, tz - 0.1 + (k % 2) * 0.08, 0.66 + k * 0.06, 0.768, tz - 0.02 + (k % 2) * 0.08, M.white, 1, 'card');
    // the piano, with a candlestick on top
    const pz = z0 + 4.2;
    B.box(-HW, 0, pz, -HW + 0.6, 1.3, pz + 1.5, M.black, 1, 'piano');
    B.box(-HW + 0.6, 0.7, pz + 0.05, -HW + 0.9, 0.75, pz + 1.45, M.black, 1, 'piano-keys');
    B.box(-HW + 0.6, 0.75, pz + 0.08, -HW + 0.85, 0.77, pz + 1.42, M.white, 1, 'piano-white');
    this.wall(-HW, pz, -HW + 0.9, pz + 1.5, false);
    this.candleTop = V(-HW + 0.3, 1.3, pz + 0.4);
    this.item('piano', 'The piano', V(-HW + 0.4, 1.1, pz + 0.75), 0.55, 'An upright piano. There\'s a ring in the dust on top, where a brass candlestick used to stand.', { home: 'candlestick' });
    // the bookcase
    const bz = z0 + 7.6;
    B.box(-HW, 0, bz, -HW + 0.35, 1.9, bz + 1.6, M.woodDark, 1, 'bookcase');
    const R = noiseRng(17);
    for (const y of [0.25, 0.75, 1.25]){ let z = bz + 0.05; while (z < bz + 1.5){ const w = 0.03 + R() * 0.05, h = 0.25 + R() * 0.15; B.box(-HW + 0.36, y, z, -HW + 0.38 + 0.0, y + h, z + w, mat('book' + Math.floor(R() * 4), { color: [0x6a2a1a, 0x1a3a5a, 0x2a4a2a, 0x8a6a2a][Math.floor(R() * 4)], rough: 0.8 }), 1, 'book'); z += w + 0.005; } }
    this.wall(-HW, bz, -HW + 0.4, bz + 1.6, true);
    this.item('bookcase', 'The bookcase', V(-HW + 0.3, 1.2, bz + 0.8), 0.6, 'Old books about trains, birds and faraway places. One shelf has a gap: a heavy book is missing, and one of the two lion bookends.', { home: 'book bookend' });
    // a small table with a glass on it
    const gz = z0 + 12.2;
    const st = new THREE.CylinderGeometry(0.25, 0.25, 0.03, 16); st.translate(-0.7, 0.6, gz); B.add(st, M.woodDark);
    const sl = new THREE.CylinderGeometry(0.03, 0.05, 0.6, 8); sl.translate(-0.7, 0.3, gz); B.add(sl, M.woodDark);
    this.wall(-0.95, gz - 0.25, -0.45, gz + 0.25, false);
    this.glassPos = { lounge: V(-0.7, 0.62, gz) };
    this.lamp(-HW + 0.1, 1.6, z0 + 3.2, 'bulb'); this.lamp(HW - 0.1, 1.6, z0 + 8.6, 'bulb');
    this.spot('lounge', 0.75, tz - 0.75, 0); this.spot('lounge', 0.75, tz + 0.75, Math.PI); this.spot('lounge', -HW + 1.25, pz + 0.75, -Math.PI / 2);
    this.sceneSpot('lounge', { body: { x: -0.1, z: z0 + 9.6, yaw: 0.3 }, weapon: { x: 0.45, z: z0 + 8.8 }, puddle: { x: 0.05, z: z0 + 10.9 } });
  }
  sleeper(C){
    const B = this.B, M = this.M, z0 = C.z0, z1 = C.z1;
    const CAB = 2.55, n = 7, cz0 = z0 + (C.len - CAB * n) / 2;
    const px = 0.45;          // the cabins' corridor wall
    this.cabins = [];
    const cwins = []; for (let k = 0; k < n; k++) cwins.push({ z0: cz0 + k * CAB + 0.7, z1: cz0 + k * CAB + 1.85 });
    this.sideWall(-1, z0, z1, cwins);
    this.sideWall(1, z0, z1, this.windows(z0 + 0.6, z1 - 0.6, 1.0, 0.8));
    // the ends of the cabin block
    B.box(-HW, 0, z0, px + 0.1, CEIL, cz0, M.wood, 1.2, 'cabin-end'); this.wall(-HW, z0, px + 0.1, cz0);
    B.box(-HW, 0, cz0 + n * CAB, px + 0.1, CEIL, z1, M.wood, 1.2, 'cabin-end'); this.wall(-HW, cz0 + n * CAB, px + 0.1, z1);
    for (let k = 0; k < n; k++){
      const a = cz0 + k * CAB, b = a + CAB, dz0 = a + 0.25, dz1 = a + 0.95;
      // corridor wall with a doorway
      B.box(px, 0, a, px + 0.1, CEIL, dz0, M.wood, 1.2, 'cabin-wall');
      B.box(px, 0, dz1, px + 0.1, CEIL, b, M.wood, 1.2, 'cabin-wall');
      B.box(px, DOOR_H, dz0, px + 0.1, CEIL, dz1, M.wood, 1.2, 'cabin-wall');
      this.wall(px, a, px + 0.1, dz0); this.wall(px, dz1, px + 0.1, b);
      // the sliding door, slid open (along the wall, 2 cm out into the corridor)
      B.box(px + 0.12, 0.02, dz1 + 0.02, px + 0.16, DOOR_H - 0.02, dz1 + 0.68, M.woodDark, 1, 'cabin-door');
      this.wall(px + 0.1, dz1, px + 0.18, dz1 + 0.7);
      // walls between cabins
      if (k > 0){ B.box(-HW, 0, a - 0.04, px, CEIL, a + 0.04, M.wood, 1.2, 'cabin-split'); this.wall(-HW, a - 0.04, px, a + 0.04); }
      // bed along the outer wall, under the window
      B.box(-HW, 0, a + 0.12, -HW + 0.75, 0.45, b - 0.12, M.woodDark, 1, 'bed');
      B.box(-HW + 0.02, 0.45, a + 0.16, -HW + 0.73, 0.6, b - 0.16, M.bedding, 1, 'mattress');
      B.box(-HW + 0.01, 0.6, a + 0.7, -HW + 0.74, 0.63, b - 0.17, M.blanket, 1, 'blanket');
      B.box(-HW + 0.1, 0.6, a + 0.2, -HW + 0.65, 0.72, a + 0.6, M.bedding, 1, 'pillow');
      this.wall(-HW, a + 0.12, -HW + 0.75, b - 0.12, false);
      // a suitcase
      B.box(-0.2, 0, b - 0.62, 0.3, 0.55, b - 0.42, k % 2 ? M.leather : mat('suitcaseBlue', { color: 0x2a3a5a, rough: 0.6 }), 1, 'suitcase');
      this.wall(-0.2, b - 0.62, 0.3, b - 0.42, false);
      this.lamp(-0.4, CEIL, a + CAB / 2);
      // the cabin number over the door, on the corridor side
      this.sign('Cabin ' + (k + 1), px + 0.12, DOOR_H + 0.18, (dz0 + dz1) / 2, Math.PI / 2, 0.6, 0.18);
      this.cabins.push({ z0: a, z1: b, door: (dz0 + dz1) / 2 });
      this.spot('cabin' + (k + 1), -0.3, a + 1.4, Math.PI / 2 + 0.3);
    }
    // the fire extinguisher's bracket, in the corridor
    this.extPos = V(HW - 0.05, 0.9, z0 + 1.2);
    B.box(HW - 0.04, 0.6, z0 + 1.05, HW - 0.01, 1.2, z0 + 1.35, M.steel, 1, 'bracket');
    this.item('bracket', 'An empty bracket', V(HW - 0.1, 0.9, z0 + 1.2), 0.3, 'A bracket on the wall for a fire extinguisher. The fire extinguisher isn\'t in it!', { home: 'extinguisher' });
    this.sceneSpot('sleeper', { body: { x: 0.95, z: z0 + 10.5, yaw: 0 }, weapon: { x: 1.15, z: z0 + 9.2 }, puddle: { x: 0.95, z: z0 + 11.6 } });
  }
  observation(C){
    const B = this.B, M = this.M, z0 = C.z0, z1 = C.z1;
    const wins = this.windows(z0 + 0.6, z1 - 0.6, 1.6, 0.35);
    this.sideWall(-1, z0, z1, wins, 0.6, 2.2); this.sideWall(1, z0, z1, wins, 0.6, 2.2);
    // benches down the middle, facing out
    for (const z of [z0 + 2.5, z0 + 6.5]){
      B.box(-0.3, 0, z, 0.3, 0.42, z + 2.6, M.woodDark, 1, 'bench');
      B.box(-0.34, 0.42, z, 0.34, 0.5, z + 2.6, M.velvet, 1, 'bench-seat');
      B.box(-0.05, 0.5, z, 0.05, 1.0, z + 2.6, M.velvet, 1, 'bench-back');
      this.wall(-0.35, z, 0.35, z + 2.6, false);
    }
    // plants in brass pots, an umbrella stand
    for (const z of [z0 + 1.2, z1 - 1.6]){ const p = new THREE.CylinderGeometry(0.2, 0.16, 0.4, 12); p.translate(HW - 0.3, 0.2, z); B.add(p, M.brass); const l = new THREE.SphereGeometry(0.35, 10, 8); l.scale(1, 1.4, 1); l.translate(HW - 0.3, 0.85, z); B.add(l, M.plant); this.wall(HW - 0.55, z - 0.25, HW, z + 0.25, false); }
    const uz = z1 - 0.8;
    const us = new THREE.CylinderGeometry(0.14, 0.12, 0.55, 12, 1, true); us.translate(-HW + 0.25, 0.275, uz); B.add(us, M.brass);
    for (let k = 0; k < 2; k++){ const u = new THREE.CylinderGeometry(0.012, 0.012, 0.9, 6); u.translate(-HW + 0.22 + k * 0.06, 0.45, uz + (k - 0.5) * 0.06); B.add(u, M.black); }
    this.wall(-HW, uz - 0.2, -HW + 0.45, uz + 0.2, false);
    this.item('umbrella-stand', 'The umbrella stand', V(-HW + 0.25, 0.6, uz), 0.35, 'Two umbrellas. The passengers\' walking sticks are kept here too, but the silver-topped one is gone.', { home: 'stick' });
    this.lamp(-HW + 0.1, 2.3, z0 + 4.5, 'bulb'); this.lamp(HW - 0.1, 2.3, z0 + 8.5, 'bulb');
    this.spot('observation', 0.8, z0 + 9.8, -Math.PI / 2 - 0.4); this.spot('observation', 0.8, z0 + 10.8, -Math.PI / 2 + 0.4); this.spot('observation', -0.8, z0 + 4, Math.PI / 2);
    this.sceneSpot('observation', { body: { x: 0.85, z: z0 + 5.2, yaw: 0 }, weapon: { x: -0.75, z: z0 + 5.8 }, puddle: { x: 0.75, z: z0 + 2.0 } });
  }
  platform(C){
    const B = this.B, M = this.M, z0 = C.z1, z1 = C.z1 + PLATFORM;
    B.box(-HW - T, -0.12, z0, HW + T, 0, z1, M.iron, 1, 'platform-floor');
    // railings
    for (const s of [-1, 1]){ B.box(s * HW - 0.03, 0.95, z0 + 0.1, s * HW + 0.03, 1.0, z1, M.brass, 1, 'rail'); this.wall(s * HW - 0.05, z0, s * HW + 0.05, z1, false); this.wall(s * (HW + 0.5) - 0.3, z0, s * (HW + 0.5) + 0.3, z1, true); }
    B.box(-HW, 0.95, z1 - 0.06, HW, 1.0, z1, M.brass, 1, 'rail'); this.wall(-HW, z1 - 0.06, HW, z1, false); this.wall(-HW - 1, z1, HW + 1, z1 + 0.5, true);
    for (let k = 0; k <= 6; k++){ const x = -HW + k * (2 * HW) / 6; B.box(x - 0.02, 0, z1 - 0.05, x + 0.02, 0.95, z1 - 0.01, M.brass, 1, 'baluster'); }
    for (let k = 1; k < 4; k++) for (const s of [-1, 1]) B.box(s * HW - 0.02, 0, z0 + k * 0.6 - 0.02, s * HW + 0.02, 0.95, z0 + k * 0.6 + 0.02, M.brass, 1, 'baluster');
    // the canopy
    B.box(-HW - T, CEIL + 0.02, z0, HW + T, CEIL + 0.1, z1 - 0.4, M.black, 1, 'canopy');
    this.lamp(0, CEIL - 0.05, z0 + 1.0, 'bulb');
    this.spot('platform', -0.6, z0 + 1.2, Math.PI / 2); this.spot('platform', 0.6, z0 + 1.2, -Math.PI / 2); this.spot('platform', 0, z0 + 1.6, Math.PI);
    this.platformZ = [z0, z1];
  }
  sceneSpot(id, s){ (this.scenes = this.scenes || {})[id] = s; }
  // where you leave a car going to the front or back (the middle of its end door)
  exit(id, dir){ const C = this.cars[id]; return { x: (C.door[0] + C.door[1]) / 2, z: dir === 'front' ? C.z0 + 0.4 : C.z1 - 0.4 }; }
  // the door handle at the end of a car (the one nearest the given z)
  doorAt(id, z){ const C = this.cars[id]; const front = Math.abs(z - C.z0) < Math.abs(z - C.z1); return { pos: V(C.door[1] - 0.12, 1.0, front ? C.z0 + 0.06 : C.z1 - 0.06), front }; }
  carAt(z){ for (const C of Object.values(this.cars)) if (z >= C.z0 - GAP / 2 && z <= C.z1 + GAP / 2) return C; return z > this.cars.observation.z1 ? { id: 'platform', name: 'Back Platform' } : null; }

  // ---------- collisions ----------
  // push a circle at p (x, z) out of the walls; tallOnly: only the tall ones (your real head in VR)
  collide(p, r = 0.22, tallOnly = false){
    for (let it = 0; it < 2; it++){
      for (const w of this.walls){
        if (tallOnly && !w.tall) continue;
        const cx = clamp(p.x, w.x0, w.x1), cz = clamp(p.z, w.z0, w.z1);
        const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-8){ const d = Math.sqrt(d2), k = (r - d) / d; p.x += dx * k; p.z += dz * k; }
        else {
          // inside the box: out the nearest side
          const o = [[p.x - w.x0 + r, -1, 0], [w.x1 - p.x + r, 1, 0], [p.z - w.z0 + r, 0, -1], [w.z1 - p.z + r, 0, 1]].sort((a, b) => a[0] - b[0])[0];
          p.x += o[1] * o[0]; p.z += o[2] * o[0];
        }
      }
    }
    // never outside the train
    p.x = clamp(p.x, -HW + r * 0.5, HW - r * 0.5); p.z = clamp(p.z, 0.2, this.length + PLATFORM - 0.2);
    return p;
  }

  // ---------- lights ----------
  buildLights(){
    this.hemi = new THREE.HemisphereLight(0xffe8c8, 0x302018, 0.55); this.scene.add(this.hemi);
    this.moon = new THREE.DirectionalLight(0x8aa0d0, 0.35); this.moon.position.set(-40, 60, 20); this.scene.add(this.moon);
    this.pool = [];
    for (let i = 0; i < 4; i++){ const l = new THREE.PointLight(0xffd8a0, 0, 9, 1.6); this.scene.add(l); this.pool.push(l); }
    this.power = 1; this.flash = 0;
  }
  // power: 1 = lights on, 0 = blackout; flicker handled by the caller
  setPower(v){
    this.power = v;
    this.M.lamp.emissiveIntensity = 1.6 * v;
    this.hemi.intensity = 0.06 + 0.5 * v;
  }
  updateLights(head, dt){
    // the four lamps nearest you get real lights
    const near = this.lamps.map((p) => [p, p.distanceToSquared(head)]).sort((a, b) => a[1] - b[1]).slice(0, 4);
    near.forEach(([p], i) => { this.pool[i].position.copy(p); this.pool[i].intensity = 3.2 * this.power; });
    // lightning
    this.flash = Math.max(0, this.flash - dt * 3);
    this.moon.intensity = 0.25 + this.flash * 4;
    if (this.sky) this.sky.material.uniforms.flash.value = this.flash;
  }

  // ---------- outside: the night rushing past ----------
  buildOutside(){
    const s = this.scene, out = this.outside = new THREE.Group(); s.add(out);
    const mid = this.length / 2;
    // sky
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 24, 12), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { flash: { value: 0 } },
      vertexShader: 'varying vec3 d; void main(){ d = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }',
      fragmentShader: `uniform float flash; varying vec3 d;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
        void main(){ vec3 v = normalize(d); float y = max(v.y, 0.0);
          vec3 c = mix(vec3(0.05, 0.06, 0.09), vec3(0.015, 0.02, 0.04), pow(y, 0.5));
          vec2 uv = v.xz / (v.y + 0.15) * 1.6; float k = n(uv) * 0.55 + n(uv * 2.7) * 0.3 + n(uv * 6.1) * 0.15;
          c = mix(c, vec3(0.09, 0.1, 0.13), smoothstep(0.35, 0.8, k));
          c += vec3(0.55, 0.6, 0.75) * flash * (0.4 + 0.6 * k);
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    }));
    this.sky.frustumCulled = false; this.sky.renderOrder = -1; this.sky.position.set(0, 0, mid); s.add(this.sky);
    // mountains far away
    const mt = mountainsTex(); mt.wrapS = THREE.RepeatWrapping; mt.repeat.set(3, 1);
    const mm = new THREE.Mesh(new THREE.CylinderGeometry(600, 600, 260, 48, 1, true), new THREE.MeshBasicMaterial({ map: mt, transparent: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    mm.position.set(0, 60, mid); out.add(mm);
    // the ground, scrolling past
    const gt = groundTex(); gt.repeat.set(40, 40);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshStandardMaterial({ map: gt, roughness: 1 }));
    this.ground.rotation.x = -Math.PI / 2; this.ground.position.set(0, -1.25, mid); out.add(this.ground);
    // the track: rails (still), sleepers (rushing past)
    for (const x of [-0.72, 0.72]){ const r = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 1200), mat('rail', { color: 0x6a6a70, rough: 0.3, metal: 0.8 })); r.position.set(x, -1.0, mid); out.add(r); }
    const ballast = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.2, 1200), mat('ballast', { color: 0x3a3632, rough: 1 })); ballast.position.set(0, -1.18, mid); out.add(ballast);
    const SL = 260;
    this.sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 0.1, 0.22), mat('sleeper', { color: 0x3a2a1a, rough: 1 }), SL);
    this.sleepers.frustumCulled = false; out.add(this.sleepers); this.sleeperGap = 0.65; this.sleeperN = SL;
    // trees and telegraph poles
    const tree = new THREE.ConeGeometry(2.2, 8, 7); tree.translate(0, 5, 0);
    const trunk = new THREE.CylinderGeometry(0.25, 0.3, 1.6, 6); trunk.translate(0, 0.8, 0);
    const { mergeGeometries } = this.mergeHelper || {};
    void mergeGeometries;
    this.trees = new THREE.InstancedMesh(tree, mat('pine', { color: 0x0e1a12, rough: 1 }), 320);
    this.trees.frustumCulled = false; out.add(this.trees);
    const R = noiseRng(41);
    this.treeData = [];
    for (let i = 0; i < 320; i++){
      const side = R() < 0.5 ? -1 : 1, x = side * (9 + Math.pow(R(), 1.6) * 160), z = (R() - 0.5) * 800, sc = 0.6 + R() * 1.2;
      this.treeData.push({ x, z, sc, y: -1.25 });
    }
    this.poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.12, 7, 6), mat('pole', { color: 0x2a2018, rough: 1 }), 24);
    this.poles.frustumCulled = false; out.add(this.poles);
    // rain: streaks falling (and blown back) round the train
    const N = 900, pos = new Float32Array(N * 6);
    this.rainData = new Float32Array(N * 3);
    for (let i = 0; i < N; i++){ this.rainData[i * 3] = (R() - 0.5) * 30; this.rainData[i * 3 + 1] = R() * 14 - 2; this.rainData[i * 3 + 2] = R() * 130 - 10; }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x8a9ab8, transparent: true, opacity: 0.45 }));
    this.rain.frustumCulled = false; out.add(this.rain);
    this.scroll = 0;
    this.m4 = new THREE.Matrix4();
    this.updateOutside(0);
  }
  updateOutside(dt){
    this.scroll += dt * SPEED;
    const mid = this.length / 2, M = this.m4, wrap = (z, span) => ((z % span) + span) % span - span / 2;
    this.ground.material.map.offset.y = -(this.scroll / 1200) * 40;
    for (let i = 0; i < this.sleeperN; i++){ M.makeTranslation(0, -1.08, mid + wrap(i * this.sleeperGap + this.scroll, this.sleeperN * this.sleeperGap)); this.sleepers.setMatrixAt(i, M); }
    this.sleepers.instanceMatrix.needsUpdate = true;
    const q = new THREE.Quaternion(), sc = V();
    this.treeData.forEach((t, i) => { sc.setScalar(t.sc); M.compose(V(t.x, t.y, mid + wrap(t.z + this.scroll, 800)), q, sc); this.trees.setMatrixAt(i, M); });
    this.trees.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < 24; i++){ M.makeTranslation(-4.2, 2.3, mid + wrap(i * 45 + this.scroll, 24 * 45)); this.poles.setMatrixAt(i, M); }
    this.poles.instanceMatrix.needsUpdate = true;
    const p = this.rain.geometry.attributes.position.array, D = this.rainData;
    for (let i = 0; i < D.length / 3; i++){
      D[i * 3 + 1] -= dt * 11; D[i * 3 + 2] += dt * 9;
      if (D[i * 3 + 1] < -1.2){ D[i * 3 + 1] += 14; }
      if (D[i * 3 + 2] > 120) D[i * 3 + 2] -= 130;
      let x = D[i * 3]; if (Math.abs(x) < 1.6 && D[i * 3 + 2] < this.length) x = Math.sign(x || 1) * (1.6 + Math.abs(x));   // (not inside the train)
      p[i * 6] = x; p[i * 6 + 1] = D[i * 3 + 1]; p[i * 6 + 2] = D[i * 3 + 2];
      p[i * 6 + 3] = x; p[i * 6 + 4] = D[i * 3 + 1] + 0.45; p[i * 6 + 5] = D[i * 3 + 2] - 0.35;
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
    // rain running down the windows
    this.M.glass.map.offset.y += dt * 0.08;
  }
}
// the Coke: a glass contour bottle, half drunk, with its red label
export function cokeBottle(pos){
  const G = new THREE.Group();
  const prof = [[0, 0], [0.028, 0], [0.03, 0.008], [0.029, 0.045], [0.025, 0.07], [0.029, 0.1], [0.03, 0.118], [0.026, 0.142], [0.016, 0.172], [0.0125, 0.188], [0.0142, 0.193], [0.0142, 0.2], [0, 0.2]].map(([r, y]) => new THREE.Vector2(r, y));
  const glass = new THREE.Mesh(new THREE.LatheGeometry(prof, 28), new THREE.MeshStandardMaterial({ color: 0xa8d0b8, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.4, depthWrite: false }));
  const lprof = prof.filter((v) => v.y <= 0.105).map((v) => new THREE.Vector2(v.x * 0.9, v.y + 0.002)); lprof.push(new THREE.Vector2(0, 0.105));
  const cola = new THREE.Mesh(new THREE.LatheGeometry(lprof, 24), new THREE.MeshStandardMaterial({ color: 0x2a0c04, roughness: 0.15 }));
  // the label: red, with the name in white
  const t = textCanvas(512, 128), g = t.ctx;
  g.fillStyle = '#d0141c'; g.fillRect(0, 0, 512, 128); g.fillStyle = '#ffffff'; g.font = 'italic bold 72px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const x of [128, 384]) g.fillText('Coca-Cola', x, 66);
  t.tex.needsUpdate = true;
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.0302, 0.0302, 0.032, 28, 1, true), new THREE.MeshStandardMaterial({ map: t.tex, roughness: 0.5 }));
  label.position.y = 0.083;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.0155, 0.0155, 0.009, 16), mat('cokeCap', { color: 0xc81a1a, rough: 0.4, metal: 0.6 }));
  cap.position.y = 0.2045;
  cola.renderOrder = 1; glass.renderOrder = 2;
  G.add(cola, label, cap, glass);
  G.position.copy(pos); G.position.y += 0.001;
  return G;
}
// a small canvas label (used for the evidence tents)
export function labelTexture(text){
  const t = textCanvas(128, 128), g = t.ctx;
  g.fillStyle = '#f4c430'; g.fillRect(0, 0, 128, 128); g.fillStyle = '#1a1a1a'; g.font = 'bold 84px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 64, 68);
  t.tex.needsUpdate = true; return t.tex;
}
