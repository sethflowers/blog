// People: the guests and staff as you see them.
//  - Near you (the closest NEAR of them): realistic, rigged, animated people (Microsoft's Rocketbox
//    avatars, MIT licence, the 18 prepared for MSB by _tools/msb/rocketbox.mjs), walking or standing
//    with their own animation. A small pool of copies is handed to whoever is nearest, every half second.
//  - Everyone else: one instanced mesh of simple figures (legs, body, arms, head) in the clothes colours of
//    the person they are, their legs and arms swinging in the shader as they walk. Cheap enough for
//    hundreds at once on an iPad or a headset.
// If the avatars can't load (offline before they were saved), everyone is drawn the simple way.
import * as THREE from 'three';
import { GLTFLoader } from '../lib/addons/GLTFLoader.js';
import { clone as cloneSkinned } from '../lib/addons/SkeletonUtils.js';

const BASE = '/experiments/fantasy-theme-park/models/people/';
// clothes colours for the simple figures, one set per avatar (shirt, trousers, skin, hair), in list order
const LOOKS = [
  ['#3a5a8a', '#2a2a32', '#e0b896', '#4a3020'], ['#c84a4a', '#3a3a4a', '#d8a888', '#2a1a10'], ['#e8d8b0', '#4a5a7a', '#c08868', '#1a1210'], ['#6a8a5a', '#2a3a5a', '#f0c8a8', '#a07040'],
  ['#8a4a8a', '#1e2a3a', '#e8c0a0', '#3a2414'], ['#f0f0f0', '#3a4a6a', '#a87050', '#120c08'], ['#d8a040', '#2e2e3a', '#e8c4a4', '#5a3a1a'], ['#4a7a9a', '#5a4a3a', '#d8a080', '#1a1410'],
  ['#e07a90', '#2a3040', '#f0d0b0', '#c89a50'], ['#2a4a6a', '#4a4a4a', '#e0b090', '#3a2a1a'], ['#5a6a3a', '#2a2a2a', '#c89070', '#1a1008'], ['#b0b8c0', '#1a2a4a', '#e8c0a0', '#4a2e18'],
  ['#9a3a2a', '#3a3a3a', '#d8a888', '#2a1a10'], ['#3a3a42', '#5a6a8a', '#f0c8a8', '#6a4a2a'], ['#e8c040', '#2a3a2a', '#a06848', '#100a06'], ['#4a8a7a', '#2a2a36', '#e0b896', '#3a2a1a'],
  ['#7a5a9a', '#3a3a4a', '#e8c4a4', '#2a1a10'], ['#c8c0a8', '#30384a', '#d0a080', '#4a3018'],
];
export const STAFF_LOOKS = { janitor: ['#4a7a3a', '#3a4a2a', '#e0b896', '#3a2a1a'], mechanic: ['#2a4a8a', '#24304a', '#d8a888', '#2a1a10'], entertainer: ['#c83a3a', '#f0d040', '#f0c8a8', '#a07040'] };

