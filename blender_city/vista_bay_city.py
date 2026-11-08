"""
VISTA BAY - procedural open-world city map for Blender
=======================================================

An original sun-soaked coastal city in the style of open-world crime/driving
games: downtown skyscrapers, grid streets with lane markings and crosswalks,
an elevated freeway ring, suburbs with pools, a beach with a pier and ferris
wheel, a container port with cranes and a cargo ship, an airport, a stadium,
a park, and hills with mansions and radio towers.

Everything is generated from code (no external assets). Colors are procedural
materials built for Cycles. Render output is 4K (3840 x 2160).

HOW TO RUN
----------
In Blender (4.2 or newer, tested on 5.0):
    1. Open Blender -> "Scripting" workspace.
    2. Open this file in the Text Editor, press "Run Script".
       (Generation takes ~1-3 minutes. The current scene is wiped first.)
    3. Pick a camera (Cam_Aerial / Cam_Map / Cam_Street / Cam_Beach),
       press Numpad 0 to look through it, F12 to render.

From a terminal (no UI):
    blender -b -P vista_bay_city.py -- --render
    blender -b -P vista_bay_city.py -- --time NIGHT --render --cams Cam_Aerial
    blender -b -P vista_bay_city.py -- --save vista_bay.blend

Command line options (after the "--"):
    --render            render all cameras (or those in --cams) to ./renders/
    --cams A,B          comma separated camera names to render
    --time T            DAY | SUNSET | NIGHT
    --samples N         Cycles samples (default 256)
    --res WxH           resolution (default 3840x2160)
    --detail F          0.3 .. 1.0, lowers object counts for weak PCs
    --save FILE.blend   save the generated scene
    --no-haze           disable atmospheric haze volume (faster renders)
    --out DIR           output folder for renders
    --jpg               save renders as JPEG instead of PNG
"""

import bpy
import bmesh
import math
import os
import random
import sys
import time
from mathutils import Vector, Matrix, noise

# =============================================================================
# CONFIG
# =============================================================================
SEED = 7
TIME_OF_DAY = "SUNSET"          # "DAY", "SUNSET", "NIGHT"
RES_X, RES_Y = 3840, 2160       # 4K UHD
SAMPLES = 256
DETAIL = 1.0                    # 0.3 .. 1.0  (scales tree / car / prop counts)
HAZE = True                     # atmospheric depth haze (volume)
RENDER_ON_RUN = False
RENDER_CAMS = None              # None = all cameras
SAVE_BLEND = ""
OUTPUT_DIR = ""                 # "" = ./renders next to the .blend / script
IMG_FORMAT = "PNG"              # "PNG" or "JPEG"


def parse_args():
    global TIME_OF_DAY, RES_X, RES_Y, SAMPLES, DETAIL, HAZE
    global RENDER_ON_RUN, RENDER_CAMS, SAVE_BLEND, OUTPUT_DIR, IMG_FORMAT
    if "--" not in sys.argv:
        return
    a = sys.argv[sys.argv.index("--") + 1:]
    i = 0
    while i < len(a):
        k = a[i]
        nxt = a[i + 1] if i + 1 < len(a) else None
        if k == "--render":
            RENDER_ON_RUN = True
        elif k == "--no-haze":
            HAZE = False
        elif k == "--time" and nxt:
            TIME_OF_DAY = nxt.upper(); i += 1
        elif k == "--samples" and nxt:
            SAMPLES = int(nxt); i += 1
        elif k == "--res" and nxt:
            RES_X, RES_Y = (int(v) for v in nxt.lower().split("x")); i += 1
        elif k == "--detail" and nxt:
            DETAIL = max(0.1, min(1.0, float(nxt))); i += 1
        elif k == "--cams" and nxt:
            RENDER_CAMS = nxt.split(","); i += 1
        elif k == "--save" and nxt:
            SAVE_BLEND = nxt; i += 1
        elif k == "--out" and nxt:
            OUTPUT_DIR = nxt; i += 1
        elif k == "--jpg":
            IMG_FORMAT = "JPEG"
        i += 1


# =============================================================================
# WORLD LAYOUT CONSTANTS
# =============================================================================
ROAD_W = 14.0
HALF_ROAD = ROAD_W / 2
SIDEWALK = 3.0
CURB_H = 0.2
X_ROADS = [-680 + 80 * i for i in range(18)]     # -680 .. 680
Y_ROADS = [-380 + 80 * j for j in range(11)]     # -380 .. 420
DT = (0.0, 60.0)                                 # downtown center
WATER_Z = -1.5
COAST_Y = -395.0
FLAT = (-770.0, 1760.0, 470.0)                   # xmin, xmax, ymax of flat land

PARK_RECT = (-440.0, 20.0, -280.0, 180.0)
STADIUM_RECT = (200.0, 180.0, 360.0, 340.0)
SPECIAL_RECTS = [PARK_RECT, STADIUM_RECT]

FWY_Z = 11.0
FWY_W = 24.0
FWY_RING = (-280.0, -300.0, 360.0, 340.0, 55.0)  # x0, y0, x1, y1, corner radius

rng = random.Random(SEED)


def srgb(c):
    """sRGB-ish color (0..1) -> linear, as stored in color attributes."""
    return (c[0] ** 2.2, c[1] ** 2.2, c[2] ** 2.2)


def lerp(a, b, t):
    return a + (b - a) * t


def lerp3(a, b, t):
    return (lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t))


def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def inside(rect, x, y, margin=0.0):
    return rect[0] + margin < x < rect[2] - margin and rect[1] + margin < y < rect[3] - margin


def in_special(x, y, margin=1.0):
    return any(inside(r, x, y, margin) for r in SPECIAL_RECTS)


def n_scaled(n):
    return max(1, int(n * DETAIL))


# =============================================================================
# MATRIX HELPERS
# =============================================================================
def T(x, y, z):
    return Matrix.Translation((x, y, z))


def Rz(a):
    return Matrix.Rotation(a, 4, 'Z')


def Rx(a):
    return Matrix.Rotation(a, 4, 'X')


def Ry(a):
    return Matrix.Rotation(a, 4, 'Y')


def S(x, y=None, z=None):
    if y is None:
        y = z = x
    return Matrix.Diagonal((x, y, z, 1.0))


# =============================================================================
# GEOMETRY TEMPLATES
# =============================================================================
CUBE_F = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]


class Tpl:
    def __init__(self, v, f):
        self.v = [Vector(p) for p in v]
        self.f = [tuple(x) for x in f]


def tpl_cube(z0=0.0):
    """Unit cube, x/y in -0.5..0.5, z in z0..z0+1."""
    v = [(-.5, -.5, z0), (.5, -.5, z0), (.5, .5, z0), (-.5, .5, z0),
         (-.5, -.5, z0 + 1), (.5, -.5, z0 + 1), (.5, .5, z0 + 1), (-.5, .5, z0 + 1)]
    return Tpl(v, CUBE_F)


def tpl_cyl(seg=12, rtop=1.0, caps=True):
    """Cylinder radius 1, z 0..1 (rtop = top radius for tapering)."""
    v, f = [], []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        v.append((math.cos(a), math.sin(a), 0))
    for i in range(seg):
        a = 2 * math.pi * i / seg
        v.append((rtop * math.cos(a), rtop * math.sin(a), 1))
    for i in range(seg):
        j = (i + 1) % seg
        f.append((i, j, seg + j, seg + i))
    if caps:
        f.append(tuple(range(seg - 1, -1, -1)))
        f.append(tuple(range(seg, 2 * seg)))
    return Tpl(v, f)


def tpl_cone(seg=12):
    v = [(math.cos(2 * math.pi * i / seg), math.sin(2 * math.pi * i / seg), 0) for i in range(seg)]
    v.append((0, 0, 1))
    f = [(i, (i + 1) % seg, seg) for i in range(seg)]
    f.append(tuple(range(seg - 1, -1, -1)))
    return Tpl(v, f)


def tpl_ico(subd=1, jitter=0.0, seed=0):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subd, radius=1.0)
    bm.verts.index_update()
    r = random.Random(seed)
    v = []
    for vert in bm.verts:
        p = vert.co.copy()
        if jitter:
            p *= 1.0 + r.uniform(-jitter, jitter)
        v.append(tuple(p))
    f = [tuple(x.index for x in face.verts) for face in bm.faces]
    bm.free()
    return Tpl(v, f)


def tpl_gable():
    """Gable roof: footprint -0.5..0.5, eaves z=0, ridge z=1 along X."""
    v = [(-.5, -.5, 0), (.5, -.5, 0), (.5, .5, 0), (-.5, .5, 0), (-.5, 0, 1), (.5, 0, 1)]
    f = [(0, 1, 5, 4), (2, 3, 4, 5), (3, 0, 4), (1, 2, 5), (0, 3, 2, 1)]
    return Tpl(v, f)


def tpl_wedge():
    """Ship bow: back face at x=0 (y -0.5..0.5, z 0..1), point at x=1."""
    v = [(0, -.5, 0), (0, .5, 0), (0, .5, 1), (0, -.5, 1), (1, 0, 0), (1, 0, 1)]
    f = [(0, 3, 2, 1), (0, 4, 5, 3), (1, 2, 5, 4), (3, 5, 2), (0, 1, 4)]
    return Tpl(v, f)


def tpl_frustum(tx0, tx1, ty):
    """Box whose top face is shrunk: x tx0..tx1, y -ty..ty (car cabins, roofs)."""
    v = [(-.5, -.5, 0), (.5, -.5, 0), (.5, .5, 0), (-.5, .5, 0),
         (tx0, -ty, 1), (tx1, -ty, 1), (tx1, ty, 1), (tx0, ty, 1)]
    return Tpl(v, CUBE_F)


CUBE = tpl_cube()
CABIN = tpl_frustum(-0.40, 0.22, 0.42)
HOOD = tpl_frustum(-0.5, 0.42, 0.48)
CUBEC = tpl_cube(-0.5)
CYL8 = tpl_cyl(8)
CYL12 = tpl_cyl(12)
CYL24 = tpl_cyl(24)
CYL32 = tpl_cyl(32)
CONE8 = tpl_cone(8)
CONE12 = tpl_cone(12)
GABLE = tpl_gable()
WEDGE = tpl_wedge()
CANOPIES = [tpl_ico(2, 0.18, s) for s in range(5)]
BUSHES = [tpl_ico(1, 0.25, 10 + s) for s in range(3)]


# =============================================================================
# MESH BUILDER (batches thousands of parts into one object per material)
# =============================================================================
class Builder:
    def __init__(self, name):
        self.name = name
        self.v = []
        self.f = []
        self.c = []
        self.r = []

    def add(self, tpl, M, col=(1, 1, 1), rnd=0.0):
        base = len(self.v)
        self.v.extend(M @ p for p in tpl.v)
        self.f.extend(tuple(base + i for i in face) for face in tpl.f)
        n = len(tpl.v)
        self.c.extend([col] * n)
        self.r.extend([rnd] * n)

    def box(self, x0, y0, z0, x1, y1, z1, col=(1, 1, 1), rnd=0.0):
        b = len(self.v)
        self.v.extend([(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
                       (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)])
        self.f.extend(tuple(b + i for i in face) for face in CUBE_F)
        self.c.extend([col] * 8)
        self.r.extend([rnd] * 8)

    def quad(self, a, b, c, d, col=(1, 1, 1), rnd=0.0):
        base = len(self.v)
        self.v.extend([a, b, c, d])
        self.f.append((base, base + 1, base + 2, base + 3))
        self.c.extend([col] * 4)
        self.r.extend([rnd] * 4)

    def between(self, p0, p1, thick, col=(1, 1, 1), rnd=0.0, thick_y=None):
        """Square beam from p0 to p1."""
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        L = d.length
        if L < 1e-6:
            return
        rot = d.normalized().to_track_quat('Z', 'Y').to_matrix().to_4x4()
        self.add(CUBE, Matrix.Translation(p0) @ rot @ S(thick, thick_y or thick, L), col, rnd)

    def build(self, mat, coll, smooth=False):
        if not self.f:
            return None
        me = bpy.data.meshes.new(self.name)
        me.from_pydata([tuple(p) for p in self.v], [], self.f)
        ca = me.color_attributes.new(name="bcol", type='FLOAT_COLOR', domain='POINT')
        flat = []
        for c in self.c:
            flat.extend((c[0], c[1], c[2], 1.0))
        ca.data.foreach_set("color", flat)
        ra = me.attributes.new(name="rnd", type='FLOAT', domain='POINT')
        ra.data.foreach_set("value", self.r)
        if smooth:
            try:
                me.shade_smooth()
            except AttributeError:
                me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
        me.update()
        ob = bpy.data.objects.new(self.name, me)
        ob.data.materials.append(mat)
        coll.objects.link(ob)
        return ob


BUILDERS = {}


def B(name):
    if name not in BUILDERS:
        BUILDERS[name] = Builder(name)
    return BUILDERS[name]


# =============================================================================
# SCENE RESET / COLLECTIONS
# =============================================================================
def reset_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights,
                 bpy.data.curves, bpy.data.worlds, bpy.data.node_groups):
        for item in list(coll):
            try:
                coll.remove(item)
            except Exception:
                pass
    sc = bpy.context.scene
    for c in list(sc.collection.children):
        bpy.data.collections.remove(c)


COLLS = {}


def coll(name):
    if name not in COLLS:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
        COLLS[name] = c
    return COLLS[name]


