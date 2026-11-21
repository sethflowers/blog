// Shops and food: what can be sold, menus, the stalls you design, and menu boards.
//
// A stall is an object { type: 'stall', kind, roof, color, color2, name, sells, menu: [{ id, price }] }
//   kind:  kiosk | cart | booth | info        roof: canopy | dome | pitched | umbrella
// A building with a use ('food', 'restaurant', 'shop', 'toilets', 'firstaid') is fitted out inside to
// match (see buildings.js), and food places and shops have a menu too.
import * as THREE from 'three';
import { Batch, UNIT_BOX, lathe } from './util.js';
import { mat } from './materials.js';
import { resolveMat } from './models.js';
import { boardTexture } from './structures.js';

export const GOODS = {
  burger: { name: 'Burger', price: 4.5, sells: 'food' }, hotdog: { name: 'Hot dog', price: 3.5, sells: 'food' }, pizza: { name: 'Pizza slice', price: 4, sells: 'food' },
  fries: { name: 'Fries', price: 2.5, sells: 'food' }, fish: { name: 'Fish and chips', price: 6, sells: 'food' }, pie: { name: 'Pie and mash', price: 5.5, sells: 'food' },
  pretzel: { name: 'Pretzel', price: 3, sells: 'snacks' }, popcorn: { name: 'Popcorn', price: 2.5, sells: 'snacks' }, flossy: { name: 'Candy floss', price: 2.5, sells: 'snacks' },
  icecream: { name: 'Ice cream', price: 3, sells: 'snacks' }, donut: { name: 'Doughnuts', price: 3, sells: 'snacks' }, apple: { name: 'Toffee apple', price: 2.5, sells: 'snacks' },
  lemonade: { name: 'Lemonade', price: 2.5, sells: 'drinks' }, cola: { name: 'Cola', price: 2, sells: 'drinks' }, coffee: { name: 'Coffee', price: 2.5, sells: 'drinks' },
  cocoa: { name: 'Hot chocolate', price: 3, sells: 'drinks' }, shake: { name: 'Milkshake', price: 4, sells: 'drinks' }, tea: { name: 'Tea', price: 2, sells: 'drinks' },
  balloon: { name: 'Balloon', price: 3, sells: 'gifts' }, hat: { name: 'Hat', price: 6, sells: 'gifts' }, plush: { name: 'Toy dragon', price: 12, sells: 'gifts' },
  tshirt: { name: 'T-shirt', price: 15, sells: 'gifts' }, map: { name: 'Park map', price: 1, sells: 'gifts' }, umbrella: { name: 'Umbrella', price: 8, sells: 'gifts' },
  wand: { name: 'Magic wand', price: 10, sells: 'gifts' }, crown: { name: 'Crown', price: 8, sells: 'gifts' },
};
export const SELLS = [['food', 'Hot food'], ['snacks', 'Snacks and sweets'], ['drinks', 'Drinks'], ['gifts', 'Gifts']];
// what a place offers by default (a food place sells food and drinks; a restaurant more of both)
export function defaultMenu(kind){
  const pick = (ids) => ids.map((id) => ({ id, price: GOODS[id].price }));
  if (kind === 'food') return pick(['burger', 'hotdog', 'fries', 'cola', 'lemonade']);
  if (kind === 'restaurant') return pick(['fish', 'pie', 'pizza', 'burger', 'fries', 'tea', 'coffee', 'lemonade']);
  if (kind === 'snacks') return pick(['icecream', 'flossy', 'popcorn', 'lemonade']);
  if (kind === 'drinks') return pick(['lemonade', 'cola', 'coffee', 'shake']);
  if (kind === 'gifts' || kind === 'shop') return pick(['balloon', 'hat', 'plush', 'map', 'umbrella']);
  return [];
}
// what can go on a menu: the goods of these kinds
export function goodsFor(use){
  const kinds = use === 'shop' || use === 'gifts' ? ['gifts'] : use === 'restaurant' ? ['food', 'drinks', 'snacks'] : use === 'drinks' ? ['drinks', 'snacks'] : use === 'snacks' ? ['snacks', 'drinks'] : ['food', 'drinks', 'snacks'];
  return Object.entries(GOODS).filter(([, g]) => kinds.includes(g.sells)).map(([id]) => id);
}
export const price = (p) => '$' + (Math.round(p * 100) / 100).toFixed(2);

