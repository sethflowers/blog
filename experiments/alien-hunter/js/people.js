// The townsfolk. Each is a cartoon person (a big round head, a round body, stubby arms and legs) with
// something inside: a skeleton (a real person) or a little green alien (an alien in disguise). The
// insides are drawn on their own layer (INNER), which only the X-ray tablet's camera looks at.
// People wander the town along the walking graph (sidewalks, park paths, into houses and shops and
// round the rooms), chat now and then, and when the shock gun hits them they light up (you see their
// insides flash, cartoon style): aliens lose their disguise and fall down dead, people say "Ow!".
// Shapes made over and over (the skeleton, the alien, X eyes, goo) are built once and shared; each
// person's own coloured shapes are freed when they go.
import * as THREE from 'three';
import { V, clamp, damp, angleDiff, ellipsoid, limb, mergeGeometries, paint, placed, toon, basic, textCanvas, roundRect, rng } from './util.js';

export const INNER = 6;

const SKIN = ['#ffd9bc', '#f2c49e', '#d9a173', '#b07a50', '#8a5a3a', '#5e3b26'];
const SHIRT = ['#e8453a', '#3a8ae8', '#f8c020', '#3ab85a', '#a84ae8', '#ff8ab8', '#ff8a2a', '#2ac8c8', '#ffffff', '#4a4a5a'];
const PANTS = ['#2a3a6a', '#4a4a4a', '#6a4a2a', '#3a5a3a', '#c8b890', '#1a1a2a', '#8a2a3a'];
const HAIR = ['#2a1a10', '#5a3a1a', '#c8902a', '#f0d070', '#b84a20', '#9a9aa0', '#111111', '#e8e8e8'];
const STYLES = ['short', 'short', 'long', 'bun', 'spiky', 'bald', 'pony', 'curly'];
const NAMES = ['Bob', 'Sue', 'Pat', 'Ann', 'Tom', 'Meg', 'Joe', 'Liz', 'Sam', 'Kim', 'Dan', 'Amy', 'Ray', 'Eve', 'Max', 'Ivy', 'Ted', 'Zoe', 'Gus', 'Fay', 'Ned', 'Dot', 'Hal', 'Mae', 'Lou', 'Bea'];
const HUMAN_LINES = ['Lovely day!', 'Have you seen my cat?', 'Hello there!', 'I need more milk.', 'Nice weather today.', 'Off to the shops!', 'My feet hurt.', 'Hi, neighbour!', 'What a nice town.', 'Is it lunch yet?', 'I love this street.', 'Busy busy busy!'];
const ALIEN_LINES = ['Greetings, fellow human.', 'I too enjoy breathing air.', 'My skin is normal skin.', 'Take me to your... bakery.', 'Beep. I mean, hello!', 'Nice weather for Earthlings.', 'I have one normal head.', 'Hello! I am a human person.', 'Mmm, delicious Earth food.'];

const BONE = '#e8f4ff', SOCKET = '#0a0e1a', GREEN = '#5dff3a', GREEN2 = '#b8ff8a', DGREEN = '#2a9a2a';

