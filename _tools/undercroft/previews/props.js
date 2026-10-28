// Preview of the Undercroft's props (experiments/undercroft/js/models/props.js) for preview.html / shoot.mjs.
// Builds every prop once, then each view shows one group and frames the camera on it.
import * as P from '/experiments/undercroft/js/models/props.js';

let S = null;  // everything built, by name

export const views = [
  { name: 'weapons' }, { name: 'weapons-close' }, { name: 'sword-vm' }, { name: 'crossbow-vm' }, { name: 'hammer-vm' }, { name: 'food' },
  { name: 'chest-closed' }, { name: 'chest-open' },
  { name: 'gate-magnet' }, { name: 'gate-bomb' }, { name: 'gate-freeze' }, { name: 'gate-shield' }, { name: 'gate-spent' },
  { name: 'cell-closed' }, { name: 'cell-lock' }, { name: 'cell-open' }, { name: 'portcullis' }, { name: 'brazier' }, { name: 'bomb' },
  { name: 'gate-wide' }, { name: 'cracked-wall' }, { name: 'skulls' }, { name: 'skull-close' },
];

function tris(o){
  let n = 0;
  o.traverse((m) => { if (m.isMesh){ const g = m.geometry; n += Math.min(g.drawRange.count, g.index ? g.index.count : g.attributes.position.count) / 3; } });
  return Math.round(n);
}
function meshes(o){ let n = 0; o.traverse((m) => { if (m.isMesh) n++; }); return n; }

export default async function (ctx){
  const { THREE, scene, env } = ctx;
  const add = (o) => { o.visible = false; scene.add(o); return o; };
  S = {};
  // weapons laid out on the floor, flats up
  S.weapons = add(new THREE.Group());
  // the crest must stay under the corridor's 3.2 m ceiling
  { const g = P.createPowerGate('shield', { env }).group; const b = new THREE.Box3().setFromObject(g); console.log('gate bounds', b.min.toArray().map((v) => v.toFixed(2)), b.max.toArray().map((v) => v.toFixed(2))); }
  const lay = [['sword', -0.55, 0.0], ['spear', 0.0, 0.0], ['hammer', 0.45, 0.0], ['crossbow', 0.95, 0.0]];
  for (const [k, z] of lay.map(([k, z]) => [k, z])){
    const w = P.createWeapon(k, { env });
    if (k === 'crossbow'){ w.position.set(0.05, 0.075, z); w.rotation.y = Math.PI / 2; }
    else { w.rotation.z = -Math.PI / 2; w.position.set(k === 'spear' ? -0.4 : -0.15, 0.03, z); }
    S.weapons.add(w);
    console.log(`${k}: ${tris(w)} tris, ${meshes(w)} meshes`);
  }
  const bolt = P.createBolt({ env }); bolt.position.set(0.35, 0.012, -0.25); bolt.rotation.y = 0.4; S.weapons.add(bolt);
  console.log(`bolt: ${tris(bolt)} tris`);
  S.vm = {};
  for (const k of ['sword', 'crossbow', 'hammer']) S.vm[k] = add(P.createWeapon(k, { env }));
  S.food = add(new THREE.Group());
  const fl = [['bread', -0.08, 0.02, 0.3], ['apple', 0.2, 0.1, 0], ['cheese', 0.12, -0.12, 0.6], ['drumstick', -0.16, -0.17, -0.3]];
  for (const [k, x, z, ry] of fl){ const f = P.createFood(k); f.position.set(x, 0, z); f.rotation.y = ry; S.food.add(f); console.log(`${k}: ${tris(f)} tris`); }
  S.chest = P.createChest({ env }); add(S.chest.group); console.log(`chest: ${tris(S.chest.group)} tris, ${meshes(S.chest.group)} meshes`);
  S.gates = {};
  for (const k of ['magnet', 'bomb', 'freeze', 'shield']){ S.gates[k] = P.createPowerGate(k, { env, light: true }); add(S.gates[k].group); }
  console.log(`gate: ${tris(S.gates.magnet.group)} tris, ${meshes(S.gates.magnet.group)} meshes`);
  S.cell = P.createCellBars({ env }); add(S.cell.group); console.log(`cell bars: ${tris(S.cell.group)} tris, ${meshes(S.cell.group)} meshes`);
  S.port = P.createPortcullis({ env }); add(S.port.group); console.log(`portcullis: ${tris(S.port.group)} tris`);
  S.brazier = P.createBrazier({ env }); add(S.brazier.group); console.log(`brazier: ${tris(S.brazier.group)} tris, ${meshes(S.brazier.group)} meshes`);
  S.bombs = [P.createBomb({ env }), P.createBomb({ env })];
  S.bombGroup = add(new THREE.Group());
  S.bombs[0].group.position.set(-0.17, 0, 0); S.bombs[1].group.position.set(0.17, 0, -0.05); S.bombs[1].group.rotation.y = -0.7;
  for (const b of S.bombs) S.bombGroup.add(b.group);
  console.log(`bomb: ${tris(S.bombs[0].group)} tris, ${meshes(S.bombs[0].group)} meshes`);
  S.wall = P.createCrackedWall({ env }); add(S.wall.group); S.wall.group.position.z = -1.5;
  console.log(`cracked wall: ${tris(S.wall.group)} tris`);
  S.debris = S.wall.debris(); for (const d of S.debris){ d.visible = false; scene.add(d); d.position.z += 0.6; d.position.y = 0.06 + Math.random() * 0.02; }
  S.skulls = add(P.createSkullPile({ env })); console.log(`skull pile: ${tris(S.skulls)} tris`);
  // let the textures arrive before the first shot
  await new Promise((r) => setTimeout(r, 1500));
}