# =============================================================================
# SHADER NODE HELPERS
# =============================================================================
class Shader:
    def __init__(self, name):
        self.mat = bpy.data.materials.new(name)
        try:
            self.mat.use_nodes = True
        except Exception:
            pass
        self.nt = self.mat.node_tree
        self.nodes = self.nt.nodes
        self.bsdf = self.nodes.get("Principled BSDF")
        self.out = self.nodes.get("Material Output")
        self._x = -300

    def node(self, kind, **props):
        n = self.nodes.new(kind)
        n.location = (self._x, rng.uniform(-400, 400))
        self._x -= 40
        for k, v in props.items():
            setattr(n, k, v)
        return n

    def link(self, a, b):
        self.nt.links.new(a, b)

    def set(self, sock, val):
        """Connect a socket or set a constant value."""
        if hasattr(val, "is_output") or isinstance(val, bpy.types.NodeSocket):
            self.link(val, sock)
        else:
            if isinstance(val, (tuple, list)) and len(val) == 3 and sock.type == 'RGBA':
                val = (val[0], val[1], val[2], 1.0)
            sock.default_value = val

    def p(self, name, val):
        self.set(self.bsdf.inputs[name], val)

    def math(self, op, a, b=0.0, clamp=False):
        n = self.node("ShaderNodeMath", operation=op, use_clamp=clamp)
        self.set(n.inputs[0], a)
        self.set(n.inputs[1], b)
        return n.outputs[0]

    def mix(self, fac, a, b):
        n = self.node("ShaderNodeMix", data_type='RGBA')
        ins = {s.identifier: s for s in n.inputs}
        outs = {s.identifier: s for s in n.outputs}
        self.set(ins["Factor_Float"], fac)
        self.set(ins["A_Color"], a)
        self.set(ins["B_Color"], b)
        return outs["Result_Color"]

    def attr(self, name="bcol"):
        return self.node("ShaderNodeAttribute", attribute_name=name)

    def coords(self):
        return self.node("ShaderNodeTexCoord").outputs["Object"]

    def noise(self, scale, detail=4.0, rough=0.55, vec=None):
        n = self.node("ShaderNodeTexNoise")
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        n.inputs["Roughness"].default_value = rough
        if vec is not None:
            self.link(vec, n.inputs["Vector"])
        return n

    def ramp(self, fac, stops):
        n = self.node("ShaderNodeValToRGB")
        cr = n.color_ramp
        while len(cr.elements) < len(stops):
            cr.elements.new(0.5)
        for el, (pos, col) in zip(cr.elements, stops):
            el.position = pos
            el.color = (col[0], col[1], col[2], 1.0)
        self.set(n.inputs[0], fac)
        return n.outputs[0]

    def bump(self, height, strength=0.2, distance=0.1):
        n = self.node("ShaderNodeBump")
        n.inputs["Strength"].default_value = strength
        n.inputs["Distance"].default_value = distance
        self.link(height, n.inputs["Height"])
        self.link(n.outputs["Normal"], self.bsdf.inputs["Normal"])
        return n

    def emission_out(self, color, strength):
        em = self.node("ShaderNodeEmission")
        self.set(em.inputs["Color"], color)
        self.set(em.inputs["Strength"], strength)
        self.link(em.outputs[0], self.out.inputs["Surface"])


def night_factor():
    return {"DAY": 0.0, "SUNSET": 0.35, "NIGHT": 1.0}.get(TIME_OF_DAY, 0.35)


# =============================================================================
# MATERIALS
# =============================================================================
MATS = {}


def build_materials():
    nf = night_factor()

    # --- asphalt
    s = Shader("M_Asphalt")
    n1 = s.noise(0.08, 6, 0.6, s.coords())
    n2 = s.noise(3.0, 8, 0.7, s.coords())
    col = s.ramp(n1.outputs["Fac"], [(0.3, (0.018, 0.018, 0.02)), (0.7, (0.045, 0.044, 0.042))])
    col = s.mix(s.math('MULTIPLY', n2.outputs["Fac"], 0.35), col, (0.06, 0.06, 0.06))
    s.p("Base Color", col)
    s.p("Roughness", s.math('ADD', s.math('MULTIPLY', n2.outputs["Fac"], 0.25), 0.7))
    s.bump(n2.outputs["Fac"], 0.25)
    MATS["asphalt"] = s.mat

    # --- concrete / sidewalk
    for key, base, sc in (("concrete", 0.30, 0.6), ("bridge", 0.36, 0.3)):
        s = Shader("M_" + key.capitalize())
        n1 = s.noise(sc, 6, 0.6, s.coords())
        n2 = s.noise(6.0, 6, 0.6, s.coords())
        col = s.ramp(n1.outputs["Fac"], [(0.35, (base * 0.75,) * 3), (0.7, (base, base * 0.98, base * 0.93))])
        s.p("Base Color", col)
        s.p("Roughness", 0.85)
        s.bump(n2.outputs["Fac"], 0.12)
        MATS[key] = s.mat

    # --- grass
    s = Shader("M_Grass")
    n1 = s.noise(0.15, 6, 0.6, s.coords())
    n2 = s.noise(8.0, 8, 0.7, s.coords())
    col = s.ramp(n1.outputs["Fac"], [(0.3, srgb((0.18, 0.32, 0.08))), (0.75, srgb((0.36, 0.45, 0.16)))])
    col = s.mix(s.math('MULTIPLY', n2.outputs["Fac"], 0.3), col, srgb((0.12, 0.22, 0.05)))
    s.p("Base Color", col)
    s.p("Roughness", 0.95)
    s.bump(n2.outputs["Fac"], 0.3)
    MATS["grass"] = s.mat

    # --- road paint
    for key, c in (("mark_y", (0.95, 0.72, 0.1)), ("mark_w", (0.92, 0.92, 0.9))):
        s = Shader("M_" + key)
        s.p("Base Color", srgb(c))
        s.p("Roughness", 0.55)
        MATS[key] = s.mat

    # --- facade materials (windows from a brick pattern in world space)
    def facade(name, tower, win_w, floor_h, mortar):
        s = Shader(name)
        a = s.attr("bcol")
        r = s.attr("rnd")
        sep = s.node("ShaderNodeSeparateXYZ")
        s.link(s.coords(), sep.inputs[0])
        u = s.math('ADD', sep.outputs[0], sep.outputs[1])
        comb = s.node("ShaderNodeCombineXYZ")
        s.link(u, comb.inputs[0])
        s.link(sep.outputs[2], comb.inputs[1])
        brick = s.node("ShaderNodeTexBrick", offset=0.0)
        s.link(comb.outputs[0], brick.inputs["Vector"])
        brick.inputs["Scale"].default_value = 1.0
        brick.inputs["Brick Width"].default_value = win_w
        brick.inputs["Row Height"].default_value = floor_h
        brick.inputs["Mortar Size"].default_value = mortar
        brick.inputs["Mortar Smooth"].default_value = 0.0
        mortar_mask = brick.outputs[1]
        win = s.math('SUBTRACT', 1.0, mortar_mask, clamp=True)
        geo = s.node("ShaderNodeNewGeometry")
        nsep = s.node("ShaderNodeSeparateXYZ")
        s.link(geo.outputs["Normal"], nsep.inputs[0])
        roof = s.math('GREATER_THAN', nsep.outputs[2], 0.5)
        win = s.math('MULTIPLY', win, s.math('SUBTRACT', 1.0, roof))
        # glass tint chosen per building from "rnd"
        if tower:
            glass = s.ramp(r.outputs["Fac"], [
                (0.0, srgb((0.10, 0.22, 0.28))), (0.33, srgb((0.10, 0.15, 0.26))),
                (0.66, srgb((0.26, 0.20, 0.13))), (1.0, srgb((0.30, 0.32, 0.34)))])
            frame = a.outputs["Color"]
        else:
            glass = srgb((0.07, 0.09, 0.11))
            frame = a.outputs["Color"]
        roof_col = s.mix(0.7, frame, (0.30, 0.30, 0.31))
        base = s.mix(win, frame, glass)
        base = s.mix(roof, base, roof_col)
        # subtle dirt / weathering
        dirt = s.noise(0.9, 5, 0.6, s.coords())
        base = s.mix(s.math('MULTIPLY', dirt.outputs["Fac"], 0.25), base, (0.05, 0.05, 0.05))
        s.p("Base Color", base)
        s.p("Metallic", s.math('MULTIPLY', win, 0.85 if tower else 0.4))
        s.p("Roughness", s.math('SUBTRACT', 0.75, s.math('MULTIPLY', win, 0.7)))
        # lit windows
        snap = s.node("ShaderNodeVectorMath", operation='SNAP')
        s.link(comb.outputs[0], snap.inputs[0])
        snap.inputs[1].default_value = (win_w, floor_h, 1.0)
        off = s.node("ShaderNodeVectorMath", operation='ADD')
        s.link(snap.outputs[0], off.inputs[0])
        offc = s.node("ShaderNodeCombineXYZ")
        s.link(s.math('MULTIPLY', r.outputs["Fac"], 517.0), offc.inputs[2])
        s.link(offc.outputs[0], off.inputs[1])
        wn = s.node("ShaderNodeTexWhiteNoise", noise_dimensions='3D')
        s.link(off.outputs[0], wn.inputs["Vector"])
        thresh = {"DAY": 1.5, "SUNSET": 0.93, "NIGHT": 0.80}.get(TIME_OF_DAY, 0.93)
        lit = s.math('GREATER_THAN', wn.outputs["Value"], thresh)
        lit = s.math('MULTIPLY', lit, win)
        warm = s.mix(wn.outputs["Color"], srgb((1.0, 0.72, 0.42)), srgb((0.85, 0.9, 1.0)))
        s.p("Emission Color", warm)
        s.p("Emission Strength", s.math('MULTIPLY', lit, {"DAY": 0.0, "SUNSET": 1.2, "NIGHT": 2.2}.get(TIME_OF_DAY, 1.2)))
        MATS[name] = s.mat
        return s.mat

    MATS["tower"] = facade("M_Tower", True, 1.6, 3.8, 0.28)
    MATS["midrise"] = facade("M_Midrise", False, 3.0, 3.4, 0.55)

    # --- stucco walls / roofs / paint (all colored by the "bcol" attribute)
    for key, rough, metal, coat in (("house", 0.9, 0.0, 0.0), ("roof", 0.75, 0.0, 0.0),
                                    ("paint", 0.5, 0.15, 0.0), ("carpaint", 0.25, 0.35, 1.0),
                                    ("leaves", 0.7, 0.0, 0.0)):
        s = Shader("M_" + key.capitalize())
        a = s.attr("bcol")
        nn = s.noise(2.5 if key != "leaves" else 1.2, 5, 0.6, s.coords())
        col = s.mix(s.math('MULTIPLY', nn.outputs["Fac"], 0.35 if key != "carpaint" else 0.05),
                    a.outputs["Color"], (0.0, 0.0, 0.0))
        s.p("Base Color", col)
        s.p("Roughness", rough)
        s.p("Metallic", metal)
        if coat:
            s.p("Coat Weight", coat)
        if key == "leaves":
            s.p("Subsurface Weight", 0.15)
            s.bump(nn.outputs["Fac"], 0.5)
        elif key in ("house", "roof"):
            s.bump(s.noise(14.0, 4, 0.6, s.coords()).outputs["Fac"], 0.15)
        MATS[key] = s.mat

    # --- dark glass (cars / bridges)
    s = Shader("M_GlassDark")
    s.p("Base Color", (0.01, 0.012, 0.015))
    s.p("Roughness", 0.04)
    s.p("Metallic", 0.6)
    MATS["glass"] = s.mat

    s = Shader("M_Rubber")
    s.p("Base Color", (0.012, 0.012, 0.012))
    s.p("Roughness", 0.8)
    MATS["rubber"] = s.mat

    s = Shader("M_Metal")
    s.p("Base Color", (0.45, 0.46, 0.48))
    s.p("Metallic", 1.0)
    s.p("Roughness", 0.35)
    MATS["metal"] = s.mat

    # --- emissive lights
    for key, c, day, night in (("light", (1.0, 0.78, 0.45), 0.5, 40.0),
                               ("headlight", (1.0, 0.97, 0.9), 0.5, 60.0),
                               ("tail", (1.0, 0.05, 0.02), 1.0, 25.0),
                               ("neon", (1.0, 0.25, 0.65), 1.0, 30.0)):
        s = Shader("M_" + key.capitalize())
        s.p("Base Color", srgb(c))
        s.p("Emission Color", srgb(c))
        s.p("Emission Strength", lerp(day, night, nf))
        MATS[key] = s.mat

    # --- tree trunks / wood
    for key, c1, c2, sc in (("trunk", (0.22, 0.16, 0.10), (0.38, 0.30, 0.22), 6.0),
                            ("wood", (0.30, 0.20, 0.12), (0.45, 0.33, 0.22), 1.5)):
        s = Shader("M_" + key.capitalize())
        wave = s.node("ShaderNodeTexWave")
        s.link(s.coords(), wave.inputs["Vector"])
        wave.inputs["Scale"].default_value = sc
        wave.inputs["Distortion"].default_value = 4.0
        col = s.ramp(wave.outputs["Fac"], [(0.2, srgb(c1)), (0.8, srgb(c2))])
        s.p("Base Color", col)
        s.p("Roughness", 0.85)
        s.bump(wave.outputs["Fac"], 0.3)
        MATS[key] = s.mat

    # --- water (ocean, lake) and pools
    s = Shader("M_Water")
    s.p("Base Color", srgb((0.10, 0.42, 0.50)))
    s.p("Roughness", 0.03)
    s.p("IOR", 1.333)
    s.p("Transmission Weight", 1.0)
    w1 = s.noise(0.05, 4, 0.5, s.coords())
    w2 = s.noise(0.8, 6, 0.6, s.coords())
    hgt = s.math('ADD', w1.outputs["Fac"], s.math('MULTIPLY', w2.outputs["Fac"], 0.5))
    s.bump(hgt, 0.35, 0.5)
    MATS["water"] = s.mat

    s = Shader("M_Pool")
    s.p("Base Color", srgb((0.25, 0.80, 0.90)))
    s.p("Roughness", 0.03)
    s.p("Emission Color", srgb((0.2, 0.7, 1.0)))
    s.p("Emission Strength", lerp(0.0, 3.0, nf))
    s.bump(s.noise(1.5, 3, 0.5, s.coords()).outputs["Fac"], 0.2)
    MATS["pool"] = s.mat

    # --- terrain (vertex colors + detail)
    s = Shader("M_Terrain")
    a = s.attr("bcol")
    n1 = s.noise(0.02, 6, 0.6, s.coords())
    n2 = s.noise(0.5, 8, 0.65, s.coords())
    detail = s.math('ADD', s.math('MULTIPLY', n1.outputs["Fac"], 0.6),
                    s.math('MULTIPLY', n2.outputs["Fac"], 0.6))
    col = s.mix(s.math('MULTIPLY', detail, 0.6), a.outputs["Color"],
                s.mix(0.5, a.outputs["Color"], (0.0, 0.0, 0.0)))
    s.p("Base Color", col)
    s.p("Roughness", 0.95)
    s.bump(n2.outputs["Fac"], 0.6, 2.0)
    MATS["terrain"] = s.mat

    # --- atmospheric haze
    s = Shader("M_Haze")
    s.nodes.remove(s.bsdf)
    vol = s.node("ShaderNodeVolumePrincipled")
    vol.inputs["Density"].default_value = {"DAY": 0.00004, "SUNSET": 0.00005, "NIGHT": 0.00004}.get(TIME_OF_DAY, 0.00005)
    vol.inputs["Color"].default_value = {"DAY": (0.75, 0.85, 1.0, 1.0), "SUNSET": (1.0, 0.82, 0.65, 1.0),
                                         "NIGHT": (0.5, 0.55, 0.8, 1.0)}.get(TIME_OF_DAY, (1.0, 0.82, 0.65, 1.0))
    vol.inputs["Anisotropy"].default_value = 0.35
    s.link(vol.outputs[0], s.out.inputs["Volume"])
    MATS["haze"] = s.mat


