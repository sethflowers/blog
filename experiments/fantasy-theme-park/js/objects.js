// Draws the park's objects and answers questions about them.
//  - catalogue things (trees, lamps, benches...) are instanced: one InstancedMesh per type and material;
//  - structures (the gate, arches, car parks, fences, signs) are built one by one;
//  - lamps' night glow: halos (points) and pools of light on the ground (instanced decals), no real lights;
//  - placing rules (canPlace), picking (pick), walking collisions (collide), re-seating on new ground.
import * as THREE from 'three';
import { CATALOG, model, resolveMat } from './models.js';
import { buildGate, buildArch, buildLot, buildFence, buildSign, disposeStructure, FENCES } from './structures.js';
import { spotTexture } from './materials.js';
import { buildBuilding, groundCells, bounds, toLocal, H as STOREY } from './buildings.js';
import { buildStall } from './shops.js';
import { N, CELL, HALF, cellOf, EDGE } from './park.js';

const STRUCT = { gate: 1, arch: 1, lot: 1, sign: 1, building: 1, stall: 1 };
export const isStructure = (t) => !!STRUCT[t] || t.startsWith('fence_');
export const objName = (o) => o.type === 'ride' || o.type === 'coaster' ? (o.name || 'Ride') : o.type === 'building' || o.type === 'stall' ? (o.name || (o.type === 'stall' ? 'Stall' : 'Building')) : o.type === 'gate' ? 'Park entrance' : o.type === 'arch' ? 'Land arch' : o.type === 'lot' ? (o.name || 'Car park') : o.type === 'sign' ? 'Sign' : o.type.startsWith('fence_') ? FENCES[o.type.slice(6)].name : (CATALOG[o.type] ? CATALOG[o.type].name : o.type);

