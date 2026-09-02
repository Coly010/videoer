import bpy
import hashlib
import json
import math
import os
import sys
from mathutils import Vector


def args_after_separator():
    if "--" not in sys.argv:
        raise RuntimeError("Expected geometry input and output directory after --")
    values = sys.argv[sys.argv.index("--") + 1 :]
    if len(values) != 2:
        raise RuntimeError("Usage: blender --background --python render_geometry_probe.py -- geometry.json output")
    return values


def to_blender(value):
    # Videoer is right-handed Y-up, forward -Z. Blender is right-handed Z-up, forward -Y.
    return (value[0], -value[2], value[1])


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def world_joint_positions(joints):
    positions = {}
    for joint in joints:
        local = Vector(to_blender(joint["restPosition"]))
        positions[joint["id"]] = positions.get(joint.get("parent"), Vector((0, 0, 0))) + local
    return positions


def create_armature(asset):
    data = bpy.data.armatures.new("canonical-humanoid")
    armature = bpy.data.objects.new("canonical-humanoid", data)
    bpy.context.collection.objects.link(armature)
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    positions = world_joint_positions(asset.get("skeleton", []))
    children = {}
    for joint in asset.get("skeleton", []):
        if joint.get("parent"):
            children.setdefault(joint["parent"], []).append(joint["id"])
    edit_bones = {}
    for joint in asset.get("skeleton", []):
        bone = data.edit_bones.new(joint["id"])
        head = positions[joint["id"]]
        child_ids = children.get(joint["id"], [])
        if child_ids:
            tail = positions[child_ids[0]]
        elif joint.get("parent") and joint["parent"] in positions:
            inherited_direction = head - positions[joint["parent"]]
            tail = (
                head + inherited_direction.normalized() * 0.04
                if inherited_direction.length >= 0.001
                else head + Vector((0, 0, 0.04))
            )
        else:
            tail = head + Vector((0, 0, 0.04))
        if (tail - head).length < 0.01:
            tail = head + Vector((0, 0, 0.04))
        bone.head = head
        bone.tail = tail
        edit_bones[joint["id"]] = bone
    for joint in asset.get("skeleton", []):
        if joint.get("parent"):
            edit_bones[joint["id"]].parent = edit_bones[joint["parent"]]
            edit_bones[joint["id"]].use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    armature.show_in_front = True
    armature.display_type = "WIRE"
    return armature


def verified_texture_path(asset_directory, channel):
    if not asset_directory:
        raise RuntimeError(
            f"Texture-backed material requires an asset directory for '{channel['semantic']}'"
        )
    portable = channel.get("path")
    if (
        not isinstance(portable, str)
        or not portable
        or os.path.isabs(portable)
        or "\\" in portable
        or any(part in ("", ".", "..") for part in portable.split("/"))
    ):
        raise RuntimeError(f"Texture dependency has an invalid relative path: {portable}")
    root = os.path.realpath(asset_directory)
    path = os.path.realpath(os.path.join(root, portable))
    if path == root or not path.startswith(root + os.sep):
        raise RuntimeError(f"Texture dependency escapes its asset package: {portable}")
    try:
        size = os.path.getsize(path)
    except FileNotFoundError as error:
        raise RuntimeError(f"Texture dependency is missing: {path}") from error
    if size != channel.get("sizeBytes"):
        raise RuntimeError(
            f"Texture dependency size mismatch for {path}: "
            f"expected {channel.get('sizeBytes')}, got {size}"
        )
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    if digest.hexdigest() != channel.get("sha256"):
        raise RuntimeError(f"Texture dependency hash mismatch: {path}")
    if not str(channel.get("mediaType", "")).startswith("image/"):
        raise RuntimeError(f"Texture dependency is not an image: {path}")
    return path


def validated_texture_application(texture_maps):
    application = texture_maps.get("application")
    if not isinstance(application, dict):
        raise RuntimeError("Texture-backed material requires a construction application")
    domains = {
        "flat-ground-surface", "modeled-paving-unit", "flat-facade-surface",
        "modeled-masonry-unit", "monolithic-architectural-surface",
        "natural-rock-surface", "prop-surface", "paving-joint-substrate",
    }
    domain = application.get("constructionDomain")
    if domain not in domains:
        raise RuntimeError(f"Texture application has invalid construction domain: {domain}")
    placement = application.get("placement")
    if not isinstance(placement, dict):
        raise RuntimeError("Texture application requires placement settings")
    if placement.get("scalePolicy") != "preserve-source-physical-scale":
        raise RuntimeError("Texture application must preserve source physical scale")
    orientation = placement.get("orientation")
    if orientation not in {
        "uv-authored", "unit-local-uv-meters", "world-horizontal", "world-vertical",
    }:
        raise RuntimeError(f"Texture application has invalid orientation: {orientation}")
    modeled_unit_domain = domain in {"modeled-paving-unit", "modeled-masonry-unit"}
    horizontal_domain = domain in {
        "flat-ground-surface", "modeled-paving-unit", "paving-joint-substrate",
    }
    vertical_domain = domain in {"flat-facade-surface", "modeled-masonry-unit"}
    if (horizontal_domain and orientation == "world-vertical") or (
        vertical_domain and orientation == "world-horizontal"
    ):
        raise RuntimeError(
            f"Texture orientation '{orientation}' is incompatible with '{domain}'"
        )
    if domain == "modeled-paving-unit" and orientation != "unit-local-uv-meters":
        raise RuntimeError("Modeled paving units require unit-local metre UV placement")
    if orientation == "unit-local-uv-meters" and not modeled_unit_domain:
        raise RuntimeError(
            "Unit-local metre UV placement is only valid on modeled construction units"
        )
    if domain == "paving-joint-substrate" and orientation != "world-horizontal":
        raise RuntimeError("Paving joint substrates require world-horizontal placement")

    def number(value, label, minimum=None, maximum=None):
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
            or (minimum is not None and value < minimum)
            or (maximum is not None and value > maximum)
        ):
            raise RuntimeError(f"Texture application {label} is outside its bounded range")
        return value

    offset = placement.get("offsetMeters")
    if not isinstance(offset, list) or len(offset) != 2:
        raise RuntimeError("Texture application offsetMeters must contain two finite values")
    number(offset[0], "offsetMeters[0]")
    number(offset[1], "offsetMeters[1]")
    number(placement.get("rotationDegrees"), "rotationDegrees", -180, 180)
    appearance = placement.get("appearance")
    macro = placement.get("macroVariation")
    if not isinstance(appearance, dict) or not isinstance(macro, dict):
        raise RuntimeError("Texture application requires appearance and macro variation")
    for field, minimum, maximum in (
        ("exposureStops", -1, 1), ("saturationScale", 0.65, 1.35),
        ("hueShiftDegrees", -12, 12), ("roughnessScale", 0.7, 1.3),
        ("roughnessOffset", -0.2, 0.2), ("weatheringAmount", 0, 1),
    ):
        number(appearance.get(field), f"appearance.{field}", minimum, maximum)
    seed = macro.get("seed")
    if isinstance(seed, bool) or not isinstance(seed, int):
        raise RuntimeError("Texture application macroVariation.seed must be an integer")
    number(macro.get("scaleMeters"), "macroVariation.scaleMeters", 1e-12)
    amplitudes = []
    for field, maximum in (
        ("valueAmplitude", 0.25), ("saturationAmplitude", 0.25),
        ("hueAmplitudeDegrees", 12), ("roughnessAmplitude", 0.2),
        ("weatheringAmplitude", 0.75),
    ):
        amplitudes.append(number(macro.get(field), f"macroVariation.{field}", 0, maximum))
    if not any(amplitudes):
        raise RuntimeError("Texture application requires at least one macro variation amplitude")
    unit = placement.get("unitVariation")
    if unit is not None:
        if domain != "modeled-paving-unit":
            raise RuntimeError("Unit variation attributes are only valid on modeled paving units")
        if unit.get("kind") != "vertex-scalar-attributes-v1":
            raise RuntimeError("Texture unit variation has an unsupported attribute contract")
        expected_attributes = {
            "valueAttribute": "videoer_unit_value_variation",
            "roughnessAttribute": "videoer_unit_roughness_variation",
            "weatheringAttribute": "videoer_unit_weathering_variation",
        }
        for field, expected in expected_attributes.items():
            if unit.get(field) != expected:
                raise RuntimeError(f"Texture unit variation {field} must be '{expected}'")
        for field, maximum in (
            ("valueAmplitude", 0.25),
            ("roughnessAmplitude", 0.2),
            ("weatheringAmplitude", 0.75),
        ):
            number(unit.get(field), f"unitVariation.{field}", 0, maximum)
    return application


