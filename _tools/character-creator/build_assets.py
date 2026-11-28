#!/usr/bin/env python3
"""Builds the Character Creator's data from MakeHuman's CC0 assets.

MakeHuman's base mesh, morph targets, skeleton, skins, hair, eyebrows, eyelashes, eyes, teeth and
clothes were released under CC0 (public domain) in 2020. This script reads them and writes compact
files for the browser into experiments/character-creator/data/ (it doesn't use MakeHuman's program
code, which is AGPL; the file formats are simple text):

  base.bin      the base mesh (every vertex, including the helper shells clothes and hair are fitted
                to), the body's triangles and texture coordinates, the skeleton, its skin weights
  targets.bin   the morph targets: the macro ones (gender, age, muscle, weight, height, proportions,
                ethnicity, breasts), every modelling slider (left and right merged into one), the
                expression units (blinking, smiling...)
  assets.bin    every fitted part (eyes, eyebrows, eyelashes, teeth, tongue, hair, clothes, hats,
                shoes, glasses): its own mesh, how each of its vertices follows the body, which body
                vertices it hides
  tex/*.webp    the textures, shrunk (skins 2048 px, others 1024 px or less)
  manifest.json what's in them (sliders, assets, textures), read by js/mh.js

Each .bin is gzip-compressed (the page unpacks it with DecompressionStream). Inside: a little-endian
u32 JSON length, the JSON (array names, types, offsets, lengths), padding to 4 bytes, then the arrays.

Use (Python 3 with numpy and Pillow):
  git clone --depth 1 https://github.com/makehumancommunity/makehuman.git /tmp/mh/mh
  curl -LO https://files2.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip
  unzip makehuman_system_assets_cc0.zip -d /tmp/mh/sys
  curl -LO https://files2.makehumancommunity.org/asset_packs/hair01/hair01_cc0.zip && unzip hair01_cc0.zip -d /tmp/mh/packs/hair01_cc0
  python3 _tools/character-creator/build_assets.py /tmp/mh/mh/makehuman/data /tmp/mh/sys [/tmp/mh/packs]
"""
import gzip, io, json, os, re, struct, sys, glob
import numpy as np
from PIL import Image

MH = sys.argv[1] if len(sys.argv) > 1 else '/tmp/mh/mh/makehuman/data'
SYS = sys.argv[2] if len(sys.argv) > 2 else '/tmp/mh/sys'
PACKS = sys.argv[3] if len(sys.argv) > 3 else '/tmp/mh/packs'
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
OUT = os.path.join(ROOT, 'experiments/character-creator/data')
os.makedirs(os.path.join(OUT, 'tex'), exist_ok=True)
SCALE = 0.1   # MakeHuman works in decimetres

def pack(path, arrays, meta=None):
    """arrays: list of (name, numpy array). Writes the gzipped container."""
    desc, blobs, off = [], [], 0
    for name, a in arrays:
        a = np.ascontiguousarray(a)
        b = a.tobytes()
        desc.append({'name': name, 'type': a.dtype.name, 'offset': off, 'length': int(a.size)})
        pad = (-len(b)) % 4
        blobs.append(b + b'\0' * pad)
        off += len(b) + pad
    j = json.dumps({'arrays': desc, 'meta': meta or {}}, separators=(',', ':')).encode()
    j += b' ' * ((-len(j)) % 4)
    raw = struct.pack('<I', len(j)) + j + b''.join(blobs)
    with open(path, 'wb') as f:
        f.write(gzip.compress(raw, 9, mtime=0))
    print(f'  {os.path.relpath(path, ROOT)}: {len(raw) / 1e6:.2f} MB raw, {os.path.getsize(path) / 1e6:.2f} MB gzipped')

# ---------------------------------------------------------------- base mesh
def read_obj(path):
    v, vt, faces, group = [], [], [], None
    with open(path) as f:
        for line in f:
            if line.startswith('v '): v.append([float(x) for x in line.split()[1:4]])
            elif line.startswith('vt '): vt.append([float(x) for x in line.split()[1:3]])
            elif line.startswith('g '): group = line.split()[1]
            elif line.startswith('f '):
                corners = []
                for c in line.split()[1:]:
                    p = c.split('/')
                    corners.append((int(p[0]) - 1, int(p[1]) - 1 if len(p) > 1 and p[1] else -1))
                faces.append((group, corners))
    return np.array(v, np.float64), np.array(vt, np.float64) if vt else np.zeros((0, 2)), faces

