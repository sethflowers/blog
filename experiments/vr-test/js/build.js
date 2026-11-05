// Building, Minecraft style. Rest your right index finger on the trigger and a ghost block shows where
// you're pointing; pull to place it, keep holding and sweep to lay a row or a floor. The left trigger
// breaks blocks the same way, and so does punching them or hitting them with the sword or a shot.
// Flick the right stick up or down to change the block. Blocks are saved in the browser.
import * as THREE from 'three';
import { BoxBuilder, blockMaterial, multiBox } from './util.js';
import { VOX, columns, blockAt, setBlock, cellOf, solidAt, PLACES } from './world.js';
import { sfx } from './audio.js';

export const TYPES = [
  { name: 'grass', top: 0x6dbb45, side: 0x8a6142, strip: 0x6dbb45 },
  { name: 'dirt', top: 0x8a6142, side: 0x8a6142 },
  { name: 'stone', top: 0x8d8f93, side: 0x8d8f93 },
  { name: 'planks', top: 0xb48a55, side: 0xb48a55, lines: 0x8f6a3c },
  { name: 'log', top: 0xa07a52, side: 0x6b4a2b },
  { name: 'brick', top: 0xa0462e, side: 0xa0462e, lines: 0xd8cfc0 },
  { name: 'leaves', top: 0x3f8f2e, side: 0x3f8f2e },
  { name: 'white', top: 0xf2f2ee, side: 0xf2f2ee },
  { name: 'red', top: 0xd13b30, side: 0xd13b30 },
  { name: 'yellow', top: 0xf2c530, side: 0xf2c530 },
  { name: 'blue', top: 0x3466c9, side: 0x3466c9 },
  { name: 'gold', top: 0xf5c542, side: 0xe0a92a },
];
const MAX = 3000, REACH = 8, SAVE_KEY = 'vr-test-blocks';
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), m1 = new THREE.Matrix4(), q1 = new THREE.Quaternion();

function typeGeometry(t){
  const B = new BoxBuilder(32), h = VOX / 2;
  if (t.strip){
    B.box(0, h - 0.04, 0, VOX, 0.08, VOX, { all: t.strip, py: t.top }, null, { ao: 0.04 });
    B.box(0, -0.04, 0, VOX, VOX - 0.08, VOX, t.side, null, { skip: { py: true }, ao: 0.25 });
  } else if (t.lines){
    B.box(0, 0, 0, VOX, VOX, VOX, { all: t.side, py: t.top }, null, { ao: 0.2 });
    // a couple of mortar / plank lines, just proud of the faces
    for (const y of [-0.125, 0.125]) B.box(0, y, 0, VOX + 0.004, 0.012, VOX + 0.004, t.lines, null, { skip: { py: true, ny: true }, ao: 0 });
  } else B.box(0, 0, 0, VOX, VOX, VOX, { all: t.side, py: t.top }, null, { ao: 0.22 });
  return B.build();
}

