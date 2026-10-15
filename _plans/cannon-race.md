# Cannon Race

Angry Birds, but first person. You sit inside a cannon, aim it, and fire yourself at towers of
wood, glass and stone with people standing on them. Knock everybody down. The "race" is the
clock: each level remembers your best time and your stars.

Same shape as the other experiments: one self-contained HTML file, Three.js r128 and cannon.js
0.6.2 (physics) served from `experiments/cannon-race/`, a manifest, a service worker and icons so
it installs and runs offline.

## A shot

1. **Intro**: the camera starts beside the structure, then swoops back into the barrel.
2. **Aim**: you look out of the inside of the barrel. Drag (or arrow keys / WASD) to turn it,
   ±40° left and right, -6° to 62° up. Hold FIRE (or Space): the power meter climbs and falls
   back; let go to launch at 16–46 m/s. A white line on the meter marks the last shot's power,
   and a dotted line in the air shows the last shot's path.
3. **Fly**: you are a 200 kg ball; the camera looks where you are going, with your gloved fists
   out in front, speed lines, wind and a wider field of view as you go faster. Tap (or Space)
   once in the air for a PUSH, an extra 14 m/s in the direction you are facing.
4. **Settle**: once you stop (or fly off past everything), the camera turns to watch the
   structure until it stops moving, then you are back in the cannon.

## The structures

Every block and person starts asleep, so nothing wobbles until it is hit. Blocks have health and
take damage from impacts (more from you):

| Material | Health | Notes |
| --- | --- | --- |
| Glass | 6 | shatters from a short fall |
| Wood | 45 | a fast direct hit snaps it |
| Stone | 150 | heavy; mostly pushed, not broken |

A person is knocked down when you touch them, when anything hits them at over 4.5 m/s, or when
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

Stars: 3 with two or more shots to spare, 2 with one, 1 for clearing it on the last shot.
The timer starts on your first shot and stops when the last person goes down.

## Ideas for later

- More levels, moving targets, a real race against a rival cannon.
- Different things to fire out of the cannon (heavy, bouncy, splitting).
- A replay of the shot from the side.