// the simple figure, 1.7 m tall, facing +z; a 'part' attribute says which bits swing (1/-1 legs, 2/-2 arms)
function figureGeometry(){
  const parts = [];
  const box = (w, h, d, x, y, z, part, col) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); parts.push({ g, part, col }); };
  const cyl = (r0, r1, h, x, y, z, part, col, seg = 8) => { const g = new THREE.CylinderGeometry(r1, r0, h, seg); g.translate(x, y, z); parts.push({ g, part, col }); };
  cyl(0.065, 0.075, 0.82, -0.1, 0.41, 0, 1, 1); cyl(0.065, 0.075, 0.82, 0.1, 0.41, 0, -1, 1);       // legs (trousers)
  box(0.12, 0.07, 0.24, -0.1, 0.035, 0.04, 1, 4); box(0.12, 0.07, 0.24, 0.1, 0.035, 0.04, -1, 4);     // shoes
  cyl(0.17, 0.2, 0.58, 0, 1.12, 0, 0, 0, 10);                                                          // body (shirt)
  cyl(0.05, 0.055, 0.6, -0.25, 1.12, 0, 2, 0); cyl(0.05, 0.055, 0.6, 0.25, 1.12, 0, -2, 0);            // arms
  cyl(0.045, 0.05, 0.12, 0, 1.47, 0, 0, 2);                                                            // neck
  { const g = new THREE.SphereGeometry(0.11, 12, 8); g.scale(0.9, 1.1, 1); g.translate(0, 1.6, 0.01); parts.push({ g, part: 0, col: 2 }); }  // head
  { const g = new THREE.SphereGeometry(0.115, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.55); g.scale(0.92, 1.05, 1.02); g.translate(0, 1.62, -0.005); parts.push({ g, part: 0, col: 3 }); }  // hair
  const pos = [], nor = [], part = [], col = [], idx = [];
  for (const p of parts){
    const g = p.g.index ? p.g : p.g, P = g.attributes.position, Nn = g.attributes.normal, I = g.index, v0 = pos.length / 3;
    for (let k = 0; k < P.count; k++){ pos.push(P.getX(k), P.getY(k), P.getZ(k)); nor.push(Nn.getX(k), Nn.getY(k), Nn.getZ(k)); part.push(p.part); col.push(p.col); }
    for (let k = 0; k < I.count; k++) idx.push(I.getX(k) + v0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('part', new THREE.Float32BufferAttribute(part, 1)); g.setAttribute('slot', new THREE.Float32BufferAttribute(col, 1));
  g.setIndex(idx);
  return g;
}

export class People {
  constructor(app){
    this.app = app; this.scene = app.scene;
    this.kinds = null; this.loading = false; this.loaded = 0; this.failed = false;
    this.NEAR = app.touch ? 14 : 22;
    this.pool = [];                // { kind, P: person, guest }
    this.cap = 1200;
    // the far crowd
    const geo = figureGeometry();
    this.time = { value: 0 };
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.time;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
        attribute float part; attribute float slot; attribute vec4 look0; attribute vec4 look1; attribute vec4 look2; attribute vec2 gait;
        uniform float uTime; varying vec3 vCol;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        // colours: 0 shirt, 1 trousers, 2 skin, 3 hair, 4 shoes
        vCol = slot < 0.5 ? look0.rgb : slot < 1.5 ? look1.rgb : slot < 2.5 ? look2.rgb : slot < 3.5 ? vec3(look0.a, look1.a, look2.a) : vec3(0.1);
        // walking: legs and arms swing about the hip / shoulder (gait.x: how much walking, gait.y: phase); sitting folds the legs
        float sw = sin(uTime * 7.0 + gait.y) * 0.5 * gait.x;
        if (abs(part) > 0.5){
          float pivot = abs(part) > 1.5 ? 1.4 : 0.82;
          float a = (abs(part) > 1.5 ? -sw * 0.8 : sw) * sign(part);
          float yy = transformed.y - pivot;
          transformed.z = transformed.z * cos(a) + yy * sin(a);
          transformed.y = pivot - transformed.z * sin(a) + yy * cos(a);
        }`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vCol;').replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( vCol, opacity );');
    };
    mat.customProgramCacheKey = () => 'crowd';
    this.far = new THREE.InstancedMesh(geo, mat, this.cap);
    this.far.count = 0; this.far.castShadow = true; this.far.receiveShadow = true; this.far.frustumCulled = false; this.far.name = 'crowd';
    for (const n of ['look0', 'look1', 'look2']) geo.setAttribute(n, new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 4), 4));
    geo.setAttribute('gait', new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 2), 2));
    this.scene.add(this.far);
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.s = new THREE.Vector3(1, 1, 1); this.c = new THREE.Color();
    this.reassign = 0;
  }
  // start loading the avatars (after the park is showing: they're a big download)
  load(){
    if (this.loading || this.kinds) return; this.loading = true;
    const v = document.body.dataset.version || '0', L = new GLTFLoader();
    fetch(BASE + 'list.json').then((r) => { if (!r.ok) throw new Error('list'); return r.json(); }).then((list) => {
      this.total = list.length;
      return Promise.all(list.map((P) => L.loadAsync(BASE + P.id + '.glb').then((g) => { this.loaded++; return g; }))).then((gltfs) => {
        this.kinds = gltfs.map((g, i) => ({ scene: g.scene, clips: Object.fromEntries(g.animations.map((c) => [c.name, c])), height: list[i].height, id: list[i].id }));
        this.loading = false;
      });
    }).catch((e) => { console.warn('people', e); this.failed = true; this.loading = false; });
    void v;
  }
  get progress(){ return this.kinds ? 1 : this.total ? this.loaded / this.total : 0; }
  // a realistic person from the pool (a copy of avatar k)
  take(k){
    let e = this.pool.find((p) => !p.guest && p.kind === k);
    if (!e){
      const K = this.kinds[k], model = cloneSkinned(K.scene);
      model.traverse((o) => { if (o.isMesh){ o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model), s = K.height / Math.max(0.5, box.max.y - box.min.y);
      const holder = new THREE.Group(); model.scale.multiplyScalar(s); model.position.y = -box.min.y * s; holder.add(model);
      const mixer = new THREE.AnimationMixer(model), walk = mixer.clipAction(K.clips.walk), idle = mixer.clipAction(K.clips.idle);
      idle.play(); walk.play(); walk.setEffectiveWeight(0);
      e = { kind: k, holder, mixer, walk, idle, guest: null };
      this.pool.push(e);
    }
    this.scene.add(e.holder);
    return e;
  }
  give(e){ e.guest = null; this.scene.remove(e.holder); }
  // draw everyone: list of { x, y, z, yaw, speed, look (avatar index), staff, hidden, sit }
  draw(list, dt, eye){
    this.time.value += dt;
    // the nearest get real people (re-chosen every half second)
    this.reassign -= dt;
    if (this.kinds && this.reassign <= 0){
      this.reassign = 0.5;
      const near = list.filter((g) => !g.hidden && !g.staff).map((g) => [g, (g.x - eye.x) ** 2 + (g.z - eye.z) ** 2]).filter(([, d]) => d < 40 * 40).sort((a, b) => a[1] - b[1]).slice(0, this.NEAR).map(([g]) => g);
      const want = new Set(near);
      for (const e of this.pool) if (e.guest && (!want.has(e.guest) || e.guest.hidden)){ e.guest.avatar = null; this.give(e); }
      for (const g of near) if (!g.avatar){ g.avatar = this.take(g.look % this.kinds.length); g.avatar.guest = g; }
    }
    let n = 0;
    const L0 = this.far.geometry.attributes.look0, L1 = this.far.geometry.attributes.look1, L2 = this.far.geometry.attributes.look2, G = this.far.geometry.attributes.gait;
    for (const g of list){
      if (g.hidden) continue;
      if (g.avatar && !g.hidden){
        const e = g.avatar, w = Math.min(1, g.speed / 1.2);
        e.holder.position.set(g.x, g.y, g.z); e.holder.rotation.y = g.yaw;
        e.walk.setEffectiveWeight(w); e.idle.setEffectiveWeight(1 - w); e.walk.timeScale = 0.9 + g.speed * 0.25;
        e.mixer.update(dt);
        continue;
      }
      if (n >= this.cap) break;
      this.q.setFromAxisAngle(UP, g.yaw); this.s.set(g.scale || 1, g.scale || 1, g.scale || 1);
      this.m.compose(new THREE.Vector3(g.x, g.y, g.z), this.q, this.s);
      this.far.setMatrixAt(n, this.m);
      const look = g.staff ? STAFF_LOOKS[g.staff] : LOOKS[g.look % LOOKS.length];
      const cs = look.map((h) => this.c.set(h).toArray());
      L0.setXYZW(n, cs[0][0], cs[0][1], cs[0][2], cs[3][0]); L1.setXYZW(n, cs[1][0], cs[1][1], cs[1][2], cs[3][1]); L2.setXYZW(n, cs[2][0], cs[2][1], cs[2][2], cs[3][2]);
      G.setXY(n, Math.min(1, g.speed / 1.2), g.phase || 0);
      n++;
    }
    this.far.count = n;
    if (n){ this.far.instanceMatrix.needsUpdate = true; L0.needsUpdate = L1.needsUpdate = L2.needsUpdate = G.needsUpdate = true; }
  }
  dispose(){ for (const e of this.pool) this.scene.remove(e.holder); this.pool = []; }
  stats(){ return { near: this.pool.filter((e) => e.guest).length, far: this.far.count }; }
}
const UP = new THREE.Vector3(0, 1, 0);
