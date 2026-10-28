// The Undercroft's people: shambling zombies and the prisoners in the cells.
//
// The heads are a real photoscan: "Infinite, 3D Head Scan" by Lee Perry-Smith (Infinite Realities, based on a
// work at triplegangers.com), licensed CC BY 3.0, from three.js's examples. Its closed eyes were opened, the
// bust trimmed to a neck and the mesh decimated; zombies get a repainted skin (see
// _tools/undercroft/make_people_textures.py, which builds every people_* file this module loads).
// The bodies are sculpted from a signed distance field (muscles as blended ellipsoids and capsules, clothes as a
// loose offset of it with folds, ragged hems and tears), meshed with surface nets, decimated and skinned to one
// skeleton, all offline. Here we only load that, build materials and pose the bones procedurally each frame.
//
//   const kit = await createPeopleKit({ env });
//   const z = kit.makeZombie(seed);   z.update(dt, { speed, attack, hurt, dead, emerge });
//   const p = kit.makePrisoner(seed); p.update(dt, { pose: 'sit' | 'bars' | 'cheer' | 'walk', speed });
//
// Each figure is three draw calls (body, head, hair) and about 11k triangles.
import * as THREE from 'three';

const TEX = new URL('../../tex/', import.meta.url).href;
const ZOMBIE_OUTFITS = ['z_shirt', 'z_tee', 'z_vest'];
const PRISONER_OUTFITS = ['p_tunic', 'p_shirt', 'p_thin'];
const TAU = Math.PI * 2;

// ---------- small helpers ----------

function rng(seed){       // mulberry32: same seed, same person
  let a = (seed * 2654435761) >>> 0 || 1;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const pick = (r, list) => list[Math.floor(r() * list.length) % list.length];
const srgb = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);

// ---------- loading the baked meshes ----------

const TYPES = { f4: Float32Array, i1: Int8Array, u1: Uint8Array, u2: Uint16Array };
async function loadMeshes(){
  const buf = await (await fetch(TEX + 'people.bin')).arrayBuffer();
  const jl = new Uint32Array(buf, 4, 1)[0];
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, jl)));
  const base = 8 + jl, geos = {};
  for (const [name, m] of Object.entries(head.meshes)){
    const g = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(m.attributes)){
      const T = TYPES[a.type];
      g.setAttribute(k, new THREE.BufferAttribute(new T(buf, base + a.offset, m.count * a.size), a.size, a.normalized));
    }
    g.setIndex(new THREE.BufferAttribute(new Uint16Array(buf, base + m.index.offset, m.index.count), 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.0);
    g.userData.triangles = m.triangles;
    geos[name] = g;
  }
  return { bones: head.bones, geos };
}

// ---------- materials ----------
// Body: no UVs, so detail comes in from three sides in the bind pose (it rides along with the skin). Per vertex:
// aW = signed "how far inside" the shirt, trousers and leather regions; aS = baked occlusion, grime, blood
// potential, and a nail mask. Everything per person is a uniform, so all figures share one shader program.

const BODY_VERT_PARS = 'attribute vec4 aW;\nattribute vec4 aS;\nvarying vec3 vBP;\nvarying vec3 vBN;\nvarying vec4 vW;\nvarying vec4 vS;\n';
const BODY_FRAG_PARS = `
uniform sampler2D uDetail;
uniform vec3 uSkin, uTop, uBot, uLea, uGrime;
uniform float uZombie, uBlood, uDirt, uWear, uSeed;
varying vec3 vBP; varying vec3 vBN; varying vec4 vW; varying vec4 vS;
vec3 triDetail(vec3 p, vec3 n){
  vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
  return texture2D(uDetail, p.zy).rgb * w.x + texture2D(uDetail, p.xz + 0.37).rgb * w.y + texture2D(uDetail, p.xy + 0.71).rgb * w.z;
}
// bump from a height that only exists per pixel (Mikkelsen's surface gradient, unnormalised so it holds up close)
vec3 bumpNormal(vec3 pos, vec3 n, float h, float fd){
  vec3 sx = dFdx(pos), sy = dFdy(pos);
  vec3 r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1) * fd;
  vec3 g = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * n - g);
}
float gTop, gBot, gLea, gCloth, gBlood, gH, gNail;
`;
const BODY_FRAG_COLOR = `
  vec3 dS = triDetail(vBP * 17.0 + uSeed, vBN);          // skin pores and blotches, ~6 cm tiles
  vec3 dC = triDetail(vBP * 13.0 + uSeed * 0.7, vBN);    // the weave, ~8 cm tiles
  float blot = dC.b - 0.5;
  gTop = smoothstep(-0.12, 0.12, vW.x + blot * 0.25);
  gBot = smoothstep(-0.12, 0.12, vW.y + blot * 0.25);
  gLea = smoothstep(-0.1, 0.1, vW.z);
  gCloth = max(gTop, gBot);
  gNail = vS.w;
  float ao = vS.x;
  // skin: blotchy, darker in creases, bruised and greyed for the dead
  vec3 skin = uSkin * (0.82 + 0.36 * dS.b) * (0.9 + 0.2 * dS.r);
  vec3 bruise = mix(vec3(0.20, 0.11, 0.16), vec3(0.14, 0.16, 0.08), step(0.5, fract(blot * 7.0)));
  skin = mix(skin, skin * bruise * 3.0, uZombie * smoothstep(0.15, 0.35, blot) * 0.6);
  skin = mix(skin, uSkin * vec3(1.08, 0.85, 0.82), gNail * 0.5);
  // cloth: the weave, wear (lighter where rubbed) and stains
  float weave = dC.g;
  vec3 top = uTop * (0.62 + 0.55 * weave) * (0.85 + 0.3 * dC.b);
  vec3 bot = uBot * (0.62 + 0.55 * weave) * (0.85 + 0.3 * dC.b);
  vec3 lea = uLea * (0.75 + 0.5 * dS.b) * (vBP.y < 0.024 ? 0.55 : 1.0);
  vec3 col = skin;
  col = mix(col, bot, gBot);
  col = mix(col, top, gTop);
  col = mix(col, lea, gLea);
  // grime: baked where it gathers, broken up by the detail texture
  float grime = clamp(vS.y * uDirt * (0.7 + 0.8 * dC.b) + (1.0 - ao) * 0.3, 0.0, 1.0);
  col = mix(col, col * uGrime * 2.2, grime * 0.75);
  // blood: the potential baked per vertex, how much shows is per person
  gBlood = smoothstep(1.0 - uBlood, 1.0 - uBlood + 0.15, vS.z + blot * 0.35);
  vec3 bl = mix(vec3(0.16, 0.012, 0.008), vec3(0.06, 0.012, 0.006), smoothstep(0.3, 0.7, dS.b));
  col = mix(col, bl, gBlood * 0.9);
  col *= mix(1.0, ao, 0.75);
  diffuseColor.rgb = col;
  gH = mix(dS.r * 0.00035, weave * 0.0009, gCloth) + mix(0.0, (dS.b - 0.5) * 0.0006, gLea);
`;
const BODY_FRAG_ROUGH = `
  float roughnessFactor = mix(mix(0.5, 0.42, uZombie) + 0.15 * dS.b, 0.93, gCloth);
  roughnessFactor = mix(roughnessFactor, 0.6, gLea);
  roughnessFactor = mix(roughnessFactor, 0.3, gNail);
  roughnessFactor = mix(roughnessFactor, 0.28, gBlood * (1.0 - gCloth * 0.6));
`;

