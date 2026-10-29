// Builds an animal from a description: a skeleton of bones, and soft shapes (tapered capsules and
// ellipsoids) hung on those bones and blended together like clay. The blended shape is turned into one
// smooth mesh (surface nets on a signed distance field), skinned to the bones, then covered in fur:
// a stack of shells, each a little further out, where only the strands survive. Up close it reads as fur
// with real depth; at a distance the outer shells are dropped.
import * as THREE from 'three';

// ---------------------------------------------------------------- distance functions
function sdRoundCone(px, py, pz, a, b, r1, r2){
  // iq's exact round cone
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz, rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  const pax = px - a[0], pay = py - a[1], paz = pz - a[2];
  const yv = pax * bax + pay * bay + paz * baz, z = yv - l2;
  const cx = pax * l2 - bax * yv, cy = pay * l2 - bay * yv, cz = paz * l2 - baz * yv;
  const x2 = cx * cx + cy * cy + cz * cz, y2 = yv * yv * l2, z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(yv) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + yv * rr) * il2 - r1;
}
function sdEllipsoid(px, py, pz, c, r){
  const x = (px - c[0]) / r[0], y = (py - c[1]) / r[1], z = (pz - c[2]) / r[2];
  const k0 = Math.sqrt(x * x + y * y + z * z);
  const x1 = x / r[0], y1 = y / r[1], z1 = z / r[2];
  const k1 = Math.sqrt(x1 * x1 + y1 * y1 + z1 * z1);
  return k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -Math.min(r[0], r[1], r[2]);
}
function smin(a, b, k){ const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }

function primDist(p, x, y, z){ return p.type === 'cone' ? sdRoundCone(x, y, z, p.a, p.b, p.ra, p.rb) : sdEllipsoid(x, y, z, p.c, p.r); }
function primBox(p){
  if (p.type === 'cone'){
    const r = Math.max(p.ra, p.rb);
    return [Math.min(p.a[0], p.b[0]) - r, Math.min(p.a[1], p.b[1]) - r, Math.min(p.a[2], p.b[2]) - r, Math.max(p.a[0], p.b[0]) + r, Math.max(p.a[1], p.b[1]) + r, Math.max(p.a[2], p.b[2]) + r];
  }
  return [p.c[0] - p.r[0], p.c[1] - p.r[1], p.c[2] - p.r[2], p.c[0] + p.r[0], p.c[1] + p.r[1], p.c[2] + p.r[2]];
}

