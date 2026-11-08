// Visitors: drawn as instanced figures (one draw call for everyone walking about, one per truck for
// the people riding in it), so a busy day stays smooth.
import * as THREE from 'three';
import { V, clamp, damp, angleDiff, mergeGeometries, boxUV } from './util.js';

const SHIRTS = [0x3a6ab0, 0xb03a3a, 0x3a8a4a, 0xe0c040, 0x7a4a9a, 0xf0f0f0, 0x2a4a6a, 0xd07a3a, 0xe87aa0, 0x40b0b0, 0xc8b890, 0x606060];
const SKINS = [0xf2cfae, 0xd9a77c, 0xa86e48, 0x6e4430, 0xf6dcc6, 0xc08a60];
function coloured(g, c){ const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++){ a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; }
const at = (g, x, y, z) => { g.translate(x, y, z); return g.index ? g.toNonIndexed() : g; };

// clothes: the shirt takes the instance colour; trousers are drawn darker
function figure(seated){
  const shirt = [1, 1, 1], pants = [0.38, 0.38, 0.45];
  const body = [coloured(at(boxUV(0.4, 0.55, 0.24), 0, 1.18, 0), shirt)];
  for (const sx of [-0.25, 0.25]) body.push(coloured(at(boxUV(0.1, 0.5, 0.12), sx, 1.15, seated ? 0.08 : 0), shirt));
  if (seated){ for (const sx of [-0.1, 0.1]){ body.push(coloured(at(boxUV(0.15, 0.15, 0.5), sx, 0.88, 0.18), pants)); body.push(coloured(at(boxUV(0.13, 0.5, 0.14), sx, 0.6, 0.42), pants)); } }
  else for (const sx of [-0.1, 0.1]) body.push(coloured(at(boxUV(0.15, 0.85, 0.16), sx, 0.45, 0), pants));
  const head = [coloured(at(new THREE.SphereGeometry(0.13, 10, 8), 0, 1.62, 0), [1, 1, 1]), coloured(at(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 6), 0, 1.48, 0), [1, 1, 1])];
  for (const sx of [-0.25, 0.25]) head.push(coloured(at(new THREE.SphereGeometry(0.055, 6, 5), sx, 0.87, seated ? 0.12 : 0), [1, 1, 1]));
  return { body: mergeGeometries(body), head: mergeGeometries(head) };
}
const STAND = figure(false), SIT = figure(true);
const MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });

export class Crowd {
  constructor(scene, max = 140){
    this.max = max; this.list = [];
    this.body = new THREE.InstancedMesh(STAND.body, MAT, max); this.head = new THREE.InstancedMesh(STAND.head, MAT, max);
    for (const m of [this.body, this.head]){ m.count = 0; m.castShadow = true; m.frustumCulled = false; scene.add(m); }
    this.M = new THREE.Matrix4(); this.Q = new THREE.Quaternion(); this.C = new THREE.Color(); this.Y = V(0, 1, 0);
  }
  // a new person: { pos, path: [points], speed, onDone }
  add(o){
    const p = { pos: o.pos.clone(), path: o.path || [], speed: o.speed || 1.3, yaw: 0, shirt: o.shirt ?? SHIRTS[Math.floor(Math.random() * SHIRTS.length)], skin: o.skin ?? SKINS[Math.floor(Math.random() * SKINS.length)], onDone: o.onDone, t: Math.random() * 10, data: o.data };
    this.list.push(p); return p;
  }
  remove(p){ const i = this.list.indexOf(p); if (i >= 0) this.list.splice(i, 1); }
  update(dt, world){
    let n = 0;
    for (const p of [...this.list]){
      p.t += dt;
      let moving = false;
      if (p.path.length){
        const tg = p.path[0], dx = tg.x - p.pos.x, dz = tg.z - p.pos.z, d = Math.hypot(dx, dz);
        if (d < 0.25){ p.path.shift(); if (!p.path.length && p.onDone){ const f = p.onDone; p.onDone = null; f(p); } }
        else { const s = Math.min(d, p.speed * dt); p.pos.x += dx / d * s; p.pos.z += dz / d * s; p.yaw = Math.atan2(dx, dz); moving = true; }
      }
      if (!this.list.includes(p) || n >= this.max) continue;
      const y = (p.y ?? world.height(p.pos.x, p.pos.z)) + (moving ? Math.abs(Math.sin(p.t * 8)) * 0.04 : 0);
      this.Q.setFromAxisAngle(this.Y, p.yaw + (moving ? 0 : Math.sin(p.t * 0.5) * 0.3));
      this.M.compose(V(p.pos.x, y, p.pos.z), this.Q, V(1, 1, 1));
      this.body.setMatrixAt(n, this.M); this.head.setMatrixAt(n, this.M);
      this.body.setColorAt(n, this.C.setHex(p.shirt)); this.head.setColorAt(n, this.C.setHex(p.skin));
      n++;
    }
    this.body.count = this.head.count = n;
    for (const m of [this.body, this.head]){ m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }
}

// the people riding in a truck: twelve seats, shown or hidden
export class Riders {
  constructor(truck){
    this.truck = truck;
    this.body = new THREE.InstancedMesh(SIT.body, MAT, 12); this.head = new THREE.InstancedMesh(SIT.head, MAT, 12);
    for (const m of [this.body, this.head]){ m.count = 0; m.castShadow = true; truck.m.body.add(m); }
    this.M = new THREE.Matrix4(); this.C = new THREE.Color(); this.t = Math.random() * 10;
    this.refresh();
  }
  // which seats are full: an array of rider objects (or null for the player's seat)
  refresh(skip = -1){
    const R = this.truck.riders, seats = this.truck.m.seats;
    let n = 0;
    R.forEach((r, i) => {
      if (!r || i === skip || i >= seats.length) return;
      const s = seats[i];
      this.M.makeTranslation(s.x, s.y - 0.95, s.z + 0.05);
      this.body.setMatrixAt(n, this.M); this.head.setMatrixAt(n, this.M);
      this.body.setColorAt(n, this.C.setHex(r.shirt)); this.head.setColorAt(n, this.C.setHex(r.skin)); n++;
    });
    this.body.count = this.head.count = n;
    for (const m of [this.body, this.head]){ m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }
}
export function randomLook(){ return { shirt: SHIRTS[Math.floor(Math.random() * SHIRTS.length)], skin: SKINS[Math.floor(Math.random() * SKINS.length)] }; }
void clamp; void damp; void angleDiff;
