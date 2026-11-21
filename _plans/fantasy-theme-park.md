# Fantasy Theme Park

Build whole theme parks: lay out the land, the paths and the parking; split it into named lands
(sections); **design** the rides, snack stands, restaurants, bathrooms and buildings yourself rather
than picking stock models; name everything; then open the gates, watch the guests come, and walk
round and ride every ride yourself. Several parks, each with its own name. Plays on an iPad (touch),
in a VR headset (WebXR, e.g. a Quest) and with a mouse and keyboard, from the same page.

The aim is a real game, not a demo: a builder that is pleasant to use for hours, a park that looks
like a place (not a toy), and a simulation that is only as deep as it needs to be to make building
matter. It's like SimCity in that you build a place that people use, but with much less management
and much more hands-on design.

Same shape as Rollercoaster Bros, My Animal Farm and Safari Cruise: `_experiments/fantasy-theme-park.html`
(front matter, loading screen, title screen, HUD, import map, service worker), ES modules in
`experiments/fantasy-theme-park/js/`, three.js r180 in `lib/`, manifest, icons drawn from the game
itself, `sw.js?v=<version>` with a per-version cache, `_tools/fantasy-theme-park/test.mjs`.

---

## 1. What makes it feel finished (the bar for every milestone)

- **One look throughout.** Grounded fantasy rather than cartoon: real proportions (a door is 2.2 m,
  a stall counter 1.05 m), physically based materials with textures painted at start-up plus
  matching normal maps (stone, brick, render, timber, slate, copper with verdigris, wrought iron,
  pavers, asphalt, water), ACES tone mapping, soft sun shadows, an environment map taken from the
  sky so metal and glass reflect, distance haze, a day that turns to dusk and night with lamps and
  ride lights. The colours are rich but not primary-plastic: deep greens, burgundy, gold leaf,
  weathered stone. Realistic guests (see §7). No emoji in the interface: one set of line icons drawn
  in SVG, the system serif (`ui-serif`, New York on iPad) for names and headings, system sans for
  everything else, dark glass panels with a gold accent.
- **A builder that never fights you.** Everything snaps where you'd expect it to, and a green or red
  ghost shows exactly what will happen, with the price. Unlimited undo and redo. Move, rotate, copy
  and bulldoze for every object. A reason is always given when something can't go somewhere ("A path
  needs 2.5 m of headroom under the track"). Nothing needs hover, right-click or a keyboard.
- **Everything has a name and shows it.** Names go on 3D signs in the world (the entrance gate's
  letters, land arches, ride entrance signs, stall boards, restaurant façades), on the park map, and
  in guests' thoughts ("Wyrmfire Run was incredible!"). Every name dialog has a 🎲-style "suggest"
  button with name lists for each theme.
- **Every ride can be ridden**, from the seat, on screen and life-size in VR. Every building can be
  walked into.
- **Loading, saving and offline** as CLAUDE.md requires, plus parks kept in IndexedDB (§10) so a big
  park never fills the 5 MB that all the blog's games share in `localStorage`.

## 2. Parks

- Title screen: **Your parks**, a gallery of cards (a picture of the park taken the last time you
  played, its name, star rating, guests, money or "Sandbox"). Open, rename, copy, delete, **New park**.
- New park: name it (required; suggestions offered), choose the **land** (Meadow Valley, Lakeside,
  Hill Country, Coastal Cliffs: different shapes, water and hills) and the **mode**:
  - **Tycoon**: start with $50,000 and a loan you can take out or pay off. Rides, shops and land
    cost money, and the park's star rating unlocks new things (one list of goals, never a timer).
  - **Sandbox**: everything unlocked and free, guests optional (a "guests on/off" switch).
- Designs you save (rides, buildings, stalls) go into a **Blueprint library** shared by every park,
  so a coaster built in one park can be put down in another.

## 3. The land and the map

- The park sits in its landscape: a highway along one edge (cars come from it), countryside and
  hills beyond the park fence to the horizon (low-detail, instanced trees), so it never looks like a
  board floating in space.
- **Grid**: 2 m cells for paths, walls and ride footprints; coaster track tiles are 8 m (4 × 4
  cells) and 4 m levels, exactly as in Rollercoaster Bros, so its track code works as it is. Props
  and scenery snap to 0.25 m and rotate in 15° steps (or freely).
- **Size**: you start owning about 200 × 200 m inside a 600 × 600 m map, and buy more in 50 m
  plots (Tycoon) to grow it. Chunks of 32 m are rebuilt on their own when something in them
  changes, so editing stays instant however big the park gets.
- **Terrain**: raise, lower, flatten and smooth with a brush; paint grass, earth, rock, sand, gravel
  and flowers. Water: dig ponds, lakes and rivers (which the boat and flume rides can use). Cliffs
  get rock faces, not stretched grass. Tunnels can go through hills (for coasters and paths).
- **Trees and planting**: about a dozen species (oak, pine, birch, willow, cypress, palm, flowering
  cherry, topiary cones and balls, hedges, flower beds, shrubs), placed one at a time or with a
  brush, instanced, swaying a little in the wind.

