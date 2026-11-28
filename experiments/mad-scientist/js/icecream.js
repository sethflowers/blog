// The ice cream: a waffle cone, one scoop of the base flavour, and the toppings that show what's in
// it (each ingredient has a look: sprinkles, chunks, drizzle, bubbles, sparks, goo, hairs, stars or
// a cherry, in its own colour). Every shape is made once and shared.
import * as THREE from 'three';
import { V, toon, keep, rng, mergeGeometries, paint, placed } from './util.js';
import { BASE, ING } from './recipes.js';

export const SCOOP_R = 0.085, CONE_H = 0.2;
let K = null;
function waffle(){
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#e0a050'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#a8662a'; g.lineWidth = 6;
  for (let i = -128; i < 256; i += 32){ g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 128, 128); g.stroke(); g.beginPath(); g.moveTo(i + 128, 0); g.lineTo(i, 128); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 2);
  return t;
}
// points on the upper part of the scoop
function onScoop(r, k, lo = 0.05){
  const y = lo + r() * (1 - lo), a = r() * Math.PI * 2, s = Math.sqrt(1 - y * y);
  return V(Math.cos(a) * s, y, Math.sin(a) * s).multiplyScalar(SCOOP_R * k);
}
function topping(style, color){
  const r = rng(style.length * 977 + 13), parts = [];
  const put = (g, p, rot, col) => { const o = new THREE.Object3D(); o.position.copy(p); if (rot) o.quaternion.copy(rot); else o.lookAt(p.clone().multiplyScalar(2)); o.updateMatrix(); g.applyMatrix4(o.matrix); parts.push(col ? paint(g, col) : paint(g, color)); };
  const rnd = () => new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * 6, r() * 6, r() * 6));
  if (style === 'sprinkles'){
    const cols = color === 'rainbow' ? ['#ff3a5a', '#3ad8ff', '#ffe02a', '#6aff3a', '#c050ff', '#ff8a1a', '#ffffff'] : [color];
    for (let i = 0; i < 46; i++){ const p = onScoop(r, 1.0); const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), V(r() - 0.5, r() - 0.5, r() - 0.5).cross(p).normalize()); put(new THREE.CapsuleGeometry(0.0045, 0.016, 2, 5), p, q, cols[i % cols.length]); }
  } else if (style === 'chunks'){
    for (let i = 0; i < 11; i++) put(new THREE.DodecahedronGeometry(0.012 + r() * 0.008, 0), onScoop(r, 0.97), rnd());
  } else if (style === 'bubbles'){
    for (let i = 0; i < 9; i++) put(new THREE.SphereGeometry(0.01 + r() * 0.012, 8, 6), onScoop(r, 1.04, 0.2));
  } else if (style === 'sparks' || style === 'stars'){
    for (let i = 0; i < 10; i++){ const g = new THREE.OctahedronGeometry(0.016, 0); g.scale(1, 1, 0.35); put(g, onScoop(r, 1.02, 0.15)); }
  } else if (style === 'hairs'){
    for (let i = 0; i < 22; i++){ const p = onScoop(r, 0.98, 0.2); const g = new THREE.CylinderGeometry(0.0018, 0.0025, 0.05, 4).translate(0, 0.025, 0); put(g, p, new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), p.clone().normalize().add(V(r() - 0.5, 0, r() - 0.5).multiplyScalar(0.8)).normalize())); }
  } else if (style === 'drizzle'){
    // a wavy ribbon round the top, with drips down the sides
    const pts = []; for (let i = 0; i <= 48; i++){ const a = i / 48 * Math.PI * 2, y = 0.55 + Math.sin(a * 5) * 0.18, s = Math.sqrt(1 - y * y); pts.push(V(Math.cos(a) * s, y, Math.sin(a) * s).multiplyScalar(SCOOP_R * 1.02)); }
    parts.push(paint(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 60, 0.006, 5, true), color));
    for (let i = 0; i < 5; i++){ const a = i / 5 * Math.PI * 2 + 0.3, p = V(Math.cos(a) * SCOOP_R * 0.97, SCOOP_R * 0.1, Math.sin(a) * SCOOP_R * 0.97); const g = new THREE.CapsuleGeometry(0.007, 0.03, 2, 6); put(g, p, new THREE.Quaternion()); }
  } else if (style === 'goo'){
    // a blob of goo poured over the top
    const g = new THREE.SphereGeometry(SCOOP_R * 1.04, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.36);
    const pos = g.attributes.position; for (let i = 0; i < pos.count; i++){ const x = pos.getX(i), z = pos.getZ(i), a = Math.atan2(z, x); if (pos.getY(i) < SCOOP_R * 0.6) pos.setY(i, pos.getY(i) - (Math.sin(a * 6) * 0.5 + 0.5) * 0.02); }
    g.computeVertexNormals(); parts.push(paint(g, color));
  } else if (style === 'cherry'){
    put(new THREE.SphereGeometry(0.022, 12, 10), V(0, SCOOP_R + 0.012, 0), new THREE.Quaternion());
    const st = new THREE.CylinderGeometry(0.002, 0.002, 0.05, 4).translate(0, 0.025, 0); put(st, V(0, SCOOP_R + 0.03, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.4)), '#3a7a1a');
  }
  return keep(mergeGeometries(parts));
}
function kit(){
  if (K) return K;
  K = {};
  K.cone = keep(new THREE.ConeGeometry(SCOOP_R * 0.9, CONE_H, 18, 1, true).rotateX(Math.PI).translate(0, CONE_H / 2, 0));
  K.coneLid = keep(new THREE.CircleGeometry(SCOOP_R * 0.86, 18).rotateX(-Math.PI / 2).translate(0, CONE_H - 0.012, 0));
  K.lidMat = toon('cone-inside', '#8a5428');
  K.coneTop = keep(new THREE.TorusGeometry(SCOOP_R * 0.9, 0.008, 6, 20).rotateX(Math.PI / 2).translate(0, CONE_H, 0));
  // the scoop: a ball with a wavy lip where it sits on the cone
  const s = new THREE.SphereGeometry(SCOOP_R, 22, 16), p = s.attributes.position;
  for (let i = 0; i < p.count; i++){ const y = p.getY(i); if (y < -SCOOP_R * 0.35){ const a = Math.atan2(p.getZ(i), p.getX(i)); const k = 1.12 + Math.sin(a * 9) * 0.05; p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); p.setY(i, Math.max(y, -SCOOP_R * 0.62)); } }
  s.computeVertexNormals();
  K.scoop = keep(s.translate(0, CONE_H + SCOOP_R * 0.5, 0));
  K.coneMat = toon('cone', '#ffffff', { map: waffle() });
  K.rimMat = toon('cone-rim', '#c87a3a');
  K.tops = {};
  K.topMat = toon('topping', '#ffffff', { vertexColors: true });
  K.glowMat = toon('topping-glow', '#ffffff', { vertexColors: true, emissive: '#606060' });
  return K;
}
function topGeo(ing){
  const k = kit(), d = ING[ing];
  if (!k.tops[ing]){ const g = topping(d.top, ing === 'sprinkles' ? 'rainbow' : d.color); g.translate(0, CONE_H + SCOOP_R * 0.5, 0); k.tops[ing] = keep(g); }
  return k.tops[ing];
}

