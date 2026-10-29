// The wild: rolling hills, pine forest and birch, meadows of real grass blades that bend in the wind and
// part around animals, boulders, ferns, fallen logs and a lake, under a low afternoon sun.
import * as THREE from 'three';
import { fbm, vnoise, mulberry, clamp, smooth, lerp } from './noise.js';
import { mergeVertices } from '../lib/utils/BufferGeometryUtils.js';

export const SIZE = 800;            // metres across the map
const N = 256;                      // terrain grid cells along a side
const CELL = SIZE / N;
export const EDGE = 300;            // where the mountains start rising
export const LAKE = { x: 115, z: -75, r: 58, level: 0 };
// the big lake, and ponds dotted about (one just outside the den)
export const PONDS = [LAKE, { x: -42, z: 58, r: 15, level: 0 }, { x: -150, z: -115, r: 26, level: 0 }, { x: 70, z: 165, r: 20, level: 0 }, { x: -205, z: 95, r: 18, level: 0 }];
const pondDepth = (p) => Math.min(9, p.r * 0.3 + 3.5);
export const DEN = { x: 0, z: 18 };     // where the cat starts

// ---------- the shape of the land
function rawHeight(x, z, flat = true){
  let h = (fbm(x / 230 + 7, z / 230 + 3, 4, 1) - 0.5) * 30;
  h += (fbm(x / 70, z / 70, 4, 2) - 0.5) * 9;
  h += (fbm(x / 18, z / 18, 3, 3) - 0.5) * 1.4;
  const r = Math.hypot(x, z);
  if (r > EDGE) h += Math.pow((r - EDGE) / 70, 2) * 11 + (fbm(x / 30, z / 30, 4, 4) - 0.3) * (r - EDGE) * 0.12;
  // the lake basin
  for (const p of PONDS) h -= pondDepth(p) * smooth(p.r * 1.5 + 12, p.r * 0.3, Math.hypot(x - p.x, z - p.z));
  // a gentle hollow for the den
  if (flat) h = lerp(h, rawHeightDenBase, smooth(40, 8, Math.hypot(x - DEN.x, z - DEN.z)) * 0.7);
  return h;
}
let rawHeightDenBase = 0;
export function forestAt(x, z){
  let f = fbm(x / 150 + 40, z / 150 - 20, 4, 7);
  f -= 0.35 * smooth(45, 15, Math.hypot(x - DEN.x, z - DEN.z));
  return f;
}

