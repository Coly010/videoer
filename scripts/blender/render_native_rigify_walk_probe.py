"""Experimental native-control walk probe for MPFB's Rigify human-with-toes rig.

This intentionally does *not* load a Videoer canonical motion clip or use the
canonical-to-control map.  It proves the separate production-performance path:
an animator (or a deterministic procedural author) keys Rigify's high-level
controls and lets the generated 209-bone deform rig evaluate the body.

It is integration evidence only.  A passing render is not a publishable motion
release, and this Blender-native action is not cross-renderer portable.
"""

import importlib.util
import json
import math
import os
import sys

import bpy
from mathutils import Euler, Vector


def load_module(filename, name):
    path = os.path.join(os.path.dirname(__file__), filename)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


motion_probe = load_module("render_motion_probe.py", "videoer_native_walk_motion_probe")
rigify_adapter = load_module("render_mpfb_motion_probe.py", "videoer_native_walk_rigify")
geometry_probe = motion_probe.geometry_probe


def arguments():
    if "--" not in sys.argv:
        raise RuntimeError("Expected production geometry and output after --")
    values = sys.argv[sys.argv.index("--") + 1 :]
    if len(values) != 2:
        raise RuntimeError("Usage: render_native_rigify_walk_probe.py -- geometry.json output")
    return tuple(os.path.abspath(value) for value in values)


def key_transform(bone, frame):
    bone.keyframe_insert(data_path="location", frame=frame)
    if bone.rotation_mode == "QUATERNION":
        bone.keyframe_insert(data_path="rotation_quaternion", frame=frame)
    else:
        bone.keyframe_insert(data_path="rotation_euler", frame=frame)


def require_controls(armature):
    # These are animator-facing controls supplied by the generated Rigify rig,
    # not Videoer's reduced skeleton.  The feet use IK/pole/heel controls while
    # the arms deliberately use FK for an easy-to-audit pendulum and follow-through.
    names = [
        "root", "hips", "spine_fk.002", "chest", "neck", "head",
        "upper_arm_fk.L", "forearm_fk.L", "hand_fk.L", "upper_arm_parent.L",
        "upper_arm_fk.R", "forearm_fk.R", "hand_fk.R", "upper_arm_parent.R",
    ]
    for side in ("L", "R"):
        names += [
            f"thigh_parent.{side}", f"foot_ik.{side}", f"thigh_ik_target.{side}",
            f"foot_heel_ik.{side}", f"foot_spin_ik.{side}", f"toe_ik.{side}",
        ]
    missing = [name for name in names if armature.pose.bones.get(name) is None]
    if missing:
        raise RuntimeError("Generated Rigify rig lacks native walk controls: " + ", ".join(missing))
    return names


def set_rotation(bone, rotation):
    bone.rotation_mode = "XYZ"
    bone.rotation_euler = Euler(rotation, "XYZ")