// --- a menu board: the place's name and what it sells, chalk on a dark board ----------------------------------
export function menuTexture(title, menu){
  const W = 512, H = 640, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = '#1e2420'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#a07a40'; g.lineWidth = 22; g.strokeRect(11, 11, W - 22, H - 22);
  g.fillStyle = '#f2d27a'; g.font = 'bold 40px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  let size = 40; while (g.measureText(title).width > W - 80 && size > 18){ size -= 2; g.font = `bold ${size}px Georgia, serif`; }
  g.fillText(title, W / 2, 70);
  g.strokeStyle = 'rgba(242,210,122,.5)'; g.lineWidth = 2; g.beginPath(); g.moveTo(70, 108); g.lineTo(W - 70, 108); g.stroke();
  g.font = '30px "Avenir Next", "Helvetica Neue", Arial, sans-serif'; g.textBaseline = 'middle';
  const rows = menu.slice(0, 10), lh = Math.min(48, (H - 170) / Math.max(1, rows.length));
  rows.forEach((m, k) => {
    const y = 150 + k * lh;
    g.textAlign = 'left'; g.fillStyle = '#f0ece0'; g.fillText((GOODS[m.id] || { name: m.id }).name, 56, y);
    g.textAlign = 'right'; g.fillStyle = '#f2d27a'; g.fillText(price(m.price), W - 56, y);
  });
  if (!rows.length){ g.textAlign = 'center'; g.fillStyle = '#b8b0a0'; g.fillText('(nothing on the menu)', W / 2, H / 2); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
export function boardPlane(tex, w, h){
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
  m.userData.ownMaterial = true;
  return m;
}

// --- stalls -----------------------------------------------------------------------------------------------
export const STALLS = {
  kiosk: { name: 'Kiosk', about: 'A square kiosk with a counter all round' },
  cart: { name: 'Cart', about: 'A wheeled cart under a striped umbrella' },
  booth: { name: 'Booth', about: 'A little shed with a serving hatch' },
  info: { name: 'Information kiosk', about: 'A round kiosk with a map of the park' },
};
export const STALL_ROOFS = [['canopy', 'Striped canopy'], ['dome', 'Dome'], ['pitched', 'Pitched'], ['umbrella', 'Umbrella']];
export const STALL_COLORS = ['#1e5a3a', '#7a2a2a', '#2a3a6a', '#c8983a', '#5a2a6a', '#2a6a6a', '#f0e8d8'];
export function newStall(kind = 'kiosk', sells = 'snacks'){
  const roof = { kiosk: 'canopy', cart: 'umbrella', booth: 'pitched', info: 'dome' }[kind];
  return { type: 'stall', kind, roof, color: kind === 'info' ? '#2a3a6a' : '#7a2a2a', color2: '#f0e8d8', sells: kind === 'info' ? 'gifts' : sells, name: kind === 'info' ? 'Information' : STALLS[kind].name, menu: kind === 'info' ? defaultMenu('gifts').filter((m) => m.id === 'map' || m.id === 'umbrella') : defaultMenu(sells) };
}
const stripeMats = new Map();
function stripes(a, b){
  const k = a + b; let m = stripeMats.get(k); if (m) return m;
  const c = document.createElement('canvas'); c.width = 256; c.height = 32; const g = c.getContext('2d');
  for (let i = 0; i < 8; i++){ g.fillStyle = i % 2 ? b : a; g.fillRect(i * 32, 0, 32, 32); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping;
  m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, side: THREE.DoubleSide }); stripeMats.set(k, m);
  return m;
}
const paint = (hex) => mat('paint' + hex.slice(1), { c: parseInt(hex.slice(1), 16), r: 0.5 });
// a striped canopy: an n-sided pyramid (or cone) of canvas, stripes running down it, with a scalloped edge
function canopy(r, h, n){
  const pos = [], uv = [], idx = [];
  for (let k = 0; k <= n; k++){ const a = k / n * Math.PI * 2 + Math.PI / n; pos.push(Math.cos(a) * r, 0, Math.sin(a) * r, 0, h, 0); uv.push(k / n * 8, 0, k / n * 8 + 4 / n, 1); }
  for (let k = 0; k < n; k++){ const v = k * 2; idx.push(v, v + 1, v + 2); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  g.userData.keepUV = true;
  return g;
}
export function buildStall(o){
  const g = new THREE.Group(), B = new Batch(), C = o.color || '#7a2a2a', C2 = o.color2 || '#f0e8d8';
  const box = (k, x, y, z, w, h, d, ry = 0) => B.box(k, x, y, z, w, h, d, ry);
  const P = 'P', S = 'S';   // paint and stripes, resolved below
  const glows = [];
  const own = [];
  let top = 3, signY = 3, signZ = 1.2, signW = 2.2, cols = [{ c: [0, 0], r: 1.3 }];
  if (o.kind === 'kiosk' || o.kind === 'info'){
    const round = o.kind === 'info';
    if (round){ B.add(lathe([[0, 0], [1.15, 0], [1.15, 1.0], [1.25, 1.05], [1.25, 1.12], [0, 1.12]], 24), P, null); }
    else { box(P, 0, 0.5, 0, 2.2, 1.0, 2.2); box('wood', 0, 1.06, 0, 2.5, 0.08, 2.5); box('darkwood', 0, 0.06, 0, 2.3, 0.12, 2.3); }
    for (const [x, z] of round ? [[0.9, 0.9], [-0.9, 0.9], [0.9, -0.9], [-0.9, -0.9]].map(([x, z]) => [x * 0.9, z * 0.9]) : [[1.1, 1.1], [-1.1, 1.1], [1.1, -1.1], [-1.1, -1.1]]) box('darkwood', x, 1.7, z, 0.1, 1.3, 0.1);
    box('darkwood', 0, 2.38, 0, 2.5, 0.08, 2.5);
    top = 2.42; signZ = 1.28; signY = 2.15; cols = [{ c: [0, 0], r: 1.35 }];
    if (round){ const m = boardPlane(boardTexture('PARK MAP', { bg: '#2a4a2a', fg: '#f2d27a', w: 512, h: 256 }), 0.9, 0.45); m.position.set(0, 0.62, -1.17); m.rotation.y = Math.PI; own.push(m); }
  } else if (o.kind === 'cart'){
    box(P, 0, 0.95, 0, 1.9, 0.75, 1.1); box('wood', 0, 1.36, 0, 2.05, 0.06, 1.25); box('darkwood', 0, 0.55, 0, 1.95, 0.06, 1.15);
    for (const s of [-1, 1]){ B.add(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 16).rotateX(Math.PI / 2), 'darkwood', new THREE.Matrix4().makeTranslation(0.45 * s, 0.42, 0.62 * s)); B.add(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 16).rotateX(Math.PI / 2), 'darkwood', new THREE.Matrix4().makeTranslation(0.45 * s, 0.42, -0.62 * s)); }
    for (const s of [-1, 1]) for (const t of [-1, 1]) B.add(new THREE.TorusGeometry(0.4, 0.025, 6, 20), 'iron', new THREE.Matrix4().makeTranslation(0.45 * s, 0.42, 0.66 * t));
    box('darkwood', -1.25, 0.95, 0, 0.6, 0.05, 0.05); box('darkwood', -1.25, 0.95, 0.4, 0.6, 0.05, 0.05);
    box('iron', 0, 2.1, 0, 0.05, 1.5, 0.05);
    top = 2.85; signY = 1.62; signZ = 0.6; signW = 1.7; cols = [{ c: [0, 0], r: 1.1 }];
  } else {
    // booth: a little shed with a serving hatch at the front
    box(P, 0, 1.25, -0.9, 2.4, 2.5, 0.12); box(P, -1.14, 1.25, 0, 0.12, 2.5, 1.9); box(P, 1.14, 1.25, 0, 0.12, 2.5, 1.9);
    box(P, 0, 0.5, 0.9, 2.4, 1.0, 0.12); box(P, 0, 2.3, 0.9, 2.4, 0.4, 0.12);
    box('wood', 0, 1.05, 0.98, 2.3, 0.06, 0.32); box('darkwood', 0, 0.05, 0, 2.5, 0.1, 2.0);
    top = 2.5; signY = 2.3; signZ = 0.97; cols = [{ box: [-1.2, -0.96, 1.2, 0.96] }];
  }
  // the roof
  const rf = o.roof || 'canopy';
  if (rf === 'canopy'){ B.add(canopy(1.75, 1.1, 8), S, new THREE.Matrix4().makeTranslation(0, top, 0)); B.add(new THREE.SphereGeometry(0.09, 10, 8), 'gold', new THREE.Matrix4().makeTranslation(0, top + 1.15, 0)); }
  else if (rf === 'umbrella'){ B.add(canopy(1.55, 0.6, 12), S, new THREE.Matrix4().makeTranslation(0, top, 0)); B.add(new THREE.SphereGeometry(0.06, 8, 6), 'gold', new THREE.Matrix4().makeTranslation(0, top + 0.64, 0)); }
  else if (rf === 'dome'){ B.add(new THREE.SphereGeometry(1.45, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), 'copper', new THREE.Matrix4().makeTranslation(0, top, 0)); B.add(new THREE.CylinderGeometry(1.5, 1.5, 0.12, 24), 'darkwood', new THREE.Matrix4().makeTranslation(0, top + 0.02, 0)); B.add(new THREE.SphereGeometry(0.1, 10, 8), 'gold', new THREE.Matrix4().makeTranslation(0, top + 1.5, 0)); }
  else { const r = new THREE.ConeGeometry(1.95, 1.1, 4); r.rotateY(Math.PI / 4); B.add(r, 'tiles', new THREE.Matrix4().compose(new THREE.Vector3(0, top + 0.55, 0), new THREE.Quaternion(), new THREE.Vector3(1, 1, 0.8))); }
  // a lamp under the roof
  B.add(new THREE.SphereGeometry(0.08, 10, 8), 'glow', new THREE.Matrix4().makeTranslation(0, top - 0.25, 0)); glows.push([0, top - 0.25, 0]);
  const body = B.build((k) => k === P ? paint(C) : k === S ? stripes(C, C2) : resolveMat(k));
  body.traverse((m) => { if (m.isMesh){ m.castShadow = true; m.receiveShadow = true; } });
  g.add(body);
  // the name across the front, and the menu at the back
  const sign = boardPlane(boardTexture(o.name || 'Stall', { bg: C, fg: '#f8f0dc', border: '#f8f0dc', w: 1024, h: 200 }), signW, 0.42);
  sign.position.set(0, signY, signZ + 0.02); own.push(sign);
  const back = new THREE.Mesh(new THREE.BoxGeometry(signW, 0.46, 0.04), paint(C)); back.position.set(0, signY, signZ - 0.01); back.castShadow = true; own.push(back);
  if (o.kind !== 'cart' && o.menu && o.menu.length){
    const mb = boardPlane(menuTexture(o.name || '', o.menu), 0.8, 1.0);
    if (o.kind === 'booth'){ mb.position.set(0, 1.6, -0.83); }
    else { mb.position.set(0, 1.85, -0.25); mb.userData.both = true; }
    own.push(mb);
  }
  for (const m of own) g.add(m);
  g.userData = { glows, colliders: cols };
  return g;
}
export { UNIT_BOX };