## 4. Sections ("lands")

- Paint cells with the **Land brush** to make a section; each land has a name, a colour on the map
  and a **theme** that sets the default style of everything built in it, its music and its name
  suggestions. Starter themes, all our own designs:
  - *Castle Town*: limestone, slate, half-timbering, banners. Its castle is a buildable centrepiece.
  - *Enchanted Wood*: giant trees, mossy stone, toadstools, fireflies at night.
  - *Dragon's Reach*: dark basalt, ironwork, ember light, a dragon skeleton prop.
  - *Pirate Harbour*: weathered timber, rope, sails, piers over the water.
  - *Frontier Gulch*: red rock, mine timber, boardwalks.
  - *Sky Kingdom*: white stone, brass, airship masts, crystals.
  - *Main Street*: the entrance land, Victorian shopfronts, gas lamps, a bandstand.
- Where a path crosses into a land, an arch with the land's name can go up (one tap, styled by
  theme). The map, the guest panel ("in Dragon's Reach") and the finances show lands.

## 5. Building tools (the toolbar)

The toolbar along the bottom: **Paths, Rides, Shops & Food, Facilities, Buildings, Scenery,
Terrain, Lands, Park** (entrance, fence, prices, staff, finances, map), plus Bulldoze, Undo and Redo.

- **Paths**: drag to lay them. They join up by themselves with kerbs, corners, and slopes or steps on
  hills. Widths from 2 to 8 m, and **plazas** (fill an area). Surfaces: brick pavers, cobbles,
  flagstones, crazy paving, tarmac, wooden boardwalk, gravel. **Queue lines**: drawn the same way,
  with posts and chains or rails that you can switch, and switchbacks that you drag in. Bridges and
  elevated paths on piers, with stairs. Lamps, benches and bins can be set to appear along a path at
  a chosen spacing, or placed by hand.
- **Park entrance and parking**: the entrance gate is a building you design (the kit in §6 with a
  ticket booth part and turnstiles) with the park's name across it. **Parking lots**: drag a
  rectangle; it marks out bays, lanes, lamp posts and planted islands, and links to the highway with
  a road you draw. Its size limits how many cars, and so guests, can come at once; a parking charge
  is optional. Later: bus stop, and a parking tram to distant lots.
- **Scenery**: fountains (several, with animated water), statues, planters, fences and walls, flags
  and banners, lamps, rocks, theme props (barrels, crates, anchors, crystals, toadstools), lights
  for the night.

## 6. Designing buildings, shops, restaurants and bathrooms

No stock buildings: everything is built from a kit, so you design the look. Ready-made templates
built from the same kit are there to start from, and you can take them apart.

- **The building kit** (2 m grid, 4 m storeys): walls (plain, window, door, arch, shopfront, half-
  timbered), floors, columns, roofs that fit themselves to the walls below (gable, hip, mansard,
  conical turret, onion dome, flat with parapet), towers, chimneys, dormers, balconies, awnings,
  signs, trims. Each piece takes a material from the theme (or one you pick) and a colour. Build up
  to six storeys. Walls of a building are built once and shared, never twice in the same place.
- **Shops and food**: a stall is a counter **inside or against a building you built** (or a
  freestanding kiosk or cart designed in a small editor: shape, roof, awning stripes, colours, sign).
  Give it a name and a menu: pick items (burgers, pizza, fries, ice cream, candy floss, pretzels,
  coffee, drinks, souvenirs, balloons, ride photos) and set their prices. **Restaurants**: a building
  with a kitchen counter and seating you place (tables, chairs, booths, a terrace outside); its
  capacity comes from the seats. Guests can be seen queuing, buying, sitting and eating.
- **Bathrooms**: a building with a restroom part (stalls and sinks inside); its capacity comes from
  the stalls. They need cleaning.
- **Other facilities**: first aid, information kiosk (sells maps and umbrellas), ATM, lockers,
  baby care, staff room.
- Interiors are real enough to walk into (counter, menu board, tables, tiled floor), lit by the
  lights you put in.

## 7. Guests (light simulation, realistic people)

- **Arrival**: cars come off the highway, park in a bay, and families of 1 to 5 walk to the
  entrance, pay and come in; at closing time they walk back to their cars and drive away. A full
  car park means cars drive past ("Lot full" shows on the dashboard).