# =============================================================================
# TERRAIN
# =============================================================================
def height(x, y):
    dx = max(FLAT[0] - x, 0.0, x - FLAT[1])
    dy = max(y - FLAT[2], 0.0)
    dist = math.hypot(dx, dy)
    h = 0.0
    if dist > 0:
        s = smoothstep(0, 700, dist)
        n = noise.fractal(Vector((x / 700, y / 700, 1.7)), 1.0, 2.0, 6)
        ridge = 1 - abs(noise.noise(Vector((x / 420, y / 420, 5.3))))
        h = s * (50 + 230 * max(0.0, 0.5 + 0.5 * n) + 110 * ridge * ridge) + dist * 0.03
        h += 6 * noise.noise(Vector((x / 90, y / 90, 9.1))) * s
    if y < COAST_Y:
        d = COAST_Y - y
        drop = 0.008 * d + 0.0003 * d * d
        h = h * smoothstep(COAST_Y - 300, COAST_Y, y) - min(drop, 45.0)
    return h


def flat_dist(x, y):
    dx = max(FLAT[0] - x, 0.0, x - FLAT[1])
    dy = max(y - FLAT[2], 0.0)
    return math.hypot(dx, dy)


def slope_at(x, y, e=6.0):
    gx = (height(x + e, y) - height(x - e, y)) / (2 * e)
    gy = (height(x, y + e) - height(x, y - e)) / (2 * e)
    return math.hypot(gx, gy)


SAND = srgb((0.86, 0.77, 0.58))
SAND_WET = srgb((0.62, 0.55, 0.40))
DEEP = srgb((0.03, 0.18, 0.24))
SHALLOW = srgb((0.30, 0.62, 0.58))
DRY = srgb((0.62, 0.55, 0.36))
BRUSH = srgb((0.30, 0.36, 0.17))
BRUSH2 = srgb((0.42, 0.42, 0.22))
ROCK = srgb((0.52, 0.47, 0.42))
URBAN = srgb((0.45, 0.44, 0.30))


def terrain_color(x, y, h, slope):
    n = noise.noise(Vector((x / 80, y / 80, 3.3))) * 0.5 + 0.5
    n2 = noise.noise(Vector((x / 25, y / 25, 7.7))) * 0.5 + 0.5
    if h < WATER_Z - 0.05:
        depth = WATER_Z - h
        c = lerp3(SAND_WET, SHALLOW, smoothstep(0.0, 2.5, depth))
        return lerp3(c, DEEP, smoothstep(2.0, 18.0, depth))
    if y < COAST_Y + 5 and h < 1.5:
        return lerp3(SAND_WET, SAND, smoothstep(WATER_Z, WATER_Z + 0.6, h))
    fd = flat_dist(x, y)
    if fd <= 0.0:
        return lerp3(URBAN, DRY, n * 0.7)
    veg = lerp3(BRUSH, BRUSH2, n)
    veg = lerp3(veg, DRY, smoothstep(0.55, 0.85, n2) * 0.6)
    veg = lerp3(DRY, veg, smoothstep(0, 120, fd))
    c = lerp3(veg, ROCK, smoothstep(0.55, 1.0, slope))
    return lerp3(c, ROCK, smoothstep(260, 420, h) * 0.6)


def build_terrain():
    size = 7000.0
    res = int(380 * max(0.6, DETAIL))
    cx, cy = 400.0, 300.0
    step = size / res
    verts, cols = [], []
    H = []
    for j in range(res + 1):
        row = []
        y = cy - size / 2 + j * step
        for i in range(res + 1):
            x = cx - size / 2 + i * step
            row.append(height(x, y))
        H.append(row)
    for j in range(res + 1):
        y = cy - size / 2 + j * step
        for i in range(res + 1):
            x = cx - size / 2 + i * step
            h = H[j][i]
            i0, i1 = max(0, i - 1), min(res, i + 1)
            j0, j1 = max(0, j - 1), min(res, j + 1)
            gx = (H[j][i1] - H[j][i0]) / ((i1 - i0) * step)
            gy = (H[j1][i] - H[j0][i]) / ((j1 - j0) * step)
            verts.append((x, y, h))
            cols.append(terrain_color(x, y, h, math.hypot(gx, gy)))
    faces = []
    w = res + 1
    for j in range(res):
        for i in range(res):
            a = j * w + i
            faces.append((a, a + 1, a + w + 1, a + w))
    b = Builder("Terrain")
    b.v, b.f, b.c, b.r = verts, faces, cols, [0.0] * len(verts)
    b.build(MATS["terrain"], coll("Terrain"), smooth=True)

    # far terrain ring (coarse) so the horizon shows mountains instead of a flat edge
    fsize, fres = 40000.0, 160
    fstep = fsize / fres
    inner = size / 2 - fstep
    fv, fc, ff = [], [], []
    for j in range(fres + 1):
        y = cy - fsize / 2 + j * fstep
        for i in range(fres + 1):
            x = cx - fsize / 2 + i * fstep
            h = height(x, y) - 2.0
            fv.append((x, y, h))
            fc.append(terrain_color(x, y, h, 0.3))
    fw = fres + 1
    for j in range(fres):
        for i in range(fres):
            mx = cx - fsize / 2 + (i + 0.5) * fstep
            my = cy - fsize / 2 + (j + 0.5) * fstep
            if abs(mx - cx) < inner and abs(my - cy) < inner:
                continue
            a = j * fw + i
            ff.append((a, a + 1, a + fw + 1, a + fw))
    fb = Builder("Terrain_Far")
    fb.v, fb.f, fb.c, fb.r = fv, ff, fc, [0.0] * len(fv)
    fb.build(MATS["terrain"], coll("Terrain"), smooth=True)

    # ocean
    me = bpy.data.meshes.new("Ocean")
    s = 30000
    me.from_pydata([(-s, -s, WATER_Z), (s, -s, WATER_Z), (s, s, WATER_Z), (-s, s, WATER_Z)], [], [(0, 1, 2, 3)])
    ob = bpy.data.objects.new("Ocean", me)
    ob.data.materials.append(MATS["water"])
    coll("Terrain").objects.link(ob)


# =============================================================================
# PALETTES
# =============================================================================
TOWER_FRAMES = [srgb(c) for c in [(0.78, 0.80, 0.82), (0.30, 0.32, 0.35), (0.86, 0.83, 0.76),
                                  (0.55, 0.60, 0.65), (0.20, 0.22, 0.25), (0.70, 0.66, 0.60)]]
MIDRISE_COLS = [srgb(c) for c in [(0.62, 0.30, 0.22), (0.80, 0.72, 0.58), (0.90, 0.86, 0.76),
                                  (0.58, 0.58, 0.56), (0.74, 0.52, 0.38), (0.45, 0.40, 0.36),
                                  (0.85, 0.80, 0.70), (0.55, 0.62, 0.66)]]
PASTELS = [srgb(c) for c in [(0.98, 0.78, 0.80), (0.70, 0.92, 0.85), (0.98, 0.93, 0.75),
                             (0.72, 0.85, 0.98), (0.98, 0.98, 0.95), (0.95, 0.80, 0.65)]]
STUCCO = [srgb(c) for c in [(0.96, 0.94, 0.88), (0.92, 0.86, 0.74), (0.88, 0.80, 0.66),
                            (0.95, 0.85, 0.80), (0.96, 0.92, 0.72), (0.80, 0.86, 0.90),
                            (0.85, 0.78, 0.70)]]
ROOFS = [srgb(c) for c in [(0.62, 0.28, 0.18), (0.70, 0.36, 0.22), (0.30, 0.30, 0.32),
                           (0.45, 0.36, 0.30), (0.55, 0.25, 0.18)]]
CAR_COLS = [srgb(c) for c in [(0.95, 0.95, 0.95), (0.05, 0.05, 0.06), (0.62, 0.64, 0.66),
                              (0.75, 0.06, 0.06), (0.08, 0.22, 0.60), (0.10, 0.30, 0.18),
                              (0.98, 0.78, 0.05), (0.95, 0.45, 0.05), (0.35, 0.35, 0.38),
                              (0.85, 0.85, 0.80)]]
CONTAINER_COLS = [srgb(c) for c in [(0.75, 0.15, 0.10), (0.10, 0.35, 0.65), (0.15, 0.50, 0.25),
                                    (0.90, 0.60, 0.10), (0.85, 0.85, 0.85), (0.45, 0.20, 0.45),
                                    (0.20, 0.55, 0.60), (0.55, 0.30, 0.15)]]
LEAF_COLS = [srgb(c) for c in [(0.20, 0.38, 0.10), (0.28, 0.45, 0.14), (0.16, 0.30, 0.08),
                               (0.35, 0.45, 0.18), (0.24, 0.40, 0.20)]]
PALM_COLS = [srgb(c) for c in [(0.28, 0.48, 0.12), (0.35, 0.52, 0.16), (0.42, 0.50, 0.18)]]


# =============================================================================
# VEGETATION
# =============================================================================
def make_palm_tpl(seed):
    r = random.Random(seed)
    height_ = r.uniform(9, 15)
    bend = r.uniform(0.0, 0.12)
    seg = 7
    rings = 12
    v, f = [], []
    for k in range(rings + 1):
        t = k / rings
        rad = 0.38 - 0.16 * t + (0.04 if k % 2 else 0.0)
        ox = bend * t * t * height_
        for i in range(seg):
            a = 2 * math.pi * i / seg
            v.append((ox + rad * math.cos(a), rad * math.sin(a), t * height_))
    for k in range(rings):
        for i in range(seg):
            j = (i + 1) % seg
            f.append((k * seg + i, k * seg + j, (k + 1) * seg + j, (k + 1) * seg + i))
    trunk = Tpl(v, f)
    top = Vector((bend * height_, 0, height_))
    fv, ff = [], []
    nf = r.randint(9, 12)
    for m in range(nf):
        ang = 2 * math.pi * m / nf + r.uniform(-0.2, 0.2)
        d = Vector((math.cos(ang), math.sin(ang), 0))
        perp = Vector((-d.y, d.x, 0))
        L = r.uniform(4.0, 5.5)
        lift = r.uniform(0.8, 1.6)
        steps = 6
        base = len(fv)
        for k in range(steps + 1):
            t = k / steps
            p = top + d * (L * t) + Vector((0, 0, lift * t - 3.2 * t * t))
            w = 0.95 * math.sin(math.pi * min(t * 1.1, 1.0)) + 0.06
            fv.append(tuple(p + perp * w + Vector((0, 0, -0.15 * w))))
            fv.append(tuple(p))
            fv.append(tuple(p - perp * w + Vector((0, 0, -0.15 * w))))
        for k in range(steps):
            a0 = base + k * 3
            a1 = a0 + 3
            ff.append((a0, a0 + 1, a1 + 1, a1))
            ff.append((a0 + 1, a0 + 2, a1 + 2, a1 + 1))
    return trunk, Tpl(fv, ff)


PALMS = [make_palm_tpl(100 + s) for s in range(6)]


def place_palm(x, y, z=0.0, scale=1.0):
    trunk, fronds = rng.choice(PALMS)
    M = T(x, y, z) @ Rz(rng.uniform(0, 2 * math.pi)) @ S(scale * rng.uniform(0.85, 1.15))
    B("palm_trunk").add(trunk, M)
    B("leaves").add(fronds, M, rng.choice(PALM_COLS))


