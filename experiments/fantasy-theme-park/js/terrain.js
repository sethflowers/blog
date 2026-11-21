// The ground: one height-field mesh for the map (2 m cells), and the countryside round it out to the
// horizon (a ring of rays from the map's edge, so the two share their edge exactly: no cracks). One
// shader for both blends painted grass, earth, rock and sand (rock comes by itself on steep slopes),
// and can show the lands' colours, the build grid and the brush ring. Water is its own mesh.
import * as THREE from 'three';
import { N, CELL, HALF, vtx, groundShape, waterLevelFor, HIGHWAY_Z } from './park.js';
import { texture, mat } from './materials.js';
import { clamp, rng, smooth } from './util.js';

const RAYS_OUT = 26;

export class Terrain {
  constructor(scene, park){
    this.scene = scene; this.park = park;
    const T = (n) => texture(n).map;
    this.uniforms = {
      tGrass: { value: T('grass') }, tDirt: { value: T('dirt') }, tRock: { value: T('rock') }, tSand: { value: T('sand') },
      tLand: { value: null }, landShow: { value: 0 }, gridShow: { value: 0 },
      brush: { value: new THREE.Vector4(0, 0, 0, 0) }, mapHalf: { value: HALF },
    };
    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
    this.material.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 splat; varying vec4 vSplat; varying vec3 vWPos; varying float vUpN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = splat; vWPos = (modelMatrix * vec4(position, 1.0)).xyz; vUpN = normal.y;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform sampler2D tGrass, tDirt, tRock, tSand, tLand; uniform float landShow, gridShow, mapHalf; uniform vec4 brush;
varying vec4 vSplat; varying vec3 vWPos; varying float vUpN;`)
        .replace('#include <map_fragment>', `
{
  vec2 w = vWPos.xz;
  // two scales of each texture, so the repeat doesn't show from above
  vec3 g = texture2D(tGrass, w / 4.0).rgb * 0.65 + texture2D(tGrass, w / 17.0 + 0.37).rgb * 0.35;
  vec3 d = texture2D(tDirt, w / 4.0).rgb * 0.7 + texture2D(tDirt, w / 15.0).rgb * 0.3;
  vec3 r = texture2D(tRock, vec2(w.x + vWPos.y * 0.7, w.y - vWPos.y * 0.7) / 7.0).rgb;
  vec3 s = texture2D(tSand, w / 4.0).rgb;
  vec4 k = vSplat;
  float steep = smoothstep(0.82, 0.62, vUpN);
  k = mix(k, vec4(0.0, 0.0, 1.0, 0.0), steep);
  k /= max(k.x + k.y + k.z + k.w, 0.001);
  vec3 col = g * k.x + d * k.y + r * k.z + s * k.w;
  // big, soft patches of lighter and darker ground
  float m = texture2D(tDirt, w / 211.0).r, m2 = texture2D(tRock, w / 397.0 + 0.3).r;
  col *= 0.78 + 0.45 * m;
  // dry, yellower patches and lusher, darker ones across the fields
  col = mix(col, col * vec3(1.18, 1.08, 0.78), smoothstep(0.45, 0.75, m2) * k.x * 0.8);
  col = mix(col, col * vec3(0.78, 0.92, 0.82), smoothstep(0.45, 0.2, m2) * k.x * 0.6);
  if (landShow > 0.0){
    vec2 luv = (w + mapHalf) / (2.0 * mapHalf);
    vec4 L = texture2D(tLand, luv);
    if (luv.x > 0.0 && luv.x < 1.0 && luv.y > 0.0 && luv.y < 1.0) col = mix(col, L.rgb, L.a * 0.55 * landShow);
  }
  if (gridShow > 0.0){
    vec2 q = w / 2.0;
    vec2 gl = abs(fract(q - 0.5) - 0.5) / fwidth(q);
    float line = 1.0 - min(min(gl.x, gl.y), 1.0);
    float near = 1.0 - smoothstep(14.0, 34.0, length(w - brush.xy));
    col = mix(col, vec3(1.0), line * 0.25 * gridShow * near);
  }
  if (brush.z > 0.0){
    float dd = length(w - brush.xy);
    float ring = 1.0 - smoothstep(0.0, max(0.15, brush.z * 0.04), abs(dd - brush.z));
    col = mix(col, vec3(1.0, 0.86, 0.4), ring * 0.85 * brush.w);
    col = mix(col, vec3(1.0, 0.9, 0.6), (1.0 - smoothstep(brush.z * 0.9, brush.z, dd)) * 0.12 * brush.w);
  }
  diffuseColor.rgb *= col;
}`);
    };
    this.buildMain();
    this.buildRing();
    this.water = null; this.waterMat = makeWaterMat();
    this.buildWater();
    this.buildSea();
    this.landTex = new THREE.DataTexture(new Uint8Array(N * N * 4), N, N, THREE.RGBAFormat);
    this.landTex.magFilter = THREE.NearestFilter; this.landTex.minFilter = THREE.NearestFilter; this.landTex.colorSpace = THREE.SRGBColorSpace;
    this.uniforms.tLand.value = this.landTex;
    this.updateLands();
    this.countryTrees();
  }

  // --- the map's own ground -----
  buildMain(){
    const W = N + 1, pos = new Float32Array(W * W * 3), nor = new Float32Array(W * W * 3), spl = new Float32Array(W * W * 4);
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++){ const k = j * W + i; pos[k * 3] = -HALF + i * CELL; pos[k * 3 + 2] = -HALF + j * CELL; }
    const idx = new Uint32Array(N * N * 6); let o = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++){
      const a = vtx(i, j), b = vtx(i + 1, j), c = vtx(i, j + 1), d = vtx(i + 1, j + 1);
      idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('splat', new THREE.BufferAttribute(spl, 4).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo = g;
    this.fill(0, 0, N, N);
    g.computeBoundingSphere();
    g.boundingBox = new THREE.Box3(new THREE.Vector3(-HALF, -100, -HALF), new THREE.Vector3(HALF, 200, HALF));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), HALF * 1.5);
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.receiveShadow = true; this.mesh.name = 'terrain';
    this.scene.add(this.mesh);
  }
  // recompute vertices i0..i1, j0..j1 (corner indices)
  fill(i0, j0, i1, j1){
    const W = N + 1, H = this.park.s.heights, P = this.park.s.paint;
    const pos = this.geo.attributes.position.array, nor = this.geo.attributes.normal.array, spl = this.geo.attributes.splat.array;
    i0 = clamp(i0, 0, N); j0 = clamp(j0, 0, N); i1 = clamp(i1, 0, N); j1 = clamp(j1, 0, N);
    const h = (i, j) => H[clamp(j, 0, N) * W + clamp(i, 0, N)];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++){
      const k = j * W + i;
      pos[k * 3 + 1] = H[k];
      let nx = h(i - 1, j) - h(i + 1, j), nz = h(i, j - 1) - h(i, j + 1), ny = 2 * CELL;
      const l = Math.hypot(nx, ny, nz); nor[k * 3] = nx / l; nor[k * 3 + 1] = ny / l; nor[k * 3 + 2] = nz / l;
      // paint: average of the (up to) four cells round this corner
      let a = 0, b = 0, c = 0, d = 0;
      for (const [di, dj] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]){
        const ci = clamp(i + di, 0, N - 1), cj = clamp(j + dj, 0, N - 1), p = P[cj * N + ci];
        if (p === 0) a++; else if (p === 1) b++; else if (p === 2) c++; else d++;
      }
      spl[k * 4] = a / 4; spl[k * 4 + 1] = b / 4; spl[k * 4 + 2] = c / 4; spl[k * 4 + 3] = d / 4;
    }
    for (const [name, size] of [['position', 3], ['normal', 3], ['splat', 4]]){
      const attr = this.geo.attributes[name];
      attr.addUpdateRange(j0 * W * size, (j1 - j0 + 1) * W * size);
      attr.needsUpdate = true;
    }
  }
  // the park changed: heights or paint in a rectangle (cell / corner indices)
  update(r){ if (r) this.fill(r[0] - 1, r[1] - 1, r[2] + 2, r[3] + 2); }

  // --- the countryside: rays out from each edge vertex of the map -----
  buildRing(){
    const S = this.park.s, H = S.heights, W = N + 1;
    // the perimeter, going round: north edge west->east, east edge north->south, south edge east->west, west edge south->north
    const per = [];
    for (let i = 0; i < N; i++) per.push([i, 0, 0, -1]);
    for (let j = 0; j < N; j++) per.push([N, j, 1, 0]);
    for (let i = N; i > 0; i--) per.push([i, N, 0, 1]);
    for (let j = N; j > 0; j--) per.push([0, j, -1, 0]);
    const P = per.length, R = RAYS_OUT;
    const pos = new Float32Array(P * (R + 1) * 3), nor = new Float32Array(P * (R + 1) * 3), spl = new Float32Array(P * (R + 1) * 4);
    const dist = (s) => s === 0 ? 0 : 2 * s + 3200 * Math.pow(s / R, 2.6);
    for (let p = 0; p < P; p++){
      const [i, j, dx, dz] = per[p];
      // corners fan out diagonally
      let ox = dx, oz = dz;
      if ((i === 0 || i === N) && (j === 0 || j === N)){ ox = i === 0 ? -1 : 1; oz = j === 0 ? -1 : 1; }
      const x0 = -HALF + i * CELL, z0 = -HALF + j * CELL, h0 = H[j * W + i];
      for (let s = 0; s <= R; s++){
        const d = dist(s), x = x0 + ox * d, z = z0 + oz * d, k = p * (R + 1) + s;
        const far = groundShape(S.land, S.seed, x, z) + smooth((d - 300) / 1500) * hillsFar(S.seed, x, z, S.land);
        let y = s === 0 ? h0 : h0 + (far - h0) * smooth(d / 60);
        // a little lower under the highway and the turning into the park, so the road sits clear of the grass
        if (s > 0 && ((z > HALF && Math.abs(z - HIGHWAY_Z) < 10.5) || (z > HALF && z < HIGHWAY_Z && Math.abs(x) < 5))) y = Math.min(y, -0.12);
        pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
        spl[k * 4] = 1;
      }
    }
    const idx = []; for (let p = 0; p < P; p++){ const q = (p + 1) % P; for (let s = 0; s < R; s++){ const a = p * (R + 1) + s, b = q * (R + 1) + s; idx.push(a, b, a + 1, b, b + 1, a + 1); } }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('splat', new THREE.BufferAttribute(spl, 4));
    g.setIndex(idx); g.computeVertexNormals();
    this.ring = new THREE.Mesh(g, this.material); this.ring.receiveShadow = true; this.ring.name = 'countryside';
    this.ringPerimeter = per;
    this.scene.add(this.ring);
  }
  // the map's edge can't be changed, but the start area's levelling reaches it: keep the ring's first row matched
  syncRingEdge(){
    const H = this.park.s.heights, W = N + 1, pos = this.ring.geometry.attributes.position, R = RAYS_OUT;
    this.ringPerimeter.forEach(([i, j], p) => { pos.setY(p * (R + 1), H[j * W + i]); });
    pos.needsUpdate = true;
  }

  // --- water: one quad per water cell at its level -----
  buildWater(){
    const S = this.park.s, pos = [], idx = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++){
      const lv = S.water[j * N + i]; if (Number.isNaN(lv)) continue;
      const x = -HALF + i * CELL, z = -HALF + j * CELL, v = pos.length / 3;
      pos.push(x, lv, z, x + CELL, lv, z, x, lv, z + CELL, x + CELL, lv, z + CELL);
      idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
    }
    if (this.water){ this.water.geometry.dispose(); this.scene.remove(this.water); this.water = null; }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const nor = new Float32Array(pos.length); for (let k = 1; k < nor.length; k += 3) nor[k] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    const uv = new Float32Array(pos.length / 3 * 2); for (let k = 0; k < pos.length / 3; k++){ uv[k * 2] = pos[k * 3] / 9; uv[k * 2 + 1] = pos[k * 3 + 2] / 9; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.water = new THREE.Mesh(g, this.waterMat); this.water.name = 'water'; this.water.renderOrder = 2;
    this.scene.add(this.water);
  }
  // the sea (Coastal Cliffs) or nothing: a big sheet outside the map at the water's level
  buildSea(){
    const S = this.park.s; if (S.land !== 'coast') return;
    const lv = waterLevelFor('coast'), F = 4000, pos = [], idx = [];
    // four big quads round the map, wound like the water inside it (so they shade the same)
    for (const [x0, z0, x1, z1] of [[-F, -F, F, -HALF], [-F, HALF, F, F], [-F, -HALF, -HALF, HALF], [HALF, -HALF, F, HALF]]){
      const v = pos.length / 3;
      pos.push(x0, lv, z0, x1, lv, z0, x0, lv, z1, x1, lv, z1);
      idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, k) => k % 3 === 1 ? 1 : 0), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(pos.flatMap((_, k) => k % 3 === 0 ? [pos[k] / 9, pos[k + 2] / 9] : []), 2));
    g.setIndex(idx);
    this.sea = new THREE.Mesh(g, this.waterMat); this.sea.renderOrder = 2; this.sea.name = 'sea';
    this.scene.add(this.sea);
  }
  animate(t){ const m = this.waterMat; if (m.normalMap){ m.normalMap.offset.set(t * 0.011, t * 0.007); } }

  // --- lands overlay -----
  updateLands(){
    const S = this.park.s, d = this.landTex.image.data, c = new THREE.Color();
    const cols = S.lands.map((l) => { c.set(l.color); return [c.r * 255, c.g * 255, c.b * 255]; });
    for (let k = 0; k < N * N; k++){
      const l = S.zone[k];
      if (l && cols[l - 1]){ d[k * 4] = cols[l - 1][0]; d[k * 4 + 1] = cols[l - 1][1]; d[k * 4 + 2] = cols[l - 1][2]; d[k * 4 + 3] = 255; }
      else d[k * 4 + 3] = 0;
    }
    this.landTex.needsUpdate = true;
  }

  // --- woods in the countryside: cheap instanced trees, no shadows -----
  countryTrees(){
    const S = this.park.s, r = rng(S.seed + 77), pine = [], broad = [];
    const wl = waterLevelFor(S.land);
    for (let n = 0; n < 9000 && pine.length + broad.length < 4200; n++){
      const a = r() * Math.PI * 2, d = HALF + 30 + Math.pow(r(), 1.4) * 1700;
      const x = Math.cos(a) * d * 1.42, z = Math.sin(a) * d * 1.42;
      if (Math.max(Math.abs(x), Math.abs(z)) < HALF + 25) continue;
      if (Math.abs(z - HIGHWAY_Z) < 24) continue;
      // woods come in patches
      if (forest(S.seed, x, z) < 0.5) continue;
      const y = groundShape(S.land, S.seed, x, z) + smooth((Math.hypot(x, z) - 300) / 1500) * hillsFar(S.seed, x, z, S.land);
      if (wl !== null && y < wl + 0.5) continue;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6), new THREE.Vector3(1, 0.8 + r() * 0.6, 1).multiplyScalar(0.8 + r() * 0.7));
      (r() < 0.45 ? pine : broad).push(m);
    }
    const make = (geo, list, color) => {
      const im = new THREE.InstancedMesh(geo, mat('farTree' + color, { c: color, r: 1 }), list.length);
      list.forEach((m, k) => im.setMatrixAt(k, m));
      const c = new THREE.Color(); for (let k = 0; k < list.length; k++){ c.setHSL(0.27 + r() * 0.06, 0.35 + r() * 0.2, 0.35 + r() * 0.25); im.setColorAt(k, c); }
      im.frustumCulled = false; im.name = 'farTrees';
      this.scene.add(im);
    };
    const pg = new THREE.ConeGeometry(3.2, 13, 7); pg.translate(0, 8, 0);
    const trunk = new THREE.CylinderGeometry(0.3, 0.4, 3, 5); trunk.translate(0, 1.5, 0);
    make(mergeTwo(pg, trunk), pine, 0x3a5a34);
    const bg = new THREE.IcosahedronGeometry(4.2, 1); bg.scale(1, 0.85, 1); bg.translate(0, 7, 0);
    const p = bg.attributes.position; for (let k = 0; k < p.count; k++){ const s = 1 + 0.12 * Math.sin(p.getX(k) * 1.3 + p.getZ(k) * 2.1); p.setXYZ(k, p.getX(k) * s, p.getY(k), p.getZ(k) * s); }
    bg.computeVertexNormals();
    make(mergeTwo(bg, trunk), broad, 0x4a6a34);
  }
}
function hillsFar(seed, x, z, land){ return (land === 'coast' ? smooth((z + 120) / 200) : 1) * 50 * Math.pow(fbmLocal(x / 700, z / 700, seed + 3), 1.6); }
function forest(seed, x, z){ return fbmLocal(x / 180, z / 180, seed + 8) + 0.1; }
function fbmLocal(x, z, s){ let t = 0, a = 0.5, f = 1; for (let i = 0; i < 4; i++){ t += a * noise2(x * f, z * f, s + i); a *= 0.5; f *= 2; } return t / 0.9375; }
function noise2(x, z, s){
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi, u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const h = (a, b) => { let n = Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(s, 1442695041); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const a = h(xi, zi), b = h(xi + 1, zi), c = h(xi, zi + 1), d = h(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function mergeTwo(a, b){
  const g = new THREE.BufferGeometry();
  const A = a.index ? a.toNonIndexed() : a, B = b.index ? b.toNonIndexed() : b;
  for (const name of ['position', 'normal']){
    const x = A.attributes[name].array, y = B.attributes[name].array, z = new Float32Array(x.length + y.length); z.set(x); z.set(y, x.length);
    g.setAttribute(name, new THREE.BufferAttribute(z, 3));
  }
  return g;
}
function makeWaterMat(){
  const n = texture('water').normal;
  const nm = n.clone(); nm.repeat.set(1, 1); nm.needsUpdate = true;
  const m = new THREE.MeshStandardMaterial({ color: 0x163a44, roughness: 0.14, metalness: 0.05, transparent: true, opacity: 0.9, normalMap: nm, depthWrite: true, envMapIntensity: 0.55 });
  m.normalScale.set(0.35, 0.35);
  m.name = 'water';
  return m;
}
