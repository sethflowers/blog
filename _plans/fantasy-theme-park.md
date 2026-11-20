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
2. **1.1: Buildings.** The building kit, templates per theme, stalls and carts with menus,
   restaurants with seating, bathrooms, other facilities, interiors, blueprint library.
3. **1.2: First rides.** The Ride Workshop, coasters (all of Rollercoaster Bros's track, drawing and
   trains, plus wooden and mine-train types), carousel and big wheel; ride them on screen and in VR.
4. **1.3: Opening day.** Guests (cars, parking, needs, queues, food, bathrooms, thoughts), the
   crowd at three levels of detail, Tycoon mode, money, finances, rating, unlocks, staff,
   breakdowns.
5. **1.4: More rides.** Drop tower, swing ride, swinging ship, teacups, scrambler, spinning coaster.
6. **1.5: Water and track rides.** Log flume, boats, park railway, dark ride, go-karts.
7. **2.0: Showtime.** Weather, fireworks and night shows (a simple show editor), land music, the
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

## 14. Decisions to confirm

- **Realistic people** add about 1 MB a person to the offline download (18 people ≈ 19 MB, as in
  MSB). Worth it for the look; the first open takes longer on a slow connection.
- **Music** made in code (no audio files) keeps it small and offline, but it won't sound like a
  recorded theme park soundtrack.
- **Order**: building before guests (milestones 1 to 3) means the first versions are a sandbox to
  build and explore in; the park comes alive at 1.3. The other order gets guests in sooner but
  with stock-looking placeholders.