def place_tree(x, y, z=0.0, scale=1.0, kind=None):
    kind = kind or rng.choice(["round", "round", "round", "cone"])
    s = scale * rng.uniform(0.75, 1.3)
    col = rng.choice(LEAF_COLS)
    if kind == "cone":
        h = 9 * s
        B("palm_trunk").add(CYL8, T(x, y, z) @ S(0.25 * s, 0.25 * s, 2.0 * s))
        B("leaves").add(CONE8, T(x, y, z + 1.5 * s) @ S(2.2 * s, 2.2 * s, h), col)
    elif kind == "bush":
        B("leaves").add(rng.choice(BUSHES), T(x, y, z + 0.6 * s) @ S(1.4 * s, 1.4 * s, 1.0 * s), col)
    else:
        th = 3.0 * s
        B("palm_trunk").add(CYL8, T(x, y, z) @ S(0.3 * s, 0.3 * s, th + 1))
        r = 3.0 * s
        B("leaves").add(rng.choice(CANOPIES),
                        T(x, y, z + th + r * 0.7) @ Rz(rng.uniform(0, 6.3)) @ S(r, r, r * 0.85), col)
        for _ in range(2):
            a = rng.uniform(0, 2 * math.pi)
            rr = r * rng.uniform(0.5, 0.7)
            B("leaves").add(rng.choice(CANOPIES),
                            T(x + math.cos(a) * r * 0.6, y + math.sin(a) * r * 0.6, z + th + r * rng.uniform(0.3, 0.9))
                            @ Rz(a) @ S(rr, rr, rr * 0.85), col)


# =============================================================================
# VEHICLES
# =============================================================================
def place_car(x, y, z, heading, col=None):
    col = col or rng.choice(CAR_COLS)
    kind = rng.random()
    M0 = T(x, y, z) @ Rz(heading)
    if kind < 0.08:   # bus / box truck
        L, W, Hh = 10.0, 2.5, 3.0
        B("carpaint").add(CUBE, M0 @ T(0, 0, 0.5) @ S(L, W, Hh), col)
        B("glass").add(CUBE, M0 @ T(0.2, 0, 2.0) @ S(L + 0.04, W + 0.04, 0.9))
        wheels = [(3.6, 1.15), (-3.6, 1.15), (3.6, -1.15), (-3.6, -1.15)]
        wr = 0.5
        lx = L / 2
    else:
        suv = kind > 0.75
        L = 4.6 if not suv else 4.9
        W = 1.9 if not suv else 2.0
        bh = 0.75 if not suv else 0.95
        B("carpaint").add(HOOD, M0 @ T(0, 0, 0.32) @ S(L, W, bh), col)
        B("rubber").add(CUBE, M0 @ T(0, 0, 0.22) @ S(L + 0.08, W - 0.1, 0.2))
        cab_h = 0.62 if not suv else 0.78
        cl = L * (0.56 if not suv else 0.66)
        cx = -0.3 if not suv else -0.45
        B("glass").add(CABIN, M0 @ T(cx, 0, 0.32 + bh) @ S(cl, W * 0.92, cab_h))
        B("carpaint").add(CUBE, M0 @ T(cx - 0.09 * cl, 0, 0.32 + bh + cab_h) @ S(cl * 0.6, W * 0.92 * 0.82, 0.05), col)
        wheels = [(1.45, 0.86), (-1.45, 0.86), (1.45, -0.86), (-1.45, -0.86)]
        wr = 0.36
        lx = L / 2
    for wx, wy in wheels:
        B("rubber").add(CYL8, M0 @ T(wx, wy, wr) @ Rx(math.pi / 2) @ S(wr, wr, 0.3) @ T(0, 0, -0.5))
    for sy in (-0.62, 0.62):
        B("headlight").add(CUBE, M0 @ T(lx, sy, 0.7) @ S(0.06, 0.38, 0.14))
        B("tail").add(CUBE, M0 @ T(-lx, sy, 0.75) @ S(0.06, 0.38, 0.14))


def place_plane(x, y, heading, tail_col):
    M0 = T(x, y, 0) @ Rz(heading)
    white = srgb((0.95, 0.95, 0.96))
    R = 2.4
    B("paint").add(CYL24, M0 @ T(-20, 0, 4.2) @ Ry(math.pi / 2) @ S(R, R, 38), white)
    B("paint").add(tpl_cone(24), M0 @ T(18, 0, 4.2) @ Ry(math.pi / 2) @ S(R, R, 5), white)
    B("paint").add(tpl_cone(24), M0 @ T(-20, 0, 4.2) @ Ry(-math.pi / 2) @ S(R, R, 6), white)
    B("glass").add(CUBE, M0 @ T(18.2, 0, 4.6) @ S(1.2, 2.6, 0.6))
    B("paint").add(CUBE, M0 @ T(1, 0, 3.0) @ Rz(0) @ S(7, 36, 0.5), white)
    B("paint").add(CUBE, M0 @ T(-21, 0, 5.5) @ S(5, 0.5, 8), tail_col)
    B("paint").add(CUBE, M0 @ T(-22, 0, 5.0) @ S(3.5, 12, 0.35), white)
    for ey in (-8, 8):
        B("metal").add(CYL12, M0 @ T(-1, ey, 1.9) @ Ry(math.pi / 2) @ S(1.1, 1.1, 5) @ T(0, 0, -0.5))
    for gx, gy in ((14, 0), (0, -2.5), (0, 2.5)):
        B("rubber").add(CUBE, M0 @ T(gx, gy, 0) @ S(0.6, 0.6, 1.9))
    B("paint").add(CUBE, M0 @ T(0, 0, 4.0) @ S(34, R * 2.04, 0.5), tail_col)


# =============================================================================
# ROAD NETWORK
# =============================================================================
def build_roads():
    asp = B("asphalt")
    x0, x1 = X_ROADS[0] - HALF_ROAD, X_ROADS[-1] + HALF_ROAD
    y0, y1 = Y_ROADS[0] - HALF_ROAD, Y_ROADS[-1] + HALF_ROAD
    asp.box(x0, y0, -0.6, x1, y1, 0.02)
    # road to the airport along y = -300
    asp.box(x1, -300 - HALF_ROAD, -0.6, 1420, -300 + HALF_ROAD, 0.02)
    # promenade along the beach
    B("concrete").box(x0, COAST_Y - 2, -0.6, x1, y0, 0.25)

    my, mw = B("mark_y"), B("mark_w")
    Z0, Z1 = 0.02, 0.045

    def dashes_x(y, xa, xb, dash=3.0, gap=6.0):
        x = xa
        while x + dash < xb:
            my.box(x, y - 0.08, Z0, x + dash, y + 0.08, Z1)
            x += dash + gap

    def dashes_y(x, ya, yb, dash=3.0, gap=6.0):
        y = ya
        while y + dash < yb:
            my.box(x - 0.08, y, Z0, x + 0.08, y + dash, Z1)
            y += dash + gap

    for X in X_ROADS:
        for k in range(len(Y_ROADS) - 1):
            ya, yb = Y_ROADS[k] + HALF_ROAD + 5, Y_ROADS[k + 1] - HALF_ROAD - 5
            if in_special(X, (ya + yb) / 2):
                continue
            dashes_y(X, ya, yb)
    for Y in Y_ROADS:
        for k in range(len(X_ROADS) - 1):
            xa, xb = X_ROADS[k] + HALF_ROAD + 5, X_ROADS[k + 1] - HALF_ROAD - 5
            if in_special((xa + xb) / 2, Y):
                continue
            dashes_x(Y, xa, xb)
    dashes_x(-300, X_ROADS[-1] + HALF_ROAD + 4, 1410)

    # crosswalks + stop lines
    for X in X_ROADS:
        for Y in Y_ROADS:
            if in_special(X, Y):
                continue
            for sgn in (-1, 1):
                # crossing the vertical road (stripes run along y)
                cy = Y + sgn * (HALF_ROAD + 2.5)
                xx = X - HALF_ROAD + 0.8
                while xx < X + HALF_ROAD - 0.8:
                    mw.box(xx, cy - 1.5, Z0, xx + 0.6, cy + 1.5, Z1)
                    xx += 1.2
                cx = X + sgn * (HALF_ROAD + 2.5)
                yy = Y - HALF_ROAD + 0.8
                while yy < Y + HALF_ROAD - 0.8:
                    mw.box(cx - 1.5, yy, Z0, cx + 1.5, yy + 0.6, Z1)
                    yy += 1.2
                # stop lines (right-hand traffic: cars approach on their right lane)
                sx = X + sgn * (HALF_ROAD + 4.6)
                if sgn > 0:
                    mw.box(sx - 0.2, Y + 0.3, Z0, sx + 0.2, Y + HALF_ROAD - 0.5, Z1)
                else:
                    mw.box(sx - 0.2, Y - HALF_ROAD + 0.5, Z0, sx + 0.2, Y - 0.3, Z1)
                sy = Y + sgn * (HALF_ROAD + 4.6)
                if sgn > 0:
                    mw.box(X - HALF_ROAD + 0.5, sy - 0.2, Z0, X - 0.3, sy + 0.2, Z1)
                else:
                    mw.box(X + 0.3, sy - 0.2, Z0, X + HALF_ROAD - 0.5, sy + 0.2, Z1)

    # street lights
    for X in X_ROADS:
        for Y in Y_ROADS:
            if in_special(X, Y):
                continue
            for sx, sy in ((1, 1), (-1, -1)):
                place_streetlight(X + sx * (HALF_ROAD + 1.2), Y + sy * (HALF_ROAD + 1.2),
                                  math.atan2(-sy, -sx))


LAMP_POSITIONS = []


def place_streetlight(x, y, toward):
    met = B("metal")
    met.add(CYL8, T(x, y, CURB_H) @ S(0.14, 0.14, 8.5))
    d = Vector((math.cos(toward), math.sin(toward), 0))
    end = Vector((x, y, CURB_H + 8.4)) + d * 3.0
    met.between((x, y, CURB_H + 8.3), end, 0.12)
    B("light").add(CUBE, T(end.x, end.y, end.z - 0.35) @ Rz(toward) @ S(1.0, 0.4, 0.2))
    LAMP_POSITIONS.append((end.x, end.y, end.z - 0.6))


def build_traffic():
    count = 0
    for X in X_ROADS:
        for k in range(len(Y_ROADS) - 1):
            ya, yb = Y_ROADS[k] + HALF_ROAD + 3, Y_ROADS[k + 1] - HALF_ROAD - 3
            if in_special(X, (ya + yb) / 2):
                continue
            for lane, head in ((3.5, math.pi / 2), (-3.5, -math.pi / 2)):
                y = ya + rng.uniform(0, 12)
                while y < yb - 5:
                    if rng.random() < 0.55 * DETAIL:
                        place_car(X + lane, y, 0.02, head)
                        count += 1
                    y += rng.uniform(9, 22)
    for Y in Y_ROADS:
        for k in range(len(X_ROADS) - 1):
            xa, xb = X_ROADS[k] + HALF_ROAD + 3, X_ROADS[k + 1] - HALF_ROAD - 3
            if in_special((xa + xb) / 2, Y):
                continue
            for lane, head in ((-3.5, 0.0), (3.5, math.pi)):
                x = xa + rng.uniform(0, 12)
                while x < xb - 5:
                    if rng.random() < 0.55 * DETAIL:
                        place_car(x, Y + lane, 0.02, head)
                        count += 1
                    x += rng.uniform(9, 22)
    print(f"  cars on streets: {count}")


# =============================================================================
# FREEWAY
# =============================================================================
def rounded_rect_path(x0, y0, x1, y1, r, step=4.0):
    pts = []

    def line(ax, ay, bx, by):
        L = math.hypot(bx - ax, by - ay)
        n = max(1, int(L / step))
        for i in range(n):
            t = i / n
            pts.append(Vector((lerp(ax, bx, t), lerp(ay, by, t), FWY_Z)))

    def arc(cx, cy, a0, a1):
        n = max(2, int(abs(a1 - a0) * r / step))
        for i in range(n):
            a = lerp(a0, a1, i / n)
            pts.append(Vector((cx + r * math.cos(a), cy + r * math.sin(a), FWY_Z)))

    line(x0 + r, y0, x1 - r, y0)
    arc(x1 - r, y0 + r, -math.pi / 2, 0)
    line(x1, y0 + r, x1, y1 - r)
    arc(x1 - r, y1 - r, 0, math.pi / 2)
    line(x1 - r, y1, x0 + r, y1)
    arc(x0 + r, y1 - r, math.pi / 2, math.pi)
    line(x0, y1 - r, x0, y0 + r)
    arc(x0 + r, y0 + r, math.pi, 1.5 * math.pi)
    return pts


def path_frames(pts, closed):
    frames = []
    n = len(pts)
    for i in range(n):
        if closed:
            a, b = pts[i - 1], pts[(i + 1) % n]
        else:
            a, b = pts[max(0, i - 1)], pts[min(n - 1, i + 1)]
        t = Vector((b.x - a.x, b.y - a.y, 0)).normalized()
        nrm = Vector((-t.y, t.x, 0))
        frames.append((pts[i], t, nrm))
    return frames


def sweep(builder, frames, closed, profile):
    """Sweep closed 2D profile [(offset_along_normal, z_rel), ...] along a path."""
    m = len(profile)
    base = len(builder.v)
    for p, t, nrm in frames:
        for off, z in profile:
            q = p + nrm * off
            builder.v.append((q.x, q.y, p.z + z))
            builder.c.append((1, 1, 1))
            builder.r.append(0.0)
    count = len(frames)
    segs = count if closed else count - 1
    for i in range(segs):
        i2 = (i + 1) % count
        for k in range(m):
            k2 = (k + 1) % m
            builder.f.append((base + i * m + k, base + i * m + k2, base + i2 * m + k2, base + i2 * m + k))
    if not closed:
        builder.f.append(tuple(base + k for k in range(m)))
        builder.f.append(tuple(base + (count - 1) * m + k for k in range(m - 1, -1, -1)))


