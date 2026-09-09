# Implementation plan: Dottie's Mix and Match Racer — the big expansion

The racer shipped with four free animals, four unlockable ones, one track, an invisible
boundary and twenty-four fat coins. This plan doubles the animal roster (and adds the monkey
Dottie asked for), adds four more tracks, replaces the invisible boundary with barriers you
can see coming, spreads many more low-value coins over every track, and adds an Animal House:
a room where every animal you own stands around and you spend coins on furniture for them.

Everything lands in the one existing file, `_experiments/dotties-mix-and-match-racer.html`,
plus a cache bump in `experiments/dotties-mix-and-match-racer/sw.js`. No new dependencies, no
new assets, no build step. Three.js r128 rules from the original plan still apply: no
`CapsuleGeometry`, no `outputEncoding`, ES5-style code inside the single IIFE, primitives only.

Do the steps in order. Each step ends with a check. Commit at each **COMMIT** marker.

---

## 0. Ground rules (unchanged from the original plan, restated)

- One self-contained HTML file. Extra files live in `experiments/dotties-mix-and-match-racer/`.
- Three.js r128, plain `var`-style JavaScript, one `(function(){"use strict"; ... })();`.
- No downloaded assets. Every animal, track and piece of furniture is primitives at runtime.
- No shadow maps — blob shadows only. No physics library.
- Mobile first: touch buttons, safe-area insets, `setPixelRatio(min(dpr,2))`.
- Geometry cache (`GEOC`) entries are shared forever and must **never** be disposed. Anything
  built per-track or per-room is disposed by hand when it is torn down.
- Never put a model name or model identifier in any file, commit message, or comment.

---

## 1. Animals: 8 -> 17

Existing eight: cheetah, frog, duck, turtle (free starters), rabbit 150, eagle 250, shark 250,
elephant 300.

Add nine, so the roster is more than double and the monkey is in it:

| Key | Name | Price | Character |
|---|---|---|---|
| `monkey` | Monkey | 200 | Long grabby arms, curly tail. Superb cornering and a big jump; middling top speed. |
| `hedgehog` | Hedgehog | 150 | Tiny, spiky, low to the ground. Cheap, grippy, steady, slow. |
| `penguin` | Penguin | 200 | Tuxedo and flippers. Brilliant swimmer, comic on land. |
| `horse` | Horse | 300 | The honest all-rounder. High speed and acceleration, no tricks. |
| `ostrich` | Ostrich | 350 | Absurd legs, useless wings. The fastest land legs in the shop. |
| `kangaroo` | Kangaroo | 350 | Jump king. Enormous back legs, a tail that props it up. |
| `giraffe` | Giraffe | 400 | Silly neck, stilt legs. Big top speed, corners like a bus. |
| `crocodile` | Crocodile | 450 | Armoured and low. Heavy, snappy, happy in water and mud. |
| `dolphin` | Dolphin | 500 | The best swimmer in the game. On land it is a joke. |

Rules for each new animal, so mixing keeps working:

- Define all five slots (`head`, `body`, `front`, `back`, `tail`) in the same local frame the
  existing animals use: racer faces `+Z`, up is `+Y`.
- `body.build` must return `{group, len, height, width, attach}` via `bodyAttach(...)`, and may
  return `wings`. Heads sit with the neck base at the origin. Legs put the hip at the origin
  and the foot at `y = -len`. Tails trail towards `-Z`.
- Stats per part: `spd acc grip stab jmp swm mass`, each roughly 0..10. Ten parts of the same
  kind should not all be 10 — the normalisers divide the five-part sum by 50.
- Give asymmetric legs (flippers, fins) the same treatment as `sharkFin`: the assembler mirrors
  the right-hand copy with a negative scale, so `side:THREE.DoubleSide` matters.

Also:

- Shared leg helpers for animals whose front and back legs match, as `duckLeg` etc. already do.
- `computeStats` normalises the front/back leg mismatch against the widest gap in the catalog.
  That gap changes: the longest legs become giraffe (1.25) and the shortest dolphin (0.3), so
  the divisor moves from 0.75 to 0.95.
- Sort the shop by price so the cheap animals are at the top where Dottie can reach them.
- `describeQuirks` gets lines for the new extremes (stilt legs, armour, flippers).

**Check.** Every animal appears in the shop. Buying one adds it to all five garage slots.
A cheetah head on a dolphin body on giraffe legs builds, stands on its feet, and races.

**COMMIT** — "Racer: nine more animals, monkey included".

---

## 2. Tracks: 1 -> 5

The current track is a module-level IIFE that fills one global `TRACK`, plus a
`buildTrackMeshes()` that hard-codes the same zone numbers a second time. Refactor first, then
add tracks.

### 2a. Make the track data-driven

Introduce a `MAPS` array. Each entry is everything that makes a track a track:

