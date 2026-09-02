"""Bake CC0 Quaternius actions directly onto an MPFB/Rigify production rig.

This is deliberately separate from Videoer's 52-joint interchange skeleton.
It imports the provider's full source armature, transfers the available torso,
limb, hand, finger and toe animation onto animator-facing Rigify FK controls,
then saves/renders the MPFB body with only the baked Rigify action remaining.
"""

import importlib.util
import json
import os
import sys

import bpy
from mathutils import Vector


def load_module(filename, name):
    path = os.path.join(os.path.dirname(__file__), filename)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


motion_probe = load_module("render_motion_probe.py", "videoer_cc0_reel_motion_probe")
rigify_adapter = load_module("render_mpfb_motion_probe.py", "videoer_cc0_reel_rigify")
character_assembly = load_module("production_character_assembly.py", "videoer_cc0_reel_assembly")
geometry_probe = motion_probe.geometry_probe


def arguments():
    if "--" not in sys.argv:
        raise RuntimeError("Expected geometry, source FBX and output after --")
    values = sys.argv[sys.argv.index("--") + 1 :]
    if len(values) not in (3, 4):
        raise RuntimeError("Usage: render_cc0_rigify_action_reel.py -- geometry.json source.fbx output [character-binding.json]")
    return tuple(os.path.abspath(value) for value in values)


def key(pose_bone, frame, location=False):
    if location:
        pose_bone.keyframe_insert(data_path="location", frame=frame)
    pose_bone.keyframe_insert(data_path="rotation_quaternion", frame=frame)


def full_control_map():
    mapping = {
        "pelvis": "hips", "spine_01": "spine_fk", "spine_02": "spine_fk.001",
        "spine_03": "spine_fk.002", "neck_01": "neck", "Head": "head",
    }
    for source_side, target_side in (("l", "L"), ("r", "R")):
        mapping.update({
            f"clavicle_{source_side}": f"shoulder.{target_side}",
            f"upperarm_{source_side}": f"upper_arm_fk.{target_side}",
            f"lowerarm_{source_side}": f"forearm_fk.{target_side}",
            f"hand_{source_side}": f"hand_fk.{target_side}",
            f"thigh_{source_side}": f"thigh_fk.{target_side}",
            f"calf_{source_side}": f"shin_fk.{target_side}",
            f"foot_{source_side}": f"foot_fk.{target_side}",
            f"ball_{source_side}": f"toe_fk.{target_side}",
        })
        for source_finger, target_finger in (("index", "f_index"), ("middle", "f_middle"), ("ring", "f_ring"), ("pinky", "f_pinky")):
            for index in range(1, 4):
                mapping[f"{source_finger}_{index:02d}_{source_side}"] = f"{target_finger}.{index:02d}.{target_side}"
        for index in range(1, 4):
            mapping[f"thumb_{index:02d}_{source_side}"] = f"thumb.{index:02d}.{target_side}"
    return mapping


def configure_fk(armature):
    for side in ("L", "R"):
        parent = armature.pose.bones[f"thigh_parent.{side}"]
        parent["IK_FK"] = 1.0
        parent["IK_Stretch"] = 0.0
        armature.pose.bones[f"upper_arm_parent.{side}"]["IK_FK"] = 1.0


def import_source(source_file):
    bpy.ops.import_scene.fbx(filepath=source_file)
    arms = [item for item in bpy.context.scene.objects if item.type == "ARMATURE"]
    if len(arms) != 1:
        raise RuntimeError(f"Expected exactly one source armature, found {len(arms)}")
    source = arms[0]
    # The provider mannequin is source-only inspection geometry.  It remains
    # evaluated for the action but may never appear in production evidence.
    for item in bpy.context.scene.objects:
        if item is source or item.type in {"MESH", "LIGHT", "CAMERA"}:
            item.hide_render = True
    return source


