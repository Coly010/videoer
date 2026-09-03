"""Retarget CC0 Quaternius (UE-mannequin) actions onto MPFB/Rigify via Expy Kit.

This is the productionised, provider-free retarget path validated in the
animation-approach evaluation (``docs/research/animation-approach-evaluation.md``):
it orchestrates the mature GPLv3 Expy Kit retargeter rather than hand-rolling
per-bone rest/roll math.  For each selected clip it

1. imports the immutable CC0 source FBX (Unreal Engine mannequin skeleton),
2. generates the MPFB hm08 + Rigify production human (ADR 074),
3. binds the Rigify control rig to the source with Expy Kit's preset bone map
   (``Rigify_Controls`` <- ``Unreal_Mannequin``) using ``match_transform='Bone'``
   so the control-vs-deform rest-pose offset is compensated — the setting that
   fixes the historically broken arm carriage,
4. bakes the constrained controls into a native Rigify action, and
5. renders fixed-camera evidence from three views - side, rear three-quarter
   (walker recedes) and front three-quarter (``three-quarter-reverse``: walker
   approaches, so the front is judged too) - as stills, mp4 and contact sheet,
   plus a ``report.json``.

Expy Kit code is GPL-3.0; the Quaternius source is CC0-1.0; both are fully local
and provider-free.  Rendered media is not thereby forced under the GPL.

Install / repair Expy Kit with ``scripts/install-expykit-extension.sh`` (pins the
commit under the repo-local ``.venv-blender``).

Usage::

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
      --python scripts/blender/render_expykit_action_reel.py \
      -- geometry.json source.fbx output-dir

Environment:
    VIDEOER_EXPYKIT_HOME     parent dir containing the ``expy_kit`` package
                             (default: repo-local ``.venv-blender``).
    VIDEOER_EXPYKIT_ACTIONS  comma-separated source clip names
                             (default: ``Walk_Loop``; e.g. ``Walk_Loop,Jog_Fwd_Loop``).
    VIDEOER_EXPYKIT_LEVEL_HEAD  ``1`` (default) keeps the neck/head upright by
                             excluding them from the retarget, which removes a
                             forward head/neck droop; ``0`` retargets them too.
"""

import importlib.util
import json
import math
import os
import subprocess
import sys

import bpy
from mathutils import Vector

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# Expy Kit presets: the Rigify control rig (to-bind / follower) and the Unreal
# Engine 4 mannequin (bind-to / active motion source).  The Quaternius UAL
# skeleton is the UE4 mannequin (spine_01/02/03, no metacarpals).
SRC_PRESET = "Rigify_Controls.py"   # applied to the to-bind armature (Rigify)
TRG_PRESET = "Unreal_Mannequin.py"  # applied to the active armature (source)

# Rigify controls whose retargeted lean produced a forward head/neck droop.
LEVEL_HEAD_CONTROLS = ("neck", "head")


def load_module(filename, name):
    """Load a sibling Blender helper module by path."""
    path = os.path.join(SCRIPT_DIR, filename)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


rigify_adapter = load_module("render_mpfb_motion_probe.py", "expykit_reel_rigify")
motion_probe = load_module("render_motion_probe.py", "expykit_reel_motion")
geometry_probe = motion_probe.geometry_probe


def expykit_home():
    """Resolve the parent dir of the ``expy_kit`` package (repo-relative)."""
    override = os.environ.get("VIDEOER_EXPYKIT_HOME")
    if override:
        return os.path.abspath(override)
    return os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..", ".venv-blender"))


def enable_expykit():
    home = expykit_home()
    package = os.path.join(home, "expy_kit")
    if not os.path.isdir(package):
        raise RuntimeError(
            f"Expy Kit is not installed at {package}. "
            "Run scripts/install-expykit-extension.sh first."
        )
    if home not in sys.path:
        sys.path.insert(0, home)
    import expy_kit  # noqa: E402 (path set above)

    expy_kit.register()
    commit = None
    try:
        commit = subprocess.check_output(
            ["git", "-C", package, "rev-parse", "HEAD"], text=True
        ).strip()
    except Exception:
        pass
    print(
        "VIDEOER_EXPYKIT_READY",
        ".".join(map(str, expy_kit.bl_info["version"])),
        "commit=%s" % commit,
    )
    return expy_kit, package, commit