- **Needs**: hunger, thirst, bathroom, energy, happiness, nausea, money left, and their tastes
  (thrill seeker, family, foodie). They decide by looking at what's near and what they know (from
  the map they may buy), queue, ride, eat, sit on benches, take photos, and go home when tired or
  broke. **Thoughts** say why ("This queue is too long", "I can't find a bathroom", "The path here is
  filthy", "Lovely park!").
- **Movement**: walk on the path network with flow fields per destination, recomputed only when
  paths change; avoid each other on wide paths, bunch up in queues.
- **Looks**: the realistic Rocketbox people (MIT licence) already prepared for MSB and Alien Hunter.
  Crowds need levels of detail to stay fast: the nearest 12 to 24 are full skinned people; the
  rest out to ~150 m are instanced, simpler versions of the same people, with the walk baked into a
  texture and played in the shader (no skinning cost); beyond that, tiny instanced figures. Riders
  on rides use seated versions. Target: 1,500 guests simulated, all drawn, at 60 fps on an iPad and
  72 on a Quest 2.
- **Staff** (Tycoon): janitors (sweep litter, empty bins, clean bathrooms and sick), mechanics
  (inspect and fix rides, which wear and break down), entertainers in costume (cheer up queues),
  security. Hire and give each a patrol area by painting it. No more than that.

## 8. Rides: you design them

Each ride is built in the **Ride Workshop**: the camera focuses on its plot and you shape it with
handles on the model and a few sliders; it test-runs live while you change it. Stats are shown for
every change: **Fun**, **Scary** and **Queasy** ratings, capacity per hour, running cost, and the
suggested price. Every ride gets a name, an entrance building, a queue you draw, an exit, a station
or platform styled by theme, and colours for each part. Ride designs can be saved as blueprints.

- **Coasters** (the Rollercoaster Bros engine, brought across): pieces by hand, **draw a track** with
  a finger (from above, then the heights from the side, or in the air in VR), Finish to close the
  loop, boosters, loops, barrel rolls, upside-down sections, jumps, chain lifts, smooth slopes.
  Types: steel sit-down, hanging (floorless), wooden (with a timber lattice structure), family mine
  train (with rock work), and a spinning coaster. Trains with themed cars (dragon, ship, mine cart,
  airship). Tunnels through hills and buildings. Track can pass over paths if there's headroom.
- **Flat rides**, each with its own designer:
  - **Carousel**: diameter, one or two tiers, mounts (horses, unicorns, griffins, dragons, swans,
    chariots, each placed or set as a pattern), canopy style, paint, mirrors and lights, speed,
    organ music.
  - **Big wheel**: diameter 20 to 70 m, number and style of gondolas (open, enclosed glass,
    sliding), spokes, lighting patterns at night.
  - **Drop tower**: height, how it drops (straight, staggered, launched up), theming of the top.
  - **Swing ride**: height, number of swings, how far it tilts.
  - **Swinging ship**: size, how high it swings, ship styling (pirate, Viking-style longboat, dragon).
  - **Teacups / cauldrons**: number of platforms, cups per platform, spin.
  - **Spinning arms / scrambler**: arm count and speed.
- **Track rides**:
  - **Log flume / rapids**: draw the channel on the terrain with lifts and drops; it splashes riders.
  - **Dark ride**: build its building with the kit, run the track through it, place animated
    scenes (a sleeping dragon, a treasure cave, a haunted hall) and lights; a ride through the dark.
  - **Park railway / monorail**: a loop or line round the park with stations; guests use it to
    travel, and it's lovely to ride.
  - **Boats**: swan boats or rowboats on a lake you dug.
  - **Go-karts**: draw a circuit.
- **Running them**: open/close, ticket price (or free with park entry), how many trains, how long
  in the station, test mode. Rides age and wear (Tycoon); mechanics keep them going; a breakdown
  stops the ride and guests in the queue complain, never stranding the player.

## 9. Playing it: three ways to see the park

- **Build view** (default): orbit camera over the park. One finger drags to pan, two to orbit/zoom
  (pinch), double-tap to focus something. Tap anything to open its **panel**: name, stats, settings,
  edit (opens its designer), move, copy, delete. The HUD: park name, money, guests, rating, date and
  time, game speed (pause, 1×, 2×, 4×), messages.
- **Walk**: drop yourself onto a path as a guest and walk round in first person (thumb stick on the
  left, drag to look), buy something at a stall (it hands you an ice cream), sit on a bench, join a
  queue (or skip it), go into buildings.
- **Ride**: tap Ride on any ride's panel: you sit in the front seat (or choose a seat), drag to look
  round, with a "back to building" button.
- **VR**: the same three. **Model mode**: the park is a model on a table in front of you; grab with
  both grips to move, turn and scale it; build with the right controller's laser; the tool palette
  and panels are on a tablet in your left hand (the same descriptions as the HTML panels, drawn on a
  canvas). **Life-size**: smooth walking on the left stick, snap or smooth turning on the right
  (a setting), ride any ride with the play space in the seat (put back exactly when you get off).
  The version and the park's time and money are on a wrist watch. Comfort vignette on rides (a
  setting).
- Panels are written once and drawn twice (HTML on screen, canvas in VR), as in all our games.

## 10. Time, money and saving

- Game time: the park opens at 9:00 and closes at 23:00; one game minute per real second at 1×.
  Closing time sends guests home; the night can be skipped. Weather: sunny, cloudy, light rain
  (guests buy umbrellas, outdoor rides empty). Seasons later, maybe.
- **Money** (Tycoon): entry and/or ride tickets, food and souvenirs, parking; costs are building,
  wages, running costs, upkeep and loan interest. A **Finances** panel shows this month and the
  last twelve with simple charts, and which rides and stalls earn their keep.
