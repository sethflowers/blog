"""Draws a park's map from OpenStreetMap, in the same format as mk-map.js, and places its restrooms: the
restroom symbols on the park's official guide map (guide-<park>-restrooms.json, found by template-matching
the guide legend's restroom icons) lined up with OSM through landmarks (park_match.py), each put on the OSM
toilet it matches, or where the guide puts it when OSM has none there.

    python3 _tools/royal-flush/osm_fetch.py ep      (once: keeps the raw OSM data in osm-ep/, not committed)
    python3 _tools/royal-flush/osm_park.py ep|ak [--debug DIR]

Writes experiments/royal-flush/js/<park>-map.js and _tools/royal-flush/osm-<park>/features.json (the OSM
features used, so the map can be rebuilt without fetching again). Map data © OpenStreetMap contributors.
"""
import sys, os, json, math, random
import numpy as np
from shapely.geometry import Polygon, MultiPolygon, LineString, Point, box
from shapely.ops import unary_union, polygonize
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
from park_match import PARKS, setup, fit, park_outline, toilets

park = sys.argv[1]
DBG = sys.argv[sys.argv.index('--debug') + 1] if '--debug' in sys.argv else None
P, xy, nodes, ways, rels, centre = setup(park)
OUT = os.path.join(ROOT, 'experiments', 'royal-flush', 'js', park + '-map.js')

# ---------- the restrooms: guide symbol -> OSM toilet (or the guide's own place) ----------
# (guide index in guide-<park>-restrooms.json, or a guide pixel position for one the icon search missed)
PAIRS = {
    'ep': [
        ('amer', 0, 'w295589765'), ('germany', 1, 'n13686825122'), ('morocco', 3, 'n1337418395'), ('france', 4, 'w805284649'),
        ('gateway', 5, None), ('showplace', 6, 'n1332846138'), ('norway', 7, 'n565299088'), ('odyssey', 8, 'n787904186'),
        ('plaza', 9, 'w939572687'), ('imagination', 10, 'w779707909'), ('communicore', 11, 'n11998250926'),
        ('communicore-west', 12, 'w295286585'), ('discovery', 13, 'w295316204'), ('land', 14, 'n1329743806'),
        ('connections', 15, 'n13686688734'), ('se-east', 16, 'w782273955'), ('se-west', (1550, 3240), 'w782273944'),
        ('seas', 17, 'n1329743809'), ('entrance-east', 18, 'n6465316124'), ('entrance-west', 19, None),
    ],
    'ak': [
        ('conservation', 0, 'n2436713490'), ('kali', 1, 'w295948761'), ('harambe', 2, 'n2996544842'), ('asia-bridge', 3, 'w295918953'),
        ('everest', 4, 'w296052516'), ('creature', 5, None), ('lionking', 6, 'w531166598'), ('pizzafari', 7, 'n2436713504'),
        ('flametree', 8, 'w295764839'), ('theater', 9, 'w43380176'), ('satuli', 10, None), ('oasis', 11, 'n2436713508'),
        ('pandora', 12, 'w519184111'), ('gate', 13, 'n2436713496'),
    ],
}[park]
guide = json.load(open(os.path.join(HERE, 'guide-%s-restrooms.json' % park)))
warp, res = fit(P, centre)
TL = {t[0]: (t[1], t[2]) for t in toilets(xy, nodes, ways)}
places, pin_source, kinds = {}, {}, {}
for rid, g, tid in PAIRS:
    gp = (g, None) if isinstance(g, tuple) else ((guide[g]['x'], guide[g]['y']), guide[g]['kinds'])
    w = warp(list(gp[0]))[0]
    if tid:
        p = TL[tid][0]; pin_source[rid] = 'OSM ' + tid + ' (guide symbol %.0f m away)' % np.hypot(*(p - w))
    else:
        p = w; pin_source[rid] = 'guide symbol, lined up with OSM (no OSM toilet there)'
    places[rid] = [round(float(p[0]), 1), round(float(p[1]), 1)]
    kinds[rid] = gp[1] or ['rr']
print('guide fit residuals (m):', np.round(res, 1))

# ---------- geometry helpers ----------
def wpts(i): return [xy(*nodes[n][:2]) for n in ways[i][0] if n in nodes]
def way_poly(i):
    p = wpts(i)
    if len(p) < 4 or ways[i][0][0] != ways[i][0][-1]: return None
    g = Polygon(p); return g if g.is_valid else g.buffer(0)
