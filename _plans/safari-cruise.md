# Safari Cruise

You're the manager of a drive-through safari park. Tour trucks carry paying visitors round a loop road
through big fenced enclosures full of animals; you keep the animals healthy and clean, the feeders
full, the trucks running, and spend the money on more enclosures, animals, trucks, staff and upgrades.
Plays on an iPad (or any screen) and in VR (WebXR in a headset's browser, e.g. a Quest) from the same
page, like My Animal Farm and Rollercoaster Bros.

Same shape as those: one page (`_experiments/safari-cruise.html`) that is mostly the title screen and
the HUD, ES modules in `experiments/safari-cruise/js/`, three.js r180 in `experiments/safari-cruise/lib/`,
a manifest, a service worker and icons (`_tools/safari-cruise/icons.mjs` draws them). Every script
address carries the version (`?v=`).

## The safari (world.js)

- The road is a wobbly circle (r ≈ 150 m, about 950 m round). Everything is placed by φ (angle along
  the loop from the start of the Lodge) and "lateral" (metres outside the road, negative inside).
- Zones are slices of φ: the Safari Lodge, then nine enclosures in driving order: Savanna Plains
  (zebra, wildebeest, ostrich), Giraffe Grove (giraffe, impala), Rhino Ridge (white rhino, warthog,
  mud wallow), Elephant Valley, Hippo Lake (hippos, crocodiles), Lion Pride, Cheetah Run, Tiger Forest,
  Bear Woods. Each reaches 52 m inside the road and 62 m outside it, fenced (taller fences for the
  big cats and bears), with a gate and cattle grid where the road crosses into the next one; the gates
  swing open for anything driving up. Each has a feeder (a hay rack, or a meat platform), a pond or
  wallow, a sign board by the road and its own plants (acacias, baobabs, rocks, palms and reeds, a
  broadleaf forest, pines).
- Terrain: a 2 m height grid (±400 m) from noise, with a rocky kopje in the middle, hills on the
  horizon, ponds carved in, the road smoothed along its length and the Lodge on a flat terrace.
  Ground colour per vertex (dry grass, lush by water, red earth by the road) under a detail texture;
  14,000 instanced grass tufts; every tree, bush and rock instanced.
- The Lodge: the station platform under a thatched roof, rondavels, a covered walkway to the car park
  (which fills with cars on busy days), the big sign, and the garage where trucks are serviced and the
  staff jeeps park.
- Colliders (circles and fence segments in 10 m buckets) keep your jeep out of fences, trees and
  buildings.

## Animals (animals.js)

Built at start-up from lofted shapes (body, neck, head) and two-part legs, with coats painted pixel
by pixel (stripes, patches, spots, wrinkles) and extras per species (horns, tusks, trunk, ears, manes,
ossicones, beards). The ostrich and the crocodile have their own builders. They walk with proper leg
swings (gallop when running), graze, browse, drink, lie down, wallow (rhinos, warthogs), swim
(hippos, crocodiles), wade (elephants, bears), sprint (cheetahs), go to the feeder when hungry, turn
their heads to watch vehicles, stop for a truck in front of them and leave dung. Dirt shows on the
coat; a sick animal lies down more, moves slowly and has a red cross over it.

## Running it (sim.js)

- A day is 9 am to 6 pm in 6 minutes. At the end: wages, upkeep ($30 an enclosure, $25 a truck) and a
  report (the Office keeps the last week).
- Visitors arrive at a rate set by how appealing the animals are, the star rating and the ticket
  price against a "fair" price; they walk from the car park to the platform, queue, board (paying the
  ticket), ride, and walk back. Long queues put people off.
- Trucks (12 seats) drive the loop on the outer lane, slowing near animals so everyone can look,
  stopping for animals on the road and keeping their distance from the truck ahead. They wear as they
  go; worn trucks break down more often (flat tyre, overheated engine with smoke, flat battery, out of
  fuel), stopping everything behind them. Under 40% a truck is booked in: at the end of its tour it
  drops its riders at the garage and drives in for a service.
- Riders score the tour: the animals they saw (by appeal), minus poorly animals, dirty enclosures,
  breakdowns, a long wait and an unfair price. The rating moves towards it; some say what they thought.
- Jobs (with red markers): treat a sick animal (vet), wash a muddy one, clean up dung, fill a feeder
  (keeper), repair a broken-down truck, service a worn one (mechanic). Staff drive out on the inner lane
  and off-road to the job, work (splashes, sparks...), and drive back. You can hire and let go of staff
  (up to 8), or drive there yourself and press Fix it.
- Shop: open enclosures ($3,500 to $35,000), buy animals (up to 8 an enclosure), trucks ($4,500, up to 6),
  upgrades (smooth roads, animal clinic, big feeders, Lodge café, staff radios). Start: $6,000, two
  enclosures, two trucks, a vet, a keeper and a mechanic.

## Playing it two ways (main.js, ui.js)

- **Screen**: a camera that flies over the safari (drag, pinch / scroll, two fingers or WASD). Tap an
  animal, truck, staff jeep or job marker for a panel. Jobs are listed down the left. 🚙 Drive: your
  jeep, with a thumb stick (or WASD), chase or cockpit view, a horn, Fix it near a job. 🚌 Ride: a seat
  on a tour truck (drag to look round, next truck).
- **VR**: you start at giant size over the safari; B switches to normal size. The tablet in your left
  hand has the same panels; point with the right controller and pull the trigger (on the tablet, or on
  an animal, truck or marker in the world). Left stick walks; right stick snap-turns. Riding and
  driving move the whole play space with the vehicle (turning only, the horizon stays level); when
  driving, the left stick is go / stop and the right stick steers, the trigger fixes a job.

## Testing

`_tools/safari-cruise/test.mjs` plays it in headless Chromium (and in VR with IWER's emulated Quest 3,
installed with `npm i --prefix _tools/vr-test iwer`) and saves screenshots.

## Ideas for later

- Night safaris with headlights; weather; baby animals.
- Monkeys that climb on the trucks; a walk-through area at the Lodge.
- Choosing truck colours; a gift shop.
