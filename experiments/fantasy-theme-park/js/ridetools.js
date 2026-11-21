// Ride tools: putting down a coaster's station or a flat ride (with a ghost, green where it fits), and
// the Ride Workshop: laying a coaster's track piece by piece (or letting Finish find the way back to the
// station), and changing a flat ride's design. Driven like every tool, by finger, mouse or VR laser.
import * as THREE from 'three';
import { N, CELL, HALF } from './park.js';
import { CATALOG } from './models.js';
import { TILE, PIECES, COASTER_PIECES, newCoaster, newRide, stationCells, flatRadius, buildCarousel, buildWheel } from './rides.js';
import { disposeStructure } from './structures.js';

const DIRV = [[0, -1], [1, 0], [0, 1], [-1, 0]];
export class RideTools {
  constructor(tools){ this.T = tools; this.ghost = null; this.ghostKey = ''; }
  get app(){ return this.T.app; }
  get P(){ return this.T.app.park; }
  say(t, k){ this.T.say(t, k); }
  clearGhost(){ if (this.ghost){ disposeStructure(this.ghost); this.ghost = null; this.ghostKey = ''; } }

  // a coaster's station at the point: snapped to the 8 m grid, facing one of four ways (quarter turns)
  coasterAt(p){
    const q = (((Math.round(this.T.rot / (Math.PI / 2)) % 4) + 4) % 4), o = newCoaster(this.T.opts.hang);
    const [fx, fz] = DIRV[q];
    // the point is the middle of the station: its start is 8 m back
    o.d = q; o.x = Math.round((p.x - fx * 8) / TILE) * TILE; o.z = Math.round((p.z - fz * 8) / TILE) * TILE;
    const cells = stationCells(o); let hi = -1e9;
    for (const [x, z] of cells) hi = Math.max(hi, this.P.groundAt(x, z));
    o.y0 = hi + 0.9;
    return o;
  }
  problemAt(cells, ignore){
    const P = this.P, S = P.s;
    for (const [x, z] of cells){
      const i = Math.floor((x + HALF) / CELL), j = Math.floor((z + HALF) / CELL);
      if (!P.editable(i, j)) return 'That is outside the park.';
      const k = j * N + i;
      if (S.path[k]) return 'Rides go beside paths, not on them (paths lead up to them).';
      if (!Number.isNaN(S.water[k])) return 'Not in the water.';
      const st = this.T.inStructure(x, z, false, ignore); if (st) return st.type === 'building' ? 'A building is in the way.' : st.type === 'lot' ? 'That is in the car park.' : st.type === 'gate' ? 'That is in the entrance.' : 'Another ride is in the way.';
    }
    return null;
  }
  coasterProblem(o){
    const cells = stationCells(o), why = this.problemAt(cells, o.id); if (why) return why;
    let lo = 1e9; for (const [x, z] of cells) lo = Math.min(lo, this.P.groundAt(x, z));
    if (o.y0 - 0.9 - lo > 3) return 'The ground is too steep for a station here: level it first.';
    return null;
  }
  rideAt(p){ const o = this.T.opts.move ? JSON.parse(JSON.stringify(this.P.obj(this.T.opts.move))) : newRide(this.T.opts.kind); o.x = Math.round(p.x * 2) / 2; o.z = Math.round(p.z * 2) / 2; o.r = (this.T.opts.move ? (this.P.obj(this.T.opts.move).r || 0) : 0) + this.T.rot; return o; }
  rideCells(o){ const R = flatRadius(o), out = []; for (let x = -R; x <= R; x += 2) for (let z = -R; z <= R; z += 2) if (x * x + z * z <= R * R) out.push([o.x + x, o.z + z]); return out; }
  hover(p){
    if (!p){ if (this.ghost) this.ghost.visible = false; return; }
    const k = this.T.kind;
    if (k === 'coaster'){
      const o = this.coasterAt(p), key = 'c' + o.d;
      if (key !== this.ghostKey){
        this.clearGhost(); this.ghostKey = key;
        const g = new THREE.Group(), b = new THREE.Mesh(new THREE.BoxGeometry(8.2, 4, 16), this.T.ghostOk); b.position.set(1, 2, -8); g.add(b);
        const arrow = new THREE.Mesh(new THREE.ConeGeometry(1.2, 3, 4).rotateX(-Math.PI / 2), this.T.ghostOk); arrow.position.set(0, 4.8, -14); g.add(arrow);
        g.rotation.y = Math.atan2(-DIRV[o.d][0], -DIRV[o.d][1]); this.ghost = new THREE.Group(); this.ghost.add(g); this.app.scene.add(this.ghost);
      }
      const bad = !!this.coasterProblem(o);
      this.ghost.traverse((c) => { if (c.isMesh) c.material = bad ? this.T.ghostBad : this.T.ghostOk; });
      this.ghost.position.set(o.x, o.y0 - 0.9, o.z); this.ghost.visible = true;
    } else if (k === 'ride'){
      const o = this.rideAt(p), key = 'r' + o.kind + o.size + (o.tiers || '') + (o.gondolas || '');
      if (key !== this.ghostKey){ this.clearGhost(); this.ghostKey = key; this.ghost = o.kind === 'carousel' ? buildCarousel(o) : buildWheel(o); this.app.scene.add(this.ghost); }
      const bad = !!this.problemAt(this.rideCells(o), o.id);
      this.ghost.traverse((c) => { if (c.isMesh) c.material = bad ? this.T.ghostBad : this.T.ghostOk; });
      this.ghost.position.set(o.x, this.P.groundAt(o.x, o.z), o.z); this.ghost.rotation.y = o.r || 0; this.ghost.visible = true;
    }
  }
  up(p){
    if (!p) return;
    const P = this.P, k = this.T.kind;
    if (k === 'coaster'){
      const o = this.coasterAt(p), why = this.coasterProblem(o); if (why) return this.say(why, 'bad');
      P.begin('Build a coaster'); this.clearTrees(stationCells(o), 30); const added = P.addObject(o); P.commit();
      this.clearGhost(); this.T.rot = 0;
      this.app.ui.tab = 'rides'; this.T.set('cedit', { id: added.id });
      this.app.focus(o.x + DIRV[o.d][0] * 8, o.z + DIRV[o.d][1] * 8, 90);
      this.say('Now lay the track: tap pieces to add them, or Finish to close the loop back to the station.', 'good');
      return;
    }
    if (k === 'ride'){
      const o = this.rideAt(p), why = this.problemAt(this.rideCells(o), o.id); if (why) return this.say(why, 'bad');
      P.begin(this.T.opts.move ? 'Move ride' : 'Build a ' + o.kind); this.clearTrees(this.rideCells(o), o.size + 6);
      let id;
      if (this.T.opts.move){ id = this.T.opts.move; P.changeObject(id, { x: o.x, z: o.z, r: o.r }); } else id = P.addObject(o).id;
      P.commit(); this.clearGhost(); this.T.rot = 0;
      this.T.set('select'); this.app.ui.tab = 'select'; this.app.select(id);
    }
  }
  // trees and scenery under a ride (not on paths) are cleared
  clearTrees(cells, h){
    const P = this.P, set = new Set(cells.map(([x, z]) => P.cellIndex(x, z)));
    for (const q of P.s.objects.slice()) if (CATALOG[q.type] && set.has(P.cellIndex(q.x, q.z))) P.removeObject(q.id);
    void h;
  }