def configure_texture_map_nodes(material, principled, surface, asset_directory):
    texture_maps = surface.get("textureMaps")
    if not texture_maps:
        return None
    if texture_maps.get("kind") != "hash-bound":
        raise RuntimeError("Blender only consumes hash-bound texture-map sets")
    application = validated_texture_application(texture_maps)
    placement = application["placement"]
    appearance = placement["appearance"]
    macro = placement["macroVariation"]
    physical_scale = texture_maps.get("physicalScale", {})
    width = physical_scale.get("widthMeters")
    height = physical_scale.get("heightMeters")
    if not isinstance(width, (int, float)) or width <= 0 or not isinstance(height, (int, float)) or height <= 0:
        raise RuntimeError("Texture-map physical scale must contain positive metre dimensions")
    suitability = texture_maps.get("suitability")
    if not isinstance(suitability, dict):
        raise RuntimeError("Texture-backed material requires construction suitability")
    composition = suitability.get("composition")
    intended_domains = suitability.get("intendedConstructionDomains")
    domain = application["constructionDomain"]
    if not isinstance(intended_domains, list) or domain not in intended_domains:
        raise RuntimeError(f"Texture source does not declare construction domain '{domain}'")
    if (
        placement["orientation"] == "unit-local-uv-meters"
        and composition != "homogeneous-unit-material"
    ):
        raise RuntimeError("Unit-local metre UV placement requires a homogeneous source")
    if domain == "paving-joint-substrate" and composition != "homogeneous-unit-material":
        raise RuntimeError("Paving joint substrates require a homogeneous source")
    if composition == "continuous-layout-scan" and domain in {
        "modeled-paving-unit", "modeled-masonry-unit",
    }:
        raise RuntimeError("Continuous layout scans cannot be applied to modeled units")
    if composition == "facade-course-pattern" and domain != "flat-facade-surface":
        raise RuntimeError("Facade course patterns require a flat facade host")
    if composition not in {
        "continuous-layout-scan", "homogeneous-unit-material", "facade-course-pattern",
    }:
        raise RuntimeError(f"Texture source has invalid composition: {composition}")
    minimum_macro_scale = max(width, height) * 2.0
    if placement["macroVariation"]["scaleMeters"] < minimum_macro_scale:
        raise RuntimeError(
            f"Texture macro variation must be at least {minimum_macro_scale} metres"
        )
    channels = texture_maps.get("channels", [])
    semantic_channels = {channel.get("semantic"): channel for channel in channels}
    if len(semantic_channels) != len(channels):
        raise RuntimeError("Texture-map channel semantics must be unique")
    for required in ("base-color", "normal", "roughness"):
        if required not in semantic_channels:
            raise RuntimeError(f"Texture-map set is missing required channel '{required}'")
    wetness = surface.get("roughness", {}).get("wetness", 0)
    if (
        isinstance(wetness, bool)
        or not isinstance(wetness, (int, float))
        or not math.isfinite(wetness)
        or wetness < 0
        or wetness > 1
    ):
        raise RuntimeError("Texture-backed material wetness must be finite and within 0..1")
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    coordinates = nodes.new("ShaderNodeTexCoord")
    coordinates.name = "videoer-texture-coordinates"

    object_axes = nodes.new("ShaderNodeSeparateXYZ")
    object_axes.name = "videoer-object-metre-axes"
    links.new(coordinates.outputs["Object"], object_axes.inputs["Vector"])

    uv_axes = nodes.new("ShaderNodeSeparateXYZ")
    uv_axes.name = "videoer-authored-uv-axes"
    links.new(coordinates.outputs["UV"], uv_axes.inputs["Vector"])

    def math_node(operation, left, right, name=None):
        node = nodes.new("ShaderNodeMath")
        node.operation = operation
        if name:
            node.name = name
        if hasattr(left, "is_output"):
            links.new(left, node.inputs[0])
        else:
            node.inputs[0].default_value = left
        if hasattr(right, "is_output"):
            links.new(right, node.inputs[1])
        else:
            node.inputs[1].default_value = right
        return node.outputs[0]

    rotation = math.radians(placement["rotationDegrees"])
    cosine = math.cos(rotation)
    sine = math.sin(rotation)

    def placement_vector(name, u_source, v_source, uv_normalized=False):
        # Rotation and offset operate in metres before normalization by the
        # immutable source physical dimensions. UV-authored coordinates are
        # converted to source metres first, so metre offsets remain meaningful.
        u_metres = math_node("MULTIPLY", u_source, width) if uv_normalized else u_source
        v_metres = math_node("MULTIPLY", v_source, height) if uv_normalized else v_source
        u_offset = math_node(
            "ADD", u_metres, placement["offsetMeters"][0],
            f"videoer-application-{name}-u-offset",
        )
        v_offset = math_node(
            "ADD", v_metres, placement["offsetMeters"][1],
            f"videoer-application-{name}-v-offset",
        )
        u_cos = math_node(
            "MULTIPLY", u_offset, cosine, f"videoer-application-{name}-rotation-cosine"
        )
        v_sin = math_node(
            "MULTIPLY", v_offset, sine, f"videoer-application-{name}-rotation-sine"
        )
        u_rotated = math_node("SUBTRACT", u_cos, v_sin)
        u_sin = math_node("MULTIPLY", u_offset, sine)
        v_cos = math_node("MULTIPLY", v_offset, cosine)
        v_rotated = math_node("ADD", u_sin, v_cos)
        vector = nodes.new("ShaderNodeCombineXYZ")
        vector.name = f"videoer-physical-{name}-mapping"
        links.new(
            math_node("DIVIDE", u_rotated, width, f"videoer-application-{name}-u-source-scale"),
            vector.inputs["X"],
        )
        links.new(
            math_node("DIVIDE", v_rotated, height, f"videoer-application-{name}-v-source-scale"),
            vector.inputs["Y"],
        )
        return vector.outputs["Vector"]

    orientation = placement["orientation"]
    if orientation in {"uv-authored", "unit-local-uv-meters"}:
        plane_axes = {"uv": ("U", "V")}
        plane_vectors = {
            "uv": placement_vector(
                "uv",
                uv_axes.outputs["X"],
                uv_axes.outputs["Y"],
                uv_normalized=orientation == "uv-authored",
            )
        }
    elif orientation == "world-horizontal":
        plane_axes = {"xy": ("X", "Y")}
        plane_vectors = {
            "xy": placement_vector("xy", object_axes.outputs["X"], object_axes.outputs["Y"])
        }
    else:
        plane_axes = {"xz": ("X", "Z"), "yz": ("Y", "Z")}
        plane_vectors = {
            "xz": placement_vector("xz", object_axes.outputs["X"], object_axes.outputs["Z"]),
            "yz": placement_vector("yz", object_axes.outputs["Y"], object_axes.outputs["Z"]),
        }

    plane_weights = {}
    if len(plane_vectors) > 1:
        normal_axes = nodes.new("ShaderNodeSeparateXYZ")
        normal_axes.name = "videoer-triplanar-normal-axes"
        links.new(coordinates.outputs["Normal"], normal_axes.inputs["Vector"])
        horizontal_weights = {}
        for plane, axis in (("xz", "Y"), ("yz", "X")):
            absolute = nodes.new("ShaderNodeMath")
            absolute.operation = "ABSOLUTE"
            links.new(normal_axes.outputs[axis], absolute.inputs[0])
            sharpened = nodes.new("ShaderNodeMath")
            sharpened.operation = "POWER"
            sharpened.inputs[1].default_value = 4.0
            links.new(absolute.outputs[0], sharpened.inputs[0])
            horizontal_weights[plane] = sharpened.outputs[0]
        total_weight = math_node(
            "ADD", horizontal_weights["xz"], horizontal_weights["yz"],
            "videoer-world-vertical-weight-total",
        )
        for plane in ("xz", "yz"):
            normalized = nodes.new("ShaderNodeMath")
            normalized.operation = "DIVIDE"
            links.new(horizontal_weights[plane], normalized.inputs[0])
            links.new(total_weight, normalized.inputs[1])
            normalized.name = f"videoer-triplanar-{plane}-weight"
            plane_weights[plane] = normalized.outputs[0]

    def weighted_plane_sum(outputs, semantic):
        if len(outputs) == 1:
            plane = next(iter(outputs))
            passthrough = nodes.new("ShaderNodeVectorMath")
            passthrough.operation = "SCALE"
            passthrough.inputs["Scale"].default_value = 1.0
            passthrough.name = f"videoer-texture-{semantic}"
            links.new(outputs[plane], passthrough.inputs[0])
            return passthrough.outputs["Vector"]
        weighted = []
        for plane in outputs:
            scale = nodes.new("ShaderNodeVectorMath")
            scale.operation = "SCALE"
            links.new(outputs[plane], scale.inputs[0])
            links.new(plane_weights[plane], scale.inputs["Scale"])
            weighted.append(scale.outputs["Vector"])
        first_sum = nodes.new("ShaderNodeVectorMath")
        first_sum.operation = "ADD"
        links.new(weighted[0], first_sum.inputs[0])
        links.new(weighted[1], first_sum.inputs[1])
        first_sum.name = f"videoer-texture-{semantic}"
        return first_sum.outputs["Vector"]

    image_nodes = {}
    report_channels = []
    for semantic, channel in semantic_channels.items():
        expected_color_space = "srgb-texture" if semantic == "base-color" else "non-color"
        if channel.get("colorSpace") != expected_color_space:
            raise RuntimeError(
                f"Texture channel '{semantic}' must use {expected_color_space}"
            )
        if semantic == "normal" and channel.get("normalConvention") != "opengl-positive-green":
            raise RuntimeError("Blender requires canonical OpenGL positive-green normal maps")
        path = verified_texture_path(asset_directory, channel)
        try:
            image = bpy.data.images.load(path, check_existing=True)
            if image.size[0] <= 0 or image.size[1] <= 0:
                raise RuntimeError("loaded image contains no decoded pixels")
        except RuntimeError as error:
            raise RuntimeError(
                f"Texture dependency '{semantic}' cannot be decoded as an image: {path}"
            ) from error
        image.colorspace_settings.name = "sRGB" if semantic == "base-color" else "Non-Color"
        projected_outputs = {}
        for plane in plane_vectors:
            texture = nodes.new("ShaderNodeTexImage")
            texture.name = f"videoer-texture-{semantic}-{plane}"
            texture.label = f"{semantic} {plane.upper()}"
            texture.image = image
            texture.extension = "REPEAT"
            texture.projection = "FLAT"
            links.new(plane_vectors[plane], texture.inputs["Vector"])
            projected_outputs[plane] = texture.outputs["Color"]
        image_nodes[semantic] = weighted_plane_sum(projected_outputs, semantic)
        report_channels.append(
            {
                "semantic": semantic,
                "path": path,
                "colorSpace": image.colorspace_settings.name,
                "sha256": channel["sha256"],
            }
        )

    macro_mapping = nodes.new("ShaderNodeMapping")
    macro_mapping.name = "videoer-application-macro-mapping"
    seed = macro["seed"]
    seed_offset = (
        ((seed * 0.754877666) % 1.0) * 97.0,
        ((seed * 0.569840296) % 1.0) * 89.0,
        ((seed * 0.438579021) % 1.0) * 83.0,
    )
    macro_mapping.inputs["Location"].default_value = seed_offset
    links.new(coordinates.outputs["Object"], macro_mapping.inputs["Vector"])
    macro_noise = nodes.new("ShaderNodeTexNoise")
    macro_noise.name = "videoer-application-macro-noise"
    macro_noise.noise_dimensions = "3D"
    macro_noise.inputs["Scale"].default_value = 1.0 / macro["scaleMeters"]
    macro_noise.inputs["Detail"].default_value = 2.0
    macro_noise.inputs["Roughness"].default_value = 0.55
    links.new(macro_mapping.outputs["Vector"], macro_noise.inputs["Vector"])
    doubled_noise = math_node("MULTIPLY", macro_noise.outputs["Fac"], 2.0)
    signed_macro = math_node(
        "SUBTRACT", doubled_noise, 1.0, "videoer-application-macro-signed"
    )
    unit = placement.get("unitVariation")
    unit_outputs = {}
    if unit:
        for semantic, field in (
            ("value", "valueAttribute"),
            ("roughness", "roughnessAttribute"),
            ("weathering", "weatheringAttribute"),
        ):
            attribute = nodes.new("ShaderNodeAttribute")
            attribute.name = f"videoer-unit-{semantic}-attribute"
            attribute.attribute_name = unit[field]
            unit_outputs[semantic] = attribute.outputs["Fac"]

    base_color_output = image_nodes["base-color"]
    if "ambient-occlusion" in image_nodes:
        ao_multiply = nodes.new("ShaderNodeMixRGB")
        ao_multiply.name = "videoer-base-color-ambient-occlusion"
        ao_multiply.blend_type = "MULTIPLY"
        ao_multiply.inputs[0].default_value = 1.0
        links.new(base_color_output, ao_multiply.inputs[1])
        links.new(image_nodes["ambient-occlusion"], ao_multiply.inputs[2])
        base_color_output = ao_multiply.outputs["Color"]

    hue = math_node(
        "MULTIPLY", signed_macro, macro["hueAmplitudeDegrees"] / 360.0,
        "videoer-application-macro-hue-amplitude",
    )
    hue = math_node(
        "ADD", hue, 0.5 + appearance["hueShiftDegrees"] / 360.0,
        "videoer-application-hue",
    )
    saturation = math_node(
        "MULTIPLY", signed_macro, macro["saturationAmplitude"],
        "videoer-application-macro-saturation-amplitude",
    )
    saturation = math_node(
        "ADD", saturation, appearance["saturationScale"],
        "videoer-application-saturation",
    )
    macro_value = math_node(
        "MULTIPLY", signed_macro, macro["valueAmplitude"],
        "videoer-application-macro-value-amplitude",
    )
    if unit:
        unit_value = math_node(
            "MULTIPLY", unit_outputs["value"], unit["valueAmplitude"],
            "videoer-application-unit-value-amplitude",
        )
        macro_value = math_node("ADD", macro_value, unit_value)
    macro_value = math_node("ADD", macro_value, 1.0)
    value = math_node(
        "MULTIPLY", macro_value, 2.0 ** appearance["exposureStops"],
        "videoer-application-value",
    )
    appearance_hsv = nodes.new("ShaderNodeHueSaturation")
    appearance_hsv.name = "videoer-application-hsv"
    links.new(hue, appearance_hsv.inputs["Hue"])
    links.new(saturation, appearance_hsv.inputs["Saturation"])
    links.new(value, appearance_hsv.inputs["Value"])
    links.new(base_color_output, appearance_hsv.inputs["Color"])
    base_color_output = appearance_hsv.outputs["Color"]

    weather_macro = math_node(
        "MULTIPLY", macro_noise.outputs["Fac"], macro["weatheringAmplitude"],
        "videoer-application-macro-weathering-amplitude",
    )
    weather_amount = math_node(
        "ADD", weather_macro, appearance["weatheringAmount"],
        "videoer-application-weathering-amount",
    )
    if unit:
        unit_weathering = math_node(
            "MULTIPLY", unit_outputs["weathering"], unit["weatheringAmplitude"],
            "videoer-application-unit-weathering-amplitude",
        )
        weather_amount = math_node("ADD", weather_amount, unit_weathering)
    weather_clamp = nodes.new("ShaderNodeClamp")
    weather_clamp.name = "videoer-application-weathering"
    weather_clamp.inputs["Min"].default_value = 0.0
    weather_clamp.inputs["Max"].default_value = 1.0
    links.new(weather_amount, weather_clamp.inputs["Value"])
    weather_darkening = math_node("MULTIPLY", weather_clamp.outputs["Result"], -0.12)
    weather_darkening = math_node("ADD", weather_darkening, 1.0)
    weather_color = nodes.new("ShaderNodeMixRGB")
    weather_color.name = "videoer-application-weathering-darkening"
    weather_color.blend_type = "MULTIPLY"
    weather_color.inputs[0].default_value = 1.0
    links.new(base_color_output, weather_color.inputs[1])
    links.new(weather_darkening, weather_color.inputs[2])
    base_color_output = weather_color.outputs["Color"]

    roughness_scale = math_node(
        "MULTIPLY", image_nodes["roughness"], appearance["roughnessScale"],
        "videoer-application-roughness-scale",
    )
    roughness_offset = math_node(
        "ADD", roughness_scale, appearance["roughnessOffset"],
        "videoer-application-roughness-offset",
    )
    macro_roughness = math_node(
        "MULTIPLY", signed_macro, macro["roughnessAmplitude"],
        "videoer-application-macro-roughness-amplitude",
    )
    if unit:
        unit_roughness = math_node(
            "MULTIPLY", unit_outputs["roughness"], unit["roughnessAmplitude"],
            "videoer-application-unit-roughness-amplitude",
        )
        macro_roughness = math_node("ADD", macro_roughness, unit_roughness)
    roughness_modulated = math_node("ADD", roughness_offset, macro_roughness)
    weather_roughness = math_node("MULTIPLY", weather_clamp.outputs["Result"], 0.12)
    roughness_modulated = math_node("ADD", roughness_modulated, weather_roughness)
    roughness_clamp = nodes.new("ShaderNodeClamp")
    roughness_clamp.name = "videoer-application-roughness-clamp"
    roughness_clamp.inputs["Min"].default_value = 0.0
    roughness_clamp.inputs["Max"].default_value = 1.0
    links.new(roughness_modulated, roughness_clamp.inputs["Value"])
    application_roughness = roughness_clamp.outputs["Result"]
    wet_response = {
        "wetness": wetness,
        "baseColorDarkening": 0.0,
        "roughnessMultiplier": 1.0,
        "roughnessFloor": 0.0,
        "coatWeight": 0.0,
        "coatRoughness": None,
        "coatIor": None,
    }
    if wetness > 0:
        # A water film darkens porous diffuse substrates through increased
        # internal absorption while smoothing the exposed microfacet response.
        # Keep both effects bounded: wet stone should not become black or a
        # mathematically perfect mirror. The dry branch below remains an exact
        # pass-through of the verified source maps.
        darkening = 0.18 * wetness
        wet_darkening = nodes.new("ShaderNodeMixRGB")
        wet_darkening.name = "videoer-wet-base-color-darkening"
        wet_darkening.blend_type = "MULTIPLY"
        wet_darkening.inputs[0].default_value = 1.0
        wet_darkening.inputs[2].default_value = (1.0 - darkening,) * 3 + (1.0,)
        links.new(base_color_output, wet_darkening.inputs[1])
        base_color_output = wet_darkening.outputs["Color"]

        roughness_multiplier = 1.0 - 0.65 * wetness
        wet_roughness_scale = nodes.new("ShaderNodeMath")
        wet_roughness_scale.name = "videoer-wet-roughness-compression"
        wet_roughness_scale.operation = "MULTIPLY"
        wet_roughness_scale.inputs[1].default_value = roughness_multiplier
        links.new(application_roughness, wet_roughness_scale.inputs[0])
        wet_roughness_floor = nodes.new("ShaderNodeMath")
        wet_roughness_floor.name = "videoer-wet-roughness-floor"
        wet_roughness_floor.operation = "MAXIMUM"
        wet_roughness_floor.inputs[1].default_value = 0.04
        links.new(wet_roughness_scale.outputs[0], wet_roughness_floor.inputs[0])
        roughness_output = wet_roughness_floor.outputs[0]

        coat_weight = principled.inputs.get("Coat Weight")
        coat_roughness = principled.inputs.get("Coat Roughness")
        coat_ior = principled.inputs.get("Coat IOR")
        if not coat_weight or not coat_roughness or not coat_ior:
            raise RuntimeError("Blender Principled BSDF lacks required wet-film coat inputs")
        coat_weight.default_value = wetness
        coat_roughness.default_value = 0.03 + (1.0 - wetness) * 0.09
        coat_ior.default_value = 1.333
        wet_response = {
            "wetness": wetness,
            "baseColorDarkening": darkening,
            "roughnessMultiplier": roughness_multiplier,
            "roughnessFloor": 0.04,
            "coatWeight": coat_weight.default_value,
            "coatRoughness": coat_roughness.default_value,
            "coatIor": coat_ior.default_value,
        }
    else:
        roughness_output = application_roughness
    links.new(base_color_output, principled.inputs["Base Color"])
    links.new(roughness_output, principled.inputs["Roughness"])
    if "metallic" in image_nodes:
        links.new(image_nodes["metallic"], principled.inputs["Metallic"])

    normal_map = nodes.new("ShaderNodeNormalMap")
    normal_map.name = "videoer-opengl-normal-map"
    normal_map.space = "TANGENT"
    normal_map.inputs["Strength"].default_value = surface["normal"].get("strength", 1.0)
    links.new(image_nodes["normal"], normal_map.inputs["Color"])
    links.new(normal_map.outputs["Normal"], principled.inputs["Normal"])

    if "displacement" in image_nodes:
        displacement = nodes.new("ShaderNodeDisplacement")
        displacement.name = "videoer-texture-displacement"
        displacement.inputs["Midlevel"].default_value = 0.5
        displacement.inputs["Scale"].default_value = surface["normal"].get("scaleMeters", 0.01)
        links.new(image_nodes["displacement"], displacement.inputs["Height"])
        output = nodes.get("Material Output")
        if output:
            links.new(displacement.outputs["Displacement"], output.inputs["Displacement"])

    if "opacity" in image_nodes:
        links.new(image_nodes["opacity"], principled.inputs["Alpha"])
        if hasattr(material, "surface_render_method"):
            material.surface_render_method = "DITHERED"

    report = {
        "kind": "hash-bound-pbr-textures-v1",
        "physicalScale": {"widthMeters": width, "heightMeters": height},
        "mapping": {
            "kind": {
                "uv-authored": "authored-uv-physical",
                "unit-local-uv-meters": "unit-local-uv-meters-physical",
                "world-horizontal": "world-horizontal-physical",
                "world-vertical": "world-vertical-triplanar",
            }[orientation],
            "orientation": orientation,
            "offsetMeters": list(placement["offsetMeters"]),
            "rotationDegrees": placement["rotationDegrees"],
            "blendSharpness": 4.0,
            "planes": {
                plane: {
                    "axes": list(axes),
                    "scale": [1.0 / width, 1.0 / height],
                }
                for plane, axes in plane_axes.items()
            },
        },
        "application": {
            "constructionDomain": application["constructionDomain"],
            "appearance": dict(appearance),
            "macroVariation": dict(macro),
            "unitVariation": dict(unit) if unit else None,
            "macroSeedOffset": list(seed_offset),
        },
        "wetSurfaceResponse": wet_response,
        "channels": report_channels,
    }
    material["videoer_texture_report"] = json.dumps(report, sort_keys=True)
    return report


