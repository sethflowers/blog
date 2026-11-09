# Notes for Claude

Rules for every game and toy in this repo, learned the hard way on My Animal Farm, VR Test,
Rollercoaster Bros, Safari Cruise and the others. Follow them unless the user says otherwise for a
particular game.

## Where things go

- Games and toys live in `_experiments/` (one self-contained HTML file each) with their assets in
  `experiments/<name>/`. See the README for the layout, and `_plans/` for each game's design notes.
- `_tools/` holds build scripts and headless tests (Jekyll ignores underscore folders).
- Write the design notes in `_plans/<name>.md` as you go, with a section per version saying what
  changed and why (especially what was broken and how it was fixed).

## Versions and caching

- Every experiment has a `version:` in its front matter, shown on its title screen through the
  `build-version` tag. **Bump it on every change to a game** (1.4 → 1.5 for an update, 1.x → 2.0 for a
  big one) so the user can tell when an update has reached their device. New experiments start at 1.0
  and must show the version somewhere on their title screen (and somewhere visible in VR).
- If a game has a service worker, also bump its `CACHE` name when its asset list changes (a new file,
  a file removed).
- Every script URL carries the version (`main.js?v=1.5`), and the import map gives every module and
  three.js the same `?v=`, so a new page can never run old cached code. The service worker serves the
  network first and only falls back to its store when the network fails.

## Every new game: one page, iPad and VR

