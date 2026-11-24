"""Fits the traced guide map (_tools/royal-flush/mk-trace.json, in the guide's pixels; made by trace.py) to
OpenStreetMap, and writes experiments/royal-flush/js/mk-map.js in metres (x east, y north of the game's
origin, 28.41917 -81.58111, about 37 m south of Cinderella Castle's middle).

    pip install opencv-python-headless numpy scipy shapely
    python3 _tools/royal-flush/osm_fit.py [--refresh] [--loo] [--debug DIR]

OSM data (footways, water, buildings, toilets, attractions, the railroad, the park outline) is fetched
from Overpass once and kept in _tools/royal-flush/osm/ (committed, so the fit can be repeated; --refresh
fetches it again). --loo also refits leaving each landmark out in turn (a minute more).

The guide map isn't drawn to scale (the big show buildings at the edges are pulled in, Tomorrowland's
middle is stretched), so no single formula fits it to within 20 m. Instead, a warp: an affine map plus a
smooth displacement grid (every 110 guide px, about 36 m), fitted like ICP over a few rounds:
  - every 3 m of public OSM footway inside the park should lie on a traced walkway or street;
  - every 3 m of OSM water edge (castle moat, Jungle Cruise, the lagoon shore...) on a traced water edge,
    and the riverboat's channel (OSM has no Rivers of America itself, only the channel to its lock) on water;
  - OSM building centroids matched to traced building centroids (mutual nearest, similar size);
  - 17 landmarks whose drawing on the guide is unmistakable (castle, Space Mountain's dome, Carousel of
    Progress, stations...) paired with their OSM footprints, weighted heavily.
Pairs further apart than a shrinking radius (60 m down to 12 m) are ignored, far ones weighted down.
The railroad is OSM's (the guide cuts off its northern loop). A restroom pin goes on the OSM toilet that
it and its warped guide position agree on (mutual nearest, within 45 m); otherwise the warped position.
It prints a report: landmark errors (and leave-one-out), footway cover, every restroom against OSM.
"""
import sys, os, json, math, time, subprocess
import numpy as np, cv2
import scipy.sparse as sp, scipy.sparse.linalg as spl
from scipy.spatial import cKDTree

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
CACHE = os.path.join(HERE, 'osm'); OUT = os.path.join(ROOT, 'experiments', 'royal-flush', 'js', 'mk-map.js')
args = sys.argv[1:]; REFRESH = '--refresh' in args
DBG = args[args.index('--debug') + 1] if '--debug' in args else None

# ---------- OpenStreetMap ----------
BBOX = '28.4140,-81.5870,28.4235,-81.5745'
QUERIES = {   # small pieces: the public servers time out on one big query
    'toilets': 'nwr["amenity"="toilets"]({b});',
    'attr': 'nwr["tourism"="attraction"]({b});nwr["attraction"]({b});nwr["building"]["name"]({b});nwr["railway"="station"]({b});',
    'ways': 'way["highway"]({b});',
    'water': 'way["natural"="water"]({b});relation["natural"="water"]({b});way["waterway"]({b});',
    'build': 'way["building"]({b});',
    'park': 'nwr["tourism"="theme_park"]({b});way["railway"="narrow_gauge"]({b});way["railway"="monorail"]({b});',
}
SERVERS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
           'https://overpass.kumi.systems/api/interpreter']
def osm(name):
    f = os.path.join(CACHE, name + '.json')
    if REFRESH or not os.path.exists(f):
        os.makedirs(CACHE, exist_ok=True); q = '[out:json][timeout:180];(' + QUERIES[name].format(b=BBOX) + ');out body geom;'
        for url in SERVERS:
            r = subprocess.run(['curl', '-sS', '--max-time', '200', '--data-urlencode', 'data=' + q, url, '-o', f + '.part'])
            try:
                json.load(open(f + '.part')); os.replace(f + '.part', f); print('fetched', name, 'from', url.split('/')[2]); break
            except Exception: print('  (no', name, 'from', url.split('/')[2] + ')')
        else: sys.exit('could not fetch ' + name + ' from any Overpass server')
    return json.load(open(f))['elements']

