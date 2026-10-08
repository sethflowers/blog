# Plan: Nightfall 2 — the builders really build

An update to Henry's Nightfall 2 (`_experiments/henrys-nightfall-2.html`). The zombies in hard hats
used to look busy around the towers; now their work counts. Everything stays in the one game file;
the service worker's cache name moves to `nightfall-two-v3` so phones pick it up.

## What the player gets

1. **Fallen towers go back up.** A few seconds after a tower comes down, a crew turns up at the
   stump: haulers carry stone from the rubble to the foot of a hoist, the hoist lifts each block up
   and swings it onto the wall, and two masons hammer it in from a deck. The wall rises a course
   of stone at a time, with the scaffold, the deck and the hoist climbing with it. It takes about
   2½ minutes for the Landing tower and just under 4 for the Spire. The work carries on while you
   are away. Killing builders slows it down, and killing the whole crew stops it until a fresh crew
   arrives after you leave. When the wall reaches the top, the full tower stands again ("THE
   LANDING TOWER STANDS AGAIN"). Its door is open, its windows burn in its old colour and there is a
   boss on the roof again, a weaker one. Bring it down again and they start over. Regions you
   opened stay open. Rockets and grenades that hit a half-built wall knock a course or two back off.
2. **New towers.** Every couple of minutes a crew starts a brand new, smaller tower in a region you
   have opened, 50–115 m from you so you can watch it go up ("THE DEAD ARE BUILDING A NEW TOWER").
   It goes up in about two minutes. Then it gets a crown, battlements, glowing slit windows and a
   beacon fire on the roof. There are at most four at a time, and only one goes up at a time. They
   show on the map in orange.
3. **Climbing new towers.** A finished new tower ("THE BUILDERS' TOWER") has a door with torches
   facing away from the scaffold. Inside are one floor (two if it is 20 m or taller) of the usual
   rooms, and on the roof a smaller boss: the Brute or the Stalker, at about half strength. Kill it
   and the tower comes down like the big ones, you collect its coins, and the crew starts it again.
   It never counts towards opening regions.
4. **Knocking new towers down.** A finished new tower takes about four rockets or three grenades.
   Then it falls away from you, crushes anything underneath, and leaves a ruin and a fountain of
   coins. The crew comes back and builds it again.
5. Rebuilt towers, the progress on every tower going up and the new towers are all saved.

## How it is built

- `buildRise(t, F, mat)` builds the rising wall for one tower. Each 2 m course is a separate ring
  whose UVs continue from the one below. The course being laid is split into 14 pieces, laid
  outwards from the hoist. Scaffold poles stretch with the wall, ledgers appear a lift at a time,
  and a deck and the hoist head (post, jib, pulley, work lamp) ride up with it.
- `startRaise` / `updateRaises` / `showRise` / `riseHoist` / `finishRaise` run the work. Progress
  `k` goes from 0 to 1 over `riseDur(t)`, scaled by how much of the crew is still alive.
  `activateRise` puts a crew on the nearest site within 135 m. It reuses `updateWorker`: haulers,
  masons (kept on the deck as it climbs) and a new `winch` role at the foot of the rope.
- The main towers: `towerHeld(i)` (never taken, or taken and `rebuilt`) now decides whether a tower
  stands, can be entered, gets its original site crew, and how it shows on the map. `onBossDown`
  remembers a re-fall, so a rebuilt tower falling does not re-announce a region or replay the win.
- New towers: `outpostSpot` / `makeOutpost` / `newOutpost` / `updateOutposts`. The colliders go
  straight into the island grid (`addIslandCollider`). `blastTowers`, called from `explode`, damages
  them. `toppleOutpost` builds a ruin facing away from you and reuses `startCollapse` /
  `updateCollapses`, which now also loop over the new towers. `towerFall` uses `t.fallA` when it
  is set, so a blasted tower falls away from you and a beaten one falls sideways from its door.
  New towers have `name`, `floors`, `boss`, `door`, `hatch`, `roofY` and `roofR` like the big ones,
  so `enterTower` / `climb` / `goRoof` / `onBossDown` / `leaveFallingTower` work on them.
  `towerTier(t)` gives their difficulty inside (their region).
- Saving adds `rebuilt`, `raise` (progress per main tower) and `outposts` to the save.

## Verification

Served locally and driven headless in Chromium with Playwright (`?debug`): the Landing tower
toppled, its rebuild started, a crew working (hoist lifting, haulers, masons on the deck rising),
the tower standing again and enterable, a new tower placed, built and crowned, knocked down with
explosions into a ruin with coins and restarted, and a save/load round trip with towers going up.
No console errors.