def rel_poly(i):
    outer, inner = [], []
    for typ, ref, role in rels[i][0]:
        if typ == 'way' and ref in ways and len(wpts(ref)) > 1: (inner if role == 'inner' else outer).append(LineString(wpts(ref)))
    o = unary_union(list(polygonize(unary_union(outer)))) if outer else None
    if o is None or o.is_empty: return None
    if inner:
        ii = unary_union(list(polygonize(unary_union(inner))))
        if not ii.is_empty: o = o.difference(ii)
    return o
def polys(tagtest, also_rel=True):
    out = []
    for i, (nd, t) in ways.items():
        if tagtest(t):
            g = way_poly(i)
            if g is not None and not g.is_empty: out.append(g)
    if also_rel:
        for i, (_, t) in rels.items():
            if t.get('type') == 'multipolygon' and tagtest(t):
                g = rel_poly(i)
                if g is not None and not g.is_empty: out.append(g)
    return out

outline = park_outline(P, xy, nodes, ways, rels)
frame = outline.buffer(4).simplify(2.5)
near = frame.buffer(70)
def clip(g, region=near): return g.intersection(region)

# water
water = clip(unary_union(polys(lambda t: t.get('natural') == 'water' or t.get('water') in ('lake', 'pond', 'lagoon', 'reservoir', 'river', 'canal') or t.get('waterway') == 'riverbank' or t.get('landuse') in ('reservoir', 'basin'))))
# walkways: lines widened, plus mapped walkway areas
WIDTH = {'pedestrian': 8.0, 'footway': 3.6, 'path': 2.6, 'steps': 3.0, 'cycleway': 3.0, 'living_street': 6.0}
lines, areas = [], []
for i, (nd, t) in ways.items():
    hw = t.get('highway')
    if t.get('access') in ('private', 'no') or t.get('foot') == 'no' or t.get('tunnel') or t.get('indoor') == 'yes' or t.get('level', '0').startswith('-'): continue
    if hw in WIDTH:
        if t.get('area') == 'yes' or (hw == 'pedestrian' and nd and nd[0] == nd[-1] and t.get('area') != 'no'):
            g = way_poly(i)
            if g is not None: areas.append(g); continue
        p = wpts(i)
        if len(p) > 1:
            try: wd = float(t.get('width', '').split()[0])
            except Exception: wd = WIDTH[hw]
            lines.append(LineString(p).buffer(max(1.8, min(wd, 14)) / 2, cap_style=1, join_style=1))
for g in polys(lambda t: t.get('area:highway') in ('footway', 'pedestrian', 'path') or (t.get('highway') == 'pedestrian' and t.get('area') == 'yes') or t.get('place') == 'square'):
    areas.append(g)
paths = clip(unary_union(lines + areas), frame.buffer(20))
# service roads and tracks inside the park (the safari's dirt roads, backstage lanes)
road_lines = []
for i, (nd, t) in ways.items():
    if t.get('highway') in ('service', 'track', 'unclassified') and t.get('access') not in ('private', 'no') or (t.get('highway') == 'track'):
        p = wpts(i)
        if len(p) > 1: road_lines.append(LineString(p).buffer(3.2, cap_style=1, join_style=1))
roads = clip(unary_union(road_lines), frame).difference(paths) if road_lines else Polygon()
# savanna grass and sand
dry = clip(unary_union(polys(lambda t: t.get('natural') in ('grassland', 'scrub', 'heath') or t.get('landuse') == 'meadow')), frame)
sand = clip(unary_union(polys(lambda t: t.get('natural') in ('sand', 'beach'))), frame)
water = water.difference(paths.buffer(-0.5)) if not paths.is_empty else water   # bridges stay walkways

# ---------- lands (for colours, names and which land a restroom is in) ----------
LANDS = {
    'ep': {'celebration': ('w146221550', '#cfd6e8'), 'discovery': ('w295315993', '#e9c7cf'), 'nature': ('w322542375', '#c9e2c0'),
           'showcase': (None, '#efdcb8')},
    'ak': {'oasis': ('n2436713508', '#bfdcaa'), 'discovery': ('w295879946', '#e8d2a6'), 'pandora': ('n4836297934', '#b9d4ea'),
           'africa': ('w295891522', '#e7c39a'), 'asia': ('w296032245', '#e9b9a8')},
}[park]
# World Showcase is the ring round the lagoon: anything south of the lagoon's north shore
def land_of(p):
    x, y = p
    if park == 'ep':
        if y < -330: return 'showcase'
        if x > 40 and y < -60: return 'discovery'
        if x < -60 and y < 60: return 'nature'
        return 'celebration'
    best = None
    for k, (ref, _) in LANDS.items():
        c = centre(ref); d = math.hypot(c[0] - x, c[1] - y)
        if k == 'oasis' and y > -200: d += 150          # the Oasis is only the entrance garden
        if best is None or d < best[0]: best = (d, k)
    return best[1]
