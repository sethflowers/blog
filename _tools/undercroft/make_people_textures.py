"""Builds the Undercroft's people assets (zombies and prisoners) into experiments/undercroft/tex/:

    people_head.bin          the head mesh: a photoscan, eyes opened, neck trimmed, decimated, skin weights
    people_head_col.jpg      head colour for prisoners (scan colour, eyes painted in)
    people_head_zom.jpg      head colour for zombies (greyed, rotting, sunken sockets, milky eyes)
    people_head_nrm.jpg      head normal map (from the scan)
    people_head_dat.jpg      head data: R roughness, G eye mask, B mouth/socket cavity
    people_detail.jpg        tiling detail for the bodies: R skin pores, G cloth weave, B blotches
    people_hair.png          hair card strands (RGBA): left half thick hair, right half thin and stringy

    python3 _tools/undercroft/make_people_textures.py <LeePerrySmith folder>

The head is "Infinite, 3D Head Scan" by Lee Perry-Smith (Infinite Realities, based on a work at
triplegangers.com), CC BY 3.0, as shipped in three.js at examples/models/gltf/LeePerrySmith/. Fetch it with
    git clone --depth 1 --filter=blob:none --sparse https://github.com/mrdoob/three.js.git
    cd three.js && git sparse-checkout set examples/models/gltf/LeePerrySmith
Needs numpy and Pillow. Seeds are fixed, so re-running gives the same files.
"""
import os, sys, json, struct, heapq
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'experiments', 'undercroft', 'tex')
SCALE = 0.047                      # scan units to metres (vertex to chin is about 0.235 m)
PIVOT = np.array([-0.07, -0.35, -0.35])   # the head's pivot (top of the neck) in scan units
HEAD_TRIS = 4500                   # decimation target for the scanned surface


# ---------- loading ----------

def load_glb(path):
    b = open(path, 'rb').read()
    jl = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + jl])
    bo = 20 + jl
    bl = struct.unpack('<I', b[bo:bo + 4])[0]
    data = b[bo + 8:bo + 8 + bl]

    def acc(i):
        a = j['accessors'][i]
        bv = j['bufferViews'][a['bufferView']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        dt = {5123: np.uint16, 5125: np.uint32, 5126: np.float32}[a['componentType']]
        n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[a['type']]
        arr = np.frombuffer(data, dtype=dt, count=a['count'] * n, offset=off)
        return arr.reshape(-1, n).copy() if n > 1 else arr.copy()

    p = j['meshes'][0]['primitives'][0]
    P = acc(p['attributes']['POSITION']).astype(np.float64)
    U = acc(p['attributes']['TEXCOORD_0']).astype(np.float64)
    F = acc(p['indices']).reshape(-1, 3).astype(np.int64)
    return P, U, F


def edge_counts(F):
    e = np.sort(np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]), 1)
    u, c = np.unique(e, axis=0, return_counts=True)
    return u, c


def boundary_loops(F):
    u, c = edge_counts(F)
    bd = u[c == 1]
    adj = {}
    for a, b in bd:
        adj.setdefault(a, []).append(b); adj.setdefault(b, []).append(a)
    seen, loops = set(), []
    for s in adj:
        if s in seen: continue
        st, comp = [s], []
        while st:
            v = st.pop()
            if v in seen: continue
            seen.add(v); comp.append(v); st += adj[v]
        loops.append(comp)
    return loops


def ordered_loop(F, verts):
    """Walks a boundary loop in order (by its boundary edges)."""
    vs = set(verts)
    u, c = edge_counts(F)
    adj = {}
    for a, b in u[c == 1]:
        if a in vs and b in vs:
            adj.setdefault(a, []).append(b); adj.setdefault(b, []).append(a)
    start = verts[0]; out = [start]; prev = None; cur = start
    while True:
        nxt = [n for n in adj[cur] if n != prev]
        if not nxt or nxt[0] == start: break
        prev, cur = cur, nxt[0]; out.append(cur)
    return out


# ---------- the head mesh ----------

EYES = [np.array([0.534, 1.642, 1.62]), np.array([-0.688, 1.71, 1.60])]   # eyeball centres (scan units)
EYE_R = 0.29


def in_almond(x, y, c, side):
    """The opening between the lids, seen from the front: an almond, the outer corner a little higher."""
    w = 0.33
    dx = (x - c[0]) * side            # + toward the outer corner
    t = dx / w
    if abs(t) >= 1: return False
    yc = c[1] + 0.03 + 0.06 * t       # tilt: the outer corner sits higher
    up = 0.09 * (1 - t * t) ** 0.75 * (1 - 0.25 * t)
    lo = 0.068 * (1 - t * t) ** 0.9
    return yc - lo < y < yc + up


def process_head(P, U, F):
    eyeball = ((U[:, 0] > 0.9) | (U[:, 0] < 0.1)) & (U[:, 1] > 0.9)
    # drop the scan's own eyeballs (we add whole ones) and the closed lids in front of the eyes
    keep = ~eyeball[F].all(1)
    cen = P[F].mean(1)
    for c, side in zip(EYES, [1, -1]):
        for i in np.where(keep)[0]:
            x, y, z = cen[i]
            if z > c[2] and in_almond(x, y, c, side): keep[i] = False
    # trim the bust: keep the neck down to just above the collarbones (lower at the front)
    lowest = P[F][:, :, 1].min(1)
    cut = lambda z: -1.45 - 0.25 * np.clip(z, -1, 1)
    keep &= lowest > cut(cen[:, 2])
    # taper the bottom of the neck in a little so its cut edge tucks inside the body's neck
    t = np.clip((cut(P[:, 2]) + 0.4 - P[:, 1]) / 0.4, 0, 1)
    ax = np.array([-0.07, -0.47])
    P[:, [0, 2]] = ax + (P[:, [0, 2]] - ax) * (1 - 0.13 * t)[:, None]
    F = F[keep]
    # tuck the new lid edges onto the eyeball, so the lids hug it instead of ending in a paper edge
    for loop in boundary_loops(F):
        q = P[loop]
        for c in EYES:
            if np.linalg.norm(q.mean(0)[:2] - c[:2]) < 0.2 and q[:, 2].mean() > 1.7:
                for v in loop:
                    d = P[v] - c; r = np.linalg.norm(d)
                    P[v] = c + d / r * (EYE_R + 0.012)
                    # pull the ring around it in a little too, so the lid rolls over the edge
                for v in np.unique(F):
                    d = P[v] - c; r = np.linalg.norm(d)
                    if r < EYE_R + 0.09 and P[v, 2] > c[2] + 0.05 and v not in loop:
                        t = (EYE_R + 0.09 - r) / 0.09
                        P[v] = c + d / r * (r - 0.02 * t)
    # cap the back of the mouth tubes so an open mouth shows a dark throat, not the inside of the head
    caps = []
    for loop in boundary_loops(F):
        q = P[loop]
        if len(loop) < 40 and q[:, 2].mean() < 0.8 and abs(q[:, 1].mean() - 0.4) < 0.3:
            ol = ordered_loop(F, loop)
            ci = len(P); P = np.vstack([P, q.mean(0)]); U = np.vstack([U, U[ol].mean(0)])
            # orient the fan to face back into the tube (toward +z, the mouth)
            a, b = P[ol[0]], P[ol[1]]
            n = np.cross(a - P[ci], b - P[ci])
            flip = n[2] < 0
            for k in range(len(ol)):
                t = [ci, ol[k], ol[(k + 1) % len(ol)]]
                caps.append(t[::-1] if flip else t)
    if caps: F = np.vstack([F, np.array(caps)])
    # compact
    used = np.unique(F)
    remap = -np.ones(len(P), np.int64); remap[used] = np.arange(len(used))
    return P[used], U[used], remap[F]


def jaw_weights(P, F):
    """How much each vertex follows the jaw. A plane from the jaw hinge (in front of the ears) to the lip
    line splits head from jaw; the lip slit is honoured exactly, then it's smoothed over the surface."""
    y_lip = 0.33
    hinge = np.array([0.0, 0.85, 0.25])
    lipf = np.array([0.0, y_lip, 2.0])
    d = lipf - hinge; n = np.array([0.0, d[2], -d[1]]); n /= np.linalg.norm(n)   # normal pointing down-forward
    s = (P - hinge) @ -n                     # >0 below the plane
    w = 1 / (1 + np.exp(-s / 0.06))
    w *= 1 / (1 + np.exp(-(P[:, 2] - 0.05) / 0.12))         # nothing behind the jaw hinge
    w *= 1 / (1 + np.exp(-(P[:, 1] + 1.05 - 0.25 * P[:, 2]) / 0.12))   # fades into the neck under the chin
    # the lips: the slit's lower edge goes with the jaw, the upper edge stays
    fixed = np.zeros(len(P), bool)
    for loop in boundary_loops(F):
        q = P[loop]
        if 1.8 < q[:, 2].mean() and abs(q[:, 1].mean() - 0.35) < 0.2:
            ymid = np.median(q[:, 1])
            for v in loop:
                w[v] = 1.0 if P[v, 1] < ymid else 0.0; fixed[v] = True
    # smooth over the mesh, keeping the fixed ones
    nb = [[] for _ in range(len(P))]
    for a, b, c in F:
        nb[a] += [b, c]; nb[b] += [a, c]; nb[c] += [a, b]
    nb = [np.unique(x) for x in nb]
    for _ in range(12):
        w2 = np.array([w[x].mean() if len(x) else w[i] for i, x in enumerate(nb)])
        w = np.where(fixed, w, w2)
    return np.clip(w, 0, 1)


def neck_weights(P):
    """How much each vertex follows the neck bone rather than the head (the lower neck)."""
    return np.clip((-0.55 - P[:, 1] + 0.3 * P[:, 2]) / 0.9, 0, 1)


# ---------- decimation: quadric error, half-edge collapses, borders and UV seams kept ----------

