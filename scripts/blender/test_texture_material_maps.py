"""Deterministic Blender runtime probe for hash-bound PBR texture maps."""

import copy
import hashlib
import importlib.util
import json
import os
import sys

import bpy
from mathutils import Vector


def load_geometry_probe():
    path = os.path.join(os.path.dirname(__file__), "render_geometry_probe.py")
    spec = importlib.util.spec_from_file_location("videoer_texture_geometry_probe", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_texture(path, semantic, width=64, height=32):
    image = bpy.data.images.new(f"fixture-{semantic}", width=width, height=height, alpha=True)
    pixels = []
    for y in range(height):
        for x in range(width):
            # Deliberately directional and 2:1. Red/blue vertical bars encode U;
            # the green horizontal pulse encodes V. Stretching or swapping the
            # physical axes is therefore visible on every dominant projection.
            u_band = (x // 8) % 2
            v_band = (y // 4) % 2
            if semantic == "base-color":
                color = (
                    0.82 if u_band == 0 else 0.04,
                    0.72 if v_band == 0 else 0.05,
                    0.82 if u_band == 1 else 0.04,
                    1,
                )
            elif semantic == "normal":
                color = (0.5 + (u_band - 0.5) * 0.12, 0.5, 1, 1)
            elif semantic == "roughness":
                value = 0.22 if u_band else 0.82
                color = (value, value, value, 1)
            elif semantic == "metallic":
                value = 0.65 if u_band else 0.05
                color = (value, value, value, 1)
            elif semantic == "ambient-occlusion":
                value = 1.0 if v_band else 0.58
                color = (value, value, value, 1)
            elif semantic == "displacement":
                value = 0.56 if v_band else 0.44
                color = (value, value, value, 1)
            else:
                color = (0.9, 0.9, 0.9, 1)
            pixels.extend(color)
    image.pixels = pixels
    image.filepath_raw = path
    image.file_format = "PNG"
    image.save()
    bpy.data.images.remove(image)
    with open(path, "rb") as handle:
        content = handle.read()
    return {
        "semantic": semantic,
        "providerName": "NormalGL" if semantic == "normal" else semantic,
        "path": os.path.relpath(path, os.path.dirname(os.path.dirname(path))).replace(os.sep, "/"),
        "mediaType": "image/png",
        "sha256": hashlib.sha256(content).hexdigest(),
        "sizeBytes": len(content),
        "colorSpace": "srgb-texture" if semantic == "base-color" else "non-color",
        **(
            {"normalConvention": "opengl-positive-green"}
            if semantic == "normal"
            else {}
        ),
    }


def main():
    if "--" not in sys.argv or len(sys.argv[sys.argv.index("--") + 1 :]) != 1:
        raise RuntimeError("Expected output directory after --")
    output = os.path.abspath(sys.argv[sys.argv.index("--") + 1])
    texture_directory = os.path.join(output, "textures")
    os.makedirs(texture_directory, exist_ok=True)
    geometry_probe = load_geometry_probe()
    geometry_probe.clear_scene()
    semantics = [
        "base-color",
        "normal",
        "roughness",
        "metallic",
        "ambient-occlusion",
        "displacement",
        "opacity",
    ]
    channels = [
        write_texture(os.path.join(texture_directory, f"{semantic}.png"), semantic)
        for semantic in semantics
    ]
    surface = {
        "schemaVersion": 1,
        "id": "material.blender-pbr-texture-probe",
        "shadingModel": "metallic-roughness",
        "baseColor": {
            "kind": "procedural-palette",
            "colors": [[0.2, 0.2, 0.2, 1], [0.3, 0.3, 0.3, 1]],
            "scaleMeters": 0.2,
            "seed": 71,
        },
        "normal": {"kind": "procedural-noise", "strength": 0.7, "scaleMeters": 0.012},
        "roughness": {
            "minimum": 0.25,
            "maximum": 0.8,
            "variationScaleMeters": 0.08,
            "wetness": 0,
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
                "rationale": "Runtime material-application fixture.",
            },
            "application": {
                "constructionDomain": "prop-surface",
                "placement": {
                    "scalePolicy": "preserve-source-physical-scale",
                    "orientation": "world-horizontal",
                    "offsetMeters": [0.1, -0.2],
                    "rotationDegrees": 30,
                    "appearance": {
                        "exposureStops": -0.15,
                        "saturationScale": 0.9,
                        "hueShiftDegrees": 3,
                        "roughnessScale": 1.05,
                        "roughnessOffset": 0.02,
                        "weatheringAmount": 0.2,
                    },
                    "macroVariation": {
                        "seed": 71,
                        "scaleMeters": 2.0,
                        "valueAmplitude": 0.12,
                        "saturationAmplitude": 0.08,
                        "hueAmplitudeDegrees": 2,
                        "roughnessAmplitude": 0.1,
                        "weatheringAmplitude": 0.25,
                    },
                },
            },
            "channels": channels,
        },
        "metadata": {"fixture": "blender-runtime"},
    }
    definition = {
        "id": "probe-material",
        "baseColor": [0.2, 0.2, 0.2, 1],
        "metallic": 0,
        "roughness": 0.5,
        "surface": surface,
    }
    cube_asset = {
        "id": "geometry.physical-scale-texture-witness",
        "positions": [
            [-0.75, 0, -0.75],
            [0.75, 0, -0.75],
            [0.75, 1.5, -0.75],
            [-0.75, 1.5, -0.75],
            [-0.75, 0, 0.75],
            [0.75, 0, 0.75],
            [0.75, 1.5, 0.75],
            [-0.75, 1.5, 0.75],
        ],
        "indices": [
            0, 1, 2, 0, 2, 3,
            5, 4, 7, 5, 7, 6,
            4, 0, 3, 4, 3, 7,
            1, 5, 6, 1, 6, 2,
            3, 2, 6, 3, 6, 7,
            4, 5, 1, 4, 1, 0,
        ],
        "materials": [definition],
        "materialGroups": [{"materialId": "probe-material", "start": 0, "count": 36}],
        "skeleton": [{"id": "root", "restPosition": [0, 0, 0], "constraints": {}}],
        "metadata": {"fixture": "cinematic-create-mesh-path"},
    }
    cube = geometry_probe.create_mesh(cube_asset, None, output)
    cube.name = "physical-scale-texture-witness"
    cube.location.x = -1.0
    material = cube.data.materials[0]
    report = json.loads(material["videoer_texture_report"])
    node_names = {node.name for node in material.node_tree.nodes}
    required_nodes = {
        "videoer-physical-xy-mapping",
        "videoer-opengl-normal-map",
        "videoer-texture-displacement",
        "videoer-base-color-ambient-occlusion",
        *{f"videoer-texture-{semantic}" for semantic in semantics},
        *{
            f"videoer-texture-{semantic}-{plane}"
            for semantic in semantics
            for plane in ("xy",)
        },
        "videoer-application-hsv",
        "videoer-application-macro-noise",
        "videoer-application-roughness-scale",
        "videoer-application-roughness-offset",
        "videoer-application-weathering",
    }
    absent_nodes = sorted(required_nodes - node_names)
    if absent_nodes:
        raise RuntimeError(f"Blender PBR graph lacks nodes: {absent_nodes}")
    expected_plane_mapping = {"xy": {"axes": ["X", "Y"], "scale": [2.0, 4.0]}}
    if report["mapping"]["kind"] != "world-horizontal-physical" or report["mapping"]["planes"] != expected_plane_mapping:
        raise RuntimeError(f"World-horizontal mapping is incorrect: {report['mapping']}")
    graph_plane_scales = {"xy": report["mapping"]["planes"]["xy"]["scale"]}
    measured_repeats = {
        plane: {
            "uAcross1_5Meters": 1.5 * graph_plane_scales[plane][0],
            "vAcross1_5Meters": 1.5 * graph_plane_scales[plane][1],
            "repeatAspect": graph_plane_scales[plane][1] / graph_plane_scales[plane][0],
        }
        for plane in report["mapping"]["planes"]
    }
    if any(
        measurement != {
            "uAcross1_5Meters": 3.0, "vAcross1_5Meters": 6.0, "repeatAspect": 2.0,
        }
        for measurement in measured_repeats.values()
    ):
        raise RuntimeError(f"Triplanar repeat/aspect measurements are incorrect: {measured_repeats}")
    colors = {item["semantic"]: item["colorSpace"] for item in report["channels"]}
    if colors["base-color"] != "sRGB" or any(
        value != "Non-Color" for semantic, value in colors.items() if semantic != "base-color"
    ):
        raise RuntimeError(f"Blender image color spaces are incorrect: {colors}")

    vertical_definition = copy.deepcopy(definition)
    vertical_definition["id"] = "probe-material-world-vertical"
    vertical_placement = vertical_definition["surface"]["textureMaps"]["application"]["placement"]
    vertical_placement["orientation"] = "world-vertical"
    vertical_placement["offsetMeters"] = [-0.3, 0.25]
    vertical_placement["rotationDegrees"] = -20
    vertical_placement["macroVariation"]["seed"] = 197
    vertical_asset = copy.deepcopy(cube_asset)
    vertical_asset["id"] = "geometry.world-vertical-texture-witness"
    vertical_asset["materials"] = [vertical_definition]
    vertical_asset["materialGroups"][0]["materialId"] = vertical_definition["id"]
    vertical = geometry_probe.create_mesh(vertical_asset, None, output)
    vertical.name = "world-vertical-texture-witness"
    vertical.location.x = 1.0
    vertical_material = vertical.data.materials[0]
    vertical_report = json.loads(vertical_material["videoer_texture_report"])
    if vertical_report["mapping"] != {
        "kind": "world-vertical-triplanar",
        "orientation": "world-vertical",
        "offsetMeters": [-0.3, 0.25],
        "rotationDegrees": -20,
        "blendSharpness": 4.0,
        "planes": {
            "xz": {"axes": ["X", "Z"], "scale": [2.0, 4.0]},
            "yz": {"axes": ["Y", "Z"], "scale": [2.0, 4.0]},
        },
    }:
        raise RuntimeError(f"World-vertical application was not consumed exactly: {vertical_report['mapping']}")
    vertical_nodes = vertical_material.node_tree.nodes
    for semantic in semantics:
        for plane in ("xz", "yz"):
            if f"videoer-texture-{semantic}-{plane}" not in vertical_nodes:
                raise RuntimeError(f"World-vertical graph lacks {semantic} {plane} projection")
    horizontal_seed_offset = tuple(report["application"]["macroSeedOffset"])
    vertical_seed_offset = tuple(vertical_report["application"]["macroSeedOffset"])
    if horizontal_seed_offset == vertical_seed_offset:
        raise RuntimeError("Different macro seeds produced the same deterministic offset")
    horizontal_macro_scale = material.node_tree.nodes["videoer-application-macro-noise"].inputs["Scale"].default_value
    vertical_macro_scale = vertical_nodes["videoer-application-macro-noise"].inputs["Scale"].default_value
    if abs(horizontal_macro_scale - 0.5) > 1e-6 or abs(vertical_macro_scale - 0.5) > 1e-6:
        raise RuntimeError("Macro variation does not use the declared 2 metre scale")
    if abs(material.node_tree.nodes["videoer-application-roughness-scale"].inputs[1].default_value - 1.05) > 1e-6:
        raise RuntimeError("Appearance roughness scale was not applied")
    if abs(material.node_tree.nodes["videoer-application-roughness-offset"].inputs[1].default_value - 0.02) > 1e-6:
        raise RuntimeError("Appearance roughness offset was not applied")
    live_placement_values = {
        "uOffsetMeters": material.node_tree.nodes["videoer-application-xy-u-offset"].inputs[1].default_value,
        "vOffsetMeters": material.node_tree.nodes["videoer-application-xy-v-offset"].inputs[1].default_value,
        "rotationCosine": material.node_tree.nodes["videoer-application-xy-rotation-cosine"].inputs[1].default_value,
        "rotationSine": material.node_tree.nodes["videoer-application-xy-rotation-sine"].inputs[1].default_value,
        "sourceWidthMeters": material.node_tree.nodes["videoer-application-xy-u-source-scale"].inputs[1].default_value,
        "sourceHeightMeters": material.node_tree.nodes["videoer-application-xy-v-source-scale"].inputs[1].default_value,
    }
    expected_live_placement = {
        "uOffsetMeters": 0.1,
        "vOffsetMeters": -0.2,
        "rotationCosine": 3 ** 0.5 / 2,
        "rotationSine": 0.5,
        "sourceWidthMeters": 0.5,
        "sourceHeightMeters": 0.25,
    }
    if any(abs(live_placement_values[key] - expected) > 1e-6 for key, expected in expected_live_placement.items()):
        raise RuntimeError(f"Live placement values are incorrect: {live_placement_values}")
    live_application_values = {
        "hueBase": material.node_tree.nodes["videoer-application-hue"].inputs[1].default_value,
        "saturationBase": material.node_tree.nodes["videoer-application-saturation"].inputs[1].default_value,
        "exposureMultiplier": material.node_tree.nodes["videoer-application-value"].inputs[1].default_value,
        "macroValueAmplitude": material.node_tree.nodes["videoer-application-macro-value-amplitude"].inputs[1].default_value,
        "macroSaturationAmplitude": material.node_tree.nodes["videoer-application-macro-saturation-amplitude"].inputs[1].default_value,
        "macroHueAmplitudeTurns": material.node_tree.nodes["videoer-application-macro-hue-amplitude"].inputs[1].default_value,
        "macroRoughnessAmplitude": material.node_tree.nodes["videoer-application-macro-roughness-amplitude"].inputs[1].default_value,
        "macroWeatheringAmplitude": material.node_tree.nodes["videoer-application-macro-weathering-amplitude"].inputs[1].default_value,
        "weatheringAmount": material.node_tree.nodes["videoer-application-weathering-amount"].inputs[1].default_value,
    }
    expected_live_application = {
        "hueBase": 0.5 + 3 / 360,
        "saturationBase": 0.9,
        "exposureMultiplier": 2 ** -0.15,
        "macroValueAmplitude": 0.12,
        "macroSaturationAmplitude": 0.08,
        "macroHueAmplitudeTurns": 2 / 360,
        "macroRoughnessAmplitude": 0.1,
        "macroWeatheringAmplitude": 0.25,
        "weatheringAmount": 0.2,
    }
    if any(abs(live_application_values[key] - expected) > 1e-6 for key, expected in expected_live_application.items()):
        raise RuntimeError(f"Live appearance/macro values are incorrect: {live_application_values}")
    signed_source_names = {
        material.node_tree.nodes[node_name].inputs[0].links[0].from_node.name
        for node_name in (
            "videoer-application-macro-value-amplitude",
            "videoer-application-macro-saturation-amplitude",
            "videoer-application-macro-hue-amplitude",
            "videoer-application-macro-roughness-amplitude",
        )
    }
    weather_source_name = material.node_tree.nodes[
        "videoer-application-macro-weathering-amplitude"
    ].inputs[0].links[0].from_node.name
    if signed_source_names != {"videoer-application-macro-signed"} or weather_source_name != "videoer-application-macro-noise":
        raise RuntimeError(
            f"Macro channels are not identically registered: signed={signed_source_names}, weather={weather_source_name}"
        )

    uv_definition = copy.deepcopy(definition)
    uv_definition["id"] = "probe-material-uv-authored"
    uv_placement = uv_definition["surface"]["textureMaps"]["application"]["placement"]
    uv_placement["orientation"] = "uv-authored"
    uv_placement["offsetMeters"] = [0.04, -0.08]
    uv_placement["rotationDegrees"] = 12
    uv_placement["macroVariation"]["seed"] = 311
    uv_asset = copy.deepcopy(cube_asset)
    uv_asset["id"] = "geometry.uv-authored-texture-witness"
    uv_asset["materials"] = [uv_definition]
    uv_asset["materialGroups"][0]["materialId"] = uv_definition["id"]
    uv_asset["uvs"] = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0], [1, 0], [1, 1], [0, 1]]
    uv_mesh = geometry_probe.create_mesh(uv_asset, None, output)
    uv_mesh.hide_render = True
    uv_report = json.loads(uv_mesh.data.materials[0]["videoer_texture_report"])
    if uv_report["mapping"]["kind"] != "authored-uv-physical" or set(uv_report["mapping"]["planes"]) != {"uv"}:
        raise RuntimeError(f"UV-authored orientation is incorrect: {uv_report['mapping']}")
    rejected_missing_uv = False
    missing_uv_asset = copy.deepcopy(uv_asset)
    missing_uv_asset["id"] = "geometry.uv-authored-missing-uv"
    missing_uv_asset["uvs"] = []
    try:
        geometry_probe.create_mesh(missing_uv_asset, None, output)
    except RuntimeError:
        rejected_missing_uv = True
    if not rejected_missing_uv:
        raise RuntimeError("Blender accepted UV-authored texture application without UVs")

    rejected_missing_application = False
    missing_application = copy.deepcopy(definition)
    missing_application["id"] = "probe-material-missing-application"
    del missing_application["surface"]["textureMaps"]["application"]
    try:
        geometry_probe.create_material(missing_application, output)
    except RuntimeError:
        rejected_missing_application = True
    if not rejected_missing_application:
        raise RuntimeError("Blender accepted a texture-backed material without application")

    rejected_missing = False
    missing = copy.deepcopy(definition)
    missing["id"] = "probe-material-missing"
    missing["surface"]["textureMaps"]["channels"][0]["path"] = "textures/missing.png"
    try:
        geometry_probe.create_material(missing, output)
    except RuntimeError:
        rejected_missing = True
    if not rejected_missing:
        raise RuntimeError("Blender accepted a missing hash-bound texture")

    rejected_hash = False
    forged = copy.deepcopy(definition)
    forged["id"] = "probe-material-forged"
    forged["surface"]["textureMaps"]["channels"][0]["sha256"] = "f" * 64
    try:
        geometry_probe.create_material(forged, output)
    except RuntimeError:
        rejected_hash = True
    if not rejected_hash:
        raise RuntimeError("Blender accepted a texture hash mismatch")

    rejected_path_escape = False
    escaped = copy.deepcopy(definition)
    escaped["id"] = "probe-material-path-escape"
    escaped["surface"]["textureMaps"]["channels"][0]["path"] = "../escape.png"
    try:
        geometry_probe.create_material(escaped, output)
    except RuntimeError:
        rejected_path_escape = True
    if not rejected_path_escape:
        raise RuntimeError("Blender accepted a texture path escape")

    invalid_image_path = os.path.join(texture_directory, "invalid.png")
    with open(invalid_image_path, "wb") as handle:
        handle.write(b"not-a-decodable-png")
    with open(invalid_image_path, "rb") as handle:
        invalid_bytes = handle.read()
    rejected_invalid_image = False
    invalid = copy.deepcopy(definition)
    invalid["id"] = "probe-material-invalid-image"
    invalid_channel = invalid["surface"]["textureMaps"]["channels"][0]
    invalid_channel["path"] = "textures/invalid.png"
    invalid_channel["sha256"] = hashlib.sha256(invalid_bytes).hexdigest()
    invalid_channel["sizeBytes"] = len(invalid_bytes)
    try:
        geometry_probe.create_material(invalid, output)
    except RuntimeError:
        rejected_invalid_image = True
    if not rejected_invalid_image:
        raise RuntimeError("Blender accepted undecodable image bytes")

    procedural_definition = copy.deepcopy(definition)
    procedural_definition["id"] = "probe-material-procedural-control"
    del procedural_definition["surface"]["textureMaps"]
    procedural_material = geometry_probe.create_material(procedural_definition, output)
    procedural_preserved = (
        "videoer_texture_report" not in procedural_material
        and any(node.bl_idname == "ShaderNodeTexNoise" for node in procedural_material.node_tree.nodes)
    )
    if not procedural_preserved:
        raise RuntimeError("Texture consumption displaced the existing procedural material path")

    bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, -0.01))
    ground = bpy.context.object
    ground_material = bpy.data.materials.new("probe-ground")
    ground_material.diffuse_color = (0.025, 0.03, 0.04, 1)
    ground.data.materials.append(ground_material)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.world.color = (0.012, 0.015, 0.022)
    bpy.ops.object.camera_add(location=(4.4, -5.5, 3.2))
    camera = bpy.context.object
    camera.data.lens = 52
    camera.rotation_euler = (Vector((0, 0, 0.65)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = camera
    bpy.ops.object.light_add(type="AREA", location=(-2.5, -2.5, 4))
    key = bpy.context.object
    key.data.energy = 950
    key.data.size = 2.4
    key.rotation_euler = (Vector((0, 0, 0.7)) - key.location).to_track_quat("-Z", "Y").to_euler()
    bpy.ops.object.light_add(type="AREA", location=(2.5, 1.2, 2.6))
    rim = bpy.context.object
    rim.data.energy = 700
    rim.data.color = (0.35, 0.52, 1)
    rim.data.size = 1.6
    rim.rotation_euler = (Vector((0, 0, 0.8)) - rim.location).to_track_quat("-Z", "Y").to_euler()
    render_path = os.path.join(output, "texture-material-probe.png")
    scene.render.filepath = render_path
    bpy.ops.render.render(write_still=True)
    with open(os.path.join(output, "texture-material-report.json"), "w", encoding="utf-8") as handle:
        json.dump(
            {
                "schemaVersion": 1,
                "status": "structural-pass-visual-review-required",
                "channels": report["channels"],
                "physicalScale": report["physicalScale"],
                "mapping": report["mapping"],
                "liveBlenderGraphPlaneScales": graph_plane_scales,
                "measuredRepeatAspect": measured_repeats,
                "nodeNames": sorted(required_nodes),
                "failClosedChecks": {
                    "missingApplicationRejected": rejected_missing_application,
                    "missingUvRejected": rejected_missing_uv,
                    "missingTextureRejected": rejected_missing,
                    "hashMismatchRejected": rejected_hash,
                    "pathEscapeRejected": rejected_path_escape,
                    "invalidImageRejected": rejected_invalid_image,
                    "proceduralMaterialPreserved": procedural_preserved,
                },
                "applicationChecks": {
                    "worldHorizontal": report["mapping"],
                    "worldVertical": vertical_report["mapping"],
                    "horizontalSeed": 71,
                    "verticalSeed": 197,
                    "horizontalSeedOffset": horizontal_seed_offset,
                    "verticalSeedOffset": vertical_seed_offset,
                    "macroScaleInverseMeters": horizontal_macro_scale,
                    "uvAuthored": uv_report["mapping"],
                    "liveAppearanceAndMacro": live_application_values,
                    "livePlacement": live_placement_values,
                },
                "render": os.path.basename(render_path),
            },
            handle,
            indent=2,
        )
        handle.write("\n")


if __name__ == "__main__":
    main()