function bodyMaterial(env, detail){
  const U = {
    uDetail: { value: detail }, uSkin: { value: new THREE.Color() }, uTop: { value: new THREE.Color() }, uBot: { value: new THREE.Color() },
    uLea: { value: new THREE.Color() }, uGrime: { value: srgb(0.32, 0.27, 0.2) }, uZombie: { value: 0 }, uBlood: { value: 0 },
    uDirt: { value: 1 }, uWear: { value: 0.5 }, uSeed: { value: 0 },
  };
  const m = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, envMap: env || null, envMapIntensity: 0.35 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = BODY_VERT_PARS + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vBP = position; vBN = normal; vW = aW; vS = aS;');
    sh.fragmentShader = BODY_FRAG_PARS + sh.fragmentShader
      .replace('#include <map_fragment>', BODY_FRAG_COLOR)
      .replace('#include <roughnessmap_fragment>', BODY_FRAG_ROUGH)
      .replace('#include <normal_fragment_maps>', '  normal = bumpNormal(-vViewPosition, normal, gH, faceDirection);');
  };
  m.customProgramCacheKey = () => 'undercroft-people-body-1';
  m.userData.u = U;
  return m;
}

// Head: the scan's colour (or the zombie repaint), normal and data maps. Tint, grime and blood are per person.
// aK marks the eyeballs, which are painted here: sclera, iris and pupil, wet, and for zombies milky and glowing.
const HEAD_FRAG_PARS = `
uniform sampler2D uDat, uDetail;
uniform vec3 uTint, uIris, uGlow, uGrime, uHairCol;
uniform float uZombie, uBlood, uDirt, uDesat, uHairCap;
varying float vK; varying vec3 vBP2;
float gEye, gBlood2;
`;
const HEAD_FRAG_COLOR = `
  vec4 sampledDiffuseColor = texture2D(map, vMapUv);
  vec3 dat = texture2D(uDat, vMapUv).rgb;
  vec3 c = sampledDiffuseColor.rgb;
  float l = dot(c, vec3(0.3, 0.55, 0.15));
  c = mix(c, vec3(l), uDesat) * uTint;
  // under the hair cards the scalp takes the hair's colour, so gaps between cards read as hair, not skin
  float scalp = vK < 0.5 ? clamp(vK / 0.45, 0.0, 1.0) : 0.0;
  c = mix(c, uHairCol * (0.45 + 0.4 * dat.g), scalp * uHairCap);
  float grime = clamp((dat.b - 0.35) * 1.6 * uDirt, 0.0, 1.0);
  c = mix(c, c * uGrime * 2.0, grime * 0.7);
  gBlood2 = smoothstep(1.0 - uBlood, 1.0 - uBlood + 0.12, dat.b);
  c = mix(c, vec3(0.13, 0.012, 0.008), gBlood2 * 0.85);
  c *= 0.75 + 0.5 * dat.g;
  // eyes: vMapUv is a disc on the front of the eyeball, centre = where it looks
  gEye = step(0.5, vK);
  vec2 e = (vMapUv - 0.5) * 2.0;
  float r = length(e);
  float iris = 1.0 - smoothstep(0.40, 0.44, r);
  float pupil = 1.0 - smoothstep(0.15, 0.18, r);
  float a = atan(e.y, e.x);
  float fib = 0.75 + 0.25 * sin(a * 37.0 + r * 9.0) * sin(a * 13.0);
  vec3 sclera = mix(vec3(0.78, 0.74, 0.68), vec3(0.62, 0.36, 0.3), smoothstep(0.5, 0.95, r) * 0.6);
  vec3 irisC = uIris * fib * (0.6 + 0.6 * smoothstep(0.42, 0.2, r));
  irisC = mix(irisC, irisC * 0.35, smoothstep(0.34, 0.43, r));          // dark limbal ring
  vec3 eye = mix(sclera, irisC, iris);
  eye = mix(eye, vec3(0.02), pupil * (1.0 - uZombie * 0.8));
  eye = mix(eye, mix(eye, vec3(0.62, 0.6, 0.5), 0.55), uZombie * iris);   // milky cataracts on the dead
  c = mix(c, eye * (0.55 + 0.45 * smoothstep(1.0, 0.6, r)), gEye);
  diffuseColor.rgb = c;
`;
const HEAD_FRAG_ROUGH = `
  float roughnessFactor = mix(dat.r * mix(1.0, 0.85, uZombie), 0.06, gEye);
  roughnessFactor = mix(roughnessFactor, 0.3, gBlood2);
`;

