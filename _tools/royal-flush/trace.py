"""Traces Magic Kingdom's layout from the official guide map (a PDF you supply; it isn't kept in the
repo) into _tools/royal-flush/mk-trace.json: water, walkways, buildings and trees as shapes in the guide
map's own pixels, plus the places of its restrooms, rides and lands. osm_fit.py then fits those pixels to
OpenStreetMap and writes experiments/royal-flush/js/mk-map.js (metres, x east, y north), so the game can
draw its own map in its own style and a GPS fix lands in the right place.

    python3 _tools/royal-flush/trace.py path/to/Magic-Kingdom-map.pdf [debug-dir]
    python3 _tools/royal-flush/osm_fit.py

Needs pdftoppm, numpy and opencv (pip install opencv-python-headless numpy).

How: page 2 of the guide map is rendered at 150 dpi and the map part kept (2901 x 2813 px). The guide's
number circles, icons and land-name boxes are painted out (inpainted from what's around them), then each
pixel is sorted by colour: water (light blue), walkway (beige), lawn and trees (green), everything else
inside the park a building. Each class becomes polygons (with holes), simplified, kept in map pixels.
"""
import sys, os, subprocess, json, tempfile
import numpy as np, cv2

PDF = sys.argv[1]
DBG = sys.argv[2] if len(sys.argv) > 2 else None
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, '_tools', 'royal-flush', 'mk-trace.json')

# ---------- the map image ----------
tmp = tempfile.mkdtemp()
subprocess.run(['pdftoppm', '-r', '150', '-f', '2', '-l', '2', '-png', PDF, os.path.join(tmp, 'p')], check=True)
page = cv2.imread(os.path.join(tmp, [f for f in os.listdir(tmp) if f.endswith('.png')][0]))
MW, MH = 2901, 2813
im = page[:MH, :MW].copy()

# ---------- paint out the guide's markers, icons and labels ----------
hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV); H, S, V = [hsv[..., i].astype(int) for i in range(3)]
erase = np.zeros((MH, MW), np.uint8)
# numbered circles (attractions, dining, shops), read off the map
MARKERS = [(233,1030),(233,963),(355,935),(415,1060),(638,1338),(245,1395),(520,1337),(540,1230),(335,1095),(793,1335),
  (1158,1050),(985,1000),(925,760),(1043,1200),(968,1268),(1075,847),(1075,998),(1247,1112),(1217,1210),(1033,780),
  (1500,737),(1450,830),(1290,740),(1282,590),(1705,522),(1998,405),(2078,462),(2352,292),(2603,445),(2577,510),(2365,585),
  (2302,465),(2055,803),(1878,968),(1915,762),(1795,658),(1652,808),(1642,903),(1497,640),(1757,436),(1810,296),(2020,510),
  (1987,900),(1772,750),(1688,762),(1500,885),(1388,778),(2345,413),(2257,1108),(2645,800),(2655,1297),(2405,1460),
  (2372,1522),(2337,1645),(2235,1535),(2035,1447),(1987,1075),(2237,1307),(2407,1328),(2540,860),(2540,1462),(2272,1458),
  (1865,1603),(2620,1232),(2172,1183),(945,1528),(725,1518),(725,1642),(643,1558),(413,1626),(1188,1427),(1115,1468),
  (1040,1446),(640,1420),(440,1513),(855,1408),(350,1575),(1415,2170),(1552,2265),(1703,2170),(1495,1622),(1285,1625),
  (1683,1622),(1605,1622),(1605,1737),(1703,2090),(1493,1923),(1605,1853),(1605,2017)]
for x, y in MARKERS: cv2.circle(erase, (x, y), 36, 255, -1)
LABELS = [(105,400,550,480),(1060,410,1480,490),(1130,850,1390,985),(2175,900,2685,980),(245,1795,740,1875),(1615,1895,2200,1970)]
for x0, y0, x1, y1 in LABELS: cv2.rectangle(erase, (x0, y0), (x1, y1), 255, -1)
# icons: black squares, saturated blue squares (accessible restrooms, info), red AED hearts, Mickey heads
icon = ((V < 70) | ((H >= 100) & (H <= 125) & (S > 190) & (V > 120)) | (((H < 8) | (H > 170)) & (S > 150) & (V > 150))).astype(np.uint8) * 255
n, lab, st, _ = cv2.connectedComponentsWithStats(icon)
small = np.zeros_like(icon)
for i in range(1, n):
    if st[i, cv2.CC_STAT_AREA] < 2500 and max(st[i, cv2.CC_STAT_WIDTH], st[i, cv2.CC_STAT_HEIGHT]) < 90: small[lab == i] = 255
