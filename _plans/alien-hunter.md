# Alien Hunter

A first-person, cartoon-style hunt: aliens have sneaked into a little town disguised as people. You
explore the streets, houses and shops, point your **X-ray camera tablet** at the townsfolk to see
what's inside them (a skeleton, or a little green alien), and zap the aliens with your **Shock Gun**,
which makes them fall down dead. About half the people are aliens. One page, played on an iPad, a
computer, or in a VR headset (WebXR), offline once it has been opened.

Files: `_experiments/alien-hunter.html` (page, title, loading screen, HUD), `experiments/alien-hunter/`
(`js/`, `lib/` three.js r180, `sw.js`, `manifest.json`, icons), `_tools/alien-hunter/` (`test.mjs`,
`icons.mjs`).

## 1.0: the first version

**The town** (`town.js`). Main Street (along x) crosses Elm Street (along z), with raised sidewalks,
zebra crossings, lamps, trees, a hedge round it all and hills beyond. Sixteen buildings face the
streets: twelve houses (pitched roofs, a chimney, a front path, a mailbox, a tree) and four shops on
the corners of the crossroads (Bakery, Toy Shop, Diner, Grocer: flat roof, striped awning, a big sign).
Every building can be walked into: doors are hinged meshes that swing open when anyone (you or a
townsperson) comes within 2.4 m. Houses have a bedroom corner behind a part wall (bed), a sofa facing
a TV, a table and chairs, a kitchen counter with a hob, a bookshelf, a plant and a lamp; shops have a
counter and a till, shelves of goods and crates. A park with a fountain and benches sits at each end
of Elm Street. Everything static is merged into one mesh per material (`Batch`); about 100 draw
calls in the street.

- Collision: walls, part walls, shelves, trees and lamps are *tall* (stop you, your real head in VR,
  and the shock gun); furniture, benches and the fountain are *low* (stop the stick only).
- Floor heights: grass 0, road 2 cm, paths 4 cm, sidewalks and floors 12 cm.
- Roofs don't cast shadows, so the sun lights the rooms (it's a cartoon); a plain white ceiling sits
  half a centimetre under each roof so you don't see the roof's colour from inside.
- A walking graph for people: points along the sidewalks (shared where lines meet, joined across the
  zebra crossings), each house's gate → porch → inside the door → its rooms (placed so straight lines
  between them miss the furniture), and the park paths. Shortest paths with Dijkstra (≈200 points).

**The townsfolk** (`people.js`). Cartoon people: a big round head with eyes, a nose, a smile, ears,
rosy cheeks; hair (short, long, bun, pony tail, spiky, curly, bald), sometimes a hat (bowler, top hat,
cap), glasses or a moustache; shirt with buttons, trousers or a dress, shoes; heights and widths vary.
Each person's parts are merged into three vertex-coloured shapes (body, arm, leg, one toon material
for everyone), freed when the town is cleared. Inside each one, on its own layer (`INNER`, 6): a
skeleton (skull with eye sockets, ribs, spine, pelvis, a red heart, arm and leg bones) or an alien
(green body, big black eyes, antennae with pink tips, tentacle arms). The insides are built once and
shared by everyone; they sit in the same arm/leg pivots, so they walk along.

People wander: home, somebody else's house or a shop, or along the sidewalks and round the park,
stopping to look about. Near you they chat in speech bubbles; aliens sometimes say something a bit
off ("I too enjoy breathing air."), a hint for sharp ears. A revealed alien runs away from you when you
come within 13 m (faster in later towns).

**The X-ray tablet.** Rendered in two passes with the same camera: first the town with one override
material (a glow that's brightest where you see a surface edge-on and fades out by 34 m; additive, no
depth test, so it sees through walls), then, after clearing the depth, only the `INNER` layer (the
insides, name tags, the bolt). The ground, roads and floors are left out (seen edge-on they flooded the
view with glow). Holding someone in the X-ray view for 0.7 s reveals them: a tag over their head
("👽 ALIEN!" or "✓ HUMAN") and a message. The tablet's strip says what the person nearest the middle
of the view is.
- On screen: 📱 raises a tablet frame (HTML) in the middle of the screen; the X-ray is drawn into its
  window with a scissor rectangle, over the normal view, lined up with it.
- In VR: the tablet is in your left hand along the controller's pointing ray; a second camera on the
  tablet renders the X-ray into a 512×320 texture (every other frame) shown on its screen, so you
  point the tablet at people and look at its screen. A strip under the screen shows the scan, aliens
  left, score and the version; a board above it shows the latest message.

**The Shock Gun.** A cartoon ray gun (on screen, bottom right, attached to the camera; in VR in your
right hand, aimed along the controller's ray). A shot is a ray: walls and roofs stop it, people are
upright capsules. A crackling lightning bolt (two instanced strings of stretched boxes, re-jagged every
35 ms) and a flash where it lands. Whoever it hits lights up, cartoon style: their insides flash
through their skin. An alien's disguise then vanishes in a puff of smoke and the green alien falls
flat on its back with X eyes in a puddle of goo (+100 ⭐). A real person says "Ow! Hey!" and runs off
for a few seconds (−50 ⭐, counted as a mistake).

**Towns.** Town n has 10 + 2n people (up to 24), 42–58% aliens. Zap them all and the town is cleared:
time, mistakes, a no-mistakes bonus (50 per alien), best score; "Next town" builds a new one. Saved in
`localStorage` (`alien-hunter-v1`: town, score, best, turning setting, whether you've seen the welcome);
`upgrade()` fills in anything an older save lacks.

**Controls.**
- iPad: thumb stick bottom left (appears where your thumb lands; a new touch always takes it over),
  drag anywhere else to look, tap someone to zap them, big 📱 X-Ray and ⚡ Zap buttons, ☰ Menu.
- Computer: WASD (Shift runs), drag to look, click to zap where you click, Space zaps the middle,
  X toggles the tablet, Esc the menu.
- VR: left stick walks where you look, right stick snap-turns (or smooth: a menu setting), right
  trigger zaps, X or Y opens the menu (placed in front of you once the headset reports a pose, brought
  back if you turn away), B closes it; point at it and pull the trigger.
- If you push against someone for half a second without getting anywhere, you slip past them (so
  nobody standing in a doorway can block you in).

**Looks and checks.** Toon shading (`MeshToonMaterial` with a 4-step gradient). Faces turned away from
the sun get none of its light: with the usual 3-band toon gradient they got a little, so the
shadow map's self-shadowing showed as streaks across the inside walls. Windows: a white frame 1 cm
proud of the wall, the glass 1 cm proud of the frame; rugs 1 cm above floors; road lines 1 cm above
the road; floor slabs 2 cm inside the walls; roofs 1 cm into the walls. `_tools/coplanar.mjs` finds no
coplanar faces.

**Tests** (`_tools/alien-hunter/test.mjs`, about 40 s): loading screen, version, no z-fighting,
welcome, walking, walls, doors, walking into a house past someone in the doorway, the X-ray revealing
a person and an alien, the revealed alien running away, zapping an alien (falls flat, +100) and a
person (recovers, −50), clearing a town and the next, memory staying flat over six towns, draw calls,
saving; in VR: both hands tracked, tablet and gun in them, the tablet scanning, the trigger zapping,
walking, the menu board in front of you and its buttons, B closing it, leaving VR.

Also changed `_tools/loading-check.mjs` to block service workers in its browser: this game's worker
(registered at the top of the page, as it should be) sometimes fetched three.js itself before the
check's hold-back caught it, so the game finished loading and the check saw "Ready!".
