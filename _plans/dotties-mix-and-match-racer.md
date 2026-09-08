# Implementation plan: Dottie's Mix and Match Racer

A 3D, third-person animal racing game for the blog's Experiments section. Before a race the
player builds a racer by mixing body parts from different animals. Parts carry stats, so the
hybrid's speed, handling, jumping and swimming come from what it is made of. NPC racers are
random hybrids. Winning earns coins that unlock more animals.

This plan is written to be followed step by step. Do the steps in order. Each step ends with a
check. Do not skip the checks. Do not add features that are not in this plan until every
required step is done; the "Stretch goals" section at the end lists what to add if time remains.

---

## 0. Ground rules

- **Read `_experiments/nightfall-zombie-fps.html` first** (at least lines 1 to 230 and 1740 to 1790).
  It is the reference for how an experiment is structured: front matter, `{% raw %}` wrapper,
  CSS overlays, HTML screens, one big IIFE of JavaScript, a service worker registration at the end.
  Match its conventions.
- **Single self-contained HTML file** at `_experiments/dotties-mix-and-match-racer.html`.
  Extra files go in `experiments/dotties-mix-and-match-racer/` and are referenced by absolute
  path `/experiments/dotties-mix-and-match-racer/...`. This is exactly how Nightfall does it and
  the README documents it.
- **Three.js r128.** Copy `experiments/nightfall-zombie-fps/three.min.js` unchanged. It is r128,
  which means:
  - `THREE.CapsuleGeometry` does **not** exist. Build capsules from a `CylinderGeometry` plus two
    `SphereGeometry` end caps, or just use a scaled `SphereGeometry`.
  - Use `geometry.rotateX()` etc. or `mesh.rotation` for orientation. `BoxGeometry`,
    `SphereGeometry`, `CylinderGeometry`, `ConeGeometry`, `TorusGeometry`, `PlaneGeometry`,
    `BufferGeometry`, `CatmullRomCurve3`, `InstancedMesh`, `Group`, `MeshStandardMaterial`,
    `MeshLambertMaterial`, `HemisphereLight`, `DirectionalLight`, `Fog`, `Clock` all exist.
  - Do **not** set `renderer.outputEncoding`. Leave it default so hex colours look like the hex
    you typed. (Nightfall sets sRGB and then has to convert every colour; skip that complexity.)
- **No downloaded assets.** Every animal is built from primitives at runtime. No textures are
  needed; flat colours with `MeshStandardMaterial({flatShading:true})` give a clean toy look.
- **No physics library.** Movement is an arcade kart model (section 6). Locomotion is
  procedural animation driven by speed (section 7). "Bad" hybrids are bad because the stats
  formula says so, not because a solver fell over.
- **Plain ES5-style JavaScript** inside one `(function(){ "use strict"; ... })();` like Nightfall.
  `var`, function declarations, no modules, no build step. Arrow functions and `let`/`const` are
  fine in modern browsers, but stay consistent with the reference file.
- **Mobile is first class.** Portrait or landscape, touch buttons, `touch-action:none`,
  safe-area insets, `maximum-scale=1`. Cap `renderer.setPixelRatio(Math.min(devicePixelRatio, 2))`.
- **No shadow maps.** Use a flat dark translucent disc ("blob shadow") under every racer.
- Commit after each milestone (marked **COMMIT** below). Push at the end with
  `git push -u origin claude/animal-hybrid-racing-game-61o1b9`. Do not open a pull request.
- Never put a model name or model identifier in any file, commit message, or comment.

---

## 1. Files to create

