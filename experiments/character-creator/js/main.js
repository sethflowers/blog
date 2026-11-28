// Character Creator: a designer for people, from photo-real to cartoon. The person stands on a
// turntable in a studio; tabs down the left, sliders and choices on the right. Save them with a name,
// and take them to another device (or another game) with a short code or a seed number.
//  - iPad / computer: drag to turn the person, pinch or the wheel to zoom, the camera frames what
//    you're editing. Ctrl+Z / Ctrl+Y undo and redo.
//  - VR: the person life-size in front of you, the same panel as a board beside them.
import * as THREE from 'three';
import { Studio, LIGHTS } from './studio.js';
import { Character, loadCharacterData, SAVE_KEY } from './character.js';
import { CATEGORIES, CONTROLS, CONTROL, get, set, defaults, clone, upgrade, randomize, fromSeed, fromCode, toCode, PRESETS, snap, MAX_SEED } from './spec.js';
import { ScreenPanel, VRBoard } from './ui.js';
import { VR } from './vr.js';
import { clamp } from './util.js';

if (window.__loading) await window.__loading();

const $ = (id) => document.getElementById(id);
const VERSION = document.body.dataset.version || '';

// ---------- the studio and the person ----------
const studio = new Studio();
const data = await loadCharacterData();
const character = new Character(data);
studio.person.add(character.root);
const castShadows = () => character.root.traverse((m) => { if (m.isMesh){ m.castShadow = !m.material || !m.material.transparent; m.receiveShadow = true; } });

// ---------- saves ----------
// { characters: [{ id, name, spec, code, thumb, updated }], current: spec, currentId, light, cat }
let save = load();
function load(){
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (s && typeof s === 'object') return { characters: [], ...s, characters: (s.characters || []).map((c) => ({ ...c, spec: upgrade(c.spec) })) }; } catch (e) { /* a broken save starts afresh */ }
  return { characters: [] };
}
function store(){ try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { toast('Could not save on this device (storage is full?)', true); } }

let spec = save.current ? upgrade(save.current) : clone(PRESETS()[0]);
let currentId = save.currentId || null;
let cat = save.cat && CATEGORIES.some((c) => c.id === save.cat) ? save.cat : 'presets';
const undoStack = [], redoStack = [];
const groupOpen = {};
let mode = 'title';

// ---------- rebuilding: one at a time, the latest wins ----------
let building = false, pending = false, lastBuilt = null;
async function rebuild(){
  if (building){ pending = true; return; }
  building = true;
  try {
    do {
      pending = false;
      const s = clone(spec);
      const t0 = performance.now();
      await character.set(s);
      lastBuilt = s;
      castShadows();
      stats.build = performance.now() - t0;
    } while (pending);
  } catch (e) { console.error(e); toast('Something went wrong making the person: ' + e.message, true); }
  building = false;
  panel.refresh(); drawBoard();
  $('name').value = spec.name || '';
}
const stats = { build: 0 };
function changed(record = true){
  if (record) pushUndo();
  rebuild();
  autosave();
}
let lastUndoSpec = JSON.stringify(spec);
function pushUndo(){
  const s = JSON.stringify(spec);
  if (s === lastUndoSpec) return;
  undoStack.push(lastUndoSpec); if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0; lastUndoSpec = s;
  refreshTop();
}
function undo(){ if (!undoStack.length) return; redoStack.push(JSON.stringify(spec)); spec = JSON.parse(undoStack.pop()); lastUndoSpec = JSON.stringify(spec); afterBigChange(); }
function redo(){ if (!redoStack.length) return; undoStack.push(JSON.stringify(spec)); spec = JSON.parse(redoStack.pop()); lastUndoSpec = JSON.stringify(spec); afterBigChange(); }
function afterBigChange(){ rebuild(); autosave(); showCat(cat); refreshTop(); }
let saveTimer = 0;
function autosave(){ clearTimeout(saveTimer); saveTimer = setTimeout(() => { save.current = spec; save.currentId = currentId; save.cat = cat; store(); }, 600); }
function replaceSpec(s, keepId = false){ pushUndoFrom(); spec = upgrade(s); if (!keepId) currentId = null; lastUndoSpec = JSON.stringify(spec); afterBigChange(); }
function pushUndoFrom(){ undoStack.push(JSON.stringify(spec)); if (undoStack.length > 100) undoStack.shift(); redoStack.length = 0; }

