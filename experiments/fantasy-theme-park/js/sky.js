// The sky over the park: a dome with a sun and haze, the sun's light and shadows, a sky light, fog,
// stars and a moon at night, and an environment map (taken from the sky now and then) so metal and
// glass reflect it. Lamps' glow follows how dark it is (materials.glow).
import * as THREE from 'three';
import { clamp, lerp, smooth, rng } from './util.js';
import { glow, winGlow, lampGlass } from './materials.js';

const DOME_VS = `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`;
const DOME_FS = `
uniform vec3 sunDir; uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunCol; uniform float glowAmt;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 c = mix(horizon, top, pow(clamp(h, 0.0, 1.0), 0.55));
  c = mix(c, ground, smoothstep(0.0, -0.08, h));
  float s = max(dot(d, sunDir), 0.0);
  c += sunCol * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.35 * glowAmt + pow(s, 3.0) * 0.12 * glowAmt);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

// colours through the day: [hour, top, horizon, sun colour, sun strength, sky light]
const KEYS = [
  [0, 0x050a18, 0x101828, 0x8090c0, 0.0, 0.10],
  [5, 0x0a1428, 0x2a2a40, 0x8090c0, 0.0, 0.12],
  [6, 0x3a5a90, 0xe8a070, 0xffa060, 0.6, 0.35],
  [7.5, 0x4a80c8, 0xd8d8d0, 0xfff0d8, 2.2, 0.8],
  [12, 0x3a78d0, 0xc8dcec, 0xfff6e8, 3.0, 1.0],
  [17.5, 0x4a80c8, 0xd8d8d0, 0xffecd0, 2.4, 0.85],
  [19.5, 0x3a5088, 0xf0a060, 0xff9050, 1.0, 0.45],
  [20.5, 0x182040, 0x6a4058, 0xff7040, 0.2, 0.2],
  [21.5, 0x060c1c, 0x182032, 0x8090c0, 0.0, 0.11],
  [24, 0x050a18, 0x101828, 0x8090c0, 0.0, 0.10],
];
const c1 = new THREE.Color(), c2 = new THREE.Color();
function key(hour, i){
  let a = KEYS[0], b = KEYS[KEYS.length - 1];
  for (let k = 0; k < KEYS.length - 1; k++) if (hour >= KEYS[k][0] && hour <= KEYS[k + 1][0]){ a = KEYS[k]; b = KEYS[k + 1]; break; }
  const t = smooth((hour - a[0]) / Math.max(0.001, b[0] - a[0]));
  if (typeof a[i] === 'number' && i >= 4) return lerp(a[i], b[i], t);
  return c1.set(a[i]).lerp(c2.set(b[i]), t).clone();
}

export class Sky {
  constructor(scene, renderer){
    this.scene = scene; this.renderer = renderer;
    this.uniforms = { sunDir: { value: new THREE.Vector3(0, 1, 0) }, top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() },
      ground: { value: new THREE.Color(0x48503c) }, sunCol: { value: new THREE.Color() }, glowAmt: { value: 1 } };
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: DOME_VS, fragmentShader: DOME_FS, side: THREE.BackSide, depthWrite: false, fog: false }));
    this.dome.renderOrder = -10; this.dome.frustumCulled = false;
    scene.add(this.dome);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.04;
    this.setShadowSpan(120);
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xc8dcff, 0x506040, 1);
    scene.add(this.hemi);
    scene.fog = new THREE.Fog(0xc8dcec, 300, 2600);
    // stars scattered in 3D on a big shell (not on a grid) and a moon
    const r = rng(4242), pos = [], col = [];
    for (let i = 0; i < 2200; i++){
      const u = r() * 2 - 1, a = r() * Math.PI * 2, rr = Math.sqrt(1 - u * u), d = 3000 + r() * 600;
      if (u < 0.02) continue;
      pos.push(rr * Math.cos(a) * d, u * d, rr * Math.sin(a) * d);
      const b = 0.4 + 0.6 * r() ** 2, w = r(); col.push(b * (0.85 + 0.15 * w), b * 0.9, b * (1.05 - 0.15 * w));
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); sg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.starMat = new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.stars = new THREE.Points(sg, this.starMat); this.stars.frustumCulled = false; this.stars.renderOrder = -9;
    scene.add(this.stars);
    this.moon = new THREE.Mesh(new THREE.CircleGeometry(60, 32), new THREE.MeshBasicMaterial({ color: 0xf0ecdc, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.moon.renderOrder = -8;
    scene.add(this.moon);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envDome = new THREE.Mesh(this.dome.geometry, this.dome.material); this.envScene.add(this.envDome);
    this.envTarget = null; this.lastEnvHour = -99;
    this.night = 0; this.hour = 12;
    this.center = new THREE.Vector3();
  }
  setShadowSpan(span){
    this.span = span;
    const c = this.sun.shadow.camera; c.left = -span; c.right = span; c.top = span; c.bottom = -span; c.near = 1; c.far = span * 4 + 400; c.updateProjectionMatrix();
  }
  // hour: 0..24; center: where the shadows are wanted (the camera's target or the player)
  update(hour, center, cam){
    this.hour = hour;
    // the sun rises in the east (+x) at 6, highest at 13, sets in the west at 20
    const t = (hour - 6) / 14, el = Math.sin(clamp(t, -0.2, 1.2) * Math.PI) * 1.05, az = Math.PI * t;
    const dir = new THREE.Vector3(Math.cos(az), Math.sin(el), 0.35 + 0.3 * Math.sin(el)).normalize();
    if (t < 0 || t > 1) dir.set(Math.cos(az), -0.2, 0.4).normalize();
    this.uniforms.sunDir.value.copy(dir);
    const top = key(hour, 1), hor = key(hour, 2), sc = key(hour, 3), si = key(hour, 4), sky = key(hour, 5);
    this.uniforms.top.value.copy(top); this.uniforms.horizon.value.copy(hor); this.uniforms.sunCol.value.copy(sc);
    this.uniforms.glowAmt.value = clamp(si / 1.5);
    this.uniforms.ground.value.copy(hor).multiplyScalar(0.45);
    // light: the sun from its direction (or the moon at night, faint and blue)
    this.night = clamp(1 - sky / 0.5) ;
    const moonUp = this.night > 0.5;
    const lightDir = moonUp ? new THREE.Vector3(-0.4, 0.8, 0.45).normalize() : dir;
    this.sun.color.copy(moonUp ? c1.set(0x9aaad0) : sc);
    this.sun.intensity = moonUp ? 0.35 : si;
    this.sun.position.copy(center).addScaledVector(lightDir, this.span * 2);
    this.sun.target.position.copy(center);
    this.hemi.color.copy(top).lerp(c1.set(0xffffff), 0.45);
    this.hemi.groundColor.set(0x4a5238).multiplyScalar(0.6 + 0.4 * sky);
    this.hemi.intensity = 0.35 + 1.1 * sky;
    this.scene.fog.color.copy(hor);
    this.renderer.toneMappingExposure = 1.0 + 0.6 * this.night;
    this.starMat.opacity = smooth((this.night - 0.4) / 0.5);
    const md = new THREE.Vector3(-0.4, 0.8, 0.45).normalize();
    this.moon.position.copy(md).multiplyScalar(3200); this.moon.lookAt(0, 0, 0);
    this.moon.material.opacity = this.starMat.opacity;
    glow.emissiveIntensity = 3.2 * smooth((this.night - 0.15) / 0.6);
    winGlow.emissiveIntensity = 0.9 * smooth((this.night - 0.2) / 0.6);
    lampGlass.emissiveIntensity = 1.5 * smooth((this.night - 0.15) / 0.6); lampGlass.opacity = 0.6 + 0.35 * smooth((this.night - 0.15) / 0.6);
    if (cam){ this.dome.position.copy(cam); this.stars.position.copy(cam); this.moon.position.add(cam); }
    // a new reflection map when the light has changed enough
    if (Math.abs(hour - this.lastEnvHour) > 0.5 || !this.envTarget){
      this.lastEnvHour = hour;
      const old = this.envTarget;
      this.envTarget = this.pmrem.fromScene(this.envScene, 0, 1, 5000);
      this.scene.environment = this.envTarget.texture;
      this.scene.environmentIntensity = 0.25 + 0.6 * sky;
      if (old) old.dispose();
    }
  }
}
