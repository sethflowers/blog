# VR Test

A capability test for making games for a standalone VR headset as a web app (WebXR), opened in the
headset's browser. No store, no developer mode. (The Quest Browser has no "install" for web apps the
way Chrome and Safari do; bookmark the page instead. Meta's route to an app icon is packaging the site
as an Android app with Bubblewrap and sideloading it, which needs developer mode.) Simple blocky
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

## Version 2

- **Grabbing fixes.** You could not get close to the table: leaning over it moved your head "into" it and
  the game pushed you back. Now only tall things (walls, trees, block towers) stop your real head; low
  things (table, fences, low walls) only stop the stick. Grab range is measured to the object's actual
  outline (10 cm), with a white outline on whatever your hand would take. Point at something up to 12 m
  away and squeeze to pull it to your hand (blue outline). Chickens no longer run from anyone within
  1.4 m (that is why they could never be caught); like the other animals, they only run if you rush them.
- **Building** (`build.js`). Half-metre blocks on a grid, 12 kinds. A finger resting on the right
  trigger shows a ghost block where you point; pull to place; keep holding and sweep to paint a row or
  floor along the face you started on. Flick the right stick up/down for the next/previous block (a
  little one floats over your right hand). The left trigger breaks what you point at (hold to keep
  breaking); punching, the sword, the pistol and tank shells break blocks too. Blocks are solid: you can
  climb half-block steps, walls stop you, things rest on them. Picking uses an exact grid walk
  (Amanatides & Woo) so the face you point at is always the one you get. Saved in the browser; the red
  button by the start clears everything (hit it twice). Each block kind is one instanced mesh.
- **Dragon** (`dragon.js`). About 14 m across the wings. Circles the valley, glides, flaps with a
  whoosh. Raise both hands over your head to call it: it finds flat open ground near you (or its meadow
  behind the start), lands facing you, watches you, blinks, breathes, sways its tail, and rumbles with
  little hearts when you pet it. Hitting it gets a huff of smoke. It is solid while sitting.
- **Vehicles** (`vehicles.js`), in the yard to the right of the start. Touch one and squeeze to get in,
  click the left stick to get out. Your view rides in the seat (turning with the vehicle, never tilting).
  Truck: left stick drives and steers, trigger honks. Tank: left stick drives and turns on the spot,
  right stick turns the turret and raises the barrel, right trigger fires shells that blow up blocks and
  knock things over. Helicopter: right stick up/down climbs and descends, right stick left/right turns,
  left stick flies; it settles gently if you get out in the air (you drop to the ground). Engines are
  synthesised loops.
- **Mirror fix.** A sword pushed into the mirror used to show inside the hollow "reflection room", and
  its reflection came out toward you. Real things are now clipped away inside the room, and reflections
  are clipped to behind the glass (material clipping planes).
- **Robustness.** An error in one frame used to stop the three.js loop for good (it asks for the next
  frame after the callback); the frame is now wrapped so the game keeps running.

## Version 2.1: updates that actually arrive

On the headset the title said 2.0 but the game was still 1.0. The page was fresh, but its scripts could
come from a cache: the service worker fell back to its stored copy whenever the network took over 3
seconds, and its stored copy could itself have come from the browser's 10-minute HTTP cache. Now every
script address carries the version (`main.js?v=2.1`, and an import map gives every module and three.js
the same `?v=`), so a new page can only run matching code. The worker only uses its stored copy when
the network fails, stores scripts by their full versioned address, and fills its store bypassing the
HTTP cache. The version is on the big sign in VR as well as the title screen and the watch.

## Version 3.0: a big world, a real truck cab, fast tests

- **The world is 512 m across** (was 72). The valley is unchanged in the middle; around it are rolling
  terraced hills (half-block steps, so the truck can climb them), forests, lakes, a dirt road in a ring
  round the valley with a road out to it from the yard, and mountains at the edge. The ground is built
  in 32 m chunks as you come within view (115 m, where the fog closes in) and dropped when you're far
  away, one chunk a frame. Runs of flat ground of the same kind are merged into single faces, and trees
  are four boxes each. Trunks and rocks are looked up on an 8 m grid so collisions only check what's near.
  The dragon circles wherever you are.
- **Truck cab**: you sit under the roof with the windscreen in front; seats, dashboard with gauges and a
  radio, a steering wheel that turns as you steer, gear stick, mirrors, open side windows.
- **No more white box** round things you can grab: a light tap on the controller when something comes in
  reach, and a little spinning diamond over something you're pointing at from afar.
- **Blocks can't be placed inside the ground** (they fought with it for the same faces and flickered).
- **Tests in 2 minutes instead of 25.** Nearly all the time went into drawing frames in software (no GPU).
  The game now has two test switches: `__vrtest.noRender` skips drawing (screenshots turn it on for a
  frame), and `__vrtest.timeScale` runs the simulation several steps per frame, so game time runs 4x
  faster than real time. Quick hand movements (sword swings, punches) are done at normal speed. A
  button press only counts on the first of the steps. `TIME_SCALE=1` runs it the old way.

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
- Climbing, doors, a dungeon to explore, enemies that fight back.