def author_native_walk(armature, fps=24, frames=49):
    """Key a compact, editable Rigify control action.

    The model is deliberately a conservative first native-control authoring
    pass: fixed planted IK feet during stance, a raised/swinging target during
    swing, pelvis loading/release, torso counter-rotation, and delayed arm
    swing.  It is designed for visual review rather than claimed as mocap.
    """
    controls = require_controls(armature)
    scene = bpy.context.scene
    scene.frame_start, scene.frame_end = 1, frames
    scene.render.fps = fps
    armature.animation_data_clear()
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    if armature.mode != "POSE":
        bpy.ops.object.mode_set(mode="POSE")
    for side in ("L", "R"):
        parent = armature.pose.bones[f"thigh_parent.{side}"]
        parent["IK_FK"] = 0.0
        parent["IK_Stretch"] = 0.0
        arm_parent = armature.pose.bones[f"upper_arm_parent.{side}"]
        arm_parent["IK_FK"] = 1.0
    bpy.context.view_layer.update()
    rest = {name: armature.pose.bones[name].matrix.copy() for name in controls}
    # MPFB faces Blender -Y.  A 1.15 m/s pace travels 2.3 m in this two-second loop.
    travel = -2.3
    for frame in range(1, frames + 1):
        phase = (frame - 1) / (frames - 1)
        cycle = 2 * math.pi * phase
        scene.frame_set(frame)
        root = armature.pose.bones["root"]
        root.matrix = rest["root"].copy()
        root.matrix.translation.y += travel * phase
        root.matrix.translation.z += 0.011 * (1 - math.cos(2 * cycle))
        key_transform(root, frame)
        # Loading is carried by the pelvis, not merely a leg cycle.
        hips = armature.pose.bones["hips"]
        hips.location = (0.027 * math.sin(cycle), 0, -0.020 * math.cos(2 * cycle))
        set_rotation(hips, (0.055 * math.sin(2 * cycle), 0.035 * math.cos(cycle), -0.070 * math.sin(cycle)))
        key_transform(hips, frame)
        chest = armature.pose.bones["chest"]
        chest.location = (0, 0, 0)
        set_rotation(chest, (-0.018 * math.sin(2 * cycle), -0.016 * math.cos(cycle), 0.090 * math.sin(cycle)))
        key_transform(chest, frame)
        spine = armature.pose.bones["spine_fk.002"]
        set_rotation(spine, (0.015 * math.sin(2 * cycle), 0, 0.035 * math.sin(cycle)))
        key_transform(spine, frame)
        neck = armature.pose.bones["neck"]
        set_rotation(neck, (0.010 * math.sin(2 * cycle + 0.35), 0, -0.018 * math.sin(cycle)))
        key_transform(neck, frame)
        head = armature.pose.bones["head"]
        set_rotation(head, (-0.012 * math.sin(2 * cycle + 0.55), 0, -0.012 * math.sin(cycle)))
        key_transform(head, frame)
        for side, sign, offset in (("L", 1, 0.5), ("R", -1, 0.0)):
            local = (phase + offset) % 1.0
            # 0..0.60 is stance.  The target stays counter-moving in world
            # space, then advances with toe clearance in swing.
            stance = local < 0.60
            foot = armature.pose.bones[f"foot_ik.{side}"]
            foot.matrix = rest[f"foot_ik.{side}"].copy()
            if stance:
                foot.matrix.translation.y += -travel * phase
            else:
                swing = (local - 0.60) / 0.40
                foot.matrix.translation.y += -travel * phase + 0.56 * (swing - 0.5)
                foot.matrix.translation.z += 0.075 * math.sin(math.pi * swing)
            foot.matrix.translation.x += sign * 0.012 * math.sin(cycle)
            key_transform(foot, frame)
            pole = armature.pose.bones[f"thigh_ik_target.{side}"]
            pole.matrix = rest[f"thigh_ik_target.{side}"].copy()
            pole.matrix.translation.y += -travel * phase
            pole.matrix.translation.x += sign * 0.035
            key_transform(pole, frame)
            for name, pitch in ((f"foot_heel_ik.{side}", -0.17), (f"foot_spin_ik.{side}", 0.08), (f"toe_ik.{side}", 0.11)):
                control = armature.pose.bones[name]
                set_rotation(control, (pitch * (0 if stance else math.sin(math.pi * ((local - 0.60) / 0.40))), 0, 0))
                key_transform(control, frame)
            parent = armature.pose.bones[f"thigh_parent.{side}"]
            parent.keyframe_insert(data_path='["IK_FK"]', frame=frame)
            parent.keyframe_insert(data_path='["IK_Stretch"]', frame=frame)
        # Arms have a small shoulder-led pendulum, elbow delay, and wrist follow-through.
        for side, sign in (("L", 1), ("R", -1)):
            arm_phase = cycle + (0 if side == "L" else math.pi)
            upper = armature.pose.bones[f"upper_arm_fk.{side}"]
            set_rotation(upper, (0.10 * math.sin(arm_phase - 0.22), sign * 0.045, sign * 0.025 * math.sin(arm_phase)))
            key_transform(upper, frame)
            forearm = armature.pose.bones[f"forearm_fk.{side}"]
            set_rotation(forearm, (0.18 + 0.060 * math.sin(arm_phase - 0.56), 0, sign * 0.025))
            key_transform(forearm, frame)
            hand = armature.pose.bones[f"hand_fk.{side}"]
            set_rotation(hand, (0.035 * math.sin(arm_phase - 0.9), 0, sign * 0.035 * math.sin(arm_phase - 0.7)))
            key_transform(hand, frame)
            armature.pose.bones[f"upper_arm_parent.{side}"].keyframe_insert(data_path='["IK_FK"]', frame=frame)
        bpy.context.view_layer.update()
    for curve in armature.animation_data.action.fcurves:
        for point in curve.keyframe_points:
            point.interpolation = "BEZIER"
    armature.animation_data.action.name = "videoer.experimental.native-rigify-walk.v1"
    return {"fps": fps, "frames": frames, "durationSeconds": (frames - 1) / fps, "rootTravelMeters": abs(travel), "controls": controls}


def render_stills(scene, camera, output, height, travel):
    names = []
    for view in ("side", "three-quarter", "front"):
        rigify_adapter.configure_mpfb_camera(scene, camera, height, 3.5, travel, -1, view)
        for frame in (1, 13, 25, 37):
            scene.frame_set(frame)
            path = os.path.join(output, f"{view}-{frame:03d}.png")
            scene.render.filepath = path
            bpy.ops.render.render(write_still=True)
            names.append(path)
    return names


def main():
    geometry_file, output = arguments()
    os.makedirs(output, exist_ok=True)
    with open(geometry_file, encoding="utf-8") as handle:
        asset = json.load(handle)
    mpfb_module = rigify_adapter.enable_backends()
    armature, mesh = rigify_adapter.create_rigged_human(mpfb_module, asset)
    scene, camera, _, _ = geometry_probe.configure_scene(asset, output)
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = scene.render.resolution_y = 384
    scene.render.resolution_percentage = 100
    scene.render.image_settings.color_mode = "RGBA"
    report = author_native_walk(armature)
    height = float(asset.get("metadata", {}).get("parameters", {}).get("height", 1.72))
    stills = render_stills(scene, camera, output, height, report["rootTravelMeters"])
    for view in ("side", "three-quarter", "front"):
        rigify_adapter.configure_mpfb_camera(scene, camera, height, 3.5, report["rootTravelMeters"], -1, view)
        motion_probe.render_animation(scene, output, f"native-rigify-walk-{view}.mp4")
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(output, "native-rigify-walk.blend"))
    with open(os.path.join(output, "native-rigify-walk-report.json"), "w", encoding="utf-8") as handle:
        json.dump({"schemaVersion": 1, "status": "experimental-not-accepted", "authoring": "direct-rigify-controls-v1", "canonicalMotionUsed": False, "geometry": geometry_file, "stills": stills, "mpfbModule": mpfb_module, "blender": bpy.app.version_string, **report}, handle, indent=2)
        handle.write("\n")


if __name__ == "__main__":
    main()