- **Rating** (0 to 5 stars) from guest happiness, cleanliness, variety, scenery and value. It
  unlocks rides and themes in Tycoon.
- **Saving**: each park in IndexedDB as one compact record (grids run-length encoded, objects as
  their design parameters, guests as a small table), auto-saved every in-game hour and after big
  actions, with the version in the record and an `upgrade()` for older saves. The parks list and the
  blueprint library are separate records. `navigator.storage.persist()` from the home screen. Export
  and import a park or a blueprint as a file (to move it between devices).

## 11. Code layout (`experiments/fantasy-theme-park/js/`)

| module | does |
|---|---|
| `main.js` | start-up, loop (try/catch each frame), modes (build / walk / ride / VR) |
| `store.js` | IndexedDB parks, parks list, blueprints, upgrade(), export/import |
| `park.js` | the park's state: grid, objects, lands, money, time; the action list (all edits go through it, for undo/redo and saving) |
| `terrain.js` | heights, painting, water, chunks of mesh |
| `paths.js` | path grid → mesh with kerbs, slopes, steps; queue lines; bridges |
| `kit.js` | building kit pieces, roofs that fit, merged per chunk and material |
| `shops.js` | stalls, restaurants, bathrooms, menus, capacity |
| `rides/` | `coaster.js` + `track.js` + `train.js` (from Rollercoaster Bros), `carousel.js`, `wheel.js`, `drop.js`, `swing.js`, `ship.js`, `cups.js`, `flume.js`, `darkride.js`, `railway.js`, `boats.js`, `karts.js`: each exports a parameter description (for the designer UI), `build(params)`, `step(dt)`, `seats()` and `stats()` |
| `guests.js` | the crowd simulation, flow fields, thoughts |
| `crowd.js` | drawing the crowd at three levels of detail |
| `staff.js` | janitors, mechanics, entertainers, security |
| `cars.js` | highway traffic and parking |
| `sky.js` | sun, sky, night, weather, environment map |
| `materials.js` | painted textures and normal maps, `mat(name)` cache |
| `names.js` | name suggestions per theme |
| `ui/` | panel descriptions, the HTML renderer, the VR canvas renderer, toolbar, icons |
| `input.js` | pointer, stick, keyboard, controllers; never-stuck rules |
| `audio.js` | Web Audio: crowd murmur, ride sounds, screams, land music made in code (no files to fetch) |
| `util.js` | `Batch`, `disposeTree`, maths |

Performance rules from CLAUDE.md apply throughout: static things merged per chunk and material;
instancing for trees, lamps, benches, guests, cars, seats; a sun, a hemisphere light and at most a
handful of point lights (night lighting is emissive surfaces and baked light pools, not hundreds of
real lights); shadows only from the sun, 1024 in VR; pointing tests at 20 Hz against simple
proxies; draw calls in the low hundreds, checked in the test.

## 12. Milestones

Each milestone is a playable version, pushed so it can be tried on the iPad and the headset. The
test grows with each one.

1. **1.0: Ground breaking.** Loading screen, title, parks list (new, name, open, rename, delete),
   Sandbox mode, the landscape and highway, terrain tools, water, trees and planting, paths, plazas,
   queues, bridges, lands with names and arches, park entrance gate, parking lots, scenery and
   lamps, day and night, build view and walk mode, undo/redo, saving, offline, VR (model mode and
   life-size walking).
2. **1.1: Buildings.** The building kit (rooms, wall styles, fitted roofs, materials, towers, chimneys,
   awnings, signs), ready-made buildings per theme, interiors you can walk into.
3. **1.2: Shops, food and facilities.** Stalls and carts you design, with menus and prices; restaurants
   with seating; bathrooms; other facilities; the blueprint library.
4. **1.3: First rides.** The Ride Workshop, coasters (all of Rollercoaster Bros's track, drawing and
   trains, plus wooden and mine-train types), carousel and big wheel; ride them on screen and in VR.
5. **1.4: Opening day.** Guests (cars, parking, needs, queues, food, bathrooms, thoughts), the
   crowd at three levels of detail, Tycoon mode, money, finances, rating, unlocks, staff,
   breakdowns.
6. **1.5: More rides.** Drop tower, swing ride, swinging ship, teacups, scrambler, spinning coaster.
7. **1.6: Water and track rides.** Log flume, boats, park railway, dark ride, go-karts.
8. **2.0: Showtime.** Weather, fireworks and night shows (a simple show editor), land music, the
   park map and guide, park photos, a performance pass on a Quest 2, a polish pass on every panel.

## 13. Tests (`_tools/fantasy-theme-park/test.mjs`)

Quick by default (about a minute), `--full` for the long play-through. Expose
`window.__ftp` (state and actions), `noRender` and `timeScale`.

- Quick: loads (loading check), version on the title, make and name a park, lay paths and a
  queue, paint a land and name it, build a stall and a bathroom from the kit, put down a coaster
  blueprint and a carousel, a few hundred guests visit for an hour of game time (they eat, use the
  bathroom, ride), ride the coaster, VR: model mode, a tablet panel, life-size walk, ride. No
  console errors. Screenshots from a player's angles (close up, side, front, night).
