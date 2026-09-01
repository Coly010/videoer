"""Runtime comparison probe for dry and wet hash-bound PBR materials."""

import copy
import importlib.util
import json
import os
import sys

import bpy
from mathutils import Vector


def load_module(name, filename):
    path = os.path.join(os.path.dirname(__file__), filename)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def slab_asset(material_definition):
    return {
        "id": f"geometry.{material_definition['id']}",
        "positions": [
            [-0.75, 0, -0.75], [0.75, 0, -0.75], [0.75, 0.12, -0.75], [-0.75, 0.12, -0.75],
            [-0.75, 0, 0.75], [0.75, 0, 0.75], [0.75, 0.12, 0.75], [-0.75, 0.12, 0.75],
        ],
        "indices": [
            0, 1, 2, 0, 2, 3, 5, 4, 7, 5, 7, 6,
            4, 0, 3, 4, 3, 7, 1, 5, 6, 1, 6, 2,
            3, 2, 6, 3, 6, 7, 4, 5, 1, 4, 1, 0,
        ],
        "materials": [material_definition],
        "materialGroups": [{"materialId": material_definition["id"], "start": 0, "count": 36}],
        "skeleton": [{"id": "root", "restPosition": [0, 0, 0], "constraints": {}}],
    }


def main():
    if "--" not in sys.argv or len(sys.argv[sys.argv.index("--") + 1 :]) != 1:
        raise RuntimeError("Expected output directory after --")
    output = os.path.abspath(sys.argv[sys.argv.index("--") + 1])
    texture_directory = os.path.join(output, "textures")
    os.makedirs(texture_directory, exist_ok=True)
    geometry_probe = load_module("videoer_wet_geometry_probe", "render_geometry_probe.py")
    fixture = load_module("videoer_texture_fixture", "test_texture_material_maps.py")
    geometry_probe.clear_scene()
    semantics = [
        "base-color", "normal", "roughness",
        "ambient-occlusion", "displacement", "opacity",
    ]
    channels = [
        fixture.write_texture(os.path.join(texture_directory, f"{semantic}.png"), semantic)
        for semantic in semantics
    ]

    def definition(identifier, wetness):
        return {
            "id": identifier,
            "baseColor": [0.2, 0.2, 0.2, 1],
            "metallic": 0,
            "roughness": 0.5,
            "surface": {
                "schemaVersion": 1,
                "id": identifier,
                "shadingModel": "metallic-roughness",
                "baseColor": {
                    "kind": "procedural-palette",
                    "colors": [[0.2, 0.2, 0.2, 1], [0.3, 0.3, 0.3, 1]],
                    "scaleMeters": 0.2,
                    "seed": 91,
                },
                "normal": {"kind": "procedural-noise", "strength": 0.65, "scaleMeters": 0.009},
                "roughness": {
                    "minimum": 0.2,
                    "maximum": 0.85,
                    "variationScaleMeters": 0.08,
                    "wetness": wetness,
                },
                "pattern": {"kind": "isotropic"},
                "metallic": 0,
                "textureMaps": {
                    "kind": "hash-bound",
                    "source": {
                        "provider": "ambientcg",
                        "sourceIdentitySha256": "1" * 64,
                        "manifestSha256": "2" * 64,
                        "licenceSpdx": "CC0-1.0",
                    },
                    "physicalScale": {"widthMeters": 0.5, "heightMeters": 0.25},
                    "suitability": {
                        "composition": "homogeneous-unit-material",
                        "intendedConstructionDomains": ["prop-surface"],
                        "rationale": "Runtime wet-response fixture.",
                    },
                    "application": {
                        "constructionDomain": "prop-surface",
                        "placement": {
                            "scalePolicy": "preserve-source-physical-scale",
                            "orientation": "world-horizontal",
                            "offsetMeters": [0, 0],
                            "rotationDegrees": 0,
                            "appearance": {
                                "exposureStops": 0,
                                "saturationScale": 1,
                                "hueShiftDegrees": 0,
                                "roughnessScale": 1,
                                "roughnessOffset": 0,
                                "weatheringAmount": 0,
                            },
                            "macroVariation": {
                                "seed": 91,
                                "scaleMeters": 2.0,
                                "valueAmplitude": 0.01,
                                "saturationAmplitude": 0,
                                "hueAmplitudeDegrees": 0,
                                "roughnessAmplitude": 0,
                                "weatheringAmplitude": 0,
                            },
                        },
                    },
                    "channels": copy.deepcopy(channels),
                },
                "metadata": {"fixture": "wet-surface-response"},
            },
        }

    dry_definition = definition("material.texture-dry-control", 0.0)
    wet_definition = definition("material.texture-wet-response", 0.8)
    dry = geometry_probe.create_mesh(slab_asset(dry_definition), None, output)
    wet = geometry_probe.create_mesh(slab_asset(wet_definition), None, output)
    dry.location.x = -0.9
    wet.location.x = 0.9
    dry.name = "dry-control-left"
    wet.name = "wet-response-right"
    dry_material = dry.data.materials[0]
    wet_material = wet.data.materials[0]
    dry_report = json.loads(dry_material["videoer_texture_report"])
    wet_report = json.loads(wet_material["videoer_texture_report"])

    dry_nodes = dry_material.node_tree.nodes
    wet_nodes = wet_material.node_tree.nodes
    if any(name in dry_nodes for name in (
        "videoer-wet-base-color-darkening",
        "videoer-wet-roughness-compression",
        "videoer-wet-roughness-floor",
    )):
        raise RuntimeError("Dry texture path contains wet-response nodes")
    expected_wet = {
        "wetness": 0.8,
        "baseColorDarkening": 0.144,
        "roughnessMultiplier": 0.48,
        "roughnessFloor": 0.04,
        "coatWeight": 0.8,
        "coatRoughness": 0.048,
        "coatIor": 1.333,
    }
    for key, expected in expected_wet.items():
        actual = wet_report["wetSurfaceResponse"][key]
        if abs(actual - expected) > 1e-6:
            raise RuntimeError(f"Wet response {key} is {actual}, expected {expected}")
    if dry_report["wetSurfaceResponse"] != {
        "wetness": 0,
        "baseColorDarkening": 0.0,
        "roughnessMultiplier": 1.0,
        "roughnessFloor": 0.0,
        "coatWeight": 0.0,
        "coatRoughness": None,
        "coatIor": None,
    }:
        raise RuntimeError(f"Dry response is not an exact pass-through: {dry_report['wetSurfaceResponse']}")
    dry_hashes = {item["semantic"]: item["sha256"] for item in dry_report["channels"]}
    wet_hashes = {item["semantic"]: item["sha256"] for item in wet_report["channels"]}
    if dry_hashes != wet_hashes:
        raise RuntimeError("Wet response changed staged texture identities")

    principled = wet_nodes.get("Principled BSDF")
    live_values = {
        "roughnessMultiplier": wet_nodes["videoer-wet-roughness-compression"].inputs[1].default_value,
        "roughnessFloor": wet_nodes["videoer-wet-roughness-floor"].inputs[1].default_value,
        "coatWeight": principled.inputs["Coat Weight"].default_value,
        "coatRoughness": principled.inputs["Coat Roughness"].default_value,
        "coatIor": principled.inputs["Coat IOR"].default_value,
    }
    wet_input_source = wet_nodes["videoer-wet-roughness-compression"].inputs[0].links[0].from_node.name
    if wet_input_source != "videoer-application-roughness-clamp":
        raise RuntimeError(
            f"Wet-film roughness is not downstream of texture application: {wet_input_source}"
        )
    dry_principled = dry_nodes.get("Principled BSDF")
    dry_roughness_source = dry_principled.inputs["Roughness"].links[0].from_node.name
    if dry_roughness_source != "videoer-application-roughness-clamp":
        raise RuntimeError(f"Dry roughness bypassed texture application: {dry_roughness_source}")
    for key, actual in live_values.items():
        if abs(actual - expected_wet[key]) > 1e-6:
            raise RuntimeError(f"Live Blender {key} is {actual}, expected {expected_wet[key]}")
    invalid = definition("material.texture-invalid-wetness", 1.01)
    rejected_invalid_wetness = False
    try:
        geometry_probe.create_material(invalid, output)
    except RuntimeError:
        rejected_invalid_wetness = True
    if not rejected_invalid_wetness:
        raise RuntimeError("Blender accepted texture wetness outside 0..1")

    bpy.ops.mesh.primitive_plane_add(size=8, location=(0, 0, -0.015))
    ground = bpy.context.object
    ground_material = bpy.data.materials.new("wet-probe-ground")
    ground_material.diffuse_color = (0.015, 0.018, 0.024, 1)
    ground_material.roughness = 0.78
    ground.data.materials.append(ground_material)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 64
    scene.cycles.seed = 1729
    scene.cycles.use_animated_seed = False
    scene.cycles.use_adaptive_sampling = False
    scene.cycles.use_denoising = True
    scene.cycles.denoiser = "OPENIMAGEDENOISE"
    scene.render.resolution_x = 768
    scene.render.resolution_y = 480
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.dither_intensity = 0
    scene.world.color = (0.006, 0.008, 0.012)
    bpy.ops.object.camera_add(location=(0, -4.9, 2.55))
    camera = bpy.context.object
    camera.data.lens = 58
    camera.rotation_euler = (Vector((0, 0, 0.1)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = camera
    bpy.ops.object.light_add(type="AREA", location=(0, -3.2, 0.68))
    rake = bpy.context.object
    rake.data.energy = 1250
    rake.data.size = 0.55
    rake.rotation_euler = (Vector((0, 0, 0.05)) - rake.location).to_track_quat("-Z", "Y").to_euler()
    bpy.ops.object.light_add(type="AREA", location=(0, 1.8, 2.8))
    fill = bpy.context.object
    fill.data.energy = 220
    fill.data.size = 2.5
    fill.data.color = (0.3, 0.45, 1.0)
    fill.rotation_euler = (Vector((0, 0, 0.1)) - fill.location).to_track_quat("-Z", "Y").to_euler()
    render_path = os.path.join(output, "dry-vs-wet-raking.png")
    scene.render.filepath = render_path
    bpy.ops.render.render(write_still=True)
    with open(os.path.join(output, "wet-texture-response-report.json"), "w", encoding="utf-8") as handle:
        json.dump(
            {
                "schemaVersion": 1,
                "status": "structural-pass-visual-review-required",
                "layout": {"left": "dry", "right": "wet", "wetness": 0.8},
                "dryResponse": dry_report["wetSurfaceResponse"],
                "wetResponse": wet_report["wetSurfaceResponse"],
                "liveBlenderValues": live_values,
                "roughnessOrdering": {
                    "drySource": dry_roughness_source,
                    "wetFilmInput": wet_input_source,
                },
                "channelHashesPreserved": dry_hashes == wet_hashes,
                "invalidWetnessRejected": rejected_invalid_wetness,
                "renderer": {
                    "engine": "cycles-cpu",
                    "samples": 64,
                    "seed": 1729,
                    "adaptiveSampling": False,
                },
                "render": os.path.basename(render_path),
            },
            handle,
            indent=2,
        )
        handle.write("\n")


if __name__ == "__main__":
    main()
