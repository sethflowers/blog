# Implementation plan: Magical Imagineer

A colour-then-fight game for `_experiments/`. You pick a character out of a storybook, colour it
in, and the colouring is scored. Score well enough and the character becomes a **figure** in your
collection — painted in *your* colours, not the reference ones. Figures are the roster for a
side-on fighting game against the villains who drained the colour out of the book.

Same shape as the other experiments: one self-contained HTML file in `_experiments/`, support
files in `experiments/magical-imagineer/`, installable as an offline PWA. Unlike the others there
is no Three.js — everything is 2D canvas, which keeps the file small and the art scalable.

---

## 0. Ground rules

- One file: `_experiments/magical-imagineer.html` (~2,970 lines). Jekyll front matter at the top, then everything
  wrapped in `{% raw %}` / `{% endraw %}`.
- Support files in `experiments/magical-imagineer/`: `manifest.json`, `sw.js`, `icon-192.png`,
  `icon-512.png`, `apple-touch-icon.png`. Icons are drawn offline by a throwaway script, not
  downloaded.
- Plain ES5-flavoured JavaScript in one `(function(){"use strict"; ... })();`. No build step, no
  modules, no CDN, no downloaded art. Every pixel is drawn at runtime from shape data.
- Mobile first: everything is touchable, safe-area insets respected, `devicePixelRatio` capped
  at 2.
- Never put a model name or model identifier in any file, commit message or comment.

### On the characters

The brief said "Disney", and this site is public, so Disney's own creations are out — their
character designs are copyrighted and the names are live trademarks, and "not selling it" does not
change either of those for something published on a public website.

What *is* available is the material Disney adapted. Almost every name people associate with those
films belongs to a fairy tale or novel that is long out of copyright, so the roster is those
characters, drawn from scratch for this game:

| | source | status |
|---|---|---|
| Steamboat Willie | *Steamboat Willie*, 1928 | US public domain since 1 Jan 2024 |
| Puss in Boots | Perrault, 1697 | public domain |
| Cinderella | Perrault, 1697 | public domain |
| The Genie | *One Thousand and One Nights* | public domain |
| The Cowardly Lion | Baum, 1900 | public domain |
| Pinocchio | Collodi, 1883 | public domain |
| Bambi | Salten, 1923 | US public domain since 2022 |
| Rumpelstiltskin | Grimm, 1812 | public domain |
| The Wicked Witch of the West | Baum, 1900 | public domain |
| The Sea Witch | Andersen, 1837 | public domain |
| The Snow Queen | Andersen, 1844 | public domain |
| The Inkblot King | this game | original |

Two things the Steamboat Willie entry depends on, and the drawing has to honour: it is only the
**1928** design that is free — pie-cut eyes, bare hands rather than the later white gloves, the
deckhand's cap — and the name used is the **film's**, not the still-live trademark on the
character. Nothing in this game is traced from, or references, any later version.

Every drawing is this game's own. The framing is a colouring book belonging to an animation
studio, and the studio is you.

---

## 1. Art: shapes, not paths

Hand-writing SVG path data for twelve characters is unreadable and unmaintainable. Instead each
character is a list of **regions**, and each region is a list of **primitive shapes** unioned into
one `Path2D`:

```js
['ell', cx, cy, rx, ry, rot]   ['circ', cx, cy, r]
['rr',  x, y, w, h, r]         ['poly', [x,y, x,y, ...]]
['cap', x1,y1, x2,y2, r]       // capsule: limbs, tails, fingers
['leaf', cx,cy, rx,ry, rot]    // pointed oval: ears, petals, fins
```

A region carries `{ id, name, part, target, shapes }`:

- `target` — the colour the storybook says it should be. Drives the reference render and the
  match score.
- `part` — which rig part it belongs to (`torso`, `head`, `armF`, `armB`, `legF`, `legB`, `tail`,
  `prop`). Regions are bucketed by part and drawn in the fixed order
  `tail, armB, legB, torso, legF, armF, head, prop`; within a part, array order back to front.

`details` is a second list in the same format but with a fixed colour — eyes, pupils, mouth,
buttons, freckles. Not colourable, drawn on top of the region fills for its part.

Everything is authored in a 320 x 420 design box with the feet at y = 400 and the head around
y = 110, so one camera and one rig fit every character.

Line art is not authored at all: after the fills, every region and detail path is stroked in ink
at a width that scales with the render size. That is what gives the colouring-book look for free.

**Check:** a debug page can render all twelve characters side by side, in reference colours and
in flat white with lines only, and both read correctly.

## 2. Rig and poses

