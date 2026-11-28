// The recipes: base flavours, ingredients, effects, and outcome(), which says what a recipe does.
// outcome() is a pure function of the recipe (a seeded hash, the same for everyone, every time), so
// the same ingredients always do the same thing and the catalogue can be trusted.

export const BASES = [
  { id: 'vanilla', name: 'Vanilla', emoji: '🍦', color: '#fff3c8', price: 0 },
  { id: 'choc', name: 'Chocolate', emoji: '🍫', color: '#7a4428', price: 0 },
  { id: 'straw', name: 'Strawberry', emoji: '🍓', color: '#ff9cb8', price: 0 },
  { id: 'mint', name: 'Mint', emoji: '🌿', color: '#a8f0c8', price: 25 },
  { id: 'bubble', name: 'Bubblegum', emoji: '🫧', color: '#7ad8ff', price: 40 },
];

// top: how it looks on the scoop (sprinkles, chunks, drizzle, bubbles, sparks, goo, hairs, stars)
export const INGREDIENTS = [
  { id: 'sprinkles', name: 'Rainbow Sprinkles', emoji: '🌈', color: '#ff6ad5', top: 'sprinkles', nice: true, price: 0 },
  { id: 'helium', name: 'Helium Gas', emoji: '🎈', color: '#ff4a6a', top: 'bubbles', effect: 'float', price: 0 },
  { id: 'chameleon', name: 'Chameleon Spit', emoji: '🦎', color: '#5adf3a', top: 'goo', effect: 'colour', price: 0 },
  { id: 'owl', name: 'Owl Eye Drops', emoji: '🦉', color: '#ffd23a', top: 'drizzle', effect: 'bigEyes', price: 0 },
  { id: 'elephant', name: 'Elephant Earwax', emoji: '🐘', color: '#c8a070', top: 'chunks', effect: 'bigEars', price: 0 },
  { id: 'puffer', name: 'Puffer Fish Puffs', emoji: '🐡', color: '#ffb03a', top: 'bubbles', effect: 'swell', price: 0 },
  { id: 'baldy', name: 'Hair-Be-Gone Gel', emoji: '🧴', color: '#9adfff', top: 'goo', effect: 'bald', price: 0 },
  { id: 'cherry', name: 'Cherries', emoji: '🍒', color: '#d8102a', top: 'cherry', nice: true, price: 10 },
  { id: 'spider', name: 'Spider Eggs', emoji: '🕷️', color: '#3a2a4a', top: 'chunks', effect: 'manyEyes', price: 20 },
  { id: 'beetle', name: 'Beetle Juice', emoji: '🪲', color: '#3a8a2a', top: 'drizzle', effect: 'bug', price: 25 },
  { id: 'wolf', name: 'Werewolf Whiskers', emoji: '🐺', color: '#6a5a4a', top: 'hairs', effect: 'animal', price: 30 },
  { id: 'tnt', name: 'Dynamite Dust', emoji: '🧨', color: '#e8301a', top: 'sparks', effect: 'explode', price: 30 },
  { id: 'shrink', name: 'Shrinking Salts', emoji: '🔬', color: '#e8e8ff', top: 'sprinkles', effect: 'tiny', price: 25 },
  { id: 'giraffe', name: 'Giraffe Juice', emoji: '🦒', color: '#f0b030', top: 'drizzle', effect: 'longNeck', price: 25 },
  { id: 'fibber', name: 'Fibber Fudge', emoji: '🤥', color: '#a8622a', top: 'chunks', effect: 'longNose', price: 20 },
  { id: 'pepper', name: 'Dragon Pepper', emoji: '🌶️', color: '#ff3a10', top: 'chunks', effect: 'fire', price: 30 },
  { id: 'ghost', name: 'Ghost Goo', emoji: '👻', color: '#e0f8ff', top: 'goo', effect: 'invisible', price: 35 },
  { id: 'lightning', name: 'Bottled Lightning', emoji: '⚡', color: '#fff04a', top: 'sparks', effect: 'zap', price: 35 },
  { id: 'beard', name: 'Mega-Beard Tonic', emoji: '🧔', color: '#8a5a2a', top: 'hairs', effect: 'beard', price: 25 },
  { id: 'rubber', name: 'Rubber Ball Bits', emoji: '🏀', color: '#ff7a1a', top: 'chunks', effect: 'bouncy', price: 30 },
  { id: 'disco', name: 'Disco Dust', emoji: '🪩', color: '#c87aff', top: 'stars', effect: 'dance', price: 35 },
  { id: 'unicorn', name: 'Unicorn Tears', emoji: '🦄', color: '#c8f0ff', top: 'stars', nice: true, price: 45 },
];
export const ING = Object.fromEntries(INGREDIENTS.map((i) => [i.id, i]));
export const BASE = Object.fromEntries(BASES.map((b) => [b.id, b]));