def decimate(P, U, F, target, importance):
    nv = len(P)
    F = F.copy()
    alive_f = np.ones(len(F), bool)
    Q = np.zeros((nv, 4, 4))
    v0, v1, v2 = P[F[:, 0]], P[F[:, 1]], P[F[:, 2]]
    nrm = np.cross(v1 - v0, v2 - v0); area = np.linalg.norm(nrm, axis=1) / 2
    nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-12)
    dd = -(nrm * v0).sum(1)
    pl = np.c_[nrm, dd]
    wf = area * importance[F].mean(1)
    K = pl[:, :, None] * pl[:, None, :] * wf[:, None, None]
    for k in range(3): np.add.at(Q, F[:, k], K)
    # locked: border vertices and seams (several vertices at one position)
    u, c = edge_counts(F)
    locked = np.zeros(nv, bool); locked[u[c == 1].ravel()] = True
    key = np.round(P * 1e4).astype(np.int64)
    _, inv, cnt = np.unique(key, axis=0, return_inverse=True, return_counts=True)
    locked |= cnt[inv.ravel()] > 1
    vf = [set() for _ in range(nv)]
    for i, (a, b, cc) in enumerate(F): vf[a].add(i); vf[b].add(i); vf[cc].add(i)
    ver = np.zeros(nv, np.int64); alive_v = np.ones(nv, bool)

    def nbrs(v):
        s = set()
        for f in vf[v]: s.update(F[f])
        s.discard(v); return s

    def cost(a, b):            # collapse b into a (b disappears)
        q = Q[a] + Q[b]; p = np.append(P[a], 1.0)
        e = p @ q @ p
        L = np.sum((P[a] - P[b]) ** 2)
        return e + 0.02 * L * L * (importance[a] + importance[b])

    heap = []
    def push(a, b):
        if locked[b]: return
        heapq.heappush(heap, (cost(a, b), a, b, ver[a], ver[b]))
    nf = len(F)
    # a strict pass first; if it stalls short of the target, a looser one allows steeper turns
    for thr in (0.3, 0.0, -0.3):
        if nf <= target: break
        heap = []
        for a in np.where(alive_v)[0]:
            for b in nbrs(a):
                push(a, b)
        while nf > target and heap:
            _, a, b, va, vb = heapq.heappop(heap)
            if not (alive_v[a] and alive_v[b]) or ver[a] != va or ver[b] != vb: continue
            na, nb_ = nbrs(a), nbrs(b)
            if b not in na: continue
            if len(na & nb_) != 2: continue                 # keep it a manifold
            ok = True
            for f in vf[b]:
                if a in F[f]: continue
                t = F[f]; old = P[t]
                n0 = np.cross(old[1] - old[0], old[2] - old[0])
                new = old.copy(); new[list(t).index(b)] = P[a]
                n1 = np.cross(new[1] - new[0], new[2] - new[0])
                if np.dot(n0, n1) <= thr * np.linalg.norm(n0) * np.linalg.norm(n1) or np.linalg.norm(n1) < 1e-14: ok = False; break
            if not ok: continue
            for f in list(vf[b]):
                if a in F[f]:
                    alive_f[f] = False; nf -= 1
                    for v in F[f]: vf[v].discard(f)
                else:
                    F[f][F[f] == b] = a; vf[a].add(f)
            vf[b] = set(); alive_v[b] = False
            Q[a] += Q[b]; ver[a] += 1
            nn = nbrs(a)
            for n in nn: ver[n] += 1
            for n in nn:
                push(a, n); push(n, a)
    F = F[alive_f]
    used = np.unique(F)
    remap = -np.ones(nv, np.int64); remap[used] = np.arange(len(used))
    return used, remap[F]


def vertex_normals(P, F):
    n = np.zeros_like(P)
    fn = np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]])
    for k in range(3): np.add.at(n, F[:, k], fn)
    # vertices that share a position (UV seams) share a normal, so seams don't show
    key = np.round(P * 1e4).astype(np.int64)
    _, inv = np.unique(key, axis=0, return_inverse=True); inv = inv.ravel()
    acc = np.zeros((inv.max() + 1, 3)); np.add.at(acc, inv, n)
    n = acc[inv]
    l = np.linalg.norm(n, axis=1, keepdims=True)
    return np.where(l > 1e-12, n / np.maximum(l, 1e-12), 0.0)




def eyeball(c, side, rings=7, segs=14):
    """Front three quarters of an eyeball with a slight corneal bulge. UVs map the front onto a painted iris."""
    P, U, F = [], [], []
    P.append([0, 0, 1]); U.append([0, 0])
    for r in range(1, rings + 1):
        th = r / rings * 2.0                      # out to ~115 degrees from the front
        for s in range(segs):
            ph = s / segs * 2 * np.pi
            d = np.array([np.sin(th) * np.cos(ph), np.sin(th) * np.sin(ph), np.cos(th)])
            P.append(d); U.append([np.sin(min(th, 1.5)) * np.cos(ph), np.sin(min(th, 1.5)) * np.sin(ph)])
    for s in range(segs):
        F.append([0, 1 + s, 1 + (s + 1) % segs])
    for r in range(rings - 1):
        for s in range(segs):
            a = 1 + r * segs + s; b = 1 + r * segs + (s + 1) % segs
            a2, b2 = a + segs, b + segs
            F += [[a, a2, b2], [a, b2, b]]
    P = np.array(P, float); U = np.array(U, float)
    th = np.arccos(np.clip(P[:, 2], -1, 1))
    bulge = 1 + 0.07 * np.clip(1 - th / 0.6, 0, 1) ** 2      # cornea
    P = P * (EYE_R * bulge)[:, None]
    # look very slightly outward and down, like a resting gaze
    P = P + c
    uv = U * np.array([side, 1]) * 0.5 + 0.5          # the shader paints the iris from these
    return P, uv, np.array(F)


# ---------- the skeleton (the JS reads it from the .bin, so this is the only copy) ----------
# name, parent, offset from parent (bind pose, metres), rest rotation about z (arms hang in a slight A)
ARM_A, LEG_A = 0.30, 0.04
BONES = [
    ('hips', None, (0, 0.97, 0), 0), ('spine', 'hips', (0, 0.10, -0.01), 0), ('chest', 'spine', (0, 0.20, 0), 0),
    ('neck', 'chest', (0, 0.21, -0.02), 0), ('head', 'neck', (0, 0.10, 0.02), 0),
]
for s, sg in (('L', 1), ('R', -1)):
    BONES += [('clav' + s, 'chest', (sg * 0.02, 0.17, 0.0), 0), ('arm' + s, 'clav' + s, (sg * 0.16, -0.01, -0.02), sg * ARM_A),
              ('fore' + s, 'arm' + s, (0, -0.285, 0), 0), ('hand' + s, 'fore' + s, (0, -0.255, 0), 0),
              ('thumb' + s, 'hand' + s, (sg * -0.004, -0.022, 0.024), 0)]
    for f, (z, y) in zip(('idx', 'mid', 'rng', 'pky'), ((0.027, -0.092), (0.009, -0.096), (-0.009, -0.093), (-0.026, -0.086))):
        L1 = {'idx': 0.040, 'mid': 0.045, 'rng': 0.042, 'pky': 0.032}[f]
        BONES += [(f + '1' + s, 'hand' + s, (0, y, z), 0), (f + '2' + s, f + '1' + s, (0, -L1, 0), 0)]
    BONES += [('thigh' + s, 'hips', (sg * 0.09, -0.06, 0), sg * LEG_A), ('shin' + s, 'thigh' + s, (0, -0.43, 0), 0),
              ('foot' + s, 'shin' + s, (0, -0.41, 0), -sg * LEG_A)]
# the jaw and eyes hang off the head; their places come from the scan
JAW_AT = (np.array([0.0, 0.85, 0.25]) - PIVOT) * SCALE
BONES += [('jaw', 'head', tuple(JAW_AT), 0)]
for s, c in zip('LR', EYES): BONES += [('eye' + s, 'head', tuple((c - PIVOT) * SCALE), 0)]
BI = {b[0]: i for i, b in enumerate(BONES)}


def bind_matrices():
    W = []
    for name, par, off, rz in BONES:
        c, s = np.cos(rz), np.sin(rz)
        M = np.array([[c, -s, 0, off[0]], [s, c, 0, off[1]], [0, 0, 1, off[2]], [0, 0, 0, 1.0]])
        W.append(M if par is None else W[BI[par]] @ M)
    return W


BIND = bind_matrices()
J = {b[0]: BIND[i][:3, 3].copy() for i, b in enumerate(BONES)}
NEIGH = []
for i, b in enumerate(BONES):
    n = [i] + ([BI[b[1]]] if b[1] else []) + [k for k, c in enumerate(BONES) if c[1] == b[0]]
    NEIGH.append(n)


# ---------- signed distance pieces (vectorised over points) ----------

def smin(a, b, k):
    h = np.maximum(k - np.abs(a - b), 0) / k
    return np.minimum(a, b) - h * h * k * 0.25


def smax(a, b, k):
    return -smin(-a, -b, k)


def cap(P, a, b, r1, r2):
    a = np.asarray(a, np.float64); b = np.asarray(b, np.float64)
    ba = b - a; pa = P - a
    h = np.clip(pa @ ba / (ba @ ba), 0, 1)
    return np.linalg.norm(pa - h[:, None] * ba, axis=1) - (r1 + (r2 - r1) * h)


def ell(P, c, r, R=None):
    p = P - np.asarray(c)
    if R is not None: p = p @ R            # into the ellipsoid's own axes (columns of R)
    r = np.asarray(r)
    k0 = np.linalg.norm(p / r, axis=1)
    k1 = np.linalg.norm(p / (r * r), axis=1) + 1e-9
    return k0 * (k0 - 1) / k1


def rotz(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1.0]])


# fast tiling-free value noise for cloth tears, folds and dirt
_rng = np.random.default_rng(7)
_PERM = np.concatenate([_rng.permutation(256)] * 2)
_VAL = _rng.random(256)


