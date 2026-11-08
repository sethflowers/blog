// Panels, described once and drawn two ways: as HTML over the game on a screen, and on a tablet you
// hold in your left hand in VR (point at it with the right controller and pull the trigger).
// A panel: { title, sections: [{ heading, text, grid: [buttons], rows: [{ title, sub, icon, button }], buttons: [...] }] }
// A button: { label, sub, icon (a canvas), go, disabled, on, kind }
import * as THREE from 'three';
import { textCanvas, roundRect, wrapText, clamp } from './util.js';

const $ = (id) => document.getElementById(id);

export class ScreenPanel {
  constructor(){
    this.open = null;
    $('panel').addEventListener('pointerdown', (e) => { if (e.target === $('panel')) this.close(); });
  }
  show(spec){
    this.open = spec;
    const P = $('panel'); P.innerHTML = '';
    const card = document.createElement('div'); card.className = 'card-panel';
    const head = document.createElement('div'); head.className = 'phead';
    const h = document.createElement('h2'); h.textContent = spec.title; head.appendChild(h);
    if (spec.money){ const m = document.createElement('span'); m.className = 'pmoney'; m.textContent = spec.money; head.appendChild(m); }
    const x = document.createElement('button'); x.className = 'x'; x.textContent = '✕'; x.onclick = () => this.close(); head.appendChild(x);
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
  }
  close(){ $('panel').classList.remove('show'); $('panel').innerHTML = ''; const o = this.open; this.open = null; if (o && o.onClose) o.onClose(); }
}
function btn(b){
  const e = document.createElement('button'); e.disabled = !!b.disabled;
  if (b.kind) e.className = b.kind; if (b.on) e.classList.add('on');
  if (b.icon){ const img = new Image(); img.src = b.icon.toDataURL(); img.className = 'bicon'; e.appendChild(img); }
  const l = document.createElement('span'); l.textContent = b.label; e.appendChild(l);
  if (b.sub){ const s = document.createElement('small'); s.textContent = b.sub; e.appendChild(s); }
  e.onclick = b.go;
  return e;
}
function section(s){
  const d = document.createElement('div'); d.className = 'psec';
  if (s.heading){ const h = document.createElement('h3'); h.textContent = s.heading; d.appendChild(h); }
  if (s.text){ const p = document.createElement('p'); p.textContent = s.text; d.appendChild(p); }
  if (s.list){ const u = document.createElement('ul'); for (const t of s.list){ const li = document.createElement('li'); li.textContent = t; u.appendChild(li); } d.appendChild(u); }
  if (s.rows) for (const r of s.rows){
    const row = document.createElement('div'); row.className = 'row' + (r.on ? ' on' : '');
    if (r.icon){ const img = new Image(); img.src = r.icon.toDataURL(); img.className = 'ricon'; row.appendChild(img); }
    const a = document.createElement('div'); a.className = 'rl';
    const b = document.createElement('b'); b.textContent = r.title; a.appendChild(b);
    if (r.sub){ const sm = document.createElement('small'); sm.textContent = r.sub; a.appendChild(sm); }
    row.appendChild(a);
    if (r.button) row.appendChild(btn(r.button));
    d.appendChild(row);
  }
  if (s.grid || s.buttons){
    const w = document.createElement('div'); w.className = s.grid ? 'grid' : 'btns';
    for (const b of s.grid || s.buttons) w.appendChild(btn(b));
    d.appendChild(w);
  }
  return d;
}

