// Royal Flush: find, check in at, rate and wash up at every restroom in the park.
import { $, dist, esc, fmtDist, walkMin, compass, fmtTime, loadSave, writeSave, slotOf } from './util.js';
import { PARKS, LANDS, parkById, toXY } from './parks.js';
import { MapView } from './map.js';
import { toast, openPanel, closePanel, party, wash } from './ui.js';
import * as sound from './sound.js';

if (window.__loading) await window.__loading();

const VERSION = document.body.dataset.version || '';
const S = loadSave();
sound.setSound(S.settings.sound);

// ---------- game state ----------
const G = {
  park: parkById(S.park),
  mode: null,              // 'gps' | 'practice' (null on the title screen)
  me: null,                // { x, y, acc, practice }
  fix: null,               // the latest GPS fix, even far from the park: { x, y, acc, far }
  sheetId: null, confirmFar: null,
  routeId: null,
  arrived: new Set(),      // restrooms we've already said "you're here" for, this session
  now: () => Date.now(),
};
const slotKey = () => G.park.id + (G.mode === 'practice' ? ':practice' : '');
const slot = () => slotOf(S, slotKey());
const save = () => writeSave(S);

// every restroom of the park, with any pins the player has moved, and the ones they added
function restrooms(){
  const fixes = S.fixes[G.park.id] || {};
  const list = G.park.restrooms.map((r) => fixes[r.id] ? { ...r, ...fixes[r.id], fixed: true } : r);
  for (const c of slot().custom) list.push({ ...c, custom: true });
  return list;
}
const byId = (id) => restrooms().find((r) => r.id === id);
const official = () => G.park.restrooms;
const found = (id) => slot().found[id];
const dTo = (r) => (G.me ? dist(G.me, r) : null);

// ---------- points ----------
const PTS = { find: 100, gps: 50, themed: 100, wash: 50, badge: 200, land: 250, custom: 50 };
function pointsFor(r, f){
  if (!f) return 0;
  if (r.custom) return PTS.custom + (f.washed || 0);
  return PTS.find + (f.verified ? PTS.gps : 0) + (r.themed ? PTS.themed : 0) + (f.washed || 0);
}
function landProgress(){
  const out = {};
  for (const id of Object.keys(LANDS)) out[id] = { have: 0, all: 0 };
  for (const r of official()){ out[r.land].all++; if (found(r.id)) out[r.land].have++; }
  return out;
}
function score(){
  let n = 0;
  for (const r of restrooms()) n += pointsFor(r, found(r.id));
  n += Object.keys(slot().badges).length * PTS.badge;
  for (const l of Object.values(landProgress())) if (l.all && l.have === l.all) n += PTS.land;
  return n;
}
const foundCount = () => official().filter((r) => found(r.id)).length;

// ---------- badges ----------
const BADGES = [
  { id: 'first', icon: '🧻', name: 'First Flush', desc: 'Find your first restroom.' },
  { id: 'allLands', icon: '🌈', name: 'Land Hopper', desc: 'Find a restroom in all six lands.' },
  { id: 'land', icon: '🗺️', name: 'Land Lord', desc: 'Find every restroom in one land.' },
  { id: 'half', icon: '🥈', name: 'Halfway There', desc: 'Find half the restrooms in the park.' },
  { id: 'royal', icon: '👑', name: 'Royal Flush', desc: 'Find every restroom in the park.' },
  { id: 'tangled', icon: '🏮', name: 'Let Down Your Hair', desc: 'Find the Tangled restrooms.' },
  { id: 'speed', icon: '⚡', name: 'Speed Run', desc: 'Find 3 restrooms within 30 minutes.' },
  { id: 'gps5', icon: '📡', name: 'Boots on the Ground', desc: 'Earn the GPS bonus 5 times.' },
  { id: 'early', icon: '🌅', name: 'Rope Drop Relief', desc: 'Check in before 9:30 in the morning.' },
  { id: 'night', icon: '🎆', name: 'Fireworks Flush', desc: 'Check in after 8 at night.' },
  { id: 'clean', icon: '🫧', name: 'Squeaky Clean', desc: 'Scrub the full 20 seconds 5 times.' },
  { id: 'critic', icon: '⭐', name: 'Toilet Critic', desc: 'Rate 5 restrooms.' },
  { id: 'close', icon: '🚨', name: 'Close Call', desc: 'Press "I need to go!" and get there within 15 minutes.' },
  { id: 'walk', icon: '👟', name: 'Marathon Bladder', desc: 'Walk 5 km with the quest open.' },
  { id: 'map', icon: '📍', name: 'Cartographer', desc: 'Fix a pin, or add a restroom the map is missing.' },
];
function checkBadges(ctx = {}){
  const sl = slot(), have = sl.badges, got = [];
  const give = (id) => { if (!have[id]){ have[id] = G.now(); got.push(BADGES.find((b) => b.id === id)); } };
  const f = Object.entries(sl.found);
  const lp = landProgress();
  if (f.length) give('first');
  if (Object.values(lp).every((l) => l.have > 0)) give('allLands');
  if (Object.values(lp).some((l) => l.all && l.have === l.all)) give('land');
  if (foundCount() >= Math.ceil(official().length / 2)) give('half');
  if (foundCount() === official().length) give('royal');
  if (found('tangled')) give('tangled');
  const times = f.map(([, v]) => v.t).sort((a, b) => a - b);
  for (let i = 2; i < times.length; i++) if (times[i] - times[i - 2] <= 30 * 60000) give('speed');
  if (f.filter(([, v]) => v.verified).length >= 5) give('gps5');
  for (const [, v] of f){ const h = new Date(v.t).getHours() + new Date(v.t).getMinutes() / 60; if (h < 9.5) give('early'); if (h >= 20) give('night'); }
  if (sl.stats.perfect >= 5) give('clean');
  if (f.filter(([, v]) => v.rating).length >= 5) give('critic');
  if (ctx.close) give('close');
  if (sl.stats.walked >= 5000) give('walk');
  if (ctx.map) give('map');
  if (got.length){
    save();
    got.forEach((b, i) => setTimeout(() => { sound.ding(true); toast(`<span class="emoji">${b.icon}</span> Badge: <b>${b.name}</b> +${PTS.badge}`, 'gold', 4200); }, 400 + i * 900));
  }
  return got;
}

