# Cannon Race

Angry Birds, but first person. You sit inside a cannon, aim it, and fire yourself at towers of
wood, glass and stone with people standing on them. Knock everybody down. The "race" is the
clock: each level remembers your best time and your stars.

Same shape as the other experiments: one self-contained HTML file, Three.js r128 and cannon.js
0.6.2 (physics) served from `experiments/cannon-race/`, a manifest, a service worker and icons so
it installs and runs offline.

## A shot (2.0: third person, gliding)

1. **Intro**: the camera starts beside the structure, then swoops back to behind the cannon.
2. **Aim**: the camera sits behind and above the cannon; the flier's head pokes out of the
   muzzle. Drag (or arrow keys / WASD) to turn the barrel, ±40° left and right, -6° to 62° up.
   Hold FIRE (or Space): the power meter climbs and falls back; let go to launch at 12–30 m/s.
   Yellow dots show the first second and a half of the shot at the current power (or the last
   shot's power), and a white line on the meter marks the last shot's power. (The white dots
   that used to hang in the air along the last shot's path were removed in 2.2.)
3. **Glide**: a chase camera follows the flier, who flies face down with arms out like wings.
   Drag anywhere (a joystick appears where your finger went down) or use the arrow keys:
   left/right turns (and banks into the turn), up climbs but slows you, down dives and speeds
   you up. Lift holds you up while you are fast, so you sink as you slow down. There is no push
   button any more.
4. **Hit**: the first thing you touch ends the glide, and you become a ragdoll (see below) that
   carries on with most of your speed.
5. **Settle**: once you stop (or fly off past everything), the camera turns to watch the
   structure until it stops moving, then you are back in the cannon.
6. **Replay** (2.1): if the shot knocked someone down or broke something, the moment around
   the first hit plays again in slow motion from a camera off to the side, with letterbox bars.
   It runs from just before the hit to 1.7 s after, slowest right after the hit, and never takes
   more than five seconds. Tap anywhere, SKIP, Space or Esc cuts it short. The race clock does
   not run during it. Every moving thing is recorded in world space about 45 times a second
   during the shot (2.2: world space, because a body part changes parent when its person becomes
   a ragdoll, and blending a local position with a world one made you vanish for a moment), and
   everything is put back exactly as it was when the replay ends. People about to be hit shout
   ("AAAAH!", "Not the face!") in the replay a moment before they go down.

## Ragdolls (2.1)

You (after your first hit) and every knocked-down person become ragdolls: eleven bodies (pelvis,
chest, head, upper and lower arms, thighs, shins) held together by cone-twist joints with limits,
so they fold, flop and slide instead of tipping over like a plank. A ragdoll's own parts don't
collide with each other, only with the world. Knocked-down people flop for about two seconds
before they vanish in a puff.

## The structures

Every block and person starts asleep, so nothing wobbles until it is hit. Blocks have health and
take damage from impacts (more from you):

| Material | Health | Notes |
| --- | --- | --- |
| Glass | 6 | shatters from a short fall |
| Wood | 45 | a fast direct hit snaps it |
| Stone | 150 | heavy; mostly pushed, not broken |

People are built to real proportions, 1.75 m tall: a small head with eyes, brows, nose, ears and a
smile, a neck, a tapered body, knees, elbows and shoes. Each one is dressed at random (T-shirt or
long sleeves; trousers, shorts or a skirt; short hair, long hair, a ponytail, a baseball cap, or
bald with a beard). They sway a little while they wait. When you come gliding at them (within 30 m) each one panics
in their own way (2.2): waving their arms, covering their face, ducking down with their hands
over their head, hopping up and down, spinning on the spot, or running without going anywhere.

They wave their arms in a panic while you glide at them. A person is knocked down when you touch them, when anything hits them at over 4.5 m/s, or when
they tip past about 57°. They shout something, then vanish in a puff.

## Levels

| # | Name | Distance | Shots | People |
| --- | --- | --- | --- | --- |
| 1 | Backyard | 28 m | 3 | 2 |
| 2 | The Shed | 34 m | 3 | 3 |
| 3 | Glass House | 38 m | 4 | 4 |
| 4 | Watchtower | 44 m | 4 | 5 |
| 5 | The Fort | 50 m | 4 | 5 |
| 6 | The Pyramid | 56 m | 5 | 7 |
| 7 | Twin Towers | 52 m | 5 | 6 |
| 8 | Stone Wall | 46 m | 4 | 4 |
| 9 | The Bridge | 55 m | 4 | 6 |
| 10 | Greenhouses | 50 m | 4 | 4 |
| 11 | Skyscraper | 58 m | 5 | 6 |
| 12 | Stilts | 60 m | 4 | 4 |
| 13 | The Barn | 54 m | 5 | 6 |
| 14 | Staircase | 58 m | 5 | 5 |
| 15 | Glass Tower | 64 m | 5 | 4 |
| 16 | The Castle | 62 m | 6 | 5 |
| 17 | Far Fort | 75 m | 5 | 5 |
| 18 | Two Forts | 52 m and 68 m | 6 | 4 |
| 19 | Stone Pyramid | 60 m | 5 | 5 |
| 20 | Grand Finale | 70 m | 7 | 7 |

Levels are built from `blk` and `man` plus three helpers: `frame` (two posts and a plank),
`cubes` (a column of stone cubes) and `room` (a little glass room with a stone roof).

Stars: 3 with two or more shots to spare, 2 with one, 1 for clearing it on the last shot.
The timer starts on your first shot and stops when the last person goes down.

## Ideas for later

- More levels, moving targets, a real race against a rival cannon.
- Different things to fire out of the cannon (heavy, bouncy, splitting).
- A replay of the shot from the side.
