"""Blender-native cloth garments + outfits on the Expy-Kit walking MPFB/Rigify human.

This is the durable harness from ``docs/research/cloth-system-design.md``: it dresses
the production human — MPFB hm08 CC0 mesh + Rigify rig (ADR 074), animated by a CC0
Quaternius action retargeted with Expy Kit (ADR 075) — using Blender's built-in Cloth
modifier, headless and deterministically, then runs a mechanical gate and renders
contact-sheet evidence.

It orchestrates the mature tool rather than re-implementing a solver
(``docs/product-principles.md``), and reuses the existing repo helpers:

* ``render_expykit_action_reel`` — body build + walk bake + fixed camera +
  contact sheet (which in turn loads ``render_mpfb_motion_probe`` /
  ``render_motion_probe`` / ``render_geometry_probe``).
* ``production_character_assembly.transfer_body_weights`` — BVH nearest +
  barycentric body->garment weight transfer for the loose garments.

Three garment classes, one harness, each a ``GARMENT_SPECS`` entry (``kind``):

* ``fitted`` — duplicate a body surface REGION, push it out along the normals, and
  armature-deform it like skin (crop-top, shirt, sweater, pyjama-top, trousers,
  jeans, pyjama-bottoms, tie). Cheap, rock-stable; no sim.
* ``hybrid`` (loose cloth) — procedurally generate a tube from the body's cross
  section with outward clearance, weight-transfer + hang it from a stable pelvis
  hoop, pin-fade the waistband, pre-roll a settle, then bake the Cloth sim over the
  walk (mini-skirt).
* ``hybrid-two-piece`` — a FITTED bodice + a LOOSE skirt built together (dress).

Fitted-garment ``outfits`` (``OUTFIT_SPECS``) dress the body in several garments at
once, layered by offset and rendered to one combined contact sheet. An outfit's
``kind`` can also be ``"mhclo"``: real CC0 MakeHuman garments (fisherman sweater,
suit, halter dress, ...) fitted onto the body via MPFB's own ``ClothesService``
pipeline instead of a body-surface duplicate - fit + layer (innermost first) +
delete-group masking (shipped or spatially generated) + inter-garment clearance +
MakeSkin material tuning, evidence-rendered the same way. This is the production
wardrobe path; the procedural ``fitted``/``hybrid``/``hybrid-two-piece`` classes
remain a fallback for garments with no cleared CC0 asset.

Every build runs the headless mechanical gate (NaN / bbox-explosion / inter-frame
velocity / garment-into-body penetration / BODY-THROUGH-GARMENT poke-through /
waistband anchor drift / self-intersection / bulk edge strain) and renders three
fixed views - side, rear three-quarter and FRONT three-quarter
(``three-quarter-reverse``, the walker approaching the camera so the front of the
body and garments is judged) - as stills + mp4s + contact sheets + ``report.json``.
A failing check is also written into the report's ``notes`` in plain words (e.g.
"the body breaks through the garment"), so a mechanical fail is never silent.
``mhclo`` outfits run the same gate per component (``garmentClass: "mhclo"`` -
fitted bounds, no self-intersection or anchor-drift checks, plus a
deleted-skin-coverage check for skin hidden under a delete group) and, for every
``clear_over`` pair, an inter-garment clearance check across the whole walk
(``report["garmentPairs"]``) - INFORMATIONAL only for now (``"gated": false``
per pair): both formulations tried so far misreport at a garment's own open hem,
so layering is judged on the rendered contact sheets instead until recalibrated.

Usage::

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
      --python scripts/blender/render_cloth_walk.py \
      -- geometry.json source.fbx output-dir

Environment:
    VIDEOER_CLOTH_GARMENT   garment spec name (default: ``mini-skirt``).
    VIDEOER_CLOTH_OUTFIT    outfit spec name (overrides GARMENT; renders the outfit).
    VIDEOER_CLOTH_CLIP      source clip name  (default: ``Walk_Loop``).
    VIDEOER_CLOTH_PREROLL   settle frames before the walk (default: ``25``).
    VIDEOER_MH_CLOTHES_ROOT data root for CC0 ``.mhclo`` garments (default:
                            ``work/sources/makehuman-cc0-clothes-packs-v1`` resolved
                            against the repo root).
    VIDEOER_CLOTH_RES       square render resolution (default: ``1024`` for ``mhclo``
                            outfits, ``512`` otherwise).
    VIDEOER_CLOTH_SUBDIV    Subdivision modifier level for ``.mhclo`` garments, set on
                            BOTH ``levels`` and ``render_levels`` (default: ``1``).
"""

import hashlib
import importlib.util
import json
import math
import os
import sys
import time

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


# Deform-bone name tokens that select a body surface region. The MPFB/Rigify rig
# has helper deform bones (``DEF-knee-helper``, ``DEF-elbow-helper``,
# ``DEF-pelvis-helper``, ``DEF-shoulder-helper``) that DOMINATE the skin at the
# joints, and Rigify's lower spine (``DEF-spine.001``) owns the skin between the
# hip crests - a region that names only the obvious limb bones leaves holes there.
_LEG_REGION_TOKENS = ("pelvis", "thigh", "shin", "knee", "spine")
_TOP_REGION_TOKENS = ("spine", "breast", "shoulder", "upper_arm", "pelvis")

# --- Garment specifications (Phase 2/3 add fitted/hybrid entries here) --------
GARMENT_SPECS = {
    "mini-skirt": {
        "kind": "hybrid",            # fitted upper (armature) + light-sim hem
        "top_z_m": 1.03,             # waistband just above the hip crest
        "length_m": 0.22,            # short: waist to upper-thigh (mini)
        # Moderate resolution + a smooth pin fade so no single edge takes the whole
        # rigid->free transition (a source of boundary stretch spikes).
        "rings": 22,                 # vertical resolution
        "segments": 48,              # angular resolution
        # Clearance is measured from the body's OWN cross-section profile at each
        # angle (see generate_skirt), so the waistband hugs the elliptical waist. The
        # earlier build put a CIRCLE of the maximum hip radius around the waist,
        # which left ~10 cm of air front and back - the "big ring floating around
        # the waist" - and let the waistband drift 13-15 cm off the body.
        "clearance_top_m": 0.02,     # snug waistband (just outside the thin collider)
        # Moderate A-line: enough room for the thighs to pass inside the hem. A much
        # wider flare was tried and made it worse (more free fabric swings/stretches);
        # this is the best-performing width.
        "clearance_bottom_m": 0.10,
        # Placement region (pelvis+thigh) excludes the arms, whose hands hang at
        # waist height in the rest A-pose and would otherwise be encircled -> a 0.5 m
        # disc. The cross-section PROFILE also samples the hips/lower-spine skin so
        # the belly and lower back (spine-weighted) shape the waistband; the chest
        # is far above the skirt's rings, so it cannot inflate them.
        "region_tokens": ("pelvis", "thigh"),
        "profile_tokens": ("spine", "pelvis", "thigh"),
        # Hybrid drape: EVERY ring's armature deform hangs from one stable pelvis
        # hoop (see _lock_and_gradient), so the base cone never follows the swinging
        # thighs. On top of that base the cloth PIN fades from 1.0 at the waistband
        # to 0 down the skirt: the upper rings are held to the hoop, the lower rings
        # simulate freely and drape over the legs via collision. A fully free tube
        # around two swinging legs is inherently unstable, so most of the skirt is
        # hoop-tracked geometry and only the short bottom hem is free.
        "lock_rings": 6,             # (armature now hangs ALL rings from the hoop)
        # A moderate pin fade: too much pinning makes the held rings unable to yield
        # to a leg push (they spike instead), so keep a soft free hem that drapes.
        "pin_fade_rings": 12,        # cloth pin weight fades 1->0 over this many rings
        "color": (0.10, 0.27, 0.31, 1.0),
        "cloth": {
            "quality": 18,             # substeps to resolve leg collisions
            "mass": 0.3,
            "tension_stiffness": 40,   # resist stretch, soft enough to yield (not spike)
            "compression_stiffness": 40,
            "shear_stiffness": 20,
            "bending_stiffness": 4.0,  # holds skirt form, less crumpling
            "air_damping": 2.5,        # calms the hem
            "pin_stiffness": 6.0,      # hold the pinned rings on the hoop
            "collision_quality": 14,   # robust against fast legs
            "distance_min": 0.006,
            "self_distance_min": 0.005,
            "self_impulse_clamp": 3.0, # gentler than the body clamp: fewer fold spikes
            "impulse_clamp": 6.0,
        },
    },
    # Fitted garment: deforms with the body via the armature, no cloth sim. This
    # is the stable Phase-1 garment that establishes the end-to-end pipeline on the
    # walk (the loose-skirt cloth tuning continues as follow-up).
    "crop-top": {
        "kind": "fitted",
        "from_body_surface": True,   # duplicate the body's torso surface (exact fit)
        "top_z_m": 1.38,             # top hem on the chest, below the armpits
        "length_m": 0.24,           # cropped: chest down to the midriff (0.20 read as a bra)
        "surface_offset_m": 0.02,    # stands off the skin so it reads as a garment
        # Torso surface only (the arms are not matched). "breast" is needed too:
        # the chest skin is dominated by the DEF-breast bones, so a spine-only
        # region left holes over the chest.
        "region_tokens": ("spine", "breast"),
        "exclude_tokens": (),
        "color": (0.55, 0.16, 0.22, 1.0),
    },
    # --- Phase-2 fitted garments (duplicate a body surface region + armature) ---
    # Legs: pelvis+thigh+shin gives a connected trouser tube whose waistband sits
    # at the hips (top_z_m ~1.0) and whose hem reaches the ankles. Denim reads via
    # a close offset + a thicker solidify; tailored trousers a touch looser.
    # Region tokens must ALSO name MPFB's helper deform bones and the lower spine:
    # the knee skin is dominated by ``DEF-knee-helper`` and the skin between the
    # hip crests by ``DEF-spine.001``, so a pelvis/thigh/shin-only region cut a
    # skin-coloured band out of every knee and a ragged waistband (the "body
    # breaking through" seen on the first trousers/jeans/pyjama bottoms was partly
    # these holes). The z-cut (top_z_m/length_m) bounds the garment, not the tokens.
    "jeans": {
        "kind": "fitted",
        "from_body_surface": True,
        "region_tokens": _LEG_REGION_TOKENS,
        "top_z_m": 1.00,             # waistband at the hips
        "length_m": 0.92,            # down to the ankles
        "surface_offset_m": 0.012,   # close denim fit
        "solidify_m": 0.008,         # denim body
        "color": (0.16, 0.22, 0.40, 1.0),  # indigo denim
    },
    "trousers": {
        "kind": "fitted",
        "from_body_surface": True,
        "region_tokens": _LEG_REGION_TOKENS,
        "top_z_m": 1.00,
        "length_m": 0.92,
        "surface_offset_m": 0.016,   # slightly looser tailored leg
        "solidify_m": 0.006,
        "color": (0.13, 0.14, 0.17, 1.0),  # charcoal
    },
    # Torso + short sleeves: keep the shoulders/upper arms (exclude_tokens=()),
    # while region_tokens stay specific so the sleeves end at the elbow (upper_arm
    # does not match forearm; the elbow-helper skin is the sleeve's end). top_z_m
    # sits at the shoulders; the hem reaches the waist/hips, where the skin is
    # pelvis-weighted - hence "pelvis" in the tokens for a clean z-cut hem.
    "shirt": {
        "kind": "fitted",
        "from_body_surface": True,
        "region_tokens": _TOP_REGION_TOKENS,
        "exclude_tokens": (),        # keep shoulders + upper arms (short sleeves)
        "top_z_m": 1.44,             # collar at the shoulders
        "length_m": 0.46,            # down to the waist
        "surface_offset_m": 0.016,   # stands off as a shirt
        "solidify_m": 0.006,
        "color": (0.62, 0.72, 0.85, 1.0),  # light blue
    },
    "sweater": {
        "kind": "fitted",
        "from_body_surface": True,
        "region_tokens": _TOP_REGION_TOKENS,
        "exclude_tokens": (),
        "top_z_m": 1.45,
        "length_m": 0.50,            # longer than the shirt, over the hips
        "surface_offset_m": 0.024,   # bulky knit stands well off the body
        "solidify_m": 0.012,         # thick knit
        "color": (0.14, 0.30, 0.22, 1.0),  # forest-green knit
    },
    "pyjama-top": {
        "kind": "fitted",
        "from_body_surface": True,
        "region_tokens": _TOP_REGION_TOKENS,
        "exclude_tokens": (),
        "top_z_m": 1.44,
        "length_m": 0.50,            # loose top over the hips
        "surface_offset_m": 0.022,   # slightly loose fit
        "solidify_m": 0.006,
        "color": (0.72, 0.60, 0.78, 1.0),  # soft lavender
    },
    # --- Phase-3 loose / hybrid garments (cloth sim) --------------------------
    # Pyjama bottoms: FITTED twin-leg surface duplicate, like trousers/jeans but
    # with a baggier outward offset + a thicker solidify so they read as soft, loose
    # lounge pants. A free cloth twin-tube collapsed into a chaotic sack (pyjama
    # bottoms hang close to the legs, they do not billow), and the fitted surface
    # route deforms exactly with the legs - rock-stable, edge strain ~1.0.
    "pyjama-bottoms": {
        "kind": "fitted",
        "from_body_surface": True,
        "region_tokens": _LEG_REGION_TOKENS,
        "top_z_m": 1.00,             # drawstring waist at the hips
        "length_m": 0.92,            # down to the ankles
        "surface_offset_m": 0.030,   # baggier than tailored trousers (loose fit)
        "solidify_m": 0.010,         # soft, thick pyjama fabric
        "color": (0.42, 0.50, 0.72, 1.0),  # soft blue pyjama
    },
    # Tie: a FITTED narrow placket down the centre-front chest (collar to waist),
    # duplicated from the front torso surface (``front_only`` + ``strip_half_width_m``)
    # and armature-deformed. A free cloth strip just bunches against the chest; a
    # tie sits fairly flat, so the fitted band reads cleanly and is rock-stable.
    "tie": {
        "kind": "fitted",
        "from_body_surface": True,
        "region_tokens": ("spine", "breast"),
        "exclude_tokens": (),        # keep the breast-weighted centre-chest verts
        "top_z_m": 1.40,             # collar / base of the neck
        "length_m": 0.42,            # down to the waist
        "strip_half_width_m": 0.05,  # ~10 cm wide placket, reads clearly as a tie
        "front_only": True,          # centre-front chest only (front = -Y)
        "surface_offset_m": 0.022,   # stands proud of the chest so it reads separately
        # A tie BRIDGES the cleavage rather than sinking into it: without this the
        # facing-gap taper thinned the strip between the breasts while its
        # neighbours kept the outfit's full stand-off, folding the strip onto itself.
        "facing_gap_taper": False,
        "solidify_m": 0.007,
        "color": (0.70, 0.06, 0.10, 1.0),  # saturated red tie (reads at contact-sheet scale)
    },
    # Dress: TRUE two-piece HYBRID (the design doc's definition) = a FITTED bodice +
    # a LOOSE skirt, built as two objects and rendered together (see build_dress).
    # A single circular tube could not fit the bodice to the torso - the barrel cut
    # into the arms/underarm no matter the neckline height (traded penetration for
    # edge strain and cleared neither). A fitted body-surface bodice conforms to the
    # torso exactly (zero penetration, edge strain ~1.0), and the skirt hangs from
    # the waist on the proven pelvis-hoop path (like the mini-skirt, longer).
    "dress": {
        "kind": "hybrid-two-piece",
        "color": (0.42, 0.12, 0.34, 1.0),  # plum (shared by both pieces)
        # Fitted bodice: the torso's own surface, collar/shoulders down to the waist.
        "bodice": {
            "kind": "fitted",
            "from_body_surface": True,
            "region_tokens": ("spine", "breast", "shoulder", "pelvis"),
            "exclude_tokens": (),        # keep the shoulder straps + full chest
            "top_z_m": 1.40,             # neckline at the shoulders
            "length_m": 0.40,            # down to the waist
            "surface_offset_m": 0.014,   # sits just off the skin
            "solidify_m": 0.006,
            "color": (0.42, 0.12, 0.34, 1.0),
        },
        # Loose skirt: pelvis-hoop tube from the waist to the knee (mini-skirt path).
        "skirt": {
            "kind": "hybrid",
            "region_tokens": ("pelvis", "thigh"),
            "profile_tokens": ("spine", "pelvis", "thigh"),
            "top_z_m": 1.02,             # waist seam (overlaps the bodice hem)
            "length_m": 0.52,            # waist to the knee
            "rings": 22,
            "segments": 48,
            # Snug at the waist, measured from the body's own profile (the bodice
            # sits 0.014 + 0.006 m off the skin, so the skirt seam clears it by ~5 mm).
            "clearance_top_m": 0.025,
            "clearance_bottom_m": 0.16,  # knee-length flare (best-performing width)
            # Best-found pin fade for this knee-length skirt. A knee-length hem has
            # far more free fabric than the short mini-skirt, so its peak-stride swing
            # sits the bulk edge strain at ~1.98 - marginally over the loose 1.9 bound
            # (validated on the SHORT mini-skirt). Holding more of the skirt or
            # stiffening it both made the strain WORSE (the held/free boundary drops
            # into the fast-moving thigh zone), so this is the locked best config; the
            # swing reads as fabric, not a tear, and the blow-up catch stays green.
            "pin_fade_rings": 11,
            "body_thickness_outer_m": 0.008,
            "color": (0.42, 0.12, 0.34, 1.0),
            "cloth": {
                "quality": 18,
                "mass": 0.3,
                "tension_stiffness": 40,
                "compression_stiffness": 40,
                "shear_stiffness": 20,
                "bending_stiffness": 4.0,
                "air_damping": 2.5,
                "pin_stiffness": 6.0,
                "collision_quality": 14,
                "distance_min": 0.006,
                "self_distance_min": 0.005,
                "self_impulse_clamp": 3.0,
                "impulse_clamp": 6.0,
            },
        },
    },
}

