// What a character is: a plain object (the "spec") that's saved as JSON, the list of every control
// the designer shows for it, presets, random people from a seed number, character codes, upgrading
// old saves.
//
// The controls: a fixed list (style, the body's big dials, skin, eyes, hair, clothes, expression)
// followed by every one of MakeHuman's modelling sliders (data/manifest.json), in its order.
// initControls(manifest) must be called once the manifest has loaded.
//
// Character codes and seeds depend on the order of the controls, on randomize() and on the presets:
// only ever add to the ends of those lists, never reorder or remove, or old codes change meaning.
import { rng, clamp } from './util.js';

export const SPEC_VERSION = 2;

export const PALETTES = {
  skin: ['#f8dccb', '#f1c7aa', '#e5b293', '#d6a07c', '#c48b63', '#ad744e', '#94603e', '#7a4c30', '#613a24', '#47291a',
    '#9fd07c', '#7fb4e6', '#c9a3ea', '#e9e6e0', '#e8703a'],
  hair: ['#0e0b09', '#24170f', '#3d2616', '#5c3a1f', '#7f532d', '#a87b4b', '#cfa86c', '#e6cf9c', '#8e3420', '#b9572a',
    '#7d7a76', '#d9d6d0', '#2f5fd8', '#e0479a', '#35b87a', '#8f45dd'],
  tint: ['none', '#f4f2ee', '#1c1c1e', '#6b6e74', '#24365c', '#3f6fb5', '#8fbde8', '#2f6b3a', '#7fb069', '#b3332e', '#e8623a',
    '#f2c14e', '#f4a6b8', '#7a4fa0', '#7a5134', '#c9b08a'],
};
export const EYE_COLOURS = { brown: '#5a3418', brownlight: '#8a5a2a', green: '#4f7a3a', bluegreen: '#4a8a8a', blue: '#3f73b0',
  deepblue: '#24488a', lightblue: '#78a7d6', ice: '#b8d4e8', grey: '#8a8e92' };
const EYE_LABEL = { brown: 'Brown', brownlight: 'Hazel', green: 'Green', bluegreen: 'Blue-green', blue: 'Blue', deepblue: 'Deep blue', lightblue: 'Light blue', ice: 'Ice', grey: 'Grey' };

export const CATEGORIES = [
  { id: 'presets', label: 'Start', icon: '✨', frame: 'body' },
  { id: 'saved', label: 'Saved', icon: '📁', frame: 'head' },
  { id: 'body', label: 'Body', icon: '🧍', frame: 'body' },
  { id: 'shape', label: 'Shape', icon: '📏', frame: 'body' },
  { id: 'face', label: 'Face', icon: '🙂', frame: 'face' },
  { id: 'eyes', label: 'Eyes', icon: '👁', frame: 'eyes' },
  { id: 'nose', label: 'Nose', icon: '👃', frame: 'face' },
  { id: 'mouth', label: 'Mouth', icon: '👄', frame: 'face' },
  { id: 'ears', label: 'Ears', icon: '👂', frame: 'face' },
  { id: 'skin', label: 'Skin', icon: '✋', frame: 'face' },
  { id: 'hair', label: 'Hair', icon: '💇', frame: 'head' },
  { id: 'clothes', label: 'Clothes', icon: '👕', frame: 'body' },
  { id: 'style', label: 'Style', icon: '🎨', frame: 'body' },
];

const S = (key, label, cat, opts = {}) => ({ type: 'slider', key, label, cat, min: -1, max: 1, def: 0, ...opts });
const C = (key, label, cat, palette, def, opts = {}) => ({ type: 'color', key, label, cat, palette, def, ...opts });
const H = (key, label, cat, options, def, opts = {}) => ({ type: 'choice', key, label, cat, options, def, ...opts });
const o = (value, label, extra) => ({ value, label, ...extra });