def configure_surface_nodes(material, principled, surface, asset_directory=None):
    if not principled or not surface:
        return
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    coordinates = nodes.new("ShaderNodeTexCoord")
    mapping = nodes.new("ShaderNodeMapping")
    seed = surface["baseColor"].get("seed", 1)
    mapping.inputs["Location"].default_value = (
        (seed * 0.137) % 13.0,
        (seed * 0.271) % 17.0,
        (seed * 0.419) % 19.0,
    )
    # Object coordinates remain in scene units, so every declared scale is
    # interpreted in metres regardless of the complete mesh bounds. Generated
    # coordinates normalize a whole street to 0..1 and turn a 5 cm material
    # detail into building-sized colour fields.
    links.new(coordinates.outputs["Object"], mapping.inputs["Vector"])
    separated = nodes.new("ShaderNodeSeparateXYZ")
    links.new(mapping.outputs["Vector"], separated.inputs["Vector"])
    domain_components = {
        "x": separated.outputs["X"],
        # Videoer Y-up becomes Blender Z-up at the renderer boundary.
        "y": separated.outputs["Z"],
    }
    domain_z = nodes.new("ShaderNodeMath")
    domain_z.operation = "MULTIPLY"
    domain_z.inputs[1].default_value = -1.0
    links.new(separated.outputs["Y"], domain_z.inputs[0])
    domain_components["z"] = domain_z.outputs[0]

    def projected_vector(axes):
        combined = nodes.new("ShaderNodeCombineXYZ")
        links.new(domain_components[axes[0]], combined.inputs["X"])
        if len(axes) > 1:
            links.new(domain_components[axes[1]], combined.inputs["Y"])
        if len(axes) > 2:
            links.new(domain_components[axes[2]], combined.inputs["Z"])
        return combined.outputs["Vector"]

    def darkened(color, wetness):
        factor = 1.0 - wetness * 0.22
        return tuple(channel * factor for channel in color[:3]) + (color[3],)

    pattern = surface.get("pattern", {"kind": "isotropic"})
    colors = surface["baseColor"]["colors"]
    wetness = surface["roughness"].get("wetness", 0)
    pattern_factor = None
    pattern_normal = None
    pattern_roughness = None
    color_noise = nodes.new("ShaderNodeTexNoise")
    color_noise.inputs["Scale"].default_value = 1.0 / surface["baseColor"]["scaleMeters"]
    color_noise.inputs["Detail"].default_value = 3.0
    color_noise.inputs["Roughness"].default_value = 0.58
    links.new(mapping.outputs["Vector"], color_noise.inputs["Vector"])

    if pattern["kind"] == "masonry-bond":
        brick = nodes.new("ShaderNodeTexBrick")
        brick.offset = pattern.get("rowOffset", 0.5)
        brick.offset_frequency = 2
        brick.inputs["Scale"].default_value = 1.0
        brick.inputs["Mortar Size"].default_value = pattern["mortarWidthMeters"]
        brick.inputs["Mortar Smooth"].default_value = pattern["mortarWidthMeters"] * 0.16
        brick.inputs["Brick Width"].default_value = pattern["unitWidthMeters"]
        brick.inputs["Row Height"].default_value = pattern["unitHeightMeters"]
        brick.inputs["Color1"].default_value = darkened(colors[0], wetness)
        brick.inputs["Color2"].default_value = darkened(colors[-1], wetness)
        brick.inputs["Mortar"].default_value = darkened(pattern["mortarColor"], wetness)
        brick_vector = projected_vector(pattern["projectionAxes"])
        irregularity = pattern.get("irregularityMeters", 0)
        if irregularity > 0:
            distortion_noise = nodes.new("ShaderNodeTexNoise")
            distortion_noise.inputs["Scale"].default_value = 1.0 / pattern["unitWidthMeters"]
            distortion_noise.inputs["Detail"].default_value = 2.0
            distortion_noise.inputs["Roughness"].default_value = 0.55
            links.new(brick_vector, distortion_noise.inputs["Vector"])
            centred_distortion = nodes.new("ShaderNodeVectorMath")
            centred_distortion.operation = "SUBTRACT"
            centred_distortion.inputs[1].default_value = (0.5, 0.5, 0.5)
            links.new(distortion_noise.outputs["Color"], centred_distortion.inputs[0])
            scaled_distortion = nodes.new("ShaderNodeVectorMath")
            scaled_distortion.operation = "SCALE"
            scaled_distortion.inputs["Scale"].default_value = irregularity
            links.new(centred_distortion.outputs["Vector"], scaled_distortion.inputs[0])
            distorted_vector = nodes.new("ShaderNodeVectorMath")
            distorted_vector.operation = "ADD"
            links.new(brick_vector, distorted_vector.inputs[0])
            links.new(scaled_distortion.outputs["Vector"], distorted_vector.inputs[1])
            brick_vector = distorted_vector.outputs["Vector"]
        links.new(brick_vector, brick.inputs["Vector"])

        # Broad deterministic weathering modulates the bond without erasing its
        # mortar structure or turning each facade into one uniform brick colour.
        weather = nodes.new("ShaderNodeValToRGB")
        weather.color_ramp.elements[0].color = (0.7, 0.7, 0.7, 1)
        weather.color_ramp.elements[1].color = (1.0, 1.0, 1.0, 1)
        links.new(color_noise.outputs["Fac"], weather.inputs["Fac"])
        weathered_brick = nodes.new("ShaderNodeMixRGB")
        weathered_brick.blend_type = "MULTIPLY"
        weathered_brick.inputs["Fac"].default_value = 0.72
        links.new(brick.outputs["Color"], weathered_brick.inputs[1])
        links.new(weather.outputs["Color"], weathered_brick.inputs[2])
        links.new(weathered_brick.outputs["Color"], principled.inputs["Base Color"])
        pattern_factor = brick.outputs["Fac"]
        edge_bump = nodes.new("ShaderNodeBump")
        edge_bump.inputs["Strength"].default_value = min(1.0, surface["normal"]["strength"] * 1.35)
        edge_bump.inputs["Distance"].default_value = pattern.get("edgeReliefMeters", 0.004)
        links.new(pattern_factor, edge_bump.inputs["Height"])
        pattern_normal = edge_bump.outputs["Normal"]
    elif pattern["kind"] == "directional-wood":
        grain_axis = pattern["grainAxis"]
        cross_axes = [axis for axis in ("x", "y", "z") if axis != grain_axis]
        grain_mapping = nodes.new("ShaderNodeMapping")
        grain_mapping.inputs["Scale"].default_value = (
            1.0 / pattern["grainWidthMeters"],
            1.0 / pattern["longitudinalScaleMeters"],
            0.5 / pattern["grainWidthMeters"],
        )
        links.new(
            projected_vector([cross_axes[0], grain_axis, cross_axes[1]]),
            grain_mapping.inputs["Vector"],
        )
        grain_noise = nodes.new("ShaderNodeTexNoise")
        grain_noise.inputs["Scale"].default_value = 1.0
        grain_noise.inputs["Detail"].default_value = 5.0
        grain_noise.inputs["Roughness"].default_value = 0.72
        grain_noise.inputs["Distortion"].default_value = pattern["distortion"] * 0.12
        links.new(grain_mapping.outputs["Vector"], grain_noise.inputs["Vector"])
        grain_wave = nodes.new("ShaderNodeTexWave")
        grain_wave.wave_type = "BANDS"
        grain_wave.bands_direction = "X"
        grain_wave.inputs["Scale"].default_value = 1.0
        grain_wave.inputs["Distortion"].default_value = pattern["distortion"]
        grain_wave.inputs["Detail"].default_value = 4.0
        grain_wave.inputs["Detail Scale"].default_value = 2.2
        links.new(grain_mapping.outputs["Vector"], grain_wave.inputs["Vector"])
        combined_grain = nodes.new("ShaderNodeMixRGB")
        combined_grain.blend_type = "MULTIPLY"
        combined_grain.inputs["Fac"].default_value = pattern["ringContrast"]
        links.new(grain_noise.outputs["Fac"], combined_grain.inputs[1])
        links.new(grain_wave.outputs["Color"], combined_grain.inputs[2])
        pattern_factor = combined_grain.outputs["Color"]
        palette = nodes.new("ShaderNodeValToRGB")
        elements = palette.color_ramp.elements
        elements[0].position = 0.0
        elements[0].color = darkened(colors[0], wetness)
        elements[1].position = 1.0
        elements[1].color = darkened(colors[-1], wetness)
        for index, color in enumerate(colors[1:-1], start=1):
            element = elements.new(index / (len(colors) - 1))
            element.color = darkened(color, wetness)
        links.new(pattern_factor, palette.inputs["Fac"])
        links.new(palette.outputs["Color"], principled.inputs["Base Color"])
        grain_bump = nodes.new("ShaderNodeBump")
        grain_bump.inputs["Strength"].default_value = surface["normal"]["strength"] * 0.55
        grain_bump.inputs["Distance"].default_value = pattern["grainWidthMeters"] * 0.07
        links.new(pattern_factor, grain_bump.inputs["Height"])
        pattern_normal = grain_bump.outputs["Normal"]
    elif pattern["kind"] == "mineral-plaster":
        trowel = nodes.new("ShaderNodeTexNoise")
        trowel.inputs["Scale"].default_value = 1.0 / pattern["trowelScaleMeters"]
        trowel.inputs["Detail"].default_value = 2.2
        trowel.inputs["Roughness"].default_value = 0.48
        links.new(mapping.outputs["Vector"], trowel.inputs["Vector"])
        aggregate = nodes.new("ShaderNodeTexNoise")
        aggregate.inputs["Scale"].default_value = 1.0 / pattern["aggregateScaleMeters"]
        aggregate.inputs["Detail"].default_value = 4.5
        aggregate.inputs["Roughness"].default_value = pattern["porosity"]
        links.new(mapping.outputs["Vector"], aggregate.inputs["Vector"])
        plaster = nodes.new("ShaderNodeMixRGB")
        plaster.blend_type = "MULTIPLY"
        plaster.inputs["Fac"].default_value = pattern["trowelContrast"]
        links.new(trowel.outputs["Fac"], plaster.inputs[1])
        links.new(aggregate.outputs["Fac"], plaster.inputs[2])
        pattern_factor = plaster.outputs["Color"]
        palette = nodes.new("ShaderNodeValToRGB")
        palette.color_ramp.elements[0].color = darkened(colors[0], wetness)
        palette.color_ramp.elements[1].color = darkened(colors[-1], wetness)
        links.new(pattern_factor, palette.inputs["Fac"])
        links.new(palette.outputs["Color"], principled.inputs["Base Color"])
        relief = nodes.new("ShaderNodeBump")
        relief.inputs["Strength"].default_value = surface["normal"]["strength"] * 0.65
        relief.inputs["Distance"].default_value = pattern["aggregateScaleMeters"] * 0.08
        links.new(pattern_factor, relief.inputs["Height"])
        pattern_normal = relief.outputs["Normal"]
    elif pattern["kind"] == "granular-aggregate":
        aggregate_scale = pattern["aggregateScaleMeters"]
        fines_scale = pattern["finesScaleMeters"]
        contrast = pattern["aggregateContrast"]
        pore_amount = pattern["poreAmount"]
        compaction = pattern["compaction"]
        embedded_dirt = pattern["embeddedDirtAmount"]

        aggregate_mapping = nodes.new("ShaderNodeMapping")
        aggregate_mapping.name = "videoer-granular-aggregate-mapping"
        aggregate_mapping.inputs["Scale"].default_value = (1.0 / aggregate_scale,) * 3
        links.new(mapping.outputs["Vector"], aggregate_mapping.inputs["Vector"])
        aggregate_cells = nodes.new("ShaderNodeTexVoronoi")
        aggregate_cells.name = "videoer-granular-aggregate-cells"
        aggregate_cells.distance = "EUCLIDEAN"
        aggregate_cells.feature = "DISTANCE_TO_EDGE"
        links.new(aggregate_mapping.outputs["Vector"], aggregate_cells.inputs["Vector"])

        # Distance-to-edge produces real aggregate boundaries rather than a
        # cloudy single-frequency noise. Compaction widens the dense aggregate
        # bodies while leaving a bounded fraction of narrow pore seams.
        aggregate_profile = nodes.new("ShaderNodeMapRange")
        aggregate_profile.name = "videoer-granular-aggregate-profile"
        aggregate_profile.clamp = True
        aggregate_profile.inputs["From Min"].default_value = 0.008
        aggregate_profile.inputs["From Max"].default_value = 0.12 + compaction * 0.14
        links.new(aggregate_cells.outputs["Distance"], aggregate_profile.inputs["Value"])

        fines_mapping = nodes.new("ShaderNodeMapping")
        fines_mapping.name = "videoer-granular-fines-mapping"
        fines_mapping.inputs["Scale"].default_value = (1.0 / fines_scale,) * 3
        links.new(mapping.outputs["Vector"], fines_mapping.inputs["Vector"])
        fines = nodes.new("ShaderNodeTexNoise")
        fines.name = "videoer-granular-fines"
        fines.noise_dimensions = "3D"
        fines.inputs["Scale"].default_value = 1.0
        fines.inputs["Detail"].default_value = 3.5
        fines.inputs["Roughness"].default_value = 0.68
        links.new(fines_mapping.outputs["Vector"], fines.inputs["Vector"])

        grain_factor = nodes.new("ShaderNodeMixRGB")
        grain_factor.name = "videoer-granular-aggregate-fines-mix"
        grain_factor.blend_type = "MIX"
        grain_factor.inputs["Fac"].default_value = contrast
        links.new(fines.outputs["Fac"], grain_factor.inputs[1])
        links.new(aggregate_profile.outputs["Result"], grain_factor.inputs[2])
        pattern_factor = grain_factor.outputs["Color"]

        palette = nodes.new("ShaderNodeValToRGB")
        palette.name = "videoer-granular-palette"
        elements = palette.color_ramp.elements
        elements[0].position = 0.0
        elements[0].color = darkened(colors[0], wetness)
        elements[1].position = 1.0
        elements[1].color = darkened(colors[-1], wetness)
        for index, color in enumerate(colors[1:-1], start=1):
            element = elements.new(index / (len(colors) - 1))
            element.color = darkened(color, wetness)
        links.new(pattern_factor, palette.inputs["Fac"])

        pore_mask = nodes.new("ShaderNodeMath")
        pore_mask.name = "videoer-granular-pore-mask"
        pore_mask.operation = "SUBTRACT"
        pore_mask.inputs[0].default_value = 1.0
        links.new(aggregate_profile.outputs["Result"], pore_mask.inputs[1])
        pore_strength = nodes.new("ShaderNodeMath")
        pore_strength.name = "videoer-granular-pore-strength"
        pore_strength.operation = "MULTIPLY"
        pore_strength.inputs[1].default_value = pore_amount * (1.0 - compaction * 0.45)
        links.new(pore_mask.outputs[0], pore_strength.inputs[0])
        pore_darkening = nodes.new("ShaderNodeMixRGB")
        pore_darkening.name = "videoer-granular-pore-darkening"
        pore_darkening.blend_type = "MULTIPLY"
        pore_darkening.inputs[2].default_value = (0.16, 0.14, 0.12, 1)
        links.new(pore_strength.outputs[0], pore_darkening.inputs["Fac"])
        links.new(palette.outputs["Color"], pore_darkening.inputs[1])

        dirt_mapping = nodes.new("ShaderNodeMapping")
        dirt_mapping.name = "videoer-granular-embedded-dirt-mapping"
        dirt_scale = max(aggregate_scale * 12.0, 0.08)
        dirt_mapping.inputs["Scale"].default_value = (1.0 / dirt_scale,) * 3
        links.new(mapping.outputs["Vector"], dirt_mapping.inputs["Vector"])
        dirt_noise = nodes.new("ShaderNodeTexNoise")
        dirt_noise.name = "videoer-granular-embedded-dirt"
        dirt_noise.inputs["Scale"].default_value = 1.0
        dirt_noise.inputs["Detail"].default_value = 2.5
        dirt_noise.inputs["Roughness"].default_value = 0.7
        links.new(dirt_mapping.outputs["Vector"], dirt_noise.inputs["Vector"])
        dirt_mask = nodes.new("ShaderNodeMath")
        dirt_mask.name = "videoer-granular-embedded-dirt-amount"
        dirt_mask.operation = "MULTIPLY"
        dirt_mask.inputs[1].default_value = embedded_dirt
        links.new(dirt_noise.outputs["Fac"], dirt_mask.inputs[0])
        dirt_color = nodes.new("ShaderNodeMixRGB")
        dirt_color.name = "videoer-granular-embedded-dirt-darkening"
        dirt_color.blend_type = "MULTIPLY"
        dirt_color.inputs[2].default_value = (0.34, 0.29, 0.23, 1)
        links.new(dirt_mask.outputs[0], dirt_color.inputs["Fac"])
        links.new(pore_darkening.outputs["Color"], dirt_color.inputs[1])
        links.new(dirt_color.outputs["Color"], principled.inputs["Base Color"])

        roughness_factor = nodes.new("ShaderNodeMixRGB")
        roughness_factor.name = "videoer-granular-roughness-factor"
        roughness_factor.blend_type = "MIX"
        roughness_factor.inputs["Fac"].default_value = 1.0 - compaction * 0.55
        links.new(fines.outputs["Fac"], roughness_factor.inputs[1])
        links.new(pore_strength.outputs[0], roughness_factor.inputs[2])
        roughness_ramp = nodes.new("ShaderNodeValToRGB")
        roughness_ramp.name = "videoer-granular-roughness"
        roughness_ramp.color_ramp.elements[0].color = (
            surface["roughness"]["minimum"],
        ) * 3 + (1,)
        roughness_ramp.color_ramp.elements[1].color = (
            surface["roughness"]["maximum"],
        ) * 3 + (1,)
        links.new(roughness_factor.outputs["Color"], roughness_ramp.inputs["Fac"])
        pattern_roughness = roughness_ramp.outputs["Color"]

        relief_height = nodes.new("ShaderNodeMixRGB")
        relief_height.name = "videoer-granular-relief-height"
        relief_height.blend_type = "ADD"
        relief_height.inputs["Fac"].default_value = 0.22 + pore_amount * 0.28
        links.new(aggregate_profile.outputs["Result"], relief_height.inputs[1])
        links.new(fines.outputs["Fac"], relief_height.inputs[2])
        relief = nodes.new("ShaderNodeBump")
        relief.name = "videoer-granular-relief"
        relief.inputs["Strength"].default_value = (
            surface["normal"]["strength"]
            * (0.58 + pore_amount * 0.34)
            * (1.0 - compaction * 0.42)
        )
        relief.inputs["Distance"].default_value = aggregate_scale * (
            0.045 + (1.0 - compaction) * 0.065
        )
        links.new(relief_height.outputs["Color"], relief.inputs["Height"])
        pattern_normal = relief.outputs["Normal"]
    elif pattern["kind"] == "cut-stone":
        axes = [axis for axis in ("x", "y", "z") if axis != pattern["beddingAxis"]]
        stone_mapping = nodes.new("ShaderNodeMapping")
        stone_mapping.inputs["Scale"].default_value = (
            1.0 / pattern["grainScaleMeters"],
            1.0 / pattern["beddingScaleMeters"],
            1.0 / pattern["grainScaleMeters"],
        )
        links.new(projected_vector([axes[0], pattern["beddingAxis"], axes[1]]), stone_mapping.inputs["Vector"])
        grain = nodes.new("ShaderNodeTexVoronoi")
        grain.distance = "EUCLIDEAN"
        grain.feature = "DISTANCE_TO_EDGE"
        links.new(stone_mapping.outputs["Vector"], grain.inputs["Vector"])
        bedding = nodes.new("ShaderNodeTexWave")
        bedding.wave_type = "BANDS"
        bedding.bands_direction = "Y"
        bedding.inputs["Scale"].default_value = 1.0
        bedding.inputs["Distortion"].default_value = 3.0
        links.new(stone_mapping.outputs["Vector"], bedding.inputs["Vector"])
        stone = nodes.new("ShaderNodeMixRGB")
        stone.blend_type = "MULTIPLY"
        stone.inputs["Fac"].default_value = pattern["veinContrast"]
        links.new(grain.outputs["Distance"], stone.inputs[1])
        links.new(bedding.outputs["Color"], stone.inputs[2])
        pattern_factor = stone.outputs["Color"]
        palette = nodes.new("ShaderNodeValToRGB")
        palette.color_ramp.elements[0].color = darkened(colors[0], wetness)
        palette.color_ramp.elements[1].color = darkened(colors[-1], wetness)
        links.new(pattern_factor, palette.inputs["Fac"])
        links.new(palette.outputs["Color"], principled.inputs["Base Color"])
        relief = nodes.new("ShaderNodeBump")
        relief.inputs["Strength"].default_value = surface["normal"]["strength"] * pattern["poreAmount"]
        relief.inputs["Distance"].default_value = pattern["grainScaleMeters"] * 0.06
        links.new(pattern_factor, relief.inputs["Height"])
        pattern_normal = relief.outputs["Normal"]
    elif pattern["kind"] == "architectural-glazing":
        transmission = principled.inputs.get("Transmission Weight") or principled.inputs.get("Transmission")
        if transmission:
            transmission.default_value = pattern["transmission"]
        if principled.inputs.get("IOR"):
            principled.inputs["IOR"].default_value = pattern["ior"]
        scratches = nodes.new("ShaderNodeTexNoise")
        scratches.inputs["Scale"].default_value = 1.0 / pattern["microScratchScaleMeters"]
        scratches.inputs["Detail"].default_value = 2.0
        scratches.inputs["Roughness"].default_value = 0.72
        links.new(mapping.outputs["Vector"], scratches.inputs["Vector"])
        tint = nodes.new("ShaderNodeMixRGB")
        tint.blend_type = "MULTIPLY"
        tint.inputs["Fac"].default_value = pattern["dirtAmount"]
        tint.inputs[1].default_value = darkened(colors[-1], wetness)
        links.new(color_noise.outputs["Color"], tint.inputs[2])
        links.new(tint.outputs["Color"], principled.inputs["Base Color"])
        pattern_factor = scratches.outputs["Fac"]
    elif pattern["kind"] == "woven-textile":
        warp_axis = pattern["warpAxis"]
        cross_axes = [axis for axis in ("x", "y", "z") if axis != warp_axis]
        weave_mapping = nodes.new("ShaderNodeMapping")
        weave_mapping.inputs["Scale"].default_value = (
            1.0 / pattern["weftSpacingMeters"],
            1.0 / pattern["warpSpacingMeters"],
            1.0,
        )
        links.new(
            projected_vector([cross_axes[0], warp_axis, cross_axes[1]]),
            weave_mapping.inputs["Vector"],
        )
        warp = nodes.new("ShaderNodeTexWave")
        warp.wave_type = "BANDS"
        warp.bands_direction = "X"
        warp.inputs["Scale"].default_value = 1.0
        warp.inputs["Distortion"].default_value = pattern["fuzzAmount"] * 2.2
        links.new(weave_mapping.outputs["Vector"], warp.inputs["Vector"])
        weft = nodes.new("ShaderNodeTexWave")
        weft.wave_type = "BANDS"
        weft.bands_direction = "Y"
        weft.inputs["Scale"].default_value = 1.0
        weft.inputs["Distortion"].default_value = pattern["fuzzAmount"] * 1.6
        links.new(weave_mapping.outputs["Vector"], weft.inputs["Vector"])
        weave = nodes.new("ShaderNodeMixRGB")
        weave.blend_type = "MULTIPLY"
        weave.inputs["Fac"].default_value = pattern["threadContrast"]
        links.new(warp.outputs["Color"], weave.inputs[1])
        links.new(weft.outputs["Color"], weave.inputs[2])
        pattern_factor = weave.outputs["Color"]
        palette = nodes.new("ShaderNodeValToRGB")
        palette.color_ramp.elements[0].color = darkened(colors[0], wetness)
        palette.color_ramp.elements[1].color = darkened(colors[-1], wetness)
        links.new(pattern_factor, palette.inputs["Fac"])
        links.new(palette.outputs["Color"], principled.inputs["Base Color"])
        weave_bump = nodes.new("ShaderNodeBump")
        weave_bump.inputs["Strength"].default_value = surface["normal"]["strength"] * 0.48
        weave_bump.inputs["Distance"].default_value = min(
            pattern["warpSpacingMeters"], pattern["weftSpacingMeters"]
        ) * 0.18
        links.new(pattern_factor, weave_bump.inputs["Height"])
        pattern_normal = weave_bump.outputs["Normal"]
        sheen_weight = principled.inputs.get("Sheen Weight") or principled.inputs.get("Sheen")
        if sheen_weight:
            sheen_weight.default_value = pattern["fuzzAmount"] * 0.35
    elif pattern["kind"] == "brushed-metal":
        brush_axis = pattern["brushAxis"]
        cross_axes = [axis for axis in ("x", "y", "z") if axis != brush_axis]
        brush_mapping = nodes.new("ShaderNodeMapping")
        brush_mapping.inputs["Scale"].default_value = (
            1.0 / pattern["brushSpacingMeters"],
            0.18 / pattern["brushSpacingMeters"],
            1.0 / pattern["brushSpacingMeters"],
        )
        links.new(
            projected_vector([cross_axes[0], brush_axis, cross_axes[1]]),
            brush_mapping.inputs["Vector"],
        )
        scratches = nodes.new("ShaderNodeTexNoise")
        scratches.inputs["Scale"].default_value = 1.0
        scratches.inputs["Detail"].default_value = 6.0
        scratches.inputs["Roughness"].default_value = 0.74
        links.new(brush_mapping.outputs["Vector"], scratches.inputs["Vector"])
        pattern_factor = scratches.outputs["Fac"]
        palette = nodes.new("ShaderNodeValToRGB")
        palette.color_ramp.elements[0].color = darkened(colors[0], wetness)
        palette.color_ramp.elements[1].color = darkened(colors[-1], wetness)
        links.new(pattern_factor, palette.inputs["Fac"])
        links.new(palette.outputs["Color"], principled.inputs["Base Color"])
        brush_bump = nodes.new("ShaderNodeBump")
        brush_bump.inputs["Strength"].default_value = (
            surface["normal"]["strength"] * pattern["scratchContrast"] * 0.42
        )
        brush_bump.inputs["Distance"].default_value = pattern["brushSpacingMeters"] * 0.12
        links.new(pattern_factor, brush_bump.inputs["Height"])
        pattern_normal = brush_bump.outputs["Normal"]
        if pattern["patinaAmount"] > 0:
            patina = nodes.new("ShaderNodeTexNoise")
            patina.inputs["Scale"].default_value = 9.0
            patina.inputs["Detail"].default_value = 3.0
            links.new(mapping.outputs["Vector"], patina.inputs["Vector"])
            patina_mix = nodes.new("ShaderNodeMixRGB")
            patina_mix.blend_type = "MULTIPLY"
            patina_mix.inputs["Fac"].default_value = pattern["patinaAmount"]
            links.new(palette.outputs["Color"], patina_mix.inputs[1])
            links.new(patina.outputs["Color"], patina_mix.inputs[2])
            links.new(patina_mix.outputs["Color"], principled.inputs["Base Color"])
    elif pattern["kind"] == "glazed-ceramic":
        speckles = nodes.new("ShaderNodeTexNoise")
        speckles.inputs["Scale"].default_value = 1.0 / pattern["speckleScaleMeters"]
        speckles.inputs["Detail"].default_value = 4.0
        speckles.inputs["Roughness"].default_value = 0.66
        links.new(mapping.outputs["Vector"], speckles.inputs["Vector"])
        palette = nodes.new("ShaderNodeValToRGB")
        palette.color_ramp.elements[0].color = darkened(colors[0], wetness)
        palette.color_ramp.elements[1].color = darkened(colors[-1], wetness)
        links.new(speckles.outputs["Fac"], palette.inputs["Fac"])
        links.new(palette.outputs["Color"], principled.inputs["Base Color"])
        pattern_factor = speckles.outputs["Fac"]
        ceramic_bump = nodes.new("ShaderNodeBump")
        ceramic_bump.inputs["Strength"].default_value = (
            surface["normal"]["strength"] * pattern["speckleAmount"] * 0.22
        )
        ceramic_bump.inputs["Distance"].default_value = pattern["speckleScaleMeters"] * 0.06
        links.new(pattern_factor, ceramic_bump.inputs["Height"])
        pattern_normal = ceramic_bump.outputs["Normal"]
        coat_weight = principled.inputs.get("Coat Weight")
        coat_roughness = principled.inputs.get("Coat Roughness")
        if coat_weight:
            coat_weight.default_value = pattern["glazeAmount"]
        if coat_roughness:
            coat_roughness.default_value = pattern["glazeRoughness"]
    elif surface["baseColor"]["kind"] == "procedural-palette":
        palette = nodes.new("ShaderNodeValToRGB")
        elements = palette.color_ramp.elements
        elements[0].position = 0.0
        elements[0].color = darkened(colors[0], wetness)
        elements[1].position = 1.0
        elements[1].color = darkened(colors[-1], wetness)
        for index, color in enumerate(colors[1:-1], start=1):
            element = elements.new(index / (len(colors) - 1))
            element.color = darkened(color, wetness)
        links.new(color_noise.outputs["Fac"], palette.inputs["Fac"])
        links.new(palette.outputs["Color"], principled.inputs["Base Color"])

    # Environmental history is a renderer-independent surface layer. It is
    # evaluated in object-space metres so the same plaster, masonry, stone or
    # wood contract keeps its streak width and damp height on differently sized
    # assets instead of stretching to each object's bounds.
    weathering = surface.get("weathering")
    if weathering:
        masks = []
        domain_vector = projected_vector(["x", "y", "z"])
        streaks = weathering.get("verticalStreaks")
        if streaks and streaks.get("amount", 0) > 0:
            streak_mapping = nodes.new("ShaderNodeMapping")
            streak_mapping.inputs["Scale"].default_value = (
                1.0 / streaks["widthMeters"],
                1.0 / streaks["lengthMeters"],
                1.0 / streaks["widthMeters"],
            )
            links.new(domain_vector, streak_mapping.inputs["Vector"])
            streak_noise = nodes.new("ShaderNodeTexNoise")
            streak_noise.inputs["Scale"].default_value = 1.0
            streak_noise.inputs["Detail"].default_value = 3.2
            streak_noise.inputs["Roughness"].default_value = 0.68
            links.new(streak_mapping.outputs["Vector"], streak_noise.inputs["Vector"])
            streak_ramp = nodes.new("ShaderNodeValToRGB")
            streak_ramp.color_ramp.elements[0].position = 0.58
            streak_ramp.color_ramp.elements[0].color = (0, 0, 0, 1)
            streak_ramp.color_ramp.elements[1].position = 0.78
            streak_ramp.color_ramp.elements[1].color = (streaks["amount"],) * 3 + (1,)
            links.new(streak_noise.outputs["Fac"], streak_ramp.inputs["Fac"])
            masks.append(streak_ramp.outputs["Color"])
        damp = weathering.get("lowerDamp")
        if damp and damp.get("amount", 0) > 0:
            damp_height = nodes.new("ShaderNodeMath")
            damp_height.operation = "DIVIDE"
            damp_height.inputs[1].default_value = damp["heightMeters"]
            links.new(domain_components["y"], damp_height.inputs[0])
            damp_inverse = nodes.new("ShaderNodeMath")
            damp_inverse.operation = "SUBTRACT"
            damp_inverse.inputs[0].default_value = 1.0
            damp_inverse.use_clamp = True
            links.new(damp_height.outputs[0], damp_inverse.inputs[1])
            damp_amount = nodes.new("ShaderNodeMath")
            damp_amount.operation = "MULTIPLY"
            damp_amount.inputs[1].default_value = damp["amount"]
            links.new(damp_inverse.outputs[0], damp_amount.inputs[0])
            masks.append(damp_amount.outputs[0])
        dirt = weathering.get("surfaceDirt")
        if dirt and dirt.get("amount", 0) > 0:
            dirt_noise = nodes.new("ShaderNodeTexNoise")
            dirt_noise.inputs["Scale"].default_value = 1.0 / dirt["scaleMeters"]
            dirt_noise.inputs["Detail"].default_value = 4.0
            dirt_noise.inputs["Roughness"].default_value = 0.72
            links.new(mapping.outputs["Vector"], dirt_noise.inputs["Vector"])
            dirt_amount = nodes.new("ShaderNodeMath")
            dirt_amount.operation = "MULTIPLY"
            dirt_amount.inputs[1].default_value = dirt["amount"]
            links.new(dirt_noise.outputs["Fac"], dirt_amount.inputs[0])
            masks.append(dirt_amount.outputs[0])
        if masks:
            combined_mask = masks[0]
            for candidate_mask in masks[1:]:
                maximum = nodes.new("ShaderNodeMath")
                maximum.operation = "MAXIMUM"
                links.new(combined_mask, maximum.inputs[0])
                links.new(candidate_mask, maximum.inputs[1])
                combined_mask = maximum.outputs[0]
            base_input = principled.inputs["Base Color"]
            base_link = next(iter(base_input.links), None)
            if base_link:
                base_source = base_link.from_socket
                links.remove(base_link)
                weather_mix = nodes.new("ShaderNodeMixRGB")
                weather_mix.blend_type = "MULTIPLY"
                weather_mix.inputs[2].default_value = (0.28, 0.31, 0.3, 1)
                links.new(combined_mask, weather_mix.inputs["Fac"])
                links.new(base_source, weather_mix.inputs[1])
                links.new(weather_mix.outputs["Color"], base_input)

    if pattern_roughness:
        links.new(pattern_roughness, principled.inputs["Roughness"])
    else:
        roughness_noise = nodes.new("ShaderNodeTexNoise")
        roughness_noise.inputs["Scale"].default_value = (
            1.0 / surface["roughness"]["variationScaleMeters"]
        )
        roughness_noise.inputs["Detail"].default_value = 2.0
        roughness_noise.inputs["Roughness"].default_value = 0.62
        links.new(mapping.outputs["Vector"], roughness_noise.inputs["Vector"])
        roughness = nodes.new("ShaderNodeValToRGB")
        roughness.color_ramp.elements[0].color = (
            surface["roughness"]["minimum"],
        ) * 3 + (1,)
        roughness.color_ramp.elements[1].color = (
            surface["roughness"]["maximum"],
        ) * 3 + (1,)
        links.new(roughness_noise.outputs["Fac"], roughness.inputs["Fac"])
        links.new(roughness.outputs["Color"], principled.inputs["Roughness"])

    coat_weight = principled.inputs.get("Coat Weight")
    coat_roughness = principled.inputs.get("Coat Roughness")
    if wetness > 0 and coat_weight and coat_roughness:
        coat_weight.default_value = wetness * 0.55
        coat_roughness.default_value = max(0.015, surface["roughness"]["minimum"] * 0.45)

    if surface["normal"]["kind"] == "procedural-noise" and surface["normal"]["strength"] > 0:
        normal_noise = nodes.new("ShaderNodeTexNoise")
        normal_noise.inputs["Scale"].default_value = 1.0 / surface["normal"]["scaleMeters"]
        normal_noise.inputs["Detail"].default_value = 4.0
        links.new(mapping.outputs["Vector"], normal_noise.inputs["Vector"])
        bump = nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = surface["normal"]["strength"]
        bump.inputs["Distance"].default_value = surface["normal"]["scaleMeters"] * 0.08
        if pattern_normal:
            links.new(pattern_normal, bump.inputs["Normal"])
        links.new(normal_noise.outputs["Fac"], bump.inputs["Height"])
        links.new(bump.outputs["Normal"], principled.inputs["Normal"])
    elif pattern_normal:
        links.new(pattern_normal, principled.inputs["Normal"])
    configure_texture_map_nodes(material, principled, surface, asset_directory)


