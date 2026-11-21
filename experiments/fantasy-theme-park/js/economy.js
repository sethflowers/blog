// Money, for Tycoon parks (Sandbox parks keep the books too, but nothing costs anything):
//  - what things cost to build: every edit is priced as it's committed (paths, landscaping, water, and
//    each thing added, changed or removed, with half back for what's taken away), and refused if you
//    can't afford it; undo gives the money back;
//  - running the park: rides and stalls cost a little an hour to run, staff are paid by the hour;
//  - the books: today's and the last two weeks' income and costs;
//  - the park's rating (0-5 stars) from the guests' happiness, the rides, cleanliness and scenery, and
//    the goals it unlocks (bigger rides).
import { CATALOG, model } from './models.js';
import { PIECES } from './coaster/track.js';

const CAT_PRICE = { trees: 70, plants: 45, lights: 160, furniture: 90, features: 350, props: 80, seating: 140, facilities: 450 };
const SPECIAL = { fountain: 1500, obelisk: 700, armillary: 900, bedRed: 90, bedBlue: 90, bedGold: 90, bedPink: 90, rocks: 200, boulder: 150, clock: 600 };
const PIECE_PRICE = { straight: 120, left: 150, right: 150, bigLeft: 220, bigRight: 220, up: 260, down: 240, steepUp: 380, steepDown: 380, boost: 1200, loop: 1600, roll: 2400, hang: 2800, jump: 3500, station: 0 };
export const UNLOCKS = [
  { id: 'wheel', name: 'Big wheel', stars: 1.5, guests: 60 },
  { id: 'coaster', name: 'Coasters', stars: 2.5, guests: 180 },
  { id: 'hang', name: 'Hanging coasters', stars: 3.5, guests: 350 },
];
export const WAGES = { janitor: 14, mechanic: 20 };   // an hour
export const START_MONEY = 60000;

export function priceOf(o){
  if (!o) return 0;
  if (CATALOG[o.type]) return SPECIAL[o.type] ?? CAT_PRICE[CATALOG[o.type].cat] ?? 100;
  switch (o.type){
    case 'gate': return 0;
    case 'lot': return o.w * o.d * 24;
    case 'arch': return 650;
    case 'sign': return 120;
    case 'stall': return 1100;
    case 'building': return (o.floors || []).reduce((a, f) => a + f.length, 0) * 650 + (o.towers || []).length * 2400 + (o.extras || []).length * 160 + (o.use ? 1500 : 0);
    case 'coaster': return 4000 + (o.pieces || []).reduce((a, t) => a + (PIECE_PRICE[t] || 200), 0);
    case 'ride': return o.kind === 'carousel' ? 4000 + o.size * 200 + ((o.tiers || 1) - 1) * 3000 : 6000 + o.size * 320 + (o.gondolas || 16) * 60;
  }
  if (o.type.startsWith('fence_')) return Math.round(Math.hypot(o.x2 - o.x, o.z2 - o.z) * 22);
  return 100;
}
// what an edit costs (negative: money back)
export function priceEdit(park, r){
  const S = park.s;
  let cost = 0;
  const L = r.layers;
  if (L.path) for (const [k, old] of L.path){ const now = S.path[k]; if (now && !old) cost += now === 8 ? 18 : 12; else if (!now && old) cost -= 6; else if (now !== old) cost += 4; }
  if (L.heights) for (const [k, old] of L.heights) cost += Math.abs(S.heights[k] - old) * 3;
  if (L.water) for (const [k] of L.water) cost += 8;
  if (L.paint) cost += L.paint.size * 1;
  for (const [id, json] of r.objs){
    const now = park.obj(id), before = json ? JSON.parse(json) : null;
    if (now && !before) cost += priceOf(now);
    else if (!now && before) cost -= priceOf(before) * 0.5;
    else if (now && before){ const d = priceOf(now) - priceOf(before); cost += d > 0 ? d : d * 0.5; }
  }
  return Math.round(cost);
}

