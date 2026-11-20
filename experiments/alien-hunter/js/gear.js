// Your two things: the X-ray camera tablet and the Shock Gun (a cartoon ray gun), plus what the gun
// does: a crackling lightning bolt, a flash where it hits, and puffs of smoke when a disguise pops off.
// Both are built once; the bolt, flash and puffs are a few reused objects.
import * as THREE from 'three';
import { V, mergeGeometries, paint, placed, textCanvas } from './util.js';
import { materials, INNER } from './people.js';

// the gun points along -z, its handle hangs down (-y); `muzzle` is where the bolt comes out
export function makeGun(){
  const P = (g, c, ...a) => paint(placed(g, ...a), c);
  const orange = '#ff8a2a', silver = '#d8e0ea', purple = '#7a3ab8', dark = '#3a2456';
  const parts = [
    P(new THREE.CylinderGeometry(0.038, 0.03, 0.2, 16).rotateX(Math.PI / 2), orange, 0, 0, -0.06),
    P(new THREE.SphereGeometry(0.038, 14, 10), orange, 0, 0, 0.04),
    P(new THREE.CylinderGeometry(0.02, 0.056, 0.05, 16).rotateX(Math.PI / 2), silver, 0, 0, -0.185),
    P(new THREE.BoxGeometry(0.008, 0.045, 0.09), purple, 0, 0.045, -0.03),
    P(new THREE.BoxGeometry(0.034, 0.11, 0.046), dark, 0, -0.068, 0.012, 0.28),
    P(new THREE.BoxGeometry(0.012, 0.032, 0.014), '#1a1a1a', 0, -0.035, -0.03),
  ];
  for (const z of [-0.12, -0.08, -0.04]) parts.push(P(new THREE.TorusGeometry(0.04, 0.008, 6, 16), silver, 0, 0, z));
  const g = new THREE.Group();
  const body = new THREE.Mesh(mergeGeometries(parts), materials.skin); body.castShadow = true; g.add(body);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.034, 12, 10), new THREE.MeshBasicMaterial({ color: '#7af8ff', toneMapped: false }));
  tip.position.z = -0.212; g.add(tip);
  const muzzle = new THREE.Object3D(); muzzle.position.z = -0.25; g.add(muzzle);
  g.userData = { tip, muzzle, kick: 0 };
  return g;
}

// the tablet: its screen (+z side) shows what the camera on its back sees, in X-ray; a strip under it
// shows the scan, how many aliens are left and the version
export function makeTablet(screenTex){
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.22, 0.02), new THREE.MeshToonMaterial({ color: '#3a2a5a' }));
  g.add(frame);
  const rim = new THREE.Mesh(new THREE.BoxGeometry(0.276, 0.012, 0.022), new THREE.MeshBasicMaterial({ color: '#8dff5a', toneMapped: false }));
  rim.position.y = 0.11; g.add(rim);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.15), new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }));
  screen.position.set(0, 0.022, 0.0105); g.add(screen);
  const strip = textCanvas(512, 72);
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.034), new THREE.MeshBasicMaterial({ map: strip.tex, toneMapped: false }));
  label.position.set(0, -0.08, 0.0105); g.add(label);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.01, 12).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#111' }));
  lens.position.set(0.09, 0.07, -0.013); g.add(lens);
  g.userData = { screen, strip, last: '' };
  return g;
}
export function drawStrip(tablet, left, right, progress, cls){
  const U = tablet.userData, key = left + '|' + right + '|' + Math.round(progress * 20) + cls;
  if (U.last === key) return;
  U.last = key;
  const g = U.strip.ctx;
  g.fillStyle = '#140a28'; g.fillRect(0, 0, 512, 72);
  if (cls){ g.fillStyle = cls === 'bad' ? '#a81a2a' : '#1a6a2a'; g.fillRect(0, 0, 512, 72); }
  if (progress > 0){ g.fillStyle = '#2a7a1a'; g.fillRect(0, 0, 512 * progress, 72); }
  g.textBaseline = 'middle';
  g.textAlign = 'right'; g.fillStyle = '#ffffff'; g.font = 'bold 28px Arial'; g.fillText(right, 500, 38);
  const room = 500 - g.measureText(right).width - 30;
  let fs = 32; g.font = `bold ${fs}px Arial`; while (g.measureText(left).width > room && fs > 16){ fs -= 2; g.font = `bold ${fs}px Arial`; }
  g.textAlign = 'left'; g.fillStyle = cls ? '#ffffff' : '#8dff5a'; g.fillText(left, 12, 38);
  U.strip.tex.needsUpdate = true;
}