def create_material(material_definition, asset_directory=None):
    material = bpy.data.materials.new(material_definition["id"])
    base_color = material_definition["baseColor"]
    material.diffuse_color = base_color
    material.metallic = material_definition.get("metallic", 0)
    material.roughness = material_definition.get("roughness", 0.5)
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    if principled:
        principled.inputs["Base Color"].default_value = base_color
        principled.inputs["Metallic"].default_value = material.metallic
        principled.inputs["Roughness"].default_value = material.roughness
        specular_ior = principled.inputs.get("Specular IOR Level")
        if specular_ior and "specularIorLevel" in material_definition:
            specular_ior.default_value = material_definition["specularIorLevel"]
        anisotropy = principled.inputs.get("Anisotropic IOR Level") or principled.inputs.get("Anisotropic")
        if anisotropy:
            anisotropy.default_value = material_definition.get("anisotropy", 0)
        anisotropy_rotation = principled.inputs.get("Anisotropic Rotation")
        if anisotropy_rotation:
            anisotropy_rotation.default_value = material_definition.get("anisotropyRotation", 0)
        if "Alpha" in principled.inputs:
            principled.inputs["Alpha"].default_value = base_color[3]
        emission = material_definition.get("emission", [0, 0, 0])
        emission_socket = principled.inputs.get("Emission Color") or principled.inputs.get("Emission")
        if emission_socket:
            emission_socket.default_value = (*emission, 1)
        if "Emission Strength" in principled.inputs:
            principled.inputs["Emission Strength"].default_value = material_definition.get(
                "emissionStrength", 0
            )
        configure_surface_nodes(
            material, principled, material_definition.get("surface"), asset_directory
        )
        fiber = material_definition.get("fiber")
        if fiber and fiber.get("kind") == "uv-hair-flow":
            nodes = material.node_tree.nodes
            links = material.node_tree.links
            coordinates = nodes.new("ShaderNodeTexCoord")
            wave = nodes.new("ShaderNodeTexWave")
            wave.wave_type = "BANDS"
            wave.bands_direction = "Y"
            wave.inputs["Scale"].default_value = fiber["strandFrequency"]
            wave.inputs["Distortion"].default_value = 2.2
            wave.inputs["Detail"].default_value = 3.0
            links.new(coordinates.outputs["UV"], wave.inputs["Vector"])
            variation = fiber["colorVariation"]
            ramp = nodes.new("ShaderNodeValToRGB")
            ramp.color_ramp.elements[0].color = tuple(max(0, channel * (1 - variation)) for channel in base_color[:3]) + (1,)
            ramp.color_ramp.elements[1].color = tuple(min(1, channel * (1 + variation)) for channel in base_color[:3]) + (1,)
            links.new(wave.outputs["Color"], ramp.inputs["Fac"])
            links.new(ramp.outputs["Color"], principled.inputs["Base Color"])
            bump = nodes.new("ShaderNodeBump")
            bump.inputs["Strength"].default_value = fiber["normalStrength"]
            bump.inputs["Distance"].default_value = 0.00035
            links.new(wave.outputs["Color"], bump.inputs["Height"])
            links.new(bump.outputs["Normal"], principled.inputs["Normal"])
    if base_color[3] < 1 and hasattr(material, "surface_render_method"):
        material.surface_render_method = "DITHERED"
    return material