print('base mesh')
bv, bvt, bfaces = read_obj(os.path.join(MH, '3dobjs/base.obj'))
N = len(bv)
def render_mesh(faces, keep):
    """unique (vertex, uv) pairs -> render vertices; triangles; render vertex -> source vertex"""
    key, rv, ruv, idx = {}, [], [], []
    for g, cs in faces:
        if not keep(g): continue
        ids = []
        for vi, ti in cs:
            k = (vi, ti)
            if k not in key:
                key[k] = len(rv); rv.append(vi); ruv.append(bvt_cur[ti] if ti >= 0 else (0, 0))
            ids.append(key[k])
        for t in range(1, len(ids) - 1): idx += [ids[0], ids[t], ids[t + 1]]
    return np.array(rv), np.array(ruv, np.float32), np.array(idx)
bvt_cur = bvt
body_rv, body_uv, body_idx = render_mesh(bfaces, lambda g: g == 'body')
print(f'  {N} vertices, body: {len(body_rv)} render vertices, {len(body_idx) // 3} triangles')

# ---------------------------------------------------------------- skeleton
skel = json.load(open(os.path.join(MH, 'rigs/default.mhskel')))
wts = json.load(open(os.path.join(MH, 'rigs/default_weights.mhw')))['weights']
bone_names = list(skel['bones'].keys())
# parents first
order, seen = [], set()
def visit(b):
    if b in seen: return
    p = skel['bones'][b]['parent']
    if p: visit(p)
    seen.add(b); order.append(b)
for b in bone_names: visit(b)
bone_names = order
joint_names = sorted(skel['joints'].keys())
jidx = {n: i for i, n in enumerate(joint_names)}
joint_off, joint_verts = [0], []
for n in joint_names:
    joint_verts += skel['joints'][n]; joint_off.append(len(joint_verts))
bones = []
for b in bone_names:
    d = skel['bones'][b]
    bones.append([b, bone_names.index(d['parent']) if d['parent'] else -1, jidx[d['head']], jidx[d['tail']]])
# top four weights per vertex
W = [[] for _ in range(N)]
for b, lst in wts.items():
    bi = bone_names.index(b)
    for vi, w in lst: W[vi].append((w, bi))
skin_i = np.zeros((N, 4), np.uint8); skin_w = np.zeros((N, 4), np.float32)
for vi in range(N):
    l = sorted(W[vi], reverse=True)[:4]
    s = sum(w for w, _ in l) or 1
    for k, (w, bi) in enumerate(l): skin_i[vi, k] = bi; skin_w[vi, k] = w / s
print(f'  skeleton: {len(bones)} bones, {len(joint_names)} joints')

# groups of vertices that are useful at run time (for hiding, the eye centres...)
groups = {}
for g, cs in bfaces:
    for vi, _ in cs: groups.setdefault(g, set()).add(vi)
def gverts(name): return np.array(sorted(groups.get(name, [])), np.uint16)

pack(os.path.join(OUT, 'base.bin'), [
    ('pos', (bv * SCALE).astype(np.float32)),
    ('bodyRV', body_rv.astype(np.uint16)), ('bodyUV', body_uv), ('bodyIndex', body_idx.astype(np.uint16)),
    ('jointOff', np.array(joint_off, np.uint32)), ('jointVerts', np.array(joint_verts, np.uint16)),
    ('skinIndex', skin_i), ('skinWeight', skin_w),
    ('eyeL', gverts('helper-l-eye')), ('eyeR', gverts('helper-r-eye')),
], {'bones': bones, 'vertexCount': N})

# ---------------------------------------------------------------- targets
def read_target(path):
    idx, d = [], []
    with open(path) as f:
        for line in f:
            if not line.strip() or line.startswith('#'): continue
            p = line.split()
            idx.append(int(p[0])); d.append([float(p[1]), float(p[2]), float(p[3])])
    return np.array(idx, np.int64), np.array(d, np.float64) * SCALE

