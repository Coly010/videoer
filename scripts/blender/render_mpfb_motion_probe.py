"""Render a Videoer canonical motion through MPFB's Rigify human-with-toes rig.

The source geometry and motion remain renderer-independent. This script is an
experimental Blender backend adapter used to compare the mature OSS rig against
Videoer's reduced canonical deformation rig with the *same* persisted motion.
"""

import bpy
import importlib
import importlib.util
import json
import math
import os
import sys
from mathutils import Matrix, Vector


def load_motion_probe_module():
    path = os.path.join(os.path.dirname(__file__), "render_motion_probe.py")
    spec = importlib.util.spec_from_file_location("videoer_motion_probe", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


motion_probe = load_motion_probe_module()
geometry_probe = motion_probe.geometry_probe


def percentile(values, amount):
    if not values:
        raise RuntimeError("Cannot sample an empty MPFB surface region")
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(len(ordered) * amount))]


def arguments():
    if "--" not in sys.argv:
        raise RuntimeError("Expected geometry, motion, and output after --")
    values = sys.argv[sys.argv.index("--") + 1 :]
    if len(values) not in (3, 4):
        raise RuntimeError(
            "Usage: render_mpfb_motion_probe.py -- geometry.json motion.json output [rig-profile.json]"
        )
    default_profile = os.path.abspath(
        os.path.join(
            os.path.dirname(__file__),
            "../../assets/rig-profiles/mpfb-rigify-human-toes-v1.json",
        )
    )
    return [os.path.abspath(value) for value in values[:3]] + [
        os.path.abspath(values[3]) if len(values) == 4 else default_profile
    ]


def enable_backends():
    if bpy.ops.preferences.addon_enable(module="rigify") != {"FINISHED"}:
        raise RuntimeError("Blender's bundled Rigify addon could not be enabled")
    mpfb_module = next(
        (name for name in bpy.context.preferences.addons.keys() if name.endswith(".mpfb")),
        "bl_ext.user_default.mpfb",
    )
    if mpfb_module not in bpy.context.preferences.addons:
        if bpy.ops.preferences.addon_enable(module=mpfb_module) != {"FINISHED"}:
            raise RuntimeError(
                "MPFB is not installed. Run scripts/install-mpfb-extension.sh first."
            )
    return mpfb_module


def canonical_to_rigify_map(profile, asset):
    mapping = profile["canonicalToControl"]
    missing_source = sorted(set(mapping) - {joint["id"] for joint in asset["skeleton"]})
    if missing_source:
        raise RuntimeError(f"Canonical mapping references absent joints: {missing_source}")
    if len(mapping) != len(asset["skeleton"]):
        raise RuntimeError(
            "Rig profile must map the complete ordered canonical production skeleton"
        )
    return mapping


def create_rigged_human(mpfb_module_name, asset, clear_scene=True):
    services = importlib.import_module(f"{mpfb_module_name}.services")
    HumanService = services.HumanService
    RigService = services.RigService
    if clear_scene:
        geometry_probe.clear_scene()
    height = float(asset.get("metadata", {}).get("parameters", {}).get("height", 1.72))
    # MPFB's bundled source is the same 16.9455-unit hm08 OBJ pinned by Videoer.
    mesh = HumanService.create_human(
        mask_helpers=True,
        detailed_helpers=True,
        extra_vertex_groups=True,
        feet_on_ground=True,
        scale=height / 16.9455,
    )
    metarig = HumanService.add_builtin_rig(
        mesh, "rigify.human_toes", import_weights=True
    )
    if metarig is None:
        raise RuntimeError("MPFB did not create the Rigify human-with-toes metarig")
    armature = RigService.generate_rigify_rig(metarig, meta_rig_action="delete")
    if armature is None:
        raise RuntimeError("Rigify rejected MPFB's human-with-toes metarig")
    armature.name = "videoer-mpfb-rigify"
    mesh.name = "videoer-mpfb-human"
    for material in mesh.data.materials:
        material.diffuse_color = (0.56, 0.34, 0.24, 1.0)
        material.roughness = 0.52
    if not mesh.data.materials:
        material = bpy.data.materials.new("videoer-skin")
        material.diffuse_color = (0.56, 0.34, 0.24, 1.0)
        material.roughness = 0.52
        mesh.data.materials.append(material)
    for pose_bone in armature.pose.bones:
        if "IK_FK" in pose_bone:
            pose_bone["IK_FK"] = 1.0
    bpy.context.view_layer.update()
    return armature, mesh


