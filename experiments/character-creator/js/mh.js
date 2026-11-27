// The human: MakeHuman's CC0 base mesh, morph targets, skeleton and fitted parts (see
// _tools/character-creator/build_assets.py), turned into a three.js skinned character.
//
//  loadHumanData()            fetches and unpacks data/*.bin (once)
//  new Human(data)            the meshes, skeleton and fitted parts, ready to shape
//  human.setShape(shape)      { macro: { gender, age, muscle, weight, height, proportions, african,
//                               asian, caucasian, cup, firmness }, mods: { name: -1..1 }, expr: { name: 0..1 } }
//  human.setParts(parts)      { eyes, brows, lashes, hair, outfit, shoes, hat, teeth: true }
//
// Data is found next to this file (../data/), with this file's own ?v= on every address, so the js/
// and data/ folders can be copied into another game as they are.
import * as THREE from 'three';

const HERE = new URL(import.meta.url);
const VQ = HERE.search;   // '?v=1.0'
export const dataURL = (f) => new URL('../data/' + f, HERE).pathname + VQ;

const TYPES = { float32: Float32Array, uint16: Uint16Array, int16: Int16Array, uint8: Uint8Array, uint32: Uint32Array, int32: Int32Array };
async function loadContainer(file, progress){
  const res = await fetch(dataURL(file));
  if (!res.ok) throw new Error(file + ': ' + res.status);
  let buf;
  if (typeof DecompressionStream === 'function') buf = await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  else throw new Error('This browser is too old to unpack the character data (it needs iOS 16.4 or newer).');
  if (progress) progress(file);
  const dv = new DataView(buf), jl = dv.getUint32(0, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, jl)));
  const base = 4 + jl, out = { meta: head.meta };
  for (const a of head.arrays){
    const T = TYPES[a.type];
    // (copied so each array is aligned however its offset falls)
    out[a.name] = new T(buf.slice(base + a.offset, base + a.offset + a.length * T.BYTES_PER_ELEMENT));
  }
  return out;
}

let dataPromise = null;
export function loadHumanData(progress){
  if (!dataPromise) dataPromise = (async () => {
    const [manifest, base, targets, assets] = await Promise.all([
      fetch(dataURL('manifest.json')).then((r) => r.json()),
      loadContainer('base.bin', progress), loadContainer('targets.bin', progress), loadContainer('assets.bin', progress)]);
    // the targets: indices were stored as differences
    const T = new Map();
    const names = targets.meta.names;
    for (let t = 0; t < names.length; t++){
      const o = targets.offset[t], n = targets.count[t];
      const idx = new Uint32Array(n); let acc = 0;
      for (let k = 0; k < n; k++){ acc += targets.index[o + k]; idx[k] = acc; }
      T.set(names[t], { idx, d: targets.delta.subarray(o * 3, (o + n) * 3), s: targets.scale[t] });
    }
    const parts = assets.meta.assets.map((a) => ({ ...a, refs: assets[a.key + 'refs'], w: assets[a.key + 'w'], off: assets[a.key + 'off'], uv: assets[a.key + 'uv'], index: assets[a.key + 'index'], del: assets[a.key + 'del'] || null }));
    return { manifest, base, targets: T, parts };
  })();
  return dataPromise;
}

