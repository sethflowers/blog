# Matter Quest

A study game for a science test on matter, copied in from a Claude chat artifact and added as-is.

- One self-contained page; no assets folder or service worker. Fonts come from Google Fonts with system fallbacks.
- Home screen: a star meter, a cheat sheet, and a grid of mini-games (vocab, atoms, atom math, states of
  matter, properties, formulas, physical vs. chemical change, and a boss round mixing them). Each awards up
  to 3 stars, saved in `localStorage` (`mq-best`).
- Questions are generated fresh each round from the content tables at the top of the script.