erase |= cv2.dilate(small, np.ones((15, 15), np.uint8))
clean = cv2.inpaint(im, erase, 9, cv2.INPAINT_TELEA)
if DBG: cv2.imwrite(os.path.join(DBG, 'clean.png'), cv2.resize(clean, (MW // 2, MH // 2), interpolation=cv2.INTER_AREA))

# ---------- sort the pixels ----------
hsv = cv2.cvtColor(cv2.GaussianBlur(clean, (5, 5), 0), cv2.COLOR_BGR2HSV); H, S, V = [hsv[..., i].astype(int) for i in range(3)]
water = (H >= 86) & (H <= 106) & (S >= 45) & (S <= 150) & (V >= 160)
water |= (np.arange(MH)[:, None] > 2450) & (H >= 95) & (H <= 118) & (S >= 30) & (V >= 120)      # the lagoon is a deeper blue
path = (H >= 4) & (H <= 32) & (S >= 8) & (S <= 80) & (V >= 180)
green = (H >= 28) & (H <= 85) & (S >= 55)
vblur = cv2.blur(V.astype(np.float32), (15, 15))
trees = green & (vblur < 168)
# keep to the park and its entrance (the bus and parking lots in the south-east are left out)
park = np.ones((MH, MW), bool); park[2350:, 1950:] = False
def clean_mask(m, k_open=3, k_close=7, min_area=300, fill_holes=0):
    m = (m & park).astype(np.uint8) * 255
    if k_close: m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((k_close, k_close), np.uint8))
    if k_open: m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((k_open, k_open), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m)
    keep = np.zeros_like(m)
    for i in range(1, n):
        if st[i, cv2.CC_STAT_AREA] >= min_area: keep[lab == i] = 255
    if fill_holes:
        inv = 255 - keep; n, lab, st, _ = cv2.connectedComponentsWithStats(inv)
        for i in range(1, n):
            if st[i, cv2.CC_STAT_AREA] < fill_holes: keep[lab == i] = 255
    return keep
# blue roofs, tents and canopies that are the colour of water
NOT_WATER = [(1040,430,1560,900),(2000,760,2120,870),(2230,340,2390,460),(2500,0,2901,1000),(1940,980,2120,1080),(2800,1000,2901,1600)]
for x0, y0, x1, y1 in NOT_WATER: water[y0:y1, x0:x1] = False
yy, xx = np.mgrid[0:MH, 0:MW]
water &= ~((xx - 2410) ** 2 + (yy - 1740) ** 2 < 175 ** 2)              # Carousel of Progress' blue rings
W_ = clean_mask(water, 3, 9, 1500, 600)
P_ = clean_mask(path & ~(W_ > 0), 3, 9, 800, 700)
# grey streets: Main Street, the hub, Town Square, the Speedway track
grey = (S <= 32) & (V >= 95) & (V <= 205)
zone = np.zeros((MH, MW), bool)
zone[1430:2250, 1515:1595] = True
r = np.hypot(xx - 1553, yy - 1385); zone |= (r > 55) & (r < 135)
zone[2040:2270, 1440:1670] = True
zone[740:1300, 2170:2620] = True
R_ = clean_mask(grey & zone & ~(W_ > 0) & ~(P_ > 0), 3, 7, 400, 300)
sand = (np.arange(MH)[:, None] > 2450) & (H >= 15) & (H <= 32) & (S > 50) & (V > 170)
D_ = clean_mask(sand & ~(W_ > 0), 3, 7, 800, 0)
# the railroad (traced by hand; the guide map cuts off its northern loop, so that part follows the park's edge)
RAIL = [(1552,2335),(1400,2335),(1100,2335),(800,2330),(550,2300),(400,2235),(300,2110),(240,1900),(215,1700),(205,1400),
  (195,1250),(150,1000),(100,800),(95,600),(105,450),(135,300),(200,150),(330,0),(420,-120),(700,-230),(1100,-280),(1500,-290),
  (1900,-280),(2250,-200),(2440,0),(2600,250),(2700,450),(2800,620),(2860,800),(2860,1100),(2790,1380),(2700,1630),(2600,1830),
  (2500,1980),(2300,2150),(2100,2250),(1900,2310),(1700,2335)]
not_building = np.zeros((MH, MW), np.uint8)
cv2.polylines(not_building, [np.array([p for p in RAIL if p[1] >= 0], np.int32)], True, 255, 26)
cv2.rectangle(not_building, (40, 2080), (440, 2440), 255, -1)                 # the compass rose
other = (not_building == 0) & ~green & ~(W_ > 0) & ~(P_ > 0) & ~(R_ > 0) & ~(D_ > 0) & (V > 40)
B_ = clean_mask(other, 9, 5, 900, 400)
south = B_[2380:].copy(); B_[2380:] = cv2.morphologyEx(south, cv2.MORPH_OPEN, np.ones((19, 19), np.uint8))   # monorail and train lines
T_ = clean_mask(trees & ~(B_ > 0) & ~(P_ > 0) & ~(W_ > 0) & ~(R_ > 0), 5, 0, 200, 0)
if DBG:
    dbg = np.zeros_like(im); dbg[:] = (90, 170, 110)
    dbg[T_ > 0] = (50, 110, 60); dbg[B_ > 0] = (90, 90, 200); dbg[P_ > 0] = (200, 230, 250); dbg[W_ > 0] = (230, 180, 90)
    dbg[R_ > 0] = (150, 150, 150); dbg[D_ > 0] = (120, 210, 240)
    cv2.imwrite(os.path.join(DBG, 'classes.png'), cv2.resize(dbg, (MW // 2, MH // 2), interpolation=cv2.INTER_NEAREST))

# ---------- shapes ----------
def shapes(mask, eps, min_hole=400):
    cs, hier = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    out = []
    if hier is None: return out
    hier = hier[0]
    for i, c in enumerate(cs):
        if hier[i][3] != -1: continue           # holes are taken with their outline
        poly = cv2.approxPolyDP(c, eps, True).reshape(-1, 2)
        if len(poly) < 3: continue
        holes, j = [], hier[i][2]
        while j != -1:
            if cv2.contourArea(cs[j]) >= min_hole:
                h = cv2.approxPolyDP(cs[j], eps, True).reshape(-1, 2)
                if len(h) >= 3: holes.append(h)
            j = hier[j][0]
        out.append([poly] + holes)
    return out
def rings_m(rings): return [[[round(float(x), 1), round(float(y), 1)] for x, y in r] for r in rings]   # map px
water_s = [rings_m(s) for s in shapes(W_, 2.2)]
path_s = [rings_m(s) for s in shapes(P_, 2.0)]
road_s = [rings_m(s) for s in shapes(R_, 2.0)]
sand_s = [rings_m(s) for s in shapes(D_, 2.5)]
# buildings, each with the colour it has on the guide map (its median, made a little richer)
build_s = []
for sh in shapes(cv2.morphologyEx(B_, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8)), 3.0):
    m = np.zeros((MH, MW), np.uint8); cv2.fillPoly(m, [sh[0].astype(np.int32)], 255)
    b, g, r_ = [int(np.median(clean[..., k][m > 0])) for k in range(3)]
    hh, ss, vv = [int(c) for c in cv2.cvtColor(np.uint8([[[b, g, r_]]]), cv2.COLOR_BGR2HSV)[0, 0]]
    # roofs: the guide's colour, a touch brighter; an outline in a darker shade of the same colour
    ss2 = min(255, int(ss * 1.1)); vv2 = min(242, int(vv * 1.04 + 8))
    if 95 <= hh <= 125: hh, ss2 = 120, max(ss2, 60)           # Tomorrowland's blues lean violet, away from the water's blue
    b, g, r_ = cv2.cvtColor(np.uint8([[[hh, ss2, vv2]]]), cv2.COLOR_HSV2BGR)[0, 0]
    ob, og, or_ = cv2.cvtColor(np.uint8([[[hh, min(255, ss2 + 50), int(vv2 * 0.58)]]]), cv2.COLOR_HSV2BGR)[0, 0]
    build_s.append({'c': '#%02x%02x%02x' % (r_, g, b), 'o': '#%02x%02x%02x' % (or_, og, ob), 'p': rings_m(sh[:1])[0]})

# trees: a jittered grid over the tree areas (and every bit of green outside the park's paths)
rng = np.random.default_rng(7); tree_pts = []
for y in range(0, MH, 22):
    for x in range(0, MW, 22):
        px, py = x + rng.integers(-8, 9), y + rng.integers(-8, 9)
        if 0 <= px < MW and 0 <= py < MH and T_[py, px]:
            tree_pts.append((px, py, 4.5 + rng.random() * 3.5))
trees_out = [[int(x), int(y), round(r, 1)] for x, y, r in tree_pts]          # map px, radius in metres


# places read off the guide map (map px): its 18 restroom symbols, the rides, stations, land names
PLACES = {
    # restrooms
    'gate': (1805, 2422), 'townsq': (1350, 2090), 'firstaid': (1400, 1705), 'terrace': (1725, 1687),
    'veranda': (975, 1395), 'pirates': (335, 1655), 'pecos': (460, 1350), 'tiana': (98, 942),
    'tsi-north': (570, 640), 'tsi-south': (603, 1060), 'tangled': (1078, 605), 'pinocchio': (1490, 530),
    'gaston': (1848, 212), 'teacups': (1927, 912), 'circus': (2555, 372), 'tron': (2790, 556),
    'cosmic': (2203, 1252), 'space': (2680, 1475),
    # rides and landmarks (the middle of each building)
    'L-castle': (1560, 1040), 'L-space': (2730, 1040), 'L-thunder': (270, 650), 'L-mansion': (830, 600),
    'L-smallworld': (1300, 560), 'L-pirates': (400, 1690), 'L-jungle': (690, 1665), 'L-swiss': (880, 1560),
    'L-tiki': (643, 1585), 'L-carpets': (725, 1545), 'L-country': (600, 1300), 'L-tiana': (230, 1150),
    'L-hall': (1185, 1075), 'L-tomsawyer': (700, 950), 'L-peterpan': (1300, 770), 'L-carrousel': (1500, 715),
    'L-philhar': (1420, 850), 'L-teacups': (2055, 830), 'L-minetrain': (2050, 580), 'L-beourguest': (1650, 230),
    'L-mermaid': (2040, 300), 'L-dumbo': (2365, 620), 'L-barnstormer': (2600, 560), 'L-tron': (2700, 700),
    'L-speedway': (2350, 1000), 'L-astro': (2405, 1420), 'L-buzz': (2235, 1565), 'L-carousel': (2410, 1740),
    'L-laugh': (2030, 1500), 'L-pooh': (1915, 790), 'L-belle': (880, 1130), 'L-entrance': (1553, 2530),
    'L-peoplemover': (2470, 1250),
    'S-main': (1552, 2300), 'S-frontier': (160, 1000), 'S-fantasy': (2625, 410),
    'T-front': (330, 440), 'T-fan': (1270, 450), 'T-lib': (1170, 960), 'T-tom': (2430, 940), 'T-adv': (490, 1835), 'T-main': (1555, 1800),
    'hub': (1553, 1385), 'start': (1553, 1250),
}
places = {k: list(v) for k, v in PLACES.items()}
# the lands, roughly (map px), for tinting and for which land a restroom is in
LANDS_PX = {
    'main': [(1380,1470),(1720,1470),(1760,2330),(1340,2330)],
    'adv': [(1380,1470),(1300,1330),(1000,1330),(600,1310),(300,1330),(230,1500),(215,1800),(420,2200),(1100,2200),(1380,1900)],
    'front': [(300,1330),(600,1310),(1000,1300),(990,1180),(900,1150),(560,1000),(470,600),(560,0),(0,0),(0,1500),(230,1500)],
    'lib': [(1000,1300),(1300,1330),(1440,1250),(1440,1000),(1380,820),(1080,660),(1000,480),(700,420),(560,600),(900,800),(950,1000),(990,1180)],
    'fan': [(1080,660),(1380,820),(1440,1000),(1700,1000),(2120,980),(2200,880),(2650,480),(2650,0),(1000,0),(1000,480)],
    'tom': [(1700,1000),(2120,980),(2200,880),(2650,480),(2901,480),(2901,2050),(2500,2100),(1800,1800),(1720,1470),(1660,1300)],
}
lands = {k: [list(p) for p in v] for k, v in LANDS_PX.items()}

data = {
    'source': 'Traced from the official Magic Kingdom guide map (layout only), in its own pixels (page 2 at 150 dpi).',
    'size': [MW, MH], 'places': places, 'lands': lands,
    'water': water_s, 'paths': path_s, 'roads': road_s, 'sand': sand_s, 'buildings': build_s, 'trees': trees_out,
}
open(OUT, 'w').write(json.dumps(data, separators=(',', ':')))
print('roads', len(road_s), 'sand', len(sand_s), 'water', len(water_s), 'paths', len(path_s), 'buildings', len(build_s), 'trees', len(trees_out))
print('now run _tools/royal-flush/osm_fit.py to fit it to OpenStreetMap and write mk-map.js')