`drawCharacter(ctx, char, colours, pose, opts)` is the single renderer used by the colouring page,
the collection shelf, the battle and the icons. `pose` is a map of part → `{x, y, rot, sx, sy}`
applied around that part's pivot, plus a body-level transform (position, facing flip, squash).

Poses are computed, not keyframed:

- **idle** — slow sine bob on the torso, counter-bob on the head, arms hanging with a slight lag.
- **run** — hips and shoulders counter-rotate, legs swing on a phase-offset sine, body leans in.
- **jump / fall** — legs tucked on the way up, reaching on the way down.
- **attack** — wind-up (torso twists back, arm cocks), then a fast swing with the body lunging
  forward and a smear arc drawn behind the hand.
- **block** — crouch, both arms up, a shield shimmer.
- **hurt** — recoil away from the hit, head snapped back, white flash over the silhouette.
- **ko** — rotate onto the back over ~0.5s and stay there.

**Check:** cycling a character through every pose looks like the same character moving, and
nothing detaches at a pivot.

## 3. The colouring screen

Three canvases in design space, composited each frame onto the visible one:

1. `paint` — the player's paint, the only thing that persists.
2. `mask` — every region filled with a flat colour encoding its index (`r = i + 1`). Built once
   per character. Used for scoring and for the stay-in-the-lines clip.
3. `line` — the stroked line art and the fixed details, drawn over the paint.

Tools:

- **Fill** — tap a region. Hit-tested with `ctx.isPointInPath` against the region's `Path2D` in
  design space, so it is exact regardless of zoom; the path is filled into `paint`.
- **Brush** — three sizes, drag to paint. With *stay in the lines* on (the default) the stroke is
  clipped to the character silhouette, so a four-year-old cannot paint the background; region
  boundaries are still crossable, so the match score still means something.
- **Eraser**, **undo** (a ring of up to 12 `paint` snapshots), **clear**.
- A 28-swatch crayon palette plus the last six colours used.
- **Peek** — hold to see the storybook reference. Free; the difficulty is in the doing.

Two modes, chosen before you start:

- **Storybook** — match the reference.
- **Wild** — your own colours; the match term is replaced by a palette term.

**Check:** fill, brush, undo and clear all survive a rotate and a resize, and the paint never
drifts out of register with the lines.

## 4. Scoring

Sample `paint` and `mask` together on a 3px grid in design space.

- **Coverage** (40 pts in Storybook, 50 in Wild) — share of each region's area actually painted,
  averaged over regions weighted by area, with small regions given a floor so a tiny eyebrow
  cannot sink the score.
- **Colour match** (45 pts, Storybook only) — mean perceptual distance between painted pixel and
  the region's `target`, in CIE Lab, mapped through a forgiving curve: a plausibly-wrong shade of
  the right hue still scores well, a completely different hue does not.
- **Palette** (30 pts, Wild only) — rewards using more than two colours and keeping neighbouring
  regions distinguishable; punishes painting the whole character one colour.
- **Neatness** (15 pts Storybook, 20 Wild) — paint landing outside the silhouette, scaled against
  the character's area. Perfect when the stay-in-the-lines helper is on, which is the point of it.

Total 0-100 → stars: **55 = ★**, **70 = ★★**, **85 = ★★★**. Below 55 the figure does not unlock
and you are invited to keep going on the same canvas rather than starting over. Re-colouring a
character later keeps whichever attempt scored best.

The result screen animates each term counting up, shows the figure appearing on its pedestal, and
says what it is worth in a fight.

## 5. The collection

A shelf of unlocked figures, each rendered from the saved palette in an idle pose on a pedestal,
with its stars, best score and fight stats. Tap to make it the active fighter. Locked slots show
the silhouette in grey with a "colour me" prompt.

Stars carry into the fight:

| stars | health | power | sparkle rate |
|-------|--------|-------|--------------|
| ★     | 100    | 1.00  | 1.00         |
| ★★    | 120    | 1.12  | 1.16         |
| ★★★   | 140    | 1.24  | 1.32         |

Plus a sliding bonus from the raw score on top, so an 84 is meaningfully better than a 70 and a
perfect 100 tops out at 158 health and 134% power.

## 6. The fight

Side-on, one screen wide, fixed ground line, three parallax background layers themed per villain.
Both fighters are drawn by the same rig as everything else — your fighter is literally the thing
you coloured.

- **Player**: move, jump, light attack, block (hold), and a **special** once the sparkle meter is
  full. The special is a wave of your own palette that sweeps the arena.
