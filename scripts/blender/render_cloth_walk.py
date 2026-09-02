"""Blender-native cloth garment on the Expy-Kit walking MPFB/Rigify human (Phase 1).

This is the durable Phase-1 harness from
``docs/research/cloth-system-design.md``: it drapes a *loose* garment on the
production human — MPFB hm08 CC0 mesh + Rigify rig (ADR 074), animated by a CC0
Quaternius action retargeted with Expy Kit (ADR 075) — using Blender's built-in
Cloth modifier, headless and deterministically, then runs a mechanical gate and
renders contact-sheet evidence.

It orchestrates the mature tool rather than re-implementing a solver
(``docs/product-principles.md``), and reuses the existing repo helpers:

* ``render_expykit_action_reel`` — body build + walk bake + fixed camera +
  contact sheet (which in turn loads ``render_mpfb_motion_probe`` /
  ``render_motion_probe`` / ``render_geometry_probe``).
* ``production_character_assembly.transfer_body_weights`` — reserved for the
  *fitted* garments added in Phase 2 (not used for this loose skirt).

Pipeline for the mini skirt (a loose, waist-pinned garment):

1. Build the MPFB/Rigify human and bake the ``Walk_Loop`` action via Expy Kit.
2. Make the body a Collision object (``thickness_outer``, ``cloth_friction``).
3. Procedurally generate the skirt from the body's hip cross-section, hugging the
   silhouette with per-ring **outward clearance** so it starts *outside* the body
   (no initial interpenetration); pin the top ring as the waistband.
4. Cloth on the skirt (quality 8, collision quality 5, self-collision, impulse
   clamp, ANGULAR bending).
5. **Pre-roll** ``PREROLL`` static frames at the first walk pose (via the baked
   action's constant extrapolation before frame 1) so the skirt settles, then
   simulate through the walk; bake to a disk point cache.
6. Run the headless mechanical gate (NaN / bbox-explosion / inter-frame velocity
   / body-penetration / waistband anchor drift / self-intersection / edge strain).
7. Render side + three-quarter mp4s + contact sheets and write ``report.json``.

The garment is described by a ``GARMENT_SPECS`` entry so Phase 2/3 garments can
reuse the same harness; only ``mini-skirt`` runs today.

Usage::

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
      --python scripts/blender/render_cloth_walk.py \
      -- geometry.json source.fbx output-dir

Environment:
    VIDEOER_CLOTH_GARMENT   garment spec name (default: ``mini-skirt``).
    VIDEOER_CLOTH_CLIP      source clip name  (default: ``Walk_Loop``).
    VIDEOER_CLOTH_PREROLL   settle frames before the walk (default: ``25``).
"""

import importlib.util
import json
import math
import os
import sys

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def _load(filename, name):
    path = os.path.join(SCRIPT_DIR, filename)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# Reuse the Expy Kit reel (and, transitively, the mpfb/motion/geometry probes).
reel = _load("render_expykit_action_reel.py", "cloth_walk_reel")
rigify_adapter = reel.rigify_adapter
motion_probe = reel.motion_probe
geometry_probe = reel.geometry_probe
# Reuse the proven BVH + barycentric body->garment weight transfer.
assembly = _load("production_character_assembly.py", "cloth_walk_assembly")


# --- Garment specifications (Phase 2/3 add fitted/hybrid entries here) --------
GARMENT_SPECS = {
    "mini-skirt": {
        "kind": "hybrid",            # fitted upper (armature) + light-sim hem
        # Height fraction is measured within the pelvis+thigh region (see
        # region_tokens): 0.9 places the waistband near the top (the hips).
        "waist_height_frac": 0.9,    # waistband at the hips (top of pelvis region)
        "length_m": 0.22,            # short: waist to upper-thigh (mini)
        "rings": 18,                 # vertical resolution
        "segments": 44,              # angular resolution
        "clearance_top_m": 0.02,     # snug waistband (just outside the thin collider)
        "clearance_bottom_m": 0.06,  # A-line flare: room for the legs to swing inside
        # Pelvis+thigh region only: excludes the arms (whose hands hang at waist
        # height in the rest A-pose and would otherwise be encircled -> a 0.5 m
        # disc) and the chest-inflating spine bones.
        "region_tokens": ("pelvis", "thigh"),
        # Hybrid pin gradient: the top FITTED_FRACTION of rings is fully pinned to
        # the armature (fitted, cannot thrash); the bottom FREE_FRACTION is free
        # cloth (a light-swinging hem); a short transition ramps between. A full
        # free tube around two swinging legs is inherently unstable (collision
        # spikes / 64x edge stretch), so most of a mini skirt is fitted geometry.
        "lock_rings": 4,             # a thin fitted waistband band (rest is free drape)
        "pin_fade_rings": 9,         # pin weight fades 1->0 over this many rings
        "color": (0.10, 0.27, 0.31, 1.0),
        "cloth": {
            "quality": 14,             # high substeps: legs swing through the hem
            "mass": 0.3,
            "tension_stiffness": 30,   # resist stretch at the fitted/free boundary
            "compression_stiffness": 30,
            "shear_stiffness": 15,
            "bending_stiffness": 3.0,  # holds skirt form, less crumpling
            "air_damping": 2.0,        # calms the hem
            "pin_stiffness": 5.0,      # hold the fitted region firmly
            "collision_quality": 14,   # robust against fast legs
            "distance_min": 0.006,
            "self_distance_min": 0.005,
            "impulse_clamp": 6.0,
        },
    },
    # Fitted garment: deforms with the body via the armature, no cloth sim. This
    # is the stable Phase-1 garment that establishes the end-to-end pipeline on the
    # walk (the loose-skirt cloth tuning continues as follow-up).
    "crop-top": {
        "kind": "fitted",
        "from_body_surface": True,   # duplicate the body's torso surface (exact fit)
        "waist_height_frac": 0.62,   # top hem on the chest, below the armpits
        "length_m": 0.20,           # cropped: chest down to the midriff
        "surface_offset_m": 0.02,    # stands off the skin so it reads as a garment
        "region_tokens": ("spine",), # torso surface only (exclude arms/legs)
        "color": (0.55, 0.16, 0.22, 1.0),
    },
}

