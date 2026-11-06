// A truck, a tank and a helicopter, parked in the yard. Touch one and squeeze the grip to get in; click
// the left stick to get out.
//  Truck:      left stick drives and steers.
//  Tank:       left stick drives (turns on the spot), right stick aims the turret, right trigger fires.
//  Helicopter: left stick flies forward/back/sideways, right stick turns and climbs/descends.
import * as THREE from 'three';
import { multiBox, boxGeo, blockMaterial } from './util.js';
import { surfaceHeight, groundHeight, pushOut, pillars, solidAt, PLACES, EDGE } from './world.js';
import { sfx, engine } from './audio.js';

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), m1 = new THREE.Matrix4(), q1 = new THREE.Quaternion();
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const fwdOf = (yaw, out = new THREE.Vector3()) => out.set(-Math.sin(yaw), 0, -Math.cos(yaw));

class Vehicle {
  constructor(kind, scene, x, z, yaw){
    this.kind = kind; this.root = new THREE.Group(); scene.add(this.root);
    this.pos = new THREE.Vector3(x, surfaceHeight(x, z), z); this.yaw = yaw; this.speed = 0; this.vel = new THREE.Vector3();
    this.pitch = 0; this.roll = 0; this.driver = null; this.colliders = [];
    this.home = { x, z, yaw };
  }
  // its outline for "is my hand touching it", in its own frame
  touching(p){
    v1.copy(p); this.root.worldToLocal(v1);
    const b = this.box;
    return v1.x > b[0] - 0.12 && v1.x < b[1] + 0.12 && v1.y > b[2] - 0.12 && v1.y < b[3] + 0.12 && v1.z > b[4] - 0.12 && v1.z < b[5] + 0.12;
  }
  seatWorld(out){ return out.copy(this.seat).applyMatrix4(this.root.matrixWorld); }
  place(){
    this.root.position.copy(this.pos);
    this.root.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
    this.root.updateMatrixWorld(true);
  }
  // round colliders along its length, so you, animals and loose things bump into it
  updateColliders(){
    const f = fwdOf(this.yaw, v1);
    this.colliders.forEach((c, i) => { const k = this.colliderAt[i]; c.x = this.pos.x + f.x * k; c.z = this.pos.z + f.z * k; c.y0 = this.pos.y - 0.2; c.top = this.pos.y + this.height; });
  }
  makeColliders(list, r){
    this.colliderAt = list;
    this.colliders = list.map(() => ({ x: 0, z: 0, r, top: 2, y0: 0, owner: this }));
    pillars.push(...this.colliders);
    this.updateColliders();
  }
  // ground following for wheeled/tracked things: pitch and roll from the ground under the corners
  followGround(dt, halfL, halfW){
    const f = fwdOf(this.yaw, v1), r = v2.set(-f.z, 0, f.x);
    const h = (a, b) => surfaceHeight(this.pos.x + f.x * a + r.x * b, this.pos.z + f.z * a + r.z * b, this.pos.y + 0.6);
    const hf = (h(halfL, -halfW) + h(halfL, halfW)) / 2, hb = (h(-halfL, -halfW) + h(-halfL, halfW)) / 2;
    const hl = (h(halfL, -halfW) + h(-halfL, -halfW)) / 2, hr = (h(halfL, halfW) + h(-halfL, halfW)) / 2;
    const target = Math.max(hf, hb, hl, hr) - Math.abs(hf - hb) / 2 * 0.5;
    if (target < this.pos.y - 0.05){ this.vel.y -= 9.8 * dt; this.pos.y = Math.max(target, this.pos.y + this.vel.y * dt); }
    else { this.pos.y += (target - this.pos.y) * Math.min(1, dt * 10); this.vel.y = 0; }
    this.pitch += (Math.atan2(hf - hb, halfL * 2) - this.pitch) * Math.min(1, dt * 8);
    this.roll += (Math.atan2(hl - hr, halfW * 2) - this.roll) * Math.min(1, dt * 8);
  }
  // drive along the ground; bump into walls
  drive(dt, accel, maxF, maxB, yawRate, radius){
    this.yaw = wrap(this.yaw + yawRate * dt);
    this.speed = Math.max(-maxB, Math.min(maxF, this.speed + accel * dt));
    const f = fwdOf(this.yaw, v1);
    const before = this.pos.clone();
    this.pos.x += f.x * this.speed * dt; this.pos.z += f.z * this.speed * dt;
    // collision: a few circles along the body
    let hitWall = false;
    for (const k of this.colliderAt){
      const c = v2.set(this.pos.x + f.x * k, 0, this.pos.z + f.z * k);
      const was = c.clone();
      if (pushOut(c, radius, this.pos.y, 0.6, { ignore: this })){ this.pos.x += c.x - was.x; this.pos.z += c.z - was.z; hitWall = true; }
    }
    if (hitWall && Math.abs(this.speed) > 2){ sfx.thud(this.pos, Math.abs(this.speed)); this.speed *= -0.25; }
    else if (hitWall) this.speed *= 0.5;
    if (Math.hypot(this.pos.x, this.pos.z) > EDGE){ this.pos.copy(before); this.speed = 0; }
  }
}

