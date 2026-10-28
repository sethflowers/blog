// Preview of the zombies and prisoners (experiments/undercroft/js/models/people.js), lit like the game.
//   NODE_PATH=$(npm root -g) node _tools/undercroft/shoot.mjs /_tools/undercroft/previews/people.js /tmp/people/shot
import { createPeopleKit } from '/experiments/undercroft/js/models/people.js';

let kit, Z = [], Pr = [], bars;

export default async (ctx) => {
  const { THREE, scene } = ctx;
  const t0 = performance.now();
  kit = await createPeopleKit({ env: ctx.env });
  console.log(`kit built in ${(performance.now() - t0).toFixed(0)} ms (sync part ${kit.buildTime.toFixed(0)} ms incl. loads)`);
  for (let i = 0; i < 3; i++){ const z = kit.makeZombie(i + 1); scene.add(z.group); Z.push(z); }
  for (let i = 0; i < 3; i++){ const p = kit.makePrisoner(i + 1); scene.add(p.group); Pr.push(p); }
  // count what one figure costs
  let tris = 0, calls = 0;
  Z[0].group.traverse((o) => { if (o.isMesh){ calls++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
  console.log(`zombie: ${tris} triangles, ${calls} draw calls`);
  tris = 0; calls = 0;
  Pr[0].group.traverse((o) => { if (o.isMesh){ calls++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
  console.log(`prisoner: ${tris} triangles, ${calls} draw calls`);
  // a row of cell bars for the gripping pose
  bars = new THREE.Group();
  const iron = new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 0.5, metalness: 0.8, envMap: ctx.env });
  for (let i = -4; i <= 4; i++){ const b = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 2.4, 10), iron); b.position.set(i * 0.12, 1.2, 0); b.castShadow = true; bars.add(b); }
  const rail = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.04, 0.04), iron); rail.position.y = 2.2; bars.add(rail);
  scene.add(bars);
};

export const views = [
  { name: 'zgroup' }, { name: 'zface' }, { name: 'zattack' }, { name: 'zdead' }, { name: 'zemerge' },
  { name: 'psit' }, { name: 'pbars' }, { name: 'pcheer' }, { name: 'pface' }, { name: 'pwalk' },
];

function hideAll(){ for (const f of [...Z, ...Pr]) f.group.visible = false; bars.visible = false; }
function run(f, s, secs){ for (let t = 0; t < secs; t += 1 / 30) f.update(1 / 30, s); }

export async function show(ctx, v){
  const { THREE } = ctx;
  hideAll();
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  ctx.wallTorch.position.set(-2.5, 2.3, 1.5);
  if (v.name === 'zgroup'){
    Z.forEach((z, i) => { z.group.visible = true; z.group.position.set((i - 1) * 0.95, 0, -0.3 * Math.abs(i - 1)); z.group.rotation.y = (i - 1) * -0.25; run(z, { speed: [0.8, 1.2, 1.6][i] }, 1.3 + i * 0.37); });
    ctx.setView(V(0, 1.0, 0), 3.6, 8, 4);
  } else if (v.name === 'zface'){
    const z = Z[0]; z.group.visible = true; z.group.position.set(0, 0, 0); z.group.rotation.y = 0; run(z, { speed: 0 }, 1);
    ctx.setView(V(0, 1.62, 0.05), 1.0, 15, 2);
  } else if (v.name === 'zattack'){
    const z = Z[1]; z.group.visible = true; z.group.position.set(0, 0, 0); z.group.rotation.y = 0;
    run(z, { speed: 0.6 }, 0.5); for (let a = 0; a <= 0.47; a += 1 / 30) z.update(1 / 30, { speed: 0.6, attack: a });
    ctx.setView(V(0, 1.1, 0), 2.8, 35, 5);
  } else if (v.name === 'zdead'){
    const z = Z[2]; z.group.visible = true; z.group.position.set(0, 0, 0); z.group.rotation.y = 0.6;
    for (let d = 0; d <= 1; d += 1 / 40) z.update(1 / 30, { dead: d });
    ctx.setView(V(0, 0.3, 0), 2.6, 60, 30);
  } else if (v.name === 'zemerge'){
    const z = Z[0]; z.group.visible = true; z.group.position.set(0, 0, 0); z.group.rotation.y = 0;
    for (let e = 0; e <= 0.5; e += 1 / 60) z.update(1 / 30, { emerge: e });
    ctx.setView(V(0, 0.4, 0), 2.6, 20, 12);
  } else if (v.name === 'psit'){
    Pr.forEach((p, i) => { p.group.visible = i < 2; p.group.position.set(i * 0.9 - 0.4, 0, -5.4); p.group.rotation.y = 0; run(p, { pose: 'sit' }, 1.5 + i); });
    ctx.setView(V(0.05, 0.55, -5.2), 2.5, 10, 12);
  } else if (v.name === 'pbars'){
    bars.visible = true; bars.position.set(0, 0, 0.3);
    const p = Pr[1]; p.group.visible = true; p.group.position.set(0, 0, 0); p.group.rotation.y = 0; run(p, { pose: 'bars' }, 2);
    ctx.setView(V(0, 1.35, 0.3), 2.0, 20, 4);
  } else if (v.name === 'pcheer'){
    const p = Pr[2]; p.group.visible = true; p.group.position.set(0, 0, 0); p.group.rotation.y = 0; run(p, { pose: 'cheer' }, 1.1);
    ctx.setView(V(0, 1.2, 0), 3.0, 15, 4);
  } else if (v.name === 'pface'){
    const p = Pr[0]; p.group.visible = true; p.group.position.set(0, 0, 0); p.group.rotation.y = 0; run(p, { pose: 'bars' }, 1);
    ctx.setView(V(0, 1.62, 0.05), 0.9, -15, 0);
  } else if (v.name === 'pwalk'){
    Pr.forEach((p, i) => { p.group.visible = true; p.group.position.set((i - 1) * 1.1, 0, 0); p.group.rotation.y = 1.2; run(p, { pose: 'walk', speed: [1.2, 2.2, 3.5][i] }, 0.8 + i * 0.3); });
    ctx.setView(V(0, 1.0, 0), 3.8, 20, 4);
  }
}