def bake_action(source, target, source_action, target_name):
    ik_map = {
        "hand_l": "hand_ik.L", "lowerarm_l": "upper_arm_ik_target.L",
        "hand_r": "hand_ik.R", "lowerarm_r": "upper_arm_ik_target.R",
        "ball_l": "foot_ik.L", "calf_l": "thigh_ik_target.L",
        "ball_r": "foot_ik.R", "calf_r": "thigh_ik_target.R",
    }
    missing_source = [name for name in ["root", *ik_map] if source.pose.bones.get(name) is None]
    missing_target = [name for name in ["root", *ik_map.values()] if target.pose.bones.get(name) is None]
    if missing_source or missing_target:
        raise RuntimeError(f"Incomplete source IK adapter: source={missing_source}, target={missing_target}")
    source.animation_data_clear()
    scene = bpy.context.scene
    scene.frame_set(1)
    bpy.context.view_layer.update()
    source_rest = {name: source.pose.bones[name].matrix.translation.copy() for name in ["root", *ik_map]}
    source.animation_data_create()
    source.animation_data.action = source_action
    # Blender 4.5 imports each FBX take into a slotted action.  Selecting only
    # the action evaluates the armature's rest pose; selecting its object slot
    # is required before sampling any source transform.
    if source_action.slots:
        source.animation_data.action_slot = source_action.slots[0]
    target.animation_data_clear()
    target.animation_data_create()
    action = bpy.data.actions.new(target_name)
    target.animation_data.action = action
    for side in ("L", "R"):
        target.pose.bones[f"thigh_parent.{side}"]["IK_FK"] = 0.0
        target.pose.bones[f"thigh_parent.{side}"]["IK_Stretch"] = 0.0
        target.pose.bones[f"upper_arm_parent.{side}"]["IK_FK"] = 0.0
    target_rest = {name: target.pose.bones[name].matrix.copy() for name in ik_map.values()}
    start, end = (round(value) for value in source_action.frame_range)
    scene.frame_start, scene.frame_end = start, end
    scene.frame_set(start)
    bpy.context.view_layer.update()
    # Scale source motion from its ankle-to-hip span to the destination rig.
    source_scale = (source_rest["ball_l"] - source_rest["root"]).length or 1.0
    target_scale = (target_rest["foot_ik.L"].translation - target.pose.bones["root"].matrix.translation).length
    scale = target_scale / source_scale
    for frame in range(start, end + 1):
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        root = target.pose.bones["root"]
        root.rotation_mode = "QUATERNION"
        root_delta = (source.pose.bones["root"].matrix.translation - source_rest["root"]) * scale
        root.location = root_delta
        root.rotation_quaternion = (1, 0, 0, 0)
        key(root, frame, location=True)
        for source_name, control_name in ik_map.items():
            relative_rest = source_rest[source_name] - source_rest["root"]
            relative_pose = source.pose.bones[source_name].matrix.translation - source.pose.bones["root"].matrix.translation
            control = target.pose.bones[control_name]
            desired = target_rest[control_name].copy()
            desired.translation = target_rest[control_name].translation + root_delta + (relative_pose - relative_rest) * scale
            control.matrix = desired
            key(control, frame, location=True)
        for side in ("L", "R"):
            parent = target.pose.bones[f"thigh_parent.{side}"]
            parent.keyframe_insert(data_path='["IK_FK"]', frame=frame)
            parent.keyframe_insert(data_path='["IK_Stretch"]', frame=frame)
            target.pose.bones[f"upper_arm_parent.{side}"].keyframe_insert(data_path='["IK_FK"]', frame=frame)
    for curve in action.fcurves:
        for point in curve.keyframe_points:
            point.interpolation = "BEZIER"
    return {"sourceAction": source_action.name, "targetAction": action.name, "start": start, "end": end, "frames": end - start + 1, "nativeIkControls": len(ik_map), "sourceScale": scale}


def world_rotation(armature, pose_bone):
    """Pure world-space rotation of a pose bone, with any import scale stripped."""
    return (armature.matrix_world @ pose_bone.matrix).to_3x3().normalized()


