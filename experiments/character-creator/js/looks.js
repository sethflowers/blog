// How the character is drawn: the materials for the skin, eyes, brows, lashes, hair, teeth and
// clothes, in four styles:
//   real  physically based: photographed skin with pores (a tiled normal map), a reddish sheen where
//         light grazes the skin (standing in for light scattering under it), wet glossy eyes, soft
//         alpha-blended hair, brows and lashes, fabric with its weave
//   soft  "animated film": the same, but the skin's texture is blurred smooth and a little warmer
//   toon  flat bands of light and dark outlines
//   clay  everything one matte clay colour, to see the shapes
// Textures are loaded once and shared; materials are made once per style and recoloured.
import * as THREE from 'three';
import { dataURL } from './mh.js';
import { hexToRgb, clamp } from './util.js';

const loader = new THREE.TextureLoader();
const texCache = new Map();
export function loadTex(file, srgb = true){
  const key = file + (srgb ? '' : ':lin');
  if (!texCache.has(key)) texCache.set(key, new Promise((res) => {
    loader.load(dataURL('tex/' + file), (t) => { if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; res(t); }, undefined, () => res(null));
  }));
  return texCache.get(key);
}
export const texturesLoaded = () => texCache.size;

// sRGB hex -> linear rgb
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const linHex = (hex) => hexToRgb(hex).map(lin);

// ---------- the tiled pore map (made once) ----------
let poreTex = null;
function pores(){
  if (poreTex) return poreTex;
  const S = 256, h = new Float32Array(S * S);
  let seed = 7; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < S * S; i++) h[i] = r() * 0.15;
  // pits
  for (let n = 0; n < 900; n++){
    const cx = r() * S, cy = r() * S, rad = 0.8 + r() * 1.6, d = 0.6 + r() * 0.6;
    for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++){
      const q = (x * x + y * y) / (rad * rad); if (q > 1) continue;
      const ix = ((Math.floor(cx) + x) % S + S) % S, iy = ((Math.floor(cy) + y) % S + S) % S;
      h[iy * S + ix] -= d * (1 - q);
    }
  }
  // fine lines
  for (let n = 0; n < 160; n++){
    let x = r() * S, y = r() * S; const a = r() * Math.PI, len = 6 + r() * 14;
    for (let t = 0; t < len; t++){ const ix = ((Math.floor(x) % S) + S) % S, iy = ((Math.floor(y) % S) + S) % S; h[iy * S + ix] -= 0.35; x += Math.cos(a); y += Math.sin(a); }
  }
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++){
    const H = (xx, yy) => h[((yy + S) % S) * S + ((xx + S) % S)];
    const dx = (H(x + 1, y) - H(x - 1, y)) * 1.2, dy = (H(x, y + 1) - H(x, y - 1)) * 1.2;
    const l = Math.hypot(dx, dy, 1), i = (y * S + x) * 4;
    data[i] = (-dx / l * 0.5 + 0.5) * 255; data[i + 1] = (-dy / l * 0.5 + 0.5) * 255; data[i + 2] = (1 / l * 0.5 + 0.5) * 255; data[i + 3] = 255;
  }
  poreTex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  poreTex.wrapS = poreTex.wrapT = THREE.RepeatWrapping; poreTex.repeat.set(48, 48);
  poreTex.generateMipmaps = true; poreTex.minFilter = THREE.LinearMipmapLinearFilter; poreTex.magFilter = THREE.LinearFilter;
  poreTex.needsUpdate = true;
  return poreTex;
}
// a 3-band light ramp for toon shading
let toonRamp = null;
function ramp(){
  if (toonRamp) return toonRamp;
  toonRamp = new THREE.DataTexture(new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
  toonRamp.minFilter = toonRamp.magFilter = THREE.NearestFilter; toonRamp.generateMipmaps = false; toonRamp.needsUpdate = true;
  return toonRamp;
}
// shader tweaks, combined: blur the colour texture (a mipmap bias, for the smoother animated and toon
// looks) and/or light the skin as if light scattered inside it: the light wraps softly past the edge
// of the lit side, red first (as in real skin), instead of stopping hard
const SSS_CHUNK = THREE.ShaderChunk.lights_physical_pars_fragment.replace(
  'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );',
  `float nlw = dot( geometryNormal, directLight.direction );
  vec3 wrapIrr = vec3( saturate( ( nlw + 0.45 ) / 1.45 ), saturate( ( nlw + 0.2 ) / 1.2 ), saturate( ( nlw + 0.14 ) / 1.14 ) );
  wrapIrr = wrapIrr * wrapIrr * ( 3.0 - 2.0 * wrapIrr ) * 0.35 + wrapIrr * 0.65;
  reflectedLight.directDiffuse += wrapIrr * directLight.color * BRDF_Lambert( material.diffuseColor );`);
function patch(m, { blur = 0, sss = false } = {}){
  m.onBeforeCompile = (sh) => {
    if (blur) sh.fragmentShader = sh.fragmentShader.replace('texture2D( map, vMapUv )', `texture( map, vMapUv, ${blur.toFixed(1)} )`);
    if (sss) sh.fragmentShader = sh.fragmentShader.replace('#include <lights_physical_pars_fragment>', SSS_CHUNK);
  };
  m.customProgramCacheKey = () => `p${blur}${sss}`;
}
const blurMap = (m, bias) => patch(m, { blur: bias });
// toon outlines: a copy of the mesh drawn inside out, pushed out along its normals (in the shader,
// before skinning, so it bends with the skeleton)
export function outlineMaterial(width){
  const m = new THREE.MeshBasicMaterial({ color: 0x15100e, side: THREE.BackSide });
  m.userData.olw = { value: width };
  m.onBeforeCompile = (sh) => { sh.uniforms.olw = m.userData.olw; sh.vertexShader = 'uniform float olw;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n{ vec4 owp = modelMatrix * vec4( transformed, 1.0 ); transformed += normalize( objectNormal ) * olw * distance( owp.xyz, cameraPosition ); }'); m.userData.sh = sh; };
  m.customProgramCacheKey = () => 'outline';
  m.userData.width = width;
  return m;
}