// ---------- the macro model: which targets, and how much of each ----------
// gender 0 female .. 1 male; age 0 .. 1 (0.1875 = 11 years, 0.5 = 25, 1 = 90); muscle, weight, height,
// proportions, cup, firmness 0 .. 1 with 0.5 average; african + asian + caucasian = 1.
export const AGE_MIN = 0.1875;
export const ageToYears = (a) => (a < 0.5 ? 1 + (a / 0.5) * 24 : 25 + ((a - 0.5) / 0.5) * 65);
export const yearsToAge = (y) => (y < 25 ? (y - 1) / 24 * 0.5 : 0.5 + (y - 25) / 65 * 0.5);
const tri = (v) => (v < 0.5 ? { min: (0.5 - v) / 0.5, average: v / 0.5, max: 0 } : { min: 0, average: (1 - v) / 0.5, max: (v - 0.5) / 0.5 });
export function macroWeights(m){
  const G = { female: 1 - m.gender, male: m.gender };
  const a = Math.max(AGE_MIN, m.age);
  const A = a < 0.5 ? { child: (0.5 - a) / (0.5 - AGE_MIN), young: (a - AGE_MIN) / (0.5 - AGE_MIN), old: 0 } : { child: 0, young: (1 - a) / 0.5, old: (a - 0.5) / 0.5 };
  const M = tri(m.muscle), Wt = tri(m.weight);
  const out = [];
  const put = (name, w) => { if (w > 1e-4) out.push([name, w]); };
  const sum = (m.african + m.asian + m.caucasian) || 1;
  for (const g in G) for (const ag in A){
    const ga = G[g] * A[ag];
    if (ga < 1e-4) continue;
    for (const mu in M) for (const we in Wt) put(`macro/universal-${g}-${ag}-${mu}muscle-${we}weight`, ga * M[mu] * Wt[we]);
    put(`macro/african-${g}-${ag}`, ga * m.african / sum); put(`macro/asian-${g}-${ag}`, ga * m.asian / sum); put(`macro/caucasian-${g}-${ag}`, ga * m.caucasian / sum);
    if (m.height < 0.5) put(`macro/height-${g}-${ag}-min`, ga * (0.5 - m.height) / 0.5); else put(`macro/height-${g}-${ag}-max`, ga * (m.height - 0.5) / 0.5);
    if (m.proportions < 0.5) put(`macro/proportions-${g}-${ag}-uncommon`, ga * (0.5 - m.proportions) / 0.5); else put(`macro/proportions-${g}-${ag}-ideal`, ga * (m.proportions - 0.5) / 0.5);
    const C = tri(m.cup ?? 0.5), F = tri(m.firmness ?? 0.5);
    for (const c in C) for (const f in F) if (!(c === 'average' && f === 'average')) put(`macro/breast-${g}-${ag}-${c}-${f}`, ga * C[c] * F[f]);
  }
  return out;
}
// a slider's targets: -1..1 between its two ends, or 0..1 for a one-ended one
export function modWeights(sliders, mods){
  const out = [];
  for (const s of sliders){
    const v = mods[s.name];
    if (!v) continue;
    if (s.targets.length === 2){ if (v < 0) out.push([s.targets[0], -v]); else out.push([s.targets[1], v]); }
    else out.push([s.targets[0], v]);
  }
  return out;
}

function applyTargets(pos, targets, list){
  for (const [name, w] of list){
    const t = targets.get(name);
    if (!t || !w) continue;
    const k = w * t.s, idx = t.idx, d = t.d;
    for (let i = 0; i < idx.length; i++){
      const o = idx[i] * 3, j = i * 3;
      pos[o] += d[j] * k; pos[o + 1] += d[j + 1] * k; pos[o + 2] += d[j + 2] * k;
    }
  }
}

