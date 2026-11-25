// The mystery: who is on the train, who did it, where everyone was, and the clues it left. Pure logic
// (no three.js), so the generator and its solver can be tested on their own.
//
// The crime is made first and the clues follow from it, so the evidence always points at one person:
//  1. seven passengers (your own photo people first, then made-up ones), each with a profession, shoes,
//     fingerprints, hair, clothes and a height; one is the victim, one the murderer;
//  2. where everyone was when the lights went out: some together (they vouch for each other), some
//     alone; the murderer says they were alone somewhere, but was really at the crime scene;
//  3. the clues: fingerprints on the weapon, footprints from the body, a trace of their work on the
//     victim's coat, a hair, a thread, what people heard and saw;
//  4. a solver checks that putting all the clues together leaves only the murderer, and (on Medium and
//     Hard) that no single clue, or pair of clues, gives it away on its own. If not, it tries again.

export function rng(seed){
  let s = (seed >>> 0) || 1;
  return () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// the people's bodies: Microsoft Rocketbox avatars (MIT licence), in models/people/list.json order
export const AVATARS = [
  { id: 'Female_Adult_01', female: true, hair: 'blonde', coat: 'pink' },
  { id: 'Female_Adult_03', female: true, hair: 'black', coat: 'purple' },
  { id: 'Female_Adult_04', female: true, hair: 'blonde', coat: 'brown' },
  { id: 'Female_Adult_05', female: true, hair: 'brown', coat: 'pink' },
  { id: 'Female_Adult_06', female: true, hair: 'black', coat: 'green', covered: true },
  { id: 'Female_Adult_08', female: true, hair: 'brown', coat: 'grey' },
  { id: 'Female_Adult_10', female: true, hair: 'black', coat: 'black', covered: true },
  { id: 'Female_Adult_11', female: true, hair: 'brown', coat: 'brown' },
  { id: 'Female_Adult_12', female: true, hair: 'brown', coat: 'black' },
  { id: 'Male_Adult_01', female: false, hair: 'brown', coat: 'white' },
  { id: 'Male_Adult_02', female: false, hair: 'brown', coat: 'beige' },
  { id: 'Male_Adult_03', female: false, hair: 'grey', coat: 'brown' },
  { id: 'Male_Adult_04', female: false, hair: 'black', coat: 'black' },
  { id: 'Male_Adult_05', female: false, hair: 'grey', coat: 'beige' },
  { id: 'Male_Adult_06', female: false, hair: 'brown', coat: 'red' },
  { id: 'Male_Adult_08', female: false, hair: 'brown', coat: 'blue' },
  { id: 'Male_Adult_10', female: false, hair: 'black', coat: 'red' },
  { id: 'Male_Adult_12', female: false, hair: 'black', coat: 'blue' },
];
export const HAIRS = ['blonde', 'brown', 'black', 'red', 'grey'];
export const COATS = ['pink', 'purple', 'brown', 'green', 'grey', 'black', 'white', 'beige', 'red', 'blue', 'yellow', 'orange'];
export const COAT_HEX = { pink: '#e48aa8', purple: '#8a4ab0', brown: '#6a4428', green: '#5a6a30', grey: '#8a8a8a', black: '#222226', white: '#eeeeea', beige: '#cdb894', red: '#b02a2a', blue: '#3a5a9a', yellow: '#e0c030', orange: '#e07a20' };
export const HAIR_HEX = { blonde: '#d8b860', brown: '#5a3a20', black: '#1a1412', red: '#a8482a', grey: '#a8a8a4' };

// what each profession leaves behind. Traces come in five kinds, three professions each, so on Medium
// and Hard "a fine white powder" could be flour, talc or chalk until you work out who it fits.
export const TRACE_KINDS = {
  white: 'a fine white powder', dark: 'a dark, greasy smudge', earth: 'gritty earth', colour: 'bright coloured specks', sticky: 'something sticky',
};
export const PROFESSIONS = [
  { id: 'baker', name: 'Baker', icon: '🥖', trace: 'flour', kind: 'white', hat: 'baker', soles: ['clog', 'trainer'], tool: 'a bag of bread rolls' },
  { id: 'doctor', name: 'Doctor', icon: '🩺', trace: 'talcum powder from rubber gloves', kind: 'white', hat: null, soles: ['smooth', 'smooth', 'heel'], tool: 'a medical bag' },
  { id: 'teacher', name: 'Teacher', icon: '🍎', trace: 'blackboard chalk', kind: 'white', hat: null, soles: ['smooth', 'trainer', 'heel'], tool: 'a pile of marking' },
  { id: 'mechanic', name: 'Mechanic', icon: '🔧', trace: 'engine oil', kind: 'dark', hat: 'cap', soles: ['workboot'], tool: 'a toolbox' },
  { id: 'author', name: 'Author', icon: '✒️', trace: 'fountain-pen ink', kind: 'dark', hat: null, soles: ['smooth', 'heel'], tool: 'a half-written book' },
  { id: 'blacksmith', name: 'Blacksmith', icon: '⚒️', trace: 'soot and iron filings', kind: 'dark', hat: null, soles: ['workboot'], tool: 'a hammer and tongs' },
  { id: 'gardener', name: 'Gardener', icon: '🌱', trace: 'garden soil', kind: 'earth', hat: 'straw', soles: ['welly', 'workboot'], tool: 'a trowel and seeds' },
  { id: 'fisher', name: 'Fisher', icon: '🎣', trace: 'beach sand', kind: 'earth', hat: 'bucket', soles: ['welly'], tool: 'a fishing rod' },
  { id: 'potter', name: 'Potter', icon: '🏺', trace: 'potter\'s clay', kind: 'earth', hat: null, soles: ['trainer', 'clog'], tool: 'a lump of clay' },
  { id: 'painter', name: 'Painter', icon: '🎨', trace: 'flecks of oil paint', kind: 'colour', hat: 'beret', soles: ['trainer', 'smooth'], tool: 'a box of paints' },
  { id: 'jeweller', name: 'Jeweller', icon: '💎', trace: 'red polishing rouge', kind: 'colour', hat: null, soles: ['smooth', 'heel'], tool: 'a magnifying loupe' },
  { id: 'tailor', name: 'Tailor', icon: '🧵', trace: 'snippets of coloured thread', kind: 'colour', hat: null, soles: ['smooth', 'heel'], tool: 'a tape measure' },
  { id: 'beekeeper', name: 'Beekeeper', icon: '🐝', trace: 'honey', kind: 'sticky', hat: 'veil', soles: ['welly', 'workboot'], tool: 'a jar of honey' },
  { id: 'chef', name: 'Chef', icon: '👨‍🍳', trace: 'cooking grease', kind: 'sticky', hat: 'toque', soles: ['clog', 'smooth'], tool: 'a set of knives in a roll' },
  { id: 'candlemaker', name: 'Candle maker', icon: '🕯️', trace: 'candle wax', kind: 'sticky', hat: null, soles: ['smooth', 'trainer'], tool: 'a box of candles' },
];
export const PROF = Object.fromEntries(PROFESSIONS.map((p) => [p.id, p]));
export const SOLES = {
  workboot: 'chunky work boots', welly: 'wellington boots', trainer: 'trainers', smooth: 'smooth leather shoes', heel: 'shoes with a small heel', clog: 'wooden clogs',
};
export const PATTERNS = { loop: 'a loop', whorl: 'a whorl', arch: 'an arch' };
export const HEIGHTS = { short: 'short', medium: 'of medium height', tall: 'tall' };

// the train, front to back. Places are where people can be; scenes where the crime can happen.
export const CARS = ['baggage', 'kitchen', 'dining', 'lounge', 'sleeper', 'observation'];
export const CAR_NAME = { baggage: 'baggage car', kitchen: 'kitchen car', dining: 'dining car', lounge: 'lounge car', sleeper: 'sleeping car', observation: 'observation car', platform: 'back platform' };
export const placeCar = (p) => (p.startsWith('cabin') ? 'sleeper' : p === 'platform' ? 'observation' : p);
export const SCENES = ['lounge', 'observation', 'baggage', 'kitchen', 'sleeper'];
// what the footprints were made in, at each scene
export const MEDIUM = { lounge: 'spilt lemonade', observation: 'rainwater from the back door', baggage: 'spilt engine oil', kitchen: 'spilt flour', sleeper: 'spilt cocoa' };
export const WEAPONS = [
  { id: 'candlestick', name: 'a brass candlestick', home: 'lounge', from: 'the piano in the lounge car' },
  { id: 'book', name: 'a very heavy book', home: 'lounge', from: 'the bookcase in the lounge car' },
  { id: 'stick', name: 'a silver-topped walking stick', home: 'observation', from: 'the umbrella stand in the observation car' },
  { id: 'wrench', name: 'a big iron spanner', home: 'baggage', from: 'the workbench in the baggage car' },
  { id: 'rollingpin', name: 'a wooden rolling pin', home: 'kitchen', from: 'the kitchen shelf' },
  { id: 'pan', name: 'a heavy frying pan', home: 'kitchen', from: 'the hooks over the kitchen stove' },
  { id: 'bookend', name: 'a stone bookend shaped like a lion', home: 'lounge', from: 'the bookcase in the lounge car' },
  { id: 'extinguisher', name: 'a fire extinguisher', home: 'sleeper', from: 'its bracket in the sleeping car' },
];
const NAMES_F = ['Ada', 'Beatrice', 'Clara', 'Daisy', 'Edith', 'Fiona', 'Grace', 'Hazel', 'Iris', 'Julia', 'Lena', 'Mabel', 'Nora', 'Olive', 'Priya', 'Rosa', 'Sofia', 'Tara', 'Violet', 'Zara', 'Amara', 'Mei', 'Leila', 'Ingrid'];
const NAMES_M = ['Albert', 'Benedict', 'Charles', 'Desmond', 'Edward', 'Felix', 'George', 'Harold', 'Isaac', 'Jasper', 'Kenji', 'Leon', 'Marcus', 'Nathan', 'Oscar', 'Patrick', 'Rupert', 'Samuel', 'Theo', 'Victor', 'Walter', 'Omar', 'Ravi', 'Kofi'];
const SURNAMES = ['Ashworth', 'Blackwood', 'Carrington', 'Delaney', 'Ellsworth', 'Fairfax', 'Grimshaw', 'Hartley', 'Ingram', 'Jennings', 'Kingsley', 'Lockwood', 'Marlowe', 'Northcott', 'Okafor', 'Pemberton', 'Quill', 'Ravensworth', 'Sinclair', 'Thornton', 'Underwood', 'Vance', 'Whitlock', 'Yardley', 'Nakamura', 'Patel', 'Moreau', 'Rossi', 'Novak', 'Mensah'];
const MOTIVES = [
  { id: 'money', note: (n) => `${n} still owes me 500 pounds. I want it back before we reach the city!`, says: 'I borrowed some money a while ago. I was going to pay it back, honestly!' },
  { id: 'prize', note: (n) => `${n} is still cross that I won the Golden Award instead of them. Ha!`, says: 'They won an award that should have been mine. But that was years ago.' },
  { id: 'secret', note: (n) => `I know ${n}'s secret. Tomorrow I will tell everyone.`, says: 'A secret? I... I don\'t know what you mean.' },
  { id: 'shop', note: (n) => `Bought the building ${n}'s shop is in. I shall close it down next week.`, says: 'They bought the building my shop is in, and they were going to close it down.' },
  { id: 'idea', note: (n) => `Sold ${n}'s clever idea as my own. Made a fortune!`, says: 'They stole my idea and made a fortune from it.' },
];
const NO_MOTIVE = ['I only met them at dinner tonight. They seemed nice enough.', 'We said hello at dinner, that\'s all.', 'I didn\'t know them. They talked a lot about money at dinner.', 'I\'d never met them before tonight.'];
const ACTIVITY = ['reading a book', 'writing a letter', 'getting ready for bed', 'listening to the rain', 'having a nap'];
const PAIR_DOING = { lounge: 'playing cards with {o} in the lounge car', observation: 'watching the storm with {o} in the observation car', kitchen: 'making hot chocolate with {o} in the kitchen car', baggage: 'helping {o} find a lost suitcase in the baggage car', platform: 'getting some fresh air with {o} under the roof of the back platform' };
const ALONE_DOING = { lounge: 'playing the piano in the lounge car, on my own', observation: 'looking out at the storm in the observation car, on my own', kitchen: 'getting a midnight snack in the kitchen car. Nobody else was there', baggage: 'fetching something from my trunk in the baggage car, on my own', platform: 'out on the back platform getting some air, on my own' };

// pairs: how many pairs were together (they vouch for each other); conductor: how many people the
// conductor heard in their cabins; kinds: the clues; how sure each one is
export const DIFFICULTY = {
  easy: { name: 'Easy', pairs: 1, conductor: 1, print: 'full', foot: 'both', trace: 'exact', kinds: ['print', 'foot', 'trace', 'hair'], minClues: 1, warnings: 1, herrings: 0 },
  medium: { name: 'Medium', pairs: 1, conductor: 0, print: 'partial', foot: 'both', trace: 'kind', kinds: ['print', 'foot', 'trace', 'direction', 'look'], minClues: 2, warnings: 0, herrings: 1 },
  hard: { name: 'Hard', pairs: 1, conductor: 0, print: 'partial', foot: 'one', trace: 'kind', kinds: ['print', 'foot', 'trace', 'direction', 'height', 'look'], minClues: 3, warnings: 0, herrings: 2 },
};

// ---------------------------------------------------------------------------------------------
// make a mystery. cast: your own people ({ id, name, female, avatar, prof, hair, height, neverVictim })
export function makeMystery({ seed = 1, difficulty = 'medium', cast = [] } = {}){
  const D = DIFFICULTY[difficulty] || DIFFICULTY.medium;
  const R = rng(seed);
  for (let attempt = 0; attempt < 400; attempt++){
    const m = attemptMystery(R, D, difficulty, cast);
    if (m){ m.seed = seed; m.attempts = attempt + 1; return m; }
  }
  throw new Error('Could not make a mystery');
}

function attemptMystery(R, D, difficulty, cast){
  const pick = (a) => a[Math.floor(R() * a.length)];
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--){ const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const between = (a, b) => a + Math.floor(R() * (b - a + 1));
  const other = (list, v) => pick(list.filter((x) => x !== v));

  // --- the passengers: your own people first (their looks are fixed), then empty places for made-up ones
  const people = [];
  const myCast = shuffle(cast).slice(0, 7);
  if (myCast.length === 7 && myCast.every((c) => c.neverVictim !== false)) myCast.pop();   // someone has to be the victim
  for (const c of myCast){
    people.push({ cast: c.id, name: c.name, female: !!c.female, avatar: c.avatar ?? (c.female ? 0 : 9), prof: c.prof && PROF[c.prof] ? c.prof : null, fixedProf: !!(c.prof && PROF[c.prof]),
      hair: c.hair || 'brown', heightBand: c.height || null, fixedHeight: !!c.height, neverVictim: c.neverVictim !== false, photo: true });
  }
  while (people.length < 7) people.push({ avatar: null, prof: null, neverVictim: false });
  people.forEach((p, i) => { p.i = i; p.cabin = i + 1; });
  // two of your people can't both have the same profession
  const fixed = people.filter((p) => p.fixedProf).map((p) => p.prof);
  if (new Set(fixed).size !== fixed.length) people.forEach((p) => { if (p.fixedProf && fixed.indexOf(p.prof) !== fixed.lastIndexOf(p.prof) && people.find((q) => q.prof === p.prof) !== p){ p.prof = null; p.fixedProf = false; } });

  // --- who's who
  const victim = pick(people.filter((p) => !p.neverVictim));
  const suspects = shuffle(people.filter((p) => p !== victim));
  const murderer = suspects[0];
  const innocents = suspects.slice(1);
  const scene = pick(SCENES);
  const weapon = pick(WEAPONS.filter((w) => w.home === scene || R() < 0.3));
  const pairs = [], confirmed = [];
  for (let k = 0; k < D.pairs; k++) pairs.push([innocents[2 * k], innocents[2 * k + 1]]);
  for (let k = 0; k < D.conductor; k++) confirmed.push(innocents[2 * D.pairs + k]);
  const loners = innocents.slice(2 * D.pairs + D.conductor);       // alone, and nobody can vouch for them
  const candidates = [...loners, murderer];

  // --- which clues there are. 'look' is a hair or a thread from their clothes (one or the other: few
  // people share both).
  // (your own people's looks are fixed, so with several of them it may have to do without)
  const look = cast.length >= 2 ? pick(['hair', 'fibre', null]) : R() < 0.5 ? 'hair' : 'fibre';
  let kinds = D.kinds.map((k) => (k === 'look' ? look : k)).filter(Boolean);
  // footsteps can only rule people out if there's train on both sides of the scene
  if (scene === 'baggage' || scene === 'observation') kinds = kinds.includes('height') ? kinds.filter((k) => k !== 'direction') : kinds.map((k) => (k === 'direction' ? 'height' : k));
  const footShows = D.foot === 'both' ? 'both' : R() < 0.5 ? 'size' : 'sole';
  // each innocent loner is ruled out by their own share of the clues, and fits all the others: then no
  // one clue (Medium) or two clues (Hard) alone can give the murderer away, but all of them together do
  const rule = new Map(loners.map((p) => [p, new Set()]));
  if (D.minClues > 1){
    const ks = shuffle(kinds);
    ks.forEach((k, n) => rule.get(loners[n % loners.length]).add(k));
  }

  // --- places when the lights went out
  const rooms = shuffle(['lounge', 'observation', 'kitchen', 'baggage', 'platform'].filter((r) => r !== scene && !(scene === 'observation' && r === 'platform')));
  const carOf = (place) => CARS.indexOf(placeCar(place)), sc = CARS.indexOf(scene);
  const side = (place) => (carOf(place) < sc ? 'front' : carOf(place) > sc ? 'back' : null);
  for (const [a, b] of pairs){ const room = rooms.pop(); a.place = b.place = room; a.with = b.i; b.with = a.i; }
  for (const a of confirmed){ a.place = 'cabin' + a.cabin; a.with = null; }
  victim.place = scene;
  // the murderer says they were alone (and must have gone somewhere else, if footsteps are a clue)
  const placeFor = (p, want) => {
    const options = shuffle(['cabin' + p.cabin, ...rooms]).filter((pl) => (want === undefined ? true : want === null ? side(pl) !== null : side(pl) === want));
    const pl = options[0]; if (!pl) return false;
    if (!pl.startsWith('cabin')) rooms.splice(rooms.indexOf(pl), 1);
    p.place = pl; p.with = null; return true;
  };
  if (!placeFor(murderer, kinds.includes('direction') ? null : undefined)) return null;
  const dir = side(murderer.place);
  for (const a of loners){
    const r = rule.get(a);
    const want = !kinds.includes('direction') ? undefined : r.has('direction') ? (dir === 'front' ? 'back' : 'front') : dir;
    if (!placeFor(a, want)) return null;
  }

  // --- the murderer's looks
  const freeAvatars = new Set(AVATARS.map((a, i) => i).filter((i) => !people.some((p) => p.avatar === i)));
  const takeAvatar = (p, test) => {
    if (p.avatar != null) return test(p.avatar);
    const opts = shuffle([...freeAvatars].filter(test)); if (!opts.length) return false;
    p.avatar = opts[0]; freeAvatars.delete(p.avatar); return true;
  };
  const hairOf = (p, a) => (p.photo ? p.hair : AVATARS[a].hair);
  const profsLeft = new Set(PROFESSIONS.map((q) => q.id).filter((id) => !people.some((p) => p.fixedProf && p.prof === id)));
  const takeProf = (p, test) => {
    if (p.prof){ if (!test(p.prof)) return false; profsLeft.delete(p.prof); return true; }
    const opts = shuffle([...profsLeft].filter(test)); if (!opts.length) return false;
    p.prof = opts[0]; profsLeft.delete(p.prof); return true;
  };
  const describe = (p) => {
    p.female = p.photo ? p.female : AVATARS[p.avatar].female;
    p.hair = hairOf(p, p.avatar);
    p.coat = AVATARS[p.avatar].coat;
  };
  takeAvatar(murderer, () => true); describe(murderer);
  takeProf(murderer, () => true);
  murderer.pattern = pick(Object.keys(PATTERNS));
  murderer.sole = pick(PROF[murderer.prof].soles);
  murderer.shoe = murderer.female ? between(3, 8) : between(6, 11);
  if (!murderer.heightBand) murderer.heightBand = pick(['short', 'medium', 'medium', 'tall']);

  // --- the innocent loners: like the murderer except where their clues rule them out
  for (const a of loners){
    const r = rule.get(a), out = (k) => r.has(k), used = (k) => kinds.includes(k);
    const lookOk = (av) => {
      if (used('hair') && (hairOf(a, av) === murderer.hair) === out('hair')) return false;
      if (used('fibre') && (AVATARS[av].coat === murderer.coat) === out('fibre')) return false;
      return true;
    };
    if (!takeAvatar(a, lookOk)) return null;
    describe(a);
    const tr = (id) => (D.trace === 'exact' ? id !== murderer.prof : (PROF[id].kind === PROF[murderer.prof].kind) !== out('trace'));
    if (!takeProf(a, tr)) return null;
    a.pattern = used('print') && !out('print') && D.print === 'partial' ? murderer.pattern : other(Object.keys(PATTERNS), D.print === 'partial' ? murderer.pattern : null);
    if (D.print === 'full') a.pattern = pick(Object.keys(PATTERNS));
    a.sole = pick(PROF[a.prof].soles); a.shoe = a.female ? between(3, 8) : between(6, 11);
    if (used('foot')){
      if (!out('foot')){ if (footShows !== 'size') a.sole = murderer.sole; if (footShows !== 'sole') a.shoe = murderer.shoe; }
      else {
        if (footShows === 'size' || (footShows === 'both' && R() < 0.5)){ if (a.shoe === murderer.shoe) a.shoe += a.shoe > 5 ? -1 : 1; }
        else if (a.sole === murderer.sole) a.sole = other(Object.keys(SOLES), murderer.sole);
      }
    }
    if (used('height')){
      if (a.fixedHeight){ if ((a.heightBand === murderer.heightBand) === out('height')) return null; }
      else a.heightBand = out('height') ? other(['short', 'medium', 'tall'], murderer.heightBand) : murderer.heightBand;
    } else if (!a.heightBand) a.heightBand = pick(['short', 'medium', 'medium', 'tall']);
  }
  // --- everyone else: anything goes
  for (const p of [victim, ...pairs.flat(), ...confirmed]){
    if (!takeAvatar(p, () => true)) return null; describe(p);
    if (!takeProf(p, () => true)) return null;
    p.pattern = pick(Object.keys(PATTERNS)); p.sole = pick(PROF[p.prof].soles); p.shoe = p.female ? between(3, 8) : between(6, 11);
    if (!p.heightBand) p.heightBand = pick(['short', 'medium', 'medium', 'tall']);
  }
  // made-up people's names
  const usedFirst = new Set(people.filter((p) => p.name).map((p) => p.name.split(' ')[0])), usedSur = new Set();
  for (const p of people){
    if (p.name) continue;
    let first; do first = pick(p.female ? NAMES_F : NAMES_M); while (usedFirst.has(first));
    let sur; do sur = pick(SURNAMES); while (usedSur.has(sur));
    usedFirst.add(first); usedSur.add(sur); p.name = `${first} ${sur}`;
  }
  const conductorAvatar = shuffle([...freeAvatars].filter((i) => !AVATARS[i].covered))[0] ?? 9;

  // --- the clues, and the solver's check
  const clues = {
    print: { show: D.print, pattern: murderer.pattern, owner: murderer.i },
    foot: { show: footShows, size: murderer.shoe, sole: murderer.sole },
    trace: { show: D.trace, prof: murderer.prof, kind: PROF[murderer.prof].kind },
    hair: { colour: murderer.hair },
    fibre: { colour: murderer.coat },
    direction: dir ? { dir, scene } : null,
    height: { band: murderer.heightBand },
  };
  if (!solves(kinds, clues, candidates, murderer, D.minClues)) return null;

  // --- witnesses (people who were with someone: you can trust them)
  const trusted = shuffle([...pairs.flat(), ...confirmed]);
  const dirWitness = kinds.includes('direction') ? trusted.pop() : null;
  const heightWitness = kinds.includes('height') ? trusted.pop() : null;
  if ((kinds.includes('direction') && !dirWitness) || (kinds.includes('height') && !heightWitness)) return null;

  // --- motives: the murderer had one, and so did one or two innocent people
  const motives = shuffle(MOTIVES);
  murderer.motive = motives.pop().id;
  for (const p of shuffle(innocents).slice(0, D.minClues > 1 ? 2 : 1)) p.motive = motives.pop().id;

  // --- red herrings: an innocent loner's prints on the scene's door handle, or on a glass there
  const herrings = [];
  shuffle(loners).slice(0, D.herrings).forEach((p, k) => { p.visited = k === 0 ? 'door' : 'glass'; herrings.push({ who: p.i, what: p.visited }); });
  // who had the Coke at dinner (their prints are on it)
  const cokePrints = shuffle(people.filter((p) => p !== murderer && p !== victim)).slice(0, 2).map((p) => p.i);
  cokePrints.push(victim.i); if (R() < 0.5) cokePrints.push(murderer.i);

  // --- what everyone says
  for (const p of suspects){
    const o = p.with != null ? people[p.with] : null;
    p.says = {};
    if (p.place.startsWith('cabin')) p.says.where = `I was in my cabin, number ${p.cabin}, ${pick(ACTIVITY)}. I was on my own.`;
    else if (o) p.says.where = 'I was ' + PAIR_DOING[p.place].replace('{o}', o.name) + `. Ask ${o.name.split(' ')[0]}!`;
    else p.says.where = 'I was ' + ALONE_DOING[p.place] + '.';
    const lines = [];
    const near = Math.abs(carOf(p.place) - sc) <= 1;
    lines.push(near ? `I heard a crash from the ${CAR_NAME[scene]}, and a scream.` : 'I heard a scream, somewhere down the train.');
    if (p === dirWitness) lines.push(`Then I heard quick footsteps hurrying away towards the ${dir} of the train.`);
    if (p === heightWitness) lines.push(`In a flash of lightning I saw someone hurry past the window. I couldn't see their face, but they were ${HEIGHTS[murderer.heightBand]}.`);
    if (p.visited === 'door') lines.push(`Before dinner I went into the ${CAR_NAME[scene]} to fetch my ${pick(['scarf', 'glasses', 'book', 'gloves'])}.`);
    if (p.visited === 'glass') lines.push(`Before dinner I had a drink with ${victim.name.split(' ')[0]} in the ${CAR_NAME[scene]}.`);
    if (lines.length === 1) lines.push(p === murderer ? 'Nothing else. Nothing at all!' : 'Apart from that, only the storm and the rattle of the wheels.');
    p.says.heard = lines.join(' ');
    p.says.victim = p.motive ? MOTIVES.find((m) => m.id === p.motive).says : pick(NO_MOTIVE);
  }
  const conductorSays = confirmed.length
    ? `When the lights went out I took my torch and walked through the sleeping car. I heard ${confirmed.map((p) => `${p.name} in cabin ${p.cabin}`).join(' and ')}, so I know they were in there the whole time.`
    : 'When the lights went out I stayed here in the dining car with you, Detective. I couldn\'t see a thing!';
  const victimNote = shuffle(people.filter((p) => p.motive)).map((p) => MOTIVES.find((m) => m.id === p.motive).note(p.name));
  for (const p of people){ delete p.fixedProf; delete p.fixedHeight; }
  return {
    difficulty, people, victim: victim.i, murderer: murderer.i, scene, weapon: weapon.id, clues, kinds,
    candidates: candidates.map((p) => p.i), pairs: pairs.map(([a, b]) => [a.i, b.i]), confirmed: confirmed.map((p) => p.i),
    dirWitness: dirWitness ? dirWitness.i : null, heightWitness: heightWitness ? heightWitness.i : null,
    herrings, cokePrints, conductorAvatar, conductorSays, victimNote, medium: MEDIUM[scene],
    time: `${9 + Math.floor(R() * 2)}:${String(10 + Math.floor(R() * 49)).padStart(2, '0')}`,
  };
}

// do the clues, all together, leave only the murderer among the people nobody can vouch for? And on
// Medium / Hard, is there no single clue / pair of clues that does it alone?
export function solves(kinds, clues, candidates, murderer, minClues){
  const fs = kinds.map((k) => fitter(k, clues));
  const left = candidates.filter((p) => fs.every((f) => f(p)));
  if (left.length !== 1 || left[0] !== murderer) return false;
  if (minClues >= 2 && fs.some((f) => candidates.filter(f).length === 1)) return false;
  if (minClues >= 3) for (let a = 0; a < fs.length; a++) for (let b = a + 1; b < fs.length; b++) if (candidates.filter((p) => fs[a](p) && fs[b](p)).length === 1) return false;
  return true;
}

// does person p fit clue k?
export function fitter(k, C){
  switch (k){
    case 'print': return C.print.show === 'full' ? (p) => p.i === C.print.owner : (p) => p.pattern === C.print.pattern;
    case 'foot': return C.foot.show === 'both' ? (p) => p.shoe === C.foot.size && p.sole === C.foot.sole : C.foot.show === 'size' ? (p) => p.shoe === C.foot.size : (p) => p.sole === C.foot.sole;
    case 'trace': return C.trace.show === 'exact' ? (p) => p.prof === C.trace.prof : (p) => PROF[p.prof].kind === C.trace.kind;
    case 'hair': return (p) => p.hair === C.hair.colour;
    case 'fibre': return (p) => p.coat === C.fibre.colour;
    case 'direction': return (p) => { const c = CARS.indexOf(placeCar(p.place)), s = CARS.indexOf(C.direction.scene); return C.direction.dir === 'front' ? c < s : c > s; };
    case 'height': return (p) => p.heightBand === C.height.band;
    default: return () => true;
  }
}
