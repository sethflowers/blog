// The parks: a map of each one and its restrooms.
//
// Everything is in metres from the park's origin (x east, y north), so a GPS fix (latitude,
// longitude) lands on the same drawing: toXY() converts it. Magic Kingdom's layout (water, walkways,
// buildings, trees, the railroad) and the places of its restrooms and rides are traced from the
// official guide map (mk-map.js, made by _tools/royal-flush/trace.py) and fitted to GPS through
// landmarks with known positions: good to about 20 m. Players can move a pin to where they are
// standing ("Pin is off: move it here"), which is saved on their device.
//
// To add a park (EPCOT, Hollywood Studios, Animal Kingdom): trace its guide map the same way, give it an
// entry in PARKS with the same shape (origin, map, lands, landmarks, restrooms) and set ready: true.
import MKMAP from './mk-map.js';

export const LANDS = {
  main:  { name: 'Main Street, U.S.A.', short: 'Main Street', color: '#f3c9a0', ink: '#8a4a1a' },
  adv:   { name: 'Adventureland', short: 'Adventureland', color: '#b9d98a', ink: '#3e6a1a' },
  front: { name: 'Frontierland', short: 'Frontierland', color: '#e6c48a', ink: '#7a4a12' },
  lib:   { name: 'Liberty Square', short: 'Liberty Square', color: '#c9d2ea', ink: '#2c3f7a' },
  fan:   { name: 'Fantasyland', short: 'Fantasyland', color: '#efc3e0', ink: '#80306a' },
  tom:   { name: 'Tomorrowland', short: 'Tomorrowland', color: '#b8dcef', ink: '#1a5a80' },
};