def create_mesh(asset, armature=None, asset_directory=None, vertex_converter=to_blender):
    vertices = [vertex_converter(position) for position in asset["positions"]]
    indices = asset["indices"]
    faces = [(indices[i], indices[i + 1], indices[i + 2]) for i in range(0, len(indices), 3)]
    data = bpy.data.meshes.new(asset["id"])
    data.from_pydata(vertices, [], faces)
    data.update()
    attribute_types = {
        "float": ("FLOAT", "value"),
        "vec2": ("FLOAT2", "vector"),
        "vec3": ("FLOAT_VECTOR", "vector"),
        "vec4": ("FLOAT_COLOR", "color"),
    }
    for name, definition in asset.get("attributes", {}).items():
        if definition.get("interpolation") != "vertex":
            raise RuntimeError(f"Geometry attribute '{name}' has unsupported interpolation")
        data_type = definition.get("dataType")
        if data_type not in attribute_types:
            raise RuntimeError(f"Geometry attribute '{name}' has unsupported data type")
        values = definition.get("values", [])
        if len(values) != len(vertices):
            raise RuntimeError(f"Geometry attribute '{name}' must contain one value per vertex")
        blender_type, property_name = attribute_types[data_type]
        attribute = data.attributes.new(name=name, type=blender_type, domain="POINT")
        for index, value in enumerate(values):
            setattr(attribute.data[index], property_name, value)
    if asset.get("metadata", {}).get("topology") == "project-owned-implicit-unified-body-v1" or asset.get("metadata", {}).get("hairClass"):
        for polygon in data.polygons:
            polygon.use_smooth = True
        source_normals = asset.get("normals", [])
        if len(source_normals) == len(vertices):
            data.normals_split_custom_set_from_vertices(
                [vertex_converter(normal) for normal in source_normals]
            )
    source_uvs = asset.get("uvs", [])
    for material_definition in asset.get("materials", []):
        texture_maps = material_definition.get("surface", {}).get("textureMaps")
        if (
            texture_maps
            and texture_maps.get("application", {}).get("placement", {}).get("orientation")
            in {"uv-authored", "unit-local-uv-meters"}
            and len(source_uvs) != len(vertices)
        ):
            orientation = texture_maps["application"]["placement"]["orientation"]
            raise RuntimeError(
                f"Texture orientation '{orientation}' on material "
                f"'{material_definition['id']}' requires one UV per vertex"
            )
        unit_variation = texture_maps.get("application", {}).get("placement", {}).get(
            "unitVariation"
        ) if texture_maps else None
        if unit_variation:
            for field in ("valueAttribute", "roughnessAttribute", "weatheringAttribute"):
                name = unit_variation[field]
                definition = asset.get("attributes", {}).get(name)
                if not definition or definition.get("dataType") != "float":
                    raise RuntimeError(
                        f"Texture unit variation requires float vertex attribute '{name}'"
                    )
    if source_uvs:
        uv_layer = data.uv_layers.new(name="UVMap")
        for loop in data.loops:
            uv_layer.data[loop.index].uv = source_uvs[loop.vertex_index]
    mesh = bpy.data.objects.new(asset["id"], data)
    bpy.context.collection.objects.link(mesh)

    if asset.get("morphTargets"):
        mesh.shape_key_add(name="Basis")
        for target in asset["morphTargets"]:
            shape = mesh.shape_key_add(name=target["id"])
            shape.value = 0.0
            for vertex_index, delta in zip(target["vertexIndices"], target["positionDeltas"]):
                shape.data[vertex_index].co = Vector(vertices[vertex_index]) + Vector(vertex_converter(delta))

    material_indices = {}
    materials = asset.get("materials", [])
    if not materials:
        materials = [
            {
                "id": "mannequin-porcelain",
                "baseColor": (0.19, 0.43, 0.62, 1.0),
                "metallic": 0.05,
                "roughness": 0.34,
            }
        ]
    for material_definition in materials:
        material = create_material(material_definition, asset_directory)
        material_indices[material_definition["id"]] = len(mesh.data.materials)
        mesh.data.materials.append(material)
        metadata = asset.get("metadata", {})
        if (
            asset_directory
            and metadata.get("frontTexture")
            and metadata.get("textureMaterialId") == material_definition["id"]
        ):
            texture_path = os.path.join(asset_directory, metadata["frontTexture"])
            principled = material.node_tree.nodes.get("Principled BSDF")
            texture = material.node_tree.nodes.new("ShaderNodeTexImage")
            texture.image = bpy.data.images.load(texture_path, check_existing=True)
            material.node_tree.links.new(texture.outputs["Color"], principled.inputs["Base Color"])
    for group in asset.get("materialGroups", []):
        first_polygon = group["start"] // 3
        polygon_count = group["count"] // 3
        material_index = material_indices[group["materialId"]]
        for polygon in mesh.data.polygons[first_polygon : first_polygon + polygon_count]:
            polygon.material_index = material_index

    joints = asset.get("skeleton", [])
    groups = [mesh.vertex_groups.new(name=joint["id"]) for joint in joints]
    skin_indices = asset.get("skinIndices", [])
    skin_weights = asset.get("skinWeights", [])
    for vertex_index, (bone_indices, weights) in enumerate(zip(skin_indices, skin_weights)):
        for bone_index, weight in zip(bone_indices, weights):
            if weight > 0 and bone_index < len(groups):
                groups[bone_index].add([vertex_index], weight, "REPLACE")
    if armature is not None:
        modifier = mesh.modifiers.new(name="canonical-humanoid-skin", type="ARMATURE")
        modifier.object = armature
        if asset.get("metadata", {}).get("skinning") == "deterministic-dual-quaternion-v1":
            modifier.use_deform_preserve_volume = True
        mesh.parent = armature
        mesh.matrix_parent_inverse = armature.matrix_world.inverted()
    return mesh


