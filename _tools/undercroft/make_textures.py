"""Generates the Undercroft's surface textures (stone walls, flagstone floor, ceiling, torch wood,
cobwebs) into experiments/undercroft/tex/. Every map tiles seamlessly.

    python3 _tools/undercroft/make_textures.py

Each surface gets an albedo (with ambient occlusion baked in), a normal map (OpenGL, green up) and a
roughness map. Needs numpy and Pillow. Seeds are fixed, so re-running gives the same images.
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'experiments', 'undercroft', 'tex')
N = 1024


# ---------- tileable noise ----------

def value_noise(size, cx, cy, rng):
    """Smooth periodic noise with cx by cy lattice cells across the tile."""
    g = rng.random((cy, cx))
    y = np.arange(size) * cy / size
    x = np.arange(size) * cx / size
    y0 = np.floor(y).astype(int); x0 = np.floor(x).astype(int)
    fy = y - y0; fx = x - x0
    fy = fy * fy * (3 - 2 * fy); fx = fx * fx * (3 - 2 * fx)
    y1 = (y0 + 1) % cy; x1 = (x0 + 1) % cx
    a = g[np.ix_(y0, x0)]; b = g[np.ix_(y0, x1)]
    c = g[np.ix_(y1, x0)]; d = g[np.ix_(y1, x1)]
    fx = fx[None, :]; fy = fy[:, None]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def fbm(size, cells, octaves, rng, stretch=(1, 1), gain=0.5):
    total = np.zeros((size, size)); amp = 1.0; norm = 0.0
    for o in range(octaves):
        c = cells * 2 ** o
        total += amp * value_noise(size, max(1, c * stretch[0]), max(1, c * stretch[1]), rng)
        norm += amp; amp *= gain
    return total / norm


def blur(img, sigma):
    """Periodic Gaussian blur through the FFT."""
    h, w = img.shape
    fy = np.fft.fftfreq(h)[:, None]; fx = np.fft.fftfreq(w)[None, :]
    k = np.exp(-2 * (np.pi * sigma) ** 2 * (fx * fx + fy * fy))
    return np.real(np.fft.ifft2(np.fft.fft2(img) * k))


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def normal_map(h, strength):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * strength
    n = np.stack([-dx, dy, np.ones_like(h)], -1)  # rows run down the image, so +v is -row
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def cavity_ao(h, sigma, amount):
    return np.clip(1 - np.maximum(blur(h, sigma) - h, 0) * amount, 0, 1)


def save_rgb(arr, name, q=90):
    Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGB').save(
        os.path.join(OUT, name), quality=q, subsampling=0 if 'normal' in name else 2)


def save_gray(arr, name, q=88):
    Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8), 'L').save(os.path.join(OUT, name), quality=q)


def save_set(name, albedo, height, rough, normal_strength):
    save_rgb(albedo, name + '_albedo.jpg')
    save_rgb(normal_map(height, normal_strength), name + '_normal.jpg', q=93)
    save_gray(rough, name + '_rough.jpg')


# ---------- ashlar stone (walls and ceiling) ----------

def ashlar(seed, rows_range, width_range, damp, soot):
    """Courses of rough-cut blocks. The tile is one wall height tall, so the rows sum to exactly 1,
    and `damp`/`soot` add a wet, mossy foot and a smoke-stained top."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:N, 0:N] / N

    # course boundaries
    heights = []
    while sum(heights) < 1:
        heights.append(rng.uniform(*rows_range))
    heights = np.array(heights) / sum(heights)
    bounds = np.concatenate([[0], np.cumsum(heights)])
    row = np.clip(np.searchsorted(bounds, yy, side='right') - 1, 0, len(heights) - 1)
    dy = np.minimum(yy - bounds[row], bounds[row + 1] - yy)

    block = np.zeros((N, N), int); dx = np.zeros((N, N)); bid = 0
    for r in range(len(heights)):
        widths = []
        while sum(widths) < 1:
            widths.append(rng.uniform(*width_range))
        widths = np.array(widths) / sum(widths)
        edges = (np.concatenate([[0], np.cumsum(widths)]) + rng.random()) % 1
        m = row == r
        x = xx[m]
        rel = (x - edges[0]) % 1
        cum = np.concatenate([[0], np.cumsum(widths)])
        k = np.clip(np.searchsorted(cum, rel, side='right') - 1, 0, len(widths) - 1)
        dx[m] = np.minimum(rel - cum[k], cum[k + 1] - rel)
        block[m] = bid + k
        bid += len(widths)
    nblocks = bid

    edge = np.minimum(dx, dy) * N  # pixels to the nearest joint
    # chipped, uneven arrises: big bites out of the corners plus fine crumbling
    wobble = (fbm(N, 10, 4, rng) - 0.5) * 26 + (fbm(N, 40, 3, rng) - 0.5) * 12 + (fbm(N, 160, 2, rng) - 0.5) * 5
    e = edge + wobble
    mortar_w = 5.0
    face = smoothstep(mortar_w, mortar_w + 30, e) ** 0.7

    # each block gets its own lumps, tilt and tint
    bseed = rng.random((nblocks, 4))
    lump_a = fbm(N, 6, 3, rng); lump_b = fbm(N, 9, 3, rng)
    pick = bseed[block, 0]
    lumps = lump_a * pick + lump_b * (1 - pick)
    tilt = (bseed[block, 1] - 0.5) * 0.25 * (xx - 0.5) + (bseed[block, 2] - 0.5) * 0.25 * (yy - 0.5)
    grain = fbm(N, 128, 3, rng)
    pits = smoothstep(0.62, 0.75, fbm(N, 48, 3, rng)) * 0.35
    pillow = smoothstep(0, 90, e)  # faces bulge a little toward the middle, like rough-dressed stone
    spall = smoothstep(0.58, 0.72, fbm(N, 14, 4, rng)) * 0.22  # flakes broken off the face
    height = face * (0.45 + 0.18 * pillow + 0.4 * lumps + tilt * 0.4 - pits * 0.5 - spall) + grain * 0.07
    height += (1 - face) * fbm(N, 96, 2, rng) * 0.1

    # colour
    tints = np.array([[0.40, 0.385, 0.36], [0.37, 0.36, 0.345], [0.42, 0.40, 0.36],
                      [0.35, 0.345, 0.335], [0.39, 0.36, 0.32], [0.345, 0.34, 0.34]])
    base = tints[(bseed[:, 3] * len(tints)).astype(int)][block]
    base = base * (0.82 + 0.3 * bseed[block, 1:2])
    var = fbm(N, 24, 5, rng)[..., None]
    alb = base * (0.68 + 0.6 * var)
    alb *= 1 - spall[..., None] * 0.6 + spall[..., None] * 0.9  # fresh breaks are paler
    speck = fbm(N, 256, 1, rng)[..., None]
    alb *= 0.9 + 0.2 * speck
    mortar_col = np.array([0.30, 0.28, 0.25]) * (0.6 + 0.6 * fbm(N, 64, 3, rng)[..., None])
    f3 = face[..., None]
    alb = alb * f3 + mortar_col * (1 - f3)

    rough = 0.82 + 0.12 * fbm(N, 32, 3, rng) - (1 - face) * 0.0

    if damp:
        # wet foot of the wall: darker, greener, glossier, with moss crawling up the joints
        wet = smoothstep(0.62, 1.0, yy + (fbm(N, 8, 4, rng) - 0.5) * 0.25)
        streak = fbm(N, 1, 4, rng, stretch=(40, 2))
        streak = smoothstep(0.55, 0.8, streak) * smoothstep(0.0, 0.9, yy)
        moss = smoothstep(0.5, 0.7, fbm(N, 20, 4, rng)) * smoothstep(0.55, 1.0, yy) * (1 - face * 0.7)
        w = np.clip(wet * 0.8 + streak * 0.6, 0, 1)[..., None]
        alb = alb * (1 - 0.45 * w)
        alb = alb * (1 - moss[..., None]) + np.array([0.12, 0.15, 0.07]) * moss[..., None]
        rough = rough - 0.45 * np.clip(wet * 0.8 + streak, 0, 1)
        # mineral stains dripping from the joints
        stain = smoothstep(0.6, 0.85, fbm(N, 1, 5, rng, stretch=(60, 3))) * 0.25
        alb = alb * (1 - stain[..., None] * np.array([0.2, 0.35, 0.5]))
    if soot:
        s = smoothstep(0.35, 0.0, yy + (fbm(N, 6, 4, rng) - 0.5) * 0.3) if soot == 'top' \
            else smoothstep(0.35, 0.8, fbm(N, 4, 5, rng))
        alb = alb * (1 - 0.6 * s[..., None])

    ao = cavity_ao(height, 6, 3.0) * cavity_ao(height, 24, 1.2)
    alb = alb * (0.35 + 0.65 * ao[..., None])
    return alb, height, np.clip(rough, 0.05, 1)


