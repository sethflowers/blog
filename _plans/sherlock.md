# Sherlock

A murder-mystery detective game on a night train. You're a famous detective travelling home on the
Midnight Express on a stormy night. The lights go out; there is a crash and a scream; when the lights
come back on, one of the passengers is lying dead. Nobody can get off until the morning. You examine
the crime scene, take everyone's fingerprints, measure footprints, question the six suspects, and
when you're sure, accuse one of them. Right person: case solved. Wrong person: the murderer gets
away and the case is lost (on Easy you get one warning first).

For ages 8 to 13: realistic people and a proper mystery, but nothing gory (the victim is "hit on the
head with something heavy", lying still on the floor; no blood).

Same shape as the other games (see CLAUDE.md): one page (`_experiments/sherlock.html`), ES modules in
`experiments/sherlock/js/`, three.js r180 and its loaders in `lib/`, the 18 Rocketbox people in
`models/people/`, a manifest, a service worker and icons rendered from the game
(`_tools/sherlock/icons.mjs`). Plays on an iPad (touch), a computer and in VR (WebXR), offline once
opened online.

## The train (train.js)

Six carriages you walk through, front to back, joined by gangways, with the car's name in brass over
every door:

- **Baggage car**: crates, trunks and mailbags, the workbench (where the big spanner hangs), an oil
  drum, and the locked door to the engine.
- **Kitchen car**: a counter, the stove with pans hanging over it, the sink, shelves of jars (and the
  rolling pin), sacks of flour, an icebox.
- **Dining car**: tables by every window with white cloths and little shaded lamps, velvet chairs, the
  bar. **The Coke**: a glass contour bottle, half drunk, red label and cap, always on the third table
  on the left. It can be dusted for prints (lots of people had some at dinner) and sipped.
- **Lounge car**: armchairs, the card table, the piano (with a ring in the dust where the candlestick
  stood), the bookcase, a rug, a little table with a glass.
- **Sleeping car**: a side corridor and seven cabins (one for each passenger), each with a bunk, a
  suitcase, a window and its number over the door; a fire-extinguisher bracket in the corridor.
- **Observation car**: big windows, benches down the middle, plants, the umbrella stand, and the open
  **back platform** with brass railings (louder rain out there).

Outside: night, storm clouds and lightning (a flash, then thunder), mountains far off, dark pines and
telegraph poles rushing past, the track's sleepers going by underneath, rain falling outside and running
down every window. The train stands still in its own coordinates; the countryside moves.

Everything static is merged into one mesh per material (`Batch`, about 80 draw calls in all). Walls and
furniture are rectangles for walking into: tall ones (walls) stop your real head in VR, low ones
(tables, beds) only stop the stick. Lights: a dim warm hemisphere, a moon light (which lightning
brightens) and four point lights that follow you to the nearest lamps; the lamps' glow is one shared
material, so the blackout turns every lamp off at once.

## The people (people.js)

The same 18 Rocketbox avatars as MSB, Alien Hunter and Fantasy Theme Park (realistic, rigged, with idle,
walk, nod and head-shake animations). A mystery loads only the eight it needs (seven passengers and the
conductor); the service worker saves all 18 for playing offline. People are shorter or taller than their
avatar (a clue), wear their job's hat (a chef's toque, a baker's cap, a mechanic's flat cap, a
gardener's straw hat, a fisher's bucket hat, a painter's beret, a beekeeper's veiled hat, the
conductor's peaked cap), turn to look at you when you come near, nod when they answer and shake their
heads when they deny something. The victim lies on the floor, face up.

The notebook shows everyone's face: each person is drawn once into a small picture (a camera that only
sees layer 5, with its own lights), done before the victim falls.

## The mystery (mystery.js): always exactly one answer

The crime is made first and the clues follow from it:

1. Seven passengers (your own photo people first, then made-up ones with names, avatars and one of 15
   professions: baker, doctor, teacher, mechanic, author, blacksmith, gardener, fisher, potter, painter,
   jeweller, tailor, beekeeper, chef, candle maker). Each has fingerprints (a loop, a whorl or an arch,
   and details of their own), shoes (a size and a sole: work boots, wellies, trainers, smooth leather,
   small heels, clogs), hair and clothes colour (from their avatar) and a height.