export class Cone {
  constructor(){
    const k = kit();
    this.group = new THREE.Group();
    this.cone = new THREE.Mesh(k.cone, k.coneMat);
    this.rim = new THREE.Mesh(k.coneTop, k.rimMat);
    this.lid = new THREE.Mesh(k.coneLid, k.lidMat); this.rim.add(this.lid);
    this.scoop = new THREE.Mesh(k.scoop, toon('base-vanilla', BASE.vanilla.color));
    this.tops = [new THREE.Mesh(k.cone, k.topMat), new THREE.Mesh(k.cone, k.topMat)];
    this.tops[1].rotation.y = Math.PI * 0.4; this.tops[1].scale.setScalar(1.015);
    this.group.add(this.cone, this.rim, this.scoop, ...this.tops);
    this.set(null, []);
  }
  set(base, ings){
    this.base = base; this.ings = [...ings];
    this.scoop.visible = !!base;
    if (base) this.scoop.material = toon('base-' + base, BASE[base].color);
    this.tops.forEach((m, i) => {
      const id = ings[i];
      m.visible = !!id && !!base;
      if (id){ m.geometry = topGeo(id); m.material = /sparks|stars|goo/.test(ING[id].top) ? kit().glowMat : kit().topMat; }
    });
    // the same ingredient twice: the second lot sits a little higher (no two surfaces in one place)
    this.tops[1].scale.setScalar(ings[0] === ings[1] ? 1.06 : 1.015);
  }
  // eaten: s from 1 (whole) to 0 (gone); the scoop goes first, then the cone
  eaten(s){
    const a = Math.max(0, Math.min(1, s * 2 - 1)), b = Math.max(0, Math.min(1, s * 2));
    // (each part shrinks towards the top of the cone)
    for (const m of [this.scoop, ...this.tops]){ m.scale.setScalar(Math.max(0.001, a)); m.position.y = CONE_H * (1 - a); }
    for (const m of [this.cone, this.rim]){ m.scale.setScalar(Math.max(0.001, b)); m.position.y = CONE_H * (1 - b); }
    this.group.visible = s > 0.01;
  }
  whole(){ for (const m of [this.scoop, ...this.tops, this.cone, this.rim]){ m.scale.setScalar(1); m.position.y = 0; } this.set(this.base, this.ings); this.group.visible = true; }
}
// a lone scoop ball (flies from a tub to the cone)
export function scoopBall(base){ const m = new THREE.Mesh(kit().scoop, toon('base-' + base, BASE[base].color)); m.position.y = -(CONE_H + SCOOP_R * 0.5); const g = new THREE.Group(); g.add(m); return g; }
export const SCOOP_Y = CONE_H + SCOOP_R * 0.5;
void placed;
