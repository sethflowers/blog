// The map: draws a park (lands, water, paths, the railroad, landmarks), the restroom pins, you and
// the way to the next restroom, on a 2D canvas. Drag to pan, pinch or scroll to zoom, tap a pin.
// It only redraws when something changed (or to pulse the "you are here" dot).
import { clamp } from './util.js';
import { LANDS } from './parks.js';

const TILE = 256;        // tile size in CSS pixels
const MAX_TILES = 40;    // at least this many tiles kept (1 MB each on a 2x/3x screen; more on a big screen); least recently used go first
const CELL = 60;         // trees are bucketed in 60 m cells, so a tile only looks at its own trees

export class MapView {
  constructor(canvas, handlers){
    this.cv = canvas; this.g = canvas.getContext('2d'); this.h = handlers;
    this.tiles = new Map(); this.spare = []; this.tilesV = 0; this.tilesMade = 0; this.wantTiles = false;
    this.park = null; this.heading = null; this.safeL = 0; this.pins = []; this.me = null; this.route = null; this.selected = null;
    this.cx = 0; this.cy = 0; this.zoom = 1; this.base = 1;
    this.pad = { top: 0, bottom: 0 };
    this.W = 1; this.H = 1; this.dpr = 1;
    this.isDirty = true; this.lastPulse = 0; this.follow = false;
    this.ptrs = new Map(); this.gesture = null;
    this.resize();
    addEventListener('resize', () => this.resize());
    this.bindInput();
    const loop = (t) => {
      requestAnimationFrame(loop);
      try {
        const pulse = (this.me || this.selected) && t - this.lastPulse > 50;
        if (this.isDirty || pulse){ this.lastPulse = t; this.isDirty = false; this.draw(t); }
        // spare time: draw tiles ahead (less while a finger is on the map), then show any that were missing
        const busy = this.ptrs.size > 0 || this.animating;
        if (this.park) this.prefetch(busy ? 3 : 7);
        if (this.wantTiles){ this.wantTiles = false; this.tilesV++; this.dirty(); }
      } catch (e) { console.error(e); }
    };
    requestAnimationFrame(loop);
  }

  dirty(){ this.isDirty = true; }

  resize(){
    const r = this.cv.getBoundingClientRect();
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    this.W = Math.max(1, r.width); this.H = Math.max(1, r.height);
    this.cv.width = Math.round(this.W * this.dpr); this.cv.height = Math.round(this.H * this.dpr);
    if (this.park) this.fitBase();
    this.dirty();
  }

  fitBase(){
    const b = this.park.bounds, h = this.H - this.pad.top - this.pad.bottom;
    this.base = Math.min(this.W / (b.x1 - b.x0), h / (b.y1 - b.y0)) * 1.05;
  }

  setPark(park){
    this.park = park; this.fitBase();
    this.cx = park.start.x; this.cy = park.start.y; this.zoom = this.startZoom();
    this.dirty();
  }
  // the whole park across a wide screen; on a tall phone, fill its height and let you pan sideways
  startZoom(){
    const b = this.park.bounds, h = this.H - this.pad.top - this.pad.bottom;
    const fitH = (h / (b.y1 - b.y0)) / (this.W / (b.x1 - b.x0));
    return clamp(Math.max(this.park.start.zoom || 1, fitH * 0.7), 0.8, 2.4);
  }
  setPins(pins){ this.pins = pins; this.pinsV = (this.pinsV || 0) + 1; this.dirty(); }
  setMe(me){ this.me = me; if (me && this.follow) { this.cx = me.x; this.cy = me.y; this.clampView(); } this.dirty(); }
  setRoute(r){ this.route = r; this.dirty(); }
  select(id){ this.selected = id; this.dirty(); }
  setPad(top, bottom){ this.pad = { top, bottom }; if (this.park) this.fitBase(); this.dirty(); }

  get s(){ return this.base * this.zoom; }
  midY(){ return this.pad.top + (this.H - this.pad.top - this.pad.bottom) / 2; }
  sx(x){ return (x - this.cx) * this.s + this.W / 2; }
  sy(y){ return (this.cy - y) * this.s + this.midY(); }
  toMap(px, py){ return { x: this.cx + (px - this.W / 2) / this.s, y: this.cy - (py - this.midY()) / this.s }; }

  clampView(){
    const b = this.park.bounds;
    this.zoom = clamp(this.zoom, 0.55, 7);
    this.cx = clamp(this.cx, b.x0, b.x1); this.cy = clamp(this.cy, b.y0, b.y1);
  }

  centerOn(x, y, zoom, animate = true){
    const to = { cx: x, cy: y, zoom: zoom || this.zoom };
    if (!animate){ this.anim = (this.anim || 0) + 1; this.animating = false; Object.assign(this, to); this.clampView(); this.dirty(); return; }
    const from = { cx: this.cx, cy: this.cy, zoom: this.zoom }, t0 = performance.now(), D = 450, id = this.anim = (this.anim || 0) + 1;
    const step = () => {
      if (id !== this.anim) return;
      const k = Math.min(1, (performance.now() - t0) / D), e = 1 - Math.pow(1 - k, 3);
      this.cx = from.cx + (to.cx - from.cx) * e; this.cy = from.cy + (to.cy - from.cy) * e;
      this.zoom = from.zoom * Math.pow(to.zoom / from.zoom, e);
      this.animating = k < 1;
      this.clampView(); this.dirty();
      if (k < 1) requestAnimationFrame(step);
    };
    step();
  }