def keyframe_pose_bone(pose_bone, frame):
    pose_bone.keyframe_insert(data_path="location", frame=frame)
    if pose_bone.rotation_mode == "QUATERNION":
        pose_bone.keyframe_insert(data_path="rotation_quaternion", frame=frame)
    elif pose_bone.rotation_mode == "AXIS_ANGLE":
        pose_bone.keyframe_insert(data_path="rotation_axis_angle", frame=frame)
    else:
        pose_bone.keyframe_insert(data_path="rotation_euler", frame=frame)
    pose_bone.keyframe_insert(data_path="scale", frame=frame)


def apply_canonical_motion(
    armature,
    asset,
    motion,
    fps,
    profile,
    scene_start_seconds=0,
    scene_end_seconds=None,
    source_start_seconds=0,
    source_end_seconds=None,
    endpoint_on_last_frame=False,
):
    mapping = canonical_to_rigify_map(profile, asset)
    absent = sorted(name for name in mapping.values() if armature.pose.bones.get(name) is None)
    if absent:
        raise RuntimeError(f"Generated Rigify rig lacks mapped controls: {absent}")
    tracks = {
        (track["joint"], track["property"]): track for track in motion["tracks"]
    }
    # MPFB imports the MakeHuman body facing Blender -Y. This differs from the
    # generic Videoer-created armature, whose conversion faces +Y. The backend
    # profile owns that distinction explicitly: using the generic transform
    # here made root travel oppose the face and reversed the rest forearm's
    # front/back component, manufacturing a guarded elbow pose.
    canonical_to_blender = Matrix(profile["transfer"]["coordinateConversion"]["matrix"])
    blender_to_canonical = canonical_to_blender.inverted()
    rest_world = motion_probe.canonical_world_matrices(asset, {})
    alignment = {}
    for canonical, rigify in mapping.items():
        converted = canonical_to_blender @ rest_world[canonical] @ blender_to_canonical
        alignment[canonical] = converted.inverted() @ armature.data.bones[rigify].matrix_local

    scene = bpy.context.scene
    scene.frame_start = 1
    uses_motion_duration = scene_end_seconds is None
    if uses_motion_duration:
        scene_end_seconds = motion["durationSeconds"]
    if source_end_seconds is None:
        source_end_seconds = motion["durationSeconds"]
    if scene_end_seconds <= scene_start_seconds:
        raise RuntimeError("Rigify motion scene interval must be positive")
    if source_end_seconds <= source_start_seconds:
        raise RuntimeError("Rigify motion source interval must be positive")
    start_frame = round(scene_start_seconds * fps) + 1
    end_frame = (
        round(scene_end_seconds * fps)
        if endpoint_on_last_frame
        else round(scene_end_seconds * fps) + 1
    )
    scene.frame_end = end_frame if uses_motion_duration else max(scene.frame_end, end_frame)
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="POSE")
    snap_operator_name = next(
        (
            name
            for name in dir(bpy.ops.pose)
            if name.startswith("rigify_limb_ik2fk_") and not name.endswith("_bake")
        ),
        None,
    )
    if snap_operator_name is None:
        raise RuntimeError("Generated Rigify rig did not register its IK-to-FK snap operator")
    snap_operator = getattr(bpy.ops.pose, snap_operator_name)
    for frame in range(start_frame, end_frame + 1):
        for side in ("L", "R"):
            parent = armature.pose.bones[f"thigh_parent.{side}"]
            parent["IK_FK"] = 1.0
            parent["IK_Stretch"] = 0.0
        if endpoint_on_last_frame:
            progress = (frame - start_frame) / max(1, end_frame - start_frame)
        else:
            scene_seconds = min((frame - 1) / fps, scene_end_seconds)
            progress = (scene_seconds - scene_start_seconds) / (
                scene_end_seconds - scene_start_seconds
            )
        seconds = source_start_seconds + max(0, min(1, progress)) * (
            source_end_seconds - source_start_seconds
        )
        sampled = {
            key: motion_probe.sample_track(track, seconds) for key, track in tracks.items()
        }
        animated = motion_probe.canonical_world_matrices(asset, sampled)
        # Parent controls first, then limbs/fingers. Assigning complete world
        # matrices preserves Videoer's motion semantics despite different bone
        # axes, roll, and intermediary Rigify mechanisms.
        for canonical, rigify in mapping.items():
            pose_bone = armature.pose.bones[rigify]
            pose_bone.rotation_mode = "QUATERNION"
            desired = (
                canonical_to_blender
                @ animated[canonical]
                @ blender_to_canonical
                @ alignment[canonical]
            )
            # Rigify's controls are not a one-for-one hierarchy with the
            # canonical deform chain. Copying canonical head positions into
            # them stretches MCH/DEF constraints (most visibly the fingers).
            # Preserve the generated rig's own evaluated control head and
            # transfer the complete world orientation. Root is the sole
            # translation channel in the walk contract and remains explicit.
            if canonical not in profile["transfer"]["translationJoints"]:
                desired.translation = pose_bone.matrix.translation
            pose_bone.matrix = desired
            bpy.context.view_layer.update()
            keyframe_pose_bone(pose_bone, frame)
        bpy.context.view_layer.update()
        # Canonical orientations are first evaluated through the generated FK
        # controls. Rigify's own snap operator then derives its IK controls
        # from that complete pose. This retains the source motion while making
        # the legs available to the contact solver; translating an FK foot
        # would disconnect it from the shin instead of solving the chain.
        for side in ("L", "R"):
            snap_operator(
                prop_bone=f"thigh_parent.{side}",
                fk_bones=json.dumps(
                    [
                        f"thigh_fk.{side}",
                        f"shin_fk.{side}",
                        f"foot_fk.{side}",
                        f"toe_fk.{side}",
                    ]
                ),
                ik_bones=json.dumps(
                    [
                        f"thigh_ik.{side}",
                        f"MCH-shin_ik.{side}",
                        f"MCH-thigh_ik_target.{side}",
                    ]
                ),
                ctrl_bones=json.dumps(
                    [f"thigh_ik.{side}", f"thigh_ik_target.{side}", f"foot_ik.{side}"]
                ),
                tail_bones=json.dumps([f"toe_ik.{side}"]),
                extra_ctrls=json.dumps([f"foot_heel_ik.{side}", f"foot_spin_ik.{side}"]),
            )
            parent = armature.pose.bones[f"thigh_parent.{side}"]
            parent["IK_FK"] = 0.0
            parent.keyframe_insert(data_path='["IK_FK"]', frame=frame)
            parent.keyframe_insert(data_path='["IK_Stretch"]', frame=frame)
            for control in (
                f"thigh_ik.{side}",
                f"thigh_ik_target.{side}",
                f"foot_ik.{side}",
                f"toe_ik.{side}",
                f"foot_heel_ik.{side}",
                f"foot_spin_ik.{side}",
            ):
                pose_bone = armature.pose.bones[control]
                keyframe_pose_bone(pose_bone, frame)
        bpy.context.view_layer.update()
    if armature.animation_data and armature.animation_data.action:
        for curve in armature.animation_data.action.fcurves:
            for point in curve.keyframe_points:
                point.interpolation = "LINEAR"
    canonical_forward = canonical_to_blender @ Vector((0, 0, -1, 0))
    return mapping, canonical_forward.y