targets = {}   # name -> (idx, deltas)
def add_target(name, *paths):
    acc = {}
    for p in paths:
        if not os.path.exists(p): return False
        i, d = read_target(p)
        for k, v in zip(i, d): acc[k] = acc.get(k, 0) + v
    if not acc: targets[name] = (np.zeros(0, np.int64), np.zeros((0, 3)))
    else:
        ks = np.array(sorted(acc)); targets[name] = (ks, np.array([acc[k] for k in ks]))
    return True
T = os.path.join(MH, 'targets')
GENDERS, AGES, LEVELS = ['female', 'male'], ['child', 'young', 'old'], ['min', 'average', 'max']
print('targets')
for g in GENDERS:
    for a in AGES:
        for m in LEVELS:
            for w in LEVELS:
                add_target(f'macro/universal-{g}-{a}-{m}muscle-{w}weight', f'{T}/macrodetails/universal-{g}-{a}-{m}muscle-{w}weight.target')
        for e in ['african', 'asian', 'caucasian']:
            add_target(f'macro/{e}-{g}-{a}', f'{T}/macrodetails/{e}-{g}-{a}.target')
        for h in ['min', 'max']:
            add_target(f'macro/height-{g}-{a}-{h}', f'{T}/macrodetails/height/{g}-{a}-averagemuscle-averageweight-{h}height.target')
        for p in ['ideal', 'uncommon']:
            add_target(f'macro/proportions-{g}-{a}-{p}', f'{T}/macrodetails/proportions/{g}-{a}-averagemuscle-averageweight-{p}proportions.target')
        for cup in LEVELS:
            for firm in LEVELS:
                if cup == 'average' and firm == 'average': continue
                add_target(f'macro/breast-{g}-{a}-{cup}-{firm}', f'{T}/breast/{g}-{a}-averagemuscle-averageweight-{cup}cup-{firm}firmness.target')

# the modelling sliders, in MakeHuman's own groups; left and right merged into one slider
sliders = []
def slider_files(mod):
    grp, name = mod.split('/')
    if '|' in name:
        m = re.match(r'(.*)-([a-z0-9]+)\|([a-z0-9]+)$', name)
        base, lo, hi = m.groups()
        return grp, base, [f'{T}/{grp}/{base}-{lo}.target', f'{T}/{grp}/{base}-{hi}.target'], (lo, hi)
    return grp, name, [f'{T}/{grp}/{name}.target'], None
WORDS = {'trans': 'move', 'scale': 'size', 'horiz': 'width', 'vert': 'height', 'incr': '', 'decr': '', 'invertedtriangular': 'inverted triangle',
         'triangular': 'triangle', 'rectangular': 'rectangle', 'circ': 'around', 'dist': 'distance', 'ext': 'outer', 'lowerlip': 'lower lip',
         'upperlip': 'upper lip', 'cupidsbow': "Cupid's bow", 'eyefold': 'eyelid fold', 'upperarm': 'upper arm', 'lowerarm': 'forearm',
         'upperleg': 'thigh', 'lowerleg': 'calf', 'upperlegs': 'thighs', 'lowerlegs': 'calves', 'napetowaist': 'nape to waist',
         'waisttohip': 'waist to hip', 'frontchest': 'front chest', 'underbust': 'under bust', 'vshape': 'V shape', 'septumangle': 'septum angle'}
def pretty(s):
    s = re.sub(r'^(l|r)-', '', s)
    words = [WORDS.get(w, w) for w in s.split('-')]
    return re.sub(r'\s+', ' ', ' '.join(w for w in words if w)).strip().capitalize()
