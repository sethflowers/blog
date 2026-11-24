# Royal Flush: the great Magic Kingdom restroom quest

A phone game for people who are actually at Walt Disney World: a map of Magic Kingdom with every
restroom on it, and a quest to find (check in at) all of them. Uses the phone's GPS. Unofficial and
fan-made; no Disney artwork or logos.

- Page: `_experiments/royal-flush.html` · files: `experiments/royal-flush/` · test: `_tools/royal-flush/`
- **Not a VR game** (the user said so: it's for people walking round the park). Phone first (portrait),
  works on an iPad and a computer too. PWA, plays offline once opened (no signal in the park is common).

## How it plays

- **Start the quest** uses GPS (`watchPosition`, high accuracy). Your blue dot, its accuracy circle,
  "GPS ±8 m". More than 2.5 km from the park it says how far away you are and offers practice mode.
- **Practice at home**: a pretend you (purple dot); tap the map to walk there. Practice progress is kept
  in its own slot (`magic-kingdom:practice`) so it never spoils the real quest.
- Tap a 🚻 pin: a card with where it is, a fun fact, tags (themed, companion restroom, charging), the
  distance and direction ("120 m north-west · about 2 min walk"), **Found it!**, **Show the way**
  (a dashed line from you), **Next new one →**.
- Coming within ~35 m of a restroom you haven't found opens its card ("You're at …!").
- **Found it!** → flush sound, toilet-paper confetti, "FLUSHED! +200", then the **hand-washing
  mini-game** (scrub the screen for 20 s; only moving fingers count; up to +50), then rate it in rolls
  of 🧻 and say how long the line was.
- **Tick off from the list** (the user asked for this): every restroom in the List has a checkbox;
  one tap marks it found (no GPS check, no ceremony), tap again to untick. Cards of found ones have
  "↩️ Untick" too.
- **🚨 I need to go!**: the nearest restroom (found or not), its card and the way there.
- Points: 100 a restroom, +50 GPS bonus (within 50 m + accuracy), +100 for the themed one (Tangled),
  up to +50 for washing, +250 a finished land, +200 a badge. 15 badges (First Flush, Land Lord, Royal
  Flush, Speed Run, Rope Drop Relief, Fireworks Flush, Close Call, Marathon Bladder, Cartographer…).
- Pins are approximate. With GPS, a found restroom near you offers **"Pin is off: move it here"**
  (saved per device, shared by both slots). The menu can **add a restroom** the map is missing.
- Taps on a landmark name it.

## The map

(1.x; since 2.0 the layout is traced from the guide map, and since 2.1 it is fitted to OpenStreetMap: see
the versions below.) Network access from the build container was then limited to package registries, so
no OpenStreetMap data, tiles or pictures could be fetched. The map is drawn in code (`map.js`) from `parks.js`, which describes
the park in metres from Cinderella Castle (x east, y north): lands, water, walkways, the railroad,
Main Street's buildings, landmarks and restrooms. GPS is converted with a flat projection
(`toXY`), good to a metre or two across a park. Landmark positions come from their published
coordinates (castle 28.41917, −81.58111; Space Mountain, Big Thunder, Haunted Mansion…); restroom
positions are from knowledge of the park maps, so expect some to be tens of metres off until fixed
in the field. Disney's own park map is their artwork, so it isn't used.

Look: storybook style. Forest (seeded random trees) outside the railroad, tinted lands with dashed
white borders, sandy shores and glinting water, paths with edges, the hub lawn, Main Street's shops,
emoji landmarks on white discs, and drawn castle / Space Mountain / Big Thunder that stand up off the
map. Land names in italic serif. Labels avoid each other and the pins (pins win, then the big
landmarks). Pins shrink when zoomed out; names show from zoom 2.6. Compass and scale bar.

Battery: the map is drawn into a cached canvas and only redrawn when the view or the pins change;
the pulsing dot and the route are drawn over the copy.

## Adding the other parks

`PARKS` in `parks.js` already lists EPCOT, Hollywood Studios and Animal Kingdom (shown on the title
as "coming soon"). Each needs the same shape as Magic Kingdom (origin, bounds, lands, water, paths,
rail or a perimeter, labels, drawn landmarks, buildings, landmarks, restrooms) and `ready: true`. The
lands table is Magic Kingdom's; give each park its own lands. Progress is already kept per park.

## Versions

### 1.0
First version: map, GPS and practice modes, check-in with celebration and hand washing, ratings,
ticking off from the list, "I need to go!", badges and points, pin fixing and adding restrooms, saves
(`royal-flush-save-1`, with `upgrade()`), offline service worker, loading screen, icons drawn from the
game's castle (`_tools/royal-flush/icons.mjs`), and a quick test (`_tools/royal-flush/test.mjs`, ~20 s).

### 1.1: works well on an iPhone
- **Bug:** opening a card was meant to slide the map so the pin sits above the card, but the sign
  was wrong: it slid ~200 m the other way, so on a phone you saw only forest behind the card. Fixed,
  and the pin now goes just above the card's top edge (messages at the top can't cover it). Test:
  "opening a card brings its pin into view above the card".