// ---------- truck ----------
// A cab you can see out of: seats, a dashboard with gauges, a steering wheel that turns, a clear
// windscreen, open side windows, mirrors, and the roof well above your head.
function truckModel(v){
  const red = 0xc8413a, red2 = 0xb33a33, dark = 0x2a2c30, grey = 0x8a8f96, seat = 0x3a4a5a, wood = 0x9b7444, trim = 0x1d1d1f;
  const parts = [
    [2.1, 0.35, 5.2, dark, 0, 0.75, 0],                                   // chassis
    // cab shell: floor, back wall (window above), roof, pillars, doors (window above)
    [2.0, 0.08, 1.95, 0x3a3a3e, 0, 1.0, -1.45],
    [2.1, 0.75, 0.1, red, 0, 1.4, -0.48], [2.1, 0.12, 0.1, red, 0, 2.66, -0.48], [0.22, 1.3, 0.1, red, -0.94, 2.1, -0.48], [0.22, 1.3, 0.1, red, 0.94, 2.1, -0.48],
    [2.16, 0.1, 2.05, red2, 0, 2.76, -1.45], [2.0, 0.02, 1.9, 0xd8d4c8, 0, 2.7, -1.45],
    [0.1, 1.05, 0.1, red, -1.02, 2.2, -2.38], [0.1, 1.05, 0.1, red, 1.02, 2.2, -2.38],
    [0.08, 0.7, 1.85, red, -1.04, 1.38, -1.45], [0.08, 0.7, 1.85, red, 1.04, 1.38, -1.45],
    [0.12, 0.05, 1.85, trim, -1.04, 1.75, -1.45], [0.12, 0.05, 1.85, trim, 1.04, 1.75, -1.45],
    [0.06, 0.1, 0.03, 0x9aa0a8, -1.09, 1.55, -1.1], [0.06, 0.1, 0.03, 0x9aa0a8, 1.09, 1.55, -1.1],       // door handles
    [2.1, 0.1, 0.1, red, 0, 1.68, -2.42], [2.1, 0.08, 0.1, red, 0, 2.7, -2.4],                          // windscreen frame
    // dashboard with two gauges in front of the driver, a radio in the middle
    [1.96, 0.3, 0.45, 0x3a3c40, 0, 1.55, -2.15], [1.96, 0.04, 0.47, dark, 0, 1.72, -2.16],
    [0.16, 0.16, 0.02, 0xe8e8e0, -0.56, 1.58, -1.92], [0.16, 0.16, 0.02, 0xe8e8e0, -0.34, 1.58, -1.92],
    [0.02, 0.07, 0.01, 0xd42a2a, -0.56, 1.6, -1.905], [0.02, 0.07, 0.01, 0xd42a2a, -0.34, 1.6, -1.905],
    [0.3, 0.12, 0.03, 0x1a1a1a, 0.1, 1.55, -1.92], [0.18, 0.04, 0.01, 0x6ad06a, 0.1, 1.57, -1.905],
    // seats: cushions, backrests and headrests
    [0.55, 0.16, 0.55, seat, -0.45, 1.3, -1.0], [0.55, 0.7, 0.12, seat, -0.45, 1.72, -0.66], [0.32, 0.2, 0.1, seat, -0.45, 2.17, -0.64],
    [0.55, 0.16, 0.55, seat, 0.45, 1.3, -1.0], [0.55, 0.7, 0.12, seat, 0.45, 1.72, -0.66], [0.32, 0.2, 0.1, seat, 0.45, 2.17, -0.64],
    [0.2, 0.22, 0.6, 0x2e2e32, 0, 1.15, -1.0], [0.03, 0.22, 0.03, dark, 0, 1.36, -1.3], [0.06, 0.06, 0.06, 0x1a1a1a, 0, 1.48, -1.3],   // console and gear stick
    [0.24, 0.08, 0.03, 0x1a1a1a, 0, 2.6, -2.3],                                                            // rear-view mirror
    [0.04, 0.04, 0.25, dark, -1.12, 1.95, -2.25], [0.04, 0.22, 0.14, dark, -1.22, 1.95, -2.15], [0.04, 0.04, 0.25, dark, 1.12, 1.95, -2.25], [0.04, 0.22, 0.14, dark, 1.22, 1.95, -2.15],
    // bonnet, grille, lights, bumper
    [2.06, 0.55, 1.05, red, 0, 1.2, -2.95], [1.9, 0.04, 1.0, red2, 0, 1.49, -2.95],
    [1.1, 0.35, 0.05, 0x5a5e66, 0, 1.15, -3.48], [0.28, 0.18, 0.06, 0xfff0b0, -0.72, 1.28, -3.48], [0.28, 0.18, 0.06, 0xfff0b0, 0.72, 1.28, -3.48],
    [2.2, 0.18, 0.15, grey, 0, 0.85, -3.55],
    // the bed behind
    [2.1, 0.12, 3.0, wood, 0, 1.0, 1.0], [0.1, 0.6, 3.0, wood, -1.0, 1.35, 1.0], [0.1, 0.6, 3.0, wood, 1.0, 1.35, 1.0], [2.1, 0.6, 0.1, wood, 0, 1.35, 2.45],
  ];
  v.body = multiBox(parts); v.root.add(v.body);
  // the steering wheel, on a column, tilted toward you; v.wheelSpin turns with the steering
  const col = new THREE.Group(); col.position.set(-0.45, 1.72, -1.78); col.rotation.x = 0.5; v.root.add(col);
  col.add(multiBox([[0.05, 0.05, 0.36, dark, 0, 0, -0.18]]));
  v.wheelSpin = new THREE.Group(); col.add(v.wheelSpin);
  const pieces = [];
  for (let i = 0; i < 10; i++){
    const a = i / 10 * Math.PI * 2;
    pieces.push(boxGeo(0.125, 0.035, 0.035, trim).applyMatrix4(new THREE.Matrix4().makeRotationZ(a + Math.PI / 2).setPosition(Math.cos(a) * 0.19, Math.sin(a) * 0.19, 0)));
  }
  pieces.push(boxGeo(0.36, 0.03, 0.025, trim, 0, 0, 0.005), boxGeo(0.03, 0.18, 0.025, trim, 0, -0.09, 0.005), boxGeo(0.08, 0.08, 0.04, 0xc8413a, 0, 0, 0.01));
  v.wheelSpin.add(new THREE.Mesh(mergeGeos(pieces), blockMaterial()));
  // a clear windscreen
  v.glass = new THREE.Mesh(new THREE.PlaneGeometry(1.94, 0.95), new THREE.MeshBasicMaterial({ color: 0xbfe4ff, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
  v.glass.position.set(0, 2.2, -2.42); v.root.add(v.glass);
  v.wheels = [[-1.05, -2.2], [1.05, -2.2], [-1.05, 1.7], [1.05, 1.7]].map(([x, z]) => {
    const g = new THREE.Group(); g.position.set(x, 0.48, z);
    g.add(multiBox([[0.4, 0.95, 0.95, 0x1d1d1f], [0.42, 0.4, 0.4, 0xb0b5bc]]));
    v.root.add(g); return g;
  });
  v.box = [-1.15, 1.15, 0, 2.85, -3.6, 2.5];
  v.seat = new THREE.Vector3(-0.45, 2.15, -0.95);     // the driver's eyes: half a metre under the roof
  v.height = 2.8;
}
// join box geometries (same attributes) into one
function mergeGeos(geos){
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'color']){
    const arrs = geos.map((g) => g.attributes[name].array), len = arrs.reduce((a, b) => a + b.length, 0);
    const all = new Float32Array(len); let o = 0; for (const a of arrs){ all.set(a, o); o += a.length; }
    out.setAttribute(name, new THREE.BufferAttribute(all, geos[0].attributes[name].itemSize));
  }
  out.computeBoundingSphere();
  return out;
}

// ---------- tank ----------
function tankModel(v){
  const olive = 0x5a6a3a, olive2 = 0x4a5a30, dark = 0x2e3028;
  const parts = [[2.6, 0.9, 5.2, olive, 0, 1.0, 0], [2.4, 0.4, 0.6, olive2, 0, 1.25, -2.7]];
  for (const s of [-1, 1]){
    parts.push([0.75, 0.95, 5.8, dark, s * 1.55, 0.55, 0]);
    for (let i = 0; i < 7; i++) parts.push([0.78, 0.5, 0.5, 0x3a3c34, s * 1.55, 0.45, -2.4 + i * 0.8]);
    parts.push([0.8, 0.12, 5.9, 0x42443c, s * 1.55, 1.05, 0]);
  }
  v.body = multiBox(parts); v.root.add(v.body);
  v.turret = new THREE.Group(); v.turret.position.set(0, 1.45, 0.3); v.root.add(v.turret);
  v.turret.add(multiBox([[2.1, 0.75, 2.4, olive, 0, 0.37, 0], [0.8, 0.15, 0.8, olive2, 0.45, 0.82, 0.55], [0.5, 0.4, 0.5, olive2, -0.6, 0.9, 0.6]]));
  v.barrel = new THREE.Group(); v.barrel.position.set(0, 0.4, -1.15); v.turret.add(v.barrel);
  v.barrel.add(multiBox([[0.24, 0.24, 3.2, olive2, 0, 0, -1.6], [0.34, 0.34, 0.4, dark, 0, 0, -3.15]]));
  v.box = [-1.95, 1.95, 0, 2.6, -2.95, 2.95];
  v.seat = new THREE.Vector3(0.45, 3.0, 0.85);      // standing in the hatch, head out
  v.height = 2.4;
  v.turretYaw = 0; v.barrelPitch = 0.05; v.reload = 0; v.shells = [];
}

// ---------- helicopter ----------
function heliModel(v){
  const yellow = 0xf2c530, dark = 0x2a2c30, glass = 0x6ab0d0, grey = 0x8a8f96;
  v.body = multiBox([
    [1.9, 0.15, 2.6, grey, 0, 0.95, -0.3],                              // floor
    [1.9, 1.6, 0.15, yellow, 0, 1.75, 0.95], [1.9, 0.15, 2.4, yellow, 0, 2.6, -0.2],  // back wall, roof
    [0.1, 1.6, 0.1, yellow, -0.9, 1.75, -1.55], [0.1, 1.6, 0.1, yellow, 0.9, 1.75, -1.55], [0.1, 1.6, 0.1, yellow, -0.9, 1.75, 0.3], [0.1, 1.6, 0.1, yellow, 0.9, 1.75, 0.3],
    [1.9, 0.35, 0.25, yellow, 0, 1.18, -1.5], [1.7, 0.08, 0.06, glass, 0, 2.5, -1.58],   // nose and top of the screen
    [0.6, 0.16, 0.3, dark, -0.4, 1.3, -1.3],                             // instruments
    [0.55, 0.45, 0.55, 0x3a5a8a, -0.4, 1.25, -0.2], [0.55, 0.45, 0.55, 0x3a5a8a, 0.4, 1.25, -0.2],    // seats
    [1.3, 0.8, 1.6, yellow, 0, 1.7, 1.75],                               // engine
    [0.35, 0.35, 4.2, yellow, 0, 1.9, 4.3], [0.1, 1.0, 0.6, yellow, 0, 2.3, 6.2], [0.6, 0.1, 0.4, yellow, 0, 1.95, 6.0],
    [0.3, 0.4, 0.3, dark, 0, 2.85, 0.3],                                 // rotor mast
    // skids
    [0.12, 0.12, 3.4, dark, -1.0, 0.08, -0.2], [0.12, 0.12, 3.4, dark, 1.0, 0.08, -0.2],
    [0.1, 0.85, 0.1, dark, -0.95, 0.5, -1.0], [0.1, 0.85, 0.1, dark, 0.95, 0.5, -1.0], [0.1, 0.85, 0.1, dark, -0.95, 0.5, 0.6], [0.1, 0.85, 0.1, dark, 0.95, 0.5, 0.6],
  ]);
  v.root.add(v.body);
  v.rotor = new THREE.Group(); v.rotor.position.set(0, 3.1, 0.3); v.root.add(v.rotor);
  v.rotor.add(multiBox([[0.35, 0.06, 8.5, dark], [8.5, 0.06, 0.35, dark], [0.4, 0.15, 0.4, grey]]));
  v.tailRotor = new THREE.Group(); v.tailRotor.position.set(0.25, 2.3, 6.3); v.root.add(v.tailRotor);
  v.tailRotor.add(multiBox([[0.06, 1.4, 0.2, dark], [0.06, 0.2, 1.4, dark]]));
  v.box = [-1.1, 1.1, 0, 2.7, -1.7, 2.6];
  v.seat = new THREE.Vector3(-0.4, 2.1, -0.25);
  v.height = 2.8;
  v.spin = 0; v.alt = 0;
}

export class Vehicles {
  constructor(scene, { particles, builder, creatures, villagers, dragon, items }){
    this.particles = particles; this.builder = builder; this.creatures = creatures; this.villagers = villagers; this.dragon = dragon; this.items = items;
    const Y = PLACES.yard;
    this.truck = new Vehicle('truck', scene, Y.x - 3.5, Y.z - 2, 0.3); truckModel(this.truck); this.truck.makeColliders([-2.2, -0.7, 0.8, 2.0], 1.05);
    this.tank = new Vehicle('tank', scene, Y.x + 1, Y.z - 3, -0.2); tankModel(this.tank); this.tank.makeColliders([-2.2, -0.7, 0.8, 2.2], 1.4);
    this.heli = new Vehicle('heli', scene, Y.x + 0.5, Y.z + 4, Math.PI * 0.75); heliModel(this.heli); this.heli.makeColliders([-0.8, 0.6], 1.15);
    this.list = [this.truck, this.tank, this.heli];
    for (const v of this.list) v.place();
    // a painted helipad
    const pad = multiBox([[5, 0.04, 5, 0x6a6a70, 0, 0.02, 0], [0.5, 0.05, 2.4, 0xf2f2ee, -0.8, 0.03, 0], [0.5, 0.05, 2.4, 0xf2f2ee, 0.8, 0.03, 0], [1.1, 0.05, 0.45, 0xf2f2ee, 0, 0.03, 0]]);
    pad.position.set(Y.x + 0.5, 0, Y.z + 4); scene.add(pad);
    this.shellMesh = multiBox([[0.18, 0.18, 0.45, 0xd4a72c]]);
    this.shellPool = [];
    this.scene = scene;
    this.sound = null;
    this.events = [];
  }
  emit(type){ this.events.push(type); if (this.events.length > 100) this.events.shift(); }
  // the vehicle a hand is touching, if any
  touched(h){ for (const v of this.list) if (!v.driver && v.touching(h.pos)) return v; return null; }
  enter(v, player){
    v.driver = player; this.current = v;
    this.sound = engine(v.kind);
    sfx.ui(); this.emit('enter-' + v.kind);
  }
  exit(){
    const v = this.current; if (!v) return null;
    v.driver = null; this.current = null;
    if (this.sound){ this.sound.stop(); this.sound = null; }
    this.emit('exit-' + v.kind);
    // a clear spot beside it
    const f = fwdOf(v.yaw), r = new THREE.Vector3(-f.z, 0, f.x);
    for (const [a, b] of [[0, -2.2], [0, 2.2], [-3.5, 0], [3.5, 0], [0, -3.2], [0, 3.2]]){
      const p = v.pos.clone().addScaledVector(f, a).addScaledVector(r, b);
      const g = surfaceHeight(p.x, p.z, v.pos.y + 3);
      if (!solidAt(p.x, g + 0.5, p.z) && !solidAt(p.x, g + 1.5, p.z) && Math.abs(g - surfaceHeight(v.pos.x, v.pos.z, v.pos.y + 1)) < 3) return p.setY(g);
    }
    return v.pos.clone().addScaledVector(r, -2.5).setY(surfaceHeight(v.pos.x - r.x * 2.5, v.pos.z - r.z * 2.5));
  }

  update(dt, hands){
    const cur = this.current;
    const L = hands[0], Rh = hands[1];
    for (const v of this.list){
      const drive = v === cur;
      const lx = drive ? L.stick.x : 0, ly = drive ? L.stick.y : 0, rx = drive ? Rh.stick.x : 0, ry = drive ? Rh.stick.y : 0;
      const dz = (a) => Math.abs(a) < 0.15 ? 0 : (a - Math.sign(a) * 0.15) / 0.85;
      if (v.kind === 'truck'){
        const thr = -dz(ly), steer = -dz(lx);
        let acc = thr * 7 - v.speed * 0.35;
        if (Math.abs(thr) < 0.05) acc = -Math.sign(v.speed) * Math.min(Math.abs(v.speed) / Math.max(dt, 1e-3), 5);
        const steerAng = steer * 0.55;
        v.drive(dt, acc, 13, 5, v.speed * Math.tan(steerAng) / 3.9, 1.05);
        v.followGround(dt, 2.2, 1.0);
        v.wheels.forEach((w, i) => { w.children[0].rotation.x -= v.speed * dt / 0.48; w.rotation.y = i < 2 ? steerAng : 0; });
        v.wheelSpin.rotation.z = steerAng * 3;
        if (drive && Rh.triggerDown && !Rh.held) sfx.horn(v.pos);
        this.runOver(v, 3.2);
      } else if (v.kind === 'tank'){
        const thr = -dz(ly), turn = -dz(lx);
        let acc = thr * 4 - v.speed * 0.5;
        if (Math.abs(thr) < 0.05) acc = -Math.sign(v.speed) * Math.min(Math.abs(v.speed) / Math.max(dt, 1e-3), 4);
        v.drive(dt, acc, 6, 3, turn * 0.9, 1.4);
        v.followGround(dt, 2.6, 1.4);
        v.turretYaw = wrap(v.turretYaw - dz(rx) * 1.1 * dt);
        v.barrelPitch = Math.max(-0.08, Math.min(0.45, v.barrelPitch - dz(ry) * 0.5 * dt));
        v.turret.rotation.y = v.turretYaw; v.barrel.rotation.x = v.barrelPitch;
        v.reload -= dt;
        if (drive && Rh.trigger > 0.7 && v.reload <= 0 && !Rh.held){ this.fire(v); v.reload = 1.2; Rh.haptic(1, 120); L.haptic(0.8, 120); }
        v.barrel.position.z += (-1.15 - v.barrel.position.z) * Math.min(1, dt * 6);
        this.runOver(v, 3.2);
      } else {
        // helicopter: hovers where you leave it, climbs/descends on the right stick
        const on = drive;
        v.spin += ((on ? 1 : 0) - v.spin) * Math.min(1, dt * (on ? 0.8 : 0.3));
        const g = surfaceHeight(v.pos.x, v.pos.z, v.pos.y + 0.5);
        const lift = v.spin > 0.8;
        const f = fwdOf(v.yaw, v1), r = v2.set(-f.z, 0, f.x);
        const want = new THREE.Vector3().addScaledVector(f, -dz(ly) * 11).addScaledVector(r, dz(lx) * 6);
        if (!lift) want.set(0, 0, 0);
        v.vel.x += (want.x - v.vel.x) * Math.min(1, dt * 1.2); v.vel.z += (want.z - v.vel.z) * Math.min(1, dt * 1.2);
        const climb = lift ? -dz(ry) * 4 : 0;
        if (!on && v.pos.y > g + 0.05) v.vel.y += (-2.5 - v.vel.y) * Math.min(1, dt * 1.5);   // nobody flying it: it settles down gently
        else v.vel.y += (climb - v.vel.y) * Math.min(1, dt * 2);
        v.yaw = wrap(v.yaw - dz(rx) * 1.3 * dt * (lift ? 1 : 0));
        const before = v.pos.clone();
        v.pos.addScaledVector(v.vel, dt);
        const ceil = Math.max(60, groundHeight(v.pos.x, v.pos.z) + 50);
        if (v.pos.y > ceil) { v.pos.y = ceil; v.vel.y = Math.min(0, v.vel.y); }
        if (Math.hypot(v.pos.x, v.pos.z) > EDGE + 25){ v.pos.x = before.x; v.pos.z = before.z; v.vel.x = v.vel.z = 0; }
        // bump into tall things
        for (const k of v.colliderAt){
          const c = v3.set(v.pos.x + f.x * k, 0, v.pos.z + f.z * k), was = c.clone();
          if (pushOut(c, 1.15, v.pos.y, 0.4, { ignore: v })){ v.pos.x += c.x - was.x; v.pos.z += c.z - was.z; v.vel.x *= -0.3; v.vel.z *= -0.3; }
        }
        const g2 = surfaceHeight(v.pos.x, v.pos.z, v.pos.y + 0.5);
        if (v.pos.y < g2){ if (v.vel.y < -3) sfx.thud(v.pos, -v.vel.y); v.pos.y = g2; v.vel.y = Math.max(0, v.vel.y); v.vel.x *= 0.9; v.vel.z *= 0.9; }
        // lean into the way it's going
        const fv = v.vel.dot(fwdOf(v.yaw, v1)), sv = v.vel.dot(v2.set(-v1.z, 0, v1.x));
        const air = v.pos.y > g2 + 0.1 ? 1 : 0;
        v.pitch += (-fv * 0.025 * air - v.pitch) * Math.min(1, dt * 2);
        v.roll += (-sv * 0.04 * air - v.roll) * Math.min(1, dt * 2);
        v.rotor.rotation.y += dt * 28 * v.spin; v.tailRotor.rotation.x += dt * 40 * v.spin;
        v.alt = v.pos.y - g2;
        // the downdraft blows dust and flowers about
        if (v.spin > 0.5 && v.alt < 5 && Math.random() < dt * 20) this.particles.burst(v1.set(v.pos.x + (Math.random() - 0.5) * 6, g2 + 0.1, v.pos.z + (Math.random() - 0.5) * 6), 0xc8b088, 1, 2, 0.06, 0.6, 0.1);
      }
      v.updateColliders();
      v.place();
    }
    if (this.sound && cur) this.sound.set(cur.kind === 'heli' ? 0.5 + cur.spin * 0.5 + Math.abs(cur.vel.y) * 0.05 : Math.abs(cur.speed) / 10);
    this.updateShells(dt);
  }
  // animals and people get bumped out of the way
  runOver(v, len){
    if (Math.abs(v.speed) < 1.5) return;
    const f = fwdOf(v.yaw, v1);
    const front = v2.copy(v.pos).addScaledVector(f, Math.sign(v.speed) * len).setY(v.pos.y + 0.6);
    const dir = f.clone().multiplyScalar(Math.sign(v.speed));
    const c = this.creatures.hitSphere(front, 1.2); if (c) this.creatures.hit(c, dir, 1);
    const n = this.villagers.hitSphere(front, 1.0); if (n) this.villagers.hit(n, dir);
    // drive through blocks? no: they stop you. But knock loose things away.
    for (const it of this.items.list){ if (!it.held && !it.holster && it.mesh.position.distanceTo(front) < 1.3){ it.sleeping = false; it.vel.copy(dir).multiplyScalar(Math.abs(v.speed) * 0.8).setY(2); } }
  }

  // ---- tank shells ----
  fire(v){
    const muzzle = new THREE.Vector3(0, 0, -3.4); v.barrel.localToWorld(muzzle);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(v.barrel.getWorldQuaternion(q1)).normalize();
    const m = this.shellPool.pop() || this.shellMesh.clone();
    this.scene.add(m);
    m.position.copy(muzzle); m.quaternion.copy(q1);
    v.shells.push({ m, p: muzzle.clone(), vel: dir.clone().multiplyScalar(45).add(v1.copy(fwdOf(v.yaw)).multiplyScalar(v.speed)), life: 4 });
    v.barrel.position.z = -0.75;     // recoil
    this.particles.burst(muzzle, 0xffc24a, 12, 4, 0.12, 0.25, 0, dir);
    this.particles.burst(muzzle, 0x8a8a8a, 10, 2, 0.2, 1.0, -0.05, dir);
    sfx.cannon(muzzle);
    this.emit('fire');
  }
  updateShells(dt){
    const v = this.tank;
    for (const s of [...v.shells]){
      s.life -= dt;
      const steps = 6, sub = dt / steps;
      let boom = null;
      for (let i = 0; i < steps && !boom; i++){
        s.vel.y -= 9.8 * sub;
        s.p.addScaledVector(s.vel, sub);
        if (solidAt(s.p.x, s.p.y, s.p.z) && !this.insideTank(s.p)) boom = s.p.clone();
        else if (this.creatures.hitSphere(s.p, 0.3) || this.villagers.hitSphere(s.p, 0.3) || this.dragon.hitSphere(s.p, 0.3)) boom = s.p.clone();
        else for (const it of this.items.list) if (!it.held && it.mesh.position.distanceTo(s.p) < it.radius + 0.2){ boom = s.p.clone(); break; }
      }
      s.m.position.copy(s.p); s.m.lookAt(v1.copy(s.p).add(s.vel));
      if (boom || s.life <= 0){
        this.scene.remove(s.m); this.shellPool.push(s.m); v.shells.splice(v.shells.indexOf(s), 1);
        if (boom) this.explode(boom);
      }
    }
  }
  insideTank(p){ return this.tank.touching(p); }
  explode(p){
    this.particles.burst(p, 0xffb02a, 30, 7, 0.16, 0.5, 0.2);
    this.particles.burst(p, 0xff5a1a, 20, 5, 0.12, 0.6, 0.3);
    this.particles.burst(p, 0x6a6a6a, 24, 3, 0.3, 1.6, -0.08);
    sfx.boom(p);
    const n = this.builder.blast(p, 1.3);
    for (const c of this.creatures.list){ const d = this.creatures.center(c).distanceTo(p); if (d < 5) this.creatures.hit(c, v1.copy(c.pos).sub(p).setY(0).normalize(), 1.5 * (1 - d / 5) + 0.4); }
    for (const nn of this.villagers.list){ if (nn.eye.distanceTo(p) < 5) this.villagers.hit(nn, v1.copy(nn.pos).sub(p).setY(0).normalize()); }
    if (this.dragon.hitSphere(p, 3)) this.dragon.hit();
    for (const it of [...this.items.list]){
      if (it.held || it.holster) continue;
      const d = it.mesh.position.distanceTo(p); if (d > 4) continue;
      if (it.kind === 'bottle'){ this.items.shatter(it); continue; }
      if (it.chop && d < 2){ this.items.cut(it, v1.set(Math.random() - 0.5, 1, Math.random() - 0.5).normalize(), it.mesh.position.clone(), v2.copy(it.mesh.position).sub(p).normalize().multiplyScalar(6)); continue; }
      it.sleeping = false; it.vel.add(v1.copy(it.mesh.position).sub(p).normalize().multiplyScalar(8 * (1 - d / 4))).y += 3;
    }
    this.emit('boom' + (n ? '-blocks' : ''));
  }
}
