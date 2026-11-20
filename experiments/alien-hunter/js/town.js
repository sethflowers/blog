// The town: two crossing streets with sidewalks, sixteen buildings (twelve houses and four shops) that
// you can walk into, a park with a fountain at each end of Elm Street, trees, lamps, parked cars and a
// hedge round it all. Physically based materials with made-up textures (textures.js): weatherboard and
// brick houses, shingle roofs, asphalt, concrete sidewalks, brick paths, wood floors, plastered rooms.
// Everything static is merged into one mesh per material (Batch); trees and cars are instanced. Doors swing open when
// somebody comes near. Also: what stops you (walls are tall, furniture is low), the floor height
// anywhere, rays against walls (for the shock gun), and a walking graph for the townsfolk.
import * as THREE from 'three';
import { V, Batch, boxUV, mat, rng, textCanvas, mergeGeometries, paint, hash2, vnoise } from './util.js';
import { mergeVertices } from '/experiments/alien-hunter/lib/addons/BufferGeometryUtils.js';
import { textures } from './textures.js';

export const W = 8, D = 8, H = 3.2, T = 0.2, FLOOR_Y = 0.12, DOOR_W = 1.3, DOOR_H = 2.4;
export const BOUND = 66;                     // you can't go past the hedge
export const START = { x: 0, z: 9, yaw: 0 };  // where you start: on Elm Street, looking up it

const ROAD = 4, WALK_IN = 4, WALK_OUT = 6.5, WALK_MID = 5.25, MAIN_X = 64, CROSS_Z = 46;
// weatherboard colours (the siding texture is near white), plaster colours inside, roof and door colours
const WALL_COLS = ['#ece8de', '#c4d2da', '#e6dab8', '#b8c4aa', '#d8c8b4', '#a8b6c0', '#e8d4c8', '#c8ccc0'];
const INSIDE_COLS = ['#efe9dd', '#e4e8e2', '#efe2cf', '#e2e6ea', '#f0e6e0', '#e8e4d4'];
const ROOF_COLS = ['#6a6a70', '#7a5a48', '#4e5a66', '#8a4e3e', '#5e6452'];
const DOOR_COLS = ['#7a2a24', '#2a3a5a', '#2e4a3a', '#e8e2d4', '#3a3a3e', '#8a6a3a'];
const SHOPS = [
  { name: 'BAKERY', col: '#e8dcc8', awn: '#a83a4a', sign: '#a83a4a', brick: true },
  { name: 'TOY SHOP', col: '#c8d4dc', awn: '#2e5a8a', sign: '#2e5a8a', brick: false },
  { name: 'DINER', col: '#ece4d4', awn: '#9a2e26', sign: '#1e6a7a', brick: false },
  { name: 'GROCER', col: '#d4dcc4', awn: '#3a6a3a', sign: '#3a6a3a', brick: true },
];

export class Town {
  constructor(scene){
    this.scene = scene;
    this.root = new THREE.Group(); scene.add(this.root);
    this.colliders = [];   // { x0, x1, z0, z1, y1, tall }
    this.floors = [];      // { x0, x1, z0, z1, y }
    this.roofs = [];       // boxes that stop the shock gun
    this.houses = [];
    this.doors = [];
    this.nodes = []; this.adj = [];
    this.build();
  }

