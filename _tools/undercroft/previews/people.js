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

// pick views with the module path: people.js?v=zface,xneck (x* views are diagnostics, left out by default)
const ONLY = new URL(import.meta.url).searchParams.get('v');
const ALL = [
  { name: 'zgroup' }, { name: 'zface' }, { name: 'zattack' }, { name: 'zdead' }, { name: 'zemerge' },
  { name: 'psit' }, { name: 'pbars' }, { name: 'pcheer' }, { name: 'pface' }, { name: 'pwalk' },
  { name: 'xneck' }, { name: 'xbody' }, { name: 'xscalp' }, { name: 'xsit' }, { name: 'xhair' }, { name: 'xzhair' }, { name: 'xhurt' }, { name: 'xjaw' },
];
export const views = ONLY ? ALL.filter((v) => ONLY.split(',').includes(v.name)) : ALL.filter((v) => !v.name.startsWith('x'));

function hideAll(){ for (const f of [...Z, ...Pr]) f.group.visible = false; bars.visible = false; }
function run(f, s, secs){ for (let t = 0; t < secs; t += 1 / 30) f.update(1 / 30, s); }

export async function show(ctx, v){
  const { THREE } = ctx;
  hideAll();
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  ctx.wallTorch.position.set(-2.5, 2.3, 1.5);
  if (v.name === 'zgroup'){
    Z.forEach((z, i) => { z.group.visible = true; z.group.position.set((i - 1) * 0.95, 0, -0.3 * Math.abs(i - 1)); z.group.rotation.y = (i - 1) * -0.25; run(z, { speed: [0.8, 1.2, 1.6][i] }, 1.3 + i * 0.37); });
    ctx.setView(V(0, 1.0, 0), 3.4, 35, 4);
  } else if (v.name === 'zface'){
    const z = Z[0]; z.group.visible = true; z.group.position.set(0, 0, 0); z.group.rotation.y = 0; run(z, { speed: 0 }, 1);
    ctx.setView(V(0, 1.62, 0.05), 1.0, 15, 2);
  } else if (v.name === 'zattack'){
    // the same swing at two moments: cocked back (0.28) and raking through (0.5)
    [[Z[1], 0.28, -0.55], [Z[2], 0.5, 0.55]].forEach(([z, at, x]) => {
      z.group.visible = true; z.group.position.set(x, 0, 0); z.group.rotation.y = 0.5;
      run(z, { speed: 0.6 }, 0.5); for (let a = 0; a <= at; a += 1 / 60) z.update(1 / 60, { speed: 0.6, attack: a });
    });
    ctx.setView(V(0, 1.1, 0), 3.0, 20, 5);
  } else if (v.name === 'zdead'){
    // two corpses: one fell back, one pitched forward onto its face
    [[Z[2], -0.5, 0.6], [Z[0], 0.6, -0.4]].forEach(([z, x, ry]) => { z.group.visible = true; z.group.position.set(x, 0, 0); z.group.rotation.y = ry;
      for (let d = 0; d <= 1; d += 1 / 40) z.update(1 / 30, { dead: d }); });
    ctx.setView(V(0, 0.3, 0), 2.6, 60, 30);
  } else if (v.name === 'zemerge'){
    // climbing out of the floor at three moments: hands breaking the surface, hauling out, standing up
    [[Z[0], 0.3, -1.0], [Z[1], 0.6, 0], [Z[2], 0.85, 1.0]].forEach(([z, at, x]) => {
      z.group.visible = true; z.group.position.set(x, 0, 0); z.group.rotation.y = 0.3;
      for (let e = 0; e <= at; e += 1 / 60) z.update(1 / 30, { emerge: e });
    });
    ctx.setView(V(0, 0.5, 0), 3.4, 25, 12);
  } else if (v.name === 'xjaw'){
    const z = Z[0], p = Pr[2];
    z.group.visible = p.group.visible = true;
    z.group.position.set(-0.2, 0, 0); z.group.rotation.y = 0.3; for (let a = 0; a <= 0.3; a += 1 / 60) z.update(1 / 60, { attack: a });
    p.group.position.set(0.25, 0, 0.1); p.group.rotation.y = -0.3; run(p, { pose: 'cheer' }, 0.4);
    ctx.setView(V(0, 1.62, 0), 1.0, 0, 0);
  } else if (v.name === 'xhurt'){
    const z = Z[1]; z.group.visible = true; z.group.position.set(0, 0, 0); z.group.rotation.y = 0.4;
    run(z, { speed: 1 }, 0.5); z.update(1 / 30, { speed: 1, hurt: 0.9 });
    ctx.setView(V(0, 1.1, 0), 2.6, 40, 5);
  } else if (v.name === 'psit'){
    Pr.forEach((p, i) => { p.group.visible = i < 2; p.group.position.set(i * 0.9 - 0.4, 0, -5.4); p.group.rotation.y = 0; run(p, { pose: 'sit' }, 1.5 + i); });
    ctx.setView(V(0.05, 0.5, -5.4), 2.1, 25, 14);
  } else if (v.name === 'pbars'){
    bars.visible = true; bars.position.set(0, 0, 0.3);
    const p = Pr[1]; p.group.visible = true; p.group.position.set(0, 0, 0); p.group.rotation.y = 0; run(p, { pose: 'bars' }, 2);
    ctx.setView(V(0, 1.25, 0.3), 1.9, 25, 4);
  } else if (v.name === 'pcheer'){
    const p = Pr[2]; p.group.visible = true; p.group.position.set(0, 0, 0); p.group.rotation.y = 0; run(p, { pose: 'cheer' }, 1.1);
    ctx.setView(V(0, 1.2, 0), 3.0, 15, 4);
  } else if (v.name === 'pface'){
    const p = Pr[0]; p.group.visible = true; p.group.position.set(0, 0, 0); p.group.rotation.y = 0; run(p, { pose: 'bars' }, 1);
    ctx.setView(V(0, 1.62, 0.05), 0.9, -15, 0);
  } else if (v.name === 'xneck'){
    const p = Pr[1]; p.group.visible = true; p.group.position.set(0, 0, 0); p.group.rotation.y = 0; run(p, { pose: 'bars' }, 0.5);
    console.log('xneck', p.group.visible, p.group.position.toArray(), p.group.children.length);
    ctx.setView(V(0, 1.5, 0), 0.9, 60, 5);
  } else if (v.name === 'xscalp'){
    const p = Pr[1]; p.group.visible = true; p.group.position.set(0, 0, 0); p.group.rotation.y = 0; run(p, { pose: 'bars' }, 0.5);
    p.group.traverse((o) => { if (o.isMesh && !o.isSkinnedMesh){ console.log('hair', o.material.color.getHexString(), o.geometry.attributes.position.count); o.visible = false; } if (o.isSkinnedMesh && o.material.userData.u.uHairCap) console.log('cap', o.material.userData.u.uHairCap.value, o.material.userData.u.uHairCol.value.getHexString()); });
    ctx.setView(V(0, 1.6, 0), 0.8, 40, 30);
  } else if (v.name === 'xsit'){
    const p = Pr[0]; p.group.visible = true; p.group.position.set(0, 0, -5.4); p.group.rotation.y = 0; run(p, { pose: 'sit' }, 1);
    ctx.setView(V(0, 0.5, -5.4), 2.2, 75, 8);
  } else if (v.name === 'xhair' || v.name === 'xzhair'){
    // a row of heads, one per seed, to judge hair and variety
    const zs = v.name === 'xzhair';
    if (!show.extra) show.extra = {};
    const key = v.name;
    if (!show.extra[key]){ show.extra[key] = []; for (let i = 0; i < 5; i++){ const f = zs ? kit.makeZombie(10 + i) : kit.makePrisoner(10 + i); ctx.scene.add(f.group); show.extra[key].push(f); } }
    for (const k in show.extra) for (const f of show.extra[k]) f.group.visible = false;
    show.extra[key].forEach((f, i) => { f.group.visible = true; f.group.position.set((i - 2) * 0.42, 0, 0); f.group.rotation.y = (i - 2) * -0.15; run(f, zs ? { speed: 0 } : { pose: 'bars' }, 0.5); });
    ctx.setView(V(0, 1.6, 0), 1.8, 0, 3);
  } else if (v.name === 'xbody'){
    const z = Z[0]; z.group.visible = true; z.group.position.set(0, 0, 0); z.group.rotation.y = 0; run(z, { speed: 0 }, 0.5);
    ctx.setView(V(0, 1.1, 0), 1.9, 25, 0);
  } else if (v.name === 'pwalk'){
    Pr.forEach((p, i) => { p.group.visible = true; p.group.position.set((i - 1) * 1.1, 0, 0); p.group.rotation.y = 1.2; run(p, { pose: 'walk', speed: [1.2, 2.2, 3.5][i] }, 0.8 + i * 0.3); });
    ctx.setView(V(0, 1.0, 0), 3.8, 20, 4);
  }
}
