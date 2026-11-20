# Camera Magic

A demo of what a web page can do with an iPad's camera. It isn't a VR game: the user asked for an
iPad camera demo with "all of those things in it" (object detection, hand/face/body tracking,
cut-out, AR-style overlays, and the game ideas from the conversation). The headset gets its own
passthrough AR mode as a bonus.

## How it works

- **Camera** (`js/camera.js`): `getUserMedia` with `facingMode` (back by default, selfie on request
  or in Dress up). The `<video>` fills the screen with `object-fit: cover`; the selfie camera is
  mirrored with CSS, and every overlay maps points through `toScreen()` (cover crop + mirror), so the
  drawings line up with the picture. `useImage()` puts a still picture in the camera's place (tests).
- **Vision** (`js/vision.js`): Google's MediaPipe Tasks Vision 1.2.3 (Apache 2.0), copied into
  `lib/mediapipe/` with its five models in `models/` (about 37 MB in all) so it works offline. Each
  model loads the first time a mode needs it ("Loading the hand tracker…"), runs in VIDEO mode at its
  own rate (objects about 9 a second, hands and face every frame), GPU first with a CPU fallback
  (`?cpu` forces the CPU). The segmenter looks at a 256-px copy of the picture.
  - Object detector: EfficientDet-Lite0, the 80 COCO things (`labels.js` gives them friendly names,
    pictures and the hunt's clues).
  - Hand landmarker (21 points a hand, two hands), face landmarker (478 points plus blendshapes such
    as `jawOpen` and `eyeBlinkLeft`), pose landmarker lite (33 points), selfie segmenter.
- **Drawing**: a 2D canvas over the video for boxes, skeletons, bubbles, costumes and confetti; one
  shared, see-through three.js canvas over that for Pip, Look around and AR.

## Modes

- 🔍 **What it sees**: chips switch each model on and off; a live summary and per-model timings.
- 🧭 **Hunt**: six random clues ("Something you can drink from"); hold the camera on a match for 0.6 s
  (a ring fills). Skip, Hint (which labels count), New hunt.
- 🫧 **Bubbles**: 45-second rounds; fingertips (all five tips of both hands) or taps pop bubbles. Gold
  is worth 5, rainbow starts a frenzy. Best score saved.
- 🐾 **Pip**: a 3D critter (made in `three-layer.js`, vertex-coloured belly and cheeks) drawn with an
  orthographic camera in screen pixels. Hops onto an open hand and rides it, can be picked up with a
  pinch, otherwise sits on top of the biggest thing it sees and says what it is. Tap to tickle or send
  it somewhere, 🍓 drops a berry.
- 🎩 **Dress up**: crown, party hat, shades, clown nose, cat, moustache, drawn in a face-sized frame
  (eye corners 33/263 give size and tilt). Backdrops (space, beach, under the sea, rainbow) replace
  everything that isn't a person: the person is cut out of the camera picture with the mask
  (`destination-in`, soft edges) and drawn over a backdrop painted once at screen size. Open your
  mouth for sparkles, wink for a star.
- 🌍 **Look around**: 12 balloons all round you. The gyroscope (`deviceorientation`, permission asked
  inside the tap that opens the mode, as iOS needs) turns the 3D camera; drag to look on a computer.
  Edge arrows point to the nearest balloon. Turning only: a web page can't track walking on an iPad.
- 📸 **Photo** (any mode): video + overlay + 3D layer put together straight after a frame is drawn
  (a WebGL canvas is only readable then), shown with Save / share (share sheet on the iPad).
- 🥽 **AR (headset)**: only enabled when `isSessionSupported('immersive-ar')` (a Quest 3; iPad Safari
  has no WebXR AR). `local-floor`, 72 Hz. Bubbles float up around you: touch them with hands or
  controllers, or point and pull the trigger. Pip follows you on the floor. A wrist sign shows the
  score and version; B or Y leaves. Nothing is placed until the headset reports a head pose. The
  headset's browser can't give a page the camera picture, so there's no object spotting there.

## Limits worth knowing

- No world tracking on the iPad web (no ARKit in Safari): overlays stick to what the models find, and
  Look around only follows turning.
- The small object model gets things wrong sometimes (in the test picture it calls a poodle and a
  corgi "cat"). A bigger model (EfficientDet-Lite2) would be better and slower.
- First start downloads about 37 MB (the service worker saves it all for offline).

## Tests

`_tools/camera-magic/test.mjs` (about a minute): the loading screen (with service workers blocked:
this worker saves every file and takes the page over, so a held-back file would arrive anyway), the
title and version, Chromium's fake camera starting, then MediaPipe's sample pictures in place of the
camera: things, a hand, a face and cut-out mask, a body, a hunt clue found, bubbles popped by a
fingertip and by a tap, Pip on a hand and on a thing, Dress up with a backdrop, a photo, popping a
balloon by tapping, dragging to look, 3D memory flat while switching modes, then AR in an emulated
Quest 3: bubbles appear, a controller pops them, memory flat after 30 pops, B leaves. Runs with
`?cpu` (headless Chromium's software GPU is slow). `_tools/camera-magic/icons.mjs` renders the icons
from Pip.

## Versions

### 1.0
First version: everything above.
- Pip's inner ears first sat flush with the outer ears (stripy z-fighting) and the mouth was inside
  the body; both now stand proud of the surface.
