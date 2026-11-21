// Paths, plazas, queues, roads and bridges, drawn from the park's path grid.
//
// Each path cell is a slab whose corners follow the ground (12 cm up for footpaths, 5 cm for roads),
// split along the same diagonal as the ground so it never cuts into it. Edges that face grass get
// edging stones (standing 5 cm proud of the path); edges facing a road get a kerb; queue cells get
// posts and rails along their sides (open where the queue ends on a path); cells over water become a
// bridge deck with parapets and piers. Rebuilt per 32 x 32-cell chunk, one mesh per material.
import * as THREE from 'three';
import { N, CELL, HALF, vtx, SURFACES, ROAD, QUEUE } from './park.js';
import { mat } from './materials.js';
import { disposeTree } from './util.js';

const CH = 32;                       // chunk size in cells
const NC = Math.ceil(N / CH);
const FOOT = 0.12, ROADUP = 0.05, EDGE_W = 0.16, EDGE_UP = 0.05, DECK = 0.75;
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];   // N E S W

export class Paths {
  constructor(scene, park){
    this.scene = scene; this.park = park;
    this.group = new THREE.Group(); this.group.name = 'paths';
    scene.add(this.group);
    this.chunks = new Array(NC * NC).fill(null);
    park.pathHeight = (x, z) => this.heightAt(x, z);
    this.rebuild(0, 0, N - 1, N - 1);
  }
  // top of a path cell's corner c (0: i,j  1: i+1,j  2: i,j+1  3: i+1,j+1)
  corner(i, j, c){
    const S = this.park.s, k = j * N + i, road = S.path[k] === ROAD;
    const vi = i + (c & 1), vj = j + (c >> 1);
    let y = S.heights[vtx(vi, vj)] + (road ? ROADUP : FOOT);
    // a bridge: the deck stays above the water at every corner that touches a bridge cell
    for (const [di, dj] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]){
      const ci = vi + di, cj = vj + dj;
      if (ci < 0 || cj < 0 || ci >= N || cj >= N) continue;
      const kk = cj * N + ci;
      if (S.path[kk] && !Number.isNaN(S.water[kk])) y = Math.max(y, S.water[kk] + DECK);
    }
    return y;
  }
  heightAt(x, z){
    const fx = (x + HALF) / CELL, fz = (z + HALF) / CELL, i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= N || j >= N || !this.park.s.path[j * N + i]) return null;
    const u = fx - i, v = fz - j, a = this.corner(i, j, 0), b = this.corner(i, j, 1), c = this.corner(i, j, 2), d = this.corner(i, j, 3);
    return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
  }
  // the park changed: rebuild chunks touching the rectangle (cells), plus one cell round it
  update(r){ if (r) this.rebuild(r[0] - 2, r[1] - 2, r[2] + 2, r[3] + 2); }
  rebuild(i0, j0, i1, j1){
    const c0 = Math.max(0, Math.floor(i0 / CH)), c1 = Math.min(NC - 1, Math.floor(i1 / CH));
    const d0 = Math.max(0, Math.floor(j0 / CH)), d1 = Math.min(NC - 1, Math.floor(j1 / CH));
    for (let cj = d0; cj <= d1; cj++) for (let ci = c0; ci <= c1; ci++) this.buildChunk(ci, cj);
  }
  buildChunk(ci, cj){
    const old = this.chunks[cj * NC + ci];
    if (old) disposeTree(old);
    this.chunks[cj * NC + ci] = null;
    const S = this.park.s, B = new Builder();
    for (let j = cj * CH; j < Math.min(N, (cj + 1) * CH); j++) for (let i = ci * CH; i < Math.min(N, (ci + 1) * CH); i++){
      const k = j * N + i, s = S.path[k];
      if (s) this.cell(B, i, j, s);
    }
    const g = B.build();
    if (!g) return;
    g.name = 'paths-' + ci + '-' + cj;
    this.chunks[cj * NC + ci] = g;
    this.group.add(g);
  }
  cell(B, i, j, s){
    const S = this.park.s, k = j * N + i, road = s === ROAD, queue = S.pflags[k] & QUEUE, bridge = !Number.isNaN(S.water[k]);
    const x0 = -HALF + i * CELL, z0 = -HALF + j * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
    const y = [this.corner(i, j, 0), this.corner(i, j, 1), this.corner(i, j, 2), this.corner(i, j, 3)];
    const key = SURFACES[s] ? (s === ROAD ? 'tarmac' : SURFACES[s].key) : 'pavers';
    B.quad(key, [x0, y[0], z0], [x1, y[1], z0], [x0, y[2], z1], [x1, y[3], z1]);
    // the four edges: corners (in order along the edge) and outward direction
    const ec = [[0, 1], [1, 3], [3, 2], [2, 0]];
    const pts = [[x0, z0], [x1, z0], [x0, z1], [x1, z1]];
    const qn = queue ? DIRS.filter(([di, dj]) => { const ii = i + di, jj = j + dj; return ii >= 0 && jj >= 0 && ii < N && jj < N && S.path[jj * N + ii] && (S.pflags[jj * N + ii] & QUEUE); }).length : 0;
    for (let e = 0; e < 4; e++){
      const [di, dj] = DIRS[e], ii = i + di, jj = j + dj;
      const nk = ii >= 0 && jj >= 0 && ii < N && jj < N ? jj * N + ii : -1;
      const ns = nk >= 0 ? S.path[nk] : 0;
      const [a, b] = ec[e], pa = pts[a], pb = pts[b];
      const ground = (p) => S.heights[vtx(i + (p === 1 || p === 3 ? 1 : 0), j + (p >= 2 ? 1 : 0))];
      if (!ns){
        if (bridge){ B.wall('ashlarP', pa, pb, y[a], y[b], 0.95, 0.28, e, y[a] - 0.45); continue; }
        // the side of the slab down into the ground, and edging (footpaths) along it
        B.skirt(road ? 'kerb' : 'kerb', pa, pb, y[a], y[b], Math.min(ground(a), ground(b)) - 0.15, e);
        if (!road) B.edging(s === 6 ? 'darkwood' : 'kerb', pa, pb, y[a] + EDGE_UP, y[b] + EDGE_UP, e);
      } else if (road !== (ns === ROAD)){
        if (!road) B.edging('kerb', pa, pb, y[a] + 0.02, y[b] + 0.02, e, 0.22, ROADUP - FOOT - 0.02);
      }
      // queue rails: along every side that isn't more queue, except the open end(s) onto a path
      if (queue){
        const nq = nk >= 0 && ns && (S.pflags[nk] & QUEUE);
        const open = ns && !nq && qn <= 1;
        if (!nq && !open) B.rail(pa, pb, y[a], y[b], e);
      }
    }
    if (bridge){
      const lv = S.water[k];
      B.quad('ashlarP', [x0, y[2] - 0.45, z1], [x1, y[3] - 0.45, z1], [x0, y[0] - 0.45, z0], [x1, y[1] - 0.45, z0]);
      // a pier under every other cell
      if ((i + j) % 2 === 0){
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, top = (y[0] + y[3]) / 2 - 0.45, bot = Math.min(lv - 2, S.heights[vtx(i, j)] - 0.3);
        B.box('ashlarP', cx, (top + bot) / 2, cz, 0.7, top - bot, 0.7);
      }
    }
  }
}

