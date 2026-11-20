// The photo editor's controls. One EditSession holds the picture, its edits, the undo history and the
// tool settings; it is drawn two ways: as a full-screen HTML editor on a screen (sliders, pinch and
// drag on the picture), and as a VR panel (buttons, point and pull the trigger on the picture to draw
// or place stickers). Every tool works in both.
import { ADJUST, FILTERS, ASPECTS, COLORS, BRUSHES, STICKERS, FONTS, TEXT_STYLES, CAPTIONS, BORDERS, newState, clone, render, settleCrop, bake, editsUsed } from './editor.js';
import { FRAMES } from './gallery.js';

const $ = (id) => document.getElementById(id);
export const TABS = [
  { id: 'crop', name: 'Crop', icon: '✂️' }, { id: 'filter', name: 'Filters', icon: '🎨' }, { id: 'adjust', name: 'Adjust', icon: '🎚' },
  { id: 'draw', name: 'Draw', icon: '✏️' }, { id: 'sticker', name: 'Stickers', icon: '😀' }, { id: 'text', name: 'Text', icon: '🔤' }, { id: 'frame', name: 'Frame', icon: '🖼' },
];
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

export class EditSession {
  constructor(src, { frames = ['wood', 'black'], onDone, onCancel, onChange } = {}){
    this.src = src;
    this.s = newState();
    this.hist = [clone(this.s)]; this.hi = 0;
    this.tab = 'filter';
    this.adjSel = 'bright';
    this.brush = { brush: 'pen', color: '#ff3b30', size: 0.012 };
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
  draw(max = 720){ this.rect = render(this.src, this.s, this.preview, max, { plain: this.comparing }); return this.preview; }
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
  done(){
    const out = bake(this.src, this.s, 1024);
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
    const cv = this.cv;
    cv.addEventListener('pointerdown', (e) => this.down(e));
    cv.addEventListener('pointermove', (e) => this.move(e));
    const up = (e) => this.up(e);
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up); cv.addEventListener('lostpointercapture', up);
    $('ed-cancel').onclick = () => { if (this.sess && (!this.sess.canUndo || confirm('Throw this photo away?'))) this.sess.cancel(); };
    $('ed-undo').onclick = () => this.sess && this.sess.undo();
    $('ed-redo').onclick = () => this.sess && this.sess.redo();
    $('ed-done').onclick = () => this.sess && this.sess.done();
    const cmp = $('ed-compare');
    const cmpOn = (on) => { if (!this.sess) return; this.sess.comparing = on; cmp.classList.toggle('on', on); this.paint(); };
    cmp.addEventListener('pointerdown', (e) => { e.preventDefault(); cmpOn(true); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) cmp.addEventListener(ev, () => cmpOn(false));
    addEventListener('resize', () => { if (this.sess) this.paint(); });
  }
  open(sess){
    this.sess = sess;
    sess.onChange = () => this.refresh();
    this.el.classList.add('show');
    this.trayKey = null; $('ed-tabs').dataset.tab = '';   // a new photo: build the controls afresh
    this.sliding = false;
    this.refresh();
  }
  close(){ this.el.classList.remove('show'); this.sess = null; this.pointers.clear(); }
  get isOpen(){ return !!this.sess; }
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
    // show which sticker is picked
    if (S.tab === 'sticker' && S.stickerSel >= 0 && !S.comparing){
      const k = S.s.stickers[S.stickerSel], R = S.rect, x = (R.x + k.u * R.w) * cv.width, y = (R.y + k.v * R.h) * cv.height, r = k.s * R.w * cv.width * 0.62;
      g.save(); g.setLineDash([10, 8]); g.lineWidth = 4; g.strokeStyle = '#ffcf4a'; g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke(); g.restore();
    }
    const k = Math.min(area.width / pic.width, area.height / pic.height);
    cv.style.width = Math.round(pic.width * k) + 'px'; cv.style.height = Math.round(pic.height * k) + 'px';
  }
  uv(e){ const r = this.cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; }
  down(e){
    const S = this.sess; if (!S) return;
    e.preventDefault();
    try { this.cv.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
    const [u, v] = this.uv(e);
    this.pointers.set(e.pointerId, { u, v, x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2){ this.pinch = this.pinchState(); if (S.tab === 'draw' && S.s.strokes.length && this.drawing){ S.s.strokes.pop(); this.drawing = false; } return; }
    if (S.tab === 'crop'){ this.panFrom = { u, v, cx: S.s.cx, cy: S.s.cy }; return; }
    if (S.point(u, v, 'down')) this.drawing = true;
  }
  pinchState(){
    const [a, b] = [...this.pointers.values()], S = this.sess, st = S.s.stickers[S.stickerSel];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), zoom: S.s.zoom, ss: st ? st.s : 0, sr: st ? st.r : 0, size: S.s.text.size };
  }
  move(e){
    const S = this.sess; const P = this.pointers.get(e.pointerId); if (!S || !P) return;
    const [u, v] = this.uv(e); P.u = u; P.v = v; P.x = e.clientX; P.y = e.clientY;
    if (this.pointers.size >= 2 && this.pinch){
      const [a, b] = [...this.pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y), k = d / Math.max(10, this.pinch.d), ang = Math.atan2(b.y - a.y, b.x - a.x) - this.pinch.ang;
      if (S.tab === 'crop') S.zoom(this.pinch.zoom * k, false);
      else if (S.tab === 'sticker' && S.stickerSel >= 0){ S.stickerSize(this.pinch.ss * k, false); S.stickerTurn(this.pinch.sr + ang, false); }
      else if (S.tab === 'text') S.text((t) => { t.size = clampN(this.pinch.size * k, 0.04, 0.3); }, false);
      return;
    }
    if (S.tab === 'crop' && this.panFrom){
      const R = S.rect, z = S.s.zoom;
      S.pan(-(u - this.panFrom.u) / R.w / z - (S.s.cx - this.panFrom.cx), -(v - this.panFrom.v) / R.h / z - (S.s.cy - this.panFrom.cy), false);
      return;
    }
    if (this.drawing) S.point(u, v, 'move');
  }
  up(e){
    const S = this.sess; if (!S || !this.pointers.has(e.pointerId)) return;
    const P = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.pinch){ if (this.pointers.size < 2){ this.pinch = null; S.commit(); } return; }
    if (S.tab === 'crop' && this.panFrom){ this.panFrom = null; S.commit(); return; }
    if (this.drawing){ this.drawing = false; S.point(P.u, P.v, 'up'); }
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
    const key = JSON.stringify([S.tab, S.adjSel, S.stickerSel, S.brush, S.s.aspect, S.s.filter, S.s.frame, S.s.border, S.s.text.font, S.s.text.style, S.s.text.color, S.hi, S.thumbs ? 1 : 0, S.frames]);
    if (this.trayKey === key && !this.sliding) return;
    if (this.sliding) return;
    this.trayKey = key;
    box.innerHTML = '';
    const row = (cls = '') => { const d = document.createElement('div'); d.className = 'erow ' + cls; box.appendChild(d); return d; };
    const btn = (parent, label, go, on = false, cls = '') => { const b = document.createElement('button'); b.className = 'ebtn ' + cls + (on ? ' on' : ''); b.innerHTML = label; b.onclick = go; parent.appendChild(b); return b; };
    const slider = (parent, label, min, max, val, step, onInput, fmt = (v) => v) => {
      const w = document.createElement('label'); w.className = 'eslider';
      const t = document.createElement('span'); t.className = 'elabel'; t.textContent = label;
      const r = document.createElement('input'); r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = val;
      const o = document.createElement('span'); o.className = 'eval'; o.textContent = fmt(+val);
      r.addEventListener('input', () => { this.sliding = true; o.textContent = fmt(+r.value); onInput(+r.value, false); });
      r.addEventListener('change', () => { this.sliding = false; onInput(+r.value, true); });
      r.addEventListener('pointerdown', (e) => e.stopPropagation());
      w.append(t, r, o); parent.appendChild(w); return r;
    };
    if (S.tab === 'crop'){
      const a = row('scroll'); for (const A of ASPECTS) btn(a, A.name, () => S.aspect(A.id), S.s.aspect === A.id);
      const b = row(); btn(b, '⟲ Left', () => S.rotate(-1)); btn(b, '⟳ Right', () => S.rotate(1)); btn(b, '⇋ Flip', () => S.flip()); btn(b, '↺ Reset', () => S.resetCrop());
      const c = row('sliders');
      slider(c, '🔍 Zoom', 1, 4, S.s.zoom, 0.01, (v, cm) => S.zoom(v, cm), (v) => v.toFixed(1) + '×');
      slider(c, '📐 Straighten', -20, 20, S.s.angle, 0.5, (v, cm) => S.straighten(v, cm), (v) => v.toFixed(1) + '°');
      const h = row('hint'); h.textContent = 'Drag the picture to move it · pinch to zoom';
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
      else { const h = row('hint'); h.textContent = 'Pick a look, then set how strong it is'; }
    } else if (S.tab === 'adjust'){
      const a = row('scroll');
      btn(a, '✨ Auto', () => S.auto(), false, 'gold');
      for (const A of ADJUST){ const v = S.s.adj[A.id]; btn(a, `${A.icon} ${A.name}${v ? ` <b>${v > 0 && A.min < 0 ? '+' : ''}${v}</b>` : ''}`, () => { S.adjSel = A.id; this.refresh(); }, S.adjSel === A.id); }
      const A = ADJUST.find((x) => x.id === S.adjSel);
      const c = row('sliders');
      slider(c, `${A.icon} ${A.name}`, A.min, A.max, S.s.adj[A.id], 1, (v, cm) => S.adj(A.id, v, cm), (v) => (v > 0 && A.min < 0 ? '+' : '') + v);
      const b = row(); btn(b, '0 Reset this', () => S.adj(A.id, 0)); btn(b, '↺ Reset all', () => S.resetAdjust());
    } else if (S.tab === 'draw'){
      const a = row(); for (const B of BRUSHES) btn(a, `${B.icon} ${B.name}`, () => { S.brush.brush = B.id; this.refresh(); }, S.brush.brush === B.id);
      const c = row('scroll colours');
      for (const col of COLORS){ const b = btn(c, '', () => { S.brush.color = col; this.refresh(); }, S.brush.color === col, 'swatch'); b.style.background = col; }
      const d = row('sliders'); slider(d, '◍ Size', 2, 60, Math.round(S.brush.size * 1000), 1, (v) => { S.brush.size = v / 1000; }, (v) => v);
      const e = row(); btn(e, '↶ Undo line', () => S.undo(), false); btn(e, '🧽 Clear drawing', () => S.set((s) => { s.strokes = []; }));
      const h = row('hint'); h.textContent = 'Draw on the picture with your finger';
    } else if (S.tab === 'sticker'){
      const a = row('scroll stickers'); for (const e of STICKERS) btn(a, e, () => S.addSticker(e), S.placeSticker === e, 'emoji');
      const st = S.s.stickers[S.stickerSel];
      if (st){
        const c = row('sliders');
        slider(c, '↔ Size', 5, 90, Math.round(st.s * 100), 1, (v, cm) => S.stickerSize(v / 100, cm), (v) => v);
        slider(c, '⟳ Turn', -180, 180, Math.round(st.r * 180 / Math.PI), 1, (v, cm) => S.stickerTurn(v * Math.PI / 180, cm), (v) => v + '°');
        const b = row(); btn(b, '🗑 Remove', () => S.stickerDelete()); btn(b, '⧉ Copy', () => { S.set((s) => { s.stickers.push({ ...st, u: clampN(st.u + 0.06, 0, 1), v: clampN(st.v + 0.06, 0, 1) }); }); S.stickerSel = S.s.stickers.length - 1; S.changed(false); });
      } else { const h = row('hint'); h.textContent = 'Tap a sticker to add it · drag it to move · pinch to size and turn'; }
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
      const f = row('scroll'); for (const F of FONTS) btn(f, F.name, () => S.text((t) => { t.font = F.id; }), S.s.text.font === F.id); for (const T of TEXT_STYLES) btn(f, T.name, () => S.text((t) => { t.style = T.id; }), S.s.text.style === T.id, 'alt');
      const c = row('scroll colours'); for (const col of COLORS){ const b = btn(c, '', () => S.text((t) => { t.color = col; }), S.s.text.color === col, 'swatch'); b.style.background = col; }
      const d = row('sliders'); slider(d, 'Aa Size', 4, 30, Math.round(S.s.text.size * 100), 1, (v, cm) => S.text((t) => { t.size = v / 100; }, cm), (v) => v);
      const h = row('hint'); h.textContent = 'Drag on the picture to move the words up or down';
    } else if (S.tab === 'frame'){
      const h0 = row('label'); h0.textContent = 'Frame (how it hangs on the wall)';
      const a = row('scroll');
      for (const [id, F] of Object.entries(FRAMES)){
        const own = S.frames.includes(id);
        const b = btn(a, `<i class="fsw" style="background:${F.color}"></i> ${F.name}${own ? '' : ` 🔒 $${F.price}`}`, () => { if (own) S.set((s) => { s.frame = id; }); else alert(`Buy the ${F.name} frame at the 🛒 Art Market to use it.`); }, S.s.frame === id, own ? '' : 'locked');
        void b;
      }
      const h1 = row('label'); h1.textContent = 'Mat round the picture';
      const c = row(); for (const B of BORDERS) btn(c, B.name, () => S.set((s) => { s.border = B.id; }), S.s.border === B.id);
    }
    // how the frame will look: an outline round the preview in the frame's colour
    const F = FRAMES[S.s.frame] || FRAMES.wood;
    this.cv.style.borderColor = F.color; this.cv.style.boxShadow = F.glow ? `0 0 18px ${F.color}, 0 8px 30px rgba(0,0,0,.5)` : '0 8px 30px rgba(0,0,0,.5)';
  }
}

