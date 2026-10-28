"""Generates the textures for the Undercroft's props (experiments/undercroft/js/models/props.js) into
experiments/undercroft/tex/props_*.jpg. Everything is procedural, so there is no licence to track.

    python3 _tools/undercroft/make_props_textures.py

Sets (albedo with baked cavity darkening, OpenGL normal map, and a roughness map; for iron the
roughness map also carries metalness in its blue channel, the way three.js reads them):
  wood   512x1024  old open-grained oak, grain running down the image (v), tiles both ways
  steel  512       forged steel: grinding lines along v, cross scratches, faint stains (normal + rough)
  iron   512       wrought iron: hammer dents, pitting, rust patches (rough G, metal B)
  food   1024      atlas, 2x2: apple | bread crust / cheese | roast chicken skin and bone
  misc   512       atlas, 2x2: leather | bone / cord | feather
  coals  256       charcoal albedo plus an emissive map of glowing cracks
The atlas layouts are mirrored in props.js (FOOD_UV / MISC_UV); keep them in sync. Needs numpy, Pillow.
"""
import os
import numpy as np
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'experiments', 'undercroft', 'tex')


# ---------- periodic noise on any w x h grid ----------

def vnoise(w, h, cx, cy, rng):
    """Smooth value noise with cx by cy lattice cells across the tile; tiles both ways."""
    g = rng.random((cy, cx))
    y = np.arange(h) * cy / h; x = np.arange(w) * cx / w
    y0 = np.floor(y).astype(int); x0 = np.floor(x).astype(int)
    fy = y - y0; fx = x - x0
    fy = fy * fy * (3 - 2 * fy); fx = fx * fx * (3 - 2 * fx)
    y1 = (y0 + 1) % cy; x1 = (x0 + 1) % cx
    a = g[np.ix_(y0, x0)]; b = g[np.ix_(y0, x1)]; c = g[np.ix_(y1, x0)]; d = g[np.ix_(y1, x1)]
    fx = fx[None, :]; fy = fy[:, None]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def fbm(w, h, cx, cy, octaves, rng, gain=0.5):
    t = np.zeros((h, w)); amp = 1.0; norm = 0.0
    for o in range(octaves):
        t += amp * vnoise(w, h, max(1, int(cx * 2 ** o)), max(1, int(cy * 2 ** o)), rng)
        norm += amp; amp *= gain
    return t / norm


def blur(img, sigma):
    """Periodic Gaussian blur through the FFT."""
    h, w = img.shape
    fy = np.fft.fftfreq(h)[:, None]; fx = np.fft.fftfreq(w)[None, :]
    k = np.exp(-2 * (np.pi * sigma) ** 2 * (fx * fx + fy * fy))
    return np.real(np.fft.ifft2(np.fft.fft2(img) * k))