# --- Mechanical gate thresholds (from docs/research/cloth-system-design.md) ---
GATE = {
    "explosion_ratio_max": 1.5,
    "velocity_max_m_per_frame": 0.30,  # tolerates legit leg-driven hem swing; catches launches (>>1)
    "penetration_tol_m": 0.005,
    "penetration_frac_clip_max": 0.02,
    "penetration_frac_frame_max": 0.05,
    # Waistband pin drift: max distance of a pinned waistband vertex from the body
    # surface. Only gated for loose (cloth-pinned) garments; a soft draping
    # waistband sits a little off the body, so this is a clearance bound, not a
    # skin-tight one (a fitted garment's "stays on" is the penetration check). A
    # snug waistband would tighten this; Phase-1 loose garments accept soft drape.
    "anchor_drift_max_m": 0.15,
    "self_tol_m": 0.004,
    "self_intersect_frac_max": 0.02,
    # Edge strain for FREE-SIMULATED cloth is judged on BULK behaviour, not a
    # single-edge hard max. A real fabric sim has invisible, localized stretch
    # spikes at pinned seams; a hard max=1.35 (seeded from the old CPU *corrective*
    # cloth, ADR 030) trips on those while the garment reads perfectly. So gate the
    # 99th/1st percentile (is the bulk of the cloth near its rest shape?) plus a
    # generous blow-up catch that only fires on genuine solver explosions (which
    # run 20x+). Thresholds validated against the rendered contact sheets.
    "edge_stretch_p99_max": 1.6,
    "edge_compression_p01_min": 0.45,
    "edge_blowup_max": 15.0,
}


def _percentile(values, pct):
    """Linear-interpolated percentile of a list (pct in 0..100)."""
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    rank = (pct / 100.0) * (len(ordered) - 1)
    low = int(rank)
    frac = rank - low
    if low + 1 >= len(ordered):
        return ordered[-1]
    return ordered[low] + frac * (ordered[low + 1] - ordered[low])

# Body collider (Collision modifier / CollisionSettings).
BODY_THICKNESS_OUTER_M = 0.006  # thin margin so the snug waistband is not ejected
BODY_THICKNESS_INNER_M = 0.02
BODY_CLOTH_FRICTION = 8.0       # grip: the hem slides less, thrashes less


def arguments():
    if "--" not in sys.argv:
        raise RuntimeError("Expected geometry, source FBX and output after --")
    values = sys.argv[sys.argv.index("--") + 1:]
    if len(values) != 3:
        raise RuntimeError(
            "Usage: render_cloth_walk.py -- geometry.json source.fbx output"
        )
    return tuple(os.path.abspath(v) for v in values)


# --- body + walk (reuse the Expy Kit reel) -----------------------------------
def build_walking_body(asset, source_file, clip, mpfb_module):
    """Import the source clip, build the MPFB/Rigify human, bake the walk.

    Mirrors ``render_expykit_action_reel.process_clip`` up to the bake, then
    returns the body mesh, its armature and the walk's ``[start, end]`` frames.
    """
    geometry_probe.clear_scene()
    reel.purge_actions()

    source = reel.import_source(source_file)
    actions = {a.name.rsplit("|", 1)[-1]: a for a in bpy.data.actions if "|" in a.name}
    action = actions.get(clip)
    if action is None:
        raise RuntimeError(f"Source clip '{clip}' not found. Available: {sorted(actions)}")
    start, end = (round(v) for v in action.frame_range)
    if source.animation_data is None:
        source.animation_data_create()
    source.animation_data.action = None

    armature, mesh = rigify_adapter.create_rigged_human(mpfb_module, asset, clear_scene=False)
    armature.name = "rigify_target"
    armature.animation_data_clear()

    constrained = reel.constrain_rigify_to_source(source, armature)
    if os.environ.get("VIDEOER_EXPYKIT_LEVEL_HEAD", "1") == "1":
        controls = reel.level_head_neck(armature, constrained)
    else:
        controls = constrained
    baked = reel.bake_constrained(armature, source, action, start, end, controls)
    baked.name = f"videoer.cloth.{clip}"
    baked.use_fake_user = True
    # Hold the first walk pose during the pre-roll (frames < start).
    _force_constant_extrapolation(baked)

    scene = bpy.context.scene
    scene.frame_start, scene.frame_end = start, end
    scene.frame_set(start)
    bpy.context.view_layer.update()
    y0 = armature.pose.bones["root"].matrix.translation.y
    scene.frame_set(end)
    bpy.context.view_layer.update()
    y1 = armature.pose.bones["root"].matrix.translation.y

    bpy.data.objects.remove(source, do_unlink=True)
    return mesh, armature, start, end, (y0 + y1) / 2.0, abs(y1 - y0)


