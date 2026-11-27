// The glue gun's strings. The first shot sticks one end of a string to whatever it hits (the string
// pays out back to the gun); the second shot carries the other end to whatever IT hits. Then the
// glue sets: the string shrinks, hard. Whatever is stuck to it gets pulled toward the other end,
// lifted off its feet if that end is above it, and when it can't come any closer the pull keeps
// rising until something gives: an alien's arm, leg, head, tail, jaw, or the alien itself in half.
//
// An end is { kind: 'world' | 'block' | 'alien' | 'debris', p (world), block, owner, bone, local }.
import * as THREE from 'three';
import { V, clamp } from './util.js';
import { strengthOf, tearBoneFor, BONE } from './alien.js';

export const MAX_STRINGS = 10;
const K = 900, C = 160, TMAX = 6500, SHRINK = 3.2, MIN_REST = -3.5, TOUCH = 0.32, SEGS = 14, SPEED = 75;
const _a = V(), _b = V(), _d = V(), _p = V(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = V(), _z = V(0, 0, 1), _v = V();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export function endPos(e, out){
  if (e.kind === 'world') return out.copy(e.p);
  if (e.kind === 'block') return out.copy(e.local).add(e.block.pos);
  return out.copy(e.local).applyMatrix4(e.bone.matrixWorld);
}
const velOf = (e) => (e.owner ? e.owner.vel : e.kind === 'block' ? e.block.vel : null);
// make an end from a hit (see main.js pick())
export function makeEnd(hit){
  const p = hit.point.clone();
  if (hit.alien || hit.debris){ const owner = hit.alien || hit.debris; owner.root ? owner.root.updateMatrixWorld(true) : owner.group.updateMatrixWorld(true);
    return { kind: hit.alien ? 'alien' : 'debris', owner, bone: hit.bone, name: hit.name, local: hit.bone.worldToLocal(p.clone()) }; }
  if (hit.block) return { kind: 'block', block: hit.block, local: p.sub(hit.block.pos) };
  return { kind: 'world', p };
}

export class Glue {
  constructor(scene){
    this.scene = scene;
    this.strings = [];          // { a, b, rest, T, age, len }
    this.pending = null;        // { end, gun } the first end, its string running back to `gun`
    this.flying = [];           // globs on their way: { from, end (or null: a miss), dir, t, dur, second }
    this.events = [];
    const mat = new THREE.MeshStandardMaterial({ color: '#ffd23a', emissive: '#ffae00', emissiveIntensity: 0.9, roughness: 0.25, metalness: 0 });
    this.mat = mat;
    const seg = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2);
    const max = (MAX_STRINGS + 2) * SEGS;
    this.segMesh = new THREE.InstancedMesh(seg, mat, max); this.segMesh.frustumCulled = false; this.segMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.blobMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), mat, MAX_STRINGS * 2 + 6); this.blobMesh.frustumCulled = false;
    this.segMesh.castShadow = false;
    scene.add(this.segMesh, this.blobMesh);
    this.pts = Array.from({ length: SEGS + 1 }, () => V());
  }
  get count(){ return this.strings.length; }
  // fire a glob from `from` along `dir`; `hit` is what it will stick to (or null: it misses)
  fire(from, dir, hit, gun){
    if (this.flying.length) return false;
    const second = !!this.pending;
    const end = hit ? makeEnd(hit) : null;
    const dist = hit ? hit.point.distanceTo(from) : 60;
    this.flying.push({ from: from.clone(), dir: dir.clone(), end, t: 0, dur: Math.max(0.04, dist / SPEED), dist, second, gun, miss: !hit, point: hit ? hit.point.clone() : from.clone().addScaledVector(dir, 60) });
    return true;
  }
  cutAll(){
    const n = this.strings.length + (this.pending ? 1 : 0);
    for (const s of this.strings) this.events.push(['snap', s]);
    this.strings.length = 0; this.pending = null; this.flying.length = 0;
    return n;
  }
  // an alien lost a part: every end on that part now belongs to the torn-off piece
  moveEnds(alien, debris){
    const fix = (e) => { if (e && e.owner === alien && debris.alive[BONE[e.bone.name]]){ e.owner = debris; e.kind = 'debris'; e.bone = debris.bones[BONE[e.bone.name]]; } };
    for (const s of this.strings){ fix(s.a); fix(s.b); }
    if (this.pending) fix(this.pending.end);
    for (const f of this.flying) fix(f.end);
  }
  // forget ends on things that have gone (a corpse sunk away, debris cleaned up)
  dropOwner(owner){
    this.strings = this.strings.filter((s) => s.a.owner !== owner && s.b.owner !== owner);
    if (this.pending && this.pending.end.owner === owner) this.pending = null;
    for (const f of this.flying) if (f.end && f.end.owner === owner){ f.end = null; f.miss = true; }
  }
  addString(a, b){
    // keep at most MAX_STRINGS: let the oldest go (preferring ones that hold nothing alive)
    while (this.strings.length >= MAX_STRINGS){
      let k = this.strings.findIndex((s) => !(s.a.owner && s.a.kind === 'alien' && !s.a.owner.dead) && !(s.b.owner && s.b.kind === 'alien' && !s.b.owner.dead));
      if (k < 0) k = 0;
      this.events.push(['snap', this.strings[k]]); this.strings.splice(k, 1);
    }
    const len = endPos(a, _a).distanceTo(endPos(b, _b));
    const s = { a, b, rest: len, T: 0, age: 0, len, id: Math.random() };
    this.strings.push(s);
    return s;
  }

  // ---------- the physics: every string pulls on what it holds ----------
  step(dt, muzzleOf){
    this.events.length = 0;
    // globs in flight
    for (let i = this.flying.length - 1; i >= 0; i--){
      const f = this.flying[i];
      f.t += dt / f.dur;
      if (f.t < 1) continue;
      this.flying.splice(i, 1);
      if (f.miss || !f.end){ this.events.push(['miss', f]); continue; }
      endPos(f.end, _a);
      this.events.push(['stick', f, _a.clone()]);
      if (!f.second) this.pending = { end: f.end, gun: f.gun };
      else if (this.pending){
        const s = this.addString(this.pending.end, f.end);
        this.pending = null;
        this.events.push(['tie', s]);
      }
    }
    // strings
    for (let i = this.strings.length - 1; i >= 0; i--){
      const s = this.strings[i];
      s.age += dt;
      endPos(s.a, _a); endPos(s.b, _b);
      _d.subVectors(_b, _a); const len = _d.length();
      if (len > 1e-5) _d.divideScalar(len); else _d.set(0, 1, 0);
      const dl = (len - s.len) / Math.max(dt, 1e-4); s.len = len;
      s.rest = Math.max(MIN_REST, s.rest - SHRINK * dt);
      const stretch = len - s.rest;
      let T = 0;
      if (stretch > 0){
        const va = velOf(s.a), vb = velOf(s.b);
        let vrel = 0; if (va || vb){ _v.set(0, 0, 0); if (vb) _v.add(vb); if (va) _v.sub(va); vrel = _v.dot(_d); } else vrel = dl;
        T = clamp(K * stretch + C * vrel, 0, TMAX);
      }
      s.T = T;
      // pull both ends toward each other
      for (const [e, sign] of [[s.a, 1], [s.b, -1]]){
        const o = e.owner; if (!o) continue;
        o.force.addScaledVector(_d, T * sign);
        o.pull.addScaledVector(_d, T * sign);
        if (T > o.tension) o.tension = T;
        if (o.stuckBones){ o.stuckBones.push({ name: e.bone.name, bone: e.bone, local: e.local, dir: _d.clone().multiplyScalar(sign), t: T }); }
        else if (!o.stuck || T >= (o.stuckT || 0)){ o.stuck = { bone: e.bone, local: e.local }; o.stuckT = T; }
      }
      // the two ends meet: they can't pass through each other (or through a block)
      if (len < TOUCH && (s.a.owner || s.b.owner) && s.a.owner !== s.b.owner){
        const ma = s.a.owner ? s.a.owner.mass : Infinity, mb = s.b.owner ? s.b.owner.mass : Infinity;
        const push = TOUCH - len, wa = ma === Infinity ? 0 : mb === Infinity ? 1 : mb / (ma + mb), wb = 1 - wa;
        const fix = (o, w, sgn) => {
          if (!o || !w) return;
          const c = o.com; c.addScaledVector(_d, -sgn * push * w);
          const vn = o.vel.dot(_d) * sgn; if (vn > 0) o.vel.addScaledVector(_d, -vn * sgn);
        };
        fix(s.a.owner, wa, 1); fix(s.b.owner, wb, -1);
      }
      // too hard a pull: the weaker part rips off
      let worst = null, ratio = 1;
      for (const e of [s.a, s.b]){
        if (e.kind !== 'alien' || !e.owner) continue;
        const r = T / strengthOf(e.bone.name);
        if (r > ratio){ ratio = r; worst = e; }
      }
      if (worst){
        const alien = worst.owner;
        const name = worst.bone.name;
        const pullDir = (worst === s.a ? _d.clone() : _d.clone().negate());
        const deb = alien.tear(tearBoneFor(name), pullDir.multiplyScalar(4));
        if (deb){
          this.moveEnds(alien, deb);
          s.rest = Math.max(s.rest, s.len - 0.4);
          this.events.push(['tear', alien, deb, name, s]);
        }
      }
      // pointless strings fade: both ends on nothing that can move, or both on one torn-off piece
      if ((!s.a.owner && !s.b.owner && s.age > 1.5) || (s.a.owner && s.a.owner === s.b.owner && s.a.kind === 'debris' && s.age > 0.5)){
        this.events.push(['snap', s]); this.strings.splice(i, 1);
      }
    }
  }

  // ---------- drawing: each string as a chain of thin segments (sagging when slack) ----------
  draw(muzzleOf, t){
    let si = 0, bi = 0;
    const chain = (a, b, sag, wobble) => {
      const P = this.pts;
      for (let k = 0; k <= SEGS; k++){
        const u = k / SEGS;
        P[k].lerpVectors(a, b, u);
        P[k].y -= sag * 4 * u * (1 - u);
        if (wobble){ const w = Math.sin(u * Math.PI) * wobble * Math.sin(t * 60 + u * 9); P[k].x += w; P[k].z -= w * 0.6; }
      }
      for (let k = 0; k < SEGS; k++){
        _d.subVectors(P[k + 1], P[k]); const l = _d.length(); if (l < 1e-5){ this.segMesh.setMatrixAt(si++, ZERO); continue; }
        _q.setFromUnitVectors(_z, _d.divideScalar(l));
        const r = 0.011 + 0.006 * Math.sin((k + 0.5) / SEGS * Math.PI);
        _m.compose(P[k], _q, _s.set(r, r, l)); this.segMesh.setMatrixAt(si++, _m);
      }
    };
    const blob = (p, r) => { _m.compose(p, _q.identity(), _s.setScalar(r)); this.blobMesh.setMatrixAt(bi++, _m); };
    for (const s of this.strings){
      endPos(s.a, _a); endPos(s.b, _b);
      const len = _a.distanceTo(_b);
      const slack = Math.max(0, s.rest - len);
      chain(_a, _b, Math.min(2.5, Math.sqrt(slack * len) * 0.5 + slack * 0.15), s.T > 600 ? Math.min(0.02, s.T / 200000) : 0);
      blob(_a, 0.05); blob(_b, 0.05);
    }
    // the first end's string, running back to the gun (or to the glob carrying the second end)
    const second = this.flying.find((f) => f.second);
    if (this.pending){
      endPos(this.pending.end, _a);
      if (second) this.globPos(second, _b); else muzzleOf(this.pending.gun, _b);
      chain(_a, _b, 0.04 * _a.distanceTo(_b), 0);
      blob(_a, 0.05);
    }
    for (const f of this.flying){
      this.globPos(f, _p); blob(_p, 0.07);
      if (!f.second){ muzzleOf(f.gun, _b); chain(_b, _p, 0.01 * _b.distanceTo(_p), 0); }
    }
    for (let i = si; i < this.segMesh.count; i++) this.segMesh.setMatrixAt(i, ZERO);
    for (let i = bi; i < this.blobMesh.count; i++) this.blobMesh.setMatrixAt(i, ZERO);
    this.segMesh.instanceMatrix.needsUpdate = true; this.blobMesh.instanceMatrix.needsUpdate = true;
  }
  globPos(f, out){
    const u = clamp(f.t);
    // (the target moves: fly at where it is now)
    const to = f.end && !f.miss ? endPos(f.end, this._to || (this._to = V())) : f.point;
    out.lerpVectors(f.from, to, u);
    if (f.miss) out.y -= 4.9 * (u * f.dur) * (u * f.dur);
    return out;
  }
}