def bake_action_world_fk(source, target, source_action, target_name):
    """Retarget every mapped source bone onto Rigify FK controls in world space.

    The original FK bake (v1) copied local ``matrix_basis`` rotation deltas.
    That silently assumes both skeletons share bone-axis conventions and rest
    poses, which the Quaternius mannequin and Rigify do not — limbs ended up in
    the wrong world orientation and the body floated.  The later IK-only bake
    fixed grounding but discarded all torso/arm/finger rotation, producing a
    mannequin posture.

    This mode keeps the good half of each: it transfers the *world-space*
    rotation change of every source bone relative to its own rest pose onto the
    matching Rigify control's rest orientation, and drives the root with the
    scaled world-space translation the IK bake used for grounding.
    """
    mapping = full_control_map()
    missing_source = [name for name in mapping if source.pose.bones.get(name) is None]
    missing_target = [name for name in mapping.values() if target.pose.bones.get(name) is None]
    if missing_source or missing_target:
        raise RuntimeError(f"Incomplete full-joint source adapter: source={missing_source}, target={missing_target}")
    scene = bpy.context.scene

    # Source rest, in world space, with no action assigned.
    source.animation_data_clear()
    scene.frame_set(1)
    bpy.context.view_layer.update()
    source_rest_rotation = {name: world_rotation(source, source.pose.bones[name]) for name in mapping}
    source_rest_root = (source.matrix_world @ source.pose.bones["root"].matrix).translation.copy()
    source_rest_ball = (source.matrix_world @ source.pose.bones["ball_l"].matrix).translation.copy()

    # Target rest, in world space, FK mode, identity pose.
    target.animation_data_clear()
    configure_fk(target)
    for pose_bone in target.pose.bones:
        pose_bone.matrix_basis.identity()
    bpy.context.view_layer.update()
    target_rest_rotation = {control: world_rotation(target, target.pose.bones[control]) for control in mapping.values()}
    target_rest_root = (target.matrix_world @ target.pose.bones["root"].matrix).translation.copy()
    target_rest_foot = (target.matrix_world @ target.pose.bones["foot_fk.L"].matrix).translation.copy()
    scale = (target_rest_foot - target_rest_root).length / ((source_rest_ball - source_rest_root).length or 1.0)
    target_world_inverse = target.matrix_world.to_3x3().normalized().inverted()

    source.animation_data_create()
    source.animation_data.action = source_action
    if source_action.slots:
        source.animation_data.action_slot = source_action.slots[0]
    target.animation_data_create()
    action = bpy.data.actions.new(target_name)
    target.animation_data.action = action
    start, end = (round(value) for value in source_action.frame_range)
    scene.frame_start, scene.frame_end = start, end

    # Only the armatures need evaluating while baking; keep the heavy skinned
    # meshes out of the depsgraph until rendering.
    meshes = [item for item in bpy.context.scene.objects if item.type == "MESH"]
    previous_visibility = {item.name: item.hide_viewport for item in meshes}
    for item in meshes:
        item.hide_viewport = True

    for frame in range(start, end + 1):
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        root = target.pose.bones["root"]
        root.rotation_mode = "QUATERNION"
        source_root_now = (source.matrix_world @ source.pose.bones["root"].matrix).translation
        root.location = target_world_inverse @ ((source_root_now - source_rest_root) * scale)
        root.rotation_quaternion = (1, 0, 0, 0)
        key(root, frame, location=True)
        bpy.context.view_layer.update()
        # ``full_control_map`` lists parents before children, so each control's
        # parent is already posed when its world matrix is read.
        for source_name, control_name in mapping.items():
            world_delta = world_rotation(source, source.pose.bones[source_name]) @ source_rest_rotation[source_name].inverted()
            desired_world = world_delta @ target_rest_rotation[control_name]
            control = target.pose.bones[control_name]
            control.rotation_mode = "QUATERNION"
            posed = (target_world_inverse @ desired_world).normalized().to_4x4()
            posed.translation = control.matrix.translation
            control.matrix = posed
            key(control, frame)
            bpy.context.view_layer.update()
        for side in ("L", "R"):
            parent = target.pose.bones[f"thigh_parent.{side}"]
            parent.keyframe_insert(data_path='["IK_FK"]', frame=frame)
            parent.keyframe_insert(data_path='["IK_Stretch"]', frame=frame)
            target.pose.bones[f"upper_arm_parent.{side}"].keyframe_insert(data_path='["IK_FK"]', frame=frame)

    for item in meshes:
        item.hide_viewport = previous_visibility[item.name]
    bpy.context.view_layer.update()
    for curve in action.fcurves:
        for point in curve.keyframe_points:
            point.interpolation = "BEZIER"
    return {"sourceAction": source_action.name, "targetAction": action.name, "start": start, "end": end, "frames": end - start + 1, "mappedControls": len(mapping), "sourceScale": scale}


