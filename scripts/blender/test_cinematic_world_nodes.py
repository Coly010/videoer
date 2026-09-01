"""Regression probe for explicit cinematic world surface and fog composition."""

import importlib.util
import hashlib
import json
import math
import os
import sys

import bpy
from mathutils import Vector


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
    environment = nodes.get(renderer.WORLD_ENVIRONMENT_NODE)
    direction_scale = nodes.get(renderer.WORLD_DIRECTION_SCALE_NODE)
    vector_rotate = nodes.get(renderer.WORLD_VECTOR_ROTATE_NODE)
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
        "backgroundColorSource": (
            background.inputs["Color"].links[0].from_node.name
            if background.inputs["Color"].is_linked
            else None
        ),
        "surfaceSource": surface_links[0].from_node.name if len(surface_links) == 1 else None,
        "surfaceLinkCount": len(surface_links),
        "volumeSource": volume_links[0].from_node.name if len(volume_links) == 1 else None,
        "volumeLinkCount": len(volume_links),
        "volumeNodePresent": volume is not None,
        "environmentNodePresent": environment is not None,
        "environmentColorSpace": (
            environment.image.colorspace_settings.name if environment and environment.image else None
        ),
        "environmentProjection": environment.projection if environment else None,
        "yawRadiansBlenderZ": (
            vector_rotate.inputs["Angle"].default_value if vector_rotate else None
        ),
        "coordinateOutput": (
            "negated-Incoming"
            if direction_scale
            and direction_scale.inputs["Vector"].is_linked
            and direction_scale.inputs["Vector"].links[0].from_socket.name == "Incoming"
            else None
        ),
        "directionScale": direction_scale.inputs["Scale"].default_value if direction_scale else None,
    }


def close_channels(first, second, tolerance=1e-7):
    return len(first) == len(second) and all(
        abs(left - right) <= tolerance for left, right in zip(first, second)
    )