2. One is the victim, one the murderer. The scene is the lounge, observation, baggage or kitchen car or
   the sleeping car's corridor; the weapon something heavy that belongs somewhere on the train (a brass
   candlestick, a heavy book, a lion bookend, a walking stick, a spanner, a rolling pin, a frying pan, a
   fire extinguisher). Its usual place shows it's missing.
3. Where everyone was when the lights went out: two were together (they vouch for each other); on Easy
   the conductor also heard someone in their cabin; the rest were alone. The murderer says they were
   alone somewhere else.
4. The clues: the fingerprint on the weapon, footprints through a spill by the body (lemonade, flour,
   oil, cocoa or rainwater) heading off one way, a trace of the murderer's work on the victim's coat, a
   hair on the collar or a thread on the door frame, footsteps someone heard hurrying towards the front
   or back, a figure seen in a flash of lightning (tall, short or in between).
5. Each innocent person nobody can vouch for is like the murderer in most ways, and differs in their
   own share of the clues. So putting all the clues together leaves only the murderer, but on Medium no
   single clue does it, and on Hard no two clues do. A solver checks this for every mystery.

| | Easy | Medium | Hard |
|---|---|---|---|
| People who can't prove where they were | 3 | 4 | 4 |
| Fingerprint on the weapon | whole: matches one person | part: only the pattern | part: only the pattern |
| Footprints | size and sole | size and sole | smudged: size *or* sole |
| Trace on the coat | exact (e.g. flour: a baker) | its kind (a white powder: flour, talc or chalk) | its kind |
| Also | a hair | footsteps' direction, a hair or a thread | direction, height, a hair or a thread |
| Red herrings | none | someone's prints on the door handle (they went in before dinner) | that, and a glass |
| Sparkles over clues | all of them | when you're close | none |
| Suspect board | says why each person fits or not | says who has an alibi | blank |
| Wrong accusation | one warning, then lost | lost | lost |

Motives come from a note in the victim's pocket: the murderer and one or two innocent people all had a
reason (money owed, a stolen idea, an award, a secret, a shop to be closed), so a motive alone proves
nothing.

## Playing (game.js, case.js)

- **The story**: a card about the night, then the lights flicker and go out, a crash, a scream,
  footsteps in the dark, thunder... and the lights come back on. The conductor says where the scream came
  from and an arrow points the way. Walking into the scene shows the body and how to investigate.
- **Examining**: tap a thing (or the big button for whatever is in front of you; E on a computer;
  point and pull the trigger in VR). Its panel says what it is and offers the right tools: 🔍 look
  closely (the body, the door frame), 👛 check the pockets, 🖌 dust for fingerprints (the weapon, the
  door handle, a glass, the Coke), 📏 measure the footprints. You have to be within about 3 m. Each find
  goes into the notebook with a chime and puts a numbered yellow evidence marker on the floor.
- **People**: each has a panel with their face: ask where they were when the lights went out, what
  they heard or saw, and what they thought of the victim; take their fingerprints; look at their shoes;
  look at them carefully (height, hair, clothes, the trace of their work on their hands). Cross them off
  the suspect list (and put them back).
- **The conductor** (in the dining car): what they did during the blackout, and a hint for what to do
  next.
- **The notebook**: To do (the jobs list, which also shows on the left of the screen), Clues (with
  pictures of the prints), People (everything you know about each of them), Suspects (faces to cross
  off). Compare the weapon's print with everyone's, and the footprints with everyone's shoes.
- **Accusing**: choose a face, confirm, and everyone gathers in the lounge car in front of you. Then the
  ending: solved (the murderer is taken away, with a rank by difficulty and time: Detective, Inspector,
  Chief Inspector, Sherlock!) or lost (they slip off the back of the train). Either way it explains what
  really happened, the clues that proved it and who couldn't have done it.
- **Saving**: the mystery is saved as its seed, the difficulty and your people (so it can be made again
  exactly), plus what you've found, every 10 seconds and on every find (`sherlock-save-1`, with an
  `upgrade()` for later versions). A solved or lost case is cleared.

