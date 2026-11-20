// Visitors: people who come in from the plaza, wander round looking at the pictures on the walls, and
// sometimes like one enough to offer to buy it (they wait by it for your answer). A fixed pool of
// people is made once and reused, so nothing is built or thrown away while you play.
import * as THREE from 'three';
import { V, rng, damp, angleDiff, textCanvas, roundRect, wrapText, mergeGeometries, ellipsoid, placed, paint, limb, loft, boxUV } from './util.js';
import { DOOR } from './gallery.js';
import { makePerson } from './people.js';

const NAMES = ['Ava', 'Ben', 'Chloe', 'Dev', 'Ella', 'Finn', 'Grace', 'Hiro', 'Isla', 'Jack', 'Kira', 'Leo', 'Maya', 'Noah', 'Olive', 'Priya', 'Quinn', 'Rosa', 'Sam', 'Tom', 'Uma', 'Vik', 'Wren', 'Yara', 'Zed'];
const SKIN = ['#f3d2b3', '#e0ac7e', '#c68642', '#8d5524', '#f8e0c8', '#a86b42'];
const SHIRT = ['#e04a4a', '#3a7ad8', '#3aa85a', '#e8b83a', '#8a4ad8', '#2ab8b8', '#e86aa8', '#f08a3a', '#444a58'];
const PANTS = ['#2a3448', '#4a3a2a', '#1e1e24', '#5a6a7a', '#7a5a3a'];
const HAIR = ['#2a1a10', '#5a3a1a', '#d8b060', '#a83a1a', '#111111', '#888888'];
const LIKES = ['colourful', 'bold', 'detailed', 'creative'];
export const MAX_VISITORS = 8;
const POOL = 10;   // people made (a few more than can be in at once, so the faces vary)

