// The Undercroft: shrines. Each power gate is the doorway to a small shrine (like the ones in Zelda): an old
// stone chamber lit by runes in the power's colour, with a trial to solve. Solving it opens the door to an
// altar where the power waits. Each shrine is built far outside the maze and the game moves you in and out.
//
//   bomb    push a stone block around two pillars onto a pressure plate
//   magnet  light four braziers with your torch before any burns out
//   freeze  watch which stepping stones light up, then cross the water on them (wrong ones sink)
//   shield  pull four levers in the order the mural shows
//
// Every shrine is 10 m wide and 20 m long. You arrive at the south end facing north (+z). The trial fills
// the middle, a wall with a portcullis crosses it at z = 13, and the altar stands at z = 17.
import * as THREE from 'three';
import { mulberry } from './level.js';

const W = 10, L = 20, H = 6, DOOR_Z = 13;
const COLORS = { magnet: 0xff4030, bomb: 0xff8a2a, freeze: 0x8cc8ff, shield: 0xffd24a };
export const SHRINE_NAMES = { magnet: 'THE SHRINE OF THE MAGNET', bomb: 'THE SHRINE OF THE BOMB', freeze: 'THE SHRINE OF ICE', shield: 'THE SHRINE OF THE SHIELD' };
const HINTS = {
  bomb: 'Push the stone block onto the glowing plate.',
  magnet: 'Light all four fires with your torch before any goes out.',
  freeze: 'Step on the rune and watch the stones. Cross only on the ones that glow.',
  shield: 'Pull the levers in the order the mural above the door shows.',
};

// a box whose texture is scaled to its size, so stone blocks look the same size on every face
function stoneBox(w, h, d, mat, rep){
  rep = rep || 3.2;
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++){ const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / rep, uv.getY(i) * dims[f][1] / rep); }
  const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true;
  return m;
}

