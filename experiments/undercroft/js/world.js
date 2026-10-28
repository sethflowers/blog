// The Undercroft: turns a level (see level.js) into geometry and places everything in it.
import * as THREE from 'three';
import { TILE, CEIL, HALL_CEIL, STAIR_RISE, T, DIRS, floorOf, ceilOf, mulberry } from './level.js';

const BASE = '/experiments/undercroft/';

/* ================================================================
   MATERIALS
   ================================================================ */
export function makeMaterials(renderer, env){
  const loader = new THREE.TextureLoader(), aniso = renderer.capabilities.getMaxAnisotropy();
  const tex = (name, srgb) => { const t = loader.load(BASE + 'tex/' + name); t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  const stone = (name, ns, extra) => new THREE.MeshStandardMaterial(Object.assign({
    map: tex(name + '_albedo.jpg', true), normalMap: tex(name + '_normal.jpg'), roughnessMap: tex(name + '_rough.jpg'),
    normalScale: new THREE.Vector2(ns, ns), roughness: 1, metalness: 0, vertexColors: true }, extra || {}));
  const m = {};
  m.wall = stone('wall', 1.6);
  m.floor = stone('floor', 1.3);
  m.ceil = stone('ceil', 1.4);
  m.pillar = new THREE.MeshStandardMaterial({ map: m.wall.map, normalMap: m.wall.normalMap, roughnessMap: m.wall.roughnessMap, normalScale: new THREE.Vector2(1.4, 1.4) });
  m.wood = new THREE.MeshStandardMaterial({ map: tex('wood_albedo.jpg', true), roughness: 0.9 });
  m.heldWood = new THREE.MeshStandardMaterial({ map: m.wood.map, color: 0x2c2c2c, roughness: 0.95 });
  m.iron = new THREE.MeshStandardMaterial({ color: 0x2e2a26, roughness: 0.55, metalness: 0.85, envMap: env, envMapIntensity: 0.6 });
  m.web = new THREE.MeshStandardMaterial({ map: tex('cobweb.png', true), transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 1, opacity: 0.85 });
  m.rock = new THREE.MeshStandardMaterial({ map: m.wall.map, normalMap: m.wall.normalMap, roughness: 0.92, color: 0x9a9690 });
  const wn = tex('water_normal.jpg'); wn.repeat.set(0.35, 0.35);
  // dark, still, deadly water: almost black, mirror-smooth, a slow ripple
  m.water = new THREE.MeshStandardMaterial({ color: 0x020405, roughness: 0.04, metalness: 0.2, normalMap: wn, normalScale: new THREE.Vector2(0.35, 0.35),
    envMap: env, envMapIntensity: 1.2 });
  // ice: dark water seen through a glassy, slightly milky crust
  m.ice = new THREE.MeshPhysicalMaterial({ color: 0x3d5566, roughness: 0.35, metalness: 0, normalMap: m.floor.normalMap, normalScale: new THREE.Vector2(0.35, 0.35),
    clearcoat: 1, clearcoatRoughness: 0.05, envMap: env, envMapIntensity: 1.6, transparent: true, opacity: 0.88 });
  return m;
}

/* ================================================================
   FLAMES: a camera-facing card with flame noise, bright enough to bloom
   ================================================================ */
export const flameUniforms = { time: { value: 0 } };
const flameGeo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
export function flameMaterial(seed, size, tint){
  return new THREE.ShaderMaterial({
    uniforms: { time: flameUniforms.time, seed: { value: seed }, size: { value: size }, tint: { value: tint || new THREE.Color(1, 1, 1) } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: `
      uniform float size; varying vec2 vUv;
      void main(){
        vUv = uv;
        vec3 c = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vec3 toCam = cameraPosition - c; toCam.y = 0.0; toCam = normalize(toCam + vec3(1e-4, 0.0, 0.0));
        vec3 right = vec3(toCam.z, 0.0, -toCam.x);
        vec3 p = c + right * position.x * size * 0.75 + vec3(0.0, 1.0, 0.0) * position.y * size;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform float time; uniform float seed; uniform vec3 tint; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p){ return n(p) * 0.55 + n(p * 2.1 + 3.1) * 0.3 + n(p * 4.3 + 7.7) * 0.15; }
      void main(){
        float y = vUv.y, x = (vUv.x - 0.5) * 2.0;
        float t = time * 2.4 + seed * 13.0;
        float q = fbm(vec2(x * 2.2 + seed, y * 2.6 - t * 1.2));
        float r = fbm(vec2(x * 4.5 - seed, y * 5.0 - t * 1.9));
        x += ((q - 0.5) * 0.9 + (r - 0.5) * 0.35) * y + sin(t * 0.8 + y * 2.5) * 0.08 * y;
        float w = mix(0.8, 0.1, pow(y, 0.6));
        float body = 1.0 - smoothstep(w * 0.15, w, abs(x));
        float tear = smoothstep(0.25, 0.75, fbm(vec2(x * 3.0 + seed * 3.0, y * 3.5 - t * 1.6)) + 0.55 - y * 0.75);
        body *= smoothstep(0.0, 0.14, y) * tear;
        body = pow(body, 1.4);
        float core = (1.0 - smoothstep(0.08, 0.38, y)) * (1.0 - smoothstep(0.0, w * 0.5, abs(x))) * smoothstep(0.0, 0.1, y);
        vec3 col = mix(vec3(0.65, 0.09, 0.01), vec3(1.0, 0.5, 0.13), smoothstep(0.0, 0.8, body)) * body * 2.4;
        col += vec3(1.0, 0.82, 0.5) * core * 2.6;
        float halo = exp(-dot(vec2(x * 1.3, (y - 0.3) * 1.6), vec2(x * 1.3, (y - 0.3) * 1.6)) * 3.0);
        col += vec3(1.0, 0.45, 0.12) * halo * 0.12;
        gl_FragColor = vec4(col * tint, 1.0);
      }`
  });
}
export function makeFlame(size, seed, tint){
  const f = new THREE.Mesh(flameGeo, flameMaterial(seed === undefined ? Math.random() * 10 : seed, size, tint));
  f.frustumCulled = false; f.renderOrder = 5;
  return f;
}

// a torch: a charred wooden stick with a lumpy rag head glowing with embers
const handleGeo = new THREE.CylinderGeometry(0.022, 0.016, 0.5, 10).translate(0, 0.25, 0);
const ragGeo = (() => {
  const g = new THREE.IcosahedronGeometry(1, 2), p = g.attributes.position, r = mulberry(7);
  const bumps = Array.from({ length: 9 }, () => [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1, r() * 0.25]);
  for (let k = 0; k < p.count; k++){
    const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
    let s = 1; for (const b of bumps) s += b[3] * Math.max(0, x * b[0] + y * b[1] + z * b[2]);
    s += 0.12 * Math.sin(y * 9 + Math.atan2(z, x) * 1.5) + 0.08 * Math.sin(x * 17 + z * 13 + y * 7);
    p.setXYZ(k, x * s * 0.034, y * s * 0.062, z * s * 0.034);
  }
  g.computeVertexNormals();
  const col = [];
  for (let k = 0; k < p.count; k++){
    const h = Math.abs(Math.sin(p.getX(k) * 912.3 + p.getY(k) * 431.7 + p.getZ(k) * 277.1) * 4375.85) % 1;
    const v = Math.pow(h, 6) * (p.getY(k) > 0 ? 0.5 : 0.15);
    col.push(0.006 + v, 0.004 + v * 0.35, 0.003 + v * 0.06);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g.translate(0, 0.49, 0);
})();
export const ragMat = new THREE.MeshBasicMaterial({ vertexColors: true });
export function torchModel(mat){
  const g = new THREE.Group();
  const h = new THREE.Mesh(handleGeo, mat), r = new THREE.Mesh(ragGeo, ragMat);
  h.castShadow = r.castShadow = true;
  g.add(h, r);
  return g;
}

/* ================================================================
   GEOMETRY: faces cut into small grids so ambient occlusion can be baked into vertex colours
   ================================================================ */
class Builder {
  constructor(){ this.p = []; this.n = []; this.uv = []; this.c = []; this.i = []; }
  quad(o, A, B, segA, segB, uvf, aof){
    const base = this.p.length / 3;
    const nx = A[1] * B[2] - A[2] * B[1], ny = A[2] * B[0] - A[0] * B[2], nz = A[0] * B[1] - A[1] * B[0];
    const nl = Math.hypot(nx, ny, nz);
    for (let b = 0; b <= segB; b++) for (let a = 0; a <= segA; a++){
      const s = a / segA, t = b / segB;
      const x = o[0] + A[0] * s + B[0] * t, y = o[1] + A[1] * s + B[1] * t, z = o[2] + A[2] * s + B[2] * t;
      this.p.push(x, y, z); this.n.push(nx / nl, ny / nl, nz / nl);
      const [u, v] = uvf(x, y, z); this.uv.push(u, v);
      const k = aof(x, y, z); this.c.push(k, k, k);
    }
    for (let b = 0; b < segB; b++) for (let a = 0; a < segA; a++){
      const i0 = base + b * (segA + 1) + a, i1 = i0 + 1, i2 = i0 + segA + 1, i3 = i2 + 1;
      this.i.push(i0, i1, i3, i0, i3, i2);
    }
  }
  mesh(mat){
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
}

export const center = (i, j) => [(i + 0.5) * TILE, (j + 0.5) * TILE];

/* ================================================================
   BUILD
   ================================================================ */
export function buildWorld(lv, mats, props, env){
  const W = lv.W, rng = mulberry(lv.seed * 7 + 3);
  const tt = (i, j) => (i < 0 || j < 0 || i >= W || j >= W) ? T.ROCK : lv.g[j * W + i];
  const cellAt = new Map(); for (const c of lv.cells) cellAt.set(c.tile[1] * W + c.tile[0], c);
  const world = { group: new THREE.Group(), sconces: [], flames: [], water: new Map(), cells: [], gates: [], chests: [], items: [],
    pillars: [], chains: [], cracked: null, portcullis: null, decor: [] };
  const add = (o) => { world.group.add(o); return o; };

  // is the face between tile (i,j) and its neighbour in direction (dx,dz) solid from (i,j)'s side?
  const barsBetween = (c, i, j) => c.from[0] === i && c.from[1] === j;
  const solidSide = (i, j, dx, dz) => {
    const t = tt(i, j), ni = i + dx, nj = j + dz, nt = tt(ni, nj);
    if (nt === T.ROCK) return true;
    if (t === T.CELL){ const c = cellAt.get(j * W + i); return !barsBetween(c, ni, nj); }
    if (nt === T.CELL){ const c = cellAt.get(nj * W + ni); return !barsBetween(c, i, j); }
    return false;
  };
  const rockLike = (i, j) => tt(i, j) === T.ROCK;
  const rockDist = (x, z, ti, tj, skipI, skipJ) => {
    let d = 9;
    for (let j = tj - 1; j <= tj + 1; j++) for (let i = ti - 1; i <= ti + 1; i++){
      if (!rockLike(i, j) || (i === skipI && j === skipJ)) continue;
      const ex = Math.max(i * TILE - x, 0, x - (i + 1) * TILE), ez = Math.max(j * TILE - z, 0, z - (j + 1) * TILE);
      d = Math.min(d, Math.hypot(ex, ez));
    }
    return d;
  };
  const walls = new Builder(), floors = new Builder(), ceils = new Builder();
  const S = 6;
  const wallUV = (rx, rz) => (x, y, z) => [(x * rx + z * rz) / CEIL, y / CEIL];
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++){
    const t = tt(i, j); if (t === T.ROCK) continue;
    const x0 = i * TILE, z0 = j * TILE, fh = floorOf(t), ch = ceilOf(t);
    if (t !== T.STAIRS && t !== T.WATER){
      floors.quad([x0, fh, z0 + TILE], [TILE, 0, 0], [0, 0, -TILE], S, S, (x, y, z) => [x / 3, -z / 3],
        (x, y, z) => { const d = rockDist(x, z, i, j); return 1 - 0.62 * Math.exp(-d / 0.32) - 0.18 * Math.exp(-d / 1.1); });
    }
    ceils.quad([x0, ch, z0], [TILE, 0, 0], [0, 0, TILE], t === T.HALL || t === T.PILLAR ? 3 : S, t === T.HALL || t === T.PILLAR ? 3 : S,
      (x, y, z) => [x / CEIL, z / CEIL], (x, y, z) => { const d = rockDist(x, z, i, j); return 1 - 0.5 * Math.exp(-d / 0.45); });
    for (const [dx, dz] of DIRS){
      const ni = i + dx, nj = j + dz, nt = tt(ni, nj);
      const right = [-dz, 0, dx];
      const cx = x0 + TILE / 2 + dx * TILE / 2, cz = z0 + TILE / 2 + dz * TILE / 2;
      const spans = [];
      if (solidSide(i, j, dx, dz)) spans.push([fh, ch]);
      else {
        if (ceilOf(nt) < ch) spans.push([ceilOf(nt), ch]);                       // the wall above a lower opening
        if (floorOf(nt) > fh && t !== T.STAIRS) spans.push([fh, floorOf(nt)]);    // the side of a drop (water)
      }
      for (const [y0, y1] of spans){
        const o = [cx - right[0] * TILE / 2, y0, cz - right[2] * TILE / 2];
        walls.quad(o, [right[0] * TILE, 0, right[2] * TILE], [0, y1 - y0, 0], S, Math.max(2, Math.round((y1 - y0) * 2)), wallUV(right[0], right[2]),
          (x, y, z) => {
            const d = rockDist(x - dx * 0.02, z - dz * 0.02, i, j, ni, nj);
            return (1 - 0.5 * Math.exp(-d / 0.4)) * (1 - 0.55 * Math.exp(-Math.max(0, y - fh) / 0.3)) * (1 - 0.35 * Math.exp(-(ch - y) / 0.4));
          });
      }
    }
  }
  // the stairs out: eight steps
  {
    const [si, sj] = lv.exit.stairs, [dx, dz] = lv.exit.dir, right = [-dz, 0, dx];
    const steps = 8, run = TILE / steps, rise = STAIR_RISE / steps;
    const sx = (si + 0.5) * TILE - dx * TILE / 2, sz = (sj + 0.5) * TILE - dz * TILE / 2;
    for (let k = 0; k < steps; k++){
      const bx = sx + dx * run * k, bz = sz + dz * run * k;
      const o = [bx - right[0] * TILE / 2, rise * k, bz - right[2] * TILE / 2];
      walls.quad(o, [right[0] * TILE, 0, right[2] * TILE], [0, rise, 0], 4, 1, wallUV(right[0], right[2]), () => 0.75);
      const top = [o[0], rise * (k + 1), o[2]], A = [right[0] * TILE, 0, right[2] * TILE], B = [dx * run, 0, dz * run];
      if (A[2] * B[0] - A[0] * B[2] > 0) floors.quad(top, A, B, 4, 1, (x, y, z) => [x / 3, -z / 3], () => 0.85);
      else floors.quad([top[0] + B[0], top[1], top[2] + B[2]], A, [-B[0], 0, -B[2]], 4, 1, (x, y, z) => [x / 3, -z / 3], () => 0.85);
    }
  }
  add(walls.mesh(mats.wall)); add(floors.mesh(mats.floor)); add(ceils.mesh(mats.ceil));

  // the great hall's pillars
  const pillarGeo = new THREE.CylinderGeometry(0.62, 0.7, HALL_CEIL, 20, 8);
  { const uv = pillarGeo.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 4.4 / CEIL * 1.2, uv.getY(k) * HALL_CEIL / CEIL); }
  const plinthGeo = new THREE.BoxGeometry(1.7, 0.5, 1.7);
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++){
    if (tt(i, j) !== T.PILLAR) continue;
    const [x, z] = center(i, j);
    const p = add(new THREE.Mesh(pillarGeo, mats.pillar)); p.position.set(x, HALL_CEIL / 2, z); p.castShadow = p.receiveShadow = true;
    for (const y of [0.25, HALL_CEIL - 0.25]){ const b = add(new THREE.Mesh(plinthGeo, mats.pillar)); b.position.set(x, y, z); b.castShadow = b.receiveShadow = true; }
    world.pillars.push({ x, z, r: 0.85 });
  }

  // water: a surface in each flooded tile
  const waterGeo = new THREE.PlaneGeometry(TILE, TILE).rotateX(-Math.PI / 2);
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++){
    if (tt(i, j) !== T.WATER) continue;
    const [x, z] = center(i, j);
    const m = add(new THREE.Mesh(waterGeo, mats.water)); m.position.set(x, -0.22, z); m.receiveShadow = true;
    world.water.set(j * W + i, { mesh: m, i, j, frozenUntil: 0 });
  }
  if (lv.pool){
    const [x, z] = center(lv.pool[0], lv.pool[1]);
    const stone = add(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 0.5, 9), mats.rock)); stone.position.set(x, -0.2, z);
    stone.castShadow = stone.receiveShadow = true;
  }

  // wall torches (with the hall's braziers and the magic gates, these share the pool of real lights)
  const faces = [];
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++){
    const t = tt(i, j); if (t !== T.FLOOR && t !== T.HALL) continue;
    for (const [dx, dz] of DIRS) if (tt(i + dx, j + dz) === T.ROCK) faces.push([i, j, dx, dz, t === T.HALL]);
  }
  const lit = [];
  for (const f of faces.slice().sort(() => rng() - 0.5)){
    if (lit.some((o) => Math.abs(o[0] - f[0]) + Math.abs(o[1] - f[1]) < (f[4] ? 4 : 7))) continue;
    if (f[0] === lv.start[0] && f[1] === lv.start[1]) continue;
    lit.push(f);
  }
  const bracketGeo = new THREE.BoxGeometry(0.06, 0.05, 0.22).translate(0, 0, 0.11), ringGeo = new THREE.TorusGeometry(0.04, 0.008, 6, 12);
  for (const [i, j, dx, dz, hall] of lit){
    const [cx, cz] = center(i, j);
    const g = new THREE.Group();
    g.position.set(cx + dx * TILE / 2, hall ? 2.6 : 1.75, cz + dz * TILE / 2);
    g.rotation.y = Math.atan2(-dx, -dz);
    const bracket = new THREE.Mesh(bracketGeo, mats.iron), ring = new THREE.Mesh(ringGeo, mats.iron);
    ring.rotation.x = Math.PI / 2; ring.position.set(0, 0.03, 0.2);
    const t = torchModel(mats.wood); t.position.set(0, -0.12, 0.2); t.rotation.x = 0.28; t.scale.setScalar(1.05);
    bracket.castShadow = ring.castShadow = true;
    g.add(bracket, ring, t); add(g); g.updateMatrixWorld(true);
    const tip = new THREE.Vector3(0, 0.53, 0).applyMatrix4(t.matrixWorld);
    const flame = add(makeFlame(0.34)); flame.position.copy(tip).add(new THREE.Vector3(0, -0.02, 0)); world.flames.push(flame);
    world.sconces.push({ pos: tip.clone().add(new THREE.Vector3(-dx * 0.18, 0.12, -dz * 0.18)), color: new THREE.Color(0xff9a55), base: 12, phase: rng() * 100, w: 0 });
  }
  // braziers in the hall, beside the pillars
  for (const p of world.pillars){
    const hc = center(lv.hall.centre[0], lv.hall.centre[1]);
    const dx = Math.sign(hc[0] - p.x), dz = Math.sign(hc[1] - p.z);
    const b = props.createBrazier({ env }); b.group.position.set(p.x + dx * 1.5, 0, p.z + dz * 1.5); add(b.group);
    b.group.updateMatrixWorld(true);
    const at = new THREE.Vector3(); b.flameAnchor.getWorldPosition(at);
    const fl = add(makeFlame(0.9)); fl.position.copy(at); world.flames.push(fl);
    world.sconces.push({ pos: at.clone().add(new THREE.Vector3(0, 0.6, 0)), color: new THREE.Color(0xff8a40), base: 30, phase: rng() * 100, w: 0, big: true });
    world.decor.push({ x: b.group.position.x, z: b.group.position.z, r: 0.45 });
  }

  // cobwebs in the top corners of corridors
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++){
    if (tt(i, j) !== T.FLOOR) continue;
    for (const [ax, az, bx, bz] of [[1, 0, 0, 1], [0, 1, -1, 0], [-1, 0, 0, -1], [0, -1, 1, 0]]){
      if (tt(i + ax, j + az) || tt(i + bx, j + bz) || rng() > 0.3) continue;
      const [cx, cz] = center(i, j);
      const corner = new THREE.Vector3(cx + (ax + bx) * TILE / 2, CEIL - 0.02, cz + (az + bz) * TILE / 2);
      const s = 0.7 + rng() * 0.7;
      const pA = corner.clone().add(new THREE.Vector3(-ax * s, 0, -az * s)), pB = corner.clone().add(new THREE.Vector3(-bx * s, 0, -bz * s));
      const low = corner.clone().add(new THREE.Vector3(-(ax + bx) * s * 0.25, -s * 0.9, -(az + bz) * s * 0.25));
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([...corner.toArray(), ...pA.toArray(), ...pB.toArray(), ...low.toArray()], 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0, 0, 0.75, 0.25], 2));
      geo.setIndex([0, 1, 3, 0, 3, 2]); geo.computeVertexNormals();
      const m = add(new THREE.Mesh(geo, mats.web)); m.renderOrder = 3;
    }
  }
  // chains from the ceiling: a few in corridors, long ones in the hall
  const linkGeo = new THREE.TorusGeometry(0.036, 0.009, 6, 14);
  const links = new THREE.InstancedMesh(linkGeo, mats.iron, 900); links.castShadow = true; links.count = 0;
  const floorTiles = [];
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) if (tt(i, j) === T.FLOOR || tt(i, j) === T.HALL) floorTiles.push([i, j]);
  for (let c = 0; c < 22 && links.count < 860; c++){
    const [i, j] = floorTiles[(rng() * floorTiles.length) | 0];
    if (i === lv.start[0] && j === lv.start[1]) continue;
    const hall = tt(i, j) === T.HALL, top = hall ? HALL_CEIL : CEIL;
    const [cx, cz] = center(i, j);
    const nLinks = hall ? 40 + ((rng() * 50) | 0) : 8 + ((rng() * 22) | 0);
    world.chains.push({ x: cx + (rng() - 0.5) * 1.4, z: cz + (rng() - 0.5) * 1.4, top, n: Math.min(nLinks, 900 - links.count), first: links.count, phase: rng() * 10, amp: 0.02 + rng() * 0.05 });
    links.count += Math.min(nLinks, 900 - links.count);
  }
  add(links); world.links = links;
  // loose stones along the foot of the walls
  const rockGeo = new THREE.IcosahedronGeometry(1, 1);
  { const p = rockGeo.attributes.position, r = mulberry(99); for (let k = 0; k < p.count; k++){ const s = 0.75 + r() * 0.45; p.setXYZ(k, p.getX(k) * s, p.getY(k) * s * 0.7, p.getZ(k) * s); } rockGeo.computeVertexNormals(); }
  const rocks = new THREE.InstancedMesh(rockGeo, mats.rock, 400); rocks.castShadow = rocks.receiveShadow = true;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  let rc = 0;
  for (const [i, j, dx, dz] of faces){
    for (let r = 0, k = (rng() * 4) | 0; r < k && rc < 400; r++){
      const [cx, cz] = center(i, j);
      const along = (rng() - 0.5) * TILE * 0.95, off = TILE / 2 - 0.05 - rng() * 0.25;
      const x = cx + dx * off - dz * along, z = cz + dz * off + dx * along, s = 0.03 + Math.pow(rng(), 3) * 0.16;
      e.set(rng() * 6, rng() * 6, rng() * 6); q.setFromEuler(e);
      m4.compose(new THREE.Vector3(x, s * 0.35, z), q, new THREE.Vector3(s, s, s)); rocks.setMatrixAt(rc++, m4);
    }
  }
  rocks.count = rc; add(rocks);
  // bones here and there
  for (let k = 0; k < 6; k++){
    const [i, j] = floorTiles[(rng() * floorTiles.length) | 0];
    if (Math.abs(i - lv.start[0]) + Math.abs(j - lv.start[1]) < 3) continue;
    const s = props.createSkullPile({ env }), [cx, cz] = center(i, j);
    const side = DIRS.find(([dx, dz]) => tt(i + dx, j + dz) === T.ROCK) || [0, 0];
    s.position.set(cx + side[0] * 0.95, 0, cz + side[1] * 0.95); s.rotation.y = rng() * 6; add(s);
  }

  // prison cells: iron bars across the opening
  for (const c of lv.cells){
    const [fx, fz] = center(c.from[0], c.from[1]), [dx, dz] = c.dir;
    const bars = props.createCellBars({ env });
    bars.group.position.set(fx + dx * TILE / 2, 0, fz + dz * TILE / 2);
    bars.group.rotation.y = Math.atan2(dx, dz);
    add(bars.group);
    const [cx, cz] = center(c.tile[0], c.tile[1]);
    // a straw pallet and a bucket make it a cell
    const straw = add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 1.8), new THREE.MeshStandardMaterial({ color: 0x5a4a28, roughness: 1 })));
    straw.position.set(cx + dz * 0.7 + dx * 0.4, 0.04, cz + dx * 0.7 + dz * 0.4); straw.rotation.y = Math.atan2(dx, dz); straw.receiveShadow = true;
    world.cells.push({ ...c, bars, pos: new THREE.Vector3(cx, 0, cz), door: new THREE.Vector3(fx + dx * TILE / 2, 0, fz + dz * TILE / 2), open: 0, freed: false });
  }
  // power gates
  for (const gt of lv.gates){
    const g = props.createPowerGate(gt.kind, { env });
    const [x, z] = center(gt.tile[0], gt.tile[1]);
    g.group.position.set(x, 0, z); g.group.rotation.y = Math.atan2(gt.axis[0], gt.axis[1]);
    add(g.group);
    const color = { magnet: 0xff4030, bomb: 0xff8a2a, freeze: 0x8cc8ff, shield: 0xffd24a }[gt.kind];
    const light = { pos: new THREE.Vector3(x, 1.6, z), color: new THREE.Color(color), base: 6, phase: rng() * 100, w: 0, gate: true };
    world.sconces.push(light);
    world.gates.push({ kind: gt.kind, obj: g, pos: new THREE.Vector3(x, 0, z), axis: gt.axis, taken: false, light });
  }
  // chests
  for (const ch of lv.chests){
    const c = props.createChest({ env }), [x, z] = center(ch.tile[0], ch.tile[1]), [bx, bz] = ch.back;
    c.group.position.set(x + bx * (TILE / 2 - 0.5), 0, z + bz * (TILE / 2 - 0.5));
    c.group.rotation.y = Math.atan2(-bx, -bz);
    add(c.group);
    world.chests.push({ obj: c, pos: c.group.position.clone(), contents: ch.contents, opened: false, open: 0 });
    world.decor.push({ x: c.group.position.x, z: c.group.position.z, r: 0.5 });
  }
  // food lying about
  for (const it of lv.items){
    const [x, z] = center(it.tile[0], it.tile[1]);
    const o = props.createFood(it.food);
    o.position.set(x + it.off[0], it.onStone ? 0.05 : 0, z + it.off[1]); o.rotation.y = rng() * 6;
    add(o);
    world.items.push({ kind: 'food', food: it.food, obj: o, pos: o.position.clone(), taken: false, onWater: !!it.onStone });
  }
  // the cracked wall: a crumbling panel on each open side of the blocked passage
  if (lv.crackGate){
    const [ci, cj] = lv.crackGate, [x, z] = center(ci, cj), panels = [];
    for (const [dx, dz] of DIRS){
      const nt = tt(ci + dx, cj + dz); if (nt === T.ROCK) continue;
      const p = props.createCrackedWall({ env });
      p.group.position.set(x + dx * TILE / 2, 0, z + dz * TILE / 2); p.group.rotation.y = Math.atan2(dx, dz);
      add(p.group); panels.push(p);
    }
    world.cracked = { tile: [ci, cj], pos: new THREE.Vector3(x, 1.2, z), panels, broken: false };
  }
  // the way out: a portcullis at the foot of the stairs, a moonlit doorway at the top
  {
    const [ri, rj] = lv.exit.room, [dx, dz] = lv.exit.dir, [rx, rz] = center(ri, rj);
    const pc = props.createPortcullis({ env });
    pc.group.position.set(rx + dx * TILE / 2, 0, rz + dz * TILE / 2); pc.group.rotation.y = Math.atan2(dx, dz);
    add(pc.group); world.portcullis = { obj: pc, raised: 0, open: false, pos: pc.group.position.clone() };
    const [li, lj] = lv.exit.landing, [cx, cz] = center(li, lj);
    const doorX = cx + dx * (TILE / 2 - 0.02), doorZ = cz + dz * (TILE / 2 - 0.02);
    const skyMat = new THREE.ShaderMaterial({ fog: false, uniforms: { time: flameUniforms.time },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float time; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
        void main(){
          float y = vUv.y;
          vec3 sky = mix(vec3(0.75, 0.85, 1.2), vec3(0.18, 0.24, 0.45), smoothstep(0.1, 1.0, y));
          float c = n(vec2(vUv.x * 3.0 + time * 0.03, y * 6.0)) * 0.6 + n(vec2(vUv.x * 7.0 - time * 0.02, y * 13.0)) * 0.4;
          sky *= 0.75 + 0.5 * c;
          float ground = smoothstep(0.1, 0.07, y + (n(vec2(vUv.x * 9.0, 1.0)) - 0.5) * 0.05);
          sky = mix(sky, vec3(0.01, 0.012, 0.02), ground);
          gl_FragColor = vec4(sky * 0.75, 1.0);
        }` });
    const sky = add(new THREE.Mesh(new THREE.PlaneGeometry(1.3, 2.3), skyMat));
    sky.position.set(doorX, STAIR_RISE + 1.15, doorZ); sky.rotation.y = Math.atan2(-dx, -dz);
    for (const [w, h, ox, oy] of [[0.35, 2.6, -0.82, 0.15], [0.35, 2.6, 0.82, 0.15], [2.0, 0.4, 0, 1.35]]){
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.3), mats.rock); b.position.set(ox, oy, 0.1); sky.add(b); b.castShadow = b.receiveShadow = true;
    }
    world.exitLight = { pos: new THREE.Vector3(doorX - dx * 0.3, STAIR_RISE + 2.1, doorZ - dz * 0.3), target: new THREE.Vector3(doorX - dx * TILE * 2.2, 0, doorZ - dz * TILE * 2.2),
      glow: new THREE.Vector3(doorX - dx * 0.6, STAIR_RISE + 1.2, doorZ - dz * 0.6) };
  }
  return world;
}