def point_camera(camera, target):
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()


def configure_scene(asset, output):
    scene = bpy.context.scene
    transmissive_witness = asset.get("metadata", {}).get("witnessGeometry") == "standing-transmissive-pane"
    if transmissive_witness:
        scene.render.engine = "CYCLES"
        scene.cycles.device = "CPU"
        scene.cycles.samples = 128
        scene.cycles.seed = 1729
        scene.cycles.use_animated_seed = False
        scene.cycles.use_adaptive_sampling = False
        scene.cycles.use_denoising = True
        scene.cycles.denoiser = "OPENIMAGEDENOISE"
        scene.cycles.max_bounces = 8
        scene.cycles.transmission_bounces = 8
        scene.cycles.transparent_max_bounces = 8
    else:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.dither_intensity = 0.0
    scene.world.color = (0.012, 0.018, 0.03)
    scene.render.fps = 24

    vertices = [Vector(to_blender(position)) for position in asset["positions"]]
    minimum = Vector(tuple(min(vertex[axis] for vertex in vertices) for axis in range(3)))
    maximum = Vector(tuple(max(vertex[axis] for vertex in vertices) for axis in range(3)))
    centre = (minimum + maximum) * 0.5
    extents = maximum - minimum
    height = max(0.5, extents.z)
    if asset.get("metadata", {}).get("hairClass"):
        radius = max(0.32, extents.x, extents.y, extents.z) * 2.15
    elif asset.get("metadata", {}).get("propClass") == "dimensional-campaign-cover":
        radius = max(0.65, extents.x, extents.y, extents.z) * 1.35
    else:
        radius = max(1.8, extents.x, extents.y, extents.z) * 1.55
    floor_size = (
        max(2.0, extents.x * 3.0, extents.y * 3.0)
        if asset.get("metadata", {}).get("hairClass")
        else max(8, extents.x * 1.35, extents.y * 1.35)
    )
    bpy.ops.mesh.primitive_plane_add(size=floor_size, location=(centre.x, centre.y, 0))
    floor = bpy.context.object
    floor.name = "verification-floor"
    floor_material = bpy.data.materials.new("verification-floor")
    floor_material.diffuse_color = (0.025, 0.035, 0.055, 1)
    floor_material.roughness = 0.72
    floor.data.materials.append(floor_material)

    bpy.ops.object.light_add(type="AREA", location=(2.4, -3.2, height * 1.25))
    key = bpy.context.object
    key.data.energy = 900
    key.data.shape = "DISK"
    key.data.size = 2.5
    key.data.color = (0.72, 0.84, 1.0)
    key.rotation_euler = (math.radians(55), 0, math.radians(35))

    bpy.ops.object.light_add(type="AREA", location=(-2.0, 1.5, height * 1.45))
    rim = bpy.context.object
    rim.data.energy = 700
    rim.data.size = 2.0
    rim.data.color = (1.0, 0.55, 0.32)
    rim.rotation_euler = (math.radians(40), 0, math.radians(-140))

    bpy.ops.object.light_add(type="AREA", location=(0, 0.5, height * 2.2))
    top = bpy.context.object
    top.data.energy = 450
    top.data.size = 3.0

    if asset.get("metadata", {}).get("environmentClass"):
        for index, location in enumerate(((0, -1.8, 3.55), (0, -4.05, 3.35))):
            bpy.ops.object.light_add(type="AREA", location=location)
            interior = bpy.context.object
            interior.name = f"verification-interior-{index}"
            interior.data.energy = 1300
            interior.data.size = 3.2
            interior.data.color = (1.0, 0.55, 0.28)

    camera_data = bpy.data.cameras.new("verification-camera")
    camera = bpy.data.objects.new("verification-camera", camera_data)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera
    camera.data.lens = 55
    if asset.get("metadata", {}).get("characterClass"):
        character_height = float(asset.get("metadata", {}).get("parameters", {}).get("height", height))
        target = (0, 0, character_height * 0.52)
        radius = character_height * 2.15
    else:
        target = (centre.x, centre.y, max(0.35, centre.z))
    return scene, camera, target, radius