def vnoise(P):
    i = np.floor(P).astype(np.int64); f = P - i
    f = f * f * (3 - 2 * f)
    def h(dx, dy, dz):
        return _VAL[_PERM[_PERM[_PERM[(i[:, 0] + dx) & 255] + ((i[:, 1] + dy) & 255)] + ((i[:, 2] + dz) & 255)]]
    x0 = h(0, 0, 0) * (1 - f[:, 0]) + h(1, 0, 0) * f[:, 0]
    x1 = h(0, 1, 0) * (1 - f[:, 0]) + h(1, 1, 0) * f[:, 0]
    x2 = h(0, 0, 1) * (1 - f[:, 0]) + h(1, 0, 1) * f[:, 0]
    x3 = h(0, 1, 1) * (1 - f[:, 0]) + h(1, 1, 1) * f[:, 0]
    y0 = x0 * (1 - f[:, 1]) + x1 * f[:, 1]; y1 = x2 * (1 - f[:, 1]) + x3 * f[:, 1]
    return y0 * (1 - f[:, 2]) + y1 * f[:, 2]


def fbm(P, oct=3):
    t, a, s = 0, 0.5, 1.0
    for o in range(oct):
        t = t + a * vnoise(P * s + o * 17.3); s *= 2.03; a *= 0.5
    return t / (1 - 0.5 ** oct)


# ---------- surface nets, vectorised ----------

CORN = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]])
EDG = [(0, 1), (2, 3), (4, 5), (6, 7), (0, 2), (1, 3), (4, 6), (5, 7), (0, 4), (1, 5), (2, 6), (3, 7)]


def surface_nets(fn, lo, hi, cell):
    lo = np.asarray(lo, float); hi = np.asarray(hi, float)
    n = (np.ceil((hi - lo) / cell) + 1).astype(int)
    g = [lo[a] + np.arange(n[a]) * cell for a in range(3)]
    X, Y, Z = np.meshgrid(*g, indexing='ij')
    pts = np.c_[X.ravel(), Y.ravel(), Z.ravel()]
    V = np.concatenate([fn(pts[i:i + 400000]) for i in range(0, len(pts), 400000)]).reshape(n)
    ins = V < 0
    nx, ny, nz = n
    cnt = sum(ins[c[0]:nx - 1 + c[0], c[1]:ny - 1 + c[1], c[2]:nz - 1 + c[2]].astype(np.int8) for c in CORN)
    act = (cnt > 0) & (cnt < 8)
    ai, aj, ak = np.nonzero(act)
    cid = -np.ones(act.shape, np.int64); cid[act] = np.arange(len(ai))
    acc = np.zeros((len(ai), 3)); num = np.zeros(len(ai))
    for e0, e1 in EDG:
        c0, c1 = CORN[e0], CORN[e1]
        va = V[ai + c0[0], aj + c0[1], ak + c0[2]]; vb = V[ai + c1[0], aj + c1[1], ak + c1[2]]
        m = (va < 0) != (vb < 0)
        t = np.where(m, va / np.where(m, va - vb, 1), 0)
        acc += m[:, None] * (c0 + (c1 - c0) * t[:, None]); num += m
    verts = lo + (np.c_[ai, aj, ak] + acc / num[:, None]) * cell
    quads = []
    # x edges
    s0 = ins[:-1, 1:-1, 1:-1]; s1 = ins[1:, 1:-1, 1:-1]
    i, j, k = np.nonzero(s0 != s1); j += 1; k += 1
    q = np.c_[cid[i, j - 1, k - 1], cid[i, j, k - 1], cid[i, j, k], cid[i, j - 1, k]]
    quads.append(np.where(ins[i, j, k][:, None], q, q[:, ::-1]))
    s0 = ins[1:-1, :-1, 1:-1]; s1 = ins[1:-1, 1:, 1:-1]
    i, j, k = np.nonzero(s0 != s1); i += 1; k += 1
    q = np.c_[cid[i - 1, j, k - 1], cid[i - 1, j, k], cid[i, j, k], cid[i, j, k - 1]]
    quads.append(np.where(ins[i, j, k][:, None], q, q[:, ::-1]))
    s0 = ins[1:-1, 1:-1, :-1]; s1 = ins[1:-1, 1:-1, 1:]
    i, j, k = np.nonzero(s0 != s1); i += 1; j += 1
    q = np.c_[cid[i - 1, j - 1, k], cid[i, j - 1, k], cid[i, j, k], cid[i - 1, j, k]]
    quads.append(np.where(ins[i, j, k][:, None], q, q[:, ::-1]))
    q = np.vstack(quads)
    q = q[(q >= 0).all(1)]
    # split each quad along its shorter diagonal
    d1 = np.linalg.norm(verts[q[:, 0]] - verts[q[:, 2]], axis=1); d2 = np.linalg.norm(verts[q[:, 1]] - verts[q[:, 3]], axis=1)
    A = np.where((d1 <= d2)[:, None], np.c_[q[:, 0], q[:, 1], q[:, 2]], np.c_[q[:, 0], q[:, 1], q[:, 3]])
    B = np.where((d1 <= d2)[:, None], np.c_[q[:, 0], q[:, 2], q[:, 3]], np.c_[q[:, 1], q[:, 2], q[:, 3]])
    return verts, np.vstack([A, B])


def sdf_normals(fn, P, h):
    g = np.zeros_like(P)
    for a in range(3):
        d = np.zeros(3); d[a] = h
        g[:, a] = fn(P + d) - fn(P - d)
    return g / np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-12)


def bake_ao(fn, P, N, d1, d2):
    a = np.clip(fn(P + N * d1) / d1, 0, 1); b = np.clip(fn(P + N * d2) / d2, 0, 1)
    return (a * 0.5 + b * 0.5) ** 1.2


def project(fn, P, h, it=2):
    """Pull decimated vertices back onto the surface."""
    for _ in range(it):
        d = fn(P); g = sdf_normals(fn, P, h)
        P = P - g * np.clip(d, -0.004, 0.004)[:, None]
    return P


def mesh_part(fn, lo, hi, cell, target, imp_fn=None):
    V, F = surface_nets(fn, lo, hi, cell)
    imp = imp_fn(V) if imp_fn else np.ones(len(V))
    n0 = len(F)
    used, F = decimate(V, None, F, target, imp)
    V = project(fn, V[used], cell * 0.5)
    print('   meshed', n0, '->', len(F), 'tris')
    return V, F


# ---------- the body field ----------
# Each piece: (bone, distance function, blend). Shape knobs: fat, thin, broad.

def lerp(a, b, t): return np.asarray(a) + (np.asarray(b) - np.asarray(a)) * t


def body_parts(sh):
    f, th, br = sh['fat'], sh['thin'], sh.get('broad', 0)
    W = lambda x: x * (1 - 0.18 * th + 0.12 * f)          # limb girth
    P = []
    add = lambda bone, fn, k: P.append((bone, fn, k))
    add('hips', lambda p: ell(p, (0, 0.95, -0.005), (0.152 + 0.02 * f, 0.10, 0.10 + 0.015 * f)), 0.0)
    for s in (1, -1):
        add('hips', lambda p, s=s: ell(p, (s * 0.068, 0.9, -0.058), (0.078, 0.09, 0.068 + 0.01 * f)), 0.04)
    add('spine', lambda p: ell(p, (0, 1.03, 0.022 + 0.02 * f), (0.132 + 0.03 * f - 0.01 * th, 0.095, 0.088 + 0.045 * f - 0.012 * th)), 0.05)
    add('spine', lambda p: ell(p, (0, 1.12, 0.0), (0.13 + 0.03 * f - 0.012 * th, 0.1, 0.092 + 0.03 * f - 0.01 * th)), 0.06)
    add('chest', lambda p: ell(p, (0, 1.27, -0.012), (0.152 + 0.01 * f + 0.01 * br, 0.17, 0.103 + 0.01 * f)), 0.06)
    for s in (1, -1):
        add('chest', lambda p, s=s: ell(p, (s * 0.066, 1.34, 0.055), (0.074 + 0.008 * br, 0.05, 0.026 + 0.004 * f - 0.008 * th)), 0.03)
        add('chest', lambda p, s=s: ell(p, (s * 0.088, 1.29, -0.06), (0.07, 0.12, 0.055)), 0.05)
        add('chest', lambda p, s=s: ell(p, (s * 0.085, 1.37, -0.085), (0.066, 0.07, 0.03)), 0.04)
        # trapezius: a slope from the neck down to the shoulder
        add('chest', lambda p, s=s: cap(p, (s * 0.02, 1.485, -0.045), (s * (0.14 + 0.01 * br), 1.425, -0.035), 0.04, 0.032), 0.04)
    add('neck', lambda p: cap(p, (0, 1.43, -0.022), (0, 1.55, -0.008), 0.068, 0.05), 0.035)
    for s, n in ((1, 'L'), (-1, 'R')):
        A, E, Wr = J['arm' + n], J['fore' + n], J['hand' + n]
        R = rotz(s * ARM_A)
        add('arm' + n, lambda p, A=A, R=R, s=s: ell(p, A + R @ np.array([s * 0.012, -0.035, 0]), (W(0.054) + 0.006 * br, 0.085, W(0.056)), R), 0.04)
        add('arm' + n, lambda p, A=A, E=E: cap(p, A, E, W(0.047), W(0.037)), 0.03)
        add('arm' + n, lambda p, A=A, E=E, R=R: ell(p, lerp(A, E, 0.5) + np.array([0, 0, 0.012]), (W(0.04), 0.09, W(0.038)), R), 0.03)
        add('fore' + n, lambda p, E=E: ell(p, E + np.array([0, 0.0, -0.008]), (0.036, 0.04, 0.034)), 0.02)
        add('fore' + n, lambda p, E=E, Wr=Wr, R=R: ell(p, lerp(E, Wr, 0.32), (W(0.033), 0.1, W(0.04)), R), 0.03)
        add('fore' + n, lambda p, E=E, Wr=Wr: cap(p, lerp(E, Wr, 0.1), lerp(Wr, E, 0.02), W(0.031), 0.023), 0.03)
        H, K, A2 = J['thigh' + n], J['shin' + n], J['foot' + n]
        add('thigh' + n, lambda p, H=H, K=K: cap(p, lerp(H, K, -0.08), K, W(0.084) + 0.01 * f, W(0.054)), 0.05)
        add('thigh' + n, lambda p, H=H, K=K: ell(p, lerp(H, K, 0.45) + np.array([0, 0, 0.022]), (W(0.062), 0.17, W(0.058)), rotz(s * LEG_A)), 0.04)
        add('thigh' + n, lambda p, H=H, K=K, s=s: ell(p, lerp(H, K, 0.22) + np.array([-s * 0.03, 0, -0.005]), (W(0.06), 0.13, W(0.065)), rotz(s * LEG_A)), 0.04)
        add('shin' + n, lambda p, K=K: ell(p, K + np.array([0, 0.01, 0.012]), (0.052, 0.058, 0.052)), 0.03)
        add('shin' + n, lambda p, K=K, A2=A2: cap(p, K, lerp(K, A2, 1.08), W(0.05), 0.03), 0.03)
        add('shin' + n, lambda p, K=K, A2=A2: ell(p, lerp(K, A2, 0.27) + np.array([0, 0, -0.026]), (W(0.047), 0.11, W(0.05)), rotz(s * LEG_A)), 0.03)
    return P


