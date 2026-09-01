"""Runtime integration probe for MPFB/Rigify production-character attachments.

Run through Blender with a production body geometry and Rigify profile after --.
The fixture is deliberately campaign-neutral and writes machine-readable evidence.
"""

import importlib.util
import json
import math
import os
import sys

import bpy
from mathutils import Vector


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    values = sys.argv[sys.argv.index("--") + 1 :]
    if len(values) not in (3, 4, 5):
        raise RuntimeError(
            "Expected body geometry, Rigify profile, report path, optional hair, and optional wardrobe"
        )
    body_path, profile_path, report_path = map(os.path.abspath, values[:3])
    supplied_hair_path = os.path.abspath(values[3]) if len(values) == 4 else None
    if len(values) == 5:
        supplied_hair_path = os.path.abspath(values[3])
    supplied_wardrobe_path = os.path.abspath(values[4]) if len(values) == 5 else None
    directory = os.path.dirname(__file__)
    rigify = load_module(
        os.path.join(directory, "render_mpfb_motion_probe.py"), "videoer_test_rigify"
    )
    assembly = load_module(
        os.path.join(directory, "production_character_assembly.py"), "videoer_test_assembly"
    )
    with open(body_path, "r", encoding="utf-8") as handle:
        body = json.load(handle)
    with open(profile_path, "r", encoding="utf-8") as handle:
        profile = json.load(handle)
    probe_directory = os.path.dirname(report_path)
    os.makedirs(probe_directory, exist_ok=True)

    def write_artifact(filename, value):
        path = os.path.join(probe_directory, filename)
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(value, handle, indent=2)
            handle.write("\n")
        return path

    head_index = assembly.ordered_joints(body).index("head")
    head_position = body["skeleton"][head_index]["restPosition"]
    accessory_material = {
        "id": "probe-cloth",
        "baseColor": [0.08, 0.13, 0.21, 1],
        "metallic": 0,
        "roughness": 0.72,
    }
    hair = {
        "schemaVersion": 1,
        "id": "hair.ordinary-scene-probe",
        "units": "meters",
        "coordinateSystem": body["coordinateSystem"],
        "positions": [
            [head_position[0] - 0.08, head_position[1] + 0.08, head_position[2]],
            [head_position[0] + 0.08, head_position[1] + 0.08, head_position[2]],
            [head_position[0], head_position[1] + 0.18, head_position[2] + 0.03],
        ],
        "normals": [[0, 0, -1]] * 3,
        "uvs": [[0, 0], [1, 0], [0.5, 1]],
        "indices": [0, 1, 2],
        "skinIndices": [[head_index, 0, 0, 0]] * 3,
        "skinWeights": [[1, 0, 0, 0]] * 3,
        "materials": [accessory_material],
        "materialGroups": [{"materialId": "probe-cloth", "start": 0, "count": 3}],
        "skeleton": body["skeleton"],
        "morphTargets": [],
        "attachments": {},
        "metadata": {
            "hairClass": "ordinary-scene-probe",
            "sourceTarget": body["id"],
        },
    }
    if supplied_hair_path:
        with open(supplied_hair_path, "r", encoding="utf-8") as handle:
            hair = json.load(handle)
    triangle = body["indices"][:3]
    wardrobe = {
        "schemaVersion": 1,
        "id": "clothing.ordinary-scene-probe",
        "units": "meters",
        "coordinateSystem": body["coordinateSystem"],
        "positions": [body["positions"][index] for index in triangle],
        "normals": [body["normals"][index] for index in triangle],
        "uvs": [body["uvs"][index] for index in triangle],
        "indices": [0, 1, 2],
        "skinIndices": [body["skinIndices"][index] for index in triangle],
        "skinWeights": [body["skinWeights"][index] for index in triangle],
        "materials": [accessory_material],
        "materialGroups": [{"materialId": "probe-cloth", "start": 0, "count": 3}],
        "skeleton": body["skeleton"],
        "morphTargets": [],
        "attachments": {},
        "metadata": {"sourceTarget": body["id"]},
    }
    if supplied_wardrobe_path:
        with open(supplied_wardrobe_path, "r", encoding="utf-8") as handle:
            wardrobe = json.load(handle)
    skin_surface = {
        "schemaVersion": 1,
        "id": "material.ordinary-scene-skin",
        "shadingModel": "metallic-roughness",
        "baseColor": {
            "kind": "procedural-palette",
            "colors": [[0.42, 0.22, 0.14, 1], [0.58, 0.33, 0.23, 1]],
            "scaleMeters": 0.018,
            "seed": 127,
        },
        "normal": {"kind": "procedural-noise", "strength": 0.12, "scaleMeters": 0.004},
        "roughness": {
            "minimum": 0.38,
            "maximum": 0.56,
            "variationScaleMeters": 0.012,
            "wetness": 0,
        },
        "pattern": {"kind": "isotropic"},
        "metallic": 0,
        "metadata": {"fixture": "ordinary-scene"},
    }
    hair_path = write_artifact("hair.json", hair)
    wardrobe_path = write_artifact("wardrobe.json", wardrobe)
    skin_path = write_artifact("skin.json", skin_surface)

    def component(path, asset_id, asset_type):
        return {
            "asset": {"id": asset_id, "version": "1.0.0"},
            "artifactRole": "material" if asset_type == "material" else "geometry",
            "path": os.path.relpath(path, probe_directory),
            "sha256": assembly.sha256_file(path),
        }

    binding = {
        "schemaVersion": 1,
        "id": "character-binding.ordinary-scene-probe",
        "character": {"id": "character.ordinary-scene-probe", "version": "1.0.0"},
        "body": component(body_path, body["id"], "geometry"),
        "rigProfile": {
            "id": profile["id"],
            "version": profile["version"],
            "path": os.path.relpath(profile_path, probe_directory),
            "sha256": assembly.sha256_file(profile_path),
        },
        "materialBindings": [
            {"targetMaterialId": "skin", "material": component(skin_path, skin_surface["id"], "material")}
        ],
        "hair": {**component(hair_path, hair["id"], "geometry"), "binding": "canonical-head-v1"},
        "wardrobe": [
            {
                **component(wardrobe_path, wardrobe["id"], "geometry"),
                "binding": "full-rig-weight-transfer-v1",
            }
        ],
        "compatibility": {
            "canonicalSkeleton": assembly.CANONICAL_SKELETON,
            "bodyTopology": body["metadata"]["topology"],
        },
        "qualityTier": "medium",
        "derivation": {
            "kind": "production-character-assembly-v1",
            "generator": "videoer.production-character-binding.v1",
            "inputSha256": "0" * 64,
        },
    }
    binding_path = write_artifact("binding.json", binding)
    module_name = rigify.enable_backends()
    armature, body_mesh = rigify.create_rigged_human(module_name, body)
    definition = {
        "id": "character.ordinary-scene-probe",
        "geometryPath": body_path,
        "productionRigProfilePath": profile_path,
        "productionCharacterBindingPath": binding_path,
    }
    objects, assembly_report = assembly.assemble(
        definition, body, armature, body_mesh, profile, rigify.geometry_probe
    )
    rejected_invalid_hair = False
    invalid_hair = dict(hair)
    invalid_hair["skinIndices"] = [[0, 0, 0, 0]] * 3
    invalid_hair_path = write_artifact("invalid-hair.json", invalid_hair)
    invalid_hair_component = {
        **component(invalid_hair_path, invalid_hair["id"], "geometry"),
        "binding": "canonical-head-v1",
    }
    try:
        assembly.bind_hair(
            binding_path,
            invalid_hair_component,
            body,
            armature,
            profile,
            rigify.geometry_probe,
        )
    except RuntimeError:
        rejected_invalid_hair = True
    if not rejected_invalid_hair:
        raise RuntimeError("canonical-head-v1 accepted non-head hair ownership")
    wardrobe_report = assembly_report["wardrobe"][0]
    if wardrobe_report["minimumVertexInfluences"] < 1:
        raise RuntimeError("Wardrobe fixture did not receive complete deform ownership")
    if assembly_report["hair"]["control"] != profile["canonicalToControl"]["head"]:
        raise RuntimeError("Hair fixture does not use the mapped Rigify head control")
    if any(obj.parent != armature for obj in objects):
        raise RuntimeError("An assembly object is not owned by the production armature")
    if len([obj for obj in bpy.data.objects if obj.type == "ARMATURE"]) != 1:
        raise RuntimeError("Production attachment probe found duplicate armatures")
    if set(profile["canonicalToControl"]) != set(assembly.ordered_joints(body)):
        raise RuntimeError("Rigify profile does not map the production body exactly")

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 512
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.world.color = (0.018, 0.022, 0.03)
    bpy.ops.object.camera_add(location=(0, -3.4, 1.42))
    camera = bpy.context.object
    camera.data.lens = 58
    camera.rotation_euler = (Vector((0, 0, 1.05)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = camera
    bpy.ops.object.light_add(type="AREA", location=(-1.8, -2.3, 3.1))
    key = bpy.context.object
    key.data.energy = 900
    key.data.shape = "DISK"
    key.data.size = 2.2
    key.rotation_euler = (Vector((0, 0, 1.1)) - key.location).to_track_quat("-Z", "Y").to_euler()
    bpy.ops.object.light_add(type="AREA", location=(1.8, 0.3, 2.2))
    rim = bpy.context.object
    rim.data.energy = 650
    rim.data.size = 1.4
    rim.rotation_euler = (Vector((0, 0, 1.25)) - rim.location).to_track_quat("-Z", "Y").to_euler()
    diagnostic_frames = []
    for name, location in [
        ("neutral-front", (0, -3.4, 1.42)),
        ("neutral-three-quarter", (-2.3, -2.8, 1.46)),
        ("neutral-back", (0, 3.4, 1.42)),
    ]:
        camera.location = location
        camera.rotation_euler = (Vector((0, 0, 1.05)) - camera.location).to_track_quat("-Z", "Y").to_euler()
        filename = f"{name}.png"
        scene.render.filepath = os.path.join(probe_directory, filename)
        bpy.ops.render.render(write_still=True)
        diagnostic_frames.append(filename)
    forearm = armature.pose.bones.get(profile["canonicalToControl"]["left-forearm"])
    if forearm is None:
        raise RuntimeError("Generated Rigify armature lacks the left-forearm bend control")
    forearm.rotation_mode = "XYZ"
    forearm.rotation_euler[0] = math.radians(72)
    bpy.context.view_layer.update()
    camera.location = (0, -3.4, 1.42)
    camera.rotation_euler = (Vector((0, 0, 1.05)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(probe_directory, "bend-front.png")
    bpy.ops.render.render(write_still=True)
    diagnostic_frames.append("bend-front.png")
    scene.render.filepath = os.path.join(probe_directory, "assembly.png")
    bpy.data.images["Render Result"].save_render(scene.render.filepath, scene=scene)

    with open(report_path, "w", encoding="utf-8") as handle:
        json.dump(
            {
                "schemaVersion": 1,
                "fixture": "ordinary-scene-production-character-attachment",
                "status": "structural-pass-visual-review-required",
                "armatureCount": 1,
                "armatureName": armature.name,
                "deformBoneCount": len([bone for bone in armature.data.bones if bone.use_deform]),
                "materialBindings": assembly_report["materials"],
                "hair": assembly_report["hair"],
                "wardrobe": assembly_report["wardrobe"],
                "failClosedChecks": {"nonHeadHairOwnershipRejected": rejected_invalid_hair},
                "diagnosticFrames": diagnostic_frames,
            },
            handle,
            indent=2,
        )
        handle.write("\n")


if __name__ == "__main__":
    main()
