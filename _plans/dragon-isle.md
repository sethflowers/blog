# Implementation plan: Dragon Isle

A third-person dragon action game for `_experiments/`. You are a dragon on a big, hilly island.
You walk, run, swim, fly and breathe fire. Vikings hunt you; killing them drops coins. Coins buy
armour, melee weapons and upgrades at a shop inside your cave. Friendly dragons fight alongside
you, and a radar shows where everyone is.

Same shape as the other experiments: one self-contained HTML file in `_experiments/`, extra files
in `experiments/dragon-isle/`, Three.js r128 served locally, installable as an offline PWA.

---

## 0. Ground rules

- One file: `_experiments/dragon-isle.html`. Jekyll front matter at the top, then everything
  wrapped in `{% raw %}` / `{% endraw %}`.
- Support files in `experiments/dragon-isle/`: `three.min.js` (copied from the zombie game,
  r128 — do not upgrade), `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png`,
  `apple-touch-icon.png`.
- Plain ES5-flavoured JavaScript in one `(function(){"use strict"; ... })();`. No build step,
  no modules, no CDN, no downloaded art. Everything is primitives and canvas textures built at
  runtime.
- r128 gotchas: no `CapsuleGeometry`; `renderer.outputEncoding = THREE.sRGBEncoding` means every
  **untextured** `MeshStandardMaterial` colour needs `.convertSRGBToLinear()` or it washes out.
- Mobile first: touch stick + buttons, safe-area insets, `setPixelRatio(min(dpr, 2))`.
- Never put a model name or model identifier in any file, commit message or comment.

---

## 1. The island

A single analytic height function is the source of truth. The terrain mesh is built from it and
so is every collision, spawn and placement query — no raycasting against the ground.

- `heightAt(x, z)`: value-noise fBm (4 octaves, seeded hash) times a radial island falloff, plus
  a ridge term that raises a mountain spine on the north side. Sea level is `y = 0`; the falloff
  drops the edges below it so the coast is water all the way round.
- Terrain mesh: `PlaneGeometry(WORLD, WORLD, 192, 192)` rotated flat, y per vertex from
  `heightAt`, vertex colours by height and slope — wet sand, beach, grass, rock, snow — with a
  little noise so bands do not read as stripes. `flatShading` off, one draw call.
- Water: a big translucent plane at `y = 0` with a scrolling canvas texture; a second, slower
  layer for the moving-caustics look. Underwater is a blue fog swap when the camera dips below.
- Scatter (all `InstancedMesh`, one draw call each): pine trunks, pine crowns, boulders, and
  grass tufts near sea level. Placement rejects water, cliffs steeper than a threshold, the cave
  mouth and the village footprints.
- `SKY`: gradient canvas texture on a big sphere, a warm directional sun with shadows off (blob
  shadows only), hemisphere fill, distance fog tuned to hide the mesh edge.

**Check:** you can fly a debug camera anywhere and the ground is never flat, never a wall of
z-fighting, and the frame rate holds on a phone.

## 2. The dragon

`buildDragon(scale, colours)` returns a `THREE.Group` plus named pivots, shared by the player and
the friendly dragons: body, neck (3 segments), head with a hinged jaw, horns, four legs with two
joints each, two wings (arm, forearm, three fingers, membrane), a tail of shrinking segments with
spikes. All primitives. Blob shadow is a dark circle mesh laid on the terrain each frame.

Animation is driven by a `gait` value:

- **Walk / run** — opposed leg swing, body bob, wings folded against the back, head bobbing.
- **Fly** — legs tuck, wings sweep through a flap cycle whose speed and amplitude follow climb
  effort; a long glide when you are not climbing.
- **Swim** — body pitches with the surface, legs paddle, wings half-folded, tail sculls, a wake
  ring and splash particles at the waterline.
- Head and neck lean into turns; jaw opens while breathing fire.

## 3. Movement and states

One state machine: `GROUND`, `FLY`, `SWIM`.

- **Ground**: move relative to camera, `run` on Shift/stick-to-the-edge, drains stamina. Steps
  follow the terrain height and the body pitches to the slope. Slopes above a limit push you back.
- **Fly**: tap/hold jump to take off, hold to climb (costs stamina), release to glide — speed
  trades for altitude the way a glider does. Banking turns, a dive that converts height to speed,
  and a landing when you touch ground slowly enough.
- **Swim**: entered when the body drops below sea level. Slower, no fire until you surface,
  stamina refills, and a strong flap gets you airborne again from the surface.
- Camera: close third person, orbit on mouse/right-drag, spring follow, pulled in when the
  terrain would clip it, FOV widening with speed.

