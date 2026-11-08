// The safari: jungle clearings, a dirt road that loops all the way round, and the enclosures it runs
// through (each fenced, with a gate where the road goes in and out). The Safari Lodge (station, ticket
// office, garage, car park) sits on the loop too. Thick jungle grows all round the outside and over the hill in the middle.
//
// Layout: the road is a wobbly circle round the origin, r = roadR(θ), with x = r·cos θ, z = r·sin θ.
// φ is the angle along the loop from the start of the Lodge. Each zone is a slice of φ; an enclosure
// reaches from IN metres inside the road to OUT metres outside it, so "lateral" (r − roadR) and φ say
// where anything is. Trucks drive the loop in the direction of increasing φ, on the left (outer) lane.
import * as THREE from 'three';
import { V, clamp, lerp, smooth, fbm, vnoise, hash2, rng, Batch, boxUV, mergeGeometries, ellipsoid, textCanvas, roundRect, wrapText } from './util.js';
import { groundDetail, gravel, thatch, wood, bark, leaves, rockTex, water, canvasCloth } from './textures.js';

export const R0 = 150, IN = 52, OUT = 62, LANE = 1.9, ROAD_W = 7.5;
export const LODGE = THREE.MathUtils.degToRad(30);
export const PHI0 = Math.PI / 2 - LODGE / 2;
const TAU = Math.PI * 2;
export const roadR = (th) => R0 + 14 * Math.sin(2 * th + 0.5) + 7 * Math.sin(3 * th + 1.3);
export const wrapPhi = (p) => ((p % TAU) + TAU) % TAU;

// The zones along the loop, in driving order. Prices are what it costs to open them.
export const ZONES = [
  { id: 'lodge', name: 'Safari Lodge', icon: '🏕', lodge: true },
  { id: 'plains', name: 'River Meadows', icon: '🦓', species: ['zebra', 'wildebeest', 'ostrich'], start: [3, 3, 2], price: 0, biome: 'clearing', pond: { lat: -30, r: 9, at: 0.6 } },
  { id: 'giraffe', name: 'Giraffe Glade', icon: '🦒', species: ['giraffe', 'impala'], start: [3, 4], price: 0, biome: 'glade', pond: { lat: 28, r: 7, at: 0.3 } },
  { id: 'rhino', name: 'Rhino Ridge', icon: '🦏', species: ['rhino', 'warthog'], start: [2, 3], price: 3500, biome: 'rocky', pond: { lat: 26, r: 7, at: 0.65, mud: true } },
  { id: 'elephant', name: 'Elephant Valley', icon: '🐘', species: ['elephant'], start: [3], price: 7000, biome: 'clearing', pond: { lat: 30, r: 13, at: 0.5 } },
  { id: 'hippo', name: 'Hippo Lagoon', icon: '🦛', species: ['hippo', 'crocodile'], start: [3, 2], price: 11000, biome: 'wet', pond: { lat: -27, r: 19, at: 0.5 } },
  { id: 'lion', name: 'Lion Pride', icon: '🦁', species: ['lion'], start: [4], price: 15000, biome: 'clearing', carnivore: true, pond: { lat: -28, r: 6, at: 0.3 } },
  { id: 'cheetah', name: 'Cheetah Clearing', icon: '🐆', species: ['cheetah'], start: [3], price: 20000, biome: 'plain', carnivore: true, pond: { lat: 30, r: 5, at: 0.7 } },
  { id: 'tiger', name: 'Tiger Jungle', icon: '🐅', species: ['tiger'], start: [3], price: 27000, biome: 'forest', carnivore: true, pond: { lat: 24, r: 8, at: 0.5 } },
  { id: 'bear', name: 'Bear Woods', icon: '🐻', species: ['bear'], start: [3], price: 35000, biome: 'pine', carnivore: true, pond: { lat: -24, r: 8, at: 0.55 } },
];
const E = (TAU - LODGE) / (ZONES.length - 1);
ZONES.forEach((z, k) => { z.k = k; z.phi0 = k === 0 ? 0 : LODGE + (k - 1) * E; z.phi1 = k === 0 ? LODGE : LODGE + k * E; });
export const zoneOfPhi = (phi) => { phi = wrapPhi(phi); if (phi < LODGE) return 0; return Math.min(ZONES.length - 1, 1 + Math.floor((phi - LODGE) / E)); };

const GRID = 2, HALF = 400, N = HALF * 2 / GRID + 1;   // the height grid (2 m cells, ±400 m)

export class World {
  constructor(scene){
    this.scene = scene;
    this.root = new THREE.Group(); scene.add(this.root);
    this.colliders = new Map();     // 10 m buckets of circles {x, z, r} and segments {ax, az, bx, bz}
    this.buildRoad();
    this.ponds = ZONES.filter((z) => z.pond).map((z) => {
      const phi = lerp(z.phi0, z.phi1, z.pond.at), p = this.at(phi, z.pond.lat);
      return { x: p.x, z: p.z, r: z.pond.r, zone: z.k, mud: !!z.pond.mud, level: 0 };
    });
    for (const p of this.ponds) p.level = this.rawHeight(p.x, p.z, true) - 0.35;
    this.buildHeights();
    this.buildTerrain();
    this.buildRoadMesh();
    this.buildWater();
    this.buildFences();
    this.buildGates();
    this.buildLodge();
    this.buildPlants();
    this.buildCanopy();
    this.buildFeeders();
    this.buildSigns();
  }

  // ---------- the road ----------
  buildRoad(){
    const n = 1440, pts = [], s = new Float32Array(n + 1);
    for (let i = 0; i <= n; i++){
      const phi = (i / n) * TAU, th = phi + PHI0, r = roadR(th);
      pts.push(V(r * Math.cos(th), 0, r * Math.sin(th)));
      if (i) s[i] = s[i - 1] + pts[i].distanceTo(pts[i - 1]);
    }
    this.roadPts = pts; this.roadS = s; this.L = s[n]; this.roadN = n;
  }
  // φ ↔ s (metres along the road from the start of the Lodge)
  sOfPhi(phi){ const f = wrapPhi(phi) / TAU * this.roadN, i = Math.floor(f); return lerp(this.roadS[i], this.roadS[i + 1], f - i); }
  phiOfS(s){
    s = ((s % this.L) + this.L) % this.L;
    let lo = 0, hi = this.roadN;
    while (hi - lo > 1){ const m = (lo + hi) >> 1; if (this.roadS[m] <= s) lo = m; else hi = m; }
    const t = (s - this.roadS[lo]) / (this.roadS[lo + 1] - this.roadS[lo]);
    return ((lo + t) / this.roadN) * TAU;
  }
  // a point at angle φ and `lat` metres outside the road (negative = inside), on the ground
  at(phi, lat = 0, out = V()){
    const th = phi + PHI0, r = roadR(th) + lat;
    out.set(r * Math.cos(th), 0, r * Math.sin(th));
    if (this.grid) out.y = this.height(out.x, out.z);
    return out;
  }
  // position, direction and outward side of the road at s (lat moves it sideways)
  road(s, lat = 0){
    const phi = this.phiOfS(s), th = phi + PHI0, r = roadR(th);
    const dr = 28 * Math.cos(2 * th + 0.5) + 21 * Math.cos(3 * th + 1.3);
    const t = V(dr * Math.cos(th) - r * Math.sin(th), 0, dr * Math.sin(th) + r * Math.cos(th)).normalize();
    const n = V(t.z, 0, -t.x);
    const p = V(r * Math.cos(th), 0, r * Math.sin(th)).addScaledVector(n, lat);
    p.y = this.grid ? this.height(p.x, p.z) : 0;
    return { p, t, n, phi };
  }
  // where a world point is: φ, lateral distance from the road, and the zone
  polar(x, z){
    const th = Math.atan2(z, x), phi = wrapPhi(th - PHI0), lat = Math.hypot(x, z) - roadR(th);
    return { phi, lat, zone: zoneOfPhi(phi) };
  }
  // the enclosure a point is in (or -1 when it's outside the fences, or in the Lodge)
  enclosureAt(x, z){
    const p = this.polar(x, z);
    if (p.zone === 0 || p.lat < -IN || p.lat > OUT) return -1;
    return p.zone;
  }

