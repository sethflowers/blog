# Mad Scientist

You are a mad scientist who runs an ice cream shop. Customers come in, ask for an ice cream, and you
make it: a cone, a scoop of a base flavour, and up to two ingredients from the jars on your counter.
The ingredients are mad: helium, chameleon spit, owl eye drops, beetle juice, dynamite dust... The
customer eats it on the spot, and whatever the recipe does happens to them right there: they float
up like a balloon, turn into a frog, explode (leaving their smoking shoes and a little ghost), go
bald, grow ten eyes, change colour, swell up, shrink... Sometimes it's just delicious. The same
recipe always does the same thing, and every recipe you try goes into the catalogue, so you can
look up how to give the next customer exactly what they ask for. It should be funny to look at.

One page, played on an iPad (touch), on a computer, or in a VR headset (WebXR), offline once opened.

Files: `_experiments/mad-scientist.html` (page, loading screen, title, HUD, tray), `experiments/mad-scientist/`
(`js/`, `lib/` three.js, `sw.js`, `manifest.json`, icons), `_tools/mad-scientist/` (`test.mjs`, `icons.mjs`).

## The plan (1.0)

**Where you stand.** Behind the counter of a cartoon shop: checkerboard floor, mint and pink walls, a
sign over the door ("Dr. Mad's Ice Cream Lab", "side effects may vary"), and mad science everywhere
(a Tesla coil that crackles, bubbling flasks, a big glowing vat). On the counter in front of you:
the tubs of base flavours sunk in a glass display, the cone holder, the serve bell and a bin; on the
counter's two ends, stepped racks of big labelled jars, one per ingredient (locked ones show a
padlock and their price). Customers come in the door and queue across the counter.

- On a screen the camera stands a little back so the whole counter, the jars and the customer fit;
  drag to look about, WASD / the left thumb stick walk behind the counter. Tap a tub, a jar, the bell
  or the bin in the 3D shop, *or* use the big buttons in the tray along the bottom (every action has
  one: bases, ingredients, Serve, Bin, Catalogue, Menu).
- In VR you stand at the counter: point at things with either controller and pull the trigger. The
  left stick walks (behind the counter only), the right stick turns (snap or smooth, a setting), X/Y
  opens the menu, B closes it. A board on your left wrist shows the money, the day, what's in the
  cone and the version.

**Making an ice cream.** Pick a base (vanilla, chocolate, strawberry; mint and bubblegum to buy) and
0–2 ingredients (the same one twice makes it stronger). The scoop sits in the cone in front of you
and shows what's in it: sprinkles, chunks, drizzle, bubbles, sparks, in each ingredient's colour.
Under the cone (and in the tray) it says what's in it and, if you have made that recipe before, what
it does ("📖 Known: they float away like a balloon"). Bin empties the cone. Serve (or the bell) hands
it over.

**Recipes are fixed.** `outcome(base, ingredients)` in `recipes.js` is a pure function: the same
recipe gives the same result for everyone, every time. A seeded hash of the recipe picks the details:
- no ingredients: just ice cream ("Meh, a bit plain");
- nice ingredients (rainbow sprinkles, cherries, unicorn tears): delicious;
- one mad ingredient: its own effect;
- nice + mad: usually the mad effect, sometimes (by the hash) the nice one cancels it: delicious;
- mad + mad: usually both effects at once (huge eyes *and* green), sometimes they cancel out
  (delicious), sometimes the mix is unstable (it explodes). A whole-body transformation (explode, bug,
  animal) wins over the others;
- the base flavour is part of the recipe too: vanilla+helium+owl may not do what chocolate+helium+owl does;
- doubling an ingredient makes its effect stronger (double puffer fish: they swell until they pop).
- details come from the hash as well: which colour, which animal (pig, frog, chicken, cow).

**The effects** (each is a few lines in `people.js` acting on a cartoon person made of parts, and
most can be combined): explode, turn into a bug, turn into an animal, hair falls out, change colour
(incl. rainbow), float up like a balloon, huge eyes, huge ears (flapping), lots of eyes, swell up big,
shrink tiny, long neck, long nose, breathe fire, go invisible (just eyes, hat and shoes), get zapped
(lightning, frizzy smoking hair), grow a huge beard, go bouncy, can't stop dancing, and delicious
(hearts). Each has a reaction line ("Ribbit?!", "I CAN SEE EVERYTHING", "Wheeeee!").

