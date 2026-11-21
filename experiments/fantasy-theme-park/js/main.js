// Fantasy Theme Park: start-up, the frame loop, opening and saving parks, the build camera, walking,
// and touch / mouse / keyboard input. VR is in vr.js; the interface in ui.js; the tools in tools.js.
import * as THREE from 'three';
import { setRenderer, mat } from './materials.js';
import { Sky } from './sky.js';
import { Park, newParkState, HALF, N, LANDS, cellOf } from './park.js';
import { Terrain } from './terrain.js';
import { Paths } from './paths.js';
import { Objects } from './objects.js';
import { Highway } from './highway.js';
import { Tools } from './tools.js';
import { UI } from './ui.js';
import { Thumbs } from './thumbs.js';
import { VR } from './vr.js';
import { animateModels } from './models.js';
import { parkName } from './names.js';
import * as store from './store.js';
import { clamp, damp, angleDiff, esc, disposeTree } from './util.js';
import { Audio } from './audio.js';

const VERSION = document.body.dataset.version || '?';
const $ = (id) => document.getElementById(id);

class App {
  constructor(){
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.setSize(innerWidth, innerHeight);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.xr.enabled = true;
    document.body.prepend(r.domElement);
    r.domElement.id = 'view';
    setRenderer(r);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.3, 6000);
    this.rig = new THREE.Group(); this.rig.add(this.camera); this.scene.add(this.rig);
    this.sky = new Sky(this.scene, r);
    this.highway = new Highway(this.scene);
    this.thumbs = new Thumbs(r);
    this.audio = new Audio();
    this.ui = new UI(this);
    this.mode = 'title'; this.speed = 1; this.timeScale = 1; this.noRender = false;
    this.selected = null;
    this.orbit = { x: 0, z: 200, yaw: 0, pitch: 0.75, dist: 140, ty: 0 };
    this.want = { ...this.orbit };
    this.walker = { x: 0, z: 0, yaw: Math.PI, pitch: 0, vx: 0, vz: 0 };
    this.input = { keys: new Set(), stick: null, stickV: [0, 0], ptrs: new Map(), gesture: null };
    this.settings = { smoothTurn: false };
    try { Object.assign(this.settings, JSON.parse(localStorage.getItem('fantasy-theme-park-settings') || '{}')); } catch (e) { /* ignore */ }
    this.clock = new THREE.Clock(); this.t = 0;
    this.time = 0;   // game seconds since the page started (for tests)
    this.ray = new THREE.Raycaster();
    this.saveTimer = 0; this.sinceSave = 0;
    this.vr = new VR(this);
    addEventListener('resize', () => this.resize());
  }
  get inVR(){ return this.vr.active; }
  saveSettings(){ try { localStorage.setItem('fantasy-theme-park-settings', JSON.stringify(this.settings)); } catch (e) { /* ignore */ } }

  // --- parks ------------------------------------------------------------------------------------
  async start(){
    this.ui.wire();
    this.bindInput();
    this.parks = await store.listParks().catch(() => []);
    // behind the title: your last park, or a fresh one that isn't saved
    let state = null;
    if (this.parks.length) state = await store.loadPark(this.parks[0].id).catch(() => null);
    this.open(state || newParkState({ name: 'Fantasy Theme Park', land: 'meadow', seed: 20261120 }), !state);
    this.toTitle(false);
    this.renderer.setAnimationLoop(() => this.frame());
  }
  // show a park (demo: not saved, just the backdrop for the title)
  open(state, demo = false){
    this.closePark();
    this.park = new Park(state);
    this.demo = demo;
    this.world = {
      terrain: new Terrain(this.scene, this.park),
      paths: new Paths(this.scene, this.park),
    };
    this.world.objects = new Objects(this.scene, this.park);
    this.objects = this.world.objects; this.terrain = this.world.terrain;
    this.tools = new Tools(this);
    this.park.on((ch) => this.changed(ch));
    const gate = state.objects.find((o) => o.type === 'gate') || { x: 0, z: 0 };
    const cam = state.camera;
    if (cam) Object.assign(this.orbit, cam); else Object.assign(this.orbit, { x: gate.x, z: gate.z - 30, yaw: Math.PI + 0.35, pitch: 0.7, dist: 150 });
    Object.assign(this.want, this.orbit);
    this.walker.x = gate.x; this.walker.z = gate.z + 8; this.walker.yaw = 0;
    this.selected = null;
    this.ui.tab = 'select'; this.tools.set('select');
    this.ui.refresh();
  }
  closePark(){
    if (!this.world) return;
    this.tools.clearGhost(); this.scene.remove(this.tools.cells); this.tools.cells.dispose();
    const W = this.world;
    for (const m of [W.terrain.mesh, W.terrain.ring, W.terrain.water, W.terrain.sea]) if (m) disposeTree(m);
    W.terrain.landTex.dispose();
    this.scene.children.filter((c) => c.name === 'farTrees').forEach((c) => { c.geometry.dispose(); c.dispose(); this.scene.remove(c); });
    disposeTree(W.paths.group);
    for (const e of W.objects.inst.values()) for (const m of e.meshes){ m.dispose(); }
    for (const g of W.objects.structs.values()) g.traverse((o) => { if (o.userData.ownMaterial){ o.material.map && o.material.map.dispose(); o.material.dispose(); } if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); });
    this.scene.remove(W.objects.group); this.scene.remove(W.objects.halos); W.objects.halos.geometry.dispose();
    if (W.objects.pools){ this.scene.remove(W.objects.pools); W.objects.pools.dispose(); }
    this.world = null;
  }
  changed(ch){
    const W = this.world;
    if (ch.heights){ W.terrain.update(ch.heights); W.paths.update(ch.heights); }
    if (ch.paint) W.terrain.update(ch.paint);
    if (ch.water){ W.terrain.buildWater(); W.paths.update(ch.water); }
    if (ch.path) W.paths.update(ch.path);
    if (ch.zone || ch.landList) W.terrain.updateLands();
    if (ch.landList || ch.name) W.objects.renamed();
    const ground = ch.heights || ch.path || ch.water;
    if (ch.objects.size || ground) W.objects.update(ch.objects, ground ? union(ch.heights, ch.path, ch.water) : null);
    if (this.selected && !this.park.obj(this.selected)) this.selected = null;
    this.ui.refresh();
    this.saveSoon();
  }
  saveSoon(){ if (!this.demo) this.saveTimer = 1.5; }
  async save(picture){
    if (this.demo || !this.park) return;
    this.saveTimer = 0; this.sinceSave = 0;
    this.park.s.camera = { x: this.orbit.x, z: this.orbit.z, yaw: this.orbit.yaw, pitch: this.orbit.pitch, dist: this.orbit.dist };
    try { await store.savePark(this.park.s, picture); this.park.dirty = false; }
    catch (e) { console.warn('save failed', e); this.ui.toast('Could not save on this device: ' + e.message, 'bad'); }
  }
  async newPark(name, land){
    const s = newParkState({ name, land });
    this.open(s);
    await this.save();
    this.parks = await store.listParks();
    this.play();
    this.ui.toast('Welcome to ' + name + '! The entrance and a car park are ready. Start with a path.', 'good');
  }
  async openSaved(id){
    const s = await store.loadPark(id);
    if (!s){ this.ui.toast('That park could not be loaded.', 'bad'); return; }
    this.open(s);
    this.play();
  }
  play(){
    this.mode = 'build';
    document.body.classList.add('playing');
    $('title').classList.add('hidden'); $('parks').classList.remove('show'); $('newpark').classList.remove('show');
    this.ui.refresh();
    this.audio.start();
  }
  // back to the title (and to your parks, if asked)
  async toTitle(showParks){
    if (this.mode !== 'title' && !this.demo){ this.wantPicture = true; await new Promise((r) => setTimeout(r, 120)); await this.save(this.picture); }
    if (this.inVR){ this.vr.end(); }
    this.mode = 'title';
    document.body.classList.remove('playing', 'walking');
    $('title').classList.remove('hidden');
    this.parks = await store.listParks().catch(() => []);
    this.drawTitle();
    if (showParks) this.showParks();
  }
  exportPark(){
    const blob = new Blob([store.exportPark(this.park.s)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = this.park.s.name.replace(/[^\w -]+/g, '') + '.park.json';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  // --- title screen, parks gallery, new park --------------------------------------------------------
  drawTitle(){
    const last = this.parks[0];
    $('b-continue').style.display = last ? '' : 'none';
    if (last) $('b-continue').innerHTML = `Continue <small>${esc(last.name)}</small>`;
    $('b-parks').style.display = this.parks.length ? '' : 'none';
  }
  showParks(){
    const L = this.parks;
    $('parks-list').innerHTML = L.map((p) => `<div class="pk">
      <button class="pk-open" data-park="${p.id}">${p.picture ? `<img src="${p.picture}" alt="">` : '<div class="pk-none"></div>'}<b>${esc(p.name)}</b><small>${esc((LANDS[p.land] || {}).name || '')} · ${new Date(p.played || Date.now()).toLocaleDateString()}</small></button>
      <div class="pk-acts"><button data-pk-rename="${p.id}">Rename</button><button data-pk-delete="${p.id}" class="danger">Delete</button></div></div>`).join('') || '<p class="none">No parks yet.</p>';
    $('parks').classList.add('show');
  }
  showNewPark(){
    $('np-name').value = parkName();
    this.npLand = 'meadow';
    $('np-lands').innerHTML = Object.entries(LANDS).map(([k, l]) => `<button class="np-land${k === this.npLand ? ' on' : ''}" data-land="${k}"><b>${esc(l.name)}</b><small>${esc(l.about)}</small></button>`).join('');
    $('newpark').classList.add('show');
    setTimeout(() => $('np-name').select(), 60);
  }
  bindTitle(){
    $('b-continue').onclick = () => { if (this.parks[0]) (this.demo || this.park.s.id !== this.parks[0].id ? this.openSaved(this.parks[0].id) : Promise.resolve(this.play())); };
    $('b-parks').onclick = () => this.showParks();
    $('b-new').onclick = () => this.showNewPark();
    $('b-vr').onclick = async () => {
      if (this.demo || this.mode === 'title'){ if (this.parks[0] && (this.demo || this.park.s.id !== this.parks[0].id)) await this.openSaved(this.parks[0].id); else if (!this.parks[0]) await this.newPark(parkName(), 'meadow'); else this.play(); }
      this.startVR();
    };
    $('parks-close').onclick = () => $('parks').classList.remove('show');
    $('parks-new').onclick = () => { $('parks').classList.remove('show'); this.showNewPark(); };
    $('parks').addEventListener('click', async (e) => {
      const o = e.target.closest('[data-park]'), rn = e.target.closest('[data-pk-rename]'), dl = e.target.closest('[data-pk-delete]');
      if (o) await this.openSaved(o.dataset.park);
      if (rn){ const id = rn.dataset.pkRename, p = this.parks.find((q) => q.id === id), n = prompt('Rename the park', p.name); if (n && n.trim()){ const s = await store.loadPark(id); s.name = n.trim().slice(0, 40); await store.savePark(s); if (this.park.s.id === id){ this.park.s.name = s.name; this.objects.renamed(); } this.parks = await store.listParks(); this.showParks(); } }
      if (dl){ const id = dl.dataset.pkDelete, p = this.parks.find((q) => q.id === id); if (confirm(`Delete ${p.name} for good? This can't be undone.`)){ await store.deletePark(id); this.parks = await store.listParks(); if (this.park.s.id === id) this.open(newParkState({ name: 'Fantasy Theme Park', land: 'meadow', seed: 20261120 }), true); this.drawTitle(); this.showParks(); } }
    });
    $('np-lands').addEventListener('click', (e) => { const b = e.target.closest('[data-land]'); if (!b) return; this.npLand = b.dataset.land; [...$('np-lands').children].forEach((c) => c.classList.toggle('on', c === b)); });
    $('np-dice').onclick = () => { $('np-name').value = parkName(); };
    $('np-cancel').onclick = () => $('newpark').classList.remove('show');
    $('np-go').onclick = () => { const n = $('np-name').value.trim(); if (!n){ $('np-msg').textContent = 'Your park needs a name.'; return; } $('np-msg').textContent = ''; this.newPark(n.slice(0, 40), this.npLand); };
    $('np-name').onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') $('np-go').click(); };
    $('import-file').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { const s = store.importPark(await f.text()); s.id = Math.random().toString(36).slice(2) + Date.now().toString(36); this.open(s); await this.save(); this.parks = await store.listParks(); this.play(); this.ui.toast(s.name + ' has been added to your parks.', 'good'); }
      catch (err) { alert(err.message); }
      e.target.value = '';
    };
  }
  // VR has no HTML: your parks as a panel
  vrParks(){
    this.ui.dialog = { title: 'Your parks', lines: ['Choose a park to open.'], buttons: this.parks.slice(0, 8).map((p) => ({ id: 'dlg:open-' + p.id, label: p.name })).concat([{ id: 'dlg:new', label: 'New park', kind: 'primary' }, { id: 'dlg:cancel', label: 'Cancel' }]),
      on: (v) => {
        if (v.startsWith('open-')){ this.save().then(() => this.openSaved(v.slice(5))); }
        if (v === 'new') this.ui.askName({ title: 'Name your new park', value: parkName(), suggest: parkName }).then((n) => { if (n) this.save().then(() => this.newPark(n, 'meadow')); });
      } };
    this.ui.refresh();
  }

  // --- modes ------------------------------------------------------------------------------------
  setMode(m){
    if (m === this.mode) return;
    if (m === 'walk'){
      // start where the camera is looking, on the ground
      const w = this.walker; w.x = this.orbit.x; w.z = this.orbit.z; w.yaw = this.orbit.yaw; w.pitch = -0.05;
      [w.x, w.z] = this.safeSpot(w.x, w.z);
      this.tools.set('select'); this.select(null);
      this.camera.near = 0.1; this.camera.updateProjectionMatrix();
      this.ui.toast('Walking. Left thumb (or WASD) to walk, drag to look. Tap Build to go back.');
    } else { this.camera.near = 0.3; this.camera.updateProjectionMatrix(); this.want.x = this.orbit.x = this.walker.x; this.want.z = this.orbit.z = this.walker.z; }
    this.mode = m;
    this.input.stick = null; this.input.stickV = [0, 0];
    this.ui.refresh();
  }
  safeSpot(x, z){
    x = clamp(x, -HALF + 12, HALF - 12); z = clamp(z, -HALF + 12, HALF - 12);
    for (let k = 0; k < 60; k++){ const [cx, cz] = this.objects.collide(x, z, 0.35); if (Math.abs(cx - x) < 0.01 && Math.abs(cz - z) < 0.01 && Number.isNaN(this.park.waterAt(x, z))) break; x = cx + (k % 2 ? 1.5 : 0); z = cz + 1.5; }
    return [x, z];
  }
  setSpeed(s){ this.speed = s; this.ui.refresh(); }
  select(id){ this.selected = id; this.ui.refresh(); }
  focus(x, z, dist){ this.want.x = x; this.want.z = z; if (dist) this.want.dist = dist; }
  startVR(){ this.vr.start(); }
  clockText(){
    const s = this.park.s, m = Math.floor(s.time) % 1440, h = Math.floor(m / 60), mm = m % 60;
    return `Day ${s.day} · ${((h + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
  }

  // --- picking the ground and things ---------------------------------------------------------------
  surfaceAt(x, z){ const g = this.park.floorAt(x, z), w = this.park.waterAt(x, z); return Number.isNaN(w) ? g : Math.max(g, w); }
  // the point where a ray meets the park's ground (or water); null if it misses the map
  groundHit(ray){
    const o = ray.origin, d = ray.direction;
    let t = 0.2, prev = 0, hit = null;
    for (let k = 0; k < 4000 && t < 3000; k++){
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t, h = this.surfaceAt(x, z);
      if (y <= h){
        let a = prev, b = t;
        for (let i = 0; i < 10; i++){ const m = (a + b) / 2, yy = o.y + d.y * m, hh = this.surfaceAt(o.x + d.x * m, o.z + d.z * m); if (yy <= hh) b = m; else a = m; }
        hit = { x: o.x + d.x * b, y: o.y + d.y * b, z: o.z + d.z * b, t: b };
        break;
      }
      prev = t; t += clamp((y - h) * 0.6, 0.1, 25);
    }
    if (!hit || Math.abs(hit.x) > HALF || Math.abs(hit.z) > HALF) return null;
    return hit;
  }
  screenRay(cx, cy){
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2((cx - r.left) / r.width * 2 - 1, -(cy - r.top) / r.height * 2 + 1), this.camera);
    return this.ray.ray;
  }
  // the thing under the pointer (used by Select and Bulldoze)
  pickAt(){ const ray = this.lastRay; if (!ray) return null; const g = this.groundHit(ray); const h = this.objects.pick(ray, g ? g.t + 2 : 2000); return h ? h.o : null; }

  // --- input (screen) -----------------------------------------------------------------------------
  bindInput(){
    const cv = this.renderer.domElement, I = this.input;
    const isStickZone = (e) => e.pointerType !== 'mouse' && e.clientX < innerWidth * 0.4 && e.clientY > innerHeight * 0.45;
    cv.addEventListener('pointerdown', (e) => {
      if (this.mode === 'title' || this.inVR) return;
      try { cv.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      this.audio.unlock();
      const p = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), button: e.button, type: e.pointerType, moved: 0 };
      if (this.mode === 'walk'){
        // a new touch in the stick zone always takes the stick over
        if (isStickZone(e)){ I.stick = { id: e.pointerId, cx: e.clientX, cy: e.clientY }; I.stickV = [0, 0]; this.showStick(e.clientX, e.clientY, 0, 0); I.ptrs.set(e.pointerId, { ...p, stick: true }); return; }
        I.ptrs.set(e.pointerId, { ...p, look: true });
        return;
      }
      I.ptrs.set(e.pointerId, p);
      if (I.ptrs.size === 2){ this.tools.cancel(); this.startGesture(); return; }
      if (I.ptrs.size > 2) return;
      this.lastRay = this.screenRay(e.clientX, e.clientY).clone();
      if (e.pointerType === 'mouse' && e.button === 2){ p.orbit = true; return; }
      if (e.pointerType === 'mouse' && e.button === 1){ p.pan = this.panStart(e.clientX, e.clientY); return; }
      if (this.tools.usesDrag()){ p.tool = true; this.tools.down(this.groundHit(this.lastRay)); }
      else p.pan = this.panStart(e.clientX, e.clientY);
    });
    cv.addEventListener('pointermove', (e) => {
      if (this.mode === 'title' || this.inVR) return;
      const p = I.ptrs.get(e.pointerId);
      if (!p){
        // hover (mouse): preview where the tool would act
        if (this.mode === 'build' && e.pointerType === 'mouse'){ this.lastRay = this.screenRay(e.clientX, e.clientY).clone(); this.tools.hover(this.groundHit(this.lastRay)); }
        return;
      }
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.moved += Math.hypot(dx, dy); p.x = e.clientX; p.y = e.clientY;
      if (p.stick){ let vx = e.clientX - I.stick.cx, vy = e.clientY - I.stick.cy; const l = Math.hypot(vx, vy); if (l > 55){ vx *= 55 / l; vy *= 55 / l; } I.stickV = [vx / 55, vy / 55]; this.showStick(I.stick.cx, I.stick.cy, vx, vy); return; }
      if (p.look){ this.walker.yaw -= dx * 0.005; this.walker.pitch = clamp(this.walker.pitch - dy * 0.004, -1.3, 1.3); return; }
      if (I.gesture){ this.moveGesture(); return; }
      this.lastRay = this.screenRay(e.clientX, e.clientY).clone();
      if (p.orbit){ this.want.yaw -= dx * 0.006; this.want.pitch = clamp(this.want.pitch + dy * 0.005, 0.12, 1.5); return; }
      if (p.pan){ this.panMove(p.pan, e.clientX, e.clientY); return; }
      if (p.tool) this.tools.move(this.groundHit(this.lastRay));
    });
    const end = (e) => {
      const p = I.ptrs.get(e.pointerId); if (!p) return;
      I.ptrs.delete(e.pointerId);
      if (p.stick){ I.stick = null; I.stickV = [0, 0]; this.hideStick(); return; }
      if (I.gesture){ if (I.ptrs.size < 2) I.gesture = null; return; }
      const tap = p.moved < 10 && performance.now() - p.t < 500;
      if (p.look && tap && e.type === 'pointerup') this.walkTap(e.clientX, e.clientY);
      if (p.tool){ if (e.type === 'pointerup') this.tools.up(this.groundHit(this.screenRay(e.clientX, e.clientY))); else this.tools.cancel(); }
      else if (tap && e.type === 'pointerup' && this.mode === 'build' && !p.orbit){ this.lastRay = this.screenRay(e.clientX, e.clientY).clone(); const o = this.pickAt(); this.select(o ? o.id : null); if (o) this.audio.click(); }
    };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    cv.addEventListener('lostpointercapture', (e) => { if (I.ptrs.has(e.pointerId)) end({ ...e, type: 'pointercancel', pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY }); });
    addEventListener('pointerup', (e) => { if (I.ptrs.has(e.pointerId)) end(e); });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('wheel', (e) => {
      if (this.mode !== 'build') return; e.preventDefault();
      const f = Math.exp(e.deltaY * 0.0012);
      // zoom towards the point under the mouse
      const g = this.groundHit(this.screenRay(e.clientX, e.clientY));
      const nd = clamp(this.want.dist * f, 6, 900);
      if (g){ const k = 1 - nd / this.want.dist; this.want.x += (g.x - this.want.x) * k; this.want.z += (g.z - this.want.z) * k; }
      this.want.dist = nd;
    }, { passive: false });
    const forget = () => { I.ptrs.clear(); I.keys.clear(); I.stick = null; I.stickV = [0, 0]; I.gesture = null; this.hideStick(); this.tools && this.tools.cancel(); };
    addEventListener('blur', forget);
    document.addEventListener('visibilitychange', () => { forget(); if (document.hidden) this.save(); });
    addEventListener('pagehide', () => this.save());
    addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (this.mode === 'title') return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z'){ e.preventDefault(); this.ui.act(e.shiftKey ? 'redo' : 'undo'); return; }
      if ((e.ctrlKey || e.metaKey) && k === 'y'){ e.preventDefault(); this.ui.act('redo'); return; }
      if (k === 'escape'){ if (this.ui.dialog) this.ui.act('dlg:cancel'); else if (this.selected) this.select(null); else { this.ui.tab = 'select'; this.tools.set('select'); } return; }
      if ((k === 'delete' || k === 'backspace') && this.selected){ this.ui.act('objdel'); return; }
      if (k === '[' || k === ']'){ if (this.selected) this.ui.act('objrot:' + (k === '[' ? -1 : 1)); else this.ui.act('rot:' + (k === '[' ? -1 : 1)); return; }
      I.keys.add(k);
    });
    addEventListener('keyup', (e) => I.keys.delete(e.key.toLowerCase()));
    $('b-undo').onclick = () => this.ui.act('undo'); $('b-redo').onclick = () => this.ui.act('redo');
    $('b-walk').onclick = () => this.ui.act('walk'); $('b-menu').onclick = () => this.ui.act('menu');
    $('b-vrh').onclick = () => this.ui.act('vr');
    this.bindTitle();
  }
  // one-finger pan: keep the ground point under the finger
  panStart(x, y){ const r = this.screenRay(x, y); const h = this.orbit.ty; const t = (h - r.origin.y) / r.direction.y; return t > 0 ? { h, gx: r.origin.x + r.direction.x * t, gz: r.origin.z + r.direction.z * t } : null; }
  panMove(p, x, y){
    if (!p) return;
    const r = this.screenRay(x, y), t = (p.h - r.origin.y) / r.direction.y; if (!(t > 0)) return;
    const gx = r.origin.x + r.direction.x * t, gz = r.origin.z + r.direction.z * t;
    this.want.x = this.orbit.x = clamp(this.orbit.x + p.gx - gx, -HALF, HALF); this.want.z = this.orbit.z = clamp(this.orbit.z + p.gz - gz, -HALF, HALF);
    this.placeCamera();
  }
  startGesture(){
    const [a, b] = [...this.input.ptrs.values()];
    this.input.gesture = { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, dist: this.want.dist, yaw: this.want.yaw, pitch: this.want.pitch, pan: this.panStart((a.x + b.x) / 2, (a.y + b.y) / 2) };
    for (const p of this.input.ptrs.values()) p.tool = false;
  }
  moveGesture(){
    const G = this.input.gesture, [a, b] = [...this.input.ptrs.values()]; if (!a || !b) return;
    const d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    this.want.dist = this.orbit.dist = clamp(G.dist * G.d / Math.max(20, d), 6, 900);
    this.want.yaw = this.orbit.yaw = G.yaw + angleDiff(G.ang, ang);
    // both fingers moving up or down together (without spreading) tilts the view
    const dy = my - G.my, spread = Math.abs(d - G.d);
    if (Math.abs(dy) > 30 && spread < 40 && Math.abs(mx - G.mx) < Math.abs(dy) * 0.5 && Math.sign(a.y - (G.my)) === Math.sign(b.y - G.my) || G.tilting){ G.tilting = true; this.want.pitch = this.orbit.pitch = clamp(G.pitch + dy * 0.004, 0.12, 1.5); this.placeCamera(); return; }
    this.placeCamera();
    this.panMove(G.pan, mx, my);
  }
  showStick(cx, cy, vx, vy){ const s = $('stick'); s.style.left = cx - 60 + 'px'; s.style.top = cy - 60 + 'px'; s.classList.add('on'); $('knob').style.transform = `translate(${vx}px,${vy}px)`; }
  hideStick(){ $('stick').classList.remove('on'); }
  walkTap(x, y){ this.lastRay = this.screenRay(x, y).clone(); const o = this.pickAt(); if (o){ const L = this.park.landAt(o.x, o.z); this.ui.toast((o.type === 'gate' ? this.park.s.name : o.name && o.type !== 'sign' ? o.name : (o.type === 'sign' ? '“' + o.name + '”' : this.objects.constructor && this.ui.panel && this.selectName(o))) + (L ? ' · ' + L.name : '')); } }
  selectName(o){ const sel = this.selected; this.selected = o.id; const p = this.ui.panel(); this.selected = sel; return p ? p.title : o.type; }

  // --- cameras -----------------------------------------------------------------------------------
  placeCamera(){
    const o = this.orbit, c = this.camera;
    o.ty = this.park.floorAt(o.x, o.z);
    const cp = Math.cos(o.pitch), sp = Math.sin(o.pitch);
    const x = o.x + Math.sin(o.yaw) * cp * o.dist, z = o.z + Math.cos(o.yaw) * cp * o.dist;
    let y = o.ty + sp * o.dist;
    y = Math.max(y, this.park.groundAt(x, z) + 2);
    this.rig.position.set(0, 0, 0); this.rig.rotation.set(0, 0, 0); this.rig.scale.setScalar(1);
    c.position.set(x, y, z); c.lookAt(o.x, o.ty, o.z);
  }
  updateBuild(dt){
    const K = this.input.keys, w = this.want, s = w.dist * 0.9 * dt;
    let fx = 0, fz = 0;
    if (K.has('w') || K.has('arrowup')) fz -= 1; if (K.has('s') || K.has('arrowdown')) fz += 1;
    if (K.has('a') || K.has('arrowleft')) fx -= 1; if (K.has('d') || K.has('arrowright')) fx += 1;
    if (fx || fz){ w.x += (fx * Math.cos(w.yaw) + fz * Math.sin(w.yaw)) * s; w.z += (-fx * Math.sin(w.yaw) + fz * Math.cos(w.yaw)) * s; }
    if (K.has('q')) w.yaw += 1.6 * dt; if (K.has('e')) w.yaw -= 1.6 * dt;
    if (K.has('r')) w.pitch = clamp(w.pitch + dt, 0.12, 1.5); if (K.has('f')) w.pitch = clamp(w.pitch - dt, 0.12, 1.5);
    if (K.has('=') || K.has('+')) w.dist = clamp(w.dist * (1 - dt), 6, 900); if (K.has('-')) w.dist = clamp(w.dist * (1 + dt), 6, 900);
    w.x = clamp(w.x, -HALF, HALF); w.z = clamp(w.z, -HALF, HALF);
    const o = this.orbit;
    o.x = damp(o.x, w.x, 10, dt); o.z = damp(o.z, w.z, 10, dt); o.dist = damp(o.dist, w.dist, 10, dt);
    o.yaw = o.yaw + angleDiff(o.yaw, w.yaw) * (1 - Math.exp(-10 * dt)); o.pitch = damp(o.pitch, w.pitch, 10, dt);
    this.placeCamera();
  }
  updateWalk(dt){
    const W = this.walker, K = this.input.keys, I = this.input;
    let fx = I.stickV[0], fz = I.stickV[1];
    if (K.has('w') || K.has('arrowup')) fz -= 1; if (K.has('s') || K.has('arrowdown')) fz += 1;
    if (K.has('a')) fx -= 1; if (K.has('d')) fx += 1;
    if (K.has('arrowleft') || K.has('q')) W.yaw += 1.8 * dt; if (K.has('arrowright') || K.has('e')) W.yaw -= 1.8 * dt;
    const l = Math.hypot(fx, fz); if (l > 1){ fx /= l; fz /= l; }
    const sp = (K.has('shift') ? 7 : 3.6);
    const mx = (fx * Math.cos(W.yaw) + fz * Math.sin(W.yaw)) * sp * dt, mz = (-fx * Math.sin(W.yaw) + fz * Math.cos(W.yaw)) * sp * dt;
    this.walkTo(W, W.x + mx, W.z + mz);
    const c = this.camera, y = this.park.floorAt(W.x, W.z) + 1.65;
    this.rig.position.set(0, 0, 0); this.rig.rotation.set(0, 0, 0); this.rig.scale.setScalar(1);
    c.position.set(W.x, y, W.z); c.rotation.set(W.pitch, W.yaw, 0, 'YXZ');
  }
  // move a walker towards (x, z): not into water (except on a bridge), not through solid things, not off the map
  walkTo(W, x, z){
    x = clamp(x, -HALF + 10, HALF - 10); z = clamp(z, -HALF + 10, HALF - 10);
    const wet = (px, pz) => !Number.isNaN(this.park.waterAt(px, pz)) && !this.park.pathAt(px, pz) && this.park.waterAt(px, pz) > this.park.groundAt(px, pz) + 0.4;
    if (wet(x, z)){ if (!wet(x, W.z)) z = W.z; else if (!wet(W.x, z)) x = W.x; else return; }
    // too steep to climb (a cliff): stay put that way
    const h0 = this.park.floorAt(W.x, W.z), h1 = this.park.floorAt(x, z), step = Math.hypot(x - W.x, z - W.z);
    if (step > 0 && (h1 - h0) / step > 1.4){ return; }
    [x, z] = this.objects.collide(x, z, 0.3);
    W.x = x; W.z = z;
  }
  resize(){
    if (this.inVR) return;
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }

  // --- the frame -----------------------------------------------------------------------------------
  frame(){
    try {
      const dt = Math.min(0.1, this.clock.getDelta()), gdt = dt * this.timeScale;
      this.t += dt; this.time += gdt;
      const S = this.park.s;
      // the clock: one game minute a second at 1x
      if (this.mode !== 'title' && !this.demo){ S.time += gdt * this.speed; if (S.time >= 1440){ S.time -= 1440; S.day++; } }
      else if (this.mode === 'title'){ S.time = 18.3 * 60; }
      if (this.mode === 'title'){ this.titleCam(dt); }
      else if (this.inVR) this.vr.update(dt);
      else if (this.mode === 'walk') this.updateWalk(dt);
      else this.updateBuild(dt);
      this.tools.frame(gdt);
      const hour = S.time / 60;
      const center = this.inVR ? this.vr.focus() : this.mode === 'walk' ? new THREE.Vector3(this.walker.x, 0, this.walker.z) : new THREE.Vector3(this.orbit.x, this.orbit.ty, this.orbit.z);
      const span = this.inVR ? this.vr.shadowSpan() : this.mode === 'walk' ? 60 : clamp(this.orbit.dist * 0.85, 40, 260);
      if (Math.abs(span - this.sky.span) > this.sky.span * 0.15) this.sky.setShadowSpan(span);
      const camPos = this.camera.getWorldPosition(new THREE.Vector3());
      this.sky.update(hour, center, camPos);
      this.objects.updateLights(this.sky.night); this.audio.night = this.sky.night;
      this.terrain.animate(this.t); animateModels(this.t);
      this.highway.update(dt);
      if (this.saveTimer > 0){ this.saveTimer -= dt; if (this.saveTimer <= 0) this.save(); }
      this.sinceSave += dt;
      if (this.sinceSave > 90 && this.mode !== 'title' && !this.demo){ this.wantPicture = true; this.sinceSave = 0; }
      if (this.mode !== 'title' && !this.inVR && (this.uiTick = (this.uiTick || 0) + dt) > 0.5){ this.uiTick = 0; this.ui.drawTop(); }
      if (!this.noRender || this.inVR){
        this.renderer.render(this.scene, this.camera);
        if (this.wantPicture && !this.inVR){ this.wantPicture = false; this.picture = this.snapshot(); if (this.sinceSave === 0) this.save(this.picture); }
      }
    } catch (e) {
      // never let one bad frame stop the game (in VR, an exception here would end the loop for good)
      if (!this.frameErr || performance.now() - this.frameErr > 5000){ this.frameErr = performance.now(); console.error(e); }
    }
  }
  // behind the title: a slow drift round the entrance, low down, in the late afternoon light
  titleCam(dt){
    const g = this.park.s.objects.find((o) => o.type === 'gate') || { x: 0, z: 0 };
    this.titleT = (this.titleT || 0) + dt;
    const a = Math.PI + 0.55 + Math.sin(this.titleT * 0.04) * 0.35;
    Object.assign(this.want, { x: g.x + 3, z: g.z - 4, yaw: a, pitch: 0.2, dist: 34 });
    Object.assign(this.orbit, this.want);
    this.placeCamera();
  }
  snapshot(){
    const src = this.renderer.domElement, c = document.createElement('canvas'); c.width = 400; c.height = 240;
    const g = c.getContext('2d'), sr = src.width / src.height, w = sr > 400 / 240 ? src.height * 400 / 240 : src.width, h = w * 240 / 400;
    g.drawImage(src, (src.width - w) / 2, (src.height - h) / 2, w, h, 0, 0, 400, 240);
    return c.toDataURL('image/jpeg', 0.72);
  }
}
function union(...rs){
  rs = rs.filter(Boolean); if (!rs.length) return null;
  return [Math.min(...rs.map((r) => r[0])), Math.min(...rs.map((r) => r[1])), Math.max(...rs.map((r) => r[2])), Math.max(...rs.map((r) => r[3]))];
}

// --- start ------------------------------------------------------------------------------------------
await (window.__loading ? window.__loading() : null);
const app = new App();
window.__ftp = app;
app.VERSION = VERSION;
await app.start();
// offline: say so once the whole game is saved on this device
(async () => {
  try {
    const keys = await caches.keys();
    for (const k of keys){ if (!k.startsWith('fantasy-theme-park-')) continue; const c = await caches.open(k); if (await c.match('/experiments/fantasy-theme-park/__offline-ready__')){ $('offline').textContent = '✓ Saved on this device: plays offline'; break; } }
  } catch (e) { /* no caches (http) */ }
})();
if (navigator.xr && navigator.xr.isSessionSupported) navigator.xr.isSessionSupported('immersive-vr').then((ok) => { app.vrOK = ok; $('b-vr').disabled = !ok; $('b-vr').title = ok ? '' : 'No VR headset found'; $('b-vrh').style.display = ok ? '' : 'none'; }).catch(() => {});
window.__loaded && window.__loaded();
void mat; void N; void cellOf;
