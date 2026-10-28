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
HEAD_TRIS = 5200                   # decimation target for the scanned surface


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
    yc = c[1] + 0.035 + 0.06 * t      # tilt: the outer corner sits higher
    up = 0.115 * (1 - t * t) ** 0.75 * (1 - 0.25 * t)
    lo = 0.085 * (1 - t * t) ** 0.9
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
    keep &= lowest > -1.95 - 0.28 * np.clip(cen[:, 2], -1, 1)
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
    for a, b in u:
        push(a, b); push(b, a)
    nf = len(F)
    while nf > target and heap:
        _, a, b, va, vb = heapq.heappop(heap)
        if not (alive_v[a] and alive_v[b]) or ver[a] != va or ver[b] != vb: continue
        na, nb_ = nbrs(a), nbrs(b)
        if b not in na: continue
        if len(na & nb_) != 2: continue                 # keep it a manifold
        # no flipped or squashed triangles
        ok = True
        for f in vf[b]:
            if a in F[f]: continue
            t = F[f].copy(); old = P[t]
            n0 = np.cross(old[1] - old[0], old[2] - old[0])
            new = old.copy(); new[list(t).index(b)] = P[a]
            n1 = np.cross(new[1] - new[0], new[2] - new[0])
            if np.dot(n0, n1) <= 0.3 * np.linalg.norm(n0) * np.linalg.norm(n1): ok = False; break
        if not ok: continue
        for f in list(vf[b]):
            if a in F[f]:
                alive_f[f] = False; nf -= 1
                for v in F[f]: vf[v].discard(f)
            else:
                F[f][F[f] == b] = a; vf[a].add(f)
        vf[b] = set(); alive_v[b] = False
        Q[a] += Q[b]; ver[a] += 1
        for n in nbrs(a):
            ver[n] += 1
        for n in nbrs(a):
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
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)


EYE_UV = [np.array([0.962, 0.967]), np.array([0.036, 0.967])]   # the eyeball circles in the texture
EYE_UV_R = 0.026


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
    uv = EYE_UV[0 if side > 0 else 1] + U * EYE_UV_R * np.array([side, 1]) * 0.98
    return P, uv, np.array(F)


@@BODY@@
if __name__ == '__main__':
    src = sys.argv[1] if len(sys.argv) > 1 else '.'
    os.makedirs(OUT, exist_ok=True)
    build_head(src)
