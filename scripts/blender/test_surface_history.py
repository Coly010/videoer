"""Focused Blender contract probe for causal construction-surface history."""

import importlib.util
import hashlib
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
        "positions": [[0, 0, 0], [4, 0, 0], [4, 0, 4], [0, 0, 4]],
        "materials": [
            {
                "id": "stone",
                "surface": {
                    "historyResponse": {
                        "trafficWear": {"colorMultiplier": 1.25, "roughnessOffset": -0.2},
                        "longTermExposure": {"colorMultiplier": 0.8, "roughnessOffset": 0.15},
                        "runoffStaining": {"colorMultiplier": 0.55, "roughnessOffset": 0.2},
                        "repairInfluence": {"colorMultiplier": 1.35, "roughnessOffset": -0.15},
                    },
                    "dirtMassResponse": {
                        "loose": {"colorMultiplier": 0.5, "roughnessOffset": 0.25},
                        "persistent": {"colorMultiplier": 0.72, "roughnessOffset": 0.15},
                    },
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
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = (0.22, 0.24, 0.27, 1)
    principled.inputs["Roughness"].default_value = 0.55
    mesh_data.materials.append(material)
    cells = []
    for row in range(8):
        for column in range(8):
            index = row * 8 + column
            repair = column >= 6 and row >= 6
            loose = 0.8 if abs(column - row) <= 1 else 0
            persistent = 0.65 if column >= 5 and 2 <= row <= 5 else 0
            cells.append(
                {
                    "index": index,
                    "column": column,
                    "row": row,
                    "worldPosition": [(column + 0.5) * 0.5, 0, (row + 0.5) * 0.5],
                    "triangleIndex": 0 if column >= row else 1,
                    "materialId": "stone",
                    "targetClass": "modeled-unit",
                    "coverage": 1,
                    "trafficWear": 0.85 if column in (1, 2) else 0,
                    "longTermExposure": 0.75 if row in (6, 7) else 0,
                    "runoffStaining": (0.7 + column * 0.03) if row in (0, 1) else 0,
                    "repairInfluence": 1 if repair else 0,
                    "repairId": "repair-a" if repair else None,
                    "repairRelativeAge": 0.2 if repair else 0,
                    "dirt": {
                        "builtUpMassKilograms": 1,
                        "persistentMassKilograms": 0.25,
                        "initialLooseMassKilograms": 0.75,
                        "incomingSuspendedMassKilograms": 0,
                        "mobilizedMassKilograms": 0.1,
                        "depositedMassKilograms": 0.05,
                        "finalLooseMassKilograms": 0.7,
                        "suspendedOutflowMassKilograms": 0.05,
                        "looseCoverage": loose,
                        "persistentCoverage": persistent,
                    },
                }
            )
    grid = {
        "worldOriginXZ": [0, 0],
        "cellSizeMeters": 0.5,
        "columns": 8,
        "rows": 8,
        "supersample": 1,
        "activeCellCount": 64,
    }
    receiver = {
        "geometryId": asset["id"],
        "geometrySha256": "a" * 64,
        "geometrySemanticSha256": "b" * 64,
        "transform": transform,
        "transformSha256": "c" * 64,
    }
    water = {
        "schemaVersion": 2,
        "id": "environment.surface-history-native-water",
        "generator": "videoer.static-surface-water.v2",
        "fieldSha256": "d" * 64,
        "routing": {
            "routingSha256": "f" * 64,
            "nodes": [
                {"index": index, "downstreamIndex": None, "rank": index}
                for index in range(64)
            ],
        },
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
                    "targetClass",
                    "coverage",
                )
            }
            for cell in cells
        ],
    }
    history = {
        "schemaVersion": 2,
        "id": "environment.surface-history-native",
        "generator": "videoer.construction-surface-history.v2",
        "fieldSha256": "e" * 64,
        "receiver": receiver,
        "sourceWaterField": {
            "id": water["id"],
            "fieldSha256": water["fieldSha256"],
            "routingSha256": water["routing"]["routingSha256"],
        },
        "grid": grid,
        "cells": cells,
        "dirtMassBalance": {
            "inputKilograms": 64,
            "persistentKilograms": 16,
            "looseKilograms": 44.8,
            "exportedKilograms": 3.2,
            "mobilizedKilograms": 6.4,
            "depositedKilograms": 3.2,
            "errorKilograms": 0,
        },
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
    if report["trafficAffectedCellCount"] != 16 or report["runoffAffectedCellCount"] != 16:
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
    if nodes.get("videoer-surface-dirt-mass-field") is None:
        raise RuntimeError("surface history v2 did not bind physical dirt-mass channels")
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
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.dither_intensity = 0
    scene.render.film_transparent = True
    scene.world = bpy.data.worlds.new("surface-history-world")
    scene.world.color = (0.025, 0.025, 0.025)
    camera_data = bpy.data.cameras.new("surface-history-camera")
    camera = bpy.data.objects.new("surface-history-camera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (6.2, -6.2, 6.0)
    camera.rotation_euler = (Vector((2, -2, 0)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera_data.lens = 52
    scene.camera = camera
    light_data = bpy.data.lights.new("surface-history-key", "AREA")
    light_data.energy = 900
    light_data.shape = "DISK"
    light_data.size = 3
    light = bpy.data.objects.new("surface-history-key", light_data)
    bpy.context.collection.objects.link(light)
    light.location = (-2, -2, 4)
    field_image = nodes["videoer-surface-history-field"].image
    dirt_image = nodes["videoer-surface-dirt-mass-field"].image
    original_history_pixels = list(field_image.pixels)
    original_dirt_pixels = list(dirt_image.pixels)
    zero_history_pixels = [0.0] * len(original_history_pixels)
    zero_dirt_pixels = [0.0] * len(original_dirt_pixels)

    def isolated(source, channel):
        result = [0.0] * len(source)
        for offset in range(0, len(source), 4):
            result[offset + channel] = source[offset + channel]
        return result

    variants = [
        ("control", None, zero_history_pixels, zero_dirt_pixels),
        ("traffic", "trafficWear", isolated(original_history_pixels, 0), zero_dirt_pixels),
        (
            "exposure",
            "longTermExposure",
            isolated(original_history_pixels, 1),
            zero_dirt_pixels,
        ),
        (
            "runoff",
            "runoffStaining",
            isolated(original_history_pixels, 2),
            zero_dirt_pixels,
        ),
        (
            "repair",
            "repairInfluence",
            isolated(original_history_pixels, 3),
            zero_dirt_pixels,
        ),
        ("loose-dirt", "looseDirt", zero_history_pixels, isolated(original_dirt_pixels, 0)),
        (
            "persistent-dirt",
            "persistentDirt",
            zero_history_pixels,
            isolated(original_dirt_pixels, 1),
        ),
        ("combined", "combined", original_history_pixels, original_dirt_pixels),
    ]
    rendered = {}
    for name, enabled_channel, history_pixels, dirt_pixels in variants:
        field_image.pixels.foreach_set(history_pixels)
        field_image.update()
        dirt_image.pixels.foreach_set(dirt_pixels)
        dirt_image.update()
        filename = "surface-history-semantic.png" if name == "combined" else f"surface-history-{name}.png"
        path = os.path.join(output, filename)
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        image = bpy.data.images.load(path, check_existing=False)
        with open(path, "rb") as handle:
            sha256 = hashlib.sha256(handle.read()).hexdigest()
        rendered[name] = {
            "path": path,
            "filename": filename,
            "sha256": sha256,
            "enabledChannel": enabled_channel,
            "pixels": list(image.pixels),
        }
        bpy.data.images.remove(image)
    field_image.pixels.foreach_set(original_history_pixels)
    field_image.update()
    dirt_image.pixels.foreach_set(original_dirt_pixels)
    dirt_image.update()

    control_pixels = rendered["control"]["pixels"]
    receiver_pixels = [
        index
        for index in range(len(control_pixels) // 4)
        if control_pixels[index * 4 + 3] > 0.5
    ]
    if len(receiver_pixels) < 500:
        raise RuntimeError("surface-history isolation receiver footprint is too small")
    all_channels = {
        "trafficWear",
        "longTermExposure",
        "runoffStaining",
        "repairInfluence",
        "looseDirt",
        "persistentDirt",
    }
    epsilon = 0.003
    evidence = {}
    for name, item in rendered.items():
        differences = [
            sum(
                abs(item["pixels"][pixel * 4 + channel] - control_pixels[pixel * 4 + channel])
                for channel in range(3)
            )
            / 3
            for pixel in receiver_pixels
        ]
        difference = sum(differences) / len(differences)
        affected_fraction = sum(value > epsilon for value in differences) / len(differences)
        enabled = item["enabledChannel"]
        zeroed_channels = (
            []
            if enabled == "combined"
            else sorted(all_channels - ({enabled} if enabled in all_channels else set()))
        )
        evidence[name] = {
            "filename": item["filename"],
            "sha256": item["sha256"],
            "enabledChannel": enabled,
            "zeroedChannels": zeroed_channels,
            "receiverPixelCount": len(receiver_pixels),
            "receiverMeanAbsoluteLinearDifference": difference,
            "affectedPixelFractionAboveEpsilon": affected_fraction,
            "differenceEpsilon": epsilon,
        }
        if name not in ("control", "combined") and (difference <= 0.0005 or affected_fraction <= 0.01):
            raise RuntimeError(
                f"surface-history isolated channel '{name}' has insufficient receiver response"
            )
    if len({item["sha256"] for item in evidence.values()}) != len(evidence):
        raise RuntimeError("surface-history isolated channel renders are not all distinct")
    combined_difference = evidence["combined"]["receiverMeanAbsoluteLinearDifference"]
    if combined_difference <= 0.002:
        raise RuntimeError(
            f"surface-history combined/control renders differ by only {combined_difference}"
        )
    tile_width = scene.render.resolution_x
    tile_height = scene.render.resolution_y
    sheet_width = tile_width * 4
    sheet_height = tile_height * 2
    sheet_pixels = [0.0] * (sheet_width * sheet_height * 4)
    sheet_order = (
        "repair",
        "loose-dirt",
        "persistent-dirt",
        "combined",
        "control",
        "traffic",
        "exposure",
        "runoff",
    )
    for tile_index, name in enumerate(sheet_order):
        tile_x = tile_index % 4
        tile_y = tile_index // 4
        source = rendered[name]["pixels"]
        for y in range(tile_height):
            source_offset = y * tile_width * 4
            target_offset = (
                (tile_y * tile_height + y) * sheet_width + tile_x * tile_width
            ) * 4
            sheet_pixels[target_offset : target_offset + tile_width * 4] = source[
                source_offset : source_offset + tile_width * 4
            ]
    contact_sheet_path = os.path.join(output, "surface-history-isolation-contact-sheet.png")
    contact_sheet = bpy.data.images.new(
        "surface-history-isolation-contact-sheet",
        width=sheet_width,
        height=sheet_height,
        alpha=True,
        float_buffer=True,
    )
    contact_sheet.pixels.foreach_set(sheet_pixels)
    contact_sheet.file_format = "PNG"
    contact_sheet.save_render(contact_sheet_path, scene=scene)
    with open(contact_sheet_path, "rb") as handle:
        contact_sheet_sha256 = hashlib.sha256(handle.read()).hexdigest()
    report["semanticControlMeanAbsoluteLinearDifference"] = combined_difference
    report["isolatedChannelEvidence"] = {
        "method": "fixed-state-packed-field-single-channel-v1",
        "receiverFootprint": "rendered-alpha-greater-than-0.5",
        "contactSheet": {
            "filename": os.path.basename(contact_sheet_path),
            "sha256": contact_sheet_sha256,
            "topRow": ["control", "traffic", "exposure", "runoff"],
            "bottomRow": ["repair", "loose-dirt", "persistent-dirt", "combined"],
        },
        "artifacts": evidence,
    }
    write_json(os.path.join(output, "surface-history-native-report.json"), report)


if __name__ == "__main__":
    main()