// the fixed controls (part: what changes: 'shape' the mesh, 'parts' what's worn, 'look' only materials)
const FIXED = [
  H('style.render', 'Drawn as', 'style', [o('real', 'Realistic'), o('soft', 'Animated'), o('toon', 'Toon'), o('clay', 'Clay')], 'real', { part: 'look' }),
  S('style.cartoon', 'Realistic ↔ Cartoon', 'style', { min: 0, max: 1, def: 0, part: 'shape', hint: 'Bigger head and eyes, smaller nose and mouth' }),
  S('style.outline', 'Toon outline', 'style', { min: 0, max: 1, def: 0.5, part: 'look', only: (s) => s.style.render === 'toon' }),
  S('macro.gender', 'Female ↔ Male', 'body', { min: 0, max: 1, def: 0.5, part: 'shape' }),
  S('macro.age', 'Age', 'body', { min: 11, max: 90, def: 25, step: 1, unit: 'years', part: 'shape' }),
  S('macro.height', 'Height', 'body', { min: 0, max: 1, def: 0.5, part: 'shape', show: 'height' }),
  S('macro.weight', 'Weight', 'body', { min: 0, max: 1, def: 0.5, part: 'shape' }),
  S('macro.muscle', 'Muscle', 'body', { min: 0, max: 1, def: 0.5, part: 'shape' }),
  S('macro.proportions', 'Proportions', 'body', { min: 0, max: 1, def: 0.5, part: 'shape', hint: 'Unusual ↔ ideal' }),
  S('macro.african', 'African', 'body', { min: 0, max: 1, def: 1 / 3, part: 'shape', group: 'Ancestry' }),
  S('macro.asian', 'Asian', 'body', { min: 0, max: 1, def: 1 / 3, part: 'shape', group: 'Ancestry' }),
  S('macro.caucasian', 'European', 'body', { min: 0, max: 1, def: 1 / 3, part: 'shape', group: 'Ancestry' }),
  S('macro.cup', 'Bust', 'body', { min: 0, max: 1, def: 0.5, part: 'shape', group: 'Bust' }),
  S('macro.firmness', 'Bust firmness', 'body', { min: 0, max: 1, def: 0.5, part: 'shape', group: 'Bust' }),
  H('skin.texture', 'Skin', 'skin', [o('auto', 'Matches age and ancestry')], 'auto', { part: 'look', dynamic: 'skins' }),
  C('skin.tone', 'Skin tone', 'skin', ['auto', ...PALETTES.skin], 'auto', { part: 'look' }),
  S('skin.shine', 'Shine', 'skin', { min: 0, max: 1, def: 0.3, part: 'look' }),
  S('skin.pores', 'Skin detail', 'skin', { min: 0, max: 1, def: 0.5, part: 'look', hint: 'Pores, close up (Realistic)' }),
  H('eyes.color', 'Eye colour', 'eyes', Object.entries(EYE_COLOURS).map(([k, c]) => o(k, EYE_LABEL[k], { swatch: c })), 'brown', { part: 'look' }),
  H('brows.style', 'Eyebrows', 'eyes', [o('none', 'None')], 'eyebrow001', { part: 'parts', dynamic: 'brows', grid: true }),
  C('brows.color', 'Eyebrow colour', 'eyes', PALETTES.hair, '#3d2616', { part: 'look' }),
  H('lashes.style', 'Eyelashes', 'eyes', [o('none', 'None')], 'eyelashes01', { part: 'parts', dynamic: 'lashes' }),
  H('hair.style', 'Hair', 'hair', [o('none', 'Bald')], 'short02', { part: 'parts', dynamic: 'hair', grid: true }),
  C('hair.color', 'Hair colour', 'hair', PALETTES.hair, '#3d2616', { part: 'look' }),
  H('outfit.outfit', 'Outfit', 'clothes', [], 'male_casualsuit03', { part: 'parts', dynamic: 'outfit', grid: true }),
  C('outfit.tint', 'Outfit colour', 'clothes', PALETTES.tint, 'none', { part: 'look' }),
  H('outfit.shoes', 'Shoes', 'clothes', [o('none', 'Bare feet')], 'shoes04', { part: 'parts', dynamic: 'shoes', grid: true }),
  C('outfit.shoeTint', 'Shoe colour', 'clothes', PALETTES.tint, 'none', { part: 'look' }),
  H('outfit.hat', 'Hat', 'clothes', [o('none', 'None')], 'none', { part: 'parts', dynamic: 'hat' }),
  C('outfit.hatTint', 'Hat colour', 'clothes', PALETTES.tint, 'none', { part: 'look' }),
  S('expr.mouth-corner-puller', 'Smile', 'mouth', { min: 0, max: 1, def: 0, part: 'shape', group: 'Expression' }),
  S('expr.mouth-open', 'Mouth open', 'mouth', { min: 0, max: 1, def: 0, part: 'shape', group: 'Expression' }),
  S('expr.eyebrows-up', 'Eyebrows raised', 'eyes', { min: 0, max: 1, def: 0, part: 'shape', group: 'Expression' }),
  S('expr.eyebrows-down', 'Frown', 'eyes', { min: 0, max: 1, def: 0, part: 'shape', group: 'Expression' }),
  S('expr.eye-slit', 'Squint', 'eyes', { min: 0, max: 1, def: 0, part: 'shape', group: 'Expression' }),
];
// which tab MakeHuman's slider groups go in
const GROUP_CAT = { 'head shape': 'face', 'head size': 'face', forehead: 'face', neck: 'shape', eye: 'eyes', eyebrows: 'eyes',
  'nose size': 'nose', 'nose size details': 'nose', 'nose features': 'nose', 'mouth size': 'mouth', 'mouth size details': 'mouth',
  'mouth features': 'mouth', ear: 'ears', 'chin/jaw': 'face', cheek: 'face' };