def build_freeway_section(pts, closed, width):
    frames = path_frames(pts, closed)
    hw = width / 2
    br = B("bridge")
    sweep(br, frames, closed, [(-hw, 0.0), (hw, 0.0), (hw - 0.6, -1.8), (-hw + 0.6, -1.8)])
    sweep(br, frames, closed, [(hw - 0.45, 0.0), (hw, 0.0), (hw, 1.1), (hw - 0.45, 1.1)])
    sweep(br, frames, closed, [(-hw, 0.0), (-hw + 0.45, 0.0), (-hw + 0.45, 1.1), (-hw, 1.1)])
    sweep(br, frames, closed, [(-0.35, 0.0), (0.35, 0.0), (0.2, 0.95), (-0.2, 0.95)])
    sweep(B("asphalt"), frames, closed, [(-hw + 0.45, 0.0), (hw - 0.45, 0.0), (hw - 0.45, 0.06), (-hw + 0.45, 0.06)])
    mw, my = B("mark_w"), B("mark_y")
    lane_w = (hw - 0.8) / 3
    for idx, (p, t, nrm) in enumerate(frames):
        head = math.atan2(t.y, t.x)
        if idx % 3 == 0:
            for side in (-1, 1):
                for ln in (1, 2):
                    q = p + nrm * (side * (0.6 + lane_w * ln))
                    mw.add(CUBEC, T(q.x, q.y, q.z + 0.08) @ Rz(head) @ S(3.0, 0.15, 0.04))
        for side in (-1, 1):
            q = p + nrm * (side * (hw - 1.0))
            mw.add(CUBEC, T(q.x, q.y, q.z + 0.08) @ Rz(head) @ S(4.4, 0.18, 0.04))
            q = p + nrm * (side * 0.75)
            my.add(CUBEC, T(q.x, q.y, q.z + 0.08) @ Rz(head) @ S(4.4, 0.15, 0.04))
        # pillars
        if idx % 9 == 0 and p.z > 4:
            for side in (-1, 1):
                q = p + nrm * (side * hw * 0.45)
                br.add(CYL12, T(q.x, q.y, -0.5) @ S(1.3, 1.3, p.z - 1.3))
            br.add(CUBEC, T(p.x, p.y, p.z - 2.4) @ Rz(head) @ S(3.0, width * 0.95, 1.4))
        # traffic
        if idx % 4 == 0:
            for side in (-1, 1):
                if rng.random() < 0.42 * DETAIL:
                    ln = rng.randint(0, 2)
                    q = p + nrm * (side * (0.6 + lane_w * (ln + 0.5)))
                    place_car(q.x, q.y, q.z + 0.06, head if side < 0 else head + math.pi)
        # lights
        if idx % 12 == 6:
            for side in (-1, 1):
                q = p + nrm * (side * (hw - 0.2))
                B("metal").add(CYL8, T(q.x, q.y, q.z + 1.0) @ S(0.15, 0.15, 9))
                e = q - nrm * (side * 2.5)
                B("metal").between((q.x, q.y, q.z + 9.8), (e.x, e.y, q.z + 9.8), 0.12)
                B("light").add(CUBEC, T(e.x, e.y, q.z + 9.6) @ Rz(head) @ S(0.5, 1.0, 0.2))
                LAMP_POSITIONS.append((e.x, e.y, q.z + 9.3))


def build_freeway():
    x0, y0, x1, y1, r = FWY_RING
    ring = rounded_rect_path(x0, y0, x1, y1, r)
    build_freeway_section(ring, True, FWY_W)
    # spur east to the airport, ramps down to ground
    spur = []
    x = x1 + FWY_W / 2
    while x <= 905:
        z = FWY_Z if x < 720 else lerp(FWY_Z, 0.05, smoothstep(720, 900, x))
        spur.append(Vector((x, -300.0, z)))
        x += 4.0
    build_freeway_section(spur, False, 22.0)


# =============================================================================
# BUILDINGS
# =============================================================================
def rooftop_clutter(x0, y0, x1, y1, z):
    met = B("metal")
    w, h = x1 - x0, y1 - y0
    for _ in range(rng.randint(1, 4)):
        bw, bh = rng.uniform(1.5, min(6, w * 0.4)), rng.uniform(1.5, min(6, h * 0.4))
        bx = rng.uniform(x0 + 1, x1 - bw - 1)
        by = rng.uniform(y0 + 1, y1 - bh - 1)
        met.box(bx, by, z, bx + bw, by + bh, z + rng.uniform(1.0, 2.8))
    # parapet
    p = B("bridge")
    t = 0.35
    p.box(x0, y0, z, x1, y0 + t, z + 1.0)
    p.box(x0, y1 - t, z, x1, y1, z + 1.0)
    p.box(x0, y0, z, x0 + t, y1, z + 1.0)
    p.box(x1 - t, y0, z, x1, y1, z + 1.0)


def water_tower(x, y, z):
    for dx, dy in ((-1.5, -1.5), (1.5, -1.5), (1.5, 1.5), (-1.5, 1.5)):
        B("metal").box(x + dx - 0.12, y + dy - 0.12, z, x + dx + 0.12, y + dy + 0.12, z + 4)
    B("wood").add(CYL12, T(x, y, z + 4) @ S(2.2, 2.2, 4.5))
    B("roof").add(CONE12, T(x, y, z + 8.5) @ S(2.35, 2.35, 1.6), srgb((0.25, 0.22, 0.2)))


def tower(x0, y0, x1, y1, H, z0=CURB_H):
    frame = rng.choice(TOWER_FRAMES)
    rnd = rng.random()
    b = B("tower")
    w, h = x1 - x0, y1 - y0
    z = z0
    if H > 70 and rng.random() < 0.7:
        ph = rng.uniform(6, 14)
        B("midrise").box(x0, y0, z, x1, y1, z + ph, rng.choice(MIDRISE_COLS), rng.random())
        z += ph
        ins = rng.uniform(2, min(6, w * 0.2, h * 0.2))
        x0, y0, x1, y1 = x0 + ins, y0 + ins, x1 - ins, y1 - ins
    if rng.random() < 0.15 and H > 60:
        # round tower
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        rr = min(x1 - x0, y1 - y0) / 2
        b.add(CYL32, T(cx, cy, z) @ S(rr, rr, H - z), frame, rnd)
        B("metal").add(CYL32, T(cx, cy, H) @ S(rr * 0.6, rr * 0.6, 3.0))
        if rng.random() < 0.5:
            B("metal").add(CONE8, T(cx, cy, H + 3) @ S(0.6, 0.6, rng.uniform(15, 35)))
        return
    tiers = 1 if H < 90 else rng.choice([1, 2, 2, 3])
    tier_h = (H - z) / tiers
    for k in range(tiers):
        th = tier_h * (rng.uniform(1.0, 1.25) if k == 0 else rng.uniform(0.8, 1.0))
        top = min(H, z + th) if k < tiers - 1 else H
        b.box(x0, y0, z, x1, y1, top, frame, rnd)
        # spandrel bands / fins for detail
        if rng.random() < 0.35:
            for zz in range(int(z + 12), int(top), 24):
                B("bridge").box(x0 - 0.3, y0 - 0.3, zz, x1 + 0.3, y1 + 0.3, zz + 0.8)
        z = top
        ins = rng.uniform(1.5, 4.0)
        if k < tiers - 1:
            x0, y0, x1, y1 = x0 + ins, y0 + ins, x1 - ins, y1 - ins
    if H > 140 and rng.random() < 0.35:
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        sp = rng.uniform(18, 45)
        B("metal").add(CYL8, T(cx, cy, H) @ S(0.5, 0.5, sp))
        B("tail").box(cx - 0.4, cy - 0.4, H + sp, cx + 0.4, cy + 0.4, H + sp + 0.8)  # aircraft warning light
    elif rng.random() < 0.35 and (x1 - x0) > 16:
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        B("bridge").add(CYL24, T(cx, cy, H) @ S(7.5, 7.5, 1.0))
        B("mark_w").add(CYL24, T(cx, cy, H + 1.0) @ S(6.0, 6.0, 0.03))
        B("bridge").add(CYL24, T(cx, cy, H + 1.0) @ S(5.2, 5.2, 0.05))
        B("mark_y").box(cx - 2, cy - 0.3, H + 1.05, cx + 2, cy + 0.3, H + 1.1)
        B("mark_y").box(cx - 2, cy - 2.4, H + 1.05, cx - 1.4, cy + 2.4, H + 1.1)
        B("mark_y").box(cx + 1.4, cy - 2.4, H + 1.05, cx + 2, cy + 2.4, H + 1.1)
    else:
        rooftop_clutter(x0, y0, x1, y1, H)


def split_lots(x0, y0, x1, y1, n, gap=3.0):
    if n == 1:
        return [(x0, y0, x1, y1)]
    if n == 2:
        if rng.random() < 0.5:
            mx = lerp(x0, x1, rng.uniform(0.4, 0.6))
            return [(x0, y0, mx - gap / 2, y1), (mx + gap / 2, y0, x1, y1)]
        my = lerp(y0, y1, rng.uniform(0.4, 0.6))
        return [(x0, y0, x1, my - gap / 2), (x0, my + gap / 2, x1, y1)]
    mx = lerp(x0, x1, rng.uniform(0.4, 0.6))
    my = lerp(y0, y1, rng.uniform(0.4, 0.6))
    return [(x0, y0, mx - gap / 2, my - gap / 2), (mx + gap / 2, y0, x1, my - gap / 2),
            (x0, my + gap / 2, mx - gap / 2, y1), (mx + gap / 2, my + gap / 2, x1, y1)]


def sidewalk_trees(bx0, by0, bx1, by1, prob=0.5):
    for x in range(int(bx0 + 6), int(bx1 - 4), 12):
        for y in (by0 + 1.5, by1 - 1.5):
            if rng.random() < prob * DETAIL:
                place_tree(x, y, CURB_H, 0.55, "round")
    for y in range(int(by0 + 6), int(by1 - 4), 12):
        for x in (bx0 + 1.5, bx1 - 1.5):
            if rng.random() < prob * DETAIL:
                place_tree(x, y, CURB_H, 0.55, "round")


def parking_lot(x0, y0, x1, y1):
    B("asphalt").box(x0, y0, CURB_H, x1, y1, CURB_H + 0.03)
    mw = B("mark_w")
    x = x0 + 2
    while x < x1 - 2:
        for yy in (y0 + 1, y1 - 6):
            mw.box(x, yy, CURB_H + 0.03, x + 0.12, yy + 5, CURB_H + 0.05)
            if rng.random() < 0.6:
                place_car(x + 1.3, yy + 2.5, CURB_H + 0.03, math.pi / 2 * rng.choice([1, -1]))
        x += 2.6


def gen_downtown(bx0, by0, bx1, by1, d):
    x0, y0, x1, y1 = bx0 + SIDEWALK, by0 + SIDEWALK, bx1 - SIDEWALK, by1 - SIDEWALK
    sidewalk_trees(bx0, by0, bx1, by1, 0.55)
    k = max(0.0, 1.0 - d / 240.0)
    for lot in split_lots(x0, y0, x1, y1, rng.choice([1, 2, 2, 4, 4])):
        if rng.random() < 0.08:
            B("concrete").box(lot[0], lot[1], CURB_H, lot[2], lot[3], CURB_H + 0.1)
            for _ in range(4):
                place_tree(rng.uniform(lot[0] + 3, lot[2] - 3), rng.uniform(lot[1] + 3, lot[3] - 3),
                           CURB_H + 0.1, 0.7)
            continue
        H = 35 + 240 * (k ** 1.6) * rng.uniform(0.45, 1.15) + rng.uniform(0, 25)
        tower(*lot, H)


def gen_midrise(bx0, by0, bx1, by1, d, pastel=False):
    x0, y0, x1, y1 = bx0 + SIDEWALK, by0 + SIDEWALK, bx1 - SIDEWALK, by1 - SIDEWALK
    sidewalk_trees(bx0, by0, bx1, by1, 0.35)
    if not pastel and rng.random() < 0.12:
        parking_lot(x0, y0, x1, y1)
        return
    nx = rng.choice([2, 3])
    ny = rng.choice([2, 2, 3])
    k = max(0.0, 1.0 - (d - 200) / 260.0)
    xs = [lerp(x0, x1, i / nx) for i in range(nx + 1)]
    ys = [lerp(y0, y1, j / ny) for j in range(ny + 1)]
    for i in range(nx):
        for j in range(ny):
            lx0, lx1 = xs[i] + 0.4, xs[i + 1] - 0.4
            ly0, ly1 = ys[j] + 0.4, ys[j + 1] - 0.4
            if rng.random() < 0.08:
                place_tree((lx0 + lx1) / 2, (ly0 + ly1) / 2, CURB_H, 0.8)
                continue
            Hh = CURB_H + rng.uniform(8, 18) + 40 * k * rng.random()
            if pastel:
                Hh = CURB_H + rng.uniform(10, 42)
            col = rng.choice(PASTELS if pastel else MIDRISE_COLS)
            B("midrise").box(lx0, ly0, CURB_H, lx1, ly1, Hh, col, rng.random())
            # cornice band just below the roof line (kept off the roof plane to avoid z-fighting)
            cb = B("bridge")
            cb.box(lx0 - 0.3, ly0 - 0.3, Hh - 0.9, lx1 + 0.3, ly0 + 0.3, Hh - 0.3)
            cb.box(lx0 - 0.3, ly1 - 0.3, Hh - 0.9, lx1 + 0.3, ly1 + 0.3, Hh - 0.3)
            cb.box(lx0 - 0.3, ly0 + 0.3, Hh - 0.9, lx0 + 0.3, ly1 - 0.3, Hh - 0.3)
            cb.box(lx1 - 0.3, ly0 + 0.3, Hh - 0.9, lx1 + 0.3, ly1 - 0.3, Hh - 0.3)
            if pastel and rng.random() < 0.3 and (lx1 - lx0) > 12:
                B("pool").box(lx0 + 3, ly0 + 3, Hh, lx0 + 9, ly0 + 7, Hh + 0.3)
                rooftop_clutter(lx0 + 10, ly0, lx1, ly1, Hh)
            elif rng.random() < 0.3:
                water_tower(rng.uniform(lx0 + 3, lx1 - 3), rng.uniform(ly0 + 3, ly1 - 3), Hh)
                rooftop_clutter(lx0, ly0, lx1, ly1, Hh)
            else:
                rooftop_clutter(lx0, ly0, lx1, ly1, Hh)