LAT0, LON0 = 28.41917, -81.58111                       # the game's origin (parks.js): keep, saved pins use it
KX = 111320 * math.cos(math.radians(LAT0)); KY = 110850  # parks.js toXY()
def xy(lat, lon): return ((lon - LON0) * KX, (lat - LAT0) * KY)
def geom(g): return np.array([xy(p['lat'], p['lon']) for p in g])
def poly_centroid(g):
    g = np.asarray(g, float); x, y = g[:, 0], g[:, 1]; x1, y1 = np.roll(x, -1), np.roll(y, -1)
    c = x * y1 - x1 * y; A = c.sum() / 2
    if abs(A) < 1e-6: return g.mean(0), 0.0
    return np.array([((x + x1) * c).sum() / (6 * A), ((y + y1) * c).sum() / (6 * A)]), abs(A)
def centre(e):
    if 'lat' in e: return np.array(xy(e['lat'], e['lon'])), 0.0
    if e['type'] == 'way':
        g = geom(e['geometry'])
        return poly_centroid(g[:-1]) if len(g) > 3 and np.allclose(g[0], g[-1]) else (g.mean(0), 0.0)
    outs = [poly_centroid(geom(m['geometry'])[:-1]) for m in e['members'] if m.get('role') == 'outer' and 'geometry' in m]
    return max(outs, key=lambda o: o[1])
def join_rings(lines, tol=0.0):
    """joins ways end to end into rings (tol: the biggest gap, in metres, to bridge)"""
    segs = [list(map(tuple, l)) for l in lines]; rings = []
    near = lambda a, b: math.dist(a, b) <= tol
    while segs:
        r = segs.pop(0)
        while not near(r[0], r[-1]) or len(r) < 4:
            for i, s in enumerate(segs):
                if near(s[0], r[-1]): r += s[1:] if s[0] == r[-1] else s; segs.pop(i); break
                if near(s[-1], r[-1]): r += s[::-1][1:] if s[-1] == r[-1] else s[::-1]; segs.pop(i); break
            else: break
        rings.append(np.array(r))
    return rings

TOILETS, ATTR, WAYS, WATER, BUILD, PARKS = (osm(k) for k in ('toilets', 'attr', 'ways', 'water', 'build', 'park'))
BYID = {e['id']: e for e in ATTR + PARKS + BUILD}
PARK = geom(next(e for e in PARKS if e.get('tags', {}).get('tourism') == 'theme_park' and e['type'] == 'way')['geometry'])
OSM_B = [geom(e['geometry']) for e in BUILD if e['type'] == 'way' and len(e.get('geometry', [])) > 3]
OSM_W = []
for e in WATER:
    if e['type'] == 'way' and e['tags'].get('natural') == 'water': OSM_W.append(geom(e['geometry']))
    elif e['type'] == 'relation':
        mem = [(m.get('role'), geom(m['geometry'])) for m in e['members'] if 'geometry' in m]
        OSM_W += join_rings([g for r, g in mem if r == 'outer']) + [g for r, g in mem if r == 'inner']
WALK = {'footway', 'pedestrian', 'steps', 'path', 'living_street'}
# boat channels (the riverboat's channel west to its lock): their middle should be on traced water
OSM_C = [geom(e['geometry']) for e in WATER if e['type'] == 'way' and e['tags'].get('waterway') == 'canal' and e['tags'].get('boat') == 'yes']
OSM_F = [geom(e['geometry']) for e in WAYS if e['tags'].get('highway') in WALK and e['tags'].get('access') not in ('private', 'no')]