// ---------- the map ----------
const map = new MapView($('map'), {
  onTapPin: (id) => openSheet(id),
  onTapLandmark: (l) => {
    if ($('sheet').classList.contains('show')){ closeSheet(); return; }
    toast(`${l.icon ? `<span class="emoji">${l.icon}</span> ` : ''}<b>${esc(l.name)}</b>`, '', 2200);
  },
  onTapMap: (p) => {
    if ($('sheet').classList.contains('show')){ closeSheet(); return; }
    if (G.mode === 'practice') walkTo(p);
  },
});
map.setPark(G.park);
function refreshPins(){
  map.setPins(restrooms().map((r) => ({ id: r.id, x: r.x, y: r.y, name: r.name, found: !!found(r.id), themed: !!r.themed, custom: !!r.custom })));
}
function layoutPad(){
  const top = $('top').getBoundingClientRect().height || 60, bottom = $('bottom').getBoundingClientRect().height || 80;
  map.safeL = Math.max(0, (parseFloat(getComputedStyle($('bottom')).paddingLeft) || 10) - 10);   // the notch, on an iPhone held sideways
  map.setPad(top, bottom);
}
addEventListener('resize', layoutPad);

// ---------- HUD ----------
let hudCache = '';
function refreshHUD(){
  const n = foundCount(), all = official().length, sc = score();
  const key = [G.park.name, n, all, sc, G.mode].join('|');
  if (key === hudCache) return;
  hudCache = key;
  $('top-name').textContent = G.park.name + (G.mode === 'practice' ? ' · practice' : '');
  $('top-count').textContent = `${n} of ${all} restrooms found`;
  $('top-fill').style.width = (all ? n / all * 100 : 0) + '%';
  $('score').textContent = sc.toLocaleString() + ' pts';
}
let gpsCache = '';
function setGPS(text, cls = ''){
  const key = text + cls; if (key === gpsCache) return; gpsCache = key;
  const el = $('gps'); el.className = cls; el.innerHTML = text; el.style.display = text ? '' : 'none';
}
function refreshAll(){ refreshPins(); refreshHUD(); if (G.sheetId) renderSheet(); }

