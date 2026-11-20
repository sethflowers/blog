# MSB (Make · Sell · Buy)

The user asked for: an art gallery you walk round in first person; a camera that uses the device's
real camera; editing the picture afterwards with nice controls; and the finished picture showing up
in your gallery as a little item you can sell or keep. Following CLAUDE.md it is also a PWA for the
iPad, a computer and a VR headset from one page, and works offline.

## The loop

- **Make**: 📷 opens the real camera full screen (`getUserMedia`, back camera first, 🔄 switches;
  code from Camera Magic, with the same plain-words explanations when the camera is blocked). The
  shutter takes a still (max 1600 px, a mirrored selfie is kept the way you saw it) and opens the
  editor. With no camera at all, "Photograph the gallery instead" renders a picture of the 3D gallery
  from where you stand, so the button always does something.
- **The editor** (`editor.js` the engine, `editor-ui.js` the controls). Seven tools:
  - ✂️ Crop: shapes (original, square, 4:3, 3:4, wide, tall), turn left/right, flip, zoom slider,
    straighten slider (±20°, scaled up so no corners show), drag the picture to move the crop, pinch to zoom.
  - 🎨 Filters: 16 looks with live thumbnails of your own picture (Vivid, Golden, Icy, Noir, Sepia,
    Vintage, Dreamy glow, Pop Art, Comic with ink lines and halftone, Sketch, Neon edges, Duotone,
    Thermal, Pixel, Painting) and a Strength slider.
  - 🎚 Adjust: ✨ Auto plus 12 sliders (brightness, contrast, saturation, warmth, tint, highlights,
    shadows, fade, vignette, grain, sharpen, soften), reset one or all.
  - ✏️ Draw: pen, marker, neon and rainbow brushes, 11 colours, size.
  - 😀 Stickers: 24 emoji; tap to add, drag to move, pinch (or sliders) to size and turn, copy, remove.
  - 🔤 Text: type, or pick a caption; 4 fonts, 4 styles (outline, shadow, banner, plain), colours,
    size; drag on the picture to move it up or down.
  - 🖼 Frame: the 3D frame it hangs in (Oak and Black to start, more in the shop) and a mat
    (white, instant-camera, black).
  - Undo/redo (60 steps), hold 👁 Before to compare, ✕ Bin it, ✓ Done.
  The edits are a description (`state`), and the picture is drawn from the untouched source every
  time (pixel work on an ImageData at about 700 px while editing, 1024 px when done), so every slider
  can be changed again in any order. Done bakes the picture, appraises it and saves it.
- **The item**: each artwork is a little card along the bottom of the screen (and in 🖼 My Art):
  hang it on a wall (nearest empty spot, or tap an empty frame and choose), take it down, mark it not
  for sale, give it a new name / rename, or sell it to the dealer for 70% of its value.
- **Appraisal** (`art.js`): stars out of 3 for colourful (Hasler & Süsstrunk colourfulness), bold
  (contrast), detail (Laplacian) and creative edits (how many kinds of edit), turned into a price.
  Names come from the picture's main colour ("Crimson Moment No. 8").
- **Sell**: visitors (a pool of 8 people made once and reused) come in from the plaza when pictures
  are up, walk round the free-standing wall and through doorways (`Gallery.route`), look at pictures,
  and when they like one (their taste: colourful, bold, detailed or creative, against its stars) they
  stand by it with a "💰 I'd pay $…" bubble and an offer card appears (Sell / ✕, 45 s). Tap a visitor
  for their panel (offer, "What do you think?"). Selling raises fame, which raises offers.
- **Buy**: the 🛒 Art Market desk by the door: paintings by made-up artists (painted from a seed by
  `paintMarket`, ten styles, so nothing to store; they can be resold), decorations (plants, benches,
  sculptures, rugs, a fountain on the plaza: more visitors, better offers; sell back for half),
  frames (White, Gold, Neon, Palace), and the east wing ($600, 8 more spots).

## The gallery

`gallery.js`: a 28 × 20 m hall with skylights, a free-standing wall in the middle, an east wing
behind a rope (opened when bought), an entrance onto a plaza with trees and hedges. 24 picture spots,
each with a track light and a soft pool of light (one shared additive texture), a dashed "＋ hang a
picture here" outline when empty, and a label beside the picture (title, artist, price or "Not for
sale"). Frames are four bars (plus moulding and rosettes for Palace), cached by size and style.
Static scenery is one `Batch`; walls, ceilings and floors don't cast shadows (the light is a nearly
overhead sun through the skylights).