# ---------- the traced map (guide px) ----------
TRACE = json.load(open(os.path.join(HERE, 'mk-trace.json')))
MW, MH = TRACE['size']
SH = {k: [[np.array(r, float) for r in s] for s in TRACE[k]] for k in ('water', 'paths', 'roads', 'sand')}
# the guide's pale east edge (past x 2780) came out as a long thin "building": leave out what is beyond it
TRACE['buildings'] = [b for b in TRACE['buildings'] if poly_centroid(np.array(b['p']))[0][0] < 2780]
BLD = [np.array(b['p'], float) for b in TRACE['buildings']]
PLACES = {k: np.array(v, float) for k, v in TRACE['places'].items()}

# rasters in metres (for scoring) and in guide px (for finding the nearest traced walkway / water edge)
X0, X1, Y0, Y1 = -650, 750, -650, 600; GW, GH = X1 - X0, Y1 - Y0
def g_px(m): m = np.asarray(m, float); return np.stack([m[:, 0] - X0, Y1 - m[:, 1]], -1)
def raster_m(rings_list, close=True):
    im = np.zeros((GH, GW), np.uint8)
    for rings in rings_list: cv2.fillPoly(im, [np.round(g_px(r) * 4).astype(np.int32) for r in rings], 255, cv2.LINE_8, 2)
    return im
PARK_M = raster_m([[PARK]])
def in_park(m, grow=0):
    mm = cv2.dilate(PARK_M, np.ones((2 * grow + 1,) * 2, np.uint8)) if grow else PARK_M
    g = np.round(g_px(np.atleast_2d(m))).astype(int); ok = (g[:, 0] >= 0) & (g[:, 0] < GW) & (g[:, 1] >= 0) & (g[:, 1] < GH)
    out = np.zeros(len(g), bool); out[ok] = mm[g[ok, 1], g[ok, 0]] > 0; return out
PX0, PY0, PW, PH = -100, -400, MW + 200, MH + 500
def raster_px(shapes):
    im = np.zeros((PH, PW), np.uint8)
    for s in shapes: cv2.fillPoly(im, [np.round((r - [PX0, PY0]) * 4).astype(np.int32) for r in s], 255, cv2.LINE_8, 2)
    return im
def nearest_field(mask):
    _, lab = cv2.distanceTransformWithLabels(255 - mask, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    ys, xs = np.nonzero(mask); tbl = np.zeros((lab.max() + 1, 2), np.float32); tbl[1:len(xs) + 1] = np.c_[xs, ys]
    return tbl[lab] + [PX0, PY0]
def lookup(field, p):
    g = np.round(np.asarray(p) - [PX0, PY0]).astype(int); g[:, 0] = g[:, 0].clip(0, PW - 1); g[:, 1] = g[:, 1].clip(0, PH - 1)
    return field[g[:, 1], g[:, 0]]
NEAR_WALK = nearest_field(raster_px(SH['paths'] + SH['roads']))
NEAR_WATER = nearest_field(raster_px(SH['water']))
NEAR_WEDGE = nearest_field(cv2.morphologyEx(raster_px(SH['water']), cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8)))
BC = np.array([poly_centroid(b)[0] for b in BLD]); BA = np.array([poly_centroid(b)[1] for b in BLD])

def sample(lines, step):
    out = []
    for l in lines:
        for a, b in zip(l[:-1], l[1:]):
            n = max(1, int(np.hypot(*(b - a)) / step)); out += [a + (b - a) * t for t in np.arange(n) / n]
    return np.array(out)
FOOT = sample(OSM_F, 3.0); FOOT = FOOT[in_park(FOOT)]
OB = [poly_centroid(b[:-1]) for b in OSM_B]; OBC = np.array([c for c, a in OB]); OBA = np.array([a for c, a in OB])
k = in_park(OBC, 15) & (OBA > 60); OBC, OBA = OBC[k], OBA[k]
WB = sample(OSM_W, 3.0); WB = WB[in_park(WB, 30)]
CANAL = sample(OSM_C, 3.0)
# landmarks: guide px (trace.py's PLACES) -> OSM footprint
ANCHORS = {'L-castle': 121516748, 'L-space': 296326395, 'L-thunder': 324922684, 'L-smallworld': 699034483, 'L-swiss': 43169685,
           'L-teacups': 296367720, 'L-dumbo': 1313879104, 'L-carrousel': 296376958, 'L-carousel': 296311178, 'L-mermaid': 296373910,
           'L-beourguest': 296374537, 'L-pooh': 296376464, 'L-philhar': 296376960, 'L-laugh': 297689299, 'S-main': 296125663,
           'S-frontier': 1351939281, 'S-fantasy': 296370643}