const CLAY = '#c8a68c';
export class Looks {
  constructor(){ this.mats = new Map(); this.style = null; }
  mat(key, make){
    if (!this.mats.has(key)) this.mats.set(key, make());
    return this.mats.get(key);
  }
  // the materials for this character's look (async: the first time a texture is needed it's fetched)
  async apply(human, spec, manifest){
    const style = spec.style.render, real = style === 'real', soft = style === 'soft', toon = style === 'toon', clay = style === 'clay';
    if (this.style !== style){ for (const m of this.mats.values()) m.dispose(); this.mats.clear(); this.style = style; }
    const skinDef = pickSkin(spec, manifest);
    const [skinMap] = await Promise.all([loadTex(skinDef.tex)]);
    // the skin's tone: the chosen colour over the photo's own average (so its detail stays)
    const mean = skinDef.mean.map(lin);
    // the tone: chosen, or (auto) the photos' own colours blended by ancestry
    const tone = spec.skin.tone === 'auto' ? blendedTone(spec, manifest) : linHex(spec.skin.tone);
    const toneMul = tone.map((t, i) => clamp(t / Math.max(mean[i], 0.01), 0.05, 3));
    const skin = this.mat('skin', () => {
      if (clay) return new THREE.MeshStandardMaterial({ color: CLAY, roughness: 0.85 });
      if (toon){ const m = new THREE.MeshToonMaterial({ gradientMap: ramp() }); blurMap(m, 3.5); return m; }
      const m = new THREE.MeshPhysicalMaterial({ sheenColor: new THREE.Color(0.85, 0.32, 0.25), sheenRoughness: 0.45, specularIntensity: 0.5 });
      patch(m, { blur: soft ? 3.0 : 0, sss: true });
      return m;
    });
    skin.vertexColors = real || soft;   // the cavity shading
    if (!clay){
      skin.map = skinMap;
      skin.color.setRGB(...toneMul);
      if (soft) skin.color.multiplyScalar(1.04);
    }
    if (real){
      skin.normalMap = pores(); skin.normalScale.setScalar(0.12 + 0.45 * spec.skin.pores);
      skin.roughness = 0.72 - 0.32 * spec.skin.shine; skin.sheen = 0.3;
    } else if (soft){ skin.roughness = 0.55 - 0.2 * spec.skin.shine; skin.sheen = 0.5; skin.normalMap = null; }
    skin.needsUpdate = true;
    human.body.material = skin;
    // the parts
    const hairCol = linHex(spec.hair.color), browCol = linHex(spec.brows.color);
    for (const [id, part] of human.parts){
      if (!part.mesh.visible) continue;
      const d = part.def, k = d.kind;
      const tex = d.tex.map ? await loadTex(d.tex.map) : null;
      let m;
      if (k === 'eyes'){
        const eye = manifest.eyes.find((e) => e.id === spec.eyes.color) || manifest.eyes[0];
        const map = await loadTex(eye.tex);
        m = this.mat('eyes', () => (toon ? new THREE.MeshToonMaterial({ gradientMap: ramp() }) : new THREE.MeshPhysicalMaterial({ roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.02 })));
        m.map = map; m.alphaTest = 0.5; m.color.set(clay ? '#f0f0f0' : '#ffffff'); if ('envMapIntensity' in m) m.envMapIntensity = 2.2;
      } else if (k === 'brows' || k === 'lashes'){
        m = this.mat(k + id, () => {
          const mm = clay ? new THREE.MeshStandardMaterial() : toon ? new THREE.MeshToonMaterial({ gradientMap: ramp() }) : new THREE.MeshStandardMaterial({ roughness: 0.8 });
          mm.transparent = true; mm.depthWrite = false; mm.side = THREE.DoubleSide; mm.alphaTest = 0.02;
          return mm;
        });
        m.map = tex;
        const c = clay ? linHex('#6a5040') : k === 'lashes' ? linHex('#1a1410').map((v, i) => v * 0.5 + browCol[i] * 0.2) : browCol;
        m.color.setRGB(...c.map((v) => v / (d.gray || 0.3)));
        part.mesh.renderOrder = 5;
      } else if (k === 'hair'){
        m = this.mat('hair' + id, () => {
          const mm = clay ? new THREE.MeshStandardMaterial({ roughness: 0.8 }) : toon ? new THREE.MeshToonMaterial({ gradientMap: ramp() })
            : new THREE.MeshPhysicalMaterial({ roughness: 0.5, sheen: 0.25, sheenRoughness: 0.4, specularIntensity: 0.45, anisotropy: 0.85, anisotropyRotation: Math.PI / 2 });
          mm.side = THREE.DoubleSide; mm.alphaTest = 0.5; mm.alphaToCoverage = true;
          return mm;
        });
        m.map = tex;
        const hc = clay ? linHex(CLAY) : hairCol;
        m.color.setRGB(...hc.map((v) => v / (d.gray || 0.3)));
        if (m.sheenColor){ m.sheen = 0.35; m.sheenColor.setRGB(...hc.map((v) => Math.min(1, v * 1.5 + 0.04))); }
        m.normalMap = null;   // (some styles' normal maps made the strands look like chrome)
        // and a soft blended layer for the wispy ends
        softLayer(part, m, this.mat('hairsoft' + id, () => { const mm = m.clone(); mm.alphaToCoverage = false; mm.alphaTest = 0.04; mm.transparent = true; mm.depthWrite = false; return mm; }));
      } else {
        const fabric = k === 'outfit' || k === 'hat' || k === 'shoes';
        m = this.mat('p' + id, () => {
          if (clay) return new THREE.MeshStandardMaterial({ color: CLAY, roughness: 0.85 });
          if (toon){ const mm = new THREE.MeshToonMaterial({ gradientMap: ramp() }); blurMap(mm, 1.5); return mm; }
          return new THREE.MeshPhysicalMaterial({ roughness: k === 'teeth' ? 0.3 : fabric ? 0.85 : 0.5, sheen: fabric ? 0.4 : 0, sheenRoughness: 0.8, sheenColor: new THREE.Color(1, 1, 1) });
        });
        if (!clay){
          m.map = tex;
          if (d.tex.normal && real){ m.normalMap = await loadTex(d.tex.normal, false); }
          if (d.tex.ao && !toon){ const ao = await loadTex(d.tex.ao, false); ao.channel = 0; m.aoMap = ao; m.aoMapIntensity = 0.8; }
          const tint = k === 'outfit' ? spec.outfit.tint : k === 'shoes' ? spec.outfit.shoeTint : k === 'hat' ? spec.outfit.hatTint : null;
          if (tint && tint !== 'none') m.color.setRGB(...linHex(tint).map((v) => Math.min(1.6, 0.25 + v * 1.6))); else m.color.set('#ffffff');
        }
        if (d.alpha){ m.alphaTest = 0.5; m.side = THREE.DoubleSide; }
      }
      m.needsUpdate = true;
      part.mesh.material = m;
    }
    // let go of textures nobody wears any more (a 2048 px skin is 16 MB on the graphics card)
    const used = new Set();
    for (const m of [human.body.material, ...human.allMeshes().map((x) => x.material)]) for (const k of ['map', 'normalMap', 'aoMap']) if (m && m[k]) used.add(m[k]);
    for (const [key, pr] of texCache){ const t = await pr; if (t && !used.has(t) && t !== poreTex){ t.dispose(); texCache.delete(key); } }
    // toon outlines
    human.setOutlines(toon ? 0.0012 + 0.0035 * spec.style.outline : 0, () => this.mat('outline', () => outlineMaterial(0.003)));
  }
  dispose(){ for (const m of this.mats.values()) m.dispose(); this.mats.clear(); }
}
// hair is drawn twice: solid where it's thick (so it sorts itself), then blended at the ends
function softLayer(part, solid, soft){
  if (!part.soft){
    part.soft = new THREE.SkinnedMesh(part.geo, soft);
    part.soft.frustumCulled = false; part.soft.renderOrder = 8;
    part.mesh.parent.add(part.soft);
    part.soft.bindMode = 'attached';
    part.soft.bind(part.mesh.skeleton, new THREE.Matrix4());
  }
  part.soft.material = soft;
  soft.map = solid.map; soft.normalMap = solid.normalMap; soft.color.copy(solid.color); if (soft.sheenColor && solid.sheenColor) soft.sheenColor.copy(solid.sheenColor);
  soft.alphaTest = 0.04; soft.transparent = true; soft.depthWrite = false;
}