- Checks: undo/redo returns the park exactly; save then load gives the same park; an old save
  upgrades; churning guests, stalls and rides keeps `renderer.info.memory` flat; draw calls and
  triangles under budget for a big test park; `_tools/coplanar.mjs` finds no overlapping surfaces
  in the kit, paths and terrain layers; offline check.
- A test for every bug reported.

## 14. Decisions (the user's answers)

- The large download (realistic people) is fine, as long as there's a loading indicator and it works
  offline. The loading screen shows the percentage and the megabytes so far.
- Music made in code, and building before guests (the order below), were taken as the defaults.

The original questions:

- **Realistic people** add about 1 MB a person to the offline download (18 people ≈ 19 MB, as in
  MSB). Worth it for the look; the first open takes longer on a slow connection.
- **Music** made in code (no audio files) keeps it small and offline, but it won't sound like a
  recorded theme park soundtrack.
- **Order**: building before guests (milestones 1 to 3) means the first versions are a sandbox to
  build and explore in; the park comes alive at 1.3. The other order gets guests in sooner but
  with stock-looking placeholders.

---

## Version 1.0: Ground breaking (built)

What's in it, and how it works.

- **Files.** `_experiments/fantasy-theme-park.html` (loading screen, title, parks gallery, new-park
  sheet, HUD), `experiments/fantasy-theme-park/js/`: `main.js` (start-up, frame loop, cameras, input,
  opening/saving), `park.js` (state + the Edit/undo system + the four landscapes), `terrain.js`,
  `paths.js`, `models.js` (catalogue), `structures.js` (gate, arches, car parks, fences, signs),
  `objects.js` (instancing, night glow, rules, picking, collisions), `tools.js`, `ui.js` (the interface
  described as data), `vr.js`, `sky.js`, `materials.js` (painted textures), `highway.js`, `thumbs.js`,
  `store.js` (IndexedDB), `names.js`, `icons.js`, `audio.js`, `util.js`. Icons by
  `_tools/fantasy-theme-park/icons.mjs` (rendered from the game).
- **The map** is 300 × 300 cells of 2 m (600 m square), heights at the corners; ground paint, water
  level, path surface/flags and land per cell; everything else is an object. The four cells round the
  edge are locked. **Every change is an Edit**: it records the old value of each cell/height/object it
  touches, so undo/redo is unlimited, a cancelled stroke (second finger) is taken back exactly, and the
  world knows which rectangle to rebuild.
- **Ground**: one height-field mesh, edited rows re-uploaded. A splat shader blends grass, earth, rock
  and sand (rock by itself on slopes), two scales of each texture plus broad dry/lush patches so the
  repeat never shows. The countryside is a ring of rays from the map's edge vertices out to 3 km, so
  it shares the edge exactly (no cracks), with instanced woods; the south is level for the highway.
- **Paths**: 7 surfaces + road; footpaths sit 12 cm up with edging stones 5 cm proud, roads 5 cm up
  with a kerb 2 cm proud where they meet footpaths (nothing coplanar). Queue cells get brass posts and
  iron rails, open where the queue meets a path. Path over water = a bridge deck 0.75 m above the
  water, with stone parapets and piers. Rebuilt per 32-cell chunk, one mesh per material.
- **Scenery**: 36 catalogue items (7 trees, plants and flower beds, 4 lamps, furniture, features,
  props), instanced per type and material. Trees are alpha-tested leaf cards with normals bent out
  from the crown, a core so they're not see-through, and wind sway in the shader. Fences/walls are
  drawn from point to point. Signs say whatever you type.
- **Night**: no real lights per lamp. Bulbs are an emissive material whose strength follows the dusk;
  halos are additive points, and pools of light on the ground are instanced additive decals.
- **Lands**: a theme (7, each with its own arch style and name lists), a colour and a name; painted
  per cell (shown as a tint while the Lands tool is open). Arches fit themselves across the path where
  you tap (up to 10 m), carry the land's name on both faces, and follow renames.
- **Car parks**: drag a rectangle (≥ 12 × 12 m); the ground is levelled under it, trees cleared; bays,
  aisles, kerbs, lamp posts and a named sign. Refused over paths/water/the entrance, with a reason.
- **Interface**: tabs (Select, Paths, Trees, Decor, Land, Lands, Park, Bulldoze), a tray per tool with
  3D thumbnails of the real models, a side panel for what's selected (rename, colour, turn, move,
  remove), dialogs for names (with suggestions). All of it is data (`tabs()`, `tray()`, `panel()`,
  `act(id)`), drawn as HTML on screen and on the VR tablet's canvas (with a keyboard for names).
- **Cameras**: build view orbits a target (one finger pans the ground under it, two fingers pinch,
  twist and pan, both moving up/down together tilts; right-drag/wheel/WASD/QE/RF with a mouse);
  Walk is first person on paths and ground (stick on the left, drag to look), blocked by water,
  cliffs, trees' trunks and structures.