// the four lever symbols, drawn in gold on dark stone
function symbolTexture(which, size){
  const c = document.createElement('canvas'); c.width = c.height = size || 256; const x = c.getContext('2d'), s = c.width;
  x.fillStyle = '#16120e'; x.fillRect(0, 0, s, s);
  x.strokeStyle = '#ffcf6a'; x.fillStyle = '#ffcf6a'; x.lineWidth = s * 0.05; x.lineCap = 'round';
  const cx = s / 2, cy = s / 2, r = s * 0.22;
  x.beginPath();
  if (which === 'sun'){ x.arc(cx, cy, r * 0.75, 0, 7); x.stroke(); for (let k = 0; k < 8; k++){ const a = k * Math.PI / 4; x.moveTo(cx + Math.cos(a) * r * 1.1, cy + Math.sin(a) * r * 1.1); x.lineTo(cx + Math.cos(a) * r * 1.6, cy + Math.sin(a) * r * 1.6); } x.stroke(); }
  else if (which === 'moon'){ x.arc(cx, cy, r * 1.3, 0, 7); x.fill(); x.fillStyle = '#16120e'; x.beginPath(); x.arc(cx + r * 0.7, cy - r * 0.3, r * 1.15, 0, 7); x.fill(); }
  else if (which === 'star'){ for (let k = 0; k < 10; k++){ const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.6 : r * 1.5; k ? x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr) : x.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } x.closePath(); x.fill(); }
  else if (which === 'eye'){ x.moveTo(cx - r * 1.6, cy); x.quadraticCurveTo(cx, cy - r * 1.5, cx + r * 1.6, cy); x.quadraticCurveTo(cx, cy + r * 1.5, cx - r * 1.6, cy); x.stroke(); x.beginPath(); x.arc(cx, cy, r * 0.45, 0, 7); x.fill(); }
  // a worn border
  x.strokeStyle = 'rgba(255,207,106,.35)'; x.lineWidth = s * 0.02; x.strokeRect(s * 0.06, s * 0.06, s * 0.88, s * 0.88);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function muralTexture(order){
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256; const x = c.getContext('2d');
  x.fillStyle = '#16120e'; x.fillRect(0, 0, 1024, 256);
  order.forEach((sym, k) => {
    const img = symbolTexture(sym, 200).image; x.drawImage(img, 28 + k * 250, 6, 200, 200);
    x.fillStyle = '#ffcf6a'; x.font = 'bold 40px Georgia, serif'; x.textAlign = 'center'; x.fillText(['I', 'II', 'III', 'IV'][k], 128 + k * 250, 246);
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function buildShrine(kind, index, ctx){
  const { mats, props, env, makeFlame, seed } = ctx;
  const rng = mulberry(seed * 977 + index * 131 + 7);
  const ox = -90 - index * 60, oz = 0;              // far west of the maze
  const color = new THREE.Color(COLORS[kind]);
  const group = new THREE.Group();
  const add = (o) => { group.add(o); return o; };
  const boxes = [];                                 // solid boxes: [x0, x1, z0, z1]
  const circles = [];                               // solid circles: { x, z, r }
  const lights = [], flames = [];
  const wallMat = mats.pillar;
  const floorMat = new THREE.MeshStandardMaterial({ map: mats.floor.map, normalMap: mats.floor.normalMap, roughnessMap: mats.floor.roughnessMap });
  const runeMat = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(1.6), fog: false });
  const sh = { kind, group, ox, oz, start: { x: ox, z: oz + 1.6, yaw: Math.PI }, lights, flames, solved: false, taken: false, doorOpen: 0,
    name: SHRINE_NAMES[kind], hint: HINTS[kind], color };

  // ---------- the chamber ----------
  const stones = kind === 'freeze';
  const PIT0 = 3.5, PIT1 = 11.5;
  if (stones){
    for (const [z0, z1] of [[0, PIT0], [PIT1, L]]){ const f = add(stoneBox(W, 0.4, z1 - z0, floorMat, 3)); f.position.set(ox, -0.2, oz + (z0 + z1) / 2); }
    const bottom = add(stoneBox(W, 0.2, PIT1 - PIT0, floorMat, 3)); bottom.position.set(ox, -1.5, oz + (PIT0 + PIT1) / 2);
    const water = add(new THREE.Mesh(new THREE.PlaneGeometry(W, PIT1 - PIT0).rotateX(-Math.PI / 2), mats.water)); water.position.set(ox, -0.35, oz + (PIT0 + PIT1) / 2);
  } else { const f = add(stoneBox(W, 0.4, L, floorMat, 3)); f.position.set(ox, -0.2, oz + L / 2); }
  const ceil = add(stoneBox(W + 1, 0.4, L + 1, wallMat)); ceil.position.set(ox, H + 0.2, oz + L / 2);
  for (const [x, z, w, d] of [[ox - W / 2 - 0.25, oz + L / 2, 0.5, L + 1], [ox + W / 2 + 0.25, oz + L / 2, 0.5, L + 1], [ox, oz - 0.25, W, 0.5], [ox, oz + L + 0.25, W, 0.5]]){
    const wall = add(stoneBox(w, H + (stones ? 1.6 : 0), d, wallMat)); wall.position.set(x, (H - (stones ? 1.6 : 0)) / 2, z);
  }
  // the wall across the chamber, with a doorway and a portcullis in it
  for (const s of [-1, 1]){
    const w = W / 2 - 1.3, seg = add(stoneBox(w, H, 0.5, wallMat)); seg.position.set(ox + s * (1.3 + w / 2), H / 2, oz + DOOR_Z);
    boxes.push([ox + s * 1.3 + (s < 0 ? -w : 0), ox + s * 1.3 + (s > 0 ? w : 0), oz + DOOR_Z - 0.25, oz + DOOR_Z + 0.25]);
  }
  const lintel = add(stoneBox(2.6, H - 3.2, 0.5, wallMat)); lintel.position.set(ox, 3.2 + (H - 3.2) / 2, oz + DOOR_Z);
  const door = props.createPortcullis({ env }); door.group.position.set(ox, 0, oz + DOOR_Z); add(door.group);
  sh.doorBox = [ox - 1.3, ox + 1.3, oz + DOOR_Z - 0.2, oz + DOOR_Z + 0.2];
  // rune bands along the walls, glowing in the power's colour
  for (const s of [-1, 1]) for (const y of [0.35, H - 0.6]){
    const band = add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, L - 1), runeMat)); band.position.set(ox + s * (W / 2 - 0.01), y, oz + L / 2);
  }
  for (let k = 0; k < 18; k++){
    const s = k % 2 ? 1 : -1, z = oz + 1.2 + (k >> 1) * 2.1;
    const glyph = add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.25 + rng() * 0.3, 0.06 + rng() * 0.12), runeMat));
    glyph.position.set(ox + s * (W / 2 - 0.01), 1.8 + rng() * 1.6, z);
  }
  // the way back: the gate you came through stands at the south end
  const gate = props.createPowerGate(kind, { env }); gate.group.position.set(ox, 0, oz + 0.35); add(gate.group); sh.gate = gate;
  // fires at the entrance
  for (const s of [-1, 1]){
    const b = props.createBrazier({ env }); b.group.position.set(ox + s * 3.8, 0, oz + 1.6); add(b.group);
    b.group.updateMatrixWorld(true); const at = new THREE.Vector3(); b.flameAnchor.getWorldPosition(at);
    const f = add(makeFlame(0.8)); f.position.copy(at); flames.push(f);
    lights.push({ pos: at.clone().add(new THREE.Vector3(0, 0.6, 0)), color: new THREE.Color(0xff8a40), base: 18, phase: rng() * 100, w: 0, big: true });
    circles.push({ x: b.group.position.x, z: b.group.position.z, r: 0.45 });
  }
  // the altar and the power on it
  const altar = add(stoneBox(1.2, 1.0, 1.2, wallMat)); altar.position.set(ox, 0.5, oz + 17);
  boxes.push([ox - 0.6, ox + 0.6, oz + 16.4, oz + 17.6]);
  const orb = add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 3), new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(3), fog: false })));
  orb.position.set(ox, 1.55, oz + 17); sh.orb = orb;
  const halo = add(new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 12), new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(0.5), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })));
  halo.position.copy(orb.position); sh.halo = halo;
  sh.altarLight = { pos: new THREE.Vector3(ox, 2.2, oz + 17), color: color.clone(), base: 10, phase: 1, w: 0, big: true };
  lights.push(sh.altarLight);
  // a cold glow from the runes over the trial
  lights.push({ pos: new THREE.Vector3(ox, H - 0.8, oz + 8), color: color.clone().lerp(new THREE.Color(0xffffff), 0.5), base: 9, phase: 3, w: 0, big: true });

  // ---------- the trials ----------
  const interact = [];      // { pos, label, hold, act, when }
  if (kind === 'bomb') buildPush(); else if (kind === 'magnet') buildFires(); else if (kind === 'freeze') buildStones(); else buildLevers();

  function buildPush(){
    // a 10 x 8 grid of 1 m cells. The plate can't be reached by pushing straight east then north, or straight
    // north then east: a pillar blocks each, so the block has to go round.
    const cx = (i) => ox - 4.5 + i, cz = (j) => oz + 3.5 + j;
    const pillars = [[5, 7], [7, 5]], plate = [7, 7], start = [2, 2];
    const pillarSet = new Set(pillars.map((p) => p + ''));
    for (const [i, j] of pillars){ const p = add(stoneBox(0.9, H, 0.9, wallMat)); p.position.set(cx(i), H / 2, cz(j)); boxes.push([cx(i) - 0.45, cx(i) + 0.45, cz(j) - 0.45, cz(j) + 0.45]); }
    const plateMat = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(0.5) });
    const pl = add(new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.04, 0.96), plateMat)); pl.position.set(cx(plate[0]), 0.02, cz(plate[1]));
    const ring = add(new THREE.Mesh(new THREE.RingGeometry(0.36, 0.44, 32).rotateX(-Math.PI / 2), runeMat)); ring.position.set(cx(plate[0]), 0.05, cz(plate[1]));
    const block = add(stoneBox(0.96, 0.96, 0.96, wallMat, 1.6));
    const topRune = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.26, 24).rotateX(-Math.PI / 2), runeMat); topRune.position.y = 0.49; block.add(topRune);
    const B = { i: start[0], j: start[1], from: null, t: 0, push: 0 };
    const place = () => { block.position.set(cx(B.i), 0.48, cz(B.j)); };
    place();
    sh.block = B; sh.cell = { cx, cz }; sh.plate = plate; sh.pillars = pillars;
    sh.reset = () => { B.i = start[0]; B.j = start[1]; B.from = null; place(); };
    // a rune stone by the entrance puts the block back
    const rs = add(stoneBox(0.5, 1.1, 0.5, wallMat)); rs.position.set(ox + 3.2, 0.55, oz + 2.7);
    const rr = add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.02), runeMat)); rr.position.set(ox + 3.2, 0.8, oz + 2.95);
    boxes.push([ox + 2.95, ox + 3.45, oz + 2.45, oz + 2.95]);
    interact.push({ pos: new THREE.Vector3(ox + 3.2, 0, oz + 2.9), label: 'Put the block back', hold: 0, act: (api) => { sh.reset(); api.sfx.thud(null); } });
    sh.blockBox = () => { const x = block.position.x, z = block.position.z; return [x - 0.48, x + 0.48, z - 0.48, z + 0.48]; };
    sh.updateTrial = (dt, player, api) => {
      if (B.from){
        B.t += dt; const f = Math.min(1, B.t / 0.45);
        block.position.set(cx(B.from[0] + (B.i - B.from[0]) * f), 0.48, cz(B.from[1] + (B.j - B.from[1]) * f));
        if (f >= 1){ B.from = null; if (B.i === plate[0] && B.j === plate[1] && !sh.solved){ sh.solved = true; plateMat.color.copy(color).multiplyScalar(2.5); api.solved(); } }
        return;
      }
      // pushing: pressed up against a face and walking into it for a moment
      const dx = player.x - block.position.x, dz = player.z - block.position.z;
      const ax = Math.abs(dx) > Math.abs(dz);
      const dir = ax ? [-Math.sign(dx), 0] : [0, -Math.sign(dz)];
      const gap = (ax ? Math.abs(dx) : Math.abs(dz)) - 0.48 - api.radius, side = ax ? Math.abs(dz) : Math.abs(dx);
      const into = player.vx * dir[0] + player.vz * dir[1];
      if (gap < 0.08 && side < 0.4 && into > 0.6){
        B.push += dt;
        if (B.push > 0.3){
          B.push = 0;
          const ni = B.i + dir[0], nj = B.j + dir[1];
          if (ni >= 0 && ni <= 9 && nj >= 0 && nj <= 8 && !pillarSet.has(ni + ',' + nj)){ B.from = [B.i, B.j]; B.i = ni; B.j = nj; B.t = 0; api.sfx.scrape([block.position.x, 0.5, block.position.z]); }
          else api.sfx.thud([block.position.x, 0.5, block.position.z]);
        }
      } else B.push = 0;
    };
  }

  function buildFires(){
    const spots = [[-3, 5], [3, 5], [-3, 10], [3, 10]];
    sh.fires = spots.map(([x, z], k) => {
      const b = props.createBrazier({ env }); b.group.position.set(ox + x, 0, oz + z); add(b.group);
      b.group.updateMatrixWorld(true); const at = new THREE.Vector3(); b.flameAnchor.getWorldPosition(at);
      const f = add(makeFlame(0.8)); f.position.copy(at); f.visible = false;
      const light = { pos: at.clone().add(new THREE.Vector3(0, 0.6, 0)), color: new THREE.Color(0xff8a40), base: 0, phase: k * 7, w: 0, big: true };
      lights.push(light); circles.push({ x: ox + x, z: oz + z, r: 0.45 });
      const fire = { f, light, t: 0, pos: new THREE.Vector3(ox + x, 0, oz + z) };
      interact.push({ pos: fire.pos, label: 'Light the fire', hold: 0, when: () => fire.t <= 0 && !sh.solved,
        act: (api) => { fire.t = 20; api.sfx.ignite([fire.pos.x, 1, fire.pos.z]); } });
      return fire;
    });
    sh.updateTrial = (dt, player, api) => {
      let lit = 0;
      for (const fire of sh.fires){
        if (fire.t > 0 && !sh.solved){ fire.t -= dt; if (fire.t <= 0){ api.sfx.douse([fire.pos.x, 1, fire.pos.z]); api.hint('A FIRE WENT OUT', 1.5); } }
        const on = sh.solved || fire.t > 0;
        fire.f.visible = on; fire.f.scale.setScalar(sh.solved ? 1 : Math.max(0.3, Math.min(1, fire.t / 6)));
        fire.light.base = on ? 16 * fire.f.scale.x : 0;
        if (on) lit++;
      }
      if (lit === 4 && !sh.solved){ sh.solved = true; api.solved(); }
    };
    sh.reset = () => { for (const fire of sh.fires) fire.t = 0; };
  }

  function buildStones(){
    // five across, four rows; one safe stone per row, each next to the last
    const cols = [-4, -2, 0, 2, 4], rows = [4.3, 6.3, 8.3, 10.3];
    let c = (rng() * 5) | 0; const path = [];
    for (let r = 0; r < 4; r++){ if (r){ c = Math.max(0, Math.min(4, c + ((rng() * 3) | 0) - 1)); } path.push(c); }
    sh.path = path; sh.cols = cols; sh.rows = rows;
    const SZ = 1.4, TOL = 0.45;    // stones 1.4 m across with 0.6 m of water between; you can step across a gap, not stand in a hole
    const topGeo = new THREE.BoxGeometry(SZ, 0.12, SZ);
    sh.stones = [];
    for (let r = 0; r < 4; r++) for (let k = 0; k < 5; k++){
      const x = ox + cols[k], z = oz + rows[r];
      const g = new THREE.Group(); g.position.set(x, 0, z); add(g);
      const col = stoneBox(SZ - 0.1, 1.5, SZ - 0.1, wallMat); col.position.y = -0.81; g.add(col);
      const topMat = new THREE.MeshStandardMaterial({ map: mats.floor.map, normalMap: mats.floor.normalMap, roughness: 0.8, emissive: new THREE.Color(0x2f7dff), emissiveIntensity: 0 });
      const top = new THREE.Mesh(topGeo, topMat); top.position.y = -0.06; top.receiveShadow = top.castShadow = true; g.add(top);
      sh.stones.push({ g, topMat, x, z, r, k, safe: path[r] === k, sink: 0, stood: 0 });
    }
    // the rune plate that shows the way
    const plate = add(new THREE.Mesh(new THREE.RingGeometry(0.42, 0.52, 40).rotateX(-Math.PI / 2), runeMat)); plate.position.set(ox, 0.02, oz + 2.9);
    const dot = add(new THREE.Mesh(new THREE.CircleGeometry(0.12, 20).rotateX(-Math.PI / 2), runeMat)); dot.position.set(ox, 0.02, oz + 2.9);
    sh.reveal = -1;
    sh.doorOpen = 1; door.setRaised(1); sh.doorBox = null;
    sh.stoneAt = (x, z) => sh.stones.find((s) => Math.abs(x - s.x) < SZ / 2 + TOL && Math.abs(z - s.z) < SZ / 2 + TOL && s.sink < 0.5);
    sh.updateTrial = (dt, player, api) => {
      // step on the plate: the safe stones glow one row at a time
      if (sh.reveal < 0 && Math.hypot(player.x - ox, player.z - (oz + 2.9)) < 0.6){ sh.reveal = 0; api.sfx.chime(); }
      if (sh.reveal >= 0){ sh.reveal += dt; if (sh.reveal > 5){ sh.reveal = -1; } }
      for (const s of sh.stones){
        let glow = 0;
        if (sh.reveal >= 0 && s.safe){ const on = sh.reveal - s.r * 0.75; glow = on > 0 && sh.reveal < 4.2 ? Math.min(1, on * 3) : 0; }
        if (sh.solved && s.safe) glow = 0.6;
        s.topMat.emissiveIntensity = glow * 0.9;
        // the wrong ones give way under you
        const onIt = Math.abs(player.x - s.x) < SZ / 2 && Math.abs(player.z - s.z) < SZ / 2 && player.y - api.eye > -0.5;
        if (onIt && !s.safe){ s.stood += dt; if (s.stood > 0.25 && s.sink === 0){ s.sink = 0.001; api.sfx.crack([s.x, 0, s.z]); } }
        if (s.sink > 0 && s.sink < 1.6){ s.sink += dt; s.g.position.y = -Math.min(1.5, s.sink * 1.4); }
      }
      if (player.z > oz + PIT1 + 0.3 && !sh.solved){ sh.solved = true; api.solved(); }
    };
    sh.reset = () => { for (const s of sh.stones){ s.sink = 0; s.stood = 0; s.g.position.y = 0; } sh.reveal = -1; };
  }

  function buildLevers(){
    const syms = ['sun', 'moon', 'star', 'eye'];
    const order = syms.slice().sort(() => rng() - 0.5);
    sh.order = order;
    const mural = add(new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.1), new THREE.MeshStandardMaterial({ map: muralTexture(order), emissiveMap: muralTexture(order), emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.9 })));
    mural.position.set(ox, 4.35, oz + DOOR_Z - 0.26); mural.rotation.y = Math.PI;
    const baseGeo = new THREE.BoxGeometry(0.4, 0.5, 0.4), armGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.75, 8).translate(0, 0.375, 0);
    const knobGeo = new THREE.SphereGeometry(0.07, 12, 8);
    sh.levers = syms.map((sym, k) => {
      const x = ox - 3 + k * 2, z = oz + 10.5;
      const base = add(new THREE.Mesh(baseGeo, mats.iron)); base.position.set(x, 0.25, z); base.castShadow = true;
      const pivot = new THREE.Group(); pivot.position.set(x, 0.45, z); add(pivot);
      const arm = new THREE.Mesh(armGeo, mats.iron), knob = new THREE.Mesh(knobGeo, mats.wood); knob.position.y = 0.78; arm.castShadow = true;
      pivot.add(arm, knob);
      // the symbol on a stone post behind the lever
      const post = add(stoneBox(0.6, 1.8, 0.3, wallMat)); post.position.set(x, 0.9, z + 0.55);
      const plaque = add(new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshStandardMaterial({ map: symbolTexture(sym), emissiveMap: symbolTexture(sym), emissive: 0xffffff, emissiveIntensity: 0.7 })));
      plaque.position.set(x, 1.45, z + 0.39); plaque.rotation.y = Math.PI;
      boxes.push([x - 0.3, x + 0.3, z - 0.2, z + 0.7]);
      const lever = { sym, pivot, down: false, angle: -0.6, pos: new THREE.Vector3(x, 0, z - 0.2) };
      interact.push({ pos: lever.pos, label: 'Pull the lever', hold: 0, when: () => !lever.down && !sh.solved,
        act: (api) => {
          lever.down = true; api.sfx.lever([x, 1, z]);
          const pulled = sh.levers.filter((l) => l.down).length;
          if (sym !== order[pulled - 1]){ sh.wrong = 0.7; api.hint('WRONG ORDER', 1.5); }
          else if (pulled === 4){ sh.solved = true; api.solved(); }
        } });
      return lever;
    });
    sh.wrong = 0;
    sh.updateTrial = (dt, player, api) => {
      if (sh.wrong > 0){ sh.wrong -= dt; if (sh.wrong <= 0){ for (const l of sh.levers) l.down = false; api.sfx.thud(null); } }
      for (const l of sh.levers){ l.angle += ((l.down ? 0.7 : -0.6) - l.angle) * Math.min(1, dt * 10); l.pivot.rotation.x = l.angle; }
    };
    sh.reset = () => { for (const l of sh.levers) l.down = false; sh.wrong = 0; };
  }

  // ---------- what the game asks of a shrine ----------
  interact.push({ pos: new THREE.Vector3(ox, 0, oz + 16.2), label: 'Take the power', hold: 0, when: () => sh.solved && !sh.taken && sh.doorOpen > 0.8,
    act: (api) => { sh.taken = true; api.takePower(); } });
  sh.interactables = () => interact.filter((it) => !it.when || it.when());
  // keep a circle (the player) inside the chamber and out of anything solid
  sh.collide = (o, r) => {
    o.x = Math.max(ox - W / 2 + r, Math.min(ox + W / 2 - r, o.x));
    o.z = Math.max(oz + 0.15 + r, Math.min(oz + L - r, o.z));
    const all = boxes.slice();
    if (sh.doorBox && sh.doorOpen < 0.9) all.push(sh.doorBox);
    if (sh.blockBox) all.push(sh.blockBox());
    for (const [x0, x1, z0, z1] of all){
      const nx = Math.max(x0, Math.min(o.x, x1)), nz = Math.max(z0, Math.min(o.z, z1));
      const dx = o.x - nx, dz = o.z - nz, d = Math.hypot(dx, dz);
      if (d < r && d > 1e-6){ o.x = nx + dx / d * r; o.z = nz + dz / d * r; }
      else if (d <= 1e-6){ o.z = z0 - r; }
    }
    for (const c of circles){ const dx = o.x - c.x, dz = o.z - c.z, d = Math.hypot(dx, dz), m = c.r + r; if (d < m && d > 1e-6){ o.x = c.x + dx / d * m; o.z = c.z + dz / d * m; } }
  };
  sh.contains = (x, z) => x > ox - W / 2 - 1 && x < ox + W / 2 + 1 && z > oz - 1 && z < oz + L + 1;
  sh.floorAt = (x, z) => {
    if (!stones || z < oz + PIT0 || z > oz + PIT1) return 0;
    const s = sh.stoneAt(x, z); return s ? s.g.position.y : -1.2;
  };
  sh.inWater = (x, z) => stones && z > oz + PIT0 + 0.15 && z < oz + PIT1 - 0.15 && !sh.stoneAt(x, z);
  sh.atExit = (x, z) => z < oz + 0.95 && Math.abs(x - ox) < 0.9;
  sh.update = (dt, t, player, api) => {
    gate.update(t);
    sh.updateTrial(dt, player, api);
    if (sh.solved && sh.doorOpen < 1){ sh.doorOpen = Math.min(1, sh.doorOpen + dt * 0.5); door.setRaised(sh.doorOpen); }
    orb.position.y = 1.55 + Math.sin(t * 1.7) * 0.06; orb.rotation.y = t; orb.visible = halo.visible = !sh.taken;
    halo.scale.setScalar(1 + Math.sin(t * 3) * 0.08);
    sh.altarLight.base = sh.taken ? 2 : 10;
  };
  return sh;
}