// ---------- what each tab shows ----------
const pct = (v) => (v > 0 ? '+' : '') + Math.round(v * 100);
function sliderRow(c){
  return {
    kind: 'slider', label: c.label, min: c.min, max: c.max, def: c.def, hint: c.hint,
    get: () => get(spec, c.key) ?? c.def,
    set: (v, done) => {
      v = snap(c, clamp(v, c.min, c.max));
      if (c.mod && !v) delete spec.mods[c.key.slice(5)]; else set(spec, c.key, v);
      if (c.key.startsWith('macro.') && ['african', 'asian', 'caucasian'].includes(c.key.slice(6))) balanceAncestry(c.key.slice(6));
      if (done) changed(); else rebuild();
    },
    text: (v) => {
      if (c.key === 'macro.age') return Math.round(v) + ' years';
      if (c.key === 'macro.height') return lastBuilt ? Math.round(character.height() * 100) + ' cm' : '';
      if (['african', 'asian', 'caucasian'].some((k) => c.key === 'macro.' + k)) return Math.round(v * 100) + '%';
      if (c.min < 0) return pct(v);
      return Math.round(v * 100) + '%';
    },
  };
}
// the three ancestries add up to 100%
function balanceAncestry(moved){
  const keys = ['african', 'asian', 'caucasian'], m = spec.macro, others = keys.filter((k) => k !== moved);
  const rest = 1 - m[moved], sum = others.reduce((t, k) => t + m[k], 0);
  for (const k of others) m[k] = sum > 1e-6 ? m[k] / sum * rest : rest / 2;
}
function controlRow(c){
  if (c.type === 'slider') return sliderRow(c);
  if (c.type === 'color') return { kind: 'colors', label: c.label, palette: c.palette, get: () => get(spec, c.key), set: (v) => { set(spec, c.key, v); if (c.key === 'hair.color' && spec.brows.color === lastHair){ spec.brows.color = v; } lastHair = spec.hair.color; changed(); } };
  return { kind: 'choices', label: c.label, options: c.options, grid: c.grid, get: () => get(spec, c.key), set: (v) => { set(spec, c.key, v); changed(); } };
}
let lastHair = spec.hair.color;
function rowsFor(id, vr = false){
  const rows = [];
  if (id === 'presets'){
    rows.push({ kind: 'buttons', items: [{ label: '🎲 Random person', go: () => randomPerson() }, { label: '＋ Blank', go: () => { replaceSpec({ ...defaults(), style: { ...spec.style } }); toast('A fresh start'); } }] });
    rows.push({ kind: 'text', text: `Every random person has a number: ${spec.seed ? 'this is Person ' + spec.seed + '.' : 'type one in to get that person on any device.'}` });
    if (!vr) rows.push({ kind: 'input', placeholder: `Person number (1 to ${MAX_SEED}) or a code`, button: 'Make', go: (v) => openCode(v) });
    rows.push({ kind: 'group', text: 'Start from' });
    rows.push({ kind: 'cards', items: PRESETS().map((p) => ({ label: p.name, img: presetThumbs[p.name], on: spec.presetOf === p.name && !spec.seed, go: () => { replaceSpec(p); toast(p.name); } })) });
    return rows;
  }
  if (id === 'saved'){
    rows.push({ kind: 'group', text: 'This character' });
    rows.push({ kind: 'code', text: toCode(spec) });
    rows.push({ kind: 'text', text: 'Type this code (or scan it into a note) on another device, or into another game, to get exactly this person.' + (spec.seed ? ` They started as Person ${spec.seed}.` : '') });
    if (!vr) rows.push({ kind: 'buttons', items: [{ label: '📋 Copy code', go: copyCode }, { label: '💾 Save', go: saveCurrent }] });
    else rows.push({ kind: 'buttons', items: [{ label: '💾 Save', go: saveCurrent }] });
    if (!vr) rows.push({ kind: 'input', placeholder: 'Paste a code (CC2-…) or a number', button: 'Open', go: (v) => openCode(v) });
    rows.push({ kind: 'group', text: `My characters (${save.characters.length})` });
    if (!save.characters.length) rows.push({ kind: 'text', text: 'Nobody saved yet. Press 💾 Save at the top to keep this person.' });
    rows.push({ kind: 'cards', items: save.characters.slice().sort((a, b) => b.updated - a.updated).map((c) => ({
      label: c.name || 'No name', img: c.thumb, on: c.id === currentId, go: () => openSaved(c),
      actions: vr ? null : [{ label: 'Copy', go: () => duplicate(c) }, { label: 'Delete', danger: true, go: () => removeSaved(c) }],
    })) });
    return rows;
  }
  if (id === 'style'){
    rows.push({ kind: 'choices', label: 'Light', options: LIGHTS.map((l) => ({ value: l.id, label: l.label })), get: () => studio.lightId, set: (v) => { studio.setLight(v); save.light = v; autosave(); store(); } });
  }
  let group = null, mods = false;
  for (const c of CONTROLS){
    if (c.cat !== id) continue;
    if (c.only && !c.only(spec)) continue;
    if (c.group !== group){
      group = c.group;
      if (group){
        const key = id + '/' + group, fold = !!c.mod;
        if (fold && groupOpen[key] === undefined && !rows.some((r) => r.kind === 'group' && r.toggle)) groupOpen[key] = true;
        const open = groupOpen[key] ?? !fold;
        rows.push({ kind: 'group', text: group, open, toggle: fold ? () => { groupOpen[key] = !open; showCat(cat); } : null });
        mods = fold && !open;
      } else mods = false;
    }
    if (mods) continue;
    rows.push(controlRow(c));
  }
  return rows;
}