def arguments():
    if "--" not in sys.argv:
        raise RuntimeError("Expected geometry, source FBX and output after --")
    values = sys.argv[sys.argv.index("--") + 1:]
    if len(values) != 3:
        raise RuntimeError(
            "Usage: render_expykit_action_reel.py -- geometry.json source.fbx output"
        )
    return tuple(os.path.abspath(value) for value in values)


def purge_actions():
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)


def import_source(source_file):
    """Import the CC0 source FBX; hide its mesh/lights/camera from renders."""
    bpy.ops.import_scene.fbx(filepath=source_file)
    armatures = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]
    if len(armatures) != 1:
        raise RuntimeError(f"Expected one source armature, found {len(armatures)}")
    source = armatures[0]
    for item in bpy.context.scene.objects:
        if item is source or item.type in {"MESH", "LIGHT", "CAMERA"}:
            item.hide_render = True
    return source


def select_only(objects, active):
    bpy.ops.object.mode_set(mode="OBJECT")
    for obj in bpy.context.scene.objects:
        obj.select_set(False)
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = active


def constrain_rigify_to_source(source, target):
    """Bind Rigify (to-bind / non-active) to the source (bind-to / active)."""
    select_only([source, target], active=source)
    bpy.ops.object.mode_set(mode="POSE")
    result = bpy.ops.armature.expykit_constrain_to_armature(
        "EXEC_DEFAULT",
        src_preset=SRC_PRESET,
        trg_preset=TRG_PRESET,
        match_transform="Bone",   # compensate control-vs-deform rest pose
        rot_constraints=True,
        loc_constraints=False,
        bind_by_name=False,
        bind_floating=True,
        constraint_policy="remove",
        constrain_root="Bone",
        root_motion_bone="pelvis",
        root_cp_loc_x=True,
        root_cp_loc_y=True,
        root_cp_loc_z=True,
    )
    if result != {"FINISHED"}:
        raise RuntimeError(f"Expy Kit constrain failed: {result}")
    return sorted(
        pb.name
        for pb in target.pose.bones
        if any(getattr(c, "subtarget", "").endswith("_RET") for c in pb.constraints)
    )


def level_head_neck(target, constrained):
    """Remove the Expy Kit constraints from neck/head so they stay upright.

    The retargeted neck FK lean stacked on top of the spine lean, producing a
    forward head/neck droop.  Dropping the neck/head bind keeps the head aligned
    with the (still-retargeted) torso instead of drooping further.
    """
    removed = []
    for name in LEVEL_HEAD_CONTROLS:
        pose_bone = target.pose.bones.get(name)
        if pose_bone is None:
            continue
        for constr in reversed(pose_bone.constraints):
            if getattr(constr, "subtarget", "").endswith("_RET"):
                pose_bone.constraints.remove(constr)
        pose_bone.matrix_basis.identity()
        if name in constrained:
            removed.append(name)
    return [name for name in constrained if name not in removed]


def bake_constrained(target, source, action, start, end, controls):
    """Drive the source with its action, then bake the constrained controls.

    Expy Kit's own headless bake leaves the source at rest; we assign the source
    action + slot (the reliable path) and bake the selected controls directly.
    """
    scene = bpy.context.scene
    scene.frame_start, scene.frame_end = start, end
    scene.render.fps = 24
    if source.animation_data is None:
        source.animation_data_create()
    source.animation_data.action = action
    if action.slots:
        source.animation_data.action_slot = action.slots[0]

    select_only([target], active=target)
    bpy.ops.object.mode_set(mode="POSE")
    for pose_bone in target.pose.bones:
        pose_bone.bone.select = pose_bone.name in controls
    scene.frame_set(start)
    bpy.ops.nla.bake(
        frame_start=start,
        frame_end=end,
        step=1,
        only_selected=True,
        visual_keying=True,
        clear_constraints=True,
        use_current_action=False,
        bake_types={"POSE"},
    )
    baked = target.animation_data.action if target.animation_data else None
    if baked is None:
        raise RuntimeError("nla.bake produced no baked action")
    return baked