// ---------- the character ----------
export class Human {
  constructor(data){
    this.data = data;
    const B = data.base;
    this.N = B.meta.vertexCount;
    this.pos = new Float32Array(B.pos);          // the shaped base mesh (every vertex)
    this.macroPos = new Float32Array(B.pos);
    this.macroKey = '';
    this.root = new THREE.Group(); this.root.name = 'character';
    this.offsetY = 0;
    // skeleton
    this.bones = []; this.boneByName = {};
    for (const [name, parent] of B.meta.bones){
      const b = new THREE.Bone(); b.name = name;
      this.bones.push(b); this.boneByName[name] = b;
      if (parent >= 0) this.bones[parent].add(b); else this.root.add(b);
    }
    this.skeleton = new THREE.Skeleton(this.bones);
    this.rest = this.bones.map(() => new THREE.Quaternion());
    // body: render vertices -> base vertices
    const rv = B.bodyRV, n = rv.length;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(B.bodyUV, 2));
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++){ si[i * 4 + k] = B.skinIndex[rv[i] * 4 + k]; sw[i * 4 + k] = B.skinWeight[rv[i] * 4 + k]; }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    this.bodyIndexAll = B.bodyIndex;
    g.setIndex(new THREE.BufferAttribute(new Uint16Array(B.bodyIndex), 1));
    this.bodyGeo = g;
    this.body = new THREE.SkinnedMesh(g, new THREE.MeshStandardMaterial({ color: 0xd0a080 }));
    this.body.name = 'body';
    this.body.frustumCulled = false;
    this.root.add(this.body);
    // fitted parts, made when first worn
    this.parts = new Map();   // id -> { def, mesh, geo }
    this.worn = {};
    this.blink = this.targetDelta('expr/eye-closure');
  }

  // a target's offsets as a dense array over base vertices (for GPU morphs such as blinking)
  targetDelta(name){
    const t = this.data.targets.get(name);
    if (!t) return null;
    const out = new Float32Array(this.N * 3);
    for (let i = 0; i < t.idx.length; i++){ const o = t.idx[i] * 3; out[o] = t.d[i * 3] * t.s; out[o + 1] = t.d[i * 3 + 1] * t.s; out[o + 2] = t.d[i * 3 + 2] * t.s; }
    return out;
  }

  setShape(shape){
    const D = this.data;
    const mk = JSON.stringify(shape.macro);
    if (mk !== this.macroKey){
      this.macroPos.set(D.base.pos);
      applyTargets(this.macroPos, D.targets, macroWeights(shape.macro));
      this.macroKey = mk;
    }
    this.pos.set(this.macroPos);
    applyTargets(this.pos, D.targets, modWeights(D.manifest.sliders, shape.mods || {}));
    const ex = [];
    for (const k in shape.expr || {}) if (shape.expr[k]) ex.push(['expr/' + k, shape.expr[k]]);
    applyTargets(this.pos, D.targets, ex);
    this.shape = shape;
    this.update();
  }

  // everything that follows from the shaped mesh: the body, the skeleton, the fitted parts
  update(){
    const p = this.pos, B = this.data.base;
    // stand on the floor: the lowest point of the feet (or the shoes) at 0
    let minY = Infinity;
    const rv = B.bodyRV;
    for (let i = 0; i < rv.length; i++){ const y = p[rv[i] * 3 + 1]; if (y < minY) minY = y; }
    this.footY = minY;
    // body positions and normals (accumulated over the base vertices, so the texture seams don't show)
    const bp = this.bodyGeo.attributes.position.array, bn = this.bodyGeo.attributes.normal.array;
    for (let i = 0; i < rv.length; i++){ const o = rv[i] * 3; bp[i * 3] = p[o]; bp[i * 3 + 1] = p[o + 1]; bp[i * 3 + 2] = p[o + 2]; }
    const acc = new Float32Array(this.N * 3), I = this.bodyIndexAll;
    for (let t = 0; t < I.length; t += 3){
      const a = rv[I[t]] * 3, b = rv[I[t + 1]] * 3, c = rv[I[t + 2]] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const o of [a, b, c]){ acc[o] += nx; acc[o + 1] += ny; acc[o + 2] += nz; }
    }
    for (let i = 0; i < rv.length; i++){
      const o = rv[i] * 3, l = Math.hypot(acc[o], acc[o + 1], acc[o + 2]) || 1;
      bn[i * 3] = acc[o] / l; bn[i * 3 + 1] = acc[o + 1] / l; bn[i * 3 + 2] = acc[o + 2] / l;
    }
    // cavities: where the surface folds in (eye sockets, nostrils, the corners of the mouth, the ears)
    // it's darker, as light can't reach it. From the mesh's own curvature: how far a vertex sits
    // behind the average of its neighbours, along its normal, against the edge length. Then spread.
    const sum = new Float32Array(this.N * 3), cnt = new Float32Array(this.N), elen = new Float32Array(this.N);
    for (let t = 0; t < I.length; t += 3){
      const v = [rv[I[t]], rv[I[t + 1]], rv[I[t + 2]]];
      for (let k = 0; k < 3; k++){
        const a = v[k] * 3, b = v[(k + 1) % 3] * 3, c = v[(k + 2) % 3] * 3;
        sum[a] += p[b] + p[c]; sum[a + 1] += p[b + 1] + p[c + 1]; sum[a + 2] += p[b + 2] + p[c + 2]; cnt[v[k]] += 2;
        elen[v[k]] += Math.hypot(p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]);
      }
    }
    const occ = new Float32Array(this.N).fill(1);
    for (let i = 0; i < rv.length; i++){
      const v = rv[i], o = v * 3, n = cnt[v]; if (!n) continue;
      const dx = sum[o] / n - p[o], dy = sum[o + 1] / n - p[o + 1], dz = sum[o + 2] / n - p[o + 2];
      const l = Math.hypot(acc[o], acc[o + 1], acc[o + 2]) || 1;
      const cav = (dx * acc[o] + dy * acc[o + 1] + dz * acc[o + 2]) / l / ((elen[v] / (n / 2)) || 1);
      occ[v] = 1 - Math.min(1, Math.max(0, (cav - 0.03) / 0.3)) * 0.55;
    }
    const col = this.bodyGeo.attributes.color ? this.bodyGeo.attributes.color.array : new Float32Array(rv.length * 3);
    for (let i = 0; i < rv.length; i++){ const c = occ[rv[i]]; col[i * 3] = c; col[i * 3 + 1] = c * 0.97 + 0.03 * c * c; col[i * 3 + 2] = c * 0.95 + 0.05 * c * c; }
    if (!this.bodyGeo.attributes.color) this.bodyGeo.setAttribute('color', new THREE.BufferAttribute(col, 3)); else this.bodyGeo.attributes.color.needsUpdate = true;
    this.bodyGeo.attributes.position.needsUpdate = true; this.bodyGeo.attributes.normal.needsUpdate = true;
    this.bodyGeo.computeBoundingSphere();
    if (this.blink){
      const m = new Float32Array(rv.length * 3);
      for (let i = 0; i < rv.length; i++){ const o = rv[i] * 3; m[i * 3] = this.blink[o]; m[i * 3 + 1] = this.blink[o + 1]; m[i * 3 + 2] = this.blink[o + 2]; }
      this.bodyGeo.morphAttributes.position = [new THREE.BufferAttribute(m, 3)];
      this.bodyGeo.morphTargetsRelative = true;
      this.body.updateMorphTargets();
    }
    for (const part of this.parts.values()) if (part.mesh.visible) this.fitPart(part);
    this.placeBones();
    // feet on the floor (shoes count)
    let low = minY;
    for (const part of this.parts.values()) if (part.mesh.visible && part.def.kind === 'shoes') low = Math.min(low, part.minY);
    this.offsetY = -low;
    this.root.position.y = this.offsetY;
  }

  // the bones sit at the averages of their joints' vertices; then the skin is bound to them
  placeBones(){
    const B = this.data.base, p = this.pos, jo = B.jointOff, jv = B.jointVerts;
    const J = new Float32Array((jo.length - 1) * 3);
    for (let j = 0; j < jo.length - 1; j++){
      let x = 0, y = 0, z = 0; const n = jo[j + 1] - jo[j];
      for (let k = jo[j]; k < jo[j + 1]; k++){ const o = jv[k] * 3; x += p[o]; y += p[o + 1]; z += p[o + 2]; }
      J[j * 3] = x / n; J[j * 3 + 1] = y / n; J[j * 3 + 2] = z / n;
    }
    this.joints = J;
    const saved = this.bones.map((b) => b.quaternion.clone());
    const heads = [];
    B.meta.bones.forEach(([, parent, h, t], i) => {
      const b = this.bones[i];
      const hx = J[h * 3], hy = J[h * 3 + 1], hz = J[h * 3 + 2];
      heads.push([hx, hy, hz]);
      b.userData.tail = new THREE.Vector3(J[t * 3], J[t * 3 + 1], J[t * 3 + 2]);
      b.userData.head = new THREE.Vector3(hx, hy, hz);
      if (parent >= 0){ const q = heads[parent]; b.position.set(hx - q[0], hy - q[1], hz - q[2]); }
      else b.position.set(hx, hy, hz);
      b.quaternion.identity(); b.scale.set(1, 1, 1);
    });
    this.root.updateMatrixWorld(true);
    // bind at the rest pose, in the character's own space
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    this.skeleton.boneInverses = this.bones.map((b) => new THREE.Matrix4().multiplyMatrices(inv, b.matrixWorld).invert());
    for (const m of this.allMeshes()){
      m.bindMode = 'attached';
      m.bind(this.skeleton, new THREE.Matrix4());
    }
    this.bones.forEach((b, i) => b.quaternion.copy(saved[i]));
    this.restPose = null;
  }

  // ---------- fitted parts ----------
  part(id){
    if (this.parts.has(id)) return this.parts.get(id);
    const def = this.data.parts.find((a) => a.id === id);
    if (!def) return null;
    const n = def.refs.length / 3, B = this.data.base;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(def.uv, 2));
    // skin weights: the three body vertices' weights, blended
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++){
      const acc = new Map();
      for (let r = 0; r < 3; r++){
        const v = def.refs[i * 3 + r], w = def.w[i * 3 + r];
        if (!w) continue;
        for (let k = 0; k < 4; k++){ const bi = B.skinIndex[v * 4 + k], bw = B.skinWeight[v * 4 + k] * w; if (bw) acc.set(bi, (acc.get(bi) || 0) + bw); }
      }
      const top = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
      const s = top.reduce((t, e) => t + e[1], 0) || 1;
      top.forEach(([bi, bw], k) => { si[i * 4 + k] = bi; sw[i * 4 + k] = bw / s; });
    }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    g.setIndex(new THREE.BufferAttribute(def.index, 1));
    const mesh = new THREE.SkinnedMesh(g, new THREE.MeshStandardMaterial());
    mesh.name = def.kind + ':' + id; mesh.frustumCulled = false;
    mesh.renderOrder = def.zDepth || 0;
    this.root.add(mesh);
    const part = { def, mesh, geo: g, minY: 0 };
    this.parts.set(id, part);
    this.fitPart(part);
    mesh.bindMode = 'attached';
    mesh.bind(this.skeleton, new THREE.Matrix4());
    return part;
  }
  fitPart(part){
    const { def, geo } = part, p = this.pos, n = def.refs.length / 3;
    // how much the offsets stretch: the distance between two body vertices now, against when fitted
    const sc = [1, 1, 1];
    ['x', 'y', 'z'].forEach((ax, k) => { const s = def.scale[ax]; if (s) sc[k] = Math.abs(p[s[0] * 3 + k] - p[s[1] * 3 + k]) / s[2]; });
    const out = geo.attributes.position.array;
    let minY = Infinity;
    for (let i = 0; i < n; i++){
      const r0 = def.refs[i * 3] * 3, r1 = def.refs[i * 3 + 1] * 3, r2 = def.refs[i * 3 + 2] * 3;
      const w0 = def.w[i * 3], w1 = def.w[i * 3 + 1], w2 = def.w[i * 3 + 2];
      for (let k = 0; k < 3; k++) out[i * 3 + k] = w0 * p[r0 + k] + w1 * p[r1 + k] + w2 * p[r2 + k] + def.off[i * 3 + k] * 0.1 * sc[k];
      if (out[i * 3 + 1] < minY) minY = out[i * 3 + 1];
    }
    part.minY = minY;
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    // blinking moves the lashes and brows with the lids
    if (this.blink && (def.kind === 'lashes' || def.kind === 'brows')){
      const m = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) for (let r = 0; r < 3; r++){
        const v = def.refs[i * 3 + r] * 3, w = def.w[i * 3 + r];
        m[i * 3] += this.blink[v] * w; m[i * 3 + 1] += this.blink[v + 1] * w; m[i * 3 + 2] += this.blink[v + 2] * w;
      }
      geo.morphAttributes.position = [new THREE.BufferAttribute(m, 3)];
      geo.morphTargetsRelative = true;
      part.mesh.updateMorphTargets();
    }
  }
  // wear these parts (ids, or null); the body under clothes is hidden where they say
  setParts(list){
    const want = new Set(list.filter(Boolean));
    for (const id of want) this.part(id);
    for (const [id, part] of this.parts){
      if (want.has(id)) continue;
      // taken off: freed (a headset has little memory; putting it back on rebuilds it in a moment)
      for (const m of [part.mesh, part.soft, part.outline]) if (m) m.removeFromParent();
      part.geo.dispose();
      this.parts.delete(id);
    }
    // hide the body's triangles under clothes (so the skin can't poke through)
    const hide = new Uint8Array(this.N);
    for (const id of want){ const d = this.parts.get(id).def; if (d.del && d.kind !== 'hair') for (const v of d.del) hide[v] = 1; }
    const rv = this.data.base.bodyRV, I = this.bodyIndexAll, keep = [];
    for (let t = 0; t < I.length; t += 3) if (!(hide[rv[I[t]]] && hide[rv[I[t + 1]]] && hide[rv[I[t + 2]]])) keep.push(I[t], I[t + 1], I[t + 2]);
    this.bodyGeo.setIndex(new THREE.BufferAttribute(new Uint16Array(keep), 1));
    this.worn = want;
    this.update();
  }
  allMeshes(){
    const out = [this.body];
    if (this.bodyOutline) out.push(this.bodyOutline);
    for (const p of this.parts.values()){ out.push(p.mesh); if (p.soft) out.push(p.soft); if (p.outline) out.push(p.outline); }
    return out;
  }
  // toon outlines: an inside-out copy of each mesh (sharing its shape), or none (width 0)
  setOutlines(width, getMat){
    const want = width > 0;
    const sync = (holder, key, src) => {
      if (want && !holder[key]){
        const m = new THREE.SkinnedMesh(src.geometry, getMat()); m.frustumCulled = false; m.name = src.name + ':outline';
        src.parent.add(m); m.bindMode = 'attached'; m.bind(this.skeleton, new THREE.Matrix4()); holder[key] = m;
      }
      if (holder[key]){ holder[key].visible = want && src.visible; holder[key].geometry = src.geometry; }
    };
    sync(this, 'bodyOutline', this.body);
    for (const p of this.parts.values()) if (['hair', 'outfit', 'shoes', 'hat'].includes(p.def.kind)) sync(p, 'outline', p.mesh);
    if (want){ const m = getMat(); if (m.userData.olw) m.userData.olw.value = width; }
  }
  // ---------- posing ----------
  // from MakeHuman's A pose to standing relaxed: arms down by the sides, elbows a little bent
  relax(){
    const B = this.boneByName, v = new THREE.Vector3();
    // always from the bind pose (snapshotting whatever the idle motion had left made it build up
    // over rebuilds until the person was bent double)
    for (const b of this.bones) b.quaternion.identity();
    for (const s of ['L', 'R']){
      const ua = B['upperarm01.' + s], la = B['lowerarm01.' + s], wr = B['wrist.' + s];
      if (!ua || !la) continue;
      const dir = la.userData.head.clone().sub(ua.userData.head).normalize();
      const side = Math.sign(dir.x);
      ua.quaternion.setFromUnitVectors(dir, v.set(side * 0.16, -1, 0.03).normalize());
      // the forearm bends forward a little, and turns so the palm faces the thigh
      const fd = (wr ? wr.userData.head : la.userData.tail).clone().sub(la.userData.head).normalize();
      const down = new THREE.Vector3(side * 0.1, -1, 0.22).normalize();
      const local = down.clone().applyQuaternion(ua.quaternion.clone().invert());
      la.quaternion.setFromUnitVectors(fd, local);
    }
    this.restPose = this.bones.map((b) => b.quaternion.clone());
  }
  // the idle life: breathing, a slow sway, glances; blinking is a morph (cheap)
  idle(t, dt, look){
    if (!this.restPose) this.relax();
    const B = this.boneByName, e = new THREE.Euler(), q = new THREE.Quaternion();
    this.bones.forEach((b, i) => b.quaternion.copy(this.restPose[i]));
    if (B.head) B.head.scale.setScalar(this.headScale || 1);
    const br = Math.sin(t * 1.6) * 0.5 + 0.5;
    const turn = (name, x, y, z) => { const b = B[name]; if (b){ q.setFromEuler(e.set(x, y, z)); b.quaternion.multiply(q); } };
    turn('spine03', -0.012 * br, 0, 0);
    turn('spine05', 0.006 * br, 0, 0);
    turn('spine01', 0, Math.sin(t * 0.37) * 0.02, Math.sin(t * 0.29) * 0.012);
    turn('clavicle.L', 0, 0, 0.012 * br); turn('clavicle.R', 0, 0, -0.012 * br);
    // the head turns a little towards what it looks at, the eyes the rest of the way
    const lx = look ? look.x : 0, ly = look ? look.y : 0;
    turn('neck01', -ly * 0.2, lx * 0.25 + Math.sin(t * 0.23) * 0.03, 0);
    turn('head', -ly * 0.25 + Math.sin(t * 0.31) * 0.015, lx * 0.3, Math.sin(t * 0.19) * 0.015);
    for (const s of ['L', 'R']) turn('eye.' + s, -ly * 0.5, lx * 0.5, 0);
    // blink every few seconds
    this.blinkT = (this.blinkT ?? 2) - dt;
    if (this.blinkT < -0.16) this.blinkT = 2 + Math.random() * 4;
    const bl = this.blinkT < 0 ? Math.sin(Math.PI * (-this.blinkT / 0.16)) : 0;
    for (const m of this.allMeshes()) if (m.morphTargetInfluences && m.morphTargetInfluences.length) m.morphTargetInfluences[0] = bl;
  }
  meshes(){ return [this.body, ...[...this.parts.values()].filter((p) => p.mesh.visible).map((p) => p.mesh)]; }
  dispose(){
    this.bodyGeo.dispose();
    for (const p of this.parts.values()) p.geo.dispose();
    this.root.removeFromParent();
    this.skeleton.dispose();
  }
}