```
{ key, name, price, blurb,
  sky, grass, fogNear, fogFar,       // theme
  road, kerb, coinColor,            // surface colours
  cp:[[x,z],...], halfW, laps,
  zones:[{type,t0,t1},...],          // 'mud' | 'water' | 'ice'
  ramps:[{t, h, gap}],               // gap is the water/void just past the lip
  gravity,                           // 22 normally, less on the moon
  barrier:{kind, ...},               // section 3
  coins:{count, pattern},            // section 4
  scenery:{trees, rocks, treeTop, trunk, rockColor, kind} }
```

Then:

- `buildTrackData(map)` replaces the IIFE: builds the curve, samples `N` points and tangents,
  and stores `halfW`, `laps`, `gravity`, `zones` and resolved ramp `t0/t1/h` on `TRACK`.
- Replace the module constants `HALF_W` and `RAMP_H` with `TRACK.halfW` / per-ramp `h`
  everywhere (simulation, ribbons, coin placement, start gate, scenery margins).
- `groundY(t)` loops `TRACK.ramps` instead of testing one hard-coded pair, so a track can have
  two ramps.
- The airborne launch test loops the ramps too, and gravity comes from `TRACK.gravity`.
- `zoneAt(t)` is unchanged in shape but reads the track's own zones.
- `buildTrackMeshes()` takes no hard-coded `t` values: it draws the road, kerb, each zone, each
  ramp, the barrier, the gate, the scenery and the coins from the map definition.
- Track teardown: `buildTrackMeshes` pushes every geometry it creates itself (ribbons, planes,
  the coin torus, canvas textures) onto a `trackOwned` list. `clearTrack()` removes the group
  from `raceScene`, disposes every material it finds by traversing, and disposes only the
  geometries on that list — never a `GEOC` entry.
- `ensureTrack(key)` rebuilds only when the wanted track is not the one already built, and also
  sets `raceScene.background`, the fog colour and the fog distances from the theme.

### 2b. The five tracks

1. **Meadow Splash** — free. The existing loop, unchanged: mud patch, splash zone, ramp over
   water, oak-ish trees, white picket fence.
2. **Sandy Cove** — free. Wide, fast, long straights along a bay. Sand road, three shallow
   water crossings, one small ramp. Palm trunks and boulders. Barrier: rope and buoys.
3. **Jungle Rumble** — 250 coins. Tight, twisty, dark green. Two long mud wallows, a stream, a
   ramp into a puddle. Dense trees. Barrier: a vine hedge.
4. **Frosty Peaks** — 400 coins. New `'ice'` zone: fast in a straight line, but steering drops
   to about 45% and the wobble goes up, so an icy corner is genuinely slippery. Pines, snow
   boulders. Barrier: snow banks.
5. **Moon Dust** — 600 coins. Grey dust, a black sky, `gravity` about 8 and two ramps, so a
   jump hangs for a comic length of time. Craters instead of trees, glowing rails as the
   barrier, and a `'water'` zone recoloured as a shimmering blue crater lake.

`'ice'` is the one new zone type: `updateRacer` multiplies `turnRate` by the zone's grip factor
and adds a little wobble; the tip line reads "ICE! Steer early, you will slide."

### 2c. Track picker

New screen `#maps`, same card shell as the shop: one row per track with name, blurb, and either
SELECT, or a price button that buys it. Selection is stored in `save.map`. The garage's button
row grows to two rows so RACE! is still the big one:

```
[RANDOM] [SHOP] [HOUSE] [MAPS]
[            RACE!            ]
```

**Check.** Each track loads, races and finishes without a leak: switch tracks ten times and the
renderer's geometry and texture counts come back to the same place. Every track's ramp launches
the racer and every ramp has ground under the lip.

**COMMIT** — "Racer: four more tracks and a data-driven track builder".

---

## 3. Barriers you can see

Today the boundary is invisible: past `halfW + 3` the racer is nudged back by a hidden hand.
Replace it with something Dottie can see and bump into.

- `TRACK.wallW = halfW + 2.2`. Build a continuous wall along both sides at that offset: one
  vertical ribbon per side (a strip two vertices tall following `groundY`), plus a horizontal
  cap ribbon along the top edge so the wall reads as solid from a low camera, plus instanced
  posts every few samples for texture. Wall height about 1.1 units — tall enough to read as a
  wall, short enough that the chase camera looks straight over it.
- Barrier kinds, chosen per track, all built from the same two ribbons with different colours
  and post shapes: `fence` (white rails, wooden posts), `buoy` (rope with striped floats),
  `vine` (green hedge with leaf blobs), `snow` (white bank with icicle posts), `rail` (dark
  panels with glowing strips).
- Collision: in `updateRacer`, when the racer's distance from the centre line passes
  `wallW - 0.6`, clamp it back onto that line, scrub speed to about 55%, and nudge the heading
  back towards the road so a child holding one steer button scrapes along instead of sticking.
  Play a soft bump sound, at most a few times a second.