export class Economy {
  constructor(app){ this.app = app; this.park = app.park; this.ensure(); this.tick = 0; this.ratingT = 0; }
  get S(){ return this.park.s; }
  get tycoon(){ return this.S.mode === 'tycoon'; }
  ensure(){
    const S = this.S;
    if (!S.fin) S.fin = [];
    if (S.entryFee === undefined) S.entryFee = S.mode === 'tycoon' ? 20 : 0;
    if (S.parkingFee === undefined) S.parkingFee = 0;
    if (!S.staff) S.staff = { janitor: 0, mechanic: 0 };
    if (S.rating === undefined) S.rating = 0;
    if (!S.unlocked) S.unlocked = S.mode === 'tycoon' ? [] : UNLOCKS.map((u) => u.id);
    if (S.parkOpen === undefined) S.parkOpen = true;
    this.today();
  }
  today(){
    const S = this.S;
    let d = S.fin[S.fin.length - 1];
    if (!d || d.day !== S.day){ d = { day: S.day, income: { entry: 0, rides: 0, food: 0, shops: 0, parking: 0 }, costs: { building: 0, running: 0, wages: 0 }, guests: 0 }; S.fin.push(d); while (S.fin.length > 14) S.fin.shift(); }
    return d;
  }
  // a guest paid for something
  earn(kind, amount){ if (amount <= 0) return; this.today().income[kind] += amount; if (this.tycoon) this.S.money += amount; }
  spend(kind, amount){ if (!amount) return; this.today().costs[kind] += amount; if (this.tycoon) this.S.money -= amount; }
  canAfford(n){ return !this.tycoon || this.S.money >= n; }
  // the hook from Park.commit: price the edit; refuse it if you can't pay
  charge(r){
    const cost = priceEdit(this.park, r);
    r.cost = cost;
    if (!this.tycoon || cost <= 0){ if (cost < 0 && this.tycoon){ this.S.money -= cost; this.today().costs.building += cost; } return true; }
    if (this.S.money < cost){ this.app.ui.toast(`Not enough money: that costs ${fmt(cost)} (you have ${fmt(this.S.money)}).`, 'bad'); return false; }
    this.S.money -= cost; this.today().costs.building += cost;
    return true;
  }
  refund(r, forward){ if (!this.tycoon || !r.cost) return; this.S.money += forward ? -r.cost : r.cost; this.today().costs.building += forward ? r.cost : -r.cost; }
  // every game minute
  minute(rides){
    const S = this.S, d = this.today();
    void d;
    // each game hour: running costs and wages
    if (Math.floor(S.time) % 60 === 0 && S.parkOpen && S.time / 60 >= 9 && S.time / 60 < 21){
      let run = 0;
      for (const o of S.objects){ if ((o.type === 'coaster' || o.type === 'ride') && o.open !== false) run += o.type === 'coaster' ? 45 : 22; else if (o.type === 'stall') run += 8; else if (o.type === 'building' && o.use) run += 12; }
      this.spend('running', run);
      this.spend('wages', S.staff.janitor * WAGES.janitor + S.staff.mechanic * WAGES.mechanic);
    }
    void rides;
  }
  // the rating, from the guests in the park now
  rate(guests){
    const S = this.S, inPark = guests.filter((g) => g.inPark && !g.staff);
    const rides = S.objects.filter((o) => (o.type === 'coaster' || o.type === 'ride') && o.open !== false);
    const kinds = new Set(rides.map((o) => o.type === 'coaster' ? (o.hang ? 'hang' : 'coaster') : o.kind)).size;
    const food = S.objects.filter((o) => o.type === 'stall' || (o.type === 'building' && ['food', 'restaurant'].includes(o.use))).length;
    const happy = inPark.length ? inPark.reduce((a, g) => a + g.happy, 0) / inPark.length : 0.6;
    const litter = (S.litter || []).length, clean = 1 - Math.min(1, litter / Math.max(20, inPark.length * 0.6));
    const scenery = Math.min(1, S.objects.filter((o) => CATALOG[o.type] && CATALOG[o.type].cat !== 'trees').length / 80);
    const value = S.entryFee <= 30 ? 1 : Math.max(0, 1 - (S.entryFee - 30) / 40);
    const stars = Math.min(5, happy * 2.2 + Math.min(1.2, rides.length * 0.2) + kinds * 0.15 + Math.min(0.4, food * 0.1) + clean * 0.5 + scenery * 0.4 + value * 0.2 - (rides.length ? 0 : 1.5));
    S.rating = Math.max(0, Math.round(stars * 10) / 10);
    // goals: what the rating (or the crowd) unlocks
    for (const u of UNLOCKS) if (!S.unlocked.includes(u.id) && (S.rating >= u.stars || inPark.length >= u.guests)){ S.unlocked.push(u.id); this.app.ui.toast(`Unlocked: ${u.name}! (Rides tab)`, 'good'); }
    return { stars: S.rating, happy, rides: rides.length, kinds, clean, scenery, guests: inPark.length };
  }
  locked(id){ return this.tycoon && UNLOCKS.some((u) => u.id === id) && !this.S.unlocked.includes(id); }
  unlockText(id){ const u = UNLOCKS.find((q) => q.id === id); return u ? `Reach ${u.stars}★ or ${u.guests} guests` : ''; }
}
export const fmt = (n) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
void model;