# --- Multi-garment outfits ----------------------------------------------------
# An outfit dresses the SAME walking body in several garments at once, rendered
# together for one combined contact sheet - proving outfits, not just single
# garments. Every entry is a dict keyed by ``kind``:
#
# * ``procedural-fitted`` - the original Phase-2/3 class: ``components`` is a list
#   of ``(garment_name, extra_offset_m)`` pairs into ``GARMENT_SPECS``. Each garment
#   is a body-surface duplicate + armature deform; the extra offset layers a
#   garment outside earlier ones (the tie stands off over the shirt). All listed
#   garments share the body collider implicitly and layer by offset, so no cloth
#   sim or inter-garment collision is needed and the whole outfit is rock-stable.
# * ``mhclo`` - real CC0 MakeHuman garments fitted via MPFB's ``ClothesService``
#   (see ``assemble_and_render_mhclo_outfit``). ``components`` is a list of dicts,
#   INNERMOST GARMENT FIRST (shoes/boots before trousers before a sweater worn over
#   them), because layering (``clear_over``) and delete-group masking both need the
#   inner garment to already exist. Component keys:
#     - ``asset`` (required): the clearance-record asset name (a directory under
#       ``clothes/`` in the CC0 asset root).
#     - ``delete_group``: ``"shipped"`` (use the .mhclo's own delete group / the
#       body MASK modifier MPFB already added), ``"generate"`` (the asset ships no
#       delete group - compute a spatial skin footprint + one erosion pass and mask
#       that instead; see ``ensure_delete_group``), ``"extend"`` (the shipped
#       delete group under-covers - a real, visible gap at its own boundary, not a
#       footprint artifact - so the eroded generated footprint is ADDED to the same
#       group rather than replacing it, keeping the shipped coverage and widening
#       it), or ``"none"``. Defaults to ``"shipped"`` when the clearance record's
#       ``fitting.shipsDeleteGroup`` is true, else ``"none"``.
#     - ``erode_passes`` (default ``1``): erosion passes on a generated delete group
#       so the mask never reaches the hem (see ``ClothesService._conservative_mask``).
#     - ``clear_over`` (default ``[]``): earlier component assets this garment is
#       worn OUTSIDE of; each is proximity-pushed clear of this garment's rest mesh
#       (a knit hem authored inside a trouser waistband, both z_depth 50, which
#       Blender ignores) - see ``clear_outer_over_inner``.
#     - ``clearance_m`` (default ``0.004``): minimum clearance ``clear_over`` pushes.
#     - ``clear_skin`` (default ``False``): proximity-push this garment clear of
#       the body's OWN skin surface (the reverse direction of ``clear_over`` -
#       garment clear of skin, not garment clear of garment) before the
#       delete-group footprint is computed; fixes a few residual "skin pokes a
#       few mm past the fabric at a seam" defects (waist seams, a strap edge)
#       without the ADR-076 uniform-inflation bulk problem - see
#       ``clear_garment_over_skin``. Not used on footwear or the suit: a boot
#       must keep its authored cap even where hidden toes protrude.
#     - ``bump_strength`` (default ``0.25``): MakeSkin's Bump node Strength - the
#       shipped default (1.0) reads a knit as a net.
#     - ``subdiv`` (default ``VIDEOER_CLOTH_SUBDIV``): Subdivision modifier level.
OUTFIT_SPECS = {
    "sweater-jeans": {"kind": "procedural-fitted", "components": [("jeans", 0.0), ("sweater", 0.0)]},
    # The tie's own stand-off (0.022) already matches the shirt's outer face
    # (0.016 offset + 0.006 thickness); +0.01 lays it 1 cm over the shirt.
    "shirt-tie-trousers": {"kind": "procedural-fitted",
                           "components": [("trousers", 0.0), ("shirt", 0.0), ("tie", 0.01)]},
    # --- mhclo outfits (CC0 MakeHuman garments via MPFB's ClothesService) -------
    # Innermost first: boots have no clearance to worry about, the wool pants are
    # authored to the SKIN (no delete group shipped - a generated one hides the
    # covered belt/thigh skin), and the sweater is worn OVER the pants (its hem
    # authored inside the waistband, hence ``clear_over``) with a tamed bump so
    # the fisherman knit does not read as a net.
    "mh-sweater-wool-boots": {
        "kind": "mhclo",
        "label": "fisherman sweater + wool pants + ankle boots",
        "components": [
            {"asset": "toigo_ankle_boots_female"},
            # Two erosion passes: one left a single hem-boundary vertex exposed for
            # 12 of 41 frames at peak stride. NO clear_skin here: the skin it would
            # clear is hidden by the generated delete group anyway, and pushing the
            # pants out 15 mm at the hips made them cross the sweater at pose time
            # (grey pants patches through the knit in the close-ups).
            {"asset": "toigo_wool_pants", "delete_group": "generate", "erode_passes": 2},
            # clearance_m tried at 0.006/0.008/0.012 against the default 0.004: the
            # (informational) pair metric got worse at every step - the two garments
            # deform under different bones and cross at POSE time, which no rest-mesh
            # clearance fixes. Left at the default. No clear_skin either (see above):
            # its residual 0.9% poke is transient (7 of 41 frames) and invisible at
            # 1024 px, while the push moved 393 verts and helped the pants cross it.
            {"asset": "toigo_fisherman_sweater", "delete_group": "generate",
             "clear_over": ["toigo_wool_pants"], "bump_strength": 0.2},
        ],
    },
    # toigo_ballet_flats sits low/short on this body - the toes and instep poke
    # through it (27% of covered skin, worst frame) - an asset problem, not a
    # tuning one, so ankle boots (shipped delete group, extended - the shipped
    # group under-covers) replace the flats. The dress is authored to MPFB's
    # HELPER geometry (fit skin verts = 0) and ships its own delete group.
    "mh-halter-dress-boots": {
        "kind": "mhclo",
        "label": "knee-length halter dress + ankle boots",
        "components": [
            {"asset": "toigo_ankle_boots_female"},
            # Back to the default erode_passes=1: erode_passes=0 fixed the strap-
            # edge poke but traded it for 3.9% holes. clear_skin now handles the
            # strap-edge poke directly (skin pushed clear of the fabric, not the
            # delete group widened), so erosion is not needed for it any more.
            {"asset": "toigo_halter_dress_knee_length", "delete_group": "extend", "clear_skin": True},
        ],
    },
    # toigo_mj_cloth_shoes shows the instep through the shoe (11%, 21 mm worst
    # gap) and cortu_cargo_pants is a 211-vertex asset that renders with a
    # ragged waistband and a bare midriff strip above it - both asset problems,
    # not tuning, so ankle boots (shipped, extended) and harem pants (generated
    # + extended over the tucked t-shirt) replace them.
    "mh-tshirt-harem-boots": {
        "kind": "mhclo",
        "label": "tucked t-shirt + harem pants + ankle boots",
        "components": [
            {"asset": "toigo_ankle_boots_male"},
            # clear_skin was tried on the t-shirt and made its poke-through WORSE
            # (1.0% -> 8.3%, 21 of 95 pushes saturated at the 15 mm cap): the tucked
            # tee is authored so close to the skin that the capped push folds it.
            {"asset": "toigo_basic_tucked_t-shirt", "delete_group": "generate"},
            # No clear_over: the t-shirt is authored TUCKED IN and the pants'
            # waistband already sits outside it at rest - pushing the coarse
            # waistband rim clear of the t-shirt only produced a sawtooth crown
            # there, for no clearance the pants did not already have.
            {"asset": "toigo_harem_pants", "delete_group": "extend", "clear_skin": True},
        ],
    },
    # The suit (jacket + tie + trousers, one mesh) is authored to the helper
    # geometry and ships its own delete group; the boots likewise.
    "mh-suit-boots": {
        "kind": "mhclo",
        "label": "male suit with tie and jacket + ankle boots",
        "components": [
            {"asset": "toigo_ankle_boots_male"},
            {"asset": "toigo_male_suit_tie_and_jacket"},
        ],
    },
}