# more landmarks, used only to check the fit (where the guide's point and OSM's centroid may differ by design:
# a facade drawn in front of a show building, a queue canopy, a ride spread over an area)
CHECK = {'L-mansion': 41831418, 'L-pirates': 11164112405, 'L-jungle': 236952531, 'L-tiki': 266522864, 'L-country': 154916755,
         'L-tiana': 297695136, 'L-hall': 296781801, 'L-peterpan': 296377266, 'L-minetrain': 1313242613, 'L-barnstormer': 296370636,
         'L-tron': 804994339, 'L-speedway': 4003537873, 'L-astro': 3000151783, 'L-buzz': 779986016}
AK = list(ANCHORS); AP = np.array([PLACES[k] for k in AK]); AQ = np.array([centre(BYID[ANCHORS[k]])[0] for k in AK])
print(f'targets: {len(FOOT)} footway points, {len(OBC)} buildings, {len(WB)} water edge points, {len(CANAL)} boat channel points, {len(AK)} landmarks')

# ---------- the warp ----------
GS = 110; GX = np.arange(-200, MW + 301, GS); GY = np.arange(-500, MH + 201, GS); NX, NY = len(GX), len(GY)
class Warp:
    def __init__(s, aff): s.aff = aff; s.d = np.zeros((NY, NX, 2))
    def basis(s, p):
        fx = (p[:, 0] - GX[0]) / GS; fy = (p[:, 1] - GY[0]) / GS
        ix = np.clip(np.floor(fx).astype(int), 0, NX - 2); iy = np.clip(np.floor(fy).astype(int), 0, NY - 2); tx = fx - ix; ty = fy - iy
        idx = np.stack([iy * NX + ix, iy * NX + ix + 1, (iy + 1) * NX + ix, (iy + 1) * NX + ix + 1], 1)
        return idx, np.stack([(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty], 1)
    def A(s, p): return np.c_[np.ones(len(p)), p / 1000] @ s.aff
    def __call__(s, p):
        p = np.atleast_2d(np.asarray(p, float)); idx, w = s.basis(p); return s.A(p) + (s.d.reshape(-1, 2)[idx] * w[..., None]).sum(1)
    def inv(s, q):
        q = np.atleast_2d(q); M = s.aff[1:].T / 1000; p = np.linalg.solve(M, (q - s.aff[0]).T).T
        for _ in range(8): p = p + np.linalg.solve(M, (q - s(p)).T).T
        return p
def affine_fit(P, Q, w=None):
    w = np.ones(len(P)) if w is None else np.sqrt(w)
    return np.linalg.lstsq(np.c_[np.ones(len(P)), P / 1000] * w[:, None], Q * w[:, None], rcond=None)[0]
def laplacian():
    rows, cols, r = [], [], 0
    for j in range(NY):
        for i in range(NX):
            for (a, b) in (((i - 1, j), (i + 1, j)), ((i, j - 1), (i, j + 1))):
                if 0 <= a[0] and b[0] < NX and 0 <= a[1] and b[1] < NY:
                    rows += [r] * 3; cols += [a[1] * NX + a[0], j * NX + i, b[1] * NX + b[0]]; r += 1
    return sp.csr_matrix(([1, -2, 1] * r, (rows, cols)), shape=(r, NX * NY))
LAP = laplacian()
def solve(W, P, Q, wt, lam):
    idx, w = W.basis(P); n = len(P); N = NX * NY
    Ad = sp.csr_matrix((w.ravel(), (np.repeat(np.arange(n), 4), idx.ravel())), shape=(n, N)).multiply(np.sqrt(wt)[:, None])
    M = sp.vstack([Ad, LAP * math.sqrt(lam), sp.identity(N) * math.sqrt(lam * 0.002)]).tocsr(); base = W.A(P)
    for c in range(2):
        rhs = np.r_[(Q[:, c] - base[:, c]) * np.sqrt(wt), np.zeros(LAP.shape[0] + N)]
        W.d[..., c] = spl.lsqr(M, rhs, atol=1e-10, btol=1e-10, iter_lim=4000)[0].reshape(NY, NX)
def pairs(W, R, amask):
    Ps, Qs, ws = [], [], []
    for pts, field in ((FOOT, NEAR_WALK), (WB, NEAR_WEDGE), (CANAL, NEAR_WATER)):
        p = lookup(field, W.inv(pts)); ok = np.hypot(*(W(p) - pts).T) < R
        Ps.append(p[ok]); Qs.append(pts[ok]); ws.append(np.ones(ok.sum()))
    bm = W(BC); d1, j1 = cKDTree(bm).query(OBC); _, j2 = cKDTree(OBC).query(bm)
    for i, (dd, j) in enumerate(zip(d1, j1)):
        if dd < R and j2[j] == i and 0.25 < OBA[i] / (BA[j] * 0.33 ** 2) < 4: Ps.append(BC[j:j + 1]); Qs.append(OBC[i:i + 1]); ws.append([12.0])
    Ps.append(AP[amask]); Qs.append(AQ[amask]); ws.append(np.full(amask.sum(), 100.0))
    return np.vstack(Ps), np.vstack(Qs), np.concatenate(ws)
def fit(lam=10.0, drop=None):
    amask = np.array([k != drop for k in AK]); W = Warp(affine_fit(AP[amask], AQ[amask]))
    for R in (60, 45, 35, 25, 18, 14, 12):
        for _ in range(2):
            P_, Q_, w_ = pairs(W, R, amask)
            if not W.d.any(): W.aff = affine_fit(P_, Q_, w_)
            res = np.hypot(*(W(P_) - Q_).T); solve(W, P_, Q_, w_ / np.maximum(1, res / 6), lam)
    return W
t0 = time.time(); W = fit(); print(f'fitted in {time.time() - t0:.0f} s')

# ---------- report ----------
def warp_shapes(shapes): return [[W(r) for r in s] for s in shapes]
walk = cv2.dilate(raster_m(warp_shapes(SH['paths'] + SH['roads'])), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
g = np.round(g_px(FOOT)).astype(int); print(f'OSM footways inside the park on a traced walkway (4 m slack): {(walk[g[:, 1], g[:, 0]] > 0).mean():.0%}')
e = np.hypot(*(W(AP) - AQ).T)
loo = np.array([np.hypot(*(fit(drop=k)(AP[i:i + 1])[0] - AQ[i])) for i, k in enumerate(AK)]) if '--loo' in args else np.full(len(AK), np.nan)
print('landmarks (m): fitted / left out of the fit')
for k_, a, b in zip(AK, e, loo): print(f'  {k_:13s} {a:5.1f} {b:6.1f}')
print(f'  median        {np.median(e):5.1f} {np.median(loo):6.1f}')
print('other landmarks (guide point vs OSM centroid, not used in the fit; some differ by design):')
for k_, i in CHECK.items(): print(f'  {k_:13s} {np.hypot(*(W(PLACES[k_])[0] - centre(BYID[i])[0])):5.1f}')

# restrooms against the OSM toilets (nodes of one restroom block within 12 m become one)
cl = []
for t in TOILETS:
    c, _ = centre(t); tg = t.get('tags', {})
    for q in cl:
        if np.hypot(*(q['c'] - c)) < 12: q['pts'].append(c); q['ids'].append(t['type'][0] + str(t['id'])); q['c'] = np.mean(q['pts'], 0); break
    else: cl.append({'c': c, 'pts': [c], 'ids': [t['type'][0] + str(t['id'])], 'tags': tg})
cl = [q for q in cl if in_park(q['c'][None], 10)[0]]
CC = np.array([q['c'] for q in cl])
RR = ['gate', 'townsq', 'firstaid', 'terrace', 'veranda', 'pirates', 'pecos', 'tiana', 'tsi-north', 'tsi-south', 'tangled',
      'pinocchio', 'gaston', 'teacups', 'circus', 'tron', 'cosmic', 'space']
OLD = {}
if os.path.exists(OUT):
    s = open(OUT).read(); OLD = json.loads(s[s.index('{'):s.rindex('}') + 1])['places']
warped = {r: W(PLACES[r])[0] for r in RR}; near = {r: int(np.hypot(*(CC - warped[r]).T).argmin()) for r in RR}
pins, pin_src = {}, {}
print('restrooms: previous pin, warped guide symbol, nearest OSM toilet (m)')
for r in RR:
    j = near[r]; d = np.hypot(*(CC[j] - warped[r])); mutual = min((x for x in RR if near[x] == j), key=lambda x: np.hypot(*(CC[j] - warped[x]))) == r
    if mutual and d < 45: pins[r] = CC[j]; pin_src[r] = 'OSM ' + '+'.join(cl[j]['ids'])
    else: pins[r] = warped[r]; pin_src[r] = 'guide (no OSM toilet)'
    was = f"{np.hypot(*(np.array(OLD[r]) - pins[r])):5.0f} m moved" if r in OLD else ''
    print(f'  {r:10s} warped->OSM {d:5.0f}   pin from {pin_src[r]:28s} {was}')
unused = [q for i, q in enumerate(cl) if i not in near.values() or not any(pin_src[r].startswith('OSM') and near[r] == i for r in RR)]
for q in unused: print(f'  OSM toilet not used: {q["c"].round()} {q["ids"]} {q["tags"]}')

# ---------- mk-map.js ----------
def rnd(pts): return [[round(float(x), 1), round(float(y), 1)] for x, y in pts]
def rings(shapes): return [[rnd(W(r)) for r in s] for s in shapes]
def simplify(pts, eps):
    return cv2.approxPolyDP(np.asarray(pts, np.float32).reshape(-1, 1, 2), eps, True).reshape(-1, 2)
# the railroad: OSM's Walt Disney World Railroad loop (the named mainline ways, joined)
rail_ways = [geom(e['geometry']) for e in PARKS if e.get('tags', {}).get('name') == 'Walt Disney World Railroad']
rail = max(join_rings(rail_ways, 12.0), key=len)     # (OSM has an 8 m gap east of Space Mountain)
gap = np.hypot(*(rail[0] - rail[-1]))
if gap > 12: sys.exit(f'the railroad loop does not close (gap {gap:.0f} m): check the OSM railroad ways')
rail = simplify(rail[:-1] if gap < 0.01 else rail, 0.8)
# the guide map's frame (where its drawing is; the game plants forest outside): its rectangle without the
# pale east strip and the bus and parking lots in the south-east, warped, plus one 10 m inside it
def frame(inset):
    c = [(inset, inset), (2780 - inset, inset), (2780 - inset, 2350 - inset), (1950 - inset, 2350 - inset), (1950 - inset, MH - inset), (inset, MH - inset)]
    pts = []
    for a, b in zip(c, c[1:] + c[:1]):
        n = max(1, int(math.hypot(b[0] - a[0], b[1] - a[1]) / 60)); pts += [(a[0] + (b[0] - a[0]) * t / n, a[1] + (b[1] - a[1]) * t / n) for t in range(n)]
    return rnd(simplify(W(np.array(pts)), 1.0))
fr = np.array(frame(0))
trees = W(np.array([[x, y] for x, y, _ in TRACE['trees']], float))
places = {k: rnd(W(v))[0] for k, v in PLACES.items()}
for r in RR: places[r] = rnd([pins[r]])[0]

# ---------- TRON: drawn from OSM ----------
# The guide map's drawing stops at the railroad, and TRON (its queue crosses over the tracks, its show
# building and restroom are past them) is only squeezed against the guide's edge, so in 2.1 the GPS dot of
# someone in its line was in the forest. There, everything comes from OSM: the walkways and queue
# (footways 3.2 m wide, pedestrian areas as mapped), the canopy (see-through), the show building, the
# restroom building. The traced shapes are cut away (east of x 282 m) where OSM's are, and no forest grows
# within 14 m of them (`clear`).
from shapely.geometry import Polygon, LineString, Point, box as sbox
from shapely.ops import unary_union
TRON_BOX = sbox(288, 40, 520, 230)
def sh_parts(g):
    gs = [g] if g.geom_type == 'Polygon' else list(getattr(g, 'geoms', []))
    return [p for p in gs if p.geom_type == 'Polygon' and p.area > 2]
def sh_rings(p):
    p = p.simplify(0.4); return [rnd(np.array(p.exterior.coords)[:-1])] + [rnd(np.array(i.coords)[:-1]) for i in p.interiors if Polygon(i).area > 4]
walk_osm, bld_osm = [], []
for e in WAYS:
    t = e['tags']
    if t.get('highway') not in WALK or t.get('access') in ('private', 'no'): continue
    g = geom(e['geometry'])
    if not TRON_BOX.intersects(LineString(g)): continue
    closed = len(g) > 3 and np.allclose(g[0], g[-1])
    walk_osm.append(Polygon(g).buffer(0) if closed and t.get('area') == 'yes' else LineString(g).buffer(1.6, cap_style=2))
TRON_COL = next((b['c'], b['o']) for b in TRACE['buildings'] if b['c'] == '#a3a3d5')   # Tomorrowland's violet
for e in BUILD:
    if e['type'] != 'way' or e['id'] == 296326395: continue                           # (Space Mountain is traced)
    g = geom(e['geometry']); pg = Polygon(g).buffer(0)
    if pg.area < 30 or not TRON_BOX.contains(pg.centroid) or pg.centroid.x < 300: continue
    roof = e['tags'].get('building') == 'roof'
    bld_osm.append((pg, ('rgba(214,228,250,.55)', '#4f86d8', 1) if roof else (TRON_COL[0], TRON_COL[1], 0)))
EAST = sbox(282, -1000, 2000, 1000)
osm_area = unary_union(walk_osm + [p for p, _ in bld_osm])
cut = osm_area.buffer(3).intersection(EAST)
def minus(shapes):
    out = []
    for s in shapes:
        p = Polygon(s[0], s[1:]).buffer(0)
        if not p.intersects(cut): out.append([rnd(r) for r in s]); continue
        out += [sh_rings(q) for q in sh_parts(p.difference(cut))]
    return out
WS = {k: [[W(r) for r in s] for s in SH[k]] for k in SH}
cut_bld = []
for b in TRACE['buildings']:
    p = Polygon(W(np.array(b['p'], float))).buffer(0)
    for q in (sh_parts(p.difference(cut)) if p.intersects(cut) else [p]): cut_bld.append({'c': b['c'], 'o': b['o'], 'p': sh_rings(q)[0]})
tron_paths = [sh_rings(q) for q in sh_parts(unary_union(walk_osm).intersection(sbox(278, -1000, 2000, 1000)))]
tron_blds = [dict({'c': c, 'o': o, 'p': sh_rings(q)[0]}, **({'a': 1} if roof else {})) for p, (c, o, roof) in sorted(bld_osm, key=lambda x: x[1][2]) for q in sh_parts(p)]
# roofs last: the canopy over the queue is see-through
tron_blds = [b for b in tron_blds if 'a' not in b] + [b for b in tron_blds if 'a' in b]
clear = [sh_rings(q)[0] for q in sh_parts(osm_area.buffer(14).simplify(2))]
keep_tree = np.array([not cut.contains(Point(x, y)) for x, y in trees])
places['L-tron'] = rnd([centre(BYID[804994339])[0]])[0]
print(f'TRON from OSM: {len(tron_paths)} walkway shapes, {len(tron_blds)} buildings and roofs; {int((~keep_tree).sum())} traced trees and the traced shapes there cut away')
data = {
    'source': 'Layout traced from the official Magic Kingdom guide map, redrawn; fitted to OpenStreetMap '
              '(footways, water, buildings, landmarks; the railroad and restroom positions are OSM\'s). '
              'Map data (c) OpenStreetMap contributors, ODbL.',
    'bounds': {'x0': round(float(fr[:, 0].min())), 'x1': round(float(fr[:, 0].max())), 'y0': round(float(fr[:, 1].min())), 'y1': round(float(fr[:, 1].max()))},
    'frame': frame(0), 'frameIn': frame(30), 'clear': clear,
    'places': places, 'pinSource': pin_src, 'lands': {k: rnd(W(np.array(v, float))) for k, v in TRACE['lands'].items()},
    'water': minus(WS['water']), 'paths': minus(WS['paths']) + tron_paths, 'roads': minus(WS['roads']), 'sand': minus(WS['sand']),
    'buildings': cut_bld + tron_blds,
    'trees': [[round(float(x), 1), round(float(y), 1), r] for (x, y), (_, _, r), k in zip(trees, TRACE['trees'], keep_tree) if k],
    'rail': rnd(rail),
}
js = ('// Generated by _tools/royal-flush/osm_fit.py: the official Magic Kingdom guide map\'s layout (traced by trace.py,\n'
      '// redrawn in the game\'s own style), fitted to OpenStreetMap. Map data (c) OpenStreetMap contributors, ODbL.\n'
      '// Metres from the game\'s origin (parks.js), x east, y north. Polygons: [outline, ...holes].\n'
      'export default ' + json.dumps(data, separators=(',', ':')) + ';\n')
open(OUT, 'w').write(js)
print('wrote', os.path.relpath(OUT, ROOT), len(js) // 1024, 'KB; bounds', data['bounds'])
json.dump({'aff': W.aff.tolist(), 'grid': {'x': GX.tolist(), 'y': GY.tolist()}, 'd': np.round(W.d, 2).tolist()},
          open(os.path.join(HERE, 'mk-warp.json'), 'w'), separators=(',', ':'))

if DBG:   # OSM (lines) over the warped traced map (fills)
    im = np.full((GH, GW, 3), 245, np.uint8)
    im[raster_m(rings(SH['water'])) > 0] = (240, 200, 150); im[raster_m(rings(SH['paths'] + SH['roads'])) > 0] = (190, 225, 240)
    im[raster_m([[np.array(b['p'])] for b in data['buildings']]) > 0] = (170, 170, 230)
    P4 = lambda r: np.round(g_px(r) * 4).astype(np.int32)
    for r in OSM_W: cv2.polylines(im, [P4(r)], True, (160, 60, 0), 2, cv2.LINE_AA, 2)
    for b in OSM_B: cv2.polylines(im, [P4(b)], True, (0, 0, 160), 1, cv2.LINE_AA, 2)
    for l in OSM_F: cv2.polylines(im, [P4(l)], False, (0, 130, 0), 1, cv2.LINE_AA, 2)
    for l in OSM_C: cv2.polylines(im, [P4(l)], False, (160, 60, 0), 3, cv2.LINE_AA, 2)
    cv2.polylines(im, [P4(np.array(data['rail']))], True, (40, 40, 40), 2, cv2.LINE_AA, 2)
    cv2.polylines(im, [P4(fr)], True, (200, 0, 200), 1, cv2.LINE_AA, 2)
    for q in cl: cv2.circle(im, tuple(np.round(g_px(q['c'][None])[0]).astype(int)), 5, (0, 160, 255), -1)
    for r in RR: cv2.circle(im, tuple(np.round(g_px(pins[r][None])[0]).astype(int)), 4, (0, 0, 0), 2)
    os.makedirs(DBG, exist_ok=True); cv2.imwrite(os.path.join(DBG, 'osm-fit.png'), im)