seen_names = set()
for fn in ['modeling_sliders.json', 'measurement_sliders.json']:
    d = json.load(open(os.path.join(MH, 'modifiers', fn)))
    for tab, v in d.items():
        if tab in ('Macro modelling', 'Gender') and fn == 'modeling_sliders.json':
            if tab == 'Gender':
                pass
            else:
                continue
        for grp_label, lst in v['modifiers'].items():
            if grp_label == 'Genitals': continue
            for s in lst:
                mod = s['mod']
                if mod in ('breast/BreastSize', 'breast/BreastFirmness'): continue
                grp, base, files, ends = slider_files(mod)
                side = re.match(r'^(l|r)-', base)
                if side and side.group(1) == 'r': continue   # merged into the left one
                plain = re.sub(r'^l-', '', base)
                name = f'{plain}-{ends[0]}|{ends[1]}' if ends else plain
                if name in seen_names: continue
                seen_names.add(name)
                both = [files]
                if side: both.append([f.replace('/l-', '/r-') for f in files])
                ok = True
                tnames = []
                if ends:
                    for k, end in enumerate(ends):
                        tnames.append(f'mod/{plain}-{end}')
                        ok &= add_target(tnames[-1], *[fl[k] for fl in both])
                else:
                    tnames.append(f'mod/{plain}')
                    ok &= add_target(tnames[-1], *[fl[0] for fl in both])
                if not ok: print('   (missing)', mod); continue
                label = s.get('label') or pretty(plain)
                label = re.sub(r'^(Left|Right) ', '', label)
                sliders.append({'name': name, 'group': ('Measure ' if fn.startswith('measure') else '') + re.sub(r'^(left|right) ', '', grp_label),
                                'tab': 'Measure' if fn.startswith('measure') else tab, 'targets': tnames, 'label': label})
print(f'  {len(sliders)} sliders')
# expressions: the caucasian units, left and right together
EU = f'{T}/expression/units/caucasian'
expr = {}
for f in sorted(glob.glob(EU + '/*.target')):
    n = os.path.basename(f)[:-7]
    pair = n.replace('-left', '').replace('-right', '')
    expr.setdefault(pair, []).append(f)
for n, fs in expr.items(): add_target(f'expr/{n}', *fs)
print(f'  {len(expr)} expression units')

names = list(targets.keys())
offs, counts, scales, allI, allD = [], [], [], [], []
o = 0
for n in names:
    i, d = targets[n]
    mx = float(np.abs(d).max()) if len(d) else 1.0
    sc = (mx / 32767.0) or 1e-9
    q = np.round(d / sc).astype(np.int16) if len(d) else np.zeros((0, 3), np.int16)
    # indices as differences (they're sorted) so they gzip well; the page adds them up again
    di = np.diff(np.concatenate([[0], i])).astype(np.uint16) if len(i) else np.zeros(0, np.uint16)
    offs.append(o); counts.append(len(i)); scales.append(sc); allI.append(di); allD.append(q)
    o += len(i)
pack(os.path.join(OUT, 'targets.bin'), [
    ('index', np.concatenate(allI).astype(np.uint16)), ('delta', np.concatenate(allD).astype(np.int16)),
    ('offset', np.array(offs, np.uint32)), ('count', np.array(counts, np.uint32)), ('scale', np.array(scales, np.float32)),
], {'names': names})

# ---------------------------------------------------------------- textures
GRAY_MEAN = {}
def save_tex(src, name, size, alpha=False, quality=82, gray=False):
    out = os.path.join(OUT, 'tex', name + '.webp')
    im = Image.open(src)
    im = im.convert('RGBA' if alpha else 'RGB')
    if gray:
        # hair and brows are coloured at run time: keep their shading (scaled so the brightest
        # strands are near white), drop their colour, and remember the average for the tint
        a = im.getchannel('A') if alpha else None
        arr = np.asarray(im.convert('L'), np.float32)
        mask = (np.asarray(a) > 128) if a is not None else np.ones(arr.shape, bool)
        if not mask.any(): mask = np.ones(arr.shape, bool)
        hi = np.percentile(arr[mask], 97)
        arr = np.clip(arr / max(hi, 1) * 235, 0, 255)
        linear = ((arr / 255.0 + 0.055) / 1.055) ** 2.4
        GRAY_MEAN[name] = float(linear[mask].mean())
        l = Image.fromarray(arr.astype(np.uint8))
        im = Image.merge('RGBA', (l, l, l, a)) if alpha else l.convert('RGB')
    if max(im.size) > size: im = im.resize((size, size), Image.LANCZOS)
    im.save(out, 'WEBP', quality=quality, method=6, exact=alpha)
    return name + '.webp'

