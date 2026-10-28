"""Rewrites the asset list in experiments/undercroft/sw.js from what is actually in the folder, and bumps
the cache name if the list changed (so phones and iPads pick up the new files).

    python3 _tools/undercroft/update_sw.py
"""
import os
import re

ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'experiments', 'undercroft')
SW = os.path.join(ROOT, 'sw.js')
SKIP = {'sw.js', 'LICENSE'}

files = []
for d, _, names in os.walk(ROOT):
    for n in names:
        if n in SKIP or n.startswith('.'):
            continue
        files.append(os.path.relpath(os.path.join(d, n), ROOT).replace(os.sep, '/'))
files.sort(key=lambda f: (f.count('/'), f))

src = open(SW).read()
listing = 'var ASSETS = [\n  BASE,\n' + ',\n'.join("  BASE + '%s'" % f for f in files) + '\n];'
old = re.search(r'var ASSETS = \[.*?\];', src, re.S).group(0)
if old != listing:
    src = src.replace(old, listing)
    m = re.search(r"var CACHE = 'undercroft-v(\d+)';", src)
    src = src.replace(m.group(0), "var CACHE = 'undercroft-v%d';" % (int(m.group(1)) + 1))
    open(SW, 'w').write(src)
    print('updated: %d files, cache %s' % (len(files), re.search(r"var CACHE = '([^']+)'", src).group(1)))
else:
    print('unchanged: %d files' % len(files))