// ---------- shared shapes ----------
const keep = (g) => { g.userData.keep = true; return g; };
let shared = null;
function sharedShapes(){
  if (shared) return shared;
  const P = (g, c, ...a) => paint(placed(g, ...a), c);
  const cyl = (r0, r1, h) => new THREE.CylinderGeometry(r1, r0, h, 8);
  // the skeleton
  const sk = [
    P(new THREE.SphereGeometry(0.155, 16, 12), BONE, 0, 1.68, 0),
    P(ellipsoid(0.1, 0.05, 0.09, 12, 8), BONE, 0, 1.56, 0.03),
    P(new THREE.SphereGeometry(0.045, 10, 8), SOCKET, -0.06, 1.69, 0.125), P(new THREE.SphereGeometry(0.045, 10, 8), SOCKET, 0.06, 1.69, 0.125),
    P(new THREE.SphereGeometry(0.02, 6, 4), SOCKET, 0, 1.635, 0.15),
    P(cyl(0.012, 0.012, 0.52), BONE, 0, 1.43, 0, 0, 0, Math.PI / 2),
    P(ellipsoid(0.18, 0.08, 0.1, 12, 8), BONE, 0, 0.93, 0),
    P(new THREE.SphereGeometry(0.055, 10, 8), '#ff3050', 0.05, 1.27, 0.06),
  ];
  for (let i = 0; i < 10; i++) sk.push(P(new THREE.BoxGeometry(0.06, 0.04, 0.05), BONE, 0, 0.96 + i * 0.057, -0.07));
  for (const [y, r] of [[1.37, 0.16], [1.29, 0.175], [1.21, 0.17], [1.13, 0.15]]) sk.push(P(new THREE.TorusGeometry(r, 0.016, 5, 18, Math.PI * 1.5).rotateX(Math.PI / 2).rotateY(Math.PI / 4), BONE, 0, y, 0, 0, 0, 0, 1, 1, 0.75));
  const skArm = [
    P(new THREE.SphereGeometry(0.04, 8, 6), BONE, 0, 0, 0), P(cyl(0.025, 0.022, 0.27), BONE, 0, -0.14, 0),
    P(new THREE.SphereGeometry(0.033, 8, 6), BONE, 0, -0.29, 0), P(cyl(0.02, 0.018, 0.25), BONE, 0, -0.42, 0),
    P(new THREE.SphereGeometry(0.022, 6, 4), BONE, -0.03, -0.6, 0), P(new THREE.SphereGeometry(0.022, 6, 4), BONE, 0, -0.61, 0), P(new THREE.SphereGeometry(0.022, 6, 4), BONE, 0.03, -0.6, 0),
  ];
  const skLeg = [
    P(new THREE.SphereGeometry(0.045, 8, 6), BONE, 0, 0, 0), P(cyl(0.033, 0.03, 0.4), BONE, 0, -0.2, 0),
    P(new THREE.SphereGeometry(0.045, 8, 6), BONE, 0, -0.41, 0), P(cyl(0.028, 0.024, 0.34), BONE, 0, -0.59, 0),
    P(new THREE.BoxGeometry(0.07, 0.04, 0.16), BONE, 0, -0.79, 0.04),
  ];
  // the alien
  const al = [
    P(ellipsoid(0.21, 0.3, 0.15, 16, 12), GREEN, 0, 1.15, 0),
    P(ellipsoid(0.13, 0.18, 0.09, 12, 8), GREEN2, 0, 1.08, 0.075),
    P(cyl(0.05, 0.05, 0.14), GREEN, 0, 1.48, 0),
    P(ellipsoid(0.16, 0.19, 0.15, 16, 12), GREEN, 0, 1.7, 0),
    P(new THREE.SphereGeometry(0.15, 14, 10), GREEN, 0, 1.8, -0.02),
    P(ellipsoid(0.055, 0.08, 0.035, 10, 8), '#050508', -0.07, 1.7, 0.125, 0, 0, -0.45), P(ellipsoid(0.055, 0.08, 0.035, 10, 8), '#050508', 0.07, 1.7, 0.125, 0, 0, 0.45),
    P(new THREE.SphereGeometry(0.016, 6, 4), '#ffffff', -0.058, 1.73, 0.155), P(new THREE.SphereGeometry(0.016, 6, 4), '#ffffff', 0.082, 1.73, 0.155),
    P(ellipsoid(0.03, 0.01, 0.012, 8, 4), DGREEN, 0, 1.6, 0.135),
    P(cyl(0.012, 0.012, 0.2), GREEN, -0.1, 1.98, 0, 0, 0, 0.45), P(cyl(0.012, 0.012, 0.2), GREEN, 0.1, 1.98, 0, 0, 0, -0.45),
    P(new THREE.SphereGeometry(0.035, 8, 6), '#ff5ad8', -0.145, 2.08, 0), P(new THREE.SphereGeometry(0.035, 8, 6), '#ff5ad8', 0.145, 2.08, 0),
  ];
  for (const [x, y] of [[-0.06, 1.25], [0.07, 1.18], [-0.03, 1.02]]) al.push(P(new THREE.SphereGeometry(0.03, 8, 6), '#f8ff6a', x, y, 0.14));
  const alArm = [P(limb(0.6, 0.06, 0.025, { seg: 8 }), GREEN, 0, 0, 0), P(new THREE.SphereGeometry(0.04, 8, 6), GREEN2, 0, -0.6, 0)];
  const alLeg = [P(limb(0.78, 0.075, 0.05, { seg: 8 }), GREEN, 0, 0, 0), P(ellipsoid(0.08, 0.05, 0.13, 10, 6), DGREEN, 0, -0.8, 0.05)];
  const xe = [];
  for (const sx of [-1, 1]) for (const a of [-1, 1]) xe.push(P(new THREE.BoxGeometry(0.1, 0.022, 0.012), '#ffffff', sx * 0.07, 1.7, 0.165, 0, 0, a * Math.PI / 4));
  shared = {
    skel: keep(mergeGeometries(sk)), skelArm: keep(mergeGeometries(skArm)), skelLeg: keep(mergeGeometries(skLeg)),
    alien: keep(mergeGeometries(al)), alienArm: keep(mergeGeometries(alArm)), alienLeg: keep(mergeGeometries(alLeg)),
    xeyes: keep(mergeGeometries(xe)),
    goo: keep(new THREE.CircleGeometry(0.55, 20).rotateX(-Math.PI / 2).scale(1, 1, 1.5)),
  };
  return shared;
}
export const materials = {
  get skin(){ return toon('people', '#ffffff', { vertexColors: true }); },
  get glow(){ return basic('xray-inner', { vertexColors: true, toneMapped: false }); },
  get goo(){ return toon('goo', '#7aff4a', { emissive: '#1a5a10' }); },
};