const GROUP_LABEL = { 'head shape': 'Head shape', 'head size': 'Head size', forehead: 'Forehead', neck: 'Neck', eye: 'Eye shape', eyebrows: 'Brow shape',
  'nose size': 'Nose size', 'nose size details': 'Nose details', 'nose features': 'Nose shape', 'mouth size': 'Mouth size',
  'mouth size details': 'Lips', 'mouth features': 'Mouth shape', ear: 'Ears', 'chin/jaw': 'Chin and jaw', cheek: 'Cheeks' };

export let CONTROLS = FIXED.slice();
export let CONTROL = Object.fromEntries(CONTROLS.map((c) => [c.key, c]));
export function initControls(manifest, assets){
  const byKind = (k) => assets.filter((a) => a.kind === k);
  CONTROLS = FIXED.map((c) => {
    if (!c.dynamic) return c;
    const extra = c.dynamic === 'skins' ? manifest.skins.map((s) => o(s.id, skinLabel(s.id))) : byKind(c.dynamic).map((a) => o(a.id, a.label));
    return { ...c, options: [...c.options, ...extra] };
  });
  for (const s of manifest.sliders){
    const cat = s.tab === 'Face' ? GROUP_CAT[s.group] || 'face' : 'shape';
    const group = s.tab === 'Face' ? GROUP_LABEL[s.group] || s.group : s.group.replace(/^Measure /, '');
    const two = s.targets.length === 2;
    CONTROLS.push({ type: 'slider', key: 'mods.' + s.name, label: tidy(s.label), cat, group, min: two ? -1 : 0, max: 1, def: 0, part: 'shape', mod: true });
  }
  CONTROL = Object.fromEntries(CONTROLS.map((c) => [c.key, c]));
  presetCache = null;
}
// MakeHuman's own words, made plainer
function tidy(l){
  const t = l.replace(/\.$/, '').replace(/\bvert\b\.?/g, 'up/down').replace(/\bhoriz\b\.?/g, 'sideways').replace('distorsion', 'shape').replace('Cranic', 'Skull');
  const m = { 'Scale horizontally': 'Width', 'Scale vertically': 'Height', 'Scale depth': 'Depth', 'Move horizontally': 'Move sideways', 'Move vertically': 'Move up/down', 'Move depth': 'Move forward/back', 'Scale eye': 'Eye size' };
  return m[t] || t.replace(/^Scale /, 'Size: ').replace(/^Move /, 'Move ');
}
function skinLabel(id){
  const [age, eth, g, n] = id.split('_');
  const A = { young: 'Young', middleage: 'Middle-aged', old: 'Older' }[age], E = { african: 'African', asian: 'Asian', caucasian: 'European' }[eth];
  return `${A} ${E} ${g.startsWith('female') ? 'woman' : 'man'}${/\d/.test(g + (n || '')) ? ' 2' : ''}`;
}