def union(parts, p):
    d = None
    for bone, fn, k in parts:
        di = fn(p)
        d = di if d is None else (smin(d, di, k) if k > 0 else np.minimum(d, di))
    return d


TORSO_BONES = ('hips', 'spine', 'chest', 'neck')


def drape(parts, p, bones, k):
    """A loose wrap over some of the body pieces: a wide blend fills the hollows the way cloth bridges them."""
    d = None
    for bone, fn, _ in parts:
        if bone not in bones: continue
        di = fn(p)
        d = di if d is None else smin(d, di, k)
    return d


def outfit_fields(sh, o):
    """Returns field(p) -> (skin, top, bottom, belt) distances for a body shape and an outfit."""
    parts = body_parts(sh)
    seed = o['seed']
    J_ = J

    def fields(p):
        skin = union(parts, p)
        # wounds: shallow gouges in the flesh
        for c, r in o.get('wounds', []):
            skin = smax(skin, -ell(p, c, r), 0.006)
        big = 1e3 * np.ones(len(p))
        top = bot = belt = big
        if o.get('top'):
            T = o['top']
            body = drape(parts, p, ('hips', 'spine', 'chest'), 0.045)
            n = fbm(p * 9 + seed, 2)
            # drapes and creases: soft vertical folds hanging from the chest and shoulder blades, pulls toward
            # the armpits, slack bunched over the belt
            hang = fbm(p * np.array([16, 2.5, 16]) + seed, 3)
            pull = fbm(np.c_[p[:, 0] * 9 + p[:, 1] * 9 * np.sign(p[:, 0]), p[:, 1] * 3, p[:, 2] * 9] + seed + 4, 2)
            bunch = fbm(p * np.array([10, 30, 10]) + seed + 8, 2)
            folds = 0.011 * (hang - 0.5) * np.clip((1.36 - p[:, 1]) / 0.2, 0, 1)
            folds += 0.008 * (pull - 0.5) * np.clip(1 - np.abs(p[:, 1] - 1.28) / 0.12, 0, 1)
            folds += 0.008 * (bunch - 0.5) * np.clip(1 - np.abs(p[:, 1] - (T['hem'] + 0.06)) / 0.07, 0, 1)
            t = T['loose'] + 0.006 * n + folds
            top = body - t
            # sleeves
            for s, nm in ((1, 'L'), (-1, 'R')):
                A, E, Wr = J_['arm' + nm], J_['fore' + nm], J_['hand' + nm]
                along = (p - A) @ (rotz(s * ARM_A) @ np.array([0, -1.0, 0]))
                arm = smin(cap(p, A, E, 0.05, 0.04), cap(p, E, Wr, 0.039, 0.028), 0.03)
                ring = fbm(np.c_[along * 28, p[:, 0] * 4, p[:, 2] * 4] + seed + 2 * s, 2)
                sl = arm - (T['loose'] * 0.9 + 0.008 * np.clip(along / 0.4, 0, 1) + 0.004 * n
                            + 0.009 * (ring - 0.5) * (0.4 + np.exp(-((along - 0.29) / 0.07) ** 2)))   # creases bunch at the elbow
                L = T['sleeve'] + (fbm(p * 30 + seed, 2) - 0.5) * T['rag'] * 0.6
                sl = smax(sl, along - L, 0.004)
                top = smin(top, sl, 0.02) if T['sleeve'] > 0.02 else top
            if T['sleeve'] <= 0.02:          # sleeveless: cut the armholes
                for s, nm in ((1, 'L'), (-1, 'R')):
                    top = smax(top, -ell(p, J_['arm' + nm] + np.array([s * 0.03, -0.04, 0]), (0.075, 0.12, 0.1)), 0.008)
            hem = T['hem'] + (fbm(p * np.array([25, 4, 25]) + seed, 2) - 0.5) * T['rag']
            top = smax(top, hem - p[:, 1], 0.004)
            # neckline: round, or a slit down the front
            nk = ell(p, (0, 1.49, -0.012), (0.078, 0.06, 0.075))
            if T.get('vneck'):
                nk = smin(nk, cap(p, (0, 1.47, 0.07), (0, 1.36, 0.11), 0.02, 0.004), 0.02)
            top = smax(top, -nk, 0.008)
            # torn holes
            if T['holes'] > 0:
                hn = fbm(p * 7 + seed * 3, 3)
                top = smax(top, (hn - (0.78 - 0.16 * T['holes'])) * 0.25, 0.004)
            top = smax(top, -(skin + 0.0015), 0.002)            # cloth never sinks under the skin
        if o.get('bottom'):
            B = o['bottom']
            n = fbm(p * 8 + seed + 5, 2)
            legs = []
            for nm in 'LR':
                legs.append(drape(parts, p, ('hips', 'thigh' + nm, 'shin' + nm), 0.05))
            body = np.minimum(legs[0], legs[1])
            low = np.clip((0.55 - p[:, 1]) / 0.45, 0, 1)
            rings = fbm(p * np.array([5, 26, 5]) + seed + 3, 2) - 0.5       # bunched above the ankle and behind the knee
            hang = fbm(p * np.array([14, 2.5, 14]) + seed + 6, 2) - 0.5     # long folds down the shin
            diag = fbm(np.c_[p[:, 0] * 10 - p[:, 1] * 8 * np.sign(p[:, 0]), p[:, 1] * 3, p[:, 2] * 10] + seed, 2) - 0.5
            folds = 0.012 * rings * (low ** 1.5 + 0.6 * np.exp(-((p[:, 1] - 0.47) / 0.06) ** 2))
            folds += 0.008 * hang * np.clip((0.75 - p[:, 1]) / 0.3, 0, 1)
            folds += 0.008 * diag * np.clip(1 - np.abs(p[:, 1] - 0.85) / 0.15, 0, 1)
            t = B['loose'] + 0.012 * low * B.get('flare', 1) + 0.005 * n + folds
            bot = body - t
            bot = smax(bot, p[:, 1] - 1.035, 0.004)               # waistband
            hem = B['hem'] + (fbm(p * np.array([30, 4, 30]) + seed + 9, 2) - 0.5) * B['rag']
            bot = smax(bot, hem - p[:, 1], 0.004)
            if B['holes'] > 0:
                hn = fbm(p * 8 + seed * 5 + 3, 3)
                bot = smax(bot, (hn - (0.8 - 0.14 * B['holes'])) * 0.25, 0.004)
            bot = smax(bot, -(skin + 0.0015), 0.002)
            if o.get('belt'):
                bt = drape(parts, p, ('hips', 'spine'), 0.05) - (B['loose'] + 0.013)
                belt = smax(bt, np.abs(p[:, 1] - 1.01) - (0.018 if o['belt'] == 'leather' else 0.009), 0.004)
                if o['belt'] == 'rope': belt = belt + 0.002 * np.sin(np.arctan2(p[:, 2], p[:, 0]) * 70 + p[:, 1] * 300)
        return skin, top, bot, belt
    return parts, fields


def body_field(fields):
    def fn(p):
        s, t, b, l = fields(p)
        return np.minimum(np.minimum(s, t), np.minimum(b, l))
    return fn


# ---------- hands and feet ----------

FINGERS = {  # MCP (y, z) in the hand bone, segment lengths, base radius, fan (z per y)
    'idx': ((-0.092, 0.027), (0.040, 0.024, 0.020), 0.0095, 0.09),
    'mid': ((-0.096, 0.009), (0.045, 0.028, 0.021), 0.0098, 0.02),
    'rng': ((-0.093, -0.009), (0.042, 0.026, 0.020), 0.0093, -0.05),
    'pky': ((-0.086, -0.026), (0.032, 0.019, 0.017), 0.0080, -0.12),
}
THUMB = [(-0.004, -0.022, 0.024), (-0.013, -0.050, 0.047), (-0.019, -0.073, 0.060), (-0.023, -0.091, 0.067)]


def finger_segments():
    """Per finger: list of (a, b, r1, r2) segments in the left hand's frame, relaxed with a slight curl."""
    out = {}
    for name, ((y, z), lens, r, fan) in FINGERS.items():
        p = np.array([0.0, y, z]); segs = []
        ang = 0.1
        for k, L in enumerate(lens):
            ang += 0.12
            d = np.array([-np.sin(ang), -np.cos(ang), fan * 0.35]); d /= np.linalg.norm(d)
            q = p + d * L
            segs.append((p.copy(), q.copy(), r * (1 - 0.1 * k), r * (0.9 - 0.12 * k)))
            p = q
        out[name] = segs
    return out


FSEG = finger_segments()