# ---------------------------------------------------------------- fitted assets (proxies)
def read_mhmat(path):
    m = {}
    if not os.path.exists(path): return m
    for line in open(path):
        line = line.strip()
        if not line or line.startswith('#') or line.startswith('//'): continue
        p = line.split(None, 1)
        if len(p) == 2: m[p[0]] = p[1]
    return m
def read_mhclo(path):
    d = {'refs': [], 'weights': [], 'offsets': [], 'delete': [], 'scale': {}}
    mode = None
    folder = os.path.dirname(path)
    for line in open(path, encoding='utf-8', errors='replace'):
        s = line.strip()
        if not s or s.startswith('#'): continue
        p = s.split()
        if p[0] in ('x_scale', 'y_scale', 'z_scale'): d['scale'][p[0][0]] = [int(p[1]), int(p[2]), float(p[3])]; continue
        if p[0] == 'verts': mode = 'v'; continue
        if p[0] == 'delete_verts': mode = 'd'; continue
        if p[0] in ('obj_file', 'material', 'name', 'z_depth', 'uuid', 'basemesh', 'tag', 'max_pole', 'special_pose', 'vertexboneweights_file', 'offset_scale', 'version', 'author', 'license', 'description', 'homepage', 'weights'):
            d[p[0]] = s.split(None, 1)[1] if len(p) > 1 else ''
            continue
        if mode == 'v' and re.match(r'^-?\d', p[0]):
            if len(p) >= 9:
                d['refs'].append([int(p[0]), int(p[1]), int(p[2])]); d['weights'].append([float(p[3]), float(p[4]), float(p[5])]); d['offsets'].append([float(p[6]), float(p[7]), float(p[8])])
            elif len(p) == 1:
                d['refs'].append([int(p[0])] * 3); d['weights'].append([1, 0, 0]); d['offsets'].append([0, 0, 0])
            continue
        if mode == 'd':
            k = 0
            while k < len(p):
                if k + 2 < len(p) and p[k + 1] == '-': d['delete'] += list(range(int(p[k]), int(p[k + 2]) + 1)); k += 3
                else: d['delete'].append(int(p[k])); k += 1
    d['folder'] = folder
    return d

assets, arrays = [], []
def add_asset(kind, aid, mhclo, label, texsize=1024, gray=False, keep_color=True, mat_override=None):
    if not os.path.exists(mhclo): print('   missing', mhclo); return
    c = read_mhclo(mhclo)
    obj = os.path.join(c['folder'], c.get('obj_file', '').strip() or (aid + '.obj'))
    if not os.path.exists(obj):
        cand = glob.glob(os.path.join(c['folder'], '*.obj'))
        if not cand: print('   no obj for', aid); return
        obj = cand[0]
    global bvt_cur
    pv, pvt, pf = read_obj(obj)
    bvt_cur = pvt
    rv, ruv, ridx = render_mesh(pf, lambda g: True)
    nv = len(pv)
    if len(c['refs']) < nv: print('   bad fit', aid, len(c['refs']), nv); return
    mat_path = mat_override or os.path.join(c['folder'], c.get('material', '').strip() or '')
    mat = read_mhmat(mat_path)
    if not mat:
        cand = glob.glob(os.path.join(c['folder'], '*.mhmat'))
        mat_path = cand[0] if cand else ''
        mat = read_mhmat(mat_path) if cand else {}
    tex = {}
    for key, out, alpha in [('diffuseTexture', 'map', True), ('normalmapTexture', 'normal', False), ('aomapTexture', 'ao', False), ('transparencymapTexture', 'alpha', False)]:
        if key in mat and not (kind == 'hair' and out == 'normal'):   # (hair normal maps made strands look like chrome)
            src = os.path.join(os.path.dirname(mat_path), os.path.basename(mat[key]))
            if not os.path.exists(src): src = os.path.join(c['folder'], os.path.basename(mat[key]))
            if os.path.exists(src):
                has_alpha = alpha and Image.open(src).mode in ('RGBA', 'LA', 'P')
                tex[out] = save_tex(src, f'{kind}-{aid}-{out}', 512 if out in ('ao',) else texsize, alpha=has_alpha, gray=gray and out == 'map', quality=80)
    pre = f'a{len(assets)}'
    refs = np.array(c['refs'][:nv], np.uint16); w = np.array(c['weights'][:nv], np.float32); off = np.array(c['offsets'][:nv], np.float32)
    arrays.extend([(pre + 'refs', refs[rv]), (pre + 'w', w[rv]), (pre + 'off', off[rv]), (pre + 'uv', ruv), (pre + 'index', ridx.astype(np.uint16 if len(rv) < 65536 else np.uint32))])
    if c['delete']: arrays.append((pre + 'del', np.array(sorted(set(c['delete'])), np.uint16)))
    sc = {k: [v[0], v[1], v[2] * SCALE] for k, v in c['scale'].items()}
    assets.append({'kind': kind, 'id': aid, 'label': label, 'key': pre, 'scale': sc, 'tex': tex, 'del': bool(c['delete']),
                   'zDepth': int(c.get('z_depth', '0').split()[0] or 0), 'alpha': 'map' in tex and Image.open(os.path.join(OUT, 'tex', tex['map'])).mode == 'RGBA',
                   'shininess': float(mat.get('shininess', '0.3').split()[0]), 'gray': round(GRAY_MEAN.get(f'{kind}-{aid}-map', 0), 4) if gray else 0})
    print(f'   {kind}/{aid}: {len(rv)} vertices, textures {list(tex)}')