def bake_action_local_fk_grounded(source, target, source_action, target_name):
    """Local-space FK rotation deltas (v1's method, which posed limbs plausibly)
    combined with the world-space scaled root translation the IK bake used to
    ground the body. v1 floated because it only copied the source root's local
    location; this drives the root with the same metre-scaled world travel that
    kept the IK feet on the floor, while keeping every limb's authored rotation.
    """
    mapping = full_control_map()
    missing_source = [name for name in mapping if source.pose.bones.get(name) is None]
    missing_target = [name for name in mapping.values() if target.pose.bones.get(name) is None]
    if missing_source or missing_target:
        raise RuntimeError(f"Incomplete full-joint source adapter: source={missing_source}, target={missing_target}")
    scene = bpy.context.scene

    source.animation_data_clear()
    scene.frame_set(1)
    bpy.context.view_layer.update()
    source_rest_basis = {name: source.pose.bones[name].matrix_basis.copy() for name in mapping}
    source_rest_root = (source.matrix_world @ source.pose.bones["root"].matrix).translation.copy()
    source_rest_ball = (source.matrix_world @ source.pose.bones["ball_l"].matrix).translation.copy()

    target.animation_data_clear()
    configure_fk(target)
    for pose_bone in target.pose.bones:
        pose_bone.matrix_basis.identity()
    bpy.context.view_layer.update()
    target_rest_root = (target.matrix_world @ target.pose.bones["root"].matrix).translation.copy()
    target_rest_foot = (target.matrix_world @ target.pose.bones["foot_fk.L"].matrix).translation.copy()
    scale = (target_rest_foot - target_rest_root).length / ((source_rest_ball - source_rest_root).length or 1.0)
    target_world_inverse = target.matrix_world.to_3x3().normalized().inverted()

    source.animation_data_create()
    source.animation_data.action = source_action
    if source_action.slots:
        source.animation_data.action_slot = source_action.slots[0]
    target.animation_data_create()
    action = bpy.data.actions.new(target_name)
    target.animation_data.action = action
    start, end = (round(value) for value in source_action.frame_range)
    scene.frame_start, scene.frame_end = start, end

    meshes = [item for item in bpy.context.scene.objects if item.type == "MESH"]
    previous_visibility = {item.name: item.hide_viewport for item in meshes}
    for item in meshes:
        item.hide_viewport = True

    for frame in range(start, end + 1):
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        root = target.pose.bones["root"]
        root.rotation_mode = "QUATERNION"
        source_root_now = (source.matrix_world @ source.pose.bones["root"].matrix).translation
        root.location = target_world_inverse @ ((source_root_now - source_rest_root) * scale)
        root.rotation_quaternion = (1, 0, 0, 0)
        key(root, frame, location=True)
        for source_name, control_name in mapping.items():
            delta = source_rest_basis[source_name].inverted() @ source.pose.bones[source_name].matrix_basis
            control = target.pose.bones[control_name]
            control.rotation_mode = "QUATERNION"
            control.rotation_quaternion = delta.to_quaternion()
            key(control, frame)
        for side in ("L", "R"):
            parent = target.pose.bones[f"thigh_parent.{side}"]
            parent.keyframe_insert(data_path='["IK_FK"]', frame=frame)
            parent.keyframe_insert(data_path='["IK_Stretch"]', frame=frame)
            target.pose.bones[f"upper_arm_parent.{side}"].keyframe_insert(data_path='["IK_FK"]', frame=frame)

    for item in meshes:
        item.hide_viewport = previous_visibility[item.name]
    bpy.context.view_layer.update()
    for curve in action.fcurves:
        for point in curve.keyframe_points:
            point.interpolation = "BEZIER"
    return {"sourceAction": source_action.name, "targetAction": action.name, "start": start, "end": end, "frames": end - start + 1, "mappedControls": len(mapping), "sourceScale": scale}