- The wall follows the ramp's height, and continues past the ramp gap — landing short means
  landing in water, not falling off the world.

**Check.** Drive straight at the edge on every track: a fence stops you and you can see it stop
you. Nothing invisible remains.

**COMMIT** — "Racer: real barriers instead of an invisible wall".

---

## 4. Many more coins, worth less each

- A coin is worth **1** instead of 5, and gives `+6` boost instead of `+25`.
- Coin count per track goes from 24 to roughly 80–110, laid out in readable shapes rather than
  one lonely coin every so often: rows of three across the road, arcs that follow a corner, and
  single-file lines down the straights. Patterns come from the map definition so each track
  feels different.
- Coins are skipped over ramp gaps, and float at `groundY(t) + 1.0` so they sit above ramps too.
- One shared torus geometry and one shared material for all of them; they are rotated in a
  single loop, and taken coins are hidden rather than removed.
- Results wording still splits the placing reward from the pickups, so "+100 coins (60 for 2nd
  plus 40 picked up)" keeps making sense.

**Check.** A clean lap picks up dozens of coins with the pickup sound firing constantly and the
frame rate unchanged on a phone.

**COMMIT** — "Racer: many more coins, worth one each".

---

## 5. The Animal House

A room where the animals you own live, and where coins turn into furniture.

### 5a. The room

Own scene and camera (`houseScene`, `houseCam`), built once:

- A floorboard slab, a back wall and two side walls (front left open so the camera can see in),
  a pitched roof with two slopes and a ridge, a door on the back wall, two windows with frames
  and sills, and a lawn plane outside.
- The camera orbits slowly around the open front, framed the same way the garage camera is
  framed: it accounts for the card that covers the right of a wide screen or the bottom of a
  narrow one, so the room is never hidden behind the UI.

### 5b. The animals on show

- One full racer per owned animal, built with `buildRacer` using that animal in all five slots,
  arranged on a grid inside the room, facing the open front, biggest at the back.
- A nameplate sprite above each one, using the existing `nameSprite` helper.
- Idle animation only: a slow bob, a tail swing, a head turn, wings that ruffle, all on
  slightly different phases so the room looks alive. No stats, no physics.
- Rebuilt only when the owned list changes (a counter compared against `save.owned.length`),
  and disposed with `disposeRacer` so materials do not pile up.

### 5c. Decorations

`DECOR` is a list of `{key, name, price, blurb, build(M)}` entries, each returning a group that
is placed at its own fixed spot in the room. Seventeen items, cheap to dear, so there is always
something in reach:

| Item | Price | Item | Price |
|---|---|---|---|
| Stripey rug | 40 | Fish tank | 180 |
| Name banner | 60 | Bunk beds | 200 |
| Bean bag | 80 | Trophy shelf | 220 |
| Potted palm | 100 | Slide | 240 |
| Fairy lights | 110 | Splash pool | 260 |
| Bookshelf | 120 | Fountain | 280 |
| Snack table | 140 | Disco ball | 300 |
| Sofa | 160 | Bouncy castle | 340 |
| | | Telescope | 380 |

- Bought items are stored in `save.decor` and are placed on every visit.
- A few of them animate on the same idle clock: the disco ball spins, the fountain's water
  bobs, the fairy lights twinkle, the fish circle the tank.
- The house card lists every decoration with a price button, greys out what you cannot afford
  yet, and marks what is already in the room. It also shows "Animals 6 / 17" so the collection
  reads as a collection.

**Check.** Buy a decoration: coins go down, the item appears in the room immediately, and it is
still there after a reload. Own every animal and the room still renders smoothly on a phone.

**COMMIT** — "Racer: an animal house you can decorate".

---

## 6. Save data

Keep the existing key, `dotties-racer-save-v1`, so nobody loses their coins. Add three fields,
each validated the same defensive way the loader already validates the others:

- `maps`: array of owned track keys, defaulting to the free ones.
- `map`: the selected track key, falling back to the first free track if unknown.
- `decor`: array of owned decoration keys, filtered against `DECOR`.

**Check.** A save written by the shipped version loads with its coins, animals and best times
intact, and comes back with the two free tracks and an empty house.

---

## 7. Finish

- Bump the service worker cache to `dotties-racer-v2` so the new page replaces the cached one.
- Update the front-matter `description`, the title-screen copy and the README-facing blurb to
  mention the seventeen animals, five tracks and the house.
- Syntax-check the script (`node --check` on the extracted IIFE) and drive the built page in a
  headless browser: title -> garage -> shop -> maps -> house -> a full race, watching the
  console for errors and the renderer's `info.memory` for leaks across track switches.
- Push to `claude/dotties-game-expansion-719307`.

---

## Stretch goals (only if everything above is done)

- A time-trial mode with no NPCs and a ghost of the best lap.
- Per-track best times on the map picker.
- Letting the player move furniture around instead of dropping it in a fixed spot.