  // ---------- input: pointer events only; nothing can get stuck ----------
  bindInput(){
    const cv = this.cv;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const start = () => {
      const pts = [...this.ptrs.values()];
      if (pts.length === 1) this.gesture = { kind: 'pan', p0: pts[0], c0: { x: this.cx, y: this.cy }, t0: performance.now(), moved: 0 };
      else if (pts.length >= 2){
        const [a, b] = pts, mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        this.gesture = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: this.zoom, anchor: this.toMap(mid.x, mid.y), moved: 99 };
      } else this.gesture = null;
    };
    cv.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { cv.setPointerCapture(e.pointerId); } catch (x) {}
      this.anim = (this.anim || 0) + 1; this.animating = false;
      this.ptrs.set(e.pointerId, pos(e)); start();
      if (this.ptrs.size === 1) this.follow = false;
    });
    cv.addEventListener('pointermove', (e) => {
      if (!this.ptrs.has(e.pointerId)) return;
      this.ptrs.set(e.pointerId, pos(e));
      const g = this.gesture; if (!g) return;
      const pts = [...this.ptrs.values()];
      if (g.kind === 'pan' && pts.length === 1){
        const dx = pts[0].x - g.p0.x, dy = pts[0].y - g.p0.y;
        g.moved = Math.max(g.moved, Math.hypot(dx, dy));
        if (g.moved > 6){ this.cx = g.c0.x - dx / this.s; this.cy = g.c0.y + dy / this.s; this.clampView(); this.dirty(); }
      } else if (g.kind === 'pinch' && pts.length >= 2){
        const [a, b] = pts, mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        this.zoom = g.z0 * Math.hypot(a.x - b.x, a.y - b.y) / g.d0; this.clampView();
        // keep the point under the fingers under the fingers
        this.cx = g.anchor.x - (mid.x - this.W / 2) / this.s; this.cy = g.anchor.y + (mid.y - this.midY()) / this.s;
        this.clampView(); this.dirty();
      }
    });
    const end = (e) => {
      if (!this.ptrs.has(e.pointerId)) return;
      const p = this.ptrs.get(e.pointerId), g = this.gesture;
      this.ptrs.delete(e.pointerId);
      this.dirty();
      if (e.type === 'pointerup' && g && g.kind === 'pan' && g.moved <= 6 && performance.now() - g.t0 < 600) this.tap(p);
      start();
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('lostpointercapture', end);
    addEventListener('pointerup', (e) => { if (this.ptrs.has(e.pointerId)) end(e); });
    const forget = () => { this.ptrs.clear(); this.gesture = null; this.dirty(); };
    addEventListener('blur', forget);
    document.addEventListener('visibilitychange', forget);
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = pos(e), before = this.toMap(p.x, p.y);
      this.zoom *= Math.exp(-e.deltaY * 0.0015); this.clampView();
      const after = this.toMap(p.x, p.y);
      this.cx += before.x - after.x; this.cy += before.y - after.y; this.clampView(); this.dirty();
    }, { passive: false });
    let lastTap = 0;
    this.tap = (p) => {
      const now = performance.now();
      const hit = this.hitPin(p.x, p.y);
      if (hit){ lastTap = 0; this.h.onTapPin && this.h.onTapPin(hit.id); return; }
      const lm = this.hitLandmark(p.x, p.y);
      if (lm && this.h.onTapLandmark){ lastTap = 0; this.h.onTapLandmark(lm); return; }
      if (now - lastTap < 320){ lastTap = 0; const m = this.toMap(p.x, p.y); this.centerOn(m.x, m.y, this.zoom * 1.8); return; }
      lastTap = now;
      this.h.onTapMap && this.h.onTapMap(this.toMap(p.x, p.y));
    };
  }

  hitLandmark(px, py){
    if (!this.park) return null;
    let best = null, bd = 24;
    for (const l of this.park.landmarks){
      if (this.zoom < l.zoom) continue;
      const d = Math.hypot(this.sx(l.x) - px, this.sy(l.y) - (l.drawn ? 12 : 0) - py);
      if (d < bd){ bd = d; best = l; }
    }
    return best;
  }
  hitPin(px, py){
    let best = null, bd = 28;
    for (const p of this.pins){
      const d = Math.hypot(this.sx(p.x) - px, this.sy(p.y) - 14 * this.pinScale() - py);
      if (d < bd){ bd = d; best = p; }
    }
    return best;
  }

  // ---------- drawing ----------
  // ctx-free helpers draw into this.g (which is the cached background while it is being rebuilt)
  poly(pts){ const g = this.g; g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(this.sx(x), this.sy(y)) : g.moveTo(this.sx(x), this.sy(y))); g.closePath(); }
  line(pts){ const g = this.g; g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(this.sx(x), this.sy(y)) : g.moveTo(this.sx(x), this.sy(y))); }
  circ(x, y, r){ this.g.beginPath(); this.g.arc(this.sx(x), this.sy(y), Math.max(0.5, r * this.s), 0, Math.PI * 2); }
  shape(w){ if (w.poly) this.poly(w.poly); else if (w.circle) this.circ(...w.circle); else if (w.line) this.line(w.line); }

  // ---------- the picture: tiles + an overlay, cached until the view changes ----------
  // The ground (lands, water, paths, trees, buildings, railroad) is drawn in 256-pixel tiles at a few
  // zoom levels and kept, like a phone's map app. In spare moments between frames, the tiles around
  // the screen (and a coarser level behind them) are drawn ahead of time, so dragging or pinching
  // never shows an unfinished map. Names, icons and the big landmarks are drawn on top every time the
  // view changes (they would be cut in half at tile edges otherwise); the pins, you and the route on
  // top of that, every frame.
  draw(t){
    const main = this.g;
    if (!this.park){ main.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); main.fillStyle = '#5c914c'; main.fillRect(0, 0, this.W, this.H); return; }
    const key = [this.cx, this.cy, this.zoom, this.W, this.H, this.dpr, this.pad.top, this.pad.bottom, this.pinsV, this.tilesV].join(',');
    if (!this.bg || this.bgKey !== key){
      if (!this.bg) this.bg = document.createElement('canvas');
      if (this.bg.width !== this.cv.width || this.bg.height !== this.cv.height){ this.bg.width = this.cv.width; this.bg.height = this.cv.height; }
      this.g = this.bg.getContext('2d');
      this.composeTiles();
      this.g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.drawOverlay();
      this.g = main; this.bgKey = key;
    }
    main.setTransform(1, 0, 0, 1, 0, 0);
    main.drawImage(this.bg, 0, 0);
    main.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawDynamic(t);
  }

  tileLevel(){ return Math.max(-2, Math.ceil(Math.log2(this.zoom * 1.15) - 1e-6)); }
  tileM(L){ return TILE / (this.base * Math.pow(2, L)); }
  tileOrigin(){ const b = this.park.bounds; return { ox: b.x0 - 600, oy: b.y1 + 600 }; }
  // the tiles (level L) covering the screen, grown by `ring` tiles on every side
  tileRange(L, ring){
    const { ox, oy } = this.tileOrigin(), T = this.tileM(L);
    const a = this.toMap(0, 0), b = this.toMap(this.W, this.H);
    return { i0: Math.floor((a.x - ox) / T) - ring, i1: Math.floor((b.x - ox) / T) + ring, j0: Math.floor((oy - a.y) / T) - ring, j1: Math.floor((oy - b.y) / T) + ring };
  }
  tileKey(L, i, j){ return L + '/' + i + '/' + j; }
  getTile(L, i, j){
    const k = this.tileKey(L, i, j), c = this.tiles.get(k);
    if (c){ this.tiles.delete(k); this.tiles.set(k, c); }   // most recently used last
    return c;
  }
  renderTile(L, i, j){
    const k = this.tileKey(L, i, j);
    if (this.tiles.has(k)) return this.tiles.get(k);
    const tdpr = Math.min(2, this.dpr), c = this.spare.pop() || document.createElement('canvas');
    c.width = c.height = TILE * tdpr;
    const { ox, oy } = this.tileOrigin(), T = this.tileM(L);
    const keep = { cx: this.cx, cy: this.cy, zoom: this.zoom, W: this.W, H: this.H, pad: this.pad, dpr: this.dpr, g: this.g };
    Object.assign(this, { cx: ox + (i + 0.5) * T, cy: oy - (j + 0.5) * T, zoom: Math.pow(2, L), W: TILE, H: TILE, pad: { top: 0, bottom: 0 }, dpr: tdpr, g: c.getContext('2d') });
    try { this.drawGround(); } finally { Object.assign(this, keep); }
    this.tiles.set(k, c); this.tilesMade++;
    while (this.tiles.size > (this.maxTiles || MAX_TILES)){ const [old, oc] = this.tiles.entries().next().value; this.tiles.delete(old); if (this.spare.length < 8) this.spare.push(oc); }
    return c;
  }
  // put the tiles on screen; a missing one is drawn now if it can be, or stood in for by the coarser
  // level (blurry for a moment rather than blank) and drawn in the next spare moment
  composeTiles(){
    const g = this.g, d = this.dpr, L = this.tileLevel(), { ox, oy } = this.tileOrigin();
    if (this.tilesBase !== this.base || this.tilesPark !== this.park){ this.tiles.clear(); this.tilesBase = this.base; this.tilesPark = this.park; }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#5c914c'; g.fillRect(0, 0, this.cv.width, this.cv.height);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    const T = this.tileM(L), r = this.tileRange(L, 0), t0 = performance.now(), busy = this.ptrs.size > 0 || this.animating;
    let missing = 0;
    const put = (c, x0, y0, x1, y1, sx = 0, sy = 0, sw = c.width, sh = c.height) => {
      const X0 = Math.round(this.sx(x0) * d), Y0 = Math.round(this.sy(y0) * d), X1 = Math.round(this.sx(x1) * d), Y1 = Math.round(this.sy(y1) * d);
      g.drawImage(c, sx, sy, sw, sh, X0, Y0, X1 - X0, Y1 - Y0);
    };
    for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++){
      const x0 = ox + i * T, y0 = oy - j * T;
      let c = this.getTile(L, i, j);
      if (!c && (!busy || performance.now() - t0 < 8)) c = this.renderTile(L, i, j);
      if (c){ put(c, x0, y0, x0 + T, y0 - T); continue; }
      missing++;
      // the coarser tile this one sits inside
      const P = this.getTile(L - 1, Math.floor(i / 2), Math.floor(j / 2));
      if (P){ const h = P.width / 2; put(P, x0, y0, x0 + T, y0 - T, (((i % 2) + 2) % 2) * h, (((j % 2) + 2) % 2) * h, h, h); }
    }
    this.lastMissing = missing;
    if (missing) this.wantTiles = true;
  }
  // spare moments: draw the tiles the view will want next (around the screen, and a level either side)
  prefetch(budget){
    if (!this.park || !this.base) return;
    const t0 = performance.now(), L = this.tileLevel();
    // the screen, a ring of tiles around it (a drag never outruns it: a tile takes a few ms), and the
    // coarser level a ring wide, to stand in while zooming. The cache is sized to hold all of them.
    const want = [[L, 0], [L - 1, 1], [L, 1]];
    let n = 0;
    for (const [lv, ring] of want.slice(1)){ const r = this.tileRange(lv, ring); n += (r.i1 - r.i0 + 1) * (r.j1 - r.j0 + 1); }   // (the screen is inside its ring)
    this.maxTiles = Math.max(MAX_TILES, n + 12);
    for (const [lv, ring] of want){
      if (lv < -2) continue;
      const r = this.tileRange(lv, ring);
      for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++){
        if (this.tiles.has(this.tileKey(lv, i, j))) continue;
        this.renderTile(lv, i, j);
        if (lv === L && ring === 0) this.wantTiles = true;
        if (performance.now() - t0 > budget) return false;
      }
    }
    return true;
  }

  // trees, from the traced map, bucketed in cells so a tile only looks at its own
  makeTrees(){
    const COLS = ['#4c8a3c', '#5a9a46', '#3f7c34', '#68a852', '#55923f'];
    this.trees = this.park.map.trees.map(([x, y, r], i) => ({ x, y, r, c: COLS[Math.abs(i * 7 + Math.round(x * 13)) % 5] }));
    // forest around the guide map's drawing (it only shows the park), so the map has no hard border.
    // frame: the outline of the guide's drawing, fitted to the ground (no longer a rectangle; it leaves
    // out the guide's pale east edge and the bus and parking lots); frameIn: 30 px inside it, half forest
    // clear: where the map is drawn from OpenStreetMap past the guide's edge (TRON), no forest
    const B = this.park.bounds, F = this.park.map.frame, FI = this.park.map.frameIn, CL = this.park.map.clear || [];
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let y = B.y0 - 400; y < B.y1 + 400; y += 16) for (let x = B.x0 - 500; x < B.x1 + 500; x += 16){
      const px = x + (rnd() - 0.5) * 12, py = y + (rnd() - 0.5) * 12, r = 6 + rnd() * 4, half = rnd() < 0.5, c = COLS[(rnd() * 5) | 0];
      if ((!inPoly(px, py, F) || (half && !inPoly(px, py, FI))) && !CL.some((o) => inPoly(px, py, o))) this.trees.push({ x: px, y: py, r, c });
    }
    // ripples: a few points inside the bigger stretches of water
    this.ripples = [];
    let k = 0;
    for (const sh of this.park.map.water){
      const o = sh[0]; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const [x, y] of o){ x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      if ((x1 - x0) * (y1 - y0) < 6000) continue;
      for (let y = y0 + 12; y < y1; y += 34) for (let x = x0 + 12; x < x1; x += 46){
        const px = x + ((k * 17) % 20), py = y + ((k++ * 11) % 14);
        if (inPoly(px, py, o) && !sh.slice(1).some((h) => inPoly(px, py, h)) && k % 3 === 0) this.ripples.push([px, py]);
      }
    }
    this.treeGrid = new Map();
    for (const t of this.trees){ const k = Math.floor(t.x / CELL) + ',' + Math.floor(t.y / CELL); if (!this.treeGrid.has(k)) this.treeGrid.set(k, []); this.treeGrid.get(k).push(t); }
  }
  // a traced shape: [outline, ...holes], filled even-odd so lawns and islands stay open
  rings(rs){
    const g = this.g; g.beginPath();
    for (const r of rs){ r.forEach(([x, y], i) => i ? g.lineTo(this.sx(x), this.sy(y)) : g.moveTo(this.sx(x), this.sy(y))); g.closePath(); }
  }
  // is any of a shape's box on this tile?
  onTile(rs){
    if (!rs._box){ let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of rs[0]){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } rs._box = [x0, y0, x1, y1]; }
    const [x0, y0, x1, y1] = rs._box, a = this.toMap(-8, -8), b = this.toMap(this.W + 8, this.H + 8);
    return x1 >= a.x && x0 <= b.x && y0 <= a.y && y1 >= b.y;
  }

  // the ground, drawn into a tile
  drawGround(){
    const g = this.g, P = this.park, M = P.map, s = this.s, z = this.zoom;
    if (this.treesFor !== P){ this.makeTrees(); this.treesFor = P; }
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.fillStyle = '#a9d488'; g.fillRect(0, 0, this.W, this.H);
    // sand, water (a sandy shore, the water, a glint along the edge)
    for (const sh of M.sand){ if (!this.onTile(sh)) continue; this.rings(sh); g.fillStyle = '#f2dd9c'; g.fill('evenodd'); }
    for (const sh of M.water){
      if (!this.onTile(sh)) continue;
      this.rings(sh); g.strokeStyle = '#e6d8a8'; g.lineWidth = Math.max(1.5, 3.5 * s); g.stroke();
      g.fillStyle = '#6cc0ea'; g.fill('evenodd');
      g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = Math.max(1, 1.2 * s); g.stroke();
    }
    // ripples on the open water
    if (z > 0.9){
      g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 1.2;
      for (const [x, y] of this.ripples){ g.beginPath(); g.arc(this.sx(x), this.sy(y), 5 * Math.sqrt(z), Math.PI * 1.15, Math.PI * 1.85); g.stroke(); }
    }
    // streets (Main Street, the hub, the Speedway), then the walkways
    for (const sh of M.roads){ if (!this.onTile(sh)) continue; this.rings(sh); g.fillStyle = '#cdc8c0'; g.fill('evenodd'); g.strokeStyle = '#aaa398'; g.lineWidth = 1; g.stroke(); }
    for (const sh of M.paths){ if (!this.onTile(sh)) continue; this.rings(sh); g.fillStyle = '#f8eedb'; g.fill('evenodd'); g.strokeStyle = '#d9c39b'; g.lineWidth = Math.max(0.8, 0.6 * s); g.stroke(); }
    // trees
    const W = this.W, H = this.H, a = this.toMap(-20, -20), bb = this.toMap(W + 20, H + 20), tr = [];
    for (let cy = Math.floor(bb.y / CELL); cy <= Math.floor(a.y / CELL); cy++) for (let cx = Math.floor(a.x / CELL); cx <= Math.floor(bb.x / CELL); cx++){
      const cell = this.treeGrid.get(cx + ',' + cy); if (cell) for (const t of cell) tr.push(t);
    }
    for (const pass of [0, 1, 2]) for (const tt of tr){
      const X = this.sx(tt.x), Y = this.sy(tt.y), r = tt.r * s;
      if (X < -r - 4 || X > W + r + 4 || Y < -r - 4 || Y > H + r + 4) continue;
      if (pass === 0){ g.fillStyle = 'rgba(30,50,20,.28)'; g.beginPath(); g.arc(X + r * 0.3, Y + r * 0.35, r, 0, 7); g.fill(); }
      else if (pass === 1){ g.fillStyle = tt.c; g.beginPath(); g.arc(X, Y, Math.max(1, r), 0, 7); g.fill(); }
      else if (r > 3){ g.fillStyle = 'rgba(255,255,220,.18)'; g.beginPath(); g.arc(X - r * 0.3, Y - r * 0.3, r * 0.5, 0, 7); g.fill(); }
    }
    // buildings, in their guide-map colours, with a shadow and a lit edge
    for (const b of M.buildings){
      const sh = b.sh || (b.sh = [b.p]);
      if (!this.onTile(sh)) continue;
      // (a: a see-through canopy, like TRON's over its queue: no shadow)
      if (!b.a){ g.save(); g.translate(2.5, 3); this.rings(sh); g.fillStyle = 'rgba(40,30,20,.3)'; g.fill(); g.restore(); }
      this.rings(sh); g.fillStyle = b.c; g.fill();
      g.strokeStyle = b.o || 'rgba(50,35,25,.45)'; g.lineWidth = Math.max(1, Math.min(2, 0.5 * s)); g.stroke();
    }
    // the railroad: a dark bed with ties
    this.poly(M.rail); g.strokeStyle = '#7a5a3a'; g.lineWidth = Math.max(2, 3.5 * s); g.stroke();
    if (z > 0.9){ this.poly(M.rail); g.strokeStyle = '#c8a878'; g.lineWidth = Math.max(1, 1.3 * s); g.setLineDash([Math.max(2, 3 * s), Math.max(2, 3 * s)]); g.stroke(); g.setLineDash([]); }
  }

  // names, icons and the big landmarks, over the tiles
  drawOverlay(){
    const g = this.g, P = this.park, z = this.zoom, W = this.W, H = this.H;
    g.lineJoin = 'round'; g.lineCap = 'round';
    // keep labels off the pins (and off the pins' own labels)
    this.placed = [];
    const ks = this.pinScale();
    g.font = '800 11px "Avenir Next","Trebuchet MS",sans-serif';
    for (const p of this.pins){
      const X = this.sx(p.x), Y = this.sy(p.y);
      this.placed.push([X - 14 * ks, Y - 34 * ks, 28 * ks, 34 * ks]);
      if (this.pinLabels()){ const w = g.measureText(p.name).width + 8; this.placed.push([X - w / 2, Y + 2, w, 16]); }
    }
    // land names, like a storybook map
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const fs = clamp(15 * Math.pow(z, 0.6), 12, 30);
    for (const [id, [x, y, rot]] of Object.entries(P.labels)){
      g.save(); g.translate(this.sx(x), this.sy(y)); g.rotate(rot * Math.PI / 180);
      g.font = `italic 700 ${fs}px Georgia,"Times New Roman",serif`;
      const text = LANDS[id].short;
      g.lineWidth = 4; g.strokeStyle = 'rgba(255,255,255,.8)'; g.strokeText(text, 0, 0);
      g.fillStyle = LANDS[id].ink; g.fillText(text, 0, 0);
      g.restore();
    }
    // landmarks
    const labelFont = `700 ${clamp(10.5 * Math.pow(z, 0.45), 10, 14)}px "Avenir Next","Trebuchet MS",sans-serif`;
    const showLabel = (l) => z >= Math.max(1.3, l.zoom + 0.45) || (l.size >= 26 && z >= 0.85);
    for (const l of P.landmarks){
      l._lab = null;
      if (z < l.zoom || l.drawn) continue;
      const px = clamp(l.size * Math.pow(z, 0.55), 12, l.size * 1.9), X = this.sx(l.x), Y = this.sy(l.y);
      if (X < -60 || X > W + 60 || Y < -60 || Y > H + 60) continue;
      g.fillStyle = 'rgba(0,0,0,.22)'; g.beginPath(); g.arc(X + 1, Y + 2, px * 0.7, 0, 7); g.fill();
      g.fillStyle = 'rgba(255,253,245,.95)'; g.beginPath(); g.arc(X, Y, px * 0.7, 0, 7); g.fill();
      g.font = `${px * 0.82}px "Apple Color Emoji","Noto Color Emoji","Segoe UI Emoji",sans-serif`;
      g.fillText(l.icon, X, Y + px * 0.04);
      this.placed.push([X - px * 0.7, Y - px * 0.7, px * 1.4, px * 1.4]);
      if (showLabel(l)) l._lab = [X, Y + px * 0.7 + 9]; else l._lab = null;
    }
    this.drawThunder(P.drawn.thunder);
    this.drawSpace(P.drawn.spaceMountain);
    this.drawCastle(P.drawn.castle);
    // labels: the big drawn landmarks first, then the rest where they fit
    g.font = labelFont;
    for (const l of P.landmarks) if (l.drawn && showLabel(l)){
      const X = this.sx(l.x), Y = this.sy(l.y) + 12, w = g.measureText(l.name).width + 8;
      this.placed.push([X - w / 2, Y - 9, w, 18]);
      this.label(l.name, X, Y, '#2a2418', 'rgba(255,250,236,.92)');
    }
    for (const l of P.landmarks) if (!l.drawn && l._lab && z >= l.zoom) this.label(l.name, l._lab[0], l._lab[1], '#2a2418', 'rgba(255,250,236,.92)', true);
    for (const st of P.stations){
      if (z < 1.1) continue;
      const X = this.sx(st.x), Y = this.sy(st.y), px = clamp(13 * Math.pow(z, 0.5), 12, 22);
      g.fillStyle = 'rgba(255,253,245,.95)'; g.beginPath(); g.arc(X, Y, px * 0.72, 0, 7); g.fill();
      g.strokeStyle = '#7a5a3a'; g.lineWidth = 2; g.stroke();
      g.font = `${px * 0.85}px "Apple Color Emoji","Noto Color Emoji",sans-serif`; g.fillText('🚂', X, Y + 1);
      if (z >= 1.7){ g.font = labelFont; this.label(st.name, X, Y + px + 6, '#2a2418', 'rgba(255,250,236,.92)', true); }
    }
  }

  // drawings stand up off the map, anchored at their base; they grow with the zoom but never vanish
  unit(height){ return Math.max(this.s, 30 / height); }
  drawCastle([x, y]){
    const g = this.g, u = this.unit(64), X = this.sx(x), Y = this.sy(y) + 14 * u;
    g.save();
    g.fillStyle = 'rgba(30,40,60,.25)'; g.beginPath(); g.ellipse(X + 4 * u, Y + 1 * u, 32 * u, 7 * u, 0, 0, 7); g.fill();
    const wall = (x0, y0, w, h) => {
      g.fillStyle = '#f7f2e8'; g.fillRect(X + x0 * u, Y - (y0 + h) * u, w * u, h * u);
      g.fillStyle = '#e0d6c6'; g.fillRect(X + (x0 + w * 0.62) * u, Y - (y0 + h) * u, w * 0.38 * u, h * u);
    };
    const cone = (cx, base, w, h, tip = true) => {
      g.fillStyle = '#3f72e0'; g.beginPath(); g.moveTo(X + (cx - w / 2) * u, Y - base * u); g.lineTo(X + cx * u, Y - (base + h) * u); g.lineTo(X + (cx + w / 2) * u, Y - base * u); g.closePath(); g.fill();
      g.fillStyle = '#2a52b0'; g.beginPath(); g.moveTo(X + cx * u, Y - (base + h) * u); g.lineTo(X + (cx + w / 2) * u, Y - base * u); g.lineTo(X + (cx + w * 0.12) * u, Y - base * u); g.closePath(); g.fill();
      if (tip){ g.fillStyle = '#f2c440'; g.beginPath(); g.arc(X + cx * u, Y - (base + h) * u, Math.max(1, 1.1 * u), 0, 7); g.fill(); }
    };
    // back towers, then the front
    wall(-30, 0, 7, 20); cone(-26.5, 20, 9, 12);
    wall(23, 0, 7, 20); cone(26.5, 20, 9, 12);
    wall(-11, 30, 6, 16); cone(-8, 46, 8, 10);
    wall(5, 30, 6, 16); cone(8, 46, 8, 10);
    wall(-8, 20, 16, 30); cone(0, 50, 18, 20);
    wall(-22, 0, 44, 22);
    // battlements
    g.fillStyle = '#f7f2e8'; for (let i = -22; i < 22; i += 5) g.fillRect(X + i * u, Y - 24 * u, 2.6 * u, 2.2 * u);
    wall(-19, 0, 8, 30); cone(-15, 30, 11, 14);
    wall(11, 0, 8, 30); cone(15, 30, 11, 14);
    // the gate and windows
    g.fillStyle = '#4a3a6a'; g.beginPath(); g.moveTo(X - 4.5 * u, Y); g.lineTo(X - 4.5 * u, Y - 8 * u); g.arc(X, Y - 8 * u, 4.5 * u, Math.PI, 0); g.lineTo(X + 4.5 * u, Y); g.closePath(); g.fill();
    g.fillStyle = '#6a5a8a'; for (const [wx, wy] of [[-15, 20], [15, 20], [-2, 36], [2, 36], [0, 42]]) g.fillRect(X + (wx - 0.8) * u, Y - wy * u, 1.6 * u, 3 * u);
    g.fillStyle = '#d8b030'; g.fillRect(X - 22 * u, Y - 14 * u, 44 * u, 1.2 * u);
    g.restore();
  }
  drawSpace([x, y, R]){
    const g = this.g, u = this.unit(44), X = this.sx(x), Y = this.sy(y) + R * 0.45 * u;
    g.fillStyle = 'rgba(30,40,60,.25)'; g.beginPath(); g.ellipse(X + 4 * u, Y + 1 * u, R * 1.05 * u, R * 0.28 * u, 0, 0, 7); g.fill();
    const gr = g.createLinearGradient(X - R * u, 0, X + R * u, 0); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.55, '#eef2f8'); gr.addColorStop(1, '#b8c4d4');
    g.fillStyle = gr; g.beginPath(); g.moveTo(X - R * u, Y);
    g.bezierCurveTo(X - R * 0.7 * u, Y - R * 0.5 * u, X - R * 0.18 * u, Y - R * 1.05 * u, X, Y - R * 1.1 * u);
    g.bezierCurveTo(X + R * 0.18 * u, Y - R * 1.05 * u, X + R * 0.7 * u, Y - R * 0.5 * u, X + R * u, Y);
    g.closePath(); g.fill();
    g.strokeStyle = 'rgba(120,140,170,.7)'; g.lineWidth = Math.max(0.7, 0.7 * u);
    for (let i = -3; i <= 3; i++){ g.beginPath(); g.moveTo(X + i * R * 0.3 * u, Y); g.lineTo(X + i * R * 0.04 * u, Y - R * 1.02 * u); g.stroke(); }
    g.fillStyle = '#c8d0dc'; g.fillRect(X - 1 * u, Y - R * 1.35 * u, 2 * u, R * 0.3 * u);
    g.fillStyle = '#e83a4a'; g.beginPath(); g.arc(X, Y - R * 1.36 * u, Math.max(1, 1.4 * u), 0, 7); g.fill();
    g.fillStyle = '#5a6a8a'; g.fillRect(X - R * 1.02 * u, Y - 2 * u, R * 2.04 * u, 2 * u);
  }
  drawThunder([x, y]){
    const g = this.g, u = this.unit(40), X = this.sx(x), Y = this.sy(y) + 12 * u;
    g.fillStyle = 'rgba(40,30,20,.25)'; g.beginPath(); g.ellipse(X + 3 * u, Y + 1 * u, 34 * u, 8 * u, 0, 0, 7); g.fill();
    const spire = (cx, w, h, c1, c2) => {
      g.fillStyle = c1; g.beginPath(); g.moveTo(X + (cx - w) * u, Y); g.lineTo(X + (cx - w * 0.45) * u, Y - h * 0.55 * u); g.lineTo(X + (cx - w * 0.2) * u, Y - h * u);
      g.lineTo(X + (cx + w * 0.25) * u, Y - h * 0.9 * u); g.lineTo(X + (cx + w * 0.5) * u, Y - h * 0.5 * u); g.lineTo(X + (cx + w) * u, Y); g.closePath(); g.fill();
      g.fillStyle = c2; g.beginPath(); g.moveTo(X + (cx + w * 0.25) * u, Y - h * 0.9 * u); g.lineTo(X + (cx + w * 0.5) * u, Y - h * 0.5 * u); g.lineTo(X + (cx + w) * u, Y); g.lineTo(X + (cx + w * 0.1) * u, Y); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(120,50,20,.45)'; g.lineWidth = Math.max(0.6, 0.6 * u);
      for (let k = 1; k < 4; k++){ const yy = Y - h * k / 4.5 * u; g.beginPath(); g.moveTo(X + (cx - w * (1 - k / 5)) * u, yy); g.lineTo(X + (cx + w * (1 - k / 5)) * u, yy); g.stroke(); }
    };
    spire(-18, 14, 26, '#e0844a', '#b85a2e');
    spire(16, 15, 30, '#d8743a', '#ac4e26');
    spire(0, 16, 40, '#e88c50', '#c0602e');
    g.strokeStyle = '#f2d04a'; g.lineWidth = Math.max(1, 1.2 * u); g.beginPath(); g.moveTo(X - 30 * u, Y - 4 * u); g.bezierCurveTo(X - 10 * u, Y - 14 * u, X + 10 * u, Y + 2 * u, X + 30 * u, Y - 8 * u); g.stroke();
  }

  drawDynamic(t){
    const g = this.g, s = this.s, z = this.zoom;
    g.lineJoin = 'round'; g.lineCap = 'round'; g.textAlign = 'center'; g.textBaseline = 'middle';
    // the way to go
    if (this.route && this.me){
      const x0 = this.sx(this.me.x), y0 = this.sy(this.me.y), x1 = this.sx(this.route.x), y1 = this.sy(this.route.y);
      g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 8; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      g.strokeStyle = '#e0283c'; g.lineWidth = 4.5; g.setLineDash([10, 8]); g.lineDashOffset = -(t / 40) % 18;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); g.setLineDash([]);
    }
    // pins, far ones first, the chosen one on top
    const sel = this.selected;
    const order = [...this.pins].sort((a, b) => (a.id === sel) - (b.id === sel) || b.y - a.y);
    for (const p of order) this.pin(p, p.id === sel, t);
    // you
    if (this.me){
      const X = this.sx(this.me.x), Y = this.sy(this.me.y), col = this.me.practice ? '124,77,255' : '30,120,255';
      if (this.me.acc){ g.beginPath(); g.arc(X, Y, Math.max(10, this.me.acc * s), 0, Math.PI * 2); g.fillStyle = `rgba(${col},.12)`; g.fill(); g.strokeStyle = `rgba(${col},.35)`; g.lineWidth = 1; g.stroke(); }
      if (this.heading !== null && this.heading !== undefined && !this.me.practice){
        // which way you're facing: a soft cone, like a phone's map app
        const a = (this.heading - 90) * Math.PI / 180, cone = g.createRadialGradient(X, Y, 4, X, Y, 46);
        cone.addColorStop(0, `rgba(${col},.55)`); cone.addColorStop(1, `rgba(${col},0)`);
        g.fillStyle = cone; g.beginPath(); g.moveTo(X, Y); g.arc(X, Y, 46, a - 0.5, a + 0.5); g.closePath(); g.fill();
      }
      const k = (t / 1400) % 1;
      g.beginPath(); g.arc(X, Y, 9 + k * 18, 0, Math.PI * 2); g.fillStyle = `rgba(${col},${0.35 * (1 - k)})`; g.fill();
      g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 5;
      g.beginPath(); g.arc(X, Y, 9.5, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.shadowBlur = 0;
      g.beginPath(); g.arc(X, Y, 6.5, 0, Math.PI * 2); g.fillStyle = `rgb(${col})`; g.fill();
      if (this.me.practice){ g.font = '700 11px "Avenir Next","Trebuchet MS",sans-serif'; this.label('you (practice)', X, Y + 22, '#fff', 'rgba(90,50,200,.88)'); }
    }
    // compass and scale, bottom left
    const cx = 30 + (this.safeL || 0), cy = this.H - this.pad.bottom - 34, L = cx + 24;
    g.fillStyle = 'rgba(255,252,240,.92)'; g.shadowColor = 'rgba(0,0,0,.25)'; g.shadowBlur = 4; g.beginPath(); g.arc(cx, cy, 17, 0, 7); g.fill(); g.shadowBlur = 0;
    g.fillStyle = '#e0283c'; g.beginPath(); g.moveTo(cx, cy - 13); g.lineTo(cx + 5, cy); g.lineTo(cx - 5, cy); g.closePath(); g.fill();
    g.fillStyle = '#3a1f6e'; g.beginPath(); g.moveTo(cx, cy + 13); g.lineTo(cx + 5, cy); g.lineTo(cx - 5, cy); g.closePath(); g.fill();
    g.font = '900 9px "Avenir Next",sans-serif'; g.fillStyle = '#fff'; g.fillText('N', cx, cy - 4);
    const m = [25, 50, 100, 200, 500].find((v) => v * s >= 50) || 500, len = m * s;
    g.fillStyle = 'rgba(255,252,240,.9)'; this.rr(L, cy - 9, len + 44, 18, 9); g.fill();
    g.strokeStyle = '#3a1f6e'; g.lineWidth = 2; g.beginPath(); g.moveTo(L + 8, cy - 3); g.lineTo(L + 8, cy + 3); g.lineTo(L + 8 + len, cy + 3); g.lineTo(L + 8 + len, cy - 3); g.stroke();
    g.font = '800 10px "Avenir Next",sans-serif'; g.fillStyle = '#3a1f6e'; g.textAlign = 'left'; g.fillText(m + ' m', L + 12 + len, cy); g.textAlign = 'center';
  }

  // a label on a rounded tag; with avoid, only drawn where it doesn't cover another label or a pin
  label(text, x, y, ink, bg, avoid){
    const g = this.g, w = g.measureText(text).width + 8, h = parseInt(g.font.match(/(\d+(\.\d+)?)px/)[1], 10) + 5;
    const box = [x - w / 2, y - h / 2, w, h];
    if (avoid){
      if (this.placed.some((b) => box[0] < b[0] + b[2] && box[0] + box[2] > b[0] && box[1] < b[1] + b[3] && box[1] + box[3] > b[1])) return false;
      this.placed.push(box);
    }
    g.fillStyle = bg; this.rr(box[0], box[1], w, h, h / 2); g.fill();
    g.fillStyle = ink; g.fillText(text, x, y + 0.5);
    return true;
  }
  pinScale(){ return clamp(0.62 + 0.22 * this.zoom, 0.72, 1.1); }
  pinLabels(){ return this.zoom >= 2.6; }
  rr(x, y, w, h, r){ const g = this.g; g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

  // a map pin: a drop with a restroom sign in it; green with a tick once found; gold rim if themed
  pin(p, selected, t){
    const g = this.g, X = this.sx(p.x), Y = this.sy(p.y);
    if (X < -40 || X > this.W + 40 || Y < -60 || Y > this.H + 40) return;
    const k = (selected ? 1.35 + 0.08 * Math.sin(t / 180) : 1) * this.pinScale(), r = 13 * k, cy = Y - 18 * k;
    g.save();
    g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 6; g.shadowOffsetY = 2;
    g.beginPath(); g.moveTo(X, Y); g.lineTo(X - r * 0.62, cy + r * 0.72); g.arc(X, cy, r, Math.PI * 0.78, Math.PI * 0.22); g.closePath();
    const fill = p.found ? '#25a24a' : p.custom ? '#8a5ad8' : '#ffffff';
    g.fillStyle = fill; g.fill(); g.restore();
    g.lineWidth = p.themed ? 3.5 : 2; g.strokeStyle = p.themed ? '#e8a810' : (p.found ? '#137a33' : '#2b5fc8'); g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (p.found){ g.fillStyle = '#fff'; g.font = `900 ${15 * k}px "Avenir Next",sans-serif`; g.fillText('✓', X, cy + 1); }
    else { g.font = `${13 * k}px "Apple Color Emoji","Noto Color Emoji","Segoe UI Emoji",sans-serif`; g.fillText('🚻', X, cy + 1); }
    if (selected || this.pinLabels()){
      g.font = `800 ${selected ? 13 : 11}px "Avenir Next","Trebuchet MS",sans-serif`;
      this.label(p.name, X, Y + 9, selected ? '#fff' : '#1a2a4a', selected ? 'rgba(30,60,140,.92)' : 'rgba(255,255,255,.88)');
    }
  }
}

// is a point inside a polygon ([[x, y], ...])?
function inPoly(x, y, pts){
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++){
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