def hand_field(p):
    d = ell(p, (0, 0.005, 0), (0.021, 0.035, 0.029))
    d = smin(d, ell(p, (0.001, -0.05, 0.001), (0.0165, 0.052, 0.043)), 0.015)
    d = smin(d, cap(p, (0.0, -0.088, -0.029), (0.0, -0.09, 0.029), 0.0125, 0.0125), 0.012)
    d = smin(d, ell(p, (-0.007, -0.045, -0.022), (0.014, 0.036, 0.016)), 0.01)       # heel of the palm
    d = smin(d, ell(p, (-0.009, -0.042, 0.025), (0.015, 0.03, 0.018)), 0.01)         # ball of the thumb
    for name, segs in FSEG.items():
        a0 = segs[0][0]
        d = smin(d, ell(p, a0 + np.array([0.006, 0, 0]), (0.0095, 0.009, 0.009)), 0.006)   # knuckle
        fd = None
        for a, b, r1, r2 in segs:
            x = cap(p, a, b, r1, r2)
            fd = x if fd is None else smin(fd, x, 0.004)
        # flatter on the back, fuller pads underneath
        d = smin(d, fd, 0.006)
    t = None
    for k in range(3):
        x = cap(p, THUMB[k], THUMB[k + 1], [0.015, 0.011, 0.0098][k], [0.011, 0.0098, 0.0082][k])
        t = x if t is None else smin(t, x, 0.004)
    d = smin(d, t, 0.008)
    # tendons and veins on the back of the hand, very faint
    d -= 0.0007 * np.clip(p[:, 0] / 0.015, 0, 1) * np.sin(p[:, 2] * 260) * np.clip((p[:, 1] + 0.09) / 0.07, 0, 1)
    return d


def hand_bones(p):
    """Per-vertex (bone names, distances) for the left hand: palm, thumb, finger segments."""
    names, ds = ['hand'], [np.minimum(ell(p, (0.001, -0.05, 0.001), (0.0165, 0.052, 0.043)),
                                      ell(p, (0, 0.005, 0), (0.021, 0.035, 0.029)))]
    t = None
    for k in range(3):
        x = cap(p, THUMB[k], THUMB[k + 1], 0.012, 0.009)
        t = x if t is None else np.minimum(t, x)
    names.append('thumb'); ds.append(t)
    for f, segs in FSEG.items():
        names.append(f + '1'); ds.append(cap(p, *segs[0]))
        names.append(f + '2'); ds.append(np.minimum(cap(p, *segs[1]), cap(p, *segs[2])))
    return names, np.array(ds).T


def nail_mask(p, N):
    m = np.zeros(len(p))
    for f, segs in FSEG.items():
        a, b, r1, r2 = segs[2]
        d = np.linalg.norm(p - lerp(a, b, 0.62), axis=1)
        m = np.maximum(m, np.clip((0.0095 - d) / 0.003, 0, 1) * np.clip(N[:, 0] * 2.5 - 0.6, 0, 1))
    a, b = np.array(THUMB[2]), np.array(THUMB[3])
    d = np.linalg.norm(p - lerp(a, b, 0.6), axis=1)
    m = np.maximum(m, np.clip((0.0105 - d) / 0.003, 0, 1) * np.clip((N @ np.array([0.85, 0, 0.5])) * 2.5 - 0.6, 0, 1))
    return m


def foot_field(kind, side):
    def bare(p):
        q = p.copy(); q[:, 0] *= side          # build the left foot; mirror for the right
        a = np.array([0, 0.07, 0])
        d = cap(q, a + (0, 0.07, -0.005), a, 0.034, 0.029)
        d = smin(d, ell(q, a + (0, -0.038, -0.035), (0.03, 0.034, 0.04)), 0.02)             # heel
        d = smin(d, ell(q, a + (0.024, 0.0, -0.005), (0.011, 0.013, 0.012)), 0.008)        # ankle bones
        d = smin(d, ell(q, a + (-0.021, 0.005, -0.002), (0.012, 0.014, 0.013)), 0.008)
        d = smin(d, ell(q, a + (0.002, -0.045, 0.06), (0.042, 0.022, 0.095)), 0.03)         # sole
        d = smin(d, cap(q, a + (0, -0.02, 0.0), a + (-0.004, -0.045, 0.12), 0.03, 0.024), 0.03)
        d = smax(d, -ell(q, a + (-0.04, -0.072, 0.05), (0.02, 0.014, 0.045)), 0.01)          # arch
        toes = [(-0.022, 0.2, 0.012), (-0.004, 0.193, 0.0088), (0.01, 0.186, 0.0082), (0.022, 0.177, 0.0076), (0.032, 0.166, 0.0072)]
        for x, zt, r in toes:
            d = smin(d, cap(q, (x * 0.8, 0.018, zt - 0.05), (x, 0.012, zt), r * 1.15, r), 0.006)
        return smax(d, -q[:, 1] + 0.001, 0.003)                                         # flat on the floor
    def boot(p):
        q = p.copy(); q[:, 0] *= side
        a = np.array([0, 0.07, 0])
        n = fbm(q * 40 + 3, 2)
        d = cap(q, a + (0, 0.13, -0.008), a + (0, -0.01, -0.005), 0.047, 0.045)          # shaft
        d = smin(d, ell(q, a + (0, -0.035, -0.04), (0.04, 0.045, 0.048)), 0.02)
        d = smin(d, ell(q, a + (0.001, -0.042, 0.065), (0.046, 0.032, 0.11)), 0.03)
        d = smin(d, ell(q, (0.002, 0.03, 0.165), (0.043, 0.03, 0.058)), 0.02)              # toe cap
        d -= 0.0025 * (n - 0.5) + 0.0015 * np.sin(q[:, 1] * 260 + n * 8) * np.clip(1 - np.abs(q[:, 1] - 0.09) / 0.04, 0, 1)
        sole = smax(ell(q, (0.002, 0.012, 0.06), (0.05, 0.03, 0.16)), q[:, 1] - 0.022, 0.003)
        d = smin(d, sole, 0.004)
        return smax(d, -q[:, 1] + 0.001, 0.002)
    return bare if kind == 'bare' else boot


_CACHE = {}


def hand_mesh():
    if 'hand' not in _CACHE:
        print('  hand')
        HV, HF = mesh_part(hand_field, (-0.035, -0.2, -0.05), (0.035, 0.045, 0.085), 0.0028, 500)
        HN = sdf_normals(hand_field, HV, 0.0012)        # the field's own normals: smooth fingers at 500 triangles
        hao = bake_ao(hand_field, HV, HN, 0.006, 0.015)
        names, hd = hand_bones(HV)
        _CACHE['hand'] = (HV, HF, HN, hao, names, hd, nail_mask(HV, HN))
    return _CACHE['hand']


def foot_mesh(kind):
    """The left foot around its ankle (x, z relative; y from the floor). The right one is its mirror."""
    if kind not in _CACHE:
        print('  foot', kind)
        ff = foot_field(kind, 1)
        FV, FF = mesh_part(ff, (-0.07, 0.0, -0.1), (0.07, 0.24, 0.26), 0.0042, 300 if kind == 'bare' else 250)
        FN = sdf_normals(ff, FV, 0.002)
        _CACHE[kind] = (FV, FF, FN, bake_ao(ff, FV, FN, 0.008, 0.02))
    return _CACHE[kind]


# ---------- assembling a body ----------

def skin_weights(dist, bone_ids, sigma=0.016):
    """dist: (n, k) distance to each piece, bone_ids: (k,) bone per piece -> (n,4) indices, (n,4) weights.
    Blends only between a vertex's nearest bone and that bone's parent and children, so nothing far reaches in."""
    nb = len(BONES)
    best = np.full((len(dist), nb), 1e9)
    for k, b in enumerate(bone_ids): best[:, b] = np.minimum(best[:, b], dist[:, k])
    bi = best.argmin(1); bd = best.min(1)
    idx = np.zeros((len(dist), 4), np.int64); w = np.zeros((len(dist), 4))
    for v in range(len(dist)):
        c = NEIGH[bi[v]]
        dd = best[v, c] - bd[v]
        ww = np.where(dd < 4 * sigma, np.exp(-dd / sigma), 0)
        o = np.argsort(-ww)[:4]
        idx[v, :len(o)] = np.array(c)[o]; w[v, :len(o)] = ww[o]
    w /= w.sum(1, keepdims=True)
    return idx, w


def to_world(P, M):
    return P @ M[:3, :3].T + M[:3, 3]