- **Smooth dragging on a 3x screen:** a full map redraw (≈4,500 trees) took ~30 ms. While a finger
  drags or pinches, or the view glides, the last picture is now slid and scaled (like map apps do)
  and the map is redrawn properly when it stops. Test: no full redraws during a drag, one after.
- **Which way you're facing:** a heading cone on your dot, from the compass (an iPhone asks for
  motion permission, only from a tap: "Start the quest" and "Me" ask), or from GPS while walking.
- The compass and scale bar stay clear of the notch when the iPhone is sideways.
- Location-off help gives the iPhone settings path (Privacy & Security › Location Services ›
  Safari Websites › While Using).
- Buttons: `touch-action: manipulation` (no double-tap zoom delay).
- Title screen fits a small iPhone (SE): parks in one sliding row, start buttons first, tighter
  spacing on short screens.
- "You're at …" no longer shows a message as well as opening the card.
- Test now also runs on an emulated iPhone 13 (portrait and sideways) and an iPhone SE.

### 1.2: map tiles, so dragging never shows unfinished map
- The user saw the map "loading" at the edges while dragging: 1.1 slid one cached screen-sized
  picture, so the area beyond it was blank until the finger lifted.
- Now the ground (lands, water, paths, trees, buildings, railroad) is drawn in 256-px tiles at
  power-of-two zoom levels and cached, like a phone's map app. Between frames (7 ms of spare time,
  3 ms while a finger is down) the screen's tiles, a ring of tiles around it, and the coarser level a
  ring wide are drawn ahead. A drag moves into tiles that are already there; a missing tile (a very
  fast fling) shows the coarser tile, blurry for a moment, never blank.
- Names, landmark icons and the drawn castle / Space Mountain / Big Thunder are drawn over the tiles
  (they would be cut at tile edges otherwise), cached with the tiles until the view changes; pins,
  you and the route on top, every frame.
- Trees are bucketed in 60 m cells so a tile only looks at its own. Tiles are drawn at 2x (about
  1 MB each); the cache holds what the look-ahead needs (about 60 on an iPhone) and drops the least
  recently used.
- Test: after a moment's rest, 24 frames of dragging use only finished tiles (0 missing).

### 2.0: the map traced from the official guide map
The user uploaded the official Magic Kingdom guide map (PDF) and said derivative work is fine. The PDF
itself is **not** kept in the repo (it's Disney's); `_tools/royal-flush/trace.py <pdf>` regenerates
`experiments/royal-flush/js/mk-map.js` from it:
- Page 2 rendered at 150 dpi; the guide's number circles, icons and land-name boxes painted out
  (inpainted); every pixel sorted by colour into water, walkway, grey street, sand, building, tree, lawn;
  each class turned into simplified polygons (with holes: lawns in the walkways, islands in the water).
  Buildings keep their guide colour (a touch brighter) with an outline in a darker shade of it.
  Trees on a jittered grid over the guide's tree areas. The railroad traced by hand (the guide cuts off
  its northern loop, so that part follows the park's edge).