  // ---------- building ----------
  build(){
    const R = rng(7);
    const B = new Batch(), roofB = new Batch();
    this.B = B;
    const X = this.tex = textures();
    const grass = mat('grass', '#ffffff', { map: X.grass, roughness: 0.95 }), road = mat('road', '#ffffff', { map: X.asphalt, normalMap: X.asphaltN, roughness: 0.92 });
    const walk = mat('sidewalk', '#ffffff', { map: X.concrete, normalMap: X.concreteN, roughness: 0.9 }), line = mat('roadline', '#e4dfcc', { roughness: 0.75 });
    const hedge = mat('hedge', '#ffffff', { map: X.hedge, roughness: 0.95 });
    this.treeSpots = [];
    // the ground, out to the hills (its texture coordinates in metres, like every box's)
    const cg = new THREE.CircleGeometry(420, 48), cu = cg.attributes.uv;
    for (let i = 0; i < cu.count; i++) cu.setXY(i, (cu.getX(i) - 0.5) * 840, (cu.getY(i) - 0.5) * 840);
    const g = new THREE.Mesh(cg.rotateX(-Math.PI / 2), grass);
    g.receiveShadow = true; this.root.add(g);
    // roads (Main Street along x, Elm Street along z, split so they don't overlap at the crossing)
    B.box(MAIN_X * 2, 0.02, ROAD * 2, road, 0, 0.01, 0);
    for (const s of [-1, 1]) B.box(ROAD * 2, 0.02, CROSS_Z - ROAD, road, 0, 0.01, s * (CROSS_Z + ROAD) / 2);
    for (let x = -MAIN_X + 2; x < MAIN_X - 2; x += 4) if (Math.abs(x) > 9) B.box(2, 0.01, 0.18, line, x, 0.025, 0);
    for (let z = 10; z < CROSS_Z - 1; z += 4) for (const s of [-1, 1]) B.box(0.18, 0.01, 2, line, 0, 0.025, s * z);
    // zebra crossings next to the crossroads
    for (let i = -3; i <= 3; i++) for (const s of [-1, 1]){
      B.box(2.6, 0.01, 0.5, line, s * WALK_MID, 0.025, i * 1.1);
      B.box(0.5, 0.01, 2.6, line, i * 1.1, 0.025, s * WALK_MID);
    }
    // sidewalks (raised kerbs)
    const sw = (x0, x1, z0, z1) => { B.box(x1 - x0, 0.12, z1 - z0, walk, (x0 + x1) / 2, 0.06, (z0 + z1) / 2); this.floors.push({ x0, x1, z0, z1, y: 0.12 }); };
    for (const s of [-1, 1]){
      sw(-MAIN_X, -ROAD, s > 0 ? WALK_IN - 0 : -WALK_OUT, s > 0 ? WALK_OUT : -WALK_IN);
      sw(ROAD, MAIN_X, s > 0 ? WALK_IN : -WALK_OUT, s > 0 ? WALK_OUT : -WALK_IN);
      sw(s > 0 ? WALK_IN : -WALK_OUT, s > 0 ? WALK_OUT : -WALK_IN, -CROSS_Z, -WALK_OUT);
      sw(s > 0 ? WALK_IN : -WALK_OUT, s > 0 ? WALK_OUT : -WALK_IN, WALK_OUT, CROSS_Z);
    }
    this.floors.push({ x0: -MAIN_X, x1: MAIN_X, z0: -ROAD, z1: ROAD, y: 0.02 }, { x0: -ROAD, x1: ROAD, z0: -CROSS_Z, z1: CROSS_Z, y: 0.02 });
    // the buildings
    let n = 0, shop = 0;
    const add = (cx, cz, yaw, kind) => this.house(B, roofB, { id: n++, cx, cz, yaw, kind, shop: kind === 'shop' ? SHOPS[shop++] : null }, R);
    for (const x of [-52, -36, -20, 20, 36, 52]){
      const kind = Math.abs(x) === 20 ? 'shop' : 'house';
      add(x, -14.5, 0, kind); add(x, 14.5, Math.PI, kind);
    }
    for (const z of [-32, 32]){ add(14.5, z, -Math.PI / 2, 'house'); add(-14.5, z, Math.PI / 2, 'house'); }
    // parks with fountains at both ends of Elm Street
    for (const s of [-1, 1]) this.park(B, s * 56, R);
    // street lamps
    for (const x of [-60, -44, -28, -12, 12, 28, 44, 60]) for (const s of [-1, 1]) this.lamp(B, x, s * 4.45);
    for (const z of [-40, -24, 24, 40]) for (const s of [-1, 1]) this.lamp(B, s * 4.45, z);
    // trees: in the gaps between buildings and round the edge
    for (const x of [-60, -44, -28, 28, 44, 60]) for (const s of [-1, 1]) this.tree(B, x, s * 11 + s * R() * 6, 0.9 + R() * 0.4);
    for (const z of [-42, -22, 22, 42]) for (const s of [-1, 1]) this.tree(B, s * (11 + R() * 4), z + (R() - 0.5) * 3, 0.9 + R() * 0.4);
    for (let i = 0; i < 40; i++){
      const a = R() * Math.PI * 2, r = 58 + R() * 6, x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.abs(x) < 9 || Math.abs(z) < 9 || (Math.abs(x) < 12 && Math.abs(z) > 48)) continue;
      if (Math.abs(x) <= BOUND - 2 && Math.abs(z) <= BOUND - 2) this.tree(B, x, z, 1 + R() * 0.5);
    }
    // the hedge round the town (gaps where the streets leave town are hedged too: there's nowhere to go)
    for (const s of [-1, 1]){
      B.box((BOUND + 2) * 2 + 1, 1.5, 1, hedge, 0, 0.75, s * (BOUND + 1.5));
      B.box(1, 1.5, (BOUND + 2) * 2 - 1, hedge, s * (BOUND + 1.5), 0.75, 0);
    }
    this.cars();
    const FLAT = new Set(['grass', 'road', 'sidewalk', 'roadline', 'path', 'floor', 'tiles']);
    // (left out of the X-ray view: big flat surfaces, plaster linings and ceilings, seen edge-on, flood it with glow)
    const flat = (m) => FLAT.has(m.material.name) || /^(rug|plaster|ceiling)/.test(m.material.name);
    this.flat = [g, this.hills(), ...B.build(this.root, { shadows: true, receive: true }).filter(flat)];
    this.buildTrees();
    // (roofs don't shade the rooms below, so inside is bright)
    this.flat.push(...roofB.build(this.root, { shadows: false, receive: true }).filter(flat));
    this.navLinks();
  }

  // a house or shop. Local space: the front faces +z (toward its street), the door is at (0, D/2).
  house(B, roofB, h, R){
    const c = Math.cos(h.yaw), s = Math.sin(h.yaw);
    const L2W = (x, z) => ({ x: h.cx + x * c + z * s, z: h.cz - x * s + z * c });
    h.toWorld = L2W;
    const box = (sx, sy, sz, mat, x, y, z, collide, batch = B, rx = 0) => {
      const p = L2W(x, z);
      if (rx) batch.add(boxUV(sx, sy, sz), mat, new THREE.Matrix4().compose(V(p.x, y, p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, h.yaw, 0, 'YXZ')), V(1, 1, 1)));
      else batch.box(sx, sy, sz, mat, p.x, y, p.z, h.yaw);
      if (collide){
        const swap = Math.abs(s) > 0.5, hx = (swap ? sz : sx) / 2, hz = (swap ? sx : sz) / 2;
        this.colliders.push({ x0: p.x - hx, x1: p.x + hx, z0: p.z - hz, z1: p.z + hz, y1: y + sy / 2, tall: collide === 'tall' });
      }
    };
    h.box = box;
    const shop = h.shop;
    const X = this.tex, col = WALL_COLS[h.id % WALL_COLS.length];
    // outside: brick (every third house, two of the shops), weatherboards, or painted render (shops)
    const brick = shop ? shop.brick : h.id % 3 === 1;
    const wall = brick ? mat('brick', '#ffffff', { map: X.brick, normalMap: X.brickN, roughness: 0.9 })
      : shop ? mat('render-' + shop.name, shop.col, { normalMap: X.plasterN, roughness: 0.9 })
      : mat('siding' + col, col, { map: X.siding, normalMap: X.sidingN, roughness: 0.75 });
    const inCol = INSIDE_COLS[h.id % INSIDE_COLS.length], plaster = mat('plaster' + inCol, inCol, { normalMap: X.plasterN, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.92 });
    h.plaster = plaster;
    const frame = mat('trim', '#f2f0ea', { roughness: 0.55 }), glass = mat('glass', '#5a6a78', { roughness: 0.05, metalness: 0.35 });
    const floor = shop ? mat('tiles', '#ffffff', { map: X.tiles, roughness: 0.35 }) : mat('floor', '#ffffff', { map: X.planks, normalMap: X.planksN, roughness: 0.45 });
    // floor slab (2 cm inside the walls' outer faces so they don't flicker)
    box(W - 0.04, FLOOR_Y, D - 0.04, floor, 0, FLOOR_Y / 2, 0);
    const p0 = L2W(-W / 2, -D / 2), p1 = L2W(W / 2, D / 2);
    this.floors.push({ x0: Math.min(p0.x, p1.x), x1: Math.max(p0.x, p1.x), z0: Math.min(p0.z, p1.z), z1: Math.max(p0.z, p1.z), y: FLOOR_Y });
    // walls: back, sides, and the front either side of the door with a lintel over it
    box(W, H, T, wall, 0, H / 2, -D / 2 + T / 2, 'tall');
    box(T, H, D - 2 * T, wall, -W / 2 + T / 2, H / 2, 0, 'tall');
    box(T, H, D - 2 * T, wall, W / 2 - T / 2, H / 2, 0, 'tall');
    const seg = (W - DOOR_W) / 2;
    box(seg, H, T, wall, -(W / 2 - seg / 2), H / 2, D / 2 - T / 2, 'tall');
    box(seg, H, T, wall, W / 2 - seg / 2, H / 2, D / 2 - T / 2, 'tall');
    box(DOOR_W, H - DOOR_H, T, wall, 0, DOOR_H + (H - DOOR_H) / 2, D / 2 - T / 2);
    // inside, the walls are plastered: a lining 1 cm thick on every inside face (floor to ceiling)
    const L = 0.01, y0 = FLOOR_Y, y1 = H - 0.065, ly = (y0 + y1) / 2, lh = y1 - y0;
    box(W - 2 * T, lh, L, plaster, 0, ly, -D / 2 + T + L / 2);
    box(L, lh, D - 2 * T, plaster, -W / 2 + T + L / 2, ly, 0);
    box(L, lh, D - 2 * T, plaster, W / 2 - T - L / 2, ly, 0);
    const fs = seg - T;
    box(fs, lh, L, plaster, -(DOOR_W / 2 + fs / 2), ly, D / 2 - T - L / 2);
    box(fs, lh, L, plaster, DOOR_W / 2 + fs / 2, ly, D / 2 - T - L / 2);
    box(DOOR_W, y1 - DOOR_H, L, plaster, 0, (DOOR_H + y1) / 2, D / 2 - T - L / 2);
    // windows: a white frame 2 cm proud of the wall (1 cm proud of the plaster inside), the glass 1 cm
    // proud of the frame (both sides)
    const win = (x, z, ry, w, hh, y) => {
      const fw = ry ? T + 0.04 : w + 0.2, fd = ry ? w + 0.2 : T + 0.04;
      box(fw, hh + 0.2, fd, frame, x, y, z);
      box(ry ? T + 0.06 : w, hh, ry ? w : T + 0.06, glass, x, y, z);
    };
    if (shop){ for (const sx of [-1, 1]) win(sx * 2.35, D / 2 - T / 2, 0, 2.3, 1.5, 1.45); }
    else { for (const sx of [-1, 1]) win(sx * 2.4, D / 2 - T / 2, 0, 1.2, 1.0, 1.65); }
    win(-W / 2 + T / 2, 1.6, 1, 1.2, 1.0, 1.75); win(W / 2 - T / 2, 1.6, 1, 1.2, 1.0, 1.75);
    win(2.4, -D / 2 + T / 2, 0, 1.2, 1.0, 1.75);
    // a white ceiling just under the roof (half a centimetre below it)
    box(W - 2 * T, 0.05, D - 2 * T, mat('ceiling', '#f4f2ec', { emissive: '#7a7872', roughness: 0.95 }), 0, H - 0.04, 0, null, roofB);
    if (shop){
      // flat roof, a striped awning and a big sign on top
      box(W + 0.4, 0.3, D + 0.4, mat('flatroof', '#5e5e62', { roughness: 0.95 }), 0, H - 0.01 + 0.15, 0, null, roofB);
      for (let i = 0; i < 8; i++) box((W - 0.6) / 8 - 0.02, 0.08, 1.3, mat('awn' + (i % 2 ? 'w' : shop.name), i % 2 ? '#ece8de' : shop.awn, { roughness: 0.9 }), -W / 2 + 0.3 + (i + 0.5) * (W - 0.6) / 8, 2.72, D / 2 + 0.62, null, roofB, 0.32);
      box(5.2, 1.1, 0.16, mat('signboard', '#3a3a3e', { roughness: 0.6 }), 0, H + 0.3 + 0.55, D / 2 - 0.12);
      const tc = textCanvas(512, 112), gx = tc.ctx;
      gx.fillStyle = shop.sign; gx.fillRect(0, 0, 512, 112); gx.strokeStyle = '#e8dcb8'; gx.lineWidth = 6; gx.strokeRect(8, 8, 496, 96);
      gx.fillStyle = '#f4ecd8'; gx.font = 'bold 66px Georgia, "Times New Roman", serif'; gx.textAlign = 'center'; gx.textBaseline = 'middle'; gx.fillText(shop.name, 256, 60);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(5.0, 1.0), new THREE.MeshStandardMaterial({ map: tc.tex, roughness: 0.6 }));
      const sp = L2W(0, D / 2 - 0.12 + 0.08 + 0.01); sign.position.set(sp.x, H + 0.85, sp.z); sign.rotation.y = h.yaw; this.root.add(sign);
      this.roofs.push(this.aabb(h, W + 0.4, D + 0.4, H, H + 1.6));
    } else {
      // a pitched roof and a chimney
      const rc = ROOF_COLS[(h.id * 3 + 1) % ROOF_COLS.length];
      const shape = new THREE.Shape([new THREE.Vector2(-D / 2 - 0.45, 0), new THREE.Vector2(D / 2 + 0.45, 0), new THREE.Vector2(0, 2.0)]);
      const rg = new THREE.ExtrudeGeometry(shape, { depth: W + 0.6, bevelEnabled: false });
      rg.translate(0, 0, -(W + 0.6) / 2); rg.rotateY(Math.PI / 2);
      const rp = L2W(0, 0);
      roofB.add(rg, mat('roof' + rc, rc, { map: X.shingle, normalMap: X.shingleN, roughness: 0.9 }), new THREE.Matrix4().compose(V(rp.x, H - 0.01, rp.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, h.yaw, 0)), V(1, 1, 1)));
      box(0.6, 1.6, 0.6, mat('brick', '#ffffff', { map: X.brick, normalMap: X.brickN, roughness: 0.9 }), 2.2, H + 1.2, -1.6, null, roofB);
      this.roofs.push(this.aabb(h, W + 0.6, D + 0.9, H, H + 2.0));
    }
    // the door: hinged on its left, swings inward when someone comes near
    const doorCol = DOOR_COLS[(h.id * 5 + 2) % DOOR_COLS.length];
    const pivot = new THREE.Group();
    const hp = L2W(-DOOR_W / 2 + 0.03, D / 2 - T / 2);
    pivot.position.set(hp.x, FLOOR_Y, hp.z); pivot.rotation.y = h.yaw;
    const door = new THREE.Mesh(Town.doorGeo || (Town.doorGeo = new THREE.BoxGeometry(DOOR_W - 0.06, DOOR_H - FLOOR_Y - 0.03, 0.07).translate((DOOR_W - 0.06) / 2, (DOOR_H - FLOOR_Y - 0.03) / 2, 0)), mat('door' + doorCol, doorCol, { roughness: 0.5 }));
    const knob = new THREE.Mesh(Town.knobGeo || (Town.knobGeo = new THREE.SphereGeometry(0.05, 10, 8)), mat('brass', '#c8a050', { metalness: 1, roughness: 0.3 }));
    knob.position.set(DOOR_W - 0.22, 1.0, 0.07); door.add(knob);
    door.castShadow = true; pivot.add(door); this.root.add(pivot);
    const dp = L2W(0, D / 2 - T / 2);
    this.doors.push({ pivot, yaw: h.yaw, x: dp.x, z: dp.z, a: 0 });
    // the front path to the sidewalk, a mailbox, a tree
    box(1.4, 0.04, 4, stoneMat(), 0, 0.02, D / 2 + 2);
    this.floors.push({ ...this.aabb(h, 1.4, 0, 0, 0, D / 2 + 2, 4), y: 0.04 });
    if (!shop){
      box(0.1, 1.0, 0.1, mat('post', '#5a4a3a'), 1.6, 0.5, D / 2 + 3.4, 'low');
      box(0.3, 0.26, 0.46, mat('mailbox', '#2a2c30', { metalness: 0.6, roughness: 0.45 }), 1.6, 1.1, D / 2 + 3.4);
      const tp = L2W(-2.9, D / 2 + 2.2); this.tree(B, tp.x, tp.z, 0.8 + R() * 0.3);
    }
    // inside
    if (shop) this.shopInside(h, box); else this.houseInside(h, box, R);
    this.houses.push(h);
    // the walking graph: porch (outside the door), inside the door, then the rooms
    const node = (x, z, kind, house = h.id) => { const p = L2W(x, z); return this.node(p.x, p.z, kind, house); };
    h.porch = node(0, D / 2 + 1.2, 'door', -1); h.inside = node(0, D / 2 - 1.4, 'door');
    this.link(h.porch, h.inside);
    h.rooms = [];
    const room = (x, z, from) => { const k = node(x, z, 'room'); this.link(k, from); h.rooms.push(k); return k; };
    if (shop){
      const front = room(0, -0.9, h.inside); room(-2.2, 1.0, h.inside); const ar = room(2.2, 1.0, h.inside);
      const side = node(3.15, -1.15, 'room'); this.link(side, ar); this.link(side, front);
      const back = node(3.15, -3.0, 'room'); this.link(back, side);
      room(0.6, -3.0, back);
    } else {
      const hall = node(-1.0, 0.6, 'room'); this.link(hall, h.inside);
      room(-0.9, 2.0, h.inside); room(-2.7, 0.4, hall);
      const lounge = room(2.4, 0.2, h.inside); room(2.4, -2.2, lounge);
      const mid = node(0.3, -0.6, 'room'); this.link(mid, h.inside); room(-1.4, -2.6, mid);
    }
    // the gate: the sidewalk point in front of the house
    const gp = L2W(0, D / 2 + 4 + 1.25);
    h.gate = { x: gp.x, z: gp.z };
  }
  aabb(h, sx, sz, y0, y1, lz = 0, lsz){
    if (lsz != null){ sz = lsz; }
    const p = h.toWorld(0, lz), swap = Math.abs(Math.sin(h.yaw)) > 0.5, hx = (swap ? sz : sx) / 2, hz = (swap ? sx : sz) / 2;
    return { x0: p.x - hx, x1: p.x + hx, z0: p.z - hz, z1: p.z + hz, y0, y1 };
  }

  houseInside(h, box, R){
    const k = h.id;
    const sofa = mat('sofa' + (k % 4), ['#8a3a34', '#3a4a6a', '#a88a5a', '#4a6a4a'][k % 4], { roughness: 1 });
    const wood = mat('wood', '#7a5434', { roughness: 0.55 }), dark = mat('dark', '#1e1e22', { roughness: 0.4 }), white = mat('white', '#e8e6e0', { roughness: 0.5 });
    const rugc = ['#8a4a4a', '#4a5a7a', '#a8945a', '#5a7a5a'][(k + 1) % 4];
    // rug, 1 cm above the floor
    box(2.4, 0.02, 1.8, mat('rug' + rugc, rugc, { roughness: 1 }), 0.6, FLOOR_Y + 0.01, 0.6);
    // a wall across the back left makes a bedroom corner
    box(2.8 - 0.01, H - 0.02, 0.15, h.plaster, -2.4 + 0.005, H / 2, -0.6, 'tall');
    // bed with a pillow and a blanket
    const bc = ['#c88a96', '#8aa0c0', '#a0b890', '#d8c890'][(k + 2) % 4];
    box(1.5, 0.45, 2.0, wood, -2.6, FLOOR_Y + 0.225, -2.8, 'low');
    box(1.4, 0.12, 1.4, mat('blanket' + bc, bc, { roughness: 1 }), -2.6, FLOOR_Y + 0.51, -2.45);
    box(0.9, 0.14, 0.4, white, -2.6, FLOOR_Y + 0.52, -3.45);
    box(1.5, 0.9, 0.08, wood, -2.6, FLOOR_Y + 0.45, -3.74);
    // sofa facing the TV on the right wall
    box(0.9, 0.45, 2.0, sofa, 1.3, FLOOR_Y + 0.225, -2.2, 'low');
    box(0.25, 0.5, 2.0, sofa, 0.95, FLOOR_Y + 0.7, -2.2);
    for (const z of [-1.1, 1.1]) box(0.9, 0.25, 0.2, sofa, 1.3, FLOOR_Y + 0.575, -2.2 + z * 0.95);
    box(0.45, 0.5, 1.3, wood, 3.5, FLOOR_Y + 0.25, -2.2, 'low');
    box(0.12, 0.65, 1.1, dark, 3.55, FLOOR_Y + 0.85, -2.2);
    box(0.02, 0.55, 1.0, mat('tvscreen', '#0a0c10', { roughness: 0.1, metalness: 0.4 }), 3.48, FLOOR_Y + 0.85, -2.2);
    // table and two chairs, kitchen counter with a stove
    box(1.2, 0.08, 1.2, wood, -2.0, FLOOR_Y + 0.74, 2.0, 'low');
    for (const [x, z] of [[-2.5, 1.5], [-1.5, 1.5], [-2.5, 2.5], [-1.5, 2.5]]) box(0.08, 0.7, 0.08, wood, x, FLOOR_Y + 0.35, z);
    for (const z of [1.0, 3.0]){
      box(0.45, 0.06, 0.45, sofa, -2.0, FLOOR_Y + 0.45, z, 'low');
      box(0.45, 0.5, 0.06, sofa, -2.0, FLOOR_Y + 0.73, z + (z < 2 ? -0.2 : 0.2));
      for (const [dx, dz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) box(0.05, 0.42, 0.05, wood, -2.0 + dx, FLOOR_Y + 0.21, z + dz);
    }
    box(0.6, 0.9, 1.6, white, -3.5, FLOOR_Y + 0.45, 0.4, 'low');
    box(0.62, 0.04, 1.62, mat('worktop', '#4a4a50', { roughness: 0.3 }), -3.5, FLOOR_Y + 0.92, 0.4);
    for (const [dz, dx] of [[0.05, -0.12], [0.05, 0.12], [0.35, -0.12], [0.35, 0.12]]) box(0.16, 0.02, 0.16, dark, -3.5 + dx, FLOOR_Y + 0.95, 0.1 + dz);
    // bookshelf, a plant and a lamp
    box(1.2, 1.8, 0.35, wood, 0.4, FLOOR_Y + 0.9, -3.62, 'tall');
    for (let i = 0; i < 3; i++) for (let j = 0; j < 5; j++){
      const bk = ['#8a3a30', '#2e4a6a', '#b89a4a', '#3a5a3a', '#5a3a5a'][(i + j + k) % 5];
      box(0.16, 0.34, 0.2, mat('book' + bk, bk), -0.05 + j * 0.2, FLOOR_Y + 0.4 + i * 0.55, -3.5);
    }
    box(0.4, 0.4, 0.4, mat('pot', '#a8583a'), -3.4, FLOOR_Y + 0.2, 3.4, 'low');
    h.plant = h.toWorld(-3.4, 3.4);
    const pp = h.toWorld(-3.4, 3.4); this.B.add(new THREE.IcosahedronGeometry(0.42, 0), mat('leaf', '#3a6a2e'), new THREE.Matrix4().makeTranslation(pp.x, FLOOR_Y + 0.75, pp.z));
    box(0.06, 1.5, 0.06, dark, 3.4, FLOOR_Y + 0.75, 3.3);
    const lp = h.toWorld(3.4, 3.3); this.B.add(new THREE.CylinderGeometry(0.15, 0.25, 0.3, 10), mat('shade', '#f2e8c8', { emissive: '#8a7a50' }), new THREE.Matrix4().makeTranslation(lp.x, FLOOR_Y + 1.55, lp.z));
    void R;
  }
  shopInside(h, box){
    const wood = mat('wood', '#9a6a3a');
    box(5.0, 1.0, 0.6, mat('counter' + h.shop.name, h.shop.awn, { roughness: 0.5 }), 0, FLOOR_Y + 0.5, -2.0, 'low');
    box(5.1, 0.05, 0.7, mat('worktop', '#4a4a50', { roughness: 0.3 }), 0, FLOOR_Y + 1.03, -2.0);
    box(0.4, 0.3, 0.35, mat('till', '#2a2a30', { roughness: 0.4 }), 1.5, FLOOR_Y + 1.2, -2.0);
    for (const sx of [-1, 1]){
      box(0.6, 2.0, 3.0, wood, sx * 3.5, FLOOR_Y + 1.0, 1.5, 'tall');
      for (let i = 0; i < 4; i++) for (let j = 0; j < 6; j++){
        const c = ['#b84a3a', '#4a8ab0', '#d8b040', '#6aa04a', '#b06a90', '#ece6d8'][(i * 2 + j + h.id) % 6];
        box(0.14, 0.26, 0.3, mat('goods' + c, c), sx * 3.17, FLOOR_Y + 0.3 + i * 0.5, 0.35 + j * 0.45);
      }
    }
    box(0.8, 0.9, 0.8, mat('crate', '#a88050'), -1.5, FLOOR_Y + 0.45, 1.8, 'low');
    box(0.8, 0.9, 0.8, mat('crate', '#a88050'), 1.2, FLOOR_Y + 0.45, 2.4, 'low');
  }
  park(B, z0, R){
    const stone = mat('fountain', '#b8b2a6', { roughness: 0.8 }), water = mat('water', '#2a4a5a', { roughness: 0.04, metalness: 0.4 });
    B.cyl(2.7, 2.7, 0.2, stone, 0, 0.1, z0, 24);
    B.add(new THREE.TorusGeometry(2.5, 0.22, 8, 32).rotateX(Math.PI / 2), stone, new THREE.Matrix4().makeTranslation(0, 0.42, z0));
    B.cyl(2.35, 2.35, 0.38, water, 0, 0.21, z0, 24);
    B.cyl(0.3, 0.22, 1.4, stone, 0, 0.9, z0, 12);
    B.cyl(0.9, 0.5, 0.25, stone, 0, 1.65, z0, 16);
    B.cyl(0.75, 0.75, 0.04, water, 0, 1.76, z0, 16);
    this.colliders.push({ x0: -2.75, x1: 2.75, z0: z0 - 2.75, z1: z0 + 2.75, y1: 0.6, tall: false });
    // a path round it and benches
    const s = Math.sign(z0);
    B.box(3, 0.04, 6, stoneMat(), 0, 0.02, z0 - s * 5.5);
    this.floors.push({ x0: -1.5, x1: 1.5, z0: Math.min(z0 - s * 2.5, z0 - s * 8.5), z1: Math.max(z0 - s * 2.5, z0 - s * 8.5), y: 0.04 });
    for (const x of [-5, 5]) this.bench(B, x, z0, x > 0 ? -Math.PI / 2 : Math.PI / 2);
    for (const [x, z] of [[-8, 4], [8, -3], [-9, -6], [9, 6]]) this.tree(B, x, z0 + z, 1.1 + R() * 0.3);
    // park walking points
    const a = this.node(0, z0 - s * 4.2, 'walk'), b = this.node(-4, z0, 'walk'), c = this.node(4, z0, 'walk'), d = this.node(0, z0 + s * 4.2, 'walk');
    this.link(a, b); this.link(a, c); this.link(b, d); this.link(c, d);
    this.parkEntry = this.parkEntry || []; this.parkEntry.push(a);
  }
  bench(B, x, z, ry){
    const wood = mat('benchwood', '#8a6038', { roughness: 0.7 }), iron = mat('iron', '#26262a', { metalness: 0.7, roughness: 0.5 });
    const m = (lx, ly, lz) => ({ x: x + lx * Math.cos(ry) + lz * Math.sin(ry), z: z - lx * Math.sin(ry) + lz * Math.cos(ry), y: ly });
    let p = m(0, 0.45, 0); B.box(1.8, 0.06, 0.5, wood, p.x, p.y, p.z, ry);
    p = m(0, 0.75, -0.25); B.box(1.8, 0.35, 0.05, wood, p.x, p.y, p.z, ry);
    for (const lx of [-0.75, 0.75]){ p = m(lx, 0.22, 0); B.box(0.06, 0.44, 0.45, iron, p.x, p.y, p.z, ry); }
    const sw = Math.abs(Math.sin(ry)) > 0.5;
    this.colliders.push({ x0: x - (sw ? 0.3 : 0.95), x1: x + (sw ? 0.3 : 0.95), z0: z - (sw ? 0.95 : 0.3), z1: z + (sw ? 0.95 : 0.3), y1: 0.9, tall: false });
  }
  lamp(B, x, z){
    const iron = mat('lamppost', '#26282c', { metalness: 0.6, roughness: 0.45 });
    B.cyl(0.08, 0.06, 3.6, iron, x, 1.8, z, 10);
    B.cyl(0.14, 0.14, 0.3, iron, x, 0.15, z, 10);
    B.cyl(0.05, 0.2, 0.12, iron, x, 3.98, z, 10);
    B.add(new THREE.CylinderGeometry(0.13, 0.1, 0.3, 10), mat('lampglow', '#f4ecd0', { emissive: '#6a6040', roughness: 0.3 }), new THREE.Matrix4().makeTranslation(x, 3.77, z));
    this.colliders.push({ x0: x - 0.12, x1: x + 0.12, z0: z - 0.12, z1: z + 0.12, y1: 3.6, tall: true });
  }
  tree(B, x, z, s = 1){
    this.treeSpots.push([x, z, s]);
    this.colliders.push({ x0: x - 0.25 * s, x1: x + 0.25 * s, z0: z - 0.25 * s, z1: z + 0.25 * s, y1: 2.2 * s, tall: true });
  }

  // trees (from MSB): a trunk with branches and a leafy crown of lumpy blobs, darker underneath
  // (vertex colours); two kinds, instanced
  treeGeo(seed, tall){
    const R = rng(seed), parts = [];
    const trunkH = tall ? 3.2 : 2.4;
    parts.push(paint(new THREE.CylinderGeometry(0.11, 0.2, trunkH, 9).translate(0, trunkH / 2, 0), '#5a4230'));
    for (let k = 0; k < 4; k++){
      const a = k / 4 * 6.283 + R(), len = 1.0 + R() * 0.6;
      const br = new THREE.CylinderGeometry(0.035, 0.07, len, 6).translate(0, len / 2, 0);
      br.applyMatrix4(new THREE.Matrix4().compose(V(0, trunkH * (0.7 + R() * 0.25), 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(a) * 0.8, 0, -Math.cos(a) * 0.8)), V(1, 1, 1)));
      parts.push(paint(br, '#5a4230'));
    }
    const n = tall ? 9 : 8, base = new THREE.Color('#3f7a2e'), dark = new THREE.Color('#24501c'), light = new THREE.Color('#6aa844');
    for (let k = 0; k < n; k++){
      const ico = new THREE.IcosahedronGeometry(1, 1); ico.deleteAttribute('normal'); ico.deleteAttribute('uv');
      const blob = mergeVertices(ico), p = blob.attributes.position;
      const r = tall ? 0.75 + R() * 0.35 : 0.9 + R() * 0.55;
      const cx = tall ? (R() - 0.5) * 0.9 : (R() - 0.5) * 2.4, cz = tall ? (R() - 0.5) * 0.9 : (R() - 0.5) * 2.4;
      const cy = tall ? trunkH + 0.4 + k * 0.62 : trunkH + 0.8 + R() * 1.6;
      const colA = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++){
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i), j = 1 + (hash2(Math.round(x * 50) + k * 7, Math.round(y * 50) + Math.round(z * 50) * 3, seed) - 0.5) * 0.35;
        p.setXYZ(i, cx + x * r * j, cy + y * r * j * 0.85, cz + z * r * j);
        const t = Math.max(0, Math.min(1, (y + 1) / 2 * 0.8 + (cy - trunkH) / 6)), c = dark.clone().lerp(base, t).lerp(light, Math.max(0, t - 0.6) * 1.2);
        c.multiplyScalar(0.9 + hash2(i, k, seed) * 0.2);
        colA.set([c.r, c.g, c.b], i * 3);
      }
      blob.setAttribute('color', new THREE.BufferAttribute(colA, 3));
      blob.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(p.count * 2), 2));
      blob.computeVertexNormals();
      parts.push(blob);
    }
    const g = mergeGeometries(parts);
    g.userData.keep = true;
    return g;
  }
  buildTrees(){
    const R = rng(31), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    const m = mat('tree', '#ffffff', { vertexColors: true, roughness: 0.9 });
    const geos = [this.treeGeo(3, false), this.treeGeo(5, true)];
    const lists = [[], []];
    this.treeSpots.forEach((t, i) => lists[hash2(i, 7, 1) < 0.3 ? 1 : 0].push(t));
    this.trees = [];
    lists.forEach((list, k) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geos[k], m, list.length);
      list.forEach(([x, z, s], i) => {
        q.setFromAxisAngle(V(0, 1, 0), R() * 6.28); m4.compose(V(x, 0, z), q, V(s, s * (0.9 + R() * 0.2), s)); im.setMatrixAt(i, m4);
        im.setColorAt(i, c.setHSL(0.25 + (R() - 0.5) * 0.06, 0.25 + R() * 0.2, 0.75 + R() * 0.25));
      });
      im.castShadow = im.receiveShadow = true;
      this.root.add(im); this.trees.push(im);
    });
  }
  // parked cars along the kerbs (from MSB): bodies in different colours, dark glass and wheels
  cars(){
    const body = [], dark = [];
    body.push(boxUV(4.1, 0.62, 1.78).translate(0, 0.62, 0));
    body.push(boxUV(2.3, 0.5, 1.6).translate(-0.25, 1.17, 0));
    dark.push(boxUV(2.34, 0.42, 1.64).translate(-0.25, 1.17, 0));            // the windows, 2 cm proud of the cabin
    for (const sx of [-1.3, 1.3]) for (const sz of [-0.8, 0.8]) dark.push(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 14).rotateX(Math.PI / 2).translate(sx, 0.34, sz));
    const gB = mergeGeometries(body), gD = mergeGeometries(dark);
    gD.userData.keep = gB.userData.keep = true;
    // [x, z, facing]: Main Street (along x) and Elm Street (along z), away from the crossing
    const list = [[-58, -2.9, 0], [-40, -2.9, 0], [-27, 2.9, Math.PI], [26, -2.9, 0], [44, 2.9, Math.PI], [58, 2.9, Math.PI], [-46, 2.9, Math.PI],
      [2.9, -18, Math.PI / 2], [-2.9, -38, -Math.PI / 2], [-2.9, 22, -Math.PI / 2], [2.9, 40, Math.PI / 2]];
    const ib = new THREE.InstancedMesh(gB, mat('car', '#ffffff', { roughness: 0.25, metalness: 0.5 }), list.length), id = new THREE.InstancedMesh(gD, mat('car-dark', '#16191c', { roughness: 0.2, metalness: 0.3 }), list.length);
    const cols = ['#8a1e22', '#2a4a7a', '#e8e6e0', '#222226', '#9aa0a8', '#3a5a4a', '#c8b48a'], m4 = new THREE.Matrix4(), c = new THREE.Color();
    list.forEach(([x, z, ry], i) => {
      m4.compose(V(x, 0.02, z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), ry), V(1, 1, 1)); ib.setMatrixAt(i, m4); id.setMatrixAt(i, m4); ib.setColorAt(i, c.set(cols[i % cols.length]));
      const along = Math.abs(Math.sin(ry)) < 0.5, hx = along ? 2.1 : 0.95, hz = along ? 0.95 : 2.1;
      this.colliders.push({ x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz, y1: 1.45, tall: true });
    });
    ib.castShadow = id.castShadow = true; ib.receiveShadow = true;
    this.root.add(ib, id);
  }
  // distant hills all the way round (from MSB): darker at the foot, hazier at the top
  hills(){
    const pos = [], N = 72;
    for (let i = 0; i < N; i++){
      const a0 = i / N * 6.283, a1 = (i + 1) / N * 6.283, R0 = 300, hh = (k) => 8 + vnoise(k * 0.25, 0, 8, N * 0.25) * 34 + vnoise(k * 0.875, 3, 9, N * 0.875) * 9, h0 = hh(i), h1 = hh(i + 1);
      const p = (a, r, y) => [Math.cos(a) * r, y, Math.sin(a) * r];
      pos.push(...p(a0, R0, -1), ...p(a1, R0, -1), ...p(a1, R0, h1), ...p(a0, R0, -1), ...p(a1, R0, h1), ...p(a0, R0, h0));
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    const cols = []; for (let i = 0; i < pos.length; i += 3){ const t = Math.max(0, pos[i + 1]) / 50; cols.push(0.33 + t * 0.25, 0.47 + t * 0.2, 0.36 + t * 0.25); }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: true }));
    m.material.name = 'hill';
    this.root.add(m);
    return m;
  }

  // ---------- the walking graph ----------
  node(x, z, kind, house = -1){
    // sidewalk points are shared where two lines meet
    if (kind === 'walk'){ const k = this.nodes.findIndex((n) => n.kind === 'walk' && Math.abs(n.x - x) < 0.3 && Math.abs(n.z - z) < 0.3); if (k >= 0) return k; }
    this.nodes.push({ x, z, kind, house, i: this.nodes.length }); this.adj.push([]);
    return this.nodes.length - 1;
  }
  link(a, b){ if (a === b) return; if (!this.adj[a].includes(b)) this.adj[a].push(b); if (!this.adj[b].includes(a)) this.adj[b].push(a); }
  navLinks(){
    // sidewalk lines: the points along each, including every house's gate, joined in order
    const lines = [];
    for (const s of [-1, 1]){
      const xs = new Set([-MAIN_X + 2, MAIN_X - 2, -WALK_MID, WALK_MID]);
      for (let x = -60; x <= 60; x += 8) if (Math.abs(x) > WALK_OUT + 1) xs.add(x);
      for (const h of this.houses) if (Math.abs(h.gate.z - s * WALK_MID) < 0.5) xs.add(Math.round(h.gate.x * 100) / 100);
      lines.push([...xs].sort((a, b) => a - b).map((x) => [x, s * WALK_MID]));
      const zs = new Set([-CROSS_Z + 1.5, CROSS_Z - 1.5, -WALK_MID, WALK_MID]);
      for (let z = -40; z <= 40; z += 8) if (Math.abs(z) > WALK_OUT + 1) zs.add(z);
      for (const h of this.houses) if (Math.abs(h.gate.x - s * WALK_MID) < 0.5) zs.add(Math.round(h.gate.z * 100) / 100);
      lines.push([...zs].sort((a, b) => a - b).map((z) => [s * WALK_MID, z]));
    }
    for (const L of lines){
      let prev = -1;
      for (const [x, z] of L){ const k = this.node(x, z, 'walk'); if (prev >= 0) this.link(prev, k); prev = k; }
    }
    for (const h of this.houses){ const g = this.node(h.gate.x, h.gate.z, 'walk'); this.link(g, h.porch); h.gateNode = g; }
    for (const a of this.parkEntry){
      const p = this.nodes[a], s = Math.sign(p.z);
      for (const x of [-WALK_MID, WALK_MID]) this.link(a, this.node(x, s * (CROSS_Z - 1.5), 'walk'));
    }
    this.walkNodes = this.nodes.filter((n) => n.kind === 'walk').map((n) => n.i);
  }
  // shortest path from node a to node b (a list of node numbers, without a)
  path(a, b){
    const n = this.nodes.length, dist = new Float32Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
    dist[a] = 0;
    for (;;){
      let u = -1, best = Infinity;
      for (let i = 0; i < n; i++) if (!done[i] && dist[i] < best){ best = dist[i]; u = i; }
      if (u < 0 || u === b) break;
      done[u] = 1;
      const U = this.nodes[u];
      for (const v of this.adj[u]){ const N = this.nodes[v], d = best + Math.hypot(N.x - U.x, N.z - U.z); if (d < dist[v]){ dist[v] = d; prev[v] = u; } }
    }
    if (!Number.isFinite(dist[b])) return [];
    const out = []; for (let u = b; u !== a && u >= 0; u = prev[u]) out.push(u);
    return out.reverse();
  }
  nearestNode(x, z, filter){
    let best = -1, bd = Infinity;
    for (const n of this.nodes){ if (filter && !filter(n)) continue; const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd){ bd = d; best = n.i; } }
    return best;
  }

  // ---------- physics ----------
  // push p (x, z) out of anything solid; low things (furniture, benches) only when `low` is set
  collide(p, r, low = true){
    for (const c of this.colliders){
      if (!c.tall && !low) continue;
      if (p.x < c.x0 - r || p.x > c.x1 + r || p.z < c.z0 - r || p.z > c.z1 + r) continue;
      const qx = Math.max(c.x0, Math.min(p.x, c.x1)), qz = Math.max(c.z0, Math.min(p.z, c.z1));
      let dx = p.x - qx, dz = p.z - qz; const d2 = dx * dx + dz * dz;
      if (d2 > r * r) continue;
      if (d2 > 1e-8){ const d = Math.sqrt(d2); p.x = qx + dx / d * r; p.z = qz + dz / d * r; }
      else {
        // inside the box: out the nearest side
        const o = [[p.x - c.x0 + r, -1, 0], [c.x1 - p.x + r, 1, 0], [p.z - c.z0 + r, 0, -1], [c.z1 - p.z + r, 0, 1]].sort((a, b) => a[0] - b[0])[0];
        p.x += o[1] * o[0]; p.z += o[2] * o[0]; dx = dz = 0;
      }
    }
    p.x = Math.max(-BOUND, Math.min(BOUND, p.x)); p.z = Math.max(-BOUND, Math.min(BOUND, p.z));
    return p;
  }
  groundAt(x, z){
    let y = 0;
    for (const f of this.floors) if (x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1 && f.y > y) y = f.y;
    return y;
  }
  inHouse(x, z){
    for (const h of this.houses){ const f = this.aabb(h, W, D, 0, H); if (x > f.x0 && x < f.x1 && z > f.z0 && z < f.z1) return h; }
    return null;
  }
  // how far a ray goes before a wall, a roof or a tree stops it
  rayWall(o, d, far){
    let best = far;
    const test = (x0, x1, y0, y1, z0, z1) => {
      let t0 = 0, t1 = best;
      for (const [oo, dd, a, b] of [[o.x, d.x, x0, x1], [o.y, d.y, y0, y1], [o.z, d.z, z0, z1]]){
        if (Math.abs(dd) < 1e-9){ if (oo < a || oo > b) return; continue; }
        let ta = (a - oo) / dd, tb = (b - oo) / dd; if (ta > tb){ const t = ta; ta = tb; tb = t; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return;
      }
      if (t0 < best) best = t0;
    };
    for (const c of this.colliders) if (c.tall) test(c.x0, c.x1, 0, c.y1, c.z0, c.z1);
    for (const r of this.roofs) test(r.x0, r.x1, r.y0, r.y1, r.z0, r.z1);
    if (d.y < -1e-6){ const t = -o.y / d.y; if (t < best) best = t; }
    return best;
  }

  // doors open when anyone (in `who`: points with x, z) is near, and close again after
  updateDoors(dt, who){
    for (const dr of this.doors){
      let near = false;
      for (const p of who){ const dx = p.x - dr.x, dz = p.z - dr.z; if (dx * dx + dz * dz < 2.4 * 2.4){ near = true; break; } }
      const want = near ? Math.PI * 0.55 : 0;
      if (Math.abs(want - dr.a) > 0.001){ dr.a += Math.sign(want - dr.a) * Math.min(Math.abs(want - dr.a), dt * 3.5); dr.pivot.rotation.y = dr.yaw + dr.a; }
    }
  }
}
function stoneMat(){ const X = textures(); return mat('path', '#ffffff', { map: X.paver, normalMap: X.paverN, roughness: 0.85 }); }

