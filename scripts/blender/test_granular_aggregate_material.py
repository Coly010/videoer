"""Deterministic Blender runtime probe for procedural granular aggregate surfaces."""

import importlib.util
import json
import os
import sys

import bpy
from mathutils import Vector


def load_geometry_probe():
    path = os.path.join(os.path.dirname(__file__), "render_geometry_probe.py")
    spec = importlib.util.spec_from_file_location("videoer_granular_geometry_probe", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def surface(kind):
    natural = kind == "natural-grit"
    return {
        "schemaVersion": 1,
        "id": f"material.paving-joint-{kind}",
        "shadingModel": "metallic-roughness",
        "baseColor": {
            "kind": "procedural-palette",
            "colors": (
                [
                    [0.038, 0.032, 0.026, 1],
                    [0.082, 0.069, 0.054, 1],
                    [0.022, 0.019, 0.016, 1],
                    [0.12, 0.102, 0.078, 1],
                ]
                if natural
                else [
                    [0.052, 0.05, 0.046, 1],
                    [0.105, 0.1, 0.09, 1],
                    [0.032, 0.031, 0.029, 1],
                    [0.14, 0.132, 0.116, 1],
                ]
            ),
            "scaleMeters": 0.18,
            "seed": 1849 if natural else 90213,
        },
        "normal": {
            "kind": "procedural-noise",
            "strength": 0.72 if natural else 0.48,
            "scaleMeters": 0.0012 if natural else 0.00075,
        },
        "roughness": {
            "minimum": 0.62 if natural else 0.58,
            "maximum": 0.91 if natural else 0.84,
            "variationScaleMeters": 0.007 if natural else 0.0045,
            "wetness": 0,
        },
        "pattern": {
            "kind": "granular-aggregate",
            "aggregateScaleMeters": 0.007 if natural else 0.0045,
            "finesScaleMeters": 0.0012 if natural else 0.00075,
            "aggregateContrast": 0.72 if natural else 0.5,
            "poreAmount": 0.58 if natural else 0.32,
            "compaction": 0.42 if natural else 0.74,
            "embeddedDirtAmount": 0.38 if natural else 0.22,
        },
        "weathering": {
            "surfaceDirt": {
                "amount": 0.38 if natural else 0.22,
                "scaleMeters": 0.22 if natural else 0.35,
            },
        },
        "metallic": 0,
        "metadata": {
            "fixture": "blender-granular-aggregate-runtime",
            "jointKind": kind,
        },
    }


def material_definition(kind):
    definition = surface(kind)
    return {
        "id": kind,
        "baseColor": definition["baseColor"]["colors"][1],
        "roughness": sum(
            [definition["roughness"]["minimum"], definition["roughness"]["maximum"]]
        )
        / 2,
        "metallic": 0,
        "surface": definition,
    }


def inspect_material(material, definition):
    nodes = material.node_tree.nodes
    required = {
        "videoer-granular-aggregate-mapping",
        "videoer-granular-aggregate-cells",
        "videoer-granular-aggregate-profile",
        "videoer-granular-fines-mapping",
        "videoer-granular-fines",
        "videoer-granular-aggregate-fines-mix",
        "videoer-granular-palette",
        "videoer-granular-pore-mask",
        "videoer-granular-pore-strength",
        "videoer-granular-pore-darkening",
        "videoer-granular-embedded-dirt-mapping",
        "videoer-granular-embedded-dirt",
        "videoer-granular-embedded-dirt-amount",
        "videoer-granular-embedded-dirt-darkening",
        "videoer-granular-roughness-factor",
        "videoer-granular-roughness",
        "videoer-granular-relief-height",
        "videoer-granular-relief",
    }
    missing = sorted(required - {node.name for node in nodes})
    if missing:
        raise RuntimeError(f"Granular material lacks required nodes: {missing}")
    pattern = definition["surface"]["pattern"]
    aggregate_mapping = nodes["videoer-granular-aggregate-mapping"]
    fines_mapping = nodes["videoer-granular-fines-mapping"]
    expected_aggregate = 1.0 / pattern["aggregateScaleMeters"]
    expected_fines = 1.0 / pattern["finesScaleMeters"]
    if any(
        abs(value - expected_aggregate) > 1e-5
        for value in aggregate_mapping.inputs["Scale"].default_value[:3]
    ):
        raise RuntimeError("Aggregate mapping does not use the declared metre scale")
    if any(
        abs(value - expected_fines) > 1e-4
        for value in fines_mapping.inputs["Scale"].default_value[:3]
    ):
        raise RuntimeError("Fines mapping does not use the declared metre scale")
    for mapping in (aggregate_mapping, fines_mapping, nodes["videoer-granular-embedded-dirt-mapping"]):
        source = mapping.inputs["Vector"].links[0].from_node
        if source.bl_idname != "ShaderNodeMapping" or not source.inputs["Vector"].links:
            raise RuntimeError("Granular fields are not registered to the shared object-space mapping")
        if source.inputs["Vector"].links[0].from_node.bl_idname != "ShaderNodeTexCoord":
            raise RuntimeError("Granular fields do not originate from object-space coordinates")
        if source.inputs["Vector"].links[0].from_socket.name != "Object":
            raise RuntimeError("Granular fields use normalized/generated coordinates instead of metres")

    principled = nodes.get("Principled BSDF")
    base_node = principled.inputs["Base Color"].links[0].from_node
    if base_node.name != "videoer-granular-embedded-dirt-darkening":
        # Weathering is allowed to wrap the granular colour, but it must retain
        # the granular embedded-dirt output as its source.
        source_names = {
            link.from_node.name for socket in base_node.inputs for link in socket.links
        }
        if "videoer-granular-embedded-dirt-darkening" not in source_names:
            raise RuntimeError("Granular colour response is not connected to the Principled shader")
    if principled.inputs["Roughness"].links[0].from_node.name != "videoer-granular-roughness":
        raise RuntimeError("Granular roughness response was replaced by generic noise")
    final_normal = principled.inputs["Normal"].links[0].from_node
    if final_normal.bl_idname != "ShaderNodeBump":
        raise RuntimeError("Granular bump response is not connected to the Principled shader")
    normal_sources = {
        link.from_node.name for socket in final_normal.inputs for link in socket.links
    }
    if "videoer-granular-relief" not in normal_sources:
        raise RuntimeError("Fine normal response is not layered over aggregate relief")

    return {
        "aggregateScaleInverseMeters": aggregate_mapping.inputs["Scale"].default_value[0],
        "finesScaleInverseMeters": fines_mapping.inputs["Scale"].default_value[0],
        "aggregateContrast": nodes[
            "videoer-granular-aggregate-fines-mix"
        ].inputs["Fac"].default_value,
        "poreStrength": nodes["videoer-granular-pore-strength"].inputs[1].default_value,
        "compactionProfileMaximum": nodes[
            "videoer-granular-aggregate-profile"
        ].inputs["From Max"].default_value,
        "embeddedDirtAmount": nodes[
            "videoer-granular-embedded-dirt-amount"
        ].inputs[1].default_value,
        "reliefStrength": nodes["videoer-granular-relief"].inputs["Strength"].default_value,
        "reliefDistanceMeters": nodes[
            "videoer-granular-relief"
        ].inputs["Distance"].default_value,
        "nodeNames": sorted(required),
    }


def add_swatch(name, material, x):
    bpy.ops.mesh.primitive_cube_add(location=(x, 0, 0.08))
    swatch = bpy.context.object
    swatch.name = name
    swatch.scale = (1.15, 0.82, 0.08)
    bpy.context.view_layer.objects.active = swatch
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bevel = swatch.modifiers.new(name="swatch-edge", type="BEVEL")
    bevel.width = 0.025
    bevel.segments = 3
    swatch.data.materials.append(material)
    return swatch


def main():
    if "--" not in sys.argv or len(sys.argv[sys.argv.index("--") + 1 :]) != 1:
        raise RuntimeError("Expected output directory after --")
    output = os.path.abspath(sys.argv[sys.argv.index("--") + 1])
    os.makedirs(output, exist_ok=True)
    geometry_probe = load_geometry_probe()
    geometry_probe.clear_scene()

    definitions = {
        kind: material_definition(kind) for kind in ("natural-grit", "polymeric-sand")
    }
    materials = {
        kind: geometry_probe.create_material(definition)
        for kind, definition in definitions.items()
    }
    reports = {
        kind: inspect_material(materials[kind], definitions[kind]) for kind in materials
    }
    if reports["natural-grit"]["aggregateScaleInverseMeters"] >= reports[
        "polymeric-sand"
    ]["aggregateScaleInverseMeters"]:
        raise RuntimeError("Natural grit does not preserve its coarser aggregate scale")
    if reports["natural-grit"]["poreStrength"] <= reports["polymeric-sand"]["poreStrength"]:
        raise RuntimeError("Natural grit does not preserve its stronger pore response")
    if reports["natural-grit"]["reliefStrength"] <= reports["polymeric-sand"]["reliefStrength"]:
        raise RuntimeError("Natural grit does not preserve its looser aggregate relief")

    add_swatch("natural-grit", materials["natural-grit"], -1.3)
    add_swatch("polymeric-sand", materials["polymeric-sand"], 1.3)
    bpy.ops.mesh.primitive_plane_add(size=9, location=(0, 0, -0.015))
    ground = bpy.context.object
    ground_material = bpy.data.materials.new("granular-probe-ground")
    ground_material.diffuse_color = (0.018, 0.021, 0.026, 1)
    ground.data.materials.append(ground_material)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 720
    scene.render.resolution_y = 420
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.world.color = (0.01, 0.012, 0.016)
    bpy.ops.object.camera_add(location=(3.8, -4.7, 2.55))
    camera = bpy.context.object
    camera.data.lens = 58
    camera.rotation_euler = (Vector((0, 0, 0.08)) - camera.location).to_track_quat(
        "-Z", "Y"
    ).to_euler()
    scene.camera = camera
    bpy.ops.object.light_add(type="AREA", location=(-3.2, -2.8, 2.0))
    key = bpy.context.object
    key.data.energy = 1100
    key.data.size = 1.6
    key.rotation_euler = (Vector((0, 0, 0.04)) - key.location).to_track_quat(
        "-Z", "Y"
    ).to_euler()
    bpy.ops.object.light_add(type="AREA", location=(3.4, 1.0, 1.15))
    rim = bpy.context.object
    rim.data.energy = 620
    rim.data.color = (0.32, 0.5, 1.0)
    rim.data.size = 1.1
    rim.rotation_euler = (Vector((0, 0, 0.05)) - rim.location).to_track_quat(
        "-Z", "Y"
    ).to_euler()

    render_path = os.path.join(output, "granular-aggregate-probe.png")
    scene.render.filepath = render_path
    bpy.ops.render.render(write_still=True)
    with open(
        os.path.join(output, "granular-aggregate-report.json"), "w", encoding="utf-8"
    ) as handle:
        json.dump(
            {
                "schemaVersion": 1,
                "status": "structural-pass-visual-review-required",
                "coordinateSpace": "object-space-metres",
                "materials": reports,
                "comparisons": {
                    "naturalGritCoarser": True,
                    "naturalGritMorePorous": True,
                    "naturalGritHigherRelief": True,
                },
                "render": os.path.basename(render_path),
            },
            handle,
            indent=2,
        )
        handle.write("\n")


if __name__ == "__main__":
    main()