def ground_final_mesh(armature, mesh, scene, height, motion):
    body_group = mesh.vertex_groups.get("body")
    if body_group is None:
        raise RuntimeError("MPFB basemesh lacks its authored body vertex group")
    body_vertices = [
        vertex.index
        for vertex in mesh.data.vertices
        if any(group.group == body_group.index and group.weight > 0 for group in vertex.groups)
    ]
    if not body_vertices:
        raise RuntimeError("MPFB body vertex group contains no vertices")
    rest_floor = min(mesh.data.vertices[index].co.z for index in body_vertices)
    sole_vertices = [
        index
        for index in body_vertices
        if mesh.data.vertices[index].co.z <= rest_floor + height * 0.025
    ]
    if len(sole_vertices) < 20:
        raise RuntimeError("MPFB final-mesh sole cluster is too small to ground reliably")
    rest_world = {
        index: mesh.matrix_world @ mesh.data.vertices[index].co for index in sole_vertices
    }
    side_regions = {}
    for side, sign in (("left", 1), ("right", -1)):
        side_sole = [
            index
            for index in sole_vertices
            if rest_world[index].x * sign > 0
        ]
        if len(side_sole) < 20:
            raise RuntimeError(f"MPFB {side} sole cluster is too small")
        minimum_forward = min(rest_world[index].y for index in side_sole)
        maximum_forward = max(rest_world[index].y for index in side_sole)
        span = maximum_forward - minimum_forward
        # MPFB's authored human faces Blender -Y. The rear heel is therefore
        # the high-Y end and the forefoot is the low-Y end. This classification
        # is independent of the canonical-to-backend motion transform.
        heel = [
            index
            for index in side_sole
            if rest_world[index].y >= maximum_forward - span * 0.3
        ]
        forefoot = [
            index
            for index in side_sole
            if rest_world[index].y <= minimum_forward + span * 0.3
        ]
        if len(heel) < 3 or len(forefoot) < 3:
            raise RuntimeError(f"MPFB {side} heel/forefoot regions are incomplete")
        side_regions[side] = {"heel": heel, "forefoot": forefoot}
    topology_modifiers = [
        modifier
        for modifier in mesh.modifiers
        if modifier.type == "MASK" and modifier.show_viewport
    ]
    for modifier in topology_modifiers:
        modifier.show_viewport = False
    depsgraph = bpy.context.evaluated_depsgraph_get()

    def evaluated_positions():
        bpy.context.view_layer.update()
        evaluated = mesh.evaluated_get(depsgraph)
        if len(evaluated.data.vertices) != len(mesh.data.vertices):
            raise RuntimeError("MPFB grounding requires topology-preserving evaluated modifiers")
        return {
            index: (evaluated.matrix_world @ evaluated.data.vertices[index].co)
            for index in sole_vertices
        }

    def surface_floor():
        positions = evaluated_positions()
        return min(positions[index].z for index in sole_vertices)

    def region_surface_height(side, region):
        positions = evaluated_positions()
        return percentile(
            [positions[index].z for index in side_regions[side][region]], 0.02
        )

    def sole_lateral_centre(side):
        positions = evaluated_positions()
        indices = set(side_regions[side]["heel"] + side_regions[side]["forefoot"])
        return sum(positions[index].x for index in indices) / len(indices)

    contact_model = motion.get("metadata", {}).get("footContactModel")
    if not contact_model or not contact_model.get("localPhase"):
        raise RuntimeError("MPFB contact-aware retargeting requires local foot-contact metadata")
    walking_base = motion.get("metadata", {}).get("walkingBase")
    if not walking_base or walking_base.get("normalization") != "character-height-v1":
        raise RuntimeError("MPFB lateral verification requires height-normalized walking-base metadata")
    target_step_width = float(walking_base["targetStepWidthMeters"])

    def active_region(side, frame):
        frame_span = scene.frame_end - scene.frame_start
        global_phase = ((frame - scene.frame_start) / frame_span) % 1
        local_phase = (global_phase - (0.5 if side == "left" else 0)) % 1
        if local_phase < contact_model["heel"][1]:
            return "heel"
        if local_phase < contact_model["flat"][1]:
            return "flat"
        if local_phase < contact_model["forefoot"][1]:
            return "forefoot"
        return None

    root = armature.pose.bones["root"]
    samples = []
    for frame in range(scene.frame_start, scene.frame_end + 1):
        scene.frame_set(frame)
        before = surface_floor()
        corrected = root.matrix.copy()
        corrected.translation.z -= before
        root.matrix = corrected
        bpy.context.view_layer.update()
        active_contacts = {}
        # Resolve simultaneous leading-heel and trailing-forefoot support in
        # IK space. Two short passes account for the coupled root/leg update;
        # the final global solve below remains the penetration authority.
        for _ in range(2):
            for side, suffix in (("left", "L"), ("right", "R")):
                region = active_region(side, frame)
                if region is None:
                    continue
                if region == "flat":
                    contact_height = min(
                        region_surface_height(side, "heel"),
                        region_surface_height(side, "forefoot"),
                    )
                else:
                    contact_height = region_surface_height(side, region)
                control = armature.pose.bones[f"foot_ik.{suffix}"]
                adjusted = control.matrix.copy()
                adjusted.translation.z -= contact_height
                control.matrix = adjusted
                active_contacts[side] = region
                bpy.context.view_layer.update()
            final_floor = surface_floor()
            corrected = root.matrix.copy()
            corrected.translation.z -= final_floor
            root.matrix = corrected
            bpy.context.view_layer.update()
        after = surface_floor()
        root.keyframe_insert(data_path="location", frame=frame)
        root.keyframe_insert(data_path="rotation_quaternion", frame=frame)
        root.keyframe_insert(data_path="scale", frame=frame)
        for side, suffix in (("left", "L"), ("right", "R")):
            if side not in active_contacts:
                continue
            control = armature.pose.bones[f"foot_ik.{suffix}"]
            keyframe_pose_bone(control, frame)
        samples.append(
            {
                "frame": frame,
                "beforeMeters": before,
                "correctionMeters": -before,
                "afterMeters": after,
                "activeContacts": active_contacts,
            }
        )
    thresholds = {
        "maximumContactHeightMeters": 0.012,
        "minimumHeelRiseMeters": 0.018,
        "minimumInitialForefootClearanceMeters": 0.01,
        "minimumSwingClearanceMeters": 0.012,
    }
    phases = {
        "initialContact": 0,
        "midstance": 0.2,
        "terminalStance": 0.52,
        "midSwing": 0.74,
    }

    def frame_for_local_phase(side, local_phase):
        global_phase = (local_phase + (0.5 if side == "left" else 0)) % 1
        frame_span = scene.frame_end - scene.frame_start
        return scene.frame_start + round(global_phase * frame_span)

    def region_height(side, region, local_phase):
        scene.frame_set(frame_for_local_phase(side, local_phase))
        return region_surface_height(side, region)

    support = {}
    issues = []
    for side in ("left", "right"):
        checks = {
            "clusterVertices": {
                "heel": len(side_regions[side]["heel"]),
                "forefoot": len(side_regions[side]["forefoot"]),
            },
            "initialContact": {
                "heelHeightMeters": region_height(side, "heel", phases["initialContact"]),
                "forefootHeightMeters": region_height(
                    side, "forefoot", phases["initialContact"]
                ),
            },
            "midstance": {
                "heelHeightMeters": region_height(side, "heel", phases["midstance"]),
                "forefootHeightMeters": region_height(
                    side, "forefoot", phases["midstance"]
                ),
            },
            "terminalStance": {
                "heelHeightMeters": region_height(
                    side, "heel", phases["terminalStance"]
                ),
                "forefootHeightMeters": region_height(
                    side, "forefoot", phases["terminalStance"]
                ),
            },
            "midSwing": {
                "heelHeightMeters": region_height(side, "heel", phases["midSwing"]),
                "forefootHeightMeters": region_height(
                    side, "forefoot", phases["midSwing"]
                ),
            },
        }
        support[side] = checks
        if abs(checks["initialContact"]["heelHeightMeters"]) > thresholds[
            "maximumContactHeightMeters"
        ]:
            issues.append(f"{side} heel misses initial contact")
        if checks["initialContact"]["forefootHeightMeters"] < thresholds[
            "minimumInitialForefootClearanceMeters"
        ]:
            issues.append(f"{side} forefoot lacks heel-strike clearance")
        if max(
            abs(checks["midstance"]["heelHeightMeters"]),
            abs(checks["midstance"]["forefootHeightMeters"]),
        ) > thresholds["maximumContactHeightMeters"]:
            issues.append(f"{side} sole is not flat at midstance")
        if checks["terminalStance"]["heelHeightMeters"] < thresholds[
            "minimumHeelRiseMeters"
        ]:
            issues.append(f"{side} heel lacks terminal-stance rise")
        if abs(checks["terminalStance"]["forefootHeightMeters"]) > thresholds[
            "maximumContactHeightMeters"
        ]:
            issues.append(f"{side} forefoot loses terminal-stance contact")
        if min(
            checks["midSwing"]["heelHeightMeters"],
            checks["midSwing"]["forefootHeightMeters"],
        ) < thresholds["minimumSwingClearanceMeters"]:
            issues.append(f"{side} foot lacks mid-swing clearance")
    lateral_samples = []
    minimum_lateral_separation = float("inf")
    minimum_side_order_margin = float("inf")
    for frame in range(scene.frame_start, scene.frame_end + 1):
        scene.frame_set(frame)
        left_x = sole_lateral_centre("left")
        right_x = sole_lateral_centre("right")
        separation = left_x - right_x
        midpoint = (left_x + right_x) * 0.5
        root_x = (armature.matrix_world @ armature.pose.bones["root"].head).x
        minimum_lateral_separation = min(minimum_lateral_separation, separation)
        minimum_side_order_margin = min(minimum_side_order_margin, left_x, -right_x)
        lateral_samples.append(
            {
                "frame": frame,
                "leftSoleCentreX": left_x,
                "rightSoleCentreX": right_x,
                "separationMeters": separation,
                "soleMidpointX": midpoint,
                "rootX": root_x,
            }
        )
    minimum_lateral_separation_threshold = target_step_width * 0.55
    maximum_lateral_separation_threshold = target_step_width * 1.5
    if minimum_lateral_separation < minimum_lateral_separation_threshold:
        issues.append("feet cross or collapse into an implausibly narrow lateral base")
    if minimum_lateral_separation > maximum_lateral_separation_threshold:
        issues.append("feet retain an over-wide production-rest stance")
    if minimum_side_order_margin <= 0:
        issues.append("a foot crosses the body's anatomical centre line")
    lateral_by_frame = {sample["frame"]: sample for sample in lateral_samples}
    support_transfer = {}
    minimum_support_transfer_ratio = float("inf")
    for side in ("left", "right"):
        frame = frame_for_local_phase(side, phases["midstance"])
        sample = lateral_by_frame[frame]
        support_x = sample[f"{side}SoleCentreX"]
        denominator = support_x - sample["soleMidpointX"]
        ratio = (sample["rootX"] - sample["soleMidpointX"]) / denominator
        minimum_support_transfer_ratio = min(minimum_support_transfer_ratio, ratio)
        support_transfer[side] = {"frame": frame, "ratio": ratio}
    if minimum_support_transfer_ratio < 0.12:
        issues.append("root does not transfer far enough toward the single-support foot")
    if minimum_support_transfer_ratio > 1.25:
        issues.append("root overshoots the single-support foot")
    for modifier in topology_modifiers:
        modifier.show_viewport = True
    return {
        "surface": "evaluated-mpfb-rigify-body-sole",
        "soleVertices": len(sole_vertices),
        "maximumAbsoluteCorrectionMeters": max(
            abs(sample["correctionMeters"]) for sample in samples
        ),
        "maximumAbsoluteResidualMeters": max(abs(sample["afterMeters"]) for sample in samples),
        "samples": samples,
        "supportFootVerification": {
            "status": "fail" if issues else "pass",
            "valid": not issues,
            "issues": issues,
            "samplePercentile": 0.02,
            "phases": phases,
            "thresholds": thresholds,
            "sides": support,
            "lateralBase": {
                "minimumSeparationMeters": minimum_lateral_separation,
                "minimumSeparationThresholdMeters": minimum_lateral_separation_threshold,
                "maximumSeparationThresholdMeters": maximum_lateral_separation_threshold,
                "targetStepWidthMeters": target_step_width,
                "minimumAnatomicalSideMarginMeters": minimum_side_order_margin,
                "minimumSupportTransferRatio": minimum_support_transfer_ratio,
                "supportTransfer": support_transfer,
                "samples": lateral_samples,
            },
        },
    }