export function get(spec, key){ const i = key.indexOf('.'), g = key.slice(0, i), k = key.slice(i + 1); return spec[g] ? spec[g][k] : undefined; }
export function set(spec, key, v){ const i = key.indexOf('.'), g = key.slice(0, i), k = key.slice(i + 1); (spec[g] = spec[g] || {})[k] = v; }

export function defaults(){
  const s = { v: SPEC_VERSION, name: '', seed: 0, mods: {}, expr: {} };
  for (const c of CONTROLS) if (!c.mod) set(s, c.key, c.def);
  return s;
}
export const clone = (s) => JSON.parse(JSON.stringify(s));

// ---------- the numbers MakeHuman wants ----------
export const yearsToAge = (y) => (y < 25 ? (y - 1) / 24 * 0.5 : 0.5 + (y - 25) / 65 * 0.5);
export function shapeOf(spec){
  const m = spec.macro, c = spec.style.cartoon || 0;
  // (MakeHuman's own height extremes are giants and dwarfs: the slider covers three quarters of them)
  const macro = { ...m, age: yearsToAge(m.age), height: 0.5 + (m.height - 0.5) * 0.72 };
  const mods = { ...spec.mods };
  // the cartoon dial works on top of the person's own sliders
  if (c > 0){
    const add = (k, v) => { mods[k] = clamp((mods[k] || 0) + v, -1, 1); };
    add('eye-scale-decr|incr', 0.9 * c); add('nose-scale-horiz-decr|incr', -0.35 * c); add('nose-scale-vert-decr|incr', -0.45 * c);
    add('nose-scale-depth-decr|incr', -0.5 * c); add('mouth-scale-horiz-decr|incr', -0.3 * c); add('chin-height-decr|incr', -0.3 * c);
    add('head-round', 0.4 * c); add('neck-scale-horiz-decr|incr', -0.3 * c); add('cheek-volume-decr|incr', 0.4 * c);
    add('hand-scale-decr|incr', 0.3 * c); add('foot-scale-decr|incr', 0.3 * c);
  }
  const expr = {};
  for (const k in spec.expr || {}) if (spec.expr[k]) expr[k] = spec.expr[k];
  return { macro, mods, expr, headScale: 1 + 0.5 * c };
}
export function partsOf(spec){
  const n = (v) => (v && v !== 'none' ? v : null);
  return ['eyes', 'teeth', 'tongue', n(spec.brows.style), n(spec.lashes.style), n(spec.hair.style), n(spec.outfit.outfit), n(spec.outfit.shoes), n(spec.outfit.hat)].filter(Boolean);
}