// ---------- where you are: GPS, or a pretend you in practice mode ----------
let watchId = null, lastWalk = null;
function startGPS(){
  if (!('geolocation' in navigator)){ setGPS('This device has no location. Try practice mode from the menu.', 'warn'); return; }
  if (watchId !== null) return;
  setGPS('📡 Finding you…');
  watchId = navigator.geolocation.watchPosition(onFix, onFixError, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
}
// which way the phone is pointing. iPhones ask permission for this, and only from a tap.
let compassOn = false, lastHeadingDraw = 0;
function setHeading(h){
  if (Math.abs(((h - (map.heading ?? -999)) + 540) % 360 - 180) < 3 && performance.now() - lastHeadingDraw < 1000) return;
  map.heading = h; lastHeadingDraw = performance.now(); map.dirty();
}
function onOrient(e){
  let h = null;
  if (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading)) h = e.webkitCompassHeading;          // iPhone
  else if (e.absolute && typeof e.alpha === 'number') h = (360 - e.alpha) % 360;                                          // Android
  if (h === null) return;
  const so = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  compassOn = true; setHeading((h + so + 360) % 360);
}
function askCompass(){
  try {
    const D = window.DeviceOrientationEvent;
    if (!D || askCompass.done) return;
    askCompass.done = true;
    const listen = () => { addEventListener('deviceorientationabsolute', onOrient); addEventListener('deviceorientation', onOrient); };
    if (typeof D.requestPermission === 'function') D.requestPermission().then((r) => { if (r === 'granted') listen(); }).catch(() => { askCompass.done = false; });
    else listen();
  } catch (e) {}
}
function stopGPS(){ if (watchId !== null){ navigator.geolocation.clearWatch(watchId); watchId = null; } }
function onFixError(e){
  if (G.mode !== 'gps') return;
  if (e.code === 1) setGPS('📵 Location is off for this page. On an iPhone: Settings › Privacy &amp; Security › Location Services › Safari Websites › <b>While Using</b>, then reload. Or try practice mode (☰).', 'warn');
  else setGPS('📡 Still looking for a GPS signal…', 'warn');
}
function onFix(p){
  if (!compassOn && p.coords.heading !== null && !isNaN(p.coords.heading) && p.coords.speed > 0.6) setHeading(p.coords.heading);
  applyFix(toXY(G.park, p.coords.latitude, p.coords.longitude), p.coords.accuracy || 30);
}
function applyFix(xy, acc){
  const far = Math.hypot(xy.x, xy.y) > 2500;
  G.fix = { x: xy.x, y: xy.y, acc, far };
  if (G.mode !== 'gps') return;
  if (far){
    G.me = null; map.setMe(null);
    setGPS(`You're ${fmtDist(Math.hypot(xy.x, xy.y))} from ${G.park.name}. <u>Practice at home</u> instead?`, 'warn');
    $('gps').onclick = () => setMode('practice');
    return;
  }
  $('gps').onclick = null;
  setGPS(acc <= 25 ? `📍 GPS ±${Math.round(acc)} m` : `📍 GPS ±${Math.round(acc)} m: rough, walk into the open`, acc <= 25 ? '' : 'warn');
  // walking distance: only count steady, believable steps
  if (acc <= 35){
    if (lastWalk){
      const d = dist(lastWalk, xy);
      if (d >= Math.max(8, acc * 0.5) && d < 200){ slot().stats.walked += d; lastWalk = xy; save(); checkBadges(); }
      else if (d >= 200) lastWalk = xy;
    } else lastWalk = xy;
  }
  moveMe({ x: xy.x, y: xy.y, acc });
}
function moveMe(me){
  const first = !G.me;
  G.me = me; map.setMe(me);
  if (first && G.mode === 'gps'){ map.follow = true; map.centerOn(me.x, me.y, Math.max(map.zoom, 2.2)); }
  if (G.routeId){ const r = byId(G.routeId); map.setRoute(r ? { x: r.x, y: r.y } : null); }
  if (G.sheetId) updateSheetDistance();
  arrivals();
}
// "You're at …": the first time you come close to a restroom you haven't found
function arrivals(){
  if (!G.me) return;
  const near = restrooms().filter((r) => !found(r.id) && !G.arrived.has(r.id) && dist(G.me, r) <= 35 + Math.min(G.me.acc || 0, 30));
  if (!near.length) return;
  near.sort((a, b) => dist(G.me, a) - dist(G.me, b));
  const r = near[0]; G.arrived.add(r.id);
  sound.ding();
  if (!G.sheetId && !$('panel').classList.contains('show')) openSheet(r.id);   // the card says "You're here!"
  else toast(`🚻 You're at <b>${esc(r.name)}</b>! Tap it on the map, then <b>Found it!</b>`, 'good', 4500);
}
// practice: walk the pretend you to where you tapped
let walkAnim = 0;
function walkTo(p){
  const from = G.me ? { x: G.me.x, y: G.me.y } : p, d = dist(from, p), t0 = performance.now(), D = Math.min(1400, 250 + d * 3), id = ++walkAnim;
  const step = () => {
    if (id !== walkAnim) return;
    const k = Math.min(1, (performance.now() - t0) / D), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    G.me = { x: from.x + (p.x - from.x) * e, y: from.y + (p.y - from.y) * e, acc: 0, practice: true };
    map.setMe(G.me);
    if (G.routeId){ const r = byId(G.routeId); map.setRoute(r ? { x: r.x, y: r.y } : null); }
    if (k < 1) requestAnimationFrame(step);
    else {
      slot().stats.walked += d; S.practice[G.park.id] = { x: p.x, y: p.y }; save();
      if (G.sheetId) updateSheetDistance();
      arrivals(); checkBadges();
    }
  };
  step();
}