// ---------- one person's look ----------
function lookFor(R){
  const pick = (a) => a[Math.floor(R() * a.length)];
  const dress = R() < 0.25;
  return {
    skin: pick(SKIN), shirt: pick(SHIRT), pants: pick(PANTS), hair: pick(HAIR), shoes: pick(['#2a1a10', '#1a1a1a', '#6a3a1a', '#c83a2a', '#ffffff']),
    style: pick(STYLES), hat: R() < 0.22 ? pick(['bowler', 'cap', 'top']) : null, hatCol: pick(['#2a2a2a', '#c83a2a', '#3a5ac8', '#6a4a2a', '#3a8a3a']),
    glasses: R() < 0.22, tash: !dress && R() < 0.18, cheeks: R() < 0.5, dress, wide: 0.9 + R() * 0.35, scale: 0.88 + R() * 0.2,
  };
}
function buildLook(L){
  const P = (g, c, ...a) => paint(placed(g, ...a), c);
  const w = L.wide, body = [];
  body.push(P(ellipsoid(0.27 * w, 0.32, 0.19, 18, 12), L.shirt, 0, 1.18, 0));
  if (L.dress) body.push(P(new THREE.CylinderGeometry(0.2 * w, 0.37 * w, 0.52, 18, 1), L.shirt, 0, 0.83, 0));
  else body.push(P(ellipsoid(0.24 * w, 0.16, 0.17, 16, 10), L.pants, 0, 0.92, 0));
  for (const y of [1.08, 1.2, 1.32]){ const z = 0.19 * Math.sqrt(1 - ((y - 1.18) / 0.32) ** 2) - 0.004; body.push(P(new THREE.SphereGeometry(0.018, 6, 4), L.shirt === '#ffffff' ? '#3a3a4a' : '#ffffff', 0, y, z)); }
  body.push(P(new THREE.CylinderGeometry(0.075, 0.075, 0.14, 10), L.skin, 0, 1.48, 0));
  body.push(P(new THREE.SphereGeometry(0.21, 20, 14), L.skin, 0, 1.66, 0));
  for (const sx of [-1, 1]){
    body.push(P(new THREE.SphereGeometry(0.05, 8, 6), L.skin, sx * 0.205, 1.65, 0, 0, 0, 0, 1, 1, 0.6));
    body.push(P(ellipsoid(0.055, 0.065, 0.03, 10, 8), '#ffffff', sx * 0.075, 1.69, 0.18));
    body.push(P(ellipsoid(0.028, 0.032, 0.012, 8, 6), '#1a1a2a', sx * 0.075, 1.69, 0.205));
    if (L.cheeks) body.push(P(ellipsoid(0.04, 0.025, 0.012, 8, 6), '#ff9a9a', sx * 0.12, 1.6, 0.172));
  }
  body.push(P(new THREE.SphereGeometry(0.04, 8, 6), L.skin, 0, 1.63, 0.215));
  body.push(P(new THREE.TorusGeometry(0.05, 0.012, 6, 12, Math.PI).rotateZ(Math.PI), '#8a2a2a', 0, 1.585, 0.188, -0.25));
  // hair and hats
  const cap = () => P(new THREE.SphereGeometry(0.222, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.46), L.hair, 0, 1.66, -0.005, -0.3);
  if (L.style !== 'bald') body.push(cap());
  if (L.style === 'long') body.push(P(ellipsoid(0.2, 0.24, 0.1, 14, 10), L.hair, 0, 1.52, -0.13));
  if (L.style === 'bun') body.push(P(new THREE.SphereGeometry(0.09, 10, 8), L.hair, 0, 1.9, -0.06));
  if (L.style === 'pony') body.push(P(ellipsoid(0.06, 0.13, 0.06, 8, 6), L.hair, 0, 1.6, -0.25, 0.4));
  if (L.style === 'spiky') for (let i = 0; i < 6; i++){ const a = (i / 6) * Math.PI * 2; body.push(P(new THREE.ConeGeometry(0.05, 0.14, 6), L.hair, Math.cos(a) * 0.1, 1.85, Math.sin(a) * 0.1 - 0.02, Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5)); }
  if (L.style === 'curly') for (let i = 0; i < 8; i++){ const a = (i / 8) * Math.PI * 2; body.push(P(new THREE.SphereGeometry(0.075, 8, 6), L.hair, Math.cos(a) * 0.16, 1.8, Math.sin(a) * 0.16 - 0.03)); }
  if (L.hat === 'bowler'){ body.push(P(new THREE.CylinderGeometry(0.27, 0.27, 0.025, 18), L.hatCol, 0, 1.81, 0)); body.push(P(new THREE.SphereGeometry(0.19, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), L.hatCol, 0, 1.82, 0)); }
  if (L.hat === 'top'){ body.push(P(new THREE.CylinderGeometry(0.27, 0.27, 0.025, 18), L.hatCol, 0, 1.81, 0)); body.push(P(new THREE.CylinderGeometry(0.17, 0.18, 0.3, 16), L.hatCol, 0, 1.97, 0)); }
  if (L.hat === 'cap'){ body.push(P(new THREE.SphereGeometry(0.225, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), L.hatCol, 0, 1.7, 0)); body.push(P(new THREE.BoxGeometry(0.26, 0.02, 0.18), L.hatCol, 0, 1.71, 0.25)); }
  if (L.glasses){
    for (const sx of [-1, 1]) body.push(P(new THREE.TorusGeometry(0.055, 0.011, 6, 14), '#1a1a1a', sx * 0.075, 1.69, 0.218));
    body.push(P(new THREE.BoxGeometry(0.04, 0.012, 0.012), '#1a1a1a', 0, 1.7, 0.222));
  }
  if (L.tash) body.push(P(ellipsoid(0.075, 0.022, 0.025, 10, 6), L.hair, 0, 1.6, 0.2));
  const arm = mergeGeometries([P(limb(0.3, 0.075, 0.068, { seg: 10 }), L.shirt, 0, 0, 0), P(limb(0.28, 0.06, 0.052, { seg: 10 }), L.skin, 0, -0.28, 0), P(new THREE.SphereGeometry(0.072, 10, 8), L.skin, 0, -0.58, 0)]);
  const legParts = L.dress ? [P(limb(0.76, 0.07, 0.055, { seg: 10 }), L.skin, 0, 0, 0)] : [P(limb(0.76, 0.095, 0.075, { seg: 10 }), L.pants, 0, 0, 0)];
  legParts.push(P(ellipsoid(0.085, 0.06, 0.14, 12, 8), L.shoes, 0, -0.8, 0.05));
  return { body: mergeGeometries(body), arm, leg: mergeGeometries(legParts) };
}

