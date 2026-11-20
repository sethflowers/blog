// Realistic people: two rigged, textured models from three.js's examples (Michelle, from Mixamo, and a
// Ready Player Me man; see _plans/msb.md), with walk, idle, nod and head-shake animations retargeted
// onto them ahead of time (_tools/msb/people.mjs → models/clips.json). Each person in the pool is a
// copy (shared shapes) wearing one of several outfits: the clothes' textures are recoloured once at
// start (only the clothing's colours are touched, so faces and shirts stay as they are), and skin
// tones vary. If the models can't load, visitors.js falls back to its own simple people.
import * as THREE from 'three';
import { GLTFLoader } from '/experiments/msb/lib/addons/GLTFLoader.js';
import { clone as cloneSkinned } from '/experiments/msb/lib/addons/SkeletonUtils.js';

const BASE = '/experiments/msb/models/';
const V = () => document.body.dataset.version || '0';

// ---------- recolouring a texture ----------
function rgb2hsl(r, g, b){
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (d < 1e-6) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hsl2rgb(h, s, l){
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}
const hueNear = (h, c, w) => { const d = Math.abs(((h - c + 540) % 360) - 180); return Math.max(0, 1 - d / w); };
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// rules: [{ w(h, s, l) → 0..1, h, s, l (multiplier of the lightness) }]
function recolor(tex, rules, size = 512){
  const img = tex.image, c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, size, size);
  const id = g.getImageData(0, 0, size, size), d = id.data;
  for (let i = 0; i < d.length; i += 4){
    const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255, [h, s, l] = rgb2hsl(r, gg, b);
    for (const R of rules){
      const w = R.w(h, s, l); if (w <= 0.01) continue;
      const [nr, ng, nb] = hsl2rgb(R.h, Math.min(1, R.s), Math.min(0.95, l * R.l));
      d[i] = (r + (nr - r) * w) * 255; d[i + 1] = (gg + (ng - gg) * w) * 255; d[i + 2] = (b + (nb - b) * w) * 255;
      break;
    }
  }
  g.putImageData(id, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.flipY = tex.flipY; t.colorSpace = THREE.SRGBColorSpace; t.wrapS = tex.wrapS; t.wrapT = tex.wrapT; t.anisotropy = 4;
  return t;
}
// which pixels are clothing
const PINK = (h, s, l) => hueNear(h, 12, 28) * smooth(0.1, 0.18, s) * (1 - smooth(0.55, 0.7, s)) * smooth(0.3, 0.42, l);      // the man's suit (pink in the original)
const PURPLE = (h, s, l) => hueNear(h, 315, 35) * smooth(0.12, 0.2, s) * smooth(0.15, 0.25, l);                              // his waistcoat and bow tie
const HATGREEN = (h, s, l) => hueNear(h, 72, 30) * smooth(0.1, 0.16, s);                                                      // his hat
const YELLOW = (h, s, l) => hueNear(h, 50, 22) * smooth(0.55, 0.75, s) * smooth(0.35, 0.5, l);                                // Michelle's trousers
// outfits: suit, waistcoat, hat, trousers, skin (a multiplier of the original skin)
const MAN = [
  { suit: [218, 0.38, 0.62], vest: [0, 0.02, 0.9], hat: [0, 0, 0.9], legs: null, skin: '#ffffff' },
  { suit: [220, 0.04, 0.5], vest: [350, 0.45, 1.0], hat: [0, 0, 0.5], legs: null, skin: '#c8987a' },
  { suit: [34, 0.28, 1.0], vest: [85, 0.3, 1.0], hat: [26, 0.4, 1.4], legs: [215, 0.4, 0.62], skin: '#8a5c44' },
  { suit: [145, 0.22, 0.7], vest: [44, 0.55, 1.4], hat: [0, 0, 1.0], legs: null, skin: '#f2dcc8' },
  { suit: null, vest: null, hat: [20, 0.35, 0.9], legs: null, skin: '#a8724e' },
  { suit: [24, 0.34, 0.66], vest: [214, 0.4, 1.0], hat: [0, 0, 0.45], legs: [0, 0.02, 0.42], skin: '#ffffff' },
];
const WOMAN = [{ legs: [214, 0.45, 0.62] }, { legs: [0, 0.03, 0.32] }, { legs: [78, 0.32, 0.6] }, { legs: [354, 0.62, 0.72] }];

export async function loadPeople(){
  const L = new GLTFLoader();
  const [mi, rp, clipsJson] = await Promise.all([
    L.loadAsync(BASE + 'Michelle.glb?v=' + V()), L.loadAsync(BASE + 'readyplayer.me.glb?v=' + V()),
    fetch(BASE + 'clips.json?v=' + V()).then((r) => { if (!r.ok) throw new Error('clips.json'); return r.json(); }),
  ]);
  const clips = (name) => Object.fromEntries(clipsJson[name].map((j) => { const c = THREE.AnimationClip.parse(j); return [c.name, c]; }));
  const kinds = [];
  // the man: each outfit gets its own materials (recoloured textures), shared by everyone wearing it
  const rpClips = clips('readyplayer.me');
  for (const O of MAN){
    const mats = {};
    rp.scene.traverse((o) => {
      if (!o.isMesh || mats[o.material.name]) return;
      const m = o.material.clone(), n = m.name;
      if (n === 'Wolf3D_Outfit_Top' && O.suit) m.map = recolor(m.map, [{ w: PINK, h: O.suit[0], s: O.suit[1], l: O.suit[2] }, ...(O.vest ? [{ w: PURPLE, h: O.vest[0], s: O.vest[1], l: O.vest[2] }] : [])], 512);
      if (n === 'Wolf3D_Outfit_Bottom' && (O.legs || O.suit)){ const c = O.legs || O.suit; m.map = recolor(m.map, [{ w: PINK, h: c[0], s: c[1], l: c[2] }], 512); }
      if (n === 'Wolf3D_Headwear' && O.hat) m.map = recolor(m.map, [{ w: HATGREEN, h: O.hat[0], s: O.hat[1], l: O.hat[2] }], 512);
      if (n === 'Wolf3D_Skin' || n === 'Wolf3D_Body') m.color.set(O.skin);
      mats[n] = m;
    });
    kinds.push({ scene: rp.scene, mats, clips: rpClips, height: 1.78, female: false });
  }
  const miClips = clips('Michelle');
  for (const O of WOMAN){
    const mats = {};
    mi.scene.traverse((o) => { if (!o.isMesh || mats[o.material.name]) return; const m = o.material.clone(); m.map = recolor(m.map, [{ w: YELLOW, h: O.legs[0], s: O.legs[1], l: O.legs[2] }], 512); mats[m.name] = m; });
    kinds.push({ scene: mi.scene, mats, clips: miClips, height: 1.66, female: true });
  }
  return kinds;
}

// a person: a copy of the model in an outfit, its animation mixer and actions
export function makePerson(kind, height){
  const model = cloneSkinned(kind.scene);
  let head = null;
  model.traverse((o) => {
    if (o.isMesh){ o.material = kind.mats[o.material.name] || o.material; o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
    if (o.isBone && /Head$/.test(o.name) && !head) head = o;
  });
  // stand it on the ground, the right height, facing +z
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model), s = height / Math.max(0.5, box.max.y - box.min.y);
  model.scale.multiplyScalar(s); model.position.y = -box.min.y * s;
  const mixer = new THREE.AnimationMixer(model);
  const act = {};
  for (const [n, c] of Object.entries(kind.clips)){ act[n] = mixer.clipAction(c); }
  for (const n of ['agree', 'headShake']){ if (act[n]){ act[n].setLoop(THREE.LoopOnce, 1); act[n].clampWhenFinished = false; } }
  act.idle.play(); act.walk.play(); act.walk.setEffectiveWeight(0);
  return { model, mixer, act, head, gesture: null };
}
