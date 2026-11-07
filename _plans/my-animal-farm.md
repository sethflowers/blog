# My Animal Farm

A farm game that plays in VR (WebXR in a headset's browser, e.g. a Quest) and on an iPad (or any
screen) from the same page. The main animal is the horse, and looking after one is meant to be
realistic: the real jobs, in the real order. Graphics aim for realistic too, within what a Quest can
draw: physically based materials, every texture painted at start-up with matching normal maps,
soft sun shadows, a sky with a moving sun, fog, instanced grass and trees.

Same shape as VR Test: one page (`_experiments/my-animal-farm.html`) that is mostly the title screen
and the HUD, ES modules in `experiments/my-animal-farm/js/`, three.js r180 in
`experiments/my-animal-farm/lib/`, a manifest, a service worker and icons. Every script address
carries the version (`?v=`), so a new page never runs old code from a cache.

## The farm (world.js)

-Z is north. The red centre-aisle barn has eight stalls (four each side), then the feed room (hay
stack, grain / pig feed / corn bins, the tap and sink, carrots, shavings) and the tack room (saddle
racks, bridle hooks, grooming box, the rosette board). The muck heap is behind the back door. The
hitching rail is by the front door. West: the paddock with a trough and a run-in shelter. East: the
40×20 m sand arena with five jumps and dressage letters. North-east: pens for goats, sheep, pigs
(with a wallow) and hens (coop, nest boxes, wire). South-west: the farmhouse; the Farm Office board
is on its porch. Down the lane: the show grounds, a 60×40 m arena with an eight-fence course,
grandstands with spectators, flags, a judge's box and the timing posts.

Colliders are boxes and circles; stall doors slide open as you (or a horse you lead) come near.

## The horse (horse.js)

- Built from cross-sections (a lofted trunk, neck and head), legs with real joints (elbow, knee,
  fetlock, pastern, hoof in front; stifle, hock, fetlock behind) placed by two-bone IK so hooves plant.
  A mane draped over the neck, forelock, a tail that grows from the dock.
- Gaits with the right footfalls: walk (4-beat), trot (diagonal pairs), canter (3-beat), gallop, with
  body bounce, rocking and head nod; jumping with tucked legs; grazing, eating at the rack, drinking,
  dozing with a hind leg cocked, ears, blinking, tail swishing.
- Eight breeds (size, build, jumping talent, speed, stamina) and nine coats (bay, dark bay, chestnut,
  black, dapple grey, palomino, buckskin, pinto, appaloosa) with socks/stockings and face markings,
  all painted per vertex.
- **Dirt is per vertex.** The paddock (and rolling) splashes mud; the curry comb turns caked mud into
  loose dust; the body brush lifts the dust away (and barely touches caked mud, so the order matters).
- **Tack goes on piece by piece**: saddle pad, then saddle (not without the pad), then the girth, then
  the bridle (the halter comes off). Reins run to your hands in VR.

## Looking after them (farm.js, care.js)

Time: one game minute per real second; the day runs 6am to bedtime (from 6pm, at the Farm Office).
Overnight the animals eat and drink what you left them.

- Horses: food, water, energy, happiness, health, hooves (pack with dirt; thrush risk if left), shoes
  (wear down: call the farrier). Hay in the rack (flakes from the bale), grain in the tub (more than
  two scoops a day gives colic: call the vet), water carried from the tap in the bucket, manure (every
  couple of hours) and wet bedding forked into the wheelbarrow and tipped on the heap, fresh shavings.
  Turnout in the paddock makes them happy (and muddy). Carrots as treats.
- Goats and sheep eat hay, pigs pig feed, hens corn; troughs need water; pens need the droppings
  forked out. Hens lay eggs in the morning (collect and sell); sheep grow fleeces (shear and sell).
- A jobs list (HUD and Farm Office) is worked out from the state, so it always says what's left.

## Money

Start with $3,000, Hazel (a warmblood mare), two goats and four hens. Customers arrive in the
morning wanting a horse or other animals boarded for a few days; they pay daily according to a care
score (food, water, happiness, health, clean coat, hooves, a clean stall) and tip for great care when
they collect. Buy supplies, horses (a market of four that changes every three days), goats, sheep,
pigs and hens; sell horses, eggs and fleeces; pay the farrier and the vet.

## Riding and shows (riding.js)

Gears: halt, walk, trot, canter, gallop (push forward / pull back to change), stick sideways steers.
Ride straight at the middle of a fence at a canter and press Jump as you come in; the horse picks its
own take-off spot. How high it can jump comes from breed talent, training (grows with every jump),
fitness, energy and happiness; a poor approach (slow, crooked, late) knocks rails, and a horse you
don't ask, or that isn't willing, refuses. Knocked rails fall and go back up.

Shows every third day, 9am–5pm: Novice 70 cm, Intermediate 90 cm, Advanced 1.10 m (entry fees,
prize money for 1st–4th). Ride through the timing posts, fences 1–8 in order, back through the posts.
4 faults per rail or refusal, 1 per second over the time allowed, three refusals and you're out.
Seven other riders; results table; rosettes on the tack room board.

