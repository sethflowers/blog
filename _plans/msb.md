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