function setMode(mode){
  G.mode = mode; G.me = null; map.heading = null; compassOn = false; G.routeId = null; map.setRoute(null); map.setMe(null); G.arrived.clear(); lastWalk = null;
  closeSheet();
  if (!slot().started) { slot().started = G.now(); save(); }
  if (mode === 'gps'){
    startGPS();
    if (G.fix) applyFix(G.fix, G.fix.acc);
  } else {
    stopGPS();
    const at = S.practice[G.park.id] || { x: 0, y: -300 };
    G.me = { ...at, acc: 0, practice: true }; map.setMe(G.me);
    setGPS('🛋️ Practice mode: tap the map to walk there', 'practice');
    $('gps').onclick = null;
  }
  hudCache = ''; refreshAll();
}

// ---------- the restroom card ----------
function openSheet(id){
  G.sheetId = id; G.confirmFar = null;
  const r = byId(id); if (!r) return;
  map.select(id);
  renderSheet();
  // bring the pin into view above the card
  // (just above the card's top edge, so messages at the top of the screen don't cover it)
  const card = document.querySelector('#sheet .sh'), cardTop = card ? innerHeight - card.getBoundingClientRect().height : innerHeight - 300;
  const py = map.sy(r.y), px = map.sx(r.x);
  if (py > cardTop - 30 || py < cardTop - 220 || px < 30 || px > innerWidth - 30){
    const k = map.s, wantY = Math.max(130, cardTop - 44);
    map.centerOn(r.x, r.y - (map.midY() - wantY) / k);   // so the pin sits at wantY, above the card
  }
  map.follow = false;
}
function closeSheet(){
  G.sheetId = null; G.confirmFar = null; map.select(null);
  const s = $('sheet'); s.classList.remove('show'); s.innerHTML = '';
}
function distLine(r){
  if (!G.me) return G.mode === 'gps' ? '📡 Finding you…' : '';
  const d = dist(G.me, r);
  if (d < 30) return "📍 You're here!";
  return `📍 ${fmtDist(d)} ${compass(r.x - G.me.x, r.y - G.me.y)} · about ${walkMin(d)} min walk`;
}
function updateSheetDistance(){
  const r = byId(G.sheetId), el = document.querySelector('#sheet .dist');
  if (r && el) el.textContent = distLine(r);
}
function renderSheet(){
  const r = byId(G.sheetId); if (!r) return closeSheet();
  const f = found(r.id), land = LANDS[r.land] || { name: 'Your find', color: '#ddd', ink: '#333' };
  const tags = [`<span class="tag" style="background:${land.color};color:${land.ink}">${esc(land.name)}</span>`];
  if (f) tags.push(`<span class="tag found">✓ Found ${fmtTime(f.t)}${f.verified ? ' · GPS ✓' : ''}</span>`);
  if (r.themed) tags.push('<span class="tag gold">✨ Themed</span>');
  if (r.companion) tags.push('<span class="tag">♿ Companion restroom</span>');
  if (r.charging) tags.push('<span class="tag">🔌 Charging</span>');
  if (r.custom) tags.push('<span class="tag">📍 Added by you</span>');
  if (r.fixed) tags.push('<span class="tag">📍 Pin moved by you</span>');
  let body = '';
  if (r.where) body += `<p>${esc(r.where)}</p>`;
  if (r.fact) body += `<p class="fact">💡 ${esc(r.fact)}</p>`;
  body += `<p class="dist">${distLine(r)}</p>`;
  let actions = '';
  if (G.confirmFar === r.id){
    const d = G.me ? fmtDist(dist(G.me, r)) : 'a long way';
    actions = `<p>Your phone thinks you're <b>${d}</b> from this pin. Pins can be a little off. Count it anyway? (No GPS bonus.)</p>
      <div class="row"><button class="big" data-act="force">Yes, I'm here: count it</button><button class="light" data-act="nofar">Not yet</button></div>`;
  } else if (!f){
    actions = `<div class="row"><button class="big" data-act="found">✓ Found it!</button>
      <button data-act="route">${G.routeId === r.id ? '✕ Hide the way' : '🧭 Show the way'}</button>
      <button class="light" data-act="next">Next new one →</button></div>`;
  } else {
    const stars = [1, 2, 3, 4, 5].map((n) => `<button class="${(f.rating || 0) >= n ? 'on' : ''}" data-rate="${n}" aria-label="${n} rolls">🧻</button>`).join('');
    const lines = [['none', 'No line'], ['short', 'Short'], ['long', 'Long']].map(([k, l]) => `<button class="${f.line === k ? 'on' : ''}" data-line="${k}">${l}</button>`).join('');
    actions = `<div class="rate">Cleanliness: <span class="emoji">${stars}</span></div>
      <div class="chips">Line: ${lines}</div>
      <p style="font-size:14px;margin-top:10px">Points here: <b>${pointsFor(r, f)}</b>${f.washed ? ` (incl. ${f.washed} for washing up)` : ''}</p>
      <div class="row"><button data-act="next">Next new one →</button>
      ${!f.washed ? '<button class="light" data-act="wash">🫧 Wash hands</button>' : ''}
      <button class="light" data-act="untick">↩️ Untick</button>
      ${G.mode === 'gps' && G.me && !r.custom && dist(G.me, r) < 250 ? '<button class="light" data-act="fix">📍 Pin is off: move it here</button>' : ''}</div>`;
  }
  const s = $('sheet'), fresh = !s.classList.contains('show') || s.dataset.id !== r.id;
  s.dataset.id = r.id;
  s.innerHTML = `<div class="sh${fresh ? ' anim' : ''}"><div class="sh-head"><h2><span class="emoji">${f ? '✅' : '🚻'}</span> ${esc(r.name)}</h2><button class="x" data-act="close" aria-label="Close">✕</button></div>
    <div class="tags">${tags.join('')}</div>${body}${actions}</div>`;
  s.classList.add('show');
  s.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    sound.unlock();
    if (b.dataset.rate){ found(r.id).rating = +b.dataset.rate; save(); checkBadges(); renderSheet(); return; }
    if (b.dataset.line){ found(r.id).line = b.dataset.line; save(); renderSheet(); return; }
    const a = b.dataset.act;
    if (a === 'close') closeSheet();
    else if (a === 'found') checkIn(r.id);
    else if (a === 'force') checkIn(r.id, true);
    else if (a === 'nofar'){ G.confirmFar = null; renderSheet(); }
    else if (a === 'route') toggleRoute(r.id);
    else if (a === 'next') goNext();
    else if (a === 'wash') washUp(r.id);
    else if (a === 'fix') fixPin(r.id);
    else if (a === 'untick'){ untick(r.id); renderSheet(); }
  };
}