- **VR**: model mode (play space scaled 90×, the park at table height), grips to drag / turn / resize,
  right stick turns (snap or smooth: a menu setting) and resizes, laser builds with the same tools,
  B = life-size where the laser points (play space put back exactly when you return), A undo, X
  tablet, Y menu. Version and clock on the tablet.
- **Saving**: IndexedDB (`fantasy-theme-park` → `parks`, `meta`), auto-saved 1.5 s after a change,
  every 90 s with a new picture for the parks list, and when the page is hidden. Export/import as a
  `.park.json` file.
- **Test**: `_tools/fantasy-theme-park/test.mjs` (quick by default; `--full` adds the other landscapes).

## Version 1.1: Buildings (built)

- **The kit** (`buildings.js`). A building is data: `floors` (the rooms of each storey, 2 m cells on the
  building's own grid; a storey's rooms must stand on the storey below), `walls` (a style per outside
  wall: window (the default), plain, door, arch, shopfront, open), `roof` (hipped, gabled, flat,
  battlements, spire, dome), `m` (walls, roof, woodwork, stonework, floors), `timber`, round `towers` on
  grid corners, and `extras` (chimneys, awnings, signs with any words). Buildings stand on the park's
  2 m grid and turn in quarter turns, so they line up with paths.
- **Geometry.** Walls are built in each wall's own frame (x along it, z inward), so one set of styles
  serves every side; windows have frames, sills, glazing bars and glass that glows warm after dark;
  doors stand open (you can walk in); arches are cut with an extruded shape; shopfronts get a riser,
  mullions and a fascia. Inside faces are plastered. Convex corners get quoins (or timber posts) 5 cm
  proud, the base course 3 cm and string courses 4 cm, so no two faces ever share a plane. The floor is
  level, 15 cm above the highest ground, on a foundation down to the lowest. Roofs are fitted over
  every part with nothing above it: the cells are split into rectangles (greedily, largest first) and
  each gets its own roof; roof faces carry UVs along the eaves and up the slope so slates and tiles run
  the right way, with a timber underside and fascia boards. New textures: clay tiles and shingles.
- **Ready-made**: cottage, townhouse, shop row, plain building (Main Street), tavern, gatehouse
  tower, castle keep (Castle Town), pavilion (Sky Kingdom), saloon (Frontier Gulch), harbour warehouse
  (Pirate Harbour), woodland hut (Enchanted Wood). All made from the kit, so they can be changed.
- **Editing** (`btools.js`): Buildings tab → tap where it goes (green or red ghost, quarter turns).
  Tap a building → Edit: Rooms (drag to add or rub out rooms on a storey; the storeys above are lifted
  off, and the roof, so you can see in; add or remove storeys, up to six), Walls (choose a style, tap
  walls; doors and shopfronts only on the ground floor), Roof, Materials (with timber framing), Extras
  (tower on a corner, chimney on a roof, awning over a ground-floor wall, sign on a wall, take away).
  The tools work from the pointer's ray (walls and roofs are above the ground), so the same code serves
  a finger, the mouse and the VR laser. Each stroke or tap is one undoable edit.
- **Interiors**: hanging lamps (about one per six cells) light the floor at night (the light pools now
  know a lamp indoors lights its own floor). Walking: the floor inside is the building's floor
  (`park.floorAt` asks the buildings first), its ground-storey walls and towers are solid, doorways and
  arches are not; small steps (up to 35 cm) are fine.
- **Rules**: buildings can't go on paths, water, the car park or the entrance, or on ground too steep
  (more than about 3 m across), and clear trees in the way; paths, car parks and the land tools stay
  out of buildings; trees can't go inside, furniture and lamps can.

### Fixes from playing 1.0 (in 1.1)

- **Lamps didn't light up** (only the ground under them did): the bulb sat inside lantern glass that
  was opaque dark glass. Lantern panes are now clear warm glass that glows after dark (`lampGlass`,
  driven by the sky like the bulbs and windows). Test: the lamps' glass glows at night.
- **The light under a lamp was a flat disc**, floating above or sunk into a slope. Pools of light are
  now draped over whatever is under them (a 6 x 6 grid per pool following `floorAt`, so paths and
  bridges too); a lamp indoors lights its own flat floor. Test: on a slope, the pool lies within 2 cm.