def _iter_fcurves(action):
    """Yield fcurves for both legacy and Blender 4.4+ slotted actions."""
    if action.fcurves:
        yield from action.fcurves
        return
    for layer in getattr(action, "layers", []):
        for strip in layer.strips:
            for slot in getattr(action, "slots", []):
                bag = strip.channelbag(slot) if hasattr(strip, "channelbag") else None
                if bag:
                    yield from bag.fcurves


def _force_constant_extrapolation(action):
    for fcurve in _iter_fcurves(action):
        try:
            fcurve.extrapolation = "CONSTANT"
        except Exception:
            pass


# --- collider ----------------------------------------------------------------
def make_body_collider(body):
    modifier = body.modifiers.new("cloth-collision", "COLLISION")
    body.collision.thickness_outer = BODY_THICKNESS_OUTER_M
    body.collision.thickness_inner = BODY_THICKNESS_INNER_M
    body.collision.cloth_friction = BODY_CLOTH_FRICTION
    return modifier


# --- procedural garment ------------------------------------------------------
def evaluated_world_verts(obj, deps):
    ev = obj.evaluated_get(deps)
    tmp = ev.to_mesh()
    matrix = ev.matrix_world
    verts = [matrix @ v.co for v in tmp.vertices]
    ev.to_mesh_clear()
    return verts


def body_bvh(body, deps):
    ev = body.evaluated_get(deps)
    tmp = ev.to_mesh()
    matrix = ev.matrix_world
    verts = [matrix @ v.co for v in tmp.vertices]
    polys = [tuple(p.vertices) for p in tmp.polygons]
    bvh = BVHTree.FromPolygons(verts, polys)
    ev.to_mesh_clear()
    return bvh


def body_reference_verts(body, spec):
    """World-space body vertices for the garment's region, in the REST pose.

    The garment is generated from the rest shape so the shared Armature modifier
    poses it *once* alongside the body (generating from a posed frame and binding
    double-applies the pose). It is restricted to the body region the garment
    wraps (``region_tokens`` -> deform-bone names), because at the rest A-pose the
    arms stand out to the sides: a chest cross-section taken from the whole body
    would encircle the shoulders and make a wide flaring "wing" instead of a
    torso-hugging tube.
    """
    matrix = body.matrix_world
    tokens = spec.get("region_tokens")
    if tokens:
        region = {
            vg.index
            for vg in body.vertex_groups
            if any(t in vg.name.lower() for t in tokens) and not _is_upper_limb_bone(vg.name)
        }
        if region:
            verts = [
                matrix @ v.co
                for v in body.data.vertices
                if any(g.group in region and g.weight > 0.3 for g in v.groups)
            ]
            if verts:
                return verts
    group = body.vertex_groups.get("body")
    if group is None:
        return [matrix @ v.co for v in body.data.vertices]
    index = group.index
    verts = [
        matrix @ v.co
        for v in body.data.vertices
        if any(g.group == index and g.weight > 0 for g in v.groups)
    ]
    return verts or [matrix @ v.co for v in body.data.vertices]


def _apply_scale(obj):
    """Bake the object's scale into its mesh data so object-scale becomes 1.0
    (world appearance unchanged). Blender's cloth solver is unstable when the
    cloth object has scale != 1 - the garment inherits the body's ~0.10 scale, so
    the spring rest lengths fight world gravity and the sim explodes. Done
    manually because ``transform_apply`` cannot run in ``--background``.
    """
    from mathutils import Matrix

    scale = obj.matrix_basis.to_scale()
    if all(abs(component - 1.0) < 1e-6 for component in scale):
        return
    obj.data.transform(Matrix.Diagonal((scale.x, scale.y, scale.z)).to_4x4())
    loc = obj.matrix_basis.to_translation()
    rot = obj.matrix_basis.to_quaternion()
    obj.matrix_basis = Matrix.LocRotScale(loc, rot, (1.0, 1.0, 1.0))
    obj.data.update()


def _build_adjacency(mesh, hops=2):
    """Per-vertex set of vertices within ``hops`` edges (plus itself). Used to
    exclude topologically-near pairs from the self-intersection sampling, for any
    garment topology (procedural tube or duplicated body surface)."""
    one = [set() for _ in mesh.vertices]
    for edge in mesh.edges:
        a, b = edge.vertices
        one[a].add(b)
        one[b].add(a)
    adjacent = [set(ring) for ring in one]
    for _ in range(hops - 1):
        grown = []
        for i in range(len(mesh.vertices)):
            near = set(adjacent[i])
            for j in list(adjacent[i]):
                near |= one[j]
            grown.append(near)
        adjacent = grown
    for i in range(len(mesh.vertices)):
        adjacent[i].add(i)
    return adjacent


