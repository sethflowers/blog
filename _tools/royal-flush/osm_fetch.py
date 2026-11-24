"""Fetches all OpenStreetMap data for a park from the OSM API (api.openstreetmap.org/api/0.6/map, in a
few tiles: the Overpass servers kept timing out) and keeps it in _tools/royal-flush/osm-<park>/raw-*.osm,
so the map can be rebuilt exactly (gzipped). Map data © OpenStreetMap contributors (ODbL).

    python3 _tools/royal-flush/osm_fetch.py ep|ak [--refresh]
"""
import sys, os, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))
# south, west, north, east
BBOX = {'ep': (28.3615, -81.5585, 28.3790, -81.5410), 'ak': (28.3480, -81.6000, 28.3680, -81.5800)}
park = sys.argv[1]; refresh = '--refresh' in sys.argv
s, w, n, e = BBOX[park]; out = os.path.join(HERE, 'osm-' + park); os.makedirs(out, exist_ok=True)
N = 3
for i in range(N):
    for j in range(N):
        f = os.path.join(out, f'raw-{i}{j}.osm')
        if (os.path.exists(f) or os.path.exists(f + '.gz')) and not refresh: continue
        b = (w + (e - w) * j / N, s + (n - s) * i / N, w + (e - w) * (j + 1) / N, s + (n - s) * (i + 1) / N)
        url = 'https://api.openstreetmap.org/api/0.6/map?bbox=' + ','.join('%.5f' % v for v in b)
        for attempt in range(3):
            r = subprocess.run(['curl', '-sS', '-f', '--max-time', '180', '-A', 'royal-flush-map-builder', url, '-o', f + '.part'])
            if r.returncode == 0 and open(f + '.part', 'rb').read(200).find(b'<osm') >= 0:
                import gzip, shutil
                with open(f + '.part', 'rb') as a, gzip.open(f + '.gz', 'wb', 9) as b: shutil.copyfileobj(a, b)
                os.remove(f + '.part'); print(park, i, j, os.path.getsize(f + '.gz') // 1024, 'KB'); break
        else: print(park, i, j, 'FAILED')
