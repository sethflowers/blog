// Panels and the HUD. A panel is described once (title, text, bars, rows, buttons) and drawn two ways:
// as HTML over the game on a screen, and as a floating board in VR that you point at and pull the trigger.
import * as THREE from 'three';
import { textCanvas, roundRect, wrapText, clamp } from './util.js';

const $ = (id) => document.getElementById(id);

// ---------- screen (HTML) ----------
export class ScreenUI {
  constructor(){
    this.root = $('panel'); this.open = null;
    $('panel').addEventListener('pointerdown', (e) => { if (e.target === $('panel')) this.close(); });
  }
  show(spec){
    this.open = spec;
    const P = $('panel'); P.innerHTML = '';
    const card = document.createElement('div'); card.className = 'card-panel';
    const head = document.createElement('div'); head.className = 'phead';
    const h = document.createElement('h2'); h.textContent = spec.title; head.appendChild(h);
    const x = document.createElement('button'); x.className = 'x'; x.textContent = '✕'; x.onclick = () => this.close(); head.appendChild(x);
    card.appendChild(head);
    if (spec.tabs){
      const tb = document.createElement('div'); tb.className = 'tabs';
      for (const t of spec.tabs){ const b = document.createElement('button'); b.textContent = t.label; if (t.active) b.className = 'on'; b.onclick = () => t.go(); tb.appendChild(b); }
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
function section(s){
  const d = document.createElement('div'); d.className = 'psec';
  if (s.heading){ const h = document.createElement('h3'); h.textContent = s.heading; d.appendChild(h); }
  if (s.text){ const p = document.createElement('p'); p.textContent = s.text; d.appendChild(p); }
  if (s.bars){
    for (const [label, v, note] of s.bars){
      const r = document.createElement('div'); r.className = 'bar';
      const l = document.createElement('span'); l.textContent = label; r.appendChild(l);
      const t = document.createElement('div'); t.className = 'track'; const f = document.createElement('div'); f.className = 'fill';
      f.style.width = clamp(v, 0, 100) + '%'; f.style.background = v > 66 ? '#5cb85c' : v > 33 ? '#e8b83a' : '#d9534f';
      t.appendChild(f); r.appendChild(t);
      if (note){ const n = document.createElement('em'); n.textContent = note; r.appendChild(n); }
      d.appendChild(r);
    }
  }
  if (s.list){
    const ul = document.createElement('ul');
    for (const it of s.list){ const li = document.createElement('li'); li.textContent = it; ul.appendChild(li); }
    d.appendChild(ul);
  }
  if (s.rows){
    for (const row of s.rows){
      const r = document.createElement('div'); r.className = 'row';
      const a = document.createElement('div'); a.className = 'rl';
      const t = document.createElement('b'); t.textContent = row.title; a.appendChild(t);
      if (row.sub){ const sub = document.createElement('small'); sub.textContent = row.sub; a.appendChild(sub); }
      r.appendChild(a);
      if (row.button){ const b = document.createElement('button'); b.textContent = row.button.label; b.disabled = !!row.button.disabled; b.onclick = row.button.go; r.appendChild(b); }
      d.appendChild(r);
    }
  }
  if (s.buttons){
    const w = document.createElement('div'); w.className = 'btns';
    for (const b of s.buttons){ const e = document.createElement('button'); e.textContent = b.label; e.disabled = !!b.disabled; if (b.kind) e.className = b.kind; e.onclick = b.go; w.appendChild(e); }
    d.appendChild(w);
  }
  return d;
}

// ---------- VR: the same panel on a board in front of you ----------
export class VRPanel {
  constructor(scene){
    this.W = 1024; this.H = 1280;
    this.tc = textCanvas(this.W, this.H);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.0), new THREE.MeshBasicMaterial({ map: this.tc.tex, transparent: true, toneMapped: false }));
    this.mesh.visible = false; this.mesh.renderOrder = 10;
    this.mesh.material.depthTest = true;
    scene.add(this.mesh);
    this.hits = []; this.spec = null; this.hover = -1; this.scroll = 0;
  }
  show(spec, headPos, headQuat){
    this.spec = spec; this.scroll = 0;
    if (headPos) this.place(headPos, headQuat);
    this.mesh.visible = true;
    this.draw();
  }
  // in front of your eyes, a little below, facing you
  place(headPos, headQuat){
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(headQuat); fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1); fwd.normalize();
    this.mesh.position.copy(headPos).addScaledVector(fwd, 0.85); this.mesh.position.y = headPos.y - 0.12;
    this.mesh.lookAt(headPos.x, this.mesh.position.y, headPos.z);
  }
  close(){ const o = this.spec; this.mesh.visible = false; this.spec = null; if (o && o.onClose) o.onClose(); }
  get open(){ return this.mesh.visible; }
  draw(){
    const g = this.tc.ctx, W = this.W, H = this.H, S = this.spec;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(28,36,30,0.94)'; roundRect(g, 4, 4, W - 8, H - 8, 36); g.fill();
    g.strokeStyle = '#c8a050'; g.lineWidth = 6; roundRect(g, 4, 4, W - 8, H - 8, 36); g.stroke();
    this.hits = [];
    let y = 70 - this.scroll;
    g.fillStyle = '#f4e8c8'; g.font = 'bold 56px Georgia, serif'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillText(S.title, 40, y);
    // close button
    this.button(g, { label: '✕', go: () => this.close() }, W - 120, 22 + (-this.scroll), 84, 70);
    y += 30;
    if (S.tabs){
      let x = 30; y += 10;
      for (const t of S.tabs){ g.font = 'bold 32px Arial'; const w = g.measureText(t.label).width + 36; if (x + w > W - 30){ x = 30; y += 70; } this.button(g, t, x, y, w, 58, t.active ? '#c8a050' : '#3a4a3e'); x += w + 10; }
      y += 80;
    }
    for (const s of S.sections || []){
      if (s.heading){ g.fillStyle = '#e8c870'; g.font = 'bold 38px Arial'; g.fillText(s.heading, 40, y + 34); y += 54; }
      if (s.text){ g.fillStyle = '#e8e8e0'; g.font = '32px Arial'; for (const l of wrapText(g, s.text, W - 80)){ g.fillText(l, 40, y + 30); y += 42; } y += 10; }
      if (s.list){ g.fillStyle = '#e8e8e0'; g.font = '30px Arial'; for (const it of s.list){ for (const [k, l] of wrapText(g, '• ' + it, W - 90).entries()){ g.fillText((k ? '   ' : '') + l, 44, y + 30); y += 40; } } y += 10; }
      if (s.bars){
        for (const [label, v, note] of s.bars){
          g.fillStyle = '#e8e8e0'; g.font = '30px Arial'; g.fillText(label, 40, y + 30);
          g.fillStyle = '#2a2a2a'; roundRect(g, 300, y + 8, 520, 28, 14); g.fill();
          g.fillStyle = v > 66 ? '#5cb85c' : v > 33 ? '#e8b83a' : '#d9534f'; roundRect(g, 300, y + 8, Math.max(28, 520 * clamp(v, 0, 100) / 100), 28, 14); g.fill();
          if (note){ g.fillStyle = '#b8b8a8'; g.font = '26px Arial'; g.fillText(note, 836, y + 30); }
          y += 46;
        }
        y += 10;
      }
      if (s.rows){
        for (const row of s.rows){
          g.fillStyle = 'rgba(255,255,255,0.06)'; roundRect(g, 30, y, W - 60, 92, 14); g.fill();
          g.fillStyle = '#f4f0e4'; g.font = 'bold 32px Arial'; g.fillText(row.title, 50, y + 40);
          if (row.sub){ g.fillStyle = '#b8b8a8'; g.font = '26px Arial'; g.fillText(row.sub.slice(0, 52), 50, y + 76); }
          if (row.button) this.button(g, row.button, W - 260, y + 14, 210, 64);
          y += 102;
        }
        y += 6;
      }
      if (s.buttons){
        let x = 30;
        for (const b of s.buttons){
          g.font = 'bold 34px Arial'; const w = Math.max(160, g.measureText(b.label).width + 50);
          if (x + w > W - 30){ x = 30; y += 84; }
          this.button(g, b, x, y, w, 72, b.kind === 'primary' ? '#3a8a4a' : b.kind === 'danger' ? '#9a3a30' : undefined); x += w + 14;
        }
        y += 96;
      }
    }
    this.contentH = y + this.scroll;
    if (this.contentH > H){ g.fillStyle = '#c8a050'; g.font = '28px Arial'; g.fillText('▲▼ right stick to scroll', W - 360, H - 24); }
    this.tc.tex.needsUpdate = true;
  }
  button(g, b, x, y, w, h, col){
    const i = this.hits.length;
    g.fillStyle = b.disabled ? '#3a3a3a' : (this.hover === i ? '#e8c870' : col || '#55705a');
    roundRect(g, x, y, w, h, 14); g.fill();
    g.fillStyle = b.disabled ? '#777' : this.hover === i ? '#1a1a1a' : '#ffffff'; g.font = 'bold 32px Arial'; g.textAlign = 'center';
    g.fillText(b.label, x + w / 2, y + h / 2 + 11); g.textAlign = 'left';
    this.hits.push({ x, y, w, h, b });
  }
  // a ray from the controller: returns the hit point (for drawing the laser) and handles hover/click
  ray(origin, dir, click){
    if (!this.mesh.visible) return null;
    const rc = new THREE.Raycaster(origin, dir, 0, 4);
    const hit = rc.intersectObject(this.mesh)[0];
    if (!hit){ if (this.hover !== -1){ this.hover = -1; this.draw(); } return null; }
    const px = hit.uv.x * this.W, py = (1 - hit.uv.y) * this.H;
    const i = this.hits.findIndex((r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h);
    if (i !== this.hover){ this.hover = i; this.draw(); }
    if (click && i >= 0 && !this.hits[i].b.disabled){ const b = this.hits[i].b; this.hover = -1; b.go(); return { point: hit.point, clicked: true }; }
    return { point: hit.point };
  }
  scrollBy(d){ if (!this.open || !this.contentH || this.contentH <= this.H) return; this.scroll = clamp(this.scroll + d, 0, this.contentH - this.H + 40); this.draw(); }
}

// ---------- the little screen on your left wrist in VR ----------
export class WristPanel {
  constructor(){
    this.tc = textCanvas(512, 320);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.075), new THREE.MeshBasicMaterial({ map: this.tc.tex, toneMapped: false }));
  }
  draw(lines){
    const g = this.tc.ctx;
    g.fillStyle = '#1a2a20'; g.fillRect(0, 0, 512, 320);
    g.strokeStyle = '#c8a050'; g.lineWidth = 8; g.strokeRect(4, 4, 504, 312);
    g.textAlign = 'left';
    lines.forEach((l, i) => { g.fillStyle = i === 0 ? '#f4e8c8' : '#cfe8d0'; g.font = i === 0 ? 'bold 44px Arial' : '34px Arial'; g.fillText(String(l).slice(0, 26), 22, 56 + i * 62); });
    this.tc.tex.needsUpdate = true;
  }
}
