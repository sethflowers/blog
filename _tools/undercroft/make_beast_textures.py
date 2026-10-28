"""Generates the Undercroft beast's detail textures into experiments/undercroft/tex/. Every map tiles.

    python3 _tools/undercroft/make_beast_textures.py

beast_skin.jpg (1024, ~1 m of hide per tile), channels packed so one triplanar lookup gives everything:
  R  fine detail height: folds and creases of thick hide, pores, a few scars
  G  scale height: irregular raised plates with deep grooves (used on the back, legs and neck ridge)
  B  mottling: dark blotches and lighter patches, also used to vary roughness
beast_membrane.jpg (512): R vein network (1 on a vein), G small wrinkles, B blotches; for the wings.
Needs numpy and Pillow. Seeds are fixed, so re-running gives the same images.
"""
import os
import numpy as np
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'experiments', 'undercroft', 'tex')


def band(n, freq, width, seed, aniso=1.0, angle=0.0):
    """Tileable band-limited noise around `freq` cycles per tile (log-gaussian), unit std.
    aniso > 1 stretches features along `angle` (so wrinkles run in one direction)."""
    r = np.random.default_rng(seed).standard_normal((n, n))
    F = np.fft.fft2(r)
    f = np.fft.fftfreq(n) * n
    fx, fy = f[None, :], f[:, None]
    c, s = np.cos(angle), np.sin(angle)
    u, v = fx * c + fy * s, -fx * s + fy * c
    rad = np.sqrt((u * aniso) ** 2 + (v / aniso) ** 2) + 1e-6
    mask = np.exp(-(np.log2(rad / freq)) ** 2 / (2 * width ** 2))
    out = np.real(np.fft.ifft2(F * mask))
    return out / (out.std() + 1e-9)


def fbm(n, f0, octaves, seed, gain=0.55, **kw):
    out, a = np.zeros((n, n)), 1.0
    for o in range(octaves):
        out += band(n, f0 * 2 ** o, 0.5, seed + o * 17, **kw) * a
        a *= gain
    return out / out.std()


def norm01(a):
    lo, hi = np.percentile(a, 0.5), np.percentile(a, 99.5)
    return np.clip((a - lo) / (hi - lo), 0, 1)


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def voronoi(n, cells, seed, jitter=0.9, warp=None):
    """Tileable F1/F2 cellular noise with `cells` cells across; returns (F1, F2, cell id random)."""
    rng = np.random.default_rng(seed)
    jx, jy = rng.random((cells, cells)), rng.random((cells, cells))
    rid = rng.random((cells, cells))
    cs = n / cells
    py, px = np.mgrid[0:n, 0:n].astype(np.float64)
    if warp is not None:
        px = px + warp[0]; py = py + warp[1]
    ix, iy = np.floor(px / cs).astype(int), np.floor(py / cs).astype(int)
    f1 = np.full((n, n), 1e9); f2 = np.full((n, n), 1e9); idv = np.zeros((n, n))
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            cx, cy = ix + dx, iy + dy
            wx, wy = cx % cells, cy % cells
            qx = (cx + 0.5 + (jx[wy, wx] - 0.5) * jitter) * cs
            qy = (cy + 0.5 + (jy[wy, wx] - 0.5) * jitter) * cs
            d = np.sqrt((px - qx) ** 2 + (py - qy) ** 2)
            closer = d < f1
            f2 = np.where(closer, f1, np.minimum(f2, d))
            idv = np.where(closer, rid[wy, wx], idv)
            f1 = np.where(closer, d, f1)
    return f1 / cs, f2 / cs, idv


