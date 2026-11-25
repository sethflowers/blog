// Panels, described once and drawn two ways: as HTML over the game on a screen, and on a notebook you
// hold in your left hand in VR (point at it with the right controller and pull the trigger).
// A panel: { title, tabs: [{ label, on, go }], sections: [{ heading, text, images: [{ canvas, label, wide }],
//   rows: [{ title, sub, icon (canvas), on, struck, button }], buttons: [{ label, go, kind, disabled, on }],
//   grid: [{ label, sub, icon, go, on, struck }] }] }
import * as THREE from 'three';
import { textCanvas, roundRect, wrapText, clamp } from './util.js';

const $ = (id) => document.getElementById(id);
const urlCache = new WeakMap();
const url = (c) => { if (!urlCache.has(c)) urlCache.set(c, c.toDataURL()); return urlCache.get(c); };

export class ScreenPanel {
  constructor(){
    this.open = null;
    $('panel').addEventListener('pointerdown', (e) => { if (e.target === $('panel') && !(this.open && this.open.modal)) this.close(); });
  }
  show(spec){
    const keep = this.open && this.open.title === spec.title ? ($('panel').querySelector('.pbody') || {}).scrollTop : 0;
    this.open = spec;
    const P = $('panel'); P.innerHTML = '';
    const card = document.createElement('div'); card.className = 'card-panel' + (spec.wide ? ' wide' : '');
    const head = document.createElement('div'); head.className = 'phead';
    if (spec.portrait){ const img = new Image(); img.src = url(spec.portrait); img.className = 'pport'; head.appendChild(img); }
    const h = document.createElement('h2'); h.textContent = spec.title; head.appendChild(h);
    if (!spec.modal){ const x = document.createElement('button'); x.className = 'x'; x.textContent = '✕'; x.setAttribute('aria-label', 'Close'); x.onclick = () => this.close(); head.appendChild(x); }
    card.appendChild(head);
    if (spec.tabs){
      const tb = document.createElement('div'); tb.className = 'tabs';
      for (const t of spec.tabs){ const b = document.createElement('button'); b.textContent = t.label; if (t.on) b.className = 'on'; b.onclick = t.go; tb.appendChild(b); }
      card.appendChild(tb);
    }
    const body = document.createElement('div'); body.className = 'pbody';
    for (const s of spec.sections || []) body.appendChild(section(s));
    card.appendChild(body);
    P.appendChild(card);
    P.classList.add('show');
    if (keep) body.scrollTop = keep;
  }
  close(){ $('panel').classList.remove('show'); $('panel').innerHTML = ''; const o = this.open; this.open = null; if (o && o.onClose) o.onClose(); }
}
function btn(b){
  const e = document.createElement('button'); e.disabled = !!b.disabled;
  if (b.kind) e.className = b.kind; if (b.on) e.classList.add('on'); if (b.struck) e.classList.add('struck');
  if (b.icon){ const img = new Image(); img.src = url(b.icon); img.className = 'bicon'; e.appendChild(img); }
  const l = document.createElement('span'); l.textContent = b.label; e.appendChild(l);
  if (b.sub){ const s = document.createElement('small'); s.textContent = b.sub; e.appendChild(s); }
  e.onclick = b.go;
  return e;
}
function section(s){
  const d = document.createElement('div'); d.className = 'psec';
  if (s.heading){ const h = document.createElement('h3'); h.textContent = s.heading; d.appendChild(h); }
  if (s.text){ for (const para of String(s.text).split('\n\n')){ const p = document.createElement('p'); p.textContent = para; if (s.quote) p.className = 'quote'; d.appendChild(p); } }
  if (s.images){
    const w = document.createElement('div'); w.className = 'imgs';
    for (const im of s.images){ const f = document.createElement('figure'); const img = new Image(); img.src = url(im.canvas); if (im.wide) img.className = 'wide'; f.appendChild(img); if (im.label){ const c = document.createElement('figcaption'); c.textContent = im.label; if (im.good) c.className = 'good'; f.appendChild(c); } w.appendChild(f); }
    d.appendChild(w);
  }
  if (s.rows) for (const r of s.rows){
    const row = document.createElement('div'); row.className = 'row' + (r.on ? ' on' : '') + (r.struck ? ' struck' : '');
    if (r.icon){ const img = new Image(); img.src = url(r.icon); img.className = 'ricon'; row.appendChild(img); }
    const a = document.createElement('div'); a.className = 'rl';
    const b = document.createElement('b'); b.textContent = r.title; a.appendChild(b);
    if (r.sub){ const sm = document.createElement('small'); sm.textContent = r.sub; a.appendChild(sm); }
    row.appendChild(a);
    if (r.button) row.appendChild(btn(r.button));
    if (r.go){ row.classList.add('tap'); row.onclick = r.go; }
    d.appendChild(row);
  }
  if (s.grid || s.buttons){
    const w = document.createElement('div'); w.className = s.grid ? 'grid' : 'btns';
    for (const b of s.grid || s.buttons) w.appendChild(btn(b));
    d.appendChild(w);
  }
  return d;
}

