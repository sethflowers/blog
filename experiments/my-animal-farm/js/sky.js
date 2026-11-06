// The sky, the sun and the light. A gradient sky dome with a sun disc and haze, a sun that moves with
// the time of day (warm at dawn and dusk, dark blue at night with stars), soft shadows that follow you,
// and fog that matches the horizon.
import * as THREE from 'three';
import { clamp, lerp } from './util.js';

const vert = `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`;
const frag = `
uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunDir; uniform vec3 sunCol; uniform float stars; uniform float cloud; uniform float time;
varying vec3 vDir;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float t = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ t += a * n2(p); p *= 2.03; a *= 0.5; } return t; }
void main(){
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 c = y > 0.0 ? mix(horizon, top, pow(clamp(y, 0.0, 1.0), 0.55)) : mix(horizon, ground, clamp(-y * 6.0, 0.0, 1.0));
  float s = max(dot(d, sunDir), 0.0);
  c += sunCol * (pow(s, 8.0) * 0.25 + pow(s, 64.0) * 0.4) ;
  c += sunCol * smoothstep(0.9993, 0.9997, s) * 6.0;
  // clouds: soft fbm on a plane overhead
  float cloudK = 0.0;
  if (y > 0.02){
    vec2 uv = d.xz / (y + 0.08) * 1.4;
    float k = smoothstep(0.48, 0.78, fbm(uv + vec2(cloud, cloud * 0.3)));
    cloudK = k * smoothstep(0.02, 0.25, y);
    vec3 cc = mix(horizon * 1.05, vec3(1.0), 0.6) * (0.75 + 0.35 * s) + sunCol * pow(s, 4.0) * 0.4;
    c = mix(c, cc, k * smoothstep(0.02, 0.25, y) * 0.85);
  }
  // stars at night: scattered evenly over the sky (cells in 3D direction space, one possible star
  // in each, at a random spot), mostly faint with a few bright ones, slightly blue or gold, twinkling,
  // and the faint glow of the Milky Way across the sky. Clouds hide them.
  if (stars > 0.0 && y > -0.02){
    float fade = stars * smoothstep(-0.02, 0.25, y) * (1.0 - cloudK * 0.9);
    vec3 n = normalize(vec3(0.42, 0.62, -0.66));
    float band = exp(-pow(dot(d, n) / 0.16, 2.0));
    float glow = band * (0.35 + 0.65 * fbm(vec2(atan(d.z, d.x) * 3.0, d.y * 6.0)));
    c += vec3(0.035, 0.04, 0.055) * glow * fade * smoothstep(0.1, 0.5, y);
    for (int L = 0; L < 2; L++){
      float scale = L == 0 ? 90.0 : 190.0;
      vec3 p = d * scale, cell = floor(p), f = fract(p);
      float h1 = h3(cell + float(L) * 17.0);
      float thresh = L == 0 ? 0.93 : 0.9 - band * 0.25;
      if (h1 > thresh){
        vec3 o = vec3(h3(cell + 1.3), h3(cell + 2.7), h3(cell + 4.1)) * 0.6 + 0.2;
        float r = length(f - o);
        float mag = pow((h1 - thresh) / (1.0 - thresh), L == 0 ? 6.0 : 2.0);
        float b = smoothstep(L == 0 ? 0.16 : 0.12, 0.0, r) * (L == 0 ? 0.3 + mag * 2.6 : 0.12 + mag * 0.35);
        float tw = 0.75 + 0.25 * sin(time * (2.0 + h1 * 5.0) + h1 * 80.0);
        vec3 tint = mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.88, 0.7), h3(cell + 7.7));
        c += tint * b * tw * fade;
      }
    }
  }
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

export class Sky {
  constructor(scene, renderer){
    this.scene = scene;
    this.uniforms = {
      top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, ground: { value: new THREE.Color(0x4a5a3a) },
      sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color() }, stars: { value: 0 }, cloud: { value: 0 }, time: { value: 0 },
    };
    const m = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, fog: false });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), m);
    this.dome.renderOrder = -1; this.dome.frustumCulled = false;
    scene.add(this.dome);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x5a4a32, 0.9);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.6);
    this.sun.castShadow = true;
    const s = this.sun.shadow;
    s.mapSize.set(2048, 2048); s.bias = -0.0004; s.normalBias = 0.03; s.radius = 3;
    const c = s.camera; c.left = -40; c.right = 40; c.top = 40; c.bottom = -40; c.near = 1; c.far = 220;
    scene.add(this.sun, this.sun.target);
    scene.fog = new THREE.Fog(0xcfe0ee, 80, 520);
    this.sunDir = new THREE.Vector3();
    this.light = 1;
  }
  setShadowQuality(size, extent){
    const s = this.sun.shadow; s.mapSize.set(size, size);
    if (s.map){ s.map.dispose(); s.map = null; }
    const c = s.camera; c.left = c.bottom = -extent; c.right = c.top = extent; c.updateProjectionMatrix();
  }
  // minutes: time of day in minutes (0..1440); focus: where shadows are needed most
  update(minutes, focus, dt){
    const t = minutes / 1440;                     // 0 midnight, .5 noon
    const ang = (t - 0.25) * Math.PI * 2;         // sunrise 6am, sunset 6pm
    const elev = Math.sin(ang), az = Math.cos(ang);
    this.sunDir.set(az * 0.82, elev, -0.42 - elev * 0.1).normalize();
    const day = clamp(elev * 3 + 0.25), golden = clamp(1 - Math.abs(elev) * 4) * (elev > -0.15 ? 1 : 0);
    const U = this.uniforms;
    const topDay = new THREE.Color(0x3d78c8), topNight = new THREE.Color(0x060b1a);
    const horDay = new THREE.Color(0xc6dcef), horNight = new THREE.Color(0x101a30), horGold = new THREE.Color(0xf2a86a);
    U.top.value.copy(topNight).lerp(topDay, day);
    U.horizon.value.copy(horNight).lerp(horDay, day).lerp(horGold, golden * 0.65);
    U.ground.value.set(0x3e4a30).multiplyScalar(0.25 + day * 0.75);
    U.sunDir.value.copy(this.sunDir);
    U.sunCol.value.set(0xfff2d8).lerp(new THREE.Color(0xff9a4a), golden).multiplyScalar(clamp(elev * 4 + 0.6));
    U.stars.value = clamp(-elev * 4);
    U.cloud.value += dt * 0.004; U.time.value += dt;
    // light
    const sunUp = clamp(elev * 5 + 0.1);
    this.sun.intensity = 2.7 * sunUp;
    this.sun.color.set(0xfff4e2).lerp(new THREE.Color(0xffa060), golden * 0.8);
    this.hemi.intensity = 0.42 + day * 0.7;
    this.hemi.color.copy(U.top.value).lerp(new THREE.Color(0xffffff), 0.45);
    this.hemi.groundColor.set(0x6a5a40).multiplyScalar(0.3 + day * 0.7);
    // moonlight at night so you can still see
    if (elev < 0){ this.sun.intensity = 0.6 * clamp(-elev * 4); this.sun.color.set(0x8aa4ff); this.sunDir.multiplyScalar(-1); this.sunDir.y = Math.abs(this.sunDir.y) + 0.3; this.sunDir.normalize(); }
    this.light = day;
    this.scene.fog.color.copy(U.horizon.value);
    // shadows follow you (snapped to texels so they don't shimmer)
    const snap = 0.5, fx = Math.round(focus.x / snap) * snap, fz = Math.round(focus.z / snap) * snap;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx + this.sunDir.x * 100, Math.max(8, this.sunDir.y * 100), fz + this.sunDir.z * 100);
    this.dome.position.copy(focus);
  }
}