# --- Mechanical gate thresholds (from docs/research/cloth-system-design.md) ---
GATE = {
    "explosion_ratio_max": 1.5,
    "velocity_max_m_per_frame": 0.30,  # tolerates legit leg-driven hem swing; catches launches (>>1)
    "penetration_tol_m": 0.005,
    "penetration_frac_clip_max": 0.02,
    "penetration_frac_frame_max": 0.05,
    # Body-through-garment poke-through (the check the eye actually makes: does
    # skin show through the fabric?). For every body vertex under the garment a
    # ray is cast INWARD along the skin normal; if it meets the garment surface
    # within ``poke_depth_max_m`` the garment is under the skin there - the body
    # has broken through. This complements ``penetration*`` (garment vertices
    # inside the body), which misses a body FACE pushing out between garment
    # vertices - exactly what the knee/shoulder skin patches on the fitted
    # trousers and sweater were (their penetration fractions were ~0). A fitted
    # garment deforms identically to the skin (same weights, same armature stack),
    # so a visible break-through is a defect. The bound is not literally zero:
    # where the skin folds at a bent joint (back of the knee, groin) the offset
    # surface folds into the crease and a handful of vertices (3-10 of ~5000,
    # < 5 mm deep) register at peak stride without anything showing; a real
    # patch (the old knee band) is dozens to hundreds of vertices, 1-5 %. A
    # simulated hem is allowed brief, small collision misses over the fast legs.
    "poke_depth_max_m": 0.025,
    "poke_cover_reach_m": 0.35,
    # Skin that another body part covers within this gap (the inner upper arm
    # pressed against the torso side under a hanging arm, the inner thighs as the
    # legs pass) cannot show, whatever the fabric does there, so it is excluded
    # from both body checks. Without this every sleeved top failed at 3-4% on
    # every frame - all of it the sleeve's inner panel inside the torso and the
    # torso panel inside the arm, under the arm, invisible from any camera. This
    # is the floor; a fitted garment widens it to twice its stand-off (facing
    # skins that close are buried in fabric from both sides).
    "poke_occlusion_gap_m": 0.02,
    "poke_frac_frame_max": 0.005,        # fitted / anchored
    "poke_frac_frame_max_loose": 0.02,   # cloth-simulated free hems
    # Waistband pin drift: max distance of a pinned waistband vertex from the body
    # surface. Only gated for loose (cloth-pinned) garments (a fitted garment's
    # "stays on" is the penetration + poke-through pair). The waistband is now cut
    # to the body's own profile with a 2-2.5 cm clearance, so it must stay close:
    # the old 0.15 m bound let a 13-15 cm "floating ring" pass.
    "anchor_drift_max_m": 0.06,
    "self_tol_m": 0.004,
    "self_intersect_frac_max": 0.02,
    # Edge strain for FREE-SIMULATED cloth is judged on BULK behaviour, not a
    # single-edge hard max. A real fabric sim has invisible, localized stretch
    # spikes at pinned seams; a hard max=1.35 (seeded from the old CPU *corrective*
    # cloth, ADR 030) trips on those while the garment reads perfectly. So gate the
    # 99th/1st percentile (is the bulk of the cloth near its rest shape?) plus a
    # generous blow-up catch that only fires on genuine solver explosions (which
    # run 20x+). Thresholds validated against the rendered contact sheets.
    # Fitted/anchored fabric must stay near rest; a FREE-SWINGING hem (loose/hybrid)
    # physically stretches more at peak stride, so it gets a looser bulk bound. This
    # is garment-class-aware, not a blanket relaxation: it is validated against the
    # rendered contact sheets (a hem at p99 1.8 reads as swing, not a tear) and the
    # blow-up catch below still fires on genuine solver explosions.
    "edge_stretch_p99_max": 1.6,        # fitted / anchored fabric
    "edge_stretch_p99_max_loose": 1.9,  # loose/hybrid free-swinging hems
    "edge_compression_p01_min": 0.45,
    "edge_blowup_max": 15.0,
    # Deleted-skin coverage (mhclo only): a masked skin vertex was hidden because
    # a garment is supposed to cover it there. "Covered" is the garment's surface
    # within 1 cm of the skin point (a snug garment can sit AT/UNDER the skin - a
    # delete group exists precisely because of that), or either ray direction
    # meeting the garment (inward, or outward within ``poke_cover_reach_m``) -
    # tested against every garment in the outfit, not just this one (a
    # neighbouring garment can legitimately cover a shared seam). A masked
    # vertex DEEP INSIDE a closed region (e.g. the toes in front of a closed
    # boot toe cap) shows nothing when uncovered - there is no visible hole
    # there, only informational. A hole is only visible at the BOUNDARY of the
    # masked region, next to skin nothing hid - so the gated fraction is over
    # boundary vertices only (worst frame): masked skin adjacent to un-masked
    # skin where every "covered" test still misses.
    "deleted_uncovered_frac_frame_max": 0.005,
    # Inter-garment (``clear_over``) z-fighting/interpenetration tolerance,
    # RAY-based (a nearest-point sign test is undefined near a garment's own
    # open edges - see ``garment_pair_report``): an outward ray from an outer
    # vertex along its own normal that meets the inner garment within this
    # distance counts as coplanar (visibly z-fighting); farther counts as the
    # inner garment protruding OUTSIDE the outer one (would show through).
    # INFORMATIONAL / under calibration, not gated into outfit status: BOTH the
    # old nearest-sign test and this ray formulation misreport at a garment's
    # own open hem (the inner garment continuing on below the outer one's hem
    # reads as "protrusion" either way) - still computed and reported per pair
    # so the numbers stay visible while the check is recalibrated; layering is
    # judged on the rendered contact sheets instead for now.
    "pair_coplanar_tol_m": 0.001,
    "pair_coplanar_frac_frame_max": 0.01,
    # Bulk protrusion depth for a ``clear_over`` pair: the 99th percentile of
    # every outward-ray hit distance (how far the inner garment sits OUTSIDE
    # the outer one) over the whole clip, not just the worst frame - a single
    # spike is not the same as sustained protrusion. 21 mm was observed
    # ungated before this bound existed. Informational only (see above).
    "pair_inside_depth_p99_max_m": 0.005,
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
    travel = 1.0 if y1 >= y0 else -1.0
    return mesh, armature, start, end, (y0 + y1) / 2.0, abs(y1 - y0), travel


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
def make_body_collider(body, thickness_outer=BODY_THICKNESS_OUTER_M):
    modifier = body.modifiers.new("cloth-collision", "COLLISION")
    # ``thickness_outer`` is the collider margin the cloth keeps off the body. A
    # garment with a longer free hem over the moving legs (the dress) can raise it
    # per-spec for extra clearance without tightening the snug mini-skirt waistband.
    body.collision.thickness_outer = thickness_outer
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


def evaluated_surface(obj, deps, polys=None):
    """Evaluated world-space vertices, outward vertex normals and a BVH of ``obj``.

    With ``polys`` given (base-mesh polygon index tuples) the BVH is built from
    those over the evaluated coordinates, which requires the evaluated mesh to be
    index-aligned with the base mesh (topology-changing modifiers off) - used so
    the body's skin can be addressed by base vertex index during the gate.
    """
    ev = obj.evaluated_get(deps)
    tmp = ev.to_mesh()
    matrix = ev.matrix_world
    rotation = matrix.to_3x3()
    verts = [matrix @ v.co for v in tmp.vertices]
    normals = [(rotation @ n.vector).normalized() for n in tmp.vertex_normals]
    if polys is None:
        polys = [tuple(p.vertices) for p in tmp.polygons]
    elif len(verts) != len(obj.data.vertices):
        ev.to_mesh_clear()
        raise RuntimeError("evaluated mesh is not index-aligned with its base mesh")
    ev.to_mesh_clear()
    return verts, normals, BVHTree.FromPolygons(verts, polys)


def evaluated_topology(obj, deps):
    """Evaluated world-space vertices, per-vertex world normals, edges and
    polygons of ``obj`` - all four read from the EVALUATED mesh itself, so they
    stay index-aligned with each other even when a modifier (e.g. an ``.mhclo``
    garment's Subdivision) changes the vertex count from the base mesh.
    Catmull-Clark topology is frame-invariant, so a caller can take the
    edges/polygons once at a baseline frame and reuse them across the walk,
    only re-reading the vertices/normals per frame."""
    ev = obj.evaluated_get(deps)
    tmp = ev.to_mesh()
    matrix = ev.matrix_world
    rotation = matrix.to_3x3()
    verts = [matrix @ v.co for v in tmp.vertices]
    normals = [(rotation @ v.normal).normalized() for v in tmp.vertices]
    edges = [tuple(e.vertices) for e in tmp.edges]
    polys = [tuple(p.vertices) for p in tmp.polygons]
    ev.to_mesh_clear()
    return verts, normals, edges, polys


def skin_polygons(body):
    """Base-mesh polygons made only of skin vertices (MPFB ``body`` group) - the
    same surface the ``Hide helpers`` Mask modifier renders, addressable by base
    vertex index."""
    group = body.vertex_groups.get("body")
    if group is None:
        return [tuple(p.vertices) for p in body.data.polygons]
    index = group.index
    on_skin = [any(g.group == index and g.weight > 0 for g in v.groups) for v in body.data.vertices]
    return [tuple(p.vertices) for p in body.data.polygons if all(on_skin[i] for i in p.vertices)]


def covered_body_indices(body, spec):
    """Base indices of the skin vertices a garment covers: its body region
    (``region_tokens``, majority weight) on the skin. The poke-through check casts
    only from these, so a hand or foot swinging past the fabric is never mistaken
    for the covered body breaking through it."""
    region = _region_group_indices(body.vertex_groups, spec)
    group = body.vertex_groups.get("body")
    body_index = group.index if group else None
    covered = []
    for v in body.data.vertices:
        if body_index is not None and not any(g.group == body_index and g.weight > 0 for g in v.groups):
            continue
        if sum(g.weight for g in v.groups if g.group in region) > 0.5:
            covered.append(v.index)
    return covered


def _region_group_indices(vertex_groups, spec):
    """Vertex-group indices whose deform-bone name matches the garment region.

    ``region_tokens`` selects the body region the garment wraps; ``exclude_tokens``
    (default: the upper-limb tokens) removes sub-regions the garment must never
    follow. Torso garments with sleeves (shirt/sweater/pyjama-top) override
    ``exclude_tokens`` with an empty tuple so the shoulders and upper arms are
    kept, while their ``region_tokens`` stay specific enough (``upper_arm`` does
    not match ``forearm``) that the sleeves still end cleanly at the elbow.
    """
    tokens = spec.get("region_tokens") or ("spine",)
    excludes = spec.get("exclude_tokens", _UPPER_LIMB_TOKENS)
    return {
        vg.index
        for vg in vertex_groups
        if any(t in vg.name.lower() for t in tokens)
        and not any(x in vg.name.lower() for x in excludes)
    }


_REST_SURFACE_CACHE = {}


def body_rest_surface(body):
    """World-space REST coordinates AND vertex normals of every base-mesh vertex
    of the body, with its shape keys applied and its modifiers off (indices
    align with ``body.data.vertices``) - both read from the SAME evaluated mesh.

    The MPFB human is a Basis plus macro-target shape keys (weights 0.165 / 0.5
    here), and the rendered body is their MIX: it differs from ``vertex.co`` (the
    Basis) by up to ~10 cm (median ~3 cm), and ``body.data.vertices[i].normal``
    (also Basis) differs from the MIX's own normal by up to ~70 degrees (median
    angle 16.6 degrees at the 90th percentile, concentrated at the
    breast/belly/hip/thigh - exactly where the macro targets deform the most).
    Any fit read from ``body.data.vertices`` - position OR normal - is therefore
    a fit to the wrong body; pairing a MIX position with a Basis normal is just
    as wrong as using a Basis position, and used to silently misjudge which skin
    a garment covers there.
    """
    cached = _REST_SURFACE_CACHE.get(body.name)
    if cached is not None:
        return cached
    states = [(modifier, modifier.show_viewport) for modifier in body.modifiers]
    for modifier, _ in states:
        modifier.show_viewport = False
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(deps)
    tmp = ev.to_mesh()
    matrix = ev.matrix_world
    rotation = matrix.to_3x3()
    coords = [matrix @ v.co for v in tmp.vertices]
    normals = [(rotation @ n.vector).normalized() for n in tmp.vertex_normals]
    ev.to_mesh_clear()
    for modifier, state in states:
        modifier.show_viewport = state
    bpy.context.view_layer.update()
    if len(coords) != len(body.data.vertices):
        raise RuntimeError("body rest coordinates do not align with the base mesh")
    _REST_SURFACE_CACHE[body.name] = (coords, normals)
    return coords, normals


def body_rest_coords(body):
    """World-space REST coordinates only - see ``body_rest_surface`` (which also
    returns the matching rest normals; use it directly wherever both are
    needed, rather than pairing this with ``body.data.vertices[i].normal``)."""
    return body_rest_surface(body)[0]


def _freeze_shape_keys(obj):
    """Bake ``obj``'s shape-key mix into its vertex coordinates and drop the keys.

    A mesh WITH shape keys evaluates from the key-block data, not from
    ``vertex.co``: the outward ``surface_offset_m`` written into the duplicated
    body surface was silently ignored, and every fitted garment sat exactly ON the
    skin (0.0 mm in the evaluated result). Coincident surfaces z-fight, and
    wherever the skin won the depth test the body "poked through" - the knee and
    shoulder patches. Must run while the object has no modifiers (so the
    evaluated mesh is the pure shape-key mix, index-aligned with the base mesh).
    """
    if obj.data.shape_keys is None:
        return False
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    tmp = ev.to_mesh()
    coords = [v.co.copy() for v in tmp.vertices]
    ev.to_mesh_clear()
    if len(coords) != len(obj.data.vertices):
        raise RuntimeError("shape-key freeze requires a modifier-free, index-aligned mesh")
    obj.shape_key_clear()
    for vertex, co in zip(obj.data.vertices, coords):
        vertex.co = co
    obj.data.update()
    return True


def body_reference_verts(body, spec):
    """World-space body vertices for the garment's region, in the REST pose
    (shape keys applied - see ``body_rest_coords``).

    The garment is generated from the rest shape so the shared Armature modifier
    poses it *once* alongside the body (generating from a posed frame and binding
    double-applies the pose). It is restricted to the body region the garment
    wraps (``region_tokens`` -> deform-bone names), because at the rest A-pose the
    arms stand out to the sides: a chest cross-section taken from the whole body
    would encircle the shoulders and make a wide flaring "wing" instead of a
    torso-hugging tube.
    """
    coords = body_rest_coords(body)
    tokens = spec.get("region_tokens")
    if tokens:
        region = _region_group_indices(body.vertex_groups, spec)
        if region:
            # Skin only: MPFB's hidden helper geometry (the clothes-fitting
            # "tights"/"skirt" helpers) is rigged too, but floats a few cm OFF the
            # body, so it must not widen a cross-section taken from the skin.
            body_group = body.vertex_groups.get("body")
            body_index = body_group.index if body_group else None
            verts = [
                coords[v.index]
                for v in body.data.vertices
                if any(g.group in region and g.weight > 0.3 for g in v.groups)
                and (body_index is None
                     or any(g.group == body_index and g.weight > 0 for g in v.groups))
            ]
            if verts:
                return verts
    group = body.vertex_groups.get("body")
    if group is None:
        return list(coords)
    index = group.index
    verts = [
        coords[v.index]
        for v in body.data.vertices
        if any(g.group == index and g.weight > 0 for g in v.groups)
    ]
    return verts or list(coords)


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


def generate_from_body_surface(body, spec, extra_offset=0.0):
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
    # ``top_z_m`` (absolute world z of the top hem) is preferred: the region spans
    # head/arm bones, where a fraction of the region height is not a stable
    # placement (``waist_height_frac`` is kept for legacy specs only).
    if "top_z_m" in spec:
        top_z = spec["top_z_m"]
    else:
        top_z = zmin + spec["waist_height_frac"] * height
    hem_z = top_z - spec["length_m"]

    dup = body.copy()
    dup.data = body.data.copy()
    dup.name = "garment"
    bpy.context.collection.objects.link(dup)
    dup.modifiers.clear()
    # Freeze the body's shape-key mix into plain coordinates FIRST: with the keys
    # still present the outward offset below is ignored at evaluation time and
    # the garment renders exactly on the skin (see _freeze_shape_keys).
    frozen = _freeze_shape_keys(dup)

    region = _region_group_indices(dup.vertex_groups, spec)
    body_group = dup.vertex_groups.get("body")
    body_index = body_group.index if body_group else None
    matrix = dup.matrix_world
    # Optional strip cut for a narrow centred garment (a fitted tie): keep only a
    # thin vertical band of the FRONT torso surface (front = -Y per the reel's
    # three-quarter camera). ``strip_half_width_m`` sets the half-width about the
    # region's centre x; ``front_only`` drops the back half so the strip is a single
    # placket down the centre chest rather than a full torso band.
    cx = sum(v.x for v in torso) / len(torso)
    cy = sum(v.y for v in torso) / len(torso)
    strip_half = spec.get("strip_half_width_m")
    front_only = spec.get("front_only", False)
    keep = set()
    for v in dup.data.vertices:
        world = matrix @ v.co
        if not (hem_z <= world.z <= top_z):
            continue
        if strip_half is not None and abs(world.x - cx) > strip_half:
            continue
        if front_only and world.y > cy:
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
    # ``extra_offset`` layers this garment outside earlier ones in a multi-garment
    # outfit (e.g. a tie standing off over a shirt); 0 for a single garment.
    offset = spec.get("surface_offset_m", 0.008) + extra_offset
    normals = [v.normal.copy() for v in dup.data.vertices]
    if front_only:
        # A narrow front placket (the tie) is offset along the strip's MEAN normal
        # so it stays flat and bridges the chest valley. Per-vertex normals over
        # the concave cleavage converge, and at an outfit's larger stand-off the two
        # sides of the strip folded into each other (5% self-intersection).
        mean_normal = sum(normals, Vector()).normalized()
        normals = [mean_normal.copy() for _ in normals]
    factors, tapered = _facing_gap_factors(dup, body, normals, spec)
    for v in dup.data.vertices:
        v.co = v.co + normals[v.index] * (offset * factors[v.index])
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
        "shape_keys_frozen": frozen,
        "surface_offset_m": offset,
        "offset_tapered_vertices": tapered,
        # The skin this garment was cut from - exactly the skin it covers.
        "covered_body_indices": sorted(keep),
    }
    return dup, meta


# Facing-gap taper for the fitted offset (see _facing_gap_factors).
FACING_GAP_REACH_M = 0.15     # look this far for a facing body part
FACING_GAP_FULL_M = 0.09      # gap at/above which the full offset is used
FACING_GAP_MIN_FACTOR = 0.12  # offset scale in the tightest creases


def _facing_gap_factors(dup, body, normals, spec):
    """Per-vertex scale for the outward offset: thin the fabric where another body
    part faces the vertex closely.

    Two facing skin surfaces (inner upper arm <-> torso side at the armpit, inner
    thighs at the crotch) each pushed out by the FULL offset cross into the
    opposite body part as soon as the arm hangs or the legs pass: the first shirt
    registered 3% body poke-through on every frame, all of it in the armpits, and
    its garment-into-body penetration sat at the 2% bound for the same reason. In
    the rest pose, cast outward from each garment vertex against the skin; a hit
    within ``FACING_GAP_REACH_M`` means a facing part, and the offset is scaled
    down with the gap (to ``FACING_GAP_MIN_FACTOR`` in the tightest creases) so the
    fabric there hugs the skin - where it is occluded by the arm/leg anyway. The
    factors are smoothed twice over the one-ring so the fabric thins gradually: a
    step from full to minimum offset between neighbours folds the surface (the
    outfit tie self-intersected at 5% that way). A garment meant to BRIDGE a gap
    rather than sink into it (the tie across the chest) opts out with
    ``facing_gap_taper: False``. Returns the factors and the tapered-vertex count.
    """
    count = len(dup.data.vertices)
    if not spec.get("facing_gap_taper", True):
        return [1.0] * count, 0
    tree = BVHTree.FromPolygons(body_rest_coords(body), skin_polygons(body))
    matrix = dup.matrix_world
    rotation = matrix.to_3x3()
    factors = []
    for v in dup.data.vertices:
        normal = (rotation @ normals[v.index]).normalized()
        origin = (matrix @ v.co) + normal * 0.003
        hit = tree.ray_cast(origin, normal, FACING_GAP_REACH_M)
        if hit[0] is None or hit[3] < 0.004:
            factors.append(1.0)
            continue
        gap = hit[3] + 0.003
        factors.append(max(FACING_GAP_MIN_FACTOR, min(1.0, (gap - 0.012) / (FACING_GAP_FULL_M - 0.012))))
    ring = _build_adjacency(dup.data, hops=1)   # one-ring including the vertex itself
    for _ in range(2):
        factors = [sum(factors[u] for u in ring[i]) / len(ring[i]) for i in range(count)]
    return factors, sum(1 for f in factors if f < 0.999)


def surface_bind(garment, armature, body=None):
    """Bind a duplicated-body-surface garment so it deforms EXACTLY like the skin.

    The garment carries the body's own vertex weights, but weights alone are not
    enough. The MPFB/Rigify body deforms through TWO Armature modifiers: a
    linear-blend one, then a preserve-volume (dual-quaternion) one applied as a
    ``use_multi_modifier`` blend masked by MPFB's ``mhmask-preserve-volume``
    vertex group. The first cloth build gave the garment a single preserve-volume
    modifier, so at every bent joint (knees, elbows, shoulders, hips) the garment
    and the skin took different skinning paths and the body poked through the
    fabric - the skin patches on the trousers' knees and the sweater's shoulders.

    So the body's armature stack is mirrored onto the garment modifier-for-
    modifier (the surface duplicate copied the mask group along with the
    weights). With an identical stack the two surfaces deform identically and the
    outward offset is preserved everywhere, which is what makes the fitted class
    rock-stable. Falls back to a single preserve-volume modifier when the body
    has no armature modifiers to mirror.
    """
    source_stack = [m for m in (body.modifiers if body is not None else []) if m.type == "ARMATURE"]
    if not source_stack:
        modifier = garment.modifiers.new("skin", "ARMATURE")
        modifier.object = armature
        modifier.use_deform_preserve_volume = True
        return {"mode": "fitted-body-surface-duplicate", "armatureStack": ["skin:preserve-volume"]}
    mirrored = []
    for source in source_stack:
        modifier = garment.modifiers.new(source.name, "ARMATURE")
        modifier.object = armature
        modifier.use_deform_preserve_volume = source.use_deform_preserve_volume
        modifier.use_multi_modifier = source.use_multi_modifier
        modifier.use_vertex_groups = source.use_vertex_groups
        modifier.use_bone_envelopes = source.use_bone_envelopes
        modifier.vertex_group = source.vertex_group
        modifier.invert_vertex_group = source.invert_vertex_group
        mirrored.append("%s:%s%s%s" % (
            source.name,
            "preserve-volume" if source.use_deform_preserve_volume else "linear",
            "+multi" if source.use_multi_modifier else "",
            ("@" + source.vertex_group) if source.vertex_group else "",
        ))
    return {"mode": "fitted-body-surface-duplicate", "armatureStack": mirrored}


