In case I forget, installation steps on a new windows box, in a powershell prompt:

### Install Chocolatey

```
iwr https://chocolatey.org/install.ps1 -UseBasicParsing | iex
```

### Install ruby

```
choco install ruby -y
```

### Refresh the environment

```
refreshenv
```

### Bundle install - not sure if this is necessary

```
bundle install
```

### Serving the site

```
bundle exec jekyll s
```

## Adding a game or experiment

Standalone pages (games, toys, demos) live in `_experiments/` and are listed at `/experiments/`.

1. Save the page as a single self-contained `.html` file in `_experiments/`, e.g. `_experiments/my-thing.html`.
   Any extra files it needs (scripts, images, a PWA manifest and service worker) go in a plain folder with the same
   name, `experiments/my-thing/`, and are referenced with absolute paths (`/experiments/my-thing/foo.png`). Jekyll
   copies that folder as-is, alongside the generated page. Keep scripts local rather than on a CDN if the page
   should work offline.
2. Add front matter at the very top, and wrap the rest of the file in `{% raw %}` / `{% endraw %}` so Jekyll
   doesn't try to interpret `{{ }}` or `{% %}` inside the page's JavaScript or CSS:

   ```
   ---
   title: My Thing
   description: One sentence shown on the experiments list.
   date: 2026-01-01
   version: "1.0"
   layout: null
   ---
   {% raw %}
   <!DOCTYPE html>
   <head>
     <meta charset="utf-8">
     <meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex, noai, noimageai">
   ...your whole page...
   {% endraw %}
   ```

3. Show the version on the title screen with `v{% endraw %}{{ page.version }}{% raw %}` (it sits inside the raw
   block, so it has to step out of it). Every existing experiment has a small `build-version` tag in a corner of
   its title screen. **Bump `version` every time the game changes**, so it's easy to tell an update has arrived
   (the service workers serve the cached copy first, so an update shows on the second open).
   Keep the `robots` meta tag above in every experiment: nothing under `/experiments/` should be indexed
   by search engines or scraped by AI crawlers (`robots.txt` asks the same).
4. Push. It's published at `/experiments/my-thing/` and appears on `/experiments/` automatically.

## Tests

`_tools/` holds scripts that aren't published. `_tools/undercroft/test.mjs` plays Dungeon Strikedown (in `undercroft/`) in headless
Chromium with a fake controller and saves screenshots (`NODE_PATH=$(npm root -g) node _tools/undercroft/test.mjs out/`).
`_tools/vr-test/test.mjs` plays VR Test inside a real WebXR session with an emulated headset and controllers
(`npm i --prefix _tools/vr-test iwer` once, then `NODE_PATH=$(npm root -g) node _tools/vr-test/test.mjs out/`; about two
minutes, because it skips drawing except for screenshots and runs the game clock 4x faster).
`_tools/offline-check.mjs` checks that games start with the network off: it opens each one online for 8 seconds,
closes it, then starts it offline, and reports anything that didn't load
(`NODE_PATH=$(npm root -g) node _tools/offline-check.mjs [name ...]`; every game with a service worker if no names).
`_tools/my-animal-farm/test.mjs` plays a whole day of My Animal Farm on screen and then in VR (same IWER install; about seven
minutes): `NODE_PATH=$(npm root -g) node _tools/my-animal-farm/test.mjs out/`.
`_tools/rollercoaster-bros/test.mjs` builds, rides and shops in Rollercoaster Bros on screen and then in VR (same IWER install;
about five minutes): `NODE_PATH=$(npm root -g) node _tools/rollercoaster-bros/test.mjs out/`.
`_tools/safari-cruise/test.mjs` runs Safari Cruise (walking, visitors, trucks, every animal, jobs and staff, a breakdown, a
service, riding, driving, the shop and saving) on screen and then in VR (same IWER install; about five minutes, because it
runs the game forward inside the page instead of waiting for frames, and only draws for screenshots):
`NODE_PATH=$(npm root -g) node _tools/safari-cruise/test.mjs out/`.
`_tools/alien-hunter/test.mjs` plays Alien Hunter (walking, doors and houses, the X-ray tablet, zapping aliens and people, clearing
towns, memory, saving) on screen and then in VR (same IWER install; about a minute and a half):
`NODE_PATH=$(npm root -g) node _tools/alien-hunter/test.mjs out/`.
`_tools/fantasy-theme-park/test.mjs` builds in Fantasy Theme Park (a new park, paths, plazas, queues, a bridge over new water,
trees and scenery, shaping the land, a land with its arch, a car park, undo/redo, renaming, walking, night lights, memory,
saving and opening again) on screen and then in VR (same IWER install; about four minutes, mostly software-rendered
screenshots; `--full` adds the other landscapes): `NODE_PATH=$(npm root -g) node _tools/fantasy-theme-park/test.mjs out/`.