function toggleRoute(id){
  G.routeId = G.routeId === id ? null : id;
  const r = G.routeId && byId(G.routeId);
  map.setRoute(r ? { x: r.x, y: r.y } : null);
  if (r && !G.me) toast(G.mode === 'gps' ? 'Waiting for your location…' : 'Tap the map to say where you are.');
  if (r && G.me){
    const minX = Math.min(G.me.x, r.x), maxX = Math.max(G.me.x, r.x), minY = Math.min(G.me.y, r.y), maxY = Math.max(G.me.y, r.y);
    const span = Math.max((maxX - minX) / (innerWidth * 0.8), (maxY - minY) / ((innerHeight - 380) * 0.8), 1e-6);
    map.centerOn((minX + maxX) / 2, (minY + maxY) / 2 - 60 / Math.max(map.base, 1e-6) / 2, Math.min(4, Math.max(0.8, 1 / (span * map.base))));
  }
  renderSheet();
}

function nearest(unfoundOnly){
  if (!G.me) return null;
  const list = restrooms().filter((r) => !unfoundOnly || !found(r.id));
  list.sort((a, b) => dist(G.me, a) - dist(G.me, b));
  return list[0] || null;
}
function goNext(){
  const r = nearest(true) || restrooms().find((x) => !found(x.id));
  if (!r){ toast('👑 You have found every restroom!', 'gold'); return; }
  openSheet(r.id);
  if (G.me){ G.routeId = null; toggleRoute(r.id); }
}

// 🚨 I need to go!
function emergency(){
  sound.unlock();
  if (!G.me){
    if (G.mode === 'gps') toast(G.fix && G.fix.far ? `You're not at ${G.park.name}. Try practice mode (☰).` : '📡 Finding you… hold on!', 'bad');
    return;
  }
  const r = nearest(false); if (!r) return;
  const sl = slot(); sl.stats.emergencies++; sl.emergency = { id: r.id, t: G.now() }; save();
  closeSheet(); openSheet(r.id);
  G.routeId = null; toggleRoute(r.id);
  const d = dist(G.me, r);
  toast(d < 30 ? `🚨 It's right here: <b>${esc(r.name)}</b>!` : `🚨 Nearest: <b>${esc(r.name)}</b>, ${fmtDist(d)} ${compass(r.x - G.me.x, r.y - G.me.y)}. Go go go!`, 'bad', 5000);
}