## Playing it three ways (main.js, ui.js)

- **VR**: grip to hold things with your real hands (brush by rubbing the coat, hoof pick on a hoof, the
  bucket under the tap, a flake dropped in the rack); grip the halter to lead; grip the saddle to mount;
  point and pull the trigger at a horse, an animal or a person for their card; X: Farm Office, Y: jobs.
  Left stick walks, right stick turns (snap by default). Riding is first person from the saddle, with
  only some of the horse's bounce passed on; the wrist screen shows the time, money, what you hold,
  and during a show round the clock, faults and next fence.
- **iPad**: thumb stick on the left, drag to look, tap to pick up and use, drag a brush across the
  horse, buttons for gears and Jump while riding, a chase camera (or first person with View).
- **Computer**: WASD, drag to look, click to use, Space to jump, M for the Farm Office.

Panels are described once and drawn either as HTML or on a board in VR.

## Testing

`_tools/my-animal-farm/test.mjs` plays a full day in headless Chromium (about 7 minutes): the morning
jobs, leading, grooming, tacking up, jumping, a refusal, the pens, a customer, the shop and market, a
show with results, bed, saving and loading, then a VR session with IWER (grab the brush, groom, point
at the horse). The game skips drawing except for screenshots (`__farm.noRender`) and can run the
simulation faster (`__farm.timeScale`).

## Ideas for later

- Hosing down after a ride, sweat marks, rugs/blankets in cold weather.
- Lunging, a cross-country course, dressage tests in the arena.
- Hand tracking in VR (no controllers).
- Smoother join between the legs and the chest on the horse model.

## v1.1
- Round pebbles in the dirt (paths, paddock, pens) instead of square, pixelated ones.

## v1.2
- The horse's face (and the rest of every lofted shape: body, neck, head, goats, sheep, pigs) was
  built inside out: the faces pointed inward, so you saw the inside of the far side and the face
  looked see-through, with the legs showing inside the chest. The loft now winds its triangles
  outward, and end caps are checked to face outward. Lighting on the coat is right as a result.
- Signs are drawn at twice the resolution; the feed bins have big labels on the wall above them and
  their own labels no longer cut into the curve; galvanized steel no longer renders black.
- Hoof picking is clear: holding the hoof pick shows a yellow ring round every hoof that needs
  doing; tap one (or touch it with the pick in VR), she lifts the foot, one scrape cleans it, and
  you're told how many are left. The grooming kit is labelled and the jobs list says where it is.

## v1.3
- Stars scattered evenly over the sky (one possible star per cell in 3D direction space, at a random
  spot), mostly faint with a few bright, tinted blue or gold, twinkling, a faint Milky Way, hidden by
  clouds. They used to sit on a grid.
- Barn lights: a switch just inside the front door turns on warm lights down the aisle (four point
  lights and glowing bulbs) that light the stalls. The dusk message (7pm) says where it is. Remembered
  in the save.
- Messages no longer flicker: the HUD redrew them four times a second, replaying their pop-in.

## v1.4
- Wheelbarrow: on the screen it rolls along just in front of you and taps go straight past it (it used
  to catch taps meant for the muck behind it, and a stray tap let go of it). It bumps into walls
  instead of going through them, so you stop. The button at the bottom says "Let go". The fork drops
  muck in from up to 6.5 m away, and it tips when you wheel it within about 3 m of the muck heap. In VR
  it points where your hands are, not where you look.
- The farmhouse is yours to go in: the front door on the porch stands open into a kitchen (cupboards,
  sink, stove), a table and chairs, a living room (sofa, rug, bookcase), and your bedroom at the back.
  Tap the bed (or point at it in VR) to sleep from 6pm; you wake up there. Warm lamps inside; the
  windows show daylight by day and go dark at night.

## v1.5
- The wheelbarrow carries up to four things as well as muck: tools, hay flakes, bags of shavings.
  While you push it, whatever you put down (the button says "Put in barrow") or swap for another tool
  goes in the barrow; tap a thing in it to take it out. In VR, let go of something over the tray.
- You can't get stuck any more: a new touch on the thumb stick always takes it over (a lost touch-end
  used to leave it dead), touches and keys are forgotten when you switch apps, horses push you before
  walls do (they used to pin you against stall walls), the horse you're leading doesn't block you,
  and if you're pushing but not moving for half a second, horses let you slip past. The barrow can't
  be pushed further into a wall but never pins you.
- Leading out of a stall: the led horse slips through stall doorways instead of snagging on the posts.
- Letting go always does something: at a stall door she goes in her stall, near or in the paddock she
  goes in it, at the rail she's tied, otherwise she stands loose and you're told so. In VR letting go
  of the rope works even with a panel open.
- Owners collecting animals: the message and jobs list say who has come for which animal and how to
  give it back; the animal's own panel has "Give back to …"; the office lists everyone waiting by the
  house with a button each. People collecting are shown first by the house.
