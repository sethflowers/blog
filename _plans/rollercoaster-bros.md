# Rollercoaster Bros

Build your own rollercoaster, ride it, and earn money from the people who come to ride it. Plays on an
iPad (or any screen) and in VR (WebXR in a headset's browser, e.g. a Quest) from the same page.

Same shape as My Animal Farm and VR Test: one page (`_experiments/rollercoaster-bros.html`) that is
mostly the title screen and the HUD, ES modules in `experiments/rollercoaster-bros/js/`, three.js r180
in `experiments/rollercoaster-bros/lib/`, a manifest, a service worker and icons
(`_tools/rollercoaster-bros/icons.mjs` draws them). Every script address carries the version (`?v=`).

## The land (park.js)

Flat grass to the horizon, no trees. The station (a platform with a striped roof) sits in the middle,
facing north; the queue (a switchback with rails) is beside it, a path leads to the entrance gate in
the south, and riders leave down steps at the north end and walk back along the exit path. Benches,
lamps, flower beds, a "QUEUE HERE" sign and a ticket price sign that changes with the ticket.

## Track (track.js)

- The ground is a grid of 8 m tiles; heights come in 4 m levels (0 to 6). Every piece starts and ends
  on a grid point, level and upright, facing N/E/S/W, so any piece fits after any other.
- Pieces: straight; left and right turns (8 m radius); wide turns (16 m); hill up / down (one level);
  steep climb / big drop (two levels); loop-the-loop (13 m tall, swings 3.5 m sideways at the bottom so it
  misses itself); barrel roll (the track turns round the riders' hearts); jump (a kicker, a gap with no
  track, and a landing).
- Each piece is a path in its own frame (forward, right, up) plus a roll. Placed in the world it is
  sampled, given "up" by a rotation-minimising frame (so loops turn riders upside down by themselves),
  any leftover twist is spread along the piece so it ends upright, then banking and rolls are added.
  Rails, the spine and the ties are swept along it; supports go down to the ground every 5.5 m where the
  track is upright and nothing is underneath.
- Pieces can't overlap: each one marks the half-tile cells it passes over with the heights it uses, and
  a new piece is refused if it comes within 3.4 m (up or down) of track already there, or of the station
  and the queue. It can't go below the ground, above level 12 (48 m; level 6 before 1.2), or out of the park (20 tiles each way).
- The track is finished when it comes back to the station's back end at ground level, facing north.
  **Finish** searches (A*, over grid points, with what you own) for the way back and lays it one piece
  at a time. Undo takes the last piece off; Clear starts again.

## The train (train.js)

Three cars of four seats. The station launches it at the chosen speed (Slow 6, Gentle 9, Normal 12,
Fast 16, Turbo 21 m/s); after that height turns into speed and back (`v² = v0² + 2·g·0.75·(station
height − height)`, never below 3 m/s, so it always gets round), then it brakes into the station, the
riders get off, new ones get on, and it goes again (about 5 s in the station). Changing the track sends
the train straight back to the station.

Trains: Classic Red (free), Ocean Wave, Lightning, Dragon (head, wings that flap, tail, spikes), Shark
(fin and teeth), Rocket (nose cone, fins, flames that grow with speed), Rainbow, Golden King (with a
crown). Riders put their hands up on the exciting bits (fast, falling, upside down, in the air).

## Money and visitors

Start with $200 and the starter track (straights and turns: enough for a simple loop). Track packs:
wide turns $150, hills $300, big drops $800, loop $1,500, barrel roll $2,500, jump $4,000. Trains $300
to $7,000. Track paint is free.

The coaster gets a **Fun** rating (each piece's fun, variety, height, speed, length) and a **Scary**
rating (speed, inversions, jumps, drops, tight turns at speed). Ticket = $2 + 2 × Fun. More fun brings
people faster (a group every 1 to 6 seconds). Over Scary 7, some people get to the queue, say "Too
scary for me!" and leave. People walk in from the gate, queue, board, ride, get off, sometimes say what
they thought, and walk out.

## Playing it two ways (main.js, ui.js)

- **Screen**: the camera orbits the end of the track while you build (drag to turn, pinch / scroll to
  zoom, two fingers or WASD to move). Track pieces along the bottom (locked ones show their price and
  open the shop); on a computer, hovering shows a green or red ghost of the piece. Ride it (front seat,
  drag to look round), Watch (a camera that chases the train), Speed (with the Fun / Scary / ticket for
  each speed), Shop (track parts, trains, paint), Menu.
- **VR**: you start at giant size (9×) standing over the park like a model; B switches to normal size.
  A tablet in your left hand has the same buttons; point the right controller at it and pull the
  trigger. Left stick walks (strides when you're a giant), right stick snap-turns, A rides (the play
  space rides in the front seat, loops and all), X/Y hides the tablet.

## Version 1.1: a theme park, and saved designs

- **More coasters.** The park has seven plots side by side along a main avenue (station x = 0, ±56,
  ±112, ±168 m; empty ones have a "COASTER SITE" sign). The 🎢 Coasters panel lists them (fun,
  riders, money earned) and lets you go to one, build a new one ($1,000, then $2,500, $4,000, ...),
  rename it, or knock it down. Each coaster has its own track, train, speed, colour and name (on its
  station roof); unlocked track packs and trains are shared, so are the money and visitors. Track
  can't run into another coaster or another plot's station. Every train runs all the time; the HUD,
  palette, shop, speed and ride buttons work on the coaster you're at.
- Visitors pick a coaster (more fun ones get more people), come in through the main gate or the
  side gates at the ends of the avenue, queue at that coaster and go home again afterwards.
- **Saved designs.** "Save design" keeps a copy of a coaster's track (with its colour, train and
  speed) in a library in its own localStorage key, so it survives "Start a new park". "Build here"
  puts a design on the current coaster; if something is in the way it builds as far as it can and
  says so. A design that needs packs you haven't bought says which.
- Parks saved by 1.0 (one coaster) load as a park with that one coaster.

## Version 1.2: lots of theme parks, free build, upside-down track, taller

- **Theme parks.** "🏞 Your theme parks" on the title screen lists your parks (money or free build,
  coasters, riders): pick one to play, delete one, or build a new one. Making a park asks for its
  name (it can't be left empty; 🎲 makes one up) and how to play: **Earn it** (start with $200 and
  buy things, as before) or **Free build** (every track pack, train and new coaster is free from the
  start; the money shows as "∞ Free"). That choice is fixed for the park. The first time you press
  Play with no parks it asks you to make one. The park's name is on the entrance gate and the menu.
  Menu → "Other parks" goes back to the list.
- Storage: `rollercoaster-bros-parks` holds `{ current, list: [{ id, name, free, money, coasters,
  riders }] }` and each park's state is in `rollercoaster-bros-park-<id>`. A 1.0/1.1 save in
  `rollercoaster-bros-save` moves into a park called "My Park" the first time. Saved designs stay
  shared by every park. The demo coaster behind the title has no id and is never saved.
- **Upside down** ($3,200): 3 tiles. The track rolls half over round the riders' heart line, carries
  them along upside down over a small hump for about half its length, then rolls the rest of the way
  round. Counts as an inversion.
- **Height limit** is level 12 (48 m) instead of 6.

## Version 1.3: smooth slopes, real speed, hanging coasters

- **Smooth slopes.** Each hill or drop piece used to start and end flat, so several in a row made a
  staircase of bumps. Now a climb (or drop) straight after another is joined into one smooth slope:
  each slope piece is a Hermite curve whose steepness at a join is the average of the two pieces'
  (`jointGrade`); next to anything else it's flat as before. Heights at the joins are still whole
  levels, so pieces still fit on the grid. `changed()` re-shapes a piece when its neighbours change.
- **Real speed.** Speed used to be `sqrt(v0² + 2g·0.75·(station height − y))`, so a drop only gave
  back what a climb took and the train never beat its launch speed. Now `Track.speeds(v0)` runs the
  energy along the whole ride: launch at the chosen speed, gravity, a little drag, and a chain lift
  (4.5 m/s) that pulls the train up any climb it would crawl up. Climb high and drop for speed: a
  48 m drop gets to about 74 mph even at Normal. Big top speeds count for more fun (and a bit more
  scary).
- **Hanging coasters.** Coasters panel → "🦇 Make it a hanging coaster" (and back). The track is
  HANG = 2.5 m higher, with its spine on top; the cars hang under it from a bogie, with no floor.
  Supports stand beside the track and reach over the top. Occupancy counts the space under the track
  as the train's. Saved designs remember it. Switching rebuilds the track as far as it fits.

## Testing

`_tools/rollercoaster-bros/test.mjs` plays it in headless Chromium (and in VR with IWER's emulated
Quest 3, installed with `npm i --prefix _tools/vr-test iwer`) and saves screenshots. About 5 minutes.

## Ideas for later

- More rides (a second coaster, a log flume), food stalls, a bigger park to buy.
- Chain lift hills and launch boosters, a helix, a corkscrew, tunnels.
- Two players: brothers building one coaster together.
- Sharing designs between devices (a code to type in).