## VR

The camera is in your right hand (A takes it out and puts it away), its screen shows the headset's
camera if the browser shares it (Quest browsers may), otherwise a live view of the gallery, which is
then what the trigger photographs. The editor is the same session drawn as a VR panel: tabs, filter
thumbnails, steppers instead of sliders, and the picture itself can be pointed at: hold the trigger to
draw, pull it to put a sticker down or drag one. Point and pull the trigger at frames, people and the
desk. X opens the menu, B/Y closes panels (and bins the photo in the editor). A watch on your left
wrist shows money, offers, fame and the version. Snap or smooth turning in the menu. Panels wait for a
real head pose and come back in front of you if you turn away.

## Storage

The save (`msb-v1` in localStorage) has money, fame, artworks (no pictures), frames, decorations,
the wing. Photos are JPEG blobs in IndexedDB (`msb-pictures`), so they don't fill localStorage and
survive new versions (the service worker's caches don't touch IndexedDB). `navigator.storage.persist()`
is asked for from the home screen.

## Tests

`_tools/msb/test.mjs` (about a minute): loading screen, version, no coplanar faces, walking and a wall,
the fake camera starting and the shutter opening the editor, every editor tool through its HTML
controls (and drawing/dragging with the mouse), Done → appraised artwork saved in IndexedDB, the
item strip, hanging, tapping a frame and an empty spot, a visitor's offer accepted, the dealer, the
Art Market (art, decor, frame, wing), memory flat while pictures go up and down, a reload bringing
the pictures back, then VR: the camera in hand, the trigger taking a picture, the editor panel (filter,
drawing with the trigger held, Done), Hang it, the menu, walking. `_tools/msb/icons.mjs` draws the
icons with the game's own painter.

## Versions

### 1.0
First version.

### 2.0
The user asked for: nicer editing, pinch-to-zoom in the camera, easier drawing with different brush
sizes, a selection tool to pick out an object, a much nicer-looking gallery (it was bland), more
realistic people, and a more realistic outside.

- **Camera zoom**: pinch the camera's picture (or the 1× 2× 3× 5× buttons, or the mouse wheel). When
  the camera can zoom itself (`getCapabilities().zoom`, usual on iPads and phones) it uses that, with
  `applyConstraints` calls queued so a fast pinch doesn't pile them up; otherwise the video is
  enlarged on screen and `snap()` crops the same middle part, so the photo matches what you saw. The
  page's own pinch-zoom (iOS `gesture*` events) is blocked on the camera screen. In VR the right stick
  zooms (the headset's camera, or the view of the gallery the camera photographs).
- **Looking closer in the editor**: two fingers on the picture zoom and move the *view* (not the
  picture) in every tool except Crop (crop zoom), a picked sticker (size and turn) and words (size); a
  stroke started by the first finger is taken back when the second lands. 🔍 − / ＋ / ⤢ Fit buttons and
  the mouse wheel do the same. The whole stage takes touches, so a line can start just off the picture.
- **Drawing**: 8 brushes (pen, pencil, marker, highlighter, spray, neon, rainbow, eraser), 5 size
  buttons that show the real dot size (XS–XL) plus an exact-size slider, see-through, 11 colours and a
  colour picker, and a ring on the picture showing the brush size where you're drawing (where the
  mouse is, on a computer). Strokes are drawn on their own layer, so the eraser only rubs out drawing,
  never the photo.
- **🪄 Select** (new tab): the magic wand (tap the thing: a flood fill from that spot over similar
  colours, both close to the first colour and to their neighbours, holes filled in; "How fussy"
  slider; tap more spots to add) or draw round it (lasso; draw again to add). Undo last pick, Swap
  (everything else), Clear. Then: Colour pop (the rest black and white), Blur the rest, Spotlight, Cut
  out (a new background: colours, sunset, sky, stripes, dots), Make it shine, and **Copy it as a
  sticker**: the picked part becomes a sticker you can drag, size, turn and copy. The mask is worked
  out at about 320 px on the photo before filters (cached), and scaled up smoothly, which gives it a
  soft edge. The rest of the picture is tinted blue with a gold edge round what's picked, on screen
  and on the VR panel. `render()` can now be called while it is running (the mask needs a plain
  render of the photo): its scratch canvas is per call depth (that bug would have drawn the mask's
  render over the picture being made).