## Your own people (cast.js)

From the title screen (on a screen, not in VR): **Add your own people**. A name, three photos (the
front of the face, their left side, their right side), taken with the camera or picked from the photo
library (a file input: the iPad offers both, with no camera permission to manage), a body and clothes
(any of the 18 avatars), hair colour, height, a job (or any), and **Never the victim** (on by default;
they can still be a suspect or the murderer).

Each photo is lined up with an outline (an oval with an eye line for the front; for the sides an outline
with an arrow for the nose and a Flip button): drag to move, pinch / the buttons / the mouse wheel to zoom.
That puts every face in the same place, so no face-recognition is needed. The game then paints a 3D head:
a sphere pushed into a head shape (narrower jaw, nose, brow, chin, ears), the front photo projected onto
the face, the side photos onto the sides, blended where they meet, hair colour behind and skin colour
under the chin and on the neck. It rides on the avatar's head bone in place of the avatar's own head and
hair (hidden), under their job's hat.

Photos are stored small (384 px JPEGs) in this browser's IndexedDB and never leave the device. Up to
seven of your people join a new mystery when "Use my people" is ticked; if all seven are "never the
victim", the victim is a made-up passenger.

## VR

Left stick walks (where you look), right stick turns (snap or smooth, in the menu). The notebook is in
your left hand: every panel appears on it; point with the right controller and pull the trigger
(right stick scrolls; B / Y hides it). Point at people and things to examine them (a laser and their
name; checked 20 times a second against simple shapes, and walls stop the ray). Messages appear on a
board in front of you once the headset has reported where your head is. Fading for the gathering is a
black bubble round your head (the same on screen). Everyone stays exactly where they are, so nothing
moves your play space except the gathering, which puts you in the lounge facing everyone. The
notebook's home page shows the version.

## Tests

`_tools/sherlock/test.mjs` (under a minute): 4,500 generated mysteries (exactly one answer, hard enough,
alibis consistent), your own people in the generator, the scenery's boxes checked for flicker, the
loading screen, then a whole Easy case (story, blackout, body, every clue, questioning everyone, the
conductor, the Coke, the notebook and comparisons, the warning, solving it), a Medium case (save and
load half way, a wrong accusation loses), adding a person from three drawn photos and seeing their
photo head on the train, the notebook's reasoning agreeing with the answer once everything is known,
memory flat over several cases, draw calls, then VR (the notebook in your hand, pointing at a button).
`--full` checks more cases.

## Version 1.0

First version, built from the design above (the train instead of the country house we first talked
about; six suspects; Easy, Medium and Hard; realistic people; photo people on screens only; never the
victim on by default). What went wrong on the way and how it was fixed:

- **The generator** first made random people and threw away cases that didn't work out: Medium failed
  most of the time and Hard always. It now builds each case on purpose (each innocent person is like the
  murderer except for their own share of the clues), and averages 2 or 3 tries.
- **Footsteps at the ends of the train**: if the body is in the first or last car, everyone is on the
  same side of it, so "the footsteps went towards the back" can't rule anyone out. Those cases use the
  height clue instead.
- **All seven of your own people**: their hair and clothes are fixed, so a hair or thread clue often
  couldn't be balanced. With two or more of your people a case may do without one.
- **Hats and photo heads**: the avatars are in centimetres, so hats came out a hundred times too small
  and photo heads a hundred times too big (a black disc on the ceiling). Sizes are now worked out in the
  avatar's own units.
- **Memory**: every person has their own skeleton, whose bone texture wasn't freed when a case ended
  (about 24 textures a case). `Person.dispose` now frees it, and the test checks memory stays flat.
- **Flicker**: lamp rims flush with the ceiling, gangway walls inside the cars' end walls, a door frame
  against the sleeping car's cabins, the baggage car's tool board on a window sill (it also covered part
  of a window), the platform rails inside the end wall. All moved apart; the test checks the boxes.
- **The accusation scene** used real-time timers, so it couldn't run faster in tests and ignored the
  game clock; it now runs on the game's own timeline.
