// The 80 everyday things the object spotter knows (the COCO set), with friendlier names and a picture,
// and the scavenger hunt's clues.
export const THINGS = {
  person: ['person', '🙋'], bicycle: ['bike', '🚲'], car: ['car', '🚗'], motorcycle: ['motorbike', '🏍️'],
  airplane: ['plane', '✈️'], bus: ['bus', '🚌'], train: ['train', '🚆'], truck: ['truck', '🚚'], boat: ['boat', '⛵'],
  'traffic light': ['traffic light', '🚦'], 'fire hydrant': ['fire hydrant', '🧯'], 'stop sign': ['stop sign', '🛑'],
  'parking meter': ['parking meter', '🅿️'], bench: ['bench', '🪑'], bird: ['bird', '🐦'], cat: ['cat', '🐱'], dog: ['dog', '🐶'],
  horse: ['horse', '🐴'], sheep: ['sheep', '🐑'], cow: ['cow', '🐮'], elephant: ['elephant', '🐘'], bear: ['bear', '🐻'],
  zebra: ['zebra', '🦓'], giraffe: ['giraffe', '🦒'], backpack: ['backpack', '🎒'], umbrella: ['umbrella', '☂️'],
  handbag: ['handbag', '👜'], tie: ['tie', '👔'], suitcase: ['suitcase', '🧳'], frisbee: ['frisbee', '🥏'], skis: ['skis', '🎿'],
  snowboard: ['snowboard', '🏂'], 'sports ball': ['ball', '⚽'], kite: ['kite', '🪁'], 'baseball bat': ['bat', '🏏'],
  'baseball glove': ['baseball glove', '🧤'], skateboard: ['skateboard', '🛹'], surfboard: ['surfboard', '🏄'],
  'tennis racket': ['tennis racket', '🎾'], bottle: ['bottle', '🍼'], 'wine glass': ['glass', '🍷'], cup: ['cup', '☕'],
  fork: ['fork', '🍴'], knife: ['knife', '🔪'], spoon: ['spoon', '🥄'], bowl: ['bowl', '🥣'], banana: ['banana', '🍌'],
  apple: ['apple', '🍎'], sandwich: ['sandwich', '🥪'], orange: ['orange', '🍊'], broccoli: ['broccoli', '🥦'],
  carrot: ['carrot', '🥕'], 'hot dog': ['hot dog', '🌭'], pizza: ['pizza', '🍕'], donut: ['donut', '🍩'], cake: ['cake', '🍰'],
  chair: ['chair', '🪑'], couch: ['sofa', '🛋️'], 'potted plant': ['plant', '🪴'], bed: ['bed', '🛏️'],
  'dining table': ['table', '🍽️'], toilet: ['toilet', '🚽'], tv: ['TV', '📺'], laptop: ['laptop', '💻'], mouse: ['computer mouse', '🖱️'],
  remote: ['remote', '📟'], keyboard: ['keyboard', '⌨️'], 'cell phone': ['phone', '📱'], microwave: ['microwave', '🔲'],
  oven: ['oven', '♨️'], toaster: ['toaster', '🍞'], sink: ['sink', '🚰'], refrigerator: ['fridge', '🧊'], book: ['book', '📖'],
  clock: ['clock', '⏰'], vase: ['vase', '🏺'], scissors: ['scissors', '✂️'], 'teddy bear': ['teddy bear', '🧸'],
  'hair drier': ['hair dryer', '💨'], toothbrush: ['toothbrush', '🪥'],
};
export const nameOf = (label) => (THINGS[label] || [label])[0];
export const iconOf = (label) => (THINGS[label] || [, '❓'])[1];

// a colour per label, so the same kind of thing always gets the same colour box
export function colourOf(label){
  let n = 0;
  for (let i = 0; i < label.length; i++) n = (n * 31 + label.charCodeAt(i)) >>> 0;
  return `hsl(${n % 360},90%,58%)`;
}

// scavenger hunt clues: things found in most homes
export const CLUES = [
  { text: 'Something you can drink from', icon: '🥤', any: ['cup', 'wine glass', 'bottle'] },
  { text: 'A comfy place to sit', icon: '🪑', any: ['chair', 'couch', 'bench'] },
  { text: 'Something to read', icon: '📖', any: ['book'] },
  { text: 'A plant in a pot', icon: '🪴', any: ['potted plant'] },
  { text: 'Something that tells the time', icon: '⏰', any: ['clock'] },
  { text: 'A phone', icon: '📱', any: ['cell phone'] },
  { text: 'A bowl', icon: '🥣', any: ['bowl'] },
  { text: 'A piece of fruit', icon: '🍎', any: ['banana', 'apple', 'orange'] },
  { text: 'A cuddly toy', icon: '🧸', any: ['teddy bear'] },
  { text: 'A person (give them a wave!)', icon: '👋', any: ['person'] },
  { text: 'A screen', icon: '📺', any: ['tv', 'laptop'] },
  { text: 'A furry friend', icon: '🐾', any: ['cat', 'dog'] },
  { text: 'A spoon, fork or knife', icon: '🥄', any: ['spoon', 'fork', 'knife'] },
  { text: 'Something with keys to type on', icon: '⌨️', any: ['keyboard', 'laptop'] },
  { text: 'A remote control', icon: '📟', any: ['remote'] },
  { text: 'Something to cut paper with', icon: '✂️', any: ['scissors'] },
  { text: 'A ball', icon: '⚽', any: ['sports ball'] },
  { text: 'A bag', icon: '🎒', any: ['backpack', 'handbag', 'suitcase'] },
  { text: 'A vase', icon: '🏺', any: ['vase'] },
  { text: 'A bed', icon: '🛏️', any: ['bed'] },
  { text: 'A table', icon: '🍽️', any: ['dining table'] },
  { text: 'A toothbrush', icon: '🪥', any: ['toothbrush'] },
  { text: 'Something with wheels', icon: '🚲', any: ['bicycle', 'car', 'truck', 'bus', 'motorcycle', 'skateboard'] },
];
