// Pictures for the trays: each catalogue item rendered once (lazily) from its real model, and swatches
// of the path and ground textures. Kept as canvases (for the VR tablet) and data URLs (for the HTML).
import * as THREE from 'three';
import { CATALOG, model, resolveMat } from './models.js';
import { texture, mat } from './materials.js';
import { buildFence, buildSign, buildLot, buildGate, disposeStructure } from './structures.js';
import { buildBuilding, fromTemplate } from './buildings.js';
import { buildStall, newStall } from './shops.js';

const SIZE = 128;
export class Thumbs {
  constructor(renderer){
    this.r = renderer; this.cache = new Map(); this.canvases = new Map();
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xdde8ff, 0x5a5040, 2.2));
    const sun = new THREE.DirectionalLight(0xfff2e0, 2.6); sun.position.set(4, 8, 6); this.scene.add(sun);
    this.cam = new THREE.PerspectiveCamera(30, 1, 0.1, 500);
    this.rt = new THREE.WebGLRenderTarget(SIZE, SIZE, { samples: 4 });
    this.lut = new Uint8Array(256); for (let i = 0; i < 256; i++){ const v = i / 255; this.lut[i] = Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)); }
  }
  get(type){
    if (this.cache.has(type)) return this.cache.get(type);
    let obj, own = false;
    const fakePark = { floorAt: () => 0, groundAt: () => 0 };
    if (CATALOG[type]){ obj = new THREE.Group(); for (const p of model(type).parts) obj.add(new THREE.Mesh(p.geo, p.key === 'tint' ? mat('flagThumb', { c: 0xb02030, r: 0.7, side: THREE.DoubleSide }) : resolveMat(p.key))); }
    else if (type.startsWith('fence_')){ obj = buildFence({ type, x: -3, z: 0, x2: 3, z2: 0 }, fakePark); own = true; }
    else if (type === 'sign'){ obj = buildSign({ name: 'Welcome' }); own = true; }
    else if (type === 'lot'){ obj = buildLot({ x: 0, z: 0, w: 10, d: 8, name: 'Parking' }, fakePark); own = true; }
    else if (type === 'gate'){ obj = buildGate('Your Park'); own = true; }
    else if (type.startsWith('stall:')){ obj = buildStall(newStall(type.slice(6))); own = true; }
    else if (type.startsWith('bp:')){ const d = ((this.app && this.app.blueprints) || []).find((q) => q.id === type.slice(3)); if (!d) return ''; obj = d.kind === 'stall' ? buildStall(d.data) : buildBuilding({ walls: {}, towers: [], extras: [], ...d.data, x: 0, z: 0, r: 0 }, fakePark); own = true; }
    else if (type.startsWith('tpl:')){ obj = buildBuilding({ ...fromTemplate(type.slice(4)), x: 0, z: 0, r: 0 }, fakePark); own = true; }
    else return '';
    this.scene.add(obj);
    const box = new THREE.Box3().setFromObject(obj), c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
    const R = Math.max(sz.x, sz.y * 1.1, sz.z) * 0.62 + 0.2;
    const dist = R / Math.tan(THREE.MathUtils.degToRad(15));
    this.cam.position.copy(c).add(new THREE.Vector3(0.75, 0.55, 1).normalize().multiplyScalar(dist)); this.cam.lookAt(c);
    this.cam.near = dist * 0.1; this.cam.far = dist * 4; this.cam.updateProjectionMatrix();
    const env = this.scene.environment; this.scene.environment = this.r.__env || null;
    const prev = this.r.getRenderTarget(), xr = this.r.xr.enabled; this.r.xr.enabled = false;
    this.r.setRenderTarget(this.rt); this.r.setClearColor(0x000000, 0); this.r.clear(); this.r.render(this.scene, this.cam);
    const px = new Uint8Array(SIZE * SIZE * 4); this.r.readRenderTargetPixels(this.rt, 0, 0, SIZE, SIZE, px);
    this.r.setRenderTarget(prev); this.r.xr.enabled = xr; this.scene.environment = env;
    this.scene.remove(obj); if (own) disposeStructure(obj);
    const cv = document.createElement('canvas'); cv.width = cv.height = SIZE; const g = cv.getContext('2d'), img = g.createImageData(SIZE, SIZE);
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++){ const s = ((SIZE - 1 - y) * SIZE + x) * 4, d = (y * SIZE + x) * 4; img.data[d] = this.lut[px[s]]; img.data[d + 1] = this.lut[px[s + 1]]; img.data[d + 2] = this.lut[px[s + 2]]; img.data[d + 3] = px[s + 3]; }
    g.putImageData(img, 0, 0);
    const url = cv.toDataURL('image/png');
    this.cache.set(type, url); this.canvases.set(type, cv);
    return url;
  }
  swatch(name){
    const key = 'sw:' + name;
    if (this.cache.has(key)) return this.cache.get(key);
    const src = texture(name).map.image, cv = document.createElement('canvas'); cv.width = cv.height = 96;
    const g = cv.getContext('2d'); g.drawImage(src, 0, 0, 256, 256, 0, 0, 96, 96);
    const url = cv.toDataURL('image/jpeg', 0.85);
    this.cache.set(key, url); this.canvases.set(key, cv);
    return url;
  }
  canvas(key){ if (!this.canvases.has(key)){ if (key.startsWith('sw:')) this.swatch(key.slice(3)); else this.get(key); } return this.canvases.get(key); }
}
