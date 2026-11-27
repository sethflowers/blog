# Character Creator

A designer for people, like the character creators in sports games (Tiger Woods, the 2K games): a
person stands on a turntable in a photo studio and you change everything about them: sex, age,
height, weight, muscle, ancestry, then 174 detailed sliders for every part of the head, face and
body, plus skin, eyes, eyebrows, eyelashes, hair, clothes, shoes and hats, and an expression. You
name and save them, keep a gallery, and move them to another device or another game with a short
**character code** or a **seed number**. It goes from photo-real to cartoon: a cartoon dial
(proportions) and four drawing styles (Realistic, Animated, Toon, Clay).

It isn't a game: it's the place a character is made, so the next game can start with a copy of it
(`js/` and `data/`) and build any saved person.

Same shape as the other games (see CLAUDE.md): one page (`_experiments/character-creator.html`),
ES modules in `experiments/character-creator/js/`, three.js r180 in `lib/`, the body data in
`data/`, a manifest, a service worker and icons rendered from the designer
(`_tools/character-creator/icons.mjs`). iPad (touch), computer (mouse) and VR (WebXR), offline once
opened online.

## The person: MakeHuman's CC0 human

The user asked for "totally real". The first attempt was a fully procedural head (a skull made of
blended distance fields, features added as bumps, eyelids that hug real eyeballs). It worked and
every slider reshaped it, but it looked like a sculpture, not a person; getting from there to real
would have meant re-inventing decades of anatomy. So the person is built on **MakeHuman**
(makehumancommunity.org), an open-source human creator whose assets were released as **CC0 (public
domain)** in 2020: a realistic base mesh (19,158 vertices, with helper shells that clothes and hair
are fitted to), about 1,200 morph targets measured from real bodies, a 163-bone skeleton with skin
weights, 20 photographed skins, eyes, eyebrows, eyelashes, teeth, tongue, hair, clothes, shoes and
hats. (MakeHuman's program code is AGPL and isn't used: the formats are simple text, read by our own
converter.)

`_tools/character-creator/build_assets.py` (Python, numpy, Pillow) turns them into compact files in
`data/` (17 MB in all, saved for offline use):

- `base.bin`: the base mesh, the body's triangles and texture coordinates, the skeleton (each joint
  is the average of a few vertices, so it follows the shape), the skin weights.
- `targets.bin`: the macro targets (gender × age × muscle × weight, ethnicity, height, proportions,
  bust), every modelling slider (left and right merged into one symmetric slider), the facial
  expression units (blink, smile, mouth open, brows up and down, squint...). Each target is sparse:
  vertex numbers stored as differences and offsets as 16-bit integers, gzipped (the page unpacks it
  with `DecompressionStream`).