// ---------- the VR tablet ----------
export class Tablet {
  constructor(){
    this.W = 1024; this.H = 1280;
    this.tc = textCanvas(this.W, this.H);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.375), new THREE.MeshBasicMaterial({ map: this.tc.tex, transparent: true, toneMapped: false }));
    this.mesh.renderOrder = 10;
    this.hits = []; this.spec = null; this.hover = -1; this.scroll = 0;
  }
  show(spec){ if (this.spec !== spec) this.scroll = this.spec && this.spec.title === spec.title ? this.scroll : 0; this.spec = spec; this.draw(); }
  draw(){
    const g = this.tc.ctx, W = this.W, H = this.H, S = this.spec;
    if (!S) return;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(20,28,48,0.95)'; roundRect(g, 4, 4, W - 8, H - 8, 40); g.fill();
    g.strokeStyle = '#ffd84a'; g.lineWidth = 8; roundRect(g, 4, 4, W - 8, H - 8, 40); g.stroke();
    this.hits = [];
    let y = 78 - this.scroll;
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillStyle = '#ffffff'; g.font = 'bold 54px Arial'; g.fillText(S.title, 36, y);
    if (S.money){ g.fillStyle = '#ffd84a'; g.font = 'bold 50px Arial'; g.textAlign = 'right'; g.fillText(S.money, W - 36, y); g.textAlign = 'left'; }
    y += 26;
    if (S.tabs){
      let x = 30; y += 4;
      for (const t of S.tabs){ g.font = 'bold 34px Arial'; const w = g.measureText(t.label).width + 40; this.button(g, t, x, y, w, 64, t.on ? '#ffd84a' : null, t.on); x += w + 12; }
      y += 84;
    }
    for (const s of S.sections || []){
      if (s.heading){ g.fillStyle = '#ffd84a'; g.font = 'bold 36px Arial'; g.fillText(s.heading, 36, y + 36); y += 52; }
      if (s.text){ g.fillStyle = '#e8ecf4'; g.font = '32px Arial'; for (const l of wrapText(g, s.text, W - 80)){ g.fillText(l, 36, y + 32); y += 42; } y += 8; }
      if (s.list){ g.fillStyle = '#e8ecf4'; g.font = '30px Arial'; for (const it of s.list) for (const [k, l] of wrapText(g, '• ' + it, W - 90).entries()){ g.fillText((k ? '   ' : '') + l, 40, y + 30); y += 40; } y += 8; }
      if (s.grid){
        const cols = s.cols || 4, gap = 14, w = (W - 60 - gap * (cols - 1)) / cols, h = s.cellH || 150;
        s.grid.forEach((b, i) => { const c = i % cols, r = Math.floor(i / cols); this.button(g, b, 30 + c * (w + gap), y + r * (h + gap), w, h, null, b.on); });
        y += Math.ceil(s.grid.length / cols) * (h + gap) + 6;
      }
      if (s.rows) for (const row of s.rows){
        g.fillStyle = row.on ? 'rgba(255,216,74,0.18)' : 'rgba(255,255,255,0.07)'; roundRect(g, 30, y, W - 60, 104, 16); g.fill();
        let tx = 50;
        if (row.icon){ g.drawImage(row.icon, 44, y + 8, 88, 88); tx = 148; }
        g.fillStyle = '#ffffff'; g.font = 'bold 34px Arial'; g.fillText(row.title, tx, y + 44);
        if (row.sub){ g.fillStyle = '#b8c0d0'; g.font = '26px Arial'; g.fillText(String(row.sub).slice(0, 40), tx, y + 82); }
        if (row.button) this.button(g, row.button, W - 270, y + 16, 220, 72);
        y += 116;
      }
      if (s.buttons){
        const n = s.buttons.length, gap = 14, w = (W - 60 - gap * (n - 1)) / n;
        s.buttons.forEach((b, i) => this.button(g, b, 30 + i * (w + gap), y, w, 92, b.kind === 'primary' ? '#2a9a4a' : b.kind === 'danger' ? '#a83a30' : null, b.on));
        y += 108;
      }
    }
    this.contentH = y + this.scroll;
    if (this.contentH > H){ g.fillStyle = '#ffd84a'; g.font = '26px Arial'; g.textAlign = 'right'; g.fillText('right stick ▲▼ scrolls', W - 40, H - 22); g.textAlign = 'left'; }
    this.tc.tex.needsUpdate = true;
  }
  button(g, b, x, y, w, h, col, on){
    const i = this.hits.length;
    const hover = this.hover === i && !b.disabled;
    g.fillStyle = b.disabled ? '#3a3e48' : hover ? '#ffe680' : on ? '#ffd84a' : col || '#3a5a9a';
    roundRect(g, x, y, w, h, 16); g.fill();
    const fg = b.disabled ? '#8a8e98' : hover || on ? '#1a1a2a' : '#ffffff';
    g.fillStyle = fg; g.textAlign = 'center';
    if (b.icon){
      const s = Math.min(h - 50, w - 20);
      g.globalAlpha = b.disabled ? 0.4 : 1; g.drawImage(b.icon, x + (w - s) / 2, y + 4, s, s); g.globalAlpha = 1;
      g.font = 'bold 26px Arial'; g.fillText(b.label, x + w / 2, y + h - 14);
    } else {
      g.font = `bold ${b.sub ? 32 : 34}px Arial`;
      let fs = b.sub ? 32 : 34; while (g.measureText(b.label).width > w - 16 && fs > 18){ fs -= 2; g.font = `bold ${fs}px Arial`; }
      g.fillText(b.label, x + w / 2, y + h / 2 + (b.sub ? -2 : 12));
      if (b.sub){ g.font = '24px Arial'; g.fillText(b.sub, x + w / 2, y + h / 2 + 30); }
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
    const i = this.hits.findIndex((r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h);
    if (i !== this.hover){ this.hover = i; this.draw(); }
    if (click && i >= 0 && !this.hits[i].b.disabled){ const b = this.hits[i].b; this.hover = -1; b.go(); return { point: hit.point, clicked: true }; }
    return { point: hit.point };
  }
  scrollBy(d){ if (!this.contentH || this.contentH <= this.H) return; this.scroll = clamp(this.scroll + d, 0, this.contentH - this.H + 60); this.draw(); }
}