// ---------- the VR notebook ----------
export class Tablet {
  constructor(){
    this.W = 1024; this.H = 1280;
    this.tc = textCanvas(this.W, this.H);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.375), new THREE.MeshBasicMaterial({ map: this.tc.tex, transparent: true, toneMapped: false }));
    this.mesh.renderOrder = 10;
    this.hits = []; this.spec = null; this.hover = -1; this.scroll = 0;
  }
  show(spec){ if (!this.spec || this.spec.title !== spec.title) this.scroll = 0; this.spec = spec; this.draw(); }
  draw(){
    const g = this.tc.ctx, W = this.W, H = this.H, S = this.spec;
    if (!S) return;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(244,236,214,0.98)'; roundRect(g, 4, 4, W - 8, H - 8, 36); g.fill();
    g.strokeStyle = '#5a3a1a'; g.lineWidth = 10; roundRect(g, 5, 5, W - 10, H - 10, 34); g.stroke();
    // ruled lines, like a notebook
    g.strokeStyle = 'rgba(90,120,170,0.18)'; g.lineWidth = 2; for (let y = 160; y < H - 20; y += 44){ g.beginPath(); g.moveTo(20, y); g.lineTo(W - 20, y); g.stroke(); }
    this.hits = [];
    let y = 20 - this.scroll;
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    // header bar
    g.fillStyle = '#3a2410'; roundRect(g, 14, y, W - 28, 96, 24); g.fill();
    let tx = 40;
    if (S.portrait){ g.drawImage(S.portrait, 30, y + 8, 80, 80); tx = 126; }
    g.fillStyle = '#fff4d8'; g.font = 'bold 46px Georgia'; let fs = 46; while (g.measureText(S.title).width > W - tx - (S.modal ? 40 : 150) && fs > 26){ fs -= 2; g.font = `bold ${fs}px Georgia`; } g.fillText(S.title, tx, y + 64);
    if (!S.modal && S.close) this.button(g, { label: '✕', go: S.close }, W - 120, y + 12, 92, 72, '#8a3a2a');
    y += 112;
    if (S.tabs){
      let x = 24;
      const tw = (W - 48 - 10 * (S.tabs.length - 1)) / S.tabs.length;
      for (const t of S.tabs){ this.button(g, t, x, y, tw, 66, t.on ? '#d8a030' : '#8a6a4a', t.on); x += tw + 10; }
      y += 82;
    }
    for (const s of S.sections || []){
      if (s.heading){ g.fillStyle = '#8a4a1a'; g.font = 'bold 34px Arial'; g.fillText(s.heading.toUpperCase(), 34, y + 34); y += 50; }
      if (s.text){ g.fillStyle = '#2a2016'; g.font = (s.quote ? 'italic ' : '') + '32px Georgia'; for (const l of wrapText(g, s.text, W - 80)){ if (l) g.fillText(l, 36, y + 32); y += 40; } y += 10; }
      if (s.images){
        let x = 34; const ih = 220;
        for (const im of s.images){
          const iw = ih * im.canvas.width / im.canvas.height;
          if (x + iw > W - 30){ x = 34; y += ih + 50; }
          g.drawImage(im.canvas, x, y, iw, ih);
          if (im.label){ g.fillStyle = im.good ? '#1a7a2a' : '#3a2a1a'; g.font = 'bold 24px Arial'; g.fillText(im.label.slice(0, 22), x, y + ih + 30); }
          x += Math.max(iw, 150) + 20;
        }
        y += ih + 50;
      }
      if (s.rows) for (const row of s.rows){
        const lines = row.sub ? wrapText(g, row.sub, W - (row.icon ? 160 : 80) - (row.button ? 240 : 0)).slice(0, 3) : [];
        const rh = Math.max(104, 56 + lines.length * 32);
        g.fillStyle = row.on ? 'rgba(216,160,48,0.3)' : 'rgba(90,58,26,0.1)'; roundRect(g, 26, y, W - 52, rh, 16); g.fill();
        if (row.go) this.hits.push({ x: 26, y, w: W - 52 - (row.button ? 240 : 0), h: rh, b: { go: row.go } });
        let lx = 46;
        if (row.icon){ g.drawImage(row.icon, 40, y + 10, 84, 84); lx = 140; }
        g.fillStyle = row.struck ? '#8a7a6a' : '#1a140c'; g.font = 'bold 34px Arial'; g.fillText(row.title.slice(0, 34), lx, y + 44);
        if (row.struck){ g.strokeStyle = '#a83a2a'; g.lineWidth = 5; g.beginPath(); g.moveTo(lx, y + 32); g.lineTo(lx + g.measureText(row.title.slice(0, 34)).width, y + 32); g.stroke(); }
        g.fillStyle = '#5a4a3a'; g.font = '27px Arial'; lines.forEach((l, k) => g.fillText(l, lx, y + 82 + k * 32));
        if (row.button) this.button(g, row.button, W - 260, y + (rh - 72) / 2, 222, 72);
        y += rh + 12;
      }
      if (s.buttons){
        const per = Math.min(s.buttons.length, 2), gap = 14, w = (W - 60 - gap * (per - 1)) / per;
        s.buttons.forEach((b, i) => { const c = i % per, r = Math.floor(i / per); this.button(g, b, 30 + c * (w + gap), y + r * 100, w, 88, b.kind === 'primary' ? '#2a7a3a' : b.kind === 'danger' ? '#a83a2a' : null, b.on); });
        y += Math.ceil(s.buttons.length / per) * 100 + 8;
      }
      if (s.grid){
        const cols = s.cols || 3, gap = 14, w = (W - 60 - gap * (cols - 1)) / cols, h = s.cellH || 200;
        s.grid.forEach((b, i) => { const c = i % cols, r = Math.floor(i / cols); this.button(g, b, 30 + c * (w + gap), y + r * (h + gap), w, h, null, b.on); });
        y += Math.ceil(s.grid.length / cols) * (h + gap) + 6;
      }
    }
    this.contentH = y + this.scroll;
    if (this.contentH > H){ g.fillStyle = '#8a4a1a'; g.font = 'bold 26px Arial'; g.textAlign = 'right'; g.fillText('right stick ▲▼ scrolls', W - 40, H - 18); g.textAlign = 'left'; }
    this.tc.tex.needsUpdate = true;
  }
  button(g, b, x, y, w, h, col, on){
    const i = this.hits.length;
    const hover = this.hover === i && !b.disabled;
    g.fillStyle = b.disabled ? '#b8ae9e' : hover ? '#ffd860' : on ? '#e8b040' : col || '#5a3a1a';
    roundRect(g, x, y, w, h, 16); g.fill();
    const fg = b.disabled ? '#ece6da' : hover || on ? '#1a1208' : '#ffffff';
    g.fillStyle = fg; g.textAlign = 'center';
    if (b.icon){
      const s = Math.min(h - 64, w - 20);
      g.globalAlpha = b.disabled ? 0.5 : 1; g.drawImage(b.icon, x + (w - s) / 2, y + 8, s, s); g.globalAlpha = 1;
      g.font = 'bold 28px Arial'; g.fillText(b.label.slice(0, 18), x + w / 2, y + h - 30);
      if (b.sub){ g.font = '22px Arial'; g.fillText(b.sub.slice(0, 22), x + w / 2, y + h - 6); }
      if (b.struck){ g.strokeStyle = '#c83a2a'; g.lineWidth = 10; g.beginPath(); g.moveTo(x + 16, y + 16); g.lineTo(x + w - 16, y + h - 16); g.moveTo(x + w - 16, y + 16); g.lineTo(x + 16, y + h - 16); g.stroke(); }
    } else {
      let fs = 32; g.font = `bold ${fs}px Arial`; while (g.measureText(b.label).width > w - 20 && fs > 18){ fs -= 2; g.font = `bold ${fs}px Arial`; }
      g.fillText(b.label, x + w / 2, y + h / 2 + 11);
    }
    g.textAlign = 'left';
    this.hits.push({ x, y, w, h, b });
  }
  // a ray from the right controller: hover and click
  ray(origin, dir, click, far = 3){
    const rc = new THREE.Raycaster(origin, dir, 0, far);
    const hit = rc.intersectObject(this.mesh)[0];
    if (!hit){ if (this.hover !== -1){ this.hover = -1; this.draw(); } return null; }
    const px = hit.uv.x * this.W, py = (1 - hit.uv.y) * this.H;
    let i = -1; for (let k = this.hits.length - 1; k >= 0; k--){ const r = this.hits[k]; if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h){ i = k; break; } }
    if (i !== this.hover){ this.hover = i; this.draw(); }
    if (click && i >= 0 && !this.hits[i].b.disabled){ const b = this.hits[i].b; this.hover = -1; b.go(); return { point: hit.point, clicked: true }; }
    return { point: hit.point };
  }
  scrollBy(d){ if (!this.contentH || this.contentH <= this.H) return; this.scroll = clamp(this.scroll + d, 0, this.contentH - this.H + 60); this.draw(); }
}