def follow_controls(scene, camera, armature, names, offset, lens):
    camera.animation_data_clear()
    for frame in range(scene.frame_start, scene.frame_end + 1):
        scene.frame_set(frame)
        points = [armature.matrix_world @ armature.pose.bones[name].head for name in names]
        target = sum(points, Vector()) / len(points)
        camera.location = target + Vector(offset)
        camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
        camera.data.lens = lens
        camera.keyframe_insert(data_path="location", frame=frame)
        camera.keyframe_insert(data_path="rotation_euler", frame=frame)


def configure_mpfb_camera(scene, camera, height, distance, travel, forward_y, view):
    centre_y = forward_y * travel * 0.5
    target = Vector((0, centre_y, height * 0.5))
    if view == "front":
        camera.location = (0, centre_y + forward_y * distance, height * 0.58)
    elif view == "three-quarter":
        camera.location = (
            -distance * 0.72,
            centre_y + forward_y * distance * 0.72,
            height * 0.58,
        )
    else:
        camera.location = (-distance, centre_y, height * 0.58)
    camera.data.lens = 58
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()


def verify_direction_and_elbows(armature, asset, motion, scene, mapping, backend_forward_y):
    tracks = {
        (track["joint"], track["property"]): track for track in motion["tracks"]
    }
    canonical_rest = motion_probe.canonical_world_matrices(asset, {})

    def angle(a, b, c):
        first = (a - b).normalized()
        second = (c - b).normalized()
        return math.degrees(math.acos(max(-1, min(1, first.dot(second)))))

    scene.frame_set(scene.frame_start)
    start_y = armature.pose.bones["root"].matrix.translation.y
    scene.frame_set(scene.frame_end)
    end_y = armature.pose.bones["root"].matrix.translation.y
    root_travel_y = end_y - start_y
    direction_valid = root_travel_y * backend_forward_y > 0
    samples = []
    maximum_elbow_error = 0
    maximum_finger_error = 0
    maximum_thumb_opposition_error = 0
    maximum_thumb_distance_ratio_error = 0
    maximum_backend_thumb_distance_ratio = 0
    maximum_canonical_thumb_distance_ratio = 0
    finger_samples = []
    frame_span = scene.frame_end - scene.frame_start
    for index in range(8):
        frame = scene.frame_start + round((index / 8) * frame_span)
        scene.frame_set(frame)
        seconds = min((frame - scene.frame_start) / scene.render.fps, motion["durationSeconds"])
        sampled = {
            key: motion_probe.sample_track(track, seconds) for key, track in tracks.items()
        }
        canonical = motion_probe.canonical_world_matrices(asset, sampled)
        sample = {"frame": frame, "sides": {}}
        for side, suffix in (("left", "L"), ("right", "R")):
            canonical_angle = angle(
                canonical[f"{side}-upper-arm"].translation,
                canonical[f"{side}-forearm"].translation,
                canonical[f"{side}-hand"].translation,
            )
            backend_angle = angle(
                armature.pose.bones[mapping[f"{side}-upper-arm"]].head,
                armature.pose.bones[mapping[f"{side}-forearm"]].head,
                armature.pose.bones[mapping[f"{side}-hand"]].head,
            )
            error = abs(backend_angle - canonical_angle)
            maximum_elbow_error = max(maximum_elbow_error, error)
            sample["sides"][side] = {
                "canonicalDegrees": canonical_angle,
                "backendDegrees": backend_angle,
                "absoluteErrorDegrees": error,
            }
        samples.append(sample)
        finger_sample = {"frame": frame, "sides": {}}
        for side in ("left", "right"):
            finger_sample["sides"][side] = {}
            for finger in ("thumb", "index", "middle", "ring", "little"):
                joints = [f"{side}-{finger}-{segment}" for segment in (1, 2, 3)]
                canonical_angle = angle(
                    canonical[joints[0]].translation,
                    canonical[joints[1]].translation,
                    canonical[joints[2]].translation,
                )
                backend_angle = angle(
                    armature.pose.bones[mapping[joints[0]]].head,
                    armature.pose.bones[mapping[joints[1]]].head,
                    armature.pose.bones[mapping[joints[2]]].head,
                )
                canonical_rest_angle = angle(
                    canonical_rest[joints[0]].translation,
                    canonical_rest[joints[1]].translation,
                    canonical_rest[joints[2]].translation,
                )
                backend_rest_angle = angle(
                    armature.data.bones[mapping[joints[0]]].head_local,
                    armature.data.bones[mapping[joints[1]]].head_local,
                    armature.data.bones[mapping[joints[2]]].head_local,
                )
                canonical_delta = canonical_angle - canonical_rest_angle
                backend_delta = backend_angle - backend_rest_angle
                error = abs(backend_delta - canonical_delta)
                if finger == "thumb":
                    maximum_thumb_opposition_error = max(
                        maximum_thumb_opposition_error, error
                    )
                else:
                    maximum_finger_error = max(maximum_finger_error, error)
                finger_sample["sides"][side][finger] = {
                    "canonicalDegrees": canonical_angle,
                    "backendDegrees": backend_angle,
                    "canonicalRestDegrees": canonical_rest_angle,
                    "backendRestDegrees": backend_rest_angle,
                    "canonicalDeltaDegrees": canonical_delta,
                    "backendDeltaDegrees": backend_delta,
                    "absoluteErrorDegrees": error,
                }
            thumb_tip = f"{side}-thumb-3"
            index_base = f"{side}-index-1"
            canonical_rest_distance = (
                canonical_rest[thumb_tip].translation
                - canonical_rest[index_base].translation
            ).length
            canonical_distance = (
                canonical[thumb_tip].translation - canonical[index_base].translation
            ).length
            backend_rest_distance = (
                armature.data.bones[mapping[thumb_tip]].head_local
                - armature.data.bones[mapping[index_base]].head_local
            ).length
            backend_distance = (
                armature.pose.bones[mapping[thumb_tip]].head
                - armature.pose.bones[mapping[index_base]].head
            ).length
            canonical_ratio = canonical_distance / canonical_rest_distance
            backend_ratio = backend_distance / backend_rest_distance
            ratio_error = abs(backend_ratio - canonical_ratio)
            maximum_thumb_distance_ratio_error = max(
                maximum_thumb_distance_ratio_error, ratio_error
            )
            maximum_backend_thumb_distance_ratio = max(
                maximum_backend_thumb_distance_ratio, backend_ratio
            )
            maximum_canonical_thumb_distance_ratio = max(
                maximum_canonical_thumb_distance_ratio, canonical_ratio
            )
            finger_sample["sides"][side]["thumbOppositionDistance"] = {
                "canonicalRatioToRest": canonical_ratio,
                "backendRatioToRest": backend_ratio,
                "absoluteRatioError": ratio_error,
            }
        finger_samples.append(finger_sample)
    maximum_allowed_error = 12
    issues = []
    if not direction_valid:
        issues.append("root travel opposes the MPFB character facing direction")
    if maximum_elbow_error > maximum_allowed_error:
        issues.append("Rigify elbow flexion does not preserve the canonical limb pose")
    maximum_allowed_finger_error = 8
    if maximum_finger_error > maximum_allowed_finger_error:
        issues.append("Rigify finger flexion does not preserve the canonical hand pose")
    maximum_allowed_thumb_opposition_error = 15
    maximum_allowed_thumb_distance_ratio_error = 0.12
    maximum_allowed_thumb_distance_ratio = 1.02
    if (
        maximum_thumb_distance_ratio_error
        > maximum_allowed_thumb_distance_ratio_error
        or maximum_backend_thumb_distance_ratio
        > maximum_allowed_thumb_distance_ratio
        or maximum_canonical_thumb_distance_ratio
        > maximum_allowed_thumb_distance_ratio
    ):
        issues.append("Rigify thumb opposition diverges from the canonical hand pose")
    return {
        "status": "fail" if issues else "pass",
        "valid": not issues,
        "issues": issues,
        "direction": {
            "backendForwardY": backend_forward_y,
            "rootTravelY": root_travel_y,
            "valid": direction_valid,
        },
        "elbows": {
            "maximumAbsoluteErrorDegrees": maximum_elbow_error,
            "maximumAllowedErrorDegrees": maximum_allowed_error,
            "samples": samples,
        },
        "fingers": {
            "maximumAbsoluteErrorDegrees": maximum_finger_error,
            "maximumAllowedErrorDegrees": maximum_allowed_finger_error,
            "samples": finger_samples,
        },
        "thumbOpposition": {
            "maximumAbsoluteErrorDegrees": maximum_thumb_opposition_error,
            "maximumAllowedErrorDegrees": maximum_allowed_thumb_opposition_error,
            "maximumDistanceRatioError": maximum_thumb_distance_ratio_error,
            "maximumAllowedDistanceRatioError": maximum_allowed_thumb_distance_ratio_error,
            "maximumBackendDistanceRatioToRest": maximum_backend_thumb_distance_ratio,
            "maximumCanonicalDistanceRatioToRest": maximum_canonical_thumb_distance_ratio,
            "maximumAllowedDistanceRatioToRest": maximum_allowed_thumb_distance_ratio,
        },
    }


