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
   External scripts from a CDN are fine. Any extra local assets can go in a folder like `experiments-assets/my-thing/`
   and be referenced with absolute paths (`/experiments-assets/my-thing/foo.png`).
2. Add front matter at the very top, and wrap the rest of the file in `{% raw %}` / `{% endraw %}` so Jekyll
   doesn't try to interpret `{{ }}` or `{% %}` inside the page's JavaScript or CSS:

   ```
   ---
   title: My Thing
   description: One sentence shown on the experiments list.
   date: 2026-01-01
   layout: null
   ---
   {% raw %}
   <!DOCTYPE html>
   ...your whole page...
   {% endraw %}
   ```

3. Push. It's published at `/experiments/my-thing/` and appears on `/experiments/` automatically.