export async function show(ctx, view){
  const { THREE, scene, camera, setView, wallTorch } = ctx;
  for (const o of scene.children) if (o.userData.prop !== false && !o.isLight && o !== ctx.room && o !== camera) o.visible = false;
  const n = view.name, V = (x, y, z) => new THREE.Vector3(x, y, z);
  wallTorch.position.set(-5.4, 2.3, -2);
  const held = (o, at, rot) => { // place o in front of the camera like a first-person viewmodel
    camera.updateMatrixWorld();
    o.position.copy(camera.localToWorld(at.clone()));
    o.quaternion.copy(camera.quaternion).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)));
    o.visible = true;
  };
  if (n === 'weapons'){ S.weapons.visible = true; setView(V(0.15, 0, 0.22), 1.75, 0, 72); }
  else if (n === 'weapons-close'){ S.weapons.visible = true; setView(V(0.3, 0, 0.28), 0.62, -20, 55); }
  else if (n === 'sword-vm'){ setView(V(0, 1.6, -1), 1, 0, 0); held(S.vm.sword, V(0.2, -0.26, -0.5), [-0.75, 0.5, 0.35]); }
  else if (n === 'crossbow-vm'){ setView(V(0, 1.6, -1), 1, 0, 0); held(S.vm.crossbow, V(0.14, -0.2, -0.42), [0.05, 0.1, 0]); }
  else if (n === 'hammer-vm'){ setView(V(0, 1.6, -1), 1, 0, 0); held(S.vm.hammer, V(0.22, -0.5, -0.78), [-0.2, -1.3, 0.3]); }
  else if (n === 'food'){ S.food.visible = true; setView(V(0.02, 0.03, -0.02), 0.62, 15, 38); }
  else if (n.startsWith('chest')){ S.chest.group.visible = true; S.chest.setOpen(n === 'chest-open' ? 1 : 0); setView(V(0, 0.3, 0), 1.55, 30, 28); }
  else if (n.startsWith('gate') && n !== 'gate-wide'){
    const k = n === 'gate-spent' ? 'magnet' : n.slice(5), g = S.gates[k];
    g.group.visible = true;
    g.setActive(n !== 'gate-spent');
    for (let t = 0; t < 6; t += 0.05) g.update(2 + t);
    setView(V(0, 1.5, 0), 4.0, 22, 6);
  }
  else if (n === 'gate-wide'){ const g = S.gates.freeze; g.group.visible = true; g.setActive(true); g.update(9); setView(V(0, 1.7, 0), 5.2, -15, 12); }
  else if (n === 'cell-lock'){ S.cell.group.visible = true; S.cell.setOpen(0); setView(V(0.5, 1.0, 0), 0.75, 25, 10); }
  else if (n.startsWith('cell')){ S.cell.group.visible = true; S.cell.setOpen(n === 'cell-open' ? 1 : 0); setView(V(0, 1.4, 0), 3.9, 25, 8); }
  else if (n === 'portcullis'){ S.port.group.visible = true; S.port.setRaised(0.35); setView(V(0, 1.6, 0), 4.0, 18, 6); }
  else if (n === 'brazier'){ S.brazier.group.visible = true; setView(V(0, 0.8, 0), 1.75, 20, 20); }
  else if (n === 'bomb'){ S.bombGroup.visible = true; S.bombs[0].update(3, 0.1); S.bombs[1].update(3.3, 0.8); setView(V(0, 0.12, 0), 0.85, 10, 20); }
  else if (n === 'cracked-wall'){ S.wall.group.visible = true; for (const d of S.debris) d.visible = true; setView(V(0, 1.5, -1.5), 3.9, 18, 4); }
  else if (n === 'skulls'){ S.skulls.visible = true; setView(V(0, 0.08, 0), 0.75, 20, 25); }
  else if (n === 'skull-close'){ S.skulls.visible = true; setView(V(0.08, 0.06, 0.1), 0.42, 35, 8); }
}
