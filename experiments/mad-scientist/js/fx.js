// Particles: smoke puffs, stars, hearts, flames, bubbles, confetti, music notes and sparks, all in one
// Points draw call with a sprite atlas (8 pictures drawn once on a canvas). A fixed pool, so nothing
// is built or freed while playing.
import * as THREE from 'three';
import { V } from './util.js';

export const P = { smoke: 0, star: 1, heart: 2, flame: 3, bubble: 4, confetti: 5, note: 6, spark: 7 };
const MAX = 900;

function atlas(){
  const C = 128, c = document.createElement('canvas'); c.width = C * 4; c.height = C * 2;
  const g = c.getContext('2d');
  const cell = (i, f) => { g.save(); g.translate((i % 4) * C + C / 2, Math.floor(i / 4) * C + C / 2); f(); g.restore(); };
  // smoke: a soft lumpy puff
  cell(0, () => { for (const [x, y, r] of [[0, 6, 40], [-22, -4, 28], [22, -2, 30], [4, -22, 26]]){ const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); } });
  // star
  cell(1, () => { g.fillStyle = '#fff'; g.beginPath(); for (let i = 0; i < 10; i++){ const a = i / 10 * Math.PI * 2 - Math.PI / 2, r = i % 2 ? 22 : 56; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.fill(); });
  // heart
  cell(2, () => { g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, 46); g.bezierCurveTo(-70, 0, -40, -56, 0, -24); g.bezierCurveTo(40, -56, 70, 0, 0, 46); g.fill(); });
  // flame: a teardrop, hot in the middle
  cell(3, () => { const gr = g.createRadialGradient(0, 16, 4, 0, 6, 54); gr.addColorStop(0, '#fff'); gr.addColorStop(0.5, 'rgba(255,255,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.beginPath(); g.moveTo(0, -58); g.bezierCurveTo(40, -10, 44, 40, 0, 50); g.bezierCurveTo(-44, 40, -40, -10, 0, -58); g.fill(); });
  // bubble: a ring with a shine
  cell(4, () => { g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 7; g.beginPath(); g.arc(0, 0, 46, 0, 7); g.stroke(); g.fillStyle = 'rgba(255,255,255,0.25)'; g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.ellipse(-18, -20, 12, 7, -0.7, 0, 7); g.fill(); });
  // confetti: a square
  cell(5, () => { g.fillStyle = '#fff'; g.fillRect(-28, -18, 56, 36); });
  // a music note
  cell(6, () => { g.fillStyle = '#fff'; g.beginPath(); g.ellipse(-14, 30, 20, 15, -0.4, 0, 7); g.fill(); g.fillRect(2, -44, 9, 76); g.beginPath(); g.moveTo(2, -44); g.quadraticCurveTo(40, -30, 34, 0); g.quadraticCurveTo(30, -22, 8, -24); g.fill(); });
  // spark: a bright dot with a cross of light
  cell(7, () => { const gr = g.createRadialGradient(0, 0, 0, 0, 0, 60); gr.addColorStop(0, '#fff'); gr.addColorStop(0.25, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(-60, -6, 120, 12); g.fillRect(-6, -60, 12, 120); g.beginPath(); g.arc(0, 0, 22, 0, 7); g.fill(); });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const VERT = `
attribute float size; attribute float alpha; attribute float cell; attribute float rot; attribute vec3 tint;
uniform float scale;
varying float vA; varying float vCell; varying float vRot; varying vec3 vTint;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * scale / max(0.05, -mv.z);
  vA = alpha; vCell = cell; vRot = rot; vTint = tint;
}`;
const FRAG = `
uniform sampler2D map;
varying float vA; varying float vCell; varying float vRot; varying vec3 vTint;
void main(){
  if (vA < 0.01) discard;
  vec2 p = gl_PointCoord - 0.5;
  float c = cos(vRot), s = sin(vRot);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) discard;
  float col = mod(vCell, 4.0), row = floor(vCell / 4.0);
  vec4 t = texture2D(map, vec2((col + p.x) / 4.0, 1.0 - (row + p.y) / 2.0));
  gl_FragColor = vec4(t.rgb * vTint, t.a * vA);
  if (gl_FragColor.a < 0.02) discard;
  #include <colorspace_fragment>
}`;

export class Particles {
  constructor(scene){
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 3); this.size = new Float32Array(MAX); this.alpha = new Float32Array(MAX);
    this.cell = new Float32Array(MAX); this.rot = new Float32Array(MAX); this.tint = new Float32Array(MAX * 3);
    for (const [n, a, k] of [['position', this.pos, 3], ['size', this.size, 1], ['alpha', this.alpha, 1], ['cell', this.cell, 1], ['rot', this.rot, 1], ['tint', this.tint, 3]]){
      const at = new THREE.BufferAttribute(a, k); at.setUsage(THREE.DynamicDrawUsage); g.setAttribute(n, at);
    }
    g.boundingSphere = new THREE.Sphere(V(0, 0, 0), 1e4);
    this.mat = new THREE.ShaderMaterial({ uniforms: { map: { value: atlas() }, scale: { value: 600 } }, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false; this.points.renderOrder = 5;
    const vp = new THREE.Vector4();
    // a point's size in pixels depends on the view (and in VR on each eye's view)
    this.points.onBeforeRender = (renderer, sc, camera) => {
      renderer.getCurrentViewport(vp);
      this.mat.uniforms.scale.value = vp.w * 0.5 * camera.projectionMatrix.elements[5];
      this.mat.uniformsNeedUpdate = true;
    };
    scene.add(this.points);
    this.P = []; for (let i = 0; i < MAX; i++) this.P.push({ on: false, p: V(), v: V(), life: 0, max: 1, s0: 0.1, s1: 0.1, g: 0, drag: 0, spin: 0, cell: 0, c: new THREE.Color(), fade: 0.3, wob: 0 });
    this.next = 0; this.count = 0;
  }
  // one particle
  add(cell, p, v, { life = 1, size = 0.1, size1 = null, color = '#fff', g = 0, drag = 0, spin = 0, fade = 0.3, wob = 0 } = {}){
    const q = this.P[this.next]; this.next = (this.next + 1) % MAX;
    q.on = true; q.cell = cell; q.p.copy(p); q.v.copy(v); q.life = 0; q.max = life; q.s0 = size; q.s1 = size1 == null ? size : size1;
    q.g = g; q.drag = drag; q.spin = spin; q.c.set(color); q.fade = fade; q.wob = wob; q.r = Math.random() * 6.28;
    return q;
  }
  // a burst: n particles from p, flung out at about `speed` (mostly along dir, if given)
  burst(cell, p, n, { speed = 1, dir = null, spread = 1, colors = ['#fff'], ...o } = {}){
    for (let i = 0; i < n; i++){
      const v = V(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(spread);
      if (dir) v.add(dir); v.normalize().multiplyScalar(speed * (0.5 + Math.random() * 0.7));
      this.add(cell, p, v, { color: colors[i % colors.length], ...o, size: (o.size || 0.1) * (0.7 + Math.random() * 0.6) });
    }
  }
  // the presets
  smoke(p, n = 10, color = '#ffffff', size = 0.35){ this.burst(P.smoke, p, n, { speed: 0.8, spread: 1, dir: V(0, 0.6, 0), colors: [color], life: 1.4, size, size1: size * 2.2, drag: 2, g: -0.3, spin: 1, fade: 0.8 }); }
  hearts(p, n = 6){ this.burst(P.heart, p, n, { speed: 0.7, dir: V(0, 1.4, 0), colors: ['#ff3a7a', '#ff6aa0', '#ff1a4a'], life: 1.6, size: 0.12, g: -0.4, drag: 1.2, wob: 1.5, fade: 0.5 }); }
  stars(p, n = 10, colors = ['#fff04a', '#ffffff', '#7af0ff']){ this.burst(P.star, p, n, { speed: 1.6, colors, life: 0.9, size: 0.09, size1: 0.02, drag: 2.5, spin: 4 }); }
  confetti(p, n = 40){ this.burst(P.confetti, p, n, { speed: 4, dir: V(0, 0.8, 0), colors: ['#ff3a5a', '#3ad8ff', '#ffe02a', '#6aff3a', '#c050ff', '#ff8a1a'], life: 2.4, size: 0.05, g: 3.2, drag: 1.5, spin: 9, wob: 2 }); }
  flame(p, dir, n = 3){ this.burst(P.flame, p, n, { speed: 2.4, dir, spread: 0.25, colors: ['#ffe03a', '#ff8a1a', '#ff3a10'], life: 0.55, size: 0.08, size1: 0.22, drag: 1, g: -1.5, fade: 0.6 }); }
  bubbles(p, n = 5, color = '#bff4ff'){ this.burst(P.bubble, p, n, { speed: 0.4, dir: V(0, 1, 0), colors: [color], life: 1.8, size: 0.06, g: -0.4, drag: 0.8, wob: 1.2, fade: 0.2 }); }
  notes(p, n = 2){ this.burst(P.note, p, n, { speed: 0.6, dir: V(0, 1.4, 0), colors: ['#ff4ab8', '#3a7aff', '#ffe02a', '#3ad84a'], life: 1.5, size: 0.11, g: -0.3, drag: 0.6, wob: 2, fade: 0.4 }); }
  sparks(p, n = 10, colors = ['#fff8a0', '#a0e8ff', '#ffffff']){ this.burst(P.spark, p, n, { speed: 2.5, colors, life: 0.45, size: 0.09, size1: 0.01, drag: 3, g: 2 }); }
  update(dt){
    const P = this.P;
    let n = 0;
    for (let i = 0; i < MAX; i++){
      const q = P[i];
      if (!q.on){ if (this.alpha[i] !== 0){ this.alpha[i] = 0; this.size[i] = 0; } continue; }
      q.life += dt;
      if (q.life >= q.max){ q.on = false; this.alpha[i] = 0; this.size[i] = 0; continue; }
      n++;
      q.v.y -= q.g * dt;
      if (q.drag) q.v.multiplyScalar(Math.max(0, 1 - q.drag * dt));
      q.p.addScaledVector(q.v, dt);
      if (q.wob) q.p.x += Math.sin(q.life * 6 + i) * q.wob * dt * 0.3;
      if (q.g > 0 && q.p.y < 0.01){ q.p.y = 0.01; q.v.set(0, 0, 0); q.g = 0; }
      q.r += q.spin * dt;
      const t = q.life / q.max;
      this.pos[i * 3] = q.p.x; this.pos[i * 3 + 1] = q.p.y; this.pos[i * 3 + 2] = q.p.z;
      this.size[i] = q.s0 + (q.s1 - q.s0) * t;
      this.alpha[i] = t > 1 - q.fade ? (1 - t) / q.fade : Math.min(1, q.life * 12);
      this.cell[i] = q.cell; this.rot[i] = q.r;
      this.tint[i * 3] = q.c.r; this.tint[i * 3 + 1] = q.c.g; this.tint[i * 3 + 2] = q.c.b;
    }
    this.count = n;
    const a = this.points.geometry.attributes;
    for (const k of ['position', 'size', 'alpha', 'cell', 'rot', 'tint']) a[k].needsUpdate = true;
  }
  clear(){ for (const q of this.P) q.on = false; }
}
