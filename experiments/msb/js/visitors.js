// Visitors: people who come in from the plaza, wander round looking at the pictures on the walls, and
// sometimes like one enough to offer to buy it (they wait by it for your answer). A fixed pool of
// people is made once and reused, so nothing is built or thrown away while you play.
import * as THREE from 'three';
import { V, rng, damp, angleDiff, textCanvas, roundRect, wrapText, mergeGeometries, ellipsoid, placed, paint, limb } from './util.js';
import { DOOR } from './gallery.js';

const NAMES = ['Ava', 'Ben', 'Chloe', 'Dev', 'Ella', 'Finn', 'Grace', 'Hiro', 'Isla', 'Jack', 'Kira', 'Leo', 'Maya', 'Noah', 'Olive', 'Priya', 'Quinn', 'Rosa', 'Sam', 'Tom', 'Uma', 'Vik', 'Wren', 'Yara', 'Zed'];
const SKIN = ['#f3d2b3', '#e0ac7e', '#c68642', '#8d5524', '#f8e0c8', '#a86b42'];
const SHIRT = ['#e04a4a', '#3a7ad8', '#3aa85a', '#e8b83a', '#8a4ad8', '#2ab8b8', '#e86aa8', '#f08a3a', '#444a58'];
const PANTS = ['#2a3448', '#4a3a2a', '#1e1e24', '#5a6a7a', '#7a5a3a'];
const HAIR = ['#2a1a10', '#5a3a1a', '#d8b060', '#a83a1a', '#111111', '#888888'];
const LIKES = ['colourful', 'bold', 'detailed', 'creative'];
export const MAX_VISITORS = 8;

const mats = new Map();
const mat = (c) => { if (!mats.has(c)){ const m = new THREE.MeshLambertMaterial({ color: c }); m.name = 'v' + c; mats.set(c, m); } return mats.get(c); };
let geo = null;
function shapes(){
  if (geo) return geo;
  geo = {
    leg: limb(0.82, 0.075, 0.06).translate(0, 0, 0),
    shoe: placed(ellipsoid(0.07, 0.05, 0.13, 10, 6), 0, -0.84, 0.04),
    body: mergeGeometries([placed(ellipsoid(0.21, 0.36, 0.15, 14, 10), 0, 1.22, 0), placed(new THREE.CylinderGeometry(0.2, 0.19, 0.2, 14), 0, 0.95, 0)]),
    arm: limb(0.62, 0.055, 0.045),
    hand: placed(ellipsoid(0.05, 0.06, 0.045, 8, 6), 0, -0.64, 0),
    head: mergeGeometries([placed(ellipsoid(0.13, 0.155, 0.14, 16, 12), 0, 1.74, 0), placed(new THREE.CylinderGeometry(0.05, 0.06, 0.12, 8), 0, 1.58, 0)]),
    nose: placed(ellipsoid(0.025, 0.03, 0.03, 8, 6), 0, 1.72, 0.14),
    eye: new THREE.SphereGeometry(0.018, 8, 6),
    hair: placed(new THREE.SphereGeometry(0.145, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), 0, 1.76, -0.01),
    bun: placed(new THREE.SphereGeometry(0.07, 10, 8), 0, 1.86, -0.11),
  };
  for (const g of Object.values(geo)) g.userData.keep = true;
  return geo;
}

export class Visitors {
  constructor(scene, gallery){
    this.scene = scene; this.gallery = gallery;
    this.list = [];
    this.handlers = {};
    this.spawnT = 3;
    this.R = rng(Date.now() >>> 0);
    for (let i = 0; i < MAX_VISITORS; i++) this.list.push(this.make(i));
  }
  on(ev, fn){ (this.handlers[ev] = this.handlers[ev] || []).push(fn); }
  emit(ev, ...a){ for (const f of this.handlers[ev] || []) f(...a); }

  make(i){
    const G = shapes(), R = this.R, pick = (a) => a[Math.floor(R() * a.length)];
    const root = new THREE.Group(); root.visible = false;
    const v = { id: i, root, active: false, name: '', state: 'away', pos: V(0, 0, 30), yaw: 0, path: [], wait: 0, visits: [], phase: 0, speed: 1.1, bubbleT: 0, offer: null, like: 'colourful', seen: 0 };
    const skin = mat(pick(SKIN)), shirt = mat(pick(SHIRT)), pants = mat(pick(PANTS)), hair = mat(pick(HAIR)), dark = mat('#1a1a1a');
    const add = (g, m, parent = root) => { const mesh = new THREE.Mesh(g, m); mesh.castShadow = true; parent.add(mesh); return mesh; };
    v.legs = [-1, 1].map((s) => { const p = new THREE.Group(); p.position.set(s * 0.1, 0.86, 0); root.add(p); add(G.leg, pants, p); add(G.shoe, dark, p); return p; });
    add(G.body, shirt);
    v.arms = [-1, 1].map((s) => { const p = new THREE.Group(); p.position.set(s * 0.25, 1.46, 0); p.rotation.z = s * 0.12; root.add(p); add(G.arm, shirt, p); add(G.hand, skin, p); return p; });
    add(G.head, skin); add(G.nose, skin); add(G.hair, hair);
    if (R() < 0.4) add(G.bun, hair);
    for (const s of [-1, 1]){ const e = add(G.eye, dark); e.position.set(s * 0.05, 1.77, 0.125); e.castShadow = false; }
    // a speech bubble over the head (its canvas is redrawn, never remade)
    v.bubble = textCanvas(256, 128);
    v.bubbleSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: v.bubble.tex, depthTest: true, transparent: true }));
    v.bubbleSprite.scale.set(0.8, 0.4, 1); v.bubbleSprite.position.y = 2.25; v.bubbleSprite.visible = false; root.add(v.bubbleSprite);
    // something to point at
    v.pick = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.9, 0.5), new THREE.MeshBasicMaterial({ visible: false })); v.pick.position.y = 0.95; v.pick.userData = { kind: 'visitor', v }; root.add(v.pick);
    v.scale = 0.9 + R() * 0.2; root.scale.setScalar(v.scale);
    this.scene.add(root);
    return v;
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
            this.emit('offer', v);
          } else {
            this.say(v, op > 0.7 ? '😍 Love it!' : op > 0.45 ? '🙂 Nice!' : '🤔 Hmm…');
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
      // walking: swing the legs and arms
      v.phase = moving ? v.phase + dt * v.speed * 6.5 : damp(v.phase, Math.round(v.phase / Math.PI) * Math.PI, 8, dt);
      const sw = Math.sin(v.phase) * 0.45;
      v.legs[0].rotation.x = sw; v.legs[1].rotation.x = -sw;
      v.arms[0].rotation.x = -sw * 0.8; v.arms[1].rotation.x = sw * 0.8;
      v.root.position.set(v.pos.x, Math.abs(Math.cos(v.phase)) * 0.03 * (moving ? 1 : 0) + (this.gallery.where(v.pos.x, v.pos.z) === 'plaza' ? -0.02 : 0), v.pos.z);
      v.root.rotation.y = v.yaw;
    }
  }
  // you answered an offer
  accept(v){ const o = v.offer; if (!o) return null; v.offer = null; this.say(v, '🎉 Thank you!'); v.carry = o.art; this.leave(v); return o; }
  decline(v){ if (!v.offer) return; v.offer = null; this.say(v, '😕 Maybe next time'); this.next(v); }
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
