# Plan: Henry's Nightfall 2 — the island

Henry's Nightfall (`_experiments/nightfall-zombie-fps.html`) is a wave shooter in one alley.
Nightfall 2 is a **separate game** (`_experiments/henrys-nightfall-2.html`, published at
`/experiments/henrys-nightfall-2/`) built on the same engine: the sculpted, skinned zombies, the
seven gun viewmodels, the particle system, the synthesised audio, the touch and mouse controls
and the cheats menu all carry over. What changes is everything around them.

## What the player gets

1. **An island to explore** instead of a street: about 450 m across, with beaches, forest,
   a ruined town, snowy highlands and a volcanic crater in the middle, ringed by sea.
2. **Five regions that open one at a time.** A wall of red mist seals every region you have not
   earned yet. Each region is a level.

   | # | Region | Where | Feel | Boss at the top of its tower |
   |---|---|---|---|---|
   | 1 | The Landing | south coast | beach, fishing village, docks | The Brute |
   | 2 | Blackwood | west | dense pine forest, cabins, mist | The Stalker |
   | 3 | Old Town | north | the city from game one, in ruins | The Howler (summons the dead) |
   | 4 | Frostpeak | east | high ground, snow, rocks, dead trees | The Colossus |
   | 5 | The Crater | centre | ash, lava cracks, the Spire | The Ashen King (slams, summons, throws fire) |

3. **A tower in every region.** Walk to its door and enter. Inside, each floor is a round stone
   room: clear it and the gate to the stairs opens. The roof is open to the sky, and the boss is
   waiting there. Beat it and the next region's mist lifts. A beam of light over the current
   tower shows where to go from anywhere on the island.
4. **Coins.** Every zombie drops coins that burst out, spin on the ground and fly to you when you
   get close (about 6 m). Runners drop more, bosses drop a fountain of them.
5. **A trader at a camp in every region.** You start with only the sidearm. The trader sells the
   other six guns, ammo for guns you own, medkits and armour plating (more max health). Stock
   widens as you clear towers, so the arsenal grows with the island.
6. **Progress is saved** (coins, guns, cleared towers, last camp). Dying puts you back at the last
   camp you visited with full health; a tower you died in starts again from its first floor.
   Coins are kept.
7. A **minimap**, a region title card when you cross into a new region, an objective line, and a
   dawn sky after the final boss.

## Technical plan

The new file starts as a copy of game one. Sections are rewritten in place, keeping the banner
comments as anchors.

### World (replaces the street)
- **Heightfield.** One deterministic height function (coastline noise, rolling hills, a raised
  east, a crater, flattened pads for towers, camps, the village and the town) is sampled into a
  257×257 grid. The same grid builds the terrain mesh and answers `groundAt(x,z)`, using the same
  triangle split as `PlaneGeometry` so feet match the surface. Colour is per vertex by region,
  height and slope, multiplied by a tiling detail texture.
- **Sea**: a large dark reflective plane with a drifting normal map. Water deeper than knee height
  blocks the player.
- **Regions** are polar sectors around the centre: south, west, north, east beyond 80 m, and the
  crater inside 80 m. `regionAt(x,z)` is pure maths, so locking is a single check in movement:
  a step into a locked region is undone per axis, which lets you slide along the mist.
- **Mist walls**: additive shader planes along each sector border and a cylinder around the
  crater, shown while either side is locked, dissolving when a region opens.
- **Props** reuse game one's builders where they fit (cars, lamps, crates, barrels, dumpsters,
  barriers, fires, the facade and shop-front atlases for Old Town) plus new ones: houses with
  pitched roofs, a dock and boats, instanced pines, broadleaf and dead trees, instanced rocks,
  tents and the trader's wagon.
- **Colliders** go into a 16 m spatial grid so hundreds of trees and rocks cost little.
- **Lights**: a fixed pool of six point lights is moved to the six nearest light sources every
  few frames (lamps, fires, torches). The light count never changes, so shaders never recompile.
- **Shooting the ground**: the terrain is not raycast as a mesh (130k triangles); instead the ray
  is marched over the heightfield, which is exact enough and costs nothing.
- Everything that assumed the street was flat at y = 0 (zombie feet, corpses, blood pools,
  casings, particles that bounce, grenades, scorch marks, rain) now uses the ground height.

### Towers
- Outside: a tall round stone tower with glowing slit windows, a door, a light beam when it is the
  current objective, and a calm glow once cleared.
- Inside: one interior group placed far from the island (x = 4000). A round room (radius 13 m)
  with pillars, torches and crates laid out from a seed per floor, an entry archway and a barred
  stair gate. The roof is a separate open platform with battlements. `state.mode` is `island` or
  `tower`; each mode has its own shootables, colliders, bounds and ground height, and the other
  world is hidden.
- Floors per tower: 2, 3, 3, 4, 4. Zombies per floor and their toughness rise with the region.
  A short fade covers every transition.

### Bosses
- Game one's Brute, Stalker and Colossus, plus two new ones built from the same body:
  the **Howler** (calls up waves of runners around itself) and the **Ashen King** (the slam, the
  summon and arcing fireballs that explode where they land).
- Boss health is set per tower instead of per wave.

### Coins and the trader
- Coin meshes are pooled (one shared geometry, gold metal material, a glow sprite each).
  They pop out with a little physics, bounce on the ground, then home in on the player inside
  the magnet radius and are collected with a chime. They fade after 90 s.
- The trader screen pauses the game like the cheats menu. Each gun card shows its numbers,
  price and state (owned, buy, not enough coins, or which tower unlocks it).

  | Gun | Price | Sold after |
  |---|---|---|
  | Carbine | 40 | start |
  | Pump | 90 | start |
  | SMG | 150 | The Landing tower |
  | Bolt | 240 | Blackwood tower |
  | Belt-fed | 380 | Old Town tower |
  | Thumper | 520 | Frostpeak tower |

  Ammo refills cost 8–40 by gun; a medkit 15; plating 120, +25 max health, up to 200.

### Roaming zombies
- Up to 9 alive (18 with HORDE), spawned 30–55 m from the player on open, unlocked ground and
  away from camps; despawned past 90 m. They wander until they notice you (28 m, or when shot),
  then chase. Toughness, speed and the share of runners rise with the region they spawn in.

### HUD and controls
- Coin counter, minimap (north up, regions, towers, traders, you), objective line, region title
  card, an interact prompt (E on a keyboard, an ACT button on a phone) for doors, stairs and
  traders, and a fade layer.
- Everything else (weapons 1–7, Q, scroll, R, F, the cheats menu) works as in game one. Guns you
  do not own are skipped.

### Cheats
- Kept, with wave-specific ones replaced: *Clear floor*, *Summon a boss*, *+500 coins*,
  *Open every region*, *Refill*, plus *All guns* now means owning them.

### Files
- `_experiments/henrys-nightfall-2.html` — the game.
- `experiments/henrys-nightfall-2/` — `three.min.js` (same build as game one), a new icon set,
  `manifest.json`, and `sw.js` with its own cache name so it never fights game one's cache.
- Game one is not touched.

### Verification
- Serve the folder locally, drive it headless in Chromium with Playwright: start, walk, shoot,
  pick up coins, open the trader and buy, enter a tower, clear floors with cheats, beat a boss,
  see the next region open, die and respawn, reload and continue from the save. Zero console
  errors, and look at the screenshots.