const at = (id) => MKMAP.places[id];
const AT = (id) => ({ x: at(id)[0], y: at(id)[1] });
const MK = {
  id: 'magic-kingdom',
  name: 'Magic Kingdom',
  ready: true,
  origin: { lat: 28.41917, lon: -81.58111 },     // Cinderella Castle
  map: MKMAP,                                    // the traced layout
  start: { ...AT('start'), zoom: 0.9 },
  bounds: MKMAP.bounds,
  lands: MKMAP.lands,
  labels: { main: [...at('T-main'), -90], adv: [...at('T-adv'), -4], front: [...at('T-front'), 0], lib: [...at('T-lib'), -10], fan: [...at('T-fan'), 0], tom: [...at('T-tom'), 4] },
  drawn: { castle: at('L-castle'), spaceMountain: [...at('L-space'), 38], thunder: at('L-thunder') },
  stations: [
    { ...AT('S-main'), name: 'Main Street Station' },
    { ...AT('S-frontier'), name: 'Frontierland Station' },
    { ...AT('S-fantasy'), name: 'Fantasyland Station' },
  ],
  landmarks: [
    { ...AT('L-castle'), name: 'Cinderella Castle', size: 34, zoom: 0, drawn: true },
    { ...AT('L-space'), name: 'Space Mountain', size: 26, zoom: 0, drawn: true },
    { ...AT('L-thunder'), name: 'Big Thunder Mountain', size: 26, zoom: 0, drawn: true },
    { ...AT('L-mansion'), icon: '👻', name: 'Haunted Mansion', size: 22, zoom: 0 },
    { ...AT('L-smallworld'), icon: '🌍', name: "it's a small world", size: 20, zoom: 0.7 },
    { ...AT('L-pirates'), icon: '🏴‍☠️', name: 'Pirates of the Caribbean', size: 22, zoom: 0 },
    { ...AT('L-jungle'), icon: '🚤', name: 'Jungle Cruise', size: 20, zoom: 0.7 },
    { ...AT('L-tiana'), icon: '🐊', name: "Tiana's Bayou Adventure", size: 22, zoom: 0 },
    { ...AT('L-swiss'), icon: '🌳', name: 'Swiss Family Treehouse', size: 18, zoom: 1.1 },
    { ...AT('L-tiki'), icon: '🦜', name: 'Enchanted Tiki Room', size: 16, zoom: 1.4 },
    { ...AT('L-carpets'), icon: '🧞', name: 'Magic Carpets', size: 16, zoom: 1.4 },
    { ...AT('L-country'), icon: '🐻', name: 'Country Bear Musical Jamboree', size: 16, zoom: 1.4 },
    { ...AT('L-hall'), icon: '🇺🇸', name: 'Hall of Presidents', size: 16, zoom: 1.1 },
    { ...AT('L-belle'), icon: '🛳️', name: 'Liberty Belle Riverboat', size: 16, zoom: 1.4 },
    { ...AT('L-tomsawyer'), icon: '🌲', name: 'Tom Sawyer Island', size: 16, zoom: 1.1 },
    { ...AT('L-peterpan'), icon: '🧚', name: "Peter Pan's Flight", size: 18, zoom: 0.9 },
    { ...AT('L-philhar'), icon: '🎺', name: "Mickey's PhilharMagic", size: 16, zoom: 1.4 },
    { ...AT('L-carrousel'), icon: '🎠', name: 'Prince Charming Regal Carrousel', size: 16, zoom: 1.4 },
    { ...AT('L-teacups'), icon: '🫖', name: 'Mad Tea Party', size: 18, zoom: 1.1 },
    { ...AT('L-pooh'), icon: '🍯', name: 'The Many Adventures of Winnie the Pooh', size: 16, zoom: 1.4 },
    { ...AT('L-minetrain'), icon: '⛏️', name: 'Seven Dwarfs Mine Train', size: 22, zoom: 0 },
    { ...AT('L-beourguest'), icon: '🌹', name: 'Be Our Guest', size: 18, zoom: 1.1 },
    { ...AT('L-mermaid'), icon: '🧜‍♀️', name: 'Under the Sea', size: 18, zoom: 1.1 },
    { ...AT('L-dumbo'), icon: '🐘', name: 'Dumbo the Flying Elephant', size: 20, zoom: 0.7 },
    { ...AT('L-barnstormer'), icon: '🎢', name: 'The Barnstormer', size: 16, zoom: 1.4 },
    { ...AT('L-tron'), icon: '🏍️', name: 'TRON Lightcycle / Run', size: 22, zoom: 0 },
    { ...AT('L-speedway'), icon: '🏎️', name: 'Tomorrowland Speedway', size: 16, zoom: 1.1 },
    { ...AT('L-astro'), icon: '🪐', name: 'Astro Orbiter', size: 18, zoom: 1.1 },
    { ...AT('L-peoplemover'), icon: '🚝', name: 'PeopleMover', size: 16, zoom: 1.4 },
    { ...AT('L-buzz'), icon: '🛸', name: "Buzz Lightyear's Space Ranger Spin", size: 16, zoom: 1.4 },
    { ...AT('L-carousel'), icon: '🎡', name: 'Carousel of Progress', size: 16, zoom: 1.1 },
    { ...AT('L-laugh'), icon: '👾', name: 'Monsters, Inc. Laugh Floor', size: 16, zoom: 1.4 },
    { ...AT('L-entrance'), icon: '🎟️', name: 'Entrance', size: 18, zoom: 0 },
  ],
  // the 18 restroom symbols on the official guide map
  restrooms: [
    { id: 'gate', land: 'main', ...AT('gate'), name: 'Front Gate Restrooms',
      where: 'Just outside the turnstiles, on the right as you face the park, by the Guest Relations window.',
      fact: 'The last chance before the magic. Seasoned guests stop here before the rope-drop sprint.' },
    { id: 'townsq', land: 'main', ...AT('townsq'), name: 'City Hall', companion: true,
      where: 'Town Square, on the left (west) side, next to City Hall.',
      fact: 'Main Street is built in forced perspective: the upper floors are smaller, so it looks taller. The restrooms are full size.' },
    { id: 'firstaid', land: 'main', ...AT('firstaid'), name: 'First Aid & Baby Care',
      where: 'At the top of Main Street on the left, beside The Crystal Palace.',
      fact: 'The Baby Care Center has changing tables, a quiet nursing room and a little shop of baby supplies.' },
    { id: 'terrace', land: 'tom', ...AT('terrace'), name: 'Tomorrowland Terrace',
      where: 'At the top of Main Street on the right, on the way to Tomorrowland Terrace.',
      fact: 'Tomorrowland Terrace is a great quiet spot to watch the fireworks over the castle.' },
    { id: 'veranda', land: 'adv', ...AT('veranda'), name: 'Adventureland Entrance',
      where: 'Over the bridge into Adventureland, by Island Supply, across from the Swiss Family Treehouse.',
      fact: 'The Dole Whip stand (Aloha Isle) is just along the path: plan accordingly.' },
    { id: 'pirates', land: 'adv', ...AT('pirates'), name: 'Pirates Plaza', companion: true,
      where: 'Deep in Adventureland, by Pirates of the Caribbean and Plaza del Sol Caribe.',
      fact: 'Yo ho! Pirates was the last attraction Walt Disney personally worked on (for Disneyland).' },
    { id: 'pecos', land: 'front', ...AT('pecos'), name: 'Pecos Bill Tall Tale Inn',
      where: 'Frontierland, beside Pecos Bill Tall Tale Inn and Cafe, where Adventureland meets Frontierland.',
      fact: "Pecos Bill's toppings bar is legendary. The restrooms are handy before or after." },
    { id: 'tiana', land: 'front', ...AT('tiana'), name: "Tiana's Bayou & the Train Station", companion: true,
      where: "Far end of Frontierland, under the Frontierland railroad station by Tiana's Bayou Adventure.",
      fact: 'A splashy ride next to a restroom: dry off, freshen up, carry on.' },
    { id: 'tsi-north', land: 'front', ...AT('tsi-north'), name: 'Tom Sawyer Island (north)', island: true,
      where: "On Tom Sawyer Island, at the far end over the bridge. Get there by the island's rafts.",
      fact: 'The rafts run in the daytime only, and the island closes at dusk. Ticking this one off takes a voyage!' },
    { id: 'tsi-south', land: 'front', ...AT('tsi-south'), name: 'Tom Sawyer Island (south)', island: true,
      where: 'On Tom Sawyer Island, near where the rafts land. Get there by raft from Frontierland.',
      fact: "Look for the secret caves and Fort Langhorn while you're here." },
    { id: 'tangled', land: 'fan', ...AT('tangled'), name: 'Tangled Restrooms', themed: true, companion: true, charging: true,
      where: "Between Liberty Square and Fantasyland, below Rapunzel's tower, near the Haunted Mansion.",
      fact: 'The most famous restroom in the park: lanterns, a tower, Pascal and Maximus. There are phone-charging spots outside.' },
    { id: 'pinocchio', land: 'fan', ...AT('pinocchio'), name: 'Pinocchio Village Haus', companion: true,
      where: "Fantasyland, at Pinocchio Village Haus, next to it's a small world.",
      fact: "Grab a table by the window: you can watch the boats sail into it's a small world." },
    { id: 'gaston', land: 'fan', ...AT('gaston'), name: "Gaston's Tavern", companion: true,
      where: 'At the top of Fantasyland in the Beauty and the Beast village, by Gaston\'s Tavern.',
      fact: "No one goes like Gaston! Try LeFou's Brew while you're here." },
    { id: 'teacups', land: 'fan', ...AT('teacups'), name: 'Cheshire Café',
      where: 'Fantasyland, by Cheshire Café and the Mad Tea Party.',
      fact: 'A very merry unbirthday to you! Best visited BEFORE the teacups, not after.' },
    { id: 'circus', land: 'fan', ...AT('circus'), name: 'Storybook Circus', companion: true,
      where: 'Storybook Circus, by the Fantasyland train station and The Barnstormer.',
      fact: 'The steam trains are over a hundred years old: Disney found them working in Mexico.' },
    { id: 'tron', land: 'tom', ...AT('tron'), name: 'TRON', companion: true,
      where: 'Under the glowing canopy, by the TRON Lightcycle / Run entrance.',
      fact: 'Tucked away at the edge of the park, so often the least busy in Tomorrowland.' },
    { id: 'cosmic', land: 'tom', ...AT('cosmic'), name: "Cosmic Ray's",
      where: "Tomorrowland, between Cosmic Ray's Starlight Café and Star Traders.",
      fact: 'Sonny Eclipse plays the lounge at Cosmic Ray\'s every day. He is an animatronic and never needs a bathroom break.' },
    { id: 'space', land: 'tom', ...AT('space'), name: 'Space Mountain', companion: true,
      where: "Tomorrowland, past Joffrey's, near the Space Mountain exit.",
      fact: 'Space Mountain is pitch dark and takes about 2 1/2 minutes. Go before you go.' },
  ],
};

// the other Orlando parks, to add later
const COMING = [
  { id: 'epcot', name: 'EPCOT', ready: false, origin: { lat: 28.3747, lon: -81.5494 } },
  { id: 'hollywood-studios', name: 'Hollywood Studios', ready: false, origin: { lat: 28.3575, lon: -81.5583 } },
  { id: 'animal-kingdom', name: 'Animal Kingdom', ready: false, origin: { lat: 28.3553, lon: -81.5901 } },
];

export const PARKS = [MK, ...COMING];
export const parkById = (id) => PARKS.find((p) => p.id === id) || MK;

// GPS → map metres (a flat projection is plenty for a park a kilometre across)
const M_LAT = 110850;
export function toXY(park, lat, lon){
  const mLon = 111320 * Math.cos(park.origin.lat * Math.PI / 180);
  return { x: (lon - park.origin.lon) * mLon, y: (lat - park.origin.lat) * M_LAT };
}
export function toLatLon(park, x, y){
  const mLon = 111320 * Math.cos(park.origin.lat * Math.PI / 180);
  return { lat: park.origin.lat + y / M_LAT, lon: park.origin.lon + x / mLon };
}