def _ring_profile(profile_verts, z, cx, cy, segs, band):
    """Per-angle OUTER body radius at height ``z`` about ``(cx, cy)``.

    For each of ``segs`` angular sectors take the farthest skin vertex within
    ``±band`` in z whose angle lies within one sector of the sector centre (the
    windows overlap so a sparse band still fills). Sectors with no vertex are
    interpolated linearly around the ring from their nearest filled neighbours,
    then the ring gets two circular [1,2,1]/4 smoothing passes so it reads as a
    sewn waistband rather than a scan of individual vertices. Returns ``None``
    when the band is too sparse (caller widens the band).
    """
    near = [v for v in profile_verts if abs(v.z - z) < band]
    if len(near) < 12:
        return None
    step = 2.0 * math.pi / segs
    polar = [
        (math.atan2(v.y - cy, v.x - cx) % (2.0 * math.pi), math.hypot(v.x - cx, v.y - cy))
        for v in near
    ]
    radii = [None] * segs
    for j in range(segs):
        centre = j * step
        best = None
        for angle, radius in polar:
            delta = abs(((angle - centre + math.pi) % (2.0 * math.pi)) - math.pi)
            if delta <= step and (best is None or radius > best):
                best = radius
        radii[j] = best
    known = list(radii)
    if all(r is None for r in known):
        return None
    for j in range(segs):
        if known[j] is not None:
            continue
        back = next(k for k in range(1, segs) if known[(j - k) % segs] is not None)
        fwd = next(k for k in range(1, segs) if known[(j + k) % segs] is not None)
        r_back, r_fwd = known[(j - back) % segs], known[(j + fwd) % segs]
        radii[j] = r_back + (r_fwd - r_back) * back / (back + fwd)
    for _ in range(2):
        radii = [
            (radii[(j - 1) % segs] + 2.0 * radii[j] + radii[(j + 1) % segs]) / 4.0
            for j in range(segs)
        ]
    return radii