// the photographed skin closest to this person (age, gender, ethnicity), unless one was chosen
const skinAge = (y) => (y < 36 ? 'young' : y < 60 ? 'middleage' : 'old');   // (years)
function skinFor(skins, eth, age, gender){ return skins.find((s) => s.ethnic === eth && s.age === age && s.gender === gender) || skins.find((s) => s.ethnic === eth) || skins[0]; }
export function pickSkin(spec, manifest){
  const skins = manifest.skins;
  if (spec.skin.texture && spec.skin.texture !== 'auto'){ const s = skins.find((x) => x.id === spec.skin.texture); if (s) return s; }
  const m = spec.macro;
  // the strongest ancestry's photo (an even mix counts as European, whose photos are the most neutral)
  const eth = m.african > m.caucasian + 0.01 && m.african >= m.asian ? 'african' : m.asian > m.caucasian + 0.01 ? 'asian' : 'caucasian';
  return skinFor(skins, eth, skinAge(m.age), m.gender < 0.5 ? 'female' : 'male');
}
function blendedTone(spec, manifest){
  const m = spec.macro, sum = (m.african + m.asian + m.caucasian) || 1, out = [0, 0, 0];
  for (const e of ['african', 'asian', 'caucasian']){
    const s = skinFor(manifest.skins, e, skinAge(m.age), m.gender < 0.5 ? 'female' : 'male');
    s.mean.map(lin).forEach((v, i) => { out[i] += v * m[e] / sum; });
  }
  return out;
}