// ---------- a person ----------
class Person {
  constructor(id, R, alien, level){
    const S = sharedShapes();
    this.id = id; this.alien = alien; this.name = NAMES[id % NAMES.length];
    this.look = lookFor(R);
    const g = buildLook(this.look);
    this.root = new THREE.Group(); this.root.userData.person = this;
    this.fall = new THREE.Group(); this.root.add(this.fall);
    this.root.scale.setScalar(this.look.scale);
    const skinMat = materials.skin, glow = materials.glow;
    const mesh = (geo, mat, parent, inner) => { const m = new THREE.Mesh(geo, mat); m.castShadow = !inner; if (inner) m.layers.set(INNER); parent.add(m); (inner ? this.inner : this.skin).push(m); return m; };
    this.skin = []; this.inner = [];
    this.body = new THREE.Group(); this.fall.add(this.body);
    mesh(g.body, skinMat, this.body, false);
    mesh(alien ? S.alien : S.skel, glow, this.body, true);
    this.xeyes = new THREE.Mesh(S.xeyes, skinMat); this.xeyes.visible = false; this.body.add(this.xeyes);
    const w = this.look.wide;
    this.arms = [-1, 1].map((sx) => { const p = new THREE.Group(); p.position.set(sx * (0.27 * w + 0.03), 1.36, 0); p.rotation.z = sx * 0.1; this.fall.add(p); mesh(g.arm, skinMat, p, false); mesh(alien ? S.alienArm : S.skelArm, glow, p, true); return p; });
    this.legs = [-1, 1].map((sx) => { const p = new THREE.Group(); p.position.set(sx * 0.11 * Math.min(w, 1.1), 0.86, 0); this.fall.add(p); mesh(g.leg, skinMat, p, false); mesh(alien ? S.alienLeg : S.skelLeg, glow, p, true); return p; });
    this.own = [g.body, g.arm, g.leg];
    this.pos = this.root.position;
    this.yaw = R() * Math.PI * 2; this.root.rotation.y = this.yaw;
    this.state = 'idle'; this.wait = 1 + R() * 5; this.path = []; this.node = -1; this.target = null;
    this.speed = 0; this.phase = R() * 10; this.walkSpeed = 1.1 + R() * 0.4;
    this.runSpeed = Math.min(4.6, 3.0 + 0.25 * level);
    this.revealed = false; this.scanT = 0; this.dead = false; this.zapT = 0; this.fallT = 0; this.flee = false; this.scared = 0;
    this.tag = null; this.lookT = R() * 10;
  }
  showInner(on){
    for (const m of this.inner){ if (on) m.layers.enable(0); else if (!this.dead) m.layers.disable(0); }
    for (const m of this.skin) m.visible = !on && !this.dead;
  }
  get top(){ return 2.0 * this.look.scale; }
}