| Path | Purpose |
|---|---|
| `_experiments/dotties-mix-and-match-racer.html` | The whole game. Front matter + `{% raw %}` + page. |
| `experiments/dotties-mix-and-match-racer/three.min.js` | Byte-for-byte copy of Nightfall's. |
| `experiments/dotties-mix-and-match-racer/manifest.json` | PWA manifest (copy Nightfall's, change names, paths, colours, `"orientation": "any"`). |
| `experiments/dotties-mix-and-match-racer/sw.js` | Service worker (copy Nightfall's, change `CACHE` to `dotties-racer-v1`, `BASE` to `/experiments/dotties-mix-and-match-racer/`, and the cache-key prefix in `activate`). |
| `experiments/dotties-mix-and-match-racer/icon-192.png`, `icon-512.png`, `apple-touch-icon.png` (180x180) | Icons. Generate with the script in section 11. |

Front matter for the HTML file (exactly this shape):

```
---
title: Dottie’s Mix and Match Racer
description: Build a racer out of mixed-up animal parts, then race it in 3D against other mixed-up animals. Win coins to unlock more animals. Works on a phone.
date: 2026-09-09
layout: null
---
{% raw %}
<!DOCTYPE html>
...
{% endraw %}
```

Use the curly apostrophe `’` in the title to match Nightfall.

---

## 2. Page structure (HTML + CSS)

Top-level elements, in this order inside `<body>`:

1. `<canvas id="c">` fixed, full screen. One canvas is used for the garage preview and the race.
2. `<div class="screen" id="title">` Title screen. Big title "DOTTIE’S" with subtitle "MIX AND MATCH RACER",
   a short paragraph of instructions, a button `#playBtn` "BUILD YOUR RACER". Bright, playful
   palette (not Nightfall's horror palette). Suggested CSS variables:
   `--sky:#8fd3ff; --grass:#6fcf5a; --sun:#ffd166; --ink:#1b2a41; --card:rgba(255,255,255,.92); --coin:#ffb703`.
   Font: a rounded system stack, e.g. `"Trebuchet MS","Segoe UI",Helvetica,Arial,sans-serif`, bold headings.
3. `<div id="garage" class="screen panel hidden">` Garage overlay. It must **not** cover the whole
   canvas: the 3D preview of the racer renders behind it. Layout: on wide screens a card on the
   right 40% of the screen; on narrow screens a card at the bottom 55% of the screen with the
   preview above. Contents:
   - `#coinCount` top right: coin icon (a CSS circle) and number.
   - Five slot rows, each `.slot` with `data-slot="head|body|front|back|tail"`, containing a
     `◀` button, a label (slot name small on top, animal name large), and a `▶` button. Buttons
     have `data-dir="-1"` / `data-dir="1"`.
   - Six stat bars `.stat` with `data-stat="speed|accel|handling|stability|jump|swim"`: a label
     and a track div with a fill div whose width is set in percent.
   - `#quirks`: an unordered list of one-line notes about the build (see section 5.4).
   - Buttons: `#randomBtn` "RANDOM", `#shopBtn` "SHOP", `#raceBtn` "RACE!" (big, primary).
4. `<div id="shop" class="screen panel hidden">` Shop overlay. Same card styling. A list of every
   animal in the catalog with name, one-line blurb, and either "OWNED" or a "BUY 250" button
   (`data-animal="eagle"`). Locked animals the player can't afford have the button disabled.
   `#shopBack` button "BACK".
5. `<div id="hud" class="hidden">` Race HUD, `pointer-events:none`:
   - `#pos` top left: place, e.g. "2nd", large.
   - `#lap` top centre: "LAP 1 / 3".
   - `#timer` top right: "0:42.3".
   - `#boostTrack`/`#boostFill` bottom centre: horizontal boost meter.
   - `#zoneTip` small text under the lap counter, shown briefly when entering a zone
     ("SPLASH! Swimmers go faster here").
   - `#countdown` centre: huge "3", "2", "1", "GO!".
6. Touch controls (`.tbtn`, `hidden` until racing, shown only if `'ontouchstart' in window`):
   `#tLeft` and `#tRight` bottom left (steer), `#tGas` big bottom right, `#tBoost` above it.
   Use `position:fixed`, 50% border radius, translucent white background, bold labels
   "◀", "▶", "GAS", "BOOST".
7. `<div class="screen hidden" id="results">` Results: `#resultPlace` ("YOU CAME 1ST!"),
   `#resultTime`, `#resultCoins` ("+100 coins"), `#resultBest` (best time note),
   buttons `#againBtn` "RACE AGAIN", `#garageBtn` "GARAGE".
8. `<div id="loading">LOADING</div>` removed after init, like Nightfall.
9. `<script src="/experiments/dotties-mix-and-match-racer/three.min.js"></script>` then the
   game `<script>`, then the service worker registration block copied from Nightfall's tail with
   the path changed.

`.screen` is fixed, full inset, flex-centred, z-index 30, with a semi-transparent sky gradient
background for title and results. `.panel` variants have a transparent background so the canvas
shows through, and only the inner `.card` is opaque. `.hidden{display:none !important}`.

All buttons: at least 44px tall, no `:hover`-only affordances, `touch-action:manipulation`.
Wire every button with `click` only (do not add `touchend` handlers too; Nightfall does both,
but double firing is a common bug and `click` fires on touch devices).

**Check:** open the page with the game script stubbed out; all screens can be shown by toggling
`hidden` in devtools and nothing overflows horizontally on a 375px wide viewport.

---

## 3. Script skeleton and utilities

Order the code in the IIFE in these sections with banner comments, exactly as Nightfall does:

```
/* ===== 1. utils ===== */
/* ===== 2. save data ===== */
/* ===== 3. animal catalog ===== */
/* ===== 4. racer builder ===== */
/* ===== 5. stats ===== */
/* ===== 6. renderer, scenes, lights ===== */
/* ===== 7. track ===== */
/* ===== 8. racer simulation ===== */
/* ===== 9. npc ai ===== */
/* ===== 10. animation (gait, camera) ===== */
/* ===== 11. audio ===== */
/* ===== 12. input ===== */
/* ===== 13. ui + state machine ===== */
/* ===== 14. main loop ===== */
```

Utilities to define:

```js
function rand(a,b){ return a+Math.random()*(b-a); }
function lerp(a,b,t){ return a+(b-a)*t; }
function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
function angleDiff(a,b){ var d=(b-a)%(Math.PI*2); if(d>Math.PI)d-=Math.PI*2; if(d<-Math.PI)d+=Math.PI*2; return d; }
function fmtTime(s){ var m=Math.floor(s/60), r=s-m*60; return m+':'+(r<10?'0':'')+r.toFixed(1); }
function ordinal(n){ return n+(['th','st','nd','rd'][(n%100>10&&n%100<14)?0:(n%10<4?n%10:0)]); }
// seeded RNG so NPC builds are reproducible per race
function makeRng(seed){ var s=seed>>>0; return function(){ s=(s*1664525+1013904223)>>>0; return s/4294967296; }; }
```

Global state object:

```js
var state = {
  mode: 'title',            // 'title' | 'garage' | 'shop' | 'countdown' | 'racing' | 'finished'
  build: null,              // {head, body, front, back, tail} animal keys
  racers: [],               // during a race, player is racers[0]
  raceTime: 0, countdown: 0, laps: 3, finishedOrder: []
};
```

---

## 4. Save data (localStorage)

Key: `'dotties-racer-save-v1'`. Shape:

```js
{ coins: 0, owned: ['cheetah','frog','duck','turtle'],
  build: {head:'cheetah', body:'cheetah', front:'cheetah', back:'cheetah', tail:'cheetah'},
  bestTime: null, bestLap: null, wins: 0, races: 0 }
```

`loadSave()` reads and parses inside `try/catch`, fills in any missing fields with defaults
(so an older save keeps working), and validates that every animal key in `owned` and `build`
exists in the catalog (drop unknown ones, replace an unknown build slot with `'cheetah'`).
`saveGame()` writes inside `try/catch`. Call `saveGame()` after every coin change, purchase, or
build change.

---

## 5. Animal catalog and stats

### 5.1 Slots

Five slots: `head`, `body`, `front` (front legs), `back` (back legs), `tail`. Wings belong to a
body (eagle, duck). Fins are what a shark has instead of legs and tail. Every animal defines all
five slots, so any slot can take any animal.

### 5.2 Per-part stats

Each part has integer stats 0 to 10: `spd` (speed), `acc` (acceleration), `grip` (handling),
`stab` (stability), `jmp` (jump), `swm` (swim), and `mass` (1 to 10). Leg parts also have `len`
(leg length in world units, used for the leg-mismatch penalty and body height). Body parts have
`wings` 0 to 10 (glide ability while airborne).

Use exactly this table. Rows are `spd/acc/grip/stab/jmp/swm/mass` and, for legs, `len`; for
bodies, `wings`.

| Animal | Head | Body (wings) | Front legs (len) | Back legs (len) | Tail |
|---|---|---|---|---|---|
| cheetah (starter) | 6/6/5/4/3/1/2 | 7/6/5/4/3/1/4 (0) | 8/7/6/4/4/1/3 (0.9) | 9/8/5/4/5/1/3 (0.95) | 5/3/7/6/2/1/1 |
| frog (starter) | 2/4/4/5/6/7/1 | 3/5/4/5/7/7/2 (0) | 3/5/5/4/6/6/2 (0.55) | 4/8/3/3/10/6/3 (0.8) | 1/2/2/3/3/5/1 |
| duck (starter) | 2/3/4/6/2/8/1 | 3/4/3/6/4/9/3 (4) | 2/3/3/5/2/7/1 (0.45) | 2/3/3/5/2/8/2 (0.45) | 2/2/4/6/1/6/1 |
| turtle (starter) | 1/1/3/9/0/6/3 | 2/1/2/10/0/7/9 (0) | 1/2/4/8/0/6/4 (0.4) | 1/2/4/8/0/6/4 (0.4) | 1/1/2/8/0/4/2 |
| rabbit | 4/6/6/4/5/1/1 | 4/7/6/4/6/1/2 (0) | 4/6/7/5/5/1/1 (0.5) | 6/9/4/3/9/1/2 (0.85) | 2/3/3/5/2/1/1 |
| elephant | 2/1/2/8/0/4/6 | 3/2/2/9/0/5/10 (0) | 5/2/3/9/1/3/6 (1.1) | 5/2/3/9/1/3/6 (1.1) | 1/1/4/6/0/2/1 |
| eagle | 5/4/6/5/4/1/1 | 5/4/5/5/6/1/3 (10) | 3/3/6/4/4/1/1 (0.5) | 3/3/6/4/4/1/1 (0.5) | 4/3/8/6/3/1/1 |
| shark | 5/3/3/5/1/10/4 | 6/4/3/6/1/10/7 (0) | 1/1/2/4/0/10/2 (0.35) | 1/1/2/4/0/10/2 (0.35) | 4/4/6/5/1/10/3 |

Shop prices: rabbit 150, eagle 250, shark 250, elephant 300. Starters are free and owned from
the start.

Each animal also has `name` (display), `blurb` (one sentence for the shop), and a palette
`{main, second, accent}` as hex numbers:

| Animal | main | second | accent |
|---|---|---|---|
| cheetah | 0xe6b04a | 0x3a2a14 (spots) | 0xffffff |
| frog | 0x5ec24a | 0x2f7a2a | 0xf6f3a0 |
| duck | 0xf5f0e6 | 0xf2a71b (bill/feet) | 0x2b2b2b |
| turtle | 0x6b8f4e | 0x4a6b33 (shell) | 0xc9d6a3 |
| rabbit | 0xd9d3cc | 0xf2b8c6 (ear inner) | 0x2b2b2b |
| elephant | 0x9a9ea6 | 0x7c8088 | 0xf4f4f4 (tusks) |
| eagle | 0x5a3b22 | 0xf4f4f4 (head) | 0xf2b31b (beak) |
| shark | 0x6f8fa8 | 0xd9e6ee (belly) | 0x22303a |

Define the catalog as one object `ANIMALS` keyed by animal key, each with
`{name, blurb, price, palette, parts:{head:{stats..., build:fn}, body:{...}, front:{...}, back:{...}, tail:{...}}}`.
`ANIMAL_KEYS = Object.keys(ANIMALS)`.

### 5.3 Derived racer stats

`computeStats(build)` returns an object. Sum each stat across the five parts (max 50) and
normalise to 0..1: `spdN = sum(spd)/50`, etc. `massN = sum(mass)/50`.

Leg mismatch: `mismatch = Math.abs(front.len - back.len) / 0.75` clamped to 0..1
(0.75 is the largest difference in the table, elephant 1.1 vs shark 0.35).

```
stabilityN = clamp(stabN - mismatch*0.45, 0, 1)
wobble     = clamp(0.55 - stabilityN, 0, 0.55)         // 0 = rock solid
topSpeed   = 17 + 15*spdN - 5*massN                    // world units / second
accel      = 7 + 12*accN - 3*massN                     // units / second^2
turnRate   = 1.5 + 1.5*gripN - 0.5*massN               // radians / second at full steer
brake      = 14
jumpVel    = 6 + 9*jmpN                                 // vertical launch velocity at a ramp
glide      = body.wings/10 * clamp(1 - massN*1.4, 0, 1) // heavy bodies can't glide
waterMult  = 0.35 + 0.65*swmN                           // multiplies topSpeed in water
mudMult    = 0.45 + 0.30*gripN + 0.25*massN             // multiplies topSpeed in mud
offroadMult= 0.55
```

Also return the six display values for the garage bars, each 0..1:
`speed: spdN, accel: accN, handling: gripN, stability: stabilityN, jump: jmpN, swim: swmN`.

### 5.4 Quirks

`describeQuirks(build, stats)` returns an array of short strings. Include a line when its
condition holds; cap at 4 lines, in this priority order:

1. `mismatch > 0.6` → "Wobbly! The front and back legs are very different lengths."
2. `body.wings >= 4 && glide < 0.2` → "Those wings can't lift a body this heavy."
3. `body.wings >= 4 && glide >= 0.5` → "Glides after jumps."
4. `swmN >= 0.7` → "Loves water. Fast in the splash zone."
5. `swmN <= 0.2` → "Hates water. Very slow in the splash zone."
6. `front.swm >= 9 || back.swm >= 9` (shark fins) → "Fins instead of legs. Terrible on land."
7. `massN >= 0.6` → "Heavy. Slow to start but ploughs through mud."
8. `jmpN >= 0.7` → "Huge jumps at the ramp."
9. `gripN >= 0.7` → "Corners like a dream."
10. `spdN >= 0.75` → "Blazing top speed."

Always at least one line: if none match, "A well balanced racer."

**Check:** in the console, `computeStats` on all-cheetah gives topSpeed about 26; on all-turtle
about 17; on turtle body + shark legs + eagle head, the mismatch is 0 (both legs 0.35) but
`waterMult` is high and `topSpeed` is low.

**COMMIT** when sections 1 to 5 are in place (page shells, catalog, stats, save) with the message
`Racer: page shell, animal catalog, stats and save data`.

---

## 6. Racer builder (3D)

### 6.1 Frame conventions

- A racer faces **+Z** in its local frame. Right is +X, up is +Y.
- `buildRacer(build, opts)` returns `{ group, parts, stats, bodyLen, rideHeight }`:
  - `group`: a `THREE.Group` whose origin is at ground level under the centre of the body.
  - `parts`: `{ body, head, legs:[fl, fr, bl, br], tail, wings:[l, r] or null, shadow }`.
    Each leg entry is the **pivot group** at the hip; rotating it about X swings the leg.
    `head` and `tail` are pivot groups at their attachment points.
  - `rideHeight`: how high the body centre sits (average of the two leg lengths + body half height).
- Every part builder is a function `(palette) => { group, ... }` that builds primitives into a
  fresh group. Body builders return `{ group, len, height, width, attach: { head:Vector3, fl, fr, bl, br, tail } }`.
  Leg builders return `{ group, len }` with the hip at the group origin and the leg hanging down
  along -Y. Head builders return `{ group }` with the neck base at the origin, face towards +Z.
  Tail builders return `{ group }` with the base at origin, extending towards -Z.

Because every animal's parts live in the same frame, mixing is only a matter of adding a leg
group at the body's `attach.fl` etc.

### 6.2 Assembly

```
body = ANIMALS[build.body].parts.body.build(paletteOf(build.body))
frontLen = ANIMALS[build.front].parts.front.len, backLen = ... back.len
rideHeight = (frontLen + backLen)/2 + body.height/2
bodyGroup.position.y = rideHeight
bodyGroup.rotation.x = -Math.atan2(frontLen - backLen, body.len)   // body tilts if legs mismatch, feet stay on the ground
```

Add legs to the body group at `attach.fl/fr/bl/br` (each built by the appropriate leg builder,
front legs for fl/fr, back legs for bl/br; mirror the right-side leg with `scale.x = -1`).
Add head at `attach.head`, tail at `attach.tail`. Add a blob shadow: `CircleGeometry(0.9, 20)`
rotated flat, `MeshBasicMaterial({color:0x000000, transparent:true, opacity:0.28})`, at
`y = 0.02`, scaled to body length/2 in Z. Put it in `group` directly (not the body group) so it
stays on the ground when the racer jumps.

Use one `MeshStandardMaterial({flatShading:true, roughness:0.85})` per colour per racer (cache in
a small map inside `buildRacer`). Set `castShadow`/`receiveShadow` to nothing (no shadow maps).

### 6.3 Part shapes

Keep each part under about 15 primitives. Size guide: body length 1.4 to 2.2, body width 0.6 to
1.1. Do not agonise over realism; silhouettes and palette make animals readable. Requirements
per animal so the parts are distinguishable:

- **cheetah**: sleek long box body (1.9 x 0.55 x 0.6) with 8 to 12 small dark spheres as spots;
  small round head with tiny ears and a dark tear line (thin box); thin cylinder legs with sphere
  feet; long thin cylinder tail with a dark tip.
- **frog**: squat wide body (1.3 x 0.6 x 1.0), sphere head wide with two big eye spheres on top
  (white with black pupils); folded back legs (two cylinders at an angle making a Z); little
  front legs; tail is a tiny nub.
- **duck**: oval body (1.4 x 0.7 x 0.8), small wings as flat boxes on the sides (these are the
  `wings` meshes, pivot at the shoulder); round head with a flat orange bill (box); orange stick
  legs with flat box feet; tail is a short upturned wedge.
- **turtle**: flat body with a dome shell (scaled sphere, second colour) and a few hexagon-ish
  boxes on top; small head on a neck cylinder; stubby wide legs; tiny tail cone.
- **rabbit**: oval body; head with two tall ears (boxes with pink inner box); long back legs
  with big feet; short front legs; puffball sphere tail.
- **elephant**: huge box body (2.2 x 1.3 x 1.2); head with big flat ears (thin boxes) and a
  trunk made of 3 cylinders curving down, white cone tusks; thick column legs; thin rope tail
  with a tuft.
- **eagle**: brown streamlined body with two big wings (flat boxes 1.4 long, pivot at shoulder)
  — the `wings` meshes; white head with yellow cone beak; short legs with talon cones; fan tail
  (flat wedge, white tips).
- **shark**: grey torpedo body (scaled sphere 2.0 long) with a dorsal fin (flat triangle from a
  `ConeGeometry` with 3 radial segments or a thin box) and white belly (second flattened sphere);
  head is a pointed snout with black eyes and a white grin; "legs" are pectoral fins (thin
  angled boxes, `len` 0.35, so a shark-legged animal sits low); tail is a big vertical crescent
  fin (two thin boxes in a V).

Legs are always a pivot group at the hip. Inside, the leg mesh's centre is at `y = -len/2` so
rotating the pivot swings the whole leg. A foot mesh sits at `y = -len`.

### 6.4 Garage preview

`showPreview(build)` disposes the previous preview (traverse, dispose geometries and
materials), builds a new racer, adds it to `garageScene` on a pedestal disc, and the render loop
slowly rotates it (`rotation.y += dt*0.6`) and runs the idle animation (slow breathing bob and
tail wag; see section 10). The garage camera looks at the racer from front-right, slightly above,
distance scaled by `bodyLen`. On narrow screens the preview is framed in the top 45% of the
canvas: set the camera so the racer appears above the card (offset `camera.lookAt` target
downward, or shift the racer group's position y).

**Check:** in the garage, cycle every slot through every animal. No part floats, no part sinks
below the pedestal by more than a foot, right-side legs mirror properly, and every combination
renders without console errors.

**COMMIT**: `Racer: procedural animal parts and garage preview`.

---

## 7. Track

### 7.1 Geometry

One track for v1: **Meadow Splash**. Define it as a closed `THREE.CatmullRomCurve3` (`closed=true`,
`curveType='centripetal'`) through these control points (x, 0, z):

```
(0,0,0) (40,0,-10) (80,0,-40) (95,0,-90) (70,0,-130) (20,0,-140) (-20,0,-120)
(-50,0,-140) (-90,0,-120) (-110,0,-70) (-90,0,-20) (-50,0,10) (-25,0,15)
```

The player starts at t=0 heading along the curve's tangent. Sample the curve into `N = 800`
points once: `TRACK.pts[i] = curve.getPointAt(i/N)`, `TRACK.tan[i] = curve.getTangentAt(i/N)`
normalised, and `TRACK.len = curve.getLength()`. Track half width `HALF_W = 6`.

Build the road as a ribbon `BufferGeometry`: for each sample i, left = `pt + normal*HALF_W`,
right = `pt - normal*HALF_W` where `normal = (tan.z, 0, -tan.x)`. Two triangles per segment,
wrap at the end. Colour it a warm dirt colour `0xc9a46a`, `MeshLambertMaterial`. Add a second
ribbon 0.4 wider and 0.01 lower in white `0xf4f4f4` as a kerb. Lay it at `y = 0.01`
(ground plane at `y = 0`). Also build a `TRACK.grid`: for fast nearest-point lookup, store the
sample index in a 2D hash map keyed by `Math.floor(x/8)+','+Math.floor(z/8)` (each cell holds a
list of sample indices). A racer's nearest sample is then found by checking its cell and the 8
neighbours. Fall back to a linear scan if the cell set is empty (racer far off track).

Ground: `PlaneGeometry(600, 600)` at y=0, colour `0x6fcf5a`. Sky: `scene.background = new
THREE.Color(0x8fd3ff)`, `scene.fog = new THREE.Fog(0x8fd3ff, 120, 260)`.

### 7.2 Zones

Zones are ranges of the curve parameter t (0..1), each with a type. Store as
`TRACK.zones = [{type:'mud', t0:0.18, t1:0.26}, {type:'water', t0:0.42, t1:0.52}, {type:'ramp', t:0.70}]`.

- **mud**: recolour the road ribbon's vertices in that range to `0x6b4a2a` (use a vertex colour
  attribute on the ribbon with `vertexColors:true`, or build zone patches as separate ribbons on
  top at `y=0.02`; separate patches are simpler). Add a few brown sphere "mud blobs".
- **water**: a blue `0x3aa0e0` patch at `y=0.03` with `transparent:true, opacity:0.75`, wider than the
  road (HALF_W+3). Animate its material colour or y very slightly for a ripple.
- **ramp**: at sample index `Math.round(0.70*N)`, place a wedge (a `BoxGeometry(HALF_W*2, 1.2, 6)`
  rotated about the track normal so it slopes up along the track direction, top edge towards the
  direction of travel) coloured `0xf2a71b` with white stripes. The racer is launched when it
  passes `t in [0.70, 0.705]` while on the ground. After the ramp put a gap in the road (skip
  the ribbon between t 0.705 and 0.725, and place a water patch there) so short jumps land in
  water and long jumps clear it.

Zone lookup: `zoneAt(t)` returns the zone type or `null`.

### 7.3 Decorations, checkpoints, coins

- Trees: 140 trees using two `InstancedMesh`es (trunk cylinder, canopy cone). Random positions
  at least `HALF_W + 4` from the nearest track sample and within 160 units of the origin.
  Random scale 0.8 to 1.6. Rocks: 40 grey icosahedrons (`IcosahedronGeometry(1,0)`) same rule.
- Start gate: two poles and a banner box across the track at t=0 with a chequered canvas
  texture (paint 8x2 squares on a 64x16 canvas, `CanvasTexture`, `magFilter = THREE.NearestFilter`).
- Checkpoints: `CHECKPOINTS = 8` evenly spaced t values `k/8`. Invisible; used for lap logic.
- Coins: 24 spinning yellow `TorusGeometry(0.35, 0.12, 8, 16)` pickups at t values spread around
  the track (avoid the ramp gap), each with a random lateral offset in `[-HALF_W+1, HALF_W-1]`,
  at `y = 1.0`. Pickup radius 1.4 from the racer's position. Picked coins hide
  (`visible=false`) and all reappear at race start. Each coin gives +5 coins and +25 boost.

**Check:** with a free camera or by placing the player racer at several t values, the road is
continuous, the ramp points along the direction of travel, the water and mud patches sit on the
road, and coins are above the road surface. No z-fighting between ground, road and patches.

**COMMIT**: `Racer: Meadow Splash track with mud, water, ramp and coins`.

---

## 8. Racer simulation

Each racer is an object:

```js
{ isPlayer, build, stats, view /* result of buildRacer */, 
  pos: THREE.Vector3, heading /* radians, 0 = +Z */, speed, vy, airborne,
  steer /* -1..1 */, gas /* 0..1 */, boosting, boost /* 0..100 */,
  nearestIdx, t, lap, nextCheckpoint, progress, finished, finishTime,
  gaitPhase, lean, wobblePhase, laneOffset /* NPC only */, ai: {...} }
```

`updateRacer(r, dt)` in this order:

1. **Nearest track sample** using the grid. Set `r.t = idx/N`. Track distance from centre
   `d = |(pos - pts[idx]) · normal|`. Sidedness sign is needed for the boundary push.
2. **Surface**: `zone = zoneAt(r.t)`. `mult = 1`. If `d > HALF_W`, `mult = offroadMult`. Else if
   zone === 'water' `mult = waterMult`; if 'mud' `mult = mudMult`. If `r.boosting && r.boost>0`
   `mult *= 1.35` and drain `r.boost -= 40*dt`; else refill `r.boost = min(100, r.boost + 8*dt)`.
3. **Speed**: `target = topSpeed*mult`. If gas: `speed += accel*(boosting?1.5:1)*dt`, capped at
   target (if above target, decay toward it at `brake*0.5`). If braking: `speed -= brake*dt` to a
   minimum of `-topSpeed*0.25`. If neither: `speed -= 4*dt` toward 0. In water, when a racer's
   swim is low it should still crawl, so never let mult drop below 0.3.
4. **Steer**: `heading += steer * turnRate * dt * speedFactor` where
   `speedFactor = clamp(|speed|/8, 0, 1)` (can't turn while stopped). Add wobble: 
   `r.wobblePhase += dt*(3+speed*0.15)`; `heading += Math.sin(r.wobblePhase*1.7)*wobble*0.9*dt*speedFactor`.
5. **Airborne**: if `r.airborne`: `vy -= 22*dt*(1 - glide*0.7)`; `pos.y += vy*dt`; if `pos.y <= 0`
   land: `pos.y = 0; airborne=false; speed *= 0.9`, play landing sound. Ramp trigger: if
   `!airborne && zone==='ramp' && r.t` just crossed 0.70 (compare previous t): `airborne=true;
   vy = jumpVel * clamp(speed/topSpeed, 0.4, 1)`. While airborne the speed is not changed by
   surface (skip step 3's mult) and steering is halved.
6. **Move**: `pos.x += Math.sin(heading)*speed*dt; pos.z += Math.cos(heading)*speed*dt`.
   (With heading 0 = +Z, this matches a racer whose model faces +Z rotated by `rotation.y = heading`.)
7. **Boundary**: if `d > HALF_W + 3` push the racer back toward the centre line at 6 units/s and
   slow it to at most `topSpeed*0.4`. This keeps everyone near the road without walls.
8. **Progress**: `progress = lap + r.t`. When `r.t` passes checkpoint `nextCheckpoint/8`
   (within 0.02 in the forward direction), advance `nextCheckpoint`. When `nextCheckpoint===8`
   and `r.t` wraps past 0 (previous t > 0.9, new t < 0.1): `lap++`, `nextCheckpoint = 1`,
   `lapTime` recorded. When `lap === state.laps`: `finished = true; finishTime = state.raceTime`,
   push to `state.finishedOrder`. Racers that have finished keep driving as AI (player included)
   so the scene stays lively.
9. **Coins**: player only, check the 24 coins within radius 1.4.
10. **Collisions** (after all racers updated): for each pair within `1.6` units, push apart along
    the line between them, split by inverse mass (`massN`), and average the speed slightly
    (`speed = lerp(speed, other.speed, 0.15)`). Simple and stable.
11. **Apply to view**: `view.group.position.copy(pos)`, `view.group.rotation.y = heading`.
    Lean: `view.parts.body.rotation.z = lerp(current, -steer*0.18*speedFactor + Math.sin(wobblePhase)*wobble*0.35, 0.15)`.
    Blob shadow: scale by `1/(1+pos.y*0.15)` and opacity by the same so it fades when airborne.

Race start: place racer k at `pts[N-2-k*3]` (just behind the line, staggered) with lateral offset
alternating `±2.5` or `0`, heading = atan2(tan.x, tan.z). During countdown, `gas` is ignored.

Ranking each frame: sort racers by `finished ? -(1000 - finishOrderIndex) : -progress` descending,
i.e. finished racers first in finish order, then by progress. Player's place is their index + 1.

**Check:** drive a lap with all-cheetah. Full lap should take roughly 20 to 40 seconds. Drive
into water with all-shark and it should be faster than on land relative to others. The ramp
launches you; frog legs clear the gap and turtle legs splash into the water patch.

---

## 9. NPC AI

Five NPCs per race. Builds: seeded RNG from `Date.now()`; each slot picks a random animal from
`ANIMAL_KEYS` (NPCs may use animals the player has not unlocked; that is a feature, it shows
what is in the shop). Names: pick from a list of 12 fun names ("Sir Wobbles", "Gus", "Pickle",
"Mango", "Captain Fluff", "Zoom", "Beans", "Waffle", "Nibbles", "Rocket", "Doodle", "Mr Splash")
without repeats. Show the NPC names above their racers as small `CanvasTexture` sprites
(`THREE.Sprite`, one 128x32 canvas each, white text with a dark outline) at `y = rideHeight + 1.2`.

Per-frame AI:

```
lookahead = 6 + speed*0.45 (in samples: Math.round(lookahead / (TRACK.len/N)))
targetIdx = (nearestIdx + lookaheadSamples) % N
target = pts[targetIdx] + normal(targetIdx) * laneOffset
desired = atan2(target.x - pos.x, target.z - pos.z)
diff = angleDiff(heading, desired)
steer = clamp(diff*2.5, -1, 1)
gas = 1
// brake before sharp turns: measure the angle between tan[nearestIdx] and tan[(nearestIdx + 30)%N];
// if it exceeds 0.55 rad and speed > topSpeed*0.7, gas = 0.
// boost: use it when on a straight (that angle < 0.15) and boost > 40.
```

`laneOffset` is chosen per racer in `[-3.5, 3.5]` and drifts slowly:
`laneOffset += (Math.random()-0.5)*dt*2`, clamped.

Rubber banding: each frame `npc.stats.topSpeedEff = npc.stats.topSpeed * clamp(1 + (player.progress - npc.progress)*0.12, 0.85, 1.15)`
and use `topSpeedEff` in step 3 for NPCs. This keeps the pack close without making them unbeatable.
Difficulty also tracks the save: `npcSkill = clamp(0.8 + save.wins*0.04, 0.8, 1.1)` multiplies
NPC `topSpeed` and `accel` at race start.

**Check:** run a race without touching the controls. NPCs complete laps, stay on the road except
for occasional wide corners, and none gets stuck at the ramp or in the boundary push.

**COMMIT**: `Racer: kart physics, laps, coins and NPC racers`.

---

## 10. Animation and camera

### 10.1 Gait

Per racer, `gaitPhase += dt * (|speed| / strideLen) * 2.2` where
`strideLen = (frontLen + backLen)` (longer legs, slower cadence). Leg swing amplitude
`amp = clamp(|speed| / topSpeed, 0, 1) * 0.7`. In `updateAnimation(r, dt)`:

```
legs[0].rotation.x =  Math.sin(phase) * amp          // front left
legs[1].rotation.x = -Math.sin(phase) * amp          // front right
legs[2].rotation.x = -Math.sin(phase) * amp          // back left
legs[3].rotation.x =  Math.sin(phase) * amp          // back right
body bob:   bodyGroup.position.y = rideHeight + Math.abs(Math.sin(phase*2)) * 0.06 * amp
head bob:   head.rotation.x = Math.sin(phase*2)*0.08*amp
tail wag:   tail.rotation.y = Math.sin(phase*1.3 + 1) * 0.35
```

When airborne: legs tuck (`rotation.x` eases to 0.6 on front, -0.6 on back); if `wings` exist,
flap `wings[0].rotation.z = Math.sin(time*9)*0.6` and mirror on the right, scaled by `glide`
(no glide means a frantic useless flap: `Math.sin(time*18)*0.4`, which is funny and honest).
On land, wings rest at their pose.

In water: legs paddle with double frequency and half amplitude; add a little bob.

Low stability (`wobble > 0.25`): add `body.rotation.z += Math.sin(wobblePhase*2.3)*wobble*0.4` and
occasionally (every 3 to 6 seconds, random) a stumble: for 0.5s the racer's `speed *= 0.97` per
frame and the body dips (`rotation.x += 0.25` easing back). Play a "boing" sound.

Garage idle: `bodyGroup.position.y = rideHeight + Math.sin(time*2)*0.02`, tail wag, head
looks slowly left and right (`rotation.y = Math.sin(time*0.7)*0.3`).

### 10.2 Chase camera

```
back = 7 + bodyLen*1.2, up = 3.2 + bodyLen*0.4
desired = pos - forward*back + (0, up, 0)          // forward = (sin heading, 0, cos heading)
camera.position.lerp(desired, 1 - Math.pow(0.001, dt))   // smooth, frame-rate independent
lookTarget = pos + forward*4 + (0, 1.2, 0)
camera.lookAt(lookTarget)
```

Add speed FOV: `camera.fov = lerp(camera.fov, 62 + 12*clamp(speed/topSpeed,0,1) + (boosting?6:0), 0.08); camera.updateProjectionMatrix()`.
When airborne, raise `up` by `pos.y*0.5`. During countdown, sweep the camera from a high wide
shot down to the chase position over the three seconds.

**Check:** camera never clips into the ground on the ramp descent and stays behind the racer
through the tight corners.

---

## 11. Audio

Copy Nightfall's `initAudio` structure (master gain, compressor, `noise`, `tone`, `ping` helpers)
and its `wakeAudio` pattern (create the AudioContext on first touch/click/keydown, `resume()` on
`visibilitychange`). Keep it small. Sounds to provide as `sfx.*`:

- `step`: soft short noise thump (`noise(0.05, 500, 1, 0.12)`), triggered when a racer's
  `Math.sin(gaitPhase)` crosses zero and it is the player or within 25 units of the player,
  volume scaled by distance.
- `boost`: rising `tone('sawtooth', 200, 600, 0.35, 0.18, 0, 1200)` on boost start; a looping
  quiet whoosh while boosting is optional.
- `coin`: `ping(1568, 0.08, 0.2)` then `ping(2093, 0.12, 0.2, 0.06)`.
- `splash`: `noise(0.35, 900, 0.8, 0.3, 'bandpass')` on entering water.
- `jump`: `tone('sine', 300, 700, 0.25, 0.2)`; `land`: `noise(0.12, 250, 1, 0.3)`.
- `boing`: `tone('sine', 500, 180, 0.3, 0.25)` on stumble.
- `count`: `ping(880, 0.12, 0.3)`; `go`: `ping(1320, 0.4, 0.4)`.
- `finish`: three ascending pings, plus `noise(1.2, 3000, 0.5, 0.15, 'highpass')` as a crowd hiss.
- `click`: UI `ping(1200, 0.04, 0.12)` on every button.

### Icons (generate with headless Chromium)

Write `/tmp/.../scratchpad/icons.js` (not in the repo):

```js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const out = '/home/user/blog/experiments/dotties-mix-and-match-racer/';
const html = `<canvas id=c width=512 height=512></canvas><script>
const c=document.getElementById('c').getContext('2d');
// sky background with rounded corners is not needed (maskable): fill full square
const g=c.createLinearGradient(0,0,0,512); g.addColorStop(0,'#8fd3ff'); g.addColorStop(1,'#6fcf5a');
c.fillStyle=g; c.fillRect(0,0,512,512);
// road stripe
c.fillStyle='#c9a46a'; c.fillRect(0,330,512,110); c.fillStyle='#f4f4f4';
for(let i=0;i<8;i++) c.fillRect(i*64+(i%2?0:32),380,32,12);
// a chunky patchwork animal: cheetah body, frog head, duck feet
c.fillStyle='#e6b04a'; c.beginPath(); c.ellipse(256,270,150,80,0,0,7); c.fill();
c.fillStyle='#3a2a14'; [[200,250],[250,300],[300,240],[330,290],[220,300]].forEach(([x,y])=>{c.beginPath();c.arc(x,y,12,0,7);c.fill();});
c.fillStyle='#5ec24a'; c.beginPath(); c.arc(390,190,70,0,7); c.fill();
c.fillStyle='#fff'; [[365,150],[420,150]].forEach(([x,y])=>{c.beginPath();c.arc(x,y,22,0,7);c.fill();});
c.fillStyle='#000'; [[368,152],[423,152]].forEach(([x,y])=>{c.beginPath();c.arc(x,y,10,0,7);c.fill();});
c.fillStyle='#f2a71b'; [[170,330],[300,330]].forEach(([x,y])=>{c.fillRect(x,y,26,60); c.fillRect(x-14,380,54,18);});
</script>`;
(async () => {
  const browser = await chromium.launch();
  for (const [name, size] of [['icon-512.png',512],['icon-192.png',192],['apple-touch-icon.png',180]]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(html.replace('<canvas id=c', `<canvas style="width:${size}px;height:${size}px;display:block" id=c`));
    await (await page.$('#c')).screenshot({ path: out + name });
    await page.close();
  }
  await browser.close();
})();
```

Run `node icons.js`, then `file experiments/dotties-mix-and-match-racer/*.png` must report
512x512, 192x192 and 180x180 PNGs. (Playwright 1.56 and its Chromium are already installed at
those paths; `chromium.launch()` works without options.)

**COMMIT**: `Racer: gait animation, chase camera, sounds and icons`.

---

## 12. Input

Keyboard (`keydown`/`keyup` on `document`, track a `keys` set by `e.code`):
`ArrowUp`/`KeyW` gas, `ArrowDown`/`KeyS` brake, `ArrowLeft`/`KeyA` and `ArrowRight`/`KeyD` steer,
`Space`/`ShiftLeft` boost. `Enter` activates the primary button of the current screen. Call
`e.preventDefault()` for arrows and space while racing so the page does not scroll.

Touch: use Pointer Events on the four `.tbtn` elements: `pointerdown` sets the flag and
`setPointerCapture`; `pointerup`, `pointercancel`, `pointerleave` clear it. Steering from
touch is `(right?1:0) - (left?1:0)`. Also support tilting? No. Keep it to buttons.

Each frame, the player racer gets `steer` (smoothed: `steer = lerp(steer, input, 1 - Math.pow(0.002, dt))`),
`gas`, brake, `boosting`.

Show touch buttons only when `('ontouchstart' in window) || navigator.maxTouchPoints > 0`.

---

## 13. UI and state machine

`setMode(mode)` hides every screen and shows the one for `mode`:

- `title`: show `#title`. Play button → `setMode('garage')`.
- `garage`: show `#garage` + canvas preview. Render `garageScene`. `refreshGarage()` fills slot
  labels (with the animal name and a small "not owned" state that cannot happen because the
  slot cyclers only cycle through `save.owned`), stat bars (`width = value*100 + '%'`), quirks,
  coin count. `◀`/`▶` cycle the slot within `save.owned`, save, rebuild preview.
  RANDOM picks random owned animals per slot. SHOP → `setMode('shop')`. RACE! → `setMode('countdown')`.
- `shop`: show `#shop`. `refreshShop()` builds the list. BUY: if `save.coins >= price`, deduct,
  push to `owned`, save, refresh, play coin sound. BACK → garage.
- `countdown`: hide panels, show `#hud` and touch buttons, build race (`startRace()`), 
  `state.countdown = 3.999`; each frame show `Math.ceil(countdown)` in `#countdown`, and when it
  passes 0 show "GO!" for 0.8s then hide; `setMode('racing')`. Countdown pings on each integer change.
- `racing`: update racers, HUD each frame (`#pos` = `ordinal(place)`, `#lap`, `#timer`,
  boost fill). When the player finishes: `setMode('finished')`.
- `finished`: keep simulating and rendering for 1.5s (player continues under AI), then show
  `#results`. Coins: 1st 100, 2nd 60, 3rd 40, 4th+ 20, plus coins picked up during the race
  (already added when picked). `save.races++`, `save.wins++` if 1st, best time and best lap
  updated. Save. RACE AGAIN → `setMode('countdown')`. GARAGE → `setMode('garage')`.

`startRace()`: remove old racer groups from `raceScene` and dispose them; reset coins visible;
build player from `save.build` and five NPCs; place them; reset `state.raceTime`, `finishedOrder`.
Request fullscreen on the first RACE! click like Nightfall does (in `try/catch`).

Handle `resize` (renderer size, camera aspect for both cameras). Handle `visibilitychange`:
when hidden, pause the clock so `dt` doesn't explode (clamp `dt` to 0.05 every frame anyway).

---

## 14. Main loop

```js
var clock = new THREE.Clock();
function animate(){
  requestAnimationFrame(animate);
  var dt = Math.min(clock.getDelta(), 0.05);
  time += dt;
  if (state.mode==='garage' || state.mode==='shop') { updateGarage(dt); renderer.render(garageScene, garageCam); return; }
  if (state.mode==='countdown' || state.mode==='racing' || state.mode==='finished') {
    updateRace(dt); updateCamera(dt); updateHud(); renderer.render(raceScene, camera);
  }
}
```

`updateRace` handles countdown timing, player input → racer, AI for NPCs, `updateRacer` for
each, collisions, animation for each, coins spin (`rotation.y += dt*3`), water ripple, finish
detection.

---

## 15. Verification (do all of these before the final commit)

1. **Static checks.** `node --check` cannot parse HTML, so extract the script:
   ```
   mkdir -p /tmp/claude-0/-home-user-blog/96889bf0-5ad7-5c4d-a3e2-61b3b9826500/scratchpad/site/experiments/dotties-mix-and-match-racer
   S=/tmp/claude-0/-home-user-blog/96889bf0-5ad7-5c4d-a3e2-61b3b9826500/scratchpad/site
   sed '1,/^{% raw %}$/d; /^{% endraw %}$/d' _experiments/dotties-mix-and-match-racer.html > $S/experiments/dotties-mix-and-match-racer/index.html
   cp experiments/dotties-mix-and-match-racer/* $S/experiments/dotties-mix-and-match-racer/
   ```
   This mimics what Jekyll publishes. Serve it: `cd $S && python3 -m http.server 8123 &`.
2. **Headless smoke test** with Playwright (script in the scratchpad, not the repo). Load
   `http://localhost:8123/experiments/dotties-mix-and-match-racer/`, collect `console` errors and
   `pageerror` events, then:
   - click `#playBtn`, wait 500ms, screenshot `garage.png`;
   - click every `▶` button once, click `#randomBtn` five times; assert no errors;
   - click `#raceBtn`, wait 4500ms (countdown), then hold `ArrowUp` via `page.keyboard.down('ArrowUp')`
     for 8 seconds, screenshot `race.png`, release; assert no errors and that `#timer` text
     changed;
   - evaluate `localStorage.getItem('dotties-racer-save-v1')` and assert it parses.
   Look at the screenshots yourself (use the Read tool on the PNGs). The garage must show a
   visible animal on a pedestal with the card not covering it. The race screenshot must show the
   road, a racer from behind, and the HUD.
   Test at two viewports: 1280x720 and 390x844 (portrait phone).
3. **Jekyll build: skip it.** `bundle install` fails in this environment because `Gemfile.lock`
   pins bundler 1.13.1, which does not run on the installed Ruby 3.3 (`undefined method 'untaint'`).
   Do **not** edit `Gemfile`, `Gemfile.lock`, or install a different bundler to work around it.
   Step 1 above reproduces what Jekyll publishes closely enough. Instead, confirm by eye that the
   front matter is the first thing in the file, `{% raw %}` is on the line right after the closing
   `---`, and `{% endraw %}` is the last line. GitHub Pages builds the site on push.
4. **Performance sanity.** In the Playwright race run, evaluate a frame counter over 3 seconds
   (add a temporary `window.__frames` increment in `animate` while testing, or measure via
   `requestAnimationFrame` in `page.evaluate`). Headless is slow, so only fail if under 15 fps;
   if so, reduce tree count and coin segments.
5. **Tune.** Race three times with different builds. All-cheetah should usually win with clean
   driving; all-turtle should usually lose; shark parts should be clearly fastest in the water
   patch and clearly worst on land. Adjust the constants in section 5.3 only (not the table)
   if these do not hold, and note the change in the commit message.

Remove any temporary debugging (`window.__frames`, console logs) before the final commit.

**COMMIT**: `Add Dottie’s Mix and Match Racer to experiments` then push:
`git push -u origin claude/animal-hybrid-racing-game-61o1b9` (retry with backoff on network errors).

Also update `README.md`: nothing needed, the existing "Adding a game or experiment" section
already covers this layout. Do not edit `_pages/experiments.html`; the list is automatic.

---

## 16. Stretch goals (only after everything above is committed and verified)

In this order:

1. **Second track "Canyon Dash"**: a longer loop with two ramps and no water, so jump and speed
   matter more. Add a track picker in the garage (`#trackBtn` cycling names). Save best times per track.
2. **More animals**: giraffe (very long legs, 1.4, big mismatch potential), penguin (great swim,
   slides on belly in water), kangaroo (huge back legs), snail (ridiculously slow, stability 10,
   cheap gag item at 50 coins). Each is a table row plus a part builder set.
3. **Mini map**: a 2D canvas in the HUD corner drawing the track polyline and dots for racers.
4. **Ghost best lap**: record the player's position each 0.1s on their best lap and replay a
   translucent copy.
5. **Photo mode** in the garage: a button that renders the preview at 2x pixel ratio to a PNG
   the user can long-press to save (no download link, just show the image in an overlay).
