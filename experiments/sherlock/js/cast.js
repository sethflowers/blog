// Your own people: add family and friends to the train from three photos (the front of the face, the
// left side and the right side), taken with the camera or picked from the photo library. On an iPad a
// file input gives the system's "Take Photo / Photo Library" choice, so there's no camera permission.
//
// Each photo is lined up with an outline (drag to move, pinch or the buttons to zoom), so the face is
// always in the same place and no face-recognition is needed. The game then paints a 3D head: the front
// photo on the face, the side photos on the sides, hair colour behind, skin colour under the chin, and
// it rides on the person's avatar in place of the avatar's own head.
//
// Photos never leave the device: they're stored small (384 px) in this browser's IndexedDB.
import * as THREE from 'three';
import { AVATARS, PROFESSIONS, HAIRS, HAIR_HEX } from './mystery.js';

// ---------- storage ----------
const DB = 'sherlock-cast', STORE = 'people';
function db(){
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn){ const d = await db(); return new Promise((res, rej) => { const t = d.transaction(STORE, mode); const s = t.objectStore(STORE); const out = fn(s); t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = () => rej(t.error); }); }
export async function listCast(){ try { const d = await db(); return await new Promise((res) => { const r = d.transaction(STORE).objectStore(STORE).getAll(); r.onsuccess = () => res(r.result.sort((a, b) => a.created - b.created)); r.onerror = () => res([]); }); } catch (e) { return []; } }
export const saveCast = (p) => tx('readwrite', (s) => s.put(p));
export const deleteCast = (id) => tx('readwrite', (s) => s.delete(id));
// what a mystery needs to know about each of your people (no photos)
export const castInfo = (p) => ({ id: p.id, name: p.name, female: p.female, avatar: p.avatar, prof: p.prof || null, hair: p.hair, height: p.height || null, neverVictim: p.neverVictim !== false });

// ---------- the photos, lined up ----------
const PH = 384;                 // stored photo size
// where the head goes in a stored photo: the oval for the front, the same height for the sides
const FX = 0.30, FY = 0.40, SZ = 0.33;
async function toCanvas(blob){
  const c = document.createElement('canvas'); c.width = c.height = PH;
  if (!blob) return null;
  const bmp = await createImageBitmap(blob);
  c.getContext('2d').drawImage(bmp, 0, 0, PH, PH);
  if (bmp.close) bmp.close();
  return c;
}