export class Objects {
  constructor(scene, park){
    this.scene = scene; this.park = park;
    this.group = new THREE.Group(); this.group.name = 'objects'; scene.add(this.group);
    this.inst = new Map();       // type -> { meshes, cap, ids }
    this.structs = new Map();    // id -> group
    this.bcells = new Map();     // park cell -> { id, floorY } for the ground floors of buildings
    this.bkeys = new Map();      // building id -> its cells in bcells
    this.cut = null;             // { id, level }: a building cut open while it's being edited
    park.buildingFloor = (k) => { const b = this.bcells.get(k); return b ? b.floorY : null; };
    this.lightsDirty = true;
    // night glow: halos round bulbs and soft pools of light on the ground
    this.haloMat = new THREE.PointsMaterial({ map: spotTexture(), size: 1.6, color: 0xffd8a0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    this.halos = new THREE.Points(new THREE.BufferGeometry(), this.haloMat); this.halos.frustumCulled = false; this.halos.renderOrder = 5;
    this.poolMat = new THREE.MeshBasicMaterial({ map: spotTexture(), color: 0xffc888, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.pools = null;
    scene.add(this.halos);
    this.rebuildAll();
  }
  rebuildAll(){
    for (const g of this.structs.values()) disposeStructure(g);
    this.structs.clear();
    // structures first: furniture inside a building stands on its floor
    for (const o of this.park.s.objects) if (isStructure(o.type)) this.buildStruct(o);
    for (const t of Object.keys(CATALOG)) this.rebuildType(t);
    this.lightsDirty = true;
  }
  // the park changed: which objects; and whether the ground moved under some (rect, in cells)
  update(ids, groundRect){
    const types = new Set();
    for (const id of ids){
      const o = this.park.obj(id), had = this.structs.get(id);
      if (had){ disposeStructure(had); this.structs.delete(id); }
      this.unindex(id);
      if (o && isStructure(o.type)) this.buildStruct(o);
      if (o && CATALOG[o.type]) types.add(o.type);
      if (this.lastType && this.lastType.has(id)) types.add(this.lastType.get(id));
    }
    if (groundRect){
      const [i0, j0, i1, j1] = groundRect, x0 = -HALF + (i0 - 2) * CELL, z0 = -HALF + (j0 - 2) * CELL, x1 = -HALF + (i1 + 3) * CELL, z1 = -HALF + (j1 + 3) * CELL;
      for (const o of this.park.s.objects){
        const pad = o.type === 'lot' ? o.w : o.type === 'gate' ? 20 : o.type === 'building' ? 40 : 0;
        const ox2 = o.x2 ?? o.x, oz2 = o.z2 ?? o.z;
        if (Math.max(o.x, ox2) + pad < x0 || Math.min(o.x, ox2) - pad > x1 || Math.max(o.z, oz2) + pad < z0 || Math.min(o.z, oz2) - pad > z1) continue;
        if (CATALOG[o.type]) types.add(o.type);
        else if (isStructure(o.type)){ const g = this.structs.get(o.id); if (g){ disposeStructure(g); this.structs.delete(o.id); } this.buildStruct(o); }
      }
    }
    for (const t of types) if (t) this.rebuildType(t);
    if (types.size || ids.size) this.lightsDirty = true;
  }
  // all the instances of one catalogue type
  rebuildType(type){
    const list = this.park.s.objects.filter((o) => o.type === type);
    let e = this.inst.get(type);
    if (!list.length && !e) return;
    const M = model(type);
    if (!e || e.cap < list.length){
      if (e) for (const m of e.meshes){ this.group.remove(m); m.dispose(); }
      const cap = Math.max(16, Math.ceil(list.length * 1.5));
      e = { cap, meshes: M.parts.map((p) => {
        const im = new THREE.InstancedMesh(p.geo, resolveMat(p.key), cap);
        im.castShadow = !M.small; im.receiveShadow = true; im.name = type + ':' + p.key;
        if (p.key === 'tint') im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
        this.group.add(im); return im;
      }) };
      this.inst.set(type, e);
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
    if (!this.lastType) this.lastType = new Map();
    list.forEach((o, k) => {
      p.set(o.x, this.park.floorAt(o.x, o.z), o.z); q.setFromAxisAngle(up, o.r || 0); s.setScalar(o.s || 1);
      m.compose(p, q, s);
      for (const im of e.meshes){ im.setMatrixAt(k, m); if (im.instanceColor) im.setColorAt(k, c.set(o.color || '#b02030')); }
      this.lastType.set(o.id, type);
    });
    for (const im of e.meshes){
      im.count = list.length; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
    }
  }
  buildStruct(o){
    const P = this.park;
    let g;
    if (o.type === 'gate') g = buildGate(P.s.name);
    else if (o.type === 'arch'){ const L = P.s.lands[(o.land || 1) - 1]; g = buildArch(L ? L.theme : 'main', L ? L.name : 'New land', o.w || 8); }
    else if (o.type === 'lot') g = buildLot(o, P);
    else if (o.type === 'sign') g = buildSign(o);
    else if (o.type === 'stall') g = buildStall(o);
    else if (o.type === 'building'){
      this.unindex(o.id);
      g = buildBuilding(o, P, this.cut && this.cut.id === o.id ? { cut: this.cut.level } : {});
      g.position.set(o.x, g.userData.floorY, o.z); g.rotation.y = o.r || 0; g.name = 'building:' + o.id;
      this.group.add(g); this.structs.set(o.id, g);
      const keys = []; for (const [x, z] of groundCells(o)){ const k = P.cellIndex(x, z); if (k >= 0){ this.bcells.set(k, { id: o.id, floorY: g.userData.floorY }); keys.push(k); } }
      this.bkeys.set(o.id, keys);
      return;
    }
    else if (o.type.startsWith('fence_')){ g = buildFence(o, P); this.group.add(g); this.structs.set(o.id, g); if (!this.lastType) this.lastType = new Map(); this.lastType.set(o.id, null); return; }
    if (!g) return;
    g.position.set(o.x, o.type === 'lot' ? g.userData.y0 : P.floorAt(o.x, o.z), o.z);
    g.rotation.y = o.r || 0;
    g.name = o.type + ':' + o.id;
    this.group.add(g); this.structs.set(o.id, g);
  }
  unindex(id){ const ks = this.bkeys.get(id); if (ks){ for (const k of ks){ const b = this.bcells.get(k); if (b && b.id === id) this.bcells.delete(k); } this.bkeys.delete(id); } }
  // the building on a park cell (its ground floor), or null
  buildingAt(x, z){ const b = this.bcells.get(this.park.cellIndex(x, z)); return b ? this.park.obj(b.id) : null; }
  // rebuild one building now (while it's being edited, before the edit is finished)
  refresh(o){ const had = this.structs.get(o.id); if (had){ disposeStructure(had); this.structs.delete(o.id); } this.buildStruct(o); this.lightsDirty = true; }
  // the park was renamed / lands renamed: rebuild what shows names
  renamed(){
    for (const o of this.park.s.objects) if (o.type === 'gate' || o.type === 'arch'){ const g = this.structs.get(o.id); if (g) disposeStructure(g); this.structs.delete(o.id); this.buildStruct(o); }
    this.lightsDirty = true;
  }

  // --- night glow -----
  updateLights(night){
    if (this.lightsDirty){
      this.lightsDirty = false;
      const halos = [], pools = [];
      const v = new THREE.Vector3();
      for (const o of this.park.s.objects){
        let glows = null, strength = 1, y0 = 0, base = null;
        if (CATALOG[o.type]){ const M = model(o.type); if (!M.glows.length) continue; glows = M.glows; strength = M.light || 1; }
        else { const g = this.structs.get(o.id); if (!g || !g.userData.glows) continue; glows = g.userData.glows; base = g; }
        y0 = base ? base.position.y : this.park.floorAt(o.x, o.z);
        const rot = base ? base.rotation.y : (o.r || 0), cs = Math.cos(rot), sn = Math.sin(rot), sc = o.s || 1;
        for (const [gx, gy, gz, fy] of glows){
          v.set(o.x + (gx * cs + gz * sn) * sc, y0 + gy * sc, o.z + (-gx * sn + gz * cs) * sc);
          halos.push(v.x, v.y, v.z);
          // (a lamp indoors lights its own floor, not the ground)
          pools.push([v.x, fy !== undefined ? y0 + fy : this.park.floorAt(v.x, v.z), v.z, fy !== undefined ? 4.5 : Math.min(12, 3 + (gy - (fy || 0)) * 1.6) * strength, fy !== undefined]);
        }
      }
      this.halos.geometry.dispose();
      const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.Float32BufferAttribute(halos, 3));
      this.halos.geometry = hg;
      // pools of light, draped over whatever is under them (ground, path or bridge), a few cm up;
      // a lamp indoors lights its own (flat) floor
      if (this.pools){ this.scene.remove(this.pools); this.pools.geometry.dispose(); }
      const G = 6, pos = [], uv = [], idx = [];
      for (const [x, y, z, s, indoor] of pools){
        const v0 = pos.length / 3;
        for (let j = 0; j <= G; j++) for (let i = 0; i <= G; i++){
          const px = x + (i / G - 0.5) * s, pz = z + (j / G - 0.5) * s;
          pos.push(px, (indoor ? y : this.park.floorAt(px, pz)) + 0.05, pz); uv.push(i / G, j / G);
        }
        for (let j = 0; j < G; j++) for (let i = 0; i < G; i++){ const a = v0 + j * (G + 1) + i; idx.push(a, a + G + 1, a + 1, a + 1, a + G + 1, a + G + 2); }
      }
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); pg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      pg.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
      this.pools = new THREE.Mesh(pg, this.poolMat);
      this.pools.frustumCulled = false; this.pools.renderOrder = 4;
      this.scene.add(this.pools);
      this.lightCount = halos.length / 3;
    }
    this.haloMat.opacity = 0.75 * night; this.poolMat.opacity = 0.55 * night;
    this.halos.visible = this.pools.visible = night > 0.02;
  }

  // --- rules -----
  footprint(type, o){
    if (CATALOG[type]) return model(type).r * (o && o.s || 1);
    if (type === 'gate') return 18; if (type === 'arch') return 1; if (type === 'sign') return 1.2; if (type === 'stall') return 1.6;
    if (type === 'ride' && o) return o.kind === 'wheel' ? o.size / 2 + 3 : o.size / 2 + 1.2; if (type === 'coaster') return 0;
    return 1;
  }
  // can an object of this type go at (x, z)? returns null, or why not
  canPlace(type, x, z, opts = {}){
    const P = this.park, S = P.s, i = cellOf(x), j = cellOf(z);
    if (!P.editable(i, j)) return 'That is outside the park.';
    const k = j * N + i, cat = CATALOG[type], r = this.footprint(type, opts);
    if (!Number.isNaN(S.water[k]) && !S.path[k]) return 'Not in the water.';
    if (S.path[k] && cat && !model(type).onPath) return 'Not on a path: trees and rocks go beside paths.';
    const inB = this.bcells.get(k);
    if (inB && (!cat || !model(type).onPath) && type !== 'stall') return 'Not inside a building (furniture and lamps can go inside).';
    if (inB && type === 'stall') return 'Stalls go outside: to sell from a building, give it a use (tap it).';
    for (const o of S.objects){
      if (o.id === opts.ignore) continue;
      if (o.type === 'lot'){ if (Math.abs(x - o.x) < o.w + r && Math.abs(z - o.z) < o.d + r) return 'That is in the car park.'; continue; }
      if (o.type.startsWith('fence_') || o.type === 'building' || o.type === 'coaster') continue;
      const or = this.footprint(o.type, o), d = Math.hypot(o.x - x, o.z - z);
      if (o.type === 'gate'){ if (Math.abs(x - o.x) < 18 && Math.abs(z - o.z) < 3) return 'That is in the entrance.'; continue; }
      // trees can stand close together (their crowns overlap), other things need their own space
      const both = cat && CATALOG[o.type] && CATALOG[o.type].cat === 'trees' && cat.cat === 'trees';
      if (d < (r + or) * (both ? 0.45 : 0.9)) return `Too close to the ${objName(o).toLowerCase()}.`;
    }
    return null;
  }
  // the object under a ray (closest), by its upright cylinder (or box, for structures)
  pick(ray, maxDist = 2000){
    let best = null, bestT = maxDist;
    const o3 = ray.origin, d = ray.direction;
    for (const o of this.park.s.objects){
      let r, h, y0;
      if (CATALOG[o.type]){ const M = model(o.type); r = Math.max(0.5, Math.min(M.canopy || M.r, 3)) * (o.s || 1); h = M.height * (o.s || 1); y0 = this.park.floorAt(o.x, o.z); }
      else if (o.type === 'building'){
        const g = this.structs.get(o.id); if (!g) continue;
        const bb = bounds(o), hgt = o.floors.length * STOREY + 4;
        const [lx, lz] = toLocal(o, o3.x, o3.z), c = Math.cos(o.r || 0), sn = Math.sin(o.r || 0), dlx = d.x * c - d.z * sn, dlz = d.x * sn + d.z * c;
        const t = rayBox([lx, o3.y - g.position.y, lz], [dlx, d.y, dlz], [bb.i0 * CELL, -0.5, bb.j0 * CELL], [(bb.i1 + 1) * CELL, hgt, (bb.j1 + 1) * CELL]);
        if (t !== null && t < bestT){ best = o; bestT = t; }
        continue;
      }
      else if (o.type === 'gate'){ r = 10; h = 14; y0 = this.park.floorAt(o.x, o.z); }
      else if (o.type === 'stall'){ r = 1.5; h = 4; y0 = this.park.floorAt(o.x, o.z); }
      else if (o.type === 'arch'){ r = (o.w || 8) / 2 + 1; h = 7; y0 = this.park.floorAt(o.x, o.z); }
      else if (o.type === 'lot'){
        // a flat rectangle on the ground
        const g = this.structs.get(o.id); const yy = g ? g.position.y + 0.06 : 0;
        if (Math.abs(d.y) < 1e-4) continue; const t = (yy - o3.y) / d.y; if (t < 0 || t > bestT) continue;
        const px = o3.x + d.x * t - o.x, pz = o3.z + d.z * t - o.z, c = Math.cos(o.r || 0), s = Math.sin(o.r || 0);
        const lx = px * c - pz * s, lz = px * s + pz * c;
        if (Math.abs(lx) < o.w && Math.abs(lz) < o.d){ best = o; bestT = t; }
        continue;
      } else if (o.type.startsWith('fence_')){
        // closest approach to the fence line
        const mx = (o.x + o.x2) / 2, mz = (o.z + o.z2) / 2;
        const t = closestT(o3, d, mx, this.park.floorAt(mx, mz) + 0.7, mz);
        if (t < 0 || t > bestT) continue;
        const px = o3.x + d.x * t, pz = o3.z + d.z * t;
        if (distSeg(px, pz, o.x, o.z, o.x2, o.z2) < 0.8){ best = o; bestT = t; }
        continue;
      } else { r = 1.3; h = 3; y0 = this.park.floorAt(o.x, o.z); }
      // ray vs vertical cylinder (x, z, r) between y0 and y0 + h
      const fx = o3.x - o.x, fz = o3.z - o.z, a = d.x * d.x + d.z * d.z, b = 2 * (fx * d.x + fz * d.z), c = fx * fx + fz * fz - r * r;
      const disc = b * b - 4 * a * c; if (disc < 0 || a < 1e-8) continue;
      const sq = Math.sqrt(disc);
      for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]){
        if (t < 0 || t > bestT) continue;
        const y = o3.y + d.y * t; if (y < y0 - 0.2 || y > y0 + h) continue;
        best = o; bestT = t; break;
      }
      // or the top cap (looking down on something)
      if (d.y < 0){ const t = (y0 + h - o3.y) / d.y; if (t > 0 && t < bestT){ const px = o3.x + d.x * t - o.x, pz = o3.z + d.z * t - o.z; if (px * px + pz * pz < r * r){ best = o; bestT = t; } } }
    }
    return best ? { o: best, t: bestT } : null;
  }
  // walking: push the point (x, z) with radius rad out of solid things; returns the new [x, z]
  collide(x, z, rad){
    // rides first (their own colliders, in their own frames)
    if (this.rides) for (const it of this.rides.items.values()){
      if (!it.flat || Math.hypot(it.o.x - x, it.o.z - z) > it.o.size + 8) continue;
      [x, z] = this.pushOut(it.o, it.group.userData.colliders, x, z, rad);
    }
    return this.collideObjects(x, z, rad);
  }
  pushOut(o, cols, x, z, rad){
    const c = Math.cos(o.r || 0), s = Math.sin(o.r || 0);
    for (const col of cols){
      let lx = (x - o.x) * c - (z - o.z) * s, lz = (x - o.x) * s + (z - o.z) * c;
      if (col.c){ const dx = lx - col.c[0], dz = lz - col.c[1], d = Math.hypot(dx, dz), r = col.r + rad; if (d < r && d > 1e-4){ lx = col.c[0] + dx / d * r; lz = col.c[1] + dz / d * r; } }
      else { const [x0, z0, x1, z1] = col.box; if (lx > x0 - rad && lx < x1 + rad && lz > z0 - rad && lz < z1 + rad){ const p = [lx - (x0 - rad), (x1 + rad) - lx, lz - (z0 - rad), (z1 + rad) - lz], m = Math.min(...p); if (m === p[0]) lx = x0 - rad; else if (m === p[1]) lx = x1 + rad; else if (m === p[2]) lz = z0 - rad; else lz = z1 + rad; } }
      x = o.x + lx * c + lz * s; z = o.z - lx * s + lz * c;
    }
    return [x, z];
  }
  collideObjects(x, z, rad){
    for (const o of this.park.s.objects){
      if (Math.abs(o.x - x) > 25 && !o.type.startsWith('fence_')) continue;
      if (CATALOG[o.type]){
        const M = model(o.type), solid = M.solid ?? (CATALOG[o.type].cat === 'trees' ? 0.35 : M.small ? 0 : (M.r * 0.6));
        if (!solid) continue;
        const r = solid * (o.s || 1) + rad, dx = x - o.x, dz = z - o.z, d = Math.hypot(dx, dz);
        if (d < r && d > 1e-4){ x = o.x + dx / d * r; z = o.z + dz / d * r; }
      } else if (o.type.startsWith('fence_')){
        const [qx, qz, d] = nearestOnSeg(x, z, o.x, o.z, o.x2, o.z2), r = (o.type === 'fence_hedgerow' ? 0.45 : o.type === 'fence_wall' ? 0.3 : 0.1) + rad;
        if (d < r && d > 1e-4){ x = qx + (x - qx) / d * r; z = qz + (z - qz) / d * r; }
      } else {
        const g = this.structs.get(o.id); const cols = g && g.userData.colliders; if (!cols) continue;
        const c = Math.cos(o.r || 0), s = Math.sin(o.r || 0);
        for (const col of cols){
          // into the structure's own frame and back
          let lx = (x - o.x) * c - (z - o.z) * s, lz = (x - o.x) * s + (z - o.z) * c;
          if (col.c){ const dx = lx - col.c[0], dz = lz - col.c[1], d = Math.hypot(dx, dz), r = col.r + rad; if (d < r && d > 1e-4){ lx = col.c[0] + dx / d * r; lz = col.c[1] + dz / d * r; } }
          else { const [x0, z0, x1, z1] = col.box; if (lx > x0 - rad && lx < x1 + rad && lz > z0 - rad && lz < z1 + rad){ const p = [lx - (x0 - rad), (x1 + rad) - lx, lz - (z0 - rad), (z1 + rad) - lz], m = Math.min(...p); if (m === p[0]) lx = x0 - rad; else if (m === p[1]) lx = x1 + rad; else if (m === p[2]) lz = z0 - rad; else lz = z1 + rad; } }
          x = o.x + lx * c + lz * s; z = o.z - lx * s + lz * c;
        }
      }
    }
    return [x, z];
  }
  stats(){ let draw = 0; this.group.traverse((o) => { if (o.isMesh) draw++; }); return { objects: this.park.s.objects.length, meshes: draw }; }
}
function rayBox(o, d, lo, hi){
  let t0 = 0, t1 = 1e9;
  for (let a = 0; a < 3; a++){
    if (Math.abs(d[a]) < 1e-9){ if (o[a] < lo[a] || o[a] > hi[a]) return null; continue; }
    let ta = (lo[a] - o[a]) / d[a], tb = (hi[a] - o[a]) / d[a]; if (ta > tb){ const t = ta; ta = tb; tb = t; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return null;
  }
  return t0;
}
function closestT(o, d, x, y, z){ return (x - o.x) * d.x + (y - o.y) * d.y + (z - o.z) * d.z; }
function nearestOnSeg(px, pz, ax, az, bx, bz){
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  const qx = ax + dx * t, qz = az + dz * t; return [qx, qz, Math.hypot(px - qx, pz - qz)];
}
function distSeg(px, pz, ax, az, bx, bz){ return nearestOnSeg(px, pz, ax, az, bx, bz)[2]; }
export { EDGE };