- **Water cut into the ground and put up walls**: water fills to the height where the stroke starts,
  so painting up a slope dug a trench uphill to that level, with steep earth walls and the water out
  of sight at the bottom (and the trench crept further up a cell at a time, because lowering the
  water's edge let the next cell in). Now the level comes from the lowest ground under the brush;
  water won't go where a cell's highest corner is more than 1.2 m above it (it says why: lower the
  ground first); the water's edge is dug to just under the surface and the next ring of ground
  halfway down to it, so the banks slope. Trees in new water are cleared. Test: water painted up a
  hill fills the low end and stops, with the message.
- **The ground under the entrance flickered**: the gateway's wall was an extruded shape with an
  arch-shaped hole touching the ground, which leaves a strip of wall lying across the opening at
  exactly the path's height. The outline now goes round the opening (the same fix in the building
  kit's arches). Test: no upward face lies across the opening at path height.
- **It froze while walking (the clock still ran, nothing responded)**: the signs of the browser
  taking the 3D view away when the iPad runs short of graphics memory. Now: tablets draw at 1.5x
  rather than 2x (much less memory), and if the view is lost anyway the park is saved and a panel
  says what happened with a Reload button (also if frames keep failing). Walking can never get stuck:
  standing in water (somehow) you can walk out, and a slope that blocks you for 1.5 s lets you go.
  Tests: the lost-view panel; walking out of water.
- Interiors: inside walls, floors and ceilings have a soft fill light (they were black by day), and
  window glass is partly see-through.

## Version 1.2: Shops, food and facilities (built)

- **Stalls** (`shops.js`): kiosk, cart, booth and information kiosk, each with a roof (striped canopy,
  umbrella, dome, pitched), paint and stripe colours, a name board and a menu board. They stand on
  plazas or beside paths (not inside buildings). Placed from the new Shops tab, named from the land's
  theme ("Ember Forge Kitchen"); "Change its look" changes shape, roof, colours and what it sells.
- **Menus**: 26 goods in four kinds (hot food, snacks and sweets, drinks, gifts) with sensible prices.
  The Menu dialog lists everything a place could sell: tap to put it on or take it off, − and + change
  the price in 50 cents. Menu boards are painted from the menu (name and prices, chalk on a board).
  Dialogs can now hold rows of buttons (drawn as rows on screen, in one or two columns on the tablet).
- **What a building is for** (`USES` in buildings.js): food counter, restaurant, shop, toilets, first
  aid. Its ground floor is fitted out along the back wall (the side away from the first door): a
  counter with shelves of goods and the menu board above (food, restaurant), shelves and a display
  table (shop), cubicles with toilets and doors, and sinks with mirrors on the front wall (toilets),
  beds (first aid). The panel shows what it's for and its capacity (a restaurant counts the seats of
  tables in it or on a terrace within 8 m; toilets their cubicles).
- **Seating and facilities** (catalogue): table and chairs, café table, parasol table (any colour),
  booth; cash machine, lockers, drinking fountain.
- **Your designs**: any building or stall can be saved (Save design, with a name) into a library kept
  in IndexedDB (`meta` → `pref:blueprints`), shared by all parks; they appear under "Your designs" in
  the Buildings or Shops tab with a picture, and can be removed (Manage designs).
- Guests come in 1.4: for now these show menus and capacity; nothing is bought yet.

## Version 1.3: First rides (built)

- **Coasters** (`coaster/track.js`, `coaster/train.js`, from Rollercoaster Bros, `rides.js`): the same
  14 pieces (straights, turns, wide turns, hills, big drops, booster, loop, barrel roll, upside down,
  jump), smooth joined slopes, real speeds with chain lifts, Finish (A* back to the station), trains and
  colours, sitting and hanging coasters. Changed for the park: the station can be anywhere on the 8 m
  grid (the map's 2 m grid lines up with it), facing any way, at its own height (`y0`, 0.9 m above the
  highest ground under it); an `env` check keeps track out of hills (and hanging riders off the
  ground), buildings, the entrance, other stations and flat rides, and needs 3 m of headroom over paths
  and 4 m over car parks; supports reach down to the real ground; trees under low track are cleared.
  Each coaster is an object (`type: 'coaster'`, its pieces as a list) so undo, saving and designs work
  as for everything else; its track is rebuilt from the list when it changes. A station with a
  platform, iron posts, a slate roof and the coaster's name at both ends.
- **Flat rides you design**: a carousel (10/12/14 m, one or two tiers, horses, griffins, dragons, swans
  or a mixture on brass poles that rise and fall, mirrored centre column, rounding boards with bulbs,
  striped canopy in two colours, three speeds) and a big wheel (20 to 50 m, 12 to 32 gondolas, glazed
  cabins or open cars that hang level, two colours, lights). Rides spin up and down smoothly; closed
  rides stop.
- **Ratings**: Fun, Scary and Queasy out of 10 for every ride (coasters from their pieces, heights and
  speeds; flat rides from their design), with top speed, height and length.
- **The Ride Workshop**: Rides tab → put down a station (quarter turns, a ghost) → track pieces (with
  drawings), Take a piece off, Finish, Clear, train, colour, speed, Ride it; flat rides: their design
  in the tray. A refused piece shows red with the reason.
- **Riding**: Ride it from a ride's panel. On screen the camera sits in the seat (drag to look round,
  Get off or Escape); in VR the play space rides in the seat (loops and all) and is put back exactly
  when you get off (B). Rides update before the cameras each frame (the eyes followed last frame's seat
  at first: caught by the test).
- Rides block paths, buildings, car parks and other rides; walking bumps into flat rides.

### 1.3.1: fixes from playing 1.3

- **Carousel animals faced the middle**: each was turned a quarter turn too far; now they face the way
  the carousel turns. Test: every animal's forward is along its direction of travel.