// the shape of the head: a sphere pushed into a head (narrower jaw, a nose, a brow, a chin, ears)
function deform(x, y, z){
  const d = { x, y, z };
  if (y < 0.15){ const t = (0.15 - y) / 1.15; x *= 1 - 0.32 * t * t; z *= 1 - 0.1 * t; }
  if (z > 0) z *= 0.9;
  const f = Math.max(0, d.z);
  z += 0.17 * Math.exp(-((x / 0.13) ** 2 + ((y + 0.1) / 0.2) ** 2)) * f;           // nose
  z += 0.05 * Math.exp(-((x / 0.55) ** 2 + ((y - 0.2) / 0.08) ** 2)) * f;           // brow
  z += 0.05 * Math.exp(-((x / 0.25) ** 2 + ((y + 0.82) / 0.14) ** 2)) * f;          // chin
  x += Math.sign(x) * 0.09 * Math.exp(-(((Math.abs(d.x) - 1) / 0.14) ** 2 + (y / 0.2) ** 2 + ((d.z + 0.05) / 0.25) ** 2));   // ears
  return [x, y, z];
}
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
function avg(data, u, v, r = 8){
  let R = 0, G = 0, B = 0, n = 0; const cx = Math.round(u * PH), cy = Math.round(v * PH);
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++){ if (x < 0 || y < 0 || x >= PH || y >= PH) continue; const i = (y * PH + x) * 4; R += data[i]; G += data[i + 1]; B += data[i + 2]; n++; }
  return n ? [R / n, G / n, B / n] : [200, 160, 140];
}
// paint the head's texture (an equirectangular map of the sphere) from the three photos
function bake(front, left, right, hairName){
  const W = 512, H = 256, out = document.createElement('canvas'); out.width = W; out.height = H;
  const g = out.getContext('2d'), img = g.createImageData(W, H), D = img.data;
  const read = (c) => (c ? c.getContext('2d').getImageData(0, 0, PH, PH).data : null);
  const F = read(front), L = read(left), R = read(right);
  const skin = F ? avg(F, 0.37, 0.58).map((v, i) => (v + avg(F, 0.63, 0.58)[i]) / 2) : [210, 170, 145];
  const hc = new THREE.Color(HAIR_HEX[hairName] || '#5a3a20'); hc.convertLinearToSRGB();
  const hairPhoto = F ? avg(F, 0.5, 0.13, 10) : null;
  const hair = hairPhoto ? hairPhoto.map((v, i) => v * 0.6 + [hc.r, hc.g, hc.b][i] * 255 * 0.4) : [hc.r * 255, hc.g * 255, hc.b * 255];
  const sample = (data, u, v) => { const x = Math.min(PH - 1, Math.max(0, Math.round(u * PH))), y = Math.min(PH - 1, Math.max(0, Math.round(v * PH))); const i = (y * PH + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  for (let py = 0; py < H; py++){
    const th = Math.PI * (py + 0.5) / H;
    for (let px = 0; px < W; px++){
      const ph = 2 * Math.PI * (px + 0.5) / W;
      const nx = -Math.cos(ph) * Math.sin(th), ny = Math.cos(th), nz = Math.sin(ph) * Math.sin(th);
      const [x, y, z] = deform(nx, ny, nz);
      let wf = F ? smooth(0.1, 0.7, nz) : 0, wl = L ? smooth(0.15, 0.75, nx) : 0, wr = R ? smooth(0.15, 0.75, -nx) : 0;
      if (ny < -0.75){ wf *= 0.3; wl *= 0.3; wr *= 0.3; }
      let sum = wf + wl + wr;
      const fall = ny < -0.55 ? skin : hair;
      let r = 0, gg = 0, b = 0;
      if (wf){ const c = sample(F, 0.5 + x * FX, 0.5 - y * FY); r += c[0] * wf; gg += c[1] * wf; b += c[2] * wf; }
      if (wl){ const c = sample(L, 0.5 - z * SZ, 0.5 - y * FY); r += c[0] * wl; gg += c[1] * wl; b += c[2] * wl; }
      if (wr){ const c = sample(R, 0.5 + z * SZ, 0.5 - y * FY); r += c[0] * wr; gg += c[1] * wr; b += c[2] * wr; }
      if (sum < 1){ const k = 1 - sum; r += fall[0] * k; gg += fall[1] * k; b += fall[2] * k; sum = 1; }
      const i = (py * W + px) * 4; D[i] = r / sum; D[i + 1] = gg / sum; D[i + 2] = b / sum; D[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return { canvas: out, skin, hair };
}
let headGeo = null;
function headGeometry(){
  if (headGeo) return headGeo;
  const g = new THREE.SphereGeometry(1, 56, 40), p = g.attributes.position;
  for (let i = 0; i < p.count; i++){ const [x, y, z] = deform(p.getX(i), p.getY(i), p.getZ(i)); p.setXYZ(i, x, y, z); }
  g.computeVertexNormals(); g.userData.keep = true;
  headGeo = g; return g;
}
let neckGeo = null;
function neckGeometry(){ if (!neckGeo){ neckGeo = new THREE.CylinderGeometry(0.56, 0.62, 1.0, 20); neckGeo.translate(0, -1.0, -0.15); neckGeo.userData.keep = true; } return neckGeo; }

// a person's photo head: a function that builds a unit head (chin y = -1, crown y = +1), for Person
const baked = new Map();      // cast id → { canvas, skin, hair }
export async function prepareHead(p){
  if (baked.has(p.id + p.updated)) return baked.get(p.id + p.updated);
  const [f, l, r] = await Promise.all([toCanvas(p.photos && p.photos.front), toCanvas(p.photos && p.photos.left), toCanvas(p.photos && p.photos.right)]);
  if (!f) return null;
  const b = bake(f, l, r, p.hair);
  baked.set(p.id + p.updated, b);
  return b;
}
export function makeHead(b){
  return () => {
    const t = new THREE.CanvasTexture(b.canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.7 }); m.userData.own = true;
    const skin = new THREE.Color(`rgb(${b.skin.map(Math.round).join(',')})`);
    const nm = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7 }); nm.userData.own = true;
    const G = new THREE.Group();
    const head = new THREE.Mesh(headGeometry(), m), neck = new THREE.Mesh(neckGeometry(), nm);
    head.frustumCulled = neck.frustumCulled = false;
    G.add(head, neck);
    return G;
  };
}

// ---------- the editor (on a screen only: not in VR) ----------
const AV_LOOK = ['Pink shirt, jeans', 'Purple top', 'Brown leather jacket', 'Pink blazer, jeans', 'Headscarf, olive dress', 'Grey T-shirt, jeans', 'Black dress and scarf', 'Brown dress, boots', 'Black hoodie, shorts',
  'Striped polo, shorts', 'Beige jumper', 'Tweed jacket', 'Black hoodie', 'Gilet, green sleeves', 'Red top, jeans', 'Blue shirt', 'Red tracksuit top', 'Denim jacket'];
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

export class CastEditor {
  constructor(root, { onChange } = {}){
    this.root = root; this.onChange = onChange;
  }
  async open(){ this.root.classList.add('show'); this.people = await listCast(); this.list(); }
  close(){ this.root.classList.remove('show'); this.root.innerHTML = ''; if (this.onChange) this.onChange(); }
  frame(title, back, R = this.root){
    R.innerHTML = '';
    const card = el('div', 'cast-card'), head = el('div', 'phead'), h = el('h2', null, title);
    head.appendChild(h);
    const x = el('button', 'x', back ? '‹ Back' : '✕'); x.onclick = back || (() => this.close()); head.appendChild(x);
    card.appendChild(head);
    const body = el('div', 'pbody'); card.appendChild(body); R.appendChild(card);
    return body;
  }
  async list(){
    const body = this.frame('🎭 Your own people');
    body.appendChild(el('p', 'cast-intro', 'Put your family and friends on the train! Take three photos of each person (the front of their face, and each side). The photos stay on this device.'));
    for (const p of this.people){
      const row = el('div', 'row');
      const img = el('img', 'ricon');
      if (p.photos && p.photos.front) img.src = URL.createObjectURL(p.photos.front);
      row.appendChild(img);
      const t = el('div', 'rl'); t.appendChild(el('b', null, p.name)); t.appendChild(el('small', null, `${p.prof ? PROFESSIONS.find((q) => q.id === p.prof).name : 'Any job'} · ${p.neverVictim !== false ? 'never the victim' : 'can be the victim'}`)); row.appendChild(t);
      const e = el('button', null, 'Edit'); e.onclick = () => this.edit(p); row.appendChild(e);
      body.appendChild(row);
    }
    const btns = el('div', 'btns');
    const add = el('button', 'primary', '➕ Add a person'); add.onclick = () => this.edit(null); btns.appendChild(add);
    const done = el('button', null, 'Done'); done.onclick = () => this.close(); btns.appendChild(done);
    body.appendChild(btns);
    if (this.people.length) body.appendChild(el('p', 'cast-intro', `Up to 7 of your people go on each new mystery (start one with "Use my people" ticked).`));
  }
  edit(p){
    const isNew = !p;
    const P = p ? { ...p, photos: { ...(p.photos || {}) } } : { id: 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1e4), name: '', female: false, avatar: 9, prof: '', hair: 'brown', height: '', neverVictim: true, photos: {}, created: Date.now() };
    const body = this.frame(isNew ? 'Add a person' : 'Edit ' + p.name, () => this.list());
    const sec = (title) => { const s = el('div', 'psec'); s.appendChild(el('h3', null, title)); body.appendChild(s); return s; };
    // name
    const sn = sec('Name');
    const name = el('input', 'cast-input'); name.value = P.name; name.placeholder = 'e.g. Grandma Rose'; name.maxLength = 24; name.oninput = () => { P.name = name.value; };
    sn.appendChild(name);
    // photos
    const sp = sec('Photos');
    sp.appendChild(el('p', 'cast-intro', 'Tap each one to take a photo or choose one. Fill the outline with the face, from the chin to the top of the head.'));
    const slots = el('div', 'cast-slots');
    for (const [k, label] of [['front', 'Front'], ['left', 'Their left side'], ['right', 'Their right side']]){
      const b = el('button', 'cast-slot');
      const im = el('img'); if (P.photos[k]) im.src = URL.createObjectURL(P.photos[k]); else im.src = guideIcon(k);
      b.appendChild(im); b.appendChild(el('span', null, label));
      b.onclick = () => pickFile((file) => this.align(file, k, (blob) => { P.photos[k] = blob; im.src = URL.createObjectURL(blob); }));
      slots.appendChild(b);
    }
    sp.appendChild(slots);
    // body
    const sb = sec('Body and clothes');
    const gb = el('div', 'grid');
    const drawBodies = () => {
      gb.innerHTML = '';
      AVATARS.forEach((A, i) => {
        const b = el('button', P.avatar === i ? 'on' : ''); b.appendChild(el('span', null, (A.female ? '👩 ' : '👨 ') + AV_LOOK[i]));
        const sw = el('i', 'swatch'); sw.style.background = { pink: '#e48aa8', purple: '#8a4ab0', brown: '#6a4428', green: '#5a6a30', grey: '#8a8a8a', black: '#222226', white: '#eeeeea', beige: '#cdb894', red: '#b02a2a', blue: '#3a5a9a' }[A.coat]; b.prepend(sw);
        b.onclick = () => { P.avatar = i; P.female = A.female; drawBodies(); };
        gb.appendChild(b);
      });
    };
    drawBodies(); sb.appendChild(gb);
    // hair, height, job
    const sh = sec('Hair colour'); const gh = el('div', 'btns');
    const drawHair = () => { gh.innerHTML = ''; for (const h of HAIRS){ const b = el('button', P.hair === h ? 'on' : '', h); b.onclick = () => { P.hair = h; drawHair(); }; gh.appendChild(b); } };
    drawHair(); sh.appendChild(gh);
    const st = sec('Height'); const gt = el('div', 'btns');
    const drawH = () => { gt.innerHTML = ''; for (const [v, l] of [['', 'Any'], ['short', 'Short'], ['medium', 'Medium'], ['tall', 'Tall']]){ const b = el('button', P.height === v ? 'on' : '', l); b.onclick = () => { P.height = v; drawH(); }; gt.appendChild(b); } };
    drawH(); st.appendChild(gt);
    const sj = sec('Job'); const sel = el('select', 'cast-input');
    sel.appendChild(new Option('Any job (a different one each mystery)', ''));
    for (const q of PROFESSIONS) sel.appendChild(new Option(`${q.icon} ${q.name}`, q.id));
    sel.value = P.prof || ''; sel.onchange = () => { P.prof = sel.value; }; sj.appendChild(sel);
    // never the victim
    const sv = sec('In the mystery');
    const lab = el('label', 'cast-check'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = P.neverVictim !== false; cb.onchange = () => { P.neverVictim = cb.checked; };
    lab.appendChild(cb); lab.appendChild(el('span', null, 'Never the victim (they can still be a suspect, or the murderer!)')); sv.appendChild(lab);
    // save / delete
    const btns = el('div', 'btns');
    const save = el('button', 'primary', '💾 Save'); save.onclick = async () => {
      if (!P.name.trim()){ name.focus(); name.classList.add('bad'); return; }
      if (!P.photos.front){ alert('Please add a photo of the front of their face.'); return; }
      P.name = P.name.trim(); P.updated = Date.now();
      await saveCast(P); this.people = await listCast(); this.list();
    };
    btns.appendChild(save);
    if (!isNew){ const del = el('button', 'danger', '🗑 Delete'); del.onclick = async () => { if (!confirm(`Delete ${p.name} and their photos?`)) return; await deleteCast(p.id); this.people = await listCast(); this.list(); }; btns.appendChild(del); }
    body.appendChild(btns);
  }
  // line a photo up with the outline: drag to move, pinch (or the buttons / mouse wheel) to zoom
  async align(file, kind, done){
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { try { bmp = await createImageBitmap(file); } catch (e2) { alert('Sorry, that picture could not be opened.'); return; } }
    // a layer over the edit page (which stays as it is underneath)
    const layer = el('div', 'cast-layer'); this.root.appendChild(layer);
    const body = this.frame({ front: 'Line up the front', left: 'Line up their left side', right: 'Line up their right side' }[kind], () => { layer.remove(); this.aligning = null; }, layer);
    body.appendChild(el('p', 'cast-intro', kind === 'front' ? 'Drag and pinch so the face fills the oval: chin on the bottom, top of the head at the top, eyes on the line.' : 'Drag and pinch so the head fits the outline, nose pointing the way of the arrow. Flip it if it faces the wrong way.'));
    const S = 360, cv = el('canvas', 'cast-align'); cv.width = cv.height = S; body.appendChild(cv);
    const g = cv.getContext('2d');
    const st = { s: Math.max(S / bmp.width, S / bmp.height), x: S / 2, y: S / 2, flip: false };
    const draw = () => {
      g.fillStyle = '#222'; g.fillRect(0, 0, S, S);
      g.save(); g.translate(st.x, st.y); g.scale(st.s * (st.flip ? -1 : 1), st.s); g.drawImage(bmp, -bmp.width / 2, -bmp.height / 2); g.restore();
      // the outline
      g.save(); g.strokeStyle = '#ffd84a'; g.lineWidth = 3; g.setLineDash([10, 6]);
      if (kind === 'front'){
        g.beginPath(); g.ellipse(S / 2, S / 2, S * FX, S * FY, 0, 0, Math.PI * 2); g.stroke();
        g.setLineDash([4, 6]); g.beginPath(); g.moveTo(S * 0.25, S * 0.47); g.lineTo(S * 0.75, S * 0.47); g.stroke();
      } else {
        const nose = kind === 'left' ? -1 : 1;
        g.beginPath(); g.ellipse(S / 2, S / 2, S * SZ, S * FY, 0, 0, Math.PI * 2); g.stroke();
        g.setLineDash([]); g.fillStyle = '#ffd84a'; g.beginPath(); const ax = S / 2 + nose * S * 0.42; g.moveTo(ax, S * 0.47); g.lineTo(ax - nose * 22, S * 0.43); g.lineTo(ax - nose * 22, S * 0.51); g.closePath(); g.fill();
      }
      g.restore();
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, S - 26, S, 26); g.fillStyle = '#fff'; g.font = 'bold 15px Arial'; g.textAlign = 'center'; g.fillText(kind === 'front' ? 'chin at the bottom of the oval' : 'nose towards the arrow ' + (kind === 'left' ? '◀' : '▶'), S / 2, S - 8);
    };
    draw();
    // drag and pinch
    const pts = new Map(); let last = null;
    cv.style.touchAction = 'none';
    cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.offsetX, y: e.offsetY }); last = null; });
    cv.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      const k = S / cv.clientWidth, p = pts.get(e.pointerId), dx = (e.offsetX - p.x) * k, dy = (e.offsetY - p.y) * k;
      pts.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (pts.size === 1){ st.x += dx; st.y += dy; }
      else if (pts.size === 2){ const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y); if (last) st.s *= d / last; last = d; }
      draw();
    });
    const up = (e) => { pts.delete(e.pointerId); last = null; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up); cv.addEventListener('lostpointercapture', up);
    cv.addEventListener('wheel', (e) => { e.preventDefault(); st.s *= Math.exp(-e.deltaY * 0.001); draw(); }, { passive: false });
    const btns = el('div', 'btns');
    const zb = (l, f) => { const b = el('button', null, l); b.onclick = () => { f(); draw(); }; btns.appendChild(b); };
    zb('➖', () => { st.s /= 1.1; }); zb('➕', () => { st.s *= 1.1; });
    if (kind !== 'front') zb('↔ Flip', () => { st.flip = !st.flip; });
    const ok = el('button', 'primary', '✓ Use this photo');
    ok.onclick = () => {
      const out = document.createElement('canvas'); out.width = out.height = PH; const o = out.getContext('2d'), k = PH / S;
      o.fillStyle = '#808080'; o.fillRect(0, 0, PH, PH);
      o.save(); o.scale(k, k); o.translate(st.x, st.y); o.scale(st.s * (st.flip ? -1 : 1), st.s); o.drawImage(bmp, -bmp.width / 2, -bmp.height / 2); o.restore();
      out.toBlob((blob) => { if (bmp.close) bmp.close(); layer.remove(); this.aligning = null; done(blob); }, 'image/jpeg', 0.88);
    };
    btns.appendChild(ok);
    body.appendChild(btns);
    // the test can line things up straight away
    this.aligning = { ok: () => ok.onclick(), st, draw };
  }
}
// the outline as a little picture, for an empty photo slot
const guideCache = {};
function guideIcon(kind){
  if (guideCache[kind]) return guideCache[kind];
  const c = document.createElement('canvas'); c.width = c.height = 96; const g = c.getContext('2d');
  g.fillStyle = '#e8dcc0'; g.fillRect(0, 0, 96, 96); g.strokeStyle = '#8a6a3a'; g.lineWidth = 3; g.setLineDash([6, 4]);
  g.beginPath(); g.ellipse(48, 46, kind === 'front' ? 24 : 26, 32, 0, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
  g.fillStyle = '#8a6a3a'; g.font = '30px Arial'; g.textAlign = 'center'; g.fillText(kind === 'front' ? '🙂' : kind === 'left' ? '◀' : '▶', 48, 58);
  return (guideCache[kind] = c.toDataURL());
}
function pickFile(cb){
  const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.style.display = 'none'; i.id = 'cast-file';
  i.onchange = () => { const f = i.files && i.files[0]; i.remove(); if (f) cb(f); };
  document.body.appendChild(i); i.click();
}