**Check:** you can leave the cave on foot, run down the hill, take off, cross the water, dive
under it, swim, and come out flying without ever getting stuck.

## 4. Fire, melee and damage

- **Fire breath** (hold): a cone of billboarded flame particles from the jaw with a point light,
  consuming a fire meter that refills when you are not breathing. Damage is a cone test against
  enemies (angle plus range), it sets them alight for burn damage over time, and it cannot be used
  underwater.
- **Melee** (tap): a bite/claw swipe with a short arc, damage from the equipped weapon, a small
  knockback and a hit spark. Faster than fire, free, and the reason armour and weapons matter.
- **Taking damage**: axes and spears in melee, arrows in flight, thrown spears at range. Armour
  cuts incoming damage. Health regenerates slowly out of combat and quickly inside the cave.
- **Death**: you drop, the screen fades, and you wake at the cave having lost a slice of the coins
  you were carrying. Not a run-ender.

## 5. Vikings

Spawned at three villages plus longships that row in from off the coast as the raid level climbs.

| Type | Behaviour |
|---|---|
| Raider | Axe, chases and swings |
| Archer | Keeps distance, leads shots, is the reason flying is not free |
| Spearman | Throws, then closes |
| Shieldbearer | Slow, tanky, blocks fire from the front |
| Berserker | Fast, hits hard, no shield |
| Chieftain | Rare, horned helm, blows a horn that alerts the island |

State machine per Viking: `IDLE` (patrol a village), `SEARCH` (walk to your last known position,
look around), `HUNT` (close and attack), `FLEE` (low health, runs for the village), `BURNING`.
Detection is range plus facing plus a noise bump when you roar or breathe fire; alerted Vikings
shout and pull in nearby ones. Bodies fade out and drop coins.

Only Vikings within an active radius run their full logic; the rest tick a cheap version.

## 6. Coins and the shop

- Coins are spinning gold discs with a magnet radius, worth more from tougher enemies.
- The cave is a dark arch set into the mountainside with a gold hoard inside and three stands.
  Entering the radius shows a prompt; the shop is an HTML overlay, so no interior geometry.
- Three tabs:
  - **Armour** — Hide, Iron Scale, Steel Plate, Dragonbone. Each cuts damage, adds health and
    visibly plates the dragon.
  - **Weapons** — Fangs, Iron Claws, Steel Talons, Obsidian Talons, Bonecrusher Tail. Each raises
    melee damage and changes the claw and tail-spike look.
  - **Upgrades** — fire capacity, fire damage, flight stamina, swim speed, health regeneration,
    coin magnet.
- Coins, purchases and upgrade levels persist in `localStorage` behind `try` / `catch`.

## 7. Friendly dragons

Four allied dragons, smaller and differently coloured, built from the same `buildDragon`. They
patrol the island, dive on Vikings they spot, breathe their own fire, and rally to you when you
roar. Downed allies respawn at the cave after a delay. They are on the radar in green.

## 8. Radar

Top-right circular minimap: the island silhouette baked once to a canvas from `heightAt`, then a
dot layer redrawn each frame — the player as a heading arrow, Vikings red (brighter when alerted),
allies green, the cave gold, villages amber, longships white. Fixed north, player arrow rotates.

## 9. Audio

WebAudio, synthesised, no files: fire whoosh (filtered noise), roar, wing flap, footfalls,
splash and underwater muffle, coin chime, bite crunch, arrow whiz, axe hit, Viking shouts, war
horn. One master gain and a mute toggle.

## 10. HUD, screens, controls

- HUD: health bar, fire meter, stamina, coin count, raid level, state pill (GROUND/FLY/SWIM),
  radar, damage vignette, and a hint line.
- Screens: title, pause menu, shop, death fade, and a first-run controls card.
- Keyboard/mouse: WASD move, Shift run/boost, Space fly up, Ctrl dive, mouse look, left mouse or
  F for fire, right mouse or E for melee, B shop when near the cave, R roar, M mute, Esc pause.
- Touch: left stick, right-side drag to look, and buttons for fire, melee, up, dive and roar.

## 11. PWA and publishing

- `manifest.json`, `sw.js` (precache page, `three.min.js`, manifest and icons; cache name
  `dragon-isle-v1`), and three icons drawn offline.
- Front matter title **Dragon Isle**, a one-line description, a date not in the future, and
  `layout: null` so the page ships as-is. It lists itself at `/experiments/` automatically.

**Final check:** loads clean with no console errors, plays with keyboard and on a phone, and the
page still works after going offline.
