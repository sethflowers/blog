# The Undercroft

A first-person walk through a dark stone maze, aiming for photorealism. This is the demo for a bigger
game that will add monsters. It plays on an Xbox (in Edge, with the controller), an iPad (touch, or a
paired Xbox, PlayStation or Switch controller), and a computer (keyboard and mouse).

It's built a little differently from the other experiments. It uses a current Three.js (r180, ES modules
through an import map, in `experiments/undercroft/lib/`) instead of r128, because it needs the newer
lighting, shadows and post-processing. It also uses real surface textures in `experiments/undercroft/tex/`.

## What's in it

- **The maze**: 8 by 8 rooms on a grid of 2.6 m tiles, 3.2 m ceilings. It's a recursive-backtracker maze
  with about 30% of the dead ends knocked through, so there are loops. You start in a corner. The way out
  is the room on the edge that's furthest to walk to, and stairs climb out of it to a doorway with
  moonlight beyond. Each game gets a new random seed; `?seed=N` replays one.
- **The look**: the walls, floor and ceiling have colour, normal and roughness maps. The light comes from
  physically based point lights, with tone mapping, bloom, a slight colour fringe, a vignette, film grain,
  and shadows pushed cold. Darkening where walls meet the floor, the ceiling and each other is baked into
  vertex colours. The floor has puddles that shine.
- **Light**: the torch in your hand is a shadow-casting point light that flickers. There are wall torches
  every few corridors. Three lights are shared between the nearest wall torches you can see, and the
  nearest of them casts shadows. The number of lights never changes, so shaders never recompile while
  you play. Cold moonlight comes down the stairs from the way out.
- **Details**: flames drawn by a shader, embers rising from them, dust drifting through the torchlight,
  chains swaying from the ceiling, cobwebs in the top corners, loose stones along the walls.
- **Sound** (all synthesised): room tone, a low drone that beats against itself, dripping water, the torch
  roaring and crackling, footsteps in a stone room, and a long reverb on everything. Every 30 to 80
  seconds there's something far away: a groan, a dragged chain, or slow heavy steps. It's positioned in
  3D so it comes from a direction.
- **Controls**: controller (left stick walks, right stick looks, RT, RB or a left-stick click hurries,
  A confirms, Start pauses). Keyboard and mouse (WASD, mouse look with pointer lock, Shift, Esc).
  Touch (a stick appears under the left thumb and hurries at the edge, the right side looks). The page
  asks Edge on Xbox for real controller input (`navigator.gamepadInputEmulation`) and keeps a spare
  history entry so B doesn't navigate away.
- **Keeping it smooth**: the resolution scales between 0.5x and 1.5x to hold about 50 to 60 fps.
  `?debug` shows the frame rate.

## Testing without a person

`_tools/undercroft/test.mjs` serves the repo the way Jekyll publishes it and opens the game in headless
Chromium with a fake standard controller. The game has a `?test` mode (fixed seed, no sound, no
real-time loop) and `window.__uc` hooks for stepping the simulation and placing the camera. The test
checks that the page loads without errors, the version shows, A starts the game, the left stick walks,
walls stop you and the right stick turns. Then it walks the shortest route to the way out using only the
sticks and checks that you win. Finally it saves screenshots of the start, the stairs and points along
the route, so they can be looked at.

```
NODE_PATH=$(npm root -g) node _tools/undercroft/test.mjs /tmp/shots
python3 _tools/undercroft/make_textures.py     # regenerate the textures
```

Rendering in the test is software-only (SwiftShader), so it checks what's drawn, not how fast it runs on
a real device.

## Next

- Swap the generated textures for photoscanned ones (Poly Haven / ambientCG, CC0) once those sites are
  allowed in the environment's network settings.
- Monsters: something that hunts by sound, so hurrying (louder footsteps) is a risk. The distant sounds
  are already placed in 3D and can come from it.
- Doors, side rooms, an iron gate that needs a key, the torch burning down.
- If it gets too heavy for Edge on Xbox, package it as an app through Xbox Developer Mode.