def build_body(name, sh, o, cell=0.0095, tris=4200):
    print(' body', name)
    parts, fields = outfit_fields(sh, o)
    fn = body_field(fields)
    def imp(V):
        m = np.ones(len(V))
        for jn in ('foreL', 'foreR', 'shinL', 'shinR', 'armL', 'armR', 'thighL', 'thighR'):
            m += 2.5 * np.exp(-np.sum((V - J[jn]) ** 2, 1) / 0.006)
        return m
    V, F = mesh_part(fn, (-0.5, 0.02, -0.2), (0.5, 1.6, 0.22), cell, tris, imp)
    N = vertex_normals(V, F)
    bad = np.abs(N).sum(1) < 0.5                 # degenerate fans: take the field's normal there
    if bad.any(): N[bad] = sdf_normals(fn, V[bad], 0.004)
    s, t, b, l = fields(V)
    ao = bake_ao(fn, V, N, 0.02, 0.05)
    def reg(me, *others):
        return np.clip((np.minimum.reduce(others) - me) / 0.012, -1, 1)
    W = np.c_[reg(t, s, b, l), reg(b, s, t, l), reg(l, s, t, b), -np.ones(len(V))]
    # anything standing off the skin is cloth (the cut edge of a hem is nearer the skin than any cloth surface)
    off = s > 0.003
    near = np.argmin(np.c_[t, b, l], 1)
    W[off, :3] = -1; W[off, near[off]] = 1
    dist = np.array([fn_(V) for _, fn_, _ in parts]).T
    bids = [BI[bn] for bn, _, _ in parts]
    sidx, sw = skin_weights(dist, bids)
    # grime: worst low down, at knees, hems, and in creases; blood: blotches, soaked in round wounds
    n1 = fbm(V * 6 + o['seed'], 3); n2 = fbm(V * 11 + o['seed'] * 2, 3)
    dirt = np.clip(0.35 * n1 + 0.5 * np.clip((0.6 - V[:, 1]) / 0.6, 0, 1) + 0.3 * (1 - ao), 0, 1)
    blood = np.clip((n2 - 0.35) * 1.6, 0, 1) * 0.75
    blood = np.maximum(blood, np.clip((V[:, 2] > 0.04) * (1.45 - V[:, 1]) * 1.6 * fbm(V * np.array([30, 5, 30]), 2), 0, 1) * (V[:, 1] > 1.0))
    for c, r in o.get('wounds', []):
        blood = np.maximum(blood, np.clip(1.3 - np.linalg.norm((V - c) / np.asarray(r), axis=1) * 0.5, 0, 1))
    S = np.c_[ao, dirt, blood, np.zeros(len(V))]
    out = [(V, F, N, W, S, sidx, sw)]
    # hands
    HV, HF, HN, hao, names, hd, nails = hand_mesh()
    for side, s_ in (('L', 1), ('R', -1)):
        M = BIND[BI['hand' + side]]
        pv = HV.copy(); pn = HN.copy(); f = HF.copy()
        if s_ < 0: pv[:, 0] *= -1; pn[:, 0] *= -1; f = f[:, ::-1]
        wv = to_world(pv, M); wn = pn @ M[:3, :3].T
        sidx, sw = skin_weights(hd, [BI[n + side] for n in names], 0.004)
        cuff = o.get('top', {}).get('sleeve', 0) > 0.5
        hW = np.c_[-np.ones((len(wv), 3)), -np.ones(len(wv))]
        hS = np.c_[0.3 + 0.7 * hao, np.clip(0.5 + 0.4 * fbm(wv * 20 + 3, 2) - 0.3 * hao, 0, 1),
                   np.clip(fbm(wv * 25 + o['seed'], 2) - 0.3, 0, 1) * 1.4, nails]
        out.append((wv, f, wn, hW, hS, sidx, sw))
    # feet
    fk = o['feet']
    LV, LF, LN, lao = foot_mesh(fk)
    for side, s_ in (('L', 1), ('R', -1)):
        A = J['foot' + side]
        FV = LV * np.array([s_, 1, 1]) + A * np.array([1, 0, 1]); FN = LN * np.array([s_, 1, 1]); fao = lao
        FF = LF if s_ > 0 else LF[:, ::-1]
        # the foot follows the foot bone, its top blends into the shin
        up = np.clip((FV[:, 1] - 0.1) / 0.06, 0, 1)
        sidx = np.zeros((len(FV), 4), np.int64); sw = np.zeros((len(FV), 4))
        sidx[:, 0] = BI['foot' + side]; sidx[:, 1] = BI['shin' + side]; sw[:, 0] = 1 - up; sw[:, 1] = up
        lea = 1.0 if fk == 'boot' else -1.0
        fW = np.c_[-np.ones(len(FV)), -np.ones(len(FV)), np.full(len(FV), lea), -np.ones(len(FV))]
        fS = np.c_[0.3 + 0.7 * fao, np.clip(0.75 + 0.3 * fbm(FV * 15, 2), 0, 1), np.clip(fbm(FV * 20 + 5, 2) - 0.45, 0, 1), np.zeros(len(FV))]
        out.append((FV, FF, FN, fW, fS, sidx, sw))
    return out


SHAPES = {
    'avg': dict(fat=0.15, thin=0.2), 'heavy': dict(fat=0.9, thin=0.0, broad=0.6), 'thin': dict(fat=0.0, thin=1.0),
    'lean': dict(fat=0.05, thin=0.55, broad=0.3),
}
OUTFITS = {
    # zombies: worse for wear
    'z_shirt': ('avg', dict(seed=1.0, feet='boot', belt='leather',
                top=dict(loose=0.011, sleeve=0.56, hem=0.9, rag=0.05, holes=0.7),
                bottom=dict(loose=0.011, hem=0.09, rag=0.04, holes=0.5),
                wounds=[((0.27, 1.05, 0.03), (0.03, 0.05, 0.03))])),
    'z_tee': ('heavy', dict(seed=2.0, feet='bare',
              top=dict(loose=0.01, sleeve=0.13, hem=0.93, rag=0.06, holes=1.0),
              bottom=dict(loose=0.012, hem=0.28, rag=0.08, holes=0.7, flare=0.6),
              wounds=[((-0.1, 1.2, 0.1), (0.04, 0.03, 0.03)), ((0.3, 1.0, 0.0), (0.03, 0.04, 0.03))])),
    'z_vest': ('thin', dict(seed=3.0, feet='boot',
               top=dict(loose=0.008, sleeve=0.0, hem=0.92, rag=0.05, holes=0.6, vneck=True),
               bottom=dict(loose=0.012, hem=0.12, rag=0.06, holes=0.6),
               wounds=[((0.24, 1.25, 0.04), (0.03, 0.04, 0.03))])),
    # prisoners: ragged but whole
    'p_tunic': ('lean', dict(seed=4.0, feet='bare', belt='rope',
                top=dict(loose=0.014, sleeve=0.34, hem=0.86, rag=0.035, holes=0.15, vneck=True),
                bottom=dict(loose=0.011, hem=0.1, rag=0.03, holes=0.1))),
    'p_shirt': ('avg', dict(seed=5.0, feet='boot', belt='leather',
                top=dict(loose=0.012, sleeve=0.56, hem=0.92, rag=0.02, holes=0.0),
                bottom=dict(loose=0.012, hem=0.27, rag=0.03, holes=0.15, flare=0.5))),
    'p_thin': ('thin', dict(seed=6.0, feet='bare',
               top=dict(loose=0.013, sleeve=0.45, hem=0.88, rag=0.04, holes=0.25),
               bottom=dict(loose=0.012, hem=0.11, rag=0.05, holes=0.2))),
}


def build_head_mesh(src):
    P, U, F = load_glb(os.path.join(src, 'LeePerrySmith.glb'))
    P, U, F = process_head(P, U, F)
    imp = np.ones(len(P))
    face = (P[:, 2] > 0.9) & (P[:, 1] > -1.1) & (P[:, 1] < 2.6)
    imp[face] = 6.0
    imp[(np.abs(P[:, 0]) > 1.4) & (P[:, 1] > 0.3) & (P[:, 1] < 2.3)] = 3.0     # ears
    for c in EYES: imp[np.linalg.norm(P - c, axis=1) < 0.55] = 14.0
    imp[(np.abs(P[:, 0]) < 0.8) & (np.abs(P[:, 1] - 0.35) < 0.35) & (P[:, 2] > 1.4)] = 10.0   # lips
    print(' head', len(F), 'tris')
    used, F2 = decimate(P, U, F, HEAD_TRIS, imp)
    P, U = P[used], U[used]
    jaw = jaw_weights(P, F2)
    neck = neck_weights(P) * (1 - jaw)
    N = vertex_normals(P, F2)
    head = 1 - jaw - neck
    sidx = np.tile([BI['head'], BI['jaw'], BI['neck'], BI['chest']], (len(P), 1))
    low = np.clip((-1.75 - P[:, 1] + 0.3 * P[:, 2]) / 0.25, 0, 1)          # the very bottom of the neck rides the chest
    sw = np.c_[head, jaw, neck * (1 - low), neck * low]
    parts = [(P, U, F2, N, sidx, sw, hairline(P) * 0.45)]
    for c, side, nm in zip(EYES, [1, -1], 'LR'):
        ep, eu, ef = eyeball(c, side)
        en = (ep - c) / np.linalg.norm(ep - c, axis=1, keepdims=True)
        es = np.tile([BI['eye' + nm], 0, 0, 0], (len(ep), 1)); ew = np.tile([1.0, 0, 0, 0], (len(ep), 1))
        parts.append((ep, eu, ef, en, es, ew, np.ones(len(ep))))
    Ps, Us, Fs, Ns, Ss, Ws, Ks = [], [], [], [], [], [], []
    off = 0
    for p, u, f, n, si, w, k in parts:
        Ps.append(p); Us.append(u); Fs.append(f + off); Ns.append(n); Ss.append(si); Ws.append(w); Ks.append(k); off += len(p)
    P = to_world((np.vstack(Ps) - PIVOT) * SCALE, BIND[BI['head']])
    return dict(position=P, normal=np.vstack(Ns), uv=np.vstack(Us), skinIndex=np.vstack(Ss), skinWeight=np.vstack(Ws),
                aK=np.concatenate(Ks), index=np.vstack(Fs))


def pack_body(parts):
    off = 0; acc = {k: [] for k in ('position', 'normal', 'aW', 'aS', 'skinIndex', 'skinWeight', 'index')}
    for V, F, N, W, S, si, sw in parts:
        acc['position'].append(V); acc['normal'].append(N); acc['aW'].append(W); acc['aS'].append(S)
        acc['skinIndex'].append(si); acc['skinWeight'].append(sw); acc['index'].append(F + off); off += len(V)
    return {k: np.vstack(v) for k, v in acc.items()}


ENC = {  # attribute -> (numpy type, components, normalized)
    'position': ('<f4', 3, False), 'normal': ('i1', 3, True), 'uv': ('<u2', 2, True), 'aW': ('i1', 4, True),
    'aS': ('u1', 4, True), 'aK': ('u1', 1, True), 'skinIndex': ('u1', 4, False), 'skinWeight': ('u1', 4, True),
}


def encode(a, kind):
    t, n, norm = ENC[kind]
    a = np.asarray(a, float).reshape(len(a), -1)
    if not norm: return a.astype(t)
    if t in ('i1',): return np.round(np.clip(a, -1, 1) * 127).astype(t)
    if t == 'u1':
        if kind == 'skinWeight':        # keep the weights summing to exactly 255
            q = np.floor(a * 255).astype(int); r = 255 - q.sum(1); q[np.arange(len(q)), a.argmax(1)] += r
            return q.astype('u1')
        return np.round(np.clip(a, 0, 1) * 255).astype(t)
    return np.round(np.clip(a, 0, 1) * 65535).astype(t)


