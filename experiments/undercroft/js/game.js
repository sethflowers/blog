// The Undercroft: the game. Free the prisoners, survive the zombies and the monster, find the way up.
import * as THREE from 'three';
import { EffectComposer } from '/experiments/undercroft/lib/postprocessing/EffectComposer.js';
import { RenderPass } from '/experiments/undercroft/lib/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '/experiments/undercroft/lib/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '/experiments/undercroft/lib/postprocessing/OutputPass.js';
import { ShaderPass } from '/experiments/undercroft/lib/postprocessing/ShaderPass.js';
import { makeEnvMap } from './env.js';
import { TILE, CEIL, HALL_CEIL, STAIR_RISE, T, DIRS, floorOf, ceilOf, generateLevel, bfs, mulberry } from './level.js';
import { makeMaterials, buildWorld, makeFlame, torchModel, ragMat, flameUniforms, center } from './world.js';
import { audio, initAudio, resumeAudio, setMuted, sfx, ambience, setListener } from './audio.js';
import * as stubs from './models/stubs.js';
import { buildShrine } from './shrines.js';

const BASE = '/experiments/undercroft/';
const params = new URLSearchParams(location.search);
const TEST = params.has('test');            // automated runs: fixed seed, no sound, stepped by the test
const DEBUG = params.has('debug');
const $ = (id) => document.getElementById(id);

const EYE = 1.62, RADIUS = 0.36, WALK = 1.8, HURRY = 3.6;
const MAX_HP = 10;                           // five hearts, in halves
const FOOD = { apple: { name: 'Apple', heal: 2 }, bread: { name: 'Bread', heal: 3 }, cheese: { name: 'Cheese', heal: 4 }, drumstick: { name: 'Roast chicken leg', heal: 6 } };
const WEAPONS = {
  sword:    { name: 'Sword', dmg: 1, reach: 2.1, arc: 1.3, cool: 0.45, hitAt: 0.12, knock: 2.5, desc: 'Quick slashes.' },
  spear:    { name: 'Spear', dmg: 1.4, reach: 3.1, arc: 0.45, cool: 0.6, hitAt: 0.14, knock: 3.5, desc: 'Long reach. Keep them away.' },
  hammer:   { name: 'War hammer', dmg: 3.2, reach: 2.0, arc: 1.4, cool: 1.1, hitAt: 0.38, knock: 6, desc: 'Slow and crushing.' },
  crossbow: { name: 'Crossbow', dmg: 2.5, reach: 40, arc: 0, cool: 0.9, hitAt: 0, knock: 3, desc: 'Shoots bolts. Find more in chests.' },
};
const WEAPON_ORDER = ['sword', 'spear', 'hammer', 'crossbow'];
const POWERS = {
  magnet: { name: 'Magnet', desc: 'Hold to pull things to you: food, weapons, even zombies.', color: '#ff5040' },
  bomb:   { name: 'Bomb wand', desc: 'Throw a bomb, then press again to blow it up. Breaks cracked walls.', color: '#ff9a3a' },
  freeze: { name: 'Freeze', desc: 'Freezes nearby water so you can walk on it. It thaws after a while.', color: '#9ad4ff' },
  shield: { name: 'Shield', desc: 'Nothing can hurt you for one minute.', color: '#ffd24a' },
};
const POWER_ORDER = ['magnet', 'bomb', 'freeze', 'shield'];

/* ================================================================
   RENDERER AND FILM LOOK
   ================================================================ */
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: TEST });
renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.prepend(renderer.domElement);
const env = makeEnvMap(renderer);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0);
scene.fog = new THREE.FogExp2(0x0b0c0f, 0.045);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.04, 90);
camera.rotation.order = 'YXZ';
scene.add(camera);