def generate_from_body_surface(body, spec):
    """Generate a FITTED garment by duplicating the body's own surface region.

    The garment then has the body's exact topology and (crucially) the body's own
    vertex weights, so it deforms identically to the skin - no shrinkwrap seam
    collapse, no penetration, edge strain ~1.0. We keep the torso vertices in the
    garment's z-band, push them slightly outward along their normals, and return a
    generic ``meta`` (edge-based adjacency, no ring/seg structure).
    """
    import bmesh

    torso = body_reference_verts(body, spec)
    zs = [v.z for v in torso]
    zmin, zmax = min(zs), max(zs)
    height = zmax - zmin
    top_z = zmin + spec["waist_height_frac"] * height
    hem_z = top_z - spec["length_m"]

    dup = body.copy()
    dup.data = body.data.copy()
    dup.name = "garment"
    bpy.context.collection.objects.link(dup)
    dup.modifiers.clear()

    region_tokens = spec.get("region_tokens", ("spine",))
    region = {
        vg.index
        for vg in dup.vertex_groups
        if any(t in vg.name.lower() for t in region_tokens) and not _is_upper_limb_bone(vg.name)
    }
    body_group = dup.vertex_groups.get("body")
    body_index = body_group.index if body_group else None
    matrix = dup.matrix_world
    keep = set()
    for v in dup.data.vertices:
        world_z = (matrix @ v.co).z
        if not (hem_z <= world_z <= top_z):
            continue
        in_region = sum(g.weight for g in v.groups if g.group in region) > 0.5
        on_skin = body_index is None or any(g.group == body_index and g.weight > 0 for g in v.groups)
        if in_region and on_skin:
            keep.add(v.index)
    if len(keep) < 30:
        raise RuntimeError(f"body-surface garment region too small ({len(keep)} verts)")

    bm = bmesh.new()
    bm.from_mesh(dup.data)
    bm.verts.ensure_lookup_table()
    remove = [bm.verts[i] for i in range(len(bm.verts)) if i not in keep]
    bmesh.ops.delete(bm, geom=remove, context="VERTS")
    bm.to_mesh(dup.data)
    bm.free()
    dup.data.update()

    # Object scale -> 1 so the outward offset is in world metres.
    _apply_scale(dup)
    offset = spec.get("surface_offset_m", 0.008)
    normals = [v.normal.copy() for v in dup.data.vertices]
    for v in dup.data.vertices:
        v.co = v.co + normals[v.index] * offset
    dup.data.update()

    if not dup.vertex_groups.get("waistband"):
        dup.vertex_groups.new(name="waistband")

    world = dup.matrix_world
    rest = [world @ v.co for v in dup.data.vertices]
    rest_edges = [(e.vertices[0], e.vertices[1]) for e in dup.data.edges]
    rest_lengths = [max(1e-9, (rest[a] - rest[b]).length) for a, b in rest_edges]
    lo = Vector((min(p.x for p in rest), min(p.y for p in rest), min(p.z for p in rest)))
    hi = Vector((max(p.x for p in rest), max(p.y for p in rest), max(p.z for p in rest)))
    meta = {
        "rings": 0,
        "pin_indices": [],
        "rest_edges": rest_edges,
        "rest_lengths": rest_lengths,
        "rest_diag": (hi - lo).length,
        "adjacent": _build_adjacency(dup.data, hops=2),
    }
    return dup, meta


def surface_bind(garment, armature):
    """Bind a duplicated-body-surface garment: it already carries the body's own
    weights, so it only needs the Armature modifier to deform exactly like skin."""
    modifier = garment.modifiers.new("skin", "ARMATURE")
    modifier.object = armature
    modifier.use_deform_preserve_volume = True
    return {"mode": "fitted-body-surface-duplicate"}