# ---------- flagstones ----------

def flagstones(seed):
    rng = np.random.default_rng(seed)
    g = 4
    pts = []
    for j in range(g):
        for i in range(g):
            pts.append(((i + 0.5 + rng.uniform(-0.3, 0.3)) / g, (j + 0.5 + rng.uniform(-0.3, 0.3)) / g))
    pts = np.array(pts)
    yy, xx = np.mgrid[0:N, 0:N] / N
    # warp the lookup so the cell borders wander like hand-cut stone
    wx = xx + (fbm(N, 6, 4, rng) - 0.5) * 0.05
    wy = yy + (fbm(N, 6, 4, rng) - 0.5) * 0.05
    d1 = np.full((N, N), 9.0); d2 = np.full((N, N), 9.0); idx = np.zeros((N, N), int)
    for k, (px, py) in enumerate(pts):
        for ox in (-1, 0, 1):
            for oy in (-1, 0, 1):
                d = np.hypot(wx - px - ox, wy - py - oy)
                closer = d < d1
                d2 = np.where(closer, d1, np.minimum(d2, d))
                idx = np.where(closer, k, idx)
                d1 = np.minimum(d1, d)
    edge = (d2 - d1) * 0.5 * N
    face = smoothstep(3, 22, edge + (fbm(N, 32, 3, rng) - 0.5) * 10) ** 0.8
    sd = rng.random((len(pts), 4))
    tilt = (sd[idx, 0] - 0.5) * 0.3 * (xx - pts[idx, 0]) + (sd[idx, 1] - 0.5) * 0.3 * (yy - pts[idx, 1])
    worn = fbm(N, 8, 5, rng)
    height = face * (0.6 + 0.25 * worn + tilt) + fbm(N, 160, 2, rng) * 0.05
    height -= smoothstep(0.66, 0.8, fbm(N, 40, 3, rng)) * 0.1 * face  # pitting

    tints = np.array([[0.36, 0.35, 0.33], [0.40, 0.38, 0.34], [0.31, 0.31, 0.31], [0.38, 0.34, 0.30]])
    base = tints[(sd[:, 2] * len(tints)).astype(int)][idx] * (0.8 + 0.4 * sd[idx, 3:4])
    alb = base * (0.65 + 0.7 * fbm(N, 20, 5, rng)[..., None])
    grit = np.array([0.22, 0.2, 0.17]) * (0.6 + 0.8 * fbm(N, 128, 2, rng)[..., None])
    f3 = face[..., None]
    alb = alb * f3 + grit * (1 - f3)
    rough = 0.78 + 0.15 * fbm(N, 24, 3, rng)

    # puddles gather in the low spots and joints
    wetfield = fbm(N, 3, 5, rng) - height * 0.35
    puddle = smoothstep(0.30, 0.34, wetfield)
    damp = smoothstep(0.22, 0.32, wetfield)
    alb = alb * (1 - 0.5 * damp[..., None]) * (1 - 0.25 * puddle[..., None])
    rough = rough * (1 - damp * 0.55)
    rough = rough * (1 - puddle) + 0.03 * puddle
    level = 0.30
    height = height * (1 - puddle) + np.maximum(height, level) * puddle  # water lies flat

    ao = cavity_ao(height, 5, 3.0) * cavity_ao(height, 20, 1.0)
    alb = alb * (0.3 + 0.7 * ao[..., None])
    # never mirror-smooth: tiny wet glints shimmer and sparkle once they are smaller than a pixel
    return alb, height, np.clip(rough, 0.14, 1)


