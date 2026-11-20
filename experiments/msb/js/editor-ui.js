// The photo editor's controls. One EditSession holds the picture, its edits, the undo history and the
// tool settings; it is drawn two ways: as a full-screen HTML editor on a screen (sliders, pinch and
// drag on the picture), and as a VR panel (buttons, point and pull the trigger on the picture to draw
// or place stickers). Every tool works in both.
import { ADJUST, FILTERS, ASPECTS, COLORS, BRUSHES, SIZES, SEL_FX, BACKDROPS, STICKERS, FONTS, TEXT_STYLES, CAPTIONS, BORDERS, newState, clone, render, settleCrop, bake, editsUsed, hasSel, selectionMask, cutOut, paintBackdrop } from './editor.js';
import { FRAMES } from './gallery.js';

const $ = (id) => document.getElementById(id);
export const TABS = [
  { id: 'crop', name: 'Crop', icon: '✂️' }, { id: 'filter', name: 'Filters', icon: '🎨' }, { id: 'adjust', name: 'Adjust', icon: '🎚' },
  { id: 'select', name: 'Select', icon: '🪄' }, { id: 'draw', name: 'Draw', icon: '✏️' }, { id: 'sticker', name: 'Stickers', icon: '😀' }, { id: 'text', name: 'Text', icon: '🔤' }, { id: 'frame', name: 'Frame', icon: '🖼' },
];
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