def bake_action_rest_compensated(source, target, source_action, target_name):
    """Rest-pose-compensated rotation retarget: the textbook fix for two rigs
    whose rest poses differ (Quaternius arms rest near-horizontal, Rigify arms
    rest ~45 deg down).  v13 copied local rotation deltas directly, which only
    holds when both rigs share a rest orientation — true enough for the legs,
    false for the arms, so the arm motion was applied in the wrong frame.

    For each bone the target's world rotation is  T_rest . S_rest^-1 . S_pose,
    i.e. the source bone's motion expressed in the *source's* own rest frame,
    then re-expressed in the *target's* rest frame.  Root translation stays the
    world-space metre-scaled travel that grounds the feet.
    """
    mapping = full_control_map()
    missing_source = [name for name in mapping if source.pose.bones.get(name) is None]
    missing_target = [name for name in mapping.values() if target.pose.bones.get(name) is None]
    if missing_source or missing_target:
        raise RuntimeError(f"Incomplete full-joint source adapter: source={missing_source}, target={missing_target}")
    scene = bpy.context.scene

    source.animation_data_clear()
    scene.frame_set(1)
    bpy.context.view_layer.update()
    source_rest_rotation = {name: world_rotation(source, source.pose.bones[name]) for name in mapping}
    source_rest_root = (source.matrix_world @ source.pose.bones["root"].matrix).translation.copy()
    source_rest_ball = (source.matrix_world @ source.pose.bones["ball_l"].matrix).translation.copy()

    target.animation_data_clear()
    configure_fk(target)
    for pose_bone in target.pose.bones:
        pose_bone.matrix_basis.identity()
    bpy.context.view_layer.update()
    target_rest_rotation = {control: world_rotation(target, target.pose.bones[control]) for control in mapping.values()}
    target_rest_root = (target.matrix_world @ target.pose.bones["root"].matrix).translation.copy()
    target_rest_foot = (target.matrix_world @ target.pose.bones["foot_fk.L"].matrix).translation.copy()
    scale = (target_rest_foot - target_rest_root).length / ((source_rest_ball - source_rest_root).length or 1.0)
    target_world_inverse = target.matrix_world.to_3x3().normalized().inverted()

    source.animation_data_create()
    source.animation_data.action = source_action
    if source_action.slots:
        source.animation_data.action_slot = source_action.slots[0]
    target.animation_data_create()
    action = bpy.data.actions.new(target_name)
    target.animation_data.action = action
    start, end = (round(value) for value in source_action.frame_range)
    scene.frame_start, scene.frame_end = start, end

    meshes = [item for item in bpy.context.scene.objects if item.type == "MESH"]
    previous_visibility = {item.name: item.hide_viewport for item in meshes}
    for item in meshes:
        item.hide_viewport = True

    root_start = None
    root_end = None
    for frame in range(start, end + 1):
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        root = target.pose.bones["root"]
        root.rotation_mode = "QUATERNION"
        source_root_now = (source.matrix_world @ source.pose.bones["root"].matrix).translation
        displacement = target_world_inverse @ ((source_root_now - source_rest_root) * scale)
        root.location = displacement
        root.rotation_quaternion = (1, 0, 0, 0)
        key(root, frame, location=True)
        bpy.context.view_layer.update()
        if frame == start:
            root_start = displacement.copy()
        if frame == end:
            root_end = displacement.copy()
        for source_name, control_name in mapping.items():
            source_pose = world_rotation(source, source.pose.bones[source_name])
            desired_world = target_rest_rotation[control_name] @ source_rest_rotation[source_name].inverted() @ source_pose
            control = target.pose.bones[control_name]
            control.rotation_mode = "QUATERNION"
            posed = (target_world_inverse @ desired_world).normalized().to_4x4()
            posed.translation = control.matrix.translation
            control.matrix = posed
            key(control, frame)
            bpy.context.view_layer.update()
        for side in ("L", "R"):
            parent = target.pose.bones[f"thigh_parent.{side}"]
            parent.keyframe_insert(data_path='["IK_FK"]', frame=frame)
            parent.keyframe_insert(data_path='["IK_Stretch"]', frame=frame)
            target.pose.bones[f"upper_arm_parent.{side}"].keyframe_insert(data_path='["IK_FK"]', frame=frame)

    for item in meshes:
        item.hide_viewport = previous_visibility[item.name]
    bpy.context.view_layer.update()
    for curve in action.fcurves:
        for point in curve.keyframe_points:
            point.interpolation = "BEZIER"
    travel = (root_end - root_start) if (root_start is not None and root_end is not None) else Vector()
    return {"sourceAction": source_action.name, "targetAction": action.name, "start": start, "end": end, "frames": end - start + 1, "mappedControls": len(mapping), "sourceScale": scale, "rootTravel": [round(travel.x, 4), round(travel.y, 4), round(travel.z, 4)]}


BAKE_MODES = {
    "ik-end-effectors": ("cc0-full-source-to-native-rigify-fk-v1", bake_action),
    "world-fk": ("cc0-world-space-fk-retarget-v12", bake_action_world_fk),
    "local-fk-grounded": ("cc0-local-fk-rotation-world-root-v13", bake_action_local_fk_grounded),
    "rest-compensated": ("cc0-rest-pose-compensated-retarget-v14", bake_action_rest_compensated),
}