// ---------- the screen's panel and tabs ----------
const panel = new ScreenPanel();
function buildTabs(){
  const T = $('tabs'); T.innerHTML = '';
  for (const c of CATEGORIES){
    const b = document.createElement('button');
    b.innerHTML = `${c.icon}<small>${c.label}</small>`; b.dataset.cat = c.id; b.title = c.label;
    b.onclick = () => { if (document.body.classList.contains('portrait') && SHEET.h <= SHEET.min + 4) setSheet(window.innerHeight * 0.48); showCat(c.id); };
    T.appendChild(b);
  }
}
function showCat(id){
  const prev = cat; cat = id;
  for (const b of $('tabs').children){ b.classList.toggle('on', b.dataset.cat === id); if (b.dataset.cat === id && b.scrollIntoView) b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  const C = CATEGORIES.find((c) => c.id === id);
  panel.render(C.label, rowsFor(id));
  $('b-catrand').style.display = ['presets', 'saved'].includes(id) ? 'none' : '';
  $('b-catreset').style.display = ['presets', 'saved', 'style'].includes(id) ? 'none' : '';
  if (prev !== id || !studio.framing) frameFor(C.frame);
  drawBoard();
  autosave();
}
function frameFor(kind){
  studio.frame(kind, character);
  for (const b of $('views').children) b.classList.toggle('on', b.dataset.v === kind);
}
function refreshTop(){ $('b-undo').disabled = !undoStack.length; $('b-redo').disabled = !redoStack.length; }

// ---------- actions ----------
function randomPerson(){
  const seed = 1 + Math.floor(Math.random() * MAX_SEED);
  const s = fromSeed(seed); s.style = { ...spec.style };
  replaceSpec(s);
  toast(`Person ${seed}`);
}
function openCode(v){
  try { const s = fromCode(v); replaceSpec(s); toast(`Opened ${s.name || 'the character'}`); } catch (e) { toast(e.message, true); }
}
async function copyCode(){
  const code = toCode(spec);
  try { await navigator.clipboard.writeText(code); toast('Code copied'); }
  catch (e) { toast('Select the code and copy it: ' + code); }
}
function saveCurrent(){
  if (!spec.name){ spec.name = prompt('What are they called?', 'Person ' + (save.characters.length + 1)) || ''; if (!spec.name) return; $('name').value = spec.name; }
  let thumb = null;
  try { thumb = studio.thumbnail(character); } catch (e) { /* no picture */ }
  const entry = currentId && save.characters.find((c) => c.id === currentId);
  const rec = { id: currentId || 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1e4), name: spec.name, spec: clone(spec), code: toCode(spec), thumb, updated: Date.now() };
  if (entry) Object.assign(entry, rec); else save.characters.push(rec);
  currentId = rec.id;
  store(); autosave();
  toast(`Saved ${spec.name}`);
  if (cat === 'saved') showCat('saved');
}
function openSaved(c){ replaceSpec(c.spec); currentId = c.id; toast(`Opened ${c.name}`); autosave(); }
function duplicate(c){ const s = clone(c.spec); s.name = (c.name || 'Person') + ' 2'; replaceSpec(s); toast('A copy: change it and save'); }
function removeSaved(c){
  if (!confirm(`Delete ${c.name || 'this character'}? This can't be undone.`)) return;
  save.characters = save.characters.filter((x) => x !== c);
  if (currentId === c.id) currentId = null;
  store(); showCat('saved'); toast('Deleted');
}