def house(x, y, facing, z=0.26):
    """facing: angle the front faces (0 = +x)."""
    w = rng.uniform(9, 13)
    dpt = rng.uniform(8, 11)
    stories = rng.choice([1, 1, 2])
    wall_h = 3.2 * stories
    col = rng.choice(STUCCO)
    M = T(x, y, z) @ Rz(facing)
    B("house").add(CUBE, M @ S(dpt, w, wall_h), col)
    rh = rng.uniform(1.8, 3.2)
    rcol = rng.choice(ROOFS)
    if rng.random() < 0.8:
        B("roof").add(GABLE, M @ T(0, 0, wall_h) @ Rz(math.pi / 2) @ S(w + 0.8, dpt + 0.8, rh), rcol)
    else:
        B("roof").add(CUBE, M @ T(0, 0, wall_h) @ S(dpt + 0.6, w + 0.6, 0.35), rcol)
    # door + windows
    B("glass").add(CUBE, M @ T(dpt / 2, rng.uniform(-w / 4, w / 4), 0) @ S(0.1, 1.0, 2.1))
    for sy in (-w / 3, w / 3):
        for st in range(stories):
            B("glass").add(CUBE, M @ T(dpt / 2, sy, 1.0 + st * 3.2) @ S(0.1, 1.6, 1.2))
    # garage
    if rng.random() < 0.6:
        gw = 6.0
        B("house").add(CUBE, M @ T(-0.5, (w + gw) / 2, 0) @ S(dpt - 1, gw, 3.0), col)
        B("roof").add(CUBE, M @ T(-0.5, (w + gw) / 2, 3.0) @ S(dpt - 0.6, gw + 0.4, 0.3), rcol)
        B("paint").add(CUBE, M @ T(dpt / 2 - 0.45, (w + gw) / 2, 0) @ S(0.1, 4.6, 2.4), srgb((0.9, 0.9, 0.88)))
    # backyard pool
    if rng.random() < 0.4:
        px = -dpt / 2 - 5.5
        B("concrete").add(CUBE, M @ T(px, 0, -0.02) @ S(6.0, 9.0, 0.12))
        B("pool").add(CUBE, M @ T(px, 0, 0.0) @ S(4.4, 7.4, 0.13))
    # driveway car
    if rng.random() < 0.5:
        q = M @ Vector((dpt / 2 + 3.5, (w + 6) / 2 if rng.random() < 0.6 else 0, 0))
        place_car(q.x, q.y, z, facing + math.pi * rng.choice([0, 1]))


def gen_suburb(bx0, by0, bx1, by1):
    B("grass").box(bx0 + SIDEWALK, by0 + SIDEWALK, CURB_H, bx1 - SIDEWALK, by1 - SIDEWALK, 0.26)
    x0, y0, x1, y1 = bx0 + SIDEWALK, by0 + SIDEWALK, bx1 - SIDEWALK, by1 - SIDEWALK
    n = 4
    lot_w = (x1 - x0) / n
    for i in range(n):
        cx = x0 + lot_w * (i + 0.5)
        house(cx, y0 + 11, -math.pi / 2)
        house(cx, y1 - 11, math.pi / 2)
        B("concrete").box(cx + 1.0, y0, 0.26, cx + 5.0, y0 + 6, 0.29)
        B("concrete").box(cx + 1.0, y1 - 6, 0.26, cx + 5.0, y1, 0.29)
        for _ in range(rng.randint(1, 3)):
            tx = rng.uniform(x0 + lot_w * i + 2, x0 + lot_w * (i + 1) - 2)
            ty = rng.uniform(y0 + 24, y1 - 24)
            if rng.random() < 0.35:
                place_palm(tx, ty, 0.26, 0.9)
            else:
                place_tree(tx, ty, 0.26, 0.9)
        if rng.random() < 0.5:
            place_tree(cx - 4, y0 + 2.5, 0.26, 0.5, "bush")
            place_tree(cx - 4, y1 - 2.5, 0.26, 0.5, "bush")
    sidewalk_trees(bx0, by0, bx1, by1, 0.15)


def container(x, y, z, rot=0.0):
    col = rng.choice(CONTAINER_COLS)
    B("paint").add(CUBE, T(x, y, z) @ Rz(rot) @ S(12.2, 2.44, 2.59), col)


def container_yard(x0, y0, x1, y1, z):
    y = y0 + 2
    while y < y1 - 3:
        x = x0 + 2
        while x < x1 - 13:
            if rng.random() < 0.85:
                for k in range(rng.randint(1, 4)):
                    container(x + 6.1, y + 1.22, z + k * 2.6)
            x += 12.8
        y += 2.8 if rng.random() < 0.8 else 9.0


def gen_industrial(bx0, by0, bx1, by1, cy):
    B("asphalt").box(bx0 + SIDEWALK, by0 + SIDEWALK, CURB_H, bx1 - SIDEWALK, by1 - SIDEWALK, CURB_H + 0.03)
    x0, y0, x1, y1 = bx0 + SIDEWALK + 2, by0 + SIDEWALK + 2, bx1 - SIDEWALK - 2, by1 - SIDEWALK - 2
    if cy < -320:
        container_yard(x0, y0, x1, y1, CURB_H + 0.03)
        return
    for lot in split_lots(x0, y0, x1, y1, rng.choice([1, 2])):
        lx0, ly0, lx1, ly1 = lot
        ins = rng.uniform(2, 6)
        wx0, wy0, wx1, wy1 = lx0 + ins, ly0 + ins, lx1 - ins, ly1 - ins
        Hh = rng.uniform(8, 15)
        col = rng.choice([srgb((0.70, 0.68, 0.62)), srgb((0.55, 0.60, 0.64)),
                          srgb((0.80, 0.76, 0.66)), srgb((0.45, 0.50, 0.55))])
        B("paint").box(wx0, wy0, CURB_H, wx1, wy1, Hh, col)
        B("roof").box(wx0 - 0.3, wy0 - 0.3, Hh, wx1 + 0.3, wy1 + 0.3, Hh + 0.4, srgb((0.72, 0.72, 0.74)))
        # roller doors
        for dx in range(int(wx0 + 3), int(wx1 - 4), 7):
            B("metal").box(dx, wy0 - 0.1, CURB_H, dx + 4, wy0, CURB_H + 4.5)
        # skylights
        for sx in range(int(wx0 + 4), int(wx1 - 4), 8):
            B("glass").box(sx, wy0 + 3, Hh + 0.4, sx + 2, wy1 - 3, Hh + 0.7)
        rooftop_clutter(wx0, wy0, wx1, wy1, Hh + 0.4)
        # parked trucks
        for _ in range(rng.randint(0, 3)):
            place_car(rng.uniform(wx0 + 5, wx1 - 5), wy0 - 4, CURB_H + 0.03, 0.0)


def build_city_blocks():
    counts = {}
    for i in range(len(X_ROADS) - 1):
        for j in range(len(Y_ROADS) - 1):
            bx0, bx1 = X_ROADS[i] + HALF_ROAD, X_ROADS[i + 1] - HALF_ROAD
            by0, by1 = Y_ROADS[j] + HALF_ROAD, Y_ROADS[j + 1] - HALF_ROAD
            cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2
            if in_special(cx, cy):
                continue
            B("concrete").box(bx0, by0, -0.5, bx1, by1, CURB_H)
            # curb edge
            B("bridge").box(bx0, by0, CURB_H - 0.05, bx1, by0 + 0.3, CURB_H + 0.02)
            B("bridge").box(bx0, by1 - 0.3, CURB_H - 0.05, bx1, by1, CURB_H + 0.02)
            d = math.hypot(cx - DT[0], (cy - DT[1]) * 1.15)
            if cx > 420 and cy < -20:
                z = "industrial"
                gen_industrial(bx0, by0, bx1, by1, cy)
            elif cy < -320:
                z = "beachfront"
                gen_midrise(bx0, by0, bx1, by1, d, pastel=True)
            elif d < 240:
                z = "downtown"
                gen_downtown(bx0, by0, bx1, by1, d)
            elif d < 430:
                z = "midtown"
                gen_midrise(bx0, by0, bx1, by1, d)
            else:
                z = "suburb"
                gen_suburb(bx0, by0, bx1, by1)
            counts[z] = counts.get(z, 0) + 1
    print("  blocks:", counts)


# =============================================================================
# LANDMARKS
# =============================================================================
def build_park():
    x0, y0, x1, y1 = PARK_RECT
    x0 += HALF_ROAD; y0 += HALF_ROAD; x1 -= HALF_ROAD; y1 -= HALF_ROAD
    B("concrete").box(x0, y0, -0.5, x1, y1, CURB_H)
    B("grass").box(x0 + 3, y0 + 3, CURB_H, x1 - 3, y1 - 3, 0.3)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    lake_c = (cx + 15, cy + 10)
    B("concrete").add(CYL32, T(lake_c[0], lake_c[1], 0.0) @ S(42, 27, 0.34))
    B("water").add(CYL32, T(lake_c[0], lake_c[1], 0.0) @ S(40, 25, 0.36))
    # paths
    B("concrete").box(x0 + 3, cy - 40 - 1.5, 0.3, x1 - 3, cy - 40 + 1.5, 0.33)
    B("concrete").box(cx - 45 - 1.5, y0 + 3, 0.3, cx - 45 + 1.5, y1 - 3, 0.33)
    for k in range(48):
        a = 2 * math.pi * k / 48
        p = (lake_c[0] + 48 * math.cos(a), lake_c[1] + 33 * math.sin(a))
        B("concrete").add(CUBEC, T(p[0], p[1], 0.3) @ Rz(a + math.pi / 2) @ S(6.0, 2.5, 0.06))
    placed = 0
    tries = 0
    while placed < n_scaled(140) and tries < 3000:
        tries += 1
        x, y = rng.uniform(x0 + 6, x1 - 6), rng.uniform(y0 + 6, y1 - 6)
        if ((x - lake_c[0]) / 52) ** 2 + ((y - lake_c[1]) / 37) ** 2 < 1:
            continue
        if abs(y - (cy - 40)) < 4 or abs(x - (cx - 45)) < 4:
            continue
        if rng.random() < 0.2:
            place_palm(x, y, 0.3)
        else:
            place_tree(x, y, 0.3, 1.1)
        placed += 1
    # gazebo
    gx, gy = cx - 45, cy - 40
    B("house").add(CYL12, T(gx, gy, 0.33) @ S(5, 5, 0.4), srgb((0.95, 0.95, 0.92)))
    for k in range(8):
        a = 2 * math.pi * k / 8
        B("house").add(CYL8, T(gx + 4.4 * math.cos(a), gy + 4.4 * math.sin(a), 0.7) @ S(0.2, 0.2, 3.2),
                       srgb((0.95, 0.95, 0.92)))
    B("roof").add(CONE12, T(gx, gy, 3.9) @ S(5.8, 5.8, 2.6), srgb((0.25, 0.42, 0.35)))


def build_stadium():
    x0, y0, x1, y1 = STADIUM_RECT
    x0 += HALF_ROAD; y0 += HALF_ROAD; x1 -= HALF_ROAD; y1 -= HALF_ROAD
    B("concrete").box(x0, y0, -0.5, x1, y1, CURB_H)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    B("grass").box(cx - 34, cy - 22, CURB_H, cx + 34, cy + 22, CURB_H + 0.1)
    mw = B("mark_w")
    zt = CURB_H + 0.1
    mw.box(cx - 30, cy - 18, zt, cx + 30, cy - 17.7, zt + 0.02)
    mw.box(cx - 30, cy + 17.7, zt, cx + 30, cy + 18, zt + 0.02)
    mw.box(cx - 30, cy - 18, zt, cx - 29.7, cy + 18, zt + 0.02)
    mw.box(cx + 29.7, cy - 18, zt, cx + 30, cy + 18, zt + 0.02)
    mw.box(cx - 0.15, cy - 18, zt, cx + 0.15, cy + 18, zt + 0.02)
    seg = 64
    seat_cols = [srgb((0.70, 0.08, 0.08)), srgb((0.85, 0.85, 0.85)), srgb((0.10, 0.20, 0.55))]
    for tier in range(3):
        rx, ry = 44 + tier * 7.5, 31 + tier * 7.5
        z0 = CURB_H + tier * 5.0
        for k in range(seg):
            a = 2 * math.pi * k / seg
            x, y = cx + rx * math.cos(a), cy + ry * math.sin(a)
            tang = math.atan2(ry * math.cos(a), -rx * math.sin(a))
            L = 2 * math.pi * max(rx, ry) / seg * 1.05
            B("paint").add(CUBEC, T(x, y, z0 + 2.5) @ Rz(tang) @ S(L, 7.6, 5.0 + tier * 0.2),
                           seat_cols[tier])
    for k in range(seg):
        a = 2 * math.pi * k / seg
        rx, ry = 62, 49
        x, y = cx + rx * math.cos(a), cy + ry * math.sin(a)
        tang = math.atan2(ry * math.cos(a), -rx * math.sin(a))
        B("paint").add(CUBEC, T(x, y, 21) @ Rz(tang) @ S(2 * math.pi * rx / seg * 1.1, 14, 0.6),
                       srgb((0.95, 0.95, 0.95)))
        if k % 4 == 0:
            B("metal").add(CYL8, T(x, y, CURB_H) @ S(0.5, 0.5, 21))
    for sx in (-1, 1):
        for sy in (-1, 1):
            px, py = cx + sx * 66, cy + sy * 52
            B("metal").add(CYL8, T(px, py, CURB_H) @ S(0.8, 0.8, 38))
            B("light").box(px - 3, py - 0.5, 38, px + 3, py + 0.5, 41)
    for _ in range(n_scaled(60)):
        place_car(rng.uniform(x0 + 4, x1 - 4), rng.choice([y0 + 4, y1 - 4]), CURB_H, 0.0)


