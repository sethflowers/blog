// The photo studio the person stands in: renderer, lights (four moods), a turntable, a soft backdrop,
// reflections, and a camera that frames what you're working on (the whole body, the head, the face)
// and keeps the person clear of the side panel.
import * as THREE from 'three';
import { clamp, damp } from './util.js';

export const LIGHTS = [
  { id: 'studio', label: 'Studio' }, { id: 'day', label: 'Daylight' }, { id: 'sunset', label: 'Sunset' }, { id: 'night', label: 'Night' },
];

export class Studio {
  constructor(){
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.setSize(window.innerWidth, window.innerHeight);
    r.domElement.id = 'view';
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping; r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.xr.enabled = true; r.xr.setReferenceSpaceType('local-floor'); r.xr.setFoveation(0.5);
    document.body.prepend(r.domElement);
    const scene = this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(25, window.innerWidth / window.innerHeight, 0.1, 60);
    this.rig = new THREE.Group(); this.rig.add(this.camera); scene.add(this.rig);
    // lights
    this.hemi = new THREE.HemisphereLight(0xdde6ff, 0x504038, 0.7);
    this.key = new THREE.DirectionalLight(0xfff0e2, 2.8);
    this.key.castShadow = true; this.key.shadow.mapSize.set(2048, 2048); this.key.shadow.bias = -0.0002; this.key.shadow.normalBias = 0.02;
    Object.assign(this.key.shadow.camera, { left: -1.3, right: 1.3, top: 2.3, bottom: -0.3, near: 0.5, far: 9 });
    this.rim = new THREE.DirectionalLight(0xc8d8ff, 2.0);
    this.fill = new THREE.DirectionalLight(0xffe8d8, 0.6);
    scene.add(this.hemi, this.key, this.key.target, this.rim, this.fill);
    // a soft light just above the camera: fills the face, and puts a glint in the eyes
    this.catch = new THREE.PointLight(0xfff4ea, 0.6, 0, 1.2); this.catch.position.set(0, 0.25, 0); this.camera.add(this.catch);
    // the turntable the person stands on
    this.turntable = new THREE.Group(); scene.add(this.turntable);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.78, 0.04, 72), new THREE.MeshStandardMaterial({ color: 0x2c2e34, roughness: 0.45, metalness: 0.2 }));
    disc.position.y = -0.02; disc.receiveShadow = true; this.turntable.add(disc);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.765, 0.006, 8, 96), new THREE.MeshStandardMaterial({ color: 0xf0b45a, emissive: 0x6a4510, roughness: 0.4 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.0; this.turntable.add(ring);
    this.person = new THREE.Group(); this.turntable.add(this.person);
    // the room: a floor that fades away, and a soft backdrop
    const fc = document.createElement('canvas'); fc.width = fc.height = 256;
    const g = fc.getContext('2d'), grd = g.createRadialGradient(128, 128, 10, 128, 128, 128);
    grd.addColorStop(0, '#45474e'); grd.addColorStop(0.55, '#2c2e34'); grd.addColorStop(1, '#16181d'); g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
    const ft = new THREE.CanvasTexture(fc); ft.colorSpace = THREE.SRGBColorSpace;
    this.floor = new THREE.Mesh(new THREE.CircleGeometry(9, 64), new THREE.MeshStandardMaterial({ map: ft, roughness: 0.9 }));
    this.floor.rotation.x = -Math.PI / 2; this.floor.position.y = -0.045; this.floor.receiveShadow = true; scene.add(this.floor);
    this.backC = document.createElement('canvas'); this.backC.width = 16; this.backC.height = 256;
    this.backT = new THREE.CanvasTexture(this.backC); this.backT.colorSpace = THREE.SRGBColorSpace;
    this.back = new THREE.Mesh(new THREE.SphereGeometry(16, 32, 16), new THREE.MeshBasicMaterial({ map: this.backT, side: THREE.BackSide, depthWrite: false, fog: false }));
    scene.add(this.back);
    // reflections: a few soft boxes, rendered once per mood
    this.pmrem = new THREE.PMREMGenerator(r);
    // the camera
    this.view = { yaw: 0, height: 0, dist: 4.5, target: new THREE.Vector3(0, 1, 0) };
    this.want = { dist: 4.5, target: new THREE.Vector3(0, 1, 0) };
    this.spin = 0;
    this.panelPx = 0;   // how much of the screen's right side the panel covers
    this.setLight('studio');
    addEventListener('resize', () => this.resize());
  }
  setLight(id){
    this.lightId = id;
    const L = { studio: { sky: ['#3a3d45', '#1a1c21'], hemi: [0xdde6ff, 0x504038, 0.7], key: [0xfff0e2, 2.8, [1.5, 3, 2.5]], rim: [0xc8d8ff, 2.0, [-2, 2.5, -2.5]], fill: [0xffe8d8, 0.6, [-2.5, 1.2, 2]], env: 0.7, exp: 1.0, boxes: '#ffffff' },
      day: { sky: ['#8fb8e8', '#dfe8f0'], hemi: [0xbfd8ff, 0x6a5a40, 1.3], key: [0xfff4e0, 3.4, [2.5, 4, 1.5]], rim: [0xffffff, 0.8, [-2, 2, -3]], fill: [0xd0e0ff, 0.5, [-3, 1, 2]], env: 1.0, exp: 0.95, boxes: '#cfe0ff' },
      sunset: { sky: ['#f0905a', '#3a2a4a'], hemi: [0xffb080, 0x302040, 0.6], key: [0xff9a50, 3.2, [3, 1.2, 1.8]], rim: [0x8a6aff, 1.8, [-2.5, 2, -2]], fill: [0x6a5aa0, 0.5, [-3, 1, 2]], env: 0.6, exp: 1.05, boxes: '#ffb27a' },
      night: { sky: ['#101830', '#05070c'], hemi: [0x4a5a90, 0x101018, 0.35], key: [0xffc888, 2.4, [1.2, 2.4, 1.8]], rim: [0x6a8aff, 1.6, [-2, 2.5, -2.5]], fill: [0x304070, 0.3, [-3, 1, 2]], env: 0.35, exp: 1.1, boxes: '#8090c0' } }[id] || null;
    if (!L) return;
    this.hemi.color.set(L.hemi[0]); this.hemi.groundColor.set(L.hemi[1]); this.hemi.intensity = L.hemi[2];
    for (const [l, d] of [[this.key, L.key], [this.rim, L.rim], [this.fill, L.fill]]){ l.color.set(d[0]); l.intensity = d[1]; l.position.set(...d[2]); }
    const g = this.backC.getContext('2d'), grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, L.sky[0]); grd.addColorStop(0.5, L.sky[1]); grd.addColorStop(1, '#0c0d10');
    g.fillStyle = grd; g.fillRect(0, 0, 16, 256); this.backT.needsUpdate = true;
    const es = new THREE.Scene(); es.background = new THREE.Color(L.sky[1]).multiplyScalar(0.6);
    for (const [x, y, z, s] of [[3, 3, 3, 2.5], [-3, 2, 2, 1.5], [0, 4, -3, 2], [0, -2, 2, 3]]){
      const b = new THREE.Mesh(new THREE.PlaneGeometry(s, s), new THREE.MeshBasicMaterial({ color: y < 0 ? '#3a3530' : L.boxes, side: THREE.DoubleSide }));
      b.position.set(x, y, z); b.lookAt(0, 1, 0); es.add(b);
    }
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromScene(es, 0.03);
    es.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    this.scene.environment = this.envRT.texture; this.scene.environmentIntensity = L.env;
    this.renderer.toneMappingExposure = L.exp;
  }
  // what to frame: 'body', 'head', 'face', 'eyes' (needs the character)
  frame(kind, character, instant = false){
    this.framing = kind;
    if (!character) return;
    character.root.updateMatrixWorld(true);
    const H = character.height(), head = character.headPosition(new THREE.Vector3());
    // the eyes (the face's middle is a little below them)
    const eye = character.bones['eye.L'] ? character.bones['eye.L'].getWorldPosition(new THREE.Vector3()) : head.clone().setY(head.y + 0.1);
    const f = { body: [H * 0.5, H * 2.9 + 0.3], head: [eye.y - 0.1, 1.35], face: [eye.y - 0.025, 0.78], eyes: [eye.y, 0.5] }[kind] || [H * 0.5, 5];
    this.want.target.set(0, f[0], 0); this.want.dist = f[1];
    this.view.height = 0;
    if (instant){ this.view.target.copy(this.want.target); this.view.dist = this.want.dist; }
  }
  orbit(dx, dy){ this.turntable.rotation.y += dx * 0.01; this.view.height = clamp(this.view.height + dy * 0.004, -0.6, 0.8); }
  zoom(k){ this.want.dist = clamp(this.want.dist * k, 0.35, 8); }
  resize(){
    if (this.renderer.xr.isPresenting) return;
    this.camera.aspect = window.innerWidth / window.innerHeight; this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
  update(dt){
    if (this.renderer.xr.isPresenting) return;
    const v = this.view, w = this.want;
    v.dist = damp(v.dist, w.dist, 6, dt);
    v.target.x = damp(v.target.x, w.target.x, 6, dt); v.target.y = damp(v.target.y, w.target.y, 6, dt); v.target.z = damp(v.target.z, w.target.z, 6, dt);
    if (this.spin) this.turntable.rotation.y += dt * this.spin;
    const cam = this.camera;
    cam.position.set(0, v.target.y + v.height * v.dist * 0.6, v.dist);
    cam.lookAt(v.target);
    // keep the person in the middle of what the panel leaves free
    const W = window.innerWidth, Hh = window.innerHeight, portrait = W < Hh;
    const off = portrait ? 0 : this.panelPx / 2, offY = portrait ? Hh * 0.22 : 0;
    if (off || offY) cam.setViewOffset(W, Hh, off, offY, W, Hh); else cam.clearViewOffset();
    // the key light's shadow follows the person
    this.key.target.position.set(0, 1, 0);
  }
  render(){ this.renderer.render(this.scene, this.camera); }
  // a little portrait of the face, for the gallery (a JPEG data URL)
  thumbnail(character, size = 160){
    const cam = new THREE.PerspectiveCamera(20, 1, 0.1, 20);
    character.root.updateMatrixWorld(true);
    const head = character.headPosition(new THREE.Vector3());
    const yaw = this.turntable.rotation.y; this.turntable.rotation.y = 0.25;
    // eyes open for the picture
    for (const m of character.human.allMeshes()) if (m.morphTargetInfluences && m.morphTargetInfluences.length) m.morphTargetInfluences[0] = 0;
    this.turntable.updateMatrixWorld(true);
    character.headPosition(head);
    cam.position.set(head.x + 0.18, head.y + 0.08, head.z + 0.95); cam.lookAt(head.x, head.y + 0.02, head.z);
    const r = this.renderer, old = new THREE.Vector2(); r.getSize(old);
    const pr = r.getPixelRatio();
    r.setPixelRatio(1); r.setSize(size * 2, size * 2, false);
    r.render(this.scene, cam);
    const c = document.createElement('canvas'); c.width = c.height = size;
    c.getContext('2d').drawImage(r.domElement, 0, 0, size * 2, size * 2, 0, 0, size, size);
    r.setPixelRatio(pr); r.setSize(old.x, old.y, false);
    this.turntable.rotation.y = yaw;
    return c.toDataURL('image/jpeg', 0.82);
  }
}