// ---------- messages ----------
let toastT = 0;
function toast(t, bad = false){
  const T = $('toast'); T.textContent = t; T.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toastT); toastT = setTimeout(() => { T.className = ''; }, 2600);
  vrToast = { t, until: performance.now() + 2600 }; drawBoard();
}
let vrToast = null;

// ---------- the top bar and views ----------
$('b-home').onclick = () => toTitle();
$('b-save').onclick = saveCurrent;
$('b-undo').onclick = undo; $('b-redo').onclick = redo;
$('b-rand').onclick = randomPerson;
$('b-share').onclick = () => showCat('saved');
$('b-catrand').onclick = () => { const s = randomize(spec, cat); replaceSpec(s, true); toast('Random ' + CATEGORIES.find((c) => c.id === cat).label.toLowerCase()); };
$('b-catreset').onclick = () => {
  const d = defaults(), s = clone(spec);
  for (const c of CONTROLS) if (c.cat === cat){ if (c.mod) delete s.mods[c.key.slice(5)]; else set(s, c.key, get(d, c.key)); }
  replaceSpec(s, true); toast('Back to the middle');
};
$('name').addEventListener('input', () => { spec.name = $('name').value.slice(0, 40); autosave(); });
$('name').addEventListener('change', () => pushUndo());
$('name').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') $('name').blur(); });
for (const b of $('views').children) b.onclick = () => {
  if (b.dataset.v === 'spin'){ studio.spin = studio.spin ? 0 : 0.6; b.classList.toggle('on', !!studio.spin); return; }
  frameFor(b.dataset.v);
};
addEventListener('keydown', (e) => {
  if (mode !== 'screen' || e.target.tagName === 'INPUT') return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z'){ e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y'){ e.preventDefault(); redo(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's'){ e.preventDefault(); saveCurrent(); }
});