const mats = new Map();
const mat = (c) => { if (!mats.has(c)){ const m = new THREE.MeshLambertMaterial({ color: c }); m.name = 'v' + c; mats.set(c, m); } return mats.get(c); };
// ---------- what a person looks like ----------
// Each person is a few meshes with vertex colours (one shared material): body, head (so it can turn),
// and upper/lower arms and legs on elbow and knee joints. Built once per person in the pool.
const PEOPLE_MAT = () => mats.get('people') || (mats.set('people', Object.assign(new THREE.MeshLambertMaterial({ vertexColors: true }), { name: 'people' })), mats.get('people'));
const C = (g, col) => paint(g, col);
const tint = (hex, k) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();
function merged(parts){ const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p))); g.userData.keep = true; return g; }
// a body part that tapers down from r0 to r1 (sides squashed a little, front to back)
function seg(len, r0, r1, squash = 0.88){ return limb(len, r0, r1, { seg: 12, squash }); }
function buildPerson(R){
  const pick = (a) => a[Math.floor(R() * a.length)];
  const female = R() < 0.5;
  const skin = pick(SKIN), hair = pick(HAIR), shoes = pick(['#1e1a18', '#3a2a20', '#f0f0ec', '#5a3a2a', '#20242c']);
  const top = pick(SHIRT), bottom = pick(PANTS), dress = female && R() < 0.4;
  const longSleeves = R() < 0.5, jacket = !dress && R() < 0.3, jacketCol = pick(['#2a2a34', '#4a3a2a', '#3a4a5a', '#6a2a2a', '#2a4a3a']);
  const hairStyle = female ? pick(['long', 'long', 'bun', 'pony', 'bob']) : pick(['short', 'short', 'crop', 'bald', 'short']);
  const beard = !female && R() < 0.3;
  const w = female ? 0.92 : 1.0, hip = female ? 1.08 : 0.96;
  const torsoCol = jacket ? jacketCol : dress ? top : top;
  // the body: hips, waist, chest, shoulders (a smooth loft), neck
  const sec = (y, rx, rz) => ({ p: [0, y, 0.00001 * y], rx, ry: rz });
  const body = [];
  const hipsCol = dress ? top : bottom;
  body.push(C(loft([sec(0.84, 0.15 * hip, 0.11), sec(0.92, 0.165 * hip, 0.115), sec(1.02, 0.16 * hip, 0.11)], { ring: 18, steps: 4 }), hipsCol));
  body.push(C(loft([sec(1.0, 0.15 * w * (female ? 0.92 : 1), 0.1), sec(1.08, 0.135 * w * (female ? 0.88 : 1), 0.095), sec(1.2, 0.15 * w, 0.105 * (female ? 1.08 : 1)),
    sec(1.32, 0.175 * w, 0.11), sec(1.42, 0.19 * w, 0.1), sec(1.47, 0.17 * w, 0.085), sec(1.5, 0.08, 0.06)], { ring: 18, steps: 4 }), torsoCol));
  if (jacket){ body.push(C(placed(new THREE.CylinderGeometry(0.055, 0.06, 0.04, 10), 0, 1.5, 0.015), top)); }   // the shirt collar under the jacket
  if (dress){ body.push(C(loft([sec(0.48, 0.24 * hip, 0.2), sec(0.7, 0.2 * hip, 0.16), sec(0.9, 0.165 * hip, 0.12)], { ring: 20, steps: 3, capStart: true, capEnd: false }), top)); }
  body.push(C(placed(new THREE.CylinderGeometry(0.043, 0.05, 0.13, 10), 0, 1.53, -0.005), skin));
  // the head (pivot at the top of the neck)
  const head = [];
  head.push(C(placed(ellipsoid(0.088, 0.112, 0.102, 18, 14), 0, 0.12, 0), skin));
  head.push(C(placed(ellipsoid(0.07, 0.055, 0.078, 14, 10), 0, 0.055, 0.016), skin));                    // jaw
  for (const s of [-1, 1]) head.push(C(placed(ellipsoid(0.016, 0.03, 0.02, 8, 6), s * 0.088, 0.11, -0.005), skin));   // ears
  head.push(C(placed(ellipsoid(0.017, 0.028, 0.022, 8, 6), 0, 0.1, 0.098, -0.25), tint(skin, 0.95)));      // nose
  for (const s of [-1, 1]){
    head.push(C(placed(ellipsoid(0.017, 0.011, 0.008, 10, 6), s * 0.034, 0.128, 0.09), '#f6f4f0'));      // the whites of the eyes
    head.push(C(placed(new THREE.SphereGeometry(0.0075, 8, 6), s * 0.034, 0.128, 0.097), '#2a1a10'));      // irises
    head.push(C(placed(boxUV(0.03, 0.007, 0.01), s * 0.035, 0.148, 0.094, 0, 0, s * -0.12), tint(hair, 0.9)));   // eyebrows
  }
  head.push(C(placed(ellipsoid(0.022, 0.006, 0.006, 10, 4), 0, 0.062, 0.088), female ? '#b8485a' : tint(skin, 0.7)));   // mouth
  // the hair: a cap tilted back, so the hairline sits high on the forehead and low at the back of the neck
  const cap = (sx, sy, sz, y, z, th = 0.55) => placed(new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI * th), 0, y, z, -0.42, 0, 0, sx, sy, sz);
  if (hairStyle !== 'bald') head.push(C(cap(0.097, hairStyle === 'crop' ? 0.1 : 0.11, 0.11, 0.128, -0.006, hairStyle === 'crop' ? 0.45 : 0.55), hair));
  if (hairStyle === 'short' || hairStyle === 'crop') head.push(C(placed(ellipsoid(0.088, 0.07, 0.06, 12, 8), 0, 0.1, -0.05), hair));
  if (hairStyle === 'long') head.push(C(placed(ellipsoid(0.1, 0.17, 0.065, 14, 10), 0, 0.02, -0.06), hair));
  if (hairStyle === 'bob') head.push(C(placed(ellipsoid(0.105, 0.09, 0.1, 14, 10), 0, 0.075, -0.02), hair));
  if (hairStyle === 'bun') head.push(C(placed(new THREE.SphereGeometry(0.045, 12, 8), 0, 0.2, -0.08), hair), C(placed(ellipsoid(0.088, 0.07, 0.06, 12, 8), 0, 0.1, -0.05), hair));
  if (hairStyle === 'pony') head.push(C(placed(ellipsoid(0.035, 0.12, 0.035, 10, 8), 0, 0.03, -0.12, 0.3), hair), C(placed(ellipsoid(0.088, 0.07, 0.06, 12, 8), 0, 0.1, -0.05), hair));
  if (beard) head.push(C(placed(ellipsoid(0.074, 0.05, 0.075, 14, 8), 0, 0.045, 0.024), hair));
  // arms (shoulder at the top) and legs (hip at the top)
  const sleeve = jacket ? jacketCol : top;
  const upperArm = merged([C(seg(0.29, 0.048 * w, 0.04 * w), sleeve), C(placed(new THREE.SphereGeometry(0.05 * w, 10, 8), 0, 0, 0), sleeve)]);
  const fore = [C(seg(0.25, 0.04 * w, 0.032 * w), longSleeves || jacket ? sleeve : skin)];
  fore.push(C(placed(ellipsoid(0.026, 0.048, 0.042, 10, 8), 0, -0.29, 0.005), skin), C(placed(ellipsoid(0.012, 0.028, 0.012, 6, 5), 0.0, -0.27, 0.035, 0.6), skin));
  const foreArm = merged(fore);
  const thigh = merged([C(seg(0.43, 0.078 * hip, 0.056), dress ? skin : bottom)]);
  const shinParts = [C(seg(0.4, 0.054, 0.038), dress ? skin : bottom)];
  shinParts.push(C(placed(ellipsoid(0.046, 0.042, 0.125, 12, 8), 0, -0.415, 0.035), shoes), C(placed(boxUV(0.09, 0.02, 0.24), 0, -0.448, 0.035), tint(shoes, 0.6)));
  const shin = merged(shinParts);
  return { body: merged(body), head: merged(head), upperArm, foreArm, thigh, shin, female, height: 0.92 + R() * 0.16, pose: pick(['behind', 'chin', 'relaxed', 'folded']) };
}

