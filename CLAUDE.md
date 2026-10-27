# Notes for Claude

- Games and toys live in `_experiments/` (one self-contained HTML file each) with their assets in
  `experiments/<name>/`. See the README for the layout, and `_plans/` for each game's design notes.
- Every experiment has a `version:` in its front matter, shown on its title screen through the
  `build-version` tag. **Bump it on every change to a game** (1.4 → 1.5 for an update, 1.x → 2.0 for a
  big one) so the user can tell when an update has reached their device. New experiments start at 1.0
  and must show the version somewhere on their title screen.
- If a game has a service worker, also bump its `CACHE` name when its asset list changes.
- `_tools/` holds build scripts and headless tests (Jekyll ignores underscore folders). The Undercroft
  (`_tools/undercroft/test.mjs`) plays itself in headless Chromium with a fake controller and saves
  screenshots: run it and look at them after every change to that game.