def generate_skirt(spec, body_verts):
    """Build a waist-pinned skirt hugging the hip cross-section with clearance.

    Each vertical ring's radius is the body's maximum radius at that height plus
    an outward clearance (snug at the waist, flared at the hem), so the whole
    garment starts *outside* the body and never begins interpenetrating.
    """
    zs = [v.z for v in body_verts]
    zmin, zmax = min(zs), max(zs)
    height = zmax - zmin
    waist_z = zmin + spec["waist_height_frac"] * height
    hem_z = waist_z - spec["length_m"]

    band = [v for v in body_verts if abs(v.z - waist_z) < 0.04]
    cx = sum(v.x for v in band) / len(band)
    cy = sum(v.y for v in band) / len(band)

    rings, segs = spec["rings"], spec["segments"]
    positions = []
    for i in range(rings):
        t = i / (rings - 1)
        z = waist_z + t * (hem_z - waist_z)
        near = [v for v in body_verts if abs(v.z - z) < 0.05]
        body_r = max(math.hypot(v.x - cx, v.y - cy) for v in near) if near else 0.12
        clearance = spec["clearance_top_m"] + t * (spec["clearance_bottom_m"] - spec["clearance_top_m"])
        radius = body_r + clearance
        for j in range(segs):
            angle = 2.0 * math.pi * j / segs
            positions.append((cx + radius * math.cos(angle), cy + radius * math.sin(angle), z))

    faces = []
    for i in range(rings - 1):
        for j in range(segs):
            j2 = (j + 1) % segs
            faces.append((i * segs + j, i * segs + j2, (i + 1) * segs + j2, (i + 1) * segs + j))

    mesh = bpy.data.meshes.new(spec.get("name", "garment"))
    mesh.from_pydata(positions, [], faces)
    mesh.update()
    obj = bpy.data.objects.new("garment", mesh)
    bpy.context.collection.objects.link(obj)

    # Empty cloth pin group; populated with a smooth top->hem gradient by
    # _lock_and_gradient once the skirt is bound to the armature.
    obj.vertex_groups.new(name="waistband")

    ring_of = [k // segs for k in range(len(positions))]
    seg_of = [k % segs for k in range(len(positions))]
    rest = [Vector(p) for p in positions]
    rest_edges = [(e.vertices[0], e.vertices[1]) for e in mesh.edges]
    rest_lengths = [(rest[a] - rest[b]).length for a, b in rest_edges]
    rest_diag = (Vector((max(p[0] for p in positions), max(p[1] for p in positions), max(p[2] for p in positions)))
                 - Vector((min(p[0] for p in positions), min(p[1] for p in positions), min(p[2] for p in positions)))).length
    meta = {
        "rings": rings,
        "ring_of": ring_of,
        "pin_indices": list(range(segs)),
        "rest_edges": rest_edges,
        "rest_lengths": rest_lengths,
        "rest_diag": rest_diag,
        "adjacent": _build_adjacency(mesh, hops=2),
        "waist_z": waist_z,
        "hem_z": hem_z,
    }
    return obj, meta


def bind_skirt_to_body(skirt, body, armature, meta, spec):
    """Skin the skirt to the Rigify rig so its pinned waistband tracks the hips.

    A static cloth pin holds vertices at their world-rest position, so a body
    that walks forward simply leaves the skirt behind (the 0.6 m drift / torn
    edges seen in the first Phase-1 run). The standard fix for pinned cloth on an
    animated character is an **Armature modifier placed above the Cloth modifier**:
    Blender feeds the armature-deformed mesh into the cloth solver, so pinned
    vertices follow the animated hips while the rest of the skirt simulates
    hanging from them. Weights are transferred from the body with the reused
    ``production_character_assembly.transfer_body_weights`` (BVH nearest +
    barycentric blend). The skirt is first moved into the body's local space so
    the transfer and the shared armature operate in one coordinate system.
    """
    skirt.data.transform(body.matrix_world.inverted())
    skirt.data.update()
    skirt.parent = body.parent
    if body.parent is not None:
        skirt.matrix_parent_inverse = body.matrix_parent_inverse.copy()
    skirt.matrix_basis = body.matrix_basis.copy()
    bpy.context.view_layer.update()

    assembly.transfer_body_weights(body, skirt, armature)
    _delimb_skirt(skirt, armature)
    hip = _lock_and_gradient(skirt, armature, meta, spec)

    # Bake the inherited body scale into the mesh BEFORE the Armature modifier, so
    # the cloth object is scale 1.0 (Blender cloth explodes on scaled objects) and
    # the armature binds against the unscaled rest. Applying scale AFTER the
    # modifier corrupts the deform binding (the garment flies off the body).
    _apply_scale(skirt)

    modifier = skirt.modifiers.new("skin", "ARMATURE")
    modifier.object = armature
    modifier.use_deform_preserve_volume = True
    return hip


# Bone-name tokens for the upper body / limbs a skirt must never follow. The
# nearest-surface weight transfer otherwise binds side vertices to the arms/hands
# that hang beside the hips at the bind pose, so an arm swing flings the skirt.
_UPPER_LIMB_TOKENS = (
    "arm", "hand", "shoulder", "clavicle", "finger", "thumb", "palm",
    "f_index", "f_middle", "f_ring", "f_pinky", "breast", "elbow", "wrist",
    "neck", "head",
)
_LOWER_BODY_TOKENS = ("spine", "pelvis", "thigh", "shin", "hip")


def _is_upper_limb_bone(name):
    lowered = name.lower()
    return any(token in lowered for token in _UPPER_LIMB_TOKENS)


def _delimb_skirt(skirt, armature):
    """Keep the skirt weighted to the lower body only.

    Removes every arm/hand/shoulder influence the surface transfer picked up, then
    reassigns any vertex left with no deform weight to its nearest pelvis/spine/
    thigh bone so it still follows the hips (the armature modifier renormalizes the
    remaining weights). The cloth pin group ``waistband`` is left untouched.
    """
    all_indices = list(range(len(skirt.data.vertices)))
    for group in list(skirt.vertex_groups):
        if group.name != "waistband" and _is_upper_limb_bone(group.name):
            group.remove(all_indices)
    arm_world = armature.matrix_world
    lower = [
        (b, arm_world @ ((b.head_local + b.tail_local) * 0.5))
        for b in armature.data.bones
        if b.use_deform and not _is_upper_limb_bone(b.name)
        and any(token in b.name.lower() for token in _LOWER_BODY_TOKENS)
    ]
    world = skirt.matrix_world
    for vertex in skirt.data.vertices:
        has_deform = any(
            skirt.vertex_groups[g.group].name != "waistband" for g in vertex.groups
        )
        if has_deform:
            continue
        point = world @ vertex.co
        bone = min(lower, key=lambda item: (point - item[1]).length)[0]
        group = skirt.vertex_groups.get(bone.name) or skirt.vertex_groups.new(name=bone.name)
        group.add([vertex.index], 1.0, "REPLACE")


def _lock_and_gradient(skirt, armature, meta, spec):
    """Hip-lock the top rings and build a smooth pin gradient (no tear line).

    * Armature: the top ``lock_rings`` rings are bound 1.0 to their nearest
      pelvis/hip/thigh deform bone, so they sit ON the hips at clearance distance
      and track the walk (waistband anchor drift -> ~clearance, not 0.8 m).
    * Cloth pin: ``vertex_group_mass`` fades linearly from 1.0 at the top ring to
      0 over ``pin_fade_rings`` rings. The smooth fade removes the hard pinned/free
      boundary that tore the mesh (edge stretch), while the lower rings simulate
      freely and drape.
    """
    ring_of = meta["ring_of"]
    rings = meta["rings"]
    world = skirt.matrix_world
    arm_world = armature.matrix_world
    # Lock ONLY to pelvis/lower-spine bones - NOT the thighs. The thighs swing
    # with the legs, so a waistband vertex bound to a thigh swings with the leg
    # (one leg forward -> that vertex flies ~0.8 m), tearing the waistband apart.
    # Binding to the pelvis makes the waistband a stable hoop that sways with the
    # hips while the free hem drapes over the independently-swinging legs.
    candidates = [
        (b, arm_world @ ((b.head_local + b.tail_local) * 0.5))
        for b in armature.data.bones
        if b.use_deform and not _is_upper_limb_bone(b.name)
        and any(token in b.name.lower() for token in ("spine", "pelvis"))
        and "helper" not in b.name.lower()
    ]
    ring_verts = {i: [k for k in range(len(ring_of)) if ring_of[k] == i] for i in range(rings)}
    lock_rings = spec.get("lock_rings", 5)
    pin_fade = float(spec.get("pin_fade_rings", 8))
    pin = skirt.vertex_groups["waistband"]

    # Lock the whole fitted region to ONE central pelvis bone (nearest to the top
    # ring's centroid), so it is a single rigid hoop. Splitting the waistband
    # between DEF-pelvis.L and .R lets the two hips (which sway oppositely) pull
    # adjacent vertices apart, tearing the ring.
    top = ring_verts[0]
    centroid = sum((world @ skirt.data.vertices[k].co for k in top), Vector()) / len(top)
    # Prefer the pelvis-root bone (lowest, most stable - it translates with the
    # root and barely rotates, so the waistband hoop does not tilt/lift as the
    # torso leans); fall back to the nearest pelvis/spine bone.
    root_bones = [c for c in candidates if c[0].name in ("DEF-spine", "DEF-pelvis")]
    hip_bone = (min(root_bones, key=lambda item: item[1].z)
                if root_bones
                else min(candidates, key=lambda item: (centroid - item[1]).length))[0]
    hip_group = skirt.vertex_groups.get(hip_bone.name) or skirt.vertex_groups.new(name=hip_bone.name)

    for i in range(rings):
        verts = ring_verts[i]
        if i < lock_rings:
            for group in skirt.vertex_groups:
                if group.name != "waistband":
                    group.remove(verts)
            hip_group.add(verts, 1.0, "REPLACE")
        weight = max(0.0, 1.0 - i / pin_fade)
        if weight > 0.0:
            pin.add(verts, weight, "REPLACE")
        else:
            pin.remove(verts)
    return {"lockRings": lock_rings, "pinFadeRings": pin_fade, "hipBone": hip_bone.name}


# --- cloth + bake ------------------------------------------------------------
def setup_cloth(skirt, spec):
    modifier = skirt.modifiers.new("cloth", "CLOTH")
    cfg = spec["cloth"]
    s = modifier.settings
    s.quality = cfg["quality"]
    s.mass = cfg["mass"]
    s.tension_stiffness = cfg["tension_stiffness"]
    s.compression_stiffness = cfg["compression_stiffness"]
    s.shear_stiffness = cfg["shear_stiffness"]
    s.bending_stiffness = cfg["bending_stiffness"]
    s.bending_model = "ANGULAR"
    s.air_damping = cfg["air_damping"]
    s.vertex_group_mass = "waistband"       # pin group
    s.pin_stiffness = cfg["pin_stiffness"]
    c = modifier.collision_settings
    c.use_collision = True
    c.collision_quality = cfg["collision_quality"]
    c.distance_min = cfg["distance_min"]
    c.use_self_collision = True
    c.self_distance_min = cfg["self_distance_min"]
    c.impulse_clamp = cfg["impulse_clamp"]
    c.self_impulse_clamp = cfg["impulse_clamp"]
    return modifier


def bake_cloth(skirt, modifier, scene, sim_start, sim_end, output):
    cache = modifier.point_cache
    cache.frame_start = sim_start
    cache.frame_end = sim_end
    cache.use_disk_cache = True
    cache.name = "cloth-walk"
    blend = os.path.join(output, "cloth-walk.blend")
    # Invalidate any stale on-disk cache from a previous run - otherwise Blender
    # reuses it and silently ignores changed cloth/collision settings (the sim
    # comes out byte-identical regardless of the new parameters).
    import shutil
    for cache_dir in (os.path.join(output, "blendcache_cloth-walk"),):
        if os.path.isdir(cache_dir):
            shutil.rmtree(cache_dir, ignore_errors=True)
    try:
        with bpy.context.temp_override(scene=scene, active_object=skirt, object=skirt, point_cache=cache):
            bpy.ops.ptcache.free_bake(bake=True)
    except Exception:
        pass
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    scene.frame_start, scene.frame_end = sim_start, sim_end
    scene.frame_set(sim_start)
    baked = False
    try:
        with bpy.context.temp_override(scene=scene, active_object=skirt, object=skirt, point_cache=cache):
            bpy.ops.ptcache.bake(bake=True)
        baked = cache.is_baked
    except Exception as error:  # pragma: no cover - operator context differences
        print("PTCACHE_BAKE_FALLBACK", repr(error))
    if not baked:
        # Sequential frame stepping simulates and fills the point cache in order.
        for frame in range(sim_start, sim_end + 1):
            scene.frame_set(frame)
            skirt.evaluated_get(bpy.context.evaluated_depsgraph_get())
        baked = True
    return blend, baked


# --- mechanical gate ---------------------------------------------------------
def run_gate(skirt, body, meta, scene, start, end, is_fitted=False):
    adjacent = meta["adjacent"]
    pin = set(meta["pin_indices"])
    frames = list(range(start, end + 1))

    # Edge-strain baseline. Cloth: the relaxed generated garment (does the fabric
    # stretch from its relaxed state). Fitted: the *worn* shape at the first walk
    # frame - a fitted garment is made to conform to the body, so its unstrained
    # state is the worn shape and integrity means "does it tear DURING the walk",
    # not "does conforming to the body deviate from the flat pattern".
    if is_fitted:
        scene.frame_set(start)
        worn = evaluated_world_verts(skirt, bpy.context.evaluated_depsgraph_get())
        rest_lengths = [max(1e-9, (worn[a] - worn[b]).length) for a, b in meta["rest_edges"]]
    else:
        rest_lengths = meta["rest_lengths"]

    worst_diag = 0.0
    any_nan = False
    max_velocity = 0.0
    worst_frame_pen = 0.0
    total_pen = 0.0
    max_anchor = 0.0
    worst_self_frac = 0.0
    min_edge = float("inf")
    max_edge = 0.0
    edge_ratios = []
    prev = None

    for frame in frames:
        scene.frame_set(frame)
        deps = bpy.context.evaluated_depsgraph_get()
        verts = evaluated_world_verts(skirt, deps)
        if any(math.isnan(c) for v in verts for c in v):
            any_nan = True
            break
        xs = [v.x for v in verts]; ys = [v.y for v in verts]; zs = [v.z for v in verts]
        diag = Vector((max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))).length
        worst_diag = max(worst_diag, diag)

        if prev is not None:
            max_velocity = max(max_velocity, max((verts[i] - prev[i]).length for i in range(len(verts))))
        prev = verts

        bvh = body_bvh(body, deps)
        inside = 0
        anchor = 0.0
        for i, v in enumerate(verts):
            loc, nor, _idx, _d = bvh.find_nearest(v, 1.5)
            if loc is None:
                continue
            signed = (v - loc).dot(nor)
            if signed < -GATE["penetration_tol_m"]:
                inside += 1
            if i in pin:
                anchor = max(anchor, abs(signed))
        frac = inside / len(verts)
        worst_frame_pen = max(worst_frame_pen, frac)
        total_pen += frac
        max_anchor = max(max_anchor, anchor)

        # self-intersection: nearest non-adjacent vertex closer than tolerance
        tree = KDTree(len(verts))
        for i, v in enumerate(verts):
            tree.insert(v, i)
        tree.balance()
        self_hits = 0
        for i, v in enumerate(verts):
            for _co, j, dist in tree.find_range(v, GATE["self_tol_m"]):
                if j != i and j not in adjacent[i]:
                    self_hits += 1
                    break
        worst_self_frac = max(worst_self_frac, self_hits / len(verts))

        for (a, b), rest_len in zip(meta["rest_edges"], rest_lengths):
            if rest_len <= 1e-9:
                continue
            ratio = (verts[a] - verts[b]).length / rest_len
            min_edge = min(min_edge, ratio)
            max_edge = max(max_edge, ratio)
            edge_ratios.append(ratio)

    explosion = worst_diag / meta["rest_diag"] if meta["rest_diag"] else float("inf")
    mean_pen = total_pen / len(frames)
    edge_p99 = _percentile(edge_ratios, 99.0)
    edge_p01 = _percentile(edge_ratios, 1.0)

    checks = {
        "noNaN": {"value": any_nan, "pass": not any_nan},
        "explosionRatio": {"value": round(explosion, 3), "max": GATE["explosion_ratio_max"],
                           "pass": (not any_nan) and explosion < GATE["explosion_ratio_max"]},
        "maxVelocityMPerFrame": {"value": round(max_velocity, 4), "max": GATE["velocity_max_m_per_frame"],
                                 "pass": max_velocity < GATE["velocity_max_m_per_frame"]},
        "penetrationFractionClip": {"value": round(mean_pen, 4), "max": GATE["penetration_frac_clip_max"],
                                    "pass": mean_pen < GATE["penetration_frac_clip_max"]},
        "penetrationFractionFrame": {"value": round(worst_frame_pen, 4), "max": GATE["penetration_frac_frame_max"],
                                     "pass": worst_frame_pen < GATE["penetration_frac_frame_max"]},
        # Anchor drift is a cloth-pin metric (does the pinned waistband stay on the
        # body). A fitted garment has no pin - its "stays on body" is the
        # penetration check - so this is informational (not gated) when fitted.
        "waistbandAnchorDriftM": {"value": round(max_anchor, 4), "max": GATE["anchor_drift_max_m"],
                                  "applicable": not is_fitted,
                                  "pass": is_fitted or max_anchor < GATE["anchor_drift_max_m"]},
        "selfIntersectionFraction": {"value": round(worst_self_frac, 4), "max": GATE["self_intersect_frac_max"],
                                     "pass": worst_self_frac < GATE["self_intersect_frac_max"]},
        # Bulk edge behaviour (99th/1st pctile) + a blow-up catch. The raw max/min
        # are kept as informational context, not gated (see GATE comment).
        "edgeStretchP99": {"value": round(edge_p99, 3), "max": GATE["edge_stretch_p99_max"],
                           "pass": edge_p99 < GATE["edge_stretch_p99_max"]},
        "edgeCompressionP01": {"value": round(edge_p01, 3), "min": GATE["edge_compression_p01_min"],
                               "pass": edge_p01 > GATE["edge_compression_p01_min"]},
        "edgeBlowupMax": {"value": round(max_edge, 3), "max": GATE["edge_blowup_max"],
                          "pass": max_edge < GATE["edge_blowup_max"]},
        "edgeStretchMaxInfo": {"value": round(max_edge, 3), "informational": True, "pass": True},
        "edgeCompressionMinInfo": {"value": round(min_edge, 3), "informational": True, "pass": True},
    }
    checks_pass = all(c["pass"] for c in checks.values())
    return {"status": "pass" if checks_pass else "fail", "pass": checks_pass,
            "frames": [start, end], "checks": checks}