def main():
    geometry_file, motion_file, output, profile_file = arguments()
    os.makedirs(output, exist_ok=True)
    with open(geometry_file, "r", encoding="utf-8") as handle:
        asset = json.load(handle)
    with open(motion_file, "r", encoding="utf-8") as handle:
        motion = json.load(handle)
    with open(profile_file, "r", encoding="utf-8") as handle:
        profile = json.load(handle)
    if profile.get("backend") != "blender-rigify":
        raise RuntimeError("MPFB motion probe requires a Blender Rigify backend profile")
    mpfb_module = enable_backends()
    armature, mesh = create_rigged_human(mpfb_module, asset)
    scene, camera, _, radius = geometry_probe.configure_scene(asset, output)
    scene.render.fps = 24
    scene.render.resolution_x = 384
    scene.render.resolution_y = 384
    scene.render.resolution_percentage = 100
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    scene.render.resolution_percentage = 100
    mapping, backend_forward_y = apply_canonical_motion(
        armature, asset, motion, scene.render.fps, profile
    )
    height = float(asset.get("metadata", {}).get("parameters", {}).get("height", 1.72))
    grounding = ground_final_mesh(armature, mesh, scene, height, motion)
    transfer_verification = verify_direction_and_elbows(
        armature, asset, motion, scene, mapping, backend_forward_y
    )
    travel = float(motion.get("metadata", {}).get("rootMotionMeters", 0))
    distance = max(radius, 3.1)
    if os.environ.get("VIDEOER_MPFB_VERIFY_ONLY") != "1":
        configure_mpfb_camera(
            scene, camera, height, distance, travel, backend_forward_y, "side"
        )
        motion_probe.render_animation(scene, output, "walk-mpfb-rigify.mp4")
        configure_mpfb_camera(
            scene, camera, height, distance, travel, backend_forward_y, "three-quarter"
        )
        motion_probe.render_animation(scene, output, "walk-mpfb-rigify-three-quarter.mp4")
        configure_mpfb_camera(
            scene, camera, height, distance, travel, backend_forward_y, "front"
        )
        motion_probe.render_animation(scene, output, "walk-mpfb-rigify-front.mp4")
        if os.environ.get("VIDEOER_MPFB_DETAIL_PROBES") == "1":
            follow_controls(
                scene,
                camera,
                armature,
                [mapping["left-hand"], mapping["left-index-2"], mapping["left-middle-2"]],
                (-0.42, 0.34, 0.04),
                72,
            )
            motion_probe.render_animation(scene, output, "walk-mpfb-rigify-left-hand-detail.mp4")
            follow_controls(
                scene,
                camera,
                armature,
                [
                    mapping["left-foot"],
                    mapping["left-toe"],
                    mapping["right-foot"],
                    mapping["right-toe"],
                ],
                (-0.92, 0.28, 0.22),
                68,
            )
            motion_probe.render_animation(scene, output, "walk-mpfb-rigify-feet-detail.mp4")
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(output, "walk-mpfb-rigify.blend"))
    with open(os.path.join(output, "adapter.json"), "w", encoding="utf-8") as target:
        json.dump(
            {
                "schemaVersion": 1,
                "status": "experimental",
                "sourceGeometry": geometry_file,
                "sourceMotion": motion_file,
                "rigProfile": profile_file,
                "rigProfileId": profile["id"],
                "rigProfileStatus": profile["status"],
                "canonicalToRigify": mapping,
                "backendForwardY": backend_forward_y,
                "coordinateConversion": profile["transfer"]["coordinateConversion"],
                "grounding": grounding,
                "transferVerification": transfer_verification,
                "mpfbModule": mpfb_module,
                "blender": bpy.app.version_string,
            },
            target,
            indent=2,
            sort_keys=True,
        )
        target.write("\n")


if __name__ == "__main__":
    main()