def remove_source(source):
    bpy.data.objects.remove(source, do_unlink=True)
    for item in list(bpy.data.objects):
        if item.name in {"Mannequin", "Cube", "Light", "Camera"}:
            bpy.data.objects.remove(item, do_unlink=True)


def main():
    values = arguments()
    geometry_file, source_file, output = values[:3]
    binding_file = values[3] if len(values) == 4 else None
    os.makedirs(output, exist_ok=True)
    with open(geometry_file, encoding="utf-8") as handle:
        asset = json.load(handle)
    source = import_source(source_file)
    mpfb_module = rigify_adapter.enable_backends()
    target, mesh = rigify_adapter.create_rigged_human(mpfb_module, asset, clear_scene=False)
    assembly_report = None
    if binding_file:
        with open(binding_file, encoding="utf-8") as handle:
            binding = json.load(handle)
        profile_path = character_assembly.component_path(binding_file, binding["rigProfile"])
        with open(profile_path, encoding="utf-8") as handle:
            profile = json.load(handle)
        definition = {
            "id": binding["character"]["id"],
            "geometryPath": geometry_file,
            "productionRigProfilePath": profile_path,
            "productionCharacterBindingPath": binding_file,
        }
        _objects, assembly_report = character_assembly.assemble(
            definition, asset, target, mesh, profile, rigify_adapter.geometry_probe
        )
    scene, camera, _, _ = geometry_probe.configure_scene(asset, output)
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x, scene.render.resolution_y = 512, 512
    scene.render.resolution_percentage = 100
    scene.render.image_settings.color_mode = "RGBA"
    reports = []
    selected = tuple(os.environ.get("VIDEOER_CC0_REEL_ACTIONS", "Walk_Loop,Jog_Fwd_Loop,Interact").split(","))
    mode = os.environ.get("VIDEOER_CC0_REEL_MODE", "ik-end-effectors")
    if mode not in BAKE_MODES:
        raise RuntimeError(f"Unknown VIDEOER_CC0_REEL_MODE '{mode}'; expected one of {sorted(BAKE_MODES)}")
    authoring, bake = BAKE_MODES[mode]
    actions = {action.name.rsplit("|", 1)[-1]: action for action in bpy.data.actions if "|" in action.name}
    for clip in selected:
        source_action = actions.get(clip)
        if source_action is None:
            raise RuntimeError(f"Required CC0 source action unavailable: {clip}")
        report = bake(source, target, source_action, f"videoer.experimental.cc0-rigify.{clip}.v1")
        height = float(asset.get("metadata", {}).get("parameters", {}).get("height", 1.72))
        rigify_adapter.configure_mpfb_camera(scene, camera, height, 3.2, 2.2, -1, "three-quarter")
        scene.frame_set(report["start"])
        bpy.context.view_layer.update()
        camera_origin = camera.location.copy()
        camera_rotation = camera.rotation_euler.copy()
        root_origin = target.pose.bones["root"].matrix.translation.copy()
        for frame in range(report["start"], report["end"] + 1):
            scene.frame_set(frame)
            bpy.context.view_layer.update()
            camera.location = camera_origin + (target.pose.bones["root"].matrix.translation - root_origin)
            camera.rotation_euler = camera_rotation
            camera.keyframe_insert(data_path="location", frame=frame)
            camera.keyframe_insert(data_path="rotation_euler", frame=frame)
        scene.render.image_settings.file_format = "PNG"
        for frame in (report["start"], (report["start"] + report["end"]) // 2, report["end"]):
            scene.frame_set(frame)
            scene.render.filepath = os.path.join(output, f"{clip}-{frame:03d}.png")
            bpy.ops.render.render(write_still=True)
        motion_probe.render_animation(scene, output, f"cc0-rigify-{clip}.mp4")
        reports.append(report)
    remove_source(source)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(output, "cc0-rigify-action-reel.blend"))
    with open(os.path.join(output, "cc0-rigify-action-reel-report.json"), "w", encoding="utf-8") as handle:
        json.dump({"schemaVersion": 1, "status": "experimental-not-accepted", "authoring": authoring, "bakeMode": mode, "canonicalMotionUsed": False, "source": source_file, "geometry": geometry_file, "characterBinding": binding_file, "assembly": assembly_report, "blender": bpy.app.version_string, "actions": reports}, handle, indent=2)
        handle.write("\n")


if __name__ == "__main__":
    main()