// ================= in VR: the same editor as a panel =================
function swatch(col, on){ const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.fillStyle = col; g.beginPath(); g.arc(32, 32, on ? 30 : 24, 0, 7); g.fill(); g.lineWidth = 4; g.strokeStyle = on ? '#ffcf4a' : '#888'; g.stroke(); return c; }
const swatches = new Map();
const sw = (col, on) => { const k = col + on; if (!swatches.has(k)) swatches.set(k, swatch(col, on)); return swatches.get(k); };
export function vrEditorSpec(S){
  const pic = S.draw(560);
  const tabs = TABS.map((t) => ({ label: t.icon, sub: t.name, on: S.tab === t.id, go: () => S.setTab(t.id) }));
  const secs = [{ image: pic, vrH: 500, onPoint: (u, v, ph) => S.point(u, v, ph) }, { grid: tabs, cols: 7, cellH: 96 }];
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
  } else if (S.tab === 'draw'){
    secs.push({ grid: [...BRUSHES.map((B) => ({ label: `${B.icon} ${B.name}`, on: S.brush.brush === B.id, go: () => { S.brush.brush = B.id; S.changed(false); } })), step('◍−', () => { S.brush.size = Math.max(0.003, S.brush.size * 0.7); S.changed(false); }, 'thinner'), step('◍+', () => { S.brush.size = Math.min(0.06, S.brush.size * 1.4); S.changed(false); }, 'thicker')], cols: 6, cellH: 76 });
    secs.push({ grid: COLORS.map((c) => ({ label: '', icon: sw(c, S.brush.color === c), go: () => { S.brush.color = c; S.changed(false); } })), cols: 11, cellH: 80 });
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