def ss(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def normal_map(h, strength):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * strength
    n = np.stack([-dx, dy, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def cavity(h, sigma, amount):
    return np.clip(1 - np.maximum(blur(h, sigma) - h, 0) * amount, 0, 1)


def dots(w, h, n, rmin, rmax, rng):
    """A field of soft round spots (wrapping), each 0..1."""
    img = Image.new('L', (w, h), 0); d = ImageDraw.Draw(img)
    for _ in range(n):
        x, y = rng.random() * w, rng.random() * h; r = rng.uniform(rmin, rmax); v = int(rng.uniform(120, 255))
        for ox in (-w, 0, w):
            for oy in (-h, 0, h):
                d.ellipse([x + ox - r, y + oy - r, x + ox + r, y + oy + r], fill=v)
    return blur(np.asarray(img, float) / 255, 0.6)


def lines(w, h, n, length, angle, spread, width, rng, val=(120, 255)):
    """Wrapping straight scratches; angle in radians from the image's vertical."""
    img = Image.new('L', (w, h), 0); d = ImageDraw.Draw(img)
    for _ in range(n):
        x, y = rng.random() * w, rng.random() * h
        a = angle + rng.normal(0, spread); L = rng.uniform(*length)
        dx, dy = np.sin(a) * L, np.cos(a) * L
        v = int(rng.uniform(*val)); wd = int(rng.integers(width[0], width[1] + 1))
        for ox in (-w, 0, w):
            for oy in (-h, 0, h):
                d.line([(x + ox, y + oy), (x + ox + dx, y + oy + dy)], fill=v, width=wd)
    return np.asarray(img, float) / 255


def save(arr, name, q=88):
    a = (np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8)
    img = Image.fromarray(a, 'L' if a.ndim == 2 else 'RGB')
    img.save(os.path.join(OUT, name), quality=q, subsampling=0 if ('normal' in name or '_rm' in name) else 2, optimize=True)


def col(c):
    return np.array(c, float)[None, None, :]


# ---------- oak ----------

def wood(seed):
    rng = np.random.default_rng(seed)
    w, h = 512, 1024  # 0.5 m across the grain, 1 m along it
    warp = (fbm(w, h, 3, 1, 4, rng) - 0.5) * 9 + (fbm(w, h, 8, 2, 3, rng) - 0.5) * 2.5
    u = np.arange(w)[None, :] / w
    rings = np.sin((u * 120 + warp * 2.2) * 2 * np.pi) * 0.5 + 0.5
    late = ss(0.45, 1.0, rings) * (0.4 + 0.6 * fbm(w, h, 12, 3, 3, rng))                    # dark latewood bands
    pores = ss(0.58, 0.8, fbm(w, h, 220, 10, 2, rng)) * (1 - late)  # open pores in the earlywood
    rays = ss(0.78, 0.9, fbm(w, h, 90, 30, 2, rng)) * 0.5          # oak's silvery medullary flecks
    streak = fbm(w, h, 24, 2, 4, rng)
    weather = fbm(w, h, 4, 4, 5, rng)
    height = 0.5 - late * 0.12 - pores * 0.35 + streak * 0.15 + rays * 0.08
    base = col([0.38, 0.31, 0.235]) * (0.8 + 0.32 * streak[..., None])
    alb = base * (1 - 0.13 * late[..., None]) * (1 - 0.3 * pores[..., None])
    alb = alb * (1 + 0.25 * rays[..., None])
    grey = alb.mean(-1, keepdims=True)  # sun-less age: greyed, dirty patches
    t = ss(0.35, 0.8, weather)[..., None] * 0.6
    alb = alb * (1 - t) + grey * 0.8 * t
    alb *= (0.75 + 0.35 * fbm(w, h, 6, 12, 4, rng)[..., None])
    alb *= (0.55 + 0.45 * cavity(height, 2, 6)[..., None])
    rough = 0.62 + 0.18 * pores + 0.1 * weather - 0.08 * late
    save(alb, 'props_wood_albedo.jpg', 86)
    save(normal_map(height, 7), 'props_wood_normal.jpg', 86)
    save(rough, 'props_wood_rough.jpg', 82)


# ---------- forged steel ----------

def steel(seed):
    rng = np.random.default_rng(seed)
    n = 512
    grind = fbm(n, n, 200, 3, 2, rng)  # grinding lines along the length
    fine = lines(n, n, 900, (20, 160), 0, 0.03, (1, 1), rng, (40, 140))
    cross = lines(n, n, 120, (10, 70), 1.2, 0.6, (1, 1), rng, (60, 200))
    nicks = dots(n, n, 40, 0.8, 2.2, rng)
    stain = ss(0.62, 0.85, fbm(n, n, 9, 9, 5, rng))
    height = grind * 0.3 - fine * 0.25 - cross * 0.4 - nicks * 0.6
    rough = 0.14 + 0.08 * grind + 0.14 * fine + 0.2 * cross + 0.16 * stain + 0.25 * nicks
    save(normal_map(height, 2.5), 'props_steel_normal.jpg', 88)
    save(rough, 'props_steel_rough.jpg', 86)


# ---------- wrought iron ----------

def iron(seed):
    rng = np.random.default_rng(seed)
    n = 512
    # hammer dents: a field of shallow round dimples
    dent = blur(dots(n, n, 260, 6, 14, rng), 3)
    lump = fbm(n, n, 8, 8, 5, rng)
    rustf = fbm(n, n, 6, 6, 6, rng) + (fbm(n, n, 40, 40, 2, rng) - 0.5) * 0.25
    speck = fbm(n, n, 48, 48, 3, rng)
    rust = ss(0.5, 0.72, rustf * 0.75 + speck * 0.35) * 0.8
    heavy = ss(0.62, 0.8, rustf) * rust
    pits = ss(0.65, 0.8, fbm(n, n, 64, 64, 2, rng)) * (0.3 + rust)
    height = lump * 0.4 - dent * 0.35 - pits * 0.3 + heavy * 0.25 * fbm(n, n, 90, 90, 2, rng)
    black = col([0.2, 0.2, 0.205]) * (0.7 + 0.55 * lump[..., None])
    rc = fbm(n, n, 30, 30, 3, rng)[..., None]
    rcol = col([0.17, 0.11, 0.075]) * (1 - rc) + col([0.27, 0.16, 0.095]) * rc
    rcol = rcol * (1 - heavy[..., None] * 0.35)
    alb = black * (1 - rust[..., None]) + rcol * rust[..., None]
    alb *= (0.6 + 0.4 * cavity(height, 3, 5)[..., None])
    rough = 0.42 + 0.18 * lump + 0.4 * rust + 0.1 * pits
    metal = 0.6 * (1 - rust) + 0.02  # black mill scale is only half metallic; rust not at all
    rm = np.stack([np.zeros_like(rough), rough, metal], -1)
    save(alb, 'props_iron_albedo.jpg', 86)
    save(normal_map(height, 6), 'props_iron_normal.jpg', 86)
    save(rm, 'props_iron_rm.jpg', 88)


# ---------- food atlas ----------

# bread slashes in the crust quadrant's (u, v): u runs round the loaf (top at 0.25), v along it.
# props.js carves the same grooves into the loaf (BREAD_SLASHES); keep them identical.
BREAD_SLASHES = [((0.215, 0.18), (0.285, 0.42)), ((0.215, 0.39), (0.285, 0.63)), ((0.215, 0.6), (0.285, 0.84))]


def seg_dist(px, py, a, b, sx, sy):
    """Distance from pixel grid (px, py in 0..1) to segment a-b, with u and v scaled to metres."""
    ax, ay = a; bx, by = b
    dx, dy = (bx - ax) * sx, (by - ay) * sy
    qx, qy = (px - ax) * sx, (py - ay) * sy
    t = np.clip((qx * dx + qy * dy) / (dx * dx + dy * dy), 0, 1)
    return np.hypot(qx - t * dx, qy - t * dy), t, (qx * dy - qy * dx) / np.hypot(dx, dy)


def food(seed):
    rng = np.random.default_rng(seed)
    q = 512
    alb = np.zeros((1024, 1024, 3)); hgt = np.zeros((1024, 1024)); rgh = np.zeros((1024, 1024))
    yy, xx = np.mgrid[0:q, 0:q] / q
    v = 1 - yy  # image rows run down; v runs up

    def put(cu, cv, a, h, r):  # quadrant at atlas column cu, row cv (row 0 = bottom, v 0..0.5)
        r0 = (1 - cv) * q
        alb[r0:r0 + q, cu * q:cu * q + q] = a; hgt[r0:r0 + q, cu * q:cu * q + q] = h; rgh[r0:r0 + q, cu * q:cu * q + q] = r

    # apple (0, 1): u round, v pole to pole. Deep, slightly dull red over yellow-green, streaked.
    streak = fbm(q, q, 40, 3, 4, rng)
    blush = ss(0.15, 0.55, fbm(q, q, 3, 2, 4, rng) * 0.8 + streak * 0.35)
    ground = col([0.36, 0.28, 0.13])
    red = col([0.24, 0.035, 0.03]) * (0.75 + 0.45 * streak[..., None])
    a = ground * (1 - blush[..., None]) + red * blush[..., None]
    pole = ss(0.12, 0.0, v) + ss(0.85, 0.98, v)  # russet in the stem and calyx cavities
    a = a * (1 - pole[..., None] * 0.7) + col([0.22, 0.16, 0.07]) * pole[..., None] * 0.7
    lent = dots(q, q, 700, 0.6, 1.3, rng)
    a = a * (1 - lent[..., None] * 0.5) + col([0.55, 0.48, 0.30]) * lent[..., None] * 0.5
    bruise = ss(0.7, 0.85, fbm(q, q, 5, 5, 4, rng))
    a *= 1 - bruise[..., None] * 0.3
    put(0, 1, a, fbm(q, q, 20, 20, 3, rng) * 0.3 + lent * 0.2 - bruise * 0.3, 0.42 + 0.15 * fbm(q, q, 10, 10, 3, rng) + lent * 0.2 + pole * 0.3)

    # bread crust (1, 1): u round the loaf (top 0.25, bottom 0.75), v along it
    top = np.cos((xx - 0.25) * 2 * np.pi) * 0.5 + 0.5  # 1 on top, 0 underneath
    blist = ss(0.55, 0.75, fbm(q, q, 30, 30, 3, rng))
    mott = fbm(q, q, 8, 8, 5, rng)
    a = col([0.58, 0.40, 0.22]) * (1 - top[..., None] * 0.5) * (0.75 + 0.5 * mott[..., None])
    a *= 1 - blist[..., None] * 0.35 * top[..., None]
    flour = ss(0.45, 0.8, fbm(q, q, 12, 12, 4, rng)) * (0.25 + 0.75 * ss(0.5, 0.0, top))
    h = mott * 0.4 + blist * 0.3 + fbm(q, q, 60, 60, 2, rng) * 0.15
    for s in BREAD_SLASHES:
        d, t, side = seg_dist(xx, v, s[0], s[1], 0.35, 0.26)
        wdt = 0.011 * np.sin(np.pi * t) ** 0.5 + 0.0005
        cut = ss(wdt, wdt * 0.4, d)
        ear = ss(wdt * 2.2, wdt, d) * (1 - cut) * (side > 0)  # the lifted, darker "ear" on one side
        inner = col([0.70, 0.50, 0.25]) * (0.8 + 0.3 * fbm(q, q, 50, 50, 2, rng)[..., None])
        a = a * (1 - cut[..., None]) + inner * cut[..., None]
        a *= 1 - ear[..., None] * 0.35
        h = h - cut * 0.4 + ear * 0.35
        flour *= 1 - cut
    a = a * (1 - flour[..., None] * 0.6) + col([0.72, 0.68, 0.60]) * flour[..., None] * 0.6
    crack = lines(q, q, 60, (8, 30), 1.57, 0.8, (1, 1), rng) * top
    a *= 1 - crack[..., None] * 0.4
    h -= crack * 0.3
    a *= (0.6 + 0.4 * cavity(h, 3, 4)[..., None])
    put(1, 1, a, h, 0.75 + 0.15 * flour - 0.1 * top)

    # cheese (0, 0): v 0..0.55 paste (cut faces), v 0.6..1 waxed rind
    eyes = ss(0.35, 0.8, dots(q, q, 90, 1.5, 5, rng)) * (v < 0.56)
    paste = col([0.72, 0.62, 0.42]) * (0.88 + 0.2 * fbm(q, q, 10, 10, 4, rng)[..., None])
    cryst = dots(q, q, 400, 0.5, 1.0, rng) * 0.4
    paste = paste * (1 + cryst[..., None] * 0.3)
    paste = paste * (1 - eyes[..., None] * 0.55)
    weave = (np.sin(xx * q * 0.9) * np.sin(yy * q * 0.9)) * 0.5 + 0.5  # cheesecloth imprint
    rind = col([0.36, 0.27, 0.15]) * (0.7 + 0.5 * fbm(q, q, 6, 6, 5, rng)[..., None]) * (0.9 + 0.1 * weave[..., None])
    mould = ss(0.68, 0.8, fbm(q, q, 14, 14, 3, rng))
    rind = rind * (1 - mould[..., None] * 0.4) + col([0.45, 0.43, 0.36]) * mould[..., None] * 0.4
    m = ss(0.555, 0.6, v)[..., None]
    a = paste * (1 - m) + rind * m
    h = (fbm(q, q, 40, 40, 2, rng) * 0.2 - eyes * 0.6) * (1 - m[..., 0]) + (weave * 0.15 + mould * 0.1) * m[..., 0]
    a *= (0.65 + 0.35 * cavity(h, 2, 5)[..., None])
    put(0, 0, a, h, 0.62 + 0.1 * m[..., 0] + 0.2 * eyes)

    # roast chicken (1, 0): v 0..0.72 crisp skin, 0.72..0.8 meat pulled back, 0.8..1 bone and knuckle
    edge = 0.74 + (fbm(q, q, 12, 1, 3, rng) - 0.5) * 0.06
    follicle = dots(q, q, 1400, 0.7, 1.6, rng)
    char = ss(0.62, 0.8, fbm(q, q, 10, 10, 4, rng))
    skin = col([0.44, 0.26, 0.13]) * (0.75 + 0.5 * fbm(q, q, 7, 7, 5, rng)[..., None])
    skin = skin * (1 - char[..., None] * 0.6) * (1 - follicle[..., None] * 0.25)
    meat = col([0.45, 0.30, 0.20]) * (0.8 + 0.4 * fbm(q, q, 80, 6, 2, rng)[..., None])
    bone = col([0.64, 0.58, 0.48]) * (0.85 + 0.25 * fbm(q, q, 10, 10, 3, rng)[..., None])
    knuckle = ss(0.9, 0.97, v)
    bone = bone * (1 - knuckle[..., None] * 0.15) + col([0.55, 0.42, 0.30]) * knuckle[..., None] * 0.15
    ms = ss(edge - 0.005, edge + 0.005, v)[..., None]
    bs = ss(0.79, 0.81, v)[..., None]
    a = skin * (1 - ms) + meat * ms
    a = a * (1 - bs) + bone * bs
    wrinkle = fbm(q, q, 20, 6, 3, rng)
    h = (wrinkle * 0.4 + follicle * 0.2 + char * 0.15) * (1 - ms[..., 0]) + ms[..., 0] * (1 - bs[..., 0]) * fbm(q, q, 90, 8, 2, rng) * 0.3
    a *= (0.6 + 0.4 * cavity(h, 2, 5)[..., None])
    r = 0.38 + 0.25 * char - 0.1 * wrinkle
    r = r * (1 - ms[..., 0]) + 0.6 * ms[..., 0]
    put(1, 0, a, h, r)

    save(alb, 'props_food_albedo.jpg', 86)
    n = normal_map(hgt, 5)
    save(np.asarray(Image.fromarray((n * 255).astype(np.uint8)).resize((512, 512), Image.LANCZOS), float) / 255, 'props_food_normal.jpg', 86)
    save(np.asarray(Image.fromarray((np.clip(rgh, 0, 1) * 255).astype(np.uint8)).resize((512, 512), Image.LANCZOS), float) / 255, 'props_food_rough.jpg', 82)


# ---------- misc atlas: leather | bone / cord | feather ----------

def misc(seed):
    rng = np.random.default_rng(seed)
    q = 256
    alb = np.zeros((512, 512, 3)); hgt = np.zeros((512, 512)); rgh = np.zeros((512, 512))
    yy, xx = np.mgrid[0:q, 0:q] / q

    def put(cu, cv, a, h, r):
        r0 = (1 - cv) * q
        alb[r0:r0 + q, cu * q:cu * q + q] = a; hgt[r0:r0 + q, cu * q:cu * q + q] = h; rgh[r0:r0 + q, cu * q:cu * q + q] = r

    # leather (0, 1): pebbled, darkened and polished by hands
    peb = blur(dots(q, q, 900, 1.5, 3.0, rng), 1)
    wear = fbm(q, q, 4, 4, 5, rng)
    a = col([0.20, 0.12, 0.07]) * (0.7 + 0.6 * wear[..., None]) * (0.85 + 0.25 * peb[..., None])
    scuff = lines(q, q, 40, (5, 25), 1.4, 0.5, (1, 1), rng)
    a = a * (1 + scuff[..., None] * 0.6)
    h = peb * 0.5 - scuff * 0.3
    put(0, 1, a * (0.7 + 0.3 * cavity(h, 2, 4)[..., None]), h, 0.55 + 0.25 * peb - 0.2 * ss(0.6, 0.9, wear))

    # bone (1, 1): old, stained bone, pores and hairline cracks
    stain = fbm(q, q, 5, 5, 5, rng)
    a = col([0.50, 0.47, 0.40]) * (0.75 + 0.35 * fbm(q, q, 20, 20, 3, rng)[..., None])
    a = a * (1 - ss(0.5, 0.8, stain)[..., None] * 0.45 * np.array([0.6, 0.8, 1.0]))
    pores = dots(q, q, 300, 0.4, 0.9, rng)
    crk = lines(q, q, 25, (6, 30), 0.3, 0.8, (1, 1), rng)
    a *= 1 - (pores * 0.3 + crk * 0.4)[..., None]
    put(1, 1, a, -pores * 0.3 - crk * 0.4 + stain * 0.2, 0.7 + 0.1 * stain)

    # cord (0, 0): twisted hemp, strands slanting across u, running along v
    tw = np.sin((xx * 6 + yy * 24) * 2 * np.pi) * 0.5 + 0.5
    fib = fbm(q, q, 60, 6, 2, rng)
    a = col([0.42, 0.36, 0.26]) * (0.6 + 0.4 * tw[..., None]) * (0.8 + 0.3 * fib[..., None])
    put(0, 0, a, tw * 0.6 + fib * 0.2, 0.85)

    # feather (1, 0): grey-brown goose vane, barbs slanting off a quill at u = 0.5
    barbs = np.sin((np.abs(xx - 0.5) * 0.6 + yy) * 140) * 0.5 + 0.5
    shaft = ss(0.025, 0.01, np.abs(xx - 0.5))
    a = col([0.48, 0.45, 0.40]) * (0.75 + 0.25 * barbs[..., None]) * (0.7 + 0.5 * fbm(q, q, 4, 8, 4, rng)[..., None])
    a = a * (1 - shaft[..., None]) + col([0.75, 0.72, 0.65]) * shaft[..., None]
    put(1, 0, a, barbs * 0.3 + shaft * 0.5, 0.8)

    save(alb, 'props_misc_albedo.jpg', 86)
    save(normal_map(hgt, 4), 'props_misc_normal.jpg', 86)
    save(rgh, 'props_misc_rough.jpg', 82)


# ---------- coals ----------

def coals(seed):
    rng = np.random.default_rng(seed)
    n = 256
    cells = fbm(n, n, 10, 10, 4, rng)
    ash = ss(0.55, 0.75, fbm(n, n, 8, 8, 4, rng))
    a = col([0.035, 0.03, 0.028]) * (0.6 + 0.8 * cells[..., None])
    a = a * (1 - ash[..., None]) + col([0.32, 0.30, 0.28]) * (0.7 + 0.4 * cells[..., None]) * ash[..., None]
    # glowing cracks: thin valleys of a ridged noise, plus hot patches deep between lumps
    ridge = 1 - np.abs(fbm(n, n, 6, 6, 4, rng) - 0.5) * 2
    glow = ss(0.86, 0.97, ridge) * (1 - ash) + ss(0.62, 0.8, fbm(n, n, 5, 5, 4, rng)) * 0.5 * (1 - ash)
    e = np.stack([glow, glow ** 1.6 * 0.42, glow ** 3 * 0.08], -1)
    save(a, 'props_coals_albedo.jpg', 85)
    save(e, 'props_coals_emit.jpg', 85)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    wood(1); steel(2); iron(3); food(4); misc(5); coals(6)
    for f in sorted(os.listdir(OUT)):
        if f.startswith('props_'):
            print(f, os.path.getsize(os.path.join(OUT, f)) // 1024, 'KB')