- **Input**: held actions (move, block) and one-shot actions (attack, jump, special) are tracked
  separately. A one-shot is buffered for 240ms from the moment it is pressed, so a fast tap whose
  press and release land inside a single frame still comes out, and a press during a move you
  cannot cancel fires when that move ends.
- **Villains** are state machines with telegraphs: every attack has a wind-up frame where the
  villain flashes, which is the window to block or get out of the way. No unreactable moves.
  1. **Rumpelstiltskin** — hops, throws spindles in arcs. Teaches blocking.
  2. **The Wicked Witch of the West** — keeps her distance, throws fire, blinks away when cornered.
  3. **The Sea Witch** — slow, huge, tentacle sweeps with a long wind-up and a floor slam.
  4. **The Snow Queen** — icicle volleys and a freezing dash; the floor is ice and you slide on it.
  5. **The Inkblot King** — two phases. Drains colour out of your figure as it damages you (your
     figure desaturates as your health drops), summons blots, and in phase two the ink rises up
     the floor.

  Every villain runs off one brain with different numbers — walking speed, the distance it likes
  to hold, its melee range, how often it shoots, and how willing it is to close in and swing. A
  villain alternates between holding its ranged distance and committing to a walk-in, so it never
  hovers just outside your reach.
- Hits are rect-vs-rect against hitboxes that are only live during the swing frames; each hit
  knocks back, flashes white, and spends i-frames.
- Win and the next villain unlocks and the colour comes back into that page of the book; lose and
  you retry with no penalty.
- Controls: on-screen buttons on the left/right thumbs, and keyboard (arrows/WASD, Z/J attack,
  X/K special, C/L or Shift block, Space jump).

**Check:** a ★ figure can beat the Jester, a ★ figure cannot beat the Inkblot King, and the whole
fight holds 60fps on a phone.

## 7. Save data

One `localStorage` key, `magical-imagineer-save-v1`, holding for each character its best score,
stars, mode and the region → colour map it was scored with, plus which villains are beaten, the
active fighter, and the mute flag. Corrupt or missing data falls back to a fresh save rather than
throwing. A reset button in the settings sheet, behind a confirm.

Painted colours are stored as a region-id → hex map rather than a bitmap, so a figure re-renders
crisply at any size and the save stays a couple of kilobytes. (Brush strokes are resolved to a
per-region dominant colour at scoring time for exactly this reason.)

## 8. Audio

WebAudio, synthesised, no files: a crayon scrape that tracks brush speed, a bucket *plop*, an
undo whoosh, a three-note unlock chime that gains a note per star, and in the fight a swing
whoosh, an impact thud, a block clank, a sparkle chord for the special, and a low drone for the
Inkblot King. One master gain and a mute toggle that persists.

## 9. Screens

`title → studio (hub) → book (pick a character) → colour → score → collection → map (pick a
villain) → fight → result`, all in one `#app` with a single canvas per interactive screen and DOM
for the menus. Back is always available and never loses paint in progress.

## 10. PWA and publishing

- `manifest.json`, `sw.js` (precache the page, manifest and icons; cache name
  `magical-imagineer-v1`), three icons drawn offline.
- Front matter title **Magical Imagineer**, a one-line description, a date not in the future, and
  `layout: null`. It lists itself at `/experiments/` automatically.

**Final check:** loads clean with no console errors, plays with a keyboard and on a phone, the
colouring survives a reload, and the page still works with the network off.

---

## 11. Things the build actually caught

Worth writing down, because none of them were visible from reading the code:

- **`#arena` doubled in size every frame.** An absolutely positioned `<canvas>` with `inset:0` and
  no explicit `width`/`height` is a *replaced element with `width:auto`*, so its CSS size comes
  from its own bitmap rather than from its containing block. The draw loop read `clientWidth`,
  multiplied by `devicePixelRatio`, and wrote it back — 430px to 9600px in about four seconds, and
  the arena rendered blank. Fixed with an explicit `width:100%;height:100%`.
- **Every swing whiffed.** The villains' preferred standing distance was larger than the player's
  reach, so they parked exactly one pixel outside the hitbox and the fight could not be won. Fixed
  by giving each villain a separate melee range and a mood that makes it commit to walking in.
- **`.btrack` / `.bfill` were `<span>`s** inside a grid row, so `height` and `overflow` did
  nothing and the score bars rendered as flat dark blocks. `display:block` on both.
- **Fast taps were swallowed**, which is what led to the input buffer in section 6.
- **The Snow Queen's ice floor and the Inkblot King's stage** were both close enough to the
  foreground to lose it — the touch controls vanished against the ice, and the boss vanished
  against his own ink. The controls now have a dark fill with a light rim so they read on both.
