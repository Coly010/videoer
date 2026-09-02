"""Focused Blender runtime probe for renderer-independent optical puddle surfaces."""

import copy
import importlib.util
import json
import math
import os
import sys

import bpy
from mathutils import Vector


def load_cinematic_renderer():
    path = os.path.join(os.path.dirname(__file__), "render_cinematic_scene.py")
    spec = importlib.util.spec_from_file_location("videoer_optical_water_renderer", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def optical_fixture():
    boundary = [
        (-1.05, -0.38), (-0.62, -0.78), (0.18, -0.87), (0.92, -0.42),
        (1.08, 0.24), (0.54, 0.73), (-0.22, 0.82), (-0.94, 0.46),
    ]
    xz = [(0.0, 0.0), *boundary]
    depths = [0.008, *([0.0] * len(boundary))]
    optical_offset = 0.0002
    positions = [[x, optical_offset + depths[index], z] for index, (x, z) in enumerate(xz)]
    indices = []
    for index in range(len(boundary)):
        indices.extend([0, ((index + 1) % len(boundary)) + 1, index + 1])
    volume = 0.0
    for offset in range(0, len(indices), 3):
        a, b, c = [positions[index] for index in indices[offset : offset + 3]]
        area = abs((b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0])) * 0.5
        volume += area * sum(depths[index] for index in indices[offset : offset + 3]) / 3
    return {
        "schemaVersion": 2,
        "id": "surface-water.probe-optical-puddle",
        "generator": "videoer.surface-water-optical-surface.v2",
        "sourceFieldId": "surface-water.probe-field",
        "sourceFieldSha256": "a" * 64,
        "reconstructionSha256": "b" * 64,
        "options": {
            "contourDepthMeters": 0.00001,
            "opticalOffsetMeters": optical_offset,
            "maximumVolumeCorrectionFactor": 20,
            "subcellDivisions": 4,
        },
        "appearance": {
            "model": "thin-dielectric-water-v1",
            "ior": 1.333,
            "roughness": 0.035,
            "absorptionColorLinear": [0.72, 0.9, 0.95],
            "absorptionDistanceMeters": 4,
        },
        "positions": positions,
        "groundHeightsMeters": [0.0] * len(positions),
        "depthsMeters": depths,
        "indices": indices,
        "report": {
            "sourceWetCellCount": 31,
            "vertexCount": len(positions),
            "triangleCount": len(indices) // 3,
            "boundaryVertexCount": len(boundary),
            "nonGridAlignedBoundaryVertexCount": len(boundary),
            "sourcePuddleVolumeCubicMeters": volume,
            "rawReconstructedVolumeCubicMeters": volume,
            "reconstructedVolumeCubicMeters": volume,
            "volumeCorrectionFactor": 1,
            "volumeErrorCubicMeters": 0,
            "maximumSourcePuddleDepthMeters": 0.008,
            "maximumReconstructedDepthMeters": 0.008,
            "boundaryEdgeCount": len(boundary),
            "boundaryPerimeterMeters": sum(
                math.dist(boundary[index], boundary[(index + 1) % len(boundary)])
                for index in range(len(boundary))
            ),
            "axisAlignedBoundaryLengthRatio": 0,
            "maximumAxisAlignedBoundaryRunMeters": 0,
            "refinedCellSizeMeters": 0.125,
        },
    }


def optical_v3_fixture():
    surface = optical_fixture()
    surface["schemaVersion"] = 3
    surface["id"] = "surface-water.probe-optical-puddle-v3"
    surface["generator"] = "videoer.surface-water-optical-surface.v3"
    surface["supportModel"] = "wendland-c2-area-calibrated-v1"
    surface["options"].pop("contourDepthMeters")
    projected_area = 0.0
    for offset in range(0, len(surface["indices"]), 3):
        a, b, c = [
            surface["positions"][index] for index in surface["indices"][offset : offset + 3]
        ]
        projected_area += (
            abs((b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]))
            * 0.5
        )
    report = surface["report"]
    report.update(
        {
            "sourceSupportAreaSquareMeters": projected_area,
            "projectedAreaSquareMeters": projected_area,
            "projectedAreaErrorSquareMeters": 0,
            "projectedAreaRatio": 1,
            "sourceMeanPuddleDepthMeters": report["sourcePuddleVolumeCubicMeters"]
            / projected_area,
            "supportContourThreshold": 0.4,
            "receiverContourThreshold": 0.5,
            "depthCorrectionFactor": 1,
            "maximumAllowedReconstructedDepthMeters": report[
                "maximumSourcePuddleDepthMeters"
            ],
            "receiverCoverageModel": "legacy-full-wet-cell-kernel-mask-v1",
            "receiverEscapeAreaSquareMeters": 0,
        }
    )
    return surface