// ---------- turning and zooming with fingers or a mouse ----------
// Every pointer is tracked on its own; one drags (turns), two pinch (zoom). Nothing can stick: a
// cancelled or lost pointer is forgotten, and so is everything when the page loses focus.
const canvas = studio.renderer.domElement;
const ptrs = new Map();
let pinch = 0;
canvas.addEventListener('pointerdown', (e) => {
  if (mode !== 'screen') return;
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* fine */ }
  pinch = 0;
});
canvas.addEventListener('pointermove', (e) => {
  const p = ptrs.get(e.pointerId); if (!p) return;
  if (ptrs.size === 1){ studio.orbit(e.clientX - p.x, -(e.clientY - p.y)); studio.spin = 0; $('views').lastElementChild.classList.remove('on'); }
  p.x = e.clientX; p.y = e.clientY;
  if (ptrs.size === 2){
    const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch) studio.zoom(pinch / d);
    pinch = d;
  }
});
const lift = (e) => { ptrs.delete(e.pointerId); pinch = 0; };
canvas.addEventListener('pointerup', lift); canvas.addEventListener('pointercancel', lift); canvas.addEventListener('lostpointercapture', lift);
addEventListener('pointerup', lift);
addEventListener('blur', () => ptrs.clear());
document.addEventListener('visibilitychange', () => { ptrs.clear(); if (document.hidden && mode !== 'title'){ save.current = spec; store(); } });
canvas.addEventListener('wheel', (e) => { if (mode !== 'screen') return; e.preventDefault(); studio.zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
// ---------- fitting the screen: a phone held upright, sideways, a tablet, a computer ----------
// Upright, the panel is a sheet along the bottom (drag its top edge, or tap ▾ to tuck it away and see
// the whole person); sideways it's down the right. The camera frames the person into whatever the
// panels leave free.
const SHEET = { min: 0, max: 0, h: 0 };
function layoutClasses(){
  const W = window.innerWidth, H = window.innerHeight, B = document.body.classList;
  B.toggle('portrait', W < H);
  B.toggle('small', Math.min(W, H) < 600);
  B.toggle('tiny', Math.min(W, H) < 430);
}
function setSheet(h, animate = true){
  const H = window.innerHeight;
  SHEET.min = 64; SHEET.max = Math.round(H * 0.8);
  SHEET.h = clamp(Math.round(h), SHEET.min, SHEET.max);
  const side = $('side');
  side.style.transition = $('tabs').style.transition = animate ? '' : 'none';
  document.documentElement.style.setProperty('--sheet', SHEET.h + 'px');
  $('b-sheet').textContent = SHEET.h <= SHEET.min + 4 ? '▴' : '▾';
  setTimeout(measurePanel, animate ? 260 : 0);
}
function measurePanel(){
  layoutClasses();
  const W = window.innerWidth, H = window.innerHeight;
  if (mode !== 'screen'){ studio.setFree(null); return; }
  const r = (id) => $(id).getBoundingClientRect();
  const top = r('top').bottom + 4;
  if (W < H){
    const bottom = Math.min(r('tabs').top, r('side').top) - 4;
    studio.setFree({ x: 0, y: top, w: W, h: Math.max(80, bottom - top) });
  } else {
    const left = r('tabs').right + 4, right = r('side').left - 4;
    studio.setFree({ x: left, y: top, w: Math.max(80, right - left), h: H - top });
  }
}
addEventListener('resize', () => { layoutClasses(); if (document.body.classList.contains('portrait')) setSheet(SHEET.h || window.innerHeight * 0.48, false); measurePanel(); });
// drag the sheet's top edge (its heading) up and down; a tap on ▾ / ▴ tucks it away or brings it back
{
  const head = $('side-head');
  let drag = null;
  head.addEventListener('pointerdown', (e) => {
    if (!document.body.classList.contains('portrait') || e.target.closest('button')) return;
    drag = { id: e.pointerId, y: e.clientY, h: SHEET.h, moved: false };
    try { head.setPointerCapture(e.pointerId); } catch (x) { /* fine */ }
  });
  head.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    if (Math.abs(e.clientY - drag.y) > 4) drag.moved = true;
    setSheet(drag.h - (e.clientY - drag.y), false);
  });
  const end = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const d = drag; drag = null;
    if (!d.moved){ setSheet(SHEET.h <= SHEET.min + 4 ? window.innerHeight * 0.48 : SHEET.min); return; }
    // settle at tucked away, half, or tall
    const H = window.innerHeight, stops = [SHEET.min, H * 0.48, SHEET.max];
    setSheet(stops.reduce((a, b) => (Math.abs(b - SHEET.h) < Math.abs(a - SHEET.h) ? b : a)));
  };
  head.addEventListener('pointerup', end); head.addEventListener('pointercancel', end); head.addEventListener('lostpointercapture', end);
  $('b-sheet').onclick = () => setSheet(SHEET.h <= SHEET.min + 4 ? window.innerHeight * 0.48 : SHEET.min);
}