  // ---------- heights ----------
  rawHeight(x, z, noPond){
    const r = Math.hypot(x, z);
    let h = fbm(x / 110 + 7, z / 110 - 3, 4, 3) * 9 - 4.5 + fbm(x / 28, z / 28, 2, 9) * 1.4;
    h += 13 * Math.exp(-((r / 48) ** 2));                                         // the kopje
    h += smooth((r - 300) / 320) * (18 + fbm(x / 160, z / 160, 3, 5) * 70);       // hills on the horizon
    if (!noPond && this.ponds) for (const p of this.ponds){
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < p.r * 1.8) h = Math.min(h, p.level + (d / p.r - 1) * 2.2 + (d > p.r ? (d - p.r) * 0.05 : 0));
    }
    return h;
  }
  buildHeights(){
    // the road's own height: the land along it, smoothed so it never lurches
    const n = this.roadN; let rh = new Float32Array(n);
    for (let i = 0; i < n; i++) rh[i] = this.rawHeight(this.roadPts[i].x, this.roadPts[i].z, true);
    for (let pass = 0; pass < 4; pass++){
      const o = new Float32Array(n);
      for (let i = 0; i < n; i++){ let a = 0; for (let k = -24; k <= 24; k++) a += rh[(i + k + n) % n]; o[i] = a / 49; }
      rh = o;
    }
    // the Lodge sits on a flat terrace
    const lodgeH = rh[Math.round(n * (LODGE / 2) / TAU)];
    this.lodgeH = lodgeH;
    for (let i = 0; i < n; i++){ const phi = (i / n) * TAU, w = smooth(1 - Math.abs(wrapPhi(phi - LODGE / 2 + Math.PI) - Math.PI) / (LODGE * 0.9)); rh[i] = lerp(rh[i], lodgeH, w); }
    this.roadH = rh;
    const g = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++){
      const x = -HALF + i * GRID, z = -HALF + j * GRID;
      g[j * N + i] = this.flattened(x, z);
    }
    this.grid = g;
  }
  roadHeightAt(phi){ const f = wrapPhi(phi) / TAU * this.roadN, i = Math.floor(f) % this.roadN; return lerp(this.roadH[i], this.roadH[(i + 1) % this.roadN], f - Math.floor(f)); }
  flattened(x, z){
    const raw = this.rawHeight(x, z), { phi, lat } = this.polar(x, z);
    const rh = this.roadHeightAt(phi);
    let h = lerp(rh, raw, smooth((Math.abs(lat) - 5) / 9));
    // the Lodge terrace: flat from the road out to the car park
    const dphi = Math.abs(wrapPhi(phi - LODGE / 2 + Math.PI) - Math.PI);
    const w = smooth((LODGE * 0.62 - dphi) / (LODGE * 0.25)) * smooth((lat + 10) / 6) * smooth((96 - lat) / 14);
    h = lerp(h, this.lodgeH, w);
    // the entrance drive out to the horizon
    return h;
  }
  height(x, z){
    const fx = (x + HALF) / GRID, fz = (z + HALF) / GRID;
    if (fx < 0 || fz < 0 || fx >= N - 1 || fz >= N - 1) return this.rawHeight(x, z);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, g = this.grid;
    const a = g[j * N + i], b = g[j * N + i + 1], c = g[(j + 1) * N + i], d = g[(j + 1) * N + i + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  normal(x, z, out = V()){
    const e = 1.5;
    return out.set(this.height(x - e, z) - this.height(x + e, z), 2 * e, this.height(x, z - e) - this.height(x, z + e)).normalize();
  }
  inWater(x, z){ for (const p of this.ponds){ const d = Math.hypot(x - p.x, z - p.z); if (d < p.r) return p; } return null; }
  nearWater(x, z, m = 3){ for (const p of this.ponds){ if (Math.hypot(x - p.x, z - p.z) < p.r + m) return p; } return null; }

  // ---------- the ground ----------
  groundColour(x, z, h){
    const { phi, lat, zone } = this.polar(x, z);
    const Z = ZONES[zone], inside = lat > -IN && lat < OUT;
    const n = fbm(x / 40, z / 40, 3, 21), m = fbm(x / 9, z / 9, 2, 22);
    // lush jungle green, with darker damp patches and lighter sunny ones
    let c = [lerp(0.3, 0.42, n), lerp(0.44, 0.52, n), lerp(0.16, 0.2, n)];
    if (m > 0.6) c = [c[0] * 0.82, c[1] * 0.86, c[2] * 0.8];
    if (m < 0.32) c = [c[0] * 1.08, c[1] * 1.04, c[2] * 0.95];
    if (!inside || Z.lodge){ c = [c[0] * 0.8, c[1] * 0.84, c[2] * 0.82]; }       // the jungle floor, under the trees
    if (inside && (Z.biome === 'forest' || Z.biome === 'pine')){ c = [lerp(0.26, 0.34, n), lerp(0.32, 0.38, n), lerp(0.14, 0.17, n)]; }
    if (inside && Z.biome === 'wet'){ c = [lerp(0.3, 0.38, n), lerp(0.46, 0.5, n), lerp(0.2, 0.22, n)]; }
    if (inside && (Z.biome === 'rocky' || Z.biome === 'plain')){ c = [c[0] * 1.1, c[1] * 1.02, c[2] * 0.95]; }
    // near water: lush, then mud at the edge
    for (const p of this.ponds){
      const d = Math.hypot(x - p.x, z - p.z) - p.r;
      if (d < 10){ const k = smooth(1 - d / 10); c = [lerp(c[0], 0.24, k), lerp(c[1], 0.42, k), lerp(c[2], 0.16, k)]; }
      if (d < 2.5){ const k = smooth(1 - (d + 0.5) / 3); c = [lerp(c[0], 0.42, k), lerp(c[1], 0.34, k), lerp(c[2], 0.24, k)]; }
    }
    // red-brown earth along the road's verges and under the Lodge
    const al = Math.abs(lat);
    if (al < 9){ const k = smooth((9 - al) / 4) * 0.85; c = [lerp(c[0], 0.6, k), lerp(c[1], 0.36, k), lerp(c[2], 0.22, k)]; }
    const dphi = Math.abs(wrapPhi(phi - LODGE / 2 + Math.PI) - Math.PI);
    if (dphi < LODGE * 0.5 && lat > 4 && lat < 95){ c = [lerp(c[0], 0.4, 0.4), lerp(c[1], 0.56, 0.4), lerp(c[2], 0.22, 0.4)]; }
    // rock showing through on steep bits and on the kopje
    const r = Math.hypot(x, z);
    if (r < 40 && h > 8){ const k = smooth((h - 8) / 5) * smooth(m * 2 - 0.3); c = [lerp(c[0], 0.42, k), lerp(c[1], 0.44, k), lerp(c[2], 0.34, k)]; }
    return c;
  }
  buildTerrain(){
    const seg = 200, size = HALF * 2;
    const g = new THREE.PlaneGeometry(size, size, seg, seg); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position, col = new Float32Array(p.count * 3), uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++){
      const x = p.getX(i), z = p.getZ(i), h = this.height(x, z);
      p.setY(i, h);
      const c = this.groundColour(x, z, h);
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
      uv.setXY(i, x / 6, z / 6);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ map: groundDetail(), vertexColors: true, roughness: 0.95 });
    const t = new THREE.Mesh(g, m); t.receiveShadow = true; t.matrixAutoUpdate = false; this.root.add(t);
    this.terrain = t;
    // beyond the grid: rings of hills out to the haze
    const rings = 14, segs = 96, pos = [], cols = [], idx = [];
    const radii = [Math.SQRT2 * HALF * 0.71]; for (let k = 1; k <= rings; k++) radii.push(HALF * 0.995 + (k / rings) ** 1.6 * 1700);
    radii[0] = HALF - 2;
    for (let k = 0; k <= rings; k++) for (let i = 0; i <= segs; i++){
      const a = (i / segs) * TAU, r = radii[k];
      // the first ring follows the square edge of the grid
      let x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (k === 0){ const s = HALF / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a))); x = Math.cos(a) * s; z = Math.sin(a) * s; }
      const h = this.height(x, z) - (k === 0 ? 0.05 : 0);
      pos.push(x, h, z);
      const c = this.groundColour(x, z, h), f = smooth(k / rings);
      const fn = 0.8 + vnoise(x / 60, z / 60, 4) * 0.35; cols.push(lerp(c[0], 0.2 * fn, f), lerp(c[1], 0.32 * fn, f), lerp(c[2], 0.14 * fn, f));
    }
    const R = segs + 1;
    for (let k = 0; k < rings; k++) for (let i = 0; i < segs; i++){ const a = k * R + i, b = a + 1, c = a + R, d = c + 1; idx.push(a, c, b, b, c, d); }
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    hg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    hg.setIndex(idx); hg.computeVertexNormals();
    const hills = new THREE.Mesh(hg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    hills.matrixAutoUpdate = false; hills.receiveShadow = false; this.root.add(hills);
  }
  buildRoadMesh(){
    const pos = [], uv = [], idx = [], n = this.roadN, step = 2;
    let row = 0;
    for (let i = 0; i <= n; i += step){
      const s = this.roadS[Math.min(i, n)], R = this.road(s);
      for (const [k, side] of [[0, -1], [1, 1]]){
        const p = R.p.clone().addScaledVector(R.n, side * ROAD_W / 2);
        p.y = this.height(p.x, p.z) + 0.06;
        pos.push(p.x, p.y, p.z); uv.push(k, s / ROAD_W);
      }
      if (row){ const a = (row - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      row++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ map: gravel(), roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; this.root.add(mesh);
  }
  buildWater(){
    const wm = new THREE.MeshStandardMaterial({ color: 0x8aa890, map: water(), roughness: 0.12, metalness: 0.0, transparent: true, opacity: 0.85, envMapIntensity: 1 });
    const mm = new THREE.MeshStandardMaterial({ color: 0x6a5038, roughness: 0.35, metalness: 0 });
    this.waterMeshes = [];
    for (const p of this.ponds){
      const g = new THREE.CircleGeometry(p.r * 1.12, 40); g.rotateX(-Math.PI / 2);
      const pa = g.attributes.position;
      for (let i = 1; i < pa.count; i++){ const a = Math.atan2(pa.getZ(i), pa.getX(i)); const k = 1 + (vnoise(Math.cos(a) * 2 + 5, Math.sin(a) * 2, 3) - 0.5) * 0.18; pa.setX(i, pa.getX(i) * k); pa.setZ(i, pa.getZ(i) * k); }
      const m = new THREE.Mesh(g, p.mud ? mm : wm);
      m.position.set(p.x, p.level, p.z); m.receiveShadow = true;
      this.root.add(m); this.waterMeshes.push(m);
    }
  }

  // ---------- colliders (for driving your jeep) ----------
  bucket(x, z){ const k = (Math.floor(x / 10) + 500) * 1000 + Math.floor(z / 10) + 500; if (!this.colliders.has(k)) this.colliders.set(k, []); return this.colliders.get(k); }
  addCircle(x, z, r){ const c = { x, z, r }; for (let i = Math.floor((x - r) / 10); i <= Math.floor((x + r) / 10); i++) for (let j = Math.floor((z - r) / 10); j <= Math.floor((z + r) / 10); j++) this.bucket(i * 10 + 1, j * 10 + 1).push(c); }
  addSegment(ax, az, bx, bz){
    const s = { ax, az, bx, bz }, n = Math.ceil(Math.hypot(bx - ax, bz - az) / 4) + 1, seen = new Set();
    for (let k = 0; k <= n; k++){ const x = lerp(ax, bx, k / n), z = lerp(az, bz, k / n); const b = this.bucket(x, z); if (!seen.has(b)){ seen.add(b); b.push(s); } }
  }
  // push a circle (a vehicle) out of anything solid; returns true if it hit something
  collide(p, r){
    let hit = false;
    const seen = new Set();
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++){
      const k = (Math.floor(p.x / 10) + i + 500) * 1000 + Math.floor(p.z / 10) + j + 500, list = this.colliders.get(k);
      if (!list) continue;
      for (const c of list){
        if (seen.has(c)) continue; seen.add(c);
        let cx, cz, cr;
        if (c.r != null){ cx = c.x; cz = c.z; cr = c.r; }
        else { const dx = c.bx - c.ax, dz = c.bz - c.az, t = clamp(((p.x - c.ax) * dx + (p.z - c.az) * dz) / (dx * dx + dz * dz)); cx = c.ax + dx * t; cz = c.az + dz * t; cr = 0.15; }
        const dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz), m = r + cr;
        if (d < m && d > 1e-4){ p.x = cx + dx / d * m; p.z = cz + dz / d * m; hit = true; }
      }
    }
    return hit;
  }

  // ---------- fences ----------
  buildFences(){
    // a list of fence runs (polylines), each with a height
    const runs = [];
    const arc = (phi0, phi1, lat, h) => { const pts = [], n = Math.max(2, Math.ceil(Math.abs(phi1 - phi0) * (R0 + lat) / 4)); for (let i = 0; i <= n; i++) pts.push(this.at(lerp(phi0, phi1, i / n), lat, V())); runs.push({ pts, h }); };
    const radial = (phi, lat0, lat1, h) => { const pts = [], n = Math.max(2, Math.ceil(Math.abs(lat1 - lat0) / 4)); for (let i = 0; i <= n; i++) pts.push(this.at(phi, lerp(lat0, lat1, i / n), V())); runs.push({ pts, h }); };
    for (const Z of ZONES){
      if (Z.lodge) continue;
      const h = Z.carnivore ? 3.4 : 2.1;
      arc(Z.phi0, Z.phi1, -IN, h);
      arc(Z.phi0, Z.phi1, OUT, h);
    }
    // between zones: from the inner fence to the road, and from the road to the outer fence (the gap is the gate)
    for (let k = 0; k < ZONES.length; k++){
      const phi = ZONES[k].phi0, prev = ZONES[(k + ZONES.length - 1) % ZONES.length], Z = ZONES[k];
      const h = (Z.carnivore || prev.carnivore) ? 3.4 : 2.1;
      radial(phi, -IN, -ROAD_W / 2 - 1.2, h); radial(phi, ROAD_W / 2 + 1.2, OUT, h);
    }
    this.fenceRuns = runs;
    // posts and wires, all instanced
    const posts = [], wires = [];
    for (const run of runs){
      for (let i = 0; i < run.pts.length; i++){
        const p = run.pts[i]; posts.push({ p, h: run.h });
        if (i){
          const a = run.pts[i - 1];
          const strands = run.h > 3 ? 8 : 4;
          for (let s = 0; s < strands; s++){ const y = 0.3 + (run.h - 0.4) * (s / (strands - 1)); wires.push({ a, b: p, y }); }
          this.addSegment(a.x, a.z, p.x, p.z);
        }
      }
    }
    const postG = new THREE.CylinderGeometry(0.07, 0.09, 1, 6); postG.translate(0, 0.5, 0);
    const pm = new THREE.InstancedMesh(postG, new THREE.MeshStandardMaterial({ map: wood(), roughness: 0.9 }), posts.length);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = V(), P = V();
    posts.forEach((o, i) => { M.compose(P.set(o.p.x, o.p.y - 0.2, o.p.z), Q.identity(), S.set(1, o.h + 0.4, 1)); pm.setMatrixAt(i, M); });
    pm.castShadow = true; pm.receiveShadow = true; this.root.add(pm);
    const wireG = new THREE.BoxGeometry(1, 0.025, 0.025); wireG.translate(0.5, 0, 0);
    const wmesh = new THREE.InstancedMesh(wireG, new THREE.MeshStandardMaterial({ color: 0x9a9a92, metalness: 0.6, roughness: 0.5 }), wires.length);
    const dir = V(), X = V(1, 0, 0);
    wires.forEach((w, i) => {
      dir.subVectors(w.b, w.a); const len = dir.length(); dir.normalize();
      Q.setFromUnitVectors(X, dir);
      M.compose(P.set(w.a.x, w.a.y + w.y, w.a.z), Q, S.set(len, 1, 1)); wmesh.setMatrixAt(i, M);
    });
    this.root.add(wmesh);
  }

  // ---------- gates where the road crosses a fence ----------
  buildGates(){
    this.gates = [];
    const postM = new THREE.MeshStandardMaterial({ map: wood(), roughness: 0.85, color: 0x9a7a5a });
    const gateM = new THREE.MeshStandardMaterial({ color: 0x5a5a52, metalness: 0.5, roughness: 0.55 });
    for (let k = 0; k < ZONES.length; k++){
      const Z = ZONES[k], prev = ZONES[(k + ZONES.length - 1) % ZONES.length];
      const s = this.sOfPhi(Z.phi0), R = this.road(s), yaw = Math.atan2(R.t.x, R.t.z);
      const g = new THREE.Group(); g.position.copy(R.p); g.rotation.y = yaw; this.root.add(g);
      const half = ROAD_W / 2 + 1.0, tall = 5.2;
      const b = new Batch();
      for (const sx of [-1, 1]) b.cyl(0.28, 0.24, tall + 0.6, postM, sx * half, (tall + 0.6) / 2 - 0.3, 0, 8);
      b.box(half * 2 + 1.4, 0.45, 0.45, postM, 0, tall, 0);
      b.build(g);
      // the name boards on the arch: the zone you're driving into, and (on the back) the one behind you
      for (const [side, name, icon] of [[1, Z.name, Z.icon], [-1, prev.name, prev.icon]]){
        const tc = textCanvas(512, 112), c = tc.ctx;
        c.fillStyle = '#4a3020'; roundRect(c, 0, 0, 512, 112, 16); c.fill();
        c.strokeStyle = '#e8c070'; c.lineWidth = 6; roundRect(c, 5, 5, 502, 102, 12); c.stroke();
        c.fillStyle = '#ffe8b0'; c.font = 'bold 50px Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(side > 0 ? `${icon} ${name}` : `${icon} ${name}`, 256, 60);
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 1.36), new THREE.MeshStandardMaterial({ map: tc.tex, roughness: 0.8 }));
        sign.position.set(0, tall + 0.95, side * -0.24); if (side < 0) sign.rotation.y = 0; else sign.rotation.y = Math.PI;
        // the front of the sign faces traffic coming towards it (from behind, -t)
        sign.rotation.y = side > 0 ? Math.PI : 0;
        g.add(sign);
      }
      const boardB = new Batch(); boardB.box(6.4, 1.5, 0.3, postM, 0, tall + 0.95, 0); boardB.build(g);
      // two gate leaves that swing open as a vehicle comes near
      const leaves = [-1, 1].map((sx) => {
        const piv = new THREE.Group(); piv.position.set(sx * half, 0, 0); g.add(piv);
        const lb = new Batch(), w = half - 0.1, gh = Z.carnivore || prev.carnivore ? 2.8 : 1.6;
        lb.box(w, 0.1, 0.1, gateM, -sx * w / 2, 0.35, 0); lb.box(w, 0.1, 0.1, gateM, -sx * w / 2, gh, 0); lb.box(0.12, gh, 0.12, gateM, -sx * w, gh / 2 + 0.15, 0);
        for (let i = 1; i < 8; i++) lb.box(0.05, gh - 0.3, 0.05, gateM, -sx * w * i / 8, gh / 2 + 0.2, 0);
        lb.box(Math.hypot(w, gh - 0.4), 0.08, 0.08, gateM, -sx * w / 2, gh / 2 + 0.2, 0, 0, 1, 0, sx * Math.atan2(gh - 0.4, w));
        lb.build(piv);
        return { piv, sx };
      });
      // a cattle grid across the road
      const grid = new THREE.Mesh(boxUV(ROAD_W, 0.06, 1.8), new THREE.MeshStandardMaterial({ color: 0x6a6a64, metalness: 0.6, roughness: 0.5 }));
      grid.position.y = 0.06; g.add(grid);
      this.addCircle(R.p.x + R.n.x * half, R.p.z + R.n.z * half, 0.4); this.addCircle(R.p.x - R.n.x * half, R.p.z - R.n.z * half, 0.4);
      this.gates.push({ s, pos: R.p.clone(), leaves, open: 0, k });
    }
  }
  // open the gates for anything driving close by (points: an array of vehicle positions)
  updateGates(dt, points){
    for (const G of this.gates){
      let want = 0;
      for (const p of points){ if (p && Math.abs(p.x - G.pos.x) < 26 && Math.abs(p.z - G.pos.z) < 26 && p.distanceToSquared(G.pos) < 24 * 24){ want = 1; break; } }
      G.open = clamp(G.open + (want ? dt : -dt) * 0.7);
      const a = smooth(G.open) * Math.PI * 0.5;
      for (const L of G.leaves) L.piv.rotation.y = L.sx * -a * (L.sx > 0 ? 1 : 1);
    }
  }

  // ---------- the Lodge ----------
  // a point by the Lodge: `along` metres along the road from the station, `lat` metres out from it
  lodgePoint(along, lat){ const R = this.road(this.stationS + along, lat); return R; }
  buildLodge(){
    this.stationS = this.sOfPhi(LODGE * 0.55);
    this.depotS = this.stationS - 24;
    const thatchM = new THREE.MeshStandardMaterial({ map: thatch(), roughness: 1, color: 0xd8c8a0 });
    const woodM = new THREE.MeshStandardMaterial({ map: wood(), roughness: 0.85 });
    const plaster = new THREE.MeshStandardMaterial({ color: 0xe8dcc4, roughness: 0.95, map: groundDetail() });
    const stone = new THREE.MeshStandardMaterial({ map: rockTex(), roughness: 0.95 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x8a8e88, metalness: 0.5, roughness: 0.5 });
    const green = new THREE.MeshStandardMaterial({ color: 0x3a5a3a, roughness: 0.8 });
    const b = new Batch();
    const place = (along, lat, fn) => { const R = this.lodgePoint(along, lat); fn(R.p, Math.atan2(R.t.x, R.t.z), R); };
    // the station platform: a raised wooden deck under a long thatched roof, curved along the road
    for (let a = -16; a < 16; a += 4){
      place(a + 2, 6.6, (p, yaw) => {
        b.box(3.4, 0.9, 4.05, woodM, p.x, this.lodgeH + 0.45, p.z, yaw, 0.5);
        if ((a + 16) % 8 === 0) for (const lx of [-1.4, 1.4]){ const q = this.lodgePoint(a + 2, 6.6 + lx).p; b.cyl(0.12, 0.12, 3.4, woodM, q.x, this.lodgeH + 2.5, q.z, 6); }
        // the roof
        const r1 = this.lodgePoint(a + 2, 5.6).p, r2 = this.lodgePoint(a + 2, 7.8).p;
        b.box(2.8, 0.25, 4.1, thatchM, r1.x, this.lodgeH + 4.25, r1.z, yaw, 0.4, 0, 0.42);
        b.box(2.8, 0.25, 4.1, thatchM, r2.x, this.lodgeH + 4.25, r2.z, yaw, 0.4, 0, -0.42);
        this.addCircle(p.x, p.z, 1.7);
      });
    }
    // steps up to the platform at the back
    place(0, 9.0, (p, yaw) => { b.box(1.2, 0.45, 3, woodM, p.x, this.lodgeH + 0.22, p.z, yaw); });
    // rondavels: round huts with conical thatched roofs (the ticket office, the café, the shop)
    const rondavel = (along, lat, r, h) => place(along, lat, (p) => {
      b.cyl(r, r, h, plaster, p.x, this.lodgeH + h / 2, p.z, 20);
      b.add(new THREE.ConeGeometry(r * 1.35, r * 1.25, 22), thatchM, new THREE.Matrix4().makeTranslation(p.x, this.lodgeH + h + r * 0.6, p.z));
      b.cyl(r * 1.02, r * 1.02, 0.35, stone, p.x, this.lodgeH + 0.17, p.z, 20);
      this.addCircle(p.x, p.z, r + 0.3);
    });
    rondavel(12, 24, 6, 4);     // the main lodge
    rondavel(-10, 30, 3.5, 3.2);
    rondavel(26, 20, 3.2, 3);
    rondavel(24, 34, 3, 3);
    // a covered walkway from the car park to the platform
    for (let lat = 11; lat < 42; lat += 3){ place(0, lat, (p, yaw) => { b.box(2.6, 0.12, 3.05, thatchM, p.x, this.lodgeH + 3.1, p.z, yaw + Math.PI / 2, 0.4); for (const sx of [-1.1, 1.1]){ const q = this.lodgePoint(sx, lat).p; if (lat % 6 === 2) b.cyl(0.08, 0.08, 3.1, woodM, q.x, this.lodgeH + 1.55, q.z, 6); } }); }
    // the garage: an open-fronted workshop with a tin roof, where trucks are serviced
    const dR = this.road(this.depotS, 0), dyaw = Math.atan2(dR.t.x, dR.t.z);
    this.depotPos = this.road(this.depotS, 17).p;
    this.depotYaw = dyaw;
    { const c = this.depotPos, X = V(Math.cos(dyaw), 0, -Math.sin(dyaw)), Zf = V(Math.sin(dyaw), 0, Math.cos(dyaw));
      const P = (x, z) => V(c.x + X.x * x + Zf.x * z, 0, c.z + X.z * x + Zf.z * z);
      // back wall (outer side), two end walls, roof
      const bw = P(6.5, 0); b.box(0.4, 5, 22, plaster, bw.x, this.lodgeH + 2.5, bw.z, dyaw);
      for (const z of [-11, 11]){ const e = P(1, z); b.box(11, 5, 0.4, plaster, e.x, this.lodgeH + 2.5, e.z, dyaw); }
      const rf = P(1, 0); b.box(12.5, 0.2, 23, metal, rf.x, this.lodgeH + 5.3, rf.z, dyaw, 1, 0, -0.06);
      const fl = P(0.5, 0); b.box(12, 0.12, 22, stone, fl.x, this.lodgeH + 0.06, fl.z, dyaw, 0.3);
      for (const z of [-11, 0, 11]){ const q = P(-4.8, z); b.cyl(0.18, 0.18, 5.2, metal, q.x, this.lodgeH + 2.6, q.z, 8); this.addCircle(q.x, q.z, 0.3); }
      this.addSegment(P(6.5, -11).x, P(6.5, -11).z, P(6.5, 11).x, P(6.5, 11).z);
      for (const z of [-11, 11]) this.addSegment(P(-4.5, z).x, P(-4.5, z).z, P(6.5, z).x, P(6.5, z).z);
      // tool benches and a fuel pump
      const tb = P(5.6, -5); b.box(1.2, 1, 4, woodM, tb.x, this.lodgeH + 0.5, tb.z, dyaw);
      const tyres = P(5.4, 6); for (let i = 0; i < 4; i++) b.add(new THREE.TorusGeometry(0.42, 0.17, 6, 14).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1e1e1e, roughness: 0.8 }), new THREE.Matrix4().makeTranslation(tyres.x, this.lodgeH + 0.2 + i * 0.34, tyres.z));
      const pump = P(-6.8, -14); b.box(0.8, 1.8, 0.6, green, pump.x, this.lodgeH + 0.9, pump.z, dyaw); this.addCircle(pump.x, pump.z, 0.6);
      this.jeepBays = [[-1, 14.5], [3, 14.5], [-1, 18], [3, 18]].map(([x, z]) => P(x, z));
    }
    // the car park, out past the Lodge, and the drive in from the horizon
    const cp = new Batch(), gm = new THREE.MeshStandardMaterial({ map: gravel(), roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.carSpots = [];
    for (let a = -30; a <= 30; a += 6) for (let lat = 50; lat <= 80; lat += 6){
      place(a, lat, (p, yaw) => { cp.box(6.2, 0.1, 6.2, gm, p.x, this.lodgeH + 0.02, p.z, yaw, 0.15); if (lat !== 62 && Math.abs(a) > 1) this.carSpots.push({ p: p.clone(), yaw: yaw + (lat < 62 ? 0 : Math.PI) + Math.PI / 2 }); });
    }
    for (let lat = 80; lat < 300; lat += 6) place(0, lat, (p, yaw) => cp.box(7, 0.1, 6.4, gm, p.x, this.height(p.x, p.z) + 0.03, p.z, yaw, 0.15));
    for (let lat = 10; lat < 50; lat += 6) place(0, lat, (p, yaw) => cp.box(3, 0.1, 6.2, gm, p.x, this.lodgeH + 0.03, p.z, yaw, 0.15));
    cp.build(this.root, { shadows: false });
    this.entrance = this.lodgePoint(0, 60).p;
    this.queuePoint = this.lodgePoint(0, 7.2).p.setY(this.lodgeH + 0.9);
    // the big welcome sign at the car park
    place(0, 46, (p, yaw) => {
      for (const sx of [-4, 4]){ const q = this.lodgePoint(sx, 46).p; b.cyl(0.25, 0.3, 6, woodM, q.x, this.lodgeH + 3, q.z, 8); this.addCircle(q.x, q.z, 0.4); }
      const tc = textCanvas(1024, 256), c = tc.ctx;
      c.fillStyle = '#3a2414'; roundRect(c, 0, 0, 1024, 256, 30); c.fill();
      c.strokeStyle = '#f0c060'; c.lineWidth = 10; roundRect(c, 8, 8, 1008, 240, 24); c.stroke();
      c.fillStyle = '#ffd890'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = 'bold 120px Georgia, serif'; c.fillText('SAFARI CRUISE', 512, 112);
      c.font = 'bold 44px Georgia, serif'; c.fillStyle = '#ffffff'; c.fillText('Drive-through jungle safari', 512, 200);
      const s = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.25), new THREE.MeshStandardMaterial({ map: tc.tex, roughness: 0.8, side: THREE.DoubleSide }));
      s.position.set(p.x, this.lodgeH + 5, p.z); s.rotation.y = yaw + Math.PI / 2; this.root.add(s);
      this.lodgeSign = s;
    });
    b.build(this.root);
    // parked cars (more of them when it's busy)
    const carG = mergeGeometries([boxUV(1.8, 0.7, 4.2).translate(0, 0.55, 0), boxUV(1.6, 0.6, 2.2).translate(0, 1.15, -0.2)]);
    this.cars = new THREE.InstancedMesh(carG, new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.5 }), this.carSpots.length);
    const cols = [0xd8d8dc, 0x2a2a30, 0x8a1a1a, 0x1a3a7a, 0xb8b8b0, 0x2a5a3a, 0xe8e8e8, 0x6a6a70];
    const R = rng(12), M = new THREE.Matrix4(), Q = new THREE.Quaternion();
    this.carSpots.sort(() => R() - 0.5);
    this.carSpots.forEach((c, i) => { Q.setFromAxisAngle(V(0, 1, 0), c.yaw + (R() - 0.5) * 0.1); M.compose(c.p.clone().setY(this.lodgeH), Q, V(1, 1, 1)); this.cars.setMatrixAt(i, M); this.cars.setColorAt(i, new THREE.Color(cols[Math.floor(R() * cols.length)])); });
    this.cars.count = 0; this.cars.castShadow = true; this.root.add(this.cars);
    // umbrellas and benches by the café
    const ub = new Batch(), cloth = new THREE.MeshStandardMaterial({ map: canvasCloth(), roughness: 0.9, side: THREE.DoubleSide });
    for (const [a, lat] of [[-4, 31], [-6, 37], [-14, 37], [5, 34], [-16, 30]]){
      const p = this.lodgePoint(a, lat).p;
      ub.cyl(0.05, 0.05, 2.6, woodM, p.x, this.lodgeH + 1.3, p.z, 6);
      ub.add(new THREE.ConeGeometry(1.6, 0.7, 8, 1, true), cloth, new THREE.Matrix4().makeTranslation(p.x, this.lodgeH + 2.6, p.z));
      ub.cyl(0.6, 0.6, 0.06, woodM, p.x, this.lodgeH + 0.75, p.z, 12);
    }
    ub.build(this.root);
  }
  setCars(n){ this.cars.count = clamp(Math.round(n), 0, this.carSpots.length); }

  // ---------- trees, bushes, rocks, grass ----------
  buildPlants(){
    const R = rng(7);
    const trees = { acacia: [], baobab: [], broad: [], pine: [], bush: [], rock: [], reed: [], palm: [] };
    const okSpot = (x, z, clear = 9) => {
      const { lat, phi } = this.polar(x, z);
      if (Math.abs(lat) < clear) return false;
      if (Math.abs(lat + IN) < 2.5 || Math.abs(lat - OUT) < 2.5) return false;
      for (let k = 0; k < ZONES.length; k++){ if (Math.abs(wrapPhi(phi - ZONES[k].phi0 + Math.PI) - Math.PI) * Math.hypot(x, z) < 3 && lat > -IN - 2 && lat < OUT + 2) return false; }
      const dphi = Math.abs(wrapPhi(phi - LODGE / 2 + Math.PI) - Math.PI);
      if (dphi < LODGE * 0.75 && lat > -14 && lat < 100) return false;
      if (dphi < 0.1 && lat > 0) return false;
      if (this.nearWater(x, z, 2)) return false;
      return true;
    };
    const scatter = (list, n, zone, latA, latB, clear) => {
      const Z = ZONES[zone];
      for (let i = 0, tries = 0; i < n && tries < n * 30; tries++){
        const phi = lerp(Z.phi0, Z.phi1, R()), lat = lerp(latA, latB, R()), p = this.at(phi, lat, V());
        if (!okSpot(p.x, p.z, clear)) continue;
        list.push({ x: p.x, z: p.z, s: 0.75 + R() * 0.5, r: R() * TAU }); i++;
      }
    };
    for (const Z of ZONES){
      if (Z.lodge) continue;
      const k = Z.k;
      if (Z.biome === 'glade'){ scatter(trees.acacia, 14, k, -IN + 4, OUT - 4, 9); scatter(trees.palm, 6, k, -IN + 3, OUT - 3, 9); scatter(trees.baobab, 2, k, -IN + 8, OUT - 8, 14); scatter(trees.bush, 18, k, -IN, OUT, 8); }
      else if (Z.biome === 'clearing'){ scatter(trees.acacia, 9, k, -IN + 4, OUT - 4, 12); scatter(trees.palm, 5, k, -IN + 3, OUT - 3, 10); scatter(trees.baobab, 1, k, 20, OUT - 8, 16); scatter(trees.bush, 20, k, -IN, OUT, 8); scatter(trees.rock, 4, k, -IN, OUT, 8); }
      else if (Z.biome === 'rocky'){ scatter(trees.rock, 26, k, -IN + 2, OUT - 2, 7); scatter(trees.acacia, 6, k, -IN + 4, OUT - 4, 12); scatter(trees.palm, 3, k, -IN + 4, OUT - 4, 10); scatter(trees.bush, 16, k, -IN, OUT, 8); }
      else if (Z.biome === 'plain'){ scatter(trees.acacia, 4, k, -IN + 6, OUT - 6, 14); scatter(trees.palm, 3, k, -IN + 6, OUT - 6, 12); scatter(trees.bush, 10, k, -IN, OUT, 8); scatter(trees.rock, 6, k, -IN, OUT, 10); }
      else if (Z.biome === 'wet'){ scatter(trees.palm, 16, k, -IN + 3, OUT - 3, 9); scatter(trees.acacia, 5, k, 10, OUT - 4, 10); scatter(trees.bush, 20, k, -IN, OUT, 7); }
      else if (Z.biome === 'forest'){ scatter(trees.broad, 40, k, -IN + 2, OUT - 2, 8); scatter(trees.palm, 8, k, -IN + 2, OUT - 2, 8); scatter(trees.baobab, 3, k, -IN + 8, OUT - 8, 12); scatter(trees.bush, 30, k, -IN, OUT, 6); scatter(trees.rock, 6, k, -IN, OUT, 8); }
      else if (Z.biome === 'pine'){ scatter(trees.pine, 52, k, -IN + 2, OUT - 2, 8); scatter(trees.broad, 8, k, -IN + 2, OUT - 2, 8); scatter(trees.rock, 12, k, -IN, OUT, 7); }
    }
    // reeds round the ponds
    for (const p of this.ponds){ if (p.mud) continue; const n = Math.round(p.r * 2.4); for (let i = 0; i < n; i++){ const a = R() * TAU, d = p.r * (0.92 + R() * 0.2); trees.reed.push({ x: p.x + Math.cos(a) * d, z: p.z + Math.sin(a) * d, s: 0.7 + R() * 0.6, r: R() * TAU }); } }
    // the kopje in the middle: a heap of big boulders and a few trees
    for (let i = 0; i < 40; i++){ const a = R() * TAU, d = Math.sqrt(R()) * 34; trees.rock.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, s: 2 + R() * 3.5 * (1 - d / 40), r: R() * TAU, big: true }); }
    for (let i = 0; i < 70; i++){ const a = R() * TAU, d = 8 + Math.sqrt(R()) * 52; const o = { x: Math.cos(a) * d, z: Math.sin(a) * d, s: 0.8 + R() * 0.5, r: R() * TAU }; (i % 9 === 0 ? trees.baobab : i % 3 === 0 ? trees.palm : trees.acacia).push(o); }
    for (let i = 0; i < 24; i++){ const a = R() * TAU, d = 20 + R() * 40; trees.bush.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, s: 0.8 + R() * 0.6, r: R() * TAU }); }
    // the wild land outside the fences
    // (the jungle outside the fences: thick, right up to the wire)
    for (let i = 0, t = 0; i < 520 && t < 9000; t++){
      const a = R() * TAU, d = 205 + Math.sqrt(R()) * 160, x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (!okSpot(x, z, 12) || this.polar(x, z).lat < OUT + 3) continue;
      const q = R(), o = { x, z, s: 0.8 + R() * 0.6, r: R() * TAU, far: true };
      (q < 0.07 ? trees.baobab : q < 0.3 ? trees.palm : q < 0.5 ? trees.bush : trees.acacia).push(o); i++;
    }
    // around the Lodge: a few shade trees
    for (const [a, lat] of [[30, 12], [-30, 40], [32, 44], [18, 44], [-20, 44]]){ const p = this.lodgePoint(a, lat).p; trees.acacia.push({ x: p.x, z: p.z, s: 0.8, r: R() * TAU }); }

    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = V(), P = V(), C = new THREE.Color();
    const inst = (geo, mat, list, opts = {}) => {
      if (opts.split){ const near = list.filter((o) => !o.far), far = list.filter((o) => o.far); inst(geo, mat, near, { ...opts, split: false }); return inst(geo, mat, far, { ...opts, split: false, shadow: false }); }
      const { y = 0, scale = (o) => o.s, color, shadow = true, collide } = opts;
      if (!list.length) return null;
      const m = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((o, i) => {
        const h = this.height(o.x, o.z);
        const sc = scale(o);
        M.compose(P.set(o.x, h + y, o.z), Q.setFromAxisAngle(V(0, 1, 0), o.r), typeof sc === 'number' ? S.setScalar(sc) : S.copy(sc));
        m.setMatrixAt(i, M);
        if (color){ m.setColorAt(i, C.setHex(color(o))); }
        if (collide) this.addCircle(o.x, o.z, collide(o));
      });
      m.castShadow = shadow; m.receiveShadow = true; this.root.add(m);
      return m;
    };
    const barkM = new THREE.MeshStandardMaterial({ map: bark(), roughness: 0.95 });
    const leafM = new THREE.MeshStandardMaterial({ map: leaves(), roughness: 0.9, color: 0xffffff });
    const leafCol = (base) => (o) => { const c = new THREE.Color(base); c.offsetHSL((hash2(o.x * 10, o.z * 10) - 0.5) * 0.05, 0, (hash2(o.z * 7, o.x * 3) - 0.5) * 0.12); return c.getHex(); };
    // jungle tree: a tall straight trunk under a big lumpy dome of leaves
    {
      const parts = [];
      const tr = new THREE.CylinderGeometry(0.28, 0.5, 8, 7); tr.translate(0, 4, 0); parts.push(tr);
      for (const [a, l, tilt] of [[0, 3, 0.6], [2.1, 2.6, 0.7], [4.2, 2.8, 0.55]]){ const br = new THREE.CylinderGeometry(0.1, 0.2, l, 5); br.translate(0, l / 2, 0); br.rotateZ(tilt); br.rotateY(a); br.translate(0, 7, 0); parts.push(br); }
      const trunk = mergeGeometries(parts.map((g) => { g.deleteAttribute('uv'); return g; }));
      const clumps = [];
      for (const [x, y, z, r] of [[0, 10.2, 0, 3.8], [2.6, 9.2, 0.6, 2.8], [-2.4, 9.4, -0.8, 2.9], [0.6, 9, -2.6, 2.7], [-0.8, 9.1, 2.5, 2.6], [0.3, 12, 0.2, 2.4]]){
        const c = ellipsoid(r, r * 0.75, r, 9, 6); const p = c.attributes.position;
        for (let i = 0; i < p.count; i++){ const k = 1 + (vnoise(p.getX(i) * 0.9 + x * 3, p.getZ(i) * 0.9 + y, 6) - 0.5) * 0.4; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k); }
        c.translate(x, y, z); c.computeVertexNormals(); clumps.push(c.toNonIndexed());
      }
      inst(trunk, barkM, trees.acacia, { collide: (o) => 0.55 * o.s, split: true });
      inst(mergeGeometries(clumps), leafM, trees.acacia, { color: leafCol(0x3a6a22), split: true });
    }
    // kapok: a giant that towers over the rest, with buttress roots and a wide umbrella crown
    {
      const t = new THREE.CylinderGeometry(0.6, 1.1, 20, 10); t.translate(0, 10, 0);
      const parts = [t];
      for (let i = 0; i < 5; i++){ const f = new THREE.BoxGeometry(0.25, 3.2, 2.4); const p = f.attributes.position; for (let k = 0; k < p.count; k++){ if (p.getY(k) > 0) p.setZ(k, p.getZ(k) * 0.15); } f.translate(0, 1.6, 1.2); f.rotateY(i / 5 * TAU); parts.push(f); }
      for (let i = 0; i < 5; i++){ const br = new THREE.CylinderGeometry(0.15, 0.35, 5, 5); br.translate(0, 2.5, 0); br.rotateZ(1.0); br.rotateY(i * 1.26); br.translate(0, 19, 0); parts.push(br); }
      inst(mergeGeometries(parts.map((g) => { g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; })), new THREE.MeshStandardMaterial({ map: bark(), color: 0xd0c8b8, roughness: 0.95 }), trees.baobab, { collide: (o) => 1.4 * o.s, split: true });
      const cl = []; for (let i = 0; i < 7; i++){ const c = ellipsoid(3.4, 1.4, 3.4, 9, 6); const a = i * 0.9; const d = i ? 4.6 : 0; c.translate(Math.cos(a) * d, 22 + (i % 2) * 0.8, Math.sin(a) * d); cl.push(c.toNonIndexed()); }
      inst(mergeGeometries(cl), leafM, trees.baobab, { color: leafCol(0x48722a), split: true });
    }
    // broadleaf forest trees
    {
      const t = new THREE.CylinderGeometry(0.25, 0.45, 7, 7); t.translate(0, 3.5, 0); t.deleteAttribute('uv');
      inst(t, barkM, trees.broad, { collide: (o) => 0.5 * o.s, scale: (o) => V(o.s, o.s * 1.15, o.s) });
      const cl = []; for (const [x, y, z, r] of [[0, 8.5, 0, 3.4], [1.8, 7.2, 0.8, 2.6], [-1.6, 7.4, -0.9, 2.7], [0.4, 7, -2, 2.4], [-0.6, 10.2, 0.6, 2.2]]){ const c = ellipsoid(r, r * 0.85, r, 10, 7); const p = c.attributes.position; for (let i = 0; i < p.count; i++){ const k = 1 + (vnoise(p.getX(i) + x * 3, p.getZ(i) + y, 6) - 0.5) * 0.35; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k); } c.translate(x, y, z); c.computeVertexNormals(); cl.push(c.toNonIndexed()); }
      inst(mergeGeometries(cl), leafM, trees.broad, { color: leafCol(0x2e5e22), scale: (o) => V(o.s, o.s * 1.15, o.s) });
    }
    // pines
    {
      const t = new THREE.CylinderGeometry(0.18, 0.4, 10, 6); t.translate(0, 5, 0); t.deleteAttribute('uv');
      inst(t, barkM, trees.pine, { collide: (o) => 0.45 * o.s, scale: (o) => V(o.s, o.s * 1.2, o.s) });
      const cones = []; for (let i = 0; i < 5; i++){ const r = 3.4 - i * 0.6, c = new THREE.ConeGeometry(r, 3.4, 9); c.translate(0, 4.2 + i * 2, 0); cones.push(c.toNonIndexed()); }
      inst(mergeGeometries(cones), leafM, trees.pine, { color: leafCol(0x2e4a2a), scale: (o) => V(o.s, o.s * 1.2, o.s) });
    }
    // palms (round the lake)
    {
      const parts = []; for (let i = 0; i < 6; i++){ const c = new THREE.CylinderGeometry(0.2, 0.24, 1.4, 6); c.translate(0.08 * i * i * 0.1, 0.7 + i * 1.35, 0); c.rotateZ(-0.02 * i); parts.push(c.toNonIndexed()); }
      parts.forEach((g) => g.deleteAttribute('uv'));
      inst(mergeGeometries(parts), barkM, trees.palm, { collide: () => 0.3, split: true });
      const fr = []; for (let i = 0; i < 9; i++){ const f = new THREE.ConeGeometry(0.5, 4.2, 3); f.rotateZ(Math.PI / 2 + 0.35); f.translate(2, 0, 0); f.scale(1, 0.25, 1); f.rotateY(i / 9 * TAU); f.translate(0.4, 8.2, 0); fr.push(f.toNonIndexed()); }
      inst(mergeGeometries(fr), leafM, trees.palm, { color: leafCol(0x4a8a26), split: true });
    }
    // bushes
    {
      const cl = []; for (const [x, y, z, r] of [[0, 0.7, 0, 1.2], [0.9, 0.5, 0.3, 0.9], [-0.8, 0.55, -0.2, 0.9], [0.2, 0.5, -0.9, 0.8]]){ const c = ellipsoid(r, r * 0.8, r, 8, 6); c.translate(x, y, z); cl.push(c.toNonIndexed()); }
      inst(mergeGeometries(cl), leafM, trees.bush, { color: leafCol(0x3a7224), split: true });
    }
    // reeds
    {
      const bl = []; for (let i = 0; i < 9; i++){ const c = new THREE.ConeGeometry(0.05, 2 + (i % 3) * 0.4, 3); c.translate(Math.cos(i * 2.4) * 0.4, 1 + (i % 3) * 0.2, Math.sin(i * 2.4) * 0.4); bl.push(c.toNonIndexed()); }
      inst(mergeGeometries(bl), new THREE.MeshStandardMaterial({ color: 0x7a8a42, roughness: 0.9 }), trees.reed, { y: -0.4, shadow: false });
    }
    // rocks
    {
      const g = new THREE.DodecahedronGeometry(1, 1); const p = g.attributes.position;
      for (let i = 0; i < p.count; i++){ const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const k = 0.8 + vnoise(x * 2 + 9, z * 2 + y * 2, 12) * 0.45; p.setXYZ(i, x * k * 1.2, y * k * 0.7, z * k); }
      g.computeVertexNormals();
      inst(g, new THREE.MeshStandardMaterial({ map: rockTex(), roughness: 0.95 }), trees.rock, { y: 0.1, scale: (o) => o.big ? o.s : o.s * 1.1, collide: (o) => (o.big ? o.s : o.s * 1.1) * 1.1, color: (o) => o.big ? 0xb8aca0 : 0xd8ccc0 });
    }
    this.treeSpots = trees;
    // grass tufts, all over (thinner in the forest, none on the road)
    const blades = [];
    for (let i = 0; i < 9; i++){
      const a = (i / 9) * TAU + 0.3, l = 0.35 + (i % 3) * 0.12;
      const g = new THREE.BufferGeometry();
      const bx = Math.cos(a) * 0.05, bz = Math.sin(a) * 0.05, tx = Math.cos(a) * 0.22, tz = Math.sin(a) * 0.22;
      g.setAttribute('position', new THREE.Float32BufferAttribute([bx - bz * 0.35, 0, bz + bx * 0.35, bx + bz * 0.35, 0, bz - bx * 0.35, tx, l, tz], 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute([0.62, 0.55, 0.3, 0.62, 0.55, 0.3, 1.15, 1.02, 0.7], 3));
      g.computeVertexNormals();
      const n = g.attributes.normal; for (let k = 0; k < 3; k++) n.setXYZ(k, 0, 1, 0);
      blades.push(g);
    }
    const tuft = mergeGeometries(blades);
    const spots = [];
    for (let i = 0, t = 0; i < 14000 && t < 60000; t++){
      const a = R() * TAU, d = Math.sqrt(R()) * 330, x = Math.cos(a) * d, z = Math.sin(a) * d;
      const { lat, phi, zone } = this.polar(x, z);
      if (Math.abs(lat) < 5) continue;
      const dphi = Math.abs(wrapPhi(phi - LODGE / 2 + Math.PI) - Math.PI);
      if (dphi < LODGE * 0.55 && lat > 4 && lat < 96) continue;
      if (this.nearWater(x, z, 0.5)) continue;
      if (fbm(x / 14, z / 14, 2, 77) < 0.36) continue;
      const Z = ZONES[zone]; if ((Z.biome === 'forest' || Z.biome === 'pine') && lat > -IN && lat < OUT && R() < 0.6) continue;
      spots.push({ x, z, s: 0.7 + R() * 0.9, r: R() * TAU }); i++;
    }
    const gm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide });
    this.grass = inst(tuft, gm, spots, { shadow: false, scale: (o) => V(o.s, o.s * (0.8 + hash2(o.x, o.z) * 0.6), o.s), color: (o) => { const c = new THREE.Color(0x7aa848); c.offsetHSL((hash2(o.x * 3, o.z) - 0.5) * 0.06, 0, (hash2(o.z, o.x * 5) - 0.5) * 0.16); return c.getHex(); } });
  }

  // ---------- the jungle canopy ----------
  // A solid roof of treetops all round the outside of the fences and over the hill in the middle,
  // so the safari feels like a set of clearings cut into the jungle. One mesh: a grid laid over the
  // land, lifted 14-24 m where there's jungle and tucked under the ground where there isn't.
  canopyHeight(x, z){
    const { phi, lat } = this.polar(x, z), r = Math.hypot(x, z);
    const out = smooth((lat - OUT - 6) / 16), core = smooth((-IN - 8 - lat) / 14) * smooth((r - 14) / 10);
    let k = Math.max(out, core);
    // gaps for the Lodge and the drive in
    const dphi = Math.abs(wrapPhi(phi - LODGE / 2 + Math.PI) - Math.PI);
    k *= smooth((dphi - LODGE * 0.58) / (LODGE * 0.25));
    if (lat > 0){ const across = dphi * Math.hypot(x, z); k *= Math.max(smooth((across - 9) / 6), smooth((dphi - LODGE * 0.58) / (LODGE * 0.25))); }
    if (k <= 0.01) return 0;
    return k * (12 + fbm(x / 30, z / 30, 2, 61) * 7 + this.crown(x, z).h * 7);
  }
  // round treetops: a dome for every tree, one tree in each 8 m cell
  crown(x, z){
    const C = 8, ci = Math.floor(x / C), cj = Math.floor(z / C);
    let best = 0, id = 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++){
      const a = ci + i, b = cj + j, cx = (a + 0.2 + hash2(a, b, 71) * 0.6) * C, cz = (b + 0.2 + hash2(a, b, 72) * 0.6) * C;
      const r = 4.5 + hash2(a, b, 73) * 3, d = Math.hypot(x - cx, z - cz) / r;
      if (d < 1){ const h = Math.sqrt(1 - d * d) * (0.7 + hash2(a, b, 74) * 0.5); if (h > best){ best = h; id = hash2(a, b, 75); } }
    }
    return { h: best, id };
  }
  buildCanopy(){
    const seg = 260, size = HALF * 2;
    const g = new THREE.PlaneGeometry(size, size, seg, seg); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position, col = new Float32Array(p.count * 3), uv = g.attributes.uv, up = new Uint8Array(p.count);
    for (let i = 0; i < p.count; i++){
      const x = p.getX(i), z = p.getZ(i), ground = this.height(x, z), c = this.canopyHeight(x, z);
      p.setY(i, c > 0.5 ? ground + c : ground - 3); if (c > 0.5) up[i] = 1;
      // each crown its own green, darker down in the gaps between them
      const cr = this.crown(x, z), m = fbm(x / 40, z / 40, 2, 34), lit = 0.45 + cr.h * 0.7;
      const hue = cr.id;
      col[i * 3] = lerp(0.12, 0.3, hue) * lit * (0.85 + m * 0.3); col[i * 3 + 1] = lerp(0.28, 0.44, hue * 0.7 + 0.15) * lit * (0.85 + m * 0.3); col[i * 3 + 2] = lerp(0.08, 0.16, hue) * lit;
      uv.setXY(i, x / 9, z / 9);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    // keep only the triangles that are up in the trees (the rest would be hidden under the ground)
    const ix = g.index.array, keep = [];
    for (let t = 0; t < ix.length; t += 3) if (up[ix[t]] || up[ix[t + 1]] || up[ix[t + 2]]) keep.push(ix[t], ix[t + 1], ix[t + 2]);
    g.setIndex(keep);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: leaves(), vertexColors: true, roughness: 0.95 }));
    m.matrixAutoUpdate = false; m.receiveShadow = true; this.root.add(m);
    this.canopy = m;
  }

  // ---------- feeding stations ----------
  buildFeeders(){
    this.feeders = [];
    const woodM = new THREE.MeshStandardMaterial({ map: wood(), roughness: 0.9 });
    const hayM = new THREE.MeshStandardMaterial({ map: thatch(), color: 0xe8d8a0, roughness: 1 });
    const meatM = new THREE.MeshStandardMaterial({ color: 0x8a2a24, roughness: 0.6 });
    for (const Z of ZONES){
      if (Z.lodge) continue;
      const phi = lerp(Z.phi0, Z.phi1, 0.22), lat = Z.carnivore ? 16 : -15, p = this.at(phi, lat, V());
      const g = new THREE.Group(); g.position.copy(p); this.root.add(g);
      const b = new Batch();
      let food;
      if (Z.carnivore){
        // a log platform where the keepers leave meat
        b.box(3.2, 0.5, 2.2, woodM, 0, 0.25, 0);
        b.cyl(0.18, 0.2, 2.6, woodM, 1.2, 1.3, 0, 6);
        food = new THREE.Group();
        for (let i = 0; i < 3; i++){ const m = new THREE.Mesh(ellipsoid(0.35, 0.18, 0.25), meatM); m.position.set(-0.8 + i * 0.7, 0.62, (i % 2) * 0.3 - 0.15); m.castShadow = true; food.add(m); }
      } else {
        // a hay rack on legs, with a little roof (tall for the giraffes)
        const tall = Z.id === 'giraffe' ? 3.4 : 0.9;
        for (const [x, z] of [[-1.3, -0.6], [1.3, -0.6], [-1.3, 0.6], [1.3, 0.6]]) b.box(0.15, tall + 1.4, 0.15, woodM, x, (tall + 1.4) / 2, z);
        b.box(2.8, 0.12, 1.4, woodM, 0, tall, 0);
        for (let i = 0; i < 8; i++) b.box(0.05, 0.9, 1.3, woodM, -1.2 + i * 0.34, tall + 0.5, 0, 0, 1, 0.0);
        b.box(3.2, 0.1, 1.9, woodM, 0, tall + 1.45, 0, 0, 1, 0.08);
        food = new THREE.Mesh(ellipsoid(1.2, 0.45, 0.55), hayM); food.position.y = tall + 0.4; food.castShadow = true;
      }
      b.build(g); g.add(food);
      g.rotation.y = Math.atan2(p.x, p.z);
      this.addCircle(p.x, p.z, 1.8);
      this.feeders[Z.k] = { pos: p.clone(), food, group: g, k: Z.k, set: (f) => { food.visible = f > 0.03; food.scale.set(1, clamp(f * 1.1, 0.15, 1), 1); } };
    }
  }

  // ---------- information boards by the road (and "coming soon" ones on closed enclosures) ----------
  buildSigns(){
    this.boards = [];
    const woodM = new THREE.MeshStandardMaterial({ map: wood(), roughness: 0.9 });
    for (const Z of ZONES){
      if (Z.lodge) continue;
      const s = this.sOfPhi(Z.phi0) + 14, R = this.road(s, ROAD_W / 2 + 2.2);
      const g = new THREE.Group(); g.position.copy(R.p); g.rotation.y = Math.atan2(R.t.x, R.t.z) + Math.PI / 2 + 0.5; this.root.add(g);
      const b = new Batch(); for (const x of [-1, 1]) b.cyl(0.07, 0.08, 2.4, woodM, x, 1.2, -0.05, 6); b.box(2.4, 1.5, 0.08, woodM, 0, 1.8, -0.1); b.build(g);
      const tc = textCanvas(512, 320);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2.25, 1.4), new THREE.MeshStandardMaterial({ map: tc.tex, roughness: 0.85 }));
      m.position.set(0, 1.8, -0.05); g.add(m);
      this.addCircle(R.p.x, R.p.z, 0.8);
      this.boards[Z.k] = { tc, Z, open: null };
    }
  }
  drawBoard(k, open, names){
    const B = this.boards[k]; if (!B) return;
    const key = open + '|' + names;
    if (B.key === key) return; B.key = key;
    const c = B.tc.ctx, Z = B.Z;
    c.fillStyle = open ? '#2a4a2a' : '#5a3a1a'; c.fillRect(0, 0, 512, 320);
    c.strokeStyle = '#e8d8a0'; c.lineWidth = 8; c.strokeRect(8, 8, 496, 304);
    c.fillStyle = '#fff4d0'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = 'bold 54px Georgia, serif'; c.fillText(`${Z.icon} ${Z.name}`, 256, 64);
    c.font = '32px Georgia, serif';
    if (open){ const lines = wrapText(c, names, 460); lines.slice(0, 4).forEach((l, i) => c.fillText(l, 256, 140 + i * 42)); if (Z.carnivore){ c.fillStyle = '#ffd060'; c.font = 'bold 28px Georgia, serif'; c.fillText('⚠ Keep your windows closed!', 256, 290); } }
    else { c.fillStyle = '#ffd060'; c.font = 'bold 46px Georgia, serif'; c.fillText('COMING SOON', 256, 160); c.fillStyle = '#fff4d0'; c.font = '30px Georgia, serif'; c.fillText('The animals are on their way!', 256, 230); }
    B.tc.tex.needsUpdate = true;
  }
  // a random spot inside an enclosure, on dry land (or in the water, for the swimmers)
  randomSpot(k, R = Math.random, { wet = false, nearRoad = false, margin = 4 } = {}){
    const Z = ZONES[k];
    for (let i = 0; i < 40; i++){
      const phi = lerp(Z.phi0 + 0.012, Z.phi1 - 0.012, R());
      const lat = nearRoad ? (R() < 0.5 ? -1 : 1) * lerp(8, 26, R()) : lerp(-IN + margin, OUT - margin, R());
      const p = this.at(phi, lat, V());
      const w = this.inWater(p.x, p.z);
      if (wet ? w : !w){ if (!wet && Math.abs(lat) < 6) continue; return p; }
    }
    return this.at(lerp(Z.phi0, Z.phi1, 0.5), 20, V());
  }
  // keep a point inside enclosure k (margin metres from the fences)
  keepIn(k, p, margin = 1.5){
    const Z = ZONES[k], th = Math.atan2(p.z, p.x), phi = wrapPhi(th - PHI0);
    let r = Math.hypot(p.x, p.z), ph = phi;
    const rr = roadR(th);
    const lat = clamp(r - rr, -IN + margin, OUT - margin);
    const mid = (Z.phi0 + Z.phi1) / 2, d = wrapPhi(ph - mid + Math.PI) - Math.PI, half = (Z.phi1 - Z.phi0) / 2;
    const pad = margin / Math.max(60, rr + lat);
    ph = mid + clamp(d, -half + pad, half - pad);
    const th2 = ph + PHI0, r2 = roadR(th2) + lat;
    p.x = r2 * Math.cos(th2); p.z = r2 * Math.sin(th2);
    return p;
  }
}
