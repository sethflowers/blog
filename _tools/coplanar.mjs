// Finds flicker ("z-fighting"): faces of two different scenery boxes that lie in the same plane, face
// the same way and overlap. In a headset that shows as shimmering edges and patches of ground.
// The game logs its boxes when the page sets `globalThis.__boxLog = []` before it loads (see
// my-animal-farm's util.js Batch.box and world.js strip). Use it from a test:
//   import { findCoplanar } from '../coplanar.mjs';  const hits = findCoplanar(boxes);
// Only hits that would show are returned: different materials (two copies of the same surface look
// the same either way), not undersides near the ground, not faces pressed against another box.
export function findCoplanar(all, { eps = 0.0015, minArea = 0.0004, sameMaterial = false } = {}){
  const count = {}; for (const b of all) count[b.batch] = (count[b.batch] || 0) + 1;
  // boxes built straight into the world; small batches are parts built in their own local space
  const big = new Set(Object.keys(count).filter((k) => count[k] > 20).map(Number));
  const boxes = all.filter((b) => big.has(b.batch));
  const right = (a) => Math.abs(Math.round(a / (Math.PI / 2)) * (Math.PI / 2) - a) < 1e-4;
  const faces = [];
  for (const [i, b] of boxes.entries()){
    const [rx, ry, rz] = b.r;
    if (!right(ry) || Math.abs(rx) > 1e-4 || Math.abs(rz) > 1e-4) continue;
    let [sx, sy, sz] = b.s; if (Math.abs(Math.sin(ry)) > 0.5) [sx, sz] = [sz, sx];
    const c = b.p, h = [sx / 2, sy / 2, sz / 2];
    for (let ax = 0; ax < 3; ax++) for (const sgn of [-1, 1]){
      if (b.flat && !(ax === 1 && sgn === 1)) continue;
      const o = [0, 1, 2].filter((k) => k !== ax);
      faces.push({ i, ax, sgn, d: c[ax] + sgn * h[ax], r: o.map((k) => [c[k] - h[k], c[k] + h[k]]), b });
    }
  }
  const group = new Map();
  for (const f of faces){ const k = f.ax + ':' + f.sgn; if (!group.has(k)) group.set(k, []); group.get(k).push(f); }
  const against = (f, r) => (group.get(f.ax + ':' + (-f.sgn)) || []).some((g) => g.i !== f.i && g.b.batch === f.b.batch && Math.abs(g.d - f.d) < eps &&
    g.r[0][0] <= r[0][0] + 0.005 && g.r[0][1] >= r[0][1] - 0.005 && g.r[1][0] <= r[1][0] + 0.005 && g.r[1][1] >= r[1][1] - 0.005);
  const hits = [];
  for (const list of group.values()){
    list.sort((a, b) => a.d - b.d);
    for (let a = 0; a < list.length; a++) for (let c = a + 1; c < list.length && list[c].d - list[a].d < eps; c++){
      const A = list[a], C = list[c];
      if (A.i === C.i || A.b.batch !== C.b.batch) continue;
      if (!sameMaterial && A.b.m === C.b.m) continue;
      if (A.ax === 1 && A.sgn < 0 && A.d < 1.2) continue;                 // undersides near the ground
      const r = [[Math.max(A.r[0][0], C.r[0][0]), Math.min(A.r[0][1], C.r[0][1])], [Math.max(A.r[1][0], C.r[1][0]), Math.min(A.r[1][1], C.r[1][1])]];
      const w0 = r[0][1] - r[0][0], w1 = r[1][1] - r[1][0];
      if (w0 <= 0.01 || w1 <= 0.01 || w0 * w1 < minArea) continue;
      if (against(A, r)) continue;                                          // pressed against another box
      hits.push({ axis: 'xyz'[A.ax] + (A.sgn > 0 ? '+' : '-'), at: +A.d.toFixed(3), area: +(w0 * w1).toFixed(3), a: describe(A.b), b: describe(C.b) });
    }
  }
  return hits.sort((x, y) => y.area - x.area);
}
function describe(b){ return `${b.m} at ${b.p.map((v) => v.toFixed(2)).join(',')} (${String(b.at).replace(/.*\/js\//, '').replace(/\?v=[^:]*/, '').replace(/\)$/, '')})`; }

// node _tools/coplanar.mjs boxes.json   (a box log saved by a test)
if (process.argv[1] && process.argv[1].endsWith('coplanar.mjs') && process.argv[2]){
  const fs = await import('node:fs');
  const hits = findCoplanar(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
  console.log(`${hits.length} places where two surfaces would flicker`);
  for (const h of hits.slice(0, 40)) console.log(`  ${h.axis} ${h.at} ${h.area} m²: ${h.a} | ${h.b}`);
}
