# Plan: Nightfall 2 — builders, a bow, snowballs, and towers that fall

An update to Henry's Nightfall 2 (`_experiments/henrys-nightfall-2.html`). Everything stays in the
one game file; the service worker's cache name moves to `nightfall-two-v2` so phones pick it up.

## What the player gets

1. **FAT ZOMBIES** — a new cheat. Every zombie (bosses too) swaps onto a very round body: a big
   gut its shirt has ridden up over, love handles, a big seat, thick arms and legs. They wobble
   as they walk. Turning it off puts them back.
2. **Three new weapons**, sold by the trader from the start and on keys 8, 9 and 0:

   | Weapon | Price | What it does |
   |---|---|---|
   | Bow | 50 | Silent. A real arrow flies, drops a little with distance and sticks in whatever it hits — zombies included, where it rides along with the body. 150 a hit, 480 to the head. |
   | Grenades | 110 | Thrown, not fired. They bounce off the ground and walls, roll, and go off after about two seconds (radius 5 m). |
   | Snowballer | 80 | A blue snowball launcher with a hopper of snowballs on top. Little damage, but the cold slows a zombie down, then freezes it solid in a block of ice for a few seconds. Frozen zombies take extra damage, and the ice shatters when it breaks. |

3. **Towers fall.** When a tower's boss dies the roof starts to shake ("THE TOWER IS COMING
   DOWN"); a few seconds later you are taken down to a spot in front of the door with a clear
   view, and the tower shudders, leans and topples sideways, shedding stone, and lands in a wall
   of dust (crushing any zombie underneath). What is left is a broken stump with a soft glow and
   a long spill of blocks where it fell. Fallen towers stay fallen when you load your save, and
   cannot be climbed again. Coins left on the roof are collected for you.
4. **Zombies building the towers.** Every tower you have not taken is still going up: wooden
   scaffolding up one side, work lamps, a pile of stone, and a hoist on the roof. When you get
   within about 135 m, a crew turns up — zombies in yellow hard hats and hi-vis vests. Two haul
   stones from the pile to the foot of the hoist, three hammer on the wall from the scaffold
   decks (dust, sparks and a chink you can hear), and one on the roof hauls on the rope while a
   block goes up. Each block is swung over and set into one of the missing battlements. Builders
   ignore you until you get close, shoot near them or hit them; then they drop everything and come
   for you, jumping down off the scaffold. A builder knocked off the roof does not survive the fall.
5. **Giants on the ground.** Out on the island, now and then a roaming zombie is two and a half
   times the size: slow, hits hard, shakes the ground as it walks, roars when it sees you, and
   drops a fountain of coins. At most two at a time (three with HORDE).
6. **Real clothes.** The dead now wear actual fabrics instead of one tinted cloth: blue and black
   denim (twill weave, faded where it rubs), chinos, work trousers, grey marl sweatpants, red, green
   and blue flannel plaid, knit tees, fleece hoodies and a chambray work shirt. Each has stains,
   dried blood and frayed rips painted in. The bodies themselves got clothing details: shirts and
   trousers stand a little off the skin so every hem and cuff is a lip, a collar, a belt with a
   buckle (or an untucked shirt), back pockets, side seams, creases at the knees, elbows and crotch,
   and trousers stacked over the shoes. Fewer, bigger rips. Shoes come in black, brown leather,
   tan boots and dirty white. The shader adds the fabric's weave and folds as bumps.

## How it is built

- **Fabrics**: `fabricCanvas(key)` paints each fabric thread by thread into a 512 px tileable
  canvas, and `fabricBump(weave)` paints a matching height map of creases and weave. `zombieMat`
  gained a triplanar bump: the `bumpMap` is sampled from three sides like the colour, and its
  screen-space derivatives tilt the normal (`perturbNormalArb`).
- **Body**: `buildBody` reads per-vertex clothing details (hem, collar, belt, folds, seams) into the
  baked vertex colours and pushes clothing vertices out along the normal. `bodyParts(fat, obese)`
  has an obese layout (with an ellipsoid gut); `fatShapes()` sculpts the two fat bodies the first
  time the cheat is used, and `setFat()` swaps a zombie's geometry.
- **Weapons**: three new viewmodels with their own hands (`buildBow`, `buildFrag`, `buildSnow`).
  `launch()` fires a projectile; `updateProjs()` moves them, checks the segment flown each frame
  against zombies (raycast) and the world (`projBlocked`: ground, colliders, standing towers, the
  room or roof edge). Arrows are re-parented onto the bone they hit.
- **Towers**: `buildSite()` adds the scaffold, lamps, hoist, stone pile and the missing battlement
  blocks to each tower's group; `activateSite()` / `updateWorker()` / `animateSite()` run the crew and
  the hoist. `buildRuin()` builds each tower's stump and rubble (hidden). `startCollapse()` /
  `updateCollapses()` / `towerImpact()` animate the fall as a rod tipping about its foot;
  `setTowerDown()` swaps the standing tower for the ruin, including which meshes shots can hit.
- **Giants**: `makeZombie({giant:true})`, spawned by `spawnRoamer()`.

## Verification

Served locally and driven headless in Chromium with Playwright: the line-up of zombies in the new
clothes, the fat cheat on and off, all three new viewmodels, an arrow, a burst of snowballs (freeze)
and a grenade against a zombie (damage, ice, explosion), a builder crew working for 20 s (hoist
lifting, a battlement placed), a boss killed on the Landing roof through to the fall, the dust and
the ruin, the next region opening, a giant walking up and hitting you, a save with a fallen tower
reloaded, and a tower entered and a floor cleared. No console errors.
