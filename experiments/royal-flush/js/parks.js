// The parks: a hand-drawn map of each one and its restrooms.
//
// Everything is in metres from the park's origin (x east, y north), so a GPS fix (latitude,
// longitude) lands on the same drawing: toXY() converts it. The drawing is an approximation built
// from known landmark positions, not a survey: restroom pins can be a little off, and players can
// move a pin to where they are standing ("Fix this pin"), which is saved on their device.
//
// To add a park (EPCOT, Hollywood Studios, Animal Kingdom): give it an entry in PARKS with the same
// shape (origin, lands, water, paths, rail, landmarks, restrooms) and set ready: true.

export const LANDS = {
  main:  { name: 'Main Street, U.S.A.', short: 'Main Street', color: '#f3c9a0', ink: '#8a4a1a' },
  adv:   { name: 'Adventureland', short: 'Adventureland', color: '#b9d98a', ink: '#3e6a1a' },
  front: { name: 'Frontierland', short: 'Frontierland', color: '#e6c48a', ink: '#7a4a12' },
  lib:   { name: 'Liberty Square', short: 'Liberty Square', color: '#c9d2ea', ink: '#2c3f7a' },
  fan:   { name: 'Fantasyland', short: 'Fantasyland', color: '#efc3e0', ink: '#80306a' },
  tom:   { name: 'Tomorrowland', short: 'Tomorrowland', color: '#b8dcef', ink: '#1a5a80' },
};