// ---------- checking in ----------
async function checkIn(id, force){
  const r = byId(id), sl = slot();
  if (!r || sl.found[id]) return false;
  const d = G.me ? dist(G.me, r) : Infinity;
  let verified = false;
  if (G.mode === 'practice'){
    if (d > 60){ toast('🛋️ Walk there first: tap the map right next to the pin.', 'bad'); return false; }
  } else {
    verified = !!G.me && d <= 50 + Math.min(G.me.acc || 30, 50);
    if (!verified && !force && G.me && d > 200){ G.confirmFar = id; renderSheet(); return false; }
  }
  const now = G.now();
  sl.found[id] = { t: now, verified, rating: 0, line: null, washed: 0 };
  const close = sl.emergency && sl.emergency.id === id && now - sl.emergency.t <= 15 * 60000;
  if (G.routeId === id){ G.routeId = null; map.setRoute(null); }
  save();
  const before = new Set(Object.entries(landProgress()).filter(([, l]) => l.all && l.have === l.all).map(([k]) => k));
  refreshAll();
  sound.flush();
  const pts = pointsFor(r, sl.found[id]);
  closeSheet();
  await party('FLUSHED!', `${esc(r.name)} · +${pts}${verified ? ' (GPS bonus!)' : ''}`, 2000);
  // a land finished?
  const lp = landProgress();
  for (const [k, l] of Object.entries(lp)) if (l.all && l.have === l.all && !before.has(k)){
    sound.ding(true); await party(`${LANDS[k].short} flushed!`, `Every restroom in the land · +${PTS.land}`, 2200);
  }
  if (foundCount() === official().length && r.land){ await party('ROYAL FLUSH! 👑', 'Every restroom in the park!', 3200); }
  await washUp(id, true);
  checkBadges({ close });
  refreshAll();
  return true;
}

async function washUp(id, afterCheckIn){
  const f = found(id); if (!f) return;
  const sec = await wash();
  const pts = Math.round(sec / 20 * PTS.wash);
  const sl = slot();
  if (pts > (f.washed || 0)) f.washed = pts;
  if (sec > 1) sl.stats.washes++;
  if (sec >= 20) sl.stats.perfect++;
  save();
  if (sec >= 20) toast(`🫧 Squeaky clean! +${PTS.wash}`, 'good');
  else if (pts) toast(`🫧 Bit of a quick one… +${pts}`);
  else toast('🙈 No washing? Tap 🫧 on the card to try again.');
  checkBadges();
  refreshAll();
  openSheet(id);
  if (afterCheckIn) toast('How was it? Rate it in rolls of 🧻', '', 3800);
}

// the quick way: tick one off from the list (no GPS check, no ceremony), or untick a mistake
function tick(id){
  const r = byId(id), sl = slot(); if (!r || sl.found[id]) return;
  const before = new Set(Object.entries(landProgress()).filter(([, l]) => l.all && l.have === l.all).map(([k]) => k));
  sl.found[id] = { t: G.now(), verified: false, rating: 0, line: null, washed: 0, ticked: true };
  if (G.routeId === id){ G.routeId = null; map.setRoute(null); }
  save(); sound.flush();
  toast(`✓ <b>${esc(r.name)}</b> ticked off · +${pointsFor(r, sl.found[id])}`, 'good');
  for (const [k, l] of Object.entries(landProgress())) if (l.all && l.have === l.all && !before.has(k)) toast(`🏆 <b>${LANDS[k].short}</b> complete! +${PTS.land}`, 'gold', 4200);
  checkBadges(); refreshAll();
}
function untick(id){
  const r = byId(id), sl = slot(); if (!r || !sl.found[id]) return;
  delete sl.found[id];
  save(); toast(`↩️ <b>${esc(r.name)}</b> unticked`); refreshAll();
}

function fixPin(id){
  if (!G.me || G.mode !== 'gps') return;
  const fx = S.fixes[G.park.id] || (S.fixes[G.park.id] = {});
  fx[id] = { x: G.me.x, y: G.me.y };
  save(); toast('📍 Pin moved to where you are. Thanks, cartographer!', 'good');
  checkBadges({ map: true }); refreshAll();
}
function addRestroom(name){
  if (!G.me){ toast('Need to know where you are first.', 'bad'); return; }
  const sl = slot(), id = 'my-' + Date.now().toString(36);
  sl.custom.push({ id, name: name || `My find #${sl.custom.length + 1}`, x: G.me.x, y: G.me.y, land: null, where: 'Added by you, right here.' });
  save(); checkBadges({ map: true }); refreshAll();
  return id;
}

