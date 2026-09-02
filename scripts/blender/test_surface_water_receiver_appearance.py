"""Focused Blender contract probe for material-calibrated receiver-water appearance."""

import copy
import importlib.util
import json
import os
import sys

import bpy


def load_renderer():
    path = os.path.join(os.path.dirname(__file__), "render_cinematic_scene.py")
    spec = importlib.util.spec_from_file_location("videoer_receiver_water_renderer", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_json(path, value):
    with open(path, "w", encoding="utf8") as handle:
        json.dump(value, handle)


def receiver_fixture():
    positions = [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]
    indices = [0, 2, 1, 0, 3, 2]
    material = {
        "id": "concrete",
        "baseColor": [0.35, 0.34, 0.32, 1],
        "roughness": 0.6,
        "metallic": 0,
        "emission": [0, 0, 0],
        "emissionStrength": 0,
    }
    asset = {
        "id": "environment.receiver-water-probe",
        "positions": positions,
        "indices": indices,
        "materials": [material],
    }
    mesh = bpy.data.meshes.new("receiver-water-probe-mesh")
    mesh.from_pydata(positions, [], [[0, 2, 1], [0, 3, 2]])
    receiver = bpy.data.objects.new("receiver-water-probe", mesh)
    bpy.context.collection.objects.link(receiver)
    blender_material = bpy.data.materials.new("receiver-water-probe-concrete")
    blender_material.use_nodes = True
    principled = blender_material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = material["baseColor"]
    principled.inputs["Roughness"].default_value = material["roughness"]
    receiver_normal = blender_material.node_tree.nodes.new("ShaderNodeNormal")
    receiver_normal.name = "receiver-normal-source"
    blender_material.node_tree.links.new(
        receiver_normal.outputs["Normal"], principled.inputs["Normal"]
    )
    mesh.materials.append(blender_material)
    return asset, receiver


def fixtures(directory):
    transform = {
        "position": [0, 0, 0],
        "rotation": [0, 0, 0],
        "scale": [1, 1, 1],
    }
    response = {
        "targetClass": "modeled-unit",
        "absorption": {
            "capacityMeters": 0.001,
            "rateMetersPerSecond": 0.000004,
            "initialSaturation": 0.2,
        },
        "retention": {
            "filmCapacityMeters": 0.0004,
            "edgeCapacityMeters": 0.0012,
            "maximumPuddleDepthMeters": 0.018,
        },
        "wetRoughness": {"dry": 0.6, "multiplier": 1 / 3, "floor": 0.045},
        "receiverAppearance": {
            "model": "porous-damp-coherent-film-v1",
            "saturatedBaseColorMultiplier": 0.9,
            "saturatedRoughnessMultiplier": 0.82,
            "asperityEnvelopeMeters": 0.0007,
            "coherenceTransitionMeters": 0.0002,
            "maximumCoherentFilmCoverage": 1,
            "waterIor": 1.333,
            "interfaceRoughness": 0.12,
            "normalMode": "receiver-conformal",
        },
        "splash": {
            "minimumFreeWaterDepthMeters": 0.00025,
            "maximumSlopeDegrees": 30,
        },
    }
    field = {
        "id": "environment.receiver-water-probe-field",
        "generator": "videoer.static-surface-water.v2",
        "fieldSha256": "a" * 64,
        "receiver": {
            "geometryId": "environment.receiver-water-probe",
            "geometrySha256": "c" * 64,
            "geometrySemanticSha256": "d" * 64,
            "transform": transform,
            "transformSha256": "e" * 64,
        },
        "grid": {
            "worldOriginXZ": [0, 0],
            "cellSizeMeters": 1,
            "columns": 1,
            "rows": 1,
            "activeCellCount": 1,
        },
        "materialResponsesSha256": "b" * 64,
        "cells": [
            {
                "index": 0,
                "materialId": "concrete",
                "coverage": 1,
                "filmDepthMeters": 0.0004,
                "absorbedDepthMeters": 0.0008,
                "edgeAccumulationDepthMeters": 0,
                "puddleDepthMeters": 0,
                "effectiveRoughness": 0.2,
                "exposure": 1,
                "splashEligible": True,
            }
        ],
        "massBalance": {"incidentCubicMeters": 0.0012, "errorCubicMeters": 0},
    }
    appearance = {
        "id": "environment.receiver-water-probe-appearance",
        "generator": "videoer.surface-water-receiver-appearance.v1",
        "sourceFieldId": field["id"],
        "sourceFieldSha256": field["fieldSha256"],
        "appearanceSha256": "f" * 64,
        "receiver": {
            "geometryId": field["receiver"]["geometryId"],
            "geometrySha256": field["receiver"]["geometrySha256"],
            "geometrySemanticSha256": field["receiver"]["geometrySemanticSha256"],
            "transformSha256": field["receiver"]["transformSha256"],
        },
        "materialResponsesSha256": field["materialResponsesSha256"],
        "materialResponses": {"concrete": response},
        "cells": [
            {
                "index": 0,
                "materialId": "concrete",
                "coverage": 1,
                "porousDampness": 1,
                "baseColorMultiplier": 0.9,
                "roughnessMultiplier": 0.82,
                "coherentFilmCoverage": 0,
                "interfaceRoughness": 0.12,
            }
        ],
        "report": {
            "activeCellCount": 1,
            "dampCellCount": 1,
            "coherentFilmCellCount": 0,
            "porousDampAreaSquareMeters": 1,
            "coherentFilmAreaSquareMeters": 0,
            "absorbedOnlyCoherentFilmCellCount": 0,
            "belowAsperityCoherentFilmCellCount": 0,
            "puddleOverlapCoherentFilmCellCount": 0,
            "sceneGlobalNormalizationUsed": False,
        },
    }
    field_path = os.path.join(directory, "receiver-water-field.json")
    appearance_path = os.path.join(directory, "receiver-water-appearance.json")
    write_json(field_path, field)
    write_json(appearance_path, appearance)
    return transform, field_path, appearance_path, appearance


def main():
    output = sys.argv[sys.argv.index("--") + 1]
    os.makedirs(output, exist_ok=True)
    renderer = load_renderer()
    transform, field_path, appearance_path, appearance = fixtures(output)
    asset, receiver = receiver_fixture()
    definition = {
        "id": "receiver-water-probe",
        "visible": True,
        "transform": transform,
        "surfaceWaterFieldPath": field_path,
        "surfaceWaterReceiverAppearancePath": appearance_path,
    }
    report = renderer.create_surface_water(definition, asset, receiver)
    material = receiver.data.materials[0]
    principled = material.node_tree.nodes.get("Principled BSDF")
    if abs(principled.inputs["Coat IOR"].default_value - 1.333) > 1e-6:
        raise RuntimeError("receiver-water coat did not bind the declared water IOR")
    coat_source = principled.inputs["Coat Weight"].links[0].from_socket
    roughness_source = principled.inputs["Coat Roughness"].links[0].from_socket
    normal_source = principled.inputs["Coat Normal"].links[0].from_node
    if coat_source.name != "Blue" or roughness_source.name != "Alpha":
        raise RuntimeError("receiver-water shader channels do not preserve coherent-film evidence")
    if normal_source.name != "receiver-normal-source":
        raise RuntimeError("receiver-water coat normal is not receiver-conformal")
    image = bpy.data.images.get("receiver-water-probe-surface-water-field")
    pixel = list(image.pixels[:4])
    expected = [0.9, 0.82, 0, 0.12]
    if any(abs(actual - wanted) > 1e-6 for actual, wanted in zip(pixel, expected)):
        raise RuntimeError(f"receiver-water packed evidence differs: {pixel}")
    if report["receiverAppearance"]["coherentFilmCellCount"] != 0:
        raise RuntimeError("sub-asperity film incorrectly became a coherent coat")

    forged = copy.deepcopy(appearance)
    forged["cells"][0]["coherentFilmCoverage"] = 1
    forged_path = os.path.join(output, "receiver-water-appearance-forged.json")
    write_json(forged_path, forged)
    forged_definition = {**definition, "surfaceWaterReceiverAppearancePath": forged_path}
    forged_asset, forged_receiver = receiver_fixture()
    try:
        renderer.create_surface_water(forged_definition, forged_asset, forged_receiver)
    except RuntimeError as error:
        if "violates its material response" not in str(error):
            raise
    else:
        raise RuntimeError("forged coherent-film evidence did not fail closed")

    write_json(
        os.path.join(output, "receiver-water-runtime-report.json"),
        {"result": "pass", "receiverAppearance": report["receiverAppearance"]},
    )
    print("SURFACE_WATER_RECEIVER_APPEARANCE_PASS")


if __name__ == "__main__":
    main()