function headMaterial(env, maps, zombie){
  const U = {
    uDat: { value: maps.dat }, uDetail: { value: maps.detail }, uTint: { value: new THREE.Color(1, 1, 1) }, uIris: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color(0, 0, 0) }, uGrime: { value: srgb(0.32, 0.27, 0.2) }, uZombie: { value: zombie ? 1 : 0 },
    uBlood: { value: 0 }, uDirt: { value: 1 }, uDesat: { value: 0 }, uHairCol: { value: new THREE.Color() }, uHairCap: { value: 0 },
  };
  const m = new THREE.MeshStandardMaterial({ map: zombie ? maps.zom : maps.col, normalMap: maps.nrm, roughness: 1, metalness: 0,
    envMap: env || null, envMapIntensity: 0.4 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'attribute float aK;\nvarying float vK;\nvarying vec3 vBP2;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vK = aK; vBP2 = position;');
    sh.fragmentShader = HEAD_FRAG_PARS + sh.fragmentShader
      .replace('#include <map_fragment>', HEAD_FRAG_COLOR)
      .replace('#include <roughnessmap_fragment>', HEAD_FRAG_ROUGH)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n  normal = normalize(mix(normal, nonPerturbedNormal, gEye));')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += uGlow * gEye * (1.0 - smoothstep(0.3, 0.5, length(vMapUv - 0.5) * 2.0));');
  };
  m.customProgramCacheKey = () => 'undercroft-people-head-1';
  m.userData.u = U;
  return m;
}

// ---------- the skeleton ----------

function makeSkeletonFactory(boneDefs){
  const index = {}; boneDefs.forEach((b, i) => { index[b.name] = i; });
  const build = () => {
    const bones = boneDefs.map((b) => { const o = new THREE.Bone(); o.name = b.name; o.position.fromArray(b.pos); o.rotation.z = b.rz; return o; });
    boneDefs.forEach((b, i) => { if (b.parent) bones[index[b.parent]].add(bones[i]); });
    return bones;
  };
  const tmpl = build(); tmpl[0].updateMatrixWorld(true);
  const inverses = tmpl.map((b) => b.matrixWorld.clone().invert());
  return { index, count: boneDefs.length, rest: boneDefs.map((b) => b.rz), restPos: boneDefs.map((b) => b.pos), build, inverses };
}

// ---------- posing ----------
// A pose is a flat array: three Euler angles per bone, then the hips' position. Pose functions write absolute
// angles (rest included), so poses can be blended by simple interpolation.

function makePoser(SK){
  const n = SK.count, N = n * 3 + 3;
  const I = SK.index;
  const B = (name) => I[name] * 3;
  const HP = n * 3;
  const fingers = ['idx', 'mid', 'rng', 'pky'];
  const api = {
    N, HP,
    rest(P){
      P.fill(0);
      for (let i = 0; i < n; i++) P[i * 3 + 2] = SK.rest[i];
      P[HP] = 0; P[HP + 1] = SK.restPos[0][1]; P[HP + 2] = 0;
    },
    set(P, name, x, y, z){ const k = B(name); P[k] = x; P[k + 1] = y; P[k + 2] = z; },
    add(P, name, x, y, z){ const k = B(name); P[k] += x; P[k + 1] += y; P[k + 2] += z; },
    // side s = 1 (left, +x) or -1. raise: forward swing (+ = forward/up); out: extra spread; bend: elbow
    arm(P, side, raise, out, twist, bend, pron){
      const s = side === 'L' ? 1 : -1;
      api.set(P, 'arm' + side, -raise, twist * s, s * (0.3 + out));
      api.set(P, 'fore' + side, -bend, pron * s, 0);
    },
    leg(P, side, swing, out, knee, ankle){
      const s = side === 'L' ? 1 : -1;
      api.set(P, 'thigh' + side, -swing, 0, s * (0.04 + out));
      api.set(P, 'shin' + side, knee, 0, 0);
      api.set(P, 'foot' + side, ankle, 0, -s * 0.04);
    },
    hand(P, side, curl, thumb, flex){
      const s = side === 'L' ? 1 : -1;
      api.set(P, 'hand' + side, 0, 0, -s * flex);
      for (let f = 0; f < 4; f++){
        const c = curl * (1 + (f - 1.5) * 0.08);
        api.set(P, fingers[f] + '1' + side, 0, 0, -s * c);
        api.set(P, fingers[f] + '2' + side, 0, 0, -s * c * 1.25);
      }
      api.set(P, 'thumb' + side, 0, -s * thumb, -s * thumb * 0.3);
    },
    apply(P, bones, hips){
      for (let i = 0; i < n; i++) bones[i].rotation.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
      hips.position.set(P[HP], P[HP + 1], P[HP + 2]);
    },
    lerp(out, a, b, t){ for (let i = 0; i < N; i++) out[i] = a[i] + (b[i] - a[i]) * t; },
  };
  return api;
}

// ---------- the kit ----------