export class EditSession {
  constructor(src, { frames = ['wood', 'black'], onDone, onCancel, onChange } = {}){
    this.src = src;
    this.s = newState();
    this.hist = [clone(this.s)]; this.hi = 0;
    this.tab = 'filter';
    this.adjSel = 'bright';
    this.brush = { brush: 'pen', color: '#ff3b30', size: 0.018, alpha: 1 };
    this.selMode = 'magic'; this.tol = 30; this.lassoLive = null;
    this.cuts = [];   // pictures cut out of the photo, used as stickers (the state refers to them by number)
    this.stickerSel = -1;
    this.frames = frames;
    this.onDone = onDone; this.onCancel = onCancel; this.onChange = onChange;
    this.preview = document.createElement('canvas');
    this.rect = { x: 0, y: 0, w: 1, h: 1 };
    this.thumbs = null;
    this.comparing = false;
  }
  // ---- history ----
  commit(){
    const j = JSON.stringify(this.s);
    if (j === JSON.stringify(this.hist[this.hi])) return;
    this.hist = this.hist.slice(0, this.hi + 1); this.hist.push(JSON.parse(j)); this.hi = this.hist.length - 1;
    if (this.hist.length > 60){ this.hist.shift(); this.hi--; }
    this.changed(true);
  }
  undo(){ if (this.hi > 0){ this.hi--; this.s = clone(this.hist[this.hi]); this.stickerSel = -1; this.changed(true); } }
  redo(){ if (this.hi < this.hist.length - 1){ this.hi++; this.s = clone(this.hist[this.hi]); this.changed(true); } }
  get canUndo(){ return this.hi > 0; }
  get canRedo(){ return this.hi < this.hist.length - 1; }
  set(fn, commit = true){ fn(this.s); if (commit) this.commit(); else this.changed(false); }
  changed(crop){ if (crop) this.thumbs = null; if (this.onChange) this.onChange(this); }
  // ---- drawing the picture ----
  draw(max = 720){ this.rect = render(this.src, this.s, this.preview, max, { plain: this.comparing, cuts: this.cuts }); return this.preview; }
  filterThumbs(){
    if (this.thumbs) return this.thumbs;
    const base = document.createElement('canvas');
    const st = { ...newState(), rot: this.s.rot, flip: this.s.flip, aspect: this.s.aspect, zoom: this.s.zoom, cx: this.s.cx, cy: this.s.cy, angle: this.s.angle };
    render(this.src, st, base, 128, { plain: true });
    this.thumbs = {};
    for (const F of FILTERS){ const c = document.createElement('canvas'); render(base, { ...newState(), filter: F.id, strength: 100 }, c, 104); this.thumbs[F.id] = c; }
    return this.thumbs;
  }
  // ---- the tools ----
  setTab(t){ this.tab = t; this.stickerSel = -1; this.changed(false); }
  rotate(d){ this.set((s) => { s.rot = (s.rot + d + 4) % 4; s.cx = s.cy = 0.5; }); }
  flip(){ this.set((s) => { s.flip = !s.flip; s.cx = 1 - s.cx; }); }
  aspect(id){ this.set((s) => { s.aspect = id; settleCrop(this.src, s); }); }
  zoom(z, commit = true){ this.set((s) => { s.zoom = clampN(z, 1, 4); settleCrop(this.src, s); }, commit); }
  straighten(a, commit = true){ this.set((s) => { s.angle = clampN(a, -20, 20); }, commit); }
  pan(dx, dy, commit = true){ this.set((s) => { s.cx += dx; s.cy += dy; settleCrop(this.src, s); }, commit); }
  resetCrop(){ this.set((s) => { Object.assign(s, { rot: 0, flip: false, aspect: 'free', zoom: 1, cx: 0.5, cy: 0.5, angle: 0 }); }); }
  filter(id){ this.set((s) => { s.filter = id; if (id !== 'none' && s.strength < 20) s.strength = 100; }); }
  strength(v, commit = true){ this.set((s) => { s.strength = clampN(v, 0, 100); }, commit); }
  adj(id, v, commit = true){ const A = ADJUST.find((a) => a.id === id); this.set((s) => { s.adj[id] = clampN(Math.round(v), A.min, A.max); }, commit); }
  resetAdjust(){ this.set((s) => { for (const A of ADJUST) s.adj[A.id] = 0; }); }
  auto(){
    // a quick "make it pop": a bit more contrast, colour and sharpness, judged from the picture
    const c = document.createElement('canvas'); render(this.src, { ...this.s, filter: 'none', adj: Object.fromEntries(ADJUST.map((a) => [a.id, 0])), strokes: [], stickers: [], text: { ...this.s.text, str: '' }, border: 'none' }, c, 64);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let L = 0, n = 0; for (let i = 0; i < d.length; i += 4){ L += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; n++; }
    L /= n;
    this.set((s) => { s.adj.bright = clampN(Math.round((128 - L) / 2.2), -40, 40); s.adj.contrast = 18; s.adj.sat = 22; s.adj.sharpen = 25; s.adj.shadows = L < 100 ? 25 : 8; s.adj.highlights = L > 160 ? -20 : 0; });
  }
  // drawing, stickers and words, by pointing at the picture (u, v: 0..1 across the whole preview)
  point(u, v, phase){
    const R = this.rect, pu = (u - R.x) / R.w, pv = (v - R.y) / R.h;
    const s = this.s;
    if (this.tab === 'draw'){
      if (phase === 'down'){ s.strokes.push({ ...this.brush, pts: [[pu, pv]] }); this.changed(false); }
      else if (phase === 'move'){ const st = s.strokes[s.strokes.length - 1]; if (st){ const L = st.pts[st.pts.length - 1]; if (Math.hypot(pu - L[0], pv - L[1]) > 0.003){ st.pts.push([pu, pv]); this.changed(false); } } }
      else this.commit();
      return true;
    }
    if (this.tab === 'select'){
      if (this.selMode === 'magic'){
        if (phase === 'down' && pu >= 0 && pu <= 1 && pv >= 0 && pv <= 1){ this.set((st) => { st.sel.magic.push({ u: pu, v: pv, tol: this.tol }); if (st.sel.magic.length > 12) st.sel.magic.shift(); }); }
        return true;
      }
      // lasso: draw round it
      const P = [clampN(pu, 0, 1), clampN(pv, 0, 1)];
      if (phase === 'down'){ this.lassoLive = [P]; this.changed(false); }
      else if (phase === 'move' && this.lassoLive){ const L = this.lassoLive[this.lassoLive.length - 1]; if (Math.hypot(P[0] - L[0], P[1] - L[1]) > 0.006){ this.lassoLive.push(P); this.changed(false); } }
      else if (this.lassoLive){
        const poly = this.lassoLive; this.lassoLive = null;
        if (poly.length >= 3) this.set((st) => { st.sel.lasso.push(poly.map((q) => [+q[0].toFixed(4), +q[1].toFixed(4)])); });
        else this.changed(false);
      }
      return true;
    }
    if (this.tab === 'sticker'){
      if (phase === 'down'){
        // grab the nearest sticker under the pointer, or place the chosen one there
        let best = -1, bd = 1e9;
        s.stickers.forEach((k, i) => { const d = Math.hypot(k.u - pu, (k.v - pv) * (R.h / R.w)); if (d < k.s * 0.6 && d < bd){ bd = d; best = i; } });
        if (best >= 0){ this.stickerSel = best; this.grab = [pu - s.stickers[best].u, pv - s.stickers[best].v]; }
        else if (this.placeSticker){ s.stickers.push({ e: this.placeSticker, u: pu, v: pv, s: 0.2, r: 0 }); this.stickerSel = s.stickers.length - 1; this.grab = [0, 0]; }
        else { this.stickerSel = -1; this.grab = null; }
        this.changed(false);
      } else if (phase === 'move' && this.stickerSel >= 0 && this.grab){ const k = s.stickers[this.stickerSel]; k.u = clampN(pu - this.grab[0], 0, 1); k.v = clampN(pv - this.grab[1], 0, 1); this.changed(false); }
      else if (phase === 'up'){ this.grab = null; this.commit(); }
      return true;
    }
    if (this.tab === 'text' && s.text.str){
      if (phase !== 'up'){ s.text.v = clampN(pv, 0.08, 0.92); this.changed(false); } else this.commit();
      return true;
    }
    return false;
  }
  addSticker(e){ this.placeSticker = e; this.set((s) => { s.stickers.push({ e, u: 0.5 + (Math.random() - 0.5) * 0.2, v: 0.5 + (Math.random() - 0.5) * 0.2, s: 0.22, r: 0 }); }); this.stickerSel = this.s.stickers.length - 1; this.changed(false); }
  stickerSize(k, commit = true){ const st = this.s.stickers[this.stickerSel]; if (!st) return; this.set(() => { st.s = clampN(k, 0.05, 0.9); }, commit); }
  stickerTurn(r, commit = true){ const st = this.s.stickers[this.stickerSel]; if (!st) return; this.set(() => { st.r = r; }, commit); }
  stickerDelete(){ if (this.stickerSel < 0) return; const i = this.stickerSel; this.stickerSel = -1; this.set((s) => { s.stickers.splice(i, 1); }); }
  text(fn, commit = true){ this.set((s) => fn(s.text), commit); }
  // the selection
  setSelMode(m){ this.selMode = m; this.changed(false); }
  selFx(id){ this.set((s) => { s.selFx = id; }); }
  selBg(bg){ this.set((s) => { s.selBg = bg; if (s.selFx !== 'cut') s.selFx = 'cut'; }); }
  selInvert(){ this.set((s) => { s.sel.invert = !s.sel.invert; }); }
  selClear(){ this.set((s) => { s.sel = { lasso: [], magic: [], invert: false }; s.selFx = 'none'; }); }
  selUndoLast(){ this.set((s) => { if (s.sel.magic.length && (!s.sel.lasso.length || this.selMode === 'magic')) s.sel.magic.pop(); else s.sel.lasso.pop(); }); }
  setTol(t){ this.tol = t; const m = this.s.sel.magic; if (m.length){ this.set((s) => { s.sel.magic[s.sel.magic.length - 1].tol = t; }, false); } }
  // the selected thing becomes a sticker you can move, size and copy
  copyAsSticker(){
    if (!hasSel(this.s)) return false;
    const c = cutOut(this.src, this.s, this.cuts);
    if (!c) return false;
    this.cuts.push(c.canvas);
    const n = this.cuts.length - 1;
    this.set((s) => { s.stickers.push({ cut: n, e: '', u: clampN(c.u + 0.08, 0, 1), v: clampN(c.v + 0.05, 0, 1), s: Math.max(0.08, c.w), r: 0 }); });
    this.tab = 'sticker'; this.stickerSel = this.s.stickers.length - 1; this.changed(false);
    return true;
  }
  done(){
    const out = bake(this.src, this.s, 1024, this.cuts);
    if (this.onDone) this.onDone(out, clone(this.s), editsUsed(this.s));
  }
  cancel(){ if (this.onCancel) this.onCancel(); }
}