- Map pixels → metres: east-west affine, north-south with a v² term (the guide is drawn in perspective,
  its north squashed), least-squares through 7 landmarks with known positions (castle, station, hub,
  Space Mountain, Big Thunder, Haunted Mansion, small world). Residuals up to ~20 m; those landmark
  positions are themselves from memory, so overall expect 10–30 m. A fuller fit (u·v terms) matched the
  anchors better but flung the north-east (TRON) 100 m out, so it was dropped.
- **The restrooms are now the guide map's 18 restroom symbols**, not guesses. That fixed a lot: Liberty
  Square has none (the two there were wrong; its card says "no plumbing in colonial times"), the front
  gate ones are on the right not the left, there are none at Big Thunder or Prince Eric's Village, and
  Tom Sawyer Island has two. Companion restrooms are flagged from the guide's symbols. Old ids are kept
  where it's the same restroom, so saves carry over; a found restroom that no longer exists just stops
  counting. Players with a save get a "New map!" message once.
- Rides, stations and land names placed from the guide's numbered circles (33 landmarks now).
- The renderer draws the traced shapes in the game's own style (no guide artwork is used): lawn, sandy
  shores, water with a glint, walkways with an edge, grey streets, shaded trees, outlined buildings, the
  railroad; procedural forest all round so the guide's rectangle doesn't show. Still in tiles.
- The "Land Hopper" badge and the lands panel skip lands with no restrooms.

### 2.1: the map lined up with OpenStreetMap
Network access to Overpass was allowed. overpass-api.de itself reset every connection from the container
(not a proxy refusal), so the data came from the other public Overpass servers (maps.mail.ru, kumi.systems:
same OpenStreetMap data), fetched in small pieces because big queries timed out. It's kept in
`_tools/royal-flush/osm/` (1.7 MB, ODbL) so the fit can be repeated exactly.

**What OSM showed about 2.0:** its 7 remembered landmark coordinates were off. The game's origin
(28.41917, −81.58111, "the castle") is 37 m south of the castle's middle in OSM, and against OSM footprints
2.0's landmarks were off by a median 47 m (up to 82 m); restroom pins were 16–77 m from the toilets OSM maps.
The origin is kept as it is (saved "moved" pins and added restrooms are metres from it); the castle is now
simply at (−8, 37).

**Why not just better landmarks:** the guide map isn't drawn to scale. Big show buildings at the edges are
pulled in (Space Mountain ~60 m, TRON's building runs off the guide's edge), Tomorrowland's middle is
stretched. Any single formula through 31 landmarks (affine, v², full quadratic, a thin-plate spline) left a
median ~21 m, and leave-one-out tests ~23 m.

**The fit (`_tools/royal-flush/osm_fit.py`):** a warp from guide pixels to metres: affine plus a smooth
displacement grid (every 110 px, ~36 m, with a smoothness penalty), fitted like ICP over 14 rounds with a
shrinking radius (60 → 12 m), robustly weighted:
- every 3 m of OSM footway inside the park should be on a traced walkway or street (6,662 points);
- OSM water edges (castle moat, Jungle Cruise, lagoon shore, Fantasyland ponds) on traced water edges;
- the riverboat's boat channel on traced water. OSM has **no Rivers of America area** at all (only the
  channel and lock west of it), so without this the north-west was unconstrained and the river's arm
  ended up ~80 m north, across the railroad;
- OSM building centroids to traced building centroids (mutual nearest, similar size; the guide merges
  whole blocks into one shape, so only some match);
- 17 landmarks whose drawing is unmistakable (castle, Space Mountain's dome, Carousel of Progress, the three
  stations, teacups, Dumbo, …) to their OSM footprints, weighted heavily. Haunted Mansion, TRON, Pirates and
  some others are left out: the guide draws a facade or queue where OSM has the show building.

