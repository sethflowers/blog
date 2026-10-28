// Preview of the Undercroft beast (experiments/undercroft/js/models/beast.js) in the model previewer.
//   NODE_PATH=$(npm root -g) node _tools/undercroft/shoot.mjs /_tools/undercroft/previews/beast.js /tmp/beast/shot
// The room's walls are hidden for the wide shots (the beast is taller than the room is wide); the hand torch
// is moved in to where a player would stand, a few metres from the beast.
import { createBeast } from '/experiments/undercroft/js/models/beast.js';

let beast, T;
export default async function (ctx){
  T = ctx.THREE;
  beast = createBeast({ env: ctx.env });
  ctx.scene.add(beast.group);
  let meshes = 0; beast.group.traverse((o) => { if (o.isMesh) meshes++; });
  console.log(`beast: ${beast.triangles} triangles, ${meshes} mesh(es), ${beast.mesh.geometry.groups.length} draw groups, built in ${beast.buildMs} ms, height ${beast.height.toFixed(2)} m`);
  // show the hit spheres in the 'parts' view
  ctx.partsViz = beast.parts.map((p) => {
    const m = new T.Mesh(new T.SphereGeometry(p.radius, 16, 10), new T.MeshBasicMaterial({ color: { body: 0xff4040, neck: 0x40ff40, head: 0x4080ff, wing: 0xffff40, leg: 0xff40ff }[p.kind], wireframe: true }));
    m.visible = false; ctx.scene.add(m); return { p, m };
  });
  show(ctx, views[0]);
}

// run the animation for a while so springs, gait phase and wing beat settle into the pose
function run(state, seconds, dt = 1 / 30){ for (let t = 0; t < seconds; t += dt) beast.update(dt, state); }

export const views = [
  { name: 'front34', state: {}, cam: [0, 3.0, 0.3, 11.5, 35, 8] },
  { name: 'side', state: {}, cam: [0, 3.0, 0, 12, 90, 3] },
  { name: 'back34', state: {}, cam: [0, 3.2, 0, 11, 200, 12], torchAt: [-2, 4.5, -4] },
  { name: 'head', state: { mouth: 1, eyeGlow: 1, aimPitch: -0.15, aimYaw: 0.35 }, cam: [0.3, 5.5, 2.6, 2.6, 40, 2], torchAt: null },
  { name: 'headclosed', state: { aimYaw: 0.25 }, cam: [0.3, 5.6, 2.4, 2.4, 70, 6], torchAt: null },
  { name: 'walk1', state: { speed: 2 }, secs: 1.1, cam: [0, 3.0, 0, 12, 90, 3] },
  { name: 'walk2', state: { speed: 2 }, secs: 0.55, cam: [0, 3.0, 0, 12, 90, 3] },
  { name: 'gallop', state: { speed: 11 }, secs: 0.4, cam: [0, 3.0, 0, 12, 90, 3] },
  { name: 'crouch', state: { crouch: 1 }, cam: [0, 2.6, 0, 11.5, 60, 6] },
  { name: 'airborne', state: { airborne: 1, flap: 0.5, speed: 10 }, cam: [0, 3.2, 0, 12, 80, 4] },
  { name: 'flap', state: { flap: 1 }, secs: 1.3, cam: [0, 3.6, 0, 12.5, 25, 14] },
  { name: 'dead', state: { dead: 1 }, cam: [0, 1, 0.5, 10, 30, 30] },
  { name: 'parts', state: {}, cam: [0, 3.0, 0, 12, 60, 10], parts: true },
];

export function show(ctx, v){
  run({}, 0.5);                                     // back to standing first
  run(v.state, v.secs || 1.5);
  ctx.room.children.forEach((o, i) => { if (i > 0) o.visible = false; });   // floor stays, walls go
  const [x, y, z, d, yaw, pitch] = v.cam;
  ctx.setView(new T.Vector3(x, y, z), d, yaw, pitch);
  // the hand torch: in the player's hand ~4.5 m from the beast, toward the camera
  if (v.torchAt !== null){
    const dir = new T.Vector3().subVectors(ctx.camera.position, new T.Vector3(x, y, z)).setY(0).normalize();
    const p = v.torchAt ? new T.Vector3(...v.torchAt) : new T.Vector3(x, 0, z).addScaledVector(dir, 4.5);
    if (!v.torchAt) p.y = 1.7;
    ctx.torch.position.copy(p);
  }
  ctx.wallTorch.position.set(-4.5, 2.4, 3);
  ctx.partsViz.forEach(({ p, m }) => { m.visible = !!v.parts; p.object.getWorldPosition(m.position); });
}
