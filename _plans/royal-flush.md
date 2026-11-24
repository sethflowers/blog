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

Network access from the build container was limited to package registries, so no OpenStreetMap data,
tiles or pictures could be fetched. The map is drawn in code (`map.js`) from `parks.js`, which describes
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