- **The gallery**: polished oak parquet in chevrons (MeshStandardMaterial with a reflection of the room,
  `PMREMGenerator.fromScene` once at start), coloured feature walls (forest green west wall, navy
  free-standing wall, deep red wing), panelling under the pictures (panel, brass rail, skirting,
  stiles), a beamed ceiling round the skylights, pendant lamps, columns and a beam at the wing's
  doorway, door frames, gold "MSB GALLERY" lettering, tall bronze-framed windows onto the plaza, a
  walnut and marble art market desk. Picture spots are 10 cm shorter (1.3 m) so frames clear the rail.
  The coplanar check found the panelling's backs and the road's ends overlapping: the south wall's
  panelling is now built per wall piece, the road stops at the kerb.
- **Outside**: sandstone-block cladding with a cornice, dentils, a granite plinth and stone window
  surrounds; an entrance canopy on two columns with lights; the name in gold letters; MAKE / SELL /
  BUY banners; planters and flower beds; a granite plaza with a round inlay where the fountain goes,
  park benches, street lamps, hedges on a stone kerb; leafy trees (lumpy crowns, darker underneath,
  instanced, only those near the plaza cast shadows); the street with pavements, kerbs and road
  markings, parked cars, a row of townhouses with pitched roofs; distant hills; a sky with clouds and
  a little haze. The outside is its own group (`gallery.outside`).
- **People**: ten people built once (vertex colours, one material): a lofted body with hips, waist,
  chest and shoulders, a head with jaw, ears, nose, eyes with irises, eyebrows and mouth, hair styles
  (short, cropped, long, bob, bun, ponytail, bald, beards), trousers, dresses, jackets, long or short
  sleeves, shoes; arms and legs jointed at the elbow and knee. They walk with bending knees and
  swinging arms, shift their weight while standing, and while looking at a picture hold a pose (hands
  behind the back, a hand on the chin, arms folded) with the head turning a little.
- Tests: camera pinch and the 2× button, eight brushes and five sizes, the eraser leaving the photo
  alone, pinch-zooming the view without drawing, the magic wand, Cut out and Swap, the lasso, Colour
  pop, Copy it as a sticker, screenshots outside and of the visitors, the VR camera zoom and the magic
  wand on the VR panel. The VR part freezes the shadow map and hides the street (headless headset
  frames are slow in software rendering); the whole test takes about 1¾ minutes.

### 3.0
The user said the people looked like muppets and the environment felt very flat, and asked whether
that was three.js. It wasn't: it was how the scene was lit and made. Lambert materials lit by a
strong hemisphere light and an ambient light (every surface evenly lit from every side), no shading
where surfaces meet, smooth untextured surfaces, sunlight passing through the ceiling, and people
built from rounded tubes in bright colours.

