# VR Test

A capability test for making games for a standalone VR headset as a web app (WebXR), installed from the
headset's browser like the iPad games are installed as PWAs. No store, no developer mode. Simple blocky
graphics (in the spirit of games like Ancient Dungeon), aiming for smooth frame rates over looks.

Same shape as Wildcat: one HTML page (`_experiments/vr-test.html`) that is mostly the title screen, ES
modules in `experiments/vr-test/js/`, Three.js r180 in `experiments/vr-test/lib/`, a manifest, a service
worker and icons.

## What it tests

- **Getting in**: the page checks `navigator.xr`, offers Enter VR, and starts an `immersive-vr`
  session with a `local-floor` reference space (the real floor is the virtual floor). It asks for
  90 Hz when the headset supports it. Without a headset it runs on screen (WASD, mouse, E/right-click
  to grab, click to fire) so it can be tried anywhere.
- **Moving** (no "gorilla" arm-swinging): smooth locomotion on the left stick in the direction you are
  looking (click the stick to run), turning on the right stick around your head (smooth by default;
  Y switches to 30° snap turns, remembered between visits). Walking in the real room also works: the
  game follows your head. Walls, trees, the table and cliffs stop you, including when you physically
  walk into them. Half-block steps are walked up smoothly; A jumps.
- **Your body**: a full blocky body you can see by looking down or in the mirror on the shed.
  - The torso hangs under the head and turns with it (lagging a little, pulled toward where your hands
    are), and leans forward when you crouch.
  - Arms reach your real hands with two-bone IK. The elbow goes where the forearm points (taken from
    the controller's orientation), blended with "down, out and back", which is what makes it look right.
  - Legs: each foot stays planted and takes a step when the hips move too far away from it or the body
    turns, one foot at a time, faster when running. Crouching bends the knees.
  - Hands sit exactly on the controllers (WebXR grip space: -Z toward the thumb, +X out of the back of
    the right hand, +Y up the arm). Fingers follow the controller: index curls with trigger touch and
    pull (lift it off to point), the other three with the grip, the thumb drops when touching the stick,
    A/B/X/Y or the thumb rest and sticks up when lifted.
  - Height is measured from your head at the start (X re-measures; stand up straight first), and the
    whole body scales to fit.
- **Holding things**: grip near something to pick it up, let go to drop or throw it (throw speed comes
  from the last few frames of hand movement). The sword and pistol snap into the hand; other things are
  held where you grabbed them. Let go of the sword by your left hip or the pistol by your right hip to
  holster it. Haptic pulses on grab, cut, shot. B sends everything back to the table.
- **Sword**: the blade sweep between frames is tested against things in reach. A fast enough swing
  cuts a melon, pumpkin or crate in two along the line of the swing: the cut face shows the inside
  colour, and the halves can be cut again until the bits are too small. Slow touches push things.
- **Pistol**: aims along the controller's own pointer ray (the Quest grip is tilted about 45° from
  it), with recoil, slide kick, muzzle flash, tracer and positional sound. It shatters bottles on the
  range rail, blows fruit apart and knocks over animals.
- **Physics**: loose things fall, bounce, settle on their flattest side, roll (the ball), stop against
  walls and posts, and go home if lost.
- **Creatures**: sheep, pigs and chickens wander, graze and flee; hits knock them over (no harm);
  chickens can be picked up and flap when thrown.
- **Villagers**: two people (built on the same body as yours, feet stepping by themselves) who walk
  their rounds, stop to face you, look at your head, wave and give tips in speech bubbles. Hitting them
  gets an "Ouch!".
- **Mirror**: a flipped copy of your body and of nearby things drawn inside the shed (a "room behind
  the glass"), so no second render pass is needed.
- **Wrist watch** on the left wrist: time, frame rate, turning mode.
- **Sound**: synthesised, placed in 3D with HRTF; wind and birds in the background.

## Performance choices

- One material (Lambert, vertex colour times a 16x16 speckle texture) for almost everything.
- The world is merged into one mesh; animals and villagers are a handful of meshes each.
- No real-time shadows: blob shadows under feet and creatures. Fixed foveated rendering is on.
- Particles are one instanced mesh.

## Testing

`_tools/vr-test/test.mjs` runs the game in headless Chromium inside a real WebXR session, using Meta's
Immersive Web Emulation Runtime (IWER) as an emulated headset with two controllers: install it once with
`npm i --prefix _tools/vr-test iwer`. It checks the session, height, body, fingers, walking, turning,
jumping, collisions, the sword cut, holstering, shooting a bottle, picking up a chicken, the mirror and a
villager, and saves screenshots. Headless frames are slow, so the test waits on the game's own clock.

## Ideas for later

- Comfort vignette while moving; teleport as an option.
- Hand tracking (no controllers).
- Distance grab (point and pull).
- Climbing, doors, a dungeon to explore, enemies that fight back.