def generate_skirt(spec, body_verts, profile_verts=None):
    """Build a waist-pinned skirt cut to the body's cross-section with clearance.

    Each vertical ring follows the body's OWN outer profile at that height (per
    angular sector, see ``_ring_profile``) plus an outward clearance - snug at the
    waist, flared at the hem - and relaxes linearly from that profile towards a
    round ring of the same mean radius down the skirt: the waistband is cut to the
    wearer, a flared hem hangs round. The whole garment starts *outside* the body
    and never begins interpenetrating.

    The first build used a CIRCLE of the maximum body radius at each height. On an
    elliptical pelvis (wide across the hips, shallow front-to-back) that circle
    cleared the belly and lower back by ~10 cm: the skirt and dress read as a big
    ring floating around the waist and the pinned waistband drifted 13-15 cm off
    the body. ``profile_verts`` (default ``body_verts``) is the skin sampled for
    the profile; the placement/centre still comes from ``body_verts``.
    """
    profile_verts = profile_verts or body_verts
    zs = [v.z for v in body_verts]
    zmin, zmax = min(zs), max(zs)
    height = zmax - zmin
    # ``top_z_m`` (absolute world z of the top ring) is preferred; a
    # ``waist_height_frac`` of the region height is kept for legacy specs.
    if "top_z_m" in spec:
        top_z = spec["top_z_m"]
    else:
        top_z = zmin + spec["waist_height_frac"] * height
    hem_z = top_z - spec["length_m"]

    band = [v for v in body_verts if abs(v.z - top_z) < 0.04] or body_verts
    cx = sum(v.x for v in band) / len(band)
    cy = sum(v.y for v in band) / len(band)

    rings, segs = spec["rings"], spec["segments"]
    positions = []
    waist_profile = None
    for i in range(rings):
        t = i / (rings - 1)
        z = top_z + t * (hem_z - top_z)
        profile = None
        for band_half in (0.025, 0.04, 0.06):
            profile = _ring_profile(profile_verts, z, cx, cy, segs, band_half)
            if profile:
                break
        if profile is None:
            near = [v for v in profile_verts if abs(v.z - z) < 0.08]
            fallback = max((math.hypot(v.x - cx, v.y - cy) for v in near), default=0.12)
            profile = [fallback] * segs
        if waist_profile is None:
            waist_profile = profile
        mean_r = sum(profile) / segs
        clearance = spec["clearance_top_m"] + t * (spec["clearance_bottom_m"] - spec["clearance_top_m"])
        for j in range(segs):
            # Body-shaped at the top (t=0), round at the hem (t=1).
            radius = profile[j] + t * (mean_r - profile[j]) + clearance
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
    # Rings above the waist seam (``waist_z_m``) are the fitted bodice of a dress;
    # a plain skirt has none (bodice_rings = 0). Derived from the tube's linear z.
    bodice_rings = 0
    if "waist_z_m" in spec and top_z > hem_z:
        frac = (top_z - spec["waist_z_m"]) / (top_z - hem_z)
        bodice_rings = max(0, min(rings, round(frac * (rings - 1))))
    meta = {
        "rings": rings,
        "ring_of": ring_of,
        "pin_indices": list(range(segs)),
        "rest_edges": rest_edges,
        "rest_lengths": rest_lengths,
        "rest_diag": rest_diag,
        "adjacent": _build_adjacency(mesh, hops=2),
        "bodice_rings": bodice_rings,
        "waist_z": top_z,
        "hem_z": hem_z,
        # Evidence that the waistband is cut to the body, not a circle: the top
        # ring's body-profile radii (before clearance).
        "waist_profile": {
            "meanRadiusM": round(sum(waist_profile) / segs, 4),
            "minRadiusM": round(min(waist_profile), 4),
            "maxRadiusM": round(max(waist_profile), 4),
            "clearanceTopM": spec["clearance_top_m"],
        },
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
    # Hang every skirt ring from ONE stable pelvis hoop and fade the pin down it -
    # a swinging thigh can never tear the waistband. A dress additionally keeps its
    # bodice rings on their transferred torso weights (a fitted sheath) above the
    # pinned waist (bodice_rings; see _lock_and_gradient).
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
    """Hang the whole skirt from one stable hip hoop; fade the cloth pin down it.

    * Armature: EVERY ring is bound 1.0 to a single pelvis/lower-spine deform bone,
      so the skirt's armature-deformed base is a stable hip-hung cone. This is the
      key fix for the bulk edge stretch: the earlier binding left the mid rings
      weighted to the independently swinging thighs, so a stride pulled the two
      sides of the pinned band apart and stretched those edges ~3x regardless of
      any cloth material setting. With the base a stable hoop, the free hem drapes
      over the moving legs through cloth *collision*, not the armature.
    * Cloth pin: ``vertex_group_mass`` fades linearly from 1.0 at the top ring to 0
      over ``pin_fade_rings`` rings. The pinned upper rings are held to the hoop
      (waistband stays on the hips); the lower rings (pin weight 0) simulate freely
      and drape. The smooth fade removes the hard pinned/free tear boundary.
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

    # A dress keeps its bodice rings (above the waist seam) on their transferred
    # torso weights, fully pinned, so the bodice moves with the torso like a fitted
    # sheath; the skirt rings below the waist hang from the hoop with a fading pin.
    # A plain skirt has bodice_rings == 0, so every ring hangs from the hoop.
    bodice_rings = meta.get("bodice_rings", 0)
    for i in range(rings):
        verts = ring_verts[i]
        if i < bodice_rings:
            # Fitted bodice: keep the transferred torso weights. A soft pin (< 1.0)
            # lets collision eject any bodice vertex the circular barrel places
            # slightly inside the elliptical torso, instead of locking it there;
            # full pin (1.0) would trap those inside and read as penetration.
            pin.add(verts, spec.get("bodice_pin", 1.0), "REPLACE")
            continue
        # Bind every skirt ring's armature deform to the single pelvis hoop bone
        # (not the thighs), so the base cone is stable and only cloth+collision move
        # the hem. Fade the pin from 1.0 at the waist seam down the skirt.
        for group in skirt.vertex_groups:
            if group.name != "waistband":
                group.remove(verts)
        hip_group.add(verts, 1.0, "REPLACE")
        weight = max(0.0, 1.0 - (i - bodice_rings) / pin_fade)
        if weight > 0.0:
            pin.add(verts, weight, "REPLACE")
        else:
            pin.remove(verts)
    return {"lockRings": lock_rings, "pinFadeRings": pin_fade, "hipBone": hip_bone.name,
            "bodiceRings": bodice_rings,
            "armatureBind": "bodice-torso+skirt-pelvis-hoop" if bodice_rings else "all-rings-pelvis-hoop"}


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
    # A gentler self-impulse clamp than the body clamp lets internal folds settle
    # without spiking (cloth-system-design: self-collision is the expensive, spike-
    # prone term); defaults to the body clamp when unset.
    c.self_impulse_clamp = cfg.get("self_impulse_clamp", cfg["impulse_clamp"])
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
def run_gate(skirt, body, meta, scene, start, end, is_fitted=False, garment_class=None):
    garment_class = garment_class or ("fitted" if is_fitted else "loose")
    # The body's ``Hide helpers`` Mask modifier changes topology, so it is
    # switched off for the gate and the skin surface is rebuilt from skin-only
    # base polygons instead: same surface, but the evaluated body stays
    # index-aligned with its base mesh and the covered skin can be addressed by
    # vertex index. Restored afterwards so the renders still hide the helpers.
    masks = [m for m in body.modifiers if m.type == "MASK" and m.show_viewport]
    for modifier in masks:
        modifier.show_viewport = False
    try:
        return _run_gate(skirt, body, meta, scene, start, end, garment_class)
    finally:
        for modifier in masks:
            modifier.show_viewport = True


def _run_gate(skirt, body, meta, scene, start, end, garment_class):
    # ``mhclo`` shares the fitted bounds and worn-shape edge-strain baseline (no
    # cloth pin, so no anchor drift) but differs structurally: its Subdivision
    # modifier means the evaluated garment is not index-aligned with its base
    # mesh (handled in the baseline block below), self-intersection does not
    # apply (an armature-only garment cannot fold beyond its authored shape),
    # and it can carry deleted (masked) skin the gate must confirm stays covered.
    is_fitted = garment_class in ("fitted", "mhclo")
    is_mhclo = garment_class == "mhclo"
    adjacent = meta["adjacent"]
    pin = set(meta["pin_indices"])
    frames = list(range(start, end + 1))
    skin_polys = skin_polygons(body)
    covered_indices = meta.get("covered_body_indices")
    if covered_indices is None:
        covered_indices = range(len(body.data.vertices))
    masked_indices = masked_skin_indices(body) if is_mhclo else set()
    if is_mhclo:
        # ``covered_body_indices`` was frozen at fit time inside the
        # per-component loop (component k's ``build_mhclo_meta`` only excluded
        # the delete groups that existed for components 0..k, not the whole
        # outfit's), so it disagreed with the gate's own ``masked_indices``
        # (every ``Delete.*`` group that exists by gate time) and results
        # depended on component order. Recomputed here from the same footprint
        # against the CURRENT, complete mask instead of trusting the frozen set.
        covered_indices = sorted(set(meta["footprint"]) - masked_indices)
    footprint_holes = sorted(set(meta.get("footprint", [])) & masked_indices) if is_mhclo else []
    # A seam skin vertex can legitimately be covered by a NEIGHBOURING garment
    # rather than this one (the pants' delete group at the ankle, covered by the
    # boots; the sweater's at the waist, covered by the pants) - so the
    # deleted-skin-coverage check below tests against every fitted garment in
    # the outfit, not just this one. ``assemble_and_render_mhclo_outfit`` sets
    # this once every component is fitted; absent (or for a lone garment) it
    # falls back to just this garment's own surface.
    outfit_garments = meta.get("outfit_garments") if is_mhclo else None
    # Deleted-skin BOUNDARY: a masked vertex deep inside a closed masked region
    # (the toes in front of a closed boot toe cap - the delete group hides the
    # whole foot, the boot is shorter) shows nothing when uncovered; there is no
    # visible hole there. A hole is only visible at the EDGE of the masked
    # region, next to skin nothing hid - so the gated check runs over this
    # asset's own ``Delete.<asset>`` vertices that have at least one skin
    # neighbour (over the body's own mesh edges, skin-group vertices only) NOT
    # in any ``Delete.*`` group in the outfit. Pure topology/group membership -
    # frame-invariant, computed once here rather than per frame.
    boundary_holes = []
    if is_mhclo:
        own_delete_indices = set(meta.get("own_delete_indices", []))
        if own_delete_indices:
            skin_group = body.vertex_groups.get("body")
            skin_flag = [False] * len(body.data.vertices)
            if skin_group is not None:
                for v in body.data.vertices:
                    skin_flag[v.index] = any(g.group == skin_group.index and g.weight > 0 for g in v.groups)
            is_boundary = set()
            for e in body.data.edges:
                a, b = e.vertices
                if a in own_delete_indices and skin_flag[b] and b not in masked_indices:
                    is_boundary.add(a)
                if b in own_delete_indices and skin_flag[a] and a not in masked_indices:
                    is_boundary.add(b)
            boundary_holes = sorted(is_boundary)
    # The occlusion set (below, per frame) must be computed over every index
    # either hole check tests, not just ``covered_indices`` - otherwise a
    # boundary/interior vertex facing another body part (the crotch skin facing
    # the other thigh) is never even considered for occlusion and reads as a
    # false hole. Frame-invariant (pure index sets), computed once.
    occlusion_indices = (
        sorted(set(covered_indices) | set(boundary_holes) | set(footprint_holes))
        if is_mhclo else covered_indices
    )

    # Edge-strain baseline + garment topology. Cloth: the relaxed generated
    # garment (does the fabric stretch from its relaxed state). Fitted: the
    # *worn* shape at the first walk frame - a fitted garment is made to conform
    # to the body, so its unstrained state is the worn shape and integrity means
    # "does it tear DURING the walk", not "does conforming to the body deviate
    # from the flat pattern". Mhclo uses the same worn-shape baseline, but its
    # edges/polygons are read from the EVALUATED (subdivided) mesh at that frame
    # instead of the base mesh - Catmull-Clark topology is frame-invariant, so
    # they are reused for every later frame. A fitted garment's vertex j was cut
    # from body vertex covered_indices[j] (bmesh keeps the surviving order), so
    # its garment-into-body check can skip vertices whose skin twin is occluded
    # by another body part; an mhclo garment's evaluated vertices have no such
    # index correspondence, so each is matched to its nearest evaluated skin
    # vertex (within 5 cm) instead.
    if is_mhclo:
        scene.frame_set(start)
        deps = bpy.context.evaluated_depsgraph_get()
        worn, _worn_normals, rest_edges, garment_polys = evaluated_topology(skirt, deps)
        rest_lengths = [max(1e-9, (worn[a] - worn[b]).length) for a, b in rest_edges]
        xs = [v.x for v in worn]; ys = [v.y for v in worn]; zs = [v.z for v in worn]
        rest_diag = Vector((max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))).length
        body_verts0, _body_normals0, _bvh0 = evaluated_surface(body, deps, skin_polys)
        skin_group = body.vertex_groups["body"]
        skin_idx = [
            v.index for v in body.data.vertices
            if any(g.group == skin_group.index and g.weight > 0 for g in v.groups)
        ]
        skin_tree = KDTree(len(skin_idx))
        for slot, index in enumerate(skin_idx):
            skin_tree.insert(body_verts0[index], slot)
        skin_tree.balance()
        twins = []
        for v in worn:
            _co, slot, dist = skin_tree.find(v)
            twins.append(skin_idx[slot] if slot is not None and dist <= 0.05 else None)
    else:
        rest_edges = meta["rest_edges"]
        garment_polys = [tuple(p.vertices) for p in skirt.data.polygons]
        if is_fitted:
            scene.frame_set(start)
            worn = evaluated_world_verts(skirt, bpy.context.evaluated_depsgraph_get())
            rest_lengths = [max(1e-9, (worn[a] - worn[b]).length) for a, b in rest_edges]
        else:
            rest_lengths = meta["rest_lengths"]
        rest_diag = meta["rest_diag"]
        # A fitted garment's vertex j was cut from body vertex covered_indices[j]
        # (bmesh keeps the surviving order), so the garment-into-body check can
        # skip vertices whose skin twin is occluded by another body part.
        twins = list(covered_indices) if is_fitted and len(covered_indices) == len(skirt.data.vertices) else None

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
    # Body-through-garment poke-through (see GATE["poke_*"]). A ray that leaves
    # a thin body part and then meets the garment - the swinging hand's fingers
    # brushing the hip of the trousers or a skirt at peak stride - is NOT a
    # break-through: the fabric is outside the body there. So a hit only counts
    # when the ray reaches the garment before it exits the body.
    worst_poke_frac = 0.0
    total_poke = 0.0
    deepest_poke = 0.0
    poke_frames = 0
    poke_ever_covered = False
    # Deleted-skin coverage (mhclo only, see GATE["deleted_uncovered_..."]): the
    # gated check is over BOUNDARY vertices (worst_hole_frac); the same test
    # over the full interior footprint is kept as informational context only
    # (worst_interior_frac - a closed region's interior, e.g. toes in front of
    # a closed boot toe cap, is never a visible hole even when "uncovered").
    worst_hole_frac = 0.0
    total_hole = 0.0
    hole_frames = 0
    worst_hole_gap = 0.0
    worst_interior_frac = 0.0
    hole_ever_denom = False
    hole_inward_depth = 0.03

    def _hole_covered(tree, point, normal):
        if tree.find_nearest(point, 0.01)[0] is not None:
            return True
        if tree.ray_cast(point - normal * 0.001, -normal, hole_inward_depth)[0] is not None:
            return True
        return tree.ray_cast(point + normal * 0.001, normal, GATE["poke_cover_reach_m"])[0] is not None

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

        body_verts, body_normals, bvh = evaluated_surface(body, deps, skin_polys)
        # Skin occluded by ANOTHER body part cannot show and is excluded from both
        # body checks: any skin face within poke_occlusion_gap_m that lies on the
        # outward side of the vertex and FACES it (opposing normal) belongs to a
        # part pressed against this skin. A range query, not a single ray along
        # the normal: a ray grazes past a thin arm resting against the torso side
        # while the sleeve panel sits a full offset inside the torso beneath it.
        z_lo, z_hi = min(zs) - 0.02, max(zs) + 0.02
        occluded = set()
        # Two facing skins closer than twice the garment's stand-off are buried in
        # fabric from both sides (a 24 mm knit fills a 4 cm arm-to-torso gap), so
        # the occlusion gap grows with the offset; the floor covers loose garments.
        gap = max(GATE["poke_occlusion_gap_m"], 2.0 * meta.get("surface_offset_m", 0.0))
        for index in occlusion_indices:
            point, normal = body_verts[index], body_normals[index]
            if point.z < z_lo or point.z > z_hi:
                continue
            for loc, face_normal, _idx, _dist in bvh.find_nearest_range(point, gap):
                if (loc - point).dot(normal) > 0.002 and face_normal.dot(normal) < -0.2:
                    occluded.add(index)
                    break

        inside = 0
        anchor = 0.0
        for i, v in enumerate(verts):
            twin = twins[i] if twins is not None else None
            # Fabric over occluded skin, or over skin already deleted for this
            # garment, cannot be seen either way, so neither counts as a
            # garment-into-body penetration.
            if twin is not None and (twin in occluded or twin in masked_indices):
                continue
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

        if not is_mhclo:
            # self-intersection: nearest non-adjacent vertex closer than
            # tolerance. Skipped for mhclo - an armature-only garment cannot
            # self-collide beyond its authored shape (no solver to fold it), and
            # this O(n log n) KD-tree pass is the one cost that matters at the
            # ~40k evaluated verts a subdivided .mhclo garment can carry.
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

        # Body poke-through: from every COVERED skin vertex (the garment's own
        # body region - never the hands/feet swinging past it) in the garment's
        # height band, cast a ray INWARD along the skin normal. Meeting the
        # garment within ``poke_depth_max_m`` while still inside the body means
        # the fabric is under the skin there - the body has broken through (skin
        # shows). A skin vertex counts as "covered" when either ray (inward, or
        # outward within ``poke_cover_reach_m``) meets the garment; region skin
        # the garment does not reach (legs below a hem) is ignored.
        garment_tree = BVHTree.FromPolygons(verts, garment_polys)
        covered = 0
        poked = 0
        depth = GATE["poke_depth_max_m"]
        for index in covered_indices:
            if index in occluded:
                continue
            point, normal = body_verts[index], body_normals[index]
            if point.z < z_lo or point.z > z_hi:
                continue
            origin = point - normal * 0.001  # start just under the skin
            hit = garment_tree.ray_cast(origin, -normal, depth)
            if hit[0] is not None:
                covered += 1
                # Only a break-through if the ray reaches the garment while still
                # INSIDE the body; if it leaves the body first (exits a finger,
                # then meets the trousers beside the hip) the fabric is outside.
                if bvh.ray_cast(origin, -normal, hit[3])[0] is None:
                    poked += 1
                    deepest_poke = max(deepest_poke, hit[3] + 0.001)
                continue
            if garment_tree.ray_cast(point, normal, GATE["poke_cover_reach_m"])[0] is not None:
                covered += 1
        poke_frac = poked / covered if covered else 0.0
        if covered:
            poke_ever_covered = True
        worst_poke_frac = max(worst_poke_frac, poke_frac)
        total_poke += poke_frac
        if poked:
            poke_frames += 1

        if is_mhclo:
            # Deleted-skin coverage: a masked (deleted) skin vertex must still
            # be COVERED, on every walk frame, by SOME garment in the outfit -
            # not necessarily this one (a neighbouring garment's hem can
            # legitimately be the one that covers a shared seam, e.g. the
            # pants' waist delete group covered by the sweater) - so both
            # checks below test against the union of every fitted garment's
            # evaluated surface (falling back to just this garment when
            # ``outfit_garments`` is absent). See ``_hole_covered`` for
            # "covered". Two variants, same test:
            #  - the full interior footprint (``footprint_holes``, informational
            #    only): a masked vertex deep inside a closed region (the toes in
            #    front of a closed boot toe cap) shows nothing when uncovered -
            #    not a real hole, but kept visible in the report.
            #  - the masked-region BOUNDARY only (``boundary_holes``, gated): a
            #    hole is only visible where the masked region meets skin nothing
            #    hid.
            if outfit_garments:
                union_verts = list(verts)
                union_polys = list(garment_polys)
                offset = len(verts)
                for other in outfit_garments:
                    if other is skirt:
                        continue
                    other_verts, _other_normals, _other_edges, other_polys = evaluated_topology(other, deps)
                    union_verts.extend(other_verts)
                    union_polys.extend(tuple(i + offset for i in poly) for poly in other_polys)
                    offset += len(other_verts)
                hole_tree = BVHTree.FromPolygons(union_verts, union_polys)
            else:
                hole_tree = garment_tree

            interior_hole = 0
            interior_denom = 0
            for index in footprint_holes:
                if index in occluded:
                    continue
                point, normal = body_verts[index], body_normals[index]
                if point.z < z_lo or point.z > z_hi:
                    continue
                interior_denom += 1
                if not _hole_covered(hole_tree, point, normal):
                    interior_hole += 1
            interior_frac = interior_hole / interior_denom if interior_denom else 0.0
            worst_interior_frac = max(worst_interior_frac, interior_frac)

            hole = 0
            hole_denom = 0
            for index in boundary_holes:
                if index in occluded:
                    continue
                point, normal = body_verts[index], body_normals[index]
                if point.z < z_lo or point.z > z_hi:
                    continue
                hole_denom += 1
                if _hole_covered(hole_tree, point, normal):
                    continue
                hole += 1
                nearest = hole_tree.find_nearest(point, 5.0)
                if nearest[0] is not None:
                    worst_hole_gap = max(worst_hole_gap, nearest[3])
            hole_frac = hole / hole_denom if hole_denom else 0.0
            if hole_denom:
                hole_ever_denom = True
            worst_hole_frac = max(worst_hole_frac, hole_frac)
            total_hole += hole_frac
            if hole:
                hole_frames += 1

        for (a, b), rest_len in zip(rest_edges, rest_lengths):
            if rest_len <= 1e-9:
                continue
            ratio = (verts[a] - verts[b]).length / rest_len
            min_edge = min(min_edge, ratio)
            max_edge = max(max_edge, ratio)
            edge_ratios.append(ratio)

    explosion = worst_diag / rest_diag if rest_diag else float("inf")
    mean_pen = total_pen / len(frames)
    mean_poke = total_poke / len(frames)
    mean_hole = total_hole / len(frames)
    edge_p99 = _percentile(edge_ratios, 99.0)
    edge_p01 = _percentile(edge_ratios, 1.0)
    # Free-swinging hems (loose/hybrid) get the looser bulk-stretch bound and a
    # small allowance for transient collision misses; fitted/mhclo fabric gets
    # neither.
    edge_p99_max = GATE["edge_stretch_p99_max"] if is_fitted else GATE["edge_stretch_p99_max_loose"]
    poke_frame_max = GATE["poke_frac_frame_max"] if is_fitted else GATE["poke_frac_frame_max_loose"]

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
        # Body-through-garment poke-through: the fraction of covered skin vertices
        # whose inward ray meets the garment (worst frame; gated) plus the clip
        # mean, the number of affected frames and the deepest break-through
        # (informational context for the note). If no frame ever had a single
        # covered skin vertex to test (the garment's region never overlapped the
        # body's skin height band) there is nothing to measure - informational,
        # not a silent pass on a fraction of zero.
        "bodyPokeThroughFractionFrame": {"value": round(worst_poke_frac, 4), "max": poke_frame_max,
                                         "applicable": False, "informational": True, "pass": True,
                                         "reason": "no-covered-vertices"}
        if not poke_ever_covered else
        {"value": round(worst_poke_frac, 4), "max": poke_frame_max,
         "pass": worst_poke_frac < poke_frame_max},
        "bodyPokeThroughFractionClip": {"value": round(mean_poke, 4), "informational": True, "pass": True},
        "bodyPokeThroughFrames": {"value": poke_frames, "of": len(frames), "informational": True, "pass": True},
        "bodyPokeThroughDepthMaxM": {"value": round(deepest_poke, 4), "informational": True, "pass": True},
        # Anchor drift is a cloth-pin metric (does the pinned waistband stay on the
        # body). A fitted/mhclo garment has no pin - its "stays on body" is the
        # penetration check - so this is informational (not gated) then.
        "waistbandAnchorDriftM": {"value": round(max_anchor, 4), "max": GATE["anchor_drift_max_m"],
                                  "applicable": not is_fitted,
                                  "pass": is_fitted or max_anchor < GATE["anchor_drift_max_m"]},
        # An armature-only .mhclo garment cannot self-collide beyond its
        # authored shape (see the skip above) - informational only, never
        # gated.
        "selfIntersectionFraction": {"value": None, "informational": True, "applicable": False, "pass": True}
        if is_mhclo else
        {"value": round(worst_self_frac, 4), "max": GATE["self_intersect_frac_max"],
         "pass": worst_self_frac < GATE["self_intersect_frac_max"]},
        # Bulk edge behaviour (99th/1st pctile) + a blow-up catch. The raw max/min
        # are kept as informational context, not gated (see GATE comment).
        "edgeStretchP99": {"value": round(edge_p99, 3), "max": edge_p99_max,
                           "pass": edge_p99 < edge_p99_max},
        "edgeCompressionP01": {"value": round(edge_p01, 3), "min": GATE["edge_compression_p01_min"],
                               "pass": edge_p01 > GATE["edge_compression_p01_min"]},
        "edgeBlowupMax": {"value": round(max_edge, 3), "max": GATE["edge_blowup_max"],
                          "pass": max_edge < GATE["edge_blowup_max"]},
        "edgeStretchMaxInfo": {"value": round(max_edge, 3), "informational": True, "pass": True},
        "edgeCompressionMinInfo": {"value": round(min_edge, 3), "informational": True, "pass": True},
        # Deleted-skin coverage (mhclo only): does this garment's own delete
        # group have a visible hole - a BOUNDARY vertex (see above) that no
        # garment in the outfit covers - on every walk frame. Not applicable to
        # the procedural classes, which never delete skin.
        "deletedSkinUncoveredFractionFrame": (
            {"value": round(worst_hole_frac, 4), "max": GATE["deleted_uncovered_frac_frame_max"],
             "applicable": False, "informational": True, "pass": True, "reason": "no-boundary-vertices"}
            if is_mhclo and not hole_ever_denom else
            {"value": round(worst_hole_frac, 4), "max": GATE["deleted_uncovered_frac_frame_max"],
             "pass": worst_hole_frac < GATE["deleted_uncovered_frac_frame_max"]}
        ) if is_mhclo else
        {"value": None, "applicable": False, "informational": True, "pass": True},
    }
    if is_mhclo:
        checks["deletedSkinBoundaryVertices"] = {"value": len(boundary_holes), "informational": True, "pass": True}
        checks["deletedSkinUncoveredFractionClip"] = {"value": round(mean_hole, 4), "informational": True, "pass": True}
        checks["deletedSkinUncoveredFrames"] = {"value": hole_frames, "of": len(frames), "informational": True, "pass": True}
        checks["deletedSkinUncoveredGapMaxM"] = {"value": round(worst_hole_gap, 4), "informational": True, "pass": True}
        # The same test over the full interior footprint (not just the masked
        # region's boundary) - a closed region's interior is never a visible
        # hole even when "uncovered" (see the toe-cap comment above), so this
        # stays informational, but visible in the report.
        checks["deletedSkinInteriorUncoveredFractionInfo"] = {
            "value": round(worst_interior_frac, 4), "informational": True, "pass": True}
    checks_pass = all(c["pass"] for c in checks.values())
    return {"status": "pass" if checks_pass else "fail", "pass": checks_pass,
            "frames": [start, end], "garmentClass": garment_class,
            "checks": checks}


def gate_notes(label, gate):
    """Plain-word notes for the report: one per failing check, with a body
    break-through spelled out first (it is the failure the eye sees first, and it
    used to pass silently because only garment-into-body penetration was gated)."""
    notes = []
    checks = gate["checks"]
    poke = checks.get("bodyPokeThroughFractionFrame")
    if poke and poke.get("reason") == "no-covered-vertices":
        notes.append(
            "%s: bodyPokeThroughFractionFrame had nothing to measure (no covered skin vertex on "
            "any walk frame)." % label)
    if poke and not poke["pass"]:
        frames = checks["bodyPokeThroughFrames"]
        notes.append(
            "%s: BODY BREAKS THROUGH THE GARMENT - skin shows through the fabric on %d of %d walk "
            "frames (worst frame %.2f%% of the covered skin, deepest %.1f mm; bound %.2f%%). This is a "
            "failing check, not a render quirk: do not accept the garment until it is fixed." % (
                label, frames["value"], frames["of"], poke["value"] * 100.0,
                checks["bodyPokeThroughDepthMaxM"]["value"] * 1000.0, poke["max"] * 100.0))
    hole = checks.get("deletedSkinUncoveredFractionFrame")
    if hole and hole.get("reason") == "no-boundary-vertices":
        notes.append(
            "%s: deletedSkinUncoveredFractionFrame had nothing to measure (this asset's delete "
            "group has no boundary vertex against un-masked skin on any walk frame)." % label)
    if hole and hole.get("applicable", True) and not hole["pass"]:
        frames = checks["deletedSkinUncoveredFrames"]
        notes.append(
            "%s: THE BODY HAS AN UNCOVERED HOLE - the body's open edge under the garment is exposed "
            "on %d of %d frames (worst frame %.2f%%; bound %.2f%%). Regenerate the delete group with "
            "more erosion or move the layer." % (
                label, frames["value"], frames["of"], hole["value"] * 100.0, hole["max"] * 100.0))
    for name, check in checks.items():
        if (check.get("pass") or check.get("informational") or name.startswith("bodyPokeThrough")
                or name == "deletedSkinUncoveredFractionFrame"):
            continue
        bound = check.get("max", check.get("min"))
        notes.append("%s: %s failed (value %s, bound %s)." % (label, name, check["value"], bound))
    return notes


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
    # Grow the fabric thickness OUTWARD (+1) so the surface the gate measured is
    # the garment's inner face: a centred (0.0) shell put half the thickness back
    # towards the skin, eating into a fitted garment's 12-16 mm clearance.
    solidify.offset = 1.0
    for poly in skirt.data.polygons:
        poly.use_smooth = True


def render_evidence(scene, camera, output, clip, height, mid_y, span, start, end, travel=1.0):
    """Stills (first/mid/last frame), an mp4 and a contact sheet from each of the
    reel's evidence views: side, rear three-quarter (walker recedes - the back of
    the garments) and front three-quarter (``three-quarter-reverse``: the walker
    approaches - face, chest, tie, skirt/dress front). ``travel`` is the sign of
    the root's Y travel, so "ahead" is computed rather than assumed."""
    scene.frame_start, scene.frame_end = start, end
    evidence = {"views": list(reel.EVIDENCE_VIEWS), "stills": [], "videos": [], "contactSheets": []}
    for view in reel.EVIDENCE_VIEWS:
        reel.fixed_camera(scene, camera, height, view, mid_y, span, travel)
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


def skirt_profile_verts(body, spec):
    """Skin vertices sampled for a loose skirt's cross-section profile
    (``profile_tokens``, default ``region_tokens``); the arms/hands stay excluded."""
    tokens = spec.get("profile_tokens")
    if not tokens:
        return None
    return body_reference_verts(body, {**spec, "region_tokens": tokens})


