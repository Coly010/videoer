import bpy
import importlib.util
import json
import math
import os
import sys
from mathutils import Euler, Matrix, Vector


def load_geometry_probe_module():
    path = os.path.join(os.path.dirname(__file__), "render_geometry_probe.py")
    spec = importlib.util.spec_from_file_location("videoer_geometry_probe", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def arguments():
    if "--" not in sys.argv:
        raise RuntimeError("Expected geometry, motion, and output after --")
    values = sys.argv[sys.argv.index("--") + 1 :]
    if len(values) not in (3, 4):
        raise RuntimeError("Usage: render_motion_probe.py -- geometry.json motion.json output [basename]")
    return (*values[:3], values[3] if len(values) == 4 else "walk")


def ease(value, easing):
    if easing == "ease-in":
        return value * value
    if easing == "ease-out":
        return 1 - (1 - value) * (1 - value)
    if easing == "ease-in-out":
        return 2 * value * value if value < 0.5 else 1 - ((-2 * value + 2) ** 2) / 2
    return value


def sample_track(track, seconds):
    keyframes = track["keyframes"]
    if seconds <= keyframes[0]["time"]:
        return keyframes[0]["value"]
    if seconds >= keyframes[-1]["time"]:
        return keyframes[-1]["value"]
    for index, current in enumerate(keyframes[1:], start=1):
        if current["time"] >= seconds:
            previous = keyframes[index - 1]
            raw_amount = (seconds - previous["time"]) / (
                current["time"] - previous["time"]
            )
            if track.get("interpolation", "linear") == "quintic-hermite":
                duration = current["time"] - previous["time"]
                duration_squared = duration * duration
                result = []
                for axis, value in enumerate(previous["value"]):
                    end_value = current["value"][axis]
                    start_velocity = previous["velocity"][axis] * duration
                    end_velocity = current["velocity"][axis] * duration
                    start_acceleration = (
                        previous["acceleration"][axis] * duration_squared
                    )
                    end_acceleration = current["acceleration"][axis] * duration_squared
                    difference = end_value - value
                    c0 = value
                    c1 = start_velocity
                    c2 = start_acceleration / 2
                    c3 = (
                        10 * difference
                        - 6 * start_velocity
                        - 4 * end_velocity
                        - 1.5 * start_acceleration
                        + 0.5 * end_acceleration
                    )
                    c4 = (
                        -15 * difference
                        + 8 * start_velocity
                        + 7 * end_velocity
                        + 1.5 * start_acceleration
                        - end_acceleration
                    )
                    c5 = (
                        6 * difference
                        - 3 * (start_velocity + end_velocity)
                        - 0.5 * (start_acceleration - end_acceleration)
                    )
                    amount = raw_amount
                    result.append(
                        c0
                        + amount
                        * (
                            c1
                            + amount
                            * (
                                c2
                                + amount * (c3 + amount * (c4 + amount * c5))
                            )
                        )
                    )
                return result
            amount = ease(raw_amount, previous.get("easing", "linear"))
            return [
                value + (current["value"][axis] - value) * amount
                for axis, value in enumerate(previous["value"])
            ]
    return keyframes[-1]["value"]


def sample_scalar_track(track, seconds):
    keyframes = track["keyframes"]
    if seconds <= keyframes[0]["time"]:
        return keyframes[0]["value"]
    if seconds >= keyframes[-1]["time"]:
        return keyframes[-1]["value"]
    for index, current in enumerate(keyframes[1:], start=1):
        if current["time"] >= seconds:
            previous = keyframes[index - 1]
            amount = ease(
                (seconds - previous["time"]) / (current["time"] - previous["time"]),
                previous.get("easing", "linear"),
            )
            return previous["value"] + (current["value"] - previous["value"]) * amount
    return keyframes[-1]["value"]


def canonical_world_matrices(asset, sampled):
    world = {}
    for joint in asset.get("skeleton", []):
        joint_id = joint["id"]
        translation = Vector(joint["restPosition"])
        translation_delta = sampled.get((joint_id, "translation"), (0, 0, 0))
        rotation_delta = sampled.get((joint_id, "rotation-euler"), (0, 0, 0))
        local = Matrix.Translation(translation + Vector(translation_delta))
        local @= Euler(rotation_delta, "XYZ").to_matrix().to_4x4()
        parent = joint.get("parent")
        world[joint_id] = world[parent] @ local if parent else local
    return world


def apply_motion(
    armature,
    asset,
    motion,
    fps,
    scene_start_seconds=0,
    scene_end_seconds=None,
    source_start_seconds=0,
    source_end_seconds=None,
    endpoint_on_last_frame=False,
    mesh=None,
):
    scene = bpy.context.scene
    scene.frame_start = 1
    uses_motion_duration = scene_end_seconds is None
    if uses_motion_duration:
        scene_end_seconds = motion["durationSeconds"]
    if source_end_seconds is None:
        source_end_seconds = motion["durationSeconds"]
    if scene_end_seconds <= scene_start_seconds:
        raise RuntimeError("Motion scene interval must be positive")
    if source_end_seconds <= source_start_seconds:
        raise RuntimeError("Motion source interval must be positive")
    start_frame = round(scene_start_seconds * fps) + 1
    end_frame = (
        round(scene_end_seconds * fps)
        if endpoint_on_last_frame
        else round(scene_end_seconds * fps) + 1
    )
    scene.frame_end = end_frame if uses_motion_duration else max(scene.frame_end, end_frame)
    tracks = {}
    for track in motion["tracks"]:
        if armature.pose.bones.get(track["joint"]) is None:
            raise RuntimeError(f"Motion references absent bone: {track['joint']}")
        tracks[(track["joint"], track["property"])] = track
    morph_tracks = {track["target"]: track for track in motion.get("morphTracks", [])}
    if morph_tracks:
        if mesh is None or mesh.data.shape_keys is None:
            raise RuntimeError("Morph motion requires a mesh with shape keys")
        for target in morph_tracks:
            if mesh.data.shape_keys.key_blocks.get(target) is None:
                raise RuntimeError(f"Motion references absent morph target: {target}")

    # Videoer's canonical frame is right-handed Y-up with forward -Z. Blender is
    # right-handed Z-up with forward -Y. Convert complete transforms rather than
    # remapping Euler components: Blender bone-local axes depend on bone direction.
    canonical_to_blender = Matrix(
        (
            (1, 0, 0, 0),
            (0, 0, -1, 0),
            (0, 1, 0, 0),
            (0, 0, 0, 1),
        )
    )
    blender_to_canonical = canonical_to_blender.inverted()
    rest_world = canonical_world_matrices(asset, {})
    rest_orientation = {}
    for joint in asset.get("skeleton", []):
        joint_id = joint["id"]
        converted_rest = canonical_to_blender @ rest_world[joint_id] @ blender_to_canonical
        rest_orientation[joint_id] = (
            converted_rest.inverted() @ armature.data.bones[joint_id].matrix_local
        )

    for frame in range(start_frame, end_frame + 1):
        scene.frame_set(frame)
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
        sampled = {key: sample_track(track, seconds) for key, track in tracks.items()}
        animated_world = canonical_world_matrices(asset, sampled)
        for joint in asset.get("skeleton", []):
            joint_id = joint["id"]
            pose_bone = armature.pose.bones[joint_id]
            pose_bone.rotation_mode = "QUATERNION"
            pose_bone.matrix = (
                canonical_to_blender
                @ animated_world[joint_id]
                @ blender_to_canonical
                @ rest_orientation[joint_id]
            )
            bpy.context.view_layer.update()
            pose_bone.keyframe_insert(data_path="location", frame=frame)
            pose_bone.keyframe_insert(data_path="rotation_quaternion", frame=frame)
            pose_bone.keyframe_insert(data_path="scale", frame=frame)
        for target, track in morph_tracks.items():
            shape = mesh.data.shape_keys.key_blocks[target]
            shape.value = sample_scalar_track(track, seconds)
            shape.keyframe_insert(data_path="value", frame=frame)

    actions = [armature.animation_data.action if armature.animation_data else None]
    if mesh is not None and mesh.data.shape_keys and mesh.data.shape_keys.animation_data:
        actions.append(mesh.data.shape_keys.animation_data.action)
    for action in actions:
        if action:
            for curve in action.fcurves:
                for point in curve.keyframe_points:
                    point.interpolation = "LINEAR"


def configure_camera(scene, camera, height, distance, travel, view="side"):
    target = (0, travel * 0.5, height * 0.5)
    if view == "front":
        camera.location = (0, travel * 0.5 + distance, height * 0.58)
    elif view == "three-quarter":
        # Canonical front is -Z, which maps to Blender +Y. Offset toward the
        # actor's left to expose pelvis transfer, arm counter-motion, and feet.
        camera.location = (-distance * 0.72, travel * 0.5 + distance * 0.72, height * 0.58)
    else:
        # View the actor's left profile so canonical forward (-Z / Blender +Y)
        # travels screen-right to screen-left, matching the benchmark direction.
        camera.location = (-distance, travel * 0.5, height * 0.58)
    camera.data.lens = 58
    direction = geometry_probe.Vector(target) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def configure_follow_camera(scene, camera, armature, bone_ids, offset, lens):
    camera.animation_data_clear()
    for frame in range(scene.frame_start, scene.frame_end + 1):
        scene.frame_set(frame)
        points = []
        for bone_id in bone_ids:
            bone = armature.pose.bones.get(bone_id)
            if bone:
                points.append(armature.matrix_world @ bone.head)
        if not points:
            raise RuntimeError(f"Detail camera cannot find bones: {bone_ids}")
        target = sum(points, Vector()) / len(points)
        camera.location = target + Vector(offset)
        camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
        camera.data.lens = lens
        camera.keyframe_insert(data_path="location", frame=frame)
        camera.keyframe_insert(data_path="rotation_euler", frame=frame)
    if camera.animation_data and camera.animation_data.action:
        for curve in camera.animation_data.action.fcurves:
            for point in curve.keyframe_points:
                point.interpolation = "LINEAR"


def render_animation(scene, output, filename):
    scene.render.image_settings.file_format = "FFMPEG"
    scene.render.ffmpeg.format = "MPEG4"
    scene.render.ffmpeg.codec = "H264"
    scene.render.ffmpeg.constant_rate_factor = "MEDIUM"
    scene.render.filepath = os.path.join(output, filename)
    bpy.ops.render.render(animation=True)


def main():
    geometry_file, motion_file, output, basename = arguments()
    os.makedirs(output, exist_ok=True)
    with open(geometry_file, "r", encoding="utf-8") as handle:
        asset = json.load(handle)
    with open(motion_file, "r", encoding="utf-8") as handle:
        motion = json.load(handle)
    geometry_probe.clear_scene()
    armature = geometry_probe.create_armature(asset)
    mesh = geometry_probe.create_mesh(asset, armature)
    scene, camera, _, radius = geometry_probe.configure_scene(asset, output)
    scene.render.fps = 24
    apply_motion(armature, asset, motion, scene.render.fps, mesh=mesh)
    height = float(asset.get("metadata", {}).get("parameters", {}).get("height", 1.72))
    travel = float(motion.get("metadata", {}).get("rootMotionMeters", 0))
    distance = max(radius, 3.1)
    configure_camera(scene, camera, height, distance, travel, "side")
    render_animation(scene, output, f"{basename}.mp4")
    configure_camera(scene, camera, height, distance, travel, "three-quarter")
    render_animation(scene, output, f"{basename}-three-quarter.mp4")
    configure_camera(scene, camera, height, distance, travel, "front")
    render_animation(scene, output, f"{basename}-front.mp4")
    configure_follow_camera(
        scene,
        camera,
        armature,
        ["left-hand", "left-index-2", "left-middle-2"],
        (-0.42, 0.34, 0.04),
        72,
    )
    render_animation(scene, output, f"{basename}-left-hand-detail.mp4")
    configure_follow_camera(
        scene,
        camera,
        armature,
        ["left-foot", "left-toe", "right-foot", "right-toe"],
        (-0.92, 0.28, 0.22),
        68,
    )
    render_animation(scene, output, f"{basename}-feet-detail.mp4")
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(output, f"{basename}.blend"))


geometry_probe = load_geometry_probe_module()

if __name__ == "__main__":
    main()