def skin():
    n = 1024
    # folds: long creases in two crossing directions, ridged so the valleys are sharp
    fold_a = np.clip(1 - np.abs(fbm(n, 9, 3, 1, aniso=2.6, angle=0.35)) * 0.6, 0, 1)
    fold_b = np.clip(1 - np.abs(fbm(n, 14, 3, 5, aniso=2.0, angle=1.9)) * 0.6, 0, 1)
    folds = norm01(fold_a ** 2.2 * 0.65 + fold_b ** 2.2 * 0.35)
    # small cracked-hide cells (like elephant skin) and pores
    warp = (fbm(n, 6, 2, 40) * 9, fbm(n, 6, 2, 41) * 9)
    c1, c2, _ = voronoi(n, 70, 3, warp=warp)
    cracks = smooth(0.0, 0.22, c2 - c1)
    pores = norm01(-band(n, 260, 0.35, 9))
    pores = smooth(0.72, 0.95, pores)
    # a few long healed scars: raised welts along random curves
    scars = np.zeros((n, n))
    py, px = np.mgrid[0:n, 0:n].astype(np.float64)
    rng = np.random.default_rng(11)
    for _ in range(5):
        x0, y0, ang, ln = rng.random() * n, rng.random() * n, rng.random() * np.pi, 150 + rng.random() * 250
        for ox in (-n, 0, n):
            for oy in (-n, 0, n):
                dx, dy = px - (x0 + ox), py - (y0 + oy)
                along = dx * np.cos(ang) + dy * np.sin(ang)
                across = -dx * np.sin(ang) + dy * np.cos(ang) + 12 * np.sin(along / 37.0)
                t = np.clip(1 - np.abs(along) / ln, 0, 1)
                scars = np.maximum(scars, np.exp(-(across / (2.5 + 3 * t)) ** 2) * t ** 0.5)
    R = folds * 0.55 + cracks * 0.3 - pores * 0.12 + scars * 0.35 + fbm(n, 40, 3, 21) * 0.05
    R = norm01(R)

    # scales: irregular plates, a dome on each, deep grooves between, cracked edges
    warp = (fbm(n, 5, 2, 50) * 14, fbm(n, 5, 2, 51) * 14)
    f1, f2, cid = voronoi(n, 26, 7, jitter=0.85, warp=warp)
    edge = smooth(0.0, 0.28, f2 - f1)
    dome = np.clip(1 - f1 * 1.1, 0, 1) ** 0.7
    G = edge * (0.55 + 0.25 * dome) * (0.75 + 0.25 * cid) + folds * 0.08 + cracks * 0.08 - pores * 0.05
    G = norm01(G)

    # mottling: large blotches, smaller dark freckles, plus slightly lighter scale tops
    blot = fbm(n, 3, 4, 60)
    freck = smooth(0.55, 0.85, norm01(band(n, 30, 0.5, 61)))
    B = norm01(blot * 0.8 - freck * 0.5 + (cid - 0.5) * 0.3)
    img = np.stack([R, G, B], -1)
    Image.fromarray((img * 255).astype(np.uint8)).save(os.path.join(OUT, 'beast_skin.jpg'), quality=88)


def membrane():
    n = 512
    # veins: thin ridges of stretched noise at three scales, so big vessels split into finer ones
    v = np.zeros((n, n))
    for i, (f, w, th) in enumerate([(3, 1.0, 0.93), (6, 0.75, 0.95), (13, 0.5, 0.965)]):
        r = 1 - np.abs(fbm(n, f, 3, 70 + i * 7, gain=0.45, aniso=1.6, angle=0.5))
        v = np.maximum(v, smooth(th, 0.995, np.clip(r, 0, 1)) * w)
    wr = norm01(fbm(n, 10, 3, 90))
    bl = norm01(fbm(n, 4, 3, 95))
    img = np.stack([v, wr, bl], -1)
    Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).save(os.path.join(OUT, 'beast_membrane.jpg'), quality=88)


if __name__ == '__main__':
    skin()
    membrane()
    for f in ('beast_skin.jpg', 'beast_membrane.jpg'):
        print(f, os.path.getsize(os.path.join(OUT, f)) // 1024, 'KB')
