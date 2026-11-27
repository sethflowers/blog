// Effects: ichor (the aliens' blood: dark, yellow-green and slick) spraying from wounds and spattering
// the deck, glue splats where a shot sticks, and little puffs. Everything is instanced and made once:
// a fixed pool of droplets and a ring of splats on the deck, so nothing is built or freed in play.
import * as THREE from 'three';
import { V, clamp } from './util.js';

const MAXD = 600, MAXS = 260;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = V(), _p = V(), _e = new THREE.Euler();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

function splatTexture(){
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,0)'; g.fillRect(0, 0, S, S);
  // a splash: a blob with droplets thrown out from it
  g.fillStyle = '#fff';
  g.beginPath(); for (let i = 0; i <= 24; i++){ const a = i / 24 * Math.PI * 2, r = 26 + Math.sin(a * 5) * 6 + Math.sin(a * 11) * 4; g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r); } g.fill();
  for (let i = 0; i < 16; i++){ const a = Math.random() * 6.28, r = 34 + Math.random() * 26, s = 2 + Math.random() * 6; g.beginPath(); g.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, s, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c); return t;
}

export class Effects {
  constructor(scene){
    this.scene = scene;
    // droplets: small stretched spheres
    this.dmat = new THREE.MeshStandardMaterial({ color: '#c8e830', roughness: 0.2, metalness: 0, emissive: '#2a3800', emissiveIntensity: 0.8 });
    this.drops = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), this.dmat, MAXD);
    this.drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.drops.frustumCulled = false;
    this.drops.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXD * 3).fill(1), 3);
    this.D = []; for (let i = 0; i < MAXD; i++){ this.D.push({ on: false, p: V(), v: V(), life: 0, r: 0.02, kind: 0 }); this.drops.setMatrixAt(i, ZERO); }
    this.di = 0;
    // splats on the deck (just above it, never writing depth, so they can overlap without flicker)
    this.smat = new THREE.MeshStandardMaterial({ alphaMap: splatTexture(), transparent: true, depthWrite: false, roughness: 0.15, metalness: 0, color: '#ffffff',
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.splats = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.smat, MAXS);
    this.splats.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXS * 3).fill(1), 3);
    this.splats.frustumCulled = false; this.splats.renderOrder = 2;
    for (let i = 0; i < MAXS; i++) this.splats.setMatrixAt(i, ZERO);
    this.si = 0;
    scene.add(this.drops, this.splats);
    this.ICHOR = new THREE.Color('#9ac81e'); this.ICHOR_DARK = new THREE.Color('#3a5208'); this.GLUE = new THREE.Color('#ffcf2a');
  }
  // a spray of droplets from p, mostly along dir
  spray(p, dir, n, speed = 4, spread = 0.6, kind = 0, size = 1){
    for (let k = 0; k < n; k++){
      const d = this.D[this.di]; const i = this.di; this.di = (this.di + 1) % MAXD;
      d.on = true; d.p.copy(p); d.kind = kind;
      d.v.copy(dir).add(_p.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(spread * 2)).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.9));
      d.life = 1.2 + Math.random() * 1.2; d.r = (0.012 + Math.random() * 0.03) * size;
      const c = kind === 1 ? this.GLUE : Math.random() < 0.4 ? this.ICHOR_DARK : this.ICHOR;
      this.drops.setColorAt(i, c);
    }
    this.drops.instanceColor.needsUpdate = true;
  }
  splat(x, z, size, kind = 0, y = 0.015){
    const i = this.si; this.si = (this.si + 1) % MAXS;
    _q.setFromEuler(_e.set(0, Math.random() * 6.28, 0));
    _m.compose(_p.set(x, y + (i % 7) * 0.0008, z), _q, _s.set(size, 1, size * (0.7 + Math.random() * 0.6)));
    this.splats.setMatrixAt(i, _m);
    const c = kind === 1 ? this.GLUE : (Math.random() < 0.5 ? this.ICHOR_DARK : this.ICHOR);
    this.splats.setColorAt(i, c);
    this.splats.instanceMatrix.needsUpdate = true; this.splats.instanceColor.needsUpdate = true;
  }
  clearSplats(){ for (let i = 0; i < MAXS; i++) this.splats.setMatrixAt(i, ZERO); this.splats.instanceMatrix.needsUpdate = true; }
  update(dt, world){
    let any = false;
    for (let i = 0; i < MAXD; i++){
      const d = this.D[i];
      if (!d.on) continue;
      any = true;
      d.life -= dt;
      d.v.y -= 9.8 * dt;
      d.p.addScaledVector(d.v, dt);
      // hits the deck: leaves a splat
      if (d.p.y < 0.02 && world.onDeck(d.p.x, d.p.z)){
        if (Math.random() < 0.35) this.splat(d.p.x, d.p.z, d.r * (8 + Math.random() * 10), d.kind);
        d.on = false;
      }
      if (d.life <= 0 || d.p.y < -50) d.on = false;
      if (!d.on){ this.drops.setMatrixAt(i, ZERO); continue; }
      // stretched along its motion
      const sp = d.v.length();
      _q.setFromUnitVectors(_s.set(0, 1, 0), _p.copy(d.v).divideScalar(sp || 1));
      _m.compose(d.p, _q, _s.set(d.r, d.r * (1 + clamp(sp * 0.08, 0, 2.5)), d.r));
      this.drops.setMatrixAt(i, _m);
    }
    if (any || this._wasAny) this.drops.instanceMatrix.needsUpdate = true;
    this._wasAny = any;
  }
}