def build_beach():
    # palms along the promenade
    x = X_ROADS[0]
    while x < 430:
        if abs(x + 200) > 12:
            place_palm(x + rng.uniform(-1, 1), COAST_Y + 1.5, 0.25, 1.1)
        x += 16
    # lifeguard towers
    lx = -620
    while lx < 400:
        if abs(lx + 200) > 40:
            hz = height(lx, -425)
            for dx, dy in ((-1.2, -1.2), (1.2, -1.2), (1.2, 1.2), (-1.2, 1.2)):
                B("wood").box(lx + dx - 0.12, -425 + dy - 0.12, hz - 1, lx + dx + 0.12, -425 + dy + 0.12, hz + 2.2)
            B("paint").box(lx - 1.8, -427, hz + 2.2, lx + 1.8, -423, hz + 4.6, srgb((0.30, 0.65, 0.85)))
            B("roof").box(lx - 2.2, -427.4, hz + 4.6, lx + 2.2, -422.6, hz + 4.9, srgb((0.95, 0.95, 0.95)))
            B("paint").box(lx - 0.6, -423, hz + 3, lx + 0.6, -422.9, hz + 4, srgb((0.9, 0.15, 0.1)))
        lx += 170
    # umbrellas & towels
    ucols = [srgb(c) for c in [(0.95, 0.2, 0.2), (0.1, 0.5, 0.9), (0.98, 0.8, 0.1),
                               (0.2, 0.75, 0.4), (0.95, 0.95, 0.95), (0.95, 0.45, 0.65)]]
    for _ in range(n_scaled(150)):
        ux = rng.uniform(-660, 420)
        if abs(ux + 200) < 15:
            continue
        uy = rng.uniform(-438, -403)
        hz = height(ux, uy)
        if hz < WATER_Z + 0.2:
            continue
        c = rng.choice(ucols)
        B("metal").add(CYL8, T(ux, uy, hz - 0.3) @ S(0.04, 0.04, 2.6))
        B("paint").add(CONE12, T(ux, uy, hz + 1.9) @ S(1.6, 1.6, 0.55), c)
        B("paint").add(CUBE, T(ux + 1.2, uy - 1.0, hz + 0.01) @ Rz(rng.uniform(0, 3)) @ S(1.8, 0.8, 0.03),
                       rng.choice(ucols))


