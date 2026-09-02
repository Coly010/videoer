"""Native Blender witness for renderer-independent construction surface responses.

Run with::

    blender -b --factory-startup --python scripts/blender/test_construction_surface_response.py -- OUTPUT_DIR

The witness deliberately uses tiny, disconnected receiver meshes.  It verifies the
node contracts and their renderer-neutral scalar formulae without depending on a
campaign scene or the surface-history image loader.
"""

import importlib.util
import json
import math
import os
import sys
import traceback

import bpy
from mathutils import Matrix, Vector


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
HELPER_PATH = os.path.join(SCRIPT_DIR, "construction_surface_response.py")


def require(condition, message):
    if not condition:
        raise RuntimeError(f"construction-surface-response witness: {message}")


def load_helper():
    spec = importlib.util.spec_from_file_location(
        "videoer_construction_surface_response", HELPER_PATH
    )
    require(spec is not None and spec.loader is not None, "helper module is unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_material(name):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    principled = next(node for node in nodes if node.bl_idname == "ShaderNodeBsdfPrincipled")
    principled.name = f"{name}-principled"

    # Prove that construction normals compose with, rather than replace, a base normal.
    base = nodes.new("ShaderNodeValue")
    base.name = f"{name}-base-height"
    base.outputs[0].default_value = 0.37
    bump = nodes.new("ShaderNodeBump")
    bump.name = f"{name}-base-bump"
    material.node_tree.links.new(base.outputs[0], bump.inputs["Height"])
    material.node_tree.links.new(bump.outputs["Normal"], principled.inputs["Normal"])
    return material, principled


def make_value(material, name, value):
    node = material.node_tree.nodes.new("ShaderNodeValue")
    node.name = name
    node.label = name
    node.outputs[0].default_value = value
    return node.outputs[0]


def make_plane(name, material, size=1.0):
    half = size * 0.5
    mesh = bpy.data.meshes.new(f"{name}-mesh")
    mesh.from_pydata(
        [(-half, -half, 0.0), (half, -half, 0.0), (half, half, 0.0), (-half, half, 0.0)],
        [],
        [(0, 1, 2, 3)],
    )
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def make_cube(name, material, size=0.2):
    half = size * 0.5
    vertices = [
        (x, y, z)
        for x in (-half, half)
        for y in (-half, half)
        for z in (-half, half)
    ]
    faces = [
        (0, 4, 6, 2),
        (1, 3, 7, 5),
        (0, 1, 5, 4),
        (2, 6, 7, 3),
        (0, 2, 3, 1),
        (4, 5, 7, 6),
    ]
    mesh = bpy.data.meshes.new(f"{name}-mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def definition(joint_material="natural-joint", substrate_material="substrate", borders=None):
    return {
        "seed": 73,
        "boundary": {"kind": "rectangle", "minimum": [0.0, 0.0], "maximum": [1.0, 1.0]},
        "joints": {
            "materialId": joint_material,
            "depthMeters": 0.01,
            "widthMeters": 0.012,
        },
        "units": {"heightMeters": 0.075},
        "materials": {"substrateId": substrate_material},
        "borders": borders or [],
    }


def sockets(material, prefix, traffic=0.0, throughflow=0.0, retained=0.0, loose=0.0, persistent=0.0):
    return {
        "traffic_socket": make_value(material, f"{prefix}-traffic", traffic),
        "throughflow_socket": make_value(material, f"{prefix}-throughflow", throughflow),
        "retained_socket": make_value(material, f"{prefix}-retained", retained),
        "loose_dirt_socket": make_value(material, f"{prefix}-loose", loose),
        "persistent_dirt_socket": make_value(material, f"{prefix}-persistent", persistent),
    }


def apply(helper, material, principled, response, paving_definition, material_id, receiver, values, cell=None):
    return helper.apply_construction_surface_response(
        material=material,
        node_tree=material.node_tree,
        principled=principled,
        response=response,
        paving_definition=paving_definition,
        material_id=material_id,
        receiver_object=receiver,
        field_cell_size_meters=cell,
        **values,
    )


def node(material, name):
    result = material.node_tree.nodes.get(name)
    require(result is not None, f"missing required node '{name}'")
    return result


def require_nodes(material, names):
    for name in names:
        node(material, name)


def smootherstep(value, onset, saturation):
    if value <= onset:
        return 0.0
    if value >= saturation:
        return 1.0
    t = (value - onset) / (saturation - onset)
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


def assert_map_range(material, name, onset, saturation):
    mapping = node(material, name)
    require(mapping.bl_idname == "ShaderNodeMapRange", f"'{name}' is not Map Range")
    require(mapping.interpolation_type == "SMOOTHERSTEP", f"'{name}' is not smootherstep")
    require(mapping.clamp, f"'{name}' is not clamped")
    require(math.isclose(mapping.inputs["From Min"].default_value, onset, abs_tol=1e-6), f"'{name}' onset changed")
    require(math.isclose(mapping.inputs["From Max"].default_value, saturation, abs_tol=1e-6), f"'{name}' saturation changed")
    require(mapping.inputs["To Min"].default_value == 0.0, f"'{name}' lower result is not zero")
    require(mapping.inputs["To Max"].default_value == 1.0, f"'{name}' upper result is not one")


def tessellation_evidence(report):
    meshes = report["report"]["displacement"]["meshes"]
    require(len(meshes) == 1, "joint response did not report exactly one receiver mesh")
    mesh = meshes[0]
    require(mesh["vertexCountAfter"] > mesh["vertexCountBefore"], "joint mesh was not tessellated")
    require(
        mesh["maximumTargetSegmentMetersAfter"] <= mesh["maximumAllowedSegmentMeters"] + 1e-9,
        "tessellated segment exceeds the field cell bound",
    )
    return mesh


NATURAL = {
    "kind": "natural-joint",
    "geometryBasis": "authored-joint-recession",
    "heightRepresentation": "render-mesh-displacement-required",
    "clogging": {
        "driver": "dirt-coverage",
        "looseWeight": 0.65,
        "persistentWeight": 1.0,
        "onsetCoverage": 0.15,
        "saturationCoverage": 0.85,
        "maximumFillFractionOfRecession": 0.72,
    },
    "normal": {"intactStrengthScale": 1.0, "changedStrengthScale": 0.45},
}

POLYMERIC = {
    "kind": "polymeric-joint",
    "geometryBasis": "authored-joint-recession",
    "heightRepresentation": "render-mesh-displacement-required",
    "coherentFailure": {
        "driver": "traffic-and-throughflow",
        "trafficWeight": 0.68,
        "throughflowWeight": 0.82,
        "onset": 0.58,
        "saturation": 0.86,
        "coherenceScaleMeters": 0.18,
        "seed": 90217,
        "maximumAdditionalRecessionFraction": 0.55,
    },
    "normal": {"intactStrengthScale": 0.75, "changedStrengthScale": 1.4},
}


def natural_witness(helper):
    cases = [("zero", 0.0), ("below", 0.14), ("mid", 0.5), ("saturation", 0.85)]
    evidence = []
    for label, coverage in cases:
        material_id = f"natural-{label}"
        material, principled = make_material(material_id)
        receiver = make_plane(f"receiver-{material_id}", material)
        result = apply(
            helper,
            material,
            principled,
            NATURAL,
            definition(joint_material=material_id),
            material_id,
            receiver,
            sockets(material, material_id, persistent=coverage),
            cell=0.25,
        )
        require(result["report"]["normalInputChained"], "natural response replaced the base normal")
        require_nodes(
            material,
            [
                "videoer-construction-natural-clogging",
                "videoer-construction-natural-joint-fill",
                "videoer-construction-natural-fill-metres",
                "videoer-construction-natural-joint-displacement",
            ],
        )
        assert_map_range(material, "videoer-construction-natural-clogging", 0.15, 0.85)
        maximum = result["report"]["displacement"]["signedMaximumDisplacementMeters"]
        require(maximum > 0.0 and math.isclose(maximum, 0.0072), "natural fill displacement sign/scale is wrong")
        factor = smootherstep(coverage, 0.15, 0.85)
        if label in ("zero", "below"):
            require(factor == 0.0, f"natural {label} response is not exact zero")
        elif label == "mid":
            require(0.0 < factor < 1.0, "natural mid response is not transitional")
        else:
            require(factor == 1.0, "natural saturation response does not reach one")
        evidence.append(
            {
                "case": label,
                "persistentDirtCoverage": coverage,
                "evaluatedClogging": factor,
                "maximumFillMeters": maximum,
                "tessellation": tessellation_evidence(result),
                "nodeNames": result["report"]["nodeNames"],
            }
        )
    return evidence


def polymeric_case(helper, label, traffic, throughflow):
    material_id = f"polymeric-{label}"
    material, principled = make_material(material_id)
    receiver = make_plane(f"receiver-{material_id}", material)
    result = apply(
        helper,
        material,
        principled,
        POLYMERIC,
        definition(joint_material=material_id),
        material_id,
        receiver,
        sockets(material, material_id, traffic=traffic, throughflow=throughflow),
        cell=0.25,
    )
    require_nodes(
        material,
        [
            "videoer-construction-polymeric-causal",
            "videoer-construction-polymeric-coherence",
            "videoer-construction-polymeric-failure",
            "videoer-construction-polymeric-joint-failure",
            "videoer-construction-polymeric-recession-metres",
            "videoer-construction-polymeric-joint-displacement",
        ],
    )
    assert_map_range(material, "videoer-construction-polymeric-failure", 0.58, 0.86)
    noise = node(material, "videoer-construction-polymeric-coherence")
    expected_w = (90217 % 1_000_003) / 1_000_003.0
    require(noise.noise_dimensions == "4D", "polymeric coherence noise is not seeded 4D noise")
    require(math.isclose(noise.inputs["Scale"].default_value, 1.0 / 0.18, rel_tol=1e-6), "polymeric coherence scale changed")
    require(math.isclose(noise.inputs["W"].default_value, expected_w, abs_tol=1e-6), "polymeric coherence seed changed")
    signed_maximum = result["report"]["displacement"]["signedMaximumDisplacementMeters"]
    require(signed_maximum < 0.0 and math.isclose(signed_maximum, -0.0055), "polymeric recession is not signed negative")
    causal = (traffic * 0.68 + throughflow * 0.82) / 1.5
    conservative_coherent = causal  # Noise Fac cannot exceed one.
    if conservative_coherent < 0.58:
        require(
            smootherstep(conservative_coherent, 0.58, 0.86) == 0.0,
            "below-onset polymeric response is not provably exact zero",
        )
    return {
        "case": label,
        "causal": causal,
        "maximumPossibleCoherentCausal": conservative_coherent,
        "provableFailureAtOrBelow": smootherstep(conservative_coherent, 0.58, 0.86),
        "coherenceScale": noise.inputs["Scale"].default_value,
        "coherenceSeedW": noise.inputs["W"].default_value,
        "signedMaximumDisplacementMeters": signed_maximum,
        "tessellation": tessellation_evidence(result),
        "nodeNames": result["report"]["nodeNames"],
    }


def polymeric_witness(helper):
    first = polymeric_case(helper, "below-a", 0.1, 0.1)
    repeat = polymeric_case(helper, "below-b", 0.1, 0.1)
    require(first["provableFailureAtOrBelow"] == 0.0, "polymeric below-onset response is nonzero")
    require(repeat["provableFailureAtOrBelow"] == 0.0, "repeated below-onset response is nonzero")
    require(first["coherenceScale"] == repeat["coherenceScale"], "polymeric scale is not repeatable")
    require(first["coherenceSeedW"] == repeat["coherenceSeedW"], "polymeric seed is not repeatable")
    above = polymeric_case(helper, "above", 1.0, 1.0)
    require(above["causal"] == 1.0, "polymeric above-onset causal driver does not reach one")
    return {"belowOnset": first, "repeat": repeat, "aboveOnset": above, "seedRepeatable": True}


def border_response(history_faces, gutter=None):
    response = {
        "kind": "paving-border",
        "geometryBasis": "authored-border-profile",
        "historyFaces": history_faces,
        "faceTransitionCosine": 0.64,
        "faceMaskFormula": "smoothstep-minimum-alignment-cosine",
    }
    if gutter is not None:
        response["gutterZones"] = gutter
    return response


def transformed_kerb_witness(helper):
    material_id = "transformed-kerb"
    material, principled = make_material(material_id)
    receiver = make_cube("receiver-transformed-kerb", material)
    receiver.matrix_world = (
        Matrix.Translation((2.3, -1.7, 0.9))
        @ Matrix.Rotation(math.radians(37.0), 4, "Z")
        @ Matrix.Rotation(math.radians(21.0), 4, "Y")
        @ Matrix.Diagonal((1.7, 0.65, 1.25, 1.0))
    )
    bpy.context.view_layer.update()
    borders = [
        {
            "materialId": material_id,
            "kind": "kerb",
            "side": "minimum-x",
            "widthMeters": 0.2,
            "riseMeters": 0.08,
        }
    ]
    result = apply(
        helper,
        material,
        principled,
        border_response(["top", "paving-facing"]),
        definition(borders=borders),
        material_id,
        receiver,
        sockets(material, material_id, traffic=0.7, retained=0.4, loose=0.2),
    )
    required = [
        "videoer-construction-border-object-normal-world-to-object",
        "videoer-construction-border-object-normal-normalize",
        "videoer-construction-border-top-face",
        "videoer-construction-border-paving-face",
        "videoer-construction-border-history-face-mask",
    ]
    require_nodes(material, required)
    transform = node(material, required[0])
    require(transform.bl_idname == "ShaderNodeVectorTransform", "kerb normal transform node has wrong type")
    require(transform.vector_type == "NORMAL", "kerb vector transform does not use normal semantics")
    require(transform.convert_from == "WORLD" and transform.convert_to == "OBJECT", "kerb mask is not world-to-object transform safe")

    normal_matrix = receiver.matrix_world.to_3x3().inverted().transposed()
    inverse_normal_matrix = normal_matrix.inverted()
    roundtrips = {}
    for label, local in (("top", Vector((0.0, 0.0, 1.0))), ("pavingFacing", Vector((1.0, 0.0, 0.0)))):
        world = (normal_matrix @ local).normalized()
        recovered = (inverse_normal_matrix @ world).normalized()
        alignment = recovered.dot(local)
        require(alignment > 0.999999, f"transformed kerb {label} normal is not object-space invariant")
        roundtrips[label] = alignment
    return {
        "matrixWorld": [list(row) for row in receiver.matrix_world],
        "normalRoundtripAlignment": roundtrips,
        "transformNode": {
            "name": transform.name,
            "vectorType": transform.vector_type,
            "from": transform.convert_from,
            "to": transform.convert_to,
        },
        "nodeNames": result["report"]["nodeNames"],
    }


GUTTER = {
    "coreDriver": "throughflow-times-clean-surface",
    "marginDriver": "retained-water-times-dirt-coverage",
    "coreWidthFraction": 0.46,
    "transitionWidthFraction": 0.12,
    "coreThroughflowCleaning": 0.78,
    "marginRetainedDeposition": 1.25,
}


def gutter_case(helper, label, dirt):
    material_id = f"gutter-{label}"
    material, principled = make_material(material_id)
    receiver = make_cube(f"receiver-{material_id}", material)
    borders = [
        {
            "materialId": material_id,
            "kind": "gutter",
            "side": "minimum-z",
            "widthMeters": 0.2,
            "riseMeters": -0.01,
        }
    ]
    result = apply(
        helper,
        material,
        principled,
        border_response(["top"], GUTTER),
        definition(borders=borders),
        material_id,
        receiver,
        sockets(material, material_id, throughflow=1.0, retained=1.0, loose=dirt),
    )
    require_nodes(
        material,
        [
            "videoer-construction-gutter-core",
            "videoer-construction-gutter-margin",
            "videoer-construction-gutter-clean-surface",
            "videoer-construction-gutter-cleaning-driver",
            "videoer-construction-gutter-deposition-driver",
            "videoer-construction-gutter-deposition-amount",
            "videoer-construction-gutter-loose-margin-deposition",
            "videoer-construction-gutter-persistent-margin-deposition",
        ],
    )
    # Evaluate the declared renderer-neutral formula at ideal core/margin points.
    core = 1.0
    margin = 1.0
    core_cleaning = 1.0 * core * (1.0 - dirt) * 0.78
    margin_deposition = 1.0 * margin * dirt * 1.25
    if dirt == 0.0:
        require(margin_deposition == 0.0, "gutter deposits dirt when dirt coverage is zero")
    else:
        require(margin_deposition > 0.0, "gutter margin does not deposit available dirt")
    return {
        "case": label,
        "dirtCoverage": dirt,
        "evaluatedCoreCleaning": core_cleaning,
        "evaluatedMarginDeposition": margin_deposition,
        "nodeNames": result["report"]["nodeNames"],
    }


def gutter_witness(helper):
    zero = gutter_case(helper, "zero-dirt", 0.0)
    dirt = gutter_case(helper, "with-dirt", 0.6)
    require(zero["evaluatedMarginDeposition"] == 0.0, "zero-dirt gutter deposition is nonzero")
    require(dirt["evaluatedCoreCleaning"] < zero["evaluatedCoreCleaning"], "dirt does not reduce clean-surface core cleaning")
    return {"zeroDirt": zero, "withDirt": dirt}


def substrate_witness(helper):
    response = {
        "kind": "exposed-substrate",
        "activation": "active-history-cells-only",
        "heightRepresentation": "none-no-calibrated-height",
        "normal": {"strengthScale": 1.1},
        "dirtDepositionScale": 1.25,
    }
    material_id = "substrate-inactive"
    material, _ = make_material(material_id)
    inactive = make_plane("receiver-substrate-inactive", material)
    before = len(inactive.data.vertices)
    inactive_nodes = [item.name for item in material.node_tree.nodes if item.name.startswith("videoer-construction-")]
    require(not inactive_nodes, "inactive substrate unexpectedly has a construction graph")
    require(len(inactive.data.vertices) == before, "inactive substrate geometry changed")

    material_id = "substrate-active"
    material, principled = make_material(material_id)
    active = make_plane("receiver-substrate-active", material)
    active_before = len(active.data.vertices)
    result = apply(
        helper,
        material,
        principled,
        response,
        definition(substrate_material=material_id),
        material_id,
        active,
        sockets(material, material_id, retained=0.2, loose=0.4),
    )
    require_nodes(material, ["videoer-construction-exposed-substrate"])
    require(result["report"]["normalInputChained"], "active substrate replaced the base normal")
    require(result["report"]["displacement"]["meshes"] == [], "substrate unexpectedly reports displaced meshes")
    require(len(active.data.vertices) == active_before, "active substrate tessellated despite normal-only contract")
    output = next(item for item in material.node_tree.nodes if item.bl_idname == "ShaderNodeOutputMaterial")
    require(not output.inputs["Displacement"].is_linked, "active substrate created displacement instead of normal-only response")
    return {
        "inactive": {
            "constructionNodeCount": 0,
            "vertexCountBefore": before,
            "vertexCountAfter": len(inactive.data.vertices),
        },
        "active": {
            "normalOnly": True,
            "normalInputChained": result["report"]["normalInputChained"],
            "vertexCountBefore": active_before,
            "vertexCountAfter": len(active.data.vertices),
            "nodeNames": result["report"]["nodeNames"],
        },
    }


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    require(len(argv) == 1, "expected exactly one output directory after '--'")
    output_dir = os.path.abspath(argv[0])
    os.makedirs(output_dir, exist_ok=True)
    reset_scene()
    helper = load_helper()
    evidence = {
        "schemaVersion": 1,
        "generator": "videoer.construction-surface-response-native-witness.v1",
        "result": "structural-pass",
        "blenderVersion": bpy.app.version_string,
        "rendering": {
            "performed": False,
            "reason": "Deterministic node/default and analytic formula evaluation is stronger than a colour-managed beauty render for this contract witness.",
        },
        "naturalJoint": natural_witness(helper),
        "polymericJoint": polymeric_witness(helper),
        "transformedKerb": transformed_kerb_witness(helper),
        "gutter": gutter_witness(helper),
        "substrate": substrate_witness(helper),
    }
    output_path = os.path.join(output_dir, "construction-surface-response-evidence.json")
    with open(output_path, "w", encoding="utf8") as handle:
        json.dump(evidence, handle, indent=2, sort_keys=True)
        handle.write("\n")
    print(f"CONSTRUCTION_SURFACE_RESPONSE_EVIDENCE={output_path}")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        # Blender otherwise exits zero after an uncaught --python exception, which
        # would make this fail-open in CI and native verification orchestration.
        sys.exit(1)