// a soft round glow (for the flash and the puffs)
function glowTexture(inner, outer){
  const tc = textCanvas(128, 128), g = tc.ctx;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, inner); gr.addColorStop(0.45, outer); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128); tc.tex.needsUpdate = true;
  return tc.tex;
}

export class Effects {
  constructor(parent){
    this.group = new THREE.Group(); parent.add(this.group);
    // the bolt: two strings of stretched boxes (a white core inside a blue glow), re-jagged as it crackles
    const N = this.N = 14, box = new THREE.BoxGeometry(1, 1, 1);
    const mk = (col, op) => { const m = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), N); m.frustumCulled = false; m.visible = false; this.group.add(m); return m; };
    this.glow = mk('#4ad8ff', 0.75); this.core = mk('#ffffff', 1);
    this.bolt = { a: V(), b: V(), t: 0, jag: 0, pts: Array.from({ length: N + 1 }, () => V()) };
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,255,255,1)', 'rgba(90,220,255,0.6)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
    this.flash.visible = false; this.flashT = 0; this.group.add(this.flash);
    const puffTex = glowTexture('rgba(255,255,255,0.95)', 'rgba(230,240,230,0.6)');
    this.puffs = [0, 1, 2, 3].map(() => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false, toneMapped: false })); s.visible = false; this.group.add(s); return { s, t: 0, base: 1 }; });
    // also drawn in the X-ray view (over it, on the insides' layer)
    for (const c of this.group.children) c.layers.enable(INNER);
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.v = V(); this.s = V(); this.z = V(0, 0, 1);
  }
  fire(a, b, hit){
    const B = this.bolt; B.a.copy(a); B.b.copy(b); B.t = 0.18; B.jag = 0;
    this.glow.visible = this.core.visible = true;
    this.flash.position.copy(b); this.flash.visible = true; this.flashT = 0.25; this.flash.material.color.set(hit ? '#ffffff' : '#9adfff');
  }
  puff(p, color = '#ffffff', size = 1.6){
    const P = this.puffs.reduce((a, c) => (c.t < a.t ? c : a));
    P.s.position.copy(p); P.t = 0.7; P.base = size; P.s.material.color.set(color); P.s.visible = true;
  }
  update(dt){
    const B = this.bolt;
    if (B.t > 0){
      B.t -= dt; B.jag -= dt;
      if (B.jag <= 0){
        B.jag = 0.035;
        const d = this.v.copy(B.b).sub(B.a), len = d.length(); d.normalize();
        const side = V(d.z, 0, -d.x).normalize(), up = V().crossVectors(d, side);
        for (let i = 0; i <= this.N; i++){
          const t = i / this.N, k = Math.sin(Math.PI * t) * Math.min(0.5, len * 0.04);
          B.pts[i].copy(B.a).addScaledVector(d, len * t).addScaledVector(side, (Math.random() - 0.5) * 2 * k).addScaledVector(up, (Math.random() - 0.5) * 2 * k);
        }
        for (let i = 0; i < this.N; i++){
          const p = B.pts[i], q = B.pts[i + 1], seg = this.s.copy(q).sub(p), l = seg.length();
          this.q.setFromUnitVectors(this.z, seg.divideScalar(l || 1));
          const mid = V().copy(p).add(q).multiplyScalar(0.5);
          this.m.compose(mid, this.q, V(0.06, 0.06, l + 0.02)); this.glow.setMatrixAt(i, this.m);
          this.m.compose(mid, this.q, V(0.018, 0.018, l + 0.01)); this.core.setMatrixAt(i, this.m);
        }
        this.glow.instanceMatrix.needsUpdate = this.core.instanceMatrix.needsUpdate = true;
      }
      if (B.t <= 0) this.glow.visible = this.core.visible = false;
    }
    if (this.flashT > 0){
      this.flashT -= dt; const t = 1 - this.flashT / 0.25;
      this.flash.scale.setScalar(0.4 + t * 1.2); this.flash.material.opacity = 1 - t;
      if (this.flashT <= 0) this.flash.visible = false;
    }
    for (const P of this.puffs){
      if (P.t <= 0) continue;
      P.t -= dt; const t = 1 - P.t / 0.7;
      P.s.scale.setScalar(P.base * (0.3 + t)); P.s.material.opacity = 1 - t;
      P.s.position.y += dt * 0.5;
      if (P.t <= 0) P.s.visible = false;
    }
  }
}
