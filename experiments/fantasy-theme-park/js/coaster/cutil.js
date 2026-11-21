// The few helpers the coaster code (from Rollercoaster Bros) uses.
import * as THREE from 'three';
export { clamp, smooth, damp, rng } from '../util.js';
export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
// merge geometries (non-indexed) into one
export function merge(list){
  const geos = list.map((g) => (g.index ? g.toNonIndexed() : g));
  const names = ['position', 'normal', 'color'].filter((n) => geos.length && geos.every((g) => g.attributes[n]));
  let count = 0; for (const g of geos) count += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  for (const n of names){
    const size = geos[0].attributes[n].itemSize, arr = new Float32Array(count * size);
    let o = 0; for (const g of geos){ arr.set(g.attributes[n].array, o); o += g.attributes[n].array.length; }
    out.setAttribute(n, new THREE.BufferAttribute(arr, size));
  }
  out.computeBoundingSphere();
  return out;
}
// a copy of a shape, moved / turned / scaled
export function placed(geo, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1){
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.applyMatrix4(new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V(sx, sy, sz)));
  return g;
}