// ================= on screen: the full-screen HTML editor =================
export class HtmlEditor {
  constructor(){
    this.el = $('editor');
    this.cv = $('ed-canvas');
    this.sess = null;
    this.raf = 0;
    this.pointers = new Map();
    this.view = { k: 1, x: 0, y: 0 };   // zooming in to look closer (pinch, or the 🔍 buttons): only the view, not the picture
    this.cursor = null;
    const cv = this.cv, stage = $('ed-stage');
    // the whole stage takes touches, so you can pinch and draw starting just outside the picture too
    stage.addEventListener('pointerdown', (e) => this.down(e));
    stage.addEventListener('pointermove', (e) => this.move(e));
    const up = (e) => this.up(e);
    stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up); stage.addEventListener('lostpointercapture', up);
    stage.addEventListener('pointerleave', () => { if (this.cursor && !this.pointers.size){ this.cursor = null; this.paint(); } });
    stage.addEventListener('wheel', (e) => { if (!this.sess) return; e.preventDefault(); this.zoomView(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); }, { passive: false });
    for (const ev of ['gesturestart', 'gesturechange']) stage.addEventListener(ev, (e) => e.preventDefault());
    $('ed-zin').onclick = () => this.zoomView(1.4);
    $('ed-zout').onclick = () => this.zoomView(1 / 1.4);
    $('ed-zfit').onclick = () => this.resetView();
    $('ed-cancel').onclick = () => { if (this.sess && (!this.sess.canUndo || confirm('Throw this photo away?'))) this.sess.cancel(); };
    $('ed-undo').onclick = () => this.sess && this.sess.undo();
    $('ed-redo').onclick = () => this.sess && this.sess.redo();
    $('ed-done').onclick = () => this.sess && this.sess.done();
    const cmp = $('ed-compare');
    const cmpOn = (on) => { if (!this.sess) return; this.sess.comparing = on; cmp.classList.toggle('on', on); this.paint(); };
    cmp.addEventListener('pointerdown', (e) => { e.preventDefault(); cmpOn(true); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) cmp.addEventListener(ev, () => cmpOn(false));
    addEventListener('resize', () => { if (this.sess) this.paint(); });
    void cv;
  }
  open(sess){
    this.sess = sess;
    sess.onChange = () => this.refresh();
    this.el.classList.add('show');
    this.trayKey = null; $('ed-tabs').dataset.tab = '';   // a new photo: build the controls afresh
    this.sliding = false;
    this.resetView(false);
    this.refresh();
  }
  close(){ this.el.classList.remove('show'); this.sess = null; this.pointers.clear(); }
  get isOpen(){ return !!this.sess; }
  // ---- looking closer ----
  applyView(){
    const v = this.view;
    this.cv.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.k})`;
    $('ed-zoom').classList.toggle('zoomed', v.k > 1.01);
    $('ed-zlabel').textContent = Math.round(v.k * 100) + '%';
  }
  resetView(paint = true){ this.view = { k: 1, x: 0, y: 0 }; this.applyView(); if (paint) this.paint(); }
  zoomView(f, cx, cy){
    const v = this.view, st = $('ed-stage').getBoundingClientRect();
    if (cx === undefined){ cx = st.left + st.width / 2; cy = st.top + st.height / 2; }
    const k = clampN(v.k * f, 1, 8); f = k / v.k;
    // keep the point under the fingers where it is
    const ox = st.left + st.width / 2, oy = st.top + st.height / 2;
    v.x = (v.x - (cx - ox)) * f + (cx - ox); v.y = (v.y - (cy - oy)) * f + (cy - oy); v.k = k;
    this.clampView(); this.applyView();
  }
  clampView(){
    const v = this.view, st = $('ed-stage').getBoundingClientRect();
    const w = parseFloat(this.cv.style.width) || st.width, h = parseFloat(this.cv.style.height) || st.height;
    const mx = Math.max(0, (w * v.k - st.width) / 2 + 40), my = Math.max(0, (h * v.k - st.height) / 2 + 40);
    if (v.k <= 1.001){ v.x = v.y = 0; }
    v.x = clampN(v.x, -mx, mx); v.y = clampN(v.y, -my, my);
  }
  refresh(){
    const S = this.sess; if (!S) return;
    $('ed-undo').disabled = !S.canUndo; $('ed-redo').disabled = !S.canRedo;
    this.tabs();
    this.tray();
    this.paint();
  }
  paint(){
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.paintNow(); });
  }
  paintNow(){
    const S = this.sess; if (!S) return;
    const area = $('ed-stage').getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const max = Math.round(Math.min(1100, Math.max(area.width, area.height) * dpr));
    const pic = S.draw(Math.max(320, Math.min(max, 900)));
    const cv = this.cv;
    if (cv.width !== pic.width || cv.height !== pic.height){ cv.width = pic.width; cv.height = pic.height; }
    const g = cv.getContext('2d'); g.drawImage(pic, 0, 0);
    const R = S.rect, X = (u) => (R.x + u * R.w) * cv.width, Y = (v) => (R.y + v * R.h) * cv.height;
    if (!S.comparing){
      if (S.tab === 'select') drawSelection(g, S, cv, this);
      // show which sticker is picked
      if (S.tab === 'sticker' && S.stickerSel >= 0){
        const k = S.s.stickers[S.stickerSel];
        if (k){ const x = X(k.u), y = Y(k.v), r = k.s * R.w * cv.width * 0.62; g.save(); g.setLineDash([10, 8]); g.lineWidth = 4; g.strokeStyle = '#ffcf4a'; g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke(); g.restore(); }
      }
      // the brush: a ring the size it will draw
      if (S.tab === 'draw' && this.cursor){
        const b = S.brush, mult = b.brush === 'marker' ? 1.6 : b.brush === 'highlight' ? 2.4 : b.brush === 'pencil' ? 0.6 : b.brush === 'spray' ? 3.2 : 1;
        const r = Math.max(2, b.size * mult * R.w * cv.width / 2);
        g.save(); g.lineWidth = Math.max(1.5, cv.width / 500);
        g.strokeStyle = 'rgba(0,0,0,0.7)'; g.beginPath(); g.arc(this.cursor[0] * cv.width, this.cursor[1] * cv.height, r + 1, 0, 7); g.stroke();
        g.strokeStyle = b.brush === 'eraser' ? '#fff' : b.color; g.beginPath(); g.arc(this.cursor[0] * cv.width, this.cursor[1] * cv.height, r, 0, 7); g.stroke();
        g.restore();
      }
    }
    const k = Math.min(area.width / pic.width, area.height / pic.height);
    cv.style.width = Math.round(pic.width * k) + 'px'; cv.style.height = Math.round(pic.height * k) + 'px';
  }
  uv(e){ const r = this.cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; }
  // what two fingers do: in Crop they zoom the crop, with a sticker or words picked they size it, otherwise they zoom the view
  twoFingerMode(){ const S = this.sess; if (S.tab === 'crop') return 'crop'; if (S.tab === 'sticker' && S.stickerSel >= 0) return 'sticker'; if (S.tab === 'text' && S.s.text.str) return 'text'; return 'view'; }
  down(e){
    const S = this.sess; if (!S) return;
    if (e.target.closest && e.target.closest('#ed-zoom')) return;
    e.preventDefault();
    try { $('ed-stage').setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
    const [u, v] = this.uv(e);
    this.pointers.set(e.pointerId, { u, v, x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2){
      // a second finger: whatever the first one started is undone, and the two fingers pinch instead
      if (this.drawing){ this.drawing = false; if (S.tab === 'draw' && S.s.strokes.length){ S.s.strokes.pop(); S.changed(false); } if (S.tab === 'select'){ S.lassoLive = null; S.changed(false); } }
      this.panFrom = null;
      this.pinch = this.pinchState(); return;
    }
    if (this.pointers.size > 2) return;
    // middle mouse or space-drag pans a zoomed view
    if (e.button === 1 || e.button === 2){ this.viewPan = { x: e.clientX, y: e.clientY }; return; }
    if (S.tab === 'crop'){ this.panFrom = { u, v, cx: S.s.cx, cy: S.s.cy }; return; }
    if (S.tab === 'draw') this.cursor = [u, v];
    if (S.point(u, v, 'down')) this.drawing = true;
  }
  pinchState(){
    const [a, b] = [...this.pointers.values()], S = this.sess, st = S.s.stickers[S.stickerSel];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, zoom: S.s.zoom, ss: st ? st.s : 0, sr: st ? st.r : 0, size: S.s.text.size, mode: this.twoFingerMode() };
  }
  move(e){
    const S = this.sess; if (!S) return;
    const P = this.pointers.get(e.pointerId);
    if (!P){
      // a mouse hovering: show the brush ring
      if (e.pointerType === 'mouse' && S.tab === 'draw' && e.target === this.cv){ this.cursor = this.uv(e); this.paint(); }
      return;
    }
    const [u, v] = this.uv(e); P.u = u; P.v = v; P.x = e.clientX; P.y = e.clientY;
    if (this.pointers.size >= 2 && this.pinch){
      const [a, b] = [...this.pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y), k = d / Math.max(10, this.pinch.d), ang = Math.atan2(b.y - a.y, b.x - a.x) - this.pinch.ang;
      const mode = this.pinch.mode;
      if (mode === 'crop') S.zoom(this.pinch.zoom * k, false);
      else if (mode === 'sticker'){ S.stickerSize(this.pinch.ss * k, false); S.stickerTurn(this.pinch.sr + ang, false); }
      else if (mode === 'text') S.text((t) => { t.size = clampN(this.pinch.size * k, 0.04, 0.3); }, false);
      else {
        // zoom the view about the fingers, and move it with them
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        this.view.x += mx - this.pinch.mx; this.view.y += my - this.pinch.my;
        this.zoomView(k, mx, my);
        this.pinch.d = d; this.pinch.mx = mx; this.pinch.my = my;
      }
      return;
    }
    if (this.viewPan){ this.view.x += e.clientX - this.viewPan.x; this.view.y += e.clientY - this.viewPan.y; this.viewPan = { x: e.clientX, y: e.clientY }; this.clampView(); this.applyView(); return; }
    if (S.tab === 'crop' && this.panFrom){
      const R = S.rect, z = S.s.zoom;
      S.pan(-(u - this.panFrom.u) / R.w / z - (S.s.cx - this.panFrom.cx), -(v - this.panFrom.v) / R.h / z - (S.s.cy - this.panFrom.cy), false);
      return;
    }
    if (S.tab === 'draw'){ this.cursor = [u, v]; if (!this.drawing) this.paint(); }
    if (this.drawing) S.point(u, v, 'move');
  }
  up(e){
    const S = this.sess; if (!S || !this.pointers.has(e.pointerId)) return;
    const P = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.pinch){ if (this.pointers.size < 2){ const m = this.pinch.mode; this.pinch = null; if (m !== 'view') S.commit(); } return; }
    if (this.viewPan){ this.viewPan = null; return; }
    if (S.tab === 'crop' && this.panFrom){ this.panFrom = null; S.commit(); return; }
    if (this.drawing){ this.drawing = false; S.point(P.u, P.v, 'up'); }
    if (e.pointerType !== 'mouse' && this.cursor){ this.cursor = null; this.paint(); }
  }
  tabs(){
    const S = this.sess, box = $('ed-tabs');
    if (box.dataset.tab === S.tab && box.children.length) return;
    box.dataset.tab = S.tab; box.innerHTML = '';
    for (const t of TABS){
      const b = document.createElement('button'); b.className = 'etab' + (S.tab === t.id ? ' on' : '');
      b.innerHTML = `<span>${t.icon}</span><small>${t.name}</small>`; b.dataset.tab = t.id;
      b.onclick = () => S.setTab(t.id);
      box.appendChild(b);
    }
  }
  // the controls for the chosen tool (rebuilt when something other than a slider changes)
  tray(){
    const S = this.sess, box = $('ed-tray');
    const key = JSON.stringify([S.tab, S.adjSel, S.stickerSel, S.brush, S.selMode, S.s.aspect, S.s.filter, S.s.frame, S.s.border, S.s.text.font, S.s.text.style, S.s.text.color, S.s.selFx, S.s.selBg, S.hi, S.thumbs ? 1 : 0, S.frames]);
    if (this.sliding) return;
    if (this.trayKey === key) return;
    this.trayKey = key;
    const scroll = box.scrollTop;
    box.innerHTML = '';
    const row = (cls = '') => { const d = document.createElement('div'); d.className = 'erow ' + cls; box.appendChild(d); return d; };
    const label = (t) => { const r = row('label'); r.textContent = t; };
    const btn = (parent, html, go, on = false, cls = '') => { const b = document.createElement('button'); b.className = 'ebtn ' + cls + (on ? ' on' : ''); b.innerHTML = html; b.onclick = go; parent.appendChild(b); return b; };
    const slider = (parent, text, min, max, val, step, onInput, fmt = (v) => v) => {
      const w = document.createElement('label'); w.className = 'eslider';
      const t = document.createElement('span'); t.className = 'elabel'; t.textContent = text;
      const r = document.createElement('input'); r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = val;
      const o = document.createElement('span'); o.className = 'eval'; o.textContent = fmt(+val);
      r.addEventListener('input', () => { this.sliding = true; o.textContent = fmt(+r.value); onInput(+r.value, false); });
      r.addEventListener('change', () => { this.sliding = false; onInput(+r.value, true); this.refresh(); });
      r.addEventListener('pointerdown', (e) => e.stopPropagation());
      w.append(t, r, o); parent.appendChild(w); return r;
    };
    const hint = (t) => { const h = row('hint'); h.textContent = t; };
    if (S.tab === 'crop'){
      const a = row('scroll'); for (const A of ASPECTS) btn(a, A.name, () => S.aspect(A.id), S.s.aspect === A.id);
      const b = row(); btn(b, '⟲ Left', () => S.rotate(-1)); btn(b, '⟳ Right', () => S.rotate(1)); btn(b, '⇋ Flip', () => S.flip()); btn(b, '↺ Reset', () => S.resetCrop());
      const c = row('sliders');
      slider(c, '🔍 Zoom', 1, 4, S.s.zoom, 0.01, (v, cm) => S.zoom(v, cm), (v) => v.toFixed(1) + '×');
      slider(c, '📐 Straighten', -20, 20, S.s.angle, 0.5, (v, cm) => S.straighten(v, cm), (v) => v.toFixed(1) + '°');
      hint('Drag the picture to move it · pinch to zoom in');
    } else if (S.tab === 'filter'){
      const th = S.filterThumbs();
      const a = row('scroll thumbs');
      for (const F of FILTERS){
        const b = btn(a, '', () => S.filter(F.id), S.s.filter === F.id, 'thumb');
        const img = new Image(); img.src = th[F.id].toDataURL('image/jpeg', 0.8); b.appendChild(img);
        const sm = document.createElement('small'); sm.textContent = F.name; b.appendChild(sm);
      }
      const c = row('sliders');
      if (S.s.filter !== 'none') slider(c, '💪 Strength', 0, 100, S.s.strength, 1, (v, cm) => S.strength(v, cm), (v) => v + '%');
      else hint('Pick a look, then set how strong it is');
    } else if (S.tab === 'adjust'){
      const a = row('wrap');
      btn(a, '✨ Auto', () => S.auto(), false, 'gold');
      for (const A of ADJUST){ const v = S.s.adj[A.id]; btn(a, `${A.icon} ${A.name}${v ? ` <b>${v > 0 && A.min < 0 ? '+' : ''}${v}</b>` : ''}`, () => { S.adjSel = A.id; this.refresh(); }, S.adjSel === A.id); }
      const A = ADJUST.find((x) => x.id === S.adjSel);
      const c = row('sliders');
      slider(c, `${A.icon} ${A.name}`, A.min, A.max, S.s.adj[A.id], 1, (v, cm) => S.adj(A.id, v, cm), (v) => (v > 0 && A.min < 0 ? '+' : '') + v);
      const b = row(); btn(b, '0 Reset this', () => S.adj(A.id, 0)); btn(b, '↺ Reset all', () => S.resetAdjust());
    } else if (S.tab === 'select'){
      label('1 · Pick something out');
      const a = row();
      btn(a, '🪄 Magic wand', () => S.setSelMode('magic'), S.selMode === 'magic');
      btn(a, '➰ Draw round it', () => S.setSelMode('lasso'), S.selMode === 'lasso');
      if (S.selMode === 'magic'){ const c = row('sliders'); slider(c, '🎯 How fussy', 5, 80, S.tol, 1, (v, cm) => { S.tol = v; S.setTol(v); if (cm) S.commit(); }, (v) => v < 20 ? 'very' : v < 45 ? 'a bit' : 'not very'); }
      hint(S.selMode === 'magic' ? 'Tap the thing you want: it picks out everything that colour round it. Tap more spots to add to it.' : 'Draw a line all the way round the thing you want. Draw again to add more.');
      if (hasSel(S.s)){
        const b = row(); btn(b, '↶ Undo last pick', () => S.selUndoLast()); btn(b, '⇄ Swap (the rest)', () => S.selInvert(), S.s.sel.invert); btn(b, '✕ Clear', () => S.selClear());
        label('2 · What should happen?');
        const c = row('wrap'); for (const F of SEL_FX) btn(c, `${F.icon} ${F.name}`, () => S.selFx(F.id), S.s.selFx === F.id);
        if (S.s.selFx === 'cut'){
          label('New background');
          const d = row('scroll colours');
          for (const bg of BACKDROPS){
            const bt = btn(d, '', () => S.selBg(bg), S.s.selBg === bg, 'swatch');
            if (bg.startsWith('#')) bt.style.background = bg; else { const c2 = document.createElement('canvas'); c2.width = c2.height = 38; paintBackdrop(c2.getContext('2d'), 38, 38, bg); bt.style.background = `url(${c2.toDataURL()})`; }
          }
        }
        const e = row(); btn(e, '📋 Copy it as a sticker', () => { if (!S.copyAsSticker()) alert('Nothing is picked out yet.'); }, false, 'gold');
      }
    } else if (S.tab === 'draw'){
      const a = row('wrap'); for (const B of BRUSHES) btn(a, `${B.icon} ${B.name}`, () => { S.brush.brush = B.id; this.refresh(); }, S.brush.brush === B.id, B.id === 'eraser' ? 'alt' : '');
      label('Size');
      const z = row('sizes');
      for (const Z of SIZES){
        const b = btn(z, '', () => { S.brush.size = Z.v; this.refresh(); }, Math.abs(S.brush.size - Z.v) < 1e-4, 'size');
        const dot = document.createElement('i'); const px = Math.max(3, Math.min(34, Z.v * 520)); dot.style.width = dot.style.height = px + 'px'; dot.style.background = S.brush.brush === 'eraser' ? '#fff' : S.brush.color; b.appendChild(dot);
        const sm = document.createElement('small'); sm.textContent = Z.id; b.appendChild(sm);
      }
      const d = row('sliders');
      slider(d, '◍ Exact size', 2, 80, Math.round(S.brush.size * 1000), 1, (v, cm) => { S.brush.size = v / 1000; if (cm) this.trayKey = null; }, (v) => v);
      if (S.brush.brush !== 'eraser'){
        slider(d, '◐ See-through', 10, 100, Math.round((S.brush.alpha == null ? 1 : S.brush.alpha) * 100), 1, (v) => { S.brush.alpha = v / 100; }, (v) => v + '%');
        label('Colour');
        const c = row('scroll colours');
        for (const col of COLORS){ const b = btn(c, '', () => { S.brush.color = col; this.refresh(); }, S.brush.color === col, 'swatch'); b.style.background = col; }
        const pick = document.createElement('input'); pick.type = 'color'; pick.value = S.brush.color; pick.className = 'epick'; pick.title = 'Any colour';
        pick.addEventListener('input', () => { S.brush.color = pick.value; }); pick.addEventListener('change', () => { S.brush.color = pick.value; this.refresh(); });
        c.appendChild(pick);
      }
      const e = row(); btn(e, '↶ Undo line', () => S.undo()); btn(e, '🧽 Clear drawing', () => S.set((s) => { s.strokes = []; }));
      hint('Draw with one finger · pinch with two to zoom in for the fiddly bits');
    } else if (S.tab === 'sticker'){
      const a = row('scroll stickers'); for (const e of STICKERS) btn(a, e, () => S.addSticker(e), S.placeSticker === e, 'emoji');
      const st = S.s.stickers[S.stickerSel];
      if (st){
        const c = row('sliders');
        slider(c, '↔ Size', 5, 90, Math.round(st.s * 100), 1, (v, cm) => S.stickerSize(v / 100, cm), (v) => v);
        slider(c, '⟳ Turn', -180, 180, Math.round(st.r * 180 / Math.PI), 1, (v, cm) => S.stickerTurn(v * Math.PI / 180, cm), (v) => v + '°');
        const b = row(); btn(b, '🗑 Remove', () => S.stickerDelete()); btn(b, '⧉ Copy', () => { S.set((s) => { s.stickers.push({ ...st, u: clampN(st.u + 0.06, 0, 1), v: clampN(st.v + 0.06, 0, 1) }); }); S.stickerSel = S.s.stickers.length - 1; S.changed(false); });
      } else hint('Tap a sticker to add it · drag it to move · pinch to size and turn · 🪄 Select can make a sticker out of your photo');
    } else if (S.tab === 'text'){
      const a = row('textrow');
      const inp = document.createElement('input'); inp.type = 'text'; inp.maxLength = 40; inp.placeholder = 'Type some words…'; inp.value = S.s.text.str; inp.className = 'etext';
      inp.addEventListener('input', () => { this.sliding = true; S.text((t) => { t.str = inp.value; }, false); });
      inp.addEventListener('change', () => { this.sliding = false; S.commit(); });
      inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') inp.blur(); });
      inp.addEventListener('pointerdown', (e) => e.stopPropagation());
      a.appendChild(inp);
      btn(a, '✕', () => S.text((t) => { t.str = ''; }));
      const q = row('scroll'); for (const c of CAPTIONS) btn(q, c, () => S.text((t) => { t.str = c; }));
      const f = row('wrap'); for (const F of FONTS) btn(f, F.name, () => S.text((t) => { t.font = F.id; }), S.s.text.font === F.id); for (const T of TEXT_STYLES) btn(f, T.name, () => S.text((t) => { t.style = T.id; }), S.s.text.style === T.id, 'alt');
      const c = row('scroll colours'); for (const col of COLORS){ const b = btn(c, '', () => S.text((t) => { t.color = col; }), S.s.text.color === col, 'swatch'); b.style.background = col; }
      const d = row('sliders'); slider(d, 'Aa Size', 4, 30, Math.round(S.s.text.size * 100), 1, (v, cm) => S.text((t) => { t.size = v / 100; }, cm), (v) => v);
      hint('Drag on the picture to move the words up or down');
    } else if (S.tab === 'frame'){
      label('Frame (how it hangs on the wall)');
      const a = row('wrap');
      for (const [id, F] of Object.entries(FRAMES)){
        const own = S.frames.includes(id);
        btn(a, `<i class="fsw" style="background:${F.color}"></i> ${F.name}${own ? '' : ` 🔒 $${F.price}`}`, () => { if (own) S.set((s) => { s.frame = id; }); else alert(`Buy the ${F.name} frame at the 🛒 Art Market to use it.`); }, S.s.frame === id, own ? '' : 'locked');
      }
      label('Mat round the picture');
      const c = row(); for (const B of BORDERS) btn(c, B.name, () => S.set((s) => { s.border = B.id; }), S.s.border === B.id);
    }
    box.scrollTop = scroll;
    // how the frame will look: an outline round the preview in the frame's colour
    const F = FRAMES[S.s.frame] || FRAMES.wood;
    this.cv.style.borderColor = F.color; this.cv.style.boxShadow = F.glow ? `0 0 18px ${F.color}, 0 8px 30px rgba(0,0,0,.5)` : '0 8px 30px rgba(0,0,0,.5)';
  }
}

// ================= in VR: the same editor as a panel =================
// the selection on the preview: the rest of the picture tinted blue, a gold edge round what's picked,
// the lasso being drawn as a dashed line (on screen and on the VR panel)
function drawSelection(g, S, cv, cache){
  const R = S.rect, X = (u) => (R.x + u * R.w) * cv.width, Y = (v) => (R.y + v * R.h) * cv.height;
  if (hasSel(S.s)){
    const m = selectionMask(S.src, S.s), t = cache.tint || (cache.tint = document.createElement('canvas'));
    t.width = Math.round(R.w * cv.width); t.height = Math.round(R.h * cv.height);
    const tg = t.getContext('2d'); tg.fillStyle = 'rgba(30,40,120,0.5)'; tg.fillRect(0, 0, t.width, t.height);
    tg.globalCompositeOperation = 'destination-out'; tg.drawImage(m, 0, 0, t.width, t.height); tg.globalCompositeOperation = 'source-over';
    g.drawImage(t, X(0), Y(0));
    const o = cache.edge || (cache.edge = document.createElement('canvas')); o.width = t.width; o.height = t.height;
    const og = o.getContext('2d'); og.drawImage(m, 0, 0, o.width, o.height); og.globalCompositeOperation = 'source-in'; og.fillStyle = '#ffcf4a'; og.fillRect(0, 0, o.width, o.height);
    og.globalCompositeOperation = 'destination-out'; const e = Math.max(2, cv.width / 300); og.drawImage(m, e, e, o.width - 2 * e, o.height - 2 * e); og.globalCompositeOperation = 'source-over';
    g.drawImage(o, X(0), Y(0));
  }
  if (S.lassoLive && S.lassoLive.length > 1){
    g.save(); g.lineWidth = Math.max(2, cv.width / 260); g.setLineDash([12, 8]);
    for (const [col, off] of [['#111', 0], ['#ffcf4a', 10]]){ g.strokeStyle = col; g.lineDashOffset = off; g.beginPath(); S.lassoLive.forEach((p, k) => (k ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])))); g.stroke(); }
    g.restore();
  }
}
const vrSel = {};

function swatch(col, on){ const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.fillStyle = col; g.beginPath(); g.arc(32, 32, on ? 30 : 24, 0, 7); g.fill(); g.lineWidth = 4; g.strokeStyle = on ? '#ffcf4a' : '#888'; g.stroke(); return c; }
const swatches = new Map();
const sw = (col, on) => { const k = col + on; if (!swatches.has(k)) swatches.set(k, swatch(col, on)); return swatches.get(k); };
const dotIcon = (v, col, on) => { const k = 'd' + v + col + on; if (!swatches.has(k)){ const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.fillStyle = col; g.beginPath(); g.arc(32, 32, Math.max(3, Math.min(30, v * 460)), 0, 7); g.fill(); g.lineWidth = 3; g.strokeStyle = on ? '#ffcf4a' : '#666'; g.stroke(); swatches.set(k, c); } return swatches.get(k); };
const bdIcon = (bg, on) => { const k = 'b' + bg + on; if (!swatches.has(k)){ const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); paintBackdrop(g, 64, 64, bg); g.lineWidth = on ? 8 : 3; g.strokeStyle = on ? '#ffcf4a' : '#666'; g.strokeRect(0, 0, 64, 64); swatches.set(k, c); } return swatches.get(k); };
export function vrEditorSpec(S){
  let pic = S.draw(560);
  if (S.tab === 'select' && (hasSel(S.s) || S.lassoLive)){
    const c = vrSel.pic || (vrSel.pic = document.createElement('canvas')); c.width = pic.width; c.height = pic.height;
    const g = c.getContext('2d'); g.drawImage(pic, 0, 0); drawSelection(g, S, c, vrSel); pic = c;
  }
  const tabs = TABS.map((t) => ({ label: t.icon, sub: t.name, on: S.tab === t.id, go: () => S.setTab(t.id) }));
  const secs = [{ image: pic, vrH: 500, onPoint: (u, v, ph) => S.point(u, v, ph) }, { grid: tabs, cols: 8, cellH: 96 }];
  const step = (label, fn, sub) => ({ label, sub, go: fn });
  if (S.tab === 'crop'){
    secs.push({ grid: ASPECTS.map((A) => ({ label: A.name, on: S.s.aspect === A.id, go: () => S.aspect(A.id) })), cols: 6, cellH: 72 });
    secs.push({ grid: [step('⟲', () => S.rotate(-1), 'turn'), step('⟳', () => S.rotate(1), 'turn'), step('⇋', () => S.flip(), 'flip'), step('🔍−', () => S.zoom(S.s.zoom - 0.25), 'zoom'), step('🔍+', () => S.zoom(S.s.zoom + 0.25), 'zoom'), step('↺', () => S.resetCrop(), 'reset')], cols: 6, cellH: 84 });
    secs.push({ grid: [step('◀', () => S.pan(-0.06, 0), 'move'), step('▲', () => S.pan(0, -0.06), 'move'), step('▼', () => S.pan(0, 0.06), 'move'), step('▶', () => S.pan(0.06, 0), 'move'), step('↶', () => S.straighten(S.s.angle - 2), `${S.s.angle.toFixed(0)}°`), step('↷', () => S.straighten(S.s.angle + 2), 'straighten')], cols: 6, cellH: 84 });
  } else if (S.tab === 'filter'){
    const th = S.filterThumbs();
    secs.push({ grid: FILTERS.map((F) => ({ label: F.name, icon: th[F.id], on: S.s.filter === F.id, go: () => S.filter(F.id) })), cols: 8, cellH: 112 });
    if (S.s.filter !== 'none') secs.push({ buttons: [step('−', () => S.strength(S.s.strength - 20)), { label: `Strength ${S.s.strength}%`, disabled: true, go(){} }, step('+', () => S.strength(S.s.strength + 20))] });
  } else if (S.tab === 'adjust'){
    secs.push({ grid: [{ label: '✨ Auto', go: () => S.auto() }, ...ADJUST.map((A) => ({ label: `${A.icon} ${A.name}`, sub: S.s.adj[A.id] ? String(S.s.adj[A.id]) : '', on: S.adjSel === A.id, go: () => { S.adjSel = A.id; S.changed(false); } }))], cols: 5, cellH: 76 });
    const A = ADJUST.find((x) => x.id === S.adjSel), v = S.s.adj[A.id];
    secs.push({ buttons: [step('−−', () => S.adj(A.id, v - 25)), step('−', () => S.adj(A.id, v - 8)), { label: `${A.name} ${v}`, disabled: true, go(){} }, step('+', () => S.adj(A.id, v + 8)), step('++', () => S.adj(A.id, v + 25)), step('0', () => S.adj(A.id, 0))] });
  } else if (S.tab === 'select'){
    secs.push({ grid: [{ label: '🪄 Magic wand', on: S.selMode === 'magic', go: () => S.setSelMode('magic') }, { label: '➰ Draw round', on: S.selMode === 'lasso', go: () => S.setSelMode('lasso') },
      step('Fussier', () => { S.tol = Math.max(5, S.tol - 10); S.setTol(S.tol); S.commit(); }, `${S.tol}`), step('Looser', () => { S.tol = Math.min(80, S.tol + 10); S.setTol(S.tol); S.commit(); }),
      { label: '↶ Undo pick', disabled: !hasSel(S.s), go: () => S.selUndoLast() }, { label: '⇄ Swap', on: S.s.sel.invert, disabled: !hasSel(S.s), go: () => S.selInvert() }, { label: '✕ Clear', disabled: !hasSel(S.s), go: () => S.selClear() }], cols: 7, cellH: 76 });
    if (hasSel(S.s)){
      secs.push({ grid: [...SEL_FX.map((F) => ({ label: `${F.icon} ${F.name}`, on: S.s.selFx === F.id, go: () => S.selFx(F.id) })), { label: '📋 As sticker', go: () => S.copyAsSticker() }], cols: 7, cellH: 76 });
      if (S.s.selFx === 'cut') secs.push({ grid: BACKDROPS.map((bg) => ({ label: '', icon: bdIcon(bg, S.s.selBg === bg), go: () => S.selBg(bg) })), cols: 10, cellH: 76 });
    } else secs.push({ text: S.selMode === 'magic' ? 'Point at the thing you want and pull the trigger: it picks out everything that colour round it.' : 'Hold the trigger and draw a line all the way round the thing you want.' });
  } else if (S.tab === 'draw'){
    secs.push({ grid: BRUSHES.map((B) => ({ label: `${B.icon} ${B.name}`, on: S.brush.brush === B.id, go: () => { S.brush.brush = B.id; S.changed(false); } })), cols: 8, cellH: 76 });
    secs.push({ grid: SIZES.map((Z) => ({ label: Z.id, icon: dotIcon(Z.v, S.brush.brush === 'eraser' ? '#ffffff' : S.brush.color, Math.abs(S.brush.size - Z.v) < 1e-4), on: Math.abs(S.brush.size - Z.v) < 1e-4, go: () => { S.brush.size = Z.v; S.changed(false); } })), cols: 5, cellH: 96 });
    secs.push({ grid: COLORS.map((c) => ({ label: '', icon: sw(c, S.brush.color === c), go: () => { S.brush.color = c; S.changed(false); } })), cols: 11, cellH: 76 });
    secs.push({ text: 'Point at the picture and hold the trigger to draw.' });
  } else if (S.tab === 'sticker'){
    secs.push({ grid: STICKERS.map((e) => ({ label: e, on: S.placeSticker === e, go: () => S.addSticker(e) })), cols: 12, cellH: 72 });
    if (S.stickerSel >= 0){ const st = S.s.stickers[S.stickerSel]; secs.push({ buttons: [step('Smaller', () => S.stickerSize(st.s * 0.8)), step('Bigger', () => S.stickerSize(st.s * 1.25)), step('⟲', () => S.stickerTurn(st.r - 0.3)), step('⟳', () => S.stickerTurn(st.r + 0.3)), { label: '🗑', kind: 'danger', go: () => S.stickerDelete() }] }); }
    else secs.push({ text: 'Pick a sticker, then point at the picture and pull the trigger to put it there (or drag one to move it).' });
  } else if (S.tab === 'text'){
    secs.push({ grid: [...CAPTIONS.map((c) => ({ label: c, on: S.s.text.str === c, go: () => S.text((t) => { t.str = c; }) })), { label: '✕ No words', go: () => S.text((t) => { t.str = ''; }) }], cols: 3, cellH: 64 });
    secs.push({ grid: [...FONTS.map((F) => ({ label: F.name, on: S.s.text.font === F.id, go: () => S.text((t) => { t.font = F.id; }) })), ...TEXT_STYLES.map((T) => ({ label: T.name, on: S.s.text.style === T.id, go: () => S.text((t) => { t.style = T.id; }) }))], cols: 8, cellH: 64 });
    secs.push({ grid: [...COLORS.map((c) => ({ label: '', icon: sw(c, S.s.text.color === c), go: () => S.text((t) => { t.color = c; }) })), step('A−', () => S.text((t) => { t.size = Math.max(0.04, t.size * 0.8); })), step('A+', () => S.text((t) => { t.size = Math.min(0.3, t.size * 1.25); }))], cols: 13, cellH: 70 });
  } else if (S.tab === 'frame'){
    secs.push({ grid: Object.entries(FRAMES).map(([id, F]) => ({ label: F.name, sub: S.frames.includes(id) ? '' : `🔒 $${F.price}`, icon: sw(F.color, S.s.frame === id), on: S.s.frame === id, disabled: !S.frames.includes(id), go: () => S.set((s) => { s.frame = id; }) })), cols: 6, cellH: 110 });
    secs.push({ grid: BORDERS.map((B) => ({ label: B.name, on: S.s.border === B.id, go: () => S.set((s) => { s.border = B.id; }) })), cols: 4, cellH: 66 });
  }
  secs.push({ buttons: [{ label: '↶ Undo', disabled: !S.canUndo, go: () => S.undo() }, { label: '↷ Redo', disabled: !S.canRedo, go: () => S.redo() }, { label: '✕ Bin it', kind: 'danger', go: () => S.cancel() }, { label: '✓ Done', kind: 'primary', go: () => S.done() }] });
  return { title: '🎨 Edit your photo', sections: secs, editor: true };
}