// ---------- old saves ----------
export function upgrade(spec){
  const s = defaults();
  if (!spec || typeof spec !== 'object') return s;
  s.name = typeof spec.name === 'string' ? spec.name.slice(0, 40) : '';
  s.seed = Number.isFinite(spec.seed) ? spec.seed : 0;
  if (typeof spec.presetOf === 'string') s.presetOf = spec.presetOf;
  for (const c of CONTROLS){
    const v = get(spec, c.key);
    if (v === undefined || v === null) continue;
    if (c.type === 'slider' && Number.isFinite(v)){ const q = snap(c, clamp(v, c.min, c.max)); if (!c.mod || q) set(s, c.key, q); }
    else if (c.type === 'color' && (v === 'auto' || v === 'none' || /^#[0-9a-f]{6}$/i.test(v))) set(s, c.key, String(v).toLowerCase());
    else if (c.type === 'choice' && c.options.some((x) => x.value === v)) set(s, c.key, v);
  }
  s.v = SPEC_VERSION;
  return s;
}

// ---------- character codes ----------
// A short text that rebuilds exactly the same character on another device. It starts from a base
// (the defaults, a seed number's random person, or a preset) and lists only what was changed, as
// bytes: the control's number (two bytes, the first with its top bit set), then its value (a
// slider as one of 200 steps, which is also the designer's step, so nothing is lost; a choice as
// its position; a colour as its palette position, or the colour itself), then the name.
export const STEPS = 200;
export const quant = (c, v) => Math.round((clamp(v, c.min, c.max) - c.min) / (c.max - c.min) * STEPS);
export const unquant = (c, q) => c.min + (c.max - c.min) * q / STEPS;
export function snap(c, v){ return c.step ? Math.round(v / c.step) * c.step : Math.round(unquant(c, quant(c, v)) * 1e6) / 1e6; }
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const valOf = (spec, c) => { const v = get(spec, c.key); return v === undefined && c.type === 'slider' ? 0 : v; };
export function baseOf(spec){
  if (spec.seed >= 1 && spec.seed <= MAX_SEED) return { kind: 1, n: spec.seed, spec: fromSeed(spec.seed) };
  const pi = PRESETS().findIndex((p) => p.name === spec.presetOf);
  if (pi >= 0) return { kind: 2, n: pi, spec: PRESETS()[pi] };
  return { kind: 0, n: 0, spec: defaults() };
}
export function toCode(specIn){
  const spec = upgrade(specIn), base = baseOf(spec), out = [];
  if (base.kind === 1) out.push(253, (base.n >> 16) & 255, (base.n >> 8) & 255, base.n & 255);
  if (base.kind === 2) out.push(252, base.n);
  CONTROLS.forEach((c, i) => {
    const v = valOf(spec, c), d = valOf(base.spec, c);
    const id = [128 | (i >> 7), i & 127];
    if (c.type === 'slider'){ const q = quant(c, v); if (q !== quant(c, d)) out.push(...id, q); }
    else if (c.type === 'choice'){ if (v !== d) out.push(...id, Math.max(0, c.options.findIndex((x) => x.value === v))); }
    else if (c.type === 'color' && v !== d){
      const pi = c.palette.indexOf(v);
      if (pi >= 0) out.push(...id, pi); else out.push(...id, 255, ...hexBytes(v));
    }
  });
  if ((spec.name || '') !== (base.spec.name || '')){ out.push(254); for (const b of new TextEncoder().encode(spec.name || '')) out.push(b); }
  let bits = 0, n = 0, str = '';
  for (const b of out){ bits = (bits << 8) | b; n += 8; while (n >= 6){ n -= 6; str += B64[(bits >> n) & 63]; } bits &= (1 << n) - 1; }
  if (n) str += B64[(bits << (6 - n)) & 63];
  return 'CC2-' + str;
}
function hexBytes(h){ const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
export function fromCode(code){
  const t = String(code || '').trim();
  if (/^#?\d{1,6}$/.test(t)) return fromSeed(+t.replace('#', ''));     // just a seed number
  const m = t.replace(/\s+/g, '').match(/CC2-([A-Za-z0-9_-]*)/);
  if (!m) throw new Error('That is not a character code (they start with CC2-, or are a number).');
  const bytes = []; let bits = 0, n = 0;
  for (const ch of m[1]){ const v = B64.indexOf(ch); bits = (bits << 6) | v; n += 6; if (n >= 8){ n -= 8; bytes.push((bits >> n) & 255); bits &= (1 << n) - 1; } }
  let s = defaults(), k = 0;
  if (bytes[0] === 253){ s = clone(fromSeed((bytes[1] << 16) | (bytes[2] << 8) | bytes[3])); k = 4; }
  else if (bytes[0] === 252){ s = clone(PRESETS()[bytes[1]] || defaults()); k = 2; }
  while (k < bytes.length){
    const b0 = bytes[k++];
    if (b0 === 254){ s.name = new TextDecoder().decode(Uint8Array.from(bytes.slice(k))).slice(0, 40); break; }
    if (!(b0 & 128) || k >= bytes.length) throw new Error('That code is damaged.');
    const i = ((b0 & 127) << 7) | bytes[k++];
    const c = CONTROLS[i];
    if (!c) throw new Error('That code is from a newer Character Creator.');
    const b = bytes[k++];
    if (c.type === 'slider') set(s, c.key, unquant(c, b));
    else if (c.type === 'choice') set(s, c.key, (c.options[b] || c.options[0]).value);
    else if (b === 255){ const r = bytes[k++], g = bytes[k++], bl = bytes[k++]; set(s, c.key, '#' + [r, g, bl].map((x) => x.toString(16).padStart(2, '0')).join('')); }
    else set(s, c.key, c.palette[b] || c.def);
  }
  return upgrade(s);
}

// ---------- random people ----------
// Natural by default: everything near the middle, colours that go together, hair and clothes that
// suit. cat: only that tab (or everything).
export const MAX_SEED = 999999;
export function randomize(spec, cat, seed = 1 + Math.floor(Math.random() * MAX_SEED)){
  const r = rng(seed), s = clone(spec);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const normal = (sd) => { let t = 0; for (let i = 0; i < 4; i++) t += r(); return (t - 2) * sd * 1.7; };
  const want = (c) => !cat || c.cat === cat;
  const opts = (key) => CONTROL[key].options.map((x) => x.value).filter((v) => v !== 'none');
  if (!cat || cat === 'body'){
    if (!cat){ s.seed = seed; delete s.presetOf; }
    const male = r() < 0.5;
    s.macro.gender = male ? clamp(0.85 + normal(0.1), 0.6, 1) : clamp(0.12 + normal(0.1), 0, 0.4);
    s.macro.age = Math.round(clamp(r() < 0.12 ? 11 + r() * 8 : 20 + Math.pow(r(), 1.4) * 60, 11, 90));
    s.macro.muscle = clamp(0.5 + normal(0.18), 0, 1); s.macro.weight = clamp(0.48 + normal(0.18), 0, 1);
    s.macro.height = clamp(0.5 + normal(0.2), 0, 1); s.macro.proportions = clamp(0.55 + normal(0.15), 0, 1);
    const e = [r() ** 3, r() ** 3, r() ** 3], main = Math.floor(r() * 3); e[main] += 1.2;
    const sum = e[0] + e[1] + e[2];
    s.macro.african = e[0] / sum; s.macro.asian = e[1] / sum; s.macro.caucasian = e[2] / sum;
    s.macro.cup = clamp(0.5 + normal(0.2), 0, 1); s.macro.firmness = clamp(0.5 + normal(0.15), 0, 1);
  }
  const male = s.macro.gender > 0.5, dark = s.macro.african > 0.5, asian = s.macro.asian > 0.5, old = s.macro.age > 55;
  for (const c of CONTROLS){
    if (!want(c)) continue;
    if (c.mod){ const sd = c.cat === 'shape' ? 0.08 : 0.13; set(s, c.key, clamp(c.min < 0 ? normal(sd) : Math.max(0, normal(sd)), c.min, c.max)); continue; }
    switch (c.key){
      // (a random person keeps the first ten styles, so seed numbers made before more hair arrived still
      // give the same person; the Hair tab's own dice picks from them all)
      case 'hair.style': if (cat === 'hair'){ s.hair.style = r() < (male ? 0.08 : 0.02) ? 'none' : pick(opts('hair.style')); break; } s.hair.style = r() < (male ? 0.12 : 0.02) ? 'none' : pick(male ? ['short01', 'short02', 'short03', 'short04', 'short02', 'afro01', 'bob02'] : ['long01', 'bob01', 'bob02', 'ponytail01', 'braid01', 'afro01', 'short02', 'long01']); break;
      case 'hair.color': s.hair.color = old && r() < 0.7 ? pick(['#7d7a76', '#d9d6d0']) : dark || asian ? pick(['#0e0b09', '#24170f', '#24170f']) : pick(PALETTES.hair.slice(0, 10)); break;
      case 'brows.color': s.brows.color = s.hair.color === '#d9d6d0' ? '#7d7a76' : s.hair.color; break;
      case 'brows.style': s.brows.style = pick(opts('brows.style')); break;
      case 'lashes.style': s.lashes.style = pick(opts('lashes.style')); break;
      case 'eyes.color': s.eyes.color = dark || asian ? pick(['brown', 'brown', 'brownlight']) : pick(Object.keys(EYE_COLOURS)); break;
      case 'outfit.outfit': s.outfit.outfit = pick(opts('outfit.outfit').filter((v) => (male ? !v.startsWith('female') : true))); break;
      case 'outfit.tint': s.outfit.tint = r() < 0.85 ? 'none' : pick(PALETTES.tint); break;
      case 'outfit.shoes': s.outfit.shoes = pick(opts('outfit.shoes')); break;
      case 'outfit.shoeTint': s.outfit.shoeTint = 'none'; break;
      case 'outfit.hat': s.outfit.hat = r() < 0.85 ? 'none' : pick(opts('outfit.hat')); break;
      case 'skin.texture': s.skin.texture = 'auto'; break;
      case 'skin.tone': s.skin.tone = 'auto'; break;
      case 'skin.shine': s.skin.shine = clamp(0.3 + normal(0.15), 0, 1); break;
      case 'expr.mouth-corner-puller': s.expr['mouth-corner-puller'] = r() < 0.6 ? r() * 0.5 : 0; break;
      default: break;
    }
  }
  return upgrade(s);
}
export function fromSeed(seed){
  seed = Math.max(1, Math.min(MAX_SEED, Math.round(seed) || 1));
  const s = randomize(defaults(), null, seed);
  s.seed = seed; s.name = 'Person ' + seed;
  return s;
}

// ---------- presets ----------
let presetCache = null;
const P = (name, o) => { const s = defaults(); s.name = name; s.presetOf = name; for (const k in o) set(s, k, o[k]); return upgrade(s); };
export function PRESETS(){
  if (presetCache) return presetCache;
  presetCache = [
    P('Alex', { 'macro.gender': 0.5 }),
    P('Ava', { 'macro.gender': 0, 'macro.age': 27, 'macro.african': 0.2, 'macro.asian': 0.1, 'macro.caucasian': 0.7, 'macro.weight': 0.42, 'hair.style': 'long01', 'hair.color': '#5c3a1f',
      'brows.color': '#3d2616', 'eyes.color': 'green', 'outfit.outfit': 'female_casualsuit01', 'outfit.shoes': 'shoes06', 'expr.mouth-corner-puller': 0.3, 'brows.style': 'eyebrow006' }),
    P('Marcus', { 'macro.gender': 1, 'macro.age': 32, 'macro.african': 1, 'macro.asian': 0, 'macro.caucasian': 0, 'macro.muscle': 0.75, 'macro.height': 0.75, 'hair.style': 'short04',
      'hair.color': '#0e0b09', 'brows.color': '#0e0b09', 'outfit.outfit': 'male_elegantsuit01', 'outfit.shoes': 'shoes04', 'eyes.color': 'brown' }),
    P('Kenji', { 'macro.gender': 1, 'macro.age': 24, 'macro.african': 0, 'macro.asian': 1, 'macro.caucasian': 0, 'macro.weight': 0.4, 'hair.style': 'short02', 'hair.color': '#0e0b09',
      'brows.color': '#0e0b09', 'outfit.outfit': 'male_casualsuit05', 'outfit.shoes': 'shoes04', 'eyes.color': 'brown' }),
    P('Grandma Rose', { 'macro.gender': 0, 'macro.age': 78, 'macro.african': 0, 'macro.asian': 0, 'macro.caucasian': 1, 'macro.weight': 0.62, 'macro.height': 0.3, 'hair.style': 'bob01',
      'hair.color': '#d9d6d0', 'brows.color': '#7d7a76', 'outfit.outfit': 'female_elegantsuit01', 'outfit.shoes': 'shoes01', 'eyes.color': 'blue', 'expr.mouth-corner-puller': 0.4 }),
    P('Priya', { 'macro.gender': 0, 'macro.age': 30, 'macro.african': 0.15, 'macro.asian': 0.85, 'macro.caucasian': 0, 'hair.style': 'braid01', 'hair.color': '#0e0b09', 'brows.color': '#0e0b09',
      'outfit.outfit': 'female_sportsuit01', 'outfit.shoes': 'shoes05', 'eyes.color': 'brown' }),
    P('Liam', { 'macro.gender': 1, 'macro.age': 19, 'macro.african': 0, 'macro.asian': 0, 'macro.caucasian': 1, 'macro.weight': 0.35, 'macro.height': 0.7, 'hair.style': 'short01', 'hair.color': '#b9572a',
      'brows.color': '#8e3420', 'outfit.outfit': 'male_casualsuit04', 'outfit.shoes': 'shoes04', 'eyes.color': 'bluegreen' }),
    P('Sofia', { 'macro.gender': 0, 'macro.age': 41, 'macro.african': 0.1, 'macro.asian': 0, 'macro.caucasian': 0.9, 'hair.style': 'ponytail01', 'hair.color': '#24170f', 'brows.color': '#24170f',
      'outfit.outfit': 'female_casualsuit02', 'outfit.shoes': 'shoes06', 'eyes.color': 'brownlight' }),
    P('The Golfer', { 'macro.gender': 1, 'macro.age': 45, 'macro.african': 0.6, 'macro.asian': 0.15, 'macro.caucasian': 0.25, 'macro.muscle': 0.65, 'macro.height': 0.6, 'hair.style': 'short04',
      'hair.color': '#0e0b09', 'brows.color': '#0e0b09', 'outfit.outfit': 'male_casualsuit03', 'outfit.tint': '#b3332e', 'outfit.shoes': 'shoes05', 'outfit.hat': 'fedora01', 'expr.mouth-corner-puller': 0.6 }),
    P('Builder Bob', { 'macro.gender': 1, 'macro.age': 52, 'macro.weight': 0.75, 'macro.muscle': 0.6, 'hair.style': 'none', 'outfit.outfit': 'male_worksuit01', 'outfit.shoes': 'shoes03', 'eyes.color': 'grey' }),
    P('Toon Tess', { 'style.cartoon': 1, 'style.render': 'toon', 'macro.gender': 0, 'macro.age': 14, 'hair.style': 'ponytail01', 'hair.color': '#b9572a', 'brows.color': '#8e3420',
      'outfit.outfit': 'female_casualsuit01', 'outfit.shoes': 'shoes06', 'eyes.color': 'green', 'expr.mouth-corner-puller': 0.8 }),
    P('Animated Max', { 'style.cartoon': 0.6, 'style.render': 'soft', 'macro.gender': 1, 'macro.age': 12, 'hair.style': 'short02', 'hair.color': '#cfa86c', 'brows.color': '#a87b4b',
      'outfit.outfit': 'male_casualsuit04', 'outfit.tint': '#3f6fb5', 'outfit.shoes': 'shoes04', 'eyes.color': 'blue', 'expr.mouth-corner-puller': 0.7 }),
    P('Clay', { 'style.render': 'clay', 'hair.style': 'short01' }),
  ];
  return presetCache;
}