def build_pier():
    px = -200.0
    deck_z = 1.2
    y_end = -600.0
    B("wood").box(px - 8, y_end, deck_z - 0.5, px + 8, COAST_Y, deck_z)
    B("wood").box(px - 40, y_end - 90, deck_z - 0.5, px + 40, y_end, deck_z)
    y = COAST_Y - 5
    while y > y_end - 90:
        hw = 8 if y > y_end else 40
        for xx in (-hw + 1, hw - 1) if hw == 8 else (-39, -20, 0, 20, 39):
            B("wood").add(CYL8, T(px + xx, y, -12) @ S(0.35, 0.35, 12.0 + deck_z - 0.5))
        y -= 10
    # railings
    for sx in (-1, 1):
        B("wood").box(px + sx * 8 - 0.1, y_end, deck_z, px + sx * 8 + 0.1, COAST_Y, deck_z + 1.1)
    # stalls
    for k in range(6):
        sy = -440 - k * 25
        for sx in (-1, 1):
            B("house").box(px + sx * 5.5 - 2, sy - 3, deck_z, px + sx * 5.5 + 2, sy + 3, deck_z + 3,
                           rng.choice(PASTELS))
            B("roof").box(px + sx * 5.5 - 2.3, sy - 3.3, deck_z + 3, px + sx * 5.5 + 2.3, sy + 3.3, deck_z + 3.3,
                          rng.choice(ROOFS))
    # ferris wheel (in the YZ plane)
    C = Vector((px + 15, y_end - 45, 34.0))
    R = 28.0
    seg = 64
    met = B("metal")
    for k in range(seg):
        a = 2 * math.pi * k / seg
        for ox in (-1.4, 1.4):
            p = C + Vector((ox, R * math.cos(a), R * math.sin(a)))
            met.add(CUBEC, T(p.x, p.y, p.z) @ Rx(a) @ S(0.45, 0.6, 2 * math.pi * R / seg * 1.05))
            p2 = C + Vector((ox, (R - 0.8) * math.cos(a), (R - 0.8) * math.sin(a)))
            B("neon").add(CUBEC, T(p2.x, p2.y, p2.z) @ Rx(a) @ S(0.2, 0.2, 2 * math.pi * R / seg * 0.6))
        if k % 4 == 0:
            for ox in (-1.4, 1.4):
                q = C + Vector((ox, R * math.cos(a), R * math.sin(a)))
                met.between((C.x + ox, C.y, C.z), q, 0.25)
            g = C + Vector((0, R * math.cos(a), R * math.sin(a) - 2.4))
            B("paint").add(CUBEC, T(g.x, g.y, g.z) @ S(2.4, 2.6, 2.2),
                           CONTAINER_COLS[(k // 4) % len(CONTAINER_COLS)])
    met.add(CYL12, T(C.x - 2.5, C.y, C.z) @ Ry(math.pi / 2) @ S(1.5, 1.5, 5))
    for ox in (-3.5, 3.5):
        for oy in (-14, 14):
            met.between((C.x + ox, C.y + oy, deck_z), (C.x + ox * 0.6, C.y, C.z), 0.9)
    # roller coaster loop style track (simple)
    pts = []
    for k in range(120):
        t = k / 120 * 2 * math.pi
        pts.append(Vector((px - 22 + 14 * math.cos(t), y_end - 45 + 30 * math.sin(t),
                           deck_z + 6 + 7 * math.sin(3 * t) ** 2)))
    for k in range(120):
        a, b = pts[k], pts[(k + 1) % 120]
        B("paint").between(a, b, 0.5, srgb((0.95, 0.85, 0.1)), thick_y=1.6)
        if k % 6 == 0:
            met.add(CYL8, T(a.x, a.y, deck_z) @ S(0.2, 0.2, a.z - deck_z))


def build_port():
    x0, x1, y0, y1 = 440.0, 700.0, -575.0, COAST_Y
    B("concrete").box(x0, y0, -8, x1, y1, 1.2)
    B("mark_y").box(x0, y0 + 0.5, 1.2, x1, y0 + 1.0, 1.23)
    container_yard(x0 + 5, y0 + 40, x1 - 5, y1 - 8, 1.2)
    # gantry cranes
    for cxp, col in ((480, srgb((0.85, 0.15, 0.08))), (545, srgb((0.10, 0.35, 0.70))),
                     (610, srgb((0.85, 0.15, 0.08))), (670, srgb((0.95, 0.55, 0.05)))):
        p = B("paint")
        for dx in (-7, 7):
            for yy in (y0 + 4, y0 + 26):
                p.box(cxp + dx - 0.8, yy - 0.8, 1.2, cxp + dx + 0.8, yy + 0.8, 46, col)
            p.box(cxp + dx - 0.7, y0 + 4, 20, cxp + dx + 0.7, y0 + 26, 21.4, col)
            p.box(cxp + dx - 0.7, y0 - 55, 44, cxp + dx + 0.7, y0 + 40, 46.5, col)
            p.between((cxp + dx, y0 + 30, 46.5), (cxp + dx, y0 + 16, 62), 0.6, col)
            p.between((cxp + dx, y0 + 16, 62), (cxp + dx, y0 - 50, 46.5), 0.4, col)
        p.box(cxp - 7, y0 + 30, 46, cxp + 7, y0 + 40, 52, col)
        B("glass").box(cxp - 2, y0 - 20, 40, cxp + 2, y0 - 16, 43.5)
    # cargo ship
    sy = -612.0
    hx0, hx1 = 455.0, 690.0
    p = B("paint")
    p.box(hx0, sy - 16, -6, hx1, sy + 16, 6, srgb((0.06, 0.10, 0.22)))
    p.box(hx0 - 0.1, sy - 16.1, -6, hx1 + 0.1, sy + 16.1, -0.6, srgb((0.55, 0.08, 0.06)))
    p.add(WEDGE, T(hx1, sy, -6) @ S(32, 32, 12), srgb((0.06, 0.10, 0.22)))
    p.box(hx0 + 2, sy - 12, 6, hx0 + 24, sy + 12, 26, srgb((0.95, 0.95, 0.95)))
    p.box(hx0 + 18, sy - 18, 22, hx0 + 24, sy + 18, 25, srgb((0.95, 0.95, 0.95)))
    B("glass").box(hx0 + 23.9, sy - 17, 22.5, hx0 + 24.1, sy + 17, 24.5)
    p.box(hx0 + 5, sy - 3, 26, hx0 + 12, sy + 3, 33, srgb((0.85, 0.15, 0.08)))
    x = hx0 + 30
    while x < hx1 - 14:
        for row in range(-5, 5):
            for k in range(rng.randint(2, 6)):
                container(x + 6.1, sy + row * 2.6 + 1.3, 6 + k * 2.6)
        x += 13.0


def build_airport():
    a = B("asphalt")
    # runway
    a.box(820, -88, -0.3, 1700, -32, 0.06)
    mw = B("mark_w")
    z0, z1 = 0.06, 0.08
    x = 860
    while x < 1660:
        mw.box(x, -60.4, z0, x + 22, -59.6, z1)
        x += 40
    mw.box(820, -86, z0, 1700, -85.4, z1)
    mw.box(820, -34.6, z0, 1700, -34, z1)
    for xb in (824, 1660):
        for k in range(8):
            yy = -84 + k * 6.6
            mw.box(xb, yy, z0, xb + 30, yy + 2.2, z1)
    for k in range(int(880 / 30)):
        for yy in (-90, -30):
            B("light").box(820 + k * 30, yy - 0.3, 0, 820 + k * 30 + 0.6, yy + 0.3, 0.4)
    # taxiway + connectors
    a.box(880, -150, -0.3, 1640, -126, 0.05)
    B("mark_y").box(880, -138.2, 0.05, 1640, -137.8, 0.07)
    for xc in (900, 1250, 1620):
        a.box(xc - 11, -126, -0.3, xc + 11, -88, 0.05)
    # apron
    B("concrete").box(980, -238, -0.3, 1390, -150, 0.07)
    # terminal
    B("tower").box(1000, -282, 0.07, 1370, -238, 16, srgb((0.85, 0.86, 0.88)), 0.0)
    B("roof").box(995, -286, 16, 1375, -234, 17.2, srgb((0.82, 0.83, 0.85)))
    rooftop_clutter(1010, -278, 1360, -242, 17.2)
    for k in range(5):
        jx = 1050 + k * 70
        B("paint").box(jx - 1.6, -238, 4, jx + 1.6, -210, 7.5, srgb((0.8, 0.8, 0.82)))
    tails = [srgb(c) for c in [(0.8, 0.1, 0.1), (0.1, 0.3, 0.7), (0.95, 0.6, 0.05),
                               (0.1, 0.5, 0.3), (0.5, 0.1, 0.5)]]
    for k in range(5):
        place_plane(1050 + k * 70, -186, -math.pi / 2, tails[k])
    place_plane(1350, -60, math.pi, tails[1])
    # control tower
    tx, ty = 940, -230
    B("bridge").add(CYL24, T(tx, ty, 0) @ S(4.5, 4.5, 48))
    B("tower").add(CYL24, T(tx, ty, 48) @ S(8, 8, 6), srgb((0.8, 0.8, 0.8)), 0.6)
    B("roof").add(CYL24, T(tx, ty, 54) @ S(8.8, 8.8, 1.0), srgb((0.9, 0.9, 0.9)))
    B("metal").add(CYL8, T(tx, ty, 55) @ S(0.3, 0.3, 10))
    # hangars
    for k in range(3):
        hx = 1450 + k * 70
        B("paint").add(CYL32, T(hx, -232, 0) @ Rx(-math.pi / 2) @ S(24, 18, 60), srgb((0.75, 0.78, 0.80)))
        B("metal").box(hx - 16, -232.2, 0, hx + 16, -231.8, 12)
    # parking for the terminal
    parking_lot(1000, -326, 1370, -308)
    B("concrete").box(1000, -330, -0.3, 1370, -306, CURB_H)


def build_hills():
    # mansions
    placed = 0
    tries = 0
    target = n_scaled(80)
    while placed < target and tries < 6000:
        tries += 1
        x, y = rng.uniform(-1500, 1300), rng.uniform(500, 1300)
        if x > 1700:
            continue
        h = height(x, y)
        if h < 15 or h > 260 or slope_at(x, y) > 0.28:
            continue
        w, dpt = rng.uniform(18, 30), rng.uniform(14, 22)
        rot = rng.uniform(-0.3, 0.3)
        M = T(x, y, h) @ Rz(rot)
        col = rng.choice(STUCCO[:3] + [srgb((0.98, 0.98, 0.97))])
        B("concrete").add(CUBE, M @ T(0, 0, -8) @ S(w + 10, dpt + 14, 8.4))
        B("house").add(CUBE, M @ S(w, dpt, 4.0), col)
        B("house").add(CUBE, M @ T(-w * 0.15, dpt * 0.1, 4.0) @ S(w * 0.6, dpt * 0.7, 3.6), col)
        B("glass").add(CUBE, M @ T(0, -dpt / 2, 0.5) @ S(w * 0.8, 0.12, 3.0))
        B("roof").add(CUBE, M @ T(0, 0, 4.0) @ S(w + 1.2, dpt + 1.2, 0.3), srgb((0.85, 0.85, 0.85)))
        B("roof").add(CUBE, M @ T(-w * 0.15, dpt * 0.1, 7.6) @ S(w * 0.6 + 1, dpt * 0.7 + 1, 0.3),
                      srgb((0.85, 0.85, 0.85)))
        B("pool").add(CUBE, M @ T(0, -dpt / 2 - 4.5, 0.05) @ S(w * 0.6, 4.5, 0.3))
        for k in range(rng.randint(1, 3)):
            q = M @ Vector((rng.uniform(-w / 2 - 3, w / 2 + 3), -dpt / 2 - 6, 0))
            place_palm(q.x, q.y, h, 0.9)
        placed += 1
    print(f"  mansions: {placed}")

    # vegetation on hills
    placed = 0
    target = n_scaled(4500)
    tries = 0
    while placed < target and tries < target * 4:
        tries += 1
        x, y = rng.uniform(-2600, 2900), rng.uniform(-500, 2600)
        if flat_dist(x, y) < 20:
            continue
        h = height(x, y)
        if h < 2:
            continue
        sl = slope_at(x, y)
        if sl > 0.9:
            continue
        clump = noise.noise(Vector((x / 160, y / 160, 2.0)))
        if clump < -0.1 and rng.random() < 0.8:
            continue
        s = rng.uniform(0.8, 1.6) * (1.5 if flat_dist(x, y) > 700 else 1.0)
        kind = "bush" if rng.random() < 0.45 else rng.choice(["round", "cone", "cone"])
        place_tree(x, y, h - 0.3, s * (2.2 if kind == "bush" else 1.0), kind)
        placed += 1
    print(f"  hill plants: {placed}")

    # radio towers on the highest peaks in view
    peaks = []
    for _ in range(1500):
        x, y = rng.uniform(-1200, 1400), rng.uniform(550, 1400)
        peaks.append((height(x, y), x, y))
    peaks.sort(reverse=True)
    chosen = []
    for h, x, y in peaks:
        if all(math.hypot(x - cx, y - cy) > 600 for _, cx, cy in chosen):
            chosen.append((h, x, y))
        if len(chosen) == 3:
            break
    for h, x, y in chosen:
        radio_tower(x, y, h - 1, rng.uniform(70, 110))


def radio_tower(x, y, z, H):
    red, white = srgb((0.85, 0.1, 0.08)), srgb((0.95, 0.95, 0.95))
    p = B("paint")
    levels = 10
    for k in range(levels):
        t0, t1 = k / levels, (k + 1) / levels
        w0, w1 = lerp(7, 1.2, t0), lerp(7, 1.2, t1)
        z0, z1 = z + H * t0, z + H * t1
        col = red if k % 2 == 0 else white
        corners0 = [(x - w0, y - w0), (x + w0, y - w0), (x + w0, y + w0), (x - w0, y + w0)]
        corners1 = [(x - w1, y - w1), (x + w1, y - w1), (x + w1, y + w1), (x - w1, y + w1)]
        for i in range(4):
            a0, a1 = corners0[i], corners1[i]
            p.between((a0[0], a0[1], z0), (a1[0], a1[1], z1), 0.4, col)
            b1 = corners1[(i + 1) % 4]
            p.between((a1[0], a1[1], z1), (b1[0], b1[1], z1), 0.25, col)
            p.between((a0[0], a0[1], z0), (b1[0], b1[1], z1), 0.18, col)
    B("tail").box(x - 0.6, y - 0.6, z + H, x + 0.6, y + 0.6, z + H + 1.2)
    B("house").box(x - 6, y + 10, z - 2, x + 6, y + 18, z + 3.5, srgb((0.8, 0.8, 0.78)))


# =============================================================================
# LIGHTING, WORLD, CAMERAS
# =============================================================================
def build_world():
    sc = bpy.context.scene
    world = bpy.data.worlds.new("VistaBay_Sky")
    sc.world = world
    try:
        world.use_nodes = True
    except Exception:
        pass
    nt = world.node_tree
    bg = nt.nodes.get("Background")
    sky = nt.nodes.new("ShaderNodeTexSky")
    for t in ("MULTIPLE_SCATTERING", "NISHITA", "SINGLE_SCATTERING", "HOSEK_WILKIE"):
        try:
            sky.sky_type = t
            break
        except TypeError:
            continue
    elev = {"DAY": 48.0, "SUNSET": 14.0, "NIGHT": -6.0}.get(TIME_OF_DAY, 14.0)
    rot = {"DAY": 150.0, "SUNSET": 245.0, "NIGHT": 230.0}.get(TIME_OF_DAY, 245.0)
    for attr, val in (("sun_elevation", math.radians(max(elev, -5))), ("sun_rotation", math.radians(rot)),
                      ("altitude", 200.0), ("air_density", 1.2), ("aerosol_density", 1.6),
                      ("sun_disc", False), ("sun_intensity", 1.0)):
        try:
            setattr(sky, attr, val)
        except Exception:
            pass
    if TIME_OF_DAY == "NIGHT":
        # deep blue night sky with a faint glow near the horizon
        tc = nt.nodes.new("ShaderNodeTexCoord")
        sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(tc.outputs["Generated"], sep.inputs[0])
        cr = nt.nodes.new("ShaderNodeValToRGB")
        nt.links.new(sep.outputs[2], cr.inputs[0])
        cr.color_ramp.elements[0].position = 0.5
        cr.color_ramp.elements[0].color = (0.035, 0.03, 0.05, 1.0)
        cr.color_ramp.elements[1].position = 0.75
        cr.color_ramp.elements[1].color = (0.002, 0.004, 0.012, 1.0)
        nt.links.new(cr.outputs[0], bg.inputs["Color"])
    else:
        nt.links.new(sky.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = {"DAY": 0.45, "SUNSET": 0.5, "NIGHT": 1.0}.get(TIME_OF_DAY, 0.5)

    # key light (sun / moon) for crisp shadows
    ld = bpy.data.lights.new("Sun", 'SUN')
    if TIME_OF_DAY == "NIGHT":
        ld.energy = 0.35
        ld.color = (0.55, 0.65, 1.0)
        e, r = math.radians(35), math.radians(60)
    else:
        ld.energy = {"DAY": 5.5, "SUNSET": 6.0}.get(TIME_OF_DAY, 6.0)
        ld.color = (1.0, 0.95, 0.88) if TIME_OF_DAY == "DAY" else (1.0, 0.66, 0.38)
        e, r = math.radians(max(elev, 2)), math.radians(rot)
    ld.angle = math.radians(0.6)
    sun = bpy.data.objects.new("Sun", ld)
    d = Vector((math.cos(e) * math.sin(r), -math.cos(e) * math.cos(r), math.sin(e)))
    sun.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    coll("Lighting").objects.link(sun)
    # with Nishita/multiple scattering the sun disc is already in the sky; avoid double sun
    # by keeping the sky's disc but the lamp gives sharper shadows.

    if TIME_OF_DAY == "NIGHT":
        # real light pools under every street / freeway lamp (shared light datablock)
        ldata = bpy.data.lights.new("StreetLamp", 'SPOT')
        ldata.energy = 2500
        ldata.color = (1.0, 0.72, 0.42)
        ldata.spot_size = math.radians(120)
        ldata.spot_blend = 0.6
        ldata.shadow_soft_size = 0.4
        lc = coll("Night Lights")
        for (x, y, z) in LAMP_POSITIONS:
            ob = bpy.data.objects.new("Lamp", ldata)
            ob.location = (x, y, z)
            lc.objects.link(ob)
        print(f"  night lamps: {len(LAMP_POSITIONS)}")

    if HAZE:
        me = bpy.data.meshes.new("Haze")
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new("Haze", me)
        ob.scale = (16000, 16000, 520)
        ob.location = (400, 0, 255)
        ob.data.materials.append(MATS["haze"])
        try:
            ob.visible_shadow = False
        except Exception:
            pass
        coll("Lighting").objects.link(ob)


def look_at(ob, target):
    d = Vector(target) - ob.location
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def add_camera(name, loc, target, lens=35.0, ortho=None):
    cd = bpy.data.cameras.new(name)
    cd.lens = lens
    cd.clip_start = 0.5
    cd.clip_end = 30000
    if ortho:
        cd.type = 'ORTHO'
        cd.ortho_scale = ortho
    ob = bpy.data.objects.new(name, cd)
    ob.location = loc
    look_at(ob, target)
    coll("Cameras").objects.link(ob)
    return ob


def build_cameras():
    aerial = add_camera("Cam_Aerial", (-820, -1080, 430), (110, 40, 20), 30)
    add_camera("Cam_Map", (430, 40, 3000), (430, 40.01, 0), ortho=2750)
    add_camera("Cam_Street", (-40.0, -262, 2.4), (-40.0, 250, 38), 22)
    add_camera("Cam_Beach", (-330, -520, 14), (60, -300, 40), 24)
    bpy.context.scene.camera = aerial


def setup_render():
    sc = bpy.context.scene
    try:
        sc.render.engine = 'CYCLES'
    except TypeError:
        import addon_utils
        addon_utils.enable("cycles")
        sc.render.engine = 'CYCLES'
    cy = sc.cycles
    cy.samples = SAMPLES
    cy.use_adaptive_sampling = True
    cy.adaptive_threshold = 0.015
    cy.use_denoising = True
    cy.max_bounces = 8
    cy.diffuse_bounces = 3
    cy.glossy_bounces = 3
    cy.transmission_bounces = 6
    cy.volume_bounces = 0
    cy.transparent_max_bounces = 8
    try:
        cy.volume_step_rate = 4.0
    except Exception:
        pass
    sc.render.resolution_x = RES_X
    sc.render.resolution_y = RES_Y
    sc.render.resolution_percentage = 100
    if IMG_FORMAT == "JPEG":
        sc.render.image_settings.file_format = 'JPEG'
        sc.render.image_settings.quality = 92
    else:
        sc.render.image_settings.file_format = 'PNG'
        sc.render.image_settings.color_depth = '8'
    for vt in ("AgX", "Filmic"):
        try:
            sc.view_settings.view_transform = vt
            break
        except TypeError:
            continue
    for look in ("AgX - Punchy", "AgX - Medium High Contrast", "Punchy", "Medium High Contrast"):
        try:
            sc.view_settings.look = look
            break
        except TypeError:
            continue
    sc.view_settings.exposure = {"DAY": 0.0, "SUNSET": 0.0, "NIGHT": 0.3}.get(TIME_OF_DAY, 0.0)
    # use GPU when available
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        for dev_type in ("OPTIX", "CUDA", "HIP", "METAL", "ONEAPI"):
            try:
                prefs.compute_device_type = dev_type
            except TypeError:
                continue
            prefs.get_devices()
            gpus = [d for d in prefs.devices if d.type == dev_type]
            if gpus:
                for d in prefs.devices:
                    d.use = d.type == dev_type
                cy.device = 'GPU'
                print(f"  render device: GPU ({dev_type})")
                break
        else:
            prefs.compute_device_type = 'NONE'
            cy.device = 'CPU'
            print("  render device: CPU")
    except Exception as e:
        print("  GPU setup skipped:", e)


def render_cameras():
    sc = bpy.context.scene
    out = OUTPUT_DIR
    if not out:
        if bpy.data.filepath:
            out = bpy.path.abspath("//renders")
        else:
            out = os.path.join(os.getcwd(), "renders")
    os.makedirs(out, exist_ok=True)
    cams = [o for o in coll("Cameras").objects]
    for cam in cams:
        if RENDER_CAMS and cam.name not in RENDER_CAMS:
            continue
        sc.camera = cam
        ext = "jpg" if IMG_FORMAT == "JPEG" else "png"
        path = os.path.join(out, f"vista_bay_{cam.name}_{TIME_OF_DAY.lower()}_{RES_X}x{RES_Y}.{ext}")
        sc.render.filepath = path
        t0 = time.time()
        print(f"Rendering {cam.name} -> {path}")
        bpy.ops.render.render(write_still=True)
        print(f"  done in {time.time() - t0:.0f}s")


# =============================================================================
# MAIN
# =============================================================================
def main():
    parse_args()
    t0 = time.time()
    print("== Vista Bay city generator ==")
    print(f"time={TIME_OF_DAY} res={RES_X}x{RES_Y} samples={SAMPLES} detail={DETAIL}")
    reset_scene()
    build_materials()
    print("terrain...")
    build_terrain()
    print("roads...")
    build_roads()
    print("city blocks...")
    build_city_blocks()
    print("landmarks...")
    build_park()
    build_stadium()
    build_beach()
    build_pier()
    build_port()
    build_airport()
    print("freeway...")
    build_freeway()
    print("traffic...")
    build_traffic()
    print("hills...")
    build_hills()

    groups = {
        "Roads": ["asphalt", "mark_y", "mark_w", "concrete", "bridge"],
        "Buildings": ["tower", "midrise", "house", "roof", "glass", "pool"],
        "Vegetation": ["palm_trunk", "leaves", "grass"],
        "Vehicles": ["carpaint", "rubber", "headlight", "tail"],
        "Props": ["paint", "metal", "light", "wood", "neon", "water"],
    }
    mat_for = {"palm_trunk": "trunk"}
    total_v = 0
    for gname, keys in groups.items():
        for k in keys:
            if k in BUILDERS:
                b = BUILDERS[k]
                total_v += len(b.v)
                b.build(MATS[mat_for.get(k, k)], coll(gname), smooth=k in ("palm_trunk", "leaves"))
    for k, b in BUILDERS.items():
        if not any(k in v for v in groups.values()):
            b.build(MATS[mat_for.get(k, k)], coll("Props"))
            total_v += len(b.v)
    print(f"  total vertices (excluding terrain): {total_v:,}")

    build_world()
    build_cameras()
    setup_render()
    print(f"Generated in {time.time() - t0:.1f}s")

    if SAVE_BLEND:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(SAVE_BLEND))
        print("saved", SAVE_BLEND)
    if RENDER_ON_RUN:
        render_cameras()


if __name__ == "__main__":
    main()
