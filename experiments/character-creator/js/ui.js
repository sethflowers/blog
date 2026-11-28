// The designer's panel, described once and drawn two ways: HTML at the side of the screen, and a
// board in VR (a canvas texture: point at it and pull the trigger; hold the trigger to drag a slider).
//
// A page is a list of rows:
//   { kind: 'group', text, open, toggle }                         a heading (mod groups fold away)
//   { kind: 'slider', label, get(), set(v, done), min, max, def, text(v), hint }
//   { kind: 'colors', label, get(), set(v), palette }             'auto'/'none' are special swatches
//   { kind: 'choices', label, get(), set(v), options: [{ value, label, swatch }], grid }
//   { kind: 'cards', items: [{ label, img, on, go, actions: [{ label, go, danger }] }] }
//   { kind: 'buttons', items: [{ label, go, on }] }
//   { kind: 'text', text }   { kind: 'code', text }   { kind: 'input', placeholder, button, go(value) }  (inputs: screen only)
import * as THREE from 'three';
import { clamp, roundRect, wrapText } from './util.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

// ---------- on screen ----------
export class ScreenPanel {
  constructor(){ this.updaters = []; }
  render(title, rows){
    $('side-title').textContent = title;
    const body = $('side-body'), scroll = this.lastTitle === title ? body.scrollTop : 0;
    body.innerHTML = ''; this.updaters = [];
    for (const r of rows) body.appendChild(this.row(r));
    body.scrollTop = scroll; this.lastTitle = title;
  }
  refresh(){ for (const u of this.updaters) u(); }
  row(r){
    const d = el('div', r.kind === 'group' ? 'grp' : 'ctl');
    if (r.kind === 'group'){
      d.appendChild(el('span', '', r.text));
      if (r.toggle){ const b = el('button', '', r.open ? '▾ hide' : '▸ show'); d.style.cursor = 'pointer'; d.onclick = r.toggle; d.appendChild(b); }
      return d;
    }
    if (r.label && r.kind !== 'slider'){ const l = el('div', 'lab'); l.appendChild(el('b', '', r.label)); d.appendChild(l); }
    if (r.kind === 'slider'){
      const l = el('div', 'lab'), b = el('b', '', r.label), v = el('i'); l.append(b, v); d.appendChild(l);
      const rg = el('div', 'rng'), tr = el('div', 'tr'), fl = el('div', 'fl'), kn = el('div', 'kn');
      rg.append(tr);
      if (r.min < 0) rg.append(el('div', 'mid'));
      rg.append(fl, kn); d.appendChild(rg);
      const frac = (x) => (x - r.min) / (r.max - r.min);
      const zero = r.min < 0 ? 0.5 : 0;
      const upd = () => {
        const val = r.get(), f = clamp(frac(val));
        kn.style.left = f * 100 + '%';
        fl.style.left = Math.min(f, zero) * 100 + '%'; fl.style.width = Math.abs(f - zero) * 100 + '%';
        v.textContent = r.text ? r.text(val) : '';
      };
      upd(); this.updaters.push(upd);
      // a sideways drag moves the slider; an up-and-down swipe scrolls the panel instead (the browser
      // takes it, touch-action: pan-y); a tap jumps to where you tapped; a double tap resets it
      let drag = null, lastTap = 0;
      const at = (e) => { const b = rg.getBoundingClientRect(); return r.min + clamp((e.clientX - b.left) / b.width) * (r.max - r.min); };
      rg.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse') e.preventDefault();
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY, on: e.pointerType === 'mouse' };
        if (drag.on){ try { rg.setPointerCapture(e.pointerId); } catch (x) { /* fine */ } r.set(at(e), false); upd(); }
      });
      rg.addEventListener('pointermove', (e) => {
        if (!drag || drag.id !== e.pointerId) return;
        if (!drag.on){
          const dx = Math.abs(e.clientX - drag.x), dy = Math.abs(e.clientY - drag.y);
          if (dx > 6 && dx > dy){ drag.on = true; try { rg.setPointerCapture(e.pointerId); } catch (x) { /* fine */ } }
          else if (dy > 8){ drag = null; return; }
          else return;
        }
        r.set(at(e), false); upd();
      });
      rg.addEventListener('pointerup', (e) => {
        if (!drag || drag.id !== e.pointerId) return;
        const d = drag; drag = null;
        const now = performance.now();
        if (!d.on){
          if (now - lastTap < 350){ r.set(r.def, true); upd(); lastTap = 0; return; }   // double tap: back to the middle
          lastTap = now; r.set(at(e), true); upd(); return;
        }
        if (Math.abs(e.clientX - d.x) < 4 && now - lastTap < 350){ r.set(r.def, true); upd(); lastTap = 0; return; }
        lastTap = Math.abs(e.clientX - d.x) < 4 ? now : 0;
        r.set(r.get(), true); upd();
      });
      const cancel = (e) => { if (drag && drag.id === e.pointerId){ const was = drag.on; drag = null; if (was){ r.set(r.get(), true); upd(); } } };
      rg.addEventListener('pointercancel', cancel); rg.addEventListener('lostpointercapture', cancel);
      if (r.hint) d.appendChild(el('div', 'hint', r.hint));
    } else if (r.kind === 'colors'){
      const w = el('div', 'sw'), btns = [];
      for (const c of r.palette){
        const b = el('button');
        if (c === 'auto' || c === 'none'){ b.textContent = c === 'auto' ? 'AUTO' : '✕'; b.style.background = '#3a3d45'; b.style.color = '#fff'; }
        else b.style.background = c;
        b.onclick = () => { r.set(c); upd(); };
        btns.push([b, c]); w.appendChild(b);
      }
      const pick = el('input'); pick.type = 'color'; pick.title = 'Any colour';
      pick.oninput = () => { r.set(pick.value); upd(); };
      w.appendChild(pick);
      const upd = () => { const v = r.get(); for (const [b, c] of btns) b.classList.toggle('on', c === v); if (/^#/.test(v)) pick.value = v; };
      upd(); this.updaters.push(upd); d.appendChild(w);
    } else if (r.kind === 'choices'){
      const w = el('div', 'ch' + (r.grid ? ' grid' : '')), btns = [];
      for (const o of r.options){
        const b = el('button');
        if (o.swatch){ const i = el('i'); i.style.background = o.swatch; b.appendChild(i); }
        b.appendChild(document.createTextNode(o.label));
        b.onclick = () => { r.set(o.value); upd(); };
        btns.push([b, o.value]); w.appendChild(b);
      }
      const upd = () => { const v = r.get(); for (const [b, val] of btns) b.classList.toggle('on', val === v); };
      upd(); this.updaters.push(upd); d.appendChild(w);
    } else if (r.kind === 'cards'){
      const w = el('div', 'cards');
      for (const it of r.items){
        const c = el('div', 'pc' + (it.on ? ' on' : ''));
        if (it.img){ const im = el('img'); im.src = it.img; c.appendChild(im); } else c.appendChild(el('div', 'ph'));
        c.appendChild(el('span', '', it.label));
        if (it.sub) { const s = el('small', '', it.sub); s.style.fontWeight = 500; s.style.opacity = 0.75; c.appendChild(s); }
        if (it.go){ c.style.cursor = 'pointer'; c.onclick = (e) => { if (e.target.tagName !== 'BUTTON') it.go(); }; }
        if (it.actions){
          const row = el('div', 'row');
          for (const a of it.actions){ const b = el('button', a.danger ? 'del' : '', a.label); b.onclick = (e) => { e.stopPropagation(); a.go(); }; row.appendChild(b); }
          c.appendChild(row);
        }
        w.appendChild(c);
      }
      d.appendChild(w);
    } else if (r.kind === 'buttons'){
      const w = el('div', 'prow');
      for (const it of r.items){ const b = el('button', 'sbtn' + (it.on ? ' on' : ''), it.label); b.onclick = it.go; w.appendChild(b); }
      d.appendChild(w);
    } else if (r.kind === 'text') d.appendChild(el('div', 'note', r.text));
    else if (r.kind === 'code') d.appendChild(el('div', 'code', r.text));
    else if (r.kind === 'input'){
      const w = el('div', 'prow'), i = el('input', 'txt'); i.placeholder = r.placeholder || ''; i.style.flex = '1 1 160px';
      i.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') r.go(i.value); });
      const b = el('button', 'sbtn', r.button || 'Go'); b.onclick = () => r.go(i.value);
      w.append(i, b); d.appendChild(w);
    }
    return d;
  }
}