const MK = {
  id: 'magic-kingdom',
  name: 'Magic Kingdom',
  ready: true,
  // Cinderella Castle
  origin: { lat: 28.41917, lon: -81.58111 },
  start: { x: 0, y: -60, zoom: 0.9 },
  bounds: { x0: -560, x1: 580, y0: -480, y1: 380 },
  lands: {
    main: [[-62, -338], [62, -338], [62, -146], [-62, -146]],
    adv: [[-62, -146], [-62, -40], [-130, -18], [-250, -28], [-330, -60], [-420, -150], [-370, -235], [-250, -290], [-120, -318], [-62, -320]],
    front: [[-250, -28], [-330, -60], [-420, -150], [-480, -80], [-505, 60], [-485, 175], [-440, 262], [-375, 270], [-395, 120], [-300, 70], [-235, 40]],
    lib: [[-70, 28], [-130, -18], [-235, 40], [-300, 70], [-230, 100], [-170, 150], [-160, 215], [-110, 205], [-80, 120]],
    fan: [[-110, 205], [-160, 215], [-205, 250], [-190, 312], [-120, 332], [60, 334], [200, 322], [262, 300], [305, 250], [300, 150], [180, 60], [80, 48], [40, 58], [-40, 58], [-80, 120]],
    tom: [[62, 18], [80, 48], [180, 60], [300, 150], [330, 262], [470, 236], [522, 40], [485, -120], [385, -252], [235, -318], [62, -232], [62, -146]],
  },
  // the railroad around the park (a closed loop) and its stations
  rail: [[0, -340], [-130, -334], [-265, -294], [-385, -214], [-478, -84], [-508, 60], [-488, 176], [-440, 266], [-300, 326], [-120, 338], [60, 340], [205, 328], [265, 302], [335, 266], [470, 240], [512, 184], [530, 40], [490, -124], [388, -256], [236, -324], [100, -344]],
  stations: [
    { x: 0, y: -338, name: 'Main Street Station' },
    { x: -500, y: 120, name: 'Frontierland Station' },
    { x: 262, y: 304, name: 'Fantasyland Station' },
  ],
  // outside the gates: the entrance plaza and the Seven Seas Lagoon
  plaza: [[-150, -350], [150, -350], [170, -430], [-170, -430]],
  water: [
    // Seven Seas Lagoon, south of the entrance
    { poly: [[-1400, -440], [1400, -440], [1400, -1200], [-1400, -1200]] },
    // Rivers of America
    { poly: [[-375, 108], [-300, 92], [-225, 108], [-178, 160], [-196, 232], [-262, 268], [-342, 258], [-392, 200]] },
    // the castle moat
    { circle: [0, 8, 78] },
    // Jungle Cruise river
    { line: [[-150, -160], [-200, -178], [-262, -172], [-300, -140], [-280, -100], [-226, -104], [-196, -132], [-150, -160]], w: 16 },
    // Prince Eric's lagoon, the Mine Train pond
    { circle: [140, 282, 16] },
    { circle: [72, 160, 12] },
  ],
  islands: [
    { poly: [[-336, 140], [-262, 132], [-228, 172], [-266, 222], [-330, 218], [-356, 178]], name: 'Tom Sawyer Island' },
    { circle: [0, 8, 54] },
  ],
  // walkways: [points, width in metres]
  paths: [
    [[[0, -338], [0, -146]], 24],                                  // Main Street
    [[[0, -146], [0, -40], [0, 60], [0, 92]], 18],                 // hub to the castle and through it
    [[[-48, -96], [-112, -80], [-160, -60], [-232, -80], [-300, -120], [-330, -170]], 14],   // Adventureland
    [[[-160, -60], [-200, -22], [-262, 10], [-332, 40], [-404, 62], [-446, 104], [-436, 176], [-420, 220]], 14], // Frontierland
    [[[-36, -60], [-90, 2], [-130, 42], [-182, 92], [-162, 150], [-150, 188]], 14],          // Liberty Square
    [[[-150, 168], [-100, 162], [-40, 150], [0, 92]], 13],                                    // to Fantasyland
    [[[0, 92], [40, 122], [92, 140], [160, 162], [214, 200], [244, 262], [262, 296]], 13],    // Fantasyland
    [[[40, 122], [40, 200], [62, 240], [130, 240], [200, 222]], 11],                           // Enchanted Forest
    [[[92, 140], [148, 90], [206, 70], [250, 92]], 11],
    [[[48, -96], [112, -72], [200, -60], [282, -40], [342, -4]], 14],                         // Tomorrowland
    [[[200, -60], [210, 20], [240, 92], [302, 130], [400, 132], [442, 122]], 12],              // to Space Mountain and TRON
    [[[200, -60], [222, -110], [262, -124]], 11],
  ],
  hub: { x: 0, y: -96, r: 52 },
  // where each land's name goes on the map ([x, y, rotation in degrees])
  labels: { main: [0, -200, -90], adv: [-230, -232, -8], front: [-418, -52, 0], lib: [-232, 44, -14], fan: [-30, 302, 0], tom: [360, -150, 10] },
  // the big landmarks get a drawing of their own
  drawn: { castle: [0, 8], spaceMountain: [380, 0, 38], thunder: [-420, 150] },
  // Main Street's blocks of shops, and the station
  buildings: [
    [-58, -246, -18, -224, '#d9785a'], [-58, -222, -18, -196, '#7aa6c8'], [-58, -194, -18, -172, '#e0b45a'], [-58, -170, -18, -150, '#a88ac8'],
    [18, -246, 58, -226, '#8ab87a'], [18, -224, 58, -198, '#d9785a'], [18, -196, 58, -174, '#7aa6c8'], [18, -172, 58, -150, '#e0b45a'],
    [-84, -300, -48, -256, '#e8d8b8'], [48, -300, 84, -256, '#c87a6a'], [-34, -348, 34, -326, '#b8463a'],
  ],
  townSquare: { x: 0, y: -276, w: 86, h: 52 },
  landmarks: [
    { x: 0, y: 8, name: 'Cinderella Castle', size: 34, zoom: 0, drawn: true, ly: -42 },
    { x: 380, y: 0, name: 'Space Mountain', size: 26, zoom: 0, drawn: true, ly: -46 },
    { x: -420, y: 150, name: 'Big Thunder Mountain', size: 26, zoom: 0, drawn: true, ly: -40 },
    { x: -168, y: 198, icon: '👻', name: 'Haunted Mansion', size: 22, zoom: 0 },
    { x: -84, y: 192, icon: '🌍', name: "it's a small world", size: 20, zoom: 0.7 },
    { x: -312, y: -156, icon: '🏴‍☠️', name: 'Pirates of the Caribbean', size: 22, zoom: 0 },
    { x: -232, y: -136, icon: '🚤', name: 'Jungle Cruise', size: 20, zoom: 0.7 },
    { x: -452, y: 40, icon: '🐊', name: "Tiana's Bayou Adventure", size: 22, zoom: 0 },
    { x: -150, y: -82, icon: '🌳', name: 'Swiss Family Treehouse', size: 18, zoom: 1.1 },
    { x: -184, y: -50, icon: '🦜', name: 'Enchanted Tiki Room', size: 16, zoom: 1.4 },
    { x: -174, y: -100, icon: '🧞', name: 'Magic Carpets', size: 16, zoom: 1.4 },
    { x: -312, y: 28, icon: '🐻', name: 'Country Bear', size: 16, zoom: 1.4 },
    { x: -184, y: 82, icon: '🇺🇸', name: 'Hall of Presidents', size: 16, zoom: 1.1 },
    { x: -260, y: 178, icon: '🌲', name: 'Tom Sawyer Island', size: 16, zoom: 1.1 },
    { x: -40, y: 118, icon: '🧚', name: "Peter Pan's Flight", size: 18, zoom: 0.9 },
    { x: 26, y: 96, icon: '🎠', name: 'Carrousel', size: 16, zoom: 1.4 },
    { x: 104, y: 106, icon: '🫖', name: 'Mad Tea Party', size: 18, zoom: 1.1 },
    { x: 92, y: 186, icon: '⛏️', name: 'Seven Dwarfs Mine Train', size: 22, zoom: 0 },
    { x: 18, y: 262, icon: '🌹', name: 'Be Our Guest', size: 18, zoom: 1.1 },
    { x: 132, y: 258, icon: '🧜‍♀️', name: 'Under the Sea', size: 18, zoom: 1.1 },
    { x: 222, y: 228, icon: '🐘', name: 'Dumbo', size: 20, zoom: 0.7 },
    { x: 456, y: 150, icon: '🏍️', name: 'TRON Lightcycle / Run', size: 22, zoom: 0 },
    { x: 244, y: 100, icon: '🏎️', name: 'Speedway', size: 16, zoom: 1.1 },
    { x: 190, y: -48, icon: '🪐', name: 'Astro Orbiter', size: 18, zoom: 1.1 },
    { x: 162, y: -102, icon: '🛸', name: 'Buzz Lightyear', size: 16, zoom: 1.4 },
    { x: 272, y: -132, icon: '🎡', name: 'Carousel of Progress', size: 16, zoom: 1.4 },
    { x: 130, y: -16, icon: '👾', name: 'Laugh Floor', size: 16, zoom: 1.4 },
    { x: 0, y: -380, icon: '🎟️', name: 'Entrance', size: 18, zoom: 0 },
  ],
  restrooms: [
    { id: 'gate', land: 'main', x: -72, y: -352, name: 'Front Gate Restrooms',
      where: 'Just outside the turnstiles, on the left as you face the park (by the lockers).',
      fact: 'The last chance before the magic. Seasoned guests stop here before the rope-drop sprint.' },
    { id: 'townsq', land: 'main', x: -56, y: -286, name: 'Town Square',
      where: 'On the left side of Town Square, near City Hall.',
      fact: 'Main Street is built in forced perspective: the upper floors are smaller, so it looks taller. The restrooms are full size.' },
    { id: 'firstaid', land: 'main', x: -76, y: -152, name: 'First Aid & Baby Care',
      where: 'At the top of Main Street on the left, next to The Crystal Palace.', companion: true,
      fact: 'The Baby Care Center has changing tables, a quiet nursing room and a little shop of baby supplies.' },
    { id: 'veranda', land: 'adv', x: -122, y: -56, name: 'Adventureland Veranda',
      where: 'Over the bridge into Adventureland, across from the Swiss Family Treehouse.',
      fact: 'Look for the tiki touches on the way in. The Dole Whip stand is very close: plan accordingly.' },
    { id: 'pirates', land: 'adv', x: -292, y: -116, name: 'Pirates Plaza',
      where: 'Deep in Adventureland, by Pirates of the Caribbean and Tortuga Tavern.',
      fact: 'Yo ho! Pirates was the last attraction Walt Disney personally worked on (for Disneyland).' },
    { id: 'pecos', land: 'front', x: -252, y: 24, name: 'Pecos Bill Tall Tale Inn',
      where: 'Frontierland, at Pecos Bill Tall Tale Inn and Cafe, where Adventureland meets Frontierland.',
      fact: 'Pecos Bill\'s toppings bar is legendary. The restrooms are handy before or after.' },
    { id: 'tiana', land: 'front', x: -420, y: 70, name: "Tiana's Bayou",
      where: "Far end of Frontierland, near Tiana's Bayou Adventure.",
      fact: 'A splashy ride next to a restroom: dry off, freshen up, carry on.' },
    { id: 'thunder', land: 'front', x: -404, y: 118, name: 'Big Thunder Mountain',
      where: 'On the path by Big Thunder Mountain Railroad.',
      fact: '"The wildest ride in the wilderness." Hold on to your hats, and maybe visit here first.' },
    { id: 'tavern', land: 'lib', x: -122, y: 44, name: 'Liberty Square',
      where: 'Near Liberty Tree Tavern, on the way from the hub into Liberty Square.',
      fact: 'Legend says Liberty Square has almost no restrooms because colonial America had no indoor plumbing. The brown stripe in the pavement? That is where they emptied the chamber pots.' },
    { id: 'columbia', land: 'lib', x: -104, y: 136, name: 'Columbia Harbour House',
      where: 'Between Liberty Square and Fantasyland, inside Columbia Harbour House.',
      fact: 'The upstairs dining room of Columbia Harbour House is one of the quietest places in the park.' },
    { id: 'tangled', land: 'fan', x: -142, y: 174, name: 'Tangled Restrooms', themed: true,
      where: "Between Haunted Mansion and Fantasyland, below Rapunzel's tower.", charging: true,
      fact: 'The most famous restroom in the park: lanterns, a tower, Pascal and Maximus. There are phone-charging spots outside.' },
    { id: 'pinocchio', land: 'fan', x: -56, y: 154, name: 'Pinocchio Village Haus',
      where: "Fantasyland, at Pinocchio Village Haus by it's a small world.", companion: true,
      fact: "Grab a table by the window: you can watch the boats sail into it's a small world." },
    { id: 'teacups', land: 'fan', x: 112, y: 84, name: 'Mad Tea Party',
      where: 'Fantasyland, by the spinning teacups and Cheshire Café.',
      fact: 'A very merry unbirthday to you! Best visited BEFORE the teacups, not after.' },
    { id: 'gaston', land: 'fan', x: 46, y: 214, name: 'Enchanted Forest',
      where: "Near Gaston's Tavern in the Beauty and the Beast village.",
      fact: "No one goes like Gaston! Try LeFou's Brew while you're here." },
    { id: 'mermaid', land: 'fan', x: 152, y: 244, name: "Prince Eric's Village",
      where: 'Fantasyland, near Under the Sea – Journey of the Little Mermaid.',
      fact: 'Look for the shipwreck and the rock-work waterfalls nearby.' },
    { id: 'circus', land: 'fan', x: 196, y: 194, name: 'Storybook Circus',
      where: 'By Big Top Souvenirs and Dumbo.',
      fact: 'There is an air-conditioned play area inside the Dumbo queue. The Big Top has great snacks.' },
    { id: 'station', land: 'fan', x: 244, y: 284, name: 'Fantasyland Station',
      where: 'At the Fantasyland stop of the Walt Disney World Railroad.', companion: true,
      fact: 'The steam trains are over a hundred years old: Disney found them working in Mexico.' },
    { id: 'terrace', land: 'tom', x: 86, y: -56, name: 'Tomorrowland Terrace',
      where: 'Just over the bridge from the hub into Tomorrowland.',
      fact: 'A great quiet spot to watch the fireworks over the castle.' },
    { id: 'cosmic', land: 'tom', x: 166, y: 8, name: "Cosmic Ray's",
      where: "Tomorrowland, at Cosmic Ray's Starlight Café.",
      fact: 'Sonny Eclipse plays the lounge here every day. He is an animatronic and never needs a bathroom break.' },
    { id: 'space', land: 'tom', x: 330, y: -36, name: 'Space Mountain',
      where: 'By the Space Mountain exit and the arcade.',
      fact: 'Space Mountain is pitch dark and takes about 2 1/2 minutes. Go before you go.' },
    { id: 'tron', land: 'tom', x: 420, y: 114, name: 'TRON Lightcycle / Run',
      where: 'Under the glowing canopy, by the TRON entrance.',
      fact: 'These are tucked away, so they are often the least busy in Tomorrowland.' },
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
