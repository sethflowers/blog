# Monster Killer

A third-person game for `_experiments/` in the spirit of Shadow of the Colossus. One giant at a
time, as tall as a skyscraper, walking through a dead city. The hero is a normal-sized person
who can fly, fast. Gritty and heavy, not cartoony: ash in the air, fog, film grain, a washed-out
grade, one red scarf for colour.

Same shape as the other experiments: one self-contained HTML file, Three.js r128 served from
`experiments/monster-killer/`, a manifest, a service worker and icons so it installs and runs
offline.

## The Warden

Not a giant person: a beast. A long, low body carried nearly level with a ridge of stone spines
along the back, walked on two heavy clawed forelimbs and two digitigrade hind legs (the hock leans
back like a horse's or a dog's). A long two-part neck ends in a horned skull with a hanging jaw,
teeth and four pale eyes. A heavy plated tail drags behind it and can be climbed up onto the back.
It rears up onto its hind legs to slam, and when it dies it rolls onto its side.

## Scale

Everything is in metres. The hero is 1.8 m. The Warden carries its head about 300 m up, the towers 40–200 m.
Flying is 46 m/s and boosting is 125 m/s (about 450 km/h, shown top left), but circling the giant
still takes the better part of ten seconds, which is the point. Speed comes across through wind
streaks, ash rushing past, a wider field of view, a radial blur and the wind getting louder.

## The fight

- **Lights**: four glowing runes on its body. The back of the right hind shin, the outside of the left
  forearm, between the shoulder blades, and the crown of its head. The crown is under a stone helm
  that only falls off once the other three are out.
- **Grab** anywhere on it (E / right click / GRAB) when you are close. You stick to the real rock
  and climb with the movement keys (boost climbs faster but tires you). Space / UP lets go.
- **Grip** drains while you hold on, slowly at rest, faster climbing. When it **shakes**, you have to
  hold the grab button or you are thrown off within a second.
- **Strike** (left click / STRIKE): in the air it is a quick lunge that chips a light. Holding on,
  hold to charge and release to stab. A full charge takes about a third of a light. Stabbing
  bare stone just sparks.
- **Seek** (F / SEEK): raise the blade and a beam points at the nearest light. You slow right down.
- **Lock** (Q / LOCK): the camera keeps the nearest light (or its chest) in view.
- Breaking a light makes it stagger and kneel for a few seconds, and black ichor pours out.
- Health comes back if you go five seconds without being hit.

## What it does to you

- **Swat**: if you are in front of it within reach, it winds an arm back (you hear it) and sweeps
  it across at your height.
- **Slam**: if you are low and close, both fists come down and a ring of dust rolls out across
  the ground. Fly up over it.
- **Throw**: if you are far away, it scoops up a chunk of the city and throws it where you are
  going to be.
- **Tail**: get behind it, low, and it looks back over its shoulder and sweeps the tail across.
- **Roar**: fly within about 95 m of its head and it roars you away. You have to climb up to the
  crown.
- **Feet**: every step shakes the camera, throws up dust and flattens the towers it lands on. Being
  under a foot is nearly fatal.
- It walks after you, turning slowly, and it ploughs through towers with its legs and fists.
  Restarting rebuilds the city.

## Notes

- The giant is a joint hierarchy with one merged, flat-shaded mesh per joint (rock limbs from a
  lathe and noise, stone plates, spines and tufts of hide). Poses are procedural: a walk cycle plus
  blended attack keyframes, and the pelvis is lowered each frame so the lowest foot is on the ground.
- Capsules along each bone (fitted to the real rock at load) are used for flying into it, being
  hit by it and crushing towers. Grabbing and climbing ray-cast against the actual meshes, so you
  hold on to the surface you can see.
- The city is three instanced meshes (towers, broken crowns, rubble); windows are drawn in the
  shader from each tower's local position.
- Every material goes through a procedural "grit" shader (value noise in GLSL): rock and hide get
  pits, cracks and fine grain, buildings get stains, cloth gets weave and dirt, and the noise also
  bends the lighting normal, so surfaces are rough rather than plastic. The giant uses smooth
  normals with sharp creases kept above 62°.
- The hero has knees, elbows, hands and a hood, and every joint is driven by a damped spring toward
  a target pose (hovering, flying, climbing, charging, tumbling), so limbs lag, overshoot and settle.
  The cloak and scarf are verlet cloth kept relative to the hero and blown back by the wind of flight.
- Post pass: radial speed blur, chromatic fringe, filmic curve, desaturated cold-shadow grade,
  vignette, grain.
- `window.__mk` exposes the game state and a fixed-step `step(n)` for testing in a headless browser.

## Version

The title screen shows `v` + the front matter `version`. Bump it on every change.

## Ideas for later

- More giants, one at a time (none of them shaped like a person): a sky serpent that never lands, a giant on stilt legs, one that
  wades through a flooded district.
- Fur you can grab that makes grip last longer, and armour you can knock off.
- A rest point between giants.