**Customers.** Cartoon people, mostly head: googly eyes, a round nose, assorted hair and hats, skin
and clothes colours. They walk in, queue, and the one at the counter says what they want:
- "One ice cream please!" (anything: $5, +$3 tip if it's delicious);
- "Something delicious!" ($5, +$8 tip if delicious; they're cross if something happens to them);
- once you've found an effect, some ask for one: "I've always wanted to fly!", "Make me an animal!"
  (+$15 tip if you give it to them; that's what the catalogue is for);
- they wait about 75 s (a bar on their bubble), then leave in a huff.
They eat it straight away; the effect happens; they pay (coins pop up) and leave, in whatever state
they're in (floating out along the ceiling, scuttling out as a beetle, hopping as a frog).

**Days and the shop.** Ten customers a day (more later). At the end of the day: a summary (money,
new discoveries, best reaction) and the Supply Shop, where money buys new ingredients and flavours.
Effects found are counted (x of 20) on the title, the catalogue and the menu.

**Catalogue.** Every recipe you've served, with what it did; filter by effect ("what makes them
float?"); each recipe has a "Make this" button that fills the cone with it.

**Saves.** `localStorage['mad-scientist-v1']`, after every customer and at the end of each day; an
`upgrade()` fills in anything an older save lacks.

**Look.** Toon shading (a three-step gradient), bright colours, big heads and googly eyes, squash and
stretch on every reaction, blob shadows instead of shadow maps, particles (smoke puffs, stars,
hearts, confetti, flames, bubbles, sparks, music notes) from one `Points` draw call with a sprite atlas.

**Performance and memory.** The shop is merged into one mesh per material. Every customer's parts
share geometries and cached materials (skin tones and effect colours are cached by name), so a
customer leaving frees nothing and leaks nothing; speech bubbles are a fixed pool of canvas
textures, redrawn. The test churns many customers and checks geometries and textures stay flat.

**Tests.** `_tools/mad-scientist/test.mjs`: loading screen, title and version, the welcome, making and
serving recipes, the same recipe always doing the same thing, the catalogue filling and "Make this",
requests and tips, every effect applied once (screenshots of each), a day ending and the shop, saves,
memory, draw calls, then VR: pointing at a jar and a tub with the trigger, serving with the bell,
the menu board and B closing it.

## 1.0: what was built, and what was wrong along the way

Built as planned. Files: `recipes.js` (bases, 22 ingredients, 20 effects, `outcome()`), `people.js`
(customers, the animals, the ladybird, the ghost, every effect), `world.js` (the shop, the counter,
the instanced jars with one label texture, pick boxes), `icecream.js` (cones and toppings), `fx.js`
(one-draw-call particles), `audio.js`, `ui.js` (panels, from Glue Gunner), `main.js`.
57 draw calls on the opening view.

Found while looking at the screenshots and fixed:
- **The camera stood too far back**: the back of the counter filled half the screen and the jars were
  tiny. The screen camera now stands at the counter (eye 1.85 m: the scientist is on a step, looking
  down at the counter), the jars are packed closer to the middle, and your side of the counter has
  drawers and cupboards instead of the customers' stripes.
- **Customers were short for the counter**, so they ate their cones out of sight below the counter
  top. The counter is lower (0.95 m), customers a little taller, and they hold the cone up at the mouth.
- **Shrunk customers, animals and the beetle vanished behind the counter**, and so did the ghost.
  They now hop up onto the counter (and jump down to leave); the ghost rises into view.
- **The balloon body was a flat yellow disc** and the head sank into it. The torso now inflates as a
  ball and the neck and arms move with it (`Person.shape`), also used by swelling up.
- `Person.state` was never set, so floating customers and ghosts never knew they were leaving.
- The zapped frizz covered the whole face; it sits further back now. Extra eyes were too small.
- An empty cone looked full: you saw the strawberry tub through its open top. It has an inside now.
- The skylight's trim was flush with the ceiling's top (caught by `coplanar.mjs`).
- In VR, the cone's pick box was big enough to catch rays meant for the tubs behind it.