export function createWorld(renderer, scene, T, quality){
  rawHeightDenBase = rawHeight(DEN.x, DEN.z, false);
  for (const p of PONDS) p.level = rawHeight(p.x, p.z) + pondDepth(p) * 0.36;

  // ---------- heights on the grid
  const V = N + 1, H = new Float32Array(V * V);
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) H[j * V + i] = rawHeight(-SIZE / 2 + i * CELL, -SIZE / 2 + j * CELL);
  // the exact height of the drawn triangles (each cell split along the same diagonal as the mesh)
  function heightAt(x, z){
    const gx = clamp((x + SIZE / 2) / CELL, 0, N - 0.0001), gz = clamp((z + SIZE / 2) / CELL, 0, N - 0.0001);
    const i = Math.floor(gx), j = Math.floor(gz), u = gx - i, v = gz - j;
    const a = H[j * V + i], b = H[j * V + i + 1], c = H[(j + 1) * V + i], d = H[(j + 1) * V + i + 1];
    return u + v < 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
  }
  function normalAt(x, z, out = new THREE.Vector3()){
    const e = 0.6;
    return out.set(heightAt(x - e, z) - heightAt(x + e, z), 2 * e, heightAt(x, z - e) - heightAt(x, z + e)).normalize();
  }
  const slopeAt = (x, z) => 1 - normalAt(x, z, _n).y;
  const _n = new THREE.Vector3();
  // the water level of whichever pond this point is in (or far below everything when it's in none)
  function levelAt(x, z){
    for (const p of PONDS) if (Math.hypot(x - p.x, z - p.z) < p.r * 1.6 + 14) return p.level;
    return -1e9;
  }
  const isWater = (x, z, depth = 0.12) => heightAt(x, z) < levelAt(x, z) - depth;

  // ground types per vertex: grass / forest floor / rock, and how much grass grows there
  const blend = new Float32Array(V * V * 3), grassD = new Float32Array(V * V);
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++){
    const x = -SIZE / 2 + i * CELL, z = -SIZE / 2 + j * CELL, k = j * V + i;
    const sl = slopeAt(x, z), f = forestAt(x, z), h = H[k];
    let rock = smooth(0.18, 0.32, sl) + smooth(EDGE + 40, EDGE + 90, Math.hypot(x, z)) * 0.3;
    rock += smooth(0.58, 0.7, fbm(x / 9, z / 9, 3, 61)) * 0.6 * smooth(0.08, 0.16, sl);
    rock = clamp(rock, 0, 1);
    const wl = levelAt(x, z), shore = smooth(wl + 1.2, wl + 0.2, h);
    let dirt = clamp(smooth(0.48, 0.6, f) + shore + (fbm(x / 12, z / 12, 3, 62) > 0.66 ? 0.5 : 0), 0, 1) * (1 - rock);
    const grass = Math.max(0, 1 - rock - dirt);
    blend[k * 3] = grass; blend[k * 3 + 1] = dirt; blend[k * 3 + 2] = rock;
    grassD[k] = clamp(grass * 1.1 + dirt * 0.15 - shore, 0, 1) * (h < wl + 0.1 ? 0 : 1);
  }

  // ---------- terrain mesh
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(V * V * 3);
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++){ const k = j * V + i; pos[k * 3] = -SIZE / 2 + i * CELL; pos[k * 3 + 1] = H[k]; pos[k * 3 + 2] = -SIZE / 2 + j * CELL; }
  const idx = new Uint32Array(N * N * 6); let q = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++){
    const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
    idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('blend', new THREE.BufferAttribute(blend, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const terrainMat = new THREE.MeshStandardMaterial({ map: T.grass, roughness: 0.96, metalness: 0 });
  terrainMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { tDirt: { value: T.dirt }, tRock: { value: T.rock }, nGrass: { value: T.grassN }, nDirt: { value: T.dirtN }, nRock: { value: T.rockN } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 blend; varying vec3 vBlend; varying vec3 vWP; varying vec3 vWN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBlend = blend; vWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D tDirt, tRock, nGrass, nDirt, nRock;
varying vec3 vBlend; varying vec3 vWP; varying vec3 vWN;
float tn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  float a = fract(sin(dot(i, vec2(12.9898,78.233)))*43758.5453), b = fract(sin(dot(i+vec2(1,0), vec2(12.9898,78.233)))*43758.5453);
  float c = fract(sin(dot(i+vec2(0,1), vec2(12.9898,78.233)))*43758.5453), d = fract(sin(dot(i+vec2(1,1), vec2(12.9898,78.233)))*43758.5453);
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }
// two scales mixed by noise so the repeat doesn't show
vec4 tri(sampler2D t, vec2 p, float m){ return mix(texture2D(t, p * 0.4), texture2D(t, p * 0.13 + 0.37), m); }
// rock on slopes: sample from the side as well as from above
vec4 rockTri(vec3 p, vec3 n){ vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x+w.y+w.z);
  return texture2D(tRock, p.zy*0.18)*w.x + texture2D(tRock, p.xz*0.18)*w.y + texture2D(tRock, p.xy*0.18)*w.z; }`)
      .replace('#include <map_fragment>', `
  float m = smoothstep(0.3, 0.7, tn(vWP.xz * 0.03));
  vec3 bw = vBlend;
  // break up the blend edges with noise so they look like patches, not gradients
  float nz = tn(vWP.xz * 0.35) * 0.6 + tn(vWP.xz * 1.3) * 0.4;
  bw = max(bw + (nz - 0.5) * 0.6 * (1.0 - bw), 0.0); bw = pow(bw, vec3(2.0)); bw /= max(bw.x+bw.y+bw.z, 1e-3);
  vec3 cg = tri(map, vWP.xz, m).rgb, cd = tri(tDirt, vWP.xz, m).rgb, cr = rockTri(vWP, normalize(vWN)).rgb;
  vec3 col = cg * bw.x + cd * bw.y + cr * bw.z;
  col *= 0.82 + 0.36 * tn(vWP.xz * 0.02 + 5.0);            // big soft patches of light and dark
  diffuseColor.rgb *= col;
  vec3 tnrm = (texture2D(nGrass, vWP.xz*0.4).xyz*2.0-1.0) * bw.x + (texture2D(nDirt, vWP.xz*0.4).xyz*2.0-1.0) * bw.y + (texture2D(nRock, vWP.xz*0.18).xyz*2.0-1.0) * bw.z;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  { vec3 wn = normalize(vWN + vec3(tnrm.x, 0.0, tnrm.y) * 0.9); normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz); }`);
  };
  const terrain = new THREE.Mesh(geo, terrainMat);
  terrain.receiveShadow = true;
  scene.add(terrain);

  // ---------- sky, sun and fog
  const sunDir = new THREE.Vector3(-0.55, 0.36, -0.75).normalize();
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sun: { value: sunDir }, time: { value: 0 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `uniform vec3 sun; uniform float time; varying vec3 vDir;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      float fb(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=n(p)*a; p*=2.07; a*=0.5; } return s; }
      void main(){
        vec3 d = normalize(vDir); float y = max(d.y, 0.0);
        vec3 zen = vec3(0.07, 0.18, 0.48), hor = vec3(0.46, 0.52, 0.58);
        vec3 col = mix(hor, zen, pow(y, 0.45));
        float s = max(dot(d, sun), 0.0);
        col += vec3(1.0, 0.62, 0.3) * pow(s, 8.0) * 0.45 + vec3(1.0, 0.8, 0.55) * pow(s, 64.0) * 0.6;
        col += vec3(1.0, 0.95, 0.85) * smoothstep(0.9993, 0.9997, s) * 12.0;
        // clouds on a flat layer far overhead
        if (d.y > 0.0){
          vec2 cp = d.xz / (d.y + 0.15) * 0.7 + vec2(time * 0.004, time * 0.002);
          float c = smoothstep(0.52, 0.8, fb(cp)) * smoothstep(0.02, 0.2, d.y);
          vec3 cc = mix(vec3(0.5, 0.52, 0.58), vec3(1.0, 0.88, 0.72), pow(s, 3.0) * 0.8 + 0.2);
          col = mix(col, cc, c * smoothstep(0.0, 0.25, d.y) * 0.85);
        }
        col = mix(col, hor * 0.9, smoothstep(0.02, -0.08, d.y));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), skyMat);
  sky.frustumCulled = false; sky.renderOrder = -1;
  scene.add(sky);
  const fogCol = new THREE.Color(0.42, 0.47, 0.52);
  scene.fog = new THREE.FogExp2(fogCol, 0.0034);
  scene.background = fogCol;

  // image-based light from the sky: soft blue from above, warm from the sun side, dark green from below
  {
    const envScene = new THREE.Scene();
    const s2 = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMat.clone());
    s2.material.uniforms.sun.value = sunDir;
    envScene.add(s2);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(45, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.08, 0.09, 0.05) }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -2; envScene.add(ground);
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(envScene, 0.02).texture;
    scene.environmentIntensity = 0.55;
    pm.dispose();
  }
  const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.86, 0.68), 3.2);
  sun.castShadow = true;
  const SH = quality > 1 ? 2048 : 1024, SR = 38;
  sun.shadow.mapSize.set(SH, SH);
  Object.assign(sun.shadow.camera, { left: -SR, right: SR, top: SR, bottom: -SR, near: 1, far: 260 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0x9fb4d0, 0x3a3420, 0.35);
  scene.add(hemi);

  // ---------- things placed on the land
  const rnd = mulberry(1234);
  const colliders = new Map();          // 8 m grid of circles
  const addCollider = (x, z, r, kind) => {
    const k = Math.floor(x / 8) + ',' + Math.floor(z / 8);
    if (!colliders.has(k)) colliders.set(k, []);
    colliders.get(k).push({ x, z, r, kind });
  };
  const nearDen = (x, z, r) => Math.hypot(x - DEN.x, z - DEN.z) < r;

  // pines and birches, on a jittered grid, chunked so off-screen chunks are skipped
  const pines = [], birches = [];
  const G = 6;
  for (let gz = -SIZE / 2 + G; gz < SIZE / 2 - G; gz += G) for (let gx = -SIZE / 2 + G; gx < SIZE / 2 - G; gx += G){
    const x = gx + rnd() * G, z = gz + rnd() * G, r = Math.hypot(x, z);
    if (r > EDGE + 90 || nearDen(x, z, 12)) continue;
    const h = heightAt(x, z);
    if (h < levelAt(x, z) + 0.6 || slopeAt(x, z) > (r > EDGE ? 0.45 : 0.28)) continue;
    const f = forestAt(x, z);
    const pPine = smooth(0.44, 0.62, f) * 0.85 + smooth(EDGE - 20, EDGE + 20, r) * 0.6;
    const u = rnd();
    if (u < pPine) pines.push({ x, z, y: h, s: 0.75 + rnd() * 0.55, a: rnd() * 6.28 });
    else if (u < pPine + 0.014 && f < 0.5) birches.push({ x, z, y: h, s: 0.8 + rnd() * 0.4, a: rnd() * 6.28 });
  }
  for (const t of pines) addCollider(t.x, t.z, 0.32 * t.s, 'tree');
  for (const t of birches) addCollider(t.x, t.z, 0.18 * t.s, 'tree');

  const chunked = (list, geom, mat, matrixFor, opts = {}) => {
    const C = 100, groups = new Map();
    for (const it of list){ const k = Math.floor(it.x / C) + ',' + Math.floor(it.z / C); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
    const m4 = new THREE.Matrix4();
    for (const items of groups.values()){
      const im = new THREE.InstancedMesh(geom, mat, items.length);
      items.forEach((it, i) => { matrixFor(it, m4); im.setMatrixAt(i, m4); });
      im.castShadow = opts.cast !== false; im.receiveShadow = true;
      im.computeBoundingSphere();
      scene.add(im);
    }
  };
  const compose = (x, y, z, ry, sx, sy, sz, m4) => m4.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(sx, sy, sz));

  // a gentle sway for anything leafy
  const windU = { value: 0 };
  const sway = (mat, amount) => {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.wTime = windU;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float wTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          { vec4 ip = instanceMatrix * vec4(0.0,0.0,0.0,1.0); float hh = max(position.y, 0.0);
            float w = sin(wTime * 1.3 + ip.x * 0.11 + ip.z * 0.07) + 0.4 * sin(wTime * 3.1 + position.x * 2.0 + ip.z);
            transformed.x += w * ${amount.toFixed(3)} * hh * hh * 0.02; transformed.z += w * ${amount.toFixed(3)} * hh * hh * 0.012; }`);
    };
  };

  // pine: a tapered trunk and tiers of drooping branch cards; normals point out from the crown so it shades round
  {
    const trunk = new THREE.CylinderGeometry(0.06, 0.32, 18, 9, 4, true); trunk.translate(0, 9, 0);
    { const uv = trunk.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 6); }
    const barkMat = new THREE.MeshStandardMaterial({ map: T.bark, normalMap: T.barkN, roughness: 0.95 });
    chunked(pines, trunk, barkMat, (t, m4) => compose(t.x, t.y - 0.3, t.z, t.a, t.s, t.s, t.s, m4));

    const P = [], Nn = [], U = [], I = [];
    const r2 = mulberry(77);
    const tiers = 13;
    for (let k = 0; k < tiers; k++){
      const t = k / (tiers - 1), y = 5.5 + t * 12.6, len = 3.4 * (1 - t) + 0.6, nb = 7 - Math.floor(t * 3);
      for (let b = 0; b < nb; b++){
        const a = (b / nb) * Math.PI * 2 + r2() * 0.6 + k * 0.9, droop = 0.35 + r2() * 0.25 - t * 0.2;
        const ca = Math.cos(a), sa = Math.sin(a), w = len * 0.42;
        for (const tilt of [0, 1]){
          // two cards per branch: one flat-ish, one tipped, so it has volume from any side
          const base = P.length / 3;
          const rx = -sa, rz = ca;                 // across the branch
          const up = tilt ? 0.45 : 0.1;
          const pts = [[0, -w * 0.5], [len, -w * 0.5], [len, w * 0.5], [0, w * 0.5]];
          for (const [along, across] of pts){
            const x = ca * along + rx * across * (1 - up), z = sa * along + rz * across * (1 - up);
            const yy = y - along * droop + across * up * (tilt ? 1 : 0.2);
            P.push(x, yy, z);
            const nx = ca * 0.7, ny = 0.75, nz = sa * 0.7, l = Math.hypot(nx, ny, nz);
            Nn.push(nx / l, ny / l, nz / l);
          }
          U.push(0, 0, 1, 0, 1, 1, 0, 1);
          I.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
    }
    // the very top
    { const base = P.length / 3; P.push(-0.5, 17.5, 0, 0.5, 17.5, 0, 0.0, 19.6, 0, 0, 17.5, -0.5, 0, 17.5, 0.5, 0, 19.6, 0);
      for (let i = 0; i < 6; i++) Nn.push(0, 1, 0); U.push(0, 0.3, 0, 0.7, 1, 0.5, 0, 0.3, 0, 0.7, 1, 0.5); I.push(base, base + 1, base + 2, base + 3, base + 4, base + 5); }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    fg.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
    fg.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    fg.setIndex(I);
    const needleMat = new THREE.MeshStandardMaterial({ map: T.needles, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85 });
    sway(needleMat, 0.25);
    const pineM = (t, m4) => compose(t.x, t.y - 0.3, t.z, t.a, t.s, t.s * (0.9 + (t.a % 0.3)), t.s, m4);
    chunked(pines, fg, needleMat, pineM);
    // the body of the crown: drooping skirts of needles, one per tier, ragged at the hem
    {
      const P = [], Nn = [], U = [], I = [], r3 = mulberry(99), SEG = 14;
      for (let k = 0; k < 11; k++){
        const t = k / 10, y = 4.6 + t * 13.2, len = 3.6 * (1 - t) + 0.5, hh = 1.5 + (1 - t) * 0.9;
        const rows = [[0.12, hh, 1], [0.62, hh * 0.45, 0.5], [1.0, 0, 0]];
        const base = P.length / 3;
        for (const [rf, dy, v] of rows) for (let j = 0; j <= SEG; j++){
          const a = j / SEG * Math.PI * 2 + k * 0.7, rr = len * rf * (v === 0 ? 0.8 + r3() * 0.4 : 1);
          const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
          P.push(x, y + dy - (v === 0 ? r3() * 0.4 : 0), z);
          const l = Math.hypot(x, len * 0.9, z) || 1; Nn.push(x / l, len * 0.9 / l, z / l);
          U.push(j / SEG * Math.max(2, Math.round(len * 1.2)), v);
        }
        for (let r = 0; r < 2; r++) for (let j = 0; j < SEG; j++){
          const a = base + r * (SEG + 1) + j, b = a + SEG + 1;
          I.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
      const cg = new THREE.BufferGeometry();
      cg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); cg.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
      cg.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); cg.setIndex(I);
      const matMat = new THREE.MeshStandardMaterial({ map: T.needleMat, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.85 });
      sway(matMat, 0.2);
      chunked(pines, cg, matMat, pineM);
    }
  }
  // birch: a thin white trunk and round clumps of leaf cards
  {
    const trunk = new THREE.CylinderGeometry(0.05, 0.17, 11, 8, 3, true); trunk.translate(0, 5.5, 0);
    { const uv = trunk.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), uv.getY(i) * 4); }
    chunked(birches, trunk, new THREE.MeshStandardMaterial({ map: T.birch, normalMap: T.birchN, roughness: 0.8 }), (t, m4) => compose(t.x, t.y - 0.2, t.z, t.a, t.s, t.s, t.s, m4));
    const P = [], Nn = [], U = [], I = [], r2 = mulberry(31);
    for (let k = 0; k < 26; k++){
      const cy = 6 + r2() * 5, a = r2() * 6.28, rr = 0.6 + r2() * 1.9 * (1 - (cy - 6) / 7);
      const cx = Math.cos(a) * rr, cz = Math.sin(a) * rr, s = 1.6 + r2() * 1.2;
      for (let p = 0; p < 2; p++){
        const ang = r2() * 3.14, ca = Math.cos(ang) * s, sa = Math.sin(ang) * s, tilt = (r2() - 0.5) * s;
        const base = P.length / 3;
        P.push(cx - ca, cy - s - tilt, cz - sa, cx + ca, cy - s + tilt, cz + sa, cx + ca, cy + s + tilt, cz + sa, cx - ca, cy + s - tilt, cz - sa);
        const l = Math.hypot(cx, 1.2, cz); for (let i = 0; i < 4; i++) Nn.push(cx / l, 1.2 / l, cz / l);
        U.push(0, 0, 1, 0, 1, 1, 0, 1); I.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); fg.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
    fg.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); fg.setIndex(I);
    const leafMat = new THREE.MeshStandardMaterial({ map: T.leaves, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.75 });
    sway(leafMat, 0.6);
    chunked(birches, fg, leafMat, (t, m4) => compose(t.x, t.y - 0.2, t.z, t.a, t.s, t.s, t.s, m4));
  }

  // boulders: lumpy displaced spheres, sampled side-on as well as from above
  const rocks = [];
  {
    const variants = [];
    for (let v = 0; v < 4; v++){
      let g = new THREE.IcosahedronGeometry(1, 4);
      g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g);        // shared vertices, so it shades smooth
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++){
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        let d = 1 + (fbm(x * 1.4 + v * 9, z * 1.4 + y * 1.1, 4, 70 + v) - 0.5) * 0.7;
        d *= 1 + Math.max(0, -y) * 0.0;
        const flat = y > 0.55 ? 0.55 + (y - 0.55) * 0.4 : y;     // weathered flatter tops
        p.setXYZ(i, x * d * 1.2, flat * d * 0.8, z * d);
      }
      g.computeVertexNormals();
      variants.push(g);
    }
    const rockMat = new THREE.MeshStandardMaterial({ map: T.rock, normalMap: T.rockN, roughness: 0.9 });
    rockMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRP; varying vec3 vRN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRP = (modelMatrix * instanceMatrix * vec4(position,1.0)).xyz; vRN = normalize(mat3(modelMatrix * instanceMatrix) * normal);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vRP; varying vec3 vRN;')
        .replace('#include <map_fragment>', `{ vec3 w = pow(abs(normalize(vRN)), vec3(4.0)); w /= w.x+w.y+w.z;
          vec3 c = texture2D(map, vRP.zy*0.25).rgb*w.x + texture2D(map, vRP.xz*0.25).rgb*w.y + texture2D(map, vRP.xy*0.25).rgb*w.z;
          c = mix(c, c * vec3(0.55, 0.75, 0.4), smoothstep(0.55, 0.9, vRN.y) * 0.6);   // moss on top
          diffuseColor.rgb *= c; }`);
    };
    const lists = variants.map(() => []);
    for (let i = 0; i < 700; i++){
      const x = (rnd() - 0.5) * (EDGE * 2.1), z = (rnd() - 0.5) * (EDGE * 2.1);
      if (Math.hypot(x, z) > EDGE + 30 || nearDen(x, z, 10)) continue;
      const h = heightAt(x, z);
      if (h < levelAt(x, z) - 0.5) continue;
      const s = Math.pow(rnd(), 2.2) * 2.6 + 0.35;
      const it = { x, z, y: h - s * 0.25, s, a: rnd() * 6.28 };
      lists[i % 4].push(it); rocks.push(it);
      if (s > 0.5) addCollider(x, z, s * 1.05, 'rock');
    }
    // the den: a ring of big stones at the start
    for (let k = 0; k < 6; k++){
      const a = k / 6 * Math.PI * 2 + 0.4, d = 7 + (k % 2) * 2, x = DEN.x + Math.cos(a) * d, z = DEN.z + Math.sin(a) * d, s = 1.4 + (k % 3) * 0.5;
      const it = { x, z, y: heightAt(x, z) - s * 0.25, s, a: k };
      if (k === 2) continue;        // the gap is the way out
      lists[k % 4].push(it); rocks.push(it); addCollider(x, z, s * 1.05, 'rock');
    }
    variants.forEach((g, v) => chunked(lists[v], g, rockMat, (t, m4) => compose(t.x, t.y, t.z, t.a, t.s, t.s, t.s, m4)));
  }
  // fallen logs
  {
    const g = new THREE.CylinderGeometry(0.28, 0.32, 1, 10, 1); g.rotateZ(Math.PI / 2);
    { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 3); }
    const logs = [];
    for (let i = 0; i < 90; i++){
      const x = (rnd() - 0.5) * EDGE * 2, z = (rnd() - 0.5) * EDGE * 2;
      if (forestAt(x, z) < 0.5 || nearDen(x, z, 15) || isWater(x, z) || Math.hypot(x, z) > EDGE) continue;
      const len = 5 + rnd() * 7, a = rnd() * 6.28, s = 0.7 + rnd() * 0.6;
      const y = Math.min(heightAt(x + Math.cos(a) * len / 2, z - Math.sin(a) * len / 2), heightAt(x - Math.cos(a) * len / 2, z + Math.sin(a) * len / 2));
      logs.push({ x, z, y: Math.max(y, heightAt(x, z) - 0.1) + 0.2 * s, a, len, s });
      for (let k = -2; k <= 2; k++) addCollider(x + Math.cos(a) * len * k / 5, z - Math.sin(a) * len * k / 5, 0.3 * s + 0.05, 'log');
    }
    chunked(logs, g, new THREE.MeshStandardMaterial({ map: T.bark, normalMap: T.barkN, roughness: 0.95, color: 0x9a9080 }), (t, m4) => compose(t.x, t.y, t.z, t.a, t.len, t.s, t.s, m4));
  }
  // ferns in the forest: crossed cards bent outward
  {
    const P = [], Nn = [], U = [], I = [];
    for (let k = 0; k < 7; k++){
      const a = k / 7 * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), L = 0.9, W = 0.22;
      const base = P.length / 3;
      const rx = -sa * W, rz = ca * W;
      // a frond rises then arcs outward: 3 rows of 2
      const rows = [[0, 0], [0.45, 0.42], [0.9, 0.4]];
      rows.forEach(([d, h], r) => { P.push(ca * d - rx, h, sa * d - rz, ca * d + rx, h, sa * d + rz); U.push(0, r / 2, 1, r / 2);
        for (let i = 0; i < 2; i++) Nn.push(ca * 0.3, 0.95, sa * 0.3); });
      I.push(base, base + 1, base + 3, base, base + 3, base + 2, base + 2, base + 3, base + 5, base + 2, base + 5, base + 4);
      void L;
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); fg.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
    fg.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); fg.setIndex(I);
    const ferns = [];
    for (let i = 0; i < (quality > 1 ? 6000 : 2500); i++){
      const x = (rnd() - 0.5) * EDGE * 2, z = (rnd() - 0.5) * EDGE * 2;
      const f = forestAt(x, z);
      if (rnd() > smooth(0.42, 0.6, f) || isWater(x, z) || Math.hypot(x, z) > EDGE || slopeAt(x, z) > 0.25) continue;
      ferns.push({ x, z, y: heightAt(x, z) - 0.05, s: 0.6 + rnd() * 0.8, a: rnd() * 6.28 });
    }
    const fernMat = new THREE.MeshStandardMaterial({ map: T.fern, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8 });
    sway(fernMat, 4.0);
    chunked(ferns, fg, fernMat, (t, m4) => compose(t.x, t.y, t.z, t.a, t.s, t.s, t.s, m4), { cast: false });
  }

  // ---------- the lake and ponds: opaque, so they show the same on every graphics chip; the ripples are
  // mapped in world space so a small pond ripples at the same scale as the lake
  const waterMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.035, 0.085, 0.09), roughness: 0.07, metalness: 0.0, normalMap: T.waterN, normalScale: new THREE.Vector2(0.3, 0.3),
    envMapIntensity: 2.2 });
  for (const p of PONDS){
    const g = new THREE.CircleGeometry(p.r * 1.6 + 14, 64);
    const pos = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + p.x) / 9, (pos.getY(i) - p.z) / 9);
    const water = new THREE.Mesh(g, waterMat);
    water.rotation.x = -Math.PI / 2; water.position.set(p.x, p.level, p.z);
    water.receiveShadow = true;
    scene.add(water);
  }

  // ---------- grass: blades instanced over a patch that follows the camera and wraps around
  const heightTex = (() => {
    const d = new Float32Array(V * V * 4);
    for (let k = 0; k < V * V; k++){
      const x = -SIZE / 2 + (k % V) * CELL, z = -SIZE / 2 + Math.floor(k / V) * CELL;
      d[k * 4] = H[k]; d[k * 4 + 1] = grassD[k]; d[k * 4 + 2] = fbm(x / 40, z / 40, 3, 90); d[k * 4 + 3] = 1;
    }
    const t = new THREE.DataTexture(d, V, V, THREE.RGBAFormat, THREE.FloatType);
    t.magFilter = t.minFilter = THREE.NearestFilter;        // filtered by hand in the shader (float filtering isn't everywhere)
    t.needsUpdate = true;
    return t;
  })();
  const PR = quality > 1 ? 24 : quality > 0 ? 18 : 13;           // patch radius in metres
  const COUNT = quality > 1 ? 240000 : quality > 0 ? 110000 : 40000;
  const grassU = { center: { value: new THREE.Vector2() }, time: windU, hmap: { value: heightTex },
    push: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, -999, 0, 0)) } };
  const grass = (() => {
    const blade = new THREE.BufferGeometry();
    const SEG = 4, bp = [], bi = [], bh = [];
    for (let s = 0; s <= SEG; s++){
      const t = s / SEG, w = 0.5 * (1 - Math.pow(t, 1.6));
      if (s < SEG){ bp.push(-w, t, 0, w, t, 0); bh.push(t, t); }
      else { bp.push(0, 1, 0); bh.push(1); }
    }
    for (let s = 0; s < SEG - 1; s++){ const a = s * 2; bi.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    bi.push((SEG - 1) * 2, (SEG - 1) * 2 + 1, SEG * 2);
    const ig = new THREE.InstancedBufferGeometry();
    ig.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
    ig.setAttribute('normal', new THREE.Float32BufferAttribute(bp.map((_, i) => i % 3 === 2 ? 1 : 0), 3));
    ig.setIndex(bi);
    const off = new Float32Array(COUNT * 4), r3 = mulberry(55);
    for (let i = 0; i < COUNT; i += 4){
      // clumps of four
      const cx = (r3() - 0.5) * PR * 2, cz = (r3() - 0.5) * PR * 2;
      for (let k = 0; k < 4 && i + k < COUNT; k++){
        off[(i + k) * 4] = cx + (r3() - 0.5) * 0.25; off[(i + k) * 4 + 1] = cz + (r3() - 0.5) * 0.25;
        off[(i + k) * 4 + 2] = r3() * 6.283; off[(i + k) * 4 + 3] = r3();
      }
    }
    ig.setAttribute('offset', new THREE.InstancedBufferAttribute(off, 4));
    ig.instanceCount = COUNT;
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.75, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, grassU);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
        attribute vec4 offset; uniform vec2 center; uniform float time; uniform sampler2D hmap; uniform vec4 push[8];
        varying vec3 gCol; varying float gH;
        vec4 hm(vec2 w){ vec2 g = clamp((w + ${(SIZE / 2).toFixed(1)}) / ${CELL.toFixed(4)}, vec2(0.0), vec2(${(N - 0.001).toFixed(3)}));
          vec2 i = floor(g), f = g - i;
          vec4 a = texelFetch(hmap, ivec2(i), 0), b = texelFetch(hmap, ivec2(i) + ivec2(1,0), 0), c = texelFetch(hmap, ivec2(i) + ivec2(0,1), 0), d = texelFetch(hmap, ivec2(i) + ivec2(1,1), 0);
          // same triangle split as the terrain mesh, so blades sit exactly on the ground
          vec4 r = (f.x + f.y < 1.0) ? a + (b - a) * f.x + (c - a) * f.y : d + (c - d) * (1.0 - f.x) + (b - d) * (1.0 - f.y);
          return r; }`)
        .replace('#include <beginnormal_vertex>', `
          vec2 rel = mod(offset.xy - center + ${PR.toFixed(1)}, ${(PR * 2).toFixed(1)}) - ${PR.toFixed(1)};
          vec2 wp = center + rel;
          vec4 H = hm(wp);
          float rnd = offset.w;
          float dens = H.y;
          float dist = length(rel);
          float keep = step(rnd, dens) * smoothstep(${PR.toFixed(1)}, ${(PR * 0.6).toFixed(1)}, dist);
          float tall = (0.1 + 0.28 * rnd * rnd + H.z * H.z * 0.4) * keep * mix(0.4, 1.0, smoothstep(0.1, 0.5, dens));
          float ca = cos(offset.z), sa = sin(offset.z);
          vec3 objectNormal = normalize(vec3(sa * 0.3, 1.0, ca * 0.3));`)
        .replace('#include <begin_vertex>', `
          float t = position.y;
          vec3 transformed = vec3(position.x * 0.014 * (0.7 + rnd) * (1.0 + dist * 0.12), 0.0, 0.0);
          transformed = vec3(transformed.x * ca, 0.0, -transformed.x * sa);
          // bend: a natural lean, wind gusts rolling across the field, and animals pushing it aside
          float gust = sin(time * 1.6 + wp.x * 0.21 + wp.y * 0.13) * 0.5 + sin(time * 0.7 + wp.x * 0.05) * 0.5;
          vec2 bend = vec2(sa, ca) * (0.25 + rnd * 0.3) + vec2(0.9, 0.4) * (0.25 + 0.3 * gust) + vec2(sin(time * 4.0 + rnd * 30.0)) * 0.04;
          for (int k = 0; k < 8; k++){
            vec2 dv = wp - push[k].xz; float dl = length(dv);
            float pr = push[k].w;
            if (dl < pr) bend += dv / max(dl, 0.01) * (1.0 - dl / pr) * 2.6;
          }
          float bl = length(bend); if (bl > 1.4) bend *= 1.4 / bl;
          float t2 = t * t;
          transformed.xz += bend * t2 * tall * 0.75;
          transformed.y = t * tall * (1.0 - 0.25 * min(bl, 1.4) * t);
          transformed += vec3(wp.x, H.x, wp.y);
          gH = t;
          gCol = mix(vec3(0.02, 0.035, 0.008), mix(vec3(0.12, 0.22, 0.03), vec3(0.3, 0.25, 0.08), smoothstep(0.4, 0.9, H.z * 0.8 + rnd * 0.35)), pow(t, 0.7));`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 gCol; varying float gH;')
        .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= gCol;')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(0.9, 0.55, gH);');
    };
    const m = new THREE.Mesh(ig, mat);
    m.frustumCulled = false; m.receiveShadow = true;
    scene.add(m);
    return m;
  })();

  function collide(o, r){
    const cx = Math.floor(o.x / 8), cz = Math.floor(o.z / 8);
    let hit = null;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++){
      const list = colliders.get((cx + i) + ',' + (cz + j)); if (!list) continue;
      for (const c of list){
        const dx = o.x - c.x, dz = o.z - c.z, d = Math.hypot(dx, dz), m = c.r + r;
        if (d < m && d > 1e-4){ o.x = c.x + dx / d * m; o.z = c.z + dz / d * m; hit = c; }
      }
    }
    // the mountains all round: too steep to climb
    const rr = Math.hypot(o.x, o.z), lim = EDGE + 30;
    if (rr > lim){ o.x *= lim / rr; o.z *= lim / rr; hit = hit || { kind: 'edge' }; }
    return hit;
  }

  function blocked(x, z, r){
    const cx = Math.floor(x / 8), cz = Math.floor(z / 8);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++){
      for (const c of colliders.get((cx + i) + ',' + (cz + j)) || []) if (c.kind !== 'log' && Math.hypot(x - c.x, z - c.z) < c.r + r) return true;
    }
    return false;
  }
  const _t = new THREE.Vector3();
  function update(dt, time, focus, pushers){
    windU.value = time;
    skyMat.uniforms.time.value = time;
    T.waterN.offset.set(time * 0.006, time * 0.004);
    grassU.center.value.set(focus.x, focus.z);
    for (let i = 0; i < 8; i++){ const p = pushers[i]; if (p) grassU.push.value[i].set(p.x, 0, p.z, p.r); else grassU.push.value[i].set(0, 0, -9999, 0); }
    // the shadow box follows the cat, snapped to whole shadow texels so the edges don't crawl
    const texel = (SR * 2) / SH;
    _t.set(Math.round(focus.x / texel) * texel, focus.y, Math.round(focus.z / texel) * texel);
    sun.target.position.copy(_t);
    sun.position.copy(_t).addScaledVector(sunDir, 120);
    sky.position.set(focus.x, 0, focus.z);
  }

  return { heightAt, normalAt, isWater, levelAt, collide, blocked, update, sun, sunDir, rocks, pines, terrain, grass, forestAt, slopeAt };
}