# ---------- torch handle wood ----------

def wood(seed):
    rng = np.random.default_rng(seed)
    n = 256
    grain = value_noise(n, 3, 40, rng) * 0.6 + value_noise(n, 6, 90, rng) * 0.4
    grain = (np.sin(grain * 40) * 0.5 + 0.5) ** 2  # rings stretched along the handle
    alb = np.array([0.13, 0.09, 0.06])[None, None] * (0.5 + 0.6 * grain[..., None])
    char = smoothstep(0.75, 0.0, np.mgrid[0:n, 0:n][0] / n)  # top end blackened by the fire
    alb *= (1 - 0.8 * char[..., None])
    Image.fromarray((np.clip(alb, 0, 1) * 255).astype(np.uint8)).save(os.path.join(OUT, 'wood_albedo.jpg'), quality=88)


# ---------- cobweb ----------

def cobweb(seed):
    rng = np.random.default_rng(seed)
    s = 1024
    img = Image.new('L', (s, s), 0)
    d = ImageDraw.Draw(img)
    # anchored in the top-left corner: radial threads fanning out, then sagging spiral rungs
    spokes = sorted(rng.uniform(0.02, np.pi / 2 - 0.02, 13))
    lengths = rng.uniform(0.7, 1.0, len(spokes)) * s
    for a, L in zip(spokes, lengths):
        d.line([(0, 0), (np.cos(a) * L, np.sin(a) * L)], fill=int(rng.uniform(150, 230)), width=2)
    r = 40
    while r < s * 0.95:
        pts = []
        for a, L in zip(spokes, lengths):
            if r < L:
                pts.append((np.cos(a) * r, np.sin(a) * r))
        for p, q in zip(pts, pts[1:]):
            mx, my = (p[0] + q[0]) / 2, (p[1] + q[1]) / 2
            sag = (np.hypot(q[0] - p[0], q[1] - p[1])) * 0.12
            mid = (mx + sag * 0.7, my + sag * 0.7)
            if rng.random() > 0.08:
                d.line([p, mid, q], fill=int(rng.uniform(90, 190)), width=1)
        r += rng.uniform(22, 55)
    # a few torn, drooping strands
    for _ in range(9):
        a = rng.uniform(0.1, 1.4); r0 = rng.uniform(100, 700)
        x0, y0 = np.cos(a) * r0, np.sin(a) * r0
        d.line([(x0, y0), (x0 + rng.uniform(-30, 30), y0 + rng.uniform(80, 260))], fill=120, width=1)
    img = img.filter(ImageFilter.GaussianBlur(0.7))
    rgba = Image.merge('RGBA', [Image.new('L', (s, s), 215)] * 3 + [img])
    rgba.save(os.path.join(OUT, 'cobweb.png'), optimize=True)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    alb, h, r = ashlar(11, (0.13, 0.21), (0.2, 0.45), damp=True, soot='top')
    save_set('wall', alb, h, r, 9.0)
    alb, h, r = ashlar(23, (0.14, 0.24), (0.22, 0.5), damp=False, soot='patchy')
    save_set('ceil', alb * 0.8, h, r, 8.0)
    alb, h, r = flagstones(5)
    save_set('floor', alb, h, r, 8.0)
    wood(3)
    cobweb(7)
    print('wrote', sorted(os.listdir(OUT)))