Unless the user says otherwise, a new game is a **PWA that plays on an iPad (touch) and in a VR headset
(WebXR, e.g. a Quest's browser) from the same page**, and with a mouse and keyboard on a computer.
Copy the shape of `my-animal-farm`, `rollercoaster-bros` or `safari-cruise`:

- `_experiments/<name>.html`: front matter, the title screen (Play, Play in VR, New game, the version),
  the HUD, the import map, service-worker registration. iOS meta tags: `viewport-fit=cover,
  user-scalable=no`, `apple-mobile-web-app-capable`, status bar style, `apple-touch-icon`. Respect
  `env(safe-area-inset-*)`. `touch-action: none` on the canvas.
- `experiments/<name>/`: `manifest.json` (standalone, landscape), `icon-192.png`, `icon-512.png`,
  `apple-touch-icon.png` (rendered from the game itself), `sw.js`, `js/` (ES modules), `lib/` (a local
  copy of three.js; no CDN, so it works offline).
- **It must work offline** (an iPad from the home screen, a headset with no Wi-Fi) once it has been
  opened online, and never show a "needs the network" message. Copy `my-animal-farm`'s `sw.js` and its
  registration:
  - register the service worker at the very top of the page as `sw.js?v=<version>`, not on `load`
    (a big 3D game takes a while to load on an iPad, and closing it before `load` left nothing saved,
    so the next offline start showed Safari's "not connected to the internet" page);
  - on install save the page and every file of that version under exactly the addresses the page asks
    for (`?v=<version>`), into a cache named after the version, then a "ready" marker;
  - serve versioned files from the cache first (fast, and a bad connection can't hang the start) and
    the page from the network first with a 3-second fallback to the saved copy;
  - no CDN fonts, scripts or images: everything is in the game's folder or generated;
  - when running from the home screen, call `navigator.storage.persist()` so iOS keeps the copy;
  - show "✓ Saved on this device: plays offline" on the title screen once the marker is there.
  - Check it with `NODE_PATH=$(npm root -g) node _tools/offline-check.mjs <name>` (opens the game
    online for 8 seconds, closes it, then starts it with the network off).
 `navigator.xr.isSessionSupported('immersive-vr')` says yes. Use the
  `local-floor` reference space; ask for 72 Hz on a Quest.
- One description of each menu or panel, drawn two ways: HTML on screen, a canvas texture in VR (point
  and pull the trigger). Never write a feature that only works on one of them.
- Wrap each frame in try/catch: an exception inside the WebXR frame loop otherwise stops the game for
  good.

### Touch input (iPad)

- Pointer events, not touch or mouse events. A thumb stick on the left, drag anywhere else to look,
  tap to use. Big HTML buttons for every action (nothing that needs hover, a right-click or a keyboard).
- Input must never get stuck. A new touch in the stick zone always takes the stick over, even if an
  old touch never ended; handle `pointercancel`, `lostpointercapture` and window-level `pointerup`; on
  `blur` or `visibilitychange` forget every touch and key. "I can look around but can't move" was this.

### VR

- **Grip space** (where the hands go): the controller handle runs along Z through the origin (-Z is
  the index/thumb end), +X is to the right. A glove's palm sits on the outside of the handle, the
  fingers curl in under it, the thumb rests on top. Fingers curling the other way look like backwards
  hands. Aim things (guns, pointers) along the target-ray space, not the grip: the Quest grip is tilted
  about 45° from it.
- **Never place anything in front of the head before the headset has reported a head pose.** A panel
  opened as the session starts lands under the floor or behind you. Place it on the first frame with a
  real pose, bring it back in front of you if you turn away from it, and let B/Y close it. If the game
  pauses while a panel is open, the panel must be visible and closable, or the player is stuck.
- Only tall things (walls) stop your real head; low things (tables, fences) only stop the stick.
- Teleport-free smooth locomotion on the left stick, snap or smooth turning on the right (a setting).
- Show the version and key status somewhere you can see in VR (a sign, a wrist watch).

## Memory

A headset has far less memory than a computer, and the browser kills the page when it runs out
(that is what "the game crashed after a while" was on My Animal Farm).

- **Free what you throw away.** Removing a mesh from the scene does not free it. When something goes
  for good (a visitor leaves, an animal is sold, a flake of hay is eaten, a level is torn down) dispose
  its geometries (`disposeTree` in `my-animal-farm/js/util.js` is the pattern; it frees shapes, not the
  shared cached materials and textures).
- **Share instead of rebuilding.** Things made over and over (eggs, droppings, rosettes, bullets)
  share one geometry and one material, created once. Rebuild a mesh only when its shape changes.
- Cache materials and textures by name (`mat(name, opts)`), create canvas textures once and redraw
  into them, and keep generated textures at 512 px unless something really needs more.
- Add a test that churns whatever comes and goes (visitors, items, levels) and checks that
  `renderer.info.memory.geometries` and `.textures` stay flat.

## Performance

Aim for a steady 72 fps on a Quest 2 and 60 fps on an iPad.

- Merge everything static into one mesh per material (a `Batch` helper), use `InstancedMesh` for
  repeated things (trees, grass, crowds, fences, blocks), and keep draw calls in the low hundreds. Use
  `renderer.info.render.calls` and `.triangles` to check.
- Few lights: a sun, a sky/hemisphere light, and only a handful of point lights (their count is baked
  into every shader). Shadow maps at 1024 in VR, and only on things that need them.
- Nothing heavy every frame: no per-frame raycasts against detailed models (throttle pointing to about
  20 Hz, or test simple proxies), no allocating vectors in hot loops, no rebuilding DOM every frame
  (the HUD only redraws what changed; redrawing it replayed its animations and made messages flicker).
- Simulate in game time, not real time, so the game can be stepped faster for tests.

## Looks

- Look at it. Take screenshots from the angles a player will see (close up, side on, front on) after
  every visual change, and fix what looks wrong before showing the user.
- Lofted/swept shapes: check the winding (normals pointing out) and cap the ends; inside-out faces look
  see-through. Don't paper over it with `DoubleSide`.
- Markings (spots, patches, stripes) go on the surface: vertex colours or a texture, not separate blobs
  that poke out of the body.
- Give each animal or object the features that make it read at a glance (a dog's long muzzle and floppy
  ears are what stop it looking like a big cat). Body proportions matter more than detail.
- Signs and labels: big canvas text, high contrast, readable from where the player stands.
- Lighting at night: make sure indoor places can be lit (a light switch, lamps), and keep the night
  sky natural (scatter stars randomly in 3D, not on a grid).

## Gameplay and UI

- Explain how to do things where they happen: a short hint when you pick something up, highlight what
  can be used (rings, outlines), name things on signs, and keep a jobs list of what needs doing.
- Every action has a "how do I undo or finish this" (let go of a lead, put a tool back, close a panel),
  and it always does something visible; if it can't, say why.
- Moving things collide in a sensible order: other movable things first, walls last, so nothing pins
  the player against a wall. If the player has been pushing without moving for half a second, let them
  slip past movable things.
- Helpers (pets, staff) and boarders/customers need clear ways to interact from their own panel as
  well as from the person, the office or a menu.

## Saves

- Save to `localStorage` under a versioned key, often (hourly in game time, and on important actions).
- **Never break an old save.** When adding things, write an `upgrade()` that fills in what an older
  save lacks (new pens, new supplies, new characters), and welcome the player to what's new.

## Tests: quick, so we can iterate

Every game gets a headless test in `_tools/<name>/test.mjs` (Playwright's Chromium; VR with Meta's IWER
emulated Quest 3, installed once with `npm i --prefix _tools/vr-test iwer`). Run it and look at its
screenshots after every change.

- **The default run must be quick: under a minute or so.** Check the main things a change could break
  (it loads, the version shows, you can move, the core actions work, VR starts and a panel can be
  used, no console errors) and save a few screenshots. Put the long play-through behind `--full`.
  (Older suites like My Animal Farm's take over ten minutes; give them a quick default mode when you
  next work on them.)
- Make the game testable: expose a `window.__<game>` object with the state and the actions; a
  `noRender` switch so the test skips drawing except for screenshots; a `timeScale` (or a step
  function) so game time runs faster than real time. Call the game's own functions rather than
  simulating long walks.
- In VR, the head pose only updates when frames are drawn: turn drawing on for checks that depend on
  where the player looks. Headless frames are slow, so wait on the game clock or poll for the
  condition rather than sleeping a fixed time.
- Write a test for every bug the user reports, so it can't come back.

## Git: several sessions share this repo

Other Claude sessions work on other games in this repo at the same time and push to `master`.

- Commit on the game's own branch, then merge into `master` and push (the user asks to "merge").
- **Before committing, fetch and bring in the latest `master`.** Then stage only your game's own
  paths (`_experiments/<name>.html`, `experiments/<name>/`, `_plans/<name>.md`, `_tools/<name>/`),
  never `git add -A`, and check `git diff --stat` touches nothing else. A session working from a stale
  copy once put back old versions of two other games.
- After merging, check that the other games' files are unchanged by your merge, and confirm the Pages
  deploy (the `pages build and deployment` workflow) succeeded before saying it's live.
