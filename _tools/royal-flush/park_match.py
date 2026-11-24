"""Matches the restroom symbols on a park's official guide map (guide-<park>-restrooms.json: their pixel
positions, found by template-matching the guide legend's restroom icons) to OpenStreetMap's toilets.
The guide is lined up with OSM by an affine fit through landmarks seen on both. Prints the table."""
import sys, math, json, os
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from osm_raw import load

PARKS = {
    'ep': {'origin': (28.375271, -81.549392), 'name': 'EPCOT', 'landmarks': [
        ((1400, 3290), 'w146221550'), ((1400, 330), 'w295592223'), ((1770, 230), 'w295587740'), ((720, 1900), 'w295598769'),
        ((690, 2380), 'w295315993'), ((2150, 2350), 'w322542375'), ((230, 1290), 'w295597521'), ((330, 520), 'w295593358'),
        ((2140, 1960), 'w295396535'), ((520, 2700), 'w295316766')]},
    'ak': {'origin': (28.357924, -81.590615), 'name': "Disney's Animal Kingdom", 'landmarks': [
        ((930, 1110), 'w295879946'), ((2050, 1450), 'w296060954'), ((660, 480), 'w295891522'),
        ((1260, 860), 'w295948751'), ((660, 1480), 'w406909874'), ((980, 2400), 'w295762779'), ((140, 1050), 'w295881759')]},
}
def setup(park):
    P = PARKS[park]; lat0, lon0 = P['origin']
    KX = 111320 * math.cos(math.radians(lat0)); KY = 110850
    xy = lambda la, lo: ((lo - lon0) * KX, (la - lat0) * KY)
    nodes, ways, rels = load(park)
    def centre(ref):
        k, i = ref[0], int(ref[1:])
        if k == 'n': return np.array(xy(*nodes[i][:2]))
        pts = np.array([xy(*nodes[n][:2]) for n in ways[i][0] if n in nodes]); return pts[:-1].mean(0) if len(pts) > 2 else pts.mean(0)
    return P, xy, nodes, ways, rels, centre
def fit(P, centre):
    G = np.array([g for g, _ in P['landmarks']], float); M = np.array([centre(r) for _, r in P['landmarks']])
    A = np.c_[G, np.ones(len(G))]; T = np.linalg.lstsq(A, M, rcond=None)[0]
    res = np.hypot(*(A @ T - M).T)
    return (lambda g: np.c_[np.asarray(g, float).reshape(-1, 2), np.ones(len(np.asarray(g).reshape(-1, 2)))] @ T), res
def park_outline(P, xy, nodes, ways, rels):
    from shapely.geometry import Polygon
    for i, (nd, t) in ways.items():
        if t.get('tourism') == 'theme_park' and t.get('name') == P['name']:
            return Polygon([xy(*nodes[n][:2]) for n in nd if n in nodes])
def toilets(xy, nodes, ways):
    out = []
    for i, (la, lo, t) in nodes.items():
        if t.get('amenity') == 'toilets': out.append(('n%d' % i, np.array(xy(la, lo)), t))
    for i, (nd, t) in ways.items():
        if t.get('amenity') == 'toilets':
            pts = np.array([xy(*nodes[n][:2]) for n in nd if n in nodes]); out.append(('w%d' % i, pts[:-1].mean(0), t))
    return out
if __name__ == '__main__':
    park = sys.argv[1]
    P, xy, nodes, ways, rels, centre = setup(park)
    warp, res = fit(P, centre)
    print('landmark residuals (m):', np.round(res, 1), 'median', round(float(np.median(res)), 1))
    from shapely.geometry import Point
    outline = park_outline(P, xy, nodes, ways, rels)
    T = [t for t in toilets(xy, nodes, ways) if outline.buffer(15).contains(Point(*t[1])) and t[2].get('access') not in ('private', 'no', 'customers')]
    print(len(T), 'public OSM toilets in the park')
    guide = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'guide-%s-restrooms.json' % park)))
    named = [(t.get('name'), np.array(xy(*nodes[i][:2]))) for i, (_, _, t) in nodes.items() if t.get('name') and ('tourism' in t or 'attraction' in t or 'amenity' in t)]
    # one-to-one: each guide restroom to a different OSM toilet, the closest pairs first
    from scipy.optimize import linear_sum_assignment
    GP = np.array([warp([g['x'], g['y']])[0] for g in guide]); TP = np.array([t[1] for t in T])
    D = np.hypot(GP[:, None, 0] - TP[None, :, 0], GP[:, None, 1] - TP[None, :, 1])
    r, c = linear_sum_assignment(np.minimum(D, 400))
    for a, b in zip(r, c): print('   assign guide %2d -> %-14s %4.0f m' % (a, T[b][0], D[a, b]))
    for k, g in enumerate(guide):
        p = warp([g['x'], g['y']])[0]
        d = sorted((float(np.hypot(*(t[1] - p))), t[0]) for t in T)
        near = min(named, key=lambda n: np.hypot(*(n[1] - p)))[0]
        print('%2d %-18s guide->(%6.0f,%6.0f)  nearest toilet %-12s %5.0f m   2nd %5.0f m   near: %s' % (k, ','.join(g['kinds']), *p, d[0][1], d[0][0], d[1][0], near))