def render_views(scene, camera, target, radius, output, asset):
    character = asset.get("metadata", {}).get("characterClass")
    environment = asset.get("metadata", {}).get("environmentClass")
    material_swatch = asset.get("metadata", {}).get("materialClass")
    if material_swatch:
        floor = bpy.data.objects.get("verification-floor")
        if floor:
            floor.location.z = -0.09
        lights = [obj for obj in scene.objects if obj.type == "LIGHT"]
        material_light_rig = [
            ((2.4, -2.8, 3.2), 480, (0.7, 0.82, 1.0)),
            ((-2.2, 1.8, 2.4), 320, (1.0, 0.48, 0.22)),
            ((0, 0.4, 4.2), 220, (1.0, 1.0, 1.0)),
        ]
        for light, (location, energy, color) in zip(lights, material_light_rig):
            light.location = location
            light.data.energy = energy
            light.data.color = color
            point_camera(light, (0, 0, 0))
        witness = asset.get("metadata", {}).get("witnessGeometry", "floor-grid")
        if witness == "floor-grid":
            material_views = [
                ("top", (0, 0, 4.2), (0, 0, 0)),
                ("raking", (3.0, -3.0, 1.25), (0, 0, 0)),
                ("close", (1.65, -1.8, 0.52), (0.15, 0, 0)),
                ("glancing", (-2.4, 2.1, 0.28), (0, 0, 0)),
            ]
        else:
            material_views = [
                ("top", (0, 0, 4.4), (0, -0.35, 0.1)),
                ("raking", (3.15, -3.35, 1.75), (0, -0.8, 0.62)),
                ("close", (1.8, -2.65, 1.05), (0.05, -1.46, 0.8)),
                ("glancing", (-2.7, 0.8, 0.72), (0, -0.85, 0.55)),
            ]
        camera.data.lens = 62
        for name, position, view_target in material_views:
            camera.location = position
            point_camera(camera, view_target)
            scene.render.filepath = os.path.join(output, f"{name}.png")
            bpy.ops.render.render(write_still=True)
        return
    if environment:
        environment_views = [
            ("street-front", (7.8, 2.55, 2.2), (-1.5, 2.2, 1.4)),
            ("street-three-quarter", (5.8, 4.4, 3.2), (-0.8, 1.5, 1.35)),
            ("threshold", (0.1, 1.7, 1.55), (0.1, -2.1, 1.45)),
            ("interior-shelves", (0, -0.85, 1.55), (0, -4.55, 1.7)),
            ("interior-facade", (0, -4.35, 1.7), (0.6, -0.05, 1.55)),
            ("continuity-overhead", (6.8, 3.1, 8.4), (0, 1.5, 0.4)),
        ]
        for name, position, view_target in environment_views:
            camera.location = position
            point_camera(camera, view_target)
            scene.render.filepath = os.path.join(output, f"{name}.png")
            bpy.ops.render.render(write_still=True)
        return
    views = (
        [
            ("front", 0),
            ("three-quarter-left", 45),
            ("left", 90),
            ("right", -90),
            ("three-quarter-right", -45),
            ("back", 180),
        ]
        if character
        else [("front", 0), ("three-quarter", 45), ("side", 90), ("back", 180)]
    )
    for name, angle in views:
        radians = math.radians(angle)
        # Canonical forward -Z maps to Blender +Y, so the front camera belongs
        # on +Y looking back at the subject. Keep view names semantic.
        camera.location = (math.sin(radians) * radius, math.cos(radians) * radius, target[2])
        point_camera(camera, target)
        scene.render.filepath = os.path.join(output, f"{name}.png")
        bpy.ops.render.render(write_still=True)
    if character:
        height = float(asset.get("metadata", {}).get("parameters", {}).get("height", 1.72))
        head_target = (0, 0, height * 0.88)
        camera.location = (0, 0.68, height * 0.9)
        camera.data.lens = 72
        point_camera(camera, head_target)
        scene.render.filepath = os.path.join(output, "face-close-up.png")
        bpy.ops.render.render(write_still=True)
        camera.location = (0.42, 0.58, height * 0.91)
        point_camera(camera, head_target)
        scene.render.filepath = os.path.join(output, "face-three-quarter.png")
        bpy.ops.render.render(write_still=True)
        camera.location = (0, 0.68, height * 0.9)
        point_camera(camera, head_target)
        character_mesh = bpy.data.objects.get(asset.get("id"))
        expression_views = [
            ("face-smile.png", ["expression-smile"]),
            ("face-jaw-open.png", ["expression-jaw-open"]),
            ("face-blink.png", ["expression-blink-left", "expression-blink-right"]),
        ]
        if character_mesh and character_mesh.data.shape_keys:
            keys = character_mesh.data.shape_keys.key_blocks
            for filename, active_keys in expression_views:
                for key in keys:
                    if key.name != "Basis":
                        key.value = 1.0 if key.name in active_keys else 0.0
                scene.render.filepath = os.path.join(output, filename)
                bpy.ops.render.render(write_still=True)
            for key in keys:
                if key.name != "Basis":
                    key.value = 0.0
        attachments = asset.get("attachments", {})
        joint_positions = world_joint_positions(asset.get("skeleton", []))
        hand_targets = {}
        for side in ("left", "right"):
            attachment = attachments.get(f"{side}-hand-grip")
            if not attachment:
                continue
            hand = Vector(to_blender(attachment["position"]))
            middle_tip = joint_positions.get(f"{side}-middle-3", hand)
            hand_target = (hand + middle_tip) * 0.5
            hand_targets[side] = hand_target
            camera.location = hand_target + Vector((0, 0.46, 0.035))
            camera.data.lens = 72
            point_camera(camera, hand_target)
            scene.render.filepath = os.path.join(output, f"{side}-hand-close-up.png")
            bpy.ops.render.render(write_still=True)
        armature = bpy.data.objects.get("canonical-humanoid")
        if armature and hand_targets:
            for side in ("left", "right"):
                direction = -1 if side == "left" else 1
                for finger in ("thumb", "index", "middle", "ring", "little"):
                    for segment, bend in ((1, 0.2), (2, 0.38), (3, 0.32)):
                        bone = armature.pose.bones.get(f"{side}-{finger}-{segment}")
                        if bone:
                            bone.rotation_mode = "XYZ"
                            if finger == "thumb":
                                bone.rotation_euler[0] = bend * 0.42
                                bone.rotation_euler[2] = direction * bend * 0.12
                            else:
                                bone.rotation_euler[2] = direction * bend
            bpy.context.view_layer.update()
            for side in ("left", "right"):
                hand_target = hand_targets[side]
                camera.location = hand_target + Vector((0, 0.46, 0.035))
                camera.data.lens = 72
                point_camera(camera, hand_target)
                scene.render.filepath = os.path.join(output, f"{side}-hand-flexion.png")
                bpy.ops.render.render(write_still=True)
            for bone in armature.pose.bones:
                bone.rotation_mode = "XYZ"
                bone.rotation_euler = (0, 0, 0)
            bpy.context.view_layer.update()
        camera.data.lens = 55


