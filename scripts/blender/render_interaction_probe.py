import bpy
import importlib.util
import json
import os
import sys
from mathutils import Euler, Matrix, Vector


def load_module(filename, name):
    path = os.path.join(os.path.dirname(__file__), filename)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def arguments():
    if "--" not in sys.argv:
        raise RuntimeError("Expected interaction manifest and output after --")
    values = sys.argv[sys.argv.index("--") + 1 :]
    if len(values) != 2:
        raise RuntimeError("Usage: render_interaction_probe.py -- manifest.json output")
    return values


CANONICAL_TO_BLENDER = Matrix(
    (
        (1, 0, 0, 0),
        (0, 0, -1, 0),
        (0, 1, 0, 0),
        (0, 0, 0, 1),
    )
)


def scene_matrix(transform):
    position = transform.get("position", (0, 0, 0))
    rotation = transform.get("rotation", (0, 0, 0))
    scale = transform.get("scale", (1, 1, 1))
    canonical = Matrix.Translation(Vector(position))
    canonical @= Euler(rotation, "XYZ").to_matrix().to_4x4()
    canonical @= Matrix.Diagonal((*scale, 1))
    return CANONICAL_TO_BLENDER @ canonical @ CANONICAL_TO_BLENDER.inverted()


def load_json(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def create_subject(asset_path, motion_path, transform, fps):
    asset = load_json(asset_path)
    armature = geometry_probe.create_armature(asset)
    geometry_probe.create_mesh(asset, armature)
    armature.matrix_world = scene_matrix(transform)
    if motion_path:
        motion_probe.apply_motion(armature, asset, load_json(motion_path), fps)
    return asset, armature


def render_animation(scene, output, filename):
    scene.render.image_settings.file_format = "FFMPEG"
    scene.render.ffmpeg.format = "MPEG4"
    scene.render.ffmpeg.codec = "H264"
    scene.render.ffmpeg.constant_rate_factor = "MEDIUM"
    scene.render.filepath = os.path.join(output, filename)
    bpy.ops.render.render(animation=True)


def configure_camera(camera, position, target):
    camera.location = position
    camera.data.lens = 58
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()


def main():
    manifest_file, output = arguments()
    os.makedirs(output, exist_ok=True)
    manifest = load_json(manifest_file)
    geometry_probe.clear_scene()
    actor, _ = create_subject(
        manifest["actorGeometry"],
        manifest["actorMotion"],
        manifest["actorTransform"],
        24,
    )
    create_subject(
        manifest["targetGeometry"],
        manifest.get("targetMotion"),
        manifest["targetTransform"],
        24,
    )
    scene, camera, _, _ = geometry_probe.configure_scene(actor, output)
    scene.render.fps = 24
    scene.render.resolution_x = 640
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    target = (0, 0.05, 1.05)
    configure_camera(camera, (4.0, 1.25, 1.55), target)
    render_animation(scene, output, "interaction.mp4")
    configure_camera(camera, (3.55, -2.4, 1.58), target)
    render_animation(scene, output, "interaction-opposite.mp4")
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(output, "interaction.blend"))


geometry_probe = load_module("render_geometry_probe.py", "videoer_geometry_probe")
motion_probe = load_module("render_motion_probe.py", "videoer_motion_probe")

if __name__ == "__main__":
    main()
