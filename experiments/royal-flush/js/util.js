// Small helpers and the save.

export const $ = (id) => document.getElementById(id);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// "120 m · about 2 min walk"
export function fmtDist(m){
  if (m < 1000) return Math.round(m / 5) * 5 + ' m';
  if (m < 10000) return (m / 1000).toFixed(1) + ' km';
  return Math.round(m / 1000).toLocaleString() + ' km';
}
export function walkMin(m){ return Math.max(1, Math.round(m * 1.3 / 75)); }   // paths wind: 1.3 × straight line at 75 m/min
const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export function compass(dx, dy){
  const a = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
  return DIRS[Math.round(a / 45) % 8];
}
export function fmtTime(t){
  const d = new Date(t);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
export function fmtDay(t){
  const d = new Date(t);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + fmtTime(t);
}

// --- the save: localStorage under a versioned key, written on every action ---
export const SAVE_KEY = 'royal-flush-save-1';

export function freshSave(){
  return {
    v: 1,
    park: 'magic-kingdom',
    // one slot per park, and a separate one for practice at home ("magic-kingdom:practice"), so playing
    // on the sofa never spoils the real quest
    parks: {},
    settings: { sound: true },
    practice: {},         // park id → { x, y }: where "you" are in practice mode
    fixes: {},            // park id → { restroom id: {x, y} }: pins moved to where a player stood (shared by both slots)
  };
}
export function freshSlot(){
  return { found: {}, custom: [], badges: {}, stats: { walked: 0, washes: 0, perfect: 0, emergencies: 0 }, emergency: null, started: null };
}

// fills in whatever an older save lacks (never break an old save)
export function upgrade(s){
  const f = freshSave();
  if (!s || typeof s !== 'object') return f;
  for (const k of Object.keys(f)) if (s[k] === undefined || s[k] === null) s[k] = f[k];
  for (const k of Object.keys(f.settings)) if (s.settings[k] === undefined) s.settings[k] = f.settings[k];
  const fs = freshSlot();
  for (const slot of Object.values(s.parks)){
    for (const k of Object.keys(fs)) if (slot[k] === undefined) slot[k] = fs[k];
    for (const k of Object.keys(fs.stats)) if (slot.stats[k] === undefined) slot.stats[k] = 0;
  }
  s.v = 1;
  return s;
}

export function loadSave(){
  try { return upgrade(JSON.parse(localStorage.getItem(SAVE_KEY))); } catch (e) { return freshSave(); }
}
export function writeSave(s){
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch (e) {}
}
export function slotOf(s, key){
  if (!s.parks[key]) s.parks[key] = freshSlot();
  return s.parks[key];
}