// ---------- in VR: a board ----------
const W = 1024, H = 1280, TABW = 150, PAD = 24;
export class VRBoard {
  constructor(){
    this.canvas = document.createElement('canvas'); this.canvas.width = W; this.canvas.height = H;
    this.g = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 4;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.9), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, toneMapped: false }));
    this.mesh.renderOrder = 20;
    this.hits = []; this.scroll = 0; this.hover = -1; this.drag = null; this.imgs = new Map();
  }
  show(tabs, title, rows, footer){ this.tabs = tabs; this.title = title; this.rows = rows; this.footer = footer; if (this.lastTitle !== title){ this.scroll = 0; this.lastTitle = title; } this.draw(); }
  img(src){
    if (!src) return null;
    if (!this.imgs.has(src)){ const im = new Image(); im.onload = () => this.draw(); im.src = src; this.imgs.set(src, im); }
    const im = this.imgs.get(src); return im.complete && im.naturalWidth ? im : null;
  }
  draw(){
    const g = this.g; this.hits = [];
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(20,22,28,0.95)'; roundRect(g, 0, 0, W, H, 36); g.fill();
    // tabs down the left
    let y = 18;
    for (const t of this.tabs || []){
      this.box(t, 14, y, TABW - 24, 82, t.on ? '#f0b45a' : 'rgba(255,255,255,0.08)', () => {
        g.font = '38px sans-serif'; g.textAlign = 'center'; g.fillStyle = t.on ? '#1d1508' : '#fff'; g.fillText(t.icon, 14 + (TABW - 24) / 2, y + 44);
        g.font = 'bold 19px sans-serif'; g.fillText(t.label, 14 + (TABW - 24) / 2, y + 72);
      });
      y += 88;
    }
    // the page
    const X = TABW + 6, CW = W - X - PAD;
    g.save(); g.beginPath(); g.rect(X, 0, W - X, H - 70); g.clip();
    y = 64 - this.scroll;
    g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = 'bold 46px sans-serif'; g.fillText(this.title || '', X, y);
    y += 30;
    for (const r of this.rows || []) y = this.row(r, X, y, CW);
    g.restore();
    this.contentH = y + this.scroll;
    // footer: version and hints
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(0, H - 64, W, 64);
    g.fillStyle = '#c8c4ba'; g.font = '24px sans-serif'; g.textAlign = 'left';
    g.fillText(this.footer || '', 24, H - 24);
    if (this.contentH > H - 70){ g.textAlign = 'right'; g.fillStyle = '#7ec4cf'; g.fillText('right stick ▲▼ scrolls', W - 24, H - 24); }
    this.tex.needsUpdate = true;
  }
  // a hit area; paint() draws its contents
  box(target, x, y, w, h, fill, paint){
    const i = this.hits.length, hov = this.hover === i;
    if (fill){ this.g.fillStyle = hov ? '#ffe08a' : fill; roundRect(this.g, x, y, w, h, 14); this.g.fill(); }
    if (paint) paint(hov);
    this.hits.push({ x, y, w, h, target });
  }
  row(r, X, y, CW){
    const g = this.g;
    if (r.kind === 'group'){
      y += 22;
      this.box({ go: r.toggle }, X, y, CW, 50, null, () => {});
      g.fillStyle = '#7ec4cf'; g.font = 'bold 26px sans-serif'; g.textAlign = 'left'; g.fillText(r.text.toUpperCase(), X, y + 34);
      if (r.toggle){ g.textAlign = 'right'; g.fillStyle = '#a9a69e'; g.fillText(r.open ? '▾ hide' : '▸ show', X + CW, y + 34); }
      return y + 54;
    }
    if (r.kind === 'slider'){
      const v = r.get(), f = clamp((v - r.min) / (r.max - r.min));
      g.font = '28px sans-serif'; g.fillStyle = '#fff'; g.textAlign = 'left'; g.fillText(r.label, X, y + 34);
      g.textAlign = 'right'; g.fillStyle = '#a9a69e'; g.fillText(r.text ? r.text(v) : '', X + CW, y + 34);
      const ty = y + 66;
      this.box({ slider: r, x0: X + 16, x1: X + CW - 16 }, X, ty - 26, CW, 52, null, (hov) => {
        g.fillStyle = 'rgba(255,255,255,0.15)'; roundRect(g, X + 16, ty - 6, CW - 32, 12, 6); g.fill();
        const zero = r.min < 0 ? 0.5 : 0, a = X + 16 + (CW - 32) * Math.min(f, zero), b = X + 16 + (CW - 32) * Math.max(f, zero);
        g.fillStyle = '#f0b45a'; roundRect(g, a, ty - 6, Math.max(2, b - a), 12, 6); g.fill();
        g.fillStyle = hov || this.drag === r ? '#ffe08a' : '#fff'; g.beginPath(); g.arc(X + 16 + (CW - 32) * f, ty, 20, 0, Math.PI * 2); g.fill();
      });
      return y + 104;
    }
    if (r.label){ g.font = '28px sans-serif'; g.fillStyle = '#fff'; g.textAlign = 'left'; g.fillText(r.label, X, y + 34); y += 46; }
    if (r.kind === 'colors'){
      const v = r.get(), s = 62, per = Math.floor(CW / (s + 10));
      r.palette.forEach((c, i) => {
        const cx = X + (i % per) * (s + 10), cy = y + Math.floor(i / per) * (s + 10);
        this.box({ go: () => r.set(c) }, cx, cy, s, s, null, (hov) => {
          g.fillStyle = c === 'auto' || c === 'none' ? '#3a3d45' : c; g.beginPath(); g.arc(cx + s / 2, cy + s / 2, s / 2 - 4, 0, Math.PI * 2); g.fill();
          if (c === 'auto' || c === 'none'){ g.fillStyle = '#fff'; g.font = 'bold 18px sans-serif'; g.textAlign = 'center'; g.fillText(c === 'auto' ? 'AUTO' : '✕', cx + s / 2, cy + s / 2 + 7); }
          if (c === v || hov){ g.strokeStyle = c === v ? '#fff' : '#ffe08a'; g.lineWidth = 5; g.beginPath(); g.arc(cx + s / 2, cy + s / 2, s / 2 - 2, 0, Math.PI * 2); g.stroke(); }
        });
      });
      return y + Math.ceil(r.palette.length / per) * (s + 10) + 12;
    }
    if (r.kind === 'choices' || r.kind === 'buttons'){
      const items = r.kind === 'choices' ? r.options.map((o) => ({ label: o.label, swatch: o.swatch, on: o.value === r.get(), go: () => r.set(o.value) })) : r.items;
      const cols = r.kind === 'buttons' ? Math.min(3, items.length) : 2, gap = 10, w = (CW - gap * (cols - 1)) / cols, h = 64;
      items.forEach((it, i) => {
        const bx = X + (i % cols) * (w + gap), by = y + Math.floor(i / cols) * (h + gap);
        this.box({ go: it.go }, bx, by, w, h, it.on ? '#f0b45a' : 'rgba(255,255,255,0.1)', (hov) => {
          g.fillStyle = it.on || hov ? '#1d1508' : '#fff'; g.textAlign = 'center';
          let fs = 26; g.font = `bold ${fs}px sans-serif`; while (g.measureText(it.label).width > w - 40 && fs > 16){ fs -= 2; g.font = `bold ${fs}px sans-serif`; }
          let tx = bx + w / 2;
          if (it.swatch){ g.fillStyle = it.swatch; g.beginPath(); g.arc(bx + 26, by + h / 2, 12, 0, Math.PI * 2); g.fill(); tx += 12; g.fillStyle = it.on || hov ? '#1d1508' : '#fff'; }
          g.fillText(it.label, tx, by + h / 2 + 9);
        });
      });
      return y + Math.ceil(items.length / cols) * (h + gap) + 10;
    }
    if (r.kind === 'cards'){
      const cols = 3, gap = 12, w = (CW - gap * 2) / cols, h = w + 46;
      r.items.forEach((it, i) => {
        const bx = X + (i % cols) * (w + gap), by = y + Math.floor(i / cols) * (h + gap);
        this.box({ go: it.go }, bx, by, w, h, it.on ? '#f0b45a' : 'rgba(255,255,255,0.08)', (hov) => {
          const im = this.img(it.img);
          if (im) g.drawImage(im, bx + 6, by + 6, w - 12, w - 12); else { g.fillStyle = '#2a2d34'; g.fillRect(bx + 6, by + 6, w - 12, w - 12); }
          g.fillStyle = it.on || hov ? '#1d1508' : '#fff'; g.font = 'bold 22px sans-serif'; g.textAlign = 'center';
          g.fillText(it.label.slice(0, 18), bx + w / 2, by + h - 14);
        });
      });
      return y + Math.ceil(r.items.length / cols) * (h + gap) + 10;
    }
    if (r.kind === 'text' || r.kind === 'code'){
      g.font = r.kind === 'code' ? 'bold 30px monospace' : '25px sans-serif'; g.fillStyle = r.kind === 'code' ? '#ffe08a' : '#c8c4ba'; g.textAlign = 'left';
      const lines = r.kind === 'code' ? (r.text.match(/.{1,40}/g) || ['']) : wrapText(g, r.text, CW);
      for (const l of lines){ g.fillText(l, X, y + 30); y += 38; }
      return y + 10;
    }
    return y;   // (inputs are only on screen)
  }
  scrollBy(d){ this.scroll = clamp(this.scroll + d, 0, Math.max(0, this.contentH - H + 140)); this.draw(); }
  // a controller's ray: hover, click, and dragging sliders while the trigger is held
  ray(origin, dir, down, held){
    this.mesh.updateMatrixWorld(true);
    const hit = new THREE.Raycaster(origin, dir, 0, 4).intersectObject(this.mesh)[0];
    if (!hit){ if (this.hover !== -1){ this.hover = -1; this.draw(); } if (!held && this.drag){ this.drag.set(this.drag.get(), true); this.drag = null; } return null; }
    const px = hit.uv.x * W, py = (1 - hit.uv.y) * H;
    if (this.drag){
      const t = this.dragHit;
      const v = this.drag.min + clamp((px - t.x0) / (t.x1 - t.x0)) * (this.drag.max - this.drag.min);
      if (held){ this.drag.set(v, false); this.draw(); }
      else { this.drag.set(v, true); this.drag = null; this.draw(); }
      return { point: hit.point, dragging: true };
    }
    const i = this.hits.findIndex((h) => px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h);
    if (i !== this.hover){ this.hover = i; this.draw(); }
    let clicked = false;
    if (down && i >= 0){
      const t = this.hits[i].target;
      if (t.slider){ this.drag = t.slider; this.dragHit = t; const v = t.slider.min + clamp((px - t.x0) / (t.x1 - t.x0)) * (t.slider.max - t.slider.min); t.slider.set(v, false); }
      else if (t.go) t.go();
      clicked = true;
    }
    return { point: hit.point, clicked };
  }
}