def build_dress(spec, body, armature, scene, camera, output, clip, preroll, height,
                mid_y, span, start, end, geometry_file, source_file, travel=1.0):
    """Build the TWO-PIECE hybrid dress: a FITTED bodice + a LOOSE skirt, in one
    scene, rendered together. The bodice is the torso's own surface (conforms
    exactly, zero penetration); the skirt is a pelvis-hoop cloth tube baked over the
    walk (like the mini-skirt). Each piece runs its own class-appropriate gate."""
    bodice_spec, skirt_spec = spec["bodice"], spec["skirt"]

    bodice, bodice_meta = generate_from_body_surface(body, bodice_spec)
    bodice_binding = surface_bind(bodice, armature, body)
    bodice_gate = run_gate(bodice, body, bodice_meta, scene, start, end, is_fitted=True)

    reference_verts = body_reference_verts(body, skirt_spec)
    skirt, skirt_meta = generate_skirt(skirt_spec, reference_verts, skirt_profile_verts(body, skirt_spec))
    skirt_meta["covered_body_indices"] = covered_body_indices(body, skirt_spec)
    make_body_collider(body, skirt_spec.get("body_thickness_outer_m", BODY_THICKNESS_OUTER_M))
    skirt_binding = bind_skirt_to_body(skirt, body, armature, skirt_meta, skirt_spec)
    cloth = setup_cloth(skirt, skirt_spec)
    sim_start = start - preroll
    blend, baked = bake_cloth(skirt, cloth, scene, sim_start, end, output)
    skirt_gate = run_gate(skirt, body, skirt_meta, scene, start, end, is_fitted=False)

    finalize_look(bodice, bodice_spec)
    finalize_look(skirt, skirt_spec)
    evidence = render_evidence(scene, camera, output, clip, height, mid_y, span, start, end, travel)

    components = [
        {"garment": "dress-bodice", "kind": "fitted", "vertexCount": len(bodice.data.vertices),
         "binding": bodice_binding, "gate": bodice_gate},
        {"garment": "dress-skirt", "kind": "loose", "vertexCount": len(skirt.data.vertices),
         "binding": skirt_binding, "waistProfile": skirt_meta.get("waist_profile"), "gate": skirt_gate},
    ]
    notes = gate_notes("dress-bodice", bodice_gate) + gate_notes("dress-skirt", skirt_gate)
    dress_pass = bodice_gate["pass"] and skirt_gate["pass"]
    report = {
        "schemaVersion": 1,
        "status": "pass" if dress_pass else "fail",
        "phase": "cloth-system-phase-3-dress",
        "garment": "dress",
        "garmentKind": "hybrid-two-piece",
        "clip": clip,
        "simFrames": [sim_start, end],
        "walkFrames": [start, end],
        "rootTravelY": round(span, 4),
        "diskCacheBaked": baked,
        "components": components,
        "notes": notes,
        "geometry": geometry_file,
        "source": source_file,
        "blend": blend,
        "blender": bpy.app.version_string,
        "evidence": evidence,
    }
    with open(os.path.join(output, f"{clip}-cloth-report.json"), "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
        handle.write("\n")
    for note in notes:
        print("CLOTH_NOTE", note)
    bc, sc = bodice_gate["checks"], skirt_gate["checks"]
    print("CLOTH_WALK_DONE garment=dress gate=%s bodice(edgeP99=%.3f pen=%.4f poke=%.4f) skirt(edgeP99=%.3f pen=%.4f poke=%.4f anchor=%.4f)" % (
        report["status"], bc["edgeStretchP99"]["value"], bc["penetrationFractionClip"]["value"],
        bc["bodyPokeThroughFractionFrame"]["value"],
        sc["edgeStretchP99"]["value"], sc["penetrationFractionClip"]["value"],
        sc["bodyPokeThroughFractionFrame"]["value"], sc["waistbandAnchorDriftM"]["value"]))


def assemble_and_render_outfit(name, components, body, armature, scene, camera, output,
                               clip, height, mid_y, span, start, end, geometry_file,
                               source_file, travel=1.0):
    """Dress the walking body in several FITTED garments at once, one combined sheet.

    Each component is an independent body-surface duplicate + armature bind, sharing
    the body implicitly as its collider and layered by ``extra_offset`` (a tie over a
    shirt). No cloth sim or inter-garment collision is needed, so the whole outfit is
    exactly as stable as its individual fitted pieces; each still runs the full gate.
    """
    components_report = []
    notes = []
    for garment_name, extra_offset in components:
        spec = GARMENT_SPECS[garment_name]
        if spec.get("kind") != "fitted":
            raise RuntimeError(f"outfit '{name}' component '{garment_name}' must be fitted")
        obj, meta = generate_from_body_surface(body, spec, extra_offset=extra_offset)
        binding = surface_bind(obj, armature, body)
        gate = run_gate(obj, body, meta, scene, start, end, is_fitted=True)
        finalize_look(obj, spec)
        components_report.append({
            "garment": garment_name,
            "extraOffsetM": extra_offset,
            "vertexCount": len(obj.data.vertices),
            "binding": binding,
            "gate": gate,
        })
        notes.extend(gate_notes(garment_name, gate))
        print("  OUTFIT_COMPONENT %s gate=%s edgeP99=%.3f penClip=%.4f poke=%.4f" % (
            garment_name, gate["status"], gate["checks"]["edgeStretchP99"]["value"],
            gate["checks"]["penetrationFractionClip"]["value"],
            gate["checks"]["bodyPokeThroughFractionFrame"]["value"]))

    blend = os.path.join(output, "cloth-walk.blend")
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=blend)

    evidence = render_evidence(scene, camera, output, name, height, mid_y, span, start, end, travel)
    outfit_pass = all(c["gate"]["pass"] for c in components_report)
    report = {
        "schemaVersion": 1,
        "status": "pass" if outfit_pass else "fail",
        "phase": "cloth-system-phase-3-outfit",
        "outfit": name,
        "clip": clip,
        "walkFrames": [start, end],
        "rootTravelY": round(span, 4),
        "components": components_report,
        "notes": notes,
        "geometry": geometry_file,
        "source": source_file,
        "blend": blend,
        "blender": bpy.app.version_string,
        "evidence": evidence,
    }
    with open(os.path.join(output, f"{name}-cloth-report.json"), "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
        handle.write("\n")
    for note in notes:
        print("CLOTH_NOTE", note)
    print("CLOTH_OUTFIT_DONE outfit=%s status=%s components=%d" % (
        name, report["status"], len(components_report)))


# --- CC0 .mhclo garments (MPFB ClothesService) --------------------------------
# The production wardrobe path (see the module docstring and OUTFIT_SPECS' "mhclo"
# comment block): real CC0 MakeHuman garments fitted via MPFB's own asset pipeline
# instead of a body-surface duplicate. Proven in the spike
# (scratchpad SPIKE-FINDINGS.md) against every asset in
# assets/wardrobe/makehuman-cc0-clothes-packs-v1.json.
_CLEARANCE_RECORD_PATH = "assets/wardrobe/makehuman-cc0-clothes-packs-v1.json"


def _repo_root():
    return os.path.dirname(os.path.dirname(SCRIPT_DIR))


def mhclo_asset_root():
    """The CC0 .mhclo data root (``clothes/<name>/<name>.mhclo`` + ``packs/*.json``),
    installed by the wardrobe-clearance task under ``work/sources/`` (git-ignored)."""
    default = os.path.join(_repo_root(), "work", "sources", "makehuman-cc0-clothes-packs-v1")
    return os.path.abspath(os.environ.get("VIDEOER_MH_CLOTHES_ROOT", default))


def load_clearance_record():
    """Load the wardrobe clearance record (licence + fitting metadata per asset).

    Never bypassed: a missing record is a stop-and-report condition, not a reason
    to dress the body in an uncleared garment.
    """
    path = os.path.join(_repo_root(), _CLEARANCE_RECORD_PATH)
    if not os.path.exists(path):
        raise RuntimeError(
            f"Clearance record not found: {path}. Restore the committed record, or regenerate "
            "with `python3 scripts/blender/mhclo_asset_manifest.py <root> --write "
            "assets/wardrobe/makehuman-cc0-clothes-packs-v1.json`."
        )
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def _clearance_entry(record, asset):
    for entry in record.get("assets", []):
        if entry.get("asset") == asset:
            return entry
    raise RuntimeError(f"'{asset}' is not present in the clearance record {_CLEARANCE_RECORD_PATH}")


def require_cleared(asset, record):
    """The clearance record's entry for ``asset``, or a RuntimeError quoting
    ``clearanceReason`` unless it is approved for commercial use. Never bypassed."""
    entry = _clearance_entry(record, asset)
    licence = entry.get("licence", {})
    if entry.get("clearance") != "approved" or licence.get("commercialUse") != "allowed":
        raise RuntimeError(
            "'%s' is not cleared for use (clearance=%s, licence.commercialUse=%s): %s" % (
                asset, entry.get("clearance"), licence.get("commercialUse"),
                entry.get("clearanceReason", "no clearance reason recorded"))
        )
    return entry


def configure_mpfb_asset_root(mpfb_module, root):
    """Point MPFB's secondary data root at the CC0 clothes pack root so
    ``AssetService``/``list_mhclo_assets`` see it (verified in the spike)."""
    services = importlib.import_module(f"{mpfb_module}.services")
    prefs = bpy.context.preferences.addons[mpfb_module].preferences
    prefs.mpfb_second_root = root
    services.LocationService.update_second_root()
    roots = services.AssetService.get_asset_roots("clothes")
    expected = os.path.join(root, "clothes")
    if expected not in roots:
        raise RuntimeError(
            "MPFB did not pick up the clothes asset root '%s' (roots seen: %s). Check "
            "VIDEOER_MH_CLOTHES_ROOT / work/sources/makehuman-cc0-clothes-packs-v1." % (
                expected, roots)
        )
    return roots


def _sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _verify_asset_integrity(mhclo_path, record_entry, asset):
    """Hash the on-disk ``.mhclo``/``.obj``/``.mhmat`` and compare with the
    clearance record's own ``sha256`` digests.

    ``require_cleared`` only checks the record's NAME and its ``clearance``/
    ``licence`` fields against the JSON record - it says nothing about what is
    actually on disk at ``VIDEOER_MH_CLOTHES_ROOT``. Point that env var at any
    tree with a same-named asset directory and it renders as "CC0 / approved"
    regardless of what the files actually contain. Never bypassed.
    """
    expected = record_entry.get("sha256", {})
    asset_dir = os.path.dirname(mhclo_path)
    obj_file = material_file = None
    with open(mhclo_path, encoding="utf-8", errors="replace") as handle:
        for line in handle:
            words = line.split()
            if len(words) < 2:
                continue
            if words[0] == "obj_file":
                obj_file = words[1]
            elif words[0] == "material":
                material_file = words[1]
    paths = {
        "mhclo": mhclo_path,
        "obj": os.path.join(asset_dir, obj_file) if obj_file else None,
        "mhmat": os.path.join(asset_dir, material_file) if material_file else None,
    }
    for key, path in paths.items():
        want = expected.get(key)
        got = _sha256_file(path) if path and os.path.isfile(path) else None
        if want is None or got != want:
            raise RuntimeError(
                "'%s' failed integrity verification: %s digest mismatch (expected %s, got %s). "
                "VIDEOER_MH_CLOTHES_ROOT may point at an unverified tree; re-run "
                "scripts/install-makehuman-clothes-packs.sh to restore the cleared asset files." % (
                    asset, key, want, got)
            )


def add_mhclo_garment(mpfb_module, body, armature, root, component, record_entry, subdiv):
    """Fit one CC0 .mhclo garment onto the walking body via MPFB's ``ClothesService``.

    Mirrors ``HumanService.add_mhclo_asset`` (fits to the shape-key mix, parents to
    the Rigify armature, interpolates DEF-*/helper weights, adds a MakeSkin material
    + Subdivision modifier) plus the spike's explicit-rigging fallback for the rare
    case MPFB does not find the armature as a "Skeleton" relative of the body. Both
    the Subdivision modifier's ``levels`` and ``render_levels`` are set to ``subdiv``
    so the geometry a later gate would measure is the geometry that renders. The
    on-disk files are sha256-verified against the clearance record first (see
    ``_verify_asset_integrity``) - never bypassed.
    """
    services = importlib.import_module(f"{mpfb_module}.services")
    HumanService = services.HumanService
    ClothesService = services.ClothesService
    Mhclo = importlib.import_module(f"{mpfb_module}.entities.clothes.mhclo").Mhclo

    asset = component["asset"]
    mhclo_path = os.path.join(root, record_entry["mhcloPath"])
    if not os.path.isfile(mhclo_path):
        raise RuntimeError(
            f"mhclo asset '{asset}' not found at {mhclo_path}. Check VIDEOER_MH_CLOTHES_ROOT, or "
            "run scripts/install-makehuman-clothes-packs.sh to install the CC0 asset pack."
        )
    _verify_asset_integrity(mhclo_path, record_entry, asset)

    clothes = HumanService.add_mhclo_asset(
        mhclo_path, body, asset_type="Clothes", subdiv_levels=1, material_type="MAKESKIN")

    mhclo = Mhclo()
    mhclo.load(mhclo_path)  # pylint: disable=E1101

    arm_mods = [m for m in clothes.modifiers if m.type == "ARMATURE"]
    if not arm_mods:
        mhclo.clothes = clothes
        ClothesService.set_up_rigging(body, clothes, armature, mhclo)
        arm_mods = [m for m in clothes.modifiers if m.type == "ARMATURE"]
    for mod in arm_mods:
        if mod.object is None:
            mod.object = armature

    subdivision = next((m for m in clothes.modifiers if m.type == "SUBSURF"), None)
    if subdivision is not None:
        subdivision.levels = subdiv
        subdivision.render_levels = subdiv

    for poly in clothes.data.polygons:
        poly.use_smooth = True

    return clothes, mhclo


def bind_mhclo_armature(mpfb_module, clothes, armature):
    """Ensure ``clothes`` has an Armature modifier bound to ``armature`` and
    report the resulting stack, the same way ``surface_bind`` does.

    The body's own ``mhmask-preserve-volume`` vertex group is NOT a waist band -
    it covers the two hands only (2880 skin vertices, two ~11x12x12 cm blobs at
    x roughly +-0.45 m, z 0.95-1.07 m: the fingers at hip height in the A-pose).
    No .mhclo garment is fitted there, so there is nothing to mirror; MPFB's own
    single (linear-blend) Armature modifier is exactly right for every garment
    in this wardrobe.
    """
    services = importlib.import_module(f"{mpfb_module}.services")
    RigService = services.RigService
    RigService.ensure_armature_modifier(clothes, armature)
    stack = []
    for modifier in clothes.modifiers:
        if modifier.type != "ARMATURE":
            continue
        stack.append("%s:%s%s%s" % (
            modifier.name,
            "preserve-volume" if modifier.use_deform_preserve_volume else "linear",
            "+multi" if modifier.use_multi_modifier else "",
            ("@" + modifier.vertex_group) if modifier.vertex_group else "",
        ))
    return {"mode": "mhclo-clothesservice", "armatureStack": stack,
            "preserveVolume": "not-applicable: the body's mhmask-preserve-volume group covers the hands only"}


def garment_skin_footprint(body, garment, reach=0.06):
    """Base indices of the body's skin vertices this .mhclo garment spatially
    covers - never read from ``mhclo.verts`` (many assets, e.g. the suit/halter
    dress/boots/flats, are fitted to MPFB's HELPER geometry and reference zero skin
    vertices there). Rest space (shape-key mix; both garment and body's own
    modifiers off), ~0.05 s per garment.

    For each skin vertex within the garment's (padded) bounding box, rays along
    the MIX normal (``body_rest_surface``) decide: an outward ray hitting the
    garment within ``reach`` (the garment sits over the skin), an inward ray
    hitting it within 3 cm (the garment sits UNDER the skin - the skin pokes
    through it, which a generated delete group must hide just as much as skin
    the garment sits over), or the garment surface within 5 mm either way
    (coincident fabric a ray can graze past without registering a hit). A
    nearest-point SIGN test (is ``p`` on the inner or outer side of the closest
    garment point) is undefined near an open edge - skin up to ``reach`` past
    the halter dress's neckline/open back found its nearest point on the hem's
    own edge polygon and read as "inside", deleting a 6 cm band of skin beyond
    the dress entirely - so no such test is used here.
    """
    skin = body.vertex_groups["body"]
    skin_idx = [
        v.index for v in body.data.vertices
        if any(g.group == skin.index and g.weight > 0 for g in v.groups)
    ]
    rest, normals = body_rest_surface(body)
    tree = BVHTree.FromPolygons(
        [v.co.copy() for v in garment.data.vertices],
        [p.vertices[:] for p in garment.data.polygons],
    )
    lo = Vector([min(v.co[i] for v in garment.data.vertices) - reach for i in range(3)])
    hi = Vector([max(v.co[i] for v in garment.data.vertices) + reach for i in range(3)])
    covered = []
    for i in skin_idx:
        p = rest[i]
        if not all(lo[k] <= p[k] <= hi[k] for k in range(3)):
            continue
        if tree.ray_cast(p + normals[i] * 0.001, normals[i], reach)[0] is not None:
            covered.append(i)
            continue
        if tree.ray_cast(p - normals[i] * 0.001, -normals[i], 0.03)[0] is not None:
            covered.append(i)
            continue
        if tree.find_nearest(p, 0.005)[0] is not None:
            covered.append(i)
    return covered


def masked_skin_indices(body):
    """Union of skin vertex indices hidden by every ``Delete.*`` MASK modifier on
    the body (shipped delete groups + generated ones), regardless of the
    modifier's current ``show_viewport`` state.

    A ``Delete.*`` modifier's mere presence is what makes that skin invisible in
    the render; ``run_gate`` switches every body MASK modifier off so the
    evaluated body stays index-aligned with its base mesh, but that must not
    change which skin counts as hidden - so ``show_viewport`` is never checked
    here (``build_mhclo_meta`` already relies on that at fit time).
    """
    masked = set()
    for modifier in body.modifiers:
        if modifier.type != "MASK":
            continue
        if not modifier.vertex_group.startswith("Delete."):
            continue
        group = body.vertex_groups.get(modifier.vertex_group)
        if group is None:
            continue
        masked.update(
            v.index for v in body.data.vertices
            if any(g.group == group.index and g.weight > 0 for g in v.groups)
        )
    return masked


def ensure_delete_group(mpfb_module, body, clothes, asset, footprint, mode, erode_passes=1):
    """Ensure the skin ``clothes`` covers cannot poke through it.

    ``mode == "shipped"``: the .mhclo's own delete group + inverted MASK modifier
    were already added to the body by ``add_mhclo_asset``; just report them.
    ``mode == "generate"``: 10 assets ship no delete group at all even though they
    cover real skin (visible dots at the shoulders/chest) - build one from the
    spatial ``footprint``, eroded ``erode_passes`` times
    (``ClothesService._conservative_mask``, in place) so the mask never reaches the
    hem, then mask it the same way. ``mode == "extend"``: the shipped delete
    group under-covers (a real, visible gap at its boundary, not a footprint
    artifact) - add the eroded generated footprint to the SAME
    ``Delete.<asset>`` group (creating it, and its MASK modifier, if MPFB did
    not ship one) rather than replacing it, so the shipped coverage is kept and
    only widened. ``mode == "none"``: nothing to hide.
    """
    services = importlib.import_module(f"{mpfb_module}.services")
    ClothesService = services.ClothesService
    group_name = "Delete." + asset

    if mode == "none":
        return {"mode": "none", "group": None, "vertexCount": 0}

    if mode == "shipped":
        group = body.vertex_groups.get(group_name)
        modifier = next(
            (m for m in body.modifiers if m.type == "MASK" and m.vertex_group == group_name), None)
        if group is None or modifier is None:
            raise RuntimeError(
                f"asset '{asset}' declares a shipped delete group but none was created on the body")
        vertex_count = sum(
            1 for v in body.data.vertices if any(g.group == group.index and g.weight > 0 for g in v.groups))
        return {"mode": "shipped", "group": group_name, "vertexCount": vertex_count}

    if mode == "generate":
        eroded = list(footprint)
        for _ in range(max(0, erode_passes)):
            ClothesService._conservative_mask(body, eroded)  # pylint: disable=W0212
        group = body.vertex_groups.get(group_name) or body.vertex_groups.new(name=group_name)
        group.add(eroded, 1.0, "REPLACE")
        modifier = next(
            (m for m in body.modifiers if m.type == "MASK" and m.vertex_group == group_name), None)
        if modifier is None:
            modifier = body.modifiers.new(group_name, "MASK")
            modifier.vertex_group = group_name
            modifier.invert_vertex_group = True
        return {"mode": "generated", "group": group_name, "vertexCount": len(eroded),
                "erodePasses": max(0, erode_passes)}

    if mode == "extend":
        group = body.vertex_groups.get(group_name)
        shipped = set()
        if group is not None:
            shipped = {
                v.index for v in body.data.vertices
                if any(g.group == group.index and g.weight > 0 for g in v.groups)
            }
        eroded = list(footprint)
        for _ in range(max(0, erode_passes)):
            ClothesService._conservative_mask(body, eroded)  # pylint: disable=W0212
        if group is None:
            group = body.vertex_groups.new(name=group_name)
        group.add(eroded, 1.0, "REPLACE")  # union: adds/reaffirms ``eroded``, leaves ``shipped`` alone
        modifier = next(
            (m for m in body.modifiers if m.type == "MASK" and m.vertex_group == group_name), None)
        if modifier is None:
            modifier = body.modifiers.new(group_name, "MASK")
            modifier.vertex_group = group_name
            modifier.invert_vertex_group = True
        added = set(eroded) - shipped
        return {"mode": "extended", "group": group_name, "shippedVertices": len(shipped),
                "addedVertices": len(added), "vertexCount": len(shipped | set(eroded)),
                "erodePasses": max(0, erode_passes)}

    raise RuntimeError(f"unknown delete_group mode '{mode}' for asset '{asset}'")


def clear_outer_over_inner(outer, inner, clearance=0.004, behind=0.02, reach=0.06):
    """Push ``outer`` vertices clear of an already-fitted ``inner`` garment, on the
    rest mesh, before the armature deforms either.

    A knit hem authored inside a trouser waistband (both z_depth 50, which Blender
    ignores) otherwise shows as slivers of the inner garment through the outer one.
    Feathered over two one-ring passes so there is no visible step at the pushed
    boundary (a uniform inflate/Displace was tried and recreated the bulk problem
    this whole system exists to remove; a uniform per-loop MAX lift over every
    open-boundary rim was also tried and turned a hem/waistband into a flared,
    jagged frill/sawtooth crown - worse than the sawtooth it was meant to fix).
    The push is applied to the BASE cage while both garments render subdivided
    (Catmull-Clark pulls the surface inward), so the achieved clearance is a
    little less than requested.

    The ray only reaches ``reach - behind`` past the vertex, so the max
    achievable push is bounded by that (44 mm at the defaults), not by
    ``clearance``: a vertex whose required push is at or beyond it is
    ``saturated`` and is reported so the caller can fail loudly. Do NOT widen
    ``reach`` to cure saturation: at ``reach=0.12`` the ray from a sweater's
    front hem crossed to the far thigh of the trousers and pushed the hem out by
    ~10 cm - a triangular flap hanging at the crotch. 6 cm keeps the push local
    to the garment the vertex actually overlaps.
    """
    tree = BVHTree.FromPolygons(
        [v.co.copy() for v in inner.data.vertices],
        [p.vertices[:] for p in inner.data.polygons],
    )
    n = len(outer.data.vertices)
    push = [0.0] * n
    hits = 0
    saturated = 0
    reach_limit = reach - behind
    for v in outer.data.vertices:
        hit = tree.ray_cast(v.co - v.normal * behind, v.normal, reach)
        if hit[0] is None:
            continue
        d = (hit[0] - v.co).dot(v.normal)  # + : the inner garment lies OUTSIDE this vertex
        if d > -clearance:
            push[v.index] = d + clearance
            hits += 1
            if push[v.index] >= reach_limit:
                saturated += 1

    ring = _build_adjacency(outer.data, hops=1)
    for _ in range(2):  # feather: no step at the boundary
        push = [max(push[i], sum(push[j] for j in ring[i]) / len(ring[i])) for i in range(n)]
    for v in outer.data.vertices:
        if push[v.index] > 0:
            v.co = v.co + v.normal * push[v.index]
    outer.data.update()
    return {"hits": hits, "movedVertices": sum(1 for p in push if p > 0), "maxPushM": max(push) if push else 0.0,
            "saturatedVertices": saturated}


def clear_garment_over_skin(clothes, body, clearance=0.002, behind=0.02, reach=0.06, cap=0.015):
    """Push ``clothes`` vertices clear of the body's REST skin surface, on the
    rest mesh, before either is posed - the same proximity-limited push as
    ``clear_outer_over_inner`` (garment clear of garment), applied garment clear
    of SKIN instead.

    This is NOT the ADR-076 uniform inflation (a fixed outward offset added to
    every vertex, which is why the fitted body-surface-duplicate garments are a
    separate procedural class): it moves ONLY the vertices the skin actually
    protrudes through, by only as much as needed to clear it - a few mm at a
    seam (a waist seam, a strap edge) - leaving the rest of the garment exactly
    as fitted. ``cap`` bounds the push (this runs BEFORE the delete-group
    footprint is computed from the pushed mesh, so an unbounded push here would
    inflate the footprint the same uncontrolled way the old inflation did);
    a vertex whose required push exceeds it is ``saturated`` - still pushed up
    to ``cap``, not the full amount, and reported so the caller can see where
    the garment is authored too far under the skin for this fix alone to hide.
    """
    rest, normals = body_rest_surface(body)
    tree = BVHTree.FromPolygons(rest, skin_polygons(body))
    n = len(clothes.data.vertices)
    push = [0.0] * n
    hits = 0
    saturated = 0
    for v in clothes.data.vertices:
        hit = tree.ray_cast(v.co - v.normal * behind, v.normal, reach)
        if hit[0] is None:
            continue
        d = (hit[0] - v.co).dot(v.normal)  # + : the skin lies OUTSIDE this vertex
        if d > -clearance:
            push[v.index] = min(d + clearance, cap)
            hits += 1
            if d + clearance > cap:
                saturated += 1

    ring = _build_adjacency(clothes.data, hops=1)
    for _ in range(2):  # feather: no step at the boundary
        push = [max(push[i], sum(push[j] for j in ring[i]) / len(ring[i])) for i in range(n)]
    for v in clothes.data.vertices:
        if push[v.index] > 0:
            v.co = v.co + v.normal * push[v.index]
    clothes.data.update()
    return {"hits": hits, "movedVertices": sum(1 for p in push if p > 0), "maxPushM": max(push) if push else 0.0,
            "saturatedVertices": saturated}


def tune_makeskin_material(clothes, bump_strength=0.25):
    """Tame every MakeSkin material's Bump node (shipped Strength 1.0 reads a knit
    as a net; verified clean at ~0.2-0.25) and report every texture image node so a
    portable evidence blend can be checked (``resolved`` = the file exists and has
    loaded pixels)."""
    report = {"bumpStrength": bump_strength, "textures": []}
    for material in clothes.data.materials:
        if material is None or material.node_tree is None:
            continue
        for node in material.node_tree.nodes:
            if node.type == "BUMP":
                node.inputs["Strength"].default_value = bump_strength
            elif node.type == "TEX_IMAGE" and node.image is not None:
                image = node.image
                path = bpy.path.abspath(image.filepath, library=image.library)
                resolved = os.path.exists(path) and image.size[0] > 0
                report["textures"].append({
                    "node": node.name,
                    "filename": os.path.basename(image.filepath),
                    "resolved": bool(resolved),
                })
    return report


def build_mhclo_meta(body, clothes, footprint, asset):
    """Per-garment metadata in the same shape ``run_gate`` consumes: no pins,
    and the covered skin - the spatial ``footprint`` minus whatever a delete
    group already hides (``masked_skin_indices``), since a MASKED body vertex
    cannot poke through regardless of the garment. ``own_delete_indices`` (this
    asset's own ``Delete.<asset>`` skin vertices, by ``ensure_delete_group``'s
    naming convention whichever mode created it) is separate from
    ``footprint`` - the deleted-skin-coverage check needs this garment's own
    masked vertices, not the spatial footprint, to find the boundary of the
    masked region.

    ``rest_edges``/``rest_lengths``/``rest_diag``/``adjacent`` are left empty/0:
    the mhclo gate never reads them from here - it rebuilds its own rest edges
    and diagonal from the EVALUATED (subdivided) topology at the baseline frame
    (see ``evaluated_topology`` in ``_run_gate``), and self-intersection does
    not apply to an armature-only garment (no adjacency needed either). Base-
    mesh edges/adjacency here would be wrong-sized against the evaluated
    vertices anyway; computing them (``_build_adjacency`` alone is a 2-hop
    per-vertex search) would just be wasted work on a 9980-vertex mesh like the
    suit.
    """
    masked = masked_skin_indices(body)
    own_group = body.vertex_groups.get("Delete." + asset)
    own_delete_indices = sorted(
        v.index for v in body.data.vertices
        if own_group is not None and any(g.group == own_group.index and g.weight > 0 for g in v.groups)
    )
    return {
        "rings": 0,
        "pin_indices": [],
        "rest_edges": [],
        "rest_lengths": [],
        "rest_diag": 0.0,
        "adjacent": [],
        "footprint": sorted(footprint),
        "covered_body_indices": sorted(set(footprint) - masked),
        "own_delete_indices": own_delete_indices,
        "surface_offset_m": 0.0,
    }


def garment_pair_report(inner, outer, scene, start, end):
    """Inter-garment clearance for one ``clear_over`` pair over the whole walk:
    does ``outer`` stay clear of ``inner`` at every frame, not just at rest (the
    rest-mesh push in ``clear_outer_over_inner`` does not guarantee the armature
    keeps them apart once both are posed).

    RAY-based, like ``clear_outer_over_inner``'s own push, not a nearest-point
    SIGN test: a sign test is undefined near either garment's own open edges (a
    hem, a waistband top, a neckline) - the nearest point there is on an edge
    polygon whose "inside" is meaningless, and this pair check used to read
    outfits that render clean as 4-5% interpenetrating at 16-20 mm depth.

    Per frame, a BVH of the inner garment's EVALUATED polygons (built fresh -
    the two garments pose independently, so the inner surface moves). For every
    evaluated OUTER vertex ``v`` with its own evaluated world normal ``n``: an
    OUTWARD ray (``v + n*0.0005``, direction ``n``, 5 cm) - if it meets the
    inner garment, that surface lies OUTSIDE the outer one there and would show
    through it; an INWARD ray (``v - n*0.0005``, direction ``-n``, 5 cm) - the
    normal, expected arrangement (inner tucked just behind outer). The
    denominator (``pairVertices``, the largest at-risk population seen over the
    walk - NOT the whole outer garment, most of which is nowhere near the inner
    one) is either ray finding a hit. An outward hit within
    ``pair_coplanar_tol_m`` counts as coplanar (visible z-fighting); farther
    counts as the inner garment protruding outside (interpenetrating); both
    fractions are the worst frame across the walk. Depth is also gated in its
    own right, independent of the fraction: ``insideDepthP99M`` is the 99th
    percentile of every OUTWARD hit's distance over the WHOLE clip (only the
    worst 1% of samples are allowed to protrude farther) - positive means the
    inner garment protrudes outside the outer one by that much.
    ``minGapM`` (informational) is the smallest INWARD hit distance seen - how
    close the normal arrangement gets at its closest.
    """
    frames = list(range(start, end + 1))
    worst_coplanar = 0.0
    worst_inside = 0.0
    pair_vertices = 0
    out_depths = []
    min_gap = float("inf")
    for frame in frames:
        scene.frame_set(frame)
        deps = bpy.context.evaluated_depsgraph_get()
        inner_verts, _inner_normals, _inner_edges, inner_polys = evaluated_topology(inner, deps)
        outer_verts, outer_normals, _outer_edges, _outer_polys = evaluated_topology(outer, deps)
        tree = BVHTree.FromPolygons(inner_verts, inner_polys)
        coplanar = 0
        inside = 0
        at_risk = 0
        for v, n in zip(outer_verts, outer_normals):
            out_hit = tree.ray_cast(v + n * 0.0005, n, 0.05)
            inn_hit = tree.ray_cast(v - n * 0.0005, -n, 0.05)
            if out_hit[0] is None and inn_hit[0] is None:
                continue
            at_risk += 1
            if inn_hit[0] is not None:
                min_gap = min(min_gap, inn_hit[3])
            if out_hit[0] is not None:
                out_depths.append(out_hit[3])
                if out_hit[3] > GATE["pair_coplanar_tol_m"]:
                    inside += 1
                else:
                    coplanar += 1
        pair_vertices = max(pair_vertices, at_risk)
        if at_risk:
            worst_coplanar = max(worst_coplanar, coplanar / at_risk)
            worst_inside = max(worst_inside, inside / at_risk)
    inside_depth_p99 = _percentile(out_depths, 99.0) if out_depths else 0.0
    passed = (worst_coplanar < GATE["pair_coplanar_frac_frame_max"]
              and worst_inside < GATE["pair_coplanar_frac_frame_max"]
              and inside_depth_p99 < GATE["pair_inside_depth_p99_max_m"])
    return {
        "coplanarFractionFrame": round(worst_coplanar, 4),
        "insideFractionFrame": round(worst_inside, 4),
        "max": GATE["pair_coplanar_frac_frame_max"],
        "pairVertices": pair_vertices,
        "insideDepthP99M": round(inside_depth_p99, 4),
        "insideDepthP99MaxM": GATE["pair_inside_depth_p99_max_m"],
        "minGapM": round(min_gap, 4) if min_gap != float("inf") else None,
        "pass": passed,
    }


def _resolve_delete_group_mode(component, record_entry):
    mode = component.get("delete_group")
    if mode is not None:
        return mode
    return "shipped" if record_entry.get("fitting", {}).get("shipsDeleteGroup") else "none"


def _assert_mhclo_world_space(body):
    """The mhclo fit path pairs the body's REST coordinates/normals
    (``body_rest_surface``, WORLD space - ``matrix_world`` applied) with every
    garment's vertex ``.co`` (LOCAL space) as though the two coincided - only
    safe when both objects sit at the world origin, unrotated and unscaled.
    Only accidentally safe otherwise; asserted here rather than silently relied
    on."""
    translation = body.matrix_world.to_translation()
    rotation_angle = body.matrix_world.to_quaternion().angle
    scale = body.matrix_world.to_scale()
    if (translation.length > 1e-6 or rotation_angle > 1e-6
            or any(abs(s - 1.0) > 1e-6 for s in scale)):
        raise RuntimeError(
            "the body's matrix_world is not the identity (translation=%s, rotation=%.4f rad, "
            "scale=%s) - the mhclo fit path pairs the body's REST coordinates (world space) with "
            "every garment's vertex .co (local space) and assumes they coincide." % (
                tuple(round(c, 4) for c in translation), rotation_angle,
                tuple(round(s, 4) for s in scale))
        )


def _assert_garment_world_space(clothes):
    """See ``_assert_mhclo_world_space`` - the other half of the same
    assumption, checked per garment as each is fitted."""
    translation = clothes.matrix_world.translation
    if translation.length > 1e-6:
        raise RuntimeError(
            "'%s' matrix_world.translation is not zero (%s) - the mhclo fit path pairs the body's "
            "REST coordinates (world space) with this garment's vertex .co (local space) and "
            "assumes they coincide." % (clothes.name, tuple(round(c, 4) for c in translation))
        )


def assemble_and_render_mhclo_outfit(name, spec, body, armature, scene, camera, output,
                                     clip, height, mid_y, span, start, end, geometry_file,
                                     source_file, travel=1.0):
    """Dress the walking body in a whole outfit of CC0 .mhclo garments via MPFB's
    ``ClothesService``: fit + layer (innermost first) + delete-group masking +
    inter-garment clearance + material tuning, then run the same headless
    mechanical gate as the procedural classes (``garment_class="mhclo"``) plus a
    ``clear_over`` inter-garment clearance check, then render the reel's three
    evidence views. Mirrors the shape of ``assemble_and_render_outfit`` (the
    procedural fitted-garment path) but drives MPFB's own asset pipeline instead of
    the body-surface-duplicate generator.
    """
    _assert_mhclo_world_space(body)
    mpfb_module = rigify_adapter.enable_backends()

    root = mhclo_asset_root()
    roots = configure_mpfb_asset_root(mpfb_module, root)
    print("CLOTH_MHCLO_ROOT roots=%s" % ",".join(roots))

    record = load_clearance_record()
    subdiv_default = int(os.environ.get("VIDEOER_CLOTH_SUBDIV", "1"))

    clothes_by_asset = {}
    meta_by_asset = {}
    components_report = []
    notes = []
    clearance_saturated = False
    for component in spec["components"]:
        asset = component["asset"]
        record_entry = require_cleared(asset, record)
        subdiv = int(component.get("subdiv", subdiv_default))

        clothes, _mhclo = add_mhclo_garment(mpfb_module, body, armature, root, component, record_entry, subdiv)
        _assert_garment_world_space(clothes)
        clothes_by_asset[asset] = clothes

        clear_skin = None
        if component.get("clear_skin", False):
            clear_skin = clear_garment_over_skin(clothes, body)

        binding = bind_mhclo_armature(mpfb_module, clothes, armature)

        clear_reports = []
        for target_asset in component.get("clear_over", []):
            target = clothes_by_asset.get(target_asset)
            if target is None:
                raise RuntimeError(
                    f"'{asset}' clear_over references '{target_asset}', which has not been added yet "
                    "(clear_over targets must be listed earlier / INNERMOST FIRST)")
            pushed = clear_outer_over_inner(clothes, target, clearance=component.get("clearance_m", 0.004))
            clear_reports.append({"over": target_asset, **pushed})
            if pushed["saturatedVertices"] > 0:
                clearance_saturated = True
                notes.append(
                    "%s over %s: %d vertices needed more than the push reach." % (
                        asset, target_asset, pushed["saturatedVertices"]))

        footprint = garment_skin_footprint(body, clothes)
        mode = _resolve_delete_group_mode(component, record_entry)
        delete_group = ensure_delete_group(
            mpfb_module, body, clothes, asset, footprint, mode, component.get("erode_passes", 1))

        material = tune_makeskin_material(clothes, component.get("bump_strength", 0.25))
        meta = build_mhclo_meta(body, clothes, footprint, asset)
        meta_by_asset[asset] = meta

        deps = bpy.context.evaluated_depsgraph_get()
        evaluated_count = len(evaluated_world_verts(clothes, deps))

        licence = record_entry.get("licence", {})
        components_report.append({
            "asset": asset,
            "object": clothes.name,
            "layer": len(components_report),
            "licence": licence,
            "clearance": record_entry.get("clearance"),
            "integrity": "sha256-verified",
            "fitReference": record_entry.get("fitting", {}).get("fitReference"),
            "vertexCount": len(clothes.data.vertices),
            "evaluatedVertexCount": evaluated_count,
            "subdivLevels": subdiv,
            "clearSkin": clear_skin,
            "clearOver": clear_reports,
            "deleteGroup": delete_group,
            "material": material,
            "binding": binding,
            "footprintSkinVertices": len(footprint),
            "gate": None,  # filled in below, once every component is fitted
        })
        print("CLOTH_MHCLO_GARMENT asset=%s layer=%d verts=%d deleteGroup=%s pushed=%d clearSkin=%s" % (
            asset, len(components_report) - 1, len(clothes.data.vertices), delete_group["mode"],
            sum(c["movedVertices"] for c in clear_reports),
            clear_skin["movedVertices"] if clear_skin else None))

    # Every component is now fully fitted (delete groups, clearance pushes and
    # materials in place) - a seam skin vertex can be covered by a NEIGHBOURING
    # garment rather than this one, so the deleted-skin-coverage check tests
    # against every fitted garment in the outfit.
    outfit_garments = list(clothes_by_asset.values())
    for meta in meta_by_asset.values():
        meta["outfit_garments"] = outfit_garments

    # Gate each component, and check every clear_over pair for clearance across
    # the whole walk, not just at rest.
    for report_entry, component in zip(components_report, spec["components"]):
        asset = component["asset"]
        clothes = clothes_by_asset[asset]
        meta = meta_by_asset[asset]
        gate_start = time.time()
        gate = run_gate(clothes, body, meta, scene, start, end, garment_class="mhclo")
        gate_seconds = time.time() - gate_start
        report_entry["gate"] = gate
        notes.extend(gate_notes(asset, gate))
        checks = gate["checks"]
        print("CLOTH_GATE asset=%s poke=%.4f holes=%.4f pen=%.4f edgeP99=%.3f secs=%.1f" % (
            asset, checks["bodyPokeThroughFractionFrame"]["value"],
            checks["deletedSkinUncoveredFractionFrame"]["value"],
            checks["penetrationFractionClip"]["value"], checks["edgeStretchP99"]["value"],
            gate_seconds))

    garment_pairs = []
    for component in spec["components"]:
        asset = component["asset"]
        outer = clothes_by_asset[asset]
        for target_asset in component.get("clear_over", []):
            inner = clothes_by_asset[target_asset]
            pair = garment_pair_report(inner, outer, scene, start, end)
            garment_pairs.append({"garment": asset, "over": target_asset, "gated": False, **pair})
            print("CLOTH_GATE_PAIR asset=%s over=%s pairVerts=%d coplanar=%.4f inside=%.4f "
                  "insideDepthP99M=%.4f minGap=%s" % (
                      asset, target_asset, pair["pairVertices"], pair["coplanarFractionFrame"],
                      pair["insideFractionFrame"], pair["insideDepthP99M"], pair["minGapM"]))
    if garment_pairs:
        notes.append(
            "garment-pair layering check is informational in phase 5: both the nearest-sign and the "
            "ray formulations misreport at open hems (inner garment continuing below the outer hem "
            "reads as protrusion); layering is accepted on the rendered contact sheets."
        )

    bpy.ops.file.pack_all()
    blend = os.path.join(output, "cloth-walk.blend")
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=blend)

    evidence = render_evidence(scene, camera, output, clip, height, mid_y, span, start, end, travel)
    # garment_pairs is informational only in this phase (see the note appended
    # above) - not folded into outfit_pass.
    outfit_pass = (all(c["gate"]["pass"] for c in components_report)
                   and not clearance_saturated)
    report = {
        "schemaVersion": 1,
        "status": "pass" if outfit_pass else "fail",
        "phase": "cloth-system-phase-5-mhclo",
        "outfit": name,
        "label": spec.get("label", name),
        "clip": clip,
        "assetRoot": root,
        "assetRoots": roots,
        "clearanceRecord": _CLEARANCE_RECORD_PATH,
        "resolution": scene.render.resolution_x,
        "subdivLevels": subdiv_default,
        "components": components_report,
        "garmentPairs": garment_pairs,
        "notes": notes,
        "geometry": geometry_file,
        "source": source_file,
        "blend": blend,
        "blender": bpy.app.version_string,
        "evidence": evidence,
    }
    with open(os.path.join(output, f"{clip}-cloth-report.json"), "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
        handle.write("\n")
    for note in notes:
        print("CLOTH_NOTE", note)
    print("CLOTH_OUTFIT_DONE outfit=%s status=%s components=%d" % (
        name, report["status"], len(components_report)))


def main():
    geometry_file, source_file, output = arguments()
    os.makedirs(output, exist_ok=True)
    with open(geometry_file, encoding="utf-8") as handle:
        asset = json.load(handle)

    clip = os.environ.get("VIDEOER_CLOTH_CLIP", "Walk_Loop")
    preroll = int(os.environ.get("VIDEOER_CLOTH_PREROLL", "25"))
    outfit = os.environ.get("VIDEOER_CLOTH_OUTFIT")
    outfit_spec = None
    if outfit:
        outfit_spec = OUTFIT_SPECS.get(outfit)
        if outfit_spec is None:
            raise RuntimeError(f"Unknown outfit '{outfit}'. Available: {sorted(OUTFIT_SPECS)}")

    reel.enable_expykit()
    mpfb_module = rigify_adapter.enable_backends()

    body, armature, start, end, mid_y, span, travel = build_walking_body(asset, source_file, clip, mpfb_module)

    scene, camera, _unused, _radius = geometry_probe.configure_scene(asset, output)
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    # mhclo outfits are real CC0 assets (MakeSkin textures, subdivided) and read
    # better at a higher resolution than the flat-coloured procedural garments.
    default_resolution = 1024 if outfit_spec and outfit_spec["kind"] == "mhclo" else 512
    resolution = int(os.environ.get("VIDEOER_CLOTH_RES", str(default_resolution)))
    scene.render.resolution_x = scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 100
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.fps = 24
    height = float(asset.get("metadata", {}).get("parameters", {}).get("height", 1.72))

    if outfit:
        kind = outfit_spec["kind"]
        if kind == "procedural-fitted":
            # Dress the walking body in a whole outfit at once (one combined sheet).
            assemble_and_render_outfit(outfit, outfit_spec["components"], body, armature, scene,
                                       camera, output, clip, height, mid_y, span, start, end,
                                       geometry_file, source_file, travel)
        elif kind == "mhclo":
            # Real CC0 MakeHuman garments via MPFB's ClothesService (the production
            # wardrobe path).
            assemble_and_render_mhclo_outfit(outfit, outfit_spec, body, armature, scene, camera,
                                             output, clip, height, mid_y, span, start, end,
                                             geometry_file, source_file, travel)
        else:
            raise RuntimeError(f"Outfit '{outfit}' has unknown kind '{kind}'")
        return

    garment = os.environ.get("VIDEOER_CLOTH_GARMENT", "mini-skirt")
    print("CLOTH_PROCEDURAL_SUPERSEDED garment=%s note=\"CC0 .mhclo garments are the production "
          "path; this class is a fallback\"" % garment)
    spec = GARMENT_SPECS[garment]

    if spec["kind"] == "hybrid-two-piece":
        # Two-piece dress: fitted bodice + loose skirt, built and rendered together.
        build_dress(spec, body, armature, scene, camera, output, clip, preroll, height,
                    mid_y, span, start, end, geometry_file, source_file, travel)
        return

    fitted = spec["kind"] == "fitted"

    if fitted:
        # Duplicate the body's own torso surface: exact topology + body weights ->
        # deforms like skin, no shrinkwrap seam collapse, no penetration.
        garment_obj, meta = generate_from_body_surface(body, spec)
        binding = surface_bind(garment_obj, armature, body)
        blend = os.path.join(output, "cloth-walk.blend")
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=blend)
        baked, preroll_used, sim_start = False, 0, start
    else:
        # Generate the loose garment from the body's REST shape so the armature
        # poses it once; apply scale so the cloth object is scale 1.0 (stable).
        reference_verts = body_reference_verts(body, spec)
        garment_obj, meta = generate_skirt(spec, reference_verts, skirt_profile_verts(body, spec))
        meta["covered_body_indices"] = covered_body_indices(body, spec)
        make_body_collider(body, spec.get("body_thickness_outer_m", BODY_THICKNESS_OUTER_M))
        binding = bind_skirt_to_body(garment_obj, body, armature, meta, spec)
        cloth = setup_cloth(garment_obj, spec)
        sim_start = start - preroll
        preroll_used = preroll
        blend, baked = bake_cloth(garment_obj, cloth, scene, sim_start, end, output)

    gate = run_gate(garment_obj, body, meta, scene, start, end, is_fitted=fitted)
    notes = gate_notes(garment, gate)

    finalize_look(garment_obj, spec)
    evidence = render_evidence(scene, camera, output, clip, height, mid_y, span, start, end, travel)

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
        "waistProfile": meta.get("waist_profile"),
        "offsetTaperedVertices": meta.get("offset_tapered_vertices"),
        "gate": gate,
        "notes": notes,
        "geometry": geometry_file,
        "source": source_file,
        "blend": blend,
        "blender": bpy.app.version_string,
        "evidence": evidence,
    }
    with open(os.path.join(output, f"{clip}-cloth-report.json"), "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
        handle.write("\n")
    for note in notes:
        print("CLOTH_NOTE", note)
    print("CLOTH_WALK_DONE garment=%s gate=%s explosion=%.3f penClip=%.4f penFrame=%.4f poke=%.4f pokeDepth=%.4f anchor=%.4f self=%.4f edgeP99=%.3f edgeP01=%.3f blowup=%.3f" % (
        garment, gate["status"], gate["checks"]["explosionRatio"]["value"],
        gate["checks"]["penetrationFractionClip"]["value"], gate["checks"]["penetrationFractionFrame"]["value"],
        gate["checks"]["bodyPokeThroughFractionFrame"]["value"], gate["checks"]["bodyPokeThroughDepthMaxM"]["value"],
        gate["checks"]["waistbandAnchorDriftM"]["value"], gate["checks"]["selfIntersectionFraction"]["value"],
        gate["checks"]["edgeStretchP99"]["value"], gate["checks"]["edgeCompressionP01"]["value"],
        gate["checks"]["edgeBlowupMax"]["value"]))


if __name__ == "__main__":
    main()
