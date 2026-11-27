// VR: you stand in the studio with the person life-size on the turntable in front of you, and the
// designer's board beside them. Point and pull the trigger at the board (hold it to drag a slider);
// squeeze a grip and move your hand sideways to turn the person; the left stick walks, the right stick
// turns (snap) or scrolls the board when you point at it; B or Y hides and shows the board.
import * as THREE from 'three';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const FWD = V(0, 0, -1);

export class VR {
  constructor(studio, board, hooks){
    this.studio = studio; this.board = board; this.hooks = hooks;
    const r = studio.renderer;
    this.hands = [0, 1].map((i) => ({ i, side: '', tracked: false, pos: V(), quat: new THREE.Quaternion(), trigger: 0, grip: false, stick: { x: 0, y: 0 }, a: false, b: false, last: {}, gamepad: null }));
    this.rays = [r.xr.getController(0), r.xr.getController(1)];
    this.sources = [null, null];
    this.rays.forEach((c, i) => { studio.rig.add(c); c.addEventListener('connected', (e) => { this.sources[i] = e.data; }); c.addEventListener('disconnected', () => { this.sources[i] = null; }); });
    // a pointer beam and a dot for each hand
    this.beams = [0, 1].map(() => {
      const g = new THREE.BufferGeometry().setFromPoints([V(0, 0, 0), V(0, 0, -1)]);
      const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xf0b45a, transparent: true, opacity: 0.8 }));
      l.visible = false; studio.scene.add(l); return l;
    });
    this.dots = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.008, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe08a })); m.visible = false; studio.scene.add(m); return m; });
    // simple controller shapes so you can see your hands
    this.pads = [0, 1].map(() => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.08, 4, 10), new THREE.MeshStandardMaterial({ color: 0x2a2c32, roughness: 0.5 }));
      body.rotation.x = Math.PI / 2; g.add(body);
      g.visible = false; studio.scene.add(g); return g;
    });
    board.mesh.visible = false; studio.scene.add(board.mesh);
    this.on = false; this.posed = false; this.frames = 0; this.boardOn = true; this.snapReady = true;
    this.head = V(); this.headQ = new THREE.Quaternion();
  }
  supported(){ return navigator.xr && navigator.xr.isSessionSupported ? navigator.xr.isSessionSupported('immersive-vr').catch(() => false) : Promise.resolve(false); }
  async start(){
    const r = this.studio.renderer;
    const session = await navigator.xr.requestSession('immersive-vr', { requiredFeatures: ['local-floor'] });
    session.addEventListener('end', () => this.stopped());
    this.studio.key.shadow.mapSize.set(1024, 1024); if (this.studio.key.shadow.map){ this.studio.key.shadow.map.dispose(); this.studio.key.shadow.map = null; }
    await r.xr.setSession(session);
    try { if (session.supportedFrameRates && session.updateTargetFrameRate && [...session.supportedFrameRates].includes(72)) await session.updateTargetFrameRate(72); } catch (e) { /* keep the default rate */ }
    this.on = true; this.posed = false; this.frames = 0; this.boardOn = true;
    // you stand 1.3 m in front of the person, facing them
    const cam = this.studio.camera;
    cam.position.set(0, 0, 0); cam.quaternion.identity(); cam.clearViewOffset();
    this.studio.rig.position.set(0, 0, 1.3); this.studio.rig.rotation.set(0, 0, 0);
    this.studio.turntable.rotation.y = 0;
  }
  end(){ const s = this.studio.renderer.xr.getSession(); if (s) s.end(); }
  stopped(){
    if (!this.on) return;
    this.on = false;
    const st = this.studio;
    st.rig.position.set(0, 0, 0); st.rig.rotation.set(0, 0, 0); st.camera.position.set(0, 0, 0); st.camera.quaternion.identity();
    this.board.mesh.visible = false; for (const o of [...this.beams, ...this.dots, ...this.pads]) o.visible = false;
    st.key.shadow.mapSize.set(2048, 2048); if (st.key.shadow.map){ st.key.shadow.map.dispose(); st.key.shadow.map = null; }
    st.resize();
    if (this.hooks.ended) this.hooks.ended();
  }
  read(){
    for (const h of this.hands){
      const idx = this.sources.findIndex((s) => s && s.handedness === (h.i ? 'right' : 'left'));
      const src = idx >= 0 ? this.sources[idx] : null, g = src && src.gamepad;
      h.gamepad = g || null;
      h.tracked = !!(src && this.rays[idx].visible);
      if (h.tracked){ this.rays[idx].updateMatrixWorld(true); this.rays[idx].matrixWorld.decompose(h.pos, h.quat, V()); }
      const B = (k) => (g && g.buttons[k]) || { value: 0, pressed: false };
      h.trigger = B(0).value; h.grip = B(1).pressed; h.a = B(4).pressed; h.b = B(5).pressed;
      const ax = g ? g.axes : [];
      h.stick.x = ax.length >= 4 ? ax[2] : (ax[0] || 0); h.stick.y = ax.length >= 4 ? ax[3] : (ax[1] || 0);
      const L = h.last;
      h.held = h.trigger > 0.5;
      h.down = h.held && !L.t; h.bDown = h.b && !L.b; h.aDown = h.a && !L.a; h.gripDown = h.grip && !L.g;
      L.t = h.held; L.b = h.b; L.a = h.a; L.g = h.grip;
    }
  }
  placeBoard(){
    // beside the person, to your left of them, turned to face you; only once the headset knows where your head is
    const st = this.studio, m = this.board.mesh;
    const fwd = FWD.clone().applyQuaternion(this.headQ); fwd.y = 0; fwd.normalize();
    const right = V(-fwd.z, 0, fwd.x);
    m.position.copy(this.head).addScaledVector(fwd, 0.85).addScaledVector(right, -0.55);
    m.position.y = this.head.y - 0.12;
    m.lookAt(this.head.x, this.head.y - 0.12, this.head.z);
    void st;
  }
  update(dt){
    if (!this.on) return;
    const st = this.studio, r = st.renderer;
    st.rig.updateMatrixWorld(true);
    r.xr.getCamera().matrixWorld.decompose(this.head, this.headQ, V());
    if (!this.posed){ this.frames = r.xr.isPresenting ? this.frames + 1 : 0; if (this.frames >= 3){ this.posed = true; this.placeBoard(); } else return; }
    this.read();
    const [L, R] = this.hands;
    // the board: brought back in front of you if you turn away from it
    const m = this.board.mesh;
    m.visible = this.boardOn;
    if (this.boardOn){
      const fwd = FWD.clone().applyQuaternion(this.headQ); fwd.y = 0; fwd.normalize();
      const to = m.position.clone().sub(this.head); to.y = 0; to.normalize();
      if (fwd.dot(to) < 0.15) this.placeBoard();
    }
    if (L.bDown || R.bDown || L.aDown && false){ this.boardOn = !this.boardOn; if (this.boardOn) this.placeBoard(); }
    let pointing = false;
    for (const h of [R, L]){
      const k = h.i, beam = this.beams[k], dot = this.dots[k], pad = this.pads[k];
      pad.visible = h.tracked; beam.visible = false; dot.visible = false;
      if (!h.tracked) continue;
      pad.position.copy(h.pos); pad.quaternion.copy(h.quat);
      if (!this.boardOn || pointing) continue;
      const dir = FWD.clone().applyQuaternion(h.quat);
      const hit = this.board.ray(h.pos, dir, h.down, h.held);
      if (hit){
        pointing = true; beam.visible = true; dot.visible = true;
        beam.position.copy(h.pos); beam.lookAt(hit.point); beam.scale.set(1, 1, h.pos.distanceTo(hit.point));
        dot.position.copy(hit.point);
        if (hit.clicked) this.pulse(h, 0.3, 25);
        if (Math.abs(h.stick.y) > 0.3) this.board.scrollBy(h.stick.y * dt * 900);
        h.onBoard = true;
      } else h.onBoard = false;
    }
    // grip and swing your hand sideways: the turntable follows
    for (const h of [L, R]){
      if (h.grip && h.tracked){
        if (h.gripX !== undefined) st.turntable.rotation.y += (h.pos.x - h.gripX) * 4 + (h.pos.z - h.gripZ) * 0;
        h.gripX = h.pos.x; h.gripZ = h.pos.z;
      } else h.gripX = undefined;
    }
    // walk with the left stick (where you look), turn with the right (snap) when it isn't scrolling the board
    const lx = L.stick.x, ly = L.stick.y;
    if (Math.abs(lx) > 0.15 || Math.abs(ly) > 0.15){
      const fwd = FWD.clone().applyQuaternion(this.headQ); fwd.y = 0; fwd.normalize();
      const right = V(-fwd.z, 0, fwd.x);
      st.rig.position.addScaledVector(fwd, -ly * dt * 1.2).addScaledVector(right, lx * dt * 1.2);
      // not into the person
      const p = st.rig.position; const d = Math.hypot(p.x, p.z); if (d < 0.45){ p.x *= 0.45 / d; p.z *= 0.45 / d; }
    }
    if (!R.onBoard){
      if (Math.abs(R.stick.x) > 0.7 && this.snapReady){
        this.snapReady = false;
        const a = -Math.sign(R.stick.x) * Math.PI / 6;
        // turn about your head, not the play space's corner
        const hp = this.head.clone();
        st.rig.position.sub(hp).applyAxisAngle(V(0, 1, 0), a).add(hp); st.rig.rotation.y += a;
      } else if (Math.abs(R.stick.x) < 0.3) this.snapReady = true;
    }
  }
  pulse(h, v, ms){ try { const a = h.gamepad && h.gamepad.hapticActuators && h.gamepad.hapticActuators[0]; if (a) a.pulse(v, ms); } catch (e) { /* no rumble */ } }
}