def render_linear_pixels(scene, path):
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    width = round(scene.render.resolution_x * scene.render.resolution_percentage / 100)
    height = round(scene.render.resolution_y * scene.render.resolution_percentage / 100)
    result = bpy.data.images.load(path, check_existing=False)
    rgba = list(result.pixels)
    if len(rgba) != width * height * 4:
        raise RuntimeError(
            f"optical puddle render returned {len(rgba)} channel values, expected {width * height * 4}"
        )
    bpy.data.images.remove(result)
    luminance = [
        rgba[offset] * 0.2126 + rgba[offset + 1] * 0.7152 + rgba[offset + 2] * 0.0722
        for offset in range(0, len(rgba), 4)
    ]
    return width, height, luminance


def eroded_mask(mask, width, height):
    interior = []
    for y in range(1, height - 1):
        for x in range(1, width - 1):
            index = y * width + x
            if all(
                mask[neighbour]
                for neighbour in (index, index - 1, index + 1, index - width, index + width)
            ):
                interior.append(index)
    return interior


def percentile(values, amount):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, round((len(ordered) - 1) * amount))]


def assert_thin_dielectric_structure(water, report, surface, expected_material_model):
    material = water.data.materials[0]
    nodes = material.node_tree.nodes
    if any(node.type == "BSDF_PRINCIPLED" for node in nodes):
        raise RuntimeError("optical puddle retained an opaque/transmission Principled sheet")
    required = {
        "videoer-water-output": "OUTPUT_MATERIAL",
        "videoer-water-receiver-view": "BSDF_TRANSPARENT",
        "videoer-water-transmittance": "ATTRIBUTE",
        "videoer-water-fresnel-reflection": "BSDF_GLOSSY",
        "videoer-water-fresnel": "FRESNEL",
        "videoer-water-interface": "MIX_SHADER",
    }
    for name, node_type in required.items():
        node = nodes.get(name)
        if node is None or node.type != node_type:
            raise RuntimeError(f"optical puddle lacks required {name} node")
    actual_links = {
        (link.from_node.name, link.from_socket.name, link.to_node.name, link.to_socket.name)
        for link in material.node_tree.links
    }
    required_links = {
        (
            "videoer-water-transmittance",
            "Color",
            "videoer-water-receiver-view",
            "Color",
        ),
        ("videoer-water-fresnel", "Fac", "videoer-water-interface", "Fac"),
        ("videoer-water-interface", "Shader", "videoer-water-output", "Surface"),
    }
    if not required_links.issubset(actual_links):
        raise RuntimeError("optical puddle thin-interface node links are incomplete")
    fresnel = nodes["videoer-water-fresnel"]
    reflection = nodes["videoer-water-fresnel-reflection"]
    appearance = surface["appearance"]
    if abs(fresnel.inputs["IOR"].default_value - appearance["ior"]) > 1e-6:
        raise RuntimeError("optical puddle did not bind declared IOR")
    if abs(reflection.inputs["Roughness"].default_value - appearance["roughness"]) > 1e-6:
        raise RuntimeError("optical puddle did not bind declared roughness")
    if report["materialModel"] != expected_material_model:
        raise RuntimeError("optical puddle did not report its declared thin-interface backend")
    if nodes["videoer-water-transmittance"].attribute_name != report["transmittanceAttribute"]:
        raise RuntimeError("optical puddle shader does not read its transmittance attribute")
    depth_attribute = water.data.attributes.get(report["depthAttribute"])
    transmittance_attribute = water.data.attributes.get(report["transmittanceAttribute"])
    if depth_attribute is None or transmittance_attribute is None:
        raise RuntimeError("optical puddle lost declared per-vertex optical evidence")
    for index, depth in enumerate(surface["depthsMeters"]):
        if abs(depth_attribute.data[index].value - depth) > 1e-7:
            raise RuntimeError("optical puddle depth attribute differs from source depth")
    expected_red = appearance["absorptionColorLinear"][0] ** (
        surface["depthsMeters"][0] / appearance["absorptionDistanceMeters"]
    )
    if abs(transmittance_attribute.data[0].color[0] - expected_red) > 1e-5:
        raise RuntimeError("optical puddle transmittance is not derived from declared depth")