// ---------- VR ----------
const board = new VRBoard();
const vr = new VR(studio, board, { ended: () => { mode = 'title'; $('title').classList.remove('hidden'); refreshTitle(); } });
function drawBoard(){
  if (mode !== 'vr') return;
  const tabs = CATEGORIES.map((c) => ({ ...c, on: c.id === cat, go: () => { cat = c.id; drawBoard(); } }));
  const C = CATEGORIES.find((c) => c.id === cat);
  const rows = rowsFor(cat, true);
  if (cat !== 'presets' && cat !== 'saved') rows.unshift({ kind: 'buttons', items: [{ label: '🎲 Random', go: () => $('b-catrand').onclick() }, { label: '↶ Undo', go: undo }, { label: '💾 Save', go: saveCurrent }] });
  const msg = vrToast && performance.now() < vrToast.until ? '  ·  ' + vrToast.t : '';
  board.show(tabs, C.label + (spec.name ? '  ·  ' + spec.name : ''), rows, `Character Creator v${VERSION}${msg}`);
}

// ---------- the loop ----------
const clock = new THREE.Clock();
function frame(){ try { step(); } catch (e) { console.error(e); } }
function step(){
  const dt = Math.min(clock.getDelta(), 1 / 20);
  const T = window.__cc;
  if (T && T.paused) return;
  simulate(dt);
  if (T && T.noRender && mode !== 'vr') return;
  studio.render();
}
let boardT = 0;
function simulate(dt){
  if (mode === 'vr'){
    vr.update(dt);
    character.lookTarget = vr.head.clone();
    boardT -= dt; if (boardT <= 0 && vrToast){ boardT = 0.5; if (performance.now() > vrToast.until){ vrToast = null; drawBoard(); } }
  } else {
    studio.update(dt);
    if (mode === 'title') studio.turntable.rotation.y += dt * 0.25;
    character.lookTarget = studio.camera.getWorldPosition(new THREE.Vector3());
  }
  character.update(dt);
}
studio.renderer.setAnimationLoop(frame);