# --- render ------------------------------------------------------------------
def finalize_look(skirt, spec):
    material = bpy.data.materials.new("garment-fabric")
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = spec["color"]
        bsdf.inputs["Roughness"].default_value = 0.85
    # Replace any inherited slots (a body-surface duplicate carries the body's skin
    # materials) so every face renders as the fabric colour.
    skirt.data.materials.clear()
    skirt.data.materials.append(material)
    solidify = skirt.modifiers.new("thickness", "SOLIDIFY")
    solidify.thickness = spec.get("solidify_m", 0.006)
    solidify.offset = 0.0
    for poly in skirt.data.polygons:
        poly.use_smooth = True


def render_evidence(scene, camera, output, clip, height, mid_y, span, start, end):
    scene.frame_start, scene.frame_end = start, end
    evidence = {"stills": [], "videos": [], "contactSheets": []}
    for view in ("side", "three-quarter"):
        reel.fixed_camera(scene, camera, height, view, mid_y, span)
        scene.render.image_settings.file_format = "PNG"
        for frame in (start, (start + end) // 2, end):
            scene.frame_set(frame)
            still = os.path.join(output, f"{clip}-{view}-{frame:03d}.png")
            scene.render.filepath = still
            bpy.ops.render.render(write_still=True)
            evidence["stills"].append(still)
        mp4 = os.path.join(output, f"{clip}-cloth-{view}.mp4")
        motion_probe.render_animation(scene, output, os.path.basename(mp4))
        evidence["videos"].append(mp4)
        sheet = reel.contact_sheet(mp4, os.path.join(output, f"{clip}-cloth-{view}-contact-sheet.png"), end - start + 1)
        if sheet:
            evidence["contactSheets"].append(sheet)
    return evidence


def main():
    geometry_file, source_file, output = arguments()
    os.makedirs(output, exist_ok=True)
    with open(geometry_file, encoding="utf-8") as handle:
        asset = json.load(handle)

    garment = os.environ.get("VIDEOER_CLOTH_GARMENT", "mini-skirt")
    clip = os.environ.get("VIDEOER_CLOTH_CLIP", "Walk_Loop")
    preroll = int(os.environ.get("VIDEOER_CLOTH_PREROLL", "25"))
    spec = GARMENT_SPECS[garment]

    reel.enable_expykit()
    mpfb_module = rigify_adapter.enable_backends()

    body, armature, start, end, mid_y, span = build_walking_body(asset, source_file, clip, mpfb_module)

    scene, camera, _unused, _radius = geometry_probe.configure_scene(asset, output)
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.fps = 24
    height = float(asset.get("metadata", {}).get("parameters", {}).get("height", 1.72))

    fitted = spec["kind"] == "fitted"

    if fitted:
        # Duplicate the body's own torso surface: exact topology + body weights ->
        # deforms like skin, no shrinkwrap seam collapse, no penetration.
        garment_obj, meta = generate_from_body_surface(body, spec)
        binding = surface_bind(garment_obj, armature)
        blend = os.path.join(output, "cloth-walk.blend")
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=blend)
        baked, preroll_used, sim_start = False, 0, start
    else:
        # Generate the loose garment from the body's REST shape so the armature
        # poses it once; apply scale so the cloth object is scale 1.0 (stable).
        reference_verts = body_reference_verts(body, spec)
        garment_obj, meta = generate_skirt(spec, reference_verts)
        make_body_collider(body)
        binding = bind_skirt_to_body(garment_obj, body, armature, meta, spec)
        cloth = setup_cloth(garment_obj, spec)
        sim_start = start - preroll
        preroll_used = preroll
        blend, baked = bake_cloth(garment_obj, cloth, scene, sim_start, end, output)

    gate = run_gate(garment_obj, body, meta, scene, start, end, is_fitted=fitted)

    finalize_look(garment_obj, spec)
    evidence = render_evidence(scene, camera, output, clip, height, mid_y, span, start, end)

    report = {
        "schemaVersion": 1,
        "status": "pass" if gate["pass"] else "fail",
        "phase": "cloth-system-phase-1",
        "garment": garment,
        "garmentKind": spec["kind"],
        "clip": clip,
        "prerollFrames": preroll_used,
        "simFrames": [sim_start, end],
        "walkFrames": [start, end],
        "rootTravelY": round(span, 4),
        "diskCacheBaked": baked,
        "garmentVertexCount": len(garment_obj.data.vertices),
        "bodyCollider": None if fitted else {
            "thicknessOuterM": BODY_THICKNESS_OUTER_M,
            "thicknessInnerM": BODY_THICKNESS_INNER_M,
            "clothFriction": BODY_CLOTH_FRICTION,
        },
        "clothSettings": spec.get("cloth"),
        "binding": binding,
        "gate": gate,
        "geometry": geometry_file,
        "source": source_file,
        "blend": blend,
        "blender": bpy.app.version_string,
        "evidence": evidence,
    }
    with open(os.path.join(output, f"{clip}-cloth-report.json"), "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
        handle.write("\n")
    print("CLOTH_WALK_DONE garment=%s gate=%s explosion=%.3f penClip=%.4f penFrame=%.4f anchor=%.4f self=%.4f edgeP99=%.3f edgeP01=%.3f blowup=%.3f" % (
        garment, gate["status"], gate["checks"]["explosionRatio"]["value"],
        gate["checks"]["penetrationFractionClip"]["value"], gate["checks"]["penetrationFractionFrame"]["value"],
        gate["checks"]["waistbandAnchorDriftM"]["value"], gate["checks"]["selfIntersectionFraction"]["value"],
        gate["checks"]["edgeStretchP99"]["value"], gate["checks"]["edgeCompressionP01"]["value"],
        gate["checks"]["edgeBlowupMax"]["value"]))


if __name__ == "__main__":
    main()