def write_bin(meshes, path):
    header = {'bones': [{'name': b[0], 'parent': b[1], 'pos': list(b[2]), 'rz': b[3]} for b in BONES], 'meshes': {}}
    blobs = []; off = 0
    for name, m in meshes.items():
        ent = {'count': len(m['position']), 'attributes': {}}
        for k, v in m.items():
            if k == 'index':
                b = np.asarray(v).astype('<u2').tobytes(); ent['index'] = {'offset': off, 'count': int(np.asarray(v).size)}
            else:
                b = encode(v, k).tobytes(); t, n, norm = ENC[k]
                ent['attributes'][k] = {'offset': off, 'type': t.strip('<'), 'size': n, 'normalized': norm}
            pad = (-len(b)) % 4; blobs.append(b + b'\0' * pad); off += len(b) + pad
        tris = int(np.asarray(m['index']).size // 3)
        ent['triangles'] = tris
        header['meshes'][name] = ent
        print('  ', name, ent['count'], 'verts', tris, 'tris')
    js = json.dumps(header).encode(); js += b' ' * ((-len(js)) % 4)
    with open(path, 'wb') as fo:
        fo.write(b'PPL1'); fo.write(struct.pack('<I', len(js))); fo.write(js)
        for b in blobs: fo.write(b)
    print('wrote', path, os.path.getsize(path), 'bytes')


def build_meshes(src, only=None):
    meshes = {}
    meshes['head'] = build_head_mesh(src)
    HP_, HU_, HF_ = load_glb(os.path.join(src, 'LeePerrySmith.glb'))
    HP_, HU_, HF_ = process_head(HP_, HU_, HF_)
    for st in HAIR_STYLES: meshes['hair_' + st] = build_hair(HP_, HF_, st)
    for name, (shape, o) in OUTFITS.items():
        if only and name not in only: continue
        meshes[name] = pack_body(build_body(name, SHAPES[shape], o))
    write_bin(meshes, os.path.join(OUT, 'people.bin'))


# ---------- hair cards ----------
# Grown on the scan's scalp: each card is a strip of strands, rooted just above the skin, combed away from the
# crown and pulled by gravity. Cards live in the head bone's space (they ride on it, unskinned).

def hairline(P):
    """1 where hair grows on the scan (scan units), soft at the edge: above the forehead, temples and nape."""
    zs = np.array([-2.2, -1.3, -0.6, 0.2, 0.9, 1.4, 2.2]); ys = np.array([0.15, 0.45, 1.5, 2.05, 2.35, 2.85, 3.0])
    yl = np.interp(P[:, 2], zs, ys)
    m = smooth01(-0.12, 0.12, P[:, 1] - yl)
    ear = (np.abs(P[:, 0] + 0.07) > 1.45) & (P[:, 1] < 2.25) & (np.abs(P[:, 2] + 0.1) < 0.75)
    return m * (~ear)


HAIR_STYLES = {
    # cards, length (scan units), lift, gravity, randomness, atlas half (0 thick, 1 thin), width
    'cropped': dict(n=90, L=(0.4, 0.65), lift=0.02, grav=0.3, mess=0.25, half=0, w=0.5, seed=1, cover=1.0, rise=0.03),
    'short': dict(n=170, L=(0.8, 1.3), lift=0.03, grav=0.45, mess=0.3, half=0, w=0.5, seed=2, cover=1.0, rise=0.06),
    'messy': dict(n=170, L=(1.1, 1.9), lift=0.04, grav=0.35, mess=0.7, half=0, w=0.55, seed=3, cover=1.0, rise=0.1),
    'long': dict(n=180, L=(2.4, 4.0), lift=0.04, grav=0.8, mess=0.3, half=0, w=0.6, seed=4, cover=1.0, rise=0.08),
    'thin': dict(n=55, L=(1.6, 3.2), lift=0.02, grav=0.85, mess=0.4, half=1, w=0.55, seed=5, cover=0.6, rise=0.03),
}


def build_hair(P, F, style):
    st = HAIR_STYLES[style]; rng = np.random.default_rng(st['seed'])
    N = vertex_normals(P, F)
    mask = hairline(P)
    # pick roots, area weighted, inside the hairline (patchy for the thin style)
    tri = P[F]; area = np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1) / 2
    fm = mask[F].mean(1)
    if st['cover'] < 1: fm *= fbm(tri.mean(1) * 0.9 + 4, 2) > 0.45
    w = area * (fm > 0.6); w /= w.sum()
    crown = np.array([-0.1, 3.3, -1.0])
    pos, nor, uv, idx = [], [], [], []
    K = 3
    def keep_off(q, h):
        i = np.argmin(np.sum((P - q) ** 2, 1))
        d = (q - P[i]) @ N[i]
        return q + N[i] * (h - d) if d < h else q
    for c in range(st['n']):
        f = rng.choice(len(F), p=w)
        b = rng.dirichlet([1, 1, 1])
        p0 = b @ tri[f]; n = b @ N[F[f]]; n /= np.linalg.norm(n)
        comb = p0 - crown; comb -= n * (comb @ n)
        down = np.array([0, -1.0, -0.15]); down -= n * (down @ n)
        d = comb / (np.linalg.norm(comb) + 1e-9) * (1 - st['grav']) + down / (np.linalg.norm(down) + 1e-9) * st['grav']
        d += rng.normal(0, st['mess'], 3); d -= n * (d @ n); d /= np.linalg.norm(d) + 1e-9
        L = rng.uniform(*st['L']); wdt = st['w'] * rng.uniform(0.7, 1.2)
        across = np.cross(n, d); across /= np.linalg.norm(across) + 1e-9
        u0 = st['half'] * 0.5 + rng.uniform(0, 0.5 - 0.13); u1 = u0 + 0.13
        base = len(pos)
        q = p0 + n * st['lift']; nn = n
        for k in range(K + 1):
            t = k / K
            # follow the skull: bend the direction toward the surface as it goes, droop past the head
            for e in (-1, 1):
                pos.append(q + across * wdt * 0.5 * e * (1 - 0.35 * t)); nor.append(nn)
                uv.append([u0 if e < 0 else u1, 1 - t * 0.98])
            if k < K:
                q = q + d * (L / K)
                # lie along the skull, a little higher toward the tip, hanging free past it
                q = keep_off(q, st['lift'] + st['rise'] * (k + 1))
                d = d + np.array([0, -1.0, 0]) * st['grav'] * 0.35 + rng.normal(0, st['mess'] * 0.15, 3)
                d /= np.linalg.norm(d)
                nn = n * 0.7 + np.array([0, 0.3, 0]); nn /= np.linalg.norm(nn)
        for k in range(K):
            a = base + 2 * k
            idx += [[a, a + 3, a + 1], [a, a + 2, a + 3]]      # facing out, away from the scalp
    P2 = (np.array(pos) - PIVOT) * SCALE
    print('   hair', style, len(idx), 'tris')
    return dict(position=P2, normal=np.array(nor), uv=np.array(uv), index=np.array(idx))


# ---------- textures ----------

def periodic_noise(size, cells, rng):
    g = rng.random((cells, cells))
    x = np.arange(size) * cells / size
    i0 = np.floor(x).astype(int); f = x - i0; f = f * f * (3 - 2 * f); i1 = (i0 + 1) % cells
    a = g[np.ix_(i0, i0)]; b = g[np.ix_(i0, i1)]; c = g[np.ix_(i1, i0)]; d = g[np.ix_(i1, i1)]
    fx = f[None, :]; fy = f[:, None]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def periodic_fbm(size, cells, octaves, rng, gain=0.5):
    t = np.zeros((size, size)); a = 1; n = 0
    for o in range(octaves):
        t += a * periodic_noise(size, cells * 2 ** o, rng); n += a; a *= gain
    return t / n


def pblur(img, sigma):
    h, w = img.shape
    fy = np.fft.fftfreq(h)[:, None]; fx = np.fft.fftfreq(w)[None, :]
    return np.real(np.fft.ifft2(np.fft.fft2(img) * np.exp(-2 * (np.pi * sigma) ** 2 * (fx * fx + fy * fy))))


def norm01(a):
    a = a - a.min(); return a / max(a.max(), 1e-9)


def detail_texture():
    """R: skin (pores, fine creases), G: cloth (a coarse plain weave with slubs and fuzz), B: blotches."""
    N = 512; rng = np.random.default_rng(11)
    # skin: pits, a web of fine creases, soft lumps
    pits = np.zeros((N, N))
    for _ in range(5200):
        x, y = rng.integers(0, N, 2); pits[y, x] -= rng.uniform(0.5, 1.0)
    pits = pblur(pits, 1.1)
    cr = periodic_fbm(N, 16, 3, rng)
    creases = -np.exp(-((cr - 0.5) / 0.018) ** 2)
    cr2 = periodic_fbm(N, 24, 2, rng)
    creases += -0.6 * np.exp(-((cr2 - 0.5) / 0.015) ** 2)
    lumps = periodic_fbm(N, 6, 3, rng)
    skin = norm01(pblur(pits, 0.4) * 1.0 + pblur(creases, 0.7) * 0.6 + lumps * 0.8)
    # cloth: 40 threads each way, over-under
    T = 40; x = np.arange(N) * T / N
    X, Y = np.meshgrid(x, x)
    wob = (periodic_fbm(N, 8, 2, rng) - 0.5) * 0.35
    ix = np.floor(X + wob).astype(int); iy = np.floor(Y - wob).astype(int)
    fx = X + wob - np.floor(X + wob); fy = Y - wob - np.floor(Y - wob)
    slub_w = rng.uniform(0.75, 1.15, T); slub_h = rng.uniform(0.75, 1.15, T)
    warp = np.sin(np.pi * fx) ** 0.7 * slub_w[ix % T]
    weft = np.sin(np.pi * fy) ** 0.7 * slub_h[iy % T]
    over = ((ix + iy) % 2 == 0)
    # the thread on top arches over the crossing, the one beneath dips
    weave = np.where(over, warp * (0.75 + 0.25 * np.sin(np.pi * fy)), weft * (0.75 + 0.25 * np.sin(np.pi * fx)))
    fuzz = periodic_fbm(N, 64, 2, rng)
    cloth = norm01(weave * 0.85 + fuzz * 0.25 + periodic_fbm(N, 5, 2, rng) * 0.3)
    blot = norm01(periodic_fbm(N, 5, 5, rng, 0.6))
    img = np.stack([skin, cloth, blot], -1)
    Image.fromarray((img * 255).astype(np.uint8)).save(os.path.join(OUT, 'people_detail.jpg'), quality=90)