export class Builder {
  constructor(scene, particles){
    this.scene = scene; this.particles = particles;
    this.meshes = TYPES.map((t) => {
      const m = new THREE.InstancedMesh(typeGeometry(t), blockMaterial(), MAX);
      m.count = 0; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(m); return m;
    });
    this.slots = TYPES.map(() => []);           // per type: list of cell keys, index = instance
    this.where = new Map();                     // "i,j,k" -> { t, idx }
    this.selected = 3;
    this.count = 0;
    this.onSay = null;
    // ghost block and outlines
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(VOX * 1.02, VOX * 1.02, VOX * 1.02));
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(VOX * 0.98, VOX * 0.98, VOX * 0.98), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }));
    this.ghostEdge = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffffff }));
    this.ghost.add(this.ghostEdge); this.ghost.visible = false; scene.add(this.ghost);
    this.breakBox = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xff4a3a }));
    this.breakBox.visible = false; scene.add(this.breakBox);
    // the block you'd place, floating over your right hand
    this.preview = new THREE.Mesh(typeGeometry(TYPES[this.selected]), blockMaterial());
    this.preview.scale.setScalar(0.1); this.preview.visible = false; scene.add(this.preview);
    this.drag = null; this.breakDrag = false; this.breakT = 0; this.placeT = 0; this.flickReady = true;
    this.punchCool = [0, 0];
    this.events = [];
    this.saveT = -1;
    // the clear-everything button, on a post by the start
    const C = PLACES.clear;
    this.button = { x: C.x, y: 1.05, z: C.z, armed: 0, press: 0 };
    const post = multiBox([[0.16, 0.95, 0.16, 0x5a3c22, 0, 0.475, 0], [0.34, 0.08, 0.34, 0x3a3a3e, 0, 0.99, 0]]);
    post.position.set(C.x, 0, C.z); scene.add(post);
    this.buttonTop = multiBox([[0.22, 0.08, 0.22, 0xd42a2a, 0, 0.04, 0]]);
    this.buttonTop.position.set(C.x, 1.03, C.z); scene.add(this.buttonTop);
    this.load();
  }
  emit(type, data = {}){ this.events.push({ type, ...data }); if (this.events.length > 200) this.events.shift(); }
  key(i, j, k){ return i + ',' + j + ',' + k; }

  // ----- the store -----
  add(i, j, k, t, quiet = false){
    const key = this.key(i, j, k);
    if (this.where.has(key) || this.count >= MAX) return false;
    const list = this.slots[t], idx = list.length, mesh = this.meshes[t];
    list.push(key); this.where.set(key, { t, idx });
    m1.makeTranslation((i + 0.5) * VOX, (j + 0.5) * VOX, (k + 0.5) * VOX);
    mesh.setMatrixAt(idx, m1); mesh.count = list.length; mesh.instanceMatrix.needsUpdate = true;
    setBlock(i, j, k, t); this.count++;
    if (!quiet){ this.saveT = 1; }
    return true;
  }
  remove(i, j, k){
    const key = this.key(i, j, k), w = this.where.get(key);
    if (!w) return null;
    const list = this.slots[w.t], mesh = this.meshes[w.t], last = list.length - 1;
    if (w.idx !== last){
      // move the last instance into the gap
      const lk = list[last]; list[w.idx] = lk;
      mesh.getMatrixAt(last, m1); mesh.setMatrixAt(w.idx, m1);
      this.where.get(lk).idx = w.idx;
    }
    list.pop(); mesh.count = list.length; mesh.instanceMatrix.needsUpdate = true;
    this.where.delete(key); setBlock(i, j, k, undefined); this.count--;
    this.saveT = 1;
    return w.t;
  }
  clearAll(){
    for (const key of [...this.where.keys()]){ const [i, j, k] = key.split(',').map(Number); this.remove(i, j, k); }
  }
  save(){ try { const out = []; for (const [k, w] of this.where){ out.push(k + ',' + w.t); } localStorage.setItem(SAVE_KEY, out.join(';')); } catch (e) {} }
  load(){
    try {
      const s = localStorage.getItem(SAVE_KEY); if (!s) return;
      for (const part of s.split(';')){ const [i, j, k, t] = part.split(',').map(Number); if ([i, j, k, t].every(Number.isFinite) && TYPES[t]) this.add(i, j, k, t, true); }
    } catch (e) {}
  }

  // ----- pointing -----
  // Walk the grid cell by cell along a ray (Amanatides & Woo). Returns the first solid cell, the empty
  // cell just before it (where a new block goes) and which axis the ray crossed between them.
  pick(o, d, max = REACH){
    const P = [o.x, o.y, o.z], D = [d.x, d.y, d.z];
    const c = [cellOf(o.x), cellOf(o.y), cellOf(o.z)], step = [0, 0, 0], tMax = [0, 0, 0], tDelta = [0, 0, 0];
    for (let a = 0; a < 3; a++){
      step[a] = D[a] > 0 ? 1 : -1;
      tMax[a] = Math.abs(D[a]) < 1e-9 ? Infinity : ((c[a] + (D[a] > 0 ? 1 : 0)) * VOX - P[a]) / D[a];
      tDelta[a] = Math.abs(D[a]) < 1e-9 ? Infinity : VOX / Math.abs(D[a]);
    }
    let prev = null, axis = -1, t = 0;
    for (let n = 0; n < 200 && t < max; n++){
      if (prev){
        const s = t + 0.002;
        if (solidAt(P[0] + D[0] * s, P[1] + D[1] * s, P[2] + D[2] * s))
          return { hit: c.slice(), place: prev, axis, isBlock: blockAt(c[0], c[1], c[2]) !== undefined, t };
      }
      prev = c.slice();
      axis = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : (tMax[1] < tMax[2] ? 1 : 2);
      t = tMax[axis]; c[axis] += step[axis]; tMax[axis] += tDelta[axis];
    }
    return null;
  }
  // a block may go here: empty, not inside you
  canPlace(c, player){
    if (!c || blockAt(c[0], c[1], c[2]) !== undefined) return false;
    const cx = (c[0] + 0.5) * VOX, cz = (c[2] + 0.5) * VOX, y0 = c[1] * VOX, y1 = y0 + VOX;
    const dx = Math.max(Math.abs(cx - player.head.x) - VOX / 2, 0), dz = Math.max(Math.abs(cz - player.head.z) - VOX / 2, 0);
    if (Math.hypot(dx, dz) < 0.2 && y1 > player.pos.y + 0.05 && y0 < player.head.y + 0.15) return false;
    if (y0 < -2 || y0 > 40) return false;
    return true;
  }
  place(c, quiet){
    if (!this.add(c[0], c[1], c[2], this.selected)) return false;
    const p = v1.set((c[0] + 0.5) * VOX, (c[1] + 0.5) * VOX, (c[2] + 0.5) * VOX);
    if (!quiet) sfx.place(p);
    this.particles.burst(p, TYPES[this.selected].side, 4, 0.8, 0.03, 0.35, 0.5);
    this.emit('place', { cell: c.slice() });
    return true;
  }
  breakCell(c, dir){
    const t = this.remove(c[0], c[1], c[2]);
    if (t === null) return false;
    const p = v1.set((c[0] + 0.5) * VOX, (c[1] + 0.5) * VOX, (c[2] + 0.5) * VOX);
    this.particles.burst(p, TYPES[t].side, 12, 2, 0.06, 0.8, 1, dir || null);
    this.particles.burst(p, TYPES[t].top, 5, 1.6, 0.05, 0.7, 1);
    sfx.crunch(p);
    this.emit('break', { cell: c.slice() });
    return true;
  }
  breakAt(p, dir){ const c = [cellOf(p.x), cellOf(p.y), cellOf(p.z)]; return blockAt(...c) !== undefined ? this.breakCell(c, dir) : false; }
  // break every block within r of p (cannon shells)
  blast(p, r){
    let n = 0; const lo = (v) => cellOf(v - r), hi = (v) => cellOf(v + r);
    for (let i = lo(p.x); i <= hi(p.x); i++) for (let j = lo(p.y); j <= hi(p.y); j++) for (let k = lo(p.z); k <= hi(p.z); k++){
      if (blockAt(i, j, k) === undefined) continue;
      if (Math.hypot((i + 0.5) * VOX - p.x, (j + 0.5) * VOX - p.y, (k + 0.5) * VOX - p.z) <= r + 0.2) n += this.breakCell([i, j, k]) ? 1 : 0;
    }
    return n;
  }
  // for bullets: distance to the first block along a ray, or null
  raycast(o, d, max){
    for (let t = 0.05; t < max; t += 0.05){
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      const c = [cellOf(x), cellOf(y), cellOf(z)];
      if (blockAt(...c) !== undefined) return { t, cell: c };
    }
    return null;
  }

  select(step){
    this.selected = (this.selected + step + TYPES.length) % TYPES.length;
    this.preview.geometry.dispose(); this.preview.geometry = typeGeometry(TYPES[this.selected]);
    this.ghost.material.color.set(TYPES[this.selected].side);
    sfx.ui();
    if (this.onSay) this.onSay(TYPES[this.selected].name);
  }

  // ----- every frame -----
  update(dt, hands, player, active){
    this.ghost.visible = false; this.breakBox.visible = false; this.preview.visible = false;
    if (this.saveT > 0){ this.saveT -= dt; if (this.saveT <= 0) this.save(); }
    this.button.armed = Math.max(0, this.button.armed - dt);
    this.buttonTop.position.y += (1.03 - this.button.press * 0.05 - this.buttonTop.position.y) * Math.min(1, dt * 20);
    this.button.press = Math.max(0, this.button.press - dt * 4);
    if (!active) { this.drag = null; this.breakDrag = false; return; }
    const R = hands[1], L = hands[0];

    // pick a block type: flick the right stick up or down
    const sy = R.stick.y, sx = R.stick.x;
    if (Math.abs(sy) > 0.75 && Math.abs(sx) < 0.5 && this.flickReady && !R.held){ this.select(sy < 0 ? 1 : -1); this.flickReady = false; }
    if (Math.abs(sy) < 0.35) this.flickReady = true;

    // ---- place with the right hand ----
    const freeR = R.tracked && !R.held && !R.heldCreature && R.rayQuat;
    if (freeR){
      // show what you'd place over the back of the hand
      this.preview.visible = true;
      this.preview.position.copy(R.pos).add(v1.set(0, 0.13, 0));
      this.preview.rotation.y += dt * 1.2;
      const d = v2.set(0, 0, -1).applyQuaternion(R.rayQuat);
      if (this.drag && R.trigger > 0.4){
        // sweeping: paint into the plane the first block went in
        const D = this.drag, axis = D.axis, plane = D.plane;
        const oa = R.rayPos.getComponent(axis), da = d.getComponent(axis);
        if (Math.abs(da) > 1e-3){
          const t = (plane - oa) / da;
          if (t > 0.1 && t < REACH){
            const p = v1.copy(R.rayPos).addScaledVector(d, t);
            // nudge off the face plane toward the side the blocks go on
            p.setComponent(axis, plane + D.side * 0.01);
            const c = [cellOf(p.x), cellOf(p.y), cellOf(p.z)]; c[axis] = D.layer;
            this.showGhost(c);
            const key = c.join(',');
            if (key !== D.last && this.canPlace(c, player)){ this.placeT -= dt; if (this.place(c, D.n++ % 2 === 1)){ D.last = key; R.haptic(0.15, 15); } }
          }
        }
      } else {
        this.drag = null;
        if (R.triggerTouch){
          const hit = this.pick(R.rayPos, d);
          if (hit && hit.place && this.canPlace(hit.place, player)){
            this.showGhost(hit.place);
            if (R.triggerDown){
              if (this.place(hit.place)){
                R.haptic(0.25, 20);
                // which way the face points decides the plane a sweep paints in
                // a sweep paints along the face you pointed at
                const a = hit.axis, side = Math.sign(hit.place[a] - hit.hit[a]);
                this.drag = { axis: a, layer: hit.place[a], plane: Math.max(hit.place[a], hit.hit[a]) * VOX, side, last: hit.place.join(','), n: 1 };
              }
            }
          }
        }
      }
    } else this.drag = null;

    // ---- break with the left hand ----
    const freeL = L.tracked && !L.held && !L.heldCreature && L.rayQuat;
    if (freeL && (L.triggerTouch || L.trigger > 0.4)){
      const d = v2.set(0, 0, -1).applyQuaternion(L.rayQuat);
      const hit = this.pick(L.rayPos, d);
      if (hit && hit.isBlock){
        this.breakBox.visible = true;
        this.breakBox.position.set((hit.hit[0] + 0.5) * VOX, (hit.hit[1] + 0.5) * VOX, (hit.hit[2] + 0.5) * VOX);
        this.breakT -= dt;
        if (L.triggerDown || (L.trigger > 0.6 && this.breakDrag && this.breakT <= 0)){
          if (this.breakCell(hit.hit, d)){ L.haptic(0.35, 25); this.breakDrag = true; this.breakT = 0.12; }
        }
      }
      if (L.trigger < 0.4) this.breakDrag = false;
    } else this.breakDrag = false;

    // ---- punching blocks, and the clear button ----
    for (let i = 0; i < 2; i++){
      const h = hands[i];
      this.punchCool[i] -= dt;
      if (!h.tracked) continue;
      const sp = h.vel.length();
      if (!h.held && sp > 1.8 && this.punchCool[i] <= 0){
        // the knuckles are a few cm in front of the grip
        const k = v1.set(0, -0.05, -0.01).applyQuaternion(h.quat).add(h.pos);
        if (this.breakAt(k, v2.copy(h.vel).normalize())){ h.haptic(0.7, 40); this.punchCool[i] = 0.15; }
      }
      const B = this.button;
      if (Math.abs(h.pos.x - B.x) < 0.15 && Math.abs(h.pos.z - B.z) < 0.15 && h.pos.y < B.y + 0.1 && h.pos.y > B.y - 0.15 && h.vel.y < -0.3 && B.press <= 0.05){
        B.press = 1; h.haptic(0.5, 40); sfx.ui();
        if (B.armed > 0){ const n = this.count; this.clearAll(); this.save(); B.armed = 0; sfx.crunch(v1.set(B.x, B.y, B.z)); if (this.onSay) this.onSay(`cleared ${n} blocks`); this.emit('clear'); }
        else { B.armed = 3; if (this.onSay) this.onSay('hit again to clear'); }
      }
    }
  }
  // the sword breaks blocks along its blade
  swordSweep(points, speed, dir){
    if (speed < 2.2) return false;
    for (const p of points) if (this.breakAt(p, dir)) return true;
    return false;
  }
  showGhost(c){
    this.ghost.visible = true;
    this.ghost.position.set((c[0] + 0.5) * VOX, (c[1] + 0.5) * VOX, (c[2] + 0.5) * VOX);
  }
}