def write_radiance(path, width=64, height=32):
    header = f"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y {height} +X {width}\n".encode("ascii")
    pixels = bytearray()
    # A directional barcode is deliberate: every camera-width window contains multiple
    # recognizable, asymmetric regions, so a constant coordinate cannot pass by sampling a
    # fortuitously smooth part of a panorama.
    directional_values = (30, 190, 55, 125, 225, 75, 155, 42, 205, 95, 235, 65, 145, 25, 175, 110)
    for row in range(height):
        for column in range(width):
            value = directional_values[(column // 2) % len(directional_values)]
            if row < height // 2:
                # Source panorama sky marker: blue-dominant immediately above the horizon.
                red, green, blue = value // 4, value // 2, value
            else:
                # Source panorama ground marker: red-dominant immediately below the horizon.
                red, green, blue = value, value // 2, value // 5
            exponent = 128
            pixel = (red, green, blue, exponent)
            pixels.extend(pixel)
    with open(path, "wb") as handle:
        handle.write(header)
        handle.write(pixels)
    with open(path, "rb") as handle:
        content = handle.read()
    return {
        "path": path,
        "sha256": hashlib.sha256(content).hexdigest(),
        "sizeBytes": len(content),
        "mediaType": "image/vnd.radiance",
    }


def write_openexr(path, width=16, height=8):
    image = bpy.data.images.new(
        "videoer-openexr-environment-fixture",
        width=width,
        height=height,
        alpha=True,
        float_buffer=True,
    )
    pixels = []
    for row in range(height):
        for column in range(width):
            if column < width // 2:
                pixels.extend((0.08, 0.22, 0.55, 1.0))
            else:
                pixels.extend((1.8 if row < height // 2 else 0.35, 0.24, 0.06, 1.0))
    image.pixels.foreach_set(pixels)
    image.colorspace_settings.name = "Linear Rec.709"
    settings = bpy.context.scene.render.image_settings
    previous_format = settings.file_format
    previous_depth = settings.color_depth
    settings.file_format = "OPEN_EXR"
    settings.color_depth = "32"
    image.save_render(path, scene=bpy.context.scene)
    settings.file_format = previous_format
    settings.color_depth = previous_depth
    bpy.data.images.remove(image)
    with open(path, "rb") as handle:
        content = handle.read()
    return {
        "path": path,
        "sha256": hashlib.sha256(content).hexdigest(),
        "sizeBytes": len(content),
        "mediaType": "image/x-exr",
    }


def pixel_statistics(pixels, width, height):
    luminance = []
    horizontal = [0.0] * width
    bottom_rgb = [0.0, 0.0, 0.0]
    top_rgb = [0.0, 0.0, 0.0]
    band_height = max(1, height // 4)
    for row in range(height):
        for column in range(width):
            offset = (row * width + column) * 4
            value = (
                0.2126 * pixels[offset]
                + 0.7152 * pixels[offset + 1]
                + 0.0722 * pixels[offset + 2]
            )
            luminance.append(value)
            horizontal[column] += value / height
            if row < band_height:
                for channel in range(3):
                    bottom_rgb[channel] += pixels[offset + channel] / (width * band_height)
            if row >= height - band_height:
                for channel in range(3):
                    top_rgb[channel] += pixels[offset + channel] / (width * band_height)
    mean = sum(luminance) / len(luminance)
    variance = sum((value - mean) ** 2 for value in luminance) / len(luminance)
    return {
        "minimumLuminance": min(luminance),
        "maximumLuminance": max(luminance),
        "luminanceRange": max(luminance) - min(luminance),
        "luminanceStandardDeviation": math.sqrt(variance),
        "horizontalProfile": horizontal,
        "screenTopMeanRgb": top_rgb,
        "screenBottomMeanRgb": bottom_rgb,
    }


def best_profile_shift(first, second, maximum=24):
    candidates = []
    for shift in range(-maximum, maximum + 1):
        pairs = [
            (first[index], second[index + shift])
            for index in range(len(first))
            if 0 <= index + shift < len(second)
        ]
        error = sum((left - right) ** 2 for left, right in pairs) / len(pairs)
        candidates.append((error, shift))
    error, shift = min(candidates)
    zero_error = next(value for value, amount in candidates if amount == 0)
    return {"shiftPixels": shift, "meanSquaredError": error, "zeroShiftError": zero_error}


def point_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def finite_fog_domain():
    requested_policy = {
        "policy": "scene-envelope-v1",
        "horizontalPaddingMeters": 4,
        "belowPaddingMeters": 1,
        "abovePaddingMeters": 4,
        "minimumHorizontalSpanMeters": 12,
        "minimumVerticalSpanMeters": 6,
        "maximumExtentMeters": 200,
        "edgeFalloffMeters": 1.5,
    }
    return {
        "schemaVersion": 1,
        "policy": "scene-envelope-v1",
        "coordinateSystem": "videoer-y-up-meters",
        "requestedPolicy": requested_policy,
        "sourcePointCount": 6,
        "sourceBoundsMinimum": [-4, -1, -5],
        "sourceBoundsMaximum": [4, 4, 5],
        "boundsMinimum": [-10, -4, -10],
        "boundsMaximum": [10, 8, 10],
        "center": [0, 2, 0],
        "size": [20, 12, 20],
        "horizontalPaddingMeters": 4,
        "belowPaddingMeters": 1,
        "abovePaddingMeters": 4,
        "minimumHorizontalSpanMeters": 12,
        "minimumVerticalSpanMeters": 6,
        "maximumExtentMeters": 200,
        "edgeFalloffMeters": 1.5,
        "derivationSha256": "a" * 64,
    }


def main():
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(values) not in (1, 2):
        raise RuntimeError("Expected output directory and optional real EXR path after --")
    output = os.path.abspath(values[0])
    real_exr_path = os.path.abspath(values[1]) if len(values) == 2 else None
    os.makedirs(output, exist_ok=True)
    renderer = load_renderer()
    scene = bpy.context.scene
    scene.frame_start = 1
    scene.frame_end = 1
    declared_color = [0.013, 0.027, 0.061]
    declared_strength = 0.72

    dry_builder = renderer.configure_world(scene, declared_color, declared_strength)
    dry = active_world_semantics(renderer, scene)
    if dry["surfaceSource"] != renderer.WORLD_BACKGROUND_NODE or dry["surfaceLinkCount"] != 1:
        raise RuntimeError("dry world does not use the explicit declared Background surface")
    if dry["volumeLinkCount"] != 0 or dry["volumeNodePresent"]:
        raise RuntimeError("dry world unexpectedly contains a fog volume")

    wet_builder = renderer.configure_world(scene, declared_color, declared_strength)
    fog_domain = finite_fog_domain()
    fog = renderer.create_fog(scene, 0.018, [0.11, 0.17, 0.24], fog_domain)
    fogged = active_world_semantics(renderer, scene)
    if fogged["surfaceSource"] != renderer.WORLD_BACKGROUND_NODE or fogged["surfaceLinkCount"] != 1:
        raise RuntimeError("fog replaced or duplicated the declared Background surface")
    if fogged["volumeLinkCount"] != 0 or fogged["volumeNodePresent"]:
        raise RuntimeError("finite fog polluted the World Output volume")
    if (
        not fog["materialVolumeLinked"]
        or fog["worldVolumeLinked"]
        or bpy.data.objects.get(renderer.FOG_OBJECT_NAME) is None
    ):
        raise RuntimeError("finite fog did not create one mesh-owned volume material")
    fog_object = bpy.data.objects[renderer.FOG_OBJECT_NAME]
    if any(
        abs(fog_object.dimensions[axis] - fog["blenderSizeMeters"][axis]) > 1e-5
        for axis in range(3)
    ):
        raise RuntimeError(
            f"finite fog cube dimensions differ from its deterministic report: "
            f"{list(fog_object.dimensions)} vs {fog['blenderSizeMeters']}"
        )
    fog_material = bpy.data.materials[renderer.FOG_MATERIAL_NAME]
    taper = fog_material.node_tree.nodes.get("videoer-fog-smootherstep-taper")
    if taper is None or taper.interpolation_type != "SMOOTHERSTEP" or not taper.clamp:
        raise RuntimeError("finite fog material lacks its bounded smootherstep edge taper")
    explicit_domain = {
        **fog_domain,
        "policy": "explicit-box-v1",
        "requestedPolicy": {
            "policy": "explicit-box-v1",
            "boundsMinimum": fog_domain["boundsMinimum"],
            "boundsMaximum": fog_domain["boundsMaximum"],
            "maximumExtentMeters": 200,
            "edgeFalloffMeters": 1.5,
        },
    }
    explicit_fog = renderer.create_fog(
        scene, 0.018, [0.11, 0.17, 0.24], explicit_domain
    )
    if explicit_fog["requestedPolicy"]["policy"] != "explicit-box-v1":
        raise RuntimeError("explicit finite fog box policy was not consumed")
    oversized_domain = {
        **fog_domain,
        "maximumExtentMeters": 5,
        "requestedPolicy": {**fog_domain["requestedPolicy"], "maximumExtentMeters": 5},
    }
    try:
        renderer.create_fog(scene, 0.018, [0.11, 0.17, 0.24], oversized_domain)
    except RuntimeError as error:
        maximum_extent_rejected = "maximumExtentMeters" in str(error)
    else:
        maximum_extent_rejected = False
    if not maximum_extent_rejected:
        raise RuntimeError("oversized finite fog domain was accepted")
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
    if bpy.data.objects.get(renderer.FOG_OBJECT_NAME) is not None:
        raise RuntimeError("zero-density fog did not remove the finite fog object")

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
            "exposure": {
                "viewTransform": "AgX",
                "look": "AgX - Medium High Contrast",
                "exposureStops": 0.75,
                "coherentAcrossShots": True,
            },
        }
    )
    configured_fog = renderer.create_fog(
        configured_scene, 0.018, [0.11, 0.17, 0.24], fog_domain
    )
    configured_fogged = active_world_semantics(renderer, configured_scene)
    if not close_channels(configured_fogged["backgroundColor"], declared_color):
        raise RuntimeError("configure_scene did not activate the declared atmosphere world color")
    if configured_fogged["surfaceLinkCount"] != 1 or configured_fogged["volumeLinkCount"] != 0:
        raise RuntimeError("configure_scene finite fog changed World surface/volume semantics")
    if configured_fog["derivationSha256"] != fog_domain["derivationSha256"]:
        raise RuntimeError("finite fog did not preserve its deterministic derivation identity")
    if renderer.color_management_report != {
        "viewTransform": "AgX",
        "look": "AgX - Medium High Contrast",
        "exposureStops": 0.75,
    }:
        raise RuntimeError("configure_scene did not consume the exact exposure contract")
    explicit_color_management = dict(renderer.color_management_report)

    # Model the main renderer's ordering: a VFX particle can be created after an earlier fog
    # build, but the final fog evaluation must sample its evaluated bounds across every frame.
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.25, location=(0, 0, 1))
    late_vfx = bpy.context.object
    late_vfx.name = "late-animated-vfx-witness"
    late_vfx.location.x = 0
    late_vfx.keyframe_insert(data_path="location", frame=1)
    late_vfx.location.x = 35
    late_vfx.keyframe_insert(data_path="location", frame=configured_scene.frame_end)
    for curve in late_vfx.animation_data.action.fcurves:
        for point in curve.keyframe_points:
            point.interpolation = "LINEAR"
    configured_scene.frame_set(7)
    late_vfx_fog = renderer.create_fog(
        configured_scene, 0.018, [0.11, 0.17, 0.24], fog_domain
    )
    evaluated_late_vfx = late_vfx_fog["evaluatedBounds"]
    if (
        late_vfx.name not in evaluated_late_vfx["includedVisibleObjects"]
        or evaluated_late_vfx["sampledFrames"]
        != list(range(configured_scene.frame_start, configured_scene.frame_end + 1))
        or evaluated_late_vfx["evaluatedSourceBoundsMaximum"][0] < 35.2
        or configured_scene.frame_current != 7
    ):
        raise RuntimeError(
            "final finite fog evaluation did not contain the late animated VFX mesh across all frames"
        )
    bpy.data.objects.remove(late_vfx, do_unlink=True)
    configured_scene.frame_set(1)

    radiance_path = os.path.join(output, "directional-environment.hdr")
    radiance_source = write_radiance(radiance_path)
    environment = {
        "kind": "hash-bound-equirectangular-radiance",
        "source": radiance_source,
        "colorSpace": "scene-linear-rec709",
        "projection": "equirectangular",
        "dimensions": {"widthPixels": 64, "heightPixels": 32},
        "yawDegrees": 35,
        "exposureStops": -1,
    }
    try:
        renderer.configure_scene(
            {
                "renderProfile": {
                    "engine": "eevee-next",
                    "samples": 1,
                    "seed": 1729,
                    "denoise": False,
                    "intent": "preview",
                },
                "resolution": {"width": 64, "height": 32, "percentage": 100},
                "fps": 24,
                "durationSeconds": 1,
                "atmosphere": {"worldColor": declared_color},
                "environmentIllumination": environment,
            }
        )
    except RuntimeError as error:
        eevee_environment_rejected = (
            "Eevee Next cannot consume reflection-bearing environment illumination" in str(error)
        )
    else:
        eevee_environment_rejected = False
    if not eevee_environment_rejected:
        raise RuntimeError(
            "Eevee environment illumination was accepted without a declared light-probe bake"
        )
    scene = renderer.configure_scene(
        {
            "renderProfile": {
                "engine": "cycles-cpu",
                "samples": 1,
                "seed": 1729,
                "denoise": False,
                "intent": "deterministic-final",
            },
            "resolution": {"width": 64, "height": 32, "percentage": 100},
            "fps": 24,
            "durationSeconds": 1,
            "atmosphere": {"worldColor": declared_color},
            "environmentIllumination": environment,
        }
    )
    environment_report = renderer.world_configuration_report
    environment_semantics = active_world_semantics(renderer, scene)
    if environment_semantics["backgroundColorSource"] != renderer.WORLD_ENVIRONMENT_NODE:
        raise RuntimeError("environment illumination did not drive the active Background color")
    if environment_semantics["environmentColorSpace"] != "Linear Rec.709":
        raise RuntimeError("environment illumination did not use scene-linear Rec.709")
    if environment_semantics["environmentProjection"] != "EQUIRECTANGULAR":
        raise RuntimeError("environment illumination did not use equirectangular projection")
    if (
        environment_semantics["coordinateOutput"] != "negated-Incoming"
        or abs(environment_semantics["directionScale"] + 1) > 1e-7
    ):
        raise RuntimeError("environment illumination did not use the outward World direction")
    if abs(environment_semantics["backgroundStrength"] - 0.5) > 1e-7:
        raise RuntimeError("environment exposure stops did not map to Background strength")
    if abs(environment_semantics["yawRadiansBlenderZ"] - math.radians(35)) > 1e-7:
        raise RuntimeError("environment yaw was not applied around Blender Z")
    environment_fog = renderer.create_fog(
        scene, 0.018, [0.11, 0.17, 0.24], fog_domain
    )
    environment_fogged = active_world_semantics(renderer, scene)
    if environment_fogged["volumeLinkCount"] != 0:
        raise RuntimeError("finite environment fog polluted the World Output volume")
    if not environment_fog["enabled"] or environment_fog["implementation"] != "finite-mesh-volume-v1":
        raise RuntimeError("environment illumination did not compose with finite mesh fog")

    unsupported = {**environment, "kind": "physical-sky"}
    try:
        renderer.configure_world(scene, declared_color, environment_illumination=unsupported)
    except RuntimeError as error:
        unsupported_rejected = "Unsupported environment illumination kind" in str(error)
    else:
        unsupported_rejected = False
    if not unsupported_rejected:
        raise RuntimeError("unsupported physical sky silently fell back to flat world color")
    forged = {
        **environment,
        "source": {**radiance_source, "sha256": "f" * 64},
    }
    try:
        renderer.configure_world(scene, declared_color, environment_illumination=forged)
    except RuntimeError as error:
        forged_hash_rejected = "SHA-256 mismatch" in str(error)
    else:
        forged_hash_rejected = False
    if not forged_hash_rejected:
        raise RuntimeError("forged environment illumination hash was accepted")
    invalid_size = {
        **environment,
        "source": {**radiance_source, "sizeBytes": radiance_source["sizeBytes"] + 1},
    }
    try:
        renderer.configure_world(scene, declared_color, environment_illumination=invalid_size)
    except RuntimeError as error:
        invalid_size_rejected = "byte size mismatch" in str(error)
    else:
        invalid_size_rejected = False
    if not invalid_size_rejected:
        raise RuntimeError("invalid environment illumination byte size was accepted")
    invalid_dimensions = {
        **environment,
        "dimensions": {"widthPixels": 66, "heightPixels": 33},
    }
    try:
        renderer.configure_world(scene, declared_color, environment_illumination=invalid_dimensions)
    except RuntimeError as error:
        invalid_dimensions_rejected = "Decoded environment illumination dimensions" in str(error)
    else:
        invalid_dimensions_rejected = False
    if not invalid_dimensions_rejected:
        raise RuntimeError("invalid decoded environment illumination dimensions were accepted")
    exr_path = os.path.join(output, "directional-environment.exr")
    exr_source = write_openexr(exr_path)
    exr_environment = {
        **environment,
        "source": exr_source,
        "dimensions": {"widthPixels": 16, "heightPixels": 8},
        "yawDegrees": -20,
    }
    exr_report = renderer.configure_world(
        scene, declared_color, environment_illumination=exr_environment
    )
    if exr_report["decodedBlenderFormat"] != "OPEN_EXR":
        raise RuntimeError("OpenEXR illumination did not decode as Blender OPEN_EXR")
    mismatched_media = {
        **environment,
        "source": {**radiance_source, "mediaType": "image/x-exr"},
    }
    try:
        renderer.configure_world(scene, declared_color, environment_illumination=mismatched_media)
    except RuntimeError as error:
        media_format_mismatch_rejected = "declared media type" in str(error)
    else:
        media_format_mismatch_rejected = False
    if not media_format_mismatch_rejected:
        raise RuntimeError("environment illumination media type/decoded format mismatch was accepted")

    renderer.geometry_probe.clear_scene()
    bpy.ops.object.camera_add(location=(0, 0, 0))
    scene.camera = bpy.context.object
    # Blender cameras look down local -Z by default; rotate to a horizontal world direction so
    # yaw, rather than the panorama's invariant pole, is the measured axis.
    scene.camera.rotation_euler = (math.pi / 2, 0, 0)
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 64
    scene.render.resolution_y = 32
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.view_settings.exposure = 0
    orientation_pixels = []
    orientation_paths = []
    for yaw in (0, 8):
        oriented = {**environment, "yawDegrees": yaw, "exposureStops": 0}
        renderer.configure_world(scene, declared_color, environment_illumination=oriented)
        path = os.path.join(output, f"environment-yaw-{yaw}.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        orientation_paths.append(path)
        rendered = bpy.data.images.load(path, check_existing=False)
        orientation_pixels.append(tuple(rendered.pixels[:]))
        bpy.data.images.remove(rendered)
    orientation_statistics = [
        pixel_statistics(pixels, scene.render.resolution_x, scene.render.resolution_y)
        for pixels in orientation_pixels
    ]
    if any(
        statistics["luminanceRange"] < 0.08
        or statistics["luminanceStandardDeviation"] < 0.015
        for statistics in orientation_statistics
    ):
        raise RuntimeError("a rendered asymmetric panorama is spatially flat within the frame")
    if any(
        statistics["screenTopMeanRgb"][2] <= statistics["screenTopMeanRgb"][0] + 0.15
        or statistics["screenBottomMeanRgb"][0]
        <= statistics["screenBottomMeanRgb"][2] + 0.15
        for statistics in orientation_statistics
    ):
        raise RuntimeError("environment orientation did not preserve sky-above-ground semantics")
    profile_shift = best_profile_shift(
        orientation_statistics[0]["horizontalProfile"],
        orientation_statistics[1]["horizontalProfile"],
    )
    if (
        abs(profile_shift["shiftPixels"]) < 2
        or profile_shift["meanSquaredError"] >= profile_shift["zeroShiftError"] * 0.8
    ):
        raise RuntimeError("environment yaw changed color without rotating recognizable regions")
    maximum_orientation_pixel_delta = max(
        abs(first - second)
        for first, second in zip(orientation_pixels[0], orientation_pixels[1])
    )
    if maximum_orientation_pixel_delta < 0.05:
        raise RuntimeError("environment yaw did not materially rotate the directional panorama")

    real_exr_report = None
    if real_exr_path is not None:
        decoded = bpy.data.images.load(real_exr_path, check_existing=False)
        real_width, real_height = decoded.size
        real_format = decoded.file_format
        bpy.data.images.remove(decoded)
        if real_format != "OPEN_EXR" or real_width != real_height * 2:
            raise RuntimeError("real environment witness is not a decoded 2:1 OpenEXR")
        with open(real_exr_path, "rb") as handle:
            real_bytes = handle.read()
        real_environment = {
            "kind": "hash-bound-equirectangular-radiance",
            "source": {
                "path": real_exr_path,
                "sha256": hashlib.sha256(real_bytes).hexdigest(),
                "sizeBytes": len(real_bytes),
                "mediaType": "image/x-exr",
            },
            "colorSpace": "scene-linear-rec709",
            "projection": "equirectangular",
            "dimensions": {"widthPixels": real_width, "heightPixels": real_height},
            "yawDegrees": 0,
            "exposureStops": 0,
        }
        renderer.geometry_probe.clear_scene()
        real_world = renderer.configure_world(
            scene, declared_color, environment_illumination=real_environment
        )
        bpy.ops.mesh.primitive_uv_sphere_add(
            segments=64, ring_count=32, radius=1, location=(0, 0, 1)
        )
        sphere = bpy.context.object
        sphere.name = "real-exr-diffuse-witness"
        material = bpy.data.materials.new("real-exr-diffuse-witness")
        material.use_nodes = True
        principled = material.node_tree.nodes.get("Principled BSDF")
        principled.inputs["Base Color"].default_value = (0.5, 0.5, 0.5, 1)
        principled.inputs["Roughness"].default_value = 1
        principled.inputs["Metallic"].default_value = 0
        sphere.data.materials.append(material)
        bpy.ops.object.camera_add(location=(3.2, -5.0, 2.6))
        scene.camera = bpy.context.object
        point_at(scene.camera, (0, 0, 1))
        scene.camera.data.lens = 58
        real_fog = renderer.create_fog(
            scene, 0.035, [0.11, 0.17, 0.24], fog_domain
        )
        if real_fog["worldVolumeLinked"] or not real_fog["materialVolumeLinked"]:
            raise RuntimeError("real EXR finite fog witness has invalid volume ownership")
        scene.render.engine = "CYCLES"
        scene.cycles.device = "CPU"
        scene.cycles.samples = 32
        scene.cycles.seed = 1729
        scene.cycles.use_animated_seed = False
        scene.cycles.use_adaptive_sampling = False
        scene.render.resolution_x = 192
        scene.render.resolution_y = 128
        scene.render.resolution_percentage = 100
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_mode = "RGBA"
        scene.render.film_transparent = False
        scene.view_settings.exposure = 0
        real_render_path = os.path.join(output, "real-exr-finite-fog-cycles.png")
        scene.render.filepath = real_render_path
        bpy.ops.render.render(write_still=True)
        rendered = bpy.data.images.load(real_render_path, check_existing=False)
        real_pixels = tuple(rendered.pixels[:])
        bpy.data.images.remove(rendered)
        sphere.hide_render = True
        background_only_path = os.path.join(
            output, "real-exr-finite-fog-cycles-background-only.png"
        )
        scene.render.filepath = background_only_path
        bpy.ops.render.render(write_still=True)
        background_rendered = bpy.data.images.load(
            background_only_path, check_existing=False
        )
        background_pixels = tuple(background_rendered.pixels[:])
        bpy.data.images.remove(background_rendered)
        sphere.hide_render = False
        object_mask_threshold = 0.02
        object_mask = []
        for offset in range(0, len(real_pixels), 4):
            rgb_difference = sum(
                abs(real_pixels[offset + channel] - background_pixels[offset + channel])
                for channel in range(3)
            )
            object_mask.append(rgb_difference >= object_mask_threshold)
        witness_luminance = []
        for row in range(1, scene.render.resolution_y - 1):
            for column in range(1, scene.render.resolution_x - 1):
                pixel_index = row * scene.render.resolution_x + column
                if not all(
                    object_mask[
                        (row + row_offset) * scene.render.resolution_x
                        + column
                        + column_offset
                    ]
                    for row_offset in (-1, 0, 1)
                    for column_offset in (-1, 0, 1)
                ):
                    continue
                offset = pixel_index * 4
                witness_luminance.append(
                    0.2126 * real_pixels[offset]
                    + 0.7152 * real_pixels[offset + 1]
                    + 0.0722 * real_pixels[offset + 2]
                )
        witness_mean = sum(witness_luminance) / len(witness_luminance) if witness_luminance else 0
        witness_variance = (
            sum((value - witness_mean) ** 2 for value in witness_luminance)
            / len(witness_luminance)
            if witness_luminance
            else 0
        )
        witness_standard_deviation = math.sqrt(witness_variance)
        witness_range = (
            max(witness_luminance) - min(witness_luminance) if witness_luminance else 0
        )
        if (
            len(witness_luminance) < 200
            or len(witness_luminance) >= scene.render.resolution_x * scene.render.resolution_y / 2
            or witness_mean < 0.02
            or witness_standard_deviation < 0.015
            or witness_range < 0.08
        ):
            raise RuntimeError(
                "real OpenEXR did not produce an isolated directional response on the diffuse Cycles witness"
            )
        real_exr_report = {
            "world": real_world,
            "fog": real_fog,
            "render": real_render_path,
            "backgroundOnlyRender": background_only_path,
            "isolationMethod": "paired-background-only-rgb-difference-v1",
            "objectMaskThreshold": object_mask_threshold,
            "objectMaskPixelCount": sum(object_mask),
            "objectMaskErosion": "one-pixel-eight-neighbour-v1",
            "witnessPixelCount": len(witness_luminance),
            "witnessMeanLuminance": witness_mean,
            "witnessLuminanceStandardDeviation": witness_standard_deviation,
            "witnessLuminanceRange": witness_range,
            "witnessMaximumLuminance": max(witness_luminance),
            "diffuseCyclesIlluminated": True,
            "directionalResponseVisible": True,
        }

    report = {
        "schemaVersion": 1,
        "result": "pass" if real_exr_report is not None else "structural-pass-real-source-not-run",
        "declaredColor": declared_color,
        "declaredStrength": declared_strength,
        "dryBuilder": dry_builder,
        "foggedBuilder": wet_builder,
        "fog": fog,
        "explicitFog": explicit_fog,
        "dry": dry,
        "fogged": fogged,
        "cleared": cleared,
        "configuredSceneFogged": configured_fogged,
        "lateAnimatedVfxFog": late_vfx_fog,
        "explicitColorManagement": explicit_color_management,
        "environmentSceneDefaultColorManagement": renderer.color_management_report,
        "environment": environment_report,
        "environmentSemantics": environment_semantics,
        "environmentFogged": environment_fogged,
        "openExrEnvironment": exr_report,
        "orientationRenders": orientation_paths,
        "orientationStatistics": orientation_statistics,
        "profileShift": profile_shift,
        "maximumOrientationPixelDelta": maximum_orientation_pixel_delta,
        "realExrDiffuseCycles": real_exr_report,
        "checks": {
            "declaredColorActiveWithoutFog": True,
            "declaredColorActiveWithFog": True,
            "declaredStrengthPreservedWithFog": True,
            "singleSurfaceLink": True,
            "worldVolumeNeverLinked": True,
            "finiteFogMaterialVolumeLinked": fog["materialVolumeLinked"],
            "explicitFogBoxConsumed": True,
            "maximumFogExtentRejected": maximum_extent_rejected,
            "zeroDensityRemovesFiniteFog": True,
            "configureSceneUsesExplicitWorldBuilder": True,
            "lateAnimatedVfxMeshContainedAcrossAllFrames": True,
            "explicitColorManagementConsumed": True,
            "environmentHashAndSizeValidated": True,
            "environmentColorSpaceExplicit": True,
            "environmentYawChangesRenderedPixels": True,
            "eachPanoramaRenderHasSpatialVariation": True,
            "sourceSkyMapsAboveSourceGround": True,
            "yawRotatesRecognizableRegions": True,
            "environmentExposureMapsToStrength": True,
            "environmentComposesWithFiniteFog": environment_fog["enabled"],
            "eeveeEnvironmentWithoutProbeBakeRejected": eevee_environment_rejected,
            "unsupportedKindRejected": unsupported_rejected,
            "forgedHashRejected": forged_hash_rejected,
            "invalidSizeRejected": invalid_size_rejected,
            "invalidDimensionsRejected": invalid_dimensions_rejected,
            "openExrDecodedExactly": True,
            "mediaFormatMismatchRejected": media_format_mismatch_rejected,
            "authoritativeRealSourceWitnessRan": real_exr_report is not None,
            "realExrDiffuseCyclesIlluminated": (
                real_exr_report is not None and real_exr_report["diffuseCyclesIlluminated"]
            ),
            "realExrFiniteFogDirectionalResponse": (
                real_exr_report is not None and real_exr_report["directionalResponseVisible"]
            ),
        },
    }
    with open(os.path.join(output, "world-node-report.json"), "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
        handle.write("\n")


if __name__ == "__main__":
    main()