# EPCOT's pavilions each have their colour
PAVILIONS = {'w295598769': '#e8a37a', 'w295598270': '#a8805c', 'w295597521': '#e07a62', 'w295593358': '#d9a65c', 'n3096734932': '#e3b58a',
             'w295592223': '#c98a6e', 'w295587740': '#8fa0c8', 'n2993257884': '#e5c48c', 'n3096736744': '#a9b8c8', 'n2991742080': '#b9906e',
             'n2991742081': '#a87e62'} if park == 'ep' else {}
def colour_for(c, t):
    if PAVILIONS and c[1] < -330:
        k = min(PAVILIONS, key=lambda r: np.hypot(*(centre(r) - c)))
        if np.hypot(*(centre(k) - c)) < 90: return PAVILIONS[k]
    return LANDS[land_of(c)][1]

# ---------- buildings ----------
BACK = ('breakroom', 'storage', 'trailer', 'kitchen', 'cooler', 'office', 'management', 'shed', 'barn', 'warehouse', 'cast ', 'security',
        'power', 'production', 'services', 'entertainment', 'merchandise', 'receiving', 'maintenance', 'house', 'imagineering', 'dep ')
buildings = []
public_area = paths.buffer(22)
for i, (nd, t) in ways.items():
    if 'building' not in t or t.get('building') in ('no',): continue
    g = way_poly(i)
    if g is None or g.area < 12: continue
    c = np.array(g.centroid.coords[0])
    if not frame.contains(Point(*c)): continue
    name = t.get('name', '').lower()
    backstage = any(b in name for b in BACK) and 'restroom' not in name or (not g.intersects(public_area) and g.area > 250)
    roof = t.get('building') == 'roof'
    col = '#c4c0b6' if backstage else colour_for(c, t)
    h = col.lstrip('#'); r_, g_, b_ = [int(h[k:k + 2], 16) for k in (0, 2, 4)]
    out = '#%02x%02x%02x' % (int(r_ * 0.55), int(g_ * 0.55), int(b_ * 0.55))
    buildings.append({'c': col, 'o': out, 'p': [[round(a, 1), round(b, 1)] for a, b in g.simplify(0.6).exterior.coords[:-1]], **({'a': 1} if roof else {})})
buildings.sort(key=lambda b: -abs(Polygon(b['p']).area) if len(b['p']) > 2 else 0)   # big first, small on top

# ---------- trees ----------
rnd = random.Random(7); trees = []
for i, (la, lo, t) in nodes.items():
    if t.get('natural') == 'tree':
        p = xy(la, lo)
        if near.contains(Point(*p)): trees.append([round(p[0], 1), round(p[1], 1), round(3.5 + rnd.random() * 2.5, 1)])
woods = clip(unary_union(polys(lambda t: t.get('natural') in ('wood',) or t.get('landuse') == 'forest')), frame)
blocked = unary_union([paths, water, roads, unary_union([Polygon(b['p']) for b in buildings if len(b['p']) > 2]).buffer(2.5)])
minx, miny, maxx, maxy = frame.bounds
from shapely.prepared import prep
pw, pb, pf, pd = prep(woods), prep(blocked), prep(frame), prep(dry)
for y in np.arange(miny, maxy, 8.5):
    for x in np.arange(minx, maxx, 8.5):
        px, py = x + rnd.uniform(-3.5, 3.5), y + rnd.uniform(-3.5, 3.5); pt = Point(px, py)
        if not pf.contains(pt) or pb.contains(pt): continue
        dense = pw.contains(pt); savanna = pd.contains(pt)
        if rnd.random() < (0.85 if dense else 0.07 if savanna else 0.42):
            trees.append([round(px, 1), round(py, 1), round((5 if dense else 4) + rnd.random() * 3, 1)])

# ---------- railway lines (EPCOT's monorail beam, Animal Kingdom's Wildlife Express) ----------
rails = []
for i, (nd, t) in ways.items():
    if t.get('railway') in ('monorail', 'narrow_gauge', 'rail', 'light_rail') and t.get('service') not in ('yard', 'siding'):
        g = LineString(wpts(i)).intersection(frame.buffer(40))
        for seg in (getattr(g, 'geoms', None) or [g]):
            if seg.length > 15: rails.append({'k': t.get('railway'), 'p': [[round(a, 1), round(b, 1)] for a, b in seg.simplify(1).coords]})

