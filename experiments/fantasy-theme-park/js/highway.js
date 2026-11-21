// The highway along the south of the park (where visitors will drive in from), with traffic both ways.
import * as THREE from 'three';
import { Batch, rng } from './util.js';
import { mat } from './materials.js';
import { resolveMat } from './models.js';
import { HIGHWAY_Z, HALF } from './park.js';

const LEN = 5000, LANES = [-5.25, -1.75, 1.75, 5.25];

export class Highway {
  constructor(scene){
    const B = new Batch();
    const road = new THREE.PlaneGeometry(LEN, 15); road.rotateX(-Math.PI / 2);
    B.add(road, 'tarmac', new THREE.Matrix4().makeTranslation(0, 0.05, HIGHWAY_Z));
    // white edge lines, dashed lane lines, a double yellow line in the middle (all 1 cm up)
    for (const z of [-7.1, 7.1]) B.box('line', 0, 0.065, HIGHWAY_Z + z, LEN, 0.01, 0.15);
    for (const z of [-0.12, 0.12]) B.box('yellowline', 0, 0.065, HIGHWAY_Z + z, LEN, 0.01, 0.1);
    for (let x = -LEN / 2; x < LEN / 2; x += 12) for (const z of [-3.5, 3.5]) B.box('line', x, 0.065, HIGHWAY_Z + z, 3, 0.01, 0.12);
    // the park's road joins it
    const jn = new THREE.PlaneGeometry(6, HIGHWAY_Z - 7.5 - HALF + 0.2); jn.rotateX(-Math.PI / 2);
    B.add(jn, 'tarmac', new THREE.Matrix4().makeTranslation(0, 0.05, (HALF + HIGHWAY_Z - 7.5) / 2));
    // a verge kerb either side, and crash barriers on the far side
    for (const z of [7.6]) B.box('kerb', 0, 0.08, HIGHWAY_Z + z, LEN, 0.2, 0.3);
    for (const z of [-7.6]){ B.box('kerb', -LEN / 4 - 1.5 - 0.15, 0.08, HIGHWAY_Z + z, LEN / 2 - 3.3, 0.2, 0.3); B.box('kerb', LEN / 4 + 1.5 + 0.15, 0.08, HIGHWAY_Z + z, LEN / 2 - 3.3, 0.2, 0.3); }
    for (let x = -LEN / 2; x < LEN / 2; x += 4) B.box('chrome', x, 0.4, HIGHWAY_Z + 8.6, 0.12, 0.8, 0.12);
    B.box('chrome', 0, 0.65, HIGHWAY_Z + 8.5, LEN, 0.3, 0.05);
    // a sign for the turn
    this.group = B.build(resolveMat);
    this.group.traverse((m) => { if (m.isMesh){ m.receiveShadow = true; } });
    this.group.name = 'highway';
    scene.add(this.group);
    // cars: one shape, many colours, instanced
    const car = carGeometry();
    const colors = [0xf0f0f0, 0x202224, 0x9aa0a6, 0x8a1a1a, 0x1a3a7a, 0x2a4a3a, 0xc8c0b0, 0x4a4e54, 0xd0a020];
    const r = rng(7);
    this.cars = [];
    for (let k = 0; k < 44; k++) this.cars.push({ lane: k % 4, x: (r() - 0.5) * LEN, v: (k % 4 < 2 ? -1 : 1) * (22 + r() * 8), c: colors[Math.floor(r() * colors.length)] });
    this.meshes = car.map(({ geo, key }) => { const im = new THREE.InstancedMesh(geo, key === 'body' ? mat('carpaint', { c: 0xffffff, r: 0.3, mt: 0.6 }) : resolveMat(key), this.cars.length); im.castShadow = true; im.frustumCulled = false; scene.add(im); return im; });
    const c = new THREE.Color();
    this.cars.forEach((car, k) => this.meshes[0].setColorAt(k, c.set(car.c)));
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion();
  }
  update(dt){
    const m = this.m;
    this.cars.forEach((car, k) => {
      car.x += car.v * dt; if (car.x > LEN / 2) car.x -= LEN; if (car.x < -LEN / 2) car.x += LEN;
      this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), car.v > 0 ? 0 : Math.PI);
      m.compose(new THREE.Vector3(car.x, 0.05, HIGHWAY_Z + LANES[car.lane]), this.q, new THREE.Vector3(1, 1, 1));
      for (const im of this.meshes) im.setMatrixAt(k, m);
    });
    for (const im of this.meshes) im.instanceMatrix.needsUpdate = true;
  }
}
// a saloon car 4.5 m long, along +x
export function carGeometry(){
  const parts = { body: new Batch(), glass: new Batch(), tyre: new Batch(), chrome: new Batch() };
  const b = parts.body;
  b.box('body', 0, 0.62, 0, 4.4, 0.62, 1.78);
  const cab = new THREE.CylinderGeometry(1, 1.25, 0.55, 4, 1); cab.rotateY(Math.PI / 4); cab.scale(1.35, 1, 0.8);
  b.add(cab, 'body', new THREE.Matrix4().makeTranslation(-0.2, 1.2, 0));
  parts.glass.add(new THREE.BoxGeometry(2.3, 0.42, 1.64), 'glass', new THREE.Matrix4().makeTranslation(-0.2, 1.2, 0));
  for (const x of [-1.4, 1.35]) for (const z of [-0.8, 0.8]) parts.tyre.add(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 14).rotateX(Math.PI / 2), 'tyre', new THREE.Matrix4().makeTranslation(x, 0.34, z));
  for (const z of [-0.6, 0.6]) parts.chrome.box('chrome', 2.21, 0.7, z, 0.04, 0.14, 0.3);
  const out = [];
  for (const [key, B] of Object.entries(parts)){ const g = B.build(() => null); const m = g.children[0]; out.push({ geo: m.geometry, key }); }
  return out;
}