// ---------- panels ----------
function listPanel(){
  const lp = landProgress();
  let html = '';
  const row = (r) => {
    const f = found(r.id), d = dTo(r);
    const stars = f && f.rating ? ' · ' + '🧻'.repeat(f.rating) : '';
    return `<div class="item ${f ? 'done' : ''}" data-go="${r.id}">
      <button class="check ${f ? 'on' : ''}" data-check="${r.id}" aria-label="${f ? 'Untick' : 'Tick off'} ${esc(r.name)}">${f ? '✓' : ''}</button>
      <span class="tx"><b>${r.themed ? '✨ ' : ''}${esc(r.name)}</b><small>${r.land ? esc(LANDS[r.land].short) : 'Added by you'}${f ? ' · found ' + fmtTime(f.t) : ''}${stars}</small></span>
      ${d !== null ? `<span class="rt">${fmtDist(d)}</span>` : ''}<span class="go">›</span></div>`;
  };
  if (G.me){
    const near = restrooms().filter((r) => !found(r.id)).sort((a, b) => dist(G.me, a) - dist(G.me, b)).slice(0, 3);
    if (near.length) html += '<h3>Nearest new ones</h3>' + near.map(row).join('');
  }
  for (const [id, land] of Object.entries(LANDS)){
    const list = restrooms().filter((r) => r.land === id);
    if (!list.length) continue;
    html += `<h3>${esc(land.name)} · ${lp[id].have}/${lp[id].all}${lp[id].have === lp[id].all ? ' ✓' : ''}</h3>` + list.map(row).join('');
  }
  const mine = restrooms().filter((r) => r.custom);
  if (mine.length) html += '<h3>Added by you</h3>' + mine.map(row).join('');
  html = `<p class="hint">Tick off the ones you've been to, or tap one to see it on the map.</p>` + html;
  const body = openPanel(`🚻 ${foundCount()}/${official().length} restrooms`, html);
  body.onclick = (e) => {
    const c = e.target.closest('[data-check]');
    if (c){
      const id = c.dataset.check;
      if (found(id)) untick(id); else tick(id);
      const top = body.scrollTop; listPanel(); $('panel').querySelector('.pn-body').scrollTop = top;
      return;
    }
    const b = e.target.closest('[data-go]'); if (!b) return;
    closePanel(); openSheet(b.dataset.go);
  };
}

function badgesPanel(){
  const sl = slot(), lp = landProgress();
  const km = (sl.stats.walked / 1000).toFixed(1);
  let html = `<div class="stats"><div class="stat"><b>${foundCount()}/${official().length}</b>found</div>
    <div class="stat"><b>${score().toLocaleString()}</b>points</div><div class="stat"><b>${km} km</b>walked</div>
    <div class="stat"><b>${sl.stats.washes}</b>hand washes</div><div class="stat"><b>${Object.values(sl.found).filter((f) => f.rating).length}</b>rated</div>
    <div class="stat"><b>${sl.stats.emergencies}</b>emergencies</div></div>`;
  html += '<h3>Lands</h3><div class="lands">' + Object.entries(LANDS).map(([id, l]) =>
    `<div class="land" style="background:${l.color}">${esc(l.short)}<b>${lp[id].have}/${lp[id].all}${lp[id].have === lp[id].all ? ' 🏆' : ''}</b></div>`).join('') + '</div>';
  html += `<h3>Badges · ${Object.keys(sl.badges).length}/${BADGES.length}</h3>`;
  html += BADGES.map((b) => {
    const t = sl.badges[b.id];
    return `<div class="item ${t ? 'done' : 'locked'}"><span class="ic emoji">${b.icon}</span><span class="tx"><b>${esc(b.name)}</b><small>${esc(b.desc)}</small></span>${t ? '<span class="rt">✓</span>' : ''}</div>`;
  }).join('');
  openPanel('🏅 Badges & stats', html);
}

function menuPanel(){
  const p = G.mode === 'practice';
  const html = `
    <div class="row"><button data-m="mode">${p ? '🗺️ Switch to the real quest (GPS)' : '🛋️ Switch to practice mode'}</button></div>
    <div class="row"><button class="light" data-m="whole">🔍 Show the whole park</button><button class="light" data-m="sound">${S.settings.sound ? '🔊 Sound on' : '🔇 Sound off'}</button></div>
    <h3>Found one that isn't on the map?</h3>
    <p style="font-size:14px">Stand next to it and add it here (+${PTS.custom}).</p>
    <div class="row"><input id="m-name" placeholder="Name (e.g. by the Haunted Mansion)" maxlength="40" style="flex:1 1 200px;font:inherit;font-size:16px;padding:12px;border-radius:12px;border:2px solid #d8cdea">
      <button data-m="add">📍 Add it here</button></div>
    <h3>${p ? 'Practice' : 'Quest'} progress</h3>
    <div class="row"><button class="light" data-m="title">🏠 Title screen</button><button class="red" data-m="reset">Start ${p ? 'practice' : 'the quest'} over</button></div>
    <h3>About</h3>
    <p style="font-size:13.5px">Royal Flush v${esc(VERSION)}. An unofficial fan-made game, not connected with Disney. The map is a hand drawing
    and restroom pins are approximate: if one is off, find it and tap “Pin is off: move it here”. Restrooms change with
    refurbishments, so trust the signs in the park. Your progress is saved on this device only. Works offline once opened.</p>`;
  const body = openPanel('☰ Menu', html);
  body.onclick = (e) => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    const m = b.dataset.m;
    if (m === 'mode'){ closePanel(); setMode(p ? 'gps' : 'practice'); }
    else if (m === 'whole'){ closePanel(); map.follow = false; map.centerOn(G.park.start.x, G.park.start.y, map.startZoom()); }
    else if (m === 'sound'){ S.settings.sound = !S.settings.sound; sound.setSound(S.settings.sound); save(); menuPanel(); }
    else if (m === 'add'){ const id = addRestroom(($('m-name').value || '').trim()); if (id){ closePanel(); openSheet(id); toast('📍 Added! Now tap Found it!', 'good'); } }
    else if (m === 'title'){ closePanel(); showTitle(); }
    else if (m === 'reset'){
      if (b.dataset.sure){ S.parks[slotKey()] = undefined; delete S.parks[slotKey()]; save(); closePanel(); hudCache = ''; refreshAll(); toast('Fresh start. Good luck!'); }
      else { b.dataset.sure = '1'; b.textContent = 'Tap again to wipe it'; }
    }
  };
}

