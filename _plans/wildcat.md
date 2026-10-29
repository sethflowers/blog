# Wildcat

A third-person game for `_experiments/`. You are a European wildcat (a real wild cat: grey-brown tabby,
thick ringed tail with a blunt black tip) alone in a big forest. Bears, wolves and wild boar live there
too. If you get close to one, it comes for you and you have to fight it. The brief was "make it realistic
looking", so everything is real-world size and the look comes from lighting, fur and a lot of grass, not
from cartoon shapes.

Same shape as the Undercroft: one HTML page, ES modules in `experiments/wildcat/js/`, Three.js r180 in
`experiments/wildcat/lib/`, a manifest, a service worker and icons so it installs and runs offline.
Asset sites (Poly Haven, ambientCG) are blocked in the build environment, so every model and texture is
made in code at start-up.

## The world (`world.js`)

- 800 m square of rolling hills, with mountains rising all round past 300 m from the middle that you
  can't climb. A lake in a basin to the east (cats don't swim).
- Pine forest where a noise field says "forest", open meadows elsewhere with the odd birch, boulders with
  lichen and moss, fallen logs, ferns under the pines.
- The ground blends grass soil, forest floor (needles and leaves) and rock by slope and noise.
- Grass is real blades: up to 240k instanced blades on a patch that follows the cat and wraps round, sat
  exactly on the terrain (the height map is read in the shader with the same triangle split as the
  mesh). They bend in gusts that roll across the field, and part around the cat and anything near it.
- Water: the big lake and four ponds, one just outside the den. The water is opaque (not see-through)
  so it draws the same on every graphics chip; the ripples are mapped in world space.
- Low afternoon sun with soft shadows that follow the cat, a sky with clouds, blue haze in the distance,
  and image-based light from the sky.
- The den: a ring of big stones where the cat starts and comes back to.

## The animals (`creature.js`, `species.js`)

- Each animal is a skeleton (hips, chest, neck, head, jaw, three bones per leg, a tail chain) with soft
  shapes on the bones: tapered capsules and ellipsoids blended like clay. That is turned into one smooth
  mesh (surface nets on the signed distance field), skinned to the bones by how close each shape is.
- Fur is shells: up to 18 copies of the mesh, each pushed out a little further and combed back, where only
  the strands survive. Dark at the roots, light at the tips, every strand its own shade. Outer shells are
  dropped with distance. The wind ruffles it.
- Markings are painted per vertex: the wildcat's stripes, dorsal line, forehead lines and ringed tail;
  the bear's darker legs and grizzled hump; the wolf's dark saddle and cream belly; the boar's mane.
- Eyes are glossy spheres (slit pupils for the cat), with no fur over them. Claws, teeth, tusks, a nose
  and the inside of the mouth ride on bones.
- One posing function for all of them: walk (lateral sequence), run (gallop), rabbit hops, and layered
  moves: swipe, rear up, crouch, leap, bite, tusk toss, flinch, and falling over dead.

| Animal | Health | How it fights |
| --- | --- | --- |
| Brown bear | 380 | rears a little and rakes with a paw (18); or stands up tall, roars and crashes down (32, knocks you flying) |
| Grey wolf (pack of 2–3) | 80 each | circles, crouches, then leaps in and bites (9). One at a time; the others spread round you |
| Wild boar | 170 | backs off, paws the ground, then charges in a straight line (17, knocks you flying); tusk toss up close (12) |
| Rabbit | 1 | runs, zig-zagging. Catch it to eat it (+35 health) |

## Being someone else (1.1)

- Five cat coats from the start, same body and moves: **Wildcat**, **Ginger tabby**, **Black cat**
  (green eyes), **Snow cat** (blue eyes) and **Spotted cat** (rosettes instead of stripes).
- Beat a bear, a wolf or a boar (or catch a rabbit) and you can **be that animal**. For a few seconds
  after the win, Y / E / the BECOME button turns you into it on the spot; after that it's in the "Be a"
  picker on the title, pause and "you fell" screens (LB / RB or the arrow keys, or click). Unlocked
  animals and your last choice are remembered.
- Each plays like itself: the bear is slow with a heavy paw (240 health), the wolf is fast and bites, the
  boar gores with its tusks, the rabbit is the fastest thing in the woods and nips (45 health). The camera
  pulls back for big animals. Everything else still fights you, bears included.

## Fighting

- An animal that sees you stares, then comes. Within about 10 m it **engages**: a banner, the drums
  start, the camera swings round to keep it in view, and it chases faster than you can run.
- **Claw** (X / RT / click): a quick swipe, alternating paws, about 11 damage plus 2.5 a level. Press
  again during a swipe to chain.
- **Pounce** (A / Space): a leap that aims at the nearest enemy (or rabbit) and hits hard (26 plus 4 a
  level), knocking it off whatever it was doing. Costs stamina.
- **Dodge** (B / right-click / Q): a quick hop away, briefly untouchable. Costs stamina.
- **Sprint** (click the left stick / LT / LB / Shift) uses stamina.
- Health creeps back when nothing is fighting you; rabbits give a lot back.
- Beating animals gives experience: levels add health and stronger claws, with ranks from KITTEN up to
  KING OF THE WILD. The best you've done is kept on the title screen.
- Every so often something far off picks up your scent and comes looking, so the fights come to you.

## Testing without a person

- `_tools/wildcat/test.mjs` plays the game in headless Chromium with a fake controller: starts with A,
  runs, catches a rabbit (and checks it heals), fights a boar, a wolf pack and a bear with claws and
  pounces (with the cat unkillable so the bot can't lose), checks a bear can kill the cat and that getting
  up again works, and saves screenshots of each.
- `_tools/wildcat/preview.html` and `shoot.mjs` render one animal in a pose from four angles, for
  working on the models (`shoot.mjs out cat:stand bear:rear wolf:run`).

## Next

- Photoscanned textures once Poly Haven / ambientCG are allowed in the environment's network settings.
- Night falling, and eyes that shine in the dark.
- More animals: a lynx, an eagle that dives, foxes.