print('assets')
add_asset('eyes', 'eyes', os.path.join(MH, 'eyes/high-poly/high-poly.mhclo'), 'Eyes', 512, mat_override=os.path.join(SYS, 'eyes/materials/brown.mhmat'))
add_asset('teeth', 'teeth', os.path.join(SYS, 'teeth/teeth_base/teeth_base.mhclo'), 'Teeth', 512)
add_asset('tongue', 'tongue', os.path.join(SYS, 'tongue/tongue01/tongue01.mhclo'), 'Tongue', 256)
for f in sorted(glob.glob(os.path.join(SYS, 'eyebrows/*/*.mhclo'))):
    add_asset('brows', os.path.basename(f)[:-6], f, 'Brows ' + os.path.basename(f)[-8:-6].lstrip('0'), 512, gray=True)
for f in sorted(glob.glob(os.path.join(SYS, 'eyelashes/*/*.mhclo'))):
    add_asset('lashes', os.path.basename(f)[:-6], f, 'Lashes ' + os.path.basename(f)[-8:-6].lstrip('0'), 256, gray=True)
HAIR = {'short01': 'Short', 'short02': 'Short messy', 'short03': 'Crop', 'short04': 'Buzz', 'bob01': 'Bob', 'bob02': 'Long bob',
        'long01': 'Long', 'ponytail01': 'Ponytail', 'braid01': 'Braid', 'afro01': 'Afro'}
for h, label in HAIR.items(): add_asset('hair', h, os.path.join(SYS, f'hair/{h}/{h}.mhclo'), label, 1024, gray=True)
CLOTHES = {'male_casualsuit01': ('outfit', 'Denim shirt, jeans'), 'male_casualsuit02': ('outfit', 'Logo top, jeans'), 'male_casualsuit03': ('outfit', 'Striped shirt, jeans'),
           'male_casualsuit04': ('outfit', 'Logo tee, jeans'), 'male_casualsuit05': ('outfit', 'Jacket, jeans'), 'male_casualsuit06': ('outfit', 'White tee, jeans'),
           'male_elegantsuit01': ('outfit', 'Suit and tie'), 'male_worksuit01': ('outfit', 'Overalls'),
           'female_casualsuit01': ('outfit', 'T-shirt, jeans'), 'female_casualsuit02': ('outfit', 'T-shirt, shorts'),
           'female_elegantsuit01': ('outfit', 'Blouse, skirt'), 'female_sportsuit01': ('outfit', 'Crop top, leggings'),
           'shoes01': ('shoes', 'Brown shoes'), 'shoes02': ('shoes', 'Grey shoes'), 'shoes03': ('shoes', 'Boots'), 'shoes04': ('shoes', 'Black shoes'),
           'shoes05': ('shoes', 'White trainers'), 'shoes06': ('shoes', 'Blue trainers'), 'fedora01': ('hat', 'Fedora'), 'fedora_cocked': ('hat', 'Tilted fedora')}