// ---------- buttons ----------
$('b-need').onclick = emergency;
$('b-list').onclick = () => { sound.unlock(); listPanel(); };
$('b-badges').onclick = () => { sound.unlock(); badgesPanel(); };
$('b-menu').onclick = () => { sound.unlock(); menuPanel(); };
$('b-me').onclick = () => {
  sound.unlock();
  if (G.mode === 'gps') askCompass();
  if (!G.me){ toast(G.mode === 'gps' ? '📡 Finding you…' : 'Tap the map to say where you are.'); return; }
  map.follow = G.mode === 'gps';
  map.centerOn(G.me.x, G.me.y, Math.max(map.zoom, 2.2));
};

// ---------- title screen ----------
function titleProgress(){
  const real = S.parks[G.park.id], n = real ? official().filter((r) => real.found[r.id]).length : 0;
  $('t-progress').innerHTML = n
    ? `Your quest: <b>${n} of ${official().length}</b> restrooms found · <b>${Object.keys(real.badges).length}</b> badges`
    : `<b>${official().length} restrooms</b> to find in ${esc(G.park.name)}. Can you get a Royal Flush?`;
  $('t-parks').innerHTML = PARKS.map((p) => `<button data-park="${p.id}" class="${p.id === G.park.id ? 'on' : ''}" ${p.ready ? '' : 'disabled'}>${esc(p.name)}${p.ready ? '' : '<small>coming soon</small>'}</button>`).join('');
}
function showTitle(){
  closeSheet(); closePanel(); stopGPS();
  G.mode = null; G.me = null; map.setMe(null); map.setRoute(null);
  document.body.classList.remove('playing');
  $('title').classList.remove('hidden');
  titleProgress();
}
function play(mode){
  sound.unlock();
  $('title').classList.add('hidden');
  document.body.classList.add('playing');
  layoutPad();
  setMode(mode);
  if (mode === 'practice') map.centerOn(G.me.x, G.me.y + 120, 1.6);
  else map.centerOn(G.park.start.x, G.park.start.y, map.startZoom(), false);
  if (!S.seenHint){ S.seenHint = 1; save(); setTimeout(() => toast('Tap a 🚻 pin to see it. Get there, then tap <b>Found it!</b>', '', 5500), 600); }
}
$('b-go').onclick = () => { askCompass(); play('gps'); };
$('b-practice').onclick = () => play('practice');
$('t-parks').onclick = (e) => { const b = e.target.closest('[data-park]'); if (!b || b.disabled) return; S.park = b.dataset.park; G.park = parkById(S.park); map.setPark(G.park); save(); titleProgress(); };

// offline status
(async () => {
  try {
    if (!('caches' in window)) return;
    for (let i = 0; i < 30; i++){
      const hit = await caches.match('/experiments/royal-flush/__offline-ready__');
      if (hit){ $('offline').textContent = '✓ Saved on this device: plays offline'; return; }
      await new Promise((r) => setTimeout(r, 1000));
    }
  } catch (e) {}
})();

// stop the page bouncing/zooming on iOS
document.addEventListener('gesturestart', (e) => e.preventDefault());

// ---------- for the tests ----------
window.__flush = {
  G, S, map, restrooms, byId, found, score, foundCount, landProgress, BADGES, slot, checkIn, openSheet, closeSheet,
  emergency, nearest, setMode, tick, untick, listPanel, play, showTitle, addRestroom, fixPin, walkTo, onFix,
  washScrub: (sec) => wash.scrubFor && wash.scrubFor(sec),
  setPractice: (x, y) => { walkAnim++; G.me = { x, y, acc: 0, practice: true }; map.setMe(G.me); arrivals(); },
};

titleProgress();
refreshPins();
if (window.__loaded) window.__loaded();