def render_optical_evidence(scene, output, water, ground):
    water.hide_render = True
    width, height, dry = render_linear_pixels(scene, os.path.join(output, "optical-puddle-dry.png"))
    water.hide_render = False
    wet_width, wet_height, wet = render_linear_pixels(
        scene, os.path.join(output, "optical-puddle-wet.png")
    )
    if (wet_width, wet_height) != (width, height):
        raise RuntimeError("paired optical puddle renders differ in size")

    original_material = water.data.materials[0]
    mask_material = bpy.data.materials.new("optical-puddle-footprint-mask")
    mask_material.use_nodes = True
    mask_nodes = mask_material.node_tree.nodes
    mask_links = mask_material.node_tree.links
    mask_nodes.clear()
    emission = mask_nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = (1, 1, 1, 1)
    emission.inputs["Strength"].default_value = 1
    output_node = mask_nodes.new("ShaderNodeOutputMaterial")
    mask_links.new(emission.outputs[0], output_node.inputs["Surface"])
    original_world_color = tuple(scene.world.color)
    world_background = (
        scene.world.node_tree.nodes.get("Background")
        if scene.world and scene.world.use_nodes and scene.world.node_tree
        else None
    )
    original_background_color = (
        tuple(world_background.inputs["Color"].default_value) if world_background else None
    )
    original_background_strength = (
        world_background.inputs["Strength"].default_value if world_background else None
    )
    original_denoising = scene.cycles.use_denoising
    ground.hide_render = True
    scene.world.color = (0, 0, 0)
    if world_background:
        world_background.inputs["Color"].default_value = (0, 0, 0, 1)
        world_background.inputs["Strength"].default_value = 0
    scene.cycles.use_denoising = False
    water.data.materials[0] = mask_material
    mask_width, mask_height, mask_luminance = render_linear_pixels(
        scene, os.path.join(output, "optical-puddle-footprint-mask.png")
    )
    water.data.materials[0] = original_material
    ground.hide_render = False
    scene.world.color = original_world_color
    scene.cycles.use_denoising = original_denoising
    if world_background:
        world_background.inputs["Color"].default_value = original_background_color
        world_background.inputs["Strength"].default_value = original_background_strength
    if (mask_width, mask_height) != (width, height):
        raise RuntimeError("optical puddle mask differs from evidence render size")

    mask = [value > 0.5 for value in mask_luminance]
    footprint = eroded_mask(mask, width, height)
    coverage = sum(mask) / len(mask)
    if len(footprint) < 250 or not 0.02 < coverage < 0.45:
        raise RuntimeError("opaque optical mask does not isolate a useful water footprint")
    far_background = []
    for y in range(1, height - 1):
        for x in range(1, width - 1):
            index = y * width + x
            neighbourhood = (
                (y + dy) * width + x + dx
                for dy in (-1, 0, 1)
                for dx in (-1, 0, 1)
            )
            if not any(mask[neighbour] for neighbour in neighbourhood):
                far_background.append(mask_luminance[index])
    if not far_background or max(far_background) > 0.02:
        raise RuntimeError("opaque optical mask contains non-water background response")

    dry_values = [dry[index] for index in footprint]
    wet_values = [wet[index] for index in footprint]
    deltas = [wet[index] - dry[index] for index in footprint]
    dry_mean = sum(dry_values) / len(dry_values)
    wet_mean = sum(wet_values) / len(wet_values)
    if dry_mean <= 0.01:
        raise RuntimeError("dry receiver is not visible inside the measured water footprint")
    mean_ratio = wet_mean / dry_mean
    if not 0.55 <= mean_ratio <= 1.25:
        raise RuntimeError(f"thin water interface darkened its receiver implausibly: {mean_ratio}")
    black_threshold = max(0.004, dry_mean * 0.12)
    dry_black = sum(value < black_threshold for value in dry_values) / len(dry_values)
    wet_black = sum(value < black_threshold for value in wet_values) / len(wet_values)
    black_growth = wet_black - dry_black
    if black_growth > 0.08:
        raise RuntimeError(f"thin water interface created excessive black growth: {black_growth}")
    positive_fraction = sum(delta > 0.003 for delta in deltas) / len(deltas)
    positive_p95 = percentile(deltas, 0.95)
    if positive_fraction < 0.002 or positive_p95 <= 0.008:
        raise RuntimeError("thin water interface produced no footprint-local specular witness")
    if positive_fraction > 0.45 or positive_p95 > 1.5:
        raise RuntimeError("thin water interface specular witness is not restrained")
    return {
        "footprintPixelCount": len(footprint),
        "footprintCoverage": coverage,
        "dryMeanLuminance": dry_mean,
        "wetMeanLuminance": wet_mean,
        "wetDryMeanRatio": mean_ratio,
        "blackPixelFractionGrowth": black_growth,
        "positiveSpecularPixelFraction": positive_fraction,
        "positiveSpecularDeltaP95": positive_p95,
    }