- **Light**: filmic tone mapping (ACES, exposure 1.25); MeshStandardMaterial everywhere (`lam()` now
  makes standard materials and tones the old brightening glows down); the gallery's own light as
  `scene.environment` (a PMREM made from the gallery itself, captured twice so light bounces twice);
  a weaker sky light, a stronger warm sun. The **ceiling now has real openings for the skylights** and
  the ceiling, beams and walls cast shadows, so the sun comes in through the skylights and windows in
  bright patches instead of lighting the whole room evenly (the ceiling and beams keep a soft glow, as
  a gallery's white ceiling would). Brass, bronze and gold frames are metallic; the desk top and floor
  are glossy.
- **Surface relief**: normal maps generated from height functions (the floor's grooves and grain,
  plaster on the walls, the facade's stone joints, the plaza's paving joints).
- **Contact shadows** (a cheap stand-in for ambient occlusion): a soft dark band on the floor at the
  foot of every wall and round the free-standing wall, soft patches under the desk, the columns,
  bought decorations and every person.
- **Trees**: smooth crowns (shared vertices) instead of faceted ones.
- **People**: real rigged, textured, animated models instead of built-in shapes. Two models from
  three.js's examples (r180, `examples/models/gltf/`): *Michelle* (a Mixamo character) and a
  *Ready Player Me* man. They are third-party assets made available with three.js's examples, not
  CC0: fine for this hobby project, but check their terms before using MSB commercially. The walk,
  idle, nod and head-shake animations come from three.js's Mixamo *Xbot* model and are retargeted onto
  both people by `_tools/msb/people.mjs`, saved as `models/clips.json` (about 1 MB, compressed by the
  server), so Xbot itself isn't downloaded. Retargeting: each bone turns in world space by as much as
  Xbot's turned from its rest pose; each target bone's rest is first turned to point the way Xbot's
  does (the man's rig rests in an A-pose, Xbot's in a T-pose: without this his arms stuck out).
  Michelle's rig was exported Z-up, which a plain copy of the rotations turned on its side.
  Variety: six outfits for the man (suit, waistcoat, hat and trouser colours, skin tones) and four for
  Michelle (trouser colours), made by recolouring only the clothing's hues in their textures at start
  (512 px each). Ten people in the pool, alternating men and women. They nod when they like a picture
  or make an offer, shake their heads when they don't, and blend between walking and standing. If
  the models can't load, the 2.0 people are used. Loader and helpers copied from three.js r180
  (`lib/addons/`: GLTFLoader, BufferGeometryUtils, SkeletonUtils), all saved for offline play.

### 3.1
The user said the game froze for a second when the people first appeared, and that it was easy to
tell there were only two models (perhaps the woman's hair).

- **The freeze**: the first time a person was drawn, the graphics card compiled the shaders for
  skinned, physically based materials (and their shadow shaders) and uploaded their textures, all in
  the middle of play. Now `warmUp()` draws every person once, out of sight behind the loading screen
  (after `initTexture` and `compileAsync`), before the loading screen goes. The test checks that no new
  shader programs appear when visitors walk in.
- **18 different people** instead of two models in different clothes: avatars from **Microsoft's
  Rocketbox library** (MIT licence, github.com/microsoft/Microsoft-Rocketbox), 9 women and 9 men of
  different ages, skin tones and styles. `_tools/msb/rocketbox.mjs` downloads each avatar's FBX and
  textures (2048 px TGA, shrunk to 512 px JPEG; the hair/eyelash texture to a 96-colour PNG), loads it
  with three.js's FBXLoader in headless Chromium, gives it standard materials (hair alpha-tested,
  double-sided), retargets the walk / idle / nod / head-shake animations from Xbot onto its 3ds Max
  "Bip01" skeleton (a Mixamo → biped bone map; same world-space retargeting as 3.0), and exports a .glb
  with three.js's GLTFExporter. Two fixes made the files 3x smaller: the mesh is split into one piece
  per material (the exporter wrote every vertex once per material group, 14 times), and identical
  vertices are merged (the FBX loader gives every triangle corner its own vertex). About 0.9 MB per
  person, 16 MB in all, saved for offline play; the people list is `models/people/list.json` and
  `_tools/msb/people.json`. Michelle, the Ready Player Me man and the retargeted clips file are gone,
  and so is the outfit recolouring. Every visitor in the pool is a different person (up to 8 in the
  gallery at once).

### 3.2
The user asked for variety in how the people walk (they all walked the same), and said they held
their hands oddly: the wrists turned inward.

- **Wrists**: the hand bones copied Xbot's hand rotations, which on the Rocketbox skeleton bent the
  wrists outward with the palms turned back. The retargeter now gives each hand its own rest pose
  relative to the forearm (a straight wrist), while still using the hand's direction to line up the
  forearm (without it the forearms bent inward). Fingers keep Xbot's relaxed curl. Test: the hands'
  rotations stay at their rest pose.
- **Walking styles** (`makeStyle` / `applyStyle` in people.js): after the animation poses the body,
  each person's own style is laid on top: forward lean or upright, head tilt, arm swing from 55% to
  130% of the animation's (scaled from the arm's rest pose), slightly bent elbows, arms close in or
  held out, toes pointing out, hip sway, bounce, shoulders; while standing, a slow weight shift at
  their own rate. Rotations are about the person's own forward / right / up axes, worked out in each
  bone's parent frame. Speeds range from 0.9 to 1.4 m/s (the steps keep pace), and everyone starts at
  a random point in the walk and idle cycles, so nobody moves in step.
