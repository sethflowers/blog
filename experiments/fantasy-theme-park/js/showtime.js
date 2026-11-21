// Showtime: weather, fireworks, land music and park photos.
//  - Weather: each day is sunny, cloudy or has a spell of rain; clouds dim the sun, rain falls round you.
//  - Fireworks: launch sites you put down (Park tab); at 9 pm, if the show is on, rockets go up from them in
//    turn, in each site's style (golden willow, rainbow peonies, rings, dragon fire), with bangs.
//  - Music: a gentle tune made in code for the land you're looking at (each theme its own scale, tempo
//    and sound), faded in and out; the menu turns it off.
//  - Photos: Take a photo keeps the view (a small JPEG) in the park's album.
import * as THREE from 'three';
import { spotTexture } from './materials.js';
import { rng, clamp, damp } from './util.js';

export const FIREWORK_STYLES = [['willow', 'Golden willow'], ['peony', 'Rainbow peonies'], ['ring', 'Rings of stars'], ['dragon', 'Dragon fire']];
export const SHOW_H = 21;
const GREY_TOP = new THREE.Color(0x8a96a8), GREY_HOR = new THREE.Color(0xa8b0b8);

export class Showtime {
  constructor(app){
    this.app = app; this.scene = app.scene; this.r = rng(99);
    // rain: streaks falling in a box round the camera
    const n = 2500, pos = new Float32Array(n * 3);
    for (let k = 0; k < n; k++){ pos[k * 3] = (this.r() - 0.5) * 80; pos[k * 3 + 1] = this.r() * 40; pos[k * 3 + 2] = (this.r() - 0.5) * 80; }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.Points(rg, new THREE.PointsMaterial({ color: 0xc8d4e0, size: 0.14, transparent: true, opacity: 0.0, depthWrite: false }));
    this.rain.frustumCulled = false; this.rain.visible = false; this.scene.add(this.rain);
    // fireworks: one pool of sparks
    this.N = 3000; const fp = new Float32Array(this.N * 3), fc = new Float32Array(this.N * 3);
    const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.BufferAttribute(fp, 3)); fg.setAttribute('color', new THREE.BufferAttribute(fc, 3));
    this.sparks = new THREE.Points(fg, new THREE.PointsMaterial({ map: spotTexture(), size: 1.4, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    this.sparks.frustumCulled = false; this.sparks.renderOrder = 9; this.scene.add(this.sparks);
    this.vel = new Float32Array(this.N * 3); this.life = new Float32Array(this.N); this.base = new Float32Array(this.N * 3); this.next = 0;
    this.rockets = []; this.showT = -1; this.cloud = 0; this.wet = 0;
    // music
    this.music = { theme: null, gain: null, t: 0 };
  }
  get S(){ return this.app.park.s; }
  // --- weather: decided each morning, a spell of rain for some of the day ---
  weather(){
    const S = this.S;
    if (!S.weather || S.weather.day !== S.day){
      const R = rng(S.day * 7919 + (S.seed || 1)), x = R();
      S.weather = { day: S.day, kind: x < 0.55 ? 'sunny' : x < 0.82 ? 'cloudy' : 'rain', from: 10 + R() * 6, to: 0 };
      S.weather.to = S.weather.from + 1 + R() * 2.5;
    }
    const h = S.time / 60, W = S.weather;
    const raining = W.kind === 'rain' && h >= W.from && h < W.to;
    return { kind: W.kind, raining, cloud: W.kind === 'sunny' ? 0 : W.kind === 'cloudy' ? 0.55 : raining ? 0.9 : 0.6 };
  }
  // --- every frame ---
  frame(dt, gdt, camPos){
    const w = this.weather(), sky = this.app.sky;
    this.cloud = damp(this.cloud, w.cloud, 0.3, dt); this.wet = damp(this.wet, w.raining ? 1 : 0, 0.5, dt);
    sky.cloud = this.cloud;
    sky.sun.intensity *= 1 - 0.65 * this.cloud; sky.hemi.intensity *= 1 - 0.25 * this.cloud;
    sky.uniforms.top.value.lerp(GREY_TOP, this.cloud * 0.7); sky.uniforms.horizon.value.lerp(GREY_HOR, this.cloud * 0.6);
    this.app.scene.fog.far = 2600 * (1 - 0.6 * this.cloud) + 200;
    this.rain.visible = this.wet > 0.02; this.rain.material.opacity = 0.7 * this.wet;
    if (this.rain.visible){
      const p = this.rain.geometry.attributes.position;
      for (let k = 0; k < p.count; k++){ let y = p.getY(k) - 22 * dt; if (y < 0) y += 40; p.setY(k, y); }
      p.needsUpdate = true; this.rain.position.set(camPos.x, camPos.y - 20, camPos.z);
    }
    this.app.audio.rain = this.wet;
    // the nightly show
    const S = this.S, h = S.time / 60;
    const sites = S.objects.filter((o) => o.type === 'fireworks');
    if (sites.length && S.show !== false && h >= SHOW_H && h < SHOW_H + 0.5 && this.showT < 0 && S.showDay !== S.day){ this.startShow(); S.showDay = S.day; }
    if (this.showT >= 0){
      this.showT += dt;
      if (this.showT > 75){ this.showT = -1; }
      else { this.launchT = (this.launchT || 0) - dt; if (this.launchT <= 0 && sites.length){ const o = sites[Math.floor(this.r() * sites.length)]; this.launch(o); this.launchT = this.showT > 60 ? 0.15 : 0.6 + this.r() * 0.9; } }
    }
    this.fly(dt);
    this.tune(dt);
  }
  startShow(){ this.showT = 0; this.launchT = 0; this.app.ui.toast('The fireworks show is starting!', 'good'); if (this.app.guests) for (const g of this.app.guests.list) if (g.inPark) g.happy = clamp(g.happy + 0.1); }
  launch(o){ const y = this.app.park.groundAt(o.x, o.z) + 1; this.rockets.push({ x: o.x, y, z: o.z, vy: 30 + this.r() * 8, vx: (this.r() - 0.5) * 3, vz: (this.r() - 0.5) * 3, t: 1.6 + this.r() * 0.5, style: o.style || 'peony' }); this.app.audio.whoosh && this.app.audio.whoosh(); }
  burst(x, y, z, style){
    const R = this.r, n = style === 'ring' ? 90 : style === 'willow' ? 160 : 140;
    const cols = { willow: [[1, 0.8, 0.35]], peony: [[1, 0.3, 0.3], [0.3, 0.6, 1], [0.4, 1, 0.5], [1, 0.9, 0.3], [0.9, 0.4, 1]], ring: [[0.8, 0.9, 1], [1, 1, 1]], dragon: [[1, 0.45, 0.1], [1, 0.75, 0.2]] }[style];
    const col = cols[Math.floor(R() * cols.length)], up = new THREE.Vector3(R() - 0.5, 1, R() - 0.5).normalize(), a = new THREE.Vector3(), b = new THREE.Vector3();
    a.crossVectors(up, new THREE.Vector3(1, 0, 0)).normalize(); b.crossVectors(up, a);
    const P = this.sparks.geometry.attributes.position, C = this.sparks.geometry.attributes.color;
    for (let k = 0; k < n; k++){
      const i = this.next; this.next = (this.next + 1) % this.N;
      let vx, vy, vz;
      if (style === 'ring'){ const t = k / n * Math.PI * 2; vx = (a.x * Math.cos(t) + b.x * Math.sin(t)) * 14; vy = (a.y * Math.cos(t) + b.y * Math.sin(t)) * 14; vz = (a.z * Math.cos(t) + b.z * Math.sin(t)) * 14; }
      else { const u = R() * 2 - 1, t = R() * Math.PI * 2, q = Math.sqrt(1 - u * u), sp = (style === 'willow' ? 9 : 13) * (0.7 + 0.3 * R()); vx = q * Math.cos(t) * sp; vy = u * sp; vz = q * Math.sin(t) * sp; }
      P.setXYZ(i, x, y, z); this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
      const c = style === 'peony' ? cols[Math.floor(R() * cols.length)] : col;
      this.base[i * 3] = c[0]; this.base[i * 3 + 1] = c[1]; this.base[i * 3 + 2] = c[2]; C.setXYZ(i, c[0], c[1], c[2]);
      this.life[i] = style === 'willow' ? 3.2 : 2.0 + R() * 0.6;
    }
    this.app.audio.bang && this.app.audio.bang(new THREE.Vector3(x, y, z).distanceTo(this.app.camera.getWorldPosition(new THREE.Vector3())));
  }
  fly(dt){
    for (const r of this.rockets){ r.t -= dt; r.x += r.vx * dt; r.y += r.vy * dt; r.z += r.vz * dt; r.vy -= 9.8 * dt * 0.3; if (r.t <= 0) this.burst(r.x, r.y, r.z, r.style); }
    // the rockets' own trails
    const P = this.sparks.geometry.attributes.position, C = this.sparks.geometry.attributes.color;
    for (const r of this.rockets) if (r.t > 0){ const i = this.next; this.next = (this.next + 1) % this.N; P.setXYZ(i, r.x, r.y, r.z); this.vel[i * 3] = 0; this.vel[i * 3 + 1] = -1; this.vel[i * 3 + 2] = 0; this.life[i] = 0.5; this.base[i * 3] = 1; this.base[i * 3 + 1] = 0.8; this.base[i * 3 + 2] = 0.5; }
    this.rockets = this.rockets.filter((r) => r.t > 0);
    let any = false;
    for (let i = 0; i < this.N; i++){
      if (this.life[i] <= 0) continue; any = true;
      this.life[i] -= dt; const drag = 1 - 1.3 * dt;
      this.vel[i * 3] *= drag; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * drag - 6 * dt; this.vel[i * 3 + 2] *= drag;
      P.setXYZ(i, P.getX(i) + this.vel[i * 3] * dt, P.getY(i) + this.vel[i * 3 + 1] * dt, P.getZ(i) + this.vel[i * 3 + 2] * dt);
      const f = clamp(this.life[i] / 1.2);
      C.setXYZ(i, this.base[i * 3] * f, this.base[i * 3 + 1] * f, this.base[i * 3 + 2] * f);
      if (this.life[i] <= 0) P.setXYZ(i, 0, -1000, 0);
    }
    if (any || this.rockets.length){ P.needsUpdate = true; C.needsUpdate = true; }
    this.sparks.visible = any || this.rockets.length > 0;
  }
  // --- music for the land you're looking at ---
  tune(dt){
    const A = this.app, au = A.audio;
    if (!au.ctx || A.settings.music === false || A.mode === 'title'){ if (this.music.gain) this.music.gain.gain.value = 0; return; }
    const c = au.ctx;
    if (!this.music.gain){ this.music.gain = c.createGain(); this.music.gain.gain.value = 0; this.music.gain.connect(au.master); }
    const at = A.inVR ? A.vr.focus() : A.mode === 'walk' ? { x: A.walker.x, z: A.walker.z } : { x: A.orbit.x, z: A.orbit.z };
    const L = A.park.landAt(at.x, at.z), theme = L ? L.theme : 'main';
    const night = A.sky.night, want = 0.05 * (1 - 0.5 * night) * (A.speed ? 1 : 0.5);
    if (theme !== this.music.theme){ this.music.theme = theme; this.music.step = 0; }
    this.music.gain.gain.value = damp(this.music.gain.gain.value, want, 1, dt);
    this.music.t -= dt;
    if (this.music.t > 0) return;
    const T = TUNES[theme] || TUNES.main;
    this.music.t = 60 / T.bpm / 2;
    const step = this.music.step++ % T.pattern.length, n = T.pattern[step];
    if (n === null) return;
    const freq = T.root * Math.pow(2, T.scale[n % T.scale.length] / 12 + Math.floor(n / T.scale.length));
    const o = c.createOscillator(), g = c.createGain(), t = c.currentTime;
    o.type = T.wave; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + T.decay);
    o.connect(g); g.connect(this.music.gain); o.start(t); o.stop(t + T.decay + 0.05);
    if (step % 8 === 0){ const b = c.createOscillator(), bg = c.createGain(); b.type = 'sine'; b.frequency.value = T.root / 2 * Math.pow(2, T.scale[T.pattern[step] % T.scale.length] / 12); bg.gain.setValueAtTime(0.0, t); bg.gain.linearRampToValueAtTime(0.6, t + 0.05); bg.gain.exponentialRampToValueAtTime(0.001, t + 2.4); b.connect(bg); bg.connect(this.music.gain); b.start(t); b.stop(t + 2.5); }
  }
}
// each land's tune: a scale (semitones), a root, a tempo, a sound and an eight-bar pattern of scale steps
const TUNES = {
  main: { root: 392, scale: [0, 2, 4, 7, 9], bpm: 96, wave: 'triangle', decay: 0.9, pattern: [0, 2, 4, 2, 5, null, 4, 2, 1, 3, 5, 3, 7, null, 5, null] },
  castle: { root: 330, scale: [0, 2, 3, 5, 7, 8, 10], bpm: 84, wave: 'triangle', decay: 1.2, pattern: [0, null, 4, 2, 5, 4, 2, null, 3, null, 2, 1, 0, null, null, null] },
  wood: { root: 523, scale: [0, 2, 4, 7, 9], bpm: 72, wave: 'sine', decay: 1.6, pattern: [4, 2, 0, null, 7, 5, 4, null, 2, 4, 5, null, 9, 7, null, null] },
  dragon: { root: 196, scale: [0, 1, 4, 5, 7, 8, 10], bpm: 70, wave: 'sawtooth', decay: 0.5, pattern: [0, null, 0, 1, 2, null, 1, 0, 4, null, 3, 2, 1, null, 0, null] },
  pirate: { root: 294, scale: [0, 2, 3, 5, 7, 9, 10], bpm: 116, wave: 'square', decay: 0.35, pattern: [0, 2, 4, 2, 4, 5, 4, 2, 1, 3, 5, 3, 4, 2, 0, null] },
  frontier: { root: 262, scale: [0, 2, 4, 5, 7, 9, 10], bpm: 104, wave: 'triangle', decay: 0.45, pattern: [0, 4, 2, 4, 0, 4, 2, 4, 1, 5, 3, 5, 0, null, 4, null] },
  sky: { root: 659, scale: [0, 2, 4, 6, 7, 9, 11], bpm: 66, wave: 'sine', decay: 2.0, pattern: [0, null, 4, null, 7, null, 6, 4, 2, null, 6, null, 9, null, 7, null] },
};
let SITE_MATS = null;   // (shared by every site)
// a fireworks site: a low platform with mortar tubes
export function buildFireworksSite(o){
  if (!SITE_MATS) SITE_MATS = { base: new THREE.MeshStandardMaterial({ color: 0x3a3a3e, roughness: 0.8 }), tube: new THREE.MeshStandardMaterial({ color: 0x7a2a2a, roughness: 0.6 }) };
  const g = new THREE.Group(), base = new THREE.Mesh(new THREE.BoxGeometry(3, 0.4, 3), SITE_MATS.base);
  base.position.y = 0.2; base.castShadow = true; base.receiveShadow = true; g.add(base);
  const tube = new THREE.CylinderGeometry(0.16, 0.18, 1.0, 10), tm = SITE_MATS.tube;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++){ const m = new THREE.Mesh(tube, tm); m.position.set(i * 0.8, 0.9, j * 0.8); m.castShadow = true; g.add(m); }
  g.userData = { colliders: [{ c: [0, 0], r: 1.8 }] };
  return g;
}
