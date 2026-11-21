// VR (WebXR, e.g. a Quest's browser).
//  - Model mode: you stand over the park as if it were a model on a table (the play space is scaled up).
//    Squeeze one grip and move your hand to drag the park; squeeze both to move, turn and resize it.
//    The left stick moves you about, the right stick turns (snap or smooth, a setting) and, pushed up
//    or down, makes the park bigger or smaller.
//  - Life-size: B stands you in the park at full size, where the laser points (B again goes back up).
//    The left stick walks; the right stick turns.
//  - Building: the right hand's laser drives the same tools as a finger on screen (trigger = touch).
//  - The tablet on your left hand shows the same tabs, trays and panels as the screen (ui.js), drawn on
//    a canvas; point the laser at it and pull the trigger. A: undo, X: hide the tablet, Y: menu.
import * as THREE from 'three';
import { clamp, angleDiff } from './util.js';
import { HALF } from './park.js';

const TW = 1024, TH = 1344;
const GIANT = 90, TABLE = 0.85;

export class VR {
  constructor(app){
    this.app = app; this.active = false;
    this.scale = GIANT; this.life = false;
    this.hands = [0, 1].map((i) => this.makeHand(i));
    this.tablet = this.makeTablet();
    this.hover = null; this.trig = [false, false]; this.btn = {}; this.grab = null;
    this.ptTimer = 0; this.groundPt = null; this.turnLatch = false;
    this.focusV = new THREE.Vector3();
  }
  get rig(){ return this.app.rig; }
  makeHand(i){
    const R = this.app.renderer, ctrl = R.xr.getController(i), grip = R.xr.getControllerGrip(i);
    // a simple controller: a handle along -Z, a ring round the front, and a laser for pointing
    const body = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.021, 0.11, 12), new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.5, metalness: 0.2 }));
    handle.rotation.x = Math.PI / 2 - 0.35; handle.position.set(0, -0.01, 0.03);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.006, 8, 24), new THREE.MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.4, metalness: 0.4 }));
    ring.position.set(0, 0.012, -0.035); ring.rotation.x = 0.5;
    body.add(handle, ring); grip.add(body);
    const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
    const laser = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.8 }));
    laser.scale.z = 3; ctrl.add(laser);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff0b0 }));
    dot.visible = false;
    ctrl.add(dot);
    ctrl.addEventListener('connected', (e) => { ctrl.userData.hand = e.data.handedness; ctrl.userData.source = e.data; grip.userData.hand = e.data.handedness; });
    ctrl.addEventListener('disconnected', () => { ctrl.userData.hand = null; ctrl.userData.source = null; });
    return { ctrl, grip, laser, dot, i };
  }
  makeTablet(){
    const c = document.createElement('canvas'); c.width = TW; c.height = TH;
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26 * TH / TW), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.272, 0.272 * TH / TW, 0.012), new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.6 }));
    back.position.z = -0.0075;
    const g = new THREE.Group(); g.add(back, mesh);
    // held above the left hand, tilted towards you
    g.position.set(0.02, 0.17, -0.06); g.rotation.set(-0.55, 0, 0);
    return { canvas: c, ctx: c.getContext('2d'), tex, mesh, group: g, hits: [], visible: true, last: 0 };
  }
  hand(name){ return this.hands.find((h) => h.ctrl.userData.hand === name); }

  // --- session -----
  async start(){
    if (this.active || !navigator.xr) return;
    const A = this.app;
    try {
      const s = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
      A.renderer.xr.setReferenceSpaceType('local-floor');
      A.renderer.shadowMap.enabled = true; A.sky.sun.shadow.mapSize.set(1024, 1024); if (A.sky.sun.shadow.map){ A.sky.sun.shadow.map.dispose(); A.sky.sun.shadow.map = null; }
      await A.renderer.xr.setSession(s);
      if (s.supportedFrameRates && s.updateTargetFrameRate && [...s.supportedFrameRates].includes(72)) s.updateTargetFrameRate(72).catch(() => {});
      this.session = s; this.active = true;
      s.addEventListener('end', () => this.ended());
      A.camera.near = 0.1; A.camera.updateProjectionMatrix();
      for (const h of this.hands){ A.rig.add(h.ctrl, h.grip); }
      this.life = false; this.setScale(GIANT);
      // start over where the screen's camera was looking, the park at table height in front of you
      this.placeModel(A.orbit.x, A.orbit.z);
      A.mode = A.mode === 'title' ? 'build' : A.mode;
      document.body.classList.add('playing');
      document.getElementById('title').classList.add('hidden');
      A.ui.vrDirty = true;
      A.ui.toast('Squeeze both grips to move, turn and resize the park. B stands you in it.');
    } catch (e) { A.ui.toast('VR could not start: ' + e.message, 'bad'); }
  }
  end(){ if (this.session) this.session.end().catch(() => {}); }
  ended(){
    const A = this.app; this.active = false; this.session = null;
    for (const h of this.hands){ A.rig.remove(h.ctrl, h.grip); }
    if (this.tablet.group.parent) this.tablet.group.parent.remove(this.tablet.group);
    A.rig.position.set(0, 0, 0); A.rig.rotation.set(0, 0, 0); A.rig.scale.setScalar(1);
    A.sky.sun.shadow.mapSize.set(2048, 2048); if (A.sky.sun.shadow.map){ A.sky.sun.shadow.map.dispose(); A.sky.sun.shadow.map = null; }
    A.camera.near = 0.3; A.camera.updateProjectionMatrix();
    A.tools.cancel();
    A.resize();
    if (A.mode === 'walk') A.mode = 'build';
    A.ui.refresh();
  }
  setScale(s){ this.scale = clamp(s, 1, 400); this.rig.scale.setScalar(this.scale); }
  // the park as a model: the point (x, z) 1.2 m (real) in front of you, the ground at table height
  placeModel(x, z){
    const S = this.scale, g = this.app.park.floorAt(x, z);
    const yaw = this.rig.rotation.y;
    this.rig.position.set(x - Math.sin(yaw) * -1.2 * S, g - TABLE * S, z - Math.cos(yaw) * -1.2 * S);
  }
  focus(){ return this.focusV; }
  shadowSpan(){ return this.life ? 60 : clamp(this.scale * 2.2, 50, 260); }

  // --- every frame -----
  update(dt){
    const A = this.app, rig = this.rig;
    const src = this.session ? [...this.session.inputSources] : [];
    const pads = {};
    for (const s of src) if (s.gamepad && s.handedness) pads[s.handedness] = s.gamepad;
    const L = pads.left, R = pads.right, ax = (g, i) => (g && g.axes.length > i ? g.axes[i] : 0), bt = (g, i) => !!(g && g.buttons[i] && g.buttons[i].pressed);
    const press = (key, now) => { const was = this.btn[key]; this.btn[key] = now; return now && !was; };
    const head = A.camera.getWorldPosition(new THREE.Vector3());
    // tablet on the left hand
    const lh = this.hand('left');
    if (lh && this.tablet.group.parent !== lh.grip) lh.grip.add(this.tablet.group);
    this.tablet.group.visible = this.tablet.visible;
    // buttons: A undo, B life-size / model, X tablet, Y menu
    if (press('a', bt(R, 4))) A.ui.act('undo');
    if (press('b', bt(R, 5))){ if (A.riding) A.stopRide(); else this.toggleLife(); }
    if (press('x', bt(L, 4))){ this.tablet.visible = !this.tablet.visible; }
    if (press('y', bt(L, 5))){ if (A.ui.dialog) A.ui.act('dlg:cancel'); else A.ui.act('menu'); this.tablet.visible = true; }
    // riding: the seat carries you (main.js), so no moving about
    if (A.riding){ this.point(this.hand('right'), bt(R, 0), dt); if (this.tablet.visible && (A.ui.vrDirty || performance.now() - this.tablet.last > 500)) this.drawTablet(); return; }
    // grips: drag / turn / resize the world
    this.grips(bt(L, 1), bt(R, 1));
    // sticks
    const lx = ax(L, 2), ly = ax(L, 3), rx = ax(R, 2), ry = ax(R, 3);
    if (!this.grab){
      const yaw = Math.atan2(-(A.camera.matrixWorld.elements[8]), -(A.camera.matrixWorld.elements[10]));
      if (Math.hypot(lx, ly) > 0.15){
        const sp = (this.life ? 3.2 : this.scale * 1.4) * dt, fx = lx * sp, fz = ly * sp;
        const mx = Math.cos(yaw) * fx - Math.sin(yaw) * -fz, mz = -Math.sin(yaw) * fx - Math.cos(yaw) * -fz;
        if (this.life){
          const W = { x: head.x, z: head.z }; A.walkTo(W, head.x + mx, head.z + mz);
          rig.position.x += W.x - head.x; rig.position.z += W.z - head.z;
        } else { rig.position.x += mx; rig.position.z += mz; }
      }
      // turning (round your head)
      let turn = 0;
      if (A.settings.smoothTurn){ if (Math.abs(rx) > 0.2) turn = -rx * 1.8 * dt; }
      else { if (Math.abs(rx) > 0.7 && !this.turnLatch){ turn = -Math.sign(rx) * Math.PI / 6; this.turnLatch = true; } if (Math.abs(rx) < 0.3) this.turnLatch = false; }
      if (turn) this.turnAbout(head, turn);
      // model mode: right stick up/down resizes round the point you look at
      if (!this.life && Math.abs(ry) > 0.3 && Math.abs(ry) > Math.abs(rx)) this.scaleAbout(head, this.scale * Math.exp(ry * 1.2 * dt));
    }
    if (this.life){ const W = { x: head.x, z: head.z }; rig.position.y = A.park.floorAt(W.x, W.z); }
    // pointing: the tablet first, then the park
    this.point(this.hand('right'), bt(R, 0), dt);
    const lp = this.hand('left'); if (lp) lp.laser.visible = false;
    // the tablet
    if (this.tablet.visible && (A.ui.vrDirty || performance.now() - this.tablet.last > 500)) this.drawTablet();
    // where shadows and the camera's interest are
    if (this.groundPt) this.focusV.set(this.groundPt.x, this.groundPt.y, this.groundPt.z);
    else this.focusV.set(head.x, A.park.floorAt(clamp(head.x, -HALF, HALF), clamp(head.z, -HALF, HALF)), head.z);
    // keep the build camera's target in step, so leaving VR shows the same place
    A.orbit.x = A.want.x = clamp(this.focusV.x, -HALF, HALF); A.orbit.z = A.want.z = clamp(this.focusV.z, -HALF, HALF);
  }
  toggleLife(){
    const A = this.app, head = A.camera.getWorldPosition(new THREE.Vector3());
    if (!this.life){
      // stand where the laser points (or below your head)
      const p = this.groundPt || { x: head.x, z: head.z };
      const [x, z] = A.safeSpot(p.x, p.z);
      const local = A.camera.position.clone();   // head in play-space metres
      this.life = true; this.setScale(1);
      const yaw = this.rig.rotation.y, c = Math.cos(yaw), s = Math.sin(yaw);
      this.rig.position.set(x - (local.x * c + local.z * s), A.park.floorAt(x, z), z - (-local.x * s + local.z * c));
      A.ui.toast('Life-size. Left stick walks; B goes back to the model.');
    } else {
      this.life = false; this.setScale(GIANT);
      this.placeModel(head.x, head.z);
      A.ui.toast('Back to the model.');
    }
    A.ui.vrDirty = true;
  }
  turnAbout(p, a){
    const r = this.rig, dx = r.position.x - p.x, dz = r.position.z - p.z, c = Math.cos(a), s = Math.sin(a);
    r.position.x = p.x + dx * c + dz * s; r.position.z = p.z - dx * s + dz * c; r.rotation.y += a;
  }
  scaleAbout(p, s){
    s = clamp(s, 2, 400); const k = s / this.scale, r = this.rig;
    r.position.set(p.x + (r.position.x - p.x) * k, p.y + (r.position.y - p.y) * k, p.z + (r.position.z - p.z) * k);
    this.setScale(s);
  }
  // one grip drags the world, both grips drag, turn and resize it
  grips(lg, rg){
    const A = this.app, rig = this.rig, lh = this.hand('left'), rh = this.hand('right');
    if (!lh || !rh){ this.grab = null; return; }
    const lp = lh.grip.position.clone(), rp = rh.grip.position.clone();   // play-space metres
    const n = (lg ? 1 : 0) + (rg ? 1 : 0);
    if (!n){ this.grab = null; return; }
    rig.updateMatrixWorld();
    if (!this.grab || this.grab.n !== n){
      this.grab = { n, wl: rig.localToWorld(lp.clone()), wr: rig.localToWorld(rp.clone()), one: lg ? 'l' : 'r' };
      A.tools.cancel();
      return;
    }
    const G = this.grab;
    if (n === 1){
      const p = G.one === 'l' ? lp : rp, w = G.one === 'l' ? G.wl : G.wr, now = rig.localToWorld(p.clone());
      rig.position.add(w.clone().sub(now));
      if (this.life) rig.position.y = A.park.floorAt(rig.position.x, rig.position.z);
      return;
    }
    if (this.life) return;
    // both: the two world points stay in your two hands
    const dl = new THREE.Vector2(rp.x - lp.x, rp.z - lp.z), dw = new THREE.Vector2(G.wr.x - G.wl.x, G.wr.z - G.wl.z);
    const s = clamp(dw.length() / Math.max(0.05, dl.length()), 2, 400);
    const yaw = Math.atan2(-dw.y, dw.x) - Math.atan2(-dl.y, dl.x);
    rig.rotation.y = yaw; this.setScale(s);
    rig.updateMatrixWorld();
    const mid = lp.clone().add(rp).multiplyScalar(0.5), wmid = G.wl.clone().add(G.wr).multiplyScalar(0.5);
    rig.position.add(wmid.sub(rig.localToWorld(mid)));
  }

  // --- the laser -----
  point(h, trigger, dt){
    const A = this.app;
    if (!h){ return; }
    h.laser.visible = true;
    const ray = new THREE.Ray(), m = h.ctrl.matrixWorld;
    ray.origin.setFromMatrixPosition(m); ray.direction.set(0, 0, -1).transformDirection(m);
    A.lastRay = ray.clone();
    // the tablet
    const T = this.tablet;
    let onTab = null;
    if (T.visible && T.mesh.parent && T.group.parent){
      T.mesh.updateMatrixWorld();
      const inv = T.mesh.matrixWorld.clone().invert(), lo = ray.origin.clone().applyMatrix4(inv), ld = ray.direction.clone().transformDirection(inv);
      if (ld.z < 0 && lo.z > 0){
        const t = -lo.z / ld.z, px = lo.x + ld.x * t, py = lo.y + ld.y * t;
        const w = T.mesh.geometry.parameters.width, hh = T.mesh.geometry.parameters.height;
        if (Math.abs(px) <= w / 2 && Math.abs(py) <= hh / 2){
          const u = (px / w + 0.5) * TW, v = (0.5 - py / hh) * TH;
          onTab = T.hits.find((b) => u >= b.x && u <= b.x + b.w && v >= b.y && v <= b.y + b.h) || { id: null };
          const worldT = ray.origin.distanceTo(T.mesh.localToWorld(new THREE.Vector3(px, py, 0)));
          h.laser.scale.z = worldT / this.rig.scale.x;
          h.dot.visible = true; h.dot.position.set(0, 0, -h.laser.scale.z);
        }
      }
    }
    const hov = onTab ? onTab.id : null;
    if (hov !== this.hover){ this.hover = hov; A.ui.vrDirty = true; }
    const was = this.trig[1]; this.trig[1] = trigger;
    if (onTab){
      if (A.tools.stroke && trigger){ /* finish strokes started on the park before reaching for the tablet */ }
      if (trigger && !was && onTab.id){ A.ui.act(onTab.id); A.audio && A.audio.click(); }
      this.groundPt = null; A.tools.hover(null);
      return;
    }
    // the park
    this.ptTimer -= dt;
    if (this.ptTimer <= 0 || trigger !== was){
      this.ptTimer = 0.05;
      this.groundPt = A.groundHit(ray);
      const d = this.groundPt ? this.groundPt.t : 4000;
      h.laser.scale.z = Math.min(d, 4000) / this.rig.scale.x; h.dot.visible = !!this.groundPt; h.dot.position.set(0, 0, -h.laser.scale.z); h.dot.scale.setScalar(Math.max(1, d / this.rig.scale.x * 0.25));
      if (trigger && !was){
        if (A.tools.kind === 'select'){ const o = A.pickAt(); A.select(o ? o.id : null); if (o) A.audio && A.audio.click(); }
        else A.tools.down(this.groundPt);
      } else if (trigger) A.tools.move(this.groundPt);
      else if (was) A.tools.up(this.groundPt);
      else A.tools.hover(this.groundPt);
    }
  }

  // --- the tablet: the same tabs, trays and panels as the screen -----
  drawTablet(){
    const A = this.app, UI = A.ui, T = this.tablet, g = T.ctx, hits = [];
    UI.vrDirty = false; T.last = performance.now();
    const btn = (x, y, w, h, id, label, opts = {}) => {
      const on = opts.on, hov = this.hover === id && id;
      g.fillStyle = opts.kind === 'primary' ? (hov ? '#e8b850' : '#c8983a') : opts.kind === 'danger' ? (hov ? '#c05040' : '#9a3a30') : on ? '#c8a050' : hov ? '#4a5262' : '#2e333c';
      rr(g, x, y, w, h, 14); g.fill();
      if (opts.swatch){ g.fillStyle = opts.swatch; rr(g, x + 10, y + (h - 34) / 2, 34, 34, 8); g.fill(); }
      if (opts.img){ try { g.drawImage(opts.img, x + 8, y + 8, h - 16, h - 16); } catch (e) { /* not ready */ } }
      g.fillStyle = on || opts.kind === 'primary' ? '#1a1408' : '#f2ecdc';
      g.font = `600 ${opts.size || 26}px "Avenir Next", "Helvetica Neue", Arial, sans-serif`; g.textBaseline = 'middle';
      const tx = opts.img ? x + h + 2 : opts.swatch ? x + 54 : x + w / 2;
      g.textAlign = opts.img || opts.swatch ? 'left' : 'center';
      fitText(g, label, tx, y + h / 2 + (opts.sub ? -12 : 0), opts.img || opts.swatch ? w - (tx - x) - 8 : w - 16);
      if (opts.sub){ g.font = `400 20px "Avenir Next", Arial, sans-serif`; g.fillStyle = on ? '#3a2a10' : '#b8b0a0'; fitText(g, opts.sub, tx, y + h / 2 + 16, w - (tx - x) - 8); }
      hits.push({ x, y, w, h, id });
    };
    g.fillStyle = '#16181d'; g.fillRect(0, 0, TW, TH);
    // header: park, clock, version
    g.fillStyle = '#f2d27a'; g.font = 'bold 40px Georgia, "Times New Roman", serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
    fitText(g, A.park.s.name, 28, 42, 620);
    g.fillStyle = '#d8d0c0'; g.font = '500 24px "Avenir Next", Arial, sans-serif'; g.fillText(A.clockText() + (this.life ? ' · life-size' : ' · model'), 28, 84);
    g.textAlign = 'right'; g.fillStyle = '#8a8478'; g.font = '600 20px ui-monospace, Menlo, monospace'; g.fillText('v' + A.VERSION, TW - 24, 84);
    [[0, '||'], [1, '>'], [2, '>>'], [4, '>>>']].forEach(([s, l], k) => btn(TW - 330 + k * 78, 16, 70, 48, 'speed:' + s, l, { on: A.speed === s, size: 24 }));
    let y = 112;
    const P = UI.panel();
    if (UI.dialog){
      y = this.drawPanel(g, P, y, btn, true);
    } else {
      // tabs
      const tabs = UI.tabs(), tw = (TW - 40) / tabs.length;
      tabs.forEach((t, k) => btn(20 + k * tw, y, tw - 6, 70, t.id, t.label, { on: t.on, size: 22 }));
      y += 86;
      const tr = UI.tray();
      if (tr.hint){ g.fillStyle = '#c8c0b0'; g.font = 'italic 24px Georgia, serif'; g.textAlign = 'left'; y = wrapText(g, tr.hint, 28, y + 16, TW - 56, 30) + 8; }
      const bottom = P ? TH - 470 : TH - 120;
      for (const s of tr.sections){
        if (y > bottom - 60) break;
        if (s.label){ g.fillStyle = '#9a927e'; g.font = '700 20px "Avenir Next", Arial, sans-serif'; g.textAlign = 'left'; g.fillText(s.label.toUpperCase(), 28, y + 14); y += 30; }
        if (s.kind === 'cards'){
          const cw = (TW - 56 - 16) / 3, ch = 84;
          s.items.forEach((it, k) => {
            const cx = 28 + (k % 3) * (cw + 8), cy = y + Math.floor(k / 3) * (ch + 8);
            if (cy + ch > bottom) return;
            const img = it.thumb ? A.thumbs.canvas(it.thumb) : it.swatch ? A.thumbs.canvas('sw:' + it.swatch) : null;
            btn(cx, cy, cw, ch, it.id, it.label, { on: it.on, img, swatch: it.swatchColor, sub: it.sub, size: 23 });
          });
          y += Math.ceil(s.items.length / 3) * (ch + 8) + 6;
        } else {
          let x = 28; const ch = 60;
          for (const it of s.items){
            g.font = '600 24px "Avenir Next", Arial, sans-serif';
            const w = Math.max(it.swatchColor && !it.label ? 60 : 90, g.measureText(it.label).width + 40 + (it.swatchColor ? 44 : 0));
            if (x + w > TW - 28){ x = 28; y += ch + 8; }
            if (y + ch > bottom) break;
            btn(x, y, w, ch, it.id, it.label, { on: it.on, swatch: it.swatchColor, size: 24 });
            x += w + 8;
          }
          y += ch + 14;
        }
      }
      if (P) this.drawPanel(g, P, TH - 460, btn, false);
    }
    // footer: undo, redo, model / life-size, menu; then the latest message
    const fy = TH - 104, fw = (TW - 56 - 24) / 4;
    btn(28, fy, fw, 64, 'undo', 'Undo (A)', { size: 24 }); btn(28 + (fw + 8), fy, fw, 64, 'redo', 'Redo', { size: 24 });
    btn(28 + (fw + 8) * 2, fy, fw, 64, 'vr:life', this.life ? 'Model (B)' : 'Life-size (B)', { size: 24 }); btn(28 + (fw + 8) * 3, fy, fw, 64, 'menu', 'Menu (Y)', { size: 24 });
    const t = UI.toasts[UI.toasts.length - 1];
    if (t){ g.fillStyle = t.kind === 'bad' ? '#e89080' : t.kind === 'good' ? '#a0e0a0' : '#f2ecdc'; g.font = '500 22px "Avenir Next", Arial, sans-serif'; g.textAlign = 'left'; fitText(g, t.text, 28, TH - 22, TW - 56); }
    T.hits = hits;
    T.tex.needsUpdate = true;
  }
  drawPanel(g, P, y, btn, full){
    const A = this.app;
    g.fillStyle = '#242830'; rr(g, 20, y, TW - 40, (full ? TH - 140 : TH - 120) - y, 18); g.fill();
    g.fillStyle = '#f2d27a'; g.font = 'bold 34px Georgia, serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
    fitText(g, P.title, 44, y + 40, TW - 200);
    if (P.close) btn(TW - 140, y + 14, 100, 52, P.close, 'Close', { size: 22 });
    y += 80;
    g.fillStyle = '#e8e0d0'; g.font = '400 24px "Avenir Next", Arial, sans-serif';
    for (const l of P.lines){ y = wrapText(g, l, 44, y, TW - 88, 30) + 4; if (y > TH - 300) break; }
    if (P.input !== undefined){
      g.fillStyle = '#0e1014'; rr(g, 44, y, TW - 88, 64, 10); g.fill();
      g.fillStyle = '#ffffff'; g.font = '500 32px "Avenir Next", Arial, sans-serif'; g.textAlign = 'left'; fitText(g, P.input + '|', 60, y + 33, TW - 120);
      y += 80;
      // a keyboard
      const rows = ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL\'', 'ZXCVBNM-&.'];
      const kw = (TW - 88 - 9 * 6) / 10;
      rows.forEach((row, r) => { [...row].forEach((ch, k) => btn(44 + k * (kw + 6), y + r * 62, kw, 56, 'key:' + (r === 0 ? ch : ch.toLowerCase() === ch ? ch : (A.vr.shift ? ch : ch.toLowerCase())), r === 0 ? ch : (A.vr.shift ? ch : ch.toLowerCase()), { size: 26 })); });
      y += 4 * 62;
      btn(44, y, 150, 56, 'vr:shift', A.vr.shift ? 'abc' : 'ABC', { size: 24, on: A.vr.shift }); btn(202, y, TW - 88 - 158 - 158, 56, 'key:space', 'space', { size: 24 }); btn(TW - 44 - 150, y, 150, 56, 'key:back', 'delete', { size: 24 });
      y += 72;
    }
    // rows (menus, a stall's look): a label then its buttons; two columns when there are many
    const rows = P.rows || [], two = rows.length > 8, colW = two ? (TW - 88 - 16) / 2 : TW - 88, rh = two ? 50 : 56;
    rows.forEach((r, k) => {
      const cx = 44 + (two ? (k % 2) * (colW + 16) : 0), cy = y + (two ? Math.floor(k / 2) : k) * (rh + 6);
      let x = cx;
      if (r.label){ g.fillStyle = '#c8a050'; g.font = '700 18px "Avenir Next", Arial, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle'; fitText(g, r.label.toUpperCase(), x, cy + rh / 2, 120); x += 128; }
      for (const b of r.buttons){
        const w = b.swatchColor && !b.label ? 52 : b.wide ? Math.max(120, colW - (x - cx) - 3 * 70 - 24) : Math.max(56, Math.min(120, g.measureText(b.label).width + 30));
        btn(x, cy, w, rh, b.id, b.label, { on: b.on, kind: b.kind, swatch: b.swatchColor, size: two ? 20 : 22 });
        x += w + 6;
      }
    });
    if (rows.length) y += (two ? Math.ceil(rows.length / 2) : rows.length) * (rh + 6) + 10;
    let x = 44; const bh = 62;
    for (const b of P.buttons){
      g.font = '600 24px "Avenir Next", Arial, sans-serif';
      const w = b.swatchColor && !b.label ? 70 : Math.max(120, g.measureText(b.label).width + 44 + (b.swatchColor ? 44 : 0));
      if (x + w > TW - 44){ x = 44; y += bh + 8; }
      btn(x, y, w, bh, b.id, b.label, { on: b.on, kind: b.kind, swatch: b.swatchColor, size: 24 });
      x += w + 8;
    }
    return y + bh + 10;
  }
}
function rr(g, x, y, w, h, r){ g.beginPath(); g.roundRect(x, y, w, h, r); }
function fitText(g, text, x, y, max){
  text = String(text);
  if (g.measureText(text).width <= max){ g.fillText(text, x, y); return; }
  while (text.length > 1 && g.measureText(text + '…').width > max) text = text.slice(0, -1);
  g.fillText(text + '…', x, y);
}
function wrapText(g, text, x, y, max, lh){
  const words = String(text).split(' '); let line = '';
  g.textBaseline = 'middle';
  for (const w of words){ const t = line ? line + ' ' + w : w; if (g.measureText(t).width > max && line){ g.fillText(line, x, y + lh / 2); y += lh; line = w; } else line = t; }
  if (line){ g.fillText(line, x, y + lh / 2); y += lh; }
  return y;
}
void angleDiff;