// ---------- title screen, starting and stopping ----------
function toTitle(){
  if (studio.renderer.xr.isPresenting) vr.end();
  mode = 'title'; $('title').classList.remove('hidden'); document.body.classList.remove('designing');
  measurePanel(); frameFor('body');
  save.current = spec; store();
  refreshTitle();
}
function refreshTitle(){
  const n = save.characters.length;
  $('t-saved').textContent = n ? `📁 ${n} saved character${n === 1 ? '' : 's'} on this device` : '';
}
function startScreen(){
  studio.turntable.rotation.y = 0;   // (the title screen turns them slowly)
  mode = 'screen'; $('title').classList.add('hidden'); document.body.classList.add('designing');
  layoutClasses(); setSheet(SHEET.h || window.innerHeight * 0.48, false);
  buildTabs(); showCat(cat); refreshTop(); measurePanel();
  studio.frame(CATEGORIES.find((c) => c.id === cat).frame, character, true);
  $('name').value = spec.name || '';
  clock.getDelta();
}
async function startVR(){
  try {
    await vr.start();
    mode = 'vr'; $('title').classList.add('hidden'); document.body.classList.remove('designing');
    studio.turntable.rotation.y = 0;
    drawBoard();
  } catch (e) { $('status').textContent = 'Could not start VR: ' + (e && e.message ? e.message : e); }
}
$('b-play').onclick = () => startScreen();
$('b-vr').onclick = () => startVR();
$('b-new').onclick = () => {
  if (!confirm('Start a new character? (The one you were making stays in My characters if you saved it.)')) { return; }
  replaceSpec({ ...defaults(), name: '' }); currentId = null; cat = 'presets';
  if ($('b-vr').dataset.ok === '1' && confirm('Design in VR? (Cancel to design on this screen.)')) startVR(); else startScreen();
};
vr.supported().then((ok) => {
  $('b-vr').disabled = !ok; $('b-vr').dataset.ok = ok ? '1' : '0';
  $('status').textContent = ok ? 'Headset found: press Design in VR.' : (navigator.xr ? 'No VR headset here: design on this screen (or open this page in a headset\'s browser).' : 'Design on this screen, or open this page in a VR headset\'s browser.');
});
// say on the title screen once everything is saved on this device for offline use
(async function offlineReady(){
  if (!('caches' in window) || !navigator.serviceWorker) return;
  const name = 'character-creator-' + VERSION;
  for (let i = 0; i < 160; i++){
    try { if (await caches.has(name) && await (await caches.open(name)).match('/experiments/character-creator/__offline-ready__')){ $('offline').textContent = '✓ Saved on this device: works offline'; return; } } catch (e) { return; }
    await new Promise((r) => setTimeout(r, 1500));
  }
})();
addEventListener('pagehide', () => { save.current = spec; save.currentId = currentId; store(); });

// presets get little portraits, made in the background after the start (each needs a build)
const presetThumbs = {};
async function makePresetThumbs(){
  const tmp = new Character(data);
  studio.person.add(tmp.root); tmp.root.visible = false;
  const main = character.root;
  for (const p of PRESETS()){
    if (presetThumbs[p.name] || mode === 'vr') continue;
    try {
      await tmp.set(p); tmp.update(0.016);
      main.visible = false; tmp.root.visible = true;
      presetThumbs[p.name] = studio.thumbnail(tmp, 128);
    } catch (e) { /* no picture */ }
    main.visible = true; tmp.root.visible = false;
    if (cat === 'presets' && mode === 'screen') panel.render('Start', rowsFor('presets'));
    await new Promise((r) => setTimeout(r, 30));
  }
  tmp.dispose(); tmp.root.removeFromParent();
}

// ---------- start ----------
if (save.light) studio.setLight(save.light);
await character.set(clone(spec)); lastBuilt = spec; castShadows();
frameFor('body'); studio.frame('body', character, true);
refreshTitle(); layoutClasses();

// ---------- for the headless test ----------
window.__cc = {
  get mode(){ return mode; }, get spec(){ return spec; }, set spec(s){ spec = s; }, get cat(){ return cat; }, get save(){ return save; },
  get building(){ return building; }, get stats(){ return stats; },
  studio, character, data, panel, board, vr, CONTROLS, CONTROL, PRESETS, toCode, fromCode, fromSeed, randomize,
  noRender: false, paused: false,
  startScreen, startVR, toTitle, showCat, undo, redo, randomPerson, openCode, saveCurrent, openSaved, removeSaved, replaceSpec, rebuild, changed, frameFor,
  setValue(key, v){ const c = CONTROL[key]; controlRow(c).set(v, true); },
  async settle(){ while (building) await new Promise((r) => setTimeout(r, 20)); },
  renderNow(){ studio.update(0.5); studio.render(); },
  advance(sec){ for (let t = 0; t < sec; t += 1 / 30) simulate(1 / 30); },
  makePresetThumbs,
};
if (window.__loaded) window.__loaded();
setTimeout(() => { if (!window.__cc.noThumbs) makePresetThumbs(); }, 1500);