- **The big wheel showed nothing when ridden**: you ride inside a glazed cabin whose glass was the
  opaque dark glass; cabins now have clear glass. Test: the cabins' glass is see-through.
- **A hanging coaster said "too low" for every piece**: its riders were measured as hanging a whole
  storey below the seats (they sit where a sitting coaster's do, feet a little lower). Headroom over
  paths is 2.4 m below the track (it was 3 m), and the message says to climb first. Test: a hanging
  coaster's first pieces lay.
- **Then it froze**: checking a piece walked every object in the park at every point of the piece, and
  Finish tries thousands of pieces. Now the entrance, car parks, stations and flat rides are put on a
  grid once (rebuilt when objects change) and looked up; Finish also gives up after 12,000 tries or
  1.5 s. Test: Finish answers in under 4 s (88 ms in the test park).
- The people (for 1.4) are now saved for offline too; the service worker copies them from an earlier
  version's cache, so later updates don't download them again.

## Version 1.4: Opening day (built)

- **Guests** (`guests.js`): cars come off the highway, along the park's road (a flow field over road and
  car-park cells) to a free bay, and their 1 to 4 people walk to the gate (with no car park the road
  reaches, a bus drops them at the gate). They pay the entry fee and come in. Each has needs (hunger,
  thirst, the toilet, energy, nausea), money, a taste for thrills and a mood; every so often they pick
  what's next: first aid when sick, toilets, food, drink, a bench, the ride they'd like best (fun, not
  too scary for them, not ridden too often, short queue, fair price), a snack or a shop, or a stroll.
  They walk the paths by flow fields (one per destination, kept until paths change), each to a spot
  of its own off the cell's middle. They go home tired, broke, fed up, or at closing (9 pm).
- **Rides**: guests queue (on the queue line if there is one, otherwise along the path to the ride),
  pay, ride (a coaster's riders sit in its train; flat rides load, run and unload), feel sick after
  rough rides (and sometimes are), and say what they thought. Rides wear and break down; a mechanic
  walks over and mends it (or Fix it, $300). Rides show their ticket price (−/+), queue and riders.
- **Shops and food**: guests buy from menus (refusing what's more than twice the usual price), eat in
  restaurants, use toilets and first aid; then drop their wrapper in a bin if one is near, or on the
  path. Janitors sweep up. Stalls face the path when put down.
- **Thoughts**: every guest keeps their last few thoughts (tap a guest: their mood, needs, money and
  thoughts); the Park panel shows the commonest.
- **People** (`people.js`): the nearest 14 (iPad) or 22 guests are the realistic Rocketbox people from
  MSB, from a pool of copies handed to whoever is nearest every half second; everyone else is one
  instanced mesh of simple figures in matching clothes, legs and arms swinging in the shader. The
  people load in the background after the park opens (19 MB; saved for offline once, and not again
  on updates).
- **Tycoon** (`economy.js`): new parks choose Tycoon ($60,000) or Sandbox. Every edit is priced when it's
  committed (paths, landscaping, water, each thing added, changed or removed, half back for what's taken
  away); one you can't afford is taken back with the reason; undo refunds. Hourly running costs and
  wages; daily books (two weeks kept); the star rating from happiness, rides and variety, food, litter,
  scenery and value; goals unlock the big wheel, coasters and hanging coasters. The Park panel (Park
  tab → Guests, money and staff): guests, rating, money, entry fee, hire and fire janitors and
  mechanics, open or close the park, goals, what guests are saying. The HUD shows guests, ★ and money.
- **Days and nights** (asked for: it was nearly always night): nights are short (time runs 10× faster
  while the park is shut, 10 pm to 6:30 am), a sun button skips to 8 am from the evening on (on screen
  and on the VR tablet), and the menu has Nights: short / skipped / full length.
- **Track and rising ground**: track at ground level now copes with the ground rising to within 30 cm
  of the rails (on ordinary grass a 10 to 30 cm rise near a station refused the first piece; the test
  caught it on one of its random landscapes).

## Version 1.5: More rides (built)

- `flatrides.js`: five more flat rides, each built from its design and animating itself (its
  `userData.animate`), with a seat to ride from (`userData.seat`, so riding and VR work unchanged):
  - **Drop tower** (30/45/60 m): a ring of 16 seats hauled up slowly, held at the top, dropped under
    gravity, braked; lights up the column and a beacon on top.
  - **Swing ride** (14/16/20 m): the top turns and tilts, seats on chains flung out wide.
  - **Swinging ship** (12/14/18 m long): a pendulum at its natural period, swinging higher as it powers
    up; pirate ship (mast and sail), longship (shields, curled prow) or dragon boat.
  - **Teacups**: a floor turning one way, three platforms the other, nine cups spinning on their own.
  - **Scrambler**: three arms one way, clusters of four cars the other.
- **Spinning coaster**: a coaster whose cars turn by themselves while running (and straighten up in the
  station); more fun, more queasy.
- Each has a size, two colours and a speed in the designer, ratings, a price in Tycoon, a footprint
  and height that track and buildings keep clear of (`rideHeight`), and a capacity per cycle.
