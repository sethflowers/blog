# The Undercroft

A first-person dungeon game, as photorealistic as we can make it in a browser. It was designed on paper
by a young game designer (three pages: the monster, the power gates, and the rules), and started as a
walk-through demo (1.x). It plays on an Xbox (Edge, with the controller), an iPad (touch, or a paired
Xbox, PlayStation or Switch controller), and a computer (keyboard and mouse).

## The designer's rules (from the drawings)

- You're in a dungeon and **monsters are chasing you**.
- **People are stuck in the dungeon's cells. You have to free them.**
- **If you get in water you die.**
- **You have five hearts.**
- There are gateways in the dungeon (drawn as a stone slab with a wavy top and arches inside, one inside
  another). **You go in them and each one gives you a super power. There are only four:**
  1. grab stuff with a **big magnet**
  2. a **remote bomb wand**: you hit a button that makes it explode
  3. **freeze water** and walk on it
  4. **can't be hurt for one minute** (read from "you canet it fore one minit")
- **The monster**: a horse-like body on four legs, a long neck and a bird's head, two tall wings, a dark
  tail. Powers: its **head shoots lasers and barfs zombies**, **spikes on its wings** can kill people,
  it's **really tall**, and its **feet are like springs** that boost it faster.

Added by request: you start with a **sword**, find **other weapons** and keep everything in a
**Zelda-style bag**, **hearts** go down when you're hurt, and **food** brings them back.

## How it plays

- **A level** is a maze of 9 by 9 rooms (bigger on later levels). In the middle is the **great hall**:
  3 by 3 rooms under one 8 m vault with four pillars and fire braziers. This is the monster's hall.
  It's too tall for the corridors, so it never leaves.
- **Prisoners**: three cells, each with iron bars. One is in the far reaches of the maze, one is past the
  water, and one opens off the monster's hall. Hold A at the bars to break the lock. The prisoner cheers,
  leaves, and waits for you on the stairs. When everyone is free, the portcullis at the foot of the stairs
  rises. Walk up and out to finish the level. Each later level has one more prisoner, up to five.
- **Water**: one branch of the maze is cut off by deep water (death if you step in). Freeze it (the gate
  for it is always reachable without crossing water) and cross before it thaws after 45 s. It cracks
  as a warning 6 s before. A flooded dead-end room has a roast chicken leg on a stone in the middle:
  pull it with the magnet, or freeze and walk.
- **Cracked wall**: a small branch is walled up behind a crumbling wall. Bomb it to get the war hammer.
- **Power gates** (four, in quiet rooms): walk through for the power. LT / right-click / Q uses it,
  LB / R swaps between powers.
  - Magnet: hold to pull food and items to you, and drag zombies onto your blade.
  - Bomb wand: the first press throws a bomb, the second blows it up. It kills zombies, hurts the
    monster, breaks the cracked wall, and hurts you if you're too close.
  - Freeze: freezes all water within 11 m for 45 s.
  - Shield: nothing can hurt you for 60 s, then it recharges for 30 s.
- **Weapons** (RT / click; RB, 1–4 or the mouse wheel to switch):
  - sword: quick, wide
  - spear: long reach, narrow
  - war hammer: slow, crushing, knocks back
  - crossbow: bolts, which you find in chests
- **Hearts**: 5 hearts, counted in halves. A zombie hit takes half a heart. The monster's lasers, leap
  and wing spikes take a whole heart. Water kills. After a hit you can't be hurt again for a moment.
- **Food** (X / F eats whatever fits best, or pick one in the bag):
  - apple: 1 heart
  - bread: 1½ hearts
  - cheese: 2 hearts
  - roast chicken leg: 3 hearts
- **Zombies**:
  - A few wait in the maze. They notice you if you're close, in sight, or hurrying nearby.
  - They follow a walking-distance map to you (so they come round corners) and never step into deep water.
  - Three sword hits kill one.
- **The monster** (40 hit points, a health bar while it's after you):
  - stalks you around the hall
  - charges its eyes for a second, then fires twin lasers at where you were (pillars block them)
  - barfs up two zombies that climb out of the puddle
  - crouches on its spring feet and leaps at you, with a shockwave where it lands
  - its wing spikes hurt to touch
  - when beaten, it drops a feast
- **The bag** (Y / Tab / BAG): weapons, powers and food as rows of slots. Move with the stick, d-pad or
  arrows; A or a click uses the slot.
- **Dying** shows what killed you; TRY AGAIN restarts the level with what you carried into it.

## How it's built

- `_experiments/undercroft.html`: the page, HUD, menus and styles. The code is in ES modules in
  `experiments/undercroft/js/`:
  - `level.js`: maze generation and layout, as pure data
  - `world.js`: geometry and set dressing
  - `game.js`: everything else
  - `audio.js`: all sound, synthesised
  - `env.js`: a small generated environment map for shiny things
  - `models/`: the monster (`beast.js`), zombies and prisoners (`people.js`), and weapons, food, chests,
    gates, bars, portcullis, braziers, bombs, cracked walls and bones (`props.js`). If one fails to load,
    `stubs.js` stands in so the game still runs.
- Three.js r180 from `experiments/undercroft/lib/` through an import map. Generated textures are in
  `tex/` (see `_tools/undercroft/make_textures.py`). The water normal map comes from the three.js
  examples (MIT).
- Light: a cold fill everywhere, the torch in your left hand (shadowed), and a pool of three lights.
  Those three are handed each frame to the nearest wall torches, braziers and power gates you can see,
  and the nearest one casts shadows. There's also one light for explosions and lasers, and the moonlight
  at the way out. The light count never changes, so shaders never recompile mid-game.

## Testing without a person

- `_tools/undercroft/test.mjs` plays the game in headless Chromium with a fake standard controller.
  - **Controls**: it checks the controls and the bag.
  - **Fighting**: a zombie hurts you and the sword kills it, eating heals, and deep water kills you.
  - **A full level**: a bot plays it with the sticks and buttons, with damage off so it can't lose. It
    walks through every gate, freezes and crosses the water, frees every prisoner, bombs the cracked wall,
    opens every chest, and leaves by the stairs.
  - **Screenshots**: it saves screenshots of each step to look at.
- `_tools/undercroft/preview.html` and `shoot.mjs` render a single model module lit like the game, for
  working on models.

## Next

- More levels' worth of variety: different monsters, locked doors and keys, traps.
- Photoscanned textures once Poly Haven / ambientCG are allowed in the environment's network settings.
- If it gets too heavy for Edge on Xbox, package it as an app through Xbox Developer Mode.