// ---------------------------------------------------------------- geometry
function buildGeometry(def, res){
  const prims = def.prims;
  for (const p of prims){ p.k = p.k ?? def.blend; p.box = primBox(p); }
  const sdf = (x, y, z) => {
    let d = 1e9;
    for (const p of prims){
      const b = p.box, m = p.k;
      if (x < b[0] - m || y < b[1] - m || z < b[2] - m || x > b[3] + m || y > b[4] + m || z > b[5] + m) continue;
      d = smin(d, primDist(p, x, y, z), p.k);
    }
    return d === 1e9 ? 1 : d;
  };
  let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const p of prims) for (let i = 0; i < 3; i++){ lo[i] = Math.min(lo[i], p.box[i]); hi[i] = Math.max(hi[i], p.box[i + 3]); }
  const span = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  const h = span / res;
  for (let i = 0; i < 3; i++){ lo[i] -= h * 2; hi[i] += h * 2; }
  const nx = Math.ceil((hi[0] - lo[0]) / h) + 1, ny = Math.ceil((hi[1] - lo[1]) / h) + 1, nz = Math.ceil((hi[2] - lo[2]) / h) + 1;
  const F = new Float32Array(nx * ny * nz);
  const at = (i, j, k) => (k * ny + j) * nx + i;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) F[at(i, j, k)] = sdf(lo[0] + i * h, lo[1] + j * h, lo[2] + k * h);

  // surface nets: one vertex per cell the surface passes through, at the mean of its edge crossings
  const cellV = new Int32Array(nx * ny * nz).fill(-1);
  const P = [];
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++){
    let mask = 0;
    for (let c = 0; c < 8; c++){ const v = F[at(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))]; cv[c] = v; if (v < 0) mask |= 1 << c; }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of E){
      const va = cv[a], vb = cv[b];
      if ((va < 0) === (vb < 0)) continue;
      const t = va / (va - vb);
      sx += (a & 1) + ((b & 1) - (a & 1)) * t; sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t; sz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t; n++;
    }
    cellV[at(i, j, k)] = P.length / 3;
    P.push(lo[0] + (i + sx / n) * h, lo[1] + (j + sy / n) * h, lo[2] + (k + sz / n) * h);
  }
  const I = [];
  const quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) I.push(a, d, c, a, c, b); else I.push(a, b, c, a, c, d); };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++){
    const inside = F[at(i, j, k)] < 0;
    if (inside !== (F[at(i + 1, j, k)] < 0)) quad(cellV[at(i, j - 1, k - 1)], cellV[at(i, j, k - 1)], cellV[at(i, j, k)], cellV[at(i, j - 1, k)], !inside);
    if (inside !== (F[at(i, j + 1, k)] < 0)) quad(cellV[at(i - 1, j, k - 1)], cellV[at(i - 1, j, k)], cellV[at(i, j, k)], cellV[at(i, j, k - 1)], !inside);
    if (inside !== (F[at(i, j, k + 1)] < 0)) quad(cellV[at(i - 1, j - 1, k)], cellV[at(i, j - 1, k)], cellV[at(i, j, k)], cellV[at(i - 1, j, k)], !inside);
  }
  // pull every vertex exactly onto the surface, and take normals from the field
  const nv = P.length / 3, Nn = new Float32Array(nv * 3), e = h * 0.25;
  for (let v = 0; v < nv; v++){
    let x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    for (let it = 0; it < 2; it++){
      const d = sdf(x, y, z);
      let gx = sdf(x + e, y, z) - sdf(x - e, y, z), gy = sdf(x, y + e, z) - sdf(x, y - e, z), gz = sdf(x, y, z + e) - sdf(x, y, z - e);
      const gl = Math.hypot(gx, gy, gz) || 1; gx /= gl; gy /= gl; gz /= gl;
      x -= gx * d; y -= gy * d; z -= gz * d;
      if (it === 1){ Nn[v * 3] = gx; Nn[v * 3 + 1] = gy; Nn[v * 3 + 2] = gz; }
    }
    P[v * 3] = x; P[v * 3 + 1] = y; P[v * 3 + 2] = z;
  }
  return { P: new Float32Array(P), N: Nn, I, h };
}