# Evidence views rendered for every clip. The retargeted walks travel along +Y,
# so a camera on the -Y side sits BEHIND the walker: the original "three-quarter"
# only ever showed the back of the body (and of any garment - a tie or a skirt
# front was never in frame). "three-quarter-reverse" mirrors it to the far side
# of the travel so the walker approaches the camera and the front is judged too.
EVIDENCE_VIEWS = ("side", "three-quarter", "three-quarter-reverse")


def fixed_camera(scene, camera, height, view, mid_y, span, travel=1.0):
    """A fixed camera framing the whole travel (never glued to the root).

    ``view``:

    * ``side`` - profile from -X.
    * ``three-quarter`` - REAR three-quarter: behind the walker (against the
      direction of travel) and to the -X side; the walker recedes, showing the
      back of the body and garments.
    * ``three-quarter-reverse`` - FRONT three-quarter: ahead of the walker on the
      same -X side; the walker comes towards the camera, showing the face, chest,
      tie and skirt/dress front.

    ``travel`` is the sign of the root's Y travel over the clip (+1 = walks
    towards +Y); it decides which side of the travel is "ahead".
    """
    distance = max(4.6, span * 1.7)
    target = Vector((0, mid_y, height * 0.52))
    ahead = 1.0 if travel >= 0 else -1.0
    if view == "side":
        camera.location = Vector((-distance, mid_y, height * 0.56))
    elif view == "three-quarter-reverse":
        camera.location = Vector(
            (-distance * 0.78, mid_y + ahead * distance * 0.62, height * 0.58)
        )
    else:  # three-quarter (rear): behind the walker, -X side
        camera.location = Vector(
            (-distance * 0.78, mid_y - ahead * distance * 0.62, height * 0.58)
        )
    camera.data.lens = 40
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.animation_data_clear()


def contact_sheet(mp4_path, sheet_path, frames):
    """Tile a full-cycle contact sheet from the rendered mp4 via ffmpeg."""
    stride = max(1, round(frames / 11))
    try:
        subprocess.run(
            [
                "ffmpeg", "-y", "-loglevel", "error", "-i", mp4_path,
                "-vf",
                f"select='not(mod(n\\,{stride}))',scale=240:240,tile=6x2",
                "-frames:v", "1", sheet_path,
            ],
            check=True,
        )
        return sheet_path
    except (subprocess.CalledProcessError, FileNotFoundError) as error:
        print("Contact sheet skipped (ffmpeg):", error)
        return None


