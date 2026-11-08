# Safari Cruise

You're the manager of a drive-through safari cut into the jungle, and you walk round it yourself in
first person (like My Animal Farm). Tour trucks carry paying visitors round a loop road through big
fenced enclosures full of animals; you keep the animals healthy and clean, the feeders
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
- Zones are slices of φ: the Safari Lodge, then nine enclosures in driving order: River Meadows
  (zebra, wildebeest, ostrich), Giraffe Glade (giraffe, impala), Rhino Ridge (white rhino, warthog,
  mud wallow), Elephant Valley, Hippo Lagoon (hippos, crocodiles), Lion Pride, Cheetah Clearing, Tiger
  Jungle, Bear Woods. Each reaches 52 m inside the road and 62 m outside it, fenced (taller fences for the
  big cats and bears), with a gate and cattle grid where the road crosses into the next one; the gates
  swing open for anything driving up. Each has a feeder (a hay rack, or a meat platform), a pond or
  wallow, a sign board by the road and its own plants (jungle trees, giant kapoks with buttress roots,
  palms, ferns, rocks, reeds; a thick forest for the tigers, pines for the bears).
- The jungle: a solid canopy of treetops (one mesh laid over the land, lifted 15-27 m) all round the
  outside of the fences and over the hill in the middle, with gaps for the Lodge and the drive in;
  hundreds more trees in front of it (the ones outside the fences don't cast shadows, to keep it
  quick). Green ground, forested hills, humid green haze, parrots and distant howler monkeys.
- Terrain: a 2 m height grid (±400 m) from noise, with a rocky kopje in the middle, hills on the
  horizon, ponds carved in, the road smoothed along its length and the Lodge on a flat terrace.
  Ground colour per vertex (jungle greens, lush by water, red earth by the road) under a detail texture;
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

- **Screen**: first person on foot, like My Animal Farm: a thumb stick appears under your left thumb
  (or WASD; Shift or a full push runs), drag anywhere else to look, tap an animal, truck, staff jeep or
  job marker for a panel. Fences, trees, buildings, trucks and the big animals are solid; you step up
  onto the station platform. Jobs are listed down the left; walk up to one and press Fix it. 🚙 Jeep
  (E): your jeep (brought round to you if it's far away), cockpit view (or chase), a horn, Fix it.
  🚌 Ride: a seat on a tour truck (drag to look round, next truck). 🗺 Go to: jump to the gate of any
  enclosure, since the loop is nearly a kilometre.
- **VR**: you stand at the Lodge at normal size. The tablet in your left hand has the same panels;
  point with the right controller and pull the trigger (on the tablet, or on an animal, truck or marker
  in the world; next to a job it does the job). Left stick walks (with the same solid things); right
  stick snap-turns; A rides, B takes the jeep. Riding and
  driving move the whole play space with the vehicle (turning only, the horizon stays level); when
  driving, the left stick is go / stop and the right stick steers, the trigger fixes a job.

## Testing

`_tools/safari-cruise/test.mjs` plays it in headless Chromium (and in VR with IWER's emulated Quest 3,
installed with `npm i --prefix _tools/vr-test iwer`) and saves screenshots. About five minutes. It doesn't wait for the game clock in
real time: `__sc.advance(seconds, until)` steps the simulation in a loop inside the page, and
`__sc.renderNow()` draws one frame for each screenshot (nothing else is drawn). In VR the controllers
only change on a headset frame, so after moving a stick it waits for a real frame, drawn at 30% of the
headset's resolution (`__sc.xrScale`), then fast-forwards the same way.

## Ideas for later

- Night safaris with headlights; weather; baby animals.
- Monkeys that climb on the trucks; a walk-through area at the Lodge.
- Choosing truck colours; a gift shop.