// kind: 'whole' turns the whole customer into something else (wins over everything);
// say: what they say; ask: how a customer asks for it
export const EFFECTS = {
  delicious: { name: 'Delicious!', emoji: '😋', say: ['MMMMMM!', 'Best. Ice cream. EVER!', 'Yummy yummy!', 'Oh my, that is GOOD!'], ask: ['Something delicious, please!', 'Just make it yummy!'] },
  plain: { name: 'Just ice cream', emoji: '🍦', say: ['Meh. A bit plain.', 'It\'s... ice cream.', 'Hm. Boring.'] },
  float: { name: 'Floats like a balloon', emoji: '🎈', say: ['Wheeeeee!', 'Help! I\'m floating!', 'I\'m a BALLOON!'], ask: ['I\'ve always wanted to fly!', 'Can you make me float?'] },
  colour: { name: 'Changes colour', emoji: '🎨', say: ['Why am I THIS colour?!', 'Ooh, it suits me!', 'My skin!'], ask: ['I\'m bored of my colour.', 'Make me a new colour!'] },
  bigEyes: { name: 'Huge eyes', emoji: '👀', say: ['I CAN SEE EVERYTHING!', 'Whoa, so bright!', 'My eyes! They\'re ENORMOUS!'], ask: ['I need bigger eyes!', 'I want to see better!'] },
  bigEars: { name: 'Huge ears', emoji: '👂', say: ['WHAT? I CAN HEAR A FLY SNEEZE!', 'Flap flap flap!', 'Pardon?!'], ask: ['I want to hear better!', 'Give me big ears!'] },
  manyEyes: { name: 'Lots of eyes', emoji: '🕷️', say: ['I can see behind me!', 'Blink blink blink blink...', 'Why so many eyes?!'], ask: ['I want eyes in the back of my head!'] },
  swell: { name: 'Swells up', emoji: '🐡', say: ['I feel... puffy.', 'Uh oh. Bloaty.', 'Bwoooomp!'], ask: ['Make me big and strong!', 'I want to be HUGE!'] },
  bald: { name: 'Hair falls out', emoji: '🧑‍🦲', say: ['MY HAIR!', 'So shiny...', 'It\'s breezy up there!'], ask: ['I need a haircut. A big one.'] },
  bug: { name: 'Turns into a bug', emoji: '🪲', say: ['Bzzz?!', 'Click click!', 'I have SIX LEGS!'], ask: ['I want to be a bug!', 'I wish I could crawl on walls!'] },
  animal: { name: 'Turns into an animal', emoji: '🐷', say: ['Oink!', 'Ribbit?!', 'Bok bok!', 'Moooo!'], ask: ['I want to be an animal!', 'Can you turn me into an animal?'] },
  explode: { name: 'Explodes', emoji: '💥', say: ['Oooooh...', 'Boooo...', 'I\'m a ghost now...'], ask: ['I want to go out with a BANG!'] },
  tiny: { name: 'Shrinks tiny', emoji: '🐭', say: ['Eeek! Squeak!', 'Everything is so big!', 'Don\'t step on me!'], ask: ['Make me small!', 'I want to be tiny!'] },
  longNeck: { name: 'Long neck', emoji: '🦒', say: ['Nice view up here!', 'Mind my head!', 'I can see the roof!'], ask: ['I want to be taller!', 'I can never reach the top shelf.'] },
  longNose: { name: 'Long nose', emoji: '🤥', say: ['I didn\'t lie! Honest!', 'My nose!', 'Boing!'], ask: ['I want a nose like a carrot!'] },
  fire: { name: 'Breathes fire', emoji: '🔥', say: ['HOT HOT HOT!', 'Rawrrrr!', 'Water! WATER!'], ask: ['I want to be a dragon!', 'Something spicy!'] },
  invisible: { name: 'Goes invisible', emoji: '👻', say: ['Where did I go?!', 'Can you see me?', 'Spooooky!'], ask: ['I want to be invisible!'] },
  zap: { name: 'Gets zapped', emoji: '⚡', say: ['BZZZZT!', 'That was SHOCKING!', 'My hair!'], ask: ['I want a wild hairstyle!', 'Something with a kick!'] },
  beard: { name: 'Grows a huge beard', emoji: '🧔', say: ['Look at my BEARD!', 'Hmmmm, majestic.', 'It itches!'], ask: ['I want a beard like a wizard!'] },
  bouncy: { name: 'Goes bouncy', emoji: '🏀', say: ['Boing! Boing! Boing!', 'I can\'t stop!', 'Weeee-boing!'], ask: ['I want to jump high!'] },
  dance: { name: 'Can\'t stop dancing', emoji: '🕺', say: ['Can\'t... stop... DANCING!', 'Groovy!', 'Boogie time!'], ask: ['I want to dance!', 'Make me a disco star!'] },
};
// the effects to find (the catalogue counts these)
export const FINDABLE = Object.keys(EFFECTS).filter((k) => k !== 'plain');
export const WHOLE = new Set(['explode', 'bug', 'animal']);
export const COLOURS = [
  { id: 'blue', name: 'blue', c: '#3a7aff' }, { id: 'green', name: 'green', c: '#3ad84a' }, { id: 'purple', name: 'purple', c: '#a050ff' },
  { id: 'orange', name: 'orange', c: '#ff8a1a' }, { id: 'pink', name: 'hot pink', c: '#ff4ab8' }, { id: 'yellow', name: 'yellow', c: '#ffe02a' },
  { id: 'rainbow', name: 'rainbow', c: '#ffffff' }, { id: 'stripes', name: 'stripy', c: '#ffffff' },
];
export const ANIMALS = ['pig', 'frog', 'chicken', 'cow'];
export const ANIMAL_SAY = { pig: 'Oink! Oink!', frog: 'Ribbit?!', chicken: 'Bok bok BAGAWK!', cow: 'Moooooo!' };

