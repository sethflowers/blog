# Sherlock

A murder-mystery detective game. You arrive at a dinner party in an old country house on a stormy
night with a handful of other guests. The lights go out; there is a crash; when they come back on,
one of the guests is lying dead. Nobody may leave until the detective (you) has found out who did it.
You walk round the house in first person, examine the body and the rooms, take everyone's fingerprints
and shoe prints, question them, and when you're sure, gather everyone in the drawing room and accuse
one of them. Right person: you win. Wrong person: the murderer gets away and you lose.

Same shape as the other games (see CLAUDE.md): one page, plays on an iPad (touch), in a VR headset
(WebXR) and with mouse and keyboard; offline PWA; version on the title screen.

Status: design only (nothing built yet). Open questions at the bottom.

## The setup

- **Where:** Blackwood Manor, a two-floor country house: hall, drawing room, dining room, library,
  kitchen, study, conservatory, a garage/workshop, a garden with a muddy path (good for footprints),
  and a few bedrooms upstairs. Rain on the windows, thunder, candles and lamps once the power is back.
- **Who:** 7 people besides you: 1 victim and 6 suspects. Enough that it isn't obvious, few enough to
  remember everyone. (Could scale: Easy 4 suspects, Normal 6, Hard 8.)
- **Each person has a profession** that shapes the clues they leave and what they know:

  | Profession | Trace they leave | Their thing |
  |---|---|---|
  | Baker | flour (white dust on prints, floury shoe prints) | rolling pin |
  | Mechanic | engine oil (black smudged fingerprints) | wrench |
  | Gardener | soil and grass (muddy boot prints) | garden shears, rope |
  | Painter | paint flecks (coloured prints) | palette knife, turpentine |
  | Doctor | latex gloves (no prints at all!) | medical bag, poison |
  | Chef | grease, a strong garlic smell | kitchen knife |
  | Chemist | chemical stains | a vial of poison |
  | Butler | white gloves | the keys to every room |
  | Fisherman | sand, a fishhook in the cuff | fishing line |
  | Librarian | ink stains | heavy book, letter opener |

  Each game picks a random 7 of them, with random names, faces, clothes, heights and shoe sizes, so
  no two games are the same.

- **The Coke:** there is always a bottle of Coke on a table (the dining room, a different table each
  game is fine). It's an object like any other: you can pick it up and dust it for fingerprints, and
  sometimes it matters (someone's prints on it place them in that room; in a few cases the victim's
  drink was the poison).

## How a mystery is made (so it's always solvable)

The game generates the crime first, then the clues from it, so there is always exactly one person the
evidence points to:

1. Pick the victim, the murderer, the room, the weapon and the motive (owed money, a stolen recipe,
   an inheritance, a secret...).
2. Write the true timeline: where every guest was during the blackout. The murderer was in the crime
   room; everyone else was somewhere else (and most can be confirmed by another guest or a clue).
3. Lay down the **real clues** that follow from it: the murderer's fingerprints on the weapon or the
   door handle, their shoe prints from the body to where they went, their profession's trace (flour,
   oil, mud) on or near the body, a torn button from their clothes, a witness who heard their voice.
4. Lay down **red herrings**: innocent people's prints on things they really did touch before the
   blackout (everyone held the Coke!), a second person with a motive, someone who lies about where
   they were for a harmless reason (sneaking a cake from the kitchen).
5. Check by a solver that the clues rule out every innocent person and leave only the murderer; if
   not, add a clue. Difficulty sets how many clues you need to put together.

## What you do

- **Examine the body:** cause (hit, stabbed, poisoned, strangled), time of death from the clock that
  stopped when it fell, things in the victim's pockets (a note, a key).
- **Fingerprints:** pick up the dusting kit, brush an object (weapon, door handle, glass, the Coke),
  lift the print onto a card. Take each suspect's prints on the fingerprint card (ink pad). Matching
  is a small puzzle: compare the pattern (loop, whorl, arch) and a couple of marked details side by
  side; partial or smudged prints only narrow it down. Glove-wearers (doctor, butler) leave none,
  which is itself a clue.
- **Footprints:** in the mud, flour, spilled drink or blood-free "dark stains" (to keep it family
  friendly). Measure the size and look at the tread (boots, trainers, heels, smooth soles); follow the
  trail. Compare with each suspect's shoes.
- **Trace evidence:** a magnifying glass shows flour, oil, soil, paint, ink, chemicals, hairs (colour)
  and fibres (matching someone's clothes).
- **Question people:** each suspect has a panel: who they are, their job, where they say they were,
  what they heard and saw, how they knew the victim. Show them a clue ("why is there oil on the
  door handle?") and they react; liars change their story when caught.
- **The notebook:** everything you've found is kept automatically: clues, prints, statements, a
  map of who says they were where, and a suspect board where you can cross people off (a guess you
  can change, not the accusation).
- **Accuse:** gather everyone in the drawing room (a button, or ring the dinner gong), point at one
  person and say "It was you!". An "Are you sure?" check, then the reveal: a short scene where they
  confess (or protest their innocence), and the true story told back with the clues that proved it, so
  even a loss teaches you what you missed. Then play again with a new mystery.
- **Score:** win or lose, plus a rank (time taken, clues found, how many wrong crossings-out).

## On iPad, computer and VR

- iPad: stick on the left to walk, drag to look, tap things to examine them; big buttons for
  Dust, Magnify, Measure, Notebook, Talk, Accuse.
- VR: walk with the left stick, pick things up with your hands, hold the magnifying glass up to them,
  brush prints with the brush in your hand, the notebook on your wrist. Same panels drawn as
  canvas textures in VR.
- Saves the current mystery so you can stop and come back.

## Open questions

- Setting: country manor (planned), or a train, a ship, a hotel?
- How many suspects, and should there be a difficulty choice?
- Who's it for (age)? Sets how dark the crime is and how hard the puzzles are.
- One lost accusation ends the game (planned, as asked), or one or two warnings first on Easy?