def hair_texture():
    """Strands for hair cards; the root is at the top. Left half: thick hair. Right half: thin, stringy, clumped."""
    W, H = 256, 512; rng = np.random.default_rng(5)
    S = 4
    big = Image.new('LA', (W * S, H * S), (0, 0)); d = ImageDraw.Draw(big)
    def strands(x0, x1, count, clumps, thick):
        cx = rng.uniform(x0 + 6, x1 - 6, clumps)
        for _ in range(count):
            c = rng.integers(0, clumps)
            x = np.clip(cx[c] + rng.normal(0, (x1 - x0) / clumps * 0.6), x0 + 2, x1 - 2)
            length = rng.uniform(0.55, 1.0) * H
            lum = int(rng.uniform(170, 255))
            pts = []
            bend = rng.normal(0, 6); ph = rng.uniform(0, 6.28)
            for k in range(25):
                t = k / 24; y = t * length
                pts.append(((x + bend * t * t + 2.5 * np.sin(t * 7 + ph)) * S, y * S))
            for k in range(24):
                t = k / 24
                a = int(255 * min(1, (1 - t) * 1.6) * (0.75 + 0.25 * rng.random()))
                d.line([pts[k], pts[k + 1]], fill=(lum, a), width=max(1, int(thick * S * (1 - 0.5 * t))))
    strands(0, W // 2, 125, 8, 0.9)
    strands(W // 2, W, 70, 4, 1.5)
    img = big.resize((W, H), Image.LANCZOS)
    la = np.asarray(img).astype(float)
    lum = la[..., 0] / np.maximum(la[..., 1] / 255, 1e-3); lum = np.clip(lum, 0, 255)
    rgba = np.zeros((H, W, 4), np.uint8)
    rgba[..., 0] = rgba[..., 1] = rgba[..., 2] = np.where(la[..., 1] > 0, lum, 128).astype(np.uint8)
    rgba[..., 3] = la[..., 1].astype(np.uint8)
    Image.fromarray(rgba, 'RGBA').save(os.path.join(OUT, 'people_hair.png'), optimize=True)


def uv_position_map(P, U, F, size):
    """Rasterises the head in UV space: every texel gets the scan-space point it shows (for painting in 3D)."""
    pos = np.zeros((size, size, 3)); cov = np.zeros((size, size), bool)
    uv = np.c_[U[:, 0] * size - 0.5, (1 - U[:, 1]) * size - 0.5]
    for f in F:
        a, b, c = uv[f]
        x0, y0 = np.floor(np.minimum.reduce([a, b, c])).astype(int); x1, y1 = np.ceil(np.maximum.reduce([a, b, c])).astype(int)
        x0, y0 = max(x0 - 1, 0), max(y0 - 1, 0); x1, y1 = min(x1 + 1, size - 1), min(y1 + 1, size - 1)
        if x1 < x0 or y1 < y0: continue
        X, Y = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(den) < 1e-12: continue
        l1 = ((b[1] - c[1]) * (X - c[0]) + (c[0] - b[0]) * (Y - c[1])) / den
        l2 = ((c[1] - a[1]) * (X - c[0]) + (a[0] - c[0]) * (Y - c[1])) / den
        l3 = 1 - l1 - l2
        m = (l1 > -0.02) & (l2 > -0.02) & (l3 > -0.02)
        pos[Y[m], X[m]] = l1[m, None] * P[f[0]] + l2[m, None] * P[f[1]] + l3[m, None] * P[f[2]]
        cov[Y[m], X[m]] = True
    # bleed into the gaps so filtering never picks up empty texels
    for _ in range(6):
        grow = ~cov
        acc = np.zeros_like(pos); n = np.zeros(cov.shape)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            acc += np.roll(np.roll(pos * cov[..., None], dy, 0), dx, 1); n += np.roll(np.roll(cov, dy, 0), dx, 1)
        fill = grow & (n > 0)
        pos[fill] = acc[fill] / n[fill, None]; cov = cov | fill
    return pos, cov


def smooth01(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)


def head_textures(src):
    P, U, F = load_glb(os.path.join(src, 'LeePerrySmith.glb'))
    S = 1024
    pos, cov = uv_position_map(P, U, F, S)
    pp = pos.reshape(-1, 3)
    col = np.asarray(Image.open(os.path.join(src, 'Map-COL.jpg')).convert('RGB').resize((S, S))).astype(float) / 255
    spec = np.asarray(Image.open(os.path.join(src, 'Map-SPEC.jpg')).convert('L').resize((S, S))).astype(float) / 255
    nrm = Image.open(os.path.join(src, 'Infinite-Level_02_Tangent_SmoothUV.jpg')).convert('RGB').resize((S, S))
    nrm.save(os.path.join(OUT, 'people_head_nrm.jpg'), quality=92)
    d_eye = np.minimum(*[np.linalg.norm((pp - (c + np.array([0, 0.05, 0.3]))) * np.array([1, 1.25, 1]), axis=1) for c in EYES]).reshape(S, S)
    lip = np.array([-0.07, 0.33, 1.95])
    d_lip = np.linalg.norm((pp - lip) * np.array([0.75, 2.2, 1]), axis=1).reshape(S, S)
    rows = np.arange(S)[:, None] * np.ones((1, S))
    d_mouthz = (rows > 0.86 * S) & (np.abs(pp[:, 0].reshape(S, S) + 0.07) < 1.0) & (pp[:, 2].reshape(S, S) > 0.3)   # the mouth's inside (its own UV islands)
    n1 = fbm(pp * 1.3 + 1, 4).reshape(S, S); n2 = fbm(pp * 3.1 + 7, 4).reshape(S, S); n3 = fbm(pp * 7 + 3, 3).reshape(S, S)
    lum = col @ np.array([0.3, 0.55, 0.15])
    detail = lum / np.median(lum[cov])                     # the scan's own pores, stubble and creases
    # prisoners: the scan, a touch less pink, a little grime ground in
    pc = col.copy()
    pc = pc * 0.9 + lum[..., None] * 0.1
    pc *= (0.92 + 0.12 * n2)[..., None]
    pc[..., 2] *= 0.97
    Image.fromarray((np.clip(pc, 0, 1) * 255).astype(np.uint8)).save(os.path.join(OUT, 'people_head_col.jpg'), quality=90)
    # zombies: dead grey-green skin, blotched and bruised, veins, dark cracked lips, sunken bruised sockets
    base = np.array([0.36, 0.38, 0.33])
    zc = base * (0.8 + 0.4 * n1)[..., None]
    zc = zc * (1 - 0.35 * smooth01(0.55, 0.75, n2))[..., None] + np.array([0.20, 0.13, 0.17]) * 0.35 * smooth01(0.55, 0.75, n2)[..., None]   # bruises
    zc = zc * (1 - smooth01(0.6, 0.8, n1) * 0.25)[..., None] + np.array([0.42, 0.40, 0.22]) * (smooth01(0.6, 0.8, n1) * 0.25)[..., None]
    zc *= np.clip(detail, 0.4, 1.6)[..., None] ** 1.3
    veins = np.exp(-((fbm(pp * 2.2 + 11, 3).reshape(S, S) - 0.5) / 0.012) ** 2) * smooth01(0.45, 0.7, n3)
    veins *= 1 - smooth01(2.2, 2.9, pp[:, 1].reshape(S, S)) * smooth01(0.5, 1.2, pp[:, 2].reshape(S, S))   # not across the forehead
    zc = zc * (1 - 0.45 * veins)[..., None] + np.array([0.12, 0.16, 0.2]) * (0.45 * veins)[..., None]
    rot = smooth01(0.66, 0.74, n3) * smooth01(0.5, 0.7, n1)
    zc = zc * (1 - rot * 0.7)[..., None] + np.array([0.18, 0.12, 0.08]) * (rot * 0.7)[..., None]
    sock = 1 - smooth01(0.25, 0.75, d_eye)
    zc = zc * (1 - 0.72 * sock)[..., None] + np.array([0.16, 0.06, 0.08]) * (0.4 * sock * (1 - sock))[..., None]
    lips = 1 - smooth01(0.25, 0.7, d_lip)
    zc = zc * (1 - 0.55 * lips)[..., None] + np.array([0.14, 0.09, 0.1]) * (0.3 * lips)[..., None]
    # dried blood round the mouth and down the chin
    drip = smooth01(0.0, 1.0, (0.33 - pp[:, 1].reshape(S, S)) / 1.4 + 0.3) * (1 - smooth01(0.4, 1.2, np.abs(pp[:, 0].reshape(S, S) + 0.07) - 0.3 * fbm(pp * np.array([6, 0.6, 6]), 2).reshape(S, S)))
    blood = np.clip(np.maximum(lips * 0.15, drip * (pp[:, 2].reshape(S, S) > 0.8) * smooth01(0.45, 0.6, fbm(pp * np.array([5, 1, 5]) + 2, 3).reshape(S, S))), 0, 1)
    zc = zc * (1 - 0.7 * blood)[..., None] + np.array([0.13, 0.025, 0.018]) * (0.7 * blood)[..., None]
    zc[d_mouthz] *= 0.3
    Image.fromarray((np.clip(zc, 0, 1) * 255).astype(np.uint8)).save(os.path.join(OUT, 'people_head_zom.jpg'), quality=90)
    # data: roughness from the scan's specular, cavity from its colour detail, and a mask for extra grime and blood
    rough = np.clip(0.78 - 0.5 * spec, 0.25, 0.9)
    cav = np.clip(0.5 + (detail - pblur(detail, 6)) * 1.5, 0, 1)
    mask = np.clip(0.55 * n3 + 0.3 * (1 - smooth01(0.6, 1.8, d_lip)) + 0.2 * (1 - smooth01(0.0, 1.0, (pp[:, 1].reshape(S, S) + 1.0))), 0, 1)
    dat = np.stack([rough, cav, mask], -1)
    Image.fromarray((dat * 255).astype(np.uint8)).save(os.path.join(OUT, 'people_head_dat.jpg'), quality=92)


if __name__ == '__main__':
    src = sys.argv[1] if len(sys.argv) > 1 else '.'
    os.makedirs(OUT, exist_ok=True)
    what = sys.argv[2:]
    if not what or 'tex' in what:
        detail_texture(); hair_texture(); head_textures(src)
    if not what or 'mesh' in what or any(w in OUTFITS for w in what):
        build_meshes(src, [w for w in what if w in OUTFITS] or None)