- `assets.bin`: every fitted part: its mesh, and for each of its vertices three body vertices, their
  weights and an offset (so it follows any body shape), and which body vertices it hides (so skin
  can't poke through clothes).
- `tex/*.webp`: skins at 2048 px; clothes, hair and the rest at 1024 or less. Hair, brow and lash
  textures are made grey (shading kept, colour dropped, the brightest strands near white) and their
  average stored, so any colour can be chosen exactly.
- `manifest.json` (sliders, skins, eye colours) and `files.json` (every data file, for the service
  worker).

## The runtime (portable: js/ + data/)

- `mh.js`: loads the data; blends the targets on the CPU (the macro mix is cached, so dragging a face
  slider only re-adds the sliders); rebuilds the normals over the base vertices (so the texture seams
  don't show); moves the bones to their joints and binds the skin; fits the parts; works out a
  **cavity shading** from the mesh's own curvature (how far each vertex sits behind its neighbours),
  so eye sockets, nostrils, lip corners and ears darken like real ambient occlusion; sets the arms
  down from MakeHuman's A pose; and the idle life: breathing, a slow sway, glances towards the camera
  with little saccades, and blinking as a GPU morph target (the lashes and brows morph with it).
- `looks.js`: the materials. **Realistic**: the photographed skin recoloured to the chosen tone (or,
  on Auto, the three ancestries' skin colours blended by their mix) while keeping its detail, a tiled
  pore normal map, a reddish sheen, and a **subsurface approximation** patched into three.js's
  lighting (direct light wraps softly past the lit side, red first, as it does through real skin);
  wet clearcoat eyes; hair drawn twice (solid where thick, blended at the wispy ends) with
  **anisotropic** highlights along the strands; fabric with its normal and occlusion maps.
  **Animated**: the skin texture blurred smooth (a mipmap bias). **Toon**: three bands of light and
  outlines (an inside-out copy of each mesh pushed out along its normals in the shader, by an amount
  that grows with the distance from the camera, so the line stays the same width on screen). **Clay**:
  one matte colour. Textures nobody wears any more are freed (a 2048 px skin is 16 MB on a headset).
- `spec.js`: what a character is (a small JSON spec), the controls, presets, random people, codes.
- `character.js`: the public API for other games:

```
import { createCharacter, savedCharacters } from './character.js';
const people = savedCharacters();                  // made in the designer (same site, same localStorage)
const c = await createCharacter(people[0].spec);   // or a code 'CC2-…', or a seed number
scene.add(c.root); ... c.update(dt);              // c.bones.head, c.bones['upperarm01.L'] ... to animate
```

## Codes and seed numbers

- **Seed numbers**: every random person has a number from 1 to 999,999; typing it anywhere makes the
  same person (the random generator is seeded).
- **Character codes** (`CC2-…`): a base (the defaults, a seed number's person, or a preset), then
  only what was changed from it, as bytes (each control's number, then its value as one of 200
  steps, which is also the designer's step, so a code loses nothing), then the name; base64. An
  untouched random person is about 10 characters, a tweaked one 20 to 40.
- Because codes and seeds depend on the order of the controls, on the random generator and on the
  presets, those lists are append-only.

## The designer (main.js, ui.js, studio.js, vr.js)

- A studio: a turntable, a soft backdrop, a key light with soft shadows, a rim and a fill, a soft
  light at the camera (a glint in the eyes), reflections from soft boxes; four moods (Studio,
  Daylight, Sunset, Night); neutral tone mapping (ACES pushed skin orange).
- The camera frames what you're editing (body, head, face) and keeps the person clear of the side
  panel. Drag to turn, pinch or the wheel to zoom, Spin.
- Tabs: Start (presets, random person, seed number), Saved (the code, copy, paste a code, the
  gallery), Body, Shape (MakeHuman's torso, arms, legs, neck and measurement sliders), Face, Eyes,
  Nose, Mouth, Ears, Skin, Hair, Clothes, Style. MakeHuman's groups fold away (the first of each tab
  is open). A random and a reset for each tab, random everything, undo and redo (Ctrl+Z / Ctrl+Y),
  double-tap a slider to reset it. The three ancestries always add up to 100%.
- Save: a name, a portrait (the face rendered small), into the gallery; the work in progress is kept
  too, so a reload carries on. Presets get portraits in the background after the start.
- Each tab is described once (`rowsFor`) and drawn two ways: HTML at the side, and in **VR** a board
  beside the life-size person (point and pull the trigger; hold it to drag a slider; right stick
  scrolls the board; grip and swing your hand to turn the turntable; left stick walks, right stick
  snap-turns; B/Y hides the board). The board is placed only once the headset reports a head pose, and
  comes back in front of you if you turn away. Version on the board.

## Tests

`_tools/character-creator/test.mjs` (about three minutes, most of it the software renderer): loading
screen, title and version, sliders really reshape (the nose moves forward, height makes them taller),
undo/redo, an 80-year-old gets an older skin, every tab has controls, parts change, the four styles,
the cartoon dial, codes and seeds round-trip exactly (and every preset), save/gallery/open, an old or
broken save is upgraded, memory stays flat over random people, draw calls, and in VR (IWER's Quest 3):
the board appears in front of you, the trigger picks a tab and drags a slider, B hides the board.
`--full` adds a portrait of every preset.

## Version 1.0

The first version: everything above. Things found and fixed on the way:
- The rest pose was snapshotted with the idle motion applied, so every rebuild added a little more
  bend until the person was folded double. The rest pose now always starts from the bind pose.
- Hair and brow textures were normalised to their average and clipped to white; now to their
  brightest strands, with their real average stored for an exact colour.
- An even ancestry mix tie-broke to the African photo, so mixed people came out dark; now the tone is
  a blend of all three and the photo is European unless another ancestry clearly leads.
- Taken-off clothes kept their meshes and textures: now freed (memory test).
- Toon outlines were a fixed 3.6 mm: invisible at full-body distance.

Next, for even more realism: smoother silhouettes (one subdivision step for close-ups), screen-space
ambient occlusion on a computer, more CC0 hair styles and clothes from MakeHuman's community packs
(only the `_cc0` ones), beards, makeup layers painted into the skin texture.