export async function createPeopleKit(opts = {}){
  const t0 = performance.now();
  const env = opts.env || null;
  const tl = new THREE.TextureLoader();
  const load = (n, srgbTex) => tl.loadAsync(TEX + n).then((t) => { if (srgbTex) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; });
  const [mesh, detail, col, zom, nrm, dat, hairTex] = await Promise.all([
    loadMeshes(), load('people_detail.jpg'), load('people_head_col.jpg', true), load('people_head_zom.jpg', true),
    load('people_head_nrm.jpg'), load('people_head_dat.jpg'), load('people_hair.png', true),
  ]);
  detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
  const maps = { col, zom, nrm, dat, detail };
  const SK = makeSkeletonFactory(mesh.bones);
  const PO = makePoser(SK);
  const hairs = {};
  for (const k in mesh.geos) if (k.startsWith('hair_')){ hairs[k.slice(5)] = mesh.geos[k]; mesh.geos[k].computeBoundingSphere(); }

  function figure(kind, seed){
    const r = rng(seed + (kind === 'zombie' ? 0 : 7777));
    const zombie = kind === 'zombie';
    const group = new THREE.Group();
    group.name = kind;
    const bones = SK.build();
    const skeleton = new THREE.Skeleton(bones, SK.inverses);
    const outfit = pick(r, zombie ? ZOMBIE_OUTFITS : PRISONER_OUTFITS);
    const bm = bodyMaterial(env, detail), hm = headMaterial(env, maps, zombie);
    const body = new THREE.SkinnedMesh(mesh.geos[outfit], bm);
    const head = new THREE.SkinnedMesh(mesh.geos.head, hm);
    body.add(bones[0]);
    group.add(body, head);
    const ident = new THREE.Matrix4();
    body.bind(skeleton, ident); head.bind(skeleton, ident);
    for (const m of [body, head]){
      m.castShadow = true; m.receiveShadow = true;
      m.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.8, 0), 1.7);   // covers lying down and rising up
    }
    const bone = (n) => bones[SK.index[n]];
    // looks: colours are sRGB picks, converted for the shader
    const U = bm.userData.u, H = hm.userData.u;
    const cloth = zombie
      ? [[0.36, 0.33, 0.28], [0.28, 0.27, 0.25], [0.3, 0.28, 0.22], [0.24, 0.24, 0.26], [0.33, 0.3, 0.25], [0.3, 0.22, 0.18]]
      : [[0.45, 0.4, 0.32], [0.38, 0.35, 0.3], [0.42, 0.36, 0.28], [0.3, 0.3, 0.3], [0.4, 0.33, 0.25], [0.34, 0.3, 0.24]];
    const shade = (c, k) => srgb(c[0] * k, c[1] * k, c[2] * k);
    U.uTop.value.copy(shade(pick(r, cloth), 0.85 + r() * 0.3));
    U.uBot.value.copy(shade(pick(r, cloth), 0.7 + r() * 0.25));
    U.uLea.value.copy(srgb(0.2 + r() * 0.08, 0.14 + r() * 0.05, 0.1));
    let skinTone, hairCol;
    if (zombie){
      skinTone = srgb(0.5 + r() * 0.06, 0.53 + r() * 0.05, 0.44 + r() * 0.05);
      U.uZombie.value = 1; U.uBlood.value = 0.35 + r() * 0.4; U.uDirt.value = 1.1 + r() * 0.4;
      H.uTint.value.setRGB(0.9 + r() * 0.15, 0.95 + r() * 0.1, 0.9 + r() * 0.1);
      H.uBlood.value = 0.2 + r() * 0.35; H.uDirt.value = 1.2;
      H.uIris.value.copy(srgb(0.55, 0.56, 0.5));
      H.uGlow.value.copy(srgb(0.55, 0.6, 0.25)).multiplyScalar(0.35 + r() * 0.25);
      hairCol = srgb(0.16 + r() * 0.1, 0.15 + r() * 0.08, 0.13 + r() * 0.06);
    } else {
      // from fair to dark: multiply the scan's (fair) colour by a tone
      const tones = [[1, 1, 1], [0.92, 0.84, 0.76], [0.78, 0.62, 0.5], [0.58, 0.42, 0.32], [0.4, 0.28, 0.21]];
      const t = pick(r, tones);
      H.uTint.value.setRGB(t[0], t[1], t[2]);
      const base = srgb(0.72, 0.55, 0.47);
      skinTone = new THREE.Color(base.r * t[0] * t[0], base.g * t[1] * t[1], base.b * t[2] * t[2]);
      U.uBlood.value = r() * 0.15; U.uDirt.value = 0.8 + r() * 0.5;
      H.uBlood.value = r() * 0.08; H.uDirt.value = 0.7 + r() * 0.6; H.uDesat.value = 0.1;
      H.uIris.value.copy(pick(r, [srgb(0.25, 0.16, 0.09), srgb(0.32, 0.22, 0.12), srgb(0.28, 0.36, 0.42), srgb(0.3, 0.32, 0.22)]));
      hairCol = pick(r, [srgb(0.08, 0.06, 0.05), srgb(0.16, 0.11, 0.07), srgb(0.28, 0.2, 0.12), srgb(0.05, 0.05, 0.05), srgb(0.35, 0.33, 0.3)]);
    }
    U.uSkin.value.copy(skinTone);
    U.uSeed.value = r() * 10;
    // hair: a style built on the scan's scalp, tinted per person
    const style = zombie ? pick(r, ['thin', 'bald', 'thin']) : pick(r, ['short', 'messy', 'long', 'short', 'cropped']);
    let hair = null;
    H.uHairCol.value.copy(hairCol); H.uHairCap.value = zombie ? 0.2 : 0.35;
    if (hairs[style]){
      const hmat = new THREE.MeshStandardMaterial({ map: hairTex, color: hairCol, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.62, metalness: 0,
        envMap: env || null, envMapIntensity: 0.25 });
      hair = new THREE.Mesh(hairs[style], hmat);
      H.uHairCap.value = style === 'thin' ? 0.5 : 0.92;
      hair.castShadow = true;
      bone('head').add(hair);
    }
    // size and build
    const scale = zombie ? 0.95 + r() * 0.1 : 0.92 + r() * 0.12;
    group.scale.setScalar(scale);
    bone('head').scale.setScalar(1 / (0.97 + r() * 0.06));

    // hit spheres follow the bones
    const sphere = (b, x, y, z, radius, k) => { const o = new THREE.Object3D(); o.position.set(x, y, z); bone(b).add(o); return { object: o, radius: radius * scale, kind: k }; };
    const parts = [
      sphere('head', 0, 0.09, 0.02, 0.12, 'head'), sphere('chest', 0, 0.08, 0.01, 0.2, 'body'), sphere('hips', 0, 0.0, 0.0, 0.18, 'body'),
      sphere('thighL', 0, -0.25, 0, 0.1, 'body'), sphere('thighR', 0, -0.25, 0, 0.1, 'body'),
    ];
    const mats = [bm, hm]; if (hair) mats.push(hair.material);
    return { group, bones, bone, r, parts, height: 1.78 * scale, mats, hipsBone: bones[0], outfit, style,
      dispose(){ for (const m of mats) m.dispose(); skeleton.dispose(); } };
  }

  // ---- zombies ----
  function makeZombie(seed = 1){
    const F = figure('zombie', seed), r = F.r;
    const P = new Float32Array(PO.N), Q = new Float32Array(PO.N);
    const ind = {   // this one's quirks
      phase: r() * TAU, lean: 0.15 + r() * 0.25, limp: r() < 0.35 ? (r() < 0.5 ? 1 : -1) : 0, limpAmt: 0.3 + r() * 0.4,
      armDown: r() < 0.2 ? (r() < 0.5 ? 'L' : 'R') : null, tilt: (r() - 0.5) * 0.5, roll: (r() - 0.5) * 0.3,
      reach: 0.8 + r() * 0.5, jaw: 0.08 + r() * 0.2, fallBack: r() < 0.7, twitch: r() * 10, stride: 0.95 + r() * 0.25,
    };
    let ph = ind.phase, time = r() * 100, gait = 0;
    function shamble(P, speed, dt){
      PO.rest(P);
      gait = mix(gait, clamp(speed / 2.5, 0, 1), 1 - Math.exp(-dt * 3));
      const move = clamp(speed / 0.6, 0, 1);
      ph += dt * (speed / (ind.stride + 0.6 * gait)) * TAU + dt * 0.8 * (1 - move);
      const s = Math.sin(ph), c = Math.cos(ph);
      const amp = move * (0.3 + 0.28 * gait);
      const kL = ind.limp === 1 ? 1 - ind.limpAmt : 1, kR = ind.limp === -1 ? 1 - ind.limpAmt : 1;
      // legs: the swing leg's knee folds as it comes through; the bad leg drags with a stiff knee
      PO.leg(P, 'L', s * amp * kL + 0.05 * move, 0.0, 0.12 + Math.max(0, -c) * (0.55 + 0.8 * gait) * kL * move, -0.1 * s * move + (ind.limp === 1 ? 0.25 * move : 0));
      PO.leg(P, 'R', -s * amp * kR + 0.05 * move, 0.0, 0.12 + Math.max(0, c) * (0.55 + 0.8 * gait) * kR * move, 0.1 * s * move + (ind.limp === -1 ? 0.25 * move : 0));
      // the body lurches: drops onto each step, rolls toward the bad leg, twists against the stride
      const lurch = ind.limp ? Math.max(0, ind.limp * s) * 0.05 : 0;
      P[PO.HP + 1] = 0.955 - Math.abs(s) * 0.035 * move - lurch * move - 0.03 * gait;
      P[PO.HP] = Math.sin(ph) * 0.025 * move;
      PO.set(P, 'hips', 0.04, s * 0.12 * move, -s * 0.06 * move + ind.limp * 0.05);
      const breath = Math.sin(time * 1.3) * 0.02;
      PO.set(P, 'spine', ind.lean * 0.5 + 0.06 * Math.sin(ph * 2) * move + 0.15 * gait, -s * 0.15 * move, s * 0.04 * move - ind.limp * 0.04);
      PO.set(P, 'chest', ind.lean * 0.5 + breath + 0.1 * gait, -s * 0.08 * move, ind.roll * 0.3);
      // head hangs and lolls, then snaps up toward the prey
      const loll = Math.sin(time * 0.7 + ind.twitch) * 0.12 + Math.sin(time * 2.9) * 0.03;
      PO.set(P, 'neck', 0.25 - ind.lean * 0.8 - 0.2 * gait, loll * 0.5, ind.tilt * 0.6);
      PO.set(P, 'head', -0.15 + Math.sin(ph * 0.5) * 0.05, loll * 0.5, ind.tilt * 0.6 + Math.sin(time * 0.53 + ind.twitch) * 0.08);
      PO.set(P, 'jaw', ind.jaw + Math.max(0, Math.sin(time * 1.1 + ind.twitch)) * 0.15, 0, 0);
      // arms reach for you, sway with the gait; one may hang dead
      for (const [side, sg] of [['L', 1], ['R', -1]]){
        if (ind.armDown === side){
          PO.arm(P, side, 0.05 + sg * s * 0.25 * move, -0.22, 0, 0.15, 0.2);
          PO.hand(P, side, 0.35, 0.2, 0.1);
        } else {
          const sw = sg * c * 0.12 * move;
          PO.arm(P, side, ind.reach + 0.25 * gait + sw + Math.sin(time * 1.7 + sg) * 0.04, -0.38, 0.1, 0.35 - sg * s * 0.12 * move, 1.1);
          PO.hand(P, side, 0.55 + Math.sin(time * 2.3 + sg * 2) * 0.15, 0.4, -0.25);
        }
      }
      PO.set(P, 'eyeL', 0, 0, 0); PO.set(P, 'eyeR', 0, 0, 0);
    }
    // attack: wind up with the right arm, lunge and rake down across, recover
    function attackPose(P, t){
      const up = sstep(0.0, 0.32, t) * (1 - sstep(0.4, 0.55, t));
      const hit = sstep(0.36, 0.52, t) * (1 - sstep(0.7, 1.0, t));
      PO.arm(P, 'R', mix(mix(ind.reach, 2.5, up), 0.6, hit), mix(-0.38, 0.5, up) + hit * -0.75, 0, mix(0.35, 0.7, up) - hit * 0.3, 1.1);
      PO.arm(P, 'L', mix(ind.reach, 1.45, hit + up * 0.5), -0.32 - hit * 0.2, 0, 0.3, 1.1);
      PO.hand(P, 'R', mix(0.5, 0.25, up) + hit * 0.5, 0.4, -0.3);
      PO.add(P, 'spine', -0.12 * up + 0.35 * hit, -0.45 * up + 0.4 * hit, 0);
      PO.add(P, 'chest', -0.1 * up + 0.2 * hit, -0.25 * up + 0.3 * hit, 0);
      PO.add(P, 'neck', 0.15 * up - 0.25 * hit, 0, 0);
      PO.add(P, 'head', -0.25 * up - 0.1 * hit, 0, 0);
      PO.set(P, 'jaw', 0.15 + 0.35 * Math.max(up, hit), 0, 0);
      P[PO.HP + 2] += 0.22 * hit - 0.05 * up;
      P[PO.HP + 1] -= 0.06 * hit;
      PO.leg(P, 'L', 0.55 * hit, 0.02, 0.35 * hit + 0.1, -0.1 * hit);
      PO.leg(P, 'R', -0.3 * hit, 0, 0.25 * hit + 0.1, 0.25 * hit);
    }
    // collapse: knees go, then it topples onto its back (or pitches forward onto its face)
    function deadPose(P, t){
      const k = sstep(0, 0.35, t), f = sstep(0.25, 0.85, t), lie = sstep(0.75, 1, t);
      const dir = ind.fallBack ? -1 : 1;
      P[PO.HP + 1] = mix(mix(0.95, 0.55, k), 0.13, f);
      P[PO.HP + 2] = mix(0, -0.12 * dir, k) + f * 0.2 * dir;
      PO.set(P, 'hips', mix(0.2 * k, dir * 1.5, f), 0.15 * f, mix(0, 0.1 * dir, f));
      PO.set(P, 'spine', mix(0.5 * k, dir > 0 ? 0.05 : -0.15, f), 0.1 * f, 0);
      PO.set(P, 'chest', mix(0.3 * k, dir > 0 ? 0 : -0.1, f), 0, 0.05 * f);
      PO.set(P, 'neck', mix(0.5 * k, 0.0, f), 0.0, 0.4 * f);
      PO.set(P, 'head', mix(0.2, dir > 0 ? -0.2 : 0.15, f), 0.6 * f, 0.3 * f);
      PO.set(P, 'jaw', mix(0.2, 0.45, f), 0, 0);
      const kb = dir > 0 ? 0.15 : 0.0;
      PO.leg(P, 'L', mix(1.1 * k, dir > 0 ? -0.1 : 0.35, f), mix(0, 0.15, f), mix(1.5 * k, dir > 0 ? 0.2 : 0.6, f) + kb, mix(0, 0.5, f));
      PO.leg(P, 'R', mix(0.8 * k, dir > 0 ? 0.0 : 0.1, f), mix(0, 0.25, f), mix(1.2 * k, dir > 0 ? 0.1 : 0.2, f), mix(0, 0.4, f));
      PO.arm(P, 'L', mix(0.6 * k + 0.2, dir > 0 ? -0.2 : 0.4, f), mix(-0.2, 0.9, f), 0, mix(0.6, 0.3, f), 0.6);
      PO.arm(P, 'R', mix(0.4 * k + 0.2, dir > 0 ? 0.3 : 1.2, f), mix(-0.25, 0.6, f), 0, mix(0.5, 0.9, f), 0.2);
      PO.hand(P, 'L', 0.5, 0.3, 0.2 * lie); PO.hand(P, 'R', 0.6, 0.3, 0.1);
    }
    // rising out of the puddle: hands break the surface first, then it hauls itself up onto the floor
    function emergePose(P, e){
      const climb = sstep(0.35, 0.7, e), stand = sstep(0.68, 1, e);
      const y = e < 0.35 ? mix(-1.0, -0.35, sstep(0, 0.35, e)) : e < 0.7 ? mix(-0.35, 0.42, climb) : mix(0.42, 0.95, stand);
      P[PO.HP + 1] = y;
      P[PO.HP + 2] = mix(-0.25, 0, stand);
      const reachUp = 1 - climb;
      for (const [side, sg] of [['L', 1], ['R', -1]]){
        const wav = Math.sin(time * 3 + sg * 1.3) * 0.15 * reachUp;
        // up overhead, then down onto the floor in front, then back to the reach
        PO.arm(P, side, mix(mix(2.7 + wav, 0.75, climb), ind.reach, stand), mix(mix(0.15, -0.1, climb), -0.38, stand), 0, mix(mix(0.3, 0.1, climb), 0.35, stand), mix(0.3, 1.1, stand));
        PO.hand(P, side, mix(mix(0.7, 0.05, climb), 0.55, stand), 0.3, mix(0, -0.6 * climb, 1 - stand));
      }
      PO.set(P, 'spine', mix(mix(-0.1, 0.75, climb), ind.lean * 0.5, stand), 0, 0);
      PO.set(P, 'chest', mix(mix(-0.05, 0.4, climb), ind.lean * 0.5, stand), 0, 0);
      PO.set(P, 'neck', mix(mix(-0.4, -0.3, climb), 0.25 - ind.lean * 0.8, stand), 0, 0);
      PO.set(P, 'head', mix(-0.3, -0.15, stand), 0, ind.tilt * 0.5);
      PO.set(P, 'jaw', 0.25 + 0.2 * Math.sin(time * 2), 0, 0);
      const crouch = climb * (1 - stand);
      PO.leg(P, 'L', mix(0.1, 1.5, crouch), 0.05, mix(0.2, 2.1, crouch), mix(0.3, -0.5, crouch));
      PO.leg(P, 'R', mix(-0.1, 1.2, crouch), 0.05, mix(0.3, 1.9, crouch), mix(0.3, -0.4, crouch));
    }
    function update(dt, s = {}){
      dt = Math.min(dt || 0, 0.1);
      time += dt;
      const speed = s.speed || 0, attack = s.attack || 0, hurt = s.hurt || 0, dead = s.dead || 0;
      const emerge = s.emerge === undefined ? 1 : s.emerge;
      shamble(P, speed, dt);
      if (attack > 0){ Q.set(P); attackPose(Q, attack); PO.lerp(P, P, Q, sstep(0, 0.08, attack) * (1 - sstep(0.9, 1, attack))); }
      if (hurt > 0){   // flinch: snapped back, head thrown, arms flung up
        const h = Math.sin(Math.min(1, hurt) * Math.PI * 0.5);
        PO.add(P, 'spine', -0.35 * h, 0.15 * h, 0); PO.add(P, 'chest', -0.25 * h, 0, 0);
        PO.add(P, 'neck', -0.4 * h, 0, 0.2 * h); PO.add(P, 'head', -0.3 * h, 0.2 * h, 0);
        PO.add(P, 'armL', 0.6 * h, 0, 0.2 * h); PO.add(P, 'armR', 0.5 * h, 0, -0.25 * h);
        PO.add(P, 'jaw', 0.3 * h, 0, 0);
        P[PO.HP + 2] -= 0.06 * h;
      }
      if (emerge < 1){ Q.set(P); emergePose(Q, emerge); PO.lerp(P, P, Q, 1 - sstep(0.93, 1, emerge)); }
      if (dead > 0){ Q.set(P); deadPose(Q, dead); PO.lerp(P, P, Q, sstep(0, 0.12, dead)); }
      PO.apply(P, F.bones, F.hipsBone);
    }
    update(0, {});
    return { group: F.group, update, parts: F.parts, height: F.height, dispose: F.dispose };
  }

  // ---- prisoners ----
  function makePrisoner(seed = 1){
    const F = figure('prisoner', seed), r = F.r;
    const P = new Float32Array(PO.N), Q = new Float32Array(PO.N), from = new Float32Array(PO.N), out = new Float32Array(PO.N);
    let pose = null, blend = 1, time = r() * 100, ph = r() * TAU, gait = 0;
    const ind = { nerves: 0.6 + r() * 0.8, look: r() * 10, side: r() < 0.5 ? 1 : -1 };
    let eyeT = 0, eyeX = 0, eyeY = 0, eyeTX = 0, eyeTY = 0;
    function eyes(dt, P, look){
      eyeT -= dt;
      if (eyeT <= 0){ eyeT = 0.4 + r() * 1.6; eyeTX = (r() - 0.5) * 0.5 * look; eyeTY = (r() - 0.5) * 0.25 * look; }
      eyeX = mix(eyeX, eyeTX, 1 - Math.exp(-dt * 25)); eyeY = mix(eyeY, eyeTY, 1 - Math.exp(-dt * 25));
      PO.set(P, 'eyeL', eyeY, eyeX, 0); PO.set(P, 'eyeR', eyeY, eyeX, 0);
    }
    function sit(P){
      PO.rest(P);
      const tremble = Math.sin(time * 23) * 0.006 * ind.nerves, breath = Math.sin(time * 2.2) * 0.03;
      const lookUp = sstep(0.6, 0.9, Math.sin(time * 0.31 + ind.look)) * 0.5;
      P[PO.HP + 1] = 0.16; P[PO.HP + 2] = -0.42;
      PO.set(P, 'hips', -0.35, 0, 0);
      PO.set(P, 'spine', 0.4 + breath, 0, 0);
      PO.set(P, 'chest', 0.35 + breath + tremble, 0, 0);
      PO.set(P, 'neck', 0.35 - lookUp * 0.6, Math.sin(time * 0.4 + ind.look) * 0.15 * lookUp, 0);
      PO.set(P, 'head', 0.35 - lookUp * 0.5, Math.sin(time * 0.6) * 0.1 * lookUp, ind.side * 0.08);
      PO.set(P, 'jaw', 0.03, 0, 0);
      // knees drawn up, arms wrapped round them
      PO.leg(P, 'L', 1.55, 0.06, 2.35, -0.25);
      PO.leg(P, 'R', 1.45, 0.02, 2.25, -0.2);
      PO.arm(P, 'L', 0.75, -0.42, 0.0, 1.55 + tremble * 3, 0.9);
      PO.arm(P, 'R', 0.7, -0.4, 0.0, 1.6 - tremble * 3, 0.9);
      PO.hand(P, 'L', 0.7, 0.3, 0.3); PO.hand(P, 'R', 0.75, 0.3, 0.3);
    }
    function bars(P){
      PO.rest(P);
      const shake = Math.max(0, Math.sin(time * 1.3 + ind.look)) ** 6;
      const rattle = Math.sin(time * 18) * shake;
      const plead = Math.sin(time * 0.8 + ind.look);
      P[PO.HP + 1] = 0.95; P[PO.HP + 2] = -0.02 + rattle * 0.025;
      PO.set(P, 'hips', 0.05, 0, ind.side * 0.04);
      PO.set(P, 'spine', 0.12 + rattle * 0.05, plead * 0.05, 0);
      PO.set(P, 'chest', 0.08 + Math.sin(time * 2.6) * 0.02, 0, 0);
      PO.set(P, 'neck', -0.1, plead * 0.25, 0);
      PO.set(P, 'head', -0.12 + Math.sin(time * 1.7) * 0.05, plead * 0.15, -plead * 0.08);
      PO.set(P, 'jaw', 0.08 + Math.max(0, Math.sin(time * 4.1)) * 0.1, 0, 0);
      // hands on two bars at shoulder height, about 0.3 m in front
      PO.arm(P, 'L', 1.25 + rattle * 0.06, -0.38, 0.15, 1.2 - rattle * 0.15, 1.3);
      PO.arm(P, 'R', 1.3 - rattle * 0.06, -0.4, 0.15, 1.15 + rattle * 0.15, 1.3);
      PO.hand(P, 'L', 1.45, 1.0, -0.2); PO.hand(P, 'R', 1.45, 1.0, -0.2);
      PO.leg(P, 'L', 0.05, 0.02, 0.12 + (ind.side > 0 ? 0.15 : 0), 0);
      PO.leg(P, 'R', -0.05, 0.02, 0.12 + (ind.side < 0 ? 0.15 : 0), 0);
    }
    function cheer(P){
      PO.rest(P);
      const hop = Math.abs(Math.sin(time * 4.2)), wave = Math.sin(time * 7);
      P[PO.HP + 1] = 0.93 + hop * 0.06; P[PO.HP + 2] = 0;
      PO.set(P, 'spine', -0.08, 0, wave * 0.03);
      PO.set(P, 'chest', -0.1, Math.sin(time * 2) * 0.08, 0);
      PO.set(P, 'neck', -0.2, 0, Math.sin(time * 2.1) * 0.1);
      PO.set(P, 'head', -0.25, Math.sin(time * 1.3) * 0.2, 0);
      PO.set(P, 'jaw', 0.18 + Math.max(0, Math.sin(time * 5)) * 0.12, 0, 0);
      PO.arm(P, 'L', 2.75, 0.35 + wave * 0.15, 0.3, 0.25 + Math.max(0, wave) * 0.4, 0.4);
      PO.arm(P, 'R', 2.5 + Math.sin(time * 4.2) * 0.2, 0.45, 0.3, 0.6, 0.4);
      PO.hand(P, 'L', 0.08, 0.05, 0); PO.hand(P, 'R', 1.2, 0.8, 0);     // one waving, one fist
      PO.leg(P, 'L', 0.06 * hop, 0.03, 0.12 + 0.25 * (1 - hop), -0.1 * hop);
      PO.leg(P, 'R', 0.04 * hop, 0.03, 0.12 + 0.25 * (1 - hop), -0.1 * hop);
    }
    function walk(P, speed, dt){
      PO.rest(P);
      gait = mix(gait, clamp((speed - 1.6) / 1.4, 0, 1), 1 - Math.exp(-dt * 4));    // walk -> run
      const move = clamp(speed / 0.4, 0, 1);
      ph += dt * speed / (1.25 + 0.9 * gait) * TAU;
      const s = Math.sin(ph), c = Math.cos(ph);
      const amp = move * (0.32 + 0.3 * gait);
      PO.leg(P, 'L', s * amp + 0.15 * gait, 0, 0.1 + Math.max(0, -c) * (0.55 + 1.2 * gait) * move, -0.15 * s * move);
      PO.leg(P, 'R', -s * amp + 0.15 * gait, 0, 0.1 + Math.max(0, c) * (0.55 + 1.2 * gait) * move, 0.15 * s * move);
      P[PO.HP + 1] = 0.955 - 0.03 * gait + Math.abs(c) * (0.02 + 0.04 * gait) * move;
      PO.set(P, 'hips', 0.04 + 0.1 * gait, s * 0.1 * move, 0);
      PO.set(P, 'spine', 0.05 + 0.2 * gait, -s * 0.12 * move, 0);
      PO.set(P, 'chest', 0.04 + 0.1 * gait, -s * 0.1 * move, 0);
      PO.set(P, 'neck', -0.05, Math.sin(time * 0.9) * 0.25 * (1 - gait), 0);     // glancing back over the shoulder
      PO.set(P, 'head', -0.05 - 0.1 * gait, Math.sin(time * 0.9) * 0.2 * (1 - gait), 0);
      PO.set(P, 'jaw', 0.04 + 0.1 * gait, 0, 0);
      for (const [side, sg] of [['L', 1], ['R', -1]]){
        PO.arm(P, side, -sg * s * (0.35 + 0.5 * gait) * move + 0.1 * gait, -0.22, 0, 0.25 + 1.0 * gait + Math.max(0, sg * s) * 0.3 * move, 0.4);
        PO.hand(P, side, 0.35 + 0.6 * gait, 0.3, 0);
      }
    }
    function update(dt, s = {}){
      dt = Math.min(dt || 0, 0.1);
      time += dt;
      const p = s.pose || 'sit';
      if (p !== pose){ if (pose !== null){ from.set(out); blend = 0; } pose = p; }
      if (p === 'sit') sit(P); else if (p === 'bars') bars(P); else if (p === 'cheer') cheer(P); else walk(P, s.speed || 0, dt);
      eyes(dt, P, p === 'walk' ? 0.6 : 1);
      blend = Math.min(1, blend + dt / 0.45);
      PO.lerp(out, from, P, sstep(0, 1, blend));
      PO.apply(out, F.bones, F.hipsBone);
    }
    update(0, {});
    return { group: F.group, update, parts: F.parts, height: F.height, dispose: F.dispose };
  }

  const kit = { makeZombie, makePrisoner, buildTime: performance.now() - t0 };
  return kit;
}


