# Glue Gunner

A first-person fight on a steel landing deck the size of a football field (110 × 50 m), floating
high in an alien sky at dusk. Small floating blocks drift 4–7.5 m over the deck (and a few just past
its edges). When you spawn there are ten aliens on the deck with you. Your gun shoots glue strings:
the first shot sticks one end to whatever it hits, the second shot sticks the other end to whatever
that hits. Then the glue sets and the string shrinks, hard: glue an alien to a block and it is hauled
off its feet until the part it was stuck by rips off. One page, played on an iPad, a computer, or in
a VR headset (WebXR), offline once it has been opened.

Files: `_experiments/glue-gunner.html` (page, title, loading screen, HUD), `experiments/glue-gunner/`
(`js/`, `lib/` three.js r180, `sw.js`, `manifest.json`, icons), `_tools/glue-gunner/` (`test.mjs`,
`icons.mjs` renders the icons from the game, `viewer.mjs` renders the alien alone in a few poses).

## 1.0: the first version

**The aliens** (`alien.js`). The user asked for them to be as realistic and scary as possible, and
there are no model files, so they are built from code: tall (2.3 m), gaunt and hunched; a long ridged
skull swept back into a crest; a lipless mouth full of thin, uneven needle teeth hinged far back so it
opens very wide; eight small amber eyes sunk in dark sockets; a rib cage pushing through dark, wet,
wrinkled skin (a generated normal map, a clear coat, mottling and veins in the vertex colours); arms
that reach below the knees, with bony elbow spurs and three long black claws; backward-bending legs on
clawed toes; dorsal spines and a ridged, barbed tail.
- Each alien is one `SkinnedMesh` (+ one for teeth/claws/spines, + one for the eyes) on its own
  skeleton of 30 bones. The shape is built once (swept tubes with a radius function for ribs,
  vertebrae, knuckles, tendons) and shared by every alien; skin is blended between bones near each
  joint, so it bends like a body. Aliens differ only in pose, size (0.92–1.14) and one of three tints.
- Procedural animation: a hunched stalking walk, a four-legged gallop when charging, a crouched prowl
  with the head sweeping and sudden jerky head twitches, a rearing scream (jaw wide, arms out, head
  shaking), a slashing attack, thrashing when stuck by glue (the stuck limb reaching toward whatever
  pulls it), crawling on its arms with no legs, hopping on one, limp when dead.
- **Ripping a part off doesn't build anything.** The torn bone is shrunk to nothing on the alien (its
  skin collapses into the joint, which gets a wound cap: torn flesh, ichor and a stub of bone), and a
  `Debris` copy is made: a new skeleton sharing the same shapes, with everything but the torn part
  shrunk away. Every part can go: hands, forearms, arms, feet, legs, toes, tail (three places), jaw,
  head, or the whole top half (glue the hips or chest). Losing the head or top half, or three limbs,
  kills it; it falls over onto the deck.
- AI: prowl until it notices you (sooner when you're close), scream, then hunt. Only a few (2 + wave/2,
  at most 5) may charge at once; the rest circle at 7–12 m waiting their turn. Chargers gallop, may
  leap the last few metres, and slash (12 damage, 20 for a leap). Glued aliens struggle away from the
  pull, shrieking. A hard landing staggers them; a very hard one kills.

**The glue** (`glue.js`). A shot is a ray (aliens are tested as capsules round each bone, blocks as
boxes, plus the deck, crates and masts); a glowing glob flies to the hit point at 75 m/s and sticks.
After shot 1 the string sags back to the gun (the lamps on the gun's back, the crosshair's "1"/"2" and
the hint along the bottom say which shot is next). After shot 2 the string's rest length shrinks at
3.2 m/s (on past zero), so its tension `K·(length − rest)` (K 900 N/m, damped) keeps rising once the
ends can't get any closer. It pulls on both ends: an alien is lifted when the pull upward beats its
weight, then swings so its stuck part points up the string; on the deck its claws grip up to 450 N.
When the tension passes the part's strength (900 N for a tail tip up to 2700 N for the waist) the part
rips off, and every glue end on it now holds the torn piece (which dangles from the block). Glue two
aliens together and they're dragged into each other until one tears; glue one to a block past the edge
and it is flung off the deck into the sky (+150). At most 10 strings; ✂ / C / grip cuts them all.

**The world** (`world.js`). A steel deck (generated plate texture with seams, rivets, tread plates,
oil stains and rust, plus normal and roughness maps), a low hazard-striped lip, yard lines every 10 m,
a centre circle and red end zones; cargo crates (some stacked) to dodge round and glue things to; six
light masts. Under it, a great hanging lump of rock with a glowing crystal at the bottom and four
engines with blue flames. 28 floating blocks (one `InstancedMesh`: dark alloy with a glowing cyan
inlay and a soft lifting-field glow underneath) bob gently. The sky: a dusk gradient (orange and rose
toward the low sun, violet overhead), streaks of sunset cloud, stars scattered at random, a ringed gas
giant on the horizon, a sea of cloud far below and more floating rocks in the distance.

**Waves.** Wave 1 is the ten aliens already on the deck (they notice you one by one). Clear it and the
next wave (8 + 2n, at most 16) climbs up over the edges. +25 per part torn off, +100 per kill, +150
into the abyss, a wave bonus. Die and you can retry the wave. Corpses and pieces stay (at most 14 and
44: the oldest far from you are cleared); ichor splats on the deck are a fixed ring of 260.

**Controls.**
- iPad: thumb stick bottom left, drag to look, tap something to shoot it, big GLUE and ✂ CUT buttons,
  ☰ Menu.
- Computer: WASD (Shift runs), drag to look, click to shoot where you click, Space shoots the middle,
  C cuts, Esc menu.
- VR: a glue gun in each hand (either trigger shoots; the shared next-shot state carries over), aiming
  dots on what each gun points at, grip (or A) cuts, left stick walks, right stick snap-turns (or
  smooth: a menu setting), X/Y menu (placed once the headset reports a pose, brought back if you turn
  away), B closes. The left gun has a screen: health, wave, aliens left, score, next shot, version. A
  message board floats over it; a red glow round your head when you're hit.

**Looks and checks.** Filmic tone mapping, a low warm sun with shadows following you (1024 in VR), a
cool rim light so wet skin catches an edge, the sky as the environment light. Lip faces stand 2.5 cm
proud of the deck sides, mast bases sink into the deck, crates sit 4 mm up and stacked ones 1.2 cm
apart; `_tools/coplanar.mjs` finds no coplanar faces.

**Tests** (`_tools/glue-gunner/test.mjs`): loading screen, version, ten aliens, no z-fighting,
welcome, walking, the lip, close-ups of an alien (front, screaming, side), shot 1 sticking to an
alien's forearm, shot 2 to a block, the alien lifted, the forearm ripping off and hanging from the
string, gluing a head to a block killing it, two aliens glued together tearing, an alien slashing you,
dying and retrying, clearing a wave, wave 2 climbing over the edge, memory flat over waves of tearing,
draw calls, saving; in VR: both guns in hand, the trigger shooting, grip cutting, walking, the menu
board and its buttons, B closing it, leaving VR.
