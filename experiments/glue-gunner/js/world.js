// The world: a steel landing deck the size of a football field floating high in an alien sky at dusk,
// on a hanging lump of rock held up by four glowing engines. Floating blocks drift a few metres over
// the deck (and a few just past its edges, for flinging aliens off). Far below, a sea of cloud; far
// away, more floating rocks and a ringed gas giant on the horizon.
import * as THREE from 'three';
import { V, clamp, lerp, rng, vnoise, fbm, Batch, boxUV } from './util.js';

export const HX = 55, HZ = 25;          // the deck's half length and half width (110 × 50 m)
export const LIP = 0.62;                 // the low wall round the edge
export const START = { x: -44, z: 0, yaw: -Math.PI / 2 };   // you start at one end, looking down the field
export const SUN_DIR = V(-0.55, 0.36, 0.62).normalize();

// ---------- textures (drawn once) ----------
function canvas(S){ const c = document.createElement('canvas'); c.width = c.height = S; return [c, c.getContext('2d')]; }
function tex(c, rep = true, srgb = true){ const t = new THREE.CanvasTexture(c); if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
// a height field → normal map
function normalFrom(H, S, k){
  const [c, g] = canvas(S), img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++){
    const h = (xx, yy) => H[((yy + S) % S) * S + ((xx + S) % S)];
    const dx = (h(x + 1, y) - h(x - 1, y)) * k, dy = (h(x, y + 1) - h(x, y - 1)) * k, l = Math.hypot(dx, dy, 1), i = (y * S + x) * 4;
    img.data[i] = (-dx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return tex(c, true, false);
}
// the deck: 2 m steel plates with seams, rivets, scuffs, oil stains and rust (one texture = 4 × 4 m)
function deckTextures(){
  const S = 512, [c, g] = canvas(S), img = g.createImageData(S, S), H = new Float32Array(S * S), R = rng(5);
  const [rc, rg] = canvas(S), rimg = rg.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++){
    const u = x / S, v = y / S;
    const n = fbm(u * 8, v * 8, 4, 1, 8), n2 = vnoise(u * 60, v * 60, 2, 60), stain = fbm(u * 3 + 7, v * 3, 3, 4, 3);
    // plate seams every half texture (2 m), panel lines every quarter in alternate plates
    const px = (u * 2) % 1, py = (v * 2) % 1;
    const seam = Math.min(px, 1 - px, py, 1 - py);
    const groove = seam < 0.006 ? 1 : seam < 0.012 ? 0.4 : 0;
    // tread pattern: little raised diamonds on every other plate
    const plate = (Math.floor(u * 2) + Math.floor(v * 2)) % 2;
    const dx = (u * 40) % 1, dy = (v * 40) % 1;
    const tread = plate ? Math.max(0, 1 - Math.abs(dx - 0.5) * 6 - Math.abs(dy - 0.5) * 2) * (Math.floor(u * 40) % 2 ? 1 : 0) : 0;
    let h = 0.5 + n * 0.08 - groove * 0.5 + tread * 0.12 + n2 * 0.02;
    // rivets along the seams
    const rx = (u * 16) % 1, ry = (v * 16) % 1;
    if ((seam < 0.035) && Math.hypot(rx - 0.5, ry - 0.5) < 0.16 && (px < 0.04 || px > 0.96 || py < 0.04 || py > 0.96)) h += 0.25 * (1 - Math.hypot(rx - 0.5, ry - 0.5) / 0.16);
    H[y * S + x] = h;
    // colour: dark gunmetal, oil-stained, rust in the seams, worn bright where feet go
    let r = 52 + n * 30, gg = 56 + n * 30, b = 60 + n * 28;
    const oil = clamp((stain - 0.55) * 4); r *= 1 - oil * 0.45; gg *= 1 - oil * 0.45; b *= 1 - oil * 0.4;
    const rust = groove * 0.7 + clamp((fbm(u * 14, v * 14, 3, 9, 14) - 0.62) * 3) * 0.5;
    r = lerp(r, 92, rust); gg = lerp(gg, 52, rust); b = lerp(b, 34, rust);
    const wear = tread * 0.5 + n2 * 0.15; r += wear * 40; gg += wear * 40; b += wear * 42;
    const i = (y * S + x) * 4;
    img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = b; img.data[i + 3] = 255;
    const rough = clamp(0.62 + n * 0.2 - oil * 0.35 - tread * 0.25 + rust * 0.25) * 255;
    rimg.data[i] = rimg.data[i + 1] = rimg.data[i + 2] = rough; rimg.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0); rg.putImageData(rimg, 0, 0);
  // scratches
  g.globalAlpha = 0.25; g.strokeStyle = '#9aa0a8'; g.lineWidth = 1;
  for (let i = 0; i < 90; i++){ const x = R() * S, y = R() * S, a = R() * 6.28, l = 8 + R() * 40; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
  g.globalAlpha = 1;
  return { map: tex(c), normalMap: normalFrom(H, S, 6), roughnessMap: tex(rc, true, false) };
}
function stripeTexture(){
  const [c, g] = canvas(256);
  g.fillStyle = '#d8a400'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#141414';
  for (let i = -4; i < 8; i++){ g.beginPath(); g.moveTo(i * 64, 256); g.lineTo(i * 64 + 32, 256); g.lineTo(i * 64 + 32 + 256, 0); g.lineTo(i * 64 + 256, 0); g.fill(); }
  // grime
  const R = rng(9);
  for (let i = 0; i < 1400; i++){ g.fillStyle = `rgba(30,20,10,${R() * 0.18})`; g.fillRect(R() * 256, R() * 256, 2 + R() * 6, 2 + R() * 6); }
  return tex(c);
}
function crateTexture(){
  const [c, g] = canvas(256), R = rng(4);
  g.fillStyle = '#3e4a3a'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 3000; i++){ g.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '255,255,255'},${R() * 0.05})`; g.fillRect(R() * 256, R() * 256, 3, 3); }
  g.strokeStyle = '#262e24'; g.lineWidth = 14; g.strokeRect(7, 7, 242, 242);
  g.lineWidth = 6; for (let x = 40; x < 240; x += 36){ g.beginPath(); g.moveTo(x, 14); g.lineTo(x, 242); g.stroke(); }
  g.fillStyle = '#c8b030'; g.fillRect(150, 30, 80, 28); g.fillStyle = '#1a1a1a'; g.font = 'bold 20px monospace'; g.fillText('G-7', 166, 51);
  g.fillStyle = 'rgba(120,60,20,0.5)'; for (let i = 0; i < 40; i++) g.fillRect(R() * 256, 230 + R() * 20, 4 + R() * 10, 3 + R() * 8);
  return tex(c);
}
// the floating blocks: dark alloy with a glowing cyan inlay round each face
function blockTextures(){
  const S = 256, [c, g] = canvas(S), [ec, eg] = canvas(S), R = rng(12);
  g.fillStyle = '#1c2026'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2500; i++){ g.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '160,180,200'},${R() * 0.06})`; g.fillRect(R() * S, R() * S, 2 + R() * 4, 2 + R() * 4); }
  g.strokeStyle = '#3a414c'; g.lineWidth = 10; g.strokeRect(5, 5, S - 10, S - 10);
  eg.fillStyle = '#000'; eg.fillRect(0, 0, S, S);
  for (const k of [eg, g]){
    k.strokeStyle = k === eg ? '#3fe8ff' : '#2a7a8a'; k.lineWidth = 5;
    k.strokeRect(30, 30, S - 60, S - 60);
    k.beginPath(); k.moveTo(30, S / 2); k.lineTo(80, S / 2); k.moveTo(S - 30, S / 2); k.lineTo(S - 80, S / 2); k.moveTo(S / 2, 30); k.lineTo(S / 2, 80); k.moveTo(S / 2, S - 30); k.lineTo(S / 2, S - 80); k.stroke();
    k.beginPath(); k.arc(S / 2, S / 2, 26, 0, 7); k.stroke();
  }
  return { map: tex(c, false), emissiveMap: tex(ec, false) };
}
function rockTexture(){
  const S = 256, [c, g] = canvas(S), img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++){
    const u = x / S, v = y / S, n = fbm(u * 6, v * 6, 5, 3, 6), st = Math.abs(Math.sin(v * 40 + n * 6));
    const i = (y * S + x) * 4, k = 60 + n * 70 - st * 12;
    img.data[i] = k * 1.0; img.data[i + 1] = k * 0.86; img.data[i + 2] = k * 0.78; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return tex(c);
}
function planetTexture(){
  const W = 512, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
    const v = y / H, u = x / W;
    const band = Math.sin(v * 38 + fbm(u * 6, v * 9, 3, 2, [6, 9]) * 4.5) * 0.5 + 0.5;
    const storm = Math.exp(-Math.pow((u - 0.3) / 0.05, 2) - Math.pow((v - 0.62) / 0.03, 2));
    const i = (y * W + x) * 4;
    img.data[i] = lerp(150, 225, band) + storm * 30; img.data[i + 1] = lerp(90, 160, band) - storm * 40; img.data[i + 2] = lerp(110, 130, band) - storm * 50; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function ringTexture(){
  const c = document.createElement('canvas'); c.width = 512; c.height = 4; const g = c.getContext('2d');
  for (let x = 0; x < 512; x++){ const v = x / 512, a = clamp(Math.sin(v * 90) * 0.3 + 0.5 + vnoise(v * 40, 0, 3) * 0.4) * clamp(v * 8) * clamp((1 - v) * 6) * (v > 0.55 && v < 0.6 ? 0.1 : 1); g.fillStyle = `rgba(220,190,170,${a})`; g.fillRect(x, 0, 1, 4); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// a slab test for a ray against an axis-aligned box: returns { t, n } or null
const _n = V();
function rayBox(o, d, min, max, far){
  let t0 = 0, t1 = far, axis = -1, sign = 0;
  for (let k = 0; k < 3; k++){
    const oo = o.getComponent(k), dd = d.getComponent(k), lo = min.getComponent(k), hi = max.getComponent(k);
    if (Math.abs(dd) < 1e-9){ if (oo < lo || oo > hi) return null; continue; }
    let a = (lo - oo) / dd, b = (hi - oo) / dd, s = -1;
    if (a > b){ const t = a; a = b; b = t; s = 1; }
    if (a > t0){ t0 = a; axis = k; sign = s; }
    if (b < t1) t1 = b;
    if (t0 > t1) return null;
  }
  if (axis < 0) return null;   // (starting inside)
  _n.set(0, 0, 0).setComponent(axis, sign);
  return { t: t0, n: _n.clone() };
}

export class World {
  constructor(scene){
    this.scene = scene;
    this.root = new THREE.Group(); scene.add(this.root);
    this.boxes = [];          // solid boxes: { min, max, tall } (tall ones also stop shots... all do)
    this.crates = [];
    this.flat = [];           // things that are flat ground (for anything that needs to skip them)
    this.buildSky();
    this.buildDeck();
    this.buildBlocks();
    this.buildFar();
  }

  // ---------- the sky: dusk, stars coming out, a ringed gas giant, a sea of cloud far below ----------
  buildSky(){
    const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { sun: { value: SUN_DIR.clone() } },
      vertexShader: 'varying vec3 d; void main(){ d = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }',
      fragmentShader: `uniform vec3 sun; varying vec3 d;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
        void main(){
          vec3 v = normalize(d); float y = v.y;
          float s = max(dot(v, sun), 0.0);
          // deep violet overhead, burning orange and rose at the horizon toward the sun, cold purple away from it
          vec3 top = vec3(0.012, 0.01, 0.035);
          vec3 mid = mix(vec3(0.07, 0.03, 0.09), vec3(0.42, 0.12, 0.1), pow(s, 2.0));
          vec3 hor = mix(vec3(0.17, 0.07, 0.14), vec3(1.0, 0.4, 0.13), pow(s, 3.0));
          vec3 c = y > 0.0 ? mix(mix(hor, mid, smoothstep(0.0, 0.14, y)), top, smoothstep(0.1, 0.55, y)) : mix(hor, vec3(0.08, 0.035, 0.07), smoothstep(0.0, -0.25, y));
          // the sun's glow and disc
          c += vec3(1.0, 0.55, 0.25) * pow(s, 60.0) * 1.2 + vec3(1.0, 0.85, 0.6) * smoothstep(0.9993, 0.9997, s) * 4.0;
          // streaks of high cloud, lit from below by the sunset
          if (y > 0.0){
            vec2 uv = v.xz / (y + 0.08) * vec2(1.4, 4.0);
            float k = n(uv * 1.2) * 0.55 + n(uv * 2.7) * 0.3 + n(uv * 6.0) * 0.15;
            float cl = smoothstep(0.55, 0.85, k) * smoothstep(0.02, 0.12, y) * (1.0 - smoothstep(0.3, 0.7, y));
            c = mix(c, mix(vec3(0.12, 0.05, 0.1), vec3(0.9, 0.38, 0.18), pow(s, 2.0)), cl * 0.6);
            // stars, scattered (not on a grid), showing in the dark overhead
            vec3 sv = floor(v * 260.0); float st = h(sv.xy + sv.z * 17.0);
            c += vec3(0.9, 0.9, 1.0) * step(0.9975, st) * smoothstep(0.15, 0.5, y) * (0.5 + 0.5 * h(sv.zy));
          }
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    sky.frustumCulled = false; sky.renderOrder = -2; this.sky = sky; this.scene.add(sky);
    // the gas giant and its rings, low on the horizon opposite the sun
    const pg = new THREE.Group();
    const planet = new THREE.Mesh(new THREE.SphereGeometry(150, 48, 32), new THREE.MeshBasicMaterial({ map: planetTexture(), color: '#6a4a58', fog: false }));
    const ring = new THREE.Mesh(new THREE.RingGeometry(190, 330, 96, 1), new THREE.MeshBasicMaterial({ map: ringTexture(), transparent: true, side: THREE.DoubleSide, fog: false, depthWrite: false, opacity: 0.5 }));
    { const p = ring.geometry.attributes.position, uv = ring.geometry.attributes.uv; for (let i = 0; i < p.count; i++){ const r = Math.hypot(p.getX(i), p.getY(i)); uv.setXY(i, (r - 190) / 140, 0.5); } }
    ring.rotation.x = -Math.PI / 2 + 0.32; ring.rotation.y = 0.2;
    pg.add(planet, ring);
    this.planetDir = V(0.85, 0.13, -0.6).normalize();
    pg.scale.setScalar(0.75);
    pg.position.copy(this.planetDir).multiplyScalar(820);
    planet.rotation.z = 0.32;
    // lit by the sun only (it is far beyond the fog)
    this.planet = pg; this.scene.add(pg);
    pg.traverse((o) => { o.renderOrder = -1; });
    // the cloud sea far below
    const clouds = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000, 1, 1).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: { t: { value: 0 }, sun: { value: SUN_DIR.clone() } },
      vertexShader: 'varying vec3 w; void main(){ vec4 p = modelMatrix * vec4(position, 1.0); w = p.xyz; gl_Position = projectionMatrix * viewMatrix * p; }',
      fragmentShader: `uniform float t; uniform vec3 sun; varying vec3 w;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
        float fb(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * n(p); p *= 2.03; a *= 0.5; } return s; }
        void main(){
          vec2 p = w.xz * 0.004 + vec2(t * 0.004, t * 0.0015);
          float k = fb(p + fb(p * 1.7 + 3.0) * 0.6);
          vec3 dir = normalize(w - cameraPosition);
          float s = pow(max(dot(normalize(vec3(dir.x, 0.0, dir.z)), normalize(vec3(sun.x, 0.0, sun.z))), 0.0), 3.0);
          vec3 lo = vec3(0.05, 0.025, 0.06), hi = mix(vec3(0.22, 0.1, 0.17), vec3(0.85, 0.38, 0.18), s);
          vec3 c = mix(lo, hi, smoothstep(0.35, 0.8, k));
          // fade into the haze at the horizon
          float far = length(w.xz - cameraPosition.xz);
          vec3 haze = mix(vec3(0.17, 0.07, 0.14), vec3(1.0, 0.4, 0.13), s * 0.8);
          c = mix(c, haze, smoothstep(300.0, 1900.0, far));
          gl_FragColor = vec4(c, smoothstep(2000.0, 1500.0, far));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    clouds.position.y = -140; clouds.renderOrder = -1; clouds.frustumCulled = false;
    this.clouds = clouds; this.scene.add(clouds);
  }

  // ---------- the deck ----------
  buildDeck(){
    const B = new Batch();
    const dt = deckTextures();
    const deckMat = new THREE.MeshStandardMaterial({ ...dt, metalness: 0.55, roughness: 1, envMapIntensity: 0.6 });
    deckMat.name = 'deck';
    // the slab (top at y = 0)
    B.box(HX * 2, 1.6, HZ * 2, deckMat, 0, -0.8, 0, 0, 0.25);
    // an underside band of girders
    const steel = new THREE.MeshStandardMaterial({ color: '#2a2e34', metalness: 0.7, roughness: 0.5, name: 'steel' });
    B.box(HX * 2 - 1, 1.2, HZ * 2 - 1, steel, 0, -2.22, 0);
    // the lip round the edge: hazard stripes inside, steel outside
    const stripe = new THREE.MeshStandardMaterial({ map: stripeTexture(), metalness: 0.2, roughness: 0.6, name: 'stripe' });
    B.box(HX * 2 + 0.1, LIP + 0.05, 0.45, stripe, 0, LIP / 2 - 0.025 + 0.01, HZ - 0.2, 0, 1.6);
    B.box(HX * 2 + 0.1, LIP + 0.05, 0.45, stripe, 0, LIP / 2 - 0.025 + 0.01, -(HZ - 0.2), 0, 1.6);
    B.box(0.45, LIP + 0.03, HZ * 2 - 0.5, stripe, HX - 0.2, LIP / 2 - 0.035, 0, 0, 1.6);
    B.box(0.45, LIP + 0.03, HZ * 2 - 0.5, stripe, -(HX - 0.2), LIP / 2 - 0.035, 0, 0, 1.6);
    for (const [x, z, sx, sz] of [[0, HZ - 0.2, HX * 2 + 0.1, 0.45], [0, -(HZ - 0.2), HX * 2 + 0.1, 0.45], [HX - 0.2, 0, 0.45, HZ * 2 - 0.5], [-(HX - 0.2), 0, 0.45, HZ * 2 - 0.5]])
      this.boxes.push({ min: V(x - sx / 2, -2, z - sz / 2), max: V(x + sx / 2, LIP, z + sz / 2), lip: true });
    // light towers at the corners and halfway: a mast with a lamp head (glowing)
    const lamp = new THREE.MeshStandardMaterial({ color: '#fff2d0', emissive: '#ffd890', emissiveIntensity: 2.5, name: 'lamp' });
    for (const [x, z] of [[-50, -20], [-50, 20], [50, -20], [50, 20], [0, -21.5], [0, 21.5]]){
      B.box(0.35, 6.7, 0.35, steel, x, 3.65, z);
      B.box(1.4, 0.3, 0.6, steel, x, 7.05, z);
      B.box(1.2, 0.08, 0.45, lamp, x, 6.87, z);
      B.box(0.9, 0.5, 0.9, steel, x, 0.2, z);
      this.boxes.push({ min: V(x - 0.45, 0, z - 0.45), max: V(x + 0.45, 7.2, z + 0.45) });
    }
    // markings: lines across the field every 10 m (it's football-field sized), a centre circle, end zones
    const paint = new THREE.MeshStandardMaterial({ color: '#d8d4c4', roughness: 0.8, metalness: 0.1, transparent: true, opacity: 0.55, depthWrite: false, name: 'paint' });
    const lines = [];
    for (let x = -50; x <= 50; x += 10) lines.push(new THREE.PlaneGeometry(0.2, HZ * 2 - 2).rotateX(-Math.PI / 2).translate(x, 0.012, 0));
    for (const z of [-(HZ - 1.2), HZ - 1.2]) lines.push(new THREE.PlaneGeometry(HX * 2 - 2, 0.2).rotateX(-Math.PI / 2).translate(0, 0.012, z));
    lines.push(new THREE.RingGeometry(8.8, 9.1, 64).rotateX(-Math.PI / 2).translate(0, 0.012, 0));
    for (const g of lines) B.add(g, paint);
    const endZone = new THREE.MeshStandardMaterial({ color: '#8a1a18', roughness: 0.9, transparent: true, opacity: 0.35, depthWrite: false, name: 'endzone' });
    B.add(new THREE.PlaneGeometry(4, HZ * 2 - 2.6).rotateX(-Math.PI / 2).translate(-52.4, 0.012, 0), endZone);
    B.add(new THREE.PlaneGeometry(4, HZ * 2 - 2.6).rotateX(-Math.PI / 2).translate(52.4, 0.012, 0), endZone);
    // cargo crates to hide behind (and stick things to)
    const crate = new THREE.MeshStandardMaterial({ map: crateTexture(), metalness: 0.45, roughness: 0.6, name: 'crate' });
    const R = rng(21);
    for (const [x, z, n] of [[-28, -9, 3], [-14, 13, 1], [-3, -14, 2], [12, 8, 1], [24, -12, 3], [36, 14, 2], [-36, 15, 1], [40, -4, 2], [-20, 1, 1], [6, 19, 1]]){
      // a crate, maybe one stacked on it, maybe one beside it
      const s0 = 1.8 + R() * 0.4;
      const put = (cx, cy, cz, s) => {
        B.box(s, s, s, crate, cx, cy + s / 2, cz, 0, 1 / s);
        this.boxes.push({ min: V(cx - s / 2, cy, cz - s / 2), max: V(cx + s / 2, cy + s, cz + s / 2) });
        this.crates.push({ x: cx, z: cz, s, top: cy + s });
      };
      put(x, 0.004, z, s0);
      if (n >= 2){ const s1 = s0 - 0.25 - R() * 0.2; put(x + (R() - 0.5) * 0.2, 0.004 + s0 + 0.012, z + (R() - 0.5) * 0.2, s1); }
      if (n >= 3){ const s2 = 1.6 + R() * 0.3; put(x + s0 / 2 + s2 / 2 + 0.06, 0.004, z + (R() - 0.5) * 0.4, s2); }
    }
    this.deckMeshes = B.build(this.root, { shadows: true, receive: true });
    for (const m of this.deckMeshes) if (m.material.name === 'paint' || m.material.name === 'endzone'){ m.castShadow = false; m.renderOrder = 1; this.flat.push(m); }
    // the deck surfaces themselves stop shots
    this.boxes.push({ min: V(-HX, -3, -HZ), max: V(HX, 0, HZ), deck: true });

    // the rock it sits on: a great hanging lump, jagged and layered
    const rg = new THREE.SphereGeometry(1, 64, 32, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    const p = rg.attributes.position, col = [];
    for (let i = 0; i < p.count; i++){
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const a = Math.atan2(z, x), depth = -y;
      const n = fbm(a * 3 + 10, depth * 4, 4, 7) - 0.5;
      const r = 1 + n * 0.35 * Math.min(1, depth * 4) + Math.sin(depth * 30 + a * 2) * 0.02;
      x *= r; z *= r;
      // drip down into a spike
      const drop = depth > 0.6 ? Math.pow((depth - 0.6) / 0.4, 2) * 0.6 : 0;
      p.setXYZ(i, x * 49, y * 42 * (1 + drop) - 1.4, z * 22.5);
      const k = 0.55 + n * 0.6;
      col.push(0.42 * k, 0.34 * k, 0.31 * k);
    }
    rg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    rg.computeVertexNormals();
    const rockTex = rockTexture(); rockTex.repeat.set(8, 4);
    const rock = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ map: rockTex, vertexColors: true, roughness: 0.95 }));
    rock.receiveShadow = true; this.root.add(rock);
    // glowing crystal at the bottom, four engines under the corners
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color('#66e6ff').multiplyScalar(1.6), toneMapped: false });
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(4, 0).scale(1, 3, 1), glow); crystal.position.set(0, -78, 0); this.root.add(crystal);
    this.crystal = crystal;
    const eng = new THREE.MeshStandardMaterial({ color: '#30343a', metalness: 0.8, roughness: 0.4 });
    for (const [x, z] of [[-46, -18], [-46, 18], [46, -18], [46, 18]]){
      const e = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 2.4, 3, 20), eng); e.position.set(x, -4.2, z); this.root.add(e);
      const ringM = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.25, 8, 24).rotateX(Math.PI / 2), glow); ringM.position.set(x, -5.75, z); this.root.add(ringM);
      const fl = new THREE.Mesh(new THREE.ConeGeometry(2.1, 9, 20, 1, true).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: '#4ad8ff', transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      fl.position.set(x, -10.3, z); this.root.add(fl);
    }
  }

  // ---------- the floating blocks ----------
  buildBlocks(){
    const R = rng(33);
    const list = [];
    // over the deck: a loose grid with jitter, 3.5–7.5 m up
    for (let gx = -4; gx <= 4; gx++) for (let gz = -1; gz <= 1; gz++){
      if (R() < 0.18) continue;
      const x = gx * 11.5 + (R() - 0.5) * 6, z = gz * 15 + (R() - 0.5) * 7;
      if (Math.hypot(x - START.x, z - START.z) < 5) continue;
      list.push({ x, z, y: 4 + R() * 3.5, s: 1.2 + R() * 1.2 });
    }
    // past the edges: pull aliens off the deck with these
    for (const [x, z] of [[-30, -31], [5, -32], [35, -30], [-15, 31], [22, 32], [61, 8], [-61, -6]]) list.push({ x, z, y: 3 + R() * 2.5, s: 1.6 + R() * 0.8 });
    const bt = blockTextures();
    const mat = new THREE.MeshStandardMaterial({ map: bt.map, emissiveMap: bt.emissiveMap, emissive: '#ffffff', emissiveIntensity: 1.6, metalness: 0.75, roughness: 0.35 });
    const geo = new THREE.BoxGeometry(1, 1, 1);
    this.blockMesh = new THREE.InstancedMesh(geo, mat, list.length);
    this.blockMesh.castShadow = true; this.blockMesh.receiveShadow = true;
    // a soft glow under each one (its lifting field)
    const glowTex = (() => { const [c, g] = canvas(128); const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64); gr.addColorStop(0, 'rgba(120,240,255,0.9)'); gr.addColorStop(0.4, 'rgba(60,200,255,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return tex(c, false); })();
    this.glowMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), list.length);
    this.glowMesh.frustumCulled = false;
    this.blocks = list.map((b, i) => ({ i, base: V(b.x, b.y, b.z), pos: V(b.x, b.y, b.z), s: b.s, ph: R() * 6.28, sp: 0.4 + R() * 0.4, vel: V() }));
    this.root.add(this.blockMesh, this.glowMesh);
    this.updateBlocks(0);
  }
  updateBlocks(t){
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = V();
    for (const b of this.blocks){
      const y = b.base.y + Math.sin(t * b.sp + b.ph) * 0.3;
      b.vel.set(0, (y - b.pos.y), 0);
      b.pos.set(b.base.x, y, b.base.z);
      m.compose(b.pos, q, sc.setScalar(b.s)); this.blockMesh.setMatrixAt(b.i, m);
      m.compose(V(b.pos.x, b.pos.y - b.s / 2 - 0.25, b.pos.z), q, sc.set(b.s * 2.2, 1, b.s * 2.2)); this.glowMesh.setMatrixAt(b.i, m);
    }
    this.blockMesh.instanceMatrix.needsUpdate = true; this.glowMesh.instanceMatrix.needsUpdate = true;
    this.blockMesh.computeBoundingSphere();
  }

  // ---------- far away: more floating rocks ----------
  buildFar(){
    const R = rng(44);
    const g = new THREE.IcosahedronGeometry(1, 3);
    const p = g.attributes.position, col = [];
    for (let i = 0; i < p.count; i++){
      const v = V(p.getX(i), p.getY(i), p.getZ(i));
      const n = fbm(v.x * 2 + 5, v.z * 2 + v.y * 1.3, 4, 2);
      let r = 0.8 + n * 0.5;
      if (v.y > 0.3) r *= 0.75 + (1 - v.y) * 0.3;   // flatter tops
      if (v.y < 0) v.y *= 1.8;                       // hanging bottoms
      v.multiplyScalar(r); p.setXYZ(i, v.x, v.y, v.z);
      const k = v.y > 0.45 ? [0.25, 0.3, 0.2] : [0.36, 0.3, 0.28];
      col.push(...k.map((c) => c * (0.2 + n * 0.25)));
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const n = 26, mesh = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }), n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (let i = 0; i < n; i++){
      const a = R() * Math.PI * 2, d = 170 + R() * 380, s = 6 + R() * 26;
      q.setFromEuler(new THREE.Euler(0, R() * 6, 0));
      m.compose(V(Math.cos(a) * d, -40 + R() * 90, Math.sin(a) * d), q, V(s * (1 + R()), s, s * (1 + R())));
      mesh.setMatrixAt(i, m);
    }
    mesh.computeBoundingSphere();
    this.root.add(mesh);
  }

  update(t){
    this.updateBlocks(t);
    this.clouds.material.uniforms.t.value = t;
    this.crystal.rotation.y = t * 0.3;
  }

  // ---------- questions the game asks ----------
  onDeck(x, z){ return Math.abs(x) < HX && Math.abs(z) < HZ; }
  clampDeck(v, margin = 1){ v.x = clamp(v.x, -HX + margin, HX - margin); v.z = clamp(v.z, -HZ + margin, HZ - margin); return v; }
  // push a walker (circle of radius r at p, on the deck) out of the lip, crates and masts
  collideGround(p, r){
    const lim = 0.45 + r;
    p.x = clamp(p.x, -HX + lim, HX - lim); p.z = clamp(p.z, -HZ + lim, HZ - lim);
    for (const b of this.boxes){
      if (b.deck || b.lip) continue;
      const cx = clamp(p.x, b.min.x, b.max.x), cz = clamp(p.z, b.min.z, b.max.z);
      const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
      if (d2 < r * r){
        if (d2 > 1e-8){ const d = Math.sqrt(d2); p.x = cx + dx / d * r; p.z = cz + dz / d * r; }
        else {
          // inside: out the nearest side
          const o = [p.x - b.min.x, b.max.x - p.x, p.z - b.min.z, b.max.z - p.z], k = o.indexOf(Math.min(...o));
          if (k === 0) p.x = b.min.x - r; else if (k === 1) p.x = b.max.x + r; else if (k === 2) p.z = b.min.z - r; else p.z = b.max.z + r;
        }
      }
    }
  }
  // the nearest solid thing along a ray: { t, point, normal, block? } or null
  ray(o, d, far){
    let best = null;
    for (const b of this.boxes){
      const h = rayBox(o, d, b.min, b.max, far);
      if (h && (!best || h.t < best.t)) best = { t: h.t, normal: h.n, kind: 'world' };
    }
    const mn = V(), mx = V();
    for (const b of this.blocks){
      const hs = b.s / 2; mn.set(b.pos.x - hs, b.pos.y - hs, b.pos.z - hs); mx.set(b.pos.x + hs, b.pos.y + hs, b.pos.z + hs);
      const h = rayBox(o, d, mn, mx, far);
      if (h && (!best || h.t < best.t)) best = { t: h.t, normal: h.n, kind: 'block', block: b };
    }
    if (best) best.point = o.clone().addScaledVector(d, best.t);
    return best;
  }
}