# ---------- shapes out ----------
def rings_of(g, tol=0.6, min_area=8):
    out = []
    for p in (getattr(g, 'geoms', None) or [g]):
        if p.is_empty or p.geom_type != 'Polygon' or p.area < min_area: continue
        p = p.simplify(tol)
        if p.is_empty or p.geom_type != 'Polygon': continue
        out.append([[[round(a, 1), round(b, 1)] for a, b in p.exterior.coords[:-1]]] +
                   [[[round(a, 1), round(b, 1)] for a, b in r.coords[:-1]] for r in p.interiors if Polygon(r).area > 6])
    return out
fr = frame.simplify(3)
bx0, by0, bx1, by1 = fr.bounds
data = {
    'source': 'Drawn from OpenStreetMap (map data (c) OpenStreetMap contributors, ODbL); restrooms from the official guide map, placed on OSM toilets.',
    'bounds': {'x0': round(bx0 - 60), 'x1': round(bx1 + 60), 'y0': round(by0 - 60), 'y1': round(by1 + 60)},
    'frame': [[round(a, 1), round(b, 1)] for a, b in fr.exterior.coords[:-1]],
    'frameIn': [[round(a, 1), round(b, 1)] for a, b in max(getattr(fr.buffer(-30), 'geoms', None) or [fr.buffer(-30)], key=lambda g: g.area).simplify(3).exterior.coords[:-1]],
    'clear': [], 'places': places, 'kinds': kinds, 'pinSource': pin_source,
    'water': rings_of(water, 0.8, 30), 'paths': rings_of(paths, 0.5, 6), 'roads': rings_of(roads, 0.6, 10),
    'sand': rings_of(sand, 0.8, 20), 'dry': rings_of(dry, 1.0, 100), 'buildings': buildings, 'trees': trees, 'rail': [], 'rails': rails,
}
# landmarks and land-name spots, for parks.js
def at(ref): c = centre(ref); return [round(float(c[0]), 1), round(float(c[1]), 1)]
data['landOf'] = {k: land_of(v) for k, v in places.items()}
js = ('// Generated by _tools/royal-flush/osm_park.py from OpenStreetMap (map data (c) OpenStreetMap contributors, ODbL)\n'
      '// and the official guide map\'s restroom symbols. Metres from the park\'s origin (parks.js), x east, y north.\n'
      'export default ' + json.dumps(data, separators=(',', ':')) + ';\n')
open(OUT, 'w').write(js)
print(park, 'water', len(data['water']), 'paths', len(data['paths']), 'roads', len(data['roads']), 'dry', len(data['dry']),
      'buildings', len(buildings), 'trees', len(trees), 'rails', len(rails), '->', len(js) // 1024, 'KB')
for k in places: print('  %-18s %-14s %s' % (k, data['landOf'][k], pin_source[k]))
if DBG:
    import cv2
    S = 1.0; W = int((bx1 - bx0 + 120) * S); H = int((by1 - by0 + 120) * S)
    img = np.full((H, W, 3), (120, 190, 140), np.uint8)
    T = lambda pts: np.array([[(a - bx0 + 60) * S, (by1 + 60 - b) * S] for a, b in pts], np.int32)
    for sh in data['dry']: cv2.fillPoly(img, [T(r) for r in sh], (140, 200, 210))
    for sh in data['water']: cv2.fillPoly(img, [T(r) for r in sh], (230, 190, 110))
    for sh in data['roads']: cv2.fillPoly(img, [T(r) for r in sh], (170, 170, 170))
    for sh in data['paths']: cv2.fillPoly(img, [T(r) for r in sh], (215, 235, 250))
    for b in buildings: cv2.fillPoly(img, [T(b['p'])], tuple(int(b['c'][k:k + 2], 16) for k in (5, 3, 1)))
    for x, y, r in trees: cv2.circle(img, tuple(T([[x, y]])[0]), int(r * S), (60, 120, 70), -1)
    cv2.polylines(img, [T(data['frame'])], True, (0, 0, 0), 2)
    for k, p in places.items():
        q = tuple(T([p])[0]); cv2.circle(img, q, 7, (0, 0, 255), -1); cv2.putText(img, k, (q[0] + 8, q[1]), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 120), 1)
    cv2.imwrite(os.path.join(DBG, park + '-map.png'), img)
