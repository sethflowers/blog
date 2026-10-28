let head;
export default async (ctx) => {
  const { THREE, scene } = ctx;
  const buf = await (await fetch('/experiments/undercroft/tex/people_head.bin')).arrayBuffer();
  const [nv, ni] = new Uint32Array(buf, 0, 2); let o = 8;
  const pos = new Float32Array(buf, o, nv * 3); o += nv * 12;
  const nor = new Int8Array(buf, o, nv * 3); o += nv * 3;
  const uv = new Uint16Array(buf.slice(o, o + nv * 4)); o += nv * 4;
  const w = new Uint8Array(buf, o, nv * 4); o += nv * 4;
  const idx = new Uint16Array(buf.slice(o, o + ni * 2));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3, true));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2, true));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  const tl = new THREE.TextureLoader();
  const col = await tl.loadAsync('/_tools/undercroft/previews/tmp/Map-COL.jpg'); col.colorSpace = THREE.SRGBColorSpace;
  const nrm = await tl.loadAsync('/_tools/undercroft/previews/tmp/Infinite-Level_02_Tangent_SmoothUV.jpg');
  head = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: col, normalMap: nrm, roughness: 0.5 }));
  head.position.set(0, 1.6, 0); scene.add(head);
  const wire = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ wireframe: true, color: 0x00ff00 })); wire.position.set(0.35, 1.6, 0); scene.add(wire);
  ctx.torch.intensity = 1.5;
};
export const views = [{ name: 'front', yaw: 0, d: 0.45 }, { name: 'side', yaw: 35, d: 0.45 }, { name: 'wire', yaw: 0, d: 0.45, x: 0.35 }];
export function show(ctx, v){ ctx.setView(new ctx.THREE.Vector3(v.x || 0, 1.7, 0.05), v.d, v.yaw, v.pitch || 0); }