// ---------- everyone ----------
export class People {
  constructor(scene, town){
    this.town = town; this.list = [];
    this.group = new THREE.Group(); scene.add(this.group);
    this.fx = new THREE.Group(); scene.add(this.fx);
    this.handlers = {};
    this.tagMats = { alien: tagMaterial('👽 ALIEN!', '#e83a3a'), human: tagMaterial('✓ HUMAN', '#2aa84a') };
    // speech bubbles: a few, reused
    this.bubbles = [0, 1, 2, 3].map(() => {
      const tc = textCanvas(512, 160), s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tc.tex, transparent: true, depthTest: true, toneMapped: false }));
      s.scale.set(1.6, 0.5, 1); s.visible = false; this.fx.add(s);
      return { tc, s, who: null, t: 0 };
    });
    this.chatT = 3;
    sharedShapes();
  }
  on(n, f){ (this.handlers[n] = this.handlers[n] || []).push(f); }
  emit(n, x){ for (const f of this.handlers[n] || []) f(x); }

  clear(){
    for (const p of this.list){ this.group.remove(p.root); for (const g of p.own) g.dispose(); }
    this.list = [];
    for (const b of this.bubbles){ b.s.visible = false; b.who = null; }
  }
  // a new town's worth of people: `count` of them, `aliens` of those aliens; nobody starts near `avoid`
  spawn(count, aliens, avoid, level, seed = Date.now()){
    this.clear();
    const R = rng(seed), T = this.town;
    const isAlien = Array.from({ length: count }, (_, i) => i < aliens);
    for (let i = count - 1; i > 0; i--){ const j = Math.floor(R() * (i + 1)); [isAlien[i], isAlien[j]] = [isAlien[j], isAlien[i]]; }
    const used = new Set();
    const far = (n) => !used.has(n.i) && Math.hypot(n.x - avoid.x, n.z - avoid.z) > 14;
    const rooms = T.nodes.filter((n) => n.kind === 'room'), walks = T.nodes.filter((n) => n.kind === 'walk');
    for (let i = 0; i < count; i++){
      const p = new Person(i, R, isAlien[i], level);
      const from = (R() < 0.4 ? rooms : walks).filter(far);
      const n = from.length ? from[Math.floor(R() * from.length)] : walks[Math.floor(R() * walks.length)];
      used.add(n.i);
      p.node = n.i; p.home = n.house >= 0 ? n.house : Math.floor(R() * T.houses.length);
      p.pos.set(n.x + (n.kind === 'walk' ? (R() - 0.5) * 0.8 : 0), T.groundAt(n.x, n.z), n.z);
      this.group.add(p.root); this.list.push(p);
    }
    this.R = R;
  }
  get aliensLeft(){ return this.list.filter((p) => p.alien && !p.dead).length; }

  // ---------- moving about ----------
  goTo(p, dest, speed){
    const path = this.town.path(p.node, dest);
    p.path = path; p.speed = speed; p.target = null;
    p.state = path.length ? 'walk' : 'idle';
    if (!path.length) p.wait = 1 + this.R() * 3;
  }
  wander(p){
    const T = this.town, R = this.R, r = R();
    let dest;
    if (r < 0.3) dest = pickOf(T.houses[p.home].rooms, R);
    else if (r < 0.55){ const shops = T.houses.filter((h) => h.shop); const h = R() < 0.5 ? pickOf(shops, R) : pickOf(T.houses, R); dest = pickOf(h.rooms, R); }
    else dest = pickOf(T.walkNodes, R);
    this.goTo(p, dest, p.walkSpeed);
  }
  // run somewhere far from the player
  runAway(p, from, speed){
    const T = this.town, R = this.R;
    let best = -1, bd = 0;
    for (let i = 0; i < 18; i++){
      const n = T.nodes[Math.floor(R() * T.nodes.length)], d = Math.hypot(n.x - from.x, n.z - from.z);
      if (d > bd){ bd = d; best = n.i; }
    }
    if (best >= 0){ this.goTo(p, best, speed); p.flee = true; }
  }

  update(dt, player){
    const T = this.town;
    for (const p of this.list){
      if (p.dead){ this.updateDead(p, dt); continue; }
      if (p.state === 'zapped'){ this.updateZapped(p, dt, player); continue; }
      const dPlayer = Math.hypot(p.pos.x - player.x, p.pos.z - player.z);
      // a revealed alien runs from you
      if (p.alien && p.revealed && !p.flee && dPlayer < 13) this.runAway(p, player, p.runSpeed);
      if (p.scared > 0) p.scared -= dt;
      let moving = false;
      if (p.state === 'walk'){
        if (!p.target){
          const n = T.nodes[p.path[0]], j = n.kind === 'walk' ? 0.35 : 0;
          p.target = { x: n.x + (this.R() - 0.5) * j * 2, z: n.z + (this.R() - 0.5) * j * 2 };
        }
        const dx = p.target.x - p.pos.x, dz = p.target.z - p.pos.z, d = Math.hypot(dx, dz), step = p.speed * dt;
        if (d <= step + 0.02){
          p.pos.x = p.target.x; p.pos.z = p.target.z; p.node = p.path.shift(); p.target = null;
          if (!p.path.length){ p.state = 'idle'; p.wait = p.flee ? 1 + this.R() * 2 : 2 + this.R() * 7; p.flee = false; }
        } else {
          p.pos.x += dx / d * step; p.pos.z += dz / d * step;
          p.yaw += angleDiff(p.yaw, Math.atan2(dx, dz)) * Math.min(1, dt * 8);
          moving = true;
        }
      } else {
        p.wait -= dt;
        if (p.wait <= 0) this.wander(p);
      }
      p.pos.y = damp(p.pos.y, T.groundAt(p.pos.x, p.pos.z), 12, dt);
      p.root.rotation.y = p.yaw;
      // walking (or standing and looking about)
      const run = p.speed > 2;
      if (moving) p.phase += dt * p.speed * (run ? 3.2 : 5.2);
      const sw = moving ? Math.sin(p.phase) * (run ? 0.9 : 0.55) : 0;
      p.legs[0].rotation.x = damp(p.legs[0].rotation.x, sw, 14, dt); p.legs[1].rotation.x = damp(p.legs[1].rotation.x, -sw, 14, dt);
      p.arms[0].rotation.x = damp(p.arms[0].rotation.x, -sw * 0.8, 14, dt); p.arms[1].rotation.x = damp(p.arms[1].rotation.x, sw * 0.8, 14, dt);
      p.fall.position.y = moving ? Math.abs(Math.sin(p.phase)) * (run ? 0.06 : 0.025) : 0;
      p.fall.rotation.x = moving && run ? 0.18 : 0;
      p.lookT += dt;
      p.body.rotation.y = moving ? 0 : Math.sin(p.lookT * 0.7) * 0.35;
    }
    this.updateBubbles(dt, player);
  }
  updateZapped(p, dt, player){
    p.zapT -= dt;
    p.root.position.x += (Math.random() - 0.5) * 0.04; p.root.position.z += (Math.random() - 0.5) * 0.04;
    p.showInner(Math.floor(p.zapT * 16) % 2 === 0);
    for (const a of p.arms) a.rotation.x = -2.6 + Math.sin(p.zapT * 60) * 0.3;
    for (const l of p.legs) l.rotation.x = Math.sin(p.zapT * 50) * 0.2;
    if (p.zapT > 0) return;
    if (p.alien) this.die(p);
    else {
      p.showInner(false);
      p.state = 'idle'; p.scared = 4;
      this.say(p, pickOf(['Ow! Hey!', 'Ouch! I\'m not an alien!', 'Yikes! What was that for?', 'Bzzzt! Ow!'], this.R), true);
      this.runAway(p, player, 3.0);
      this.emit('hurt', p);
    }
  }
  die(p){
    p.dead = true; p.state = 'dead'; p.fallT = 0;
    for (const m of p.skin) m.visible = false;
    for (const m of p.inner){ m.material = materials.skin; m.layers.enable(0); m.castShadow = true; }
    p.xeyes.visible = true; p.xeyes.layers.enable(INNER);
    if (p.tag) p.tag.visible = false;
    p.goo = new THREE.Mesh(sharedShapes().goo, materials.goo); p.goo.position.set(0, 0.012 / p.look.scale, -0.75); p.goo.scale.setScalar(0.01); p.root.add(p.goo);
    this.emit('killed', p);
  }
  updateDead(p, dt){
    if (p.fallT >= 1) return;
    p.fallT = Math.min(1, p.fallT + dt / 0.75);
    const t = p.fallT, e = t < 0.75 ? (t / 0.75) ** 2 : 1 - Math.sin((t - 0.75) / 0.25 * Math.PI) * 0.08;
    p.fall.rotation.x = -Math.PI / 2 * e; p.fall.position.y = 0.17 * e;
    p.arms[0].rotation.set(-0.3, 0, -1.3 * e); p.arms[1].rotation.set(-0.3, 0, 1.3 * e);
    p.legs[0].rotation.set(0, 0, -0.35 * e); p.legs[1].rotation.set(0, 0, 0.35 * e);
    p.body.rotation.y = 0;
    if (p.goo) p.goo.scale.setScalar(Math.max(0.01, t));
  }

  // ---------- the shock gun ----------
  // the nearest person a ray (from o along unit d) hits before `far`
  rayHit(o, d, far){
    let best = null, bt = far;
    const dl = Math.hypot(d.x, d.z);
    for (const p of this.list){
      if (p.dead) continue;
      const r = 0.36 * p.look.scale * Math.max(1, p.look.wide), wx = o.x - p.pos.x, wz = o.z - p.pos.z;
      let t;
      if (dl < 1e-4) t = (p.pos.y + 1 - o.y) / d.y;
      else t = -(wx * d.x + wz * d.z) / (dl * dl);
      if (t < 0 || t > bt) continue;
      const cx = wx + d.x * t, cz = wz + d.z * t, y = o.y + d.y * t - p.pos.y;
      if (cx * cx + cz * cz > r * r || y < 0 || y > p.top + 0.05) continue;
      bt = t; best = p;
    }
    return best ? { p: best, t: bt } : null;
  }
  zap(p){
    if (p.dead || p.state === 'zapped') return null;
    p.state = 'zapped'; p.zapT = p.alien ? 0.7 : 0.9; p.path = []; p.target = null; p.flee = false;
    if (!p.revealed) this.reveal(p, true);
    this.emit('zapped', p);
    return p.alien ? 'alien' : 'human';
  }

  // ---------- the X-ray tablet ----------
  // everyone the X-ray camera can see (inside rect, in normalised screen coordinates) is scanned; after
  // a moment they are revealed. Returns how far along the furthest scan is, and (focus) the already
  // revealed person nearest the middle of the view.
  scan(dt, cam, rect, range = 32){
    let best = null, seen = 0, focus = null, fd = Infinity;
    const v = V(), cp = cam.getWorldPosition(V()), cx = (rect[0] + rect[2]) / 2, cy = (rect[1] + rect[3]) / 2;
    for (const p of this.list){
      if (p.dead) continue;
      v.set(p.pos.x, p.pos.y + 1.15 * p.look.scale, p.pos.z);
      const dist = v.distanceTo(cp);
      v.project(cam);
      const inView = dist < range && v.z < 1 && v.x > rect[0] && v.x < rect[2] && v.y > rect[1] && v.y < rect[3];
      if (!inView){ p.scanT = Math.max(0, p.scanT - dt * 0.5); continue; }
      seen++;
      if (p.revealed){ const d = Math.hypot(v.x - cx, v.y - cy); if (d < fd){ fd = d; focus = p; } continue; }
      p.scanT += dt;
      if (p.scanT >= 0.7){ this.reveal(p); continue; }
      if (!best || p.scanT > best.scanT) best = p;
    }
    return { progress: best ? clamp(best.scanT / 0.7) : 0, target: best, seen, focus };
  }
  reveal(p, quiet){
    if (p.revealed) return;
    p.revealed = true;
    p.tag = new THREE.Sprite(p.alien ? this.tagMats.alien : this.tagMats.human);
    p.tag.scale.set(0.95 / p.look.scale, 0.3 / p.look.scale, 1); p.tag.position.y = 2.32; p.tag.layers.enable(INNER);
    p.root.add(p.tag);
    if (!quiet){
      this.emit('revealed', p);
      if (p.alien) this.say(p, pickOf(['Uh-oh! Found out!', 'Eek! Run away!', 'Blorp! I mean... bye!', 'You\'ll never catch me!'], this.R), true);
    }
  }

  // ---------- chatter ----------
  say(p, text, force){
    let b = this.bubbles.find((x) => x.who === p) || this.bubbles.find((x) => !x.who);
    if (!b){ if (!force) return; b = this.bubbles.reduce((a, c) => (c.t < a.t ? c : a)); }
    const g = b.tc.ctx; g.clearRect(0, 0, 512, 160);
    g.font = 'bold 40px "Arial Rounded MT Bold", Arial, sans-serif';
    const words = text.split(' '), lines = []; let line = '';
    for (const w of words){ const t = line ? line + ' ' + w : w; if (g.measureText(t).width > 440 && line){ lines.push(line); line = w; } else line = t; }
    lines.push(line);
    g.fillStyle = '#ffffff'; g.strokeStyle = '#2a2a3a'; g.lineWidth = 6;
    roundRect(g, 8, 8, 496, 120, 30); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(230, 125); g.lineTo(256, 154); g.lineTo(280, 125); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#ffffff'; g.fillRect(232, 118, 46, 10);
    g.fillStyle = '#1a1a2a'; g.textAlign = 'center'; g.textBaseline = 'middle';
    lines.slice(0, 2).forEach((l, i) => g.fillText(l, 256, 68 + (i - (Math.min(2, lines.length) - 1) / 2) * 44));
    b.tc.tex.needsUpdate = true;
    b.who = p; b.t = 3.5; b.s.visible = true;
    this.emit('speak', p);
  }
  updateBubbles(dt, player){
    for (const b of this.bubbles){
      if (!b.who) continue;
      b.t -= dt;
      if (b.t <= 0 || !this.list.includes(b.who)){ b.who = null; b.s.visible = false; continue; }
      const p = b.who;
      b.s.position.set(p.pos.x, p.pos.y + p.top + (p.revealed && !p.dead ? 0.85 : 0.5), p.pos.z);
    }
    this.chatT -= dt;
    if (this.chatT > 0) return;
    this.chatT = 3 + this.R() * 4;
    const near = this.list.filter((p) => !p.dead && p.state !== 'zapped' && !p.revealed && Math.hypot(p.pos.x - player.x, p.pos.z - player.z) < 11);
    if (!near.length) return;
    const p = pickOf(near, this.R);
    this.say(p, p.alien && this.R() < 0.55 ? pickOf(ALIEN_LINES, this.R) : pickOf(HUMAN_LINES, this.R));
  }
}
function pickOf(a, R){ return a[Math.floor(R() * a.length)]; }
function tagMaterial(text, col){
  const tc = textCanvas(384, 120), g = tc.ctx;
  g.fillStyle = col; roundRect(g, 6, 6, 372, 108, 34); g.fill();
  g.strokeStyle = '#ffffff'; g.lineWidth = 8; roundRect(g, 6, 6, 372, 108, 34); g.stroke();
  g.fillStyle = '#ffffff'; g.font = 'bold 56px "Arial Rounded MT Bold", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 192, 64);
  tc.tex.needsUpdate = true;
  return new THREE.SpriteMaterial({ map: tc.tex, transparent: true, toneMapped: false });
}