def render_turntable(scene, camera, target, radius, output):
    scene.frame_start = 1
    scene.frame_end = 48
    for frame in range(1, 49):
        angle = 2 * math.pi * (frame - 1) / 48
        camera.location = (math.sin(angle) * radius, -math.cos(angle) * radius, target[2])
        point_camera(camera, target)
        camera.keyframe_insert(data_path="location", frame=frame)
        camera.keyframe_insert(data_path="rotation_euler", frame=frame)
    for curve in camera.animation_data.action.fcurves:
        for point in curve.keyframe_points:
            point.interpolation = "LINEAR"
    scene.render.image_settings.file_format = "FFMPEG"
    scene.render.ffmpeg.format = "MPEG4"
    scene.render.ffmpeg.codec = "H264"
    scene.render.ffmpeg.constant_rate_factor = "MEDIUM"
    scene.render.filepath = os.path.join(output, "turntable.mp4")
    bpy.ops.render.render(animation=True)


def main():
    geometry_file, output = args_after_separator()
    os.makedirs(output, exist_ok=True)
    with open(geometry_file, "r", encoding="utf-8") as handle:
        asset = json.load(handle)
    clear_scene()
    armature = create_armature(asset)
    create_mesh(asset, armature, os.path.dirname(os.path.abspath(geometry_file)))
    scene, camera, target, radius = configure_scene(asset, output)
    render_views(scene, camera, target, radius, output, asset)
    render_turntable(scene, camera, target, radius, output)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(output, "mannequin.blend"))


if __name__ == "__main__":
    main()