for cid, (kind, label) in CLOTHES.items():
    f = glob.glob(os.path.join(SYS, f'clothes/{cid}/*.mhclo'))
    if f: add_asset(kind, cid, f[0], label, 1024)
# More hair from MakeHuman's community pack "hair01" (hair01_cc0.zip, unpacked into PACKS/hair01_cc0).
# The pack's index calls every style CC0, but some files' own headers say AGPL or CC-BY: only the ones
# where both agree (or the file says nothing and its author's entry says CC0) are used. Appended after
# the system hair, so the order of the hair choices (which character codes rely on) doesn't change.
PACK_HAIR = {'cortu_shaggy_green_hair': 'Shaggy', 'cortu_short_messy_hair': 'Messy', 'cortu_straight_bangs': 'Straight, fringe',
             'cortu_strawberry_cloud_hair': 'Curly', 'culturalibre_hair_05': 'Swept', 'culturalibre_hair_06': 'Choppy',
             'faydaen_hair_1': 'Tousled', 'toigo_blunt_bob': 'Blunt bob', 'toigo_blunt_bob_with_bangs': 'Blunt bob, fringe',
             'toigo_curled_under_bob': 'Curled bob', 'toigo_curled_under_bob_with_bangs': 'Curled bob, fringe',
             'toigo_inverted_bob': 'Inverted bob', 'toigo_inverted_bob_with_bangs': 'Inverted bob, fringe'}
for h, label in PACK_HAIR.items():
    f = os.path.join(PACKS, 'hair01_cc0', 'hair', h, h + '.mhclo')
    if os.path.exists(f): add_asset('hair', h, f, label, 1024, gray=True)
    else: print('   (hair pack not unpacked: skipping', h + ')')

pack(os.path.join(OUT, 'assets.bin'), arrays, {'assets': assets})

# ---------------------------------------------------------------- skins
print('skins')
skins = []
for f in sorted(glob.glob(os.path.join(SYS, 'skins/*/*.mhmat'))):
    sid = os.path.basename(os.path.dirname(f))
    if 'special' in sid or 'toon' in sid: continue
    m = read_mhmat(f)
    if 'diffuseTexture' not in m: continue
    src = os.path.join(os.path.dirname(f), os.path.basename(m['diffuseTexture']))
    name = save_tex(src, 'skin-' + sid, 2048, quality=82)
    # the skin's average colour (of the face), so its tone can be changed while keeping its detail
    im = np.asarray(Image.open(src).convert('RGB').resize((256, 256)), np.float32)
    face = im[60:200, 150:230]
    parts = sid.split('_')
    skins.append({'id': sid, 'tex': name, 'age': parts[0], 'ethnic': parts[1], 'gender': parts[2], 'mean': [round(float(x)) for x in face.reshape(-1, 3).mean(0)]})
    print('  ', sid)

eye_tex = []
for f in sorted(glob.glob(os.path.join(SYS, 'eyes/materials/*.mhmat'))):
    m = read_mhmat(f)
    src = os.path.join(os.path.dirname(f), os.path.basename(m.get('diffuseTexture', '')))
    if os.path.exists(src): eye_tex.append({'id': os.path.basename(f)[:-6], 'tex': save_tex(src, 'eye-' + os.path.basename(f)[:-6], 512, alpha=True)})

json.dump({'sliders': sliders, 'skins': skins, 'eyes': eye_tex,
           'licence': 'MakeHuman assets, CC0 (public domain): base mesh, targets, skeleton, skins, hair, eyebrows, eyelashes, eyes, teeth, tongue, clothes.'},
          open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1)
total = sum(os.path.getsize(p) for p in glob.glob(os.path.join(OUT, '**/*'), recursive=True) if os.path.isfile(p))
print(f'total {total / 1e6:.1f} MB')

# the list of data files, for the service worker to save for offline use
files = sorted(os.path.relpath(p, os.path.dirname(OUT)).replace(os.sep, '/') for p in glob.glob(os.path.join(OUT, '**/*'), recursive=True)
               if os.path.isfile(p) and not p.endswith('files.json'))
json.dump(files, open(os.path.join(OUT, 'files.json'), 'w'), indent=0)
print(f'{len(files)} data files listed in data/files.json')