// the soft shadow under a person's feet (one shape and material, shared)
let _bg = null, _bm = null;
function blobGeo(){ if (!_bg){ _bg = new THREE.PlaneGeometry(0.9, 0.9); _bg.userData.keep = true; } return _bg; }
function blobMat(){
  if (_bm) return _bm;
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31); gr.addColorStop(0, 'rgba(0,0,0,0.42)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.18)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  _bm = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  return _bm;
}
export class Visitors {
  // kinds: the realistic people (people.js), or null for the simple built-in ones
  constructor(scene, gallery, kinds = null){
    this.scene = scene; this.gallery = gallery; this.kinds = kinds;
    this.list = [];
    this.handlers = {};
    this.spawnT = 3;
    this.R = rng(Date.now() >>> 0);
    const n = kinds ? kinds.length : POOL;   // every person once
    for (let i = 0; i < n; i++) this.list.push(this.make(i));
  }
  on(ev, fn){ (this.handlers[ev] = this.handlers[ev] || []).push(fn); }
  emit(ev, ...a){ for (const f of this.handlers[ev] || []) f(...a); }

  make(i){
    if (this.kinds) return this.makeReal(i);
    const R = this.R, P = buildPerson(rng((Date.now() + i * 7919) >>> 0)), M = PEOPLE_MAT();
    const root = new THREE.Group(); root.visible = false;
    const v = { id: i, root, active: false, name: '', state: 'away', pos: V(0, 0, 30), yaw: 0, path: [], wait: 0, visits: [], phase: 0, speed: 1.0 + R() * 0.3, bubbleT: 0, offer: null, like: 'colourful', seen: 0, pose: P.pose, blend: 0, look: 0 };
    const mesh = (g, parent = root) => { const m = new THREE.Mesh(g, M); m.castShadow = true; parent.add(m); return m; };
    v.body = mesh(P.body);
    v.head = new THREE.Group(); v.head.position.set(0, 1.565, 0.005); root.add(v.head); mesh(P.head, v.head);
    v.legs = [-1, 1].map((s) => { const hip = new THREE.Group(); hip.position.set(s * 0.09, 0.9, 0); root.add(hip); mesh(P.thigh, hip); const knee = new THREE.Group(); knee.position.y = -0.43; hip.add(knee); mesh(P.shin, knee); return { hip, knee }; });
    v.arms = [-1, 1].map((s) => { const sh = new THREE.Group(); sh.position.set(s * 0.2 * (P.female ? 0.92 : 1), 1.44, -0.005); sh.rotation.z = s * 0.07; root.add(sh); mesh(P.upperArm, sh); const el = new THREE.Group(); el.position.y = -0.29; sh.add(el); mesh(P.foreArm, el); return { sh, el, s }; });
    // a speech bubble over the head (its canvas is redrawn, never remade)
    v.bubble = textCanvas(256, 128);
    v.bubbleSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: v.bubble.tex, depthTest: true, transparent: true }));
    v.bubbleSprite.scale.set(0.8, 0.4, 1); v.bubbleSprite.position.y = 2.1; v.bubbleSprite.visible = false; root.add(v.bubbleSprite);
    // something to point at
    v.pick = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.8, 0.45), new THREE.MeshBasicMaterial({ visible: false })); v.pick.position.y = 0.9; v.pick.userData = { kind: 'visitor', v }; root.add(v.pick);
    v.scale = P.height; root.scale.setScalar(v.scale);
    this.scene.add(root);
    return v;
  }
  // a realistic person: a copy of one of the models in one of its outfits, a soft shadow under the feet
  makeReal(i){
    const R = this.R, kinds = this.kinds;
    // alternate men and women, each in a different outfit
    const men = kinds.filter((k) => !k.female), women = kinds.filter((k) => k.female);
    const kind = i % 2 ? women[Math.floor(i / 2) % women.length] : men[Math.floor(i / 2) % men.length];
    const root = new THREE.Group(); root.visible = false;
    const P = makePerson(kind, kind.height * (0.95 + R() * 0.08));
    root.add(P.model);
    const v = { id: i, root, active: false, name: '', state: 'away', pos: V(0, 0, 30), yaw: 0, path: [], wait: 0, visits: [], phase: 0, speed: 1.05 + R() * 0.25, bubbleT: 0, offer: null, like: 'colourful', seen: 0, blend: 1, look: 0, real: P, female: kind.female };
    // a soft dark patch on the floor under them (grounds them, where the sun's shadow doesn't reach)
    const blob = new THREE.Mesh(blobGeo(), blobMat()); blob.rotation.x = -Math.PI / 2; blob.position.y = 0.012; blob.renderOrder = 1; root.add(blob);
    v.bubble = textCanvas(256, 128);
    v.bubbleSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: v.bubble.tex, depthTest: true, transparent: true }));
    v.bubbleSprite.scale.set(0.8, 0.4, 1); v.bubbleSprite.position.y = 2.1; v.bubbleSprite.visible = false; root.add(v.bubbleSprite);
    v.pick = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.8, 0.45), new THREE.MeshBasicMaterial({ visible: false })); v.pick.position.y = 0.9; v.pick.userData = { kind: 'visitor', v }; root.add(v.pick);
    this.scene.add(root);
    return v;
  }
  // a gesture: a nod (agree) or a shake of the head, played once over the walk or idle
  gesture(v, name){
    const P = v.real; if (!P || !P.act[name]) return;
    const a = P.act[name]; a.reset(); a.setEffectiveWeight(1); a.fadeIn(0.25); a.play(); P.gesture = a;
  }
  get active(){ return this.list.filter((v) => v.active); }

  // someone new comes in from the plaza
  spawn(){
    const v = this.list.find((q) => !q.active);
    const hung = this.gallery.slots.filter((s) => s.art && this.gallery.slotOpen(s));
    if (!v || !hung.length) return null;
    const R = this.R;
    v.active = true; v.root.visible = true;
    v.name = NAMES[Math.floor(R() * NAMES.length)];
    v.like = LIKES[Math.floor(R() * LIKES.length)];
    v.budget = 0.85 + R() * 0.7;
    v.pos.set(DOOR.x + (R() - 0.5) * 3, 0, 16 + R() * 3);
    v.visits = [...hung].sort(() => R() - 0.5).slice(0, 2 + Math.floor(R() * 3));
    v.offer = null; v.seen = 0; v.bubbleSprite.visible = false;
    this.next(v);
    return v;
  }
  next(v){
    const s = v.visits.shift();
    if (s && s.art){ v.target = s; this.walkTo(v, s.view.clone().add(V((this.R() - 0.5) * 1.2, 0, 0).applyAxisAngle(V(0, 1, 0), s.ry))); v.state = 'walk'; return; }
    if (s) return this.next(v);
    v.target = null; v.state = 'leave';
    this.walkTo(v, V(DOOR.x + (this.R() - 0.5) * 4, 0, 18 + this.R() * 3));
  }
  walkTo(v, p){ v.path = this.gallery.route(v.pos, p); }
  leave(v){ v.visits = []; v.offer = null; this.next(v); }
  send(v){ v.active = false; v.root.visible = false; v.state = 'away'; v.offer = null; v.target = null; }

  // what a visitor thinks of a picture, from its stars and what they like
  opinion(v, art){
    const st = art.stars || { colour: 1, bold: 1, detail: 1, creative: 0 };
    const key = { colourful: 'colour', bold: 'bold', detailed: 'detail', creative: 'creative' }[v.like];
    const total = st.colour + st.bold + st.detail + st.creative;
    return Math.min(1, 0.15 + total / 14 + st[key] * 0.1 + (art.kind === 'market' ? 0.1 : 0));
  }
  say(v, text, t = 3.5){
    const g = v.bubble.ctx; g.clearRect(0, 0, 256, 128);
    g.fillStyle = 'rgba(255,255,255,0.96)'; roundRect(g, 4, 4, 248, 98, 26); g.fill();
    g.beginPath(); g.moveTo(110, 100); g.lineTo(128, 124); g.lineTo(146, 100); g.fill();
    g.strokeStyle = '#3a2a6a'; g.lineWidth = 4; roundRect(g, 4, 4, 248, 98, 26); g.stroke();
    g.fillStyle = '#222'; g.textAlign = 'center'; g.textBaseline = 'middle';
    let fs = 40; g.font = `bold ${fs}px Arial`;
    let lines = wrapText(g, text, 230);
    while ((lines.length > 2 || lines.some((l) => g.measureText(l).width > 236)) && fs > 18){ fs -= 3; g.font = `bold ${fs}px Arial`; lines = wrapText(g, text, 230); }
    lines.slice(0, 2).forEach((l, i, a) => g.fillText(l, 128, 54 + (i - (a.length - 1) / 2) * fs * 1.05));
    v.bubble.tex.needsUpdate = true;
    v.bubbleSprite.visible = true; v.bubbleT = t;
  }

  update(dt, ctx){
    this.time = (this.time || 0) + dt;
    // ctx: { fame, appeal, player, onlyOffers }
    const hung = this.gallery.slots.filter((s) => s.art && this.gallery.slotOpen(s)).length;
    const want = Math.min(MAX_VISITORS, hung ? 1 + Math.floor(hung / 2) + Math.floor(ctx.appeal / 3) : 0);
    this.spawnT -= dt;
    if (this.spawnT <= 0){ this.spawnT = Math.max(4, 16 - ctx.appeal * 0.8) * (0.6 + this.R() * 0.8); if (this.active.length < want) this.spawn(); }
    for (const v of this.list){
      if (!v.active) continue;
      v.bubbleT -= dt; if (v.bubbleT <= 0 && !v.offer) v.bubbleSprite.visible = false;
      let moving = false;
      if (v.state === 'walk' || v.state === 'leave'){
        const t = v.path[0];
        if (!t){
          if (v.state === 'leave'){ this.send(v); continue; }
          // arrived: look at the picture
          if (!v.target || !v.target.art){ this.next(v); continue; }
          v.state = 'look'; v.wait = 4 + this.R() * 4; v.lookArt = v.target.art;
          continue;
        }
        const dx = t.x - v.pos.x, dz = t.z - v.pos.z, d = Math.hypot(dx, dz);
        if (d < 0.25){ v.path.shift(); continue; }
        const step = Math.min(d, v.speed * dt);
        v.pos.x += dx / d * step; v.pos.z += dz / d * step;
        // keep out of each other's way, and the player's
        for (const q of this.list){ if (q === v || !q.active) continue; const ex = v.pos.x - q.pos.x, ez = v.pos.z - q.pos.z, e = Math.hypot(ex, ez); if (e < 0.55 && e > 1e-4){ v.pos.x += ex / e * (0.55 - e) * 0.5; v.pos.z += ez / e * (0.55 - e) * 0.5; } }
        if (ctx.player){ const ex = v.pos.x - ctx.player.x, ez = v.pos.z - ctx.player.z, e = Math.hypot(ex, ez); if (e < 0.6 && e > 1e-4){ v.pos.x += ex / e * (0.6 - e) * 0.6; v.pos.z += ez / e * (0.6 - e) * 0.6; } }
        this.gallery.collide(v.pos, 0.28, true);
        v.yaw += angleDiff(v.yaw, Math.atan2(dx, dz)) * Math.min(1, dt * 8);
        moving = true;
      } else if (v.state === 'look'){
        const s = v.target;
        if (!s || s.art !== v.lookArt){ this.next(v); continue; }   // the picture was taken down or sold
        v.yaw += angleDiff(v.yaw, s.ry + Math.PI) * Math.min(1, dt * 5);
        v.wait -= dt;
        if (v.wait <= 0){
          const art = s.art, op = this.opinion(v, art);
          v.seen++;
          this.emit('viewed', v, art, op);
          if (art.forSale !== false && this.R() < op * 0.75){
            const price = Math.round(art.value * (0.8 + op * 0.55) * v.budget * (1 + ctx.fame * 0.015) / 5) * 5;
            v.offer = { price, slot: s, art, t: 45 };
            v.state = 'offer';
            this.say(v, `💰 I'd pay $${price}!`, 99);
            this.emit('offer', v); this.gesture(v, 'agree');
          } else {
            this.say(v, op > 0.7 ? '😍 Love it!' : op > 0.45 ? '🙂 Nice!' : '🤔 Hmm…');
            this.gesture(v, op > 0.45 ? 'agree' : 'headShake');
            this.next(v);
          }
        }
      } else if (v.state === 'offer'){
        const o = v.offer;
        if (!o || !o.slot.art || o.slot.art !== o.art){ v.offer = null; this.next(v); continue; }
        v.yaw += angleDiff(v.yaw, o.slot.ry + Math.PI) * Math.min(1, dt * 5);
        o.t -= dt;
        if (o.t <= 0){ this.emit('gaveUp', v); v.offer = null; this.say(v, '😕 Oh well…'); this.next(v); }
      }
      this.animate(v, dt, moving);
      v.root.rotation.y = v.yaw;
    }
  }
  // the body: a walk (knees bend as each leg swings through, arms swing opposite), or a pose while
  // looking at a picture (hands behind the back, a hand on the chin, arms folded), blended smoothly
  animate(v, dt, moving){
    if (v.real){
      const P = v.real, t = this.time || 0;
      v.blend = damp(v.blend, moving ? 0 : 1, 6, dt);
      const g = P.gesture && P.gesture.isRunning() ? Math.min(1, (P.gesture.getClip().duration - P.gesture.time) * 3, P.gesture.time * 4) : 0;
      if (P.gesture && !P.gesture.isRunning()){ P.gesture.stop(); P.gesture = null; }
      P.act.walk.setEffectiveWeight((1 - v.blend) * (1 - g));
      P.act.idle.setEffectiveWeight(v.blend * (1 - g) + 1e-3);
      P.act.walk.timeScale = v.speed / 1.2;   // the walk's steps match how fast they go
      P.mixer.update(dt);
      void t;
      v.root.position.set(v.pos.x, this.gallery.where(v.pos.x, v.pos.z) === 'plaza' ? -0.02 : 0, v.pos.z);
      return;
    }
    v.phase = moving ? v.phase + dt * v.speed * 5.6 : v.phase;
    v.blend = damp(v.blend, moving ? 0 : 1, 5, dt);
    const ph = v.phase, k = 1 - v.blend, still = v.blend, t = this.time || 0;
    for (const [n, L] of v.legs.entries()){
      const p = ph + n * Math.PI;
      const shift = Math.sin(t * 0.7 + v.id) * 0.04 * (n ? 1 : -1);   // shifting weight while standing
      L.hip.rotation.x = -Math.sin(p) * 0.5 * k + shift * still;
      L.knee.rotation.x = (0.05 + Math.max(0, Math.cos(p)) * 0.95) * k + (0.04 + Math.max(0, shift) * 1.5) * still;
    }
    const looking = v.state === 'look' || v.state === 'offer';
    const pose = looking ? v.pose : 'relaxed';
    for (const A of v.arms){
      const p = ph + (A.s < 0 ? 0 : Math.PI);
      const walkSh = Math.sin(p) * 0.42, walkEl = -0.25 - Math.max(0, -Math.sin(p)) * 0.35;
      let sh = 0.02, el = -0.12, sz = A.s * 0.07, sy = 0;
      if (pose === 'behind'){ sh = 0.42; el = -1.15; sz = A.s * 0.16; sy = A.s * 0.5; }
      else if (pose === 'folded'){ sh = -0.35; el = -1.75; sz = A.s * 0.05; sy = -A.s * 0.9; }
      else if (pose === 'chin'){ if (A.s > 0){ sh = -0.7; el = -2.35; sz = A.s * 0.12; sy = -A.s * 0.45; } else { sh = -0.25; el = -1.6; sy = A.s * -0.8; } }
      A.sh.rotation.x = walkSh * k + sh * still; A.el.rotation.x = walkEl * k + el * still;
      A.sh.rotation.z = A.s * 0.07 * k + sz * still; A.sh.rotation.y = sy * still;
    }
    // the head: looks up at a picture, round at you now and then, a slight sway
    v.look = damp(v.look, looking ? -0.1 : 0.02, 3, dt);
    v.head.rotation.x = v.look + Math.sin(t * 0.9 + v.id) * 0.02;
    v.head.rotation.y = Math.sin(t * 0.37 + v.id * 2) * (looking ? 0.18 : 0.08);
    v.head.rotation.z = (looking ? Math.sin(t * 0.5 + v.id) * 0.06 : 0);
    v.body.rotation.y = Math.sin(ph) * 0.05 * k;
    const bob = moving ? Math.abs(Math.cos(ph)) * 0.025 - 0.012 : -0.004;
    v.root.position.set(v.pos.x, bob + (this.gallery.where(v.pos.x, v.pos.z) === 'plaza' ? -0.02 : 0), v.pos.z);
  }
  // you answered an offer
  accept(v){ const o = v.offer; if (!o) return null; v.offer = null; this.say(v, '🎉 Thank you!'); this.gesture(v, 'agree'); v.carry = o.art; this.leave(v); return o; }
  decline(v){ if (!v.offer) return; v.offer = null; this.say(v, '😕 Maybe next time'); this.gesture(v, 'headShake'); this.next(v); }
  // a word from them about what they're looking at (from their panel)
  chat(v){
    const art = (v.offer && v.offer.art) || (v.target && v.target.art);
    if (!art){ this.say(v, 'Lovely gallery!'); return 'Lovely gallery!'; }
    const st = art.stars || {}, op = this.opinion(v, art);
    const bits = { colourful: st.colour >= 2 ? 'Such colours!' : 'I wish it had more colour.', bold: st.bold >= 2 ? 'So bold and punchy!' : 'A bit flat for me.', detailed: st.detail >= 2 ? 'Look at all that detail!' : 'I like more detail.', creative: st.creative >= 2 ? 'So creative!' : 'Try some more editing!' };
    const t = `${op > 0.6 ? '😍' : '🙂'} ${bits[v.like]}`;
    this.say(v, t, 4);
    return t;
  }
}
