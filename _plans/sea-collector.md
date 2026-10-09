# Sea Collector

A third-person scuba game for `_experiments/`. You are a diver with a little bubble house on the
seabed. Swim out, collect shells, avoid sharks and other sea creatures, and get home before your
air runs out. Shells buy clothes and better scuba gear.

Same shape as the other experiments: one self-contained HTML file, Three.js r128 served from
`experiments/sea-collector/`, a manifest, a service worker and icons so it installs and runs offline.

## The loop

- **Air** drains every second (faster when boosting with the scooter or deep in the trench). At
  zero you lose a heart every two seconds. Air refills at home, and giant clams give 30 seconds.
- **Shells** go in your bag. They only count once you swim back through your front door, which
  banks them. Bag size is limited until you buy bigger bags.
- **Blacking out** (no hearts left) sends you home with a friendly sea turtle, but the bag spills
  and the shells you were carrying are lost. Banked shells are never lost.

## The sea

| Zone | Where | Shells | Dangers |
| --- | --- | --- | --- |
| Home Reef | around the house | sand dollars, scallops | a few jellyfish; sharks won't come near the house |
| Sandy Flats | the middle | scallops, spirals | jellyfish, urchins, a roaming shark |
| Kelp Forest | west | spirals, conches | eels in rocks, urchins |
| Shark Shoals | east | conches | three sharks |
| Shipwreck Bay | north | pearls, conches | a shark, eels, jellyfish |
| The Deep Trench | south, very dark | golden shells, pearls | big sharks, anglerfish, glowing jellyfish |

## Shop

At home, walk up to the **Wardrobe** for wetsuits, masks, fin colours and hats (cosmetic), or the
**Gear Locker** for tanks, fins (speed), bags, tough suits (hearts), a flashlight, a shell finder
for the map, a shark shield and a sea scooter. The **Shell Jar** shows your savings and the **Bed**
saves the game. Everything is kept in `localStorage` under `sea-collector-v1`.

## Notes

- One analytic `heightAt(x, z)` drives the terrain mesh and every placement and collision.
- Kelp, sea grass, coral and rocks are merged into one mesh each; one material hook adds
  caustics and a swaying vertex shader. Fish are one instanced mesh.
- The camera is a spring arm that stops short of the house, the wreck and rocks.

## Monsters, the net gun and dolphin friends

- **Monsters** (from drawings) climb out of the sand every minute or two while you're away from
  home, hunt you for about 50 seconds, then burrow back down. Only one at a time, and they won't
  come near the house.
  - **Spike Serpent** — a long purple serpent with a spiky crown. Power: shoots spikes off its
    back. Weakness: the dark — swim down into the Deep Trench and it gives up.
  - **Eye Walker** — a pale blue walker on four long legs with eyes all over. Power: its top eye
    glows red, stops aiming, then fires a laser. Weakness: very slow.
  - **Freeze Genie** — flame-orange body with a curly tail, a black head and flame hair. Power:
    throws water from his hands that freezes you in a block of ice for a couple of seconds.
  - **Scribble Muncher** — a ball of scribbles on stick legs. Power: eats dolphins (wild ones and
    friends) and grows bigger and tougher with each one. Wild dolphins flee from it.
  - **Eyeball Squid** — one huge eyeball with horns and three curly tentacles. Power: its stare
    pulls you in for a tentacle slap. Weakness: it blinks, and the pull stops.
  - **Printer Monster** — a round body with a toothy mouth, spiky legs and a 3D-printer gantry on
    its head. What it prints becomes real, but it can only print sharks (up to three, which hunt
    you for about 20 seconds) and tornadoes (up to two, which drift after you and spin you round).
    It stands still while printing, which is the time to net it.
  - **MEGA MONSTER** — every sixth monster. All of them stuck together: scribble body, eyeball
    face, laser eye on a stalk, flame hair, genie hands, walker legs, squid tentacles and a spike
    serpent tail, plus the printer on its shoulder. It takes turns with spikes, freezing water, the
    laser, the stare and printing sharks, and eats dolphins. Weakness: it's slow and hates the dark. 15 hits to beat, nets hold it for half as long,
    and it's worth 60 shells.
- **Net gun** (click, R or 🕸️): the net holds a shark, anglerfish or monster for 6 seconds (10 with
  the Big Net Gun from the Gear Locker). While it's netted, swim up and use your **knife** (E,
  click or 🔪). Sharks take 3 hits, anglerfish 2, monsters 5. Beaten creatures drop shells into your
  bag; sharks and anglerfish come back later.
- **Dolphins** roam the Sandy Flats. Give one a shell (E) and it becomes a friend for good
  (`save.friends`). Friends swim round you and bump away anything that chases you.