Results: landmarks fitted to a median 2.9 m; leaving each landmark out in turn, it lands a median 14 m from
OSM (Space Mountain left out: 59 m: the guide squeezes it, which is why it's an anchor); 83% of in-park OSM
footway is on a traced walkway (2.0: 54%). Debug overlay: `osm_fit.py --debug DIR`.

**Restrooms vs OSM toilets** (none of these were used in the fit, so they're an independent check): the
warped guide symbols of the 16 restrooms outside Tom Sawyer Island land 3–38 m from an OSM toilet (median
12), each a different one. 16 pins now sit **on** the OSM toilet (mutual nearest within 45 m; `pinSource` in mk-map.js
says which). They moved 16–77 m from 2.0's (2.0 → 2.1 distance): gate 43, townsq 30, firstaid 44, terrace 41,
veranda 51, pirates 52, pecos 34, tiana 50, tangled 16, pinocchio 18, gaston 63, teacups 34, circus 77,
tron 66, cosmic 59, space 72. Tom Sawyer Island's two have no OSM toilet (OSM doesn't map the island); they
keep the warped guide positions, on the island. OSM toilets not used: one west of the railroad (backstage),
a backstage block by the parade buildings, and a second unisex toilet 20 m from the Pecos Bill one. None of
OSM's in-park toilets is a public restroom the guide lacks.

**Other changes:**
- The railroad is OSM's Walt Disney World Railroad loop (2.0's northern loop was a guess; the guide cuts it
  off). OSM has an 8 m gap east of Space Mountain, bridged when joining.
- The guide's pale east margin had been traced as a long thin building (2.0 hid it under forest along a
  straight edge); it's dropped. The forest now grows outside the guide's frame (its rectangle minus the east
  margin and the south-east bus lots, warped: `frame`/`frameIn` in mk-map.js) instead of outside a box.
- Pipeline: `trace.py <pdf>` now writes `_tools/royal-flush/mk-trace.json` (shapes and places in guide
  pixels; no GPS fit), and `osm_fit.py` writes mk-map.js (and `mk-warp.json`, the warp). The PDF still isn't
  in the repo, so this time mk-trace.json was recovered from 2.0's mk-map.js by inverting 2.0's fit exactly
  (round trip within 0.05 m).
- Credits: "map data © OpenStreetMap contributors" on the title screen and in the menu's About.
- Players with a save see "The map now lines up with OpenStreetMap…" once.
- Test: OSM's own coordinates for the castle, Space Mountain, Big Thunder, Main Street Station and Carousel
  of Progress go through the game's `toXY` and must land within 8 m of their drawings (1–5 m now), and every
  OSM-sourced pin within 3 m of its OSM toilet. 2.0 would fail both (castle 38 m off).

### 2.2: TRON drawn (it was in the woods)
- **Bug (user, in TRON's line):** "I'm missing all the area where TRON exists. I'm in line but off in the
  woods on the map." The guide map's drawing stops at the railroad; TRON's queue crosses over the tracks and
  its canopy, show building and restroom are past them, so the guide only squeezes a sketch of it against
  its edge. 2.1 grows forest outside the guide's frame, so the whole TRON area (and its restroom pin) was
  forest.
- Now `osm_fit.py` draws TRON from OpenStreetMap (box x 288–520, y 40–230 m): the public walkways and the
  queue (footways buffered to 3.2 m, pedestrian areas as mapped), the canopy (`building=roof`, drawn
  see-through with a blue edge and no shadow: `a: 1` on the building), the show building (Tomorrowland's
  violet) and the restroom building. The traced shapes and trees are cut away (shapely) where OSM's are,
  east of x 282 m, so the guide's squashed sketch doesn't show under them; `clear` (OSM's area + 14 m)
  keeps the forest off, leaving lawn. The 🏍️ TRON icon sits on OSM's show building.
- Test: a GPS fix at a point of OSM's covered queue walkway must be on a walkway, under the canopy, with no
  tree within 3 m (nearest is now 45 m); screenshot `15b-iphone-tron-line.png`.