// Collects quads into per-material arrays and builds one mesh per material.
class Builder {
  constructor(){ this.m = new Map(); }
  arr(key){ let a = this.m.get(key); if (!a){ a = { p: [], n: [], i: [] }; this.m.set(key, a); } return a; }
  // a quad from four corners (a b on the near edge, c d on the far one, in the same order as the ground)
  quad(key, a, b, c, d){
    const A = this.arr(key), v = A.p.length / 3;
    A.p.push(...a, ...b, ...c, ...d);
    const n1 = faceNormal(a, c, b), n2 = faceNormal(b, c, d), nn = [(n1[0] + n2[0]) / 2, (n1[1] + n2[1]) / 2, (n1[2] + n2[2]) / 2];
    for (const n of [n1, nn, nn, n2]) A.n.push(...n);
    A.i.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
  }
  // a flat four-cornered face given corners in order round it (p0 p1 p2 p3), facing its winding's normal
  face(key, p0, p1, p2, p3){
    const A = this.arr(key), v = A.p.length / 3, n = faceNormal(p0, p1, p2);
    A.p.push(...p0, ...p1, ...p2, ...p3);
    for (let k = 0; k < 4; k++) A.n.push(...n);
    A.i.push(v, v + 1, v + 2, v, v + 2, v + 3);
  }
  // e: edge number (N E S W); the outward direction
  static out(e){ return DIRS[e]; }
  skirt(key, pa, pb, ya, yb, bottom, e){
    const [ox, oz] = DIRS[e];
    // vertical face along the edge, facing out
    const f = [[pa[0], ya, pa[1]], [pb[0], yb, pb[1]], [pb[0], bottom, pb[1]], [pa[0], bottom, pa[1]]];
    this.faceOut(key, f, ox, oz);
  }
  faceOut(key, f, ox, oz){
    const n = faceNormal(f[0], f[1], f[2]);
    if (n[0] * ox + n[2] * oz < 0) this.face(key, f[3], f[2], f[1], f[0]); else this.face(key, ...f);
  }
  // a strip of edging along the edge, w wide, top at ya/yb (+ dy for the outer face's bottom)
  edging(key, pa, pb, ya, yb, e, w = EDGE_W, drop = -0.25){
    const [ox, oz] = DIRS[e];
    const ia = [pa[0] - ox * w, pa[1] - oz * w], ib = [pb[0] - ox * w, pb[1] - oz * w];
    // top
    const t = [[ia[0], ya, ia[1]], [ib[0], yb, ib[1]], [pb[0], yb, pb[1]], [pa[0], ya, pa[1]]];
    const n = faceNormal(t[0], t[1], t[2]); if (n[1] < 0) this.face(key, t[3], t[2], t[1], t[0]); else this.face(key, ...t);
    // inner face (towards the path), down to the path
    this.faceOut(key, [[ia[0], ya, ia[1]], [ib[0], yb, ib[1]], [ib[0], yb - EDGE_UP - 0.02, ib[1]], [ia[0], ya - EDGE_UP - 0.02, ia[1]]], -ox, -oz);
    // outer face
    this.faceOut(key, [[pa[0], ya, pa[1]], [pb[0], yb, pb[1]], [pb[0], yb + drop, pb[1]], [pa[0], ya + drop, pa[1]]], ox, oz);
  }
  // a parapet wall along a bridge edge
  wall(key, pa, pb, ya, yb, h, t, e, bottomA){
    const [ox, oz] = DIRS[e];
    const ia = [pa[0] - ox * t, pa[1] - oz * t], ib = [pb[0] - ox * t, pb[1] - oz * t];
    const bA = bottomA, bB = bottomA + (yb - ya);
    this.faceOut(key, [[pa[0], ya + h, pa[1]], [pb[0], yb + h, pb[1]], [pb[0], bB, pb[1]], [pa[0], bA, pa[1]]], ox, oz);
    this.faceOut(key, [[ia[0], ya + h, ia[1]], [ib[0], yb + h, ib[1]], [ib[0], yb, ib[1]], [ia[0], ya, ia[1]]], -ox, -oz);
    const top = [[ia[0], ya + h, ia[1]], [ib[0], yb + h, ib[1]], [pb[0], yb + h, pb[1]], [pa[0], ya + h, pa[1]]];
    const n = faceNormal(top[0], top[1], top[2]); if (n[1] < 0) this.face(key, top[3], top[2], top[1], top[0]); else this.face(key, ...top);
  }
  box(key, x, y, z, w, h, d){
    const hw = w / 2, hh = h / 2, hd = d / 2;
    const P = (a, b, c) => [x + a * hw, y + b * hh, z + c * hd];
    this.face(key, P(-1, 1, -1), P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1));
    this.face(key, P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1));
    this.face(key, P(1, -1, -1), P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1));
    this.face(key, P(1, -1, 1), P(1, -1, -1), P(1, 1, -1), P(1, 1, 1));
    this.face(key, P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1));
  }
  // queue rail: posts at both ends, two rails between (inset 10 cm into the queue)
  rail(pa, pb, ya, yb, e){
    const [ox, oz] = DIRS[e], ins = 0.1;
    const a = [pa[0] - ox * ins, pa[1] - oz * ins], b = [pb[0] - ox * ins, pb[1] - oz * ins];
    for (const [p, y] of [[a, ya], [b, yb]]) this.box('brass', p[0], y + 0.5, p[1], 0.07, 1.0, 0.07);
    for (const h of [0.95, 0.55]){
      const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
      const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2, cy = (ya + yb) / 2 + h;
      // a rail is a thin box along the edge
      const w = Math.abs(dx) > 0.01 ? L : 0.035, d = Math.abs(dz) > 0.01 ? L : 0.035;
      this.box('iron', cx, cy, cz, w, 0.035, d);
    }
  }
  build(){
    if (!this.m.size) return null;
    const g = new THREE.Group();
    for (const [key, A] of this.m){
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(A.p), nor = new Float32Array(A.n), uv = new Float32Array(A.p.length / 3 * 2);
      for (let k = 0; k < A.p.length / 3; k++){
        const nx = Math.abs(nor[k * 3]), ny = Math.abs(nor[k * 3 + 1]), nz = Math.abs(nor[k * 3 + 2]);
        if (ny >= nx && ny >= nz){ uv[k * 2] = pos[k * 3]; uv[k * 2 + 1] = pos[k * 3 + 2]; }
        else if (nx >= nz){ uv[k * 2] = pos[k * 3 + 2]; uv[k * 2 + 1] = pos[k * 3 + 1]; }
        else { uv[k * 2] = pos[k * 3]; uv[k * 2 + 1] = pos[k * 3 + 1]; }
      }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(A.p.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(A.i, 1) : new THREE.Uint16BufferAttribute(A.i, 1));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, key === 'ashlarP' ? mat('ashlar') : mat(key));
      mesh.receiveShadow = true; mesh.castShadow = key === 'ashlarP' || key === 'iron' || key === 'brass';
      g.add(mesh);
    }
    return g;
  }
}
function faceNormal(a, b, c){
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1; return [nx / l, ny / l, nz / l];
}