  // --- the coaster workshop -----
  get o(){ return this.P.obj(this.T.opts.id); }
  get item(){ return this.app.rides.get(this.T.opts.id); }
  addPiece(type){
    const o = this.o, it = this.item; if (!o || !it) return;
    const c = it.track.check(type);
    if (!c.ok){ it.track.preview(type, false, c.s, 1.5); this.say(c.why, 'bad'); return false; }
    this.setPieces([...(o.pieces || []), type], PIECES[type].name);
    return true;
  }
  setPieces(pieces, label){
    const P = this.P, o = this.o;
    P.begin(label || 'Track'); P.changeObject(o.id, { pieces }); P.commit();
    // trees under the new track (if it's low) go
    const it = this.item; if (!it) return;
    const pts = it.track.path.filter((p) => p.pos.y - P.groundAt(p.pos.x, p.pos.z) < 14);
    if (pts.length){ const near = new Set(); for (const p of pts) for (const [dx, dz] of [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2]]) near.add(P.cellIndex(p.pos.x + dx, p.pos.z + dz));
      const gone = P.s.objects.filter((q) => CATALOG[q.type] && CATALOG[q.type].cat === 'trees' && near.has(P.cellIndex(q.x, q.z)));
      if (gone.length){ P.begin('Clear trees for the track'); for (const q of gone) P.removeObject(q.id); P.commit(); } }
  }
  undoPiece(){ const o = this.o; if (o && o.pieces.length) this.setPieces(o.pieces.slice(0, -1), 'Take a piece off'); }
  clear(){ const o = this.o; if (o && o.pieces.length) this.setPieces([], 'Clear the track'); }
  finish(){
    const o = this.o, it = this.item; if (!o || !it) return;
    if (it.track.complete) return this.say('It\'s already a complete circuit.');
    const more = it.track.finish(COASTER_PIECES.filter((t) => !PIECES[t].inversions && !PIECES[t].jumps && t !== 'boost'));
    if (!more) return this.say('There\'s no way back to the station from here: take some pieces off (or turn towards it) and try again.', 'bad');
    this.setPieces([...o.pieces, ...more], 'Finish the track');
    this.say(`Finished with ${more.length} more pieces: the train is running.`, 'good');
  }
}
