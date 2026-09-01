"""Regression probe for explicit cinematic world surface and fog composition."""

import importlib.util
import json
import os
import sys

import bpy


def load_renderer():
    path = os.path.join(os.path.dirname(__file__), "render_cinematic_scene.py")
    spec = importlib.util.spec_from_file_location("videoer_world_renderer", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def active_world_semantics(renderer, scene):
    world = scene.world
    nodes = world.node_tree.nodes
    links = world.node_tree.links
    output = nodes.get(renderer.WORLD_OUTPUT_NODE)
    background = nodes.get(renderer.WORLD_BACKGROUND_NODE)
    volume = nodes.get(renderer.WORLD_VOLUME_NODE)
    if output is None or background is None:
        raise RuntimeError("explicit Videoer world nodes are missing")
    surface_links = [
        link
        for link in links
        if link.to_node == output and link.to_socket == output.inputs["Surface"]
    ]
    volume_links = [
        link
        for link in links
        if link.to_node == output and link.to_socket == output.inputs["Volume"]
    ]
    return {
        "worldColor": list(world.color),
        "backgroundColor": list(background.inputs["Color"].default_value)[:3],
        "backgroundStrength": background.inputs["Strength"].default_value,
        "surfaceSource": surface_links[0].from_node.name if len(surface_links) == 1 else None,
        "surfaceLinkCount": len(surface_links),
        "volumeSource": volume_links[0].from_node.name if len(volume_links) == 1 else None,
        "volumeLinkCount": len(volume_links),
        "volumeNodePresent": volume is not None,
    }


def close_channels(first, second, tolerance=1e-7):
    return len(first) == len(second) and all(
        abs(left - right) <= tolerance for left, right in zip(first, second)
    )


def main():
    if "--" not in sys.argv or len(sys.argv[sys.argv.index("--") + 1 :]) != 1:
        raise RuntimeError("Expected output directory after --")
    output = os.path.abspath(sys.argv[sys.argv.index("--") + 1])
    os.makedirs(output, exist_ok=True)
    renderer = load_renderer()
    scene = bpy.context.scene
    declared_color = [0.013, 0.027, 0.061]
    declared_strength = 0.72

    dry_builder = renderer.configure_world(scene, declared_color, declared_strength)
    dry = active_world_semantics(renderer, scene)
    if dry["surfaceSource"] != renderer.WORLD_BACKGROUND_NODE or dry["surfaceLinkCount"] != 1:
        raise RuntimeError("dry world does not use the explicit declared Background surface")
    if dry["volumeLinkCount"] != 0 or dry["volumeNodePresent"]:
        raise RuntimeError("dry world unexpectedly contains a fog volume")

    wet_builder = renderer.configure_world(scene, declared_color, declared_strength)
    fog = renderer.create_fog(scene, 0.018, [0.11, 0.17, 0.24])
    fogged = active_world_semantics(renderer, scene)
    if fogged["surfaceSource"] != renderer.WORLD_BACKGROUND_NODE or fogged["surfaceLinkCount"] != 1:
        raise RuntimeError("fog replaced or duplicated the declared Background surface")
    if fogged["volumeSource"] != renderer.WORLD_VOLUME_NODE or fogged["volumeLinkCount"] != 1:
        raise RuntimeError("fog did not attach exactly once to the World Output volume")
    if not close_channels(dry["backgroundColor"], fogged["backgroundColor"]):
        raise RuntimeError("fog changed the declared world Background color")
    if abs(dry["backgroundStrength"] - fogged["backgroundStrength"]) > 1e-7:
        raise RuntimeError("fog changed the declared world Background strength")
    if not close_channels(fogged["backgroundColor"], declared_color):
        raise RuntimeError("active world Background does not contain the declared atmosphere color")

    renderer.create_fog(scene, 0, [0.11, 0.17, 0.24])
    cleared = active_world_semantics(renderer, scene)
    if cleared["volumeNodePresent"] or cleared["volumeLinkCount"]:
        raise RuntimeError("zero-density fog did not remove the existing volume cleanly")
    if not close_channels(cleared["backgroundColor"], declared_color):
        raise RuntimeError("removing fog changed the declared world Background color")

    configured_scene = renderer.configure_scene(
        {
            "renderProfile": {
                "engine": "cycles-cpu",
                "samples": 1,
                "seed": 1729,
                "denoise": False,
                "intent": "deterministic-final",
            },
            "resolution": {"width": 32, "height": 32, "percentage": 100},
            "fps": 24,
            "durationSeconds": 1,
            "atmosphere": {"worldColor": declared_color},
        }
    )
    renderer.create_fog(configured_scene, 0.018, [0.11, 0.17, 0.24])
    configured_fogged = active_world_semantics(renderer, configured_scene)
    if not close_channels(configured_fogged["backgroundColor"], declared_color):
        raise RuntimeError("configure_scene did not activate the declared atmosphere world color")
    if configured_fogged["surfaceLinkCount"] != 1 or configured_fogged["volumeLinkCount"] != 1:
        raise RuntimeError("configure_scene and fog did not compose one surface and one volume")

    report = {
        "schemaVersion": 1,
        "result": "pass",
        "declaredColor": declared_color,
        "declaredStrength": declared_strength,
        "dryBuilder": dry_builder,
        "foggedBuilder": wet_builder,
        "fog": fog,
        "dry": dry,
        "fogged": fogged,
        "cleared": cleared,
        "configuredSceneFogged": configured_fogged,
        "checks": {
            "declaredColorActiveWithoutFog": True,
            "declaredColorActiveWithFog": True,
            "declaredStrengthPreservedWithFog": True,
            "singleSurfaceLink": True,
            "singleVolumeLinkWhenEnabled": True,
            "zeroDensityRemovesVolume": True,
            "configureSceneUsesExplicitWorldBuilder": True,
        },
    }
    with open(os.path.join(output, "world-node-report.json"), "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
        handle.write("\n")


if __name__ == "__main__":
    main()
