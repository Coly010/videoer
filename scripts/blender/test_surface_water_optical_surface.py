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
        "schemaVersion": 1,
        "id": "surface-water.probe-optical-puddle",
        "generator": "videoer.surface-water-optical-surface.v1",
        "sourceFieldId": "surface-water.probe-field",
        "sourceFieldSha256": "a" * 64,
        "reconstructionSha256": "b" * 64,
        "options": {
            "contourDepthMeters": 0.00001,
            "opticalOffsetMeters": optical_offset,
            "maximumVolumeCorrectionFactor": 20,
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
        },
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
    principled = water.data.materials[0].node_tree.nodes.get("Principled BSDF")
    if (
        principled is None
        or abs(principled.inputs["IOR"].default_value - 1.333) > 1e-6
        or principled.inputs["Roughness"].default_value > 0.06
        or principled.inputs["Transmission Weight"].default_value < 0.9
    ):
        raise RuntimeError("optical puddle dielectric response is not physically restrained")

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
    scene.cycles.samples = 32
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 512
    scene.render.resolution_y = 384
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = os.path.join(output, "optical-puddle.png")
    scene.render.film_transparent = False
    scene.world.color = (0.008, 0.01, 0.014)
    bpy.ops.render.render(write_still=True)
    with open(os.path.join(output, "optical-puddle-report.json"), "w", encoding="utf-8") as handle:
        json.dump(
            {
                "schemaVersion": 1,
                "result": "structural-pass",
                "visualAcceptance": "not-assessed",
                "continuousWetReceiverWitness": True,
                "invalidIndexRejected": invalid_index_rejected,
                "sourceHashMismatchRejected": source_hash_mismatch_rejected,
                "singleMeshObject": True,
                "allFacesTriangles": True,
                **report,
            },
            handle,
            indent=2,
        )
        handle.write("\n")


if __name__ == "__main__":
    main()