const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.6, 1.1));
composer.addPass(new OutputPass());
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, aspect: { value: 1 }, hurt: { value: 0 }, shield: { value: 0 }, fade: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time, aspect, hurt, shield, fade;
    varying vec2 vUv;
    float hash(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
    void main(){
      vec2 c = vUv - 0.5;
      float r2 = dot(c * vec2(aspect, 1.0), c * vec2(aspect, 1.0));
      vec2 off = c * (0.0035 + hurt * 0.012);
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col * vec3(0.86, 0.94, 1.1), col, smoothstep(0.0, 0.35, lum));
      col = mix(vec3(lum), col, 0.88);
      float edge = smoothstep(0.12, 1.05, r2);
      col *= mix(1.0, 1.0 - edge, 0.82);
      col = mix(col, vec3(0.55, 0.02, 0.0), edge * hurt * 0.9);                                   // blood at the edges when hurt
      col += vec3(1.0, 0.75, 0.25) * edge * shield * (0.35 + 0.1 * sin(time * 4.0 + r2 * 20.0));   // gold shimmer while shielded
      float g = hash(vUv * 1000.0 + fract(time * 7.13) * 100.0) - 0.5;
      col += g * 0.05 * (1.0 - lum * 0.6);
      gl_FragColor = vec4(max(col, 0.0) * (1.0 - fade), 1.0);
    }`
});
composer.addPass(grade);
let pixelRatio = TEST ? 1 : Math.min(devicePixelRatio || 1, 1.5);
function resize(){
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setPixelRatio(pixelRatio); renderer.setSize(innerWidth, innerHeight);
  composer.setPixelRatio(pixelRatio); composer.setSize(innerWidth, innerHeight);
  grade.uniforms.aspect.value = innerWidth / innerHeight;
}
addEventListener('resize', resize); resize();

/* ================================================================
   LIGHTS. The count never changes, so shaders never recompile mid-game.
   ================================================================ */
const fill = new THREE.HemisphereLight(0x8090b0, 0x6a5e50, 5.5); scene.add(fill);
const handLight = new THREE.PointLight(0xffa767, 7, 16, 2);
handLight.castShadow = true; handLight.shadow.mapSize.set(512, 512);
handLight.shadow.camera.near = 0.08; handLight.shadow.camera.far = 16; handLight.shadow.bias = -0.004; handLight.shadow.normalBias = 0.03;
scene.add(handLight);
const pool = [0, 1, 2].map((k) => {
  const l = new THREE.PointLight(0xff9a55, 0, 18, 2);
  if (k === 0){ l.castShadow = true; l.shadow.mapSize.set(512, 512); l.shadow.camera.near = 0.1; l.shadow.camera.far = 18; l.shadow.bias = -0.004; l.shadow.normalBias = 0.03; }
  scene.add(l); return l;
});
const exitLight = new THREE.SpotLight(0x8aa6ff, 60, 22, 0.75, 0.9, 1.6); scene.add(exitLight, exitLight.target);
const exitGlow = new THREE.PointLight(0x7f98ff, 6, 9, 2); scene.add(exitGlow);
const fxLight = new THREE.PointLight(0xff8a30, 0, 20, 2); scene.add(fxLight);   // explosions, fire breath, magic
const fx = { light: 0, color: new THREE.Color() };
function flash(pos, color, power){ fxLight.position.copy(pos); fx.color.set(color); fxLight.color.copy(fx.color); fx.light = Math.max(fx.light, power); }

/* ================================================================
   MODELS (built by their own modules; plain stand-ins if one fails to load)
   ================================================================ */
async function loadModule(path, needs){
  let m;
  try { m = await import(path); for (const n of needs) if (typeof m[n] !== 'function') throw new Error('missing ' + n); }
  catch (e){ console.warn('[undercroft] using stand-in models for', path, e.message); return stubs; }
  // if one model ever throws, use its stand-in rather than stop the game
  const safe = {};
  for (const n of Object.keys(m)) safe[n] = typeof m[n] !== 'function' ? m[n] : (...args) => {
    try { return m[n](...args); } catch (e){ console.warn('[undercroft] stand-in for', n, e.message); return stubs[n](...args); } };
  return safe;
}
let props, beastMod, peopleKit, mats;

/* ================================================================
   PARTICLES: one additive system (sparks, embers, magic, frost) and one ordinary one (blood, barf, dust, smoke)
   ================================================================ */
function particleSystem(max, additive){
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(max * 3), col = new Float32Array(max * 3), size = new Float32Array(max), alpha = new Float32Array(max);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1)); geo.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: !additive,
    uniforms: Object.assign({ scale: { value: innerHeight } }, additive ? {} : THREE.UniformsUtils.clone(THREE.UniformsLib.fog)),
    vertexShader: `attribute vec3 color; attribute float size; attribute float alpha; varying vec3 vC; varying float vA; uniform float scale;
      #include <fog_pars_vertex>
      void main(){ vC = color; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        // fade out anything right in front of the lens, and never let one point fill the screen
        vA = alpha * smoothstep(0.35, 1.1, -mvPosition.z);
        gl_PointSize = min(scale * size / -mvPosition.z, scale * 0.09); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `varying vec3 vC; varying float vA;
      #include <fog_pars_fragment>
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * vA;
        if (a < 0.01) discard; gl_FragColor = vec4(vC * ${additive ? 'a' : '1.0'}, ${additive ? '1.0' : 'a'});
        #include <fog_fragment>
      }`
  });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; scene.add(pts);
  const p = { pts, geo, pos, col, size, alpha, vel: new Float32Array(max * 3), life: new Float32Array(max), max0: new Float32Array(max),
    grav: new Float32Array(max), drag: new Float32Array(max), next: 0, max };
  return p;
}
const glow = particleSystem(700, true), gunk = particleSystem(700, false);
function emit(sys, x, y, z, vx, vy, vz, life, size, r, g, b, grav, drag){
  const k = sys.next; sys.next = (sys.next + 1) % sys.max;
  sys.pos[k * 3] = x; sys.pos[k * 3 + 1] = y; sys.pos[k * 3 + 2] = z;
  sys.vel[k * 3] = vx; sys.vel[k * 3 + 1] = vy; sys.vel[k * 3 + 2] = vz;
  sys.life[k] = sys.max0[k] = life; sys.size[k] = size; sys.col[k * 3] = r; sys.col[k * 3 + 1] = g; sys.col[k * 3 + 2] = b;
  sys.grav[k] = grav === undefined ? 0 : grav; sys.drag[k] = drag === undefined ? 0 : drag;
}
function updateParticles(sys, dt){
  for (let k = 0; k < sys.max; k++){
    if (sys.life[k] <= 0){ sys.alpha[k] = 0; continue; }
    sys.life[k] -= dt;
    const d = Math.exp(-sys.drag[k] * dt);
    sys.vel[k * 3] *= d; sys.vel[k * 3 + 2] *= d; sys.vel[k * 3 + 1] = sys.vel[k * 3 + 1] * d - sys.grav[k] * dt;
    sys.pos[k * 3] += sys.vel[k * 3] * dt; sys.pos[k * 3 + 1] += sys.vel[k * 3 + 1] * dt; sys.pos[k * 3 + 2] += sys.vel[k * 3 + 2] * dt;
    if (sys.pos[k * 3 + 1] < 0.01 && sys.grav[k] > 0){ sys.pos[k * 3 + 1] = 0.01; sys.vel[k * 3] *= 0.5; sys.vel[k * 3 + 1] = 0; sys.vel[k * 3 + 2] *= 0.5; }
    const f = sys.life[k] / sys.max0[k];
    sys.alpha[k] = Math.min(1, f * 3);
  }
  for (const a of ['position', 'color', 'size', 'alpha']) sys.geo.attributes[a].needsUpdate = true;
}
const R = Math.random;
function burst(kind, p, n, dir){
  for (let k = 0; k < n; k++){
    const a = R() * Math.PI * 2, s = R();
    if (kind === 'blood') emit(gunk, p.x, p.y, p.z, (dir ? dir.x * 2 : 0) + Math.cos(a) * 1.5 * s, 1 + R() * 2, (dir ? dir.z * 2 : 0) + Math.sin(a) * 1.5 * s, 0.6 + R() * 0.5, 0.025 + R() * 0.03, 0.18, 0.01, 0.0, 9.8, 0.5);
    else if (kind === 'spark') emit(glow, p.x, p.y, p.z, Math.cos(a) * 4 * s, R() * 3, Math.sin(a) * 4 * s, 0.2 + R() * 0.3, 0.015, 3, 1.6, 0.6, 9.8, 1);
    else if (kind === 'fire'){ const h = R();   // a hot core fading through orange to dull red, small flecks rather than balls
      emit(glow, p.x + (R() - 0.5) * 0.3, p.y + (R() - 0.5) * 0.3, p.z + (R() - 0.5) * 0.3, Math.cos(a) * 7 * s, (R() - 0.2) * 6, Math.sin(a) * 7 * s,
        0.15 + R() * 0.35, 0.03 + R() * 0.05, 1.6 + h, 0.45 + h * 0.6, 0.08 + h * 0.15, -1.5, 4); }
    else if (kind === 'smoke') emit(gunk, p.x, p.y, p.z, Math.cos(a) * 3 * s, 0.5 + R() * 2, Math.sin(a) * 3 * s, 1.5 + R() * 1.5, 0.4 + R() * 0.5, 0.06, 0.055, 0.05, -0.3, 1.5);
    else if (kind === 'dust') emit(gunk, p.x, p.y, p.z, Math.cos(a) * 2.5 * s, R() * 1.2, Math.sin(a) * 2.5 * s, 1 + R(), 0.25 + R() * 0.3, 0.16, 0.14, 0.12, 0.3, 2);
    else if (kind === 'barf') emit(gunk, p.x, p.y, p.z, dir.x * (3 + R() * 3) + (R() - 0.5), dir.y * 3 + R(), dir.z * (3 + R() * 3) + (R() - 0.5), 0.9 + R() * 0.4, 0.06 + R() * 0.06, 0.12, 0.16, 0.03, 9.8, 0.3);
    else if (kind === 'frost') emit(glow, p.x + (R() - 0.5) * 2.4, p.y + R() * 0.3, p.z + (R() - 0.5) * 2.4, 0, 0.3 + R() * 0.6, 0, 0.8 + R(), 0.03, 0.5, 0.8, 1.2, 0, 1);
    else if (kind === 'magic') emit(glow, p.x + (R() - 0.5) * 0.6, p.y + R() * 1.5, p.z + (R() - 0.5) * 0.6, (R() - 0.5), 0.5 + R(), (R() - 0.5), 0.8 + R() * 0.6, 0.03, dir.r * 2, dir.g * 2, dir.b * 2, -0.5, 1);
    else if (kind === 'ember') emit(glow, p.x + (R() - 0.5) * 0.05, p.y + 0.05, p.z + (R() - 0.5) * 0.05, (R() - 0.5) * 0.3, 0.4 + R() * 0.6, (R() - 0.5) * 0.3, 0.6 + R() * 0.8, 0.012, 2.4, 1.0, 0.25, -0.2, 0);
  }
}
// dust drifting through the torchlight
const DUST = 500, DUSTBOX = 7;
const dustPos = new Float32Array(DUST * 3); for (let k = 0; k < DUST * 3; k++) dustPos[k] = Math.random() * DUSTBOX;
const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dustMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  uniforms: { origin: { value: new THREE.Vector3() }, light: { value: new THREE.Vector3() }, time: flameUniforms.time, scale: { value: innerHeight } },
  vertexShader: `uniform vec3 origin; uniform vec3 light; uniform float time; uniform float scale; varying float vB;
    void main(){ vec3 p = position;
      p.x += sin(time * 0.13 + position.y * 3.0) * 0.3; p.y += time * -0.02; p.z += cos(time * 0.11 + position.x * 2.0) * 0.3;
      p = mod(p - origin, ${DUSTBOX.toFixed(1)}) + origin - ${(DUSTBOX / 2).toFixed(1)};
      float d = distance(p, light); vB = 1.0 / (1.0 + d * d * 0.9);
      vec4 mv = viewMatrix * vec4(p, 1.0); gl_PointSize = scale * 0.006 / -mv.z; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `varying float vB; void main(){ float a = smoothstep(0.5, 0.1, length(gl_PointCoord - 0.5)); gl_FragColor = vec4(vec3(1.0, 0.75, 0.5) * a * vB * 0.55, 1.0); }`
});
const dust = new THREE.Points(dustGeo, dustMat); dust.frustumCulled = false; scene.add(dust);

// decals: scorch marks, barf puddles, blood on the floor
const decalTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 4, 64, 64, 62); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.6, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; for (let k = 0; k < 9; k++){ x.beginPath(); x.arc(64 + (Math.random() - 0.5) * 50, 64 + (Math.random() - 0.5) * 50, 14 + Math.random() * 24, 0, 7); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
const decals = [];
function decal(x, z, size, color, life, rough){
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: decalTex, color, transparent: true, depthWrite: false, roughness: rough === undefined ? 0.4 : rough, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.position.set(x, 0.015 + decals.length * 0.0005 % 0.01, z); m.rotation.y = Math.random() * 6; m.receiveShadow = true;
  scene.add(m); decals.push({ m, life, max: life });
  if (decals.length > 30){ const d = decals.shift(); scene.remove(d.m); d.m.geometry.dispose(); d.m.material.dispose(); }
}

/* ================================================================
   GAME STATE
   ================================================================ */
let state = 'loading';
let levelNo = 1, seed = params.has('seed') ? (parseInt(params.get('seed'), 10) || 1) : (TEST ? 1 : (Math.random() * 1e9) | 0);
let lv = null, world = null, simTime = 0, playTime = 0;
let shrine = null, shrineGate = null, trans = null;   // the shrine you're in, the gate it belongs to, a fade in progress
const player = { x: 0, z: 0, y: EYE, yaw: 0, pitch: 0, bob: 0, speed: 0, vx: 0, vz: 0, kx: 0, kz: 0, hurry: false,
  hp: MAX_HP, invuln: 0, hurt: 0, shake: 0, dying: 0, cause: '' };
const inv = { weapons: { sword: true }, weapon: 'sword', powers: [], power: -1, food: { apple: 0, bread: 0, cheese: 0, drumstick: 0 }, bolts: 0 };
const pw = { bomb: null, bombCool: 0, shieldT: 0, shieldCool: 0, magnet: false, magnetT: 0 };
const stats = { slain: 0, eaten: 0, freed: 0 };
let snapshot = null;                              // what you carried into this level, for trying again
const zombies = [], bolts = [], prisoners = [];
let beast = null;
let tileType, tileAt, solidAt, walkableZ, frozenAt;

function tt(i, j){ return (i < 0 || j < 0 || i >= lv.W || j >= lv.W) ? T.ROCK : lv.g[j * lv.W + i]; }
tileType = tt;
tileAt = (x, z) => tt(Math.floor(x / TILE), Math.floor(z / TILE));
frozenAt = (i, j) => { const w = world.water.get(j * lv.W + i); return !!(w && w.frozenUntil > simTime); };
// what stops you walking: rock, cells, the cracked wall until it's blown, the stairs until the gate is up
solidAt = (x, z) => {
  if (shrine) return !shrine.contains(x, z);
  const i = Math.floor(x / TILE), j = Math.floor(z / TILE), t = tt(i, j);
  return t === T.ROCK || t === T.CELL || t === T.CRACKED || (t === T.STAIRS && !world.portcullis.open);
};
// where zombies can go
walkableZ = (t, i, j) => t === T.FLOOR || t === T.HALL || (t === T.WATER && frozenAt(i, j));
function floorAt(x, z){
  if (shrine) return shrine.floorAt(x, z);
  const i = Math.floor(x / TILE), j = Math.floor(z / TILE), t = tt(i, j);
  if (t === T.LANDING) return STAIR_RISE;
  if (t === T.WATER) return frozenAt(i, j) ? -0.1 : -0.6;
  if (t !== T.STAIRS) return 0;
  const [sx, sz] = lv.exit.stairs, [dx, dz] = lv.exit.dir;
  const along = dx ? (x / TILE - sx) : (z / TILE - sz), p = (dx + dz) > 0 ? along : 1 - along;
  return (Math.min(7, Math.max(0, Math.floor(p * 8))) + 1) * STAIR_RISE / 8;
}
function lineOfSight(ax, az, bx, bz){
  if (shrine) return true;
  const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / 0.25);
  for (let k = 1; k < n; k++){ const s = k / n, x = ax + (bx - ax) * s, z = az + (bz - az) * s;
    const t = tileAt(x, z); if (t === T.ROCK || t === T.CRACKED || t === T.CELL) return false;
    for (const p of world.pillars) if (Math.hypot(x - p.x, z - p.z) < p.r * 0.8) return false; }
  return true;
}
// push a circle out of rock, pillars and furniture
function collideCircle(o, r){
  if (shrine){ shrine.collide(o, r); return; }
  const i0 = Math.floor((o.x - r) / TILE), i1 = Math.floor((o.x + r) / TILE), j0 = Math.floor((o.z - r) / TILE), j1 = Math.floor((o.z + r) / TILE);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++){
    if (!solidAt((i + 0.5) * TILE, (j + 0.5) * TILE)) continue;
    const nx = Math.max(i * TILE, Math.min(o.x, (i + 1) * TILE)), nz = Math.max(j * TILE, Math.min(o.z, (j + 1) * TILE));
    const dx = o.x - nx, dz = o.z - nz, d = Math.hypot(dx, dz);
    if (d < r && d > 1e-6){ o.x = nx + dx / d * r; o.z = nz + dz / d * r; }
    else if (d <= 1e-6){ o.x += 0.01; }
  }
  for (const p of world.pillars.concat(world.decor)){
    const dx = o.x - p.x, dz = o.z - p.z, d = Math.hypot(dx, dz), m = p.r + r;
    if (d < m && d > 1e-6){ o.x = p.x + dx / d * m; o.z = p.z + dz / d * m; }
  }
}

/* ================================================================
   THE LEVEL
   ================================================================ */
const levelRoot = new THREE.Group(); scene.add(levelRoot);
let distField = null, distTimer = 0;

function buildLevel(){
  // clear the old one
  for (const c of [...levelRoot.children]){ levelRoot.remove(c); }
  for (const b of bolts) scene.remove(b.o);
  if (pw.bomb) scene.remove(pw.bomb.m.group);
  for (const d of debris) scene.remove(d.o);
  zombies.length = 0; bolts.length = 0; prisoners.length = 0; debris.length = 0; beast = null;
  for (const p of firePatches) levelRoot.remove(p.f); firePatches.length = 0;
  for (const d of decals){ scene.remove(d.m); } decals.length = 0;
  pw.bomb = null; pw.bombCool = 0; pw.shieldT = 0; pw.shieldCool = 0;
  lv = generateLevel(seed, levelNo);
  world = buildWorld(lv, mats, props, env);
  shrine = null; shrineGate = null; trans = null; grade.uniforms.fade.value = 0;
  world.gates.forEach((g, k) => { g.shrine = buildShrine(g.kind, k, { mats, props, env, makeFlame, seed }); levelRoot.add(g.shrine.group); });
  levelRoot.add(world.group);
  exitLight.position.copy(world.exitLight.pos); exitLight.target.position.copy(world.exitLight.target); exitGlow.position.copy(world.exitLight.glow);
  // prisoners in their cells, some sitting, some at the bars
  world.cells.forEach((c, k) => {
    const p = peopleKit.makePrisoner(seed * 13 + k * 7 + 1);
    const [dx, dz] = c.dir, atBars = k % 2 === 0;
    const pos = atBars ? c.door.clone().addScaledVector(new THREE.Vector3(dx, 0, dz), 0.33) : c.pos.clone().addScaledVector(new THREE.Vector3(dx, 0, dz), 0.55);
    if (!atBars) pos.add(new THREE.Vector3(-dz, 0, dx).multiplyScalar(0.5));
    p.group.position.copy(pos); p.group.rotation.y = Math.atan2(-dx, -dz);
    levelRoot.add(p.group);
    prisoners.push({ m: p, cell: c, pose: atBars ? 'bars' : 'sit', t: 0, state: 'caged', home: pos.clone() });
  });
  // zombies waiting in the dark
  lv.zombies.forEach((z, k) => {
    const [x, zz] = center(z.tile[0], z.tile[1]);
    if (k % 3 === 2) for (let m = 0; m < 3; m++) spawnZombie(x + (m - 1) * 0.6, zz + (m % 2) * 0.5, false, true);   // a pack of little ones
    else spawnZombie(x, zz, false);
  });
  // the monster in its hall
  const b = beastMod.createBeast({ env });
  const [hx, hz] = center(lv.hall.centre[0], lv.hall.centre[1]);
  b.group.position.set(hx, 0, hz); levelRoot.add(b.group);
  b.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  beast = { m: b, x: hx, z: hz, yaw: 0, hp: 40, max: 40, state: 'idle', t: 0, aware: false, vy: 0, y: 0, from: null, to: null,
    cd: { fire: 3, barf: 6, leap: 5, touch: 0 }, s: { speed: 0, crouch: 0, airborne: 0, flap: 0, aimYaw: 0, aimPitch: 0, mouth: 0, eyeGlow: 0, hurt: 0, dead: 0 },
    wander: null, dead: false, roarT: 0 };
  // the player
  const [sx, sz] = center(lv.start[0], lv.start[1]);
  Object.assign(player, { x: sx, z: sz, y: EYE, pitch: 0, vx: 0, vz: 0, kx: 0, kz: 0, hp: player.hp, invuln: 0, hurt: 0, dying: 0 });
  player.yaw = Math.atan2(-lv.startDir[0], -lv.startDir[1]);
  stats.freed = 0; playTime = 0; distField = null;
  updateHud(); placeCamera(0); updateWorld(0.016);
}

/* ================================================================
   ZOMBIES
   ================================================================ */
let zSeed = 1;
// mini zombies: knee-high, quick, one hit kills them, but they come in packs
const MINI = 0.55;
function spawnZombie(x, z, emerging, mini){
  const m = peopleKit.makeZombie(seed * 31 + (zSeed++) * 17);
  m.group.position.set(x, 0, z); levelRoot.add(m.group);
  if (mini) m.group.scale.setScalar(MINI * (0.9 + Math.random() * 0.2));
  const zb = { m, x, z, mini: !!mini, yaw: Math.random() * 6, hp: mini ? 1 : 3, state: emerging ? 'emerge' : 'idle', t: 0, vx: 0, vz: 0, speed: 0,
    s: { speed: 0, attack: 0, hurt: 0, dead: 0, emerge: emerging ? 0 : 1 }, aware: !!emerging, groanT: 2 + Math.random() * 6, hitDone: false, stun: 0 };
  zombies.push(zb); return zb;
}
function updateDistField(dt){
  distTimer -= dt;
  if (distField && distTimer > 0) return;
  distTimer = 0.3;
  const pi = Math.floor(player.x / TILE), pj = Math.floor(player.z / TILE);
  distField = bfs(lv, [pi, pj], (t, i, j) => walkableZ(t, i, j) || t === T.STAIRS);
}
function zombieUpdate(z, dt){
  const s = z.s;
  s.hurt = Math.max(0, s.hurt - dt * 3);
  z.stun = Math.max(0, z.stun - dt);
  if (z.state === 'dead'){
    z.t += dt; s.dead = Math.min(1, z.t / 1.2);
    if (z.t > 6){ z.m.group.position.y -= dt * 0.25; if (z.t > 9){ levelRoot.remove(z.m.group); z.gone = true; } }
    z.m.update(dt, s); return;
  }
  if (z.state === 'emerge'){
    z.t += dt; s.emerge = Math.min(1, z.t / 2.2);
    if (z.t > 2.2){ z.state = 'chase'; z.t = 0; }
    z.m.group.position.set(z.x, 0, z.z); z.m.group.rotation.y = z.yaw; z.m.update(dt, s); return;
  }
  const dx = player.x - z.x, dz = player.z - z.z, d = Math.hypot(dx, dz);
  // notice you: close, or in sight, or hurrying nearby
  if (!z.aware && player.dying === 0){
    if (d < 4.5 || (d < 14 && lineOfSight(z.x, z.z, player.x, player.z)) || (player.hurry && d < 9)){ z.aware = true; (z.mini ? sfx.miniGroan : sfx.zombieGroan)([z.x, 1.6, z.z]); }
  }
  if (z.aware && d > 32) z.aware = false;
  let want = 0, tx = z.x, tz = z.z;
  if (z.state === 'attack'){
    const dur = z.mini ? 0.7 : 1.0;
    z.t += dt; s.attack = Math.min(1, z.t / dur);
    if (!z.hitDone && z.t > dur / 2){ z.hitDone = true; if (d < (z.mini ? 1.2 : 1.7) && player.dying === 0) hurtPlayer(1, z.mini ? 'a little zombie' : 'a zombie', z.x, z.z); }
    if (z.t > dur){ z.state = 'chase'; s.attack = 0; }
  } else if (z.aware && z.stun <= 0 && player.dying === 0){
    if (d < (z.mini ? 0.95 : 1.25)){ z.state = 'attack'; z.t = 0; z.hitDone = false; (z.mini ? sfx.miniGroan : sfx.zombieAttack)([z.x, 1.0, z.z]); }
    else {
      want = z.mini ? 2.3 : 1.35;
      // straight at you when it can see you and you're close; otherwise follow the walking-distance field downhill
      if (d < 5 && lineOfSight(z.x, z.z, player.x, player.z)){ tx = player.x; tz = player.z; }
      else if (distField){
        const i = Math.floor(z.x / TILE), j = Math.floor(z.z / TILE), here = distField[j * lv.W + i];
        let best = here, bi = i, bj = j;
        for (const [ax, az] of DIRS){ const v = distField[(j + az) * lv.W + i + ax]; if (v >= 0 && (best < 0 || v < best)){ best = v; bi = i + ax; bj = j + az; } }
        [tx, tz] = center(bi, bj);
        if (bi === i && bj === j){ tx = player.x; tz = player.z; }
      }
    }
  } else if (!z.aware){
    // shuffle about a little
    z.t += dt;
    if (!z.wander || z.t > 5){ z.t = 0; const a = Math.random() * 6; z.wander = [z.x + Math.cos(a) * 1.2, z.z + Math.sin(a) * 1.2]; }
    tx = z.wander[0]; tz = z.wander[1]; want = 0.35;
  }
  if (z.stun > 0) want = 0;
  const ex = tx - z.x, ez = tz - z.z, el = Math.hypot(ex, ez);
  if (el > 0.1 && want > 0){
    const ty = Math.atan2(ex, ez);
    let dy = ty - z.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    z.yaw += dy * Math.min(1, dt * 4);
    z.speed += (want - z.speed) * Math.min(1, dt * 3);
  } else z.speed *= Math.exp(-dt * 5);
  if (z.state === 'attack'){ const ty = Math.atan2(dx, dz); let dy = ty - z.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI; z.yaw += dy * Math.min(1, dt * 6); }
  z.x += (Math.sin(z.yaw) * z.speed + z.vx) * dt; z.z += (Math.cos(z.yaw) * z.speed + z.vz) * dt;
  z.vx *= Math.exp(-dt * 6); z.vz *= Math.exp(-dt * 6);
  // keep apart from each other and from you
  for (const o of zombies){ if (o === z || o.state === 'dead') continue; const ax = z.x - o.x, az = z.z - o.z, ad = Math.hypot(ax, az);
    const sep = z.mini && o.mini ? 0.42 : 0.7;
    if (ad < sep && ad > 1e-4){ z.x += ax / ad * (sep - ad) * 0.5; z.z += az / ad * (sep - ad) * 0.5; } }
  const keep = z.mini ? 0.6 : 0.75;
  if (d < keep && d > 1e-4){ z.x -= dx / d * (keep - d); z.z -= dz / d * (keep - d); }
  const c = { x: z.x, z: z.z }; collideCircle(c, z.mini ? 0.2 : 0.3); z.x = c.x; z.z = c.z;
  // never into deep water
  const i = Math.floor(z.x / TILE), j = Math.floor(z.z / TILE);
  if (tt(i, j) === T.WATER && !frozenAt(i, j)){ z.x -= Math.sin(z.yaw) * z.speed * dt * 1.5; z.z -= Math.cos(z.yaw) * z.speed * dt * 1.5; }
  if (z.aware && (z.groanT -= dt) < 0){ z.groanT = 3 + Math.random() * 6; (z.mini ? sfx.miniGroan : sfx.zombieGroan)([z.x, 1.6, z.z]); }
  s.speed = z.mini ? Math.min(2.5, z.speed / MINI) : z.speed;
  z.m.group.position.set(z.x, floorAt(z.x, z.z) > 0 ? floorAt(z.x, z.z) : 0, z.z); z.m.group.rotation.y = z.yaw;
  z.m.update(dt, s);
}
function hurtZombie(z, dmg, from, knock){
  if (z.state === 'dead' || z.state === 'emerge' && z.s.emerge < 0.5) return false;
  z.hp -= dmg; z.s.hurt = 1; z.aware = true; z.stun = 0.35;
  const dx = z.x - from.x, dz = z.z - from.z, d = Math.hypot(dx, dz) || 1;
  z.vx += dx / d * knock; z.vz += dz / d * knock;
  const p = new THREE.Vector3(z.x, 1.3, z.z);
  burst('blood', p, 18, new THREE.Vector3(dx / d, 0, dz / d)); sfx.hitFlesh([z.x, 1.3, z.z]);
  if (Math.random() < 0.6) decal(z.x + dx / d * 0.5, z.z + dz / d * 0.5, 0.5 + Math.random() * 0.4, 0x2a0202, 40, 0.25);
  if (z.hp <= 0){ z.state = 'dead'; z.t = 0; z.s.attack = 0; stats.slain++; (z.mini ? sfx.miniDie : sfx.zombieDie)([z.x, 1.4, z.z]); if (z.state === 'attack') z.s.attack = 0; }
  else if (z.state === 'attack'){ z.state = 'chase'; z.s.attack = 0; }
  return true;
}

/* ================================================================
   THE MONSTER
   It never leaves its hall (far too tall for the corridors). Fire and zombies from its mouth,
   leaps on its spring feet, spikes on its wings.
   ================================================================ */
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
const jetDir = new THREE.Vector3(), jetFrom = new THREE.Vector3();
const firePatches = [];      // burning puddles of fire left on the floor
const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.42, 0.35), transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide });
const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 48).rotateX(-Math.PI / 2), ringMat); ring.visible = false; scene.add(ring);
let ringT = 0;

function hallBounds(inset){ const x0 = lv.hall.x0 * TILE + inset, x1 = (lv.hall.x1 + 1) * TILE - inset; return [x0, x1]; }
function inHall(x, z, margin){ const [a, b] = hallBounds(-(margin || 0)); return x > a && x < b && z > a && z < b; }
function beastUpdate(dt){
  const b = beast, s = b.s; if (!b) return;
  s.hurt = Math.max(0, s.hurt - dt * 3);
  for (const k in b.cd) b.cd[k] = Math.max(0, b.cd[k] - dt);
  if (b.dead){ b.t += dt; s.dead = Math.min(1, b.t / 2.5); s.speed = 0; s.flap *= 0.95; s.eyeGlow = 0; s.mouth *= 0.95; b.m.update(dt, s); return; }
  const dx = player.x - b.x, dz = player.z - b.z, d = Math.hypot(dx, dz);
  const head = b.m.eyes[0].getWorldPosition(tmp);
  const sees = player.dying === 0 && (inHall(player.x, player.z, 2.5) || (d < 24 && lineOfSight(b.x, b.z, player.x, player.z))) && lineOfSight(b.x, b.z, player.x, player.z);
  if (sees && !b.aware){ b.aware = true; sfx.roar([b.x, 5, b.z]); hint('THE MONSTER HAS SEEN YOU', 3); }
  if (b.aware && !inHall(player.x, player.z, 6) && !sees) b.aware = false;
  // turn to face you (or where it's wandering)
  const faceTo = (tx, tz, rate) => { const ty = Math.atan2(tx - b.x, tz - b.z); let dy = ty - b.yaw;
    while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI; b.yaw += Math.max(-rate * dt, Math.min(rate * dt, dy)); return Math.abs(dy); };
  let speed = 0;
  b.t += dt;
  switch (b.state){
    case 'idle': {
      if (!b.wander || Math.hypot(b.wander[0] - b.x, b.wander[1] - b.z) < 0.8){ const [a, c] = hallBounds(3); b.wander = [a + Math.random() * (c - a), a + Math.random() * (c - a)]; }
      if (b.aware){ b.state = 'stalk'; b.t = 0; break; }
      faceTo(b.wander[0], b.wander[1], 0.8); speed = 1.1;
      break;
    }
    case 'stalk': {
      if (!b.aware){ b.state = 'idle'; break; }
      const off = faceTo(player.x, player.z, 1.6);
      if (d > 7) speed = 2.2;
      // pick an attack
      if (off < 0.4 && d < 4.5 && b.cd.touch <= 0){ /* the spikes handle close range below */ }
      if (b.cd.leap <= 0 && d > 5 && d < 15 && inHall(player.x, player.z, 1)){ b.state = 'crouch'; b.t = 0; break; }
      if (b.cd.fire <= 0 && d < 12 && off < 0.5){ b.state = 'inhale'; b.t = 0; sfx.inhale([b.x, 5, b.z]); break; }
      if (b.cd.barf <= 0 && zombies.filter((z) => z.state !== 'dead').length < 8 && off < 0.6){ b.state = 'barf'; b.t = 0; sfx.barf([b.x, 4, b.z]); break; }
      break;
    }
    case 'inhale': {
      // a deep breath, embers glowing in its throat: the warning to get out of the way
      faceTo(player.x, player.z, 2.0);
      s.mouth = Math.min(0.5, b.t / 0.7 * 0.5); s.eyeGlow = Math.min(0.6, b.t);
      if (Math.random() < 0.6) burst('ember', b.m.mouth.getWorldPosition(tmp2), 1);
      if (b.t > 0.8){
        b.state = 'breathe'; b.t = 0; sfx.fireBreath([b.x, 4, b.z]);
        b.m.mouth.getWorldPosition(jetFrom);
        jetDir.set(player.x, player.y - 0.7, player.z).sub(jetFrom).normalize();
      }
      break;
    }
    case 'breathe': {
      // a jet of fire that swings after you, slowly enough to dodge
      faceTo(player.x, player.z, 0.7);
      s.mouth = 1; s.eyeGlow = 0.6;
      breathFire(dt);
      if (b.t > 1.9){ b.state = 'stalk'; b.cd.fire = 4.5 + Math.random() * 2.5; s.eyeGlow = 0; }
      break;
    }
    case 'barf': {
      faceTo(player.x, player.z, 1.0);
      s.mouth = Math.min(1, b.t / 0.5);
      if (b.t > 0.5 && b.t < 1.6){
        const mouth = b.m.mouth.getWorldPosition(tmp2);
        const dir = tmp.set(Math.sin(b.yaw), -0.35, Math.cos(b.yaw)).normalize();
        burst('barf', mouth, 6, dir);
      }
      if (b.t > 1.0 && !b.barfed){
        b.barfed = true;
        // two zombies, or a litter of three little ones
        const minis = Math.random() < 0.5, room = 8 - zombies.filter((z) => z.state !== 'dead').length;
        const n = Math.min(minis ? 3 : 2, Math.max(0, room));
        for (let k = 0; k < n; k++){
          const a = b.yaw + (k - (n - 1) / 2) * 0.6, r = 4 + Math.random();
          let x = b.x + Math.sin(a) * r, z = b.z + Math.cos(a) * r;
          const c = { x, z }; collideCircle(c, 0.4); x = c.x; z = c.z;
          const nz = spawnZombie(x, z, true, minis); nz.yaw = b.yaw + Math.PI;
          decal(x, z, minis ? 1.0 : 1.6, 0x2a3a06, 25, 0.08);
        }
      }
      if (b.t > 2.0){ s.mouth = 0; b.barfed = false; b.state = 'stalk'; b.cd.barf = 12 + Math.random() * 5; }
      break;
    }
    case 'crouch': {
      faceTo(player.x, player.z, 2.5);
      s.crouch = Math.min(1, b.t / 0.6);
      if (b.t > 0.6){
        const [a, c] = hallBounds(2.6);
        b.from = [b.x, b.z]; b.to = [Math.max(a, Math.min(c, player.x)), Math.max(a, Math.min(c, player.z))];
        b.state = 'leap'; b.t = 0; s.crouch = 0; sfx.boing([b.x, 1, b.z]);
      }
      break;
    }
    case 'leap': {
      const f = Math.min(1, b.t / 0.9);
      b.x = b.from[0] + (b.to[0] - b.from[0]) * f; b.z = b.from[1] + (b.to[1] - b.from[1]) * f;
      b.y = Math.sin(f * Math.PI) * 2.6; s.airborne = Math.sin(f * Math.PI); s.flap = 1; speed = 8;
      if (f >= 1){
        b.y = 0; s.airborne = 0; b.state = 'land'; b.t = 0; sfx.stomp([b.x, 0.5, b.z]); player.shake = Math.max(player.shake, 0.6);
        ring.visible = true; ring.position.set(b.x, 0.05, b.z); ringT = 0;
        burst('dust', new THREE.Vector3(b.x, 0.2, b.z), 40);
        if (Math.hypot(player.x - b.x, player.z - b.z) < 3.8) hurtPlayer(2, 'the monster', b.x, b.z, 9);
      }
      break;
    }
    case 'land': {
      s.flap = Math.max(0, 1 - b.t * 2); s.crouch = Math.max(0, 0.6 - b.t);
      if (b.t > 0.8){ b.state = 'stalk'; b.cd.leap = 7 + Math.random() * 4; }
      break;
    }
  }
  if (b.state !== 'inhale' && b.state !== 'breathe') s.eyeGlow = Math.max(0, s.eyeGlow - dt * 3);
  if (b.state !== 'barf' && b.state !== 'inhale' && b.state !== 'breathe') s.mouth = Math.max(0, s.mouth - dt * 2);
  if (b.state !== 'leap' && b.state !== 'land') s.flap = Math.max(b.aware ? 0.15 : 0, s.flap - dt);
  // walk, staying inside the hall and clear of the pillars
  if (speed > 0 && b.state !== 'leap'){ b.x += Math.sin(b.yaw) * speed * dt; b.z += Math.cos(b.yaw) * speed * dt; }
  const [a, c] = hallBounds(2.4); b.x = Math.max(a, Math.min(c, b.x)); b.z = Math.max(a, Math.min(c, b.z));
  if (b.state !== 'leap') for (const p of world.pillars){ const ex = b.x - p.x, ez = b.z - p.z, ed = Math.hypot(ex, ez); if (ed < 2.0 && ed > 1e-4){ b.x = p.x + ex / ed * 2.0; b.z = p.z + ez / ed * 2.0; } }
  s.speed += (speed - s.speed) * Math.min(1, dt * 4);
  // aim the head at you
  const rel = Math.atan2(dx, dz) - b.yaw;
  s.aimYaw = Math.max(-0.8, Math.min(0.8, Math.atan2(Math.sin(rel), Math.cos(rel))));
  s.aimPitch = Math.max(-0.9, Math.min(0.3, -Math.atan2(head.y - 1.4, Math.max(1, d))));
  // spikes and bulk: being right up against it hurts
  if (player.dying === 0){
    b.m.group.updateMatrixWorld(true);
    for (const p of b.m.parts){
      if (p.kind !== 'wing' && p.kind !== 'body' && p.kind !== 'leg') continue;
      const w = p.object.getWorldPosition(tmp2);
      if (w.y - p.radius > 2.0) continue;
      const hd = Math.hypot(player.x - w.x, player.z - w.z);
      if (hd < p.radius + RADIUS){
        const k = (p.radius + RADIUS - hd) / Math.max(hd, 1e-3);
        player.x += (player.x - w.x) * k; player.z += (player.z - w.z) * k;
        if (b.cd.touch <= 0 && (p.kind === 'wing' || b.state === 'leap')){ b.cd.touch = 1.2; hurtPlayer(2, 'the monster’s spikes', w.x, w.z, 5); }
      }
    }
    // its body is in the way
    const bd = Math.hypot(player.x - b.x, player.z - b.z);
    if (bd < 1.5 && bd > 1e-3){ player.x = b.x + (player.x - b.x) / bd * 1.5; player.z = b.z + (player.z - b.z) / bd * 1.5; }
  }
  b.m.group.position.set(b.x, b.y, b.z); b.m.group.rotation.y = b.yaw;
  b.m.update(dt, s);
}
function breathFire(dt){
  const b = beast;
  b.m.mouth.getWorldPosition(jetFrom);
  // the jet swings toward you, but slower than you can run
  tmp.set(player.x, player.y - 0.7, player.z).sub(jetFrom).normalize();
  jetDir.lerp(tmp, Math.min(1, dt * 1.1)).normalize();
  for (let k = 0; k < 16; k++){
    const sp = 9 + R() * 4, spread = 0.9 + R() * 0.6;
    const h = R();
    emit(glow, jetFrom.x, jetFrom.y, jetFrom.z, jetDir.x * sp + (R() - 0.5) * spread, jetDir.y * sp + (R() - 0.5) * spread, jetDir.z * sp + (R() - 0.5) * spread,
      0.35 + R() * 0.35, 0.05 + R() * 0.07, 1.6 + h, 0.5 + h * 0.6, 0.08 + h * 0.15, -2, 1.6);
  }
  if (R() < 0.5) burst('smoke', tmp2.copy(jetFrom).addScaledVector(jetDir, 4 + R() * 4), 1);
  // where the jet meets the floor
  const t = jetDir.y < -0.05 ? Math.min(12, -jetFrom.y / jetDir.y) : 12;
  const hit = tmp2.copy(jetFrom).addScaledVector(jetDir, t);
  flash(hit.clone().setY(1.2), 0xff7a28, 26);
  b.patchT = (b.patchT || 0) - dt;
  if (b.patchT <= 0 && hit.y < 0.5 && !solidAt(hit.x, hit.z)){
    b.patchT = 0.3;
    const f = makeFlame(0.7 + R() * 0.3); f.position.set(hit.x + (R() - 0.5) * 0.6, 0, hit.z + (R() - 0.5) * 0.6); levelRoot.add(f);
    firePatches.push({ f, x: f.position.x, z: f.position.z, t: 4 + R() * 1.5 });
    decal(hit.x, hit.z, 1.2, 0x060302, 40, 0.95);
    if (firePatches.length > 14){ const o = firePatches.shift(); levelRoot.remove(o.f); }
  }
  // standing in the jet burns
  b.burnT = (b.burnT || 0) - dt;
  if (b.burnT <= 0 && player.dying === 0){
    const px = player.x - jetFrom.x, py = (player.y - 0.6) - jetFrom.y, pz = player.z - jetFrom.z;
    const along = px * jetDir.x + py * jetDir.y + pz * jetDir.z;
    if (along > 0 && along < t + 0.5){
      const cx = px - jetDir.x * along, cy = py - jetDir.y * along, cz = pz - jetDir.z * along;
      if (Math.hypot(cx, cy, cz) < 0.5 + along * 0.1 && lineOfSight(b.x, b.z, player.x, player.z)){ b.burnT = 0.45; hurtPlayer(2, 'the monster\u2019s fire', jetFrom.x, jetFrom.z, 2); }
    }
  }
}
function updateFirePatches(dt){
  for (let k = firePatches.length - 1; k >= 0; k--){
    const p = firePatches[k]; p.t -= dt;
    p.f.scale.setScalar(Math.max(0.05, Math.min(1, p.t / 1.5)));
    if (R() < 0.15) burst('ember', p.f.position, 1);
    if (p.t <= 0){ levelRoot.remove(p.f); firePatches.splice(k, 1); continue; }
    if (Math.hypot(player.x - p.x, player.z - p.z) < 0.6 && player.y - EYE < 0.5) hurtPlayer(1, 'the burning floor', p.x, p.z, 1.5);
  }
}
function hurtBeast(dmg, at){
  const b = beast; if (!b || b.dead) return;
  b.hp -= dmg; b.s.hurt = 1; b.aware = true;
  burst('blood', at, 24); sfx.hitFlesh([at.x, at.y, at.z]);
  if (b.hp <= 0){
    b.dead = true; b.t = 0;
    sfx.roar([b.x, 4, b.z]); hint('YOU BEAT THE MONSTER', 4);
    // it drops a feast
    for (const f of ['drumstick', 'bread', 'apple']){
      const o = props.createFood(f); o.position.set(b.x + (Math.random() - 0.5) * 3, 0, b.z + (Math.random() - 0.5) * 3); levelRoot.add(o);
      world.items.push({ kind: 'food', food: f, obj: o, pos: o.position.clone(), taken: false });
    }
  } else if (Math.random() < 0.25) sfx.roar([b.x, 4, b.z]);
}

/* ================================================================
   PLAYER: hearts, food, death
   ================================================================ */
function hurtPlayer(halves, cause, fx_, fz, knock){
  if (player.invuln > 0 || player.dying > 0 || state !== 'play' || window.__uc.god) return;
  if (pw.shieldT > 0){ sfx.clang(null); player.invuln = 0.3; return; }
  player.hp = Math.max(0, player.hp - halves);
  player.invuln = 0.8; player.hurt = 1; player.shake = Math.max(player.shake, 0.35);
  if (fx_ !== undefined){ const dx = player.x - fx_, dz = player.z - fz, d = Math.hypot(dx, dz) || 1; player.kx += dx / d * (knock || 3); player.kz += dz / d * (knock || 3); }
  sfx.hurt(); updateHud();
  if (player.hp <= 0) die(cause);
}
function die(cause){ player.dying = 0.001; player.cause = cause; sfx.die(); }
function eat(kind){
  if (!kind){
    // the smallest thing that heals what's missing, or the biggest you have
    const missing = MAX_HP - player.hp;
    const have = Object.keys(FOOD).filter((k) => inv.food[k] > 0).sort((a, b) => FOOD[a].heal - FOOD[b].heal);
    kind = have.find((k) => FOOD[k].heal >= missing) || have[have.length - 1];
  }
  if (!kind || !inv.food[kind]){ hint('NO FOOD', 1.5); sfx.deny(); return false; }
  if (player.hp >= MAX_HP){ hint('YOU ARE NOT HUNGRY', 1.5); sfx.deny(); return false; }
  inv.food[kind]--; player.hp = Math.min(MAX_HP, player.hp + FOOD[kind].heal); stats.eaten++;
  sfx.eat(); hint('ATE THE ' + FOOD[kind].name.toUpperCase(), 1.6); updateHud(); return true;
}

/* ================================================================
   INPUT
   ================================================================ */
try { if ('gamepadInputEmulation' in navigator) navigator.gamepadInputEmulation = 'gamepad'; } catch (e) {}
const keys = {}, look = { dx: 0, dy: 0 };
const touch = { move: null, look: null, mx: 0, my: 0 };
const act = { attack: false, power: false, interact: false };    // held this frame
const pressed = new Set();                                         // pressed this frame
let padPrev = [];
const isTouch = () => document.body.classList.contains('touch');
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys[e.code] = true;
  const map = { Escape: 'pause', KeyP: 'pause', Tab: 'inventory', KeyI: 'inventory', KeyE: 'interact', KeyF: 'eat', KeyQ: 'power', KeyR: 'nextPower',
    Digit1: 'w0', Digit2: 'w1', Digit3: 'w2', Digit4: 'w3', Enter: 'confirm', Space: 'confirm', KeyM: 'mute',
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right', Backspace: 'back' };
  if (map[e.code]){ pressed.add(map[e.code]); if (e.code === 'Tab') e.preventDefault(); }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.l = mouse.r = false; });
const mouse = { l: false, r: false };
renderer.domElement.addEventListener('mousedown', (e) => {
  if (state !== 'play' || isTouch()) return;
  if (!document.pointerLockElement){ lockPointer(); return; }
  if (e.button === 0){ mouse.l = true; pressed.add('attack'); } if (e.button === 2){ mouse.r = true; pressed.add('power'); }
});
addEventListener('mouseup', (e) => { if (e.button === 0) mouse.l = false; if (e.button === 2) mouse.r = false; });
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('wheel', (e) => { if (state === 'play') pressed.add(e.deltaY > 0 ? 'nextWeapon' : 'prevWeapon'); }, { passive: true });
document.addEventListener('mousemove', (e) => { if (document.pointerLockElement && state === 'play'){ look.dx += e.movementX; look.dy += e.movementY; } });
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && state === 'play' && !isTouch()) pause(); });
function lockPointer(){ if (TEST || isTouch()) return; try { const p = renderer.domElement.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) {} }

// touch: a stick under the left thumb, the right side looks, buttons on the right
const stickEl = $('stick'), knobEl = $('knob');
addEventListener('touchstart', (e) => {
  document.body.classList.add('touch');
  if (state !== 'play') return;
  for (const t of e.changedTouches){
    if (t.target.closest && t.target.closest('.tbtn')) continue;
    if (t.clientX < innerWidth * 0.45 && !touch.move){
      touch.move = { id: t.identifier, x: t.clientX, y: t.clientY }; touch.mx = touch.my = 0;
      stickEl.style.left = t.clientX + 'px'; stickEl.style.top = t.clientY + 'px'; stickEl.classList.add('on');
    } else if (!touch.look) touch.look = { id: t.identifier, x: t.clientX, y: t.clientY };
  }
}, { passive: true });
addEventListener('touchmove', (e) => {
  for (const t of e.changedTouches){
    if (touch.move && t.identifier === touch.move.id){
      let dx = (t.clientX - touch.move.x) / 50, dy = (t.clientY - touch.move.y) / 50;
      const l = Math.hypot(dx, dy); if (l > 1.25){ dx *= 1.25 / l; dy *= 1.25 / l; }
      touch.mx = dx; touch.my = dy; knobEl.style.transform = `translate(${dx * 40}px, ${dy * 40}px)`;
    } else if (touch.look && t.identifier === touch.look.id){
      look.dx += (t.clientX - touch.look.x) * 1.6; look.dy += (t.clientY - touch.look.y) * 1.6;
      touch.look.x = t.clientX; touch.look.y = t.clientY;
    }
  }
}, { passive: true });
function endTouch(e){
  for (const t of e.changedTouches){
    if (touch.move && t.identifier === touch.move.id){ touch.move = null; touch.mx = touch.my = 0; stickEl.classList.remove('on'); knobEl.style.transform = ''; }
    if (touch.look && t.identifier === touch.look.id) touch.look = null;
  }
}
addEventListener('touchend', endTouch); addEventListener('touchcancel', endTouch);
const touchHeld = {};
for (const el of document.querySelectorAll('.tbtn')){
  const a = el.dataset.act;
  el.addEventListener('touchstart', (e) => { e.preventDefault(); touchHeld[a] = true; pressed.add(a); el.classList.add('down'); }, { passive: false });
  el.addEventListener('touchend', (e) => { e.preventDefault(); touchHeld[a] = false; el.classList.remove('down'); }, { passive: false });
  el.addEventListener('click', () => { if (!isTouch()) pressed.add(a); });
}
// B on an Xbox controller is "back" in the browser: keep a history entry to absorb it
history.pushState({ uc: 1 }, '');
addEventListener('popstate', () => { history.pushState({ uc: 1 }, ''); if (state === 'play') pause(); else pressed.add('back'); });

function dead(v, d){ const a = Math.abs(v); return a < d ? 0 : Math.sign(v) * (a - d) / (1 - d); }
function readPad(){
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let pad = null; for (const p of pads) if (p && p.connected !== false){ pad = p; break; }
  if (!pad) return null;
  const btn = (i) => !!(pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.5));
  const was = (i) => btn(i) && !padPrev[i];
  const out = { lx: pad.axes[0] || 0, ly: pad.axes[1] || 0, rx: pad.axes[2] || 0, ry: pad.axes[3] || 0,
    hurry: btn(10) || btn(1), attack: btn(7), power: btn(6), interact: btn(0) };
  const ll = Math.hypot(out.lx, out.ly), lk = ll > 0.15 ? (ll - 0.15) / 0.85 / ll : 0;
  out.lx *= lk; out.ly *= lk; out.rx = dead(out.rx, 0.12); out.ry = dead(out.ry, 0.12);
  const map = { 0: 'confirm', 1: 'back', 2: 'eat', 3: 'inventory', 4: 'nextPower', 5: 'nextWeapon', 6: 'power', 7: 'attack', 8: 'inventory', 9: 'pause', 12: 'up', 13: 'down', 14: 'left', 15: 'right' };
  for (const k in map) if (was(+k)) pressed.add(map[k]);
  if (was(0)) pressed.add('interact');
  // the left stick moves the menu cursor too
  const mv = Math.abs(pad.axes[0] || 0) > 0.6 ? (pad.axes[0] > 0 ? 'right' : 'left') : Math.abs(pad.axes[1] || 0) > 0.6 ? (pad.axes[1] > 0 ? 'down' : 'up') : null;
  if (mv && mv !== readPad.lastMv) pressed.add('nav-' + mv);
  readPad.lastMv = mv;
  padPrev = pad.buttons.map((b) => !!(b && (b.pressed || b.value > 0.5)));
  return out;
}

/* ================================================================
   PLAYER MOVEMENT
   ================================================================ */
function updatePlayer(dt, pad){
  let yawRate = 0, pitchRate = 0;
  if (pad){ const k = (v) => Math.sign(v) * Math.pow(Math.abs(v), 1.7); yawRate -= k(pad.rx) * 2.6; pitchRate -= k(pad.ry) * 1.9; }
  player.yaw += yawRate * dt - look.dx * 0.0022; player.pitch += pitchRate * dt - look.dy * 0.0022;
  look.dx = look.dy = 0;
  player.pitch = Math.max(-1.35, Math.min(1.35, player.pitch));
  let mx = 0, mz = 0;
  if (keys.KeyW || keys.ArrowUp) mz -= 1; if (keys.KeyS || keys.ArrowDown) mz += 1;
  if (keys.KeyA || keys.ArrowLeft) mx -= 1; if (keys.KeyD || keys.ArrowRight) mx += 1;
  if (pad){ mx += pad.lx; mz += pad.ly; }
  mx += touch.mx; mz += touch.my;
  const m = Math.hypot(mx, mz); if (m > 1){ mx /= m; mz /= m; }
  player.hurry = !!(keys.ShiftLeft || keys.ShiftRight || (pad && pad.hurry) || Math.hypot(touch.mx, touch.my) > 1.1);
  const speed = (player.hurry ? HURRY : WALK) * (inv.weapon === 'hammer' ? 0.9 : 1);
  const s = Math.sin(player.yaw), c = Math.cos(player.yaw);
  const tx = (mx * c + mz * s) * speed, tz = (-mx * s + mz * c) * speed;
  const acc = 1 - Math.exp(-dt * 9);
  player.vx += (tx - player.vx) * acc; player.vz += (tz - player.vz) * acc;
  const vx = player.vx + player.kx, vz = player.vz + player.kz;
  player.kx *= Math.exp(-dt * 7); player.kz *= Math.exp(-dt * 7);
  const steps = Math.ceil(Math.hypot(vx, vz) * dt / 0.1) || 1;
  for (let k = 0; k < steps; k++){ player.x += vx * dt / steps; player.z += vz * dt / steps; collideCircle(player, RADIUS); }
  player.speed = Math.hypot(player.vx, player.vz);
  const prev = player.bob;
  player.bob += dt * player.speed * (player.hurry ? 2.4 : 2.9);
  if (Math.floor(prev / Math.PI) !== Math.floor(player.bob / Math.PI) && player.speed > 0.4){
    const i = Math.floor(player.x / TILE), j = Math.floor(player.z / TILE);
    sfx.step(player.hurry, tt(i, j) === T.WATER);
  }
  const ground = floorAt(player.x, player.z) + EYE;
  player.y += (ground - player.y) * (1 - Math.exp(-dt * 10));
  if (shrine){
    if (shrine.inWater(player.x, player.z) && !trans){ sfx.splash(); moveTo(() => { shrine.reset(); placeAt(shrine.start); }); hint('BACK TO THE START', 1.6); }
    return;
  }
  // deep water is death
  const i = Math.floor(player.x / TILE), j = Math.floor(player.z / TILE);
  if (tt(i, j) === T.WATER && !frozenAt(i, j)){
    const [cx, cz] = center(i, j);
    if (Math.abs(player.x - cx) < TILE / 2 - 0.15 && Math.abs(player.z - cz) < TILE / 2 - 0.15 && player.dying === 0){ sfx.splash(); die('the deep water'); player.drowning = true; }
  }
}

/* ================================================================
   FIRST-PERSON HANDS: the torch in the left, the weapon in the right
   ================================================================ */
let heldTorch = null;                         // made in boot(), once the materials exist
const held = new THREE.Group(); camera.add(held);
const heldFlame = makeFlame(0.27); scene.add(heldFlame);
const weaponHolder = new THREE.Group(); camera.add(weaponHolder);
const weaponModels = {};
const swing = { t: 99, kind: 'sword', cool: 0, hit: false, raise: 1 };
// rest pose and attack animation per weapon: returns [x, y, z, rx, ry, rz] for the holder at swing time t
const POSE = {
  sword:    { rest: [0.3, -0.36, -0.52, -0.55, 0.15, -0.35], dur: 0.38,
              at: (f) => { const e = f < 0.25 ? f / 0.25 : 1 - (f - 0.25) / 0.75, k = Math.sin(Math.min(1, f / 0.3) * Math.PI / 2);
                return [0.3 - 0.45 * k + 0.45 * (f > 0.3 ? (f - 0.3) / 0.7 : 0), -0.36 - 0.1 * e, -0.52 - 0.12 * e, -0.55 - 1.0 * e, 0.15 + 0.5 * e, -0.35 + 1.8 * k - 1.8 * (f > 0.3 ? (f - 0.3) / 0.7 : 0)]; } },
  spear:    { rest: [0.26, -0.42, -0.3, -1.45, 0.05, -0.05], dur: 0.45,
              at: (f) => { const e = f < 0.3 ? f / 0.3 : 1 - (f - 0.3) / 0.7; return [0.26 - 0.12 * e, -0.42 + 0.08 * e, -0.3 - 0.55 * e, -1.45 - 0.05 * e, 0.05, -0.05]; } },
  hammer:   { rest: [0.3, -0.42, -0.5, -0.35, 0.2, -0.3], dur: 0.8,
              at: (f) => { const up = f < 0.4 ? f / 0.4 : 0, down = f < 0.4 ? 0 : Math.min(1, (f - 0.4) / 0.12), back = f < 0.6 ? 0 : (f - 0.6) / 0.4;
                const e = down * (1 - back);
                return [0.3 - 0.15 * e, -0.42 + 0.15 * up - 0.18 * e, -0.5 - 0.1 * e, -0.35 + 0.7 * up * (1 - down) - 1.5 * e, 0.2, -0.3 + 0.2 * e]; } },
  crossbow: { rest: [0.16, -0.27, -0.42, 0, 0, 0], dur: 0.5,
              at: (f) => { const e = Math.max(0, 1 - f / 0.5); return [0.16, -0.27 + 0.03 * e, -0.42 + 0.08 * e, 0.12 * e, 0, 0]; } },
};
function setWeapon(kind){
  if (!inv.weapons[kind]) return;
  inv.weapon = kind;
  for (const k in weaponModels) weaponModels[k].visible = k === kind;
  swing.raise = 0; swing.t = 99;
  updateHud();
}

function attack(){
  const W = WEAPONS[inv.weapon];
  if (swing.cool > 0 || swing.raise < 0.8) return;
  if (inv.weapon === 'crossbow'){
    if (inv.bolts <= 0){ hint('NO BOLTS LEFT', 1.5); sfx.deny(); swing.cool = 0.4; return; }
    inv.bolts--; updateHud(); sfx.crossbow();
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const o = props.createBolt({ env }); scene.add(o);
    const start = camera.position.clone().addScaledVector(dir, 0.5).add(new THREE.Vector3(0, -0.1, 0));
    o.position.copy(start); o.lookAt(start.clone().sub(dir));
    bolts.push({ o, pos: start, vel: dir.multiplyScalar(32), life: 12, stuck: false });
  } else (inv.weapon === 'spear' ? sfx.thrust : () => sfx.swing(inv.weapon === 'hammer'))();
  swing.t = 0; swing.kind = inv.weapon; swing.cool = W.cool; swing.hit = inv.weapon === 'crossbow';
}
function meleeHit(){
  const W = WEAPONS[swing.kind];
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const fh = Math.hypot(fwd.x, fwd.z) || 1;
  let any = false;
  for (const z of zombies){
    if (z.state === 'dead') continue;
    const dx = z.x - player.x, dz = z.z - player.z, d = Math.hypot(dx, dz);
    if (d > W.reach + 0.35) continue;
    const ang = Math.acos(Math.max(-1, Math.min(1, (dx * fwd.x + dz * fwd.z) / (d * fh || 1))));
    if (ang > W.arc / 2 + (d < 0.9 ? 0.6 : 0)) continue;
    if (!lineOfSight(player.x, player.z, z.x, z.z)) continue;
    if (hurtZombie(z, W.dmg, player, W.knock)) any = true;
  }
  if (beast && !beast.dead){
    for (const p of beast.m.parts){
      const w = p.object.getWorldPosition(tmp);
      const v = w.clone().sub(camera.position), d = v.length() - p.radius;
      if (d > W.reach) continue;
      const ang = v.normalize().angleTo(fwd);
      if (ang > W.arc / 2 + 0.35) continue;
      hurtBeast(W.dmg, w.clone().addScaledVector(v, -p.radius)); any = true; break;
    }
  }
  // steel on stone
  if (!any){
    const tip = camera.position.clone().addScaledVector(fwd, Math.min(W.reach, 1.8));
    if (solidAt(tip.x, tip.z) || tip.y < 0.1){ sfx.clang([tip.x, tip.y, tip.z]); burst('spark', tip, 12); }
  }
  if (any) player.shake = Math.max(player.shake, swing.kind === 'hammer' ? 0.25 : 0.1);
}
function updateBolts(dt){
  for (const b of bolts){
    if (b.stuck){ b.life -= dt; if (b.life < 0){ scene.remove(b.o); b.gone = true; } continue; }
    b.vel.y -= 2.0 * dt;
    const steps = 4;
    for (let k = 0; k < steps && !b.stuck; k++){
      b.pos.addScaledVector(b.vel, dt / steps);
      if (solidAt(b.pos.x, b.pos.z) || b.pos.y < 0.02 || b.pos.y > ceilOf(tileAt(b.pos.x, b.pos.z))){ b.stuck = true; b.life = 8; sfx.thud([b.pos.x, b.pos.y, b.pos.z]); burst('spark', b.pos, 6); break; }
      for (const z of zombies){ if (z.state === 'dead') continue;
        if (Math.hypot(b.pos.x - z.x, b.pos.z - z.z) < 0.4 && b.pos.y < 1.9){ hurtZombie(z, WEAPONS.crossbow.dmg, { x: b.pos.x - b.vel.x, z: b.pos.z - b.vel.z }, 3); b.stuck = true; b.life = 0; scene.remove(b.o); b.gone = true; break; } }
      if (!b.stuck && beast && !beast.dead) for (const p of beast.m.parts){ const w = p.object.getWorldPosition(tmp);
        if (w.distanceTo(b.pos) < p.radius){ hurtBeast(WEAPONS.crossbow.dmg, b.pos.clone()); b.stuck = true; b.life = 0; scene.remove(b.o); b.gone = true; break; } }
    }
    b.o.position.copy(b.pos); b.o.lookAt(b.pos.clone().sub(b.vel));
  }
  for (let k = bolts.length - 1; k >= 0; k--) if (bolts[k].gone) bolts.splice(k, 1);
}

/* ================================================================
   POWERS
   ================================================================ */
function currentPower(){ return inv.power >= 0 ? inv.powers[inv.power] : null; }
function usePower(pressedNow, held){
  const p = currentPower();
  pw.magnet = !!(p === 'magnet' && held);
  if (!pressedNow) return;
  if (!p){ hint('NO POWER YET — FIND A POWER GATE', 2); sfx.deny(); return; }
  if (p === 'bomb'){
    if (pw.bomb && pw.bomb.landed) explodeBomb();
    else if (!pw.bomb && pw.bombCool <= 0){
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const b = props.createBomb({ env }); scene.add(b.group);
      const pos = camera.position.clone().addScaledVector(dir, 0.6).add(new THREE.Vector3(0, -0.2, 0));
      pw.bomb = { m: b, pos, vel: new THREE.Vector3(dir.x * 6, 2.5 + dir.y * 5, dir.z * 6), landed: false, t: 0 };
      sfx.bombThrow(); hint('PRESS AGAIN TO BLOW IT UP', 2);
    } else if (pw.bombCool > 0) sfx.deny();
  } else if (p === 'freeze'){
    let n = 0;
    for (const w of world.water.values()){
      const [x, z] = center(w.i, w.j);
      if (Math.hypot(x - player.x, z - player.z) > 11) continue;
      w.frozenUntil = simTime + 45; w.warned = false; w.mesh.material = mats.ice; w.mesh.position.y = -0.08; n++;
      burst('frost', new THREE.Vector3(x, -0.05, z), 40);
    }
    sfx.freeze(); flash(new THREE.Vector3(player.x, 1, player.z), 0x8cc8ff, 8);
    hint(n ? 'THE WATER FREEZES' : 'NO WATER NEARBY', 2); distField = null;
  } else if (p === 'shield'){
    if (pw.shieldT > 0) return;
    if (pw.shieldCool > 0){ hint('SHIELD RECHARGING: ' + Math.ceil(pw.shieldCool) + 's', 1.5); sfx.deny(); return; }
    pw.shieldT = 60; sfx.shield(true); hint('NOTHING CAN HURT YOU FOR ONE MINUTE', 2.5);
  } else if (p === 'magnet') sfx.magnet(true);
}
function explodeBomb(){
  const b = pw.bomb, p = b.pos.clone(); p.y = Math.max(p.y, 0.3);
  scene.remove(b.m.group); pw.bomb = null; pw.bombCool = 2.5;
  sfx.explosion([p.x, p.y, p.z]); flash(p, 0xff8a30, 160); burst('fire', p, 220); burst('smoke', p, 50); burst('spark', p, 60); burst('dust', p, 30);
  decal(p.x, p.z, 2.4, 0x050403, 60, 0.95);
  player.shake = Math.max(player.shake, Math.max(0.15, 1 - p.distanceTo(camera.position) / 12));
  for (const z of zombies){ if (z.state !== 'dead' && Math.hypot(z.x - p.x, z.z - p.z) < 3.8) hurtZombie(z, 10, p, 8); }
  if (beast && !beast.dead) for (const part of beast.m.parts){ if (part.object.getWorldPosition(tmp).distanceTo(p) < 4 + part.radius){ hurtBeast(8, tmp.clone()); break; } }
  if (Math.hypot(player.x - p.x, player.z - p.z) < 2.6) hurtPlayer(2, 'your own bomb', p.x, p.z, 7);
  // the cracked wall comes down
  const cw = world.cracked;
  if (cw && !cw.broken && Math.hypot(cw.pos.x - p.x, cw.pos.z - p.z) < 3.9){
    cw.broken = true; lv.g[cw.tile[1] * lv.W + cw.tile[0]] = T.FLOOR; distField = null;
    for (const panel of cw.panels){
      panel.group.updateMatrixWorld(true);
      for (const r of panel.debris()){
        scene.add(r);                                    // debris() hands back pieces already placed in the world
        const v = new THREE.Vector3(r.position.x - p.x, 0, r.position.z - p.z).normalize().multiplyScalar(2 + Math.random() * 4);
        v.y = 2 + Math.random() * 4; debris.push({ o: r, v, spin: new THREE.Vector3(R() * 8, R() * 8, R() * 8), t: 0 });
      }
      panel.group.parent.remove(panel.group);
    }
    burst('dust', cw.pos, 80); sfx.crack([cw.pos.x, 1.5, cw.pos.z]); hint('THE WALL COMES DOWN', 2.5);
  }
}
const debris = [];
function updatePowers(dt){
  pw.bombCool = Math.max(0, pw.bombCool - dt);
  if (pw.shieldT > 0){ pw.shieldT -= dt; if (pw.shieldT <= 0){ pw.shieldT = 0; pw.shieldCool = 30; sfx.shield(false); hint('THE SHIELD FADES', 2); } }
  else pw.shieldCool = Math.max(0, pw.shieldCool - dt);
  // the bomb flies, bounces once or twice, settles
  const b = pw.bomb;
  if (b){
    b.t += dt;
    if (!b.landed){
      b.vel.y -= 9.8 * dt;
      const next = b.pos.clone().addScaledVector(b.vel, dt);
      if (solidAt(next.x, next.z)){ b.vel.x *= -0.3; b.vel.z *= -0.3; }
      else { b.pos.x = next.x; b.pos.z = next.z; }
      b.pos.y += b.vel.y * dt;
      const fl = Math.max(floorAt(b.pos.x, b.pos.z), 0);
      if (b.pos.y < fl + 0.12){ b.pos.y = fl + 0.12; if (Math.abs(b.vel.y) < 1.2){ b.landed = true; } b.vel.y *= -0.35; b.vel.x *= 0.5; b.vel.z *= 0.5; sfx.thud([b.pos.x, 0.2, b.pos.z]); }
      // a bomb that sinks in water is lost
      const i = Math.floor(b.pos.x / TILE), j = Math.floor(b.pos.z / TILE);
      if (tt(i, j) === T.WATER && !frozenAt(i, j) && b.pos.y < 0){ scene.remove(b.m.group); pw.bomb = null; sfx.splash(); }
    }
    if (pw.bomb){ b.m.group.position.copy(b.pos).add(new THREE.Vector3(0, -0.12, 0)); b.m.update(simTime, Math.min(1, b.t / 8));
      if (b.landed && Math.floor(b.t * 2) !== Math.floor((b.t - dt) * 2)) sfx.beep([b.pos.x, b.pos.y, b.pos.z]); }
  }
  for (const d of debris){ if (d.t > 6) continue; d.t += dt; d.v.y -= 9.8 * dt; d.o.position.addScaledVector(d.v, dt);
    if (d.o.position.y < 0.08){ d.o.position.y = 0.08; d.v.multiplyScalar(0.4); d.v.y = Math.abs(d.v.y) * 0.3; d.spin.multiplyScalar(0.5); }
    d.o.rotation.x += d.spin.x * dt; d.o.rotation.y += d.spin.y * dt; d.o.rotation.z += d.spin.z * dt; }
  // ice thaws: a warning first
  for (const w of world.water.values()){
    if (!w.frozenUntil) continue;
    const left = w.frozenUntil - simTime;
    if (left < 6 && !w.warned){ w.warned = true; const [x, z] = center(w.i, w.j); sfx.crack([x, 0, z]); if (Math.hypot(x - player.x, z - player.z) < 12) hint('THE ICE IS CRACKING', 2); }
    if (left <= 0){ w.frozenUntil = 0; w.mesh.material = mats.water; w.mesh.position.y = -0.22; distField = null; }
  }
  // the magnet pulls things toward you
  if (pw.magnet){
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const hand = camera.position.clone().add(new THREE.Vector3(0, -0.3, 0));
    let pulling = 0;
    for (const it of world.items){
      if (it.taken) continue;
      const v = it.pos.clone().sub(camera.position), d = v.length();
      if (d > 16 || v.normalize().dot(fwd) < 0.82 || !lineOfSight(player.x, player.z, it.pos.x, it.pos.z)) continue;
      const to = hand.clone().sub(it.pos).normalize();
      it.pos.addScaledVector(to, Math.min(d, 9 * dt)); it.pos.y = Math.max(it.pos.y, Math.min(1.2, it.pos.y + dt * 2));
      it.obj.position.copy(it.pos); it.obj.rotation.y += dt * 5; pulling++;
      if (Math.random() < 0.5) emit(glow, it.pos.x, it.pos.y, it.pos.z, 0, 0, 0, 0.3, 0.03, 2.5, 0.4, 0.3);
    }
    for (const z of zombies){
      if (z.state === 'dead' || z.state === 'emerge') continue;
      const v = new THREE.Vector3(z.x - player.x, 0, z.z - player.z), d = v.length();
      if (d > 12 || d < 1.4 || v.normalize().dot(new THREE.Vector3(fwd.x, 0, fwd.z).normalize()) < 0.8 || !lineOfSight(player.x, player.z, z.x, z.z)) continue;
      z.vx -= v.x * 10 * dt; z.vz -= v.z * 10 * dt; z.stun = 0.4; pulling++;
    }
    // a red-silver ripple in front of your hand
    for (let k = 0; k < 3; k++){ const r = 0.5 + Math.random() * 4; emit(glow, hand.x + fwd.x * r + (R() - 0.5) * 0.4, hand.y + fwd.y * r + (R() - 0.5) * 0.4, hand.z + fwd.z * r + (R() - 0.5) * 0.4,
      -fwd.x * 6, -fwd.y * 6, -fwd.z * 6, 0.12, 0.02, 2.4, 0.5, 0.45); }
    pw.magnetT += dt; if (pw.magnetT > 0.35){ pw.magnetT = 0; sfx.magnet(true); }
  }
}

/* ================================================================
   PICKUPS, CHESTS, GATES, CELLS, THE WAY OUT
   ================================================================ */
let prompt = null, holdT = 0;
function interactables(){
  // what's in front of you that A would act on
  const fwd = new THREE.Vector3(Math.sin(player.yaw) * -1, 0, Math.cos(player.yaw) * -1);
  let best = null, bestD = 9;
  const consider = (pos, range, item) => {
    const dx = pos.x - player.x, dz = pos.z - player.z, d = Math.hypot(dx, dz);
    if (d > range) return;
    if (d > 0.6 && (dx * fwd.x + dz * fwd.z) / d < 0.35) return;
    if (d < bestD){ bestD = d; best = item; }
  };
  if (shrine){ for (const it of shrine.interactables()) consider(it.pos, 1.9, { kind: 'shrine', it, label: it.label, hold: it.hold }); return best; }
  for (const c of world.chests) if (!c.opened) consider(c.pos, 1.9, { kind: 'chest', c, label: 'Open the chest', hold: 0 });
  for (const p of prisoners) if (p.state === 'caged') consider(p.cell.door, 1.9, { kind: 'cell', p, label: 'Break the lock', hold: 1.0 });
  return best;
}
function updateInteract(dt, held){
  prompt = interactables();
  if (!prompt){ holdT = 0; return; }
  if (prompt.hold === 0){ if (pressed.has('interact')) doInteract(prompt); return; }
  if (held){ if (holdT === 0) sfx.lock([prompt.p.cell.door.x, 1, prompt.p.cell.door.z]); holdT += dt;
    if (Math.floor(holdT * 4) !== Math.floor((holdT - dt) * 4)) sfx.lock([prompt.p.cell.door.x, 1, prompt.p.cell.door.z]);
    if (holdT >= prompt.hold){ doInteract(prompt); holdT = 0; } }
  else holdT = 0;
}
function doInteract(it){
  if (it.kind === 'shrine'){ it.it.act(shrineApi); return; }
  if (it.kind === 'chest'){
    const c = it.c; c.opened = true; sfx.chest();
    const got = [];
    if (c.contents.weapon && !inv.weapons[c.contents.weapon]){
      inv.weapons[c.contents.weapon] = true; got.push(WEAPONS[c.contents.weapon].name);
      setWeapon(c.contents.weapon); sfx.weapon();
      banner('YOU FOUND THE ' + WEAPONS[c.contents.weapon].name.toUpperCase(), WEAPONS[c.contents.weapon].desc + ' Switch weapons with RB, 1–4 or the mouse wheel.');
    }
    if (c.contents.bolts){ inv.bolts += c.contents.bolts; got.push(c.contents.bolts + ' bolts'); }
    if (c.contents.food){ inv.food[c.contents.food]++; got.push(FOOD[c.contents.food].name); }
    if (!c.contents.weapon) hint('FOUND ' + got.join(', ').toUpperCase(), 2.5);
    sfx.pickup(); updateHud();
  } else if (it.kind === 'cell'){
    const p = it.p; p.state = 'opening'; p.t = 0; sfx.door([p.cell.door.x, 1.5, p.cell.door.z]);
  }
}
/* ----- shrines: walk through a gate to go inside; solve the trial; take the power from the altar ----- */
function moveTo(fn){ trans = { t: 0, fn, done: false }; }
function placeAt(p){ player.x = p.x; player.z = p.z; player.yaw = p.yaw; player.pitch = 0; player.vx = player.vz = player.kx = player.kz = 0; player.y = floorAt(p.x, p.z) + EYE; }
function enterShrine(g){
  // remember which side you came from, so you come back out facing the way you were going
  // (the open side nearest to where you came from: a gate can be walked into from the side)
  const gi = Math.floor(g.pos.x / TILE), gj = Math.floor(g.pos.z / TILE);
  const open = DIRS.filter(([dx, dz]) => { const t = tt(gi + dx, gj + dz); return t === T.FLOOR || t === T.HALL; });
  const [rx, rz] = (open.length ? open : [g.axis]).slice().sort((a, b) =>
    ((player.x - g.pos.x) * b[0] + (player.z - g.pos.z) * b[1]) - ((player.x - g.pos.x) * a[0] + (player.z - g.pos.z) * a[1]))[0];
  const ret = { x: g.pos.x + rx * 1.7, z: g.pos.z + rz * 1.7, yaw: Math.atan2(-rx, -rz) };
  g.cool = true; sfx.shrine();
  moveTo(() => { shrine = g.shrine; shrineGate = g; shrine.ret = ret; shrine.leaveT = 0; placeAt(shrine.start);
    banner(shrine.name, shrine.taken ? 'Its power is already yours.' : shrine.hint + ' Walk back through the gate to leave.'); });
}
function leaveShrine(){
  const sh = shrine;
  moveTo(() => { shrine = null; placeAt(sh.ret); shrineGate.cool = true; distField = null; });
}
const shrineApi = {
  sfx, hint: (t, s) => hint(t, s), radius: RADIUS, eye: EYE,
  solved(){ sfx.gate(null); hint('THE DOOR OPENS', 2.5); },
  takePower(){
    const g = shrineGate, kind = g.kind;
    g.taken = true; g.obj.setActive(false); g.light.base = 1.5;
    inv.powers.push(kind); inv.power = inv.powers.length - 1;
    sfx.power(); flash(shrine.orb.position.clone(), POWERS[kind].color, 20);
    for (let k = 0; k < 60; k++) burst('magic', shrine.orb.position.clone().setY(0.2), 1, new THREE.Color(POWERS[kind].color));
    banner('NEW POWER: ' + POWERS[kind].name.toUpperCase(), POWERS[kind].desc + ' Use it with LT, right-click or Q. Swap powers with LB or R.');
    shrine.leaveT = 4; updateHud();
  },
};
function updateShrine(dt){
  shrine.update(dt, simTime, player, shrineApi);
  if (trans) return;
  if (shrine.leaveT > 0){ shrine.leaveT -= dt; if (shrine.leaveT <= 0) leaveShrine(); }
  else if (shrine.atExit(player.x, player.z)) leaveShrine();
}
function updateTrans(dt){
  if (!trans) return;
  trans.t += dt;
  if (trans.t >= 0.45 && !trans.done){ trans.done = true; trans.fn(); }
  grade.uniforms.fade.value = trans.t < 0.45 ? trans.t / 0.45 : Math.max(0, 1 - (trans.t - 0.45) / 0.45);
  if (trans.t > 0.9){ trans = null; grade.uniforms.fade.value = 0; }
}
function updatePickups(dt){
  for (const it of world.items){
    if (it.taken) continue;
    const d = Math.hypot(it.pos.x - player.x, it.pos.z - player.z);
    if (d < 0.9 && Math.abs(it.pos.y - (player.y - EYE)) < 1.4){
      it.taken = true; it.obj.parent.remove(it.obj);
      inv.food[it.food]++; sfx.pickup(); hint('PICKED UP: ' + FOOD[it.food].name.toUpperCase(), 1.6); updateHud();
    } else if (!pw.magnet) { it.obj.rotation.y += dt * 0.3; }
  }
  // power gates: walk through to take the power
  for (const g of world.gates){
    g.obj.update(simTime);
    if (g.taken) continue;
    if (Math.random() < 0.3) burst('magic', g.pos, 1, new THREE.Color(POWERS[g.kind].color));
    const d = Math.hypot(g.pos.x - player.x, g.pos.z - player.z);
    if (d > 1.8) g.cool = false;
    if (d < 0.9 && !g.cool && !trans) enterShrine(g);
  }
  // cells opening, prisoners cheering, then hurrying off to wait for you at the stairs
  for (const p of prisoners){
    p.t += dt;
    if (p.state === 'opening'){
      p.cell.bars.setOpen(Math.min(1, p.t / 0.9));
      if (p.t > 0.9){ p.state = 'cheer'; p.t = 0; stats.freed++; sfx.cheer([p.m.group.position.x, 1.6, p.m.group.position.z]);
        const all = stats.freed >= prisoners.length;
        say(all ? '“That’s everyone! The gate at the stairs is opening!”' : '“Thank you! I’ll wait for you by the stairs!”', 3.5);
        updateHud(); if (all) openExit(); }
      p.m.update(dt, { pose: p.pose });
    } else if (p.state === 'cheer'){
      p.m.update(dt, { pose: 'cheer' });
      if (p.t > 2.5){ p.state = 'leave'; p.t = 0; }
    } else if (p.state === 'leave'){
      // out through the door, then away into the dark
      const door = p.cell.door, g = p.m.group, [dx, dz] = p.cell.dir;
      const target = p.t < 1.6 ? door.clone().addScaledVector(new THREE.Vector3(dx, 0, dz), -1.0) : door.clone().addScaledVector(new THREE.Vector3(dx, 0, dz), -1.0).add(new THREE.Vector3(-dz * 3, 0, dx * 3));
      const v = target.sub(g.position); v.y = 0; const l = v.length();
      if (l > 0.05){ g.position.addScaledVector(v.normalize(), Math.min(l, dt * 1.6)); g.rotation.y = Math.atan2(v.x, v.z); }
      p.m.update(dt, { pose: 'walk', speed: 1.6 });
      if (p.t > 3.2){ p.state = 'gone'; levelRoot.remove(g); if (world.portcullis.open) waitAtStairs(p, prisoners.indexOf(p)); }
    } else if (p.state === 'caged') p.m.update(dt, { pose: p.pose });
    else if (p.state === 'waiting') p.m.update(dt, { pose: 'cheer' });
  }
}
function openExit(){
  world.portcullis.open = true; sfx.gate([world.portcullis.pos.x, 2, world.portcullis.pos.z]);
  // the people you freed wait for you on the stairs (the last one gets there after leaving the cell)
  prisoners.forEach((p, k) => { if (p.state === 'gone') waitAtStairs(p, k); });
}
function waitAtStairs(p, k){
  const [li, lj] = lv.exit.landing, [lx, lz] = center(li, lj), [dx, dz] = lv.exit.dir, g = p.m.group;
  if (!g.parent) levelRoot.add(g);
  const side = (k % 3) - 1;
  g.position.set(lx - dz * side * 0.7 - dx * 0.3, STAIR_RISE, lz + dx * side * 0.7 - dz * 0.3);
  g.rotation.y = Math.atan2(-dx, -dz); p.state = 'waiting';
}
function updateExit(dt){
  const pc = world.portcullis;
  if (pc.open && pc.raised < 1){ pc.raised = Math.min(1, pc.raised + dt * 0.35); pc.obj.setRaised(pc.raised); }
  // trying the gate before everyone's free
  if (!pc.open && Math.hypot(pc.pos.x - player.x, pc.pos.z - player.z) < 1.6 && !updateExit.told){ updateExit.told = true;
    hint('THE GATE IS SHUT. FREE EVERY PRISONER (' + stats.freed + ' OF ' + prisoners.length + ')', 3.5); setTimeout(() => { updateExit.told = false; }, 6000); }
  const t = tileAt(player.x, player.z);
  if (pc.open && (t === T.LANDING || (t === T.STAIRS && floorAt(player.x, player.z) > STAIR_RISE * 0.8))) levelDone();
}

/* ================================================================
   WORLD TICK: flicker, the pool of lights, chains, embers
   ================================================================ */
const chainM = new THREE.Matrix4(), chainQ = new THREE.Quaternion(), chainE = new THREE.Euler(), chainS = new THREE.Vector3(1, 1, 1);
function flicker(t, phase){ return 0.82 + 0.1 * Math.sin(t * 7.3 + phase) + 0.06 * Math.sin(t * 13.1 + phase * 2.3) + 0.05 * Math.sin(t * 23.7 + phase * 0.7); }
let emberT = 0;
function updateWorld(dt){
  const t = simTime;
  flameUniforms.time.value = t;
  handLight.intensity = 7.5 * flicker(t, 0) * (player.drowning ? Math.max(0, 1 - player.dying * 2) : 1);
  ragMat.color.setScalar(0.5 + 0.6 * flicker(t, 3.1));
  const sources = shrine ? shrine.lights : world.sconces;
  for (const s of sources){
    const d = Math.hypot(s.pos.x - player.x, s.pos.z - player.z);
    const vis = d < (s.big ? 26 : 20) && lineOfSight(player.x, player.z, s.pos.x + (player.x - s.pos.x) * 0.03, s.pos.z + (player.z - s.pos.z) * 0.03);
    s.score = vis ? (s.big ? 3 : 1) / (1 + d) : 0;
    s.w += ((vis ? 1 : 0) - s.w) * (1 - Math.exp(-dt * 4));
  }
  const ranked = sources.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, pool.length);
  pool.forEach((l, k) => { const s = ranked[k]; if (!s){ l.intensity = 0; return; }
    l.position.copy(s.pos); l.color.copy(s.color); l.intensity = s.base * flicker(t, s.phase) * s.w; });
  fx.light *= Math.exp(-dt * 6); fxLight.intensity = fx.light;
  // embers from the flames near you
  emberT -= dt;
  if (emberT < 0){ emberT = 0.06;
    const near = (shrine ? shrine.flames : world.flames).filter((f) => Math.abs(f.position.x - player.x) + Math.abs(f.position.z - player.z) < 10);
    const f = Math.random() < 0.5 || !near.length ? heldFlame : near[(Math.random() * near.length) | 0];
    burst('ember', f.position, 1); }
  dustMat.uniforms.origin.value.copy(camera.position); dustMat.uniforms.light.value.copy(handLight.position);
  for (const ch of world.chains){
    const sw = Math.sin(t * 0.9 + ch.phase) * ch.amp, sw2 = Math.cos(t * 0.6 + ch.phase) * ch.amp;
    for (let k = 0; k < ch.n; k++){
      chainE.set(0, (k % 2) * Math.PI / 2, Math.PI / 2); chainQ.setFromEuler(chainE);
      chainM.compose(tmp.set(ch.x + sw * k * 0.058, ch.top - 0.03 - k * 0.058, ch.z + sw2 * k * 0.058), chainQ, chainS);
      world.links.setMatrixAt(ch.first + k, chainM);
    }
  }
  world.links.instanceMatrix.needsUpdate = true;
  // water ripples
  if (mats.water.normalMap){ mats.water.normalMap.offset.set(t * 0.01, t * 0.007); }
  for (let k = decals.length - 1; k >= 0; k--){ const d = decals[k]; d.life -= dt; d.m.material.opacity = Math.min(1, d.life / 4);
    if (d.life <= 0){ scene.remove(d.m); d.m.geometry.dispose(); d.m.material.dispose(); decals.splice(k, 1); } }
  if (ring.visible){ ringT += dt; ring.scale.setScalar(1 + ringT * 9); ringMat.opacity = 0.6 * (1 - ringT / 0.6); if (ringT > 0.6) ring.visible = false; }
  updateParticles(glow, dt); updateParticles(gunk, dt);
}

/* ================================================================
   CAMERA
   ================================================================ */
function placeCamera(t){
  const bobAmt = Math.min(1, player.speed / WALK);
  const by = Math.abs(Math.sin(player.bob)) * 0.045 * bobAmt, bx = Math.cos(player.bob) * 0.025 * bobAmt;
  const shake = player.shake * 0.08;
  let y = player.y + by + Math.sin(t * 1.3) * 0.006;
  let roll = Math.cos(player.bob) * 0.006 * bobAmt;
  if (player.dying > 0){ const f = Math.min(1, player.dying); if (player.drowning) y -= f * 2.0; else { y -= f * 1.25; roll += f * 0.9; } }
  camera.position.set(player.x + Math.cos(player.yaw) * bx + (Math.random() - 0.5) * shake, y + (Math.random() - 0.5) * shake, player.z - Math.sin(player.yaw) * bx + (Math.random() - 0.5) * shake);
  camera.rotation.set(player.pitch + Math.sin(t * 0.7) * 0.004, player.yaw + Math.sin(t * 0.43) * 0.005, roll);
  // the torch, left hand
  held.position.set(-0.34 + bx * 0.6, -0.5 + by * 0.5 + Math.sin(t * 1.1) * 0.006, -0.46);
  held.rotation.set(Math.sin(player.bob * 2) * 0.02 * bobAmt, 0, 0);
  // the weapon, right hand: rest pose, swing, and raising it after a switch
  const P = POSE[inv.weapon];
  let r = P.rest;
  if (swing.t < POSE[swing.kind].dur && swing.kind === inv.weapon) r = POSE[swing.kind].at(swing.t / POSE[swing.kind].dur);
  const low = (1 - swing.raise) * 0.5;
  weaponHolder.position.set(r[0] + bx * 0.5, r[1] + by * 0.4 - low + Math.sin(t * 1.3 + 1) * 0.005, r[2]);
  weaponHolder.rotation.set(r[3], r[4], r[5]);
  camera.updateMatrixWorld(true);
  heldTorch.updateMatrixWorld(true);
  const tip = tmp.set(0, 0.53, 0).applyMatrix4(heldTorch.matrixWorld);
  heldFlame.position.copy(tip).add(new THREE.Vector3(0, -0.04, 0));
  const lp = tip.clone().add(new THREE.Vector3(0, 0.22, 0));
  for (let k = 0; k < 6 && solidAt(lp.x, lp.z); k++) lp.lerp(camera.position, 0.35);
  handLight.position.copy(lp);
}

/* ================================================================
   HUD AND MENUS
   ================================================================ */
const hintEl = $('hint');
function hint(text, secs){ hintEl.textContent = text; hintEl.classList.add('show'); clearTimeout(hint.t); hint.t = setTimeout(() => hintEl.classList.remove('show'), secs * 1000); }
function say(text, secs){ const el = $('say'); el.textContent = text; el.classList.add('show'); clearTimeout(say.t); say.t = setTimeout(() => el.classList.remove('show'), secs * 1000); }
function banner(title, text){ $('bannerTitle').textContent = title; $('bannerText').textContent = text; const el = $('banner'); el.classList.add('show');
  clearTimeout(banner.t); banner.t = setTimeout(() => el.classList.remove('show'), 5200); }
const HEART = (fill) => `<svg viewBox="0 0 32 30" class="heart"><defs><clipPath id="hc${fill}"><rect x="0" y="0" width="${fill * 32}" height="30"/></clipPath></defs>
  <path d="M16 28 C 6 20 1 14 1 8.5 C 1 4 4.5 1 8.5 1 C 12 1 14.5 3 16 6 C 17.5 3 20 1 23.5 1 C 27.5 1 31 4 31 8.5 C 31 14 26 20 16 28 Z" fill="rgba(20,4,2,0.75)" stroke="rgba(216,207,189,0.5)" stroke-width="1.4"/>
  <path clip-path="url(#hc${fill})" d="M16 28 C 6 20 1 14 1 8.5 C 1 4 4.5 1 8.5 1 C 12 1 14.5 3 16 6 C 17.5 3 20 1 23.5 1 C 27.5 1 31 4 31 8.5 C 31 14 26 20 16 28 Z" fill="#a3170e"/></svg>`;
const icons = {};   // data URLs of rendered items
const POWER_ICON = {
  magnet: '<svg viewBox="0 0 40 40"><path d="M8 6 h8 v14 a4 4 0 0 0 8 0 v-14 h8 v14 a12 12 0 0 1 -24 0z" fill="#c33" stroke="#eee" stroke-width="1.5"/><rect x="8" y="6" width="8" height="5" fill="#ddd"/><rect x="24" y="6" width="8" height="5" fill="#ddd"/></svg>',
  bomb: '<svg viewBox="0 0 40 40"><circle cx="18" cy="23" r="12" fill="#222" stroke="#aaa" stroke-width="1.2"/><path d="M26 13 q4 -6 9 -4" stroke="#b97" stroke-width="2" fill="none"/><circle cx="35" cy="8" r="2.5" fill="#fa4"/></svg>',
  freeze: '<svg viewBox="0 0 40 40" stroke="#bfe4ff" stroke-width="2.2" fill="none"><path d="M20 4v32M6 12l28 16M6 28l28-16"/><path d="M16 7l4 4 4-4M16 33l4-4 4 4M5 17l5-1-1-5M35 23l-5 1 1 5M5 23l5 1-1 5M35 17l-5-1 1-5"/></svg>',
  shield: '<svg viewBox="0 0 40 40"><path d="M20 3 L34 8 V19 C34 28 27 34 20 37 C13 34 6 28 6 19 V8 Z" fill="#b8902a" stroke="#ffe08a" stroke-width="1.6"/><path d="M20 9 V31 M12 18 H28" stroke="#ffe9a8" stroke-width="2"/></svg>',
};
function updateHud(){
  let h = '';
  for (let k = 0; k < MAX_HP / 2; k++) h += HEART(Math.max(0, Math.min(1, (player.hp - k * 2) / 2)));
  $('hearts').innerHTML = h;
  $('freed').textContent = `${stats.freed} / ${prisoners.length}`;
  $('wIcon').style.backgroundImage = icons[inv.weapon] ? `url(${icons[inv.weapon]})` : '';
  $('wName').textContent = WEAPONS[inv.weapon].name + (inv.weapon === 'crossbow' ? ` · ${inv.bolts}` : '');
  const p = currentPower();
  $('pSlot').classList.toggle('empty', !p);
  $('pIcon').innerHTML = p ? POWER_ICON[p] : '';
  $('pName').textContent = p ? POWERS[p].name : 'No power';
  const foods = Object.keys(FOOD).reduce((n, k) => n + inv.food[k], 0);
  $('foodCount').textContent = foods;
}
function updateHudLive(){
  const p = currentPower(), el = $('pState');
  let s = '';
  if (p === 'shield') s = pw.shieldT > 0 ? Math.ceil(pw.shieldT) + 's' : pw.shieldCool > 0 ? 'wait ' + Math.ceil(pw.shieldCool) + 's' : 'ready';
  else if (p === 'bomb') s = pw.bomb ? (pw.bomb.landed ? 'press to explode' : '') : pw.bombCool > 0 ? '…' : 'ready';
  else if (p === 'magnet') s = pw.magnet ? 'pulling' : 'hold';
  else if (p === 'freeze') s = 'ready';
  if (el.textContent !== s) el.textContent = s;
  // prompt
  const pe = $('prompt');
  if (prompt && state === 'play'){
    const txt = (isTouch() ? 'TAP USE' : padConnected() ? 'A' : 'E') + (prompt.hold ? ' (HOLD)' : '') + ' · ' + prompt.label.toUpperCase();
    if (pe.dataset.t !== txt){ pe.dataset.t = txt; $('promptText').textContent = txt; }
    pe.classList.add('show'); $('promptBar').style.width = (prompt.hold ? Math.min(1, holdT / prompt.hold) * 100 : 0) + '%';
  } else pe.classList.remove('show');
  $('useBtn').classList.toggle('lit', !!prompt);
  // the monster's health while you're fighting it
  const bb = $('bossBar');
  const showBoss = beast && beast.aware && !beast.dead && state === 'play';
  bb.classList.toggle('show', !!showBoss);
  if (showBoss) $('bossFill').style.width = (Math.max(0, beast.hp) / beast.max * 100) + '%';
}
function padConnected(){ const ps = navigator.getGamepads ? navigator.getGamepads() : []; for (const p of ps) if (p) return true; return false; }

// icons for weapons and food: render each model once into a small transparent picture
function renderIcons(){
  // drawn at twice the size and scaled down, since a multisampled target can't be read back reliably
  const size = 160, big = 320, rt = new THREE.WebGLRenderTarget(big, big);
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const isc = new THREE.Scene();
  isc.add(new THREE.HemisphereLight(0xfff1dd, 0x302820, 3.5));
  const key = new THREE.DirectionalLight(0xffd8a8, 5); key.position.set(2, 3, 4); isc.add(key);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
  isc.environment = env;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size; const ctx = canvas.getContext('2d');
  const tmpC = document.createElement('canvas'); tmpC.width = tmpC.height = big; const tctx = tmpC.getContext('2d');
  const pixels = new Uint8Array(big * big * 4), img = tctx.createImageData(big, big);
  const snap = (obj, name, rot) => {
    const g = new THREE.Group(); g.add(obj); if (rot){ g.rotation.order = 'ZYX'; g.rotation.set(rot[0], rot[1], rot[2]); } isc.add(g);
    g.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g), c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2;
    cam.position.copy(c).add(new THREE.Vector3(0, r * 0.3, r / Math.tan(THREE.MathUtils.degToRad(15)) * 1.02)); cam.lookAt(c);
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(isc, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, big, big, pixels);
    for (let y = 0; y < big; y++) img.data.set(pixels.subarray((big - 1 - y) * big * 4, (big - y) * big * 4), y * big * 4);
    tctx.putImageData(img, 0, 0); ctx.clearRect(0, 0, size, size); ctx.drawImage(tmpC, 0, 0, size, size); icons[name] = canvas.toDataURL();
    isc.remove(g);
  };
  try {
    // weapons: turn the flat of the blade to the camera, then lay them across the picture
    snap(props.createWeapon('sword', { env }), 'sword', [0, Math.PI / 2, -0.8]);
    snap(props.createWeapon('spear', { env }), 'spear', [0, Math.PI / 2, -0.8]);
    snap(props.createWeapon('hammer', { env }), 'hammer', [0, Math.PI / 2, -0.6]);
    snap(props.createWeapon('crossbow', { env }), 'crossbow', [0.3, -2.2, 0]);
    for (const f of Object.keys(FOOD)) snap(props.createFood(f), f, [0.5, 0.4, 0]);
  } catch (e){ console.warn('[undercroft] icons', e); }
  renderer.setRenderTarget(null); renderer.setClearColor(0x000000, 1);
  rt.dispose();
}

// the bag: weapons, powers, food. Moves with the stick/d-pad/arrows, A or click to use.
let invFocus = 0;
function invSlots(){
  const s = [];
  for (const w of WEAPON_ORDER) s.push({ type: 'weapon', id: w, have: !!inv.weapons[w] });
  for (const p of POWER_ORDER) s.push({ type: 'power', id: p, have: inv.powers.includes(p) });
  for (const f of Object.keys(FOOD)) s.push({ type: 'food', id: f, have: inv.food[f] > 0 });
  return s;
}
function renderInventory(){
  const slots = invSlots();
  const row = (type) => slots.map((s, k) => s.type !== type ? '' : `<button class="slot${s.have ? '' : ' none'}${k === invFocus ? ' focus' : ''}${(s.type === 'weapon' && inv.weapon === s.id) || (s.type === 'power' && currentPower() === s.id) ? ' on' : ''}" data-k="${k}">
      <span class="pic" style="${s.have && icons[s.id] ? `background-image:url(${icons[s.id]})` : ''}">${s.type === 'power' && s.have ? POWER_ICON[s.id] : s.have ? '' : '?'}</span>
      ${s.type === 'food' && s.have ? `<span class="n">${inv.food[s.id]}</span>` : ''}</button>`).join('');
  $('invWeapons').innerHTML = row('weapon'); $('invPowers').innerHTML = row('power'); $('invFood').innerHTML = row('food');
  const f = slots[invFocus];
  const info = f.type === 'weapon' ? WEAPONS[f.id] : f.type === 'power' ? POWERS[f.id] : FOOD[f.id];
  $('invName').textContent = f.have ? info.name : '???';
  $('invDesc').textContent = !f.have ? (f.type === 'weapon' ? 'Not found yet. Look in chests.' : f.type === 'power' ? 'Not found yet. Walk through a power gate.' : 'You have none.')
    : f.type === 'weapon' ? info.desc + (f.id === 'crossbow' ? ` Bolts: ${inv.bolts}.` : '') + (inv.weapon === f.id ? ' (in your hand)' : ' Press A to hold it.')
    : f.type === 'power' ? info.desc + (currentPower() === f.id ? ' (ready to use)' : ' Press A to choose it.')
    : `Restores ${info.heal / 2} heart${info.heal > 2 ? 's' : ''}. You have ${inv.food[f.id]}. Press A to eat.`;
  $('invHearts').innerHTML = $('hearts').innerHTML;
  $('invFreed').textContent = `Prisoners freed: ${stats.freed} of ${prisoners.length}`;
  for (const b of document.querySelectorAll('#inv .slot')) b.onclick = () => { invFocus = +b.dataset.k; invUse(); };
}
function invUse(){
  const f = invSlots()[invFocus];
  if (!f.have){ sfx.deny(); return; }
  if (f.type === 'weapon') setWeapon(f.id);
  else if (f.type === 'power'){ inv.power = inv.powers.indexOf(f.id); updateHud(); }
  else eat(f.id);
  sfx.pickup(); renderInventory();
}
function invNav(dir){
  const slots = invSlots(), rowOf = (k) => slots[k].type, rows = ['weapon', 'power', 'food'];
  const r = rows.indexOf(rowOf(invFocus)), col = invFocus - slots.findIndex((s) => s.type === rowOf(invFocus));
  if (dir === 'left' || dir === 'right'){ const n = slots.filter((s) => s.type === rowOf(invFocus)).length; const c = (col + (dir === 'right' ? 1 : -1) + n) % n; invFocus = slots.findIndex((s) => s.type === rowOf(invFocus)) + c; }
  else { const nr = rows[(r + (dir === 'down' ? 1 : -1) + 3) % 3], start = slots.findIndex((s) => s.type === nr), n = slots.filter((s) => s.type === nr).length; invFocus = start + Math.min(col, n - 1); }
  sfx.beep(null); renderInventory();
}

/* ================================================================
   STATES
   ================================================================ */
function show(id){ for (const s of ['title', 'pause', 'won', 'dead', 'inv']) $(s).classList.toggle('hidden', s !== id); document.body.classList.toggle('playing', !id); }
function startLevel(){
  snapshot = JSON.parse(JSON.stringify({ inv, hp: player.hp }));
  buildLevel(); compileAll();
  state = 'play'; show(null); lockPointer();
  hint(levelNo === 1 ? 'FREE THE PRISONERS. FIND THE WAY UP.' : 'LEVEL ' + levelNo, 4);
}
function start(){
  initAudio(); setMuted(TEST || audio.muted); resumeAudio();
  levelNo = 1; player.hp = MAX_HP;
  Object.assign(inv, { weapons: { sword: true }, weapon: 'sword', powers: [], power: -1, food: { apple: 0, bread: 0, cheese: 0, drumstick: 0 }, bolts: 0 });
  stats.slain = stats.eaten = 0;
  setWeapon('sword'); startLevel();
}
function pause(){ if (state !== 'play') return; state = 'pause'; show('pause'); if (document.pointerLockElement) document.exitPointerLock(); }
function resume(){ state = 'play'; show(null); lockPointer(); resumeAudio(); }
function openInventory(){ if (state !== 'play') return; state = 'inv'; renderInventory(); show('inv'); if (document.pointerLockElement) document.exitPointerLock(); }
function closeInventory(){ state = 'play'; show(null); lockPointer(); }
function levelDone(){
  if (state !== 'play') return;
  state = 'won'; sfx.win(); if (document.pointerLockElement) document.exitPointerLock();
  const m = Math.floor(playTime / 60), s = Math.floor(playTime % 60);
  $('wonTitle').innerHTML = `LEVEL ${levelNo}<span>you led them out</span>`;
  $('wonStat').innerHTML = `${m}:${String(s).padStart(2, '0')} in the dark &middot; ${stats.freed} freed &middot; ${stats.slain} zombies slain${beast && beast.dead ? ' &middot; the monster beaten' : ''}`;
  show('won');
}
function nextLevel(){ levelNo++; seed = (seed * 1103515245 + 12345) >>> 0 || 7; player.hp = Math.max(player.hp, 6); startLevel(); }
function tryAgain(){
  Object.assign(inv, JSON.parse(JSON.stringify(snapshot.inv))); player.hp = MAX_HP; player.dying = 0; player.drowning = false;
  setWeapon(inv.weapon); startLevel();
}
function confirmMenu(){
  if (state === 'title' && !$('startBtn').disabled) start();
  else if (state === 'pause') resume();
  else if (state === 'won') nextLevel();
  else if (state === 'dead') tryAgain();
}
$('startBtn').addEventListener('click', start);
$('resumeBtn').addEventListener('click', resume);
$('restartBtn').addEventListener('click', () => tryAgain());
$('againBtn').addEventListener('click', nextLevel);
$('retryBtn').addEventListener('click', tryAgain);
$('muteBtn').addEventListener('click', () => { setMuted(!audio.muted); $('muteBtn').textContent = audio.muted ? 'SOUND OFF' : 'SOUND ON'; });
$('invClose').addEventListener('click', closeInventory);

/* ================================================================
   LOOP
   ================================================================ */
function step(dt){
  simTime += dt;
  const pad = readPad();
  const held = { attack: !!(pad && pad.attack) || mouse.l || !!touchHeld.attack, power: !!(pad && pad.power) || mouse.r || !!keys.KeyQ || !!touchHeld.power,
    interact: !!(pad && pad.interact) || !!keys.KeyE || !!touchHeld.interact };
  if (pressed.has('mute')){ setMuted(!audio.muted); }
  if (state === 'play'){
    if (pressed.has('pause')) pause();
    else if (pressed.has('inventory')) openInventory();
  } else if (state === 'pause'){
    if (pressed.has('pause') || pressed.has('back')) resume();
    else if (pressed.has('confirm')) resume();
  } else if (state === 'inv'){
    if (pressed.has('inventory') || pressed.has('back') || pressed.has('pause')) closeInventory();
    else { for (const d of ['up', 'down', 'left', 'right']) if (pressed.has(d) || pressed.has('nav-' + d)) invNav(d);
      if (pressed.has('confirm')) invUse(); }
  } else if (pressed.has('confirm')) confirmMenu();
  if (state === 'play'){
    playTime += dt;
    if (player.dying > 0){
      player.dying += dt * 0.7;
      if (player.dying > 1.6 && state === 'play'){ state = 'dead'; $('deadStat').textContent = 'Killed by ' + player.cause + '.'; show('dead'); if (document.pointerLockElement) document.exitPointerLock(); }
    } else {
      if (!trans) updatePlayer(dt, pad);
      // weapon switching
      const owned = WEAPON_ORDER.filter((w) => inv.weapons[w]);
      if (pressed.has('nextWeapon') || pressed.has('prevWeapon')){ const i = owned.indexOf(inv.weapon); setWeapon(owned[(i + (pressed.has('nextWeapon') ? 1 : owned.length - 1)) % owned.length]); }
      for (let k = 0; k < 4; k++) if (pressed.has('w' + k) && inv.weapons[WEAPON_ORDER[k]]) setWeapon(WEAPON_ORDER[k]);
      if ((pressed.has('left') || pressed.has('right')) && pad && !keys.KeyA && !keys.KeyD && !keys.ArrowLeft && !keys.ArrowRight){
        const i = owned.indexOf(inv.weapon); setWeapon(owned[(i + (pressed.has('right') ? 1 : owned.length - 1)) % owned.length]); }
      if ((pressed.has('nextPower') || (pad && (pressed.has('up') || pressed.has('down')) && !keys.KeyW && !keys.KeyS)) && inv.powers.length){ inv.power = (inv.power + 1) % inv.powers.length; updateHud(); sfx.beep(null); }
      if (pressed.has('eat')) eat();
      if (pressed.has('attack') || (held.attack && swing.cool <= 0 && inv.weapon !== 'crossbow')) attack();
      usePower(pressed.has('power'), held.power);
      updateInteract(dt, held.interact);
    }
    swing.cool = Math.max(0, swing.cool - dt); swing.raise = Math.min(1, swing.raise + dt * 4);
    if (swing.t < 9){ swing.t += dt; if (!swing.hit && swing.t >= WEAPONS[swing.kind].hitAt){ swing.hit = true; meleeHit(); } }
    player.invuln = Math.max(0, player.invuln - dt); player.hurt = Math.max(0, player.hurt - dt * 1.4); player.shake = Math.max(0, player.shake - dt * 2);
    updateTrans(dt);
    if (shrine){ updateShrine(dt); updateBolts(dt); updatePowers(dt); }
    else {
    updateDistField(dt);
    for (const z of zombies) zombieUpdate(z, dt);
    for (let k = zombies.length - 1; k >= 0; k--) if (zombies[k].gone) zombies.splice(k, 1);
    beastUpdate(dt); updateFirePatches(dt);
    updateBolts(dt); updatePowers(dt); updatePickups(dt); updateExit(dt);
    }
  }
  pressed.clear();
  placeCamera(simTime);
  updateWorld(dt);
  grade.uniforms.time.value = simTime;
  grade.uniforms.hurt.value = Math.max(player.hurt, player.hp <= 2 && state === 'play' ? 0.25 + 0.15 * Math.sin(simTime * 5) : 0);
  grade.uniforms.shield.value += ((pw.shieldT > 0 ? 1 : 0) - grade.uniforms.shield.value) * Math.min(1, dt * 3);
  setListener(camera.position, tmp2.set(0, 0, -1).applyQuaternion(camera.quaternion));
  if (state === 'play') ambience(dt, player.x, player.z);
  updateHudLive();
}
let last = performance.now(), frameAvg = 16, frames = 0, resTimer = 0;
function frame(now){
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (state === 'loading' || TEST) return;
  step(dt); composer.render(); frames++;
  frameAvg += (dt * 1000 - frameAvg) * 0.05;
  if ((resTimer += dt) > 1.5){ resTimer = 0; const max = Math.min(devicePixelRatio || 1, 1.5);
    if (frameAvg > 22 && pixelRatio > 0.5){ pixelRatio = Math.max(0.5, pixelRatio - 0.1); resize(); }
    else if (frameAvg < 14 && pixelRatio < max){ pixelRatio = Math.min(max, pixelRatio + 0.05); resize(); } }
  if (DEBUG) $('debug').textContent = `${Math.round(1000 / frameAvg)} fps  x${pixelRatio.toFixed(2)}  ${renderer.info.render.calls} calls  ${(renderer.info.render.triangles / 1000) | 0}k tris`;
}
function compileAll(){ placeCamera(simTime); updateWorld(0.016); renderer.compile(scene, camera); }

/* ================================================================
   BOOT
   ================================================================ */
async function boot(){
  mats = makeMaterials(renderer, env);
  const [p, b, pe] = await Promise.all([
    loadModule(BASE + 'js/models/props.js', ['createWeapon', 'createFood', 'createChest', 'createPowerGate', 'createCellBars', 'createPortcullis', 'createBrazier', 'createBomb', 'createCrackedWall', 'createSkullPile', 'createBolt']),
    loadModule(BASE + 'js/models/beast.js', ['createBeast']),
    loadModule(BASE + 'js/models/people.js', ['createPeopleKit']),
  ]);
  props = p; beastMod = b;
  heldTorch = torchModel(mats.heldWood); heldTorch.rotation.set(-0.5, -0.2, -0.32); held.add(heldTorch);
  try { peopleKit = await pe.createPeopleKit({ env }); } catch (e){ console.warn('[undercroft] people', e); peopleKit = await stubs.createPeopleKit({ env }); }
  for (const w of WEAPON_ORDER){ const m = props.createWeapon(w, { env }); m.visible = w === 'sword'; m.traverse((o) => { if (o.isMesh){ o.castShadow = false; } }); weaponModels[w] = m; weaponHolder.add(m); }
  // a title-screen backdrop: the first level, seen from the start
  lv = null; buildLevel(); updateHud();
  await new Promise((r) => { THREE.DefaultLoadingManager.onLoad = r; setTimeout(r, 8000); });
  renderIcons(); updateHud();
  compileAll();
  state = 'title'; show('title');
  $('startBtn').disabled = false; $('loading').classList.add('hidden');
  if (TEST) window.__uc.ready = true;
}
boot();
requestAnimationFrame(frame);
if ('serviceWorker' in navigator && !TEST) navigator.serviceWorker.register(BASE + 'sw.js').catch(() => {});

/* ================================================================
   HOOKS FOR AUTOMATED TESTS
   ================================================================ */
window.__uc = {
  ready: false, god: false,
  get state(){ return state; }, get player(){ return player; }, get level(){ return lv; }, get world(){ return world; }, get inv(){ return inv; },
  get zombies(){ return zombies; }, get beast(){ return beast; }, get stats(){ return stats; }, get prisoners(){ return prisoners; }, get pw(){ return pw; },
  start, pause, resume, nextLevel, tryAgain, openInventory, closeInventory, eat, hurtPlayer, spawnZombie, setWeapon,
  advance(seconds, draw = true){ const n = Math.round(seconds * 60); for (let k = 0; k < n; k++) step(1 / 60); if (draw) composer.render(); return { x: player.x, z: player.z, state }; },
  render(){ composer.render(); },
  place(x, z, yaw, pitch){ player.x = x; player.z = z; player.y = floorAt(x, z) + EYE; if (yaw !== undefined) player.yaw = yaw; if (pitch !== undefined) player.pitch = pitch;
    player.vx = player.vz = player.kx = player.kz = 0; step(1 / 60); },
  give(what){ if (WEAPONS[what]){ inv.weapons[what] = true; if (what === 'crossbow') inv.bolts += 10; } else if (POWERS[what]){ if (!inv.powers.includes(what)) inv.powers.push(what); inv.power = inv.powers.indexOf(what); } else if (FOOD[what]) inv.food[what]++; updateHud(); },
  // shortest walk between tiles; water and the cracked wall count as passable only if asked
  path(from, to, opts){ opts = opts || {};
    const pass = (t) => t === T.FLOOR || t === T.HALL || t === T.STAIRS || t === T.LANDING || (opts.water && t === T.WATER) || (opts.crack && t === T.CRACKED);
    const d = bfs(lv, to, pass), W = lv.W, out = [];
    let [x, z] = from; if (d[z * W + x] < 0) return null;
    while (d[z * W + x] > 0){ out.push([x, z]); const n = DIRS.map(([a, b]) => [x + a, z + b]).find(([a, b]) => d[b * W + a] === d[z * W + x] - 1); [x, z] = n; }
    out.push([x, z]); return out; },
  iceLeft(i, j){ const w = world.water.get(j * lv.W + i); return w ? Math.max(0, w.frozenUntil - simTime) : null; },
  get icons(){ return icons; },
  get shrine(){ return shrine; }, get trans(){ return trans; }, enterShrine: (k) => enterShrine(world.gates[k]), leaveShrine,
  tileOf(x, z){ return [Math.floor(x / TILE), Math.floor(z / TILE)]; },
  center, TILE, T, floorAt, solidAt: (x, z) => solidAt(x, z),
  timeRender(){ const t = performance.now(); composer.render(); renderer.getContext().finish(); return performance.now() - t; },
  info(){ return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries }; },
  torch(on){ held.visible = heldFlame.visible = on; handLight.visible = on; },
};