// FNV-1a, then a mix: a number in [0, 1) for a string
export function hashStr(s){
  let h = 2166136261;
  for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
export function recipeKey(base, ings){ return base + ':' + [...ings].sort().join('+'); }

// what a recipe does: { key, effects: [{ id, power, colour?, animal? }], text }
export function outcome(base, ings){
  ings = [...ings].sort();
  const key = recipeKey(base, ings);
  const h = (salt) => hashStr(key + '#' + salt);
  const res = { key, base, ings, effects: [] };
  const add = (id, power = 1) => {
    if (res.effects.some((e) => e.id === id)) return;
    const e = { id, power };
    if (id === 'colour') e.colour = COLOURS[Math.floor(h('colour') * COLOURS.length)].id;
    if (id === 'animal') e.animal = ANIMALS[Math.floor(h('animal') * ANIMALS.length)];
    res.effects.push(e);
  };
  const defs = ings.map((i) => ING[i]);
  const mad = defs.filter((d) => !d.nice), nice = defs.filter((d) => d.nice);
  if (!defs.length) add('plain');
  else if (!mad.length) add('delicious');
  else if (mad.length === 2 && mad[0].id === mad[1].id){
    // the same ingredient twice: a stronger effect (puffer fish twice: they swell until they pop)
    const id = mad[0].effect;
    if (id === 'swell' && h('pop') < 0.6) add('explode');
    else add(id, 2);
  } else if (mad.length === 1 && nice.length === 1){
    if (h('cancel') < 0.3) add('delicious'); else add(mad[0].effect);
  } else if (mad.length === 1) add(mad[0].effect);
  else {
    const r = h('mix');
    if (r < 0.12) add('delicious');               // they cancel each other out
    else if (r < 0.2) add('explode');             // an unstable mix
    else {
      const ids = mad.map((d) => d.effect);
      const whole = ids.filter((id) => WHOLE.has(id));
      if (whole.length) add(whole[Math.floor(h('whole') * whole.length)]);
      else for (const id of ids) add(id);
    }
  }
  // a delicious recipe with a mad base? no: the base only steers the hash (so vanilla and chocolate differ)
  res.text = describe(res);
  return res;
}
export function effectName(e){
  const E = EFFECTS[e.id];
  if (e.id === 'colour'){ const c = COLOURS.find((c) => c.id === e.colour); return `Turns ${c ? c.name : 'a new colour'}`; }
  if (e.id === 'animal') return `Turns into a ${e.animal}`;
  return (e.power > 1 ? 'MEGA ' : '') + E.name;
}
export function describe(o){ return o.effects.map(effectName).join(' + '); }
export function effectEmoji(e){
  if (e.id === 'animal') return { pig: '🐷', frog: '🐸', chicken: '🐔', cow: '🐮' }[e.animal] || '🐷';
  return EFFECTS[e.id].emoji;
}
export function recipeName(base, ings){
  const b = BASE[base];
  return [b ? `${b.emoji} ${b.name}` : '?', ...ings.map((i) => `${ING[i].emoji} ${ING[i].name}`)].join(' + ');
}