def process_clip(clip, asset, geometry_file, source_file, output, mpfb_module,
                 expy_info):
    expy_kit, package, commit = expy_info
    geometry_probe.clear_scene()
    purge_actions()

    source = import_source(source_file)
    actions = {a.name.rsplit("|", 1)[-1]: a for a in bpy.data.actions if "|" in a.name}
    action = actions.get(clip)
    if action is None:
        raise RuntimeError(
            f"Source clip '{clip}' not found. Available: {sorted(actions)}"
        )
    start, end = (round(v) for v in action.frame_range)
    # Keep animation_data present (bake assigns to it) but drop the reference so
    # Expy Kit's constrain does not run action_to_range on a dangling action.
    if source.animation_data is None:
        source.animation_data_create()
    source.animation_data.action = None

    target, mesh = rigify_adapter.create_rigged_human(
        mpfb_module, asset, clear_scene=False
    )
    target.name = "rigify_target"
    target.animation_data_clear()

    constrained = constrain_rigify_to_source(source, target)
    if os.environ.get("VIDEOER_EXPYKIT_LEVEL_HEAD", "1") == "1":
        controls = level_head_neck(target, constrained)
    else:
        controls = constrained
    baked = bake_constrained(target, source, action, start, end, controls)
    baked.name = f"videoer.expykit.{clip}"
    baked.use_fake_user = True

    scene = bpy.context.scene
    scene.frame_start, scene.frame_end = start, end
    scene.frame_set(start)
    bpy.context.view_layer.update()
    y0 = target.pose.bones["root"].matrix.translation.y
    scene.frame_set(end)
    bpy.context.view_layer.update()
    y1 = target.pose.bones["root"].matrix.translation.y
    mid_y = (y0 + y1) / 2.0
    span = abs(y1 - y0)
    travel = 1.0 if y1 >= y0 else -1.0

    bpy.data.objects.remove(source, do_unlink=True)
    scene, camera, _, _ = geometry_probe.configure_scene(asset, output)
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.image_settings.color_mode = "RGBA"
    scene.frame_start, scene.frame_end = start, end
    scene.render.fps = 24
    height = float(asset.get("metadata", {}).get("parameters", {}).get("height", 1.72))

    evidence = {"views": list(EVIDENCE_VIEWS), "stills": [], "videos": [], "contactSheets": []}
    for view in EVIDENCE_VIEWS:
        fixed_camera(scene, camera, height, view, mid_y, span, travel)
        scene.render.image_settings.file_format = "PNG"
        for frame in (start, (start + end) // 2, end):
            scene.frame_set(frame)
            still = os.path.join(output, f"{clip}-{view}-{frame:03d}.png")
            scene.render.filepath = still
            bpy.ops.render.render(write_still=True)
            evidence["stills"].append(still)
        mp4 = os.path.join(output, f"{clip}-{view}.mp4")
        motion_probe.render_animation(scene, output, os.path.basename(mp4))
        evidence["videos"].append(mp4)
        sheet = contact_sheet(
            mp4, os.path.join(output, f"{clip}-{view}-contact-sheet.png"),
            end - start + 1,
        )
        if sheet:
            evidence["contactSheets"].append(sheet)

    report = {
        "schemaVersion": 1,
        "status": "experimental-not-accepted",
        "retargeter": "expy-kit",
        "expykitVersion": ".".join(map(str, expy_kit.bl_info["version"])),
        "expykitCommit": commit,
        "expykitHome": package,
        "srcPreset": SRC_PRESET,
        "trgPreset": TRG_PRESET,
        "matchTransform": "Bone",
        "levelHead": os.environ.get("VIDEOER_EXPYKIT_LEVEL_HEAD", "1") == "1",
        "clip": clip,
        "bakedAction": baked.name,
        "constrainedControlCount": len(constrained),
        "bakedControlCount": len(controls),
        "constrainedControls": constrained,
        "frames": [start, end],
        "rootTravelY": round(span, 4),
        "geometry": geometry_file,
        "source": source_file,
        "blender": bpy.app.version_string,
        "evidence": evidence,
    }
    with open(os.path.join(output, f"{clip}-report.json"), "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
        handle.write("\n")
    print("EXPYKIT_CLIP_DONE clip=%s travel=%.3f controls=%d/%d"
          % (clip, span, len(controls), len(constrained)))
    return report


def main():
    geometry_file, source_file, output = arguments()
    os.makedirs(output, exist_ok=True)
    with open(geometry_file, encoding="utf-8") as handle:
        asset = json.load(handle)

    expy_info = enable_expykit()
    mpfb_module = rigify_adapter.enable_backends()
    clips = tuple(
        c.strip()
        for c in os.environ.get("VIDEOER_EXPYKIT_ACTIONS", "Walk_Loop").split(",")
        if c.strip()
    )
    reports = [
        process_clip(clip, asset, geometry_file, source_file, output, mpfb_module, expy_info)
        for clip in clips
    ]
    with open(os.path.join(output, "expykit-reel-report.json"), "w", encoding="utf-8") as handle:
        json.dump(
            {
                "schemaVersion": 1,
                "status": "experimental-not-accepted",
                "retargeter": "expy-kit",
                "clips": list(clips),
                "reports": reports,
            },
            handle,
            indent=2,
        )
        handle.write("\n")
    print("EXPYKIT_REEL_DONE clips=%s" % ",".join(clips))


if __name__ == "__main__":
    main()
