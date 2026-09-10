# Implementation plan: Dottie's Racer — hills, a thumb stick, and a house you can walk around

Three things Dottie asked for after playing the expansion:

1. The tracks are flat. They should have hills.
2. Steering is two buttons. It should be a stick, wherever the left thumb happens to land.
3. The Animal House is a doll's house seen from the far side of the lawn. It should be
   somewhere you can walk about inside and see everything up close.

Everything lands in the one existing file, `_experiments/dotties-mix-and-match-racer.html`,
plus a cache bump in `experiments/dotties-mix-and-match-racer/sw.js`. No new dependencies, no
new assets, no build step. The ground rules from the earlier plans still hold: three.js r128,
plain `var`-style JavaScript inside the single IIFE, primitives only, no shadow maps, geometry
cache entries (`GEOC`) shared forever and never disposed, anything built per-track or per-room
disposed by hand, and never a model name or model identifier in any file or comment.

---

## 1. Hills

### Height is a function of world position

`terrainY(x, z)` is a sum of four sinusoid terms: three long rolling ones for the shape of the
land, and one short one (`a4`/`f4`) for the whoops. Height deliberately depends on **where you
are**, not on **how far round the lap you are**, because a course like Meadow Splash passes
close to itself: two points a metre apart but half a lap apart in `t` would otherwise disagree
about the height of the ground between them and leave a cliff.

Each map carries `hills:{amp, freq}`, so Sandy Cove gets long gentle dunes (`0.55/0.8`) and
Frosty Peaks gets something steeper (`1.3/0.9`).

### The road drapes over it

`buildTrackData` samples `terrainY` once per track sample into `TRACK.elev`. Then:

- `baseY(t)` interpolates that array — the height of the centre line.
- `groundY(t)` is `baseY(t)` plus any ramp standing on it. Every mesh that used to sit at a
  fixed `y` (kerb, road, mud, water, ice, the shine flecks, the start line, the gate, the ramp
  supports) now reads its height from it, so they all agree to the centimetre.
- `slopeAt(t)` is rise per unit travelled, used by the simulation.

The road is **flat across its width** at the centre line's height. That is what a real road cut
into a hillside looks like, and it also means the simulation only ever needs one height per
point on the course.

### Joining the road back to the land

Three pieces, outward from the kerb:

1. A flat grass shoulder out to `halfW + SKIRT_IN`, at road height. The barriers stand on this,
   which is why a racer that runs out of road is still on a known surface.
2. `skirtGeo()` — three bands out to 24 units further, each leaning a little more of the way
   from road height towards `terrainY` (weights in `SKIRT`). Each band's inner edge is exactly
   the previous band's outer edge, so the skirt has no cracks in it.
3. The open ground: the same 900x900 plane as before, but subdivided and displaced by
   `terrainY`, so the skirt's outermost edge lands exactly on it.

Trees and rocks stand on `groundHere(x, z)`, which is `terrainY` unless the item is close enough
to the course to be standing on the skirt, in which case it blends the same way the skirt does.

### What a hill does to the driving

- **Uphill drags, downhill hurries**: the speed target is scaled by `clamp(1 - slope*1.2, .5, 1.3)`
  and a gravity term is applied along the slope. Speed is capped at `top*1.9` so a boosted
  downhill run is the fastest thing in the game without being unbounded.
- **Crests throw you**: if holding the ground would need more downward pull than gravity has
  (`d(slope*speed)/dt < -1.1g`), the racer stops holding it. Flat out over the sharpest rise
  this is real air; most of the time it is a frame or two of light wheels.
- Which is why a landing only costs speed and makes a noise when `airTime > 0.16`, and why the
  tucked-legs jump pose waits for `airTime > 0.1`. Otherwise a hilly lap would be one long
  thumping with twitching legs.
- The chase camera's extra lift and the blob shadow both work off **height above the ground**
  rather than height above sea level, or the camera would sink into every valley and every
  shadow would hang in the air over one.

**Check:** race every track. The road never floats or sinks into the land, nothing falls
through anything, and a lap time is within a few seconds of what it was.

**COMMIT**

---

## 2. The steering pad

The two `◀`/`▶` buttons go. In their place `#stickZone` covers the lower left of the screen and
the stick draws itself under whichever thumb lands in it.

- `STICK_R` is the throw, `STICK_DEAD` a small dead zone, so a nudge is a nudge and a shove is
  a shove — two buttons could only ever say all or nothing.
- If the thumb slides past the edge of the stick, the stick's origin comes with it. Without
  that, one long drag pins the steering at full lock for the rest of the corner.
- The horizontal reading steers. The vertical reading is only read when walking round the
  house (`stick.twoAxis`), and the knob only moves vertically there, so nothing on screen
  suggests up and down do something in a race when they do not.
- Steering follows an analog stick much more closely than it followed a button
  (`1e-7` against `0.002` per second), because the thumb is already doing the smoothing.
- The pad is not gated on a touch screen: dragging with a mouse works the same way. The
  boost and slow buttons still are, and the first-race hint only shows on a touch screen.

**Check:** on a phone-sized window, a small slide is a small correction and a big one is full
lock; letting go re-centres; the hint disappears the first time the pad is used.

**COMMIT**

---

## 3. A house you can walk around

### A bigger room

`ROOM` grows from 21x14 to 27x19 with taller walls, and the pieces of the room that were laid
out by hand (wallpaper stripes, windows, roof rafters, floorboards) are now counted from
`ROOM.w`/`ROOM.d`. The furniture layout was drawn for the old room, so `rebuildDecor` scales
each item's `at` by `ROOM_HX`/`ROOM_HZ` rather than every literal being retyped. Animals stand
in three rows with a wider gap, which is what turns the middle of the room into aisles.

### Walking

WALK AROUND puts the player's own racer in the doorway and hands it the race's stick: sideways
turns, forwards walks. Arrow keys and WASD do the same on a desktop.

- Each piece of furniture gains an `r` — its footprint, or `0` for a rug, a banner or something
  hanging from the roof. `houseBlocks()` collects those plus a circle for each animal.
- `walkClear()` pushes a position out of anything it is inside and then back inside the walls,
  a few times over, because squeezing past the sofa can put you back inside the fish tank.
  `enterWalk` runs it too, so a paddling pool parked in the doorway is stepped around rather
  than slid out of on the first frame.
- The camera sits over the shoulder. The three walls hold it in; the open front does not, so
  backing up to the doorway frames the whole room.
- Both house cameras now pick their **field of view from the shape of the screen**
  (`houseFov`), aiming for the same width of room in shot either way up. A fixed field of view
  through a phone held upright was most of why the room looked so far away — and the overview
  now frames a slice of the room rather than all of it, since anyone who wants the far corners
  can walk to them.

**Check:** walk into every corner. You cannot leave the room, you cannot stand inside the
furniture or an animal, the labels are readable from a step away, and BACK returns to the card
with the avatar cleaned up.

**COMMIT**

---

## 4. Finishing

- Title copy, the experiment's `description`, and the track blurbs mention the hills and the
  stick. Sandy Cove is no longer described as flat.
- `sw.js` cache bumped so the new build is picked up rather than served from the old cache.