def main():
    if "--" not in sys.argv or len(sys.argv[sys.argv.index("--") + 1 :]) != 1:
        raise RuntimeError("Expected output directory after --")
    output = os.path.abspath(sys.argv[sys.argv.index("--") + 1])
    os.makedirs(output, exist_ok=True)
    renderer = load_cinematic_renderer()
    renderer.geometry_probe.clear_scene()
    bpy.context.scene.render.engine = "CYCLES"

    surface = optical_fixture()
    surface_path = os.path.join(output, "optical-surface.json")
    with open(surface_path, "w", encoding="utf-8") as handle:
        json.dump(surface, handle, indent=2)
        handle.write("\n")
    definition = {
        "id": "environment.optical-water-probe",
        "surfaceWaterOpticalSurfacePath": surface_path,
        "visible": True,
    }
    field_report = {
        "fieldId": surface["sourceFieldId"],
        "fieldSha256": surface["sourceFieldSha256"],
    }
    report = renderer.create_surface_water_optical_surface(definition, field_report)
    water = bpy.data.objects[report["objectName"]]
    if len(water.data.vertices) != len(surface["positions"]):
        raise RuntimeError("optical puddle did not preserve renderer-independent vertices")
    if len(water.data.polygons) != len(surface["indices"]) // 3:
        raise RuntimeError("optical puddle did not preserve renderer-independent triangles")
    if any(len(polygon.vertices) != 3 for polygon in water.data.polygons):
        raise RuntimeError("optical puddle introduced non-triangle per-cell surfaces")
    if len([obj for obj in bpy.context.scene.objects if "optical-water-surface" in obj.name]) != 1:
        raise RuntimeError("optical puddle was split into per-cell renderer objects")
    assert_thin_dielectric_structure(
        water, report, surface, "thin-dielectric-interface-cycles-v2"
    )

    surface_v3 = optical_v3_fixture()
    surface_v3_path = os.path.join(output, "optical-surface-v3.json")
    with open(surface_v3_path, "w", encoding="utf-8") as handle:
        json.dump(surface_v3, handle, indent=2)
        handle.write("\n")
    v3_definition = {
        **definition,
        "id": "environment.optical-water-probe-v3",
        "surfaceWaterOpticalSurfacePath": surface_v3_path,
    }
    v3_report = renderer.create_surface_water_optical_surface(v3_definition, field_report)
    if v3_report["appearanceSource"] != "surface-v3":
        raise RuntimeError("optical puddle v3 did not preserve its appearance source")
    if abs(
        v3_report["projectedAreaSquareMeters"]
        - surface_v3["report"]["sourceSupportAreaSquareMeters"]
    ) > 1e-8:
        raise RuntimeError("optical puddle v3 did not preserve source support area")
    forged_support = copy.deepcopy(surface_v3)
    forged_support["report"]["sourceSupportAreaSquareMeters"] *= 2
    forged_support_path = os.path.join(output, "invalid-optical-support-v3.json")
    with open(forged_support_path, "w", encoding="utf-8") as handle:
        json.dump(forged_support, handle)
    try:
        renderer.create_surface_water_optical_surface(
            {**v3_definition, "surfaceWaterOpticalSurfacePath": forged_support_path}, field_report
        )
    except RuntimeError as error:
        invalid_support_rejected = "inflates source wet support" in str(error)
    else:
        invalid_support_rejected = False
    if not invalid_support_rejected:
        raise RuntimeError("optical puddle v3 accepted forged source support area")
    bpy.data.objects.remove(bpy.data.objects[v3_report["objectName"]], do_unlink=True)

    invalid = copy.deepcopy(surface)
    invalid["indices"][0] = len(invalid["positions"])
    invalid_path = os.path.join(output, "invalid-optical-surface.json")
    with open(invalid_path, "w", encoding="utf-8") as handle:
        json.dump(invalid, handle)
    invalid_definition = {**definition, "surfaceWaterOpticalSurfacePath": invalid_path}
    try:
        renderer.create_surface_water_optical_surface(invalid_definition, field_report)
    except RuntimeError as error:
        invalid_index_rejected = "invalid index" in str(error)
    else:
        invalid_index_rejected = False
    if not invalid_index_rejected:
        raise RuntimeError("optical puddle accepted an out-of-range triangle index")
    try:
        renderer.create_surface_water_optical_surface(
            definition, {**field_report, "fieldSha256": "c" * 64}
        )
    except RuntimeError as error:
        source_hash_mismatch_rejected = "source field hash" in str(error)
    else:
        source_hash_mismatch_rejected = False
    if not source_hash_mismatch_rejected:
        raise RuntimeError("optical puddle accepted a mismatched source field hash")
    invalid_appearance = copy.deepcopy(surface)
    invalid_appearance["appearance"]["roughness"] = 0.9
    invalid_appearance_path = os.path.join(output, "invalid-optical-appearance.json")
    with open(invalid_appearance_path, "w", encoding="utf-8") as handle:
        json.dump(invalid_appearance, handle)
    try:
        renderer.create_surface_water_optical_surface(
            {**definition, "surfaceWaterOpticalSurfacePath": invalid_appearance_path}, field_report
        )
    except RuntimeError as error:
        invalid_appearance_rejected = "appearance is invalid" in str(error)
    else:
        invalid_appearance_rejected = False
    if not invalid_appearance_rejected:
        raise RuntimeError("optical puddle accepted an out-of-contract appearance")

    bpy.context.scene.render.engine = "BLENDER_EEVEE_NEXT"
    eevee_definition = {**definition, "id": "environment.optical-water-probe-eevee"}
    eevee_report = renderer.create_surface_water_optical_surface(eevee_definition, field_report)
    eevee_water = bpy.data.objects[eevee_report["objectName"]]
    assert_thin_dielectric_structure(
        eevee_water,
        eevee_report,
        surface,
        "thin-fresnel-transparent-eevee-approximation-v2",
    )
    if eevee_water.data.materials[0].surface_render_method != "DITHERED":
        raise RuntimeError("Eevee optical puddle does not declare its transparent approximation")
    bpy.data.objects.remove(eevee_water, do_unlink=True)
    bpy.context.scene.render.engine = "CYCLES"

    bpy.ops.mesh.primitive_plane_add(size=7, location=(0, 0, 0))
    ground = bpy.context.object
    ground.name = "continuous-wet-receiver-witness"
    ground_material = bpy.data.materials.new("continuous-wet-receiver-witness")
    ground_material.diffuse_color = (0.055, 0.05, 0.045, 1)
    ground_material.roughness = 0.24
    ground.data.materials.append(ground_material)

    bpy.ops.object.camera_add(location=(2.8, -3.6, 2.15))
    camera = bpy.context.object
    look_at(camera, (0, 0, 0))
    camera.data.lens = 62
    bpy.context.scene.camera = camera
    # Mirror the camera direction around the horizontal surface normal so the
    # raking key gives the dielectric a deterministic specular witness.
    bpy.ops.object.light_add(type="AREA", location=(-2.8, 3.6, 2.15))
    key = bpy.context.object
    key.data.energy = 950
    key.data.shape = "RECTANGLE"
    key.data.size = 0.7
    look_at(key, (0, 0, 0))
    bpy.ops.object.light_add(type="AREA", location=(2.5, 1.2, 2.8))
    fill = bpy.context.object
    fill.data.energy = 380
    fill.data.size = 2.0
    look_at(fill, (0, 0, 0))

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 512
    scene.render.resolution_y = 384
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.world.color = (0.008, 0.01, 0.014)
    visual_metrics = render_optical_evidence(scene, output, water, ground)
    with open(os.path.join(output, "optical-puddle-report.json"), "w", encoding="utf-8") as handle:
        json.dump(
            {
                "schemaVersion": 1,
                "result": "structural-and-visual-pass",
                "visualAcceptance": "footprint-scoped-paired-evidence-pass",
                "continuousWetReceiverWitness": True,
                "invalidIndexRejected": invalid_index_rejected,
                "sourceHashMismatchRejected": source_hash_mismatch_rejected,
                "invalidAppearanceRejected": invalid_appearance_rejected,
                "eeveeApproximationStructurallyVerified": True,
                "singleMeshObject": True,
                "allFacesTriangles": True,
                "structuralThinDielectricInterface": True,
                "backgroundExcludedByOpaqueFootprintMask": True,
                "visualMetrics": visual_metrics,
                **report,
            },
            handle,
            indent=2,
        )
        handle.write("\n")


if __name__ == "__main__":
    main()
