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
   ...your whole page...
   {% endraw %}
   ```

3. Show the version on the title screen with `v{% endraw %}{{ page.version }}{% raw %}` (it sits inside the raw
   block, so it has to step out of it). Every existing experiment has a small `build-version` tag in a corner of
   its title screen. **Bump `version` every time the game changes**, so it's easy to tell an update has arrived
   (the service workers serve the cached copy first, so an update shows on the second open).
4. Push. It's published at `/experiments/my-thing/` and appears on `/experiments/` automatically.
