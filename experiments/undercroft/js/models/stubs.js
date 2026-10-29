// Plain stand-ins with the same API as beast.js, people.js and props.js. The game falls back to these
// if a model module fails to load, so a broken model never stops the game from running.
import * as THREE from 'three';

const mat = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.7 }, o || {}));
const box = (w, h, d, m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.castShadow = true; return b; };

export function createBeast(){
  const group = new THREE.Group(), m = mat(0x2a2620);
  const body = box(1.4, 1.2, 3.2, m); body.position.y = 3; group.add(body);
  const neck = box(0.5, 2.6, 0.5, m); neck.position.set(0, 4.6, 1.5); group.add(neck);
  const head = box(0.6, 0.5, 1.0, m); head.position.set(0, 5.8, 1.9); group.add(head);
  const mouth = new THREE.Object3D(); mouth.position.set(0, -0.1, 0.5); head.add(mouth);
  const eyes = [-0.2, 0.2].map((x) => { const e = new THREE.Object3D(); e.position.set(x, 0.12, 0.3); head.add(e); return e; });
  for (const [x, z] of [[-0.5, -1.2], [0.5, -1.2], [-0.5, 1.2], [0.5, 1.2]]){ const l = box(0.25, 2.4, 0.25, m); l.position.set(x, 1.2, z); group.add(l); }
  for (const s of [-1, 1]){ const w = box(0.1, 2.5, 1.5, m); w.position.set(s * 0.8, 4.3, -0.3); group.add(w); }
  return { group, mouth, eyes, height: 6, parts: [{ object: body, radius: 1.5, kind: 'body' }, { object: head, radius: 0.6, kind: 'head' }, { object: neck, radius: 0.7, kind: 'neck' }],
    update(){} };
}

export async function createPeopleKit(){
  const make = (c) => () => {
    const group = new THREE.Group(), m = mat(c);
    const body = box(0.45, 1.0, 0.3, m); body.position.y = 1.0; group.add(body);
    const head = box(0.22, 0.26, 0.24, m); head.position.y = 1.65; group.add(head);
    for (const x of [-0.12, 0.12]){ const l = box(0.14, 0.5, 0.14, m); l.position.set(x, 0.25, 0); group.add(l); }
    return { group, height: 1.75, parts: [{ object: body, radius: 0.4, kind: 'body' }, { object: head, radius: 0.2, kind: 'head' }],
      update(dt, s){ group.rotation.x = -(s && s.dead || 0) * 1.5; group.position.y = ((s && s.emerge !== undefined) ? s.emerge - 1 : 0) * 1.7; } };
  };
  return { makeZombie: make(0x4a5a40), makePrisoner: make(0x8a6a50) };
}

export function createWeapon(kind){
  const g = new THREE.Group(), steel = mat(0xb0b0b8, { metalness: 1, roughness: 0.35 }), wood = mat(0x5a3a20);
  if (kind === 'sword'){ const b = box(0.05, 0.75, 0.01, steel); b.position.y = 0.45; g.add(b); g.add(box(0.2, 0.03, 0.03, steel)); }
  else if (kind === 'spear'){ const s = box(0.03, 2.0, 0.03, wood); s.position.y = 0.35; g.add(s); const h = box(0.05, 0.25, 0.01, steel); h.position.y = 1.45; g.add(h); }
  else if (kind === 'hammer'){ const s = box(0.04, 0.8, 0.04, wood); s.position.y = 0.3; g.add(s); const h = box(0.12, 0.12, 0.25, steel); h.position.y = 0.7; g.add(h); }
  else { const s = box(0.06, 0.06, 0.7, wood); s.position.z = -0.3; g.add(s); const p = box(0.6, 0.03, 0.03, steel); p.position.z = -0.6; g.add(p); }
  return g;
}
export function createBolt(){ return box(0.015, 0.015, 0.35, mat(0x6a5030)); }
export function createFood(kind){
  const c = { bread: 0xa0703a, apple: 0x9a1a10, cheese: 0xd8b040, drumstick: 0x7a4a20 }[kind];
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), mat(c)); m.position.y = 0.08;
  const g = new THREE.Group(); g.add(m); return g;
}
export function createChest(){
  const group = new THREE.Group(), m = mat(0x4a3220);
  const b = box(0.9, 0.4, 0.55, m); b.position.y = 0.2; group.add(b);
  const lid = new THREE.Group(); lid.position.set(0, 0.4, -0.275); group.add(lid);
  const l = box(0.9, 0.15, 0.55, m); l.position.set(0, 0.075, 0.275); lid.add(l);
  return { group, setOpen(f){ lid.rotation.x = -f * 1.8; } };
}
export function createPowerGate(kind){
  const group = new THREE.Group(), c = { magnet: 0xff3030, bomb: 0xff8020, freeze: 0x80c0ff, shield: 0xffd040, flight: 0x70ffd0 }[kind];
  const s = mat(0x5a5650);
  for (const x of [-1.0, 1.0]){ const p = box(0.4, 3, 0.5, s); p.position.set(x, 1.5, 0); group.add(p); }
  const top = box(2.4, 0.4, 0.5, s); top.position.y = 2.9; group.add(top);
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(2), transparent: true, opacity: 0.6, side: THREE.DoubleSide });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.6), glowMat); glow.position.y = 1.3; group.add(glow);
  return { group, update(){}, setActive(on){ glowMat.opacity = on ? 0.6 : 0.1; } };
}
export function createCellBars(){
  const group = new THREE.Group(), m = mat(0x2a2622, { metalness: 0.8 });
  for (let x = -1.2; x <= 1.21; x += 0.2){ const b = box(0.03, 3.2, 0.03, m); b.position.set(x, 1.6, 0); group.add(b); }
  return { group, setOpen(f){ group.visible = f < 0.5; } };
}
export function createPortcullis(){
  const group = new THREE.Group(), m = mat(0x2a2622, { metalness: 0.8 });
  for (let x = -1.2; x <= 1.21; x += 0.24){ const b = box(0.05, 3.2, 0.05, m); b.position.set(x, 1.6, 0); group.add(b); }
  for (let y = 0.3; y < 3.2; y += 0.5){ const b = box(2.6, 0.05, 0.05, m); b.position.set(0, y, 0); group.add(b); }
  return { group, setRaised(f){ group.position.y = f * 3.1; } };
}
export function createBrazier(){
  const group = new THREE.Group(), m = mat(0x2a2622, { metalness: 0.7 });
  const bowl = box(0.6, 0.25, 0.6, m); bowl.position.y = 1.0; group.add(bowl);
  const leg = box(0.08, 1.0, 0.08, m); leg.position.y = 0.5; group.add(leg);
  const flameAnchor = new THREE.Object3D(); flameAnchor.position.y = 1.12; group.add(flameAnchor);
  return { group, flameAnchor };
}
export function createBomb(){
  const group = new THREE.Group(); const b = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), mat(0x151515, { metalness: 0.6 }));
  b.position.y = 0.12; group.add(b); return { group, update(){} };
}
export function createCrackedWall(){
  const group = new THREE.Group(); const w = box(2.6, 3.2, 0.2, mat(0x4a4640)); w.position.y = 1.6; group.add(w);
  return { group, debris(){ return Array.from({ length: 14 }, () => box(0.2, 0.15, 0.2, mat(0x4a4640))); } };
}
export function createSkullPile(){ const g = new THREE.Group(); g.add(box(0.3, 0.15, 0.3, mat(0xc8c0a8))); return g; }
