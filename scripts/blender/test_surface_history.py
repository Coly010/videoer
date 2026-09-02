"""Focused Blender contract probe for causal construction-surface history."""

import importlib.util
import json
import os
import sys

import bpy
from mathutils import Vector


def load_renderer():
    path = os.path.join(os.path.dirname(__file__), "render_cinematic_scene.py")
    spec = importlib.util.spec_from_file_location("videoer_surface_history_renderer", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_json(path, value):
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2)
        handle.write("\n")


def main():
    if "--" not in sys.argv or len(sys.argv[sys.argv.index("--") + 1 :]) != 1:
        raise RuntimeError("Usage: test_surface_history.py -- output-directory")
    output = sys.argv[sys.argv.index("--") + 1]
    os.makedirs(output, exist_ok=True)
    renderer = load_renderer()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    transform = {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}
    asset = {
        "id": "environment.surface-history-native-probe",
        "positions": [[0, 0, 0], [2, 0, 0], [2, 0, 2], [0, 0, 2]],
        "materials": [
            {
                "id": "stone",
                "surface": {
                    "historyResponse": {
                        "trafficWear": {"colorMultiplier": 1.05, "roughnessOffset": -0.15},
                        "longTermExposure": {"colorMultiplier": 1.02, "roughnessOffset": 0.03},
                        "runoffStaining": {"colorMultiplier": 0.72, "roughnessOffset": 0.12},
                        "repairInfluence": {"colorMultiplier": 1.1, "roughnessOffset": -0.04},
                    }
                },
            }
        ],
    }
    mesh_data = bpy.data.meshes.new("surface-history-probe-mesh")
    mesh_data.from_pydata(
        [renderer.geometry_probe.to_blender(point) for point in asset["positions"]],
        [],
        [(0, 1, 2), (0, 2, 3)],
    )
    mesh = bpy.data.objects.new("surface-history-probe", mesh_data)
    bpy.context.collection.objects.link(mesh)
    material = bpy.data.materials.new("stone")
    material.use_nodes = True
    mesh_data.materials.append(material)
    cells = []
    for index, (column, row) in enumerate(((0, 0), (1, 0), (0, 1), (1, 1))):
        cells.append(
            {
                "index": index,
                "column": column,
                "row": row,
                "worldPosition": [column + 0.5, 0, row + 0.5],
                "triangleIndex": 0 if row == 0 else 1,
                "materialId": "stone",
                "targetClass": "modeled-unit",
                "coverage": 1,
                "trafficWear": 1 if column == 0 else 0,
                "longTermExposure": 1,
                "runoffStaining": 1 if row == 1 else 0,
                "repairInfluence": 1 if index == 3 else 0,
                "repairId": "repair-a" if index == 3 else None,
                "repairRelativeAge": 0.1 if index == 3 else 0,
            }
        )
    grid = {
        "worldOriginXZ": [0, 0],
        "cellSizeMeters": 1,
        "columns": 2,
        "rows": 2,
        "supersample": 1,
        "activeCellCount": 4,
    }
    receiver = {
        "geometryId": asset["id"],
        "geometrySha256": "a" * 64,
        "geometrySemanticSha256": "b" * 64,
        "transform": transform,
        "transformSha256": "c" * 64,
    }
    water = {
        "id": "environment.surface-history-native-water",
        "fieldSha256": "d" * 64,
        "grid": grid,
        "cells": [
            {
                key: cell[key]
                for key in (
                    "index",
                    "column",
                    "row",
                    "worldPosition",
                    "triangleIndex",
                    "materialId",
                )
            }
            for cell in cells
        ],
    }
    history = {
        "schemaVersion": 1,
        "id": "environment.surface-history-native",
        "generator": "videoer.construction-surface-history.v1",
        "fieldSha256": "e" * 64,
        "receiver": receiver,
        "sourceWaterField": {"id": water["id"], "fieldSha256": water["fieldSha256"]},
        "grid": grid,
        "cells": cells,
    }
    water_path = os.path.join(output, "water.json")
    history_path = os.path.join(output, "history.json")
    write_json(water_path, water)
    write_json(history_path, history)
    definition = {
        "id": "environment.surface-history-native-probe",
        "transform": transform,
        "surfaceWaterFieldPath": water_path,
        "surfaceHistoryFieldPath": history_path,
    }
    report = renderer.create_surface_history(definition, asset, mesh)
    if report["responseMaterialIds"] != ["stone"]:
        raise RuntimeError("surface history did not bind the declared material response")
    if report["trafficAffectedCellCount"] != 2 or report["runoffAffectedCellCount"] != 2:
        raise RuntimeError("surface history report lost causal cell counts")
    bound = mesh.data.materials[0]
    nodes = bound.node_tree.nodes
    for name in (
        "videoer-surface-history-uv",
        "videoer-surface-history-field",
        "videoer-surface-history-channels",
    ):
        if nodes.get(name) is None:
            raise RuntimeError(f"surface history lacks required node '{name}'")
    if mesh.data.uv_layers.get("surface_history_uv") is None:
        raise RuntimeError("surface history did not bind its receiver UV domain")
    invalid = json.loads(json.dumps(history))
    invalid["cells"][0]["runoffStaining"] = 2
    write_json(history_path, invalid)
    try:
        renderer.create_surface_history(definition, asset, mesh)
        raise RuntimeError("surface history accepted an out-of-range causal channel")
    except RuntimeError as error:
        if "channel 'runoffStaining' is invalid" not in str(error):
            raise
    stale = json.loads(json.dumps(history))
    stale["cells"][0]["triangleIndex"] += 1
    write_json(history_path, stale)
    try:
        renderer.create_surface_history(definition, asset, mesh)
        raise RuntimeError("surface history accepted stale source-water topology")
    except RuntimeError as error:
        if "cell topology is stale" not in str(error):
            raise
    write_json(history_path, history)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 192
    scene.render.resolution_y = 192
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.dither_intensity = 0
    scene.world = bpy.data.worlds.new("surface-history-world")
    scene.world.color = (0.025, 0.025, 0.025)
    camera_data = bpy.data.cameras.new("surface-history-camera")
    camera = bpy.data.objects.new("surface-history-camera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (3.2, -3.2, 3.1)
    camera.rotation_euler = (Vector((1, -1, 0)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera_data.lens = 52
    scene.camera = camera
    light_data = bpy.data.lights.new("surface-history-key", "AREA")
    light_data.energy = 900
    light_data.shape = "DISK"
    light_data.size = 3
    light = bpy.data.objects.new("surface-history-key", light_data)
    bpy.context.collection.objects.link(light)
    light.location = (-2, -2, 4)
    semantic_path = os.path.join(output, "surface-history-semantic.png")
    control_path = os.path.join(output, "surface-history-control.png")
    scene.render.filepath = semantic_path
    bpy.ops.render.render(write_still=True)
    field_image = nodes["videoer-surface-history-field"].image
    field_image.pixels.foreach_set([0.0] * len(field_image.pixels))
    field_image.update()
    scene.render.filepath = control_path
    bpy.ops.render.render(write_still=True)
    semantic = bpy.data.images.load(semantic_path, check_existing=False)
    control = bpy.data.images.load(control_path, check_existing=False)
    semantic_pixels = list(semantic.pixels)
    control_pixels = list(control.pixels)
    difference = sum(
        abs(semantic_pixels[index] - control_pixels[index])
        for index in range(len(semantic_pixels))
        if index % 4 != 3
    ) / (len(semantic_pixels) * 0.75)
    if difference <= 0.002:
        raise RuntimeError(
            f"surface-history semantic/control renders differ by only {difference}"
        )
    report["semanticControlMeanAbsoluteLinearDifference"] = difference
    write_json(os.path.join(output, "surface-history-native-report.json"), report)


if __name__ == "__main__":
    main()