// ---------------------------------------------------------------- skinning and colour
function decorate(def, g, boneIndex){
  const prims = def.prims, nv = g.P.length / 3;
  const skinI = new Uint16Array(nv * 4), skinW = new Float32Array(nv * 4), col = new Float32Array(nv * 3), fur = new Float32Array(nv);
  const dist = new Float32Array(prims.length);
  for (let v = 0; v < nv; v++){
    const x = g.P[v * 3], y = g.P[v * 3 + 1], z = g.P[v * 3 + 2];
    let dmin = 1e9, best = 0;
    for (let p = 0; p < prims.length; p++){ dist[p] = primDist(prims[p], x, y, z); if (dist[p] < dmin){ dmin = dist[p]; best = p; } }
    // influence of each shape falls off with how much further it is than the nearest one
    const acc = new Map(); let furSum = 0, wsum = 0;
    for (let p = 0; p < prims.length; p++){
      const fall = prims[p].k * 0.6;
      const w = Math.exp(-Math.max(0, dist[p] - dmin) / fall * 3);
      if (w < 0.01) continue;
      const bi = boneIndex[prims[p].bone];
      acc.set(bi, (acc.get(bi) || 0) + w);
      furSum += w * (prims[p].fur ?? 1); wsum += w;
    }
    const top = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const tw = top.reduce((s, t) => s + t[1], 0);
    top.forEach(([bi, w], i) => { skinI[v * 4 + i] = bi; skinW[v * 4 + i] = w / tw; });
    fur[v] = furSum / wsum;
    // no fur over the eyes and nose
    for (const e of def.eyes || []) fur[v] *= Math.min(1, Math.max(0, (Math.hypot(x - e.at[0], y - e.at[1], z - e.at[2]) - e.r * 1.1) / (e.r * 1.4)));
    const c = def.color(x, y, z, prims[best].tag || '', prims[best]);
    // colours are written as they'd look on screen; lighting works in linear light
    col[v * 3] = Math.pow(c[0], 2.2); col[v * 3 + 1] = Math.pow(c[1], 2.2); col[v * 3 + 2] = Math.pow(c[2], 2.2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(g.P, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(g.N, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('furLen', new THREE.BufferAttribute(fur, 1));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinI, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinW, 4));
  geo.setIndex(g.I);
  geo.computeBoundingSphere();
  return geo;
}

// ---------------------------------------------------------------- fur
const FUR_HEAD = `
attribute float furLen;
uniform float uShell, uLen, uDens; uniform vec3 uComb; uniform vec3 uGust;
varying vec3 vFurP; varying float vFurL;`;
function furMaterial(def, shell, shells){
  const h = shell / shells;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, alphaToCoverage: shell > 0, transparent: false });
  m.userData.shell = h;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uShell = { value: h }; sh.uniforms.uLen = { value: def.fur.len }; sh.uniforms.uDens = { value: def.fur.density };
    sh.uniforms.uComb = { value: new THREE.Vector3(...(def.fur.comb || [0, -0.3, -0.6])) };
    sh.uniforms.uGust = def.gust;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>' + FUR_HEAD)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvec3 restN = objectNormal;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vFurP = position * uDens; vFurL = furLen;
        float hh = uShell;
        transformed += (restN + uComb * hh * 0.9 + uGust * hh * hh) * furLen * uLen * hh;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uShell; varying vec3 vFurP; varying float vFurL;
        vec3 fh3(vec3 p){ p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }`)
      .replace('#include <alphatest_fragment>', `
        float strand = 1.0;
        vec3 cell = floor(vFurP); vec3 rr = fh3(cell);
        if (uShell > 0.0){
          if (vFurL < 0.02) discard;
          vec3 f = fract(vFurP) - (0.25 + rr * 0.5);
          float len = 0.45 + 0.55 * rr.z;                      // each strand has its own length
          float r = 0.48 * (1.0 - uShell / len);             // and tapers to a point
          float d = length(f);
          float fw = clamp(length(fwidth(vFurP)) * 1.2, 0.0, 1.0);
          float hard = (uShell < len) ? smoothstep(r, r - 0.04 - fw * 0.5, d) : 0.0;
          // once strands are smaller than a pixel, fade to how much of the area they would cover
          float avg = clamp(1.0 - uShell, 0.0, 1.0); avg *= avg;
          diffuseColor.a = mix(hard, avg, smoothstep(0.25, 0.9, fw));
          if (diffuseColor.a < 0.02) discard;
        }
        // dark at the roots, lighter at the tips, and every strand a slightly different shade
        diffuseColor.rgb *= mix(0.4, 1.0, pow(uShell, 0.6)) * (0.88 + 0.24 * rr.x);`);
  };
  m.customProgramCacheKey = () => 'fur';
  return m;
}

function eyeTexture(color, slit){
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#1a120a'; g.fillRect(0, 0, 256, 128);
  // the iris sits where the sphere faces +Z (u = 0.25)
  const cx = 64, cy = 64;
  const grd = g.createRadialGradient(cx, cy, 2, cx, cy, 30);
  grd.addColorStop(0, color[0]); grd.addColorStop(0.7, color[1]); grd.addColorStop(1, '#100a04');
  g.fillStyle = grd; g.beginPath(); g.ellipse(cx, cy, 30, 46, 0, 0, Math.PI * 2); g.fill();
  for (let i = 0; i < 60; i++){ const a = i / 60 * Math.PI * 2; g.strokeStyle = 'rgba(0,0,0,0.18)'; g.beginPath(); g.moveTo(cx + Math.cos(a) * 8, cy + Math.sin(a) * 12); g.lineTo(cx + Math.cos(a) * 28, cy + Math.sin(a) * 44); g.stroke(); }
  g.fillStyle = '#000';
  g.beginPath(); if (slit) g.ellipse(cx, cy, 4, 34, 0, 0, Math.PI * 2); else g.ellipse(cx, cy, 11, 17, 0, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------------------------------------------------------------- the whole animal
const cache = new Map();
export function buildSpecies(def, quality){
  if (cache.has(def.name)) return cache.get(def.name);
  const t0 = performance.now();
  const boneIndex = {}; def.bones.forEach((b, i) => boneIndex[b.name] = i);
  const g = buildGeometry(def, quality > 1 ? def.res : Math.round(def.res * 0.75));
  const geo = decorate(def, g, boneIndex);
  const shells = quality > 1 ? def.fur.shells : Math.max(6, Math.round(def.fur.shells * 0.6));
  def.gust = { value: new THREE.Vector3() };
  const mats = [];
  for (let s = 0; s <= shells; s++) mats.push(furMaterial(def, s, shells));
  const eyeMat = new THREE.MeshPhysicalMaterial({ map: eyeTexture(def.eyeColor, def.slitEyes), roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02 });
  const res = { def, geo, mats, eyeMat, shells, ms: performance.now() - t0, verts: g.P.length / 3 };
  cache.set(def.name, res);
  return res;
}

export function makeCreature(def, quality){
  const sp = buildSpecies(def, quality);
  const group = new THREE.Group();
  const bones = {}, list = [];
  for (const b of def.bones){
    const bone = new THREE.Bone(); bone.name = b.name;
    const par = b.parent ? def.bones.find((x) => x.name === b.parent) : null;
    bone.position.set(b.at[0] - (par ? par.at[0] : 0), b.at[1] - (par ? par.at[1] : 0), b.at[2] - (par ? par.at[2] : 0));
    bone.userData.rest = bone.position.clone();
    bones[b.name] = bone; list.push(bone);
    (par ? bones[par.name] : group).add(bone);
  }
  group.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(list);
  const meshes = [];
  sp.mats.forEach((m, i) => {
    const mesh = new THREE.SkinnedMesh(sp.geo, m);
    mesh.bind(skeleton, new THREE.Matrix4());
    mesh.castShadow = i === 0; mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.renderOrder = i;
    group.add(mesh); meshes.push(mesh);
  });
  // eyes, nose and the hard bits (claws, teeth, tusks) ride on bones
  const attach = (boneName, obj, at) => {
    const b = def.bones.find((x) => x.name === boneName);
    obj.position.set(at[0] - b.at[0], at[1] - b.at[1], at[2] - b.at[2]);
    bones[boneName].add(obj);
  };
  for (const e of def.eyes || []){
    const m = new THREE.Mesh(new THREE.SphereGeometry(e.r, 20, 14), sp.eyeMat);
    m.lookAt(new THREE.Vector3(...e.dir)); attach(e.bone, m, e.at);
  }
  const hard = new THREE.MeshStandardMaterial({ color: 0xd8cdb8, roughness: 0.35 });
  const dark = new THREE.MeshPhysicalMaterial({ color: 0x0c0806, roughness: 0.3, clearcoat: 0.6 });
  const mouth = new THREE.MeshStandardMaterial({ color: 0x4a1612, roughness: 0.5 });
  const nose = new THREE.MeshPhysicalMaterial({ color: 0x6a3a32, roughness: 0.45, clearcoat: 0.3 });
  for (const x of def.extras || []){
    let geo, mat = x.mat === 'dark' ? dark : x.mat === 'mouth' ? mouth : x.mat === 'nose' ? nose : hard;
    if (x.type === 'cone'){ geo = new THREE.ConeGeometry(x.r, x.len, 8); geo.translate(0, x.len / 2, 0); }
    else geo = new THREE.SphereGeometry(1, 16, 12);
    const m = new THREE.Mesh(geo, mat);
    if (x.type === 'cone') m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...x.dir).normalize());
    else m.scale.set(...x.size);
    m.castShadow = !!x.cast;
    attach(x.bone, m, x.at);
  }
  group.userData = { bones, meshes, skeleton, shells: sp.shells };
  return group;
}

// drop outer shells with distance: all of them close up, none far away
export function furLOD(group, dist){
  const { meshes, shells } = group.userData;
  const keep = dist < 14 ? shells : dist < 30 ? Math.ceil(shells * 0.5) : dist < 60 ? Math.ceil(shells * 0.25) : 0;
  const step = keep > 0 ? shells / keep : 999;
  for (let i = 1; i < meshes.length; i++) meshes[i].visible = keep > 0 && (i % Math.max(1, Math.round(step)) === 0 || keep === shells);
}
